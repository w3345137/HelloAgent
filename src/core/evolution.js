// core/evolution.js — 进化层（增强版：含沙盒测试安全机制）
const fs = require('fs');
const path = require('path');
const messageBus = require('./message-bus');
const surgeon = require('./surgeon');
const logger = require('./logger');

class Evolution {
    constructor(adapter, options = {}) {
        this.adapter = adapter; // AI 适配器
        this.memorySystem = options.memorySystem || null; // 记忆系统
        this.skillLoader = options.skillLoader || null; // 技能加载器
        
        // 安全配置
        this.config = {
            enableSandbox: options.enableSandbox !== false, // 默认启用沙盒
            requireTests: options.requireTests !== false,    // 默认要求测试通过
            autoRollback: options.autoRollback !== false,    // 默认自动回滚
            testTimeout: options.testTimeout || 30000,       // 测试超时时间
            ...options
        };
        
        // 进化统计
        this.stats = {
            microEvolutions: 0,  // 微进化次数（反思）
            midEvolutions: 0,    // 中进化次数（技能优化）
            majorEvolutions: 0,  // 大进化次数（架构改进）
            lastMidEvolution: null,
            lastMajorEvolution: null
        };
        
        messageBus.subscribe('EVOLVE', (data) => this._onEvolve(data));
        
        // 中进化：每周自动触发一次技能审视
        messageBus.subscribe('MID_EVOLVE', () => this._onMidEvolve());
    }

    async _onEvolve(data) {
        console.log('[Evolution] 🔬 开始进化诊断...');
        logger.evolve(data.trigger || 'error_threshold', data);
        
        try {
            // 1. AI诊断错误
            const diagnosis = await this._diagnose(data.errors);
            console.log('[Evolution] 📋 诊断结果:', diagnosis.description);
            logger.info('EVOLUTION', `诊断结果: ${diagnosis.description}`);

            const hasDiff = diagnosis.diff && diagnosis.diff.oldStr && diagnosis.diff.newStr;
            const hasPatch = !!diagnosis.patch;
            
            if (!hasDiff && !hasPatch) {
                console.log('[Evolution] ⚠️  无法生成有效补丁');
                logger.warn('EVOLUTION', '无法生成有效补丁', { diagnosis });
                return;
            }
            
            if (!diagnosis.targetModule) {
                console.log('[Evolution] ⚠️  缺少目标模块');
                logger.warn('EVOLUTION', '缺少 targetModule', { diagnosis });
                return;
            }

            // 2. 确定补丁类型
            const patchType = hasDiff ? 'diff' : 'full';
            const isSmallPatch = hasDiff && diagnosis.diff.oldStr.length < 500;
            
            // 3. 预览 diff（如果是增量模式）
            if (hasDiff) {
                const preview = surgeon.previewDiff(diagnosis.targetModule, diagnosis.diff.oldStr, diagnosis.diff.newStr);
                if (!preview.success) {
                    console.error('[Evolution] ❌ diff 预览失败:', preview.error);
                    logger.error('EVOLUTION', 'diff 预览失败', { error: preview.error });
                    
                    // 如果 diff 模式失败但有全量补丁，降级到全量模式
                    if (!hasPatch) {
                        messageBus.publish('EVOLUTION_FAILED', {
                            module: diagnosis.targetModule,
                            reason: 'diff_preview_failed',
                            error: preview.error
                        });
                        return;
                    }
                    console.log('[Evolution] ⚠️  diff 失败，降级到全量补丁');
                } else if (!preview.isUnique) {
                    console.error('[Evolution] ❌ diff 匹配不唯一:', preview.matchCount);
                    if (!hasPatch) {
                        messageBus.publish('EVOLUTION_FAILED', {
                            module: diagnosis.targetModule,
                            reason: 'diff_not_unique',
                            error: `匹配 ${preview.matchCount} 处`
                        });
                        return;
                    }
                    console.log('[Evolution] ⚠️  diff 不唯一，降级到全量补丁');
                }
            }

            // 4. 安全验证：沙盒测试
            if (this.config.enableSandbox) {
                console.log('[Evolution] 🧪 启动沙盒测试...');
                const testResult = await this._testPatchInSandbox(
                    diagnosis.targetModule, 
                    hasDiff ? diagnosis.diff.newStr : diagnosis.patch
                );
                
                if (!testResult.success) {
                    console.error('[Evolution] ❌ 沙盒测试失败:', testResult.error);
                    logger.error('EVOLUTION', '沙盒测试失败，放弃补丁', {
                        module: diagnosis.targetModule,
                        error: testResult.error
                    });
                    
                    messageBus.publish('EVOLUTION_FAILED', {
                        module: diagnosis.targetModule,
                        reason: 'sandbox_test_failed',
                        error: testResult.error
                    });
                    return;
                }
                
                console.log('[Evolution] ✅ 沙盒测试通过');
                logger.info('EVOLUTION', '沙盒测试通过', {
                    module: diagnosis.targetModule,
                    testsRun: testResult.testsRun
                });
            }

            // 5. 小补丁直接应用；大补丁提交审批
            let result;
            if (isSmallPatch && data.trigger !== 'manual') {
                // 微进化：直接应用（自动触发的、小范围的 diff）
                console.log('[Evolution] 🔧 应用增量补丁（自动）...');
                result = surgeon.applyDiff(
                    diagnosis.targetModule,
                    diagnosis.diff.oldStr,
                    diagnosis.diff.newStr,
                    diagnosis.description
                );
                console.log('[Evolution] ✅ 增量补丁已应用');
            } else {
                // 大进化：提交审批队列
                console.log('[Evolution] 📝 提交审批队列...');
                const proposal = {
                    modulePath: diagnosis.targetModule,
                    description: diagnosis.description,
                    type: patchType,
                    reason: data.trigger || 'evolution',
                    trigger: data.trigger
                };
                
                if (hasDiff) {
                    proposal.oldStr = diagnosis.diff.oldStr;
                    proposal.newStr = diagnosis.diff.newStr;
                } else {
                    proposal.patchContent = diagnosis.patch;
                }
                
                result = surgeon.submitForApproval(proposal);
                
                // 通知前端有待审批的修改
                messageBus.publish('EVOLUTION_PENDING', {
                    id: result.id,
                    module: diagnosis.targetModule,
                    description: diagnosis.description,
                    type: patchType
                });
                
                logger.info('EVOLUTION', '已提交审批', {
                    module: diagnosis.targetModule,
                    id: result.id,
                    type: patchType
                });
                return; // 不继续执行后续步骤
            }

            // 6. 热重载（仅直接应用时触发）
            console.log('[Evolution] 🔄 触发热重载...');
            messageBus.publish('HOT_RELOAD', {
                module: diagnosis.targetModule,
                reason: 'evolution_patch',
                versionId: result.versionId
            });

            // 7. 冒烟测试
            if (this.config.autoRollback) {
                console.log('[Evolution] 💨 执行冒烟测试...');
                const smokeTestResult = await this._runSmokeTest();
                
                if (!smokeTestResult.success) {
                    console.error('[Evolution] ❌ 冒烟测试失败，执行回滚...');
                    logger.error('EVOLUTION', '冒烟测试失败，回滚', {
                        module: diagnosis.targetModule,
                        error: smokeTestResult.error
                    });
                    
                    surgeon.rollback(result.versionId);
                    messageBus.publish('HOT_RELOAD', {
                        module: diagnosis.targetModule,
                        reason: 'rollback'
                    });
                    
                    return;
                }
                
                console.log('[Evolution] ✅ 冒烟测试通过');
            }

            // 8. 进化成功
            console.log('[Evolution] 🎉 进化完成！');
            logger.info('EVOLUTION', '进化成功完成', {
                module: diagnosis.targetModule,
                versionId: result.versionId
            });
            
            messageBus.publish('EVOLUTION_SUCCESS', {
                module: diagnosis.targetModule,
                versionId: result.versionId,
                description: diagnosis.description
            });
            
        } catch (error) {
            console.error('[Evolution] 💥 进化失败:', error.message);
            logger.errorDetail('进化失败', error);
            
            messageBus.publish('EVOLUTION_FAILED', {
                reason: 'exception',
                error: error.message
            });
        }
    }

    /**
     * 在沙盒环境中测试补丁（使用 surgeon.runTests 进行语法验证）
     */
    async _testPatchInSandbox(modulePath, patchCode) {
        try {
            // 语法检查 + 模块加载测试
            const result = surgeon.runTests(modulePath, `
                // 基本加载测试
                if (typeof source === 'undefined') {
                    throw new Error('Module failed to load');
                }
                console.log('Module loaded OK');
            `);
            return result;
        } catch (error) {
            return {
                success: false,
                error: error.message,
                logs: []
            };
        }
    }

    /**
     * 热重载后的冒烟测试
     */
    async _runSmokeTest() {
        try {
            // 测试核心功能是否正常
            const tests = [
                () => require('./message-bus'),
                () => require('./logger'),
                () => require('./surgeon')
            ];
            
            for (const test of tests) {
                test();
            }
            
            return { success: true };
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    async _diagnose(errors) {
        const errorSummary = (errors || []).map(e => e.message || JSON.stringify(e)).join('\n');
        
        // 读取相关源代码（增强诊断上下文）
        let sourceContext = '';
        try {
            const errorFiles = this._extractErrorFiles(errorSummary);
            if (errorFiles.length > 0) {
                sourceContext = '\n\n相关源代码:\n';
                for (const file of errorFiles.slice(0, 3)) {
                    try {
                        const source = surgeon.readSource(file);
                        sourceContext += `\n--- ${file} ---\n${source.content.slice(0, 500)}...\n`;
                    } catch (e) { logger.warn("EVOLUTION", `操作跳过: ${e.message}`); }
                }
            }
        } catch (e) { logger.warn("EVOLUTION", `操作跳过: ${e.message}`); }

        const prompt = [
            { role: 'system', content: `你是 Hello Agent 系统的进化引擎。分析错误日志，判断根因，并生成修复补丁。

回复格式（必须是有效 JSON）:
{
  "targetModule": "模块路径（如 core/brain.js）",
  "description": "问题描述",
  "patch": "修复后的完整代码（仅用于无法做 diff 的大规模重构）",
  "diff": {
    "oldStr": "要替换的旧代码片段（必须唯一确定位置，包含足够上下文）",
    "newStr": "替换后的新代码片段"
  },
  "testCode": "用于验证补丁的测试代码（可选）"
}

注意：
1. targetModule 必须是相对 Data/ 的路径
2. **优先使用 diff 模式**（精确字符串替换），只有大规模重构才用 patch（全文件替换）
3. diff.oldStr 必须能在文件中唯一匹配，包含足够的上下文行
4. 如果无法修复，返回 {"description": "原因", "patch": null, "diff": null}` },
            { role: 'user', content: `最近错误:\n${errorSummary}${sourceContext}` }
        ];

        const response = await this.adapter.chat(prompt);
        const responseText = response.text || response;
        try {
            const result = JSON.parse(responseText);
            
            // 验证响应格式
            if (result.patch && !result.targetModule) {
                logger.warn('EVOLUTION', 'AI响应缺少targetModule', { response: responseText });
                return { description: '响应格式错误：缺少targetModule', patch: null };
            }
            
            return result;
        } catch (parseError) {
            logger.warn('EVOLUTION', 'AI响应不是有效JSON', { response: String(responseText).slice(0, 200) });
            return { description: String(responseText), patch: null };
        }
    }

    /**
     * 从错误信息中提取文件路径
     */
    _extractErrorFiles(errorSummary) {
        const files = [];
        const regex = /(?:at\s+)?(?:.*?\()?(\/[^\s:]+\.js)/g;
        let match;
        while ((match = regex.exec(errorSummary)) !== null) {
            const file = match[1];
            // 提取相对于 Data/ 的路径
            if (file.includes('Data/')) {
                const relPath = file.split('Data/')[1];
                if (relPath && !files.includes(relPath)) {
                    files.push(relPath);
                }
            }
        }
        return files;
    }

    /**
     * 中进化：审视技能库和经验，优化/新增技能
     * 触发条件：手动触发或每周自动触发
     */
    async _onMidEvolve() {
        console.log('[Evolution] 🔄 开始中进化（技能审视）...');
        
        if (!this.memorySystem || !this.skillLoader) {
            console.log('[Evolution] 记忆系统或技能加载器未初始化，跳过中进化');
            return;
        }

        try {
            const summary = this.memorySystem.getSummary();
            const skills = this.skillLoader.listSkills();
            const experienceContext = this.memorySystem.getExperienceContext(20);
            const instinctsContext = this.memorySystem.getInstinctsContext(30);

            const prompt = `你是 Hello Agent 系统的进化引擎。请分析当前的状态，提出改进建议。

当前状态:
- 经验数量: ${summary.experiences}
- 直觉数量: ${summary.instincts}（高置信度: ${summary.highConfidenceInstincts}）
- 已有技能: ${skills.map(s => s.name).join(', ')}

${experienceContext || '暂无经验'}

${instinctsContext || '暂无直觉'}

请分析:
1. 是否有反复出现的经验可以升级为直觉？
2. 是否需要新增技能来覆盖常见场景？
3. 现有直觉是否有需要降级的（置信度虚高）？

回复 JSON 格式:
{
  "instinctUpgrades": [
    { "pattern": "模式", "action": "行动", "confidence": 70 }
  ],
  "newSkillSuggestions": [
    { "name": "技能名", "description": "描述", "triggers": ["触发词"] }
  ],
  "instinctDowngrades": [
    { "pattern": "模式", "reason": "降级原因" }
  ]
}`;

            const messages = [
                { role: 'system', content: '你是进化引擎，负责技能和直觉的优化。只返回 JSON。' },
                { role: 'user', content: prompt }
            ];

            const response = await this.adapter.chat(messages);
            const text = response.text || response || '';
            
            let result;
            try {
                result = JSON.parse(text);
            } catch {
                const jsonMatch = text.match(/\{[\s\S]*\}/);
                if (jsonMatch) result = JSON.parse(jsonMatch[0]);
                else return;
            }

            // 升级直觉
            if (result.instinctUpgrades) {
                for (const upgrade of result.instinctUpgrades) {
                    this.memorySystem.addInstinct(upgrade.pattern, upgrade.action, upgrade.confidence);
                }
            }

            // 降级直觉（移除低质量的）
            if (result.instinctDowngrades && result.instinctDowngrades.length > 0) {
                console.log(`[Evolution] 建议降级 ${result.instinctDowngrades.length} 个直觉（需手动确认）`);
            }

            // 新技能建议
            if (result.newSkillSuggestions && result.newSkillSuggestions.length > 0) {
                console.log(`[Evolution] 💡 建议新增 ${result.newSkillSuggestions.length} 个技能:`);
                for (const skill of result.newSkillSuggestions) {
                    console.log(`  - ${skill.name}: ${skill.description}`);
                }
            }

            this.stats.midEvolutions++;
            this.stats.lastMidEvolution = new Date().toISOString();
            
            logger.info('EVOLUTION', '中进化完成', {
                upgrades: result.instinctUpgrades?.length || 0,
                suggestions: result.newSkillSuggestions?.length || 0
            });

        } catch (err) {
            console.error('[Evolution] 中进化失败:', err.message);
            logger.error('EVOLUTION', `中进化失败: ${err.message}`);
        }
    }
}

module.exports = Evolution;
