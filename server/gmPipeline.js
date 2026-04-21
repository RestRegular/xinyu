// ===================================================================
// ===== GM 多 Agent 管线（Pipeline v3.1 — 修复版） =====
// ===================================================================
//
// 架构：
//   SA (StoryAgent) — 叙事 + 触发工具调用（持有全部工具定义）
//   RA (RoleAgent)   — 角色管理：create_character, update_relationship, character_action, create_npc, remove_npc
//   MA (MapAgent)    — 地图管理：move_to_location
//   PA (PropertyAgent) — 属性管理：update_attributes, add_item, remove_item,
//                         add_status_effect, remove_status_effect, update_gold,
//                         check_death, equip_item, revive_player
//
// 关键修复（vs v3）：
//   v3 的 bug 是拦截后返回占位结果，AI 看不到真实执行数据。
//   v3.1：拦截后立即执行工具，返回真实结果给 AI，同时记录到 Agent 队列。
//   这样 AI 能看到 create_character 的返回值（角色ID等），后续输出不会乱。
//
// 流程：
//   1. SA 发起 tool_call
//   2. 管线判断工具归属：
//      - get_character_reaction → SA 直接处理（调用角色AI）
//      - RA/MA/PA 工具 → 立即执行，返回真实结果给 AI，同时记录到 Agent 队列
//   3. SA 生成完毕后，RA/MA/PA 可对收集到的调用做后处理（当前版本跳过）
//   4. 合并输出
//
// ===================================================================

const { buildSystemPrompt, buildMessageHistory, buildCharacterPrompt, gameTools, characterTools } = require('./aiService');
const { executeGameFunction, executeCharacterTool } = require('./gameEngine');

// ===================================================================
// ===== 工具分组 =====
// ===================================================================

const TOOL_AGENT_MAP = {
    // RA — 角色管理
    create_character: 'RA',
    update_relationship: 'RA',
    character_action: 'RA',
    create_npc: 'RA',
    remove_npc: 'RA',
    // MA — 地图管理
    move_to_location: 'MA',
    // PA — 属性/物品/状态管理
    update_attributes: 'PA',
    add_item: 'PA',
    remove_item: 'PA',
    add_status_effect: 'PA',
    remove_status_effect: 'PA',
    update_gold: 'PA',
    check_death: 'PA',
    equip_item: 'PA',
    revive_player: 'PA',
};

// ===================================================================
// ===== 管线编排器 =====
// ===================================================================

async function runGMPipeline(saveData, userMessage, apiConfig, appConfig) {
    const { apiKey, apiBaseUrl, model } = apiConfig;
    const allNotifications = [];

    // ===== Phase 1: StoryAgent =====
    const systemPrompt = buildSystemPrompt(saveData, appConfig);
    const history = buildMessageHistory(saveData.chatHistory);
    const messages = [{ role: 'system', content: systemPrompt }, ...history];

    const MAX_TOOL_CALL_LOOPS = 5;
    const MAX_RETRIES = 2;
    const API_TIMEOUT = 90000;

    // 记录各 Agent 处理的工具调用（用于日志/后续后处理）
    const agentCallLog = { SA: [], RA: [], MA: [], PA: [] };

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
                    body: JSON.stringify({ model, messages, tools: gameTools, temperature: appConfig.temperature, max_tokens: appConfig.maxTokens, stream: true }),
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
            result = await parseNonStreamResponse(apiBaseUrl, apiKey, model, messages, gameTools, appConfig);
        }

        const assistantMsg = { role: 'assistant', content: result.content };
        if (result.tool_calls) assistantMsg.tool_calls = result.tool_calls;
        messages.push(assistantMsg);

        if (result.tool_calls && result.tool_calls.length > 0) {
            for (const tc of result.tool_calls) {
                const fnName = tc.function.name;
                let fnArgs;
                try { fnArgs = JSON.parse(tc.function.arguments); } catch (e) { fnArgs = {}; }

                let toolResult;

                if (fnName === 'get_character_reaction') {
                    // ★ SA 直接处理：调用角色 AI
                    toolResult = await handleGetCharacterReaction(fnArgs, saveData, apiKey, apiBaseUrl, model, appConfig);
                    agentCallLog.SA.push({ fnName, fnArgs, result: toolResult });
                } else {
                    // ★ 立即执行工具，返回真实结果给 AI
                    toolResult = executeGameFunction(fnName, fnArgs, saveData);

                    // 记录到对应 Agent 队列
                    const agent = TOOL_AGENT_MAP[fnName] || 'PA';
                    agentCallLog[agent].push({ fnName, fnArgs, result: toolResult });
                }

                if (toolResult.notifications) allNotifications.push(...toolResult.notifications);
                // ★ 返回真实结果（不是占位），AI 能看到完整执行数据
                messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(toolResult) });
            }
            continue;
        }
        break;
    }

    // ===== Phase 2: Agent 后处理（当前版本跳过，后续可扩展） =====
    // agentCallLog 中记录了每个 Agent 处理的所有工具调用
    // 后续可在此处添加：
    //   - RA 后处理：检查新创建的角色是否需要初始化额外数据
    //   - MA 后处理：检查地图连接是否合理
    //   - PA 后处理：检查属性变更是否超出阈值
    // 当前这些逻辑已在 executeGameFunction 内部处理，无需额外后处理

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

module.exports = { runGMPipeline, TOOL_AGENT_MAP };
