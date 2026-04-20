// ===================================================================
// ===== 游戏路由（统一游戏动作、新游戏创建、存档操作） =====
// ===================================================================

const express = require('express');
const router = express.Router();
const db = require('../db');
const { buildSystemPrompt, buildMessageHistory, gameTools } = require('../aiService');
const { executeGameFunction } = require('../gameEngine');

// ----- 配置读取辅助 -----
function getConfigValue(key, defaultValue) {
    const row = db.prepare("SELECT value FROM config WHERE key = ?").get(key);
    if (!row) return defaultValue;
    try { return JSON.parse(row.value); } catch(e) { return row.value; }
}

function getApiKey() {
    return getConfigValue('apiKey', '');
}

function getApiBaseUrl() {
    return getConfigValue('apiBaseUrl', 'https://api.deepseek.com/v1/chat/completions');
}

function getModel() {
    return getConfigValue('model', 'deepseek-chat');
}

function getAppConfig() {
    return {
        temperature: getConfigValue('temperature', 0.9),
        maxTokens: getConfigValue('maxTokens', 1024),
        ui: getConfigValue('ui', { fontSize: 'medium', narrativeLength: 'medium' }),
        customInstructions: getConfigValue('customInstructions', ''),
    };
}

// ===================================================================
// ===== POST /api/game/action — 统一游戏动作（核心接口） =====
// ===================================================================
router.post('/action', async (req, res) => {
    const { saveId, userMessage } = req.body;

    if (!saveId || !userMessage) {
        return res.status(400).json({ error: '缺少 saveId 或 userMessage' });
    }

    const apiKey = getApiKey();
    if (!apiKey) {
        return res.status(400).json({ error: '未配置 API Key，请在设置中配置' });
    }

    // 加载存档
    const row = db.prepare('SELECT data FROM saves WHERE id = ?').get(saveId);
    if (!row) return res.status(404).json({ error: '存档不存在' });

    let saveData;
    try {
        saveData = JSON.parse(row.data);
    } catch(e) {
        return res.status(500).json({ error: '存档数据解析失败' });
    }

    const appConfig = getAppConfig();

    // 添加用户消息到历史
    saveData.chatHistory.push({ role: 'user', content: userMessage });
    saveData.stats.turnCount++;

    // 构建 system prompt 和消息历史
    const systemPrompt = buildSystemPrompt(saveData, appConfig);
    const history = buildMessageHistory(saveData.chatHistory);
    const messages = [
        { role: 'system', content: systemPrompt },
        ...history,
    ];

    const MAX_TOOL_CALL_LOOPS = 3;
    const MAX_RETRIES = 2;
    const RETRY_DELAY = 1000;
    const API_TIMEOUT = 60000;
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
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiKey}`,
                    },
                    body: JSON.stringify({
                        model,
                        messages,
                        tools: gameTools,
                        temperature: appConfig.temperature,
                        max_tokens: appConfig.maxTokens,
                        stream: true,
                    }),
                    signal: controller.signal,
                });
                clearTimeout(timer);
                break;
            } catch(err) {
                retries++;
                if (retries >= MAX_RETRIES) {
                    // 保存当前状态并返回错误
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
            // 流式解析失败，尝试非流式
            try {
                result = await parseNonStreamResponse(apiBaseUrl, apiKey, model, messages, gameTools, appConfig);
            } catch(fallbackErr) {
                await persistSave(saveData, saveId);
                return res.status(500).json({ error: '响应解析失败' });
            }
        }

        // 记录 assistant 消息
        const assistantMsg = { role: 'assistant', content: result.content };
        if (result.tool_calls) {
            assistantMsg.tool_calls = result.tool_calls;
        }
        messages.push(assistantMsg);

        // 处理 tool calls
        if (result.tool_calls && result.tool_calls.length > 0) {
            for (const tc of result.tool_calls) {
                const fnName = tc.function.name;
                let fnArgs;
                try { fnArgs = JSON.parse(tc.function.arguments); } catch(e) { fnArgs = {}; }

                const toolResult = executeGameFunction(fnName, fnArgs, saveData);

                // 收集通知
                if (toolResult.notifications) {
                    allNotifications.push(...toolResult.notifications);
                }

                messages.push({
                    role: 'tool',
                    tool_call_id: tc.id,
                    content: JSON.stringify(toolResult),
                });
            }
            continue;
        }

        // 没有更多 tool calls，结束循环
        break;
    }

    // 保存最终 AI 内容到 chatHistory
    const lastAssistantMsg = messages[messages.length - 1];
    if (lastAssistantMsg && lastAssistantMsg.role === 'assistant' && lastAssistantMsg.content) {
        // 更新或添加 assistant 消息到 chatHistory
        const last = saveData.chatHistory[saveData.chatHistory.length - 1];
        if (last && last.role === 'assistant') {
            last.content = lastAssistantMsg.content;
        } else {
            saveData.chatHistory.push({ role: 'assistant', content: lastAssistantMsg.content });
        }
    }

    // 持久化存档
    await persistSave(saveData, saveId);

    // 返回结果给前端
    res.json({
        narrative: lastAssistantMsg?.content || '',
        notifications: allNotifications,
        saveData: saveData, // 返回更新后的完整存档数据，前端用于刷新 UI
    });
});

// ===================================================================
// ===== POST /api/game/create — 创建新游戏 =====
// ===================================================================
const BUILTIN_TEMPLATES = [
    {
        id: 'tpl_sword_magic', name: '剑与魔法', genre: '奇幻', icon: '⚔️',
        description: '标准奇幻设定，适合初次体验',
        world: {
            name: '艾泽利亚', genre: '奇幻',
            description: '一个充满魔法与剑的大陆，古老的龙族沉睡在山脉之下，精灵守护着古老的森林，人类王国在平原上繁荣发展。暗影势力正在北方蠢蠢欲动...',
            rules: '魔法分为元素系（火、水、风、土）、暗影系和神圣系三大体系。战士、法师、游侠、牧师是常见的职业。',
            tone: '史诗',
        },
        starterItems: [
            { name: '生锈的铁剑', type: 'weapon', description: '一把老旧但还能用的铁剑', quantity: 1, effects: { attack: 3 }, rarity: 'common', usable: false },
            { name: '治疗药水', type: 'consumable', description: '恢复30点生命值', quantity: 3, effects: { hp: 30 }, rarity: 'common', usable: true },
            { name: '皮甲', type: 'armor', description: '简单的皮制护甲', quantity: 1, effects: { defense: 2 }, rarity: 'common', usable: false },
        ],
        starterLocation: '边境小镇',
        starterLocationDesc: '一座位于王国边境的小镇，是冒险者们的起点。镇上有酒馆、铁匠铺和杂货店。',
        starterGold: 50,
    },
    {
        id: 'tpl_star_trek', name: '星际迷途', genre: '科幻', icon: '🚀',
        description: '太空探索，与外星文明接触',
        world: {
            name: '银河联邦', genre: '科幻',
            description: '公元3247年，人类已建立横跨银河的联邦文明。你是联邦探索舰"曙光号"的舰长，在一次超空间跳跃事故后，舰队被困在了未知星域...',
            rules: '科技水平高度发达，拥有超光速航行、能量护盾、等离子武器。外星文明分为碳基和硅基两大类。',
            tone: '严肃',
        },
        starterItems: [
            { name: '标准激光手枪', type: 'weapon', description: '联邦制式激光手枪', quantity: 1, effects: { attack: 5 }, rarity: 'common', usable: false },
            { name: '纳米修复包', type: 'consumable', description: '恢复40点生命值', quantity: 2, effects: { hp: 40 }, rarity: 'common', usable: true },
            { name: '通用翻译器', type: 'misc', description: '可以翻译大多数已知语言', quantity: 1, rarity: 'uncommon', usable: false },
        ],
        starterLocation: '空间站Alpha-7',
        starterLocationDesc: '一座废弃的空间站，闪烁的应急灯照亮了锈迹斑斑的走廊。控制室似乎还有部分系统在运行。',
        starterGold: 100,
    },
    {
        id: 'tpl_wuxia', name: '江湖风云', genre: '武侠', icon: '🏯',
        description: '快意恩仇的武侠世界',
        world: {
            name: '中原武林', genre: '武侠',
            description: '天下大势，分久必合。江湖中正邪两道对峙百年，如今一本失传的武功秘籍重现人间，各方势力蠢蠢欲动。你是一名初入江湖的少侠...',
            rules: '武功分为内功、外功、轻功三大类。门派有少林、武当、峨眉、丐帮、魔教等。江湖中有"侠义道"和"魔道"之分。',
            tone: '史诗',
        },
        starterItems: [
            { name: '精钢长剑', type: 'weapon', description: '一把锋利的精钢长剑', quantity: 1, effects: { attack: 4 }, rarity: 'common', usable: false },
            { name: '金创药', type: 'consumable', description: '恢复25点生命值', quantity: 5, effects: { hp: 25 }, rarity: 'common', usable: true },
            { name: '银两', type: 'misc', description: '江湖通用货币', quantity: 30, rarity: 'common', usable: false },
        ],
        starterLocation: '洛阳城',
        starterLocationDesc: '天下第一城洛阳，繁华热闹。城中有武林盟的分舵，各路英雄豪杰在此汇聚。',
        starterGold: 30,
    },
    {
        id: 'tpl_apocalypse', name: '末日求生', genre: '末日', icon: '☢️',
        description: '后启示录生存挑战',
        world: {
            name: '废土', genre: '末日',
            description: '核战之后的废土世界，文明已经崩塌。幸存者在废墟中艰难求生，变异生物横行，资源极度匮乏。你从一座地下避难所中醒来...',
            rules: '辐射无处不在，需要盖革计数器监测。物资极度稀缺，以物易物是主要交易方式。变异生物具有不同的弱点。',
            tone: '黑暗',
        },
        starterItems: [
            { name: '自制匕首', type: 'weapon', description: '用废铁打磨的匕首', quantity: 1, effects: { attack: 2 }, rarity: 'common', usable: false },
            { name: '脏水', type: 'consumable', description: '恢复10点生命值，有概率生病', quantity: 3, effects: { hp: 10 }, rarity: 'common', usable: true },
            { name: '防毒面具', type: 'armor', description: '过滤部分辐射尘埃', quantity: 1, effects: { defense: 1 }, rarity: 'uncommon', usable: false },
        ],
        starterLocation: '避难所',
        starterLocationDesc: '一座破旧的地下避难所，应急灯忽明忽暗。储物柜里还有一些残余物资，大门通向未知的废土。',
        starterGold: 0,
    },
];

router.post('/create', (req, res) => {
    const {
        saveName, worldName, genre, worldDesc, worldRules, customPrompt, tone,
        startLocation, startLocationDesc,
        playerName, playerRace, playerClass, playerAppearance, playerPersonality, playerBackstory,
        startGold, templateId
    } = req.body;

    // 组合角色描述
    let playerDesc = '';
    if (playerRace) playerDesc += `种族：${playerRace}。`;
    if (playerClass) playerDesc += `职业：${playerClass}。`;
    if (playerAppearance) playerDesc += `外貌：${playerAppearance}。`;
    if (playerPersonality) playerDesc += `性格：${playerPersonality}。`;
    if (playerBackstory) playerDesc += `背景：${playerBackstory}`;

    // 获取模板初始物品和金币
    let starterItems = [];
    let starterGold = parseInt(startGold) || 0;
    let effectiveWorldName = worldName || '未知世界';
    let effectiveGenre = genre || '自定义';
    let effectiveWorldDesc = worldDesc || '一个未知的世界';
    let effectiveWorldRules = worldRules || '';
    let effectiveTone = tone || '史诗';
    let effectiveStartLocation = startLocation || '起始之地';
    let effectiveStartLocationDesc = startLocationDesc || '你站在这片陌生土地的起点。';

    if (templateId && templateId !== 'custom') {
        const tpl = BUILTIN_TEMPLATES.find(t => t.id === templateId);
        if (tpl) {
            starterItems = tpl.starterItems || [];
            starterGold = tpl.starterGold !== undefined ? tpl.starterGold : starterGold;
            effectiveWorldName = tpl.world.name;
            effectiveGenre = tpl.world.genre;
            effectiveWorldDesc = tpl.world.description;
            effectiveWorldRules = tpl.world.rules || '';
            effectiveTone = tpl.world.tone;
            effectiveStartLocation = tpl.starterLocation;
            effectiveStartLocationDesc = tpl.starterLocationDesc;
        }
    }

    const id = 'save_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    const now = new Date().toISOString();

    const saveData = {
        id, name: saveName || '未命名的冒险', version: '1.0',
        world: { name: effectiveWorldName, genre: effectiveGenre, description: effectiveWorldDesc, rules: effectiveWorldRules, tone: effectiveTone, customPrompt: customPrompt || '' },
        player: {
            name: playerName || '旅行者', description: playerDesc, level: 1, experience: 0, experienceToNext: 100,
            attributes: {
                hp: { current: 100, max: 100, label: '生命值' },
                mp: { current: 50, max: 50, label: '魔力值' },
                attack: { current: 10, max: 10, label: '攻击力' },
                defense: { current: 5, max: 5, label: '防御力' },
                agility: { current: 7, max: 7, label: '敏捷' },
                luck: { current: 3, max: 3, label: '幸运' },
            },
            statusEffects: [],
        },
        inventory: {
            items: starterItems.map((item, i) => ({
                id: 'item_' + Date.now() + '_' + i,
                name: item.name, type: item.type, description: item.description || '',
                quantity: item.quantity || 1, effects: item.effects || {},
                rarity: item.rarity || 'common', usable: item.usable || false,
                equippable: item.equippable || false, equipped: false,
            })),
            gold: starterGold, maxSlots: 20,
        },
        map: {
            currentLocation: effectiveStartLocation,
            locations: {
                [effectiveStartLocation]: {
                    description: effectiveStartLocationDesc,
                    connections: [], npcs: [], discovered: true, dangerLevel: 0,
                },
            },
        },
        chatHistory: [],
        stats: { turnCount: 0, playTime: 0, monstersDefeated: 0, itemsCollected: 0, locationsDiscovered: 1, deaths: 0 },
        eventLog: [{ turn: 1, type: 'system', text: '冒险开始' }],
        meta: { createdAt: now, lastSavedAt: now, version: '1.0' },
    };

    // 存入数据库
    db.prepare(`INSERT INTO saves (id, name, data, world_name, world_genre, player_name, player_level, current_location, turn_count, play_time, pinned, archived, created_at, last_saved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, ?, ?)`)
        .run(id, saveData.name, JSON.stringify(saveData), effectiveWorldName, effectiveGenre, saveData.player.name, 1, effectiveStartLocation, now, now);

    res.json({ success: true, id, saveData });
});

// ===================================================================
// ===== GET /api/game/templates — 获取模板列表 =====
// ===================================================================
router.get('/templates', (req, res) => {
    res.json(BUILTIN_TEMPLATES);
});

// ===================================================================
// ===== POST /api/game/drop-item — 丢弃物品（服务端校验） =====
// ===================================================================
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

// ===================================================================
// ===== 存档操作补全接口 =====
// ===================================================================

// PATCH /api/game/:id/rename — 重命名
router.patch('/:id/rename', (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: '名称不能为空' });

    const existing = db.prepare('SELECT id, data FROM saves WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: '存档不存在' });

    db.prepare("UPDATE saves SET name = ?, last_saved_at = ? WHERE id = ?").run(name, new Date().toISOString(), req.params.id);

    // 同时更新存档数据中的 name
    try {
        const saveData = JSON.parse(existing.data);
        saveData.name = name;
        db.prepare("UPDATE saves SET data = ? WHERE id = ?").run(JSON.stringify(saveData), req.params.id);
    } catch(e) {}

    res.json({ success: true });
});

// PATCH /api/game/:id/pin — 切换置顶
router.patch('/:id/pin', (req, res) => {
    const existing = db.prepare('SELECT pinned FROM saves WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: '存档不存在' });

    const newPinned = existing.pinned ? 0 : 1;
    db.prepare("UPDATE saves SET pinned = ?, last_saved_at = ? WHERE id = ?").run(newPinned, new Date().toISOString(), req.params.id);

    res.json({ success: true, pinned: !!newPinned });
});

// PATCH /api/game/:id/archive — 切换归档
router.patch('/:id/archive', (req, res) => {
    const existing = db.prepare('SELECT archived FROM saves WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: '存档不存在' });

    const newArchived = existing.archived ? 0 : 1;
    db.prepare("UPDATE saves SET archived = ?, last_saved_at = ? WHERE id = ?").run(newArchived, new Date().toISOString(), req.params.id);

    res.json({ success: true, archived: !!newArchived });
});

// POST /api/game/:id/duplicate — 创建副本
router.post('/:id/duplicate', (req, res) => {
    const existing = db.prepare('SELECT * FROM saves WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: '存档不存在' });

    const newId = 'save_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    const now = new Date().toISOString();
    const newName = (existing.name || '未命名') + ' (副本)';

    // 深拷贝存档数据并修改 ID 和名称
    let newData;
    try {
        newData = JSON.parse(existing.data);
        newData.id = newId;
        newData.name = newName;
        if (newData.meta) {
            newData.meta.createdAt = now;
            newData.meta.lastSavedAt = now;
        }
    } catch(e) {
        newData = existing.data;
    }

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
        .run(
            JSON.stringify(saveData),
            saveData.name || null,
            saveData.world?.name || '',
            saveData.world?.genre || '',
            saveData.player?.name || '',
            saveData.player?.level || 1,
            saveData.map?.currentLocation || '',
            saveData.stats?.turnCount || 0,
            saveData.stats?.playTime || 0,
            now,
            saveId
        );
}

// 解析流式响应（服务端版，收集完整内容）
async function parseStreamResponse(response) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    let toolCalls = [];
    let currentToolCallIndex = -1;

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const events = buffer.split('\n\n');
            buffer = events.pop() || '';

            for (const event of events) {
                const lines = event.split('\n');
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || !trimmed.startsWith('data: ')) continue;
                    const data = trimmed.slice(6);
                    if (data === '[DONE]') continue;

                    try {
                        const parsed = JSON.parse(data);
                        const delta = parsed.choices?.[0]?.delta;
                        if (!delta) continue;

                        if (delta.content) {
                            content += delta.content;
                        }

                        if (delta.tool_calls) {
                            for (const tc of delta.tool_calls) {
                                if (tc.index !== undefined && tc.index !== currentToolCallIndex) {
                                    currentToolCallIndex = tc.index;
                                    toolCalls.push({
                                        id: tc.id || ('call_' + Date.now() + '_' + tc.index),
                                        type: 'function',
                                        function: { name: tc.function?.name || '', arguments: '' },
                                    });
                                }
                                if (tc.id) {
                                    toolCalls[currentToolCallIndex].id = tc.id;
                                }
                                if (tc.function?.name) {
                                    toolCalls[currentToolCallIndex].function.name = tc.function.name;
                                }
                                if (tc.function?.arguments) {
                                    toolCalls[currentToolCallIndex].function.arguments += tc.function.arguments;
                                }
                            }
                        }
                    } catch(e) {}
                }
            }
        }
    } finally {
        reader.releaseLock();
    }

    return { content, tool_calls: toolCalls.length > 0 ? toolCalls : null };
}

// 非流式降级
async function parseNonStreamResponse(apiBaseUrl, apiKey, model, messages, tools, appConfig) {
    const response = await fetch(apiBaseUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model,
            messages,
            tools: tools || undefined,
            temperature: appConfig.temperature,
            max_tokens: appConfig.maxTokens,
            stream: false,
        }),
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`AI 请求失败 (${response.status}): ${errText}`);
    }

    const data = await response.json();
    const choice = data.choices?.[0];
    if (!choice) throw new Error('AI 返回了空响应');

    return {
        content: choice.message?.content || '',
        tool_calls: choice.message?.tool_calls || null,
    };
}

module.exports = router;
