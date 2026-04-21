// tools/web-search.js - 网页搜索工具
const registry = require('./index');
const httpExecutor = require('../modules/http-executor');

/**
 * 网页搜索工具
 * 使用 DuckDuckGo HTML 搜索
 */
registry.register(
    'web_search',
    {
        description: '搜索网络获取实时信息（新闻、百科、实时事件等）。天气查询请用 weather 工具。',
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: '搜索关键词'
                }
            },
            required: ['query']
        }
    },
    async (params, context) => {
        const { query } = params;
        if (!query) {
            return '请提供搜索关键词';
        }

        console.log(`[web_search] Searching for: ${query}`);
        const result = await httpExecutor.search(query);

        if (result.success && result.results && result.results.length > 0) {
            return result.results.slice(0, 5).map(r =>
                `【${r.title}】\n${r.snippet}\n链接: ${r.url}`
            ).join('\n\n');
        }

        return `搜索未返回结果（${result.message || 'unknown error'}）。可以尝试换个关键词。`;
    },
    {
        icon: '🔍',
        label: '搜索网页'
    }
);

/**
 * HTTP GET 工具
 * 获取网页内容
 */
registry.register(
    'http_get',
    {
        description: '【已弃用，请改用 web_fetch】发送 HTTP GET 请求获取网页内容。web_fetch 功能更强大，自动提取文本内容，支持超时和大小限制。',
        parameters: {
            type: 'object',
            properties: {
                url: {
                    type: 'string',
                    description: '请求的 URL'
                }
            },
            required: ['url']
        }
    },
    async (params, context) => {
        const { fetchWebContent } = require('./web-fetch');
        try {
            const result = await fetchWebContent(params.url);
            return result;
        } catch (e) {
            return `HTTP 请求失败: ${e.message}`;
        }
    },
    { icon: '🌐', label: '网络请求' }
);
