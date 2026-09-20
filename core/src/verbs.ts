// miniflow 动词表 —— CLI / HTTP / MCP 三面**唯一**的动词声明源（R8-OPS 步骤 3）。
//
// 病灶（见 `docs/WO批次-开源广泛部署改造.md` · R8-OPS 讨论）：
//   动词表有四份副本 —— CLI 13 / MCP 7 / HTTP(POST /api/verbs/:verb) 4 / Skill 纯文档，
//   互不同步。`flow_init` 恰好「CLI 有、MCP 无、HTTP 无」⇒ **初始化面板所需的动词最不可达**。
//   与 N6（契约枚举 ↔ 引擎类型漂移）同源：同一事实写在多处，编译器与 lint 都看不见。
//
// 本文件是唯一台账，三面**只允许派生**：
//   · MCP  —— 逐条 registerTool（`mcp.ts`）
//   · HTTP —— `POST /api/verbs/:verb` 按表分派（`http.ts`）
//   · CLI  —— `usage()` 由表生成 + 按表分派（`cli.ts`）
// 禁止在任何一面再手抄一份动词清单；也禁止某一面「只有专用端点、不在表里」。
//
// 依赖方向：本文件只依赖 `kernel.ts`（的值 `deriveProjectName` 与类型）/`skills.ts`/`schema.js`，
// **不得** import cli/http/mcp —— 否则成环。
import fs from "node:fs";
import path from "node:path";
import { deriveProjectName } from "./kernel.js";
import type { Kernel } from "./kernel.js";
import { skillPatch } from "./skills.js";

export type VerbParamType = "string" | "number" | "boolean" | "record" | "string[]";

export interface VerbParam {
  /** 归一化后的键名（HTTP body / MCP args / 内核入参都用它，跨面同名） */
  name: string;
  /** CLI 长旗标（kebab）；缺省 = name */
  flag?: string;
  type: VerbParamType;
  required?: boolean;
  enum?: readonly string[];
  /** CLI usage 与 MCP tool 描述共用同一份说明 —— 两面同源 */
  desc: string;
}

export interface VerbDef {
  name: string;
  /** MCP tool description / CLI usage 注释 —— 两面同源 */
  description: string;
  /** usage 分组标题（同组连续排列） */
  group: string;
  params: VerbParam[];
  /** 由**归一化入参**调内核；三面共用同一条执行路径。 */
  run: (kernel: Kernel, args: Record<string, unknown>) => unknown | Promise<unknown>;
  /** CLI 专用：flags 无法就地归一化时的自定义映射（如 `--content-file` / `--patches <file>`）。 */
  fromFlags?: (kernel: Kernel, flags: Record<string, string | boolean>) => Record<string, unknown>;
}

// ── 归一化小工具（三面共用的「脏入参」折平）────────────────────────────
const S = (v: unknown): string | undefined =>
  v === undefined || v === null || v === "" || v === false ? undefined : String(v);
const B = (v: unknown): boolean | undefined =>
  v === undefined || v === null || v === "" ? undefined : v === true || v === "true" || v === "1";
const N = (v: unknown): number | undefined => (v === undefined || v === null || v === "" ? undefined : Number(v));

/**
 * 项目 id 解析：显式给了就用；没给就按输入自动命名并去重（`-2`/`-3`）。
 * CLI 原先在 `case "flow_run"` 里内联这段；现在抽出来，**HTTP/MCP 也走同一条**
 * ——否则「自动命名」会变成 CLI 独有能力（又一处能力不对称）。
 */
export function resolveProjectName(kernel: Kernel, inputs: Record<string, unknown>, explicit?: string): string {
  if (explicit) return explicit;
  const base = deriveProjectName(inputs) || `project-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}`;
  let name = base;
  let i = 2;
  const taken = (id: string) => fs.existsSync(path.join(kernel.root, "projects", id));
  while (taken(name)) name = `${base}-${i++}`;
  console.error(`[flow_run] 未指定 project，按灵感自动命名: ${name}`);
  return name;
}

/** 生成 `项目配置.json` 模板（`flow_init` 的落点；HTTP/MCP 亦可达）。 */
function writeConfigTemplate(kernel: Kernel, projectId: string): Record<string, unknown> {
  const dir = kernel.projectDir(projectId);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "项目配置.json");
  if (fs.existsSync(file)) return { exists: true, file };
  const template = {
    项目: projectId,
    题材: "",
    需求: "",
    灵感: "",
    严肃性: "标准",
    风格: "爽",
    AB测试: false,
    市场预估: "",
    presets: {},
  };
  fs.writeFileSync(file, JSON.stringify(template, null, 2) + "\n", "utf-8");
  return { created: file, hint: "填写后 flow_run 自动装载；显式入参 > 项目配置 > flow 默认" };
}

const G_KERNEL = "内核动词（七动词）";
const G_ORCH = "生成式编排（R5）";

/** 三面唯一的动词台账。新增动词只改这里 —— MCP/HTTP/CLI 自动跟上。 */
export const VERBS: VerbDef[] = [
  {
    name: "flow_list",
    description: "列出全部 flow（描述符）",
    group: G_KERNEL,
    params: [],
    run: (kernel) => kernel.flow_list(),
  },
  {
    name: "flow_run",
    description: "为项目开跑一条 flow（自动迁移 run-state.json；未指定项目时按灵感自动命名。CLI：其余 --k=v 自动作为 inputs，如 --题材/--灵感）",
    group: G_KERNEL,
    params: [
      { name: "flow", type: "string", required: true, desc: "flow id" },
      { name: "project", type: "string", desc: "项目 id（缺省按输入自动命名并去重）" },
      { name: "inputs", type: "record", desc: "flow.inputs 取值（显式入参 > 项目配置.json > flow 默认）" },
      { name: "config", type: "string", desc: "初始化配置 JSON 路径 → 落位为 <项目>/项目配置.json 后开跑" },
    ],
    run: async (kernel, a) => {
      const inputs = (a.inputs as Record<string, unknown>) ?? {};
      const project = resolveProjectName(kernel, inputs, S(a.project));
      const cfg = S(a.config);
      if (cfg) {
        const dir = kernel.projectDir(project);
        fs.mkdirSync(dir, { recursive: true });
        fs.copyFileSync(cfg, path.join(dir, "项目配置.json"));
      }
      return kernel.flow_run(String(a.flow), project, inputs);
    },
    // CLI：除 flow/project/config 外的 `--k=v` 一律当 inputs（与原行为一致）
    fromFlags: (_kernel, flags) => {
      const inputs: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(flags)) {
        if (!["flow", "project", "config"].includes(k) && typeof v === "string") inputs[k] = v;
      }
      return { flow: flags.flow, project: flags.project, inputs, config: flags.config };
    },
  },
  {
    name: "flow_init",
    description: "生成项目初始化配置模板（项目配置.json）——初始化面板的落点",
    group: G_KERNEL,
    params: [{ name: "project", type: "string", required: true, desc: "项目 id" }],
    run: (kernel, a) => writeConfigTemplate(kernel, String(a.project)),
  },
  {
    name: "flow_next",
    description: "推进到下一停靠点（awaiting_input / suspended / blocked / completed）",
    group: G_KERNEL,
    params: [
      { name: "project", type: "string", required: true, desc: "项目 id" },
      {
        name: "spawn_prompt",
        flag: "spawn-prompt",
        type: "boolean",
        desc: "附带渲染好的规范派发头（含项目背景卡，可直接作为 subagent 的 prompt）",
      },
    ],
    run: (kernel, a) => kernel.flow_next(String(a.project), { spawnPrompt: B(a.spawn_prompt) }),
  },
  {
    name: "flow_submit",
    description: "提交认知步产物（完整性断言不过 = rejected 打回；iterate 节点逐实例提交，seal 收口置 done。CLI：--content-file <path> 读文件当 content）",
    group: G_KERNEL,
    params: [
      { name: "project", type: "string", required: true, desc: "项目 id" },
      { name: "node", type: "string", required: true, desc: "节点 id" },
      { name: "content", type: "string", desc: "产物正文（与 file 二择一）" },
      { name: "file", type: "string", desc: "产物相对路径（相对项目目录）" },
      { name: "notes", type: "string", desc: "备注" },
      { name: "seal", type: "boolean", desc: "iterate 节点收口（置 done）" },
    ],
    run: (kernel, a) =>
      kernel.flow_submit(String(a.project), String(a.node), {
        content: S(a.content),
        file: S(a.file),
        notes: S(a.notes),
        seal: B(a.seal),
      }),
    fromFlags: (_kernel, flags) => ({
      project: flags.project,
      node: flags.node,
      content: flags["content-file"] ? fs.readFileSync(String(flags["content-file"]), "utf-8") : undefined,
      file: flags.file,
      seal: flags.seal,
    }),
  },
  {
    name: "flow_resume",
    description: "崩溃/失败/停机后恢复（恢复不读图，沿用快照内计划）",
    group: G_KERNEL,
    params: [{ name: "project", type: "string", required: true, desc: "项目 id" }],
    run: (kernel, a) => kernel.flow_resume(String(a.project)),
  },
  {
    name: "flow_gate",
    description: "提交人工裁决（pass / pass-with-conditions / send-back / reject；send-back 级联失效）",
    group: G_KERNEL,
    params: [
      { name: "project", type: "string", required: true, desc: "项目 id" },
      { name: "nodeId", flag: "node", type: "string", required: true, desc: "门节点 id" },
      {
        name: "verdict",
        type: "string",
        required: true,
        enum: ["pass", "pass-with-conditions", "send-back", "reject"],
        desc: "裁决出口",
      },
      { name: "comment", type: "string", desc: "裁决意见" },
      { name: "rootCauseStage", flag: "root-cause-stage", type: "string", desc: "send-back 指认的根因阶段 id" },
      { name: "round", type: "number", desc: "门轮次（旧轮次迟到裁决被拒）" },
      { name: "token", type: "string", desc: "挂起时返回的三重校验令牌" },
    ],
    run: (kernel, a) =>
      kernel.flow_gate(String(a.project), {
        nodeId: String(a.nodeId),
        verdict: String(a.verdict) as "pass" | "pass-with-conditions" | "send-back" | "reject",
        comment: S(a.comment),
        rootCauseStage: S(a.rootCauseStage),
        round: N(a.round),
        token: S(a.token),
      }),
  },
  {
    name: "flow_rerun",
    description: "重跑范围推演/执行（缓存命中语义：未变上游不重做）",
    group: G_KERNEL,
    params: [
      { name: "project", type: "string", required: true, desc: "项目 id" },
      { name: "nodeId", flag: "node", type: "string", required: true, desc: "目标节点 id" },
      { name: "dryRun", flag: "dry-run", type: "boolean", desc: "仅推演受影响子图，不落盘" },
    ],
    run: (kernel, a) =>
      kernel.flow_rerun(String(a.project), { nodeId: String(a.nodeId), dryRun: B(a.dryRun) ?? false }),
  },
  {
    name: "flow_effect",
    description: "生效编排 + 指标汇总（tool 效率 / 上下文命中率 / 诊断汇总）",
    group: G_ORCH,
    params: [{ name: "project", type: "string", required: true, desc: "项目 id" }],
    run: (kernel, a) => kernel.viewEffect(String(a.project)),
  },
  {
    name: "flow_mine",
    description: "组装编排挖掘包（journal/指标/中间文件），交编排挖掘师产出 findings@1",
    group: G_ORCH,
    params: [{ name: "project", type: "string", required: true, desc: "项目 id" }],
    run: (kernel, a) => kernel.flowMine(String(a.project)),
  },
  {
    name: "skill_patch",
    description: "提示词补丁（默认 proposed 不生效；须显式 approve 才装载）",
    group: G_ORCH,
    params: [
      {
        name: "action",
        type: "string",
        enum: ["add", "approve", "reject", "list"],
        desc: "缺省 add；approve/reject 需 id，list 可带 target",
      },
      { name: "id", type: "string", desc: "补丁 id（approve / reject）" },
      { name: "target", type: "string", desc: "目标 skill（相对 skills/ 的路径，不含 .md）" },
      { name: "text", type: "string", desc: "补丁正文（action=add）" },
      { name: "reason", type: "string", desc: "补丁理由（action=add）" },
      { name: "section", type: "string", desc: "插入小节" },
      { name: "op", type: "string", enum: ["append", "replace"], desc: "写入方式" },
      { name: "origin", type: "string", enum: ["user", "miner", "agent"], desc: "来源" },
    ],
    run: (kernel, a) => {
      const action = (S(a.action) ?? "add") as "add" | "approve" | "reject" | "list";
      // skills/ 是**仓库级**资产 ⇒ 落点取 `kernel.repoRoot`（缺省=ROOT；`--root` 重定向时跟随工作区）。
      // 此前 CLI 硬编码编译期 ROOT —— `--root` 下补丁会写到真实仓库，属静默错位。
      const repo = kernel.repoRoot;
      if (action === "list") return skillPatch(repo, { action: "list", target: S(a.target) });
      if (action === "approve" || action === "reject") return skillPatch(repo, { action, id: String(a.id) });
      return skillPatch(repo, {
        action: "add",
        target: String(a.target),
        text: String(a.text),
        reason: String(a.reason),
        section: S(a.section),
        op: S(a.op) as "append" | "replace" | undefined,
        origin: S(a.origin) as "user" | "miner" | "agent" | undefined,
      });
    },
    // CLI 保留原旗标面：--approve <id> / --reject <id> / --list / 否则 add
    fromFlags: (_kernel, flags) => ({
      action: flags.approve ? "approve" : flags.reject ? "reject" : flags.list ? "list" : "add",
      id: typeof flags.approve === "string" ? flags.approve : typeof flags.reject === "string" ? flags.reject : undefined,
      target: flags.target,
      text: flags.text,
      reason: flags.reason,
      section: flags.section,
      op: flags.op,
      origin: flags.origin,
    }),
  },
  {
    name: "flow_optimize",
    description: "由指标产出编排调优提案；--apply 落 overlay（低风险自动，其余待批）",
    group: G_ORCH,
    params: [
      { name: "project", type: "string", required: true, desc: "项目 id" },
      { name: "apply", type: "boolean", desc: "落 overlay（低风险自动，其余待批）" },
      { name: "actor", type: "string", desc: "操作者标识" },
    ],
    run: (kernel, a) => kernel.flowOptimize(String(a.project), { apply: B(a.apply) ?? false, actor: S(a.actor) }),
  },
  {
    name: "flow_overlay",
    description: "改写运行时编排（tool 的位置与内容配置）；--replan 立即重编译计划",
    group: G_ORCH,
    params: [
      { name: "project", type: "string", required: true, desc: "项目 id" },
      { name: "patches", type: "record", desc: "patch 数组或 {patches:[...]}（CLI 用 --patches <file.json>）" },
      { name: "approve", type: "string[]", desc: "批准待批 patch 的 id（逗号分隔）" },
      { name: "actor", type: "string", desc: "操作者" },
      { name: "reason", type: "string", desc: "改写理由" },
      { name: "replan", type: "boolean", desc: "立即重编译计划" },
    ],
    run: (kernel, a) => {
      let patches = a.patches as unknown;
      if (patches && !Array.isArray(patches) && typeof patches === "object" && Array.isArray((patches as { patches?: unknown }).patches)) {
        patches = (patches as { patches?: unknown }).patches;
      }
      const approve = Array.isArray(a.approve)
        ? a.approve.map(String)
        : S(a.approve)
          ? String(a.approve)
              .split(",")
              .map((x) => x.trim())
              .filter(Boolean)
          : undefined;
      return kernel.flowOverlay(String(a.project), {
        patches: patches as never,
        approve,
        actor: S(a.actor),
        reason: S(a.reason),
        replan: B(a.replan) ?? false,
      });
    },
    fromFlags: (_kernel, flags) => {
      const file = S(flags.patches);
      const raw: { patches?: unknown } | unknown[] | undefined = file
        ? JSON.parse(fs.readFileSync(file, "utf-8"))
        : undefined;
      const patches = Array.isArray(raw) ? raw : raw?.patches;
      return { project: flags.project, patches, approve: flags.approve, actor: flags.actor, reason: flags.reason, replan: flags.replan };
    },
  },
];

export const VERB_BY_NAME: Record<string, VerbDef> = Object.fromEntries(VERBS.map((v) => [v.name, v]));
export const VERB_NAMES: string[] = VERBS.map((v) => v.name);

/** CLI：按表把 flags 折成归一化入参（**纯函数**；需自定义映射的动词走 `def.fromFlags`）。 */
export function flagsToArgs(def: VerbDef, flags: Record<string, string | boolean>): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const p of def.params) {
    const key = p.flag ?? p.name;
    if (!(key in flags)) continue;
    const raw = flags[key];
    args[p.name] =
      p.type === "number" ? N(raw) : p.type === "boolean" ? raw === true || raw === "true" || raw === "1" : raw;
  }
  return args;
}

/** CLI `usage()` 的动词段 —— 由表生成，**不可能漂移**。 */
export function usageFromVerbs(): string {
  const lines: string[] = [];
  const groups: string[] = [];
  for (const v of VERBS) if (!groups.includes(v.group)) groups.push(v.group);
  for (const g of groups) {
    lines.push(`${g}:`);
    for (const v of VERBS.filter((x) => x.group === g)) {
      const syntax = v.params
        .map((p) => {
          const t = p.enum ? p.enum.join("|") : p.type === "record" ? "<json>" : p.type === "string[]" ? "<a,b>" : `<${p.type}>`;
          const tail = `${p.flag ?? p.name} ${t}`;
          return p.required ? `--${tail}` : `[--${tail}]`;
        })
        .join(" ");
      lines.push(`  ${v.name.padEnd(13)} ${syntax}`.trimEnd());
      lines.push(`  ${" ".repeat(13)} ${v.description}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
