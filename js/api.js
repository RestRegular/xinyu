// ===================================================================
// ===== DeepSeek API 接口层 =====
// ===================================================================
async function callAI(userText) {
    const systemPrompt = buildSystemPrompt();
    const history = buildMessageHistory();

    const messages = [
        { role: 'system', content: systemPrompt },
        ...history,
    ];

    let loopCount = 0;
    while (loopCount < MAX_TOOL_CALL_LOOPS) {
        loopCount++;

        const response = await fetch(appConfig.apiBaseUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${appConfig.apiKey}`,
            },
            body: JSON.stringify({
                model: appConfig.model,
                messages,
                tools: gameTools,
                temperature: appConfig.temperature,
                max_tokens: appConfig.maxTokens,
                stream: true,
            }),
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`API错误 (${response.status}): ${errText}`);
        }

        const result = await processStreamResponse(response);
        messages.push({ role: 'assistant', content: result.content, tool_calls: result.tool_calls });

        if (result.tool_calls && result.tool_calls.length > 0) {
            // 处理 tool calls
            for (const tc of result.tool_calls) {
                const fnName = tc.function.name;
                let fnArgs;
                try { fnArgs = JSON.parse(tc.function.arguments); } catch(e) { fnArgs = {}; }

                const toolResult = executeGameFunction(fnName, fnArgs);
                messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(toolResult) });
            }
            // 继续循环让AI生成最终叙述
            continue;
        }

        // 没有更多 tool calls，结束
        break;
    }
}

async function processStreamResponse(response) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    let toolCalls = [];
    let currentToolCallIndex = -1;

    removeTypingIndicator();

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data: ')) continue;
            const data = trimmed.slice(6);
            if (data === '[DONE]') continue;

            try {
                const parsed = JSON.parse(data);
                const delta = parsed.choices?.[0]?.delta;
                if (!delta) continue;

                if (delta.content) {
                    content += delta.content;
                    appendToLastAssistantMessage(content);
                }

                if (delta.tool_calls) {
                    for (const tc of delta.tool_calls) {
                        if (tc.index !== undefined && tc.index !== currentToolCallIndex) {
                            currentToolCallIndex = tc.index;
                            toolCalls.push({
                                id: tc.id || '',
                                type: 'function',
                                function: { name: tc.function?.name || '', arguments: '' },
                            });
                        }
                        if (tc.function?.name) {
                            toolCalls[currentToolCallIndex].function.name = tc.function.name;
                        }
                        if (tc.function?.arguments) {
                            toolCalls[currentToolCallIndex].function.arguments += tc.function.arguments;
                        }
                    }
                }
            } catch(e) {
                // 解析错误，跳过
            }
        }
    }

    // 保存最终内容到 chatHistory
    if (content) {
        // 更新最后一条 assistant 消息
        const last = currentSave.chatHistory[currentSave.chatHistory.length - 1];
        if (last && last.role === 'assistant') {
            last.content = content;
        } else {
            currentSave.chatHistory.push({ role: 'assistant', content });
        }
    }

    return { content, tool_calls: toolCalls.length > 0 ? toolCalls : null };
}

// ===================================================================
// ===== System Prompt 构建 =====
// ===================================================================
function buildSystemPrompt() {
    const s = currentSave;
    const p = s.player;
    const loc = s.map.locations[s.map.currentLocation];
    const inv = s.inventory;

    const narrativeHint = {
        concise: '每次回复控制在50-150字之间',
        medium: '每次回复控制在100-300字之间',
        detailed: '每次回复控制在200-500字之间，详细描述环境和心理',
    }[appConfig.ui.narrativeLength || 'medium'];

    const inventoryStr = inv.items.length > 0
        ? inv.items.map(i => `${i.name}${i.quantity > 1 ? 'x' + i.quantity : ''}(${i.type})`).join('、')
        : '无';

    const statusStr = p.statusEffects.length > 0
        ? p.statusEffects.map(e => `${e.name}(${e.duration > 0 ? e.duration + '回合' : '永久'}: ${e.effect})`).join('、')
        : '无';

    return `# 角色设定
你是一位经验丰富的文字冒险游戏主持人（Game Master）。你正在主持一个名为"${s.world.name}"的冒险故事。

## 世界观
类型：${s.world.genre}
描述：${s.world.description}
特殊规则：${s.world.rules || '无特殊规则'}
叙事基调：${s.world.tone}

## 玩家角色
名称：${p.name}
描述：${p.description || '无详细描述'}
等级：${p.level}

## 当前状态
- 位置：${s.map.currentLocation}
- 回合数：${s.stats.turnCount}
- 生命值：${p.attributes.hp.current}/${p.attributes.hp.max}
- 魔力值：${p.attributes.mp.current}/${p.attributes.mp.max}
- 攻击力：${p.attributes.attack.current}
- 防御力：${p.attributes.defense.current}
- 敏捷：${p.attributes.agility.current}
- 幸运：${p.attributes.luck.current}
- 金币：${inv.gold}
- 背包物品：${inventoryStr}
- 状态效果：${statusStr}

## 当前位置信息
${loc ? loc.description : '未知区域'}
可前往：${loc?.connections?.join('、') || '无已知路径'}

## 你的职责
1. 以第二人称叙述剧情，用生动、沉浸的语言描述场景和事件
2. 根据玩家的行动合理推进剧情
3. 当玩家的行动涉及战斗、获取物品、移动位置、使用物品、金币变化等操作时，你必须通过调用相应的工具函数来执行
4. 保持叙事的连贯性和一致性
5. 根据叙事基调"${s.world.tone}"调整语言风格

## 重要规则
- 你不能直接修改玩家的属性、物品或位置，必须通过工具函数来操作
- 叙述中不要出现明显的游戏术语（如"HP减少了10"），而是用自然语言描述（如"利刃划过你的手臂，鲜血渗出"）
- ${narrativeHint}
- 当玩家面临选择时，可以在叙述末尾暗示可能的行动方向
- 如果玩家的行动不可能实现，用合理的方式在剧情中解释原因
- 战斗时需要调用工具函数计算伤害，不要自行决定结果
- 当玩家使用[使用物品]、[移动]等指令时，务必调用对应工具函数`.trim();
}

function buildMessageHistory() {
    const history = currentSave.chatHistory || [];
    // 只取 user/assistant/system 消息，过滤 notification
    const filtered = history.filter(m => ['user', 'assistant', 'system'].includes(m.role));

    if (filtered.length <= SUMMARIZE_THRESHOLD) return filtered;

    // 摘要压缩
    const recent = filtered.slice(-20);
    const old = filtered.slice(0, -20);
    const summary = old.map(m => `${m.role === 'user' ? '玩家' : m.role === 'assistant' ? 'GM' : '系统'}: ${m.content}`).join('\n');

    return [
        { role: 'system', content: `以下是之前冒险的摘要（已压缩）：\n${summary}` },
        ...recent,
    ];
}

// ===================================================================
// ===== Function Calling 工具定义 =====
// ===================================================================
const gameTools = [
    {
        type: 'function',
        function: {
            name: 'update_attributes',
            description: '更新玩家的属性值（如HP、MP、攻击力、经验值等）。在战斗受伤、使用药水、升级等场景调用。',
            parameters: {
                type: 'object',
                properties: {
                    changes: {
                        type: 'object',
                        description: '属性变更，键为属性名(hp/mp/attack/defense/agility/luck/experience)，值为变更量（正数增加，负数减少）',
                    },
                    reason: { type: 'string', description: '变更原因' },
                },
                required: ['changes', 'reason'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'add_item',
            description: '向玩家背包中添加物品。在玩家拾取、购买、获得奖励等场景调用。',
            parameters: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: '物品名称' },
                    type: { type: 'string', enum: ['weapon', 'armor', 'consumable', 'key', 'quest', 'misc'], description: '物品类型' },
                    description: { type: 'string', description: '物品描述' },
                    quantity: { type: 'number', description: '数量，默认1' },
                    effects: { type: 'object', description: '物品效果，如 {"hp": 30, "attack": 5}' },
                    rarity: { type: 'string', enum: ['common', 'uncommon', 'rare', 'legendary'], description: '稀有度' },
                },
                required: ['name', 'type', 'description'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'remove_item',
            description: '从玩家背包中移除物品。在使用消耗品、丢弃、交易等场景调用。',
            parameters: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: '物品名称' },
                    quantity: { type: 'number', description: '移除数量，默认1' },
                    reason: { type: 'string', description: '移除原因' },
                },
                required: ['name', 'reason'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'move_to_location',
            description: '将玩家移动到新位置。在玩家前往新地点时调用。',
            parameters: {
                type: 'object',
                properties: {
                    location_name: { type: 'string', description: '目标地点名称' },
                    description: { type: 'string', description: '新地点的描述（如果是首次发现）' },
                    connections: { type: 'array', items: { type: 'string' }, description: '新地点可前往的相邻地点列表' },
                },
                required: ['location_name'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'add_status_effect',
            description: '给玩家添加状态效果（如中毒、灼烧、祝福等）。',
            parameters: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: '状态效果名称' },
                    duration: { type: 'number', description: '持续回合数，-1表示永久' },
                    effect: { type: 'string', description: '效果描述' },
                },
                required: ['name', 'duration', 'effect'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'remove_status_effect',
            description: '移除玩家的状态效果。',
            parameters: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: '要移除的状态效果名称' },
                },
                required: ['name'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'update_gold',
            description: '更新玩家的金币数量。',
            parameters: {
                type: 'object',
                properties: {
                    amount: { type: 'number', description: '变更量（正数获得，负数花费）' },
                    reason: { type: 'string', description: '变更原因' },
                },
                required: ['amount', 'reason'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'check_death',
            description: '检查玩家是否死亡（HP降至0或以下）。在战斗或危险事件后调用。',
            parameters: { type: 'object', properties: {} },
        },
    },
];
