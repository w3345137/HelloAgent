# Hello Agent 🤖

[中文](#中文) | [English](#english)

---

<a id="中文"></a>

## 中文

> **你的数据，只属于你。** 一个具备记忆、技能和反思能力的自我进化 AI 智能体 — 完全在你的电脑上本地运行。

### 🔒 数据不外溢设计

Hello Agent 从架构层面确保你的数据安全：

- 🏠 **全本地运行** — 所有对话、记忆、文件操作都在你的电脑上完成，不经过任何第三方服务器
- 🧠 **本地记忆** — 6 层记忆系统完全存储在本地磁盘，不上传云端
- 🔐 **API 密钥本地存储** — 你的模型 API 密钥只保存在本地配置文件中
- 📂 **文件不外传** — 读写文件、执行命令都在本地完成，工具调用结果不回传外部
- 🛡️ **权限管控** — 文件访问、命令执行、应用调用都有白名单/黑名单控制

> 唯一的外部通信是你主动选择的 AI 模型 API 调用（如 OpenAI、Anthropic），这由你配置和控制。

### ✨ 功能特性

- 🧠 **6 层记忆系统** — 从身份到本能，记忆持久化并影响跨会话行为
- ⚡ **技能系统** — 从 GitHub 安装社区技能，或用简单的 SKILL.md 文件创建自己的技能
- 🔧 **20+ 内置工具** — 文件操作、Shell 执行、联网搜索、PPTX 解析、代码执行等
- 🪞 **自我反思** — 智能体回顾自身行为，从错误中学习，持续改进
- 🧬 **自我进化** — 可以提议、测试和应用代码变更（需人类审批）
- 🌐 **多模型支持** — 支持 OpenAI、Anthropic、MiniMax、智谱及自定义模型
- 📎 **@ 文件引用** — 在聊天中输入 `@` 注入文件上下文
- 🖼️ **图片支持** — 直接粘贴图片到聊天
- 🔄 **自动更新** — 从 GitHub Releases 检查更新，应用内下载安装

### 🚀 安装与使用

#### 推荐方式：下载 APP（最简单）

1. 前往 [Releases 页面](https://github.com/w3345137/HelloAgent/releases) 下载最新版本
   - **macOS**: 下载 `Hello-Agent-macOS.zip`，解压后拖入 `/Applications/`
   - **Windows**: 下载 `Hello-Agent-Windows.zip`，解压后运行 `start.bat`
   - **Linux**: 下载 `Hello-Agent-Linux.tar.gz`，解压后运行 `./start.sh`
2. 打开应用，在 **设置 → 资源配置** 中填入你的 AI 模型 API 密钥
3. 开始对话！

> 💡 下载 APP 是最简单的方式，无需安装 Node.js，无需命令行操作，开箱即用。

#### 从源码运行（开发者）

```bash
git clone https://github.com/w3345137/HelloAgent.git
cd HelloAgent
npm install
node src/core/main.js
# 然后在浏览器中打开 http://localhost:3000
```

### 🖥️ 平台支持

| 平台 | 启动方式 | 状态 |
|------|---------|------|
| macOS | 原生 `.app`（Objective-C + WKWebView） | ✅ 完整支持 |
| Windows | `start.bat` / `start.ps1` | ✅ 浏览器模式 |
| Linux | `start.sh` | ✅ 浏览器模式 |

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

支持多个 AI 模型供应商：**OpenAI**、**Anthropic**、**MiniMax**、**智谱** 及自定义 OpenAI 兼容端点。

在 **设置 → 资源配置** 中配置，或编辑 `src/config/models.json`。

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

### 📄 许可证

MIT 许可证 — 详见 [LICENSE](LICENSE)。

---

<a id="english"></a>

## English

> **Your data stays yours.** A self-evolving AI agent with memory, skills, and reflection — running entirely on your local machine.

### 🔒 Data-Local-First Design

Hello Agent ensures your data security at the architecture level:

- 🏠 **Fully Local** — All conversations, memories, and file operations happen on your machine — no third-party servers involved
- 🧠 **Local Memory** — The 6-layer memory system is stored entirely on your local disk, never uploaded to the cloud
- 🔐 **Local API Keys** — Your model API keys are only saved in local config files
- 📂 **No File Exfiltration** — File reads/writes and command execution are all local; tool call results are never sent externally
- 🛡️ **Permission Control** — Whitelist/blacklist control for file access, command execution, and app calls

> The only external communication is the AI model API calls you configure (e.g., OpenAI, Anthropic) — fully under your control.

### ✨ Features

- 🧠 **6-Layer Memory System** — From identity to instinct, memories persist and influence behavior across sessions
- ⚡ **Skill System** — Install community skills from GitHub, or create your own with a simple SKILL.md file
- 🔧 **20+ Built-in Tools** — File operations, shell execution, web search, PPTX parsing, code execution, and more
- 🪞 **Self-Reflection** — The agent reviews its own actions, learns from mistakes, and improves over time
- 🧬 **Self-Evolution** — Can propose, test, and apply code changes to itself (with human approval)
- 🌐 **Multi-Model Support** — Works with OpenAI, Anthropic, MiniMax, Zhipu, and custom adapters
- 📎 **@ File Reference** — Type `@` in chat to inject file context into your conversation
- 🖼️ **Image Support** — Paste images directly into chat
- 🔄 **Auto-Update** — Check for updates from GitHub Releases, download and install in-app

### 🚀 Installation

#### Recommended: Download the App (Easiest)

1. Go to the [Releases page](https://github.com/w3345137/HelloAgent/releases) and download the latest version
   - **macOS**: Download `Hello-Agent-macOS.zip`, unzip and move to `/Applications/`
   - **Windows**: Download `Hello-Agent-Windows.zip`, unzip and run `start.bat`
   - **Linux**: Download `Hello-Agent-Linux.tar.gz`, extract and run `./start.sh`
2. Open the app, go to **Settings → Resources** and enter your AI model API key
3. Start chatting!

> 💡 Downloading the app is the easiest way — no Node.js installation needed, no command line, just open and use.

#### From Source (Developers)

```bash
git clone https://github.com/w3345137/HelloAgent.git
cd HelloAgent
npm install
node src/core/main.js
# Then open http://localhost:3000 in your browser
```

### 🖥️ Platform Support

| Platform | Launcher | Status |
|----------|----------|--------|
| macOS | Native `.app` (Objective-C + WKWebView) | ✅ Full support |
| Windows | `start.bat` / `start.ps1` | ✅ Browser-based |
| Linux | `start.sh` | ✅ Browser-based |

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

Supports multiple AI model providers: **OpenAI**, **Anthropic**, **MiniMax**, **Zhipu**, and custom OpenAI-compatible endpoints.

Configure in **Settings → Resources**, or edit `src/config/models.json`.

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

### 📄 License

MIT License — see [LICENSE](LICENSE) for details.
