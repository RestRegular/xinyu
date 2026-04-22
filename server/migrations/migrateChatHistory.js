// ===================================================================
// ===== chatHistory 数据迁移脚本 =====
// ===================================================================
//
// 将旧格式的 chatHistory（数组）迁移为新的 CHM + RDM 格式
// 旧格式: chatHistory = [{ role, content, ... }, ...]
// 新格式: chatHistory = { messages: [...], notifications: [...] }
//          renderHistory = { renderBlocks: [...], currentOptions: [...] }
//
// ===================================================================

const ChatHistoryManager = require('../chatHistoryManager');
const RenderDataManager = require('../renderDataManager');

/**
 * 迁移旧格式的 saveData
 * @param {object} oldData - 旧格式的存档数据
 * @returns {object} 迁移后的存档数据
 */
function migrateSaveData(oldData) {
    // 如果已经是新格式，直接返回
    if (!Array.isArray(oldData.chatHistory)) {
        return oldData;
    }

    const chm = new ChatHistoryManager();
    const rdm = new RenderDataManager();

    for (const msg of oldData.chatHistory) {
        switch (msg.role) {
            case 'user':
                chm.addUserMessage(msg.content);
                rdm.appendUserMessage(msg.content);
                break;
            case 'assistant':
                // 保留原始结构
                chm.messages.push(msg);
                if (msg.structured && msg.structured.content) {
                    rdm.appendAssistantContent(msg.structured.content);
                    if (msg.structured.options) {
                        rdm.updateOptions(msg.structured.options);
                    }
                }
                break;
            case 'system':
                rdm.appendSystemMessage(msg.content);
                break;
            case 'notification':
                chm.addNotification(msg.content, msg.type);
                rdm.appendNotification(msg.content, msg.type);
                break;
        }
    }

    return {
        ...oldData,
        chatHistory: chm.toJSON(),
        renderHistory: rdm.toJSON(),
    };
}

module.exports = { migrateSaveData };
