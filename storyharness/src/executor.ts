// 单节点执行器 v4：
//  ② 派发清盘（旧产物移备份区，杜绝假阳性交卷；dry 跳过——不动盘上任何既有文件）
//  ③ 上游正文确定性注入 + 头部由 headerTemplate 确定性合成
//  ④ 收据制（工具调用/usage/elapsed → 内部/收据/sh-*.json）＋会话全文落盘（内部/sessions/）
//  ⑤ 节点级瞬时重试（terminated/fetch failed 等，换新 agent 重来一次；429 类不重试）
//  ⑥ 流断桥回落（重试仍死 → python 非流式 POST 兜底；Z.ai 网关对高档长思维流会断 SSE）
//  Q2 per-op 档位：任务包 model_tier 信号 → config.tiers 自动选模型（high=强档/lite=轻档）
import { Agent } from "@earendil-works/pi-agent-core";
import type { HarnessConfig, TierTarget } from "./config.js";
import { KernelClient } from "./kernel.js";
import { buildTools } from "./tools.js";
import { makeAnalysisTools } from "./analysis.js";
import { makeModels, makeStreamFn, resolveModel } from "./llm.js";
import { newSession, appendSession, endSession, capResult, normUsage } from "./sessions.js";
import { buildProjectBrief } from "./brief.js";
import { spawnSync } from "node:child_process";
import os from "node:os";
import * as fs from "node:fs";
import path from "node:path";

export interface NodeRunResult {
  node: string;
  file?: string;
  ok: boolean;
  detail: string;
  /** 遥测元数据：供 scheduler 汇总进 run-<ts>.json（审核层已移除——语义裁决归宿主，v0.8） */
  meta?: { elapsedMs: number; usage: Record<string, number>; toolCount: number; submitRounds: number };
}

interface ToolLogEntry { name: string; ms: number; ok: boolean; len?: number; err?: string }

const SYSTEM = [
  "你是创作流水线的节点执行器。任务包里已经写清：本步的判定标尺、必读输入、产物契约。",
  "上游产物正文已确定性注入本消息（【上游产物正文】段）——直接引用，不要再重复读盘。",
  "你只负责产出正文本体（从一级标题开始）；artifact 头部由执行器合成，无需你写。",
  "正文写完后，用 fs_write 按输出契约路径落盘——落盘即交卷准备，写完即结束，不要输出与产物无关的客套。",
  "不要改动流程编排与运行状态文件（flow / state / registry 一类）。回答与注释全部用中文。",
].join("\n");

const SYSTEM_DRY = [
  "你是创作流水线的节点执行器。任务包里已经写清：本步的判定标尺、必读输入、产物契约。",
  "上游产物正文已确定性注入本消息（【上游产物正文】段）——直接引用，不要再重复读盘。",
  "你只负责产出正文本体（从一级标题开始）——正文写完后，**把完整产物正文原样作为你的最终回复输出**（本模式由执行器负责落盘，你没有文件写入工具）。",
  "产物头部由执行器合成，无需你写。不要改动流程编排与运行状态文件。回答与注释全部用中文。",
].join("\n");

const now = () => new Date().toISOString().replace("T", " ").slice(0, 16);

export function buildUserPrompt(pkg: Record<string, any>): string {
  let p: string = pkg.spawnPrompt || pkg.instruction?.text || "";
  const ctx = Array.isArray(pkg.context) ? pkg.context : [];
  if (ctx.length) {
    p += "\n\n【上游产物正文（内核预算截断后确定性注入；直接引用，禁止重复读盘）】";
    for (const c of ctx) {
      p += `\n\n=== ${c.ref}@${c.hash ?? "—"} ===\n${c.excerpt ?? "(无正文)"}`;
    }
  }
  return p;
}

/** 头部确定性合成：headerTemplate（含正文骨架）为底，标题/摘要从正文推导。 */
export function composeArtifact(pkg: Record<string, any>, body: string, modelTag: string): string {
  const titleMatch = body.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim().slice(0, 80) : "未命名产物";
  const para = body.split("\n").map((l) => l.trim())
    .find((l) => l && !l.startsWith("#") && !l.startsWith(">") && !l.startsWith("```")) ?? title;
  const summary = para.replace(/\s+/g, " ").replace(/[*`]/g, "").slice(0, 58);
  let tpl: string = typeof pkg.headerTemplate === "string" && pkg.headerTemplate.trim()
    ? pkg.headerTemplate
    : `---\nartifact: 1\nid: ${pkg.nodeId ?? "unknown"}\nclass: input\nnode: ${pkg.nodeId ?? "unknown"}\nround: 1\nversion: v1\nstate: draft\nat: ${now()}\nby: storyharness\nupstream:\n${(pkg.context ?? []).map((c: any) => `  - ${c.ref}@${c.hash ?? ""}`).join("\n") || "  []"}\n---\n\n# <标题>\n> <一句话摘要，≤60 字，不得复述标题>\n`;
  // 内核 parseArtifactHeader 解析怪癖：块级 `upstream:` 的无冒号行被跳过、被下一个顶级键清 pending
  // →「缺字段 upstream」。统一折叠成行内形态（`upstream: []` / `upstream: [ref@hash, …]`）。
  const upstreamInline = (pkg.context ?? []).length
    ? `[${(pkg.context as { ref: string; hash?: string }[]).map((c) => `${c.ref}@${c.hash ?? ""}`).join(", ")}]`
    : "[]";
  tpl = tpl.replace(/^upstream:\n(?:[ \t]+[^\n]*\n)*/m, "");
  tpl = tpl.replace(/\n---\n/, `\nupstream: ${upstreamInline}\n---\n`);
  const out = tpl
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^#\s*<标题>.*$/m, `# ${title}`)
    .replace(/^>\s*<一句话摘要[^>]*>.*$/m, `> ${summary}`)
    .replace(/^at:\s*<YYYY-MM-DD HH:MM>.*$/m, `at: ${now()}`)
    .replace(/by:\s*\S+/, `by: storyharness(${modelTag})`)
    .trimEnd();
  return out + "\n\n" + body.trimStart() + "\n";
}

/** 任务包的档位点名：toolConfig.model_tier 或 spawnPrompt 行，无点名 = default。 */
export function tierSignalOf(pkg: Record<string, any>): "high" | "lite" | "default" {
  const signal: string =
    (pkg.toolConfig && pkg.toolConfig.model_tier) ||
    (pkg.spawnPrompt || pkg.instruction?.text || "").match(/model_tier\s*=\s*(high|lite)/i)?.[1] ||
    "default";
  const t = signal.toLowerCase();
  return t === "high" || t === "lite" ? t : "default";
}

/** Q2 per-op 档位：任务包 model_tier 信号（toolConfig 或 spawnPrompt 行）→ tiers 选模型。 */
export function pickTarget(cfg: HarnessConfig & { tiers?: any }, pkg: Record<string, any>): TierTarget {
  const tier = tierSignalOf(pkg);
  const t = cfg.tiers?.[tier];
  return t ? { provider: t.provider, model: t.model, apiKey: t.apiKey ?? cfg.apiKey, baseUrl: t.baseUrl } : { provider: cfg.provider, model: cfg.model, apiKey: cfg.apiKey, baseUrl: cfg.baseUrl };
}

/** 清盘：旧产物移备份区——提交闸吃到的必须是本轮产物。返回隔离路径（如有）。 */
function quarantineStale(kernel: KernelClient, project: string, file?: string): string | null {
  if (!file) return null;
  const projectDir = kernel.projectDir(project);
  const abs = path.join(projectDir, file);
  if (!fs.existsSync(abs)) return null;
  const bakDir = path.join(projectDir, kernel.corpus.quarantineDir);
  fs.mkdirSync(bakDir, { recursive: true });
  const bak = path.join(bakDir, `${nodeTag(file)}-${Date.now()}${path.extname(file)}`);
  fs.renameSync(abs, bak);
  return path.relative(projectDir, bak);
}

const nodeTag = (s: string) => s.replace(/[^\w.-]/g, "_").slice(0, 60);

function writeReceipt(kernel: KernelClient, project: string, node: string, receipt: unknown): void {
  try {
    const dir = path.join(kernel.projectDir(project), kernel.corpus.receiptsDir);
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, `sh-${nodeTag(node)}-${Date.now()}.json`);
    fs.writeFileSync(f, JSON.stringify({ ...(receipt as object), receiptFile: path.basename(f) }, null, 1), "utf-8");
    console.error(`[storyharness] 收据 → ${path.relative(kernel.projectDir(project), f)}`);
  } catch { /* 收据失败不拖垮主流程 */ }
}

/** 执行一个已派发的任务包（Q3 调度器的并发单元）。 */
export async function runEntry(kernel: KernelClient, cfg: HarnessConfig, entry: { nodeId: string; taskPackage?: Record<string, any>; spawnPrompt?: string }, opts: { dry?: boolean } = {}): Promise<NodeRunResult> {
  const t0 = Date.now();
  const node = entry.nodeId;
  const pkg = (entry.taskPackage || {}) as Record<string, any>;
  const prompt = entry.spawnPrompt || buildUserPrompt(pkg);
  const file: string | undefined = pkg.outputContract?.file || pkg.output?.file;
  const target = pickTarget(cfg, pkg);
  const modelTag = `${target.provider}.${target.model}`;
  // 模型档位纪律：任务包点名 high/lite 而配置缺该档 = 降档，必须显式声明不得默默
  const tier = tierSignalOf(pkg);
  if (tier !== "default" && !cfg.tiers?.[tier]) {
    console.error(`[storyharness] 档位声明：节点 ${node} 任务包点名 model_tier=${tier} 但 .external/storyharness.json 未配 tiers.${tier}——按默认档 ${modelTag} 执行`);
  }

  // dry 跳过清盘（C 批验收 nit）：「不落盘」语义 = 不动盘上任何既有文件
  const quarantined = opts.dry ? null : quarantineStale(kernel, cfg.project, file);

  const models = makeModels({ provider: target.provider, model: target.model, apiKey: target.apiKey ?? cfg.apiKey, baseUrl: target.baseUrl ?? cfg.baseUrl });
  const model = resolveModel(models, target);
  const toolLog: ToolLogEntry[] = [];
  const toolLogWrap = (t: ReturnType<typeof buildTools>[number]) => ({
    ...t,
    execute: async (id: string, params: any, signal?: AbortSignal, onUpdate?: any) => {
      const s = Date.now();
      try {
        const r = await t.execute(id, params, signal, onUpdate);
        toolLog.push({ name: t.name, ms: Date.now() - s, ok: true, len: JSON.stringify(r.content)?.length ?? 0 });
        return r;
      } catch (e) {
        toolLog.push({ name: t.name, ms: Date.now() - s, ok: false, err: String((e as Error).message).slice(0, 200) });
        throw e;
      }
    },
  });

  // thinking 合理性旋钮：推理预算按档给足，防「maxTokens 被 thinking 吃光」失败态
  const BUDGETS: Record<string, { minimal?: number; low?: number; medium?: number; high?: number }> = {
    off: {},
    low: { low: 1024, medium: 2048, high: 4096 },
    medium: { low: 2048, medium: 8192, high: 16384 },
    high: { low: 4096, medium: 16384, high: 32768 },
  };

  const textOf = (c: unknown): string =>
    typeof c === "string" ? c : Array.isArray(c) ? c.filter((b) => (b as { type?: string }).type === "text").map((b) => (b as { text?: string }).text ?? "").join("") : "";

  const sessDir0 = { projectDir: kernel.projectDir(cfg.project), corpus: kernel.corpus };
  const sid = newSession(sessDir0.projectDir, sessDir0.corpus, { project: cfg.project, mode: "executor", node, model: modelTag });

  // 审核层已移除（v0.8）：判官证据/回喂不再存在——语义复核归宿主系统（见 docs/PROTOCOL-REVIEW.md），
  // 运行时只产出确定性产物与用量。
  const finalPrompt = prompt;

  // 赋能前移：项目简报拼进系统提示（确定性事实，agent 醒来即知盘面——消重复考古）
  const projectBrief = buildProjectBrief(kernel, cfg.project) ?? "（新项目：尚无运行状态，从任务包开始）";
  const agentFactory = () => {
    const a = new Agent({
      initialState: {
        // dry 语义：不落产物 ⇒ 收掉 fs_write 且换 dry 提示词（正文作为最终回复，由执行器负责落盘）
        systemPrompt: (opts.dry ? SYSTEM_DRY : SYSTEM) + "\n\n" + projectBrief,
        model,
        tools: [
          ...buildTools(kernel, cfg.project).filter((t) => !(opts.dry && t.name === "fs_write")),
          ...makeAnalysisTools(kernel, { models, model, projectDir: sessDir0.projectDir }),
        ].map(toolLogWrap),
      },
      thinkingBudgets: BUDGETS[cfg.thinking] ?? BUDGETS.medium,
      streamFn: makeStreamFn(models),
    });
    a.subscribe((ev) => {
      // B9 · 逐条用量随 message 行落盘：执行器轨迹与对话同库，轨迹页的逐轮表要有数（provider 不回报则不写空对象）
      if (ev.type === "message_end") {
        const eu = normUsage((ev.message as { usage?: unknown }).usage);
        const role = (ev.message as { role?: string }).role ?? "assistant";
        // B19 契约：assistant 行盖 model 戳（回放「这条是哪个模型跑的」）；非 assistant 行不带——chatTranscript 段内取末条非空
        appendSession(sessDir0.projectDir, sessDir0.corpus, sid, { kind: "message", role, content: (ev.message as { content?: unknown }).content, ...(eu ? { usage: eu } : {}), ...(role === "assistant" ? { model: modelTag } : {}) });
      }
      else if (ev.type === "tool_execution_start") appendSession(sessDir0.projectDir, sessDir0.corpus, sid, { kind: "tool_call", toolCallId: ev.toolCallId, toolName: ev.toolName, args: ev.args });
      else if (ev.type === "tool_execution_end") appendSession(sessDir0.projectDir, sessDir0.corpus, sid, { kind: "tool_result", toolCallId: ev.toolCallId, toolName: ev.toolName, isError: ev.isError, result: capResult(ev.result) });
      else if (ev.type === "turn_end") appendSession(sessDir0.projectDir, sessDir0.corpus, sid, { kind: "turn_end" });
    });
    return a;
  };

  const pullLastText = (): string => {
    const ms = (agent.state as unknown as { messages?: { role: string; content: unknown }[] }).messages ?? [];
    const last = [...ms].reverse().find((m) => m.role === "assistant");
    return last ? textOf(last.content) : "";
  };

  // 节点级瞬时重试 + 流断桥回落（工具函数）
  const TRANSIENT = /terminated|fetch failed|ECONNRESET|socket hang up|network|timed out|timeout/i;
  const isTransient = (s: string) => TRANSIENT.test(s) && !/429|Usage limit/i.test(s);
  /** 流式死亡回落桥：python 非流式 POST（900s socket）——Z.ai 网关对高档长思维流会断 SSE，
   *  非流式实测可扛数分钟生成（sh.mts/demo2 全程实证）。 */
  const bridgeFallback = (system: string, user: string): string | null => {
    // 显式合同：command+script 都配置才启用；未配置不回落（隐式借用 v4 仓路径已随 v4 归档移除）。
    if (!cfg.fallback?.command || !cfg.fallback?.script) return null;
    try {
      const cmd = cfg.fallback.command;
      const script = path.join(cfg.workspaceRoot, cfg.fallback.script);
      if (!fs.existsSync(script)) return null;
      const dir = os.tmpdir();
      const cfgFile = path.join(dir, `sh-bridge-cfg-${Date.now()}.json`);
      const bodyFile = path.join(dir, `sh-bridge-body-${Date.now()}.json`);
      fs.writeFileSync(cfgFile, JSON.stringify({ baseUrl: target.baseUrl ?? "https://api.z.ai/api/coding/paas/v4", model: target.model, apiKey: target.apiKey ?? cfg.apiKey }), "utf-8");
      fs.writeFileSync(bodyFile, JSON.stringify({ messages: [{ role: "system", content: system }, { role: "user", content: user }], max_tokens: cfg.fallback?.maxTokens ?? 32_768, temperature: 0.8 }), "utf-8");
      const p = spawnSync(cmd, [script, "--body", bodyFile, "--config", cfgFile], { encoding: "utf-8", timeout: 900_000, maxBuffer: 64 << 20, env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
      for (const f of [cfgFile, bodyFile]) { try { fs.rmSync(f, { force: true }); } catch { /* 临时件 */ } }
      if (p.error || !p.stdout?.trim()) return null;
      const parsed = JSON.parse(p.stdout.trim().split("\n").filter((l) => l.trim().startsWith("{")).pop() || "{}");
      const out = String(parsed.content || "");
      return out.trim() ? out : null;
    } catch { return null; }
  };

  /** 正文真源裁决：agent 可能以末条消息交正文，也可能 fs_write 落盘后只说「已落盘…」——取更长者。 */
  function pickBody(fromText: string): string {
    let body = fromText;
    try {
      if (file) {
        const abs0 = path.join(sessDir0.projectDir, file);
        if (fs.existsSync(abs0)) {
          const disk = fs.readFileSync(abs0, "utf-8");
          const stripped = disk.startsWith("---\n") ? disk.replace(/^---\n[\s\S]*?\n---\n/, "") : disk;
          if (stripped.trim().length > body.trim().length) body = stripped.trim();
        }
      }
    } catch { /* 盘读失败回落末条消息 */ }
    return body;
  }

  console.error(`[storyharness] 节点 ${node} 开始（model=${modelTag} thinking=${cfg.thinking}）`);
  let agent = agentFactory();
  let attempt = 0;
  let bridgeUsed = false;
  for (;;) {
    let streamErr = "";
    // D-B3 · 看门狗（960s）：SDK 超时失效时的兜底闸——到点 agent.abort() 显式终结
    const watchdog = setTimeout(() => { try { agent.abort(); } catch { /* 已结束 */ } }, 960_000);
    try {
      await agent.prompt(finalPrompt);
    } catch (e) {
      streamErr = String((e as Error).message);
    } finally {
      clearTimeout(watchdog);
    }
    if (!streamErr) {
      const lastMsg = [...((agent.state as unknown as { messages?: { role: string; stopReason?: string; errorMessage?: string }[] }).messages ?? [])].reverse().find((m) => m.role === "assistant");
      if (lastMsg?.stopReason === "error") streamErr = String(lastMsg.errorMessage || "未知模型错误");
    }
    if (!streamErr) break;                       // 正常完成
    if (bridgeUsed || !isTransient(streamErr)) { // 非瞬时 / 已回落过 → 显式失败
      endSession(sessDir0.projectDir, sessDir0.corpus, sid, `模型流错误: ${streamErr.slice(0, 120)}`);
      throw new Error(`模型流错误（节点 ${node}）：${streamErr.slice(0, 200)}`);
    }
    if (attempt === 0) {
      attempt = 1;
      console.error(`[storyharness] 节点 ${node} 瞬时流错误（${streamErr.slice(0, 80)}）——5s 后重试一次`);
      appendSession(sessDir0.projectDir, sessDir0.corpus, sid, { kind: "run_event", event: { event: "transient_retry", node, error: streamErr.slice(0, 120) } });
      await new Promise((r) => setTimeout(r, 5000));
      agent = agentFactory();
      continue;
    }
    // 重试仍死 → 桥回落（非流式 POST；dry 不回落——dry 本就不交卷）
    if (opts.dry) {
      endSession(sessDir0.projectDir, sessDir0.corpus, sid, `模型流错误（dry 不回落桥）: ${streamErr.slice(0, 100)}`);
      throw new Error(`模型流错误（节点 ${node}）：${streamErr.slice(0, 200)}`);
    }
    if (!cfg.fallback?.command || !cfg.fallback?.script) {
      endSession(sessDir0.projectDir, sessDir0.corpus, sid, `流断且未配置 fallback 桥`);
      throw new Error(`模型流错误且未配置 fallback 桥（cfg.fallback.command/script，节点 ${node}）：${streamErr.slice(0, 160)}`);
    }
    console.error(`[storyharness] 节点 ${node} 流重试仍死——python 桥非流式兜底`);
    appendSession(sessDir0.projectDir, sessDir0.corpus, sid, { kind: "run_event", event: { event: "stream_fallback", node, error: streamErr.slice(0, 120) } });
    const bridged = bridgeFallback(SYSTEM_DRY, finalPrompt);
    if (!bridged) {
      endSession(sessDir0.projectDir, sessDir0.corpus, sid, `流断且桥回落无正文`);
      throw new Error(`模型流错误且桥回落无正文（节点 ${node}）：${streamErr.slice(0, 160)}`);
    }
    bridgeUsed = true;
  }

  const lastText = pullLastText();
  const msgs = (agent.state as unknown as { messages?: { role: string; content: unknown; usage?: Record<string, number> }[] }).messages ?? [];
  const totalUsage = msgs.reduce((acc: Record<string, number>, m) => {
    const u = (m as { usage?: Record<string, number> }).usage;
    if (u) { acc.input = (acc.input ?? 0) + (u.input ?? 0); acc.output = (acc.output ?? 0) + (u.output ?? 0); }
    return acc;
  }, {});
  const elapsedMs = Date.now() - t0;

  if (opts.dry) {
    const receipt = { dry: true, node, file, elapsedMs, usage: totalUsage, tools: toolLog, finalChars: lastText.length };
    writeReceipt(kernel, cfg.project, node, receipt);
    endSession(sessDir0.projectDir, sessDir0.corpus, sid, "dry 完成（不落产物、未交卷）");
    return { node, file, ok: true, detail: `[dry] 生成 ${lastText.length} 字符（未落盘未交卷）：${lastText.slice(0, 160)}` };
  }

  if (!file) {
    endSession(sessDir0.projectDir, sessDir0.corpus, sid, "任务包无输出契约路径，未交卷");
    return { node, ok: false, detail: "任务包无输出契约路径，无法交卷" };
  }

  const fixPrompt = (problems: string, round: number) =>
    `你上一轮产出的《${file}》被内核完整性闸打回（第 ${round} 轮）。拒因：${problems}。\n` +
    `请修正后用 fs_write 按原路径重新落盘**整份产物正文**（从一级标题开始；头部由执行器合成，不用你写）。写完即止，不要客套。`;

  let body = pickBody(lastText);
  const abs = path.join(sessDir0.projectDir, file);
  fs.mkdirSync(path.dirname(abs), { recursive: true });

  // 交卷→被拒→带拒因自修→再交（sh.mts 自愈环移植）；最多 3 轮，仍拒 = 本节点失败
  let submit: { ok?: boolean; status?: string; problems?: { name: string; status: string; detail?: string }[]; detail?: string } = { ok: false };
  let rounds = 0;
  const MAX_SUBMIT_ROUNDS = 3;
  for (;;) {
    rounds += 1;
    const artifact = composeArtifact(pkg, body, modelTag);
    fs.writeFileSync(abs, artifact, "utf-8");
    submit = await kernel.flowSubmit(cfg.project, node, { file, notes: `storyharness 执行（${modelTag}，第 ${rounds} 轮提交）` }) as typeof submit;
    const blocks = (submit.problems ?? []).filter((p) => p.status === "block");
    appendSession(sessDir0.projectDir, sessDir0.corpus, sid, { kind: "run_event", event: { event: submit.status === "rejected" ? "integrity_reject" : "submit", node, file, round: rounds, ok: submit.status !== "rejected", detail: blocks.map((p) => `${p.name}: ${p.detail ?? ""}`).join("；").slice(0, 200) } });
    if (submit.status !== "rejected" || rounds >= MAX_SUBMIT_ROUNDS) break;
    const problems = blocks.map((p) => `${p.name}: ${p.detail ?? ""}`).join("；") || "未知拒因";
    console.error(`[storyharness] 节点 ${node} 交卷被拒（第 ${rounds} 轮）：${problems}——带拒因自修`);
    await agent.prompt(fixPrompt(problems, rounds));
    body = pickBody(pullLastText());
    if (!body) break;   // 自修空返回，下一轮提交会再被拒并走到熔断
  }
  const rejected = submit.status === "rejected";

  endSession(sessDir0.projectDir, sessDir0.corpus, sid, rejected ? `交卷被拒（${rounds} 轮）` : "交卷通过");
  writeReceipt(kernel, cfg.project, node, {
    node, file, model: modelTag, elapsedMs, usage: totalUsage,
    toolCalls: toolLog, toolCount: toolLog.length, artifactChars: body.length, submit, submitRounds: rounds,
    quarantined: quarantined ?? undefined, bridgeUsed: bridgeUsed || undefined,
  });
  return { node, file, ok: !rejected, meta: { elapsedMs, usage: totalUsage, toolCount: toolLog.length, submitRounds: rounds }, detail: rejected
    ? `交卷被拒×${rounds}：${(submit.problems ?? []).filter((p) => p.status === "block").map((p) => `${p.name}: ${p.detail ?? ""}`).join("；").slice(0, 160)}`
    : `${body.length} 字符 / ${elapsedMs}ms / 工具 ${toolLog.length} 次 / ${rounds} 轮提交` };
}

/** CLI run-node 兼容入口：flow_next 取一个节点并执行。 */
export async function runNextNode(kernel: KernelClient, cfg: HarnessConfig, opts: { dry?: boolean } = {}): Promise<NodeRunResult> {
  const next = await kernel.flowNext(cfg.project);
  if (next.status !== "awaiting_input") {
    return { node: "-", ok: false, detail: `无可派发节点：status=${next.status}${next.gate ? `（门 ${next.gate.nodeId} 待人裁）` : ""}` };
  }
  const entry = next.batch?.length
    ? next.batch[0]
    : next.nodeId
      ? { nodeId: next.nodeId, taskPackage: next.taskPackage, spawnPrompt: (next as { spawnPrompt?: string }).spawnPrompt }
      : undefined;
  if (!entry) return { node: "-", ok: false, detail: "flow_next 未返回任务包" };
  return runEntry(kernel, { ...cfg, project: cfg.project }, entry, opts);
}
