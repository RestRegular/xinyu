// 从 localStorage 读取 active save id
const activeSaveId = localStorage.getItem('xinyu_active_save_id');
if (activeSaveId) {
    const data = loadSaveData(activeSaveId);
    if (data) {
        currentSaveId = activeSaveId;
        currentSave = data;
        enterGameView();
    } else {
        window.location.href = 'lobby.html';
    }
} else {
    window.location.href = 'lobby.html';
}

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
