// core/executor.js — 执行调度器
const messageBus = require('./message-bus');
const stateMachine = require('./state-machine');
const logger = require('./logger');

// 动态加载执行模块
const fileExecutor = require('../modules/file-executor');
const httpExecutor = require('../modules/http-executor');

class Executor {
    constructor() {
        // 执行模块注册表
        this.modules = {
            'file': fileExecutor,
            'http': httpExecutor
        };

        // 监听 EXECUTE 事件，分发到对应模块
        messageBus.subscribe('EXECUTE', async ({ moduleName, params }) => {
            // 只处理已注册的模块，其他模块（如 Brain 直接处理的工具）静默忽略
            const module = this.modules[moduleName];
            if (!module) {
                return;
            }

            console.log(`[Executor] Dispatching to module: ${moduleName}`);
            logger.execute(moduleName, params);

            // 执行模块
            const timeoutId = setTimeout(() => {
                console.error(`[Executor] Module "${moduleName}" timed out`);
                logger.error('EXECUTE', `Module ${moduleName} timed out`);
                messageBus.publish('ERROR', {
                    module: moduleName,
                    message: `Execution timeout for module: ${moduleName}`
                });
            }, 30000); // 30 秒超时

            try {
                const result = await module.execute(params);
                clearTimeout(timeoutId);
                logger.executeResult(moduleName, result);
                messageBus.publish('EXECUTE_RESULT', {
                    module: moduleName,
                    status: 'success',
                    result
                });
            } catch (error) {
                clearTimeout(timeoutId);
                console.error(`[Executor] Module error: ${error.message}`);
                logger.errorDetail(`Module ${moduleName}`, error);
                messageBus.publish('ERROR', {
                    module: moduleName,
                    message: error.message
                });
            }
        });

        // 执行完成日志（状态转换由 Brain.process 的 finally 统一管理）
        messageBus.subscribe('EXECUTE_RESULT', ({ status, module }) => {
            // 只记录由 Executor 自身分发的模块结果
            if (this.modules[module]) {
                console.log(`[Executor] Execution completed: ${module} (${status})`);
                logger.system(`执行完成: ${module}`);
            }
        });

        // 错误处理日志
        messageBus.subscribe('ERROR', ({ message, module }) => {
            console.error(`[Executor] Error: ${message}`);
            logger.error('EXECUTE', `Module ${module}: ${message}`);
        });
    }

    /**
     * 注册新模块
     */
    register(name, module) {
        this.modules[name] = module;
        logger.system(`模块注册: ${name}`);
    }
}

module.exports = new Executor();
