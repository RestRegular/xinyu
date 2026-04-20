// ===================================================================
// ===== 视图路由 =====
// ===================================================================
function showView(viewName) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const view = document.getElementById('view-' + viewName);
    if (view) view.classList.add('active');

    if (viewName === 'lobby') { renderLobby(); }
    if (viewName === 'settings') { populateSettings(); }
    if (viewName === 'stats') { renderStats(); }
}

// ===================================================================
// ===== Toast 通知 =====
// ===================================================================
function showToast(message, type = '') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = 'toast ' + type;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.3s'; setTimeout(() => toast.remove(), 300); }, 2500);
}

// ===================================================================
// ===== 模态框 =====
// ===================================================================
function openModal(id) { document.getElementById(id).classList.add('active'); }
function closeModal(id) { document.getElementById(id).classList.remove('active'); }

function showConfirm(title, message, callback) {
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmMessage').textContent = message;
    const btn = document.getElementById('confirmAction');
    btn.onclick = () => { callback(); closeModal('modalConfirm'); };
    openModal('modalConfirm');
}

// ===================================================================
// ===== 下拉菜单 =====
// ===================================================================
function toggleDropdown(id) {
    const menu = document.getElementById(id);
    const isActive = menu.classList.contains('active');
    closeDropdowns();
    if (!isActive) menu.classList.add('active');
}
function closeDropdowns() {
    document.querySelectorAll('.dropdown-menu').forEach(m => m.classList.remove('active'));
}
document.addEventListener('click', (e) => {
    if (!e.target.closest('.dropdown')) closeDropdowns();
});

// ===================================================================
// ===== 工具函数 =====
// ===================================================================
function relativeTime(dateStr) {
    if (!dateStr) return '未知';
    const now = Date.now();
    const then = new Date(dateStr).getTime();
    const diff = now - then;
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
    if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';
    if (diff < 604800000) return Math.floor(diff / 86400000) + '天前';
    return new Date(dateStr).toLocaleDateString('zh-CN');
}

function genreBadgeClass(genre) {
    const map = { '奇幻': 'badge-fantasy', '科幻': 'badge-scifi', '武侠': 'badge-wuxia', '末日': 'badge-apocalypse' };
    return map[genre] || 'badge-custom';
}

function genreIcon(genre) {
    const map = { '奇幻': '⚔️', '科幻': '🚀', '武侠': '🏯', '末日': '☢️' };
    return map[genre] || '✨';
}

function rarityClass(rarity) {
    return 'rarity-' + (rarity || 'common');
}

function itemIcon(type) {
    const map = { weapon: '⚔️', armor: '🛡️', consumable: '🧪', key: '🔑', quest: '📜', misc: '📦' };
    return map[type] || '📦';
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
