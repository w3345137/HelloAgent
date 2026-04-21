const PptxParser = require('./pptx-parser');
const fs = require('fs');
const path = require('path');

function generateHtml(pptxData, options = {}) {
    const { title = 'PPT Preview', theme = 'light', outputDir = null } = options;
    const slideW = pptxData.slideWidthPx;
    const slideH = pptxData.slideHeightPx;
    const scale = 960 / slideW;
    const scaledH = slideH * scale;

    const imageMap = {};
    if (outputDir) {
        const imgDir = path.join(outputDir, 'images');
        if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });

        _collectAllImages(pptxData.slides, imageMap);

        for (const [key, imgData] of Object.entries(imageMap)) {
            if (imgData.src && imgData.src.startsWith('data:')) {
                const ext = imgData.mime?.split('/')[1] || 'png';
                const fileName = `img_${imgData.id || key}.${ext}`;
                const filePath = path.join(imgDir, fileName);
                try {
                    const base64Data = imgData.src.replace(/^data:[^;]+;base64,/, '');
                    fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
                    imgData._srcFile = `images/${fileName}`;
                } catch (e) {
                    console.error(`[pptx-to-html] Failed to save image ${fileName}:`, e.message);
                }
            }
        }
    }

    const themeVars = _buildThemeVars(pptxData.theme);
    const slidesHtml = pptxData.slides.map((slide, i) => _renderSlide(slide, i, pptxData, scale, imageMap)).join('\n');

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${_esc(title)}</title>
<style>
:root {
  --slide-w: ${Math.round(slideW * scale)}px;
  --slide-h: ${Math.round(scaledH)}px;
  ${themeVars}
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: #1a1a2e; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; overflow: hidden; }

.toolbar {
  position: fixed; top: 0; left: 0; right: 0; height: 48px;
  background: #16213e; display: flex; align-items: center; padding: 0 16px;
  gap: 12px; z-index: 100; color: #e0e0e0; font-size: 14px;
}
.toolbar .title { font-weight: 600; flex: 1; }
.toolbar button {
  background: #0f3460; border: 1px solid #1a508b; color: #e0e0e0;
  padding: 6px 14px; border-radius: 6px; cursor: pointer; font-size: 13px;
}
.toolbar button:hover { background: #1a508b; }
.toolbar button.active { background: #e94560; border-color: #e94560; }

.slide-nav {
  position: fixed; top: 48px; left: 0; bottom: 0; width: 160px;
  background: #16213e; overflow-y: auto; padding: 8px;
}
.slide-thumb {
  width: 144px; height: ${Math.round(144 * scaledH / (slideW * scale))}px;
  margin-bottom: 8px; border-radius: 6px; overflow: hidden;
  cursor: pointer; border: 2px solid transparent; position: relative;
  background: white;
}
.slide-thumb.active { border-color: #e94560; }
.slide-thumb-num {
  position: absolute; bottom: 2px; right: 4px; font-size: 10px;
  background: rgba(0,0,0,0.5); color: white; padding: 1px 4px; border-radius: 3px;
}
.slide-thumb-inner {
  width: ${Math.round(slideW * scale)}px; height: ${Math.round(scaledH)}px;
  transform: scale(${144 / (slideW * scale)});
  transform-origin: top left;
}

.stage {
  position: fixed; top: 48px; left: 160px; right: 0; bottom: 0;
  display: flex; align-items: center; justify-content: center;
  background: #1a1a2e;
}
.slide-frame {
  width: var(--slide-w); height: var(--slide-h);
  background: white; border-radius: 4px; overflow: hidden;
  box-shadow: 0 8px 32px rgba(0,0,0,0.4);
  position: relative;
}

.slide-page { display: none; width: 100%; height: 100%; position: relative; overflow: hidden; }
.slide-page.active { display: block; }

.el {
  position: absolute; overflow: hidden;
}
.el-shape { }
.el-text {
  word-wrap: break-word; white-space: pre-wrap;
}
.el-image { }
.el-image img { width: 100%; height: 100%; object-fit: contain; }
.el-table { border-collapse: collapse; width: 100%; height: 100%; }
.el-table td { border: 1px solid #d0d0d0; padding: 4px 8px; vertical-align: top; font-size: 12px; }
.el-connector { }
.el-vector-placeholder {
  display: flex; align-items: center; justify-content: center;
  background: #f0f0f0; color: #999; font-size: 10px;
  border: 1px dashed #ccc;
}

.slide-bg {
  position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: 0;
}
.slide-elements { position: relative; z-index: 1; width: 100%; height: 100%; }

.source-badge {
  position: absolute; top: 2px; right: 2px; font-size: 8px;
  padding: 1px 4px; border-radius: 2px; opacity: 0.6;
  pointer-events: none;
}
.source-master { background: #ff6b6b; color: white; }
.source-layout { background: #ffd93d; color: #333; }
.source-slide { background: #6bcb77; color: white; }

.vertical-text {
  writing-mode: vertical-rl;
  text-orientation: mixed;
}

@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
.slide-page.active { animation: fadeIn 0.15s ease; }

@media print {
  .toolbar, .slide-nav { display: none; }
  .stage { position: static; }
  .slide-page { display: block !important; page-break-after: always; }
}
</style>
</head>
<body>

<div class="toolbar">
  <span class="title">${_esc(title)}</span>
  <button onclick="prevSlide()">◀ 上一页</button>
  <span id="pageInfo">1 / ${pptxData.slides.length}</span>
  <button onclick="nextSlide()">下一页 ▶</button>
  <button id="btnLayer" onclick="toggleLayers()">显示图层</button>
  <button onclick="exportHtml()">导出HTML</button>
</div>

<div class="slide-nav" id="slideNav">
  ${pptxData.slides.map((s, i) => `
  <div class="slide-thumb${i === 0 ? ' active' : ''}" onclick="goSlide(${i})">
    <div class="slide-thumb-inner">${_renderSlideContent(s, pptxData, scale * 144 / (slideW * scale), imageMap)}</div>
    <span class="slide-thumb-num">${i + 1}</span>
  </div>`).join('')}
</div>

<div class="stage">
  <div class="slide-frame">
    ${pptxData.slides.map((s, i) => `
    <div class="slide-page${i === 0 ? ' active' : ''}" id="slide${i}">
      ${_renderSlideContent(s, pptxData, scale, imageMap)}
    </div>`).join('')}
  </div>
</div>

<script>
let current = 0;
const total = ${pptxData.slides.length};
let showLayers = false;

function goSlide(n) {
  current = n;
  document.querySelectorAll('.slide-page').forEach((p, i) => p.classList.toggle('active', i === n));
  document.querySelectorAll('.slide-thumb').forEach((t, i) => t.classList.toggle('active', i === n));
  document.getElementById('pageInfo').textContent = (n + 1) + ' / ' + total;
}
function prevSlide() { if (current > 0) goSlide(current - 1); }
function nextSlide() { if (current < total - 1) goSlide(current + 1); }
function toggleLayers() {
  showLayers = !showLayers;
  document.querySelectorAll('.source-badge').forEach(b => b.style.display = showLayers ? 'block' : 'none');
  document.getElementById('btnLayer').classList.toggle('active', showLayers);
}
function exportHtml() {
  const html = document.documentElement.outerHTML;
  const blob = new Blob([html], {type: 'text/html'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '${_esc(title)}.html';
  a.click();
}
document.addEventListener('keydown', e => {
  if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') prevSlide();
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ') nextSlide();
  if (e.key === 'Home') goSlide(0);
  if (e.key === 'End') goSlide(total - 1);
});
</script>
</body>
</html>`;
}

function _collectAllImages(slides, imageMap) {
    for (const slide of slides) {
        _collectImagesFromElements(slide.elements || [], imageMap);
        if (slide.background && slide.background.src && slide.background.src.startsWith('data:')) {
            const key = `bg_${slide.index}`;
            imageMap[key] = { src: slide.background.src, mime: slide.background.srcMime, id: key };
        }
    }
}

function _collectImagesFromElements(elements, imageMap) {
    for (const el of elements) {
        if (el.type === 'image' && el.src && el.src.startsWith('data:')) {
            imageMap[el.id || el.name || `img_${Object.keys(imageMap).length}`] = {
                src: el.src, mime: el.srcMime, id: el.id
            };
        }
        if (el.type === 'shape' && el.fill && el.fill.type === 'blip' && el.fill.src && el.fill.src.startsWith('data:')) {
            const key = `fill_${el.id || Object.keys(imageMap).length}`;
            imageMap[key] = { src: el.fill.src, mime: el.fill.srcMime, id: el.id };
        }
        if (el.type === 'group' && el.children) {
            _collectImagesFromElements(el.children, imageMap);
        }
    }
}

function _getImageSrc(el, imageMap) {
    if (el._srcFile) return el._srcFile;
    if (imageMap && el.id && imageMap[el.id]?._srcFile) return imageMap[el.id]._srcFile;
    if (el.src && !el.src.startsWith('data:')) return el.src;
    return el.src || '';
}

function _getFillImageSrc(fill, imageMap, elId) {
    if (fill._srcFile) return fill._srcFile;
    const key = `fill_${elId}`;
    if (imageMap && imageMap[key]?._srcFile) return imageMap[key]._srcFile;
    if (fill.src && !fill.src.startsWith('data:')) return fill.src;
    return fill.src || '';
}

function _buildThemeVars(theme) {
    if (!theme || !theme.colors) return '';
    const vars = [];
    const nameMap = {
        dk1: '--theme-dk1', lt1: '--theme-lt1', dk2: '--theme-dk2', lt2: '--theme-lt2',
        accent1: '--theme-accent1', accent2: '--theme-accent2', accent3: '--theme-accent3',
        accent4: '--theme-accent4', accent5: '--theme-accent5', accent6: '--theme-accent6',
        hlink: '--theme-hlink', folHlink: '--theme-folHlink'
    };
    for (const [key, varName] of Object.entries(nameMap)) {
        if (theme.colors[key]) vars.push(`  ${varName}: ${theme.colors[key]};`);
    }
    if (theme.fonts?.major?.latin) vars.push(`  --font-major: '${theme.fonts.major.latin}', sans-serif;`);
    if (theme.fonts?.minor?.latin) vars.push(`  --font-minor: '${theme.fonts.minor.latin}', sans-serif;`);
    return vars.join('\n');
}

function _renderSlide(slide, index, pptxData, scale, imageMap) {
    return `<div class="slide-page" id="slide${index}">${_renderSlideContent(slide, pptxData, scale, imageMap)}</div>`;
}

function _renderSlideContent(slide, pptxData, scale, imageMap) {
    let html = '';

    if (slide.background) {
        html += `<div class="slide-bg" style="${_bgStyle(slide.background, imageMap, `bg_${slide.index}`)}"></div>`;
    }

    html += '<div class="slide-elements">';

    for (const el of slide.elements) {
        html += _renderElement(el, pptxData, scale, imageMap);
    }

    html += '</div>';
    return html;
}

function _renderElement(el, pptxData, scale, imageMap) {
    if (el.type === 'group' && el.children) {
        return _renderGroup(el, pptxData, scale, imageMap);
    }

    const posStyle = _positionStyle(el, scale);
    const sourceBadge = el.source ? `<span class="source-badge source-${el.source}" style="display:none">${el.source === 'master' ? '母版' : el.source === 'layout' ? '版式' : '幻灯片'}</span>` : '';

    switch (el.type) {
        case 'shape':
            return _renderShape(el, posStyle, sourceBadge, pptxData, scale, imageMap);
        case 'image':
            return _renderImage(el, posStyle, sourceBadge, imageMap);
        case 'table':
            return _renderTable(el, posStyle, sourceBadge);
        case 'connector':
            return _renderConnector(el, posStyle, sourceBadge, scale);
        default:
            return '';
    }
}

function _renderGroup(group, pptxData, scale, imageMap) {
    const posStyle = _positionStyle(group, scale);
    const sourceBadge = group.source ? `<span class="source-badge source-${group.source}" style="display:none">${group.source === 'master' ? '母版' : group.source === 'layout' ? '版式' : '幻灯片'}</span>` : '';

    let childrenHtml = '';
    for (const child of group.children) {
        childrenHtml += _renderElement(child, pptxData, scale, imageMap);
    }

    const rotation = group.rotation ? `transform: rotate(${group.rotation}deg);` : '';
    const bgStyle = group.fill ? _fillStyle(group.fill, imageMap, group.id) : '';
    const borderStyle = group.outline ? _outlineStyle(group.outline) : '';
    const shadowStyle = group.shadow ? _shadowStyle(group.shadow) : '';

    return `<div class="el" style="${posStyle}${rotation}${bgStyle}${borderStyle}${shadowStyle}">${sourceBadge}${childrenHtml}</div>`;
}

function _renderShape(el, posStyle, sourceBadge, pptxData, scale, imageMap) {
    const bgStyle = el.fill ? _fillStyle(el.fill, imageMap, el.id) : '';
    const borderStyle = el.outline ? _outlineStyle(el.outline) : '';
    const rotation = el.rotation ? `transform: rotate(${el.rotation}deg);` : '';
    const shadowStyle = el.shadow ? _shadowStyle(el.shadow) : '';
    const flipStyle = el.flipH ? 'transform: scaleX(-1);' : el.flipV ? 'transform: scaleY(-1);' : '';

    let clipPathStyle = '';
    if (el.shapeType && el.shapeType !== 'rect') {
        const clipPath = PptxParser.getClipPath(el.shapeType);
        if (clipPath && clipPath !== 'none') {
            clipPathStyle = `clip-path: ${clipPath};`;
        }
    }

    let svgOverlay = '';
    if (el.customGeometry && el.customGeometry.pathData && el.customGeometry.pathData.length > 0) {
        svgOverlay = _renderCustomGeometrySvg(el, scale);
    }

    const isVertical = el.textStyle?.vert === 'vert' || el.textStyle?.vert === 'vert270' || el.textStyle?.vert === 'eaVert';
    const verticalClass = isVertical ? ' vertical-text' : '';
    const textRotation = el.textStyle?.textRotation ? `transform: rotate(${el.textStyle.textRotation}deg);` : '';

    let textHtml = '';
    if (el.paragraphs && el.paragraphs.length > 0) {
        const defaultTextStyle = _getDefaultTextStyle(el, pptxData);
        textHtml = el.paragraphs.map((p, pIdx) => {
            return _renderParagraph(p, pIdx, defaultTextStyle);
        }).join('');
    }

    const vAlign = el.textStyle?.anchor === 'ctr' ? 'center' : el.textStyle?.anchor === 'b' ? 'flex-end' : 'flex-start';
    const paddingStyle = el.textStyle ? `padding:${el.textStyle.tIns || 3.6}px ${el.textStyle.rIns || 7.2}px ${el.textStyle.bIns || 3.6}px ${el.textStyle.lIns || 7.2}px;` : '';

    return `<div class="el el-shape el-text${verticalClass}" style="${posStyle}${bgStyle}${borderStyle}${rotation}${flipStyle}${shadowStyle}${clipPathStyle}${paddingStyle}display:flex;align-items:${vAlign};${textRotation}">
  ${sourceBadge}${svgOverlay}${textHtml}</div>`;
}

function _renderParagraph(p, pIdx, defaultTextStyle) {
    const align = p.align === 'ctr' ? 'center' : p.align === 'r' ? 'right' : p.align === 'just' ? 'justify' : 'left';
    const indent = (p.indent?.marginLeft || p.indent?.firstLineIndent) ?
        `margin-left:${p.indent.marginLeft || 0}px;text-indent:${p.indent.firstLineIndent || 0}px;` : '';
    const spacing = p.spacing ?
        `${p.spacing.before ? `margin-top:${p.spacing.before}pt;` : ''}${p.spacing.after ? `margin-bottom:${p.spacing.after}pt;` : ''}${p.spacing.lineSpacingPercent ? `line-height:${p.spacing.lineSpacingPercent}%;` : ''}` : '';

    let bulletHtml = '';
    if (p.bullet) {
        if (p.bullet.type === 'char') {
            const bulletColor = p.bullet.color ? `color:${p.bullet.color};` : '';
            const bulletSize = p.bullet.size ? `font-size:${p.bullet.size}%;` : '';
            const bulletFont = p.bullet.font ? `font-family:'${p.bullet.font}';` : '';
            bulletHtml = `<span style="margin-right:6px;${bulletColor}${bulletSize}${bulletFont}">${_esc(p.bullet.char || '•')}</span>`;
        } else if (p.bullet.type === 'autoNum') {
            const bulletColor = p.bullet.color ? `color:${p.bullet.color};` : '';
            bulletHtml = `<span style="margin-right:6px;${bulletColor}">${p.bullet.startAt + pIdx}.</span>`;
        }
    }

    const runs = p.runs.map(r => {
        let style = '';
        const fontSize = r.fontSize || (defaultTextStyle?.fontSize);
        if (fontSize) style += `font-size:${fontSize}px;`;
        if (r.bold || (defaultTextStyle?.bold && r.bold !== false)) style += 'font-weight:bold;';
        if (r.italic || (defaultTextStyle?.italic && r.italic !== false)) style += 'font-style:italic;';
        if (r.underline) style += 'text-decoration:underline;';
        if (r.strike) style += 'text-decoration:line-through;';
        const color = r.color || defaultTextStyle?.color;
        if (color) style += `color:${color};`;
        const fontFamily = r.fontFamily || defaultTextStyle?.fontFamily;
        if (fontFamily) style += `font-family:'${fontFamily}',sans-serif;`;
        if (r.baseline) style += `vertical-align:${r.baseline > 0 ? 'super' : 'sub'};font-size:0.7em;`;
        if (r.letterSpacing) style += `letter-spacing:${r.letterSpacing}px;`;
        return style ? `<span style="${style}">${_esc(r.text)}</span>` : _esc(r.text);
    }).join('');

    return `<p style="text-align:${align};${indent}${spacing}">${bulletHtml}${runs}</p>`;
}

function _getDefaultTextStyle(el, pptxData) {
    if (!el.placeholder || !pptxData) return null;

    const slide = pptxData.slides?.find(s =>
        s.elements?.some(e => e.id === el.id)
    );
    const defaultStyles = slide?.defaultTextStyles;
    if (!defaultStyles) return null;

    let styleCategory = null;
    if (el.placeholder.type === 'title' || el.placeholder.type === 'ctrTitle') {
        styleCategory = defaultStyles.title;
    } else if (el.placeholder.type === 'body' || el.placeholder.type === 'obj') {
        styleCategory = defaultStyles.body;
    } else {
        styleCategory = defaultStyles.other;
    }

    if (!styleCategory || !styleCategory.levels) return null;

    const level = el.paragraphs?.[0]?.level || 0;
    return styleCategory.levels[level] || null;
}

function _renderCustomGeometrySvg(el, scale) {
    const paths = el.customGeometry.pathData;
    if (!paths || paths.length === 0) return '';

    const w = el.size?.cx ? el.size.cx * scale : 100;
    const h = el.size?.cy ? el.size.cy * scale : 100;

    let svgContent = '';
    for (const path of paths) {
        let d = '';
        for (const cmd of path.commands) {
            switch (cmd.type) {
                case 'M':
                    d += `M${(cmd.x * scale / (path.width || 1) * (path.width / (el.size?.cx || 1))).toFixed(2)},${(cmd.y * scale / (path.height || 1) * (path.height / (el.size?.cy || 1))).toFixed(2)} `;
                    break;
                case 'L':
                    d += `L${(cmd.x * scale / (path.width || 1) * (path.width / (el.size?.cx || 1))).toFixed(2)},${(cmd.y * scale / (path.height || 1) * (path.height / (el.size?.cy || 1))).toFixed(2)} `;
                    break;
                case 'C':
                    d += `C${(cmd.x1 * scale / (path.width || 1) * (path.width / (el.size?.cx || 1))).toFixed(2)},${(cmd.y1 * scale / (path.height || 1) * (path.height / (el.size?.cy || 1))).toFixed(2)} ${(cmd.x2 * scale / (path.width || 1) * (path.width / (el.size?.cx || 1))).toFixed(2)},${(cmd.y2 * scale / (path.height || 1) * (path.height / (el.size?.cy || 1))).toFixed(2)} ${(cmd.x * scale / (path.width || 1) * (path.width / (el.size?.cx || 1))).toFixed(2)},${(cmd.y * scale / (path.height || 1) * (path.height / (el.size?.cy || 1))).toFixed(2)} `;
                    break;
                case 'Z':
                    d += 'Z ';
                    break;
            }
        }
        if (d) {
            const fillAttr = el.fill ? '' : 'fill="none"';
            const strokeAttr = el.outline ? `stroke="${el.outline.color || '#333'}" stroke-width="${el.outline.width || 1}"` : '';
            svgContent += `<path d="${d}" ${fillAttr} ${strokeAttr}/>`;
        }
    }

    if (!svgContent) return '';

    return `<svg style="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:-1;" viewBox="0 0 ${Math.round(w)} ${Math.round(h)}">${svgContent}</svg>`;
}

function _renderImage(el, posStyle, sourceBadge, imageMap) {
    const rotation = el.rotation ? `transform: rotate(${el.rotation}deg);` : '';
    const flipStyle = el.flipH ? 'transform: scaleX(-1);' : el.flipV ? 'transform: scaleY(-1);' : '';
    const shadowStyle = el.shadow ? _shadowStyle(el.shadow) : '';
    const borderStyle = el.outline ? _outlineStyle(el.outline) : '';

    if (el.isVector) {
        return `<div class="el el-image el-vector-placeholder" style="${posStyle}${rotation}${flipStyle}${shadowStyle}${borderStyle}">
  ${sourceBadge}<span>矢量图(${el.vectorFormat || 'EMF'})</span></div>`;
    }

    const src = _getImageSrc(el, imageMap);
    if (!src) return '';

    const cropStyle = el.crop ? _cropStyle(el.crop) : '';

    return `<div class="el el-image" style="${posStyle}${rotation}${flipStyle}${shadowStyle}${borderStyle}">
  ${sourceBadge}<img src="${src}" style="${cropStyle}" loading="lazy" /></div>`;
}

function _cropStyle(crop) {
    const l = parseInt(crop.left || '0');
    const t = parseInt(crop.top || '0');
    const r = parseInt(crop.right || '0');
    const b = parseInt(crop.bottom || '0');

    if (l === 0 && t === 0 && r === 0 && b === 0) return '';

    const objectPositionX = l > 0 ? `${(100 * l / (l + 100000 - r)).toFixed(1)}%` : '0%';
    const objectPositionY = t > 0 ? `${(100 * t / (t + 100000 - b)).toFixed(1)}%` : '0%';

    return `object-fit:cover;object-position:${objectPositionX} ${objectPositionY};`;
}

function _renderTable(el, posStyle, sourceBadge) {
    if (!el.rows || el.rows.length === 0) return '';

    let html = `<div class="el" style="${posStyle}">${sourceBadge}<table class="el-table" style="width:100%;height:100%;">`;

    for (let ri = 0; ri < el.rows.length; ri++) {
        const row = el.rows[ri];
        html += '<tr>';
        for (let ci = 0; ci < row.length; ci++) {
            const cell = row[ci];
            const cellText = typeof cell === 'string' ? cell : (cell.text || '');
            const cellStyle = typeof cell === 'object' && cell.style ? _cellStyle(cell.style) : '';

            const colSpan = cell.colSpan ? ` colspan="${cell.colSpan}"` : '';
            const rowSpan = cell.rowSpan ? ` rowspan="${cell.rowSpan}"` : '';

            let cellContent = _esc(cellText);
            if (typeof cell === 'object' && cell.paragraphs) {
                cellContent = cell.paragraphs.map(p => {
                    const runs = p.runs.map(r => _esc(r.text)).join('');
                    return `<p>${runs}</p>`;
                }).join('');
            }

            html += `<td style="${cellStyle}"${colSpan}${rowSpan}>${cellContent}</td>`;
        }
        html += '</tr>';
    }

    html += '</table></div>';
    return html;
}

function _cellStyle(style) {
    let css = '';
    if (style.fill && style.fill.type === 'solid' && style.fill.color) {
        css += `background:${style.fill.color};`;
    }
    if (style.borders) {
        for (const [side, border] of Object.entries(style.borders)) {
            const borderSide = side === 'left' ? 'border-left' : side === 'right' ? 'border-right' : side === 'top' ? 'border-top' : 'border-bottom';
            const dashMap = { solid: 'solid', dash: 'dashed', dot: 'dotted', dashDot: 'dashed', lgDash: 'dashed', sysDash: 'dashed', sysDot: 'dotted' };
            css += `${borderSide}:${border.width}px ${dashMap[border.style] || 'solid'} ${border.color || '#d0d0d0'};`;
        }
    }
    if (style.vAlign === 'ctr') css += 'vertical-align:middle;';
    else if (style.vAlign === 'b') css += 'vertical-align:bottom;';
    if (style.paddingLeft) css += `padding-left:${style.paddingLeft}px;`;
    if (style.paddingRight) css += `padding-right:${style.paddingRight}px;`;
    if (style.paddingTop) css += `padding-top:${style.paddingTop}px;`;
    if (style.paddingBottom) css += `padding-bottom:${style.paddingBottom}px;`;
    return css;
}

function _renderConnector(el, posStyle, sourceBadge, scale) {
    const borderStyle = el.outline ? _outlineStyle(el.outline) : 'border: 1px solid #333;';

    if (el.customGeometry && el.customGeometry.pathData && el.customGeometry.pathData.length > 0) {
        const w = el.size?.cx ? el.size.cx * scale : 100;
        const h = el.size?.cy ? el.size.cy * scale : 100;
        let svgContent = '';

        for (const pathData of el.customGeometry.pathData) {
            let d = '';
            for (const cmd of pathData.commands) {
                switch (cmd.type) {
                    case 'M': d += `M${(cmd.x / (pathData.width || 1) * w).toFixed(2)},${(cmd.y / (pathData.height || 1) * h).toFixed(2)} `; break;
                    case 'L': d += `L${(cmd.x / (pathData.width || 1) * w).toFixed(2)},${(cmd.y / (pathData.height || 1) * h).toFixed(2)} `; break;
                    case 'C': d += `C${(cmd.x1 / (pathData.width || 1) * w).toFixed(2)},${(cmd.y1 / (pathData.height || 1) * h).toFixed(2)} ${(cmd.x2 / (pathData.width || 1) * w).toFixed(2)},${(cmd.y2 / (pathData.height || 1) * h).toFixed(2)} ${(cmd.x / (pathData.width || 1) * w).toFixed(2)},${(cmd.y / (pathData.height || 1) * h).toFixed(2)} `; break;
                    case 'Z': d += 'Z '; break;
                }
            }
            if (d) {
                const strokeColor = el.outline?.color || '#333';
                const strokeWidth = el.outline?.width || 1;
                const dashArray = el.outline?.dashStyle === 'dash' ? ' stroke-dasharray="8,4"' : el.outline?.dashStyle === 'dot' ? ' stroke-dasharray="2,4"' : '';
                svgContent += `<path d="${d}" fill="none" stroke="${strokeColor}" stroke-width="${strokeWidth}"${dashArray}/>`;
            }
        }

        if (svgContent) {
            return `<div class="el el-connector" style="${posStyle}">${sourceBadge}<svg style="position:absolute;top:0;left:0;width:100%;height:100%;" viewBox="0 0 ${Math.round(w)} ${Math.round(h)}">${svgContent}</svg></div>`;
        }
    }

    return `<div class="el el-connector" style="${posStyle}${borderStyle}">${sourceBadge}</div>`;
}

function _positionStyle(el, scale) {
    if (!el.position || !el.size) return 'position:relative;';

    const x = el.position.x * scale;
    const y = el.position.y * scale;
    const w = el.size.cx * scale;
    const h = el.size.cy * scale;

    return `left:${Math.round(x)}px;top:${Math.round(y)}px;width:${Math.round(w)}px;height:${Math.round(h)}px;`;
}

function _fillStyle(fill, imageMap, elId) {
    if (!fill) return '';
    switch (fill.type) {
        case 'solid':
            return `background:${fill.color || 'transparent'};`;
        case 'gradient':
            return _gradientStyle(fill);
        case 'blip':
            return _blipFillStyle(fill, imageMap, elId);
        case 'none':
            return 'background:transparent;';
        case 'pattern':
            return `background:${fill.fgColor || 'transparent'};`;
        default:
            return '';
    }
}

function _gradientStyle(fill) {
    if (!fill.stops || fill.stops.length === 0) return '';

    const stops = fill.stops.map(s => `${s.color || 'transparent'} ${s.position}%`).join(', ');

    if (fill.direction?.type === 'linear') {
        const cssAngle = (fill.direction.angle + 90) % 360;
        return `background:linear-gradient(${cssAngle}deg, ${stops});`;
    }

    if (fill.direction?.type === 'path') {
        if (fill.direction.pathType === 'circle') {
            return `background:radial-gradient(circle, ${stops});`;
        }
        return `background:radial-gradient(ellipse at center, ${stops});`;
    }

    return `background:linear-gradient(180deg, ${stops});`;
}

function _blipFillStyle(fill, imageMap, elId) {
    const src = _getFillImageSrc(fill, imageMap, elId);
    if (!src) return '';

    if (fill.stretch) {
        return `background:url('${src}') center/cover no-repeat;`;
    }
    if (fill.tile) {
        return `background:url('${src}') repeat;`;
    }
    return `background:url('${src}') center/contain no-repeat;`;
}

function _bgStyle(bg, imageMap, bgKey) {
    if (!bg) return 'background:white;';
    switch (bg.type) {
        case 'solid':
            return `background:${bg.color || 'white'};`;
        case 'gradient':
            return _gradientStyle(bg);
        case 'blip': {
            let src = '';
            if (bg._srcFile) src = bg._srcFile;
            else if (imageMap && bgKey && imageMap[bgKey]?._srcFile) src = imageMap[bgKey]._srcFile;
            else if (bg.src && !bg.src.startsWith('data:')) src = bg.src;
            else src = bg.src || '';

            if (!src) return 'background:white;';
            if (bg.stretch) return `background:url('${src}') center/cover no-repeat;`;
            if (bg.tile) return `background:url('${src}') repeat;`;
            return `background:url('${src}') center/contain no-repeat;`;
        }
        case 'themeRef':
            return `background:${bg.color || 'white'};`;
        case 'pattern':
            return `background:${bg.fgColor || 'white'};`;
        default:
            return 'background:white;';
    }
}

function _outlineStyle(outline) {
    if (!outline) return '';
    const color = outline.color || '#333';
    const width = outline.width || 0.75;
    const dashMap = { solid: 'solid', dash: 'dashed', dot: 'dotted', dashDot: 'dashed', lgDash: 'dashed', sysDash: 'dashed', sysDot: 'dotted' };
    const dash = dashMap[outline.dashStyle] || 'solid';
    return `border:${width}px ${dash} ${color};`;
}

function _shadowStyle(shadow) {
    if (!shadow) return '';
    const color = shadow.color || '#000000';
    const x = shadow.offsetX || 2;
    const y = shadow.offsetY || 2;
    const blur = shadow.blur || 4;
    return `box-shadow:${x}px ${y}px ${blur}px ${color};`;
}

function _esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

module.exports = { generateHtml, PptxParser };
