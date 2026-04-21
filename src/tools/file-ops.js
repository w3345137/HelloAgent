// tools/file-ops.js - 文件操作工具
const registry = require('./index');
const fs = require('fs');
const path = require('path');
const permissionManager = require('../core/permission-manager');

/**
 * 根据文件扩展名检测文件类型
 */
function detectFileType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const typeMap = {
        // PDF
        '.pdf': 'pdf',
        // Word
        '.docx': 'docx',
        '.doc': 'doc',
        // Excel
        '.xlsx': 'xlsx',
        '.xls': 'xls',
        // PowerPoint
        '.pptx': 'pptx',
        '.ppt': 'ppt',
        // 图片
        '.jpg': 'image',
        '.jpeg': 'image',
        '.png': 'image',
        '.gif': 'image',
        '.webp': 'image',
        '.bmp': 'image',
        // 文本
        '.txt': 'text',
        '.md': 'text',
        '.json': 'text',
        '.js': 'text',
        '.ts': 'text',
        '.jsx': 'text',
        '.tsx': 'text',
        '.html': 'text',
        '.css': 'text',
        '.py': 'text',
        '.java': 'text',
        '.c': 'text',
        '.cpp': 'text',
        '.go': 'text',
        '.rs': 'text',
        '.sh': 'text',
        '.yml': 'text',
        '.yaml': 'text',
        '.xml': 'text',
        '.csv': 'text'
    };
    return typeMap[ext] || 'binary';
}

/**
 * 提取PDF文本内容（使用pdftotext命令）
 */
async function extractPDFText(filePath) {
    const { exec } = require('child_process');
    const util = require('util');
    const execPromise = util.promisify(exec);
    
    try {
        // 尝试使用pdftotext命令（需要安装poppler）
        const { stdout } = await execPromise(`pdftotext -layout "${filePath}" -`, {
            maxBuffer: 1024 * 1024 * 10 // 10MB buffer
        });
        
        if (stdout && stdout.trim()) {
            return {
                success: true,
                text: stdout.trim(),
                method: 'pdftotext'
            };
        }
        
        return {
            success: false,
            error: 'pdftotext返回空内容'
        };
    } catch (error) {
        // pdftotext不可用或执行失败
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * 文件读取工具
 */
registry.register(
    'file_read',
    {
        description: '读取本地文件内容（需要权限）。支持格式：PDF（自动提取文本）、图片（返回base64）、文本文件和代码文件。不支持 Word(.docx)、Excel(.xlsx)、PowerPoint(.pptx) 的内容读取，这些格式请使用对应的专用工具（如 pptx_parse）。**读取文件必须用此工具，禁止用 shell 命令或 Python 脚本**。',
        parameters: {
            type: 'object',
            properties: {
                filePath: {
                    type: 'string',
                    description: '文件的绝对路径或相对路径。支持 PDF、Word、Excel、PPT、图片、文本等格式。'
                }
            },
            required: ['filePath']
        }
    },
    async (params, context) => {
        const { filePath } = params;
        
        // 权限检查
        const perm = permissionManager.checkFileAccess(filePath, 'read');
        if (!perm.allowed) {
            return `权限拒绝: ${perm.reason}`;
        }

        const resolved = permissionManager._resolvePath(filePath);
        
        // 检查文件是否存在
        if (!fs.existsSync(resolved)) {
            return `文件不存在: ${filePath}`;
        }
        
        // 检测文件类型
        const fileType = detectFileType(resolved);
        
        try {
            // PDF文件特殊处理
            if (fileType === 'pdf') {
                console.log(`[file_read] 检测到PDF文件: ${resolved}`);
                
                const result = await extractPDFText(resolved);
                
                if (result.success) {
                    const text = result.text.slice(0, 50000);
                    return `📄 PDF文件内容 (${result.method}):\n\n${text}${result.text.length > 50000 ? '\n\n... [内容已截断]' : ''}`;
                } else {
                    // pdftotext不可用，提供安装指导
                    return `❌ PDF读取失败: ${result.error}\n\n💡 解决方法:\n在macOS上安装poppler工具:\n\`\`\`bash\nbrew install poppler\n\`\`\`\n\n安装后即可读取PDF文件。`;
                }
            }
            
            // 图片文件（未来可以集成OCR或图像识别）
            if (fileType === 'image') {
                return `🖼️ 检测到图片文件: ${path.basename(resolved)}\n\n注意：当前版本暂不支持图片内容识别。未来版本可集成OCR或图像识别API。`;
            }
            
            // Word/Excel/PPT文件（需要专门的库）
            if (['docx', 'xlsx', 'pptx'].includes(fileType)) {
                return `📊 检测到${fileType.toUpperCase()}文件: ${path.basename(resolved)}\n\n注意：当前版本暂不支持${fileType.toUpperCase()}文件读取。需要安装相应的解析库（如mammoth、xlsx、pptx-parser等）。`;
            }
            
            // 文本文件直接读取
            if (fileType === 'text') {
                const content = fs.readFileSync(resolved, 'utf-8');
                const truncated = content.slice(0, 50000);
                return `📄 文件内容:\n\n${truncated}${content.length > 50000 ? '\n\n... [内容已截断]' : ''}`;
            }
            
            // 其他二进制文件
            return `❌ 不支持的文件类型: ${path.extname(resolved)}\n\n支持的格式：PDF、文本文件、代码文件等。`;
            
        } catch (error) {
            return `读取文件失败: ${error.message}`;
        }
    },
    {
        icon: '📖',
        label: '读取文件'
    }
);

/**
 * 文件写入工具
 */
registry.register(
    'file_write',
    {
        description: '写入文件内容（需要权限）。**写入文件必须用此工具，禁止用 shell 命令或 Python 脚本**。',
        parameters: {
            type: 'object',
            properties: {
                filePath: {
                    type: 'string',
                    description: '文件路径'
                },
                content: {
                    type: 'string',
                    description: '文件内容'
                }
            },
            required: ['filePath', 'content']
        }
    },
    async (params, context) => {
        const { filePath, content } = params;
        
        // 权限检查
        const perm = permissionManager.checkFileAccess(filePath, 'write');
        if (!perm.allowed) {
            return `权限拒绝: ${perm.reason}`;
        }

        const resolved = permissionManager._resolvePath(filePath);
        
        try {
            // 确保目录存在
            fs.mkdirSync(path.dirname(resolved), { recursive: true });
            fs.writeFileSync(resolved, content, 'utf-8');
            return `文件已写入: ${filePath}`;
        } catch (error) {
            return `写入文件失败: ${error.message}`;
        }
    },
    {
        icon: '💾',
        label: '写入文件'
    }
);
