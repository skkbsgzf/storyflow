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
 * 能力注册表（批D 起：单一事实源 = modules/）与装载复位（K1）。
 * 回归对象：R1 报告的头号病根——flow 的 agent 节点用 node.kb 声明知识、
 * 内核却只读 core 节点的 node.loads，导致 35 个节点与全部美学卡空转。
 */
describe("能力注册表 · modules/ 单一事实源（批D：kit@1 已清场）", () => {
  it("9 模块全部加载，域轴收敛为 module", () => {
    const reg = kitRegistry(ROOT);
    // 批D：kits/ 目录删除后 domain 只剩模块装载的 "module"——四域分类轴随 kit@1 退役
    // （能力之家 = 模块，工种域由 caps/skeleton 表达）。
    expect([...new Set(reg.all().map((k) => k.domain))]).toEqual(["module"]);
    for (const id of ["search", "plot", "prose", "topic", "plan", "delivery", "drama", "detect", "base"]) {
      expect(reg.get(id), `module ${id} 未加载`).toBeTruthy();
    }
    expect(reg.get("prose")!.ops["novel-deai"]).toBeTruthy();
    // 原 kits/search 的认知工具并入 modules/search 单一权威（批D 前是 op 级补缺合并）
    expect(reg.get("topic")!.ops["find-trope"]).toBeTruthy();
    expect(reg.get("search")!.ops["kb_load"]).toBeTruthy();
  });

  it("bySkill 歧义台账：scene-breakdown 双家（plot 骨架步 + drama 主工具）——W8 记账，不阻断", () => {
    const reg = kitRegistry(ROOT);
    // 批D 口径：铁律11 =「必有 ≥1 家」；flow@3 派生节点携 kit+op 直查，反查仅兜底。
    expect(reg.ambiguousSkills()).toEqual(["scene-breakdown"]);
  });

  it("显式 kit+op 解析：返回技能与标尺清单", () => {
    const op = kitRegistry(ROOT).resolve("plot", "scene-breakdown");
    expect(op?.skill).toBe("scene-breakdown");
    expect(op?.knowledge.length).toBeGreaterThan(0);
    // 节点声明与技能自称的并集应在其中（漂移在结构上不可能再发生）
    expect(op?.knowledge).toContain("kb/aesthetic/scene-value");
  });

  it("review 类操作独立标记：plot-redline 归 plot 模块", () => {
    const op = kitRegistry(ROOT).bySkill("plot-redline");
    expect(op?.domain).toBe("module");
    expect(op?.kind).toBe("review");
    expect(op?.knowledge).toContain("kb/aesthetic/perspective-review");
  });

  it("确定性工具以 minitools/script 为主体（无技能）——批D：检测件归 detect，检索基建归 search", () => {
    expect(kitRegistry(ROOT).get("detect")!.ops["prose-scan"]?.script).toBe("tools/prose-scan.py");
    expect(kitRegistry(ROOT).get("search")!.ops["kb_load"]?.minitools).toContain("kb_load");
  });
});

describe("断言台账归档与规则语料化（v5.0：声明式协议退役，台账转语料档案）", () => {
  const ARCHIVE = path.join(ROOT, "projects", "_archived", "assertions-ledger-v5.0.0", "assertions.json");
  const ledger = JSON.parse(fs.readFileSync(ARCHIVE, "utf-8")) as {
    asserts: { name?: string; id?: string; checks_via?: string }[];
  };
  const names = new Set(ledger.asserts.map((a) => a.name));

  it("repo 内旧台账已清场（只读归档在 projects/_archived/，双份台账=漂移）", () => {
    expect(fs.existsSync(path.join(ROOT, "knowledge", "aesthetic", "assertions.json"))).toBe(false);
  });

  it("归档台账可读：标识字段只有 name（批C 单字段名口径），且无重复", () => {
    expect(ledger.asserts.length).toBeGreaterThanOrEqual(90);
    expect(ledger.asserts.every((a) => typeof a.name === "string" && a.name)).toBe(true);
    expect(ledger.asserts.every((a) => a.id === undefined)).toBe(true);
    expect(names.size).toBe(ledger.asserts.length);
  });

  it("引擎扫描器发出的每个 id 都在归档台账（T 轨收据可溯源；小写子项如 #tailhook 不得从正则漏掉）", () => {
    const src = fs.readFileSync(path.join(ROOT, "core", "src", "aesthetic.ts"), "utf-8");
    const engine = new Set([...src.matchAll(/"(AE-[A-Za-z0-9#-]+)"/g)].map((m) => m[1]!.split("#")[0]));
    expect(engine.size).toBeGreaterThanOrEqual(14);
    expect([...engine].filter((e) => !names.has(e))).toEqual([]);
  });

  it("modules/ 声明的 io.acceptance.scans 全部可溯源到归档台账（扫描名不许哑）", () => {
    const modsDir = path.join(ROOT, "modules");
    const unknown: string[] = [];
    for (const d of fs.readdirSync(modsDir)) {
      const f = path.join(modsDir, d, "module.json");
      if (!fs.existsSync(f)) continue;
      const mod = JSON.parse(fs.readFileSync(f, "utf-8"));
      for (const s of mod?.io?.acceptance?.scans ?? []) {
        if (!names.has(String(s).split("#")[0])) unknown.push(`${d}:${s}`);
      }
    }
    expect(unknown).toEqual([]);
  });

  it("checks_via 别名目标必须真实在册（别名指向虚空 = 引用链静默降级）", () => {
    const targets = ledger.asserts
      .filter((a) => a.checks_via && a.checks_via !== "self")
      .map((a) => a.checks_via!);
    expect(targets.length).toBeGreaterThan(0);
    expect(targets.filter((t) => !names.has(t))).toEqual([]);
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
