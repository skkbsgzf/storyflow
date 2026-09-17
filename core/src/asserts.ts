import fs from "node:fs";
import path from "node:path";
import type { Validation } from "./types.js";
import { runAestheticAsserts } from "./aesthetic.js";

/**
 * 完整性断言（硬断言的内核侧等价物，语义对齐 tools/export-doc.py 的 M0 断言）。
 * 美学/版式断言的机器可查层在 aesthetic.ts；「声明的断言」由 runDeclaredAsserts 派发。
 */
export function runIntegrityAsserts(projectDir: string, relPath: string): Validation[] {
  const results: Validation[] = [];
  const abs = path.join(projectDir, relPath);
  const name = path.basename(relPath);

  if (!fs.existsSync(abs)) {
    return [{ name: "exists", status: "block", detail: `产物文件缺失: ${relPath}` }];
  }
  const text = fs.readFileSync(abs, "utf-8");
  results.push({ name: "exists", status: "pass", detail: `${text.length} chars` });
  if (!text.trim()) {
    return [...results, { name: "nonempty", status: "block", detail: "产物为空" }];
  }

  // 残渣检测（heredoc 结束符 / shell 痕迹不得进入正文）
  const debris: string[] = [];
  text.split("\n").forEach((ln, i) => {
    const s = ln.trim();
    if (/^[A-Z][A-Z0-9_]*EOF$/.test(s) || /\bwc -l\b|cat > .|<<'[A-Z]/.test(s)) {
      debris.push(`L${i + 1}: ${s.slice(0, 50)}`);
    }
  });
  results.push(
    debris.length
      ? { name: "no-debris", status: "block", detail: debris.join("; ") }
      : { name: "no-debris", status: "pass" },
  );

  // 小纲类产物：计数一致 + 集标题规范
  if (name.includes("小纲")) {
    const srcBeats = (text.match(/\*\*B\d+｜/g) ?? []).length;
    let parsed = 0;
    const parts = text.split(/(?=^## 第[一二三四五六七八九十百零]+集)/m);
    for (const part of parts.slice(1)) {
      parsed += (part.match(/\*\*B\d+｜[^｜\n]+｜\d+秒\*\*/g) ?? []).length;
    }
    results.push(
      srcBeats === parsed
        ? { name: "beat-count", status: "pass", detail: `${srcBeats} beats` }
        : { name: "beat-count", status: "block", detail: `源 B 标记 ${srcBeats} ≠ 解析 ${parsed}` },
    );
    const badHeads: string[] = [];
    text.split("\n").forEach((ln, i) => {
      // 仅约束恰为二级的集标题；三级及以上是创作思路页等正文小节，不受此限
      if (/^##(?!#)/.test(ln) && ln.includes("集") && !/^## 第[一二三四五六七八九十百零]+集《[^》]*》\s*$/.test(ln)) {
        badHeads.push(`L${i + 1}: ${ln.trim().slice(0, 40)}`);
      }
    });
    results.push(
      badHeads.length
        ? { name: "ep-title", status: "block", detail: badHeads.join("; ") }
        : { name: "ep-title", status: "pass" },
    );
  }

  return results;
}

/* ============================================================================
 * R5 §四：声明的断言必须被执行
 *
 * 背景（R5 §十 头号缺口）：`kit.op.asserts` / `node.asserts` 过去只出现在任务包
 * `outputContract.asserts` 里——是**声明**，不是**校验**。图上不再靠加门保质量之后，
 * 「域内质量由该 tool 的 asserts 承担」这句就只落在纸面上了。
 *
 * 单一事实源：core 步（check_aesthetic_asserts 节点）与 flow_submit 都走这里，
 * 禁止各自实现（两套裁决必漂移）。
 *
 * 裁决口径（三态，无第四态，尤其没有「假的 pass」）：
 *   · 引擎有机器校验器（同名，或同族 `ID#子项`，如 AE-BEAT-FORMAT 覆盖 AE-BEAT-FORMAT#dur）
 *     → 采用引擎的真裁决（pass / warn / block）
 *   · 无校验器（语义层断言：代入感/人物维度/红方预判…机器读不出来）
 *     → warn + 「无机器校验器」，并登记进 unverified。**不冒充通过**。
 * 语义层断言不是缺陷，是分工：它们归评审步/红方剖面，机器只负责不假装验过。
 * ==========================================================================*/

/** 已由提交链独占处理的断言名，不进声明派发（避免自我指涉与重复）。 */
const RESERVED_ASSERTS = new Set(["integrity", "artifact-header", "glossary", "exists", "nonempty", "no-debris"]);

/** 注册表别名（checks_via）：声明名 → 引擎实际校验名（如 AE-DENSITY-HOT → AE-DENSITY-WORDS）。
 *  唯一台账 knowledge/aesthetic/assertions.json；kit-lint.py 静态侧读同一份，两边不各写一套。 */
let viaCache: { root: string; via: Map<string, string> } | null = null;
function checksVia(projectDir: string): Map<string, string> {
  const root = process.env.MINIFLOW_ROOT ?? path.join(projectDir, "..", "..");
  if (viaCache && viaCache.root === root) return viaCache.via;
  const via = new Map<string, string>();
  try {
    const j = JSON.parse(fs.readFileSync(path.join(root, "knowledge", "aesthetic", "assertions.json"), "utf-8")) as {
      asserts?: { id?: string; checks_via?: string }[];
    };
    for (const a of j.asserts ?? []) {
      if (a.id && a.checks_via && a.checks_via !== "self") via.set(a.id, a.checks_via);
    }
  } catch {
    /* 注册表缺失 = 无别名 */
  }
  viaCache = { root, via };
  return via;
}

export interface DeclaredAssertOutcome {
  /** 本次追加的裁决（已含引擎结果，调用方可直接并入 problems） */
  results: Validation[];
  /** 机器真跑了的断言 id */
  checked: string[];
  /** 声明了但无机器校验器的断言 id（语义层）——显式登记，不静默放行 */
  unverified: string[];
}

/**
 * 执行「声明的断言」。
 * @param engine 已算出的引擎结果（调用方若已跑过 runAestheticAsserts，传进来可省一次文件读）
 */
export function runDeclaredAsserts(
  projectDir: string,
  relPath: string,
  ids: string[],
  engine?: Validation[],
): DeclaredAssertOutcome {
  const declared = [...new Set(ids.filter((x): x is string => typeof x === "string" && !!x.trim()))].filter(
    (x) => !RESERVED_ASSERTS.has(x),
  );
  if (!declared.length) return { results: [], checked: [], unverified: [] };

  const eng = engine ?? runAestheticAsserts(projectDir, relPath);
  const base = (n: string): string => n.split("#")[0];
  const byId = new Map<string, Validation[]>();
  for (const r of eng) {
    const b = base(r.name);
    const list = byId.get(b);
    if (list) list.push(r);
    else byId.set(b, [r]);
  }
  // 引擎判定「本产物不适用」时，把原因带进 unverified 明细——免得读者以为是漏跑
  const meta = eng.filter((r) => r.name === "AE-SKIP-NON-BEAT" || r.name === "AE-EXISTS");
  const metaNote = meta.length ? `；引擎判定：${meta.map((m) => m.detail ?? m.name).join("；")}` : "";

  const results: Validation[] = [];
  const checked: string[] = [];
  const unverified: string[] = [];
  const via = checksVia(projectDir);
  for (const id of declared) {
    const hit = byId.get(base(via.get(id) ?? id)) ?? byId.get(base(id));
    if (hit?.length) {
      checked.push(id);
      results.push(...hit);
    } else {
      unverified.push(id);
      results.push({
        name: id,
        status: "warn",
        detail: `无机器校验器（语义层断言，归评审/红方剖面）——未执行，不计入通过${metaNote}`,
      });
    }
  }
  return { results, checked, unverified };
}

export function blocked(results: Validation[]): Validation[] {
  return results.filter((r) => r.status === "block");
}

/** 同名同明细的裁决去重（引擎全量与声明派发会互相覆盖同一 id，报告不该出现两遍）。 */
export function dedupeValidations(results: Validation[]): Validation[] {
  const seen = new Set<string>();
  const out: Validation[] = [];
  for (const r of results) {
    const k = `${r.name}\u0000${r.detail ?? ""}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

/* ============================================================================
 * artifact@1 头部校验（规范 R4 §二）
 * 头部是版本与审核背景的唯一真相；正文只放内容。
 * 生效范围：内部/ · 对外交付/ · 世界书/ 下的 .md
 * ==========================================================================*/

export interface HeaderExpect {
  node?: string;
  round?: number;
  by?: string;
  /** 头部缺省值（内核可代填），仅在缺失时补判 */
  kit?: string;
  op?: string;
  minitool?: string;
  /** 允许落在项目根级的输入材料（kind:novel-txt 的产物）。根级出现其它 .md = 目录违规。 */
  rootInputs?: string[];
}

const HEADER_DIRS = ["内部/", "对外交付/", "世界书/", "章节正文/"];
const HEADER_REQUIRED = ["artifact", "id", "class", "node", "round", "state", "at", "by", "upstream"];
const CLASS_DIRS: Record<string, string[]> = {
  opinion: ["内部/意见/"],
  receipt: ["内部/收据/"],
  basis: ["内部/依据/"],
  draft: ["内部/稿本/"],
  deliverable: ["对外交付/", "章节正文/"],
  world: ["世界书/"],
};

/** 正文污染扫描：会话口吻 / 工具残留 / 版本叙述（规范 R4 §四）。 */
const POLLUTION: { name: string; re: RegExp }[] = [
  { name: "会话口吻", re: /^(思考[：:]|分析过程|让我|我先|用户说|用户要求|用户想要|我需要|首先我|接下来我|按照要求|根据要求)/ },
  { name: "工具残留", re: /^[A-Z][A-Z0-9_]*EOF$|\bwc -l\b|cat > |<<'[A-Z]/ },
  { name: "版本叙述", re: /^(本轮|这一版|上一版|第\s*\d+\s*版)[,，。：:]/ },
];

/** 极简 YAML 头部解析：支持 `k: v` 标量、`k:` + 缩进 `- item` 列表、一层嵌套对象。 */
export function parseArtifactHeader(text: string): Record<string, unknown> | null {
  const norm = text.replace(/^\uFEFF/, "");
  if (!norm.startsWith("---")) return null;
  const end = norm.indexOf("\n---", 3);
  if (end < 0) return null;
  const body = norm.slice(norm.indexOf("\n") + 1, end);
  const out: Record<string, unknown> = {};
  let curObj: Record<string, unknown> | null = null;
  let curList: string[] | null = null;
  let curKey = "";
  let pending = ""; // 上一行是 `k:`（空值）——由后续缩进行决定它是列表还是嵌套对象
  for (const raw of body.split("\n")) {
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    const indent = raw.length - raw.trimStart().length;
    const line = raw.trim();
    if (line.startsWith("- ")) {
      const v = line.slice(2).trim().replace(/^["']|["']$/g, "");
      if (!curList && pending) {
        // `k:` 后跟缩进列表 → 现在才建列表，避免把键指向自身容器
        curList = [];
        out[pending] = curList;
        curKey = pending;
        pending = "";
      }
      if (curList) curList.push(v);
      continue;
    }
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    const val = m[2].trim();
    if (indent === 0) {
      curObj = null;
      curList = null;
      curKey = key;
      pending = "";
      if (val === "") {
        pending = key; // 容器类型待定
      } else if (val === "null" || val === "~") {
        out[key] = null;
      } else if (val === "[]") {
        out[key] = [];
      } else if (/^\d+$/.test(val)) {
        out[key] = Number(val);
      } else if (val === "true" || val === "false") {
        out[key] = val === "true";
      } else {
        out[key] = val.replace(/^["']|["']$/g, "");
      }
    } else {
      if (pending) {
        const obj: Record<string, unknown> = {};
        out[pending] = obj;
        curObj = obj;
        pending = "";
      }
      if (!curObj) continue;
      curKey = key;
      if (val === "") {
        curList = [];
        curObj[key] = curList;
      } else {
        curList = null;
        curObj[key] = val === "null" ? null : /^\d+$/.test(val) ? Number(val) : val.replace(/^["']|["']$/g, "");
      }
    }
  }
  // 从未出现的空值键（如 `upstream:` 后无内容）落为 []
  if (pending) out[pending] = [];
  return out;
}

function headerMode(): "block" | "warn" | "off" {
  const m = (process.env.MINIFLOW_HEADER_MODE ?? "block").toLowerCase();
  return m === "warn" || m === "off" ? m : "block";
}

/**
 * 过程交付件头部校验。返回空数组 = 文件不在管辖范围（或模式 off）。
 * 结果名 `artifact-header`：block = 缺头部/字段不全/目录错配/命名违规/正文污染。
 */
export function runHeaderAsserts(projectDir: string, relPath: string, expect: HeaderExpect = {}): Validation[] {
  if (headerMode() === "off") return [];
  const rel = relPath.replaceAll("\\", "/");
  if (!rel.endsWith(".md")) return [];
  const dir = HEADER_DIRS.find((d) => rel.startsWith(d));
  const inRoot = !rel.includes("/");
  // 根级只允许输入材料（规范 R4 §一）：其它 .md 是目录违规
  if (!dir && inRoot && !(expect.rootInputs ?? []).includes(rel)) {
    const mode0 = headerMode();
    return [
      {
        name: "artifact-header",
        status: mode0 === "warn" ? "warn" : "block",
        detail: `根级仅允许输入材料（kind:novel-txt 产物）；过程件须入 内部/{意见|收据|依据|稿本} 或 对外交付/: ${rel}`,
      },
    ];
  }
  if (!dir) return [];

  const mode = headerMode();
  const sev = (detail: string): Validation => ({ name: "artifact-header", status: mode === "warn" ? "warn" : "block", detail });
  const abs = path.join(projectDir, rel);
  if (!fs.existsSync(abs)) return [];
  const text = fs.readFileSync(abs, "utf-8");

  const head = parseArtifactHeader(text);
  if (!head) {
    return [sev(`缺 artifact@1 头部（须以 --- 开头，见 docs/规范-项目文件与流程配置-R4.md）: ${rel}`)];
  }

  const problems: string[] = [];
  for (const k of HEADER_REQUIRED) {
    if (head[k] === undefined) problems.push(`缺字段 ${k}`);
  }
  if (head.artifact !== undefined && head.artifact !== 1) problems.push(`artifact 须为 1，实为 ${String(head.artifact)}`);
  if (expect.node && head.node && head.node !== expect.node) problems.push(`node=${String(head.node)} ≠ 本节点 ${expect.node}`);
  if (expect.round !== undefined && head.round !== undefined && head.round !== expect.round) {
    problems.push(`round=${String(head.round)} ≠ 当前轮 ${expect.round}`);
  }

  // 目录准入：class 决定目录
  const cls = String(head.class ?? "");
  const wantDirs = CLASS_DIRS[cls];
  if (wantDirs) {
    if (cls === "input") {
      if (rel.includes("/")) problems.push(`class=input 应在项目根级，实为 ${rel}`);
    } else if (!wantDirs.some((d) => rel.startsWith(d))) {
      problems.push(`class=${cls} 应落 ${wantDirs.join(" 或 ")}，实为 ${rel}`);
    }
  } else if (cls) problems.push(`未知 class=${cls}`);

  // 命名：文件名不得承载轮次（规范 R4 §三）。`-r1`/`-R1` 仅在构成节点判别时允许
  // （如 多视角意见书-gate-r1.md 的 -gate-r1），故先剥掉节点 id 再判。
  const base = path.basename(rel);
  const nodeId = String(expect.node ?? head.node ?? "");
  const stem = nodeId ? base.split(nodeId).join("") : base;
  if (/v\d+/i.test(stem) || /第\d+版/.test(stem) || /[-_]\d{1,2}版/.test(stem) || /[-_]r\d+/i.test(stem)) {
    problems.push(`文件名含轮次标记（版本进头部，判别用 -<节点id>）: ${base}`);
  }

  // 正文规则：头部之后只允许 # 标题 + 一行 > 摘要
  const after = text.slice(text.indexOf("\n---", 3) + 4).trimStart();
  const lines = after.split("\n").filter((l) => l.trim());
  if (!lines.length) problems.push("正文为空");
  else {
    if (!/^#\s/.test(lines[0])) problems.push(`正文首行须为一级标题，实为「${lines[0].slice(0, 30)}」`);
    const second = lines[1] ?? "";
    if (second && !second.startsWith(">")) problems.push("标题后须紧接一行 > 摘要（≤60 字）");
    else if (second.startsWith(">") && second.replace(/^>\s*/, "").length > 80) problems.push("摘要超长（>80 字符）");
  }

  // 污染扫描（全文，跳过头部）
  const bodyText = after;
  bodyText.split("\n").forEach((ln, i) => {
    const t = ln.trim();
    if (!t) return;
    for (const p of POLLUTION) {
      if (p.re.test(t)) problems.push(`${p.name} @L${i + 1}: ${t.slice(0, 40)}`);
    }
  });

  return problems.length ? [sev(problems.join("; "))] : [{ name: "artifact-header", status: "pass" }];
}

/** 路径 → class（目录准入的逆函数，规范 R4 §一）。 */
export function classOfPath(relPath: string): string {
  const rel = relPath.replaceAll("\\", "/");
  if (rel.startsWith("对外交付/") || rel.startsWith("章节正文/")) return "deliverable";
  if (rel.startsWith("内部/意见/")) return "opinion";
  if (rel.startsWith("内部/收据/")) return "receipt";
  if (rel.startsWith("内部/依据/")) return "basis";
  if (rel.startsWith("内部/稿本/")) return "draft";
  if (rel.startsWith("内部/")) return "draft";
  if (rel.startsWith("世界书/")) return "world";
  return "input";
}

/** 生成头部模板（派发给 agent，保证产物天生合规）。 */
export function headerTemplate(opts: {
  id: string;
  cls: string;
  node: string;
  round: number;
  by: string;
  upstream?: string[];
  reviewGate?: string;
}): string {
  const up = opts.upstream?.length ? opts.upstream.map((u) => `  - ${u}`).join("\n") : "  []";
  return [
    "---",
    "artifact: 1",
    `id: ${opts.id}`,
    `class: ${opts.cls}`,
    `node: ${opts.node}`,
    `round: ${opts.round}`,
    `version: v${opts.round}`,
    "state: draft",
    `at: <YYYY-MM-DD HH:MM>`,
    `by: ${opts.by}`,
    "upstream:",
    up,
    `review: ${
      opts.reviewGate
        ? `{gate: ${opts.reviewGate}, verdict: awaiting}`
        : "null"
    }`,
    "---",
  ].join("\n");
}


/**
 * 词汇表守卫（M2）：扫描产物中的他项目专名——跨项目串戏拦截（实证事故：守堤人「长河」串进拍魂）。
 * 约定：projects/<id>/词汇表.json = { "project": id, "own": ["专名", ...] }。
 * 他项目的 own 词即本项目违禁词；该词若被本项目 own 词包含则豁免（青川 ⊂ 青川河）。
 * 本项目未登记词汇表 → 守卫未启用（返回 undefined）。
 */
export function checkGlossary(root: string, projectDir: string, relPath: string): Validation | undefined {
  const projectsDir = path.join(root, "projects");
  let text: string;
  try {
    text = fs.readFileSync(path.join(projectDir, relPath), "utf-8");
  } catch {
    return undefined;
  }
  const readOwn = (id: string): string[] => {
    try {
      const g = JSON.parse(fs.readFileSync(path.join(projectsDir, id, "词汇表.json"), "utf-8")) as { own?: unknown };
      return Array.isArray(g.own) ? g.own.map(String) : [];
    } catch {
      return [];
    }
  };
  const me = path.basename(projectDir);
  const myOwn = readOwn(me);
  if (!myOwn.length) return undefined;
  const hits: string[] = [];
  for (const dir of fs.readdirSync(projectsDir)) {
    if (dir === me) continue;
    let isDir = false;
    try {
      isDir = fs.statSync(path.join(projectsDir, dir)).isDirectory();
    } catch {
      continue;
    }
    if (!isDir) continue;
    for (const term of readOwn(dir)) {
      if (!term || myOwn.some((o) => o.includes(term))) continue;
      if (text.includes(term)) hits.push(`${term}（来自 ${dir}）`);
    }
  }
  return hits.length
    ? { name: "glossary", status: "block", detail: `跨项目串戏：${hits.join("、")}` }
    : { name: "glossary", status: "pass", detail: "无他项目专名" };
}
