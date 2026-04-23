const registry = require('../registry');
const { getGenrePreset } = require('../presets/genrePresets');

/**
 * 从 eventLog 或 chatHistory 提取最近剧情摘要
 * @param {Object} saveData - 游戏存档数据
 * @returns {string} 剧情摘要文本
 */
function buildRecentPlotSummary(saveData) {
    const eventLog = saveData.eventLog || [];
    const recentEvents = eventLog.slice(-5);

    if (recentEvents.length === 0) {
        // 从 chatHistory 提取
        let history;
        if (Array.isArray(saveData.chatHistory)) {
            history = saveData.chatHistory;
        } else if (saveData.chatHistory && saveData.chatHistory.messages) {
            history = saveData.chatHistory.messages;
        } else {
            return '冒险刚刚开始';
        }
        const recent = history.slice(-6);
        return recent
            .filter(m => m.role === 'assistant')
            .map(m => {
                const text = m.structured?.content
                    ? m.structured.content
                        .filter(b => b.type === 'narrative' || b.type === 'scene')
                        .map(b => b.text?.slice(0, 50))
                        .filter(Boolean)
                        .join('；')
                    : (m.content || '').slice(0, 80);
                return text ? `- ${text}` : null;
            })
            .filter(Boolean)
            .join('\n') || '冒险刚刚开始';
    }

    return recentEvents.map(e => `- ${e.text}`).join('\n');
}

/**
 * 构建 GM 系统提示词
 * @param {Object} saveData - 游戏存档数据
 * @param {Object} appConfig - 应用配置
 * @returns {string} 完整的系统提示词
 */
function buildGmPrompt(saveData, appConfig) {
    const s = saveData;
    const p = s.player;
    const loc = s.map.locations[s.map.currentLocation];
    const inv = s.inventory;
    const genre = s.world.genre || '自定义';
    const preset = getGenrePreset(genre);

    // 叙事基调
    const toneGuide = preset.toneGuide || {
        '史诗': '使用宏大、庄重的语言，注重命运的厚重感和英雄主义色彩',
        '严肃': '保持冷静克制的叙事风格，注重逻辑和真实感',
        '轻松': '使用幽默轻松的语言，可以加入有趣的对话和情节',
        '黑暗': '使用压抑阴沉的语言，注重氛围渲染和心理恐惧',
        '幽默': '可以打破第四面墙，加入元幽默和有趣的梗',
    }[s.world.tone] || '保持一致的叙事风格';

    // 世界规则合并策略：预设规则 + 用户规则，不再互相覆盖
    const userRules = s.world.rules || '';
    const presetRules = preset.worldRules || '';
    const worldRules = [presetRules, userRules].filter(Boolean).join('\n') || '无特殊规则';
    const narrativeTips = preset.narrativeTips || '';
    const itemNaming = preset.items || '';

    // 世界层变量
    const narrativeTipsLine = narrativeTips ? '- 叙事技巧：' + narrativeTips : '';
    const itemNamingLine = itemNaming ? '- 物品命名风格：' + itemNaming : '';

    // 背包
    const typeLabels = { weapon: '武器', armor: '防具', consumable: '消耗品', key: '钥匙', quest: '任务物品', misc: '杂物' };
    const inventoryStr = inv.items.length > 0
        ? inv.items.map(i => {
            let str = i.name;
            if (i.quantity > 1) str += 'x' + i.quantity;
            str += '[' + (typeLabels[i.type] || i.type) + ']';
            if (i.rarity && i.rarity !== 'common') str += '(' + i.rarity + ')';
            if (i.description) str += '：' + i.description;
            else str += '（无详细描述）';
            if (i.equipped) str += '【已装备】';
            if (i.effects && Object.keys(i.effects).length > 0) str += ' | 属性:' + Object.entries(i.effects).map(([k,v]) => k + (v>0?'+':'') + v).join(',');
            return str;
        }).join('\n  ')
        : '空';

    // 状态效果
    const statusStr = p.statusEffects.length > 0
        ? p.statusEffects.map(e => e.name + '[' + (e.duration > 0 ? e.duration + '回合' : '永久') + ']').join('、')
        : '无';

    // NPC 和角色合并显示
    const locationNpcs = loc && loc.npcs && loc.npcs.length > 0 ? loc.npcs : [];
    const characters = s.characters || {};
    // 显示所有活跃角色（不限 location），因为角色可能跟随玩家移动
    const activeChars = Object.values(characters).filter(c => c.status === 'alive' || !c.status);
    const charNames = activeChars.map(c => c.name);
    const allNames = [...new Set([...locationNpcs, ...charNames])];
    const npcs = allNames.length > 0 ? allNames.join('、') : '无';

    // 重要角色详情（供 user_agent_system.txt 使用）
    let charsInfo = '无';
    if (activeChars.length > 0) {
        charsInfo = activeChars.map(c =>
            `- ${c.name}（${c.role}）| 关系：${c.relationship.title}(${c.relationship.value}/100）`
        ).join('\n');
    }

    // 自定义指令（醒目标记）
    const globalInstructions = appConfig?.customInstructions || '';
    const saveInstructions = s.world.customPrompt || '';
    let customBlock = '';
    if (globalInstructions) {
        customBlock += '\n⚠️ 玩家自定义指令（全局，必须遵守）\n' + globalInstructions;
    }
    if (saveInstructions) {
        customBlock += '\n⚠️ 玩家自定义指令（本世界，必须遵守）\n' + saveInstructions;
    }

    // 组合模板
    return registry.compose([
        'gm_layer_base',
        'gm_layer_rules',
        'gm_layer_world',
        'gm_layer_character',
        'gm_layer_context',
    ], {
        worldName: s.world.name,
        worldGenre: genre,
        worldDescription: s.world.description,
        worldTone: s.world.tone,
        toneGuide,
        perspective: s.world.perspective || 'second_person',
        perspectiveGuide: {
            second_person: '使用第二人称（"你"）叙述，让读者代入主角视角',
            third_person: '使用第三人称（"他/她"+ 玩家名字）叙述，像小说一样描写主角',
            first_person: '使用第一人称（"我"）叙述，以主角的口吻讲述故事',
        }[s.world.perspective] || '使用第二人称（"你"）叙述',
        worldRules,
        narrativeTips: narrativeTipsLine,
        itemNamingStyle: itemNamingLine,
        playerName: p.name,
        playerGender: p.gender || '未设定',
        playerAge: p.age || '未设定',
        playerOccupation: p.occupation || '未设定',
        playerAppearance: p.appearance || '未设定',
        playerPersonality: p.personality || '未设定',
        playerBackstory: p.backstory || '未设定',
        playerLevel: p.level,
        playerExp: p.experience || 0,
        playerExpNext: p.experienceToNext || 100,
        currentLocation: s.map.currentLocation,
        turnCount: s.stats.turnCount,
        hpCurrent: p.attributes.hp.current,
        hpMax: p.attributes.hp.max,
        mpCurrent: p.attributes.mp.current,
        mpMax: p.attributes.mp.max,
        attackCurrent: p.attributes.attack.current,
        defenseCurrent: p.attributes.defense.current,
        agilityCurrent: p.attributes.agility.current,
        luckCurrent: p.attributes.luck.current,
        gold: inv.gold,
        inventoryCount: inv.items.length,
        maxSlots: inv.maxSlots,
        inventoryInfo: inventoryStr,
        statusEffectsInfo: statusStr,
        locationDescription: loc ? loc.description : '未知区域',
        npcsInfo: npcs,
        connectionsInfo: loc && loc.connections ? loc.connections.join('、') : '无已知路径',
        // 已发现地点完整列表（防止 AI 重复创建）
        discoveredLocations: Object.keys(s.map.locations || {}).join('、') || '无',
        charactersInfo: charsInfo,
        recentPlotSummary: buildRecentPlotSummary(saveData),
        maxTokens: appConfig?.maxTokens || 4096,
    }) + customBlock;
}

module.exports = { buildGmPrompt };
