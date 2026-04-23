(async () => {
    // 初始化配置
    await loadConfig();
    await loadSavesIndex();

    // 从 localStorage 读取 active save id
    const activeSaveId = localStorage.getItem('xinyu_active_save_id');
    if (activeSaveId) {
        const data = await loadSaveData(activeSaveId);
        if (data) {
            currentSaveId = activeSaveId;
            currentSave = data;
            enterGameView();

            // 优先使用 renderHistory（新格式渲染块）
            if (data.renderHistory && data.renderHistory.renderBlocks && data.renderHistory.renderBlocks.length > 0) {
                renderGameMessages(data.renderHistory.renderBlocks);
                if (data.renderHistory.currentOptions && data.renderHistory.currentOptions.length > 0) {
                    renderOptions(data.renderHistory.currentOptions);
                }
                currentLastBlockIndex = data.renderHistory.renderBlocks.length - 1;
            } else if (Array.isArray(data.chatHistory) && data.chatHistory.length > 0) {
                // 旧格式兼容：chatHistory 是数组
                renderGameMessages(data.chatHistory);
            } else if (data.chatHistory && data.chatHistory.messages && data.chatHistory.messages.length > 0) {
                // 新格式但无 renderHistory：从 chatHistory 重建（防御性降级，正常情况下后端已自动重建）
                // 合并 messages 和 notifications，按 timestamp 排序后统一渲染
                const allItems = [];

                for (const msg of data.chatHistory.messages) {
                    allItems.push({ ...msg, _source: 'message' });
                }
                for (const notif of (data.chatHistory.notifications || [])) {
                    allItems.push({
                        id: notif.id || ('notif_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6)),
                        type: 'notification',
                        timestamp: notif.timestamp,
                        data: { text: notif.text, notifType: notif.type || 'info' },
                        _source: 'notification'
                    });
                }

                // 按 timestamp 稳定排序
                allItems.sort((a, b) => {
                    const ta = new Date(a.timestamp).getTime();
                    const tb = new Date(b.timestamp).getTime();
                    if (ta !== tb) return ta - tb;
                    return 0;
                });

                // 统一渲染
                const container = document.getElementById('gameMessages');
                if (container) {
                    const msgs = data.chatHistory.messages;
                    for (let i = 0; i < allItems.length; i++) {
                        const item = allItems[i];
                        if (item._source === 'notification') {
                            container.insertAdjacentHTML('beforeend',
                                `<div class="msg"><div class="msg-notification ${item.data.notifType || 'info'}"><span class="notif-icon">${item.data.notifType === 'positive' ? '✚' : item.data.notifType === 'negative' ? '✖' : 'ℹ'}</span>${escapeHtml(item.data.text)}</div></div>`
                            );
                        } else {
                            // message 格式渲染
                            if (item.role === 'user') {
                                if (item.content && item.content.startsWith('[系统]')) continue;
                                // 检查下一条 assistant 消息是否包含 player_action（避免重复渲染）
                                const nextAssistant = msgs[msgs.indexOf(item) + 1];
                                if (nextAssistant && nextAssistant.role === 'assistant' && nextAssistant.structured && nextAssistant.structured.content) {
                                    const hasPlayerAction = nextAssistant.structured.content.some(b => b.type === 'player_action');
                                    if (hasPlayerAction) continue; // player_action 会渲染完整的 player card
                                }
                                container.insertAdjacentHTML('beforeend',
                                    `<div class="msg"><div class="msg-player">${escapeHtml(item.content)}</div></div>`
                                );
                            } else if (item.role === 'assistant' && item.structured && item.structured.content) {
                                for (const block of item.structured.content) {
                                    // 将 AI content block 转为渲染块格式
                                    const rb = block.data ? block : { ...block, data: { text: block.text, speaker: block.speaker, characterName: block.characterName, mood: block.mood, reaction: block.reaction, dialogue: block.dialogue, action: block.action } };
                                    container.insertAdjacentHTML('beforeend', renderBlock(rb));
                                }
                            }
                        }
                    }
                    scrollToBottom();
                    // 从最后一条 assistant 消息恢复 options
                    const lastAssistant = [...data.chatHistory.messages].reverse().find(m => m.role === 'assistant' && m.structured && m.structured.options);
                    if (lastAssistant) renderOptions(lastAssistant.structured.options);
                }
            }

            // 新游戏检测（同时检查新旧格式）
            const isNewGame = !data.chatHistory ||
                (Array.isArray(data.chatHistory) && data.chatHistory.length === 0) ||
                (!Array.isArray(data.chatHistory) && data.chatHistory.messages && data.chatHistory.messages.length === 0);

            if (isNewGame) {
                addSystemMessage(`欢迎来到${data.world.name}，${data.player.name}。你的冒险即将开始...`);
                // 构建开场提示，如果有自定义初始剧情提示则追加
                const openingHint = data.world.openingPrompt
                    ? '【玩家指定的开场方向】\n' + data.world.openingPrompt
                    : null;
                const openingMessage = `[系统] 玩家开始新游戏，请根据世界设定和角色背景${openingHint ? '以及玩家指定的开场方向（注：指定的内容未出现在历史记录中）' : ''}，生成一段沉浸式的开场剧情。不要替玩家做任何决定。\n${openingHint}`;
                // 直接调用AI生成开场剧情，不显示为玩家消息
                callAI(openingMessage).catch(err => {
                    addNotification('开场剧情生成失败: ' + err.message, 'negative');
                });
            }
        } else {
            window.location.href = 'lobby.html';
        }
    } else {
        window.location.href = 'lobby.html';
    }
})();

// 覆盖 backToLobby
function backToLobby() {
    if (isGenerating) { showToast('请等待AI回复完成', 'warning'); return; }
    autoSave();
    currentSave = null;
    window.location.href = 'lobby.html';
}

// 覆盖 showGameStats
function showGameStats() {
    localStorage.setItem('xinyu_active_save_id', currentSaveId);
    window.location.href = 'stats.html';
}

// 键盘快捷键
document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        if (currentSave) manualSave();
    }
    if (e.key === 'Escape') {
        closeDropdowns();
        document.querySelectorAll('.modal-overlay.active').forEach(m => m.classList.remove('active'));
    }
});
