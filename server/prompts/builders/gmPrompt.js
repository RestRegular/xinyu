const registry = require('../registry');
const { getGenrePreset } = require('../presets/genrePresets');
const { characterRules } = require('../rules/characterRules');
const { toolRules } = require('../rules/toolRules');
const { outputFormatRules } = require('../rules/outputFormatRules');

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

    const worldRules = s.world.rules || preset.worldRules || '无特殊规则';
    const narrativeTips = preset.narrativeTips || '';
    const itemNaming = preset.items || '';

    // 世界层变量
    const narrativeTipsLine = narrativeTips ? '- 叙事技巧：' + narrativeTips : '';
    const itemNamingLine = itemNaming ? '- 物品命名风格：' + itemNaming : '';

    // 叙事长度
    const narrativeHint = {
        concise: '每次回复50-150字，简洁有力',
        medium: '每次回复100-300字，详略得当',
        detailed: '每次回复200-500字，充分描述环境、心理和细节',
    }[appConfig?.ui?.narrativeLength || 'medium'];

    // 背包
    const inventoryStr = inv.items.length > 0
        ? inv.items.map(i => {
            let str = i.name;
            if (i.quantity > 1) str += 'x' + i.quantity;
            str += '[' + i.type + ']';
            if (i.equipped) str += '(已装备)';
            if (i.effects && Object.keys(i.effects).length > 0) str += '(' + Object.entries(i.effects).map(([k,v]) => k + (v>0?'+':'') + v).join(',') + ')';
            return str;
        }).join('、')
        : '空';

    // 状态效果
    const statusStr = p.statusEffects.length > 0
        ? p.statusEffects.map(e => e.name + '[' + (e.duration > 0 ? e.duration + '回合' : '永久') + ']').join('、')
        : '无';

    // NPC
    const npcs = loc && loc.npcs && loc.npcs.length > 0 ? loc.npcs.join('、') : '无';

    // 重要角色
    const characters = s.characters || {};
    const charsAtLocation = Object.values(characters).filter(c => c.location === s.map.currentLocation && c.status === 'alive');
    let charsInfo = '当前位置没有重要角色';
    if (charsAtLocation.length > 0) {
        charsInfo = charsAtLocation.map(c =>
            `- ${c.name}（${c.role}）| 关系：${c.relationship.title}(${c.relationship.value}/100）`
        ).join('\n');
    }

    // 自定义指令
    const globalInstructions = appConfig?.customInstructions || '';
    const saveInstructions = s.world.customPrompt || '';
    let customInstructions = '';
    if (globalInstructions) customInstructions += '\n## 玩家自定义指令（全局）\n' + globalInstructions;
    if (saveInstructions) customInstructions += '\n## 玩家自定义指令（本世界）\n' + saveInstructions;

    // 组合五层模板
    return registry.compose([
        'gm_layer_base',
        'gm_layer_world',
        'gm_layer_character',
        'gm_layer_context',
    ], {
        worldName: s.world.name,
        worldGenre: genre,
        worldDescription: s.world.description,
        worldTone: s.world.tone,
        toneGuide,
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
        charactersInfo: charsInfo,
    }) + '\n\n' + characterRules + '\n\n' + toolRules + '\n\n' + outputFormatRules.replace('{{narrativeLengthGuide}}', narrativeHint) + customInstructions;
}

module.exports = { buildGmPrompt };
