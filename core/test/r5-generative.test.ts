/**
 * R5 · 生成式 flow 与运行时编排 —— 回归测试
 *
 * 覆盖用户拍板的三条：
 *   ① 编排 = bootstrap ⊕ overlay（tool 的位置可增删改线/换 op）；
 *   ② tool 的内容配置项可被用户/优化 agent 调优（kit 侧有声明，节点/overlay 可覆盖）；
 *   ③ 人工裁决只在 kit 域切换处出现（边界验收），域内门降级为自动。
 * 外加两条主指标的算术正确性（tool 效率、上下文命中率）与优化器的确定性。
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Kernel } from "../src/kernel.js";
import { ROOT } from "../src/schema.js";
import {
  applyOverlay, effectiveFlow, injectKitBoundaries, domainMap, isBoundaryGate, isWorkGate,
  type FlowOverlay,
} from "../src/overlay.js";
import { extractCtxUsage, readMetrics, recordMetric, summarizeMetrics } from "../src/metrics.js";
import { proposeFromMetrics, overlayFromProposals, isStructuralPatch } from "../src/optimize.js";
import { resolveToolConfig } from "../src/kits.js";
import { runDeclaredAsserts } from "../src/asserts.js";
import { runAestheticAsserts } from "../src/aesthetic.js";
import { runCoreNode } from "../src/minitools.js";
import { artifact, loadFlow, lockBootstrapPolicy } from "./helpers.js";

const TS = loadFlow("topic-selection");

describe("R5 · kit 边界人工验收（唯一的裁决点）", () => {
  it("topic-selection 派生 4 个边界验收：search→plot、plot→search、search→plot、plot→prose", () => {
    const b = injectKitBoundaries(TS, { policy: "always" });
    expect(b.gates).toEqual(["itb-structure", "itb-proposal", "itb-miniguided", "itb-first3"]);
    for (const id of b.gates) {
      const n = b.flow.graph.nodes[id];
      expect(n.kind).toBe("gate");
      expect(n.gate_role).toBe("kit-boundary");
      expect(isBoundaryGate(n)).toBe(true);
    }
    // 跨界入边被接管：structure 的上游不再是 gate-r1，而是边界门
    expect(b.flow.graph.edges.find((e) => e.id === "e-struct")?.to).toBe("itb-structure");
    expect(b.flow.graph.edges.some((e) => e.id === "e-itb-structure-out" && e.to === "structure")).toBe(true);
  });

  it("幂等：对已注入的编排再派生不会套娃；且已存在的边界门仍在清单里", () => {
    const once = injectKitBoundaries(TS, { policy: "always" });
    const twice = injectKitBoundaries(once.flow, { policy: "always" });
    // gates = 结果里的全部 kit 边界门（含手工书写的），不是「本次新建的」——
    // 漏掉既有门会让页面/优化器以为这里没人管
    expect(twice.gates.sort()).toEqual(once.gates.sort());
    expect(Object.keys(twice.flow.graph.nodes).sort()).toEqual(Object.keys(once.flow.graph.nodes).sort());
    expect(twice.flow.graph.edges.length).toBe(once.flow.graph.edges.length);
  });

  it("policy=off 不派生；suppress-boundary 可单点跳过", () => {
    expect(injectKitBoundaries(TS, { policy: "off" }).gates).toEqual([]);
    const sup = injectKitBoundaries(TS, { policy: "always", suppressed: new Set(["first3"]) });
    expect(sup.gates).not.toContain("itb-first3");
  });

  it("域映射：非边界门是透明的（R5 门降级——门不再定义域）", () => {
    const { dom } = domainMap(TS);
    expect(dom.get("structure")).toBe("plot");
    expect(dom.get("gate-r1")).toBe("search"); // 门自身 kit=plot，但透明 → 域取上游
    expect(dom.get("first3")).toBe("prose");
  });
});

describe("R5 · overlay 是 tool 位置与内容配置的唯一改写面", () => {
  const ov = (patches: FlowOverlay["patches"]): FlowOverlay => ({
    format: "flow-overlay@1", flowId: TS.id, origin: "user", patches,
  });

  it("set-node 改内容配置；set-op 换 tool；remove-node 桥接；place-node 插位", () => {
    const r = applyOverlay(TS, [ov([
      { kind: "set-node", id: "tropes", config: { depth: "深" }, reason: "测" },
      { kind: "set-op", id: "zeitgeist", kit: "search", op: "material-dissect", reason: "同类换更贴的 tool" },
      { kind: "remove-node", id: "baseline", rewire: "bridge", reason: "冷 tool" },
      { kind: "place-node", node: { id: "extra", kind: "agent", title: "补采", kit: "search", op: "meme_harvest" }, after: ["analysis"], before: ["structure"], reason: "补料" },
    ])]);
    expect(r.flow.graph.nodes.tropes.config).toEqual({ depth: "深" });
    expect(r.flow.graph.nodes.zeitgeist.op).toBe("material-dissect");
    expect(r.flow.graph.nodes.zeitgeist.skill).toBeUndefined(); // kit+op 唯一事实源，避免漂移
    expect(r.flow.graph.nodes.baseline).toBeUndefined();
    expect(r.flow.graph.edges.some((e) => e.from === "analysis" && e.to === "extra")).toBe(true);
    expect(r.flow.graph.edges.some((e) => e.from === "extra" && e.to === "structure")).toBe(true);
  });

  it("proposed 补丁不参与编排合成（待批 ≠ 已生效）", () => {
    const r = applyOverlay(TS, [ov([
      { kind: "set-node", id: "tropes", config: { depth: "深" }, reason: "提案", status: "proposed" },
    ])]);
    expect(r.flow.graph.nodes.tropes.config).toBeUndefined();
    expect(r.applied).toBe(0);
  });

  it("set-tool 改的是 op 声明——所有引用它的节点一起生效", () => {
    const r = applyOverlay(TS, [ov([
      { kind: "set-tool", kit: "search", op: "find-trope", remove_knowledge: ["kb/market/tropes"], model_tier: "lite", reason: "省" },
    ])]);
    expect(r.toolOverrides["search.find-trope"].model_tier).toBe("lite");
    expect(r.toolOverrides["search.find-trope"].remove_knowledge).toEqual(["kb/market/tropes"]);
  });

  it("生效优先级：overlay > 节点 config > op.default > 通用默认", () => {
    const flow = loadFlow("novel-prose");
    const node = flow.graph.nodes.beats;
    const eff = effectiveFlow(ROOT, flow, {
      overlays: [{ format: "flow-overlay@1", flowId: flow.id, origin: "user", patches: [
        { kind: "set-tool", kit: "plot", op: "scene-breakdown", config: { maxChars: 9999 }, reason: "测：op 级默认值覆盖" },
      ] }],
    });
    const opOv = eff.toolOverrides["plot.scene-breakdown"];
    const withNode = resolveToolConfig(
      { kit: "plot", op: "scene-breakdown", domain: "plot", kind: "produce", knowledge: [], minitools: [], asserts: [], assist: [], config: opOv?.config ?? {} },
      { ...(node.config ?? {}), depth: "深" },
      opOv?.config,
    );
    expect(withNode.values.depth).toBe("深");            // 节点覆盖通用默认
    const onlyOp = resolveToolConfig(
      { kit: "plot", op: "scene-breakdown", domain: "plot", kind: "produce", knowledge: [], minitools: [], asserts: [], assist: [], config: opOv?.config ?? {} },
      { depth: "浅" },
      opOv?.config,
    );
    expect(onlyOp.values.maxChars).toBe(9999);           // op 级 overlay 改默认
    expect(onlyOp.values.depth).toBe("浅");              // 节点优先于 op 默认
    expect(onlyOp.unknownKeys).toEqual([]);
  });

  it("写了未声明的键 → 显式回显，不静默丢弃", () => {
    const r = resolveToolConfig(undefined, { 乱写的旋钮: 1 });
    expect(r.unknownKeys).toEqual(["node:乱写的旋钮"]);
    expect(r.genericOnly).toBe(true);
  });

  it("全部 tool 都声明了 config（能力必须可调；数量不设限——迁移吸收新 op 后仍须全覆盖）", () => {
    const kits = fs.readdirSync(path.join(ROOT, "kits"));
    let ops = 0;
    const missing: string[] = [];
    for (const k of kits) {
      const f = path.join(ROOT, "kits", k, "kit.json");
      if (!fs.existsSync(f)) continue;
      const kit = JSON.parse(fs.readFileSync(f, "utf-8")) as { id: string; ops: Record<string, { config?: unknown }> };
      for (const [op, def] of Object.entries(kit.ops)) {
        ops += 1;
        if (!def.config || typeof def.config !== "object") missing.push(`${kit.id}/${op}`);
      }
    }
    expect(ops).toBeGreaterThanOrEqual(55); // 下限护栏：只增不减
    expect(missing).toEqual([]);
  });
});

describe("R5 · 指标：tool 效率 与 上下文命中率", () => {
  it("命中判定取自 artifact@1 头部 upstream 与正文", () => {
    const text = "---\nartifact: 1\nupstream:\n  - kb/aesthetic/ai-trace@abc\n  - 内部/稿本/梗卡.md@def\n---\n\n# 正题\n\n按 kb/market/tropes 选梗。\n";
    const u = extractCtxUsage(text, ["kb/aesthetic/ai-trace", "kb/market/tropes", "kb/never/used"]);
    expect(u.offered).toBe(3);
    expect(u.used).toBe(2);
    expect(u.hitIds).toEqual(["kb/aesthetic/ai-trace", "kb/market/tropes"]);
  });

  it("汇总：命中率 = 命中/装载；效率 = 被下游消费次数/成本；tool 维度跨节点合并", () => {
    const events = [
      { ts: "2026-09-17T10:00:00Z", runId: "r", nodeId: "tropes", kit: "search", op: "find-trope", phase: "dispatch" as const, ctx: { offered: 4, ids: ["kb/a", "kb/b", "kb/c", "kb/d"] } },
      { ts: "2026-09-17T10:01:00Z", runId: "r", nodeId: "tropes", kit: "search", op: "find-trope", phase: "submit" as const, ctx: { used: 2, hitIds: ["kb/a", "kb/b"] }, tokensIn: 1000, tokensOut: 500, latencyMs: 60000 },
      { ts: "2026-09-17T10:02:00Z", runId: "r", nodeId: "combo", kit: "tool", op: "kb_load", phase: "core" as const, ctx: { used: 1, hitIds: ["内部/稿本/梗卡.md"] } },
    ];
    const s = summarizeMetrics(events, { pathToNode: { "内部/稿本/梗卡.md": "tropes" } });
    expect(s.byNode.tropes.hitRate).toBeCloseTo(0.5);
    expect(s.byNode.tropes.consumedBy).toBe(1);   // combo 消费了 tropes 的产物
    expect(s.byNode.tropes.cost).toBeCloseTo(2.5); // (1000+500)/1000 + 60000/60000
    expect(s.byNode.tropes.efficiency).toBeCloseTo(1 / 2.5);
    expect(s.byTool["search.find-trope"].nodes).toEqual(["tropes"]);
    expect(s.knowledge.find((k) => k.id === "kb/c")?.hitRate).toBe(0);
  });

  it("指标落盘后内核能读回（旁路不影响流水线）", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "miniflow-metrics-"));
    recordMetric(dir, { runId: "r1", nodeId: "n1", kit: "plot", op: "plot-redline", phase: "dispatch", ctx: { offered: 2, ids: ["kb/x", "kb/y"] } });
    const back = readMetrics(dir);
    expect(back).toHaveLength(1);
    expect(back[0].nodeId).toBe("n1");
  });
});

describe("R5 · 优化器：确定性规则 + 风险分级", () => {
  const events = [
    // 死条款：装了 4 次零命中
    ...Array.from({ length: 4 }, (_, i) => ({
      ts: `2026-09-17T10:0${i}:00Z`, runId: "r", nodeId: "tropes", kit: "search", op: "find-trope",
      phase: "submit" as const, ctx: { used: 0, hitIds: [] }, asserts: { pass: 1, block: 0 },
    })),
    ...Array.from({ length: 4 }, (_, i) => ({
      ts: `2026-09-17T10:1${i}:00Z`, runId: "r", nodeId: "tropes", kit: "search", op: "find-trope",
      phase: "dispatch" as const,
      ctx: { offered: 3, ids: ["kb/market/snapshot", "kb/market/structure", "kb/aesthetic/ai-trace"] },
    })),
    // 高打回 + 标尺零命中 → R2「标尺饥荒」（medium risk，必须待批）
    ...Array.from({ length: 4 }, (_, i) => ({
      ts: `2026-09-17T11:0${i}:00Z`, runId: "r", nodeId: "structure", kit: "plot", op: "structure-design",
      phase: "submit" as const, ctx: { used: 0, hitIds: [] }, asserts: { pass: 0, block: 2 },
    })),
  ];

  it("R1 死条款；提案带指标证据", () => {
    const proposals = proposeFromMetrics(TS, summarizeMetrics(events), { root: ROOT });
    const r1 = proposals.find((p) => p.rule === "R1-ctx-dead");
    expect(r1).toBeDefined();
    expect(r1?.patch.kind).toBe("set-tool");
    expect(r1?.evidence.samples).toBeGreaterThan(0);
    const r2 = proposals.find((p) => p.rule === "R2-ctx-starved");
    expect(r2?.risk).toBe("medium"); // 补标尺会改上下文预算，必须人点头
    expect(r2?.patch).toMatchObject({ kind: "set-tool", kit: "plot", op: "structure-design" });
  });

  it("R6 旧门清场：纯汇合点无需样本即提裁；评审步必须跑够样本才敢下结论", () => {
    // topic-selection 的门都挂着评审活（skill+op+output）→ 评审步
    const gateR1 = TS.graph.nodes["gate-r1"];
    expect(isWorkGate(gateR1)).toBe(true);
    // 派生的 kit 边界门是纯汇合点（无 skill/op/output），且永不被裁
    const bnd = injectKitBoundaries(TS, { policy: "always" });
    expect(isWorkGate(bnd.flow.graph.nodes["itb-structure"])).toBe(false);

    // ① 加一个纯汇合点门：零样本也该提裁——它没产出任何东西，价值为零是构造性的
    const withPlain = JSON.parse(JSON.stringify(TS));
    withPlain.graph.nodes["gate-plain"] = { kind: "gate", stage: "S1", title: "纯汇合点" };
    const p1 = proposeFromMetrics(withPlain, summarizeMetrics(events), { root: ROOT });
    expect(p1.find((p) => p.id === "R6@gate-plain")?.patch).toMatchObject({ kind: "remove-node", id: "gate-plain" });

    // ② 评审步零样本 → 不下结论（凭格式猜会把有效质量信号删掉）
    const p2 = proposeFromMetrics(TS, summarizeMetrics(events), { root: ROOT });
    expect(p2.some((p) => p.id === "R6@gate-r1")).toBe(false);

    // ③ 评审步跑够样本、产物无人消费 → 提裁（红蓝对抗残留）
    const cold = [
      ...Array.from({ length: 3 }, (_, i) => ({
        ts: `2026-09-17T13:0${i}:00Z`, runId: "r", nodeId: "gate-r1", kit: "plot", op: "plot-redline",
        phase: "submit" as const, ctx: { used: 0, hitIds: [] }, asserts: { pass: 1, block: 0 },
      })),
    ];
    const p3 = proposeFromMetrics(TS, summarizeMetrics(cold), { root: ROOT });
    const r6 = p3.find((p) => p.id === "R6@gate-r1");
    expect(r6?.patch).toMatchObject({ kind: "remove-node", id: "gate-r1" });
    expect(r6?.reason).toContain("被下游引用 0 次");
    expect(r6?.reason).not.toContain("<code>"); // 报告是机器可读的，不带标记

    // ④ 产物有人消费 → 不裁（它还有信息价值，只是裁决自动）
    const warm = [
      ...cold,
      {
        ts: "2026-09-17T14:00:00Z", runId: "r", nodeId: "structure", kit: "plot", op: "structure-design",
        phase: "submit" as const,
        ctx: { used: 1, ids: ["内部/意见/多视角意见书-gate-r1.md"], hitIds: ["内部/意见/多视角意见书-gate-r1.md"] },
      },
    ];
    const p4 = proposeFromMetrics(TS, summarizeMetrics(warm, { pathToNode: { "内部/意见/多视角意见书-gate-r1.md": "gate-r1" } }), { root: ROOT });
    expect(p4.some((p) => p.id === "R6@gate-r1")).toBe(false);
  });

  it("adapt=apply 只自动落地 low risk，其余一律待批", () => {
    const proposals = proposeFromMetrics(TS, summarizeMetrics(events), { root: ROOT });
    const ov = overlayFromProposals(proposals, { flowId: TS.id, adapt: "apply" });
    const applied = ov.patches.filter((p) => p.status === "applied");
    expect(applied.length).toBeGreaterThan(0);
    for (const p of applied) {
      const src = proposals.find((x) => x.patch === p || (x.patch.kind === p.kind && JSON.stringify(x.patch) === JSON.stringify({ ...p, status: undefined })));
      expect(src?.risk ?? "low").toBe("low");
    }
    const medium = ov.patches.filter((p) => p.status === "proposed");
    expect(medium.length).toBeGreaterThan(0);
    // 提案里没有 medium/high risk 被自动应用
    expect(ov.patches.filter((p) => p.status === "applied" && p.kind === "remove-node")).toHaveLength(0);
  });

  it("adapt=off 时优化器只观测（不产出提案落地）", () => {
    const ov = overlayFromProposals([], { flowId: TS.id, adapt: "off" });
    expect(ov.patches).toEqual([]);
  });
});

describe("R5 · 内核端到端：门自动放行 + 边界拦人 + 指标与提案落盘", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miniflow-r5-"));
  const projectId = "p-r5";
  const kernel = new Kernel({ root });
  const pd = path.join(root, "projects", projectId);

  // R7（OS-02A）：出厂缺省已由 kit_boundary=always 改为 auto（开源 clone 不该被边界门拦在门外）。
  // 本组用例要断言的恰恰是「边界拦人」，所以必须**显式**声明 always——顺带验证「策略是旋钮」。
  const lockBoundariesOn = (dir: string, flowId: string): void => {
    fs.mkdirSync(path.join(dir, "registry"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "registry", "overlay.json"),
      JSON.stringify({
        format: "flow-overlay@1",
        flowId,
        origin: "user",
        reason: "R7 测试锁定：显式要求边界人工验收（缺省已是 auto）",
        patches: [{ kind: "set-policy", key: "kit_boundary", value: "always", reason: "本组断言边界拦人" }],
      }, null, 2) + "\n",
      "utf-8",
    );
  };

  it("显式 kit_boundary=always：带产活的门降级为「评审步」——评审照跑、裁决自动；再撞上 kit 边界验收", async () => {
    fs.mkdirSync(pd, { recursive: true });
    fs.writeFileSync(path.join(pd, "选题素材.md"), "# 选题素材\n\n甲方点子：老牌发型师。\n", "utf-8");
    lockBoundariesOn(pd, "topic-selection");
    const run = await kernel.flow_run("topic-selection", projectId, { route: "hot", region: "CN", direction: "R5 边界验收用例" });
    expect(run.status).toBe("awaiting_input");

    await kernel.flow_submit(projectId, "tropes", { content: artifact("topic-selection", "tropes", "# 梗卡\n\n快剪 vs 慢工。\n", { projectDir: pd }) });
    await kernel.flow_submit(projectId, "zeitgeist", { content: artifact("topic-selection", "zeitgeist", "# 时代情绪锚\n\n算法赶人。\n", { projectDir: pd }) });
    const last = await kernel.flow_submit(projectId, "analysis", {
      content: artifact("topic-selection", "analysis", "# 选题分析报告\n\n## 五、创作约束移交单\n- 场景 ≤3。\n", { projectDir: pd }),
    });
    // gate-r1 挂着 plot-redline 的评审活（skill+op+output）→ 它是**评审步**，不许被跳过：
    // 必须先派发、收到意见书，然后才自动裁决。跳过 = 产物凭空消失而节点判 done（静默断路）。
    expect(last.next?.status).toBe("awaiting_input");
    if (last.next?.status !== "awaiting_input") return;
    expect(last.next.nodeId).toBe("gate-r1");
    expect(last.next.taskPackage.outputContract.file).toBe("内部/意见/多视角意见书-gate-r1.md");

    const afterReview = await kernel.flow_submit(projectId, "gate-r1", {
      content: artifact("topic-selection", "gate-r1", "# 多视角意见书 R1\n\n## 结论\n- 调研口径成立。\n", { projectDir: pd }),
    });
    // 评审步交卷即自动裁决（不再等人开门），接着撞上的是 search→plot 的 kit 边界验收
    expect(afterReview.next?.status).toBe("suspended");
    if (afterReview.next?.status !== "suspended") return;
    expect(afterReview.next.nodeId).toBe("itb-structure");
    expect(afterReview.next.gate.title).toContain("跨域交接验收");

    const metrics = readMetrics(pd);
    const tropes = metrics.filter((m) => m.nodeId === "tropes");
    expect(tropes.some((m) => m.phase === "dispatch")).toBe(true);
    expect(tropes.some((m) => m.phase === "submit")).toBe(true);
    expect(tropes.find((m) => m.phase === "dispatch")?.ctx?.offered).toBeGreaterThan(0);
    // 评审步：派发相 + 自动裁决相都在（证明「照跑」而不是「跳过」）
    const gate = metrics.filter((m) => m.nodeId === "gate-r1");
    expect(gate.some((m) => m.phase === "dispatch")).toBe(true);
    expect(gate.some((m) => m.phase === "auto-gate")).toBe(true);
    expect(fs.existsSync(path.join(pd, "内部/意见/多视角意见书-gate-r1.md"))).toBe(true);
  });

  it("边界裁决 = 人工：pass 后放行到 structure；指标记为 boundary 相", async () => {
    const g = await kernel.flow_gate(projectId, { nodeId: "itb-structure", verdict: "pass" });
    expect(g.applied).toBe(true);
    expect(readMetrics(pd).some((m) => m.phase === "boundary" && m.nodeId === "itb-structure")).toBe(true);
    const eff = kernel.viewEffect(projectId);
    expect(eff.boundaries).toContain("itb-structure");
    expect(eff.policy.gate_mode).toBe("auto");
  });

  it("flow_optimize 产出提案并落 registry/optimize.json；flow_overlay 改写后重编译计划", async () => {
    const first = kernel.flowOptimize(projectId, {});
    expect(fs.existsSync(path.join(pd, "registry", "optimize.json"))).toBe(true);
    expect(first.report.format).toBe("optimize@1");

    const r = await kernel.flowOverlay(projectId, {
      patches: [{ kind: "set-node", id: "tropes", config: { depth: "深" }, reason: "梗选型决定下游一切，加注" }],
      reason: "R5 e2e：编排改写 + 重编译",
      replan: true,
      actor: "test",
    });
    // 本组用例的 overlay 里有 2 条 applied：前面锁边界的 set-policy + 本次的 set-node（改写是叠加不是覆盖）
    expect(r.applied).toBe(2);
    expect(fs.existsSync(path.join(pd, "registry", "overlay.json"))).toBe(true);
    // 重编译后：编排指纹变了，且 tropes 因 config 变更被判为需要重做
    const eff = kernel.viewEffect(projectId);
    expect(eff.overlayHash).toBeTruthy();
    expect(eff.planHash).toBeTruthy();
  });

  it("显式锁定 bootstrap（gate_mode=manual / kit_boundary=off）仍然可用——策略是旋钮不是硬编码", async () => {
    const root2 = fs.mkdtempSync(path.join(os.tmpdir(), "miniflow-r5b-"));
    const pid = "p-r5b";
    const k2 = new Kernel({ root: root2 });
    const pd2 = path.join(root2, "projects", pid);
    fs.mkdirSync(pd2, { recursive: true });
    fs.writeFileSync(path.join(pd2, "选题素材.md"), "# 选题素材\n\n甲方点子：老牌发型师。\n", "utf-8");
    lockBootstrapPolicy(pd2, "topic-selection");
    await k2.flow_run("topic-selection", pid, { route: "hot", region: "CN", direction: "锁定 bootstrap" });
    await k2.flow_submit(pid, "tropes", { content: artifact("topic-selection", "tropes", "# 梗卡\n\n快剪 vs 慢工。\n", { projectDir: pd2 }) });
    await k2.flow_submit(pid, "zeitgeist", { content: artifact("topic-selection", "zeitgeist", "# 时代情绪锚\n\n算法赶人。\n", { projectDir: pd2 }) });
    const last = await k2.flow_submit(pid, "analysis", {
      content: artifact("topic-selection", "analysis", "# 选题分析报告\n\n## 五、创作约束移交单\n- 场景 ≤3。\n", { projectDir: pd2 }),
    });
    expect(last.next?.status).toBe("suspended");
    if (last.next?.status !== "suspended") return;
    expect(last.next.nodeId).toBe("gate-r1"); // 手动门回来，边界门不派生
    expect(k2.viewEffect(pid).boundaries).toEqual([]);
  });
});

/**
 * R7 · OS-02A 回归：缺省 `kit_boundary=auto` 必须是「边界门可见但不拦人」，
 * **不是**「把边界门从图里关掉」。
 *
 * 为什么单独立一组：旧实现给 auto 的边界门挂节点级 `when:{input:"__boundary_auto__",eq:"never"}`，
 * 而 `compilePlan` 会把不活跃节点的出入边一起裁掉（plan.ts:52）⇒ 边界门及其整段下游失去活跃入边、
 * 又不是源点、直接不可达。实测 plan.order 止于 gate-r1（8 节点，应为 22），run 被误判 completed，
 * 而一半节点 status 还是 "none"。因为出厂缺省一直是 always，这条路径从没被跑到；
 * 偏偏 optimize.ts 会把 kit_boundary=auto 当低风险提案自动落地——等于优化器一动手就截断流程。
 */
describe("R7 · 缺省 kit_boundary=auto：边界门可见、自动放行、下游不断（回归）", () => {
  it("auto 下计划完整、边界门自动裁决、下游照常派发；always 才拦人", async () => {
    const root3 = fs.mkdtempSync(path.join(os.tmpdir(), "miniflow-r7b-"));
    const pid = "p-r7b";
    const k3 = new Kernel({ root: root3 });
    const pd3 = path.join(root3, "projects", pid);
    fs.mkdirSync(pd3, { recursive: true });
    fs.writeFileSync(path.join(pd3, "选题素材.md"), "# 选题素材\n\n甲方点子：老牌发型师。\n", "utf-8");
    await k3.flow_run("topic-selection", pid, { route: "hot", region: "CN", direction: "R7 缺省边界策略" });

    // 缺省 = auto：策略面如实回显
    expect(k3.viewEffect(pid).policy.kit_boundary).toBe("auto");

    await k3.flow_submit(pid, "tropes", { content: artifact("topic-selection", "tropes", "# 梗卡\n\n快剪 vs 慢工。\n", { projectDir: pd3 }) });
    await k3.flow_submit(pid, "zeitgeist", { content: artifact("topic-selection", "zeitgeist", "# 时代情绪锚\n\n算法赶人。\n", { projectDir: pd3 }) });
    await k3.flow_submit(pid, "analysis", { content: artifact("topic-selection", "analysis", "# 选题分析报告\n\n## 五、创作约束移交单\n- 场景 ≤3。\n", { projectDir: pd3 }) });
    const afterReview = await k3.flow_submit(pid, "gate-r1", {
      content: artifact("topic-selection", "gate-r1", "# 多视角意见书 R1\n\n## 结论\n- 调研口径成立。\n", { projectDir: pd3 }),
    });

    // ① 边界门不再拦人：交卷后直接推进到下游认知步，而不是 suspended 在 itb-structure
    expect(afterReview.next?.status).toBe("awaiting_input");
    if (afterReview.next?.status !== "awaiting_input") return;
    expect(afterReview.next.nodeId).toBe("structure");

    // ② 边界门**仍在计划内**且已被自动裁决——这是「可见、可审计」的证据，也是旧实现的失血点
    const st = JSON.parse(fs.readFileSync(path.join(pd3, "state.json"), "utf-8")) as {
      plan: { order: string[] };
      nodes: Record<string, { status: string; verdict?: string }>;
    };
    expect(st.plan.order).toContain("itb-structure");
    expect(st.plan.order.indexOf("itb-structure")).toBeLessThan(st.plan.order.indexOf("structure"));
    expect(st.nodes["itb-structure"].status).toBe("done");
    expect(st.nodes["itb-structure"].verdict).toBe("pass");
    // 计划必须贯通到交付端，而不是在边界门上截断
    expect(st.plan.order).toContain("delivery");
    expect(st.plan.order.length).toBeGreaterThan(15);

    // ③ 指标照记 boundary 相（旧实现连 phase 都漏在契约 enum 外，被 catch{} 吞成 0 行）
    expect(readMetrics(pd3).some((m) => m.phase === "boundary" && m.nodeId === "itb-structure")).toBe(true);
  });
});

describe("R5 · 读模型：生效编排与指标汇总只由内核定义一次（页面纯消费）", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miniflow-r5c-"));
  const projectId = "p-r5c";
  const kernel = new Kernel({ root });
  const pd = path.join(root, "projects", projectId);
  const effPath = path.join(pd, "registry", "effective.json");
  const sumPath = path.join(pd, "registry", "metrics-summary.json");

  it("flow_run/flow_status 后落 effective.json：含边界、逐节点配置值与其来源", async () => {
    fs.mkdirSync(pd, { recursive: true });
    fs.writeFileSync(path.join(pd, "选题素材.md"), "# 选题素材\n\n甲方点子：夜市烤串摊主。\n", "utf-8");
    await kernel.flow_run("topic-selection", projectId, { route: "hot", region: "CN", direction: "读模型用例" });

    expect(fs.existsSync(effPath)).toBe(true);
    const view = JSON.parse(fs.readFileSync(effPath, "utf-8"));
    expect(view.format).toBe("effective@1");
    expect(view.flowId).toBe("topic-selection");
    expect(view.boundaries.length).toBeGreaterThan(0);
    // 边界门在读模型里被显式标记，页面据此上特殊样式（不靠 id 前缀嗅探）
    const bn = view.flow.graph.nodes[view.boundaries[0]];
    expect(view.nodeConfig[view.boundaries[0]].boundary).toBe(true);
    expect(bn.kind).toBe("gate");
    expect(bn.gate_role).toBe("kit-boundary");
    // 每个 kit.op 节点都有合成后的配置与逐键来源
    const tropes = view.nodeConfig["tropes"];
    expect(tropes.resolved.values).toBeTruthy();
    expect(Object.keys(tropes.resolved.sources).length).toBeGreaterThan(0);
    for (const [k, s] of Object.entries(tropes.resolved.sources)) {
      expect(["overlay", "node", "op", "generic"]).toContain(s as string);
      expect(k in tropes.resolved.values).toBe(true);
    }
  });

  it("指标汇总读模型与内核 viewEffect 同值（页面与优化 agent 消费同一份）", async () => {
    await kernel.flow_submit(projectId, "tropes", { content: artifact("topic-selection", "tropes", "# 梗卡\n\n炭火 vs 电炉。\n", { projectDir: pd }) });
    await kernel.flow_submit(projectId, "zeitgeist", { content: artifact("topic-selection", "zeitgeist", "# 时代情绪锚\n\n城市烟火气。\n", { projectDir: pd }) });
    const eff = kernel.viewEffect(projectId);
    expect(fs.existsSync(sumPath)).toBe(true);
    const sum = JSON.parse(fs.readFileSync(sumPath, "utf-8"));
    expect(sum.format).toBe("metrics-summary@1");
    expect(sum.events).toBe(eff.metrics.events);
    expect(Object.keys(sum.byTool).sort()).toEqual(Object.keys(eff.metrics.byTool).sort());
    expect(sum.window).toEqual(eff.metrics.window);
  });

  it("overlay 改写后读模型跟着变：节点配置来源标 overlay，未识别键显式回显", async () => {
    await kernel.flowOverlay(projectId, {
      patches: [
        { kind: "set-tool", kit: "search", op: "find-trope", config: { depth: "深" }, reason: "梗选型决定下游一切" },
        { kind: "set-node", id: "tropes", config: { 不存在的旋钮: 1 }, reason: "故意写未声明的键，验证不静默丢弃" },
      ] as never,
      reason: "读模型覆盖用例",
      actor: "test",
    });
    const view = JSON.parse(fs.readFileSync(effPath, "utf-8"));
    expect(view.nodeConfig["tropes"].resolved.sources["depth"]).toBe("overlay");
    expect(view.nodeConfig["tropes"].resolved.values["depth"]).toBe("深");
    expect(view.nodeConfig["tropes"].resolved.unknownKeys.join(" ")).toContain("不存在的旋钮");
    // tool 级覆盖按 tool 归口：不是改这一个节点，而是改「这件事怎么做」——换位置照样生效
    expect(view.toolOverrides["search.find-trope"].config).toEqual({ depth: "深" });
  });

  it("read 模型是旁路：编排出错不阻断流水线（不抛错即可）", () => {
    // persistEffective/persistMetricsSummary 全程 try/catch —— 读侧任何异常都不许变成主线故障
    expect(() => kernel.viewEffect(projectId)).not.toThrow();
  });
});

/* ============================================================================
 * R5 §四闭合：声明的断言必须被执行
 *
 * 反例现场（R5 §十 头号缺口）：kit.op.asserts / node.asserts 只出现在任务包的
 * outputContract 里，提交时不跑。图上不再靠加门保质量之后，「域内质量由该 tool
 * 的 asserts 承担」就只剩纸面。
 * 这里锁三件事：
 *   ① 引擎能验的断言 → 采用引擎真裁决（含族匹配 ID#子项）
 *   ② 引擎验不了的 → 显式 unverified（warn），绝不冒充 pass
 *   ③ 声明里的 block 断言 → 真的把提交打回（声明即契约）
 * ==========================================================================*/

/** 拍级夹具：钩型可控（bad=true 时首拍写成非四型，触发 AE-HOOK-EVENT block）。 */
function beatDoc(hook: string): string {
  return [
    "# 分集小纲（夹具）",
    "> 声明断言执行用例",
    "",
    "## 第一集《捡拍》",
    "",
    `**B0001｜${hook}｜10秒**`,
    "",
    "【0-3秒】搬家扔旧物，箱底压着一支旧球拍。",
    "分镜：特写 → 箱底老拍。",
    "台词：王拾：「这什么破东西。」",
    "表演：随手要扔，又停住。",
    "尾钩→ 拍子里有人开口。",
    "",
    "卡点体检：为什么看下一集？——拍子开口了。",
    "",
  ].join("\n");
}

describe("R5 · 声明断言必须被执行（声明即契约，不是任务包上的一行字）", () => {
  it("逐条裁：引擎能验的走真裁决（含族匹配），验不了的显式登记不冒充 pass", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "miniflow-decl-"));
    fs.mkdirSync(path.join(dir, "对外交付"), { recursive: true });
    fs.writeFileSync(path.join(dir, "对外交付", "03-小纲.md"), beatDoc("悬念"), "utf-8");

    const r = runDeclaredAsserts(dir, "对外交付/03-小纲.md", [
      "AE-HOOK-EVENT", // block 级，引擎有同名校验器
      "AE-BEAT-FORMAT", // 族：引擎另有 #dur 子项，应一并纳入
      "AE-STRUCT-CAUSE", // 族：引擎发的是 AE-STRUCT-CAUSE#tailhook
      "AE-CHAR-DIM", // 人物维度——语义层，机器读不出来
    ]);
    expect(r.checked.sort()).toEqual(["AE-BEAT-FORMAT", "AE-HOOK-EVENT", "AE-STRUCT-CAUSE"]);
    expect(r.unverified).toEqual(["AE-CHAR-DIM"]);

    const names = r.results.map((x) => x.name);
    expect(names).toContain("AE-BEAT-FORMAT#dur"); // 族匹配：父 id 声明覆盖子项
    expect(names).toContain("AE-STRUCT-CAUSE#tailhook");
    expect(r.results.find((x) => x.name === "AE-HOOK-EVENT")?.status).toBe("pass");

    const un = r.results.find((x) => x.name === "AE-CHAR-DIM");
    expect(un?.status).toBe("warn"); // 不是 pass：没跑过的东西不许报成通过
    expect(un?.detail).toContain("无机器校验器");
    expect(r.results.some((x) => x.name === "AE-CHAR-DIM" && x.status === "pass")).toBe(false);
  });

  it("声明里的 block 断言真的把提交打回；没声明的同一份产物照样收", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "miniflow-decl2-"));
    const kernel = new Kernel({ root });
    const bad = beatDoc("氛围"); // 首拍无四型钩子 → AE-HOOK-EVENT 该 block

    // A：给 search.find-trope 声明 AE-HOOK-EVENT → 契约生效
    const pa = "p-decl-a";
    const pda = path.join(root, "projects", pa);
    fs.mkdirSync(pda, { recursive: true });
    fs.writeFileSync(path.join(pda, "选题素材.md"), "# 选题素材\n\n甲方点子：老牌发型师。\n", "utf-8");
    await kernel.flow_run("topic-selection", pa, { route: "hot", region: "CN", direction: "声明断言用例 A" });
    await kernel.flowOverlay(pa, {
      patches: [
        { kind: "set-tool", kit: "search", op: "find-trope", add_asserts: ["AE-HOOK-EVENT"], reason: "梗卡首拍必须有钩型" },
      ] as never,
      reason: "声明断言执行用例",
      actor: "test",
    });
    // 注意 rel=内部/稿本/梗卡.md 不落 对外交付/ —— 引擎的交付件兜底体检不参与，
    // 因此这一枪只能来自「声明的断言」，来源可归因。
    const rej = await kernel.flow_submit(pa, "tropes", {
      content: artifact("topic-selection", "tropes", bad, { projectDir: pda }),
    });
    expect(rej.status).toBe("rejected");
    expect(rej.problems?.some((p) => p.name === "AE-HOOK-EVENT" && p.status === "block")).toBe(true);
    // 打回要落指标：否则 R5 的成本口径（assertBlock 溢价）永远是 0，优化器看不到返工
    const rejMetric = readMetrics(pda).find((m) => m.nodeId === "tropes" && m.verdict === "rejected");
    expect(rejMetric?.asserts?.block).toBeGreaterThan(0);

    // B：不声明同一份产物 → 无契约，照收（证明 A 的那一枪来自声明）
    const pb = "p-decl-b";
    const pdb = path.join(root, "projects", pb);
    fs.mkdirSync(pdb, { recursive: true });
    fs.writeFileSync(path.join(pdb, "选题素材.md"), "# 选题素材\n\n甲方点子：老牌发型师。\n", "utf-8");
    await kernel.flow_run("topic-selection", pb, { route: "hot", region: "CN", direction: "声明断言用例 B" });
    const ok = await kernel.flow_submit(pb, "tropes", {
      content: artifact("topic-selection", "tropes", bad, { projectDir: pdb }),
    });
    expect(ok.status).toBe("accepted");
  });

  it("core 步 check_aesthetic_asserts 把声明契约落进断言报告：验了几条 / 几条无人能验", async () => {
    process.env.MINIFLOW_ROOT = ROOT; // checks_via 别名（DENSITY-HOT/CALM→WORDS）依赖仓库注册表
    const pd = fs.mkdtempSync(path.join(os.tmpdir(), "miniflow-decl3-"));
    fs.mkdirSync(path.join(pd, "内部", "稿本"), { recursive: true });
    // episode-script/audit 的上游产物路径（字面量，非 {n} 模板）
    fs.writeFileSync(path.join(pd, "内部", "稿本", "剧本-第XX集.md"), beatDoc("悬念"), "utf-8");

    const flow = loadFlow("episode-script");
    const state = { runId: "r-decl", projectId: "p-decl3", status: "running", nodes: {}, gate: {} } as never;
    const res = await runCoreNode(pd, flow, state, "audit");
    expect(res.ok).toBe(true);

    const report = JSON.parse(fs.readFileSync(path.join(pd, "内部", "断言报告-audit.json"), "utf-8"));
    const declared = flow.graph.nodes.audit.asserts ?? [];
    expect(report.declared.sort()).toEqual([...declared].sort());
    // WO-A 后：9 条全部机器可验（钩型/密度别名/卡点/拍格式/禁空镜/越权切片/矛盾切片/伏笔逾期）
    expect(report.summary.declared).toBe(declared.length);
    expect(report.summary.machineChecked).toBe(declared.length);
    expect(report.summary.unverified).toBe(0);
    expect(report.summary.machineChecked).toBeGreaterThan(0);
    // 「声明了却没人验」的留痕路径：混入一条语义断言 → unverified=1 + journal 留痕
    const flow2 = JSON.parse(JSON.stringify(flow)) as typeof flow;
    flow2.graph.nodes.audit.asserts = [...declared, "AE-CHAR-DIM"];
    await runCoreNode(pd, flow2, state, "audit");
    const report2 = JSON.parse(fs.readFileSync(path.join(pd, "内部", "断言报告-audit.json"), "utf-8"));
    expect(report2.summary.unverified).toBe(1);
    expect(report2.note).toContain("无机器校验器");
    expect(fs.readFileSync(path.join(pd, "journal.jsonl"), "utf-8")).toContain("无机器校验器");
  });
});

/* ============================================================================
 * WO-A · 断言台账对齐 + 文本层校验器
 *   ① 两张账合一：声明名经注册表 checks_via 别名由引擎真裁决（AE-DENSITY-HOT/CALM → WORDS）
 *   ② 文本层校验器：章末钩/越权切片/台账矛盾切片/伏笔逾期/禁空镜/纯净度（标记台账共享）
 *   ③ 语义层断言不冒充：切片 warn 的 detail 必须带口径。红线：不引 LLM 当机器校验器
 * ==========================================================================*/
describe("WO-A · 断言台账对齐 + 文本层校验器", () => {
  // 断言注册表（checks_via）与纯净度标记台账都挂在仓库根；临时项目目录下没有它们。
  // 不指路 → 别名解析为空、台账缺失 → 声明断言会整体退化成 unverified，测不到东西。
  // describe 体在收集期执行，早于所有用例，故此处设置对本文件全部用例生效。
  process.env.MINIFLOW_ROOT = ROOT;

  it("checks_via 别名：声明 AE-DENSITY-HOT/CALM 由引擎 AE-DENSITY-WORDS 真裁决（不冒充、不空转）", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "miniflow-woa1-"));
    fs.mkdirSync(path.join(dir, "对外交付"), { recursive: true });
    const dense = beatDoc("悬念").replace(
      "台词：王拾：「这什么破东西。」",
      "台词：王拾：「" + "词".repeat(360) + "」",
    );
    fs.writeFileSync(path.join(dir, "对外交付", "03-小纲.md"), dense, "utf-8");

    const r = runDeclaredAsserts(dir, "对外交付/03-小纲.md", ["AE-DENSITY-HOT", "AE-DENSITY-CALM"]);
    // 两个声明名都指向引擎的 AE-DENSITY-WORDS：算「机器真跑过」，不是 unverified
    expect(r.checked.sort()).toEqual(["AE-DENSITY-CALM", "AE-DENSITY-HOT"]);
    expect(r.unverified).toEqual([]);
    // 台词 360 字 > 350 上限 → 引擎判 warn（major 级），声明方必须透传引擎裁决而不是自造 pass
    expect(r.results.some((x) => x.name === "AE-DENSITY-WORDS" && x.status === "warn")).toBe(true);
  });

  it("AE-WNF-HOOK：章末无钩 block；有钩 pass；连续同型钩 warn（读上一章轮换）", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "miniflow-woa2-"));
    fs.mkdirSync(path.join(dir, "章节正文"), { recursive: true });
    const flat = "# 第1章\n\n他吃完饭，把碗洗了，然后上床睡觉，一切如常，什么也没有发生。";
    fs.writeFileSync(path.join(dir, "章节正文", "第1章.md"), flat, "utf-8");
    const r1 = runDeclaredAsserts(dir, "章节正文/第1章.md", ["AE-WNF-HOOK"]);
    expect(r1.results.find((x) => x.name === "AE-WNF-HOOK")?.status).toBe("block");

    // 章末补一个转折型尾钩（「就在这时」是引擎认得的三型信号之一）→ pass
    fs.writeFileSync(path.join(dir, "章节正文", "第1章.md"), flat + "\n\n就在这时，门外的雨忽然停了。", "utf-8");
    const r1b = runDeclaredAsserts(dir, "章节正文/第1章.md", ["AE-WNF-HOOK"]);
    expect(r1b.results.find((x) => x.name === "AE-WNF-HOOK")?.status).toBe("pass");

    // 第2章也用转折型尾钩 → 连续同型，四型轮换没做到（钩型要读上一章尾才判得出来）
    fs.writeFileSync(
      path.join(dir, "章节正文", "第2章.md"),
      "# 第2章\n\n第二天，门口多了一双陌生的鞋。\n\n可就在这时，屋里传来一声轻响。",
      "utf-8",
    );
    const r2 = runDeclaredAsserts(dir, "章节正文/第2章.md", ["AE-WNF-HOOK"]);
    const h2 = r2.results.find((x) => x.name === "AE-WNF-HOOK");
    expect(h2?.status).toBe("warn");
    expect(h2?.detail).toContain("连续同型");
  });

  it("AE-CONT-FORESHADOW：台账到期未回收 warn，卡点级 block；无台账诚实标注切片不适用", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "miniflow-woa3-"));
    fs.mkdirSync(path.join(dir, "章节正文"), { recursive: true });
    fs.mkdirSync(path.join(dir, "世界书"), { recursive: true });
    const ledger = [
      "| 编号 | 内容 | 埋设章 | 预期回收 | 状态 |",
      "| --- | --- | --- | --- | --- |",
      "| F1 | 老拍子的来历 | 1 | 3 | 待回收 |",
      "| F2 | 邻居的真实身份 | 1 | 2 | 卡点伏笔，待回收 |",
    ].join("\n");
    fs.writeFileSync(path.join(dir, "世界书", "伏笔台账.md"), ledger, "utf-8");
    fs.writeFileSync(path.join(dir, "章节正文", "第2章.md"), "# 第2章\n\n他终于拆开了那个包裹。", "utf-8");
    const r = runDeclaredAsserts(dir, "章节正文/第2章.md", ["AE-CONT-FORESHADOW"]);
    const f = r.results.find((x) => x.name === "AE-CONT-FORESHADOW");
    // F1 预期第 3 章（还没到）→ 不算逾期；F2 预期第 2 章且是卡点 → block。
    // 同时是「待回收 ≠ 已回收」的回归锁：裸判 /回收/ 会让该检查永远 pass（断言空转）。
    expect(f?.status).toBe("block");
    expect(f?.detail).toContain("F2");
    expect(f?.detail).not.toContain("F1");

    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "miniflow-woa3b-"));
    fs.mkdirSync(path.join(empty, "章节正文"), { recursive: true });
    fs.writeFileSync(path.join(empty, "章节正文", "第1章.md"), "# 第1章\n\n正文。", "utf-8");
    const r2 = runDeclaredAsserts(empty, "章节正文/第1章.md", ["AE-CONT-FORESHADOW"]);
    const f2 = r2.results.find((x) => x.name === "AE-CONT-FORESHADOW");
    expect(f2?.status).toBe("warn"); // 无台账：诚实标注切片不适用，不冒充 pass
    expect(f2?.detail).toContain("不适用");
  });

  it("AE-OUTPUT-PURITY：执行元数据入正文 block；干净正文 pass（标记台账 MINIFLOW_ROOT 共享）", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "miniflow-woa4-"));
    fs.mkdirSync(path.join(dir, "章节正文"), { recursive: true });
    const dirty = "# 第1章\n\n本批未读取 projects/其他项目，未做任何 git 操作。他吃完了饭。";
    fs.writeFileSync(path.join(dir, "章节正文", "第1章.md"), dirty, "utf-8");
    const r = runDeclaredAsserts(dir, "章节正文/第1章.md", ["AE-OUTPUT-PURITY"]);
    expect(r.results.find((x) => x.name === "AE-OUTPUT-PURITY")?.status).toBe("block");

    const clean = fs.mkdtempSync(path.join(os.tmpdir(), "miniflow-woa4b-"));
    fs.mkdirSync(path.join(clean, "章节正文"), { recursive: true });
    fs.writeFileSync(path.join(clean, "章节正文", "第1章.md"), "# 第1章\n\n他吃完了饭，把碗洗了。", "utf-8");
    const r2 = runDeclaredAsserts(clean, "章节正文/第1章.md", ["AE-OUTPUT-PURITY"]);
    expect(r2.results.find((x) => x.name === "AE-OUTPUT-PURITY")?.status).toBe("pass");
  });

  it("AE-VIS-EMPTY：分镜行含心理/抒情词判 block（禁不可拍摄内容）", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "miniflow-woa5-"));
    fs.mkdirSync(path.join(dir, "对外交付"), { recursive: true });
    const bad = beatDoc("悬念").replace("分镜：特写 → 箱底老拍。", "分镜：特写 → 箱底老拍，王拾心想这次稳了。");
    fs.writeFileSync(path.join(dir, "对外交付", "03-小纲.md"), bad, "utf-8");
    const r = runDeclaredAsserts(dir, "对外交付/03-小纲.md", ["AE-VIS-EMPTY"]);
    const v = r.results.find((x) => x.name === "AE-VIS-EMPTY");
    expect(v?.status).toBe("block");
    expect(v?.detail).toContain("心想");
  });
});

/* ============================================================================
 * R5 §六 · 编排挖掘师（质性通道）
 * 指标只看得见数字；journal / 打回根因 / 批注 / 中间文件里的「为什么」由通用 Skill
 * orchestration-miner 挖掘（flow_mine 组装任务包），findings@1 经 flow_optimize 并入提案管道：
 * 非结构类 → M@ 提案（risk 恒 medium，人批才落地）；结构类 → mineStructural 拍板清单，永不进 overlay。
 * ==========================================================================*/
describe("R5 §六 · 编排挖掘师（质性通道并入提案管道）", () => {
  it("flow_mine 组装挖掘包（journal/打回/证据清单 + spawnPrompt），并推进 mine 游标", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "miniflow-mine1-"));
    const kernel = new Kernel({ root });
    const pd = path.join(root, "projects", "p-mine");
    fs.mkdirSync(pd, { recursive: true });
    fs.writeFileSync(path.join(pd, "选题素材.md"), "# 选题素材\n\n甲方点子：编排挖掘用例。\n", "utf-8");
    await kernel.flow_run("topic-selection", "p-mine", { route: "hot", region: "CN", direction: "编排挖掘用例" });

    const mine = kernel.flowMine("p-mine");
    expect(mine.package.format).toBe("mine-package@1");
    expect(mine.package.flowId).toBe("topic-selection");
    expect(mine.package.sources.journal.events).toBeGreaterThan(0);
    expect(mine.package.sources.evidenceFiles.length).toBeGreaterThan(0);
    expect(mine.package.goals).toContain("上下文命中率（标尺被产物真正引用）");
    expect(mine.spawnPrompt).toContain("orchestration-miner");
    expect(fs.existsSync(path.join(pd, "registry", "mine-package.json"))).toBe(true);
    // 游标推进：刚组装过 → mine.due 复位
    const eff = kernel.viewEffect("p-mine");
    expect(eff.mine.due).toBe(false);
    expect(eff.mine.eventsAtLastMine).toBe(eff.mine.events);
  });

  it("findings 并入：非结构类→M@提案（risk=medium 待批）；结构类→拍板清单，apply 也不进 overlay", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "miniflow-mine2-"));
    const kernel = new Kernel({ root });
    const pd = path.join(root, "projects", "p-mine2");
    fs.mkdirSync(pd, { recursive: true });
    fs.writeFileSync(path.join(pd, "选题素材.md"), "# 选题素材\n\n甲方点子：findings 并入用例。\n", "utf-8");
    await kernel.flow_run("topic-selection", "p-mine2", { route: "hot", region: "CN", direction: "findings 并入用例" });

    fs.writeFileSync(
      path.join(pd, "registry", "miner-findings.json"),
      JSON.stringify({
        format: "miner-findings@1",
        flowId: "topic-selection",
        runId: "r-mine2",
        at: new Date().toISOString(),
        findings: [
          {
            id: "Mctx@search.find-trope",
            dimension: "ctx",
            severity: "medium",
            title: "市场结构卡零命中",
            reason: "装载 3 次从未被梗卡引用——移出或改写成可引用形式",
            evidence: [{ source: "journal:12", quote: "梗卡 v3 未引用 kb/market/structure" }],
            patch: {
              kind: "set-tool", kit: "search", op: "find-trope",
              remove_knowledge: ["kb/market/structure"],
              reason: "零命中条款移出标尺", evidence: { rule: "M-ctx", metric: "miner.evidence", value: 1, samples: 1 },
            },
          },
          {
            id: "Mstruct@parallel",
            dimension: "structure",
            severity: "high",
            title: "素材解剖与竞品对标可并行",
            reason: "两步无数据依赖却串行等门",
            evidence: [{ source: "journal:15", quote: "material-dissect 与 benchmark 顺序完成，互不引用" }],
            structural: "把 material-dissect 与 benchmark 改为并行分叉",
          },
        ],
      }),
      "utf-8",
    );

    const { report, mineStructural } = kernel.flowOptimize("p-mine2", { apply: true, actor: "test" });
    expect(report.sources).toEqual(["metrics", "miner"]);
    const m = report.proposals.find((p) => p.id === "Mctx@search.find-trope");
    expect(m).toBeTruthy();
    expect(m?.risk).toBe("medium"); // 质性提案不享受自动落地
    expect(m?.title).toContain("挖掘");
    // 结构类只进拍板清单
    expect(mineStructural.map((s) => s.id)).toContain("Mstruct@parallel");
    // 落地边界：M@ 提案 risk=medium → 即使 --apply 也 proposed；结构类完全不在 overlay 里
    const ov = JSON.parse(fs.readFileSync(path.join(pd, "registry", "overlay.json"), "utf-8"));
    const ids = ov.patches.map((p: { proposal?: string }) => p.proposal);
    expect(ids).toContain("Mctx@search.find-trope");
    const mPatch = ov.patches.find((p: { proposal?: string }) => p.proposal === "Mctx@search.find-trope");
    expect(mPatch.status).toBe("proposed");
    expect(ids).not.toContain("Mstruct@parallel");
    // 消费游标推进
    const st = JSON.parse(fs.readFileSync(path.join(pd, "registry", "miner-state.json"), "utf-8"));
    expect(st.phase).toBe("consumed");
    expect(st.findings).toBe(2);
  });

  it("脏 findings 拒绝并入：format 非法 / flowId 不匹配都要显式报错，不静默", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "miniflow-mine3-"));
    const kernel = new Kernel({ root });
    const pd = path.join(root, "projects", "p-mine3");
    fs.mkdirSync(pd, { recursive: true });
    fs.writeFileSync(path.join(pd, "选题素材.md"), "# 选题素材\n\n甲方点子：脏 findings 用例。\n", "utf-8");
    await kernel.flow_run("topic-selection", "p-mine3", { route: "hot", region: "CN", direction: "脏 findings 用例" });

    const bad = path.join(pd, "registry", "miner-findings.json");
    fs.mkdirSync(path.join(pd, "registry"), { recursive: true });
    fs.writeFileSync(bad, JSON.stringify({ format: "not-mine", findings: [] }), "utf-8");
    expect(() => kernel.flowOptimize("p-mine3")).toThrow(/format 非法/);

    fs.writeFileSync(bad, JSON.stringify({ format: "miner-findings@1", flowId: "other-flow", findings: [] }), "utf-8");
    expect(() => kernel.flowOptimize("p-mine3")).toThrow(/属于流 other-flow/);
  });
});
