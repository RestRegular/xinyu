// ===================================================================
// ===== AI 编排服务（服务端版） =====
// ===================================================================

const { executeCharacterTool, getRelationshipTitle } = require('./gameEngine');
const logger = require('./logger');

// 新的提示词构建器
const { buildGmPrompt } = require('./prompts/builders/gmPrompt');
const { buildCharacterPrompt: buildCharacterPromptNew } = require('./prompts/builders/characterPrompt');
const { buildUserAgentPrompt: buildUserAgentPromptNew } = require('./prompts/builders/userAgentPrompt');

// 从新模块导入（兼容导出）
const { gameTools } = require('./prompts/tools/gameTools');
const { characterTools } = require('./prompts/tools/characterTools');
const { GENRE_PRESETS } = require('./prompts/presets/genrePresets');

// ===================================================================
// ===== GM System Prompt 构建 =====
// ===================================================================
function buildSystemPrompt(saveData, appConfig) {
    logger.debug('[Prompt] Building GM system prompt');
    const prompt = buildGmPrompt(saveData, appConfig);
    logger.debug('[Prompt] GM prompt length:', prompt.length);
    return prompt;
}

// ===================================================================
// ===== 角色AI Prompt 构建 =====
// ===================================================================
function buildCharacterPrompt(character, saveData) {
    logger.debug(`[Prompt] Building character prompt for ${character.name}`);
    return buildCharacterPromptNew(character, saveData);
}

// ===================================================================
// ===== 对话历史管理 =====
// ===================================================================
// @deprecated 此函数将在 Phase 4 清理时删除，请使用 ChatHistoryManager.buildAIMessages()
const SUMMARIZE_THRESHOLD = 30;

function buildMessageHistory(chatHistory) {
    const history = chatHistory || [];
    const filtered = history.filter(m => m.role === 'user' || m.role === 'assistant');

    if (filtered.length <= SUMMARIZE_THRESHOLD) return filtered;

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
    // 新的提示词构建器（推荐使用）
    buildSystemPrompt,
    buildMessageHistory,
    buildCharacterPrompt,
    buildUserAgentPrompt,
    // 旧的导出（向后兼容，已废弃）
    gameTools,
    characterTools,
    GENRE_PRESETS,
};

/**
 * 构建 UserAgent 的系统提示词
 * UA 负责根据玩家选择的选项，生成玩家角色的行为描述和对话内容
 */
function buildUserAgentPrompt(saveData) {
    return buildUserAgentPromptNew(saveData);
}
