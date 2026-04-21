// ===================================================================
// ===== GM 多 Agent 管线（Pipeline v2） =====
// ===================================================================
//
// 架构（v2 — 工具调用模式）：
//   Phase 1: StoryAgent(SA) — 使用工具调用生成剧情+执行游戏操作（和旧版一致，保证可靠性）
//   Phase 2: 后处理 — 从 SA 的工具调用结果中提取角色创建/属性变更等通知
//
// SA 仍然使用 aiService.js 的 buildSystemPrompt + gameTools（工具调用模式）
// 管线负责编排调用流程、处理角色AI嵌套、解析最终输出
//
// ===================================================================

const { buildSystemPrompt, buildMessageHistory, buildCharacterPrompt, gameTools, characterTools } = require('./aiService');
const { executeGameFunction, executeCharacterTool } = require('./gameEngine');

// ===================================================================
// ===== 管线编排器 =====
// ===================================================================

/**
 * 执行完整的 GM 管线
 */
async function runGMPipeline(saveData, userMessage, apiConfig, appConfig) {
    const { apiKey, apiBaseUrl, model } = apiConfig;
    const allNotifications = [];

    // ===== Phase 1: StoryAgent — 工具调用模式 =====
    const systemPrompt = buildSystemPrompt(saveData, appConfig);
    const history = buildMessageHistory(saveData.chatHistory);
    const messages = [{ role: 'system', content: systemPrompt }, ...history];

    const MAX_TOOL_CALL_LOOPS = 5;
    const MAX_RETRIES = 2;
    const API_TIMEOUT = 90000;

    let loopCount = 0;
    while (loopCount < MAX_TOOL_CALL_LOOPS) {
        loopCount++;

        // 请求 AI（含重试）
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
                if (retries >= MAX_RETRIES) {
                    throw new Error('AI 请求失败: ' + (err.message || '未知错误'));
                }
                await new Promise(r => setTimeout(r, 1000 * retries));
            }
        }

        if (!response.ok) {
            const errText = await response.text().catch(() => '');
            throw new Error(`AI 请求失败 (${response.status}): ${errText}`);
        }

        // 解析流式响应
        let result;
        try {
            result = await parseStreamResponse(response);
        } catch (err) {
            // 流式失败，尝试非流式
            result = await parseNonStreamResponse(apiBaseUrl, apiKey, model, messages, gameTools, appConfig);
        }

        const assistantMsg = { role: 'assistant', content: result.content };
        if (result.tool_calls) assistantMsg.tool_calls = result.tool_calls;
        messages.push(assistantMsg);

        // 处理 tool calls
        if (result.tool_calls && result.tool_calls.length > 0) {
            for (const tc of result.tool_calls) {
                const fnName = tc.function.name;
                let fnArgs;
                try { fnArgs = JSON.parse(tc.function.arguments); } catch (e) { fnArgs = {}; }

                let toolResult;

                if (fnName === 'get_character_reaction') {
                    // ★ 角色 AI 嵌套调用
                    toolResult = await handleGetCharacterReaction(fnArgs, saveData, apiKey, apiBaseUrl, model, appConfig);
                } else {
                    toolResult = executeGameFunction(fnName, fnArgs, saveData);
                }

                if (toolResult.notifications) allNotifications.push(...toolResult.notifications);
                messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(toolResult) });
            }
            continue;
        }
        break;
    }

    // ===== Phase 2: 解析最终输出 =====
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

    // 处理角色AI的 tool calls
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

module.exports = { runGMPipeline };
