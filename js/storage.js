// ===================================================================
// ===== 存储系统 =====
// ===================================================================
function loadConfig() {
    try {
        const raw = localStorage.getItem(STORAGE_KEYS.config);
        if (raw) { appConfig = JSON.parse(raw); return; }
    } catch(e) {}
    appConfig = {
        apiKey: '',
        apiBaseUrl: 'https://api.deepseek.com/v1/chat/completions',
        model: 'deepseek-chat',
        temperature: 0.9,
        maxTokens: 1024,
        ui: { fontSize: 'medium', narrativeLength: 'medium' },
        lastVisitedSaveId: null,
    };
    saveConfig();
}

function saveConfig() {
    localStorage.setItem(STORAGE_KEYS.config, JSON.stringify(appConfig));
}

function loadSavesIndex() {
    try {
        const raw = localStorage.getItem(STORAGE_KEYS.saves);
        if (raw) { savesIndex = JSON.parse(raw); return; }
    } catch(e) {}
    savesIndex = { saves: [], sortOrder: 'lastSaved', filterGenre: 'all', searchQuery: '' };
    saveSavesIndex();
}

function saveSavesIndex() {
    localStorage.setItem(STORAGE_KEYS.saves, JSON.stringify(savesIndex));
}

function loadSaveData(id) {
    try {
        const raw = localStorage.getItem(SAVE_PREFIX + id);
        if (raw) return JSON.parse(raw);
    } catch(e) {}
    return null;
}

function saveSaveData(id, data) {
    localStorage.setItem(SAVE_PREFIX + id, JSON.stringify(data));
}

function deleteSaveData(id) {
    localStorage.removeItem(SAVE_PREFIX + id);
}

function generateId() {
    return 'save_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
}
