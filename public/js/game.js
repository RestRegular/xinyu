// ===================================================================
// ===== 游戏界面（纯叙事RP版 - 纯 UI 展示层） =====
// ===================================================================

// 追踪已渲染的块索引（用于增量渲染）
var currentLastBlockIndex = -1;

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
    renderGameMessages();
}

function updateGameTopbar() {
    document.getElementById('gameTopbarTurn').textContent = `回合 ${currentSave.stats?.turnCount || 0}`;
}

function updateSidebar() {
    document.getElementById('sidebarCharName').textContent = currentSave.player.name;
    const info = [];
    if (currentSave.player.gender && currentSave.player.gender !== '未设定') info.push(currentSave.player.gender);
    if (currentSave.player.age && currentSave.player.age !== '未设定') info.push(currentSave.player.age);
    if (currentSave.player.occupation) info.push(currentSave.player.occupation);
    document.getElementById('sidebarCharInfo').textContent = info.length > 0 ? info.join(' · ') : currentSave.world.name;
}

function backToLobby() {
    if (isGenerating) {
        showToast('请等待AI回复完成', 'warning');
        return;
    }
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
    try {
        updateGameTopbar();
        updateSidebar();
    } catch (err) {
        console.error('[refreshAllPanels] Error:', err);
    }
}

// ===================================================================
// ===== 消息渲染（纯 UI） =====
// ===================================================================
function renderGameMessages(data) {
    const container = document.getElementById('gameMessages');
    if (!container) return;

    // 如果没有传入 data，使用 currentSave.chatHistory（默认行为）
    if (data === undefined) {
        data = currentSave.chatHistory || [];
    }

    // 新格式：renderBlocks 数组（每项有 id 字段标识为渲染块）
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

    // 旧格式兼容：chatHistory 数组（按 role 分支渲染）
    if (Array.isArray(data) && data.length > 0) {
        let html = '';
        data.forEach(msg => {
            if (msg.role === 'system') {
                // 系统消息不渲染
            } else if (msg.role === 'user') {
                if (msg.content && msg.content.startsWith('[系统]')) return;
                const playerName = currentSave?.player?.name || '你';
                const timeStr = formatMessageTime(msg.timestamp);

                // 检查是否是结构化消息
                if (msg.structured && msg.structured.content) {
                    let contentHtml;
                    const block = msg.structured.content[0];
                    if (block.action) {
                        contentHtml = `<div class="player-action">${escapeHtml(block.action)}</div>`;
                    } else if (block.dialogue) {
                        contentHtml = `<div class="dialogue-text">${escapeHtml(block.dialogue)}</div>`;
                    } else {
                        contentHtml = `<div class="dialogue-text">${escapeHtml(msg.content)}</div>`;
                    }

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
                                ${contentHtml}
                            </div>
                        </div>
                    `;
                }
            } else if (msg.role === 'assistant') {
                // 支持结构化内容渲染（新格式）
                if (msg.structured && msg.structured.content) {
                    msg.structured.content.forEach(block => {
                        // 过滤掉工具返回的JSON（AI有时会错误地把工具结果写入content）
                        if (block.type && !['narrative', 'scene', 'dialogue', 'action', 'combat', 'loot', 'character', 'player_action'].includes(block.type)) return;
                        if (block.text && typeof block.text === 'string' && block.text.startsWith('{"success"')) return;
                        if (block.type === 'player_action') {
                            const playerName = currentSave?.player?.name || '你';
                            const timeStr = formatMessageTime(block.timestamp);

                            let contentHtml = '';
                            if (block.action) {
                                contentHtml = `<div class="player-action">${escapeHtml(block.action)}</div>`;
                            } else if (block.dialogue) {
                                contentHtml = `<div class="dialogue-text">${escapeHtml(block.dialogue)}</div>`;
                            } else {
                                contentHtml = `<div class="dialogue-text">${escapeHtml(block.action || block.dialogue || '')}</div>`;
                            }

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
                                        ${contentHtml}
                                    </div>
                                </div>
                            `;
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
                            if (block.dialogue) cardHtml += `<div class="character-dialogue">${escapeHtml(block.dialogue)}</div>`;
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
        const lastAssistant = data.slice().reverse().find(m => m.role === 'assistant' && m.structured?.options?.length > 0);
        if (lastAssistant && lastAssistant.structured.options.length > 0) {
            renderOptions(lastAssistant.structured.options);
        }

        scrollToBottom();
        return;
    }

    container.innerHTML = '';
}

// ----- 新格式渲染块函数（renderBlock 系列） -----

function appendRenderBlocks(blocks) {
    const container = document.getElementById('gameMessages');
    if (!container) return;

    // 收集前端已即时渲染的 notification 文本（用于去重）
    const existingNotifs = new Set();
    container.querySelectorAll('.msg-notification').forEach(el => {
        const text = el.textContent.replace(/^[✚✖ℹ]\s*/, '').trim();
        if (text) existingNotifs.add(text);
    });

    for (const block of blocks) {
        // 跳过与前端已渲染 notification 文本相同的块（避免实时显示时重复）
        if (block.type === 'notification' && existingNotifs.has(block.data.text)) continue;
        container.insertAdjacentHTML('beforeend', renderBlock(block));
    }
    scrollToBottom();
}

function renderBlock(block) {
    switch (block.type) {
        case 'system':
            return '';
        case 'player':
            return renderPlayerBlock(block);
        case 'narrative':
            return `<div class="msg msg-narrator">${formatNarratorText(block.data.text)}</div>`;
        case 'scene':
            return `<div class="msg msg-scene"><div class="scene-card">${formatNarratorText(block.data.text)}</div></div>`;
        case 'dialogue':
            return renderDialogueBlock(block);
        case 'action':
            return `<div class="msg msg-action"><div class="action-text">${formatNarratorText(block.data.text)}</div></div>`;
        case 'combat':
            return `<div class="msg msg-combat"><div class="combat-text">${formatNarratorText(block.data.text)}</div></div>`;
        case 'loot':
            return `<div class="msg msg-loot"><div class="loot-text">${formatNarratorText(block.data.text)}</div></div>`;
        case 'character':
            return renderCharacterBlock(block);
        case 'notification':
            return renderNotificationBlock(block);
        default:
            return `<div class="msg msg-narrator">${escapeHtml(block.data?.text || '')}</div>`;
    }
}

function renderPlayerBlock(block) {
    const d = block.data;
    const time = formatTime(block.timestamp);
    let html = `<div class="msg msg-player">
        <div class="player-card">
            <div class="player-card-header" style="margin-bottom:0;">
                <span class="dialogue-speaker" style="color:#3B82F6;">${escapeHtml(currentSave?.player?.name || '你')}</span>
                <div class="player-card-header-right" style="margin-bottom:6px;">
                    <span class="player-card-tag you" style="padding:1px 8px;font-size:8px;">你</span>
                    ${time ? `<span class="msg-time">${time}</span>` : ''}
                </div>
            </div>`;
    if (d.segments && Array.isArray(d.segments)) {
        // 新格式：按 segments 数组顺序渲染
        for (const seg of d.segments) {
            if (seg.type === 'action' && seg.text) {
                html += `<div class="player-action">${escapeHtml(seg.text)}</div>`;
            } else if (seg.type === 'dialogue' && seg.text) {
                html += `<div class="dialogue-text">${escapeHtml(seg.text)}</div>`;
            }
        }
    } else {
        // 兼容旧格式：action + dialogue
        if (d.action) {
            const actions = d.action.split('\n').filter(s => s.trim());
            for (const a of actions) {
                html += `<div class="player-action">${escapeHtml(a.trim())}</div>`;
            }
        }
        if (d.dialogue) {
            const dialogues = d.dialogue.split('\n').filter(s => s.trim());
            for (const dl of dialogues) {
                html += `<div class="dialogue-text">${escapeHtml(dl.trim())}</div>`;
            }
        }
    }
    html += '</div></div>';
    return html;
}

function renderDialogueBlock(block) {
    const d = block.data;
    const speaker = escapeHtml(d.speaker || '???');
    // 兜底：如果对话没有引号，自动用「」包裹
    let text = d.text || '';
    if (text && !text.startsWith('「') && !text.startsWith('"') && !text.startsWith('"')) {
        text = `「${text}」`;
    }
    return `<div class="msg msg-character">
        <div class="character-card">
            <div class="character-card-header">
                <span class="character-name">${speaker}</span>
            </div>
            <div class="character-dialogue">${escapeHtml(text)}</div>
        </div>
    </div>`;
}

function renderCharacterBlock(block) {
    const d = block.data;
    let html = `<div class="msg msg-character">
        <div class="character-card">
            <div class="character-card-header">
                <span class="character-name">${escapeHtml(d.characterName || '未知角色')}</span>
                ${d.mood ? `<span class="character-mood ${d.mood}">${getMoodEmoji(d.mood)} ${getMoodLabel(d.mood)}</span>` : ''}
            </div>`;

    if (d.segments && Array.isArray(d.segments)) {
        // 新格式：按 segments 数组顺序渲染
        for (const seg of d.segments) {
            if (seg.type === 'reaction' && seg.text) {
                html += `<div class="character-reaction">${escapeHtml(seg.text)}</div>`;
            } else if (seg.type === 'dialogue' && seg.text) {
                html += `<div class="character-dialogue">${escapeHtml(seg.text)}</div>`;
            }
        }
    } else {
        // 兼容旧格式：reaction + dialogue
        if (d.reaction) {
            const reactions = d.reaction.split('\n').filter(s => s.trim());
            for (const r of reactions) {
                html += `<div class="character-reaction">${escapeHtml(r.trim())}</div>`;
            }
        }
        if (d.dialogue) {
            const dialogues = d.dialogue.split('\n').filter(s => s.trim());
            for (const dl of dialogues) {
                html += `<div class="character-dialogue">${escapeHtml(dl.trim())}</div>`;
            }
        }
    }

    html += '</div></div>';
    return html;
}

function renderNotificationBlock(block) {
    const d = block.data;
    const cls = d.notifType === 'positive' ? 'positive' : d.notifType === 'negative' ? 'negative' : 'info';
    const icon = d.notifType === 'positive' ? '✚' : d.notifType === 'negative' ? '✖' : 'ℹ';
    return `<div class="msg"><div class="msg-notification ${cls}"><span class="notif-icon">${icon}</span>${escapeHtml(d.text)}</div></div>`;
}

// 格式化时间（兼容 renderBlock 使用的 timestamp）
function formatTime(timestamp) {
    if (!timestamp) return '';
    return formatMessageTime(timestamp);
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

function addUserMessage(block) {
    const container = document.getElementById('gameMessages');
    const div = document.createElement('div');
    div.className = 'msg msg-player';

    const playerName = currentSave?.player?.name || '你';
    const timeStr = formatMessageTime(new Date().toISOString());

    let contentHtml = '';

    // 支持动作（action）或对话（dialogue）
    if (block.action) {
        // 动作：不带引号，用斜体或特殊样式表示
        contentHtml = `<div class="player-action">${escapeHtml(block.action)}</div>`;
    } else if (block.dialogue) {
        // 对话：由 AI 自行决定引号风格
        contentHtml = `<div class="dialogue-text">${escapeHtml(block.dialogue)}</div>`;
    } else if (typeof block === 'string') {
        // 兼容旧的字符串调用方式
        contentHtml = `<div class="dialogue-text">${escapeHtml(block)}</div>`;
    }

    div.innerHTML = `
        <div class="player-card">
            <div class="player-card-header" style="margin-bottom:0;">
                <span class="dialogue-speaker" style="color:#3B82F6;">${escapeHtml(playerName)}</span>
                <div class="player-card-header-right" style="margin-bottom:6px;">
                    <span class="player-card-tag you" style="padding:1px 8px;font-size:8px;">你</span>
                    ${timeStr ? `<span class="msg-time">${timeStr}</span>` : ''}
                </div>
            </div>
            ${contentHtml}
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
        html += `<div class="character-dialogue">${escapeHtml(block.dialogue)}</div>`;
    }

    html += '</div>';
    div.innerHTML = html;
    container.appendChild(div);
    scrollToBottom();
}

// ----- 新增 content type 渲染函数 -----

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
        friendly_concerned: '🙂', concerned: '😟', warm: '😊',
        serious: '😐', playful: '😄', thoughtful: '🤔',
        nervous: '😰', calm: '😌', grateful: '😊',
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
        friendly_concerned: '关切', concerned: '担忧', warm: '温暖',
        serious: '严肃', playful: '俏皮', thoughtful: '沉思',
        nervous: '紧张', calm: '从容', grateful: '感激',
    };
    return map[mood] || mood || '平静';
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

    // 清除旧的选项按钮
    const optionsArea = document.getElementById('gameOptionsArea');
    if (optionsArea) optionsArea.innerHTML = '';

    sendGameMessage(text);
}

async function sendGameMessage(text, isOption = false) {
    if (isGenerating) return;
    isGenerating = true;
    document.getElementById('gameSendBtn').disabled = true;

    // 选项选择：前端即时显示 notification 作为用户反馈
    if (isOption) {
        addNotification(`玩家选择了「${text}」`, 'info');
    } else {
        addUserMessage(text);
    }

    try {
        await callAI(text, isOption);
    } catch (err) {
        addNotification('发生错误: ' + err.message, 'negative');
        showToast('请求失败: ' + err.message, 'error');
    }

    isGenerating = false;
    document.getElementById('gameSendBtn').disabled = false;
}
