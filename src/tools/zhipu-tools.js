const registry = require('./index');
const https = require('https');
const fs = require('fs');
const path = require('path');

function _getApiKey() {
    try {
        const configDir = path.join(__dirname, '..', 'config');
        const mainConfigPath = path.join(configDir, '..', 'config.json');
        if (fs.existsSync(mainConfigPath)) {
            const config = JSON.parse(fs.readFileSync(mainConfigPath, 'utf-8'));
            if (config.zhipuApiKey) return config.zhipuApiKey;
        }
        const modelsPath = path.join(configDir, 'models.json');
        if (fs.existsSync(modelsPath)) {
            const models = JSON.parse(fs.readFileSync(modelsPath, 'utf-8'));
            const zhipu = models.find(m => m.endpoint && m.endpoint.includes('bigmodel'));
            if (zhipu && zhipu.apiKey) return zhipu.apiKey;
        }
    } catch {}
    return null;
}

function _zhipuRequest(body, apiKey) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify(body);
        const options = {
            hostname: 'open.bigmodel.cn',
            port: 443,
            path: '/api/paas/v4/chat/completions',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
                'Content-Length': Buffer.byteLength(data)
            },
            timeout: 60000
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

function _resolveImageUrl(imageUrl) {
    if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
        return imageUrl;
    }

    const resolvedPath = path.resolve(imageUrl);
    if (!fs.existsSync(resolvedPath)) return null;

    const ext = path.extname(resolvedPath).toLowerCase();
    const mimeMap = { '.jpg': 'jpeg', '.jpeg': 'jpeg', '.png': 'png', '.gif': 'gif', '.webp': 'webp' };
    const mime = mimeMap[ext] || 'png';
    const base64 = fs.readFileSync(resolvedPath).toString('base64');
    return `data:image/${mime};base64,${base64}`;
}

registry.registerVendorTool(
    'zhipu_vision',
    {
        description: '使用智谱 GLM-4V 视觉模型理解图片内容。擅长：UI截图分析、架构图解读、图表数据提取、错误截图诊断、通用图片描述。需要配置智谱 API Key。支持 URL 和本地文件路径。',
        parameters: {
            type: 'object',
            properties: {
                image_url: {
                    type: 'string',
                    description: '图片地址，支持 HTTP/HTTPS URL 或本地文件路径'
                },
                prompt: {
                    type: 'string',
                    description: '对图片的提问或分析要求'
                },
                detail: {
                    type: 'string',
                    description: '分析详细程度：low（快速概览）、high（详细分析），默认 high',
                    enum: ['low', 'high']
                }
            },
            required: ['image_url', 'prompt']
        }
    },
    async (params, context) => {
        const { image_url, prompt, detail = 'high' } = params;
        if (!image_url || !prompt) return '请提供 image_url 和 prompt';

        const apiKey = _getApiKey();
        if (!apiKey) return '❌ 未配置智谱 API Key，请在 config.json 中填写 zhipuApiKey';

        try {
            console.log(`[zhipu_vision] Analyzing image: ${image_url.slice(0, 80)}...`);

            const resolvedUrl = _resolveImageUrl(image_url);
            if (!resolvedUrl) return `❌ 文件不存在: ${image_url}`;

            const fullPrompt = detail === 'high'
                ? prompt
                : `简要回答：${prompt}`;

            const result = await _zhipuRequest({
                model: 'glm-4v-flash',
                messages: [{
                    role: 'user',
                    content: [
                        { type: 'image_url', image_url: { url: resolvedUrl } },
                        { type: 'text', text: fullPrompt }
                    ]
                }],
                max_tokens: 4096
            }, apiKey);

            if (result.choices && result.choices[0]) {
                return result.choices[0].message?.content || '图片分析未返回结果';
            }

            return `图片分析未返回结果: ${JSON.stringify(result).slice(0, 200)}`;
        } catch (err) {
            console.error('[zhipu_vision] Error:', err.message);
            return `❌ 智谱视觉理解失败: ${err.message}`;
        }
    },
    { icon: '🖼️', label: '智谱视觉', vendor: 'zhipu' }
);

registry.registerVendorTool(
    'zhipu_ocr',
    {
        description: '使用智谱 GLM-4V 从图片中提取文字（OCR）。专门用于：代码截图提取、终端输出提取、文档文字识别、表格数据提取。需要配置智谱 API Key。支持 URL 和本地文件路径。',
        parameters: {
            type: 'object',
            properties: {
                image_url: {
                    type: 'string',
                    description: '图片地址，支持 HTTP/HTTPS URL 或本地文件路径'
                },
                format: {
                    type: 'string',
                    description: '输出格式：text（纯文本）、markdown（保留格式）、json（结构化），默认 text',
                    enum: ['text', 'markdown', 'json']
                }
            },
            required: ['image_url']
        }
    },
    async (params, context) => {
        const { image_url, format = 'text' } = params;
        if (!image_url) return '请提供 image_url';

        const apiKey = _getApiKey();
        if (!apiKey) return '❌ 未配置智谱 API Key，请在 config.json 中填写 zhipuApiKey';

        try {
            console.log(`[zhipu_ocr] Extracting text from: ${image_url.slice(0, 80)}...`);

            const resolvedUrl = _resolveImageUrl(image_url);
            if (!resolvedUrl) return `❌ 文件不存在: ${image_url}`;

            const prompts = {
                text: '请提取图片中的所有文字内容，只输出提取的文字，不要添加任何解释或说明。保持原始的换行和段落结构。',
                markdown: '请提取图片中的所有文字内容，使用 Markdown 格式输出。保留标题层级、列表、表格等格式。只输出提取的内容，不要添加解释。',
                json: '请提取图片中的所有文字内容，以 JSON 格式输出。格式为：{"text": "提取的文字内容", "sections": [{"type": "段落类型", "content": "内容"}]}。只输出 JSON，不要添加解释。'
            };

            const result = await _zhipuRequest({
                model: 'glm-4v-flash',
                messages: [{
                    role: 'user',
                    content: [
                        { type: 'image_url', image_url: { url: resolvedUrl } },
                        { type: 'text', text: prompts[format] || prompts.text }
                    ]
                }],
                max_tokens: 4096
            }, apiKey);

            if (result.choices && result.choices[0]) {
                const content = result.choices[0].message?.content || '';
                if (format === 'json') {
                    try {
                        const parsed = JSON.parse(content);
                        return JSON.stringify(parsed, null, 2);
                    } catch {}
                }
                return content || 'OCR 未提取到文字';
            }

            return `OCR 未返回结果: ${JSON.stringify(result).slice(0, 200)}`;
        } catch (err) {
            console.error('[zhipu_ocr] Error:', err.message);
            return `❌ 智谱 OCR 失败: ${err.message}`;
        }
    },
    { icon: '📝', label: '智谱OCR', vendor: 'zhipu' }
);

registry.registerVendorTool(
    'zhipu_video',
    {
        description: '使用智谱 GLM-4V 分析视频内容。支持 MP4/MOV/M4V 格式（最大 8MB）。可以理解视频中的场景、事件和关键帧。需要配置智谱 API Key。',
        parameters: {
            type: 'object',
            properties: {
                video_url: {
                    type: 'string',
                    description: '视频地址，支持 HTTP/HTTPS URL 或本地文件路径（MP4/MOV/M4V，最大 8MB）'
                },
                prompt: {
                    type: 'string',
                    description: '对视频的提问或分析要求'
                }
            },
            required: ['video_url', 'prompt']
        }
    },
    async (params, context) => {
        const { video_url, prompt } = params;
        if (!video_url || !prompt) return '请提供 video_url 和 prompt';

        const apiKey = _getApiKey();
        if (!apiKey) return '❌ 未配置智谱 API Key，请在 config.json 中填写 zhipuApiKey';

        try {
            console.log(`[zhipu_video] Analyzing video: ${video_url.slice(0, 80)}...`);

            let videoUrl = video_url;
            if (!video_url.startsWith('http://') && !video_url.startsWith('https://')) {
                const resolvedPath = path.resolve(video_url);
                if (!fs.existsSync(resolvedPath)) return `❌ 文件不存在: ${video_url}`;
                const stat = fs.statSync(resolvedPath);
                if (stat.size > 8 * 1024 * 1024) return '❌ 视频文件超过 8MB 限制';
                const base64 = fs.readFileSync(resolvedPath).toString('base64');
                videoUrl = `data:video/mp4;base64,${base64}`;
            }

            const result = await _zhipuRequest({
                model: 'glm-4v-flash',
                messages: [{
                    role: 'user',
                    content: [
                        { type: 'video_url', video_url: { url: videoUrl } },
                        { type: 'text', text: prompt }
                    ]
                }],
                max_tokens: 4096
            }, apiKey);

            if (result.choices && result.choices[0]) {
                return result.choices[0].message?.content || '视频分析未返回结果';
            }

            return `视频分析未返回结果: ${JSON.stringify(result).slice(0, 200)}`;
        } catch (err) {
            console.error('[zhipu_video] Error:', err.message);
            return `❌ 智谱视频分析失败: ${err.message}`;
        }
    },
    { icon: '🎬', label: '智谱视频', vendor: 'zhipu' }
);

console.log('[Tool] zhipu_vision, zhipu_ocr, zhipu_video registered (conditional on API Key)');
