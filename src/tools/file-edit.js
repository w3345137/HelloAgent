// tools/file-edit.js — 文件精确编辑工具（ECC P0 启发：edit 是最常用操作）
const registry = require('./index');
const fs = require('fs');
const path = require('path');
const permissionManager = require('../core/permission-manager');
const logger = require('../core/logger');

/**
 * file_edit：精确字符串替换编辑
 * 比 file_write 更常用：不需要重写整个文件，只替换指定部分
 * 参考 Claude Code 的 Edit 工具设计
 */
registry.register(
    'file_edit',
    {
        description: '精确编辑文件内容（字符串替换）。**编辑文件必须用此工具，不要用 file_write 覆盖整个文件**。操作流程：先 file_read 读取文件 → 确认要修改的内容 → 用 file_edit 精确替换。支持替换和删除。',
        parameters: {
            type: 'object',
            properties: {
                filePath: {
                    type: 'string',
                    description: '要编辑的文件路径'
                },
                oldText: {
                    type: 'string',
                    description: '要被替换的原始文本（必须精确匹配，包括空格和换行）'
                },
                newText: {
                    type: 'string',
                    description: '替换后的新文本（传空字符串表示删除）'
                }
            },
            required: ['filePath', 'oldText', 'newText']
        }
    },
    async (params, context) => {
        const { filePath, oldText, newText } = params;

        // 权限检查
        const perm = permissionManager.checkFileAccess(filePath, 'write');
        if (!perm.allowed) {
            return `权限拒绝: ${perm.reason}`;
        }

        const resolved = permissionManager._resolvePath(filePath);

        // 检查文件是否存在
        if (!fs.existsSync(resolved)) {
            return `文件不存在: ${filePath}。如需创建新文件，请使用 file_write。`;
        }

        try {
            const content = fs.readFileSync(resolved, 'utf-8');

            // 检查 oldText 是否存在
            if (!content.includes(oldText)) {
                // 尝试提供帮助性的错误信息
                const lines = content.split('\n');
                const oldLines = oldText.split('\n');
                
                // 搜索相似的文本
                let bestMatch = '';
                let bestLine = -1;
                for (let i = 0; i < lines.length; i++) {
                    if (lines[i].trim() === oldLines[0].trim()) {
                        bestMatch = lines.slice(i, i + oldLines.length).join('\n');
                        bestLine = i + 1;
                        break;
                    }
                }
                
                let hint = '';
                if (bestLine > 0) {
                    hint = `\n\n💡 找到相似内容在第 ${bestLine} 行（可能有空格/缩进差异）：\n${bestMatch.slice(0, 200)}`;
                }
                
                return `❌ 未找到要替换的文本。请先用 file_read 读取文件确认精确内容。${hint}\n\n查找的文本前100字符:\n${oldText.slice(0, 100)}`;
            }

            // 检查是否有多处匹配（可能导致误操作）
            const matchCount = content.split(oldText).length - 1;
            if (matchCount > 1) {
                return `⚠️ 找到 ${matchCount} 处匹配，替换可能导致误操作。请提供更多上下文使匹配唯一。`;
            }

            // 执行替换
            const newContent = content.replace(oldText, newText);
            fs.writeFileSync(resolved, newContent, 'utf-8');

            const changeDesc = newText.length === 0 
                ? `删除了 ${oldText.length} 字符`
                : `替换了 ${oldText.length} 字符 → ${newText.length} 字符`;

            logger.info('FILE_EDIT', `${filePath}: ${changeDesc}`);

            const oldLines = oldText.split('\n');
            const newLines = newText.split('\n');
            let diffLines = [];
            diffLines.push(`--- ${filePath} (修改前)`);
            diffLines.push(`+++ ${filePath} (修改后)`);
            for (const line of oldLines) diffLines.push(`- ${line}`);
            for (const line of newLines) diffLines.push(`+ ${line}`);

            return `✅ 编辑成功: ${filePath}\n${changeDesc}\n\n\`\`\`diff\n${diffLines.join('\n')}\n\`\`\``;
        } catch (error) {
            logger.error('FILE_EDIT', `编辑失败: ${error.message}`);
            return `❌ 编辑失败: ${error.message}`;
        }
    },
    {
        icon: '✏️',
        label: '编辑文件'
    }
);
