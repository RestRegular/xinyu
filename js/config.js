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
// ===== 世界模板库 =====
// ===================================================================
const BUILTIN_TEMPLATES = [
    {
        id: 'tpl_sword_magic', name: '剑与魔法', genre: '奇幻', icon: '⚔️',
        description: '标准奇幻设定，适合初次体验',
        world: {
            name: '艾泽利亚', genre: '奇幻',
            description: '一个充满魔法与剑的大陆，古老的龙族沉睡在山脉之下，精灵守护着古老的森林，人类王国在平原上繁荣发展。暗影势力正在北方蠢蠢欲动...',
            rules: '魔法分为元素系（火、水、风、土）、暗影系和神圣系三大体系。战士、法师、游侠、牧师是常见的职业。',
            tone: '史诗',
        },
        starterItems: [
            { name: '生锈的铁剑', type: 'weapon', description: '一把老旧但还能用的铁剑', quantity: 1, effects: { attack: 3 }, rarity: 'common', usable: false },
            { name: '治疗药水', type: 'consumable', description: '恢复30点生命值', quantity: 3, effects: { hp: 30 }, rarity: 'common', usable: true },
            { name: '皮甲', type: 'armor', description: '简单的皮制护甲', quantity: 1, effects: { defense: 2 }, rarity: 'common', usable: false },
        ],
        starterLocation: '边境小镇',
        starterLocationDesc: '一座位于王国边境的小镇，是冒险者们的起点。镇上有酒馆、铁匠铺和杂货店。',
        starterGold: 50,
    },
    {
        id: 'tpl_star_trek', name: '星际迷途', genre: '科幻', icon: '🚀',
        description: '太空探索，与外星文明接触',
        world: {
            name: '银河联邦', genre: '科幻',
            description: '公元3247年，人类已建立横跨银河的联邦文明。你是联邦探索舰"曙光号"的舰长，在一次超空间跳跃事故后，舰队被困在了未知星域...',
            rules: '科技水平高度发达，拥有超光速航行、能量护盾、等离子武器。外星文明分为碳基和硅基两大类。',
            tone: '严肃',
        },
        starterItems: [
            { name: '标准激光手枪', type: 'weapon', description: '联邦制式激光手枪', quantity: 1, effects: { attack: 5 }, rarity: 'common', usable: false },
            { name: '纳米修复包', type: 'consumable', description: '恢复40点生命值', quantity: 2, effects: { hp: 40 }, rarity: 'common', usable: true },
            { name: '通用翻译器', type: 'misc', description: '可以翻译大多数已知语言', quantity: 1, rarity: 'uncommon', usable: false },
        ],
        starterLocation: '空间站Alpha-7',
        starterLocationDesc: '一座废弃的空间站，闪烁的应急灯照亮了锈迹斑斑的走廊。控制室似乎还有部分系统在运行。',
        starterGold: 100,
    },
    {
        id: 'tpl_wuxia', name: '江湖风云', genre: '武侠', icon: '🏯',
        description: '快意恩仇的武侠世界',
        world: {
            name: '中原武林', genre: '武侠',
            description: '天下大势，分久必合。江湖中正邪两道对峙百年，如今一本失传的武功秘籍重现人间，各方势力蠢蠢欲动。你是一名初入江湖的少侠...',
            rules: '武功分为内功、外功、轻功三大类。门派有少林、武当、峨眉、丐帮、魔教等。江湖中有"侠义道"和"魔道"之分。',
            tone: '史诗',
        },
        starterItems: [
            { name: '精钢长剑', type: 'weapon', description: '一把锋利的精钢长剑', quantity: 1, effects: { attack: 4 }, rarity: 'common', usable: false },
            { name: '金创药', type: 'consumable', description: '恢复25点生命值', quantity: 5, effects: { hp: 25 }, rarity: 'common', usable: true },
            { name: '银两', type: 'misc', description: '江湖通用货币', quantity: 30, rarity: 'common', usable: false },
        ],
        starterLocation: '洛阳城',
        starterLocationDesc: '天下第一城洛阳，繁华热闹。城中有武林盟的分舵，各路英雄豪杰在此汇聚。',
        starterGold: 30,
    },
    {
        id: 'tpl_apocalypse', name: '末日求生', genre: '末日', icon: '☢️',
        description: '后启示录生存挑战',
        world: {
            name: '废土', genre: '末日',
            description: '核战之后的废土世界，文明已经崩塌。幸存者在废墟中艰难求生，变异生物横行，资源极度匮乏。你从一座地下避难所中醒来...',
            rules: '辐射无处不在，需要盖革计数器监测。物资极度稀缺，以物易物是主要交易方式。变异生物具有不同的弱点。',
            tone: '黑暗',
        },
        starterItems: [
            { name: '自制匕首', type: 'weapon', description: '用废铁打磨的匕首', quantity: 1, effects: { attack: 2 }, rarity: 'common', usable: false },
            { name: '脏水', type: 'consumable', description: '恢复10点生命值，有概率生病', quantity: 3, effects: { hp: 10 }, rarity: 'common', usable: true },
            { name: '防毒面具', type: 'armor', description: '过滤部分辐射尘埃', quantity: 1, effects: { defense: 1 }, rarity: 'uncommon', usable: false },
        ],
        starterLocation: '避难所',
        starterLocationDesc: '一座破旧的地下避难所，应急灯忽明忽暗。储物柜里还有一些残余物资，大门通向未知的废土。',
        starterGold: 0,
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
