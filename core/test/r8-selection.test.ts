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
    const flows = ["topic-selection", "novel-prose", "episode-script", "outline-production", "book-deconstruct"];
    for (const id of flows) {
      for (const [k, spec] of Object.entries(load(id).inputs ?? {})) {
        if (spec.type === "enum") expect(spec, `${id}.${k} 不应带 default`).not.toHaveProperty("default");
      }
    }
  });

  it("region（拍板后无默认）：不显式选就开不了跑，显式选即通过", async () => {
    const { kernel } = seedKernelLite();
    fs.mkdirSync(kernel.projectDir("p-r8s4"), { recursive: true });
    await expect(
      kernel.flow_run("topic-selection", "p-r8s4", { route: "hot", direction: "x" }),
    ).rejects.toThrow(/选择未决.*region/);
    const stop = await kernel.flow_run("topic-selection", "p-r8s4", { route: "hot", region: "CN", direction: "x" });
    expect(stop).toBeTruthy();
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
