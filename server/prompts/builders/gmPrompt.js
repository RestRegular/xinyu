const registry = require('../registry');
const { getGenrePreset } = require('../presets/genrePresets');

function buildRecentPlotSummary(saveData) {
    const eventLog = saveData.eventLog || [];
    const recentEvents = eventLog.slice(-5);

    if (recentEvents.length === 0) {
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

function buildGmPrompt(saveData, appConfig) {
    const s = saveData;
    const p = s.player;
    const genre = s.world.genre || '自定义';
    const preset = getGenrePreset(genre);

    const toneGuide = preset.toneGuide || {
        '史诗': '使用宏大、庄重的语言，注重命运的厚重感和英雄主义色彩',
        '严肃': '保持冷静克制的叙事风格，注重逻辑和真实感',
        '轻松': '使用幽默轻松的语言，可以加入有趣的对话和情节',
        '黑暗': '使用压抑阴沉的语言，注重氛围渲染和心理恐惧',
        '幽默': '可以打破第四面墙，加入元幽默和有趣的梗',
    }[s.world.tone] || '保持一致的叙事风格';

    const userRules = s.world.rules || '';
    const presetRules = preset.worldRules || '';
    const worldRules = [presetRules, userRules].filter(Boolean).join('\n') || '无特殊规则';
    const narrativeTips = preset.narrativeTips || '';

    const narrativeTipsLine = narrativeTips ? '- 叙事技巧：' + narrativeTips : '';

    const globalInstructions = appConfig?.customInstructions || '';
    const saveInstructions = s.world.customPrompt || '';
    let customBlock = '';
    if (globalInstructions) {
        customBlock += '\n⚠️ 玩家自定义指令（全局，必须遵守）\n' + globalInstructions;
    }
    if (saveInstructions) {
        customBlock += '\n⚠️ 玩家自定义指令（本世界，必须遵守）\n' + saveInstructions;
    }

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
        playerName: p.name,
        playerGender: p.gender || '未设定',
        playerAge: p.age || '未设定',
        playerOccupation: p.occupation || '未设定',
        playerAppearance: p.appearance || '未设定',
        playerPersonality: p.personality || '未设定',
        playerBackstory: p.backstory || '未设定',
        recentPlotSummary: buildRecentPlotSummary(saveData),
        maxTokens: appConfig?.maxTokens || 4096,
    }) + customBlock;
}

module.exports = { buildGmPrompt };
