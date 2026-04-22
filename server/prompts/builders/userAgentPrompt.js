const registry = require('../registry');
const { getGenrePreset } = require('../presets/genrePresets');

/**
 * 构建 UserAgent 系统提示词
 * UA 负责根据玩家选择的选项，生成玩家角色的行为描述和对话内容
 * @param {Object} saveData - 游戏存档数据
 * @returns {string} UserAgent系统提示词
 */
function buildUserAgentPrompt(saveData) {
    const p = saveData.player;
    const loc = saveData.map.locations[saveData.map.currentLocation];
    const genre = saveData.world.genre || '自定义';
    const preset = getGenrePreset(genre);

    const locDesc = loc ? `${saveData.map.currentLocation} - ${loc.description}` : '未知地点';
    const npcs = loc && loc.npcs && loc.npcs.length > 0 ? loc.npcs.join('、') : '无';

    // 当前位置的重要角色
    const characters = saveData.characters || {};
    const charsAtLocation = Object.values(characters).filter(c => c.location === saveData.map.currentLocation && c.status === 'alive');
    let charsInfo = '无';
    if (charsAtLocation.length > 0) {
        charsInfo = charsAtLocation.map(c => `${c.name}（${c.title || '未知身份'}，关系：${c.relationship?.title || '陌生人'}）`).join('、');
    }

    return registry.render('user_agent_system', {
        worldName: saveData.world.name,
        worldGenre: genre,
        worldTone: saveData.world.tone || '默认',
        playerName: p.name,
        playerGender: p.gender || '未设定',
        playerAge: p.age || '未设定',
        playerOccupation: p.occupation || '未设定',
        playerAppearance: p.appearance || '未设定',
        playerDescription: p.description || '无详细描述',
        playerLevel: p.level,
        playerPersonality: p.personality || '根据描述推断',
        locationDesc: locDesc,
        npcsInfo: npcs,
        charactersInfo: charsInfo,
    });
}

module.exports = { buildUserAgentPrompt };
