const GENRE_PRESETS = {
    '奇幻': {
        toneGuide: '使用宏大、庄重的语言，注重命运的厚重感和英雄主义色彩。战斗描写要有力量感，魔法场景要有神秘感。',
        worldRules: '魔法分为元素系（火、水、风、土）、暗影系和神圣系。战士、法师、游侠、牧师是常见职业。不同种族有不同的文化传统。',
        narrativeTips: '注重描写魔法效果的光影和声音、古老遗迹的神秘氛围、种族间的文化差异。NPC对话可以加入一些古风或正式的用语。',
        items: '物品命名可以带有魔法属性描述，如"烈焰之刃"、"精灵之泪"。',
    },
    '科幻': {
        toneGuide: '使用冷静、理性的语言风格，注重科技细节和逻辑推演。可以加入一些科学术语增强沉浸感。',
        worldRules: '科技水平高度发达，拥有超光速航行、能量护盾、等离子武器。人工智能和机器人在社会中扮演重要角色。',
        narrativeTips: '注重描写太空的壮阔、科技设备的精密感、外星环境的异域风情。NPC对话可以更加简洁直接。',
        items: '物品命名可以带有科技感，如"量子脉冲枪"、"纳米修复包"、"反物质电池"。',
    },
    '武侠': {
        toneGuide: '使用半文半白的语言风格，注重江湖义气和侠骨柔情。武功描写要有招式名称和气势。',
        worldRules: '武功分为内功、外功、轻功三大类。门派有少林、武当、峨眉、丐帮、魔教等。江湖中有正邪之分。',
        narrativeTips: '注重描写武功招式的精妙、江湖人情世故、山水风景的诗意。NPC对话可以适当使用江湖切口和古语。',
        items: '物品命名可以带有武侠风格，如"玄铁重剑"、"九转回魂丹"、"轻功靴"。',
    },
    '末日': {
        toneGuide: '使用冷峻、克制的语言风格，注重生存的紧迫感和资源的匮乏感。描写要有废土的荒凉和危险。',
        worldRules: '核战之后的废土世界，辐射无处不在。物资极度稀缺，以物易物是主要交易方式。变异生物具有不同的弱点。',
        narrativeTips: '注重描写废墟的荒凉、辐射的危险、生存的艰难抉择。NPC对话通常简短、警惕、充满戒心。',
        items: '物品命名可以带有废土风格，如"自制水管弩"、"辐射净水片"、"防毒面具滤芯"。',
    },
    '现代': {
        toneGuide: '使用现代日常的语言风格，注重真实感和代入感。可以适当加入一些幽默和轻松的元素。',
        worldRules: '现代社会背景，科技水平与现实世界相当。可以有一些超自然或悬疑元素。',
        narrativeTips: '注重描写现代都市的细节、人物的心理活动、社交关系的微妙变化。',
        items: '物品命名贴近现实，如"智能手机"、"急救包"、"手电筒"。',
    },
};

const DEFAULT_PRESET = {
    id: 'custom',
    displayName: '自定义',
    icon: '🎨',
    toneGuide: '根据世界设定自由调整叙事风格',
    worldRules: '',
    narrativeTips: '',
    itemNamingStyle: '',
};

function getGenrePreset(genre) {
    if (genre && GENRE_PRESETS[genre]) return GENRE_PRESETS[genre];
    return { ...DEFAULT_PRESET, id: genre || 'custom', displayName: genre || '自定义' };
}

module.exports = { GENRE_PRESETS, DEFAULT_PRESET, getGenrePreset };
