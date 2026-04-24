const logger = require('./logger');
const { buildGmPrompt } = require('./prompts/builders/gmPrompt');
const { gameTools } = require('./prompts/tools/gameTools');
const { GENRE_PRESETS } = require('./prompts/presets/genrePresets');

function buildSystemPrompt(saveData, appConfig) {
    logger.debug('[Prompt] Building GM system prompt');
    const prompt = buildGmPrompt(saveData, appConfig);
    logger.debug('[Prompt] GM prompt length:', prompt.length);
    return prompt;
}

function buildMessageHistory(chatHistory) {
    const history = chatHistory || [];
    const filtered = history.filter(m => m.role === 'user' || m.role === 'assistant');
    if (filtered.length <= 30) return filtered;
    const keepRecent = 16;
    logger.info('[Messages] Compressing history', { total: filtered.length, keeping: keepRecent });
    const recent = filtered.slice(-keepRecent);
    const old = filtered.slice(0, -keepRecent);
    const summaryParts = [];
    let currentSpeaker = '';
    let currentContent = '';
    for (const msg of old) {
        const speaker = msg.role === 'user' ? '玩家' : 'GM';
        if (speaker !== currentSpeaker) {
            if (currentContent) summaryParts.push(`${currentSpeaker}: ${currentContent.slice(0, 100)}`);
            currentSpeaker = speaker;
            currentContent = msg.content;
        } else {
            currentContent += '；' + msg.content;
        }
    }
    if (currentContent) summaryParts.push(`${currentSpeaker}: ${currentContent.slice(0, 100)}`);
    const summary = summaryParts.join('\n');
    return [
        { role: 'system', content: `以下是之前冒险的摘要（已压缩，仅供参考）：\n${summary}\n\n请注意：以上是早期对话的压缩版本，以最近的对话内容为准。` },
        ...recent,
    ];
}

module.exports = {
    buildSystemPrompt,
    buildMessageHistory,
    gameTools,
    GENRE_PRESETS,
};
