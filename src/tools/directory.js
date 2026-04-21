// tools/directory.js - 目录和文件搜索工具
// 主流 Agent 标配：列目录、搜索文件名、搜索文件内容
const registry = require('./index');
const fs = require('fs');
const path = require('path');
const os = require('os');

// 敏感路径黑名单（系统级目录禁止访问）
const BLOCKED_PATHS = [
    '/System',
    '/etc',
    '/private/etc',
    '/var',
    '/usr',
    '/sbin',
    '/bin'
];

// 敏感用户目录黑名单
const BLOCKED_USER_DIRS = [
    '.ssh',
    '.gnupg',
    '.keychain',
    '.config/gh'
];

/**
 * 检查路径是否在黑名单中
 * @returns {{ blocked: boolean, reason?: string }}
 */
function checkPathBlocked(targetPath) {
    const resolved = path.resolve(targetPath);
    const home = os.homedir();

    // 系统级黑名单
    for (const blocked of BLOCKED_PATHS) {
        if (resolved.startsWith(blocked + '/') || resolved === blocked) {
            return { blocked: true, reason: `系统敏感目录禁止访问: ${blocked}` };
        }
    }

    // 用户级敏感目录
    for (const dir of BLOCKED_USER_DIRS) {
        const fullBlocked = path.join(home, dir);
        if (resolved.startsWith(fullBlocked + '/') || resolved === fullBlocked) {
            return { blocked: true, reason: `用户敏感目录禁止访问: ~/${dir}` };
        }
    }

    return { blocked: false };
}

/**
 * 列出目录内容
 */
registry.register(
    'list_directory',
    {
        description: '列出指定目录下的文件和子目录。返回文件名、类型、大小等信息。用于探索项目结构、查找文件位置。',
        parameters: {
            type: 'object',
            properties: {
                dirPath: {
                    type: 'string',
                    description: '要列出的目录路径（绝对路径或相对于工作区）'
                },
                recursive: {
                    type: 'boolean',
                    description: '是否递归列出子目录（默认 false）'
                },
                maxDepth: {
                    type: 'number',
                    description: '递归深度（默认 3，配合 recursive 使用）'
                },
                pattern: {
                    type: 'string',
                    description: '文件名匹配模式（glob 风格，如 *.js, *.md），可选'
                }
            },
            required: ['dirPath']
        }
    },
    async (params, context) => {
        const workFolder = context.workFolder || '';
        let targetDir = params.dirPath;

        // 相对路径转绝对路径
        if (!path.isAbsolute(targetDir)) {
            targetDir = path.join(workFolder, targetDir);
        }

        // 权限检查：敏感路径黑名单
        const pathCheck = checkPathBlocked(targetDir);
        if (pathCheck.blocked) {
            return `⛔ ${pathCheck.reason}`;
        }

        if (!fs.existsSync(targetDir)) {
            return `目录不存在: ${targetDir}`;
        }

        const stat = fs.statSync(targetDir);
        if (!stat.isDirectory()) {
            return `路径不是目录: ${targetDir}`;
        }

        const recursive = params.recursive || false;
        const maxDepth = params.maxDepth || 3;
        const pattern = params.pattern || null;

        const results = [];
        let totalFiles = 0;
        let totalDirs = 0;

        function listDir(dir, depth, prefix) {
            if (depth > maxDepth) return;

            let entries;
            try {
                entries = fs.readdirSync(dir, { withFileTypes: true });
            } catch (err) {
                results.push(`${prefix}  [无法访问: ${err.message}]`);
                return;
            }

            // 过滤 node_modules, .git, __pycache__ 等
            const ignoreDirs = new Set(['node_modules', '.git', '__pycache__', '.DS_Store', '.next', '.nuxt', 'dist', 'build', '.cache']);

            for (const entry of entries) {
                const name = entry.name;
                if (ignoreDirs.has(name)) continue;

                // 如果有 pattern 过滤
                if (pattern && entry.isFile()) {
                    if (!matchGlob(name, pattern)) continue;
                }

                const fullPath = path.join(dir, name);
                const indent = prefix;

                if (entry.isDirectory()) {
                    totalDirs++;
                    results.push(`${indent}▸ ${name}/`);
                    if (recursive) {
                        listDir(fullPath, depth + 1, prefix + '  ');
                    }
                } else {
                    totalFiles++;
                    const size = getFileSize(fullPath);
                    results.push(`${indent}  ${name}  (${size})`);
                }
            }
        }

        listDir(targetDir, 0, '');

        const header = `目录: ${targetDir}\n${totalDirs} 个目录, ${totalFiles} 个文件\n${'─'.repeat(40)}`;
        return header + '\n' + results.join('\n');
    },
    { icon: '📂', label: '列目录' }
);

/**
 * 搜索文件内容（grep 风格）
 */
registry.register(
    'search_content',
    {
        description: '在文件中搜索匹配的文本内容（类似 grep）。支持正则表达式。返回匹配行及其上下文。用于在代码库中查找函数定义、变量引用、配置项等。',
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: '搜索关键词或正则表达式'
                },
                directory: {
                    type: 'string',
                    description: '搜索的根目录（绝对路径或相对于工作区）'
                },
                filePattern: {
                    type: 'string',
                    description: '文件名过滤（如 *.js, *.py），默认搜索所有文件'
                },
                caseSensitive: {
                    type: 'boolean',
                    description: '是否区分大小写（默认 false）'
                },
                maxResults: {
                    type: 'number',
                    description: '最大返回结果数（默认 30）'
                }
            },
            required: ['query', 'directory']
        }
    },
    async (params, context) => {
        const workFolder = context.workFolder || '';
        let targetDir = params.directory;

        if (!path.isAbsolute(targetDir)) {
            targetDir = path.join(workFolder, targetDir);
        }

        // 权限检查：敏感路径黑名单
        const pathCheck = checkPathBlocked(targetDir);
        if (pathCheck.blocked) {
            return `⛔ ${pathCheck.reason}`;
        }

        if (!fs.existsSync(targetDir)) {
            return `目录不存在: ${targetDir}`;
        }

        const query = params.query;
        const filePattern = params.filePattern || null;
        const caseSensitive = params.caseSensitive || false;
        const maxResults = params.maxResults || 30;

        const ignoreDirs = new Set(['node_modules', '.git', '__pycache__', '.DS_Store', '.next', 'dist', 'build', '.cache', 'vendor']);
        const ignoreExts = new Set(['.min.js', '.min.css', '.map', '.lock', '.woff', '.woff2', '.ttf', '.eot', '.ico', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.mp4', '.mp3', '.zip', '.tar', '.gz']);

        const matches = [];

        function searchFile(filePath, relPath) {
            // 检查文件扩展名
            const ext = path.extname(filePath).toLowerCase();
            const base = path.basename(filePath).toLowerCase();
            for (const ie of ignoreExts) {
                if (base.endsWith(ie)) return;
            }

            // 检查文件名模式
            if (filePattern && !matchGlob(path.basename(filePath), filePattern)) return;

            // 限制文件大小（跳过 >1MB 的文件）
            try {
                const stat = fs.statSync(filePath);
                if (stat.size > 1024 * 1024) return;
            } catch { return; }

            let content;
            try {
                content = fs.readFileSync(filePath, 'utf-8');
            } catch { return; }

            const lines = content.split('\n');
            const flags = caseSensitive ? 'g' : 'gi';

            let regex;
            try {
                regex = new RegExp(query, flags);
            } catch {
                // 正则语法错误，退化为纯文本搜索
                regex = new RegExp(escapeRegex(query), flags);
            }

            for (let i = 0; i < lines.length; i++) {
                if (matches.length >= maxResults) break;
                if (regex.test(lines[i])) {
                    const contextLines = [];
                    // 上一行
                    if (i > 0) contextLines.push(`  ${i}: ${lines[i - 1].trim()}`);
                    // 匹配行
                    contextLines.push(`→ ${i + 1}: ${lines[i].trim()}`);
                    // 下一行
                    if (i < lines.length - 1) contextLines.push(`  ${i + 2}: ${lines[i + 1].trim()}`);

                    matches.push({
                        file: relPath,
                        line: i + 1,
                        context: contextLines.join('\n')
                    });
                    regex.lastIndex = 0; // 重置全局搜索位置
                }
            }
        }

        function walkDir(dir, relBase) {
            if (matches.length >= maxResults) return;

            let entries;
            try {
                entries = fs.readdirSync(dir, { withFileTypes: true });
            } catch { return; }

            for (const entry of entries) {
                if (matches.length >= maxResults) break;
                if (ignoreDirs.has(entry.name)) continue;

                const fullPath = path.join(dir, entry.name);
                const relPath = path.join(relBase, entry.name);

                if (entry.isDirectory()) {
                    walkDir(fullPath, relPath);
                } else {
                    searchFile(fullPath, relPath);
                }
            }
        }

        walkDir(targetDir, '');

        if (matches.length === 0) {
            return `未找到匹配 "${query}" 的内容（搜索目录: ${targetDir}）`;
        }

        const output = matches.map(m => `${m.file}:${m.line}\n${m.context}`).join('\n\n');
        return `搜索 "${query}" 在 ${targetDir} 中找到 ${matches.length} 处匹配:\n\n${output}`;
    },
    { icon: '🔍', label: '搜索内容' }
);

/**
 * 搜索文件名（find 风格）
 */
registry.register(
    'search_files',
    {
        description: '按文件名模式搜索文件（类似 find）。支持通配符。用于查找特定文件的位置，如配置文件、组件文件等。',
        parameters: {
            type: 'object',
            properties: {
                pattern: {
                    type: 'string',
                    description: '文件名匹配模式（支持通配符，如 *.js, config*, test_*.py）'
                },
                directory: {
                    type: 'string',
                    description: '搜索的根目录（绝对路径或相对于工作区）'
                },
                maxResults: {
                    type: 'number',
                    description: '最大返回结果数（默认 50）'
                }
            },
            required: ['pattern', 'directory']
        }
    },
    async (params, context) => {
        const workFolder = context.workFolder || '';
        let targetDir = params.directory;

        if (!path.isAbsolute(targetDir)) {
            targetDir = path.join(workFolder, targetDir);
        }

        // 权限检查：敏感路径黑名单
        const pathCheck = checkPathBlocked(targetDir);
        if (pathCheck.blocked) {
            return `⛔ ${pathCheck.reason}`;
        }

        if (!fs.existsSync(targetDir)) {
            return `目录不存在: ${targetDir}`;
        }

        const pattern = params.pattern;
        const maxResults = params.maxResults || 50;
        const ignoreDirs = new Set(['node_modules', '.git', '__pycache__', '.DS_Store', '.next', 'dist', 'build', '.cache', 'vendor']);

        const matches = [];

        function walkDir(dir) {
            if (matches.length >= maxResults) return;

            let entries;
            try {
                entries = fs.readdirSync(dir, { withFileTypes: true });
            } catch { return; }

            for (const entry of entries) {
                if (matches.length >= maxResults) break;
                if (ignoreDirs.has(entry.name)) continue;

                const fullPath = path.join(dir, entry.name);

                if (entry.isDirectory()) {
                    if (matchGlob(entry.name, pattern)) {
                        const relPath = path.relative(targetDir, fullPath);
                        matches.push(`${relPath}/  (目录)`);
                    }
                    walkDir(fullPath);
                } else {
                    if (matchGlob(entry.name, pattern)) {
                        const relPath = path.relative(targetDir, fullPath);
                        let size;
                        try { size = fs.statSync(fullPath).size; } catch { size = 0; }
                        matches.push(`${relPath}  (${formatSize(size)})`);
                    }
                }
            }
        }

        walkDir(targetDir);

        if (matches.length === 0) {
            return `未找到匹配 "${pattern}" 的文件（搜索目录: ${targetDir}）`;
        }

        return `在 ${targetDir} 中找到 ${matches.length} 个匹配 "${pattern}" 的文件:\n\n${matches.join('\n')}`;
    },
    { icon: '🔎', label: '搜索文件' }
);


// ── 辅助函数 ──

/**
 * 简单 glob 匹配（支持 * 和 ?）
 */
function matchGlob(str, pattern) {
    if (!pattern) return true;
    // 将 glob 转为正则
    const regexStr = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')  // 转义特殊字符
        .replace(/\*/g, '.*')                    // * → .*
        .replace(/\?/g, '.');                     // ? → .
    try {
        const regex = new RegExp('^' + regexStr + '$', 'i');
        return regex.test(str);
    } catch {
        return str.toLowerCase().includes(pattern.toLowerCase());
    }
}

function getFileSize(filePath) {
    try {
        const stat = fs.statSync(filePath);
        return formatSize(stat.size);
    } catch {
        return '?';
    }
}

function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
