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
// 仅类型导入（编译期擦除，不构成运行时循环依赖）——set-tool 的生效结果与 legacy 路径同一形状。
import type { ToolOverride } from "./overlay.js";

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
  /** R7：`maxRounds` / `awaitTimeoutMs` 来自 contracts/flow.schema.json 的 policy 扩展。 */
  policy?: {
    link_default?: "auto" | "manual";
    adapt?: string;
    budget?: Record<string, unknown>;
    maxRounds?: number;
    awaitTimeoutMs?: number;
  };
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
    // 规则 2 补充（诊断 2026-09-19）：锚点失效的启用工具按 also_fits 逐个兜底落位；
    // 全部声明锚点均不可达 = 响亮失败——静默丢弃就是能力四环 ② 断链（p-slj 诊断实证）
    const unplaced = [...enabled].filter((t) => !seq.includes(t));
    for (const t of unplaced) {
      const fits = [...(mod.ops[t]?.also_fits ?? [])];
      let placed = false;
      for (const anchor of fits) {
        if (anchor === "end") {
          seq.push(t);
          placed = true;
          break;
        }
        const m = anchor.match(/^(before|after):(.+)$/);
        if (!m) continue;
        const idx = seq.indexOf(m[2]);
        if (idx < 0) continue;
        seq.splice(m[1] === "before" ? idx : idx + 1, 0, t);
        placed = true;
        break;
      }
      if (!placed) {
        throw new Error(
          `模块 ${inst.module}（实例 ${mid}）：启用的工具 ${t} 无法落位（slot=${mod.ops[t]?.slot ?? "无"}，also_fits=${JSON.stringify(fits)} 均不可达）——请扩骨架、调整锚点或关闭该能力`,
        );
      }
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

    // ── 规则 5：边 = 启用节点的 seq 线性主干（插件即桥接）+ 非相邻骨架前向边（分支保留）。
    // 旧实现逐插件 splice 桥接：两个插件共享同一 after 锚点时互相穿透，后插件丢失入边成为源点
    // （p-slj-005 实证：script-drama-beat 零入边、plot-redline 重复边）。seq 本身已是最终顺序，
    // 线性主干天然给出「锚点→插件→原后继」语义，无需逐个替换。
    const enabledEdges = new Set<string>();
    const ekey = (f: string, t: string) => `${f}→${t}`;
    for (let i = 0; i + 1 < seq.length; i++) enabledEdges.add(ekey(seq[i], seq[i + 1]));
    for (const [from, to] of mod.skeleton.edges) {
      if (!enabled.has(from) || !enabled.has(to)) continue;
      if (!seq.includes(from) || !seq.includes(to)) continue;
      // 非相邻前向骨架边 = 真分支，保留；相邻对主干已含
      if (seq.indexOf(to) - seq.indexOf(from) !== 1) enabledEdges.add(ekey(from, to));
    }
    for (const key of enabledEdges) {
      const [f, t] = key.split("→");
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
  // outputs：flow@3 的模块级声明展开为节点级（模块内最后一个有产物节点 = 该模块交付件），
  // 保留 module 键供模块报告/交付清单按模块归口
  const derivedOutputs = (flow3.outputs ?? [])
    .map((o) => {
      const ids = (moduleNodes[o.module] ?? []).filter((id) => nodes[id]?.output);
      const last = ids.at(-1);
      return last ? { node: last, module: o.module, title: o.title, ...(o.audience ? { audience: o.audience } : {}) } : null;
    })
    .filter(Boolean);
  const derived: any = {
    format: "flow@3-derived",
    id: flow3.id,
    title: flow3.title,
    ...(flow3.desc ? { desc: flow3.desc } : {}),
    version: flow3.version,
    status: flow3.status ?? "official",
    inputs: flow3.inputs ?? {},
    outputs: derivedOutputs,
    graph: { nodes, edges },
    stages: derivedStages,
    r6: { modules, links, moduleNodes, dirs },
  };

  return { flow: derived, modules, links, moduleNodes, dirs };
}

/** R6 生效编排（flow@3 专用）：flow@3 overlay 在展开前应用于模块实例。
 *
 *  R7（2026-09-20）修复三类「声明了不生效」：
 *  ① `flow.policy` 此前被整个忽略（只读 `defaults.link`，且 `adapt` 硬编码 `"propose"`）
 *     ⇒ 用户声明 `adapt:"off"` 也拦不住优化器提案。现以 flow.policy 为起点。
 *  ② `set-tool` / `set-input` 此前在 flow@3 路径**结构性不可达**（kernel 把 toolOverrides/inputs
 *     硬编码成 `{}`）⇒ §一.3「每个 tool 的内容可调」无落点，只能改 repo 级 module.json（跨项目污染）。
 *     现两者均在本函数内实装，并由 `kernel.effectiveOf` 透传。
 *  ③ 不属于 flow@3 的 patch kind 此前**静默丢弃**。现显式回显进 `notes` 且不计入 `appliedCount`，
 *     使「日志记 applied、内核没读」这类事故在下一轮不可能再发生。
 */
export function effectiveFlow3(
  root: string,
  flow3: Flow3Descriptor,
  opts: { projectDir?: string; overlays?: any[] } = {},
): ExpandResult & {
  policy: Record<string, unknown>;
  notes: string[];
  overlayHash: string;
  appliedCount: number;
  toolOverrides: Record<string, ToolOverride>;
  inputs: Record<string, unknown>;
  unsupported: string[];
} {
  let flow: Flow3Descriptor = JSON.parse(JSON.stringify(flow3));
  const notes: string[] = [];
  let applied = 0;

  // ① policy 起点 = flow.json 的 policy 声明（此前整个被忽略），defaults.link 兜底。
  const declared = (flow.policy ?? {}) as Record<string, unknown>;
  const policy: Record<string, unknown> = {
    link_default: declared.link_default ?? flow.defaults?.link ?? "auto",
    adapt: declared.adapt ?? "propose",
  };
  if (declared.budget) policy.budget = declared.budget;
  for (const k of ["maxRounds", "awaitTimeoutMs"]) {
    if (declared[k] !== undefined) policy[k] = declared[k];
  }
  notes.push(
    `policy 起点取自 flow.json（此前忽略）：link_default=${String(policy.link_default)} adapt=${String(policy.adapt)}` +
      (policy.maxRounds !== undefined ? ` maxRounds=${String(policy.maxRounds)}` : "") +
      (policy.awaitTimeoutMs !== undefined ? ` awaitTimeoutMs=${String(policy.awaitTimeoutMs)}` : ""),
  );

  const toolOverrides: Record<string, ToolOverride> = {};
  const inputs: Record<string, unknown> = {};
  const unsupported: string[] = [];

  /** flow@3 展开器真正消费的 kind。其余（手工图语义）须显式回显，不许静默丢弃。 */
  const FLOW3_KINDS = new Set(["set-policy", "set-module", "insert-tool", "set-tool", "set-input"]);
  /** flow@3 允许被 set-policy 改写的 policy 键（白名单，对齐 contracts/flow.schema.json）。 */
  const POLICY_KEYS = new Set(["link_default", "adapt", "maxRounds", "awaitTimeoutMs"]);

  const list = (opts.overlays ?? []).filter(Boolean);
  for (const ov of list) {
    for (const p of ov.patches ?? []) {
      if (p.status && p.status !== "applied") continue;
      const kind = String(p.kind);
      if (!FLOW3_KINDS.has(kind)) {
        unsupported.push(`kind=${kind}（flow@3 不消费，见规范 R7 §一）`);
        continue;
      }
      if (kind === "set-policy") {
        const k = String(p.key ?? "");
        if (!POLICY_KEYS.has(k)) {
          unsupported.push(`set-policy:${k || "(缺 key)"}（不在 flow@3 policy 白名单）`);
          continue;
        }
        if (k === "link_default" && p.value !== "auto" && p.value !== "manual") {
          unsupported.push(`set-policy:link_default=${String(p.value)}（须 auto|manual）`);
          continue;
        }
        policy[k] = p.value;
        notes.push(`set-policy ${k}=${String(p.value)}`);
        applied++;
      } else if (kind === "set-module") {
        const inst = (flow.modules ?? []).find((m) => m.id === p.id);
        if (inst) {
          inst.caps = [...((p as any).caps ?? inst.caps ?? [])];
          notes.push(`set-module ${p.id} caps=[${inst.caps.join("，")}]`);
          applied++;
        } else {
          unsupported.push(`set-module:${String(p.id)}（模块实例不存在）`);
        }
      } else if (kind === "insert-tool") {
        const inst = (flow.modules ?? []).find((m) => m.id === (p as any).module);
        if (inst) {
          inst.insert = { ...(inst.insert ?? {}), [(p as any).slot ?? "end"]: [
            ...(((inst.insert ?? {})[(p as any).slot ?? "end"] ?? []) as string[]),
            (p as any).tool,
          ] };
          notes.push(`insert-tool ${(p as any).tool} @ ${(p as any).slot} → ${inst.id}`);
          applied++;
        } else {
          unsupported.push(`insert-tool:${String((p as any).tool)}@${String((p as any).module)}（模块实例不存在）`);
        }
      } else if (kind === "set-tool") {
        // 与 overlay.ts legacy 分支**同一套语义**（key = <kit>.<op>），asssembler.resolveNodeOp 直接消费。
        if (!p.kit || !p.op) {
          unsupported.push("set-tool（缺 kit/op）");
          continue;
        }
        const key = `${p.kit}.${p.op}`;
        const cur = toolOverrides[key] ?? {};
        if (p.add_knowledge) cur.add_knowledge = [...(cur.add_knowledge ?? []), ...p.add_knowledge];
        if (p.remove_knowledge) cur.remove_knowledge = [...(cur.remove_knowledge ?? []), ...p.remove_knowledge];
        if (p.add_asserts) cur.add_asserts = [...(cur.add_asserts ?? []), ...p.add_asserts];
        if (p.remove_asserts) cur.remove_asserts = [...(cur.remove_asserts ?? []), ...p.remove_asserts];
        if (p.model_tier) cur.model_tier = p.model_tier;
        if (p.config) cur.config = { ...(cur.config ?? {}), ...p.config };
        toolOverrides[key] = cur;
        notes.push(`set-tool ${key}`);
        applied++;
      } else if (kind === "set-input") {
        if (!p.key) {
          unsupported.push("set-input（缺 key）");
          continue;
        }
        inputs[String(p.key)] = p.value;
        notes.push(`set-input ${String(p.key)}=${String(p.value)}`);
        applied++;
      }
    }
  }

  const res = expandFlow3(root, flow, { policy: policy as any });
  let hash = 0;
  const fingerprint = JSON.stringify({ m: flow.modules, p: policy });
  for (let i = 0; i < fingerprint.length; i++) hash = ((hash << 5) - hash + fingerprint.charCodeAt(i)) | 0;
  const overlayHash = "r6-" + (hash >>> 0).toString(16);

  if (unsupported.length) {
    const uniq = [...new Set(unsupported)];
    notes.push(`⚠️ 有 ${unsupported.length} 条 patch 未被 flow@3 消费（已显式忽略，未计入 appliedCount）：${uniq.join("；")}`);
  }

  return {
    ...res,
    flow: { ...res.flow, __flow3: flow },
    policy,
    notes,
    overlayHash,
    appliedCount: applied,
    toolOverrides,
    inputs,
    unsupported: [...new Set(unsupported)],
  };
}
