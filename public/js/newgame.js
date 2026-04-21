// ===================================================================
// ===== 新游戏创建（重构版 - 调用后端 API） =====
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
            startLocation: getVal('createStartLocation'),
            startLocationDesc: getVal('createStartLocationDesc'),
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
                startLocation: 'createStartLocation',
                startLocationDesc: 'createStartLocationDesc',
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

// 从后端加载模板列表
async function loadTemplates() {
    try {
        const resp = await fetch('/api/game/templates');
        if (resp.ok) return await resp.json();
    } catch(e) {}
    return [];
}

async function renderTemplateGrid() {
    const grid = document.getElementById('templateGrid');
    const templates = await loadTemplates();

    // 合并本地存储的导入模板
    const importedTemplates = getImportedTemplates();
    const allTemplates = [...templates, ...importedTemplates];

    let html = '';
    allTemplates.forEach(tpl => {
        const imported = tpl._imported ? ' data-imported="true"' : '';
        const deleteBtn = tpl._imported
            ? `<button class="template-card-delete" onclick="event.stopPropagation();removeImportedTemplate('${tpl.id}')" title="移除此模板">✕</button>`
            : '';
        html += `
            <div class="template-card"${imported} onclick="selectTemplate('${tpl.id}', this)">
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

function selectTemplate(id, el) {
    selectedTemplate = id;
    document.querySelectorAll('.template-card').forEach(c => c.classList.remove('selected'));
    el.classList.add('selected');

    // 如果选中的是导入模板，自动填充步骤二的表单
    const importedTemplates = getImportedTemplates();
    const imported = importedTemplates.find(t => t.id === id);
    if (imported) {
        populateStep2FromTemplate(imported);
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
    setVal('createCustomPrompt', tpl.world?.customPrompt);
    setVal('createStartLocation', tpl.starterLocation);
    setVal('createStartLocationDesc', tpl.starterLocationDesc);
    setVal('createStartGold', tpl.starterGold);
}

async function createNewGame() {
    const saveName = document.getElementById('createSaveName').value.trim() || '未命名的冒险';
    const worldName = document.getElementById('createWorldName').value.trim() || '未知世界';
    const genre = document.getElementById('createWorldGenre').value || '自定义';
    const worldDesc = document.getElementById('createWorldDesc').value.trim() || '一个未知的世界';
    const worldRules = document.getElementById('createWorldRules').value.trim();
    const customPrompt = document.getElementById('createCustomPrompt').value.trim();
    const tone = document.getElementById('createTone').value || '史诗';
    const startLocation = document.getElementById('createStartLocation').value.trim() || '起始之地';
    const startLocationDesc = document.getElementById('createStartLocationDesc').value.trim() || '你站在这片陌生土地的起点。';
    const playerName = document.getElementById('createPlayerName').value.trim() || '旅行者';
    const playerGender = document.getElementById('createPlayerGender').value.trim() || '未设定';
    const playerAge = document.getElementById('createPlayerAge').value.trim() || '未设定';
    const playerRace = document.getElementById('createPlayerRace').value.trim();
    const playerClass = document.getElementById('createPlayerClass').value.trim();
    const playerAppearance = document.getElementById('createPlayerAppearance').value.trim();
    const playerPersonality = document.getElementById('createPlayerPersonality').value.trim();
    const playerBackstory = document.getElementById('createPlayerBackstory').value.trim();
    const startGold = parseInt(document.getElementById('createStartGold').value) || 0;

    try {
        const resp = await fetch('/api/game/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                saveName, worldName, genre, worldDesc, worldRules, customPrompt, tone,
                startLocation, startLocationDesc,
                playerName, playerGender, playerAge, playerRace, playerClass, playerAppearance, playerPersonality, playerBackstory,
                startGold, templateId: selectedTemplate,
                starterItems: starterItems
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
const IMPORTED_TEMPLATES_KEY = 'xinyu_imported_templates';

function getImportedTemplates() {
    try {
        return JSON.parse(localStorage.getItem(IMPORTED_TEMPLATES_KEY) || '[]');
    } catch(e) { return []; }
}

function saveImportedTemplates(templates) {
    localStorage.setItem(IMPORTED_TEMPLATES_KEY, JSON.stringify(templates));
}

// 移除导入的模板
function removeImportedTemplate(id) {
    let templates = getImportedTemplates();
    const removed = templates.find(t => t.id === id);
    templates = templates.filter(t => t.id !== id);
    saveImportedTemplates(templates);
    // 如果当前选中的是被删除的模板，取消选中
    if (selectedTemplate === id) {
        selectedTemplate = null;
        document.getElementById('nextStepBtn').disabled = true;
        document.getElementById('nextStepBtn').style.opacity = '0.5';
    }
    renderTemplateGrid();
    if (removed) showToast(`已移除模板「${removed.name}」`, 'info');
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
            // 从 SVG 中提取嵌入的 JSON 数据
            // 兼容两种格式：<script type="application/json"> 和 <xinyu:data>
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
                        // 将 SVG 图片 URL 保存到模板中
                        result.template.svgUrl = uploadResult.url;
                    }
                }
            }

            // 保存到本地存储
            const imported = getImportedTemplates();
            // 避免重复导入（按 name 去重）
            const exists = imported.findIndex(t => t.name === result.template.name);
            if (exists >= 0) {
                imported[exists] = result.template;
            } else {
                imported.push(result.template);
            }
            saveImportedTemplates(imported);

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
        starterItems: template.starterItems || [],
        starterLocation: template.starterLocation || '',
        starterLocationDesc: template.starterLocationDesc || '',
        starterGold: template.starterGold || 0,
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

// 从存档导出世界模板
async function exportWorldFromSave(saveId) {
    try {
        const resp = await fetch(`/api/game/templates/export/${saveId}`);
        if (!resp.ok) {
            showToast('导出失败', 'error');
            return;
        }
        const template = await resp.json();
        exportWorldTemplate(template);
    } catch(e) {
        showToast('导出失败: ' + e.message, 'error');
    }
}

// ===================================================================
// ===== 初始物品管理 =====
// ===================================================================
let starterItems = [];

function addStarterItem() {
    const newItem = {
        id: 'item_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
        name: '新物品',
        type: 'misc',
        description: '',
        quantity: 1,
        effects: {},
        rarity: 'common'
    };
    starterItems.push(newItem);
    renderStarterItems();
}

function removeStarterItem(itemId) {
    starterItems = starterItems.filter(item => item.id !== itemId);
    renderStarterItems();
}

function updateStarterItem(itemId, field, value) {
    const item = starterItems.find(item => item.id === itemId);
    if (item) {
        if (field === 'quantity') {
            item[field] = parseInt(value) || 1;
        } else if (field === 'effects') {
            try {
                item[field] = JSON.parse(value || '{}');
            } catch (e) {
                item[field] = {};
            }
        } else {
            item[field] = value;
        }
    }
}

function renderStarterItems() {
    const container = document.getElementById('createStarterItemsList');
    if (!container) return;
    
    if (starterItems.length === 0) {
        container.innerHTML = '<div style="text-align: center; color: var(--text-tertiary); font-size: 13px; padding: 16px;">暂无初始物品</div>';
        return;
    }
    
    let html = '';
    starterItems.forEach(item => {
        html += `
            <div class="create-form-item">
                <div class="create-form-item-header">
                    <div class="create-form-item-title">${escapeHtml(item.name)}</div>
                    <button class="create-form-item-remove" onclick="removeStarterItem('${item.id}')">✕</button>
                </div>
                <div class="create-form-item-body">
                    <div class="create-form-item-row">
                        <label class="create-form-item-label">物品名称</label>
                        <input type="text" class="create-form-item-input" value="${escapeHtml(item.name)}" onchange="updateStarterItem('${item.id}', 'name', this.value)">
                    </div>
                    <div class="create-form-item-row">
                        <label class="create-form-item-label">物品类型</label>
                        <select class="create-form-item-input" onchange="updateStarterItem('${item.id}', 'type', this.value)">
                            <option value="weapon" ${item.type === 'weapon' ? 'selected' : ''}>武器</option>
                            <option value="armor" ${item.type === 'armor' ? 'selected' : ''}>防具</option>
                            <option value="consumable" ${item.type === 'consumable' ? 'selected' : ''}>消耗品</option>
                            <option value="misc" ${item.type === 'misc' ? 'selected' : ''}>杂物</option>
                        </select>
                    </div>
                    <div class="create-form-item-row">
                        <label class="create-form-item-label">物品描述</label>
                        <input type="text" class="create-form-item-input" value="${escapeHtml(item.description)}" onchange="updateStarterItem('${item.id}', 'description', this.value)">
                    </div>
                    <div class="create-form-item-row">
                        <label class="create-form-item-label">数量</label>
                        <input type="number" class="create-form-item-input" value="${item.quantity}" min="1" onchange="updateStarterItem('${item.id}', 'quantity', this.value)">
                    </div>
                    <div class="create-form-item-row">
                        <label class="create-form-item-label">稀有度</label>
                        <select class="create-form-item-input" onchange="updateStarterItem('${item.id}', 'rarity', this.value)">
                            <option value="common" ${item.rarity === 'common' ? 'selected' : ''}>普通</option>
                            <option value="uncommon" ${item.rarity === 'uncommon' ? 'selected' : ''}> uncommon</option>
                            <option value="rare" ${item.rarity === 'rare' ? 'selected' : ''}>稀有</option>
                            <option value="epic" ${item.rarity === 'epic' ? 'selected' : ''}>史诗</option>
                            <option value="legendary" ${item.rarity === 'legendary' ? 'selected' : ''}>传说</option>
                        </select>
                    </div>
                    <div class="create-form-item-row">
                        <label class="create-form-item-label">效果 (JSON)</label>
                        <input type="text" class="create-form-item-input" value="${escapeHtml(JSON.stringify(item.effects || {}))}" placeholder="{\"attack\": 5}" onchange="updateStarterItem('${item.id}', 'effects', this.value)">
                    </div>
                </div>
            </div>
        `;
    });
    container.innerHTML = html;
}

function clearStarterItems() {
    starterItems = [];
    renderStarterItems();
}
