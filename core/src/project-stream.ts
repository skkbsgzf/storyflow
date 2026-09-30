/**
 * 项目事件流（工单 R5 第 3–4 条）：把 `journal.jsonl` 台账投影成 SSE 项目级事件。
 *
 * 为什么事件源是台账而不是「动词执行时现场发事件」：
 *  · 内核每个节点动作**本来就往 journal 追加**（run-start/advance/submit/gate-open/verdict/stale/rerun…），
 *    再引入一层 in-process 总线就是第二套真相，且跨进程宿主（CLI 起了 run、HTTP 在看）收不到。
 *  · 台账投影天然是「磁盘真相 > 对话记忆」那条铁律的形状：断线重连后从文件继续，不靠内存态。
 *  · `watchDir` 按规范 §五只有弱保证（事件合并/丢失跨平台不一致），所以这里**心跳节拍自己重读**，
 *    watch 只当「提前醒一下」的提示——正确性不依赖它（这条是接口注释里立的规矩，别破）。
 *
 * 词汇表口径：工单点名 `FlowEvent`，盘上的类型名是 `agent.ts::AgentEvent`（见
 * `docs/integration/sse-events.md` 的提醒），这里扩的是那一个联合，不建第二个事件类型。
 */
import type { AgentEvent } from "./agent.js";
import { readJsonl } from "./abstraction/jsonio.js";
import type { Kernel } from "./kernel.js";
import { journalPath } from "./state.js";
import { HEARTBEAT_MIN_MS } from "./sse.js";
import type { JournalEvent, JournalEventKind } from "./types.js";

/** 投影目标：`AgentEvent` 里的四种项目级变体（heartbeat 由 `sse.ts` 管道发，不在这里）。 */
type ProjectedType = "node_start" | "node_complete" | "node_error" | "gate_pending";

/**
 * 台账 kind → 事件类型的**穷举**映射表。`Record<JournalEventKind, …>` 是刻意的：
 * 以后给台账加第 17 种 kind，这里不补就编译不过——「加了没人读」是本仓的事故形态。
 * `null` = 不投影到流上（历史仍可查 `GET /api/v1/projects/:id/journal`），不是遗漏。
 */
export const JOURNAL_TO_SSE: Record<JournalEventKind, ProjectedType | null> = {
  "advance": "node_start",
  // intake/deliver 目前只有类型没有写入点（0.10.0 预留）：按语义先就位，别等它出现时静默不推。
  "intake": "node_start",
  "submit": "node_complete",
  "deliver": "node_complete",
  "gate-open": "gate_pending",
  "reject": "node_error",
  "stale": "node_error",
  // 以下 9 种不投影：run 级与留痕类事件的归属不在「节点/门」词汇表内（run-start/run-end/verdict/
  // rerun/snapshot/note/warn/chain-out/chain-in），要不要进流是词汇表扩容，归 owner 拍板。
  "run-start": null,
  "run-end": null,
  "verdict": null,
  "rerun": null,
  "snapshot": null,
  "note": null,
  "warn": null,
  "chain-out": null,
  "chain-in": null,
};

/** 本面投影出的事件类型全集（文档与 OpenAPI 从这里取，不另抄一份）。 */
export const PROJECT_EVENT_TYPES: readonly ProjectedType[] = ["node_start", "node_complete", "node_error", "gate_pending"];

/** 把一条台账事件折成 SSE 事件；未投影的 kind 返回 null。 */
export function projectJournalEvent(e: JournalEvent): AgentEvent | null {
  const t = JOURNAL_TO_SSE[e.event];
  if (!t) return null;
  const base = { ts: e.ts, nodeId: e.nodeId, ...(e.detail ? { detail: e.detail } : {}) };
  if (t === "node_complete") {
    return { type: t, event: e.event, ...base, ...(e.refs?.length ? { refs: e.refs } : {}) };
  }
  return { type: t, event: e.event, ...base };
}

/** 等待切片：长节拍里也要能尽快响应停止（关流时不该等满一个 10s 心跳周期才取消监听）。 */
const WAKE_SLICE_MS = 200;

/**
 * 台账重读节拍的缺省上限。与心跳**分家**：心跳是保活信号（10s 就够，见 `sse.ts::DEFAULT_HEARTBEAT_MS`），
 * 重读是事件延迟预算（缺省最迟 1s 抵达）。客户端把 heartbeatMs 调得比这还小时按客户端的来——
 * 一个旋钮同时收紧两者，是「订阅者说了算」的方向，不会放大到超出它的值。
 */
export const LEDGER_POLL_DEFAULT_MS = 1_000;

const sleep = (ms: number): Promise<void> => new Promise((res) => setTimeout(res, ms));

/**
 * 项目事件流：从**订阅时刻的台账末尾**开始，只推之后的新事件（断线重连不重放历史，
 * 历史查 `GET /api/v1/projects/:id/journal`）。永不自然结束——由调用方关闭。
 *
 * `beatMs` 是重读对账节拍，下限与心跳同尺（`HEARTBEAT_MIN_MS`）——节拍就是「每拍读一遍整本台账」，
 * 给它 1ms 等于把 journal.jsonl 变成轮询目标；上限不设（调用方自己承担静默期）。
 *
 * `stopSignal` 是给 HTTP 面用的**确定性收尾**：异步生成器只在 yield 点处理 `.return()`，
 * 而本源的静默期卡在 sleep 里根本不到 yield 点——只靠调用方 `return()` 的话，watchDir 永远不会被取消。
 * 所以断开信号由源自己盯：到点即 `return`，`finally` 保证取消监听。
 */
export async function* projectEvents(
  kernel: Kernel,
  projectId: string,
  opts: { beatMs?: number; stopSignal?: Promise<unknown> } = {},
): AsyncGenerator<AgentEvent> {
  const beat = Math.max(HEARTBEAT_MIN_MS, opts.beatMs ?? 1_000);
  const projectDir = kernel.projectDir(projectId);
  const file = journalPath(projectDir, kernel.path);
  const watched = kernel.path.basename(file);
  let dirty = true; // 首拍立刻对齐基线
  let stopped = false;
  if (opts.stopSignal) {
    void Promise.resolve(opts.stopSignal).then(() => {
      stopped = true;
    });
  }
  const cancel = kernel.fs.watchDir(kernel.path.dirname(file), (name) => {
    if (name === watched) dirty = true;
  });
  try {
    // 游标 = 台账行数（追加式文件的精确偏移）；用 ts 做游标会在同毫秒多条事件上要么漏要么重。
    let seen = readJsonl<JournalEvent>(file, kernel.fs).length;
    while (!stopped) {
      for (let waited = 0; waited < beat && !dirty && !stopped; waited += WAKE_SLICE_MS) {
        await sleep(Math.min(WAKE_SLICE_MS, beat - waited));
      }
      if (stopped) return;
      dirty = false;
      const all = readJsonl<JournalEvent>(file, kernel.fs);
      const fresh = all.slice(seen);
      // 台账变短 = 被重写（回滚/清场），重新对齐末尾：中间段确实丢了，但绝不重放旧事件。
      seen = all.length;
      for (const e of fresh) {
        const ev = projectJournalEvent(e);
        if (ev) yield ev;
      }
    }
  } finally {
    cancel();
  }
}
