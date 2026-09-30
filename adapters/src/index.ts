export * from "./fs.js";
export * from "./proc.js";
export * from "./env.js";
export * from "./hash.js";
export * from "./defaults.js";
export * from "./mock.js";
// node.js 的 nodeFs/nodePath/... 与 defaults.js 的转发同名——实现类单列导出，
// 平台缺省一律走 defaults（注册表），避免 index 聚合时的双源歧义（TS2308）。
export { NodeFsAdapter, NodePathAdapter, NodeProcLauncher } from "./node.js";
