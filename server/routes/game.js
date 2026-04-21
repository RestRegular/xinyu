// ===================================================================
// ===== 游戏路由（统一游戏动作、新游戏创建、存档操作、角色系统） =====
// ===================================================================

const express = require('express');
const router = express.Router();
const db = require('../db');
const { buildSystemPrompt, buildMessageHistory, buildCharacterPrompt, gameTools, characterTools } = require('../aiService');
const { executeGameFunction, executeCharacterTool } = require('../gameEngine');

// ----- 配置读取辅助 -----
function getConfigValue(key, defaultValue) {
    const row = db.prepare("SELECT value FROM config WHERE key = ?").get(key);
    if (!row) return defaultValue;
    try { return JSON.parse(row.value); } catch(e) { return row.value; }
}
function getApiKey() { return getConfigValue('apiKey', ''); }
function getApiBaseUrl() { return getConfigValue('apiBaseUrl', 'https://api.deepseek.com/v1/chat/completions'); }
function getModel() { return getConfigValue('model', 'deepseek-chat'); }
function getAppConfig() {
    return {
        temperature: getConfigValue('temperature', 0.9),
        maxTokens: getConfigValue('maxTokens', 2048),
        ui: getConfigValue('ui', { fontSize: 'medium', narrativeLength: 'medium' }),
        customInstructions: getConfigValue('customInstructions', ''),
    };
}

// ===================================================================
// ===== POST /api/game/action — 统一游戏动作（核心接口） =====
// ===================================================================
router.post('/action', async (req, res) => {
    const { saveId, userMessage } = req.body;
    if (!saveId || !userMessage) return res.status(400).json({ error: '缺少 saveId 或 userMessage' });

    const apiKey = getApiKey();
    if (!apiKey) return res.status(400).json({ error: '未配置 API Key，请在设置中配置' });

    // 加载存档
    const row = db.prepare('SELECT data FROM saves WHERE id = ?').get(saveId);
    if (!row) return res.status(404).json({ error: '存档不存在' });

    let saveData;
    try { saveData = JSON.parse(row.data); } catch(e) { return res.status(500).json({ error: '存档数据解析失败' }); }

    // 确保 characters 字段存在
    if (!saveData.characters) saveData.characters = {};

    const appConfig = getAppConfig();
    // 系统消息用 system role，不显示为玩家消息
    const isSystemMsg = userMessage.startsWith('[系统]');
    saveData.chatHistory.push({ role: isSystemMsg ? 'system' : 'user', content: userMessage, timestamp: new Date().toISOString() });
    saveData.stats.turnCount++;

    const systemPrompt = buildSystemPrompt(saveData, appConfig);
    const history = buildMessageHistory(saveData.chatHistory);
    const messages = [{ role: 'system', content: systemPrompt }, ...history];

    const MAX_TOOL_CALL_LOOPS = 5; // 增加到5轮以支持角色AI嵌套调用
    const MAX_RETRIES = 2;
    const RETRY_DELAY = 1000;
    const API_TIMEOUT = 90000; // 角色AI嵌套调用需要更长超时
    const apiBaseUrl = getApiBaseUrl();
    const model = getModel();
    const allNotifications = [];

    let loopCount = 0;
    while (loopCount < MAX_TOOL_CALL_LOOPS) {
        loopCount++;

        // 请求 AI（含重试）
        let response;
        let retries = 0;
        while (true) {
            try {
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), API_TIMEOUT);
                response = await fetch(apiBaseUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                    body: JSON.stringify({ model, messages, tools: gameTools, temperature: appConfig.temperature, max_tokens: appConfig.maxTokens, stream: true }),
                    signal: controller.signal,
                });
                clearTimeout(timer);
                break;
            } catch(err) {
                retries++;
                if (retries >= MAX_RETRIES) {
                    await persistSave(saveData, saveId);
                    return res.status(500).json({ error: 'AI 请求失败: ' + (err.message || '未知错误') });
                }
                await new Promise(r => setTimeout(r, RETRY_DELAY * retries));
            }
        }

        if (!response.ok) {
            const errText = await response.text().catch(() => '');
            await persistSave(saveData, saveId);
            return res.status(response.status).json({ error: errText });
        }

        // 解析流式响应
        let result;
        try {
            result = await parseStreamResponse(response);
        } catch(err) {
            try {
                result = await parseNonStreamResponse(apiBaseUrl, apiKey, model, messages, gameTools, appConfig);
            } catch(fallbackErr) {
                await persistSave(saveData, saveId);
                return res.status(500).json({ error: '响应解析失败' });
            }
        }

        const assistantMsg = { role: 'assistant', content: result.content };
        if (result.tool_calls) assistantMsg.tool_calls = result.tool_calls;
        messages.push(assistantMsg);

        // 处理 tool calls
        if (result.tool_calls && result.tool_calls.length > 0) {
            for (const tc of result.tool_calls) {
                const fnName = tc.function.name;
                let fnArgs;
                try { fnArgs = JSON.parse(tc.function.arguments); } catch(e) { fnArgs = {}; }

                let toolResult;

                if (fnName === 'get_character_reaction') {
                    // ★ 核心：调用角色AI代理获取角色反应
                    toolResult = await handleGetCharacterReaction(fnArgs, saveData, apiKey, apiBaseUrl, model, appConfig);
                } else {
                    // 其他工具正常执行
                    toolResult = executeGameFunction(fnName, fnArgs, saveData);
                }

                if (toolResult.notifications) allNotifications.push(...toolResult.notifications);
                messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(toolResult) });
            }
            continue;
        }
        break;
    }

    // 解析 GM 最终输出（期望是结构化 JSON）
    const lastAssistantMsg = messages[messages.length - 1];
    const rawContent = lastAssistantMsg?.content || '';
    let structuredOutput = parseGMOutput(rawContent);

    // 保存到 chatHistory
    saveData.chatHistory.push({ role: 'assistant', content: rawContent, structured: structuredOutput, timestamp: new Date().toISOString() });

    // 持久化存档
    await persistSave(saveData, saveId);

    // 返回结构化结果
    res.json({
        content: structuredOutput.content || [{ type: 'narrative', text: rawContent }],
        options: structuredOutput.options || [],
        notifications: allNotifications,
        saveData,
    });
});

// ===================================================================
// ===== 角色AI代理处理（get_character_reaction 的核心逻辑） =====
// ===================================================================
async function handleGetCharacterReaction(args, saveData, apiKey, apiBaseUrl, model, appConfig) {
    const charName = args.character_name;
    const context = args.context || '';

    if (!saveData.characters) return { success: false, error: '当前没有重要角色' };

    const character = Object.values(saveData.characters).find(c => c.name === charName);
    if (!character) return { success: false, error: `未找到角色"${charName}"` };

    character.lastInteractedAt = new Date().toISOString();

    // 构建角色 Prompt
    const charPrompt = buildCharacterPrompt(character, saveData);
    const charMessages = [
        { role: 'system', content: charPrompt },
        { role: 'user', content: `情境：${context}\n\n请给出你的反应和回应。` },
    ];

    // 请求角色AI（含重试）
    let response;
    let retries = 0;
    const MAX_RETRIES = 2;
    const API_TIMEOUT = 60000;

    while (true) {
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), API_TIMEOUT);
            response = await fetch(apiBaseUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                body: JSON.stringify({
                    model, messages: charMessages, tools: characterTools,
                    temperature: Math.max(0.6, appConfig.temperature - 0.2), // 角色AI温度略低，保持人设一致
                    max_tokens: 1024, stream: true,
                }),
                signal: controller.signal,
            });
            clearTimeout(timer);
            break;
        } catch(err) {
            retries++;
            if (retries >= MAX_RETRIES) return { success: false, error: '角色AI请求失败' };
            await new Promise(r => setTimeout(r, 1000 * retries));
        }
    }

    if (!response.ok) {
        const errText = await response.text().catch(() => '');
        return { success: false, error: `角色AI错误: ${errText}` };
    }

    // 解析角色AI响应
    let result;
    try {
        result = await parseStreamResponse(response);
    } catch(err) {
        try {
            result = await parseNonStreamResponse(apiBaseUrl, apiKey, model, charMessages, characterTools, { temperature: 0.7, max_tokens: 1024 });
        } catch(e) {
            return { success: false, error: '角色AI响应解析失败' };
        }
    }

    // 处理角色AI的 tool calls（update_relationship, add_memory）
    if (result.tool_calls && result.tool_calls.length > 0) {
        for (const tc of result.tool_calls) {
            let fnArgs;
            try { fnArgs = JSON.parse(tc.function.arguments); } catch(e) { fnArgs = {}; }
            executeCharacterTool(tc.function.name, fnArgs, character, saveData);
        }
    }

    // 解析角色AI返回的 JSON
    let charReaction = { reaction: '', dialogue: '', mood: 'neutral' };
    try {
        // 尝试从 content 中提取 JSON
        const jsonMatch = result.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            charReaction = { ...charReaction, ...JSON.parse(jsonMatch[0]) };
        }
    } catch(e) {
        // JSON 解析失败，将整个 content 作为 dialogue
        charReaction.dialogue = result.content;
    }

    return {
        success: true,
        characterId: character.id,
        characterName: character.name,
        reaction: charReaction.reaction || '',
        dialogue: charReaction.dialogue || '',
        mood: charReaction.mood || 'neutral',
        relationship_value: character.relationship.value,
        relationship_title: character.relationship.title,
    };
}

/**
 * 解析 GM 的 JSON 输出，容错处理
 */
function parseGMOutput(rawContent) {
    // 尝试直接解析
    try {
        const parsed = JSON.parse(rawContent);
        if (parsed.content && Array.isArray(parsed.content)) {
            return {
                content: parsed.content,
                options: parsed.options || [],
            };
        }
    } catch(e) {}

    // 尝试从文本中提取 JSON 块
    const jsonMatch = rawContent.match(/\{[\s\S]*"content"[\s\S]*\}/);
    if (jsonMatch) {
        try {
            const parsed = JSON.parse(jsonMatch[0]);
            if (parsed.content && Array.isArray(parsed.content)) {
                return { content: parsed.content, options: parsed.options || [] };
            }
        } catch(e) {}
    }

    // JSON 解析失败，降级为纯文本叙述
    return {
        content: [{ type: 'narrative', text: rawContent }],
        options: [],
    };
}

// ===================================================================
// ===== GET /api/game/characters — 获取角色列表 =====
// ===================================================================
router.get('/characters', (req, res) => {
    const { saveId } = req.query;
    if (!saveId) return res.status(400).json({ error: '缺少 saveId' });

    const row = db.prepare('SELECT data FROM saves WHERE id = ?').get(saveId);
    if (!row) return res.status(404).json({ error: '存档不存在' });

    let saveData;
    try { saveData = JSON.parse(row.data); } catch(e) { return res.status(500).json({ error: '存档解析失败' }); }

    const characters = saveData.characters || {};
    const list = Object.values(characters).map(c => ({
        id: c.id, name: c.name, role: c.role,
        relationship: c.relationship,
        location: c.location, status: c.status,
        memoriesCount: c.memories ? c.memories.length : 0,
        lastInteractedAt: c.lastInteractedAt,
    }));

    res.json(list);
});

// ===================================================================
// ===== GET /api/game/characters/:id — 获取角色详情 =====
// ===================================================================
router.get('/characters/:id', (req, res) => {
    const { saveId } = req.query;
    if (!saveId) return res.status(400).json({ error: '缺少 saveId' });

    const row = db.prepare('SELECT data FROM saves WHERE id = ?').get(saveId);
    if (!row) return res.status(404).json({ error: '存档不存在' });

    let saveData;
    try { saveData = JSON.parse(row.data); } catch(e) { return res.status(500).json({ error: '存档解析失败' }); }

    const character = (saveData.characters || {})[req.params.id];
    if (!character) return res.status(404).json({ error: '角色不存在' });

    res.json(character);
});

// ===================================================================
// ===== POST /api/game/create — 创建新游戏 =====
// ===================================================================
const BUILTIN_TEMPLATES = [
    {
        id: 'tpl_sword_magic', name: '剑与魔法', genre: '奇幻', icon: '⚔️', description: '标准奇幻设定，适合初次体验',
        world: { name: '艾泽利亚', genre: '奇幻', description: '一个充满魔法与剑的大陆，古老的龙族沉睡在山脉之下，精灵守护着古老的森林，人类王国在平原上繁荣发展。暗影势力正在北方蠢蠢欲动...', rules: '魔法分为元素系（火、水、风、土）、暗影系和神圣系三大体系。战士、法师、游侠、牧师是常见的职业。', tone: '史诗' },
        starterItems: [
            { name: '生锈的铁剑', type: 'weapon', description: '一把老旧但还能用的铁剑', quantity: 1, effects: { attack: 3 }, rarity: 'common' },
            { name: '治疗药水', type: 'consumable', description: '恢复30点生命值', quantity: 3, effects: { hp: 30 }, rarity: 'common' },
            { name: '皮甲', type: 'armor', description: '简单的皮制护甲', quantity: 1, effects: { defense: 2 }, rarity: 'common' },
        ],
        starterLocation: '边境小镇', starterLocationDesc: '一座位于王国边境的小镇，是冒险者们的起点。镇上有酒馆、铁匠铺和杂货店。', starterGold: 50,
    },
    {
        id: 'tpl_star_trek', name: '星际迷途', genre: '科幻', icon: '🚀', description: '太空探索，与外星文明接触',
        world: { name: '银河联邦', genre: '科幻', description: '公元3247年，人类已建立横跨银河的联邦文明。你是联邦探索舰"曙光号"的舰长，在一次超空间跳跃事故后，舰队被困在了未知星域...', rules: '科技水平高度发达，拥有超光速航行、能量护盾、等离子武器。外星文明分为碳基和硅基两大类。', tone: '严肃' },
        starterItems: [
            { name: '标准激光手枪', type: 'weapon', description: '联邦制式激光手枪', quantity: 1, effects: { attack: 5 }, rarity: 'common' },
            { name: '纳米修复包', type: 'consumable', description: '恢复40点生命值', quantity: 2, effects: { hp: 40 }, rarity: 'common' },
            { name: '通用翻译器', type: 'misc', description: '可以翻译大多数已知语言', quantity: 1, rarity: 'uncommon' },
        ],
        starterLocation: '空间站Alpha-7', starterLocationDesc: '一座废弃的空间站，闪烁的应急灯照亮了锈迹斑斑的走廊。控制室似乎还有部分系统在运行。', starterGold: 100,
    },
    {
        id: 'tpl_wuxia', name: '江湖风云', genre: '武侠', icon: '🏯', description: '快意恩仇的武侠世界',
        world: { name: '中原武林', genre: '武侠', description: '天下大势，分久必合。江湖中正邪两道对峙百年，如今一本失传的武功秘籍重现人间，各方势力蠢蠢欲动。你是一名初入江湖的少侠...', rules: '武功分为内功、外功、轻功三大类。门派有少林、武当、峨眉、丐帮、魔教等。江湖中有"侠义道"和"魔道"之分。', tone: '史诗' },
        starterItems: [
            { name: '精钢长剑', type: 'weapon', description: '一把锋利的精钢长剑', quantity: 1, effects: { attack: 4 }, rarity: 'common' },
            { name: '金创药', type: 'consumable', description: '恢复25点生命值', quantity: 5, effects: { hp: 25 }, rarity: 'common' },
            { name: '银两', type: 'misc', description: '江湖通用货币', quantity: 30, rarity: 'common' },
        ],
        starterLocation: '洛阳城', starterLocationDesc: '天下第一城洛阳，繁华热闹。城中有武林盟的分舵，各路英雄豪杰在此汇聚。', starterGold: 30,
    },
    {
        id: 'tpl_apocalypse', name: '末日求生', genre: '末日', icon: '☢️', description: '后启示录生存挑战',
        world: { name: '废土', genre: '末日', description: '核战之后的废土世界，文明已经崩塌。幸存者在废墟中艰难求生，变异生物横行，资源极度匮乏。你从一座地下避难所中醒来...', rules: '辐射无处不在，需要盖革计数器监测。物资极度稀缺，以物易物是主要交易方式。变异生物具有不同的弱点。', tone: '黑暗' },
        starterItems: [
            { name: '自制匕首', type: 'weapon', description: '用废铁打磨的匕首', quantity: 1, effects: { attack: 2 }, rarity: 'common' },
            { name: '脏水', type: 'consumable', description: '恢复10点生命值，有概率生病', quantity: 3, effects: { hp: 10 }, rarity: 'common' },
            { name: '防毒面具', type: 'armor', description: '过滤部分辐射尘埃', quantity: 1, effects: { defense: 1 }, rarity: 'uncommon' },
        ],
        starterLocation: '避难所', starterLocationDesc: '一座破旧的地下避难所，应急灯忽明忽暗。储物柜里还有一些残余物资，大门通向未知的废土。', starterGold: 0,
    },
];

// ===================================================================
// ===== POST /api/game/autofill — AI 自动补全角色和世界信息 =====
// ===================================================================
router.post('/autofill', async (req, res) => {
    const { worldName, genre, worldDesc, worldRules, tone, startLocation, startLocationDesc, playerName, playerRace, playerClass, playerAppearance, playerPersonality, playerBackstory, templateId } = req.body;

    const apiKey = getApiKey();
    const apiBaseUrl = getApiBaseUrl();
    const model = getModel();

    if (!apiKey) {
        return res.status(400).json({ error: '请先在设置中配置 API Key' });
    }

    // 构建需要补全的字段列表
    const missing = [];
    if (!playerName) missing.push('playerName');
    if (!playerRace) missing.push('playerRace');
    if (!playerClass) missing.push('playerClass');
    if (!playerAppearance) missing.push('playerAppearance');
    if (!playerPersonality) missing.push('playerPersonality');
    if (!playerBackstory) missing.push('playerBackstory');
    if (!worldName) missing.push('worldName');
    if (!worldDesc) missing.push('worldDesc');
    if (!worldRules) missing.push('worldRules');
    if (!startLocation) missing.push('startLocation');
    if (!startLocationDesc) missing.push('startLocationDesc');

    if (missing.length === 0) {
        return res.json({ success: true, filled: {}, message: '所有字段已填写完整' });
    }

    // 如果选了模板，获取模板信息作为参考
    let templateInfo = '';
    if (templateId && templateId !== 'custom') {
        const tpl = BUILTIN_TEMPLATES.find(t => t.id === templateId);
        if (tpl) {
            templateInfo = `\n参考模板：${tpl.name}（${tpl.genre}）\n模板世界：${tpl.world.name}\n模板描述：${tpl.world.description?.slice(0, 200)}`;
        }
    }

    const prompt = `你是一个 RPG 游戏的角色创建助手。请根据用户已提供的信息，为缺失的字段生成合适的内容。

## 已提供的信息
- 世界名称：${worldName || '未填写'}
- 世界类型：${genre || '未填写'}
- 世界描述：${worldDesc || '未填写'}
- 世界规则：${worldRules || '未填写'}
- 叙事基调：${tone || '未填写'}
- 起始地点：${startLocation || '未填写'}
- 起始地点描述：${startLocationDesc || '未填写'}
- 角色名称：${playerName || '未填写'}
- 种族：${playerRace || '未填写'}
- 职业：${playerClass || '未填写'}
- 外貌：${playerAppearance || '未填写'}
- 性格：${playerPersonality || '未填写'}
- 背景故事：${playerBackstory || '未填写'}
${templateInfo}

## 需要补全的字段
${missing.join('、')}

## 要求
1. 只返回 JSON，不要输出任何其他内容
2. 只包含需要补全的字段，已填写的不要返回
3. 每个字段的内容要简短精炼（角色名2-4字，种族/职业1-4字，外貌30字内，性格20字内，背景故事50字内，世界名2-6字，世界描述100字内，世界规则100字内，起始地点2-6字，起始地点描述80字内）
4. 内容要与已填写的信息保持一致和协调
5. 返回格式：{"playerName":"xxx","playerRace":"xxx",...}

请直接返回 JSON：`;

    try {
        // apiBaseUrl 可能是完整端点或基础URL，统一处理
        const endpoint = apiBaseUrl.includes('/chat/completions') ? apiBaseUrl : `${apiBaseUrl}/chat/completions`;
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
            body: JSON.stringify({
                model,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.8,
                max_tokens: 500,
            }),
        });

        if (!response.ok) {
            return res.status(500).json({ error: 'AI 请求失败: ' + response.status });
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || '';

        // 解析 JSON
        let filled = {};
        try {
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) filled = JSON.parse(jsonMatch[0]);
        } catch(e) {}

        res.json({ success: true, filled, message: `已补全 ${Object.keys(filled).length} 个字段` });
    } catch(err) {
        res.status(500).json({ error: 'AI 补全失败: ' + err.message });
    }
});

router.post('/create', (req, res) => {
    const { saveName, worldName, genre, worldDesc, worldRules, customPrompt, tone, startLocation, startLocationDesc, playerName, playerRace, playerClass, playerAppearance, playerPersonality, playerBackstory, startGold, templateId } = req.body;

    let playerDesc = '';
    if (playerRace) playerDesc += `种族：${playerRace}。`;
    if (playerClass) playerDesc += `职业：${playerClass}。`;
    if (playerAppearance) playerDesc += `外貌：${playerAppearance}。`;
    if (playerPersonality) playerDesc += `性格：${playerPersonality}。`;
    if (playerBackstory) playerDesc += `背景：${playerBackstory}`;

    let starterItems = [], starterGold = parseInt(startGold) || 0;
    let effectiveWorldName = worldName || '未知世界', effectiveGenre = genre || '自定义';
    let effectiveWorldDesc = worldDesc || '一个未知的世界', effectiveWorldRules = worldRules || '';
    let effectiveTone = tone || '史诗';
    let effectiveStartLocation = startLocation || '起始之地';
    let effectiveStartLocationDesc = startLocationDesc || '你站在这片陌生土地的起点。';

    if (templateId && templateId !== 'custom') {
        const tpl = BUILTIN_TEMPLATES.find(t => t.id === templateId);
        if (tpl) {
            starterItems = tpl.starterItems || [];
            starterGold = tpl.starterGold !== undefined ? tpl.starterGold : starterGold;
            effectiveWorldName = tpl.world.name; effectiveGenre = tpl.world.genre;
            effectiveWorldDesc = tpl.world.description; effectiveWorldRules = tpl.world.rules || '';
            effectiveTone = tpl.world.tone;
            effectiveStartLocation = tpl.starterLocation; effectiveStartLocationDesc = tpl.starterLocationDesc;
        }
    }

    const id = 'save_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    const now = new Date().toISOString();

    const saveData = {
        id, name: saveName || '未命名的冒险', version: '1.0',
        world: { name: effectiveWorldName, genre: effectiveGenre, description: effectiveWorldDesc, rules: effectiveWorldRules, tone: effectiveTone, customPrompt: customPrompt || '' },
        player: { name: playerName || '旅行者', description: playerDesc, level: 1, experience: 0, experienceToNext: 100, attributes: { hp: { current: 100, max: 100, label: '生命值' }, mp: { current: 50, max: 50, label: '魔力值' }, attack: { current: 10, max: 10, label: '攻击力' }, defense: { current: 5, max: 5, label: '防御力' }, agility: { current: 7, max: 7, label: '敏捷' }, luck: { current: 3, max: 3, label: '幸运' } }, statusEffects: [] },
        inventory: { items: starterItems.map((item, i) => ({ id: 'item_' + Date.now() + '_' + i, name: item.name, type: item.type, description: item.description || '', quantity: item.quantity || 1, effects: item.effects || {}, rarity: item.rarity || 'common', usable: item.usable || false, equippable: item.equippable || false, equipped: false })), gold: starterGold, maxSlots: 20 },
        map: { currentLocation: effectiveStartLocation, locations: { [effectiveStartLocation]: { description: effectiveStartLocationDesc, connections: [], npcs: [], discovered: true, dangerLevel: 0 } } },
        characters: {}, // 角色系统初始化为空
        chatHistory: [],
        stats: { turnCount: 0, playTime: 0, monstersDefeated: 0, itemsCollected: 0, locationsDiscovered: 1, deaths: 0 },
        eventLog: [{ turn: 1, type: 'system', text: '冒险开始' }],
        meta: { createdAt: now, lastSavedAt: now, version: '1.0' },
    };

    db.prepare(`INSERT INTO saves (id, name, data, world_name, world_genre, player_name, player_level, current_location, turn_count, play_time, pinned, archived, created_at, last_saved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, ?, ?)`)
        .run(id, saveData.name, JSON.stringify(saveData), effectiveWorldName, effectiveGenre, saveData.player.name, 1, effectiveStartLocation, now, now);

    res.json({ success: true, id, saveData });
});

router.get('/templates', (req, res) => { res.json(BUILTIN_TEMPLATES); });

// ===================================================================
// ===== POST /api/game/templates/import — 导入世界模板卡片 =====
// ===================================================================
router.post('/templates/import', (req, res) => {
    const template = req.body;
    if (!template || !template.name || !template.world) {
        return res.status(400).json({ error: '无效的世界模板：缺少 name 或 world 字段' });
    }

    // 验证必要字段
    if (!template.world.name || !template.world.description) {
        return res.status(400).json({ error: '无效的世界模板：world 中缺少 name 或 description' });
    }

    // 生成唯一 ID（如果是导入的模板）
    const id = template.id || ('custom_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6));

    const importedTemplate = {
        id,
        name: template.name,
        genre: template.world.genre || '自定义',
        icon: template.icon || '✨',
        description: template.world.description.slice(0, 80),
        world: {
            name: template.world.name,
            genre: template.world.genre || '自定义',
            description: template.world.description,
            rules: template.world.rules || '',
            tone: template.world.tone || '史诗',
            customPrompt: template.world.customPrompt || '',
        },
        starterItems: Array.isArray(template.starterItems) ? template.starterItems : [],
        starterLocation: template.starterLocation || '起始之地',
        starterLocationDesc: template.starterLocationDesc || '你站在这片陌生土地的起点。',
        starterGold: template.starterGold || 0,
        _imported: true, // 标记为导入模板
    };

    res.json({ success: true, template: importedTemplate });
});

// ===================================================================
// ===== GET /api/game/templates/export/:saveId — 从存档导出世界模板 =====
// ===================================================================
router.get('/templates/export/:saveId', (req, res) => {
    const { saveId } = req.params;
    const row = db.prepare('SELECT data FROM saves WHERE id = ?').get(saveId);
    if (!row) return res.status(404).json({ error: '存档不存在' });

    let saveData;
    try { saveData = JSON.parse(row.data); } catch(e) { return res.status(500).json({ error: '存档解析失败' }); }

    const world = saveData.world || {};
    const template = {
        id: 'world_' + Date.now(),
        name: saveData.name || world.name || '未命名世界',
        genre: world.genre || '自定义',
        icon: { '奇幻': '⚔️', '科幻': '🚀', '武侠': '🏯', '末日': '☢️' }[world.genre] || '✨',
        description: world.description || '',
        world: {
            name: world.name || '',
            genre: world.genre || '',
            description: world.description || '',
            rules: world.rules || '',
            tone: world.tone || '',
            customPrompt: world.customPrompt || '',
        },
        starterLocation: saveData.map?.currentLocation || '',
        starterLocationDesc: '',
        starterGold: saveData.inventory?.gold || 0,
        starterItems: [],
        _exportedFrom: saveData.name,
        _exportedAt: new Date().toISOString(),
    };

    // 尝试获取起始地点描述
    const startLoc = saveData.map?.locations?.[template.starterLocation];
    if (startLoc) template.starterLocationDesc = startLoc.description || '';

    res.json(template);
});

router.post('/drop-item', async (req, res) => {
    const { saveId, itemId } = req.body;
    if (!saveId || !itemId) return res.status(400).json({ error: '缺少参数' });
    const row = db.prepare('SELECT data FROM saves WHERE id = ?').get(saveId);
    if (!row) return res.status(404).json({ error: '存档不存在' });
    const saveData = JSON.parse(row.data);
    const itemIdx = saveData.inventory.items.findIndex(i => i.id === itemId);
    if (itemIdx === -1) return res.status(400).json({ error: '物品不存在' });
    const item = saveData.inventory.items[itemIdx];
    saveData.inventory.items.splice(itemIdx, 1);
    await persistSave(saveData, saveId);
    res.json({ success: true, droppedItem: item.name, saveData });
});

// ===== 存档操作补全接口 =====
router.patch('/:id/rename', (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: '名称不能为空' });
    const existing = db.prepare('SELECT id, data FROM saves WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: '存档不存在' });
    db.prepare("UPDATE saves SET name = ?, last_saved_at = ? WHERE id = ?").run(name, new Date().toISOString(), req.params.id);
    try { const sd = JSON.parse(existing.data); sd.name = name; db.prepare("UPDATE saves SET data = ? WHERE id = ?").run(JSON.stringify(sd), req.params.id); } catch(e) {}
    res.json({ success: true });
});

router.patch('/:id/pin', (req, res) => {
    const existing = db.prepare('SELECT pinned FROM saves WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: '存档不存在' });
    const newPinned = existing.pinned ? 0 : 1;
    db.prepare("UPDATE saves SET pinned = ?, last_saved_at = ? WHERE id = ?").run(newPinned, new Date().toISOString(), req.params.id);
    res.json({ success: true, pinned: !!newPinned });
});

router.patch('/:id/archive', (req, res) => {
    const existing = db.prepare('SELECT archived FROM saves WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: '存档不存在' });
    const newArchived = existing.archived ? 0 : 1;
    db.prepare("UPDATE saves SET archived = ?, last_saved_at = ? WHERE id = ?").run(newArchived, new Date().toISOString(), req.params.id);
    res.json({ success: true, archived: !!newArchived });
});

router.post('/:id/duplicate', (req, res) => {
    const existing = db.prepare('SELECT * FROM saves WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: '存档不存在' });
    const newId = 'save_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    const now = new Date().toISOString();
    const newName = (existing.name || '未命名') + ' (副本)';
    let newData;
    try { newData = JSON.parse(existing.data); newData.id = newId; newData.name = newName; if (newData.meta) { newData.meta.createdAt = now; newData.meta.lastSavedAt = now; } } catch(e) { newData = existing.data; }
    db.prepare(`INSERT INTO saves (id, name, data, world_name, world_genre, player_name, player_level, current_location, turn_count, play_time, pinned, archived, created_at, last_saved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)`)
        .run(newId, newName, JSON.stringify(newData), existing.world_name, existing.world_genre, existing.player_name, existing.player_level, existing.current_location, existing.turn_count, existing.play_time, now, now);
    res.json({ success: true, id: newId, name: newName });
});

// ===================================================================
// ===== 辅助函数 =====
// ===================================================================
async function persistSave(saveData, saveId) {
    const now = new Date().toISOString();
    saveData.meta.lastSavedAt = now;
    db.prepare(`UPDATE saves SET data = ?, name = COALESCE(?, name), world_name = ?, world_genre = ?, player_name = ?, player_level = ?, current_location = ?, turn_count = ?, play_time = ?, last_saved_at = ? WHERE id = ?`)
        .run(JSON.stringify(saveData), saveData.name || null, saveData.world?.name || '', saveData.world?.genre || '', saveData.player?.name || '', saveData.player?.level || 1, saveData.map?.currentLocation || '', saveData.stats?.turnCount || 0, saveData.stats?.playTime || 0, now, saveId);
}

async function parseStreamResponse(response) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '', content = '', toolCalls = [], currentToolCallIndex = -1;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const events = buffer.split('\n\n');
            buffer = events.pop() || '';
            for (const event of events) {
                for (const line of event.split('\n')) {
                    const trimmed = line.trim();
                    if (!trimmed || !trimmed.startsWith('data: ')) continue;
                    const data = trimmed.slice(6);
                    if (data === '[DONE]') continue;
                    try {
                        const parsed = JSON.parse(data);
                        const delta = parsed.choices?.[0]?.delta;
                        if (!delta) continue;
                        if (delta.content) content += delta.content;
                        if (delta.tool_calls) {
                            for (const tc of delta.tool_calls) {
                                if (tc.index !== undefined && tc.index !== currentToolCallIndex) {
                                    currentToolCallIndex = tc.index;
                                    toolCalls.push({ id: tc.id || ('call_' + Date.now() + '_' + tc.index), type: 'function', function: { name: tc.function?.name || '', arguments: '' } });
                                }
                                if (tc.id) toolCalls[currentToolCallIndex].id = tc.id;
                                if (tc.function?.name) toolCalls[currentToolCallIndex].function.name = tc.function.name;
                                if (tc.function?.arguments) toolCalls[currentToolCallIndex].function.arguments += tc.function.arguments;
                            }
                        }
                    } catch(e) {}
                }
            }
        }
    } finally { reader.releaseLock(); }
    return { content, tool_calls: toolCalls.length > 0 ? toolCalls : null };
}

async function parseNonStreamResponse(apiBaseUrl, apiKey, model, messages, tools, appConfig) {
    const response = await fetch(apiBaseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages, tools: tools || undefined, temperature: appConfig.temperature, max_tokens: appConfig.maxTokens, stream: false }),
    });
    if (!response.ok) { const errText = await response.text(); throw new Error(`AI 请求失败 (${response.status}): ${errText}`); }
    const data = await response.json();
    const choice = data.choices?.[0];
    if (!choice) throw new Error('AI 返回了空响应');
    return { content: choice.message?.content || '', tool_calls: choice.message?.tool_calls || null };
}

module.exports = router;
