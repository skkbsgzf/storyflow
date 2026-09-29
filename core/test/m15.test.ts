import { describe, expect, it, beforeAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Kernel } from "../src/kernel.js";
import { checkGlossary } from "../src/asserts.js";
import { ROOT } from "../src/schema.js";
import { artifact } from "./helpers.js";

/**
 * M1.5 三组机制在 flow@3（topic-selection v6.0.0 模块序列）下的落点：
 *   - 角色剖面：旧 tropes/structure 节点 → m1.find-trope / m3.structure-design（剖面按 skill 反查，未变）；
 *   - 旧 gate-r1 挂起 → m3.link（m1+m2 全部交卷后的唯一人工连接件门，manual）；
 *   - rerun 缓存：topic-selection 派生图的两个 core 步（m5.export-doc 脚本壳 / m5.render_html 机器件）
 *     注册产物 inputs 恒为 `{}`（minitools.ts 对应分支），永远进不了 cacheCandidates（该面只认
 *     check_* 报告的输入指纹）——真实流上无可断言落点，机制改由合成小流断干净（仿 r7-runtime 的
 *     writeFlow 模式：a 创意步 → det check core 步，det 报告带上游指纹）。
 * 旧 lockBootstrapPolicy（gate_mode/kit_boundary）对 flow@3 的 link 门不起作用（link 只看 link_mode），
 * 已去除；人工裁决点由 m3.link 的声明自身承担。
 */

const DIRECTION = "老牌发型师在连锁快剪店里坚持先洗后剪慢工出细活（m1.5）";

// m1.topic-report 带 AE-REPORT-DENSITY（block）机器校验：梗/话题行 ≥8、对标《》≥2、热度（n万）≥3。
const TOPIC_REPORT_BODY = `# 选题报告（m1.5 夹具）

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

/** 交完 m1 余三步 + m2 三步 → m3.link（manual，原 gate-r1 的映射落点）挂起。 */
async function walkToM3Link(kernel: Kernel, projectId: string, pd: string, tropeContent: string): Promise<void> {
  const a = await kernel.flow_submit(projectId, "m1.find-trope", {
    content: artifact("topic-selection", "m1.find-trope", tropeContent, { projectDir: pd }),
  });
  expect(a.status).toBe("accepted");
  const b = await kernel.flow_submit(projectId, "m1.topic-zeitgeist", {
    content: artifact("topic-selection", "m1.topic-zeitgeist", "# 时代情绪锚\n\n算法赶人。\n", { projectDir: pd }),
  });
  expect(b.status).toBe("accepted");
  const c = await kernel.flow_submit(projectId, "m1.internet-feel", {
    content: artifact("topic-selection", "m1.internet-feel", "# 网感判读\n\n前 3 秒钩：剪一次头等于做一场手术。\n", {
      projectDir: pd,
    }),
  });
  expect(c.status).toBe("accepted");
  const d = await kernel.flow_submit(projectId, "m2.topic-analysis-report", {
    content: artifact("topic-selection", "m2.topic-analysis-report", "# 选题分析报告\n\n## 五、创作约束移交单\n- 场景 ≤3。\n", {
      projectDir: pd,
    }),
  });
  expect(d.status).toBe("accepted");
  const e = await kernel.flow_submit(projectId, "m2.topic-proposal", {
    content: artifact("topic-selection", "m2.topic-proposal", "# 选题方案\n\n三案取一：快剪店慢手艺单线方案。\n", { projectDir: pd }),
  });
  expect(e.status).toBe("accepted");
  const f = await kernel.flow_submit(projectId, "m2.topic-chief-aesthetic", {
    content: artifact("topic-selection", "m2.topic-chief-aesthetic", "# 审美总编意见\n\n方案的可信与共鸣双轴成立。\n", {
      projectDir: pd,
    }),
  });
  expect(f.status).toBe("accepted");
  expect(f.next?.status).toBe("suspended"); // m3.link 挂起
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
    const stop = await kernel.flow_run("topic-selection", projectId, { route: "hot", region: "CN", direction: DIRECTION });
    expect(stop.status).toBe("awaiting_input");
  });

  it("任务包携带角色剖面（m1.find-trope → story-analyst）", async () => {
    // 先交 m1 首步（topic-report 无技能剖面映射，落角色族缺省），领到 find-trope 的任务包
    const s = await kernel.flow_submit(projectId, "m1.topic-report", {
      content: artifact("topic-selection", "m1.topic-report", TOPIC_REPORT_BODY, { projectDir: pd }),
    });
    expect(s.status).toBe("accepted");
    const stop = await kernel.flow_next(projectId);
    expect(stop.status).toBe("awaiting_input");
    if (stop.status !== "awaiting_input") return;
    expect(stop.nodeId).toBe("m1.find-trope");
    expect(stop.taskPackage.profile?.id).toBe("story-analyst");
    expect(stop.taskPackage.profile?.role).toBe("analyst");
  });

  it("结构步剖面为编排师；m3.link 放行后 structure-design 领到 choreographer", async () => {
    await walkToM3Link(kernel, projectId, pd, "# 梗卡\n\n快剪 vs 慢工。\n");
    const r = await kernel.flow_gate(projectId, { nodeId: "m3.link", verdict: "pass" });
    expect(r.next?.status).toBe("awaiting_input");
    if (r.next?.status !== "awaiting_input") return;
    expect(r.next.nodeId).toBe("m3.structure-design");
    expect(r.next.taskPackage.profile?.role).toBe("choreographer");
  });

  // ---------- rerun 缓存机制（合成小流：a 创意步 → det check core 步） ----------

  const SFLOW = "m15-rerun-cache";
  const spid = "p-rerun-cache";
  let sk: Kernel;
  let spd: string;

  /** 合成流：agent 创意步 → check_* core 确定性步（报告带上游输入指纹，缓存判定的唯一依据）。 */
  function writeFlow(dataRoot: string): void {
    const dir = path.join(dataRoot, "flows", SFLOW);
    fs.mkdirSync(dir, { recursive: true });
    const flow = {
      format: "flow@2",
      id: SFLOW,
      title: "M1.5 rerun 缓存机制最小流",
      version: "1.0.0",
      status: "active",
      policy: {},
      inputs: {},
      outputs: [],
      graph: {
        format: "flow-graph@1",
        name: SFLOW,
        nodes: {
          a: { kind: "agent", stage: "S1", title: "创意步", skill: "find-trope", kit: "search", op: "find-trope", output: "内部/稿本/a.md" },
          det: { kind: "core", stage: "S1", title: "确定性校验步", minitool: "check_integrity", output: "内部/断言报告-det.json" },
        },
        edges: [{ id: "e-a-det", from: "a", to: "det", role: "flow" }],
        outputs: [],
      },
    };
    fs.writeFileSync(path.join(dir, "flow.json"), JSON.stringify(flow, null, 2) + "\n", "utf-8");
  }

  /** 头部合规的产物夹具（flow@2 合成流落 内部/稿本/，头部断言生效，round 从 state 现推）。 */
  function sArt(nodeId: string, round: number): string {
    return [
      "---",
      "artifact: 1",
      "id: search.find-trope",
      "class: draft",
      `node: ${nodeId}`,
      `round: ${round}`,
      `version: v${round}`,
      "state: draft",
      "at: 2026-09-21 10:00",
      "by: kit/search.find-trope",
      "upstream: []",
      "review: null",
      "---",
      "",
      `# ${nodeId}`,
      "> rerun 缓存机制夹具",
      "",
      "主梗：快剪 vs 慢工（两次提交逐字节一致）。",
      "",
    ].join("\n");
  }

  function sState(): { nodes: Record<string, { status: string; round: number }> } {
    return JSON.parse(fs.readFileSync(path.join(spd, "state.json"), "utf-8"));
  }

  it("rerun dryRun 预览缓存候选（det 报告指纹未变）", async () => {
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "miniflow-m15-cache-"));
    writeFlow(dataRoot);
    spd = path.join(dataRoot, "projects", spid);
    fs.mkdirSync(spd, { recursive: true });
    // flowsDir 指临时根（合成流），repoRoot 仍是真仓库（modules/knowledge/agents 装载不降级）
    sk = new Kernel({ root: dataRoot, flowsDir: path.join(dataRoot, "flows") });
    const run = await sk.flow_run(SFLOW, spid, {});
    expect(run.status).toBe("awaiting_input");
    if (run.status !== "awaiting_input") return;
    expect(run.nodeId).toBe("a");
    const s = await sk.flow_submit(spid, "a", { content: sArt("a", (sState().nodes.a.round ?? 0) + 1) });
    expect(s.status).toBe("accepted");
    expect(s.next?.status).toBe("completed"); // det（check core 步）已首跑并登记输入指纹
    const r = await sk.flow_rerun(spid, { nodeId: "a", dryRun: true });
    expect(r.scope).toEqual(["a", "det"]);
    expect(r.cacheCandidates).toEqual(["det"]); // 确定性步且指纹未变 = 缓存候选；创意步 a 永远真重做
  });

  it("真跑 rerun：确定性 det 步缓存命中，创意步照常重做", async () => {
    const rr = await sk.flow_rerun(spid, { nodeId: "a", dryRun: false });
    expect(rr.next?.status).toBe("awaiting_input");
    if (rr.next?.status !== "awaiting_input") return;
    expect(rr.next.nodeId).toBe("a"); // 创意步重新派发（重做本身就是目的）
    const aRoundBefore = sState().nodes.a.round;
    // 重提交【完全相同】的内容 → det 的输入指纹未变 → advance 走缓存命中分支，不重算
    const a = await sk.flow_submit(spid, "a", { content: sArt("a", aRoundBefore + 1) });
    expect(a.status).toBe("accepted");
    expect(a.next?.status).toBe("completed");
    const journal = sk.viewJournal(spid, {});
    const hit = journal.find((e) => (e.detail ?? "").includes("缓存命中") && e.nodeId === "det");
    expect(hit).toBeDefined();
    const st = sState();
    expect(st.nodes.a.round).toBeGreaterThan(aRoundBefore); // round 只增：创意步确认真重做过
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
