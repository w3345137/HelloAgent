// test-suite/surgeon.test.js — 手术刀工具测试套件
const fs = require('fs');
const path = require('path');
const surgeon = require('../core/surgeon');

// 简单的 assert 函数
function assert(condition, message) {
    if (!condition) {
        throw new Error(`断言失败: ${message}`);
    }
    console.log(`✓ ${message}`);
}

console.log('=== Surgeon 模块测试 ===\n');

// 测试1: Surgeon 对象存在
assert(surgeon, 'Surgeon 对象存在');

// 测试2: 核心方法存在
assert(typeof surgeon.applyPatch === 'function', 'applyPatch 方法存在');
assert(typeof surgeon.rollback === 'function', 'rollback 方法存在');
assert(typeof surgeon.readSource === 'function', 'readSource 方法存在');

// 测试3: 创建测试文件（使用相对于 src/ 的路径）
const testModule = 'test/test-module.js';
const testCode = `// 测试模块\nmodule.exports = { value: 1 };`;
const testPath = path.join(__dirname, '..', testModule);

// 确保测试目录存在
const testDir = path.dirname(testPath);
if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
}
fs.writeFileSync(testPath, testCode, 'utf8');

// 测试4: 读取源代码
const source = surgeon.readSource(testModule);
assert(source && source.content, 'readSource 功能正常');

// 测试5: 应用补丁
const patchCode = `// 测试模块（已修复）\nmodule.exports = { value: 2, fixed: true };`;
const result = surgeon.applyPatch(testModule, patchCode, '测试补丁');
assert(result && result.versionId, 'applyPatch 功能正常');

// 测试6: 验证补丁已应用
const patchedSource = fs.readFileSync(testPath, 'utf8');
assert(patchedSource.includes('fixed: true'), '补丁内容已写入');

// 测试7: 回滚功能
surgeon.rollback(result.versionId);
const rolledBackSource = fs.readFileSync(testPath, 'utf8');
assert(rolledBackSource.includes('value: 1'), 'rollback 功能正常');

// 清理测试文件
try {
    fs.unlinkSync(testPath);
    fs.rmdirSync(testDir);
} catch {}

console.log('\n✅ 所有测试通过！');
