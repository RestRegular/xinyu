// 游戏工具引擎 - 已精简为纯叙事模式
// 所有游戏状态工具已移除，AI 专注于叙事和选项生成

function executeGameFunction(name, args, saveData) {
    return { success: false, error: `工具 "${name}" 在纯叙事模式下不可用` };
}

module.exports = { executeGameFunction };
