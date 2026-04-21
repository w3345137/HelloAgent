/**
 * 日志持久化模块
 * 功能：写入 logs/ 目录，支持日志轮转
 */

const fs = require('fs');
const path = require('path');

// 日志目录
const LOGS_DIR = path.join(__dirname, '..', 'logs');
const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_LOG_FILES = 5;

// 确保日志目录存在
if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
}

/**
 * 获取当前日期字符串 (YYYY-MM-DD)
 */
function getDateString() {
    const now = new Date();
    return now.toISOString().split('T')[0];
}

/**
 * 获取当前时间戳字符串
 */
function getTimestamp() {
    return new Date().toISOString();
}

/**
 * 获取当前日志文件路径
 */
function getCurrentLogFile() {
    return path.join(LOGS_DIR, `hello-agent-${getDateString()}.log`);
}

/**
 * 检查并执行日志轮转
 */
function rotateLogsIfNeeded(logFile) {
    try {
        if (fs.existsSync(logFile)) {
            const stats = fs.statSync(logFile);
            if (stats.size >= MAX_LOG_SIZE) {
                // 重命名当前日志文件
                const timestamp = Date.now();
                const rotatedFile = logFile.replace('.log', `-${timestamp}.log`);
                fs.renameSync(logFile, rotatedFile);
                
                // 清理旧日志文件
                cleanOldLogs();
            }
        }
    } catch (err) {
        console.error('日志轮转失败:', err.message);
    }
}

/**
 * 清理旧日志文件，保留最新的 MAX_LOG_FILES 个
 */
function cleanOldLogs() {
    try {
        const files = fs.readdirSync(LOGS_DIR)
            .filter(f => f.endsWith('.log') && f.includes('hello-agent-'))
            .map(f => ({
                name: f,
                path: path.join(LOGS_DIR, f),
                time: fs.statSync(path.join(LOGS_DIR, f)).mtime.getTime()
            }))
            .sort((a, b) => b.time - a.time);
        
        // 删除超出数量的旧日志
        if (files.length > MAX_LOG_FILES) {
            files.slice(MAX_LOG_FILES).forEach(f => {
                fs.unlinkSync(f.path);
            });
        }
    } catch (err) {
        console.error('清理旧日志失败:', err.message);
    }
}

/**
 * 写入日志
 * @param {string} level - 日志级别 (INFO, WARN, ERROR, DEBUG)
 * @param {string} category - 日志分类 (STATE, CHAT, EXECUTE, EVOLVE, SYSTEM)
 * @param {string} message - 日志消息
 * @param {object} data - 附加数据
 */
function log(level, category, message, data = null) {
    const timestamp = getTimestamp();
    const logLine = JSON.stringify({
        timestamp,
        level,
        category,
        message,
        data
    }) + '\n';
    
    const logFile = getCurrentLogFile();
    
    // 检查轮转
    rotateLogsIfNeeded(logFile);
    
    // 写入日志
    try {
        fs.appendFileSync(logFile, logLine, 'utf8');
    } catch (err) {
        console.error('写入日志失败:', err.message);
    }
    
    // 同时输出到控制台
    const consoleMsg = `[${timestamp}] [${level}] [${category}] ${message}`;
    switch (level) {
        case 'ERROR':
            console.error(consoleMsg);
            break;
        case 'WARN':
            console.warn(consoleMsg);
            break;
        default:
            console.log(consoleMsg);
    }
}

// 便捷方法
const logger = {
    info: (category, message, data) => log('INFO', category, message, data),
    warn: (category, message, data) => log('WARN', category, message, data),
    error: (category, message, data) => log('ERROR', category, message, data),
    debug: (category, message, data) => log('DEBUG', category, message, data),
    
    // 状态变更
    state: (from, to) => log('INFO', 'STATE', `状态转换: ${from} → ${to}`, { from, to }),
    
    // 聊天记录
    chat: (direction, text) => log('INFO', 'CHAT', `${direction}: ${text}`, { direction, text }),
    
    // 执行记录
    execute: (module, params) => log('INFO', 'EXECUTE', `执行模块: ${module}`, { module, params }),
    executeResult: (module, result) => log('INFO', 'EXECUTE', `执行结果: ${module}`, { module, result }),
    
    // 进化记录
    evolve: (trigger, details) => log('INFO', 'EVOLVE', `进化触发: ${trigger}`, { trigger, details }),
    
    // 系统事件
    system: (message, data) => log('INFO', 'SYSTEM', message, data),
    
    // 错误记录
    errorDetail: (context, error) => log('ERROR', 'ERROR', `${context}: ${error.message}`, {
        context,
        error: error.message,
        stack: error.stack
    })
};

module.exports = logger;
