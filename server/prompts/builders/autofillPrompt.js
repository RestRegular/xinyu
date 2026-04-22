const registry = require('../registry');

/**
 * 构建 Autofill 系统提示词
 * 用于自动补全角色创建表单中的缺失字段
 * @param {Object} params - 表单数据
 * @returns {{ prompt: string, missing: string[] }} 提示词和缺失字段列表
 */
function buildAutofillPrompt(params) {
    const {
        worldName, genre, worldDesc, worldRules, tone,
        startLocation, startLocationDesc,
        playerName, playerGender, playerAge, playerRace, playerClass,
        playerAppearance, playerPersonality, playerBackstory,
        templateInfo,
    } = params;

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

    if (missing.length === 0) {
        return { prompt: '', missing: [] };
    }

    const prompt = registry.render('autofill_system', {
        worldName: worldName || '未填写',
        worldGenre: genre || '未填写',
        worldDesc: worldDesc || '未填写',
        worldRules: worldRules || '未填写',
        worldTone: tone || '未填写',
        startLocation: startLocation || '未填写',
        startLocationDesc: startLocationDesc || '未填写',
        playerName: playerName || '未填写',
        playerGender: playerGender || '未填写',
        playerAge: playerAge || '未填写',
        playerRace: playerRace || '未填写',
        playerClass: playerClass || '未填写',
        playerAppearance: playerAppearance || '未填写',
        playerPersonality: playerPersonality || '未填写',
        playerBackstory: playerBackstory || '未填写',
        templateInfo: templateInfo || '',
        missingFields: missing.join('、'),
    });

    return { prompt, missing };
}

module.exports = { buildAutofillPrompt };
