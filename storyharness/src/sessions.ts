// 会话落盘（dsh session 模型做减法：纯 JSONL 按项目分桶，无压缩无依赖）。
//   位置：<projectDir>/<corpus.sessionsDir>/<sid>.jsonl，首行 session_start 携带元数据。
//   事件形状：{ts, kind, ...}；kind ∈ session_start | message | tool_call | tool_result
//             | turn_end | run_event | session_end
//   B9（2026-09-28）：message 事件带 provider 逐条 usage（input/output/cache*/cost），
//   run_event(chat_turn_end) 带本回合用量 + 会话累计 + 上下文占用读数——
//   「指标面」的三个数字（context 占用／本轮 cost／累计 cost）全部由这两类行重放，UI 不自算一套。
//   纪律：会话流只进 内部/sessions/ 与前端（铁律 9 正文纯净）——绝不进产物正文。
//   结果体上限 16KB（与内核工具环截断同口径），超限存截断标记。
import fs from "node:fs";
import path from "node:path";
import type { CorpusLayout } from "./config.js";

const RESULT_CAP = 16 * 1024;

/** provider 回报的逐条用量（B9）。形状取自 pi-ai 的 Usage，只留指标面要读的键；
 *  cost 由 pi 按 model.cost 价率算好——自定义端点价率为 0 时 cost 全 0（如实记账，不编数）。 */
export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning?: number;
  totalTokens: number;
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
}

/** 任意来源（pi Usage / 旧会话 JSONL 的残缺 usage）归一为 TokenUsage；无可用数字返回 undefined。 */
export function normUsage(u: unknown): TokenUsage | undefined {
  if (!u || typeof u !== "object") return undefined;
  const s = u as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const c = (s.cost && typeof s.cost === "object" ? s.cost : {}) as Record<string, unknown>;
  const out: TokenUsage = {
    input: num(s.input), output: num(s.output),
    cacheRead: num(s.cacheRead), cacheWrite: num(s.cacheWrite),
    totalTokens: num(s.totalTokens),
    cost: {
      input: num(c.input), output: num(c.output),
      cacheRead: num(c.cacheRead), cacheWrite: num(c.cacheWrite),
      total: num(c.total),
    },
  };
  if (typeof s.reasoning === "number" && Number.isFinite(s.reasoning)) out.reasoning = s.reasoning;
  // 全零且无 totalTokens = 该 provider 不回报用量（老会话/纯工具回合）——按「查无」处理，不写空对象占位
  if (!out.input && !out.output && !out.totalTokens && !out.cost.total) return undefined;
  return out;
}

const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
export const zeroUsage = (): TokenUsage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { ...ZERO_COST } });

/** 用量累加（逐条 → 本轮 → 会话累计的唯一口径；cost 逐键相加，不再乘价率）。 */
export function addUsage(a: TokenUsage, b: TokenUsage | undefined): TokenUsage {
  if (!b) return a;
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    reasoning: a.reasoning !== undefined || b.reasoning !== undefined ? (a.reasoning ?? 0) + (b.reasoning ?? 0) : undefined,
    totalTokens: a.totalTokens + b.totalTokens,
    cost: {
      input: a.cost.input + b.cost.input,
      output: a.cost.output + b.cost.output,
      cacheRead: a.cost.cacheRead + b.cost.cacheRead,
      cacheWrite: a.cost.cacheWrite + b.cost.cacheWrite,
      total: a.cost.total + b.cost.total,
    },
  };
}

/** 上下文占用 token（与 pi 的 calculateContextTokens 同口径：provider 总用量即「进上下文的量」）。 */
export function contextTokensOf(u: TokenUsage): number {
  return u.totalTokens || u.input + u.output + u.cacheRead + u.cacheWrite;
}

export interface SessionMeta {
  project: string;
  mode: "executor" | "chat" | "headless";
  node?: string;
  flow?: string;
  model?: string;
  title?: string;
}

export type SessionEvent =
  | { kind: "session_start"; meta: SessionMeta }
  | { kind: "message"; role: string; content: unknown; usage?: TokenUsage }
  | { kind: "tool_call"; toolCallId: string; toolName: string; args: unknown }
  | { kind: "tool_result"; toolCallId: string; toolName: string; isError: boolean; result: string }
  | { kind: "turn_end" }
  | { kind: "run_event"; event: Record<string, unknown> }
  | { kind: "session_end"; reason: string };

const dirOf = (projectDir: string, corpus: CorpusLayout) => path.join(projectDir, corpus.sessionsDir);
const fileOf = (projectDir: string, corpus: CorpusLayout, sid: string) =>
  path.join(dirOf(projectDir, corpus), `${sid.replace(/[^\w.-]/g, "_")}.jsonl`);

const line = (event: SessionEvent) => JSON.stringify({ ts: new Date().toISOString(), ...event });

export function newSession(projectDir: string, corpus: CorpusLayout, meta: SessionMeta): string {
  const sid = `s-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const dir = dirOf(projectDir, corpus);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(fileOf(projectDir, corpus, sid), line({ kind: "session_start", meta }) + "\n", "utf-8");
  return sid;
}

export function appendSession(projectDir: string, corpus: CorpusLayout, sid: string, event: SessionEvent): void {
  try {
    fs.appendFileSync(fileOf(projectDir, corpus, sid), line(event) + "\n", "utf-8");
  } catch { /* 会话落盘失败不拖垮主流程 */ }
}

export function endSession(projectDir: string, corpus: CorpusLayout, sid: string, reason: string): void {
  appendSession(projectDir, corpus, sid, { kind: "session_end", reason });
}

function firstLine(p: string): string {
  const fd = fs.openSync(p, "r");
  try {
    const buf = Buffer.alloc(2048);
    const n = fs.readSync(fd, buf, 0, 2048, 0);
    return buf.toString("utf-8", 0, n).split("\n")[0] ?? "";
  } finally { fs.closeSync(fd); }
}

export interface SessionIndexEntry {
  sid: string;
  meta: SessionMeta;
  events: number;
  /** 真实轮数 = user 消息条数（执行器会话恒为 1 次派发） */
  turns: number;
  bytes: number;
  mtime: string;
  ended: boolean;
  /** D-E 会话管理：置顶 / 归档（首行 meta 持久化，清单按位回带） */
  pinned: boolean;
  archived: boolean;
}

export function listSessions(projectDir: string, corpus: CorpusLayout): SessionIndexEntry[] {
  const dir = dirOf(projectDir, corpus);
  let files: string[] = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl")); } catch { return []; }
  const out: SessionIndexEntry[] = [];
  for (const f of files) {
    const p = path.join(dir, f);
    try {
      const start = JSON.parse(firstLine(p));
      const text = fs.readFileSync(p, "utf-8");
      const lines = text.split("\n").filter((l) => l.trim());
      let turns = 0;
      let lastKind = "";
      for (const l of lines) {
        try {
          const e = JSON.parse(l) as { kind?: string; role?: string };
          lastKind = e.kind ?? lastKind;
          if (e.kind === "message" && e.role === "user") turns += 1;
        } catch { /* 跳过损坏行 */ }
      }
      out.push({
        sid: f.replace(/\.jsonl$/, ""),
        meta: start.meta ?? {},
        events: lines.length,
        turns,
        pinned: !!(start.meta as any)?.pinned,
        archived: !!(start.meta as any)?.archived,
        bytes: fs.statSync(p).size,
        mtime: fs.statSync(p).mtime.toISOString(),
        ended: lastKind === "session_end",
      });
    } catch { /* 跳过损坏会话文件 */ }
  }
  return out.sort((a, b) => b.mtime.localeCompare(a.mtime));
}

export function readSession(projectDir: string, corpus: CorpusLayout, sid: string): SessionEvent[] {
  try {
    return fs.readFileSync(fileOf(projectDir, corpus, sid), "utf-8")
      .split("\n").filter((l) => l.trim())
      .map((l) => { try { return JSON.parse(l) as SessionEvent; } catch { return { kind: "session_end", reason: "损坏行" } as SessionEvent; } });
  } catch { return []; }
}

/** 带 1-based 行号的事件读取（B9 对账：收据里每个数字都要能指回 <sid>.jsonl 第 N 行）。
 *  行号按「非空行」计数——与 readSession 的过滤口径一致，损坏行也占号（不静默消失）。 */
export function readSessionNumbered(projectDir: string, corpus: CorpusLayout, sid: string): { line: number; event: SessionEvent }[] {
  let text = "";
  try { text = fs.readFileSync(fileOf(projectDir, corpus, sid), "utf-8"); } catch { return []; }
  const out: { line: number; event: SessionEvent }[] = [];
  let n = 0;
  for (const l of text.split("\n")) {
    if (!l.trim()) continue;
    n += 1;
    try { out.push({ line: n, event: JSON.parse(l) as SessionEvent }); }
    catch { out.push({ line: n, event: { kind: "session_end", reason: "损坏行" } as SessionEvent }); }
  }
  return out;
}

/** 会话 JSONL 的绝对路径（收据引用文件名用；不做存在性保证）。 */
export function sessionFile(projectDir: string, corpus: CorpusLayout, sid: string): string {
  return fileOf(projectDir, corpus, sid);
}

/** 结果体截断存储：超过 16KB 存头 16KB + 截断标记。 */
export function capResult(result: unknown): string {
  let s: string;
  try { s = typeof result === "string" ? result : JSON.stringify(result); } catch { s = String(result); }
  if (s.length <= RESULT_CAP) return s;
  return s.slice(0, RESULT_CAP) + `\n…[截断，全文 ${s.length} 字符]`;
}
