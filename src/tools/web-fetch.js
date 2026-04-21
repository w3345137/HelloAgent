// tools/web-fetch.js - 高级网页抓取工具（基于openClaw理念）

const registry = require('./index');

// 配置
const config = {
    userAgent: 'HelloAgent/1.0 (compatible; OpenClaw/1.0)',
    timeout: 15000, // 15秒超时
    maxSize: 1024 * 1024 * 5 // 5MB限制
};

// 提取网页内容的核心函数
async function fetchWebContent(url, options = {}) {
    const https = require('https');
    const http = require('http');
    const { URL } = require('url');
    
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const protocol = urlObj.protocol === 'https:' ? https : http;
        
        const reqOptions = {
            hostname: urlObj.hostname,
            port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
            path: urlObj.pathname + urlObj.search,
            headers: {
                'User-Agent': options.userAgent || config.userAgent,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                'Accept-Encoding': 'gzip, deflate',
                'Connection': 'close',
                'Cache-Control': 'no-cache'
            },
            timeout: options.timeout || config.timeout
        };

        const request = protocol.get(reqOptions, (response) => {
            // 处理重定向（3xx）
            if (response.statusCode >= 300 && response.statusCode < 400) {
                const location = response.headers.location;
                if (location) {
                    // 解析相对重定向 URL
                    const { URL } = require('url');
                    let redirectUrl;
                    try {
                        redirectUrl = new URL(location, url).href;
                    } catch {
                        redirectUrl = location;
                    }
                    // 限制最多 5 次重定向
                    const redirects = options._redirects || 0;
                    if (redirects >= 5) {
                        reject(new Error(`重定向次数过多（>5次），最终 URL: ${redirectUrl}`));
                        response.destroy();
                        return;
                    }
                    response.destroy();
                    // 跟随重定向
                    fetchWebContent(redirectUrl, { ...options, _redirects: redirects + 1 })
                        .then(resolve)
                        .catch(reject);
                    return;
                }
                reject(new Error(`HTTP ${response.statusCode} 重定向但缺少 Location 头`));
                response.destroy();
                return;
            }

            // 检查状态码（非 2xx 报错）
            if (response.statusCode < 200 || response.statusCode >= 300) {
                reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
                response.destroy();
                return;
            }

            // 检查内容类型
            const contentType = response.headers['content-type'] || '';
            if (!contentType.includes('text/') && !contentType.includes('application/json')) {
                reject(new Error(`不支持的Content-Type: ${contentType}`));
                response.destroy();
                return;
            }

            // 收集数据
            let data = [];
            let totalSize = 0;
            
            response.on('data', (chunk) => {
                totalSize += chunk.length;
                if (totalSize > config.maxSize) {
                    reject(new Error(`内容超过${config.maxSize}字节限制`));
                    response.destroy();
                    return;
                }
                data.push(chunk);
            });

            response.on('end', () => {
                try {
                    let content = Buffer.concat(data).toString('utf-8');
                    
                    // 如果是JSON，直接返回
                    if (contentType.includes('application/json')) {
                        const json = JSON.parse(content);
                        resolve({
                            type: 'json',
                            url: url,
                            data: json,
                            size: totalSize
                        });
                        return;
                    }
                    
                    // HTML内容，提取文本
                    const textContent = extractTextFromHTML(content);
                    resolve({
                        type: 'html',
                        url: url,
                        title: extractTitleFromHTML(content),
                        content: textContent,
                        size: totalSize,
                        length: textContent.length
                    });
                } catch (error) {
                    reject(new Error(`处理响应数据失败: ${error.message}`));
                }
            });
        });

        request.on('error', (error) => {
            reject(new Error(`网络请求失败: ${error.message}`));
        });

        request.on('timeout', () => {
            reject(new Error(`请求超时 (${reqOptions.timeout}ms)`));
            request.destroy();
        });
    });
}

// 从HTML提取标题
function extractTitleFromHTML(html) {
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    return titleMatch ? titleMatch[1].trim() : '无标题';
}

// 从HTML提取文本
function extractTextFromHTML(html) {
    // 简单去除标签并规范化空格
    let text = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '') // 移除script
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')  // 移除style
        .replace(/<[^>]+>/g, ' ')                        // 移除标签
        .replace(/\s+/g, ' ')                           // 合并空格
        .replace(/&nbsp;/g, ' ')                        // 替换空格实体
        .replace(/&lt;/g, '<')                          // 替换特殊字符
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&')
        .trim();
    
    // 限制长度
    const maxLength = 3000;
    if (text.length > maxLength) {
        text = text.substring(0, maxLength) + '... [内容截断]';
    }
    
    return text;
}

// 注册工具
registry.register(
    'web_fetch',
    {
        description: '获取网页内容（支持HTML和JSON）。比http_get更强大，自动提取文本内容，支持超时和大小限制。',
        parameters: {
            type: 'object',
            properties: {
                url: { 
                    type: 'string', 
                    description: '网页URL（必须以http://或https://开头）' 
                },
                timeout: { 
                    type: 'number', 
                    description: '超时时间（毫秒），可选，默认15000' 
                }
            },
            required: ['url']
        }
    },
    async (params, context) => {
        try {
            const result = await fetchWebContent(params.url, params);
            
            if (result.type === 'json') {
                return `📄 JSON数据 (${result.size} 字节):\n\`\`\`json\n${JSON.stringify(result.data, null, 2).slice(0, 2000)}\n\`\`\``;
            } else {
                return `🌐 网页内容: ${result.title}\n🔗 链接: ${result.url}\n📏 大小: ${result.size} 字节 (文本: ${result.length} 字符)\n\n---\n${result.content}`;
            }
        } catch (error) {
            return `❌ 网页抓取失败: ${error.message}`;
        }
    },
    {
        icon: '📄',
        label: '抓取网页'
    }
);

console.log('[Tool] web_fetch registered');

// 导出函数供其他模块使用
module.exports = { fetchWebContent, extractTextFromHTML, extractTitleFromHTML };