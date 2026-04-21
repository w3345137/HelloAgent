// modules/minimax-adapter.js
// 适配 MiniMax Anthropic 兼容接口，支持标准 tool_use content block
const axios = require('axios');

class MiniMaxAdapter {
    constructor(apiKey) {
        this.apiKey = apiKey;
        this.baseUrl = 'https://api.minimaxi.com/anthropic/v1/messages';
    }

    /**
     * 发送聊天请求
     * @param {Array} messages - 内部消息格式 [{role, content}]
     *   content 可以是 string 或 Anthropic content array
     * @param {object} opts - { signal, tools, tool_choice }
     * @returns {{ text, toolCalls, stopReason, rawContent }}
     */
    async chat(messages, opts = {}) {
        try {
            let systemText = '';
            const anthropicMessages = [];

            for (const msg of messages) {
                const role = (msg.role || '').toLowerCase();
                if (role === 'system') {
                    systemText += (systemText ? '\n' : '') + (msg.text || msg.content || '');
                } else {
                    const r = (role === 'user') ? 'user' : 'assistant';
                    // content 可能是 string 或 array（tool_result 场景）
                    const c = msg.content || msg.text || '';
                    anthropicMessages.push({ role: r, content: c });
                }
            }

            const body = {
                model: 'Minimax-2.7',
                max_tokens: 4096,
                messages: anthropicMessages
            };
            if (systemText) body.system = systemText;

            if (opts.tools && opts.tools.length > 0) {
                body.tools = opts.tools;
                body.tool_choice = opts.tool_choice || { type: 'auto' };
            }

            const axiosOpts = {
                headers: {
                    'x-api-key': this.apiKey,
                    'anthropic-version': '2023-06-01',
                    'Content-Type': 'application/json'
                }
            };
            if (opts.signal) axiosOpts.signal = opts.signal;

            const response = await axios.post(this.baseUrl, body, axiosOpts);
            const data = response.data;
            const contentBlocks = data.content || [];

            // 提取文本
            const textParts = contentBlocks
                .filter(c => c.type === 'text')
                .map(c => c.text);
            const text = textParts.join('\n').trim();

            // 提取 tool_use blocks
            const toolCalls = contentBlocks
                .filter(c => c.type === 'tool_use')
                .map(c => ({ id: c.id, name: c.name, input: c.input }));

            return {
                text,
                toolCalls,
                stopReason: data.stop_reason || 'end_turn',
                rawContent: contentBlocks
            };
        } catch (error) {
            console.error('[MiniMax] Chat error:', error.response ? error.response.data : error.message);
            throw error;
        }
    }
}

module.exports = MiniMaxAdapter;
