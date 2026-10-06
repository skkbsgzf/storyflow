// Pinax 任务面启动件（P2 口径统一）：pinax-adapter 运行时迁入 kit 后的入口。
// 配置面不变：PINAX_ADAPTER_CONFIG 指定路径 > <storyharness>/.external/pinax-adapter.json > 默认（127.0.0.1:8451）。
// 启动：npm run serve:pinax（或 tsx src/pinax/serve.ts）。
import { startServer } from "./server.js";

startServer();
