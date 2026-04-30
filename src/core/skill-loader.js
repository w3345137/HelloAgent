// core/skill-loader.js — 技能加载器
// 参考 ECC 的 SKILL.md 设计：按需加载，不是每次都塞所有技能描述
// 支持双层目录：项目级 (src/skills/) + 全局级 (~/.workbuddy/skills/)
const fs = require('fs');
const path = require('path');
const os = require('os');
const logger = require('./logger');
const { parseFrontmatter, scanSkillDir } = require('./yaml-parser');

class SkillLoader {
    constructor(dataDir) {
        this.dataDir = dataDir;
        this.skillsDir = path.join(dataDir, 'skills');
        // 全局技能目录（跨项目共享，支持平台：WorkBuddy / Claude Code / Trae / .agents）
        this.globalDirs = [
            path.join(os.homedir(), '.workbuddy', 'skills'),   // WorkBuddy
            path.join(os.homedir(), '.claude', 'skills'),       // Claude Code / OMC
            path.join(os.homedir(), '.trae', 'skills'),         // Trae CN
            path.join(os.homedir(), '.trae-cn', 'skills'),      // Trae CN (备选)
            path.join(os.homedir(), '.agents', 'skills'),       // 开放标准
        ].filter(dir => fs.existsSync(dir)); // 只保留实际存在的目录
        this.cache = new Map(); // 技能缓存
        this._initBuiltinSkills();
        this._loadGlobalSkills(); // 加载全局技能
    }

    _initBuiltinSkills() {
        // 确保技能目录存在
        if (!fs.existsSync(this.skillsDir)) {
            fs.mkdirSync(this.skillsDir, { recursive: true });
        }

        // 创建内置技能（如果不存在）
        const builtinSkills = {
            'code-review': {
                name: '代码审查',
                description: '系统性审查代码质量、安全性和可维护性',
                trigger: ['审查代码', 'review', '检查代码', 'code review'],
                instructions: `## 代码审查流程

1. **先读取目标文件**：用 file_read 完整读取要审查的文件
2. **架构分析**：识别设计模式、依赖关系、模块边界
3. **安全扫描**：检查 SQL 注入、XSS、硬编码密钥、不安全的 API 调用
4. **性能审查**：N+1 查询、不必要的循环、大对象复制、缺少缓存
5. **可维护性**：命名规范、函数长度、注释质量、错误处理
6. **输出格式**：
   - 🔴 严重问题（必须修复）
   - 🟡 建议改进（推荐修复）
   - 🟢 良好实践（值得保持）

安全护栏：
- 不执行任何代码
- 不修改任何文件
- 只读取和分析`
            },
            'debug': {
                name: '系统性排障',
                description: '结构化地定位和修复 bug',
                trigger: ['调试', 'debug', '报错', 'bug', '修复', '错误', 'error', '异常'],
                instructions: `## 系统性排障流程

1. **复现问题**：先理解完整的错误信息和上下文
2. **定位范围**：
   - 读取错误堆栈涉及的文件
   - 确定是前端问题还是后端问题
   - 确定是代码问题还是配置问题
3. **根因分析**：
   - 检查最近的代码变更
   - 验证输入数据和边界条件
   - 检查异步/并发问题
4. **提出修复方案**：
   - 给出最小修改方案
   - 说明修改原因
   - 提示可能的副作用
5. **验证修复**：建议测试方法

安全护栏：
- 先分析后动手
- 不做不必要的修改
- 每次修改后验证`
            },
            'refactor': {
                name: '重构优化',
                description: '在不改变功能的前提下改善代码结构',
                trigger: ['重构', 'refactor', '优化', 'clean', '整理'],
                instructions: `## 重构流程

1. **理解现有代码**：先用 file_read 完整读取
2. **识别坏味道**：
   - 重复代码
   - 过长函数
   - 过深嵌套
   - 魔法数字
   - 不恰当的命名
3. **制定重构计划**：列出要做的修改，一次只做一类
4. **逐步执行**：用 file_edit 精确替换
5. **验证**：每次修改后确认逻辑不变

安全护栏：
- 不改变外部行为
- 每步可验证
- 保留注释和文档`
            },
            'learn': {
                name: '从会话中学习',
                description: '从当前对话中提取经验模式和最佳实践',
                trigger: ['总结经验', '学习', '提取模式', '反思'],
                instructions: `## 学习流程

1. **回顾对话**：分析本轮对话的关键决策和操作
2. **提取模式**：
   - 发现了什么有效的解决方法？
   - 犯了什么错误？怎么修正的？
   - 有没有反复出现的模式？
3. **存储经验**：用 memory_save 保存关键经验
4. **生成直觉**：如果某个模式出现多次，升级为直觉

输出格式：
- 📝 本轮学到的经验（2-3条）
- 🧠 建议保存的直觉（如果有）
- 💡 下次可以做得更好的地方`
            }
        };

        for (const [id, skill] of Object.entries(builtinSkills)) {
            const skillDir = path.join(this.skillsDir, id);
            const skillFile = path.join(skillDir, 'SKILL.md');
            
            if (!fs.existsSync(skillDir)) {
                fs.mkdirSync(skillDir, { recursive: true });
            }
            
            if (!fs.existsSync(skillFile)) {
                const content = `---
name: ${skill.name}
description: ${skill.description}
triggers:
${skill.trigger.map(t => `  - "${t}"`).join('\n')}
---

${skill.instructions}`;
                fs.writeFileSync(skillFile, content, 'utf-8');
            }
        }

        // 加载缓存
        this._loadAll();

        if (this.globalDirs.length > 0) {
            console.log(`[SkillLoader] 全局技能目录: ${this.globalDirs.join(', ')}`);
        }
    }

    /**
     * 加载全局目录中的技能（不初始化内置技能，只是读取已有的 SKILL.md）
     */
    _loadGlobalSkills() {
        for (const dir of this.globalDirs) {
            try {
                const entries = fs.readdirSync(dir, { withFileTypes: true });
                for (const entry of entries) {
                    if (!entry.isDirectory()) continue;
                    const skillFile = path.join(dir, entry.name, 'SKILL.md');
                    if (!fs.existsSync(skillFile)) continue;

                    // 项目级技能优先：同名不覆盖
                    if (this.cache.has(entry.name)) continue;

                    const content = fs.readFileSync(skillFile, 'utf-8');
                    const parsed = parseFrontmatter(content);
                    if (parsed) {
                        // 扁平化存储，与 _loadAll() 一致
                        this.cache.set(entry.name, {
                            name: parsed.meta.name || entry.name,
                            description: parsed.meta.description || '',
                            triggers: parsed.meta.triggers || [],
                            instructions: parsed.body || '',
                            _source: dir // 标记来源
                        });
                    }
                }
            } catch (err) {
                logger.warn('SKILL', `读取全局技能目录失败: ${dir} - ${err.message}`);
            }
        }
    }

    _loadAll() {
        try {
            const dirs = fs.readdirSync(this.skillsDir, { withFileTypes: true })
                .filter(d => d.isDirectory());
            
            for (const dir of dirs) {
                const skillFile = path.join(this.skillsDir, dir.name, 'SKILL.md');
                if (fs.existsSync(skillFile)) {
                    const content = fs.readFileSync(skillFile, 'utf-8');
                    const parsed = parseFrontmatter(content);
                    if (parsed) {
                        // 扁平化存储：meta 字段提到顶层，body 作为 instructions
                        this.cache.set(dir.name, {
                            name: parsed.meta.name || dir.name,
                            description: parsed.meta.description || '',
                            triggers: parsed.meta.triggers || [],
                            instructions: parsed.body || ''
                        });
                    }
                }
            }
            
            logger.info('SKILL', `已加载 ${this.cache.size} 个技能`);
        } catch (err) {
            logger.error('SKILL', `加载技能失败: ${err.message}`);
        }
    }

    /**
     * 根据用户输入匹配技能
     * 返回匹配的技能指令（用于注入 system prompt）
     */
    matchSkill(userInput) {
        const input = userInput.toLowerCase();
        const matches = [];

        for (const [id, skill] of this.cache.entries()) {
            const triggers = skill.triggers || [];
            for (const trigger of triggers) {
                const t = trigger.toLowerCase();
                // 双向子串匹配：触发词在输入中，或输入中包含触发词的关键部分
                if (input.includes(t) || t.includes(input) || this._fuzzyMatch(input, t)) {
                    matches.push(skill);
                    break;
                }
            }
        }

        if (matches.length > 0) {
            // 返回最匹配的技能指令
            return matches.map(s => `### 技能: ${s.name}\n${s.instructions}`).join('\n\n');
        }

        return '';
    }

    /**
     * 模糊匹配：检查触发词的每个字符是否在输入中出现
     * 用于处理"审查代码" vs "帮我审查一下代码"这类情况
     */
    _fuzzyMatch(input, trigger) {
        // 如果触发词长度 >= 2，拆分成单字检查
        if (trigger.length < 2) return false;
        
        // 中文触发词：逐字检查（至少匹配 50% 的字）
        if (/[\u4e00-\u9fff]/.test(trigger)) {
            const chars = [...new Set(trigger.split(''))].filter(c => c.trim());
            const inputChars = new Set(input.split(''));
            const matched = chars.filter(c => inputChars.has(c)).length;
            return matched >= Math.ceil(chars.length * 0.5);
        }
        
        // 英文触发词：检查是否包含
        return input.includes(trigger);
    }

    /**
     * 获取技能列表（供前端显示）
     */
    listSkills() {
        const list = [];
        for (const [id, skill] of this.cache.entries()) {
            list.push({
                id,
                name: skill.name || id,
                description: skill.description || '',
                triggers: skill.triggers || []
            });
        }
        return list;
    }

    /**
     * 重新加载技能（热更新）
     */
    reload() {
        this.cache.clear();
        this._loadAll();
        this._loadGlobalSkills();
    }

    /**
     * 导入 SkillHub 格式的技能包（兼容 .skill zip 和目录）
     * SkillHub 标准结构：
     *   skill-name/
     *   ├── SKILL.md（必需）
     *   ├── scripts/（可选）
     *   ├── references/（可选）
     *   └── assets/（可选）
     * 
     * Hello Agent 的 SKILL.md 格式是 SkillHub 标准的超集（额外支持 triggers, version, category 等）
     * 标准 SkillHub 的 SKILL.md 只有 name + description，也完全兼容
     */
    importSkill(sourcePath) {
        try {
            // 检查源路径是否存在
            if (!fs.existsSync(sourcePath)) {
                return { success: false, error: `源路径不存在: ${sourcePath}` };
            }

            const stat = fs.statSync(sourcePath);

            // 如果是 .skill zip 文件
            if (sourcePath.endsWith('.skill') || (stat.isFile() && sourcePath.endsWith('.zip'))) {
                return this._importSkillZip(sourcePath);
            }

            // 如果是目录
            if (stat.isDirectory()) {
                return this._importSkillDir(sourcePath);
            }

            return { success: false, error: '不支持的格式，请提供 .skill/.zip 文件或包含 SKILL.md 的目录' };
        } catch (err) {
            logger.error('SKILL', `导入技能失败: ${err.message}`);
            return { success: false, error: err.message };
        }
    }

    _importSkillDir(sourceDir) {
        const skillFile = path.join(sourceDir, 'SKILL.md');
        if (!fs.existsSync(skillFile)) {
            return { success: false, error: `目录中未找到 SKILL.md: ${sourceDir}` };
        }

        // 解析 SKILL.md 获取技能名
        const content = fs.readFileSync(skillFile, 'utf-8');
        const parsed = parseFrontmatter(content);
        if (!parsed) {
            return { success: false, error: 'SKILL.md 格式无效' };
        }

        const skillName = (parsed.meta && parsed.meta.name) || path.basename(sourceDir);
        const targetDir = path.join(this.skillsDir, skillName.toLowerCase().replace(/\s+/g, '-'));

        // 复制整个目录
        this._copyDirRecursive(sourceDir, targetDir);

        // 刷新缓存
        this.reload();

        logger.info('SKILL', `✅ 技能已导入: ${skillName}`);
        return { success: true, name: skillName, path: targetDir };
    }

    _importSkillZip(zipPath) {
        // 需要 unzip 命令（macOS/Linux 自带）
        const { execSync } = require('child_process');
        const tmpDir = path.join(this.skillsDir, '.tmp-import');
        
        try {
            // 清理临时目录
            if (fs.existsSync(tmpDir)) {
                fs.rmSync(tmpDir, { recursive: true, force: true });
            }
            fs.mkdirSync(tmpDir, { recursive: true });

            // 解压
            execSync(`unzip -q "${zipPath}" -d "${tmpDir}"`, { timeout: 10000 });

            // 查找 SKILL.md
            const skillFile = this._findFileRecursive(tmpDir, 'SKILL.md');
            if (!skillFile) {
                fs.rmSync(tmpDir, { recursive: true, force: true });
                return { success: false, error: 'zip 中未找到 SKILL.md' };
            }

            const sourceDir = path.dirname(skillFile);
            const result = this._importSkillDir(sourceDir);

            // 清理临时目录
            fs.rmSync(tmpDir, { recursive: true, force: true });

            return result;
        } catch (err) {
            // 清理临时目录
            try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { logger.warn("SKILL", `操作跳过: ${e.message}`); }
            return { success: false, error: `解压失败: ${err.message}` };
        }
    }

    _findFileRecursive(dir, filename) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isFile() && entry.name === filename) return fullPath;
            if (entry.isDirectory()) {
                const found = this._findFileRecursive(fullPath, filename);
                if (found) return found;
            }
        }
        return null;
    }

    _copyDirRecursive(src, dest) {
        if (!fs.existsSync(dest)) {
            fs.mkdirSync(dest, { recursive: true });
        }
        const entries = fs.readdirSync(src, { withFileTypes: true });
        for (const entry of entries) {
            const srcPath = path.join(src, entry.name);
            const destPath = path.join(dest, entry.name);
            if (entry.isDirectory()) {
                this._copyDirRecursive(srcPath, destPath);
            } else {
                fs.copyFileSync(srcPath, destPath);
            }
        }
    }
}

module.exports = SkillLoader;
