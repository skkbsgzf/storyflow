import { nodeEnv, nodeFs, nodePath } from "./abstraction/defaults.js";
import type { IFileSystem, IFsPath } from "./abstraction/fs.js";
import type { Validation } from "./types.js";

/**
 * 提交链完整性检查（硬断言的内核侧等价物，语义对齐 tools/export-doc.py 的 M0 断言）。
 * v5.0（工单 §三）：`runDeclaredAsserts` 与 pass/block/unverified 三态裁决已整层下架——
 * 声明式断言协议退役；美学/版式的机器可查项归 `aesthetic.ts` 质量扫描器（只出证据，
 * 经 tools/quality-scan.py / scan_quality 消费），语义判定归 agent 与人。
 * 本文件只剩**确定性完整性**：存在性/空文/残渣/计数一致 + artifact@1 头部 + 词汇表守卫。
 */
export function runIntegrityAsserts(projectDir: string, relPath: string, fs: IFileSystem = nodeFs, path: IFsPath = nodePath): Validation[] {
  const results: Validation[] = [];
  const abs = path.join(projectDir, relPath);
  const name = path.basename(relPath);

  if (!fs.exists(abs)) {
    return [{ name: "exists", status: "block", detail: `产物文件缺失: ${relPath}` }];
  }
  const text = fs.readText(abs);
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
 * v5.0 退役注记（2026-09-21，docs/v5.0工单-断言体系退役与规则语料化.md）
 *
 * 原 R5 §四「声明的断言必须被执行」层（RESERVED_ASSERTS / checksVia 别名表 /
 * runDeclaredAsserts 三态派发 / DeclaredAssertOutcome）已整层下架。
 * 退役依据（批0 盘账）：台账 90 条中真正打回过东西的只有 2 个 id；25 条以
 * 「无机器校验器，归评审/红方剖面」名义空转，累计 170 次 warn，红方执行体从未存在。
 *
 * 新执行模型（agent-only）：可数的归扫描器（aesthetic.ts + tools/quality-scan.py，
 * 输出证据 + 收据，不拦截），不可数的语义判据归 knowledge/rules/ 语料卡，
 * 由 Orchestrator 按 R8 决策激活、agent 裁决、人做端尾验收。
 * ==========================================================================*/

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
    const key = m[1] ?? "";
    const val = (m[2] ?? "").trim();
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
  const m = (nodeEnv.get("MINIFLOW_HEADER_MODE") ?? "block").toLowerCase();
  return m === "warn" || m === "off" ? m : "block";
}

/**
 * 过程交付件头部校验。返回空数组 = 文件不在管辖范围（或模式 off）。
 * 结果名 `artifact-header`：block = 缺头部/字段不全/目录错配/命名违规/正文污染。
 */
export function runHeaderAsserts(projectDir: string, relPath: string, expect: HeaderExpect = {}, fs: IFileSystem = nodeFs, path: IFsPath = nodePath): Validation[] {
  if (headerMode() === "off") return [];
  const rel = relPath.replaceAll("\\", "/");
  if (!rel.endsWith(".md")) return [];
  const dir = HEADER_DIRS.find((d) => rel.startsWith(d));
  // R6 模块目录（NN-模块名/）同受头部校验管辖——此前不在 HEADER_DIRS，无头部文件被
  // flow_submit 照收（2026-09-24 双执行器测验实测两次假阳性交卷）。
  const inModule = /^\d{2}-[^/]+\//.test(rel);
  const inRoot = !rel.includes("/");
  // 根级只允许输入材料（规范 R4 §一）：其它 .md 是目录违规
  if (!dir && !inModule && inRoot && !(expect.rootInputs ?? []).includes(rel)) {
    const mode0 = headerMode();
    return [
      {
        name: "artifact-header",
        status: mode0 === "warn" ? "warn" : "block",
        detail: `根级仅允许输入材料（kind:novel-txt 产物）；过程件须入 内部/{意见|收据|依据|稿本} 或 对外交付/: ${rel}`,
      },
    ];
  }
  if (!dir && !inModule) return [];

  const mode = headerMode();
  const sev = (detail: string): Validation => ({ name: "artifact-header", status: mode === "warn" ? "warn" : "block", detail });
  const abs = path.join(projectDir, rel);
  if (!fs.exists(abs)) return [];
  const text = fs.readText(abs);

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

  // 目录准入：class 决定目录。模块目录（R6 NN-*）放宽：input/draft 均为合法过程件形态
  // （classOfPath 对模块目录本就映射 input——不放宽则 caocao 系流程的模板形态必被误杀）。
  const cls = String(head.class ?? "");
  const wantDirs = CLASS_DIRS[cls];
  if (inModule) {
    if (cls && !["input", "draft", "deliverable", "world", "opinion", "receipt", "basis"].includes(cls)) {
      problems.push(`模块目录未知 class=${cls}`);
    }
  } else if (wantDirs) {
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
    const firstLine = lines[0] ?? "";
    if (!/^#\s/.test(firstLine)) problems.push(`正文首行须为一级标题，实为「${firstLine.slice(0, 30)}」`);
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

/**
 * 正文骨架（D5）：头部之后**必须长什么样**。
 *
 * headerTemplate 原先只渲染 YAML 头，正文格式靠断言在交卷时兜——而头部断言要求
 * 「正文首行须为一级标题」「标题后须紧接一行 > 摘要」，没给骨架 = 让写手猜，
 * _918test 里这是**最大单源打回（5+ 次）**。骨架把这条硬格式前置成可照抄的样子。
 */
export function bodySkeleton(cls: string): string[] {
  const head = cls === "opinion" ? "# <意见书标题>" : "# <标题>";
  const sum = cls === "opinion" ? "> <一句话结论，≤60 字>" : "> <一句话摘要，≤60 字，不得复述标题>";
  return [head, sum, "", "<!-- 以上两行是硬格式，正文从这里开始；禁止出现过程元数据（统计/说明/本节小结） -->"];
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
  /** D5：头部之后附正文骨架（留空 = 不附，兼容旧调用） */
  skeleton?: string[];
}): string {
  const up = opts.upstream?.length ? opts.upstream.map((u) => `  - ${u}`).join("\n") : "  []";
  const head = [
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
  ];
  if (opts.skeleton?.length) head.push("", ...opts.skeleton);
  return head.join("\n");
}


/**
 * 词汇表守卫（M2）：扫描产物中的他项目专名——跨项目串戏拦截（实证事故：守堤人「长河」串进拍魂）。
 * 约定：projects/<id>/词汇表.json = { "project": id, "own": ["专名", ...] }。
 * 他项目的 own 词即本项目违禁词；该词若被本项目 own 词包含则豁免（青川 ⊂ 青川河）。
 * 本项目未登记词汇表 → 守卫未启用（返回 undefined）。
 */
function readProjectOwn(projectsDir: string, id: string, fs: IFileSystem, path: IFsPath): string[] {
  try {
    const g = JSON.parse(fs.readText(path.join(projectsDir, id, "词汇表.json"))) as { own?: unknown };
    return Array.isArray(g.own) ? g.own.map(String) : [];
  } catch {
    return [];
  }
}

/**
 * 他项目 own 词中、本项目**不得出现**的那些（D5）。
 *
 * 与 `checkGlossary`（交卷后断言）**同源**，但用途相反：这里是在**派发时**就把禁词表下发，
 * 让写手开跑前就知道雷在哪，而不是写完了才被打回。_918test 实证：glossary 打回 2 次
 * （老周 / 思维链 / 魏峥——都是别的项目的专名），写手事前无从得知。
 */
export function foreignOwnTerms(root: string, projectDir: string, fs: IFileSystem = nodeFs, path: IFsPath = nodePath): string[] {
  const projectsDir = path.join(root, "projects");
  const me = path.basename(projectDir);
  const myOwn = readProjectOwn(projectsDir, me, fs, path);
  if (!myOwn.length) return [];
  let dirs: string[];
  try {
    dirs = fs.readDir(projectsDir);
  } catch {
    return [];
  }
  const out = new Set<string>();
  for (const dir of dirs) {
    if (dir === me) continue;
    try {
      if (!fs.stat(path.join(projectsDir, dir))?.isDirectory) continue;
    } catch {
      continue;
    }
    for (const term of readProjectOwn(projectsDir, dir, fs, path)) {
      if (!term || myOwn.some((o) => o.includes(term))) continue;
      out.add(term);
    }
  }
  return [...out].sort();
}

export function checkGlossary(root: string, projectDir: string, relPath: string, fs: IFileSystem = nodeFs, path: IFsPath = nodePath): Validation | undefined {
  const projectsDir = path.join(root, "projects");
  let text: string;
  try {
    text = fs.readText(path.join(projectDir, relPath));
  } catch {
    return undefined;
  }
  const me = path.basename(projectDir);
  const myOwn = readProjectOwn(projectsDir, me, fs, path);
  if (!myOwn.length) return undefined;
  const hits: string[] = [];
  for (const dir of fs.readDir(projectsDir)) {
    if (dir === me) continue;
    let isDir = false;
    try {
      isDir = fs.stat(path.join(projectsDir, dir))?.isDirectory ?? false;
    } catch {
      continue;
    }
    if (!isDir) continue;
    for (const term of readProjectOwn(projectsDir, dir, fs, path)) {
      if (!term || myOwn.some((o) => o.includes(term))) continue;
      if (text.includes(term)) hits.push(`${term}（来自 ${dir}）`);
    }
  }
  return hits.length
    ? { name: "glossary", status: "block", detail: `跨项目串戏：${hits.join("、")}` }
    : { name: "glossary", status: "pass", detail: "无他项目专名" };
}
