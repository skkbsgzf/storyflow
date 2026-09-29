// pi-agent 对话流运行时（2026-09-22 用户需求：flow/世界书旁的真 agent 会话）
// —— 会话持久化 + 工具环（miniflow 动词白名单 ∷ 项目文件系统 ∷ flow-lint ∷ MCP 内联）+ SSE 事件流。
//
// 纪律：
//  · 模型凭据只进 .external/（gitignore 收编，kakaxing 事故教训）——env 覆盖 > 配置文件，永不入 payload。
//  · 本 agent 不碰 run 状态（flow_run/submit/gate/rerun/overlay 不在白名单）——编排推进仍归人会话/内核；
//    它能读能说能改文件与提示词（skill_patch 走提案审批制），能查编排与证据。
//  · 工具结果截断入上下文（16KB/条），防对话膨胀把会话拖死。
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { Kernel, KernelError } from "./kernel.js";
import { VERBS, type VerbDef } from "./verbs.js";
import { AgentMcp } from "./agent-mcp.js";

// ── 模型配置（env > .external/agent-model.json）──────────────────────────────
export interface AgentModelConfig {
  baseUrl: string;
  model: string;
  apiKey?: string;
  maxTokens?: number;
  temperature?: number;
}

const EXTERNAL_MODEL_FILE = path.join(".external", "agent-model.json");

export function loadModelConfig(repoRoot: string): {
  cfg: AgentModelConfig | null;
  source: "env" | "file" | "none";
  keyMasked?: string;
} {
  const env = {
    baseUrl: process.env.MINIFLOW_AGENT_BASE_URL,
    model: process.env.MINIFLOW_AGENT_MODEL,
    apiKey: process.env.MINIFLOW_AGENT_KEY,
  };
  if (env.baseUrl && env.model) {
    const cfg: AgentModelConfig = { baseUrl: env.baseUrl, model: env.model, apiKey: env.apiKey };
    return { cfg, source: "env", keyMasked: maskKey(env.apiKey) };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(repoRoot, EXTERNAL_MODEL_FILE), "utf-8"));
    if (raw && raw.baseUrl && raw.model) {
      const cfg: AgentModelConfig = raw;
      return { cfg, source: "file", keyMasked: maskKey(cfg.apiKey) };
    }
  } catch { /* 未配置——诚实返回 none */ }
  return { cfg: null, source: "none" };
}

export function saveModelConfig(repoRoot: string, cfg: AgentModelConfig): void {
  const file = path.join(repoRoot, EXTERNAL_MODEL_FILE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2), "utf-8");
}

function maskKey(k?: string): string | undefined {
  if (!k) return undefined;
  return k.length <= 10 ? "***" : k.slice(0, 4) + "…" + k.slice(-4);
}

// ── 会话存储（projects/<id>/registry/agent-sessions/<sid>.json）──────────────
export interface AgentMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
  name?: string;
}

export interface AgentSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: AgentMessage[];
}

const sessionsDir = (projectDir: string) => path.join(projectDir, "registry", "agent-sessions");
const sessionFile = (projectDir: string, sid: string) => path.join(sessionsDir(projectDir), `${sid}.json`);
const now = () => new Date().toISOString().replace("T", " ").slice(0, 16);

function readSession(projectDir: string, sid: string): AgentSession {
  try {
    return JSON.parse(fs.readFileSync(sessionFile(projectDir, sid), "utf-8")) as AgentSession;
  } catch {
    throw new KernelError("NO_SESSION", 404, `会话不存在：${sid}`);
  }
}

function writeSession(projectDir: string, s: AgentSession): void {
  fs.mkdirSync(sessionsDir(projectDir), { recursive: true });
  s.updatedAt = now();
  fs.writeFileSync(sessionFile(projectDir, s.id), JSON.stringify(s, null, 1), "utf-8");
}

export function listSessions(projectDir: string): { id: string; title: string; updatedAt: string; turns: number }[] {
  const dir = sessionsDir(projectDir);
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")) as AgentSession;
      out.push({ id: s.id, title: s.title, updatedAt: s.updatedAt, turns: s.messages.filter((m) => m.role === "user").length });
    } catch { /* 坏文件跳过，不拖垮清单 */ }
  }
  return out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export function createSession(projectDir: string, title?: string): AgentSession {
  const sid = `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const s: AgentSession = { id: sid, title: title || "新会话", createdAt: now(), updatedAt: now(), messages: [] };
  writeSession(projectDir, s);
  return s;
}

export function getSession(projectDir: string, sid: string): AgentSession {
  return readSession(projectDir, sid);
}

export function deleteSession(projectDir: string, sid: string): void {
  try { fs.rmSync(sessionFile(projectDir, sid)); } catch { /* 幂等 */ }
}

export function renameSession(projectDir: string, sid: string, title: string): AgentSession {
  const s = readSession(projectDir, sid);
  s.title = title.slice(0, 60) || s.title;
  writeSession(projectDir, s);
  return s;
}

// ── 工具集：miniflow 动词白名单 + 项目文件系统 + flow-lint + MCP 内联 ─────────
export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  exec: (args: Record<string, unknown>) => Promise<string>;
}

// P0 宿主解禁（09-23 甲方批准，docs/排期-pi-agent原生workflow运行时）：run 状态动词进环，
// pi-agent 从旁读 agent 升格为 workflow 原生宿主。护栏：
//   · flow_submit 走内核本体（完整性校验+收据随动词走，无旁路）；
//   · **flow_gate 不进环**——门与 kit 边界的裁决是人的动词（铁律 6：机器不得代裁），
//     flow_next 返回 gate/manual 时本 agent 只能停下并推人裁卡片；
//   · set_decision 维持禁入（决策登记面不在 agent 职责内）。
const AGENT_VERBS = new Set([
  "flow_list", "flow_next", "flow_effect", "flow_mine", "flow_optimize", "flow_init",
  "flow_run", "flow_resume", "flow_submit", "flow_rerun", "flow_overlay",
  "cfg_template", "list_decisions", "worldbook_search", "whereami", "quality_scan", "skill_patch",
  // 立意图（方案盘 20260924）：agent 只读图 + 提案（ig_propose 带 scorer 纪律）；
  // ig_commit/ig_exclude/ig_sync 是拍板与执行，归人/主会话——同 set_decision 禁入逻辑
  "ig_load", "ig_propose",
]);

const TOOL_RESULT_CAP = 16_000;

function verbTools(kernel: Kernel): AgentTool[] {
  const out: AgentTool[] = [];
  for (const v of VERBS as VerbDef[]) {
    if (!AGENT_VERBS.has(v.name)) continue;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const p of v.params) {
      const t = p.type === "number" ? "number" : p.type === "boolean" ? "boolean" : p.type === "record" || p.type === "string[]" ? "object" : "string";
      properties[p.name] = { type: t, description: p.desc };
      if (p.required) required.push(p.name);
    }
    out.push({
      name: "mf_" + v.name,
      description: `[miniflow ${v.name}] ${v.description}`,
      parameters: { type: "object", properties, required },
      exec: async (args) => {
        const r = await v.run(kernel, args);
        return String(JSON.stringify(r, null, 1)).slice(0, TOOL_RESULT_CAP);
      },
    });
  }
  return out;
}

const withinProject = (projectDir: string, rel: string): string => {
  const abs = path.resolve(projectDir, rel);
  if (!abs.startsWith(path.resolve(projectDir) + path.sep) && abs !== path.resolve(projectDir)) {
    throw new KernelError("INVALID_INPUT", 400, `路径越出项目：${rel}`);
  }
  return abs;
};

function fsTools(projectDir: string): AgentTool[] {
  const IGNORE = new Set(["node_modules", ".git", "snapshots"]);
  return [
    {
      name: "fs_tree",
      description: "[项目文件系统] 目录树（两层，含各目录文件数）——感知项目里有什么",
      parameters: { type: "object", properties: {} },
      exec: async () => {
        const lines: string[] = [];
        const walk = (dir: string, depth: number) => {
          if (depth > 2) return;
          let items: string[] = [];
          try { items = fs.readdirSync(dir).filter((x) => !IGNORE.has(x) && !x.startsWith(".")); } catch { return; }
          for (const it of items.sort()) {
            const abs = path.join(dir, it);
            if (fs.statSync(abs).isDirectory()) {
              const cnt = (() => { try { return fs.readdirSync(abs).length; } catch { return 0; } })();
              lines.push(`${"  ".repeat(depth)}${it}/ (${cnt})`);
              walk(abs, depth + 1);
            } else {
              lines.push(`${"  ".repeat(depth)}${it} (${Math.round(fs.statSync(abs).size / 1024)}KB)`);
            }
          }
        };
        walk(projectDir, 0);
        return lines.join("\n").slice(0, TOOL_RESULT_CAP) || "(空项目)";
      },
    },
    {
      name: "fs_read",
      description: "[项目文件系统] 读文件（项目内相对路径；越界拒绝）",
      parameters: { type: "object", properties: { path: { type: "string", description: "项目内相对路径，如 flows/../02-编剧/剧本.md 或 state.json" } }, required: ["path"] },
      exec: async (a) => {
        const abs = withinProject(projectDir, String(a.path));
        const txt = fs.readFileSync(abs, "utf-8");
        return txt.length > TOOL_RESULT_CAP ? txt.slice(0, TOOL_RESULT_CAP) + `\n…(截断，全长 ${txt.length} 字符)` : txt;
      },
    },
    {
      name: "fs_write",
      description: "[项目文件系统] 写文件（项目内相对路径；改 flow.json 后须提醒用户跑 flow_effect 生效）",
      parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] },
      exec: async (a) => {
        const abs = withinProject(projectDir, String(a.path));
        const content = String(a.content ?? "");
        if (content.length > 512_000) throw new KernelError("INVALID_INPUT", 400, "内容超 500KB，拒绝一次写入");
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content, "utf-8");
        return `已写入 ${a.path}（${content.length} 字符）`;
      },
    },
    {
      name: "fs_grep",
      description: "[项目文件系统] 正则搜索项目文本文件（跳过二进制与 snapshots/）",
      parameters: { type: "object", properties: { pattern: { type: "string", description: "正则表达式" } }, required: ["pattern"] },
      exec: async (a) => {
        const re = new RegExp(String(a.pattern));
        const hits: string[] = [];
        const walk = (dir: string) => {
          if (hits.length >= 60) return;
          for (const it of fs.readdirSync(dir).sort()) {
            if (hits.length >= 60) return;
            if (IGNORE.has(it) || it.startsWith(".")) continue;
            const abs = path.join(dir, it);
            const st = fs.statSync(abs);
            if (st.isDirectory()) { walk(abs); continue; }
            if (st.size > 400_000) continue;
            try {
              const txt = fs.readFileSync(abs, "utf-8");
              txt.split("\n").forEach((line, idx) => {
                if (hits.length < 60 && re.test(line)) hits.push(`${path.relative(projectDir, abs)}:${idx + 1}: ${line.trim().slice(0, 160)}`);
              });
            } catch { /* 二进制/解码失败跳过 */ }
          }
        };
        walk(projectDir);
        return hits.join("\n") || "(无命中)";
      },
    },
    {
      name: "flow_lint",
      description: "[flow 守门] 跑 python tools/flow-lint.py --json（改过 flows/*/flow.json 后必跑）",
      parameters: { type: "object", properties: { flow: { type: "string", description: "flow id（缺省全量）" } } },
      exec: async (a) => {
        const repoRoot = path.resolve(projectDir, "..", "..");
        const args = ["tools/flow-lint.py"];
        if (a.flow) args.push(String(a.flow));
        args.push("--json");
        return await new Promise<string>((resolve) => {
          execFile("python", args, { cwd: repoRoot, timeout: 90_000, maxBuffer: 4 << 20 }, (err, stdout, stderr) => {
            if (err && !stdout) resolve(`flow-lint 执行失败: ${err.message}\n${stderr.slice(0, 2000)}`);
            else resolve(String(stdout).slice(0, TOOL_RESULT_CAP) || `exit=${err?.code ?? 0}`);
          });
        });
      },
    },
  ];
}

export async function buildTools(kernel: Kernel, projectId: string, mcp: AgentMcp): Promise<AgentTool[]> {
  const projectDir = kernel.projectDir(projectId);
  const tools = [...verbTools(kernel), ...fsTools(projectDir)];
  try {
    const mcpDefs = await mcp.tools(kernel.repoRoot);
    tools.push(...mcpDefs.map((d) => ({
      name: d.name,
      description: d.description,
      parameters: d.parameters,
      exec: async (args: Record<string, unknown>) => {
        const r = await mcp.call(kernel.repoRoot, d.server, d.tool, args);
        return String(JSON.stringify(r, null, 1)).slice(0, TOOL_RESULT_CAP);
      },
    })));
  } catch (e) {
    tools.push({
      name: "mcp_unavailable",
      description: `MCP 内联当前不可用（${(e as Error).message}）——检查 .external/agent-mcp.json`,
      parameters: { type: "object", properties: {} },
      exec: async () => "MCP 不可用",
    });
  }
  return tools;
}

// ── 系统提示（项目语境 + 纪律）───────────────────────────────────────────────
export function buildSystemPrompt(kernel: Kernel, projectId: string): string {
  const projectDir = kernel.projectDir(projectId);
  let stateLine = "（无 state.json——项目未开跑）";
  let flowId = "";
  try {
    const st = JSON.parse(fs.readFileSync(path.join(projectDir, "state.json"), "utf-8"));
    flowId = st.flowId || "";
    const nodes = Object.entries(st.nodes || {});
    const done = nodes.filter(([, v]) => (v as { status?: string }).status === "done").length;
    const awaiting = nodes.filter(([, v]) => ["awaiting", "awaiting_input"].includes((v as { status?: string }).status || "")).map(([k]) => k);
    stateLine = `flow=${flowId} 状态=${st.status} 节点 ${done}/${nodes.length} 完成${awaiting.length ? `，待决：${awaiting.join("、")}` : ""}`;
  } catch { /* 未开跑 */ }
  let wbLine = "无世界书";
  try {
    const g = JSON.parse(fs.readFileSync(path.join(projectDir, "世界书", "graph.json"), "utf-8"));
    wbLine = `世界书 ${g.stats?.entries ?? 0} 词条 / ${g.stats?.edges ?? 0} 关系边`;
  } catch { /* 无 */ }
  return [
    `你是 storyflow 工作台的 pi-agent：创作生产线的随行工程师。项目 ${projectId}${flowId ? `（${flowId}）` : ""}。`,
    `当前盘面：${stateLine}；${wbLine}。`,
    `你的能力：①miniflow 工具（mf_ 前缀）查编排/证据/决策/世界书（worldbook_search 是 GraphHyperRAG 检索，创作前先查设定口径）；`,
    `②项目文件系统（fs_ 前缀）感知与读写——flow.json、skills/../提示词、产物都在盘上；`,
    `③MCP 内联工具（mcp__ 前缀，若已配置 .external/agent-mcp.json）。`,
    `纪律：改 flows/*/flow.json 后必须跑 flow_lint 并提醒用户跑 flow_effect 生效；改提示词走 mf_skill_patch（提案制，人批准）；`,
    `不要伪造盘上不存在的东西——先 fs_read 再下结论；回答用中文；长输出先给结论再给细节。`,
  ].join("\n");
}

// ── 回合循环（SSE 事件流）────────────────────────────────────────────────────
/** 分析手法工具（曲线/人物）：方法论卡自 knowledge/ 动态装载，嵌套补全产结构化 JSON。 */
function analysisTools(cfg: AgentModelConfig, projectDir: string, repoRoot: string): AgentTool[] {
  const readIn = (rel: string): string => {
    const abs = path.resolve(projectDir, rel);
    if (!abs.startsWith(path.resolve(projectDir) + path.sep) && abs !== path.resolve(projectDir)) {
      throw new KernelError("INVALID_INPUT", 400, `路径越出项目：${rel}`);
    }
    return fs.readFileSync(abs, "utf-8");
  };
  const readCard = (id: string): string => {
    const p = path.join(repoRoot, "knowledge", id.replace(/^kb\//, "") + ".md");
    return fs.readFileSync(p, "utf-8");
  };
  const chatOnce = async (prompt: string): Promise<string> => {
    const url = cfg.baseUrl.replace(/\/$/, "") + "/chat/completions";
    const resp = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}) },
      body: JSON.stringify({ model: cfg.model, messages: [
        { role: "system", content: "你是结构化分析器：只输出一个合法 JSON 对象，不加解释、不加代码围栏。" },
        { role: "user", content: prompt },
      ], max_tokens: 6000 }),
    });
    if (!resp.ok) throw new Error(`分析补全 HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
    const j = await resp.json() as { choices?: { message?: { content?: string; reasoning_content?: string } }[] };
    const msg = j.choices?.[0]?.message;
    // 推理模型可能把输出全放进 reasoning_content（finish=length 时 content 为空）——兜底取之
    const text = (msg?.content ?? "").trim() || (msg?.reasoning_content ?? "").trim();
    if (!text) throw new Error(`分析补全空输出（HTTP ${resp.status}）`);
    return text;
  };
  const mk = (name: string, label: string, desc: string, props: Record<string, unknown>, build: (args: Record<string, unknown>) => Promise<string>): AgentTool => ({
    name,
    description: `[分析手法] ${desc}（方法论卡自 knowledge/ 动态装载）`,
    parameters: { type: "object", properties: props, required: Object.keys(props).filter((k) => k !== "text" && k !== "names") },
    exec: async (args) => build(args),
  });
  return [
    mk("mf_analyze_curve", "剧情曲线分析", "按 emotion-curve 六型判别卡分析正文，输出曲线主型/逐段张力/失衡条款/换轨建议 JSON",
      { path: { type: "string", description: "项目内正文路径" }, text: { type: "string", description: "直接传正文（与 path 二选一）" } },
      async (args) => {
        const text = typeof args.text === "string" && args.text.trim() ? args.text : readIn(String(args.path ?? ""));
        const card = readCard("kb/aesthetic/emotion-curve");
        return await chatOnce(`你是剧情曲线分析师。严格按以下方法论卡执行六型判别与失衡扫描：

${card}

【待分析正文】
${text.slice(0, 24000)}

输出 JSON：{"curve_type":"六型之一","confidence":"high|medium|low","segments":[{"range":"…","tension":1-10,"note":"…"}],"violations":[{"clause":"…","level":"major|minor","note":"…"}],"suggestions":["换轨建议（必须含前2拍铺垫代价）"]}`);
      }),
    mk("mf_analyze_character", "人物塑造分析", "按 character 卡三维与弧线评估人物塑造，附出场统计",
      { path: { type: "string", description: "项目内正文路径" }, text: { type: "string" }, names: { type: "string", description: "逗号分隔人物名单" } },
      async (args) => {
        const text = typeof args.text === "string" && args.text.trim() ? args.text : readIn(String(args.path ?? ""));
        const names = typeof args.names === "string" ? args.names.split(/[,，]/).map((x) => x.trim()).filter(Boolean) : [];
        const card = readCard("kb/aesthetic/character");
        const stats = names.map((n) => ({ name: n, mentions: (text.match(new RegExp(n, "g")) ?? []).length }));
        return await chatOnce(`你是人物塑造分析师。严格按以下方法论卡执行三维与弧线评估：

${card}

【人物名单】${JSON.stringify(names)}
【出场统计】${JSON.stringify(stats)}
【正文】
${text.slice(0, 24000)}

输出 JSON：{"characters":[{"name":"…","dimensions":{"欲望":"…","对抗":"…","真相":"…"},"arc":"…","score":1-10,"risk":"…"}],"relationships":[{"pair":"A-B","note":"…"}]}`);
      }),
  ];
}

export type AgentEvent =
  | { type: "delta"; text: string }
  | { type: "thinking_delta"; text: string }
  | { type: "tool_call"; id: string; name: string; args: string }
  | { type: "tool_result"; id: string; name: string; ok: boolean; content: string }
  | { type: "round"; n: number }
  | { type: "done"; text: string }
  | { type: "error"; message: string };

const MAX_ROUNDS = 10;

interface ChatChoiceDelta {
  delta?: { content?: string | null; reasoning_content?: string | null; tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[] };
  finish_reason?: string | null;
}

/** 单回合：用户一句话 → LLM 工具环 → 终稿。事件逐个 yield 给 SSE 层。 */
export async function* runTurn(
  kernel: Kernel,
  projectId: string,
  sid: string,
  userText: string,
  mcp: AgentMcp,
): AsyncGenerator<AgentEvent> {
  const repoRoot = kernel.repoRoot;
  const { cfg } = loadModelConfig(repoRoot);
  const projectDir = kernel.projectDir(projectId);
  if (!cfg) {
    yield {
      type: "error",
      message: "未配置 agent 模型——在 .external/agent-model.json 写 {baseUrl, model, apiKey}（或设 MINIFLOW_AGENT_BASE_URL/MODEL/KEY 环境变量）。任何 OpenAI 兼容端点均可（如 Z.ai GLM）。",
    };
    return;
  }
  const session = readSession(projectDir, sid);
  const trimmed = String(userText ?? "").trim();
  if (!trimmed) { yield { type: "error", message: "空消息" }; return; }
  if (session.messages.length === 0) session.title = trimmed.slice(0, 24);
  session.messages.push({ role: "user", content: trimmed });

  const tools = [
    ...await buildTools(kernel, projectId, mcp),
    ...analysisTools(cfg, projectDir, repoRoot),
  ];
  const llmTools = tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
  const systemMsg: AgentMessage = { role: "system", content: buildSystemPrompt(kernel, projectId) };
  const url = cfg.baseUrl.replace(/\/$/, "") + "/chat/completions";

  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      yield { type: "round", n: round + 1 };
      const resp = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}) },
        // wire 消息每轮从会话重建（system + 全历史含工具结果）——上一轮的工具结果必须让 LLM 看见
        body: JSON.stringify({ model: cfg.model, messages: [systemMsg, ...session.messages], tools: llmTools, stream: true, ...(cfg.maxTokens ? { max_tokens: cfg.maxTokens } : {}), ...(cfg.temperature !== undefined ? { temperature: cfg.temperature } : {}) }),
      });
      if (!resp.ok || !resp.body) {
        const body = await resp.text().catch(() => "");
        yield { type: "error", message: `模型端点 ${resp.status}：${body.slice(0, 400) || "无响应体"}` };
        writeSession(projectDir, session);
        return;
      }
      // 解析上游 SSE：累积正文与工具调用
      let content = "";
      const calls: Record<number, { id: string; name: string; arguments: string }> = {};
      const decoder = new TextDecoder();
      let buf = "";
      for await (const chunk of resp.body) {
        buf += decoder.decode(chunk as unknown as Uint8Array, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          for (const line of frame.split("\n")) {
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (!data || data === "[DONE]") continue;
            try {
              const j = JSON.parse(data) as { choices?: ChatChoiceDelta[] };
              const d = j.choices?.[0]?.delta;
              if (!d) continue;
              if (d.content) { content += d.content; yield { type: "delta", text: d.content }; }
              // 思维链增量（GLM reasoning_content 等）：前端折叠展示，不进会话历史
              if (d.reasoning_content) yield { type: "thinking_delta", text: d.reasoning_content };
              for (const tc of d.tool_calls ?? []) {
                const i = tc.index ?? 0;
                calls[i] = calls[i] || { id: tc.id || `call_${i}_${round}`, name: "", arguments: "" };
                if (tc.id) calls[i].id = tc.id;
                if (tc.function?.name) calls[i].name += tc.function.name;
                if (tc.function?.arguments) calls[i].arguments += tc.function.arguments;
              }
            } catch { /* 非 JSON 帧跳过 */ }
          }
        }
      }
      const callList = Object.keys(calls).sort((a, b) => Number(a) - Number(b)).map((k) => calls[Number(k)]);

      if (!callList.length) {
        session.messages.push({ role: "assistant", content });
        writeSession(projectDir, session);
        yield { type: "done", text: content };
        return;
      }
      session.messages.push({ role: "assistant", content, tool_calls: callList.map((c) => ({ id: c.id, type: "function" as const, function: { name: c.name, arguments: c.arguments || "{}" } })) });
      for (const c of callList) {
        yield { type: "tool_call", id: c.id, name: c.name, args: c.arguments || "{}" };
        const tool = tools.find((t) => t.name === c.name);
        let result: string;
        let ok = true;
        if (!tool) { result = `未知工具 ${c.name}`; ok = false; }
        else {
          try {
            const args = c.arguments ? (JSON.parse(c.arguments) as Record<string, unknown>) : {};
            result = await tool.exec(args);
          } catch (e) {
            result = `工具执行失败: ${(e as Error).message}`;
            ok = false;
          }
        }
        if (result.length > TOOL_RESULT_CAP) result = result.slice(0, TOOL_RESULT_CAP) + "…(截断)";
        yield { type: "tool_result", id: c.id, name: c.name, ok, content: result.slice(0, 800) };
        session.messages.push({ role: "tool", tool_call_id: c.id, name: c.name, content: result });
      }
      writeSession(projectDir, session); // 每轮落盘——流崩不丢上下文
    }
    yield { type: "error", message: `超过 ${MAX_ROUNDS} 轮工具调用仍未收敛——请拆小问题` };
    writeSession(projectDir, session);
  } catch (e) {
    yield { type: "error", message: `agent 回合失败: ${(e as Error).message}（检查模型端点/密钥/网络）` };
    writeSession(projectDir, session);
  }
}

/** MCP 管理器单例（随 HTTP 面存活；按 .external/agent-mcp.json 惰性连接）。 */
export const agentMcp = new AgentMcp();
