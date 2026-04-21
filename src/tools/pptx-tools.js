const registry = require('./index');
const { PptxParser, generateHtml } = require('./pptx-to-html');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

registry.register(
    'pptx_parse',
    {
        description: '解析PPTX文件，提取完整的幻灯片结构数据，包括母版(Master)、版式(Layout)、主题(Theme)层面的所有元素。返回JSON格式的结构化数据，包含每页的元素位置、文本、样式、图片、表格等。支持继承链合并（Slide→Layout→Master→Theme）。',
        parameters: {
            type: 'object',
            properties: {
                file_path: {
                    type: 'string',
                    description: 'PPTX文件的路径'
                },
                output_format: {
                    type: 'string',
                    description: '输出格式：json（结构化数据）、summary（摘要）、both（两者都输出），默认 summary',
                    enum: ['json', 'summary', 'both']
                }
            },
            required: ['file_path']
        }
    },
    async (params, context) => {
        const { file_path, output_format = 'summary' } = params;
        if (!file_path) return '请提供 file_path';

        const resolvedPath = path.resolve(file_path);
        if (!fs.existsSync(resolvedPath)) return `❌ 文件不存在: ${file_path}`;
        if (!resolvedPath.endsWith('.pptx')) return '❌ 仅支持 .pptx 格式文件';

        try {
            const parser = new PptxParser();
            const data = await parser.parse(resolvedPath);

            if (output_format === 'json') {
                const jsonStr = JSON.stringify(data, (key, value) => {
                    if (key === 'src' && typeof value === 'string' && value.startsWith('data:') && value.length > 5000) {
                        return value.substring(0, 100) + `...[TRUNCATED ${Math.round(value.length / 1024)}KB]`;
                    }
                    if (key === 'dataUrl' && typeof value === 'string' && value.length > 5000) {
                        return value.substring(0, 100) + `...[TRUNCATED ${Math.round(value.length / 1024)}KB]`;
                    }
                    if (key === 'base64' && typeof value === 'string' && value.length > 5000) {
                        return value.substring(0, 100) + `...[TRUNCATED ${Math.round(value.length / 1024)}KB]`;
                    }
                    if (key === 'data' && value && typeof value === 'object' && value.type === 'Buffer') {
                        return `[Buffer ${value.data?.length || 0} bytes]`;
                    }
                    return value;
                }, 2);
                if (jsonStr.length > 100000) {
                    const outPath = resolvedPath.replace('.pptx', '.parsed.json');
                    fs.writeFileSync(outPath, jsonStr, 'utf-8');
                    return `✅ 解析完成，JSON 数据已保存到: ${outPath}\n（数据量 ${Math.round(jsonStr.length / 1024)}KB，共 ${data.slides.length} 页）`;
                }
                return jsonStr;
            }

            const lines = [];
            lines.push(`📊 PPTX 解析结果: ${path.basename(resolvedPath)}`);
            lines.push(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
            lines.push(`📐 画布: ${data.slideWidthPx}×${data.slideHeightPx} pt`);
            lines.push(`📄 总页数: ${data.slides.length}`);
            lines.push(`🖼️ 嵌入图片: ${data.imageCount} 张`);
            lines.push('');

            if (data.theme) {
                lines.push('🎨 主题:');
                if (data.theme.fonts?.major?.latin) lines.push(`   标题字体: ${data.theme.fonts.major.latin}`);
                if (data.theme.fonts?.minor?.latin) lines.push(`   正文字体: ${data.theme.fonts.minor.latin}`);
                const colorNames = Object.keys(data.theme.colors || {});
                if (colorNames.length > 0) {
                    lines.push(`   配色方案: ${colorNames.join(', ')}`);
                }
                lines.push('');
            }

            for (const slide of data.slides) {
                lines.push(`━━━ 第 ${slide.index} 页 ━━━`);

                const masterEls = slide.elements.filter(e => e.source === 'master');
                const layoutEls = slide.elements.filter(e => e.source === 'layout');
                const slideEls = slide.elements.filter(e => e.source === 'slide');

                if (slide.background) {
                    let bgInfo = slide.background.type;
                    if (slide.background.color) bgInfo += ` ${slide.background.color}`;
                    if (slide.background.type === 'blip') bgInfo += ' [图片背景]';
                    lines.push(`   🖼️ 背景: ${bgInfo}`);
                }
                if (masterEls.length > 0) lines.push(`   🔴 母版元素: ${masterEls.length} 个`);
                if (layoutEls.length > 0) lines.push(`   🟡 版式元素: ${layoutEls.length} 个`);
                if (slideEls.length > 0) lines.push(`   🟢 页面元素: ${slideEls.length} 个`);

                if (slide.defaultTextStyles) {
                    const dts = slide.defaultTextStyles;
                    const styleInfo = [];
                    if (dts.title?.levels) styleInfo.push(`标题:${Object.keys(dts.title.levels).length}级`);
                    if (dts.body?.levels) styleInfo.push(`正文:${Object.keys(dts.body.levels).length}级`);
                    if (dts.other?.levels) styleInfo.push(`其他:${Object.keys(dts.other.levels).length}级`);
                    if (styleInfo.length > 0) lines.push(`   📋 默认文本样式: ${styleInfo.join(', ')}`);
                }

                for (const el of slide.elements) {
                    const src = el.source === 'master' ? '🔴' : el.source === 'layout' ? '🟡' : '🟢';
                    if (el.type === 'shape') {
                        const text = el.text ? ` "${el.text.slice(0, 40)}${el.text.length > 40 ? '...' : ''}"` : '';
                        const ph = el.placeholder ? ` [占位符:${el.placeholder.type}]` : '';
                        const shape = el.shapeType && el.shapeType !== 'rect' ? ` [${el.shapeType}]` : '';
                        const shadow = el.shadow ? ' [阴影]' : '';
                        lines.push(`   ${src} 📝 文本框${ph}${shape}${shadow}${text}`);
                        if (el.textRuns) {
                            for (const r of el.textRuns) {
                                const styles = [];
                                if (r.fontSize) styles.push(`${r.fontSize}pt`);
                                if (r.bold) styles.push('加粗');
                                if (r.italic) styles.push('斜体');
                                if (r.color) styles.push(r.color);
                                if (r.fontFamily) styles.push(r.fontFamily);
                                if (styles.length > 0) lines.push(`      样式: ${styles.join(' | ')}`);
                            }
                        }
                    } else if (el.type === 'image') {
                        const vector = el.isVector ? ' [矢量]' : '';
                        lines.push(`   ${src} 🖼️ 图片${vector}${el.name ? ` "${el.name}"` : ''}${el.srcMime ? ` (${el.srcMime})` : ''}`);
                    } else if (el.type === 'table') {
                        lines.push(`   ${src} 📊 表格 ${el.rows?.length || 0}行×${el.cols?.length || el.rows?.[0]?.length || 0}列`);
                    } else if (el.type === 'group') {
                        lines.push(`   ${src} 📦 组合 (${el.children?.length || 0}个子元素)`);
                    } else if (el.type === 'connector') {
                        lines.push(`   ${src} 🔗 连接线`);
                    }
                }

                if (slide.transition) {
                    lines.push(`   🔄 切换: ${slide.transition.type}`);
                }
                lines.push('');
            }

            if (output_format === 'both') {
                const outPath = resolvedPath.replace('.pptx', '.parsed.json');
                fs.writeFileSync(outPath, JSON.stringify(data, null, 2), 'utf-8');
                lines.push(`\n✅ 完整JSON数据已保存到: ${outPath}`);
            }

            return lines.join('\n');
        } catch (err) {
            console.error('[pptx_parse] Error:', err);
            return `❌ PPTX 解析失败: ${err.message}`;
        }
    },
    { icon: '📊', label: 'PPT解析' }
);

registry.register(
    'pptx_to_html',
    {
        description: '将PPTX文件转换为可交互的HTML演示文稿。支持精确还原元素位置、样式、图片、表格。自动合并母版/版式/幻灯片三层继承。支持键盘翻页、缩略图导航、图层来源显示。',
        parameters: {
            type: 'object',
            properties: {
                file_path: {
                    type: 'string',
                    description: 'PPTX文件的路径'
                },
                output_path: {
                    type: 'string',
                    description: '输出HTML文件路径（默认与PPTX同目录）'
                },
                title: {
                    type: 'string',
                    description: '演示文稿标题（默认使用文件名）'
                },
                open: {
                    type: 'boolean',
                    description: '是否自动在浏览器中打开（默认 true）'
                }
            },
            required: ['file_path']
        }
    },
    async (params, context) => {
        const { file_path, output_path, title, open = true } = params;
        if (!file_path) return '请提供 file_path';

        const resolvedPath = path.resolve(file_path);
        if (!fs.existsSync(resolvedPath)) return `❌ 文件不存在: ${file_path}`;
        if (!resolvedPath.endsWith('.pptx')) return '❌ 仅支持 .pptx 格式文件';

        try {
            const parser = new PptxParser();
            const data = await parser.parse(resolvedPath);

            const htmlTitle = title || path.basename(resolvedPath, '.pptx');
            const outPath = output_path || resolvedPath.replace('.pptx', '.html');
            const outputDir = path.dirname(outPath);

            const html = generateHtml(data, { title: htmlTitle, outputDir });
            fs.writeFileSync(outPath, html, 'utf-8');

            if (open) {
                const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
                exec(`${cmd} "${outPath}"`, (err) => {
                    if (err) console.error('[pptx_to_html] Failed to open browser:', err.message);
                });
            }

            return `✅ HTML 演示文稿已生成!\n📄 文件: ${outPath}\n📊 页数: ${data.slides.length}\n🖼️ 图片: ${data.imageCount} 张\n📐 画布: ${data.slideWidthPx}×${data.slideHeightPx} pt\n\n💡 提示: 按左右箭头键翻页，点击"显示图层"可查看元素来源（母版/版式/页面）`;
        } catch (err) {
            console.error('[pptx_to_html] Error:', err);
            return `❌ PPTX 转换失败: ${err.message}`;
        }
    },
    { icon: '🎬', label: 'PPT转HTML' }
);

console.log('[Tool] pptx_parse, pptx_to_html registered');
