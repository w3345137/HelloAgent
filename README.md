# Hello Agent 🤖

> A self-evolving AI agent with memory, skills, and reflection — running natively on your machine.

Hello Agent is a desktop AI assistant that runs entirely on your local machine. Unlike cloud-only chatbots, it maintains persistent memory across sessions, learns skills from the community, and can evolve its own code through self-reflection.

## ✨ Features

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

## 🖥️ Platform Support

| Platform | Launcher | Status |
|----------|----------|--------|
| macOS | Native `.app` (Objective-C + WKWebView) | ✅ Full support |
| Windows | `start.bat` / `start.ps1` | ✅ Browser-based |
| Linux | `start.sh` | ✅ Browser-based |

## 🚀 Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) v18+
- An AI model API key (OpenAI, Anthropic, etc.)

### macOS (Native App)

1. Download `Hello Agent.app.zip` from [Releases](https://github.com/w3345137/HelloAgent/releases)
2. Unzip and move to `/Applications/`
3. Open Hello Agent
4. Configure your API key in Settings → Resources

### Windows / Linux (From Source)

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

## 🏗️ Architecture

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

### Core Modules

| Module | Description |
|--------|-------------|
| `Brain` | Processes user input, orchestrates tool calls |
| `StateMachine` | Manages execution states: IDLE → PLANNING → EXECUTING |
| `UnifiedMemory` | 6-layer memory: Identity → Global → Project → Experience → Instinct → Short-term |
| `SkillLoader` | Loads and manages SKILL.md-based skills |
| `Evolution` | Self-evolution through Sensor, Diagnosis, Sandbox, and Surgeon |
| `Reflection` | Post-action review and learning |
| `PermissionManager` | Whitelist/blacklist access control |

## 🔌 Model Configuration

Hello Agent supports multiple AI model providers:

- **OpenAI** — GPT-4, GPT-4o, GPT-3.5
- **Anthropic** — Claude 3.5, Claude 3
- **Custom** — Any OpenAI-compatible API endpoint
- **MiniMax** — Via dedicated adapter
- **Zhipu (智谱)** — Via dedicated adapter

Configure in Settings → Resources, or edit `src/config/models.json`.

## 🛠️ Built-in Tools

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

## 📦 Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `HELLO_AGENT_PORT` | HTTP server port | `3000` |
| `GITHUB_REPO` | GitHub repo for auto-updates (format: `owner/repo`) | — |
| `GITHUB_TOKEN` | GitHub token for API access (avoids rate limits) | — |
| `APP_PATH` | App installation path for updates | `/Applications/Hello Agent.app` |

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.
