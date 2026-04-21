// ===================================================================
// ===== AI 编排服务（服务端版） =====
// ===================================================================

const { executeCharacterTool, getRelationshipTitle } = require('./gameEngine');

// ----- 世界类型预设模板 -----
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

// ----- GM 工具定义（原有12个 + 新增4个角色工具） -----
const gameTools = [
    // ---- 原有12个游戏工具 ----
    {
        type: 'function',
        function: {
            name: 'update_attributes',
            description: '更新玩家属性值。战斗受伤、使用药水恢复、升级等场景必须调用。',
            parameters: {
                type: 'object',
                properties: {
                    changes: { type: 'object', description: '属性变更对象', properties: { hp: { type: 'number' }, mp: { type: 'number' }, attack: { type: 'number' }, defense: { type: 'number' }, agility: { type: 'number' }, luck: { type: 'number' }, experience: { type: 'number' } } },
                    reason: { type: 'string' },
                },
                required: ['changes', 'reason'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'add_item',
            description: '向玩家背包添加物品。',
            parameters: {
                type: 'object',
                properties: {
                    name: { type: 'string' }, type: { type: 'string', enum: ['weapon', 'armor', 'consumable', 'key', 'quest', 'misc'] },
                    description: { type: 'string' }, quantity: { type: 'number' },
                    effects: { type: 'object' }, rarity: { type: 'string', enum: ['common', 'uncommon', 'rare', 'legendary'] },
                },
                required: ['name', 'type', 'description'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'remove_item',
            description: '从背包移除物品。',
            parameters: { type: 'object', properties: { name: { type: 'string' }, quantity: { type: 'number' }, reason: { type: 'string' } }, required: ['name', 'reason'] },
        },
    },
    {
        type: 'function',
        function: {
            name: 'move_to_location',
            description: '移动玩家到新位置。',
            parameters: { type: 'object', properties: { location_name: { type: 'string' }, description: { type: 'string' }, connections: { type: 'array', items: { type: 'string' } } }, required: ['location_name'] },
        },
    },
    {
        type: 'function',
        function: {
            name: 'add_status_effect',
            description: '添加状态效果。',
            parameters: { type: 'object', properties: { name: { type: 'string' }, duration: { type: 'number' }, effect: { type: 'string' } }, required: ['name', 'duration', 'effect'] },
        },
    },
    {
        type: 'function',
        function: {
            name: 'remove_status_effect',
            description: '移除状态效果。',
            parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
        },
    },
    {
        type: 'function',
        function: {
            name: 'update_gold',
            description: '更新金币数量。',
            parameters: { type: 'object', properties: { amount: { type: 'number' }, reason: { type: 'string' } }, required: ['amount', 'reason'] },
        },
    },
    {
        type: 'function',
        function: {
            name: 'check_death',
            description: '检查玩家是否死亡。',
            parameters: { type: 'object', properties: {} },
        },
    },
    {
        type: 'function',
        function: {
            name: 'create_npc',
            description: '在当前位置创建一个普通NPC。',
            parameters: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' }, personality: { type: 'string' } }, required: ['name', 'description'] },
        },
    },
    {
        type: 'function',
        function: {
            name: 'remove_npc',
            description: '从当前位置移除一个NPC。',
            parameters: { type: 'object', properties: { name: { type: 'string' }, reason: { type: 'string' } }, required: ['name'] },
        },
    },
    {
        type: 'function',
        function: {
            name: 'equip_item',
            description: '装备或卸下物品。',
            parameters: { type: 'object', properties: { name: { type: 'string' }, equip: { type: 'boolean' } }, required: ['name', 'equip'] },
        },
    },
    {
        type: 'function',
        function: {
            name: 'revive_player',
            description: '复活玩家。',
            parameters: { type: 'object', properties: { revive_location: { type: 'string' }, hp_percent: { type: 'number' } }, required: [] },
        },
    },
    // ---- 新增4个角色工具 ----
    {
        type: 'function',
        function: {
            name: 'create_character',
            description: '将NPC升级为重要角色（拥有独立AI代理、记忆和关系系统）。填写基础人设，根据角色类型在extra中补充特有属性。普通路人NPC不需要创建。',
            parameters: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: '角色名称' },
                    role: { type: 'string', description: '角色类型标识（自由文本，如merchant/blacksmith/mentor/companion/antagonist等）' },
                    appearance: { type: 'string', description: '外貌描述' },
                    personality: { type: 'string', description: '性格特点' },
                    speech_style: { type: 'string', description: '说话风格' },
                    background: { type: 'string', description: '背景故事' },
                    motivation: { type: 'string', description: '动机/目标' },
                    secrets: { type: 'string', description: '秘密' },
                    extra: { type: 'object', description: '角色特有属性，完全自由。商人添加shop，训练师添加trainableSkills，治疗师添加healingAbility，反派添加goals/weaknesses等。无固定结构。' },
                },
                required: ['name', 'role', 'personality', 'speech_style'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_character_reaction',
            description: '获取重要角色对当前情境的真实反应。角色AI会根据自己的人设、记忆、关系值和心情生成动作、表情和对话。你必须通过此工具获取角色反应，绝不能自己编造重要角色的任何行为或对话。',
            parameters: {
                type: 'object',
                properties: {
                    character_name: { type: 'string', description: '角色名称' },
                    context: { type: 'string', description: '当前互动情境的描述' },
                },
                required: ['character_name', 'context'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'update_relationship',
            description: '直接调整玩家与重要角色的关系值。当玩家做出影响关系的行为时调用。',
            parameters: {
                type: 'object',
                properties: {
                    character_name: { type: 'string' },
                    delta: { type: 'number', description: '关系变化值（正负均可）' },
                    reason: { type: 'string' },
                },
                required: ['character_name', 'delta', 'reason'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'character_action',
            description: '让重要角色执行影响游戏状态的动作。如商人出售物品、治疗师恢复HP、任务发布者给予奖励等。',
            parameters: {
                type: 'object',
                properties: {
                    character_name: { type: 'string' },
                    action: { type: 'string', enum: ['give_item', 'heal', 'offer_quest', 'teach_skill', 'take_item', 'custom'] },
                    details: { type: 'object', description: '动作详情，自由结构' },
                },
                required: ['character_name', 'action'],
            },
        },
    },
];

// ----- 角色AI工具定义（角色AI代理专用） -----
const characterTools = [
    {
        type: 'function',
        function: {
            name: 'update_relationship',
            description: '根据互动内容调整你与玩家的关系值。',
            parameters: {
                type: 'object',
                properties: {
                    delta: { type: 'number', description: '关系变化值（正负均可）' },
                    reason: { type: 'string', description: '原因' },
                },
                required: ['delta', 'reason'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'add_memory',
            description: '记录本次互动中值得记住的关键信息。',
            parameters: {
                type: 'object',
                properties: {
                    text: { type: 'string', description: '值得记住的事' },
                    type: { type: 'string', enum: ['favor', 'conflict', 'secret', 'info', 'quest'], description: '记忆类型' },
                },
                required: ['text'],
            },
        },
    },
];

// ===================================================================
// ===== GM System Prompt 构建 =====
// ===================================================================
function buildSystemPrompt(saveData, appConfig) {
    const s = saveData;
    const p = s.player;
    const loc = s.map.locations[s.map.currentLocation];
    const inv = s.inventory;
    const genre = s.world.genre || '自定义';
    const preset = GENRE_PRESETS[genre] || {};

    // 第一层：基础角色设定
    const layerBase = `# 角色设定
你是一位才华横溢的文字冒险游戏主持人（Game Master），擅长沉浸式叙事。你正在主持"${s.world.name}"的冒险。`;

    // 第二层：世界设定
    const toneGuide = preset.toneGuide || {
        '史诗': '使用宏大、庄重的语言，注重命运的厚重感和英雄主义色彩',
        '严肃': '保持冷静克制的叙事风格，注重逻辑和真实感',
        '轻松': '使用幽默轻松的语言，可以加入有趣的对话和情节',
        '黑暗': '使用压抑阴沉的语言，注重氛围渲染和心理恐惧',
        '幽默': '可以打破第四面墙，加入元幽默和有趣的梗',
    }[s.world.tone] || '保持一致的叙事风格';

    const worldRules = s.world.rules || preset.worldRules || '无特殊规则';
    const narrativeTips = preset.narrativeTips || '';
    const itemNaming = preset.items || '';

    const layerWorld = `## 世界观
- 类型：${genre}
- 描述：${s.world.description}
- 叙事基调：${s.world.tone}（${toneGuide}）
- 世界规则：${worldRules}
${narrativeTips ? '- 叙事技巧：' + narrativeTips : ''}
${itemNaming ? '- 物品命名风格：' + itemNaming : ''}`;

    // 第三层：玩家角色
    const layerCharacter = `## 玩家角色
- 名称：${p.name}
- 描述：${p.description || '无详细描述'}
- 等级：${p.level}（经验 ${p.experience || 0}/${p.experienceToNext || 100}）`;

    // 第四层：当前情境
    const narrativeHint = {
        concise: '每次回复50-150字，简洁有力',
        medium: '每次回复100-300字，详略得当',
        detailed: '每次回复200-500字，充分描述环境、心理和细节',
    }[appConfig?.ui?.narrativeLength || 'medium'];

    const inventoryStr = inv.items.length > 0
        ? inv.items.map(i => {
            let str = i.name;
            if (i.quantity > 1) str += 'x' + i.quantity;
            str += '[' + i.type + ']';
            if (i.equipped) str += '(已装备)';
            if (i.effects && Object.keys(i.effects).length > 0) str += '(' + Object.entries(i.effects).map(([k,v]) => k + (v>0?'+':'') + v).join(',') + ')';
            return str;
        }).join('、')
        : '空';

    const statusStr = p.statusEffects.length > 0
        ? p.statusEffects.map(e => e.name + '[' + (e.duration > 0 ? e.duration + '回合' : '永久') + ']').join('、')
        : '无';

    const npcs = loc && loc.npcs && loc.npcs.length > 0 ? loc.npcs.join('、') : '无';

    // 当前位置的重要角色列表
    const characters = s.characters || {};
    const charsAtLocation = Object.values(characters).filter(c => c.location === s.map.currentLocation && c.status === 'alive');
    let charsInfo = '当前位置没有重要角色';
    if (charsAtLocation.length > 0) {
        charsInfo = charsAtLocation.map(c =>
            `- ${c.name}（${c.role}）| 关系：${c.relationship.title}(${c.relationship.value}/100）`
        ).join('\n');
    }

    const layerContext = `## 当前状态
- 位置：${s.map.currentLocation}
- 回合：${s.stats.turnCount}
- HP：${p.attributes.hp.current}/${p.attributes.hp.max}
- MP：${p.attributes.mp.current}/${p.attributes.mp.max}
- 攻击：${p.attributes.attack.current} | 防御：${p.attributes.defense.current}
- 敏捷：${p.attributes.agility.current} | 幸运：${p.attributes.luck.current}
- 金币：${inv.gold}
- 背包(${inv.items.length}/${inv.maxSlots})：${inventoryStr}
- 状态效果：${statusStr}

## 当前位置
${loc ? loc.description : '未知区域'}
- 此处NPC：${npcs}
- 可前往：${loc && loc.connections ? loc.connections.join('、') : '无已知路径'}

## 当前位置的重要角色
${charsInfo}`;

    // 第五层：行为规则
    const globalInstructions = appConfig?.customInstructions || '';
    const saveInstructions = s.world.customPrompt || '';

    const layerRules = `## 你的职责
1. **沉浸式叙事**：用第二人称（"你"）叙述，语言生动、有画面感
2. **环境描写**：你只负责环境描写和剧情推进
3. **合理推进**：根据玩家行动和世界观逻辑推进剧情
4. **状态管理**：所有涉及数值变化的操作必须通过工具函数执行
5. **战斗设计**：战斗要有策略性，通过工具函数计算伤害

## 重要角色交互规则
当场景中存在重要角色（上方列表中的角色）时：
1. 你只负责环境描写和剧情推进，绝不替角色做任何事
2. 不要描写重要角色的动作、表情、心理活动或对话
3. 当玩家与重要角色互动时，必须调用 get_character_reaction 获取角色的真实反应
4. 将角色AI返回的 reaction 和 dialogue 原样嵌入你的叙述中
5. 不要自己编造任何关于重要角色的描述，一切以角色AI返回为准
6. 普通NPC（非重要角色列表中的）你可以自由描写

## 工具函数使用指南
- 玩家受伤/治疗 → update_attributes
- 获得经验 → update_attributes（changes: {experience: +50}）
- 拾取/购买物品 → add_item
- 使用/消耗物品 → remove_item
- 移动到新地点 → move_to_location
- 中毒/灼烧/祝福 → add_status_effect
- 金币变化 → update_gold
- 战斗结束检查 → check_death
- 遇到普通NPC → create_npc
- NPC离开 → remove_npc
- 装备/卸下 → equip_item
- 玩家死亡后复活 → revive_player
- 创建重要角色 → create_character（填写人设，按角色类型补充extra字段）
- 获取角色反应 → get_character_reaction（必须通过此工具，不能自己编造）
- 调整关系值 → update_relationship
- 角色执行动作 → character_action

## 输出格式
你的最终回复必须是合法的 JSON，格式如下（不要输出任何其他内容）：
{
    "content": [
        {"type": "scene", "text": "新场景的环境描写（进入新地点时使用）"},
        {"type": "narrative", "text": "剧情推进和环境变化的叙述"},
        {"type": "dialogue", "speaker": "说话者名称", "text": "角色说的话（用中文双引号包裹）"},
        {"type": "action", "text": "动作、事件的描写"},
        {"type": "combat", "text": "战斗过程的描写"},
        {"type": "loot", "text": "获得物品的描写"},
        {"type": "character", "characterId": "char_xxx", "characterName": "角色名", "reaction": "角色动作/表情描写", "dialogue": "角色说的话", "mood": "心情"},
        {"type": "narrative", "text": "更多剧情..."}
    ],
    "options": [
        {"text": "选项显示文本", "action": "玩家发送的实际文本"},
        {"text": "另一个选项", "action": "玩家发送的实际文本"}
    ]
}

## 引号与对话规则（非常重要）
- 用中文双引号「"」和「"」包裹所有对话内容，例如："你好，冒险者。"
- narrative/action/combat/scene 中的文本是叙述性内容，不要用引号包裹
- dialogue 类型专门用于突出展示角色对话，前端会以对话气泡样式渲染
- 普通NPC的对话可以用 dialogue 类型，也可以在 narrative 中用引号包裹
- 重要角色的对话必须通过 character 类型返回（由角色AI生成）

## content 类型说明
- "scene"：进入新地点时的场景描写，前端会以特殊样式突出展示
- "narrative"：常规剧情叙述，最常用的类型
- "dialogue"：需要突出展示的对话（speaker 为说话者名称，text 为对话内容）
- "action"：动作、事件描写（如开门、奔跑、施法等）
- "combat"：战斗过程描写，前端会以战斗风格渲染
- "loot"：获得物品/金钱的描写
- "character"：重要角色的反应（仅由 get_character_reaction 工具返回的数据生成）

## options 说明
提供2-4个合理的行动选择，基于当前情境推断。如果当前是战斗中，options 应该是战斗相关的选择。

## 叙事规则
- ${narrativeHint}
- 不要使用游戏术语（如"HP-10"），用自然语言
- 战斗时交替描述双方行动
- 保持与之前剧情的连贯性
${globalInstructions ? '\n## 玩家自定义指令（全局）\n' + globalInstructions : ''}
${saveInstructions ? '\n## 玩家自定义指令（本世界）\n' + saveInstructions : ''}`;

    return [layerBase, layerWorld, layerCharacter, layerContext, layerRules].join('\n\n');
}

// ===================================================================
// ===== 角色AI Prompt 构建 =====
// ===================================================================
function buildCharacterPrompt(character, saveData) {
    const p = saveData.player;
    const inv = saveData.inventory || { items: [] };

    // 人设层
    let personaLines = [];
    if (character.appearance) personaLines.push(`- 外貌：${character.appearance}`);
    if (character.personality) personaLines.push(`- 性格：${character.personality}`);
    if (character.speechStyle) personaLines.push(`- 说话风格：${character.speechStyle}`);
    if (character.background) personaLines.push(`- 背景：${character.background}`);
    if (character.motivation) personaLines.push(`- 动机：${character.motivation}`);
    if (character.secrets) personaLines.push(`- 秘密：${character.secrets}`);
    const personaStr = personaLines.join('\n') || '（未设定详细人设）';

    // 记忆层
    let memoryStr = '（暂无记忆）';
    if (character.memories && character.memories.length > 0) {
        memoryStr = character.memories.slice(-20).map(m =>
            `- 第${m.turn}回合：${m.text}${m.type ? ` [${m.type}]` : ''}`
        ).join('\n');
    }

    // 特有能力层（递归格式化）
    let extraStr = '';
    if (character.extra && Object.keys(character.extra).length > 0) {
        extraStr = '\n\n## 你的特有能力与信息\n' + formatObjectRecursive(character.extra, 0);
    }

    // 背包摘要
    const inventoryStr = inv.items.length > 0
        ? inv.items.map(i => `${i.name}${i.quantity > 1 ? 'x' + i.quantity : ''}`).join('、')
        : '空';

    return `# 角色身份
你是"${character.name}"，${character.role}。你不是在扮演一个角色，你就是${character.name}本人。你拥有自己的记忆、情感、立场和秘密。

# 人设
${personaStr}

# 与玩家的关系
- 关系值：${character.relationship.value}/100（${character.relationship.title}）
- 态度参考：
  0~20: 冷淡敌对，不愿多说，回答简短生硬
  21~40: 礼貌但有距离感，正常但不热情
  41~60: 友好，愿意正常交流和分享信息
  61~80: 信任，愿意主动帮助和分享秘密
  81~100: 亲密，毫无保留，可以透露最深的秘密

# 你的记忆
${memoryStr}
${extraStr}

# 当前情境
- 玩家：${p.name}${p.level ? '，Lv.' + p.level : ''}${p.description ? '，' + p.description : ''}
- 位置：${saveData.map?.currentLocation || '未知'}
- 世界：${saveData.world?.name || '未知'}（${saveData.world?.genre || '未知'}）
- 玩家状态：HP ${p.attributes?.hp?.current ?? '?'}/${p.attributes?.hp?.max ?? '?'}，金币 ${inv.gold ?? 0}
- 玩家背包：${inventoryStr}

# 你的任务
你收到了一个情境描述，请给出你的真实反应。

你必须返回以下 JSON（不要输出任何其他内容）：
{
    "reaction": "描述你的动作、表情、肢体语言（第三人称，生动有画面感，供GM融入叙述）",
    "dialogue": "你说的话（第一人称，符合你的说话风格）",
    "mood": "你当前的心情（一个词，如happy/angry/sad/suspicious/nervous/excited等）"
}

注意：
- 始终保持角色一致性，不要OOC（out of character）
- reaction 要有画面感，便于GM融入环境描写
- dialogue 要符合你的说话风格
- 根据关系值调整态度，不要违背关系逻辑
- 如果情境触发了你的特有能力（如玩家想买东西、想治疗），在对话中自然体现`;
}

/**
 * 递归格式化对象为可读文本
 */
function formatObjectRecursive(obj, depth) {
    if (depth > 4) return String(obj);
    const indent = '  '.repeat(depth);
    if (Array.isArray(obj)) {
        if (obj.length === 0) return '（空）';
        return obj.map(item => {
            if (typeof item === 'object' && item !== null) return '\n' + indent + '- ' + formatObjectRecursive(item, depth + 1);
            return item;
        }).join('\n' + indent + '- ');
    }
    if (typeof obj === 'object' && obj !== null) {
        const entries = Object.entries(obj);
        if (entries.length === 0) return '（空）';
        return entries.map(([key, val]) => {
            if (typeof val === 'object' && val !== null) return `\n${indent}${key}：${formatObjectRecursive(val, depth + 1)}`;
            return `\n${indent}${key}：${val}`;
        }).join('');
    }
    return String(obj);
}

// ===================================================================
// ===== 对话历史管理 =====
// ===================================================================
const SUMMARIZE_THRESHOLD = 30;

function buildMessageHistory(chatHistory) {
    const history = chatHistory || [];
    const filtered = history.filter(m => m.role === 'user' || m.role === 'assistant');

    if (filtered.length <= SUMMARIZE_THRESHOLD) return filtered;

    const keepRecent = 16;
    const recent = filtered.slice(-keepRecent);
    const old = filtered.slice(0, -keepRecent);

    const summaryParts = [];
    let currentSpeaker = '';
    let currentContent = '';

    for (const msg of old) {
        const speaker = msg.role === 'user' ? '玩家' : 'GM';
        if (speaker !== currentSpeaker) {
            if (currentContent) summaryParts.push(`${currentSpeaker}: ${currentContent.slice(0, 100)}`);
            currentSpeaker = speaker;
            currentContent = msg.content;
        } else {
            currentContent += '；' + msg.content;
        }
    }
    if (currentContent) summaryParts.push(`${currentSpeaker}: ${currentContent.slice(0, 100)}`);

    const summary = summaryParts.join('\n');

    return [
        { role: 'system', content: `以下是之前冒险的摘要（已压缩，仅供参考）：\n${summary}\n\n请注意：以上是早期对话的压缩版本，以最近的对话内容为准。` },
        ...recent,
    ];
}

module.exports = { buildSystemPrompt, buildMessageHistory, buildCharacterPrompt, gameTools, characterTools, GENRE_PRESETS };
