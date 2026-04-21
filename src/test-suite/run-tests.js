// test-suite/run-tests.js — 测试运行脚本
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

console.log('🧪 创世纪系统 - 测试套件运行器\n');
console.log('='.repeat(50));

const testDir = __dirname;
const testFiles = fs.readdirSync(testDir)
    .filter(file => file.endsWith('.test.js'));

console.log(`📋 找到 ${testFiles.length} 个测试文件:\n`);
testFiles.forEach(file => console.log(`   - ${file}`));
console.log('');

let passed = 0;
let failed = 0;
const results = [];

async function runTests() {
    for (const file of testFiles) {
        const testPath = path.join(testDir, file);
        console.log(`\n🧬 运行测试: ${file}`);
        console.log('-'.repeat(50));
        
        try {
            await new Promise((resolve, reject) => {
                const child = exec(`node "${testPath}"`, (error, stdout, stderr) => {
                    if (error) {
                        console.error(stderr);
                        results.push({ file, status: 'FAILED', error: error.message });
                        failed++;
                        reject(error);
                    } else {
                        console.log(stdout);
                        results.push({ file, status: 'PASSED' });
                        passed++;
                        resolve();
                    }
                });
                
                child.stdout.pipe(process.stdout);
                child.stderr.pipe(process.stderr);
            });
        } catch (error) {
            console.error(`❌ 测试失败: ${file}`);
        }
    }
    
    // 输出总结
    console.log('\n' + '='.repeat(50));
    console.log('📊 测试结果汇总:');
    console.log('='.repeat(50));
    console.log(`✅ 通过: ${passed}`);
    console.log(`❌ 失败: ${failed}`);
    console.log(`📈 通过率: ${((passed / (passed + failed)) * 100).toFixed(1)}%`);
    
    if (failed > 0) {
        console.log('\n❌ 失败的测试:');
        results.filter(r => r.status === 'FAILED').forEach(r => {
            console.log(`   - ${r.file}: ${r.error}`);
        });
        process.exit(1);
    } else {
        console.log('\n🎉 所有测试通过！');
        process.exit(0);
    }
}

runTests();
