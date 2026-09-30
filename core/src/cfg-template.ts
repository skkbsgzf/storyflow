/**
 * OS-04 余量 · 项目配置模板库（自存模板 / 从零新建 / 套用 / 删除）。
 *
 * 为什么是内核模块而不是页面本地逻辑：
 *   ① 模板要**跨项目复用** ⇒ 必须落在项目之外的稳定位置（`<root>/templates/项目配置/<flowId>/<名>.json`），
 *      不能存在单个项目目录里（项目删了模板就没了）；
 *   ② 套用前必须过 `project-config` schema 校验、且必须核对 flow 是否匹配——
 *      这两件事只允许有**一处**实现，页面（纯 stdlib python + 浏览器 JS）不许各写一遍。
 *
 * 三种来源、一个清单（面板只渲染 `list` 的结果，不自己扫盘）：
 *   · `blank`    从零新建：只含必填 `项目`——**不抄官方默认**，避免把别的项目的偏好悄悄带进来
 *   · `official` 仓库内 `demos/<flowId>/项目配置.json`（只读，删不掉）
 *   · `user`     `<root>/templates/项目配置/<flowId>/<名>.json`（自存，可删）
 *
 * 错误分类：**用户能改的错（名字非法/不存在/跨 flow）一律 4xx**，不许被当成「服务器内部错误」上报
 * ——把用户手误报成 500 与「崩掉当没事」是同一种病（HTTP/CLI/MCP 三面共用这套码）。
 */
import fs from "node:fs";
import path from "node:path";
import { assertSchema } from "./schema.js";
import { loadState } from "./state.js";

/**
 * 本模块自己的错误类型（**不 import kernel.ts**：kernel.ts 要 import 本模块落读模型，
 * 反向引 KernelError 就成环——见 verbs.ts 头部的依赖方向约定）。
 * `verbs.ts` 在动词边界把它映射成 `KernelError`，三面（CLI/HTTP/MCP）拿到的仍是统一错误码。
 */
export class CfgTemplateError extends Error {
  constructor(public code: string, public http: number, message: string) {
    super(message);
    this.name = "CfgTemplateError";
  }
}

export const CFG_TEMPLATE_SUBDIR = path.join("templates", "项目配置");
export const CONFIG_FILE_NAME = "项目配置.json";

/** 模板名白名单：不允许需要转义的字符 ⇒ **文件名即模板名**，不产生「悄悄改名」。 */
const NAME_RE = /^[\w\u4e00-\u9fff][\w\u4e00-\u9fff.·\-]{0,39}$/;

export interface CfgTemplateEntry {
  name: string;
  /** 该模板属于哪条 flow；`blank` 视请求而定，故记为 `*` */
  flowId: string;
  source: "official" | "user" | "blank";
  /** 盘上路径（blank 无） */
  path?: string;
  /** 模板里写了哪些键（面板直接显示，省得打开文件看） */
  keys: string[];
  /** 是否带了阈值预算覆盖（面板给个提示：套用会改阈值） */
  hasBudget: boolean;
  updatedAt?: string;
  /** 只读原因 / 附加说明 */
  note?: string;
}

export interface CfgTemplateKernel {
  /** 数据根：`templates/项目配置/`（用户自存）所在处 */
  readonly root: string;
  /** 仓库根：`demos/`（随仓库发布的官方示例）所在处。二者**必须分开**——否则临时数据根下示例模板会凭空消失 */
  readonly repoRoot: string;
  projectDir(projectId: string): string;
}

/** 模板清单的扫描面。`dataRoot`（用户自存）与 `repoRoot`（官方示例）分开传，不对它们做任何「缺省相等」的假设。 */
export interface CfgTemplateScope {
  dataRoot: string;
  repoRoot?: string;
  /** 只列该 flow 的（含 synthetic `blank`）；缺省 = 全部 */
  flowId?: string;
}

function storeDir(root: string): string {
  return path.join(root, CFG_TEMPLATE_SUBDIR);
}

function templatePath(root: string, flowId: string, name: string): string {
  return path.join(storeDir(root), flowId, `${name}.json`);
}

function readTemplate(file: string): { raw: Record<string, unknown>; keys: string[]; hasBudget: boolean } {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch (e) {
    throw new CfgTemplateError("BAD_TEMPLATE", 409, `模板不是合法 JSON: ${file}（${e instanceof Error ? e.message : String(e)}）`);
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new CfgTemplateError("BAD_TEMPLATE", 409, `模板顶层必须是对象: ${file}`);
  }
  const obj = raw as Record<string, unknown>;
  const keys = Object.keys(obj);
  return { raw: obj, keys, hasBudget: !!(obj["阈值预算"] && typeof obj["阈值预算"] === "object") };
}

/** 项目的 flow id（读 state.json；未开跑返回 undefined —— 不猜）。 */
function projectFlowId(kernel: CfgTemplateKernel, projectId: string): string | undefined {
  try {
    return loadState(kernel.projectDir(projectId))?.flowId;
  } catch {
    return undefined;
  }
}

function assertName(name: string): string {
  const n = String(name ?? "").trim();
  if (!NAME_RE.test(n)) {
    throw new CfgTemplateError(
      "INVALID_INPUT",
      400,
      `模板名非法：「${n}」（只允许中英文/数字/_/-/./·，1–40 字，且不得含路径分隔符——文件名即模板名，不做静默改名）`,
    );
  }
  return n;
}

/**
 * 模板清单。`flowId` 给了就只列该 flow 的（含 synthetic `blank`）。
 * 目录不存在/文件非法**不静默**：`skipped` 字段如实回报坏文件。
 */
export function listConfigTemplates(scope: CfgTemplateScope): { entries: CfgTemplateEntry[]; skipped: string[] } {
  const { dataRoot, flowId } = scope;
  const demosRoot = scope.repoRoot ?? dataRoot;
  const entries: CfgTemplateEntry[] = [];
  const skipped: string[] = [];

  entries.push({
    name: "从零新建",
    flowId: flowId ?? "*",
    source: "blank",
    keys: ["项目"],
    hasBudget: false,
    note: "只写必填的「项目」，其余留空 ⇒ 全走 flow 默认（不继承任何已有项目的偏好）",
  });

  // 官方示例：仓库内 demos/<flowId>/项目配置.json（只读）
  const demosDir = path.join(demosRoot, "demos");
  if (fs.existsSync(demosDir)) {
    for (const d of fs.readdirSync(demosDir).sort()) {
      const f = path.join(demosDir, d, CONFIG_FILE_NAME);
      if (!fs.existsSync(f)) continue;
      if (flowId && d !== flowId) continue;
      try {
        const { keys, hasBudget } = readTemplate(f);
        entries.push({
          name: `官方示例（${d}）`, flowId: d, source: "official", path: f, keys, hasBudget,
          note: "随仓库发布的示例配置，只读",
        });
      } catch (e) {
        skipped.push(`${f}（${e instanceof Error ? e.message : String(e)}）`);
      }
    }
  }

  // 用户自存：templates/项目配置/<flowId>/<名>.json
  const dir = storeDir(dataRoot);
  if (fs.existsSync(dir)) {
    for (const fid of fs.readdirSync(dir).sort()) {
      const sub = path.join(dir, fid);
      if (!fs.statSync(sub).isDirectory()) continue;
      if (flowId && fid !== flowId) continue;
      for (const n of fs.readdirSync(sub).sort()) {
        if (!n.endsWith(".json")) continue;
        const f = path.join(sub, n);
        try {
          const { keys, hasBudget } = readTemplate(f);
          entries.push({
            name: n.replace(/\.json$/, ""), flowId: fid, source: "user", path: f, keys, hasBudget,
            updatedAt: fs.statSync(f).mtime.toISOString(),
          });
        } catch (e) {
          skipped.push(`${f}（${e instanceof Error ? e.message : String(e)}）`);
        }
      }
    }
  }
  return { entries, skipped };
}

/** 自存模板：把项目的 `项目配置.json` 原样存进模板库（校验失败即拒绝，不存坏模板）。 */
export function saveConfigTemplate(
  kernel: CfgTemplateKernel,
  req: { project: string; name: string; overwrite?: boolean; flowId?: string },
): Record<string, unknown> {
  const name = assertName(req.name);
  const projectId = String(req.project ?? "").trim();
  if (!projectId) throw new CfgTemplateError("INVALID_INPUT", 400, "save 需要 project（要存哪个项目的配置）");
  const src = path.join(kernel.projectDir(projectId), CONFIG_FILE_NAME);
  if (!fs.existsSync(src)) {
    throw new CfgTemplateError("NOT_FOUND", 404, `项目没有 ${CONFIG_FILE_NAME}（先 flow_init 或面板保存一次）: ${src}`);
  }
  const { raw } = readTemplate(src);
  try {
    assertSchema("project-config", raw);
  } catch (e) {
    throw new CfgTemplateError("INVALID_INPUT", 400, `${CONFIG_FILE_NAME} 不合 project-config 契约，拒绝存为模板: ${e instanceof Error ? e.message : String(e)}`);
  }
  const flowId = req.flowId ?? projectFlowId(kernel, projectId);
  if (!flowId) throw new CfgTemplateError("INVALID_INPUT", 400, `无法判定项目的 flow（无 state.json）：请显式传 --flow`);
  const dst = templatePath(kernel.root, flowId, name);
  const overwritten = fs.existsSync(dst);
  if (overwritten && !req.overwrite) {
    throw new CfgTemplateError("CONFIG_EXISTS", 409, `模板已存在：${name}（flow ${flowId}）。要覆盖请显式传 overwrite=true`);
  }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(dst, JSON.stringify(raw, null, 2) + "\n", "utf-8");
  return { saved: name, flowId, file: dst, overwritten, keys: Object.keys(raw) };
}

/** 按名解析模板文件。歧义（同名跨 flow）/ 不存在 / flow 不匹配 ⇒ 一律**诚实失败**，绝不瞎猜。 */
function resolveTemplate(
  kernel: CfgTemplateKernel,
  name: string,
  flowId: string | undefined,
  force: boolean,
): CfgTemplateEntry {
  const { entries } = listConfigTemplates({ dataRoot: kernel.root, repoRoot: kernel.repoRoot }); // 不按 flow 过滤，歧义自己判
  const hits = entries.filter((e) => e.name === name && e.source !== "blank");
  if (!hits.length) {
    const avail = entries.filter((e) => e.source !== "blank").map((e) => `${e.flowId}/${e.name}`);
    throw new CfgTemplateError(
      "NOT_FOUND",
      404,
      `模板不存在：${name}${avail.length ? `；可用：${avail.join("、")}` : "；模板库为空（先用 cfg_template --action save 自存一个，或套用「从零新建」）"}`,
    );
  }
  if (flowId) {
    const exact = hits.filter((e) => e.flowId === flowId);
    const exactHit = exact[0];
    if (exactHit) return exactHit;
    if (!force) {
      throw new CfgTemplateError(
        "INVALID_INPUT",
        400,
        `模板「${name}」属于其它 flow：${hits.map((h) => h.flowId).join("、")}（本项目 flow=${flowId}）。` +
          `跨 flow 套用请显式传 force=true（输入面/阈值未必兼容，必须由人确认）`,
      );
    }
    const forcedHit = hits[0];
    if (!forcedHit) throw new CfgTemplateError("NOT_FOUND", 404, `模板不存在：${name}`);
    return forcedHit;
  }
  // 项目还没开跑 ⇒ flow 未知。同名多条就要求显式指定，不做「取第一个」这种赌博
  if (hits.length > 1) {
    throw new CfgTemplateError(
      "INVALID_INPUT",
      400,
      `模板名「${name}」在多个 flow 下都存在（${hits.map((h) => h.flowId).join("、")}）；请显式传 --flow`,
    );
  }
  const hit = hits[0];
  if (!hit) throw new CfgTemplateError("NOT_FOUND", 404, `模板不存在：${name}`);
  return hit;
}

/**
 * 套用模板到项目：写 `<project>/项目配置.json`。
 * `项目` 键一律改成目标项目 id（模板里记的是**来源项目名**，照抄会立刻触发内核一致性校验失败）。
 * flow 不匹配默认拒绝——跨 flow 套用要显式确认（阈值/输入面未必兼容）。
 */
export function applyConfigTemplate(
  kernel: CfgTemplateKernel,
  req: { project: string; name: string; flowId?: string; force?: boolean },
): Record<string, unknown> {
  const projectId = String(req.project ?? "").trim();
  if (!projectId) throw new CfgTemplateError("INVALID_INPUT", 400, "apply 需要 project（要套用到哪个项目）");
  const projectDir = kernel.projectDir(projectId);
  const flowId = req.flowId ?? projectFlowId(kernel, projectId);
  const name = String(req.name ?? "").trim();
  if (!name) throw new CfgTemplateError("INVALID_INPUT", 400, "apply 需要 name（要套用哪个模板；「从零新建」= 空白配置）");

  let raw: Record<string, unknown>;
  let source: CfgTemplateEntry["source"];
  if (name === "从零新建" || name === "__blank__") {
    raw = { 项目: projectId };
    source = "blank";
  } else {
    const use = resolveTemplate(kernel, name, flowId, req.force === true);
    raw = readTemplate(use.path!).raw;
    source = use.source;
  }

  raw["项目"] = projectId;
  try {
    assertSchema("project-config", raw);
  } catch (e) {
    throw new CfgTemplateError("INVALID_INPUT", 400, `模板「${name}」不合 project-config 契约，拒绝写入: ${e instanceof Error ? e.message : String(e)}`);
  }
  fs.mkdirSync(projectDir, { recursive: true });
  const dst = path.join(projectDir, CONFIG_FILE_NAME);
  fs.writeFileSync(dst, JSON.stringify(raw, null, 2) + "\n", "utf-8");
  return {
    applied: name,
    source,
    flowId,
    file: dst,
    keys: Object.keys(raw),
    hasBudget: !!(raw["阈值预算"] && typeof raw["阈值预算"] === "object"),
    hint: "已落盘；flow_run/flow_effect 后写入 registry/effective.json 才反映到页面显示值",
  };
}

/** 删除自存模板。官方示例与 `blank` 不可删（它们不是盘上的用户文件）。 */
export function deleteConfigTemplate(kernel: CfgTemplateKernel, req: { name: string; flowId?: string }): Record<string, unknown> {
  const name = String(req.name ?? "").trim();
  if (!name) throw new CfgTemplateError("INVALID_INPUT", 400, "delete 需要 name");
  const { entries } = listConfigTemplates({ dataRoot: kernel.root, repoRoot: kernel.repoRoot, flowId: req.flowId });
  const hits = entries.filter((e) => e.name === name);
  if (!hits.length) throw new CfgTemplateError("NOT_FOUND", 404, `模板不存在：${name}`);
  const user = hits.filter((e) => e.source === "user");
  if (!user.length) {
    throw new CfgTemplateError(
      "INVALID_INPUT",
      400,
      `「${name}」不是自存模板（${hits.map((h) => h.source).join("、")}）⇒ 不可删：官方示例随仓库发布，` +
        `「从零新建」是动作不是文件`,
    );
  }
  const removed: string[] = [];
  for (const u of user) {
    fs.unlinkSync(u.path!);
    removed.push(u.path!);
    // 空目录一并收走（不留空壳）
    try {
      const d = path.dirname(u.path!);
      if (!fs.readdirSync(d).length) fs.rmdirSync(d);
    } catch {
      /* 目录收尾失败不影响删除结果 */
    }
  }
  return { deleted: name, removed };
}

/** 动词入口：把 CLI/HTTP/MCP 三面的入参归一化后分派（动词表只声明一次，见 verbs.ts）。 */
export function cfgTemplate(
  kernel: CfgTemplateKernel,
  req: { action: string; project?: string; name?: string; flowId?: string; overwrite?: boolean; force?: boolean },
): Record<string, unknown> {
  const action = String(req.action ?? "").trim();
  switch (action) {
    case "list": {
      const { entries, skipped } = listConfigTemplates({ dataRoot: kernel.root, repoRoot: kernel.repoRoot, flowId: req.flowId });
      return { action, flowId: req.flowId, count: entries.length, entries, skipped };
    }
    case "save":
      return { action, ...saveConfigTemplate(kernel, { project: String(req.project), name: String(req.name), overwrite: req.overwrite, flowId: req.flowId }) };
    case "apply":
      return { action, ...applyConfigTemplate(kernel, { project: String(req.project), name: String(req.name), flowId: req.flowId, force: req.force }) };
    case "delete":
      return { action, ...deleteConfigTemplate(kernel, { name: String(req.name), flowId: req.flowId }) };
    default:
      throw new CfgTemplateError("INVALID_INPUT", 400, `未知 action：${action || "(空)"}（可选 list | save | apply | delete）`);
  }
}
