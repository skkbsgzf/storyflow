import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { compilePlan, PlanCycleError } from "../src/plan.js";
import { isBackEdge } from "../src/cond.js";
import type { FlowDescriptor } from "../src/types.js";
import { ROOT } from "../src/schema.js";

const topicFlow = (): FlowDescriptor =>
  JSON.parse(fs.readFileSync(path.join(ROOT, "flows", "topic-selection", "flow.json"), "utf-8"));

function topoValid(flow: FlowDescriptor, order: string[]): boolean {
  const pos = new Map(order.map((id, i) => [id, i]));
  for (const e of flow.graph.edges) {
    // 回边（loop / reject）不进前向计划，拓扑无关（规范 R4 §5.2）
    if (isBackEdge(e)) continue;
    if (pos.has(e.from) && pos.has(e.to) && pos.get(e.from)! >= pos.get(e.to)!) return false;
  }
  return true;
}

describe("compilePlan · topic-selection", () => {
  it("route=hot 时排除 route=dual 支线（baseline），计划从 src 开始且拓扑有效", () => {
    const flow = topicFlow();
    const order = compilePlan(flow, { route: "hot", direction: "x" });
    // src 与 market 都是并行根（market 是无条件 kb_load，不依赖素材）
    expect(order).toContain("src");
    expect(order).toContain("market");
    expect(order).not.toContain("baseline");
    expect(topoValid(flow, order)).toBe(true);
    // S1 依赖顺序：双根 → tropes/zeitgeist 并行 → combo/benchmark 并行 → analysis 汇合
    const idx = (id: string) => order.indexOf(id);
    expect(idx("tropes")).toBeGreaterThan(idx("src"));
    expect(idx("tropes")).toBeGreaterThan(idx("market"));
    expect(idx("zeitgeist")).toBeGreaterThan(idx("src"));
    expect(idx("combo")).toBeGreaterThan(idx("tropes"));
    expect(idx("benchmark")).toBeGreaterThan(idx("tropes"));
    expect(idx("analysis")).toBeGreaterThan(idx("combo"));
    expect(idx("analysis")).toBeGreaterThan(idx("zeitgeist"));
    expect(idx("analysis")).toBeGreaterThan(idx("benchmark"));
    expect(idx("gate-r1")).toBeGreaterThan(idx("analysis"));
    expect(idx("structure")).toBeGreaterThan(idx("gate-r1"));
  });

  it("批注回流=off 时 intake 不可达；flow 声明之外不出现假源点", () => {
    const flow = topicFlow();
    const order = compilePlan(flow, { route: "hot", direction: "x", 批注回流: "off" });
    expect(order).not.toContain("intake");
    expect(order).toContain("src");
    expect(order).toContain("market");
  });

  it("未知 when 表达式保守裁边（不活跃）", () => {
    const flow = topicFlow();
    const order = compilePlan(flow, { direction: "x" }); // 未绑定 route → route=dual 边不活跃
    expect(order).not.toContain("baseline");
  });
});

describe("compilePlan · 环防御", () => {
  it("成环图抛 PlanCycleError", () => {
    const flow: FlowDescriptor = {
      format: "flow@1",
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
