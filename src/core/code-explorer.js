// core/code-explorer.js — 代码库探索引擎
// 提供类似 Hello Agent code-explorer 子代理的能力：
// 结构扫描 → 关键词聚焦 → 最小必要读取 → 结构化结论包
const fs = require('fs');
const path = require('path');

class CodeExplorer {
    constructor(dataDir) {
        this.dataDir = dataDir;
        this.maxReadSize = 100 * 1024; // 单文件最大读取 100KB
        this.maxResults = 50;          // 搜索结果上限
    }

    /**
     * 探索一个代码库
     * @param {string} rootDir - 要探索的根目录
     * @param {object} options - { query, filePattern, maxDepth }
     * @returns {object} 探索结果
     */
    async explore(rootDir, options = {}) {
        const { query, filePattern, maxDepth = 4 } = options;

        // 阶段1: 结构概览
        const overview = this._scanStructure(rootDir, maxDepth);

        // 如果没有查询关键词，只返回结构
        if (!query) {
            return {
                success: true,
                rootDir,
                overview,
                message: '结构扫描完成。提供 query 参数可进行深度搜索。'
            };
        }

        // 阶段2: 关键词/模式搜索
        const searchResults = this._searchContent(rootDir, query, filePattern);

        // 阶段3: 定位关键文件
        const keyFiles = this._extractKeyFiles(searchResults);

        // 阶段4: 提取调用链线索
        const callChain = this._traceCallChain(rootDir, query, keyFiles);

        return {
            success: true,
            rootDir,
            query,
            overview,
            searchResults: searchResults.slice(0, this.maxResults),
            keyFiles,
            callChain,
            totalMatches: searchResults.length,
            message: `找到 ${searchResults.length} 处匹配，定位 ${keyFiles.length} 个关键文件。`
        };
    }

    /**
     * 阶段1: 扫描目录结构
     */
    _scanStructure(rootDir, maxDepth) {
        const result = {
            totalFiles: 0,
            totalDirs: 0,
            extensions: {},
            topDirs: [],
            entryPoints: []
        };

        if (!fs.existsSync(rootDir)) {
            result.error = `目录不存在: ${rootDir}`;
            return result;
        }

        const ignored = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', '.DS_Store', 'target', '.cache']);

        const scan = (dir, depth) => {
            if (depth > maxDepth) return;
            try {
                const entries = fs.readdirSync(dir, { withFileTypes: true });
                for (const entry of entries) {
                    if (ignored.has(entry.name) || entry.name.startsWith('.')) continue;
                    const fullPath = path.join(dir, entry.name);
                    if (entry.isDirectory()) {
                        result.totalDirs++;
                        if (depth === 1) {
                            result.topDirs.push({
                                name: entry.name,
                                path: this._relativePath(fullPath, rootDir)
                            });
                        }
                        scan(fullPath, depth + 1);
                    } else {
                        result.totalFiles++;
                        const ext = path.extname(entry.name).toLowerCase();
                        result.extensions[ext] = (result.extensions[ext] || 0) + 1;

                        // 识别入口文件
                        const nameLC = entry.name.toLowerCase();
                        if (nameLC === 'index.js' || nameLC === 'index.ts' || nameLC === 'main.js' ||
                            nameLC === 'main.ts' || nameLC === 'app.js' || nameLC === 'app.ts' ||
                            nameLC === 'package.json') {
                            result.entryPoints.push(this._relativePath(fullPath, rootDir));
                        }
                    }
                }
            } catch (e) {
                // 权限不足等，跳过
            }
        };

        scan(rootDir, 0);

        // 按文件数排序扩展名
        result.extensions = Object.entries(result.extensions)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 15)
            .reduce((obj, [k, v]) => { obj[k] = v; return obj; }, {});

        return result;
    }

    /**
     * 阶段2: 搜索文件内容
     */
    _searchContent(rootDir, query, filePattern) {
        const results = [];
        const ignored = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', 'target', '.cache']);
        const isRegex = /[.*+?^${}()|[\]\\]/.test(query);
        let regex;
        try {
            regex = isRegex ? new RegExp(query, 'gi') : new RegExp(this._escapeRegex(query), 'gi');
        } catch {
            regex = new RegExp(this._escapeRegex(query), 'gi');
        }

        const extFilter = filePattern ? this._parseFilePattern(filePattern) : null;

        const search = (dir) => {
            try {
                const entries = fs.readdirSync(dir, { withFileTypes: true });
                for (const entry of entries) {
                    if (ignored.has(entry.name) || entry.name.startsWith('.')) continue;
                    const fullPath = path.join(dir, entry.name);
                    if (entry.isDirectory()) {
                        search(fullPath);
                    } else {
                        const ext = path.extname(entry.name).toLowerCase();
                        if (extFilter && !extFilter.has(ext)) continue;
                        // 跳过二进制文件
                        if (this._isBinary(ext)) continue;

                        try {
                            const stat = fs.statSync(fullPath);
                            if (stat.size > this.maxReadSize) continue;

                            const content = fs.readFileSync(fullPath, 'utf-8');
                            const lines = content.split('\n');
                            const matches = [];

                            for (let i = 0; i < lines.length; i++) {
                                regex.lastIndex = 0;
                                if (regex.test(lines[i])) {
                                    matches.push({
                                        line: i + 1,
                                        text: lines[i].trim().substring(0, 200)
                                    });
                                    if (matches.length >= 10) break; // 每文件最多 10 个匹配
                                }
                            }

                            if (matches.length > 0) {
                                results.push({
                                    file: this._relativePath(fullPath, rootDir),
                                    fullPath,
                                    matches,
                                    matchCount: matches.length
                                });
                            }
                        } catch (e) {
                            // 读取失败，跳过
                        }
                    }
                    if (results.length >= this.maxResults) return;
                }
            } catch (e) {
                // 权限不足，跳过
            }
        };

        search(rootDir);
        // 按匹配数降序
        results.sort((a, b) => b.matchCount - a.matchCount);
        return results;
    }

    /**
     * 阶段3: 从搜索结果中提取关键文件
     */
    _extractKeyFiles(searchResults) {
        return searchResults.slice(0, 10).map(r => ({
            file: r.file,
            relevance: r.matchCount,
            topMatches: r.matches.slice(0, 3)
        }));
    }

    /**
     * 阶段4: 追踪调用链线索
     */
    _traceCallChain(rootDir, query, keyFiles) {
        const chain = [];
        // 简单实现：找 require/import 语句中的模块引用
        const importRegex = /(?:require\(|import\s.*from\s+|import\s+)['"]([^'"]+)['"]/g;

        for (const kf of keyFiles.slice(0, 5)) {
            const fullPath = path.resolve(rootDir, kf.file);
            try {
                const content = fs.readFileSync(fullPath, 'utf-8');
                const lines = content.split('\n');
                const imports = [];
                let match;
                for (const line of lines) {
                    importRegex.lastIndex = 0;
                    while ((match = importRegex.exec(line)) !== null) {
                        imports.push(match[1]);
                    }
                }
                if (imports.length > 0) {
                    chain.push({
                        file: kf.file,
                        imports: [...new Set(imports)].slice(0, 10)
                    });
                }
            } catch (e) {
                // 跳过
            }
        }

        return chain;
    }

    /**
     * 快速文件搜索（按文件名模式）
     */
    searchFiles(rootDir, pattern) {
        const results = [];
        const ignored = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', 'target', '.cache']);
        const regex = new RegExp(this._escapeRegex(pattern).replace(/\*/g, '.*'), 'gi');

        const search = (dir) => {
            try {
                const entries = fs.readdirSync(dir, { withFileTypes: true });
                for (const entry of entries) {
                    if (ignored.has(entry.name) || entry.name.startsWith('.')) continue;
                    const fullPath = path.join(dir, entry.name);
                    if (entry.isDirectory()) {
                        search(fullPath);
                    } else {
                        regex.lastIndex = 0;
                        if (regex.test(entry.name)) {
                            results.push({
                                name: entry.name,
                                path: this._relativePath(fullPath, rootDir),
                                fullPath
                            });
                        }
                    }
                    if (results.length >= this.maxResults) return;
                }
            } catch (e) {
                logger.warn('CODE_EXPLORER', `搜索跳过: ${e.message}`);
            }
        };

        search(rootDir);
        return results;
    }

    // ── 工具方法 ──

    _relativePath(fullPath, rootDir) {
        return path.relative(rootDir, fullPath).replace(/\\/g, '/');
    }

    _escapeRegex(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    _parseFilePattern(pattern) {
        // "*.js,*.ts" → Set(['.js', '.ts'])
        const exts = new Set();
        pattern.split(',').forEach(p => {
            const trimmed = p.trim();
            if (trimmed.startsWith('*.')) {
                exts.add(trimmed.substring(1)); // .js
            } else if (trimmed.startsWith('.')) {
                exts.add(trimmed);
            }
        });
        return exts.size > 0 ? exts : null;
    }

    _isBinary(ext) {
        const binaryExts = new Set([
            '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.svg',
            '.mp3', '.mp4', '.wav', '.avi', '.mov',
            '.zip', '.tar', '.gz', '.rar', '.7z',
            '.woff', '.woff2', '.ttf', '.eot',
            '.db', '.sqlite', '.ico',
            '.min.js', '.min.css'
        ]);
        return binaryExts.has(ext);
    }
}

module.exports = CodeExplorer;
