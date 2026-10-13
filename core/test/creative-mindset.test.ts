import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { rootOf } from "../src/schema.js";
import { nodeFs, nodePath } from "../src/abstraction/defaults.js";
import type { IFileSystem } from "../src/abstraction/fs.js";
import { buildTaskPackage, creativeMindsetSection } from "../src/assembler.js";
import type { FlowDescriptor, RunState } from "../src/types.js";

/**
 * 创作思维切换（批次4）：produce 类节点的任务包自动附「创作模式」段——
 * 规则是地基不是视野，任务包第一段话定视角。本组钉三件事：
 * ① produce 节点注入且在指令最前；② 非 produce 节点（review/无 op）零变化（additive）；
 * ③ 卡缺失降级——knowledge/ 是 gitignore 本地层，缺卡不崩、不记缺口，内联段自足。
 */
describe("创作模式注入 · produce 任务包（批次4）", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "miniflow-kit-cm-"));
  const projectDir = path.join(tmp, "projects", "p-cm");
  fs.mkdirSync(projectDir, { recursive: true });

  const flow = {
    format: "flow@2",
    id: "t-cm",
    title: "创作模式注入测试流",
    version: "0.1.0",
    graph: {
      nodes: {
        src: { kind: "novel-txt", title: "上游素材", file: "素材.md" },
        assemble: {
          kind: "agent",
          title: "成文师",
          skill: "prose-assembler",
          kit: "prose",
          op: "prose-assembler",
          file: "正文.md",
          desc: "拼装正文",
        },
        redteam: {
          kind: "agent",
          title: "剧情红队",
          skill: "plot-redline",
          kit: "plot",
          op: "plot-redline",
          file: "红队报告.md",
          desc: "对抗式打分",
        },
      },
      edges: [
        { id: "e1", from: "src", to: "assemble" },
        { id: "e2", from: "assemble", to: "redteam" },
      ],
      outputs: ["redteam"],
    },
    stages: [],
  } as unknown as FlowDescriptor;

  const state = (extra: Record<string, { status: string }>) =>
    ({
      runId: "r1",
      projectId: "p-cm",
      flowId: "t-cm",
      flowVersion: "0.1.0",
      nodes: { src: { status: "done", round: 1 }, ...extra },
      gate: { verdict: "none" },
    }) as unknown as RunState;

  it("produce 节点：创作模式段在指令最前（第一段话定视角），判定标尺随其后", () => {
    const pkg = buildTaskPackage(projectDir, flow, state({ assemble: { status: "none" } }), "assemble");
    expect(pkg.instruction.text.startsWith("## 创作模式")).toBe(true);
    expect(pkg.instruction.text).toContain("放下验收眼光");
    expect(pkg.instruction.text).toContain("规则是地基，不是视野");
    // 本仓卡在库（本地层）：附全文指针
    expect(pkg.instruction.text).toContain("kb_read kb/method/creative-mindset");
    const mindset = pkg.instruction.text.indexOf("创作模式");
    const rules = pkg.instruction.text.indexOf("## 判定标尺");
    expect(mindset).toBeGreaterThanOrEqual(0);
    expect(rules).toBeGreaterThan(mindset);
  });

  it("非 produce 节点零变化（additive）：review op 与无 op 节点都不带创作模式段", () => {
    const review = buildTaskPackage(projectDir, flow, state({ assemble: { status: "done" } }), "redteam");
    expect(review.instruction.text).not.toContain("创作模式");
    const noOp = buildTaskPackage(projectDir, flow, state({}), "src");
    expect(noOp.instruction.text).not.toContain("创作模式");
  });

  it("降级：卡缺失（本地层未挂）时内联段自足、无全文指针、不崩不记缺口", () => {
    // 只挡卡文件一个点的薄桩：exists 对卡路径回 false，其余如实转发
    const absentFs: IFileSystem = new Proxy(nodeFs, {
      get(target, prop, recv) {
        if (prop === "exists") {
          return (p: string) =>
            p.replaceAll("\\", "/").endsWith("knowledge/method/creative-mindset.md")
              ? false
              : (Reflect.get(target, prop, recv) as (x: string) => boolean)(p);
        }
        return Reflect.get(target, prop, recv);
      },
    }) as IFileSystem;
    const degraded = buildTaskPackage(projectDir, flow, state({ assemble: { status: "none" } }), "assemble", undefined, null, absentFs, nodePath);
    expect(degraded.instruction.text.startsWith("## 创作模式")).toBe(true);
    expect(degraded.instruction.text).toContain("放下验收眼光");
    expect(degraded.instruction.text).not.toContain("kb_read kb/method/creative-mindset");
    // 缺的是全文指针，不是思维段——不得作为缺口回显（区别于判定标尺的缺失显式回显）
    expect(degraded.instruction.text).not.toContain("creative-mindset（声明了却不存在");
  });

  it("段函数单测：卡在库带指针，卡不在库给内联提示，两态都含浓缩宣言", () => {
    const root = rootOf();
    const withCard = creativeMindsetSection(root);
    expect(withCard).toContain("全文见 kb_read kb/method/creative-mindset");
    const stub = { exists: () => false } as unknown as IFileSystem;
    const withoutCard = creativeMindsetSection(root, stub, nodePath);
    expect(withoutCard).toContain("放下验收眼光");
    expect(withoutCard).toContain("内联浓缩段");
    expect(withoutCard).not.toContain("kb_read");
  });
});
