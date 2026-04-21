// test-suite/logger.test.js — 日志系统测试套件
const logger = require('../core/logger');

// 简单的 assert 函数
function assert(condition, message) {
    if (!condition) {
        throw new Error(`断言失败: ${message}`);
    }
    console.log(`✓ ${message}`);
}

console.log('=== Logger 模块测试 ===\n');

// 测试1: 日志对象是否存在
assert(logger, 'Logger 对象存在');

// 测试2: 基本日志方法
assert(typeof logger.info === 'function', 'logger.info 方法存在');
assert(typeof logger.error === 'function', 'logger.error 方法存在');
assert(typeof logger.warn === 'function', 'logger.warn 方法存在');

// 测试3: 日志记录功能
try {
    logger.info('TEST', '测试信息日志');
    logger.warn('TEST', '测试警告日志');
    logger.error('TEST', '测试错误日志');
    assert(true, '日志记录功能正常');
} catch (error) {
    assert(false, `日志记录失败: ${error.message}`);
}

// 测试4: 进化日志方法
assert(typeof logger.evolve === 'function', 'logger.evolve 方法存在');

// 测试5: 错误详情方法
assert(typeof logger.errorDetail === 'function', 'logger.errorDetail 方法存在');

console.log('\n✅ 所有测试通过！');
