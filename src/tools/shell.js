// tools/shell.js - Shell 和应用工具
const registry = require('./index');
const messageBus = require('../core/message-bus');

/**
 * Shell 命令执行工具
 */
registry.register(
    'shell_execute',
    {
        description: '执行系统命令（需要权限，部分命令需要用户确认）。**禁止用于读写文件**，读写文件请用 file_read / file_write 工具。',
        parameters: {
            type: 'object',
            properties: {
                command: {
                    type: 'string',
                    description: '要执行的命令'
                },
                cwd: {
                    type: 'string',
                    description: '工作目录（可选）'
                }
            },
            required: ['command']
        }
    },
    async (params, context) => {
        const { command } = params;
        const cwd = params.cwd || context.workFolder || undefined;
        
        console.log('[shell_execute] 执行命令:', command, 'cwd:', cwd);
        
        return new Promise((resolve) => {
            let resolved = false;
            const handler = (data) => {
                if (resolved) return;
                console.log('[shell_execute] 收到 EXECUTE_RESULT:', JSON.stringify(data).slice(0, 500));
                
                if (data.module === 'shell') {
                    resolved = true;
                    messageBus.unsubscribe('EXECUTE_RESULT', handler);
                    const output = data.status === 'success'
                        ? String(data.result || '').trim()
                        : `命令执行失败: ${data.error}`;
                    console.log('[shell_execute] 返回结果长度:', output.length, '前200字符:', output.slice(0, 200));
                    resolve(output);
                }
            };
            
            messageBus.subscribe('EXECUTE_RESULT', handler);
            messageBus.publish('EXECUTE', {
                moduleName: 'shell',
                params: { command, cwd }
            });
            
            // 超时处理
            setTimeout(() => {
                if (resolved) return;
                resolved = true;
                messageBus.unsubscribe('EXECUTE_RESULT', handler);
                resolve('命令执行超时（15000ms）');
            }, 15000);
        });
    },
    {
        icon: '💻',
        label: '执行命令'
    }
);

/**
 * 打开应用工具
 */
registry.register(
    'app_open',
    {
        description: '打开本地应用程序（需要权限）',
        parameters: {
            type: 'object',
            properties: {
                appName: {
                    type: 'string',
                    description: '应用名称（如 Safari、VSCode、Finder）'
                },
                args: {
                    type: 'array',
                    items: { type: 'string' },
                    description: '应用参数（可选）'
                }
            },
            required: ['appName']
        }
    },
    async (params, context) => {
        return new Promise((resolve) => {
            const handler = (data) => {
                if (data.module === 'app') {
                    messageBus.unsubscribe('EXECUTE_RESULT', handler);
                    resolve(data.status === 'success'
                        ? `应用已打开: ${params.appName}`
                        : `打开应用失败: ${data.error}`);
                }
            };
            
            messageBus.subscribe('EXECUTE_RESULT', handler);
            messageBus.publish('EXECUTE', {
                moduleName: 'app',
                params: { action: 'open', ...params }
            });
            
            setTimeout(() => {
                messageBus.unsubscribe('EXECUTE_RESULT', handler);
                resolve('打开应用超时');
            }, 10000);
        });
    },
    {
        icon: '📱',
        label: '打开应用'
    }
);
