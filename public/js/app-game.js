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
            if (data.renderHistory && data.renderHistory.blocks && data.renderHistory.blocks.length > 0) {
                renderGameMessages(data.renderHistory.blocks);
                if (data.renderHistory.options && data.renderHistory.options.length > 0) {
                    renderOptions(data.renderHistory.options);
                }
                currentLastBlockIndex = data.renderHistory.blocks.length - 1;
            } else if (Array.isArray(data.chatHistory) && data.chatHistory.length > 0) {
                // 旧格式兼容：chatHistory 是数组
                renderGameMessages(data.chatHistory);
            } else if (data.chatHistory && data.chatHistory.messages && data.chatHistory.messages.length > 0) {
                // 新格式但无 renderHistory：从 chatHistory 重建
                renderGameMessages(data.chatHistory.messages);
                // 渲染 notifications
                if (data.chatHistory.notifications && data.chatHistory.notifications.length > 0) {
                    const container = document.getElementById('gameMessages');
                    if (container) {
                        for (const notif of data.chatHistory.notifications) {
                            container.insertAdjacentHTML('beforeend',
                                `<div class="msg"><div class="msg-notification ${notif.type || 'info'}"><span class="notif-icon">${notif.type === 'positive' ? '✚' : notif.type === 'negative' ? '✖' : 'ℹ'}</span>${escapeHtml(notif.text)}</div></div>`
                            );
                        }
                    }
                }
            }

            // 新游戏检测（同时检查新旧格式）
            const isNewGame = !data.chatHistory ||
                (Array.isArray(data.chatHistory) && data.chatHistory.length === 0) ||
                (!Array.isArray(data.chatHistory) && data.chatHistory.messages && data.chatHistory.messages.length === 0);

            if (isNewGame) {
                addSystemMessage(`欢迎来到${data.world.name}，${data.player.name}。你的冒险即将开始...`);
                // 直接调用AI生成开场剧情，不显示为玩家消息
                callAI('[系统] 玩家开始新游戏，请根据世界设定和角色背景，生成一段沉浸式的开场剧情。描述玩家最初醒来的场景、周围的环境，并暗示接下来可能发生的事情。不要替玩家做任何决定。').catch(err => {
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
