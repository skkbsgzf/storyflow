/**
 * SSE 统一出口（工单 R5 第 4–5 条）：内核所有 `text/event-stream` 面共用这一个写帧器。
 *
 * 为什么值得单独一层（不是在每个端点里各写一遍 `data: ...`）：
 *  · **线格式只有一处**：`data:` 单字段帧 + `[DONE]` 收口是 `docs/integration/sse-events.md` 承诺的契约，
 *    抄两份就会漂移（三面同源的老规矩）。
 *  · **心跳必须和管道在一起**：长回合（LLM 工具环、等人裁决门）会静默几十秒，本机隧道/反代按空闲断流，
 *    客户端分不清「在算」和「已死」。把心跳放在唯一的出口上，两条流都白拿。
 *  · **断开必须能收尾**：客户端走掉时源（可能挂着 watchDir 句柄）要被关闭，否则每断一次泄漏一个监听器。
 *    所以这里收 `closeSignal`，并在 finally 里 `it.return()`。
 */

/** 帧负载：只要求带 `type`，其余字段由事件字典决定（见 `docs/integration/sse-events.md`）。 */
export type SseEvent = { type: string } & Record<string, unknown>;

/** 最小写出面：Node 的 `reply.raw` 与测试里的字符串收集器都满足它。 */
export interface SseSink {
  write(text: string): unknown;
}

/**
 * 缺省空闲补帧间隔。工单 R5 的门禁是「客户端 15s 内收到 heartbeat」，
 * 缺省 10s 留了 1/3 余量给网络与调度抖动——改这个值就是改门禁，别只改代码。
 */
export const DEFAULT_HEARTBEAT_MS = 10_000;
/** 心跳间隔的可调区间（下限防轮询打爆内核，上限防空闲断流先于心跳到来）。 */
export const HEARTBEAT_MIN_MS = 50;
export const HEARTBEAT_MAX_MS = 30_000;

/** 客户端可请求心跳间隔，但它来自查询参数——钳制是边界校验，不是猜测兜底。 */
export function heartbeatMsOf(raw: string | number | undefined): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_HEARTBEAT_MS;
  return Math.min(HEARTBEAT_MAX_MS, Math.max(HEARTBEAT_MIN_MS, Math.floor(n)));
}

/** 一帧的形状：只用 `data:`，事件类型在 JSON 的 `type` 里（没有 `event:` 字段）。 */
export function sseFrame(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

export const SSE_FRAME_DONE = "data: [DONE]\n\n";

export interface SseOptions {
  /** 空闲多久补一帧 heartbeat；`0` = 不发心跳（给已在别处保活的调用方留的口）。 */
  heartbeatMs?: number;
  /** 连上先写的一帧（缺省不写）。 */
  open?: unknown;
  /** 正常收尾帧；`false` = 不写（由调用方自己收口）。 */
  terminator?: string | false;
  /**
   * 客户端断开信号：resolve 即停流、不写收口帧。
   * 注意这里只**递进**关闭请求，不等源收尾（见 `emitSseEvents` 的 finally 注释）：
   * 需要确定性释放句柄的源（挂着 watchDir 的项目流）要自己接同一把信号，见 `project-stream.ts::stopSignal`。
   */
  closeSignal?: Promise<unknown>;
}

type NextResult = { done: true } | { done: false; value: SseEvent };

/**
 * 客户端断开信号：挂在**响应**上，不是请求上。
 * Node 的 `IncomingMessage` 在请求体读完时就发 `close`——POST 回合用它会「刚连上就断开」，
 * 实测只有 `open` 帧抵达对端。`ServerResponse` 的 `close` 才是「对端真的走了」；正常收口时它也只
 * 在 flush 之后到来（那时泵已经结束），多 resolve 一次无副作用。
 */
export function closeSignalOf(res: { once(event: "close", listener: () => void): unknown }): Promise<void> {
  return new Promise<void>((done) => {
    res.once("close", () => done());
  });
}

/**
 * 把异步事件源逐帧推到 sink 上：`open` → 事件 ……（空闲补 heartbeat）→ `[DONE]`。
 * 源抛错不在这里吞：让调用方决定是补一帧 error 还是直接结束（HTTP 面上头早已发出，只能补帧）。
 */
export async function emitSseEvents(
  sink: SseSink,
  source: AsyncIterable<unknown>,
  opts: SseOptions = {},
): Promise<void> {
  const beat = opts.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  if (opts.open !== undefined) sink.write(sseFrame(opts.open));
  const it = source[Symbol.asyncIterator]();
  let timer: ReturnType<typeof setTimeout> | undefined;
  // 收口帧只在「源自己结束」时写：closeSignal 那条路对端已经走了，写了也没人读。
  // 用 break 而不是 return——`return` 会跳过 try/finally 之后的写帧（第一版就在这儿把 [DONE] 吞了）。
  let outcome: "end" | "close" = "end";
  try {
    // 只挂一个 pending next：心跳到点时复用同一个 promise，绝不并发调 next（那会丢事件）。
    let pending: Promise<NextResult> = it.next() as Promise<NextResult>;
    for (;;) {
      const evP = pending.then((r) => ({ kind: "ev" as const, r }));
      const idle = beat > 0 && beat < Infinity;
      let raced: { kind: "ev"; r: NextResult } | { kind: "tick" } | { kind: "close" };
      if (idle) {
        const tickP = new Promise<{ kind: "tick" }>((res) => {
          timer = setTimeout(() => res({ kind: "tick" }), beat);
        });
        const closeP = opts.closeSignal ? opts.closeSignal.then(() => ({ kind: "close" as const })) : undefined;
        raced = await Promise.race(closeP ? [evP, tickP, closeP] : [evP, tickP]);
      } else {
        raced = opts.closeSignal
          ? await Promise.race([evP, opts.closeSignal.then(() => ({ kind: "close" as const }))])
          : await evP;
      }
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      if (raced.kind === "close") {
        outcome = "close";
        break;
      }
      if (raced.kind === "tick") {
        sink.write(sseFrame({ type: "heartbeat", ts: new Date().toISOString() }));
        continue;
      }
      if (raced.r.done) break;
      sink.write(sseFrame(raced.r.value));
      pending = it.next() as Promise<NextResult>;
    }
  } finally {
    if (timer) clearTimeout(timer);
    // **不等**源的收尾：异步生成器只在 yield 点处理 .return()，卡在长 await（LLM 请求、节拍 sleep）里
    // 的源会让这个 await 永挂，把整条 HTTP 连接钉死。要确定性释放句柄的源自己接 stopSignal
    // （`project-stream.ts` 就靠它取消 watchDir），这里只把关闭请求递进去。
    void it.return?.(undefined)?.catch?.(() => undefined);
  }
  if (outcome === "end") {
    const term = opts.terminator ?? SSE_FRAME_DONE;
    if (term !== false) sink.write(term);
  }
}
