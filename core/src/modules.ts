/**
 * R6 · 模块展开器（单点实现，规范 §三）：
 *
 *   flow@3（模块序列） ──expandFlow3──▶ 生效编排（flow@2 形态的派生图 + 连接件 + 模块组合）
 *
 * 设计决策：派生产物是 **flow@2 形态的 FlowDescriptor**（graph/stages），因此 plan/advance/
 * submit/metrics/assembler 全部现有机器零改动直接运行。连接件 = kind:"gate" + gate_role:"link"
 * 的节点（模块内无门无打回；模块间 auto 放行 / manual 挂人；reject = 重跑上游模块）。
 * 派生只算一次，落 registry/effective.json（kernel.persistEffective，effective@2）。
 */
import fs from "node:fs";
import path from "node:path";
import { assertSchema } from "./schema.js";

export interface Flow3ModuleInstance {
  id: string;
  module: string;
  link?: "auto" | "manual";
  caps?: string[];
  insert?: Record<string, string[]>;
  iterate?: { unit?: string; over?: string; first?: number };
  vary?: Record<string, { caps?: string[]; insert?: Record<string, string[]> }>;
  when?: unknown;
}

export interface Flow3Descriptor {
  format: "flow@3";
  id: string;
  title: string;
  desc?: string;
  version: string;
  status?: string;
  inputs?: Record<string, unknown>;
  defaults?: { link?: "auto" | "manual" };
  policy?: { link_default?: "auto" | "manual"; adapt?: string; budget?: Record<string, unknown> };
  modules: Flow3ModuleInstance[];
  outputs?: { module: string; title: string; audience?: string }[];
}

export interface LinkDef {
  id: string;
  fromModule: string;
  toModule: string;
  mode: "auto" | "manual";
}

export interface ModuleComposition {
  id: string;
  module: string;
  name: string;
  order: number;
  dir: string;
  link: "auto" | "manual";
  caps: string[];
  capsEnabled: string[];
  spine: string[];
  plugins: string[];
  nodes: string[];
  /** W-01 职责三件套（module.json io 原样传播；无声明的模块为 null） */
  io?: {
    input: { from: string; shape: string };
    output: { file: string; audience: string };
    acceptance: { asserts: string[] };
  } | null;
}

export interface ExpandResult {
  flow: any; // 派生 FlowDescriptor（flow@2 形态 + r6 元数据）
  modules: ModuleComposition[];
  links: LinkDef[];
  moduleNodes: Record<string, string[]>;
  dirs: Record<string, string>;
}

/** 模块注册表（进程内缓存；modules/<id>/module.json，module@1 契约校验）。 */
const modCache = new Map<string, { root: string; raw: any }>();

export function loadModule(root: string, moduleId: string): any {
  const key = `${root}::${moduleId}`;
  const hit = modCache.get(key);
  if (hit) return hit.raw;
  const file = path.join(root, "modules", moduleId, "module.json");
  if (!fs.existsSync(file)) throw new Error(`模块不存在: modules/${moduleId}/module.json`);
  const raw = JSON.parse(fs.readFileSync(file, "utf-8"));
  if (raw.format !== "module@1") throw new Error(`模块格式非法（须 module@1）: ${file}`);
  assertSchema("module", raw);
  modCache.set(key, { root, raw });
  return raw;
}

/** 交卷/派发用的生产者署名。 */
export function producerOf(mid: string, tool: string): string {
  return `module/${mid}.${tool}`;
}

/** 模块产物目录：NN-模块名（NN = 实例在 flow.modules 中的两位序号）。 */
export function moduleDirOf(order: number, name: string): string {
  return `${String(order).padStart(2, "0")}-${name}`;
}

/**
 * 展开一条 flow@3（规范 §三 八条规则）。
 * 幂等：同一输入两次展开逐字节一致（纯函数，除文件读取外无状态）。
 */
export function expandFlow3(
  root: string,
  flow3: Flow3Descriptor,
  opts: { policy?: { link_default?: "auto" | "manual" } } = {},
): ExpandResult {
  const modules: ModuleComposition[] = [];
  const links: LinkDef[] = [];
  const moduleNodes: Record<string, string[]> = {};
  const dirs: Record<string, string> = {};
  const nodes: Record<string, any> = {};
  const edges: { id: string; from: string; to: string; role?: string; via?: string; params?: Record<string, unknown> }[] = [];
  const derivedStages: any[] = [];

  let prev: { mid: string; terminals: string[]; linkId: string } | null = null;

  flow3.modules.forEach((inst, idx) => {
    const mod = loadModule(root, inst.module);
    const order = idx + 1;
    const dir = moduleDirOf(order, mod.name);
    dirs[inst.id] = dir;
    const mid = inst.id;

    // ── 规则 1：选工具。spine ∪ capability∩caps ∪ 显式 insert；requires 可达性剪枝（缺则报错）。
    const capsWanted = new Set<string>(inst.caps ?? []);
    const explicitInsert = new Set<string>();
    for (const tools of Object.values(inst.insert ?? {})) for (const t of tools) explicitInsert.add(t);
    for (const v of Object.values(inst.vary ?? {})) {
      for (const t of Object.values(v.insert ?? {}).flat()) explicitInsert.add(t);
    }

    const enabled = new Set<string>(mod.skeleton.spine);
    for (const [toolId, op] of Object.entries(mod.ops as Record<string, any>)) {
      if (enabled.has(toolId)) continue;
      const capHit = (op.capability ?? []).some((c: string) => capsWanted.has(c));
      if (capHit || explicitInsert.has(toolId)) enabled.add(toolId);
    }

    // requires 可达性剪枝：前置缺失报错（不静默丢，规范 §三.1）
    for (const toolId of enabled) {
      for (const req of mod.ops[toolId]?.requires ?? []) {
        if (!enabled.has(req)) {
          throw new Error(
            `模块 ${inst.module}（实例 ${mid}）：工具 ${toolId} requires ${req}，但后者未启用——请在 caps/insert 中补齐或移除依赖`,
          );
        }
      }
    }

    // ── 规则 2：定顺序。骨架成员保持 spine 次序；插件落 slot 锚点一侧；同槽按声明序。
    const seq: string[] = [];
    for (const toolId of mod.skeleton.spine) {
      if (!enabled.has(toolId)) continue;
      const pluginsBefore = [...enabled].filter(
        (t) => !mod.skeleton.spine.includes(t) && mod.ops[t]?.slot === `before:${toolId}`,
      );
      for (const p of pluginsBefore) seq.push(p);
      seq.push(toolId);
      const pluginsAfter = [...enabled].filter(
        (t) => !mod.skeleton.spine.includes(t) && mod.ops[t]?.slot === `after:${toolId}`,
      );
      for (const p of pluginsAfter) seq.push(p);
    }
    // 显式 insert（钉到锚点）与 end 插件：追加在尾部（保持稳定序）
    for (const t of explicitInsert) {
      if (!seq.includes(t)) seq.push(t);
    }
    for (const t of [...enabled]) {
      if (!seq.includes(t) && mod.ops[t]?.slot === "end") seq.push(t);
    }

    // ── 规则 3/7：派生节点（id <mid>.<tool>；产物路径 <NN>-<模块名>/）。
    const midNodes: string[] = [];
    for (const toolId of seq) {
      const op = mod.ops[toolId];
      const nid = `${mid}.${toolId}`;
      midNodes.push(nid);
      const adds = op.adds ?? {};
      const kind = op.kind === "check" ? "core" : "agent"; // 规则 4：review 也是普通 agent 节点
      const baseOut = (op as any).output
        ? String((op as any).output).split("/").pop()
        : op.script
          ? `${toolId}.docx` // script 壳产物是导出的 docx：声明路径必须与落盘一致（flow-verify 对账）
          : `${toolId}.md`;
      nodes[nid] = {
        kind,
        title: op.title ?? toolId,
        stage: mid,
        module: mid,
        kit: inst.module,
        op: toolId,
        output: `${dir}/${baseOut}`,
        ...(op.skill ? { skill: op.skill } : {}),
        // 执行体三选一（module@1）：skill=agent 认知步；minitools[0]=内建机器件；
        // script=外部确定性脚本（kind=check 壳，如 export-doc）——core 步由内核 spawn（R6 §一.11）
        ...(op.minitool ? { minitool: op.minitool } : {}),
        ...(Array.isArray(op.minitools) && op.minitools.length ? { minitool: op.minitools[0] } : {}),
        ...(op.script ? { script: op.script } : {}),
        ...(op.asserts?.length || adds.asserts?.length
          ? { asserts: [...new Set([...(op.asserts ?? []), ...(adds.asserts ?? [])])] }
          : {}),
        ...(adds.knowledge?.length ? { knowledge: [...new Set([...(op.knowledge ?? []), ...(adds.knowledge ?? [])])] } : {}),
        ...(Object.keys(adds.config ?? {}).length || op.config
          ? {
              config: Object.fromEntries(
                Object.keys({ ...(op.config ?? {}), ...(adds.config ?? {}) }).map((k) => [
                  k,
                  (adds.config ?? {})[k] ?? `@default:${k}`,
                ]),
              ),
            }
          : {}),
        ...(inst.when !== undefined ? { when: inst.when } : {}),
        desc: op.desc,
      };
    }
    moduleNodes[mid] = [...midNodes];

    // ── 规则 5：边 = 骨架边（两端启用才保留）+ 插件桥接（锚点→插件→锚点原后继，替换直连）。
    const enabledEdges: [string, string][] = [];
    for (const [from, to] of mod.skeleton.edges) {
      if (enabled.has(from) && enabled.has(to)) enabledEdges.push([from, to]);
    }
    const pluginsInSeq = seq.filter((t) => !mod.skeleton.spine.includes(t));
    for (const p of pluginsInSeq) {
      const anchor = String(mod.ops[p]?.slot ?? "end").startsWith("after:")
        ? mod.ops[p].slot.slice("after:".length)
        : null;
      const idxP = seq.indexOf(p);
      const pred = idxP > 0 ? seq[idxP - 1] : null;
      const succ = idxP < seq.length - 1 ? seq[idxP + 1] : null;
      if (anchor && enabled.has(anchor)) {
        // 替换 anchor → 原后继 的直连为 anchor → p → 后继（chain 语义）
        const si = seq.indexOf(anchor);
        const chainSucc = si < seq.length - 1 ? seq[si + 1] : null;
        const direct = enabledEdges.findIndex(([f, t]) => f === anchor && t === chainSucc && chainSucc);
        if (direct >= 0) enabledEdges.splice(direct, 1);
        if (pred) enabledEdges.push([pred, p]);
        if (succ) enabledEdges.push([p, succ]);
      } else {
        if (pred) enabledEdges.push([pred, p]);
        if (succ) enabledEdges.push([p, succ]);
      }
    }
    for (const [f, t] of enabledEdges) {
      // 骨架边按 seq 序过滤反向边（否则插件桥接 + 分支依赖会成环）
      if (seq.indexOf(f) >= seq.indexOf(t) && f !== t) continue;
      const viaSkill = mod.ops[t]?.skill;
      edges.push({ id: `e-${mid}-${f}-${t}`, from: `${mid}.${f}`, to: `${mid}.${t}`, role: "flow", ...(viaSkill ? { via: `skill.${viaSkill}` } : {}) });
    }

    // 规则 3：节点 id；模块实例序列 → 合成 stages（assembler/搬迁口径复用）
    derivedStages.push({
      id: mid,
      name: mod.name,
      entry: midNodes.length ? `${mid}.${seq[0]}` : `${mid}.link`,
      gate: `${mid}.link`,
      nodes: midNodes,
    });

    // ── 规则 6：相邻实例之间铸连接件 <本实例id>.link（进入本模块）。跨模块接线：上游终端 → link → 本模块入口。
    const mode = inst.link ?? flow3.defaults?.link ?? opts.policy?.link_default ?? "auto";
    const capsEnabled = [...new Set(seq.flatMap((t) => mod.ops[t]?.capability ?? []))];
    modules.push({
      id: mid,
      module: inst.module,
      name: mod.name,
      order,
      dir,
      link: mode,
      caps: [...mod.caps],
      capsEnabled,
      spine: seq.filter((t) => mod.skeleton.spine.includes(t)).map((t) => `${mid}.${t}`),
      plugins: seq.filter((t) => !mod.skeleton.spine.includes(t)).map((t) => `${mid}.${t}`),
      nodes: [...midNodes],
      io: mod.io ?? null, // W-01 职责三件套随生效编排传播（机器消费面）
    });
    const linkId = `${mid}.link`;
    if (prev) {
      links.push({ id: linkId, fromModule: prev.mid, toModule: mid, mode });
      nodes[linkId] = {
        kind: "gate",
        gate_role: "link",
        link_mode: mode,
        title: `连接 · ${mod.name}（${mode === "auto" ? "自动批准" : "待人工批准"}）`,
        stage: mid,
        module: mid,
      };
      for (const t of prev.terminals) edges.push({ id: `e-${prev.mid}-link`, from: t, to: linkId, role: "flow" });
      for (const e of midNodes.slice(1)) {
        // 入口首节点由连接件接入；其余成员保持骨架内部边
      }
      if (midNodes.length) edges.push({ id: `e-link-${mid}`, from: linkId, to: midNodes[0], role: "flow" });
    }
    const terminals = midNodes.length ? [midNodes[midNodes.length - 1]] : [];
    prev = { mid, terminals, linkId };
  });

  // ── 合成 flow@2 形态派生描述符（全链现有机器直接消费）
  const derived: any = {
    format: "flow@3-derived",
    id: flow3.id,
    title: flow3.title,
    ...(flow3.desc ? { desc: flow3.desc } : {}),
    version: flow3.version,
    status: flow3.status ?? "official",
    inputs: flow3.inputs ?? {},
    outputs: [],
    graph: { nodes, edges },
    stages: derivedStages,
    r6: { modules, links, moduleNodes, dirs },
  };

  return { flow: derived, modules, links, moduleNodes, dirs };
}

/** R6 生效编排（flow@3 专用）：flow@3 overlay（set-policy/set-module/insert-tool）在展开前应用于模块实例。 */
export function effectiveFlow3(
  root: string,
  flow3: Flow3Descriptor,
  opts: { projectDir?: string; overlays?: any[] } = {},
): ExpandResult & { policy: Record<string, unknown>; notes: string[]; overlayHash: string; appliedCount: number } {
  let flow: Flow3Descriptor = JSON.parse(JSON.stringify(flow3));
  const notes: string[] = [];
  let applied = 0;
  const policy: Record<string, unknown> = { link_default: flow.defaults?.link ?? "auto", adapt: "propose" };

  const list = (opts.overlays ?? []).filter(Boolean);
  for (const ov of list) {
    for (const p of ov.patches ?? []) {
      if (p.status && p.status !== "applied") continue;
      if (p.kind === "set-policy") {
        if (p.key === "link_default" && (p.value === "auto" || p.value === "manual")) {
          policy.link_default = p.value;
          notes.push(`set-policy link_default=${p.value}`);
          applied++;
        }
      } else if (p.kind === "set-module") {
        const inst = (flow.modules ?? []).find((m) => m.id === p.id);
        if (inst) {
          inst.caps = [...((p as any).caps ?? inst.caps ?? [])];
          notes.push(`set-module ${p.id} caps=[${inst.caps.join("，")}]`);
          applied++;
        }
      } else if (p.kind === "insert-tool") {
        const inst = (flow.modules ?? []).find((m) => m.id === (p as any).module);
        if (inst) {
          inst.insert = { ...(inst.insert ?? {}), [(p as any).slot ?? "end"]: [
            ...(((inst.insert ?? {})[(p as any).slot ?? "end"] ?? []) as string[]),
            (p as any).tool,
          ] };
          notes.push(`insert-tool ${(p as any).tool} @ ${(p as any).slot} → ${inst.id}`);
          applied++;
        }
      }
    }
  }

  const res = expandFlow3(root, flow, { policy: policy as any });
  let hash = 0;
  const fingerprint = JSON.stringify({ m: flow.modules, p: policy });
  for (let i = 0; i < fingerprint.length; i++) hash = ((hash << 5) - hash + fingerprint.charCodeAt(i)) | 0;
  const overlayHash = "r6-" + (hash >>> 0).toString(16);

  return { ...res, flow: { ...res.flow, __flow3: flow }, policy, notes, overlayHash, appliedCount: applied };
}
