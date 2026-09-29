import { describe, expect, it, beforeAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Kernel } from "../src/kernel.js";
import { artifact } from "./helpers.js";

/**
 * 本套断言的是 **flow@3 link 连接件门语义**（topic v6.0.0，模块序列 m1..m5）：
 *   - 节点 id = `<模块实例>.<op>`（expandFlow3 派生，与内核同一展开单点，见 helpers.expandedFlow）；
 *   - 模块内无门无打回；模块间 link 连接件只有 pass/reject 两值（core/src/kernel.ts doGate link 分支）：
 *       m2/m4/m5.link = auto（自动放行留痕），m3.link = manual（本项目唯一人工门）；
 *       reject = 重跑整个上游模块（rollbackScope = r6.links[fromModule] 的模块节点）。
 *   - 旧「gate-r1/gate-r2 挂起、send-back、force 跨阶段」的逐条映射写在各测试注释里。
 * 旧 lockBootstrapPolicy（gate_mode=manual / kit_boundary=off）对 link 门不起作用（link 只看
 * link_mode），已按处决清单去除；人工裁决点由 flow@3 的 m3.link 自身声明。
 */

const DIRECTION = "老牌发型师在连锁快剪店里坚持先洗后剪慢工出细活（e2e）";

// m1.topic-report 声明了 AE-REPORT-DENSITY（block，aesthetic.ts 有机器校验器，交卷真跑）：
// 梗/话题/对标表行 ≥8、《对标》≥2、「话题」在场、热度数据（n万）≥3 处。
const TOPIC_REPORT_BODY = `# 选题报告（e2e 夹具）

> 老牌发型师选题调研：梗密度、竞品对标与可用话题清单。

| 素材梗 | 来源 | 热度 |
| --- | --- | --- |
| 重生复仇梗 | 抖音热榜 | 120万 |
| 大龄女鹅梗 | 快手 | 98万 |
| 快剪十分钟梗 | B站 | 66万 |
| 慢工出细活梗 | 微博 | 52万 |
| 话题：手艺人的体面 | 知乎 | 43万 |
| 对标《繁花》节奏 | 剧集 | 31万 |
| 对标《我的阿勒泰》质感 | 剧集 | 27万 |
| 借鉴：单元剧结构 | 主创访谈 | 12万 |
| 话题：算法时代的手艺人 | 播客 | 11万 |
`;

/** m1（选题·线性四步）：旧「tropes∥zeitgeist 并行批」在 flow@3 已是模块内线性链——改断序关系。 */
async function submitM1(kernel: Kernel, projectId: string, pd: string): Promise<void> {
  const s1 = await kernel.flow_submit(projectId, "m1.topic-report", {
    content: artifact("topic", "m1.topic-report", TOPIC_REPORT_BODY, { projectDir: pd }),
  });
  expect(s1.status).toBe("accepted");
  const s2 = await kernel.flow_submit(projectId, "m1.find-trope", {
    content: artifact("topic", "m1.find-trope", "# 梗卡（e2e）\n\n主梗：快剪 10 分钟 vs 慢工 40 分钟。\n", { projectDir: pd }),
  });
  expect(s2.status).toBe("accepted");
  // 序关系断言（承接旧「就绪批」意图）：find-trope 交卷后，下一步派发的正是 topic-zeitgeist
  expect(s2.next?.status).toBe("awaiting_input");
  expect(s2.next?.nodeId).toBe("m1.topic-zeitgeist");
  const s3 = await kernel.flow_submit(projectId, "m1.topic-zeitgeist", {
    content: artifact("topic", "m1.topic-zeitgeist", "# 时代情绪锚\n\n算法赶人公共讨论。\n", { projectDir: pd }),
  });
  expect(s3.status).toBe("accepted");
  // 旧 gate 在节点间的「挂起」不再存在于模块内：m1 链末端直连 m2.link（auto 放行）后派发 m2 入口
  const s4 = await kernel.flow_submit(projectId, "m1.internet-feel", {
    content: artifact("topic", "m1.internet-feel", "# 网感判读\n\n前 3 秒钩：剪一次头等于做一场手术。\n", { projectDir: pd }),
  });
  expect(s4.status).toBe("accepted");
  expect(s4.next?.status).toBe("awaiting_input");
  expect(s4.next?.nodeId).toBe("m2.topic-analysis-report"); // m2.link（auto）自动放行后进 m2
}

/** m2（方案·三步）：交完 m2.topic-chief-aesthetic 后，m3.link（manual）挂起。 */
async function submitM2(kernel: Kernel, projectId: string, pd: string): Promise<void> {
  const s1 = await kernel.flow_submit(projectId, "m2.topic-analysis-report", {
    content: artifact("topic", "m2.topic-analysis-report", "# 选题分析报告\n\n## 五、创作约束移交单\n- 场景 ≤3。\n", {
      projectDir: pd,
    }),
  });
  expect(s1.status).toBe("accepted");
  const s2 = await kernel.flow_submit(projectId, "m2.topic-proposal", {
    content: artifact("topic", "m2.topic-proposal", "# 选题方案\n\n三案取一：快剪店慢手艺单线方案。\n", { projectDir: pd }),
  });
  expect(s2.status).toBe("accepted");
  const s3 = await kernel.flow_submit(projectId, "m2.topic-chief-aesthetic", {
    content: artifact("topic", "m2.topic-chief-aesthetic", "# 审美总编意见\n\n方案的可信与共鸣双轴成立。\n", { projectDir: pd }),
  });
  expect(s3.status).toBe("accepted");
  expect(s3.next?.status).toBe("suspended"); // m3.link（唯一人工门）挂起
  expect(s3.next?.nodeId).toBe("m3.link");
}

interface RunStateView {
  nodes: Record<string, { status: string; round: number; stale?: boolean }>;
  lastRejectReason?: string;
}
function readState(pd: string): RunStateView {
  return JSON.parse(fs.readFileSync(path.join(pd, "state.json"), "utf-8"));
}

describe("kernel · link 门语义（topic flow@3 @ 临时项目）", () => {
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
  });

  it("flow_run 停在首个认知步 m1.topic-report，任务包带 skill 与产物契约（K1 标尺单点装载）", async () => {
    const stop = await kernel.flow_run("topic", projectId, { route: "hot", region: "CN", direction: DIRECTION });
    expect(stop.status).toBe("awaiting_input");
    if (stop.status !== "awaiting_input") return;
    expect(stop.nodeId).toBe("m1.topic-report");
    expect(stop.taskPackage.instruction.skill).toBe("topic-report");
    expect(stop.taskPackage.outputContract.file).toBe("01-选题/选题报告.md");
    // 线性 m1：就绪批只剩单节点（旧「tropes∥zeitgeist 同批」的并行派发已随 flow@3 模块内链拆除；
    // 其意图——「无依赖才同批」——改由 submitM1 里的序关系断言承接）
    expect(stop.batch?.map((b) => b.nodeId)).toEqual(["m1.topic-report"]);
    expect(stop.taskPackage.parallelWith ?? []).toEqual([]);
    // 旧 kb-market 上下文断言 → K1 复位：market 知识由 op.knowledge 在 buildTaskPackage 单点装载，
    // 以标尺卡（pkg.knowledge）+ 指令「判定标尺」段进任务包，不再走 kb_load 产物上下文。
    const knowledge = stop.taskPackage.knowledge ?? [];
    expect(knowledge.some((k) => k.id.includes("kb/market/"))).toBe(true);
    expect(stop.taskPackage.instruction.text).toContain("判定标尺");
  });

  it("m1+m2 链路提交 → m3.link（manual）挂起（三重凭据）；m2.link 自动放行留痕", async () => {
    await submitM1(kernel, projectId, pd);
    // 上游产物上下文哈希锚定（12hex）：m2 入口任务包带最近上游交付件（context 取有产物的上游链）
    const stop = await kernel.flow_next(projectId);
    expect(stop.status).toBe("awaiting_input");
    if (stop.status !== "awaiting_input") return;
    expect(stop.nodeId).toBe("m2.topic-analysis-report");
    const ctx = stop.taskPackage.context.find((c) => c.ref === "01-选题/internet-feel.md");
    expect(ctx).toBeDefined();
    expect(ctx?.hash).toMatch(/^[0-9a-f]{12}$/);
    await submitM2(kernel, projectId, pd);
    const again = await kernel.flow_next(projectId);
    expect(again.status).toBe("suspended"); // 幂等
    if (again.status !== "suspended") return;
    expect(again.gate.nodeId).toBe("m3.link");
    expect(again.gate.token).toContain(`approval:${projectId}:`);
    // auto link（m2.link）不挂人但必须留痕：journal 里有它的 auto-pass 裁决
    const autoVerdict = kernel
      .viewJournal(projectId, {})
      .find((e) => e.nodeId === "m2.link" && (e.detail ?? "").includes("auto-pass"));
    expect(autoVerdict).toBeDefined();
  });

  it("旧轮次裁决被拒（STALE_GATE 409）", async () => {
    await expect(kernel.flow_gate(projectId, { nodeId: "m3.link", verdict: "pass", round: 9 })).rejects.toThrow(
      /轮次过期/,
    );
  });

  it("link reject 级联失效：重跑整个上游模块（m2），已验收 m1 不动，round 只增，宿主领到新任务包", async () => {
    const before = readState(pd);
    const beforeRound = before.nodes["m2.topic-analysis-report"].round;
    const r = await kernel.flow_gate(projectId, {
      nodeId: "m3.link",
      verdict: "reject",
      comment: "梗选型撞车",
    });
    expect(r.applied).toBe(true);
    // rollbackScope 恰为 m2 模块节点（r6.links[m3.link].fromModule = m2）——旧「级联回阶段入口 src」
    const expectM2 = ["m2.topic-analysis-report", "m2.topic-proposal", "m2.topic-chief-aesthetic"];
    expect(r.rollbackScope).toEqual(expectM2);
    expect(r.next?.status).toBe("awaiting_input");
    if (r.next?.status !== "awaiting_input") return;
    expect(r.next.nodeId).toBe("m2.topic-analysis-report");
    // 重派发领到的是新任务包（产物契约仍是 m2 入口步）
    expect(r.next.taskPackage.outputContract.file).toBe("02-方案/topic-analysis-report.md");
    const state = readState(pd);
    for (const id of ["m1.topic-report", "m1.find-trope", "m1.topic-zeitgeist", "m1.internet-feel"]) {
      expect(state.nodes[id].status).toBe("done"); // 「已验收=定稿」意图保留：上游模块不回滚
    }
    expect(state.nodes["m2.topic-analysis-report"].stale).toBe(true);
    expect(state.nodes["m2.topic-analysis-report"].round).toBeGreaterThan(beforeRound); // round 只增
    expect(state.lastRejectReason).toBe("梗选型撞车");
  });

  it("重走 m2 → m3.link pass → 推进到 structure-design；resume 幂等", async () => {
    await submitM2(kernel, projectId, pd);
    const r = await kernel.flow_gate(projectId, { nodeId: "m3.link", verdict: "pass", comment: "方案过" });
    expect(r.applied).toBe(true);
    expect(r.next?.status).toBe("awaiting_input");
    if (r.next?.status !== "awaiting_input") return;
    expect(r.next.nodeId).toBe("m3.structure-design");
    const resume = await kernel.flow_resume(projectId);
    expect(resume.status).toBe("awaiting_input");
    if (resume.status !== "awaiting_input") return;
    expect(resume.nodeId).toBe("m3.structure-design");
  });

  it("重做范围可控：定点 rerun 只波及本模块及下游；跨阶段强行返工走 flow_rerun（旧 force 的语义映射）", async () => {
    const st = await kernel.flow_submit(projectId, "m3.structure-design", {
      content: artifact("topic", "m3.structure-design", "# 故事框架案\n\n## 一、主矛盾\n\n行业效率 vs 手艺人体面。\n", {
        projectDir: pd,
      }),
    });
    expect(st.status).toBe("accepted");
    // 旧「structure 交卷 → gate-r2 挂起」→ flow@3 模块内无门：直接推进到下一节点
    expect(st.next?.status).toBe("awaiting_input");
    if (st.next?.status !== "awaiting_input") return;
    expect(st.next.nodeId).toBe("m3.plot-choreographer");
    // 旧「send-back 不带 force 只回本阶段」→ 新载体 = flow_rerun 从阶段入口定点重做：
    // 级联失效限于 m3..m5（本模块及下游），已验收的 m1/m2 全部保持 done（定稿语义）。
    const r = await kernel.flow_rerun(projectId, { nodeId: "m3.structure-design", dryRun: false });
    expect(r.scope).toContain("m3.structure-design");
    expect(r.scope).toContain("m5.render_html");
    expect(r.scope.some((id) => id.startsWith("m1.") || id.startsWith("m2."))).toBe(false);
    expect(r.next?.status).toBe("awaiting_input");
    if (r.next?.status !== "awaiting_input") return;
    expect(r.next.nodeId).toBe("m3.structure-design");
    const state = readState(pd);
    expect(state.nodes["m2.topic-chief-aesthetic"].status).toBe("done");
    expect(state.nodes["m1.topic-report"].status).toBe("done");
    // 再交一份结构案，回到 m3 进行中
    const st2 = await kernel.flow_submit(projectId, "m3.structure-design", {
      content: artifact("topic", "m3.structure-design", `# 故事框架案

## 一、主矛盾

效率 vs 体面。`, { projectDir: pd }),
    });
    expect(st2.status).toBe("accepted");
    // 旧「force 跨阶段回滚到 S1 入口（src）」→ doGate 的 link 分支只收 pass/reject、**不消费 force**；
    // flow@3 里「用户强行介入跨阶段返工」的合法路径是 flow_rerun 从最上游入口重做（铁律 10 口径）。
    const r2 = await kernel.flow_rerun(projectId, { nodeId: "m1.topic-report", dryRun: false });
    expect(r2.scope).toContain("m1.topic-report");
    expect(r2.scope).toContain("m3.structure-design"); // 跨阶段：m1 入口 + 全部下游
    expect(r2.next?.status).toBe("awaiting_input");
    if (r2.next?.status !== "awaiting_input") return;
    expect(r2.next.nodeId).toBe("m1.topic-report");
  });

  it("提交即注册 + 快照落档；journal 可回放", async () => {
    const arts = kernel.viewArtifacts(projectId, { node: "m2.topic-analysis-report" });
    expect(arts.length).toBeGreaterThanOrEqual(2); // reject 后重走，两轮提交
    expect(kernel.viewArtifactContent(projectId, arts[arts.length - 1].path)).toContain("选题分析报告");
    const snaps = kernel.viewSnapshots(projectId, "m2.topic-analysis-report");
    expect(snaps.length).toBeGreaterThanOrEqual(2); // 两轮提交
    const journal = kernel.viewJournal(projectId, {});
    const kinds = new Set(journal.map((e) => e.event));
    expect(kinds.has("run-start")).toBe(true);
    expect(kinds.has("verdict")).toBe(true); // link auto-pass / reject / pass 全落 verdict
    expect(kinds.has("stale")).toBe(true); // 模块驳回与 rerun 的级联失效
  });

  it("workbench-payload 与旧页面 DATA 同构", () => {
    const payload = kernel.viewWorkbenchPayload(projectId);
    expect(payload.flow).toBeTruthy();
    expect(payload.runstate).toBeTruthy();
    expect(payload.project).toBe(projectId);
    expect(payload.files["01-选题/选题报告.md"] ?? payload.files["选题素材.md"]).toBeDefined();
  });

  it("读模型不因推进动词降级（批B 处决回归：advance 只吃盘上 raw 描述符）", async () => {
    // 曾错状：各动词把 expandFlow3 派生图当 bootstrap 喂回 effectiveOf → 落 legacy 分支，
    // 覆写 effective@2：links/composition 清空、itb-* 边界门顶替 link 门、项目 overlay 被丢。
    await kernel.flow_next(projectId);
    const eff = JSON.parse(fs.readFileSync(path.join(pd, "registry", "effective.json"), "utf-8"));
    expect(eff.format).toBe("effective@2");
    expect(eff.links.map((l: { id: string }) => l.id).sort()).toEqual(["m2.link", "m3.link", "m4.link", "m5.link"]);
    expect(eff.composition.length).toBe(5); // m1..m5 五个模块实例
    const ids = Object.keys(eff.nodes);
    expect(ids.some((id) => id.startsWith("itb-"))).toBe(false);
    expect(ids).toContain("m3.link");
  });
});
