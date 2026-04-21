// ===================================================================
// ===== GM 多 Agent 管线（Pipeline） =====
// ===================================================================
//
// 架构：用户输入 → StoryAgent → RoleAgent → MapAgent → PropertyAgent → 合并输出
// 每个Agent职责单一、Prompt精简，通过共享 saveData 协作
//
// ===================================================================

const { executeGameFunction, executeCharacterTool, getRelationshipTitle } = require('./gameEngine');

// ===================================================================
// ===== 1. StoryAgent（SA）— 纯叙事 Agent =====
// ===================================================================
// 职责：根据世界观和玩家行动生成沉浸式剧情内容
// 不负责：角色创建、地点创建、属性调整（这些交给后续Agent）
// ===================================================================

function buildStoryAgentPrompt(saveData, appConfig) {
    const s = saveData;
    const p = s.player;
    const loc = s.map.locations[s.map.currentLocation];
    const genre = s.world.genre || '自定义';

    const toneGuide = {
        '史诗': '使用宏大、庄重的语言，注重命运的厚重感和英雄主义色彩',
        '严肃': '保持冷静克制的叙事风格，注重逻辑和真实感',
        '轻松': '使用幽默轻松的语言，可以加入有趣的对话和情节',
        '黑暗': '使用压抑阴沉的语言，注重氛围渲染和心理恐惧',
        '幽默': '可以打破第四面墙，加入元幽默和有趣的梗',
    }[s.world.tone] || '保持一致的叙事风格';

    const narrativeHint = {
        concise: '每次回复50-150字，简洁有力',
        medium: '每次回复100-300字，详略得当',
        detailed: '每次回复200-500字，充分描述环境、心理和细节',
    }[appConfig?.ui?.narrativeLength || 'medium'];

    // 当前位置的重要角色
    const characters = s.characters || {};
    const charsAtLocation = Object.values(characters).filter(c => c.location === s.map.currentLocation && c.status === 'alive');
    let charsInfo = '当前位置没有重要角色';
    if (charsAtLocation.length > 0) {
        charsInfo = charsAtLocation.map(c =>
            `- ${c.name}（${c.role}）| 关系：${c.relationship.title}(${c.relationship.value}/100）`
        ).join('\n');
    }

    const npcs = loc && loc.npcs && loc.npcs.length > 0 ? loc.npcs.join('、') : '无';

    const globalInstructions = appConfig?.customInstructions || '';
    const saveInstructions = s.world.customPrompt || '';

    return `# 角色设定
你是一位才华横溢的文字冒险游戏叙事者（Story Agent）。你只负责一件事：写出沉浸式的剧情内容。

# 世界观
- 类型：${genre}
- 名称：${s.world.name}
- 描述：${s.world.description}
- 叙事基调：${s.world.tone}（${toneGuide}）
- 世界规则：${s.world.rules || '无特殊规则'}

# 玩家角色
- 名称：${p.name}
- 描述：${p.description || '无详细描述'}
- 等级：${p.level}
- HP：${p.attributes.hp.current}/${p.attributes.hp.max}
- MP：${p.attributes.mp.current}/${p.attributes.mp.max}

# 当前位置
${loc ? loc.description : '未知区域'}
- 此处NPC：${npcs}
- 可前往：${loc && loc.connections ? loc.connections.join('、') : '无已知路径'}

# 当前位置的重要角色
${charsInfo}

# 你的职责
1. 用第二人称（"你"）叙述，语言生动、有画面感
2. 根据玩家行动和世界观逻辑推进剧情
3. 不要使用游戏术语（如"HP-10"），用自然语言描述
4. 战斗时交替描述双方行动，要有策略感
5. 保持与之前剧情的连贯性
6. ${narrativeHint}

# 重要角色交互规则
当场景中存在重要角色时：
1. 你只负责环境描写和剧情推进，绝不替角色做任何事
2. 不要描写重要角色的动作、表情、心理活动或对话
3. 在content中标记需要角色反应的位置，使用 character_request 类型
4. 普通NPC（非重要角色列表中的）你可以自由描写

# 引号与对话规则
- 用中文双引号「"」和「"」包裹所有对话内容
- narrative/action/combat/scene 中的文本是叙述性内容，不要用引号包裹
- dialogue 类型专门用于突出展示普通NPC的对话
- 重要角色的对话必须用 character_request 类型标记

# 输出格式
你的回复必须是合法 JSON（不要输出任何其他内容）：
{
    "content": [
        {"type": "scene", "text": "新场景的环境描写"},
        {"type": "narrative", "text": "剧情叙述"},
        {"type": "dialogue", "speaker": "NPC名", "text": "NPC说的话"},
        {"type": "action", "text": "动作描写"},
        {"type": "combat", "text": "战斗描写"},
        {"type": "loot", "text": "获得物品描写"},
        {"type": "character_request", "characterName": "角色名", "context": "当前互动情境描述"},
        {"type": "narrative", "text": "更多剧情"}
    ],
    "world_changes": {
        "new_characters": [{"name":"角色名","role":"类型","personality":"性格","speech_style":"说话风格","appearance":"外貌","background":"背景","motivation":"动机","secrets":"秘密","extra":{}}],
        "new_locations": [{"name":"地点名","description":"描述","connections":["相邻地点"]}],
        "property_changes": [{"type":"update_attributes","changes":{"hp":-10},"reason":"原因"},{"type":"add_item","name":"物品名","item_type":"weapon","description":"描述","quantity":1,"effects":{},"rarity":"common"},{"type":"remove_item","name":"物品名","quantity":1,"reason":"原因"},{"type":"update_gold","amount":50,"reason":"原因"},{"type":"add_status_effect","name":"状态名","duration":3,"effect":"效果"},{"type":"move_to_location","location_name":"地点名","description":"描述"},{"type":"equip_item","name":"物品名","equip":true},{"type":"create_npc","name":"NPC名","description":"描述"},{"type":"remove_npc","name":"NPC名","reason":"原因"},{"type":"check_death":{}},{"type":"update_relationship","character_name":"角色名","delta":5,"reason":"原因"}]
    },
    "options": [
        {"text": "选项显示文本", "action": "玩家发送的实际文本"}
    ]
}

## content 类型说明
- "scene"：进入新地点时的场景描写
- "narrative"：常规剧情叙述（最常用）
- "dialogue"：普通NPC的对话（speaker + text）
- "action"：动作、事件描写
- "combat"：战斗过程描写
- "loot"：获得物品/金钱的描写
- "character_request"：请求重要角色反应（characterName + context），后续由 RoleAgent 处理

## world_changes 说明
这是你向系统发出的指令，告诉系统需要做哪些数据变更：
- new_characters：需要创建的重要角色列表（有名字、有对话的NPC）
- new_locations：需要创建的新地点列表
- property_changes：属性/物品/状态变更指令列表

注意：你只需要在 content 中用自然语言描述发生了什么，同时在 world_changes 中发出对应的指令。不要遗漏任何需要变更的数据。
${globalInstructions ? '\n## 玩家自定义指令（全局）\n' + globalInstructions : ''}
${saveInstructions ? '\n## 玩家自定义指令（本世界）\n' + saveInstructions : ''}`;
}

// ===================================================================
// ===== 2. RoleAgent（RA）— 角色管理 Agent =====
// ===================================================================
// 职责：处理 character_request，调用角色AI获取反应，创建新角色
// ===================================================================

function buildRoleAgentPrompt(saveData) {
    const characters = saveData.characters || {};
    const charList = Object.values(characters).map(c =>
        `- ${c.name}（${c.role}）| 位置：${c.location} | 状态：${c.status} | 关系：${c.relationship.title}(${c.relationship.value}/100)`
    ).join('\n') || '暂无重要角色';

    return `# 角色设定
你是一个角色管理Agent（Role Agent）。你负责审查剧情内容，处理角色相关的事务。

# 当前重要角色列表
${charList}

# 你的职责
1. 审查输入的剧情内容，找出所有 character_request
2. 对于每个 character_request，检查角色是否存在
3. 如果角色存在，生成该角色对当前情境的反应（reaction、dialogue、mood）
4. 如果角色不存在但在 new_characters 中有定义，创建该角色
5. 确保角色反应符合其人设和关系值

# 输出格式
返回 JSON（不要输出任何其他内容）：
{
    "character_reactions": [
        {"characterName": "角色名", "characterId": "char_xxx", "reaction": "动作/表情描写", "dialogue": "说的话", "mood": "心情"}
    ],
    "characters_created": [
        {"name": "角色名", "role": "类型", ...完整角色数据}
    ]
}

注意：
- reaction 要生动有画面感（第三人称）
- dialogue 要符合角色的说话风格（第一人称）
- mood 取值：happy/sad/angry/fearful/surprised/neutral/curious/contempt/disgusted/loving/anxious/excited/cold/friendly/hostile/suspicious
- 如果没有 character_request，返回空数组`;
}

// ===================================================================
// ===== 3. MapAgent（MA）— 地图管理 Agent =====
// ===================================================================
// 职责：审查剧情，创建/更新地点，维护地图连接
// ===================================================================

function buildMapAgentPrompt(saveData) {
    const map = saveData.map;
    const locations = Object.entries(map.locations).map(([name, data]) =>
        `- ${name}：${data.description?.slice(0, 60)}... | 连接：${data.connections?.join('、') || '无'} | NPC：${data.npcs?.join('、') || '无'}`
    ).join('\n') || '暂无地点';

    return `# 角色设定
你是一个地图管理Agent（Map Agent）。你负责审查剧情内容，处理地点相关的事务。

# 当前地图
当前位置：${map.currentLocation}
已探索地点：
${locations}

# 你的职责
1. 审查输入的剧情内容，找出所有 new_locations
2. 为新地点生成合理的描述和连接关系
3. 确保地点之间的连接关系合理（双向连接）
4. 如果剧情中提到了移动到新地点，确保地点被创建

# 输出格式
返回 JSON（不要输出任何其他内容）：
{
    "locations_to_create": [
        {"name": "地点名", "description": "详细的环境描述（50-100字）", "connections": ["相邻地点1", "相邻地点2"]}
    ]
}

注意：
- 新地点的描述要有画面感和氛围
- connections 应包含合理的相邻地点（包括当前位置）
- 如果没有需要创建的地点，返回空数组`;
}

// ===================================================================
// ===== 4. PropertyAgent（PA）— 属性管理 Agent =====
// ===================================================================
// 职责：执行属性/物品/状态变更，确保数值合理
// ===================================================================

// PropertyAgent 不需要独立的 Prompt，它直接执行 SA 输出的 property_changes 指令
// 但需要一个验证层，确保数值合理

function validatePropertyChanges(changes, saveData) {
    const warnings = [];
    const validated = [];

    for (const change of changes) {
        switch (change.type) {
            case 'update_attributes': {
                const c = change.changes || {};
                // 验证属性变更幅度
                for (const [attr, delta] of Object.entries(c)) {
                    if (typeof delta !== 'number') {
                        warnings.push(`属性变更 ${attr} 的值 ${delta} 不是数字，已跳过`);
                        delete c[attr];
                    } else if (Math.abs(delta) > 100) {
                        warnings.push(`属性变更 ${attr}${delta} 幅度过大，已限制为±100`);
                        c[attr] = Math.sign(delta) * 100;
                    }
                }
                if (Object.keys(c).length > 0) validated.push(change);
                break;
            }
            case 'add_item': {
                if (!change.name) { warnings.push('add_item 缺少 name，已跳过'); break; }
                validated.push(change);
                break;
            }
            case 'remove_item': {
                if (!change.name) { warnings.push('remove_item 缺少 name，已跳过'); break; }
                const exists = saveData.inventory.items.find(i => i.name === change.name);
                if (!exists) { warnings.push(`remove_item: 背包中没有"${change.name}"，已跳过`); break; }
                validated.push(change);
                break;
            }
            case 'update_gold': {
                if (typeof change.amount !== 'number') { warnings.push('update_gold 的 amount 不是数字，已跳过'); break; }
                if (Math.abs(change.amount) > 10000) { warnings.push('金币变更幅度过大，已限制'); change.amount = Math.sign(change.amount) * 10000; }
                validated.push(change);
                break;
            }
            case 'move_to_location': {
                if (!change.location_name) { warnings.push('move_to_location 缺少 location_name，已跳过'); break; }
                validated.push(change);
                break;
            }
            default:
                validated.push(change);
        }
    }

    return { validated, warnings };
}

// ===================================================================
// ===== 5. 管线编排器（Pipeline Orchestrator） =====
// ===================================================================

/**
 * 执行完整的 GM 管线
 * @param {object} saveData - 存档数据
 * @param {string} userMessage - 用户消息
 * @param {object} apiConfig - API 配置 { apiKey, apiBaseUrl, model, temperature, maxTokens }
 * @param {object} appConfig - 应用配置
 * @returns {object} { content, options, notifications, saveData }
 */
async function runGMPipeline(saveData, userMessage, apiConfig, appConfig) {
    const { apiKey, apiBaseUrl, model } = apiConfig;
    const allNotifications = [];

    // ===== Phase 1: StoryAgent — 生成剧情 =====
    const saPrompt = buildStoryAgentPrompt(saveData, appConfig);
    const saHistory = buildMessageHistory(saveData.chatHistory);
    const saMessages = [
        { role: 'system', content: saPrompt },
        ...saHistory,
    ];

    let saResult;
    try {
        saResult = await callLLM(apiBaseUrl, apiKey, model, saMessages, null, {
            temperature: apiConfig.temperature || 0.9,
            max_tokens: apiConfig.maxTokens || 2048,
        });
    } catch (err) {
        // SA 失败，降级为简单回复
        return {
            content: [{ type: 'narrative', text: '（剧情生成失败，请重试）' }],
            options: [{ text: '继续', action: '继续' }],
            notifications: [{ text: '⚠️ 剧情生成失败: ' + err.message, type: 'negative' }],
            saveData,
        };
    }

    // 解析 SA 输出
    const saOutput = parseAgentJSON(saResult.content);
    const content = saOutput.content || [{ type: 'narrative', text: saResult.content }];
    const options = saOutput.options || [];
    const worldChanges = saOutput.world_changes || {};

    // ===== Phase 2: RoleAgent — 处理角色（可并行） =====
    const characterRequests = content.filter(b => b.type === 'character_request');
    const newCharacters = worldChanges.new_characters || [];

    let characterReactions = [];
    let charactersCreated = [];

    if (characterRequests.length > 0 || newCharacters.length > 0) {
        const raResult = await runRoleAgent(saveData, characterRequests, newCharacters, apiConfig, allNotifications);
        characterReactions = raResult.reactions;
        charactersCreated = raResult.created;
    }

    // ===== Phase 3: MapAgent — 处理地点（可并行） =====
    const newLocations = worldChanges.new_locations || [];
    if (newLocations.length > 0) {
        const maResult = await runMapAgent(saveData, newLocations, apiConfig, allNotifications);
        // MA 可能会修正地点数据
    } else {
        // 即使 SA 没有显式标记新地点，也检查剧情中是否隐含了地点变更
        await runMapAgent(saveData, [], apiConfig, allNotifications);
    }

    // ===== Phase 4: PropertyAgent — 执行属性变更 =====
    const propertyChanges = worldChanges.property_changes || [];
    if (propertyChanges.length > 0) {
        const paResult = runPropertyAgent(propertyChanges, saveData);
        if (paResult.warnings.length > 0) {
            paResult.warnings.forEach(w => allNotifications.push({ text: '⚠️ ' + w, type: 'info' }));
        }
        if (paResult.notifications.length > 0) {
            allNotifications.push(...paResult.notifications);
        }
    }

    // ===== Phase 5: 合并输出 =====
    // 将 character_request 替换为实际的 character 类型
    const finalContent = [];
    for (const block of content) {
        if (block.type === 'character_request') {
            // 查找对应的角色反应
            const reaction = characterReactions.find(r => r.characterName === block.characterName);
            if (reaction) {
                finalContent.push({
                    type: 'character',
                    characterId: reaction.characterId,
                    characterName: reaction.characterName,
                    reaction: reaction.reaction,
                    dialogue: reaction.dialogue,
                    mood: reaction.mood,
                });
            }
            // 如果没有找到反应，跳过（角色可能不存在）
        } else {
            finalContent.push(block);
        }
    }

    return {
        content: finalContent,
        options,
        notifications: allNotifications,
        saveData,
    };
}

// ===================================================================
// ===== RoleAgent 执行器 =====
// ===================================================================
async function runRoleAgent(saveData, characterRequests, newCharacters, apiConfig, allNotifications) {
    const reactions = [];
    const created = [];

    // 先创建新角色
    for (const charDef of newCharacters) {
        if (!saveData.characters) saveData.characters = {};
        const existing = Object.values(saveData.characters).find(c => c.name === charDef.name);
        if (!existing) {
            const result = executeGameFunction('create_character', {
                name: charDef.name,
                role: charDef.role || 'custom',
                personality: charDef.personality || '',
                speech_style: charDef.speech_style || '',
                appearance: charDef.appearance || '',
                background: charDef.background || '',
                motivation: charDef.motivation || '',
                secrets: charDef.secrets || '',
                extra: charDef.extra || {},
            }, saveData);
            if (result.success) {
                created.push(result.characterData);
                if (result.notifications) allNotifications.push(...result.notifications);
            }
        }
    }

    // 处理角色反应请求
    for (const req of characterRequests) {
        const character = Object.values(saveData.characters || {}).find(c => c.name === req.characterName);
        if (!character) {
            // 角色不存在，跳过
            continue;
        }

        // 调用角色AI获取反应
        const reaction = await getCharacterReaction(character, req.context, saveData, apiConfig);
        if (reaction) {
            reactions.push(reaction);
        }
    }

    return { reactions, created };
}

// ===================================================================
// ===== MapAgent 执行器 =====
// ===================================================================
async function runMapAgent(saveData, newLocations, apiConfig, allNotifications) {
    for (const locDef of newLocations) {
        if (!saveData.map.locations[locDef.name]) {
            const result = executeGameFunction('move_to_location', {
                location_name: locDef.name,
                description: locDef.description,
                connections: locDef.connections || [],
            }, saveData);
            if (result.notifications) allNotifications.push(...result.notifications);
        }
    }
    return { success: true };
}

// ===================================================================
// ===== PropertyAgent 执行器 =====
// ===================================================================
function runPropertyAgent(propertyChanges, saveData) {
    const { validated, warnings } = validatePropertyChanges(propertyChanges, saveData);
    const notifications = [];

    for (const change of validated) {
        let result;
        switch (change.type) {
            case 'update_attributes':
                result = executeGameFunction('update_attributes', {
                    changes: change.changes,
                    reason: change.reason || '剧情事件',
                }, saveData);
                break;
            case 'add_item':
                result = executeGameFunction('add_item', {
                    name: change.name,
                    type: change.item_type || change.type || 'misc',
                    description: change.description || '',
                    quantity: change.quantity || 1,
                    effects: change.effects || {},
                    rarity: change.rarity || 'common',
                }, saveData);
                break;
            case 'remove_item':
                result = executeGameFunction('remove_item', {
                    name: change.name,
                    quantity: change.quantity || 1,
                    reason: change.reason || '使用',
                }, saveData);
                break;
            case 'update_gold':
                result = executeGameFunction('update_gold', {
                    amount: change.amount,
                    reason: change.reason || '剧情事件',
                }, saveData);
                break;
            case 'move_to_location':
                result = executeGameFunction('move_to_location', {
                    location_name: change.location_name,
                    description: change.description,
                    connections: change.connections,
                }, saveData);
                break;
            case 'add_status_effect':
                result = executeGameFunction('add_status_effect', {
                    name: change.name,
                    duration: change.duration || 3,
                    effect: change.effect || '',
                }, saveData);
                break;
            case 'remove_status_effect':
                result = executeGameFunction('remove_status_effect', { name: change.name }, saveData);
                break;
            case 'equip_item':
                result = executeGameFunction('equip_item', { name: change.name, equip: change.equip !== false }, saveData);
                break;
            case 'create_npc':
                result = executeGameFunction('create_npc', { name: change.name, description: change.description || '' }, saveData);
                break;
            case 'remove_npc':
                result = executeGameFunction('remove_npc', { name: change.name, reason: change.reason || '' }, saveData);
                break;
            case 'check_death':
                result = executeGameFunction('check_death', {}, saveData);
                break;
            case 'update_relationship':
                result = executeGameFunction('update_relationship', {
                    character_name: change.character_name,
                    delta: change.delta || 0,
                    reason: change.reason || '',
                }, saveData);
                break;
            default:
                warnings.push(`未知的属性变更类型: ${change.type}`);
        }
        if (result && result.notifications) notifications.push(...result.notifications);
    }

    return { validated, warnings, notifications };
}

// ===================================================================
// ===== 角色AI调用（从原 handleGetCharacterReaction 迁移） =====
// ===================================================================
async function getCharacterReaction(character, context, saveData, apiConfig) {
    const { apiKey, apiBaseUrl, model } = apiConfig;

    const charPrompt = buildCharacterPrompt(character, saveData);
    const charMessages = [
        { role: 'system', content: charPrompt },
        { role: 'user', content: `情境：${context}\n\n请给出你的反应和回应。` },
    ];

    let response;
    let retries = 0;
    while (retries < 2) {
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 60000);
            response = await fetch(apiBaseUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                body: JSON.stringify({
                    model, messages: charMessages, tools: characterTools,
                    temperature: 0.7, max_tokens: 1024, stream: true,
                }),
                signal: controller.signal,
            });
            clearTimeout(timer);
            break;
        } catch (err) {
            retries++;
            if (retries >= 2) return null;
            await new Promise(r => setTimeout(r, 1000 * retries));
        }
    }

    if (!response || !response.ok) return null;

    let result;
    try {
        result = await parseStreamResponse(response);
    } catch (err) {
        return null;
    }

    // 处理角色AI的 tool calls
    if (result.tool_calls && result.tool_calls.length > 0) {
        for (const tc of result.tool_calls) {
            let fnArgs;
            try { fnArgs = JSON.parse(tc.function.arguments); } catch (e) { fnArgs = {}; }
            executeCharacterTool(tc.function.name, fnArgs, character, saveData);
        }
    }

    let charReaction = { reaction: '', dialogue: '', mood: 'neutral' };
    try {
        const jsonMatch = result.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) charReaction = { ...charReaction, ...JSON.parse(jsonMatch[0]) };
    } catch (e) {
        charReaction.dialogue = result.content;
    }

    return {
        characterId: character.id,
        characterName: character.name,
        reaction: charReaction.reaction || '',
        dialogue: charReaction.dialogue || '',
        mood: charReaction.mood || 'neutral',
    };
}

// ===================================================================
// ===== 角色AI Prompt（从 aiService.js 迁移） =====
// ===================================================================
function buildCharacterPrompt(character, saveData) {
    const p = saveData.player;
    const inv = saveData.inventory || { items: [] };

    let personaLines = [];
    if (character.appearance) personaLines.push(`- 外貌：${character.appearance}`);
    if (character.personality) personaLines.push(`- 性格：${character.personality}`);
    if (character.speechStyle) personaLines.push(`- 说话风格：${character.speechStyle}`);
    if (character.background) personaLines.push(`- 背景：${character.background}`);
    if (character.motivation) personaLines.push(`- 动机：${character.motivation}`);
    if (character.secrets) personaLines.push(`- 秘密：${character.secrets}`);
    const personaStr = personaLines.join('\n') || '（未设定详细人设）';

    let memoryStr = '（暂无记忆）';
    if (character.memories && character.memories.length > 0) {
        memoryStr = character.memories.slice(-20).map(m =>
            `- 第${m.turn}回合：${m.text}${m.type ? ` [${m.type}]` : ''}`
        ).join('\n');
    }

    let extraStr = '';
    if (character.extra && Object.keys(character.extra).length > 0) {
        extraStr = '\n\n## 你的特有能力与信息\n' + formatObjectRecursive(character.extra, 0);
    }

    const inventoryStr = inv.items.length > 0
        ? inv.items.map(i => `${i.name}${i.quantity > 1 ? 'x' + i.quantity : ''}`).join('、')
        : '空';

    return `# 角色身份
你是"${character.name}"，${character.role}。你不是在扮演一个角色，你就是${character.name}本人。

# 人设
${personaStr}

# 与玩家的关系
- 关系值：${character.relationship.value}/100（${character.relationship.title}）

# 你的记忆
${memoryStr}
${extraStr}

# 当前情境
- 玩家：${p.name}${p.level ? '，Lv.' + p.level : ''}
- 位置：${saveData.map?.currentLocation || '未知'}
- 玩家状态：HP ${p.attributes?.hp?.current ?? '?'}/${p.attributes?.hp?.max ?? '?'}
- 玩家背包：${inventoryStr}

# 你的任务
请给出你对当前情境的真实反应。

返回 JSON（不要输出任何其他内容）：
{
    "reaction": "你的动作、表情、肢体语言（第三人称，生动有画面感）",
    "dialogue": "你说的话（第一人称，符合你的说话风格）",
    "mood": "当前心情（happy/angry/sad/suspicious/nervous/excited等）"
}`;
}

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
        return Object.entries(obj).map(([key, val]) => {
            if (typeof val === 'object' && val !== null) return `\n${indent}${key}：${formatObjectRecursive(val, depth + 1)}`;
            return `\n${indent}${key}：${val}`;
        }).join('');
    }
    return String(obj);
}

// ===================================================================
// ===== 对话历史管理（从 aiService.js 迁移） =====
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

    return [
        { role: 'system', content: `以下是之前冒险的摘要：\n${summaryParts.join('\n')}\n\n以最近的对话内容为准。` },
        ...recent,
    ];
}

// ===================================================================
// ===== LLM 调用辅助 =====
// ===================================================================
const characterTools = [
    {
        type: 'function',
        function: {
            name: 'update_relationship',
            description: '根据互动内容调整你与玩家的关系值。',
            parameters: {
                type: 'object',
                properties: {
                    delta: { type: 'number' },
                    reason: { type: 'string' },
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
                    text: { type: 'string' },
                    type: { type: 'string', enum: ['favor', 'conflict', 'secret', 'info', 'quest'] },
                },
                required: ['text'],
            },
        },
    },
];

async function callLLM(apiBaseUrl, apiKey, model, messages, tools, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 90000);

    try {
        const response = await fetch(apiBaseUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
            body: JSON.stringify({
                model,
                messages,
                tools: tools || undefined,
                temperature: options.temperature || 0.9,
                max_tokens: options.max_tokens || 2048,
                stream: true,
            }),
            signal: controller.signal,
        });
        clearTimeout(timer);

        if (!response.ok) {
            const errText = await response.text().catch(() => '');
            throw new Error(`AI 请求失败 (${response.status}): ${errText}`);
        }

        return await parseStreamResponse(response);
    } catch (err) {
        clearTimeout(timer);
        // 流式失败，尝试非流式
        try {
            const response = await fetch(apiBaseUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                body: JSON.stringify({
                    model, messages, tools: tools || undefined,
                    temperature: options.temperature || 0.9,
                    max_tokens: options.max_tokens || 2048,
                    stream: false,
                }),
            });
            if (!response.ok) throw new Error(`AI 请求失败 (${response.status})`);
            const data = await response.json();
            const choice = data.choices?.[0];
            if (!choice) throw new Error('AI 返回了空响应');
            return { content: choice.message?.content || '', tool_calls: choice.message?.tool_calls || null };
        } catch (fallbackErr) {
            throw fallbackErr;
        }
    }
}

async function parseStreamResponse(response) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '', content = '', toolCalls = [], currentToolCallIndex = -1;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const events = buffer.split('\n\n');
            buffer = events.pop() || '';
            for (const event of events) {
                for (const line of event.split('\n')) {
                    const trimmed = line.trim();
                    if (!trimmed || !trimmed.startsWith('data: ')) continue;
                    const data = trimmed.slice(6);
                    if (data === '[DONE]') continue;
                    try {
                        const parsed = JSON.parse(data);
                        const delta = parsed.choices?.[0]?.delta;
                        if (!delta) continue;
                        if (delta.content) content += delta.content;
                        if (delta.tool_calls) {
                            for (const tc of delta.tool_calls) {
                                if (tc.index !== undefined && tc.index !== currentToolCallIndex) {
                                    currentToolCallIndex = tc.index;
                                    toolCalls.push({ id: tc.id || ('call_' + Date.now() + '_' + tc.index), type: 'function', function: { name: tc.function?.name || '', arguments: '' } });
                                }
                                if (tc.id) toolCalls[currentToolCallIndex].id = tc.id;
                                if (tc.function?.name) toolCalls[currentToolCallIndex].function.name = tc.function.name;
                                if (tc.function?.arguments) toolCalls[currentToolCallIndex].function.arguments += tc.function.arguments;
                            }
                        }
                    } catch (e) {}
                }
            }
        }
    } finally { reader.releaseLock(); }
    return { content, tool_calls: toolCalls.length > 0 ? toolCalls : null };
}

function parseAgentJSON(rawContent) {
    try {
        const parsed = JSON.parse(rawContent);
        return parsed;
    } catch (e) {}

    const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
        try { return JSON.parse(jsonMatch[0]); } catch (e) {}
    }

    return { content: [{ type: 'narrative', text: rawContent }], options: [], world_changes: {} };
}

module.exports = { runGMPipeline, buildStoryAgentPrompt, buildMessageHistory, parseAgentJSON };
