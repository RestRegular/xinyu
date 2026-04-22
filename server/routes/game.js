// ===================================================================
// ===== 游戏路由（统一游戏动作、新游戏创建、存档操作、角色系统） =====
// ===================================================================

const express = require('express');
const router = express.Router();
const db = require('../db');
const { Pipeline, runUserAgent } = require('../gmPipeline');
const { executeGameFunction } = require('../gameEngine');
const { buildAutofillPrompt } = require('../prompts/builders/autofillPrompt');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

// 配置文件上传
const upload = multer({
    dest: path.join(__dirname, '../uploads/world_cards'),
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'image/svg+xml' || file.name.endsWith('.svg')) {
            cb(null, true);
        } else {
            cb(new Error('只支持 SVG 格式的文件'), false);
        }
    },
});

// 单例 Pipeline 实例
const pipeline = new Pipeline();

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
// ===== 世界模板管理 =====
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

// 初始化内建模板到数据库
function initBuiltinTemplates() {
    const now = new Date().toISOString();
    const insertOrReplace = db.prepare(`
        INSERT OR REPLACE INTO world_templates (id, name, genre, icon, description, data, is_builtin, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
    `);
    
    BUILTIN_TEMPLATES.forEach(tpl => {
        const data = JSON.stringify({
            world: tpl.world,
            starterItems: tpl.starterItems,
            starterLocation: tpl.starterLocation,
            starterLocationDesc: tpl.starterLocationDesc,
            starterGold: tpl.starterGold
        });
        insertOrReplace.run(tpl.id, tpl.name, tpl.genre, tpl.icon, tpl.description, data, now, now);
    });
}

// 执行初始化
initBuiltinTemplates();

// 获取所有模板
function getAllTemplates() {
    const rows = db.prepare('SELECT id, name, genre, icon, description, data, is_builtin, created_at FROM world_templates ORDER BY is_builtin DESC, name ASC').all();
    return rows.map(row => {
        const data = JSON.parse(row.data);
        return {
            id: row.id,
            name: row.name,
            genre: row.genre,
            icon: row.icon,
            description: row.description,
            world: data.world,
            starterItems: data.starterItems || [],
            starterLocation: data.starterLocation,
            starterLocationDesc: data.starterLocationDesc,
            starterGold: data.starterGold,
            is_builtin: row.is_builtin === 1
        };
    });
}

// 根据 ID 获取模板
function getTemplateById(id) {
    const row = db.prepare('SELECT id, name, genre, icon, description, data, is_builtin, created_at FROM world_templates WHERE id = ?').get(id);
    if (!row) return null;
    const data = JSON.parse(row.data);
    return {
        id: row.id,
        name: row.name,
        genre: row.genre,
        icon: row.icon,
        description: row.description,
        world: data.world,
        starterItems: data.starterItems || [],
        starterLocation: data.starterLocation,
        starterLocationDesc: data.starterLocationDesc,
        starterGold: data.starterGold,
        is_builtin: row.is_builtin === 1
    };
}

// ===================================================================
// ===== POST /api/game/action — 统一游戏动作（核心接口） =====
// ===================================================================
router.post('/action', async (req, res) => {
    const { saveId, userMessage, isOption } = req.body;
    if (!saveId || !userMessage) return res.status(400).json({ error: '缺少 saveId 或 userMessage' });

    const apiKey = getApiKey();
    if (!apiKey) return res.status(400).json({ error: '未配置 API Key，请在设置中配置' });

    const row = db.prepare('SELECT data FROM saves WHERE id = ?').get(saveId);
    if (!row) return res.status(404).json({ error: '存档不存在' });

    let saveData;
    try { saveData = JSON.parse(row.data); } catch(e) { return res.status(500).json({ error: '存档数据解析失败' }); }

    if (!saveData.characters) saveData.characters = {};

    const appConfig = getAppConfig();
    const isSystemMsg = userMessage.startsWith('[系统]');
    saveData.chatHistory.push({ role: isSystemMsg ? 'system' : 'user', content: userMessage, timestamp: new Date().toISOString() });
    saveData.stats.turnCount++;

    try {
        // 如果是选项选择，先调用 UserAgent 生成玩家行为描述
        let playerActionContent = null;
        if (isOption) {
            try {
                const apiConfig = {
                    apiKey,
                    apiBaseUrl: getApiBaseUrl(),
                    model: getModel(),
                    temperature: appConfig.temperature,
                    maxTokens: appConfig.maxTokens,
                };
                const uaResult = await runUserAgent(saveData, userMessage, apiConfig);
                playerActionContent = {
                    type: 'player_action',
                    option: userMessage,
                    action: uaResult.action,
                    dialogue: uaResult.dialogue,
                    timestamp: new Date().toISOString(),
                };
            } catch (uaErr) {
                console.error('UserAgent 执行失败:', uaErr.message);
            }
        }

        const result = await pipeline.run(saveData, userMessage, {
            apiKey,
            apiBaseUrl: getApiBaseUrl(),
            model: getModel(),
            temperature: appConfig.temperature,
            maxTokens: appConfig.maxTokens,
        }, appConfig);

        // 将 player_action 插入到 content 最前面
        const finalContent = playerActionContent
            ? [playerActionContent, ...(result.content || [])]
            : result.content;

        saveData.chatHistory.push({
            role: 'assistant',
            content: JSON.stringify({ content: finalContent, options: result.options }),
            structured: { content: finalContent, options: result.options },
            timestamp: new Date().toISOString(),
        });

        // 将通知持久化到 chatHistory
        if (result.notifications && result.notifications.length > 0) {
            const now = new Date().toISOString();
            for (const notif of result.notifications) {
                saveData.chatHistory.push({
                    role: 'notification',
                    content: notif.text,
                    type: notif.type === 'character_created' ? 'positive' : (notif.type || 'info'),
                    timestamp: now,
                });
            }
        }

        await persistSave(saveData, saveId);

        res.json({
            content: finalContent,
            options: result.options,
            notifications: result.notifications,
            saveData,
        });
    } catch (err) {
        await persistSave(saveData, saveId);
        res.status(500).json({ error: 'GM 管线执行失败: ' + err.message });
    }
});



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
// ===== POST /api/game/autofill — AI 自动补全角色和世界信息 =====
// ===================================================================
router.post('/autofill', async (req, res) => {
    const { worldName, genre, worldDesc, worldRules, tone, startLocation, startLocationDesc, playerName, playerGender, playerAge, playerRace, playerClass, playerAppearance, playerPersonality, playerBackstory, templateId } = req.body;

    const apiKey = getApiKey();
    const apiBaseUrl = getApiBaseUrl();
    const model = getModel();

    if (!apiKey) {
        return res.status(400).json({ error: '请先在设置中配置 API Key' });
    }

    // 构建需要补全的字段列表
    const missing = [];
    if (!playerName) missing.push('playerName');
    if (!playerGender) missing.push('playerGender');
    if (!playerAge) missing.push('playerAge');
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

    // 如果选了模板，从数据库获取模板信息作为参考
    let templateInfo = '';
    if (templateId && templateId !== 'custom') {
        const tpl = getTemplateById(templateId);
        if (tpl) {
            templateInfo = `\n参考模板：${tpl.name}（${tpl.genre}）\n模板世界：${tpl.world.name}\n模板描述：${tpl.world.description?.slice(0, 200)}`;
        }
    }

    const { prompt, missing: autofillMissing } = buildAutofillPrompt({
        worldName, genre, worldDesc, worldRules, tone,
        startLocation, startLocationDesc,
        playerName, playerGender, playerAge, playerRace, playerClass,
        playerAppearance, playerPersonality, playerBackstory,
        missing: missing.join('、'),
        templateInfo,
    });

    if (!prompt) {
        return res.json({ success: true, filled: {}, message: '所有字段已填写完整' });
    }

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

// ===================================================================
// ===== POST /api/game/create — 创建新游戏 =====
// ===================================================================
router.post('/create', (req, res) => {
    const { saveName, worldName, genre, worldDesc, worldRules, customPrompt, tone, startLocation, startLocationDesc, playerName, playerGender, playerAge, playerRace, playerClass, playerAppearance, playerPersonality, playerBackstory, startGold, templateId, starterItems: customStarterItems } = req.body;

    let playerDesc = '';
    if (playerRace) playerDesc += `种族：${playerRace}；`;
    if (playerClass) playerDesc += `职业：${playerClass}；`;
    if (playerAppearance) playerDesc += `外貌：${playerAppearance}；`;
    if (playerPersonality) playerDesc += `性格：${playerPersonality}；`;
    if (playerBackstory) playerDesc += `背景：${playerBackstory}；`;

    let finalStarterItems = [];
    let finalStarterGold = parseInt(startGold) || 0;
    let effectiveWorldName = worldName || '未知世界', effectiveGenre = genre || '自定义';
    let effectiveWorldDesc = worldDesc || '一个未知的世界', effectiveWorldRules = worldRules || '';
    let effectiveTone = tone || '史诗';
    let effectiveStartLocation = startLocation || '起始之地';
    let effectiveStartLocationDesc = startLocationDesc || '你站在这片陌生土地的起点。';

    if (templateId && templateId !== 'custom') {
        const tpl = getTemplateById(templateId);
        if (tpl) {
            finalStarterItems = tpl.starterItems || [];
            finalStarterGold = tpl.starterGold !== undefined ? tpl.starterGold : finalStarterGold;
            effectiveWorldName = tpl.world.name; effectiveGenre = tpl.world.genre;
            effectiveWorldDesc = tpl.world.description; effectiveWorldRules = tpl.world.rules || '';
            effectiveTone = tpl.world.tone;
            effectiveStartLocation = tpl.starterLocation; effectiveStartLocationDesc = tpl.starterLocationDesc;
        } else if (Array.isArray(customStarterItems)) {
            // 对于导入的模板，使用自定义的初始物品
            starterItems = customStarterItems;
        }
    } else if (Array.isArray(customStarterItems)) {
        finalStarterItems = customStarterItems;
    }

    const id = 'save_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    const now = new Date().toISOString();

    const saveData = {
        id, name: saveName || '未命名的冒险', version: '1.0',
        world: { name: effectiveWorldName, genre: effectiveGenre, description: effectiveWorldDesc, rules: effectiveWorldRules, tone: effectiveTone, customPrompt: customPrompt || '' },
        player: { name: playerName || '旅行者', gender: playerGender || '未设定', age: playerAge || '未设定', appearance: playerAppearance || '', personality: playerPersonality || '', occupation: playerClass || '', backstory: playerBackstory || '', description: playerDesc, level: 1, experience: 0, experienceToNext: 100, attributes: { hp: { current: 100, max: 100, label: '生命值' }, mp: { current: 50, max: 50, label: '魔力值' }, attack: { current: 10, max: 10, label: '攻击力' }, defense: { current: 5, max: 5, label: '防御力' }, agility: { current: 7, max: 7, label: '敏捷' }, luck: { current: 3, max: 3, label: '幸运' } }, statusEffects: [] },
        inventory: { items: finalStarterItems.map((item, i) => ({ id: 'item_' + Date.now() + '_' + i, name: item.name, type: item.type, description: item.description || '', quantity: item.quantity || 1, effects: item.effects || {}, rarity: item.rarity || 'common', usable: item.usable || false, equippable: item.equippable || false, equipped: false })), gold: finalStarterGold, maxSlots: 20 },
        map: { currentLocation: effectiveStartLocation, locations: { [effectiveStartLocation]: { description: effectiveStartLocationDesc, connections: [], npcs: [], discovered: true, dangerLevel: 0 } } },
        characters: {},
        chatHistory: [],
        stats: { turnCount: 0, playTime: 0, monstersDefeated: 0, itemsCollected: 0, locationsDiscovered: 1, deaths: 0 },
        eventLog: [{ turn: 1, type: 'system', text: '冒险开始' }],
        meta: { createdAt: now, lastSavedAt: now, version: '1.0' },
    };

    db.prepare(`INSERT INTO saves (id, name, data, world_name, world_genre, player_name, player_level, current_location, turn_count, play_time, pinned, archived, created_at, last_saved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, ?, ?)`)
        .run(id, saveData.name, JSON.stringify(saveData), effectiveWorldName, effectiveGenre, saveData.player.name, 1, effectiveStartLocation, now, now);

    res.json({ success: true, id, saveData });
});

// ===================================================================
// ===== 模板 API =====
// ===================================================================
router.get('/templates', (req, res) => { res.json(getAllTemplates()); });

// 导入模板
router.post('/templates/import', (req, res) => {
    const template = req.body;
    if (!template || !template.name || !template.world) {
        return res.status(400).json({ error: '无效的世界模板：缺少 name 或 world 字段' });
    }
    if (!template.world.name || !template.world.description) {
        return res.status(400).json({ error: '无效的世界模板：world 中缺少 name 或 description' });
    }

    const id = template.id || ('custom_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6));
    const now = new Date().toISOString();

    const data = JSON.stringify({
        world: template.world,
        starterItems: Array.isArray(template.starterItems) ? template.starterItems : [],
        starterLocation: template.starterLocation || '起始之地',
        starterLocationDesc: template.starterLocationDesc || '你站在这片陌生土地的起点。',
        starterGold: template.starterGold || 0,
    });

    db.prepare(`INSERT INTO world_templates (id, name, genre, icon, description, data, is_builtin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`)
        .run(id, template.name, template.world.genre || '自定义', template.icon || '✨', template.description || '', data, now, now);

    const importedTemplate = getTemplateById(id);
    res.json({ success: true, template: importedTemplate });
});

// 删除模板
router.delete('/templates/:id', (req, res) => {
    const tpl = getTemplateById(req.params.id);
    if (!tpl) return res.status(404).json({ error: '模板不存在' });
    if (tpl.is_builtin) return res.status(400).json({ error: '内建模板不能删除' });

    db.prepare('DELETE FROM world_templates WHERE id = ?').run(req.params.id);
    res.json({ success: true, message: '模板已删除' });
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
        starterItems: saveData.inventory?.items || [],
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

// ===================================================================
// ===== 世界卡片 SVG 图片管理接口 =====
// ===================================================================

// POST /api/game/templates/upload-svg - 上传世界卡片 SVG 图片
router.post('/templates/upload-svg', upload.single('svg'), (req, res) => {
    try {
        const file = req.file;
        if (!file) {
            return res.status(400).json({ error: '请选择要上传的 SVG 文件' });
        }

        // 生成新的文件名（基于世界名称）
        const worldName = req.body.worldName || '未知世界';
        const sanitizedName = worldName.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_');
        const fileName = `${sanitizedName}.svg`;
        const filePath = path.join(__dirname, '../uploads/world_cards', fileName);

        // 重命名文件
        fs.renameSync(file.path, filePath);

        // 返回文件路径
        res.json({ 
            success: true, 
            fileName, 
            url: `/api/game/templates/svg/${encodeURIComponent(fileName)}` 
        });
    } catch (error) {
        res.status(500).json({ error: '上传失败: ' + error.message });
    }
});

// GET /api/game/templates/svg/:filename - 获取世界卡片 SVG 图片
router.get('/templates/svg/:filename', (req, res) => {
    try {
        const filename = req.params.filename;
        const filePath = path.join(__dirname, '../uploads/world_cards', filename);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'SVG 文件不存在' });
        }

        res.set('Content-Type', 'image/svg+xml');
        res.sendFile(filePath);
    } catch (error) {
        res.status(500).json({ error: '获取图片失败: ' + error.message });
    }
});

// GET /api/game/templates/svg-list - 获取所有 SVG 图片列表
router.get('/templates/svg-list', (req, res) => {
    try {
        const directoryPath = path.join(__dirname, '../uploads/world_cards');
        
        if (!fs.existsSync(directoryPath)) {
            return res.json({ success: true, files: [] });
        }

        const files = fs.readdirSync(directoryPath)
            .filter(file => file.endsWith('.svg'))
            .map(file => ({
                fileName: file,
                url: `/api/game/templates/svg/${encodeURIComponent(file)}`
            }));

        res.json({ success: true, files });
    } catch (error) {
        res.status(500).json({ error: '获取图片列表失败: ' + error.message });
    }
});

// DELETE /api/game/templates/svg/:filename - 删除世界卡片 SVG 图片
router.delete('/templates/svg/:filename', (req, res) => {
    try {
        const filename = req.params.filename;
        const filePath = path.join(__dirname, '../uploads/world_cards', filename);

        if (!fs.existsSync(filePath)) {
            return res.json({ success: true, message: '文件不存在或已被删除' });
        }

        fs.unlinkSync(filePath);
        res.json({ success: true, message: '图片已删除' });
    } catch (error) {
        res.status(500).json({ error: '删除图片失败: ' + error.message });
    }
});

module.exports = router;
