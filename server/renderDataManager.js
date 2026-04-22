// ===================================================================
// ===== RenderDataManager (RDM) — 前端渲染数据管理 =====
// ===================================================================
//
// 职责：
//   - 将 AI 响应和事件通知转换为前端可直接使用的渲染数据
//   - 管理渲染块列表和当前选项按钮
//   - 支持从 CHM 重建渲染数据（降级方案）
//   - 序列化/反序列化，存入数据库
//
// ===================================================================

const logger = require('./logger');

class RenderDataManager {
    constructor() {
        this.renderBlocks = [];   // 持久化的渲染块列表
        this.currentOptions = []; // 当前选项按钮
    }

    /**
     * 追加 AI 响应内容块
     * @param {ContentBlock[]} contentBlocks - 来自 CHM 的结构化内容
     */
    appendAssistantContent(contentBlocks) {
        for (const block of contentBlocks) {
            const renderBlock = {
                id: this._generateId(),
                timestamp: new Date().toISOString(),
                ...this._convertContentBlock(block),
            };
            this.renderBlocks.push(renderBlock);
        }
    }

    /**
     * 追加玩家消息
     * @param {string} text - 原始文本
     * @param {object} playerAction - 玩家行为描述（可选，选项时由 UA 生成）
     */
    appendUserMessage(text, playerAction = null) {
        const renderBlock = {
            id: this._generateId(),
            type: 'player',
            timestamp: new Date().toISOString(),
            data: {
                action: playerAction?.action || null,
                dialogue: playerAction?.dialogue || text,
            },
        };
        this.renderBlocks.push(renderBlock);
    }

    /**
     * 追加通知
     */
    appendNotification(text, type = 'info') {
        this.renderBlocks.push({
            id: this._generateId(),
            type: 'notification',
            timestamp: new Date().toISOString(),
            data: { text, notifType: type },
        });
    }

    /**
     * 追加系统消息
     */
    appendSystemMessage(text) {
        this.renderBlocks.push({
            id: this._generateId(),
            type: 'system',
            timestamp: new Date().toISOString(),
            data: { text },
        });
    }

    /**
     * 更新选项按钮（替换旧的）
     */
    updateOptions(options) {
        this.currentOptions = options || [];
    }

    /**
     * 获取增量渲染数据（实时响应时使用）
     * @param {number} lastBlockIndex - 前端已知的最后渲染块索引
     */
    getRenderData(lastBlockIndex = -1) {
        const newBlocks = this.renderBlocks.slice(lastBlockIndex + 1);
        return {
            newBlocks,
            options: this.currentOptions,
        };
    }

    /**
     * 获取完整渲染历史（页面加载时使用）
     */
    getFullRenderHistory() {
        return {
            blocks: [...this.renderBlocks],
            options: [...this.currentOptions],
        };
    }

    /**
     * 从 CHM 重建渲染数据（降级方案）
     * 当 renderHistory 丢失或损坏时使用
     */
    rebuildFromCHM(chm) {
        logger.warn('[RDM] Rebuilding render data from CHM (fallback)');
        this.renderBlocks = [];
        this.currentOptions = [];

        const data = chm.toJSON();

        // 重建 messages
        for (const msg of data.messages) {
            if (msg.role === 'user') {
                this.appendUserMessage(msg.content);
            } else if (msg.role === 'assistant' && msg.structured) {
                this.appendAssistantContent(msg.structured.content);
                if (msg.structured.options) {
                    this.currentOptions = msg.structured.options;
                }
            }
        }

        // 重建 notifications
        for (const notif of data.notifications) {
            this.appendNotification(notif.text, notif.type);
        }

        return this.renderBlocks;
    }

    /**
     * 内部：将 AI 内容块转换为渲染块
     */
    _convertContentBlock(block) {
        switch (block.type) {
            case 'narrative':
                return { type: 'narrative', data: { text: block.text } };
            case 'scene':
                return { type: 'scene', data: { text: block.text } };
            case 'dialogue':
                return { type: 'dialogue', data: { speaker: block.speaker, text: block.text } };
            case 'action':
                return { type: 'action', data: { text: block.text } };
            case 'combat':
                return { type: 'combat', data: { text: block.text } };
            case 'loot':
                return { type: 'loot', data: { text: block.text } };
            case 'character':
                return {
                    type: 'character',
                    data: {
                        characterName: block.characterName,
                        mood: block.mood,
                        reaction: block.reaction,
                        dialogue: block.dialogue,
                    },
                };
            case 'player_action':
                return {
                    type: 'player',
                    data: { action: block.action, dialogue: block.dialogue },
                };
            default:
                logger.debug(`[RDM] Unknown block type: ${block.type}, falling back to narrative`);
                return { type: 'narrative', data: { text: block.text || '' } };
        }
    }

    _generateId() {
        return 'rb_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    }

    toJSON() {
        return {
            renderBlocks: this.renderBlocks,
            currentOptions: this.currentOptions,
        };
    }

    static fromJSON(data) {
        const mgr = new RenderDataManager();
        mgr.renderBlocks = data.renderBlocks || [];
        mgr.currentOptions = data.currentOptions || [];
        return mgr;
    }
}

module.exports = RenderDataManager;
