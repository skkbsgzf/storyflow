# @storyflow/adapters

Storyflow 平台适配器包（工单 R7-3 物理拆包）：

- **契约**：`fs.ts`（IFileSystem/IFsPath）、`proc.ts`（IProcessLauncher）、`env.ts`（IEnv）、`hash.ts`（IHasher）
- **注册表**：`defaults.ts`（平台缺省适配器，未注册即抛错——core 不 import 任何宿主实现）
- **实现**：`node.ts`（import 即自动注册）、`mock.ts`（内存盘/假进程，契约自测与可嵌入冒烟）

`@storyflow/core` 通过 `core/src/abstraction/` 下的 re-export shim 消费本包（旧路径不变）。
`import.meta.dirname` 时代的宿主登记点：Node 宿主 import 本包 `node.js` 一次即可。
