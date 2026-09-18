/**
 * D1–D5 · 指标口径与派发前置（_918test 拍板清单的落地回归）
 *
 * 这一组测试锁的是**数字可信度**本身：optimize.ts 的全部提案都吃 registry/metrics-summary.json，
 * 口径一旦失真，优化器就会稳定地优化噪声。所以这里断言的不是"功能有没有"，而是"算得对不对"。
 */
import { describe, expect, it } from "vitest";
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

  it("被打回的 tool 记 assertBlock（成本口径的返工溢价不再是 0）", () => {
    const s = summarizeMetrics([
      ev({ phase: "submit", nodeId: "tropes", kit: "search", op: "find-trope", asserts: { pass: 1, block: 2 } }),
      ev({ phase: "submit", nodeId: "tropes", kit: "search", op: "find-trope", asserts: { pass: 3, block: 0 } }),
    ]);
    expect(s.byNode.tropes.assertBlock).toBe(2);
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

  it("禁词表 = 他项目 own 词的投影，本项目 own 词不进表", () => {
    const me = path.join(ROOT, "projects", "p-fq-001");
    const terms = foreignOwnTerms(ROOT, me);
    // 真实数据实证：这三个词正是 _918test 里 glossary 打回的三处
    expect(terms).toContain("老周"); // p-ts-001 own
    expect(terms).toContain("魏峥"); // p-key-soul own
    expect(terms).not.toContain("陈潮生"); // 本项目 own 词——不是违禁词
    expect(new Set(terms).size).toBe(terms.length); // 去重
  });

  it("未被包含豁免生效：`青川` ⊂ `青川河` → 不把自己项目的派生词当违禁词", () => {
    // p-key-soul own 含「青川县」；p-ts-001 own 含「清川河」（不同字，不构成包含）
    const terms = foreignOwnTerms(ROOT, path.join(ROOT, "projects", "p-key-soul"));
    expect(terms).not.toContain("沈让"); // 本项目 own
    expect(terms).toContain("老周"); // 他项目 own
  });
});

describe("D4 · 注入收窄（find-trope 的梗族卡）", () => {
  it("`kb/trope/*` 展开后剔除 na-* 海外梗卡，且被显式报告为「已剔除」", () => {
    const op = kitRegistry(ROOT).resolve("search", "find-trope")!;
    // 声明层：glob 仍在（保留可检索性），收窄走 exclude_knowledge（精确、可审计、可回滚）
    expect(op.knowledge).toContain("kb/trope/*");
    expect(op.excludeKnowledge).toContain("kb/trope/na-fantasy");

    const kb = loadKnowledge(ROOT, op.knowledge, op.excludeKnowledge ?? []);
    const ids = kb.cards.map((c) => c.id);
    // 三张北美市场梗卡不再装载（flow 的 region 默认 CN）
    for (const na of ["kb/trope/na-billionaire", "kb/trope/na-fantasy", "kb/trope/na-werewolf"]) {
      expect(ids, `${na} 不该被装载`).not.toContain(na);
      expect(kb.excluded, `${na} 必须显式回显为已剔除，不得静默消失`).toContain(na);
    }
    // 国产梗卡仍在
    expect(ids).toContain("kb/trope/dalian-nuezha");
    expect(ids).toContain("kb/trope/chongsheng-fuchou");
    expect(kb.excluded.length).toBe(3);
  });
});
