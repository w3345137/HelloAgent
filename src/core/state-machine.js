// core/state-machine.js — 状态机（架构核心）
const EventEmitter = require('events');

// 合法状态转换表
const VALID_TRANSITIONS = {
    IDLE:         ['PLANNING'],
    PLANNING:     ['EXECUTING', 'IDLE', 'RECOVERING'],
    EXECUTING:    ['IDLE', 'INTERRUPTING', 'RECOVERING'],
    INTERRUPTING: ['IDLE', 'RECOVERING'],
    RECOVERING:   ['IDLE']
};

// 状态中文映射
const STATE_LABELS = {
    IDLE: '空闲',
    PLANNING: '思考中',
    EXECUTING: '执行中',
    INTERRUPTING: '中断中',
    RECOVERING: '恢复中'
};

class StateMachine extends EventEmitter {
    constructor() {
        super();
        this.state = 'IDLE';
    }

    get label() {
        return STATE_LABELS[this.state] || this.state;
    }

    transition(newState) {
        const allowed = VALID_TRANSITIONS[this.state];
        if (!allowed || !allowed.includes(newState)) {
            console.warn(`[State] REJECTED: ${this.state} -> ${newState} (not allowed)`);
            return false;
        }
        const old = this.state;
        this.state = newState;
        console.log(`[State] ${STATE_LABELS[old]} -> ${STATE_LABELS[newState]}`);
        this.emit('change', { from: old, to: newState, label: STATE_LABELS[newState] });
        return true;
    }

    // 强制重置（仅限紧急恢复 + 中断）
    forceReset() {
        const old = this.state;
        this.state = 'IDLE';
        console.warn(`[State] 强制重置: ${STATE_LABELS[old]} -> 空闲`);
        this.emit('change', { from: old, to: 'IDLE', label: '空闲' });
    }
}

module.exports = new StateMachine();
