(async () => {
    await loadConfig();
    await loadSavesIndex();

    // 尝试加载当前存档（用于提示词预览）
    const activeSaveId = localStorage.getItem('xinyu_active_save_id');
    if (activeSaveId) {
        const data = await loadSaveData(activeSaveId);
        if (data) {
            currentSave = data;
            currentSaveId = activeSaveId;
        }
    }

    populateSettings();
})();
