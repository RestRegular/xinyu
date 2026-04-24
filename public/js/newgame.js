// ===================================================================
// ===== 新游戏创建（纯叙事RP版 - 调用后端 API） =====
// ===================================================================

// ----- AI 智能补全 -----
async function autofillForm() {
    const btn = document.getElementById('autofillBtn');
    const originalText = btn.textContent;
    btn.textContent = '⏳ AI 补全中...';
    btn.disabled = true;

    try {
        const getVal = (id) => (document.getElementById(id)?.value || '').trim();
        const body = {
            worldName: getVal('createWorldName'),
            genre: getVal('createWorldGenre'),
            worldDesc: getVal('createWorldDesc'),
            worldRules: getVal('createWorldRules'),
            tone: getVal('createTone'),
            perspective: getVal('createPerspective'),
            playerName: getVal('createPlayerName'),
            playerGender: getVal('createPlayerGender'),
            playerAge: getVal('createPlayerAge'),
            playerRace: getVal('createPlayerRace'),
            playerClass: getVal('createPlayerClass'),
            playerAppearance: getVal('createPlayerAppearance'),
            playerPersonality: getVal('createPlayerPersonality'),
            playerBackstory: getVal('createPlayerBackstory'),
            templateId: selectedTemplate || '',
        };

        const resp = await fetch('/api/game/autofill', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

        const result = await resp.json();

        if (!resp.ok) {
            showToast(result.error || '补全失败', 'error');
            return;
        }

        if (result.success && result.filled) {
            // 字段名映射到 input id
            const fieldMap = {
                playerName: 'createPlayerName',
                playerGender: 'createPlayerGender',
                playerAge: 'createPlayerAge',
                playerRace: 'createPlayerRace',
                playerClass: 'createPlayerClass',
                playerAppearance: 'createPlayerAppearance',
                playerPersonality: 'createPlayerPersonality',
                playerBackstory: 'createPlayerBackstory',
                worldName: 'createWorldName',
                worldDesc: 'createWorldDesc',
                worldRules: 'createWorldRules',
            };

            let filledCount = 0;
            for (const [field, value] of Object.entries(result.filled)) {
                const inputId = fieldMap[field];
                if (inputId) {
                    const el = document.getElementById(inputId);
                    if (el && !el.value.trim()) {
                        el.value = value;
                        filledCount++;
                    }
                }
            }

            if (filledCount > 0) {
                showToast(`✨ 已补全 ${filledCount} 个字段`, 'success');
            } else {
                showToast('所有字段已填写完整', 'info');
            }
        }
    } catch(e) {
        showToast('补全失败: ' + e.message, 'error');
    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
    }
}

function openNewGameModal() {
    window.location.href = 'create.html';
}

// 从服务器加载所有模板
async function loadTemplates() {
    try {
        const resp = await fetch('/api/game/templates');
        if (resp.ok) return await resp.json();
    } catch(e) { console.error('加载模板失败', e); }
    return [];
}

async function renderTemplateGrid() {
    const grid = document.getElementById('templateGrid');
    const templates = await loadTemplates();

    let html = '';
    templates.forEach(tpl => {
        const isCustom = !tpl.is_builtin;
        const deleteBtn = isCustom
            ? `<button class="template-card-delete" onclick="event.stopPropagation();(async () => { await removeImportedTemplate('${tpl.id}') })()" title="移除此模板">✕</button>`
            : '';
        html += `
            <div class="template-card" onclick="selectTemplate('${tpl.id}', this)">
                <div class="template-card-icon">${tpl.icon}</div>
                <div class="template-card-name">${escapeHtml(tpl.name)}</div>
                <div class="template-card-desc">${escapeHtml(tpl.description)}</div>
                ${deleteBtn}
            </div>
        `;
    });
    html += `
        <div class="template-card" onclick="selectTemplate('custom', this)">
            <div class="template-card-icon">✨</div>
            <div class="template-card-name">自定义世界</div>
            <div class="template-card-desc">完全自由地创建你的世界</div>
        </div>
    `;
    grid.innerHTML = html;
}

let currentTemplates = []; // 存储从服务器获取的所有模板

function selectTemplate(id, el) {
    selectedTemplate = id;
    document.querySelectorAll('.template-card').forEach(c => c.classList.remove('selected'));
    el.classList.add('selected');

    // 查找并填充模板数据
    if (id !== 'custom') {
        loadTemplates().then(templates => {
            const tpl = templates.find(t => t.id === id);
            if (tpl) {
                populateStep2FromTemplate(tpl);
            }
        });
    }

    // 启用下一步按钮
    const nextBtn = document.getElementById('nextStepBtn');
    if (nextBtn) {
        nextBtn.disabled = false;
        nextBtn.style.opacity = '1';
    }
}

// 用导入模板的数据填充步骤二表单
function populateStep2FromTemplate(tpl) {
    const setVal = (id, val) => { const el = document.getElementById(id); if (el && val) el.value = val; };
    setVal('createSaveName', tpl.name);
    setVal('createWorldName', tpl.world?.name);
    setVal('createWorldGenre', tpl.world?.genre);
    setVal('createWorldDesc', tpl.world?.description);
    setVal('createWorldRules', tpl.world?.rules);
    setVal('createTone', tpl.world?.tone);
    setVal('createPerspective', tpl.world?.perspective);
    setVal('createCustomPrompt', tpl.world?.customPrompt);
    setVal('createOpeningPrompt', tpl.world?.openingPrompt);
}

async function createNewGame() {
    const saveName = document.getElementById('createSaveName').value.trim() || '未命名的冒险';
    const worldName = document.getElementById('createWorldName').value.trim() || '未知世界';
    const genre = document.getElementById('createWorldGenre').value || '自定义';
    const worldDesc = document.getElementById('createWorldDesc').value.trim() || '一个未知的世界';
    const worldRules = document.getElementById('createWorldRules').value.trim();
    const customPrompt = document.getElementById('createCustomPrompt').value.trim();
    const openingPrompt = document.getElementById('createOpeningPrompt').value.trim();
    const tone = document.getElementById('createTone').value || '史诗';
    const perspective = document.getElementById('createPerspective').value || 'second_person';
    const playerName = document.getElementById('createPlayerName').value.trim() || '旅行者';
    const playerGender = document.getElementById('createPlayerGender').value.trim() || '未设定';
    const playerAge = document.getElementById('createPlayerAge').value.trim() || '未设定';
    const playerRace = document.getElementById('createPlayerRace').value.trim();
    const playerClass = document.getElementById('createPlayerClass').value.trim();
    const playerAppearance = document.getElementById('createPlayerAppearance').value.trim();
    const playerPersonality = document.getElementById('createPlayerPersonality').value.trim();
    const playerBackstory = document.getElementById('createPlayerBackstory').value.trim();

    try {
        const resp = await fetch('/api/game/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                saveName, worldName, genre, worldDesc, worldRules, customPrompt, openingPrompt, tone, perspective,
                playerName, playerGender, playerAge, playerRace, playerClass, playerAppearance, playerPersonality, playerBackstory,
                templateId: selectedTemplate,
            }),
        });

        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            showToast('创建失败: ' + (err.error || '未知错误'), 'error');
            return;
        }

        const result = await resp.json();
        if (result.success) {
            // 存 active save id 并跳转到游戏页面
            localStorage.setItem('xinyu_active_save_id', result.id);
            window.location.href = 'game.html';
        }
    } catch(e) {
        showToast('创建失败: ' + e.message, 'error');
    }
}

// ===================================================================
// ===== 世界模板导入/导出 =====
// ===================================================================

// 移除导入的模板
async function removeImportedTemplate(id) {
    try {
        const resp = await fetch(`/api/game/templates/${encodeURIComponent(id)}`, {
            method: 'DELETE'
        });

        if (resp.ok) {
            // 如果当前选中的是被删除的模板，取消选中
            if (selectedTemplate === id) {
                selectedTemplate = null;
                document.getElementById('nextStepBtn').disabled = true;
                document.getElementById('nextStepBtn').style.opacity = '0.5';
            }
            await renderTemplateGrid();
            showToast('已移除模板', 'info');
        } else {
            const err = await resp.json().catch(() => ({}));
            showToast(err.error || '删除失败', 'error');
        }
    } catch(e) {
        showToast('删除失败', 'error');
    }
}

// 触发文件选择
function importWorldTemplate() {
    document.getElementById('worldTemplateInput').click();
}

// 处理导入的世界模板文件（支持 JSON 和 SVG 格式）
async function handleWorldTemplateImport(event) {
    const file = event.target.files[0];
    if (!file) return;

    try {
        let data;
        let svgFile = null;

        if (file.name.endsWith('.svg')) {
            const text = await file.text();
            let match = text.match(/<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/);
            if (!match) {
                match = text.match(/<xinyu:data>([\s\S]*?)<\/xinyu:data>/);
            }
            if (!match) {
                showToast('导入失败: SVG 卡片中未找到世界数据', 'error');
                return;
            }
            data = JSON.parse(match[1]);
            svgFile = file;
        } else {
            const text = await file.text();
            data = JSON.parse(text);
        }

        // 发送到后端验证并标准化
        const resp = await fetch('/api/game/templates/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });

        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            showToast('导入失败: ' + (err.error || '文件格式不正确'), 'error');
            return;
        }

        const result = await resp.json();
        if (result.success) {
            // 如果是 SVG 文件，上传图片
            if (svgFile) {
                const formData = new FormData();
                formData.append('svg', svgFile);
                formData.append('worldName', result.template.world.name);

                const uploadResp = await fetch('/api/game/templates/upload-svg', {
                    method: 'POST',
                    body: formData,
                });

                if (uploadResp.ok) {
                    const uploadResult = await uploadResp.json();
                    if (uploadResult.success) {
                        result.template.svgUrl = uploadResult.url;
                    }
                }
            }

            // 重新渲染模板网格
            await renderTemplateGrid();

            // 自动选中新导入的模板
            const cards = document.querySelectorAll('.template-card');
            cards.forEach(card => {
                if (card.getAttribute('onclick')?.includes(result.template.id)) {
                    selectTemplate(result.template.id, card);
                }
            });

            showToast(`已导入世界: ${result.template.name}`, 'success');
        }
    } catch(e) {
        showToast('导入失败: 无法解析文件', 'error');
    }

    event.target.value = '';
}

// 导出世界模板为 JSON 文件
function exportWorldTemplate(template) {
    const exportData = {
        name: template.name,
        genre: template.genre,
        icon: template.icon,
        description: template.description,
        world: template.world,
        _exportedAt: new Date().toISOString(),
        _app: '心隅',
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `心隅_世界_${template.name.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_')}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`已导出世界: ${template.name}`);
}
