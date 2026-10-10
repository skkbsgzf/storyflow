// pi-agent 对话流运行时（2026-09-22 用户需求：flow/世界书旁的真 agent 会话）
// —— 会话持久化 + 工具环（miniflow 动词白名单 ∷ 项目文件系统 ∷ flow-lint ∷ MCP 内联）+ SSE 事件流。
//
// 纪律：
//  · 模型凭据只进 .external/（gitignore 收编，kakaxing 事故教训）——env 覆盖 > 配置文件，永不入 payload。
//  · 本 agent 不碰 run 状态（flow_run/submit/gate/rerun/overlay 不在白名单）——编排推进仍归人会话/内核；
//    它能读能说能改文件与提示词（skill_patch 走提案审批制），能查编排与证据。
//  · 工具结果截断入上下文（16KB/条），防对话膨胀把会话拖死。
import { Kernel, KernelError } from "./kernel.js";
import { VERBS, type VerbDef } from "./verbs.js";
import { nodeEnv } from "./abstraction/defaults.js";
import type { IFileSystem } from "./abstraction/fs.js";
import type { JournalEventKind } from "./types.js";
import { AgentMcp } from "./agent-mcp.js";

// ── 模型配置（env > .external/agent-model.json）──────────────────────────────
export interface AgentModelConfig {
  baseUrl: string;
  model: string;
  apiKey?: string;
  maxTokens?: number;
  temperature?: number;
}

// 模块级不许碰 node:path：相对定位串就地写死，拼接交给注入的 kernel.path
const EXTERNAL_MODEL_FILE = ".external/agent-model.json";

export function loadModelConfig(kernel: Kernel): {
  cfg: AgentModelConfig | null;
  source: "env" | "file" | "none";
  keyMasked?: string;
} {
  const env = {
    baseUrl: nodeEnv.get("MINIFLOW_AGENT_BASE_URL"),
    model: nodeEnv.get("MINIFLOW_AGENT_MODEL"),
    apiKey: nodeEnv.get("MINIFLOW_AGENT_KEY"),
  };
  if (env.baseUrl && env.model) {
    const cfg: AgentModelConfig = { baseUrl: env.baseUrl, model: env.model, apiKey: env.apiKey };
    return { cfg, source: "env", keyMasked: maskKey(env.apiKey) };
  }
  try {
    const raw = JSON.parse(kernel.fs.readText(kernel.path.join(kernel.repoRoot, EXTERNAL_MODEL_FILE)));
    if (raw && raw.baseUrl && raw.model) {
      const cfg: AgentModelConfig = raw;
      return { cfg, source: "file", keyMasked: maskKey(cfg.apiKey) };
    }
  } catch { /* 未配置——诚实返回 none */ }
  return { cfg: null, source: "none" };
}

export function saveModelConfig(kernel: Kernel, cfg: AgentModelConfig): void {
  const file = kernel.path.join(kernel.repoRoot, EXTERNAL_MODEL_FILE);
  kernel.fs.mkdir(kernel.path.dirname(file), { recursive: true });
  kernel.fs.writeText(file, JSON.stringify(cfg, null, 2));
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

const sessionsDir = (kernel: Kernel, projectDir: string) => kernel.path.join(projectDir, "registry", "agent-sessions");
const sessionFile = (kernel: Kernel, projectDir: string, sid: string) => kernel.path.join(sessionsDir(kernel, projectDir), `${sid}.json`);
const now = () => new Date().toISOString().replace("T", " ").slice(0, 16);

function readSession(kernel: Kernel, projectDir: string, sid: string): AgentSession {
  try {
    return JSON.parse(kernel.fs.readText(sessionFile(kernel, projectDir, sid))) as AgentSession;
  } catch {
    throw new KernelError("NO_SESSION", 404, `会话不存在：${sid}`);
  }
}

function writeSession(kernel: Kernel, projectDir: string, s: AgentSession): void {
  kernel.fs.mkdir(sessionsDir(kernel, projectDir), { recursive: true });
  s.updatedAt = now();
  kernel.fs.writeText(sessionFile(kernel, projectDir, s.id), JSON.stringify(s, null, 1));
}

export function listSessions(kernel: Kernel, projectId: string): { id: string; title: string; updatedAt: string; turns: number }[] {
  const dir = sessionsDir(kernel, kernel.projectDir(projectId));
  if (!kernel.fs.exists(dir)) return [];
  const out = [];
  for (const f of kernel.fs.readDir(dir).filter((x) => x.endsWith(".json")).sort()) {
    try {
      const s = JSON.parse(kernel.fs.readText(kernel.path.join(dir, f))) as AgentSession;
      out.push({ id: s.id, title: s.title, updatedAt: s.updatedAt, turns: s.messages.filter((m) => m.role === "user").length });
    } catch { /* 坏文件跳过，不拖垮清单 */ }
  }
  return out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export function createSession(kernel: Kernel, projectId: string, title?: string): AgentSession {
  const sid = `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const s: AgentSession = { id: sid, title: title || "新会话", createdAt: now(), updatedAt: now(), messages: [] };
  writeSession(kernel, kernel.projectDir(projectId), s);
  return s;
}

export function getSession(kernel: Kernel, projectId: string, sid: string): AgentSession {
  return readSession(kernel, kernel.projectDir(projectId), sid);
}

export function deleteSession(kernel: Kernel, projectId: string, sid: string): void {
  kernel.fs.remove(sessionFile(kernel, kernel.projectDir(projectId), sid), { force: true });
}

export function renameSession(kernel: Kernel, projectId: string, sid: string, title: string): AgentSession {
  const s = readSession(kernel, kernel.projectDir(projectId), sid);
  s.title = title.slice(0, 60) || s.title;
  writeSession(kernel, kernel.projectDir(projectId), s);
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

const withinProject = (kernel: Kernel, projectDir: string, rel: string): string => {
  const abs = kernel.path.resolve(projectDir, rel);
  if (!abs.startsWith(kernel.path.resolve(projectDir) + kernel.path.sep) && abs !== kernel.path.resolve(projectDir)) {
    throw new KernelError("INVALID_INPUT", 400, `路径越出项目：${rel}`);
  }
  return abs;
};

function fsTools(kernel: Kernel, projectDir: string): AgentTool[] {
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
          try { items = kernel.fs.readDir(dir).filter((x) => !IGNORE.has(x) && !x.startsWith(".")); } catch { return; }
          for (const it of items.sort()) {
            const abs = kernel.path.join(dir, it);
            if (kernel.fs.stat(abs)?.isDirectory) {
              const cnt = (() => { try { return kernel.fs.readDir(abs).length; } catch { return 0; } })();
              lines.push(`${"  ".repeat(depth)}${it}/ (${cnt})`);
              walk(abs, depth + 1);
            } else {
              lines.push(`${"  ".repeat(depth)}${it} (${Math.round((kernel.fs.stat(abs)?.size ?? 0) / 1024)}KB)`);
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
        const abs = withinProject(kernel, projectDir, String(a.path));
        const txt = kernel.fs.readText(abs);
        return txt.length > TOOL_RESULT_CAP ? txt.slice(0, TOOL_RESULT_CAP) + `\n…(截断，全长 ${txt.length} 字符)` : txt;
      },
    },
    {
      name: "fs_write",
      description: "[项目文件系统] 写文件（项目内相对路径；改 flow.json 后须提醒用户跑 flow_effect 生效）",
      parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] },
      exec: async (a) => {
        const abs = withinProject(kernel, projectDir, String(a.path));
        const content = String(a.content ?? "");
        if (content.length > 512_000) throw new KernelError("INVALID_INPUT", 400, "内容超 500KB，拒绝一次写入");
        kernel.fs.mkdir(kernel.path.dirname(abs), { recursive: true });
        kernel.fs.writeText(abs, content);
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
          for (const it of kernel.fs.readDir(dir).sort()) {
            if (hits.length >= 60) return;
            if (IGNORE.has(it) || it.startsWith(".")) continue;
            const abs = kernel.path.join(dir, it);
            const st = kernel.fs.stat(abs);
            if (!st) continue;
            if (st.isDirectory) { walk(abs); continue; }
            if (st.size > 400_000) continue;
            try {
              const txt = kernel.fs.readText(abs);
              txt.split("\n").forEach((line, idx) => {
                if (hits.length < 60 && re.test(line)) hits.push(`${kernel.path.relative(projectDir, abs)}:${idx + 1}: ${line.trim().slice(0, 160)}`);
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
        // cwd 取 kernel.repoRoot：旧写法是 projectDir 上跳两级——默认盘面（root === repoRoot）同值，
        // 而分离数据根的宿主上只有 repoRoot 才有 tools/flow-lint.py
        const args = ["tools/flow-lint.py"];
        if (a.flow) args.push(String(a.flow));
        args.push("--json");
        const r = await kernel.proc.runAsync("python", args, {
          cwd: kernel.repoRoot,
          timeoutMs: 90_000,
          maxBufferBytes: 4 << 20,
        });
        // 三分支照旧：起不动（原 err.message）／退出非零且无输出（原把 stderr 一并端出来，别缩成干巴巴的 exit=1）／有输出（截断）
        if (r.error && !r.stdout) return `flow-lint 执行失败: ${r.error}\n${r.stderr.slice(0, 2000)}`;
        if (!r.stdout && r.status) return `flow-lint 退出码 ${r.status}（无输出）\n${r.stderr.slice(0, 2000)}`;
        return r.stdout.slice(0, TOOL_RESULT_CAP) || "exit=0";
      },
    },
  ];
}

export async function buildTools(kernel: Kernel, projectId: string, mcp: AgentMcp): Promise<AgentTool[]> {
  const projectDir = kernel.projectDir(projectId);
  const tools = [...verbTools(kernel), ...fsTools(kernel, projectDir)];
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
      description: `MCP 内联当前不可用（${e instanceof Error ? e.message : String(e)}）——检查 .external/agent-mcp.json`,
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
    const st = JSON.parse(kernel.fs.readText(kernel.path.join(projectDir, "state.json")));
    flowId = st.flowId || "";
    const nodes = Object.entries(st.nodes || {});
    const done = nodes.filter(([, v]) => (v as { status?: string }).status === "done").length;
    const awaiting = nodes.filter(([, v]) => ["awaiting", "awaiting_input"].includes((v as { status?: string }).status || "")).map(([k]) => k);
    stateLine = `flow=${flowId} 状态=${st.status} 节点 ${done}/${nodes.length} 完成${awaiting.length ? `，待决：${awaiting.join("、")}` : ""}`;
  } catch { /* 未开跑 */ }
  let wbLine = "无世界书";
  try {
    const g = JSON.parse(kernel.fs.readText(kernel.path.join(projectDir, "世界书", "graph.json")));
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
/**
 * 卡驱动诊断 prompt 组装（R2.4 写诊改三相打通）：诊（条款判定）与建（修复建议）共用同一张卡，
 * 同源铁律（ARCHITECTURE §3.2）由结构保证——prompt 同时携带卡内条款与修复策略，并明示
 * 「suggestion 必须是所引条款 repair 的反向表达；无对应条款不得出建议」。输出 JSON 对齐
 * diagnosis-report@1（contracts/diagnosis-report.schema.json）的 items 语义字段位。
 * 纯函数：不碰网络与盘，便于测试对「诊与建同一来源」做结构断言。
 */
export function buildCardDiagnosisPrompt(cardId: string, cardText: string, text: string): string {
  return `你是写稿诊断器。严格按以下规则卡执行条款判定（诊），只报卡内条款、不发明卡外语义：

${cardText}

【待诊断正文】
${text.slice(0, 24000)}

输出 JSON（对齐 diagnosis-report@1 的 items 语义）：
{"items":[{"rule_ref":"<卡id>#<条款id>","tier":"S|A|B","severity":"block|major|minor","evidence":{"location":"…","quote":"…"},"suggestion":"…"}],"opinion":{"by":"<模型标识>","text":"卡外整体观感（仅供参考）"}}
字段纪律：
- rule_ref 必须指向卡内真实条款（kb/<域>/<名>#<条款 id>）；卡里没有的条款不得出条目。
- tier/severity 沿用卡内标注（frontmatter clauses 或条目前的【AE-id｜级别】），卡未标注时按卡头优先级语义判。
- evidence 只收可定位证据（位置+原文引用）；判 block/major 的条目必须给证据。
- suggestion 必须是所引条款修复策略（clauses[].repair / 卡文修复语义）的反向表达——同源铁律，禁止脱离条款重新建议；无修复策略的条款只出证据不出建议。
- 卡外整体观感只能进 opinion，不得混进 items；opinion 不是证据。`;
}

/**
 * 卡读取器（mf_analyze_card / mf_apply_repairs 共用）：kb 卡 id → 卡全文。
 * 显式报错不静默：卡驱动诊断/修订只吃真实在盘的 kb 卡（按盘上核账，双根纪律下卡在 repoRoot）。
 */
function mkReadCard(kernel: Kernel, repoRoot: string): (id: string) => string {
  return (id: string): string => {
    const p = kernel.path.join(repoRoot, "knowledge", id.replace(/^kb\//, "") + ".md");
    if (!kernel.fs.exists(p)) {
      throw new KernelError("CARD_NOT_FOUND", 404, `卡不存在：${id}（knowledge/ 盘上无 ${p}）——卡驱动工具只接受在盘 kb 卡 id`);
    }
    return kernel.fs.readText(p);
  };
}

/** 补全调用器（单轮 chat，OpenAI 兼容端点）：prompt → 模型文本。推理模型兜底取 reasoning_content。 */
function mkChatOnce(cfg: AgentModelConfig): (prompt: string) => Promise<string> {
  return async (prompt: string): Promise<string> => {
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
}

/**
 * 分析手法工具族（曲线/人物/通用卡驱动）：方法论卡自 knowledge/ 动态装载，嵌套补全产结构化 JSON。
 * R2.4 能力归并：一次性 mf_analyze_curve（prompt 骨架写死、只包一张 KB 卡）泛化为
 * mf_analyze_card（card 参数驱动，一张规则卡即一个诊断能力）；mf_analyze_curve 保留为薄别名
 * （协议面 storyharness/src/analysis.ts 与 docs/integration/sse-events.md 点名过该工具名，宿主可见面不断）。
 */
export function analysisTools(cfg: AgentModelConfig, kernel: Kernel, projectDir: string, repoRoot: string): AgentTool[] {
  // 越界判定收编到 withinProject 单点：原先这里抄了一份同逻辑的 resolve+sep 检查，
  // 两份判据正是「fs_read 拒了、mf_analyze_curve 放行」那类漂移的来源
  const readIn = (rel: string): string => kernel.fs.readText(withinProject(kernel, projectDir, rel));
  const readCard = mkReadCard(kernel, repoRoot);
  const chatOnce = mkChatOnce(cfg);
  const mk = (name: string, label: string, desc: string, props: Record<string, unknown>, build: (args: Record<string, unknown>) => Promise<string>, required?: string[]): AgentTool => ({
    name,
    description: `[分析手法] ${desc}（方法论卡自 knowledge/ 动态装载）`,
    parameters: { type: "object", properties: props, required: required ?? Object.keys(props).filter((k) => k !== "text" && k !== "names") },
    exec: async (args) => build(args),
  });
  // 通用卡驱动诊断体：card（kb 卡 id）+ path|text（正文）→ prompt 组装 → LLM 结构化 JSON
  const analyzeCard = async (args: Record<string, unknown>): Promise<string> => {
    const cardId = String(args.card ?? "").trim();
    if (!cardId) throw new KernelError("INVALID_INPUT", 400, "缺 card 参数（kb 卡 id，如 kb/rules/curve 或 kb/aesthetic/emotion-curve）");
    const text = typeof args.text === "string" && args.text.trim() ? args.text : readIn(String(args.path ?? ""));
    const card = readCard(cardId);
    return await chatOnce(buildCardDiagnosisPrompt(cardId, card, text));
  };
  return [
    mk("mf_analyze_card", "卡驱动诊断", "按任意 kb 卡（规则卡/方法论卡）分析正文：条款判定 + 同源修复建议 JSON（diagnosis-report@1 items 语义：rule_ref/tier/severity/evidence/suggestion）",
      {
        card: { type: "string", description: "kb 卡 id，如 kb/rules/curve（规则卡，条款+repair 同源）或 kb/aesthetic/emotion-curve（方法论卡）" },
        path: { type: "string", description: "项目内正文路径（与 text 二选一）" },
        text: { type: "string", description: "直接传正文（与 path 二选一）" },
      },
      analyzeCard, ["card"]),
    // 兼容别名（薄壳，内部调通用实现）：历史宿主/会话点名过 mf_analyze_curve，卡固定 emotion-curve，
    // 输出统一为诊断 items 语义（原曲线专档 JSON 形状由通用契约收编）
    mk("mf_analyze_curve", "剧情曲线分析", "mf_analyze_card 的曲线专档别名（card 固定 kb/aesthetic/emotion-curve）：六型判别 + 失衡条款 + 同源换轨建议 JSON",
      { path: { type: "string", description: "项目内正文路径" }, text: { type: "string", description: "直接传正文（与 path 二选一）" } },
      (args) => analyzeCard({ ...args, card: "kb/aesthetic/emotion-curve" })),
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

// ── 改相（批次2.5 P3）：修复策略驱动的修订产出 ──────────────────────────────
/**
 * 改相 prompt 组装（与 buildCardDiagnosisPrompt 同先例的纯函数）：按单条卡条款的修复策略（clauses[].repair）
 * 产修订。改相铁律全部压进 prompt：只改本条款所涉（不做顺手美化）、策略来自卡原文（同源铁律）、
 * 只出 unified diff（绝不整篇改写、绝不写盘——写盘归宿主 batch-edit，人裁）。
 */
export function buildCardRepairPrompt(
  ruleRef: string,
  clause: { rule_id: string; tier: string; detect?: string; judge?: string; repair: string },
  text: string,
): string {
  return `你是修订器。按以下规则卡条款的修复策略产出修订（改相）：

【条款】${ruleRef}（tier ${clause.tier}）
【检测目标】${clause.detect ?? "（卡未标注）"}
【判定逻辑】${clause.judge ?? "（卡未标注）"}
【修复策略】${clause.repair}

【目标正文】
${text.slice(0, 24000)}

只输出一个 JSON 对象：{"diff":"<unified diff 文本>"}
纪律（改相铁律）：
- 只修改本条款所涉内容，不做顺手美化、不动无关段落——改单是「诊→改」的承载，越界即违规。
- 修订必须落实上述修复策略（同源铁律：repair 是规则卡 clauses[].repair 原文，不得另行发明策略）。
- diff 用 unified 格式（含 ---/+++/@@ 行），绝不输出整篇改写文本；无可修订处输出 {"diff":""}。`;
}

/** 从卡全文解析 frontmatter clauses，取指定条款；卡面不合法或条款不存在都显式失败（不静默）。 */
function clauseFromCard(cardText: string, ruleRef: string): { rule_id: string; tier: string; detect?: string; judge?: string; repair: string } {
  const m = cardText.match(/^---\r?\n(.*?)\r?\n---\r?\n/s);
  if (!m) throw new KernelError("CARD_MALFORMED", 500, `卡面不合法（缺 JSON frontmatter）：${ruleRef.split("#")[0]}`);
  let fm: { clauses?: { rule_id: string; tier: string; detect?: string; judge?: string; repair?: string }[] };
  try {
    fm = JSON.parse(m[1] ?? "");
  } catch (e) {
    throw new KernelError("CARD_MALFORMED", 500, `卡 frontmatter 不是合法 JSON：${ruleRef.split("#")[0]}（${e instanceof Error ? e.message : String(e)}）`);
  }
  const clauseId = ruleRef.split("#")[1] ?? "";
  const c = (fm.clauses ?? []).find((x) => x.rule_id === clauseId);
  if (!c) throw new KernelError("CLAUSE_NOT_FOUND", 404, `条款不存在：${ruleRef}（卡内 clauses 无 rule_id=${clauseId}）——改单只接受卡上真实条款`);
  if (!c.repair) throw new KernelError("CLAUSE_NO_REPAIR", 409, `条款无修复策略：${ruleRef}（clauses[].repair 缺失）——没有 repair 的条款出不了改单，只能出诊断证据`);
  return c as { rule_id: string; tier: string; detect?: string; judge?: string; repair: string };
}

/** 从模型回复里取 unified diff：优先 JSON 的 diff 字段；兜底剥代码围栏后直接当 diff 文本。 */
function extractDiff(resp: string): string {
  const t = resp.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try {
    const j = JSON.parse(t) as { diff?: unknown };
    if (typeof j.diff === "string") return j.diff;
  } catch { /* 非 JSON——走兜底 */ }
  return /^(--- |\+\+\+ |@@ |diff --git )/m.test(t) ? t : "";
}

/**
 * 改相工具族（批次2.5 P3）：修复改单（repair-plan@1，contracts/repair-plan.schema.json）驱动的修订产出。
 * 与 mf_analyze_card 同模式（卡自 knowledge/ 盘上装载、LLM 走 chatOnce），但纪律更硬：
 *  · 只产 unified diff，**绝不写盘**——应用归宿主拿 diff 走 batch-edit/自家写盘面，人裁；回滚走 snapshots。
 *  · B 级条款进单显式拒绝（INVALID_INPUT，ARCHITECTURE §3.3：B 级绝不自动改稿）——schema tier 值域
 *    已不含 B，此处再拒一次是纵深防御（防 LLM 产出的改单绕过契约）。
 *  · 卡条款不存在显式失败（CARD_NOT_FOUND / CLAUSE_NOT_FOUND）；repair 与卡面不一致显式失败
 *    （同源铁律：改单不得发明卡外策略）。
 *  · 先全量静态校验、再逐条动 LLM——任何一条违规整单拒绝，不产生半截修订。
 */
export function repairTools(cfg: AgentModelConfig, kernel: Kernel, projectDir: string, repoRoot: string): AgentTool[] {
  const readIn = (rel: string): string => kernel.fs.readText(withinProject(kernel, projectDir, rel));
  const readCard = mkReadCard(kernel, repoRoot);
  const chatOnce = mkChatOnce(cfg);

  const applyRepairs = async (args: Record<string, unknown>): Promise<string> => {
    // 1. 载入改单：内联 JSON 文本或项目内 .json 路径（二相兼容，与 mf_analyze_card 的 path/text 风格一致）
    const raw = String(args.repair_plan ?? "").trim();
    if (!raw) throw new KernelError("INVALID_INPUT", 400, "缺 repair_plan 参数（改单 JSON 内联文本，或项目内改单文件相对路径）");
    const tryParse = (s: string): unknown => { try { return JSON.parse(s); } catch { return undefined; } };
    let plan = tryParse(raw);
    if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
      try { plan = tryParse(readIn(raw)); } catch { /* 路径读不到——落入下方统一报错 */ }
    }
    if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
      throw new KernelError("INVALID_INPUT", 400, `repair_plan 既不是合法 JSON 对象，也读不到项目内文件：${raw.slice(0, 120)}`);
    }
    const p = plan as { format?: unknown; project?: unknown; target?: unknown; diagnosis_ref?: unknown; items?: unknown };
    if (p.format !== "repair-plan@1") {
      throw new KernelError("INVALID_INPUT", 400, `改单 format 必须是 repair-plan@1（现为 ${String(p.format)}）——契约 contracts/repair-plan.schema.json`);
    }
    if (!Array.isArray(p.items) || p.items.length === 0) {
      throw new KernelError("INVALID_INPUT", 400, "改单 items 为空或缺失——至少一条修订才进得了改相");
    }
    const text = typeof args.text === "string" && args.text.trim() ? args.text : readIn(String(args.path ?? ""));

    // 2. 逐条静态校验（卡存在 / 条款存在 / B 级拒绝 / repair 同源）：先全量过闸，再动 LLM
    const resolved = p.items.map((it: unknown, i: number) => {
      const ruleRef = String((it as { rule_ref?: unknown })?.rule_ref ?? "").trim();
      const m = ruleRef.match(/^(kb\/rules\/[a-z0-9-]+)#(AE-[A-Z0-9-]+)$/);
      if (!m) {
        throw new KernelError("INVALID_INPUT", 400, `items[${i}].rule_ref 形状非法：${ruleRef || "（空）"}（须 kb/rules/<域>#<AE-id>，指向规则卡条款）`);
      }
      const clause = clauseFromCard(readCard(m[1] ?? ""), ruleRef);
      if (clause.tier === "B") {
        throw new KernelError("INVALID_INPUT", 400, `items[${i}].rule_ref=${ruleRef} 是 B 级条款——B 级主观审美绝不自动改稿（ARCHITECTURE §3.3），禁止入改单`);
      }
      const repair = String((it as { repair?: unknown })?.repair ?? "").trim();
      if (!repair) throw new KernelError("INVALID_INPUT", 400, `items[${i}].repair 缺失（须逐字取自卡内 clauses[].repair）`);
      if (repair !== clause.repair) {
        throw new KernelError("INVALID_INPUT", 400, `items[${i}].repair 与卡面不一致——同源铁律：改单不得发明卡外策略（卡 ${ruleRef} 的 repair 原文：「${clause.repair}」）`);
      }
      const tier = (it as { tier?: unknown }).tier;
      if (typeof tier === "string" && tier !== clause.tier) {
        throw new KernelError("INVALID_INPUT", 400, `items[${i}].tier=${tier} 与卡面标注（${clause.tier}）不一致——分级以卡为唯一真源`);
      }
      return { ruleRef, clause, target: (it as { target?: unknown }).target ?? null };
    });

    // 3. 逐条款产修订（每条款一次 LLM 调用），只回填 diff，不碰盘
    const outItems: Record<string, unknown>[] = [];
    for (const r of resolved) {
      const diff = extractDiff(await chatOnce(buildCardRepairPrompt(r.ruleRef, r.clause, text)));
      outItems.push({
        rule_ref: r.ruleRef, repair: r.clause.repair, tier: r.clause.tier,
        target: r.target, diff, status: "proposed", receipt: null,
      });
    }
    const nDiff = outItems.filter((x) => x.diff).length;
    return JSON.stringify({
      format: "repair-plan@1",
      project: String(p.project ?? ""),
      target: String(p.target ?? ""),
      diagnosis_ref: p.diagnosis_ref ?? null,
      items: outItems,
      summary: `改单骨架：${nDiff}/${outItems.length} 条产出 unified diff（status=proposed，diagnosis_ref=${String(p.diagnosis_ref ?? "null")}）。diff 只是提案不是稿：应用归宿主拿 diff 走 batch-edit/自家写盘面，人裁后用 tools/repair-apply.py status 推进并落收据；回滚走 snapshots。`,
    }, null, 1);
  };

  return [
    {
      name: "mf_apply_repairs",
      description: "[改相] 按修复改单（repair-plan@1）逐条款产出修订 unified diff：只产 diff 绝不写盘（写盘归宿主 batch-edit，人裁后应用；回滚走 snapshots）；B 级条款进单显式拒绝；卡条款不存在显式失败；repair 与卡面不一致显式失败（同源铁律）",
      parameters: {
        type: "object",
        properties: {
          repair_plan: { type: "string", description: "修复改单：内联 JSON 文本，或项目内改单文件相对路径（format=repair-plan@1，契约 contracts/repair-plan.schema.json）" },
          path: { type: "string", description: "项目内目标文本路径（与 text 二选一）" },
          text: { type: "string", description: "直接传目标文本（与 path 二选一）" },
        },
        required: ["repair_plan"],
      },
      exec: applyRepairs,
    },
  ];
}

export type AgentEvent =
  | { type: "delta"; text: string }
  | { type: "thinking_delta"; text: string }
  | { type: "tool_call"; id: string; name: string; args: string }
  | { type: "tool_result"; id: string; name: string; ok: boolean; content: string }
  | { type: "round"; n: number }
  | { type: "done"; text: string }
  | { type: "error"; message: string }
  // 项目级事件（工单 R5）：同一族类型、同一条线格式，由 `project-stream.ts` 从 journal 台账投影；
  // 对话流不发这五种，项目流不发上面七种。`event` 字段带回台账原 kind，投影不丢溯源。
  | { type: "node_start"; event: JournalEventKind; ts: string; nodeId?: string; detail?: string }
  | { type: "node_complete"; event: JournalEventKind; ts: string; nodeId?: string; detail?: string; refs?: string[] }
  | { type: "node_error"; event: JournalEventKind; ts: string; nodeId?: string; detail?: string }
  | { type: "gate_pending"; event: JournalEventKind; ts: string; nodeId?: string; detail?: string }
  | { type: "heartbeat"; ts: string };

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
  const { cfg } = loadModelConfig(kernel);
  const projectDir = kernel.projectDir(projectId);
  if (!cfg) {
    yield {
      type: "error",
      message: "未配置 agent 模型——在 .external/agent-model.json 写 {baseUrl, model, apiKey}（或设 MINIFLOW_AGENT_BASE_URL/MODEL/KEY 环境变量）。任何 OpenAI 兼容端点均可（如 Z.ai GLM）。",
    };
    return;
  }
  const session = readSession(kernel, projectDir, sid);
  const trimmed = String(userText ?? "").trim();
  if (!trimmed) { yield { type: "error", message: "空消息" }; return; }
  if (session.messages.length === 0) session.title = trimmed.slice(0, 24);
  session.messages.push({ role: "user", content: trimmed });

  const tools = [
    ...await buildTools(kernel, projectId, mcp),
    ...analysisTools(cfg, kernel, projectDir, repoRoot),
    ...repairTools(cfg, kernel, projectDir, repoRoot),
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
        writeSession(kernel, projectDir, session);
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
      const callList = Object.keys(calls).sort((a, b) => Number(a) - Number(b)).flatMap((k) => calls[Number(k)] ?? []);

      if (!callList.length) {
        session.messages.push({ role: "assistant", content });
        writeSession(kernel, projectDir, session);
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
            result = `工具执行失败: ${e instanceof Error ? e.message : String(e)}`;
            ok = false;
          }
        }
        if (result.length > TOOL_RESULT_CAP) result = result.slice(0, TOOL_RESULT_CAP) + "…(截断)";
        yield { type: "tool_result", id: c.id, name: c.name, ok, content: result.slice(0, 800) };
        session.messages.push({ role: "tool", tool_call_id: c.id, name: c.name, content: result });
      }
      writeSession(kernel, projectDir, session); // 每轮落盘——流崩不丢上下文
    }
    yield { type: "error", message: `超过 ${MAX_ROUNDS} 轮工具调用仍未收敛——请拆小问题` };
    writeSession(kernel, projectDir, session);
  } catch (e) {
    yield { type: "error", message: `agent 回合失败: ${e instanceof Error ? e.message : String(e)}（检查模型端点/密钥/网络）` };
    writeSession(kernel, projectDir, session);
  }
}

/**
 * MCP 管理器按「注入的盘」分桶（R6）。连接是进程级态，跨请求复用；但「配置从哪张盘读」必须跟着内核走——
 * 原来的模块级单例固定吃 Node 适配器，注入盘（内存盘/浏览器虚拟盘）的宿主会在这一处悄悄回到宿主盘，
 * 这正是 §四.3 禁的半抽象。默认 Node 适配器只有一位桶客 ⇒ 现网 HTTP 面的行为逐字节不变。
 */
const mcpBuckets = new WeakMap<IFileSystem, AgentMcp>();

export function mcpFor(kernel: Kernel): AgentMcp {
  let mcp = mcpBuckets.get(kernel.fs);
  if (!mcp) {
    mcp = new AgentMcp({ fs: kernel.fs, path: kernel.path });
    mcpBuckets.set(kernel.fs, mcp);
  }
  return mcp;
}
