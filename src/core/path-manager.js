/**
 * PathManager — 统一路径管理
 * 功能：隔离文件操作，提供统一的路径解析和沙盒边界校验
 */

const path = require('path');
const fs = require('fs');

// 数据根目录
const DATA_DIR = path.join(__dirname, '..');

// 预定义的沙盒目录
const SANDBOX_DIRS = {
    workspace: path.join(DATA_DIR, 'workspace'),
    logs: path.join(DATA_DIR, 'logs'),
    memory: path.join(DATA_DIR, 'memory'),
    patches: path.join(DATA_DIR, 'patches'),
    sandbox: path.join(DATA_DIR, 'sandbox'),
    versions: path.join(DATA_DIR, 'versions')
};

// 只读目录（系统代码）
const READONLY_DIRS = {
    core: path.join(DATA_DIR, 'core'),
    modules: path.join(DATA_DIR, 'modules'),
    web: path.join(DATA_DIR, '..', 'web')
};

const pathManager = {
    /**
     * 获取数据根目录
     */
    getDataDir() {
        return DATA_DIR;
    },
    
    /**
     * 获取沙盒目录
     * @param {string} name - 目录名 (workspace, logs, memory, patches, sandbox, versions)
     */
    getSandboxDir(name) {
        return SANDBOX_DIRS[name] || null;
    },
    
    /**
     * 解析相对路径为绝对路径
     * @param {string} relativePath - 相对于 Data/ 的路径
     * @param {string} sandbox - 沙盒名（可选，用于安全校验）
     */
    resolve(relativePath, sandbox = null) {
        let fullPath;
        
        if (sandbox && SANDBOX_DIRS[sandbox]) {
            // 在指定沙盒内解析
            fullPath = path.resolve(SANDBOX_DIRS[sandbox], relativePath);
            
            // 安全检查：路径不能逃出沙盒
            if (!fullPath.startsWith(SANDBOX_DIRS[sandbox])) {
                throw new Error(`路径逃逸检测: ${relativePath} 试图访问沙盒外目录`);
            }
        } else {
            // 在 Data/ 内解析
            fullPath = path.resolve(DATA_DIR, relativePath);
            
            // 安全检查：路径不能逃出 Data/
            if (!fullPath.startsWith(DATA_DIR)) {
                throw new Error(`路径逃逸检测: ${relativePath} 试图访问数据目录外`);
            }
        }
        
        return fullPath;
    },
    
    /**
     * 检查路径是否在沙盒内
     */
    isSandboxed(fullPath, sandbox) {
        const sandboxDir = SANDBOX_DIRS[sandbox];
        return sandboxDir && fullPath.startsWith(sandboxDir);
    },
    
    /**
     * 检查路径是否只读
     */
    isReadonly(fullPath) {
        for (const dir of Object.values(READONLY_DIRS)) {
            if (fullPath.startsWith(dir)) {
                return true;
            }
        }
        return false;
    },
    
    /**
     * 确保目录存在
     */
    ensureDir(dirPath) {
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
        }
        return dirPath;
    },
    
    /**
     * 获取模块路径
     */
    getModulePath(moduleName) {
        // 尝试在 core/ 和 modules/ 中查找
        const possiblePaths = [
            path.join(DATA_DIR, 'core', `${moduleName}.js`),
            path.join(DATA_DIR, 'modules', `${moduleName}.js`)
        ];
        
        for (const p of possiblePaths) {
            if (fs.existsSync(p)) {
                return p;
            }
        }
        
        return null;
    },
    
    /**
     * 列出所有可用模块
     */
    listModules() {
        const modules = [];
        
        // 扫描 core/
        const coreDir = path.join(DATA_DIR, 'core');
        if (fs.existsSync(coreDir)) {
            fs.readdirSync(coreDir)
                .filter(f => f.endsWith('.js'))
                .forEach(f => modules.push({
                    name: f.replace('.js', ''),
                    path: `core/${f}`,
                    type: 'core'
                }));
        }
        
        // 扫描 modules/
        const modulesDir = path.join(DATA_DIR, 'modules');
        if (fs.existsSync(modulesDir)) {
            fs.readdirSync(modulesDir)
                .filter(f => f.endsWith('.js'))
                .forEach(f => modules.push({
                    name: f.replace('.js', ''),
                    path: `modules/${f}`,
                    type: 'module'
                }));
        }
        
        return modules;
    },
    
    /**
     * 获取项目结构概览
     */
    getStructure() {
        return {
            dataDir: DATA_DIR,
            sandboxDirs: Object.fromEntries(
                Object.entries(SANDBOX_DIRS).map(([k, v]) => [k, v])
            ),
            readonlyDirs: Object.fromEntries(
                Object.entries(READONLY_DIRS).map(([k, v]) => [k, v])
            ),
            modules: this.listModules()
        };
    }
};

module.exports = pathManager;
