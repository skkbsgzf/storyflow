/**
 * flow-export 引擎桥 —— 生效编排 → 外部可消费形态（runbook / mermaid / json）。
 *
 * 定位（外部协议适配器）：把 flow@3 / 生效编排导出成「任何 agent、任何引擎都能
 * 原生读懂」的只读快照——markdown 运行手册、mermaid 图、中性 JSON。回答的是
 * 「外部世界怎么吃我们的编排」，不是「我们怎么吃外部编排」（后者 = MCP 面）。
 *
 * 单源纪律（R5 §一）：展开与 overlay 合成一律复用内核真身——
 *   项目面 = Kernel::effectiveOf（flow.json ⊕ 出厂 overlay ⊕ 配置预算层 ⊕ 项目 overlay ⊕ 派生）；
 *   模板面 = effectiveFlow3（同一套派生，无项目层）。
 * 本文件只做「取数 + 渲染」，TS/Python 任何一侧都禁止重写派生逻辑。
 *
 * 用法：
 *   tsx src/export-cli.ts --flow <flowId>  [--target runbook|mermaid|json] [--out <file>]
 *   tsx src/export-cli.ts --project <pid>  [--target ...] [--out <file>]
 * 输出：stdout（--out 落盘则只打路径），一律 UTF-8。
 */
import process from "node:process";
import { Kernel } from "./kernel.js";
import { effectiveFlow3 } from "./modules.js";
import { factoryOverlayPath, readOverlay, type FlowOverlay } from "./overlay.js";
import { ROOT } from "./schema.js";
import { loadState } from "./state.js";
import { nodeFs, nodePath } from "./abstraction/adapters/node.js";

// ---------- 导出图（中性形态，渲染器的唯一输入） ----------

export interface ExportNode {
  id: string;
  kind: string;
  title: string;
  stage: string;
  module: string;
  kit?: string;
  op?: string;
  skill?: string;
  minitool?: string;
  output?: string;
  desc?: string;
  gateRole?: string;
  /** 生效 config（逐键来源注记保留原样，如 "@default:mainTropes"） */
  config?: Record<string, unknown>;
}

export interface ExportEdge {
  id?: string;
  from: string;
  to: string;
  role?: string;
  via?: string;
  when?: unknown;
  params?: Record<string, unknown>;
}

export interface ExportInput {
  name: string;
  type: string;
  required: boolean;
  desc?: string;
  enum?: string[];
  /** 已解析的生效值（截断展示；缺席 = 未表态/未传） */
  resolved?: string;
}

export interface ExportGraph {
  source: { mode: "project" | "flow"; id: string; flowId: string; flowTitle?: string; flowVersion?: string; flowStatus?: string; flowDesc?: string };
  inputs: ExportInput[];
  meta: { overlayHash?: string; generatedAt: string; notes: string[]; unsupported: string[] };
  nodes: ExportNode[];
  edges: ExportEdge[];
  links: Array<{ id: string; fromModule: string; toModule: string; mode: string }>;
  composition: Array<{ id: string; module: string; name?: string; order: number; dir?: string; link?: string; capsEnabled?: string[] }>;
}

/** 截断宽度（config 旋钮 truncate；main 里由 --truncate 覆盖） */
let truncateWidth = 80;

function brief(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > truncateWidth ? s.slice(0, truncateWidth - 3) + "..." : s;
}

/** EffectiveFlow（内核真身产出）→ 中性导出图。只搬运，不派生。 */
function toExport(eff: any, source: { mode: "project" | "flow"; id: string }): ExportGraph {
  const rawFlow = eff.flow ?? {};
  const graph = rawFlow.graph ?? {};
  const nodes: ExportNode[] = Object.entries(graph.nodes ?? {})
    .map(([id, n]: [string, any]) => ({
      id,
      kind: n.kind ?? "agent",
      title: n.title ?? id,
      stage: n.stage ?? "",
      module: n.module ?? "",
      kit: n.kit,
      op: n.op,
      skill: n.skill,
      minitool: n.minitool,
      output: n.output,
      desc: n.desc,
      gateRole: n.gate_role,
      config: n.config && typeof n.config === "object" ? n.config : undefined,
    }))
    .sort((a, b) => (a.stage === b.stage ? a.id.localeCompare(b.id) : a.stage.localeCompare(b.stage)));
  const edges: ExportEdge[] = (graph.edges ?? []).map((e: any) => ({
    id: e.id,
    from: e.from,
    to: e.to,
    role: e.role,
    via: e.via,
    when: e.when,
    params: e.params,
  }));
  const inputs: ExportInput[] = Object.entries(rawFlow.inputs ?? {}).map(([name, d]: [string, any]) => ({
    name,
    type: d?.type ?? "string",
    // R8 口径与内核一致：enum 输入只有显式 required:false 才是可选先验（缺席不抛），
    // 其余（如 route）缺省即必表态——未选 flow_run 抛「选择未决」，不静默兜底
    required: d?.type === "enum" ? d?.required !== false : Boolean(d?.required),
    desc: d?.desc,
    // flow@3 的枚举候选字段名是 options（enum 仅作兼容兜底）
    enum: (Array.isArray(d?.options) ? d.options : Array.isArray(d?.enum) ? d.enum : undefined)?.map(String),
    resolved: brief(eff.inputs?.[name]),
  }));
  const composition = (eff.r6?.modules ?? []).map((m: any) => ({
    id: m.id,
    module: m.module,
    name: m.name,
    order: m.order,
    dir: m.dir,
    link: m.link,
    capsEnabled: m.capsEnabled,
  }));
  return {
    source: {
      mode: source.mode,
      id: source.id,
      flowId: rawFlow.id ?? "",
      flowTitle: rawFlow.title,
      flowVersion: rawFlow.version,
      flowStatus: rawFlow.status,
      flowDesc: rawFlow.desc,
    },
    inputs,
    meta: {
      overlayHash: eff.overlayHash,
      generatedAt: new Date().toISOString(),
      notes: eff.notes ?? [],
      unsupported: eff.unsupported ?? [],
    },
    nodes,
    edges,
    links: eff.links ?? [],
    composition,
  };
}

// ---------- 两个导出入口（均走内核真身） ----------

/** 项目面：生效编排（含配置预算层 + 项目 overlay）——与内核计划/派发所见完全同源。 */
export function buildProjectExport(projectId: string): ExportGraph {
  const k = new Kernel();
  const projectDir = k.projectDir(projectId);
  const state = loadState(projectDir, k.fs, k.path);
  if (!state) throw new Error(`项目无 state.json（先 flow_run）: ${projectId}`);
  const raw = k.loadFlow(state.flowId);
  const eff = k.effectiveOf(projectDir, raw);
  return toExport(eff, { mode: "project", id: projectId });
}

/** 模板面：flow.json ⊕ 出厂 overlay（无项目层）——给外部消费方看流程形态。 */
export function buildFlowExport(flowId: string): ExportGraph {
  const file = nodePath.join(ROOT, "flows", flowId, "flow.json");
  if (!nodeFs.exists(file)) throw new Error(`flow 不存在: ${flowId}`);
  const flow = JSON.parse(nodeFs.readText(file));
  const overlays = [readOverlay(factoryOverlayPath(ROOT, flowId, nodePath), nodeFs)].filter(Boolean) as FlowOverlay[];
  const eff = effectiveFlow3(ROOT, flow, { overlays }, nodeFs, nodePath);
  return toExport(eff, { mode: "flow", id: flowId });
}

// ---------- 渲染器 ----------

const KIND_CLASS: Record<string, string> = { agent: "agent", core: "core", gate: "gate" };

/** mermaid 图（节点含 kit.op / core:minitool 注记，边带 via/role 标签）。 */
export function renderMermaid(g: ExportGraph): string {
  const esc = (s: string) => s.replace(/"/g, "'").replace(/[\[\]{}()<>|]/g, " ").replace(/\n/g, " ");
  const idOf = (id: string) => "n" + id.replace(/[^A-Za-z0-9]/g, "_");
  const lines: string[] = ["flowchart TD"];
  for (const n of g.nodes) {
    const sub = n.kit && n.op ? `${n.kit}.${n.op}` : n.minitool ? `core:${n.minitool}` : n.kind;
    lines.push(`  ${idOf(n.id)}["${esc(`${n.id} · ${n.title}`)}<br/>${esc(sub)}"]:::k${KIND_CLASS[n.kind] ?? "other"}`);
  }
  for (const e of g.edges) {
    const label = e.via || e.role;
    lines.push(`  ${idOf(e.from)} ${label ? `-->|${esc(label)}|` : "-->"} ${idOf(e.to)}`);
  }
  lines.push(
    "  classDef agent fill:#2a2313,stroke:#e8b33d,color:#e8b33d",
    "  classDef core fill:#16233a,stroke:#3d5a80,color:#a8c4e8",
    "  classDef gate fill:#2a1616,stroke:#a5433a,color:#e8a49c",
    "  classDef other fill:#222222,stroke:#888888,color:#dddddd",
  );
  return lines.join("\n");
}

/** markdown 运行手册：外部 agent / 人阅的唯一导出形态（自带 mermaid + 单源声明）。 */
export function renderRunbook(g: ExportGraph): string {
  const L: string[] = [];
  const s = g.source;
  L.push(`# ${s.flowTitle ?? s.flowId}（${s.flowId}）· 运行手册（导出快照）`);
  L.push("");
  L.push(
    `> **只读导出**（${g.meta.generatedAt}，来源：${s.mode === "project" ? `项目 ${s.id}` : "flow 模板"}，overlayHash=${g.meta.overlayHash ?? "-"}）。`,
    "> 唯一事实源 = `flows/" + s.flowId + "/flow.json` ⊕ overlays；执行真身 = miniflow 内核（CLI `flow_next`/`flow_submit` 或 MCP 面）。",
    "> 本文件供外部 agent / 人阅理解与对接，**禁止作为编辑目标回写**。",
  );
  L.push("");
  if (s.flowDesc) L.push(s.flowDesc, "");
  L.push(`- 版本：${s.flowVersion ?? "-"}　状态：${s.flowStatus ?? "-"}`);
  L.push("");

  L.push("## 输入面（R8：选择必须显式表态，不静默兜底）");
  L.push("");
  if (g.inputs.length === 0) L.push("（无声明输入）");
  for (const i of g.inputs) {
    const enumPart = i.enum ? `enum: ${i.enum.join("｜")}` : i.type;
    const flag = i.required ? "必表态" : "可选先验";
    let line = `- **${i.name}**（${enumPart}）· ${flag}`;
    if (i.desc) line += ` — ${i.desc}`;
    if (i.resolved !== undefined) line += `；生效值 = \`${i.resolved}\``;
    L.push(line);
  }
  L.push("");

  if (g.composition.length > 0) {
    L.push("## 模块组合");
    L.push("");
    L.push("| 序 | 实例 | 模块 | 产物目录 | 连接件 | 启用能力 |");
    L.push("|---|---|---|---|---|---|");
    for (const m of g.composition) {
      L.push(`| ${m.order} | ${m.id} | ${m.module}${m.name ? `(${m.name})` : ""} | ${m.dir ?? "-"} | ${m.link ?? "-"} | ${(m.capsEnabled ?? []).join("、") || "-"} |`);
    }
    L.push("");
  }

  L.push("## 流程图");
  L.push("");
  L.push("```mermaid");
  L.push(renderMermaid(g));
  L.push("```");
  L.push("");

  L.push("## 节点明细");
  L.push("");
  let stage = "";
  for (const n of g.nodes) {
    if (n.stage !== stage) {
      stage = n.stage;
      L.push(`### ${stage}`);
      L.push("");
    }
    const impl = n.kit && n.op ? `\`${n.kit}.${n.op}\`` : n.minitool ? `core minitool \`${n.minitool}\`` : n.kind;
    L.push(`- **${n.id}** · ${n.title} — ${impl}${n.gateRole ? `（gate_role: ${n.gateRole}）` : ""}`);
    if (n.desc) L.push(`  - ${n.desc}`);
    if (n.skill) L.push(`  - 技能卡：\`${n.skill}\``);
    if (n.output) L.push(`  - 产物：\`${n.output}\``);
    const ups = g.edges.filter((e) => e.to === n.id);
    for (const e of ups) {
      const bits = [e.via, e.role, e.when !== undefined ? `when=${brief(e.when)}` : undefined].filter(Boolean);
      L.push(`  - 入口 ← ${e.from}${bits.length ? `（${bits.join(" · ")}）` : ""}`);
    }
    if (n.config && Object.keys(n.config).length > 0) {
      const kv = Object.entries(n.config)
        .map(([k, v]) => {
          const vs = typeof v === "string" && v.startsWith("@default:") ? `${(v as string).slice(9)}（op 缺省）` : brief(v) ?? "";
          return `${k}=${vs}`;
        })
        .join("，");
      L.push(`  - 生效 config：${kv}`);
    }
  }
  L.push("");

  if (g.links.length > 0) {
    L.push("## 模块间连接件（manual = 人工裁决点，auto = 自动放行）");
    L.push("");
    for (const l of g.links) {
      L.push(`- ${l.id}：${l.fromModule} → ${l.toModule} · **${l.mode}**${l.mode === "manual" ? "（人工裁决，机器不得代裁）" : ""}`);
    }
    L.push("");
  }

  if (g.meta.notes.length > 0) {
    L.push("## 派生回显");
    L.push("");
    for (const n of g.meta.notes) L.push(`- ${n}`);
    L.push("");
  }
  if (g.meta.unsupported.length > 0) {
    L.push("## ⚠ 未消费的 overlay patch（N3：不许静默丢弃）");
    L.push("");
    for (const u of g.meta.unsupported) L.push(`- ${typeof u === "string" ? u : JSON.stringify(u)}`);
    L.push("");
  }
  return L.join("\n");
}

// ---------- CLI（被 import 时不执行） ----------

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

function main(): void {
  const flowId = arg("flow");
  const projectId = arg("project");
  const target = arg("target") ?? "runbook";
  const out = arg("out");
  const t = Number(arg("truncate"));
  if (Number.isFinite(t) && t >= 20) truncateWidth = t;
  if ((!flowId && !projectId) || (flowId && projectId)) {
    console.error("usage: tsx src/export-cli.ts (--flow <id> | --project <id>) [--target runbook|mermaid|json] [--out <file>]");
    process.exit(2);
  }
  try {
    const g = flowId ? buildFlowExport(flowId) : buildProjectExport(projectId!);
    const text =
      target === "mermaid" ? renderMermaid(g) : target === "json" ? JSON.stringify(g, null, 2) : renderRunbook(g);
    if (out) {
      const absOut = nodePath.resolve(out);
      nodeFs.writeText(absOut, text);
      console.error(`已写出: ${absOut}`);
    } else {
      console.log(text);
    }
  } catch (e) {
    console.error(`[flow-export] 失败: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}

if (process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("export-cli.ts")) {
  main();
}
