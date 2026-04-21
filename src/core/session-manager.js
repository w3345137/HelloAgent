// core/session-manager.js — 任务（Session）管理模块
const fs = require('fs');
const path = require('path');

/**
 * Session Manager — 管理任务列表、对话历史、记忆
 * 
 * 数据结构：
 * - sessions.json: 所有 session 的元数据
 * - sessions/: 每个 session 的对话历史
 *   - {sessionKey}/
 *     - history.json: 对话历史
 *     - memory/: 独立记忆文件
 */
class SessionManager {
    constructor(dataDir) {
        this.dataDir = dataDir;
        this.sessionsFile = path.join(dataDir, 'sessions.json');
        this.sessionsDir = path.join(dataDir, 'sessions');
        
        // 确保 sessions 目录存在
        if (!fs.existsSync(this.sessionsDir)) {
            fs.mkdirSync(this.sessionsDir, { recursive: true });
        }
        
        // 加载或初始化 sessions 列表
        this.sessions = this._loadSessions();
    }
    
    /**
     * 加载 sessions 列表
     */
    _loadSessions() {
        try {
            if (fs.existsSync(this.sessionsFile)) {
                const data = fs.readFileSync(this.sessionsFile, 'utf-8');
                return JSON.parse(data);
            }
        } catch (err) {
            console.error('[SessionManager] Failed to load sessions:', err);
        }
        return {};
    }
    
    /**
     * 保存 sessions 列表
     */
    _saveSessions() {
        try {
            fs.writeFileSync(this.sessionsFile, JSON.stringify(this.sessions, null, 2), 'utf-8');
        } catch (err) {
            console.error('[SessionManager] Failed to save sessions:', err);
        }
    }
    
    /**
     * 创建新 session
     * @param {Object} meta - { name, model, workFolder, memoryFolder }
     * @returns {Object} - { sessionKey, session }
     */
    create(meta = {}) {
        const timestamp = Date.now();
        const slug = (meta.name || 'task')
            .replace(/\s+/g, '-')
            .replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, '')
            .slice(0, 40);
        const sessionKey = `${slug}-${timestamp.toString(36)}`;
        
        const session = {
            key: sessionKey,
            name: meta.name || '未命名任务',
            model: meta.model || 'MiniMax-M2.7',
            workFolder: meta.workFolder || '',
            memoryFolder: meta.memoryFolder || '',
            createdAt: timestamp,
            updatedAt: timestamp,
            status: 'idle',
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
        };
        
        this.sessions[sessionKey] = session;
        this._saveSessions();
        
        // 创建 session 目录
        const sessionDir = path.join(this.sessionsDir, sessionKey);
        fs.mkdirSync(sessionDir, { recursive: true });
        fs.mkdirSync(path.join(sessionDir, 'memory'), { recursive: true });
        
        // 初始化对话历史
        fs.writeFileSync(
            path.join(sessionDir, 'history.json'),
            JSON.stringify([], null, 2),
            'utf-8'
        );
        
        console.log(`[SessionManager] Created session: ${sessionKey}`);
        return { sessionKey, session };
    }
    
    /**
     * 获取 session
     */
    get(sessionKey) {
        return this.sessions[sessionKey] || null;
    }
    
    /**
     * 列出所有 sessions
     */
    list() {
        return Object.values(this.sessions)
            .sort((a, b) => b.updatedAt - a.updatedAt);
    }
    
    /**
     * 更新 session 元数据
     */
    update(sessionKey, updates) {
        const session = this.sessions[sessionKey];
        if (!session) return null;
        
        Object.assign(session, updates, { updatedAt: Date.now() });
        this._saveSessions();
        return session;
    }
    
    /**
     * 删除 session
     */
    delete(sessionKey) {
        if (!this.sessions[sessionKey]) return false;
        
        delete this.sessions[sessionKey];
        this._saveSessions();
        
        // 删除 session 目录
        const sessionDir = path.join(this.sessionsDir, sessionKey);
        try {
            fs.rmSync(sessionDir, { recursive: true, force: true });
        } catch (err) {
            console.error('[SessionManager] Failed to delete session dir:', err);
        }
        
        console.log(`[SessionManager] Deleted session: ${sessionKey}`);
        return true;
    }
    
    /**
     * 获取对话历史
     */
    getHistory(sessionKey) {
        const historyFile = path.join(this.sessionsDir, sessionKey, 'history.json');
        try {
            if (fs.existsSync(historyFile)) {
                const data = fs.readFileSync(historyFile, 'utf-8');
                return JSON.parse(data);
            }
        } catch (err) {
            console.error('[SessionManager] Failed to load history:', err);
        }
        return [];
    }
    
    /**
     * 追加消息到历史
     */
    appendHistory(sessionKey, message) {
        const sessionDir = path.join(this.sessionsDir, sessionKey);
        const historyFile = path.join(sessionDir, 'history.json');
        try {
            if (!fs.existsSync(sessionDir)) {
                fs.mkdirSync(sessionDir, { recursive: true });
                fs.mkdirSync(path.join(sessionDir, 'memory'), { recursive: true });
            }
            
            const entry = JSON.stringify({
                ...message,
                timestamp: Date.now(),
            });
            
            if (fs.existsSync(historyFile)) {
                let content = fs.readFileSync(historyFile, 'utf-8').trimEnd();
                if (content.endsWith(']')) {
                    content = content.slice(0, -1).trimEnd();
                    if (content.endsWith('[')) {
                        fs.writeFileSync(historyFile, `[${entry}]`, 'utf-8');
                    } else {
                        fs.writeFileSync(historyFile, `${content},\n${entry}]`, 'utf-8');
                    }
                } else {
                    const history = JSON.parse(content);
                    history.push({ ...message, timestamp: Date.now() });
                    fs.writeFileSync(historyFile, JSON.stringify(history, null, 2), 'utf-8');
                }
            } else {
                fs.writeFileSync(historyFile, `[${entry}]`, 'utf-8');
            }
            
            this.update(sessionKey, {});
            
            return true;
        } catch (err) {
            console.error('[SessionManager] Failed to append history:', err);
            return false;
        }
    }
    
    /**
     * 更新 Token 统计
     */
    updateTokens(sessionKey, inputTokens, outputTokens) {
        const session = this.sessions[sessionKey];
        if (!session) return;
        
        session.inputTokens += inputTokens;
        session.outputTokens += outputTokens;
        session.totalTokens = session.inputTokens + session.outputTokens;
        this._saveSessions();
    }
    
    /**
     * 获取 session 的独立记忆
     */
    getMemory(sessionKey, layer = 'short') {
        const memoryFile = path.join(this.sessionsDir, sessionKey, 'memory', `${layer}-memory.md`);
        try {
            if (fs.existsSync(memoryFile)) {
                return fs.readFileSync(memoryFile, 'utf-8');
            }
        } catch (err) {
            console.error('[SessionManager] Failed to load memory:', err);
        }
        return '';
    }
    
    /**
     * 设置 session 的独立记忆
     */
    setMemory(sessionKey, layer, content) {
        const memoryDir = path.join(this.sessionsDir, sessionKey, 'memory');
        const memoryFile = path.join(memoryDir, `${layer}-memory.md`);
        
        try {
            if (!fs.existsSync(memoryDir)) {
                fs.mkdirSync(memoryDir, { recursive: true });
            }
            fs.writeFileSync(memoryFile, content, 'utf-8');
            return true;
        } catch (err) {
            console.error('[SessionManager] Failed to save memory:', err);
            return false;
        }
    }
}

module.exports = SessionManager;
