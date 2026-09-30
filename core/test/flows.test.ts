import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { rootOf } from "../src/schema.js";
import { compilePlan, upstreamOf } from "../src/plan.js";
import { edgeVia, edgeRole, isBackEdge, evalWhen, condContextOf, pendingInstancesOf } from "../src/cond.js";
import { classOfPath } from "../src/asserts.js";
import { artifactPathOf, nodeOutput } from "../src/minitools.js";
import { expandFlow3, type Flow3Descriptor } from "../src/modules.js";
import type { FlowDescriptor } from "../src/types.js";

const FLOW_IDS = fs
  .readdirSync(path.join(rootOf(), "flows"))
  .filter((d) => fs.existsSync(path.join(rootOf(), "flows", d, "flow.json")))
  .sort();

const load = (id: string): FlowDescriptor =>
  JSON.parse(fs.readFileSync(path.join(rootOf(), "flows", id, "flow.json"), "utf-8")) as FlowDescriptor;

/**
 * flow@3（模块序列）不携带手画图，图级检查一律跑在 expandFlow3 派生出的
 * flow@2 形态描述符上（与内核 effectiveOf 同一展开单点）。flow@1/@2 存量已随 v4.0.0 处决。
 */
const loadAny = (id: string): { format: string; flow: FlowDescriptor } => {
  const j = JSON.parse(fs.readFileSync(path.join(rootOf(), "flows", id, "flow.json"), "utf-8")) as
    | FlowDescriptor
    | (Flow3Descriptor & { format: "flow@3" });
  if ((j as { format: string }).format === "flow@3") {
    return { format: "flow@3", flow: expandFlow3(rootOf(), j as Flow3Descriptor).flow as FlowDescriptor };
  }
  throw new Error(`${id}：存量 flow 必须是 flow@3（flow@1/@2 已处决）`);
};

/** 严格 JSON：重复键必须报错（文本级字段手术的经典事故）。 */
function strictParseId(raw: string, ctx: string): unknown {
  const dups: string[] = [];
  const data = JSON.parse(raw, (key, value) => value) as unknown;
  JSON.parse(raw);
  const seen = new Set<string>();
  const re = /"([A-Za-z_][A-Za-z0-9_]*)"\s*:/g;
  // 只做行内粗检：同一对象内同键重复在 node/edge 单行排版下必然同现一行
  for (const line of raw.split("\n")) {
    const keys = [...line.matchAll(re)].map((m) => m[1]);
    for (const k of new Set(keys)) if (keys.filter((x) => x === k).length > 1) dups.push(`${ctx}:${k}`);
  }
  if (dups.length) throw new Error(`重复键 ${[...new Set(dups)].join(", ")}`);
  return data;
}

describe("flow 描述符 · 全量体检（R4 §5.1 + R6 模块序列）", () => {
  it("每个 flow 的 format = flow@3（唯一合法存量格式），无重复键、无旧字段名", () => {
    expect(FLOW_IDS.length).toBeGreaterThan(0);
    for (const id of FLOW_IDS) {
      const raw = fs.readFileSync(path.join(rootOf(), "flows", id, "flow.json"), "utf-8");
      strictParseId(raw, id);
      const format = JSON.parse(raw).format;
      expect(format, `${id}：flow@1/@2 已随 v4.0.0 处决，唯一合法格式是 flow@3`).toBe("flow@3");
      expect(raw.includes('"transform"'), `${id} 残留 transform`).toBe(false);
      expect(/^\s*"file"\s*:/m.test(raw), `${id} 残留 node.file`).toBe(false);
      expect(/^\s*"check"\s*:/m.test(raw), `${id} 残留 node.check`).toBe(false);
      expect(/^\s*"kb"\s*:/m.test(raw), `${id} 残留 node.kb`).toBe(false);
      expect(/"when"\s*:\s*"/.test(raw), `${id} 残留字符串 when`).toBe(false);
      if (format === "flow@3") {
        // 模块序列不携带手画图：图只能由 expandFlow3 派生
        expect(raw.includes('"graph"'), `${id} flow@3 不得手写 graph`).toBe(false);
        expect(raw.includes('"stages"'), `${id} flow@3 不得手写 stages`).toBe(false);
        expect(raw.includes('"nodes"'), `${id} flow@3 不得手写 nodes`).toBe(false);
        expect(raw.includes('"edges"'), `${id} flow@3 不得手写 edges`).toBe(false);
      }
    }
  });

  it("每根线有 role，when 可求值，via 派生自目标节点执行体", () => {
    for (const id of FLOW_IDS) {
      const flow = loadAny(id).flow;
      const ctx = condContextOf({ inputs: {} });
      for (const e of flow.graph.edges) {
        expect(e.role, `${id}/${e.id} 缺 role`).toBeDefined();
        expect(isBackEdge(e), `${id}/${e.id} 回边判定`).toBe(edgeRole(e) === "loop" || edgeRole(e) === "reject");
        // when 必须是结构化谓词（flow@1 字符串形态已处决：出现即不活跃 = 死线，禁止回流）
        if (e.when !== undefined) expect(typeof e.when, `${id}/${e.id} when 非结构化`).toBe("object");
        const r = evalWhen(e.when, ctx);
        expect(r.active !== undefined, `${id}/${e.id} when 求值`).toBe(true);
        // via：派生值必须等于目标节点的执行体，否则应显式声明
        const derived = edgeVia(flow, { ...e, via: undefined });
        if (e.via === undefined) expect(derived, `${id}/${e.id}`).toBeTruthy();
      }
    }
  });

  it("打回边与回边都带角色语义；打回边必须带 params.scope（面板可渲染）", () => {
    for (const id of FLOW_IDS) {
      const flow = loadAny(id).flow;
      for (const e of flow.graph.edges) {
        if (edgeRole(e) !== "reject") continue;
        expect((e.params ?? {}).scope, `${id}/${e.id} 缺 params.scope`).toBeTruthy();
      }
    }
  });

  it("agent 节点全部迁移到 kit+op 引用（漂移面归零；flow@3 派生节点自带模块归属）", () => {
    for (const id of FLOW_IDS) {
      const flow = loadAny(id).flow;
      for (const [nid, n] of Object.entries(flow.graph.nodes)) {
        if (!n.skill) continue;
        expect(n.kit, `${id}/${nid} 缺 kit`).toBeTruthy();
        expect(n.op, `${id}/${nid} 缺 op`).toBeTruthy();
      }
    }
  });

  it("产物路径全部落在准入目录内，或为根级输入材料", () => {
    const ALLOWED = ["内部/意见/", "内部/收据/", "内部/依据/", "内部/稿本/", "对外交付/", "章节正文/", "世界书/"];
    // R6 模块产物目录：NN-模块名/（01-选题/ 这类，由 expandFlow3 派生）
    const R6_DIR = /^\d{2}-[^/]+\//;
    for (const id of FLOW_IDS) {
      const flow = loadAny(id).flow;
      for (const [nid, n] of Object.entries(flow.graph.nodes)) {
        const out = nodeOutput(n);
        if (!out) continue;
        const rel = out.replaceAll("\\", "/");
        const ok = ALLOWED.some((d) => rel.startsWith(d)) || R6_DIR.test(rel) || (n.kind === "novel-txt" && !rel.includes("/"));
        expect(ok, `${id}/${nid} 产物 ${rel} 不在准入目录`).toBe(true);
        expect(classOfPath(rel), `${id}/${nid} class 反查`).toBeTruthy();
      }
      // 交付清单：path 缺省取节点产物；显式声明必须与 class 准入一致（交付名不算路径）
      for (const o of flow.outputs ?? []) {
        const p = o.path ?? artifactPathOf(flow, o.node ?? "");
        if (!p) continue;
        expect(p.includes("/"), `${id} 交付出口「${p}」不是合格路径（合格形态：对外交付/NN-名.ext）`).toBe(true);
        expect(ALLOWED.some((d) => p.replaceAll("\\", "/").startsWith(d)) || R6_DIR.test(p), `${id} 交付出口 ${p}`).toBe(true);
      }
    }
  });

  it("每个 flow 都能编译计划（回边不计入前向 → 无环；前向边序保持）", () => {
    for (const id of FLOW_IDS) {
      const flow = loadAny(id).flow;
      const order = compilePlan(flow, {});
      expect(order.length, `${id} 计划为空`).toBeGreaterThan(0);
      // 前向边的 from 必须排在 to 之前；回边不参与拓扑，不得据此判环
      const pos = new Map(order.map((n, i) => [n, i]));
      for (const e of flow.graph.edges.filter((x) => !isBackEdge(x))) {
        if (!pos.has(e.from) || !pos.has(e.to)) continue;
        expect(pos.get(e.from)! < pos.get(e.to)!, `${id}/${e.id} 前向边序颠倒（from 应在 to 前）`).toBe(true);
      }
    }
  });

  it("节点级 when：可选模块随输入进出计划（不再是死声明）", () => {
    // flow@3 派生图上验证机制：给 m5.render_html 挂实例级 when（等价旧 intake 可选旁路）
    const base = loadAny("topic").flow;
    const withSwitch = (): FlowDescriptor => {
      const f = structuredClone(base);
      f.graph.nodes["m5.render_html"].when = { input: "批注回流", eq: "on" };
      return f;
    };
    const off = compilePlan(withSwitch(), { 批注回流: "off" });
    const on = compilePlan(withSwitch(), { 批注回流: "on" });
    expect(off.includes("m5.render_html"), "render_html 应随 批注回流=off 退出计划").toBe(false);
    expect(on.includes("m5.render_html"), "render_html 应随 批注回流=on 进入计划").toBe(true);
    // 可选模块是旁路叶子，不是必经节点：关掉后主干照常可达
    expect(on.includes("m5.export-doc")).toBe(true);
    expect(off.includes("m5.export-doc")).toBe(true);
  });

  it("节点级 when 裁剪后不再作为上游注入上下文", () => {
    const base = loadAny("topic").flow;
    const f = structuredClone(base);
    // export-doc 挂 when=on：开 → 它是 link 的上游；关 → 上游注入里消失
    f.graph.nodes["m5.export-doc"].when = { input: "批注回流", eq: "on" };
    expect(upstreamOf(f, "m5.render_html", { 批注回流: "on" })).toContain("m5.export-doc");
    expect(upstreamOf(f, "m5.render_html", { 批注回流: "off" })).not.toContain("m5.export-doc");
  });

  it("派生图无 asserts（v5.0 断言协议退役）且 iterate 槽位可被面板消费", () => {
    // flow@3 派生：质量条款走 io.acceptance{scans,rules} + 扫描收据，节点上不再携带 asserts
    const flow = loadAny("novel").flow;   // v0.8：novel-fanqie 删除，iterate 例证改用 novel（逐章 iterate）
    const leaked = Object.entries(flow.graph.nodes).filter(([, n]) => (n as { asserts?: unknown }).asserts !== undefined);
    expect(leaked.map(([id]) => id), "派生节点不得携带断言声明").toEqual([]);
    const iterated = Object.entries(flow.graph.nodes).find(([, n]) => n.iterate?.artifact);
    expect(iterated, "iterate 应传播到派生节点").toBeDefined();
    expect(artifactPathOf(flow, iterated![0])).toBeTruthy();
    // iterate 节点本身也算未收口实例（{loop:"pending"} 的取值来源）
    expect(pendingInstancesOf(flow, { nodes: { [iterated![0]]: { status: "awaiting" } } })).toBe(1);
    expect(pendingInstancesOf(flow, { nodes: { [iterated![0]]: { status: "done" } } })).toBe(0);
  });
});
