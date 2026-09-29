// R8 S3 · 选择面求交（resolveSelection 纯函数）+ 装载口接线（loadKnowledge pools / skill_pool）
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  expandTagToken,
  inScope,
  poolEntries,
  resolveSelection,
  resolveSkillFromPool,
  type DecisionLite,
} from "../src/selection.js";
import { loadKnowledge } from "../src/assembler.js";
import { fileURLToPath } from "node:url";

/** 真仓根（候选出厂在 repoRoot——两个根纪律，铁律 5） */
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const E = (id: string, tags: string[] = []) => ({ id, tags });
const D = (key: string, picked: string[], excluded_tags?: string[]): DecisionLite => ({
  key,
  picked,
  ...(excluded_tags ? { excluded_tags } : {}),
});

describe("R8 S3 · resolveSelection（纯函数，规范 §1.3）", () => {
  it("正过滤：$decision:<key>.tags 命中标签才装载，未命中带理由进 excluded", () => {
    const entries = [E("kb/trope/nianyan", ["年代言情", "克制"]), E("kb/trope/xuanhuan", ["玄幻"])];
    const r = resolveSelection(entries, { genre: D("genre", ["年代言情"], ["玄幻"]) }, {
      pool: "kb/trope/*",
      where: { tags: ["all", "$decision:genre.tags"] },
    });
    expect(r.loaded.map((e) => e.id)).toEqual(["kb/trope/nianyan"]);
  });

  it("铁律 2：无标签候选未被命中 = 不装 + 显式理由（不静默、不回落、不全装）", () => {
    const entries = [E("kb/trope/untagged")];
    const r = resolveSelection(entries, { genre: D("genre", ["言情"]) }, {
      pool: "kb/trope/*",
      where: { tags: ["$decision:genre.tags"] },
    });
    expect(r.loaded).toEqual([]);
    expect(r.excluded[0].reason).toContain("无标签");
  });

  it("反过滤 notTags：命中排除标签即剔除（excluded_tags 引用）", () => {
    const entries = [E("kb/trope/xuanhuan", ["玄幻"]), E("kb/trope/daoyan", ["年代"])];
    const r = resolveSelection(entries, { genre: D("genre", ["年代"], ["玄幻"]) }, {
      pool: "kb/trope/*",
      where: { notTags: ["$decision:genre.excluded_tags"] },
    });
    expect(r.loaded.map((e) => e.id)).toEqual(["kb/trope/daoyan"]);
    expect(r.excluded[0].reason).toContain("玄幻");
    expect(r.excluded[0].decisionKey).toBe("genre");
  });

  it("缺决策默认 block：整池不装 + issues 显式失败（不装作选了）", () => {
    const entries = [E("kb/trope/a", ["x"])];
    const r = resolveSelection(entries, {}, { pool: "kb/trope/*", where: { tags: ["$decision:genre.tags"] } });
    expect(r.loaded).toEqual([]);
    expect(r.issues.join("")).toContain("block");
    expect(r.excluded).toHaveLength(1);
  });

  it("显式 load-all-with-warning：全装但出告警（要全装必须明说）", () => {
    const entries = [E("kb/trope/a", ["x"]), E("kb/trope/b")];
    const r = resolveSelection(entries, {}, {
      pool: "kb/trope/*",
      where: { tags: ["$decision:genre.tags"] },
      onMissingDecision: "load-all-with-warning",
    });
    expect(r.loaded).toHaveLength(2);
    expect(r.issues.join("")).toContain("未按决策过滤");
  });

  it("决策引用了候选里不存在的标签 → issues（§1.2 可校验，不静默）", () => {
    const entries = [E("kb/trope/a", ["年代"])];
    const r = resolveSelection(entries, { genre: D("genre", ["不存在的标签"]) }, {
      pool: "kb/trope/*",
      where: { tags: ["$decision:genre.tags"] },
    });
    expect(r.loaded).toEqual([]);
    expect(r.issues.join("")).toContain("在候选里不存在");
  });

  it("无 where = 池内全装；notTags 单独可用", () => {
    const entries = [E("kb/trope/a", ["玄幻"]), E("kb/trope/b", ["年代"])];
    const all = resolveSelection(entries, {}, { pool: "kb/trope/*" });
    expect(all.loaded).toHaveLength(2);
    const neg = resolveSelection(entries, { g: D("g", [], ["玄幻"]) }, {
      pool: "kb/trope/*",
      where: { notTags: ["$decision:g.excluded_tags"] },
    });
    expect(neg.loaded.map((e) => e.id)).toEqual(["kb/trope/b"]);
  });

  it("token 展开与池匹配的原语", () => {
    expect(expandTagToken("言情", {})).toEqual(["言情"]);
    expect(expandTagToken("$decision:genre.tags", { genre: D("genre", ["a", "b"]) })).toEqual(["a", "b"]);
    expect(expandTagToken("$decision:genre.picked", {})).toBeUndefined();
    expect(inScope(E("kb/trope/a"), "kb/trope/*")).toBe(true);
    expect(inScope(E("kb/aesthetic/a"), "kb/trope/*")).toBe(false);
    expect(inScope(E("kb/aesthetic/style-routes"), "kb/aesthetic/style-routes")).toBe(true);
  });
});

describe("R8 S3 · 候选库磁盘读 + 装载口接线", () => {
  function seedRoot() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "miniflow-sel-"));
    fs.mkdirSync(path.join(root, "knowledge", "trope"), { recursive: true });
    const card = (rel: string, fm: object) =>
      fs.writeFileSync(path.join(root, "knowledge", rel), `---\n${JSON.stringify(fm)}\n---\n\n正文内容${rel}`, "utf-8");
    card("trope/nianyan.md", { id: "kb/trope/nianyan", tags: ["年代", "言情"] });
    card("trope/xuanhuan.md", { routes: ["玄幻"] }); // 旧轴 routes 兼容读
    card("trope/plain.md", {}); // 无 frontmatter 字段 = 无标签
    return root;
  }

  it("poolEntries：tags ∪ routes 并进标签轴（S4 做正式迁移）", () => {
    const root = seedRoot();
    const entries = poolEntries(root, "kb/trope/*");
    const byId = Object.fromEntries(entries.map((e) => [e.id, e.tags]));
    expect(byId["kb/trope/nianyan"]).toEqual(["年代", "言情"]);
    expect(byId["kb/trope/xuanhuan"]).toEqual(["玄幻"]);
    expect(byId["kb/trope/plain"]).toEqual([]);
  });

  it("loadKnowledge(pools)：池命中进正文、未命中进 notSelected、缺决策进 poolIssues", () => {
    const root = seedRoot();
    const decisions = { genre: D("genre", ["言情"], ["玄幻"]) };
    const withDec = loadKnowledge(root, [], [], { total: 9000, card: 1600 }, [
      { pool: "kb/trope/*", where: { tags: ["$decision:genre.tags"], notTags: ["$decision:genre.excluded_tags"] } },
    ], decisions);
    expect(withDec.text).toContain("正文内容trope/nianyan.md");
    expect(withDec.notSelected.map((x) => x.id)).toContain("kb/trope/plain.md".replace(".md", ""));
    expect(withDec.notSelected.find((x) => x.id === "kb/trope/xuanhuan")?.reason).toContain("排除");
    expect(withDec.poolIssues).toEqual([]);

    const blocked = loadKnowledge(root, [], [], { total: 9000, card: 1600 }, [
      { pool: "kb/trope/*", where: { tags: ["$decision:genre.tags"] } },
    ], {});
    expect(blocked.cards).toHaveLength(0);
    expect(blocked.poolIssues.join("")).toContain("block");
  });

  it("resolveSkillFromPool：决策选中即中；缺决策/无文件显式报缺不回落；多选有注记", () => {
    const exists = (rel: string) => rel === "zhang_ailing.md";
    expect(resolveSkillFromPool("style/*", { style: D("style", ["zhang_ailing"]) }, exists).skill).toBe("zhang_ailing");
    expect(() => resolveSkillFromPool("style/*", {}, exists)).toThrow(/选择未决.*style/);
    expect(() => resolveSkillFromPool("style/*", { style: D("style", ["ghost"]) }, exists)).toThrow(/没有对应技能文件/);
    const multi = resolveSkillFromPool("style/*", { style: D("style", ["zhang_ailing", "guLong"]) }, exists);
    expect(multi.skill).toBe("zhang_ailing");
    expect(multi.note).toContain("首个命中");
  });
});

describe("R8 生产端接线 · 梗卡市场轴（真仓候选库，region 决策过滤）", () => {
  const POOL = "kb/trope/*" as const;

  it("13 张梗卡全员带市场轴：CN 10 / NA 3（决策 picked 与卡标签同一词表，不翻译）", () => {
    const entries = poolEntries(REPO, POOL);
    expect(entries).toHaveLength(13);
    expect(entries.filter((e) => e.tags.includes("CN"))).toHaveLength(10);
    expect(entries.filter((e) => e.tags.includes("NA"))).toHaveLength(3);
  });

  it("region=CN → 三张北美卡带理由进 excluded；无决策 → 两区全装并告警（禁硬剔除）", () => {
    const entries = poolEntries(REPO, POOL);
    const decl = {
      pool: POOL,
      where: { tags: ["$decision:region.picked"] },
      onMissingDecision: "load-all-with-warning" as const,
    };
    const cn = resolveSelection(entries, { region: D("region", ["CN"]) }, decl);
    expect(cn.loaded.every((e) => e.tags.includes("CN"))).toBe(true);
    expect(cn.excluded.map((x) => x.id)).toEqual([
      "kb/trope/na-billionaire",
      "kb/trope/na-fantasy",
      "kb/trope/na-werewolf",
    ]);
    expect(cn.excluded[0].reason).toContain("不含本次所选");
    const na = resolveSelection(entries, { region: D("region", ["NA"]) }, decl);
    expect(na.loaded.map((e) => e.id)).toEqual(cn.excluded.map((x) => x.id));
    const cold = resolveSelection(entries, {}, decl);
    expect(cold.loaded).toHaveLength(13);
    expect(cold.issues.join("")).toContain("未按决策过滤");
  });

  it("装载口真跑：region=NA 的任务包装北美卡、把国内卡列进「未装载的候选」", () => {
    const r = loadKnowledge(REPO, [], [], { total: 9000, card: 1600 }, [
      { pool: POOL, where: { tags: ["$decision:region.picked"] } },
    ], { region: D("region", ["NA"]) });
    expect(r.missing).toEqual([]);
    expect(r.cards.map((c) => c.id)).toContain("kb/trope/na-werewolf");
    expect(r.notSelected.map((x) => x.id)).toContain("kb/trope/chongsheng-fuchou");
    expect(r.poolIssues).toEqual([]);
  });
});
