// ===================================================================
// ===== 统计页面 =====
// ===================================================================
function viewSaveStats(id) {
    const data = loadSaveData(id);
    if (!data) { showToast('无法加载存档', 'error'); return; }
    // 临时设置 currentSave 用于渲染
    const prevSave = currentSave;
    const prevId = currentSaveId;
    currentSave = data;
    currentSaveId = id;
    document.getElementById('statsTitle').textContent = (data.name || '未命名') + ' — 游戏统计';
    showView('stats');
    currentSave = prevSave;
    currentSaveId = prevId;
}

function showGameStats() {
    if (!currentSave) return;
    document.getElementById('statsTitle').textContent = (currentSave.name || '未命名') + ' — 游戏统计';
    showView('stats');
}

function renderStats() {
    const s = currentSave;
    if (!s) return;
    const stats = s.stats || {};
    const container = document.getElementById('statsContent');

    const formatTime = (secs) => {
        if (!secs) return '0分钟';
        const h = Math.floor(secs / 3600);
        const m = Math.floor((secs % 3600) / 60);
        return h > 0 ? `${h}小时${m}分钟` : `${m}分钟`;
    };

    container.innerHTML = `
        <div class="stats-overview">
            <div class="stat-card"><div class="stat-value">${stats.turnCount || 0}</div><div class="stat-label">回合数</div></div>
            <div class="stat-card"><div class="stat-value">${formatTime(stats.playTime)}</div><div class="stat-label">游戏时长</div></div>
            <div class="stat-card"><div class="stat-value">${stats.monstersDefeated || 0}</div><div class="stat-label">击败怪物</div></div>
            <div class="stat-card"><div class="stat-value">${stats.locationsDiscovered || 0}</div><div class="stat-label">探索地点</div></div>
        </div>
        <div class="stats-section">
            <div class="settings-section-title">事件日志</div>
            <div class="event-log">
                <div class="event-log-header">重要事件</div>
                <div class="event-log-list">
                    ${(s.eventLog || []).map(e => {
                        const dotClass = e.type === 'death' ? 'red' : e.type === 'levelup' ? 'green' : e.type === 'discover' ? 'blue' : e.type === 'revive' ? 'yellow' : 'green';
                        return `<div class="event-log-item"><span class="event-log-turn">回合 ${e.turn}</span><span class="event-log-dot ${dotClass}"></span><span class="event-log-text">${escapeHtml(e.text)}</span></div>`;
                    }).join('') || '<div style="padding:16px;text-align:center;color:var(--text-tertiary);font-size:12px;">暂无事件</div>'}
                </div>
            </div>
        </div>
        <div class="stats-section" style="margin-top:16px;">
            <div class="settings-section-title">角色信息</div>
            <div class="settings-card">
                <div class="settings-row"><span class="settings-row-label">名称</span><span>${escapeHtml(s.player?.name)}</span></div>
                <div class="settings-row"><span class="settings-row-label">等级</span><span>Lv.${s.player?.level || 1}</span></div>
                <div class="settings-row"><span class="settings-row-label">当前位置</span><span>${escapeHtml(s.map?.currentLocation)}</span></div>
                <div class="settings-row"><span class="settings-row-label">金币</span><span>${s.inventory?.gold || 0}</span></div>
                <div class="settings-row"><span class="settings-row-label">物品数</span><span>${s.inventory?.items?.length || 0}</span></div>
            </div>
        </div>
    `;
}

function showWorldInfo() {
    if (!currentSave) return;
    const w = currentSave.world;
    document.getElementById('worldInfoContent').innerHTML = `
        <div style="margin-bottom:16px;">
            <div class="form-label">世界名称</div>
            <div style="font-size:16px;font-weight:600;">${escapeHtml(w.name)}</div>
        </div>
        <div style="margin-bottom:16px;">
            <div class="form-label">类型</div>
            <div><span class="badge ${genreBadgeClass(w.genre)}">${genreIcon(w.genre)} ${escapeHtml(w.genre)}</span></div>
        </div>
        <div style="margin-bottom:16px;">
            <div class="form-label">叙事基调</div>
            <div>${escapeHtml(w.tone)}</div>
        </div>
        <div style="margin-bottom:16px;">
            <div class="form-label">世界描述</div>
            <div style="font-size:13px;color:var(--text-secondary);line-height:1.7;">${escapeHtml(w.description)}</div>
        </div>
        <div>
            <div class="form-label">特殊规则</div>
            <div style="font-size:13px;color:var(--text-secondary);line-height:1.7;">${escapeHtml(w.rules) || '无'}</div>
        </div>
    `;
    openModal('modalWorldInfo');
}
