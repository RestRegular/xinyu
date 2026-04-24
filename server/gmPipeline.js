// ===================================================================
// ===== GM 多 Agent 系统 — OOP 架构 =====
// ===================================================================
//
// 类图：
//   BaseAgent (基类)
//     ├── StoryAgent    (SA) — 叙事 + 角色交互
//     ├── RoleAgent     (RA) — 角色创建/管理
//     ├── MapAgent      (MA) — 地图/地点管理
//     └── PropertyAgent (PA) — 属性/物品/状态管理
//
//   Pipeline (编排器) — 协调各 Agent 的执行流程
//
// 设计原则：
//   1. 单一职责：每个 Agent 只负责一类操作
//   2. 开闭原则：新增 Agent 只需继承 BaseAgent，不修改现有代码
//   3. 依赖倒置：Pipeline 依赖 BaseAgent 接口，不依赖具体子类
//   4. 工具归属：每个 Agent 声明自己能处理的工具列表
//
// ===================================================================

const { buildSystemPrompt, buildMessageHistory, buildCharacterPrompt, buildUserAgentPrompt } = require('./aiService');
const { gameTools, characterTools } = require('./prompts');
const { executeGameFunction, executeCharacterTool } = require('./gameEngine');
const logger = require('./logger');

// ===================================================================
// ===== BaseAgent — 基类 =====
// ===================================================================

class BaseAgent {
    /**
     * @param {object} config
     * @param {string} config.name       — Agent 名称（如 'SA', 'RA'）
     * @param {string} config.label      — 人类可读标签（如 '叙事Agent'）
     * @param {string[]} config.toolNames — 该 Agent 负责处理的工具名列表
     */
    constructor({ name, label, toolNames }) {
        this.name = name;
        this.label = label;
        this.toolNames = new Set(toolNames);
        this.callLog = []; // 记录本 Agent 处理的所有调用
    }

    /**
     * 判断某个工具是否属于本 Agent
     */
    canHandle(toolName) {
        return this.toolNames.has(toolName);
    }

    /**
     * 执行工具调用（子类可覆盖以添加前置/后置逻辑）
     * @param {string} toolName — 工具名
     * @param {object} args     — 工具参数
     * @param {object} saveData — 存档数据（会被直接修改）
     * @returns {object} 工具执行结果
     */
    executeTool(toolName, args, saveData) {
        const result = executeGameFunction(toolName, args, saveData);
        this._logCall(toolName, args, result);
        return result;
    }

    /**
     * 异步执行（子类覆盖以支持 AI 调用等异步操作）
     * @param {string} toolName
     * @param {object} args
     * @param {object} saveData
     * @param {object} apiConfig — { apiKey, apiBaseUrl, model, temperature, maxTokens }
     * @returns {Promise<object>}
     */
    async executeAsync(toolName, args, saveData, apiConfig) {
        // 默认行为：同步执行，包装为 Promise
        const result = this.executeTool(toolName, args, saveData);
        return result;
    }

    /**
     * 后处理钩子（子类覆盖以添加 Agent 特有的后处理逻辑）
     * @param {object} saveData
     * @param {object} apiConfig
     * @returns {Promise<object[]>} 额外的通知列表
     */
    async postProcess(saveData, apiConfig) {
        return [];
    }

    /**
     * 获取本 Agent 的工具定义（从 gameTools 中过滤）
     */
    getToolDefinitions() {
        return gameTools.filter(t => this.toolNames.has(t.function.name));
    }

    /**
     * 获取调用日志
     */
    getLog() {
        return this.callLog;
    }

    /**
     * 清空调用日志
     */
    clearLog() {
        this.callLog = [];
    }

    /**
     * 内部：记录调用日志
     */
    _logCall(toolName, args, result) {
        this.callLog.push({
            toolName,
            args,
            success: result.success !== false,
            timestamp: new Date().toISOString(),
        });
    }
}

// ===================================================================
// ===== StoryAgent (SA) — 叙事 + 角色交互 =====
// ===================================================================

class StoryAgent extends BaseAgent {
    constructor() {
        super({
            name: 'SA',
            label: '叙事Agent',
            toolNames: ['get_character_reaction'],
        });
    }

    /**
     * SA 的 get_character_reaction 需要异步调用角色 AI
     */
    async executeAsync(toolName, args, saveData, apiConfig) {
        if (toolName === 'get_character_reaction') {
            const result = await this._callCharacterAI(args, saveData, apiConfig);
            this._logCall(toolName, args, result);
            return result;
        }
        return super.executeAsync(toolName, args, saveData, apiConfig);
    }

    /**
     * 调用角色 AI 获取反应
     */
    async _callCharacterAI(args, saveData, apiConfig) {
        const { apiKey, apiBaseUrl, model, temperature } = apiConfig;
        const charName = args.character_name;
        const context = args.context || '';

        if (!saveData.characters) return { success: false, error: '当前没有重要角色' };

        const character = Object.values(saveData.characters).find(c => c.name === charName);
        if (!character) return { success: false, error: `未找到角色"${charName}"` };

        const charData = character;
        logger.debug(`[CharacterAI] Calling ${charData.name}`);

        character.lastInteractedAt = new Date().toISOString();

        const charPrompt = buildCharacterPrompt(character, saveData);
        const charMessages = [
            { role: 'system', content: charPrompt },
            { role: 'user', content: `情境：${context}\n\n请给出你的反应和回应。` },
        ];

        // 请求角色 AI（含重试）
        let response;
        let retries = 0;
        const charTimer = logger.timer();
        while (retries < 2) {
            try {
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), 60000);
                response = await fetch(apiBaseUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                    body: JSON.stringify({
                        model, messages: charMessages, tools: characterTools,
                        temperature: Math.max(0.6, (temperature || 0.9) - 0.2),
                        max_tokens: 1024, stream: true,
                    }),
                    signal: controller.signal,
                });
                clearTimeout(timer);
                break;
            } catch (err) {
                retries++;
                if (retries >= 2) return { success: false, error: '角色AI请求失败' };
                logger.warn(`[CharacterAI] ${charData.name} retry`, { attempt: retries });
                await new Promise(r => setTimeout(r, 1000 * retries));
            }
        }

        if (!response.ok) {
            const errText = await response.text().catch(() => '');
            return { success: false, error: `角色AI错误: ${errText}` };
        }

        // 解析角色 AI 响应
        let result;
        try {
            result = await parseStreamResponse(response);
        } catch (err) {
            try {
                result = await parseNonStreamResponse(apiBaseUrl, apiKey, model, charMessages, characterTools, { temperature: 0.7, max_tokens: 1024 });
            } catch (e) {
                return { success: false, error: '角色AI响应解析失败' };
            }
        }

        logger.debug(`[CharacterAI] ${charData.name} responded`);
        charTimer.done(`CharacterAI:${charData.name}`);

        // 处理角色 AI 的 tool calls（update_relationship, add_memory）
        if (result.tool_calls && result.tool_calls.length > 0) {
            for (const tc of result.tool_calls) {
                let fnArgs;
                try { fnArgs = JSON.parse(tc.function.arguments); } catch (e) { fnArgs = {}; }
                executeCharacterTool(tc.function.name, fnArgs, character, saveData);
            }
        }

        // 解析角色 AI 返回的 JSON
        let charReaction = { segments: [], mood: 'neutral' };
        try {
            const jsonMatch = result.content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                // 新格式：segments 数组
                if (parsed.segments && Array.isArray(parsed.segments)) {
                    charReaction.segments = parsed.segments;
                } else {
                    // 兼容旧格式：reaction + dialogue 转换为 segments
                    const segs = [];
                    if (parsed.reaction) segs.push({ type: 'reaction', text: parsed.reaction });
                    if (parsed.dialogue) segs.push({ type: 'dialogue', text: parsed.dialogue });
                    charReaction.segments = segs.length > 0 ? segs : [{ type: 'dialogue', text: result.content }];
                }
                charReaction.mood = parsed.mood || 'neutral';
            }
        } catch (e) {
            charReaction.segments = [{ type: 'dialogue', text: result.content }];
        }

        return {
            success: true,
            characterId: character.id,
            characterName: character.name,
            segments: charReaction.segments,
            mood: charReaction.mood,
            relationship_value: character.relationship.value,
            relationship_title: character.relationship.title,
        };
    }
}

// ===================================================================
// ===== RoleAgent (RA) — 角色管理 =====
// ===================================================================

class RoleAgent extends BaseAgent {
    constructor() {
        super({
            name: 'RA',
            label: '角色Agent',
            toolNames: ['create_character', 'update_relationship', 'character_action', 'remove_npc'],
        });
    }

    /**
     * RA 后处理：检查新创建的角色是否需要补充默认值
     */
    async postProcess(saveData, apiConfig) {
        const notifications = [];
        for (const log of this.callLog) {
            if (log.toolName === 'create_character' && log.success) {
                // 角色创建后的额外处理（当前无需额外操作，预留扩展点）
            }
        }
        return notifications;
    }
}

// ===================================================================
// ===== MapAgent (MA) — 地图管理 =====
// ===================================================================

class MapAgent extends BaseAgent {
    constructor() {
        super({
            name: 'MA',
            label: '地图Agent',
            toolNames: ['move_to_location', 'create_location'],
        });
    }

    /**
     * MA 后处理：确保新地点的双向连接
     */
    async postProcess(saveData, apiConfig) {
        const notifications = [];
        for (const log of this.callLog) {
            if (log.toolName === 'move_to_location' && log.success) {
                const locName = log.args.location_name;
                const loc = saveData.map.locations[locName];
                if (loc && loc.connections) {
                    // 确保当前位置在新地点的连接中
                    // (gameEngine 已处理，此处为防御性检查)
                }
            }
        }
        return notifications;
    }
}

// ===================================================================
// ===== PropertyAgent (PA) — 属性/物品/状态管理 =====
// ===================================================================

class PropertyAgent extends BaseAgent {
    constructor() {
        super({
            name: 'PA',
            label: '属性Agent',
            toolNames: [
                'update_attributes', 'add_item', 'remove_item',
                'add_status_effect', 'remove_status_effect',
                'update_gold', 'check_death', 'equip_item', 'revive_player',
            ],
        });
    }

    /**
     * PA 后处理：检查玩家是否死亡
     */
    async postProcess(saveData, apiConfig) {
        const notifications = [];
        const hp = saveData.player.attributes.hp.current;
        if (hp <= 0) {
            // 确保死亡状态被正确处理
            const deathResult = executeGameFunction('check_death', {}, saveData);
            if (deathResult.is_dead && deathResult.notifications) {
                notifications.push(...deathResult.notifications);
            }
        }
        return notifications;
    }
}

// ===================================================================
// ===== Pipeline — 编排器 =====
// ===================================================================

class Pipeline {
    constructor() {
        // 注册所有 Agent
        this.agents = [
            new StoryAgent(),
            new RoleAgent(),
            new MapAgent(),
            new PropertyAgent(),
        ];

        // 构建工具名 → Agent 的快速查找表
        this.toolAgentMap = new Map();
        for (const agent of this.agents) {
            for (const toolName of agent.toolNames) {
                this.toolAgentMap.set(toolName, agent);
            }
        }
    }

    /**
     * 查找负责某个工具的 Agent
     */
    getAgentForTool(toolName) {
        return this.toolAgentMap.get(toolName) || null;
    }

    /**
     * 获取所有 Agent
     */
    getAllAgents() {
        return this.agents;
    }

    /**
     * 执行完整的 GM 管线
     * @param {object} saveData   — 存档数据
     * @param {string} userMessage — 用户消息
     * @param {object} apiConfig  — { apiKey, apiBaseUrl, model, temperature, maxTokens }
     * @param {object} appConfig  — 应用配置
     * @param {Array}  [aiMessages] — 预构建的 AI 消息数组（来自 CHM.buildAIMessages()）
     * @returns {Promise<{content, options, notifications, saveData}>}
     */
    async run(saveData, userMessage, apiConfig, appConfig, aiMessages = null) {
        const postProcessNotifications = [];  // 后处理/自动升级产生的通知（需追加到末尾）
        const orderedBlocks = [];     // 有序内容块列表（content + notification 交错排列）
        const allContentParts = [];   // 收集所有循环中的纯文本内容
        let totalToolCalls = 0;

        // ===== Phase 1: StoryAgent 主循环 =====
        const systemPrompt = buildSystemPrompt(saveData, appConfig);
        const history = aiMessages || buildMessageHistory(saveData.chatHistory);
        const messages = [{ role: 'system', content: systemPrompt }, ...history];

        logger.info('[Pipeline] Starting run', { messageCount: messages.length });

        const MAX_LOOPS = 10;
        const MAX_RETRIES = 3;
        const API_TIMEOUT = 5 * 60 * 1000;

        let loopCount = 0;
        while (loopCount < MAX_LOOPS) {
            loopCount++;

            logger.debug(`[Pipeline] Loop ${loopCount} starting`);

            // 请求 AI
            const llmTimer = logger.timer();
            const response = await this._requestLLM(apiConfig, messages, gameTools, MAX_RETRIES, API_TIMEOUT);
            llmTimer.done('LLM request');

            // 解析响应
            const result = await this._parseResponse(response, apiConfig, messages, gameTools, appConfig);

            // 调试：打印 AI 原始响应摘要
            const contentPreview = result.content ? result.content.substring(0, 200) : '(empty)';
            const toolNames = result.tool_calls ? result.tool_calls.map(tc => tc.function.name) : [];
            logger.info(`[Pipeline] LLM response: content="${contentPreview}" | tools=[${toolNames.join(', ')}]`);

            const assistantMsg = { role: 'assistant', content: result.content };
            if (result.tool_calls) assistantMsg.tool_calls = result.tool_calls;
            messages.push(assistantMsg);

            // ===== 收集纯文本内容 =====
            if (result.content && result.content.trim()) {
                allContentParts.push(result.content.trim());
            }

            // ===== 处理 tool calls（状态变更工具） =====
            if (result.tool_calls && result.tool_calls.length > 0) {
                for (const tc of result.tool_calls) {
                    const fnName = tc.function.name;
                    let fnArgs;
                    try { fnArgs = JSON.parse(tc.function.arguments); } catch (e) { fnArgs = {}; }

                    logger.info(`[Pipeline] Tool call: ${fnName}`, { args: fnArgs });

                    // 跳过已废弃的工具
                    if (fnName === 'add_content_blocks') {
                        logger.warn(`[Pipeline] add_content_blocks called (deprecated), skipping`);
                        messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ success: true, message: '此工具已废弃。请直接在文本中写叙事内容。' }) });
                        continue;
                    }

                    // 查找负责的 Agent
                    const agent = this.getAgentForTool(fnName);
                    if (!agent) {
                        logger.warn(`[Pipeline] Unknown tool: ${fnName}`);
                        const toolResult = executeGameFunction(fnName, fnArgs, saveData);
                        if (toolResult.notifications) {
                            for (const notif of toolResult.notifications) {
                                orderedBlocks.push({ type: '_notification', text: notif.text, notifType: notif.type || 'info' });
                            }
                        }
                        messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(toolResult) });
                        totalToolCalls++;
                        continue;
                    }

                    // 委托给对应 Agent 执行
                    const agentTimer = logger.timer();
                    const toolResult = await agent.executeAsync(fnName, fnArgs, saveData, apiConfig);
                    agentTimer.done(`Agent:${agent.name}`);
                    logger.info(`[Pipeline] Tool result: ${fnName}`, { success: !toolResult.error, hasNotifications: !!(toolResult.notifications?.length) });
                    if (toolResult.notifications) {
                        for (const notif of toolResult.notifications) {
                            orderedBlocks.push({ type: '_notification', text: notif.text, notifType: notif.type || 'info' });
                        }
                    }
                    messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(toolResult) });
                    totalToolCalls++;
                }
                logger.info(`[Pipeline] Loop ${loopCount} completed`, { toolCalls: result.tool_calls.length });
                continue;
            }

            // ===== AI 未调用工具：纯文本回复，结束循环 =====
            break;
        }

        // 退出循环时的状态摘要
        logger.info(`[Pipeline] Loop exited: loops=${loopCount}, toolCalls=${totalToolCalls}, contentParts=${allContentParts.length}`);

        // ===== Phase 1.5: 提取器 — 从纯文本中提取选项和角色对话 =====
        const fullContent = allContentParts.join('\n\n');
        let extractedOptions = null;
        let extractedCharacterBlocks = [];

        if (fullContent) {
            logger.info('[Pipeline] Phase 1.5: Running content extractor');
            const extractTimer = logger.timer();
            const extracted = await this._extractStructuredContent(fullContent, saveData, apiConfig);
            extractTimer.done('Content extractor');
            extractedOptions = extracted.options;
            extractedCharacterBlocks = extracted.characterBlocks;
            logger.info(`[Pipeline] Extractor result: ${extractedOptions.length} options, ${extractedCharacterBlocks.length} character blocks`);
        }

        // ===== Phase 2: 各 Agent 后处理（并行） =====
        logger.info('[Pipeline] Phase 2: Post-processing');
        const postProcessPromises = this.agents.map(agent => agent.postProcess(saveData, apiConfig));
        const postResults = await Promise.all(postProcessPromises);
        for (const notifications of postResults) {
            if (notifications.length > 0) postProcessNotifications.push(...notifications);
        }

        // Agent 调用摘要
        const toolCallLog = []; // 收集工具调用详情，返回给前端用于调试
        for (const agent of this.agents) {
            if (agent.callLog.length > 0) {
                logger.info(`[Agent:${agent.name}] ${agent.callLog.length} tool calls`);
                for (const log of agent.callLog) {
                    toolCallLog.push({ agent: agent.name, ...log });
                    logger.info(`[Agent:${agent.name}] ${log.toolName}`, { args: log.args, success: log.success });
                }
            }
        }

        // ===== Phase 3: 组装最终输出 =====
        logger.info('[Pipeline] Assembling final output');

        // 构建内容块：叙事文本 + 提取的角色对话 + 工具通知
        const finalContent = [];

        // 1. 叙事文本作为 narrative 块
        if (fullContent) {
            finalContent.push({ type: 'narrative', text: fullContent });
        }

        // 2. 提取的角色对话块
        for (const charBlock of extractedCharacterBlocks) {
            finalContent.push(charBlock);
        }

        // 3. 工具通知
        for (const block of orderedBlocks) {
            if (block.type === '_notification') {
                finalContent.push({ type: '_notification', text: block.text, notifType: block.notifType });
            }
        }

        // 清理所有 Agent 日志
        this.agents.forEach(a => a.clearLog());

        logger.info('[Pipeline] Run completed', { totalLoops: loopCount, totalToolCalls });

        let finalOptions = extractedOptions || [];

        // ===== 选项补充：如果提取器未生成选项，自动补充 =====
        if (finalOptions.length === 0) {
            logger.info('[Pipeline] No options generated, requesting fallback options');
            try {
                finalOptions = await this._requestFallbackOptions(saveData, apiConfig, messages);
                if (finalOptions.length > 0) {
                    logger.info(`[Pipeline] Fallback options generated: ${finalOptions.length}`);
                }
            } catch (err) {
                logger.warn('[Pipeline] Failed to generate fallback options', { error: err.message });
            }
        }

        return {
            content: finalContent,
            options: finalOptions,
            notifications: postProcessNotifications,
            saveData,
            loops: loopCount,
            toolCallCount: totalToolCalls,
            toolCallLog,
            hasOrderedContent: orderedBlocks.length > 0,
        };
    }

    /**
     * 内容提取器：从 AI 的纯文本叙事中提取玩家选项和角色对话
     * 使用低温度、结构化 prompt 确保输出稳定
     */
    async _extractStructuredContent(narrativeText, saveData, apiConfig) {
        const { apiKey, apiBaseUrl, model } = apiConfig;
        const location = saveData.map?.locations?.[saveData.map.currentLocation];
        const locationHint = location ? `当前位置：${saveData.map.currentLocation}` : '';
        const characters = saveData.characters || {};
        const characterList = Object.values(characters).map(c => c.name).filter(Boolean).join('、') || '无';

        const extractPrompt = `你是一个内容分析器。分析以下 GM 叙事文本，提取结构化信息。

## 当前游戏状态
- ${locationHint}
- 场景中的角色：${characterList}

## 叙事文本
${narrativeText}

## 任务
请严格按以下 JSON 格式输出，不要输出任何其他内容：

{
  "options": [
    {"text": "玩家看到的选项文本（简短有力）", "action": "玩家发送的实际文本（描述具体行动）"},
    {"text": "选项2", "action": "行动2"},
    {"text": "选项3", "action": "行动3"}
  ],
  "characters": [
    {
      "name": "角色名",
      "mood": "当前心情",
      "segments": [
        {"type": "reaction", "text": "角色的动作/表情描写"},
        {"type": "dialogue", "text": "角色的口语内容"}
      ]
    }
  ]
}

规则：
1. options：生成 2-4 个有实质差异的行动选项。text 是简短描述（10字以内），action 是具体行动描述（15-30字）
2. characters：提取文本中所有有名字的角色的对话和动作。如果文本中没有角色对话，返回空数组
3. segments 中 reaction 是动作/表情（第三人称），dialogue 是口语内容
4. 只输出 JSON，不要输出任何其他文本`;

        try {
            const response = await fetch(apiBaseUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                body: JSON.stringify({
                    model,
                    messages: [{ role: 'user', content: extractPrompt }],
                    temperature: 0.3,  // 低温度确保稳定
                    max_tokens: 1024,
                    stream: false,
                }),
            });

            if (!response.ok) {
                logger.warn('[Extractor] Request failed', { status: response.status });
                return { options: [], characterBlocks: [] };
            }

            const data = await response.json();
            const content = data.choices?.[0]?.message?.content || '';

            // 解析 JSON
            let parsed;
            try {
                // 尝试直接解析
                parsed = JSON.parse(content);
            } catch (e) {
                // 尝试从文本中提取 JSON
                const jsonMatch = content.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    parsed = JSON.parse(jsonMatch[0]);
                } else {
                    throw new Error('No JSON found in response');
                }
            }

            // 提取选项
            const options = (parsed.options || []).map(opt => ({
                text: opt.text || '',
                action: opt.action || opt.text || '',
            })).filter(opt => opt.text);

            // 提取角色对话块
            const characterBlocks = (parsed.characters || []).map(char => ({
                type: 'character',
                characterName: char.name || '???',
                mood: char.mood,
                segments: (char.segments || []).filter(seg => seg.text),
            })).filter(char => char.segments.length > 0);

            return { options, characterBlocks };
        } catch (err) {
            logger.warn('[Extractor] Failed to extract structured content', { error: err.message });
            return { options: [], characterBlocks: [] };
        }
    }

    /**
     * 请求 AI 补充选项（当提取器未生成选项时调用）
     */
    async _requestFallbackOptions(saveData, apiConfig, messages) {
        const { apiKey, apiBaseUrl, model } = apiConfig;
        const loc = saveData.map?.locations?.[saveData.map.currentLocation];
        const locationHint = loc ? `当前位置：${saveData.map.currentLocation}。` : '';

        const promptMessages = [
            ...messages,
            { role: 'user', content: `你刚才的回复中没有提供选项。${locationHint}请根据当前剧情，生成 2-4 个有实质差异的行动选项。只输出 JSON，不要输出其他内容：\n{"options":[{"text":"选项文本","action":"玩家发送的实际文本"}]}` },
        ];

        const response = await fetch(apiBaseUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
            body: JSON.stringify({ model, messages: promptMessages, temperature: 0.7, max_tokens: 512, stream: false }),
        });

        if (!response.ok) return [];
        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || '';

        // 尝试解析 JSON
        try {
            const parsed = JSON.parse(content);
            if (parsed.options && Array.isArray(parsed.options)) {
                return parsed.options.map(opt => ({
                    text: opt.text || opt.label || '',
                    action: opt.action || opt.text || opt.label || '',
                }));
            }
        } catch (e) {}

        // 尝试从文本中提取 JSON
        const jsonMatch = content.match(/\{[\s\S]*"options"[\s\S]*\}/);
        if (jsonMatch) {
            try {
                const parsed = JSON.parse(jsonMatch[0]);
                if (parsed.options && Array.isArray(parsed.options)) {
                    return parsed.options.map(opt => ({
                        text: opt.text || opt.label || '',
                        action: opt.action || opt.text || opt.label || '',
                    }));
                }
            } catch (e) {}
        }

        return [];
    }

    /**
     * 请求 LLM（含重试）
     */
    async _requestLLM(apiConfig, messages, tools, maxRetries, timeout) {
        const { apiKey, apiBaseUrl, model, temperature, maxTokens } = apiConfig;
        let retries = 0;

        while (true) {
            try {
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), timeout);
                const response = await fetch(apiBaseUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                    body: JSON.stringify({ model, messages, tools, temperature: temperature || 0.9, max_tokens: maxTokens || 4096, stream: true }),
                    signal: controller.signal,
                });
                clearTimeout(timer);

                if (!response.ok) {
                    const errText = await response.text().catch(() => '');
                    throw new Error(`AI 请求失败 (${response.status}): ${errText}`);
                }
                logger.debug('[LLM] Response received');
                return response;
            } catch (err) {
                retries++;
                if (retries >= maxRetries) {
                    logger.error('[LLM] All retries exhausted');
                    throw err;
                }
                logger.warn('[LLM] Request failed, retrying...', { attempt: retries, error: err.message });
                await new Promise(r => setTimeout(r, 1000 * retries));
            }
        }
    }

    /**
     * 解析 LLM 响应（流式优先，失败回退非流式）
     */
    async _parseResponse(response, apiConfig, messages, tools, appConfig) {
        try {
            return await parseStreamResponse(response);
        } catch (err) {
            logger.warn('[LLM] Stream parse failed, falling back to non-stream');
            return await parseNonStreamResponse(
                apiConfig.apiBaseUrl, apiConfig.apiKey, apiConfig.model,
                messages, tools, appConfig
            );
        }
    }
}

// ===================================================================
// ===== 公共辅助函数 =====
// ===================================================================


async function parseStreamResponse(response) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '', content = '', toolCalls = [], currentToolCallIndex = -1;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const events = buffer.split('\n\n');
            buffer = events.pop() || '';
            for (const event of events) {
                for (const line of event.split('\n')) {
                    const trimmed = line.trim();
                    if (!trimmed || !trimmed.startsWith('data: ')) continue;
                    const data = trimmed.slice(6);
                    if (data === '[DONE]') continue;
                    try {
                        const parsed = JSON.parse(data);
                        const delta = parsed.choices?.[0]?.delta;
                        if (!delta) continue;
                        if (delta.content) content += delta.content;
                        if (delta.tool_calls) {
                            for (const tc of delta.tool_calls) {
                                if (tc.index !== undefined && tc.index !== currentToolCallIndex) {
                                    currentToolCallIndex = tc.index;
                                    toolCalls.push({ id: tc.id || ('call_' + Date.now() + '_' + tc.index), type: 'function', function: { name: tc.function?.name || '', arguments: '' } });
                                }
                                if (tc.id) toolCalls[currentToolCallIndex].id = tc.id;
                                if (tc.function?.name) toolCalls[currentToolCallIndex].function.name = tc.function.name;
                                if (tc.function?.arguments) toolCalls[currentToolCallIndex].function.arguments += tc.function.arguments;
                            }
                        }
                    } catch (e) {}
                }
            }
        }
    } finally { reader.releaseLock(); }
    return { content, tool_calls: toolCalls.length > 0 ? toolCalls : null };
}

async function parseNonStreamResponse(apiBaseUrl, apiKey, model, messages, tools, appConfig) {
    const response = await fetch(apiBaseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages, tools: tools || undefined, temperature: appConfig.temperature || 0.9, max_tokens: appConfig.maxTokens || 4096, stream: false }),
    });
    if (!response.ok) { const errText = await response.text(); throw new Error(`AI 请求失败 (${response.status}): ${errText}`); }
    const data = await response.json();
    const choice = data.choices?.[0];
    if (!choice) throw new Error('AI 返回了空响应');
    return { content: choice.message?.content || '', tool_calls: choice.message?.tool_calls || null };
}

// ===================================================================
// ===== UserAgent (UA) — 玩家角色扮演代理 =====
// ===================================================================

/**
 * 运行 UserAgent：根据玩家选择的选项生成角色行为描述和对话
 * @param {object} saveData - 存档数据
 * @param {string} optionText - 玩家选择的选项文本
 * @param {object} apiConfig - AI 配置
 * @returns {Promise<{action: string, dialogue: string|null}>}
 */
async function runUserAgent(saveData, optionText, apiConfig) {
    const { apiKey, apiBaseUrl, model, temperature } = apiConfig;
    const systemPrompt = buildUserAgentPrompt(saveData);
    const selectedOption = { text: optionText };

    logger.info('[UserAgent] Starting', { option: selectedOption.text });
    const uaTimer = logger.timer();

    const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `玩家选择了以下行动选项，请生成角色行为描写：\n\n"${optionText}"` },
    ];

    // 请求 AI（含重试，最多2次）
    let response;
    let retries = 0;
    while (retries < 2) {
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 30000);
            response = await fetch(apiBaseUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                body: JSON.stringify({
                    model,
                    messages,
                    temperature: Math.max(0.6, (temperature || 0.9) - 0.1),
                    max_tokens: 512,
                    stream: false,
                }),
                signal: controller.signal,
            });
            clearTimeout(timer);
            break;
        } catch (err) {
            retries++;
            if (retries >= 2) throw new Error('UserAgent 请求失败: ' + err.message);
            logger.warn('[UserAgent] Retry', { attempt: retries });
            await new Promise(r => setTimeout(r, 1000 * retries));
        }
    }

    if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(`UserAgent AI 请求失败 (${response.status}): ${errText}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';

    // 预处理：移除 markdown 代码块标记
    const cleanContent = content
        .replace(/^```json\s*/i, '')  // 开头的 ```json
        .replace(/^```\s*/, '')        // 开头的 ```
        .replace(/\s*```$/, '');       // 结尾的 ```

    // 解析 JSON 输出
    try {
        const parsed = JSON.parse(cleanContent);
        logger.info('[UserAgent] Completed');
        uaTimer.done('UserAgent');
        // 新格式：segments 数组
        if (parsed.segments && Array.isArray(parsed.segments)) {
            return { segments: parsed.segments };
        }
        // 兼容旧格式：action + dialogue 转换为 segments
        const segs = [];
        if (parsed.action) segs.push({ type: 'action', text: parsed.action });
        if (parsed.dialogue) segs.push({ type: 'dialogue', text: parsed.dialogue });
        return { segments: segs.length > 0 ? segs : [{ type: 'action', text: optionText }] };
    } catch (e) {
        // JSON 解析失败，尝试从文本中提取
        const jsonMatch = cleanContent.match(/\{[\s\S]*"action"[\s\S]*}/);
        if (jsonMatch) {
            try {
                const parsed = JSON.parse(jsonMatch[0]);
                logger.info('[UserAgent] Completed');
                uaTimer.done('UserAgent');
                if (parsed.segments && Array.isArray(parsed.segments)) {
                    return { segments: parsed.segments };
                }
                const segs = [];
                if (parsed.action) segs.push({ type: 'action', text: parsed.action });
                if (parsed.dialogue) segs.push({ type: 'dialogue', text: parsed.dialogue });
                return { segments: segs.length > 0 ? segs : [{ type: 'action', text: optionText }] };
            } catch (e2) {}
        }
        // 降级：直接使用选项文本作为行为描述
        logger.warn('[UserAgent] JSON parse failed, using raw text');
        logger.info('[UserAgent] Completed');
        uaTimer.done('UserAgent');
        return { segments: [{ type: 'action', text: optionText }] };
    }
}

// ===================================================================
// ===== 导出 =====
// ===================================================================

module.exports = {
    Pipeline,
    BaseAgent,
    StoryAgent,
    RoleAgent,
    MapAgent,
    PropertyAgent,
    runUserAgent,
};
