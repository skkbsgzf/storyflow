import { nodeFs, nodePath } from "./abstraction/defaults.js";
import type { IFileSystem, IFsPath } from "./abstraction/fs.js";
import { assertSchema } from "./schema.js";

export interface ProjectConfig {
  项目: string;
  题材?: string;
  需求?: string;
  灵感?: string;
  严肃性?: "探索" | "标准" | "出品";
  风格?: "爽" | "标准";
  AB测试?: boolean;
  市场预估?: string;
  presets?: Record<string, "auto" | "semi" | "manual">;
  /**
   * OS-02 阶段 C：阈值预算面（键名/区间白名单见 `budget.ts::DEFAULT_BUDGET`）。
   * 它是 `policy.budget` 的**实例层**来源——优先级：flow.policy.budget（模板层）
   *  < 本键（实例层）< 项目 overlay 的 `set-policy{budget}`（运行时调整层）。
   */
  阈值预算?: Record<string, number>;
  [k: string]: unknown;
}

export const CONFIG_FILE = "项目配置.json";

/** 读取并校验项目初始化配置；不存在返回 undefined，存在但非法抛错（开跑前大声失败）。 */
export function loadProjectConfig(projectDir: string, fs: IFileSystem = nodeFs, path: IFsPath = nodePath): ProjectConfig | undefined {
  const file = path.join(projectDir, CONFIG_FILE);
  if (!fs.exists(file)) return undefined;
  // 坏 JSON 必须大声抛（不套 readJson 的静默容错）：非法配置要在开跑前拦住，不能退化成「没配」。
  const raw = JSON.parse(fs.readText(file));
  assertSchema("project-config", raw);
  const cfg = raw as ProjectConfig;
  const dirName = path.basename(projectDir);
  if (cfg.项目 && cfg.项目 !== dirName) {
    throw new Error(`${CONFIG_FILE} 的「项目」(${cfg.项目}) 与目录名 (${dirName}) 不一致`);
  }
  return cfg;
}

/**
 * OS-02 阶段 C：项目级阈值预算（`项目配置.json` 的 `阈值预算`）。
 *
 * 它只是**搬运**：合法性判定（未知键 / 越界 / 非数）由 `budget.ts::resolveBudget` 统一负责——
 * 面板只渲染白名单旋钮、契约只允许 number，非法值要么在 `loadProjectConfig` 的 schema 校验上
 * 大声失败，要么在 `resolveBudget.issues` 里被点名。此处绝不静默丢弃任何键。
 */
export function configBudget(cfg: ProjectConfig | undefined): Record<string, number> | undefined {
  const raw = cfg?.阈值预算;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw)) if (typeof v === "number") out[k] = v;
  return Object.keys(out).length ? out : undefined;
}

/**
 * 配置 → flow 输入（合并序：显式入参 > 配置 > flow 默认，故本函数产物会被显式入参覆盖）。
 *
 * D2（enum 输入不吃配置）：此前只认 `风格`/`AB测试` 两个字段做**推导**，配置文件里直接写的
 * `route: "dual"` 被整条忽略 → enum 型输入永远落回 flow 默认值。_918test 实证：两份
 * `项目配置.json` 都写了 route=dual，`state.inputs.route` 却落在 "hot"，于是
 * `when: {input: route, eq: dual}` 的「双版本对照」支线**两条线都没激活**——设计成了声明的谎言。
 * 现在的顺序：
 *   ① **直通**：配置里与 flow 输入同名的键原样透传（enum/string/number/boolean 都吃），
 *      enum 取值不在 options 内**开跑前大声失败**（静默回落才是最难查的）；
 *   ② **推导**（仅当 ① 没给）：`AB测试` 优先，其次 `风格`；
 *   ③ 其余字段原样回传给背景卡与下游子代理。
 */
export function configToInputs(cfg: ProjectConfig, flow: { inputs?: Record<string, unknown> }): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const declared = (flow.inputs ?? {}) as Record<string, { type?: string; options?: string[] } | undefined>;
  // ① 直通：与 flow 输入同名的配置键优先（空串 = 未表态，与面板 readConfigForm 同口径不进参）
  for (const key of Object.keys(declared)) {
    const v = (cfg as Record<string, unknown>)[key];
    if (v === undefined || v === null || v === "") continue;
    const def = declared[key];
    if (def?.type === "enum" && Array.isArray(def.options) && !def.options.includes(v as string)) {
      throw new Error(
        `${CONFIG_FILE} 的 ${key}=${String(v)} 不是合法取值（可选：${def.options.join(" / ")}）——enum 输入用错值必须拦在开跑前`,
      );
    }
    out[key] = v;
  }
  // ② 推导（回退）：仅在 ① 未直接给 route 时才由出品定位推导
  if (out.route === undefined) {
    const derived =
      typeof cfg.AB测试 === "boolean" ? (cfg.AB测试 ? "dual" : styleToRoute(cfg.风格)) : styleToRoute(cfg.风格);
    if (derived !== undefined) out.route = derived;
  }
  const hasDirection = "direction" in declared;
  if (hasDirection && !out.direction) {
    const composed = [cfg.题材, cfg.需求, cfg.灵感].filter(Boolean).join("；");
    if (composed) out.direction = composed;
  }
  for (const k of ["题材", "需求", "灵感", "严肃性", "市场预估"] as const) {
    if (cfg[k]) out[k] = cfg[k];
  }
  if (cfg.AB测试 !== undefined) out.AB测试 = cfg.AB测试;
  return out;
}

function styleToRoute(style: string | undefined): string | undefined {
  if (style === "爽") return "hot";
  if (style === "标准") return "calm";
  return undefined;
}

/** 背景卡追加行：让每个子代理都带着出品定位与市场底气干活。 */
export function configCardLines(cfg: ProjectConfig, snapshotVersion?: string, snapshotCorpus?: number): string[] {
  const lines: string[] = [];
  const bits: string[] = [];
  if (cfg.严肃性) bits.push(`严肃性=${cfg.严肃性}`);
  if (cfg.风格) bits.push(`风格=${cfg.风格}`);
  if (cfg.AB测试 !== undefined) bits.push(`AB测试=${cfg.AB测试 ? "开（双版本+基线件）" : "关（单版本）"}`);
  if (bits.length) lines.push(`- 出品定位：${bits.join(" ｜ ")}`);
  if (cfg.市场预估) lines.push(`- 市场预估（甲方笔记）：${cfg.市场预估}`);
  if (snapshotVersion) {
    lines.push(`- 市场快照：kb/market/snapshot @${snapshotVersion}${snapshotCorpus ? `（${snapshotCorpus} 部样本）` : ""}——引用热度数据须以此为基线，不得编造`);
  }
  return lines;
}
