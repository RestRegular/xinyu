# Xinyu 开发规范 - 每次开发前必读
> **UpdatedAt**: 2026/4/24 23:12

**注意每次开发完成后都需要考虑更新开发规范并更新`UpdatedAt`**

## 项目概述
> **UpdatedAt**: 2026/4/24 23:12

Xinyu（心隅）是一个纯文字角色扮演游戏。玩家与AI进行RP对话，AI负责编写剧情和提供选项。

**核心功能**：
- 叙事系统：AI编写剧情文本，推动故事发展
- 选项系统：AI生成行动选项，玩家选择后由UserAgent扩展为角色行为
- 消息渲染：支持叙事/对话/场景/通知等多种内容块类型
- 世界设定：名称/类型/描述/规则/基调/视角
- 玩家设定：名称/性别/年龄/外貌/性格/背景

**已移除的功能**（v0.15.0 重构）：
- 属性系统（HP/MP/攻击/防御/等级/经验）
- 背包系统（物品/装备）
- 金币系统
- 地图/地点系统
- NPC系统
- 角色系统（create_character/get_character_reaction/update_relationship）
- 统计页面

## 环境配置
> **UpdatedAt**: 2026/4/24 16:20

- **Git 用户** — `git config user.name "RestRegular"` / `git config user.email "RestRegular@users.noreply.github.com"`
- **GITHUB_TOKEN** — 已写入 `~/.bashrc`，`push.sh` 会自动读取
- **推送命令** — `bash /workspace/xinyu/push.sh "commit message"`

## 发布检查清单（每次 commit 前必须检查）
> **UpdatedAt**: 2026/4/24 23:12

- [ ] **更新版本号** — `package.json` 中的 `version` 字段，每次有功能改动都要递增
- [ ] **req.body 解构** — 后端新增接收字段时，必须在路由的 `const { ... } = req.body` 中添加
- [ ] **推送用 push.sh** — `bash /workspace/xinyu/push.sh`，不要手动 git push
- [ ] **语法检查** — 改完 .js 文件后跑 `node -c` 验证语法
- [ ] **旧存档兼容** — 新增 saveData 字段时要有默认值回退（`|| '默认值'`），旧存档没有该字段不能报错
- [ ] **prompt 模板变量** — 新增模板变量时，对应的 builder 函数必须传入，否则渲染为空

## 代码修改模式
> **UpdatedAt**: 2026/4/24 23:12

### 新增 saveData 字段完整链路
1. `server/routes/game.js` POST /create — 解构 req.body + 写入 saveData
2. `server/routes/game.js` autofill 路由 — 返回字段（如果需要 AI 补全）
3. `public/js/newgame.js` — 收集字段 + 发送请求 + 模板填充
4. `public/pages/create.html` — 表单控件
5. 旧存档兼容 — 所有读取该字段的地方加 `|| 默认值`

### 新增 prompt 模板变量完整链路
1. `server/prompts/templates/*.txt` — 模板中使用 `{{variableName}}`
2. `server/prompts/builders/*.js` — builder 函数的 registry.render() 调用中传入变量

### 前端新增功能
1. `public/pages/game.html` — HTML 结构
2. `public/js/game.js` — 渲染函数 + 更新函数
3. 如有模态框 — HTML 中添加 modal 结构 + open/close 函数

## 项目结构速查
> **UpdatedAt**: 2026/4/24 23:12

```
server/
  routes/game.js          # 路由（创建、action、autofill、存档管理、模板管理）
  gmPipeline.js           # GM Pipeline（纯叙事循环 + 内容提取 + 选项生成）
  aiService.js            # AI 提示词构建入口
  gameEngine.js           # 工具引擎（已清空，纯叙事模式）
  chatHistoryManager.js   # AI 对话消息管理
  renderDataManager.js    # 渲染数据管理
  prompts/
    templates/            # Prompt 模板（.txt）
    builders/             # Prompt 构建器（gmPrompt、userAgentPrompt）
    tools/gameTools.js    # 工具定义（已清空）
    presets/genrePresets.js # 类型预设

public/
  pages/
    index.html            # 入口
    lobby.html            # 大厅（存档管理）
    create.html           # 创建世界
    game.html             # 游戏主页面
    settings.html         # 设置
  js/
    game.js               # 游戏界面逻辑（消息渲染、输入处理）
    api.js                # AI 调用、选项渲染
    newgame.js            # 创建世界逻辑
    lobby.js              # 大厅逻辑
    router.js             # 视图路由
    storage.js            # 存储层
    config.js             # 配置
  css/
    style.css             # 全局样式
    create.css            # 创建页面样式
```

## 已知坑点
> **UpdatedAt**: 2026/4/24 23:12

- 旧存档可能包含已移除的字段（attributes/inventory/map/characters等），读取时需用 `|| 默认值` 兼容
- `server/prompts/builders/characterPrompt.js` 和 `character_system.txt` 保留为空占位，避免导入报错
