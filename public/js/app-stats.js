(async () => {
    const activeSaveId = localStorage.getItem('xinyu_active_save_id');
    if (activeSaveId) {
        const data = await loadSaveData(activeSaveId);
        if (data) {
            currentSave = data;
            currentSaveId = activeSaveId;
            document.getElementById('statsTitle').textContent = (data.name || '未命名') + ' — 游戏统计';
            renderStats();
        }
    }
})();
