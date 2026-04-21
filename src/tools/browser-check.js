// tools/browser-check.js — 浏览器自动化检查工具（深度集成 Playwright MCP）
// 通过 Playwright MCP HTTP 服务模式（--port）提供浏览器自动化能力
// 支持截图、快照、控制台检查、网络检查、性能检测、SEO检查等
const registry = require('./index');

// Playwright MCP 服务地址（默认本地 8931 端口）
const MCP_BASE = process.env.MCP_PLAYWRIGHT_URL || 'http://localhost:8931/mcp';

// 存储检查结果的工作目录
const OUTPUT_DIR = 'Data/browser-check';

/**
 * 通用 MCP 调用函数
 */
async function callMCP(method, params = {}) {
    const http = require('http');
    const url = new URL(MCP_BASE);
    
    const body = JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'tools/call',
        params: {
            name: method,
            arguments: params
        }
    });

    return new Promise((resolve, reject) => {
        const req = http.request({
            hostname: url.hostname,
            port: url.port,
            path: url.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (json.error) {
                        reject(new Error(json.error.message || JSON.stringify(json.error)));
                    } else {
                        // MCP 返回格式: { result: { content: [{ type: "text", text: "..." }] } }
                        const content = json.result?.content;
                        if (Array.isArray(content)) {
                            resolve(content.map(c => c.text || '').join('\n'));
                        } else {
                            resolve(JSON.stringify(json.result, null, 2));
                        }
                    }
                } catch (e) {
                    resolve(data); // 原始文本返回
                }
            });
        });

        req.on('error', reject);
        req.setTimeout(30000, () => {
            req.destroy();
            reject(new Error('MCP 请求超时（30s）'));
        });
        req.write(body);
        req.end();
    });
}

/**
 * 启动 Playwright MCP 服务（如果未运行）
 */
async function ensureMCPRunning(context) {
    // 先检测服务是否已经在运行
    try {
        await callMCP('browser_snapshot', {});
        return true;
    } catch (e) {
        // 服务未运行，尝试启动
    }

    // 通过 shell_execute 启动 MCP 服务
    const messageBus = require('../core/message-bus');
    return new Promise((resolve) => {
        const handler = (data) => {
            if (data.module === 'shell') {
                messageBus.unsubscribe('EXECUTE_RESULT', handler);
                // 给服务 2 秒启动时间
                setTimeout(() => {
                    resolve(data.status === 'success');
                }, 2000);
            }
        };

        messageBus.subscribe('EXECUTE_RESULT', handler);
        messageBus.publish('EXECUTE', {
            moduleName: 'shell',
            params: {
                command: 'npx @playwright/mcp@latest --port 8931 --headless &',
                cwd: context.workFolder || process.cwd()
            }
        });

        setTimeout(() => {
            messageBus.unsubscribe('EXECUTE_RESULT', handler);
            resolve(false);
        }, 15000);
    });
}

// ══════════════════════════════════════
// 工具 1：浏览器自动化检查（综合）
// ══════════════════════════════════════
registry.register(
    'browser_check',
    {
        description: '对指定网站进行自动化浏览器检查。支持多种检查类型：snapshot(页面结构快照)、console(控制台错误)、network(网络请求)、performance(性能指标)、seo(SEO标签)、screenshot(截图)、full(全面检查)。会启动 Playwright MCP 服务进行真实浏览器操作。',
        parameters: {
            type: 'object',
            properties: {
                url: {
                    type: 'string',
                    description: '要检查的网站URL，例如 https://example.com'
                },
                type: {
                    type: 'string',
                    enum: ['snapshot', 'console', 'network', 'performance', 'seo', 'screenshot', 'full'],
                    description: '检查类型：snapshot=页面结构, console=控制台错误, network=网络请求, performance=性能指标, seo=SEO标签, screenshot=截图, full=全面检查'
                },
                waitFor: {
                    type: 'number',
                    description: '页面加载后等待时间（毫秒），默认 2000'
                }
            },
            required: ['url', 'type']
        }
    },
    async (params, context) => {
        const { url, type = 'snapshot', waitFor = 2000 } = params;

        try {
            // 确保 MCP 服务运行
            await ensureMCPRunning(context);

            // 1. 导航到目标页面
            await callMCP('browser_navigate', { url });

            // 等待页面加载
            if (waitFor > 0) {
                await callMCP('browser_wait_for', { time: waitFor });
            }

            let result = '';

            switch (type) {
                case 'snapshot': {
                    const snapshot = await callMCP('browser_snapshot', {});
                    result = `📋 页面结构快照 (${url})\n${'─'.repeat(50)}\n${snapshot}`;
                    break;
                }

                case 'console': {
                    const console = await callMCP('browser_console_messages', { level: 'error' });
                    result = `🔴 控制台错误 (${url})\n${'─'.repeat(50)}\n${console || '✅ 无控制台错误'}`;
                    break;
                }

                case 'network': {
                    const network = await callMCP('browser_network_requests', {});
                    result = `🌐 网络请求 (${url})\n${'─'.repeat(50)}\n${network}`;
                    break;
                }

                case 'performance': {
                    // 通过 JS 执行获取性能指标
                    const perfCode = `
                        const timing = performance.timing;
                        const nav = performance.getEntriesByType('navigation')[0] || {};
                        const paint = performance.getEntriesByType('paint');
                        const fcp = paint.find(p => p.name === 'first-contentful-paint');
                        const lcp = paint.find(p => p.name === 'largest-contentful-paint');
                        JSON.stringify({
                            dns: timing.domainLookupEnd - timing.domainLookupStart,
                            tcp: timing.connectEnd - timing.connectStart,
                            ttfb: timing.responseStart - timing.requestStart,
                            domReady: timing.domContentLoadedEventEnd - timing.navigationStart,
                            load: timing.loadEventEnd - timing.navigationStart,
                            domInteractive: timing.domInteractive - timing.navigationStart,
                            fcp: fcp ? fcp.startTime : 'N/A',
                            transferSize: nav.transferSize || 'N/A',
                            resourceCount: performance.getEntriesByType('resource').length,
                            totalResourceSize: performance.getEntriesByType('resource').reduce((s, r) => s + (r.transferSize || 0), 0)
                        });
                    `;
                    const perfResult = await callMCP('browser_evaluate', { function: perfCode });
                    try {
                        const perf = JSON.parse(perfResult.match(/\{[\s\S]*\}/)?.[0] || '{}');
                        result = `⚡ 性能指标 (${url})\n${'─'.repeat(50)}\n`;
                        result += `DNS 查询:       ${perf.dns}ms\n`;
                        result += `TCP 连接:       ${perf.tcp}ms\n`;
                        result += `TTFB (首字节):  ${perf.ttfb}ms\n`;
                        result += `DOM 解析:       ${perf.domInteractive}ms\n`;
                        result += `DOM Ready:      ${perf.domReady}ms\n`;
                        result += `页面加载:       ${perf.load}ms\n`;
                        result += `FCP (首次绘制): ${perf.fcp}ms\n`;
                        result += `传输大小:       ${typeof perf.transferSize === 'number' ? (perf.transferSize / 1024).toFixed(1) + 'KB' : perf.transferSize}\n`;
                        result += `资源请求数:     ${perf.resourceCount}\n`;
                        result += `资源总大小:     ${typeof perf.totalResourceSize === 'number' ? (perf.totalResourceSize / 1024).toFixed(1) + 'KB' : perf.totalResourceSize}\n`;
                        // 性能评级
                        const score = perf.load < 1000 ? '🟢 优秀' : perf.load < 3000 ? '🟡 一般' : '🔴 较慢';
                        result += `\n综合评级: ${score} (加载时间 ${perf.load}ms)`;
                    } catch {
                        result = `⚡ 性能指标 (${url})\n${'─'.repeat(50)}\n${perfResult}`;
                    }
                    break;
                }

                case 'seo': {
                    const seoCode = `
                        const meta = (name) => {
                            const el = document.querySelector('meta[name="' + name + '"]') || document.querySelector('meta[property="og:' + name + '"]');
                            return el ? el.getAttribute('content') : null;
                        };
                        JSON.stringify({
                            title: document.title,
                            titleLen: document.title.length,
                            description: meta('description'),
                            keywords: meta('keywords'),
                            ogTitle: meta('title'),
                            ogDescription: meta('description'),
                            ogImage: meta('image'),
                            canonical: document.querySelector('link[rel="canonical"]')?.href,
                            h1Count: document.querySelectorAll('h1').length,
                            h1Texts: [...document.querySelectorAll('h1')].map(h => h.textContent.trim()).slice(0, 5),
                            h2Count: document.querySelectorAll('h2').length,
                            imgCount: document.querySelectorAll('img').length,
                            imgNoAlt: document.querySelectorAll('img:not([alt])').length,
                            linkCount: document.querySelectorAll('a').length,
                            linkNoHref: document.querySelectorAll('a:not([href])').length,
                            hasRobots: !!document.querySelector('meta[name="robots"]'),
                            hasViewport: !!document.querySelector('meta[name="viewport"]'),
                            lang: document.documentElement.lang,
                            charset: document.characterSet,
                            isHttps: location.protocol === 'https:'
                        });
                    `;
                    const seoResult = await callMCP('browser_evaluate', { function: seoCode });
                    try {
                        const seo = JSON.parse(seoResult.match(/\{[\s\S]*\}/)?.[0] || '{}');
                        result = `🔍 SEO 检查 (${url})\n${'─'.repeat(50)}\n`;
                        result += `页面标题:       ${seo.title || '❌ 缺失'} (${seo.titleLen}字符)\n`;
                        result += `描述:           ${seo.description || '⚠️ 缺失'}\n`;
                        result += `关键词:         ${seo.keywords || '⚠️ 缺失'}\n`;
                        result += `Canonical:      ${seo.canonical || '⚠️ 缺失'}\n`;
                        result += `OG 标题:        ${seo.ogTitle || '⚠️ 缺失'}\n`;
                        result += `OG 描述:        ${seo.ogDescription || '⚠️ 缺失'}\n`;
                        result += `OG 图片:        ${seo.ogImage ? '✅ 有' : '⚠️ 缺失'}\n`;
                        result += `H1 标签:        ${seo.h1Count} 个 ${seo.h1Count === 1 ? '✅' : seo.h1Count === 0 ? '❌ 缺失' : '⚠️ 多个'}\n`;
                        if (seo.h1Texts?.length) result += `  → ${seo.h1Texts.join(' | ')}\n`;
                        result += `H2 标签:        ${seo.h2Count} 个\n`;
                        result += `图片:           ${seo.imgCount} 个，${seo.imgNoAlt} 个缺少 alt ${seo.imgNoAlt === 0 ? '✅' : '⚠️'}\n`;
                        result += `链接:           ${seo.linkCount} 个，${seo.linkNoHref} 个缺少 href\n`;
                        result += `Robots:         ${seo.hasRobots ? '✅' : '⚠️ 缺失'}\n`;
                        result += `Viewport:       ${seo.hasViewport ? '✅' : '❌ 缺失'}\n`;
                        result += `语言:           ${seo.lang || '⚠️ 未设置'}\n`;
                        result += `编码:           ${seo.charset}\n`;
                        result += `HTTPS:          ${seo.isHttps ? '✅' : '⚠️ 非 HTTPS'}\n`;
                    } catch {
                        result = `🔍 SEO 检查 (${url})\n${'─'.repeat(50)}\n${seoResult}`;
                    }
                    break;
                }

                case 'screenshot': {
                    const fs = require('fs');
                    const dir = context.workFolder
                        ? require('path').join(context.workFolder, OUTPUT_DIR)
                        : OUTPUT_DIR;
                    // 确保输出目录存在
                    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                    const filename = require('path').join(dir, `screenshot-${Date.now()}.png`);
                    await callMCP('browser_take_screenshot', { filename, fullPage: true });
                    result = `📸 截图完成 (${url})\n${'─'.repeat(50)}\n保存路径: ${filename}`;
                    break;
                }

                case 'full': {
                    // 全面检查
                    const lines = [];
                    lines.push(`🔬 全面检查报告 (${url})`);
                    lines.push('═'.repeat(60));

                    // 截图
                    try {
                        const fs = require('fs');
                        const dir = context.workFolder
                            ? require('path').join(context.workFolder, OUTPUT_DIR)
                            : OUTPUT_DIR;
                        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                        const filename = require('path').join(dir, `check-${Date.now()}.png`);
                        await callMCP('browser_take_screenshot', { filename, fullPage: true });
                        lines.push(`\n📸 截图: ${filename}`);
                    } catch (e) {
                        lines.push(`\n📸 截图失败: ${e.message}`);
                    }

                    // 控制台错误
                    try {
                        const consoleErrors = await callMCP('browser_console_messages', { level: 'error' });
                        lines.push(`\n🔴 控制台错误:\n${consoleErrors || '✅ 无错误'}`);
                    } catch (e) {
                        lines.push(`\n🔴 控制台检查失败: ${e.message}`);
                    }

                    // 网络请求
                    try {
                        const network = await callMCP('browser_network_requests', {});
                        lines.push(`\n🌐 网络请求:\n${network}`);
                    } catch (e) {
                        lines.push(`\n🌐 网络检查失败: ${e.message}`);
                    }

                    // 性能
                    try {
                        const perfCode = `
                            const timing = performance.timing;
                            const nav = performance.getEntriesByType('navigation')[0] || {};
                            const paint = performance.getEntriesByType('paint');
                            const fcp = paint.find(p => p.name === 'first-contentful-paint');
                            JSON.stringify({
                                ttfb: timing.responseStart - timing.requestStart,
                                domReady: timing.domContentLoadedEventEnd - timing.navigationStart,
                                load: timing.loadEventEnd - timing.navigationStart,
                                fcp: fcp ? fcp.startTime : 'N/A',
                                transferSize: nav.transferSize || 'N/A',
                                resourceCount: performance.getEntriesByType('resource').length
                            });
                        `;
                        const perfResult = await callMCP('browser_evaluate', { function: perfCode });
                        const perf = JSON.parse(perfResult.match(/\{[\s\S]*\}/)?.[0] || '{}');
                        lines.push(`\n⚡ 性能指标:`);
                        lines.push(`  TTFB: ${perf.ttfb}ms | DOM Ready: ${perf.domReady}ms | 加载: ${perf.load}ms`);
                        lines.push(`  FCP: ${perf.fcp}ms | 资源数: ${perf.resourceCount} | 传输: ${typeof perf.transferSize === 'number' ? (perf.transferSize / 1024).toFixed(1) + 'KB' : perf.transferSize}`);
                    } catch (e) {
                        lines.push(`\n⚡ 性能检查失败: ${e.message}`);
                    }

                    // SEO
                    try {
                        const seoCode = `
                            JSON.stringify({
                                title: document.title, titleLen: document.title.length,
                                desc: (document.querySelector('meta[name="description"]') || {}).content || null,
                                h1: document.querySelectorAll('h1').length,
                                h1Texts: [...document.querySelectorAll('h1')].map(h => h.textContent.trim()).slice(0, 3),
                                imgNoAlt: document.querySelectorAll('img:not([alt])').length,
                                hasViewport: !!document.querySelector('meta[name="viewport"]'),
                                lang: document.documentElement.lang,
                                https: location.protocol === 'https:'
                            });
                        `;
                        const seoResult = await callMCP('browser_evaluate', { function: seoCode });
                        const seo = JSON.parse(seoResult.match(/\{[\s\S]*\}/)?.[0] || '{}');
                        lines.push(`\n🔍 SEO 概要:`);
                        lines.push(`  标题: ${seo.title || '❌'} (${seo.titleLen}字符)`);
                        lines.push(`  描述: ${seo.desc || '⚠️ 缺失'}`);
                        lines.push(`  H1: ${seo.h1}个 ${seo.h1Texts?.join(' | ') || ''}`);
                        lines.push(`  图片缺 alt: ${seo.imgNoAlt}个 | Viewport: ${seo.hasViewport ? '✅' : '❌'} | HTTPS: ${seo.https ? '✅' : '⚠️'}`);
                    } catch (e) {
                        lines.push(`\n🔍 SEO 检查失败: ${e.message}`);
                    }

                    result = lines.join('\n');
                    break;
                }

                default:
                    result = `未知检查类型: ${type}`;
            }

            return result;

        } catch (error) {
            return `浏览器检查失败: ${error.message}\n\n提示: 请确保已安装 Playwright MCP（npm install @playwright/mcp）`;
        }
    },
    {
        icon: '🌐',
        label: '浏览器检查'
    }
);

// ══════════════════════════════════════
// 工具 2：浏览器自动化操作
// ══════════════════════════════════════
registry.register(
    'browser_action',
    {
        description: '通过 Playwright MCP 执行浏览器自动化操作。支持 navigate(导航)、click(点击)、type(输入)、screenshot(截图)、snapshot(快照)、evaluate(执行JS)、fill_form(填表)、wait(等待)等操作。可用于网站测试、数据采集、表单自动填写等。',
        parameters: {
            type: 'object',
            properties: {
                action: {
                    type: 'string',
                    enum: ['navigate', 'click', 'type', 'screenshot', 'snapshot', 'evaluate', 'fill_form', 'wait', 'go_back', 'press_key', 'get_console', 'get_network', 'close'],
                    description: '操作类型'
                },
                url: {
                    type: 'string',
                    description: '目标URL（navigate 时需要）'
                },
                target: {
                    type: 'string',
                    description: '目标元素描述（click/type 时需要），例如 "登录按钮" 或 "搜索输入框"'
                },
                text: {
                    type: 'string',
                    description: '要输入的文本（type 时需要）'
                },
                code: {
                    type: 'string',
                    description: '要执行的 JavaScript 代码（evaluate 时需要）'
                },
                fields: {
                    type: 'object',
                    description: '表单字段（fill_form 时需要），key 为字段描述，value 为要填的值'
                },
                key: {
                    type: 'string',
                    description: '按键名称（press_key 时需要），如 Enter、Tab、Escape'
                },
                duration: {
                    type: 'number',
                    description: '等待时间毫秒（wait 时需要），默认 1000'
                }
            },
            required: ['action']
        }
    },
    async (params, context) => {
        const { action } = params;

        try {
            await ensureMCPRunning(context);

            switch (action) {
                case 'navigate':
                    if (!params.url) return '请提供 url 参数';
                    await callMCP('browser_navigate', { url: params.url });
                    if (params.duration !== 0) {
                        await callMCP('browser_wait_for', { time: params.duration || 2000 });
                    }
                    return `✅ 已导航到 ${params.url}`;

                case 'click':
                    if (!params.target) return '请提供 target 参数（元素描述）';
                    await callMCP('browser_click', { target: params.target });
                    return `✅ 已点击: ${params.target}`;

                case 'type':
                    if (!params.target || !params.text) return '请提供 target 和 text 参数';
                    await callMCP('browser_type', { target: params.target, text: params.text });
                    return `✅ 已在 ${params.target} 输入文本`;

                case 'screenshot': {
                    const fs = require('fs');
                    const dir = context.workFolder
                        ? require('path').join(context.workFolder, OUTPUT_DIR)
                        : OUTPUT_DIR;
                    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                    const filename = require('path').join(dir, `action-${Date.now()}.png`);
                    await callMCP('browser_take_screenshot', { filename, fullPage: true });
                    return `📸 截图保存: ${filename}`;
                }

                case 'snapshot':
                    return await callMCP('browser_snapshot', {});

                case 'evaluate':
                    if (!params.code) return '请提供 code 参数';
                    return await callMCP('browser_evaluate', { function: params.code });

                case 'fill_form':
                    if (!params.fields) return '请提供 fields 参数';
                    await callMCP('browser_fill_form', { fields: params.fields });
                    return `✅ 已填充 ${Object.keys(params.fields).length} 个字段`;

                case 'wait':
                    await callMCP('browser_wait_for', { time: params.duration || 1000 });
                    return `✅ 已等待 ${params.duration || 1000}ms`;

                case 'go_back':
                    await callMCP('browser_navigate_back', {});
                    return '✅ 已返回上一页';

                case 'press_key':
                    await callMCP('browser_press_key', { key: params.key || 'Enter' });
                    return `✅ 已按键: ${params.key || 'Enter'}`;

                case 'get_console':
                    return await callMCP('browser_console_messages', {});

                case 'get_network':
                    return await callMCP('browser_network_requests', {});

                case 'close':
                    await callMCP('browser_close', {});
                    return '✅ 浏览器已关闭';

                default:
                    return `未知操作: ${action}`;
            }
        } catch (error) {
            return `浏览器操作失败: ${error.message}`;
        }
    },
    {
        icon: '🎭',
        label: '浏览器操作'
    }
);

console.log('[ToolRegistry] Browser check tools loaded: browser_check, browser_action');
