// 见 `core/vitest.config.ts`：Node 宿主测试须先注册平台适配器，`nodeFs`/`nodePath`/`nodeProc` 才落地。
import "../src/abstraction/adapters/node.js";
