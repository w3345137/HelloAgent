// tools/index.js - 工具注册中心
// 参考 Hermes Agent 的自注册模式：
// tools/ 目录下的工具文件通过 registry.register() 自动注册
// 新增 autoLoad() 方法，启动时自动扫描目录加载所有工具
const fs = require('fs');
const path = require('path');

/**
 * 工具注册表
 * 管理所有工具的定义、schema和执行器
 */
class ToolRegistry {
    constructor() {
        this.tools = new Map();
        this.labels = new Map();
        this._loaded = false;
        this._vendorTools = new Map();
    }

    register(name, schema, handler, meta = {}) {
        this.tools.set(name, { schema, handler });
        this.labels.set(name, {
            icon: meta.icon || '🔧',
            label: meta.label || name
        });
        console.log(`[ToolRegistry] Registered: ${name}`);
    }

    registerVendorTool(name, schema, handler, meta = {}) {
        this.tools.set(name, { schema, handler, isVendor: true });
        this.labels.set(name, {
            icon: meta.icon || '🔧',
            label: meta.label || name
        });
        this._vendorTools.set(name, meta.vendor || 'unknown');
        console.log(`[ToolRegistry] Registered vendor tool: ${name} (${meta.vendor || 'unknown'})`);
    }

    /**
     * 自动加载 tools/ 目录下所有工具文件
     * 参考 Hermes 的自注册架构：每个工具是独立模块，import 时自动注册
     * 新增工具只需加文件，不需修改此文件
     */
    autoLoad() {
        if (this._loaded) return;
        this._loaded = true;

        const toolsDir = __dirname;
        
        try {
            const files = fs.readdirSync(toolsDir)
                .filter(f => f.endsWith('.js') && f !== 'index.js');

            for (const file of files) {
                try {
                    require(path.join(toolsDir, file));
                } catch (err) {
                    console.error(`[ToolRegistry] Failed to load ${file}: ${err.message}`);
                }
            }

            console.log(`[ToolRegistry] Auto-loaded ${this.tools.size} tools: ${this.list().join(', ')}`);
        } catch (err) {
            console.error(`[ToolRegistry] Auto-load failed: ${err.message}`);
        }
    }

    /**
     * 获取工具定义（用于传给AI）
     */
    getToolDefinitions() {
        const vendorAvailable = this._checkVendorAvailability();
        
        return Array.from(this.tools.entries())
            .filter(([name, tool]) => {
                if (!tool.isVendor) return true;
                const vendor = this._vendorTools.get(name);
                return vendorAvailable[vendor] === true;
            })
            .map(([name, { schema }]) => ({
                name,
                description: schema.description,
                parameters: schema.parameters
            }));
    }

    _checkVendorAvailability() {
        const availability = {};
        try {
            const configDir = path.join(__dirname, '..', 'config');
            const modelsPath = path.join(configDir, 'models.json');
            const mainConfigPath = path.join(configDir, '..', 'config.json');
            
            let mainConfig = {};
            if (fs.existsSync(mainConfigPath)) {
                mainConfig = JSON.parse(fs.readFileSync(mainConfigPath, 'utf-8'));
            }

            let models = [];
            if (fs.existsSync(modelsPath)) {
                models = JSON.parse(fs.readFileSync(modelsPath, 'utf-8'));
            }

            const minimaxModel = models.find(m => m.id === 'Minimax-2.7' || (m.endpoint && m.endpoint.includes('minimax')));
            availability.minimax = !!(minimaxModel?.apiKey || mainConfig.minimaxApiKey);

            const zhipuModel = models.find(m => m.endpoint && m.endpoint.includes('bigmodel'));
            availability.zhipu = !!(zhipuModel?.apiKey || mainConfig.zhipuApiKey);
        } catch {
            availability.minimax = false;
            availability.zhipu = false;
        }
        return availability;
    }

    /**
     * 获取工具标签（用于前端显示）
     */
    getToolLabels() {
        const result = {};
        for (const [name, meta] of this.labels.entries()) {
            result[name] = meta;
        }
        return result;
    }

    /**
     * 执行工具
     * @param {string} name - 工具名
     * @param {object} params - 工具参数
     * @param {object} context - 执行上下文（messageBus, workFolder等）
     * @returns {Promise<string>} - 执行结果
     */
    async execute(name, params, context = {}) {
        const tool = this.tools.get(name);
        if (!tool) {
            return `未知工具: ${name}`;
        }

        try {
            const result = await tool.handler(params, context);
            return result;
        } catch (error) {
            console.error(`[ToolRegistry] Tool ${name} error:`, error);
            return `工具执行错误: ${error.message}`;
        }
    }

    /**
     * 检查工具是否存在
     */
    has(name) {
        return this.tools.has(name);
    }

    /**
     * 列出所有工具名
     */
    list() {
        return Array.from(this.tools.keys());
    }
}

// 全局单例
const registry = new ToolRegistry();

module.exports = registry;
