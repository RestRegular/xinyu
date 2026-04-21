// ===================================================================
// ===== 新游戏创建（重构版 - 调用后端 API） =====
// ===================================================================

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
    let html = '';
    templates.forEach(tpl => {
        html += `
            <div class="template-card" onclick="selectTemplate('${tpl.id}', this)">
                <div class="template-card-icon">${tpl.icon}</div>
                <div class="template-card-name">${tpl.name}</div>
                <div class="template-card-desc">${tpl.description}</div>
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

    // 启用下一步按钮
    const nextBtn = document.getElementById('nextStepBtn');
    if (nextBtn) {
        nextBtn.disabled = false;
        nextBtn.style.opacity = '1';
    }
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
                playerName, playerRace, playerClass, playerAppearance, playerPersonality, playerBackstory,
                startGold, templateId: selectedTemplate,
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
