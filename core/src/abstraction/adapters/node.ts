/**
 * re-export shim（工单 R7-3 物理拆包）：Node 适配器本体迁至 @storyflow/adapters/node
 * （import 即自动注册平台缺省）。旧路径保活——宿主入口与测试的既有 import 零改动。
 */
export * from "@storyflow/adapters/node.js";
