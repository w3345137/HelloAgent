// core/skill-factory.js — 技能工厂
// 参考 Hermes Agent 的 Skill Factory 设计：
// 任务成功完成后，自动从执行过程中提炼可复用技能（程序性记忆）
// 支持 create / patch / edit / delete 四种操作
const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const { parseFrontmatter } = require('./yaml-parser');

class SkillFactory {
    constructor(adapter, dataDir) {
        this.adapter = adapter;
        this.skillsDir = path.join(dataDir, 'skills');
        this._ensureDir();
    }

    _ensureDir() {
        if (!fs.existsSync(this.skillsDir)) {
            fs.mkdirSync(this.skillsDir, { recursive: true });
        }
    }

    /**
     * 尝试从完成的对话中提炼技能
     * 触发条件（参考 Hermes）：
     * 1. 5+ 工具调用的复杂任务
     * 2. 遇到错误并找到了解决方案
     * 3. 用户纠正了方法
     * 4. 反思引擎识别到可复用模式
     *
     * @param {string} userText - 用户消息
     * @param {string} assistantText - 助手回复
     * @param {Array} toolCalls - 工具调用记录 [{tool, params, status, output}]
     * @param {Array} learnings - 反思引擎提取的经验 [{scenario, insight, confidence}]
     * @returns {Object|null} - 创建的技能信息，或 null
     */
    async tryCreateSkill(userText, assistantText, toolCalls = [], learnings = []) {
        try {
            // 判断是否值得提炼技能
            if (!this._shouldCreateSkill(toolCalls, learnings)) {
                return null;
            }

            logger.info('SKILL_FACTORY', '检测到可复用模式，开始提炼技能...');

            // 构建 LLM prompt，让 AI 分析并生成技能
            const toolSummary = toolCalls.map(t =>
                `- ${t.tool}(${this._summarizeParams(t.params)}): ${t.status}`
            ).join('\n');

            const learningSummary = learnings.map(l =>
                `- 场景: ${l.scenario} | 经验: ${l.insight}`
            ).join('\n');

            const prompt = `分析以下任务执行过程，判断是否包含可复用的工作流。

用户请求: ${userText.slice(0, 300)}
工具调用序列:
${toolSummary}
${learningSummary ? '\n已提取的经验:\n' + learningSummary : ''}

如果这个任务包含可复用的工作流（如：特定类型问题的解决步骤、常见操作的标准化流程），请生成一个技能文件。

回复格式（严格 JSON）:
{
  "shouldCreate": true/false,
  "skillName": "skill-id（英文连字符格式，如 fix-cors-error）",
  "category": "development/operations/creative/analysis",
  "triggers": ["触发词1", "trigger2"],
  "skill": {
    "name": "技能中文名",
    "description": "一句话描述（20字内）",
    "whenToUse": "什么情况下应该使用此技能",
    "procedure": ["步骤1", "步骤2", "步骤3"],
    "pitfalls": ["注意事项1", "注意事项2"],
    "verification": ["验证方法1"]
  }
}

规则:
- shouldCreate 为 false 的情况：简单问答、单次查询、没有固定流程的对话
- shouldCreate 为 true 的情况：多步骤操作、有明确步骤的问题解决、可标准化的工作流
- skillName 必须简洁、描述性强
- procedure 步骤要具体到可执行（提到具体工具名）
- triggers 要包含中英文关键词`;

            const messages = [
                { role: 'system', content: '你是技能提炼引擎。分析任务执行过程，提取可复用的工作流模式。只返回 JSON。' },
                { role: 'user', content: prompt }
            ];

            const response = await this.adapter.chat(messages);
            const text = response.text || response || '';

            // 解析 JSON
            let result;
            try {
                result = JSON.parse(text);
            } catch {
                const jsonMatch = text.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    result = JSON.parse(jsonMatch[0]);
                } else {
                    logger.info('SKILL_FACTORY', 'AI 返回非 JSON，跳过技能生成');
                    return null;
                }
            }

            if (!result.shouldCreate || !result.skillName) {
                logger.info('SKILL_FACTORY', 'AI 判断无需创建技能');
                return null;
            }

            // 检查是否已有类似技能（避免重复）
            const existingSkill = this._findSimilarSkill(result.skillName, result.triggers);
            if (existingSkill) {
                // 已有类似技能，尝试 patch 增强
                return await this.patchSkill(existingSkill, result);
            }

            // 创建新技能
            return this.createSkill(result);

        } catch (err) {
            logger.error('SKILL_FACTORY', `技能提炼失败: ${err.message}`);
            return null;
        }
    }

    /**
     * 判断是否应该创建技能
     */
    _shouldCreateSkill(toolCalls, learnings) {
        // 条件 1：复杂任务（5+ 工具调用）
        if (toolCalls.length >= 5) return true;

        // 条件 2：有错误但最终成功的工具调用（走了弯路）
        const hadError = toolCalls.some(t => t.status === 'error');
        const hadSuccess = toolCalls.some(t => t.status === 'success');
        if (hadError && hadSuccess && toolCalls.length >= 3) return true;

        // 条件 3：反思引擎识别到高置信度经验
        const highConfLearning = learnings.find(l => (l.confidence || 0) >= 70);
        if (highConfLearning) return true;

        // 条件 4：中等复杂度但有明确经验
        if (toolCalls.length >= 3 && learnings.length >= 2) return true;

        return false;
    }

    /**
     * 创建新技能文件
     */
    createSkill(skillData) {
        const { skillName, category, triggers, skill } = skillData;
        const categoryDir = category || 'auto';
        const skillDir = path.join(this.skillsDir, categoryDir, skillName);
        const skillFile = path.join(skillDir, 'SKILL.md');

        // 不覆盖已有技能
        if (fs.existsSync(skillFile)) {
            logger.info('SKILL_FACTORY', `技能已存在: ${skillName}，跳过创建`);
            return { action: 'skip', name: skillName, reason: 'already exists' };
        }

        fs.mkdirSync(skillDir, { recursive: true });

        const content = `---
name: ${skill.name || skillName}
description: ${skill.description || ''}
version: 1.0.0
category: ${categoryDir}
triggers:
${(triggers || []).map(t => `  - "${t}"`).join('\n')}
auto_generated: true
created_at: "${new Date().toISOString()}"
---

## When to Use
${skill.whenToUse || '当遇到类似任务时使用。'}

## Procedure
${(skill.procedure || []).map((step, i) => `${i + 1}. ${step}`).join('\n')}

## Pitfalls
${(skill.pitfalls || []).map(p => `- ${p}`).join('\n')}

## Verification
${(skill.verification || []).map(v => `- [ ] ${v}`).join('\n')}
`;

        fs.writeFileSync(skillFile, content, 'utf-8');
        logger.info('SKILL_FACTORY', `✅ 新技能已创建: ${skillName} (${categoryDir})`);

        return { action: 'create', name: skillName, category: categoryDir, file: skillFile };
    }

    /**
     * 增强已有技能（添加新的经验和步骤）
     */
    async patchSkill(existingSkillId, newSkillData) {
        try {
            // 查找技能文件路径
            const skillFile = this._findSkillFile(existingSkillId);
            if (!skillFile) {
                // 找不到文件，直接创建
                return this.createSkill(newSkillData);
            }

            const existing = fs.readFileSync(skillFile, 'utf-8');
            const parsed = parseFrontmatter(existing);
            if (!parsed) return this.createSkill(newSkillData);

            // 合并新的触发词
            const existingTriggers = parsed.meta.triggers || [];
            const newTriggers = newSkillData.triggers || [];
            const mergedTriggers = [...new Set([...existingTriggers, ...newTriggers])];

            // 添加新经验到 Pitfalls
            const newPitfalls = (newSkillData.skill?.pitfalls || [])
                .filter(p => !existing.includes(p));

            if (newPitfalls.length === 0 && mergedTriggers.length === existingTriggers.length) {
                logger.info('SKILL_FACTORY', `技能 ${existingSkillId} 无需更新`);
                return { action: 'skip', name: existingSkillId, reason: 'no new content' };
            }

            // 在文件末尾追加新经验
            let updated = existing;

            // 更新触发词
            if (mergedTriggers.length > existingTriggers.length) {
                const oldTriggersBlock = existingTriggers.map(t => `  - "${t}"`).join('\n');
                const newTriggersBlock = mergedTriggers.map(t => `  - "${t}"`).join('\n');
                updated = updated.replace(oldTriggersBlock, newTriggersBlock);
            }

            // 追加新的注意事项
            if (newPitfalls.length > 0) {
                const pitfallSection = newPitfalls.map(p => `- ${p}`).join('\n');
                // 在最后一个 ## Verification 之前插入
                if (updated.includes('## Verification')) {
                    updated = updated.replace('## Verification', `## 新增经验 (${new Date().toLocaleDateString('zh-CN')})\n${pitfallSection}\n\n## Verification`);
                } else {
                    updated += `\n\n## 新增经验 (${new Date().toLocaleDateString('zh-CN')})\n${pitfallSection}`;
                }
            }

            // 更新版本号
            const versionMatch = updated.match(/version:\s*(\d+)\.(\d+)\.(\d+)/);
            if (versionMatch) {
                const minor = parseInt(versionMatch[2]) + 1;
                updated = updated.replace(
                    /version:\s*\d+\.\d+\.\d+/,
                    `version: ${versionMatch[1]}.${minor}.${versionMatch[3]}`
                );
            }

            fs.writeFileSync(skillFile, updated, 'utf-8');
            logger.info('SKILL_FACTORY', `📝 技能已增强: ${existingSkillId} (+${newPitfalls.length} 经验)`);

            return { action: 'patch', name: existingSkillId, additions: newPitfalls.length };
        } catch (err) {
            logger.error('SKILL_FACTORY', `技能增强失败: ${err.message}`);
            return null;
        }
    }

    /**
     * 删除技能
     */
    deleteSkill(skillName) {
        const skillFile = this._findSkillFile(skillName);
        if (!skillFile) return { success: false, error: '技能不存在' };

        const skillDir = path.dirname(skillFile);
        fs.rmSync(skillDir, { recursive: true, force: true });
        logger.info('SKILL_FACTORY', `🗑️ 技能已删除: ${skillName}`);
        return { success: true, name: skillName };
    }

    /**
     * 列出所有自动生成的技能
     */
    listAutoSkills() {
        const skills = [];
        try {
            const categories = fs.readdirSync(this.skillsDir, { withFileTypes: true })
                .filter(d => d.isDirectory());

            for (const cat of categories) {
                const catDir = path.join(this.skillsDir, cat.name);
                const skillDirs = fs.readdirSync(catDir, { withFileTypes: true })
                    .filter(d => d.isDirectory());

                for (const sd of skillDirs) {
                    const skillFile = path.join(catDir, sd.name, 'SKILL.md');
                    if (fs.existsSync(skillFile)) {
                        const content = fs.readFileSync(skillFile, 'utf-8');
                        const parsed = this._parseFrontmatter(content);
                        if (parsed) {
                            skills.push({
                                id: sd.name,
                                category: cat.name,
                                ...parsed.meta,
                                auto_generated: parsed.meta.auto_generated || false
                            });
                        }
                    }
                }
            }
        } catch (err) {
            logger.error('SKILL_FACTORY', `列出技能失败: ${err.message}`);
        }
        return skills;
    }

    // ── 辅助方法 ──

    _summarizeParams(params) {
        if (!params) return '';
        const str = JSON.stringify(params);
        return str.length > 80 ? str.slice(0, 80) + '...' : str;
    }

    _findSimilarSkill(name, triggers) {
        // 先精确匹配名称
        const directMatch = this._findSkillFile(name);
        if (directMatch) return name;

        // 再匹配触发词
        if (triggers && triggers.length > 0) {
            try {
                const categories = fs.readdirSync(this.skillsDir, { withFileTypes: true })
                    .filter(d => d.isDirectory());

                for (const cat of categories) {
                    const catDir = path.join(this.skillsDir, cat.name);
                    const skillDirs = fs.readdirSync(catDir, { withFileTypes: true })
                        .filter(d => d.isDirectory());

                    for (const sd of skillDirs) {
                        const skillFile = path.join(catDir, sd.name, 'SKILL.md');
                        if (fs.existsSync(skillFile)) {
                            const content = fs.readFileSync(skillFile, 'utf-8');
                            const parsed = this._parseFrontmatter(content);
                            if (parsed) {
                                const existingTriggers = (parsed.meta.triggers || []).map(t => t.toLowerCase());
                                const overlap = triggers.filter(t => existingTriggers.includes(t.toLowerCase()));
                                if (overlap.length >= 2 || (overlap.length >= 1 && triggers.length <= 2)) {
                                    return sd.name;
                                }
                            }
                        }
                    }
                }
            } catch (e) { logger.warn("SKILL", `操作跳过: ${e.message}`); }
        }

        return null;
    }

    _findSkillFile(name) {
        try {
            const categories = fs.readdirSync(this.skillsDir, { withFileTypes: true })
                .filter(d => d.isDirectory());

            for (const cat of categories) {
                const skillFile = path.join(this.skillsDir, cat.name, name, 'SKILL.md');
                if (fs.existsSync(skillFile)) return skillFile;
            }

            // 也检查顶层目录（旧格式兼容）
            const topLevel = path.join(this.skillsDir, name, 'SKILL.md');
            if (fs.existsSync(topLevel)) return topLevel;
        } catch (e) { logger.warn("SKILL", `操作跳过: ${e.message}`); }
        return null;
    }

}

module.exports = SkillFactory;
