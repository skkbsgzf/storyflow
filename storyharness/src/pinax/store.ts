// 任务状态仓：运行态落盘（Issue #3 的 task state / cancellation / recovery）。
// 形态沿底座纪律：JSONL 追加 + 末行快照，坏行跳过不炸整读。
import * as fs from "node:fs";
import path from "node:path";

export type TaskStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

// The HTTP identity and journal filename must use the same, collision-free spelling.
// "list" is reserved by the task collection endpoint.
export function isValidTaskId(value: unknown): value is string {
  return typeof value === "string" && value !== "list" && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(value);
}

export interface TaskSnapshot {
  taskId: string;
  requestId: string;
  status: TaskStatus;
  createdAt: number;
  updatedAt: number;
  mode: string;
  /** 任务种类（assistant/narrative/capability）；capability 为一次性提交语义 */
  taskKind?: string;
  /** 作品归属（PR #4 审阅②）：任务创建时固定的归属锚（面板传当前作品绑定 id）；缺省 = 未归属（历史任务） */
  bookId?: string;
  steps: number;
  toolCalls: number;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  /** pi-agent 转录（AgentMessage[]），恢复时重放 */
  messages: unknown[];
  finalText: string;
  /** BeatPlan 规划轮（②）：本回合受理的节拍计划（含 revision）；continue 模式或未提交时缺省 */
  beatPlan?: Record<string, unknown> | null;
  /** 能力任务（taskKind=capability）：submit 工具回执（结构化结果，语义校验在 Pinax 服务端） */
  capabilityResult?: Record<string, unknown> | null;
  error?: { code: string; message: string; retryable?: boolean };
}

export class TaskStore {
  private readonly dir: string;

  constructor(tasksDir: string) {
    this.dir = tasksDir;
    fs.mkdirSync(this.dir, { recursive: true });
  }

  private fileFor(taskId: string): string {
    if (!isValidTaskId(taskId)) throw new Error("PINAX_ADAPTER_INVALID_TASK_ID");
    return path.join(this.dir, `task-${taskId}.jsonl`);
  }

  has(taskId: string): boolean {
    return fs.existsSync(this.fileFor(taskId));
  }

  append(snapshot: TaskSnapshot): void {
    const line = JSON.stringify({ ...snapshot, updatedAt: Date.now() }) + "\n";
    fs.appendFileSync(this.fileFor(snapshot.taskId), line, "utf-8");
  }

  load(taskId: string): TaskSnapshot | undefined {
    const f = this.fileFor(taskId);
    if (!fs.existsSync(f)) return undefined;
    let last: TaskSnapshot | undefined;
    for (const raw of fs.readFileSync(f, "utf-8").split(/\r?\n/)) {
      if (!raw.trim()) continue;
      try {
        const candidate = JSON.parse(raw);
        if (candidate && typeof candidate === "object" && candidate.taskId === taskId) last = candidate;
      } catch { /* 坏行跳过（一行坏不炸整读） */ }
    }
    return last;
  }

  list(limit = 50, { bookId }: { bookId?: string } = {}): { taskId: string; status: TaskStatus; updatedAt: number; bookId?: string }[] {
    const out: { taskId: string; status: TaskStatus; updatedAt: number; bookId?: string }[] = [];
    for (const name of fs.readdirSync(this.dir)) {
      const m = /^task-(.+)\.jsonl$/.exec(name);
      if (!m || !isValidTaskId(m[1])) continue;
      const snap = this.load(m[1]);
      // Filter before the limit: activity in other books must not displace this book's sessions.
      if (snap && (bookId === undefined || snap.bookId === bookId)) {
        out.push({ taskId: snap.taskId, status: snap.status, updatedAt: snap.updatedAt, ...(snap.bookId ? { bookId: snap.bookId } : {}) });
      }
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
  }
}

export function newTaskId(): string {
  return `ptask_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
