/**
 * D1–D5 · 指标口径与派发前置（_918test 拍板清单的落地回归）
 *
 * 这一组测试锁的是**数字可信度**本身：optimize.ts 的全部提案都吃 registry/metrics-summary.json，
 * 口径一旦失真，优化器就会稳定地优化噪声。所以这里断言的不是"功能有没有"，而是"算得对不对"。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { summarizeMetrics } from "../src/metrics.js";
import { bodySkeleton, foreignOwnTerms, headerTemplate } from "../src/asserts.js";
import { loadKnowledge } from "../src/assembler.js";
import { kitRegistry } from "../src/kits.js";
import { ROOT } from "../src/schema.js";

describe("D1 · 标尺卡命中率口径（dispatch 与 submit 必须同一 id 空间）", () => {
  const ev = (o: Record<string, unknown>): never => ({ ts: "2026-09-18T00:00:00Z", ...o }) as never;

  it("分母只在 dispatch 相计数——提交相也带 ctx.ids 时不重复计数", () => {
    const s = summarizeMetrics([
      ev({
        phase: "dispatch",
        nodeId: "tropes",
        kit: "search",
        op: "find-trope",
        ctx: { offered: 2, ids: ["kb/trope/a", "kb/trope/b"] },
      }),
      ev({
        phase: "submit",
        nodeId: "tropes",
        kit: "search",
        op: "find-trope",
        ctx: { offered: 2, used: 1, ids: ["kb/trope/a", "kb/trope/b"], hitIds: ["kb/trope/a"] },
      }),
    ]);
    const a = s.knowledge.find((k) => k.id === "kb/trope/a")!;
    const b = s.knowledge.find((k) => k.id === "kb/trope/b")!;
    // 装载一次 → offered=1（此前 dispatch + submit 各记一次，分母虚高、命中率被腰斩）
    expect(a.offered).toBe(1);
    expect(a.used).toBe(1);
    expect(a.hitRate).toBe(1);
    expect(b.offered).toBe(1);
    expect(b.used).toBe(0);
    expect(b.hitRate).toBe(0);
    // 节点级：分母取派发的装载量，分子取提交的真实命中量
    expect(s.byNode.tropes.ctxOffered).toBe(2);
    expect(s.byNode.tropes.ctxUsed).toBe(1);
    expect(s.byNode.tropes.hitRate).toBe(0.5);
  });

  it("被打回的 tool 记 checkBlock（v5.0 指标更名：asserts→checks；成本口径的返工溢价不再是 0）", () => {
    const s = summarizeMetrics([
      ev({ phase: "submit", nodeId: "tropes", kit: "search", op: "find-trope", checks: { pass: 1, block: 2 } }),
      ev({ phase: "submit", nodeId: "tropes", kit: "search", op: "find-trope", checks: { pass: 3, block: 0 } }),
    ]);
    expect(s.byNode.tropes.checkBlock).toBe(2);
    // costOf = tokens/1000 + ms/60000 + block*5 + retries*2 → 2 次打回至少带来 +10
    expect(s.byNode.tropes.cost).toBeGreaterThanOrEqual(10);
  });
});

describe("D5 · 派发前置（正文骨架 + 禁词表）", () => {
  it("bodySkeleton 给出与头部断言一致的正文硬格式（标题 + 一行 > 摘要）", () => {
    const s = bodySkeleton("deliverable");
    expect(s[0].startsWith("# ")).toBe(true);
    expect(s[1].startsWith("> ")).toBe(true);
  });

  it("headerTemplate 附骨架：骨架落在闭合 --- 之后，不污染 YAML 头", () => {
    const tpl = headerTemplate({
      id: "prose.novel-chapter",
      cls: "deliverable",
      node: "chapter",
      round: 1,
      by: "kit/prose.novel-chapter",
      skeleton: bodySkeleton("deliverable"),
    });
    const lines = tpl.split("\n");
    expect(lines[0]).toBe("---");
    const close = lines.indexOf("---", 1);
    expect(close).toBeGreaterThan(1);
    // 头部区间内不得出现骨架
    expect(lines.slice(1, close).some((l) => l.startsWith("# "))).toBe(false);
    // 骨架紧跟在头之后
    expect(lines[close + 1]).toBe("");
    expect(lines[close + 2].startsWith("# ")).toBe(true);
    expect(lines[close + 3].startsWith("> ")).toBe(true);
  });

  it("不传 skeleton 时保持原样（旧调用不受影响）", () => {
    const tpl = headerTemplate({ id: "x", cls: "draft", node: "n", round: 1, by: "user" });
    expect(tpl.endsWith("---")).toBe(true);
  });

  /**
   * 禁词表（foreignOwnTerms）的两条用例。
   *
   * ⚠️ 数据来源改造（2026-09-20 · OS-00 第 8 项）：原先这两条直接读 `projects/p-fq-001`、
   * `p-ts-001`、`p-key-soul` 三个真实项目目录。这三个目录后来被归档到 `_archive`/`_archived`，
   * 于是 `readProjectOwn` 返回空 → `asserts.ts:477 if (!myOwn.length) return []` →
   * 断言拿到 `[]`，测试长期红着（`expected [] to include '老周'`）。
   *
   * 现在改为**自建 fixture**（临时目录），不再依赖任何真实项目数据 —— 这是把 `projects/`
   * 移出仓库跟踪的前置条件。词条沿用当年 _918test 的三处真实打回记录
   * （老周 / 魏峥 / 思维链），所以断言语义与当年完全一致，只是数据搬进了测试自己。
   */
  const GLOSSARY: Record<string, string[]> = {
    // 本项目（me）：own 词「陈潮生 / 思维链」是当年被 glossary 打回的真实专名
    "p-fq-001": ["陈潮生", "思维链", "海记大排档"],
    // 他项目 A：own 含「老周」（当年打回本项目的违禁词）；「青川」用于验证包含豁免
    "p-ts-001": ["老周", "清川河", "青川", "临江圩"],
    // 他项目 B：own 含「魏峥」（当年打回本项目的违禁词）与「青川县」（包含豁免的母词）
    "p-key-soul": ["魏峥", "青川县", "沈让"],
  };

  let fixtureRoot = "";
  beforeAll(() => {
    fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mf-glossary-"));
    const projectsDir = path.join(fixtureRoot, "projects");
    for (const [id, own] of Object.entries(GLOSSARY)) {
      fs.mkdirSync(path.join(projectsDir, id), { recursive: true });
      fs.writeFileSync(
        path.join(projectsDir, id, "词汇表.json"),
        JSON.stringify({ project: id, own }, null, 2),
        "utf-8",
      );
    }
    // 一个只有目录、没有词汇表的项目：验证「未登记词汇表 → 守卫未启用」
    fs.mkdirSync(path.join(projectsDir, "p-bare"), { recursive: true });
  });
  afterAll(() => {
    if (fixtureRoot) fs.rmSync(fixtureRoot, { recursive: true, force: true });
  });

  it("禁词表 = 他项目 own 词的投影，本项目 own 词不进表", () => {
    const me = path.join(fixtureRoot, "projects", "p-fq-001");
    const terms = foreignOwnTerms(fixtureRoot, me);
    // 真实事件实证：这两处正是 _918test 里 glossary 打回本项目的违禁词
    expect(terms).toContain("老周"); // p-ts-001 own
    expect(terms).toContain("魏峥"); // p-key-soul own
    expect(terms).not.toContain("陈潮生"); // 本项目 own 词——不是违禁词
    expect(terms).not.toContain("思维链"); // 本项目 own 词
    expect(new Set(terms).size).toBe(terms.length); // 去重
  });

  it("未被包含豁免生效：`青川` ⊂ `青川县` → 不把自己项目的派生词当违禁词", () => {
    const me = path.join(fixtureRoot, "projects", "p-key-soul");
    // 「本项目」own 含「青川县」「魏峥」「沈让」；他项目 own 含「青川」（⊂ 青川县）
    const terms = foreignOwnTerms(fixtureRoot, me);
    expect(terms).not.toContain("沈让"); // 本项目 own
    expect(terms).not.toContain("魏峥"); // 本项目 own
    expect(terms).not.toContain("青川"); // 被本项目 own「青川县」包含 → 豁免
    expect(terms).toContain("清川河"); // 不被包含 → 仍是违禁词
    expect(terms).toContain("老周"); // 他项目 own
  });

  it("项目未登记词汇表 → 守卫未启用（返回空，不误报违禁词）", () => {
    // p-bare 只有目录、没有 词汇表.json ⇒ readProjectOwn 返回 [] ⇒ 提前 return []
    expect(foreignOwnTerms(fixtureRoot, path.join(fixtureRoot, "projects", "p-bare"))).toEqual([]);
    // 目录都不存在时同样返回 []，不抛
    expect(foreignOwnTerms(fixtureRoot, path.join(fixtureRoot, "projects", "不存在"))).toEqual([]);
    // 但它仍然作为「他项目」向别人贡献 0 条（不会因为文件缺失把别人搞崩）
    expect(foreignOwnTerms(fixtureRoot, path.join(fixtureRoot, "projects", "p-fq-001"))).toContain("老周");
  });
});

describe("D4 · 注入收窄（find-trope 的梗族卡：R8 后走决策过滤，硬剔除退役）", () => {
  const CAPS = { total: 60000, card: 1600 };

  it("收窄口径搬家：exclude_knowledge 清场，梗卡改由候选池按 decision:region 过滤", () => {
    const op = kitRegistry(ROOT).resolve("topic", "find-trope")!;
    // 海外卡不许被静态名单删掉（旧行为：region 隐含 CN 就硬剔 na-*，NA 项目直接选不到梗）
    expect(op.knowledge).not.toContain("kb/trope/*");
    expect(op.excludeKnowledge).toEqual([]);
    const pool = op.knowledgePools.find((p) => p.pool === "kb/trope/*");
    expect(pool?.where?.tags).toEqual(["$decision:region.picked"]);
    // 未定案 = 两区都看，且必须显式告警（不静默全装）
    expect(pool?.onMissingDecision).toBe("load-all-with-warning");
  });

  it("region=CN → 北美卡进「未装载的候选」并带理由；无决策 → 两区全装 + 选择面告警", () => {
    const op = kitRegistry(ROOT).resolve("topic", "find-trope")!;
    const cn = loadKnowledge(ROOT, op.knowledge, op.excludeKnowledge ?? [], CAPS, op.knowledgePools, {
      region: { key: "region", picked: ["CN"] },
    });
    const ids = cn.cards.map((c) => c.id);
    expect(ids).toContain("kb/trope/dalian-nuezha");
    expect(ids, "region=CN 时北美卡不该进标尺").not.toContain("kb/trope/na-fantasy");
    expect(cn.notSelected.find((x) => x.id === "kb/trope/na-fantasy")?.reason).toContain("不含本次所选");

    const cold = loadKnowledge(ROOT, op.knowledge, [], CAPS, op.knowledgePools, {});
    expect(cold.cards.map((c) => c.id)).toContain("kb/trope/na-fantasy");
    expect(cold.poolIssues.join("")).toContain("未按决策过滤");
  });
});
