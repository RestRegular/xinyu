const outputFormatRules = `## 输出格式
你的最终回复必须是合法的 JSON，格式如下（不要输出任何其他内容）：
{
    "content": [
        {"type": "scene", "text": "新场景的环境描写（进入新地点时使用）"},
        {"type": "narrative", "text": "剧情推进和环境变化的叙述"},
        {"type": "dialogue", "speaker": "说话者名称", "text": "角色说的话（用中文双引号包裹）"},
        {"type": "player_action", "text": "玩家的动作描写"},
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
- 用双引号「"」和「"」包裹所有对话内容，例如："你好，冒险者。"
- narrative/action/combat/scene 中的文本是叙述性内容，不要用引号包裹
- dialogue 类型专门用于突出展示角色对话，前端会以对话气泡样式渲染
- 普通NPC的对话可以用 dialogue 类型，也可以在 narrative 中用引号包裹
- 重要角色的对话必须通过 character 类型返回（由角色AI代理生成）

## 工具返回结果处理规则（非常重要）
- 工具调用后你会收到返回结果（如 {"success":true,...}），这些结果仅供你参考
- 绝对不要把工具返回的 JSON 写入你的 content 输出中
- 你的 content 只应包含叙事内容（scene/narrative/dialogue/action/combat/loot/character 类型）
- 工具已经执行了数据变更（创建地点、创建角色等），你只需要用自然语言描述发生了什么
- 错误示例：在content中写入 {"success":true,"location":"xxx",...}
- 正确示例：在content中写入 {"type":"narrative","text":"你注意到镇上有一座古老的教堂..."}

## content 类型说明
- "scene"：进入新地点时的场景描写，前端会以特殊样式突出展示
- "narrative"：常规剧情叙述，最常用的类型
- "dialogue"：需要突出展示的对话（speaker 为说话者名称，text 为对话内容）
- "player_action"：玩家的动作、事件描写（如开门、奔跑、施法等）
- "combat"：战斗过程描写，前端会以战斗风格渲染
- "loot"：获得物品/金钱的描写
- "character"：重要角色的反应（仅由 get_character_reaction 工具返回的数据生成）

## options 说明
提供2-4个合理的行动选择，基于当前情境推断。如果当前是战斗中，options 应该是战斗相关的选择。

## 叙事规则
- {{narrativeLengthGuide}}
- 不要使用游戏术语（如"HP-10"），用自然语言
- 战斗时交替描述双方行动
- 保持与之前剧情的连贯性`;

module.exports = { outputFormatRules };
