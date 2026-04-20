// ===================================================================
// ===== 管理大厅 =====
// ===================================================================
function setFilter(filter, el) {
    currentFilter = filter;
    document.querySelectorAll('.lobby-tab').forEach(t => t.classList.remove('active'));
    if (el) el.classList.add('active');
    renderLobby();
}

function renderLobby() {
    const content = document.getElementById('lobbyContent');
    const search = (document.getElementById('lobbySearch').value || '').toLowerCase();
    const sort = document.getElementById('sortSelect').value;

    let saves = [...(savesIndex.saves || [])];

    // 筛选
    if (currentFilter === 'archived') {
        saves = saves.filter(s => s.archived);
    } else if (currentFilter !== 'all') {
        saves = saves.filter(s => s.worldGenre === currentFilter && !s.archived);
    } else {
        saves = saves.filter(s => !s.archived);
    }

    // 搜索
    if (search) {
        saves = saves.filter(s =>
            (s.name || '').toLowerCase().includes(search) ||
            (s.worldName || '').toLowerCase().includes(search) ||
            (s.playerName || '').toLowerCase().includes(search)
        );
    }

    // 排序
    saves.sort((a, b) => {
        // 置顶优先
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        switch (sort) {
            case 'lastSaved': return new Date(b.lastSavedAt || 0) - new Date(a.lastSavedAt || 0);
            case 'created': return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
            case 'name': return (a.name || '').localeCompare(b.name || '');
            case 'level': return (b.playerLevel || 0) - (a.playerLevel || 0);
            default: return 0;
        }
    });

    document.getElementById('savesCount').textContent = saves.length + ' 个存档';

    if (saves.length === 0) {
        content.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">🎲</div>
                <div class="empty-state-title">${search ? '没有找到匹配的存档' : '还没有存档'}</div>
                <div class="empty-state-desc">${search ? '试试其他关键词' : '点击下方按钮开始你的第一次冒险'}</div>
                ${!search ? '<button class="btn btn-primary btn-lg" onclick="openNewGameModal()">开始新游戏</button>' : ''}
            </div>
        `;
        return;
    }

    let html = '<div class="saves-grid">';
    saves.forEach(save => {
        const pinnedClass = save.pinned ? 'save-card-pinned' : '';
        html += `
            <div class="save-card ${pinnedClass}" ondblclick="continueGame('${save.id}')">
                <div class="save-card-header">
                    <div class="save-card-title">${escapeHtml(save.name || '未命名')}</div>
                    <div class="save-card-actions">
                        ${save.pinned ? '<span style="font-size:11px;">📌</span>' : ''}
                        <div class="dropdown">
                            <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();toggleDropdown('saveMenu_${save.id}')">⋯</button>
                            <div class="dropdown-menu" id="saveMenu_${save.id}">
                                <button class="dropdown-item" onclick="event.stopPropagation();continueGame('${save.id}');closeDropdowns()">▶ 继续游戏</button>
                                <button class="dropdown-item" onclick="event.stopPropagation();renameSave('${save.id}');closeDropdowns()">✏️ 重命名</button>
                                <button class="dropdown-item" onclick="event.stopPropagation();duplicateSave('${save.id}');closeDropdowns()">📋 创建副本</button>
                                <button class="dropdown-item" onclick="event.stopPropagation();togglePin('${save.id}');closeDropdowns()">${save.pinned ? '📌 取消置顶' : '📌 置顶'}</button>
                                <button class="dropdown-item" onclick="event.stopPropagation();toggleArchive('${save.id}');closeDropdowns()">${save.archived ? '📦 取消归档' : '📦 归档'}</button>
                                <div class="dropdown-divider"></div>
                                <button class="dropdown-item" onclick="event.stopPropagation();viewSaveStats('${save.id}');closeDropdowns()">📊 查看统计</button>
                                <button class="dropdown-item" onclick="event.stopPropagation();exportSave('${save.id}');closeDropdowns()">📤 导出存档</button>
                                <div class="dropdown-divider"></div>
                                <button class="dropdown-item danger" onclick="event.stopPropagation();deleteSave('${save.id}');closeDropdowns()">🗑️ 删除</button>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="save-card-meta">
                    <div class="save-card-meta-row">
                        <span class="badge ${genreBadgeClass(save.worldGenre)}">${genreIcon(save.worldGenre)} ${escapeHtml(save.worldGenre || '自定义')}</span>
                    </div>
                    <div class="save-card-meta-row">
                        <span>${escapeHtml(save.playerName || '?')} · Lv.${save.playerLevel || 1}</span>
                    </div>
                    <div class="save-card-meta-row">
                        <span>📍 ${escapeHtml(save.currentLocation || '未知')}</span>
                    </div>
                </div>
                <div class="save-card-footer">
                    <span style="font-size:12px;color:var(--text-tertiary);">回合 ${save.turnCount || 0}</span>
                    <span class="save-card-time">${relativeTime(save.lastSavedAt)}</span>
                </div>
            </div>
        `;
    });
    html += `
        <div class="new-game-card" onclick="openNewGameModal()">
            <div class="new-game-card-icon">+</div>
            <div class="new-game-card-text">开始新游戏</div>
        </div>
    `;
    html += '</div>';
    content.innerHTML = html;
}

// ===================================================================
// ===== 存档操作 =====
// ===================================================================
function continueGame(id) {
    const data = loadSaveData(id);
    if (!data) { showToast('存档数据丢失', 'error'); return; }
    currentSaveId = id;
    currentSave = data;
    appConfig.lastVisitedSaveId = id;
    saveConfig();
    enterGameView();
}

async function renameSave(id) {
    const save = savesIndex.saves.find(s => s.id === id);
    if (!save) return;
    document.getElementById('renameInput').value = save.name || '';
    document.getElementById('renameAction').onclick = async () => {
        const newName = document.getElementById('renameInput').value.trim();
        if (!newName) { showToast('名称不能为空', 'error'); return; }
        save.name = newName;
        if (currentSaveId === id && currentSave) currentSave.name = newName;
        await saveSavesIndex();
        if (currentSaveId === id) await saveSaveData(id, currentSave);
        closeModal('modalRename');
        renderLobby();
        showToast('已重命名');
    };
    openModal('modalRename');
}

async function duplicateSave(id) {
    const data = await loadSaveData(id);
    if (!data) { showToast('存档数据丢失', 'error'); return; }
    const newId = generateId();
    const meta = savesIndex.saves.find(s => s.id === id);
    const newMeta = { ...(meta || {}), id: newId, name: (meta?.name || '未命名') + ' (副本)', pinned: false, archived: false, createdAt: new Date().toISOString(), lastSavedAt: new Date().toISOString() };
    const newData = { ...JSON.parse(JSON.stringify(data)), id: newId, name: newMeta.name, meta: { ...data.meta, createdAt: new Date().toISOString(), lastSavedAt: new Date().toISOString() } };
    savesIndex.saves.push(newMeta);
    await saveSavesIndex();
    await saveSaveData(newId, newData);
    renderLobby();
    showToast('已创建副本');
}

function togglePin(id) {
    const save = savesIndex.saves.find(s => s.id === id);
    if (!save) return;
    save.pinned = !save.pinned;
    saveSavesIndex();
    renderLobby();
    showToast(save.pinned ? '已置顶' : '已取消置顶');
}

function toggleArchive(id) {
    const save = savesIndex.saves.find(s => s.id === id);
    if (!save) return;
    save.archived = !save.archived;
    saveSavesIndex();
    renderLobby();
    showToast(save.archived ? '已归档' : '已取消归档');
}

async function deleteSave(id) {
    const save = savesIndex.saves.find(s => s.id === id);
    showConfirm('删除存档', `确定要删除"${save?.name || '未命名'}"吗？此操作不可恢复。`, async () => {
        savesIndex.saves = savesIndex.saves.filter(s => s.id !== id);
        await saveSavesIndex();
        await deleteSaveData(id);
        if (currentSaveId === id) { currentSave = null; currentSaveId = null; }
        renderLobby();
        showToast('已删除');
    });
}

async function exportSave(id) {
    const data = await loadSaveData(id);
    if (!data) { showToast('存档数据丢失', 'error'); return; }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `心隅_存档_${(data.name || '未命名').replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_')}_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('存档已导出');
}

function exportCurrentSave() {
    if (currentSaveId) exportSave(currentSaveId);
}

async function exportAllSaves() {
    try {
        const resp = await fetch('/api/saves/export/all');
        const allData = await resp.json();
        const blob = new Blob([JSON.stringify(allData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `心隅_全部存档_${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('全部存档已导出');
    } catch(e) {
        showToast('导出失败', 'error');
    }
}

function importSave() {
    document.getElementById('importFileInput').click();
}

function handleImportFile(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const data = JSON.parse(e.target.result);
            const resp = await fetch('/api/saves/import', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });
            const result = await resp.json();
            if (result.success) {
                await loadSavesIndex();
                renderLobby();
                showToast(`已导入 ${result.count} 个存档`);
            } else {
                showToast('导入失败', 'error');
            }
        } catch(err) {
            showToast('文件解析失败: ' + err.message, 'error');
        }
    };
    reader.readAsText(file);
    event.target.value = '';
}

async function clearAllData() {
    showConfirm('清除全部数据', '确定要删除所有存档和设置吗？此操作不可恢复！', async () => {
        try {
            // 删除所有存档
            const saves = savesIndex.saves || [];
            for (const s of saves) {
                await deleteSaveData(s.id);
            }
            // 重置配置
            appConfig.apiKey = '';
            appConfig.customInstructions = '';
            await saveConfig();
            await loadSavesIndex();
            currentSave = null;
            currentSaveId = null;
            renderLobby();
            showToast('已清除全部数据');
        } catch(e) {
            showToast('清除失败', 'error');
        }
    });
}
