// core/permission-manager.js — 权限管理器
const fs = require('fs');
const path = require('path');
const messageBus = require('./message-bus');
const logger = require('./logger');

/**
 * 权限管理器
 * 负责管理系统的所有权限配置
 */
class PermissionManager {
    constructor() {
        this.configPath = path.join(__dirname, '../config/permissions.json');
        this.config = this._loadConfig();
        
        // 监听权限更新事件
        messageBus.subscribe('UPDATE_PERMISSIONS', (data) => {
            this.updatePermissions(data);
        });
        
        messageBus.subscribe('GET_PERMISSIONS', () => {
            messageBus.publish('PERMISSIONS_DATA', this.config);
        });
    }
    
    /**
     * 加载权限配置
     */
    _loadConfig() {
        const defaultConfig = {
            version: '1.0.0',
            lastUpdated: new Date().toISOString(),
            
            // 文件访问权限
            fileAccess: {
                enabled: true,
                mode: 'whitelist', // 'whitelist' | 'blacklist' | 'unrestricted'
                paths: [
                    {
                        path: '~/Desktop',
                        permissions: ['read', 'write', 'delete'],
                        recursive: true
                    },
                    {
                        path: '~/Documents',
                        permissions: ['read', 'write'],
                        recursive: true
                    },
                    {
                        path: '~/Downloads',
                        permissions: ['read'],
                        recursive: false
                    }
                ],
                blockedPaths: [
                    '/System',
                    '/etc',
                    '~/.ssh',
                    '~/.gnupg'
                ],
                maxFileSize: 10 * 1024 * 1024, // 10MB
                allowedExtensions: ['*'] // '*' 表示所有扩展名
            },
            
            // 命令执行权限
            shellExecution: {
                enabled: true,
                mode: 'whitelist', // 'whitelist' | 'blacklist'
                allowedCommands: [
                    {
                        command: 'ls',
                        description: '列出目录内容',
                        risk: 'safe',
                        needsConfirmation: false
                    },
                    {
                        command: 'cat',
                        description: '查看文件内容',
                        risk: 'safe',
                        needsConfirmation: false
                    },
                    {
                        command: 'pwd',
                        description: '显示当前目录',
                        risk: 'safe',
                        needsConfirmation: false
                    },
                    {
                        command: 'echo',
                        description: '输出文本',
                        risk: 'safe',
                        needsConfirmation: false
                    },
                    {
                        command: 'node',
                        description: '运行Node.js脚本',
                        risk: 'moderate',
                        needsConfirmation: true
                    },
                    {
                        command: 'npm',
                        description: 'Node包管理器',
                        risk: 'moderate',
                        needsConfirmation: true
                    },
                    {
                        command: 'git',
                        description: 'Git版本控制',
                        risk: 'moderate',
                        needsConfirmation: true
                    }
                ],
                blockedCommands: [
                    {
                        command: 'rm -rf',
                        reason: '可能删除重要文件'
                    },
                    {
                        command: 'sudo',
                        reason: '需要管理员权限'
                    },
                    {
                        command: 'dd',
                        reason: '可能破坏磁盘数据'
                    },
                    {
                        command: 'mkfs',
                        reason: '格式化磁盘'
                    },
                    {
                        command: 'chmod 777',
                        reason: '不安全的权限设置'
                    }
                ],
                timeout: 30000, // 30秒超时
                maxConcurrent: 3 // 最大并发命令数
            },
            
            // 应用调用权限
            appExecution: {
                enabled: true,
                mode: 'whitelist',
                allowedApps: [
                    {
                        name: 'Safari',
                        path: '/Applications/Safari.app',
                        icon: '🌐',
                        description: '默认浏览器',
                        needsConfirmation: true
                    },
                    {
                        name: 'Chrome',
                        path: '/Applications/Google Chrome.app',
                        icon: '🔵',
                        description: 'Google浏览器',
                        needsConfirmation: true
                    },
                    {
                        name: 'VSCode',
                        path: '/Applications/Visual Studio Code.app',
                        icon: '💻',
                        description: '代码编辑器',
                        needsConfirmation: false
                    },
                    {
                        name: 'Finder',
                        path: '/System/Library/CoreServices/Finder.app',
                        icon: '📁',
                        description: '文件管理器',
                        needsConfirmation: false
                    },
                    {
                        name: 'Terminal',
                        path: '/System/Applications/Utilities/Terminal.app',
                        icon: '⬛',
                        description: '终端',
                        needsConfirmation: true
                    }
                ],
                blockedApps: []
            },
            
            // 网络访问权限
            networkAccess: {
                enabled: true,
                allowedDomains: ['*'], // '*' 表示所有域名
                blockedDomains: [],
                maxResponseSize: 50 * 1024 * 1024, // 50MB
                timeout: 30000
            },
            
            // 安全设置
            security: {
                auditLog: true, // 记录所有操作
                notifyOnSensitiveAction: true, // 敏感操作通知
                autoBackup: true, // 自动备份
                backupInterval: 3600000 // 1小时
            }
        };
        
        try {
            if (fs.existsSync(this.configPath)) {
                const loaded = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
                // 合并默认配置和加载的配置
                return { ...defaultConfig, ...loaded };
            }
        } catch (error) {
            logger.error('PERMISSION_MANAGER', '加载配置失败', { error: error.message });
        }
        
        // 保存默认配置
        this._saveConfig(defaultConfig);
        return defaultConfig;
    }
    
    /**
     * 保存权限配置
     */
    _saveConfig(config) {
        try {
            const configDir = path.dirname(this.configPath);
            if (!fs.existsSync(configDir)) {
                fs.mkdirSync(configDir, { recursive: true });
            }
            
            fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2), 'utf8');
            logger.info('PERMISSION_MANAGER', '配置已保存');
        } catch (error) {
            logger.error('PERMISSION_MANAGER', '保存配置失败', { error: error.message });
        }
    }
    
    /**
     * 检查文件访问权限
     */
    checkFileAccess(filePath, action = 'read') {
        const config = this.config.fileAccess;
        
        if (!config.enabled) {
            return { allowed: false, reason: '文件访问功能已禁用' };
        }
        
        // 解析路径（展开 ~ 和相对路径）
        const resolvedPath = this._resolvePath(filePath);
        
        // 检查黑名单
        if (config.mode === 'blacklist' || config.blockedPaths) {
            for (const blocked of config.blockedPaths) {
                if (resolvedPath.startsWith(this._resolvePath(blocked))) {
                    return { allowed: false, reason: `路径在黑名单中: ${blocked}` };
                }
            }
        }
        
        // 白名单模式检查
        if (config.mode === 'whitelist') {
            let allowed = false;
            for (const pathConfig of config.paths) {
                const allowedPath = this._resolvePath(pathConfig.path);
                
                if (resolvedPath.startsWith(allowedPath)) {
                    // 检查权限
                    if (pathConfig.permissions.includes(action)) {
                        // 检查递归
                        if (!pathConfig.recursive && resolvedPath !== allowedPath) {
                            continue;
                        }
                        allowed = true;
                        break;
                    }
                }
            }
            
            if (!allowed) {
                return { allowed: false, reason: '路径不在白名单中或权限不足' };
            }
        }
        
        // 检查文件扩展名
        if (config.allowedExtensions[0] !== '*') {
            const ext = path.extname(filePath);
            if (!config.allowedExtensions.includes(ext)) {
                return { allowed: false, reason: `文件扩展名不在允许列表中: ${ext}` };
            }
        }
        
        return { allowed: true };
    }
    
    /**
     * 检查命令执行权限
     */
    checkShellCommand(command) {
        const config = this.config.shellExecution;
        
        if (!config.enabled) {
            return { allowed: false, reason: '命令执行功能已禁用' };
        }
        
        const baseCommand = command.trim().split(' ')[0];
        const commandParts = command.trim().split(/\s+/);
        
        for (const blocked of config.blockedCommands) {
            const blockedLower = blocked.command.toLowerCase();
            const blockedParts = blocked.command.trim().split(/\s+/);
            
            if (blockedParts.length === 1) {
                if (baseCommand.toLowerCase() === blockedLower) {
                    return { 
                        allowed: false, 
                        reason: `命令被禁止: ${blocked.reason}`,
                        command: blocked.command
                    };
                }
            } else {
                if (commandParts.slice(0, blockedParts.length).join(' ').toLowerCase() === blockedLower) {
                    return { 
                        allowed: false, 
                        reason: `命令被禁止: ${blocked.reason}`,
                        command: blocked.command
                    };
                }
            }
        }
        
        // 白名单检查
        if (config.mode === 'whitelist') {
            const commandConfig = config.allowedCommands.find(
                c => c.command === baseCommand
            );
            
            if (!commandConfig) {
                return { allowed: false, reason: `命令不在白名单中: ${baseCommand}` };
            }
            
            return {
                allowed: true,
                needsConfirmation: commandConfig.needsConfirmation,
                risk: commandConfig.risk,
                description: commandConfig.description
            };
        }
        
        return { allowed: true };
    }
    
    /**
     * 检查应用调用权限
     */
    checkAppAccess(appName) {
        const config = this.config.appExecution;
        
        if (!config.enabled) {
            return { allowed: false, reason: '应用调用功能已禁用' };
        }
        
        // 检查黑名单
        const blocked = config.blockedApps.find(app => app.name === appName);
        if (blocked) {
            return { allowed: false, reason: `应用在黑名单中: ${blocked.reason || '未知原因'}` };
        }
        
        // 白名单检查
        if (config.mode === 'whitelist') {
            const appConfig = config.allowedApps.find(app => app.name === appName);
            
            if (!appConfig) {
                return { allowed: false, reason: `应用不在白名单中: ${appName}` };
            }
            
            return {
                allowed: true,
                needsConfirmation: appConfig.needsConfirmation,
                path: appConfig.path,
                description: appConfig.description
            };
        }
        
        return { allowed: true };
    }
    
    /**
     * 更新权限配置
     */
    updatePermissions(newConfig) {
        try {
            this.config = {
                ...this.config,
                ...newConfig,
                lastUpdated: new Date().toISOString()
            };
            
            this._saveConfig(this.config);
            
            messageBus.publish('PERMISSIONS_UPDATED', {
                success: true,
                config: this.config
            });
            
            logger.info('PERMISSION_MANAGER', '权限配置已更新');
            
            return { success: true };
        } catch (error) {
            logger.error('PERMISSION_MANAGER', '更新配置失败', { error: error.message });
            return { success: false, error: error.message };
        }
    }
    
    /**
     * 添加文件访问路径
     */
    addFilePath(pathConfig) {
        this.config.fileAccess.paths.push(pathConfig);
        this._saveConfig(this.config);
        logger.info('PERMISSION_MANAGER', '添加文件路径', { path: pathConfig.path });
    }
    
    /**
     * 添加允许的命令
     */
    addAllowedCommand(commandConfig) {
        this.config.shellExecution.allowedCommands.push(commandConfig);
        this._saveConfig(this.config);
        logger.info('PERMISSION_MANAGER', '添加允许命令', { command: commandConfig.command });
    }
    
    /**
     * 添加允许的应用
     */
    addAllowedApp(appConfig) {
        this.config.appExecution.allowedApps.push(appConfig);
        this._saveConfig(this.config);
        logger.info('PERMISSION_MANAGER', '添加允许应用', { app: appConfig.name });
    }
    
    /**
     * 解析路径：展开 ~ 和相对路径为绝对路径
     */
    _resolvePath(filePath) {
        if (!filePath) return filePath;
        if (filePath.startsWith('~')) {
            return path.join(process.env.HOME || process.env.USERPROFILE || '', filePath.slice(1));
        }
        if (path.isAbsolute(filePath)) {
            return filePath;
        }
        return path.resolve(filePath);
    }
    
    /**
     * 获取当前配置
     */
    getConfig() {
        return this.config;
    }
    
    /**
     * 重置为默认配置
     */
    resetToDefault() {
        if (fs.existsSync(this.configPath)) {
            fs.unlinkSync(this.configPath);
        }
        this.config = this._loadConfig();
        logger.info('PERMISSION_MANAGER', '配置已重置为默认值');
        return { success: true };
    }

    /**
     * 删除文件路径
     */
    removeFilePath(index) {
        if (this.config.fileAccess && this.config.fileAccess.paths) {
            this.config.fileAccess.paths.splice(index, 1);
            this._saveConfig(this.config);
            return { success: true };
        }
        return { success: false };
    }

    /**
     * 删除允许的命令
     */
    removeCommand(index) {
        if (this.config.shellExecution && this.config.shellExecution.allowedCommands) {
            this.config.shellExecution.allowedCommands.splice(index, 1);
            this._saveConfig(this.config);
            return { success: true };
        }
        return { success: false };
    }

    /**
     * 删除允许的应用
     */
    removeApp(index) {
        if (this.config.appExecution && this.config.appExecution.allowedApps) {
            this.config.appExecution.allowedApps.splice(index, 1);
            this._saveConfig(this.config);
            return { success: true };
        }
        return { success: false };
    }
}

// 导出单例
module.exports = new PermissionManager();
