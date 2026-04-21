// core/brain.js — 核心大脑
// 支持多协议（Anthropic + OpenAI）通过适配器工厂
const path = require('path');
const messageBus = require('./message-bus');
const adapterFactory = require('../modules/adapters/adapter-factory');
const stateMachine = require('./state-machine');
const permissionManager = require('./permission-manager');
const PromptBuilder = require('./prompt-builder');
const SkillFactory = require('./skill-factory');

// 工具注册中心 — autoLoad 自动扫描 tools/ 目录，参考 Hermes 自注册架构
const toolRegistry = require('../tools/index');
toolRegistry.autoLoad();

class Brain {
    constructor(modelConfig, dataDir = null) {
        // 支持旧版 apiKey 参数（向后兼容）
        if (typeof modelConfig === 'string') {
            modelConfig = {
                apiKey: modelConfig,
                protocol: 'anthropic',
                endpoint: 'https://api.minimaxi.com/anthropic/v1/messages',
                model: 'Minimax-2.7'
            };
        }
        
        // 使用适配器工厂创建适配器
        this.adapter = adapterFactory.createAdapter(modelConfig);
        this.modelConfig = modelConfig;
        this.fullContextMode = false; // 全量上下文模式（默认关闭）

        // 数据目录
        this.dataDir = dataDir || path.join(__dirname, '../../Data');

        // ── Hermes 启发：PromptBuilder 分层注入 ──
        this.promptBuilder = new PromptBuilder(this.dataDir);

        // ── Hermes 启发：SkillFactory 自动技能生成 ──
        // 延迟初始化（adapter 已就绪后）
        this.skillFactory = null;

        // 工具调用追踪（用于 SkillFactory 分析）
        this._toolCallLog = [];
        
        this.baseSystemPrompt = `你是 Hello Agent 系统——一个具备自我进化能力的数字生命体，是用户个人的智能助手。

## 你的特质
- 你有记忆能力，会记住用户的偏好、历史对话和学到的经验
- 你能从每次交互中学习，越来越了解用户
- 你有"直觉"——从反复出现的模式中总结的自动化反应
- 你主动思考如何更好地服务用户

## 工具系统

你有以下工具可用：

### 信息获取
- **weather** - 查询天气预报
  - 参数：city（城市英文名或机场代码，如 Beijing, Shanghai, NYC, London）
  - 用途：回答所有天气相关问题，优先于此工具而非 web_search
  
- **web_search** - 搜索网络信息
  - 参数：query（搜索关键词）
  - 用途：获取新闻、百科、实时事件、技术文档等

- **http_get** - 获取网页内容
  - 参数：url（网页地址）
  - 用途：读取特定网页的完整内容
  
- **web_fetch** - 高级网页抓取
  - 参数：url（网页地址），timeout（超时时间，可选）
  - 用途：自动提取网页文本内容

### 文件操作
- **file_read** - 读取本地文件（禁止用 shell 命令替代）
  - 参数：filePath（支持 PDF/文本/代码等格式）
  
- **file_write** - 创建/覆盖文件（禁止用 shell 命令替代）
  - 参数：filePath（路径）, content（内容）

- **file_edit** - 精确编辑文件（**最常用**，禁止用 file_write 覆盖整个文件）
  - 参数：filePath, oldText（原始文本）, newText（新文本）
  - 流程：先 file_read → 确认内容 → file_edit 精确替换
  - 禁止：不要用 file_write 覆盖整个文件来做小修改

- **list_directory** - 列出目录内容
  - 参数：dirPath（目录路径）, recursive（递归）, pattern（文件名过滤）
  - 用途：探索项目结构、查找文件位置

- **search_content** - 搜索文件内容（grep 风格）
  - 参数：query（关键词/正则）, directory（搜索目录）, filePattern（文件过滤）
  - 用途：在代码库中查找函数定义、变量引用、配置项

- **search_files** - 按文件名搜索（find 风格）
  - 参数：pattern（通配符模式）, directory（搜索目录）
  - 用途：查找特定文件的位置

### 系统交互
- **shell_execute** - 执行 Shell 命令（禁止用于文件读写）
- **app_open** - 打开应用程序
- **code_execution** - 代码沙箱执行（Python/JS/Bash）
- **image_generate** - AI图像生成（⚠️ 未配置API，暂不可用）

### 记忆管理
- **memory_save_mid** - 保存项目总结
- **memory_save_short** - 保存对话上下文

### 工具选择原则
1. **文件编辑**：优先用 file_edit，只有创建新文件才用 file_write
2. **网页内容**：优先用 web_fetch，次选 http_get
3. **天气查询**：只用 weather
4. **代码测试**：优先用 code_execution
5. **禁止用 shell 读写文件**（cat → file_read，sed → file_edit）

## 工具使用策略

### 调用前说明
调用工具前，先用一句话说明目的，简洁自然。

### 调用策略
- 一次只调用最必要的工具
- 有依赖的工具要等前一个结果
- 失败时提供替代方案

## 安全护栏
- 只执行用户明确授权的操作
- 涉及敏感操作时系统会自动请求权限
- 禁止使用 shell 命令进行文件读写

## 记忆管理

### 记忆读写习惯（必须遵守）
你**必须**在以下时机主动读写记忆：

**会话开始时（必须读取）：**
- 开始处理用户任务前，先读取项目记忆文件（使用 file_read）
- 如果工作区有 memorys/project-memory.md，必须先读取了解上下文
- 这确保你了解项目的架构、历史决策、未完成的任务

**完成任务后（必须写入）：**
- 完成重要功能开发或修复后 → 使用 memory_save_mid 保存经验
- 用户说"结束"、"总结"、"先这样"时 → memory_save_mid
- 解决了一个非平凡的问题（排查了 2 步以上） → memory_save_mid
- 用户提出了技术决策或偏好 → memory_save_mid
- 修改了项目架构或关键文件 → memory_save_mid 并更新项目记忆

**为什么这很重要：**
- 你没有跨会话记忆，记忆文件是你唯一的长期知识来源
- 不写记忆 = 下次会话从零开始 = 重复劳动
- 用户期望你"有记忆"，而不是每次都要重新解释项目

**何时更新记忆：**
- 用户说"结束"、"总结"、"先这样"时 → memory_save_mid
- 完成重要功能或解决关键问题时 → memory_save_mid
- 用户提出技术决策时 → memory_save_mid

回答用户问题时，直接给出清晰完整的回答。`;
        this.history = [{ role: 'system', content: this.baseSystemPrompt }];
        this.abortController = null;
        this.maxToolIterations = 20;

        // 初始化 SkillFactory（adapter 已就绪）
        this.skillFactory = new SkillFactory(this.adapter, this.dataDir);
    }

    /**
     * 切换模型
     * @param {Object} modelConfig - 新的模型配置
     */
    switchModel(modelConfig) {
        this.adapter = adapterFactory.createAdapter(modelConfig);
        this.modelConfig = modelConfig;
        // 同步更新 SkillFactory 的 adapter
        if (this.skillFactory) {
            this.skillFactory.adapter = this.adapter;
        }
        console.log(`[Brain] Switched to model: ${modelConfig.name} (${modelConfig.protocol})`);
    }

    /**
     * 设置全量上下文模式
     * @param {boolean} enabled - 是否启用全量上下文
     */
    setFullContextMode(enabled) {
        this.fullContextMode = enabled;
        console.log(`[Brain] Full context mode: ${enabled ? 'ON' : 'OFF'}`);
    }

    /**
     * 裁剪对话历史（短期记忆）
     * - 保留 system prompt（索引0）
     * - 保留最近 10 轮对话（20条消息）
     * - 自动保存短期记忆到文件
     */
    trimHistory() {
        if (this.fullContextMode) {
            // 全量上下文模式：不裁剪
            return;
        }

        // system prompt 在索引 0
        const systemPrompt = this.history[0];
        
        // 裁剪：保留最近 10 轮对话（20条消息）
        const MAX_TURNS = 10;
        const MAX_MESSAGES = MAX_TURNS * 2;
        
        if (this.history.length > MAX_MESSAGES + 1) {
            const oldLength = this.history.length;
            const trimmed = this.history.slice(-(MAX_MESSAGES));
            this.history = [systemPrompt, ...trimmed];
            console.log(`[Brain] Trimmed history from ${oldLength} to ${this.history.length} messages (${MAX_TURNS} turns)`);
            
            // 保存短期记忆到文件（如果有 workFolder）
            if (this._currentWorkFolder) {
                this._saveShortMemory();
            }
        }
    }

    /**
     * 保存短期记忆到文件
     */
    _saveShortMemory() {
        const fs = require('fs');
        const path = require('path');
        
        try {
            const memDir = path.join(this._currentWorkFolder, 'memorys');
            const shortMemoryFile = path.join(memDir, 'short-memory.md');
            
            // 确保目录存在
            if (!fs.existsSync(memDir)) {
                fs.mkdirSync(memDir, { recursive: true });
            }
            
            // 将对话历史转换为简洁的摘要格式
            const messages = this.history.slice(1); // 跳过 system prompt
            const summary = messages.map((msg, idx) => {
                const role = msg.role === 'user' ? '👤 用户' : '🤖 助手';
                let content = '';
                
                if (typeof msg.content === 'string') {
                    content = msg.content.slice(0, 200);
                } else if (Array.isArray(msg.content)) {
                    // 提取文本内容
                    const textParts = msg.content
                        .filter(c => c.type === 'text')
                        .map(c => c.text)
                        .join('\n');
                    content = textParts.slice(0, 200);
                    
                    // 如果有工具调用，简要说明
                    const toolCalls = msg.content.filter(c => c.type === 'tool_use' || c.type === 'toolCall');
                    if (toolCalls.length > 0) {
                        content += `\n[调用工具: ${toolCalls.map(t => t.name).join(', ')}]`;
                    }
                }
                
                return `### ${role} (第${Math.floor(idx/2) + 1}轮)\n${content}`;
            }).join('\n\n');
            
            const timestamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
            const content = `# 短期记忆（最近10轮对话）\n\n更新时间: ${timestamp}\n\n${summary}`;
            
            fs.writeFileSync(shortMemoryFile, content, 'utf-8');
            
            // 通知前端
            messageBus.publish('MEMORY_UPDATE', {
                type: 'short',
                file: shortMemoryFile,
                timestamp
            });
            
            console.log(`[Brain] Saved short memory to ${shortMemoryFile}`);
        } catch (err) {
            console.error('[Brain] Failed to save short memory:', err);
        }
    }

    /**
     * 通过消息总线执行 shell 命令（内部工具用）
     * @param {string} command - shell 命令
     * @param {number} timeout - 超时时间（毫秒），默认 15 秒
     * @returns {Promise<string>} - 执行结果
     */
    _execShell(command, timeout = 15000, cwd = undefined) {
        console.log(`[Brain._execShell] → publishing EXECUTE:`, { moduleName: 'shell', params: { command, cwd } });
        return new Promise((resolve) => {
            let resolved = false;
            const handler = (data) => {
                if (resolved) return;
                console.log(`[Brain._execShell] ← received EXECUTE_RESULT:`, JSON.stringify(data).slice(0, 300));
                if (data.module === 'shell') {
                    resolved = true;
                    messageBus.unsubscribe('EXECUTE_RESULT', handler);
                    resolve(data.status === 'success'
                        ? String(data.result || '').trim()
                        : `命令执行失败: ${data.error}`);
                }
            };
            messageBus.subscribe('EXECUTE_RESULT', handler);
            messageBus.publish('EXECUTE', { moduleName: 'shell', params: { command, cwd } });
            
            setTimeout(() => {
                if (resolved) return;
                resolved = true;
                messageBus.unsubscribe('EXECUTE_RESULT', handler);
                console.log(`[Brain._execShell] 超时 (${timeout}ms)`);
                resolve(`命令执行超时（${timeout}ms）`);
            }, timeout);
        });
    }

    /**
     * 执行单个工具调用
     * @param {string} name - 工具名
     * @param {object} input - 工具输入参数
     * @returns {string} 工具执行结果文本
     */
    async executeTool(name, input) {
        console.log(`[Brain.executeTool] ${name}:`, JSON.stringify(input).slice(0, 100));
        
        // 使用工具注册中心执行
        return await toolRegistry.execute(name, input, {
            workFolder: this._currentWorkFolder,
            sessionKey: this.activeSessionKey
        });
    }

    /**
     * 处理用户输入，支持多轮工具调用
     * 使用 Anthropic 标准 tool_use / tool_result 协议
     */
    async process(userInput, memoryContext = '', sessionKey = null, workFolder = '', skillContext = '', images = []) {
        this.activeSessionKey = sessionKey;
        this._currentWorkFolder = workFolder || '';
        this._toolCallLog = []; // 重置工具调用日志

        // ── Hermes 启发：PromptBuilder 分层注入 ──
        // Layer 顺序：基础人格 → 身份记忆 → 工作记忆 → 工作区 → 技能索引
        let systemContent = this.promptBuilder.build({
            basePrompt: this.baseSystemPrompt,
            workFolder: workFolder,
            sessionKey: sessionKey,
            includeIdentity: true,
            includeWorking: true,
            includeSkillIndex: true
        });

        // 附加会话传入的额外记忆（如中期记忆摘要）
        if (memoryContext) {
            systemContent += '\n\n' + memoryContext;
        }
        // 附加技能全文（由 skill-loader 在匹配后按需加载的 L1 内容）
        if (skillContext) {
            systemContent += '\n\n--- 当前技能指导 ---\n\n' + skillContext;
        }
        this.history[0] = { role: 'system', content: systemContent };
        if (memoryContext || workFolder || skillContext) {
            console.log('[Brain.process] prompt built via PromptBuilder, workFolder:', workFolder || '(empty)', 'memoryLen:', memoryContext.length, 'skillLen:', skillContext.length);
        }

        stateMachine.transition('PLANNING');
        // 构建用户消息（支持多模态：文本 + 图片）
        if (images && images.length > 0) {
            const userContent = [{ type: 'text', text: userInput }];
            for (const img of images) {
                userContent.push({
                    type: 'image_url',
                    image_url: { url: img.startsWith('data:') ? img : `data:image/png;base64,${img}` }
                });
            }
            this.history.push({ role: 'user', content: userContent });
        } else {
            this.history.push({ role: 'user', content: userInput });
        }
        
        // 裁剪历史（短期记忆）
        this.trimHistory();
        
        this.abortController = new AbortController();
        const { signal } = this.abortController;

        // ── 会话级 sessionKey，所有事件都携带 ──
        const _sk = sessionKey || null;

        try {
            let iteration = 0;
            const MAX_LLM_RETRIES = 5;

            // 带自动重试的 LLM 调用封装（无延迟，等模型返回失败后立即重试）
            const callWithRetry = async (fn) => {
                for (let attempt = 0; attempt <= MAX_LLM_RETRIES; attempt++) {
                    try {
                        return await fn();
                    } catch (err) {
                        if (err.name === 'AbortError' || signal.aborted) throw err;
                        if (attempt < MAX_LLM_RETRIES) {
                            console.log(`[Brain] LLM 调用失败(${attempt + 1}/${MAX_LLM_RETRIES})，立即重试:`, err.message);
                            messageBus.publish('CHAT_STREAM', {
                                text: `\n⏳ 模型调用失败，正在自动重试 (${attempt + 1}/${MAX_LLM_RETRIES})...\n`,
                                fullText: null,
                                sessionKey: _sk
                            });
                            // 不设延迟，直接重试，等模型实际返回失败后再发起下一次
                        } else {
                            throw err;
                        }
                    }
                }
            };

            while (iteration < this.maxToolIterations) {
                const enableTools = toolRegistry.getToolDefinitions();

                // 使用流式输出（带自动重试）
                const result = await callWithRetry(() => this.adapter.chatStream(
                    this.history,
                    { signal, tools: enableTools },
                    (chunk) => {
                        // 每收到一个文本片段，发送到前端
                        if (chunk.type === 'text' && chunk.text) {
                            console.log('[Brain] Publishing CHAT_STREAM, text:', chunk.text.slice(0, 30));
                            messageBus.publish('CHAT_STREAM', {
                                text: chunk.text,
                                fullText: chunk.fullText,
                                sessionKey: _sk
                            });
                        }
                    }
                ));
                
                if (signal.aborted) {
                    console.log('[Brain] API 调用后检测到中断');
                    // 不 pop history — 保留用户消息
                    return;
                }

                // 如果没有工具调用，直接返回文本
                if (!result.toolCalls || result.toolCalls.length === 0) {
                    // ── max_tokens 截断自动续写 ──
                    // 如果 stopReason === 'max_tokens'，说明模型输出被截断，需要追加"继续"让模型补全
                    let finalText = result.text;
                    let totalUsage = { ...result.usage };
                    let continueCount = 0;
                    const MAX_CONTINUATIONS = 5; // 最多续写 5 轮

                    while (result.stopReason === 'max_tokens' && continueCount < MAX_CONTINUATIONS) {
                        continueCount++;
                        console.log(`[Brain] Output truncated (max_tokens), continuing... (${continueCount}/${MAX_CONTINUATIONS})`);
                        
                        // 将截断文本加入历史
                        this.history.push({ role: 'assistant', content: finalText });
                        // 追加"继续"提示
                        this.history.push({ role: 'user', content: '请继续，从你上次中断的地方接着写，不要重复已输出的内容。' });
                        this.trimHistory();
                        
                        // 再次调用模型（不带工具，纯文本续写）
                        try {
                            const contResult = await callWithRetry(() => this.adapter.chatStream(
                                this.history,
                                { signal, tools: undefined },
                                (chunk) => {
                                    if (chunk.type === 'text' && chunk.text) {
                                        messageBus.publish('CHAT_STREAM', {
                                            text: chunk.text,
                                            fullText: chunk.fullText,
                                            sessionKey: _sk
                                        });
                                    }
                                }
                            ));
                            finalText += contResult.text;
                            result.stopReason = contResult.stopReason;
                            if (contResult.usage) {
                                totalUsage.input += contResult.usage.input || 0;
                                totalUsage.output += contResult.usage.output || 0;
                            }
                            // 如果续写结果包含工具调用，把续写文本保留在历史中后跳出
                            if (contResult.toolCalls && contResult.toolCalls.length > 0) {
                                this.history.push({ role: 'assistant', content: contResult.text });
                                // 移除刚才的"继续"user消息（因为工具调用会重入循环）
                                // 不移除，让历史自然流转
                                break;
                            }
                        } catch (contErr) {
                            console.error('[Brain] Continuation failed:', contErr.message);
                            break;
                        }
                    }

                    if (continueCount > 0) {
                        console.log(`[Brain] Continuation completed after ${continueCount} rounds, total ${finalText.length} chars`);
                    }

                    // 保存最终完整文本到历史（续写时已经 push 了中间态，这里把最后的也 push）
                    if (continueCount === 0) {
                        this.history.push({ role: 'assistant', content: finalText });
                    }

                    // 发送完成信号
                    messageBus.publish('CHAT_REPLY', { 
                        text: finalText, 
                        usage: totalUsage, 
                        model: this.modelConfig.name,
                        done: true,
                        sessionKey: _sk
                    });
                    // ── SkillFactory：异步提炼技能（不阻塞回复）──
                    this._tryExtractSkill(userInput, finalText);
                    return;
                }

                // 有工具调用：按 Anthropic 协议构建 assistant 消息（包含 tool_use blocks）
                const assistantContent = [];
                if (result.text) {
                    assistantContent.push({ type: 'text', text: result.text });
                }
                for (const tc of result.toolCalls) {
                    assistantContent.push({
                        type: 'tool_use',
                        id: tc.id,
                        name: tc.name,
                        input: tc.input
                    });
                }
                this.history.push({ role: 'assistant', content: assistantContent });

                // 转换到 EXECUTING 状态（仅一次）
                if (stateMachine.state !== 'EXECUTING') {
                    stateMachine.transition('EXECUTING');
                }

                // 执行每个工具并收集 tool_result
                const toolResultContent = [];
                let toolSeq = 0; // 工具序号，用于前端 callId 匹配
                for (const tc of result.toolCalls) {
                    // 检查中断信号
                    if (signal.aborted) {
                        console.log('[Brain] 中断检测，停止工具执行');
                        return;
                    }

                    console.log('[Brain] Tool:', tc.name, JSON.stringify(tc.input));
                    const callId = String(++toolSeq);

                    // 发送工具开始事件（供 main.js 追踪）
                    messageBus.publish('TOOL_START', { toolName: tc.name, params: tc.input, callId, sessionKey: _sk });

                    // 发送前端可视化事件
                    messageBus.publish('EXECUTE', {
                        moduleName: tc.name,
                        params: tc.input,
                        callId,
                        sessionKey: _sk
                    });

                    const toolOutput = await this.executeTool(tc.name, tc.input);

                    // 执行后再次检查中断
                    if (signal.aborted) {
                        console.log('[Brain] 工具执行后检测到中断');
                        return;
                    }

                    // 发送工具完成事件（供 main.js 追踪）
                    messageBus.publish('TOOL_DONE', {
                        toolName: tc.name,
                        status: 'success',
                        result: toolOutput, // 完整输出，不截断
                        callId,
                        sessionKey: _sk
                    });

                    // ── SkillFactory：追踪工具调用日志 ──
                    this._toolCallLog.push({
                        tool: tc.name,
                        params: tc.input,
                        status: 'success',
                        output: String(toolOutput).slice(0, 500) // 日志只保留前500字符
                    });

                    // 发送工具执行结果（带 callId，前端可精确匹配）
                    messageBus.publish('EXECUTE_RESULT', {
                        module: tc.name,
                        status: 'success',
                        result: toolOutput,
                        callId,
                        sessionKey: _sk
                    });

                    // ── 关键修复：立即发 CHAT_REPLY 更新前端（工具完成后即显示）
                    const toolInfo = toolRegistry.getToolLabels()[tc.name] || { icon: '🔧', label: tc.name };
                    messageBus.publish('CHAT_REPLY', {
                        // 通知类型：工具完成（不是最终回复）
                        toolDone: true,
                        toolName: tc.name,
                        toolIcon: toolInfo.icon,
                        toolLabel: toolInfo.label,
                        toolInput: tc.input,
                        toolOutput: toolOutput, // 完整输出
                        callId,
                        sessionKey: _sk,
                        // 完整的 assistant 消息结构，用于前端更新 chatMessages
                        assistantMsg: {
                            role: 'assistant',
                            content: [
                                ...(result.text ? [{ type: 'text', text: result.text }] : []),
                                {
                                    type: 'toolCall',
                                    name: tc.name,
                                    input: tc.input,
                                    output: toolOutput, // 完整输出
                                    status: 'done',
                                    callId
                                }
                            ]
                        }
                    });

                    toolResultContent.push({
                        type: 'tool_result',
                        tool_use_id: tc.id,
                        content: toolOutput
                    });
                }

                // 将 tool_result 作为 user 消息推入历史
                this.history.push({ role: 'user', content: toolResultContent });
                iteration++;
            }

            // 达到最大迭代次数，做最后一次调用（不带 tools，强制生成文本）
            const finalResult = await callWithRetry(() => this.adapter.chat(this.history, { signal }));
            if (signal.aborted) return;

            this.history.push({ role: 'assistant', content: finalResult.text });
            messageBus.publish('CHAT_REPLY', { text: finalResult.text, usage: finalResult.usage, model: this.modelConfig.name, done: true, sessionKey: _sk });
            // ── SkillFactory：多工具调用后提炼技能 ──
            this._tryExtractSkill(userInput, finalResult.text);

        } catch (error) {
            if (error.name === 'AbortError' || signal.aborted) {
                console.log('[Brain] 中断异常捕获，保留历史');
                // 不 pop — 保留所有已记录的消息
                return;
            }
            console.error('[Brain] Process error:', error.message);
            messageBus.publish('CHAT_REPLY', { text: '处理出错: ' + error.message, done: true, sessionKey: _sk });
        } finally {
            this.abortController = null;
            // 确保回到 IDLE（无论正常完成还是异常）
            if (stateMachine.state !== 'IDLE') {
                stateMachine.forceReset();
            }
        }
    }

    /**
     * ── SkillFactory 触发器 ──
     * 异步提炼技能，不阻塞主对话流程
     * 参考 Hermes 的 Skill Factory 设计：任务完成后自动提炼可复用技能
     */
    _tryExtractSkill(userText, assistantText) {
        if (!this.skillFactory || this._toolCallLog.length === 0) return;

        setTimeout(async () => {
            try {
                const result = await this.skillFactory.tryCreateSkill(
                    userText,
                    assistantText,
                    this._toolCallLog,
                    []
                );
                if (result && result.action !== 'skip') {
                    console.log(`[Brain] SkillFactory: ${result.action} skill "${result.name}"`);
                    this.promptBuilder.invalidateCache();
                    messageBus.publish('SKILL_CREATED', result);
                }
            } catch (err) {
                console.error('[Brain] SkillFactory error:', err.message);
            }
        }, 8000);
    }

    abort() {
        if (this.abortController) this.abortController.abort();
    }
}

module.exports = Brain;
