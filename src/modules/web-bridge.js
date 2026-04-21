// modules/web-bridge.js — Web 桥接层
const express = require('express');
const http = require('http');
const https = require('https');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const messageBus = require('../core/message-bus');
const stateMachine = require('../core/state-machine');
const SessionManager = require('../core/session-manager');
const UnifiedMemory = require('../core/unified-memory');
const adapterFactory = require('../modules/adapters/adapter-factory');
const PermissionManager = require('../core/permission-manager');
const SkillLoader = require('../core/skill-loader');
const surgeon = require('../core/surgeon');

class WebBridge {
    constructor(port = 3000, dataDir = null) {
        this.port = port;
        this.app = express();
        this.app.use(express.json());
        this.tunnel = null;        // localtunnel 实例
        this.tunnelUrl = null;     // 公网 URL
        
        // Session Manager
        this.sessionManager = new SessionManager(dataDir || path.join(__dirname, '../../Data'));

        // 静态文件：web/index.html (禁用缓存)
        this.app.use(express.static(path.join(__dirname, '../../web'), {
            setHeaders: (res, path) => {
                if (path.endsWith('.html')) {
                    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
                    res.setHeader('Pragma', 'no-cache');
                    res.setHeader('Expires', '0');
                }
            }
        }));

        // ── Session API ──
        
        // 列出所有 sessions
        this.app.get('/api/sessions', (req, res) => {
            const sessions = this.sessionManager.list();
            res.json({ sessions });
        });
        
        // 获取单个 session
        this.app.get('/api/sessions/:key', (req, res) => {
            const session = this.sessionManager.get(req.params.key);
            if (!session) return res.status(404).json({ error: 'Session not found' });
            res.json({ session });
        });
        
        // 创建 session
        this.app.post('/api/sessions', (req, res) => {
            const { sessionKey, session } = this.sessionManager.create(req.body);
            res.json({ sessionKey, session });
        });
        
        // 更新 session
        this.app.patch('/api/sessions/:key', (req, res) => {
            const session = this.sessionManager.update(req.params.key, req.body);
            if (!session) return res.status(404).json({ error: 'Session not found' });
            res.json({ session });
        });
        
        // 删除 session
        this.app.delete('/api/sessions/:key', (req, res) => {
            const deleted = this.sessionManager.delete(req.params.key);
            res.json({ deleted });
        });
        
        // 获取对话历史
        this.app.get('/api/sessions/:key/history', (req, res) => {
            const history = this.sessionManager.getHistory(req.params.key);
            res.json({ messages: history });
        });
        
        // 获取记忆
        this.app.get('/api/sessions/:key/memory', (req, res) => {
            const layer = req.query.layer || 'short';
            const content = this.sessionManager.getMemory(req.params.key, layer);
            res.json({ content, layer });
        });
        
        // 保存记忆
        this.app.post('/api/sessions/:key/memory', (req, res) => {
            const { layer, content } = req.body;
            const success = this.sessionManager.setMemory(req.params.key, layer, content);
            res.json({ success });
        });

        // ── 统一记忆系统 API（5 层模型）──
        this.unifiedMemory = new UnifiedMemory(dataDir || path.join(__dirname, '../../Data'));

        // 兼容旧接口：this.memoryManager 仍指向 unifiedMemory（injectContext 兼容）
        this.memoryManager = this.unifiedMemory;

        // 列出所有记忆层
        this.app.get('/api/memory/layers', (req, res) => {
            const workFolder = req.query.workFolder || '';
            const layers = this.unifiedMemory.listLayers(workFolder);
            const summary = this.unifiedMemory.getSummary();
            res.json({ layers, summary });
        });

        // 读取指定记忆层
        this.app.get('/api/memory/layer/:id', (req, res) => {
            const layer = req.params.id;
            const workFolder = req.query.workFolder || '';
            try {
                const content = this.unifiedMemory.readLayer(layer, workFolder);
                res.json({ content, layer });
            } catch (err) {
                res.status(500).json({ error: err.message });
            }
        });

        // 写入指定记忆层
        this.app.post('/api/memory/layer/:id', (req, res) => {
            const layer = req.params.id;
            const { content, workFolder } = req.body;
            try {
                const success = this.unifiedMemory.writeLayer(layer, content, workFolder || '');
                res.json({ success });
            } catch (err) {
                res.status(500).json({ error: err.message });
            }
        });

        // 兼容旧 API：读取全局记忆
        this.app.get('/api/memory', (req, res) => {
            const layer = req.query.layer || 'long';
            const workFolder = req.query.workFolder || '';
            const layerMap = { long: 'global', mid: 'project' };
            const mappedLayer = layerMap[layer] || layer;
            const content = this.unifiedMemory.readLayer(mappedLayer, workFolder);
            res.json({ content, layer });
        });

        // 兼容旧 API：保存全局记忆
        this.app.post('/api/memory', (req, res) => {
            const { layer, content, workFolder } = req.body;
            const layerMap = { long: 'global', mid: 'project' };
            const mappedLayer = layerMap[layer] || layer;
            const success = this.unifiedMemory.writeLayer(mappedLayer, content, workFolder || '');
            res.json({ success });
        });


        // ── 四层记忆系统 API ──
        const memoryDir = path.join(dataDir || path.join(__dirname, '../../Data'), 'memory');

        // 读取记忆文件
        this.app.get('/api/memory/file', (req, res) => {
            const file = req.query.file;
            if (!file) return res.status(400).json({ error: 'file is required' });

            // 映射文件名到实际路径
            const fileMap = {
                'identity.md': () => {
                    const userProfile = path.join(memoryDir, 'identity', 'user-profile.md');
                    const selfAware = path.join(memoryDir, 'identity', 'self-awareness.md');
                    let content = '';
                    if (fs.existsSync(userProfile)) content += fs.readFileSync(userProfile, 'utf-8');
                    if (fs.existsSync(selfAware)) content += '\n\n---\n\n' + fs.readFileSync(selfAware, 'utf-8');
                    return content.trim();
                },
                'working.md': () => {
                    const workingDir = path.join(memoryDir, 'working');
                    let content = '';
                    if (fs.existsSync(workingDir)) {
                        const files = fs.readdirSync(workingDir).filter(f => f.endsWith('.md'));
                        for (const f of files) {
                            content += fs.readFileSync(path.join(workingDir, f), 'utf-8') + '\n\n';
                        }
                    }
                    return content.trim() || '# 工作记忆\n\n（暂无内容，系统会在使用过程中自动积累）';
                },
                'experience.md': () => {
                    const expFile = path.join(memoryDir, 'experience', 'index.md');
                    return fs.existsSync(expFile) ? fs.readFileSync(expFile, 'utf-8') : '# 经验记忆\n\n（暂无经验记录）';
                },
                'instinct.md': () => {
                    const instFile = path.join(memoryDir, 'skills', 'instincts.json');
                    if (!fs.existsSync(instFile)) return '# 直觉记忆\n\n（暂无直觉记录）';
                    try {
                        const data = JSON.parse(fs.readFileSync(instFile, 'utf-8'));
                        let content = '# 直觉记忆\n\n';
                        if (data.instincts && data.instincts.length > 0) {
                            data.instincts.forEach(i => {
                                content += `## ${i.pattern}\n`;
                                content += `- **行动**: ${i.action}\n`;
                                content += `- **置信度**: ${i.confidence}%\n`;
                                content += `- **遇到次数**: ${i.encounters || 1}\n\n`;
                            });
                        } else {
                            content += '（暂无直觉记录）';
                        }
                        return content;
                    } catch { return '# 直觉记忆\n\n（解析失败）'; }
                }
            };

            const reader = fileMap[file];
            if (!reader) return res.status(400).json({ error: 'unknown file: ' + file });

            try {
                const content = reader();
                res.json({ content, file });
            } catch (err) {
                res.status(500).json({ error: err.message });
            }
        });

        // 保存记忆文件
        this.app.post('/api/memory/save-file', (req, res) => {
            const { file, content } = req.body;
            if (!file) return res.status(400).json({ error: 'file is required' });

            const saveMap = {
                'identity.md': () => {
                    // 身份记忆保存到 user-profile.md
                    const filePath = path.join(memoryDir, 'identity', 'user-profile.md');
                    if (!fs.existsSync(path.dirname(filePath))) fs.mkdirSync(path.dirname(filePath), { recursive: true });
                    fs.writeFileSync(filePath, content, 'utf-8');
                },
                'working.md': () => {
                    const filePath = path.join(memoryDir, 'working', 'project.md');
                    if (!fs.existsSync(path.dirname(filePath))) fs.mkdirSync(path.dirname(filePath), { recursive: true });
                    fs.writeFileSync(filePath, content, 'utf-8');
                },
                'experience.md': () => {
                    const filePath = path.join(memoryDir, 'experience', 'index.md');
                    if (!fs.existsSync(path.dirname(filePath))) fs.mkdirSync(path.dirname(filePath), { recursive: true });
                    fs.writeFileSync(filePath, content, 'utf-8');
                },
                'instinct.md': () => {
                    // 直觉记忆以 JSON 格式存储，这里转为简单说明
                    const filePath = path.join(memoryDir, 'skills', 'instincts.md');
                    if (!fs.existsSync(path.dirname(filePath))) fs.mkdirSync(path.dirname(filePath), { recursive: true });
                    fs.writeFileSync(filePath, content, 'utf-8');
                }
            };

            const saver = saveMap[file];
            if (!saver) return res.status(400).json({ error: 'unknown file' });

            try {
                saver();
                res.json({ success: true });
            } catch (err) {
                res.status(500).json({ error: err.message });
            }
        });

        // ── 记忆导入 API（自动扫描 OpenClaw / HelloAgent 目录）──
        const homeDir = os.homedir();

        // 扫描外部系统的记忆文件
        this.app.get('/api/memory/import/scan', async (req, res) => {
            try {
                const results = { openclaw: null, helloagent: null };

                // 扫描 OpenClaw: ~/.openclaw/
                const openclawDir = path.join(homeDir, '.openclaw');
                if (fs.existsSync(openclawDir)) {
                    const files = [];
                    const scanDir = (dir, prefix = '') => {
                        try {
                            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                                const fullPath = path.join(dir, entry.name);
                                if (entry.isDirectory()) {
                                    scanDir(fullPath, prefix + entry.name + '/');
                                } else if (entry.name.endsWith('.md') || entry.name.endsWith('.json')) {
                                    try {
                                        const stat = fs.statSync(fullPath);
                                        files.push({
                                            path: prefix + entry.name,
                                            fullPath,
                                            size: stat.size,
                                            modified: stat.mtime.toISOString()
                                        });
                                    } catch {}
                                }
                            }
                        } catch {}
                    };
                    scanDir(openclawDir);
                    results.openclaw = { dir: openclawDir, files };
                }

                // 扫描 HelloAgent: ~/.helloagent/
                const helloagentDir = path.join(homeDir, '.helloagent');
                if (fs.existsSync(helloagentDir)) {
                    const files = [];
                    const scanDir = (dir, prefix = '') => {
                        try {
                            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                                const fullPath = path.join(dir, entry.name);
                                if (entry.isDirectory()) {
                                    scanDir(fullPath, prefix + entry.name + '/');
                                } else if (entry.name.endsWith('.md') || entry.name.endsWith('.json')) {
                                    try {
                                        const stat = fs.statSync(fullPath);
                                        files.push({
                                            path: prefix + entry.name,
                                            fullPath,
                                            size: stat.size,
                                            modified: stat.mtime.toISOString()
                                        });
                                    } catch {}
                                }
                            }
                        } catch {}
                    };
                    scanDir(helloagentDir);
                    results.helloagent = { dir: helloagentDir, files };
                }

                res.json({ success: true, sources: results });
            } catch (err) {
                console.error('[Memory] import scan error:', err.message);
                res.status(500).json({ error: err.message });
            }
        });

        // 读取外部记忆文件内容
        this.app.post('/api/memory/import/read', async (req, res) => {
            try {
                const { fullPath } = req.body;
                if (!fullPath) return res.status(400).json({ error: 'fullPath is required' });
                // 安全检查：只允许读取 home 目录下的文件
                const resolved = path.resolve(fullPath);
                if (!resolved.startsWith(homeDir)) return res.status(403).json({ error: 'Access denied' });
                if (!fs.existsSync(resolved)) return res.status(404).json({ error: 'File not found' });

                const content = fs.readFileSync(resolved, 'utf-8');
                res.json({ success: true, content, path: fullPath });
            } catch (err) {
                res.status(500).json({ error: err.message });
            }
        });

        // 执行记忆导入（从选定的文件）
        this.app.post('/api/memory/import', async (req, res) => {
            try {
                const { source, files, merge } = req.body;
                // source: 'openclaw' | 'helloagent'
                // files: [{ fullPath, targetLayer }]  — 要导入的文件及目标记忆层
                // merge: true=追加, false=覆盖

                if (!files || !Array.isArray(files) || files.length === 0) {
                    return res.status(400).json({ error: 'files array is required' });
                }

                let imported = 0;
                const layerMap = {
                    'identity': path.join(memoryDir, 'identity', 'user-profile.md'),
                    'global': path.join(memoryDir, 'identity', 'global.md'),
                    'working': path.join(memoryDir, 'working', 'project.md'),
                    'experience': path.join(memoryDir, 'experience', 'index.md'),
                    'instinct': path.join(memoryDir, 'skills', 'instincts.md'),
                    'short': path.join(memoryDir, 'short-term', 'recent.md')
                };

                for (const file of files) {
                    const srcPath = path.resolve(file.fullPath);
                    if (!srcPath.startsWith(homeDir)) continue;
                    if (!fs.existsSync(srcPath)) continue;

                    const content = fs.readFileSync(srcPath, 'utf-8');
                    const target = file.targetLayer || 'experience';
                    const targetPath = layerMap[target];

                    if (!targetPath) continue;

                    // 确保目标目录存在
                    if (!fs.existsSync(path.dirname(targetPath))) {
                        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
                    }

                    if (merge && fs.existsSync(targetPath)) {
                        const existing = fs.readFileSync(targetPath, 'utf-8');
                        fs.writeFileSync(targetPath, existing + '\n\n--- 导入自 ' + source + ' ---\n\n' + content, 'utf-8');
                    } else {
                        fs.writeFileSync(targetPath, '--- 导入自 ' + source + ' ---\n\n' + content, 'utf-8');
                    }
                    imported++;
                }

                res.json({ success: true, imported });
            } catch (err) {
                console.error('[Memory] import error:', err.message);
                res.status(500).json({ error: err.message });
            }
        });

        // ── 模型管理 API ──
        const modelsConfigPath = path.join(dataDir || path.join(__dirname, '../../Data'), 'config', 'models.json');
        
        // 加载自定义模型配置（过滤已删除的）
        const _loadCustomModels = (includeDeleted = false) => {
            try {
                if (fs.existsSync(modelsConfigPath)) {
                    const all = JSON.parse(fs.readFileSync(modelsConfigPath, 'utf-8'));
                    if (includeDeleted) return all;
                    return all.filter(m => !m._deleted);
                }
            } catch (err) {
                console.error('[WebBridge] Load custom models error:', err.message);
            }
            return [];
        };
        
        // 保存自定义模型配置
        const _saveCustomModels = (models) => {
            try {
                const dir = path.dirname(modelsConfigPath);
                if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                fs.writeFileSync(modelsConfigPath, JSON.stringify(models, null, 2), 'utf-8');
            } catch (err) {
                console.error('[WebBridge] Save custom models error:', err.message);
            }
        };
        
        // 获取可用模型列表（不含已删除）
        this.app.get('/api/models', (req, res) => {
            const custom = _loadCustomModels();
            if (custom && custom.length > 0) {
                res.json({ models: custom });
            } else {
                const builtIn = adapterFactory.getBuiltInModels();
                res.json({ models: builtIn });
            }
        });

        // ── 单条模型操作（增/删/改/设主）──

        // 添加模型
        this.app.post('/api/models/add', (req, res) => {
            const newModel = req.body;
            if (!newModel || !newModel.name) {
                return res.status(400).json({ error: '缺少模型名称' });
            }
            const allModels = _loadCustomModels(true); // 含已删除，用于写入
            // 生成唯一 ID
            const id = newModel.id || newModel.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/gi, '');
            // 只在未删除的模型中检查重复
            const activeModels = allModels.filter(m => !m._deleted);
            if (activeModels.find(m => m.id === id)) {
                return res.status(409).json({ error: `模型 ID "${id}" 已存在` });
            }
            allModels.push({ ...newModel, id, active: true, _createdAt: Date.now() });
            _saveCustomModels(allModels);
            console.log('[WebBridge] 添加模型:', newModel.name);
            res.json({ success: true, model: { ...newModel, id } });
        });

        // 更新模型（按 ID，只更新未删除的）
        this.app.patch('/api/models/:id', (req, res) => {
            const { id } = req.params;
            const updates = req.body;
            const allModels = _loadCustomModels(true); // 含已删除
            // 只在未删除的模型中查找
            const idx = allModels.findIndex(m => m.id === id && !m._deleted);
            if (idx === -1) return res.status(404).json({ error: `模型 "${id}" 不存在或已删除` });
            // 不允许覆盖 id 和 _createdAt
            delete updates.id;
            delete updates._createdAt;
            delete updates._deleted;
            delete updates._deletedAt;
            allModels[idx] = { ...allModels[idx], ...updates };
            _saveCustomModels(allModels);
            console.log('[WebBridge] 更新模型:', id);
            // 如果更新的是主模型，立即切换运行时配置
            const updated = allModels[idx];
            if (updated.isMain && global.switchMainModel) {
                global.switchMainModel(updated);
                console.log('[WebBridge] 主模型已热更新:', updated.name);
            }
            res.json({ success: true, model: updated });
        });

        // 删除模型（软删除）
        this.app.delete('/api/models/:id', (req, res) => {
            const { id } = req.params;
            const allModels = _loadCustomModels(true); // 含已删除
            const idx = allModels.findIndex(m => m.id === id && !m._deleted);
            if (idx === -1) return res.status(404).json({ error: `模型 "${id}" 不存在或已删除` });
            // 软删除：标记 _deleted
            allModels[idx] = { ...allModels[idx], _deleted: true, _deletedAt: Date.now() };
            _saveCustomModels(allModels);
            console.log('[WebBridge] 删除模型:', id);
            res.json({ success: true });
        });

        // 设为默认主模型
        this.app.post('/api/models/set-main/:id', (req, res) => {
            const { id } = req.params;
            const allModels = _loadCustomModels(true); // 含已删除
            if (!allModels.find(m => m.id === id && !m._deleted)) {
                return res.status(404).json({ error: `模型 "${id}" 不存在或已删除` });
            }
            allModels.forEach(m => { m.isMain = (m.id === id); });
            _saveCustomModels(allModels);
            console.log('[WebBridge] 设为主模型:', id);
            // 切换运行中的主模型
            const mainModel = allModels.find(m => m.id === id && !m._deleted);
            if (mainModel && global.switchMainModel) {
                global.switchMainModel(mainModel);
            }
            res.json({ success: true });
        });

        // 保存模型列表（完整覆盖，保持向后兼容）
        this.app.post('/api/models/save', (req, res) => {
            const { models } = req.body;
            if (Array.isArray(models)) {
                _saveCustomModels(models);
                console.log('[WebBridge] Saved', models.length, 'models');
                res.json({ success: true });
            } else {
                res.status(400).json({ error: 'models must be an array' });
            }
        });
        
        // 测试模型连接
        this.app.post('/api/models/test', async (req, res) => {
            const modelConfig = req.body;
            try {
                const adapter = adapterFactory.createAdapter(modelConfig);
                const success = await adapter.test();
                res.json({ success, model: modelConfig.name });
            } catch (error) {
                res.json({ success: false, error: error.message });
            }
        });

        // 检测模型连接性和最大输出 token
        this.app.post('/api/models/detect', async (req, res) => {
            const modelConfig = req.body;
            try {
                const adapter = adapterFactory.createAdapter(modelConfig);
                const result = await adapter.detectLimits();
                res.json({
                    ...result,
                    model: modelConfig.name
                });
            } catch (error) {
                res.json({ connected: false, maxTokens: 0, error: error.message });
            }
        });

        // ── 初始化向导 API ──

        // 检查初始化状态
        this.app.get('/api/init/status', (req, res) => {
            const cfgPath = path.join(dataDir || path.join(__dirname, '../../Data'), 'config.json');
            let initialized = false;
            let hasApiKey = false;
            try {
                const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
                initialized = cfg.initialized === true;
                hasApiKey = !!(cfg.apiKey || (cfg.modelConfig && cfg.modelConfig.apiKey));
            } catch {}
            res.json({ initialized, hasApiKey });
        });

        // 完成初始化
        this.app.post('/api/init/complete', (req, res) => {
            const { identity, modelConfig } = req.body || {};
            const cfgPath = path.join(dataDir || path.join(__dirname, '../../Data'), 'config.json');
            try {
                let cfg = {};
                try { cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8')); } catch {}
                cfg.initialized = true;
                if (modelConfig) {
                    cfg.modelConfig = { ...cfg.modelConfig, ...modelConfig };
                    cfg.apiKey = modelConfig.apiKey || cfg.apiKey;
                }
                fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 4), 'utf-8');

                // 如果有模型配置，立即热切换
                if (modelConfig && modelConfig.apiKey && global.switchMainModel) {
                    global.switchMainModel({ ...cfg.modelConfig, ...modelConfig });
                }

                console.log('[Init] 初始化完成');
                res.json({ success: true });
            } catch (err) {
                console.error('[Init] 初始化保存失败:', err.message);
                res.status(500).json({ error: err.message });
            }
        });

        // ── Code Explorer API ──
        const CodeExplorer = require('../core/code-explorer');

        // 运行代码探索
        this.app.post('/api/code-explorer/run', async (req, res) => {
            const { query, targetDir } = req.body || {};
            if (!query) return res.status(400).json({ error: 'query is required' });
            try {
                const explorer = new CodeExplorer(targetDir || (dataDir || path.join(__dirname, '../../Data')));
                const result = await explorer.explore(query);
                res.json({ success: true, result });
            } catch (err) {
                console.error('[CodeExplorer] run error:', err.message);
                res.status(500).json({ error: err.message });
            }
        });

        // ── 权限 API ──

        // 获取权限配置
        this.app.get('/api/permissions', (req, res) => {
            const config = PermissionManager.getConfig();
            res.json({ config });
        });

        // 更新权限配置
        this.app.post('/api/permissions', (req, res) => {
            const { config } = req.body;
            if (config) {
                PermissionManager.updatePermissions(config);
                // 广播更新
                this._broadcast({ type: 'PERMISSIONS_UPDATED', data: {} });
            }
            res.json({ success: true });
        });

        // 重置权限
        this.app.post('/api/permissions/reset', (req, res) => {
            PermissionManager.resetToDefault();
            this._broadcast({ type: 'PERMISSIONS_UPDATED', data: {} });
            res.json({ success: true });
        });

        // ── 进化日志 API ──
        
        // 获取进化日志
        this.app.get('/api/evolve/logs', (req, res) => {
            const logs = this._loadEvolveLogs();
            res.json({ logs });
        });

        // 发送消息到进化模块（接入真实 AI）
        this.app.post('/api/evolve/input', async (req, res) => {
            const { text } = req.body;
            if (!text) return res.status(400).json({ error: 'text is required' });
            
            // 保存用户消息到日志
            this._addEvolveLog({ role: 'user', content: text, timestamp: Date.now() });
            
            // 尝试通过主模型适配器获取 AI 回复
            let response = '';
            try {
                let evolveModelConfig = null;
                
                // 1. 优先从 models.json 找 isMain 的完整模型配置
                const customModels = _loadCustomModels();
                const mainModel = customModels.find(m => m.isMain && m.apiKey && !m._deleted);
                if (mainModel) {
                    evolveModelConfig = mainModel;
                }
                
                // 2. 次选：models.json 中第一个有 apiKey 的（非已删除）
                if (!evolveModelConfig) {
                    const found = customModels.find(m => m.apiKey && !m._deleted);
                    if (found) evolveModelConfig = found;
                }
                
                // 3. 最后尝试 config.json 的 modelConfig
                if (!evolveModelConfig) {
                    const cfgPath = path.join(dataDir || path.join(__dirname, '../../Data'), 'config.json');
                    try {
                        const cfgModel = JSON.parse(fs.readFileSync(cfgPath, 'utf-8')).modelConfig || {};
                        if (cfgModel.apiKey) evolveModelConfig = cfgModel;
                    } catch {}
                }
                
                if (!evolveModelConfig || !evolveModelConfig.apiKey) {
                    throw new Error('未配置 API Key，请在模型管理中设置');
                }
                
                adapterFactory.clearCache();
                const adapter = adapterFactory.createAdapter(evolveModelConfig);
                const result = await adapter.chat([
                    { role: 'system', content: '你是 Hello Agent 系统的进化引擎。用户正在与你讨论系统诊断、优化和进化相关的话题。请简洁专业地回答。' },
                    { role: 'user', content: text }
                ]);
                response = result.text || '进化模块无法生成回复。';
            } catch (err) {
                console.error('[WebBridge] Evolve AI error:', err.message);
                response = `进化模块暂时无法连接 AI（${err.message}）。请检查 API Key 配置。`;
            }
            
            this._addEvolveLog({ role: 'assistant', content: response, timestamp: Date.now() });
            res.json({ response });
        });

        // 触发强制进化
        this.app.post('/api/evolve/trigger', (req, res) => {
            messageBus.publish('EVOLVE', { trigger: 'manual', source: 'user' });
            this._addEvolveLog({ role: 'assistant', content: '🧬 收到强制进化请求，开始全面诊断...', timestamp: Date.now() });
            res.json({ success: true, message: '进化已触发' });
        });

        // ── 进化审批 API ──
        // 获取待审批列表
        this.app.get('/api/evolve/approvals', (req, res) => {
            const status = req.query.status || 'pending';
            let list;
            if (status === 'all') {
                list = surgeon.listAllApprovals();
            } else {
                list = surgeon.listPending();
            }
            res.json({ approvals: list });
        });

        // 获取单个审批详情
        this.app.get('/api/evolve/approval/:id', (req, res) => {
            const approvalsDir = path.join((dataDir || path.join(__dirname, '../../Data')), 'approvals');
            const recordFile = path.join(approvalsDir, `${req.params.id}.json`);
            try {
                const record = JSON.parse(fs.readFileSync(recordFile, 'utf-8'));
                res.json(record);
            } catch {
                res.status(404).json({ error: 'Not found' });
            }
        });

        // 审批通过
        this.app.post('/api/evolve/approve/:id', async (req, res) => {
            try {
                const result = surgeon.approvePatch(req.params.id);
                
                // 触发热重载
                if (result.versionId) {
                    messageBus.publish('HOT_RELOAD', {
                        module: result.modulePath,
                        reason: 'evolution_approved',
                        versionId: result.versionId
                    });
                    
                    // 冒烟测试
                    try {
                        messageBus.publish('EVOLVE_APPROVE', result);
                        try {
                            messageBus;
                        } catch {}
                    } catch {}
                }
                
                this._addEvolveLog({ 
                    role: 'assistant', 
                    content: `✅ 审批通过: ${result.modulePath} (版本 ${result.versionId})`, 
                    timestamp: Date.now() 
                });
                
                res.json({ success: true, ...result });
            } catch (err) {
                res.status(500).json({ error: err.message });
            }
        });

        // 审批拒绝
        this.app.post('/api/evolve/reject/:id', (req, res) => {
            try {
                surgeon.rejectPatch(req.params.id);
                this._addEvolveLog({ 
                    role: 'assistant', 
                    content: `❌ 审批拒绝: ${req.params.id}`, 
                    timestamp: Date.now() 
                });
                res.json({ success: true });
            } catch (err) {
                res.status(500).json({ error: err.message });
            }
        });

        // 回滚到指定版本
        this.app.post('/api/evolve/rollback/:versionId', (req, res) => {
            try {
                const result = surgeon.rollback(parseInt(req.params.versionId));
                messageBus.publish('HOT_RELOAD', {
                    module: result.modulePath,
                    reason: 'manual_rollback',
                    versionId: result.versionId
                });
                this._addEvolveLog({ 
                    role: 'assistant', 
                    content: `🔄 已回滚: ${result.modulePath} (版本 ${result.versionId})`, 
                    timestamp: Date.now() 
                });
                res.json({ success: true, ...result });
            } catch (err) {
                res.status(500).json({ error: err.message });
            }
        });

        // 获取版本历史
        this.app.get('/api/evolve/versions', (req, res) => {
            const modulePath = req.query.module || null;
            const versions = surgeon.listVersions(modulePath);
            res.json({ versions });
        });

        // ── 技能管理 API（兼容 SkillHub）──
        const skillLoader = new SkillLoader(dataDir || path.join(__dirname, '../../Data'));

        // 列出技能
        this.app.get('/api/skills', (req, res) => {
            const skills = skillLoader.listSkills();
            res.json({ skills });
        });

        // 导入技能（兼容 SkillHub .skill 格式）
        this.app.post('/api/skills/import', (req, res) => {
            const { sourcePath } = req.body;
            if (!sourcePath) return res.status(400).json({ error: 'sourcePath is required' });
            const result = skillLoader.importSkill(sourcePath);
            res.json(result);
        });

        // ── SkillHub 市场 API（GitHub 搜索 + SKILL.md 导入）──
        function proxyFetch(url) {
            return new Promise((resolve, reject) => {
                const client = url.startsWith('https') ? https : http;
                client.get(url, { timeout: 10000, headers: { 'User-Agent': 'HelloAgent/1.0' } }, (resp) => {
                    if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) {
                        return proxyFetch(resp.headers.location).then(resolve).catch(reject);
                    }
                    let data = '';
                    resp.on('data', chunk => data += chunk);
                    resp.on('end', () => {
                        try { resolve(JSON.parse(data)); } catch { resolve(data); }
                    });
                }).on('error', reject).on('timeout', function() { this.destroy(); reject(new Error('timeout')); });
            });
        }

        // 下载文件内容
        function downloadContent(url) {
            return new Promise((resolve, reject) => {
                const client = url.startsWith('https') ? https : http;
                client.get(url, { timeout: 15000, headers: { 'User-Agent': 'HelloAgent/1.0' } }, (resp) => {
                    if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) {
                        return downloadContent(resp.headers.location).then(resolve).catch(reject);
                    }
                    let data = '';
                    resp.on('data', chunk => data += chunk);
                    resp.on('end', () => resolve(data));
                    resp.on('error', reject);
                }).on('error', reject).on('timeout', function() { this.destroy(); reject(new Error('timeout')); });
            });
        }

        // 搜索 GitHub 上的 SKILL.md 技能
        this.app.get('/api/skillhub/search', async (req, res) => {
            try {
                const userQuery = req.query.q || '';
                const size = Math.min(parseInt(req.query.size) || 12, 30);
                const ghToken = process.env.GITHUB_TOKEN || '';
                const headers = { 'User-Agent': 'HelloAgent/1.0' };
                if (ghToken) headers['Authorization'] = `token ${ghToken}`;

                const q = encodeURIComponent(userQuery + ' filename:SKILL.md');
                const url = `https://api.github.com/search/code?q=${q}&per_page=${size}`;
                console.log(`[SkillHub] searching GitHub: ${url}`);

                const ghRes = await new Promise((resolve, reject) => {
                    https.get(url, { timeout: 10000, headers }, (resp) => {
                        if (resp.statusCode === 403) {
                            let body = '';
                            resp.on('data', c => body += c);
                            resp.on('end', () => reject(new Error('GitHub API 速率限制，请设置 GITHUB_TOKEN 环境变量')));
                            return;
                        }
                        let data = '';
                        resp.on('data', chunk => data += chunk);
                        resp.on('end', () => {
                            try { resolve(JSON.parse(data)); } catch { resolve({ items: [] }); }
                        });
                    }).on('error', reject).on('timeout', function() { this.destroy(); reject(new Error('timeout')); });
                });

                const items = (ghRes.items || []).map(item => ({
                    name: item.name || 'unknown',
                    slug: item.repository?.full_name || '',
                    display_name: item.repository?.name || item.name,
                    description: item.repository?.description || '暂无描述',
                    html_url: item.html_url,
                    raw_url: `https://raw.githubusercontent.com/${item.repository?.full_name}/main/${item.path}`,
                    downloads: item.repository?.stargazers_count || 0,
                    namespace: item.repository?.owner?.login || 'github',
                    version: ''
                }));
                res.json({ data: { content: items, totalElements: ghRes.total_count || 0 } });
            } catch (err) {
                console.error('[SkillHub] search error:', err.message);
                res.json({ data: { content: [], totalElements: 0, error: err.message } });
            }
        });

        // 从 GitHub 安装 SKILL.md 技能
        this.app.post('/api/skillhub/install', async (req, res) => {
            try {
                const { namespace, slug } = req.body;
                if (!namespace || !slug) return res.status(400).json({ error: 'namespace and slug required' });

                // 尝试从 GitHub raw 下载 SKILL.md 内容
                const rawUrl = `https://raw.githubusercontent.com/${namespace}/${slug}/main/SKILL.md`;
                console.log(`[SkillHub] downloading SKILL.md: ${rawUrl}`);
                const content = await downloadContent(rawUrl);

                if (!content || content.includes('404')) {
                    return res.status(404).json({ error: 'SKILL.md not found in repository' });
                }

                // 保存到技能目录
                const skillName = slug.split('/').pop() || slug;
                const skillDir = path.join(skillLoader.skillsDir, skillName);
                if (!fs.existsSync(skillDir)) fs.mkdirSync(skillDir, { recursive: true });
                fs.writeFileSync(path.join(skillDir, 'SKILL.md'), content);

                // 重新加载技能
                skillLoader.reload();

                res.json({ success: true, name: skillName });
            } catch (err) {
                console.error('[SkillHub] install error:', err.message);
                res.status(500).json({ error: err.message });
            }
        });

        this.app.get('/api/project/files', async (req, res) => {
            try {
                const sessionKey = req.query.session || '';
                const session = this.sessionManager.get(sessionKey);
                if (!session || !session.workFolder) {
                    return res.json({ files: [] });
                }
                const workDir = session.workFolder;
                const result = [];
                const walk = (dir, prefix, depth) => {
                    if (depth > 2 || result.length > 100) return;
                    try {
                        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                            if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === '__pycache__') continue;
                            const fullPath = path.join(dir, entry.name);
                            const relPath = prefix + entry.name;
                            if (entry.isDirectory()) {
                                walk(fullPath, relPath + '/', depth + 1);
                            } else {
                                result.push(relPath);
                            }
                        }
                    } catch {}
                };
                walk(workDir, '', 0);
                res.json({ files: result });
            } catch (err) {
                res.json({ files: [], error: err.message });
            }
        });

        this.app.get('/api/project/file-content', async (req, res) => {
            try {
                const sessionKey = req.query.session || '';
                const filePath = req.query.path || '';
                const session = this.sessionManager.get(sessionKey);
                if (!session || !session.workFolder) {
                    return res.status(400).json({ error: 'No active session' });
                }
                const fullPath = path.resolve(session.workFolder, filePath);
                if (!fullPath.startsWith(session.workFolder)) {
                    return res.status(403).json({ error: 'Access denied' });
                }
                if (!fs.existsSync(fullPath)) {
                    return res.status(404).json({ error: 'File not found' });
                }
                const stat = fs.statSync(fullPath);
                if (stat.size > 100 * 1024) {
                    return res.json({ content: fs.readFileSync(fullPath, 'utf-8').slice(0, 100 * 1024) + '\n... (truncated)' });
                }
                res.json({ content: fs.readFileSync(fullPath, 'utf-8') });
            } catch (err) {
                res.status(500).json({ error: err.message });
            }
        });

        // ── 调试：接收前端 JS 错误 ──
        this.app.post('/api/debug-error', (req, res) => {
            console.error('[FRONTEND-ERROR]', JSON.stringify(req.body));
            res.json({ ok: true });
        });

        // ── 自动更新 API ──
        const APP_VERSION = process.env.APP_VERSION || '1.0.0';
        const GITHUB_REPO = process.env.GITHUB_REPO || '';
        const PLATFORM = process.platform;

        this.app.get('/api/update/check', async (req, res) => {
            try {
                if (!GITHUB_REPO) {
                    return res.json({ current: APP_VERSION, latest: null, hasUpdate: false, error: '未配置 GITHUB_REPO 环境变量（格式: owner/repo）' });
                }
                const ghToken = process.env.GITHUB_TOKEN || '';
                const headers = { 'User-Agent': 'HelloAgent/1.0' };
                if (ghToken) headers['Authorization'] = `token ${ghToken}`;

                const url = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
                const release = await new Promise((resolve, reject) => {
                    https.get(url, { timeout: 10000, headers }, (resp) => {
                        if (resp.statusCode === 403) {
                            let body = '';
                            resp.on('data', c => body += c);
                            resp.on('end', () => reject(new Error('GitHub API 速率限制')));
                            return;
                        }
                        let data = '';
                        resp.on('data', chunk => data += chunk);
                        resp.on('end', () => {
                            try { resolve(JSON.parse(data)); } catch { reject(new Error('解析失败')); }
                        });
                    }).on('error', reject).on('timeout', function() { this.destroy(); reject(new Error('超时')); });
                });

                const tagName = release.tag_name || '';
                const latestVersion = tagName.replace(/^v/, '');
                const hasUpdate = latestVersion && latestVersion !== APP_VERSION && latestVersion > APP_VERSION;

                const assets = (release.assets || []).map(a => ({
                    name: a.name,
                    url: a.browser_download_url,
                    size: a.size
                }));

                res.json({
                    current: APP_VERSION,
                    latest: latestVersion,
                    hasUpdate,
                    releaseNotes: release.body || '',
                    releaseUrl: release.html_url || '',
                    assets,
                    publishedAt: release.published_at || ''
                });
            } catch (err) {
                res.json({ current: APP_VERSION, latest: null, hasUpdate: false, error: err.message });
            }
        });

        this.app.post('/api/update/download', async (req, res) => {
            try {
                const { assetUrl } = req.body;
                if (!assetUrl) return res.status(400).json({ error: 'assetUrl required' });

                const tmpDir = path.join(os.tmpdir(), 'hello-agent-update');
                if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

                const fileName = path.basename(new URL(assetUrl).pathname);
                const tmpFile = path.join(tmpDir, fileName);

                const ghToken = process.env.GITHUB_TOKEN || '';
                const headers = { 'User-Agent': 'HelloAgent/1.0' };
                if (ghToken) headers['Authorization'] = `token ${ghToken}`;

                const file = fs.createWriteStream(tmpFile);
                await new Promise((resolve, reject) => {
                    https.get(assetUrl, { headers }, (resp) => {
                        if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) {
                            https.get(resp.headers.location, { headers }, (r2) => {
                                r2.pipe(file);
                                file.on('finish', () => { file.close(); resolve(); });
                            }).on('error', reject);
                        } else {
                            resp.pipe(file);
                            file.on('finish', () => { file.close(); resolve(); });
                        }
                    }).on('error', reject);
                });

                res.json({ success: true, path: tmpFile, name: fileName });
            } catch (err) {
                res.json({ success: false, error: err.message });
            }
        });

        this.app.post('/api/update/apply', async (req, res) => {
            try {
                const { archivePath } = req.body;
                if (!archivePath || !fs.existsSync(archivePath)) {
                    return res.status(400).json({ error: '归档文件不存在' });
                }

                const tmpDir = path.join(os.tmpdir(), 'hello-agent-update');
                const { execSync } = require('child_process');

                // macOS: 替换 .app 目录
                if (PLATFORM === 'darwin') {
                    const appPath = process.env.APP_PATH || '/Applications/Hello Agent.app';
                    if (archivePath.endsWith('.zip')) {
                        execSync(`unzip -o "${archivePath}" -d "${tmpDir}/extracted"`, { timeout: 60000 });
                        const extractedApp = fs.readdirSync(path.join(tmpDir, 'extracted'))
                            .find(f => f.endsWith('.app'));
                        if (!extractedApp) {
                            return res.json({ success: false, error: '归档中未找到 .app 文件' });
                        }
                        const srcApp = path.join(tmpDir, 'extracted', extractedApp);
                        execSync(`rm -rf "${appPath}"`, { timeout: 10000 });
                        execSync(`cp -R "${srcApp}" "${appPath}"`, { timeout: 60000 });
                        execSync(`rm -rf "${tmpDir}"`, { timeout: 10000 });
                        // 自动重启
                        setTimeout(() => {
                            execSync('open "/Applications/Hello Agent.app"', { timeout: 10000 });
                            process.exit(0);
                        }, 500);
                        res.json({ success: true, message: '更新完成，正在重启...' });
                    } else {
                        res.json({ success: false, error: '不支持的归档格式，仅支持 .zip' });
                    }
                }
                // Linux: 解压替换当前目录
                else if (PLATFORM === 'linux') {
                    const appDir = process.env.APP_DIR || process.cwd();
                    if (archivePath.endsWith('.tar.gz')) {
                        execSync(`tar xzf "${archivePath}" -C "${tmpDir}/extracted"`, { timeout: 60000 });
                        const extracted = fs.readdirSync(path.join(tmpDir, 'extracted'))[0];
                        if (!extracted) {
                            return res.json({ success: false, error: '归档解压后为空' });
                        }
                        const srcDir = path.join(tmpDir, 'extracted', extracted);
                        execSync(`cp -R "${srcDir}"/* "${appDir}/"`, { timeout: 60000 });
                        execSync(`rm -rf "${tmpDir}"`, { timeout: 10000 });
                        res.json({ success: true, message: '更新完成，请手动重启 Hello Agent' });
                    } else {
                        res.json({ success: false, error: '不支持的归档格式，仅支持 .tar.gz' });
                    }
                }
                // Windows: 解压替换当前目录
                else if (PLATFORM === 'win32') {
                    const appDir = process.env.APP_DIR || process.cwd();
                    if (archivePath.endsWith('.zip')) {
                        execSync(`powershell -Command "Expand-Archive -Force -Path '${archivePath}' -DestinationPath '${tmpDir}/extracted'"`, { timeout: 60000 });
                        const extracted = fs.readdirSync(path.join(tmpDir, 'extracted'))[0];
                        if (!extracted) {
                            return res.json({ success: false, error: '归档解压后为空' });
                        }
                        const srcDir = path.join(tmpDir, 'extracted', extracted);
                        execSync(`xcopy /E /I /Y "${srcDir}" "${appDir}"`, { timeout: 60000 });
                        execSync(`rd /S /Q "${tmpDir}"`, { timeout: 10000 });
                        res.json({ success: true, message: '更新完成，请手动重启 Hello Agent' });
                    } else {
                        res.json({ success: false, error: '不支持的归档格式，仅支持 .zip' });
                    }
                } else {
                    res.json({ success: false, error: '不支持的操作系统: ' + PLATFORM });
                }
            } catch (err) {
                res.json({ success: false, error: err.message });
            }
        });

        // ── 原有 API ──
        
        // 发送消息到 Brain
        this.app.post('/api/input', (req, res) => {
            const { text, sessionKey, model, images } = req.body;
            if (!text && (!images || images.length === 0)) return res.status(400).json({ error: 'text or images is required' });
            if (text && text.length > 100000) return res.status(400).json({ error: 'text too long (max 100000 chars)' });
            if (images && images.length > 10) return res.status(400).json({ error: 'too many images (max 10)' });

            messageBus.publish('USER_INPUT', { text: text || '', sessionKey, model, images: images || [] });
            res.json({ status: 'ok' });
        });

        this.app.post('/api/interrupt', (req, res) => {
            messageBus.publish('INTERRUPT', {});
            res.json({ status: 'interrupted' });
        });

        this.app.get('/api/state', (req, res) => {
            res.json({ state: stateMachine.state });
        });

        // 全量上下文开关
        this.app.post('/api/full-context', (req, res) => {
            const { enabled } = req.body;
            messageBus.publish('FULL_CONTEXT_TOGGLE', { enabled });
            res.json({ enabled });
        });

        // HTTP + WebSocket 服务器
        this.server = http.createServer(this.app);
        this.wss = new WebSocket.Server({ server: this.server });

        this.wss.on('connection', (ws) => {
            console.log('[WebBridge] Client connected');
            // 发送当前状态
            ws.send(JSON.stringify({ type: 'STATE', data: { state: stateMachine.state } }));

            // 处理 WebSocket 消息
            ws.on('message', (data) => {
                try {
                    const msg = JSON.parse(data);
                    this._handleWsMessage(ws, msg);
                } catch (err) {
                    console.error('[WebBridge] WS message parse error:', err);
                }
            });
        });

        // 广播事件到所有 WebSocket 客户端
        const broadcastEvents = [
            'EXECUTE', 'EXECUTE_RESULT', 'ERROR',
            'EVOLVE', 'HOT_RELOAD', 'HOT_RELOAD_RESULT',
            'CHAT_REPLY', 'CHAT_STREAM', 'EVOLUTION_SUCCESS', 'EVOLUTION_FAILED',
            'NEED_CONFIRMATION', 'MEMORY_UPDATE', 'SKILL_CREATED'
        ];

        broadcastEvents.forEach(event => {
            messageBus.subscribe(event, (data) => {
                this._broadcast({ type: event, data });
            });
        });

        // ── 远程访问（localtunnel）──
        this.app.post('/api/tunnel/start', async (req, res) => {
            if (this.tunnel) {
                return res.json({ url: this.tunnelUrl, status: 'already_running' });
            }
            try {
                const localtunnel = require('localtunnel');
                // 使用固定子域名，避免每次链接不同
                const subdomain = 'hello-agent-' + crypto.createHash('md5').update(os.hostname()).digest('hex').slice(0, 8);
                this.tunnel = await localtunnel({ port: this.port, subdomain });
                this.tunnelUrl = this.tunnel.url;
                this.tunnel.on('close', () => {
                    this.tunnel = null;
                    this.tunnelUrl = null;
                    console.log('[Tunnel] Closed');
                });
                this.tunnel.on('error', (err) => {
                    console.error('[Tunnel] Error:', err.message);
                    this.tunnel = null;
                    this.tunnelUrl = null;
                });
                console.log(`[Tunnel] Started: ${this.tunnelUrl}`);
                res.json({ url: this.tunnelUrl, status: 'started', subdomain });

                // 预热 tunnel：带 Bypass-Tunnel-Reminder 头请求一次，减少确认页出现概率
                try {
                    const tunnelUrl = new URL(this.tunnelUrl);
                    const client = tunnelUrl.protocol === 'https:' ? https : http;
                    const preReq = client.request(this.tunnelUrl, {
                        method: 'GET',
                        headers: { 'Bypass-Tunnel-Reminder': 'true', 'User-Agent': 'Hello-Agent-Tunnel/1.0' }
                    }, (preRes) => {
                        preRes.resume(); // 消费响应体
                        console.log(`[Tunnel] Pre-warm: ${preRes.statusCode}`);
                    });
                    preReq.on('error', () => {}); // 忽略预热错误
                    preReq.end();
                } catch (e) {
                    // 预热失败不影响主流程
                }
            } catch (err) {
                console.error('[Tunnel] Start failed:', err.message);
                res.status(500).json({ error: err.message });
            }
        });
        this.app.post('/api/tunnel/stop', (req, res) => {
            if (this.tunnel) {
                this.tunnel.close();
                this.tunnel = null;
                this.tunnelUrl = null;
                console.log('[Tunnel] Stopped');
                res.json({ status: 'stopped' });
            } else {
                res.json({ status: 'not_running' });
            }
        });
        this.app.get('/api/tunnel/status', (req, res) => {
            res.json({ url: this.tunnelUrl, status: this.tunnel ? 'running' : 'stopped' });
        });

        // 状态变更广播
        stateMachine.on('change', (data) => {
            this._broadcast({ type: 'STATE', data });
        });
    }

    _handleWsMessage(ws, msg) {
        const type = msg.type;

        switch (type) {
            case 'GET_PERMISSIONS': {
                const config = PermissionManager.getConfig();
                ws.send(JSON.stringify({ type: 'PERMISSIONS_DATA', data: { config } }));
                break;
            }
            case 'UPDATE_PERMISSIONS': {
                const { config } = msg;
                if (config) {
                    PermissionManager.updatePermissions(config);
                    this._broadcast({ type: 'PERMISSIONS_UPDATED', data: {} });
                }
                break;
            }
            case 'RESET_PERMISSIONS': {
                PermissionManager.resetToDefault();
                this._broadcast({ type: 'PERMISSIONS_UPDATED', data: {} });
                break;
            }
            case 'ADD_FILE_PATH': {
                const { pathConfig } = msg;
                if (pathConfig) {
                    PermissionManager.addFilePath(pathConfig);
                    this._broadcast({ type: 'PERMISSIONS_UPDATED', data: {} });
                }
                break;
            }
            case 'ADD_COMMAND': {
                const { commandConfig } = msg;
                if (commandConfig) {
                    PermissionManager.addAllowedCommand(commandConfig);
                    this._broadcast({ type: 'PERMISSIONS_UPDATED', data: {} });
                }
                break;
            }
            case 'ADD_APP': {
                const { appConfig } = msg;
                if (appConfig) {
                    PermissionManager.addAllowedApp(appConfig);
                    this._broadcast({ type: 'PERMISSIONS_UPDATED', data: {} });
                }
                break;
            }
            case 'REMOVE_FILE_PATH': {
                const { index } = msg;
                PermissionManager.removeFilePath(index);
                this._broadcast({ type: 'PERMISSIONS_UPDATED', data: {} });
                break;
            }
            case 'REMOVE_COMMAND': {
                const { index } = msg;
                PermissionManager.removeCommand(index);
                this._broadcast({ type: 'PERMISSIONS_UPDATED', data: {} });
                break;
            }
            case 'REMOVE_APP': {
                const { index } = msg;
                PermissionManager.removeApp(index);
                this._broadcast({ type: 'PERMISSIONS_UPDATED', data: {} });
                break;
            }
            case 'GET_EVOLVE_LOGS': {
                const logs = this._loadEvolveLogs();
                ws.send(JSON.stringify({ type: 'EVOLVE_LOGS_DATA', data: { logs } }));
                break;
            }
            case 'CONFIRMATION_RESULT': {
                // 前端用户确认/拒绝操作，转发到消息总线
                messageBus.publish('CONFIRMATION_RESULT', msg.data || msg);
                break;
            }
        }
    }

    _broadcast(message) {
        const payload = JSON.stringify(message);
        this.wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(payload);
            }
        });
    }

    // 进化日志持久化
    _getEvolveLogPath() {
        return path.join(__dirname, '../../logs', 'evolution.json');
    }

    _loadEvolveLogs() {
        try {
            const logPath = this._getEvolveLogPath();
            if (fs.existsSync(logPath)) {
                return JSON.parse(fs.readFileSync(logPath, 'utf8'));
            }
        } catch (err) {
            console.error('[WebBridge] Load evolve logs error:', err);
        }
        return [];
    }

    _addEvolveLog(entry) {
        try {
            const logs = this._loadEvolveLogs();
            logs.push(entry);
            // 只保留最近 100 条
            if (logs.length > 100) {
                logs.splice(0, logs.length - 100);
            }
            const logPath = this._getEvolveLogPath();
            const logsDir = path.dirname(logPath);
            if (!fs.existsSync(logsDir)) {
                fs.mkdirSync(logsDir, { recursive: true });
            }
            fs.writeFileSync(logPath, JSON.stringify(logs, null, 2));
        } catch (err) {
            console.error('[WebBridge] Add evolve log error:', err);
        }
    }

    start() {
        return new Promise((resolve) => {
            this.server.listen(this.port, () => {
                console.log(`[WebBridge] Listening on http://localhost:${this.port}`);
                resolve();
            });
        });
    }

    stop() {
        return new Promise((resolve) => {
            this.wss.close();
            this.server.close(resolve);
        });
    }
}

module.exports = WebBridge;
