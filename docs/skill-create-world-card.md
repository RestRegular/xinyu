# 世界卡片创建 Skill

> 本文档指导 AI 如何根据用户给出的主题要求，创建符合「心隅」平台标准的 SVG 世界卡片。

---

## 一、工作流程

```
用户给出主题 → 分析主题 → 设计世界观 → 编写 JSON 数据 → 设计视觉风格 → 生成 SVG → 验证
```

### Step 1：分析用户主题

从用户描述中提取以下要素：

| 要素 | 说明 | 示例 |
|------|------|------|
| **主题/题材** | 核心玩法或故事类型 | 侦探悬疑、赛博朋克、末日求生、武侠江湖 |
| **时代背景** | 科技水平和社会形态 | 古代、现代、未来、架空 |
| **叙事基调** | 情感氛围 | 史诗、轻松、黑暗、热血、温馨 |
| **特色系统** | 区别于其他世界的独特机制 | 线索收集、日程推进、好感度、建造 |

如果用户只给了模糊的主题（如"帮我做一个科幻的"），需要主动补充合理的设计。

### Step 2：设计世界观

为每个主题设计以下内容：

1. **世界名称**：2-4 个字，有辨识度（如"雾城"、"星海学院"、"艾泽利亚"）
2. **世界描述**：100-200 字，交代背景、冲突和玩家身份
3. **世界规则**：2-4 个子系统，每个系统 2-4 条规则
4. **起始地点**：玩家开始的位置 + 50-100 字的场景描写
5. **初始物品**：4-6 件，符合世界观设定的物品
6. **初始金币**：50-500，符合世界观经济水平
7. **自定义指令**：5-10 条叙事指导，帮助 AI 理解这个世界

### Step 3：确定视觉风格

根据主题选择配色方案：

| 主题类型 | 背景色系 | 强调色 | 字体 | 装饰元素 |
|----------|----------|--------|------|----------|
| 奇幻/魔法 | 深蓝紫 `#1a1a2e→#0f3460` | 金色 `#ffd700` | serif | 星光、魔法阵 |
| 校园/恋爱 | 粉白 `#fff5f5→#fce4ec` | 樱粉 `#e91e63` | sans-serif | 花瓣、爱心 |
| 悬疑/恐怖 | 深灰蓝 `#1a1a2e→#0f0f23` | 冷灰 `#718096` | sans-serif | 雾气、阴影 |
| 赛博朋克 | 深紫黑 `#0a0a1a→#1a0a2e` | 霓虹 `#00ffff` | monospace | 电路线条、网格 |
| 武侠/仙侠 | 水墨灰 `#f5f0e8→#e8e0d0` | 朱红 `#c62828` | serif | 山水、云纹 |
| 末日/废土 | 暗棕 `#2c1810→#1a0f0a` | 铁锈橙 `#e65100` | sans-serif | 裂纹、齿轮 |
| 科幻/太空 | 深空蓝 `#050520→#0a0a30` | 星蓝 `#4fc3f7` | sans-serif | 星星、星云 |
| 现代/都市 | 浅灰白 `#f8f9fa→#e9ecef` | 深蓝 `#1565c0` | sans-serif | 建筑轮廓 |

### Step 4：生成 SVG 卡片

严格按照下面的 SVG 结构规范生成。

---

## 二、SVG 卡片结构规范

### 2.1 画布尺寸

```xml
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     viewBox="0 0 600 840" width="600" height="840">
```

- 固定尺寸：600×840
- 卡片区域：x=10, y=10, width=580, height=820, rx=16

### 2.2 标准布局（从上到下）

```
y=10-830  ┌─────────────────────────────┐
          │  卡片背景 (圆角矩形)          │
y=20-820  │  ┌───────────────────────┐  │
          │  │ 内边框装饰             │  │
y=60      │  │ ─── 顶部装饰线 ───     │  │
y=75-103  │  │    [类型标签]          │  │
y=130     │  │       🎭 图标          │  │
y=175-222 │  │    世界名称            │  │
y=222     │  │    副标题              │  │
y=242     │  │  ─── 分隔线 ───       │  │
y=272     │  │    一句话描述          │  │
y=310-440 │  │  ✦ 世界概览            │  │
          │  │    (5-6行描述文字)     │  │
y=460-600 │  │  ✦ 地点/区域          │  │
          │  │    (2×2 网格卡片)      │  │
y=618-655 │  │  ✦ 特色系统           │  │
          │  │    (横向标签)          │  │
y=680-730 │  │  ✦ 故事起点           │  │
          │  │    📍 地点 + 描述      │  │
y=752     │  │  ─── 底部分隔线 ───   │  │
y=774     │  │    底部信息栏          │  │
y=806     │  │    心隅 · XINYU       │  │
y=830     │  └───────────────────────┘  │
          └─────────────────────────────┘
```

### 2.3 必需的 defs 元素

```xml
<defs>
  <!-- 1. 背景渐变 bgGrad（纵向，三段） -->
  <linearGradient id="bgGrad" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="主色1"/>
    <stop offset="40%" stop-color="主色2"/>
    <stop offset="100%" stop-color="主色3"/>
  </linearGradient>

  <!-- 2. 强调色渐变 accentGrad（横向，用于装饰线和边框） -->
  <linearGradient id="accentGrad" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0%" stop-color="强调色暗"/>
    <stop offset="50%" stop-color="强调色亮"/>
    <stop offset="100%" stop-color="强调色暗"/>
  </linearGradient>

  <!-- 3. 标题渐变 titleGrad（横向，用于世界名称） -->
  <linearGradient id="titleGrad" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0%" stop-color="标题色暗"/>
    <stop offset="50%" stop-color="标题色亮"/>
    <stop offset="100%" stop-color="标题色暗"/>
  </linearGradient>

  <!-- 4. 阴影滤镜 softShadow -->
  <filter id="softShadow">
    <feDropShadow dx="0" dy="2" stdDeviation="6" flood-color="#000" flood-opacity="0.3"/>
  </filter>

  <!-- 5. 可选：装饰效果滤镜（如花瓣模糊、雾气模糊等） -->
</defs>
```

### 2.4 各区域详细规范

#### 卡片背景
```xml
<rect x="10" y="10" width="580" height="820" rx="16"
      fill="url(#bgGrad)" stroke="url(#accentGrad)" stroke-width="2"
      filter="url(#softShadow)"/>
```

#### 内边框
```xml
<rect x="20" y="20" width="560" height="800" rx="12"
      fill="none" stroke="强调色低透明度" stroke-width="1"/>
```

#### 顶部装饰线
```xml
<line x1="60" y1="60" x2="540" y2="60" stroke="url(#accentGrad)" stroke-width="1" opacity="0.5"/>
<text x="300" y="63" text-anchor="middle" fill="强调色" font-size="10" opacity="0.6">装饰符号</text>
<circle cx="60" cy="60" r="2" fill="强调色" opacity="0.4"/>
<circle cx="540" cy="60" r="2" fill="强调色" opacity="0.4"/>
```

#### 类型标签
```xml
<rect x="240" y="75" width="120" height="28" rx="14"
      fill="强调色极低透明度" stroke="强调色中透明度" stroke-width="1"/>
<text x="300" y="94" text-anchor="middle" fill="强调色" font-family="sans-serif"
      font-size="13" letter-spacing="4">类 型</text>
```

#### 图标
```xml
<text x="300" y="155" text-anchor="middle" font-size="56">🎭</text>
<!-- 可选：加 glow 滤镜 -->
```

#### 世界名称
```xml
<text x="300" y="195" text-anchor="middle" fill="url(#titleGrad)"
      font-family="sans-serif" font-size="28" font-weight="bold" letter-spacing="2">世界名</text>
<text x="300" y="222" text-anchor="middle" fill="强调色" font-family="sans-serif"
      font-size="16" letter-spacing="6" opacity="0.8">副 标 题</text>
```

#### 分隔线
```xml
<line x1="100" y1="242" x2="500" y2="242" stroke="url(#accentGrad)" stroke-width="0.5" opacity="0.4"/>
<text x="300" y="246" text-anchor="middle" fill="强调色" font-size="10" opacity="0.5">◆</text>
```

#### 世界描述（一句话）
```xml
<text x="300" y="272" text-anchor="middle" fill="描述色" font-family="sans-serif"
      font-size="11" opacity="0.85">一句话概括这个世界</text>
```

#### 世界概览（章节标题模式）
```xml
<text x="50" y="310" fill="标题色" font-family="sans-serif" font-size="13"
      font-weight="bold" letter-spacing="2">✦ 世界概览</text>
<line x1="50" y1="318" x2="180" y2="318" stroke="强调色低透明度" stroke-width="0.5"/>

<text x="50" y="340" fill="正文色" font-family="sans-serif" font-size="10.5" opacity="0.85">
  <tspan x="50" dy="0">第一行文字，每行约22个中文字符</tspan>
  <tspan x="50" dy="16">第二行文字</tspan>
  <tspan x="50" dy="16">第三行文字</tspan>
  <tspan x="50" dy="16">第四行文字</tspan>
  <tspan x="50" dy="16">第五行文字</tspan>
  <tspan x="50" dy="16">第六行文字</tspan>
</text>
```

> **注意**：概览文字区域 y=340 到 y=440，最多 6 行（每行 16px），约 130 个中文字符。

#### 地点/区域（2×2 网格）
```xml
<text x="50" y="460" fill="标题色" font-family="sans-serif" font-size="13"
      font-weight="bold" letter-spacing="2">✦ 区域名称</text>
<line x1="50" y1="468" x2="180" y2="468" stroke="强调色低透明度" stroke-width="0.5"/>

<!-- 左上 -->
<rect x="50" y="480" width="240" height="52" rx="6"
      fill="强调色极低透明度" stroke="强调色低透明度" stroke-width="0.5"/>
<text x="66" y="500" fill="标题色" font-size="12">🏠 地点A</text>
<text x="66" y="518" fill="副文字色" font-size="9.5" opacity="0.8">位置·特征描述</text>

<!-- 右上 -->
<rect x="310" y="480" width="240" height="52" rx="6"
      fill="强调色极低透明度" stroke="强调色低透明度" stroke-width="0.5"/>
<text x="326" y="500" fill="标题色" font-size="12">🌿 地点B</text>
<text x="326" y="518" fill="副文字色" font-size="9.5" opacity="0.8">位置·特征描述</text>

<!-- 左下 -->
<rect x="50" y="542" width="240" height="52" rx="6" .../>
<!-- 右下 -->
<rect x="310" y="542" width="240" height="52" rx="6" .../>
```

#### 特色系统（横向标签）
```xml
<text x="50" y="618" fill="标题色" font-family="sans-serif" font-size="13"
      font-weight="bold" letter-spacing="2">✦ 系统名称</text>
<line x="50" y1="626" x2="180" y2="626" stroke="强调色低透明度" stroke-width="0.5"/>

<text fill="正文色" font-family="sans-serif" font-size="10" opacity="0.8">
  <tspan x="50" y="646">🏷️系统A</tspan>
  <tspan x="170" y="646">🏷️系统B</tspan>
  <tspan x="290" y="646">🏷️系统C</tspan>
  <tspan x="410" y="646">🏷️系统D</tspan>
</text>
```

#### 故事起点
```xml
<text x="50" y="680" fill="标题色" font-family="sans-serif" font-size="13"
      font-weight="bold" letter-spacing="2">✦ 故事起点</text>
<line x="50" y1="688" x2="180" y2="688" stroke="强调色低透明度" stroke-width="0.5"/>

<text x="50" y="708" fill="正文色" font-family="sans-serif" font-size="11">📍 地点名称</text>
<text x="50" y="728" fill="副文字色" font-family="sans-serif" font-size="9.5" opacity="0.8">场景描述</text>
```

#### 底部信息栏
```xml
<line x1="60" y1="752" x2="540" y2="752" stroke="url(#accentGrad)" stroke-width="0.5" opacity="0.3"/>

<text x="50" y="774" fill="副文字色" font-family="sans-serif" font-size="9.5" opacity="0.7">
  <tspan>🏷️ 特色1</tspan>
  <tspan x="160">🎒 N件初始物品</tspan>
  <tspan x="310">💰 N金币</tspan>
  <tspan x="420">📜 基调</tspan>
</text>
```

#### 底部品牌（固定）
```xml
<text x="300" y="806" text-anchor="middle" fill="强调色" font-family="sans-serif"
      font-size="11" opacity="0.35" letter-spacing="3">心 隅 · XINYU</text>
```

---

## 三、嵌入的 JSON 数据规范

### 3.1 嵌入方式

在 SVG 的最后一个元素（底部品牌之后）嵌入：

```xml
<script type="application/json" id="xinyu-world-data">{JSON数据}</script>
```

> **关键**：`id` 必须是 `xinyu-world-data`，`type` 必须是 `application/json`。前端通过正则 `/<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/` 提取。

### 3.2 JSON 数据结构

```jsonc
{
  // 卡片元信息
  "name": "世界名：副标题",
  "genre": "奇幻|现代|科幻|武侠|末日|仙侠",
  "icon": "一个emoji",
  "description": "一句话描述（20字以内）",

  // 世界设定
  "world": {
    "name": "世界名称（2-4字）",
    "genre": "与外层genre一致",
    "description": "详细世界描述（200-400字），交代背景、冲突、玩家身份",
    "rules": "世界规则（200-400字），包含2-4个子系统",
    "tone": "史诗|轻松|黑暗|热血|温馨|悬疑",
    "customPrompt": "自定义指令（5-10条），指导AI如何叙事"
  },

  // 初始物品
  "starterItems": [
    {
      "name": "物品名",
      "type": "weapon|armor|consumable|misc|quest",
      "description": "物品描述（15-30字）",
      "quantity": 1,
      "effects": { "attack": 5, "hp": 30, "defense": 3 },
      "rarity": "common|uncommon|rare|epic|legendary"
    }
    // 4-6件物品
  ],

  // 起始信息
  "starterLocation": "起始地点名称",
  "starterLocationDesc": "起始地点场景描写（80-150字）",
  "starterGold": 200
}
```

### 3.3 JSON 字段校验清单

| 字段 | 必填 | 类型 | 约束 |
|------|------|------|------|
| `name` | ✅ | string | 不超过 20 字 |
| `genre` | ✅ | string | 见上方枚举 |
| `icon` | ✅ | string | 单个 emoji |
| `description` | ✅ | string | 不超过 30 字 |
| `world.name` | ✅ | string | 2-4 字 |
| `world.genre` | ✅ | string | 同 genre |
| `world.description` | ✅ | string | 200-400 字 |
| `world.rules` | ✅ | string | 200-400 字 |
| `world.tone` | ✅ | string | 见上方枚举 |
| `world.customPrompt` | ✅ | string | 5-10 条指令 |
| `starterItems` | ✅ | array | 4-6 件 |
| `starterLocation` | ✅ | string | 不超过 20 字 |
| `starterLocationDesc` | ✅ | string | 80-150 字 |
| `starterGold` | ✅ | number | 50-500 |

---

## 四、装饰元素设计指南

根据主题选择合适的装饰元素，增强视觉表现力：

### 4.1 背景装饰（可选，放在背景和内边框之间）

```xml
<!-- 示例：雾气效果（悬疑主题） -->
<g opacity="0.3" filter="url(#fogBlur)">
  <ellipse cx="100" cy="150" rx="120" ry="60" fill="#4a5568"/>
  <ellipse cx="500" cy="100" rx="100" ry="50" fill="#4a5568"/>
</g>

<!-- 示例：花瓣效果（恋爱主题） -->
<g opacity="0.3" filter="url(#petalBlur)">
  <ellipse cx="80" cy="120" rx="6" ry="4" fill="#f8bbd0" transform="rotate(-30 80 120)"/>
  <ellipse cx="520" cy="90" rx="5" ry="3" fill="#f48fb1" transform="rotate(20 520 90)"/>
</g>

<!-- 示例：星光效果（奇幻主题） -->
<g opacity="0.2">
  <circle cx="100" cy="100" r="1.5" fill="#ffd700"/>
  <circle cx="500" cy="80" r="1" fill="#ffd700"/>
  <circle cx="300" cy="50" r="1.5" fill="#ffd700"/>
</g>
```

### 4.2 章节装饰符号

每个主题使用统一的装饰符号：

| 主题 | 章节标题前缀 | 分隔线中心 | 顶部装饰 |
|------|-------------|-----------|----------|
| 奇幻 | ✦ | ◆ | ◆ |
| 校园 | ✿ | ♥ | ✿ |
| 悬疑 | ◆ | ◇ | ◇ |
| 赛博朋克 | ▸ | ◈ | ◈ |
| 武侠 | ◈ | ◇ | ◇ |
| 末日 | ▸ | ◆ | ◆ |
| 科幻 | ✦ | ◆ | ✧ |

### 4.3 文字颜色层次

每个主题需要定义 4 个层次的文字颜色：

| 层次 | 用途 | 奇幻示例 | 校园示例 | 悬疑示例 |
|------|------|----------|----------|----------|
| 标题色 | 章节标题、地点名 | `#e6c86e` | `#c2185b` | `#e2e8f0` |
| 正文色 | 概览描述 | `#b8a88a` | `#880e4f` | `#a0aec0` |
| 副文字色 | 地点副标题、起点描述 | `#8a7e6a` | `#880e4f` | `#718096` |
| 描述色 | 一句话描述 | `#c8b87a` | `#ad1457` | `#cbd5e0` |

---

## 五、文件命名与存储

### 5.1 命名规则

```
{世界名}_{主题类型}.svg
```

示例：
- `艾泽利亚_龙之纪元.svg`
- `樱花物语_校园恋曲.svg`
- `迷雾侦探_侦探悬疑.svg`
- `霓虹都市_赛博朋克.svg`

### 5.2 存储位置

```
/workspace/xinyu/world_cards/{文件名}.svg
```

---

## 六、质量检查清单

生成 SVG 后，逐项检查：

- [ ] 画布尺寸为 600×840
- [ ] 卡片背景有圆角 (rx=16) 和阴影
- [ ] 内边框装饰存在
- [ ] 顶部装饰线 + 两端圆点
- [ ] 类型标签居中，字间距合理
- [ ] 图标大小为 56px，居中
- [ ] 世界名称 28px 加粗，副标题 16px
- [ ] 分隔线居中，有装饰符号
- [ ] 世界概览文字不超过 6 行
- [ ] 地点区域为 2×2 网格，卡片有背景和边框
- [ ] 特色系统为横向标签排列
- [ ] 故事起点有地点和描述
- [ ] 底部信息栏有特色标签、物品数、金币、基调
- [ ] 底部品牌为「心隅 · XINYU」
- [ ] JSON 数据通过 `<script type="application/json" id="xinyu-world-data">` 嵌入
- [ ] JSON 所有必填字段完整
- [ ] starterItems 包含 4-6 件物品
- [ ] world.description 200-400 字
- [ ] world.rules 200-400 字
- [ ] world.customPrompt 5-10 条
- [ ] starterLocationDesc 80-150 字
- [ ] 配色方案与主题匹配
- [ ] 装饰元素与主题匹配
- [ ] 文字颜色层次分明（标题/正文/副文字/描述）
- [ ] 文件名符合 `{世界名}_{主题类型}.svg` 格式
