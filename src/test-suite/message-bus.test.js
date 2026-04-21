// test-suite/message-bus.test.js — 消息总线测试套件
const messageBus = require('../core/message-bus');

// 简单的 assert 函数
function assert(condition, message) {
    if (!condition) {
        throw new Error(`断言失败: ${message}`);
    }
    console.log(`✓ ${message}`);
}

console.log('=== MessageBus 模块测试 ===\n');

// 测试1: 消息总线对象存在
assert(messageBus, 'MessageBus 对象存在');

// 测试2: 核心方法存在
assert(typeof messageBus.subscribe === 'function', 'subscribe 方法存在');
assert(typeof messageBus.publish === 'function', 'publish 方法存在');

// 测试3: 发布订阅功能
let received = false;
const testEvent = 'TEST_EVENT_' + Date.now();

messageBus.subscribe(testEvent, (data) => {
    received = true;
    console.log('收到测试事件:', data);
});

messageBus.publish(testEvent, { test: true });
assert(received, '发布订阅功能正常');

// 测试4: 多个订阅者
let count = 0;
const multiEvent = 'MULTI_EVENT_' + Date.now();

messageBus.subscribe(multiEvent, () => count++);
messageBus.subscribe(multiEvent, () => count++);

messageBus.publish(multiEvent, {});
assert(count === 2, '多订阅者功能正常');

console.log('\n✅ 所有测试通过！');
