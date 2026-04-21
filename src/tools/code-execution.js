// tools/code-execution.js - 代码沙箱执行工具（类似openClaw code_execution）
const registry = require('./index');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// 执行配置
const EXECUTION_CONFIG = {
    timeout: 30000, // 30秒超时
    maxOutputSize: 1024 * 1024, // 1MB输出限制
    allowedLanguages: ['python', 'javascript', 'bash', 'shell', 'node'],
    disallowedKeywords: ['rm -rf', 'dd ', 'mkfs', 'wget /dev/null', '| dd of=/dev/'],
    tempDir: path.join(__dirname, '..', 'sandbox', 'execution') // 零外溢：所有文件在 APP 包内
};

/**
 * 在沙箱中安全执行代码
 * @param {string} language - 编程语言
 * @param {string} code - 代码内容
 * @param {object} options - 选项
 * @returns {Promise<object>} - 执行结果
 */
async function executeCodeInSandbox(language, code, options = {}) {
    return new Promise((resolve, reject) => {
        // 安全检查
        const safeCheck = checkCodeSafety(code, language);
        if (!safeCheck.safe) {
            reject(new Error(`代码安全检查失败: ${safeCheck.reason}`));
            return;
        }
        
        // 创建临时目录
        ensureTempDir();
        
        let scriptPath;
        let command;
        let args = [];
        
        switch (language.toLowerCase()) {
            case 'python':
            case 'py':
                scriptPath = path.join(EXECUTION_CONFIG.tempDir, `exec_${Date.now()}.py`);
                fs.writeFileSync(scriptPath, code, 'utf-8');
                command = 'python3';
                args = ['-u', scriptPath];
                break;
                
            case 'javascript':
            case 'js':
            case 'node':
                scriptPath = path.join(EXECUTION_CONFIG.tempDir, `exec_${Date.now()}.js`);
                fs.writeFileSync(scriptPath, code, 'utf-8');
                command = 'node';
                args = [scriptPath];
                break;
                
            case 'bash':
            case 'shell':
            case 'sh':
                scriptPath = path.join(EXECUTION_CONFIG.tempDir, `exec_${Date.now()}.sh`);
                fs.writeFileSync(scriptPath, code, 'utf-8');
                // 确保文件可执行
                fs.chmodSync(scriptPath, 0o755);
                command = 'bash';
                args = [scriptPath];
                break;
                
            default:
                reject(new Error(`不支持的语言: ${language}`));
                return;
        }
        
        // 执行代码
        const startTime = Date.now();
        let stdout = '';
        let stderr = '';
        let killed = false;
        
        const child = spawn(command, args, {
            cwd: options.cwd || EXECUTION_CONFIG.tempDir,
            env: {
                ...process.env,
                PYTHONUNBUFFERED: '1',
                NODE_NO_WARNINGS: '1'
            },
            stdio: ['ignore', 'pipe', 'pipe']
        });
        
        // 设置超时
        const timeoutId = setTimeout(() => {
            killed = true;
            child.kill('SIGKILL');
            const elapsed = Date.now() - startTime;
            reject(new Error(`执行超时 (${elapsed}ms)`));
        }, options.timeout || EXECUTION_CONFIG.timeout);
        
        // 收集输出
        let outputSize = 0;
        
        child.stdout.on('data', (data) => {
            outputSize += data.length;
            if (outputSize > EXECUTION_CONFIG.maxOutputSize) {
                killed = true;
                child.kill('SIGKILL');
                reject(new Error(`输出超过${EXECUTION_CONFIG.maxOutputSize}字节限制`));
                return;
            }
            stdout += data.toString();
        });
        
        child.stderr.on('data', (data) => {
            outputSize += data.length;
            if (outputSize > EXECUTION_CONFIG.maxOutputSize) {
                killed = true;
                child.kill('SIGKILL');
                reject(new Error(`输出超过${EXECUTION_CONFIG.maxOutputSize}字节限制`));
                return;
            }
            stderr += data.toString();
        });
        
        child.on('close', (code) => {
            clearTimeout(timeoutId);
            
            // 清理临时文件
            try {
                if (fs.existsSync(scriptPath)) {
                    fs.unlinkSync(scriptPath);
                }
            } catch (cleanupError) {
                // 忽略清理错误
            }
            
            if (killed) return;
            
            const elapsed = Date.now() - startTime;
            resolve({
                success: code === 0,
                exitCode: code,
                stdout: stdout.trim(),
                stderr: stderr.trim(),
                executionTime: elapsed,
                language: language,
                outputSize: outputSize
            });
        });
        
        child.on('error', (error) => {
            clearTimeout(timeoutId);
            reject(new Error(`执行过程错误: ${error.message}`));
        });
    });
}

/**
 * 检查代码安全性
 * @param {string} code - 代码
 * @param {string} language - 语言
 * @returns {{safe: boolean, reason: string|null}}
 */
function checkCodeSafety(code, language) {
    for (const keyword of EXECUTION_CONFIG.disallowedKeywords) {
        if (code.includes(keyword)) {
            return {
                safe: false,
                reason: `代码包含潜在危险关键词: "${keyword}"`
            };
        }
    }
    
    switch (language.toLowerCase()) {
        case 'python':
        case 'py': {
            const dangerousPythonImports = [
                'import os',
                'from os import',
                'import subprocess',
                'import socket',
                'import shutil',
                'import signal'
            ];
            for (const importCheck of dangerousPythonImports) {
                if (code.includes(importCheck)) {
                    return {
                        safe: false,
                        reason: `Python代码包含危险导入: ${importCheck}（系统级操作需要通过 shell_execute 工具）`
                    };
                }
            }
            const dangerousPythonPatterns = [
                /__import__\s*\(/,
                /importlib\s*\.\s*import_module/,
                /eval\s*\(/,
                /exec\s*\(/,
                /open\s*\(.+['"]w/,
                /os\.system\s*\(/,
                /subprocess\s*\./,
                /shutil\s*\./
            ];
            for (const pattern of dangerousPythonPatterns) {
                if (pattern.test(code)) {
                    return {
                        safe: false,
                        reason: `Python代码包含危险操作: ${pattern.source}（系统级操作需要通过 shell_execute 工具）`
                    };
                }
            }
            if (code.includes('import sys')) {
                console.log(`[CodeExecution] ⚠️ Python代码包含 sys 模块导入（已放行）`);
            }
            break;
        }
            
        case 'javascript':
        case 'node': {
            const dangerousJS = [
                'fs.unlinkSync',
                'fs.rmSync',
                'fs.rmdirSync',
                'child_process.spawnSync',
                'execSync(',
                'spawn(',
                'require(\'child_process\')',
                'require("child_process")'
            ];
            for (const check of dangerousJS) {
                if (code.includes(check)) {
                    return {
                        safe: false,
                        reason: `JavaScript代码包含危险操作: ${check}（系统级操作需要通过 shell_execute 工具）`
                    };
                }
            }
            const dangerousJSPatterns = [
                /require\s*\(\s*['"]fs['"]\s*\)/,
                /require\s*\(\s*['"]child_process['"]\s*\)/,
                /process\.exit\s*\(/,
                /new\s+Function\s*\(/,
                /eval\s*\(/
            ];
            for (const pattern of dangerousJSPatterns) {
                if (pattern.test(code)) {
                    return {
                        safe: false,
                        reason: `JavaScript代码包含危险操作: ${pattern.source}（系统级操作需要通过 shell_execute 工具）`
                    };
                }
            }
            break;
        }
            
        case 'bash':
        case 'shell':
        case 'sh': {
            const dangerousBash = [
                /rm\s+-rf\s+[\/~]/,
                />\s*\/dev\/sd/,
                /mkfs\b/,
                /dd\s+if=/,
                /chmod\s+777/,
                /sudo\s+/,
                /curl\s+.*\|\s*sh/,
                /wget\s+.*\|\s*sh/
            ];
            for (const pattern of dangerousBash) {
                if (pattern.test(code)) {
                    return {
                        safe: false,
                        reason: `Shell代码包含危险操作: ${pattern.source}`
                    };
                }
            }
            break;
        }
    }
    
    return { safe: true, reason: null };
}

/**
 * 确保临时目录存在
 */
function ensureTempDir() {
    if (!fs.existsSync(EXECUTION_CONFIG.tempDir)) {
        fs.mkdirSync(EXECUTION_CONFIG.tempDir, { recursive: true });
    }
}

// 注册工具
registry.register(
    'code_execution',
    {
        description: '在安全沙箱中执行代码（支持Python、JavaScript、Bash）。\n\n**安全特性**:\n- 超时保护（默认30秒）\n- 输出大小限制（1MB）\n- 危险关键词过滤\n- 进程隔离执行\n\n**参数优先级**:\n1. 如果同时提供code和language参数，直接执行\n2. 如果提供scriptPath参数，读取文件并识别语言\n3. 否则使用默认Python',
        parameters: {
            type: 'object',
            properties: {
                language: { 
                    type: 'string', 
                    description: '编程语言：python/javascript/bash/shell/sh/node（可选，默认根据脚本扩展名或内容自动识别）', 
                    enum: ['python', 'py', 'javascript', 'js', 'node', 'bash', 'shell', 'sh'] 
                },
                code: { 
                    type: 'string', 
                    description: '要执行的代码内容（如提供此参数，则忽略scriptPath）' 
                },
                scriptPath: { 
                    type: 'string', 
                    description: '脚本文件路径（自动根据扩展名识别语言：.py .js .sh）' 
                },
                timeout: { 
                    type: 'number', 
                    description: '执行超时时间（毫秒，默认30000）' 
                },
                cwd: { 
                    type: 'string', 
                    description: '执行工作目录（可选）' 
                }
            }
            // 至少提供code或scriptPath中的一个
        }
    },
    async (params, context) => {
        try {
            let language = params.language;
            let code = params.code;
            
            // 如果提供scriptPath，读取文件并识别语言
            if (params.scriptPath && !code) {
                const fs = require('fs');
                if (!fs.existsSync(params.scriptPath)) {
                    return `❌ 脚本文件不存在: ${params.scriptPath}`;
                }
                
                code = fs.readFileSync(params.scriptPath, 'utf-8');
                
                // 根据文件扩展名识别语言
                if (!language) {
                    const ext = path.extname(params.scriptPath).toLowerCase();
                    switch (ext) {
                        case '.py': language = 'python'; break;
                        case '.js': language = 'javascript'; break;
                        case '.sh': language = 'bash'; break;
                        default: language = 'python';
                    }
                }
            }
            
            // 如果没有代码，报错
            if (!code) {
                return '❌ 请提供要执行的代码内容或脚本文件路径';
            }
            
            // 如果没有指定语言，根据代码内容猜测
            if (!language) {
                if (code.trim().startsWith('#!/usr/bin/env python') || code.includes('import ') && code.includes('def ') || code.includes('print(')) {
                    language = 'python';
                } else if (code.trim().startsWith('#!/usr/bin/env node') || code.includes('console.log(') || code.includes('const ') || code.includes('let ') || code.includes('function ')) {
                    language = 'javascript';
                } else if (code.trim().startsWith('#!/bin/bash') || code.includes('echo ') || code.includes('mkdir ') || code.includes('cd ')) {
                    language = 'bash';
                } else {
                    language = 'python'; // 默认
                }
            }
            
            console.log(`[CodeExecution] 执行 ${language} 代码, 长度: ${code.length} 字符`);
            
            const result = await executeCodeInSandbox(language, code, {
                timeout: params.timeout,
                cwd: params.cwd
            });
            
            // 格式化输出
            let output = `✅ 代码执行完成\n\n`;
            output += `🤖 **语言**: ${result.language}\n`;
            output += `⏱️ **执行时间**: ${result.executionTime}ms\n`;
            output += `➡️ **退出码**: ${result.exitCode}\n`;
            output += `📊 **输出大小**: ${result.outputSize} 字节\n\n`;
            
            if (result.stdout) {
                output += `📤 **标准输出**:\n\`\`\`\n${result.stdout}\n\`\`\`\n\n`;
            }
            
            if (result.stderr) {
                output += `⚠️ **标准错误**:\n\`\`\`\n${result.stderr}\n\`\`\`\n`;
            }
            
            // 如果执行失败且有错误输出
            if (!result.success && result.stderr) {
                output += `\n💡 **调试建议**: 检查代码语法和逻辑错误`;
            }
            
            return output;
            
        } catch (error) {
            return `❌ 代码执行失败: ${error.message}`;
        }
    },
    {
        icon: '💻',
        label: '代码执行'
    }
);

console.log('[Tool] code_execution registered');

// 导出函数供其他模块使用
module.exports = { executeCodeInSandbox, checkCodeSafety, EXECUTION_CONFIG };