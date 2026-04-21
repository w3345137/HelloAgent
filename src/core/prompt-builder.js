// core/prompt-builder.js — 提示词构建器
// 参考 Hermes Agent 的 Prompt Builder 设计：
// 确定性注入：相同输入始终产生相同 prompt 结构
// 分层注入优先级：系统人格 → 身份记忆 → 全局知识 → 项目记忆 → 技能索引 → 工具列表 → 对话历史 → 用户输入
const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const { parseFrontmatter } = require('./yaml-parser');

class PromptBuilder {
    constructor(dataDir) {
        this.dataDir = dataDir;
        this.memoryDir = path.join(dataDir, 'memory');
        this.skillsDir = path.join(dataDir, 'skills');

        // 缓存技能索引（L0），避免每次都读磁盘
        this._skillIndexCache = null;
        this._skillIndexTimestamp = 0;
    }

    /**
     * 构建完整的 system prompt
     * @param {Object} options
     * @param {string} options.basePrompt - 基础系统提示词
     * @param {string} options.workFolder - 当前工作区目录
     * @param {string} options.sessionKey - 当前会话标识
     * @param {boolean} options.includeIdentity - 是否注入身份记忆（默认 true）
     * @param {boolean} options.includeWorking - 是否注入工作记忆（默认 true）
     * @param {boolean} options.includeSkillIndex - 是否注入技能索引 L0（默认 true）
     * @returns {string} 完整的 system prompt
     */
    build(options = {}) {
        const {
            basePrompt = '',
            workFolder = '',
            sessionKey = null,
            includeIdentity = true,
            includeWorking = true,
            includeSkillIndex = true
        } = options;

        const sections = [];

        // Layer 1: 基础人格（最高优先级）
        if (basePrompt) {
            sections.push(basePrompt);
        }

        // Layer 2: 身份记忆（用户画像 + 自我认知）
        if (includeIdentity) {
            const identityBlock = this._buildIdentityBlock();
            if (identityBlock) sections.push(identityBlock);
        }

        // Layer 3: 工作记忆（当前项目上下文）
        if (includeWorking && workFolder) {
            const workingBlock = this._buildWorkingBlock(workFolder);
            if (workingBlock) sections.push(workingBlock);
        }

        // Layer 4: 工作区信息
        if (workFolder) {
            sections.push(`【工作区】\n当前任务的工作区目录：${workFolder}\n你对该目录有读写权限。执行 shell 命令时，默认在此目录下操作。使用 file_read / file_write 时，路径基于此目录。`);
        }

        // Layer 5: 技能索引（L0 — 仅名称+描述，约 500-1000 tokens）
        if (includeSkillIndex) {
            const skillIndex = this._buildSkillIndexL0();
            if (skillIndex) sections.push(skillIndex);
        }

        return sections.join('\n\n');
    }

    /**
     * 构建身份记忆块
     * 格式参考 Hermes 的冻结快照设计
     */
    _buildIdentityBlock() {
        const parts = [];

        // 用户画像
        const userProfile = path.join(this.memoryDir, 'identity', 'user-profile.md');
        if (fs.existsSync(userProfile)) {
            const content = fs.readFileSync(userProfile, 'utf-8').trim();
            if (content) {
                const charCount = content.length;
                parts.push(`═══ 用户画像 [${charCount} 字符] ═══\n${content}`);
            }
        }

        // 自我认知
        const selfAware = path.join(this.memoryDir, 'identity', 'self-awareness.md');
        if (fs.existsSync(selfAware)) {
            const content = fs.readFileSync(selfAware, 'utf-8').trim();
            if (content) {
                parts.push(`═══ 自我认知 ═══\n${content}`);
            }
        }

        return parts.length > 0 ? parts.join('\n\n') : '';
    }

    /**
     * 构建工作记忆块
     */
    _buildWorkingBlock(workFolder) {
        const parts = [];

        // 全局工作记忆
        const workingDir = path.join(this.memoryDir, 'working');
        if (fs.existsSync(workingDir)) {
            const files = fs.readdirSync(workingDir).filter(f => f.endsWith('.md'));
            for (const f of files) {
                const content = fs.readFileSync(path.join(workingDir, f), 'utf-8').trim();
                if (content) {
                    parts.push(content);
                }
            }
        }

        // 项目级工作记忆
        if (workFolder) {
            const projectMemory = path.join(workFolder, 'memorys', 'project-memory.md');
            if (fs.existsSync(projectMemory)) {
                const content = fs.readFileSync(projectMemory, 'utf-8').trim();
                if (content) {
                    parts.push(`═══ 项目记忆 ═══\n${content}`);
                }
            }
        }

        return parts.length > 0 ? `═══ 工作记忆 ═══\n${parts.join('\n§\n')}` : '';
    }

    /**
     * 构建技能索引 L0（参考 Hermes 的三级渐进式加载）
     * L0: 仅名称+描述+触发词，约 500-1000 tokens
     * L1: 完整 SKILL.md 内容（由 skill-loader 在匹配后按需加载）
     * L2: references/ 目录下的引用文件（暂不实现）
     */
    _buildSkillIndexL0() {
        const skills = this._loadSkillIndex();
        if (skills.length === 0) return '';

        const lines = ['═══ 可用技能索引 ═══'];
        for (const skill of skills) {
            const triggers = (skill.triggers || []).slice(0, 3).join(', ');
            lines.push(`- ${skill.name || skill.id}: ${skill.description || ''}${triggers ? ` [${triggers}]` : ''}`);
        }
        lines.push('\n当用户请求匹配上述技能时，系统会自动加载完整技能指导。');

        return lines.join('\n');
    }

    /**
     * 加载技能索引（带 30 秒缓存）
     */
    _loadSkillIndex() {
        const now = Date.now();
        if (this._skillIndexCache && (now - this._skillIndexTimestamp) < 30000) {
            return this._skillIndexCache;
        }

        const skills = [];

        try {
            // 扫描顶层技能目录（旧格式）
            this._scanSkillDir(this.skillsDir, skills);

            // 扫描分类子目录（新格式）
            if (fs.existsSync(this.skillsDir)) {
                const entries = fs.readdirSync(this.skillsDir, { withFileTypes: true });
                for (const entry of entries) {
                    if (entry.isDirectory()) {
                        const subDir = path.join(this.skillsDir, entry.name);
                        // 检查是否是分类目录（不含 SKILL.md）
                        const hasSkillFile = fs.existsSync(path.join(subDir, 'SKILL.md'));
                        if (!hasSkillFile) {
                            this._scanSkillDir(subDir, skills);
                        }
                    }
                }
            }
        } catch (err) {
            logger.error('PROMPT_BUILDER', `加载技能索引失败: ${err.message}`);
        }

        this._skillIndexCache = skills;
        this._skillIndexTimestamp = now;
        return skills;
    }

    _scanSkillDir(dir, skills) {
        if (!fs.existsSync(dir)) return;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isDirectory()) {
                const skillFile = path.join(dir, entry.name, 'SKILL.md');
                if (fs.existsSync(skillFile)) {
                    try {
                        const content = fs.readFileSync(skillFile, 'utf-8');
                        const parsed = parseFrontmatter(content);
                        if (parsed) {
                            skills.push({
                                id: entry.name,
                                name: parsed.meta.name || entry.name,
                                description: parsed.meta.description || '',
                                triggers: parsed.meta.triggers || []
                            });
                        }
                    } catch {}
                }
            }
        }
    }

    /**
     * 使缓存失效（技能变更时调用）
     */
    invalidateCache() {
        this._skillIndexCache = null;
        this._skillIndexTimestamp = 0;
    }
}

module.exports = PromptBuilder;
