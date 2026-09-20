import fs from "node:fs";
import path from "node:path";
import { assertSchema } from "./schema.js";
import type { PoolDecl } from "./selection.js";

export type KitDomain = "search" | "plot" | "prose" | "tool" | "module";

/** R5 内容配置项声明：每个 tool（op）自己的旋钮。 */
export interface OpConfigDef {
  type: "number" | "string" | "boolean" | "enum" | "array";
  default?: unknown;
  enum?: unknown[];
  min?: number;
  max?: number;
  unit?: string;
  desc: string;
  /** 调高/调低对产物的影响——优化 agent 的判据（如「提高 = 更保守，成本↑」） */
  effect?: string;
  tunable_by?: Array<"user" | "optimizer">;
}

export interface KitOp {
  skill?: string;
  script?: string;
  title?: string;
  desc?: string;
  kind?: "produce" | "review";
  model_tier?: "high" | "lite";
  knowledge?: string[];
  /** R5：从标尺中**排除**的条目 id（优化器按指标剔除死条款时用它——不动 glob 声明本身） */
  exclude_knowledge?: string[];
  /** R8 选择面 §2.1：带 `where` 的候选池声明（先按决策过滤 entries，再交给 resolveKbPaths 展开）。 */
  knowledge_pools?: PoolDecl[];
  /** R8 选择面 §2.2：技能池（如 `style/*`）；有决策则经 resolveSkillFromPool 选，节点 `skill` 是降级逃生口。 */
  skill_pool?: string;
  minitools?: string[];
  asserts?: string[];
  assist?: string[];
  /** R5：内容配置项声明（可调参数表）。缺省 {} = 只继承通用项；整个字段缺失 = kit-lint error */
  config?: Record<string, OpConfigDef>;
}

export interface KitDef {
  format: "kit@1";
  id: string;
  domain: KitDomain;
  name: string;
  desc?: string;
  version?: string;
  ops: Record<string, KitOp>;
}

/** 解析后的域内操作：flow 节点的 kit+op 引用在此落成具体装载清单。 */
export interface ResolvedOp {
  kit: string;
  op: string;
  domain: KitDomain;
  skill?: string;
  script?: string;
  title?: string;
  desc?: string;
  kind: "produce" | "review";
  modelTier?: "high" | "lite";
  knowledge: string[];
  excludeKnowledge: string[];
  /** R8 §2.1：候选池声明（决策过滤先于 glob 展开）。 */
  knowledgePools: PoolDecl[];
  /** R8 §2.2：技能池；节点 skill 是逃生口。 */
  skillPool?: string;
  minitools: string[];
  asserts: string[];
  assist: string[];
  config: Record<string, OpConfigDef>;
}

function toResolved(kit: KitDef, opId: string, op: KitOp): ResolvedOp {
  return {
    kit: kit.id,
    op: opId,
    domain: kit.domain,
    ...(op.skill ? { skill: op.skill } : {}),
    ...(op.script ? { script: op.script } : {}),
    ...(op.title ? { title: op.title } : {}),
    ...(op.desc ? { desc: op.desc } : {}),
    kind: op.kind ?? "produce",
    ...(op.model_tier ? { modelTier: op.model_tier } : {}),
    knowledge: op.knowledge ?? [],
    excludeKnowledge: op.exclude_knowledge ?? [],
    knowledgePools: op.knowledge_pools ?? [],
    ...(op.skill_pool ? { skillPool: op.skill_pool } : {}),
    minitools: op.minitools ?? [],
    asserts: op.asserts ?? [],
    assist: op.assist ?? [],
    config: op.config ?? {},
  };
}

/**
 * kit 注册表（kit@1，单一事实源 = kits/<domain>/kit.json）。
 *
 * 治的是 R1 报告里的装载断路与声明漂移：节点此前用 skill + kb 两套清单各自为政，
 * 40/47 个 agent 节点不匹配，且 node.kb 根本无人读。改为 kit+op 引用后，
 * 「技能要什么标尺」只写一次，内核在 buildTaskPackage 单点装载。
 */
export class KitRegistry {
  private kits = new Map<string, KitDef>();
  private bySkillIndex = new Map<string, ResolvedOp>();
  private skillAmbiguous = new Set<string>();

  constructor(private root: string) {
    const dir = path.join(root, "kits");
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory()) continue;
      const file = path.join(dir, entry.name, "kit.json");
      if (!fs.existsSync(file)) continue;
      try {
        const raw = JSON.parse(fs.readFileSync(file, "utf-8"));
        assertSchema("kit", raw);
        const kit = raw as KitDef;
        this.kits.set(kit.id, kit);
        for (const [opId, op] of Object.entries(kit.ops)) {
          const r = toResolved(kit, opId, op);
          if (!r.skill) continue; // tool 域操作无技能，不参与按技能反查
          if (this.bySkillIndex.has(r.skill)) this.skillAmbiguous.add(r.skill);
          else this.bySkillIndex.set(r.skill, r);
        }
      } catch {
        /* 坏 kit 跳过：kit-lint 负责报警，内核不炸 */
      }
    }
    // R6：modules/<id>/module.json（module@1）与 kit 同权装载——模块工种工具箱是 kit 的后继形态，
    // 派生节点以 <实例id>.<tool> 引用（kit=<模块id>，op=<tool>），标尺/断言/旋钮解析走同一条路。
    const mdir = path.join(root, "modules");
    if (!fs.existsSync(mdir)) return;
    for (const entry of fs.readdirSync(mdir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory()) continue;
      const file = path.join(mdir, entry.name, "module.json");
      if (!fs.existsSync(file)) continue;
      try {
        const raw = JSON.parse(fs.readFileSync(file, "utf-8"));
        // 契约校验归 module-lint（module.json 可能携带 WO-03 平移期的 kit@1 遗留键，
        // 白名单归一化天然剥离）；装载器只取认识的字段，不因遗留键炸掉。
        const ops: Record<string, KitOp> = {};
        for (const [opId, op] of Object.entries(raw.ops as Record<string, any>)) {
          ops[opId] = {
            ...(op.skill ? { skill: op.skill } : {}),
            ...(op.minitool ? { minitools: [op.minitool] } : {}),
            ...(op.title ? { title: op.title } : {}),
            ...(op.desc ? { desc: op.desc } : {}),
            ...(op.kind ? { kind: op.kind } : {}),
            ...(op.model_tier ? { model_tier: op.model_tier } : {}),
            ...(op.knowledge ? { knowledge: op.knowledge } : {}),
            ...(op.knowledge_pools ? { knowledge_pools: op.knowledge_pools } : {}),
            ...(op.skill_pool ? { skill_pool: op.skill_pool } : {}),
            ...(op.asserts ? { asserts: op.asserts } : {}),
            ...(op.config ? { config: op.config } : {}),
          };
        }
        const kit = {
          id: raw.id,
          domain: "module",
          name: raw.name,
          desc: raw.desc,
          version: raw.version,
          ops,
        } as unknown as KitDef;
        // 同 id 合并（op 级，kit 为既有权威）：WO-03 把旧 search kit 拆成了「认知工具（kits/search）
        // + 检索基建（modules/search）」两半，共享遗留 id——按 op 补缺而非整体覆盖。
        const existing = this.kits.get(kit.id);
        if (existing) {
          for (const [opId, op] of Object.entries(kit.ops)) {
            if (existing.ops[opId]) continue;
            existing.ops[opId] = op;
            const r = toResolved(existing, opId, op);
            if (!r.skill) continue;
            // 模块副本不进 bySkill 歧义表：派生节点走 kit+op 直查；kit 侧既有注册保持权威
            if (!this.bySkillIndex.has(r.skill)) this.bySkillIndex.set(r.skill, r);
          }
        } else {
          this.kits.set(kit.id, kit);
          for (const [opId, op] of Object.entries(kit.ops)) {
            const r = toResolved(kit, opId, op);
            if (!r.skill) continue;
            if (!this.bySkillIndex.has(r.skill)) this.bySkillIndex.set(r.skill, r);
          }
        }
      } catch {
        /* 坏模块跳过：module-lint 负责报警，内核不炸 */
      }
    }
  }

  all(): KitDef[] {
    return [...this.kits.values()];
  }

  get(kitId: string): KitDef | undefined {
    return this.kits.get(kitId);
  }

  /** 显式引用解析：kit+op 必须存在，否则 undefined（调用方决定是否报错）。 */
  resolve(kitId: string | undefined, opId: string | undefined): ResolvedOp | undefined {
    if (!kitId || !opId) return undefined;
    const kit = this.kits.get(kitId);
    const op = kit?.ops[opId];
    return kit && op ? toResolved(kit, opId, op) : undefined;
  }

  /** 兼容迁移期：节点只写 skill 时按技能反查（歧义技能不打散，交 kit-lint 报告）。 */
  bySkill(skill: string | undefined): ResolvedOp | undefined {
    return skill ? this.bySkillIndex.get(skill) : undefined;
  }

  ambiguousSkills(): string[] {
    return [...this.skillAmbiguous];
  }

  /** 根目录（任务包组装器用它定位 knowledge/）。 */
  rootDir(): string {
    return this.root;
  }
}

let cache: { root: string; reg: KitRegistry } | undefined;
export function kitRegistry(root: string): KitRegistry {
  if (!cache || cache.root !== root) cache = { root, reg: new KitRegistry(root) };
  return cache.reg;
}

// ---------------- R5：tool 内容配置项解析 ----------------

/**
 * 通用配置项：每个 tool 隐式享有（op 可用同名 key 覆写语义与默认值）。
 * 这是「所有 tool 的配置面统一参数化」的兜底——保证即使某个 op 的专属旋钮还没想清楚，
 * 它也不是不可调的。
 */
export const GENERIC_CONFIG: Record<string, OpConfigDef> = {
  depth: {
    type: "enum",
    enum: ["浅", "标准", "深"],
    default: "标准",
    desc: "本步投入深度：浅=先出可用版本，标准=默认，深=加采样与自检",
    effect: "提高 = 更充分但更慢更贵；连续无打回时可降档",
  },
  strictness: {
    type: "enum",
    enum: ["宽松", "标准", "严格"],
    default: "标准",
    desc: "判定尺度：本步自检与断言执行时把握的宽严",
    effect: "提高 = 早暴露问题（打回率↑、返工↓）；打回率已高时不宜再提",
  },
  maxChars: {
    type: "number",
    min: 200,
    max: 40000,
    default: 4000,
    unit: "字",
    desc: "本步产物正文的篇幅上限（超出即视为未收敛）",
    effect: "提高 = 允许更长产物；成本随字数上升",
  },
  /**
   * OS-02 阶段 D（D#14）：脚本壳/机器件的**执行超时**。
   * 此前 `contracts/minitool.schema.json` 声明了 `exec.timeoutMs`（默认 60000），但内核 spawn
   * 时**根本没传 timeout** ⇒ 脚本卡住 = 内核永久卡住（与阶段 A 修的 agent 侧「悬置」同一类故障，
   * 但那一侧只覆盖了认知步）。现把超时收进通用配置面（一处声明、处处可调），
   * 由 `minitools.ts::runCoreNode` 传给子进程；到时**显式失败**，不静默挂死、也不自动放行。
   */
  timeoutMs: {
    type: "number",
    min: 1000,
    max: 3600000,
    default: 60000,
    unit: "ms",
    desc: "本步执行体（script 壳 / 机器件）的超时上限，到时内核终止并显式报错",
    effect: "提高 = 容忍更慢的确定性脚本；过低会误杀长任务（复检/导 docx 类）",
    tunable_by: ["user", "optimizer"],
  },
  /**
   * R7 勘误（OS-02 阶段 C）：**缺省不声明 = 不约束**，不是 `high`。
   * 此前这里写死 `default: "high"`，等于引擎替所有作者拍板——契约
   * `contracts/module.schema.json` 的措辞早已改为「缺省不声明 = 无档位约束」，
   * 引擎却没跟上（又一处「声明面 ≠ 实际面」）。故**不设 default**：
   * `values.model_tier === undefined` 即「不约束」，由执行方按自身能力选档。
   */
  model_tier: {
    type: "enum",
    enum: ["high", "lite"],
    desc: "执行档位：high=强模型（文学/结构判断），lite=轻量档（可用即省）。**未声明 = 不约束**",
    effect: "文学与结构判断节点必须 high；机械整理类可降 lite；不声明则引擎不替作者拍板",
    tunable_by: ["user", "optimizer"],
  },
};

export type ConfigSource = "overlay" | "node" | "op" | "generic";

export interface ToolConfigResolution {
  /** 生效取值（default 已回填） */
  values: Record<string, unknown>;
  /** 生效声明（通用 + 专属合并） */
  defs: Record<string, OpConfigDef>;
  /** 逐键来源：面板据此显示「这个值从哪来」（overlay > node > op 默认 > 通用默认） */
  sources: Record<string, ConfigSource>;
  /** 节点/overlay 写了未声明的键 → 显式回显，不静默丢弃 */
  unknownKeys: string[];
  /** 只有这三个 key 生效（专属项为空时） */
  genericOnly: boolean;
}

/**
 * 生效配置合成（R5 §二）：overlay.opConfig > 节点 config > op.default > 通用默认。
 * `unknownKeys` 显式回显——「声明了却不存在」与「写了却没人认」都不许静默。
 */
export function resolveToolConfig(
  op: ResolvedOp | undefined,
  nodeConfig?: Record<string, unknown>,
  overrideConfig?: Record<string, unknown>,
): ToolConfigResolution {
  const opConfig = op?.config ?? {};
  const defs: Record<string, OpConfigDef> = { ...GENERIC_CONFIG, ...opConfig };
  const genericOnly = !op || Object.keys(op.config).length === 0;
  const values: Record<string, unknown> = {};
  const sources: Record<string, ConfigSource> = {};
  for (const [k, d] of Object.entries(defs)) {
    // OS-02 阶段 C：**无默认值的旋钮（如 model_tier）不进 values/sources**。
    // 原因有二：① 语义上「不约束」就是「没有值」，不该伪装成一个取值为 undefined 的条目
    //（`JSON.stringify` 又会把它丢掉 ⇒ 落盘前后 values/sources 键集不对称，读模型撒谎）；
    // ② 旋钮本身仍在 `defs` 里（能力有家），页面/任务包据「defs 有、values 无」显式标「未约束」。
    if (d.default === undefined) continue;
    values[k] = d.default;
    sources[k] = k in opConfig ? "op" : "generic";
  }

  const unknownKeys: string[] = [];
  const put = (src: Record<string, unknown> | undefined, from: "node" | "overlay"): void => {
    for (const [k, v] of Object.entries(src ?? {})) {
      if (v === undefined || v === null) continue;
      if (!(k in defs)) { unknownKeys.push(`${from}:${k}`); continue; }
      const d = defs[k];
      if (d.type === "number" && typeof v !== "number") { unknownKeys.push(`${from}:${k}(需 number，得 ${typeof v})`); continue; }
      if (d.type === "enum" && d.enum && !d.enum.includes(v)) { unknownKeys.push(`${from}:${k}=${String(v)} 不在 ${d.enum.join("/")}`); continue; }
      values[k] = v;
      sources[k] = from;
    }
  };
  put(nodeConfig, "node");
  put(overrideConfig, "overlay");
  return { values, defs, sources, unknownKeys, genericOnly };
}

/** 应用 tool 级 overlay（set-tool）：改的是 kit 侧声明，于是所有引用该 op 的节点一起生效。 */
export function applyToolOverride(op: ResolvedOp, ov: {
  add_knowledge?: string[]; remove_knowledge?: string[];
  add_asserts?: string[]; remove_asserts?: string[];
  model_tier?: "high" | "lite";
}): ResolvedOp {
  const rm = new Set(ov.remove_knowledge ?? []);
  const ra = new Set(ov.remove_asserts ?? []);
  return {
    ...op,
    knowledge: [...new Set([...op.knowledge.filter((k) => !rm.has(k)), ...(ov.add_knowledge ?? [])])],
    // glob 声明（kb/trope/*）无法用 exact 过滤删掉单条，走 exclude 名单——精确且可读
    excludeKnowledge: [...new Set([...op.excludeKnowledge, ...rm])],
    asserts: [...new Set([...op.asserts.filter((a) => !ra.has(a)), ...(ov.add_asserts ?? [])])],
    ...(ov.model_tier ? { modelTier: ov.model_tier } : {}),
  };
}
