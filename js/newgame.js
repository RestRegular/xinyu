// ===================================================================
// ===== 新游戏创建 =====
// ===================================================================
function openNewGameModal() {
    selectedTemplate = null;
    document.getElementById('newGameStep1').classList.remove('hidden');
    document.getElementById('newGameStep2').classList.add('hidden');
    document.getElementById('newGameBackBtn').style.display = 'none';
    document.getElementById('newGameNextBtn').textContent = '下一步';
    document.getElementById('newGameModalTitle').textContent = '创建新游戏';
    renderTemplateGrid();
    openModal('modalNewGame');
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
}

function newGameStepNext() {
    if (!selectedTemplate) { showToast('请选择一个模板', 'warning'); return; }

    if (selectedTemplate === 'custom') {
        // 自定义世界，进入步骤2并清空默认值
        document.getElementById('newGameWorldInfo').textContent = '自定义世界 — 完全自由地创建你的冒险';
        document.getElementById('newGameSaveName').value = '';
        document.getElementById('newGamePlayerName').value = '';
        document.getElementById('newGamePlayerDesc').value = '';
        document.getElementById('newGameWorldDesc').value = '';
        document.getElementById('newGameWorldRules').value = '';
        document.getElementById('newGameTone').value = '史诗';
    } else {
        const tpl = BUILTIN_TEMPLATES.find(t => t.id === selectedTemplate);
        if (!tpl) return;
        document.getElementById('newGameWorldInfo').textContent = `${tpl.icon} ${tpl.name} — ${tpl.world.name}`;
        document.getElementById('newGameSaveName').value = tpl.name + '的冒险';
        document.getElementById('newGamePlayerName').value = '';
        document.getElementById('newGamePlayerDesc').value = '';
        document.getElementById('newGameWorldDesc').value = tpl.world.description;
        document.getElementById('newGameWorldRules').value = tpl.world.rules;
        document.getElementById('newGameTone').value = tpl.world.tone;
    }

    document.getElementById('newGameStep1').classList.add('hidden');
    document.getElementById('newGameStep2').classList.remove('hidden');
    document.getElementById('newGameBackBtn').style.display = '';
    document.getElementById('newGameNextBtn').textContent = '开始冒险';
}

function newGameStepBack() {
    document.getElementById('newGameStep1').classList.remove('hidden');
    document.getElementById('newGameStep2').classList.add('hidden');
    document.getElementById('newGameBackBtn').style.display = 'none';
    document.getElementById('newGameNextBtn').textContent = '下一步';
}

function createNewGame() {
    const saveName = document.getElementById('newGameSaveName').value.trim() || '未命名的冒险';
    const playerName = document.getElementById('newGamePlayerName').value.trim() || '旅行者';
    const playerDesc = document.getElementById('newGamePlayerDesc').value.trim();
    const worldDesc = document.getElementById('newGameWorldDesc').value.trim() || '一个未知的世界';
    const worldRules = document.getElementById('newGameWorldRules').value.trim();
    const tone = document.getElementById('newGameTone').value;

    let genre = '自定义', worldName = '自定义世界', starterItems = [], starterLocation = '起始之地', starterLocationDesc = '你站在这片陌生土地的起点，前方是未知的冒险。', starterGold = 0;

    if (selectedTemplate !== 'custom') {
        const tpl = BUILTIN_TEMPLATES.find(t => t.id === selectedTemplate);
        if (tpl) {
            genre = tpl.genre; worldName = tpl.world.name;
            starterItems = tpl.starterItems || [];
            starterLocation = tpl.starterLocation;
            starterLocationDesc = tpl.starterLocationDesc || '';
            starterGold = tpl.starterGold || 0;
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
            currentLocation: starterLocation,
            locations: {
                [starterLocation]: {
                    description: starterLocationDesc,
                    connections: [], npcs: [], discovered: true, dangerLevel: 0,
                },
            },
        },
        chatHistory: [],
        stats: { turnCount: 0, playTime: 0, monstersDefeated: 0, itemsCollected: 0, locationsDiscovered: 1, deaths: 0 },
        eventLog: [{ turn: 1, type: 'system', text: '冒险开始' }],
        meta: { createdAt: now, lastSavedAt: now, version: '1.0' },
    };

    // 保存
    saveSaveData(id, saveData);
    savesIndex.saves.push({
        id, name: saveName, worldName, worldGenre: genre,
        playerName, playerLevel: 1, currentLocation: starterLocation,
        turnCount: 0, playTime: 0,
        createdAt: now, lastSavedAt: now, pinned: false, archived: false,
    });
    saveSavesIndex();

    // 进入游戏
    currentSaveId = id;
    currentSave = saveData;
    appConfig.lastVisitedSaveId = id;
    saveConfig();
    closeModal('modalNewGame');
    enterGameView();

    // 发送开场消息
    addSystemMessage(`欢迎来到${worldName}，${playerName}。你的冒险即将开始...`);
    sendGameMessage('[系统] 玩家开始新游戏，请生成开场剧情。');
}
