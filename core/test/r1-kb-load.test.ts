/**
 * 批次3c R1 · N1/N2 装载修复回归——钉住 plan 域两个 op 的知识声明形状与装载事实。
 *
 * 病根（Q3 报告 N1 静态推断 + 本次实测坐实）：topic-proposal 曾声明
 * `kb/aesthetic/*` + `kb/benchmark/*` 两个 glob，声明序 first-fit + 9000 字总量封顶下
 * aesthetic 域先吃满预算，28 卡对标库 **0 张装载**（纸面消费、饥饿装载）——
 * 实测收据 projects/_reports/kb-load-n1-20261011.json（benchmark 0 / missing 29）。
 *
 * 修复口径（模块声明精选，不走 R8 池过滤——benchmark 卡 frontmatter 无 tags/routes，
 * 铁律 2「无标签不参与匹配」会整池排除，而 knowledge/ 是用户资产本批零改动）：
 * - topic-proposal：4 张 benchmark（CN 头部 A+、四族各一、男频 ×1 女频 ×3）+ hook-3s + character；
 * - topic-chief-aesthetic（N2 语料裸奔）：3 张 benchmark（与方案步同口径对标）+ 三维标尺卡
 *   hook-3s / unreasonable-highlight / visual-poster。
 * 复测收据：kb-load-n1-20261011-after.json / kb-load-n2-chief-aesthetic-20261011.json
 * （benchmark 4/3 张进装载、missing 空、9000 字预算自洽）。
 *
 * 本组测试与 kits.test.ts 同一依赖口径：知识卡是本地可插拔层（不入库），断言
 * 声明形状（入库面）+ 装载行为（本地面）。
 */
import { describe, expect, it } from "vitest";
import { loadKnowledge } from "../src/assembler.js";
import { kitRegistry } from "../src/kits.js";
import { DEFAULT_BUDGET } from "../src/budget.js";
import { rootOf } from "../src/schema.js";

// 出厂预算（与 buildTaskPackage 冷启动同值；flow 未覆写 budget）
const CAPS = {
  total: DEFAULT_BUDGET.kbTotalCap?.value ?? 9000,
  card: DEFAULT_BUDGET.kbCardCap?.value ?? 1600,
};

/** 与 buildTaskPackage 同参同序的装载（空决策=冷启动；两 op 均无池声明）。 */
function loadFor(kit: string, op: string) {
  const ref = kitRegistry(rootOf()).resolve(kit, op);
  expect(ref, `模块解析失败：${kit}.${op}`).toBeTruthy();
  return {
    ref: ref!,
    kb: loadKnowledge(rootOf(), ref!.knowledge, ref!.excludeKnowledge ?? [], CAPS, ref!.knowledgePools ?? {}, {}),
  };
}

describe("批次3c R1 · N1 benchmark 饥饿装载修复（plan.topic-proposal）", () => {
  it("声明精选化：不再持有 aesthetic/benchmark glob（glob 全量声明正是饥饿根因）", () => {
    const { ref } = loadFor("plan", "topic-proposal");
    for (const k of ref.knowledge) {
      expect(k.endsWith("/*"), `声明仍是 glob：${k}`).toBe(false);
    }
    expect(ref.knowledge).toEqual([
      "kb/benchmark/b001-cn",
      "kb/benchmark/b004-cn",
      "kb/benchmark/b012-cn",
      "kb/benchmark/b013-fam",
      "kb/aesthetic/hook-3s",
      "kb/aesthetic/character",
    ]);
  });

  it("对标库真实进装载：benchmark ≥3 张，装载清单与声明一致且无缺口", () => {
    const { ref, kb } = loadFor("plan", "topic-proposal");
    const ids = kb.cards.map((c) => c.id);
    expect(ids.filter((id) => id.startsWith("kb/benchmark/")).length).toBeGreaterThanOrEqual(3);
    expect(kb.missing, "声明了却没装载——精选清单超预算自打脸").toEqual([]);
    expect(ids, "装载序应与声明序一致（全数装载）").toEqual(ref.knowledge);
    // 预算纪律：装载总字数不超总量封顶
    const used = kb.cards.reduce((a, c) => a + c.chars, 0);
    expect(used).toBeLessThanOrEqual(CAPS.total);
  });
});

describe("批次3c R1 · N2 审美终审语料裸奔修复（plan.topic-chief-aesthetic）", () => {
  it("补 benchmark 对标声明 + 三维标尺卡（爆点强度/钩子冲击力/名场面可视化）", () => {
    const { ref } = loadFor("plan", "topic-chief-aesthetic");
    expect(ref.knowledge.filter((k) => k.startsWith("kb/benchmark/")).length).toBeGreaterThanOrEqual(3);
    expect(ref.knowledge).toContain("kb/aesthetic/hook-3s");
    expect(ref.knowledge).toContain("kb/aesthetic/unreasonable-highlight");
    expect(ref.knowledge).toContain("kb/aesthetic/visual-poster");
  });

  it("装载自洽：对标卡与三维标尺卡全数进装载，missing 为空", () => {
    const { kb } = loadFor("plan", "topic-chief-aesthetic");
    const ids = kb.cards.map((c) => c.id);
    expect(ids.filter((id) => id.startsWith("kb/benchmark/")).length).toBeGreaterThanOrEqual(3);
    expect(ids).toContain("kb/aesthetic/hook-3s");
    expect(ids).toContain("kb/aesthetic/visual-poster");
    expect(kb.missing).toEqual([]);
  });
});
