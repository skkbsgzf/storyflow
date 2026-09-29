import { describe, expect, it } from "vitest";
import { buildFlowExport, buildProjectExport, renderMermaid, renderRunbook } from "../src/export-cli.js";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** 找一个真实存在的项目做生效面用例（CI 环境可能没有 projects/ 时跳过）。 */
function anyProject(): string | undefined {
  try {
    const dir = join(process.cwd(), "..", "projects");
    return readdirSync(dir).find((d) => existsSync(join(dir, d, "state.json")));
  } catch {
    return undefined;
  }
}

describe("flow-export · 生效编排导出适配器（单源：内核真身展开）", () => {
  const g = buildFlowExport("topic-selection");

  it("模板面：展开自内核真身——节点非空、agent 节点带 kit.op、边齐全", () => {
    expect(g.nodes.length).toBeGreaterThan(0);
    expect(g.nodes.some((n) => n.kit && n.op)).toBe(true);
    expect(g.edges.length).toBeGreaterThan(0);
    expect(g.edges.every((e) => g.nodes.some((n) => n.id === e.from && n.id))).toBe(true);
  });

  it("输入面透传 flow.inputs 声明（含 enum），R8 必表态标注进 runbook", () => {
    const md = renderRunbook(g);
    const route = g.inputs.find((i) => i.name === "route");
    expect(route).toBeDefined();
    expect(route!.enum).toBeTruthy();
    expect(md).toContain("必表态");
  });

  it("mermaid：flowchart 头 + 节点与边逐条在图", () => {
    const mm = renderMermaid(g);
    expect(mm.startsWith("flowchart TD")).toBe(true);
    for (const n of g.nodes.slice(0, 3)) expect(mm).toContain(n.id);
    expect(mm.split("\n").filter((l) => l.includes("-->")).length).toBeGreaterThanOrEqual(g.edges.length);
  });

  it("runbook：单源声明 + 禁止回写 + 派生单源纪律文案", () => {
    const md = renderRunbook(g);
    expect(md).toContain("只读导出");
    expect(md).toContain("禁止作为编辑目标回写");
    expect(md).toContain("flow_next");
  });

  it("生效面（项目）：与模板面同构，且 source 标记 project", () => {
    const pid = anyProject();
    if (!pid) return; // 环境无项目时跳过
    const p = buildProjectExport(pid);
    expect(p.source.mode).toBe("project");
    expect(p.nodes.length).toBeGreaterThan(0);
    expect(p.nodes.some((n) => n.kit && n.op)).toBe(true);
  });
});
