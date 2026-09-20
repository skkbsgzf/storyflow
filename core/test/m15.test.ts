import { describe, expect, it, beforeAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Kernel } from "../src/kernel.js";
import { checkGlossary } from "../src/asserts.js";
import { ROOT } from "../src/schema.js";
import { artifact, lockBootstrapPolicy } from "./helpers.js";

const DIRECTION = "老牌发型师在连锁快剪店里坚持先洗后剪慢工出细活（m1.5）";

async function walkToGateR1(kernel: Kernel, projectId: string, pd: string, tropesContent: string): Promise<void> {
  const a = await kernel.flow_submit(projectId, "tropes", {
    content: artifact("topic-selection", "tropes", tropesContent, { projectDir: pd }),
  });
  expect(a.status).toBe("accepted");
  const b = await kernel.flow_submit(projectId, "zeitgeist", {
    content: artifact("topic-selection", "zeitgeist", "# 时代情绪锚\n\n算法赶人。\n", { projectDir: pd }),
  });
  expect(b.status).toBe("accepted");
  const c = await kernel.flow_submit(projectId, "analysis", {
    content: artifact("topic-selection", "analysis", "# 选题分析报告\n\n## 五、创作约束移交单\n- 场景 ≤3。\n", {
      projectDir: pd,
    }),
  });
  expect(c.status).toBe("accepted");
  expect(c.next?.status).toBe("suspended");
}

describe("M1.5 · 角色剖面 / 词汇表守卫 / 缓存命中", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miniflow-m15-"));
  const projectId = "p-m15";
  const kernel = new Kernel({ root });
  const pd = path.join(root, "projects", projectId);

  beforeAll(async () => {
    fs.cpSync(path.join(ROOT, "agents"), path.join(root, "agents"), { recursive: true });
    const dir = path.join(root, "projects", projectId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "选题素材.md"), "# 选题素材\n\n甲方点子：老牌发型师。\n", "utf-8");
    // R5：锁定 bootstrap 编排语义（断言门语义与计划序，不是断言 R5 默认策略）
    lockBootstrapPolicy(dir, "topic-selection");
    const stop = await kernel.flow_run("topic-selection", projectId, { route: "hot", region: "CN", direction: DIRECTION });
    expect(stop.status).toBe("awaiting_input");
  });

  it("任务包携带角色剖面（find-trope → story-analyst）", async () => {
    const stop = await kernel.flow_next(projectId);
    expect(stop.status).toBe("awaiting_input");
    if (stop.status !== "awaiting_input") return;
    expect(stop.taskPackage.profile?.id).toBe("story-analyst");
    expect(stop.taskPackage.profile?.role).toBe("analyst");
  });

  it("结构步剖面为编排师；门通过后 structure 领到 choreographer", async () => {
    await walkToGateR1(kernel, projectId, pd, "# 梗卡\n\n快剪 vs 慢工。\n");
    const r = await kernel.flow_gate(projectId, { nodeId: "gate-r1", verdict: "pass" });
    expect(r.next?.status).toBe("awaiting_input");
    if (r.next?.status !== "awaiting_input") return;
    expect(r.next.nodeId).toBe("structure");
    expect(r.next.taskPackage.profile?.role).toBe("choreographer");
  });

  it("rerun dryRun 预览缓存候选（combo 报告指纹未变）", async () => {
    const r = await kernel.flow_rerun(projectId, { nodeId: "tropes", dryRun: true });
    expect(r.cacheCandidates).toContain("combo");
  });

  it("真跑 rerun：确定性 combo 步缓存命中，创意步照常重做", async () => {
    const rr = await kernel.flow_rerun(projectId, { nodeId: "tropes", dryRun: false });
    expect(rr.next?.status).toBe("awaiting_input");
    // 重提交【完全相同】的梗卡内容 → combo 的输入指纹未变 → 应命中缓存
    const a = await kernel.flow_submit(projectId, "tropes", {
      content: artifact("topic-selection", "tropes", "# 梗卡\n\n快剪 vs 慢工。\n", { projectDir: pd }),
    });
    expect(a.status).toBe("accepted");
    const journal = kernel.viewJournal(projectId, {});
    const hit = journal.find((e) => (e.detail ?? "").includes("缓存命中") && e.nodeId === "combo");
    expect(hit).toBeDefined();
  });

  it("词汇表守卫：他项目专名出现即 block；本项目未登记则不启用", async () => {
    const pA = path.join(root, "projects", "p-a");
    const pB = path.join(root, "projects", "p-b");
    fs.mkdirSync(pA, { recursive: true });
    fs.mkdirSync(pB, { recursive: true });
    fs.writeFileSync(path.join(pA, "词汇表.json"), JSON.stringify({ project: "p-a", own: ["王拾", "陈听澜"] }), "utf-8");
    fs.writeFileSync(path.join(pB, "词汇表.json"), JSON.stringify({ project: "p-b", own: ["周正", "青川河"] }), "utf-8");
    fs.writeFileSync(path.join(pB, "产物.md"), "王拾在这里乱入，还有陈听澜。\n", "utf-8");
    fs.writeFileSync(path.join(pB, "干净.md"), "周正的故事。\n", "utf-8");
    fs.writeFileSync(path.join(pA, "无表.md"), "随便写点。\n", "utf-8");

    const hit = checkGlossary(root, pB, "产物.md");
    expect(hit?.status).toBe("block");
    expect(hit?.detail).toContain("王拾");

    const clean = checkGlossary(root, pB, "干净.md");
    expect(clean?.status).toBe("pass"); // 青川河 ⊇ 青川？——此处 B 的 own 是 周正/青川河，A 的 王拾 不出现
    const pC = path.join(root, "projects", "p-c");
    fs.mkdirSync(pC, { recursive: true });
    fs.writeFileSync(path.join(pC, "无表.md"), "随便写点。\n", "utf-8");
    const unguarded = checkGlossary(root, pC, "无表.md");
    expect(unguarded).toBeUndefined();
  });
});
