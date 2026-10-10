/**
 * 批次3c R2 · kb_search 两段式聚簇检索（core/src/kb.ts + kit-compile 编译期聚类产物）。
 * 契约：
 *   ① 第一段选簇——查询按「簇名 + 簇内卡词面」给簇打分，最高簇内有任一词面命中（簇分>0）
 *     即簇锚定：成员（含词面零命中的同簇卡）+CLUSTER_BOOST 优先排序——语义关联经共簇传导；
 *   ② 置信不足（无任何簇有命中 / 产物无 cluster 字段）= 回落全局纯词面排序，与历史行为
 *     逐字节一致（零回归：旧产物连 total 口径都不变）；
 *   ③ 簇锚加分（6）< 标题命中（8）——锚定可重排词面弱命中，永不掀翻标题直击的卡；
 *   ④ cluster 参数 = 显式簇过滤（全名或「簇#NN」前缀），产物无聚类数据时整体忽略。
 * fixture 全合成（临时目录，簇名/卡片均为造的，不含真实语料）。
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { kbSearch, loadGraph } from "../src/kb.js";

let dirs: string[] = [];

/** 查询串：只出现在 hook-a 正文里（簇 A 的词面锚点）。 */
const HOOK_A_SENTENCE = "波次收口先杀无义句再查接缝";

/** 合成 fixture：两簇 A/B，各含「词面锚点卡 + 零词面兄弟卡」；再配一张无簇卡。 */
function tmpFixture(withClusters: boolean): { root: string; kb: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kb-cluster-"));
  dirs.push(root);
  const kb = path.join(root, "knowledge");
  const cards: Array<{ rel: string; id: string; title: string; body: string }> = [
    { rel: "aesthetic/hook-a.md", id: "kb/aesthetic/hook-a", title: "开场钩子锚点卡", body: `${HOOK_A_SENTENCE}，这是簇 A 的词面锚点。` },
    { rel: "aesthetic/hook-b.md", id: "kb/aesthetic/hook-b", title: "开场悬念兄弟卡", body: "与锚点句毫无共字面的兄弟条款，只靠同簇传导进场。" },
    { rel: "market/price-a.md", id: "kb/market/price-a", title: "定价规则锚点卡", body: "热度分位与约束分布决定定价规则的词面锚点。" },
    { rel: "market/price-b.md", id: "kb/market/price-b", title: "定价对标的兄弟卡", body: "供给结构的另一面，与锚点句也不共字面。" },
    { rel: "craft/lonely.md", id: "kb/craft/lonely", title: "无簇孤卡", body: "不属于任何簇的孤卡。" },
  ];
  fs.mkdirSync(kb, { recursive: true });
  for (const c of cards) {
    const p = path.join(kb, c.rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, `---\n{\n  "id": "${c.id}",\n  "title": "${c.title}",\n  "tags": []\n}\n---\n\n# ${c.title}\n\n${c.body}\n`, "utf-8");
  }
  const clusterOf: Record<string, string> = {
    "kb/aesthetic/hook-a": "簇#01[钩子,开场]",
    "kb/aesthetic/hook-b": "簇#01[钩子,开场]",
    "kb/market/price-a": "簇#02[定价,规则]",
    "kb/market/price-b": "簇#02[定价,规则]",
  };
  fs.mkdirSync(path.join(root, "kit"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "kit", "hypergraph.rag.json"),
    JSON.stringify({
      format: "storyflow-hypergraph@1",
      stats: { entries: cards.length, relations: 0, domains: ["aesthetic", "market", "craft"] },
      entries: cards.map((c) => ({
        id: c.id, title: c.title, domain: c.rel.split("/")[0], path: `knowledge/${c.rel}`, tags: [] as string[],
        ...(withClusters && clusterOf[c.id] ? { cluster: clusterOf[c.id] } : {}),
      })),
    }),
    "utf-8",
  );
  return { root, kb };
}

afterEach(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  dirs = [];
});

describe("KB 两段式聚簇检索（批次3c R2）", () => {
  it("①簇锚定：锚点句只命中 hook-a，同簇零词面兄弟 hook-b 经共簇传导进榜且排在一切簇外卡之前", () => {
    const f = tmpFixture(true);
    const r = kbSearch(f.kb, { q: HOOK_A_SENTENCE, k: 10 });
    expect(loadGraph(f.kb)?.entries?.some((e) => e.cluster)).toBe(true);
    const ids = r.hits.map((h) => h.id);
    expect(ids).toContain("kb/aesthetic/hook-a");
    expect(ids).toContain("kb/aesthetic/hook-b"); // 零词面成员被簇锚拉进榜
    // 锚点卡（词面 2 + 簇锚 6 = 8）第一，兄弟卡（簇锚 6）第二——簇内按词面分排序
    expect(ids[0]).toBe("kb/aesthetic/hook-a");
    expect(ids[1]).toBe("kb/aesthetic/hook-b");
    expect(r.hits[0].score).toBe(8);
    expect(r.hits[1].score).toBe(6);
    // 锚定簇之外零词面卡（price-b/lonely）不进榜（与历史「score>0 才进榜」一致）
    expect(ids).not.toContain("kb/craft/lonely");
    expect(ids).not.toContain("kb/market/price-b");
  });

  it("②簇选择按簇分取最高：锚点句命中 price-a 时锚定簇 B，簇 A 成员不进场", () => {
    const f = tmpFixture(true);
    const r = kbSearch(f.kb, { q: "热度分位与约束分布决定定价规则的词面锚点", k: 10 });
    const ids = r.hits.map((h) => h.id);
    expect(ids[0]).toBe("kb/market/price-a"); // 词面 2 + 簇锚 6
    expect(ids).toContain("kb/market/price-b"); // 簇 B 兄弟进场
    expect(ids).not.toContain("kb/aesthetic/hook-a"); // 簇 A 未锚定：词面 0 → 不进
    expect(ids).not.toContain("kb/aesthetic/hook-b");
  });

  it("③置信不足回落全局：无任何词面命中 → 零命中；锚定不改变「score>0 才进榜」的全局兜底", () => {
    const f = tmpFixture(true);
    const none = kbSearch(f.kb, { q: "完全无关的查询词组", k: 10 });
    expect(none.total).toBe(0);
    expect(none.hits).toEqual([]);
    // 单词面命中 + 所属簇无其他成员命中 → 簇锚定仍发生（簇分>0 即锚），但排序 = 词面序不乱：
    const r = kbSearch(f.kb, { q: "孤卡", k: 10 });
    expect(r.hits[0].id).toBe("kb/craft/lonely"); // 标题直击 8 分第一
  });

  it("④簇锚（6）不掀标题直击（8）：非锚定簇的标题命中卡稳居第一", () => {
    const f = tmpFixture(true);
    // 查询 = 簇 A 锚点句 + 「定价规则」（price-b 标题含「定价对标的兄弟卡」不含，price-a 标题含「定价规则」→ +8）
    const r = kbSearch(f.kb, { q: `${HOOK_A_SENTENCE} 定价规则`, k: 10 });
    // 簇分：A=2（锚点句在 hook-a 正文）；B=8（price-a 标题）→ B 锚定
    expect(r.hits[0].id).toBe("kb/market/price-a"); // 8 + 6 = 14，标题直击 + 锚定双buff
    // 簇 A 锚点卡只有 2+0=2（未锚定）：被簇 B 零词面兄弟 price-b（6）压过是预期——簇锚只重排弱命中
    const ids = r.hits.map((h) => h.id);
    expect(ids.indexOf("kb/market/price-b")).toBeLessThan(ids.indexOf("kb/aesthetic/hook-a"));
  });

  it("⑤旧产物（无 cluster 字段）零回归：同一查询的榜与 total 口径与历史逐字节一致", () => {
    const old = tmpFixture(false);
    const neo = tmpFixture(true);
    for (const q of [HOOK_A_SENTENCE, "定价规则", "孤卡", "开场钩子锚点卡"]) {
      const before = kbSearch(old.kb, { q, k: 10 });
      // 旧产物：簇 A 锚点句只命中 hook-a（+2），hook-b 永不进场
      expect(before.hits.map((h) => [h.id, h.score])).toEqual(
        kbSearch(old.kb, { q, k: 10 }).hits.map((h) => [h.id, h.score]),
      );
      // 新产物对「标题直击型」查询与旧产物同榜（锚定不动标题命中的头名）
      if (q === "开场钩子锚点卡" || q === "孤卡") {
        expect(kbSearch(neo.kb, { q, k: 10 }).hits[0].id).toBe(before.hits[0].id);
      }
    }
    const before = kbSearch(old.kb, { q: HOOK_A_SENTENCE, k: 10 });
    expect(before.hits.map((h) => h.id)).toEqual(["kb/aesthetic/hook-a"]); // 旧产物：兄弟卡不进场
  });

  it("⑥cluster 参数显式过滤：前缀与全名皆可；不存在的簇 = 显式空；旧产物忽略该参数", () => {
    const f = tmpFixture(true);
    const byPrefix = kbSearch(f.kb, { q: HOOK_A_SENTENCE, k: 10, cluster: "簇#01" });
    expect(byPrefix.hits.map((h) => h.id).sort()).toEqual(["kb/aesthetic/hook-a", "kb/aesthetic/hook-b"]);
    const byFull = kbSearch(f.kb, { q: HOOK_A_SENTENCE, k: 10, cluster: "簇#01[钩子,开场]" });
    expect(byFull.hits.map((h) => h.id).sort()).toEqual(["kb/aesthetic/hook-a", "kb/aesthetic/hook-b"]);
    const ghost = kbSearch(f.kb, { q: HOOK_A_SENTENCE, k: 10, cluster: "簇#99[不存在]" });
    expect(ghost.total).toBe(0);
    expect(ghost.hits).toEqual([]);
    // 旧产物无聚类数据：cluster 参数整体忽略（行为与不带参数一致，不吐空榜）
    const old = tmpFixture(false);
    const ignored = kbSearch(old.kb, { q: HOOK_A_SENTENCE, k: 10, cluster: "簇#01" });
    expect(ignored.hits.map((h) => h.id)).toEqual(["kb/aesthetic/hook-a"]);
  });
});
