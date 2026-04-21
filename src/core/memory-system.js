// core/memory-system.js — 完整的记忆系统
// 四层记忆：身份记忆 / 工作记忆 / 经验记忆 / 技能记忆
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

class MemorySystem {
    constructor(dataDir) {
        this.dataDir = dataDir;
        this.memoryDir = path.join(dataDir, 'memory');
        this._ensureDirs();
    }

    _ensureDirs() {
        const dirs = [
            this.memoryDir,
            path.join(this.memoryDir, 'identity'),    // 身份记忆
            path.join(this.memoryDir, 'working'),      // 工作记忆
            path.join(this.memoryDir, 'experience'),   // 经验记忆
            path.join(this.memoryDir, 'skills')        // 技能记忆（直觉）
        ];
        for (const dir of dirs) {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        }
        // 初始化默认文件
        this._initDefaults();
    }

    _initDefaults() {
        // 身份记忆 - 用户档案
        const identityFile = path.join(this.memoryDir, 'identity', 'user-profile.md');
        if (!fs.existsSync(identityFile)) {
            fs.writeFileSync(identityFile, `# 用户档案

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

        // 身份记忆 - 自我认知
        const selfFile = path.join(this.memoryDir, 'identity', 'self-awareness.md');
        if (!fs.existsSync(selfFile)) {
            fs.writeFileSync(selfFile, `# 自我认知

## 我是谁
Hello Agent——一个具备自我进化能力的数字生命体。

## 我的能力
- 对话和问答
- 文件读写和编辑
- 网络搜索
- 代码执行
- 天气查询
- 图像生成（需配置API）

## 我的局限
- 无法直接访问系统级资源
- 单次对话有 token 限制
- 部分操作需要用户授权

## 进化记录
<!-- 自动记录每次自我改进 -->
`, 'utf-8');
        }

        // 经验记忆索引
        const expIndex = path.join(this.memoryDir, 'experience', 'index.md');
        if (!fs.existsSync(expIndex)) {
            fs.writeFileSync(expIndex, `# 经验索引
<!-- 格式：### 日期\n**场景**: ...\n**学到的**: ...\n**置信度**: 高/中/低 -->
`, 'utf-8');
        }

        // 技能/直觉索引
        const skillIndex = path.join(this.memoryDir, 'skills', 'instincts.json');
        if (!fs.existsSync(skillIndex)) {
            fs.writeFileSync(skillIndex, JSON.stringify({
                instincts: [],
                lastUpdated: new Date().toISOString()
            }, null, 2), 'utf-8');
        }
    }

    // ═══════════════════════════════════════
    // 身份记忆
    // ═══════════════════════════════════════

    /**
     * 读取身份记忆（用于注入 system prompt）
     */
    getIdentityContext() {
        const parts = [];
        const identityDir = path.join(this.memoryDir, 'identity');
        
        try {
            const files = fs.readdirSync(identityDir).filter(f => f.endsWith('.md'));
            for (const file of files) {
                const content = fs.readFileSync(path.join(identityDir, file), 'utf-8');
                // 跳过空模板（没有实际内容的）
                const lines = content.split('\n').filter(l => l.trim() && !l.startsWith('#') && !l.startsWith('<!--'));
                if (lines.length > 0) {
                    parts.push(content);
                }
            }
        } catch {}
        
        return parts.length > 0 
            ? `## 身份记忆\n\n${parts.join('\n\n')}` 
            : '';
    }

    /**
     * 更新用户档案
     */
    updateUserProfile(section, content) {
        const filePath = path.join(this.memoryDir, 'identity', 'user-profile.md');
        try {
            let existing = '';
            if (fs.existsSync(filePath)) {
                existing = fs.readFileSync(filePath, 'utf-8');
            }
            
            // 检查 section 是否已存在
            const sectionRegex = new RegExp(`## ${section}[\\s\\S]*?(?=## |$)`);
            if (sectionRegex.test(existing)) {
                existing = existing.replace(sectionRegex, `## ${section}\n${content}\n\n`);
            } else {
                existing += `\n## ${section}\n${content}\n`;
            }
            
            fs.writeFileSync(filePath, existing, 'utf-8');
            logger.info('MEMORY', `用户档案已更新: ${section}`);
            return true;
        } catch (err) {
            logger.error('MEMORY', `更新用户档案失败: ${err.message}`);
            return false;
        }
    }

    // ═══════════════════════════════════════
    // 工作记忆（当前会话上下文）
    // ═══════════════════════════════════════

    /**
     * 保存工作记忆
     */
    saveWorkingMemory(sessionKey, summary) {
        const filePath = path.join(this.memoryDir, 'working', `${sessionKey || 'default'}.md`);
        try {
            const timestamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
            const content = `# 工作记忆 (${sessionKey || 'default'})\n\n更新时间: ${timestamp}\n\n${summary}`;
            fs.writeFileSync(filePath, content, 'utf-8');
            return true;
        } catch (err) {
            logger.error('MEMORY', `保存工作记忆失败: ${err.message}`);
            return false;
        }
    }

    /**
     * 读取工作记忆
     */
    getWorkingMemory(sessionKey) {
        const filePath = path.join(this.memoryDir, 'working', `${sessionKey || 'default'}.md`);
        try {
            if (fs.existsSync(filePath)) {
                return fs.readFileSync(filePath, 'utf-8');
            }
        } catch {}
        return '';
    }

    // ═══════════════════════════════════════
    // 经验记忆（从会话中提取的模式）
    // ═══════════════════════════════════════

    /**
     * 添加经验
     */
    addExperience(scenario, learning, confidence = '中') {
        const indexPath = path.join(this.memoryDir, 'experience', 'index.md');
        try {
            let existing = '';
            if (fs.existsSync(indexPath)) {
                existing = fs.readFileSync(indexPath, 'utf-8');
            }
            
            const timestamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
            const entry = `\n### ${timestamp}\n**场景**: ${scenario}\n**学到的**: ${learning}\n**置信度**: ${confidence}\n`;
            
            fs.writeFileSync(indexPath, existing + entry, 'utf-8');
            logger.info('MEMORY', `新经验: ${scenario.slice(0, 50)}`);
            return true;
        } catch (err) {
            logger.error('MEMORY', `添加经验失败: ${err.message}`);
            return false;
        }
    }

    /**
     * 获取经验上下文（用于注入 system prompt）
     */
    getExperienceContext(maxEntries = 10) {
        const indexPath = path.join(this.memoryDir, 'experience', 'index.md');
        try {
            if (!fs.existsSync(indexPath)) return '';
            const content = fs.readFileSync(indexPath, 'utf-8');
            const entries = content.split('### ').filter(e => e.trim());
            
            if (entries.length === 0) return '';
            
            // 只取最近的条目
            const recent = entries.slice(-maxEntries);
            return `## 经验记忆\n\n### ${recent.join('### ')}`;
        } catch {}
        return '';
    }

    // ═══════════════════════════════════════
    // 直觉/技能记忆（反复出现的模式升级为直觉）
    // ═══════════════════════════════════════

    /**
     * 添加直觉
     */
    addInstinct(pattern, action, confidence = 50) {
        const indexPath = path.join(this.memoryDir, 'skills', 'instincts.json');
        try {
            let data = { instincts: [], lastUpdated: new Date().toISOString() };
            if (fs.existsSync(indexPath)) {
                data = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
            }
            
            // 检查是否已存在类似直觉
            const existing = data.instincts.find(i => i.pattern === pattern);
            if (existing) {
                // 提升置信度
                existing.confidence = Math.min(100, existing.confidence + 10);
                existing.encounters = (existing.encounters || 1) + 1;
                existing.lastSeen = new Date().toISOString();
            } else {
                data.instincts.push({
                    pattern,
                    action,
                    confidence,
                    encounters: 1,
                    created: new Date().toISOString(),
                    lastSeen: new Date().toISOString()
                });
            }
            
            data.lastUpdated = new Date().toISOString();
            fs.writeFileSync(indexPath, JSON.stringify(data, null, 2), 'utf-8');
            logger.info('MEMORY', `直觉更新: ${pattern.slice(0, 30)} (置信度: ${confidence})`);
            return true;
        } catch (err) {
            logger.error('MEMORY', `添加直觉失败: ${err.message}`);
            return false;
        }
    }

    /**
     * 获取高置信度直觉（用于注入 system prompt）
     */
    getInstinctsContext(minConfidence = 60) {
        const indexPath = path.join(this.memoryDir, 'skills', 'instincts.json');
        try {
            if (!fs.existsSync(indexPath)) return '';
            const data = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
            
            const active = data.instincts
                .filter(i => i.confidence >= minConfidence)
                .sort((a, b) => b.confidence - a.confidence);
            
            if (active.length === 0) return '';
            
            const lines = active.map(i => 
                `- **当** ${i.pattern} **时** → ${i.action}（置信度: ${i.confidence}%，遇到 ${i.encounters} 次）`
            );
            
            return `## 直觉（从经验中自动学习）\n\n${lines.join('\n')}`;
        } catch {}
        return '';
    }

    // ═══════════════════════════════════════
    // 综合注入（给 system prompt 用）
    // ═══════════════════════════════════════

    /**
     * 获取完整记忆上下文（注入到 system prompt）
     */
    getFullContext() {
        const parts = [];
        
        const identity = this.getIdentityContext();
        if (identity) parts.push(identity);
        
        const experience = this.getExperienceContext();
        if (experience) parts.push(experience);
        
        const instincts = this.getInstinctsContext();
        if (instincts) parts.push(instincts);
        
        return parts.length > 0 
            ? `\n\n--- 记忆上下文 ---\n\n${parts.join('\n\n')}`
            : '';
    }

    /**
     * 获取记忆摘要（用于前端显示）
     */
    getSummary() {
        const summary = {
            identity: false,
            workingMemory: false,
            experiences: 0,
            instincts: 0,
            highConfidenceInstincts: 0
        };

        // 身份记忆
        const identityDir = path.join(this.memoryDir, 'identity');
        try {
            const files = fs.readdirSync(identityDir).filter(f => f.endsWith('.md'));
            for (const file of files) {
                const content = fs.readFileSync(path.join(identityDir, file), 'utf-8');
                const lines = content.split('\n').filter(l => l.trim() && !l.startsWith('#') && !l.startsWith('<!--'));
                if (lines.length > 0) summary.identity = true;
            }
        } catch {}

        // 经验数量
        const indexPath = path.join(this.memoryDir, 'experience', 'index.md');
        try {
            if (fs.existsSync(indexPath)) {
                const content = fs.readFileSync(indexPath, 'utf-8');
                summary.experiences = (content.match(/### /g) || []).length;
            }
        } catch {}

        // 直觉数量
        const instinctsPath = path.join(this.memoryDir, 'skills', 'instincts.json');
        try {
            if (fs.existsSync(instinctsPath)) {
                const data = JSON.parse(fs.readFileSync(instinctsPath, 'utf-8'));
                summary.instincts = data.instincts.length;
                summary.highConfidenceInstincts = data.instincts.filter(i => i.confidence >= 70).length;
            }
        } catch {}

        return summary;
    }
}

module.exports = MemorySystem;
