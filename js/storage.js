// ===================================================================
// ===== 存储系统（后端 API 版） =====
// ===================================================================
const API_BASE = '/api';

// ----- 配置 -----
let _configCache = null;

async function loadConfig() {
    try {
        const resp = await fetch(`${API_BASE}/config`);
        if (resp.ok) {
            const data = await resp.json();
            const defaults = {
                apiKey: '',
                apiBaseUrl: 'https://api.deepseek.com/v1/chat/completions',
                model: 'deepseek-chat',
                temperature: 0.9,
                maxTokens: 1024,
                ui: { fontSize: 'medium', narrativeLength: 'medium' },
                customInstructions: '',
                lastVisitedSaveId: null,
            };
            appConfig = { ...defaults, ...data, ui: { ...defaults.ui, ...(data.ui || {}) } };
            _configCache = appConfig;
            return;
        }
    } catch(e) {
        console.warn('无法连接服务器，使用本地缓存');
    }
    // 降级：使用 localStorage 缓存
    try {
        const raw = localStorage.getItem('xinyu_config_cache');
        if (raw) {
            const defaults = {
                apiKey: '', apiBaseUrl: 'https://api.deepseek.com/v1/chat/completions',
                model: 'deepseek-chat', temperature: 0.9, maxTokens: 1024,
                ui: { fontSize: 'medium', narrativeLength: 'medium' },
                customInstructions: '', lastVisitedSaveId: null,
            };
            appConfig = { ...defaults, ...JSON.parse(raw), ui: { ...defaults.ui, ...(JSON.parse(raw).ui || {}) } };
            return;
        }
    } catch(e2) {}
    appConfig = {
        apiKey: '', apiBaseUrl: 'https://api.deepseek.com/v1/chat/completions',
        model: 'deepseek-chat', temperature: 0.9, maxTokens: 1024,
        ui: { fontSize: 'medium', narrativeLength: 'medium' },
        customInstructions: '', lastVisitedSaveId: null,
    };
}

async function saveConfig() {
    try {
        await fetch(`${API_BASE}/config`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                apiKey: appConfig.apiKey,
                apiBaseUrl: appConfig.apiBaseUrl,
                model: appConfig.model,
                temperature: appConfig.temperature,
                maxTokens: appConfig.maxTokens,
                ui: appConfig.ui,
                customInstructions: appConfig.customInstructions,
            }),
        });
        // 同时缓存到 localStorage 作为降级
        localStorage.setItem('xinyu_config_cache', JSON.stringify(appConfig));
    } catch(e) {
        console.warn('保存配置失败，仅缓存到本地');
        localStorage.setItem('xinyu_config_cache', JSON.stringify(appConfig));
    }
}

// ----- 存档索引 -----
async function loadSavesIndex() {
    try {
        const resp = await fetch(`${API_BASE}/saves`);
        if (resp.ok) {
            const data = await resp.json();
            savesIndex = { saves: data };
            return;
        }
    } catch(e) {}
    savesIndex = { saves: [] };
}

async function saveSavesIndex() {
    // 存档索引由后端自动管理，此函数保留兼容性但实际为空操作
}

// ----- 存档数据 -----
async function loadSaveData(id) {
    try {
        const resp = await fetch(`${API_BASE}/saves/${id}`);
        if (resp.ok) return await resp.json();
    } catch(e) {}
    return null;
}

async function saveSaveData(id, data) {
    try {
        await fetch(`${API_BASE}/saves/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                data,
                worldName: data.world?.name || '',
                worldGenre: data.world?.genre || '',
                playerName: data.player?.name || '',
                playerLevel: data.player?.level || 1,
                currentLocation: data.map?.currentLocation || '',
                turnCount: data.stats?.turnCount || 0,
                playTime: data.stats?.playTime || 0,
            }),
        });
    } catch(e) {
        console.warn('保存存档失败:', e);
    }
}

async function deleteSaveData(id) {
    try {
        await fetch(`${API_BASE}/saves/${id}`, { method: 'DELETE' });
    } catch(e) {}
}

function generateId() {
    return 'save_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
}
