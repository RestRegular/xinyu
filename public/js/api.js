// ===================================================================
// ===== DeepSeek API 接口层（重构版 - 仅保留前端展示逻辑） =====
// ===================================================================

const API_TIMEOUT = 60000;

// ----- 错误分类 -----
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

// ===================================================================
// ===== 核心游戏消息发送（重构版 - 调用后端统一 API） =====
// ===================================================================
async function callAI(userText, isOption = false) {
    addTypingIndicator();

    try {
        const response = await fetchWithTimeout('/api/game/action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                saveId: currentSaveId,
                userMessage: userText,
                isOption: isOption || undefined,
                lastBlockIndex: currentLastBlockIndex >= 0 ? currentLastBlockIndex : undefined,
            }),
        });

        if (!response.ok) {
            const errText = await response.text().catch(() => '');
            const errInfo = classifyError(response.status, errText);
            throw new Error(errInfo.message);
        }

        const result = await response.json();

        // 移除打字指示器
        removeTypingIndicator();

        // 用后端返回的完整存档数据更新前端状态
        if (result.saveData) {
            currentSave = result.saveData;
        }

        // 新格式：renderData（包含 newBlocks 和 options）
        if (result.renderData) {
            appendRenderBlocks(result.renderData.newBlocks);
            if (result.renderData.options && result.renderData.options.length > 0) {
                renderOptions(result.renderData.options);
            } else {
                clearOptions();
            }
            currentLastBlockIndex += (result.renderData.newBlocks || []).length;
        } else if (result.content) {
            // 旧格式兼容：content 数组 + options 按钮
            await renderStructuredContent(result.content);
            if (result.options && result.options.length > 0) {
                renderOptions(result.options);
            }
        }

        // 显示后端产生的通知（仅旧格式时需要，新格式已包含在 renderData.newBlocks 中）
        if (!result.renderData && result.notifications && result.notifications.length > 0) {
            for (const notif of result.notifications) {
                addNotification(notif.text, notif.type === 'character_created' ? 'positive' : (notif.type || 'info'));
            }
        }

        // 刷新所有 UI 面板
        refreshAllPanels();

    } catch(err) {
        removeTypingIndicator();
        throw err;
    }
}

// ----- 渲染结构化内容（content 数组） -----
async function renderStructuredContent(contentBlocks) {
    const container = document.getElementById('gameMessages');

    for (const block of contentBlocks) {
        if (block.type === 'player_action') {
            addUserMessage(block);
        } else if (block.type === 'narrative') {
            await simulateStreamingText(block.text);
        } else if (block.type === 'scene') {
            addSceneMessage(block);
        } else if (block.type === 'dialogue') {
            addDialogueMessage(block);
        } else if (block.type === 'action') {
            addActionMessage(block);
        } else if (block.type === 'combat') {
            addCombatMessage(block);
        } else if (block.type === 'loot') {
            addLootMessage(block);
        } else if (block.type === 'character') {
            addCharacterMessage(block);
        } else {
            // 未知类型降级为 narrative
            await simulateStreamingText(block.text);
        }
    }
}

// ----- 渲染选项按钮 -----
function renderOptions(options) {
    const container = document.getElementById('gameOptionsArea');

    // 清空旧选项
    container.innerHTML = '';

    const wrapper = document.createElement('div');
    wrapper.className = 'options-list';

    options.forEach((opt, index) => {
        const btn = document.createElement('button');
        btn.className = 'option-btn';
        btn.textContent = opt.text || opt.label || '';
        btn.style.animationDelay = `${index * 0.04}s`;
        btn.onclick = () => {
            container.innerHTML = '';
            const actionText = opt.action || opt.text || opt.label || '';
            sendGameMessage(actionText, true);
        };
        wrapper.appendChild(btn);
    });

    container.appendChild(wrapper);

    // 超过3个选项时添加折叠按钮
    if (options.length > 3) {
        const toggle = document.createElement('div');
        toggle.className = 'options-toggle';
        toggle.innerHTML = `<span class="options-toggle-arrow">▼</span> <span>收起选项</span>`;
        let collapsed = false;
        toggle.onclick = () => {
            collapsed = !collapsed;
            if (collapsed) {
                wrapper.classList.add('collapsed');
                toggle.innerHTML = `<span class="options-toggle-arrow up">▼</span> <span>展开选项 (${options.length})</span>`;
            } else {
                wrapper.classList.remove('collapsed');
                toggle.innerHTML = `<span class="options-toggle-arrow">▼</span> <span>收起选项</span>`;
            }
        };
        container.appendChild(toggle);
    }

    scrollToBottom();
}

// ----- 清除选项按钮 -----
function clearOptions() {
    const container = document.getElementById('gameOptionsArea');
    if (container) container.innerHTML = '';
}

// ----- 模拟流式打字效果 -----
async function simulateStreamingText(text) {
    // 先添加一个空的 assistant 消息占位
    addAssistantMessage('');
    const container = document.getElementById('gameMessages');
    let lastNarrator = container.querySelector('.msg-narrator:last-of-type');

    const chunkSize = 3; // 每次显示的字符数
    for (let i = 0; i < text.length; i += chunkSize) {
        const partial = text.slice(0, i + chunkSize);
        if (lastNarrator) {
            lastNarrator.innerHTML = formatNarratorText(partial);
        }
        scrollToBottom();
        await new Promise(r => setTimeout(r, 10));
    }

    // 确保最终文本完整
    if (lastNarrator) {
        lastNarrator.innerHTML = formatNarratorText(text);
    }
    scrollToBottom();
}

// ----- 带超时的 fetch -----
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

// ===================================================================
// ===== Prompt 预览（仍在前端，用于设置页面展示） =====
// ===================================================================
async function getPromptPreview() {
    if (!currentSave) return '请先加载存档';
    // 调用后端获取 prompt 预览
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
