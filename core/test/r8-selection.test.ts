import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveInputs } from "../src/cond.js";

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
