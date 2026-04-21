// core/memory-manager.js — 三层记忆管理系统
const fs = require('fs');
const path = require('path');

/**
 * Memory Manager — 三层记忆架构
 * 
 * 记忆层级：
 * - 长期记忆（~500 tokens）：跨项目全局知识，存储在 Data/memory/long-memory.md
 * - 中期记忆（~2000 tokens）：项目级总结，存储在项目的 memorys/mid-memory.md（对话结束时更新）
 * - 短期记忆（~1000 tokens）：最近10轮对话，存储在项目的 memorys/short-memory.md
 * 
 * 工作流程：
 * 1. 任务开始：注入三层记忆到 Brain context
 * 2. 任务进行：Brain 根据需要读取/更新记忆
 * 3. 任务结束：主模型总结对话，更新中期记忆
 */
class MemoryManager {
    constructor(dataDir) {
        this.dataDir = dataDir;
        this.longMemoryFile = path.join(dataDir, 'memory', 'long-memory.md');
        
        // 确保长期记忆目录存在
        const longMemoryDir = path.dirname(this.longMemoryFile);
        if (!fs.existsSync(longMemoryDir)) {
            fs.mkdirSync(longMemoryDir, { recursive: true });
        }
    }
    
    /**
     * 读取长期记忆
     */
    getLongMemory() {
        try {
            if (fs.existsSync(this.longMemoryFile)) {
                return fs.readFileSync(this.longMemoryFile, 'utf-8');
            }
        } catch (err) {
            console.error('[MemoryManager] Failed to load long memory:', err);
        }
        return '';
    }
    
    /**
     * 保存长期记忆
     */
    setLongMemory(content) {
        try {
            fs.writeFileSync(this.longMemoryFile, content, 'utf-8');
            return true;
        } catch (err) {
            console.error('[MemoryManager] Failed to save long memory:', err);
            return false;
        }
    }
    
    /**
     * 读取中期记忆（项目级）
     */
    getMidMemory(workFolder) {
        if (!workFolder) return '';
        const memDir = path.join(workFolder, 'memorys');
        const midMemoryFile = path.join(memDir, 'mid-memory.md');
        
        try {
            if (fs.existsSync(midMemoryFile)) {
                return fs.readFileSync(midMemoryFile, 'utf-8');
            }
            
            // Fallback: 兼容旧格式
            const legacyFiles = ['project-memory.md', 'context.md'];
            for (const legacy of legacyFiles) {
                const legacyFile = path.join(memDir, legacy);
                if (fs.existsSync(legacyFile)) {
                    const content = fs.readFileSync(legacyFile, 'utf-8');
                    // 迁移到新格式
                    this.setMidMemory(workFolder, content);
                    console.log(`[MemoryManager] Migrated ${legacy} → mid-memory.md`);
                    return content;
                }
            }
        } catch (err) {
            console.error('[MemoryManager] Failed to load mid memory:', err);
        }
        return '';
    }
    
    /**
     * 保存中期记忆
     */
    setMidMemory(workFolder, content) {
        if (!workFolder) return false;
        const memDir = path.join(workFolder, 'memorys');
        const midMemoryFile = path.join(memDir, 'mid-memory.md');
        
        try {
            if (!fs.existsSync(memDir)) {
                fs.mkdirSync(memDir, { recursive: true });
            }
            fs.writeFileSync(midMemoryFile, content, 'utf-8');
            return true;
        } catch (err) {
            console.error('[MemoryManager] Failed to save mid memory:', err);
            return false;
        }
    }
    
    /**
     * 读取短期记忆（最近10轮对话）
     */
    getShortMemory(workFolder) {
        if (!workFolder) return '';
        const memDir = path.join(workFolder, 'memorys');
        const shortMemoryFile = path.join(memDir, 'short-memory.md');
        
        try {
            if (fs.existsSync(shortMemoryFile)) {
                return fs.readFileSync(shortMemoryFile, 'utf-8');
            }
        } catch (err) {
            console.error('[MemoryManager] Failed to load short memory:', err);
        }
        return '';
    }
    
    /**
     * 保存短期记忆
     */
    setShortMemory(workFolder, content) {
        if (!workFolder) return false;
        const memDir = path.join(workFolder, 'memorys');
        const shortMemoryFile = path.join(memDir, 'short-memory.md');
        
        try {
            if (!fs.existsSync(memDir)) {
                fs.mkdirSync(memDir, { recursive: true });
            }
            fs.writeFileSync(shortMemoryFile, content, 'utf-8');
            console.log(`[MemoryManager] Saved short memory to ${shortMemoryFile}`);
            return true;
        } catch (err) {
            console.error('[MemoryManager] Failed to save short memory:', err);
            return false;
        }
    }
    
    /**
     * 注入三层记忆上下文
     * 返回格式化的记忆文本，用于 Brain system prompt
     */
    injectContext(workFolder) {
        const parts = [];
        
        console.log(`[MemoryManager.injectContext] workFolder=${workFolder || '(empty)'}`);
        
        // 1. 长期记忆
        const longMemory = this.getLongMemory();
        console.log(`[MemoryManager.injectContext] longMemory length=${longMemory.length}`);
        if (longMemory.trim()) {
            parts.push(`--- 长期记忆 ---\n${longMemory.trim()}`);
        }
        
        // 2. 中期记忆（项目级总结）
        if (workFolder) {
            const midMemory = this.getMidMemory(workFolder);
            if (midMemory.trim()) {
                parts.push(`--- 中期记忆（项目总结） ---\n${midMemory.trim()}`);
            }
        }
        
        // 3. 短期记忆（最近10轮对话）
        if (workFolder) {
            const shortMemory = this.getShortMemory(workFolder);
            if (shortMemory.trim()) {
                parts.push(`--- 短期记忆（最近对话） ---\n${shortMemory.trim()}`);
            }
        }
        
        if (parts.length === 0) return '';
        
        return `[系统上下文 — 由 Hello Agent 自动注入，请勿自行管理记忆文件]\n${parts.join('\n\n')}`;
    }
    
    /**
     * 估算文本的 token 数
     * 中文约 1.5 字符/token，英文约 4 字符/token
     */
    estimateTokens(text) {
        if (!text) return 0;
        let cjk = 0, other = 0;
        for (const ch of text) {
            if (/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/.test(ch)) cjk++;
            else other++;
        }
        return Math.ceil(cjk / 1.5 + other / 4);
    }
    
    /**
     * 格式化 token 数
     */
    formatTokens(n) {
        if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
        if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
        return String(n);
    }
}

module.exports = MemoryManager;
