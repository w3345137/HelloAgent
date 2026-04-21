// modules/adapters/anthropic-adapter.js
// Anthropic 协议适配器（兼容 MiniMax Anthropic 接口）
const axios = require('axios');
const BaseAdapter = require('./base-adapter');

class AnthropicAdapter extends BaseAdapter {
    constructor(config) {
        super(config);
        this.name = 'anthropic';
        this.apiKey = config.apiKey;
        // 自动补全 endpoint 路径
        // Anthropic API 路径格式: POST /v1/messages
        // MiniMax 兼容格式: https://api.minimaxi.com/anthropic/v1/messages
        let endpoint = config.endpoint || 'https://api.anthropic.com/v1/messages';
        
        // 如果 endpoint 不包含 /v1/messages，自动补全
        if (!endpoint.includes('/v1/messages')) {
            // 移除末尾斜杠，然后添加 /v1/messages
            endpoint = endpoint.replace(/\/+$/, '') + '/v1/messages';
        }
        
        this.baseUrl = endpoint;
        this.model = config.model || 'claude-3-sonnet-20240229';
        this.maxTokens = config.maxTokens || 128000;
        console.log(`[AnthropicAdapter] baseUrl resolved: ${this.baseUrl}`);
    }

    /**
     * 转换内部工具定义为 Anthropic 格式
     */
    _convertTools(tools) {
        if (!tools || tools.length === 0) return undefined;
        return tools.map(tool => ({
            name: tool.name,
            description: tool.description,
            input_schema: tool.parameters || { type: 'object', properties: {} }
        }));
    }

    /**
     * 转换内部消息为 Anthropic 格式
     */
    _convertMessages(messages) {
        let systemText = '';
        const anthropicMessages = [];

        for (const msg of messages) {
            const role = (msg.role || '').toLowerCase();
            
            if (role === 'system') {
                systemText += (systemText ? '\n' : '') + (msg.text || msg.content || '');
            } else {
                const r = role === 'user' ? 'user' : 'assistant';
                const c = msg.content || msg.text || '';
                anthropicMessages.push({ role: r, content: c });
            }
        }

        return { systemText, anthropicMessages };
    }

    /**
     * 解析 Anthropic 响应为统一格式
     */
    _parseResponse(data) {
        const contentBlocks = data.content || [];
        
        const textParts = contentBlocks
            .filter(c => c.type === 'text')
            .map(c => c.text);
        let text = textParts.join('\n').trim();

        let toolCalls = contentBlocks
            .filter(c => c.type === 'tool_use')
            .map(c => ({
                id: c.id,
                name: c.name,
                input: c.input
            }));

        if (toolCalls.length === 0 && text.includes('<minimax:tool_call')) {
            const extracted = this._extractMiniMaxToolCalls(text);
            if (extracted.length > 0) {
                toolCalls = extracted;
                console.log('[AnthropicAdapter] Extracted MiniMax XML tool_calls from text:', extracted.length);
            }
        }

        text = this._filterToolCallXML(text);

        let stopReason = data.stop_reason || 'end_turn';
        if (toolCalls.length > 0 && stopReason === 'end_turn') {
            stopReason = 'tool_use';
        }

        return {
            text,
            toolCalls,
            stopReason,
            usage: {
                input: data.usage?.input_tokens || 0,
                output: data.usage?.output_tokens || 0
            }
        };
    }
    
    _extractMiniMaxToolCalls(text) {
        const toolCalls = [];
        let idx = 0;

        const regex2 = /<minimax:tool_call[^>]*>\s*<invoke\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/invoke>\s*<\/minimax:tool_call>/g;
        let match;
        while ((match = regex2.exec(text)) !== null) {
            const name = match[1];
            const paramsBlock = match[2];
            const input = {};
            const paramRegex = /<parameter\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/parameter>/g;
            let paramMatch;
            while ((paramMatch = paramRegex.exec(paramsBlock)) !== null) {
                input[paramMatch[1]] = paramMatch[2].trim();
            }
            toolCalls.push({ id: `minimax_tc_${++idx}`, name, input });
        }

        const regex1 = /<minimax:tool_call\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/minimax:tool_call>/g;
        while ((match = regex1.exec(text)) !== null) {
            const name = match[1];
            const argsStr = match[2].trim();
            if (argsStr.startsWith('<invoke')) continue;
            const input = this._safeParseJSON(argsStr);
            toolCalls.push({ id: `minimax_tc_${++idx}`, name, input });
        }

        return toolCalls;
    }

    _safeParseJSON(str) {
        try {
            return JSON.parse(str);
        } catch {
            return {};
        }
    }

    /**
     * 过滤文本中的XML工具调用标签（MiniMax兼容）
     * MiniMax模型有时会在文本中重复输出工具调用XML
     */
    _filterToolCallXML(text) {
        if (!text) return text;
        
        // 过滤各种工具调用XML格式
        const patterns = [
            /<minimax:tool_call[^>]*>[\s\S]*?<\/minimax:tool_call>/gi,
            /<tool_call[^>]*>[\s\S]*?<\/tool_call>/gi,
            /<\w+:tool_use[^>]*>[\s\S]*?<\/\w+:tool_use>/gi
        ];
        
        for (const pattern of patterns) {
            text = text.replace(pattern, '');
        }
        
        // 清理多余的空行
        text = text.replace(/\n{3,}/g, '\n\n').trim();
        
        return text;
    }

    async chat(messages, opts = {}) {
        try {
            const { systemText, anthropicMessages } = this._convertMessages(messages);

            const body = {
                model: this.model,
                max_tokens: opts.maxTokens || this.maxTokens,
                messages: anthropicMessages
            };

            if (systemText) {
                body.system = systemText;
            }

            // 工具定义
            if (opts.tools && opts.tools.length > 0) {
                body.tools = this._convertTools(opts.tools);
                body.tool_choice = opts.tool_choice || { type: 'auto' };
            }

            // 请求头
            const headers = {
                'x-api-key': this.apiKey,
                'anthropic-version': '2023-06-01',
                'Content-Type': 'application/json'
            };

            // MiniMax 兼容：使用不同的 header
            if (this.baseUrl.includes('minimax')) {
                headers['Authorization'] = `Bearer ${this.apiKey}`;
                delete headers['x-api-key'];
            }

            const axiosOpts = { headers };
            if (opts.signal) axiosOpts.signal = opts.signal;

            const response = await axios.post(this.baseUrl, body, axiosOpts);
            return this._parseResponse(response.data);
        } catch (error) {
            console.error('[AnthropicAdapter] Chat error:', 
                error.response ? error.response.data : error.message);
            throw error;
        }
    }
    
    /**
     * 流式对话（支持逐字输出）
     * 策略：文字部分流式输出，检测到工具调用时切换到非流式
     * @param {Array} messages - 消息历史
     * @param {Object} opts - 选项
     * @param {Function} onChunk - 每个chunk的回调 (chunk) => void
     * @returns {Promise<Object>} - 最终结果
     */
    async chatStream(messages, opts = {}, onChunk) {
        try {
            const { systemText, anthropicMessages } = this._convertMessages(messages);

            const body = {
                model: this.model,
                max_tokens: opts.maxTokens || this.maxTokens,
                messages: anthropicMessages,
                stream: true // 启用流式输出
            };

            if (systemText) {
                body.system = systemText;
            }

            // 工具定义
            if (opts.tools && opts.tools.length > 0) {
                body.tools = this._convertTools(opts.tools);
                body.tool_choice = opts.tool_choice || { type: 'auto' };
            }

            // 请求头
            const headers = {
                'x-api-key': this.apiKey,
                'anthropic-version': '2023-06-01',
                'Content-Type': 'application/json'
            };

            // MiniMax 兼容
            if (this.baseUrl.includes('minimax')) {
                headers['Authorization'] = `Bearer ${this.apiKey}`;
                delete headers['x-api-key'];
            }

            const axiosOpts = { 
                headers,
                responseType: 'stream',
                timeout: 300000 // 5分钟超时（大上下文场景需要更长时间）
            };
            if (opts.signal) axiosOpts.signal = opts.signal;

            const response = await axios.post(this.baseUrl, body, axiosOpts);
            
            // 收集完整响应
            let fullText = '';
            let hasToolCall = false;
            let minimaxToolCallDetected = false;
            
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
                                    
                                    if (data.type === 'content_block_start' && 
                                        data.content_block?.type === 'tool_use') {
                                        hasToolCall = true;
                                        console.log('[AnthropicAdapter] Tool call detected, switching to non-streaming...');
                                        
                                        stream.destroy();
                                        
                                        const nonStreamingOpts = { ...opts, signal: undefined };
                                        this.chat(messages, nonStreamingOpts).then(result => {
                                            if (onChunk && result.text) {
                                                onChunk({
                                                    type: 'text',
                                                    text: result.text,
                                                    fullText: result.text
                                                });
                                            }
                                            resolve(result);
                                        }).catch(err => {
                                            console.error('[AnthropicAdapter] Non-streaming fallback failed:', err.message);
                                            reject(err);
                                        });
                                        return;
                                    }
                                    
                                    if (!hasToolCall && data.type === 'content_block_delta') {
                                        const delta = data.delta;
                                        if (delta && delta.type === 'text_delta') {
                                            const text = delta.text || '';
                                            fullText += text;

                                            if (fullText.includes('<minimax:tool_call') && !minimaxToolCallDetected) {
                                                minimaxToolCallDetected = true;
                                                console.log('[AnthropicAdapter] MiniMax XML tool_call detected in stream, collecting...');
                                            }

                                            if (onChunk && !minimaxToolCallDetected) {
                                                onChunk({
                                                    type: 'text',
                                                    text: text,
                                                    fullText: fullText
                                                });
                                            }
                                        }
                                    }
                                    
                                    if (data.type === 'message_delta' && !hasToolCall) {
                                        if (minimaxToolCallDetected) {
                                            const extracted = this._extractMiniMaxToolCalls(fullText);
                                            const cleanText = this._filterToolCallXML(fullText);
                                            if (extracted.length > 0) {
                                                console.log('[AnthropicAdapter] MiniMax XML tool_calls extracted:', extracted.length);
                                                resolve({
                                                    text: cleanText,
                                                    toolCalls: extracted,
                                                    stopReason: 'tool_use',
                                                    usage: data.usage ? {
                                                        input: data.usage.input_tokens || 0,
                                                        output: data.usage.output_tokens || 0
                                                    } : { input: 0, output: 0 }
                                                });
                                                return;
                                            }
                                        }
                                        resolve({
                                            text: this._filterToolCallXML(fullText),
                                            toolCalls: [],
                                            stopReason: data.delta?.stop_reason || 'end_turn',
                                            usage: data.usage ? {
                                                input: data.usage.input_tokens || 0,
                                                output: data.usage.output_tokens || 0
                                            } : { input: 0, output: 0 }
                                        });
                                    }
                                } catch (parseError) {
                                    console.log('[AnthropicAdapter] Parse chunk error:', parseError.message);
                                }
                            }
                        }
                    } catch (err) {
                        console.error('[AnthropicAdapter] Stream data error:', err);
                    }
                });
                
                stream.on('end', () => {
                    if (hasToolCall) return;
                    
                    if (minimaxToolCallDetected) {
                        const extracted = this._extractMiniMaxToolCalls(fullText);
                        const cleanText = this._filterToolCallXML(fullText);
                        if (extracted.length > 0) {
                            console.log('[AnthropicAdapter] MiniMax XML tool_calls extracted at stream end:', extracted.length);
                            resolve({
                                text: cleanText,
                                toolCalls: extracted,
                                stopReason: 'tool_use',
                                usage: { input: 0, output: 0 }
                            });
                            return;
                        }
                    }
                    
                    resolve({
                        text: this._filterToolCallXML(fullText),
                        toolCalls: [],
                        stopReason: 'end_turn',
                        usage: { input: 0, output: 0 }
                    });
                });
                
                stream.on('error', (error) => {
                    if (hasToolCall) return;
                    
                    console.error('[AnthropicAdapter] Stream error:', error);
                    reject(error);
                });
            });
            
        } catch (error) {
            console.error('[AnthropicAdapter] ChatStream error:', 
                error.response ? error.response.data : error.message);
            throw error;
        }
    }
}

module.exports = AnthropicAdapter;
