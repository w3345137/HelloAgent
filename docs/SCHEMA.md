# SCHEMA.md — 创世纪模块自描述规范

本文档定义了创世纪系统中各模块的输入输出、依赖关系和能力边界。

---

## 核心模块 (core/)

### state-machine.js
**描述**：状态机驱动，管理系统的五种状态。

**状态定义**：
- `IDLE` — 空闲，等待指令
- `PLANNING` — 规划中，Brain 正在处理
- `EXECUTING` — 执行中，模块正在操作
- `INTERRUPTING` — 中断中
- `RECOVERING` — 恢复中

**合法转换**：
```
IDLE → PLANNING
PLANNING → EXECUTING | IDLE
EXECUTING → IDLE | INTERRUPTING
INTERRUPTING → IDLE
RECOVERING → IDLE
```

**接口**：
- `stateMachine.state` — 当前状态
- `stateMachine.transition(to)` — 状态转换
- `stateMachine.forceReset()` — 强制回到 IDLE

**事件**：
- 发布 `STATE` 事件（状态变更时）

---

### message-bus.js
**描述**：异步事件总线，基于 EventEmitter。

**接口**：
- `messageBus.subscribe(event, handler)` — 订阅事件
- `messageBus.publish(event, data)` — 发布事件

---

### brain.js
**描述**：AI 大脑，接收用户指令，支持多轮工具调用（Anthropic tool_use 协议）。

**输入**：
- `USER_INPUT` 事件 — 用户文本指令

**输出**：
- `CHAT_REPLY` 事件 — AI 回复文本（含 usage 统计）
- `EXECUTE` 事件 — 工具调用可视化
- `TOOL_START` / `TOOL_DONE` 事件 — 工具执行追踪

**依赖**：
- `adapters/adapter-factory` — 多协议模型适配器
- `state-machine` — 状态管理

**内置工具**：
- `weather` — 天气查询（wttr.in）
- `web_search` — 网络搜索（Bing + DuckDuckGo）
- `http_get` — HTTP GET 请求
- `shell_execute` — 命令执行
- `app_open` — 打开应用
- `file_read` / `file_write` — 文件读写

---

### executor.js
**描述**：执行调度器，分发指令到对应模块。

**输入**：
- `EXECUTE` 事件 — 模块执行指令

**输出**：
- `EXECUTE_RESULT` 事件 — 执行结果
- `ERROR` 事件 — 执行错误

**注册模块**：
- `file` — 文件操作
- `http` — 网络请求

---

### sensor.js
**描述**：观测层，监控错误并触发进化。

**输入**：
- `ERROR` 事件 — 系统错误

**输出**：
- `EVOLVE` 事件 — 触发进化

**配置**：
- `errorThreshold` — 错误阈值（默认 3）
- `windowMs` — 时间窗口（默认 60000ms）

---

### evolution.js
**描述**：进化层，AI 诊断并生成修复补丁。

**输入**：
- `EVOLVE` 事件 — 进化触发

**输出**：
- `HOT_RELOAD` 事件 — 触发热重载

**依赖**：
- `minimax-adapter` — AI 模型适配器
- `surgeon` — 手术刀工具

---

### surgeon.js
**描述**：手术刀工具，安全修改系统代码。

**能力**：
- `readSource(modulePath)` — 读取源代码
- `applyPatch(modulePath, content, reason)` — 应用补丁
- `runTests(modulePath, testCode)` — 运行测试
- `rollback(versionId)` — 回滚版本
- `listVersions(modulePath)` — 列出版本历史

---

### hot-reloader.js
**描述**：热重载，清除 require.cache 并重新加载模块。

**输入**：
- `HOT_RELOAD` 事件 — 重载指令

**输出**：
- `HOT_RELOAD_RESULT` 事件 — 重载结果

---

### logger.js
**描述**：日志持久化，写入 logs/ 目录。

**接口**：
- `logger.info(category, message, data)`
- `logger.warn(category, message, data)`
- `logger.error(category, message, data)`
- `logger.state(from, to)` — 状态变更
- `logger.chat(direction, text)` — 聊天记录
- `logger.execute(module, params)` — 执行记录
- `logger.evolve(trigger, details)` — 进化记录

**日志轮转**：
- 单文件最大 5MB
- 保留最新 5 个日志文件

---

### path-manager.js
**描述**：统一路径管理，隔离文件操作。

**接口**：
- `pathManager.getDataDir()` — 获取数据根目录
- `pathManager.getSandboxDir(name)` — 获取沙盒目录
- `pathManager.resolve(relativePath, sandbox)` — 解析路径
- `pathManager.isSandboxed(fullPath, sandbox)` — 检查沙盒
- `pathManager.isReadonly(fullPath)` — 检查只读
- `pathManager.listModules()` — 列出所有模块

---

### session-manager.js
**描述**：任务（Session）管理，对话历史和独立记忆持久化。

**接口**：
- `sessionManager.create(meta)` — 创建 session
- `sessionManager.get(key)` — 获取 session
- `sessionManager.list()` — 列出所有 sessions
- `sessionManager.update(key, updates)` — 更新元数据
- `sessionManager.delete(key)` — 删除 session
- `sessionManager.getHistory(key)` — 获取对话历史
- `sessionManager.appendHistory(key, message)` — 追加消息
- `sessionManager.updateTokens(key, input, output)` — 更新 Token 统计
- `sessionManager.getMemory(key, layer)` — 获取独立记忆
- `sessionManager.setMemory(key, layer, content)` — 设置独立记忆

---

### permission-manager.js
**描述**：权限管理器，控制文件访问、命令执行、应用调用权限。

**接口**：
- `permissionManager.checkFileAccess(path, action)` — 检查文件权限
- `permissionManager.checkShellCommand(command)` — 检查命令权限
- `permissionManager.checkAppAccess(appName)` — 检查应用权限
- `permissionManager.updatePermissions(config)` — 更新配置
- `permissionManager.addFilePath(config)` — 添加路径
- `permissionManager.addAllowedCommand(config)` — 添加命令
- `permissionManager.addAllowedApp(config)` — 添加应用
- `permissionManager.resetToDefault()` — 重置默认

**模式**：白名单 / 黑名单 / 无限制

---

### memory-manager.js
**描述**：三层记忆管理系统。

**记忆层级**：
- 长期记忆（~500 tokens）：`Data/memory/long-memory.md`
- 中期记忆（~2000 tokens）：`{workFolder}/memorys/mid-memory.md`
- 短期记忆（~1000 tokens）：`session/{key}/memory/short-memory.md`

**接口**：
- `memoryManager.getLongMemory()` / `setLongMemory(content)`
- `memoryManager.getMidMemory(workFolder)` / `setMidMemory(workFolder, content)`
- `memoryManager.getShortMemory(dir)` / `setShortMemory(dir, content)`
- `memoryManager.injectContext(workFolder, sessionMemoryDir)` — 注入三层记忆

---

### test-runner.js
**描述**：沙盒测试运行器，用于进化层的补丁验证。

**接口**：
- `testRunner.createSandbox(modulePath, patchCode)` — 创建沙盒
- `testRunner.runTests(modulePath)` — 运行测试（语法检查 + 模块加载 + 单元测试）
- `testRunner.cleanupSandbox()` — 清理沙盒

---

## 执行模块 (modules/)

### adapters/
**描述**：多协议模型适配器系统。

**组件**：
- `base-adapter.js` — 基础接口（chat, test）
- `anthropic-adapter.js` — Anthropic 协议（兼容 MiniMax）
- `openai-adapter.js` — OpenAI 协议（兼容所有 OpenAI 兼容 API）
- `adapter-factory.js` — 适配器工厂（单例，自动检测协议）

**统一响应格式**：
```json
{ "text": "", "toolCalls": [], "stopReason": "", "usage": { "input": 0, "output": 0 } }
```

---

### minimax-adapter.js（已废弃）
**描述**：旧版 MiniMax 适配器，已被 `adapters/anthropic-adapter.js` 取代。保留仅为向后兼容。

**接口**：
- `adapter.chat(messages, options)` — 发送对话

**配置**：
- API Key 从 config.json 或环境变量读取
- 支持 `signal` 参数用于中断

---

### file-executor.js
**描述**：文件读写执行器。

**ACTION 参数**：
```json
{
  "action": "read|write|list|delete",
  "filePath": "相对路径",
  "content": "写入内容（仅 write）"
}
```

**沙盒**：所有操作限制在 `workspace/` 目录内。

---

### http-executor.js
**描述**：网络请求执行器。

**ACTION 参数**：
```json
{
  "url": "请求URL",
  "method": "GET|POST|PUT|DELETE",
  "headers": {},
  "body": "请求体",
  "timeout": 30000,
  "action": "search|fetch（可选）"
}
```

**特殊能力**：
- `search` — 网络搜索（DuckDuckGo）
- `fetch` — 网页抓取

---

### web-bridge.js
**描述**：HTTP API + WebSocket 桥接。

**HTTP API**：
- `POST /api/input` — 发送用户输入
- `POST /api/interrupt` — 发送中断信号

**WebSocket 消息类型**：
- `STATE` — 状态变更
- `CHAT_REPLY` — AI 回复
- `EXECUTE` — 执行指令
- `EXECUTE_RESULT` — 执行结果
- `ERROR` — 错误
- `EVOLVE` — 进化触发
- `HOT_RELOAD` — 热重载

---

## 事件流程图

```
用户输入
    ↓
[USER_INPUT] → Brain
    ↓
[STATE: PLANNING] → 状态机
    ↓
Brain 解析 → [EXECUTE] → Executor
    ↓
[STATE: EXECUTING]
    ↓
Executor 分发 → 模块执行
    ↓
[EXECUTE_RESULT] 或 [ERROR]
    ↓
[STATE: IDLE]

错误累积 → Sensor → [EVOLVE] → Evolution
    ↓
Surgeon 应用补丁 → [HOT_RELOAD] → HotReloader
```

---

## 目录结构

```
Data/
├── core/           # 核心模块（只读）
├── modules/        # 执行模块（只读）
├── workspace/      # 用户工作区（可写）
├── logs/           # 日志目录（可写）
├── memory/         # 记忆存储（可写）
├── patches/        # 补丁记录（可写）
├── sandbox/        # 沙盒测试（可写）
├── versions/       # 版本备份（可写）
├── config.json     # 配置文件
├── MANIFEST.json   # 模块清单
└── SCHEMA.md       # 本文档
```
