import { describe, expect, it, beforeAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Kernel } from "../src/kernel.js";
import { ROOT } from "../src/schema.js";
import { artifact, lockBootstrapPolicy } from "./helpers.js";

const DIRECTION = "老牌发型师在连锁快剪店里坚持先洗后剪慢工出细活（e2e）";

async function walkToGateR1(kernel: Kernel, projectId: string, pd: string): Promise<void> {
  // tropes → (combo) → zeitgeist → (benchmark) → analysis → gate-r1 挂起
  let stop = await kernel.flow_submit(projectId, "tropes", {
    content: artifact("topic-selection", "tropes", "# 梗卡（e2e）\n\n主梗：快剪 10 分钟 vs 慢工 40 分钟。\n", { projectDir: pd }),
  });
  expect(stop.status).toBe("accepted");
  stop = await kernel.flow_submit(projectId, "zeitgeist", {
    content: artifact("topic-selection", "zeitgeist", "# 时代情绪锚\n\n算法赶人公共讨论。\n", { projectDir: pd }),
  });
  expect(stop.status).toBe("accepted");
  const last = await kernel.flow_submit(projectId, "analysis", {
    content: artifact("topic-selection", "analysis", "# 选题分析报告\n\n## 五、创作约束移交单\n- 场景 ≤3。\n", {
      projectDir: pd,
    }),
  });
  expect(last.status).toBe("accepted");
  expect(last.next?.status).toBe("suspended");
}

describe("kernel · 三门语义（topic-selection @ 临时项目）", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miniflow-e2e-"));
  const projectId = "p-e2e-test";
  const kernel = new Kernel({ root });
  const pd = path.join(root, "projects", projectId);

  beforeAll(async () => {
    fs.mkdirSync(path.join(root, "projects", projectId), { recursive: true });
    fs.writeFileSync(
      path.join(root, "projects", projectId, "选题素材.md"),
      "# 选题素材\n\n甲方点子：老牌发型师。\n",
      "utf-8",
    );
    // R5：本套断言的是门语义本身 → 用 overlay 锁定 bootstrap 编排（手动门、无边界面）
    lockBootstrapPolicy(pd, "topic-selection");
  });

  it("flow_run 停在首个认知步 tropes，任务包带 skill 与产物契约", async () => {
    const stop = await kernel.flow_run("topic-selection", projectId, { route: "hot", direction: DIRECTION });
    expect(stop.status).toBe("awaiting_input");
    if (stop.status !== "awaiting_input") return;
    expect(stop.nodeId).toBe("tropes");
    expect(stop.taskPackage.instruction.skill).toBe("find-trope");
    expect(stop.taskPackage.outputContract.file).toBe("内部/稿本/梗卡.md");
    // 就绪批并行派发：tropes ∥ zeitgeist 同批（AND-join 就绪集，互不依赖）
    expect(stop.batch?.map((b) => b.nodeId).sort()).toEqual(["tropes", "zeitgeist"]);
    expect(stop.taskPackage.parallelWith).toContain("zeitgeist");
    // kb_load 产物成为上游上下文（哈希锚定）
    const marketArtifact = stop.taskPackage.context.find((c) => c.ref.includes("kb-market"));
    expect(marketArtifact).toBeDefined();
    expect(marketArtifact?.hash).toMatch(/^[0-9a-f]{12}$/);
  });

  it("S1 链路提交 → gate-r1 挂起（三重凭据）", async () => {
    await walkToGateR1(kernel, projectId, pd);
    const again = await kernel.flow_next(projectId);
    expect(again.status).toBe("suspended"); // 幂等
    if (again.status !== "suspended") return;
    expect(again.gate.token).toContain(`approval:${projectId}:`);
  });

  it("旧轮次裁决被拒（STALE_GATE 409）", async () => {
    await expect(kernel.flow_gate(projectId, { nodeId: "gate-r1", verdict: "pass", round: 9 })).rejects.toThrow(
      /轮次过期/,
    );
  });

  it("send-back 级联失效：回滚到阶段入口，round 只增，宿主领到新任务包", async () => {
    const r = await kernel.flow_gate(projectId, {
      nodeId: "gate-r1",
      verdict: "send-back",
      rootCauseStage: "S1",
      comment: "梗选型撞车",
    });
    expect(r.applied).toBe(true);
    expect(r.rollbackScope?.[0]).toBe("src");
    expect(r.next?.status).toBe("awaiting_input");
    if (r.next?.status !== "awaiting_input") return;
    expect(r.next.nodeId).toBe("tropes");
    const state = JSON.parse(fs.readFileSync(path.join(root, "projects", projectId, "state.json"), "utf-8"));
    expect(state.nodes.src.status).toBe("done"); // 源步重跑后完成
    expect(state.nodes.tropes.stale).toBe(true);
    expect(state.lastRejectReason).toBe("梗选型撞车");
  });

  it("重走 S1 → pass → 推进到 structure；resume 幂等", async () => {
    await walkToGateR1(kernel, projectId, pd);
    const r = await kernel.flow_gate(projectId, { nodeId: "gate-r1", verdict: "pass", comment: "R1 过" });
    expect(r.applied).toBe(true);
    expect(r.next?.status).toBe("awaiting_input");
    if (r.next?.status !== "awaiting_input") return;
    expect(r.next.nodeId).toBe("structure");
    const resume = await kernel.flow_resume(projectId);
    expect(resume.status).toBe("awaiting_input");
    if (resume.status !== "awaiting_input") return;
    expect(resume.nodeId).toBe("structure");
  });

  it("打回仅本阶段：gate-r2 send-back 不波及已验收的 S1；force 才可跨阶段", async () => {
    const st = await kernel.flow_submit(projectId, "structure", {
      content: artifact("topic-selection", "structure", "# 故事框架案\n\n## 一、主矛盾\n\n行业效率 vs 手艺人体面。\n", {
        projectDir: pd,
      }),
    });
    expect(st.status).toBe("accepted");
    expect(st.next?.status).toBe("suspended");
    // 不带 force：即使指认 rootCauseStage=S1，也只回本阶段入口 structure，S1 定稿不受影响
    const r = await kernel.flow_gate(projectId, {
      nodeId: "gate-r2", verdict: "send-back", rootCauseStage: "S1", comment: "想打回调研",
    });
    expect(r.applied).toBe(true);
    expect(r.rollbackScope).not.toContain("src");
    expect(r.rollbackScope).not.toContain("tropes");
    expect(r.next?.status).toBe("awaiting_input");
    if (r.next?.status !== "awaiting_input") return;
    expect(r.next.nodeId).toBe("structure");
    const state = JSON.parse(fs.readFileSync(path.join(root, "projects", projectId, "state.json"), "utf-8"));
    expect(state.nodes.analysis.status).toBe("done"); // S1 已验收 = 定稿
    // force = 用户强行介入：跨阶段回滚到 S1 入口
    const st2 = await kernel.flow_submit(projectId, "structure", {
      content: artifact("topic-selection", "structure", `# 故事框架案 v2

## 一、主矛盾

效率 vs 体面。`, { projectDir: pd }),
    });
    expect(st2.status).toBe("accepted");
    expect(st2.next?.status).toBe("suspended");
    const r2 = await kernel.flow_gate(projectId, {
      nodeId: "gate-r2", verdict: "send-back", force: true, rootCauseStage: "S1", comment: "调研确需返工",
    });
    expect(r2.applied).toBe(true);
    expect(r2.rollbackScope).toContain("src");
    expect(r2.rollbackScope).toContain("structure");
  });

  it("提交即注册 + 快照落档；journal 可回放", async () => {
    const arts = kernel.viewArtifacts(projectId, { node: "tropes" });
    expect(arts.length).toBeGreaterThanOrEqual(1);
    expect(kernel.viewArtifactContent(projectId, arts[arts.length - 1].path)).toContain("梗卡");
    const snaps = kernel.viewSnapshots(projectId, "tropes");
    expect(snaps.length).toBeGreaterThanOrEqual(2); // 两轮提交
    const journal = kernel.viewJournal(projectId, {});
    const kinds = new Set(journal.map((e) => e.event));
    expect(kinds.has("run-start")).toBe(true);
    expect(kinds.has("verdict")).toBe(true);
    expect(kinds.has("stale")).toBe(true);
  });

  it("workbench-payload 与旧页面 DATA 同构", () => {
    const payload = kernel.viewWorkbenchPayload(projectId);
    expect(payload.flow).toBeTruthy();
    expect(payload.runstate).toBeTruthy();
    expect(payload.project).toBe(projectId);
    expect(payload.files["选题素材.md"] ?? payload.files["梗卡.md"]).toBeDefined();
  });
});
