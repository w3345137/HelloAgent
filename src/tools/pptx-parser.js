const JSZip = require('jszip');
const fs = require('fs');
const path = require('path');

const EMU_PER_PT = 12700;
const EMU_PER_INCH = 914400;
const EMU_PER_CM = 360000;
const DEFAULT_SLIDE_WIDTH = 9144000;
const DEFAULT_SLIDE_HEIGHT = 6858000;

const PRESET_SHAPE_CLIP_PATHS = {
    rect: 'none',
    roundRect: 'inset(0 round 10%)',
    ellipse: 'ellipse(50% 50%)',
    circle: 'circle(50%)',
    triangle: 'polygon(50% 0%, 0% 100%, 100% 100%)',
    rtTriangle: 'polygon(0% 0%, 100% 100%, 0% 100%)',
    diamond: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)',
    parallelogram: 'polygon(15% 0%, 100% 0%, 85% 100%, 0% 100%)',
    trapezoid: 'polygon(15% 0%, 85% 0%, 100% 100%, 0% 100%)',
    pentagon: 'polygon(50% 0%, 100% 38%, 82% 100%, 18% 100%, 0% 38%)',
    hexagon: 'polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)',
    octagon: 'polygon(30% 0%, 70% 0%, 100% 30%, 100% 70%, 70% 100%, 30% 100%, 0% 70%, 0% 30%)',
    star4: 'polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)',
    star5: 'polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)',
    star6: 'polygon(50% 0%, 63% 25%, 97% 25%, 72% 50%, 82% 82%, 50% 65%, 18% 82%, 28% 50%, 3% 25%, 37% 25%)',
    arrow: 'polygon(0% 35%, 65% 35%, 65% 0%, 100% 50%, 65% 100%, 65% 65%, 0% 65%)',
    chevron: 'polygon(0% 0%, 75% 0%, 100% 50%, 75% 100%, 0% 100%, 25% 50%)',
    heart: 'path("M50% 90% C25% 70%, 0% 45%, 0% 25%, 0% 10%, 10% 0%, 25% 0%, 40% 10%, 50% 25%, 60% 10%, 75% 0%, 90% 0%, 100% 10%, 100% 25%, 100% 45%, 75% 70%")',
    cloud: 'ellipse(50% 50%)',
    donut: 'path("M50%,0% A50%,50% 0 1,1 50%,100% A50%,50% 0 1,1 50%,0% M50%,30% A20%,20% 0 1,0 50%,70% A20%,20% 0 1,0 50%,30%")',
    flowChartProcess: 'none',
    flowChartDecision: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)',
    flowChartDocument: 'polygon(0% 0%, 100% 0%, 100% 80%, 75% 100%, 50% 80%, 25% 100%, 0% 80%)',
    corner: 'polygon(0% 0%, 100% 0%, 100% 30%, 30% 30%, 30% 100%, 0% 100%)',
    plaque: 'inset(0 round 15%)',
    ribbon: 'polygon(0% 0%, 90% 0%, 100% 50%, 90% 100%, 0% 100%, 10% 50%)',
    ribbon2: 'polygon(10% 0%, 100% 0%, 90% 50%, 100% 100%, 10% 100%, 0% 50%)',
    frame: 'inset(5%)',
};

class PptxParser {
    constructor() {
        this.zip = null;
        this.theme = null;
        this.masters = {};
        this.layouts = {};
        this.slides = {};
        this.rels = {};
        this.images = {};
        this.slideWidth = DEFAULT_SLIDE_WIDTH;
        this.slideHeight = DEFAULT_SLIDE_HEIGHT;
        this.presentationRels = {};
    }

    async parse(filePath) {
        const data = fs.readFileSync(filePath);
        this.zip = await JSZip.loadAsync(data);

        await this._parseRels();
        await this._parsePresentation();
        await this._parseTheme();
        await this._parseMasters();
        await this._parseLayouts();
        await this._parseSlides();
        await this._extractImages();

        return this._buildResult();
    }

    async _parseRels() {
        const relsFiles = Object.keys(this.zip.files).filter(f =>
            f.endsWith('.rels') && f.startsWith('ppt/')
        );

        for (const relsFile of relsFiles) {
            const content = await this.zip.files[relsFile].async('text');
            const rels = this._parseXmlRels(content);
            const key = relsFile.replace('_rels/', '').replace('.rels', '');
            this.rels[key] = rels;
        }

        const presentationRels = await this._readFile('ppt/_rels/presentation.xml.rels');
        if (presentationRels) {
            this.presentationRels = this._parseXmlRels(presentationRels);
        }
    }

    _parseXmlRels(xml) {
        const rels = {};
        const regex = /<Relationship\s+Id="([^"]+)"\s+Type="([^"]+)"\s+Target="([^"]+)"/g;
        let match;
        while ((match = regex.exec(xml)) !== null) {
            rels[match[1]] = { id: match[1], type: match[2], target: match[3] };
        }
        return rels;
    }

    async _parsePresentation() {
        const xml = await this._readFile('ppt/presentation.xml');
        if (!xml) return;

        const sldSz = this._extractTag(xml, 'p:sldSz');
        if (sldSz) {
            const cx = this._extractAttrFromTag(sldSz, 'cx');
            const cy = this._extractAttrFromTag(sldSz, 'cy');
            if (cx) this.slideWidth = parseInt(cx);
            if (cy) this.slideHeight = parseInt(cy);
        }
    }

    async _parseTheme() {
        const themeXml = await this._readFile('ppt/theme/theme1.xml');
        if (!themeXml) return;

        this.theme = {
            colors: {},
            fonts: {},
            fillStyles: [],
            lineStyles: [],
            effectStyles: []
        };

        const colorScheme = this._extractTag(themeXml, 'a:clrScheme');
        if (colorScheme) {
            const colorNames = ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'];
            for (const name of colorNames) {
                const tag = this._extractTag(colorScheme, `a:${name}`);
                if (tag) {
                    this.theme.colors[name] = this._parseColor(tag);
                }
            }
        }

        const fontScheme = this._extractTag(themeXml, 'a:fontScheme');
        if (fontScheme) {
            const majorFont = this._extractTag(fontScheme, 'a:majorFont');
            const minorFont = this._extractTag(fontScheme, 'a:minorFont');
            if (majorFont) {
                const latin = this._extractAttr(majorFont, 'a:latin', 'typeface');
                const ea = this._extractAttr(majorFont, 'a:ea', 'typeface');
                this.theme.fonts.major = { latin, ea };
            }
            if (minorFont) {
                const latin = this._extractAttr(minorFont, 'a:latin', 'typeface');
                const ea = this._extractAttr(minorFont, 'a:ea', 'typeface');
                this.theme.fonts.minor = { latin, ea };
            }
        }

        const fmtScheme = this._extractTag(themeXml, 'a:fmtScheme');
        if (fmtScheme) {
            const fillStyleLst = this._extractTag(fmtScheme, 'a:fillStyleLst');
            if (fillStyleLst) {
                const solidFills = this._extractAllTags(fillStyleLst, 'a:solidFill');
                for (const sf of solidFills) {
                    this.theme.fillStyles.push({ type: 'solid', color: this._parseColor(sf) });
                }
                const gradFills = this._extractAllTags(fillStyleLst, 'a:gradFill');
                for (const gf of gradFills) {
                    this.theme.fillStyles.push(this._parseFillFromXml(gf));
                }
            }
        }
    }

    async _parseMasters() {
        const masterFiles = Object.keys(this.zip.files).filter(f =>
            f.match(/^ppt\/slideMasters\/slideMaster\d+\.xml$/)
        );

        for (const file of masterFiles) {
            const xml = await this._readFile(file);
            if (!xml) continue;

            const masterName = path.basename(file, '.xml');
            const master = this._parseSlideElements(xml, 'master');

            const cSld = this._extractTag(xml, 'p:cSld');
            if (cSld) {
                const bg = this._extractTag(cSld, 'p:bg');
                if (bg) {
                    master.background = this._parseBackground(bg);
                }
            }

            const txStyles = this._extractTag(xml, 'p:txStyles');
            if (txStyles) {
                master.defaultTextStyles = this._parseTxStyles(txStyles);
            }

            const relsFile = `ppt/slideMasters/_rels/${masterName}.xml.rels`;
            const relsXml = await this._readFile(relsFile);
            if (relsXml) {
                master.rels = this._parseXmlRels(relsXml);
            }

            this.masters[masterName] = master;
        }
    }

    async _parseLayouts() {
        const layoutFiles = Object.keys(this.zip.files).filter(f =>
            f.match(/^ppt\/slideLayouts\/slideLayout\d+\.xml$/)
        );

        for (const file of layoutFiles) {
            const xml = await this._readFile(file);
            if (!xml) continue;

            const layoutName = path.basename(file, '.xml');
            const layout = this._parseSlideElements(xml, 'layout');

            const cSld = this._extractTag(xml, 'p:cSld');
            if (cSld) {
                const showMasterPh = this._extractAttrFromTag(cSld, 'showMasterPhFmt');
                layout.showMasterPlaceholders = showMasterPh !== '0';

                const bg = this._extractTag(cSld, 'p:bg');
                if (bg) {
                    layout.background = this._parseBackground(bg);
                }
            }

            const relsFile = `ppt/slideLayouts/_rels/${layoutName}.xml.rels`;
            const relsXml = await this._readFile(relsFile);
            if (relsXml) {
                layout.rels = this._parseXmlRels(relsXml);
                for (const [, rel] of Object.entries(layout.rels)) {
                    if (rel.type.includes('slideMaster')) {
                        layout.masterRef = rel.target.replace('../slideMasters/', '').replace('slideMasters/', '');
                    }
                }
            }

            this.layouts[layoutName] = layout;
        }
    }

    async _parseSlides() {
        const slideFiles = Object.keys(this.zip.files).filter(f =>
            f.match(/^ppt\/slides\/slide\d+\.xml$/)
        );

        for (const file of slideFiles) {
            const xml = await this._readFile(file);
            if (!xml) continue;

            const slideName = path.basename(file, '.xml');
            const slide = this._parseSlideElements(xml, 'slide');

            const cSld = this._extractTag(xml, 'p:cSld');
            if (cSld) {
                const showMasterPh = this._extractAttrFromTag(cSld, 'showMasterPhFmt');
                slide.showMasterPlaceholders = showMasterPh !== '0';

                const bg = this._extractTag(cSld, 'p:bg');
                if (bg) {
                    slide.background = this._parseBackground(bg);
                }
            }

            const relsFile = `ppt/slides/_rels/${slideName}.xml.rels`;
            const relsXml = await this._readFile(relsFile);
            if (relsXml) {
                slide.rels = this._parseXmlRels(relsXml);
                for (const [, rel] of Object.entries(slide.rels)) {
                    if (rel.type.includes('slideLayout')) {
                        slide.layoutRef = rel.target.replace('../slideLayouts/', '').replace('slideLayouts/', '');
                    }
                }
            }

            const transition = this._extractTag(xml, 'p:transition');
            if (transition) {
                slide.transition = this._parseTransition(transition);
            }

            this.slides[slideName] = slide;
        }
    }

    _parseTxStyles(txStylesXml) {
        const result = {
            title: null,
            body: null,
            other: null
        };

        const titleStyle = this._extractTag(txStylesXml, 'p:titleStyle');
        if (titleStyle) {
            result.title = this._parseDefaultParagraphStyle(titleStyle);
        }

        const bodyStyle = this._extractTag(txStylesXml, 'p:bodyStyle');
        if (bodyStyle) {
            result.body = this._parseDefaultParagraphStyle(bodyStyle);
        }

        const otherStyle = this._extractTag(txStylesXml, 'p:otherStyle');
        if (otherStyle) {
            result.other = this._parseDefaultParagraphStyle(otherStyle);
        }

        return result;
    }

    _parseDefaultParagraphStyle(styleXml) {
        const result = {
            levels: {}
        };

        const defPPr = this._extractTag(styleXml, 'a:defPPr');
        if (defPPr) {
            result.defaultParagraph = {
                align: this._extractAttrFromTag(defPPr, 'algn') || 'left',
                indent: this._parseIndent(defPPr),
                spacing: this._parseSpacing(defPPr)
            };
        }

        for (let lvl = 0; lvl <= 8; lvl++) {
            const lvlPPr = this._extractTag(styleXml, `a:lvl${lvl + 1}pPr`);
            if (lvlPPr) {
                const levelStyle = {
                    fontSize: null,
                    fontFamily: null,
                    bold: false,
                    italic: false,
                    color: null,
                    indent: this._parseIndent(lvlPPr),
                    spacing: this._parseSpacing(lvlPPr)
                };

                const defRPr = this._extractTag(lvlPPr, 'a:defRPr');
                if (defRPr) {
                    const sz = this._extractAttrFromTag(defRPr, 'sz');
                    if (sz) levelStyle.fontSize = parseInt(sz) / 100;
                    levelStyle.bold = this._extractAttrFromTag(defRPr, 'b') === '1';
                    levelStyle.italic = this._extractAttrFromTag(defRPr, 'i') === '1';
                    levelStyle.underline = this._extractAttrFromTag(defRPr, 'u') === 'sng';
                    levelStyle.color = this._parseColor(defRPr);
                    const latin = this._extractAttr(defRPr, 'a:latin', 'typeface');
                    const ea = this._extractAttr(defRPr, 'a:ea', 'typeface');
                    levelStyle.fontFamily = latin || ea || null;
                }

                result.levels[lvl] = levelStyle;
            }
        }

        return result;
    }

    _parseIndent(pPrXml) {
        const marL = this._extractAttrFromTag(pPrXml, 'marL');
        const indent = this._extractAttrFromTag(pPrXml, 'indent');
        return {
            marginLeft: marL ? parseInt(marL) / EMU_PER_PT : 0,
            firstLineIndent: indent ? parseInt(indent) / EMU_PER_PT : 0
        };
    }

    _parseSpacing(pPrXml) {
        const spcBef = this._extractTag(pPrXml, 'a:spcBef');
        const spcAft = this._extractTag(pPrXml, 'a:spcAft');
        const lnSpc = this._extractTag(pPrXml, 'a:lnSpc');

        const result = {};

        if (spcBef) {
            const pts = this._extractSpacingPts(spcBef);
            if (pts !== null) result.before = pts;
        }
        if (spcAft) {
            const pts = this._extractSpacingPts(spcAft);
            if (pts !== null) result.after = pts;
        }
        if (lnSpc) {
            const spcPts = this._extractTag(lnSpc, 'a:spcPts');
            if (spcPts) {
                const val = this._extractAttrFromTag(spcPts, 'val');
                if (val) result.lineSpacing = parseInt(val) / 100;
            }
            const spcPct = this._extractTag(lnSpc, 'a:spcPct');
            if (spcPct) {
                const val = this._extractAttrFromTag(spcPct, 'val');
                if (val) result.lineSpacingPercent = parseInt(val) / 1000;
            }
        }

        return Object.keys(result).length > 0 ? result : null;
    }

    _extractSpacingPts(spacingXml) {
        const spcPts = this._extractTag(spacingXml, 'a:spcPts');
        if (spcPts) {
            const val = this._extractAttrFromTag(spcPts, 'val');
            if (val) return parseInt(val) / 100;
        }
        return null;
    }

    _parseSlideElements(xml, level) {
        const result = {
            level,
            elements: [],
            placeholders: {}
        };

        const cSld = this._extractTag(xml, 'p:cSld');
        if (!cSld) return result;

        const spTree = this._extractTag(cSld, 'p:spTree');
        if (!spTree) return result;

        const shapes = this._extractAllTags(spTree, 'p:sp');
        for (const sp of shapes) {
            const element = this._parseShape(sp);
            if (element) {
                if (element.placeholder) {
                    result.placeholders[`${element.placeholder.type}_${element.placeholder.idx}`] = element;
                }
                result.elements.push(element);
            }
        }

        const pictures = this._extractAllTags(spTree, 'p:pic');
        for (const pic of pictures) {
            const element = this._parsePicture(pic);
            if (element) result.elements.push(element);
        }

        const groupShapes = this._extractAllTags(spTree, 'p:grpSp');
        for (const grp of groupShapes) {
            const group = this._parseGroup(grp);
            if (group) result.elements.push(group);
        }

        const graphicFrames = this._extractAllTags(spTree, 'p:graphicFrame');
        for (const gf of graphicFrames) {
            const element = this._parseGraphicFrame(gf);
            if (element) result.elements.push(element);
        }

        const cxnSp = this._extractAllTags(spTree, 'p:cxnSp');
        for (const cs of cxnSp) {
            const element = this._parseConnector(cs);
            if (element) result.elements.push(element);
        }

        const contentParts = this._extractAllTags(spTree, 'p:contentPart');
        for (const cp of contentParts) {
            const element = this._parseContentPart(cp);
            if (element) result.elements.push(element);
        }

        return result;
    }

    _parseShape(sp) {
        const nvSpPr = this._extractTag(sp, 'p:nvSpPr');
        const spPr = this._extractTag(sp, 'p:spPr');
        const txBody = this._extractTag(sp, 'p:txBody');

        if (!nvSpPr && !spPr) return null;

        const element = {
            type: 'shape',
            id: null,
            name: null,
            placeholder: null,
            position: null,
            size: null,
            rotation: 0,
            flipH: false,
            flipV: false,
            shapeType: null,
            customGeometry: null,
            fill: null,
            outline: null,
            shadow: null,
            text: null,
            textStyle: null,
            textRuns: null,
            paragraphs: null,
            zOrder: null
        };

        if (nvSpPr) {
            element.id = this._extractAttr(nvSpPr, 'p:cNvPr', 'id');
            element.name = this._extractAttr(nvSpPr, 'p:cNvPr', 'name');

            const phTag = this._extractTag(nvSpPr, 'p:ph');
            if (phTag) {
                element.placeholder = {
                    type: this._extractAttrFromTag(phTag, 'type') || 'body',
                    idx: this._extractAttrFromTag(phTag, 'idx') || '0',
                    orient: this._extractAttrFromTag(phTag, 'orient') || 'horz',
                    sz: this._extractAttrFromTag(phTag, 'sz') || 'full',
                    hasCustomPrompt: this._extractAttrFromTag(phTag, 'hasCustomPrompt') === '1'
                };
            }
        }

        if (spPr) {
            const xfrm = this._extractTag(spPr, 'a:xfrm');
            if (xfrm) {
                element.position = this._parseOffset(xfrm);
                element.size = this._parseExtents(xfrm);
                element.rotation = this._parseRotation(xfrm);
                element.flipH = this._extractAttrFromTag(xfrm, 'flipH') === '1';
                element.flipV = this._extractAttrFromTag(xfrm, 'flipV') === '1';
            }

            const prstGeom = this._extractTag(spPr, 'a:prstGeom');
            if (prstGeom) {
                element.shapeType = this._extractAttrFromTag(prstGeom, 'prst');
            }

            const custGeom = this._extractTag(spPr, 'a:custGeom');
            if (custGeom) {
                element.customGeometry = this._parseCustomGeometry(custGeom);
            }

            element.fill = this._parseFill(spPr);
            element.outline = this._parseOutline(spPr);
            element.shadow = this._parseShadow(spPr);
        }

        if (txBody) {
            const textResult = this._parseTextBody(txBody);
            element.text = textResult.text;
            element.textStyle = textResult.style;
            element.textRuns = textResult.runs;
            element.paragraphs = textResult.paragraphs;
        }

        return element;
    }

    _parseCustomGeometry(custGeomXml) {
        const result = {
            pathData: [],
            viewBox: null
        };

        const pathLst = this._extractTag(custGeomXml, 'a:pathLst');
        if (!pathLst) return result;

        const paths = this._extractAllTags(pathLst, 'a:path');
        for (const pathXml of paths) {
            const w = this._extractAttrFromTag(pathXml, 'w');
            const h = this._extractAttrFromTag(pathXml, 'h');
            const path = {
                width: w ? parseInt(w) : this.slideWidth,
                height: h ? parseInt(h) : this.slideHeight,
                commands: []
            };

            const moveTo = this._extractAllTags(pathXml, 'a:moveTo');
            for (const mt of moveTo) {
                const pt = this._extractTag(mt, 'a:pt');
                if (pt) {
                    path.commands.push({
                        type: 'M',
                        x: parseInt(this._extractAttrFromTag(pt, 'x') || '0'),
                        y: parseInt(this._extractAttrFromTag(pt, 'y') || '0')
                    });
                }
            }

            const lnTo = this._extractAllTags(pathXml, 'a:lnTo');
            for (const lt of lnTo) {
                const pt = this._extractTag(lt, 'a:pt');
                if (pt) {
                    path.commands.push({
                        type: 'L',
                        x: parseInt(this._extractAttrFromTag(pt, 'x') || '0'),
                        y: parseInt(this._extractAttrFromTag(pt, 'y') || '0')
                    });
                }
            }

            const arcTo = this._extractAllTags(pathXml, 'a:arcTo');
            for (const at of arcTo) {
                path.commands.push({
                    type: 'A',
                    rx: parseInt(this._extractAttrFromTag(at, 'wR') || '0'),
                    ry: parseInt(this._extractAttrFromTag(at, 'hR') || '0'),
                    startAngle: parseInt(this._extractAttrFromTag(at, 'stAng') || '0') / 60000,
                    sweepAngle: parseInt(this._extractAttrFromTag(at, 'swAng') || '0') / 60000
                });
            }

            const cubicBezTo = this._extractAllTags(pathXml, 'a:cubicBezTo');
            for (const cb of cubicBezTo) {
                const pts = this._extractAllTags(cb, 'a:pt');
                if (pts.length >= 2) {
                    path.commands.push({
                        type: 'C',
                        x1: parseInt(this._extractAttrFromTag(pts[0], 'x') || '0'),
                        y1: parseInt(this._extractAttrFromTag(pts[0], 'y') || '0'),
                        x2: parseInt(this._extractAttrFromTag(pts[1], 'x') || '0'),
                        y2: parseInt(this._extractAttrFromTag(pts[1], 'y') || '0'),
                        x: parseInt(this._extractAttrFromTag(pts[pts.length - 1], 'x') || '0'),
                        y: parseInt(this._extractAttrFromTag(pts[pts.length - 1], 'y') || '0')
                    });
                }
            }

            const close = this._extractTag(pathXml, 'a:close');
            if (close) {
                path.commands.push({ type: 'Z' });
            }

            result.pathData.push(path);
        }

        return result;
    }

    _parseShadow(spPrXml) {
        const effectLst = this._extractTag(spPrXml, 'a:effectLst');
        if (!effectLst) return null;

        const outerShdw = this._extractTag(effectLst, 'a:outerShdw');
        if (outerShdw) {
            const blurRad = this._extractAttrFromTag(outerShdw, 'blurRad');
            const dist = this._extractAttrFromTag(outerShdw, 'dist');
            const dir = this._extractAttrFromTag(outerShdw, 'dir');
            const algn = this._extractAttrFromTag(outerShdw, 'algn');
            const rotWithShape = this._extractAttrFromTag(outerShdw, 'rotWithShape');

            const color = this._parseColor(outerShdw);

            const dirDeg = dir ? parseInt(dir) / 60000 : 0;
            const distVal = dist ? parseInt(dist) / EMU_PER_PT : 2;
            const offsetX = distVal * Math.sin(dirDeg * Math.PI / 180);
            const offsetY = -distVal * Math.cos(dirDeg * Math.PI / 180);
            const blurVal = blurRad ? parseInt(blurRad) / EMU_PER_PT : 4;

            return {
                type: 'outer',
                color: color || '#000000',
                offsetX: Math.round(offsetX * 100) / 100,
                offsetY: Math.round(offsetY * 100) / 100,
                blur: Math.round(blurVal * 100) / 100,
                algn: algn || 'bl',
                rotWithShape: rotWithShape !== '0'
            };
        }

        return null;
    }

    _parsePicture(pic) {
        const nvPicPr = this._extractTag(pic, 'p:nvPicPr');
        const blipFill = this._extractTag(pic, 'p:blipFill');
        const spPr = this._extractTag(pic, 'p:spPr');

        const element = {
            type: 'image',
            id: null,
            name: null,
            position: null,
            size: null,
            rotation: 0,
            flipH: false,
            flipV: false,
            src: null,
            srcMime: null,
            imageRId: null,
            crop: null,
            fill: null,
            outline: null,
            shadow: null,
            zOrder: null
        };

        if (nvPicPr) {
            element.id = this._extractAttr(nvPicPr, 'p:cNvPr', 'id');
            element.name = this._extractAttr(nvPicPr, 'p:cNvPr', 'name');
        }

        if (spPr) {
            const xfrm = this._extractTag(spPr, 'a:xfrm');
            if (xfrm) {
                element.position = this._parseOffset(xfrm);
                element.size = this._parseExtents(xfrm);
                element.rotation = this._parseRotation(xfrm);
                element.flipH = this._extractAttrFromTag(xfrm, 'flipH') === '1';
                element.flipV = this._extractAttrFromTag(xfrm, 'flipV') === '1';
            }
            element.outline = this._parseOutline(spPr);
            element.shadow = this._parseShadow(spPr);
        }

        if (blipFill) {
            const blip = this._extractTag(blipFill, 'a:blip');
            if (blip) {
                const rEmbed = this._extractAttrFromTag(blip, 'r:embed');
                if (rEmbed) {
                    element.imageRId = rEmbed;
                }
            }

            const srcRect = this._extractTag(blipFill, 'a:srcRect');
            if (srcRect) {
                element.crop = {
                    left: this._extractAttrFromTag(srcRect, 'l') || '0',
                    top: this._extractAttrFromTag(srcRect, 't') || '0',
                    right: this._extractAttrFromTag(srcRect, 'r') || '0',
                    bottom: this._extractAttrFromTag(srcRect, 'b') || '0'
                };
            }
        }

        return element;
    }

    _parseGroup(grp) {
        const nvGrpSpPr = this._extractTag(grp, 'p:nvGrpSpPr');
        const grpSpPr = this._extractTag(grp, 'p:grpSpPr');

        const group = {
            type: 'group',
            id: null,
            name: null,
            position: null,
            size: null,
            rotation: 0,
            children: [],
            fill: null,
            outline: null,
            shadow: null,
            zOrder: null
        };

        if (nvGrpSpPr) {
            group.id = this._extractAttr(nvGrpSpPr, 'p:cNvPr', 'id');
            group.name = this._extractAttr(nvGrpSpPr, 'p:cNvPr', 'name');
        }

        if (grpSpPr) {
            const xfrm = this._extractTag(grpSpPr, 'a:xfrm');
            if (xfrm) {
                group.position = this._parseOffset(xfrm);
                group.size = this._parseExtents(xfrm);
                group.rotation = this._parseRotation(xfrm);
            }
            group.fill = this._parseFill(grpSpPr);
            group.outline = this._parseOutline(grpSpPr);
            group.shadow = this._parseShadow(grpSpPr);
        }

        const shapes = this._extractAllTags(grp, 'p:sp');
        for (const sp of shapes) {
            const el = this._parseShape(sp);
            if (el) group.children.push(el);
        }

        const pictures = this._extractAllTags(grp, 'p:pic');
        for (const pic of pictures) {
            const el = this._parsePicture(pic);
            if (el) group.children.push(el);
        }

        const connectors = this._extractAllTags(grp, 'p:cxnSp');
        for (const cs of connectors) {
            const el = this._parseConnector(cs);
            if (el) group.children.push(el);
        }

        const subGroups = this._extractAllTags(grp, 'p:grpSp');
        for (const sg of subGroups) {
            const el = this._parseGroup(sg);
            if (el) group.children.push(el);
        }

        return group;
    }

    _parseGraphicFrame(gf) {
        const nvGrpSpPr = this._extractTag(gf, 'p:nvGraphicFramePr');
        const element = {
            type: 'table',
            id: null,
            name: null,
            position: null,
            size: null,
            rows: [],
            cols: [],
            colWidths: [],
            rowHeights: [],
            cellStyles: [],
            zOrder: null
        };

        if (nvGrpSpPr) {
            element.id = this._extractAttr(nvGrpSpPr, 'p:cNvPr', 'id');
            element.name = this._extractAttr(nvGrpSpPr, 'p:cNvPr', 'name');
        }

        const xfrm = this._extractTag(gf, 'a:xfrm');
        if (xfrm) {
            element.position = this._parseOffset(xfrm);
            element.size = this._parseExtents(xfrm);
        }

        const tbl = this._extractTag(gf, 'a:tbl');
        if (tbl) {
            const tblGrid = this._extractTag(tbl, 'a:tblGrid');
            if (tblGrid) {
                const gridCols = this._extractAllTags(tblGrid, 'a:gridCol');
                element.cols = gridCols.map(gc => parseInt(this._extractAttrFromTag(gc, 'w') || '0') / EMU_PER_PT);
            }

            const tblPr = this._extractTag(tbl, 'a:tblPr');
            if (tblPr) {
                element.bandRow = this._extractAttrFromTag(tblPr, 'bandRow') === '1';
                element.bandCol = this._extractAttrFromTag(tblPr, 'bandCol') === '1';
                element.firstRow = this._extractAttrFromTag(tblPr, 'firstRow') === '1';
                element.lastRow = this._extractAttrFromTag(tblPr, 'lastRow') === '1';
            }

            const tblStyle = this._extractTag(tbl, 'a:tblStyle');
            if (tblStyle) {
                element.styleName = this._extractAttrFromTag(tblStyle, 'val');
            }

            const tblRows = this._extractAllTags(tbl, 'a:tr');
            element.rows = tblRows.map(tr => {
                const h = this._extractAttrFromTag(tr, 'h');
                if (h) element.rowHeights.push(parseInt(h) / EMU_PER_PT);

                const cells = this._extractAllTags(tr, 'a:tc');
                return cells.map(tc => {
                    const cellData = { text: '', style: {} };

                    const tcPr = this._extractTag(tc, 'a:tcPr');
                    if (tcPr) {
                        cellData.style.fill = this._parseFill(tcPr);
                        cellData.style.borders = this._parseCellBorders(tcPr);
                        const vAlign = this._extractAttrFromTag(tcPr, 'anchor');
                        cellData.style.vAlign = vAlign || 't';
                        const marL = this._extractAttrFromTag(tcPr, 'marL');
                        const marR = this._extractAttrFromTag(tcPr, 'marR');
                        const marT = this._extractAttrFromTag(tcPr, 'marT');
                        const marB = this._extractAttrFromTag(tcPr, 'marB');
                        if (marL) cellData.style.paddingLeft = parseInt(marL) / EMU_PER_PT;
                        if (marR) cellData.style.paddingRight = parseInt(marR) / EMU_PER_PT;
                        if (marT) cellData.style.paddingTop = parseInt(marT) / EMU_PER_PT;
                        if (marB) cellData.style.paddingBottom = parseInt(marB) / EMU_PER_PT;

                        const gridSpan = this._extractAttrFromTag(tcPr, 'gridSpan');
                        const rowSpan = this._extractAttrFromTag(tcPr, 'rowSpan');
                        if (gridSpan) cellData.colSpan = parseInt(gridSpan);
                        if (rowSpan) cellData.rowSpan = parseInt(rowSpan);
                    }

                    const txBody = this._extractTag(tc, 'a:txBody');
                    if (txBody) {
                        const parsed = this._parseTextBody(txBody);
                        cellData.text = parsed.text;
                        cellData.paragraphs = parsed.paragraphs;
                    }

                    return cellData;
                });
            });
        }

        return element;
    }

    _parseCellBorders(tcPrXml) {
        const borders = {};
        const sides = [
            { tag: 'a:lnL', name: 'left' },
            { tag: 'a:lnR', name: 'right' },
            { tag: 'a:lnT', name: 'top' },
            { tag: 'a:lnB', name: 'bottom' }
        ];

        for (const side of sides) {
            const ln = this._extractTag(tcPrXml, side.tag);
            if (ln) {
                const w = this._extractAttrFromTag(ln, 'w');
                borders[side.name] = {
                    width: w ? parseInt(w) / EMU_PER_PT : 0.75,
                    color: this._parseColor(ln),
                    style: this._extractAttr(this._extractTag(ln, 'a:prstDash'), 'a:prstDash', 'val') || 'solid'
                };
            }
        }

        return Object.keys(borders).length > 0 ? borders : null;
    }

    _parseConnector(cs) {
        const nvCxnSpPr = this._extractTag(cs, 'p:nvCxnSpPr');
        const spPr = this._extractTag(cs, 'p:spPr');

        const element = {
            type: 'connector',
            id: null,
            name: null,
            position: null,
            size: null,
            rotation: 0,
            outline: null,
            points: [],
            startConnection: null,
            endConnection: null,
            zOrder: null
        };

        if (nvCxnSpPr) {
            element.id = this._extractAttr(nvCxnSpPr, 'p:cNvPr', 'id');
            element.name = this._extractAttr(nvCxnSpPr, 'p:cNvPr', 'name');

            const stCxn = this._extractTag(nvCxnSpPr, 'a:stCxn');
            const endCxn = this._extractTag(nvCxnSpPr, 'a:endCxn');
            if (stCxn) {
                element.startConnection = {
                    id: this._extractAttrFromTag(stCxn, 'id'),
                    idx: this._extractAttrFromTag(stCxn, 'idx')
                };
            }
            if (endCxn) {
                element.endConnection = {
                    id: this._extractAttrFromTag(endCxn, 'id'),
                    idx: this._extractAttrFromTag(endCxn, 'idx')
                };
            }
        }

        if (spPr) {
            const xfrm = this._extractTag(spPr, 'a:xfrm');
            if (xfrm) {
                element.position = this._parseOffset(xfrm);
                element.size = this._parseExtents(xfrm);
                element.rotation = this._parseRotation(xfrm);
            }
            element.outline = this._parseOutline(spPr);

            const prstGeom = this._extractTag(spPr, 'a:prstGeom');
            if (prstGeom) {
                element.connectorType = this._extractAttrFromTag(prstGeom, 'prst');
            }

            const custGeom = this._extractTag(spPr, 'a:custGeom');
            if (custGeom) {
                element.customGeometry = this._parseCustomGeometry(custGeom);
            }
        }

        return element;
    }

    _parseContentPart(cp) {
        const nvContentPartPr = this._extractTag(cp, 'p:nvContentPartPr');
        return {
            type: 'contentPart',
            id: nvContentPartPr ? this._extractAttr(nvContentPartPr, 'p:cNvPr', 'id') : null,
            name: nvContentPartPr ? this._extractAttr(nvContentPartPr, 'p:cNvPr', 'name') : null,
            rId: this._extractAttrFromTag(cp, 'r:id')
        };
    }

    _parseTextBody(txBody) {
        const result = {
            text: '',
            style: {},
            runs: [],
            paragraphs: []
        };

        const bodyPr = this._extractTag(txBody, 'a:bodyPr');
        if (bodyPr) {
            result.style.anchor = this._extractAttrFromTag(bodyPr, 'anchor') || 't';
            result.style.wrap = this._extractAttrFromTag(bodyPr, 'wrap') !== 'none';
            result.style.lIns = parseInt(this._extractAttrFromTag(bodyPr, 'lIns') || '91440') / EMU_PER_PT;
            result.style.tIns = parseInt(this._extractAttrFromTag(bodyPr, 'tIns') || '45720') / EMU_PER_PT;
            result.style.rIns = parseInt(this._extractAttrFromTag(bodyPr, 'rIns') || '91440') / EMU_PER_PT;
            result.style.bIns = parseInt(this._extractAttrFromTag(bodyPr, 'bIns') || '45720') / EMU_PER_PT;
            result.style.vert = this._extractAttrFromTag(bodyPr, 'vert') || 'horz';
            result.style.autoFit = this._extractAttrFromTag(bodyPr, 'fit') || 'auto';
            const numCol = this._extractAttrFromTag(bodyPr, 'numCol');
            if (numCol) result.style.numColumns = parseInt(numCol);
            const spcCol = this._extractAttrFromTag(bodyPr, 'spcCol');
            if (spcCol) result.style.columnSpacing = parseInt(spcCol) / EMU_PER_PT;
            const rot = this._extractAttrFromTag(bodyPr, 'rot');
            if (rot) result.style.textRotation = parseInt(rot) / 60000;
        }

        const lstStyle = this._extractTag(txBody, 'a:lstStyle');
        if (lstStyle) {
            result.listStyle = this._parseTxStyles(lstStyle);
        }

        const paragraphs = this._extractAllTags(txBody, 'a:p');
        const paraTexts = [];

        for (const p of paragraphs) {
            const para = {
                align: 'left',
                level: 0,
                runs: [],
                bullet: null,
                indent: null,
                spacing: null,
                defaultRunStyle: null
            };

            const pPr = this._extractTag(p, 'a:pPr');
            if (pPr) {
                para.align = this._extractAttrFromTag(pPr, 'algn') || 'left';
                para.level = parseInt(this._extractAttrFromTag(pPr, 'lvl') || '0');
                para.indent = this._parseIndent(pPr);
                para.spacing = this._parseSpacing(pPr);

                const buNone = this._extractTag(pPr, 'a:buNone');
                const buChar = this._extractTag(pPr, 'a:buChar');
                const buAutoNum = this._extractTag(pPr, 'a:buAutoNum');
                const buSzPct = this._extractTag(pPr, 'a:buSzPct');
                const buClr = this._extractTag(pPr, 'a:buClr');
                const buFont = this._extractTag(pPr, 'a:buFont');

                if (buNone) {
                    para.bullet = null;
                } else if (buChar) {
                    para.bullet = {
                        type: 'char',
                        char: this._extractAttrFromTag(buChar, 'char'),
                        size: buSzPct ? parseInt(this._extractAttrFromTag(buSzPct, 'val') || '100000') / 1000 : null,
                        color: buClr ? this._parseColor(buClr) : null,
                        font: buFont ? this._extractAttrFromTag(buFont, 'typeface') : null
                    };
                } else if (buAutoNum) {
                    para.bullet = {
                        type: 'autoNum',
                        startAt: parseInt(this._extractAttrFromTag(buAutoNum, 'startAt') || '1'),
                        numType: this._extractAttrFromTag(buAutoNum, 'type') || 'arabicPeriod',
                        size: buSzPct ? parseInt(this._extractAttrFromTag(buSzPct, 'val') || '100000') / 1000 : null,
                        color: buClr ? this._parseColor(buClr) : null
                    };
                } else {
                    para.bullet = { type: 'char', char: '•' };
                }

                const defRPr = this._extractTag(pPr, 'a:defRPr');
                if (defRPr) {
                    para.defaultRunStyle = this._parseRunProperties(defRPr);
                }
            }

            const runs = this._extractAllTags(p, 'a:r');
            let paraText = '';
            for (const r of runs) {
                const rPr = this._extractTag(r, 'a:rPr');
                const tContent = this._extractTextContent(r, 'a:t');
                const text = tContent || '';

                const run = { text };
                if (rPr) {
                    Object.assign(run, this._parseRunProperties(rPr));
                }
                para.runs.push(run);
                result.runs.push(run);
                paraText += text;
            }

            const fld = this._extractTag(p, 'a:fld');
            if (fld) {
                const tContent = this._extractTextContent(fld, 'a:t');
                if (tContent) {
                    paraText += tContent;
                    const fldType = this._extractAttrFromTag(fld, 'type');
                    para.runs.push({ text: tContent, fieldType: fldType });
                }
            }

            para.text = paraText;
            paraTexts.push(paraText);
            result.paragraphs.push(para);
        }

        result.text = paraTexts.join('\n');
        return result;
    }

    _parseRunProperties(rPr) {
        const props = {};
        const sz = this._extractAttrFromTag(rPr, 'sz');
        if (sz) props.fontSize = parseInt(sz) / 100;
        props.bold = this._extractAttrFromTag(rPr, 'b') === '1';
        props.italic = this._extractAttrFromTag(rPr, 'i') === '1';
        props.underline = this._extractAttrFromTag(rPr, 'u');
        props.strike = this._extractAttrFromTag(rPr, 'strike');
        props.color = this._parseColor(rPr);
        const latin = this._extractAttr(rPr, 'a:latin', 'typeface');
        const ea = this._extractAttr(rPr, 'a:ea', 'typeface');
        props.fontFamily = latin || ea || null;

        const baseline = this._extractAttrFromTag(rPr, 'baseline');
        if (baseline) props.baseline = parseInt(baseline) / 1000;

        const spc = this._extractAttrFromTag(rPr, 'spc');
        if (spc) props.letterSpacing = parseInt(spc) / 100;

        return props;
    }

    _parseFill(parentXml) {
        return this._parseFillFromXml(parentXml);
    }

    _parseFillFromXml(parentXml) {
        if (!parentXml) return null;

        const solidFill = this._extractTag(parentXml, 'a:solidFill');
        if (solidFill) {
            return { type: 'solid', color: this._parseColor(solidFill) };
        }

        const gradFill = this._extractTag(parentXml, 'a:gradFill');
        if (gradFill) {
            const result = { type: 'gradient', stops: [], direction: null };

            const gsLst = this._extractTag(gradFill, 'a:gsLst');
            if (gsLst) {
                const gs = this._extractAllTags(gsLst, 'a:gs');
                result.stops = gs.map(g => ({
                    position: parseInt(this._extractAttrFromTag(g, 'pos') || '0') / 1000,
                    color: this._parseColor(g)
                }));
            }

            const lin = this._extractTag(gradFill, 'a:lin');
            if (lin) {
                const ang = this._extractAttrFromTag(lin, 'ang');
                const scaled = this._extractAttrFromTag(lin, 'scaled');
                result.direction = {
                    type: 'linear',
                    angle: ang ? parseInt(ang) / 60000 : 0,
                    scaled: scaled !== '0'
                };
            }

            const path = this._extractTag(gradFill, 'a:path');
            if (path) {
                const pathType = this._extractAttrFromTag(path, 'path') || 'shape';
                result.direction = { type: 'path', pathType };

                const fillToRect = this._extractTag(path, 'a:fillToRect');
                if (fillToRect) {
                    result.direction.fillToRect = {
                        left: parseInt(this._extractAttrFromTag(fillToRect, 'l') || '0') / 1000,
                        top: parseInt(this._extractAttrFromTag(fillToRect, 't') || '0') / 1000,
                        right: parseInt(this._extractAttrFromTag(fillToRect, 'r') || '0') / 1000,
                        bottom: parseInt(this._extractAttrFromTag(fillToRect, 'b') || '0') / 1000
                    };
                }
            }

            const rotWithShape = this._extractAttrFromTag(gradFill, 'rotWithShape');
            result.rotWithShape = rotWithShape !== '0';

            return result;
        }

        const blipFill = this._extractTag(parentXml, 'a:blipFill');
        if (blipFill) {
            const result = { type: 'blip', imageRId: null, crop: null, dpi: null, align: null };

            const blip = this._extractTag(blipFill, 'a:blip');
            if (blip) {
                result.imageRId = this._extractAttrFromTag(blip, 'r:embed');
                const link = this._extractAttrFromTag(blip, 'r:link');
                if (link) result.imageLinkId = link;
            }

            const srcRect = this._extractTag(blipFill, 'a:srcRect');
            if (srcRect) {
                result.crop = {
                    left: this._extractAttrFromTag(srcRect, 'l') || '0',
                    top: this._extractAttrFromTag(srcRect, 't') || '0',
                    right: this._extractAttrFromTag(srcRect, 'r') || '0',
                    bottom: this._extractAttrFromTag(srcRect, 'b') || '0'
                };
            }

            const dpiAttr = this._extractAttrFromTag(blipFill, 'dpi');
            if (dpiAttr) result.dpi = parseInt(dpiAttr);

            const stretch = this._extractTag(blipFill, 'a:stretch');
            if (stretch) {
                result.stretch = true;
                const fillRect = this._extractTag(stretch, 'a:fillRect');
                if (fillRect) {
                    result.stretchRect = {
                        left: parseInt(this._extractAttrFromTag(fillRect, 'l') || '0') / 1000,
                        top: parseInt(this._extractAttrFromTag(fillRect, 't') || '0') / 1000,
                        right: parseInt(this._extractAttrFromTag(fillRect, 'r') || '0') / 1000,
                        bottom: parseInt(this._extractAttrFromTag(fillRect, 'b') || '0') / 1000
                    };
                }
            }

            const tile = this._extractTag(blipFill, 'a:tile');
            if (tile) {
                result.tile = true;
                result.tileRect = {
                    tx: parseInt(this._extractAttrFromTag(tile, 'tx') || '0'),
                    ty: parseInt(this._extractAttrFromTag(tile, 'ty') || '0'),
                    sx: parseInt(this._extractAttrFromTag(tile, 'sx') || '100000') / 1000,
                    sy: parseInt(this._extractAttrFromTag(tile, 'sy') || '100000') / 1000
                };
            }

            return result;
        }

        const pattFill = this._extractTag(parentXml, 'a:pattFill');
        if (pattFill) {
            const fgColor = this._parseColor(this._extractTag(pattFill, 'a:fgClr') || '');
            const bgColor = this._parseColor(this._extractTag(pattFill, 'a:bgClr') || '');
            const prst = this._extractAttrFromTag(pattFill, 'prst');
            return { type: 'pattern', fgColor, bgColor, pattern: prst || 'solid' };
        }

        const noFill = this._extractTag(parentXml, 'a:noFill');
        if (noFill) {
            return { type: 'none' };
        }

        return null;
    }

    _parseOutline(parentXml) {
        const ln = this._extractTag(parentXml, 'a:ln');
        if (!ln) return null;

        const w = this._extractAttrFromTag(ln, 'w');
        const result = {
            width: w ? parseInt(w) / EMU_PER_PT : 0.75,
            color: null,
            dashStyle: 'solid',
            lineCap: 'flat',
            headEnd: null,
            tailEnd: null
        };

        result.color = this._parseColor(ln);

        const prstDash = this._extractTag(ln, 'a:prstDash');
        if (prstDash) {
            result.dashStyle = this._extractAttrFromTag(prstDash, 'val') || 'solid';
        }

        const cap = this._extractAttrFromTag(ln, 'cap');
        if (cap) result.lineCap = cap;

        const headEnd = this._extractTag(ln, 'a:headEnd');
        if (headEnd) {
            result.headEnd = {
                type: this._extractAttrFromTag(headEnd, 'type') || 'none',
                w: this._extractAttrFromTag(headEnd, 'w') || 'med',
                len: this._extractAttrFromTag(headEnd, 'len') || 'med'
            };
        }

        const tailEnd = this._extractTag(ln, 'a:tailEnd');
        if (tailEnd) {
            result.tailEnd = {
                type: this._extractAttrFromTag(tailEnd, 'type') || 'none',
                w: this._extractAttrFromTag(tailEnd, 'w') || 'med',
                len: this._extractAttrFromTag(tailEnd, 'len') || 'med'
            };
        }

        return result;
    }

    _parseBackground(bgXml) {
        const bgFill = this._extractTag(bgXml, 'a:bgPr');
        if (bgFill) {
            const fill = this._parseFill(bgFill);
            if (fill) {
                const effectLst = this._extractTag(bgFill, 'a:effectLst');
                if (effectLst) {
                    fill.effects = this._parseBackgroundEffects(effectLst);
                }
                return fill;
            }
        }

        const bgRef = this._extractTag(bgXml, 'p:bgRef');
        if (bgRef) {
            const idx = this._extractAttrFromTag(bgRef, 'idx');
            const color = this._parseColor(bgRef);
            return { type: 'themeRef', idx: parseInt(idx || '0'), color };
        }

        return null;
    }

    _parseBackgroundEffects(effectLstXml) {
        const effects = [];
        const blur = this._extractTag(effectLstXml, 'a:blur');
        if (blur) {
            effects.push({ type: 'blur', rad: parseInt(this._extractAttrFromTag(blur, 'rad') || '0') / EMU_PER_PT });
        }
        return effects;
    }

    _parseTransition(xml) {
        const result = { type: 'none', duration: 700 };
        const advTm = this._extractAttrFromTag(xml, 'advTm');
        if (advTm) result.autoAdvanceMs = parseInt(advTm);
        const spd = this._extractAttrFromTag(xml, 'spd');
        if (spd) result.speed = spd;

        const transitionTypes = ['p:fade', 'p:push', 'p:wipe', 'p:split', 'p:cover', 'p:pull',
            'p:wheel', 'p:random', 'p:strips', 'p:bar', 'p:blinds', 'p:checker',
            'p:dissolve', 'p:comb', 'p:newsflash', 'p:plus', 'p:wedge'];

        for (const t of transitionTypes) {
            if (xml.includes(t)) {
                result.type = t.replace('p:', '');
                const dirAttr = this._extractAttrFromTag(this._extractTag(xml, t), 'dir');
                if (dirAttr) result.direction = dirAttr;
                break;
            }
        }

        return result;
    }

    _parseColor(parentXml) {
        if (!parentXml) return null;

        const srgbClr = this._extractTag(parentXml, 'a:srgbClr');
        if (srgbClr) {
            const val = this._extractAttrFromTag(srgbClr, 'val');
            let color = val ? `#${val}` : null;
            const alpha = this._extractTag(srgbClr, 'a:alpha');
            if (alpha && color) {
                const alphaVal = parseInt(this._extractAttrFromTag(alpha, 'val') || '100000') / 1000;
                color = this._applyAlpha(color, alphaVal);
            }
            const lumMod = this._extractTag(srgbClr, 'a:lumMod');
            const lumOff = this._extractTag(srgbClr, 'a:lumOff');
            if (lumMod || lumOff) {
                color = this._applyLuminance(color,
                    lumMod ? parseInt(this._extractAttrFromTag(lumMod, 'val') || '100000') / 1000 : 1,
                    lumOff ? parseInt(this._extractAttrFromTag(lumOff, 'val') || '0') / 1000 : 0
                );
            }
            return color;
        }

        const schemeClr = this._extractTag(parentXml, 'a:schemeClr');
        if (schemeClr) {
            const val = this._extractAttrFromTag(schemeClr, 'val');
            let color = null;
            if (this.theme && this.theme.colors[val]) {
                color = this.theme.colors[val];
            }
            if (!color) {
                color = `var(--theme-${val})`;
            }
            const alpha = this._extractTag(schemeClr, 'a:alpha');
            if (alpha && color && !color.startsWith('var(')) {
                const alphaVal = parseInt(this._extractAttrFromTag(alpha, 'val') || '100000') / 1000;
                color = this._applyAlpha(color, alphaVal);
            }
            const lumMod = this._extractTag(schemeClr, 'a:lumMod');
            const lumOff = this._extractTag(schemeClr, 'a:lumOff');
            if ((lumMod || lumOff) && color && !color.startsWith('var(')) {
                color = this._applyLuminance(color,
                    lumMod ? parseInt(this._extractAttrFromTag(lumMod, 'val') || '100000') / 1000 : 1,
                    lumOff ? parseInt(this._extractAttrFromTag(lumOff, 'val') || '0') / 1000 : 0
                );
            }
            return color;
        }

        const prstClr = this._extractTag(parentXml, 'a:prstClr');
        if (prstClr) {
            const val = this._extractAttrFromTag(prstClr, 'val');
            const presetMap = {
                'white': '#FFFFFF', 'black': '#000000', 'red': '#FF0000', 'green': '#008000',
                'blue': '#0000FF', 'yellow': '#FFFF00', 'cyan': '#00FFFF', 'magenta': '#FF00FF',
                'gray': '#808080', 'grey': '#808080', 'darkGray': '#404040', 'darkGrey': '#404040',
                'lightGray': '#C0C0C0', 'lightGrey': '#C0C0C0', 'maroon': '#800000',
                'olive': '#808000', 'purple': '#800080', 'teal': '#008080', 'navy': '#000080',
                'coral': '#FF7F50', 'salmon': '#FA8072', 'gold': '#FFD700', 'silver': '#C0C0C0'
            };
            return presetMap[val] || val;
        }

        const hslClr = this._extractTag(parentXml, 'a:hslClr');
        if (hslClr) {
            const hue = parseInt(this._extractAttrFromTag(hslClr, 'hue') || '0') / 60000;
            const sat = parseInt(this._extractAttrFromTag(hslClr, 'sat') || '100000') / 1000;
            const lum = parseInt(this._extractAttrFromTag(hslClr, 'lum') || '50000') / 1000;
            return this._hslToHex(hue, sat, lum);
        }

        return null;
    }

    _hslToHex(h, s, l) {
        s /= 100;
        l /= 100;
        const a = s * Math.min(l, 1 - l);
        const f = n => {
            const k = (n + h / 30) % 12;
            const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
            return Math.round(255 * color).toString(16).padStart(2, '0');
        };
        return `#${f(0)}${f(8)}${f(4)}`;
    }

    _applyAlpha(hexColor, alphaPercent) {
        const alpha = Math.round(alphaPercent * 2.55);
        const hex = alpha.toString(16).padStart(2, '0');
        return `${hexColor}${hex}`;
    }

    _applyLuminance(hexColor, mod, off) {
        if (!hexColor || hexColor.startsWith('var(')) return hexColor;
        const hex = hexColor.replace('#', '').substring(0, 6);
        if (hex.length < 6) return hexColor;
        const r = parseInt(hex.substring(0, 2), 16) / 255;
        const g = parseInt(hex.substring(2, 4), 16) / 255;
        const b = parseInt(hex.substring(4, 6), 16) / 255;
        const nr = Math.min(255, Math.round((r * mod + off / 100) * 255));
        const ng = Math.min(255, Math.round((g * mod + off / 100) * 255));
        const nb = Math.min(255, Math.round((b * mod + off / 100) * 255));
        return `#${nr.toString(16).padStart(2, '0')}${ng.toString(16).padStart(2, '0')}${nb.toString(16).padStart(2, '0')}`;
    }

    _parseOffset(xfrmXml) {
        const off = this._extractTag(xfrmXml, 'a:off');
        if (!off) return null;
        return {
            x: parseInt(this._extractAttrFromTag(off, 'x') || '0'),
            y: parseInt(this._extractAttrFromTag(off, 'y') || '0')
        };
    }

    _parseExtents(xfrmXml) {
        const ext = this._extractTag(xfrmXml, 'a:ext');
        if (!ext) return null;
        return {
            cx: parseInt(this._extractAttrFromTag(ext, 'cx') || '0'),
            cy: parseInt(this._extractAttrFromTag(ext, 'cy') || '0')
        };
    }

    _parseRotation(xfrmXml) {
        const rot = this._extractAttrFromTag(xfrmXml, 'rot');
        return rot ? parseInt(rot) / 60000 : 0;
    }

    async _extractImages() {
        const mediaFiles = Object.keys(this.zip.files).filter(f =>
            f.startsWith('ppt/media/')
        );

        for (const file of mediaFiles) {
            const data = await this.zip.files[file].async('nodebuffer');
            const ext = path.extname(file).toLowerCase();
            const mimeMap = {
                '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
                '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
                '.emf': 'image/x-emf', '.wmf': 'image/x-wmf',
                '.tiff': 'image/tiff', '.tif': 'image/tiff', '.bmp': 'image/bmp'
            };
            const mime = mimeMap[ext] || 'image/png';
            const isVector = ext === '.emf' || ext === '.wmf';

            this.images[path.basename(file)] = {
                data: data,
                base64: data.toString('base64'),
                dataUrl: `data:${mime};base64,${data.toString('base64')}`,
                size: data.length,
                mime,
                isVector,
                ext
            };
        }
    }

    _resolveImageRef(rId, rels) {
        if (!rId || !rels || !rels[rId]) return null;
        const target = rels[rId].target;
        const imageName = path.basename(target);
        return this.images[imageName] || null;
    }

    _resolveElementImages(elements, rels) {
        for (const el of elements) {
            if (el.type === 'image' && el.imageRId) {
                const imageData = this._resolveImageRef(el.imageRId, rels);
                if (imageData) {
                    if (imageData.isVector) {
                        el.src = null;
                        el.srcMime = imageData.mime;
                        el.isVector = true;
                        el.vectorFormat = imageData.ext;
                        el.vectorData = imageData.base64;
                    } else {
                        el.src = imageData.dataUrl;
                        el.srcMime = imageData.mime;
                    }
                }
            }
            if (el.type === 'shape' && el.fill && el.fill.type === 'blip' && el.fill.imageRId) {
                const imageData = this._resolveImageRef(el.fill.imageRId, rels);
                if (imageData) {
                    if (imageData.isVector) {
                        el.fill.src = null;
                        el.fill.isVector = true;
                        el.fill.vectorFormat = imageData.ext;
                    } else {
                        el.fill.src = imageData.dataUrl;
                    }
                    el.fill.srcMime = imageData.mime;
                }
            }
            if (el.type === 'group' && el.children) {
                this._resolveElementImages(el.children, rels);
            }
        }
    }

    _buildResult() {
        for (const [, master] of Object.entries(this.masters)) {
            const masterRels = master.rels || {};
            this._resolveElementImages(master.elements, masterRels);
            if (master.background && master.background.type === 'blip' && master.background.imageRId) {
                const imageData = this._resolveImageRef(master.background.imageRId, masterRels);
                if (imageData) {
                    master.background.src = imageData.isVector ? null : imageData.dataUrl;
                    master.background.srcMime = imageData.mime;
                    master.background.isVector = imageData.isVector;
                }
            }
        }

        for (const [, layout] of Object.entries(this.layouts)) {
            const layoutRels = layout.rels || {};
            this._resolveElementImages(layout.elements, layoutRels);
            if (layout.background && layout.background.type === 'blip' && layout.background.imageRId) {
                const imageData = this._resolveImageRef(layout.background.imageRId, layoutRels);
                if (imageData) {
                    layout.background.src = imageData.isVector ? null : imageData.dataUrl;
                    layout.background.srcMime = imageData.mime;
                    layout.background.isVector = imageData.isVector;
                }
            }
        }

        const slides = [];
        const slideNames = Object.keys(this.slides).sort((a, b) => {
            const numA = parseInt(a.replace('slide', ''));
            const numB = parseInt(b.replace('slide', ''));
            return numA - numB;
        });

        for (const slideName of slideNames) {
            const slide = this.slides[slideName];
            const slideRels = slide.rels || {};
            this._resolveElementImages(slide.elements, slideRels);

            if (slide.background && slide.background.type === 'blip' && slide.background.imageRId) {
                const imageData = this._resolveImageRef(slide.background.imageRId, slideRels);
                if (imageData) {
                    slide.background.src = imageData.isVector ? null : imageData.dataUrl;
                    slide.background.srcMime = imageData.mime;
                    slide.background.isVector = imageData.isVector;
                }
            }

            const merged = this._mergeInheritance(slide);
            merged.index = parseInt(slideName.replace('slide', ''));

            slides.push(merged);
        }

        return {
            theme: this.theme,
            slideWidth: this.slideWidth,
            slideHeight: this.slideHeight,
            slideWidthPx: this.slideWidth / EMU_PER_PT,
            slideHeightPx: this.slideHeight / EMU_PER_PT,
            masters: this.masters,
            layouts: this.layouts,
            slides,
            imageCount: Object.keys(this.images).length
        };
    }

    _mergeInheritance(slide) {
        const result = {
            index: 0,
            background: null,
            elements: [],
            placeholders: {},
            transition: slide.transition || null,
            showMasterPlaceholders: slide.showMasterPlaceholders !== false,
            defaultTextStyles: null
        };

        const layout = slide.layoutRef ? this.layouts[slide.layoutRef] : null;
        const master = layout?.masterRef ? this.masters[layout.masterRef] : null;

        if (master) {
            result.background = master.background || null;
            result.defaultTextStyles = master.defaultTextStyles || null;

            if (result.showMasterPlaceholders) {
                const masterElements = this._deepCloneElements(master.elements);
                this._markInherited(masterElements, 'master');
                result.elements.push(...masterElements);
            }

            for (const [key, val] of Object.entries(master.placeholders || {})) {
                result.placeholders[key] = { ...val, source: 'master' };
            }
        }

        if (layout) {
            if (layout.background) {
                result.background = layout.background;
            }

            const layoutElements = this._deepCloneElements(layout.elements);
            this._markInherited(layoutElements, 'layout');
            result.elements.push(...layoutElements);

            for (const [key, val] of Object.entries(layout.placeholders || {})) {
                result.placeholders[key] = { ...val, source: 'layout' };
            }
        }

        if (slide.background) {
            result.background = slide.background;
        }

        const slideElements = this._deepCloneElements(slide.elements);
        this._markInherited(slideElements, 'slide');
        result.elements.push(...slideElements);

        for (const el of slide.elements) {
            if (el.placeholder) {
                const key = `${el.placeholder.type}_${el.placeholder.idx}`;
                result.placeholders[key] = { ...el, source: 'slide' };
            }
        }

        result.elements = this._deduplicatePlaceholders(result.elements, result.placeholders);

        return result;
    }

    _deepCloneElements(elements) {
        return JSON.parse(JSON.stringify(elements, (key, value) => {
            if (key === 'src' && typeof value === 'string' && value.startsWith('data:') && value.length > 100000) {
                return value.substring(0, 50) + '...[TRUNCATED]';
            }
            return value;
        }));
    }

    _markInherited(elements, source) {
        for (const el of elements) {
            el.source = source;
            if (el.type === 'group' && el.children) {
                this._markInherited(el.children, source);
            }
        }
    }

    _deduplicatePlaceholders(elements, placeholders) {
        const slidePlaceholderKeys = new Set();
        for (const [, val] of Object.entries(placeholders)) {
            if (val.source === 'slide' && val.placeholder) {
                slidePlaceholderKeys.add(`${val.placeholder.type}_${val.placeholder.idx}`);
            }
        }

        return elements.filter(el => {
            if (el.source !== 'slide' && el.placeholder) {
                const key = `${el.placeholder.type}_${el.placeholder.idx}`;
                if (slidePlaceholderKeys.has(key)) {
                    return false;
                }
            }
            return true;
        });
    }

    _extractTag(xml, tagName) {
        if (!xml) return null;
        const escapedTag = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const selfClosing = new RegExp(`<${escapedTag}[^>]*/>`);
        const opening = new RegExp(`<${escapedTag}[^>]*>`);
        const closing = new RegExp(`</${escapedTag}>`);

        const selfMatch = xml.match(selfClosing);
        if (selfMatch) return selfMatch[0];

        const openMatch = opening.exec(xml);
        if (!openMatch) return null;

        const startIdx = openMatch.index;
        const afterOpen = startIdx + openMatch[0].length;

        let depth = 1;
        let idx = afterOpen;
        const simpleTag = tagName.split(':').pop();

        while (depth > 0 && idx < xml.length) {
            const nextOpen = xml.indexOf(`<${simpleTag}`, idx);
            const nextClose = xml.indexOf(`</${simpleTag}>`, idx);

            if (nextClose === -1) break;

            if (nextOpen !== -1 && nextOpen < nextClose) {
                depth++;
                idx = nextOpen + 1;
            } else {
                depth--;
                if (depth === 0) {
                    return xml.substring(startIdx, nextClose + `</${simpleTag}>`.length);
                }
                idx = nextClose + 1;
            }
        }

        const fullClose = xml.indexOf(`</${tagName}>`, afterOpen);
        if (fullClose !== -1) {
            return xml.substring(startIdx, fullClose + `</${tagName}>`.length);
        }

        return null;
    }

    _extractAllTags(xml, tagName) {
        if (!xml) return [];
        const results = [];
        let searchFrom = 0;

        while (true) {
            const tag = this._extractTag(xml.substring(searchFrom), tagName);
            if (!tag) break;
            results.push(tag);
            const tagStart = xml.indexOf(tag, searchFrom);
            searchFrom = tagStart + tag.length;
        }

        return results;
    }

    _extractAttr(xml, tagName, attrName) {
        if (!xml) return null;
        const escapedTag = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`<${escapedTag}[^>]*?\\s${attrName}="([^"]*)"`);
        const match = xml.match(regex);
        return match ? match[1] : null;
    }

    _extractAttrFromTag(tagXml, attrName) {
        if (!tagXml) return null;
        const regex = new RegExp(`${attrName}="([^"]*)"`);
        const match = tagXml.match(regex);
        return match ? match[1] : null;
    }

    _extractTextContent(xml, tagName) {
        if (!xml) return null;
        const escapedTag = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`<${escapedTag}[^>]*>([\\s\\S]*?)</${escapedTag}>`, 'g');
        let match;
        let text = '';
        while ((match = regex.exec(xml)) !== null) {
            text += this._decodeXml(match[1]);
        }
        return text || null;
    }

    _decodeXml(str) {
        return str
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'")
            .replace(/&#10;/g, '\n')
            .replace(/&#13;/g, '\r')
            .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)));
    }

    async _readFile(filePath) {
        const file = this.zip.files[filePath];
        if (!file) return null;
        try {
            return await file.async('text');
        } catch {
            return null;
        }
    }

    static emuToPt(emu) {
        return emu / EMU_PER_PT;
    }

    static emuToPx(emu, dpi = 96) {
        return Math.round(emu / EMU_PER_INCH * dpi);
    }

    static emuToPercent(emu, total) {
        return (emu / total * 100).toFixed(2);
    }

    static getClipPath(shapeType) {
        return PRESET_SHAPE_CLIP_PATHS[shapeType] || null;
    }
}

module.exports = PptxParser;
