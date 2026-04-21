// core/hot-reloader.js — 热重载
const path = require('path');
const messageBus = require('./message-bus');

class HotReloader {
    constructor() {
        messageBus.subscribe('HOT_RELOAD', (data) => this._onReload(data));
    }

    _onReload(data) {
        const { module: modulePath, reason } = data;
        console.log(`[HotReloader] Reloading "${modulePath}" (reason: ${reason})`);

        try {
            const resolved = this._resolve(modulePath);
            this._clearCache(resolved);
            const fresh = require(resolved);
            console.log(`[HotReloader] Successfully reloaded: ${modulePath}`);
            messageBus.publish('HOT_RELOAD_RESULT', {
                module: modulePath,
                success: true
            });
            return fresh;
        } catch (error) {
            console.error(`[HotReloader] Failed to reload "${modulePath}":`, error.message);
            messageBus.publish('HOT_RELOAD_RESULT', {
                module: modulePath,
                success: false,
                error: error.message
            });
        }
    }

    _resolve(modulePath) {
        // 支持相对路径和模块名
        if (modulePath.startsWith('.') || modulePath.startsWith('/')) {
            return path.resolve(__dirname, '..', modulePath);
        }
        return require.resolve(modulePath);
    }

    _clearCache(resolvedPath) {
        const mod = require.cache[resolvedPath];
        if (mod) {
            mod.children.forEach(child => {
                if (!child.id.includes('node_modules') && child.id.startsWith(__dirname)) {
                    this._clearCache(child.id);
                }
            });
            delete require.cache[resolvedPath];
        }
    }
}

module.exports = new HotReloader();
