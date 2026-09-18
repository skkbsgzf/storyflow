import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ROOT } from "../src/schema.js";
import { kitRegistry } from "../src/kits.js";
import { loadKnowledge, resolveNodeOp, buildTaskPackage } from "../src/assembler.js";
import { renderSpawnPrompt } from "../src/spawn.js";
import type { FlowDescriptor, RunState } from "../src/types.js";

/**
 * kit@1 底座与装载复位（K1）。
 * 回归对象：R1 报告的头号病根——flow 的 agent 节点用 node.kb 声明知识、
 * 内核却只读 core 节点的 node.loads，导致 35 个节点与全部美学卡空转。
 */
describe("kit@1 · 四域注册表", () => {
  it("四域全部加载且无歧义技能", () => {
    const reg = kitRegistry(ROOT);
    // 域是**分类轴**（4 类），kit 是可增的域包——`kits/detect` 与 `kits/tool` 同属 tool 域，
    // 故 domain 数组会出现两个 "tool"。原断言写的是长度（["plot","prose","search","tool"]），
    // 在 detect 落地的提交 fb0f49d 起就已经是红的（存量债，与 D1–D5 无关）。此处改为断言
    // 「域轴不超过这 4 类」+「每个 kit 都能解析」，语义等同且不再随新域包漂移。
    expect([...new Set(reg.all().map((k) => k.domain))].sort()).toEqual(["plot", "prose", "search", "tool"]);
    for (const id of ["search", "plot", "prose", "tool", "detect"]) {
      expect(reg.get(id), `kit ${id} 未加载`).toBeTruthy();
    }
    expect(reg.ambiguousSkills()).toEqual([]);
    expect(reg.get("prose")!.ops["novel-deai"]).toBeTruthy();
  });

  it("显式 kit+op 解析：返回技能与标尺清单", () => {
    const op = kitRegistry(ROOT).resolve("plot", "scene-breakdown");
    expect(op?.skill).toBe("scene-breakdown");
    expect(op?.knowledge.length).toBeGreaterThan(0);
    // 节点声明与技能自称的并集应在其中（漂移在结构上不可能再发生）
    expect(op?.knowledge).toContain("kb/aesthetic/scene-value");
  });

  it("review 类操作独立标记：plot-redline 归 plot 域", () => {
    const op = kitRegistry(ROOT).bySkill("plot-redline");
    expect(op?.domain).toBe("plot");
    expect(op?.kind).toBe("review");
    expect(op?.knowledge).toContain("kb/aesthetic/perspective-review");
  });

  it("tool 域操作以确定性工具为主体（无技能）", () => {
    const tool = kitRegistry(ROOT).get("tool")!;
    expect(tool.ops["prose-scan"]?.script).toBe("tools/prose-scan.py");
    expect(tool.ops["kb_load"]?.minitools).toContain("kb_load");
  });
});

describe("kit@1 · 标尺装载", () => {
  it("卡片带来源注记，缺失条目显式回显（不再静默丢弃）", () => {
    const r = loadKnowledge(ROOT, ["kb/craft/prose-constraints", "kb/does-not-exist"]);
    expect(r.cards.length).toBe(1);
    expect(r.text).toContain("<!-- source: knowledge/craft/prose-constraints.md -->");
    expect(r.cards[0]!.chars).toBeGreaterThan(100);
    expect(r.missing).toEqual(["kb/does-not-exist"]);
  });

  it("总量封顶：超过预算的条目记入缺口而非静默吞掉", () => {
    const many = Array.from({ length: 40 }, () => "kb/benchmark");
    const r = loadKnowledge(ROOT, many);
    expect(r.text.length).toBeLessThanOrEqual(9000 + 400); // 段间分隔余量
    expect(r.missing.length).toBeGreaterThan(0);
  });

  it("glob 展开：kb/benchmark/* 装载整个目录，且回执是精确条目 id", () => {
    const r = loadKnowledge(ROOT, ["kb/benchmark/*"]);
    expect(r.cards.length).toBeGreaterThan(5);
    expect(r.cards[0]!.id).toMatch(/^kb\/benchmark\/b\d{3}-/); // 非通配符：可核对装了哪几张
    expect(r.cards[0]!.path).toMatch(/^knowledge\/benchmark\//);
  });
});

describe("kit@1 · 任务包装载复位", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "miniflow-kit-"));
  const projectDir = path.join(tmp, "projects", "p-kit");
  fs.mkdirSync(projectDir, { recursive: true });

  const flow = {
    format: "flow@1",
    id: "t-kit",
    title: "装载复位测试流",
    version: "0.1.0",
    graph: {
      nodes: {
        src: { kind: "novel-txt", title: "上游", file: "上游.md" },
        assemble: {
          kind: "agent",
          title: "成文师",
          skill: "prose-assembler",
          kit: "prose",
          op: "prose-assembler",
          file: "正文.md",
          desc: "拼装正文（标尺随包下发）",
        },
      },
      edges: [{ id: "e1", from: "src", to: "assemble" }],
      outputs: ["assemble"],
    },
    stages: [],
  } as unknown as FlowDescriptor;

  const state = {
    runId: "r1",
    projectId: "p-kit",
    flowId: "t-kit",
    flowVersion: "0.1.0",
    nodes: { src: { status: "done", round: 1 } },
    gate: { verdict: "none" },
  } as unknown as RunState;

  it("节点解析：显式 kit/op 优先", () => {
    expect(resolveNodeOp(flow.graph.nodes["assemble"]!)?.op).toBe("prose-assembler");
  });

  it("旧节点（仅 skill）按技能反查，自动补上标尺", () => {
    const legacy = { kind: "agent", skill: "prose-assembler" } as never;
    expect(resolveNodeOp(legacy)?.kit).toBe("prose");
  });

  it("判定标尺进指令正文，且回执可核对", () => {
    const pkg = buildTaskPackage(projectDir, flow, state, "assemble");
    expect(pkg.knowledge?.length).toBeGreaterThan(0);
    expect(pkg.kitRef).toEqual({
      kit: "prose",
      op: "prose-assembler",
      domain: "prose",
      skill: "prose-assembler",
      kind: "produce",
    });
    expect(pkg.instruction.text).toContain("## 判定标尺");
    expect(pkg.instruction.text).toContain("kb/craft/prose-constraints");
    // 标尺卡的实际内容（不是只有标题）——这是 R1 断路的直接验收点
    expect(pkg.instruction.text).toContain("source: knowledge/craft/prose-constraints.md");
  });

  it("派发头渲染标尺清单与自检要求", () => {
    const pkg = buildTaskPackage(projectDir, flow, state, "assemble");
    const prompt = renderSpawnPrompt(pkg);
    expect(prompt).toContain("【判定标尺");
    expect(prompt).toContain("域：prose");
    expect(prompt).toContain("交付前逐条对照");
  });
});
