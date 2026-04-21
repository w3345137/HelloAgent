/**
 * 网络请求执行器
 * 功能：支持 HTTP GET/POST 请求，让 Hello Agent 具备联网能力
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

const httpExecutor = {
    name: 'http',
    
    /**
     * 执行 HTTP 请求
     * @param {object|string} rawParams - 请求参数（可能是对象或 JSON 字符串）
     * @returns {Promise<object>} - 响应结果
     */
    async execute(rawParams) {
        // 解析参数（可能是 JSON 字符串）
        const params = typeof rawParams === 'string' ? JSON.parse(rawParams) : rawParams;
        const { action, url, method = 'GET', headers = {}, body, timeout = 30000, query } = params;
        
        // 处理特殊动作
        if (action === 'search') {
            return this.search(query || '');
        }
        if (action === 'fetch') {
            return this.fetch(url);
        }
        
        // 普通 HTTP 请求
        if (!url) {
            throw new Error('URL 是必需参数');
        }
        
        // 解析 URL
        let parsedUrl;
        try {
            parsedUrl = new URL(url);
        } catch (err) {
            throw new Error(`无效的 URL: ${url}`);
        }
        
        const isHttps = parsedUrl.protocol === 'https:';
        const client = isHttps ? https : http;
        
        const options = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || (isHttps ? 443 : 80),
            path: parsedUrl.pathname + parsedUrl.search,
            method: method.toUpperCase(),
            headers: {
                'User-Agent': 'HelloAgent/1.0',
                ...headers
            },
            timeout
        };
        
        // 如果是 POST/PUT 且 body 是对象，自动 JSON 序列化
        let requestBody = null;
        if (body && ['POST', 'PUT', 'PATCH'].includes(options.method)) {
            if (typeof body === 'object') {
                requestBody = JSON.stringify(body);
                options.headers['Content-Type'] = 'application/json';
                options.headers['Content-Length'] = Buffer.byteLength(requestBody);
            } else {
                requestBody = body;
            }
        }
        
        return new Promise((resolve, reject) => {
            const req = client.request(options, (res) => {
                let data = '';
                const chunks = [];
                
                res.on('data', (chunk) => {
                    chunks.push(chunk);
                });
                
                res.on('end', () => {
                    const buffer = Buffer.concat(chunks);
                    const contentType = res.headers['content-type'] || '';
                    
                    let responseData;
                    if (contentType.includes('application/json')) {
                        try {
                            responseData = JSON.parse(buffer.toString('utf8'));
                        } catch {
                            responseData = buffer.toString('utf8');
                        }
                    } else if (contentType.includes('text/')) {
                        responseData = buffer.toString('utf8');
                    } else {
                        responseData = buffer.toString('base64');
                    }
                    
                    resolve({
                        status: res.statusCode,
                        headers: res.headers,
                        data: responseData,
                        size: buffer.length
                    });
                });
            });
            
            req.on('error', (err) => {
                reject(new Error(`HTTP 请求失败: ${err.message}`));
            });
            
            req.on('timeout', () => {
                req.destroy();
                reject(new Error(`HTTP 请求超时 (${timeout}ms)`));
            });
            
            if (requestBody) {
                req.write(requestBody);
            }
            
            req.end();
        });
    },
    
    /**
     * 简化的 GET 方法
     */
    async get(url, headers = {}) {
        return this.execute({ url, method: 'GET', headers });
    },
    
    /**
     * 简化的 POST 方法
     */
    async post(url, body, headers = {}) {
        return this.execute({ url, method: 'POST', headers, body });
    },
    
    /**
     * 搜索网络 - 抓取搜索结果页
     * @param {string} query - 搜索关键词
     * @returns {Promise<object>} - 搜索结果
     */
    async search(query) {
        // 自动检测是否为新闻查询，添加时间限定
        const isNewsQuery = this._isNewsQuery(query);
        const enhancedQuery = isNewsQuery ? `${query} ${new Date().getFullYear()}` : query;

        // 优先尝试 Bing 新闻搜索
        if (isNewsQuery) {
            try {
                const results = await this._searchBingNews(enhancedQuery);
                if (results.length > 0) {
                    return { success: true, query: enhancedQuery, results, source: 'Bing News' };
                }
            } catch (e) {
                console.warn('[Search] Bing News failed:', e.message);
            }
        }

        // 尝试 Bing 网页搜索
        try {
            const results = await this._searchBing(enhancedQuery);
            if (results.length > 0) {
                return { success: true, query: enhancedQuery, results, source: 'Bing' };
            }
        } catch (e) {
            console.warn('[Search] Bing failed:', e.message);
        }

        // Bing 失败则尝试 DuckDuckGo HTML
        try {
            const results = await this._searchDDG(query);
            if (results.length > 0) {
                return { success: true, query, results, source: 'DuckDuckGo' };
            }
        } catch (e) {
            console.warn('[Search] DDG failed:', e.message);
        }

        return {
            success: false, query,
            message: '搜索未返回结果，请尝试换个关键词',
            fallbackUrls: {
                baidu: `https://www.baidu.com/s?wd=${encodeURIComponent(query)}`,
                bing: `https://www.bing.com/search?q=${encodeURIComponent(query)}`
            }
        };
    },

    /**
     * 检测是否为新闻查询
     */
    _isNewsQuery(query) {
        const newsKeywords = ['新闻', '最新', '今天', '近日', '最近', '特朗普', '美国', '政治', '财经', '科技', '国际'];
        return newsKeywords.some(k => query.includes(k));
    },

    /**
     * Bing 新闻搜索抓取
     */
    async _searchBingNews(query) {
        const axios = require('axios');
        // 使用 cn.bing.com 避免重定向
        const url = `https://cn.bing.com/news/search?q=${encodeURIComponent(query)}&qft=sortbydate=1`;
        const resp = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml',
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
            },
            timeout: 15000,
            maxRedirects: 5
        });

        const html = String(resp.data);
        const results = [];

        // 解析 Bing 新闻搜索结果：<div class="news-item">
        const blocks = html.split(/<div class="news-item/i).slice(1, 8);
        for (const block of blocks) {
            // 提取标题和链接
            const titleMatch = block.match(/<a[^>]+class="title"[^>]*>([^<]+)<\/a>/i);
            const urlMatch = block.match(/href="([^"]+)"/i);
            const snippetMatch = block.match(/<p[^>]*>([^<]+)<\/p>/i);

            if (titleMatch && urlMatch) {
                let resultUrl = urlMatch[1];
                // 过滤掉必应自己的链接
                if (resultUrl.startsWith('http') && !resultUrl.includes('bing.com')) {
                    results.push({
                        title: this._cleanHtml(titleMatch[1]),
                        snippet: snippetMatch ? this._cleanHtml(snippetMatch[1]).slice(0, 300) : '',
                        url: resultUrl
                    });
                }
            }
        }

        // 如果新闻搜索没结果，尝试另一种格式
        if (results.length === 0) {
            const h3Blocks = html.split(/<h3/i).slice(1, 8);
            for (const block of h3Blocks) {
                const linkMatch = block.match(/<a[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>/i);
                const nextPSnippet = block.match(/<\/a>([^<]+<p[^>]*>[^<]+<\/p>)/i);

                if (linkMatch) {
                    let resultUrl = linkMatch[1];
                    if (resultUrl.startsWith('http') && !resultUrl.includes('bing.com')) {
                        results.push({
                            title: this._cleanHtml(linkMatch[2]),
                            snippet: nextPSnippet ? this._cleanHtml(nextPSnippet[1]).slice(0, 300) : '',
                            url: resultUrl
                        });
                    }
                }
            }
        }

        return results;
    },

    /**
     * Bing 网页搜索抓取
     */
    async _searchBing(query) {
        const axios = require('axios');
        // 使用 cn.bing.com 避免重定向
        const url = `https://cn.bing.com/search?q=${encodeURIComponent(query)}&setlang=zh-CN`;
        const resp = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml',
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
            },
            timeout: 15000,
            maxRedirects: 5
        });

        const html = String(resp.data);
        const results = [];

        // 解析 Bing 搜索结果：<li class="b_algo">
        const blocks = html.split(/<li class="b_algo"/i).slice(1, 8);
        for (const block of blocks) {
            // 从 <h2> 中提取标题和 URL
            const h2Match = block.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
            if (!h2Match) continue;

            const h2Content = h2Match[1];
            const urlMatch = h2Content.match(/href="([^"]+)"/i);
            if (!urlMatch || !urlMatch[1].startsWith('http')) continue;

            const resultUrl = urlMatch[1];
            const title = h2Content.replace(/<[^>]+>/g, '').trim();

            // 从 <p> 或 b_caption 中提取摘要
            let snippet = '';
            const snippetMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i)
                || block.match(/<div class="b_caption"[^>]*>([\s\S]*?)<\/div>/i);
            if (snippetMatch) {
                snippet = snippetMatch[1].replace(/<[^>]+>/g, '').trim();
            }

            if (title) {
                results.push({
                    title: this._cleanHtml(title),
                    snippet: this._cleanHtml(snippet).slice(0, 300),
                    url: resultUrl
                });
            }
        }
        return results;
    },

    /**
     * DuckDuckGo HTML 搜索抓取
     */
    async _searchDDG(query) {
        const axios = require('axios');
        const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
        const resp = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            timeout: 15000,
            maxRedirects: 5
        });

        const html = String(resp.data);
        const results = [];

        const blocks = html.split(/class="result\s/i).slice(1, 8);
        for (const block of blocks) {
            const linkMatch = block.match(/<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
            if (!linkMatch) continue;

            let resultUrl = linkMatch[1];
            const title = linkMatch[2].replace(/<[^>]+>/g, '').trim();

            const uddgMatch = resultUrl.match(/uddg=([^&]+)/);
            if (uddgMatch) resultUrl = decodeURIComponent(uddgMatch[1]);

            const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|span|div)/i);
            const snippet = snippetMatch ? snippetMatch[1].replace(/<[^>]+>/g, '').trim() : '';

            if (title && resultUrl.startsWith('http')) {
                results.push({
                    title: this._cleanHtml(title),
                    snippet: this._cleanHtml(snippet).slice(0, 300),
                    url: resultUrl
                });
            }
        }
        return results;
    },

    /**
     * 清理 HTML 实体和多余空白
     */
    _cleanHtml(text) {
        return text
            .replace(/&ensp;/g, ' ')
            .replace(/&nbsp;/g, ' ')
            .replace(/&#0*183;/g, '·')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&[a-z]+;/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    },
    
    /**
     * 网页抓取
     * @param {string} url - 网页 URL
     * @returns {Promise<object>} - 抓取结果
     */
    async fetch(url) {
        try {
            const result = await this.get(url);
            return {
                success: true,
                url,
                status: result.status,
                content: result.data,
                size: result.size
            };
        } catch (err) {
            return {
                success: false,
                url,
                error: err.message
            };
        }
    }
};

module.exports = httpExecutor;
