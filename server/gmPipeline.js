const { buildSystemPrompt, buildMessageHistory, buildUserAgentPrompt } = require('./aiService');
const logger = require('./logger');

class Pipeline {
    constructor() {}

    async run(saveData, userMessage, apiConfig, appConfig, aiMessages = null) {
        const orderedBlocks = [];
        const allContentParts = [];

        const systemPrompt = buildSystemPrompt(saveData, appConfig);
        const history = aiMessages || buildMessageHistory(saveData.chatHistory);
        const messages = [{ role: 'system', content: systemPrompt }, ...history, { role: 'user', content: userMessage }];

        logger.info('[Pipeline] Starting run', { messageCount: messages.length });

        const MAX_RETRIES = 3;
        const API_TIMEOUT = 5 * 60 * 1000;

        // Phase 1: 请求 AI 生成叙事
        const llmTimer = logger.timer();
        const response = await this._requestLLM(apiConfig, messages, MAX_RETRIES, API_TIMEOUT);
        llmTimer.done('LLM request');

        const result = await this._parseResponse(response, apiConfig, messages, appConfig);

        const contentPreview = result.content ? result.content.substring(0, 200) : '(empty)';
        logger.info(`[Pipeline] LLM response: content="${contentPreview}"`);

        const assistantMsg = { role: 'assistant', content: result.content };
        messages.push(assistantMsg);

        if (result.content && result.content.trim()) {
            allContentParts.push(result.content.trim());
        }

        // Phase 1.5: 提取器 — 从纯文本中提取选项并清洗叙事文本
        const fullContent = allContentParts.join('\n\n');
        let extractedOptions = null;
        let cleanedNarrative = fullContent;

        if (fullContent) {
            logger.info('[Pipeline] Phase 1.5: Running content extractor');
            const extractTimer = logger.timer();
            const extracted = await this._extractStructuredContent(fullContent, saveData, apiConfig);
            extractTimer.done('Content extractor');
            extractedOptions = extracted.options;
            cleanedNarrative = extracted.cleanedNarrative;
            logger.info(`[Pipeline] Extractor result: ${extractedOptions.length} options, cleaned ${fullContent.length} -> ${cleanedNarrative.length} chars`);
        }

        // Phase 2: 组装最终输出
        logger.info('[Pipeline] Assembling final output');
        const finalContent = [];

        if (cleanedNarrative && cleanedNarrative.trim()) {
            finalContent.push({ type: 'narrative', text: cleanedNarrative.trim() });
        }

        for (const block of orderedBlocks) {
            if (block.type === '_notification') {
                finalContent.push({ type: '_notification', text: block.text, notifType: block.notifType });
            }
        }

        logger.info('[Pipeline] Run completed');

        let finalOptions = extractedOptions || [];

        // 选项补充
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
            notifications: [],
            saveData,
            loops: 1,
            toolCallCount: 0,
            toolCallLog: [],
            hasOrderedContent: false,
        };
    }

    async _extractStructuredContent(narrativeText, saveData, apiConfig) {
        const { apiKey, apiBaseUrl, model } = apiConfig;

        const extractPrompt = `你是一个内容分析器。分析以下 GM 叙事文本，完成两个任务：
1. 提取玩家选项
2. 清洗叙事文本（移除已被提取的玩家行动部分，只保留纯叙事描写）

## 叙事文本
${narrativeText}

## 任务
请严格按以下 JSON 格式输出，不要输出任何其他内容：

{
  "cleanedNarrative": "清洗后的纯叙事文本。只保留环境描写、氛围渲染、剧情推进等纯叙事内容。如果移除后没有剩余内容，返回空字符串。",
  "options": [
    {"text": "玩家看到的选项文本（简短有力）", "action": "玩家发送的实际文本（描述具体行动）"},
    {"text": "选项2", "action": "行动2"},
    {"text": "选项3", "action": "行动3"}
  ]
}

规则：
1. cleanedNarrative：只保留纯叙事描写（环境、氛围、剧情推进、角色对话）。注意保持叙事连贯性
2. options：生成 2-4 个有实质差异的行动选项。text 是简短描述（10字以内），action 是具体行动描述（15-30字）
3. 只输出 JSON，不要输出任何其他文本`;

        try {
            const response = await fetch(apiBaseUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                body: JSON.stringify({
                    model,
                    messages: [{ role: 'user', content: extractPrompt }],
                    temperature: 0.3,
                    max_tokens: 2048,
                    stream: false,
                }),
            });

            if (!response.ok) {
                logger.warn('[Extractor] Request failed', { status: response.status });
                return { cleanedNarrative: narrativeText, options: [] };
            }

            const data = await response.json();
            const content = data.choices?.[0]?.message?.content || '';

            let parsed;
            try {
                parsed = JSON.parse(content);
            } catch (e) {
                const jsonMatch = content.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    parsed = JSON.parse(jsonMatch[0]);
                } else {
                    throw new Error('No JSON found in response');
                }
            }

            const cleanedNarrative = parsed.cleanedNarrative || narrativeText;
            const options = (parsed.options || []).map(opt => ({
                text: opt.text || '',
                action: opt.action || opt.text || '',
            })).filter(opt => opt.text);

            return { cleanedNarrative, options };
        } catch (err) {
            logger.warn('[Extractor] Failed to extract structured content', { error: err.message });
            return { cleanedNarrative: narrativeText, options: [] };
        }
    }

    async _requestFallbackOptions(saveData, apiConfig, messages) {
        const { apiKey, apiBaseUrl, model } = apiConfig;

        const promptMessages = [
            ...messages,
            { role: 'user', content: `你刚才的回复中没有提供选项。请根据当前剧情，生成 2-4 个有实质差异的行动选项。只输出 JSON，不要输出其他内容：\n{"options":[{"text":"选项文本","action":"玩家发送的实际文本"}]}` },
        ];

        const response = await fetch(apiBaseUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
            body: JSON.stringify({ model, messages: promptMessages, temperature: 0.7, max_tokens: 512, stream: false }),
        });

        if (!response.ok) return [];
        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || '';

        try {
            const parsed = JSON.parse(content);
            if (parsed.options && Array.isArray(parsed.options)) {
                return parsed.options.map(opt => ({
                    text: opt.text || opt.label || '',
                    action: opt.action || opt.text || opt.label || '',
                }));
            }
        } catch (e) {}

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

    async _requestLLM(apiConfig, messages, maxRetries, timeout) {
        const { apiKey, apiBaseUrl, model, temperature, maxTokens } = apiConfig;
        let retries = 0;

        while (true) {
            try {
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), timeout);
                const response = await fetch(apiBaseUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                    body: JSON.stringify({ model, messages, temperature: temperature || 0.9, max_tokens: maxTokens || 4096, stream: true }),
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

    async _parseResponse(response, apiConfig, messages, appConfig) {
        try {
            return await parseStreamResponse(response);
        } catch (err) {
            logger.warn('[LLM] Stream parse failed, falling back to non-stream');
            return await parseNonStreamResponse(
                apiConfig.apiBaseUrl, apiConfig.apiKey, apiConfig.model,
                messages, null, appConfig
            );
        }
    }
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
        body: JSON.stringify({ model, messages, tools: tools || undefined, temperature: appConfig?.temperature || 0.9, max_tokens: appConfig?.maxTokens || 4096, stream: false }),
    });
    if (!response.ok) { const errText = await response.text(); throw new Error(`AI 请求失败 (${response.status}): ${errText}`); }
    const data = await response.json();
    const choice = data.choices?.[0];
    if (!choice) throw new Error('AI 返回了空响应');
    return { content: choice.message?.content || '', tool_calls: choice.message?.tool_calls || null };
}

async function runUserAgent(saveData, optionText, apiConfig) {
    const { apiKey, apiBaseUrl, model, temperature } = apiConfig;
    const systemPrompt = buildUserAgentPrompt(saveData);

    logger.info('[UserAgent] Starting', { option: optionText });
    const uaTimer = logger.timer();

    const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `玩家选择了以下行动选项，请生成角色行为描写：\n\n"${optionText}"` },
    ];

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

    const cleanContent = content
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/, '')
        .replace(/\s*```$/, '');

    try {
        const parsed = JSON.parse(cleanContent);
        logger.info('[UserAgent] Completed');
        uaTimer.done('UserAgent');
        if (parsed.segments && Array.isArray(parsed.segments)) {
            return { segments: parsed.segments };
        }
        const segs = [];
        if (parsed.action) segs.push({ type: 'action', text: parsed.action });
        if (parsed.dialogue) segs.push({ type: 'dialogue', text: parsed.dialogue });
        return { segments: segs.length > 0 ? segs : [{ type: 'action', text: optionText }] };
    } catch (e) {
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
        logger.warn('[UserAgent] JSON parse failed, using raw text');
        logger.info('[UserAgent] Completed');
        uaTimer.done('UserAgent');
        return { segments: [{ type: 'action', text: optionText }] };
    }
}

module.exports = {
    Pipeline,
    runUserAgent,
};
