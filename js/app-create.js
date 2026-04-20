// ===================================================================
// ===== 创建新游戏页面初始化 =====
// ===================================================================

// 页面加载时检查是否从URL参数传入了模板ID
const urlParams = new URLSearchParams(window.location.search);
const preselectedTemplate = urlParams.get('template');

function init() {
    loadConfig();
    loadSavesIndex();

    if (preselectedTemplate) {
        // 直接进入步骤2
        selectedTemplate = preselectedTemplate;
        showStep(2);
        populateStep2();
    } else {
        showStep(1);
        renderTemplateGrid();
    }
}

function showStep(step) {
    document.querySelectorAll('.create-step').forEach(s => s.classList.remove('active'));
    document.getElementById('createStep' + step).classList.add('active');

    // 更新进度条
    document.querySelectorAll('.create-progress-dot').forEach((dot, i) => {
        dot.classList.toggle('active', i < step);
        dot.classList.toggle('done', i < step);
    });
    document.querySelectorAll('.create-progress-line').forEach((line, i) => {
        line.classList.toggle('active', i < step - 1);
    });
    document.querySelectorAll('.create-progress-label').forEach((label, i) => {
        label.classList.toggle('active', i < step);
    });

    // 更新步骤指示器
    const indicator = document.getElementById('stepIndicator');
    if (indicator) {
        indicator.textContent = '步骤 ' + step + '/2';
    }

    // 显示/隐藏底部操作栏
    const footer = document.getElementById('createFooter');
    if (footer) {
        footer.style.display = step === 2 ? 'flex' : 'none';
    }
}

function populateStep2() {
    if (selectedTemplate === 'custom') {
        document.getElementById('createWorldName').value = '';
        document.getElementById('createWorldGenre').value = '自定义';
        document.getElementById('createWorldDesc').value = '';
        document.getElementById('createWorldRules').value = '';
        document.getElementById('createTone').value = '史诗';
        document.getElementById('createStartLocation').value = '';
        document.getElementById('createStartLocationDesc').value = '';
        document.getElementById('createSaveName').value = '';
        document.getElementById('createPlayerName').value = '';
        document.getElementById('createPlayerRace').value = '';
        document.getElementById('createPlayerClass').value = '';
        document.getElementById('createPlayerAppearance').value = '';
        document.getElementById('createPlayerPersonality').value = '';
        document.getElementById('createPlayerBackstory').value = '';
        document.getElementById('createStartGold').value = '0';
    } else {
        const tpl = BUILTIN_TEMPLATES.find(t => t.id === selectedTemplate);
        if (!tpl) return;
        document.getElementById('createSaveName').value = tpl.name + '的冒险';
        document.getElementById('createWorldName').value = tpl.world.name;
        document.getElementById('createWorldGenre').value = tpl.genre;
        document.getElementById('createWorldDesc').value = tpl.world.description;
        document.getElementById('createWorldRules').value = tpl.world.rules;
        document.getElementById('createTone').value = tpl.world.tone;
        document.getElementById('createStartLocation').value = tpl.starterLocation || '';
        document.getElementById('createStartLocationDesc').value = tpl.starterLocationDesc || '';
        document.getElementById('createPlayerName').value = '';
        document.getElementById('createPlayerRace').value = '';
        document.getElementById('createPlayerClass').value = '';
        document.getElementById('createPlayerAppearance').value = '';
        document.getElementById('createPlayerPersonality').value = '';
        document.getElementById('createPlayerBackstory').value = '';
        document.getElementById('createStartGold').value = tpl.starterGold || 0;
    }
}

// 下一步按钮
function onNextStep() {
    if (!selectedTemplate) { showToast('请选择一个模板', 'warning'); return; }
    showStep(2);
    populateStep2();
}

// 返回步骤1
function onBackStep() {
    showStep(1);
}

// 开始冒险
function onStartAdventure() {
    createNewGame();
}

init();
