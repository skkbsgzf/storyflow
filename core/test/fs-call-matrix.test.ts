/**
 * 工单 R5 第 1–2 条 · 调用矩阵销账的**运行时证据**
 *
 * 这三处读路径（`kb.ts` / 世界书两视图 / `continuity_slice`）在普查面上早就没有 `node:fs`
 * （`grep -rlE "node:(fs|path|child_process)" core/src` 的 9 个文件里没它们），但「不 import」不等于
 * 「吃注入」——真正的判据是**把它挂到内存盘上跑一遍，宿主盘一条都不许多**。
 * 所以本文件用 `MockFsAdapter` 跑 verb 面与 minitool 面，跑完再断言宿主盘上没出现那个假根。
 *
 * 门禁原文：worldbook_search / kb_search / continuity_slice 全通。这里三个都从**表**里进
 * （`VERB_BY_NAME[…].run(kernel, args)`），不在测试里另开一条内部通道。
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MockFsAdapter, MockPathAdapter } from "../src/abstraction/adapters/mock.js";
import { Kernel } from "../src/kernel.js";
import { VERB_BY_NAME } from "../src/verbs.js";
import { runCoreNode } from "../src/minitools.js";
import type { FlowDescriptor, RunState } from "../src/types.js";

const DATA_ROOT = "/mock-r5-data";
const KB_CARD = `---
{
  "id": "kb/aesthetic/curve-r5",
  "title": "情绪曲线标准（六型判别）",
  "tags": ["curve", "pacing"]
}
---

# 情绪曲线标准

全剧情绪曲线类型可判明，且无失衡段。
`;

const WB_GRAPH = JSON.stringify({
  format: "worldbook-graph@1",
  built_at: "2026-09-30 00:00",
  entries: [
    { id: "w-craft", cat: "设定", title: "慢工出细活", status: "active", tags: ["手艺"], links: ["w-price"], summary: "先洗后剪的体面。", path: "世界书/设定/w-craft.md" },
    { id: "w-price", cat: "设定", title: "契约代价", status: "active", tags: ["代价"], links: [], summary: "每分力量都记账。", path: "世界书/设定/w-price.md" },
  ],
  relations: [{ a: "w-craft", b: "w-price", src: "link", weight: 3 }],
});

/** 内存盘上的一个已开跑项目 + 一份语料根（两个根都在假盘里，宿主盘不参与）。 */
function mockKernel(pid: string): { kernel: Kernel; projectDir: string; mock: MockFsAdapter } {
  const mock = new MockFsAdapter(DATA_ROOT);
  const mp = new MockPathAdapter();
  mock.seed({
    [`${DATA_ROOT}/projects/${pid}/state.json`]: JSON.stringify({ runId: "r1", projectId: pid, status: "running", nodes: {} }),
    [`${DATA_ROOT}/projects/${pid}/世界书/graph.json`]: WB_GRAPH,
    [`${DATA_ROOT}/projects/${pid}/世界书/人物/张三.md`]: "# 张三\n状态：重伤潜伏\n",
    [`${DATA_ROOT}/projects/${pid}/世界书/伏笔/台账.md`]: "| 编号 | 内容 | 埋点 | 预定回收 | 状态 |\n|---|---|---|---|---|\n| f1 | 玉佩裂纹 | 第1章 | 第3章 | open |\n",
    [`${DATA_ROOT}/projects/${pid}/世界书/编年/章账.md`]: "第1章：抵达\n第2章：挑衅\n",
    [`${DATA_ROOT}/knowledge/aesthetic/curve-r5.md`]: KB_CARD,
    [`${DATA_ROOT}/knowledge/index.json`]: JSON.stringify({ entries: [{ id: "kb/aesthetic/curve-r5", file: "aesthetic/curve-r5.md" }] }),
  });
  const kernel = new Kernel({ root: DATA_ROOT, repoRoot: DATA_ROOT, fs: mock, path: mp });
  return { kernel, projectDir: `${DATA_ROOT}/projects/${pid}`, mock };
}

/**
 * 宿主盘探针：`/mock-r5-data` 在 Windows 上会 resolve 成当前盘根下的真目录
 * （`path.resolve` 实测 `D:\mock-r5-data`）。写路径漏传注入 = 那儿凭空长出一棵树，
 * 这条断言就是那棵树——和 R3 冒烟的「宿主盘无泄漏目录」同一把尺。
 */
function hostLeak(): string | undefined {
  const probe = path.resolve(DATA_ROOT);
  return fs.existsSync(probe) ? probe : undefined;
}

describe("R5 · 世界书与 KB 的读路径吃注入适配器（内存盘 verb 面）", () => {
  it("worldbook_search：动词从表里进，图在内存盘上，一跳扩展照常", async () => {
    const { kernel } = mockKernel("p-r5-wb");
    const run = VERB_BY_NAME.worldbook_search?.run;
    expect(run, "表里没有 worldbook_search").toBeTruthy();
    const out = (await run!(kernel, { project: "p-r5-wb", q: "慢工出细活" })) as {
      hits: { id: string; title?: string; relations?: { with: string }[] }[];
      expansion: { id: string; from: string }[];
    };
    expect(out.hits.map((h) => h.id)).toEqual(["w-craft"]);
    // 一跳扩展在 expansion 面（不是 hits）：内存盘上的 graph.json 关系边照样走得通
    expect(out.expansion.map((e) => e.id)).toEqual(["w-price"]);
    expect(out.expansion[0]?.from).toBe("w-craft");
    expect(out.hits[0]?.relations?.map((r) => r.with)).toEqual(["w-price"]);
    expect(hostLeak()).toBeUndefined();
  });

  it("kb_search：检索 repoRoot/knowledge（同一个内存盘），不回落宿主语料", async () => {
    const { kernel } = mockKernel("p-r5-kb");
    const run = VERB_BY_NAME.kb_search?.run;
    expect(run, "表里没有 kb_search").toBeTruthy();
    const out = (await run!(kernel, { q: "情绪曲线" })) as { total: number; hits: { id: string; score: number }[] };
    expect(out.hits.map((h) => h.id)).toEqual(["kb/aesthetic/curve-r5"]);
    expect(out.hits[0]?.score).toBeGreaterThanOrEqual(8);
    expect(hostLeak()).toBeUndefined();
  });

  it("continuity_slice：minitool 直调吃传入 fs/path，切片收据落在内存盘", async () => {
    const { kernel, projectDir, mock } = mockKernel("p-r5-cont");
    const flow = {
      graph: { nodes: { n1: { kind: "core", minitool: "continuity_slice", output: "registry/receipts/x.json" } }, edges: [] },
    } as never as FlowDescriptor;
    const state = { runId: "r1", projectId: "p-r5-cont", status: "running", nodes: {} } as never as RunState;
    const res = await runCoreNode(projectDir, flow, state, "n1", {}, kernel.fs, kernel.path, kernel.proc);
    expect(res.ok).toBe(true);
    const receipt = JSON.parse(mock.readText(`${projectDir}/registry/receipts/continuity-slice-n1.json`)) as {
      characters: { name: string; status: string }[];
      promises: { fid: string }[];
      timeline: string[];
    };
    expect(receipt.characters).toEqual([{ name: "张三", status: "重伤潜伏", file: "人物/张三.md" }]);
    expect(receipt.promises.map((p) => p.fid)).toEqual(["f1"]);
    expect(receipt.timeline).toEqual(["第1章：抵达", "第2章：挑衅"]);
    expect(hostLeak()).toBeUndefined();
  });
});
