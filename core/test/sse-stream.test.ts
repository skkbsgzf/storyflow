/**
 * 工单 R5 · 事件流（SSE 通用化 ＋ 项目级事件）—— 回归测试
 *
 * 三条被测命题：
 *   ① **一条管道，两种流**：`emitSseEvents` 是线格式与心跳的唯一出口。心跳必须真的到
 *      （工单门禁：客户端 15s 内收到 heartbeat ⇒ 缺省 10s 由常量断言，帧的到达由 60ms 节拍实测）。
 *   ② **投影不丢溯源、不静默漏 kind**：`JOURNAL_TO_SSE` 对 16 种台账 kind 逐条表态。
 *      tsconfig 的 `include:["src"]` 让测试**不参与类型检查**，所以 `Record<JournalEventKind,…>`
 *      的穷举保证只在 `tsc --noEmit` 里生效；这里再钉一遍运行时名单，防「加了 kind 没人管」漏到运行时。
 *   ③ **断开必须收尾**：客户端走掉 ⇒ 泵停止写帧 ⇒ 事件源接同一把信号自己 return ⇒ `watchDir`
 *      的取消函数被调用。监听器不取消就是每断一次泄漏一个 fs.watch 句柄（长驻 HTTP 面的隐形债）。
 *      断开信号挂 `reply.raw` 而非 `req.raw`：Node 在请求体读完时就给 IncomingMessage 发 `close`，
 *      实测 POST 回合用它会「刚连上就断开」——只有 `open` 帧抵达对端（turn 那条用例就是这条的回归锁）。
 *
 * 时序口径：正确性不依赖 fs.watch 的到达时间（规范-FS抽象层-FS1 §五），断言全部走
 * 「节拍重读」这条独立线；watch 只用于提前唤醒，测试不许等它。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { nodeFs } from "../src/abstraction/adapters/node.js";
import { Kernel } from "../src/kernel.js";
import { journalAppend } from "../src/journal.js";
import { buildHttpApp } from "../src/http.js";
import {
  DEFAULT_HEARTBEAT_MS,
  HEARTBEAT_MAX_MS,
  HEARTBEAT_MIN_MS,
  emitSseEvents,
  heartbeatMsOf,
  type SseEvent,
} from "../src/sse.js";
import { JOURNAL_TO_SSE, PROJECT_EVENT_TYPES, projectEvents, projectJournalEvent } from "../src/project-stream.js";
import type { JournalEvent, JournalEventKind } from "../src/types.js";

/** 台账 kind 全集（与 `types.ts::JournalEventKind` 同步的第二份肉眼名单——理由见文件头②）。 */
const JOURNAL_KINDS: JournalEventKind[] = [
  "run-start", "advance", "submit", "reject", "gate-open", "verdict", "rerun", "stale",
  "snapshot", "intake", "deliver", "run-end", "note", "warn", "chain-out", "chain-in",
];

const AGENT_ENV = ["MINIFLOW_AGENT_BASE_URL", "MINIFLOW_AGENT_MODEL", "MINIFLOW_AGENT_KEY"];

const tmpRoot = (prefix = "miniflow-sse-"): string => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const sleep = (ms: number): Promise<void> => new Promise((res) => setTimeout(res, ms));

/** 记 watch/cancel 次数的 fs 替身：其余方法沿用 Node 适配器（不重写语义）。 */
function spyFs(counters: { watch: number; cancel: number }): typeof nodeFs {
  return Object.create(nodeFs, {
    watchDir: {
      value: (dir: string, cb: (name: string) => void) => {
        counters.watch++;
        const cancel = nodeFs.watchDir(dir, cb);
        return () => {
          counters.cancel++;
          cancel();
        };
      },
    },
  });
}

/**
 * 后台把事件源抽进缓冲，测试按需取。
 * 为什么不能「按需 next()」：异步生成器不许并发 next()，而超时那一刻在途的 next() 若刚好解析，
 * 它的值随无人认领的 promise 蒸发——实测丢过一帧（`[gate_pending]` 少了前置的 `node_complete`）。
 * 先入缓冲再取，超时就不可能吞事件。
 */
function collector(it: AsyncIterator<SseEvent>) {
  const buf: SseEvent[] = [];
  let ended = false;
  const pull = (): void => {
    if (ended) return;
    void it.next().then((r) => {
      if (r.done || !r.value) {
        ended = true;
        return;
      }
      buf.push(r.value as SseEvent);
      pull();
    });
  };
  pull();
  return {
    /** 取最多 n 帧；到点不足 n 就返回已有的（源不自然结束，必须主动收）。 */
    async take(n: number, deadlineMs = 4_000): Promise<SseEvent[]> {
      const until = Date.now() + deadlineMs;
      while (buf.length < n && !ended && Date.now() < until) {
        await sleep(Math.min(20, Math.max(1, until - Date.now())));
      }
      return buf.splice(0, n);
    },
    /** 源自己结束（含 stopSignal 生效）——监视器取消只在这之后才成立。 */
    async untilEnd(deadlineMs = 2_000): Promise<void> {
      const until = Date.now() + deadlineMs;
      while (!ended && Date.now() < until) await sleep(20);
      expect(ended).toBe(true);
    },
    raw: it,
  };
}

/** 逐帧读到命中谓词为止；心跳随时可能插在中间，所以「下一帧是 X」这种断言不许用。 */
async function readUntil(frames: AsyncGenerator<SseEvent>, pred: (e: SseEvent) => boolean, cap = 60): Promise<SseEvent[]> {
  const seen: SseEvent[] = [];
  for (;;) {
    const { value, done } = await frames.next();
    if (done || !value) return seen;
    seen.push(value);
    if (pred(value) || seen.length >= cap) return seen;
  }
}

/** 把响应体切成 JSON 帧序列（`data: [DONE]` 记为流结束）。 */
async function* readFrames(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const frame = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const line = frame.split("\n").find((l) => l.startsWith("data: "));
        if (!line) continue;
        const payload = line.slice(6);
        if (payload === "[DONE]") return;
        yield JSON.parse(payload) as SseEvent;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

describe("R5 · SSE 管道（emitSseEvents）", () => {
  it("线格式：open 先于事件，逐帧 data: JSON，[DONE] 收口", async () => {
    const chunks: string[] = [];
    async function* src(): AsyncGenerator<SseEvent> {
      yield { type: "delta", text: "甲" };
      yield { type: "done", text: "乙" };
    }
    await emitSseEvents({ write: (t: string) => chunks.push(t) }, src(), { open: { type: "open", sid: "s1" } });
    expect(chunks).toEqual([
      'data: {"type":"open","sid":"s1"}\n\n',
      'data: {"type":"delta","text":"甲"}\n\n',
      'data: {"type":"done","text":"乙"}\n\n',
      "data: [DONE]\n\n",
    ]);
  });

  it("空闲补心跳：源静默期间真有 heartbeat 帧到（缺省 10s ≤ 15s 门禁由常量钉，到达由 30ms 节拍实测）", async () => {
    expect(DEFAULT_HEARTBEAT_MS).toBeLessThanOrEqual(15_000);
    const chunks: string[] = [];
    async function* slow(): AsyncGenerator<SseEvent> {
      await sleep(220);
      yield { type: "done", text: "算完了" };
    }
    const at = Date.now();
    await emitSseEvents({ write: (t: string) => chunks.push(t) }, slow(), { heartbeatMs: 30 });
    const frames = chunks
      .filter((c) => c !== "data: [DONE]\n\n")
      .map((c) => JSON.parse(c.slice(6, -2)) as SseEvent);
    expect(frames.filter((f) => f.type === "heartbeat").length).toBeGreaterThan(0);
    expect(frames.at(-1)).toMatchObject({ type: "done" });
    expect(chunks.at(-1)).toBe("data: [DONE]\n\n");
    expect(Date.now() - at).toBeLessThan(15_000);
  });

  it("heartbeatMs 钳制在可调区间（客户端参数是边界，不交给内核猜）", () => {
    expect(heartbeatMsOf(undefined)).toBe(DEFAULT_HEARTBEAT_MS);
    expect(heartbeatMsOf("")).toBe(DEFAULT_HEARTBEAT_MS);
    expect(heartbeatMsOf("abc")).toBe(DEFAULT_HEARTBEAT_MS);
    expect(heartbeatMsOf("0")).toBe(DEFAULT_HEARTBEAT_MS);
    expect(heartbeatMsOf("1")).toBe(HEARTBEAT_MIN_MS);
    expect(heartbeatMsOf(9_999_999)).toBe(HEARTBEAT_MAX_MS);
    expect(heartbeatMsOf("800")).toBe(800);
  });

  it("closeSignal 到点即停流：不写收口帧、之后一帧也不写；源的收尾靠源自己接同一把信号", async () => {
    const chunks: string[] = [];
    let closed = false;
    // 与 project-stream.ts 同构的源：拿同一个信号自己 return，finally 里释放句柄。
    // 只靠泵 `it.return()` 不够——异步生成器只在 yield 点处理关闭请求，卡在 await 里就永不落地。
    async function* paced(signal: Promise<unknown>): AsyncGenerator<SseEvent> {
      let stopped = false;
      void Promise.resolve(signal).then(() => {
        stopped = true;
      });
      try {
        for (;;) {
          await sleep(10);
          if (stopped) return;
          yield { type: "tick" };
        }
      } finally {
        closed = true;
      }
    }
    let fireClose!: () => void;
    const closeSignal = new Promise<void>((res) => {
      fireClose = res;
    });
    const p = emitSseEvents({ write: (t: string) => chunks.push(t) }, paced(closeSignal), { heartbeatMs: 10, closeSignal });
    setTimeout(fireClose, 60);
    await p;
    const settled = chunks.length;
    await sleep(80); // 泵若没真停，这几拍一定会再写帧
    expect(chunks.length).toBe(settled);
    expect(chunks.at(-1)).not.toBe("data: [DONE]\n\n"); // 对端已走，收口帧不写
    expect(closed).toBe(true);
  });
});

describe("R5 · 台账投影（journal → 项目级事件）", () => {
  it("JOURNAL_TO_SSE 对每一种台账 kind 都逐条表态（投影 or 显式 null，不许查无）", () => {
    expect(Object.keys(JOURNAL_TO_SSE).sort()).toEqual([...JOURNAL_KINDS].sort());
    expect([...new Set(Object.values(JOURNAL_TO_SSE).filter(Boolean))].sort()).toEqual([...PROJECT_EVENT_TYPES].sort());
    // 未投影的 kind 是「不推流、查 GET journal」，不是漏：名单在这里钉死
    expect(Object.entries(JOURNAL_TO_SSE).filter(([, v]) => v === null).map(([k]) => k).sort()).toEqual([
      "chain-in", "chain-out", "note", "rerun", "run-end", "run-start", "snapshot", "verdict", "warn",
    ]);
  });

  it("投影保留台账原 kind 与 refs（事件不许变成第二套真相）", () => {
    const e: JournalEvent = {
      ts: "2026-09-30T10:00:00.000Z", runId: "r1", event: "submit", actor: "kernel",
      nodeId: "m2.plan", detail: "稿本/计划.md", refs: ["稿本/计划.md"],
    };
    expect(projectJournalEvent(e)).toEqual({
      type: "node_complete", event: "submit", ts: e.ts, nodeId: "m2.plan", detail: "稿本/计划.md", refs: ["稿本/计划.md"],
    });
    expect(projectJournalEvent({ ...e, event: "note" })).toBeNull();
    expect(projectJournalEvent({ ...e, event: "gate-open" })).toMatchObject({ type: "gate_pending", nodeId: "m2.plan" });
    expect(projectJournalEvent({ ...e, event: "stale" })).toMatchObject({ type: "node_error", event: "stale" });
    // 无节点归属的台账条目不编造 nodeId：缺席＝项目级
    const { nodeId: _drop, ...noNode } = e;
    const projected = projectJournalEvent(noNode as JournalEvent);
    expect(projected).toMatchObject({ type: "node_complete" });
    expect(projected?.nodeId).toBeUndefined();
  });
});

describe("R5 · 项目事件流（真盘 ＋ watch 取消计数）", () => {
  function seeded(pid: string): { root: string; pid: string; projectDir: string } {
    const root = tmpRoot("miniflow-sse-fs-");
    const projectDir = path.join(root, "projects", pid);
    fs.mkdirSync(projectDir, { recursive: true });
    return { root, pid, projectDir };
  }

  it("订阅点之前的历史不重放；新台账按节拍推达；停流即取消监听", async () => {
    const { root, pid, projectDir } = seeded("p-sse");
    const counters = { watch: 0, cancel: 0 };
    const kernel = new Kernel({ root, fs: spyFs(counters) });
    journalAppend(kernel, projectDir, "r1", "advance", { nodeId: "m1.topic", detail: "订阅前的一条历史" });

    let stop!: () => void;
    const stopSignal = new Promise<void>((res) => {
      stop = res;
    });
    const stream = collector(projectEvents(kernel, pid, { beatMs: 60, stopSignal }));
    expect(await stream.take(1, 250)).toEqual([]); // 基线对齐末尾：历史不重放

    journalAppend(kernel, projectDir, "r1", "submit", { nodeId: "m1.topic", detail: "选题报告.md", refs: ["选题报告.md"] });
    journalAppend(kernel, projectDir, "r1", "gate-open", { nodeId: "m2.plan", detail: "计划验收" });
    journalAppend(kernel, projectDir, "r1", "note", { detail: "不投影的留痕" });
    const got = await stream.take(2);
    expect(got.map((e) => e.type)).toEqual(["node_complete", "gate_pending"]);
    expect(got[0]).toMatchObject({ event: "submit", nodeId: "m1.topic", refs: ["选题报告.md"] });
    expect(got[1]).toMatchObject({ event: "gate-open", nodeId: "m2.plan" });

    // 取消走 stopSignal 这条线（与 api-v1 的断开信号同构）：it.return() 只在 yield 点被处理，
    // 源正卡在节拍 sleep 时递进去的关闭请求不会立刻落地——见 sse.ts::emitSseEvents 的 finally 注释。
    stop();
    await stream.untilEnd();
    expect(counters.watch).toBe(1);
    expect(counters.cancel).toBe(1);
  });

  it("台账被整本重写（回滚/清场）：重新对齐，旧事件不复活，新事件照推", async () => {
    const { pid, projectDir } = seeded("p-sse-rewrite");
    const kernel = new Kernel({ root: path.dirname(path.dirname(projectDir)) });
    const file = path.join(projectDir, "journal.jsonl");
    journalAppend(kernel, projectDir, "r1", "advance", { nodeId: "m1" });
    let stop!: () => void;
    const stopSignal = new Promise<void>((res) => {
      stop = res;
    });
    const stream = collector(projectEvents(kernel, pid, { beatMs: 60, stopSignal }));
    expect(await stream.take(1, 250)).toEqual([]);

    journalAppend(kernel, projectDir, "r1", "submit", { nodeId: "m1" });
    expect((await stream.take(1)).map((e) => e.type)).toEqual(["node_complete"]); // 流活着

    fs.writeFileSync(file, "", "utf-8"); // 回滚式清空
    await sleep(200); // 让一拍完成重新对齐
    journalAppend(kernel, projectDir, "r1", "gate-open", { nodeId: "m2" });
    expect((await stream.take(1)).map((e) => e.type)).toEqual(["gate_pending"]); // 只有清空之后那条
    stop();
    await stream.untilEnd();
  });
});

describe("R5 · GET /api/v1/projects/:id/stream 与 turn 迁管道（真握手）", () => {
  const saved = AGENT_ENV.map((k) => [k, process.env[k]] as const);
  afterAll(() => {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  async function live(kernel: Kernel) {
    const app = buildHttpApp(kernel);
    await app.listen({ port: 0, host: "127.0.0.1" });
    return { app, base: `http://127.0.0.1:${(app.server.address() as { port: number }).port}` };
  }

  it("缺项目＝流开始前的错误仍走 v1 信封；有项目＝open 帧＋投影事件＋心跳，断开后服务端取消监听", async () => {
    for (const k of AGENT_ENV) delete process.env[k];
    const root = tmpRoot("miniflow-sse-http-");
    const pid = "p-sse-http";
    const projectDir = path.join(root, "projects", pid);
    fs.mkdirSync(projectDir, { recursive: true });
    const counters = { watch: 0, cancel: 0 };
    const kernel = new Kernel({ root, repoRoot: root, fs: spyFs(counters) });
    const { app, base } = await live(kernel);

    const miss = await fetch(`${base}/api/v1/projects/nope/stream`);
    expect(miss.status).toBe(404);
    expect(miss.headers.get("content-type")).toContain("application/json");
    expect(await miss.json()).toMatchObject({
      ok: false,
      error: { code: "NO_PROJECT" },
      meta: { apiVersion: "v1", route: "/api/v1/projects/:id/stream" },
    });

    const ac = new AbortController();
    const resp = await fetch(`${base}/api/v1/projects/${pid}/stream?heartbeatMs=60`, { signal: ac.signal });
    expect(resp.status).toBe(200);
    expect(resp.headers.get("content-type")).toContain("text/event-stream");
    const frames = readFrames(resp.body!);

    const open = await frames.next();
    expect(open.value).toMatchObject({ type: "open", projectId: pid, apiVersion: "v1", heartbeatMs: 60 });
    expect(open.value?.projected).toEqual([...PROJECT_EVENT_TYPES]);

    journalAppend(kernel, projectDir, "r1", "advance", { nodeId: "m1.topic" });
    const tillStart = await readUntil(frames, (e) => e.type === "node_start");
    expect(tillStart.find((e) => e.type === "node_start")).toMatchObject({ event: "advance", nodeId: "m1.topic" });

    const tillBeat = await readUntil(frames, (e) => e.type === "heartbeat");
    expect(tillBeat.at(-1)?.type).toBe("heartbeat"); // 静默期必有心跳帧抵达（客户端据此判活）

    ac.abort();
    await frames.return(undefined).catch(() => undefined);
    await sleep(300); // 取消要落到 watchDir 的清理，等一拍
    expect(counters.watch).toBe(1);
    expect(counters.cancel).toBe(1);
    await app.close();
  }, 20_000);

  it("turn 迁到统一管道后线格式不变：open 帧在前、[DONE] 收口，无模型配置时只补一帧 error", async () => {
    for (const k of AGENT_ENV) delete process.env[k];
    const root = tmpRoot("miniflow-turn-");
    const pid = "p-turn";
    fs.mkdirSync(path.join(root, "projects", pid), { recursive: true });
    const kernel = new Kernel({ root, repoRoot: root }); // repoRoot=temp：不读真仓 .external/，也不打真模型
    const { app, base } = await live(kernel);

    const resp = await fetch(`${base}/api/projects/${pid}/agent/sessions/s-1/turn?heartbeatMs=20`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "你好" }),
    });
    expect(resp.status).toBe(200);
    expect(resp.headers.get("content-type")).toContain("text/event-stream");
    const all: SseEvent[] = [];
    const frames = readFrames(resp.body!);
    for (;;) {
      const { value, done } = await frames.next();
      if (done || !value) break;
      all.push(value);
    }
    expect(all[0]).toMatchObject({ type: "open", sid: "s-1" });
    expect(all.at(-1)).toMatchObject({ type: "error", message: expect.stringContaining("agent 模型") });
    await app.close();
  }, 20_000);
});
