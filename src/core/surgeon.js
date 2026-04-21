/**
 * Surgeon Tool — 手术刀工具（v2：增量 diff + 审批队列）
 * 功能：安全地修改系统代码，支持增量 diff 补丁、审批队列和回滚
 * 
 * 核心能力：
 * 1. readSource - 读取源代码
 * 2. applyPatch - 全量替换补丁（兼容旧接口）
 * 3. applyDiff - 增量 diff 补丁（精确字符串替换，推荐）
 * 4. submitForApproval - 提交进化修改到审批队列
 * 5. approvePatch / rejectPatch - 审批操作
 * 6. listPending - 查看待审批列表
 * 7. rollback - 回滚到上一版本
 */

const fs = require('fs');
const path = require('path');
const logger = require('./logger');

// 目录路径
const DATA_DIR = path.join(__dirname, '..');
const PATCHES_DIR = path.join(DATA_DIR, 'patches');
const SANDBOX_DIR = path.join(DATA_DIR, 'sandbox');
const VERSIONS_DIR = path.join(DATA_DIR, 'versions');
const APPROVALS_DIR = path.join(DATA_DIR, 'approvals');

// 确保目录存在
[PATCHES_DIR, SANDBOX_DIR, VERSIONS_DIR, APPROVALS_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

const surgeon = {
    /**
     * 读取源代码
     * @param {string} modulePath - 模块路径（相对于 Data/）
     * @returns {object} - 源代码内容
     */
    readSource(modulePath) {
        const fullPath = path.join(DATA_DIR, modulePath);
        
        if (!fs.existsSync(fullPath)) {
            throw new Error(`模块不存在: ${modulePath}`);
        }
        
        const content = fs.readFileSync(fullPath, 'utf-8');
        logger.info('SURGEON', `读取源码: ${modulePath}`, { size: content.length });
        
        return {
            path: modulePath,
            fullPath,
            content,
            size: content.length,
            modified: fs.statSync(fullPath).mtime
        };
    },
    
    /**
     * 应用全量补丁（兼容旧接口）
     * @param {string} modulePath - 模块路径
     * @param {string} patchContent - 补丁内容（完整新文件）
     * @param {string} reason - 修改原因
     * @returns {object} - 应用结果
     */
    applyPatch(modulePath, patchContent, reason = '进化修改') {
        const fullPath = path.join(DATA_DIR, modulePath);
        
        // 1. 备份当前版本
        const versionId = Date.now();
        const versionFile = path.join(VERSIONS_DIR, `${versionId}-${path.basename(modulePath)}`);
        
        if (fs.existsSync(fullPath)) {
            fs.copyFileSync(fullPath, versionFile);
            logger.info('SURGEON', `备份版本: ${versionId}`, { modulePath });
        }
        
        // 2. 保存补丁记录
        const patchRecord = {
            id: versionId,
            modulePath,
            reason,
            type: 'full',
            timestamp: new Date().toISOString(),
            patchSize: patchContent.length
        };
        const patchMetaFile = path.join(PATCHES_DIR, `${versionId}.json`);
        fs.writeFileSync(patchMetaFile, JSON.stringify(patchRecord, null, 2));
        
        // 3. 写入新代码
        fs.writeFileSync(fullPath, patchContent, 'utf-8');
        logger.info('SURGEON', `应用全量补丁: ${modulePath}`, { reason, versionId });
        
        // 4. 记录进化历史
        this._logEvolution(modulePath, reason, versionId);
        
        return {
            success: true,
            versionId,
            modulePath,
            backupFile: versionFile
        };
    },
    
    /**
     * 应用增量 diff 补丁（精确字符串替换）
     * @param {string} modulePath - 模块路径（相对于 Data/）
     * @param {string} oldStr - 要替换的旧字符串
     * @param {string} newStr - 替换后的新字符串
     * @param {string} reason - 修改原因
     * @returns {object} - 应用结果
     */
    applyDiff(modulePath, oldStr, newStr, reason = '增量进化') {
        const fullPath = path.join(DATA_DIR, modulePath);
        
        if (!fs.existsSync(fullPath)) {
            throw new Error(`模块不存在: ${modulePath}`);
        }
        
        const original = fs.readFileSync(fullPath, 'utf-8');
        
        // 检查 oldStr 是否唯一
        const firstIdx = original.indexOf(oldStr);
        if (firstIdx === -1) {
            throw new Error(`在 ${modulePath} 中未找到要替换的代码片段`);
        }
        
        const matchCount = (original.match(new RegExp(oldStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
        
        if (matchCount > 1) {
            throw new Error(`在 ${modulePath} 中找到多处匹配（${matchCount} 处），请提供更多上下文以唯一确定替换位置`);
        }
        
        // 1. 备份当前版本
        const versionId = Date.now();
        const versionFile = path.join(VERSIONS_DIR, `${versionId}-${path.basename(modulePath)}`);
        fs.copyFileSync(fullPath, versionFile);
        logger.info('SURGEON', `备份版本: ${versionId}`, { modulePath });
        
        // 2. 执行替换
        const newContent = original.replace(oldStr, newStr);
        fs.writeFileSync(fullPath, newContent, 'utf-8');
        
        // 3. 保存补丁记录
        const patchRecord = {
            id: versionId,
            modulePath,
            reason,
            type: 'diff',
            timestamp: new Date().toISOString(),
            diff: {
                oldLength: oldStr.length,
                newLength: newStr.length,
                totalChange: newStr.length - oldStr.length
            }
        };
        const patchMetaFile = path.join(PATCHES_DIR, `${versionId}.json`);
        fs.writeFileSync(patchMetaFile, JSON.stringify(patchRecord, null, 2));
        
        // 4. 记录进化历史
        this._logEvolution(modulePath, reason, versionId, 'diff');
        
        logger.info('SURGEON', `应用增量补丁: ${modulePath}`, { 
            reason, versionId,
            changeSize: newStr.length - oldStr.length 
        });
        
        return {
            success: true,
            versionId,
            modulePath,
            backupFile: versionFile,
            type: 'diff',
            changeSize: newStr.length - oldStr.length
        };
    },
    
    /**
     * 预览 diff（不实际应用）
     * @returns {object} - 预览结果（匹配位置、替换效果）
     */
    previewDiff(modulePath, oldStr, newStr) {
        const fullPath = path.join(DATA_DIR, modulePath);
        
        if (!fs.existsSync(fullPath)) {
            return { success: false, error: `模块不存在: ${modulePath}` };
        }
        
        const original = fs.readFileSync(fullPath, 'utf-8');
        const firstIdx = original.indexOf(oldStr);
        
        if (firstIdx === -1) {
            return { success: false, error: '未找到匹配的代码片段' };
        }
        
        const matchCount = (original.match(new RegExp(oldStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
        
        // 提取上下文
        const lineStart = original.lastIndexOf('\n', firstIdx) + 1;
        const contextLines = 3;
        let ctxStart = lineStart;
        for (let i = 0; i < contextLines; i++) {
            const prevNl = original.lastIndexOf('\n', ctxStart - 1);
            if (prevNl === -1) break;
            ctxStart = prevNl + 1;
        }
        
        return {
            success: true,
            matchCount,
            isUnique: matchCount === 1,
            position: firstIdx,
            lineNumber: original.substring(0, firstIdx).split('\n').length,
            context: original.substring(ctxStart, Math.min(original.length, firstIdx + oldStr.length + 200))
        };
    },
    
    // ═══════════════════════════════════════
    // 审批队列
    // ═══════════════════════════════════════
    
    /**
     * 提交进化修改到审批队列（大进化需要人工确认）
     * @param {object} proposal - 修改提案
     * @param {string} proposal.modulePath - 目标模块
     * @param {string} proposal.description - 修改说明
     * @param {string} proposal.type - 'full' | 'diff'
     * @param {string} proposal.patchContent - 全量内容（type='full'时）
     * @param {string} proposal.oldStr - 旧代码（type='diff'时）
     * @param {string} proposal.newStr - 新代码（type='diff'时）
     * @param {string} proposal.reason - 触发原因
     * @returns {object} - 提案 ID
     */
    submitForApproval(proposal) {
        const id = `approval-${Date.now()}`;
        const record = {
            id,
            ...proposal,
            status: 'pending',  // pending | approved | rejected | applied
            createdAt: new Date().toISOString(),
            reviewedAt: null,
            reviewedBy: null
        };
        
        const recordFile = path.join(APPROVALS_DIR, `${id}.json`);
        fs.writeFileSync(recordFile, JSON.stringify(record, null, 2));
        
        logger.info('SURGEON', `提交审批: ${id}`, { 
            module: proposal.modulePath, 
            type: proposal.type 
        });
        
        return { success: true, id };
    },
    
    /**
     * 获取待审批列表
     */
    listPending() {
        const pending = [];
        try {
            const files = fs.readdirSync(APPROVALS_DIR).filter(f => f.endsWith('.json'));
            for (const file of files) {
                try {
                    const record = JSON.parse(fs.readFileSync(path.join(APPROVALS_DIR, file), 'utf-8'));
                    if (record.status === 'pending') {
                        pending.push(record);
                    }
                } catch (e) { logger.warn("SURGEON", `操作跳过: ${e.message}`); }
            }
        } catch (e) { logger.warn("SURGEON", `操作跳过: ${e.message}`); }
        return pending.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    },
    
    /**
     * 获取所有审批记录
     */
    listAllApprovals() {
        const all = [];
        try {
            const files = fs.readdirSync(APPROVALS_DIR).filter(f => f.endsWith('.json'));
            for (const file of files) {
                try {
                    all.push(JSON.parse(fs.readFileSync(path.join(APPROVALS_DIR, file), 'utf-8')));
                } catch (e) { logger.warn("SURGEON", `操作跳过: ${e.message}`); }
            }
        } catch (e) { logger.warn("SURGEON", `操作跳过: ${e.message}`); }
        return all.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    },
    
    /**
     * 审批通过并应用修改
     */
    approvePatch(approvalId) {
        const recordFile = path.join(APPROVALS_DIR, `${approvalId}.json`);
        if (!fs.existsSync(recordFile)) {
            throw new Error(`审批记录不存在: ${approvalId}`);
        }
        
        const record = JSON.parse(fs.readFileSync(recordFile, 'utf-8'));
        if (record.status !== 'pending') {
            throw new Error(`审批状态不是 pending: ${record.status}`);
        }
        
        // 应用修改
        let result;
        if (record.type === 'diff') {
            result = this.applyDiff(record.modulePath, record.oldStr, record.newStr, record.reason);
        } else {
            result = this.applyPatch(record.modulePath, record.patchContent, record.reason);
        }
        
        // 更新审批状态
        record.status = 'applied';
        record.reviewedAt = new Date().toISOString();
        record.reviewedBy = 'user';
        record.versionId = result.versionId;
        fs.writeFileSync(recordFile, JSON.stringify(record, null, 2));
        
        logger.info('SURGEON', `审批通过并应用: ${approvalId}`, { versionId: result.versionId });
        
        return { success: true, ...result };
    },
    
    /**
     * 拒绝修改
     */
    rejectPatch(approvalId) {
        const recordFile = path.join(APPROVALS_DIR, `${approvalId}.json`);
        if (!fs.existsSync(recordFile)) {
            throw new Error(`审批记录不存在: ${approvalId}`);
        }
        
        const record = JSON.parse(fs.readFileSync(recordFile, 'utf-8'));
        record.status = 'rejected';
        record.reviewedAt = new Date().toISOString();
        record.reviewedBy = 'user';
        fs.writeFileSync(recordFile, JSON.stringify(record, null, 2));
        
        logger.info('SURGEON', `审批拒绝: ${approvalId}`);
        
        return { success: true };
    },
    
    /**
     * 删除审批记录
     */
    deleteApproval(approvalId) {
        const recordFile = path.join(APPROVALS_DIR, `${approvalId}.json`);
        if (fs.existsSync(recordFile)) {
            fs.unlinkSync(recordFile);
        }
        return { success: true };
    },
    
    // ═══════════════════════════════════════
    // 沙盒测试
    // ═══════════════════════════════════════
    
    /**
     * 运行沙盒测试
     */
    runTests(modulePath, testCode) {
        logger.info('SURGEON', `运行沙盒测试: ${modulePath}`);
        
        try {
            const testFile = path.join(SANDBOX_DIR, `test-${Date.now()}.js`);
            const testContent = `
const source = require('${path.join(DATA_DIR, modulePath)}');
${testCode}
`;
            fs.writeFileSync(testFile, testContent);
            require(testFile);
            fs.unlinkSync(testFile);
            
            logger.info('SURGEON', `测试通过: ${modulePath}`);
            return { success: true, modulePath };
        } catch (error) {
            logger.error('SURGEON', `测试失败: ${error.message}`);
            return { success: false, error: error.message, modulePath };
        }
    },
    
    /**
     * 回滚到指定版本
     */
    rollback(versionId) {
        const versionFiles = fs.readdirSync(VERSIONS_DIR)
            .filter(f => f.startsWith(`${versionId}-`));
        
        if (versionFiles.length === 0) {
            throw new Error(`版本不存在: ${versionId}`);
        }
        
        const versionFile = path.join(VERSIONS_DIR, versionFiles[0]);
        
        let modulePath;
        const patchMetaFile = path.join(PATCHES_DIR, `${versionId}.json`);
        if (fs.existsSync(patchMetaFile)) {
            const patchRecord = JSON.parse(fs.readFileSync(patchMetaFile, 'utf-8'));
            modulePath = patchRecord.modulePath;
        } else {
            modulePath = versionFiles[0].replace(`${versionId}-`, '');
        }
        
        const fullPath = path.join(DATA_DIR, modulePath);
        
        const targetDir = path.dirname(fullPath);
        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }
        
        fs.copyFileSync(versionFile, fullPath);
        logger.info('SURGEON', `回滚版本: ${versionId}`, { modulePath });
        
        this._logEvolution(modulePath, `回滚到版本 ${versionId}`, versionId, 'rollback');
        
        return {
            success: true,
            versionId,
            modulePath,
            restoredFrom: versionFile
        };
    },
    
    /**
     * 获取版本列表
     */
    listVersions(modulePath = null) {
        const versions = [];
        const patchFiles = fs.readdirSync(PATCHES_DIR).filter(f => f.endsWith('.json'));
        
        for (const file of patchFiles) {
            try {
                const patch = JSON.parse(fs.readFileSync(path.join(PATCHES_DIR, file), 'utf-8'));
                if (!modulePath || patch.modulePath === modulePath) {
                    versions.push(patch);
                }
            } catch (e) { logger.warn("SURGEON", `操作跳过: ${e.message}`); }
        }
        
        return versions.sort((a, b) => b.id - a.id);
    },
    
    /**
     * 记录进化历史
     */
    _logEvolution(modulePath, reason, versionId, type = 'full') {
        const historyFile = path.join(DATA_DIR, 'logs', 'evolution_history.log');
        const entry = `[${new Date().toISOString()}] [${reason}] [${modulePath}] [版本:${versionId}] [类型:${type}] [成功]\n`;
        fs.appendFileSync(historyFile, entry);
    }
};

module.exports = surgeon;
