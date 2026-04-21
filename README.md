# Hello Agent 🤖

[English](#english) | [中文](#中文)

---

<a id="english"></a>

## English

> A self-evolving AI agent with memory, skills, and reflection — running natively on your machine.

Hello Agent is a desktop AI assistant that runs entirely on your local machine. Unlike cloud-only chatbots, it maintains persistent memory across sessions, learns skills from the community, and can evolve its own code through self-reflection.

### ✨ Features

- 🧠 **6-Layer Memory System** — From identity to instinct, memories persist and influence behavior across sessions
- ⚡ **Skill System** — Install community skills from GitHub, or create your own with a simple SKILL.md file
- 🔧 **20+ Built-in Tools** — File operations, shell execution, web search, PPTX parsing, code execution, and more
- 🪞 **Self-Reflection** — The agent reviews its own actions, learns from mistakes, and improves over time
- 🧬 **Self-Evolution** — Can propose, test, and apply code changes to itself (with human approval)
- 🔐 **Permission System** — Fine-grained control over file access, command execution, and app calls
- 🌐 **Multi-Model Support** — Works with OpenAI, Anthropic, and custom model adapters
- 📎 **@ File Reference** — Type `@` in chat to inject file context into your conversation
- 🖼️ **Image Support** — Paste images directly into chat
- 🔄 **Auto-Update** — Check for updates from GitHub Releases, download and install in-app

### 🖥️ Platform Support

| Platform | Launcher | Status |
|----------|----------|--------|
| macOS | Native `.app` (Objective-C + WKWebView) | ✅ Full support |
| Windows | `start.bat` / `start.ps1` | ✅ Browser-based |
| Linux | `start.sh` | ✅ Browser-based |

### 🚀 Quick Start

#### Prerequisites

- [Node.js](https://nodejs.org/) v18+
- An AI model API key (OpenAI, Anthropic, etc.)

#### macOS (Native App)

1. Download `Hello Agent.app.zip` from [Releases](https://github.com/w3345137/HelloAgent/releases)
2. Unzip and move to `/Applications/`
3. Open Hello Agent
4. Configure your API key in Settings → Resources

#### Windows / Linux (From Source)

```bash
git clone https://github.com/w3345137/HelloAgent.git
cd HelloAgent
npm install

# Windows
scripts\windows\start.bat

# Linux / macOS
./scripts/linux/start.sh

# Or run directly
node src/core/main.js
```

Then open http://localhost:3000 in your browser.

### 🏗️ Architecture

```
┌─────────────────────────────────────────┐
│           Hello Agent.app (macOS)       │
│  ┌───────────┐  ┌────────────────────┐  │
│  │  Obj-C    │  │    WKWebView       │  │
│  │  Shell    │──│    (Frontend)      │  │
│  └───────────┘  └────────┬───────────┘  │
│                          │ HTTP/WS       │
│  ┌───────────────────────▼────────────┐  │
│  │         Node.js Backend            │  │
│  │  ┌──────┐ ┌──────┐ ┌───────────┐  │  │
│  │  │Brain │ │Memory│ │Tool System│  │  │
│  │  └──────┘ └──────┘ └───────────┘  │  │
│  │  ┌──────────┐ ┌────────────────┐  │  │
│  │  │Evolution │ │State Machine   │  │  │
│  │  └──────────┘ └────────────────┘  │  │
│  └────────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

#### Core Modules

| Module | Description |
|--------|-------------|
| `Brain` | Processes user input, orchestrates tool calls |
| `StateMachine` | Manages execution states: IDLE → PLANNING → EXECUTING |
| `UnifiedMemory` | 6-layer memory: Identity → Global → Project → Experience → Instinct → Short-term |
| `SkillLoader` | Loads and manages SKILL.md-based skills |
| `Evolution` | Self-evolution through Sensor, Diagnosis, Sandbox, and Surgeon |
| `Reflection` | Post-action review and learning |
| `PermissionManager` | Whitelist/blacklist access control |

### 🔌 Model Configuration

Hello Agent supports multiple AI model providers:

- **OpenAI** — GPT-4, GPT-4o, GPT-3.5
- **Anthropic** — Claude 3.5, Claude 3
- **Custom** — Any OpenAI-compatible API endpoint
- **MiniMax** — Via dedicated adapter
- **Zhipu (智谱)** — Via dedicated adapter

Configure in Settings → Resources, or edit `src/config/models.json`.

### 🛠️ Built-in Tools

| Tool | Description |
|------|-------------|
| `file_read` / `file_write` | Read and write files |
| `file_edit` | Precise string replacement in files (with diff output) |
| `shell_execute` | Execute shell commands |
| `web_search` | Search the web (Bing + DuckDuckGo) |
| `web_fetch` | Fetch and extract web page content |
| `pptx_parse` | Parse PPTX files including master slides |
| `pptx_to_html` | Convert PPTX to interactive HTML |
| `code_execute` | Run code in sandboxed environment |
| `memory_query` / `memory_store` | Access the memory system |
| `weather` | Weather queries |
| `browser_check` | Browser automation via Playwright MCP |

### 📦 Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `HELLO_AGENT_PORT` | HTTP server port | `3000` |
| `GITHUB_REPO` | GitHub repo for auto-updates (`owner/repo`) | — |
| `GITHUB_TOKEN` | GitHub token for API access | — |
| `APP_PATH` | App installation path for updates | `/Applications/Hello Agent.app` |

### 📄 License

MIT License — see [LICENSE](LICENSE) for details.

---

<a id="中文"></a>

## 中文

> 一个具备记忆、技能和反思能力的自我进化 AI 智能体 — 在你的电脑上本地运行。

Hello Agent 是一个完全在本地运行的桌面 AI 助手。与纯云端聊天机器人不同，它能在会话之间保持持久记忆，从社区学习技能，并通过自我反思来进化自身代码。

### ✨ 功能特性

- 🧠 **6 层记忆系统** — 从身份到本能，记忆持久化并影响跨会话行为
- ⚡ **技能系统** — 从 GitHub 安装社区技能，或用简单的 SKILL.md 文件创建自己的技能
- 🔧 **20+ 内置工具** — 文件操作、Shell 执行、联网搜索、PPTX 解析、代码执行等
- 🪞 **自我反思** — 智能体回顾自身行为，从错误中学习，持续改进
- 🧬 **自我进化** — 可以提议、测试和应用代码变更（需人类审批）
- 🔐 **权限系统** — 对文件访问、命令执行和应用调用进行精细控制
- 🌐 **多模型支持** — 支持 OpenAI、Anthropic 及自定义模型适配器
- 📎 **@ 文件引用** — 在聊天中输入 `@` 注入文件上下文
- 🖼️ **图片支持** — 直接粘贴图片到聊天
- 🔄 **自动更新** — 从 GitHub Releases 检查更新，应用内下载安装

### 🖥️ 平台支持

| 平台 | 启动方式 | 状态 |
|------|---------|------|
| macOS | 原生 `.app`（Objective-C + WKWebView） | ✅ 完整支持 |
| Windows | `start.bat` / `start.ps1` | ✅ 浏览器模式 |
| Linux | `start.sh` | ✅ 浏览器模式 |

### 🚀 快速开始

#### 前置条件

- [Node.js](https://nodejs.org/) v18+
- AI 模型 API 密钥（OpenAI、Anthropic 等）

#### macOS（原生应用）

1. 从 [Releases](https://github.com/w3345137/HelloAgent/releases) 下载 `Hello Agent.app.zip`
2. 解压并移至 `/Applications/`
3. 打开 Hello Agent
4. 在 设置 → 资源配置 中配置 API 密钥

#### Windows / Linux（从源码运行）

```bash
git clone https://github.com/w3345137/HelloAgent.git
cd HelloAgent
npm install

# Windows
scripts\windows\start.bat

# Linux / macOS
./scripts/linux/start.sh

# 或直接运行
node src/core/main.js
```

然后在浏览器中打开 http://localhost:3000。

### 🏗️ 架构

```
┌─────────────────────────────────────────┐
│           Hello Agent.app (macOS)       │
│  ┌───────────┐  ┌────────────────────┐  │
│  │  Obj-C    │  │    WKWebView       │  │
│  │  壳程序   │──│    (前端界面)       │  │
│  └───────────┘  └────────┬───────────┘  │
│                          │ HTTP/WS       │
│  ┌───────────────────────▼────────────┐  │
│  │         Node.js 后端               │  │
│  │  ┌──────┐ ┌──────┐ ┌───────────┐  │  │
│  │  │ 大脑 │ │ 记忆 │ │ 工具系统  │  │  │
│  │  └──────┘ └──────┘ └───────────┘  │  │
│  │  ┌──────────┐ ┌────────────────┐  │  │
│  │  │ 进化引擎 │ │ 状态机        │  │  │
│  │  └──────────┘ └────────────────┘  │  │
│  └────────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

#### 核心模块

| 模块 | 说明 |
|------|------|
| `Brain` | 处理用户输入，编排工具调用 |
| `StateMachine` | 管理执行状态：空闲 → 规划 → 执行 |
| `UnifiedMemory` | 6 层记忆：身份 → 全局 → 项目 → 经验 → 本能 → 短期 |
| `SkillLoader` | 加载和管理基于 SKILL.md 的技能 |
| `Evolution` | 通过传感器、诊断、沙箱和外科医生实现自我进化 |
| `Reflection` | 行动后回顾与学习 |
| `PermissionManager` | 白名单/黑名单访问控制 |

### 🔌 模型配置

Hello Agent 支持多个 AI 模型供应商：

- **OpenAI** — GPT-4、GPT-4o、GPT-3.5
- **Anthropic** — Claude 3.5、Claude 3
- **自定义** — 任何兼容 OpenAI 的 API 端点
- **MiniMax** — 通过专用适配器
- **智谱** — 通过专用适配器

在 设置 → 资源配置 中配置，或编辑 `src/config/models.json`。

### 🛠️ 内置工具

| 工具 | 说明 |
|------|------|
| `file_read` / `file_write` | 读写文件 |
| `file_edit` | 精确字符串替换（带 diff 输出） |
| `shell_execute` | 执行 Shell 命令 |
| `web_search` | 联网搜索（Bing + DuckDuckGo） |
| `web_fetch` | 抓取并提取网页内容 |
| `pptx_parse` | 解析 PPTX 文件（含母版层） |
| `pptx_to_html` | 将 PPTX 转换为交互式 HTML |
| `code_execute` | 在沙箱中运行代码 |
| `memory_query` / `memory_store` | 访问记忆系统 |
| `weather` | 天气查询 |
| `browser_check` | 通过 Playwright MCP 进行浏览器自动化 |

### 📦 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `HELLO_AGENT_PORT` | HTTP 服务端口 | `3000` |
| `GITHUB_REPO` | 自动更新用的 GitHub 仓库（格式：`owner/repo`） | — |
| `GITHUB_TOKEN` | GitHub API 访问令牌（避免速率限制） | — |
| `APP_PATH` | 应用安装路径（用于更新） | `/Applications/Hello Agent.app` |

### 📄 许可证

MIT 许可证 — 详见 [LICENSE](LICENSE)。
