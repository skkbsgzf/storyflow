/**
 * 环境面抽象（FS1 v1 只管「盘 + 路径 + 子进程」三面；env 属宿主面，R7-2 起入册）。
 *
 * 为什么只收这两个方法：库面真实调用普查（工单 R7-2）——
 *   `get`    ：MINIFLOW_ROOT / MINIFLOW_PYTHON / MINIFLOW_AGENT_* / MINIFLOW_HEADER_MODE /
 *              MINIFLOW_CONTRACTS_DIR / MINIFLOW_STATIC_DENY_PREFIX；
 *   `platform`：compat.ts 的解释器选择（win32 → python，否则 python3）。
 * 整包 env 展开（`{...process.env}`）是宿主件特权（agent-mcp.ts / cli.ts），不进接口——
 * 库面传 `ProcOptions.envDelta`（见 proc.ts），由适配器负责合并继承。
 */
export interface IEnv {
  /** 读单个环境变量；未设置返回 undefined（与 process.env 语义一致，不区分空串）。 */
  get(name: string): string | undefined;
  /** 宿主平台标识（Node 上即 process.platform，如 "win32" / "linux" / "darwin"）。 */
  platform(): string;
}
