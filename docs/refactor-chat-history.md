# chatHistory 重构方案：ChatHistoryManager + RenderDataManager

## 1. 现状问题分析

### 1.1 当前 chatHistory 的职责混乱

当前 `chatHistory` 数组同时承担了三种职责：

| 职责 | 说明 | 问题 |
|------|------|------|
| **AI 对话上下文** | 存储 user/assistant 消息，构建发送给 LLM 的消息历史 | 与渲染数据耦合，压缩逻辑和渲染逻辑交织 |
| **渲染数据源** | 前端通过遍历 chatHistory 渲染所有消息 | assistant 消息需要 JSON.parse 才能渲染，解析逻辑散落前端 |
| **事件日志** | notification 消息混在对话历史中 | 不属于 AI 对话上下文，却占用 chatHistory 空间 |

### 1.2 现有代码读写点清单

**写入点（后端）：**

| 位置 | 写入内容 | 代码 |
|------|----------|------|
| `server/routes/game.js:179` | user/system 消息 | `saveData.chatHistory.push({ role, content, timestamp })` |
| `server/routes/game.js:220-225` | assistant 消息（双格式：content JSON字符串 + structured 对象） | `saveData.chatHistory.push({ role: 'assistant', content: JSON.stringify(...), structured: {...} })` |
| `server/routes/game.js:228-237` | notification 消息 | `saveData.chatHistory.push({ role: 'notification', content, type })` |
| `server/routes/game.js:434` | 初始化空数组 | `chatHistory: []` |
| `server/gmPipeline.js:598` | UserAgent 写入 notification | `saveData.chatHistory.push({ role: 'notification', ... })` |

**读取点：**

| 位置 | 读取方式 | 代码 |
|------|----------|------|
| `server/aiService.js:36-68` | 过滤 user/assistant → 压缩 → 构建 AI 消息 | `buildMessageHistory(chatHistory)` |
| `server/gmPipeline.js:385` | 传给 Pipeline | `buildMessageHistory(saveData.chatHistory)` |
| `public/js/game.js:362-488` | 遍历全部消息，按 role 分发渲染 | `renderGameMessages()` |
| `public/js/app-game.js:16` | 判断是否新游戏 | `!data.chatHistory \|\| data.chatHistory.length === 0` |
| `public/js/api.js:62-79` | 实时渲染 AI 响应（不走 chatHistory） | `renderStructuredContent(result.content)` |

### 1.3 核心矛盾

```
                    ┌─────────────────────────────────┐
                    │        chatHistory (一份数据)     │
                    │  user / assistant / notification │
                    └──────┬──────────┬───────────────┘
                           │          │
              AI 需要: 只取 user/assistant    前端需要: 全部消息 + 结构化解析
              还要压缩旧消息                  还要区分 role 渲染不同样式
                           │          │
                           ▼          ▼
                    两种消费者需求完全不同，却共用同一数据结构
```

---

## 2. 重构目标

将 `chatHistory` 拆分为两个专职类，各自管理独立的数据：

```
┌──────────────────────┐         ┌──────────────────────┐
│  ChatHistoryManager  │         │  RenderDataManager   │
│  (CHM)               │         │  (RDM)               │
│                      │         │                      │
│  职责:               │         │  职责:               │
│  - 存储 AI 对话消息   │ ──AI──→ │  - 接收 AI 响应      │
│  - 压缩/构建 AI 消息  │ ←──响应── │  - 解析为渲染数据    │
│  - 解析 AI 回复并写入 │         │  - 管理渲染历史      │
│  - 管理通知事件       │ ──通知──→ │  - 格式化输出给前端  │
└──────────────────────┘         └──────────────────────┘
```

**设计原则：**
- CHM 只关心 AI 对话的存储和构建，输出纯净的 AI 消息数组
- RDM 只关心前端展示，输出直接可用的渲染指令数组
- 两者通过明确的接口交互，不共享内部数据结构
- 渲染数据存入数据库（`renderHistory`），同时保留从 CHM 重新解析的降级能力

---

## 3. 类设计

### 3.1 ChatHistoryManager (CHM)

**文件位置：** `server/chatHistoryManager.js`

**职责：** 管理 AI 对话消息的完整生命周期

```
                    ChatHistoryManager
┌─────────────────────────────────────────────────┐
│  内部数据:                                       │
│  - messages: Message[]     // AI 对话消息        │
│  - notifications: Notification[]  // 通知事件    │
│  - config: { summarizeThreshold, keepRecent }   │
├─────────────────────────────────────────────────┤
│  方法:                                           │
│  + addUserMessage(text, isSystem)                │
│  + addAssistantResponse(rawContent, toolCalls)   │
│  + addNotification(text, type)                   │
│  + buildAIMessages() → AIMessage[]               │
│  + getNotifications() → Notification[]           │
│  + getRecentAssistantContent() → object|null     │
│  + isEmpty() → boolean                           │
│  + clear()                                       │
│  + toJSON() → object  // 序列化存入 DB           │
│  + static fromJSON(data) → ChatHistoryManager    │
└─────────────────────────────────────────────────┘
```

#### 数据结构定义

```typescript
// AI 对话消息（CHM 内部存储）
interface Message {
  role: 'user' | 'assistant';
  content: string;           // user: 原始文本; assistant: JSON 字符串
  timestamp: string;
  // assistant 专有字段
  structured?: {
    content: ContentBlock[];  // 结构化内容块
    options?: Option[];       // 选项按钮
  };
}

// 通知事件（独立于 AI 对话）
interface Notification {
  text: string;
  type: 'positive' | 'negative' | 'info';
  timestamp: string;
}

// 发送给 LLM 的消息
interface AIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// AI 输出的内容块
interface ContentBlock {
  type: 'narrative' | 'scene' | 'dialogue' | 'action' | 'combat'
      | 'loot' | 'character' | 'player_action';
  [key: string]: any;
}

// 选项按钮
interface Option {
  text: string;
  action?: string;
  label?: string;
}
```

#### 方法详细说明

```javascript
class ChatHistoryManager {
  constructor(options = {}) {
    this.messages = [];           // AI 对话消息
    this.notifications = [];      // 通知事件（独立存储）
    this.summarizeThreshold = options.summarizeThreshold || 30;
    this.keepRecent = options.keepRecent || 16;
  }

  /**
   * 添加用户消息
   * @param {string} text - 消息文本
   * @param {boolean} isSystem - 是否为系统消息（如 [系统] 开头的指令）
   */
  addUserMessage(text, isSystem = false) {
    this.messages.push({
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
      _isSystem: isSystem,  // 内部标记，不序列化
    });
  }

  /**
   * 添加 AI 响应
   * @param {string} rawContent - AI 原始输出文本
   * @param {ContentBlock[]} contentBlocks - 解析后的结构化内容
   * @param {Option[]} options - 选项按钮
   * @param {object} playerAction - 玩家行为描述（选项时）
   */
  addAssistantResponse(rawContent, contentBlocks, options = [], playerAction = null) {
    const finalContent = playerAction
      ? [playerAction, ...contentBlocks]
      : contentBlocks;

    this.messages.push({
      role: 'assistant',
      content: rawContent,
      structured: {
        content: finalContent,
        options: options.length > 0 ? options : undefined,
      },
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * 添加通知事件
   */
  addNotification(text, type = 'info') {
    this.notifications.push({
      text,
      type,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * 构建发送给 AI 的消息数组
   * - 只包含 user/assistant
   * - 超过阈值时压缩旧消息
   * @returns {AIMessage[]}
   */
  buildAIMessages() {
    const filtered = this.messages.filter(m => m.role === 'user' || m.role === 'assistant');

    if (filtered.length <= this.summarizeThreshold) {
      return filtered.map(m => ({ role: m.role, content: m.content }));
    }

    const recent = filtered.slice(-this.keepRecent);
    const old = filtered.slice(0, -this.keepRecent);

    // 压缩旧消息为摘要
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
      {
        role: 'system',
        content: `以下是之前冒险的摘要（已压缩，仅供参考）：\n${summary}\n\n请注意：以上是早期对话的压缩版本，以最近的对话内容为准。`,
      },
      ...recent.map(m => ({ role: m.role, content: m.content })),
    ];
  }

  /**
   * 获取所有通知（自上次调用以来新增的）
   */
  getNotifications(sinceTimestamp = null) {
    if (!sinceTimestamp) return [...this.notifications];
    return this.notifications.filter(n => n.timestamp > sinceTimestamp);
  }

  /**
   * 获取最近一条 assistant 消息的 structured 数据
   */
  getRecentAssistantStructured() {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].role === 'assistant' && this.messages[i].structured) {
        return this.messages[i].structured;
      }
    }
    return null;
  }

  isEmpty() {
    return this.messages.length === 0;
  }

  toJSON() {
    return {
      messages: this.messages,
      notifications: this.notifications,
    };
  }

  static fromJSON(data) {
    const mgr = new ChatHistoryManager();
    mgr.messages = data.messages || [];
    mgr.notifications = data.notifications || [];
    return mgr;
  }
}
```

---

### 3.2 RenderDataManager (RDM)

**文件位置：** `server/renderDataManager.js`

**职责：** 将 AI 响应和事件通知转换为前端可直接使用的渲染数据

```
                    RenderDataManager
┌─────────────────────────────────────────────────┐
│  内部数据:                                       │
│  - renderBlocks: RenderBlock[]  // 渲染块列表    │
│  - options: Option[]           // 当前选项按钮   │
├─────────────────────────────────────────────────┤
│  方法:                                           │
│  + appendAssistantContent(contentBlocks)         │
│  + appendUserMessage(text, playerAction?)        │
│  + appendNotification(text, type)                │
│  + appendSystemMessage(text)                     │
│  + updateOptions(options)                        │
│  + getRenderData() → RenderOutput                │
│  + getFullRenderHistory() → RenderBlock[]        │
│  + rebuildFromCHM(chm) → RenderBlock[]  // 降级  │
│  + toJSON() → object                             │
│  + static fromJSON(data) → RenderDataManager     │
└─────────────────────────────────────────────────┘
```

#### 渲染数据结构定义

```typescript
// 渲染块（前端直接使用，无需二次解析）
interface RenderBlock {
  id: string;                // 唯一标识
  type: 'system' | 'player' | 'narrative' | 'scene' | 'dialogue'
      | 'action' | 'combat' | 'loot' | 'character' | 'notification';
  timestamp: string;
  // 按类型有不同的数据字段
  data: {
    // system
    text?: string;
    // player
    playerName?: string;
    action?: string;
    dialogue?: string;
    // narrative / scene / action / combat / loot
    text?: string;
    // dialogue
    speaker?: string;
    // character
    characterName?: string;
    mood?: string;
    reaction?: string;
    dialogue?: string;
    // notification
    text?: string;
    notifType?: 'positive' | 'negative' | 'info';
  };
}

// 渲染输出（返回给前端）
interface RenderOutput {
  newBlocks: RenderBlock[];   // 本次新增的渲染块
  options: Option[];          // 当前选项按钮
  notifications: Array<{ text: string; type: string }>;  // 本次新增通知
  hasMore: boolean;           // 是否有更多历史数据
}

// 完整渲染输出（页面加载时）
interface FullRenderOutput {
  blocks: RenderBlock[];      // 全部渲染块（按时间排序）
  options: Option[];          // 当前选项按钮
}
```

#### 方法详细说明

```javascript
const { v4: uuidv4 } = require('uuid');

class RenderDataManager {
  constructor() {
    this.renderBlocks = [];   // 持久化的渲染块列表
    this.currentOptions = []; // 当前选项按钮
  }

  /**
   * 追加 AI 响应内容块
   * @param {ContentBlock[]} contentBlocks - 来自 CHM 的结构化内容
   */
  appendAssistantContent(contentBlocks) {
    for (const block of contentBlocks) {
      const renderBlock = {
        id: this._generateId(),
        timestamp: new Date().toISOString(),
        ...this._convertContentBlock(block),
      };
      this.renderBlocks.push(renderBlock);
    }
  }

  /**
   * 追加玩家消息
   * @param {string} text - 原始文本
   * @param {object} playerAction - 玩家行为描述（可选，选项时由 UA 生成）
   */
  appendUserMessage(text, playerAction = null) {
    const renderBlock = {
      id: this._generateId(),
      type: 'player',
      timestamp: new Date().toISOString(),
      data: {
        action: playerAction?.action || null,
        dialogue: playerAction?.dialogue || text,
      },
    };
    this.renderBlocks.push(renderBlock);
  }

  /**
   * 追加通知
   */
  appendNotification(text, type = 'info') {
    this.renderBlocks.push({
      id: this._generateId(),
      type: 'notification',
      timestamp: new Date().toISOString(),
      data: { text, notifType: type },
    });
  }

  /**
   * 追加系统消息
   */
  appendSystemMessage(text) {
    this.renderBlocks.push({
      id: this._generateId(),
      type: 'system',
      timestamp: new Date().toISOString(),
      data: { text },
    });
  }

  /**
   * 更新选项按钮（替换旧的）
   */
  updateOptions(options) {
    this.currentOptions = options || [];
  }

  /**
   * 获取增量渲染数据（实时响应时使用）
   * @param {number} lastBlockIndex - 前端已知的最后渲染块索引
   */
  getRenderData(lastBlockIndex = -1) {
    const newBlocks = this.renderBlocks.slice(lastBlockIndex + 1);
    return {
      newBlocks,
      options: this.currentOptions,
    };
  }

  /**
   * 获取完整渲染历史（页面加载时使用）
   */
  getFullRenderHistory() {
    return {
      blocks: [...this.renderBlocks],
      options: [...this.currentOptions],
    };
  }

  /**
   * 从 CHM 重建渲染数据（降级方案）
   * 当 renderHistory 丢失或损坏时使用
   */
  rebuildFromCHM(chm) {
    this.renderBlocks = [];
    this.currentOptions = [];

    const data = chm.toJSON();

    // 重建 messages
    for (const msg of data.messages) {
      if (msg.role === 'user') {
        this.appendUserMessage(msg.content);
      } else if (msg.role === 'assistant' && msg.structured) {
        this.appendAssistantContent(msg.structured.content);
        if (msg.structured.options) {
          this.currentOptions = msg.structured.options;
        }
      }
    }

    // 重建 notifications
    for (const notif of data.notifications) {
      this.appendNotification(notif.text, notif.type);
    }

    return this.renderBlocks;
  }

  /**
   * 内部：将 AI 内容块转换为渲染块
   */
  _convertContentBlock(block) {
    switch (block.type) {
      case 'narrative':
        return { type: 'narrative', data: { text: block.text } };
      case 'scene':
        return { type: 'scene', data: { text: block.text } };
      case 'dialogue':
        return { type: 'dialogue', data: { speaker: block.speaker, text: block.text } };
      case 'action':
        return { type: 'action', data: { text: block.text } };
      case 'combat':
        return { type: 'combat', data: { text: block.text } };
      case 'loot':
        return { type: 'loot', data: { text: block.text } };
      case 'character':
        return {
          type: 'character',
          data: {
            characterName: block.characterName,
            mood: block.mood,
            reaction: block.reaction,
            dialogue: block.dialogue,
          },
        };
      case 'player_action':
        return {
          type: 'player',
          data: { action: block.action, dialogue: block.dialogue },
        };
      default:
        return { type: 'narrative', data: { text: block.text || '' } };
    }
  }

  _generateId() {
    return 'rb_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
  }

  toJSON() {
    return {
      renderBlocks: this.renderBlocks,
      currentOptions: this.currentOptions,
    };
  }

  static fromJSON(data) {
    const mgr = new RenderDataManager();
    mgr.renderBlocks = data.renderBlocks || [];
    mgr.currentOptions = data.currentOptions || [];
    return mgr;
  }
}
```

---

## 4. 数据流设计

### 4.1 实时响应流程（用户发送消息）

```
用户发送消息
    │
    ▼
┌─ routes/game.js /action ─────────────────────────────────┐
│                                                          │
│  1. chm.addUserMessage(userMessage, isSystem)            │
│  2. rdm.appendUserMessage(text, playerAction?)           │
│                                                          │
│  3. pipeline.run(chm.buildAIMessages(), ...)             │
│     │                                                    │
│     ├── AI 返回 content + options + notifications        │
│     │                                                    │
│  4. chm.addAssistantResponse(raw, content, options,      │
│                              playerAction)               │
│  5. for notif of notifications:                          │
│       chm.addNotification(notif.text, notif.type)        │
│       rdm.appendNotification(notif.text, notif.type)     │
│                                                          │
│  6. rdm.appendAssistantContent(content)                  │
│  7. rdm.updateOptions(options)                           │
│                                                          │
│  8. persistSave() → 写入 DB                              │
│     saveData.chatHistory = chm.toJSON()                  │
│     saveData.renderHistory = rdm.toJSON()                │
│                                                          │
│  9. 返回给前端:                                           │
│     {                                                    │
│       renderData: rdm.getRenderData(lastBlockIndex),     │
│       saveData,                                          │
│     }                                                    │
└──────────────────────────────────────────────────────────┘
```

### 4.2 页面加载流程（历史回放）

```
前端加载 game.html
    │
    ▼
┌─ routes/saves.js GET /api/saves/:id ────────────────────┐
│                                                          │
│  1. 从 DB 读取 saveData                                  │
│  2. 检查 renderHistory 是否存在                           │
│     ├── 存在 → 直接返回 rdm.getFullRenderHistory()       │
│     └── 不存在 → 降级: rdm.rebuildFromCHM(chm)          │
│                   然后持久化重建结果                       │
│                                                          │
│  3. 返回:                                                │
│     {                                                    │
│       renderHistory: { blocks, options },                │
│       saveData,                                          │
│     }                                                    │
└──────────────────────────────────────────────────────────┘
    │
    ▼
前端: 直接遍历 renderBlocks 渲染，无需任何解析逻辑
```

### 4.3 新游戏开场流程

```
app-game.js 检测 chatHistory 为空
    │
    ▼
┌─ 后端处理 ──────────────────────────────────────────────┐
│                                                          │
│  1. rdm.appendSystemMessage('欢迎来到...')               │
│  2. chm.addUserMessage('[系统] 玩家开始新游戏...')       │
│  3. pipeline.run(...) → AI 返回开场剧情                   │
│  4. chm.addAssistantResponse(...)                        │
│  5. rdm.appendAssistantContent(content)                  │
│  6. rdm.updateOptions(options)                           │
│  7. persistSave()                                        │
└──────────────────────────────────────────────────────────┘
```

---

## 5. 数据库变更

### 5.1 saves 表新增字段

```sql
ALTER TABLE saves ADD COLUMN render_history TEXT DEFAULT '';
```

### 5.2 saveData JSON 结构变更

```javascript
// 旧结构（保留，向后兼容）
{
  chatHistory: [
    { role: 'user', content: '...', timestamp: '...' },
    { role: 'assistant', content: '{"content":[...]}', structured: {...}, timestamp: '...' },
    { role: 'notification', content: '...', type: 'info', timestamp: '...' },
  ],
}

// 新结构
{
  chatHistory: {
    messages: [
      { role: 'user', content: '...', timestamp: '...' },
      { role: 'assistant', content: '...', structured: { content: [...], options: [...] }, timestamp: '...' },
    ],
    notifications: [
      { text: '...', type: 'info', timestamp: '...' },
    ],
  },
  renderHistory: {
    renderBlocks: [
      { id: 'rb_xxx', type: 'narrative', timestamp: '...', data: { text: '...' } },
      { id: 'rb_xxx', type: 'character', timestamp: '...', data: { characterName: '...', mood: '...', ... } },
      { id: 'rb_xxx', type: 'notification', timestamp: '...', data: { text: '...', notifType: 'positive' } },
    ],
    currentOptions: [
      { text: '探索森林', action: '探索森林' },
    ],
  },
}
```

### 5.3 数据迁移策略

```javascript
// server/migrations/migrateChatHistory.js

function migrateSaveData(oldData) {
  const chm = new ChatHistoryManager();
  const rdm = new RenderDataManager();

  if (Array.isArray(oldData.chatHistory)) {
    // 旧格式：数组 → 拆分为 messages + notifications
    for (const msg of oldData.chatHistory) {
      switch (msg.role) {
        case 'user':
          chm.addUserMessage(msg.content);
          rdm.appendUserMessage(msg.content);
          break;
        case 'assistant':
          chm.messages.push(msg);  // 保留原始结构
          if (msg.structured && msg.structured.content) {
            rdm.appendAssistantContent(msg.structured.content);
            if (msg.structured.options) {
              rdm.updateOptions(msg.structured.options);
            }
          }
          break;
        case 'system':
          rdm.appendSystemMessage(msg.content);
          break;
        case 'notification':
          chm.addNotification(msg.content, msg.type);
          rdm.appendNotification(msg.content, msg.type);
          break;
      }
    }
  } else {
    // 已经是新格式
    return oldData;
  }

  return {
    ...oldData,
    chatHistory: chm.toJSON(),
    renderHistory: rdm.toJSON(),
  };
}
```

---

## 6. API 接口变更

### 6.1 POST /api/game/action（核心变更）

**请求**（不变）：
```json
{ "saveId": "save_xxx", "userMessage": "你好", "isOption": false }
```

**响应**（变更）：
```json
{
  "renderData": {
    "newBlocks": [
      { "id": "rb_xxx", "type": "player", "timestamp": "...", "data": { "dialogue": "你好" } },
      { "id": "rb_xxx", "type": "narrative", "timestamp": "...", "data": { "text": "旅店老板向你点头致意..." } },
      { "id": "rb_xxx", "type": "dialogue", "timestamp": "...", "data": { "speaker": "旅店老板", "text": "欢迎光临！" } },
      { "id": "rb_xxx", "type": "character", "timestamp": "...", "data": { "characterName": "旅店老板", "mood": "friendly", "dialogue": "要住店吗？" } }
    ],
    "options": [
      { "text": "住一晚", "action": "住一晚" },
      { "text": "打听消息", "action": "打听消息" }
    ]
  },
  "saveData": { ... }
}
```

**关键变化：**
- 移除顶层的 `content`、`options`、`notifications` 字段
- 新增 `renderData` 字段，包含前端可直接使用的渲染块

### 6.2 GET /api/saves/:id（新增渲染数据）

**响应**（变更）：
```json
{
  "id": "save_xxx",
  "name": "剑与魔法的冒险",
  "data": { ... },
  "renderHistory": {
    "blocks": [ ... ],      // 全部渲染块
    "options": [ ... ]       // 当前选项
  }
}
```

### 6.3 POST /api/game/action 请求新增字段（可选）

```json
{
  "saveId": "save_xxx",
  "userMessage": "你好",
  "lastBlockIndex": 42   // 前端已渲染到的最后块索引，用于增量返回
}
```

---

## 7. 前端变更

### 7.1 渲染逻辑大幅简化

**旧逻辑**（`game.js:362-488`，约 130 行）：
- 遍历 chatHistory，按 role 分支
- assistant 消息要判断是否有 structured
- structured.content 要按 type 再分支
- 选项按钮要反向查找最后一条 assistant 消息

**新逻辑**（预计约 40 行）：
```javascript
function renderGameMessages(renderBlocks) {
  const container = document.getElementById('gameMessages');
  let html = '';

  for (const block of renderBlocks) {
    html += renderBlock(block);  // 统一的渲染函数
  }

  container.innerHTML = html;
  scrollToBottom();
}

function renderBlock(block) {
  switch (block.type) {
    case 'system':
      return `<div class="msg msg-system">${escapeHtml(block.data.text)}</div>`;
    case 'player':
      return renderPlayerBlock(block.data);
    case 'narrative':
      return `<div class="msg msg-narrator">${formatNarratorText(block.data.text)}</div>`;
    case 'dialogue':
      return renderDialogueBlock(block.data);
    case 'character':
      return renderCharacterBlock(block.data);
    case 'notification':
      return renderNotificationBlock(block.data);
    // ... 其他类型
  }
}
```

### 7.2 api.js 的 callAI 简化

**旧逻辑**：手动分发 content、options、notifications
**新逻辑**：直接使用 `renderData`

```javascript
async function callAI(userText, isOption = false) {
  addTypingIndicator();
  const response = await fetch('/api/game/action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      saveId: currentSaveId,
      userMessage: userText,
      isOption: isOption || undefined,
      lastBlockIndex: currentLastBlockIndex,  // 增量渲染
    }),
  });

  const result = await response.json();
  removeTypingIndicator();

  // 直接渲染，无需解析
  if (result.renderData) {
    appendRenderBlocks(result.renderData.newBlocks);
    renderOptions(result.renderData.options);
    currentLastBlockIndex += result.renderData.newBlocks.length;
  }

  if (result.saveData) {
    currentSave = result.saveData;
  }
  refreshAllPanels();
}
```

### 7.3 页面加载简化

```javascript
// app-game.js
const data = await loadSaveData(activeSaveId);
currentSave = data;

// 直接使用 renderHistory，无需 renderGameMessages() 解析
if (data.renderHistory) {
  renderGameMessages(data.renderHistory.blocks);
  renderOptions(data.renderHistory.options);
  currentLastBlockIndex = data.renderHistory.blocks.length - 1;
}
```

---

## 8. 后端变更清单

### 8.1 新增文件

| 文件 | 说明 |
|------|------|
| `server/chatHistoryManager.js` | ChatHistoryManager 类 |
| `server/renderDataManager.js` | RenderDataManager 类 |
| `server/migrations/migrateChatHistory.js` | 数据迁移脚本 |

### 8.2 修改文件

| 文件 | 变更内容 |
|------|----------|
| `server/routes/game.js` | `/action` 路由：使用 CHM + RDM 替代直接操作 chatHistory；`/create` 路由：初始化 CHM + RDM |
| `server/routes/saves.js` | `GET /:id`：返回 renderHistory；加载存档时检查并迁移旧格式 |
| `server/aiService.js` | `buildMessageHistory()` 改为接收 CHM 实例，调用 `chm.buildAIMessages()` |
| `server/gmPipeline.js` | Pipeline.run() 接收 CHM 实例而非原始 chatHistory；UserAgent 的 notification 写入 CHM |
| `server/db.js` | saves 表新增 `render_history` 字段 |

### 8.3 可删除/简化的前端代码

| 文件 | 变更内容 |
|------|----------|
| `public/js/game.js` | `renderGameMessages()` 大幅简化（130行 → ~40行）；移除 `structured` 相关判断逻辑 |
| `public/js/api.js` | `callAI()` 简化；`renderStructuredContent()` 可删除（由后端 RDM 处理） |
| `public/js/app-game.js` | 加载逻辑改用 renderHistory |

---

## 9. 迁移步骤

### Phase 1：基础建设（不影响现有功能）

1. 创建 `server/chatHistoryManager.js` 和 `server/renderDataManager.js`
2. 编写单元测试验证两个类的核心方法
3. 创建 `server/migrations/migrateChatHistory.js`

### Phase 2：后端集成

4. 修改 `server/routes/game.js` 的 `/action` 路由，引入 CHM + RDM
5. 修改 `server/routes/game.js` 的 `/create` 路由，初始化 CHM + RDM
6. 修改 `server/gmPipeline.js`，Pipeline 接收 CHM 实例
7. 修改 `server/aiService.js`，buildMessageHistory 使用 CHM
8. 修改 `server/db.js`，新增 render_history 字段
9. 修改 `server/routes/saves.js`，返回 renderHistory + 旧格式迁移

### Phase 3：前端适配

10. 修改 `public/js/api.js` 的 `callAI()`，使用新的 renderData 格式
11. 简化 `public/js/game.js` 的 `renderGameMessages()`
12. 修改 `public/js/app-game.js` 的加载逻辑

### Phase 4：清理

13. 移除 `aiService.js` 中旧的 `buildMessageHistory()` 函数
14. 移除前端 `renderStructuredContent()` 等不再需要的解析函数
15. 清理 chatHistory 中 `structured` 字段的兼容代码

---

## 10. 风险与注意事项

| 风险 | 应对措施 |
|------|----------|
| 旧存档数据兼容性 | 迁移脚本自动转换；RDM.rebuildFromCHM() 作为降级方案 |
| renderHistory 数据膨胀 | 渲染块是轻量对象（仅 id + type + data），远小于原始 AI 消息；可考虑定期清理旧渲染块 |
| 前后端接口不兼容 | Phase 2 和 Phase 3 需要同步部署；可先在后端同时返回新旧两种格式，前端逐步切换 |
| 增量渲染的 lastBlockIndex 错位 | 前端在页面加载时从 renderHistory.blocks.length 获取初始值；出错时回退到全量渲染 |
