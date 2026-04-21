// core/main.js — Hello Agent 系统入口
const path = require('path');

// ─── 路径设置 ───
// node_modules 在项目根目录（Hello Agent.app 外部开发时）或 Data 目录内
const dataDir = path.join(__dirname, '..');
const projectRoot = path.resolve(dataDir, '../../../../');
// 优先使用 Data 目录内的 node_modules，其次回退到项目根目录
const nmPath = path.join(dataDir, 'node_modules');
const fs = require('fs');
if (fs.existsSync(nmPath)) {
    module.paths.unshift(nmPath);
} else {
    module.paths.unshift(path.join(projectRoot, 'node_modules'));
}

// ─── 加载核心组件 ───
const messageBus = require('./message-bus');
const stateMachine = require('./state-machine');
const Brain = require('./brain');
const executor = require('./executor');
const Sensor = require('./sensor');
const Evolution = require('./evolution');
const hotReloader = require('./hot-reloader');
const UnifiedMemory = require('./unified-memory'); // 统一记忆系统（5 层）
const SkillLoader = require('./skill-loader');       // 技能加载器
const ReflectionEngine = require('./reflection');    // 自动反思引擎
const PermissionManager = require('./permission-manager'); // 权限管理器
const fileExecutor = require('../modules/file-executor');
require('../modules/shell-executor');   // 实例化命令执行器（注册 EXECUTE 订阅）
require('../modules/app-executor');     // 实例化应用执行器（注册 EXECUTE 订阅）
const WebBridge = require('../modules/web-bridge');
const logger = require('./logger');

// ─── 配置（优先 config.json，环境变量 fallback）───
let config = {};
const configPath = path.join(dataDir, 'config.json');
try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    console.log('[Config] Loaded from config.json');
} catch {
    console.log('[Config] No config.json found, using env vars');
}

// 模型配置（支持多协议）
const modelConfig = config.modelConfig || {
    // 默认使用 MiniMax（向后兼容）
    id: 'minimax-m2.7',
    name: 'MiniMax-M2.7',
    protocol: 'anthropic',
    endpoint: 'https://api.minimaxi.com/anthropic/v1/messages',
    apiKey: config.apiKey || process.env.MINIMAX_API_KEY || '',
    model: 'Minimax-2.7'
};

// 如果 config.json 中只有 apiKey，补充到 modelConfig
if (config.apiKey && !modelConfig.apiKey) {
    modelConfig.apiKey = config.apiKey;
}

// 如果 modelConfig 仍然没有 apiKey，尝试从 models.json 查找
if (!modelConfig.apiKey) {
    try {
        const modelsPath = path.join(dataDir, 'config', 'models.json');
        if (fs.existsSync(modelsPath)) {
            const savedModels = JSON.parse(fs.readFileSync(modelsPath, 'utf-8'))
                .filter(m => !m._deleted); // 排除已删除的模型
            // 优先找同名模型，否则找任何有 apiKey 的模型
            const match = savedModels.find(m => m.name === modelConfig.name && m.apiKey)
                       || savedModels.find(m => m.apiKey);
            if (match) {
                modelConfig.apiKey = match.apiKey;
                if (match.endpoint) modelConfig.endpoint = match.endpoint;
                if (match.protocol) modelConfig.protocol = match.protocol;
                if (match.model) modelConfig.model = match.model;
                if (match.name) modelConfig.name = match.name;
                console.log(`[Config] API Key loaded from models.json (${match.name})`);
            }
        }
    } catch (e) { logger.warn("MAIN", `操作跳过: ${e.message}`); }
}

// 最后回退到环境变量
if (!modelConfig.apiKey) {
    modelConfig.apiKey = process.env.MINIMAX_API_KEY || process.env.API_KEY || '';
}

const PORT = config.port || parseInt(process.env.HELLO_AGENT_PORT || '3000', 10);

// ─── 初始化 ───
async function boot() {
    console.log('╔══════════════════════════════════════╗');
    console.log('║        Hello Agent v1.0            ║');
    console.log('╚══════════════════════════════════════╝');
    logger.system('系统启动', { port: PORT, model: modelConfig.name, protocol: modelConfig.protocol });

    if (!modelConfig.apiKey) {
        console.warn('[WARN] API_KEY not set — Brain will not function');
        logger.warn('SYSTEM', 'API_KEY 未设置');
    }

    // 检查首次运行初始化状态
    const initialized = config.initialized === true;
    if (!initialized) {
        console.log('[Init] 首次运行，等待初始化向导...');
        logger.system('首次运行，等待初始化');
    }

    // 核心组件
    const brain = new Brain(modelConfig, dataDir);
    const sensor = new Sensor({ errorThreshold: 3, windowMs: 60000 });
    const adapterFactory = require('../modules/adapters/adapter-factory');
    
    // 主模型适配器（用于进化、记忆压缩等基础功能）
    const mainAdapter = adapterFactory.createAdapter(modelConfig);
    
    // 统一记忆系统（替代 MemorySystem + MemoryManager）
    const unifiedMemory = new UnifiedMemory(dataDir);
    console.log(`[Memory] 统一记忆系统已初始化: ${JSON.stringify(unifiedMemory.getSummary())}`);
    
    // 技能加载器（需在 Evolution 之前初始化）
    const skillLoader = new SkillLoader(dataDir);
    console.log(`[Skill] 已加载 ${skillLoader.listSkills().length} 个技能`);
    
    const evolution = new Evolution(mainAdapter, {
        memorySystem: unifiedMemory,
        skillLoader: skillLoader
    });
    
    // 自动反思引擎
    const reflection = new ReflectionEngine(mainAdapter, unifiedMemory, skillLoader);
    
    // 暴露主模型切换方法（同时持久化到 config.json）
    global.switchMainModel = (newConfig) => {
        adapterFactory.clearCache(); // 清除缓存，确保用新 apiKey 创建适配器
        brain.switchModel(newConfig);
        const newAdapter = adapterFactory.createAdapter(newConfig);
        evolution.adapter = newAdapter;
        console.log(`[Main] Switched main model to: ${newConfig.name}`);
        // 持久化到 config.json
        try {
            const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            cfg.modelConfig = newConfig;
            cfg.apiKey = newConfig.apiKey || cfg.apiKey;
            fs.writeFileSync(configPath, JSON.stringify(cfg, null, 4), 'utf-8');
            console.log('[Main] Model config persisted to config.json');
        } catch (err) {
            console.error('[Main] Failed to persist model config:', err.message);
        }
    };

    // 加载自定义模型配置（用于根据模型名查找 apiKey）
    const modelsConfigPath = path.join(dataDir, 'config', 'models.json');
    const _findModelConfig = (modelName) => {
        try {
            if (fs.existsSync(modelsConfigPath)) {
                const customModels = JSON.parse(fs.readFileSync(modelsConfigPath, 'utf-8'))
                    .filter(m => !m._deleted); // 排除已删除的模型
                const found = customModels.find(m => m.name === modelName);
                if (found && found.apiKey) return found;
            }
        } catch (e) { logger.warn("MAIN", `操作跳过: ${e.message}`); }
        return null;
    };

    // Web 桥接
    const bridge = new WebBridge(PORT, dataDir);
    await bridge.start();

    // 当前活跃的 sessionKey（用于保存 assistant 回复）
    let activeSessionKey = null;
    // 追踪本轮工具调用（保存完整工具执行记录）
    let pendingToolCalls = [];
    let pendingToolResults = [];
    // 待保存的用户消息文本
    let pendingUserText = null;
    // 反思用的本轮对话数据（不随 pending 重置）
    let reflectionUserText = '';
    let reflectionToolCalls = [];

    // 用户输入 → 检查模型 → 保存用户消息 → 注入记忆 → Brain 处理
    messageBus.subscribe('USER_INPUT', async ({ text, sessionKey, model, images }) => {
        console.log(`[Main] User: ${text}`);
        console.log(`[Main] USER_INPUT params - model: "${model}", sessionKey: "${sessionKey}", images: ${images ? images.length : 0}`);
        logger.chat('用户', text);
        activeSessionKey = sessionKey;
        pendingUserText = text;
        pendingToolCalls = [];
        pendingToolResults = [];
        // 保存反思数据（不会在 CHAT_REPLY 时被重置）
        reflectionUserText = text;
        reflectionToolCalls = [];

        try {
        // 优先使用前端传来的模型，其次使用 session 保存的模型
        const modelName = model || (sessionKey && bridge.sessionManager ? bridge.sessionManager.get(sessionKey)?.model : null);
        console.log(`[Main] Resolved modelName: "${modelName}"`);
        
        if (modelName) {
            const modelConfig = _findModelConfig(modelName);
            console.log(`[Main] _findModelConfig result:`, modelConfig ? { name: modelConfig.name, hasApiKey: !!modelConfig.apiKey } : null);
            
            if (modelConfig && modelConfig.apiKey) {
                // 检查是否需要切换
                const needSwitch = brain.modelConfig.name !== modelConfig.name || !brain.modelConfig.apiKey;
                console.log(`[Main] Current brain.modelConfig.name: "${brain.modelConfig.name}", needSwitch: ${needSwitch}`);
                
                if (needSwitch) {
                    console.log(`[Main] Switching brain to model: ${modelConfig.name}`);
                    adapterFactory.clearCache();
                    brain.switchModel(modelConfig);
                }
            } else {
                console.log(`[Main] Model config not found or missing apiKey for: "${modelName}"`);
            }
        } else {
            console.log(`[Main] No modelName resolved, using default model`);
        }

        // 先保存用户消息到历史
        if (sessionKey && bridge.sessionManager) {
            try {
                const userContent = [{ type: 'text', text: text || '' }];
                // 如果有图片，添加为 image_url 块
                if (images && images.length > 0) {
                    for (const img of images) {
                        userContent.push({
                            type: 'image_url',
                            image_url: { url: img.startsWith('data:') ? img : `data:image/png;base64,${img}` }
                        });
                    }
                }
                bridge.sessionManager.appendHistory(sessionKey, {
                    role: 'user',
                    content: userContent,
                });
            } catch (err) {
                console.error('[History] save user error:', err.message);
            }
        }

        // 注入统一记忆上下文（5 层模型：身份/全局/项目/经验/直觉）
        let memoryContext = '';
        let currentWorkFolder = '';
        if (sessionKey && bridge.sessionManager) {
            try {
                const session = bridge.sessionManager.get(sessionKey);
                currentWorkFolder = session ? (session.workFolder || '') : '';
                console.log(`[Main] memory injection — sessionKey=${sessionKey}, workFolder=${currentWorkFolder || '(empty)'}`);

                // 统一记忆注入（替代原来的 MemoryManager + MemorySystem 双注入）
                memoryContext = unifiedMemory.getFullContext(currentWorkFolder);
                console.log(`[Main] unified memory injected: ${memoryContext.length} chars`);

                // 自动将 workFolder 加入文件访问白名单（如果尚未添加）
                if (currentWorkFolder) {
                    const permissionManager = PermissionManager;
                    const resolvedWF = permissionManager._resolvePath(currentWorkFolder);
                    const alreadyAllowed = permissionManager.config.fileAccess.paths.some(p => {
                        const rp = permissionManager._resolvePath(p.path);
                        return resolvedWF.startsWith(rp) || rp === resolvedWF;
                    });
                    if (!alreadyAllowed) {
                        permissionManager.config.fileAccess.paths.push({
                            path: currentWorkFolder,
                            permissions: ['read', 'write'],
                            recursive: true
                        });
                        console.log(`[Main] Auto-added workFolder to file permissions: ${currentWorkFolder}`);
                    }
                }
            } catch (err) {
                console.error('[Memory] inject error:', err.message, err.stack);
            }
        } else {
            console.log(`[Main] memory skipped — sessionKey=${sessionKey}, bridge.sessionManager=${!!bridge.sessionManager}, bridge.memoryManager=${!!bridge.memoryManager}`);
        }

        // 匹配技能
        const skillContext = skillLoader.matchSkill(text);
        if (skillContext) {
            console.log(`[Main] skill matched for: "${text.slice(0, 50)}"`);
        }

        await brain.process(text, memoryContext, sessionKey, currentWorkFolder, skillContext, images || []);

        } catch (err) {
            // USER_INPUT 链路错误回退：向前端发送错误消息
            console.error('[Main] USER_INPUT chain error:', err.message, err.stack);
            logger.errorDetail('对话处理失败', err);
            messageBus.publish('CHAT_STREAM', { text: `[系统] 处理失败: ${err.message}` });
            messageBus.publish('CHAT_REPLY', { text: `[系统] 处理失败: ${err.message}，请重试或检查配置。`, done: true });
            // 重置状态
            pendingToolCalls = [];
            pendingToolResults = [];
            pendingUserText = null;
        }
    });

    // 监听工具调用事件，记录本轮用到的工具
    messageBus.subscribe('TOOL_START', ({ toolName, params }) => {
        pendingToolCalls.push({ tool: toolName, params });
        reflectionToolCalls.push({ tool: toolName, params });
    });

    // 监听工具执行结果，记录完整信息
    messageBus.subscribe('TOOL_DONE', ({ toolName, status, result, error }) => {
        pendingToolResults.push({
            tool: toolName,
            status,
            result: result || error || '',
            timestamp: Date.now()
        });
    });

    // 监听 assistant 回复，保存到 session history（含完整工具执行记录）
    messageBus.subscribe('CHAT_REPLY', ({ text, usage, done, toolDone }) => {
        // 只在 done=true 且不是中断占位消息时视为最终回复；toolDone 和中断提示都不应落为最终 assistant 文本
        const isInterruptNotice = text === '[系统] 操作已中断';
        const isFinalReply = done === true && !isInterruptNotice;
        
        if (isFinalReply && activeSessionKey && text && bridge.sessionManager) {
            try {
                // 构建完整消息内容：工具执行记录穿插在前，文本回复在后
                // 使用与前端实时渲染一致的 toolCall 格式（而非 tool_summary）
                const content = [];

                // 先添加所有工具调用（按执行顺序）
                if (pendingToolCalls.length > 0 || pendingToolResults.length > 0) {
                    pendingToolCalls.forEach((tc, idx) => {
                        const result = pendingToolResults.find(r => r.tool === tc.tool) || {};
                        content.push({
                            type: 'toolCall',
                            name: tc.tool,
                            input: tc.params,
                            output: typeof result.result === 'string' ? result.result : JSON.stringify(result.result || ''),
                            status: result.status === 'error' ? 'error' : 'done',
                            callId: 'hist-' + Date.now() + '-' + idx
                        });
                    });

                    console.log(`[History] 保存工具执行记录: ${pendingToolCalls.length} 个工具`);
                }

                // 再添加最终文本回复
                content.push({ type: 'text', text });
                
                bridge.sessionManager.appendHistory(activeSessionKey, {
                    role: 'assistant',
                    content,
                });

                // 更新 Token 统计
                if (usage && (usage.input || usage.output)) {
                    bridge.sessionManager.updateTokens(activeSessionKey, usage.input || 0, usage.output || 0);
                }
            } catch (err) {
                console.error('[History] save reply error:', err.message);
            }
            // 重置
            pendingToolCalls = [];
            pendingToolResults = [];
            pendingUserText = null;
        }
        
        // 自动反思（仅最终回复时触发，异步不阻塞）
        if (isFinalReply && reflectionUserText && text) {
            const savedUserText = reflectionUserText;
            const savedTools = [...reflectionToolCalls];
            const savedKey = activeSessionKey;
            // 异步触发，不阻塞主流程
            reflection.reflect(savedUserText, text, savedTools, savedKey).catch(err => {
                console.error('[Reflection] background error:', err.message);
            });
            // 重置反思数据
            reflectionUserText = '';
            reflectionToolCalls = [];
        }
    });

    // 中断处理
    messageBus.subscribe('INTERRUPT', () => {
        console.log('[Main] Interrupt received');
        logger.system('收到中断信号');
        const currentState = stateMachine.state;
        if (currentState !== 'IDLE') {
            brain.abort(); // 取消正在进行的 API 调用或工具执行
            // brain.process 的 finally 会自动 forceReset 到 IDLE
            
            // 保存中断记录到历史
            if (activeSessionKey && bridge.sessionManager) {
                try {
                    const content = [];
                    // 工具调用在前（用 toolCall 格式与前端一致）
                    if (pendingToolCalls.length > 0) {
                        pendingToolCalls.forEach((tc, idx) => {
                            const result = pendingToolResults.find(r => r.tool === tc.tool) || {};
                            content.push({
                                type: 'toolCall',
                                name: tc.tool,
                                input: tc.params,
                                output: result.result || '(已中断)',
                                status: 'interrupted',
                                callId: 'intr-' + Date.now() + '-' + idx
                            });
                        });
                    }
                    content.push({ type: 'text', text: '[系统] 操作已中断' });
                    bridge.sessionManager.appendHistory(activeSessionKey, {
                        role: 'assistant', content,
                    });
                } catch (err) {
                    console.error('[History] save interrupt error:', err.message);
                }
            }
            
            // 重置 pending 状态
            pendingToolCalls = [];
            pendingToolResults = [];
            pendingUserText = null;
            
            // 通知前端
            messageBus.publish('CHAT_REPLY', { text: '[系统] 操作已中断', done: true });
        }
    });

    // 全量上下文开关处理
    messageBus.subscribe('FULL_CONTEXT_TOGGLE', (data) => {
        const enabled = data.enabled;
        console.log('[Main] Full context mode:', enabled ? 'ON' : 'OFF');
        brain.setFullContextMode(enabled);
    });

    console.log(`[Main] System ready — http://localhost:${PORT}`);
    logger.system('系统就绪', { port: PORT });

    // 优雅退出
    const shutdown = async () => {
        console.log('[Main] Shutting down...');
        logger.system('系统关闭');
        await bridge.stop();
        process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    process.on('uncaughtException', (err) => {
        console.error('[Main] Uncaught Exception:', err.message);
        logger.error('SYSTEM', `未捕获异常: ${err.message}`);
        logger.errorDetail('未捕获异常', err);
    });

    process.on('unhandledRejection', (reason) => {
        const msg = reason instanceof Error ? reason.message : String(reason);
        console.error('[Main] Unhandled Rejection:', msg);
        logger.error('SYSTEM', `未处理的Promise拒绝: ${msg}`);
    });
}

boot().catch(err => {
    console.error('[Main] Boot failed:', err);
    logger.errorDetail('启动失败', err);
    process.exit(1);
});
