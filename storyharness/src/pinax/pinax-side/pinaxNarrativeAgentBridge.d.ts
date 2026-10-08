// 接入件类型面（实现为 JS，供 TS 侧消费；Pinax 本体是 JS，此文件只服务类型检查）
export interface BridgeBudget {
  agentTimeoutMs?: number;
  maxModelSteps?: number;
  maxCallsPerTurn?: number;
  maxItemsPerDomain?: number;
}

export type BridgeTerminalStatus = "completed" | "failed" | "cancelled";

export interface BridgeStatus {
  phase: "step" | "tool";
  tool?: string;
  action?: string;
  stepIndex?: number;
  toolChoice?: string;
}

export interface BridgeTaskEvent {
  taskId?: string;
  bookId?: string;
  status?: "running" | BridgeTerminalStatus;
  [key: string]: unknown;
}

export interface BridgeCallbacks {
  onReasoning?: (chunk: { content: string }) => void;
  onBeatPlan?: (plan: Record<string, unknown> | null) => void;
  onToolResult?: (result: Record<string, unknown>) => void;
  onChunk?: (chunk: { content: string }) => void;
  /** 只在确认 completed 且无 error 时调用；部分生成或取消不算完成。 */
  onComplete?: (result: { content: string }) => void;
  onTask?: (data: BridgeTaskEvent, eventName: "task.started" | "task.completed" | "task.failed") => void;
  /** 与顶层 onStatus 同时传入时均会通知；同一函数只调用一次。 */
  onStatus?: ((status: BridgeStatus) => void) | null;
}

export interface BridgeRunArgs {
  kernel: any;
  index: any;
  registry?: { revision?: string } | null;
  taskKind?: "assistant" | "narrative";
  mode?: "init" | "continue" | "auto" | "respond";
  intent?: string | null;
  formatInstructions?: string;
  requestId?: string;
  /** 真实作品 ID，独立于关联的世界书 ID。 */
  bookId?: string | null;
  signal?: AbortSignal | null;
  callbacks?: BridgeCallbacks;
  onStatus?: ((status: BridgeStatus) => void) | null;
  budget?: BridgeBudget | null;
  taskId?: string | null;
}

export interface BridgeRunResult {
  ok: boolean;
  finalContent: string;
  beatPlan?: Record<string, unknown> | null;
  provider: string;
  model: string;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  toolRounds: number;
  totalCalls: number;
  error?: { code?: string; message?: string; retryable?: boolean };
  trace: {
    engine: string;
    taskId: string | null;
    status: BridgeTerminalStatus;
    bookId?: string;
    resumed?: boolean;
    steps?: number;
    toolRounds?: number;
    calls?: { name: string; action?: string }[];
    [key: string]: any;
  };
  finalToolResults: unknown[];
}

export interface BridgeResumeArgs {
  taskId: string;
  taskKind?: "assistant" | "narrative";
  formatInstructions?: string;
  kernel: any;
  index: any;
  intent?: string | null;
  /** 必须与已存任务归属一致；缺省时由服务端使用原归属。 */
  bookId?: string | null;
  callbacks?: BridgeCallbacks;
  onStatus?: ((status: BridgeStatus) => void) | null;
  signal?: AbortSignal | null;
  requestId?: string;
}

export interface BridgeCancelResult {
  ok: true;
  stopped: true;
  taskId: string;
  status: BridgeTerminalStatus;
  /** 只有服务端确认 status=cancelled 才为 true；自然完成/失败为 false。 */
  cancelled: boolean;
  [key: string]: unknown;
}

export interface PinaxNarrativeAgentBridge {
  tasks(bookId?: string): Promise<{ tasks: unknown[] }>;
  healthz(options?: { signal?: AbortSignal | null; timeoutMs?: number }): Promise<Record<string, unknown> | null>;
  run(args: BridgeRunArgs): Promise<BridgeRunResult>;
  status(taskId: string): Promise<Record<string, unknown> | null>;
  /** HTTP/网络/未确认终态时 reject；不会以 null 隐藏失败。 */
  cancel(taskId: string, options?: { signal?: AbortSignal | null }): Promise<BridgeCancelResult>;
  resume(args: BridgeResumeArgs): Promise<BridgeRunResult>;
}

export declare function createPiNarrativeAgentBridge(options?: {
  endpoint?: string;
  fetchImpl?: typeof globalThis.fetch;
  parseEvent?: ((raw: string) => Record<string, unknown> | null) | null;
}): PinaxNarrativeAgentBridge;

export declare function buildResourceSnapshot(
  index: any,
  options?: { maxItemsPerDomain?: number },
): { revision: string; currentPlaceId: string; domains: Record<string, Record<string, unknown>[]> };

export declare function buildKernelPayload(kernel: any): { revision: string; blocks: { kind: string; title: string; text: string }[] };
