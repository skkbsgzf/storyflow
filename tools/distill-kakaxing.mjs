#!/usr/bin/env node
// distill-kakaxing.mjs · 咔咔猩语料 → miniflow 知识库蒸馏器（确定性，零 LLM）。
// 这是最先落地的 minitool 之一：日常 update.cmd 刷新快照后重跑本工具，
// benchmark / trope / market 条目即随数据滚动更新（数据飞轮）。
//
// 用法：node tools/distill-kakaxing.mjs [--dry]
// 输出：knowledge/market/snapshot.json
//       knowledge/benchmark/*.md（对标件，generated）
//       knowledge/trope/*.md（梗条目，generated）
//       knowledge/index.json（全库索引重建）

import { readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(root, "src/kakaxing-Json/data");
const KB = join(root, "knowledge");
const TODAY = new Date().toISOString().slice(0, 10);
const DRY = process.argv.includes("--dry");

// ---------- 语料装载 ----------
function loadJsonl(name) {
  const out = [];
  for (const line of readFileSync(join(DATA, name), "utf8").split("\n")) {
    const s = line.trim();
    if (!s) continue;
    try { out.push(JSON.parse(s)); } catch { /* 坏行跳过 */ }
  }
  return out;
}

function hot2w(h) {
  if (!h) return 0;
  const s = String(h);
  let m = s.match(/([\d.]+)\s*亿/);
  if (m) return parseFloat(m[1]) * 10000;
  m = s.match(/([\d.]+)\s*万/);
  if (m) return parseFloat(m[1]);
  const n = parseFloat(s.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n / 10000 : 0;
}

const SEG = ["剧名", "频类", "题材", "一句话卖点", "共情点", "爽点内核", "剧情主线", "创新亮点"];
function parsePlanning(tp) {
  if (!tp) return null;
  const parts = tp.trim().split(/\n?\s*[1-8]、\s*/).map((s) => s.trim()).filter(Boolean);
  if (parts.length < 7) return null;
  const out = {};
  parts.slice(0, 8).forEach((p, i) => {
    p = p.replace(/^(剧名|频类|题材|一句话卖点|共情点|爽点内核|剧情主线|创新亮点)[：:]\s*/, "");
    if (i === 0) {
      const m = p.match(/《(.+?)》/);
      p = m ? m[1] : p;
    }
    out[SEG[i]] = p;
  });
  return Object.keys(out).length >= 7 ? out : null;
}

// ---------- 梗族判定（优先序命中一族） ----------
const FAMILIES = [
  { slug: "yangcheng-huibao",   name: "养成回报梗",     re: /(闭关|沉睡|投喂|捡到?|养的?.{0,6})(.{0,10})(全成|都成|竟成|成了)/, mech: "低位养成 → 养成物回报以压倒性庇护", keywords: ["团宠", "护短", "跪"] },
  { slug: "chongsheng-fuchou",  name: "重生复仇梗",     re: /(重生|重回|重返|回到.{0,6}(前|天前|年前))/, mech: "带记忆回到节点 → 先手布局精准清算", keywords: ["复仇", "打脸", "先手"] },
  { slug: "majia-diaoma",       name: "马甲掉马梗",     re: /(马甲|掉马|扮猪吃虎|隐藏身份|扫地僧)/, mech: "多重身份分层揭示 → 当众掉马瞬间碾压", keywords: ["身份", "当众", "揭穿"] },
  { slug: "liufang-zhongtian",  name: "流放种田梗",     re: /(流放|荒岛|大漠|极寒|边塞|苦役|发配)/, mech: "苦地流放 → 现代技能/金手指绝地翻盘", keywords: ["空间", "系统", "种田"] },
  { slug: "zhuangyuan-keju",    name: "科举逆袭梗",     re: /(状元|科举|金殿|殿试|朝堂)/, mech: "现代知识进入古代赛道 → 金殿当众降维打击", keywords: ["当众", "打脸", "逆袭"] },
  { slug: "zhuiqi-huozangchang",name: "追妻火葬场梗",   re: /(追妻|火葬场|后悔莫及|跪求原谅)/, mech: "先虐后悔 → 女主不回头，男主付相称代价", keywords: ["追妻", "复仇"] },
  { slug: "zhenjia-qianjin",    name: "真假千金梗",     re: /(真假千金|假千金|真千金|错抱)/, mech: "身份错抱 → 两世地位对调+双向选择", keywords: ["身份", "打脸", "认亲"] },
  { slug: "zhuxu-zhanshen",     name: "赘婿战神梗",     re: /(赘婿|战神|龙王|上门女婿)/, mech: "受辱低位 → 身份亮明当众翻盘", keywords: ["打脸", "当众", "强者回归"] },
  { slug: "tuanchong",          name: "团宠护短梗",     re: /(团宠|护短|小师妹|团宠大佬)/, mech: "全员偏爱 → 越界者被集体碾压", keywords: ["宠", "护短", "打脸"] },
  { slug: "shenhao-baofu",      name: "神豪暴富梗",     re: /(神豪|暴富|首富|千亿|百亿|千金)/, mech: "隐藏财富 → 消费降维+身份碾压", keywords: ["身份", "当众"] },
  { slug: "xianhun-lianai",     name: "先婚后爱梗",     re: /(先婚后爱|闪婚|契约结婚|替嫁|冲喜|联姻)/, mech: "契约先行 → 真心与利益双线收紧", keywords: ["宠", "身份"] },
  { slug: "dalian-nuezha",      name: "打脸虐渣梗",     re: /(打脸|虐渣)/, mech: "受辱蓄力 → 当众清算（超族：可与其他梗复合）", keywords: ["打脸", "当众", "反杀"] },
  { slug: "na-werewolf",        name: "狼人命定梗(NA)", re: /werewolf|alpha\b|luna|mate\b/i, mech: "命定配偶设定 → 阶层/族群跨越的双强拉扯", keywords: ["命定", "族群"] },
  { slug: "na-billionaire",     name: "豪门财富梗(NA)", re: /billionaire|ceo|mafia|tycoon|money/i, mech: "财富悬殊 → 底层智慧反制豪门规则", keywords: ["阶层", "反制"] },
  { slug: "na-fantasy",         name: "奇幻生物梗(NA)", re: /dragon|mermaid|alien|beast|shifter|phoenix/i, mech: "异种羁绊 → 弱者借超凡力量翻身", keywords: ["奇幻", "羁绊"] },
  { slug: "mengbao-qinqing",    name: "萌宝亲情梗",     re: /(萌宝|宝宝|崽崽|天才儿童|小包子)/, mech: "萌宝助攻 → 破碎家庭重圆+亲情爽", keywords: ["宠", "认亲"] },
];

function familyOf(rec, planning) {
  const hay = `${planning?.剧名 || rec.scriptName || ""} ${rec.scriptGenres || ""} ${rec.scriptThemeAi || ""}`;
  for (const f of FAMILIES) {
    if (f.re.test(hay)) return f;
  }
  return null;
}

// ---------- 主流程 ----------
const recs = loadJsonl("scriptrawstone.jsonl");
const parsed = [];
for (const r of recs) {
  const p = parsePlanning(r.topPlanning);
  if (!p) continue;
  parsed.push({ r, p, heat: hot2w(r.topHot), fam: familyOf(r, p), region: r.regionType, cat: r.scriptCategory });
}

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const clean = (s, n = 220) => esc(String(s ?? "").replace(/\s+/g, " ").trim()).slice(0, n);

function frontmatter(obj) {
  return `---\n${JSON.stringify(obj, null, 1)}\n---\n`;
}

// ===== 1) 市场快照 snapshot.json =====
function genreMatrix(field, region) {
  const gh = new Map();
  for (const { r, heat } of parsed) {
    if (region && r.regionType !== region) continue;
    if (heat <= 0) continue;
    for (const g of String(r[field] || "").split(/[,，、]/)) {
      const k = g.trim();
      if (!k) continue;
      if (!gh.has(k)) gh.set(k, { genre: k, count: 0, heatSum: 0 });
      const e = gh.get(k);
      e.count += 1; e.heatSum += heat;
    }
  }
  return [...gh.values()]
    .map((e) => ({ genre: e.genre, count: e.count, avgHeatW: Math.round(e.heatSum / e.count), heatSumW: Math.round(e.heatSum) }))
    .sort((a, b) => b.count - a.count);
}

const hotRecs = parsed.filter((x) => x.heat > 0);
const heatVals = hotRecs.map((x) => x.heat).sort((a, b) => a - b);
const q = (p) => heatVals[Math.floor(heatVals.length * p)] ?? 0;

const snapshot = {
  id: "kb/market/snapshot",
  type: "market-snapshot",
  title: "咔咔猩市场快照（机器可读）",
  version: TODAY,
  status: "active",
  source: { dataset: "kakaxing scriptrawstone", capturedAt: TODAY, corpus: recs.length, parsed: parsed.length },
  note: "由 tools/distill-kakaxing.mjs 确定性生成；数据每日可刷新（update.cmd → 本工具）。avgHeatW 单位=万。",
  formatConstraints: {
    episodes: countBy(parsed.map((x) => String(x.r.episodeNumber))),
    episodeDurationMin: "1-1.5 分钟/集（主流）",
    wordCountLimit: countBy(parsed.map((x) => String(x.r.wordCountLimit))),
    sceneNumberMax: countBy(parsed.map((x) => String(x.r.sceneNumberMax))),
    actorNumberMax: countBy(parsed.map((x) => String(x.r.actorNumberMax))),
  },
  heat: { withHeat: hotRecs.length, medianW: q(0.5), p75W: q(0.75), p90W: q(0.9), maxW: heatVals[heatVals.length - 1] ?? 0 },
  grades: countBy(parsed.map((x) => x.r.scriptGrade)),
  regions: countBy(parsed.map((x) => x.region)),
  categories: countBy(parsed.map((x) => x.cat)),
  genreHeatCN: topN(genreMatrix("scriptThemeAi", "CN"), 40),
  genreHeatNA: topN(genreMatrix("scriptGenres", "NA"), 40),
  families: [],
};

function countBy(arr) {
  const c = {};
  for (const x of arr) if (x != null) c[x] = (c[x] || 0) + 1;
  return c;
}
function topN(arr, n) { return arr.slice(0, n); }

// ===== 2) 梗族统计 → trope 条目 =====
const famStats = new Map();
for (const x of parsed) {
  if (!x.fam) continue;
  if (!famStats.has(x.fam.slug)) {
    famStats.set(x.fam.slug, { fam: x.fam, items: [], heatSum: 0, heatN: 0 });
  }
  const st = famStats.get(x.fam.slug);
  st.items.push(x);
  if (x.heat > 0) { st.heatSum += x.heat; st.heatN += 1; }
}

const corpusAvgHeat = hotRecs.length ? hotRecs.reduce((a, x) => a + x.heat, 0) / hotRecs.length : 0;

function saturation(count, avgHeat) {
  const share = count / parsed.length;
  const heatRatio = avgHeat / corpusAvgHeat;
  if (share >= 0.08) return heatRatio > 1.1 ? "红海·有效" : "红海·过饱和";
  if (heatRatio >= 1.3) return "上升期·蓝海偏好";
  if (heatRatio >= 0.9) return "稳定·主流";
  return "退潮期·慎入";
}

const tropeFiles = [];
for (const [slug, st] of famStats) {
  const n = st.items.length;
  if (n < 40) continue;
  const avgHeat = st.heatN ? st.heatSum / st.heatN : 0;
  const byHeat = [...st.items].sort((a, b) => b.heat - a.heat || (b.r.scriptScore || 0) - (a.r.scriptScore || 0));
  const top3 = byHeat.slice(0, 3);
  const sat = saturation(n, avgHeat);
  // 演化链：创新亮点里的对标剧
  const chains = [];
  for (const x of byHeat) {
    const c = x.p.创新亮点 || "";
    const m = c.match(/对标《(.+?)》/);
    if (m && chains.length < 3) {
      chains.push({ parent: m[1], variant: clean(c, 160), title: x.p.剧名 || x.r.scriptName });
    }
  }
  const kwCount = {};
  for (const k of st.fam.keywords) {
    kwCount[k] = st.items.filter((x) =>
      `${x.p.爽点内核 || ""}${x.p.题材 || ""}${(x.p.剧情主线 || "").slice(0, 400)}`.includes(k)
    ).length;
  }
  const fm = {
    id: `kb/trope/${slug}`,
    type: "trope",
    title: `梗族 · ${st.fam.name}`,
    version: TODAY,
    status: "active",
    applies_to: ["short-drama", "comic-drama"],
    saturation: sat,
    corpus_count: n,
    avg_heat_w: Math.round(avgHeat),
    keywords: kwCount,
    provenance: { source: "import", refs: [`dataset:kakaxing/scriptrawstone@${TODAY}`, "tool:tools/distill-kakaxing.mjs"] },
    updated: TODAY,
    bind: { skills: ["find-trope"], minitools: ["kb_search", "check_trope_combo"] },
  };
  const body = `# 梗族 · ${st.fam.name}

**机制**：${st.fam.mech}
**饱和度**：${sat}（语料 ${n} 部 / 共 ${parsed.length} 部 ≈ ${(100 * n / parsed.length).toFixed(1)}%；平均热度 ${Math.round(avgHeat)} 万 vs 全库均值 ${Math.round(corpusAvgHeat)} 万）

## 爽点内核关键词分布

${st.fam.keywords.map((k) => `- ${k}：${kwCount[k] || 0}`).join("\n")}

## 热度证据（Top3）

${top3.map((x) => `### 《${clean(x.p.剧名 || x.r.scriptName, 60)}》${x.heat > 0 ? `（热度 ${x.heat} 万 · ${x.r.scriptGrade || "?"} 级）` : ""}
- 卖点：${clean(x.p.一句话卖点, 120)}
- 共情点：${clean(x.p.共情点, 120)}`).join("\n\n")}

## 演化链（对标 → 变体）

${chains.length ? chains.map((c) => `- 《${clean(c.parent, 50)}》 → 《${clean(c.title, 50)}》：${c.variant}`).join("\n") : "- 语料中未见明确对标引用（本族可能为原生变体群）"}

## 使用纪律

1. 选主梗前先查 \`saturation\`：红海族必须复合新变体（找演化链里没做过的落点）；上升期族可直接主推。
2. 本族与 \`kb/aesthetic/pacing-density\` 的密度档位联动：hot 档每集爽点按本族 keywords 布点；calm 档取本族机制做单爆点长铺垫。
3. 复合检查交 minitool \`check_trope_combo\`（元数据相性表）。
`;
  tropeFiles.push({ file: `trope/${slug}.md`, content: frontmatter(fm) + body });
  snapshot.families.push({ slug, name: st.fam.name, count: n, avgHeatW: Math.round(avgHeat), saturation: sat });
}
snapshot.families.sort((a, b) => b.count - a.count);

// ===== 3) 对标件 benchmark 条目 =====
const benchFiles = [];
const usedIds = new Set();
function emitBenchmark(x, tag) {
  const id = x.r.scriptRawstoneId || x.r.scriptName;
  if (usedIds.has(id)) return;
  usedIds.add(id);
  const slug = `b${String(benchFiles.length + 1).padStart(3, "0")}-${tag}`;
  const fm = {
    id: `kb/benchmark/${slug}`,
    type: "benchmark",
    title: `对标 · ${clean(x.p.剧名 || x.r.scriptName, 50)}`,
    version: TODAY,
    status: "active",
    market: x.region,
    category: x.cat,
    genres: x.p.题材 || x.r.scriptThemeAi || x.r.scriptGenres || "",
    heat_w: x.heat > 0 ? Math.round(x.heat) : null,
    grade: x.r.scriptGrade || null,
    score: x.r.scriptScore || null,
    family: x.fam ? x.fam.slug : null,
    route_affinity: inferRoute(x),
    provenance: { source: "import", refs: [`dataset:kakaxing/scriptrawstone@${TODAY}`, `platformId:${id}`, "tool:tools/distill-kakaxing.mjs"] },
    updated: TODAY,
    bind: { skills: ["chief-aesthetic", "find-trope"], minitools: ["kb_search"] },
  };
  const body = `# 对标 · ${clean(x.p.剧名 || x.r.scriptName, 60)}

> ${x.region} 市场 · ${x.cat === "F" ? "女频" : "男频"} · ${x.r.scriptGrade || "?"} 级（AI 评 ${x.r.scriptScore ?? "?"}）${x.heat > 0 ? ` · 热度 ${x.heat} 万` : ""} · 梗族：${x.fam ? x.fam.name : "未归类"}

- **一句话卖点**：${clean(x.p.一句话卖点, 160)}
- **题材**：${clean(x.p.题材 || x.r.scriptGenres, 100)}
- **共情点**：${clean(x.p.共情点, 200)}
- **爽点内核**：${clean(x.p.爽点内核, 200)}
- **创新亮点**：${clean(x.p.创新亮点, 240)}

## 剧情主线（节选）

${clean(x.p.剧情主线, 500)}

## 生产约束（实盘值）

集数 ${x.r.episodeNumber}｜单集 ${x.r.episodeDurationMin ?? "?"}-${x.r.episodeDurationMax ?? "?"} 分钟｜单集字数上限 ${x.r.wordCountLimit ?? "?"}｜场景 ≤${x.r.sceneNumberMax ?? "?"}｜演员 ≤${x.r.actorNumberMax ?? "?"}

## 对标用法

强度标尺：本件同等位置的爆点画面与强度，是审美总编（kb/aesthetic/oversight）验收方案时的参照基准。
`;
  benchFiles.push({ file: `benchmark/${slug}.md`, content: frontmatter(fm) + body });
}

function inferRoute(x) {
  const s = `${x.p.爽点内核 || ""}${x.p.一句话卖点 || ""}`;
  if (/当众|打脸|跪|撕/.test(s) && x.heat > corpusAvgHeat) return "hot";
  if (/克制|隐忍|铺垫|体面/.test(s)) return "calm";
  return "all";
}

// CN 热度 Top12（家族去重：单族最多 3 部）
const cnSorted = parsed.filter((x) => x.region === "CN").sort((a, b) => b.heat - a.heat || (b.r.scriptScore || 0) - (a.r.scriptScore || 0));
const famCap = new Map();
for (const x of cnSorted) {
  const k = x.fam ? x.fam.slug : "_";
  if ((famCap.get(k) || 0) >= 3) continue;
  famCap.set(k, (famCap.get(k) || 0) + 1);
  emitBenchmark(x, "cn");
  if (benchFiles.length >= 12) break;
}
// 各族冠军（未被上面收录的）
for (const [, st] of famStats) {
  if (benchFiles.length >= 20) break;
  const best = [...st.items].sort((a, b) => b.heat - a.heat || (b.r.scriptScore || 0) - (a.r.scriptScore || 0))[0];
  if (best && best.region === "CN") emitBenchmark(best, "fam");
}
// NA Top6（按分+热度）
const naSorted = parsed.filter((x) => x.region === "NA").sort((a, b) => b.heat - a.heat || (b.r.scriptScore || 0) - (a.r.scriptScore || 0));
for (const x of naSorted.slice(0, 6)) emitBenchmark(x, "na");
// S 级补录（质量锚）
const sGrade = parsed.filter((x) => x.r.scriptGrade === "S").sort((a, b) => (b.r.scriptScore || 0) - (a.r.scriptScore || 0));
for (const x of sGrade.slice(0, 4)) emitBenchmark(x, "s");

// ===== 4) 写盘 =====
const outputs = [];
outputs.push({ file: "market/snapshot.json", content: JSON.stringify(snapshot, null, 2) + "\n" });
for (const f of [...tropeFiles, ...benchFiles]) outputs.push(f);

if (!DRY) {
  for (const dir of ["market", "trope", "benchmark"]) {
    const d = join(KB, dir);
    if (dir !== "market") rmSync(d, { recursive: true, force: true }); // generated 目录整体重建
    mkdirSync(d, { recursive: true });
  }
  for (const f of outputs) writeFileSync(join(KB, f.file), f.content, "utf8");
  console.log(`written: ${outputs.length} files (trope ${tropeFiles.length}, benchmark ${benchFiles.length}, snapshot 1)`);
} else {
  console.log(`[dry] would write ${outputs.length} files (trope ${tropeFiles.length}, benchmark ${benchFiles.length})`);
}

// ===== 5) 全库索引重建 =====
function buildIndex() {
  const entries = [];
  const scan = (dir) => {
    for (const name of readdirSync(join(KB, dir), "utf8")) {
      const rel = `${dir}/${name}`;
      const full = join(KB, rel);
      if (name.endsWith(".md")) {
        const text = readFileSync(full, "utf8");
        const m = text.match(/^---\n([\s\S]*?)\n---/);
        if (!m) continue;
        try {
          const fm = JSON.parse(m[1]);
          // R8 S4：索引必须搬运生产者写好的轴——此前 applies_to 在源 md 里有、索引里 0 次（断点③）；
          // tags 是新唯一标签轴（routes 兼容搬运，不做静默改写）。缺失照缺，不伪造 ["all"]。
          entries.push({ id: fm.id, type: fm.type, title: fm.title, dimension: fm.dimension, routes: fm.routes, tags: fm.tags, applies_to: fm.applies_to, saturation: fm.saturation, corpus_count: fm.corpus_count, avg_heat_w: fm.avg_heat_w, market: fm.market, file: rel });
        } catch { /* frontmatter 损坏不进索引 */ }
      }
    }
  };
  for (const dir of readdirSync(KB, "utf8")) {
    try { scan(dir); } catch { /* 非目录 */ }
  }
  // 断言表特列
  try {
    const a = JSON.parse(readFileSync(join(KB, "aesthetic/assertions.json"), "utf8"));
    entries.push({ id: a.id, type: a.type, title: `${a.title}（${a.asserts.length} 条）`, dimension: "assertions", routes: ["all"], tags: ["all"], file: "aesthetic/assertions.json" });
  } catch { /* 断言表缺失 */ }
  // 市场快照特列（generated json，无 md frontmatter）
  try {
    const s = JSON.parse(readFileSync(join(KB, "market/snapshot.json"), "utf8"));
    entries.push({ id: s.id, type: s.type, title: s.title, routes: ["all"], tags: ["all"], file: "market/snapshot.json" });
  } catch { /* 快照缺失 */ }
  entries.sort((a, b) => a.id.localeCompare(b.id));
  const idx = {
    kb: "miniflow-knowledge",
    version: TODAY,
    updated: TODAY,
    note: "知识库索引。md 条目由 frontmatter 汇总；generated 条目（trope/benchmark/market）随数据快照滚动重建（tools/distill-kakaxing.mjs）。",
    types: {
      "aesthetic-standard": "审美判定标准（什么叫好：维度、条款、阈值）",
      "style-route": "风格路线参数档位",
      "aesthetic-assertions": "机器可查硬断言表",
      "market-snapshot": "市场数据快照（机器可读）",
      "market-standard": "市场/网感公式标准",
      "deconstruct-protocol": "拆解层协议（怎么把参考作品拆成可入库素材）",
      "continuity-standard": "长程连续性与状态台账标准",
      "format-standard": "形态标准（长篇网文等载体的形态约束）",
      "structure-catalog": "叙事结构选型目录（第二阶段深挖用）",
      "meme-standard": "梗密度与发散性约束（网感输入源）",
      trope: "梗条目（机制+饱和度+演化链）",
      benchmark: "对标件（强度标尺）",
    },
    entries,
  };
  if (!DRY) writeFileSync(join(KB, "index.json"), JSON.stringify(idx, null, 2) + "\n", "utf8");
  console.log(`index: ${entries.length} entries${DRY ? " [dry]" : ""}`);
}
buildIndex();
