const { buildSystemPrompt, buildMessageHistory } = require('./aiService');
const logger = require('./logger');

class Pipeline {
    constructor() {}

    async run(saveData, userMessage, apiConfig, appConfig, aiMessages = null) {
        const systemPrompt = buildSystemPrompt(saveData, appConfig);
        const history = aiMessages || buildMessageHistory(saveData.chatHistory);
        const messages = [
            { role: 'system', content: systemPrompt },
            ...history,
            { role: 'user', content: userMessage },
        ];

        logger.info('[Pipeline] Starting run', { messageCount: messages.length });

        const MAX_RETRIES = 3;
        const API_TIMEOUT = 5 * 60 * 1000;

        // 请求 AI 生成叙事
        const llmTimer = logger.timer();
        const response = await this._requestLLM(apiConfig, messages, MAX_RETRIES, API_TIMEOUT);
        llmTimer.done('LLM request');

        const result = await this._parseResponse(response, apiConfig, messages, appConfig);

        const contentPreview = result.content ? result.content.substring(0, 200) : '(empty)';
        logger.info(`[Pipeline] LLM response: content="${contentPreview}"`);

        const finalContent = [];
        if (result.content && result.content.trim()) {
            finalContent.push({ type: 'narrative', text: result.content.trim() });
        }

        logger.info('[Pipeline] Run completed');

        return {
            content: finalContent,
            options: [],
            notifications: [],
            saveData,
            loops: 1,
            toolCallCount: 0,
            toolCallLog: [],
        };
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
                    body: JSON.stringify({
                        model,
                        messages,
                        temperature: temperature || 0.9,
                        max_tokens: maxTokens || 4096,
                        stream: true,
                    }),
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
                messages, appConfig
            );
        }
    }
}

async function parseStreamResponse(response) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '', content = '';

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
                        if (delta && delta.content) content += delta.content;
                    } catch (e) {}
                }
            }
        }
    } finally {
        reader.releaseLock();
    }

    return { content };
}

async function parseNonStreamResponse(apiBaseUrl, apiKey, model, messages, appConfig) {
    const response = await fetch(apiBaseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
            model,
            messages,
            temperature: appConfig?.temperature || 0.9,
            max_tokens: appConfig?.maxTokens || 4096,
            stream: false,
        }),
    });
    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`AI 请求失败 (${response.status}): ${errText}`);
    }
    const data = await response.json();
    const choice = data.choices?.[0];
    if (!choice) throw new Error('AI 返回了空响应');
    return { content: choice.message?.content || '' };
}

module.exports = { Pipeline };
