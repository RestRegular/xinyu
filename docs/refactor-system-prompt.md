# 系统提示词重构方案

## 1. 现状分析

### 1.1 当前提示词结构

系统提示词由 `buildGmPrompt()`（`server/prompts/builders/gmPrompt.js`）通过五层模板组合生成：

```
gm_layer_base.txt      → 角色设定（1行）
gm_layer_world.txt     → 世界观（类型 + 描述 + 基调 + 规则 + 叙事技巧 + 物品风格）
gm_layer_character.txt → 玩家角色（名称/性别/年龄/身份/外貌/性格/背景/等级）
gm_layer_context.txt   → 当前状态 + 当前位置 + 重要角色
characterRules.js      → 角色交互规则 + 角色创建规则
toolRules.js           → 工具函数使用指南
outputFormatRules.js   → 输出格式 + 引号规则 + 工具返回规则 + 类型说明 + options + 叙事规则
customPrompt           → 玩家自定义指令（全局 + 本世界）
```

最终拼接顺序（`gmPrompt.js:83-126`）：

```
base → world → character → context → characterRules → toolRules → outputFormatRules → customPrompt
```

### 1.2 实例分析（185行）

对实际生成的提示词实例进行逐段分析，识别出以下问题：

---

## 2. 问题清单

### P0-1：提示词结构倒置，关键规则被淹没

**现象**：输出格式、工具规则、角色规则等"必须遵守"的指令被放在提示词后半段（第74-177行），而世界观描述等"参考信息"占据前段（第4-72行）。

**影响**：LLM 存在注意力衰减，末尾的叙事规则和自定义指令容易被忽略，导致：
- AI 经常忘记调用工具
- 自定义指令不被遵守
- JSON 输出格式不稳定

**相关代码**：`server/prompts/builders/gmPrompt.js:83-126`

---

### P0-2：规则内容大量重复，浪费 token

**现象**：

| 重复内容 | 位置A | 位置B | 浪费行数 |
|----------|-------|-------|----------|
| content 类型说明 | `outputFormatRules.js:4-17`（JSON示例中已包含类型） | `outputFormatRules.js:35-42`（再次逐条解释） | ~8行 |
| 工具映射表 | `toolRules.js:2-12`（核心原则逐条列举） | `toolRules.js:14-31`（再次完整映射） | ~18行 |
| 角色创建条件 | `characterRules.js:11-16`（4条条件） | `characterRules.js:17-20`（创建要求+示例） | 语义重叠 |
| 引号规则 | `outputFormatRules.js:7`（JSON示例中标注了引号） | `outputFormatRules.js:20-25`（单独一节讲引号） | ~6行 |

**影响**：约 30+ 行冗余，增加 token 消耗且可能造成 AI 困惑（同一规则出现两次，措辞略有不同）。

**相关代码**：`server/prompts/rules/toolRules.js`、`server/prompts/rules/outputFormatRules.js`

---

### P1-1：工具规则过于冗长，缺乏优先级

**现象**：`toolRules.js` 共 31 行，14 个工具的映射以"如果你写了X→必须调用Y"的句式逐条列举。

**影响**：
- AI 最容易遗漏的是"隐形"操作（update_gold、update_attributes），因为叙事中提到花钱/受伤很自然，但调用工具容易被忽略
- `create_location` 和 `move_to_location` 的区别不够清晰
- 核心红线（"绝对禁止只描述不调用"）淹没在 14 条映射中

**相关代码**：`server/prompts/rules/toolRules.js`

---

### P1-2：GM 输出格式中包含 player_action，存在角色替代表演风险

**现象**：`outputFormatRules.js:8` 的 JSON 示例中包含：

```json
{"type": "player_action", "text": "玩家的动作描写"}
```

**影响**：GM 可能自行生成 `player_action` 类型的内容块，替玩家决定行为。实际上 `player_action` 应该只由 UserAgent（`gmPipeline.js:594` 的 `runUserAgent()`）在选项模式下生成。

**相关代码**：`server/prompts/rules/outputFormatRules.js:8`

---

### P1-3：世界规则与预设规则覆盖冲突

**现象**：`gmPrompt.js:30` 的逻辑：

```javascript
const worldRules = s.world.rules || preset.worldRules || '无特殊规则';
```

用户填写的规则会完全覆盖预设规则。例如用户只写了"魔法体系分为光暗两系"，预设中的"战士、法师、游侠、牧师是常见职业"等有用信息就丢失了。

**相关代码**：`server/prompts/builders/gmPrompt.js:30`

---

### P2-1：角色分级标准不明确

**现象**：`characterRules.js` 存在逻辑冲突：

- 交互规则第6条："普通NPC（非重要角色列表中的）你可以自由描写"
- 创建规则："每一个有对话、有互动的NPC都必须调用 create_character"

**影响**：AI 无法判断哪些 NPC 需要创建、哪些可以自由描写。例如酒馆里5个背景客人，如果AI为每个人都调用 `create_character`，会产生大量无意义的角色数据。

**相关代码**：`server/prompts/rules/characterRules.js`

---

### P2-2：叙事规则过于简略

**现象**：`outputFormatRules.js:47-51` 仅 4 条规则：

```
- 每次回复100-300字，详略得当
- 不要使用游戏术语（如"HP-10"），用自然语言
- 战斗时交替描述双方行动
- 保持与之前剧情的连贯性
```

**影响**：缺少对叙事质量的指导，实际使用中容易出现：
- 每次回复都以"你看到..."开头，缺乏变化
- 战斗描写变成流水账
- 缺少感官描写
- 选项设计缺乏吸引力（如"继续前进/原地等待/回头离开"）

**相关代码**：`server/prompts/rules/outputFormatRules.js:47-51`

---

### P2-3：自定义指令位置不醒目

**现象**：`gmPrompt.js:78-80` 将自定义指令拼接到提示词最末尾，没有特殊标记。

**影响**：玩家精心编写的自定义指令（如"不要出现血腥内容"、"NPC说话要带口音"）容易被 AI 忽略。

**相关代码**：`server/prompts/builders/gmPrompt.js:78-80`

---

### P3-1：context 层缺少剧情进展摘要

**现象**：`gm_layer_context.txt` 只包含当前位置、状态、角色列表等静态信息，没有"最近发生了什么"的摘要。

**影响**：虽然 `buildMessageHistory()` 提供了最近 16 条对话历史，但系统提示词中缺少一个高层次的剧情进展概览，AI 在长对话中可能丢失对整体剧情线的把握。

**相关代码**：`server/prompts/templates/gm_layer_context.txt`

---

## 3. 重构方案

### 3.1 核心思路：结构重组 + 去重压缩

将提示词从当前的"信息平铺"重组为 **"核心指令前置 + 上下文居中 + 参考附录在后"** 的三层结构：

```
┌─────────────────────────────────────────────┐
│ 第一层：核心指令（AI 必须严格遵守）            │
│  - 角色设定（1-2行）                         │
│  - 输出格式（JSON + 类型速查）               │
│  - 工具调用红线 + 速查表                     │
│  - 角色交互红线 + 分级标准                   │
│  - 叙事规则                                 │
├─────────────────────────────────────────────┤
│ 第二层：动态上下文（当前游戏状态）             │
│  - 世界观                                   │
│  - 玩家角色                                 │
│  - 当前状态 + 位置 + 角色                   │
│  - 最近剧情进展（新增）                      │
├─────────────────────────────────────────────┤
│ 第三层：附录（按需参考）                      │
│  - 工具详细参数说明                          │
│  - 自定义指令（醒目标记）                    │
└─────────────────────────────────────────────┘
```

### 3.2 重构后的提示词模板

#### 3.2.1 新的 gm_layer_base.txt

```markdown
# 角色设定
你是一位才华横溢的文字角色扮演游戏主持人（Game Master），擅长沉浸式叙事。你正在主持"{{worldName}}"的冒险。

⚠️ 以下规则必须严格遵守，违反将导致游戏数据错误。
```

#### 3.2.2 新的 gm_layer_rules.txt（新建，替代散落的 rules 文件）

```markdown
## 输出格式
你的回复必须是合法 JSON，不要输出任何其他内容：
```json
{
  "content": [
    {"type": "narrative", "text": "剧情叙述（最常用）"},
    {"type": "scene", "text": "进入新地点时的场景描写"},
    {"type": "dialogue", "speaker": "说话者", "text": "对话内容"},
    {"type": "combat", "text": "战斗描写"},
    {"type": "loot", "text": "获得物品描写"},
    {"type": "character", "characterId": "char_xxx", "characterName": "角色名", "reaction": "反应", "dialogue": "对话", "mood": "心情"}
  ],
  "options": [
    {"text": "选项显示文本", "action": "玩家发送的实际文本"}
  ]
}
```

### 类型速查
| type | 用途 | 关键字段 |
|------|------|----------|
| narrative | 剧情叙述（最常用） | text |
| scene | 进入新地点的场景描写 | text |
| dialogue | 突出展示的对话 | speaker, text |
| combat | 战斗过程 | text |
| loot | 获得物品/金钱 | text |
| character | 重要角色反应（仅由工具返回） | characterId, characterName, reaction, dialogue, mood |

注意：player_action 类型由系统自动生成，GM 不要自行输出。

### 工具调用红线
1. 叙事中涉及数值变化（金币/HP/MP/物品/经验）→ 必须调用对应工具，否则数据不会实际改变
2. 涉及重要角色对话或互动 → 必须通过 get_character_reaction 获取反应，不可自己编造
3. 绝对禁止将工具返回的 JSON 写入 content 输出中

### 工具速查表
| 叙事场景 | 工具 | 备注 |
|----------|------|------|
| 金币增减 | update_gold | amount 正数=获得，负数=花费 |
| HP/MP/经验变化 | update_attributes | changes: {hp: -10} |
| 获得物品 | add_item | |
| 失去/使用物品 | remove_item | |
| 中毒/灼烧/祝福 | add_status_effect | |
| 装备/卸下装备 | equip_item | |
| 玩家移动到新地点 | move_to_location | 玩家实际到达 |
| 提到新地点（不移动） | create_location | 叙事中提及的地点都要创建 |
| 遇到背景NPC | create_npc | 无深度人设的NPC |
| 创建重要角色 | create_character | 有完整人设、独立AI的角色 |
| 获取角色反应 | get_character_reaction | 必须通过此工具 |
| 调整关系值 | update_relationship | |
| 角色执行动作 | character_action | |
| 战斗结束检查 | check_death | |
| 玩家死亡复活 | revive_player | |

### 角色分级标准
| 级别 | 创建方式 | 判定标准 | 示例 |
|------|----------|----------|------|
| 背景NPC | 不创建 | 仅环境点缀，无对话无互动无名字 | "酒馆里几个农夫低声交谈" |
| 可交互NPC | create_npc | 有名字，可简单互动，但无深度人设 | "酒馆老板娘玛莎" |
| 重要角色 | create_character | 有完整人设，可能多轮互动，影响剧情 | 玩家同伴、剧情关键人物 |

只有当 NPC 满足以下条件时才需要 create_character：
1. 玩家可能与其进行多轮对话
2. 该角色会影响剧情走向
3. 有独特的外貌、性格、说话风格等深度设定

创建时必须填写：name, role, personality, speech_style, appearance

### 角色交互规则
当场景中存在重要角色时：
1. 你只负责环境描写和剧情推进，绝不替重要角色做任何事
2. 不要描写重要角色的动作、表情、心理活动或对话
3. 将角色AI返回的 reaction 和 dialogue 原样嵌入你的叙述中
4. 普通NPC（背景NPC和可交互NPC）你可以自由描写

### 叙事规则
- 长度：100-300字，详略得当
- 语言：用自然语言，不要出现"HP-10"等游戏术语
- 开头变化：不要总是用"你看到/你感到"开头，尝试用动作、对话、环境音等切入
- 感官描写：适当加入视觉、听觉、嗅觉、触觉的感官细节
- 战斗：交替描述双方行动，注重节奏感和紧张感，不要流水账
- 对话：用中文双引号「""」包裹对话内容；narrative中的叙述不要用引号
- 选项：提供2-4个有实质差异的选择，避免无意义选项
- 连贯性：承接上文的情节和氛围，不要突然跳转
```

#### 3.2.3 新的 gm_layer_context.txt（追加剧情摘要）

```markdown
## 当前状态
- 位置：{{currentLocation}}
- 回合：{{turnCount}}
- HP：{{hpCurrent}}/{{hpMax}}
- MP：{{mpCurrent}}/{{mpMax}}
- 攻击：{{attackCurrent}} | 防御：{{defenseCurrent}}
- 敏捷：{{agilityCurrent}} | 幸运：{{luckCurrent}}
- 金币：{{gold}}
- 背包({{inventoryCount}}/{{maxSlots}})：{{inventoryInfo}}
- 状态效果：{{statusEffectsInfo}}

## 当前位置
{{locationDescription}}
- 此处NPC：{{npcsInfo}}
- 可前往：{{connectionsInfo}}

## 当前位置的重要角色
{{charactersInfo}}

## 最近剧情进展
{{recentPlotSummary}}
```

#### 3.2.4 自定义指令模板调整

```markdown
⚠️ 玩家自定义指令（必须遵守）
{{customInstructions}}
```

---

## 4. 代码变更清单

### 4.1 新建文件

| 文件 | 说明 |
|------|------|
| `server/prompts/templates/gm_layer_rules.txt` | 合并后的核心规则模板（替代散落的 rules） |

### 4.2 修改文件

| 文件 | 变更内容 |
|------|----------|
| `server/prompts/builders/gmPrompt.js` | 重构 `buildGmPrompt()`：调整拼接顺序、合并规则、追加剧情摘要、修改世界规则合并策略 |
| `server/prompts/templates/gm_layer_base.txt` | 精简，追加"必须严格遵守"标记 |
| `server/prompts/templates/gm_layer_context.txt` | 追加 `{{recentPlotSummary}}` 占位符 |
| `server/prompts/rules/characterRules.js` | 精简，移除与 gm_layer_rules.txt 重复的内容（保留为向后兼容的导出） |
| `server/prompts/rules/toolRules.js` | 同上，精简为速查表格式 |
| `server/prompts/rules/outputFormatRules.js` | 同上，移除重复的类型说明和引号规则 |

### 4.3 可删除的文件（重构完成后）

| 文件 | 说明 |
|------|------|
| `server/prompts/rules/characterRules.js` | 内容已合并到 gm_layer_rules.txt |
| `server/prompts/rules/toolRules.js` | 内容已合并到 gm_layer_rules.txt |
| `server/prompts/rules/outputFormatRules.js` | 内容已合并到 gm_layer_rules.txt |

---

## 5. gmPrompt.js 重构详情

### 5.1 新的拼接顺序

```javascript
// 重构前（当前）
return registry.compose([
    'gm_layer_base', 'gm_layer_world', 'gm_layer_character', 'gm_layer_context',
], { ... })
+ '\n\n' + characterRules + '\n\n' + toolRules + '\n\n' + outputFormatRules
+ customInstructions;

// 重构后
return registry.compose([
    'gm_layer_base',     // 角色设定 + 红线警告
    'gm_layer_rules',    // 核心规则（格式+工具+角色+叙事）
    'gm_layer_world',    // 世界观
    'gm_layer_character',// 玩家角色
    'gm_layer_context',  // 当前状态 + 位置 + 角色 + 剧情摘要
], { ... }) + '\n\n' + customInstructionsBlock;  // 自定义指令（醒目标记）
```

### 5.2 世界规则合并策略

```javascript
// 重构前（覆盖）
const worldRules = s.world.rules || preset.worldRules || '无特殊规则';

// 重构后（合并）
const userRules = s.world.rules || '';
const presetRules = preset.worldRules || '';
const worldRules = [presetRules, userRules].filter(Boolean).join('\n') || '无特殊规则';
```

### 5.3 新增剧情摘要生成

```javascript
// 从 eventLog 或最近 chatHistory 提取剧情摘要
function buildRecentPlotSummary(saveData) {
    const eventLog = saveData.eventLog || [];
    const recentEvents = eventLog.slice(-5);  // 最近5条事件

    if (recentEvents.length === 0) {
        // 从 chatHistory 提取
        const history = saveData.chatHistory || [];
        const recent = history.slice(-6);
        return recent
            .filter(m => m.role === 'assistant')
            .map(m => {
                const text = m.structured?.content
                    ? m.structured.content
                        .filter(b => b.type === 'narrative' || b.type === 'scene')
                        .map(b => b.text?.slice(0, 50))
                        .filter(Boolean)
                        .join('；')
                    : (m.content || '').slice(0, 80);
                return text ? `- ${text}` : null;
            })
            .filter(Boolean)
            .join('\n') || '冒险刚刚开始';
    }

    return recentEvents.map(e => `- ${e.text}`).join('\n');
}
```

### 5.4 自定义指令醒目化

```javascript
// 重构前
if (saveInstructions) customInstructions += '\n## 玩家自定义指令（本世界）\n' + saveInstructions;

// 重构后
let customBlock = '';
if (globalInstructions) {
    customBlock += '\n⚠️ 玩家自定义指令（全局，必须遵守）\n' + globalInstructions;
}
if (saveInstructions) {
    customBlock += '\n⚠️ 玩家自定义指令（本世界，必须遵守）\n' + saveInstructions;
}
```

---

## 6. 重构前后对比

### 6.1 结构对比

```
重构前（185行）：                    重构后（~120行）：
┌──────────────────────┐            ┌──────────────────────┐
│ 角色设定 (1行)        │            │ 角色设定 + 红线 (3行) │
│ 世界观 (40行)         │            ├──────────────────────┤
│ 玩家角色 (8行)        │            │ 核心规则 (~55行)      │
│ 当前状态 (20行)       │            │  - 输出格式+速查      │
│ 重要角色 (5行)        │            │  - 工具红线+速查表    │
├──────────────────────┤            │  - 角色分级+交互规则   │
│ 角色交互规则 (20行)   │ ←重复→     │  - 叙事规则           │
│ 角色创建规则 (11行)   │ ←重复→     ├──────────────────────┤
│ 工具原则 (12行)       │ ←重复→     │ 世界观 (10行，精简)   │
│ 工具映射 (18行)       │ ←重复→     │ 玩家角色 (8行)        │
│ 输出格式 (18行)       │ ←重复→     │ 当前状态+位置 (15行)  │
│ 引号规则 (6行)        │ ←重复→     │ 重要角色 (5行)        │
│ 工具返回规则 (8行)    │ ←重复→     │ 最近剧情进展 (5行)    │ ←新增
│ 类型说明 (8行)        │ ←重复→     ├──────────────────────┤
│ options说明 (2行)     │            │ 自定义指令 (醒目标记)  │
│ 叙事规则 (4行)        │            └──────────────────────┘
│ 自定义指令 (8行)      │
└──────────────────────┘
```

### 6.2 关键指标对比

| 指标 | 重构前 | 重构后 | 改善 |
|------|--------|--------|------|
| 总行数 | ~185行 | ~120行 | -35% |
| 规则重复 | ~30行冗余 | 0行冗余 | 消除 |
| 核心规则位置 | 第74-177行（后段） | 第4-58行（前段） | 前置 |
| 自定义指令标记 | 无特殊标记 | ⚠️ 醒目警告 | 增强 |
| 剧情摘要 | 无 | 有 | 新增 |
| 角色分级 | 不明确 | 三级标准明确 | 增强 |
| player_action | GM可输出 | 明确禁止GM输出 | 消除风险 |

---

## 7. 迁移步骤

### Phase 1：创建新模板（不影响现有功能）

1. 创建 `server/prompts/templates/gm_layer_rules.txt`（合并后的核心规则）
2. 更新 `server/prompts/templates/gm_layer_base.txt`（追加红线标记）
3. 更新 `server/prompts/templates/gm_layer_context.txt`（追加剧情摘要占位符）
4. 在 `registry.js` 中注册新模板

### Phase 2：重构 gmPrompt.js

5. 实现 `buildRecentPlotSummary()` 函数
6. 修改世界规则合并策略（覆盖 → 合并）
7. 修改自定义指令标记（普通 → 醒目）
8. 调整模板拼接顺序

### Phase 3：验证

9. 启动服务，创建新游戏，检查生成的提示词是否符合预期结构
10. 进行多轮对话测试，验证：
    - AI 是否正确调用工具
    - JSON 输出格式是否稳定
    - 自定义指令是否被遵守
    - 剧情连贯性是否提升
    - 角色创建是否合理（不会过度创建）

### Phase 4：清理

11. 精简 `characterRules.js`、`toolRules.js`、`outputFormatRules.js`（保留导出兼容）
12. 更新相关测试用例

---

## 8. 风险与注意事项

| 风险 | 应对措施 |
|------|----------|
| 结构变化导致 AI 行为突变 | Phase 3 充分测试；可先 A/B 对比新旧提示词效果 |
| 规则压缩后信息丢失 | 速查表保留了所有工具映射；详细说明可作为工具的 JSON Schema 补充 |
| 剧情摘要生成质量不佳 | 从 eventLog 优先提取（结构化数据），chatHistory 作为降级方案 |
| 旧版 rules 文件的其他引用 | 保留文件和导出，仅精简内容，不删除 |
| 不同 LLM 对结构的敏感度不同 | 核心规则前置的策略对主流 LLM（DeepSeek/GPT/Claude）均有效 |
