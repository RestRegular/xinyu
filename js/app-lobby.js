async function init() {
    await loadConfig();
    await loadSavesIndex();
    renderLobby();
}

// 覆盖 continueGame：存 active save id 后跳转
function continueGame(id) {
    localStorage.setItem('xinyu_active_save_id', id);
    window.location.href = 'game.html';
}

init();
