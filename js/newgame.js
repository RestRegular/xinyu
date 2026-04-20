// ===================================================================
// ===== 新游戏创建 =====
// ===================================================================
function openNewGameModal() {
    window.location.href = 'create.html';
}

function renderTemplateGrid() {
    const grid = document.getElementById('templateGrid');
    let html = '';
    BUILTIN_TEMPLATES.forEach(tpl => {
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

function createNewGame() {
    const saveName = document.getElementById('createSaveName').value.trim() || '未命名的冒险';
    const worldName = document.getElementById('createWorldName').value.trim() || '未知世界';
    const genre = document.getElementById('createWorldGenre').value || '自定义';
    const worldDesc = document.getElementById('createWorldDesc').value.trim() || '一个未知的世界';
    const worldRules = document.getElementById('createWorldRules').value.trim();
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

    // 组合角色描述
    let playerDesc = '';
    if (playerRace) playerDesc += `种族：${playerRace}。`;
    if (playerClass) playerDesc += `职业：${playerClass}。`;
    if (playerAppearance) playerDesc += `外貌：${playerAppearance}。`;
    if (playerPersonality) playerDesc += `性格：${playerPersonality}。`;
    if (playerBackstory) playerDesc += `背景：${playerBackstory}`;

    let starterItems = [], starterGold = startGold;
    if (selectedTemplate !== 'custom') {
        const tpl = BUILTIN_TEMPLATES.find(t => t.id === selectedTemplate);
        if (tpl) {
            starterItems = tpl.starterItems || [];
            starterGold = tpl.starterGold !== undefined ? tpl.starterGold : startGold;
        }
    }

    const id = generateId();
    const now = new Date().toISOString();

    const saveData = {
        id, name: saveName, version: '1.0',
        world: { name: worldName, genre, description: worldDesc, rules: worldRules, tone, customPrompt: '' },
        player: {
            name: playerName, description: playerDesc, level: 1, experience: 0, experienceToNext: 100,
            attributes: {
                hp: { current: 100, max: 100, label: '生命值' },
                mp: { current: 50, max: 50, label: '魔力值' },
                attack: { current: 10, max: 10, label: '攻击力' },
                defense: { current: 5, max: 5, label: '防御力' },
                agility: { current: 7, max: 7, label: '敏捷' },
                luck: { current: 3, max: 3, label: '幸运' },
            },
            statusEffects: [],
        },
        inventory: {
            items: starterItems.map((item, i) => ({
                id: 'item_' + Date.now() + '_' + i,
                name: item.name, type: item.type, description: item.description || '',
                quantity: item.quantity || 1, effects: item.effects || {},
                rarity: item.rarity || 'common', usable: item.usable || false,
                equippable: item.equippable || false, equipped: false,
            })),
            gold: starterGold, maxSlots: 20,
        },
        map: {
            currentLocation: startLocation,
            locations: {
                [startLocation]: {
                    description: startLocationDesc,
                    connections: [], npcs: [], discovered: true, dangerLevel: 0,
                },
            },
        },
        chatHistory: [],
        stats: { turnCount: 0, playTime: 0, monstersDefeated: 0, itemsCollected: 0, locationsDiscovered: 1, deaths: 0 },
        eventLog: [{ turn: 1, type: 'system', text: '冒险开始' }],
        meta: { createdAt: now, lastSavedAt: now, version: '1.0' },
    };

    saveSaveData(id, saveData);
    savesIndex.saves.push({
        id, name: saveName, worldName, worldGenre: genre,
        playerName, playerLevel: 1, currentLocation: startLocation,
        turnCount: 0, playTime: 0,
        createdAt: now, lastSavedAt: now, pinned: false, archived: false,
    });
    saveSavesIndex();

    // 存 active save id 并跳转到游戏页面
    localStorage.setItem('xinyu_active_save_id', id);
    window.location.href = 'game.html';
}
