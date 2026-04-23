// ===================================================================
// ===== 设置页面 =====
// ===================================================================
function populateSettings() {
    document.getElementById('settingApiKey').value = appConfig.apiKey || '';
    document.getElementById('settingApiUrl').value = appConfig.apiBaseUrl || '';
    document.getElementById('settingModel').value = appConfig.model || '';
    document.getElementById('settingTemp').value = appConfig.temperature || 0.9;
    document.getElementById('tempVal').textContent = appConfig.temperature || 0.9;
    document.getElementById('settingMaxTokens').value = appConfig.maxTokens || 4096;
    document.getElementById('settingNarrative').value = appConfig.ui?.narrativeLength || 'medium';
    document.getElementById('settingCustomInstructions').value = appConfig.customInstructions || '';
}

function saveSettingsFromUI() {
    appConfig.apiKey = document.getElementById('settingApiKey').value.trim();
    appConfig.apiBaseUrl = document.getElementById('settingApiUrl').value.trim();
    appConfig.model = document.getElementById('settingModel').value.trim();
    appConfig.temperature = parseFloat(document.getElementById('settingTemp').value) || 0.9;
    appConfig.maxTokens = parseInt(document.getElementById('settingMaxTokens').value) || 4096;
    appConfig.ui.narrativeLength = document.getElementById('settingNarrative').value;
    appConfig.customInstructions = document.getElementById('settingCustomInstructions').value.trim();
    saveConfig();
}

async function testApiKey() {
    const key = document.getElementById('settingApiKey').value.trim();
    if (!key) { showToast('请输入 API Key', 'warning'); return; }
    // 先临时保存
    appConfig.apiKey = key;
    await saveConfig();
    try {
        const resp = await fetch('/api/ai/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ apiKey: key }),
        });
        const data = await resp.json();
        if (data.valid) {
            showToast('API Key 验证成功', 'success');
            appConfig.apiKey = key;
            await saveConfig();
        } else {
            showToast(`验证失败: ${data.error || '未知错误'}`, 'error');
        }
    } catch(e) {
        showToast('验证失败: ' + e.message, 'error');
    }
}

// 监听设置变更（API相关实时保存，其余change时保存）
['settingApiKey', 'settingApiUrl', 'settingModel'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', saveSettingsFromUI);
});
['settingTemp', 'settingMaxTokens', 'settingNarrative'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', saveSettingsFromUI);
});

// 提示词预览
function previewPrompt() {
    const el = document.getElementById('promptPreviewContent');
    if (typeof getPromptPreview === 'function') {
        el.textContent = getPromptPreview();
    } else {
        el.textContent = '提示词预览功能需要加载游戏数据。\n\n请先进入一局游戏，然后返回设置页面查看完整提示词。';
    }
    openModal('modalPromptPreview');
}

function copyPrompt() {
    const el = document.getElementById('promptPreviewContent');
    const text = el.textContent;
    navigator.clipboard.writeText(text).then(() => {
        showToast('已复制到剪贴板', 'success');
    }).catch(() => {
        showToast('复制失败', 'error');
    });
}
