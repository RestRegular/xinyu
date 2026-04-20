// ===================================================================
// ===== 键盘快捷键 =====
// ===================================================================
document.addEventListener('keydown', (e) => {
    // Ctrl+S 保存
    if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        if (currentSave) manualSave();
    }
    // Esc 返回
    if (e.key === 'Escape') {
        closeDropdowns();
        document.querySelectorAll('.modal-overlay.active').forEach(m => m.classList.remove('active'));
    }
});

// ===================================================================
// ===== 新游戏按钮绑定 =====
// ===================================================================
document.getElementById('newGameNextBtn').addEventListener('click', function() {
    const step2Visible = !document.getElementById('newGameStep2').classList.contains('hidden');
    if (step2Visible) {
        createNewGame();
    }
});

// ===================================================================
// ===== 初始化 =====
// ===================================================================
function init() {
    loadConfig();
    loadSavesIndex();
    renderLobby();

    // 如果有上次访问的存档，不自动进入（让用户选择）
}

init();
