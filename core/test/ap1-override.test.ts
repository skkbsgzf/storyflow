/**
 * AP1 §七/§九/§十 · 断言覆盖（overlay 三类 patch）、预设选择优先级链、诊断摘要注入。
 *
 * 三条方向各锁一层，避免「契约写了、内核没读」那类复发事故：
 *   §七 执行器合成（applyAssertionOverrides）——派生挂载、不写回原挂载、引用不到必回显；
 *   §七 编排解析（effectiveFlow3）——三类 kind 进 assertionOverrides，形状非法进 unsupported；
 *   §九/§十 内核集成——预设三级链与 diagnosticSummary 随任务包下发。
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Kernel } from "../src/kernel.js";
import { blocked } from "../src/asserts.js";
import { effectiveFlow3 } from "../src/modules.js";
import { applyAssertionOverrides, applyGatePreset, type GateEvalContext } from "../src/assertion-preset/executor.js";
import type { AssertionGroup, AssertionOverride, StandingMount } from "../src/assertion-preset/types.js";
import type { Validation } from "../src/types.js";
import { artifact } from "./helpers.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");

/** 合成挂载：阈值/门档现场只由本文件的 groups 决定，不依赖出厂预设的演化。 */
function mountOf(groups: AssertionGroup[], over: Partial<StandingMount["composition"]> = {}): StandingMount {
  return {
    presetId: "synthetic",
    composition: {
      id: "synthetic", trust: "system", groups,
      defaultGateMode: "block-critical", diagnosticEnabled: true, progressiveResetMs: 0, ...over,
    },
    progressiveState: new Map(),
    stamp: { mtimeMs: 0, size: 0 },
  };
}
const ctx: GateEvalContext = { nodeId: "n1", nodeType: "agent", isChapter: true };
const v = (name: string, status: Validation["status"], detail = ""): Validation => ({ name, status, detail });
/** 连续 n 轮同一 warn 证据，返回最后一轮的最终状态（progressive 逐轮升级的观测量）。 */
function drive(mount: StandingMount, rounds: number, type = "AE-X"): Validation["status"] {
  let last: Validation["status"] = "pass";
  for (let i = 0; i < rounds; i++) last = applyGatePreset(mount, [v(type, "warn")], ctx).problems[0]!.status;
  return last;
}
const group: AssertionGroup = {
  id: "g1",
  gateMode: "block-critical",
  assertions: [{ assertionType: "AE-X", warnThreshold: 2, blockThreshold: 5 }],
};

// ═══════════════ §七 · 执行器合成 ═══════════════

describe("AP1 §七 · applyAssertionOverrides 合成到派生挂载", () => {
  it("改阈值：blockThreshold 提高后，同一 progressive 现场不再 block", () => {
    const base = mountOf([{ ...group, assertions: [...group.assertions] }]);
    expect(drive(base, 5)).toBe("block"); // 出厂声明 2/5：第 5 次命中升为闸门

    const fresh = mountOf([{ ...group, assertions: [...group.assertions] }]);
    const r = applyAssertionOverrides(fresh, [
      { kind: "set-assertion-preset", assertions: ["AE-X"], patch: { blockThreshold: 9 } },
    ]);
    expect(r.applied).toHaveLength(1);
    expect(r.ignored).toEqual([]);
    expect(drive(r.mount, 5)).toBe("warn"); // 同输入同轮次：只是阈值抬了，就不再拦
    expect(blocked(applyGatePreset(r.mount, [v("AE-X", "warn")], ctx).problems)).toHaveLength(0);
  });

  it("换门档：gateMode=warn-only 把确定性 block 降成 warn，detail 原样保留", () => {
    const base = mountOf([{ ...group, assertions: [...group.assertions] }]);
    expect(applyGatePreset(base, [v("AE-X", "block", "残渣三处")], ctx).problems[0]!.status).toBe("block");

    const r = applyAssertionOverrides(base, [
      { kind: "set-assertion-preset", assertions: ["AE-X"], patch: { gateMode: "warn-only" } },
    ]);
    const gated = applyGatePreset(r.mount, [v("AE-X", "block", "残渣三处")], ctx);
    expect(gated.problems[0]!.status).toBe("warn");
    expect(gated.problems[0]!.detail).toContain("残渣三处"); // 降级 ≠ 抹掉证据
  });

  it("disable-assertion：免拦人不免检查——证据留、progressive 不计数", () => {
    const base = mountOf([{ ...group, assertions: [...group.assertions] }]);
    const r = applyAssertionOverrides(base, [{ kind: "disable-assertion", assertion: "AE-X" }]);
    expect(r.applied).toEqual(["disable-assertion AE-X"]);

    const first = applyGatePreset(r.mount, [v("AE-X", "block", "别项目专名")], ctx);
    expect(first.problems[0]!.status).toBe("warn");
    expect(first.outcomes[0]!.gateMode).toBe("warn-only");
    expect(first.outcomes[0]!.diagnostic).toMatch(/已被覆盖禁用/);
    // 连打五轮仍不计数：免掉的条款不该在换回预设后背着历史欠账
    for (let i = 0; i < 5; i++) {
      expect(applyGatePreset(r.mount, [v("AE-X", "block")], ctx).problems[0]!.status).toBe("warn");
    }
    expect(base.progressiveState.size).toBe(0);
  });

  it("insert-assertion：组内新增的断言立刻被调制（此前该类型 preset 未声明 ⇒ 恒透传）", () => {
    const r = applyAssertionOverrides(mountOf([{ ...group, assertions: [...group.assertions] }]), [
      { kind: "insert-assertion", group: "g1", assertion: "AE-NEW", patch: { gateMode: "strict" } },
    ]);
    expect(r.ignored).toEqual([]);
    const gated = applyGatePreset(r.mount, [v("AE-NEW", "warn")], ctx);
    expect(gated.problems[0]!.status).toBe("block"); // strict 档生效 = 新断言真有人读
  });

  it("insert-assertion 引用不到（组不存在 / 该组已声明）⇒ ignored，不静默塞重复项", () => {
    const base = mountOf([{ ...group, assertions: [...group.assertions] }]);
    const r = applyAssertionOverrides(base, [
      { kind: "insert-assertion", group: "no-such-group", assertion: "AE-Y" },
      { kind: "insert-assertion", group: "g1", assertion: "AE-X" },
    ]);
    expect(r.applied).toEqual([]);
    expect(r.ignored).toHaveLength(2);
    expect(r.ignored[0]).toMatch(/无此断言组/);
    expect(r.ignored[1]).toMatch(/要改配置走 set-assertion-preset/);
    expect(r.mount).toBe(base); // 一条没落地 ⇒ 不造多余的派生层
  });

  it("set-assertion-preset 改预设没声明的断言 ⇒ ignored 并指路 insert-assertion", () => {
    const r = applyAssertionOverrides(mountOf([{ ...group, assertions: [...group.assertions] }]), [
      { kind: "set-assertion-preset", assertions: ["AE-GHOST"], patch: { blockThreshold: 99 } },
    ]);
    expect(r.applied).toEqual([]);
    expect(r.ignored[0]).toMatch(/未声明该断言；要新增走 insert-assertion/);
  });

  it("presetId 与当前挂载不符 ⇒ 整条不生效（不许跨预设改配置）", () => {
    const r = applyAssertionOverrides(mountOf([{ ...group, assertions: [...group.assertions] }]), [
      { kind: "disable-assertion", presetId: "minimal", assertion: "AE-X" },
    ] satisfies AssertionOverride[]);
    expect(r.applied).toEqual([]);
    expect(r.ignored[0]).toMatch(/指向预设 minimal，当前挂载是 synthetic/);
  });

  it("派生挂载不写回原挂载；progressive 计数与原挂载共享同一个 Map", () => {
    const base = mountOf([{ ...group, assertions: [...group.assertions] }]);
    const r = applyAssertionOverrides(base, [
      { kind: "disable-assertion", assertion: "AE-X" },
      { kind: "insert-assertion", group: "g1", assertion: "AE-Y" },
    ]);
    expect(base.composition.groups[0]!.assertions[0]!.disabled).toBeUndefined(); // 原挂载干净（跨项目污染防线）
    expect(base.composition.groups[0]!.assertions).toHaveLength(1);
    expect(r.mount.composition.groups[0]!.assertions).toHaveLength(2);
    expect(r.mount.progressiveState).toBe(base.progressiveState); // 同一份计数：改阈值不清零重来
    applyGatePreset(r.mount, [v("AE-Y", "warn")], ctx);
    expect(base.progressiveState.get("AE-Y")?.count).toBe(1);
  });
});

// ═══════════════ §七 · flow@3 编排解析 ═══════════════

describe("AP1 §七 · effectiveFlow3 解析断言覆盖", () => {
  const flow3 = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "flows", "topic", "flow.json"), "utf-8")) as never;
  const ov = (patches: unknown[]) =>
    ({ format: "flow-overlay@1", flowId: "topic", origin: "user", reason: "t", patches }) as never;

  it("三类 kind 各落一条：进 assertionOverrides、计入 appliedCount、回显 notes", () => {
    const r = effectiveFlow3(REPO_ROOT, flow3, {
      overlays: [ov([
        { kind: "set-assertion-preset", assertions: ["no-debris", "glossary"], patch: { blockThreshold: 9 }, reason: "渐进太陡" },
        { kind: "disable-assertion", assertion: "AE-PROSE-TRIPLET", reason: "本项目不用三连" },
        { kind: "insert-assertion", group: "integrity", assertion: "AE-OWN", patch: { gateMode: "warn-only" }, reason: "补一条只提醒的" },
      ])],
    });
    expect(r.unsupported).toEqual([]);
    expect(r.appliedCount).toBe(3);
    expect(r.assertionOverrides).toEqual([
      { kind: "set-assertion-preset", assertions: ["no-debris", "glossary"], patch: { blockThreshold: 9 } },
      { kind: "disable-assertion", assertion: "AE-PROSE-TRIPLET" },
      { kind: "insert-assertion", group: "integrity", assertion: "AE-OWN", patch: { gateMode: "warn-only" } },
    ]);
    expect(r.notes.join()).toMatch(/set-assertion-preset \[no-debris、glossary\]/);
  });

  it("形状非法一律 unsupported 且不进 overrides（gateMode 越界 / 阈值 <1 / 未知键 / 空清单 / 缺 group）", () => {
    const r = effectiveFlow3(REPO_ROOT, flow3, {
      overlays: [ov([
        { kind: "set-assertion-preset", assertions: ["exists"], patch: { gateMode: "loose" }, reason: "a" },
        { kind: "set-assertion-preset", assertions: ["exists"], patch: { warnThreshold: 0 }, reason: "b" },
        { kind: "set-assertion-preset", assertions: ["exists"], patch: { gateModes: "strict" }, reason: "c" },
        { kind: "set-assertion-preset", assertions: [], patch: { gateMode: "strict" }, reason: "d" },
        { kind: "insert-assertion", assertion: "AE-Z", reason: "e" },
        { kind: "disable-assertion", reason: "f" },
      ])],
    });
    expect(r.assertionOverrides).toEqual([]);
    expect(r.appliedCount).toBe(0);
    expect(r.unsupported).toHaveLength(6);
    expect(r.unsupported.join()).toMatch(/gateMode=loose（须 warn-only\|block-critical\|strict）/);
    expect(r.unsupported.join()).toMatch(/warnThreshold=0（须 ≥1 的整数）/);
    expect(r.unsupported.join()).toMatch(/未识别键 gateModes/);
  });

  it("status=proposed 的覆盖不参与合成（结构类永不自动落地的同一条纪律）", () => {
    const r = effectiveFlow3(REPO_ROOT, flow3, {
      overlays: [ov([
        { kind: "disable-assertion", assertion: "exists", reason: "待批", status: "proposed" },
      ])],
    });
    expect(r.assertionOverrides).toEqual([]);
    expect(r.appliedCount).toBe(0);
  });

  it("set-policy:defaultPreset 进 policy 白名单；空串/非串回显 unsupported", () => {
    const ok = effectiveFlow3(REPO_ROOT, flow3, {
      overlays: [ov([{ kind: "set-policy", key: "defaultPreset", value: "minimal", reason: "换预设" }])],
    });
    expect(ok.policy.defaultPreset).toBe("minimal");
    expect(ok.overlayHash).not.toBe(effectiveFlow3(REPO_ROOT, flow3).overlayHash); // 换预设 = 编排变了，须触发 replan

    const bad = effectiveFlow3(REPO_ROOT, flow3, {
      overlays: [ov([
        { kind: "set-policy", key: "defaultPreset", value: "  ", reason: "a" },
        { kind: "set-policy", key: "defaultPreset", value: 42, reason: "b" },
      ])],
    });
    expect(bad.unsupported.join()).toMatch(/须非空预设 id 字符串/);
    expect(bad.policy.defaultPreset).toBeUndefined();
  });

  it("flow.json 的 policy.defaultPreset 是三级链的中间档起点", () => {
    const declared = {
      ...(flow3 as object),
      policy: { defaultPreset: "prose-light" },
    } as never;
    expect(effectiveFlow3(REPO_ROOT, declared).policy.defaultPreset).toBe("prose-light");
  });
});

// ═══════════════ §九/§十 · 内核集成 ═══════════════

describe("AP1 §九 · 预设选择三级链（端到端）", () => {
  /** 同一份污染产物在不同预设选择下的裁决。 */
  async function runPolluted(opts: { hostPreset?: string; overlayPatches?: unknown[] } = {}): Promise<{
    status: string; projectDir: string; kernel: Kernel; projectId: string;
  }> {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "miniflow-ap1-"));
    const projectId = "p-ap1";
    const projectDir = path.join(root, "projects", projectId);
    fs.mkdirSync(projectDir, { recursive: true });
    if (opts.overlayPatches) {
      fs.mkdirSync(path.join(projectDir, "registry"), { recursive: true });
      fs.writeFileSync(
        path.join(projectDir, "registry", "overlay.json"),
        JSON.stringify({
          format: "flow-overlay@1", flowId: "topic", origin: "user",
          reason: "AP1 覆盖 e2e", patches: opts.overlayPatches,
        }, null, 2) + "\n",
        "utf-8",
      );
    }
    const kernel = new Kernel({ root, ...(opts.hostPreset ? { assertionPreset: opts.hostPreset } : {}) });
    fs.writeFileSync(path.join(projectDir, "选题素材.md"), "# 选题素材\n\n甲方点子：测试。\n", "utf-8");
    await kernel.flow_run("topic", projectId, { route: "hot", region: "CN", direction: "AP1 覆盖 e2e" });
    expect((await kernel.flow_submit(projectId, "m1.topic-report", {
      content: artifact("topic", "m1.topic-report", "# 选题报告（e2e）\n\n> AP1 夹具。\n", { projectDir }),
    })).status).toBe("accepted");
    const r = await kernel.flow_submit(projectId, "m1.find-trope", {
      content: artifact("topic", "m1.find-trope", "# 梗卡（e2e）\n\n让我先分析一下流程再给结论。\n", { projectDir }),
    });
    return { status: r.status, projectDir, kernel, projectId };
  }
  const presetOf = (projectDir: string): string =>
    (JSON.parse(fs.readFileSync(path.join(projectDir, "state.json"), "utf-8")) as { diagnosticSummary?: string }).diagnosticSummary ?? "<缺省>";

  it("缺省 novel-fanqie：污染正文被 artifact-header（过程元语扫描）拦下，策略摘要写进 state", async () => {
    const { status, projectDir } = await runPolluted();
    expect(status).toBe("rejected");
    // 摘要记的是调制结果 + 现场证据，不只是条款名——下游据此才知道要改哪句
    expect(presetOf(projectDir)).toMatch(/artifact-header\[block-critical/);
    expect(presetOf(projectDir)).toMatch(/｜证据：/);
  });

  it("set-policy:defaultPreset 换预设 ⇒ 同输入放行（编排层 > 出厂缺省）", async () => {
    const { status } = await runPolluted({
      overlayPatches: [{ kind: "set-policy", key: "defaultPreset", value: "minimal", reason: "本项目只留 exists 硬闸" }],
    });
    expect(status).toBe("accepted");
  });

  it("KernelOptions.assertionPreset 压过编排层 defaultPreset（宿主是运行时所有者）", async () => {
    const { status } = await runPolluted({
      hostPreset: "novel-fanqie",
      overlayPatches: [{ kind: "set-policy", key: "defaultPreset", value: "minimal", reason: "编排想换预设" }],
    });
    expect(status).toBe("rejected");
  });

  it("set-assertion-preset 抬门档 ⇒ 同输入不再 block（§七 的端到端可见性）", async () => {
    const { status, projectDir } = await runPolluted({
      overlayPatches: [{
        kind: "set-assertion-preset", assertions: ["artifact-header"], patch: { gateMode: "warn-only" },
        reason: "过程元语只提醒不拦（人工二审兜底）",
      }],
    });
    expect(status).toBe("accepted");
    expect(presetOf(projectDir)).toMatch(/artifact-header\[warn-only/);
  });

  it("disable-assertion ⇒ 证据留痕但放行；引用不到的条目落诊断通道不静默", async () => {
    const { status, projectDir } = await runPolluted({
      overlayPatches: [
        { kind: "disable-assertion", assertion: "artifact-header", reason: "本轮免检" },
        { kind: "disable-assertion", assertion: "AE-GHOST", reason: "预设没声明" },
      ],
    });
    expect(status).toBe("accepted");
    const diag = fs.readFileSync(path.join(projectDir, "registry", "diagnostics.jsonl"), "utf-8");
    expect(diag).toMatch(/AE-GHOST/);
    expect(diag).toMatch(/覆盖未生效/);
    // 免拦 ≠ 免查：条款名与现场仍在摘要里，交出去的产物该长什么样有据可查
    expect(presetOf(projectDir)).toMatch(/已被覆盖禁用/);
    expect(presetOf(projectDir)).toMatch(/artifact-header/);
  });

  it("坏预设 id ⇒ 门控静默不激活：确定性完整性照拦（preset 只调制，不是闸门开关），摘要为空串", async () => {
    const { status, projectDir } = await runPolluted({ hostPreset: "no-such-preset" });
    expect(status).toBe("rejected"); // 无 preset = 结果原样透传，block 不因「预设查不到」而放行
    expect(presetOf(projectDir)).toBe(""); // 走过门点但无任何调制 ⇒ 空串（区别于字段缺省「没走过」）
  });
});

describe("AP1 §十 · 诊断摘要注入下游任务包", () => {
  it("被打回的轮次：diagnosticSummary/diagnosticFrom 随 state 落盘", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "miniflow-ap1-inject-"));
    const projectId = "p-ap1-inject";
    const projectDir = path.join(root, "projects", projectId);
    fs.mkdirSync(projectDir, { recursive: true });
    const kernel = new Kernel({ root });
    fs.writeFileSync(path.join(projectDir, "选题素材.md"), "# 选题素材\n\n甲方点子：测试。\n", "utf-8");
    await kernel.flow_run("topic", projectId, { route: "hot", region: "CN", direction: "AP1 诊断注入 e2e" });
    await kernel.flow_submit(projectId, "m1.topic-report", {
      content: artifact("topic", "m1.topic-report", "# 选题报告（e2e）\n\n> 注入夹具。\n", { projectDir }),
    });
    await kernel.flow_submit(projectId, "m1.find-trope", {
      content: artifact("topic", "m1.find-trope", "# 梗卡（e2e）\n\n让我先分析一下流程再给结论。\n", { projectDir }),
    });

    const state = JSON.parse(fs.readFileSync(path.join(projectDir, "state.json"), "utf-8")) as {
      diagnosticSummary?: string; diagnosticFrom?: string;
    };
    expect(state.diagnosticFrom).toBe("m1.find-trope");
    expect(state.diagnosticSummary).toMatch(/artifact-header/);

    // 下游步的任务包带上这份摘要——写手不必重新踩同一个坑
    const next = await kernel.flow_next(projectId);
    const pkg = (next as { batch?: { taskPackage: { diagnosticSummary?: string; nodeId: string }[] } }).batch?.find(() => true);
    expect(pkg, "flow_next 应派发下游 agent 步").toBeTruthy();
    expect(pkg!.taskPackage.diagnosticSummary).toBe(state.diagnosticSummary);
  });
});
