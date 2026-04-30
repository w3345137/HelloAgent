# 创世纪自我进化手术规范 (Surgery Protocol)

## 1. 核心原则：安全第一 (Safety First)
*   **沙盒隔离**：任何代码变更必须先在独立沙盒环境完成，严禁直接修改生产代码。
*   **原子性**：进化手术必须是原子化的，要么成功应用，要么完全回滚。
*   **可追溯性**：所有进化记录必须存入 `evolution_history.log`，包含：变更原因、修改前后的代码快照、测试结果。

## 2. 进化流程 (The Evolution Loop)
1.  **诊断 (Diagnosis)**：进化层读取 `MANIFEST.json` 和运行日志，定位性能瓶颈或逻辑错误。
2.  **手术 (Surgery)**：生成差异补丁（Patch）。
3.  **验证 (Validation)**：在沙盒中运行自动化测试用例，确保新补丁不破坏原有功能。
4.  **应用与热重载 (Apply & Hot-Reload)**：
    *   通过“手术刀”工具（Surgeon Tool）将补丁应用至数据态逻辑代码。
    *   宿主引擎检测文件变化，通过 `Hot-Reload` 机制加载新代码，无需重启应用。
5.  **回滚 (Rollback)**：若验证失败或运行时抛出异常，系统自动触发回滚并记录失败原因。

## 3. 进化接口 (Evolution Interfaces)
*   `readSource(moduleName)`：读取指定模块的源码。
*   `applyPatch(patchData)`：将补丁应用至指定模块。
*   `runTests(moduleName)`：在沙盒中运行指定模块的单元测试。
*   `rollback(version)`：回滚至特定版本。

## 4. 宿主引擎要求
*   宿主引擎需提供 `Hot-Reload` 接口，支持动态替换业务逻辑函数。
*   宿主引擎需监控数据态目录，发现代码变更后触发热重载流程。
