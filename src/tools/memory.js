// tools/memory.js — 记忆管理工具
const toolRegistry = require('./index');
const fs = require('fs');
const path = require('path');

/**
 * 保存中期记忆（项目总结）
 */
toolRegistry.register(
    'memory_save_mid',
    {
        description: '保存项目级中期记忆（对话结束时的总结）',
        parameters: {
            type: 'object',
            properties: {
                summary: {
                    type: 'string',
                    description: '本次对话的总结（项目进展、技术决策、已知问题等）'
                }
            },
            required: ['summary']
        }
    },
    async (input, context) => {
        const { workFolder } = context;
        if (!workFolder) {
            return '❌ 未指定工作目录，无法保存中期记忆';
        }

        const memDir = path.join(workFolder, 'memorys');
        const midMemoryFile = path.join(memDir, 'mid-memory.md');
        
        try {
            // 读取现有记忆
            let existing = '';
            if (fs.existsSync(midMemoryFile)) {
                existing = fs.readFileSync(midMemoryFile, 'utf-8');
            }
            
            // 追加新的总结（带时间戳）
            const timestamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
            const newContent = existing 
                ? `${existing}\n\n---\n\n## ${timestamp}\n\n${input.summary}`
                : `# 项目记忆\n\n## ${timestamp}\n\n${input.summary}`;
            
            // 确保目录存在
            if (!fs.existsSync(memDir)) {
                fs.mkdirSync(memDir, { recursive: true });
            }
            
            fs.writeFileSync(midMemoryFile, newContent, 'utf-8');
            
            return `✅ 中期记忆已保存到 ${midMemoryFile}`;
        } catch (err) {
            return `❌ 保存失败: ${err.message}`;
        }
    },
    { icon: '💾', label: '保存项目记忆' }
);

/**
 * 保存短期记忆（最近10轮对话）
 */
toolRegistry.register(
    'memory_save_short',
    {
        description: '保存短期记忆（最近10轮对话的上下文）',
        parameters: {
            type: 'object',
            properties: {
                context: {
                    type: 'string',
                    description: '最近10轮对话的关键信息'
                }
            },
            required: ['context']
        }
    },
    async (input, context) => {
        const { workFolder } = context;
        if (!workFolder) {
            return '❌ 未指定工作目录，无法保存短期记忆';
        }

        const memDir = path.join(workFolder, 'memorys');
        const shortMemoryFile = path.join(memDir, 'short-memory.md');
        
        try {
            // 确保目录存在
            if (!fs.existsSync(memDir)) {
                fs.mkdirSync(memDir, { recursive: true });
            }
            
            fs.writeFileSync(shortMemoryFile, input.context, 'utf-8');
            
            return `✅ 短期记忆已保存到 ${shortMemoryFile}`;
        } catch (err) {
            return `❌ 保存失败: ${err.message}`;
        }
    },
    { icon: '📝', label: '保存短期记忆' }
);

module.exports = {};
