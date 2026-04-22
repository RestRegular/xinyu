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
            if (!this._isRenderableBlock(block)) continue;
            const converted = this._convertContentBlock(block);
            if (!converted) continue; // 跳过空块
            const renderBlock = {
                id: this._generateId(),
                timestamp: new Date().toISOString(),
                ...converted,
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
     * 将 messages 和 notifications 合并后按 timestamp 排序，确保正确的时间顺序
     */
    rebuildFromCHM(chm) {
        logger.warn('[RDM] Rebuilding render data from CHM (fallback)');
        this.renderBlocks = [];
        this.currentOptions = [];

        const data = chm.toJSON();
        const allBlocks = [];

        // 转换 messages 为渲染块
        for (const msg of data.messages) {
            if (msg.role === 'user') {
                allBlocks.push({
                    id: msg.timestamp ? 'msg_' + new Date(msg.timestamp).getTime() : this._generateId(),
                    type: 'player',
                    timestamp: msg.timestamp || new Date().toISOString(),
                    data: { action: null, dialogue: msg.content },
                });
            } else if (msg.role === 'assistant' && msg.structured && msg.structured.content) {
                for (const block of msg.structured.content) {
                    if (!this._isRenderableBlock(block)) continue;
                    allBlocks.push({
                        id: this._generateId(),
                        timestamp: msg.timestamp || new Date().toISOString(),
                        ...this._convertContentBlock(block),
                    });
                }
                if (msg.structured.options) {
                    this.currentOptions = msg.structured.options;
                }
            }
            // system 消息不转换（CHM 中不存储 system）
        }

        // 转换 notifications 为渲染块
        for (const notif of data.notifications) {
            allBlocks.push({
                id: this._generateId(),
                type: 'notification',
                timestamp: notif.timestamp || new Date().toISOString(),
                data: { text: notif.text, notifType: notif.type || 'info' },
            });
        }

        // 按 timestamp 排序（稳定排序，相同 timestamp 保持原始顺序）
        allBlocks.sort((a, b) => {
            const ta = new Date(a.timestamp).getTime();
            const tb = new Date(b.timestamp).getTime();
            if (ta !== tb) return ta - tb;
            return 0; // 相同 timestamp 保持原始顺序（稳定排序）
        });

        this.renderBlocks = allBlocks;
        return this.renderBlocks;
    }

    /**
     * 内部：判断 content block 是否应该被渲染（过滤工具结果等）
     */
    _isRenderableBlock(block) {
        if (!block || typeof block !== 'object' || !block.type) return false;
        // 工具结果 JSON 被误当 narrative
        if (block.type === 'narrative' && block.text && block.text.startsWith('{')) {
            try { JSON.parse(block.text); return false; } catch(e) {}
        }
        return true;
    }

    /**
     * 内部：将 AI 内容块转换为渲染块
     */
    _convertContentBlock(block) {
        switch (block.type) {
            case 'narrative':
                if (!block.text) return null;
                return { type: 'narrative', data: { text: block.text } };
            case 'scene':
                if (!block.text) return null;
                return { type: 'scene', data: { text: block.text } };
            case 'dialogue':
                if (!block.text) return null;
                return { type: 'dialogue', data: { speaker: block.speaker, text: block.text } };
            case 'action':
                if (!block.text) return null;
                return { type: 'action', data: { text: block.text } };
            case 'combat':
                if (!block.text) return null;
                return { type: 'combat', data: { text: block.text } };
            case 'loot':
                if (!block.text) return null;
                return { type: 'loot', data: { text: block.text } };
            case 'character':
                if (!block.dialogue && !block.reaction) return null;
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
                if (!block.action && !block.dialogue) return null;
                return {
                    type: 'player',
                    data: { action: block.action, dialogue: block.dialogue },
                };
            default:
                logger.debug(`[RDM] Unknown block type: ${block.type}, falling back to narrative`);
                if (!block.text) return null;
                return { type: 'narrative', data: { text: block.text } };
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
