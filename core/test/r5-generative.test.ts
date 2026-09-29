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
import { applyOverlay, effectiveFlow, domainMap, isWorkGate, type FlowOverlay } from "../src/overlay.js";
import { expandFlow3, effectiveFlow3 } from "../src/modules.js";
import { extractCtxUsage, readMetrics, recordMetric, summarizeMetrics } from "../src/metrics.js";
import { proposeFromMetrics, overlayFromProposals } from "../src/optimize.js";
import { resolveToolConfig } from "../src/kits.js";
import { runAestheticAsserts } from "../src/aesthetic.js";
import { runCoreNode } from "../src/minitools.js";
import { artifact, expandedFlow, loadFlow } from "./helpers.js";

// flow@3 不手画 graph——边界裁决由 expandFlow3 派生的「连接件」（kind=gate / gate_role=link）承担。
// 需要图形态描述符的用例一律走展开单点，拿到与内核 effectiveOf 同源的派生图。
const TS = expandedFlow("topic");

// 过 m1「选题报告」AE-REPORT-DENSITY（block）的最小合规正文，供内核端到端各组复用：
// 梗/话题/对标行 ≥8、竞品引用 ≥2、含「话题」、热度数据（n/万）≥3。
const REPORT = [
  "可用话题：",
  "| 梗 | 话题 | 借鉴 | 热度（万） |",
  "| --- | --- | --- | --- |",
  "| 快剪梗 | 慢工话题 | 借鉴《活着》 | 120 |",
  "| 逆袭梗 | 职场话题 | 借鉴《平凡的世界》 | 130 |",
  "| 复仇梗 | 家庭话题 | 借鉴素材 | 140 |",
  "| 甜宠梗 | 恋爱话题 | 借鉴对标 | 150 |",
  "| 悬疑梗 | 推理话题 | 借鉴 | 160 |",
  "| 喜剧梗 | 日常话题 | 借鉴 | 170 |",
  "| 穿越梗 | 时空话题 | 借鉴 | 180 |",
  "| 系统梗 | 游戏话题 | 借鉴 | 190 |",
  "竞品《活着》《平凡的世界》 120万 130万 140万。",
].join("\n");

// flow@3 的边界裁决面 = 模块间「连接件」（expandFlow3 规则 6 派生：kind=gate / gate_role=link）。
// 老 flow@2 的 injectKitBoundaries 派生 itb-* 已被 links 取代（内核 effectiveOf flow@3 分支 boundaries:[]）。
// 故本组改断内核实际派生的 links。
const TS3 = loadFlow("topic");
const DERIVED = expandFlow3(ROOT, TS3 as never);

/** 从派生图里挑出全部连接件门（gate_role=link）。 */
function linkGates(flow: typeof TS): string[] {
  return Object.entries(flow.graph.nodes)
    .filter(([, n]) => n.kind === "gate" && n.gate_role === "link")
    .map(([id]) => id);
}

describe("R5 · kit 边界人工验收（唯一的裁决点 = flow@3 连接件）", () => {
  it("topic 派生 4 个连接件：m1→m2、m2→m3、m3→m4、m4→m5；其中 m2→m3（plot 前）为人工验收", () => {
    expect(DERIVED.links.map((l) => l.id)).toEqual(["m2.link", "m3.link", "m4.link", "m5.link"]);
    // 逐模块交界：跨域交接处一个连接件，且裁决模式即「人工 vs 自动」的开关
    expect(DERIVED.links.find((l) => l.id === "m3.link")?.mode).toBe("manual");
    for (const id of linkGates(TS)) {
      const n = TS.graph.nodes[id];
      expect(n.kind).toBe("gate");
      expect(n.gate_role).toBe("link");
    }
    // 跨界入边被连接件接管：m1 末节点不再直接指进 m2，而是先过 m2.link
    expect(TS.graph.edges.find((e) => e.to === "m2.topic-analysis-report")?.from).toBe("m2.link");
    expect(TS.graph.edges.some((e) => e.from === "m1.internet-feel" && e.to === "m2.link")).toBe(true);
  });

  it("幂等：派生是纯函数，再展开一次节点/连接件/边集合完全一致（不套娃、不漂移）", () => {
    const twice = expandFlow3(ROOT, TS3 as never);
    expect(twice.links).toEqual(DERIVED.links);
    expect(Object.keys(twice.flow.graph.nodes).sort()).toEqual(Object.keys(DERIVED.flow.graph.nodes).sort());
    expect(twice.flow.graph.edges.length).toBe(DERIVED.flow.graph.edges.length);
    // 连接件永驻清单：4 个交界门都在派生图里（页面/优化器都据这份清单，不是「本次新建的」子集）
    expect(linkGates(TS).sort()).toEqual(["m2.link", "m3.link", "m4.link", "m5.link"]);
  });

  it("link_default 是全局旋钮；set-link 单点覆盖优先（旧 policy=off / suppress-boundary 的 flow@3 表达）", () => {
    // 缺省：m3 声明 manual，其余继承 defaults.link=auto
    expect(DERIVED.links.map((l) => `${l.id}:${l.mode}`).join(",")).toBe(
      "m2.link:auto,m3.link:manual,m4.link:auto,m5.link:auto",
    );
    // 优先级 inst.link > defaults.link > policy.link_default：本流声明了 defaults.link=auto，
    // 故 link_default=manual 被 defaults 遮蔽（只作最末兜底），m3 的 inst.link=manual 仍胜出。
    const manualDefault = effectiveFlow3(ROOT, TS3 as never, {
      overlays: [{ format: "flow-overlay@1", flowId: "topic", origin: "user", patches: [
        { kind: "set-policy", key: "link_default", value: "manual", reason: "全交界转人工（本流被 defaults.link 遮蔽）" },
      ] }],
    });
    expect(manualDefault.links.map((l) => `${l.id}:${l.mode}`).join(",")).toBe(
      "m2.link:auto,m3.link:manual,m4.link:auto,m5.link:auto",
    );
    // set-link 单点把 m3 降回 auto（等价旧 suppress-boundary：这一处交界不再拦人）
    const one = effectiveFlow3(ROOT, TS3 as never, {
      overlays: [{ format: "flow-overlay@1", flowId: "topic", origin: "user", patches: [
        { kind: "set-link", link: "m3.link", mode: "auto", reason: "单点放行" },
      ] }],
    });
    expect(one.links.find((l) => l.id === "m3.link")?.mode).toBe("auto");
    expect(one.links.find((l) => l.id === "m2.link")?.mode).toBe("auto"); // 其余不受牵连
  });

  it("域映射：连接件是透明的（它不再定义域，域取上游执行步）", () => {
    const { dom } = domainMap(TS);
    expect(dom.get("m1.find-trope")).toBe("topic");
    expect(dom.get("m2.link")).toBe("topic");            // 连接件本身无 kit → 取上游 m1 域
    expect(dom.get("m3.structure-design")).toBe("plot");  // plot 模块入口
    expect(dom.get("m4.ghostwrite")).toBe("prose");
  });
});

describe("R5 · overlay 是 tool 位置与内容配置的唯一改写面", () => {
  // applyOverlay 是纯函数（对任意带 .graph 的描述符生效），与 flow@2/@3 无关。
  // 位置改写（set-node/set-op/remove-node/place-node）是这套补丁语义本身的机制测试，
  // 真实的 topic 已是 flow@3（节点带命名空间前缀、config 由 op 预填），拿它当锚点
  // 会把「补丁语义」和「flow@3 派生」两件事混在一起测。故按 r7-runtime.test.ts 的做法，
  // 合成一条干净的小 bootstrap 图，隔离被测面 = applyOverlay 的位置/内容改写语义。
  const SYN = () => ({
    format: "flow@2" as const, id: "ov-syn", title: "overlay 位置改写夹具", version: "1.0.0", status: "active" as const,
    inputs: {}, outputs: [],
    graph: {
      nodes: {
        analysis: { kind: "agent" as const, stage: "S1", title: "分析", kit: "search", op: "topic-analysis-report", output: "内部/稿本/analysis.md" },
        structure: { kind: "agent" as const, stage: "S2", title: "结构", kit: "plot", op: "structure-design", output: "内部/稿本/structure.md" },
        tropes: { kind: "agent" as const, stage: "S1", title: "梗卡", kit: "search", op: "find-trope", output: "内部/稿本/tropes.md" },
        zeitgeist: { kind: "agent" as const, stage: "S1", title: "时代情绪", skill: "topic-zeitgeist", kit: "search", op: "topic-zeitgeist", output: "内部/稿本/z.md" },
        baseline: { kind: "agent" as const, stage: "S1", title: "冷启动基线", kit: "search", op: "meme_harvest", output: "内部/稿本/base.md" },
      },
      edges: [
        { id: "e-analysis-struct", from: "analysis", to: "structure", role: "flow" as const },
        { id: "e-tropes-analysis", from: "tropes", to: "analysis", role: "flow" as const },
        { id: "e-base-analysis", from: "baseline", to: "analysis", role: "flow" as const },
      ],
    },
  }) as unknown as typeof TS;

  const ov = (patches: FlowOverlay["patches"]): FlowOverlay => ({
    format: "flow-overlay@1", flowId: "ov-syn", origin: "user", patches,
  });

  it("set-node 改内容配置；set-op 换 tool；remove-node 桥接；place-node 插位", () => {
    const r = applyOverlay(SYN(), [ov([
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
    const r = applyOverlay(SYN(), [ov([
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
    // set-tool 的 toolOverrides 由 overlay 合成得到（纯函数，与图无关）；
    // resolveToolConfig 是优先级单点，直接喂「op 声明 + 节点 config + overlay config」三层。
    const eff = effectiveFlow(ROOT, SYN(), {
      overlays: [{ format: "flow-overlay@1", flowId: "ov-syn", origin: "user", patches: [
        { kind: "set-tool", kit: "plot", op: "structure-design", config: { maxChars: 9999 }, reason: "测：op 级默认值覆盖" },
      ] }],
    });
    const node = eff.flow.graph.nodes.structure;
    const opOv = eff.toolOverrides["plot.structure-design"];
    const withNode = resolveToolConfig(
      { kit: "plot", op: "structure-design", domain: "plot", kind: "produce", knowledge: [], minitools: [], assist: [], config: opOv?.config ?? {} },
      { ...(node.config ?? {}), depth: "深" },
      opOv?.config,
    );
    expect(withNode.values.depth).toBe("深");            // 节点覆盖通用默认
    const onlyOp = resolveToolConfig(
      { kit: "plot", op: "structure-design", domain: "plot", kind: "produce", knowledge: [], minitools: [], assist: [], config: opOv?.config ?? {} },
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

  it("全部 tool 都声明了 config（能力必须可调；数量不设限——批D 后事实源=modules/，吸收新 op 仍须全覆盖）", () => {
    const dirs = fs.readdirSync(path.join(ROOT, "modules"));
    let ops = 0;
    const missing: string[] = [];
    for (const k of dirs) {
      const f = path.join(ROOT, "modules", k, "module.json");
      if (!fs.existsSync(f)) continue;
      const mod = JSON.parse(fs.readFileSync(f, "utf-8")) as { id: string; ops: Record<string, { config?: unknown }> };
      for (const [op, def] of Object.entries(mod.ops)) {
        ops += 1;
        if (!def.config || typeof def.config !== "object") missing.push(`${mod.id}/${op}`);
      }
    }
    expect(ops).toBeGreaterThanOrEqual(64); // 下限护栏：只增不减（批D 收口：+3 planned 落位 −2 已退役 kit 工具 = 64 ops）
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
      phase: "submit" as const, ctx: { used: 0, hitIds: [] }, checks: { pass: 1, block: 0 },
    })),
    ...Array.from({ length: 4 }, (_, i) => ({
      ts: `2026-09-17T10:1${i}:00Z`, runId: "r", nodeId: "tropes", kit: "search", op: "find-trope",
      phase: "dispatch" as const,
      ctx: { offered: 3, ids: ["kb/market/snapshot", "kb/market/structure", "kb/aesthetic/ai-trace"] },
    })),
    // 高打回 + 标尺零命中 → R2「标尺饥荒」（medium risk，必须待批）
    ...Array.from({ length: 4 }, (_, i) => ({
      ts: `2026-09-17T11:0${i}:00Z`, runId: "r", nodeId: "structure", kit: "plot", op: "structure-design",
      phase: "submit" as const, ctx: { used: 0, hitIds: [] }, checks: { pass: 0, block: 2 },
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
    // R6 处理的是「图上常驻的评审节点」这一 archetypes（纯汇合点 vs 带产活评审步）。
    // 迁移后真实 flow@3 里唯一的 kind=gate 是模块连接件（gate_role=link），既非评审步也非纯汇合点，
    // 无真实节点可锚这两类判据 ⇒ 按 r7-runtime.test.ts 做法合成一条含两类门的小流，隔离 R6 语义。
    const gateFlow = () => ({
      format: "flow@2" as const, id: "ov-r6", title: "R6 门清场夹具", version: "1.0.0", status: "active" as const,
      inputs: {}, outputs: [],
      graph: {
        nodes: {
          "gate-plain": { kind: "gate" as const, stage: "S1", title: "纯汇合点" },
          "gate-review": { kind: "gate" as const, stage: "S1", title: "评审步", kit: "plot", op: "plot-redline", output: "内部/意见/意见书-gate-review.md" },
          structure: { kind: "agent" as const, stage: "S2", title: "结构", kit: "plot", op: "structure-design", output: "内部/稿本/structure.md" },
        },
        edges: [{ id: "e-gate-review-struct", from: "gate-review", to: "structure", role: "flow" as const }],
      },
    }) as unknown as typeof TS;

    // ① 纯汇合点：无 skill/op/output → 不是评审步；零样本也提裁（价值为零是构造性的）
    const plain = gateFlow();
    expect(isWorkGate(plain.graph.nodes["gate-plain"])).toBe(false);
    const p1 = proposeFromMetrics(plain, summarizeMetrics([]), { root: ROOT });
    expect(p1.find((p) => p.id === "R6@gate-plain")?.patch).toMatchObject({ kind: "remove-node", id: "gate-plain" });

    // ② 评审步（带产活）：isWorkGate=true；零样本不下结论（凭格式猜会删掉有效质量信号）
    const review = gateFlow();
    expect(isWorkGate(review.graph.nodes["gate-review"])).toBe(true);
    const p2 = proposeFromMetrics(review, summarizeMetrics([]), { root: ROOT });
    expect(p2.some((p) => p.id === "R6@gate-review")).toBe(false);

    // ③ 评审步跑够样本、产物无人消费 → 提裁（红蓝对抗残留）
    const cold = Array.from({ length: 4 }, (_, i) => ({
      ts: `2026-09-17T13:0${i}:00Z`, runId: "r", nodeId: "gate-review", kit: "plot", op: "plot-redline",
      phase: "submit" as const, ctx: { used: 0, hitIds: [] }, checks: { pass: 1, block: 0 },
    }));
    const p3 = proposeFromMetrics(gateFlow(), summarizeMetrics(cold), { root: ROOT });
    const r6 = p3.find((p) => p.id === "R6@gate-review");
    expect(r6?.patch).toMatchObject({ kind: "remove-node", id: "gate-review" });
    expect(r6?.reason).toContain("被下游引用 0 次");
    expect(r6?.reason).not.toContain("<code>"); // 报告是机器可读的，不带标记

    // ④ 产物有人消费 → 不裁（它还有信息价值，只是裁决自动）
    const warm = [
      ...cold,
      {
        ts: "2026-09-17T14:00:00Z", runId: "r", nodeId: "structure", kit: "plot", op: "structure-design",
        phase: "submit" as const,
        ctx: { used: 1, ids: ["内部/意见/意见书-gate-review.md"], hitIds: ["内部/意见/意见书-gate-review.md"] },
      },
    ];
    const p4 = proposeFromMetrics(gateFlow(), summarizeMetrics(warm, { pathToNode: { "内部/意见/意见书-gate-review.md": "gate-review" } }), { root: ROOT });
    expect(p4.some((p) => p.id === "R6@gate-review")).toBe(false);
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

describe("R5 · 内核端到端：连接件自动放行 + 人工交界拦人 + 指标与提案落盘", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miniflow-r5-"));
  const projectId = "p-r5";
  const kernel = new Kernel({ root });
  const pd = path.join(root, "projects", projectId);
  process.env.MINIFLOW_ROOT = ROOT; // 断言注册表（AE-REPORT-DENSITY 等）挂在仓库根
  process.env.MINIFLOW_HEADER_MODE = "off"; // 头部契约由 artifact-lint 管，本组只跑编排

  // m1 → m2 全部执行步（跨过 m2.link 自动交界后，撞 m3.link 人工交界前需交完的产物）
  const UPSTREAM = ["m1.topic-report", "m1.find-trope", "m1.topic-zeitgeist", "m1.internet-feel",
    "m2.topic-analysis-report", "m2.topic-proposal", "m2.topic-chief-aesthetic"];

  /** 走到 m3.link（plan→plot 人工交界）挂起前：依次交完 m1/m2 认知步。返回最后一次交卷。 */
  async function walkToBoundary(k: Kernel, pid: string, dir: string) {
    let last: Awaited<ReturnType<Kernel["flow_submit"]>> | undefined;
    for (const n of UPSTREAM) {
      last = await k.flow_submit(pid, n, { content: artifact("topic", n, REPORT, { projectDir: dir }) });
    }
    return last!;
  }

  it("缺省编排：自动交界放行且留痕（不静默跳过）、人工交界 m3.link 拦人挂起", async () => {
    fs.mkdirSync(pd, { recursive: true });
    fs.writeFileSync(path.join(pd, "选题素材.md"), "# 选题素材\n\n甲方点子：老牌发型师。\n", "utf-8");
    const run = await kernel.flow_run("topic", projectId, { route: "hot", region: "CN", direction: "R5 交界验收用例" });
    expect(run.status).toBe("awaiting_input");

    const last = await walkToBoundary(kernel, projectId, pd);
    // 跨过 m2.link（plan 前，auto）后撞上 m3.link（plot 前，manual）——它挂起等人，不是自动放行
    expect(last.next?.status).toBe("suspended");
    if (last.next?.status !== "suspended") return;
    expect(last.next.nodeId).toBe("m3.link");
    expect(last.next.gate.title).toContain("连接");
    expect(last.next.gate.title).toContain("编剧");

    const metrics = readMetrics(pd);
    // 自动交界照跑并留痕：m2.link 有 phase=link、verdict=pass 的指标（旧「评审步不静默断路」在 flow@3 的表达）
    const autoLink = metrics.filter((m) => m.nodeId === "m2.link" && m.phase === "link");
    expect(autoLink.length).toBeGreaterThan(0);
    expect(autoLink.some((m) => m.verdict === "pass")).toBe(true);
    // 人工交界尚未裁决：无 link-pass 指标，state 里它是 awaiting
    expect(metrics.some((m) => m.nodeId === "m3.link" && m.phase === "link" && m.verdict === "pass")).toBe(false);
    const st = JSON.parse(fs.readFileSync(path.join(pd, "state.json"), "utf-8")) as {
      nodes: Record<string, { status: string }>;
    };
    expect(st.nodes["m2.link"].status).toBe("done");
    expect(st.nodes["m3.link"].status).toBe("awaiting");
    // 认知步派发相/交卷相都在（证明真跑了流水线）
    const tro = metrics.filter((m) => m.nodeId === "m1.find-trope");
    expect(tro.some((m) => m.phase === "dispatch")).toBe(true);
    expect(tro.some((m) => m.phase === "submit")).toBe(true);
  });

  it("交界裁决 = 人工：pass 后放行到下游执行步 m3.structure-design；指标记 link 相", async () => {
    const g = await kernel.flow_gate(projectId, { nodeId: "m3.link", verdict: "pass" });
    expect(g.applied).toBe(true);
    expect(g.next?.status).toBe("awaiting_input");
    expect(g.next?.nodeId).toBe("m3.structure-design");
    expect(readMetrics(pd).some((m) => m.phase === "link" && m.nodeId === "m3.link" && m.verdict === "pass")).toBe(true);
    const eff = kernel.viewEffect(projectId);
    // flow@3 的「边界清单」就是 links（内核 boundaries 恒空，改由 links 表达）
    expect(eff.boundaries).toEqual([]);
    expect(eff.policy.link_default).toBe("auto");
  });

  it("flow_optimize 产出提案并落 registry/optimize.json；flow_overlay 改写后重编译计划", async () => {
    const first = kernel.flowOptimize(projectId, {});
    expect(fs.existsSync(path.join(pd, "registry", "optimize.json"))).toBe(true);
    expect(first.report.format).toBe("optimize@1");

    const r = await kernel.flowOverlay(projectId, {
      patches: [{ kind: "set-node", id: "m1.find-trope", config: { depth: "深" }, reason: "梗选型决定下游一切，加注" }],
      reason: "R5 e2e：编排改写 + 重编译",
      replan: true,
      actor: "test",
    });
    expect(r.applied).toBe(1);
    expect(fs.existsSync(path.join(pd, "registry", "overlay.json"))).toBe(true);
    // 重编译后：编排指纹与计划指纹都已生成
    const eff = kernel.viewEffect(projectId);
    expect(eff.overlayHash).toBeTruthy();
    expect(eff.planHash).toBeTruthy();
  });

  it("策略是旋钮不是硬编码：set-link 单点把自动交界转人工拦人（旧 gate_mode=manual / kit_boundary=off 的 flow@3 表达）", async () => {
    const root2 = fs.mkdtempSync(path.join(os.tmpdir(), "miniflow-r5b-"));
    const pid = "p-r5b";
    const k2 = new Kernel({ root: root2 });
    const pd2 = path.join(root2, "projects", pid);
    fs.mkdirSync(pd2, { recursive: true });
    fs.writeFileSync(path.join(pd2, "选题素材.md"), "# 选题素材\n\n甲方点子：老牌发型师。\n", "utf-8");
    // 把原本 auto 的 m2.link 单点转 manual（等价旧「退回手动」）
    fs.mkdirSync(path.join(pd2, "registry"), { recursive: true });
    fs.writeFileSync(
      path.join(pd2, "registry", "overlay.json"),
      JSON.stringify({
        format: "flow-overlay@1", flowId: "topic", origin: "user",
        reason: "测试锁定：m2 交界转人工",
        patches: [{ kind: "set-link", link: "m2.link", mode: "manual", reason: "断言拦人" }],
      }, null, 2) + "\n",
      "utf-8",
    );
    await k2.flow_run("topic", pid, { route: "hot", region: "CN", direction: "锁定交界" });
    // 交完 m1 认知步 → 撞上被转成 manual 的 m2.link，挂起等人（而不是自动放行）
    let last: Awaited<ReturnType<Kernel["flow_submit"]>> | undefined;
    for (const n of ["m1.topic-report", "m1.find-trope", "m1.topic-zeitgeist", "m1.internet-feel"]) {
      last = await k2.flow_submit(pid, n, { content: artifact("topic", n, REPORT, { projectDir: pd2 }) });
    }
    expect(last?.next?.status).toBe("suspended");
    if (last?.next?.status !== "suspended") return;
    expect(last.next.nodeId).toBe("m2.link");
    // flow@3 从不派生 itb-* 边界门：boundaries 恒空（改由 links 表达）
    expect(k2.viewEffect(pid).boundaries).toEqual([]);
  });
});

/**
 * R7 · OS-02A 回归（flow@3 版）：缺省 `link_default=auto` 必须是「交界可见但不拦人」，
 * **不是**「把交界从图里关掉」。
 *
 * 旧失血点：auto 的边界门曾挂节点级 `when` 关掉，而 `compilePlan` 会把不活跃节点的出入边一并裁掉
 * （plan.ts:52）⇒ 门及其整段下游失去活跃入边 → 不可达 → 计划截断、run 误判 completed。
 * flow@3 里连接件（gate_role=link）是常驻节点，auto 只是「在计划内自动裁决留痕」，绝不摘节点。
 * 这里锁：auto 交界照进计划、照自动放行、下游照常派发；manual 交界才挂人；计划贯通到交付端。
 */
describe("R7 · 缺省 link_default=auto：交界可见、自动放行、下游不断（回归）", () => {
  it("auto 下计划完整、自动交界裁决放行、下游照常派发；manual 交界才拦人", async () => {
    const root3 = fs.mkdtempSync(path.join(os.tmpdir(), "miniflow-r7b-"));
    const pid = "p-r7b";
    const k3 = new Kernel({ root: root3 });
    const pd3 = path.join(root3, "projects", pid);
    fs.mkdirSync(pd3, { recursive: true });
    fs.writeFileSync(path.join(pd3, "选题素材.md"), "# 选题素材\n\n甲方点子：老牌发型师。\n", "utf-8");
    await k3.flow_run("topic", pid, { route: "hot", region: "CN", direction: "R7 缺省交界策略" });

    // 缺省 = auto：策略面如实回显（flow@3 用 link_default，不再是 kit_boundary）
    expect(k3.viewEffect(pid).policy.link_default).toBe("auto");

    // 交完 m1 认知步：跨过 auto 的 m2.link 后照常派发 m2 入口步，而不是 suspended 在 m2.link
    let last: Awaited<ReturnType<Kernel["flow_submit"]>> | undefined;
    for (const n of ["m1.topic-report", "m1.find-trope", "m1.topic-zeitgeist", "m1.internet-feel"]) {
      last = await k3.flow_submit(pid, n, { content: artifact("topic", n, REPORT, { projectDir: pd3 }) });
    }
    expect(last?.next?.status).toBe("awaiting_input");
    if (last?.next?.status !== "awaiting_input") return;
    expect(last.next.nodeId).toBe("m2.topic-analysis-report");

    // ① 自动交界**仍在计划内**且已被自动裁决——「可见、可审计」的证据，也是旧实现的失血点
    const st = JSON.parse(fs.readFileSync(path.join(pd3, "state.json"), "utf-8")) as {
      plan: { order: string[] };
      nodes: Record<string, { status: string; verdict?: string }>;
    };
    expect(st.plan.order).toContain("m2.link");
    expect(st.plan.order.indexOf("m2.link")).toBeLessThan(st.plan.order.indexOf("m2.topic-analysis-report"));
    expect(st.nodes["m2.link"].status).toBe("done");
    expect(st.nodes["m2.link"].verdict).toBe("pass");
    // 计划必须贯通到交付端（flow@3 派生全链：含人工交界 m3.link 也在计划内，末节点 render_html 在列），
    // 而不是在交界门上截断（旧 bug：auto 门挂 when → 出入边被裁 → 计划止于中途、run 误判 completed）
    expect(st.plan.order).toContain("m3.link");
    expect(st.plan.order).toContain("m5.render_html");
    expect(st.plan.order.length).toBeGreaterThanOrEqual(22);

    // ② 指标照记 link 相（旧实现连 phase 都漏在契约 enum 外，被 catch{} 吞成 0 行）
    expect(readMetrics(pd3).some((m) => m.phase === "link" && m.nodeId === "m2.link")).toBe(true);
  });
});

describe("R5 · 读模型：生效编排与指标汇总只由内核定义一次（页面纯消费）", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miniflow-r5c-"));
  const projectId = "p-r5c";
  const kernel = new Kernel({ root });
  const pd = path.join(root, "projects", projectId);
  const effPath = path.join(pd, "registry", "effective.json");
  const sumPath = path.join(pd, "registry", "metrics-summary.json");

  // flow@3 迁移映射：
  //   旧 effective@1「boundaries + 逐节点 resolved{values,sources,unknownKeys} + toolOverrides」
  //   ⇒ 新 effective@2「links + nodes/edges 派生图 + nodeConfig{output,skill,module,nodeConfig}」。
  //   逐键来源在 @2 里的对应表达 = 节点声明配置里的 "@default:<键>" 引用（来源内联在值里）；
  //   resolved/toolOverrides 面 @2 未落盘（见交付报告的内核观察项），本组改断 @2 真实暴露的面。
  it("flow_run/flow_status 后落 effective.json：含连接件（links）与逐节点配置值", async () => {
    fs.mkdirSync(pd, { recursive: true });
    fs.writeFileSync(path.join(pd, "选题素材.md"), "# 选题素材\n\n甲方点子：夜市烤串摊主。\n", "utf-8");
    await kernel.flow_run("topic", projectId, { route: "hot", region: "CN", direction: "读模型用例" });

    expect(fs.existsSync(effPath)).toBe(true);
    const view = JSON.parse(fs.readFileSync(effPath, "utf-8"));
    expect(view.format).toBe("effective@2");
    expect(view.flowId).toBe("topic");
    // 旧「边界清单 boundaries.length>0」⇒ flow@3 的连接件清单（5 模块 → 4 条模块间连接）
    expect(view.links.length).toBe(4);
    // 旧「边界门被显式标记（页面不靠 id 前缀嗅探）」⇒ 现在双处显式：links.mode + nodeConfig.gateRole
    const m3link = view.nodes["m3.link"];
    expect(m3link.kind).toBe("gate");
    expect(m3link.gate_role).toBe("link");
    expect(view.nodeConfig["m3.link"].gateRole).toBe("link");
    expect(view.links.find((l: { id: string }) => l.id === "m3.link").mode).toBe("manual");
    // 每个 tool 节点都有内核合成的配置与产物路径（编排真相只派生一次）
    const tro = view.nodeConfig["m1.find-trope"];
    expect(tro.output).toBe("01-选题/find-trope.md");
    expect(tro.skill).toBe("find-trope");
    expect(tro.module).toBe("m1");
    // 逐键来源：@default 引用显式标注该键取自默认旋钮声明（不是静默字面量）
    expect(Object.keys(tro.nodeConfig).length).toBeGreaterThan(0);
    expect(tro.nodeConfig.mainTropes).toBe("@default:mainTropes");
  });

  it("指标汇总读模型与内核 viewEffect 同值（页面与优化 agent 消费同一份）", async () => {
    // 交卷顺序按派生计划走（flow@3 的 m1 链：topic-report → find-trope）；旧节点 tropes/zeitgeist 已不存在
    await kernel.flow_submit(projectId, "m1.topic-report", { content: artifact("topic", "m1.topic-report", REPORT, { projectDir: pd }) });
    await kernel.flow_submit(projectId, "m1.find-trope", { content: artifact("topic", "m1.find-trope", "# 梗卡\n\n炭火 vs 电炉。\n", { projectDir: pd }) });
    const eff = kernel.viewEffect(projectId);
    expect(fs.existsSync(sumPath)).toBe(true);
    const sum = JSON.parse(fs.readFileSync(sumPath, "utf-8"));
    expect(sum.format).toBe("metrics-summary@1");
    expect(sum.events).toBe(eff.metrics.events);
    expect(sum.events).toBeGreaterThan(0);
    expect(Object.keys(sum.byTool).sort()).toEqual(Object.keys(eff.metrics.byTool).sort());
    // flow@3 里 tool 归口 = 模块 kit 名：旧 "tropes"/"search.find-trope" ⇒ "topic.find-trope"
    expect(Object.keys(sum.byTool)).toContain("topic.find-trope");
    expect(sum.window).toEqual(eff.metrics.window);
  });

  it("overlay 改写后读模型跟着变：消费的 patch 计数回显，不消费的显式回显不静默", async () => {
    const before = kernel.viewEffect(projectId);
    expect(before.applied).toBe(0);
    await kernel.flowOverlay(projectId, {
      patches: [
        // 旧 kit:"search" ⇒ topic 派生节点的 op 归口是模块 kit 名（"topic.find-trope"）
        { kind: "set-tool", kit: "topic", op: "find-trope", config: { depth: "深" }, reason: "梗选型决定下游一切" },
        { kind: "set-node", id: "m1.find-trope", config: { 不存在的旋钮: 1 }, reason: "故意用 flow@3 不消费的 kind，验证不静默丢弃" },
      ] as never,
      reason: "读模型覆盖用例",
      actor: "test",
    });
    const ve = kernel.viewEffect(projectId);
    // 旧「节点配置来源标 overlay + unknownKeys 显式回显」⇒ flow@3 的对应面：
    //   ① applied 只计真被展开器消费的 patch（set-tool=1，set-node 被拒不计）；
    //   ② notes 逐条回显消费与拒绝（「未识别即显式」的机制表达），页面不必自己重算。
    expect(ve.applied).toBe(1);
    expect(ve.composition.some((s) => s.includes("set-tool topic.find-trope"))).toBe(true);
    expect(ve.composition.some((s) => s.includes("set-node") && s.includes("未被 flow@3 消费"))).toBe(true);
    // overlay 本身也是读模型的一部分（patch 明细原样可查）
    expect(ve.overlay?.patches.some((p: { kind: string; op?: string }) => p.kind === "set-tool" && p.op === "find-trope")).toBe(true);
    // 落盘的生效面同步重派生（同一事实源，两处消费同值）
    const view = JSON.parse(fs.readFileSync(effPath, "utf-8"));
    expect(view.format).toBe("effective@2");
    expect(view.links.length).toBe(4);
  });

  it("read 模型是旁路：编排出错不阻断流水线（不抛错即可）", () => {
    // persistEffective/persistMetricsSummary 全程 try/catch —— 读侧任何异常都不许变成主线故障
    expect(() => kernel.viewEffect(projectId)).not.toThrow();
  });
});

/* ============================================================================
 * R5 §四闭合（v5.0 口径）：提交链上没有断言闸——完整性照拦，质量降级为证据
 *
 * 声明式断言协议（node.asserts / op.asserts / runDeclaredAsserts 三态裁决）已
 * 整层下架（退役依据：台账 90 条里真正打回过东西的只有 2 个 id；25 条以
 * 「无机器校验器」名义空转，累计 170 次 warn，红方执行体从未存在）。
 * 回归锁改锁新现状三件事：
 *   ① 含扫描器 block 级 findings 的产物 → 提交照收（美学裁决不在提交链上）；
 *   ② 完整性违规（残渣/空文/头部缺失）→ 照样打回并落 checks 指标（返工溢价不为 0）；
 *   ③ scan_quality 内建步 = 全量证据收据（mode:quality-evidence）：findings 里
 *      有 block 也不判败本步——证据不是判决，裁决归 agent 与端尾 kit 边界人裁。
 * ==========================================================================*/

/** 拍级夹具：钩型可控（bad=true 时首拍写成非四型，扫描器出 AE-HOOK-EVENT block 证据——只出证据，不打回）。 */
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

describe("R5 · v5.0 提交链无断言闸（完整性是唯一残留闸，质量归证据）", () => {
  /** 选题流最小开局：素材落盘 → 开跑 → m1.topic-report 交卷，m1.find-trope 轮到交卷。 */
  async function openFindTrope(kernel: Kernel, root: string, projectId: string, direction: string): Promise<string> {
    const pd = path.join(root, "projects", projectId);
    fs.mkdirSync(pd, { recursive: true });
    fs.writeFileSync(path.join(pd, "选题素材.md"), "# 选题素材\n\n甲方点子：老牌发型师。\n", "utf-8");
    await kernel.flow_run("topic", projectId, { route: "hot", region: "CN", direction });
    await kernel.flow_submit(projectId, "m1.topic-report", {
      content: artifact("topic", "m1.topic-report", REPORT, { projectDir: pd }),
    });
    return pd;
  }

  it("扫描器 block 级 findings 的产物照样收：断言闸已下架，别指望任何声明把它放回提交链", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "miniflow-nogate-"));
    const kernel = new Kernel({ root });
    const pd = await openFindTrope(kernel, root, "p-nogate", "无断言闸用例");
    // 首拍「氛围」在扫描器眼里是 AE-HOOK-EVENT block——但提交链只跑确定性完整性（v5.0）
    const ok = await kernel.flow_submit("p-nogate", "m1.find-trope", {
      content: artifact("topic", "m1.find-trope", beatDoc("氛围"), { projectDir: pd }),
    });
    expect(ok.status).toBe("accepted");
  });

  it("完整性违规照样打回：problems 只剩确定性检查名，打回落 checks.block（v5.0 更名 asserts→checks）", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "miniflow-integ-"));
    const kernel = new Kernel({ root });
    const pd = await openFindTrope(kernel, root, "p-integ", "完整性闸用例");
    // 残渣入正文（历史事故形态）：这是确定性完整性，仍然硬拦
    const rej = await kernel.flow_submit("p-integ", "m1.find-trope", {
      content: artifact("topic", "m1.find-trope", "\nwc -l 输入清单\n", { projectDir: pd }),
    });
    expect(rej.status).toBe("rejected");
    expect(rej.problems?.some((p) => p.name === "no-debris" && p.status === "block")).toBe(true);
    // 「flow_submit 路径上无 AE-」验收口径的测试面：打回单里全部是完整性检查名
    expect((rej.problems ?? []).filter((p) => p.name.startsWith("AE-"))).toEqual([]);
    // 打回必须落指标——否则 R5 成本口径（checkBlock 溢价）永远是 0，优化器看不到返工
    const rejMetric = readMetrics(pd).find((m) => m.nodeId === "m1.find-trope" && m.verdict === "rejected");
    expect(rejMetric?.checks?.block).toBeGreaterThan(0);
  });

  it("core 步 scan_quality 出全量证据收据：findings 含 block 也不判败本步（证据不是判决）", async () => {
    process.env.MINIFLOW_ROOT = ROOT; // 纯净度标记台账等仓库根资源
    const pd = fs.mkdtempSync(path.join(os.tmpdir(), "miniflow-scan-"));
    fs.mkdirSync(path.join(pd, "02-编剧"), { recursive: true });
    // flow@3 派生图：m2.script-drama-beat 的 minitool = scan_quality（原 check_aesthetic_asserts），
    // 沿边检上游 m2.scene-breakdown 的产物（派生图实际落盘路径，非模板字面量）。
    fs.writeFileSync(path.join(pd, "02-编剧", "scene-breakdown.md"), beatDoc("悬念"), "utf-8");

    const flow = expandedFlow("episode-script");
    const state = { runId: "r-scan", flowId: "episode-script", projectId: "p-scan", status: "running", nodes: {}, gate: {} } as never;
    const res = await runCoreNode(pd, flow as never, state, "m2.script-drama-beat");
    expect(res.ok).toBe(true);

    const report = JSON.parse(fs.readFileSync(path.join(pd, "内部", "质量扫描-m2.script-drama-beat.json"), "utf-8"));
    expect(report.mode).toBe("quality-evidence");
    expect(report.minitool).toBe("scan_quality");
    expect(report.summary.files).toBe(1);
    const names: string[] = report.findings.map((f: { name: string }) => f.name);
    expect(names).toContain("AE-HOOK-EVENT"); // 扫描器 id 保留：证据名就叫这个
    expect(names).toContain("AE-STRUCT-CAUSE#tailhook");
    // v5.0 契约：断言时代的三态台账不再出现在收据里（无 declared/unverified 口径）
    expect(report.declared).toBeUndefined();
    expect(report.contract).toBeUndefined();
    expect(report.summary.declared).toBeUndefined();
    expect(report.summary.unverified).toBeUndefined();
    expect(report.findings.every((f: { status: string }) => ["pass", "warn", "block"].includes(f.status))).toBe(true);

    // 换一份首拍无钩型的上游再扫：block 证据在场，本步照样 ok——拦截与否归验收 agent/人
    fs.writeFileSync(path.join(pd, "02-编剧", "scene-breakdown.md"), beatDoc("氛围"), "utf-8");
    const res2 = await runCoreNode(pd, flow as never, state, "m2.script-drama-beat");
    expect(res2.ok).toBe(true);
    const report2 = JSON.parse(fs.readFileSync(path.join(pd, "内部", "质量扫描-m2.script-drama-beat.json"), "utf-8"));
    expect(report2.findings.some((f: { name: string; status: string }) => f.name === "AE-HOOK-EVENT" && f.status === "block")).toBe(true);
    expect(report2.summary.block).toBeGreaterThan(0);
    expect(report2.note).toContain("证据不是判决");
  });
});

/* ============================================================================
 * WO-A · 文本层扫描器（v5.0 口径：断言协议退役，下列各项 = aesthetic.ts 扫描器检查）
 *   ① checks_via 别名层随声明协议下架——不再有「声明名→引擎名」转译，
 *      扫描器直接报真名（如 AE-DENSITY-WORDS），证据链少一层间接；
 *   ② 文本层校验器全部保留，只换身份：从「提交闸」变「扫描证据」——
 *      status 三态（pass/warn/block）仍是确定性判据，但打回权归验收 agent/人；
 *   ③ 不适用切片诚实标 warn（detail 带「不适用」），绝不冒充 pass。
 *   红线不变：不引 LLM 当机器校验器（语义判据归 knowledge/rules/ 语料卡 + agent）。
 * ==========================================================================*/
describe("WO-A · 文本层扫描器（证据不裁决；AE-* 只是扫描器收据 id）", () => {
  // 纯净度标记台账挂在仓库根；临时项目目录下没有它 → AE-OUTPUT-PURITY 退化成「不适用」warn，测不到东西。
  // describe 体在收集期执行，早于所有用例，故此处设置对本文件全部用例生效。
  process.env.MINIFLOW_ROOT = ROOT;

  it("台词密度：别名退役后扫描器直接报真名——360 字超上限 → AE-DENSITY-WORDS warn", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "miniflow-woa1-"));
    fs.mkdirSync(path.join(dir, "对外交付"), { recursive: true });
    const dense = beatDoc("悬念").replace(
      "台词：王拾：「这什么破东西。」",
      "台词：王拾：「" + "词".repeat(360) + "」",
    );
    fs.writeFileSync(path.join(dir, "对外交付", "03-小纲.md"), dense, "utf-8");

    const results = runAestheticAsserts(dir, "对外交付/03-小纲.md");
    // 旧声明名 AE-DENSITY-HOT/CALM 与 checks_via 转译已消失：证据单只有引擎真名
    expect(results.some((x) => x.name === "AE-DENSITY-HOT" || x.name === "AE-DENSITY-CALM")).toBe(false);
    // 台词 360 字 > 350 上限 → warn（major 级证据）；「越界」detail 必须报出实数，供 agent/人判
    const d = results.find((x) => x.name === "AE-DENSITY-WORDS");
    expect(d?.status).toBe("warn");
    expect(d?.detail).toContain("密度越界");
  });

  it("章末钩（AE-WNF-HOOK）：无钩 block；有钩 pass；连续同型 warn——三态保留，身份已是证据", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "miniflow-woa2-"));
    fs.mkdirSync(path.join(dir, "章节正文"), { recursive: true });
    const flat = "# 第1章\n\n他吃完饭，把碗洗了，然后上床睡觉，一切如常，什么也没有发生。";
    fs.writeFileSync(path.join(dir, "章节正文", "第1章.md"), flat, "utf-8");
    const hookOf = (rel: string, d = dir) =>
      runAestheticAsserts(d, rel).find((x) => x.name === "AE-WNF-HOOK");
    expect(hookOf("章节正文/第1章.md")?.status).toBe("block");

    // 章末补一个转折型尾钩（「就在这时」是扫描器认得的三型信号之一）→ pass
    fs.writeFileSync(path.join(dir, "章节正文", "第1章.md"), flat + "\n\n就在这时，门外的雨忽然停了。", "utf-8");
    expect(hookOf("章节正文/第1章.md")?.status).toBe("pass");

    // 第2章也用转折型尾钩 → 连续同型，四型轮换没做到（钩型要读上一章尾才判得出来）
    fs.writeFileSync(
      path.join(dir, "章节正文", "第2章.md"),
      "# 第2章\n\n第二天，门口多了一双陌生的鞋。\n\n可就在这时，屋里传来一声轻响。",
      "utf-8",
    );
    const h2 = hookOf("章节正文/第2章.md");
    expect(h2?.status).toBe("warn");
    expect(h2?.detail).toContain("连续同型");
  });

  it("伏笔台账（AE-CONT-FORESHADOW）：到期未回收 warn、卡点级 block；无台账诚实标「不适用」不冒充 pass", () => {
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
    const f = runAestheticAsserts(dir, "章节正文/第2章.md").find((x) => x.name === "AE-CONT-FORESHADOW");
    // F1 预期第 3 章（还没到）→ 不算逾期；F2 预期第 2 章且是卡点 → block 级证据。
    // 同时是「待回收 ≠ 已回收」的回归锁：裸判 /回收/ 会让该检查永远 pass（扫描空转）。
    expect(f?.status).toBe("block");
    expect(f?.detail).toContain("F2");
    expect(f?.detail).not.toContain("F1");

    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "miniflow-woa3b-"));
    fs.mkdirSync(path.join(empty, "章节正文"), { recursive: true });
    fs.writeFileSync(path.join(empty, "章节正文", "第1章.md"), "# 第1章\n\n正文。", "utf-8");
    const f2 = runAestheticAsserts(empty, "章节正文/第1章.md").find((x) => x.name === "AE-CONT-FORESHADOW");
    expect(f2?.status).toBe("warn"); // 无台账：诚实标注切片不适用，不冒充 pass
    expect(f2?.detail).toContain("不适用");
  });

  it("正文纯净（AE-OUTPUT-PURITY）：执行元数据入正文 block；干净正文 pass（标记台账 MINIFLOW_ROOT 共享）", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "miniflow-woa4-"));
    fs.mkdirSync(path.join(dir, "章节正文"), { recursive: true });
    const dirty = "# 第1章\n\n本批未读取 projects/其他项目，未做任何 git 操作。他吃完了饭。";
    fs.writeFileSync(path.join(dir, "章节正文", "第1章.md"), dirty, "utf-8");
    const p = runAestheticAsserts(dir, "章节正文/第1章.md").find((x) => x.name === "AE-OUTPUT-PURITY");
    expect(p?.status).toBe("block");

    const clean = fs.mkdtempSync(path.join(os.tmpdir(), "miniflow-woa4b-"));
    fs.mkdirSync(path.join(clean, "章节正文"), { recursive: true });
    fs.writeFileSync(path.join(clean, "章节正文", "第1章.md"), "# 第1章\n\n他吃完了饭，把碗洗了。", "utf-8");
    const p2 = runAestheticAsserts(clean, "章节正文/第1章.md").find((x) => x.name === "AE-OUTPUT-PURITY");
    expect(p2?.status).toBe("pass");
  });

  it("禁不可拍摄内容（AE-VIS-EMPTY）：分镜行含心理/抒情词出 block 证据", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "miniflow-woa5-"));
    fs.mkdirSync(path.join(dir, "对外交付"), { recursive: true });
    const bad = beatDoc("悬念").replace("分镜：特写 → 箱底老拍。", "分镜：特写 → 箱底老拍，王拾心想这次稳了。");
    fs.writeFileSync(path.join(dir, "对外交付", "03-小纲.md"), bad, "utf-8");
    const v = runAestheticAsserts(dir, "对外交付/03-小纲.md").find((x) => x.name === "AE-VIS-EMPTY");
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
    await kernel.flow_run("topic", "p-mine", { route: "hot", region: "CN", direction: "编排挖掘用例" });

    const mine = kernel.flowMine("p-mine");
    expect(mine.package.format).toBe("mine-package@1");
    expect(mine.package.flowId).toBe("topic");
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
    await kernel.flow_run("topic", "p-mine2", { route: "hot", region: "CN", direction: "findings 并入用例" });

    fs.writeFileSync(
      path.join(pd, "registry", "miner-findings.json"),
      JSON.stringify({
        format: "miner-findings@1",
        flowId: "topic",
        runId: "r-mine2",
        at: new Date().toISOString(),
        findings: [
          {
            // flow@3 迁移映射：tool 归口 = 模块 kit 名（旧 search.find-trope ⇒ topic.find-trope）
            id: "Mctx@topic.find-trope",
            dimension: "ctx",
            severity: "medium",
            title: "市场结构卡零命中",
            reason: "装载 3 次从未被梗卡引用——移出或改写成可引用形式",
            evidence: [{ source: "journal:12", quote: "梗卡 v3 未引用 kb/market/structure" }],
            patch: {
              kind: "set-tool", kit: "topic", op: "find-trope",
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
    // topic 出厂 policy.adapt=off（只观测，N2 显式不落 overlay）——本用例锁的是
    // 「apply 边界」，须经 flow@3 的 policy 旋钮 set-policy:adapt 提升为 propose 后再验。
    fs.writeFileSync(
      path.join(pd, "registry", "overlay.json"),
      JSON.stringify({
        format: "flow-overlay@1", flowId: "topic", origin: "user",
        reason: "开启自动提案通道以验 apply 边界",
        patches: [{ kind: "set-policy", key: "adapt", value: "propose", status: "applied", reason: "用例前置" }],
      }, null, 2) + "\n",
      "utf-8",
    );

    const { report, mineStructural } = kernel.flowOptimize("p-mine2", { apply: true, actor: "test" });
    expect(report.sources).toEqual(["metrics", "miner"]);
    const m = report.proposals.find((p) => p.id === "Mctx@topic.find-trope");
    expect(m).toBeTruthy();
    expect(m?.risk).toBe("medium"); // 质性提案不享受自动落地
    expect(m?.title).toContain("挖掘");
    // 结构类只进拍板清单
    expect(mineStructural.map((s) => s.id)).toContain("Mstruct@parallel");
    // 落地边界：M@ 提案 risk=medium → 即使 --apply 也 proposed；结构类完全不在 overlay 里
    const ov = JSON.parse(fs.readFileSync(path.join(pd, "registry", "overlay.json"), "utf-8"));
    const ids = ov.patches.map((p: { proposal?: string }) => p.proposal);
    expect(ids).toContain("Mctx@topic.find-trope");
    const mPatch = ov.patches.find((p: { proposal?: string }) => p.proposal === "Mctx@topic.find-trope");
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
    await kernel.flow_run("topic", "p-mine3", { route: "hot", region: "CN", direction: "脏 findings 用例" });

    const bad = path.join(pd, "registry", "miner-findings.json");
    fs.mkdirSync(path.join(pd, "registry"), { recursive: true });
    fs.writeFileSync(bad, JSON.stringify({ format: "not-mine", findings: [] }), "utf-8");
    expect(() => kernel.flowOptimize("p-mine3")).toThrow(/format 非法/);

    fs.writeFileSync(bad, JSON.stringify({ format: "miner-findings@1", flowId: "other-flow", findings: [] }), "utf-8");
    expect(() => kernel.flowOptimize("p-mine3")).toThrow(/属于流 other-flow/);
  });
});
