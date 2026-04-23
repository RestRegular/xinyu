const registry = require('../registry');

/**
 * 递归格式化对象为可读文本
 */
function formatObjectRecursive(obj, depth) {
    if (depth > 4) return String(obj);
    const indent = '  '.repeat(depth);
    if (Array.isArray(obj)) {
        if (obj.length === 0) return '（空）';
        return obj.map(item => {
            if (typeof item === 'object' && item !== null) return '\n' + indent + '- ' + formatObjectRecursive(item, depth + 1);
            return item;
        }).join('\n' + indent + '- ');
    }
    if (typeof obj === 'object' && obj !== null) {
        const entries = Object.entries(obj);
        if (entries.length === 0) return '（空）';
        return entries.map(([key, val]) => {
            if (typeof val === 'object' && val !== null) return `\n${indent}${key}：${formatObjectRecursive(val, depth + 1)}`;
            return `\n${indent}${key}：${val}`;
        }).join('');
    }
    return String(obj);
}

/**
 * 构建角色 AI 系统提示词
 * @param {Object} character - 角色数据
 * @param {Object} saveData - 游戏存档数据
 * @returns {string} 角色AI系统提示词
 */
function buildCharacterPrompt(character, saveData) {
    const p = saveData.player;
    const inv = saveData.inventory || { items: [] };

    // 人设层
    let personaLines = [];
    if (character.gender) personaLines.push(`- 性别：${character.gender}`);
    if (character.age) personaLines.push(`- 年龄：${character.age}`);
    if (character.appearance) personaLines.push(`- 外貌：${character.appearance}`);
    if (character.personality) personaLines.push(`- 性格：${character.personality}`);
    if (character.speechStyle) personaLines.push(`- 说话风格：${character.speechStyle}`);
    if (character.background) personaLines.push(`- 背景：${character.background}`);
    if (character.motivation) personaLines.push(`- 动机：${character.motivation}`);
    if (character.secrets) personaLines.push(`- 秘密：${character.secrets}`);
    const personaStr = personaLines.join('\n') || '（未设定详细人设）';

    // 记忆层
    let memoryStr = '（暂无记忆）';
    if (character.memories && character.memories.length > 0) {
        memoryStr = character.memories.slice(-20).map(m =>
            `- 第${m.turn}回合：${m.text}${m.type ? ` [${m.type}]` : ''}`
        ).join('\n');
    }

    // 特有能力层
    let extraStr = '';
    if (character.extra && Object.keys(character.extra).length > 0) {
        extraStr = '\n\n## 你的特有能力与信息\n' + formatObjectRecursive(character.extra, 0);
    }

    // 背包摘要
    const inventoryStr = inv.items.length > 0
        ? inv.items.map(i => {
            let str = i.name;
            if (i.quantity > 1) str += 'x' + i.quantity;
            str += '[' + i.type + ']';
            if (i.rarity && i.rarity !== 'common') str += '(' + i.rarity + ')';
            if (i.description) str += '：' + i.description;
            if (i.equipped) str += '【已装备】';
            return str;
        }).join('\n  ')
        : '空';

    return registry.render('character_system', {
        characterName: character.name,
        characterRole: character.role,
        personaInfo: personaStr,
        relationshipValue: character.relationship.value,
        relationshipTitle: character.relationship.title,
        memoryInfo: memoryStr,
        extraInfo: extraStr,
        playerName: p.name,
        playerLevel: p.level ? '，Lv.' + p.level : '',
        playerDescription: p.description || '',
        perspective: saveData.world?.perspective || 'second_person',
        perspectivePronoun: {
            second_person: '你',
            third_person: p.name,
            first_person: '我',
        }[saveData.world?.perspective] || '你',
        currentLocation: saveData.map?.currentLocation || '未知',
        worldName: saveData.world?.name || '未知',
        worldGenre: saveData.world?.genre || '未知',
        hpCurrent: p.attributes?.hp?.current ?? '?',
        hpMax: p.attributes?.hp?.max ?? '?',
        gold: inv.gold ?? 0,
        inventoryInfo: inventoryStr,
    });
}

module.exports = { buildCharacterPrompt };
