// ===================================================================
// ===== GM 多 Agent 管线（Pipeline v3 — 工具拆分版） =====
// ===================================================================
//
// 架构：
//   SA (StoryAgent) — 纯叙事，只持有 get_character_reaction 工具
//   RA (RoleAgent)   — 角色管理：create_character, update_relationship, character_action, create_npc, remove_npc
//   MA (MapAgent)    — 地图管理：move_to_location
//   PA (PropertyAgent) — 属性管理：update_attributes, add_item, remove_item,
//                         add_status_effect, remove_status_effect, update_gold,
//                         check_death, equip_item, revive_player
//
// 流程：
//   1. SA 用精简 prompt + 仅 get_character_reaction 工具生成剧情
//   2. SA 输出中如果包含需要其他 Agent 处理的操作（通过特殊标记或工具调用），
//      管线拦截并分发给对应 Agent
//   3. RA/MA/PA 并行执行，结果合并返回
//
// ===================================================================

const { buildSystemPrompt, buildMessageHistory, buildCharacterPrompt, gameTools, characterTools } = require('./aiService');
const { executeGameFunction, executeCharacterTool } = require('./gameEngine');

// ===================================================================
// ===== 工具分组 =====
// ===================================================================

// SA 工具：保留所有工具定义（让 AI 知道有哪些操作可以做），但只有 get_character_reaction 由 SA 直接处理
// 其余工具的调用会被管线拦截并分发给对应 Agent
const storyAgentTools = gameTools;

// RA 工具：角色管理
const roleAgentTools = gameTools.filter(t =>
    ['create_character', 'update_relationship', 'character_action', 'create_npc', 'remove_npc'].includes(t.function.name)
);

// MA 工具：地图管理
const mapAgentTools = gameTools.filter(t => t.function.name === 'move_to_location');

// PA 工具：属性/物品/状态管理
const propertyAgentTools = gameTools.filter(t =>
    ['update_attributes', 'add_item', 'remove_item', 'add_status_effect',
     'remove_status_effect', 'update_gold', 'check_death', 'equip_item', 'revive_player'].includes(t.function.name)
);

// 工具名 → Agent 映射
const TOOL_AGENT_MAP = {};
for (const t of roleAgentTools) TOOL_AGENT_MAP[t.function.name] = 'RA';
for (const t of mapAgentTools) TOOL_AGENT_MAP[t.function.name] = 'MA';
for (const t of propertyAgentTools) TOOL_AGENT_MAP[t.function.name] = 'PA';

// ===================================================================
// ===== 管线编排器 =====
// ===================================================================

async function runGMPipeline(saveData, userMessage, apiConfig, appConfig) {
    const { apiKey, apiBaseUrl, model } = apiConfig;
    const allNotifications = [];

    // ===== Phase 1: StoryAgent — 纯叙事 + 角色交互 =====
    const systemPrompt = buildSystemPrompt(saveData, appConfig);
    const history = buildMessageHistory(saveData.chatHistory);
    const messages = [{ role: 'system', content: systemPrompt }, ...history];

    const MAX_TOOL_CALL_LOOPS = 5;
    const MAX_RETRIES = 2;
    const API_TIMEOUT = 90000;

    // 收集需要分发给其他 Agent 的工具调用
    const pendingAgentCalls = { RA: [], MA: [], PA: [] };

    let loopCount = 0;
    while (loopCount < MAX_TOOL_CALL_LOOPS) {
        loopCount++;

        let response;
        let retries = 0;
        while (true) {
            try {
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), API_TIMEOUT);
                response = await fetch(apiBaseUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                    body: JSON.stringify({ model, messages, tools: storyAgentTools, temperature: appConfig.temperature, max_tokens: appConfig.maxTokens, stream: true }),
                    signal: controller.signal,
                });
                clearTimeout(timer);
                break;
            } catch (err) {
                retries++;
                if (retries >= MAX_RETRIES) throw new Error('AI 请求失败: ' + (err.message || '未知错误'));
                await new Promise(r => setTimeout(r, 1000 * retries));
            }
        }

        if (!response.ok) {
            const errText = await response.text().catch(() => '');
            throw new Error(`AI 请求失败 (${response.status}): ${errText}`);
        }

        let result;
        try {
            result = await parseStreamResponse(response);
        } catch (err) {
            result = await parseNonStreamResponse(apiBaseUrl, apiKey, model, messages, storyAgentTools, appConfig);
        }

        const assistantMsg = { role: 'assistant', content: result.content };
        if (result.tool_calls) assistantMsg.tool_calls = result.tool_calls;
        messages.push(assistantMsg);

        if (result.tool_calls && result.tool_calls.length > 0) {
            for (const tc of result.tool_calls) {
                const fnName = tc.function.name;
                let fnArgs;
                try { fnArgs = JSON.parse(tc.function.arguments); } catch (e) { fnArgs = {}; }

                if (fnName === 'get_character_reaction') {
                    // ★ SA 直接处理角色交互
                    const toolResult = await handleGetCharacterReaction(fnArgs, saveData, apiKey, apiBaseUrl, model, appConfig);
                    if (toolResult.notifications) allNotifications.push(...toolResult.notifications);
                    messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(toolResult) });
                } else {
                    // ★ 拦截：分发给对应 Agent
                    const agent = TOOL_AGENT_MAP[fnName];
                    if (agent && pendingAgentCalls[agent]) {
                        pendingAgentCalls[agent].push({ fnName, fnArgs, toolCallId: tc.id });
                        // 返回占位结果让 SA 继续生成
                        messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ success: true, delegated: true, agent, message: `已委托${agent}处理` }) });
                    } else {
                        // 未知工具，直接执行
                        const toolResult = executeGameFunction(fnName, fnArgs, saveData);
                        if (toolResult.notifications) allNotifications.push(...toolResult.notifications);
                        messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(toolResult) });
                    }
                }
            }
            continue;
        }
        break;
    }

    // ===== Phase 2: 并行执行 RA/MA/PA =====
    const agentPromises = [];

    if (pendingAgentCalls.RA.length > 0) {
        agentPromises.push(
            executeAgentBatch('RA', pendingAgentCalls.RA, saveData, allNotifications)
        );
    }
    if (pendingAgentCalls.MA.length > 0) {
        agentPromises.push(
            executeAgentBatch('MA', pendingAgentCalls.MA, saveData, allNotifications)
        );
    }
    if (pendingAgentCalls.PA.length > 0) {
        agentPromises.push(
            executeAgentBatch('PA', pendingAgentCalls.PA, saveData, allNotifications)
        );
    }

    if (agentPromises.length > 0) {
        await Promise.all(agentPromises);
    }

    // ===== Phase 3: 解析最终输出 =====
    const lastAssistantMsg = messages[messages.length - 1];
    const rawContent = lastAssistantMsg?.content || '';
    const structuredOutput = parseGMOutput(rawContent);

    return {
        content: structuredOutput.content || [{ type: 'narrative', text: rawContent }],
        options: structuredOutput.options || [],
        notifications: allNotifications,
        saveData,
    };
}

// ===================================================================
// ===== Agent 批量执行器 =====
// ===================================================================

/**
 * 批量执行某个 Agent 的工具调用
 * 当前版本：直接执行工具函数（同步，无需额外 AI 调用）
 * 后续可升级为：将工具调用打包发给对应 Agent 的独立 AI 实例
 */
async function executeAgentBatch(agentName, calls, saveData, allNotifications) {
    for (const call of calls) {
        const result = executeGameFunction(call.fnName, call.fnArgs, saveData);
        if (result.notifications) allNotifications.push(...result.notifications);
    }
}

// ===================================================================
// ===== 角色AI代理处理 =====
// ===================================================================
async function handleGetCharacterReaction(args, saveData, apiKey, apiBaseUrl, model, appConfig) {
    const charName = args.character_name;
    const context = args.context || '';

    if (!saveData.characters) return { success: false, error: '当前没有重要角色' };

    const character = Object.values(saveData.characters).find(c => c.name === charName);
    if (!character) return { success: false, error: `未找到角色"${charName}"` };

    character.lastInteractedAt = new Date().toISOString();

    const charPrompt = buildCharacterPrompt(character, saveData);
    const charMessages = [
        { role: 'system', content: charPrompt },
        { role: 'user', content: `情境：${context}\n\n请给出你的反应和回应。` },
    ];

    let response;
    let retries = 0;
    while (retries < 2) {
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 60000);
            response = await fetch(apiBaseUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                body: JSON.stringify({
                    model, messages: charMessages, tools: characterTools,
                    temperature: Math.max(0.6, (appConfig.temperature || 0.9) - 0.2),
                    max_tokens: 1024, stream: true,
                }),
                signal: controller.signal,
            });
            clearTimeout(timer);
            break;
        } catch (err) {
            retries++;
            if (retries >= 2) return { success: false, error: '角色AI请求失败' };
            await new Promise(r => setTimeout(r, 1000 * retries));
        }
    }

    if (!response.ok) {
        const errText = await response.text().catch(() => '');
        return { success: false, error: `角色AI错误: ${errText}` };
    }

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

    if (result.tool_calls && result.tool_calls.length > 0) {
        for (const tc of result.tool_calls) {
            let fnArgs;
            try { fnArgs = JSON.parse(tc.function.arguments); } catch (e) { fnArgs = {}; }
            executeCharacterTool(tc.function.name, fnArgs, character, saveData);
        }
    }

    let charReaction = { reaction: '', dialogue: '', mood: 'neutral' };
    try {
        const jsonMatch = result.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) charReaction = { ...charReaction, ...JSON.parse(jsonMatch[0]) };
    } catch (e) {
        charReaction.dialogue = result.content;
    }

    return {
        success: true,
        characterId: character.id,
        characterName: character.name,
        reaction: charReaction.reaction || '',
        dialogue: charReaction.dialogue || '',
        mood: charReaction.mood || 'neutral',
        relationship_value: character.relationship.value,
        relationship_title: character.relationship.title,
    };
}

// ===================================================================
// ===== 辅助函数 =====
// ===================================================================

function parseGMOutput(rawContent) {
    try {
        const parsed = JSON.parse(rawContent);
        if (parsed.content && Array.isArray(parsed.content)) {
            return { content: parsed.content, options: parsed.options || [] };
        }
    } catch (e) {}

    const jsonMatch = rawContent.match(/\{[\s\S]*"content"[\s\S]*\}/);
    if (jsonMatch) {
        try {
            const parsed = JSON.parse(jsonMatch[0]);
            if (parsed.content && Array.isArray(parsed.content)) {
                return { content: parsed.content, options: parsed.options || [] };
            }
        } catch (e) {}
    }

    return { content: [{ type: 'narrative', text: rawContent }], options: [] };
}

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
        body: JSON.stringify({ model, messages, tools: tools || undefined, temperature: appConfig.temperature || 0.9, max_tokens: appConfig.maxTokens || 2048, stream: false }),
    });
    if (!response.ok) { const errText = await response.text(); throw new Error(`AI 请求失败 (${response.status}): ${errText}`); }
    const data = await response.json();
    const choice = data.choices?.[0];
    if (!choice) throw new Error('AI 返回了空响应');
    return { content: choice.message?.content || '', tool_calls: choice.message?.tool_calls || null };
}

module.exports = { runGMPipeline, storyAgentTools, roleAgentTools, mapAgentTools, propertyAgentTools };
