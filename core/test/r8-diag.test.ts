/**
 * R8-OPS · 诊断通道（旁路失败留痕）—— 回归测试
 *
 * 被测命题只有一条：**旁路失败不再静默**。
 *
 * 本仓反复复发的那类病（"以为有，其实没有 / 崩掉当没事"）几乎都住在裸 `catch {}` 里：
 *   · N6 —— `contracts/metrics.schema.json` 的 `phase.enum` 漏了 `link` ⇒ `recordMetric` 抛
 *     SchemaViolation ⇒ 被 `kernel.metric` 的 `catch {}`（注释写着"指标是旁路"）吞掉。
 *     实盘 436 行 metrics 里 `link` 相 0 条，而指标是唯一调优依据 ⇒ 优化器一直瞎着。
 *   · 知识库索引读不到 ⇒ 概念层命中率整体跳过 ⇒「命中率崩了」这个结论**本身是假的**。
 *
 * 因此这里用**真实失败注入**（把 `metrics.jsonl` 占成目录 / 把 `index.json` 写成坏 JSON），
 * 不做 mock——只有真跑一遍，才证得出"吞掉"这件事被修好了。
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Kernel } from "../src/kernel.js";
import { assertSchema } from "../src/schema.js";
import { diagPath, readDiags, recordDiag, summarizeDiags } from "../src/diag.js";
import { extractCtxUsage } from "../src/metrics.js";
import { nodeFs, nodePath } from "../src/abstraction/adapters/node.js";

/** 测试走宿主盘：FS1 §四的 io 首参用这套默认适配器。 */
const io = { fs: nodeFs, path: nodePath };

process.env.MINIFLOW_HEADER_MODE = "off";

const FLOW_ID = "r8-diag";

/** 最小合成流：单 agent 节点（只要有一处 metric 调用就够测"写失败会不会被吞"）。 */
function writeFlow(root: string): void {
  const dir = path.join(root, "flows", FLOW_ID);
  fs.mkdirSync(dir, { recursive: true });
  const flow = {
    format: "flow@2",
    id: FLOW_ID,
    title: "R8 诊断通道最小流",
    version: "1.0.0",
    status: "active",
    policy: {},
    inputs: {},
    outputs: [],
    graph: {
      format: "flow-graph@1",
      name: FLOW_ID,
      nodes: {
        a: { kind: "agent", stage: "S1", title: "A 步", skill: "find-trope", kit: "search", op: "find-trope", output: "内部/稿本/a.md" },
      },
      edges: [],
      outputs: [],
    },
  };
  fs.writeFileSync(path.join(dir, "flow.json"), JSON.stringify(flow, null, 2) + "\n", "utf-8");
}

function setup(projectId = "p-diag") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miniflow-diag-"));
  writeFlow(root);
  const pd = path.join(root, "projects", projectId);
  fs.mkdirSync(pd, { recursive: true });
  // flowsDir 显式指向临时根（合成流只在这里存在）；repoRoot 保持默认走真仓库，好让 kit/op 能解析。
  const k = new Kernel({ root, flowsDir: path.join(root, "flows") });
  return { k, pd, pid: projectId, root };
}

describe("R8 · 诊断通道：旁路失败必须留痕", () => {
  it("recordDiag 合规 diagnostics@1，可读回，且坏行不炸整读", () => {
    const { pd } = setup();
    const rec = recordDiag(io, pd, "metric", "a/dispatch", new Error("EISDIR: illegal operation on a directory"));

    expect(() => assertSchema("diagnostics", rec)).not.toThrow();

    // 坏行容错（与 fsio.readJsonl 同纪律：一行坏不炸整读）
    fs.appendFileSync(diagPath(io, pd), "{ 这不是 json\n", "utf-8");

    const all = readDiags(io, pd);
    expect(all.length).toBe(1);
    expect(all[0].kind).toBe("metric");
    expect(all[0].detail).toContain("EISDIR");

    const sum = summarizeDiags(io, pd);
    expect(sum.count).toBe(1);
    expect(sum.byKind.metric).toBe(1);
    expect(sum.byScope["a/dispatch"]).toBe(1);
    expect(sum.recent.length).toBe(1);
  });

  it("指标写入失败必须留痕——这正是 N6 藏了整整一版的地方", async () => {
    const { k, pd, pid } = setup();
    // 失败注入：把 metrics.jsonl 占成**目录** ⇒ appendFileSync 抛 EISDIR ⇒ 触发 kernel.metric 的旁路分支
    fs.mkdirSync(path.join(pd, "registry", "metrics.jsonl"), { recursive: true });

    const run = await k.flow_run(FLOW_ID, pid, {});
    expect(run.status).toBe("awaiting_input"); // 旁路：流水线照走，不因指标失败而中断

    const diags = readDiags(io, pd);
    const metricDiags = diags.filter((d) => d.kind === "metric");
    expect(metricDiags.length).toBeGreaterThan(0);
    expect(metricDiags[0].detail).toContain("EISDIR");

    // 可见面（铁律⑥第③环的机器侧依据）：内核只读口必须把诊断暴露出来
    const vd = k.viewDiagnostics(pid);
    expect(vd.scope).toBe("project");
    expect(vd.count).toBeGreaterThan(0);
    expect(vd.byKind.metric).toBeGreaterThan(0);
  });

  it("知识库索引不可解析 → 命中率降级必须留痕（否则「命中率崩了」是假结论）", () => {
    const { root } = setup();
    fs.mkdirSync(path.join(root, "knowledge"), { recursive: true });
    fs.writeFileSync(path.join(root, "knowledge", "index.json"), "{ 坏索引", "utf-8");

    // 不抛异常（命中率检查本身不该炸），但概念层会整体跳过 ⇒ 结论不可信 ⇒ 必须留痕
    const usage = extractCtxUsage("# 正文\n\n这里是一些内容。\n", ["kb/trope/saturation"], { root, io });
    expect(usage.offered).toBe(1);

    const diags = readDiags(io, root); // 仓库级诊断：<root>/registry/diagnostics.jsonl
    const kbDiags = diags.filter((d) => d.kind === "kb");
    expect(kbDiags.length).toBe(1);
    expect(kbDiags[0].scope).toContain("buildConceptIndex");
  });

  it("viewDiagnostics 分两档：无参 = 仓库级，给 id = 项目级（互不串味）", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "miniflow-diag-scope-"));
    // repoRoot 也指向临时根：本用例只考"分档读"，不跑流，故不需要真仓库的 kit。
    const k = new Kernel({ root, repoRoot: root, flowsDir: path.join(root, "flows") });
    const pd = path.join(root, "projects", "p-scope");
    fs.mkdirSync(pd, { recursive: true });

    expect(k.viewDiagnostics().scope).toBe("repo");
    expect(k.viewDiagnostics("p-scope").scope).toBe("project");

    recordDiag(io, root, "kb", "repo-scope", "仓库级台账失败");
    recordDiag(io, pd, "metric", "proj-scope", "项目级指标失败");

    expect(k.viewDiagnostics().byScope["repo-scope"]).toBe(1);
    expect(k.viewDiagnostics().byScope["proj-scope"]).toBeUndefined();
    expect(k.viewDiagnostics("p-scope").byScope["proj-scope"]).toBe(1);
    expect(k.viewDiagnostics("p-scope").byScope["repo-scope"]).toBeUndefined();
  });
});
