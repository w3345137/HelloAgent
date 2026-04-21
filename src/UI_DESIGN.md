# 创世纪前端设计规范

## 设计原则

**简洁高效**：保持界面干净，信息层级清晰，减少视觉噪音。
**深色主题**：延续当前深空主题，体现创世纪的宇宙感。
**可扩展性**：组件化设计，支持未来功能扩展。

---

## 色彩系统

```css
/* 主色板 */
--bg-primary: #1a1a2e;      /* 主背景 */
--bg-secondary: #16213e;    /* 次级背景（卡片、输入框） */
--bg-tertiary: #0f3460;     /* 第三级背景（按钮、标签） */
--accent: #e94560;          /* 主强调色（品牌红） */
--accent-success: #4ecca3;  /* 成功/正常状态 */
--accent-warning: #f5a623;  /* 警告/计划状态 */
--accent-error: #ff6b6b;    /* 错误/恢复状态 */

/* 文字色 */
--text-primary: #e0e0e0;    /* 主要文字 */
--text-secondary: #a0a0a0;  /* 次要文字 */
--text-muted: #666666;      /* 弱化文字 */

/* 边框色 */
--border: #0f3460;          /* 默认边框 */
--border-focus: #e94560;    /* 聚焦边框 */
```

---

## 组件规范

### 1. 任务列表 (Task List)

**功能**：
- 显示所有任务（sessions）
- 支持创建新任务
- 每个任务显示：名称、状态、模型、Token消耗

**布局**：
```
┌─────────────────────────────────────┐
│ 任务列表                    [+ 新建] │
├─────────────────────────────────────┤
│ ● 项目重构                      IDLE │
│   MiniMax-2.7 · ↑1.2K ↓300            │
│   ~/workspace/project                 │
├─────────────────────────────────────┤
│ ○ 数据分析                   EXECUTING │
│   Claude-3.5 · ↑2.5K ↓1.1K            │
│   ~/workspace/data                    │
└─────────────────────────────────────┘
```

**样式**：
```css
.task-list {
  background: var(--bg-secondary);
  border-right: 1px solid var(--border);
}

.task-item {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
}

.task-item.active {
  background: var(--bg-tertiary);
}

.task-item-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.task-status {
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 10px;
  font-weight: 600;
}

.task-status.idle { background: var(--accent-success); color: var(--bg-primary); }
.task-status.executing { background: var(--accent); color: #fff; }
.task-status.planning { background: var(--accent-warning); color: var(--bg-primary); }
```

### 2. 三层记忆面板 (Memory Panel)

**功能**：
- 长期记忆：全局知识（~500 tokens）
- 中期记忆：项目级架构（~2000 tokens）
- 短期记忆：任务进展（~1000 tokens）

**布局**：
```
┌─────────────────────────────────────┐
│ 🧠 记忆链                             │
│                                      │
│ [长期] [中期] [短期]                  │
├─────────────────────────────────────┤
│ 对自己、对用户、对世界的永久认知        │
│                                      │
│ ┌─────────────────────────────────┐ │
│ │ # 长期记忆                       │ │
│ │                                  │ │
│ │ 用户是个程序员...                │ │
│ │ 项目：创世纪系统...              │ │
│ └─────────────────────────────────┘ │
│                                      │
│           [保存]                     │
└─────────────────────────────────────┘
```

**样式**：
```css
.memory-tabs {
  display: flex;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
}

.memory-tab {
  padding: 8px 16px;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid var(--border);
  cursor: pointer;
}

.memory-tab.active {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}

.memory-editor {
  width: 100%;
  min-height: 300px;
  padding: 16px;
  background: var(--bg-primary);
  color: var(--text-primary);
  border: none;
  font-family: 'SF Mono', monospace;
  font-size: 13px;
  resize: vertical;
}
```

### 3. 工具调用可视化 (Tool Call Visualization)

**功能**：
- 显示工具名称、输入参数
- 显示执行状态（运行中/完成/错误）
- 折叠显示详细输出

**布局**：
```
┌─────────────────────────────────────┐
│ ⏳ 正在读取文件...                   │
│ 📖 读取文件                          │
│ src/core/brain.js                    │
│ [展开详情]                           │
├─────────────────────────────────────┤
│ ✓ 执行命令                           │
│ $ npm test                           │
│ [展开详情]                           │
│   输出: 5 passing...                 │
└─────────────────────────────────────┘
```

**样式**：
```css
.tool-call {
  margin: 8px 0;
  padding: 12px;
  background: var(--bg-secondary);
  border-radius: 8px;
  border-left: 3px solid var(--accent-warning);
}

.tool-call.start { border-left-color: var(--accent-warning); }
.tool-call.done { border-left-color: var(--accent-success); }
.tool-call.error { border-left-color: var(--accent-error); }

.tool-call summary {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  list-style: none;
}

.tool-icon { font-size: 16px; }
.tool-name { font-weight: 600; color: var(--text-primary); }
.tool-summary { color: var(--text-secondary); font-size: 12px; }

.tool-details {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
}

.tool-details code {
  display: block;
  padding: 8px;
  background: var(--bg-primary);
  border-radius: 4px;
  font-size: 12px;
  overflow-x: auto;
}
```

### 4. Token 统计指示器 (Token Indicator)

**功能**：
- 显示当前对话的 Token 消耗
- 区分：输入、输出、记忆注入、总计

**布局**：
```
                 ┌────────────────────┐
                 │ Token 估算          │
                 │ 输入: ~1.2K         │
                 │ 对话历史: ~3.5K     │
                 │ 记忆注入: ~500      │
                 │ ────────────        │
                 │ 总计: ~5.2K         │
                 └────────────────────┘
           ~5.2K ⚙
```

**样式**：
```css
.token-indicator {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--text-secondary);
  font-size: 12px;
  position: relative;
}

.token-count {
  padding: 4px 8px;
  background: var(--bg-tertiary);
  border-radius: 4px;
  cursor: help;
}

.token-tooltip {
  display: none;
  position: absolute;
  bottom: 100%;
  right: 0;
  margin-bottom: 8px;
  padding: 12px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 8px;
  min-width: 200px;
  z-index: 100;
}

.token-indicator:hover .token-tooltip {
  display: block;
}

.token-tooltip-row {
  display: flex;
  justify-content: space-between;
  padding: 4px 0;
}

.token-tooltip-row.total {
  border-top: 1px solid var(--border);
  margin-top: 4px;
  padding-top: 8px;
  font-weight: 600;
}
```

### 5. 对话气泡 (Chat Bubble)

**功能**：
- 区分用户和 AI 消息
- 支持流式显示
- 显示时间戳、模型、Token 消耗

**布局**：
```
用户消息（右对齐）：
        ┌─────────────────────┐
        │ 继续完成剩余工作     │
        │ 13:45 · 📎 2 个附件  │
        └─────────────────────┘

AI 消息（左对齐）：
┌─────────────────────────────────────┐
│ ⏳ 读取文件 src/core/brain.js...    │
│                                      │
│ 好的，我已经读取了文件...            │
│                                      │
│ 13:45 · MiniMax-2.7 · ↑1.2K ↓300   │
└─────────────────────────────────────┘
```

**样式**：
```css
.chat-bubble {
  max-width: 80%;
  margin: 12px;
  padding: 12px 16px;
  border-radius: 12px;
}

.chat-bubble.user {
  margin-left: auto;
  background: var(--accent);
  color: #fff;
}

.chat-bubble.assistant {
  margin-right: auto;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
}

.bubble-time {
  margin-top: 8px;
  font-size: 11px;
  color: var(--text-muted);
}

.streaming-cursor {
  display: inline-block;
  animation: pulse 1s infinite;
}

@keyframes pulse {
  0%, 50% { opacity: 1; }
  51%, 100% { opacity: 0; }
}
```

---

## 图标映射

工具调用图标映射表：

| 工具名称 | 图标 | 中文标签 |
|---------|------|---------|
| read | 📖 | 读取文件 |
| write | 💾 | 保存文件 |
| edit | ✏️ | 修改文件 |
| apply_patch | 🩹 | 应用补丁 |
| exec | 💻 | 执行命令 |
| process | ⚙️ | 管理进程 |
| web_search | 🔍 | 搜索网页 |
| web_fetch | 🌐 | 获取网页 |
| memory_recall | 🧠 | 读取记忆 |
| memory_store | 🧠 | 保存记忆 |
| file | 📁 | 文件操作 |
| http | 🌐 | 网络请求 |

---

## 字体规范

```css
/* 代码字体 */
font-family: 'SF Mono', 'Menlo', 'Monaco', monospace;

/* UI 字体 */
font-family: -apple-system, 'SF Pro Text', 'Helvetica Neue', sans-serif;

/* 字号 */
--font-size-xs: 10px;   /* 辅助信息 */
--font-size-sm: 12px;   /* 次要文字 */
--font-size-base: 14px; /* 正文 */
--font-size-lg: 16px;   /* 标题 */
--font-size-xl: 18px;   /* 大标题 */
```

---

## 响应式设计

```
桌面端（>= 1024px）：
- 左侧任务列表（固定 280px）
- 中间对话区域（flex: 1）
- 右侧记忆面板（可折叠，320px）

平板端（768px - 1023px）：
- 任务列表改为下拉菜单
- 记忆面板改为模态框

移动端（< 768px）：
- 全屏对话
- 底部 Tab 导航（对话/任务/记忆）
```

---

## 动画

```css
/* 加载旋转 */
.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* 淡入 */
.fade-in {
  animation: fadeIn 0.3s ease-in;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

/* 滑入 */
.slide-up {
  animation: slideUp 0.3s ease-out;
}

@keyframes slideUp {
  from { transform: translateY(10px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}
```

---

## 实施路径

### 第一阶段：任务列表机制
1. 扩展 `web-bridge.js` 添加 sessions 管理 API
2. 实现前端任务列表组件
3. 每个任务独立存储对话历史和记忆

### 第二阶段：三层记忆系统
1. 创建 `memory-manager.js` 模块
2. 实现长期/中期/短期记忆文件读写
3. 任务开始时注入记忆，结束时压缩更新

### 第三阶段：UI 增强
1. 重构前端为组件化结构
2. 实现工具调用可视化
3. 实现 Token 统计指示器
