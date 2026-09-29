import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveInputs } from "../src/cond.js";
import { Kernel } from "../src/kernel.js";
import { buildHttpApp } from "../src/http.js";
import { VERB_BY_NAME } from "../src/verbs.js";
import { verbToolSpecs } from "../src/mcp.js";
import { setDecision, listDecisions } from "../src/decisions.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("R8 S1 · resolveInputs 选择面 fail-fast（规范 R8 §零 判据 + 铁律 1）", () => {
  it("enum 输入既无取值也无 default → 开跑即抛，不静默未绑定", () => {
    const flow = { inputs: { route: { type: "enum", options: ["hot", "calm", "dual"] } } } as never;
    expect(() => resolveInputs(flow, {})).toThrow(/选择未决.*route/);
  });

  it("enum 有显式取值 → 正常通过（选择不必带 default）", () => {
    const flow = { inputs: { route: { type: "enum", options: ["hot", "calm", "dual"] } } } as never;
    expect(resolveInputs(flow, { route: "dual" }).route).toBe("dual");
  });

  it("enum 缺值但有 default → 照旧回填（存量语义不变，摘 default 是 S4 的事）", () => {
    const flow = { inputs: { route: { type: "enum", options: ["hot", "calm"], default: "hot" } } } as never;
    expect(resolveInputs(flow, {}).route).toBe("hot");
  });

  it("非 enum 缺省输入仍允许缺席（值/可选字符串不受影响）", () => {
    const flow = { inputs: { direction: { type: "string" } } } as never;
    expect(resolveInputs(flow, {})).not.toHaveProperty("direction");
  });
});

describe("R8 S1 · 契约就位（decision@1 / catalog-entry@1）", () => {
  const load = (name: string) =>
    JSON.parse(fs.readFileSync(path.join(ROOT, "contracts", name), "utf-8"));

  it("decision.schema：by 与 evidence 必填（无来源的决策=猜）", () => {
    const s = load("decision.schema.json");
    expect(s.format ?? s.properties?.format?.const).toBeTruthy();
    for (const k of ["by", "evidence", "picked", "key"]) expect(s.required).toContain(k);
  });

  it("catalog-entry.schema：契约层面禁止 default 字段（候选无默认生效权）", () => {
    const s = load("catalog-entry.schema.json");
    expect(s.additionalProperties).toBe(false);
    expect(s.properties).not.toHaveProperty("default");
    for (const k of ["id", "kind", "tags"]) expect(s.required).toContain(k);
  });
});

describe("R8 S4 · 拍板②：enum 输入摘除 default（选择发生在开跑前的表单/配置）", () => {
  const load = (id: string) =>
    JSON.parse(fs.readFileSync(path.join(ROOT, "flows", id, "flow.json"), "utf-8")) as {
      inputs?: Record<string, { type?: string; default?: unknown }>;
    };

  it("六处历史 default 全部清零：enum 输入不再藏默认值", () => {
    const flows = ["topic", "prose", "screenplay", "novel", "test-dual"];   // v0.8：按在场四条生产线 + 引擎夹具清点
    for (const id of flows) {
      for (const [k, spec] of Object.entries(load(id).inputs ?? {})) {
        if (spec.type === "enum") expect(spec, `${id}.${k} 不应带 default`).not.toHaveProperty("default");
      }
    }
  });

  it("region 是可选先验：不表态也开得了跑（缺席≠兜底，等调研步产决策）", async () => {
    const { kernel } = seedKernelLite();
    const stop = await kernel.flow_run("topic", "p-r8s4", { route: "hot", direction: "x" });
    expect(stop).toBeTruthy();
    // 未表态 = 不猜值：绝不自作主张落一条 CN 决策（那是引擎替作者选市场）
    expect(fs.existsSync(path.join(kernel.projectDir("p-r8s4"), "decisions", "region.json"))).toBe(false);
  });

  it("表态即落决策（by=user.preference 单向桥），但 enum 仍不许带 default", async () => {
    const { kernel } = seedKernelLite();
    await kernel.flow_run("topic", "p-r8s4b", { route: "hot", region: "CN", direction: "x" });
    const d = JSON.parse(
      fs.readFileSync(path.join(kernel.projectDir("p-r8s4b"), "decisions", "region.json"), "utf-8"),
    );
    expect(d).toMatchObject({ format: "decision@1", key: "region", picked: ["CN"], by: "user.preference" });
    expect(d.evidence).toContain("inputs.region");
    // 单向桥：决策落在 decisions/，绝不写回 state.inputs 之外的地方——inputs 仍是开跑前事实
    const st = JSON.parse(fs.readFileSync(path.join(kernel.projectDir("p-r8s4b"), "state.json"), "utf-8"));
    expect(st.inputs.region).toBe("CN");
  });

  it("必表态的 enum（route）缺席照旧抛——可选是显式声明的例外，不是新兜底", async () => {
    const { kernel } = seedKernelLite();
    await expect(kernel.flow_run("topic", "p-r8s4c", { region: "CN", direction: "x" })).rejects.toThrow(
      /选择未决.*route/,
    );
  });
});

function seedKernelLite() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miniflow-r8s4-"));
  fs.mkdirSync(path.join(root, "projects"), { recursive: true });
  fs.mkdirSync(path.join(root, "flows"), { recursive: true });
  // 用真实 flows/ 目录：repoRoot/flowsDir 指向仓库根（临时 root 只隔离 projects/）
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const kernel = new Kernel({ root, repoRoot, flowsDir: path.join(repoRoot, "flows") });
  return { root, kernel };
}
describe("R8 S2 · set_decision/list_decisions：决策事实三面可达", () => {
  function seedKernel() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "miniflow-r8d-"));
    fs.mkdirSync(path.join(root, "projects"), { recursive: true });
    const kernel = new Kernel({ root, repoRoot: root, flowsDir: path.join(root, "flows") });
    return { root, kernel };
  }
  const okInput = {
    key: "genre",
    picked: ["年代言情"],
    by: "m1.topic-report",
    evidence: "01-选题/选题报告.md#§2 类型判定",
  };

  it("run 路径：落 decisions/<key>.json，list 读回一致，journal 留痕", async () => {
    const { root, kernel } = seedKernel();
    const projectDir = kernel.projectDir("p-r8d");
    fs.mkdirSync(projectDir, { recursive: true });
    const d = await VERB_BY_NAME.set_decision.run(kernel, { project: "p-r8d", ...okInput });
    expect(JSON.parse(fs.readFileSync(path.join(projectDir, "decisions", "genre.json"), "utf-8")).picked).toEqual(["年代言情"]);
    const listed = VERB_BY_NAME.list_decisions.run(kernel, { project: "p-r8d" }) as { decisions: unknown[]; issues: string[] };
    expect(listed.decisions).toHaveLength(1);
    expect(listed.issues).toEqual([]);
    const j = fs.readFileSync(path.join(projectDir, "journal.jsonl"), "utf-8");
    expect(j).toContain("决策落盘 decision:genre");
    expect(root).toBeTruthy();
  });

  it("无来源即拒：缺 evidence 不落盘、报 400 类 DecisionError", async () => {
    const { kernel } = seedKernel();
    fs.mkdirSync(kernel.projectDir("p-r8d2"), { recursive: true });
    expect(() =>
      VERB_BY_NAME.set_decision.run(kernel, { project: "p-r8d2", key: "style", picked: ["张爱玲"], by: "user" }),
    ).toThrow(/DECISION_INVALID|evidence/);
    expect(fs.existsSync(path.join(kernel.projectDir("p-r8d2"), "decisions"))).toBe(false);
  });

  it("三面同源：HTTP 按表分派可达 + MCP spec 含两动词（表即面）", async () => {
    const { kernel } = seedKernel();
    fs.mkdirSync(kernel.projectDir("p-r8d3"), { recursive: true });
    const app = buildHttpApp(kernel);
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/api/verbs/set_decision",
      payload: { project: "p-r8d3", ...okInput },
    });
    expect(res.statusCode).toBe(200);
    const names = verbToolSpecs().map((t: { name: string }) => t.name);
    expect(names).toContain("set_decision");
    expect(names).toContain("list_decisions");
  });

  it("live 切片带回 decisions（页面决策三问的数据源）", () => {
    const { root, kernel } = seedKernel();
    const projectDir = kernel.projectDir("p-r8d4");
    fs.mkdirSync(projectDir, { recursive: true });
    setDecision(projectDir, okInput as never);
    const live = kernel.viewLive("p-r8d4") as { decisions: { decisions: { key: string }[]; issues: string[] } };
    expect(live.decisions.decisions[0].key).toBe("genre");
  });

  it("坏决策不静默：key 与文件名不符 / 缺 by 都进 issues", () => {
    const { root } = seedKernel();
    const dir = path.join(root, "projects", "p-r8d5", "decisions");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "genre.json"), JSON.stringify({ format: "decision@1", key: "style", by: "x", at: "t", picked: ["a"], evidence: "e" }), "utf-8");
    fs.writeFileSync(path.join(dir, "route.json"), "not-json", "utf-8");
    const r = listDecisions(path.join(root, "projects", "p-r8d5"));
    expect(r.decisions).toHaveLength(0);
    expect(r.issues).toHaveLength(2);
  });
});

describe("R8 生产端真跑 · 梗卡池接上后两条内容生产线照跑", () => {
  it("短剧线（topic）：region 缺席照跑到派发，且不猜市场", async () => {
    const { kernel } = seedKernelLite();
    const stop = await kernel.flow_run("topic", "p-r8live-a", { route: "hot", direction: "都市逆袭" });
    expect(["awaiting_input", "suspended", "blocked", "completed"]).toContain(stop.status);
    const next = await kernel.flow_next("p-r8live-a");
    expect(next.status, "跑不动就是接线把流程弄死了").toBe("awaiting_input");
    expect(next.taskPackage?.instruction.text).toBeTruthy();
    // 未表态 = 不落决策（不替作者选市场），梗卡池走 load-all-with-warning 并显式告警
    expect(listDecisions(kernel.projectDir("p-r8live-a")).decisions.map((d) => d.key)).not.toContain("region");
  });

  it("小说线（prose）：新池语义下照常派发到成文步", async () => {
    const { kernel } = seedKernelLite();
    await kernel.flow_run("prose", "p-r8live-b", { route: "hot", range: "1-3", direction: "长篇试跑" });
    const next = await kernel.flow_next("p-r8live-b");
    expect(next.status).toBe("awaiting_input");
    expect(next.taskPackage?.outputContract.file).toBeTruthy();
  });
});
