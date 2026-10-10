/**
 * R2.2 · KB 检索双根合并（core/src/kb.ts）：全局 kit 图 + 项目 kit 图（projects/<id>/kit/hypergraph.rag.json）。
 * 契约：命中带 source 标记（global|project）；项目档缺席（未编译/目录不存在）= 行为与历史版本完全一致（零回归）。
 * R2.5 P2 合并策略三语义：①去重（同一卡两根命中只留项目侧：id 或归一 ref 判重）
 * ②同分 tie-break（分数为主，同分项目排前）③k 分配（各根 top-k ⊕ 去重排序截回 k，项目命中是补充不设保留席）；
 * 另 kbRead 项目回落返回体带 source 溯源。策略口径详见 kb.ts kbSearch 函数注释。
 * fixture 全合成（临时目录，不含真实项目数据）。
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { kbRead, kbSearch, loadProjectGraph } from "../src/kb.js";

let dirs: string[] = [];

/** 合成双根 fixture：全局根（knowledge/+kit/）与两个项目根（p1 带项目档、p2 不带）。 */
function tmpFixture(): { root: string; kb: string; p1: string; p2: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kb-proj-"));
  dirs.push(root);
  const kb = path.join(root, "knowledge");
  fs.mkdirSync(path.join(kb, "aesthetic"), { recursive: true });
  fs.writeFileSync(
    path.join(kb, "aesthetic", "curve.md"),
    `---\n{\n  "id": "kb/aesthetic/curve",\n  "title": "情绪曲线标准（六型判别）",\n  "tags": ["curve", "pacing"]\n}\n---\n\n# 情绪曲线标准\n\n全剧情绪曲线类型可判明，且无失衡段。\n`,
    "utf-8",
  );
  fs.mkdirSync(path.join(root, "kit"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "kit", "hypergraph.rag.json"),
    JSON.stringify({
      format: "storyflow-hypergraph@1",
      entries: [
        { id: "kb/aesthetic/curve", title: "情绪曲线标准（六型判别）", domain: "aesthetic", path: "knowledge/aesthetic/curve.md", tags: ["curve"] },
      ],
    }),
    "utf-8",
  );
  // p1：带项目档（世界书卡 + 规则卡 + kit/hypergraph.rag.json）
  const p1 = path.join(root, "projects", "p1");
  fs.mkdirSync(path.join(p1, "世界书"), { recursive: true });
  fs.mkdirSync(path.join(p1, "规则"), { recursive: true });
  fs.writeFileSync(
    path.join(p1, "世界书", "设定.md"),
    `# 设定\n\n主角林昭是漕帮出身的押船人，故事发生在江南运河。\n`,
    "utf-8",
  );
  fs.writeFileSync(
    path.join(p1, "规则", "禁则.md"),
    `# 项目禁则\n\n本项目专名（林昭、漕帮）绝不进入其他项目。\n`,
    "utf-8",
  );
  fs.mkdirSync(path.join(p1, "kit"), { recursive: true });
  fs.writeFileSync(
    path.join(p1, "kit", "hypergraph.rag.json"),
    JSON.stringify({
      format: "storyflow-hypergraph@1",
      stats: { entries: 2, relations: 0, domains: ["世界书", "规则"], scope: "project" },
      entries: [
        { id: "pj/世界书/设定", title: "主角设定", domain: "世界书", path: "世界书/设定.md", tags: ["主角"] },
        { id: "pj/规则/禁则", title: "项目禁则", domain: "规则", path: "规则/禁则.md", tags: ["禁则"] },
      ],
    }),
    "utf-8",
  );
  // p2：同构项目但没有项目档（loadProjectGraph 应返回 null = 零回归路径）
  const p2 = path.join(root, "projects", "p2");
  fs.mkdirSync(path.join(p2, "世界书"), { recursive: true });
  fs.writeFileSync(path.join(p2, "世界书", "其他.md"), `# 别的项目\n\n与查询词无关。\n`, "utf-8");
  return { root, kb, p1, p2 };
}

afterEach(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  dirs = [];
});

describe("KB 双根合并检索（全局 kit + 项目 kit，R2.2）", () => {
  it("①项目档命中带 source=project，正文摘要来自项目卡真实正文", () => {
    const f = tmpFixture();
    const r = kbSearch(f.kb, { q: "林昭", projectDir: f.p1 });
    expect(r.total).toBe(2); // 设定 + 禁则都含「林昭」
    expect(r.hits.every((h) => h.source === "project")).toBe(true);
    const she = r.hits.find((h) => h.id === "pj/世界书/设定");
    expect(she?.file).toBe("世界书/设定.md"); // 项目相对路径
    expect(she?.excerpt).toContain("江南运河"); // 真实正文摘要，不是「域词条」占位
  });

  it("②双根合并：全局命中与项目命中同榜排序，source 标记各归各根", () => {
    const f = tmpFixture();
    // 「设定」命中项目卡标题（+8）；全局 curve 卡只有正文不含「设定」→ 不撞。改用双根都中的词：
    // 全局 curve 卡 tags=curve、正文「情绪曲线」；项目禁则 tags 含禁则。用 k 放开看两根同列：
    const r = kbSearch(f.kb, { q: "曲线 情绪 禁则 主角", k: 10, projectDir: f.p1 });
    const sources = r.hits.map((h) => h.source);
    expect(sources).toContain("global");
    expect(sources).toContain("project");
    // 排序：分高在前（全局 curve 标题+正文命中分应高于项目卡单词命中）
    expect(r.hits[0].source).toBe("global");
    expect(r.hits[0].id).toBe("kb/aesthetic/curve");
    expect(r.total).toBeGreaterThanOrEqual(r.hits.length);
  });

  it("③项目档缺席（未编译）= 与无项目上下文完全同榜（零回归）", () => {
    const f = tmpFixture();
    const without = kbSearch(f.kb, { q: "情绪曲线" });
    const withAbsent = kbSearch(f.kb, { q: "情绪曲线", projectDir: f.p2 });
    expect(loadProjectGraph(f.p2)).toBeNull();
    expect(withAbsent.hits.map((h) => [h.id, h.score, h.file])).toEqual(without.hits.map((h) => [h.id, h.score, h.file]));
    expect(withAbsent.total).toBe(without.total);
    expect(withAbsent.hits.every((h) => h.source === "global")).toBe(true);
    // 项目目录整个不存在也一样（不抛错、不加命中）
    const ghost = kbSearch(f.kb, { q: "情绪曲线", projectDir: path.join(f.root, "projects", "ghost") });
    expect(ghost.hits.map((h) => h.id)).toEqual(without.hits.map((h) => h.id));
  });

  it("④dir 过滤对项目档生效（按 domain）", () => {
    const f = tmpFixture();
    const r = kbSearch(f.kb, { q: "禁则 林昭", dir: "规则", projectDir: f.p1 });
    expect(r.hits.length).toBe(1);
    expect(r.hits[0].id).toBe("pj/规则/禁则");
    expect(r.hits[0].source).toBe("project");
  });

  it("⑤kb_read 项目回落：全局未命中时读项目卡，file 锚项目根；pj/ 前缀 id 亦可", () => {
    const f = tmpFixture();
    const a = kbRead(f.kb, "世界书/设定.md", undefined, undefined, undefined, f.p1);
    expect(a.file).toBe("世界书/设定.md");
    expect(a.content).toContain("林昭");
    const b = kbRead(f.kb, "pj/规则/禁则", undefined, undefined, undefined, f.p1);
    expect(b.file).toBe("规则/禁则.md");
    // 全局命中不受影响：先查全局（与历史行为一致）
    const c = kbRead(f.kb, "kb/aesthetic/curve", undefined, undefined, undefined, f.p1);
    expect(c.file.replace(/\\/g, "/")).toBe("aesthetic/curve.md");
  });

  it("⑥两边都没有 = 显式报错不静默（含 projectDir 在场时）", () => {
    const f = tmpFixture();
    expect(() => kbRead(f.kb, "kb/aesthetic/none", undefined, undefined, undefined, f.p1)).toThrow(/知识卡不存在/);
  });

  it("⑦项目卡含文风目录（批次2.5 P1）：文风/ 目录卡可编译进项目档并被 dir 过滤命中", () => {
    const f = tmpFixture();
    // 文风/ 目录卡 + 项目档编译产物里的对应条目（kit-compile.py --project 扫 文风/ 后的真实形状：
    // id 取 frontmatter id（pj-style/… 命名空间）、domain=目录名「文风」、path=项目根相对）
    fs.mkdirSync(path.join(f.p1, "文风"), { recursive: true });
    fs.writeFileSync(
      path.join(f.p1, "文风", "文风规则-主线.md"),
      `---\n{\n  "id": "pj-style/p1/voice",\n  "type": "rule-corpus",\n  "title": "主线文风规则",\n  "dimension": "style",\n  "version": "0.1.0",\n  "status": "active",\n  "activation_hint": ["m3.成文", "polish"],\n  "provenance": { "source": "项目自建", "refs": [] },\n  "updated": "2026-10-10",\n  "format": "rule-card@1"\n}\n---\n\n# 主线文风规则\n\n短句为主，单句不超过 25 字；全稿禁用机味词「赋能」。\n`,
      "utf-8",
    );
    const graph = JSON.parse(fs.readFileSync(path.join(f.p1, "kit", "hypergraph.rag.json"), "utf-8"));
    graph.entries.push({ id: "pj-style/p1/voice", title: "主线文风规则", domain: "文风", path: "文风/文风规则-主线.md", tags: ["style"] });
    fs.writeFileSync(path.join(f.p1, "kit", "hypergraph.rag.json"), JSON.stringify(graph), "utf-8");
    // 不带 dir：文风卡与既有项目卡同榜，source=project
    const all = kbSearch(f.kb, { q: "文风 赋能", projectDir: f.p1 });
    const voice = all.hits.find((h) => h.id === "pj-style/p1/voice");
    expect(voice?.source).toBe("project");
    expect(voice?.file).toBe("文风/文风规则-主线.md");
    expect(voice?.excerpt).toContain("25 字"); // 正文摘要来自文风卡真实正文
    // dir=文风：按 domain 过滤只中文风卡
    const scoped = kbSearch(f.kb, { q: "文风", dir: "文风", projectDir: f.p1 });
    expect(scoped.hits.length).toBe(1);
    expect(scoped.hits[0].id).toBe("pj-style/p1/voice");
    expect(scoped.hits[0].source).toBe("project");
  });

  // ── R2.5 P2 合并策略：去重 / 同分项目优先 / k 分配 / kbRead 溯源 ──

  it("⑧去重：同一卡两根都命中只留项目侧（归一 ref 判重：项目放了与全局同相对路径的卡）", () => {
    const f = tmpFixture();
    // 项目根下放一张与全局 aesthetic/curve.md 同相对路径的卡（id 不同、分数也更低）
    fs.mkdirSync(path.join(f.p1, "aesthetic"), { recursive: true });
    fs.writeFileSync(
      path.join(f.p1, "aesthetic", "curve.md"),
      `# 曲线卡备份\n\n这是项目本地副本，正文不含检索词。\n`,
      "utf-8",
    );
    const g = JSON.parse(fs.readFileSync(path.join(f.p1, "kit", "hypergraph.rag.json"), "utf-8"));
    g.entries.push({ id: "pj/aesthetic/curve", title: "曲线卡备份", domain: "aesthetic", path: "aesthetic/curve.md", tags: [] });
    fs.writeFileSync(path.join(f.p1, "kit", "hypergraph.rag.json"), JSON.stringify(g), "utf-8");
    // 「曲线」命中全局卡（标题+正文=10 分）与项目副本（仅标题=8 分）——归一 ref 同为 aesthetic/curve
    const r = kbSearch(f.kb, { q: "曲线", projectDir: f.p1 });
    expect(r.hits.length).toBe(1); // 只留一条
    expect(r.hits[0].source).toBe("project"); // 保留项目侧（即使分数更低）
    expect(r.hits[0].id).toBe("pj/aesthetic/curve");
    expect(r.hits[0].file).toBe("aesthetic/curve.md");
  });

  it("⑨去重（id 判重）：项目卡 frontmatter 抄了全局 id 时同样只留项目侧", () => {
    const f = tmpFixture();
    // 项目档条目直接抄全局 id（kit-compile 的 fm id 优先，项目里完全可以出现 kb/ 前缀条目）
    const g = JSON.parse(fs.readFileSync(path.join(f.p1, "kit", "hypergraph.rag.json"), "utf-8"));
    g.entries.push({ id: "kb/aesthetic/curve", title: "备份副本", domain: "备份", path: "备份/curve.md", tags: [] });
    fs.writeFileSync(path.join(f.p1, "kit", "hypergraph.rag.json"), JSON.stringify(g), "utf-8");
    fs.mkdirSync(path.join(f.p1, "备份"), { recursive: true });
    fs.writeFileSync(path.join(f.p1, "备份", "curve.md"), `# 备份\n\n曲线的原件副本存于此。\n`, "utf-8");
    const r = kbSearch(f.kb, { q: "曲线", projectDir: f.p1 });
    expect(r.hits.length).toBe(1);
    expect(r.hits[0].source).toBe("project");
    expect(r.hits[0].file).toBe("备份/curve.md"); // 留的是项目侧命中
  });

  it("⑩同分 tie-break：分数相同时 project 条排前（分数不同则分数说了算）", () => {
    const f = tmpFixture();
    // 项目加一张与全局 curve 同分（标题+正文各中「曲线」=10）的卡
    fs.mkdirSync(path.join(f.p1, "规则"), { recursive: true });
    fs.writeFileSync(path.join(f.p1, "规则", "基准.md"), `# 曲线基准\n\n本项目以曲线为准绳。\n`, "utf-8");
    const g = JSON.parse(fs.readFileSync(path.join(f.p1, "kit", "hypergraph.rag.json"), "utf-8"));
    g.entries.push({ id: "pj/规则/基准", title: "曲线基准", domain: "规则", path: "规则/基准.md", tags: [] });
    fs.writeFileSync(path.join(f.p1, "kit", "hypergraph.rag.json"), JSON.stringify(g), "utf-8");
    const r = kbSearch(f.kb, { q: "曲线", projectDir: f.p1 });
    expect(r.hits.length).toBe(2);
    expect(r.hits[0].score).toBe(r.hits[1].score); // 同分
    expect(r.hits[0].source).toBe("project"); // 项目排前
    expect(r.hits[0].id).toBe("pj/规则/基准");
    // 反例锚定：分数不同时分数优先（全局 10 分卡不会被 8 分项目卡压过——见 ⑧ 的分数断言前提）
    const r2 = kbSearch(f.kb, { q: "情绪", projectDir: f.p1 });
    expect(r2.hits[0].source).toBe("global"); // 全局标题「情绪曲线标准」8 分独中
  });

  it("⑪k 分配：各根 top-k ⊕ 去重排序截回 k——项目命中是补充（能进榜）但不挤占更高分的全局命中", () => {
    const f = tmpFixture();
    // 全局再加两张：gA 10 分（标题+正文）、gB 8 分（仅标题）、gC 2 分（仅正文）
    const gg = JSON.parse(fs.readFileSync(path.join(f.root, "kit", "hypergraph.rag.json"), "utf-8"));
    fs.mkdirSync(path.join(f.kb, "craft"), { recursive: true });
    fs.writeFileSync(path.join(f.kb, "craft", "aa.md"), `# 甲\n\n正文含检索词的字样。\n`, "utf-8");
    // gB/px 文件正文刻意不含「检索词」——graphSearch 正文打分扫整份原文（含标题行），
    // 想造「仅元数据标题命中 = 8 分」就必须让盘上文件全篇无该词（分数=8 才能与项目卡同分）。
    fs.writeFileSync(path.join(f.kb, "craft", "bb.md"), `# 丙\n\n无关正文。\n`, "utf-8");
    fs.writeFileSync(path.join(f.kb, "craft", "cc.md"), `# 无关题\n\n正文里藏了检索词。\n`, "utf-8");
    gg.entries.push(
      { id: "kb/craft/aa", title: "检索词甲", domain: "craft", path: "knowledge/craft/aa.md", tags: [] },
      { id: "kb/craft/bb", title: "检索词丙", domain: "craft", path: "knowledge/craft/bb.md", tags: [] },
      { id: "kb/craft/cc", title: "无关题", domain: "craft", path: "knowledge/craft/cc.md", tags: [] },
    );
    fs.writeFileSync(path.join(f.root, "kit", "hypergraph.rag.json"), JSON.stringify(gg), "utf-8");
    // 项目加一张 8 分卡（仅标题中「检索词」）——与 gB 同分
    fs.writeFileSync(path.join(f.p1, "规则", "px.md"), `# 乙\n\n项目本地条文，正文与此无涉。\n`, "utf-8");
    const pg = JSON.parse(fs.readFileSync(path.join(f.p1, "kit", "hypergraph.rag.json"), "utf-8"));
    pg.entries.push({ id: "pj/规则/px", title: "检索词乙", domain: "规则", path: "规则/px.md", tags: [] });
    fs.writeFileSync(path.join(f.p1, "kit", "hypergraph.rag.json"), JSON.stringify(pg), "utf-8");

    const r = kbSearch(f.kb, { q: "检索词", k: 3, projectDir: f.p1 });
    expect(r.hits.length).toBe(3); // 池 ≤ 2k 但总量守用户 k
    expect(r.hits[0].id).toBe("kb/craft/aa"); // 10 分全局第一——项目卡不挤占更高分
    expect(r.hits[1].source).toBe("project"); // 8 分同分，项目排前（补充进场）
    expect(r.hits[1].id).toBe("pj/规则/px");
    expect(r.hits[1].score).toBe(r.hits[2].score); // 与 gB 同分
    expect(r.hits[2].id).toBe("kb/craft/bb");
    expect(r.hits.map((h) => h.id)).not.toContain("kb/craft/cc"); // 2 分被截掉
    expect(r.total).toBe(4); // 全局 3 + 项目 1 − 重复 0（total 是全量命中账，不是截断后条数）
  });

  it("⑫kbRead 溯源：项目回落命中返回体 source=project，全局命中 source=global", () => {
    const f = tmpFixture();
    const proj = kbRead(f.kb, "世界书/设定.md", undefined, undefined, undefined, f.p1);
    expect(proj.source).toBe("project");
    const glob = kbRead(f.kb, "kb/aesthetic/curve", undefined, undefined, undefined, f.p1);
    expect(glob.source).toBe("global");
    // 无项目上下文时也恒有标记（词汇表与 kb_search 的 source 一致）
    expect(kbRead(f.kb, "kb/aesthetic/curve").source).toBe("global");
  });
});
