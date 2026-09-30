import { describe, expect, it, beforeAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Kernel } from "../src/kernel.js";
import { blocked } from "../src/asserts.js";
import { AssertionPresets, defaultPresetRoots } from "../src/assertion-preset/index.js";
import { evalWhenExpr, safeEvalWhen, WhenParseError } from "../src/assertion-preset/when.js";
import { applyGatePreset, type GateEvalContext } from "../src/assertion-preset/executor.js";
import { loadPresetComposition } from "../src/assertion-preset/resolver.js";
import type { AssertionGroup, StandingMount } from "../src/assertion-preset/types.js";
import { artifact } from "./helpers.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const SYSTEM_PRESETS = path.join(REPO_ROOT, "assertion-presets");

function makeMount(groups: AssertionGroup[], overrides: Partial<StandingMount["composition"]> = {}): StandingMount {
  return {
    presetId: "test",
    composition: {
      id: "test",
      trust: "system",
      groups,
      defaultGateMode: "block-critical",
      diagnosticEnabled: true,
      progressiveResetMs: 0,
      ...overrides,
    },
    progressiveState: new Map(),
    stamp: { mtimeMs: 0, size: 0 },
  };
}
const ctx: GateEvalContext = { nodeId: "n1", nodeType: "agent" };
const v = (name: string, status: "pass" | "warn" | "block", detail = ""): { name: string; status: typeof status; detail: string } => ({ name, status, detail });

// ═══════════════ when 条件求值器 ═══════════════

describe("assertion-preset · when 条件求值器", () => {
  it("等值/比较/逻辑/非/括号", () => {
    const c = { nodeType: "agent", round: 3, isChapter: true, hasWorldbook: false };
    expect(evalWhenExpr("nodeType === 'agent'", c)).toBe(true);
    expect(evalWhenExpr("nodeType !== 'gate'", c)).toBe(true);
    expect(evalWhenExpr("round >= 2 && isChapter", c)).toBe(true);
    expect(evalWhenExpr("round > 3 || hasWorldbook", c)).toBe(false);
    expect(evalWhenExpr("!hasWorldbook", c)).toBe(true);
    expect(evalWhenExpr("(nodeType === 'agent' || round === 9) && !hasWorldbook", c)).toBe(true);
    expect(evalWhenExpr("pathClass === undefined", c)).toBe(true);
  });

  it("未知名 = undefined；数字与字符串字面量", () => {
    expect(evalWhenExpr("nope === undefined", {})).toBe(true);
    expect(evalWhenExpr("nope !== 'x'", {})).toBe(true);
    expect(evalWhenExpr("round === 2.5", { round: 2.5 })).toBe(true);
  });

  it("safeEvalWhen fail-open：坏表达式返回 true（断言保持启用）", () => {
    expect(safeEvalWhen("nodeType ===", {})).toBe(true);
    expect(safeEvalWhen("", {})).toBe(true);
    expect(() => evalWhenExpr("nodeType ===", {})).toThrow(WhenParseError);
    expect(safeEvalWhen("nodeType === 'gate'", { nodeType: "agent" })).toBe(false); // 合法表达式正常求值
  });
});

// ═══════════════ Discovery / Registry / Mount ═══════════════

describe("assertion-preset · discovery / mount", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miniflow-preset-disc-"));
  beforeAll(() => {
    const mk = (id: string, gate?: string, meta = ""): void => {
      const dir = path.join(root, id);
      fs.mkdirSync(dir, { recursive: true });
      if (gate !== undefined) fs.writeFileSync(path.join(dir, "gate-preset.yml"), gate, "utf-8");
      if (meta) fs.writeFileSync(path.join(dir, "preset.yml"), meta, "utf-8");
    };
    mk("alpha", "id: alpha\ndefaultGateMode: warn-only\ngroups:\n  - id: g\n    assertions:\n      - assertionType: exists\n", "name: Alpha 预设\ndescription: 测试用\n");
    mk("beta-broken-yaml", "id: [unclosed\n");
    mk("gamma-schema", "id: gamma\ngroups: []\n"); // groups minItems 1
    mk("delta"); // 缺 gate-preset.yml
    mk("Bad_ID", "id: bad\n"); // 目录名不合法 → 扫描跳过
  });

  it("健康检查分级报告：healthy / broken-yaml / schema / missing；非法目录名跳过", () => {
    const svc = new AssertionPresets([{ path: root, trust: "user" }]);
    const list = svc.list();
    const byId = new Map(list.map((p) => [p.id, p]));
    expect(byId.has("Bad_ID")).toBe(false);
    expect(byId.get("alpha")?.broken).toBeUndefined();
    expect(byId.get("alpha")?.name).toBe("Alpha 预设");
    expect(byId.get("alpha")?.trust).toBe("user");
    expect(byId.get("beta-broken-yaml")?.broken).toMatch(/invalid YAML/);
    expect(byId.get("gamma-schema")?.broken).toMatch(/schema validation failed/);
    expect(byId.get("delta")?.broken).toMatch(/missing/);
  });

  it("resolve：显式 id 缺失抛错带可用清单；缺省 id 缺失回退首个；broken 可解析但 mount 拒绝", () => {
    const svc = new AssertionPresets([{ path: root, trust: "user" }]);
    expect(() => svc.resolve("nope")).toThrow(/not found/);
    const fallback = new AssertionPresets([{ path: root, trust: "user" }], "alpha");
    expect(fallback.resolve().id).toBe("alpha"); // 缺省 id 命中
    expect(svc.resolve("gamma-schema").broken).toBeDefined();
    expect(() => svc.mount("gamma-schema")).toThrow(/broken/);
  });

  it("真实系统 presets（4 个）全部健康且可挂载；组合缺省值落位", () => {
    const svc = new AssertionPresets([{ path: SYSTEM_PRESETS, trust: "system" }]);
    const ids = svc.list().map((p) => p.id).sort();
    expect(ids).toEqual(["minimal", "novel-fanqie", "prose-light", "screenplay-audio"]);
    for (const p of svc.list()) expect(p.broken).toBeUndefined();
    const mount = svc.mount("novel-fanqie");
    expect(mount.composition.id).toBe("novel-fanqie");
    expect(mount.composition.groups.map((g) => g.id)).toEqual(["integrity", "consistency", "prose", "structure"]);
    // schema/resolver 缺省值：未写 warnThreshold 的断言落到 2/5
    const notbut = mount.composition.groups.find((g) => g.id === "prose")?.assertions.find((a) => a.assertionType === "AE-PROSE-NOTBUT");
    expect(notbut?.warnThreshold).toBe(2);
    expect(notbut?.blockThreshold).toBe(5);
    expect(notbut?.gateMode).toBe("warn-only"); // 组级 gateMode 生效
  });

  it("热重载：组合文件变化（size 变）→ 新 generation，progressive 状态清零", () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "miniflow-preset-hot-"));
    const presetDir = path.join(rootDir, "hot");
    fs.mkdirSync(presetDir, { recursive: true });
    const gate = path.join(presetDir, "gate-preset.yml");
    fs.writeFileSync(gate, "id: hot\ngroups:\n  - id: g\n    gateMode: warn-only\n    assertions:\n      - assertionType: exists\n", "utf-8");
    const svc = new AssertionPresets([{ path: rootDir, trust: "system" }]);
    const m1 = svc.mount("hot");
    m1.progressiveState.set("exists", { count: 4, firstAt: Date.now() });
    fs.writeFileSync(gate, "id: hot\ngroups:\n  - id: g\n    gateMode: strict\n    assertions:\n      - assertionType: exists\n", "utf-8");
    const m2 = svc.mount("hot");
    expect(m2).not.toBe(m1);
    expect(m2.composition.groups[0]?.gateMode).toBe("strict");
    expect(m2.progressiveState.size).toBe(0);
  });
});

// ═══════════════ Executor 策略层 ═══════════════

describe("assertion-preset · executor 策略", () => {
  const g = (assertions: AssertionGroup["assertions"], gateMode?: AssertionGroup["gateMode"], extra: Partial<AssertionGroup> = {}): AssertionGroup =>
    ({ id: "g", assertions, ...(gateMode ? { gateMode } : {}), ...extra });

  it("warn-only：block 降级 warn，blocked() 放行", () => {
    const mount = makeMount([g([{ assertionType: "no-debris", gateMode: "warn-only" }])]);
    const r = applyGatePreset(mount, [v("no-debris", "block", "残留")], ctx);
    expect(r.problems[0]?.status).toBe("warn");
    expect(blocked(r.problems)).toHaveLength(0);
    expect(r.outcomes[0]?.progressiveLevel).toBe("normal"); // 首次失败 count=1 < warn 2
  });

  it("strict：warn 升级 block，blocked() 拦截", () => {
    const mount = makeMount([g([{ assertionType: "artifact-header", gateMode: "strict" }])]);
    const r = applyGatePreset(mount, [v("artifact-header", "warn", "缺 upstream")], ctx);
    expect(r.problems[0]?.status).toBe("block");
    expect(blocked(r.problems)).toHaveLength(1);
  });

  it("block-critical + progressive：warn 连续失败达 blockThreshold 才升级为 block", () => {
    const mount = makeMount([g([{ assertionType: "AE-CONT-KNOW", warnThreshold: 1, blockThreshold: 2 }])]);
    const r1 = applyGatePreset(mount, [v("AE-CONT-KNOW", "warn")], ctx);
    expect(r1.problems[0]?.status).toBe("warn"); // count=1 → warning 档，仍不拦
    const r2 = applyGatePreset(mount, [v("AE-CONT-KNOW", "warn")], ctx);
    expect(r2.problems[0]?.status).toBe("block"); // count=2 → blocking 档
    expect(blocked(r2.problems)).toHaveLength(1);
    expect(r2.outcomes[0]?.triggerCount).toBe(2);
  });

  it("block-critical：确定性 block 不受 progressive 影响，恒拦", () => {
    const mount = makeMount([g([{ assertionType: "exists" }])]);
    const r = applyGatePreset(mount, [v("exists", "block")], ctx);
    expect(r.problems[0]?.status).toBe("block");
  });

  it("未声明类型原样透传（preset 只调制它声明的东西）", () => {
    const mount = makeMount([g([{ assertionType: "exists", gateMode: "warn-only" }])]);
    const r = applyGatePreset(mount, [v("mystery-check", "block")], ctx);
    expect(r.problems[0]?.status).toBe("block");
    expect(r.outcomes).toHaveLength(0);
  });

  it("when 条件：不成立 → 结果丢弃；组 disabled 成立 → 整组跳过（透传）", () => {
    const mount = makeMount([
      g([{ assertionType: "AE-CONT-KNOW", when: "isChapter", gateMode: "warn-only" }]),
      { id: "off", gateMode: "warn-only", disabled: "hasWorldbook === false", assertions: [{ assertionType: "glossary" }] },
    ]);
    const dropped = applyGatePreset(mount, [v("AE-CONT-KNOW", "block")], { ...ctx, isChapter: false });
    expect(dropped.problems).toHaveLength(0); // 条件不成立 = 本轮丢弃
    const passthrough = applyGatePreset(mount, [v("glossary", "block")], { ...ctx, hasWorldbook: false });
    expect(passthrough.problems[0]?.status).toBe("block"); // 组被禁用 → 未匹配 → 透传
  });

  it("hintTemplate 占位替换 + summary 开关", () => {
    const withHint = makeMount([g([{ assertionType: "no-debris", gateMode: "warn-only", hintTemplate: "{{type}} 第 {{count}} 次残留" }])]);
    const r = applyGatePreset(withHint, [v("no-debris", "block")], ctx);
    expect(r.problems[0]?.detail).toContain("no-debris 第 1 次残留");
    expect(r.summary).toContain("no-debris[warn-only/");
    const silent = makeMount([g([{ assertionType: "no-debris", gateMode: "warn-only" }])], { diagnosticEnabled: false });
    expect(applyGatePreset(silent, [v("no-debris", "block")], ctx).summary).toBe("");
  });

  it("progressiveResetMs：firstAt 超期 → 计数回滚", () => {
    const mount = makeMount([g([{ assertionType: "no-debris", warnThreshold: 1, blockThreshold: 2 }])], { progressiveResetMs: 1000 });
    mount.progressiveState.set("no-debris", { count: 1, firstAt: Date.now() - 60_000 });
    const r = applyGatePreset(mount, [v("no-debris", "warn")], ctx);
    expect(r.outcomes[0]?.triggerCount).toBe(1); // 超期重置，不是 2
    expect(r.problems[0]?.status).toBe("warn");
  });

  it("resolver：YAML → 组合，id 以目录名为准；非法 gateMode 抛错", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "miniflow-preset-res-"));
    const gate = path.join(dir, "gate-preset.yml");
    fs.writeFileSync(gate, "id: wrong-name\ngroups:\n  - id: g\n    assertions:\n      - assertionType: exists\n", "utf-8");
    const c = loadPresetComposition(gate, "system", "right-name");
    expect(c.id).toBe("right-name");
    expect(c.defaultGateMode).toBe("block-critical");
    expect(c.diagnosticEnabled).toBe(true);
    fs.writeFileSync(gate, "id: bad\ngroups:\n  - id: g\n    gateMode: mega\n    assertions:\n      - assertionType: exists\n", "utf-8");
    expect(() => loadPresetComposition(gate, "system", "bad")).toThrow(/gateMode/); // schema enum 先拦
  });
});

// ═══════════════ Kernel 集成（提交链策略点） ═══════════════

describe("assertion-preset · kernel 提交链集成", () => {
  it("同一污染产物：缺省预设（novel-fanqie）打回，minimal 预设降级放行", async () => {
    const runKernel = async (assertionPreset?: string): Promise<string> => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "miniflow-preset-kernel-"));
      const projectId = "p-preset";
      const kernel = new Kernel({ root, ...(assertionPreset ? { assertionPreset } : {}) });
      const pd = path.join(root, "projects", projectId);
      fs.mkdirSync(pd, { recursive: true });
      fs.writeFileSync(path.join(pd, "选题素材.md"), "# 选题素材\n\n甲方点子：测试。\n", "utf-8");
      await kernel.flow_run("topic", projectId, { route: "hot", region: "CN", direction: "断言预设 e2e" });
      // 先交干净的首步把链推进到 find-trope（与 e2e 同一提交序）
      const s0 = await kernel.flow_submit(projectId, "m1.topic-report", {
        content: artifact("topic", "m1.topic-report", "# 选题报告（e2e）\n\n> 预设集成夹具。\n", { projectDir: pd }),
      });
      expect(s0.status).toBe("accepted");
      const polluted = artifact("topic", "m1.find-trope", "# 梗卡（e2e）\n\n让我先分析一下流程再给结论。\n", { projectDir: pd });
      const r = await kernel.flow_submit(projectId, "m1.find-trope", { content: polluted });
      return r.status;
    };

    expect(await runKernel()).toBe("rejected"); // 缺省 novel-fanqie：no-debris block-critical 透传 → 拦
    expect(await runKernel("minimal")).toBe("accepted"); // minimal：no-debris warn-only → 降级放行
  });

  it("KernelOptions.assertionPreset 透传到服务；预设不可用 = 门控静默不激活", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "miniflow-preset-opt-"));
    const k = new Kernel({ root, assertionPreset: "no-such-preset" });
    expect(() => k.assertionPresets.resolve("no-such-preset")).toThrow(/not found/);
    expect(k.assertionPresets.mountFor()).toBeUndefined(); // 门点静默透传
  });
});
