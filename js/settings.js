// ===================================================================
// ===== 设置页面 =====
// ===================================================================
function populateSettings() {
    document.getElementById('settingApiKey').value = appConfig.apiKey || '';
    document.getElementById('settingApiUrl').value = appConfig.apiBaseUrl || '';
    document.getElementById('settingModel').value = appConfig.model || '';
    document.getElementById('settingTemp').value = appConfig.temperature || 0.9;
    document.getElementById('tempVal').textContent = appConfig.temperature || 0.9;
    document.getElementById('settingMaxTokens').value = appConfig.maxTokens || 1024;
    document.getElementById('settingNarrative').value = appConfig.ui?.narrativeLength || 'medium';
}

function saveSettingsFromUI() {
    appConfig.apiKey = document.getElementById('settingApiKey').value.trim();
    appConfig.apiBaseUrl = document.getElementById('settingApiUrl').value.trim();
    appConfig.model = document.getElementById('settingModel').value.trim();
    appConfig.temperature = parseFloat(document.getElementById('settingTemp').value) || 0.9;
    appConfig.maxTokens = parseInt(document.getElementById('settingMaxTokens').value) || 1024;
    appConfig.ui.narrativeLength = document.getElementById('settingNarrative').value;
    saveConfig();
}

async function testApiKey() {
    const key = document.getElementById('settingApiKey').value.trim();
    if (!key) { showToast('请输入 API Key', 'warning'); return; }
    try {
        const resp = await fetch(appConfig.apiBaseUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
            body: JSON.stringify({ model: appConfig.model, messages: [{ role: 'user', content: 'hi' }], max_tokens: 5 }),
        });
        if (resp.ok) {
            showToast('API Key 验证成功', 'success');
            appConfig.apiKey = key;
            saveConfig();
        } else {
            const err = await resp.text();
            showToast(`验证失败: ${resp.status}`, 'error');
        }
    } catch(e) {
        showToast('网络错误: ' + e.message, 'error');
    }
}

// 监听设置变更
['settingApiKey', 'settingApiUrl', 'settingModel', 'settingTemp', 'settingMaxTokens', 'settingNarrative'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', saveSettingsFromUI);
});
