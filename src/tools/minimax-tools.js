const registry = require('./index');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

function _getApiKey() {
    try {
        const configDir = path.join(__dirname, '..', 'config');
        const modelsPath = path.join(configDir, 'models.json');
        if (fs.existsSync(modelsPath)) {
            const models = JSON.parse(fs.readFileSync(modelsPath, 'utf-8'));
            const minimax = models.find(m => m.id === 'Minimax-2.7' || (m.endpoint && m.endpoint.includes('minimax')));
            if (minimax && minimax.apiKey) return minimax.apiKey;
        }
        const mainConfigPath = path.join(configDir, '..', 'config.json');
        if (fs.existsSync(mainConfigPath)) {
            const config = JSON.parse(fs.readFileSync(mainConfigPath, 'utf-8'));
            if (config.minimaxApiKey) return config.minimaxApiKey;
        }
    } catch {}
    return null;
}

function _minimaxRequest(endpoint, body, apiKey) {
    return new Promise((resolve, reject) => {
        const url = new URL(endpoint);
        const data = JSON.stringify(body);
        const options = {
            hostname: url.hostname,
            port: 443,
            path: url.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
                'Content-Length': Buffer.byteLength(data)
            },
            timeout: 30000
        };

        const req = https.request(options, (res) => {
            let chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
                try {
                    const result = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
                    if (res.statusCode >= 400) {
                        reject(new Error(result.error?.message || result.message || `HTTP ${res.statusCode}`));
                    } else {
                        resolve(result);
                    }
                } catch (e) {
                    reject(new Error(`解析响应失败: ${e.message}`));
                }
            });
        });

        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')); });
        req.write(data);
        req.end();
    });
}

registry.registerVendorTool(
    'minimax_search',
    {
        description: '使用 MiniMax 搜索引擎搜索网络信息。比 DuckDuckGo 搜索质量更高，支持中文搜索，返回结构化结果。需要配置 MiniMax API Key。',
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
        if (!query) return '请提供搜索关键词';

        const apiKey = _getApiKey();
        if (!apiKey) return '❌ 未配置 MiniMax API Key，请在模型配置中填写 MiniMax 的 API Key';

        try {
            console.log(`[minimax_search] Searching: ${query}`);
            const result = await _minimaxRequest(
                'https://api.minimaxi.com/v1/coding_plan/search',
                { query },
                apiKey
            );

            if (result.results && result.results.length > 0) {
                return result.results.slice(0, 8).map((r, i) =>
                    `${i + 1}. 【${r.title || '无标题'}】\n   ${r.snippet || r.content || ''}\n   🔗 ${r.url || r.link || ''}`
                ).join('\n\n');
            }

            if (result.choices && result.choices[0]) {
                return result.choices[0].message?.content || '搜索未返回结果';
            }

            return `搜索未返回结果: ${JSON.stringify(result).slice(0, 200)}`;
        } catch (err) {
            console.error('[minimax_search] Error:', err.message);
            return `❌ MiniMax 搜索失败: ${err.message}。可以尝试使用 web_search 工具。`;
        }
    },
    { icon: '🔍', label: 'MiniMax搜索', vendor: 'minimax' }
);

registry.registerVendorTool(
    'minimax_vision',
    {
        description: '使用 MiniMax 视觉模型理解图片内容。支持分析截图、文档、图表等图片。需要配置 MiniMax API Key。支持 URL 和本地文件路径。',
        parameters: {
            type: 'object',
            properties: {
                image_url: {
                    type: 'string',
                    description: '图片地址，支持 HTTP/HTTPS URL 或本地文件路径。支持格式：JPEG、PNG、GIF、WebP（最大 20MB）'
                },
                prompt: {
                    type: 'string',
                    description: '对图片的提问或分析要求，如"描述这张图片"、"提取图片中的文字"'
                }
            },
            required: ['image_url', 'prompt']
        }
    },
    async (params, context) => {
        const { image_url, prompt } = params;
        if (!image_url || !prompt) return '请提供 image_url 和 prompt';

        const apiKey = _getApiKey();
        if (!apiKey) return '❌ 未配置 MiniMax API Key，请在模型配置中填写 MiniMax 的 API Key';

        try {
            console.log(`[minimax_vision] Analyzing image: ${image_url.slice(0, 80)}...`);

            let imageUrl = image_url;
            if (!image_url.startsWith('http://') && !image_url.startsWith('https://')) {
                const fs = require('fs');
                const path = require('path');
                const resolvedPath = path.resolve(image_url);
                if (!fs.existsSync(resolvedPath)) return `❌ 文件不存在: ${image_url}`;
                const ext = path.extname(resolvedPath).toLowerCase();
                const mimeMap = { '.jpg': 'jpeg', '.jpeg': 'jpeg', '.png': 'png', '.gif': 'gif', '.webp': 'webp' };
                const mime = mimeMap[ext] || 'png';
                const base64 = fs.readFileSync(resolvedPath).toString('base64');
                imageUrl = `data:image/${mime};base64,${base64}`;
            }

            const result = await _minimaxRequest(
                'https://api.minimaxi.com/anthropic/v1/messages',
                {
                    model: 'Minimax-2.7',
                    max_tokens: 4096,
                    messages: [{
                        role: 'user',
                        content: [
                            { type: 'image_url', image_url: { url: imageUrl } },
                            { type: 'text', text: prompt }
                        ]
                    }]
                },
                apiKey
            );

            if (result.content && result.content.length > 0) {
                const textParts = result.content.filter(c => c.type === 'text').map(c => c.text);
                return textParts.join('\n') || '图片分析未返回结果';
            }

            return `图片分析未返回结果: ${JSON.stringify(result).slice(0, 200)}`;
        } catch (err) {
            console.error('[minimax_vision] Error:', err.message);
            return `❌ MiniMax 图片理解失败: ${err.message}`;
        }
    },
    { icon: '👁️', label: 'MiniMax视觉', vendor: 'minimax' }
);

console.log('[Tool] minimax_search, minimax_vision registered (conditional on API Key)');
