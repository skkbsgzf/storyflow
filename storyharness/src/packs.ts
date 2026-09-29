// 语料包扩展点装载（波13 步1/步2 · S1 路由挂载表 + S2 首页卡片 + S3 配置命名空间；
// 波14 批1 · S4 装载层——manifest `runtime.packsOff` 点名的包整包不挂载，项目级启停见 src/packgate.ts）。
// 形态依据：docs/盘点-piweb功能缺口与推演引擎插件化-20260929.md §二。
//   包 = 目录 + `.storyharness.json` manifest，声明 `extensions.{pages,apis,config}`；
//   底座启动时扫三处根（内置 storyharness/packs/ ｜ 工作区 <ws>/packs/ ｜ manifest runtime.packs 名单），
//   动态 import 各 entry，收敛成挂载表交给 serve——**此后新玩法都是包，不再改底座五件套**。
// 纪律：
//   · 未知扩展点键 = 显式拒绝整包并回显（不静默忽略——manifest 声明底座最小版本同理）；
//   · 路由前缀/页面路由/配置名 冲突 = 后来者整包拒绝，先注册者胜（挂载表唯一事实源）；
//   · 装载失败不拖垮协议面：逐包 try/catch，错误进 report 随启动日志与 /api/hub 回显；
//   · entry 文件必须留在包根内（越出包根的 entry 直接拒绝）。
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import type http from "node:http";
import type { HarnessConfig } from "./config.js";
import type { PackCtx } from "./packctx.js";

export interface PlainObject { [k: string]: unknown }

/** 挂载表条目：启动期一次成形，运行期只读（挂载是启动期决定，不做热插拔——S4 口径）。
 *  底座派发时已用 runWithPack 绑好 currentPackCtx()（cfg/runtime/packCfg 注入），
 *  签名只给请求面；handle 收完整 req.url，prefixLen 供剥前缀（/api/deduce/state → state）。 */
export interface ApiMount { prefix: string; pack: string; handle: (ctx: PackCtx, res: http.ServerResponse, url: string, method: string, body: string, prefixLen: number) => Promise<void> }
export interface PageMount { route: string; pack: string; render: (ctx: PackCtx, req: http.IncomingMessage) => string | Promise<string>; title?: string; card?: boolean; defaultProject?: string }

export interface LoadedPack { name: string; root: string; version: string; routes: string[]; apis: string[]; configs: string[]; /** S4 出厂档：项目未表态时本项目能不能用它（缺省 true=波13 行为零变化；新玩法写 false 即「默认全关」） */ defaultEnabled: boolean }
export interface PackError { pack: string; source: string; error: string }

const isObj = (x: unknown): x is PlainObject => !!x && typeof x === "object" && !Array.isArray(x);

/** manifest 磁盘形状（宽松读入，校验在装载循环里逐项做）。 */
interface PackManifest {
  pack?: { name?: string; version?: string; requiresBase?: string; defaultEnabled?: boolean };
  extensions?: {
    pages?: { route?: string; entry?: string; export?: string; title?: string; card?: boolean; defaultProject?: string }[];
    apis?: { prefix?: string; entry?: string; export?: string }[];
    config?: Record<string, unknown>;
  };
}

/** 语义版本比较（数字段逐位比，预发布后缀不参与——本机形态够用）。 */
export function cmpSemver(a: string, b: string): number {
  const pa = a.split("-")[0].split(".").map(Number);
  const pb = b.split("-")[0].split(".").map(Number);
  for (let i = 0; i < 3; i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d > 0 ? 1 : -1; }
  return 0;
}

/** 工作区 manifest 的 runtime.packs 名单由 loadConfig 读入 cfg.packs（单一读取点，不在此重复）。 */

export class PackRuntime {
  private constructor(
    readonly apis: readonly ApiMount[],
    readonly pages: readonly PageMount[],
    readonly loaded: readonly LoadedPack[],
    readonly errors: readonly PackError[],
    readonly warnings: readonly string[],
    readonly configSchema: Readonly<Record<string, unknown>>,
    readonly templateDirs: readonly { pack: string; path: string }[],
  ) {}

  static EMPTY = new PackRuntime([], [], [], [], [], {}, []);
  /** 装载器的成表入口（构造私有：表只能经 of/EMPTY/failed 三条路成形）。 */
  static of(apis: ApiMount[], pages: PageMount[], loaded: LoadedPack[], errors: PackError[], warnings: string[], configSchema: Record<string, unknown>, templateDirs: { pack: string; path: string }[]): PackRuntime {
    return new PackRuntime(apis, pages, loaded, errors, warnings, configSchema, templateDirs);
  }
  /** 装载器整体抛错时的诚实空表（带一条错误供回显，不冒充「无包」）。 */
  static failed(message: string): PackRuntime {
    return new PackRuntime([], [], [], [{ pack: "?", source: "loadPacks", error: message }], [], {}, []);
  }

  /** S1 · API 挂载查找：最长前缀优先。返回「前缀长度」供 handler 剥除。 */
  matchApi(urlNoQuery: string): { mount: ApiMount; prefixLen: number } | null {
    let best: { mount: ApiMount; prefixLen: number } | null = null;
    for (const m of this.apis) {
      if (urlNoQuery.startsWith(m.prefix) && (!best || m.prefix.length > best.prefixLen)) {
        best = { mount: m, prefixLen: m.prefix.length };
      }
    }
    return best;
  }
  matchPage(route: string): PageMount | null {
    return this.pages.find((p) => p.route === route) ?? null;
  }
  /** S2 · 首页卡片清单（card:true 的挂载页）。 */
  cards() {
    return this.pages.filter((p) => p.card).map((p) => ({ route: p.route, title: p.title ?? p.route, defaultProject: p.defaultProject ?? "" }));
  }
  /** 包内模板项目目录（template-<id> 随包走）：hub 单列出组 + projectDir 第二查找位都认这里。
   *  label 形如「deduce · 模板」——hub 把它原样放进项目行的 `template` 字段，前端据此出只读徽标（包名已在其中，不再单给一份）。 */
  templateProjectDirs(): { root: string; label: string }[] {
    const out: { root: string; label: string }[] = [];
    for (const d of this.templateDirs) {
      let names: string[] = [];
      try { names = fs.readdirSync(d.path, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name.startsWith("template-")).map((e) => e.name); } catch { continue; }
      if (names.length) out.push({ root: d.path, label: `${d.pack} · 模板` });
    }
    return out;
  }
  /** 包 templates/ 里有没有同名项目（不含「工作区优先」判定）——回落与落地只问这一处。 */
  templateProjectDir(project: string): string | null {
    if (!project || project.includes("/") || project.includes("\\") || project.includes("..")) return null;
    for (const d of this.templateDirs) {
      const cand = path.join(d.path, project);
      try { if (fs.statSync(cand).isDirectory()) return cand; } catch { /* 没这个模板 */ }
    }
    return null;
  }
  /** 模板/包项目的落位解析：workspaceRoot/projects 优先，其次各包 templates/。 */
  projectDir(cfg: HarnessConfig, project: string): string {
    const primary = path.join(cfg.workspaceRoot, cfg.corpus.projectsDir, project);
    if (fs.existsSync(primary)) return primary;
    return this.templateProjectDir(project) ?? primary; // 都不存在：交回缺省位，让上层按「缺文件」显式报错
  }
  /** 目录是否落在某个包的 templates/ 下（出厂模板＝只读：写它等于污染包内容物）。 */
  inPackTemplates(abs: string): boolean {
    const a = path.resolve(abs);
    return this.templateDirs.some((d) => {
      const root = path.resolve(d.path);
      return a === root || a.startsWith(root + path.sep);
    });
  }
  /** S5 · 首写落地：写操作要落到「随包出厂的模板项目」时，先把整目录复制进工作区（幂等），
   *  返回可写路径。包内容物由此保持只读——demo 留档进包、模板被对话写脏都源自缺这一步。
   *  落地后 projectDir 的「工作区在档优先」自然稳定指向副本，读轴随之一致（两轴不许错位）。 */
  materialize(cfg: HarnessConfig, project: string): string {
    const primary = path.join(cfg.workspaceRoot, cfg.corpus.projectsDir, project);
    if (fs.existsSync(primary)) return primary;
    const src = this.templateProjectDir(project);
    if (!src) return primary;                       // 查无模板：交回缺省位，让上层按「缺目录」显式报错
    fs.mkdirSync(path.dirname(primary), { recursive: true });
    copyProjectTree(src, primary);   // 不用 cpSync：见下方 copyProjectTree 的本机实测缺陷
    console.error(`[storyharness] 模板项目落地：${src} → ${primary}（写操作触发，包内容物保持只读）`);
    return primary;
  }
}

// ── 可移植整目录复制（波14 批2 · S5 落地用）──────────────────────
/** 为什么不用 fs.cpSync：本机实测（Node v24.14.0 / Windows，2026-09-29 探针 tmp-probe3/4/5）——
 *  cpSync 的**源路径含非 ASCII 时直接打死进程**（exit 127、无 JS 异常、无栈），
 *  **目标路径含非 ASCII 时静默不落地**（抛 ENOENT scandir 在后续读）。
 *  包模板名几乎都是中文（template-推演 → projects/template-推演），两条全踩，
 *  首写落地因此会「一次建会话 = serve 进程没了」。故这里只用实测对 CJK 无害的三原语：
 *  readdirSync(withFileTypes) + mkdirSync + copyFileSync。软链接按目标类型就地展开复制。
 *  证据：docs/收据-波14批2-cpSync崩溃定位.md。
 */
export function copyProjectTree(src: string, dst: string): void {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) copyProjectTree(s, d);
    else if (e.isSymbolicLink() && fs.statSync(s).isDirectory()) copyProjectTree(s, d);
    else fs.copyFileSync(s, d);
  }
}

interface Found { root: string; manifestPath: string }

function scanDir(dir: string, push: (f: Found) => void) {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith("_") || e.name.startsWith(".")) continue;
    const mf = path.join(dir, e.name, ".storyharness.json");
    if (fs.existsSync(mf)) push({ root: path.join(dir, e.name), manifestPath: mf });
  }
}

/**
 * 装载全部语料包扩展点。在 startServe 里调用一次（启动期决定，运行期只读）。
 * @cfg 需已带 extensions/packs（loadConfig 收敛的 S3 结果）。
 */
export async function loadPacks(cfg: HarnessConfig): Promise<PackRuntime> {
  const found: Found[] = [];
  const seen = new Set<string>();
  const push = (f: Found) => {
    let key = f.root;
    try { key = fs.realpathSync(f.root); } catch { /* tmp 目录等场景回裸路径 */ }
    if (seen.has(key)) return;
    seen.add(key);
    found.push({ root: key, manifestPath: f.manifestPath });
  };
  // 三处根：内置包 > 工作区包 > manifest runtime.packs 点名（loadConfig 已读入 cfg.packs，可指绝对路径）
  // 都过 push 去重（realpath）：pkgRoot === workspaceRoot 时（测试隔离工作区/单目录安装）同一包会被两读，
  // 不去重则自己跟自己撞扩展点、并在门禁报告里出三条同名条目——真根因，非测试的锅。
  scanDir(path.join(cfg.pkgRoot, "packs"), push);
  scanDir(path.join(cfg.workspaceRoot, "packs"), push);
  for (const name of cfg.packs ?? []) {
    const root = path.isAbsolute(name) ? name : path.join(cfg.workspaceRoot, "packs", name);
    const mf = path.join(root, ".storyharness.json");
    if (fs.existsSync(mf)) push({ root, manifestPath: mf });
    else console.error(`[storyharness] runtime.packs 点名查无包（缺 .storyharness.json）：${root}`);
  }

  const apis: ApiMount[] = [];
  const pages: PageMount[] = [];
  const loaded: LoadedPack[] = [];
  const errors: PackError[] = [];
  const warnings: string[] = [];
  const configSchema: Record<string, unknown> = {};
  const templateDirs: { pack: string; path: string }[] = [];
  const owner = new Map<string, string>(); // 路由/前缀/配置名 → 包名（冲突裁决）
  const claim = (key: string, pack: string): boolean => {
    const prev = owner.get(key);
    if (prev) { errors.push({ pack, source: pack, error: `扩展点 ${key} 已被包「${prev}」占用，整包拒挂` }); return false; }
    owner.set(key, pack);
    return true;
  };

  for (const f of found) {
    let name = path.basename(f.root);
    try {
      const mf = JSON.parse(fs.readFileSync(f.manifestPath, "utf-8")) as PackManifest & { corpus?: { name?: string } };
      name = mf.pack?.name || mf.corpus?.name || name;
      // S4 装载层（工作区级）：manifest runtime.packsOff 点名的包整包不挂载——显式回显，不静默消失
      const dirName = path.basename(f.root);
      if ((cfg.packsOff ?? []).some((off) => off === name || off === dirName)) {
        warnings.push(`包「${name}」（${f.root}）被语料 manifest runtime.packsOff 点名停用 → 本次未装载（恢复=删点名并重启 serve）`);
        continue;
      }
      // 版本契约：requiresBase 不满足 = 整包拒挂（显式，不冒充兼容）
      const req = mf.pack?.requiresBase;
      if (req) {
        if (!/^\d+\.\d+\.\d+/.test(cfg.harnessVersion)) {
          warnings.push(`包「${name}」声明 requiresBase@${req}，但底座版本号非语义化（"${cfg.harnessVersion}"）——契约无法判定，跳过比对`);
        } else if (cmpSemver(cfg.harnessVersion, req) < 0) {
          throw new Error(`requiresBase@${req} > 底座 ${cfg.harnessVersion}：整包拒挂（升级底座或降级包）`);
        }
      }
      const ext = mf.extensions ?? {};
      // 未知扩展点键 = 显式拒绝（不静默忽略——「声明了没人读」是本仓事故形态）
      for (const k of Object.keys(ext)) {
        if (k !== "pages" && k !== "apis" && k !== "config") throw new Error(`未知扩展点 extensions.${k}（底座只认 pages/apis/config，需要新形态先升底座）`);
      }
      const packApis: string[] = [];
      const packPages: string[] = [];
      const packConfigs: string[] = [];

      for (const c of Array.isArray(ext.config) ? [] : ext.config ? [ext.config] : []) {
        for (const ns of Object.keys(c)) {
          if (!claim(`config:${ns}`, name)) continue;
          configSchema[ns] = c[ns];
          packConfigs.push(ns);
        }
      }
      for (const p of ext.pages ?? []) {
        if (!p?.route?.startsWith("/") || !p.entry) throw new Error(`pages 项缺 route/entry：${JSON.stringify(p).slice(0, 120)}`);
        if (!claim(`page:${p.route}`, name)) continue;
        const entryAbs = path.resolve(f.root, p.entry);
        if (!entryAbs.startsWith(path.resolve(f.root) + path.sep)) throw new Error(`entry 越出包根：${p.entry}`);
        const mod = await import(pathToFileURL(entryAbs).href);
        const fn = p.export ? mod[p.export] : mod.render;
        if (typeof fn !== "function") throw new Error(`页面入口 ${path.relative(f.root, entryAbs)} 缺导出函数 ${p.export ?? "render"}`);
        pages.push({ route: p.route, render: fn as PageMount["render"], pack: name, title: p.title, card: !!p.card, defaultProject: p.defaultProject });
        packPages.push(p.route);
      }
      for (const a of ext.apis ?? []) {
        if (!a?.prefix?.startsWith("/") || !a.prefix.endsWith("/") || !a.entry) throw new Error(`apis 项缺 prefix（/开头/结尾）/entry：${JSON.stringify(a).slice(0, 120)}`);
        if (a.prefix.includes("..") || /[\\]/.test(a.prefix)) throw new Error(`api prefix 非法：${a.prefix}`);
        if (!claim(`api:${a.prefix}`, name)) continue;
        const entryAbs = path.resolve(f.root, a.entry);
        if (!entryAbs.startsWith(path.resolve(f.root) + path.sep)) throw new Error(`entry 越出包根：${a.entry}`);
        const mod = await import(pathToFileURL(entryAbs).href);
        const fn = a.export ? mod[a.export] : mod.handle;
        if (typeof fn !== "function") throw new Error(`API 入口 ${path.relative(f.root, entryAbs)} 缺导出函数 ${a.export ?? "handle"}`);
        apis.push({ prefix: a.prefix, handle: fn as ApiMount["handle"], pack: name });
        packApis.push(a.prefix);
      }
      // 模板项目目录（template-<id> 随包走，hub 与 projectDir 查找都认）
      const tplDir = path.join(f.root, "templates");
      if (fs.existsSync(tplDir)) templateDirs.push({ pack: name, path: tplDir });
      loaded.push({ name, root: f.root, version: mf.pack?.version ?? "", routes: packPages, apis: packApis, configs: packConfigs, defaultEnabled: mf.pack?.defaultEnabled !== false });
    } catch (e) {
      errors.push({ pack: name, source: f.root, error: (e as Error).message });
    }
  }

  // S3 回显：用户配置里逐命名空间对 schema 查未知键（schema 只到顶层键；缺 schema 的段整段点名）
  for (const [ns, val] of Object.entries(cfg.extensions ?? {})) {
    const schema = configSchema[ns];
    if (!isObj(schema)) { warnings.push(`配置 extensions.${ns} 无包声明 schema（写错命名空间或包未装载）——键照常生效，如实回显`); continue; }
    const unknown = Object.keys(isObj(val) ? val : {}).filter((k) => !(k in schema));
    if (unknown.length) warnings.push(`extensions.${ns} 有未声明键：${unknown.join(", ")}（以包 manifest 为准）`);
  }

  return PackRuntime.of(apis, pages, loaded, errors, warnings, configSchema, templateDirs);
}

/** 启动日志用的装载摘要（报告先行，错误逐条不吞）。 */
export function packsBootLog(rt: PackRuntime): string[] {
  const lines: string[] = [];
  for (const p of rt.loaded) lines.push(`[storyharness] 包「${p.name}${p.version ? " " + p.version : ""}」挂载：pages[${p.routes.join(",") || "-"}] apis[${p.apis.join(",") || "-"}] config[${p.configs.join(",") || "-"}]`);
  for (const w of rt.warnings) lines.push(`[storyharness] 包配置回显：${w}`);
  for (const e of rt.errors) lines.push(`[storyharness] 包「${e.pack}」拒挂（${e.source}）：${e.error}`);
  return lines;
}
