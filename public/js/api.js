// ===================================================================
// ===== API 接口层（极简版） =====
// ===================================================================

const API_TIMEOUT = 5 * 60 * 1000;

function classifyError(status, body) {
    if (body && body.error && typeof body.error === 'string') {
        return { type: 'proxy', message: body.error };
    }
    if (status === 401) return { type: 'auth', message: 'API Key 无效或已过期，请在设置中检查' };
    if (status === 402 || status === 403) return { type: 'quota', message: 'API 余额不足，请充值后重试' };
    if (status === 429) return { type: 'rate_limit', message: '请求过于频繁，请稍后再试' };
    if (status === 500 || status === 502 || status === 503) return { type: 'server', message: 'AI 服务暂时不可用，正在重试...' };
    if (status === 400) {
        try {
            const err = JSON.parse(body);
            return { type: 'bad_request', message: `请求参数错误: ${err.error?.message || body}` };
        } catch(e) {
            return { type: 'bad_request', message: `请求参数错误 (${status})` };
        }
    }
    if (!status) return { type: 'network', message: '网络连接失败，请检查网络设置' };
    return { type: 'unknown', message: `API 错误 (${status}): ${body.slice(0, 200)}` };
}

async function callAI(userText) {
    addTypingIndicator();
    isGenerating = true;
    document.getElementById('gameSendBtn').disabled = true;

    try {
        const response = await fetchWithTimeout('/api/game/action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                saveId: currentSaveId,
                userMessage: userText,
                lastBlockIndex: currentLastBlockIndex >= 0 ? currentLastBlockIndex : undefined,
            }),
        });

        if (!response.ok) {
            const errText = await response.text().catch(() => '');
            const errInfo = classifyError(response.status, errText);
            throw new Error(errInfo.message);
        }

        const result = await response.json();
        removeTypingIndicator();

        if (result.saveData) {
            currentSave = result.saveData;
        }

        // 新格式：renderData
        if (result.renderData) {
            appendRenderBlocks(result.renderData.newBlocks);
            currentLastBlockIndex += (result.renderData.newBlocks || []).length;
        } else if (result.content) {
            // 旧格式兼容
            for (const block of result.content) {
                if (block.type === 'narrative' || block.type === 'scene') {
                    await simulateStreamingText(block.text);
                } else if (block.type === 'player_action') {
                    addUserMessage(block);
                } else {
                    addAssistantMessage(block.text || '');
                }
            }
        }

    } catch(err) {
        removeTypingIndicator();
        showToast('请求失败: ' + err.message, 'error');
    }

    isGenerating = false;
    document.getElementById('gameSendBtn').disabled = false;
}

async function simulateStreamingText(text) {
    addAssistantMessage('');
    const container = document.getElementById('gameMessages');
    let lastNarrator = container.querySelector('.msg-narrator:last-of-type');

    const chunkSize = 3;
    for (let i = 0; i < text.length; i += chunkSize) {
        const partial = text.slice(0, i + chunkSize);
        if (lastNarrator) {
            lastNarrator.innerHTML = formatNarratorText(partial);
        }
        scrollToBottom();
        await new Promise(r => setTimeout(r, 10));
    }

    if (lastNarrator) {
        lastNarrator.innerHTML = formatNarratorText(text);
    }
    scrollToBottom();
}

async function fetchWithTimeout(url, options, timeout = API_TIMEOUT) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(timer);
        return response;
    } catch(e) {
        clearTimeout(timer);
        if (e.name === 'AbortError') throw { type: 'timeout', message: '请求超时，AI 响应时间过长' };
        throw { type: 'network', message: '网络连接失败，请检查网络设置' };
    }
}

async function getPromptPreview() {
    if (!currentSave) return '请先加载存档';
    try {
        const resp = await fetch('/api/game/prompt-preview', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ saveId: currentSaveId }),
        });
        if (resp.ok) {
            const data = await resp.json();
            return data.prompt || '无法生成预览';
        }
    } catch(e) {}
    return '无法连接服务器生成预览';
}
