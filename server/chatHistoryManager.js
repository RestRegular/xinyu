// ===================================================================
// ===== ChatHistoryManager (CHM) — AI 对话消息管理 =====
// ===================================================================
//
// 职责：
//   - 存储 AI 对话消息（user / assistant）
//   - 管理通知事件（独立于 AI 对话）
//   - 压缩旧消息，构建发送给 LLM 的消息数组
//   - 序列化/反序列化，存入数据库
//
// ===================================================================

const logger = require('./logger');

class ChatHistoryManager {
    constructor(options = {}) {
        this.messages = [];           // AI 对话消息
        this.notifications = [];      // 通知事件（独立存储）
        this.summarizeThreshold = options.summarizeThreshold || 30;
        this.keepRecent = options.keepRecent || 16;
    }

    /**
     * 添加用户消息
     * @param {string} text - 消息文本
     * @param {boolean} isSystem - 是否为系统消息（如 [系统] 开头的指令）
     */
    addUserMessage(text, isSystem = false) {
        this.messages.push({
            role: isSystem ? 'system' : 'user',
            content: text,
            timestamp: new Date().toISOString(),
        });
    }

    /**
     * 添加 AI 响应
     * @param {string} rawContent - AI 原始输出文本
     * @param {ContentBlock[]} contentBlocks - 解析后的结构化内容
     * @param {Option[]} options - 选项按钮
     * @param {object} playerAction - 玩家行为描述（选项时）
     */
    addAssistantResponse(rawContent, contentBlocks, options = [], playerAction = null) {
        const finalContent = playerAction
            ? [playerAction, ...contentBlocks]
            : contentBlocks;

        this.messages.push({
            role: 'assistant',
            content: rawContent,
            structured: {
                content: finalContent,
                options: options.length > 0 ? options : undefined,
            },
            timestamp: new Date().toISOString(),
        });
    }

    /**
     * 添加通知事件
     */
    addNotification(text, type = 'info') {
        this.notifications.push({
            text,
            type,
            timestamp: new Date().toISOString(),
        });
    }

    /**
     * 构建发送给 AI 的消息数组
     * - 只包含 user/assistant
     * - 超过阈值时压缩旧消息
     * @returns {AIMessage[]}
     */
    buildAIMessages() {
        const filtered = this.messages.filter(m => m.role === 'user' || m.role === 'assistant');

        if (filtered.length <= this.summarizeThreshold) {
            return filtered.map(m => ({ role: m.role, content: m.content }));
        }

        logger.info('[CHM] Message compression triggered', { total: filtered.length, keeping: this.keepRecent });

        const recent = filtered.slice(-this.keepRecent);
        const old = filtered.slice(0, -this.keepRecent);

        // 压缩旧消息为摘要
        const summaryParts = [];
        let currentSpeaker = '';
        let currentContent = '';

        for (const msg of old) {
            const speaker = msg.role === 'user' ? '玩家' : 'GM';
            if (speaker !== currentSpeaker) {
                if (currentContent) {
                    summaryParts.push(`${currentSpeaker}: ${currentContent.slice(0, 100)}`);
                }
                currentSpeaker = speaker;
                currentContent = msg.content;
            } else {
                currentContent += '；' + msg.content;
            }
        }
        if (currentContent) {
            summaryParts.push(`${currentSpeaker}: ${currentContent.slice(0, 100)}`);
        }

        const summary = summaryParts.join('\n');
        return [
            {
                role: 'system',
                content: `以下是之前冒险的摘要（已压缩，仅供参考）：\n${summary}\n\n请注意：以上是早期对话的压缩版本，以最近的对话内容为准。`,
            },
            ...recent.map(m => ({ role: m.role, content: m.content })),
        ];
    }

    /**
     * 获取所有通知（自上次调用以来新增的）
     */
    getNotifications(sinceTimestamp = null) {
        if (!sinceTimestamp) return [...this.notifications];
        return this.notifications.filter(n => n.timestamp > sinceTimestamp);
    }

    /**
     * 获取最近一条 assistant 消息的 structured 数据
     */
    getRecentAssistantStructured() {
        for (let i = this.messages.length - 1; i >= 0; i--) {
            if (this.messages[i].role === 'assistant' && this.messages[i].structured) {
                return this.messages[i].structured;
            }
        }
        return null;
    }

    isEmpty() {
        return this.messages.length === 0;
    }

    toJSON() {
        return {
            messages: this.messages,
            notifications: this.notifications,
        };
    }

    static fromJSON(data) {
        if (!data || typeof data !== 'object') {
            logger.warn('[CHM] Invalid data format in fromJSON');
        }
        const mgr = new ChatHistoryManager();
        mgr.messages = data?.messages || [];
        mgr.notifications = data?.notifications || [];
        return mgr;
    }
}

module.exports = ChatHistoryManager;
