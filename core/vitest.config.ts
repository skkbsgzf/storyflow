import { defineConfig } from "vitest/config";

/**
 * 唯一的 setup 项：把 Node 三家适配器登记为平台缺省。
 *
 * R7-1 起 core 侧的尾参默认 `= nodeFs` 不再直接指向 Node 实现，而是指向
 * `src/abstraction/defaults.ts` 的注册表；测试跑在真 Node 宿主上，所以启动即注册。
 * 这同时也是给宿主看的样例：**用 core 就得注册一家适配器**，没有静默回落。
 * 用假盘的用例（`abstraction-*`、`fs-call-matrix`、`r6-host-free`）走显式注入，不受影响。
 */
export default defineConfig({
  test: {
    setupFiles: ["./test/setup-adapters.ts"],
  },
});
