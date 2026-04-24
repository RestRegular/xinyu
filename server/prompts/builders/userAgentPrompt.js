const registry = require('../registry');

function buildUserAgentPrompt(saveData) {
    const p = saveData.player;
    const genre = saveData.world.genre || '自定义';

    return registry.render('user_agent_system', {
        worldName: saveData.world.name,
        worldGenre: genre,
        worldTone: saveData.world.tone || '默认',
        perspective: saveData.world.perspective || 'second_person',
        perspectiveGuide: {
            second_person: '使用第二人称（"你"）',
            third_person: `使用第三人称（"${p.name}"）`,
            first_person: '使用第一人称（"我"）',
        }[saveData.world.perspective] || '使用第二人称（"你"）',
        playerName: p.name,
        playerGender: p.gender || '未设定',
        playerAge: p.age || '未设定',
        playerOccupation: p.occupation || '未设定',
        playerAppearance: p.appearance || '未设定',
        playerPersonality: p.personality || '根据描述推断',
    });
}

module.exports = { buildUserAgentPrompt };
