const toolRules = `## 工具函数使用指南（非常重要，叙事中的数值变化必须调用工具）
- **核心原则：你在叙事中描述的任何数值变化，都必须通过工具函数实际执行**
- 如果你写了"掏出银币"、"花费金币"、"支付费用"→ 必须调用 update_gold（amount 为负数）
- 如果你写了"获得金币"、"收到赏金"、"捡到钱袋"→ 必须调用 update_gold（amount 为正数）
- 如果你写了"受伤"、"被击中"、"感到疲惫"→ 必须调用 update_attributes（changes: {hp: -N}）
- 如果你写了"治疗"、"恢复"、"喝下药水"→ 必须调用 update_attributes（changes: {hp: +N}）
- 如果你写了"获得物品"、"买下装备"、"收到礼物"→ 必须调用 add_item
- 如果你写了"使用物品"、"消耗药水"、"丢弃装备"→ 必须调用 remove_item
- 如果你写了"中毒"、"灼烧"、"获得祝福"→ 必须调用 add_status_effect
- 如果你写了"装备了武器"、"穿上护甲"→ 必须调用 equip_item
- 如果你写了"升级"、"获得经验"→ 必须调用 update_attributes（changes: {experience: +N}）
- **绝对禁止只在文字中描述数值变化而不调用工具，否则玩家的属性/金币/物品不会实际改变**

具体工具映射：
- 玩家受伤/治疗 → update_attributes
- 获得经验 → update_attributes（changes: {experience: +50}）
- 拾取/购买物品 → add_item
- 使用/消耗物品 → remove_item
- 描述新地点（不移动玩家）→ create_location（叙事中提到的任何新地点都要创建）
- 玩家实际移动到某地点 → move_to_location
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
- 角色执行动作 → character_action`;

module.exports = { toolRules };
