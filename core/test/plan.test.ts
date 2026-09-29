import { describe, expect, it } from "vitest";
import { compilePlan, PlanCycleError } from "../src/plan.js";
import { isBackEdge } from "../src/cond.js";
import { expandedFlow } from "./helpers.js";
import type { FlowDescriptor } from "../src/types.js";

const topicFlow = (): FlowDescriptor => expandedFlow("topic");

/** 手写图小夹具：验证 compilePlan 的边谓词/节点开关机制（不绑任何真实 flow 的拓扑）。 */
function synthFlow(over: Partial<FlowDescriptor> = {}): FlowDescriptor {
  return {
    format: "flow@2",
    id: "t-synth",
    title: "t",
    version: "0",
    inputs: {},
    graph: {
      nodes: {
        a: { kind: "agent" },
        b: { kind: "agent" },
        c: { kind: "agent" },
      },
      edges: [
        { id: "e1", from: "a", to: "b", role: "flow" },
        { id: "e2", from: "a", to: "c", role: "flow", when: { input: "route", eq: "dual" } },
      ],
    },
    ...over,
  } as FlowDescriptor;
}

function topoValid(flow: FlowDescriptor, order: string[]): boolean {
  const pos = new Map(order.map((id, i) => [id, i]));
  for (const e of flow.graph.edges) {
    // 回边（loop / reject）不进前向计划，拓扑无关（规范 R4 §5.2）
    if (isBackEdge(e)) continue;
    if (pos.has(e.from) && pos.has(e.to) && pos.get(e.from)! >= pos.get(e.to)!) return false;
  }
  return true;
}

describe("compilePlan · topic（flow@3 派生图）", () => {
  it("模块链全量进计划，跨模块次序与 link 门位正确", () => {
    const flow = topicFlow();
    const order = compilePlan(flow, { route: "hot", direction: "x" });
    expect(order).toContain("m1.topic-report");
    expect(order).toContain("m5.link");
    expect(order.length).toBe(Object.keys(flow.graph.nodes).length);
    expect(topoValid(flow, order)).toBe(true);
    const idx = (id: string) => order.indexOf(id);
    // 模块内派生序：报告 → 找梗 → 热点锚
    expect(idx("m1.find-trope")).toBeGreaterThan(idx("m1.topic-report"));
    expect(idx("m1.topic-zeitgeist")).toBeGreaterThan(idx("m1.find-trope"));
    // 跨模块：link 门落在两模块终端与入口之间（m2.link 先于方案链）
    expect(idx("m2.link")).toBeGreaterThan(idx("m1.internet-feel"));
    expect(idx("m2.topic-analysis-report")).toBeGreaterThan(idx("m2.link"));
    expect(idx("m3.link")).toBeGreaterThan(idx("m2.topic-chief-aesthetic"));
    expect(idx("m4.ghostwrite")).toBeGreaterThan(idx("m3.link"));
  });

  it("边级 when 不活跃 → 支线退出计划，且不出现假源点", () => {
    // 原 route=dual 支线（baseline）语义已折算入模块装配；机制改用合成夹具断言
    const flow = synthFlow();
    expect(compilePlan(flow, { route: "dual" })).toContain("c");
    const off = compilePlan(flow, { route: "hot" });
    expect(off).not.toContain("c");
    // 裁掉的纯支线不得变成假源点（plan.ts 源点判定注释所指的坑）
    expect(off).toEqual(["a", "b"]);
  });

  it("节点级 when 开关随输入进出计划；未知 when 表达式保守裁剪", () => {
    const flow = synthFlow();
    flow.graph.nodes.c.when = { input: "支线", eq: "on" };
    expect(compilePlan(flow, { route: "dual", 支线: "on" })).toContain("c");
    expect(compilePlan(flow, { route: "dual", 支线: "off" })).not.toContain("c");
    // 不可解析字符串谓词 = 不活跃（不静默放行）
    const opaque = synthFlow({
      graph: {
        nodes: { a: { kind: "agent" }, b: { kind: "agent" } },
        edges: [{ id: "e1", from: "a", to: "b", role: "flow", when: "还有未写章" as never }],
      },
    } as never);
    expect(compilePlan(opaque, {})).toEqual(["a"]); // b 是支线：边不活跃 → 整支退出，不造假源点
  });
});

describe("compilePlan · 环防御", () => {
  it("成环图抛 PlanCycleError", () => {
    const flow: FlowDescriptor = {
      format: "flow@2",
      id: "t-cycle",
      title: "t",
      version: "0",
      inputs: {},
      graph: {
        nodes: {
          a: { kind: "novel-txt", file: "x.md" },
          b: { kind: "agent" },
          c: { kind: "agent" },
        },
        edges: [
          { id: "e1", from: "a", to: "b" },
          { id: "e2", from: "b", to: "c" },
          { id: "e3", from: "c", to: "b" },
        ],
      },
    };
    expect(() => compilePlan(flow, {})).toThrow(PlanCycleError);
  });
});
