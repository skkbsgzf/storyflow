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
// 依赖方向：本文件只依赖 `kernel.ts`（的值 `deriveProjectName` 与类型）/`skills.ts`/`schema.js` 与 `zod`，
// **不得** import cli/http/mcp —— 否则成环。
// R4：三面共用的 schema 形状（zod / JSON Schema）在本文件末尾**派生** —— 动词表是唯一台账，
// schema 只是它的投影；把 zodOf 放在 mcp.ts 会让 http.ts 反向依赖 MCP 模块（还把 SDK 拖进 HTTP 面）。
import { z } from "zod";
import { deriveProjectName } from "./kernel.js";
import { ProcExecutionError } from "./abstraction/proc.js";
import type { Kernel } from "./kernel.js";
import { skillPatch } from "./skills.js";
import { cfgTemplate, CfgTemplateError } from "./cfg-template.js";
import { setDecision, listDecisions, DecisionError } from "./decisions.js";
import { journalAppend } from "./journal.js";
import { loadState } from "./state.js";
import { KernelError } from "./kernel.js";
import { kbRead, kbSearch } from "./kb.js";
import { loadIntentGraph, syncIntentDecisions, IntentError } from "./intent.js";

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
  const taken = (id: string) => kernel.fs.exists(kernel.path.join(kernel.root, "projects", id));
  while (taken(name)) name = `${base}-${i++}`;
  console.error(`[flow_run] 未指定 project，按灵感自动命名: ${name}`);
  return name;
}

/** 生成 `项目配置.json` 模板（`flow_init` 的落点；HTTP/MCP 亦可达）。 */
function writeConfigTemplate(kernel: Kernel, projectId: string): Record<string, unknown> {
  const dir = kernel.projectDir(projectId);
  kernel.fs.mkdir(dir, { recursive: true });
  const file = kernel.path.join(dir, "项目配置.json");
  if (kernel.fs.exists(file)) return { exists: true, file };
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
  kernel.fs.writeText(file, JSON.stringify(template, null, 2) + "\n");
  return { created: file, hint: "填写后 flow_run 自动装载；显式入参 > 项目配置 > flow 默认" };
}

const G_KERNEL = "内核动词（七动词）";
const G_ORCH = "生成式编排（R5）";
const G_CHOICE = "选择面（R8）";
const G_WB = "世界书（GraphHyperRAG）";
const G_IG = "立意图（决策桥）";
const G_BRIDGE = "底座工具桥（挂表）";

/** 子进程转发：脚本本体出真相，本函数只拼参数、捕获 stdout、失败带 stderr 摘要抛错。
 *  JSON 输出自动解析；PYTHONIOENCODING=utf-8 规避 Windows GBK 解码缺陷（v5.0.1 已知问题）。 */
function bridge(kernel: Kernel, cmd: string, args: string[], timeoutMs = 180_000): unknown {
  let stdout: string;
  try {
    stdout = kernel.proc.exec(cmd, args, {
      cwd: kernel.root, timeoutMs, maxBufferBytes: 32 * 1024 * 1024,
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    });
  } catch (e) {
    // env 面（process.env）留在宿主：FS1 v1 只抽象磁盘与进程，规范 §3.1 普查无环境变量注入。
    const err = e as ProcExecutionError;
    throw new KernelError("BRIDGE_FAIL", 502, `${cmd} ${args.slice(0, 2).join(" ")} 失败(exit=${err.status ?? "?"}): ${String(err.stderr || err.message || e).slice(0, 1200)}`);
  }
  const text = stdout.trim();
  try { return JSON.parse(text); } catch { return text; }
}

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
        kernel.fs.mkdir(dir, { recursive: true });
        kernel.fs.copy(cfg, kernel.path.join(dir, "项目配置.json"));
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
    name: "cfg_template",
    description:
      "项目配置模板库：列出 / 自存 / 套用 / 删除（套用「从零新建」= 只写必填「项目」的空白配置）。" +
      "模板落在 <root>/templates/项目配置/<flow>/<名>.json（项目之外，跨项目可复用）；官方示例读 demos/<flow>/项目配置.json（只读）",
    group: G_KERNEL,
    params: [
      {
        name: "action", type: "string", required: true, enum: ["list", "save", "apply", "delete"],
        desc: "list=列模板 / save=把项目的配置存为模板 / apply=套用模板到项目 / delete=删自存模板",
      },
      { name: "project", type: "string", desc: "save / apply 的目标项目 id" },
      { name: "name", type: "string", desc: "模板名（save / apply / delete）；apply 传「从零新建」表示空白配置" },
      { name: "flow", flag: "flow", type: "string", desc: "限定/指定 flow id（不传则按项目 state.json 判定）" },
      { name: "overwrite", type: "boolean", desc: "save 时覆盖同名模板（缺省拒绝，不静默覆盖）" },
      { name: "force", type: "boolean", desc: "apply 时跨 flow 套用（缺省拒绝：输入面/阈值未必兼容，须人确认）" },
    ],
    run: (kernel, a) => {
      try {
        return cfgTemplate(
          kernel,
          {
            action: String(a.action),
            project: a.project === undefined ? undefined : String(a.project),
            name: a.name === undefined ? undefined : String(a.name),
            flowId: a.flow === undefined ? undefined : String(a.flow),
            overwrite: B(a.overwrite),
            force: B(a.force),
          },
          kernel.fs,
          kernel.path,
        );
      } catch (e) {
        // 用户在模板库里能改的错（名字非法/不存在/跨 flow/已存在）必须原样带着 4xx 码出去，
        // 不许被三面当成「服务器内部错误」——把用户手误报成 500 与「崩掉当没事」是同一种病。
        if (e instanceof CfgTemplateError) throw new KernelError(e.code, e.http, e.message);
        throw e;
      }
    },
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
    fromFlags: (kernel, flags) => ({
      project: flags.project,
      node: flags.node,
      content: flags["content-file"] ? kernel.fs.readText(String(flags["content-file"])) : undefined,
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
      if (action === "list") return skillPatch(repo, { action: "list", target: S(a.target) }, kernel.fs, kernel.path);
      if (action === "approve" || action === "reject") return skillPatch(repo, { action, id: String(a.id) }, kernel.fs, kernel.path);
      return skillPatch(
        repo,
        {
          action: "add",
          target: String(a.target),
          text: String(a.text),
          reason: String(a.reason),
          section: S(a.section),
          op: S(a.op) as "append" | "replace" | undefined,
          origin: S(a.origin) as "user" | "miner" | "agent" | undefined,
        },
        kernel.fs,
        kernel.path,
      );
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
    fromFlags: (kernel, flags) => {
      const file = S(flags.patches);
      const raw: { patches?: unknown } | unknown[] | undefined = file
        ? JSON.parse(kernel.fs.readText(file))
        : undefined;
      const patches = Array.isArray(raw) ? raw : raw?.patches;
      return { project: flags.project, patches, approve: flags.approve, actor: flags.actor, reason: flags.reason, replan: flags.replan };
    },
  },
  {
    name: "set_decision",
    description:
      "落一条决策事实（decision@1 → <项目>/decisions/<key>.json）。选择面的唯一写入口：by/evidence 必填，无来源的决策=猜即拒（R8 铁律 3）",
    group: G_CHOICE,
    params: [
      { name: "project", type: "string", required: true, desc: "项目 id" },
      { name: "key", type: "string", required: true, desc: "决策键（genre/style/structure/route…，文件名即键）" },
      { name: "picked", type: "string[]", required: true, desc: "选中标签（逗号分隔，与 catalog.tags 求交）" },
      { name: "by", type: "string", required: true, desc: "谁做的决策：产出判断的节点 id 或 user" },
      { name: "evidence", type: "string", required: true, desc: "依据哪份产物（如 01-选题/选题报告.md#§2）" },
      { name: "excludedTags", flag: "excluded-tags", type: "string[]", desc: "反向排除的标签（逗号分隔，可选）" },
      { name: "confidence", type: "number", desc: "置信度 0-1（可选）" },
      { name: "actor", type: "string", desc: "journal 记录者（缺省 user）" },
    ],
    run: (kernel, a) => {
      const split = (v: unknown): string[] | undefined =>
        Array.isArray(v)
          ? v.map(String).filter(Boolean)
          : S(v)
            ? String(v).split(",").map((x) => x.trim()).filter(Boolean)
            : undefined;
      const projectDir = kernel.projectDir(String(a.project));
      let d;
      try {
        d = setDecision(kernel, projectDir, {
          key: String(a.key),
          picked: split(a.picked) ?? [],
          by: String(a.by ?? ""),
          evidence: String(a.evidence ?? ""),
          excluded_tags: split(a.excludedTags),
          confidence: N(a.confidence),
        });
      } catch (e) {
        // 决策入参错是用户手误，须带 4xx 原样出去（同 cfg_template 惯例），不许报 500
        if (e instanceof DecisionError) throw new KernelError(e.code, 400, e.message);
        throw e;
      }
      try {
        const st = loadState(projectDir, kernel.fs, kernel.path);
        journalAppend(kernel, projectDir, st?.runId ?? "-", "note", {
          actor: S(a.actor) ?? "user",
          detail: `决策落盘 decision:${d.key} ← picked[${d.picked.join(",")}]${d.excluded_tags?.length ? ` 排除[${d.excluded_tags.join(",")}]` : ""}（by=${d.by}，evidence=${d.evidence}）`,
        });
      } catch {
        /* journal 失败不吞决策——决策已原子落盘，审计缺痕单独可见 */
      }
      return d;
    },
  },
  {
    name: "list_decisions",
    description: "读项目全部决策事实（坏条目进 issues 不静默）——回答「这一步凭什么这么选」",
    group: G_CHOICE,
    params: [{ name: "project", type: "string", required: true, desc: "项目 id" }],
    run: (kernel, a) => listDecisions(kernel, kernel.projectDir(String(a.project))),
  },
  {
    name: "kb_search",
    description: "检索知识库（95 张方法论/标尺卡：aesthetic/craft/market/structure/rules/trope…）——标题/标签/正文打分排序",
    group: "知识库（KB 只读）",
    params: [
      { name: "q", type: "string", required: true, desc: "查询词（标题/标签/正文，多词空格分隔）" },
      { name: "dir", type: "string", desc: "限定子目录（aesthetic/craft/market/structure/rules/trope…）" },
      { name: "k", type: "number", desc: "条数上限（默认 8）" },
    ],
    run: (kernel, a) => kbSearch(kernel.path.join(kernel.repoRoot, "knowledge"), {
      q: String(a.q ?? ""),
      dir: a.dir === undefined ? undefined : String(a.dir),
      k: a.k === undefined ? undefined : Number(a.k),
    }, kernel.fs, kernel.path),
  },
  {
    name: "kb_read",
    description: "读知识卡正文（ref = 卡片 id 如 kb/aesthetic/character，或相对 knowledge/ 的路径）",
    group: "知识库（KB 只读）",
    params: [
      { name: "ref", type: "string", required: true, desc: "卡片 id 或相对路径" },
      { name: "max_chars", flag: "max-chars", type: "number", desc: "截断上限（默认 16000）" },
    ],
    run: (kernel, a) => kbRead(kernel.path.join(kernel.repoRoot, "knowledge"), String(a.ref ?? ""), a.max_chars === undefined ? undefined : Number(a.max_chars), kernel.fs, kernel.path),
  },
  {
    name: "worldbook_search",
    description:
      "GraphHyperRAG 世界书检索（创作时 agent 直调）：标题/tag/摘要打分 + 一跳关系扩展。" +
      "归纳层 = 世界书/graph.json（tools/worldbook-index.py 重建，world-forge 交卷即刷新）；" +
      "查看层 = projects/<id>/worldbook.html（pedia 页）",
    group: G_WB,
    params: [
      { name: "project", type: "string", required: true, desc: "项目 id" },
      { name: "q", type: "string", required: true, desc: "查询词（标题/tag/摘要；多词空格分隔，任一命中即计分）" },
      { name: "cat", type: "string", desc: "限定分类（人物/设定/势力/场景/道具/伏笔/底牌/总览…）" },
      { name: "k", type: "number", desc: "命中条数上限（默认 6）" },
    ],
    run: (kernel, a) =>
      kernel.worldbookSearch(String(a.project), {
        q: String(a.q ?? ""),
        cat: a.cat === undefined ? undefined : String(a.cat),
        k: a.k === undefined ? undefined : Number(a.k),
      }),
  },
  // ── 立意图（intent-graph@1，方案盘 20260924）：宇宙级可能空间 → 项目决策单向桥。
  //    图 CRUD 本体 = tools/intent-graph.py（单一实现），此处只桥接；
  //    ig_sync 是例外——落 decision@1 走内核 setDecision 单源，不在 Python 手写决策文件。
  //    chat agent 白名单只放 ig_load/ig_propose（提案制：AI 提案、人拍板、系统记账）。
  {
    name: "ig_load",
    description:
      "读宇宙立意图（intent-graph@1：节点+候选+剪枝排序分+committed/excluded 证据）。" +
      "存储 universes/<uid>/intent-graph.json，项目经 项目配置.json.universeId 绑定",
    group: G_IG,
    params: [{ name: "universe", type: "string", required: true, desc: "宇宙 id（u-*）" }],
    run: (kernel, a) => bridge(kernel, "python", ["tools/intent-graph.py", "show", "--universe", String(a.universe), "--json"]),
  },
  {
    name: "ig_propose",
    description:
      "向立意图节点追加候选提案（status=proposed，不 commit）。红线：带 p 必须带有效 scorer" +
      "（semif-4b/laya-student/jev-api；untested 禁带 p——不编造概率）；excluded/commit 归人（ig_commit/ig_exclude 不进 agent 环）",
    group: G_IG,
    params: [
      { name: "universe", type: "string", required: true, desc: "宇宙 id（u-*）" },
      { name: "node", type: "string", required: true, desc: "节点 id" },
      { name: "id", type: "string", required: true, desc: "候选 id（小写连字符，id 永不复用）" },
      { name: "title", type: "string", desc: "候选短题" },
      { name: "content", type: "string", desc: "候选陈述" },
      { name: "scorer", type: "string", required: true, enum: ["semif-4b", "laya-student", "jev-api"] as const, desc: "打分来源（agent 提案禁 scorer=human/untested）" },
      { name: "p", type: "number", desc: "剪枝排序分 0..1（选填；与 scorer 成对）" },
      { name: "evidence", type: "string", desc: "提案依据（可溯源，无证据不立案）" },
    ],
    run: (kernel, a) =>
      bridge(kernel, "python", [
        "tools/intent-graph.py", "add-candidate",
        "--universe", String(a.universe), "--node", String(a.node), "--id", String(a.id),
        "--scorer", String(a.scorer),
        ...(a.title === undefined ? [] : ["--title", String(a.title)]),
        ...(a.content === undefined ? [] : ["--content", String(a.content)]),
        ...(a.p === undefined ? [] : ["--p", String(a.p)]),
        ...(a.evidence === undefined ? [] : ["--evidence", String(a.evidence)]),
      ]),
  },
  {
    name: "ig_commit",
    description: "拍板：候选置 committed（节点随之 committed）。必须带 reason（拍板留痕，R8）；决策落盘另走 ig_sync",
    group: G_IG,
    params: [
      { name: "universe", type: "string", required: true, desc: "宇宙 id" },
      { name: "node", type: "string", required: true, desc: "节点 id" },
      { name: "candidate", type: "string", required: true, desc: "候选 id" },
      { name: "reason", type: "string", required: true, desc: "拍板理由（并入 evidence 留痕）" },
    ],
    run: (kernel, a) =>
      bridge(kernel, "python", ["tools/intent-graph.py", "commit", "--universe", String(a.universe), "--node", String(a.node), "--candidate", String(a.candidate), "--reason", String(a.reason)]),
  },
  {
    name: "ig_exclude",
    description: "排除候选（必须带理由——「为什么没选 X」不许哑，R8）",
    group: G_IG,
    params: [
      { name: "universe", type: "string", required: true, desc: "宇宙 id" },
      { name: "node", type: "string", required: true, desc: "节点 id" },
      { name: "candidate", type: "string", required: true, desc: "候选 id" },
      { name: "reason", type: "string", required: true, desc: "排除理由" },
    ],
    run: (kernel, a) =>
      bridge(kernel, "python", ["tools/intent-graph.py", "exclude", "--universe", String(a.universe), "--node", String(a.node), "--candidate", String(a.candidate), "--reason", String(a.reason)]),
  },
  {
    name: "ig_sync",
    description:
      "立意图 → 项目决策单向桥：committed 候选落 decisions/<decision_key>.json" +
      "（setDecision 单源；已存在不回填；证据带 scorer+p 明示「剪枝排序分，禁当放行闸」）",
    group: G_IG,
    params: [
      { name: "universe", type: "string", required: true, desc: "宇宙 id" },
      { name: "project", type: "string", required: true, desc: "目标项目 id" },
    ],
    run: (kernel, a) => {
      let g;
      try {
        g = loadIntentGraph(kernel.root, String(a.universe), kernel.fs, kernel.path);
      } catch (e) {
        if (e instanceof IntentError) throw new KernelError(e.code, e.code === "INTENT_MISSING" ? 404 : 400, e.message);
        throw e;
      }
      const projectDir = kernel.projectDir(String(a.project));
      const res = syncIntentDecisions(projectDir, g, kernel);
      if (res.written.length) {
        try {
          const st = loadState(projectDir, kernel.fs, kernel.path);
          journalAppend(kernel, projectDir, st?.runId ?? "-", "note", {
            actor: S(a.actor) ?? "user",
            detail: `立意图同步 decision:[${res.written.map((w) => w.key).join(",")}] ← universe:${g.universe}（单向桥，已存在不回填）`,
          });
        } catch {
          /* journal 失败不吞同步结果——决策已落盘，审计缺痕单独可见 */
        }
      }
      return res;
    },
  },
  // ── 底座工具桥（挂表）：Python/脚本件收编进动词表，**逻辑本体不重写**——
  //    动词只做参数拼装 + 子进程转发，stdout 可 JSON 化则解析返回。
  //    事故口径（2026-09-22 耗时复盘）：这些件此前只能 bash 起，会话白付冷启动。
  {
    name: "whereami",
    description: "我在哪：项目/当前节点/必读输入/应产输出（tools/whereami.py 转发；开工定位）",
    group: G_BRIDGE,
    params: [
      { name: "project", type: "string", desc: "项目 id（多项目歧义时必给，工具返回 AMBIGUOUS 不静默猜）" },
      { name: "json", type: "boolean", desc: "JSON 口径输出（默认文本）" },
    ],
    run: (kernel, a) =>
      bridge(kernel, "python", ["tools/whereami.py", ...(a.project ? ["--project", String(a.project)] : []), ...(a.json ? ["--json"] : [])]),
  },
  {
    name: "snapshot",
    description: "交付快照 capture / 两版 diff（tools/snapshot.py 转发；铁律 7：产物落盘后留档）",
    group: G_BRIDGE,
    params: [
      { name: "action", type: "string", required: true, enum: ["capture", "diff"] as const, desc: "capture=落盘快照；diff=两版对照" },
      { name: "flow", type: "string", desc: "capture 必填：flow id" },
      { name: "project", type: "string", required: true, desc: "项目 id" },
      { name: "node", type: "string", required: true, desc: "节点 id" },
      { name: "files", type: "string[]", desc: "capture 必填：相对项目目录的文件清单" },
      { name: "note", type: "string", desc: "快照备注" },
      { name: "a", type: "string", desc: "diff：版本 A" },
      { name: "b", type: "string", desc: "diff：版本 B" },
    ],
    run: (kernel, a) => {
      if (a.action === "capture") {
        if (!a.flow) throw new KernelError("BAD_ARGS", 400, "snapshot capture 需要 flow");
        if (!Array.isArray(a.files) || !a.files.length) throw new KernelError("BAD_ARGS", 400, "snapshot capture 需要 files[]");
        return bridge(kernel, "python", ["tools/snapshot.py", "capture", String(a.flow), String(a.project), String(a.node), "--files", a.files.join(","), "--note", String(a.note ?? "")]);
      }
      if (!a.a || !a.b) throw new KernelError("BAD_ARGS", 400, "snapshot diff 需要 --a/--b 两个版本");
      return bridge(kernel, "python", ["tools/snapshot.py", "diff", String(a.project), String(a.node), "--a", String(a.a), "--b", String(a.b)]);
    },
  },
  {
    name: "quality_scan",
    description: "确定性质量扫描：证据聚合器（tools/quality-scan.py 转发 = core quality-cli 桥 aesthetic 真身，禁止第二份计数逻辑）；只出证据+收据，裁决归 agent/人裁",
    group: G_BRIDGE,
    params: [
      { name: "project", type: "string", required: true, desc: "项目 id" },
      { name: "file", type: "string", required: true, desc: "项目内相对路径（待扫文件）" },
      { name: "budget", type: "record", desc: "阈值覆盖（键须在 R7 §二 C 表白名单内，未知键显式回显不静默）" },
      { name: "no_receipt", type: "boolean", desc: "true = 不落收据（默认落 内部/收据/，报数必引收据）" },
    ],
    run: (kernel, a) =>
      bridge(kernel, "python", [
        "tools/quality-scan.py", "--project", String(a.project), "--file", String(a.file),
        ...(a.budget ? ["--budget", JSON.stringify(a.budget)] : []),
        ...(a.no_receipt ? ["--no-receipt"] : []),
      ]),
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

// ── R4 · 三面共用的 schema 派生（MCP inputSchema ∷ HTTP 入参前置校验 ∷ OpenAPI 组件）────

/** 动词参数 → zod（MCP tool 的 inputSchema 与 HTTP 前置校验共用同一份形状）。 */
export function zodOf(p: VerbParam): z.ZodTypeAny {
  let base: z.ZodTypeAny;
  switch (p.type) {
    case "number":
      base = z.number();
      break;
    case "boolean":
      base = z.boolean();
      break;
    case "record":
      base = z.record(z.string(), z.unknown());
      break;
    case "string[]":
      base = z.array(z.string());
      break;
    default:
      base = p.enum ? z.enum(p.enum as [string, ...string[]]) : z.string();
  }
  return p.required ? base : base.optional().describe(p.desc);
}

/** 动词表 → MCP tool 形状（`mcp.ts` 逐条 registerTool 用；测试据此断言「MCP 面 = 表」）。 */
export function verbToolSpecs(): { name: string; description: string; inputSchema: Record<string, z.ZodTypeAny> }[] {
  return VERBS.map((def) => {
    const inputSchema: Record<string, z.ZodTypeAny> = {};
    for (const p of def.params) inputSchema[p.name] = zodOf(p);
    // required 的参数把 desc 挂在 description 上（zod 的 .describe 对 optional 已用，这里对必填补一次）
    for (const p of def.params) {
      const sch = inputSchema[p.name];
      if (p.required && sch) inputSchema[p.name] = sch.describe(p.desc);
    }
    return { name: def.name, description: def.description, inputSchema };
  });
}

/** 动词参数 → JSON Schema（OpenAPI 生成脚本用；与 `zodOf` 同一张表同一判据，不许两份漂移）。 */
export function jsonSchemaOf(p: VerbParam): Record<string, unknown> {
  const s: Record<string, unknown> =
    p.type === "number"
      ? { type: "number" }
      : p.type === "boolean"
        ? { type: "boolean" }
        : p.type === "record"
          ? { type: "object", additionalProperties: true }
          : p.type === "string[]"
            ? { type: "array", items: { type: "string" } }
            : p.enum
              ? { type: "string", enum: [...p.enum] }
              : { type: "string" };
  s.description = p.desc;
  return s;
}

/** 动词 → OpenAPI 请求体的 JSON Schema（properties 用归一化键名，与 HTTP body 同名）。 */
export function verbJsonSchema(def: VerbDef): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const p of def.params) {
    properties[p.name] = jsonSchemaOf(p);
    if (p.required) required.push(p.name);
  }
  const schema: Record<string, unknown> = { type: "object", properties };
  if (required.length) schema.required = required;
  return schema;
}

/**
 * 动词入参前置校验（R4）：脏参数在门口拦下，不再灌进内核换一句业务错。
 * 返回 issues 数组（空 = 通过）——响应形状由调用方定（REST 出 400 VALIDATION 包装，MCP 由 SDK 自己校验）。
 */
export function verbArgIssues(def: VerbDef, args: Record<string, unknown>): string[] {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const p of def.params) shape[p.name] = zodOf(p);
  const parsed = z.object(shape).safeParse(args ?? {});
  if (parsed.success) return [];
  return parsed.error.issues.map((i) => `${i.path.join(".") || "<body>"}: ${i.message}`);
}
