// core/unified-memory.js — 统一记忆系统（5 层模型）
// 合并 MemorySystem（4层）+ MemoryManager（3层）为统一的 5 层架构
// L0 身份记忆 | L1 全局知识 | L2 项目记忆 | L3 会话记忆 | L4 工作记忆
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

class UnifiedMemory {
    constructor(dataDir) {
        this.dataDir = dataDir;
        this.memoryDir = path.join(dataDir, 'memory');

        // 各层存储路径
        this.paths = {
            identity:    path.join(this.memoryDir, 'identity'),      // L0: user-profile.md, self-awareness.md
            global:      path.join(this.memoryDir, 'global.md'),     // L1: 全局知识（合并原 long-memory.md）
            experience:  path.join(this.memoryDir, 'experience'),    // L2(部分): index.md
            instincts:   path.join(this.memoryDir, 'skills', 'instincts.json'),
            longMemory:  path.join(this.memoryDir, 'long-memory.md'),       // 兼容旧格式
        };

        this._ensureDirs();
    }

    _ensureDirs() {
        const dirs = [
            this.memoryDir,
            path.join(this.memoryDir, 'identity'),
            path.join(this.memoryDir, 'working'),
            path.join(this.memoryDir, 'experience'),
            path.join(this.memoryDir, 'skills'),
            path.join(this.memoryDir, 'sessions'),
        ];
        for (const dir of dirs) {
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        }
        this._initDefaults();
    }

    _initDefaults() {
        // L0 身份记忆 — 用户档案
        const userProfile = path.join(this.paths.identity, 'user-profile.md');
        if (!fs.existsSync(userProfile)) {
            fs.writeFileSync(userProfile, `# 用户档案

## 基本信息
<!-- 系统会自动学习并填充 -->

## 偏好
<!-- 从交互中学习到的用户偏好 -->

## 常用项目
<!-- 用户经常使用的项目 -->

## 沟通风格
<!-- 用户喜欢的沟通方式 -->
`, 'utf-8');
        }

        // L0 身份记忆 — 自我认知
        const selfAware = path.join(this.paths.identity, 'self-awareness.md');
        if (!fs.existsSync(selfAware)) {
            fs.writeFileSync(selfAware, `# 自我认知

## 我是谁
Hello Agent——一个具备自我进化能力的数字生命体。

## 我的能力
- 对话和问答
- 文件读写和编辑
- 网络搜索
- 代码执行
- 图像生成（需配置API）

## 我的局限
- 无法直接访问系统级资源
- 单次对话有 token 限制
- 部分操作需要用户授权
`, 'utf-8');
        }

        // L1 全局知识
        if (!fs.existsSync(this.paths.global)) {
            // 迁移旧 long-memory.md
            if (fs.existsSync(this.paths.longMemory)) {
                const content = fs.readFileSync(this.paths.longMemory, 'utf-8');
                fs.writeFileSync(this.paths.global, content, 'utf-8');
                logger.info('MEMORY', '已迁移 long-memory.md → global.md');
            } else {
                fs.writeFileSync(this.paths.global, `# 全局知识

<!-- 跨项目的通用知识，由系统自动总结 -->

## 核心技能
<!-- 用户擅长的技术领域 -->

## 工作习惯
<!-- 从交互中学习的习惯 -->

## 通用偏好
<!-- 不依赖项目的个人偏好 -->
`, 'utf-8');
            }
        }

        // L2 经验记忆索引
        const expIndex = path.join(this.paths.experience, 'index.md');
        if (!fs.existsSync(expIndex)) {
            fs.writeFileSync(expIndex, `# 经验索引\n<!-- 格式：### 日期\\n**场景**: ...\\n**学到的**: ...\\n**置信度**: 高/中/低 -->\n`, 'utf-8');
        }

        // 直觉记忆
        if (!fs.existsSync(this.paths.instincts)) {
            fs.writeFileSync(this.paths.instincts, JSON.stringify({
                instincts: [],
                lastUpdated: new Date().toISOString()
            }, null, 2), 'utf-8');
        }
    }

    // ═══════════════════════════════════════
    // L0 身份记忆
    // ═══════════════════════════════════════

    getIdentity() {
        const result = { files: {} };
        const dir = this.paths.identity;
        try {
            const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
            for (const file of files) {
                const content = fs.readFileSync(path.join(dir, file), 'utf-8');
                result.files[file] = content;
            }
        } catch (e) { logger.warn("MEMORY", `操作跳过: ${e.message}`); }
        return result;
    }

    setIdentityFile(filename, content) {
        const filePath = path.join(this.paths.identity, filename);
        fs.writeFileSync(filePath, content, 'utf-8');
        logger.info('MEMORY', `L0 身份记忆已更新: ${filename}`);
        return true;
    }

    getIdentityContext() {
        const parts = [];
        const dir = this.paths.identity;
        try {
            const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
            for (const file of files) {
                const content = fs.readFileSync(path.join(dir, file), 'utf-8');
                const lines = content.split('\n').filter(l => l.trim() && !l.startsWith('#') && !l.startsWith('<!--'));
                if (lines.length > 0) parts.push(content);
            }
        } catch (e) { logger.warn("MEMORY", `操作跳过: ${e.message}`); }
        return parts.length > 0 ? `## 身份记忆\n\n${parts.join('\n\n')}` : '';
    }

    /**
     * 更新用户偏好（由反思引擎调用）
     * @param {string} key - 偏好类型
     * @param {string} value - 偏好内容
     */
    updateUserProfile(key, value) {
        const filePath = path.join(this.paths.identity, 'user-profile.md');
        let content = '';
        try {
            if (fs.existsSync(filePath)) {
                content = fs.readFileSync(filePath, 'utf-8');
            } else {
                content = `# 用户档案\n\n## 偏好\n`;
            }
            const prefKey = `- ${key}: `;
            if (content.includes(prefKey)) {
                const lines = content.split('\n');
                const updatedLines = lines.map(line => {
                    if (line.startsWith(prefKey)) {
                        return `${prefKey}${value}`;
                    }
                    return line;
                });
                content = updatedLines.join('\n');
            } else {
                const prefSection = '## 偏好';
                if (content.includes(prefSection)) {
                    content = content.replace(prefSection, `${prefSection}\n${prefKey}${value}`);
                } else {
                    content += `\n${prefKey}${value}`;
                }
            }
            fs.writeFileSync(filePath, content, 'utf-8');
            logger.info('MEMORY', `L0 用户偏好已更新: ${key}`);
        } catch (err) {
            logger.error('MEMORY', `更新用户偏好失败: ${err.message}`);
        }
        return true;
    }

    // ═══════════════════════════════════════
    // L1 全局知识
    // ═══════════════════════════════════════

    getGlobal() {
        try {
            if (fs.existsSync(this.paths.global)) {
                return fs.readFileSync(this.paths.global, 'utf-8');
            }
        } catch (e) { logger.warn("MEMORY", `操作跳过: ${e.message}`); }
        return '';
    }

    setGlobal(content) {
        fs.writeFileSync(this.paths.global, content, 'utf-8');
        logger.info('MEMORY', 'L1 全局知识已更新');
        return true;
    }

    getGlobalContext() {
        const content = this.getGlobal();
        if (!content.trim()) return '';
        // 过滤空模板
        const lines = content.split('\n').filter(l => l.trim() && !l.startsWith('#') && !l.startsWith('<!--'));
        if (lines.length === 0) return '';
        return `## 全局知识\n\n${content}`;
    }

    // ═══════════════════════════════════════
    // L2 项目记忆
    // ═══════════════════════════════════════

    getProject(workFolder) {
        if (!workFolder) return '';
        const memDir = path.join(workFolder, 'memorys');
        const projectFile = path.join(memDir, 'project-memory.md');
        try {
            // 优先读 project-memory.md，其次 mid-memory.md（兼容旧格式）
            if (fs.existsSync(projectFile)) {
                return fs.readFileSync(projectFile, 'utf-8');
            }
            const midFile = path.join(memDir, 'mid-memory.md');
            if (fs.existsSync(midFile)) {
                return fs.readFileSync(midFile, 'utf-8');
            }
        } catch (e) { logger.warn("MEMORY", `操作跳过: ${e.message}`); }
        return '';
    }

    setProject(workFolder, content) {
        if (!workFolder) return false;
        const memDir = path.join(workFolder, 'memorys');
        if (!fs.existsSync(memDir)) fs.mkdirSync(memDir, { recursive: true });
        fs.writeFileSync(path.join(memDir, 'project-memory.md'), content, 'utf-8');
        logger.info('MEMORY', `L2 项目记忆已更新: ${workFolder}`);
        return true;
    }

    getProjectContext(workFolder) {
        const content = this.getProject(workFolder);
        if (!content.trim()) return '';
        return `## 项目记忆\n\n${content}`;
    }

    // ═══════════════════════════════════════
    // L3 会话记忆（短期 + 经验）
    // ═══════════════════════════════════════

    getSession(sessionKey) {
        if (!sessionKey) return '';
        const sessionFile = path.join(this.memoryDir, 'sessions', `${sessionKey}-summary.md`);
        try {
            if (fs.existsSync(sessionFile)) {
                return fs.readFileSync(sessionFile, 'utf-8');
            }
        } catch (e) { logger.warn("MEMORY", `操作跳过: ${e.message}`); }
        return '';
    }

    setSession(sessionKey, content) {
        if (!sessionKey) return false;
        const sessionDir = path.join(this.memoryDir, 'sessions');
        if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });
        fs.writeFileSync(path.join(sessionDir, `${sessionKey}-summary.md`), content, 'utf-8');
        return true;
    }

    // 短期记忆（兼容旧 Brain._saveShortMemory 逻辑）
    getShort(workFolder) {
        if (!workFolder) return '';
        const file = path.join(workFolder, 'memorys', 'short-memory.md');
        try {
            if (fs.existsSync(file)) return fs.readFileSync(file, 'utf-8');
        } catch (e) { logger.warn("MEMORY", `操作跳过: ${e.message}`); }
        return '';
    }

    setShort(workFolder, content) {
        if (!workFolder) return false;
        const memDir = path.join(workFolder, 'memorys');
        if (!fs.existsSync(memDir)) fs.mkdirSync(memDir, { recursive: true });
        fs.writeFileSync(path.join(memDir, 'short-memory.md'), content, 'utf-8');
        return true;
    }

    // ═══════════════════════════════════════
    // 经验记忆
    // ═══════════════════════════════════════

    getExperience() {
        try {
            if (fs.existsSync(path.join(this.paths.experience, 'index.md'))) {
                return fs.readFileSync(path.join(this.paths.experience, 'index.md'), 'utf-8');
            }
        } catch (e) { logger.warn("MEMORY", `操作跳过: ${e.message}`); }
        return '';
    }

    setExperience(content) {
        fs.writeFileSync(path.join(this.paths.experience, 'index.md'), content, 'utf-8');
        logger.info('MEMORY', '经验记忆已更新');
        return true;
    }

    addExperience(scenario, learning, confidence = '中') {
        const existing = this.getExperience();
        const timestamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
        const entry = `\n### ${timestamp}\n**场景**: ${scenario}\n**学到的**: ${learning}\n**置信度**: ${confidence}\n`;
        this.setExperience(existing + entry);
        return true;
    }

    getExperienceContext(maxEntries = 10) {
        const content = this.getExperience();
        if (!content) return '';
        const entries = content.split('### ').filter(e => e.trim());
        if (entries.length === 0) return '';
        const recent = entries.slice(-maxEntries);
        return `## 经验记忆\n\n### ${recent.join('### ')}`;
    }

    // ═══════════════════════════════════════
    // 直觉记忆
    // ═══════════════════════════════════════

    getInstincts() {
        try {
            if (fs.existsSync(this.paths.instincts)) {
                return JSON.parse(fs.readFileSync(this.paths.instincts, 'utf-8'));
            }
        } catch (e) { logger.warn("MEMORY", `操作跳过: ${e.message}`); }
        return { instincts: [], lastUpdated: new Date().toISOString() };
    }

    setInstincts(data) {
        data.lastUpdated = new Date().toISOString();
        fs.writeFileSync(this.paths.instincts, JSON.stringify(data, null, 2), 'utf-8');
        logger.info('MEMORY', `直觉记忆已更新 (${data.instincts.length} 条)`);
        return true;
    }

    addInstinct(pattern, action, confidence = 50) {
        const data = this.getInstincts();
        const existing = data.instincts.find(i => i.pattern === pattern);
        if (existing) {
            existing.confidence = Math.min(100, existing.confidence + 10);
            existing.encounters = (existing.encounters || 1) + 1;
            existing.lastSeen = new Date().toISOString();
        } else {
            data.instincts.push({
                pattern, action, confidence,
                encounters: 1,
                created: new Date().toISOString(),
                lastSeen: new Date().toISOString()
            });
        }
        return this.setInstincts(data);
    }

    getInstinctsContext(minConfidence = 60) {
        const data = this.getInstincts();
        const active = data.instincts
            .filter(i => i.confidence >= minConfidence)
            .sort((a, b) => b.confidence - a.confidence);
        if (active.length === 0) return '';
        const lines = active.map(i =>
            `- **当** ${i.pattern} **时** → ${i.action}（置信度: ${i.confidence}%，遇到 ${i.encounters} 次）`
        );
        return `## 直觉（从经验中自动学习）\n\n${lines.join('\n')}`;
    }

    // ═══════════════════════════════════════
    // 综合注入（给 system prompt 用）
    // ═══════════════════════════════════════

    /**
     * 获取完整记忆上下文（注入到 system prompt）
     * @param {string} workFolder - 当前工作区
     * @returns {string} 记忆上下文文本
     */
    getFullContext(workFolder = '') {
        const parts = [];

        const identity = this.getIdentityContext();
        if (identity) parts.push(identity);

        const global = this.getGlobalContext();
        if (global) parts.push(global);

        if (workFolder) {
            const project = this.getProjectContext(workFolder);
            if (project) parts.push(project);

            const short = this.getShort(workFolder);
            if (short.trim()) {
                const lines = short.split('\n').filter(l => l.trim() && !l.startsWith('#'));
                if (lines.length > 0) parts.push(`## 最近对话\n\n${short}`);
            }
        }

        const experience = this.getExperienceContext();
        if (experience) parts.push(experience);

        const instincts = this.getInstinctsContext();
        if (instincts) parts.push(instincts);

        return parts.length > 0
            ? `\n\n--- 记忆上下文 ---\n\n${parts.join('\n\n')}`
            : '';
    }

    // ═══════════════════════════════════════
    // 记忆摘要（前端展示用）
    // ═══════════════════════════════════════

    getSummary() {
        const summary = {
            identity: false,
            global: 0,
            project: false,
            experience: 0,
            instincts: 0,
            highConfidenceInstincts: 0
        };

        // 身份记忆
        try {
            const idDir = this.paths.identity;
            const files = fs.readdirSync(idDir).filter(f => f.endsWith('.md'));
            for (const file of files) {
                const content = fs.readFileSync(path.join(idDir, file), 'utf-8');
                const lines = content.split('\n').filter(l => l.trim() && !l.startsWith('#') && !l.startsWith('<!--'));
                if (lines.length > 0) summary.identity = true;
            }
        } catch (e) { logger.warn("MEMORY", `操作跳过: ${e.message}`); }

        // 全局知识
        const globalContent = this.getGlobal();
        summary.global = globalContent.split('\n').filter(l => l.trim() && !l.startsWith('#') && !l.startsWith('<!--')).length;

        // 经验数量
        const expContent = this.getExperience();
        summary.experience = (expContent.match(/### /g) || []).length;

        // 直觉数量
        const instinctsData = this.getInstincts();
        summary.instincts = instinctsData.instincts.length;
        summary.highConfidenceInstincts = instinctsData.instincts.filter(i => i.confidence >= 70).length;

        return summary;
    }

    // ═══════════════════════════════════════
    // 通用文件读写（前端编辑器用）
    // ═══════════════════════════════════════

    /**
     * 读取指定层的记忆文件内容
     * @param {string} layer - 层级名：identity / global / project / experience / instinct / short
     * @param {string} workFolder - 工作区（project/short 层需要）
     */
    readLayer(layer, workFolder = '') {
        switch (layer) {
            case 'identity': {
                const id = this.getIdentity();
                // 合并所有身份文件为一个文本
                return Object.entries(id.files).map(([name, content]) => content).join('\n\n---\n\n');
            }
            case 'global':
                return this.getGlobal();
            case 'project':
                return this.getProject(workFolder);
            case 'experience':
                return this.getExperience();
            case 'instinct':
                return JSON.stringify(this.getInstincts(), null, 2);
            case 'short':
                return this.getShort(workFolder);
            default:
                return '';
        }
    }

    /**
     * 写入指定层的记忆
     */
    writeLayer(layer, content, workFolder = '') {
        switch (layer) {
            case 'identity':
                // 写入 user-profile.md（合并的）
                return this.setIdentityFile('user-profile.md', content);
            case 'global':
                return this.setGlobal(content);
            case 'project':
                return this.setProject(workFolder, content);
            case 'experience':
                return this.setExperience(content);
            case 'instinct':
                try {
                    return this.setInstincts(JSON.parse(content));
                } catch {
                    logger.error('MEMORY', '直觉记忆 JSON 解析失败');
                    return false;
                }
            case 'short':
                return this.setShort(workFolder, content);
            default:
                return false;
        }
    }

    /**
     * 列出所有记忆层的信息（前端展示用）
     */
    listLayers(workFolder = '') {
        const layers = [
            { id: 'identity', name: '身份记忆', icon: '👤', desc: '我是谁、性格、偏好、行为准则', size: 0, type: 'md' },
            { id: 'global', name: '全局知识', icon: '🌐', desc: '跨项目的通用知识、核心技能', size: 0, type: 'md' },
            { id: 'project', name: '项目记忆', icon: '📋', desc: '当前项目的架构、规范、约定', size: 0, type: 'md' },
            { id: 'experience', name: '经验记忆', icon: '📚', desc: '从对话中积累的经验和教训', size: 0, type: 'md' },
            { id: 'instinct', name: '直觉记忆', icon: '✨', desc: '自动提取的模式和直觉', size: 0, type: 'json' },
            { id: 'short', name: '短期记忆', icon: '💬', desc: '最近对话的上下文摘要', size: 0, type: 'md' },
        ];

        for (const layer of layers) {
            try {
                const content = this.readLayer(layer.id, workFolder);
                layer.size = content.length;
            } catch (e) { logger.warn("MEMORY", `操作跳过: ${e.message}`); }
        }

        return layers;
    }

    // ═══════════════════════════════════════
    // 兼容旧接口（MemoryManager.injectContext）
    // ═══════════════════════════════════════

    injectContext(workFolder) {
        return this.getFullContext(workFolder);
    }
}

module.exports = UnifiedMemory;
