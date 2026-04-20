// ===================================================================
// ===== DeepSeek API 接口层（完善版） =====
// ===================================================================

const API_TIMEOUT = 60000;       // 请求超时 60秒
const MAX_RETRIES = 2;           // 最大重试次数
const RETRY_DELAY = 1000;        // 重试延迟 1秒

// ----- 错误分类 -----
function classifyError(status, body) {
    // 后端代理错误格式
    if (body && body.error && typeof body.error === 'string') {
        return { type: 'proxy', message: body.error };
    }
    if (status === 401) return { type: 'auth', message: 'API Key 无效或已过期，请在设置中检查' };
    if (status === 402 || status === 403) return { type: 'quota', message: 'API 余额不足，请充值后重试' };
    if (status === 429) return { type: 'rate_limit', message: '请求过于频繁，请稍后再试' };
    if (status === 500 || status === 502 || status === 503) return { type: 'server', message: 'AI 服务暂时不可用，正在重试...' };
    if (status === 400) {
        try {
            const err = JSON.parse(body);
            return { type: 'bad_request', message: `请求参数错误: ${err.error?.message || body}` };
        } catch(e) {
            return { type: 'bad_request', message: `请求参数错误 (${status})` };
        }
    }
    if (!status) return { type: 'network', message: '网络连接失败，请检查网络设置' };
    return { type: 'unknown', message: `API 错误 (${status}): ${body.slice(0, 200)}` };
}

function isRetryable(errorType) {
    return ['rate_limit', 'server', 'network'].includes(errorType);
}

// ----- 带超时的 fetch -----
async function fetchWithTimeout(url, options, timeout = API_TIMEOUT) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(timer);
        return response;
    } catch(e) {
        clearTimeout(timer);
        if (e.name === 'AbortError') throw { type: 'timeout', message: '请求超时，AI 响应时间过长' };
        throw { type: 'network', message: '网络连接失败，请检查网络设置' };
    }
}

// ----- 带重试的 API 请求 -----
async function callAI(userText) {
    const systemPrompt = buildSystemPrompt();
    const history = buildMessageHistory();

    const messages = [
        { role: 'system', content: systemPrompt },
        ...history,
    ];

    let loopCount = 0;
    let lastError = null;

    while (loopCount < MAX_TOOL_CALL_LOOPS) {
        loopCount++;

        // 尝试请求（含重试）
        let response;
        let retries = 0;
        while (true) {
            try {
                response = await fetchWithTimeout('/api/ai/chat', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        messages,
                        tools: gameTools,
                        temperature: appConfig.temperature,
                        max_tokens: appConfig.maxTokens,
                    }),
                });
                break; // 请求成功
            } catch(err) {
                lastError = err;
                const errType = err.type || 'unknown';

                if (!isRetryable(errType) || retries >= MAX_RETRIES) {
                    throw new Error(err.message || '请求失败');
                }

                retries++;
                addNotification(`请求失败，正在重试 (${retries}/${MAX_RETRIES})...`, 'info');
                await new Promise(r => setTimeout(r, RETRY_DELAY * retries));
            }
        }

        // 检查 HTTP 状态码
        if (!response.ok) {
            const errText = await response.text().catch(() => '');
            const errInfo = classifyError(response.status, errText);
            if (isRetryable(errInfo.type) && loopCount <= 1) {
                addNotification(errInfo.message, 'info');
                await new Promise(r => setTimeout(r, RETRY_DELAY));
                continue;
            }
            throw new Error(errInfo.message);
        }

        // 处理流式响应
        let result;
        try {
            result = await processStreamResponse(response);
        } catch(err) {
            // 流式解析失败，尝试非流式降级
            addNotification('流式响应异常，尝试重新获取...', 'info');
            try {
                result = await processNonStreamResponse(messages);
            } catch(fallbackErr) {
                throw new Error(fallbackErr.message || '响应解析失败');
            }
        }

        // 记录 assistant 消息
        const assistantMsg = { role: 'assistant', content: result.content };
        if (result.tool_calls) {
            assistantMsg.tool_calls = result.tool_calls;
        }
        messages.push(assistantMsg);

        // 处理 tool calls
        if (result.tool_calls && result.tool_calls.length > 0) {
            addNotification('⚙ 游戏系统处理中...', 'info');

            for (const tc of result.tool_calls) {
                const fnName = tc.function.name;
                let fnArgs;
                try { fnArgs = JSON.parse(tc.function.arguments); } catch(e) {
                    fnArgs = {};
                }

                const toolResult = executeGameFunction(fnName, fnArgs);
                messages.push({
                    role: 'tool',
                    tool_call_id: tc.id,
                    content: JSON.stringify(toolResult),
                });
            }
            // 继续循环让 AI 生成最终叙述
            continue;
        }

        // 没有更多 tool calls，结束
        break;
    }
}

// ----- 流式响应解析 -----
async function processStreamResponse(response) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    let toolCalls = [];
    let currentToolCallIndex = -1;

    removeTypingIndicator();

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            // 按双换行分割 SSE 事件
            const events = buffer.split('\n\n');
            buffer = events.pop() || ''; // 保留最后一个可能不完整的事件

            for (const event of events) {
                const lines = event.split('\n');
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || !trimmed.startsWith('data: ')) continue;
                    const data = trimmed.slice(6);
                    if (data === '[DONE]') continue;

                    try {
                        const parsed = JSON.parse(data);
                        const delta = parsed.choices?.[0]?.delta;
                        if (!delta) continue;

                        // 处理文本内容
                        if (delta.content) {
                            content += delta.content;
                            appendToLastAssistantMessage(content);
                        }

                        // 处理 tool_calls
                        if (delta.tool_calls) {
                            for (const tc of delta.tool_calls) {
                                if (tc.index !== undefined && tc.index !== currentToolCallIndex) {
                                    currentToolCallIndex = tc.index;
                                    toolCalls.push({
                                        id: tc.id || ('call_' + Date.now() + '_' + tc.index),
                                        type: 'function',
                                        function: { name: tc.function?.name || '', arguments: '' },
                                    });
                                }
                                if (tc.id) {
                                    toolCalls[currentToolCallIndex].id = tc.id;
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
                        // 单条 JSON 解析失败，跳过
                    }
                }
            }
        }
    } finally {
        reader.releaseLock();
    }

    // 保存最终内容到 chatHistory
    if (content) {
        const last = currentSave.chatHistory[currentSave.chatHistory.length - 1];
        if (last && last.role === 'assistant') {
            last.content = content;
        } else {
            currentSave.chatHistory.push({ role: 'assistant', content });
        }
    }

    return { content, tool_calls: toolCalls.length > 0 ? toolCalls : null };
}

// ----- 非流式降级 -----
async function processNonStreamResponse(messages) {
    const response = await fetchWithTimeout('/api/ai/chat/sync', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            messages,
            tools: gameTools,
            temperature: appConfig.temperature,
            max_tokens: appConfig.maxTokens,
        }),
    });

    if (!response.ok) {
        const errText = await response.text().catch(() => '');
        const errInfo = classifyError(response.status, errText);
        throw new Error(errInfo.message);
    }

    const data = await response.json();
    const choice = data.choices?.[0];
    if (!choice) throw new Error('AI 返回了空响应');

    const content = choice.message?.content || '';
    const toolCalls = choice.message?.tool_calls || null;

    // 显示内容
    removeTypingIndicator();
    if (content) {
        appendToLastAssistantMessage(content);
        const last = currentSave.chatHistory[currentSave.chatHistory.length - 1];
        if (last && last.role === 'assistant') {
            last.content = content;
        } else {
            currentSave.chatHistory.push({ role: 'assistant', content });
        }
    }

    return { content, tool_calls };
}

// ===================================================================
// ===== 世界类型预设模板 =====
// ===================================================================
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

// ===================================================================
// ===== System Prompt 构建（分层架构版） =====
// ===================================================================
function buildSystemPrompt() {
    const s = currentSave;
    const p = s.player;
    const loc = s.map.locations[s.map.currentLocation];
    const inv = s.inventory;
    const genre = s.world.genre || '自定义';
    const preset = GENRE_PRESETS[genre] || {};

    // === 第一层：基础角色设定（固定） ===
    const layerBase = `# 角色设定
你是一位才华横溢的文字冒险游戏主持人（Game Master），擅长沉浸式叙事。你正在主持"${s.world.name}"的冒险。`;

    // === 第二层：世界设定（来自存档 + 类型预设增强） ===
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

    // === 第三层：角色设定（来自存档） ===
    const layerCharacter = `## 玩家角色
- 名称：${p.name}
- 描述：${p.description || '无详细描述'}
- 等级：${p.level}（经验 ${p.experience || 0}/${p.experienceToNext || 100}）`;

    // === 第四层：当前情境（动态生成） ===
    const narrativeHint = {
        concise: '每次回复50-150字，简洁有力',
        medium: '每次回复100-300字，详略得当',
        detailed: '每次回复200-500字，充分描述环境、心理和细节',
    }[appConfig.ui.narrativeLength || 'medium'];

    const inventoryStr = inv.items.length > 0
        ? inv.items.map(i => {
            let str = i.name;
            if (i.quantity > 1) str += 'x' + i.quantity;
            str += '[' + i.type + ']';
            if (i.equipped) str += '(已装备)';
            if (i.effects && Object.keys(i.effects).length > 0) {
                str += '(' + Object.entries(i.effects).map(([k,v]) => k + (v>0?'+':'') + v).join(',') + ')';
            }
            return str;
        }).join('、')
        : '空';

    const statusStr = p.statusEffects.length > 0
        ? p.statusEffects.map(e => e.name + '[' + (e.duration > 0 ? e.duration + '回合' : '永久') + ']').join('、')
        : '无';

    const npcs = loc && loc.npcs && loc.npcs.length > 0 ? loc.npcs.join('、') : '无';

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
- 可前往：${loc && loc.connections ? loc.connections.join('、') : '无已知路径'}`;

    // === 第五层：行为规则（固定 + 自定义指令） ===
    const globalInstructions = appConfig.customInstructions || '';
    const saveInstructions = s.world.customPrompt || '';

    const layerRules = `## 你的职责
1. **沉浸式叙事**：用第二人称（"你"）叙述，语言生动、有画面感，让玩家身临其境
2. **合理推进**：根据玩家行动和世界观逻辑推进剧情，不要凭空创造矛盾
3. **状态管理**：所有涉及数值变化的操作必须通过工具函数执行
4. **NPC互动**：为NPC赋予鲜明的性格和说话方式，通过对话推动剧情
5. **战斗设计**：战斗要有策略性，描述动作和结果，通过工具函数计算伤害

## 工具函数使用指南
- 玩家受伤/治疗 → update_attributes（changes: {hp: -15}）
- 获得经验 → update_attributes（changes: {experience: +50}）
- 拾取/购买物品 → add_item
- 使用/消耗物品 → remove_item
- 移动到新地点 → move_to_location（新地点需提供 description 和 connections）
- 中毒/灼烧/祝福 → add_status_effect
- 治愈状态 → remove_status_effect
- 金币变化 → update_gold
- 战斗结束检查 → check_death
- 遇到新NPC → create_npc
- NPC离开 → remove_npc
- 装备/卸下 → equip_item
- 玩家死亡后复活 → revive_player

## 叙事规则
- ${narrativeHint}
- 不要使用游戏术语（如"HP-10"），用自然语言（如"利刃划过你的手臂"）
- 战斗时交替描述双方行动，不要一次性决定结果
- 在叙述末尾可以暗示可能的行动方向，但不要替玩家做决定
- 如果玩家尝试不可能的事，用剧情合理地解释原因
- 保持与之前剧情的连贯性，记住已发生的事件和NPC
${globalInstructions ? '\n## 玩家自定义指令（全局）\n' + globalInstructions : ''}
${saveInstructions ? '\n## 玩家自定义指令（本世界）\n' + saveInstructions : ''}`;

    // 组合所有层
    return [layerBase, layerWorld, layerCharacter, layerContext, layerRules].join('\n\n');
}

// ----- Prompt 预览 -----
function getPromptPreview() {
    if (!currentSave) return '请先加载存档';
    return buildSystemPrompt();
}

// ===================================================================
// ===== 对话历史管理（完善版） =====
// ===================================================================
function buildMessageHistory() {
    const history = currentSave.chatHistory || [];

    // 只保留 user/assistant 消息用于 API 上下文
    const filtered = history.filter(m => m.role === 'user' || m.role === 'assistant');

    if (filtered.length <= SUMMARIZE_THRESHOLD) return filtered;

    // 智能摘要：保留最近的消息，将早期消息压缩
    const keepRecent = 16;
    const recent = filtered.slice(-keepRecent);
    const old = filtered.slice(0, -keepRecent);

    // 生成结构化摘要
    const summaryParts = [];
    let currentSpeaker = '';
    let currentContent = '';

    for (const msg of old) {
        const speaker = msg.role === 'user' ? '玩家' : 'GM';
        if (speaker !== currentSpeaker) {
            if (currentContent) {
                summaryParts.push(`${currentSpeaker}: ${currentContent.slice(0, 100)}`);
            }
            currentSpeaker = speaker;
            currentContent = msg.content;
        } else {
            currentContent += '；' + msg.content;
        }
    }
    if (currentContent) {
        summaryParts.push(`${currentSpeaker}: ${currentContent.slice(0, 100)}`);
    }

    const summary = summaryParts.join('\n');

    return [
        { role: 'system', content: `以下是之前冒险的摘要（已压缩，仅供参考）：\n${summary}\n\n请注意：以上是早期对话的压缩版本，以最近的对话内容为准。` },
        ...recent,
    ];
}

// ===================================================================
// ===== Function Calling 工具定义（完善版） =====
// ===================================================================
const gameTools = [
    {
        type: 'function',
        function: {
            name: 'update_attributes',
            description: '更新玩家属性值。战斗受伤、使用药水恢复、升级等场景必须调用。',
            parameters: {
                type: 'object',
                properties: {
                    changes: {
                        type: 'object',
                        description: '属性变更对象，键为属性名，值为变更量（正增负减）',
                        properties: {
                            hp: { type: 'number', description: '生命值变更' },
                            mp: { type: 'number', description: '魔力值变更' },
                            attack: { type: 'number', description: '攻击力变更' },
                            defense: { type: 'number', description: '防御力变更' },
                            agility: { type: 'number', description: '敏捷变更' },
                            luck: { type: 'number', description: '幸运变更' },
                            experience: { type: 'number', description: '经验值变更' },
                        },
                    },
                    reason: { type: 'string', description: '变更原因（简短描述）' },
                },
                required: ['changes', 'reason'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'add_item',
            description: '向玩家背包添加物品。拾取、购买、获得奖励、NPC赠予等场景调用。',
            parameters: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: '物品名称' },
                    type: { type: 'string', enum: ['weapon', 'armor', 'consumable', 'key', 'quest', 'misc'], description: '物品类型' },
                    description: { type: 'string', description: '物品描述' },
                    quantity: { type: 'number', description: '数量' },
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
            description: '从背包移除物品。使用消耗品、交易、丢弃等场景调用。',
            parameters: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: '物品名称' },
                    quantity: { type: 'number', description: '移除数量' },
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
            description: '移动玩家到新位置。首次到达的新地点必须提供 description 和 connections。',
            parameters: {
                type: 'object',
                properties: {
                    location_name: { type: 'string', description: '目标地点名称' },
                    description: { type: 'string', description: '新地点描述（首次发现时必填）' },
                    connections: { type: 'array', items: { type: 'string' }, description: '新地点可前往的相邻地点（首次发现时必填）' },
                },
                required: ['location_name'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'add_status_effect',
            description: '添加状态效果。中毒、灼烧、祝福、虚弱等。',
            parameters: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: '状态名称' },
                    duration: { type: 'number', description: '持续回合数，-1为永久' },
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
            description: '移除状态效果。',
            parameters: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: '要移除的状态名称' },
                },
                required: ['name'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'update_gold',
            description: '更新金币数量。',
            parameters: {
                type: 'object',
                properties: {
                    amount: { type: 'number', description: '变更量（正获得负花费）' },
                    reason: { type: 'string', description: '原因' },
                },
                required: ['amount', 'reason'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'check_death',
            description: '检查玩家是否死亡。战斗或危险事件后必须调用。',
            parameters: { type: 'object', properties: {} },
        },
    },
    {
        type: 'function',
        function: {
            name: 'create_npc',
            description: '在当前位置创建一个NPC。遇到新角色时调用。',
            parameters: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: 'NPC名称' },
                    description: { type: 'string', description: 'NPC外貌和特征描述' },
                    personality: { type: 'string', description: 'NPC性格特点' },
                },
                required: ['name', 'description'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'remove_npc',
            description: '从当前位置移除一个NPC。NPC离开或死亡时调用。',
            parameters: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: 'NPC名称' },
                    reason: { type: 'string', description: '移除原因' },
                },
                required: ['name'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'equip_item',
            description: '装备或卸下物品。武器和护甲可以装备。',
            parameters: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: '物品名称' },
                    equip: { type: 'boolean', description: 'true为装备，false为卸下' },
                },
                required: ['name', 'equip'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'revive_player',
            description: '复活玩家。在玩家死亡后，被救活或复活时调用。恢复部分HP。',
            parameters: {
                type: 'object',
                properties: {
                    revive_location: { type: 'string', description: '复活地点名称' },
                    hp_percent: { type: 'number', description: '恢复HP百分比(0-100)，默认50' },
                },
                required: [],
            },
        },
    },
];
