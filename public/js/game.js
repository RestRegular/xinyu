// ===================================================================
// ===== 游戏界面（极简版 - 纯文本对话） =====
// ===================================================================

var currentLastBlockIndex = -1;

function enterGameView() {
    showView('game');
    document.getElementById('gameTopbarName').textContent = currentSave.name || '未命名';
    renderGameMessages();
}

function manualSave() {
    if (!currentSave) return;
    showToast('游戏已自动保存', 'success');
}

function refreshAllPanels() {
    // 极简模式无需刷新面板
}

// ===================================================================
// ===== 消息渲染 =====
// ===================================================================

function renderGameMessages(data) {
    const container = document.getElementById('gameMessages');
    if (!container) return;

    if (data === undefined) {
        data = currentSave.chatHistory || [];
    }

    // 新格式：renderBlocks
    if (Array.isArray(data) && data.length > 0 && data[0].id) {
        let html = '';
        for (const block of data) {
            html += renderBlock(block);
        }
        container.innerHTML = html;
        currentLastBlockIndex = data.length - 1;
        scrollToBottom();
        return;
    }

    // 旧格式兼容
    if (Array.isArray(data) && data.length > 0) {
        let html = '';
        data.forEach(msg => {
            if (msg.role === 'system') return;
            if (msg.role === 'user') {
                if (msg.content && msg.content.startsWith('[系统]')) return;
                html += `<div class="msg msg-user">${escapeHtml(msg.content)}</div>`;
            } else if (msg.role === 'assistant') {
                if (msg.structured && msg.structured.content) {
                    msg.structured.content.forEach(block => {
                        if (block.text && typeof block.text === 'string' && block.text.startsWith('{"success"')) return;
                        if (block.type === 'narrative' || block.type === 'scene') {
                            html += `<div class="msg msg-narrator">${formatNarratorText(block.text)}</div>`;
                        } else if (block.type === 'dialogue') {
                            html += `<div class="msg msg-narrator">${formatNarratorText((block.speaker ? block.speaker + '：「' : '「') + block.text + (block.speaker ? '」' : '」'))}</div>`;
                        } else if (block.type === 'action') {
                            html += `<div class="msg msg-narrator">${formatNarratorText(block.text)}</div>`;
                        } else if (block.type === 'player_action') {
                            const playerName = currentSave?.player?.name || '你';
                            html += `<div class="msg msg-user">${escapeHtml(block.action || block.dialogue || '')}</div>`;
                        } else {
                            html += `<div class="msg msg-narrator">${formatNarratorText(block.text)}</div>`;
                        }
                    });
                } else {
                    let text = msg.content || '';
                    if (text.trim().startsWith('{"success"') || text.trim().startsWith('{\n{"success"')) {
                        text = '';
                    }
                    if (text) html += `<div class="msg msg-narrator">${formatNarratorText(text)}</div>`;
                }
            }
        });
        container.innerHTML = html;
        scrollToBottom();
        return;
    }

    container.innerHTML = '';
}

function appendRenderBlocks(blocks) {
    const container = document.getElementById('gameMessages');
    if (!container) return;
    for (const block of blocks) {
        container.insertAdjacentHTML('beforeend', renderBlock(block));
    }
    scrollToBottom();
}

function renderBlock(block) {
    switch (block.type) {
        case 'system':
        case 'notification':
            return '';
        case 'player':
            return `<div class="msg msg-user">${escapeHtml(block.data?.text || block.data?.action || block.data?.dialogue || '')}</div>`;
        case 'narrative':
        case 'scene':
        case 'action':
        case 'combat':
        case 'loot':
        case 'dialogue':
            return `<div class="msg msg-narrator">${formatNarratorText(block.data?.text || '')}</div>`;
        case 'character':
            const d = block.data;
            let text = '';
            if (d.segments) {
                for (const seg of d.segments) {
                    if (seg.text) text += seg.text;
                }
            } else {
                text = (d.reaction || '') + (d.dialogue || '');
            }
            return `<div class="msg msg-narrator">${formatNarratorText(text)}</div>`;
        default:
            return `<div class="msg msg-narrator">${escapeHtml(block.data?.text || '')}</div>`;
    }
}

function formatNarratorText(text) {
    if (!text) return '';
    let html = escapeHtml(text);
    html = html.replace(/\u201c([^\u201c\u201d]*?)\u201d/g, (match, content) => {
        return `<span class="inline-dialogue">\u201c${content}\u201d</span>`;
    });
    html = html.replace(/"([^"]*?)"/g, (match, content) => {
        return `<span class="inline-dialogue">"${content}"</span>`;
    });
    return html.replace(/\n/g, '<br>');
}

function addUserMessage(text) {
    const container = document.getElementById('gameMessages');
    const div = document.createElement('div');
    div.className = 'msg msg-user';
    div.textContent = typeof text === 'string' ? text : (text.action || text.dialogue || '');
    container.appendChild(div);
    scrollToBottom();
}

function addAssistantMessage(text) {
    const container = document.getElementById('gameMessages');
    const div = document.createElement('div');
    div.className = 'msg msg-narrator';
    div.innerHTML = formatNarratorText(text);
    container.appendChild(div);
    scrollToBottom();
}

function addTypingIndicator() {
    const container = document.getElementById('gameMessages');
    const div = document.createElement('div');
    div.className = 'msg msg-narrator';
    div.id = 'typingIndicator';
    div.innerHTML = '<div class="typing-indicator"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>';
    container.appendChild(div);
    scrollToBottom();
}

function removeTypingIndicator() {
    const el = document.getElementById('typingIndicator');
    if (el) el.remove();
}

function appendToLastAssistantMessage(text) {
    const container = document.getElementById('gameMessages');
    let lastNarrator = container.querySelector('.msg-narrator:last-of-type');
    if (!lastNarrator || lastNarrator.id === 'typingIndicator') {
        removeTypingIndicator();
        const div = document.createElement('div');
        div.className = 'msg msg-narrator';
        div.innerHTML = formatNarratorText(text);
        container.appendChild(div);
    } else {
        lastNarrator.innerHTML = formatNarratorText(text);
    }
    scrollToBottom();
}

function scrollToBottom() {
    const container = document.getElementById('gameMessages');
    requestAnimationFrame(() => {
        container.scrollTop = container.scrollHeight;
    });
}

// ===================================================================
// ===== 输入处理 =====
// ===================================================================

function handleInputKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
}

function autoResize(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

function sendMessage() {
    if (isGenerating) return;
    const input = document.getElementById('gameInput');
    const text = input.value.trim();
    if (!text) return;

    if (!appConfig.apiKey) {
        showToast('请先在设置中配置 API Key', 'warning');
        window.location.href = 'settings.html';
        return;
    }

    input.value = '';
    input.style.height = 'auto';

    addUserMessage(text);
    callAI(text);
}
