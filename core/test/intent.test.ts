/**
 * 立意图 → 决策单向桥（core/src/intent.ts）：
 * ①committed+decision_key → setDecision 落盘（evidence 带 scorer+p 与「禁当放行闸」明示）；
 * ②已存在不回填（单向桥纪律）；③无 decision_key 跳过；④图不一致进 issues 不静默；
 * ⑤format/universe 身份校验显式抛。
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { loadIntentGraph, syncIntentDecisions, IntentError } from "../src/intent.js";
import { nodeFs, nodePath } from "../src/abstraction/adapters/node.js";

/** 测试走宿主盘：FS1 §四的 io 首参用这套默认适配器。 */
const io = { fs: nodeFs, path: nodePath };

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "intent-"));
}

function writeGraph(root: string, graph: unknown): void {
  const dir = path.join(root, "universes", "u-demo");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "intent-graph.json"), JSON.stringify(graph), "utf-8");
}

const BASE = {
  format: "intent-graph@1",
  universe: "u-demo",
  title: "演示宇宙",
  updated_at: "2026-09-24T00:00:00",
  nodes: [
    {
      id: "liyi-main",
      kind: "立意",
      title: "主立意",
      status: "committed",
      decision_key: "intent-liyi",
      candidates: [
        { id: "c-a", title: "双线账要平", content: "斩妖升官与家训对账双线", scorer: "semif-4b", p: 0.72, evidence: "金标卷", status: "committed" },
        { id: "c-b", title: "纯爽升级流", scorer: "untested", status: "excluded", excluded_reason: "向题材均值收敛" },
      ],
    },
    { id: "renwu-zhujue", kind: "人物", title: "主角", status: "committed", decision_key: "", candidates: [] },
  ],
};

describe("syncIntentDecisions", () => {
  it("committed+decision_key 落决策，证据带 scorer/p 与剪枝明示", () => {
    const root = tmpRoot();
    writeGraph(root, BASE);
    const proj = path.join(root, "projects", "p-demo");
    fs.mkdirSync(proj, { recursive: true });
    const res = syncIntentDecisions(proj, loadIntentGraph(root, "u-demo"), io);
    expect(res.written).toHaveLength(1);
    expect(res.written[0]).toMatchObject({ key: "intent-liyi", node: "liyi-main", candidate: "c-a" });
    const d = JSON.parse(fs.readFileSync(path.join(proj, "decisions", "intent-liyi.json"), "utf-8"));
    expect(d.format).toBe("decision@1");
    expect(d.by).toBe("intent-graph:u-demo#liyi-main/c-a");
    expect(d.picked).toEqual(["双线账要平"]);
    expect(d.evidence).toContain("scorer=semif-4b p=0.72");
    expect(d.evidence).toContain("禁当放行闸");
    expect(d.evidence).toContain("排除候选：c-b"); // excluded 候选 id 可溯源（理由在意图图）
  });

  it("已存在不回填（单向桥）", () => {
    const root = tmpRoot();
    writeGraph(root, BASE);
    const proj = path.join(root, "projects", "p-demo");
    fs.mkdirSync(path.join(proj, "decisions"), { recursive: true });
    fs.writeFileSync(path.join(proj, "decisions", "intent-liyi.json"), '{"format":"decision@1","key":"intent-liyi","by":"调研步","at":"x","picked":["已有的"],"evidence":"先到先得"}', "utf-8");
    const res = syncIntentDecisions(proj, loadIntentGraph(root, "u-demo"), io);
    expect(res.written).toHaveLength(0);
    expect(res.skipped).toContainEqual({ key: "intent-liyi", reason: "决策已存在（单向桥不回填）" });
  });

  it("无 decision_key 的 committed 节点跳过且可解释", () => {
    const root = tmpRoot();
    writeGraph(root, BASE);
    const proj = path.join(root, "projects", "p-demo");
    fs.mkdirSync(proj, { recursive: true });
    const res = syncIntentDecisions(proj, loadIntentGraph(root, "u-demo"), io);
    expect(res.written).toHaveLength(1); // 只有 liyi-main 落
    expect(res.skipped).toContainEqual({ key: "renwu-zhujue", reason: "无 decision_key（节点未声明决策落点）" });
  });

  it("节点 committed 但无 committed 候选 → issues 不静默", () => {
    const root = tmpRoot();
    const g = structuredClone(BASE) as typeof BASE & { nodes: Array<Record<string, unknown>> };
    (g.nodes[0] as { candidates: unknown[] }).candidates = [];
    writeGraph(root, g);
    const proj = path.join(root, "projects", "p-demo");
    fs.mkdirSync(proj, { recursive: true });
    const res = syncIntentDecisions(proj, loadIntentGraph(root, "u-demo"), io);
    expect(res.written).toHaveLength(0);
    expect(res.issues[0]).toContain("无 committed 候选");
  });
});

describe("loadIntentGraph", () => {
  it("缺文件/坏 format/universe 不符显式抛", () => {
    const root = tmpRoot();
    expect(() => loadIntentGraph(root, "u-demo")).toThrow(IntentError);
    writeGraph(root, { ...BASE, format: "intent-graph@2" });
    expect(() => loadIntentGraph(root, "u-demo")).toThrow(/format≠intent-graph@1/);
    writeGraph(root, { ...BASE, universe: "u-other" });
    expect(() => loadIntentGraph(root, "u-demo")).toThrow(/与目录名/);
  });
});
