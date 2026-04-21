// modules/app-executor.js — 应用执行器（带权限控制）
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const messageBus = require('../core/message-bus');
const permissionManager = require('../core/permission-manager');
const logger = require('../core/logger');

class AppExecutor {
    constructor() {
        this.openedApps = new Map();
        this.executionHistory = [];
        
        messageBus.subscribe('EXECUTE', (data) => {
            if (data.moduleName === 'app') {
                this._execute(data.params);
            }
        });
    }
    
    /**
     * 执行应用操作
     */
    async _execute(rawParams) {
        try {
            const params = typeof rawParams === 'string' ? JSON.parse(rawParams) : rawParams;
            const { action, appName, args = [] } = params;
            
            if (action === 'open') {
                await this._openApp(appName, args);
            } else if (action === 'list') {
                this._listAllowedApps();
            } else if (action === 'close') {
                this._closeApp(appName);
            } else {
                throw new Error(`未知操作: ${action}`);
            }
            
        } catch (error) {
            logger.error('APP_EXECUTOR', '应用操作失败', { error: error.message });
            
            messageBus.publish('EXECUTE_RESULT', {
                module: 'app',
                status: 'error',
                error: error.message
            });
        }
    }
    
    /**
     * 打开应用
     */
    async _openApp(appName, args = []) {
        // 权限检查
        const permission = permissionManager.checkAppAccess(appName);
        
        if (!permission.allowed) {
            const error = `权限拒绝: ${permission.reason}`;
            logger.warn('APP_EXECUTOR', '应用调用被拒绝', { appName, reason: permission.reason });
            
            messageBus.publish('EXECUTE_RESULT', {
                module: 'app',
                status: 'denied',
                error,
                appName
            });
            return;
        }
        
        // 需要用户确认
        if (permission.needsConfirmation) {
            logger.info('APP_EXECUTOR', '应用需要确认', { appName });
            
            const confirmed = await this._waitForConfirmation({
                type: 'app_open',
                appName,
                description: permission.description,
                path: permission.path
            });
            
            if (!confirmed) {
                messageBus.publish('EXECUTE_RESULT', {
                    module: 'app',
                    status: 'denied',
                    error: '用户拒绝打开应用',
                    appName
                });
                return;
            }
        }
        
        // 检查应用路径是否存在
        const appPath = permission.path;
        if (!fs.existsSync(appPath)) {
            throw new Error(`应用不存在: ${appPath}`);
        }
        
        // 打开应用
        logger.info('APP_EXECUTOR', '打开应用', { appName, path: appPath });
        
        const processId = await this._launchApp(appPath, args);
        
        // 记录
        this.openedApps.set(appName, {
            processId,
            path: appPath,
            openedAt: new Date().toISOString()
        });
        
        this._recordExecution('open', appName, permission.description);
        
        messageBus.publish('EXECUTE_RESULT', {
            module: 'app',
            status: 'success',
            result: `已打开应用: ${appName}`,
            appName,
            processId
        });
    }
    
    /**
     * 启动应用（macOS使用open命令）
     */
    _launchApp(appPath, args = []) {
        return new Promise((resolve, reject) => {
            const openArgs = [appPath];
            
            // 如果有参数，添加 --args 标志
            if (args.length > 0) {
                openArgs.push('--args', ...args);
            }
            
            const process = spawn('open', openArgs);
            
            let processId = null;
            
            process.on('error', (err) => {
                reject(new Error(`打开应用失败: ${err.message}`));
            });
            
            process.on('exit', (code) => {
                if (code === 0) {
                    resolve(processId);
                } else {
                    reject(new Error(`应用退出码: ${code}`));
                }
            });
            
            // 获取进程ID
            setTimeout(() => {
                processId = process.pid;
                resolve(processId);
            }, 1000);
        });
    }
    
    /**
     * 等待用户确认
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
            
            // 30 秒超时自动批准
            setTimeout(() => {
                messageBus.unsubscribe('CONFIRMATION_RESULT', handler);
                logger.warn('APP_EXECUTOR', '确认超时，自动批准', { appName: request.appName });
                resolve(true);
            }, 30000);
        });
    }
    
    /**
     * 列出允许的应用
     */
    _listAllowedApps() {
        const apps = permissionManager.config.appExecution.allowedApps;
        
        messageBus.publish('EXECUTE_RESULT', {
            module: 'app',
            status: 'success',
            result: apps,
            action: 'list'
        });
    }
    
    /**
     * 关闭应用
     */
    _closeApp(appName) {
        if (!this.openedApps.has(appName)) {
            messageBus.publish('EXECUTE_RESULT', {
                module: 'app',
                status: 'error',
                error: `应用未打开: ${appName}`
            });
            return;
        }
        
        // macOS使用 pkill 关闭应用
        const process = spawn('pkill', ['-f', appName]);
        
        process.on('exit', (code) => {
            if (code === 0) {
                this.openedApps.delete(appName);
                logger.info('APP_EXECUTOR', '已关闭应用', { appName });
                
                messageBus.publish('EXECUTE_RESULT', {
                    module: 'app',
                    status: 'success',
                    result: `已关闭应用: ${appName}`,
                    action: 'close'
                });
            }
        });
    }
    
    /**
     * 记录执行历史
     */
    _recordExecution(action, appName, description) {
        const record = {
            timestamp: new Date().toISOString(),
            action,
            appName,
            description,
            success: true
        };
        
        this.executionHistory.push(record);
        
        // 保持最近50条记录
        if (this.executionHistory.length > 50) {
            this.executionHistory.shift();
        }
        
        // 写入审计日志
        if (permissionManager.config.security.auditLog) {
            logger.info('AUDIT', '应用操作', record);
        }
    }
    
    /**
     * 获取执行历史
     */
    getHistory() {
        return this.executionHistory;
    }
    
    /**
     * 获取当前打开的应用
     */
    getOpenedApps() {
        return Array.from(this.openedApps.entries()).map(([name, info]) => ({
            name,
            ...info
        }));
    }
}

module.exports = new AppExecutor();
