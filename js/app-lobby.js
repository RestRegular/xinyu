function init() {
    loadConfig();
    loadSavesIndex();
    renderLobby();
}

// 覆盖 continueGame：存 active save id 后跳转
function continueGame(id) {
    localStorage.setItem('xinyu_active_save_id', id);
    window.location.href = 'game.html';
}

// 新游戏按钮绑定
document.getElementById('newGameNextBtn').addEventListener('click', function() {
    const step2Visible = !document.getElementById('newGameStep2').classList.contains('hidden');
    if (step2Visible) {
        createNewGame();
    }
});

init();
