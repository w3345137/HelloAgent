// core/reflection.js — 自动反思引擎
// 每次对话结束后自动提炼经验，驱动微进化
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

class ReflectionEngine {
    constructor(adapter, memorySystem, skillLoader) {
        this.adapter = adapter;
        this.memorySystem = memorySystem;
        this.skillLoader = skillLoader;
        this._isReflecting = false;
        this._pendingReflection = null;
        this._debounceMs = 5000;
    }

    async reflect(userText, assistantText, toolCalls = [], sessionKey = null) {
        if (this._isReflecting) {
            console.log('[Reflection] 上一次反思仍在进行，跳过');
            return;
        }

        if (this._pendingReflection) {
            clearTimeout(this._pendingReflection);
        }

        return new Promise((resolve) => {
            this._pendingReflection = setTimeout(async () => {
                this._pendingReflection = null;
                await this._doReflect(userText, assistantText, toolCalls, sessionKey);
                resolve();
            }, this._debounceMs);
        });
    }

    async _doReflect(userText, assistantText, toolCalls = [], sessionKey = null) {
        this._isReflecting = true;
        try {
            console.log('[Reflection] 🧠 开始反思...');

            // 构建反思 prompt
            const toolSummary = toolCalls.length > 0
                ? toolCalls.map(t => `- ${t.tool}(${JSON.stringify(t.params).slice(0, 100)}): ${t.status}`).join('\n')
                : '无工具调用';

            const prompt = `分析以下对话，提取可学习的经验。回复必须是 JSON 格式。

用户消息: ${userText.slice(0, 500)}
助手回复: ${(assistantText || '').slice(0, 500)}
工具调用: ${toolSummary}

请分析并返回:
{
  "learnings": [
    {
      "scenario": "场景描述（什么情况下这个经验适用）",
      "insight": "学到了什么",
      "confidence": 50
    }
  ],
  "instincts": [
    {
      "pattern": "触发模式（当遇到什么情况时）",
      "action": "应该怎么做",
      "confidence": 40
    }
  ],
  "userPreferences": [
    {
      "key": "偏好类型（如沟通风格、技术偏好等）",
      "value": "具体偏好内容"
    }
  ]
}

规则：
- learnings 和 instincts 可以为空数组
- confidence 范围 0-100，新经验从 30-50 开始
- 只提取真正有价值的经验，不要记录显而易见的东西
- 用户偏好只记录从对话中能明确推断的`;

            const messages = [
                { role: 'system', content: '你是一个经验提取引擎。分析对话，提取可复用的模式和经验。只返回 JSON。' },
                { role: 'user', content: prompt }
            ];

            const response = await this.adapter.chat(messages);
            const text = response.text || response || '';

            // 解析 JSON
            let result;
            try {
                // 尝试直接解析
                result = JSON.parse(text);
            } catch {
                // 尝试提取 JSON 块
                const jsonMatch = text.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    result = JSON.parse(jsonMatch[0]);
                } else {
                    console.log('[Reflection] AI 返回非 JSON，跳过反思');
                    return;
                }
            }

            // 存储经验
            if (result.learnings && result.learnings.length > 0) {
                for (const learning of result.learnings) {
                    if (typeof this.memorySystem.addExperience === 'function') {
                        this.memorySystem.addExperience(
                            learning.scenario,
                            learning.insight,
                            learning.confidence >= 70 ? '高' : learning.confidence >= 40 ? '中' : '低'
                        );
                    }
                }
                console.log(`[Reflection] 提取了 ${result.learnings.length} 条经验`);
            }

            if (result.instincts && result.instincts.length > 0) {
                for (const instinct of result.instincts) {
                    if (typeof this.memorySystem.addInstinct === 'function') {
                        this.memorySystem.addInstinct(
                            instinct.pattern,
                            instinct.action,
                            instinct.confidence || 40
                        );
                    }
                }
                console.log(`[Reflection] 提取了 ${result.instincts.length} 条直觉`);
            }

            // 更新用户偏好
            if (result.userPreferences && result.userPreferences.length > 0) {
                for (const pref of result.userPreferences) {
                    if (typeof this.memorySystem.updateUserProfile === 'function') {
                        this.memorySystem.updateUserProfile(pref.key, pref.value);
                    } else {
                        console.log('[Reflection] memorySystem.updateUserProfile 不可用，跳过用户偏好更新');
                    }
                }
                console.log(`[Reflection] 更新了 ${result.userPreferences.length} 个用户偏好`);
            }

            logger.info('REFLECTION', `反思完成: ${result.learnings?.length || 0} 经验, ${result.instincts?.length || 0} 直觉`);

        } catch (err) {
            if (err.message && (err.message.includes('502') || err.message.includes('503') || err.message.includes('529') || err.message.includes('429'))) {
                console.log('[Reflection] API 限流，跳过本次反思');
            } else {
                console.error('[Reflection] 反思失败:', err.message);
                logger.error('REFLECTION', `反思失败: ${err.message}`);
            }
        } finally {
            this._isReflecting = false;
        }
    }
}

module.exports = ReflectionEngine;
