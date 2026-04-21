// modules/adapters/openai-adapter.js
// OpenAI 协议适配器（兼容所有 OpenAI 兼容 API）
const axios = require('axios');
const BaseAdapter = require('./base-adapter');

class OpenAIAdapter extends BaseAdapter {
    constructor(config) {
        super(config);
        this.name = 'openai';
        this.apiKey = config.apiKey;
        // 自动补全 endpoint 路径
        let endpoint = config.endpoint || 'https://api.openai.com/v1/chat/completions';
        if (!endpoint.includes('/chat/completions')) {
            // 确保路径以 /chat/completions 结尾
            endpoint = endpoint.replace(/\/+$/, '') + '/chat/completions';
        }
        this.baseUrl = endpoint;
        this.model = config.model || 'gpt-4';
        this.maxTokens = config.maxTokens || 8192;
        console.log(`[OpenAIAdapter] baseUrl resolved: ${this.baseUrl}`);
    }

    /**
     * 转换内部工具定义为 OpenAI 格式
     */
    _convertTools(tools) {
        if (!tools || tools.length === 0) return undefined;
        return tools.map(tool => ({
            type: 'function',
            function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters || { type: 'object', properties: {} }
            }
        }));
    }

    /**
     * 转换内部消息为 OpenAI 格式
     */
    _convertMessages(messages) {
        const openaiMessages = [];

        for (const msg of messages) {
            const role = (msg.role || '').toLowerCase();
            const content = msg.content || msg.text || '';

            // 处理 tool_result（来自 Anthropic 格式的 tool 结果）
            if (Array.isArray(content)) {
                // 检查是否包含 tool_result
                const toolResults = content.filter(c => c.type === 'tool_result');
                if (toolResults.length > 0) {
                    for (const tr of toolResults) {
                        openaiMessages.push({
                            role: 'tool',
                            tool_call_id: tr.tool_use_id,
                            content: typeof tr.content === 'string' ? tr.content : JSON.stringify(tr.content)
                        });
                    }
                    continue;
                }
                
                // 检查是否包含 tool_use（Anthropic 格式的 assistant 工具调用）
                const toolUses = content.filter(c => c.type === 'tool_use');
                if (toolUses.length > 0) {
                    const textParts = content.filter(c => c.type === 'text').map(c => c.text).join('\n');
                    openaiMessages.push({
                        role: 'assistant',
                        content: textParts || null,
                        tool_calls: toolUses.map(tc => ({
                            id: tc.id,
                            type: 'function',
                            function: {
                                name: tc.name,
                                arguments: JSON.stringify(tc.input)
                            }
                        }))
                    });
                    continue;
                }
                
                // 普通 content array，支持 text + image_url 多模态
                const parts = [];
                for (const c of content) {
                    if (c.type === 'text') {
                        parts.push({ type: 'text', text: c.text });
                    } else if (c.type === 'image_url') {
                        parts.push({ type: 'image_url', image_url: c.image_url });
                    }
                }
                // 如果只有文本，扁平为字符串（兼容不支持多模态的模型）
                const textOnly = parts.every(p => p.type === 'text');
                if (textOnly) {
                    openaiMessages.push({ role: role === 'system' ? 'system' : (role === 'user' ? 'user' : 'assistant'), content: parts.map(p => p.text).join('\n') });
                } else if (parts.length > 0) {
                    openaiMessages.push({ role: role === 'user' ? 'user' : (role === 'system' ? 'system' : 'assistant'), content: parts });
                }
                continue;
            }

            // 处理 assistant 消息中的 tool_calls
            if (role === 'assistant' && msg.toolCalls) {
                openaiMessages.push({
                    role: 'assistant',
                    content: content || null,
                    tool_calls: msg.toolCalls.map(tc => ({
                        id: tc.id,
                        type: 'function',
                        function: {
                            name: tc.name,
                            arguments: JSON.stringify(tc.input)
                        }
                    }))
                });
                continue;
            }

            // 普通消息
            const r = role === 'system' ? 'system' : (role === 'user' ? 'user' : 'assistant');
            openaiMessages.push({ role: r, content: content });
        }

        return openaiMessages;
    }

    /**
     * 解析 OpenAI 响应为统一格式
     */
    _parseResponse(data) {
        const choice = data.choices?.[0];
        if (!choice) {
            return { text: '', toolCalls: [], stopReason: 'end_turn', usage: { input: 0, output: 0 } };
        }

        const message = choice.message;
        let text = message.content || '';

        // 提取 tool_calls
        let toolCalls = (message.tool_calls || []).map(tc => ({
            id: tc.id,
            name: tc.function.name,
            input: this._safeParseJSON(tc.function.arguments)
        }));

        // 兼容 MiniMax 模型：检测文本中的 XML 格式工具调用
        // MiniMax 在多轮工具调用后可能退化成文本输出：<minimax:tool_call>
        if (toolCalls.length === 0 && text.includes('<minimax:tool_call')) {
            const extracted = this._extractMiniMaxToolCalls(text);
            if (extracted.length > 0) {
                toolCalls = extracted;
                console.log('[OpenAIAdapter] Extracted MiniMax XML tool_calls from text:', extracted.length);
            }
        }

        // 映射 stop_reason
        let stopReason = 'end_turn';
        if (choice.finish_reason === 'tool_calls' || toolCalls.length > 0) stopReason = 'tool_use';
        else if (choice.finish_reason === 'length') stopReason = 'max_tokens';

        return {
            text,
            toolCalls,
            stopReason,
            usage: {
                input: data.usage?.prompt_tokens || 0,
                output: data.usage?.completion_tokens || 0
            }
        };
    }

    /**
     * 从文本中提取 MiniMax XML 格式的工具调用
     * 支持两种格式：
     * 1. <minimax:tool_call name="xxx">{...}</minimax:tool_call>
     * 2. <minimax:tool_call><invoke name="xxx"><parameter name="key">value</parameter></invoke></minimax:tool_call>
     */
    _extractMiniMaxToolCalls(text) {
        const toolCalls = [];
        let idx = 0;

        // 格式1: <minimax:tool_call name="xxx">{...}</minimax:tool_call>
        const regex1 = /<minimax:tool_call\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/minimax:tool_call>/g;
        let match;
        while ((match = regex1.exec(text)) !== null) {
            const name = match[1];
            const argsStr = match[2].trim();
            const input = this._safeParseJSON(argsStr);
            toolCalls.push({ id: `minimax_tc_${++idx}`, name, input });
        }

        // 格式2: <minimax:tool_call><invoke name="xxx"><parameter name="key">value</parameter></invoke></minimax:tool_call>
        const regex2 = /<minimax:tool_call>\s*<invoke\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/invoke>\s*<\/minimax:tool_call>/g;
        while ((match = regex2.exec(text)) !== null) {
            const name = match[1];
            const paramsBlock = match[2];
            // 解析 <parameter name="key">value</parameter>
            const input = {};
            const paramRegex = /<parameter\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/parameter>/g;
            let paramMatch;
            while ((paramMatch = paramRegex.exec(paramsBlock)) !== null) {
                input[paramMatch[1]] = paramMatch[2].trim();
            }
            toolCalls.push({ id: `minimax_tc_${++idx}`, name, input });
        }

        return toolCalls;
    }

    /**
     * 安全解析 JSON
     */
    _safeParseJSON(str) {
        try {
            return JSON.parse(str);
        } catch {
            return { raw: str };
        }
    }

    async chat(messages, opts = {}) {
        try {
            const openaiMessages = this._convertMessages(messages);

            const body = {
                model: this.model,
                messages: openaiMessages,
                max_tokens: opts.maxTokens || this.maxTokens
            };

            // 工具定义
            if (opts.tools && opts.tools.length > 0) {
                body.tools = this._convertTools(opts.tools);
                if (opts.tool_choice) {
                    if (typeof opts.tool_choice === 'string') {
                        body.tool_choice = opts.tool_choice;
                    } else if (opts.tool_choice.type === 'auto') {
                        body.tool_choice = 'auto';
                    } else if (opts.tool_choice.type === 'tool') {
                        body.tool_choice = { type: 'function', function: { name: opts.tool_choice.name } };
                    }
                }
            }

            const headers = {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json'
            };

            const axiosOpts = { headers, timeout: 120000 };
            if (opts.signal) axiosOpts.signal = opts.signal;

            const response = await axios.post(this.baseUrl, body, axiosOpts);
            return this._parseResponse(response.data);
        } catch (error) {
            console.error('[OpenAIAdapter] Chat error:', 
                error.response ? error.response.data : error.message);
            throw error;
        }
    }

    /**
     * 流式输出（OpenAI 协议）
     * OpenAI 流式格式：
     * - 文本：data.choices[0].delta.content
     * - 工具调用：data.choices[0].delta.tool_calls[].function.arguments（增量JSON）
     */
    async chatStream(messages, opts = {}, onChunk) {
        try {
            const openaiMessages = this._convertMessages(messages);

            const body = {
                model: this.model,
                messages: openaiMessages,
                max_tokens: opts.maxTokens || this.maxTokens,
                stream: true
            };

            if (opts.tools && opts.tools.length > 0) {
                body.tools = this._convertTools(opts.tools);
                body.tool_choice = opts.tool_choice || 'auto';
            }

            const headers = {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json'
            };

            const axiosOpts = { 
                headers,
                responseType: 'stream',
                timeout: 300000 // 5分钟超时（大上下文场景需要更长时间）
            };
            if (opts.signal) axiosOpts.signal = opts.signal;

            const response = await axios.post(this.baseUrl, body, axiosOpts);

            let fullText = '';
            const toolCalls = []; // { id, name, _arguments, input }
            let stopReason = 'end_turn';
            let usage = { input: 0, output: 0 };

            return new Promise((resolve, reject) => {
                const stream = response.data;

                stream.on('data', (chunk) => {
                    try {
                        const chunkStr = chunk.toString('utf-8');
                        const lines = chunkStr.split('\n').filter(line => line.trim());

                        for (const line of lines) {
                            if (line.startsWith('data: ')) {
                                const jsonStr = line.slice(6);
                                if (jsonStr === '[DONE]') continue;

                                try {
                                    const data = JSON.parse(jsonStr);
                                    const delta = data.choices?.[0]?.delta;
                                    const finishReason = data.choices?.[0]?.finish_reason;

                                    // 文本增量
                                    if (delta?.content) {
                                        const text = delta.content;
                                        fullText += text;
                                        if (onChunk) {
                                            onChunk({
                                                type: 'text',
                                                text: text,
                                                fullText: fullText
                                            });
                                        }
                                    }

                                    // 工具调用增量
                                    if (delta?.tool_calls) {
                                        for (const tcDelta of delta.tool_calls) {
                                            const idx = tcDelta.index;
                                            
                                            // 初始化工具调用槽位
                                            if (!toolCalls[idx]) {
                                                toolCalls[idx] = {
                                                    id: tcDelta.id || `tc_${idx}`,
                                                    name: '',
                                                    _arguments: '',
                                                    input: {}
                                                };
                                            }

                                            // 更新 ID 和 name（首次出现）
                                            if (tcDelta.id) toolCalls[idx].id = tcDelta.id;
                                            if (tcDelta.function?.name) {
                                                toolCalls[idx].name = tcDelta.function.name;
                                            }

                                            // 累积 arguments JSON
                                            if (tcDelta.function?.arguments) {
                                                toolCalls[idx]._arguments += tcDelta.function.arguments;
                                            }
                                        }
                                    }

                                    // 结束原因
                                    if (finishReason) {
                                        stopReason = finishReason === 'tool_calls' ? 'tool_use' : 
                                                     finishReason === 'length' ? 'max_tokens' : 'end_turn';
                                    }

                                    // usage（可能在使用流式 usage 扩展时出现）
                                    if (data.usage) {
                                        usage = {
                                            input: data.usage.prompt_tokens || usage.input,
                                            output: data.usage.completion_tokens || usage.output
                                        };
                                    }
                                } catch (parseError) {
                                    // 忽略解析错误
                                }
                            }
                        }
                    } catch (err) {
                        console.error('[OpenAIAdapter] Stream data error:', err);
                    }
                });

                stream.on('end', () => {
                    // 解析工具调用的 arguments JSON
                    for (const tc of toolCalls) {
                        if (tc._arguments) {
                            try {
                                tc.input = JSON.parse(tc._arguments);
                            } catch (e) {
                                console.error('[OpenAIAdapter] Failed to parse tool arguments:', tc._arguments);
                                tc.input = {};
                            }
                            delete tc._arguments;
                        }
                    }

                    console.log('[OpenAIAdapter] Stream ended, fullText length:', fullText.length, 'toolCalls:', toolCalls.length);

                    // GLM 等模型在 tools 模式下可能不返回 delta.content，导致 fullText 为空
                    // 这里自动降级到非流式 chat() 重试一次，避免用户看到空回复
                    if (!fullText && toolCalls.length === 0 && opts.tools && opts.tools.length > 0) {
                        console.log('[OpenAIAdapter] Stream empty with tools, fallback to non-streaming chat()');
                        this.chat(messages, opts).then(resolve).catch(reject);
                        return;
                    }

                    resolve({
                        text: fullText,
                        toolCalls: toolCalls,
                        stopReason: stopReason,
                        usage: usage
                    });
                });

                stream.on('error', (error) => {
                    console.error('[OpenAIAdapter] Stream error:', error);
                    reject(error);
                });
            });

        } catch (error) {
            console.error('[OpenAIAdapter] ChatStream error:', 
                error.response ? error.response.data : error.message);
            throw error;
        }
    }
}

module.exports = OpenAIAdapter;
