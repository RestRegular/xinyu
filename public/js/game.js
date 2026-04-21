// ===================================================================
// ===== 游戏界面（重构版 - 纯 UI 展示层） =====
// ===================================================================

// 格式化时间戳为可读时间
function formatMessageTime(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const MM = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    return `${MM}-${dd} ${hh}:${mm}`;
}

function enterGameView() {
    showView('game');
    document.getElementById('gameTopbarName').textContent = currentSave.name || '未命名';
    updateGameTopbar();
    updateSidebar();
    updateAttributesPanel();
    updateInventoryPanel();
    updateMapPanel();
    updateCharactersPanel();
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
    const gold = currentSave.inventory.gold ?? 0;
    document.getElementById('inventoryCount').textContent = `(${items.length}/${currentSave.inventory.maxSlots})`;
    document.getElementById('inventoryGold').innerHTML = `<span class="inventory-gold-icon">💰</span><span class="inventory-gold-value">${gold}</span>`;
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
    const locations = currentSave.map.locations || {};

    let html = '';

    // 当前位置卡片
    html += `
        <div class="map-card map-card-current" onclick="showLocationDetail('${escapeHtml(cur)}')">
            <div class="map-card-header">
                <span class="map-card-name">📍 ${escapeHtml(cur)}</span>
                <span class="map-card-tag current">当前</span>
            </div>
            <div class="map-card-desc">${escapeHtml(loc?.description || '').slice(0, 60)}${(loc?.description || '').length > 60 ? '...' : ''}</div>
        </div>
    `;

    // 可前往的地点
    const conns = loc?.connections || [];
    if (conns.length > 0) {
        html += '<div class="map-section-title">可前往</div>';
        conns.forEach(c => {
            const cLoc = locations[c];
            html += `
                <div class="map-card" onclick="showLocationDetail('${escapeHtml(c)}')">
                    <div class="map-card-header">
                        <span class="map-card-name">${escapeHtml(c)}</span>
                    </div>
                    <div class="map-card-desc">${escapeHtml(cLoc?.description || '').slice(0, 50)}${(cLoc?.description || '').length > 50 ? '...' : ''}</div>
                    <div class="map-card-action" onclick="event.stopPropagation();moveToLocation('${escapeHtml(c)}')">前往 →</div>
                </div>
            `;
        });
    }

    // 已探索的其他地点
    const discovered = Object.entries(locations).filter(([k, v]) => v.discovered && k !== cur && !conns.includes(k));
    if (discovered.length > 0) {
        html += '<div class="map-section-title">已探索</div>';
        discovered.forEach(([name, data]) => {
            html += `
                <div class="map-card" onclick="showLocationDetail('${escapeHtml(name)}')">
                    <div class="map-card-header">
                        <span class="map-card-name">${escapeHtml(name)}</span>
                    </div>
                    <div class="map-card-desc">${escapeHtml(data.description || '').slice(0, 50)}${(data.description || '').length > 50 ? '...' : ''}</div>
                </div>
            `;
        });
    }

    document.getElementById('mapPanel').innerHTML = html;
}

function showLocationDetail(locName) {
    const loc = currentSave.map.locations[locName];
    if (!loc) return;

    const cur = currentSave.map.currentLocation;
    const isCurrent = locName === cur;
    const conns = currentSave.map.locations[cur]?.connections || [];
    const canGo = conns.includes(locName);

    let html = `
        <div style="margin-bottom:16px;">
            <h4 style="font-size:16px;font-weight:600;margin-bottom:4px;">📍 ${escapeHtml(locName)}</h4>
            ${isCurrent ? '<span style="font-size:11px;color:var(--accent);font-weight:500;">当前所在地</span>' : ''}
        </div>
        <div style="margin-bottom:16px;">
            <div style="font-size:12px;font-weight:600;color:var(--text-tertiary);margin-bottom:4px;">描述</div>
            <div style="font-size:13px;color:var(--text-secondary);line-height:1.7;">${escapeHtml(loc.description || '暂无描述')}</div>
        </div>
    `;

    // 该地点的连接
    const locConns = loc.connections || [];
    if (locConns.length > 0) {
        html += `<div style="margin-bottom:16px;"><div style="font-size:12px;font-weight:600;color:var(--text-tertiary);margin-bottom:4px;">相邻地点</div>`;
        locConns.forEach(c => {
            const isCur = c === cur;
            html += `<div style="font-size:12px;color:${isCur ? 'var(--accent)' : 'var(--text-secondary)'};padding:2px 0;">${isCur ? '📍 ' : '→ '}${escapeHtml(c)}${isCur ? ' (当前)' : ''}</div>`;
        });
        html += '</div>';
    }

    // 该地点的 NPC
    const npcs = loc.npcs || [];
    if (npcs.length > 0) {
        html += `<div style="margin-bottom:16px;"><div style="font-size:12px;font-weight:600;color:var(--text-tertiary);margin-bottom:4px;">在此的 NPC</div>`;
        npcs.forEach(n => {
            html += `<div style="font-size:12px;color:var(--text-secondary);padding:2px 0;">👤 ${escapeHtml(n)}</div>`;
        });
        html += '</div>';
    }

    // 前往按钮
    if (!isCurrent && canGo) {
        html += `<button class="btn btn-primary" style="width:100%;margin-top:8px;" onclick="closeModal('modalWorldInfo');moveToLocation('${escapeHtml(locName)}')">前往 ${escapeHtml(locName)}</button>`;
    }

    document.getElementById('worldInfoContent').innerHTML = html;
    openModal('modalWorldInfo');
}

function updateCharactersPanel() {
    const characters = currentSave.characters || {};
    const el = document.getElementById('charactersPanel');
    const list = Object.values(characters);

    if (list.length === 0) {
        el.innerHTML = '<span style="font-size:12px;color:var(--text-tertiary);">暂无</span>';
        return;
    }

    el.innerHTML = list.map(c => {
        const relTitle = c.relationship?.title || '陌生人';
        const relValue = c.relationship?.value ?? 0;
        const relColor = relValue > 50 ? 'positive' : relValue < -50 ? 'negative' : 'neutral';
        return `
            <div class="character-list-item" onclick="showCharacterDetail('${c.id}')">
                <div class="character-list-name">${escapeHtml(c.name)}</div>
                <div class="character-list-role">${escapeHtml(c.role || '')}</div>
                <div class="character-list-rel ${relColor}">${escapeHtml(relTitle)} (${relValue})</div>
            </div>
        `;
    }).join('');
}

async function showCharacterDetail(charId) {
    if (!currentSaveId) return;
    try {
        const resp = await fetch(`/api/game/characters/${charId}?saveId=${currentSaveId}`);
        if (!resp.ok) return;
        const char = await resp.json();

        const relTitle = char.relationship?.title || '陌生人';
        const relValue = char.relationship?.value ?? 0;
        const memories = char.memories || [];

        let html = `
            <div style="margin-bottom:16px;">
                <h4 style="font-size:16px;font-weight:600;margin-bottom:4px;">${escapeHtml(char.name)}</h4>
                <span style="font-size:12px;color:var(--text-secondary);">${escapeHtml(char.role || '未知身份')}</span>
            </div>
            <div style="margin-bottom:12px;">
                <div style="font-size:12px;font-weight:600;color:var(--text-tertiary);margin-bottom:4px;">关系</div>
                <div style="font-size:13px;">${escapeHtml(relTitle)} (${relValue})</div>
            </div>
        `;

        if (char.persona) {
            html += `<div style="margin-bottom:12px;"><div style="font-size:12px;font-weight:600;color:var(--text-tertiary);margin-bottom:4px;">性格</div><div style="font-size:13px;color:var(--text-secondary);">${escapeHtml(char.persona)}</div></div>`;
        }

        if (memories.length > 0) {
            html += `<div style="margin-bottom:12px;"><div style="font-size:12px;font-weight:600;color:var(--text-tertiary);margin-bottom:4px;">记忆 (${memories.length})</div>`;
            memories.slice(-10).forEach(m => {
                html += `<div style="font-size:12px;color:var(--text-secondary);padding:2px 0;border-bottom:1px solid var(--border-secondary);">${escapeHtml(m.text)}</div>`;
            });
            html += '</div>';
        }

        document.getElementById('worldInfoContent').innerHTML = html;
        openModal('modalWorldInfo');
    } catch(e) {}
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

// ----- 刷新所有 UI 面板 -----
function refreshAllPanels() {
    if (!currentSave) return;
    updateGameTopbar();
    updateSidebar();
    updateAttributesPanel();
    updateInventoryPanel();
    updateMapPanel();
    updateCharactersPanel();
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
            const playerName = currentSave?.player?.name || '你';
            const timeStr = formatMessageTime(msg.timestamp);
            html += `
                <div class="msg msg-player">
                    <div class="player-card">
                        <div class="player-card-header" style="margin-bottom:0;">
                            <span class="dialogue-speaker" style="color:#3B82F6;">${escapeHtml(playerName)}</span>
                            <div class="player-card-header-right" style="margin-bottom:6px;">
                                <span class="player-card-tag you" style="padding:1px 8px;font-size:8px;">你</span>
                                ${timeStr ? `<span class="msg-time">${timeStr}</span>` : ''}
                            </div>
                        </div>
                        <div class="dialogue-text">"${escapeHtml(msg.content)}"</div>
                    </div>
                </div>
            `;
        } else if (msg.role === 'assistant') {
            // 支持结构化内容渲染（新格式）
            if (msg.structured && msg.structured.content) {
                msg.structured.content.forEach(block => {
                    // 过滤掉工具返回的JSON（AI有时会错误地把工具结果写入content）
                    if (block.type && !['narrative','scene','dialogue','action','combat','loot','character','player_action'].includes(block.type)) return;
                    if (block.text && typeof block.text === 'string' && block.text.startsWith('{"success"')) return;
                    if (block.type === 'player_action') {
                        const playerName = currentSave?.player?.name || '你';
                        const timeStr = formatMessageTime(block.timestamp);
                        const displayText = block.dialogue || block.action || '';
                        html += `<div class="msg msg-player"><div class="player-card"><div class="player-card-header"><span class="player-card-name">👤 ${escapeHtml(playerName)}</span><div class="player-card-header-right">${timeStr ? `<span class="msg-time">${timeStr}</span>` : ''}<span class="player-card-tag you">你</span></div></div><div class="player-card-dialogue">"${escapeHtml(displayText)}"</div></div></div>`;
                    } else if (block.type === 'narrative') {
                        html += `<div class="msg msg-narrator">${formatNarratorText(block.text)}</div>`;
                    } else if (block.type === 'scene') {
                        html += `<div class="msg msg-scene"><div class="scene-card">${formatNarratorText(block.text)}</div></div>`;
                    } else if (block.type === 'dialogue') {
                        const speaker = escapeHtml(block.speaker || '???');
                        html += `<div class="msg msg-dialogue"><div class="dialogue-bubble"><div class="dialogue-speaker">${speaker}</div><div class="dialogue-text">${escapeHtml(block.text)}</div></div></div>`;
                    } else if (block.type === 'action') {
                        html += `<div class="msg msg-action"><div class="action-text">${formatNarratorText(block.text)}</div></div>`;
                    } else if (block.type === 'combat') {
                        html += `<div class="msg msg-combat"><div class="combat-text">${formatNarratorText(block.text)}</div></div>`;
                    } else if (block.type === 'loot') {
                        html += `<div class="msg msg-loot"><div class="loot-text">${formatNarratorText(block.text)}</div></div>`;
                    } else if (block.type === 'character') {
                        const moodEmoji = getMoodEmoji(block.mood);
                        const moodLabel = getMoodLabel(block.mood);
                        let cardHtml = `<div class="msg msg-character"><div class="character-card">`;
                        cardHtml += `<div class="character-card-header">`;
                        cardHtml += `<span class="character-name">${escapeHtml(block.characterName || '未知角色')}</span>`;
                        cardHtml += `<span class="character-mood ${block.mood || 'neutral'}">${moodEmoji} ${moodLabel}</span>`;
                        cardHtml += `</div>`;
                        if (block.reaction) cardHtml += `<div class="character-reaction">${escapeHtml(block.reaction)}</div>`;
                        if (block.dialogue) cardHtml += `<div class="character-dialogue">"${escapeHtml(block.dialogue)}"</div>`;
                        cardHtml += `</div></div>`;
                        html += cardHtml;
                    } else {
                        // 未知类型降级为 narrative
                        html += `<div class="msg msg-narrator">${formatNarratorText(block.text)}</div>`;
                    }
                });
            } else {
                // 兼容旧格式（纯文本 assistant 消息）
                // 过滤掉工具返回的JSON泄漏
                let text = msg.content || '';
                if (text.trim().startsWith('{"success"') || text.trim().startsWith('{\n{"success"')) {
                    text = '（系统数据已处理）';
                }
                html += `<div class="msg msg-narrator">${formatNarratorText(text)}</div>`;
            }
        } else if (msg.role === 'notification') {
            const cls = msg.type === 'positive' ? 'positive' : msg.type === 'negative' ? 'negative' : 'info';
            const icon = msg.type === 'positive' ? '✚' : msg.type === 'negative' ? '✖' : 'ℹ';
            html += `<div class="msg"><div class="msg-notification ${cls}"><span class="notif-icon">${icon}</span>${escapeHtml(msg.content)}</div></div>`;
        }
    });
    container.innerHTML = html;

    // 渲染最后一条 assistant 消息的选项按钮（刷新后恢复）
    const lastAssistant = history.slice().reverse().find(m => m.role === 'assistant' && m.structured?.options?.length > 0);
    if (lastAssistant && lastAssistant.structured.options.length > 0) {
        renderOptions(lastAssistant.structured.options);
    }

    scrollToBottom();
}

function formatNarratorText(text) {
    if (!text) return '';
    let html = escapeHtml(text);
    // 将中文引号内的对话转为对话气泡样式
    // 严格匹配 左引号...右引号
    html = html.replace(/\u201c([^\u201c\u201d]*?)\u201d/g, (match, content) => {
        return `<span class="inline-dialogue">\u201c${content}\u201d</span>`;
    });
    // 将英文双引号内的对话也转换
    html = html.replace(/"([^"]*?)"/g, (match, content) => {
        return `<span class="inline-dialogue">"${content}"</span>`;
    });
    return html.replace(/\n/g, '<br>');
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
    div.className = 'msg msg-player';
    const playerName = currentSave?.player?.name || '你';
    const timeStr = formatMessageTime(new Date().toISOString());
    div.innerHTML = `
        <div class="player-card">
            <div class="player-card-header" style="margin-bottom:0;">
                <span class="dialogue-speaker" style="color:#3B82F6;">${escapeHtml(playerName)}</span>
                <div class="player-card-header-right" style="margin-bottom:6px;">
                    <span class="player-card-tag you" style="padding:1px 8px;font-size:8px;">你</span>
                    ${timeStr ? `<span class="msg-time">${timeStr}</span>` : ''}
                </div>
            </div>
            <div class="dialogue-text">"${escapeHtml(text)}"</div>
        </div>
    `;
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

function addCharacterMessage(block) {
    const container = document.getElementById('gameMessages');
    const div = document.createElement('div');
    div.className = 'msg msg-character';

    const moodEmoji = getMoodEmoji(block.mood);
    const moodLabel = getMoodLabel(block.mood);

    let html = `
        <div class="character-card">
            <div class="character-card-header">
                <span class="character-name">${escapeHtml(block.characterName || '未知角色')}</span>
                <span class="character-mood ${block.mood || 'neutral'}">${moodEmoji} ${moodLabel}</span>
            </div>
    `;

    if (block.reaction) {
        html += `<div class="character-reaction">${escapeHtml(block.reaction)}</div>`;
    }
    if (block.dialogue) {
        html += `<div class="character-dialogue">"${escapeHtml(block.dialogue)}"</div>`;
    }

    html += '</div>';
    div.innerHTML = html;
    container.appendChild(div);
    scrollToBottom();
}

// ----- 新增 content type 渲染函数 -----

// 角色创建卡片（实时渲染到消息流）
function addCharacterCreatedCard(character) {
    const container = document.getElementById('gameMessages');
    const div = document.createElement('div');
    div.className = 'msg msg-character-created';

    const roleLabels = {
        merchant: '商人', blacksmith: '铁匠', mentor: '导师', companion: '同伴',
        antagonist: '反派', guard: '守卫', noble: '贵族', healer: '治疗师',
        quest_giver: '任务发布者', trainer: '训练师',
    };
    const roleLabel = roleLabels[character.role] || character.role || '未知';

    let extraInfo = '';
    if (character.extra) {
        const keys = Object.keys(character.extra);
        if (keys.length > 0) {
            extraInfo = `<div class="created-card-extra">${keys.map(k => `<span class="created-card-tag">${escapeHtml(k)}</span>`).join('')}</div>`;
        }
    }

    div.innerHTML = `
        <div class="created-card">
            <div class="created-card-header">
                <span class="created-card-icon">🎭</span>
                <span class="created-card-title">新角色登场</span>
            </div>
            <div class="created-card-body">
                <div class="created-card-name">${escapeHtml(character.name)}</div>
                <div class="created-card-role">${escapeHtml(roleLabel)}</div>
                ${character.personality ? `<div class="created-card-personality">${escapeHtml(character.personality)}</div>` : ''}
                ${character.speechStyle ? `<div class="created-card-speech">"${escapeHtml(character.speechStyle)}"</div>` : ''}
                ${extraInfo}
            </div>
        </div>
    `;
    container.appendChild(div);
    scrollToBottom();
}

function addSceneMessage(block) {
    const container = document.getElementById('gameMessages');
    const div = document.createElement('div');
    div.className = 'msg msg-scene';
    div.innerHTML = `<div class="scene-card">${formatNarratorText(block.text)}</div>`;
    container.appendChild(div);
    scrollToBottom();
}

function addDialogueMessage(block) {
    const container = document.getElementById('gameMessages');
    const div = document.createElement('div');
    div.className = 'msg msg-dialogue';
    const speaker = escapeHtml(block.speaker || '???');
    div.innerHTML = `
        <div class="dialogue-bubble">
            <div class="dialogue-speaker">${speaker}</div>
            <div class="dialogue-text">${escapeHtml(block.text)}</div>
        </div>
    `;
    container.appendChild(div);
    scrollToBottom();
}

function addPlayerActionMessage(block) {
    const container = document.getElementById('gameMessages');
    const div = document.createElement('div');
    div.className = 'msg msg-player';
    const playerName = currentSave?.player?.name || '你';
    const timeStr = formatMessageTime(new Date().toISOString());
    let contentHtml = '';
    if (block.dialogue) {
        contentHtml = `<div class="player-card-dialogue">"${escapeHtml(block.dialogue)}"</div>`;
    } else {
        contentHtml = `<div class="player-card-dialogue">"${escapeHtml(block.action)}"</div>`;
    }
    div.innerHTML = `
        <div class="player-card">
            <div class="player-card-header">
                <span class="player-card-name">👤 ${escapeHtml(playerName)}</span>
                <div class="player-card-header-right">
                    ${timeStr ? `<span class="msg-time">${timeStr}</span>` : ''}
                    <span class="player-card-tag you">你</span>
                </div>
            </div>
            ${contentHtml}
        </div>
    `;
    container.appendChild(div);
    scrollToBottom();
}

function addActionMessage(block) {
    const container = document.getElementById('gameMessages');
    const div = document.createElement('div');
    div.className = 'msg msg-action';
    div.innerHTML = `<div class="action-text">${formatNarratorText(block.text)}</div>`;
    container.appendChild(div);
    scrollToBottom();
}

function addCombatMessage(block) {
    const container = document.getElementById('gameMessages');
    const div = document.createElement('div');
    div.className = 'msg msg-combat';
    div.innerHTML = `<div class="combat-text">${formatNarratorText(block.text)}</div>`;
    container.appendChild(div);
    scrollToBottom();
}

function addLootMessage(block) {
    const container = document.getElementById('gameMessages');
    const div = document.createElement('div');
    div.className = 'msg msg-loot';
    div.innerHTML = `<div class="loot-text">${formatNarratorText(block.text)}</div>`;
    container.appendChild(div);
    scrollToBottom();
}

// ----- 心情辅助函数 -----
function getMoodEmoji(mood) {
    const map = {
        happy: '😊', sad: '😢', angry: '😠', fearful: '😨',
        surprised: '😲', neutral: '😐', curious: '🤔',
        contempt: '😤', disgusted: '🤢', loving: '🥰',
        anxious: '😰', excited: '😄', cold: '🧊',
        friendly: '🙂', hostile: '😈', suspicious: '👁️',
    };
    return map[mood] || '😐';
}

function getMoodLabel(mood) {
    const map = {
        happy: '开心', sad: '悲伤', angry: '愤怒', fearful: '恐惧',
        surprised: '惊讶', neutral: '平静', curious: '好奇',
        contempt: '轻蔑', disgusted: '厌恶', loving: '喜爱',
        anxious: '焦虑', excited: '兴奋', cold: '冷淡',
        friendly: '友好', hostile: '敌意', suspicious: '怀疑',
    };
    return map[mood] || '平静';
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

    // 清除旧的选项按钮
    const oldOptions = document.querySelector('.msg-options');
    if (oldOptions) oldOptions.remove();

    sendGameMessage(text);
}

async function sendGameMessage(text, isOption = false) {
    if (isGenerating) return;
    isGenerating = true;
    document.getElementById('gameSendBtn').disabled = true;

    // 选项选择：显示系统提示而非玩家消息卡片
    if (isOption) {
        addNotification(`玩家选择了「${text}」`, 'info');
    } else {
        addUserMessage(text);
    }

    try {
        await callAI(text, isOption);
    } catch(err) {
        addNotification('发生错误: ' + err.message, 'negative');
        showToast('请求失败: ' + err.message, 'error');
    }

    isGenerating = false;
    document.getElementById('gameSendBtn').disabled = false;
}
