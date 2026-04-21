// modules/shell-executor.js — 命令执行器（带权限控制）
const { exec, spawn } = require('child_process');
const messageBus = require('../core/message-bus');
const permissionManager = require('../core/permission-manager');
const logger = require('../core/logger');

class ShellExecutor {
    constructor() {
        this.activeProcesses = new Map();
        this.executionHistory = [];
        
        messageBus.subscribe('EXECUTE', (data) => {
            if (data.moduleName === 'shell') {
                this._execute(data.params);
            }
        });
    }
    
    /**
     * 执行命令
     */
    async _execute(rawParams) {
        try {
            let params;
            if (typeof rawParams === 'string') {
                try { params = JSON.parse(rawParams); } catch { params = {}; }
            } else if (rawParams && typeof rawParams === 'object') {
                params = rawParams;
            } else {
                params = {};
            }
            const { command, cwd = process.cwd(), background = false } = params;
            
            console.log('[ShellExecutor] _execute received command:', command);
            
            // 权限检查
            const permission = permissionManager.checkShellCommand(command);
            console.log('[ShellExecutor] permission check:', permission);
            
            if (!permission.allowed) {
                const error = `权限拒绝: ${permission.reason}`;
                logger.warn('SHELL_EXECUTOR', '命令被拒绝', { command, reason: permission.reason });
                
                messageBus.publish('EXECUTE_RESULT', {
                    module: 'shell',
                    status: 'denied',
                    error,
                    command
                });
                return;
            }
            
            // 需要用户确认
            if (permission.needsConfirmation) {
                logger.info('SHELL_EXECUTOR', '命令需要确认', { command, risk: permission.risk });
                
                const confirmed = await this._waitForConfirmation({
                    type: 'shell_command',
                    command,
                    risk: permission.risk,
                    description: permission.description
                });
                
                if (!confirmed) {
                    messageBus.publish('EXECUTE_RESULT', {
                        module: 'shell',
                        status: 'denied',
                        error: '用户拒绝执行',
                        command
                    });
                    return;
                }
            }
            
            // 执行命令
            logger.info('SHELL_EXECUTOR', '执行命令', { command, cwd });
            console.log('[ShellExecutor] running command:', command);
            
            const result = await this._runCommand(command, cwd, background);
            console.log('[ShellExecutor] result:', { exitCode: result.exitCode, stdout: String(result.stdout).slice(0, 200), stderr: String(result.stderr).slice(0, 200) });
            
            // 记录执行历史
            this._recordExecution(command, result, permission.risk);
            
            messageBus.publish('EXECUTE_RESULT', {
                module: 'shell',
                status: 'success',
                result: result.stdout || result.stderr,
                command,
                exitCode: result.exitCode
            });
            
        } catch (error) {
            logger.error('SHELL_EXECUTOR', '命令执行失败', { error: error.message });
            
            messageBus.publish('EXECUTE_RESULT', {
                module: 'shell',
                status: 'error',
                error: error.message
            });
        }
    }
    
    /**
     * 等待用户确认（通过消息总线发送确认请求，等待前端响应）
     * @param {object} request - 确认请求详情
     * @returns {Promise<boolean>} - 用户是否确认
     */
    _waitForConfirmation(request) {
        return new Promise((resolve) => {
            const confirmId = `confirm-${Date.now()}`;
            request.confirmId = confirmId;
            
            const handler = (data) => {
                if (data.confirmId === confirmId) {
                    messageBus.unsubscribe('CONFIRMATION_RESULT', handler);
                    resolve(data.confirmed === true);
                }
            };
            messageBus.subscribe('CONFIRMATION_RESULT', handler);
            messageBus.publish('NEED_CONFIRMATION', request);
            
            // 30 秒超时自动批准（避免无人响应时阻塞）
            setTimeout(() => {
                messageBus.unsubscribe('CONFIRMATION_RESULT', handler);
                logger.warn('SHELL_EXECUTOR', '确认超时，默认拒绝', { command: request.command });
                resolve(false);
            }, 30000);
        });
    }
    
    /**
     * 运行命令
     */
    _runCommand(command, cwd, background = false) {
        return new Promise((resolve, reject) => {
            const timeout = permissionManager.config.shellExecution.timeout || 30000;
            let resolved = false;
            
            const process = exec(command, {
                cwd,
                maxBuffer: 10 * 1024 * 1024
            }, (error, stdout, stderr) => {
                if (resolved) return;
                resolved = true;
                
                if (error && !error.killed) {
                    reject(new Error(`命令执行失败: ${error.message}`));
                } else {
                    resolve({
                        stdout: stdout.trim(),
                        stderr: stderr.trim(),
                        exitCode: error ? error.code : 0
                    });
                }
            });
            
            const processId = Date.now();
            this.activeProcesses.set(processId, process);
            
            process.on('exit', () => {
                this.activeProcesses.delete(processId);
            });
            
            setTimeout(() => {
                if (resolved) return;
                resolved = true;
                if (this.activeProcesses.has(processId)) {
                    process.kill();
                    this.activeProcesses.delete(processId);
                    reject(new Error(`命令执行超时 (${timeout}ms)`));
                }
            }, timeout);
        });
    }
    
    /**
     * 记录执行历史
     */
    _recordExecution(command, result, risk) {
        const record = {
            timestamp: new Date().toISOString(),
            command,
            exitCode: result.exitCode,
            risk,
            success: result.exitCode === 0
        };
        
        this.executionHistory.push(record);
        
        // 保持最近100条记录
        if (this.executionHistory.length > 100) {
            this.executionHistory.shift();
        }
        
        // 写入审计日志
        if (permissionManager.config.security.auditLog) {
            logger.info('AUDIT', '命令执行', record);
        }
    }
    
    /**
     * 获取执行历史
     */
    getHistory() {
        return this.executionHistory;
    }
    
    /**
     * 终止所有活动进程
     */
    killAll() {
        for (const [id, process] of this.activeProcesses) {
            process.kill();
            this.activeProcesses.delete(id);
        }
        logger.info('SHELL_EXECUTOR', '已终止所有活动进程');
    }
}

module.exports = new ShellExecutor();
