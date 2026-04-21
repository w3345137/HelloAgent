// modules/file-executor.js — 文件执行器
const fs = require('fs');
const path = require('path');
const messageBus = require('../core/message-bus');

class FileExecutor {
    constructor() {
        // 工作区根目录：Data/workspace/
        this.workspaceRoot = path.join(__dirname, '../workspace');

        messageBus.subscribe('EXECUTE', (data) => {
            if (data.moduleName === 'file') {
                this._execute(data.params);
            }
        });
    }

    _execute(rawParams) {
        try {
            const params = typeof rawParams === 'string' ? JSON.parse(rawParams) : rawParams;
            const { action, filePath, content } = params;
            // 安全校验：路径必须在 workspace 内
            const fullPath = path.resolve(this.workspaceRoot, filePath);
            if (!fullPath.startsWith(this.workspaceRoot)) {
                throw new Error('Path escape detected — access denied');
            }

            let result;
            switch (action) {
                case 'read':
                    result = fs.readFileSync(fullPath, 'utf-8');
                    break;
                case 'write':
                    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
                    fs.writeFileSync(fullPath, content, 'utf-8');
                    result = `Written: ${filePath}`;
                    break;
                case 'list':
                    result = fs.readdirSync(fullPath).join('\n');
                    break;
                case 'delete':
                    fs.unlinkSync(fullPath);
                    result = `Deleted: ${filePath}`;
                    break;
                default:
                    throw new Error(`Unknown file action: ${action}`);
            }

            messageBus.publish('EXECUTE_RESULT', {
                module: 'file',
                status: 'success',
                result
            });
        } catch (error) {
            messageBus.publish('ERROR', {
                module: 'file',
                message: error.message
            });
        }
    }
}

module.exports = new FileExecutor();
