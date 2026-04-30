// modules/adapters/base-adapter.js
// 模型适配器基础接口

/**
 * 统一消息格式（内部使用）
 * @typedef {Object} Message
 * @property {'system'|'user'|'assistant'} role - 消息角色
 * @property {string|Array} content - 消息内容（string 或 content blocks）
 */

/**
 * 统一工具定义格式（内部使用）
 * @typedef {Object} ToolDef
 * @property {string} name - 工具名称
 * @property {string} description - 工具描述
 * @property {Object} parameters - 参数定义（JSON Schema）
 */

/**
 * 统一工具调用格式（内部使用）
 * @typedef {Object} ToolCall
 * @property {string} id - 工具调用 ID
 * @property {string} name - 工具名称
 * @property {Object} input - 工具输入参数
 */

/**
 * 统一响应格式（内部使用）
 * @typedef {Object} ChatResponse
 * @property {string} text - 文本回复
 * @property {Array<ToolCall>} toolCalls - 工具调用列表
 * @property {string} stopReason - 停止原因 ('end_turn'|'tool_use'|'max_tokens')
 * @property {Object} usage - Token 使用统计
 * @property {string} [reasoningContent] - 思考链内容（DeepSeek 等模型）
 */

class BaseAdapter {
    constructor(config) {
        this.config = config;
        this.name = 'base';
    }

    /**
     * 发送聊天请求
     * @param {Array<Message>} messages - 消息列表
     * @param {Object} opts - 选项
     * @param {AbortSignal} opts.signal - 中断信号
     * @param {Array<ToolDef>} opts.tools - 工具定义列表
     * @param {string|Object} opts.tool_choice - 工具选择策略
     * @returns {Promise<ChatResponse>}
     */
    async chat(messages, opts = {}) {
        throw new Error('chat() must be implemented by subclass');
    }

    /**
     * 测试连接
     * @returns {Promise<boolean>}
     */
    async test() {
        try {
            const result = await this.chat([
                { role: 'user', content: 'Say "OK" if you can hear me.' }
            ], { maxTokens: 10 });
            return result.text.length > 0;
        } catch (error) {
            console.error(`[${this.name}] Test failed:`, error.message);
            return false;
        }
    }

    /**
     * 检测模型限制：连接状态和最大输出 token
     * @returns {Promise<{connected: boolean, maxTokens: number, error?: string}>}
     */
    async detectLimits() {
        // 先测试基本连接
        try {
            await this.chat([{ role: 'user', content: 'Hi' }], { maxTokens: 1, signal: undefined });
        } catch (e) {
            return { connected: false, maxTokens: 4096, error: e.message };
        }

        const knownLimits = {
            'gpt-4o': 16384,
            'gpt-4o-mini': 16384,
            'gpt-4-turbo': 4096,
            'gpt-4': 8192,
            'gpt-3.5-turbo': 4096,
            'claude-3-5-sonnet': 8192,
            'claude-3-opus': 4096,
            'claude-3-sonnet': 4096,
            'claude-3-haiku': 4096,
            'MiniMax-Text-01': 128000,
            'deepseek-chat': 8192,
            'deepseek-reasoner': 8192
        };

        const modelLower = (this.config.model || '').toLowerCase();
        for (const [modelPrefix, limit] of Object.entries(knownLimits)) {
            if (modelLower.includes(modelPrefix.toLowerCase())) {
                return { connected: true, maxTokens: limit, error: null };
            }
        }

        return { connected: true, maxTokens: 4096, error: null };
    }
}

module.exports = BaseAdapter;
