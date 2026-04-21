// core/sensor.js — 观测层
const messageBus = require('./message-bus');

class Sensor {
    constructor(opts = {}) {
        this.errorThreshold = opts.errorThreshold || 3;
        this.windowMs = opts.windowMs || 60000; // 1 分钟窗口
        this.errors = [];

        messageBus.subscribe('ERROR', (data) => this._onError(data));
    }

    _onError(data) {
        const now = Date.now();
        this.errors.push({ ts: now, ...data });
        // 清理窗口外的旧记录
        this.errors = this.errors.filter(e => now - e.ts < this.windowMs);

        console.log(`[Sensor] Error count in window: ${this.errors.length}/${this.errorThreshold}`);

        if (this.errors.length >= this.errorThreshold) {
            console.log('[Sensor] Threshold reached — triggering evolution');
            messageBus.publish('EVOLVE', {
                trigger: 'error_threshold',
                errors: this.errors.slice(),
                timestamp: now
            });
            this.errors = []; // 重置计数
        }
    }

    getStatus() {
        return {
            errorCount: this.errors.length,
            threshold: this.errorThreshold,
            windowMs: this.windowMs
        };
    }
}

module.exports = Sensor;
