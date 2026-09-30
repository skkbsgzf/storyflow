import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runCoreNode } from "../src/minitools.js";
import type { FlowDescriptor, RunState } from "../src/types.js";
import { rootOf } from "../src/schema.js";

/** R6 · 内核 minitool 直测（M1 四件 + 未实现守卫）。项目夹具 = mkdtemp，世界书/稿本手工捏。 */
function makeProject(): string {
  const pd = fs.mkdtempSync(path.join(os.tmpdir(), "miniflow-mt-"));
  fs.mkdirSync(path.join(pd, "registry"), { recursive: true });
  fs.writeFileSync(path.join(pd, "state.json"), JSON.stringify({ runId: "r-mt", nodes: {} }), "utf-8");
  return pd;
}

function flowOf(node: Record<string, unknown>): FlowDescriptor {
  return { graph: { nodes: { n1: { kind: "core", output: "registry/receipts/x.json", ...node } }, edges: [] } } as never;
}

const state = { runId: "r-mt", projectId: "p-mt", status: "running", nodes: {} } as never as RunState;

describe("minitools · continuity_slice（台账切片）", () => {
  it("人物状态/伏笔台账/章账 handoff 全部切进收据", async () => {
    const pd = makeProject();
    fs.mkdirSync(path.join(pd, "世界书", "人物"), { recursive: true });
    fs.mkdirSync(path.join(pd, "世界书", "伏笔"), { recursive: true });
    fs.mkdirSync(path.join(pd, "世界书", "编年"), { recursive: true });
    fs.writeFileSync(path.join(pd, "世界书", "人物", "张三.md"), "# 张三\n状态：重伤潜伏", "utf-8");
    fs.writeFileSync(
      path.join(pd, "世界书", "伏笔", "台账.md"),
      "| 编号 | 内容 | 埋点 | 预定回收 | 状态 |\n|---|---|---|---|---|\n| f1 | 玉佩裂纹 | 第1章 | 第3章 | open |",
      "utf-8",
    );
    fs.writeFileSync(path.join(pd, "世界书", "编年", "章账.md"), "第1章：主角抵达大排档\n第2章：黑厨上门挑衅", "utf-8");
    const res = await runCoreNode(pd, flowOf({ minitool: "continuity_slice" }), state, "n1");
    expect(res.ok).toBe(true);
    const receipt = JSON.parse(fs.readFileSync(path.join(pd, "registry", "receipts", "continuity-slice-n1.json"), "utf-8"));
    expect(receipt.characters).toEqual([{ name: "张三", status: "重伤潜伏", file: "人物/张三.md" }]);
    expect(receipt.promises).toHaveLength(1);
    expect(receipt.promises[0]).toMatchObject({ fid: "f1", status: "open" });
    expect(receipt.timeline.length).toBe(2);
  });

  it("无世界书时收到空切片而非报错（写前查账零基线合法）", async () => {
    const pd = makeProject();
    const res = await runCoreNode(pd, flowOf({ minitool: "continuity_slice" }), state, "n1");
    expect(res.ok).toBe(true);
    const receipt = JSON.parse(fs.readFileSync(path.join(pd, "registry", "receipts", "continuity-slice-n1.json"), "utf-8"));
    expect(receipt.characters).toEqual([]);
  });
});

describe("minitools · continuity_commit（台账结算）", () => {
  it("世界书缺失 = assert 拒绝，不静默放行", async () => {
    const pd = makeProject();
    const res = await runCoreNode(pd, flowOf({ minitool: "continuity_commit" }), state, "n1");
    expect(res.ok).toBe(false);
    expect(res.reason).toContain("世界书");
  });

  it("世界书在 = 结算收据带词条计数", async () => {
    const pd = makeProject();
    fs.mkdirSync(path.join(pd, "世界书"), { recursive: true });
    fs.writeFileSync(path.join(pd, "世界书", "大排档.md"), "# 大排档", "utf-8");
    const res = await runCoreNode(pd, flowOf({ minitool: "continuity_commit" }), state, "n1");
    expect(res.ok).toBe(true);
    const receipt = JSON.parse(fs.readFileSync(path.join(pd, "registry", "receipts", "continuity-commit-n1.json"), "utf-8"));
    expect(receipt.worldbookEntries).toBe(1);
  });
});

describe("minitools · kb_search / dedup（检索与查重）", () => {
  it("稿本关键词命中真实知识库（重生复仇卡应排前）", async () => {
    const pd = makeProject();
    fs.mkdirSync(path.join(pd, "内部", "稿本"), { recursive: true });
    fs.writeFileSync(path.join(pd, "内部", "稿本", "梗卡.md"), "组合关键词：「重生」「复仇」——主角带着前世记忆回炉。", "utf-8");
    const res = await runCoreNode(pd, flowOf({ minitool: "kb_search" }), state, "n1");
    expect(res.ok).toBe(true);
    const receipt = JSON.parse(fs.readFileSync(path.join(pd, "registry", "receipts", "kb-search-n1.json"), "utf-8"));
    expect(receipt.tool).toBe("kb_search");
    expect(receipt.hits.length).toBeGreaterThan(0);
    expect(receipt.hits[0].file).toContain("chongsheng");
    expect(receipt.hits[0].score).toBeGreaterThanOrEqual(2);
  });

  it("dedup 走同一检索面，收据标注 tool=dedup", async () => {
    const pd = makeProject();
    fs.mkdirSync(path.join(pd, "内部", "稿本"), { recursive: true });
    fs.writeFileSync(path.join(pd, "内部", "稿本", "梗卡.md"), "「打脸」名场面清单。", "utf-8");
    const res = await runCoreNode(pd, flowOf({ minitool: "dedup" }), state, "n1");
    expect(res.ok).toBe(true);
    const receipt = JSON.parse(fs.readFileSync(path.join(pd, "registry", "receipts", "kb-search-n1.json"), "utf-8"));
    expect(receipt.tool).toBe("dedup");
  });
});

describe("minitools · 未实现守卫", () => {
  it("planned 级 minitool 保持未执行，不冒充通过", async () => {
    const pd = makeProject();
    const res = await runCoreNode(pd, flowOf({ minitool: "docx_ingest" }), state, "n1");
    expect(res.ok).toBe(false);
    expect(res.kind).toBe("missing");
    expect(res.reason).toContain("未实现");
  });

  it("未声明 minitool 的 core 节点显式回显（ccwd-fq 事故的内核侧哨兵）", async () => {
    const pd = makeProject();
    const res = await runCoreNode(pd, flowOf({}), state, "n1");
    expect(res.ok).toBe(false);
    expect(res.reason).toContain("(未声明)");
  });
});
