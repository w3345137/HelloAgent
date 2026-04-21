// modules/adapters/adapter-factory.js
// 模型适配器工厂 - 根据配置自动选择协议
const crypto = require('crypto');
const AnthropicAdapter = require('./anthropic-adapter');
const OpenAIAdapter = require('./openai-adapter');

/**
 * 模型配置格式
 * @typedef {Object} ModelConfig
 * @property {string} id - 模型唯一标识
 * @property {string} name - 显示名称
 * @property {string} protocol - 协议类型 ('anthropic' | 'openai')
 * @property {string} endpoint - API 端点
 * @property {string} apiKey - API Key
 * @property {string} model - 模型标识（用于 API 请求）
 * @property {number} [maxTokens] - 最大 token 数
 */

// 内置模型预设（精简版，用户可通过前端添加更多）
const BUILT_IN_MODELS = {
    'minimax-m2.7': {
        id: 'minimax-m2.7',
        name: 'MiniMax-M2.7',
        protocol: 'anthropic',
        endpoint: 'https://api.minimaxi.com/anthropic/v1/messages',
        model: 'Minimax-2.7'
    },
    'gpt-4o': {
        id: 'gpt-4o',
        name: 'GPT-4o',
        protocol: 'openai',
        endpoint: 'https://api.openai.com/v1/chat/completions',
        model: 'gpt-4o'
    },
    'claude-3-sonnet': {
        id: 'claude-3-sonnet',
        name: 'Claude 3 Sonnet',
        protocol: 'anthropic',
        endpoint: 'https://api.anthropic.com/v1/messages',
        model: 'claude-3-sonnet-20240229'
    }
};

class AdapterFactory {
    constructor() {
        this.adapters = new Map(); // 缓存已创建的适配器
    }

    /**
     * 获取内置模型列表
     */
    getBuiltInModels() {
        return Object.values(BUILT_IN_MODELS);
    }

    /**
     * 根据配置创建适配器
     * @param {ModelConfig} config - 模型配置
     * @returns {BaseAdapter} 适配器实例
     */
    createAdapter(config) {
        // 合并内置预设
        const preset = BUILT_IN_MODELS[config.id] || {};
        const mergedConfig = { ...preset, ...config };

        // 检查缓存
        const apiKeyHash = crypto.createHash('md5').update(mergedConfig.apiKey || '').digest('hex').substring(0, 8);
        const cacheKey = `${mergedConfig.protocol}:${mergedConfig.endpoint}:${mergedConfig.model}:${apiKeyHash}`;
        if (this.adapters.has(cacheKey)) {
            return this.adapters.get(cacheKey);
        }

        // 根据协议创建适配器
        let adapter;
        switch (mergedConfig.protocol) {
            case 'anthropic':
                adapter = new AnthropicAdapter(mergedConfig);
                break;
            case 'openai':
                adapter = new OpenAIAdapter(mergedConfig);
                break;
            default:
                // 自动检测协议
                if (mergedConfig.endpoint?.includes('anthropic') || 
                    mergedConfig.endpoint?.includes('minimax')) {
                    adapter = new AnthropicAdapter(mergedConfig);
                } else {
                    adapter = new OpenAIAdapter(mergedConfig);
                }
        }

        // 缓存适配器
        this.adapters.set(cacheKey, adapter);
        console.log(`[AdapterFactory] Created ${adapter.name} adapter for ${mergedConfig.name}`);
        
        return adapter;
    }

    /**
     * 检测协议类型
     * @param {string} endpoint - API 端点
     * @returns {string} 协议类型
     */
    detectProtocol(endpoint) {
        if (!endpoint) return 'openai';
        
        const lower = endpoint.toLowerCase();
        if (lower.includes('anthropic') || lower.includes('minimax')) {
            return 'anthropic';
        }
        return 'openai';
    }

    /**
     * 清除缓存
     */
    clearCache() {
        this.adapters.clear();
    }
}

// 单例
module.exports = new AdapterFactory();
