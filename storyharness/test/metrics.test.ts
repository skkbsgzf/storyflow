// B9 · 指标面单测：usage 归一 / 累加 / 上下文读数 / 压缩压力 / JSONL 重放（新会话·旧会话·混合·查无）。
// 口径来源：pi-ai 的 Usage 形状 + pi-agent-core 的 shouldCompact——测试钉住「面板的数=磁盘的账」。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { newSession, appendSession, normUsage, addUsage, zeroUsage, contextTokensOf, readSessionNumbered, sessionFile, type TokenUsage } from "../src/sessions.js";
import type { CorpusLayout } from "../src/config.js";
import { compactionReadout, contextReadout, modelMeta, replayStats, type EventRow } from "../src/metrics.js";

const CORPUS: CorpusLayout = {
  projectsDir: "projects",
  receiptsDir: path.join("内部", "收据"),
  quarantineDir: path.join("内部", "storyharness", "backup"),
  sessionsDir: path.join("内部", "sessions"),
  lintTool: path.join("tools", "flow-lint.py"),
  lintCommand: "node",
};
const tmpWorkspace = () => fs.mkdtempSync(path.join(os.tmpdir(), "sh-b9-"));

const use = (p: Partial<TokenUsage> & { costTotal?: number }): TokenUsage => ({
  input: p.input ?? 0, output: p.output ?? 0, cacheRead: p.cacheRead ?? 0, cacheWrite: p.cacheWrite ?? 0,
  ...(p.reasoning !== undefined ? { reasoning: p.reasoning } : {}),
  totalTokens: p.totalTokens ?? 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: p.costTotal ?? 0, ...(p.cost ?? {}) },
});
const meta = (over: Partial<ReturnType<typeof modelMeta>> = {}) => ({ ...modelMeta(undefined), ...over });

// ── usage 归一与累加 ────────────────────────────────────────────

test("normUsage：pi 形状原样收下（含 cache/价率/reasoning）", () => {
  const u = normUsage({
    input: 1000, output: 20, cacheRead: 300, cacheWrite: 5, reasoning: 12, totalTokens: 1325,
    cost: { input: 0.001, output: 0.0002, cacheRead: 0.0001, cacheWrite: 0, total: 0.0013 },
  })!;
  assert.equal(u.input, 1000);
  assert.equal(u.reasoning, 12);
  assert.equal(u.totalTokens, 1325);
  assert.equal(u.cost.total, 0.0013);
});

test("normUsage：全零/缺字段/非对象都算「查无」，返回 undefined 不写空对象占位", () => {
  assert.equal(normUsage(undefined), undefined);
  assert.equal(normUsage(null), undefined);
  assert.equal(normUsage("x"), undefined);
  assert.equal(normUsage({ input: 0, output: 0, cost: { total: 0 } }), undefined);
  const legacy = normUsage({ input: 39127, output: 27 })!;   // 旧会话那行只有 input/output
  assert.equal(legacy.input, 39127);
  assert.equal(legacy.cost.total, 0);
});

test("addUsage：逐键相加，cost 逐键相加（不再乘价率），reasoning 任一侧有值才记", () => {
  const a = addUsage(addUsage(zeroUsage(), use({ input: 10, output: 1, totalTokens: 11, costTotal: 0.5 })), use({ input: 5, output: 2, totalTokens: 7, costTotal: 0.25, reasoning: 3 }));
  assert.deepEqual(
    { input: a.input, output: a.output, totalTokens: a.totalTokens, cost: a.cost.total, reasoning: a.reasoning },
    { input: 15, output: 3, totalTokens: 18, cost: 0.75, reasoning: 3 },
  );
  assert.equal(addUsage(a, undefined).input, 15);   // 无用量行不改数
});

test("contextTokensOf：优先 provider 的 totalTokens，缺则四项相加", () => {
  assert.equal(contextTokensOf(use({ input: 100, output: 10, cacheRead: 5, cacheWrite: 5, totalTokens: 999 })), 999);
  assert.equal(contextTokensOf(use({ input: 100, output: 10, cacheRead: 5, cacheWrite: 5 })), 120);
});

// ── 上下文与压缩读数 ────────────────────────────────────────────

test("contextReadout：pct 一位小数，basis 按 provider 实报/纯估算/查无 分档", () => {
  const a = contextReadout(128_000, { tokens: 32_000, usageTokens: 30_000, trailingTokens: 2_000 });
  assert.equal(a.pct, 25);
  assert.equal(a.basis, "provider");
  const b = contextReadout(128_000, { tokens: 6_400, usageTokens: 0, trailingTokens: 6_400 });
  assert.equal(b.pct, 5);
  assert.equal(b.basis, "estimate");
  const c = contextReadout(0, { tokens: 0, usageTokens: 0, trailingTokens: 0 });
  assert.equal(c.basis, "none");
  assert.equal(c.pct, 0);   // 窗口未知时不编百分比
});

test("compactionReadout：压力线 = 窗口-预留，越线判定走 pi 自己的 shouldCompact；本底座 supported=false 且 note 里写明未接入", () => {
  const ctx = contextReadout(128_000, { tokens: 120_000, usageTokens: 120_000, trailingTokens: 0 });
  const r = compactionReadout(ctx);
  assert.equal(r.supported, false);
  assert.equal(r.thresholdTokens, 128_000 - r.reserveTokens);
  assert.equal(r.over, true);
  assert.match(r.note, /不自动压缩/);
  assert.equal(compactionReadout(contextReadout(128_000, { tokens: 1_000, usageTokens: 1_000, trailingTokens: 0 })).over, false);
  assert.equal(compactionReadout(contextReadout(0, { tokens: 0, usageTokens: 0, trailingTokens: 0 })).over, false);   // 窗口未知不谎报越线
});

test("modelMeta：价率全 0 = priced:false（自定义端点不计费），不可解析时窗口 0", () => {
  assert.equal(modelMeta({ provider: "zai", id: "glm-x", contextWindow: 200_000, maxTokens: 8192, cost: { input: 1e-6, output: 2e-6, cacheRead: 0, cacheWrite: 0 } }).priced, true);
  const z = modelMeta({ provider: "mock", id: "m", contextWindow: 128_000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } });
  assert.equal(z.priced, false);
  assert.equal(z.contextWindow, 128_000);
  assert.deepEqual(modelMeta(undefined), meta());
});

// ── JSONL 重放：新会话 ──────────────────────────────────────────

const rows = (...r: Array<{ line: number; event: Record<string, unknown> }>) => r as unknown as EventRow[];
const userMsg = (text: string) => ({ kind: "message", role: "user", content: [{ type: "text", text }] });
const asstMsg = (u: TokenUsage) => ({ kind: "message", role: "assistant", content: [{ type: "text", text: "ok" }], usage: u });
const turnEnd = (e: Record<string, unknown>) => ({ kind: "run_event", event: { event: "chat_turn_end", ...e } });
/** B9 之前真实落盘的收口行形状：usage 只有 {input,output}，没有 cost——用它造 fixture 才等于磁盘真相。 */
const legacyUse = (input: number, output: number) => ({ input, output });

test("replayStats（新会话·逐条 message.usage）：本轮=该轮各行求和，累计=全轮求和，context 取收口行", () => {
  const s = replayStats(rows(
    { line: 1, event: { ts: "t0", kind: "session_start", meta: { project: "p", mode: "chat" } } },
    { line: 2, event: { ts: "t1", ...userMsg("第一问") } },
    { line: 3, event: { ts: "t1", ...asstMsg(use({ input: 1000, output: 50, cacheRead: 200, totalTokens: 1250, costTotal: 0.01 })) } },
    { line: 4, event: { ts: "t1", ...asstMsg(use({ input: 1300, output: 20, totalTokens: 1320, costTotal: 0.005 })) } },
    { line: 5, event: { ts: "t1", ...turnEnd({
      rounds: 2, toolCalls: 1, usage: use({ input: 2300, output: 70, totalTokens: 2570, costTotal: 0.015 }),
      sessionUsage: use({ input: 2300, output: 70, totalTokens: 2570, costTotal: 0.015 }),
      model: { provider: "zai", id: "glm-x", contextWindow: 128_000 },
      context: contextReadout(128_000, { tokens: 2570, usageTokens: 2570, trailingTokens: 0 }),
      compaction: compactionReadout(contextReadout(128_000, { tokens: 2570, usageTokens: 2570, trailingTokens: 0 })),
    }) } },
    { line: 6, event: { ts: "t2", ...userMsg("第二问") } },
    { line: 7, event: { ts: "t2", ...asstMsg(use({ input: 2600, output: 30, totalTokens: 2630, costTotal: 0.02 })) } },
    { line: 8, event: { ts: "t2", ...turnEnd({
      rounds: 1, toolCalls: 0, usage: use({ input: 2600, output: 30, totalTokens: 2630, costTotal: 0.02 }),
      sessionUsage: use({ input: 4900, output: 100, totalTokens: 5200, costTotal: 0.035 }),
      model: { provider: "zai", id: "glm-x", contextWindow: 128_000 },
      context: contextReadout(128_000, { tokens: 5200, usageTokens: 5200, trailingTokens: 0 }),
    }) } },
  ), "p.jsonl", meta({ contextWindow: 128_000 }));

  assert.equal(s.source, "message");
  assert.equal(s.turns.length, 2);
  assert.equal(s.sid, "");        // 会话号由 serve/chat 层补，重放层不猜
  const [t1, t2] = s.turns;
  assert.equal(t1.usage.input, 2300);          // 1000 + 1300（逐条求和，不收口行的水）
  assert.equal(t1.usage.cost.total, 0.015);
  assert.equal(t1.costKnown, true, "新行带 cost 字段 → 成本报数");
  assert.equal(s.totals.costKnown, true);
  assert.equal(t1.basis, "message");
  assert.equal(t1.usageLine, 4);               // 用量家：最后一条 message 行
  assert.equal(t1.line, 5);                    // 回合数家：chat_turn_end 行
  assert.equal(t1.contextUsed, 2570);
  assert.equal(t2.usage.input, 2600);
  assert.equal(s.totals.usage.input, 4900);    // 累计 = 逐条求和（2300+2600）
  assert.equal(s.totals.cost, 0.035);
  assert.equal(s.totals.basis, "逐条 message.usage 行求和");
  assert.equal(s.context.used, 5200);          // 最新读数 = 最后一行收口
  assert.equal(s.context.window, 128_000);
  assert.equal(s.context.pct, 4.1);
  assert.equal(s.compaction.over, false);
});

test("replayStats（旧会话·收口行只记累计）：basis=legacy-cumulative，本轮取最大一行，累计不逐行相加", () => {
  const s = replayStats(rows(
    { line: 1, event: { ts: "t0", kind: "session_start", meta: { project: "p", mode: "chat" } } },
    { line: 2, event: { ts: "t1", ...userMsg("1") } },
    { line: 3, event: { ts: "t1", kind: "message", role: "assistant", content: [{ type: "text", text: "a" }] } },
    { line: 4, event: { ts: "t1", ...turnEnd({ rounds: 12, toolCalls: 11, usage: legacyUse(28246, 5571) }) } },
    { line: 5, event: { ts: "t2", ...userMsg("2") } },
    { line: 6, event: { ts: "t2", ...turnEnd({ rounds: 1, toolCalls: 0, usage: legacyUse(31000, 200) }) } },
    { line: 7, event: { ts: "t2", ...turnEnd({ rounds: 1, toolCalls: 0, usage: legacyUse(300, 5) }) } },
  ), "p.jsonl", meta({ contextWindow: 128_000 }));

  assert.equal(s.source, "legacy");
  assert.equal(s.turns.length, 2);
  assert.equal(s.turns[0].basis, "legacy-cumulative");
  assert.equal(s.turns[0].usage.input, 28246);
  assert.equal(s.turns[0].usageLine, 4);
  assert.equal(s.turns[0].costKnown, false, "旧行没记 cost → 面板写「查无」，不许印成 $0（那等于宣称这轮免费）");
  assert.equal(s.turns[1].usage.input, 31000, "同轮多行（重试）取最大的一行，不取最后一行的缩水值");
  assert.equal(s.turns[1].usageLine, 6);
  assert.equal(s.totals.usage.input, 28246, "旧行是累计口径：取总 token 最大的一行（禁止逐行相加虚报）");
  assert.match(s.totals.basis, /旧会话只记累计/);
  assert.equal(s.totals.costKnown, false);
  assert.equal(s.context.used, 0, "旧行推不出上下文占用（那是生命周期累计，不是最后一次请求的 prompt 大小）");
  assert.equal(s.context.basis, "none");
  assert.equal(s.turns[0].contextUsed, 0);
  assert.equal(s.compaction.over, false, "窗口有数但占用查无 → 不谎报越线");
});

test("replayStats（混合：升级前旧行 + 升级后新行）：source=mixed，累计只按逐条口径并如实标注", () => {
  const s = replayStats(rows(
    { line: 1, event: { ts: "t0", ...userMsg("旧") } },
    { line: 2, event: { ts: "t0", ...turnEnd({ rounds: 1, toolCalls: 0, usage: legacyUse(9000, 90) }) } },
    { line: 3, event: { ts: "t1", ...userMsg("新") } },
    { line: 4, event: { ts: "t1", ...asstMsg(use({ input: 100, output: 10, totalTokens: 110, costTotal: 0.001 })) } },
    { line: 5, event: { ts: "t1", ...turnEnd({
      rounds: 1, toolCalls: 0, usage: use({ input: 100, output: 10, totalTokens: 110, costTotal: 0.001 }),
      sessionUsage: use({ input: 100, output: 10, totalTokens: 110, costTotal: 0.001 }),
      model: { provider: "zai", id: "glm-x", contextWindow: 200_000 },
      context: contextReadout(200_000, { tokens: 110, usageTokens: 110, trailingTokens: 0 }),
    }) } },
  ), "p.jsonl", meta({ contextWindow: 128_000 }));

  assert.equal(s.source, "mixed");
  assert.equal(s.totals.usage.input, 100);
  assert.match(s.totals.basis, /升级后逐条/);
  assert.equal(s.turns[0].basis, "legacy-cumulative");
  assert.equal(s.turns[1].basis, "message");
  assert.equal(s.turns[0].costKnown, false, "混合会话里旧行仍标成本查无");
  assert.equal(s.turns[1].costKnown, true);
  assert.equal(s.totals.costKnown, true, "累计只按有新 cost 的行计");
  assert.equal(s.model.contextWindow, 200_000, "收口行存过的窗口优先于当前配置（换模型不改历史账）");
});

test("replayStats（查无）：没有任何用量行 → source/basis 全显式「查无」，不显示 0% 假数", () => {
  const s = replayStats(rows(
    { line: 1, event: { ts: "t0", kind: "session_start", meta: { project: "p", mode: "chat" } } },
    { line: 2, event: { ts: "t1", ...userMsg("hi") } },
  ), "p.jsonl", meta({ contextWindow: 128_000 }));
  assert.equal(s.source, "none");
  assert.equal(s.turns.length, 1);
  assert.equal(s.turns[0].basis, "none");
  assert.equal(s.totals.basis, "查无：该会话没有任何用量行");
  assert.equal(s.context.basis, "none");
  assert.equal(s.context.pct, 0);
});

test("replayStats：执行器轨迹（无 user 打头、只有 assistant usage）也能成行", () => {
  const s = replayStats(rows(
    { line: 1, event: { ts: "t0", kind: "session_start", meta: { project: "p", mode: "executor", node: "m1.x", model: "zai.glm" } } },
    { line: 2, event: { ts: "t1", ...asstMsg(use({ input: 500, output: 100, totalTokens: 600, costTotal: 0.002 })) } },
    { line: 3, event: { ts: "t1", kind: "turn_end" } },
  ), "p.jsonl", meta({ contextWindow: 128_000 }));
  assert.equal(s.turns.length, 1);
  assert.equal(s.turns[0].usage.input, 500);
  assert.equal(s.turns[0].text, "");
  assert.equal(s.model.model, "zai.glm", "没配模型时用首行 meta.model 标列头");
});

// ── 落盘往返：usage 真的写进 JSONL 且行号对得上 ──────────────────

test("JSONL 往返：message.usage 落盘后 readSessionNumbered 行号与重放结果一致", () => {
  const root = tmpWorkspace();
  const projectDir = path.join(root, "projects", "p-b9");
  const sid = newSession(projectDir, CORPUS, { project: "p-b9", mode: "chat", title: "指标往返" });
  appendSession(projectDir, CORPUS, sid, userMsg("问一") as never);
  appendSession(projectDir, CORPUS, sid, { kind: "message", role: "assistant", content: [{ type: "text", text: "答" }], usage: use({ input: 700, output: 30, totalTokens: 730, costTotal: 0.004 }) });
  appendSession(projectDir, CORPUS, sid, { kind: "run_event", event: { event: "chat_turn_end", rounds: 1, toolCalls: 0, usage: use({ input: 700, output: 30, totalTokens: 730, costTotal: 0.004 }), sessionUsage: use({ input: 700, output: 30, totalTokens: 730, costTotal: 0.004 }), model: { provider: "zai", id: "glm-x", contextWindow: 128_000 }, context: contextReadout(128_000, { tokens: 730, usageTokens: 730, trailingTokens: 0 }) } } as never);

  const r = readSessionNumbered(projectDir, CORPUS, sid);
  assert.equal(r.length, 4);                              // session_start + user + assistant + run_event
  assert.equal(r[2].event.kind, "message");
  assert.equal((r[2].event as { usage?: TokenUsage }).usage?.input, 700);
  const s = replayStats(r, sessionFile(projectDir, CORPUS, sid), meta({ contextWindow: 128_000 }));
  assert.equal(s.turns[0].usageLine, 3, "行号 = 非空行 1-based（与收据引用口径一致）");
  assert.equal(s.turns[0].line, 4);
  assert.equal(s.totals.cost, 0.004);
  assert.equal(s.context.used, 730);
  fs.rmSync(root, { recursive: true, force: true });
});
