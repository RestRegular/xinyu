// ===================================================================
// ===== 配置常量 =====
// ===================================================================
const STORAGE_KEYS = {
    config: 'xinyu_config',
    saves: 'xinyu_saves',
    templates: 'xinyu_templates',
};
const SAVE_PREFIX = 'xinyu_save_';
const MAX_HISTORY = 40;
const SUMMARIZE_THRESHOLD = 30;
const MAX_TOOL_CALL_LOOPS = 3;

// ===================================================================
// ===== 世界模板库（前端保留用于离线降级，优先从后端加载） =====
// ===================================================================
const BUILTIN_TEMPLATES = [
    {
        id: 'tpl_sword_magic', name: '剑与魔法', genre: '奇幻', icon: '⚔️',
        description: '标准奇幻设定，适合初次体验',
    },
    {
        id: 'tpl_star_trek', name: '星际迷途', genre: '科幻', icon: '🚀',
        description: '太空探索，与外星文明接触',
    },
    {
        id: 'tpl_wuxia', name: '江湖风云', genre: '武侠', icon: '🏯',
        description: '快意恩仇的武侠世界',
    },
    {
        id: 'tpl_apocalypse', name: '末日求生', genre: '末日', icon: '☢️',
        description: '后启示录生存挑战',
    },
];

// ===================================================================
// ===== 全局状态 =====
// ===================================================================
var appConfig = null;       // 全局配置
var savesIndex = null;      // 存档索引
var currentSave = null;     // 当前加载的存档数据
var currentSaveId = null;   // 当前存档ID
var isGenerating = false;   // AI是否正在生成
var selectedTemplate = null; // 新游戏选择的模板
var currentFilter = 'all';  // 大厅筛选
