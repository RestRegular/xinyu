# Xinyu 开发规范 - 每次开发前必读

## 发布检查清单（每次 commit 前必须检查）

- [ ] **更新版本号** — `package.json` 中的 `version` 字段，每次有功能改动都要递增
- [ ] **req.body 解构** — 后端新增接收字段时，必须在路由的 `const { ... } = req.body` 中添加
- [ ] **推送用 push.sh** — `bash /workspace/xinyu/push.sh`，不要手动 git push
- [ ] **语法检查** — 改完 .js 文件后跑 `node -c` 验证语法
- [ ] **旧存档兼容** — 新增 saveData 字段时要有默认值回退（`|| '默认值'`），旧存档没有该字段不能报错
- [ ] **prompt 模板变量** — 新增模板变量时，对应的 builder 函数必须传入，否则渲染为空

## 代码修改模式

### 新增工具（tool）完整链路
1. `server/prompts/tools/gameTools.js` — 工具定义（name, description, parameters）
2. `server/gameEngine.js` — switch case + handle 函数 + executeGameFunction 路由
3. `server/gmPipeline.js` — 注册到对应 Agent 的 toolNames 数组
4. `server/prompts/templates/gm_layer_rules.txt` — 工具速查表 + 使用规则

### 新增 saveData 字段完整链路
1. `server/routes/game.js` POST /create — 解构 req.body + 写入 saveData
2. `server/routes/game.js` autofill 路由 — 返回字段（如果需要 AI 补全）
3. `public/js/newgame.js` — 收集字段 + 发送请求 + 模板填充
4. `public/pages/create.html` — 表单控件
5. 旧存档兼容 — 所有读取该字段的地方加 `|| 默认值`

### 新增 prompt 模板变量完整链路
1. `server/prompts/templates/*.txt` — 模板中使用 `{{variableName}}`
2. `server/prompts/builders/*.js` — builder 函数的 registry.render() 调用中传入变量

### 前端新增面板/功能
1. `public/pages/game.html` — HTML 结构
2. `public/js/game.js` — 渲染函数 + 更新函数 + 在 refreshAllPanels 中调用
3. 如有模态框 — HTML 中添加 modal 结构 + open/close 函数

## 项目结构速查

```
server/
  routes/game.js          # 路由（创建、action、autofill、存档管理）
  gmPipeline.js           # GM Pipeline 主流程（Agent 循环、工具调度、NPC 自动升级）
  gameEngine.js           # 工具执行函数（handleCreateNpc 等）
  renderDataManager.js    # 内容块转换（_convertContentBlock、appendUserMessage）
  prompts/
    templates/            # Prompt 模板（.txt）
    builders/             # Prompt 构建器（.js）
    tools/gameTools.js    # 工具定义

public/
  pages/game.html         # 游戏主页面
  pages/create.html       # 创建世界页面
  js/game.js              # 游戏界面逻辑（面板渲染、消息渲染、交互）
  js/newgame.js           # 创建世界逻辑
  css/style.css           # 样式
```

## 已知坑点

1. **不要删除函数定义** — 重构时用 SearchReplace 替换函数体，不要用新内容覆盖时把相邻函数吞掉
2. **GM prompt 中不要硬编码视角** — 用 `{{perspectiveGuide}}` / `{{perspectivePronoun}}` 变量
3. **旧 dialogue 类型要兼容** — RDM 的 _convertContentBlock 中 dialogue 类型要转为 character 类型
4. **character 类型区分普通NPC和重要角色** — 有 characterId 的是重要角色，没有的是普通 NPC
5. **NPC 自动升级依赖 GM 输出 character 类型** — 旧存档的 CHM 缓存了旧 prompt，需要新游戏才能生效
