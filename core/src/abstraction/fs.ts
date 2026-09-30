/**
 * re-export shim（工单 R7-3 物理拆包）：契约本体迁至 @storyflow/adapters。
 * 旧路径 `core/src/abstraction/fs.js` 保持可用——166 处既有 import 零改动。
 */
export * from "@storyflow/adapters/fs.js";
