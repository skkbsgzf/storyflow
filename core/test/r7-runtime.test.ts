/**
 * R7 · OS-02A 运行时可中断 / 可恢复 —— 回归测试
 *
 * 覆盖四条过去「声明了但没人读 / 读了但救不回来」的运行时缺口：
 *   ① `flow_resume` 接 `failed` / `blocked`：此前对两者是**空操作**（原样返回 status），
 *      人以为恢复了、实际 run 早停了；
 *   ② 连接件驳回**封顶**（`policy.maxRounds`）：此前「驳回→重跑上游→再撞同一门→再驳回」
 *      无上限，只能靠人肉盯；
 *   ③ `blocked` 是屏障不是终态：`flow_next` 不许自动越过去（静默自动推进比停机坏得多）；
 *   ④ `policy.awaitTimeoutMs` 到点 → 标 `blocked` + `stalledAt`，**不自动放行**。
 *
 * 夹具说明：这里用一条**合成 flow@2**（a → link1 → b）直接驱动 `doGate` 的 link 分支，
 * 因为 link 连接件只在模块序列（flow@3）里派生、而真 flow@3 需要整套 modules/ 才能展开。
 * 头部契约不是本组被测对象，故置 `MINIFLOW_HEADER_MODE=off`（产物头校验的质量由 artifact-lint 管）。
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Kernel } from "../src/kernel.js";
import { compilePlan } from "../src/plan.js";
import { loadFlow } from "./helpers.js";

process.env.MINIFLOW_HEADER_MODE = "off";

const FLOW_ID = "r7-runtime";

/** 合成流：a(agent) → link1(连接件, manual) → b(agent)；同 kit ⇒ 不派生边界门，隔离被测行为。 */
function writeFlow(root: string, policy: Record<string, unknown>): void {
  const dir = path.join(root, "flows", FLOW_ID);
  fs.mkdirSync(dir, { recursive: true });
  const flow = {
    format: "flow@2",
    id: FLOW_ID,
    title: "R7 运行时可中断/可恢复最小流",
    version: "1.0.0",
    status: "active",
    policy,
    inputs: {},
    outputs: [],
    graph: {
      format: "flow-graph@1",
      name: FLOW_ID,
      nodes: {
        a: { kind: "agent", stage: "S1", title: "A 上游步", skill: "find-trope", kit: "search", op: "find-trope", output: "内部/稿本/a.md" },
        link1: { kind: "gate", stage: "S2", title: "S1 → S2 连接件", gate_role: "link", link_mode: "manual" },
        b: { kind: "agent", stage: "S2", title: "B 下游步", skill: "find-trope", kit: "search", op: "find-trope", output: "内部/稿本/b.md" },
      },
      edges: [
        { id: "e-a-link", from: "a", to: "link1", role: "flow" },
        { id: "e-link-b", from: "link1", to: "b", role: "flow" },
      ],
      outputs: [],
    },
    // 连接件表：rejectedScope 优先按它算「上游模块」，缺省才回落到计划前缀
    r6: {
      modules: [],
      links: [{ id: "link1", fromModule: "m1", toModule: "m2", mode: "manual" }],
      moduleNodes: { m1: ["a"], m2: ["b"] },
      dirs: { m1: "01-上游", m2: "02-下游" },
    },
  };
  fs.writeFileSync(path.join(dir, "flow.json"), JSON.stringify(flow, null, 2) + "\n", "utf-8");
}

/** 产物头（最小合法形状；本组不考头部契约，故只求 doSubmit 收下）。 */
function art(nodeId: string, round = 1): string {
  return [
    "---",
    "artifact: 1",
    `id: search.find-trope`,
    "class: draft",
    `node: ${nodeId}`,
    `round: ${round}`,
    `version: v${round}`,
    "state: draft",
    "at: 2026-09-20 10:00",
    "by: kit/search.find-trope",
    "upstream: []",
    "review: null",
    "---",
    "",
    `# ${nodeId}`,
    "> R7 运行时可中断夹具",
    "",
  ].join("\n");
}

function setup(policy: Record<string, unknown>, projectId = "p-r7"): { k: Kernel; pd: string; pid: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miniflow-r7rt-"));
  writeFlow(root, policy);
  const pd = path.join(root, "projects", projectId);
  fs.mkdirSync(pd, { recursive: true });
  // flowsDir 必须显式指向临时根：kernel 的 repoRoot（modules/knowledge）仍走真仓库，
  // 但流定义来自这里——否则合成流会被当成真仓库里不存在的 flow。
  const k = new Kernel({ root, flowsDir: path.join(root, "flows") });
  return { k, pd, pid: projectId };
}

/** 交 a（轮次从 state 现推，打回后 round 只增，手填极易过期）。 */
async function submitA(k: Kernel, pid: string, pd: string) {
  const round = (readState(pd).nodes.a.round ?? 0) + 1;
  return k.flow_submit(pid, "a", { content: art("a", round) });
}

/** 走到连接件挂起：run → 交 a → link1 等裁决。 */
async function walkToLink(k: Kernel, pid: string, pd: string): Promise<void> {
  const run = await k.flow_run(FLOW_ID, pid, {});
  expect(run.status).toBe("awaiting_input");
  const s = await submitA(k, pid, pd);
  expect(s.next?.status).toBe("suspended");
}

function readState(pd: string) {
  return JSON.parse(fs.readFileSync(path.join(pd, "state.json"), "utf-8")) as {
    status: string;
    plan: { order: string[] };
    gate: { verdict: string; node?: string; at?: string };
    nodes: Record<string, { status: string; round: number; stale?: boolean; verdict?: string }>;
    rejects?: Record<string, number>;
    stalledAt?: string;
    lastRejectReason?: string;
    policy?: Record<string, unknown>;
  };
}

describe("R7 · OS-02A 运行时可中断/可恢复", () => {
  it("连接件驳回 = 重跑上游模块（a 失效，b 不动），且累计计数落盘", async () => {
    const { k, pd, pid } = setup({ maxRounds: 5 });
    await walkToLink(k, pid, pd);

    const r = await k.flow_gate(pid, { nodeId: "link1", verdict: "reject", comment: "上游口径不成立" });
    expect(r.applied).toBe(true);
    expect(r.rollbackScope).toEqual(["a"]);
    // 驳回后上游失效 → 立刻重新派发 a（不是原地打转，也不是跳到 b）
    expect(r.next?.status).toBe("awaiting_input");
    if (r.next?.status !== "awaiting_input") return;
    expect(r.next.nodeId).toBe("a");

    const st = readState(pd);
    expect(st.rejects?.link1).toBe(1);
    expect(st.nodes.a.round).toBeGreaterThan(1);
    expect(st.nodes.b.status).not.toBe("done");
    expect(st.lastRejectReason).toContain("上游口径不成立");
  });

  it("驳回超 policy.maxRounds → blocked（停机等人），不再无限乒乓", async () => {
    const { k, pd, pid } = setup({ maxRounds: 2 });
    await walkToLink(k, pid, pd);

    // 第 1 次驳回：仍在预算内 → 重跑上游 → 重新交卷后照旧挂起在同一门
    const r1 = await k.flow_gate(pid, { nodeId: "link1", verdict: "reject", comment: "第一次" });
    expect(r1.next?.status).toBe("awaiting_input");
    const again = await submitA(k, pid, pd);
    expect(again.next?.status).toBe("suspended");

    // 第 2 次驳回：达上限 → blocked，且不再 advance 出下一次挂起
    const r2 = await k.flow_gate(pid, { nodeId: "link1", verdict: "reject", comment: "第二次" });
    expect(r2.next?.status).toBe("blocked");
    applyBlocked(r2.next);

    const st = readState(pd);
    expect(st.status).toBe("blocked");
    expect(st.rejects?.link1).toBe(2);
    expect(st.lastRejectReason).toContain("maxRounds=2");

    // ③ blocked 是屏障：flow_next 不许自动越过去
    const nx = await k.flow_next(pid);
    expect(nx.status).toBe("blocked");

    // 仍然 2（没被下一次 advance 叠上去）
    expect(readState(pd).rejects?.link1).toBe(2);
  });

  it("flow_resume 接 blocked：清该门驳回计数、重跑上游、回到可推进状态", async () => {
    const { k, pd, pid } = setup({ maxRounds: 1 });
    await walkToLink(k, pid, pd);

    const r = await k.flow_gate(pid, { nodeId: "link1", verdict: "reject", comment: "打回" });
    expect(r.next?.status).toBe("blocked"); // maxRounds=1 ⇒ 首次驳回即封顶
    applyBlocked(r.next);

    const stop = await k.flow_resume(pid);
    expect(stop.status).toBe("awaiting_input"); // 上游 a 重新派发，而不是原样返回 blocked
    if (stop.status !== "awaiting_input") return;
    expect(stop.nodeId).toBe("a");

    const st = readState(pd);
    expect(st.status).toBe("awaiting_input"); // 上游 a 已被重新派发
    expect(st.rejects?.link1).toBeUndefined(); // 人工已介入 → 计数清零重新起算
    expect(st.stalledAt).toBeUndefined();
    expect(st.gate.verdict).toBe("none");
  });

  it("flow_resume 接 failed：门 reject 终止后能救回（此前是空操作）", async () => {
    // 无连接件分支：给一条只有普通门的流，走「非 link 门 reject → failed」
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "miniflow-r7f-"));
    writeFlow(root, {});
    // 把 link1 降级成普通人工门（gate_mode=manual）
    const f = path.join(root, "flows", FLOW_ID, "flow.json");
    const flow = JSON.parse(fs.readFileSync(f, "utf-8")) as {
      graph: { nodes: Record<string, Record<string, unknown>> };
      policy: Record<string, unknown>;
    };
    flow.graph.nodes.link1 = { kind: "gate", stage: "S2", title: "普通人工门" };
    flow.policy = { gate_mode: "manual" };
    delete (flow as { r6?: unknown }).r6;
    fs.writeFileSync(f, JSON.stringify(flow, null, 2) + "\n", "utf-8");

    const pid = "p-r7f";
    const pd = path.join(root, "projects", pid);
    fs.mkdirSync(pd, { recursive: true });
    const k = new Kernel({ root, flowsDir: path.join(root, "flows") });
    await walkToLink(k, pid, pd);

    const rej = await k.flow_gate(pid, { nodeId: "link1", verdict: "reject", comment: "不通过" });
    expect(rej.failed).toBe(true);
    expect(readState(pd).status).toBe("failed");

    // 关键：resume 不再是空操作——重跑该门的上游范围（a），把 run 拉回可推进状态
    const stop = await k.flow_resume(pid);
    expect(stop.status).toBe("awaiting_input");
    if (stop.status !== "awaiting_input") return;
    expect(stop.nodeId).toBe("a");

    const st = readState(pd);
    expect(st.status).toBe("awaiting_input");
    expect(st.gate.verdict).toBe("none");
    expect(st.nodes.link1.status).toBe("pending"); // 门重新待判，但上游 a 没交卷前不开启
  });

  it("policy.awaitTimeoutMs 到点 → blocked + stalledAt，绝不自动放行", async () => {
    const { k, pd, pid } = setup({ awaitTimeoutMs: 1000 });
    await walkToLink(k, pid, pd);
    expect(readState(pd).status).toBe("suspended");
    expect(readState(pd).stalledAt).toBeUndefined(); // 未到点

    // 把门的开启时刻直接推回到 1 小时前（确定性，不靠 sleep）
    const st0 = readState(pd);
    const p = path.join(pd, "state.json");
    const raw = JSON.parse(fs.readFileSync(p, "utf-8")) as Record<string, unknown>;
    (raw.gate as Record<string, unknown>).at = new Date(Date.now() - 3600_000).toISOString();
    fs.writeFileSync(p, JSON.stringify(raw, null, 2) + "\n", "utf-8");
    void st0;

    const nx = await k.flow_next(pid);
    expect(nx.status).toBe("blocked");
    if (nx.status !== "blocked") return;
    expect(nx.reason).toContain("等待超时");
    expect(nx.nodeId).toBe("link1");

    const st = readState(pd);
    expect(st.status).toBe("blocked");
    expect(st.stalledAt).toBeTruthy();

    // 不自动放行：门仍在等裁决，下游 b 没被派发
    expect(st.nodes.link1.status).not.toBe("done");
    expect(st.nodes.b.status).not.toBe("done");
    expect(st.gate.verdict).toBe("awaiting");

    // 人工恢复：resume 清停机标记，回到挂起等裁决
    const stop = await k.flow_resume(pid);
    expect(stop.status).toBe("suspended");
    expect(readState(pd).stalledAt).toBeUndefined();
  });
});

/** 把 blocked 出口的 nodeId/reason 断言集中一处，避免用例里重复 any 断言。 */
function applyBlocked(stop: unknown): void {
  expect((stop as { status: string }).status).toBe("blocked");
  expect((stop as { reason: string }).reason).toBeTruthy();
}

/**
 * R7 · 结构性守卫：真实 flow@3 的生效编排编译出的计划必须**一个不漏**。
 *
 * 起因：`kit_boundary=auto` 曾给边界门挂节点级 when，而 compilePlan 会把不活跃节点的出入边一并裁掉
 * （plan.ts:52）⇒ 下游失去活跃入边 → 不可达 → 计划截断、run 误判 completed。这类「静默断路」在
 * 单条流上肉眼极难发现（节点 status 还是 none，页面看不出异常）。此处直接立规矩：
 * 除显式声明 when 的节点外，图中节点与计划节点必须一一对应。
 */
describe("R7 · 真实 flow@3：计划不得在连接件/边界门处截断", () => {
  it("test-dual / screenplay 的派生节点全部进计划", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "miniflow-r7plan-"));
    const pd = path.join(root, "projects", "p-plan");
    fs.mkdirSync(pd, { recursive: true });
    const k = new Kernel({ root });

    for (const flowId of ["test-dual", "screenplay"]) {
      const eff = k.effectiveOf(pd, loadFlow(flowId));
      const nodes = eff.flow.graph.nodes;
      const order = compilePlan(eff.flow, {}, undefined);
      expect(order.length).toBeGreaterThan(5);
      expect(new Set(order).size).toBe(order.length); // 无重复
      const stranded = Object.keys(nodes).filter((id) => !order.includes(id) && nodes[id].when === undefined);
      expect({ flowId, stranded }).toEqual({ flowId, stranded: [] });
    }
  });
});
