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
            description: '向玩家背包添加物品。注意：description 为必填项，即使是普通物品（面包、绳子、信件等）也必须提供 15-30 字的有意义描述，说明物品的外观、质地、气味等感官细节。不要传空描述或敷衍描述。',
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
            name: 'create_location',
            description: '在地图上创建一个新地点（不移动玩家）。当你在叙事中描述了一个新的可前往地点时必须调用此工具，例如城镇内的建筑（铁匠铺、酒馆等）、城镇外的区域（森林、洞穴等）。创建后该地点会出现在游戏地图中，玩家可以选择前往。',
            parameters: {
                type: 'object',
                properties: {
                    location_name: { type: 'string', description: '地点名称' },
                    description: { type: 'string', description: '地点的环境描述（50-100字，有画面感）' },
                    connections: { type: 'array', items: { type: 'string' }, description: '与该地点相连的其他地点名称列表（应包含当前位置）' },
                },
                required: ['location_name', 'description'],
            },
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
            description: '创建一个重要角色（拥有独立AI代理、记忆和关系系统）。当遇到以下情况时必须调用此工具：1)玩家首次遇到有名字、有对话的NPC；2)NPC在后续剧情中会反复出现；3)NPC与玩家有交易、任务、师徒等持续关系。普通路人、一次性龙套不需要创建。创建后该角色将出现在重要角色列表中。',
            parameters: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: '角色名称' },
                    role: { type: 'string', description: '角色类型标识（如merchant/blacksmith/mentor/companion/antagonist/guard/noble等）' },
                    gender: { type: 'string', description: '性别' },
                    age: { type: 'string', description: '年龄' },
                    appearance: { type: 'string', description: '外貌描述' },
                    personality: { type: 'string', description: '性格特点（如沉稳、暴躁、温柔、狡猾等）' },
                    speech_style: { type: 'string', description: '说话风格（如正式、粗鲁、文雅、幽默等）' },
                    background: { type: 'string', description: '背景故事' },
                    motivation: { type: 'string', description: '动机/目标' },
                    secrets: { type: 'string', description: '秘密' },
                    extra: { type: 'object', description: '角色特有属性。商人添加{shop:{name,items}}，训练师添加{trainableSkills:[]}，治疗师添加{healingAbility}，任务发布者添加{quests:[]}等。无固定结构，完全自由。' },
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

module.exports = { gameTools };
