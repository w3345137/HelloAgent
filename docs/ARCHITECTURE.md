# 创世纪全局架构契约 (Global Architecture Contract)

## 1. 核心设计原则
*   **鲁棒性与确定性**：采用状态机驱动而非模型驱动。模型仅提供意图，状态机负责执行边界校验。
*   **零外溢 (Zero-Spillover)**：所有文件（代码、数据、日志、运行时依赖）集成在应用包（.app）内，严格禁止向系统目录写入任何配置或状态文件。
*   **动静分离**：宿主引擎（签名二进制）与业务逻辑（可变数据态）分离，支持热重载，绕过 macOS 签名校验。
*   **异步事务流**：各组件通过内存消息总线通信，通信链路故障不阻塞系统状态。

## 2. 核心架构组件
### 2.1 状态机 (Core State Machine)
*   定义系统合法状态（Idle, Planning, Executing, Interrupting, Recovering）。
*   强制中断机制：全局 `AbortController`，确保动作可随时停止。

### 2.2 路径管理器 (VFS / PathManager)
*   所有文件 I/O 必须通过 `PathManager` 映射到应用包内部路径。
*   禁止任何模块直接访问操作系统环境变量或绝对路径。

### 2.3 组件契约 (Component Contract)
*   所有功能模块（Gateway, ModelAdapter, Executor）必须实现标准接口。
*   通过 `SCHEMA.md` 进行自描述，支持进化层（Brain）动态编排。

## 3. 进化逻辑
*   **观测 (Sensor)**：全链路日志追踪，记录决策与结果上下文。
*   **手术 (Surgery)**：补丁代码先在沙盒通过测试，再由手术刀工具应用至数据目录，最后由宿主引擎重载。
