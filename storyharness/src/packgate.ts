// 包门禁（波14 批1 · S4 项目级启停）：挂载是启动期事实，启停是运行期裁决。
// 形态依据：docs/盘点-piweb功能缺口与推演引擎插件化-20260929.md §二 S4。
//   盘点原话是「默认全关，启用才挂载」——但一个 serve 进程服务多个项目，
//   挂载表按启动期成形、不可能按项目分别挂/不挂。所以 S4 落成两层，各有唯一归属：
//     · 装载层（启动期 / 工作区级）= 语料 manifest `runtime.packsOff: [包名]` → 整包不挂载，改完重启 serve；
//     · 门禁层（运行期 / 项目级）  = 项目 `项目配置.json` 的 `presets.packs.<包名>: true|false`
//                                    → 包照常挂载，数据面按项目放行或拒绝，改完即生效（不重启）。
//   缺省档由包 manifest 的 `pack.defaultEnabled` 自持（缺省=true，保证波13 行为零变化；
//   新玩法要「默认全关」就在自己 manifest 里写 false——谁的包谁定出厂档）。
// 纪律：
//   · 三态如实回显（on / off / 未声明），并说明「凭什么」（依据来源），不许把包默认冒充用户表态；
//   · 判不出项目时底座不代答——交回包自己的参数校验（抢报错文案会让面板出现两套「缺 project」话术）；
//   · 出厂模板（包内 templates/template-*）只读：那里的项目不落开关，显式拒绝并指路。
import * as fs from "node:fs";
import path from "node:path";
import type { HarnessConfig } from "./config.js";
import { copyProjectTree, type PackRuntime } from "./packs.js";
import { safeProject } from "./safe-project.js";

/** 项目配置件（语料侧既有事实源：brief.ts 读它，tools 的 cfg_template 生成它）。开关段挂在其 presets 下。 */
export const PROJECT_CONFIG_FILE = "项目配置.json";
export const PACKS_KEY_PATH = ["presets", "packs"] as const;

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);

/** 从项目配置读出 `presets.packs` 段（缺文件/缺段/段形不符 = null，表示「未声明」而非「全关」）。 */
export function readDeclaredPacks(file: string): Record<string, unknown> | null {
  try {
    const j = JSON.parse(fs.readFileSync(file, "utf-8"));
    const seg = isObj(j) && isObj(j[PACKS_KEY_PATH[0]]) ? (j[PACKS_KEY_PATH[0]] as Record<string, unknown>)[PACKS_KEY_PATH[1]] : undefined;
    return isObj(seg) ? seg : null;
  } catch { return null; }
}

/** 项目目录是否落在某个包的 templates/ 下（出厂模板随包走，写它=污染包内容物）。判定归挂载表。 */
function inPackTemplates(rt: PackRuntime, abs: string): boolean {
  return rt.inPackTemplates(abs);
}

export type GateSource = "project" | "pack-default" | "not-loaded";
export interface GateItem {
  pack: string;
  version: string;
  routes: string[];
  apis: string[];
  configs: string[];
  /** 项目是否显式表态（true/false）；false = 未声明，生效值来自包出厂档 */
  declared: boolean;
  /** 出厂档（manifest pack.defaultEnabled，缺省 true） */
  defaultEnabled: boolean;
  /** 本项目最终能不能用这个包 */
  enabled: boolean;
  /** enabled 从哪来：用户表态 / 包出厂档 / 整包没装载（R8 三问之「凭什么」） */
  source: GateSource;
  /** 不可用原因（拒挂/停用才填，可用时空串） */
  reason: string;
}
export interface GateReport { project: string; items: GateItem[]; note: string }

const NOTE = "启停=运行期门禁（数据面按项目放行/拒绝，改完即生效）；整包不装载请改语料 manifest 的 runtime.packsOff 并重启 serve。";

/** 逐包门禁态：已装载的包出三态条目，装载期被拒的包也出条目（拒因照抄，不许哑）。 */
export function packGateReport(cfg: HarnessConfig, rt: PackRuntime, project: string): GateReport {
  const id = safeProject(project) ? project : "";
  if (!id) return { project, items: [], note: NOTE };
  const file = path.join(rt.projectDir(cfg, id), PROJECT_CONFIG_FILE);
  const declared = readDeclaredPacks(file);
  const items: GateItem[] = rt.loaded.map((p) => {
    const raw = declared?.[p.name];
    const has = raw === true || raw === false;
    const enabled = has ? (raw as boolean) : p.defaultEnabled;
    return {
      pack: p.name, version: p.version, routes: p.routes, apis: p.apis, configs: p.configs,
      declared: has, defaultEnabled: p.defaultEnabled, enabled,
      source: has ? "project" : "pack-default",
      reason: has ? `项目已表态 ${raw}` : `项目未声明，按包出厂档 defaultEnabled=${p.defaultEnabled}`,
    };
  });
  for (const e of rt.errors) {
    items.push({
      pack: e.pack, version: "", routes: [], apis: [], configs: [],
      declared: false, defaultEnabled: false, enabled: false,
      source: "not-loaded", reason: `装载期拒挂：${e.error}`,
    });
  }
  // 装载层点名的包（runtime.packsOff）整包不在挂载表里，包名却还在配置里——面板不许它哑：
  // 出一条目并写清「没装载、怎么恢复」，与「装载了但本项目未启用」区分开（两种解法不同根）。
  const loadedNames = new Set(rt.loaded.map((p) => p.name));
  for (const off of cfg.packsOff ?? []) {
    if (loadedNames.has(off) || items.some((i) => i.pack === off)) continue;
    items.push({
      pack: off, version: "", routes: [], apis: [], configs: [],
      declared: false, defaultEnabled: false, enabled: false,
      source: "not-loaded", reason: "被语料 manifest 的 runtime.packsOff 点名停用＝整包未装载（恢复：删点名并重启 serve）",
    });
  }
  return { project: id, items, note: NOTE };
}

/** 单个包对本项目是否放行（serve 派发数据面时调）。返回 null = 本底座不认识这个包名（无从判定）。 */
export function packAllowed(cfg: HarnessConfig, rt: PackRuntime, project: string, pack: string): { enabled: boolean; item?: GateItem } {
  const rep = packGateReport(cfg, rt, project);
  const item = rep.items.find((i) => i.pack === pack);
  return item ? { enabled: item.enabled, item } : { enabled: false };
}

/** 写表态：只改 `presets.packs.<pack>`，其余键原样保留（读—改—写；缺文件时新建只带本段）。 */
export function setPackGate(cfg: HarnessConfig, rt: PackRuntime, project: string, pack: string, enabled: boolean): GateItem {
  const id = safeProject(project) ?? "";
  if (!id) throw new Error(`project 非法：${project}`);
  if (!rt.loaded.some((p) => p.name === pack)) throw new Error(`包「${pack}」未装载，无从启停（看 /api/hub.packsReport.errors）`);
  const dir = rt.projectDir(cfg, id);
  if (!fs.existsSync(dir)) throw new Error(`项目不存在：${id}`);
  if (inPackTemplates(rt, dir)) throw new Error(`「${id}」是随包出厂的模板项目（只读）：要给它落开关，请先把它复制进工作区 ${cfg.corpus.projectsDir}/ 再操作`);
  const file = path.join(dir, PROJECT_CONFIG_FILE);
  let json: Record<string, unknown> = {};
  let existed = true;
  try {
    const raw = fs.readFileSync(file, "utf-8");
    const j = JSON.parse(raw);
    if (!isObj(j)) throw new Error("顶层不是对象");
    json = j;
  } catch (e) {
    if (fs.existsSync(file)) throw new Error(`${PROJECT_CONFIG_FILE} 读不动（${(e as Error).message}）——不在坏文件上盲写，先修它`);
    existed = false;
  }
  const presets = isObj(json.presets) ? json.presets : {};
  const packs = isObj(presets[PACKS_KEY_PATH[1]]) ? presets[PACKS_KEY_PATH[1]] as Record<string, unknown> : {};
  packs[pack] = enabled;
  presets[PACKS_KEY_PATH[1]] = packs;
  json.presets = presets;
  if (!existed && !isObj(json[PACKS_KEY_PATH[0]])) json.$comment = `${id} 项目配置（StoryHarness 门面「扩展包」启停首次创建；题材/需求等设计项由 mf_cfg_template 生成时补齐）`;
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + "\n", "utf-8");
  const rep = packGateReport(cfg, rt, id);
  const item = rep.items.find((i) => i.pack === pack);
  if (!item) throw new Error("写入后回读失败：包条目不在门禁报告里");
  return item;
}

/** 从请求里判项目（query 优先，POST body 兜底）。判不出 = 空串，交回包自己的参数校验。 */
export function projectFromRequest(url: string, method: string, body: string): string {
  const q = new URLSearchParams(url.split("?")[1] ?? "");
  const fromQ = q.get("project") ?? "";
  if (fromQ && safeProject(fromQ)) return fromQ;
  if (method === "POST" && body) {
    try {
      const b = JSON.parse(body) as unknown;
      if (isObj(b) && typeof b.project === "string" && safeProject(b.project)) return b.project;
    } catch { /* 坏 body：包自己会报 */ }
  }
  return "";
}

// ── 模板项目落地（波14 批2）────────────────────────────────
// 随包出厂的模板项目（`packs/<包>/templates/template-*`）内容物归包所有：demo 留档进包、
// 对话写脏包目录都是这么来的（现场证据：packs/deduce/templates/template-推演 下带 85 行
// clickstream + 22 份 runs——那正是上一次有人直接在模板上跑推演的结果）。
// 底座两条路：自动「首写落地」（serve 写操作前 materialize）＋显式「复制到工作区」（本函数，可换名）。
export function cloneTemplateProject(cfg: HarnessConfig, rt: PackRuntime, from: string, to?: string): { ok: true; from: string; to: string; dst: string; landed: boolean } {
  if (!safeProject(from)) throw new Error(`project 非法：${from}`);
  // 源只认包内出厂模板：落地副本（工作区同名项目）不算模板——从副本再复制一份是另一件事，且会静默覆盖语义。
  const src = rt.templateProjectDir(from);
  if (!src) {
    const cur = rt.projectDir(cfg, from);
    throw new Error(fs.existsSync(cur)
      ? `「${from}」已在工作区（${cur}），不是包内模板——无需复制`
      : `模板项目查无：${from}（包未装载/未启用，或 templates/ 下没这个目录）`);
  }
  const target = to && safeProject(to) ? to : from;
  const dst = path.join(cfg.workspaceRoot, cfg.corpus.projectsDir, target);
  if (fs.existsSync(dst)) throw new Error(`工作区已有项目「${target}」，不覆盖（换名再来）`);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  copyProjectTree(src, dst);   // 同 materialize：cpSync 遇 CJK 路径本机必崩（见 packs.ts 注释）
  return { ok: true, from, to: target, dst, landed: true };
}
