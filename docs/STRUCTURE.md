# 创世纪基础目录结构

.
├── .app/                 # 模拟应用包根目录
│   ├── Contents/
│   │   ├── MacOS/        # 宿主引擎（签名二进制）
│   │   └── Resources/
│   │       ├── Data/     # 业务逻辑与数据态（可变）
│   │       │   ├── core/     # 状态机与核心逻辑
│   │       │   ├── modules/  # 业务插件（执行层）
│   │       │   ├── memory/   # 长期记忆与进化记录
│   │       │   └── logs/     # 运行日志
│   │       └── Config/       # 应用配置
├── src/                  # 开发源码
├── memorys/              # 项目专属记忆
└── ARCHITECTURE.md
