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

            // 新游戏自动生成开场剧情
            if (!data.chatHistory || data.chatHistory.length === 0) {
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
