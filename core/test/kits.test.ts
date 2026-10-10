import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { rootOf } from "../src/schema.js";
import { kitRegistry } from "../src/kits.js";
import { loadKnowledge, resolveNodeOp, buildTaskPackage } from "../src/assembler.js";
import { renderSpawnPrompt } from "../src/spawn.js";
import type { FlowDescriptor, RunState } from "../src/types.js";

/**
 * 能力注册表（批D 起：单一事实源 = modules/）与装载复位（K1）。
 * 回归对象：R1 报告的头号病根——flow 的 agent 节点用 node.kb 声明知识、
 * 内核却只读 core 节点的 node.loads，导致 35 个节点与全部美学卡空转。
 */
describe("能力注册表 · modules/ 单一事实源（批D：kit@1 已清场）", () => {
  it("8 模块全部加载，域轴收敛为 module（v0.8：detect 审核模块退役）", () => {
    const reg = kitRegistry(rootOf());
    // 批D：kits/ 目录删除后 domain 只剩模块装载的 "module"——四域分类轴随 kit@1 退役
    // （能力之家 = 模块，工种域由 caps/skeleton 表达）。v0.8：detect 随审核层退役。
    expect([...new Set(reg.all().map((k) => k.domain))]).toEqual(["module"]);
    for (const id of ["search", "plot", "prose", "topic", "plan", "delivery", "drama", "base"]) {
      expect(reg.get(id), `module ${id} 未加载`).toBeTruthy();
    }
    expect(reg.get("detect")).toBeUndefined();
    expect(reg.get("prose")!.ops["novel-deai"]).toBeTruthy();
    // 原 kits/search 的认知工具并入 modules/search 单一权威（批D 前是 op 级补缺合并）
    expect(reg.get("topic")!.ops["find-trope"]).toBeTruthy();
    expect(reg.get("search")!.ops["kb_load"]).toBeTruthy();
  });

  it("bySkill 歧义台账：scene-breakdown（plot 骨架步 + drama 主工具）——2026-10-10 图文视频冻结后 render-prompt-seedance 仅剩 prose 原生一家，歧义消除——W8 记账，不阻断", () => {
    const reg = kitRegistry(rootOf());
    // 批D 口径：铁律11 =「必有 ≥1 家」；flow@3 派生节点携 kit+op 直查，反查仅兜底。
    // 2026-10-10 批1b：render-prompt-seedance 的 drama 借用声明随图文视频冻结摘除
    // （comfyui-script 预设 patches 同步清空），prose 原生声明保留——歧义只剩 scene-breakdown。
    expect(reg.ambiguousSkills().sort()).toEqual(["scene-breakdown"]);
  });

  it("显式 kit+op 解析：返回技能与标尺清单", () => {
    const op = kitRegistry(rootOf()).resolve("plot", "scene-breakdown");
    expect(op?.skill).toBe("scene-breakdown");
    expect(op?.knowledge.length).toBeGreaterThan(0);
    // 节点声明与技能自称的并集应在其中（漂移在结构上不可能再发生）
    expect(op?.knowledge).toContain("kb/aesthetic/scene-value");
  });

  it("review 类操作独立标记：plot-redline 归 plot 模块", () => {
    const op = kitRegistry(rootOf()).bySkill("plot-redline");
    expect(op?.domain).toBe("module");
    expect(op?.kind).toBe("review");
    expect(op?.knowledge).toContain("kb/aesthetic/perspective-review");
  });

  it("确定性工具以 minitools/script 为主体（无技能）——v0.8：detect 退役，检索基建归 search", () => {
    expect(kitRegistry(rootOf()).get("detect")).toBeUndefined();
    expect(kitRegistry(rootOf()).get("search")!.ops["kb_load"]?.minitools).toContain("kb_load");
  });
});


describe("kit@1 · 标尺装载", () => {
  it("卡片带来源注记，缺失条目显式回显（不再静默丢弃）", () => {
    const r = loadKnowledge(rootOf(), ["kb/craft/prose-constraints", "kb/does-not-exist"]);
    expect(r.cards.length).toBe(1);
    expect(r.text).toContain("<!-- source: knowledge/craft/prose-constraints.md -->");
    expect(r.cards[0]!.chars).toBeGreaterThan(100);
    expect(r.missing).toEqual(["kb/does-not-exist"]);
  });

  it("总量封顶：超过预算的条目记入缺口而非静默吞掉", () => {
    const many = Array.from({ length: 40 }, () => "kb/benchmark");
    const r = loadKnowledge(rootOf(), many);
    expect(r.text.length).toBeLessThanOrEqual(9000 + 400); // 段间分隔余量
    expect(r.missing.length).toBeGreaterThan(0);
  });

  it("glob 展开：kb/benchmark/* 装载整个目录，且回执是精确条目 id", () => {
    const r = loadKnowledge(rootOf(), ["kb/benchmark/*"]);
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
    format: "flow@2",
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
      domain: "module", // 批D：域轴随 kit@1 退役，注册表条目一律 domain="module"
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
    expect(prompt).toContain("域：module");
    expect(prompt).toContain("交付前逐条对照");
  });
});
