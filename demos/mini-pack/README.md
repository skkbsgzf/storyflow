# mini-pack · 最小第二语料包 fixture

证明「**换语料仓不改底座代码**」的可重复样例（设计案 §3.4 口径）：

- 本目录是一个独立语料仓：自己的 `.storyharness.json`（`runtime.ui` 声明为
  `python -m http.server {port}`，**无 kernel 节**——协议面直接回落，不需要真内核）、空 `projects/`。
- 底座（storyharness 包）对它零适配：`npm run verify:pack` 用它拉起 web，断言
  ①ui 按 manifest 命令起来可访问 ②协议面 /status 响应 ③退出清理子进程。

**注意**：`npm run verify:pack` 用临时端口（18990-18992），真仓的 `.storyharness.json`
与 8431 协议面全程不被触碰。
