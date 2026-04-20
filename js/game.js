// ===================================================================
// ===== 游戏界面（重构版 - 纯 UI 展示层） =====
// ===================================================================
function enterGameView() {
    showView('game');
    document.getElementById('gameTopbarName').textContent = currentSave.name || '未命名';
    updateGameTopbar();
    updateSidebar();
    updateAttributesPanel();
    updateInventoryPanel();
    updateMapPanel();
    renderGameMessages();
}

function updateGameTopbar() {
    document.getElementById('gameTopbarTurn').textContent = `回合 ${currentSave.meta.turnCount || currentSave.stats?.turnCount || 0}`;
}

function updateSidebar() {
    document.getElementById('sidebarCharName').textContent = currentSave.player.name;
    document.getElementById('sidebarCharLevel').textContent = `Lv.${currentSave.player.level}`;
    document.getElementById('sidebarLocation').textContent = currentSave.map.currentLocation;

    const loc = currentSave.map.locations[currentSave.map.currentLocation];
    const conns = loc?.connections || [];
    let html = '';
    conns.forEach(c => {
        const discovered = currentSave.map.locations[c]?.discovered;
        html += `<div class="sidebar-connection" onclick="moveToLocation('${escapeHtml(c)}')">→ ${escapeHtml(c)}${discovered ? '' : ' (未探索)'}</div>`;
    });
    document.getElementById('sidebarConnections').innerHTML = html || '<span style="font-size:12px;color:var(--text-tertiary);">无已知路径</span>';
}

function updateAttributesPanel() {
    const attrs = currentSave.player.attributes;
    let html = '';
    // HP & MP 条
    ['hp', 'mp'].forEach(key => {
        const a = attrs[key];
        if (!a) return;
        const pct = Math.max(0, (a.current / a.max) * 100);
        let fillClass = key;
        if (key === 'hp') {
            fillClass += pct > 50 ? ' healthy' : pct > 25 ? ' warning' : '';
        }
        html += `
            <div class="attr-row">
                <span class="attr-label">${a.label}</span>
                <div class="attr-bar"><div class="attr-fill ${fillClass}" style="width:${pct}%"></div></div>
                <span class="attr-value">${a.current}/${a.max}</span>
            </div>
        `;
    });
    // 其他属性
    ['attack', 'defense', 'agility', 'luck'].forEach(key => {
        const a = attrs[key];
        if (!a) return;
        html += `<div class="attr-row-simple"><span>${a.label}</span><span>${a.current}</span></div>`;
    });
    document.getElementById('attributesPanel').innerHTML = html;

    // 状态效果
    const effects = currentSave.player.statusEffects || [];
    const statusEl = document.getElementById('statusPanel');
    if (effects.length === 0) {
        statusEl.innerHTML = '<span style="font-size:12px;color:var(--text-tertiary);">无</span>';
    } else {
        statusEl.innerHTML = effects.map(e =>
            `<span class="status-tag ${e.duration > 0 ? 'negative' : 'positive'}">${escapeHtml(e.name)}${e.duration > 0 ? '(' + e.duration + ')' : ''}</span>`
        ).join('');
    }
}

function updateInventoryPanel() {
    const items = currentSave.inventory.items || [];
    document.getElementById('inventoryCount').textContent = `(${items.length}/${currentSave.inventory.maxSlots})`;
    const el = document.getElementById('inventoryPanel');
    if (items.length === 0) {
        el.innerHTML = '<span style="font-size:12px;color:var(--text-tertiary);">背包是空的</span>';
        return;
    }
    el.innerHTML = items.map(item => `
        <div class="inventory-item" onclick="showItemDetail('${item.id}')">
            <span class="inventory-item-icon">${itemIcon(item.type)}</span>
            <div class="inventory-item-info">
                <div class="inventory-item-name ${rarityClass(item.rarity)}">${escapeHtml(item.name)}${item.quantity > 1 ? ' x' + item.quantity : ''}</div>
                <div class="inventory-item-desc">${escapeHtml(item.description)}</div>
            </div>
        </div>
    `).join('');
}

function updateMapPanel() {
    const cur = currentSave.map.currentLocation;
    const loc = currentSave.map.locations[cur];
    let html = `<div class="map-current">📍 ${escapeHtml(cur)}</div>`;
    if (loc) html += `<div class="map-desc">${escapeHtml(loc.description)}</div>`;

    const conns = loc?.connections || [];
    if (conns.length > 0) {
        html += '<div class="map-connections-title">可前往</div>';
        conns.forEach(c => {
            html += `<div class="map-connection" onclick="moveToLocation('${escapeHtml(c)}')">→ ${escapeHtml(c)}</div>`;
        });
    }

    const discovered = Object.entries(currentSave.map.locations).filter(([k, v]) => v.discovered && k !== cur);
    if (discovered.length > 0) {
        html += '<div class="map-discovered-list"><div class="map-connections-title" style="margin-top:12px;">已探索</div>';
        discovered.forEach(([name]) => {
            html += `<div class="map-discovered-item"><span class="map-discovered-dot"></span>${escapeHtml(name)}</div>`;
        });
        html += '</div>';
    }

    document.getElementById('mapPanel').innerHTML = html;
}

function showItemDetail(itemId) {
    const item = currentSave.inventory.items.find(i => i.id === itemId);
    if (!item) return;
    const actions = [];
    if (item.usable) actions.push(`<button class="btn btn-primary btn-sm" onclick="useItem('${itemId}');closeDropdowns()">使用</button>`);
    actions.push(`<button class="btn btn-secondary btn-sm" onclick="dropItem('${itemId}');closeDropdowns()">丢弃</button>`);
    let msg = `${item.name} — ${item.description}`;
    if (item.effects) {
        const effs = Object.entries(item.effects).map(([k,v]) => `${k.toUpperCase()} ${v>0?'+':''}${v}`).join(', ');
        if (effs) msg += ` (${effs})`;
    }
    showToast(msg);
}

function useItem(itemId) {
    const item = currentSave.inventory.items.find(i => i.id === itemId);
    if (!item) return;
    // 使用物品 = 发送消息给 AI，由后端处理
    sendGameMessage(`[使用物品] ${item.name}`);
}

async function dropItem(itemId) {
    const item = currentSave.inventory.items.find(i => i.id === itemId);
    if (!item) return;

    // 调用后端 API 丢弃物品
    try {
        const resp = await fetch('/api/game/drop-item', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ saveId: currentSaveId, itemId }),
        });
        if (resp.ok) {
            const result = await resp.json();
            if (result.saveData) {
                currentSave = result.saveData;
            }
            updateInventoryPanel();
            addNotification(`丢弃了 ${item.name}`, 'info');
            showToast(`已丢弃 ${item.name}`);
        }
    } catch(e) {
        showToast('丢弃失败', 'error');
    }
}

function moveToLocation(name) {
    sendGameMessage(`[移动] 前往${name}`);
}

function toggleRightPanel(section) {
    const panel = document.getElementById('gameRightpanel');
    panel.classList.toggle('mobile-show');
}

function backToLobby() {
    if (isGenerating) { showToast('请等待AI回复完成', 'warning'); return; }
    currentSave = null;
    window.location.href = 'lobby.html';
}

function manualSave() {
    if (!currentSave) return;
    // 后端在每次 action 后自动保存，这里仅提示
    showToast('游戏已自动保存', 'success');
}

// ===================================================================
// ===== 消息渲染（纯 UI） =====
// ===================================================================
function renderGameMessages() {
    const container = document.getElementById('gameMessages');
    const history = currentSave.chatHistory || [];
    let html = '';
    history.forEach(msg => {
        if (msg.role === 'system') {
            html += `<div class="msg msg-system">${escapeHtml(msg.content)}</div>`;
        } else if (msg.role === 'user') {
            html += `<div class="msg msg-user"><div class="msg-user-bubble">${escapeHtml(msg.content)}</div></div>`;
        } else if (msg.role === 'assistant') {
            html += `<div class="msg msg-narrator">${formatNarratorText(msg.content)}</div>`;
        } else if (msg.role === 'notification') {
            const cls = msg.type === 'positive' ? 'positive' : msg.type === 'negative' ? 'negative' : 'info';
            const icon = msg.type === 'positive' ? '✚' : msg.type === 'negative' ? '✖' : 'ℹ';
            html += `<div class="msg"><div class="msg-notification ${cls}"><span class="notif-icon">${icon}</span>${escapeHtml(msg.content)}</div></div>`;
        }
    });
    container.innerHTML = html;
    scrollToBottom();
}

function formatNarratorText(text) {
    if (!text) return '';
    return escapeHtml(text).replace(/\n/g, '<br>');
}

function addSystemMessage(text) {
    const container = document.getElementById('gameMessages');
    const div = document.createElement('div');
    div.className = 'msg msg-system';
    div.textContent = text;
    container.appendChild(div);
    scrollToBottom();
}

function addUserMessage(text) {
    const container = document.getElementById('gameMessages');
    const div = document.createElement('div');
    div.className = 'msg msg-user';
    div.innerHTML = `<div class="msg-user-bubble">${escapeHtml(text)}</div>`;
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

function addNotification(text, type = 'info') {
    const container = document.getElementById('gameMessages');
    const div = document.createElement('div');
    div.className = 'msg';
    const cls = type === 'positive' ? 'positive' : type === 'negative' ? 'negative' : 'info';
    const icon = type === 'positive' ? '✚' : type === 'negative' ? '✖' : 'ℹ';
    div.innerHTML = `<div class="msg-notification ${cls}"><span class="notif-icon">${icon}</span>${escapeHtml(text)}</div>`;
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
    requestAnimationFrame(() => { container.scrollTop = container.scrollHeight; });
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
    sendGameMessage(text);
}

async function sendGameMessage(text) {
    if (isGenerating) return;
    isGenerating = true;
    document.getElementById('gameSendBtn').disabled = true;

    // 添加用户消息到 UI（后端也会添加到 chatHistory，但前端先显示）
    addUserMessage(text);

    try {
        await callAI(text);
    } catch(err) {
        addNotification('发生错误: ' + err.message, 'negative');
        showToast('请求失败: ' + err.message, 'error');
    }

    isGenerating = false;
    document.getElementById('gameSendBtn').disabled = false;
}
