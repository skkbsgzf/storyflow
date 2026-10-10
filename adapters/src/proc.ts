/**
 * 进程发起抽象。规范：`docs/_archive/规范-FS抽象层-FS1.md` §2.2。
 * 三种形态各对应现网真实调用：compat.ts/verbs.ts 的 spawnSync·execFileSync（一个看 status 不抛、
 * 一个非零即抛），minitools.ts 的 promisify(execFile)（异步、带超时终止信号）。
 * 抽象层不合并它们，否则迁移时要改判断逻辑。
 */

export interface ProcOptions {
  cwd?: string;
  /** 缺省 = 继承宿主 env；给了就整体替换。库面不要用这个字段传「继承+覆盖」——那是 envDelta 的事。 */
  env?: Record<string, string | undefined>;
  /**
   * 继承宿主 env 再叠加本条差量（R7-2：库面不许展开 process.env——那是宿主件特权）。
   * 与 env 互斥使用；同给时 env 赢（完整替换语义优先）。Node 适配器实现为
   * `{...process.env, ...envDelta}`；Mock 忽略（只记账）。
   */
  envDelta?: Record<string, string | undefined>;
  timeoutMs?: number;
  /** stdout/stderr 缓冲上限（字节）；超限按失败处理。 */
  maxBufferBytes?: number;
  /** 超时后发的信号（现网调用点 minitools.ts 用 SIGTERM）。 */
  killSignal?: string;
}

export interface ProcResult {
  /** 退出码；无法启动或被信号终止时为 null。 */
  status: number | null;
  stdout: string;
  stderr: string;
  /** 启动层错误（解释器不存在等），对应 spawnSync 的 r.error。 */
  error?: string;
  /** 终止信号名（正常退出为 null）。runAsync 专用——script 壳靠它区分「超时被杀」与「跑挂退出」。 */
  signal?: string | null;
  /** 因 timeoutMs 被终止。与「跑起来了但退非零」是两回事，不许折叠（同 error 的判断）。 */
  timedOut?: boolean;
}

/** exec 形态的失败：携带 exit code 与 stderr，供调用方拼错误摘要。 */
export class ProcExecutionError extends Error {
  constructor(
    readonly cmd: string,
    readonly args: readonly string[],
    readonly status: number | null,
    readonly stderr: string,
  ) {
    super(`${cmd} 退出码 ${status ?? "?"}`);
    this.name = "ProcExecutionError";
  }
}

export interface IProcessLauncher {
  /** 不抛错：失败体现在 status / error 上。 */
  run(cmd: string, args: readonly string[], options?: ProcOptions): ProcResult;
  /** 成功返回 stdout，非零退出或启动失败抛 ProcExecutionError。 */
  exec(cmd: string, args: readonly string[], options?: ProcOptions): string;
  /**
   * 不阻塞事件循环的 `run`（同一条永不抛契约，失败只体现在返回值）。
   * 调用点普查（R3 补，规范 §3.1）：`minitools.ts` 的 script 壳——docx 导出这类外部脚本最长跑
   * 60s，用同步 `run` 会把 HTTP/MCP 宿主整个冻住，故这里只能要异步形态。
   */
  runAsync(cmd: string, args: readonly string[], options?: ProcOptions): Promise<ProcResult>;
  /**
   * 发射后不管：分离启动、不接管道、不等退出，返回即视为「已递交」。
   * 调用点普查（R6 补，规范 §3.1）：`cli.ts` 的 `up --open` 开浏览器——原来直接
   * `import("node:child_process").then(({spawn}) => …)`，是宿主件里最后一处 `node:child_process`。
   * 与 `run` 不同，本方法**不返回结果**（没有可等的东西），失败只以抛错表达，由调用方决定是否降级。
   */
  detach(cmd: string, args: readonly string[]): void;
}
