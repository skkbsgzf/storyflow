/**
 * OS-02 阶段 C/D 回归（2026-09-20）——本批消灭的是**四类「声明了却不生效」**：
 *
 *   C#10  `model_tier` 缺省默认 `high`（引擎替作者拍板）→ 缺省 = **不约束**
 *   D#13  `modules[].iterate` 只有类型声明、零传播 → **真的落到派生交付节点**
 *   D#14  `timeoutMs` 只活在契约里（spawn 不带 timeout）→ **脚本卡住不再拖死内核**
 *   N2    `adapt:"off"` 与 `propose` 行为等价 → **off = 只观测，不产出提案**
 *   N4    `R7` 产退役键 `set-policy{kit_boundary}`（flow@3 不认）→ 改产 **per-link `set-link`**
 *
 * 断言方式统一为「关系而非清单」：不抄 kind 名单，只验「产出的东西被消费者真的读到了」。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { effectiveFlow3, expandFlow3, defaultArtifactTemplate } from "../src/modules.js";
import { resolveToolConfig } from "../src/kits.js";
import { overlayFromProposals, proposeFromMetrics, isStructuralPatch, type Proposal } from "../src/optimize.js";
import { runCoreNode } from "../src/minitools.js";
import { ROOT } from "../src/schema.js";
import { resolveBudget, DEFAULT_BUDGET } from "../src/budget.js";
import { summarizeMetrics } from "../src/metrics.js";
import { Kernel } from "../src/kernel.js";
import { CONFIG_FILE } from "../src/project-config.js";
import { proseAsserts, chapterLengthAssert } from "../src/aesthetic.js";
import type { FlowDescriptor, MetricsSummary, RunState } from "../src/types.js";
import type { FlowPolicy } from "../src/overlay.js";

/** 真实 flow@3：caocao m3 声明了 `iterate`（正是本批要救活的那条声明）。 */
function caocao(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(ROOT, "flows", "test-dual", "flow.json"), "utf-8"));
}

describe("OS-02 C#10 · model_tier 缺省 = 不约束（不再默认 high）", () => {
  it("通用配置面不再有 default；未声明 ⇒ undefined（不是 high）", () => {
    const res = resolveToolConfig(undefined, undefined, undefined);
    expect(res.defs.model_tier).toBeTruthy(); // 旋钮仍在（能力必须有家）
    expect(res.defs.model_tier.default).toBeUndefined(); // 但不替作者拍板
    expect(res.values.model_tier).toBeUndefined();
  });

  it("显式声明仍然生效（node 级 > 通用）", () => {
    const res = resolveToolConfig(undefined, { model_tier: "lite" }, undefined);
    expect(res.values.model_tier).toBe("lite");
    expect(res.sources.model_tier).toBe("node");
  });
});

describe("OS-02 D#13 · 模块 iterate → 派生节点传播", () => {
  it("caocao m3 的模块级声明落到**交付节点**，并派生单实例产物模板", () => {
    const r = expandFlow3(ROOT, caocao() as never);
    const members = (r.moduleNodes["m3"] ?? []).filter((id) => r.flow.graph.nodes[id]?.output);
    const target = members[members.length - 1]; // 交付节点 = 模块内最后一个有产物节点（与 derivedOutputs 同口径）
    const it = r.flow.graph.nodes[target].iterate;
    expect(it).toBeTruthy();
    expect(it.unit).toBe("chapter");
    expect(it.over).toBe("大纲");
    expect(it.first).toBe(1); // 本期实例数量（前端以「本期前 N chapter」呈现）
    expect(it.artifact).toContain("{n}");
    expect(it.artifact).toContain("第");
    // 只落交付节点，不整模块铺开（否则页面前端 `.find()` 会取错节点）
    expect(members.filter((id) => id !== target && r.flow.graph.nodes[id].iterate)).toEqual([]);
    // 展开期事实必须回显，不许静默
    expect((r.notes ?? []).some((n) => n.includes("iterate 传播") && n.includes(target))).toBe(true);
  });

  it("未声明 iterate 的模块（m1/m4）不产生任何 iterate 节点", () => {
    const r = expandFlow3(ROOT, caocao() as never);
    const stray = (r.moduleNodes["m1"] ?? []).concat(r.moduleNodes["m4"] ?? [])
      .filter((id) => r.flow.graph.nodes[id]?.iterate);
    expect(stray).toEqual([]);
  });

  it("生效编排（effectiveFlow3）里派生节点真的带 iterate —— 此前 effective.json 里恒为 it=[]", () => {
    const r = effectiveFlow3(ROOT, caocao() as never, {});
    const withIt = Object.entries(r.flow.graph.nodes as Record<string, { iterate?: unknown }>)
      .filter(([, n]) => !!n.iterate).map(([id]) => id);
    expect(withIt.length).toBe(1);
    expect(withIt[0].startsWith("m3.")).toBe(true);
  });

  it("默认产物模板规则：<目录>/<产物名去扩展名>/<单位样式><扩展名>", () => {
    expect(defaultArtifactTemplate("03-写作/章节正文.md", "chapter")).toBe("03-写作/章节正文/第{n}章.md");
    expect(defaultArtifactTemplate("02-分镜/分镜表.md", "shot")).toBe("02-分镜/分镜表/镜{n}.md");
    expect(defaultArtifactTemplate("x.md", "weird-unit")).toBe("x/{n}.md"); // 未登记单位退化裸 {n}
  });

  it("显式 artifact 优先于派生（作者可覆盖）", () => {
    const flow = caocao() as { modules: Array<Record<string, unknown>> };
    flow.modules[2].iterate = { unit: "chapter", over: "大纲", first: 3, artifact: "03-写作/章节正文/第{n}章.md" };
    const r = expandFlow3(ROOT, flow as never);
    const target = (r.moduleNodes["m3"] ?? []).filter((id) => r.flow.graph.nodes[id]?.output).pop()!;
    expect(r.flow.graph.nodes[target].iterate.artifact).toBe("03-写作/章节正文/第{n}章.md");
    expect(r.flow.graph.nodes[target].iterate.first).toBe(3);
  });
});

describe("OS-02 N4 · set-link（per-link 降级通道）", () => {
  it("flow@3 真的消费 set-link：改连接件模式，计入 appliedCount", () => {
    const flow = caocao() as Record<string, unknown>;
    expect((expandFlow3(ROOT, flow as never) as { flow: { graph: { nodes: Record<string, { link_mode?: string }> } } })
      .flow.graph.nodes["m2.link"].link_mode).toBe("manual"); // 前置事实
    const ov = {
      format: "flow-overlay@1", flowId: "test-dual", origin: "user",
      patches: [{ kind: "set-link", link: "m2.link", mode: "auto", reason: "连续全过，降噪" }],
    };
    const r = effectiveFlow3(ROOT, flow as never, { overlays: [ov] });
    expect(r.appliedCount).toBe(1);
    expect(r.unsupported).toEqual([]);
    expect((r.flow.graph.nodes["m2.link"] as { link_mode?: string }).link_mode).toBe("auto");
    expect(r.notes.some((n) => n.includes("set-link m2.link=auto"))).toBe(true);
  });

  it("裸实例 id（不带 .link）也认；实例不存在 / 模式非法 ⇒ 显式 unsupported，不计 applied", () => {
    const flow = caocao() as Record<string, unknown>;
    const mk = (patch: Record<string, unknown>) => ({
      format: "flow-overlay@1", flowId: "test-dual", origin: "user", patches: [patch],
    });
    const bare = effectiveFlow3(ROOT, flow as never, {
      overlays: [mk({ kind: "set-link", link: "m2", mode: "manual", reason: "t" })],
    });
    expect(bare.appliedCount).toBe(1);

    const ghost = effectiveFlow3(ROOT, flow as never, {
      overlays: [mk({ kind: "set-link", link: "m9.link", mode: "auto", reason: "t" })],
    });
    expect(ghost.appliedCount).toBe(0);
    expect(ghost.unsupported.join("｜")).toContain("m9.link");

    const badMode = effectiveFlow3(ROOT, flow as never, {
      overlays: [mk({ kind: "set-link", link: "m2.link", mode: "sometimes", reason: "t" })],
    });
    expect(badMode.appliedCount).toBe(0);
    expect(badMode.unsupported.join("｜")).toContain("sometimes");
  });

  it("set-link 属结构类：adapt=apply 也不自动落地（搬动的是「哪里必须人批」）", () => {
    expect(isStructuralPatch({ kind: "set-link" })).toBe(true);
    const p: Proposal = {
      id: "R7@m2.link", rule: "R7-boundary-auto", severity: "medium", risk: "medium",
      title: "t", reason: "r",
      evidence: { rule: "R7-boundary-auto", metric: "boundary.sendBacks", value: 0, samples: 5 },
      patch: { kind: "set-link", link: "m2.link", mode: "auto", reason: "r" },
    };
    const ov = overlayFromProposals([p], { flowId: "f", adapt: "apply" });
    expect(ov.patches).toHaveLength(1);
    expect(ov.patches[0].status).toBe("proposed");
  });

  it("R7 规则：连接件连续全过 → 产 set-link（不是退役键 set-policy{kit_boundary}）", () => {
    const flow = {
      graph: { nodes: { "m2.link": { kind: "gate", gate_role: "link", link_mode: "manual" } }, edges: [] },
      outputs: [],
    } as never as FlowDescriptor;
    const summary = {
      events: 5, byNode: {}, byTool: {}, knowledge: [],
      gates: [{ nodeId: "m2.link", phase: "link", passes: 5, sendBacks: 0, samples: 5 }],
      window: {},
    } as never as MetricsSummary;
    const props = proposeFromMetrics(flow, summary, { root: ROOT, policy: {} as FlowPolicy });
    const r7 = props.find((p) => p.rule === "R7-boundary-auto");
    expect(r7).toBeTruthy();
    expect(r7!.patch.kind).toBe("set-link");
    expect((r7!.patch as { link?: string }).link).toBe("m2.link");
    expect((r7!.patch as { mode?: string }).mode).toBe("auto");
    expect(r7!.risk).toBe("medium"); // 结构类，永不自落

    // 已经是 auto ⇒ 不再重复提案
    const autoFlow = {
      graph: { nodes: { "m2.link": { kind: "gate", gate_role: "link", link_mode: "auto" } }, edges: [] },
      outputs: [],
    } as never as FlowDescriptor;
    expect(proposeFromMetrics(autoFlow, summary, { root: ROOT, policy: {} as FlowPolicy })
      .some((p) => p.rule === "R7-boundary-auto")).toBe(false);
  });
});

describe("OS-02 N2 · adapt:\"off\" = 只观测，不产出提案", () => {
  const p: Proposal = {
    id: "R4@m-plot.bible", rule: "R4-tier-down", severity: "medium", risk: "low",
    title: "t", reason: "r",
    evidence: { rule: "R4-tier-down", metric: "efficiency", value: 0.5, samples: 4 },
    patch: { kind: "set-tool", kit: "m-plot", op: "bible", model_tier: "lite", reason: "r" },
  };

  it("off ⇒ 零补丁（此前与 propose 完全等价，那是「契约里的装饰」）", () => {
    const ov = overlayFromProposals([p], { flowId: "f", adapt: "off" });
    expect(ov.patches).toEqual([]);
    expect(ov.reason).toContain("只观测");
    expect(ov.reason).toContain("1 条"); // 观测到几条要如实说
  });

  it("propose ⇒ proposed；apply ⇒ 低风险内容类 applied（两种语义不变）", () => {
    expect(overlayFromProposals([p], { flowId: "f", adapt: "propose" }).patches[0].status).toBe("proposed");
    expect(overlayFromProposals([p], { flowId: "f", adapt: "apply" }).patches[0].status).toBe("applied");
  });
});

describe("OS-02 D#14 · 脚本壳超时真的生效（不再把内核拖死）", () => {
  it("到时内核终止子进程并显式报「超时」，而不是静默挂住", async () => {
    const pd = fs.mkdtempSync(path.join(os.tmpdir(), "miniflow-timeout-"));
    fs.mkdirSync(path.join(pd, "registry"), { recursive: true });
    fs.writeFileSync(path.join(pd, "src.md"), "# 源\n正文", "utf-8");
    const flow = {
      graph: {
        nodes: {
          up: { kind: "novel-txt", output: "src.md" },
          n1: { kind: "core", script: "core/test/__fixtures__/slow-script.py", output: "out/x.docx" },
        },
        edges: [{ id: "e1", from: "up", to: "n1", role: "flow" }],
      },
    } as never as FlowDescriptor;
    const st = {
      runId: "r-t", projectId: "p-t", status: "running",
      nodes: { up: { status: "done", lastArtifact: "src.md" } },
    } as never as RunState;

    const t0 = Date.now();
    const res = await runCoreNode(pd, flow, st, "n1", { timeoutMs: 1200 });
    const dt = Date.now() - t0;
    expect(res.ok).toBe(false);
    expect(res.kind).toBe("assert");
    expect(res.reason).toContain("超时");
    expect(res.reason).toContain("1200ms");
    expect(dt).toBeLessThan(7000); // 真的被杀掉，而不是等夹具睡完 8s
  }, 20000);
});

describe("OS-02 C#11 · 阈值预算面（policy.budget = 唯一覆盖入口）", () => {
  it("出厂默认全在 values、来源全 factory、零告警 —— 「声明」与「生效」逐键对齐", () => {
    const r = resolveBudget(undefined);
    expect(r.issues).toEqual([]);
    expect(r.overridden).toBe(false);
    // 键集必须一一对应（此前 policy.budget 声明三键却零消费者：声明≠生效）
    expect(Object.keys(r.values).sort()).toEqual(Object.keys(DEFAULT_BUDGET).sort());
    expect(new Set(Object.values(r.sources))).toEqual(new Set(["factory"]));
    expect(r.values.contextBudget).toBe(20000);
    expect(r.values.chapterBlockChars).toBe(800);
  });

  it("项目覆盖生效并留痕（sources=policy / overridden=true / 未覆盖的仍出厂）", () => {
    const r = resolveBudget({ budget: { chapterBlockChars: 1200 } } as FlowPolicy);
    expect(r.values.chapterBlockChars).toBe(1200);
    expect(r.sources.chapterBlockChars).toBe("policy");
    expect(r.overridden).toBe(true);
    expect(r.values.contextBudget).toBe(20000);
    expect(r.issues).toEqual([]); // 合法覆盖不该报错
  });

  it("未知键 / 非数 / 越界 ⇒ 显式 issues 且**不生效**（绝不静默丢弃）", () => {
    const r = resolveBudget({ budget: { nope: 1, contextBudget: "big", chapterBlockChars: 10 } } as never);
    const joined = r.issues.join("｜");
    expect(joined).toContain("nope");
    expect(joined).toContain("contextBudget");
    expect(joined).toContain("chapterBlockChars");
    expect(r.values.contextBudget).toBe(20000); // 非数 ⇒ 保持出厂
    expect(r.values.chapterBlockChars).toBe(800); // 越界 ⇒ 保持出厂
    expect("nope" in r.values).toBe(false); // 未知键不进生效面（但被点名）
  });

  it("交叉校验：maxContextChars 装不下 contextBudget+skillCap+kbTotalCap ⇒ 响亮告警", () => {
    const r = resolveBudget({ budget: { maxContextChars: 5000 } } as FlowPolicy);
    expect(r.issues.some((x) => x.includes("maxContextChars") && x.includes("截断"))).toBe(true);
    // 同向调整（一起抬高）就不该告警
    const ok = resolveBudget({ budget: { maxContextChars: 40000 } } as FlowPolicy);
    expect(ok.issues).toEqual([]);
  });

  it("关系断言 · 文风配额：同一段文本，阈值调高即从 warn 转 pass（aesthetic.ts 真读了预算）", () => {
    const text = "# 章\n他忽然站起。她突然回头。风突然停了。雨突然落了。";
    const strict = proseAsserts(text).find((v) => v.name === "AE-PROSE-RHYTHM")!;
    expect(strict.status).toBe("warn"); // 4 处 > 出厂配额 2
    const loose = proseAsserts(text, resolveBudget({ budget: { fillerQuota: 10 } } as FlowPolicy).values)
      .find((v) => v.name === "AE-PROSE-RHYTHM")!;
    expect(loose.status).toBe("pass");
    expect(loose.detail).toContain("10"); // 生效值必须回显，不许假装还是 2
  });

  it("关系断言 · 章长下限：块阈值调高 ⇒ 同一章从 warn 转 block", () => {
    const text = "## 第1章\n" + "字".repeat(900) + "\n\n## 第2章\n" + "字".repeat(900);
    const base = chapterLengthAssert(text);
    expect(base.status).toBe("warn"); // 900 ≥ 出厂 block 800，但低于 warn 1800（章长基准 2000/章）
    const strict = chapterLengthAssert(text, resolveBudget({ budget: { chapterBlockChars: 2000 } } as FlowPolicy).values);
    expect(strict.status).toBe("block");
    expect(strict.detail).toContain("2000");
  });

  it("关系断言 · 成本系数：打回溢价调高 ⇒ 同一份指标算出的成本更高（metrics.ts 真读了预算）", () => {
    const ev = (o: Record<string, unknown>): never => ({ ts: "2026-09-20T00:00:00Z", ...o }) as never;
    const events = [ev({ phase: "submit", nodeId: "n", kit: "k", op: "o", checks: { pass: 1, block: 2 } })];
    const base = summarizeMetrics(events).byNode.n.cost;
    const pricey = summarizeMetrics(events, { budget: resolveBudget({ budget: { costBlockPremium: 50 } } as FlowPolicy).values })
      .byNode.n.cost;
    expect(pricey).toBeGreaterThan(base);
    expect(pricey - base).toBeCloseTo(2 * (50 - 5), 5); // 2 次打回 × 溢价差
  });
});

describe("OS-02 C#11 · 端到端：项目配置.json 的「阈值预算」→ policy.budget → effective.json", () => {
  /** 造一个只含「项目配置 + 可选项目 overlay」的最小项目目录（不跑内核，只验生效面派生）。 */
  function mkProj(cfg?: Record<string, unknown>, overlay?: Record<string, unknown>): string {
    const pd = fs.mkdtempSync(path.join(os.tmpdir(), "miniflow-budget-"));
    fs.mkdirSync(path.join(pd, "registry"), { recursive: true });
    // 「项目」必须与目录名一致（内核开跑前大声失败的第一道校验）
    if (cfg) fs.writeFileSync(path.join(pd, CONFIG_FILE), JSON.stringify({ ...cfg, 项目: path.basename(pd) }, null, 2), "utf-8");
    if (overlay) fs.writeFileSync(path.join(pd, "registry", "overlay.json"), JSON.stringify(overlay, null, 2), "utf-8");
    return pd;
  }
  const k = new Kernel({ root: ROOT, repoRoot: ROOT });
  const flow3 = caocao() as never;

  it("项目配置的阈值真的进了 policy.budget，并解开 overridden/sources（此前该键零消费者）", () => {
    const pd = mkProj({ 项目: "p", 阈值预算: { chapterBlockChars: 1200, fillerQuota: 0 } });
    const eff = k.effectiveOf(pd, flow3);
    expect((eff.policy as { budget?: Record<string, number> }).budget?.chapterBlockChars).toBe(1200);
    const b = resolveBudget(eff.policy as FlowPolicy);
    expect(b.values.chapterBlockChars).toBe(1200);
    expect(b.sources.chapterBlockChars).toBe("policy");
    expect(b.values.fillerQuota).toBe(0);
    expect(b.overridden).toBe(true);
    // 未覆盖的键仍走出厂默认（不是被整体替换掉）
    expect(b.values.contextBudget).toBe(20000);
  });

  it("无配置 ⇒ 不产生 policy.budget（不强加空层，重叠零噪音）", () => {
    const eff = k.effectiveOf(mkProj(), flow3);
    expect((eff.policy as { budget?: unknown }).budget).toBeUndefined();
    expect(resolveBudget(eff.policy as FlowPolicy).overridden).toBe(false);
  });

  it("优先级：flow 模板层 < 项目配置（实例层）< 项目 overlay（运行时调整层）", () => {
    const pd = mkProj(
      { 项目: "p", 阈值预算: { contextBudget: 30000, chapterBlockChars: 1200 } },
      {
        format: "flow-overlay@1", flowId: "test-dual", origin: "user",
        patches: [{ kind: "set-policy", key: "budget", value: { chapterBlockChars: 2500 }, reason: "t" }],
      },
    );
    const eff = k.effectiveOf(pd, flow3);
    const budget = (eff.policy as { budget?: Record<string, number> }).budget ?? {};
    // 实例层给的两键里：被 overlay 点名的键归 overlay；没点名的键保留实例层声明
    expect(budget.chapterBlockChars).toBe(2500);
    expect(budget.contextBudget).toBe(30000);
  });

  it("flow@3 承认 set-policy{budget}（此前不在 policy 白名单 ⇒ 结构性调不了阈值）", () => {
    const pd = mkProj(undefined, {
      format: "flow-overlay@1", flowId: "test-dual", origin: "user",
      patches: [{ kind: "set-policy", key: "budget", value: { minBeats: 8 }, reason: "t" }],
    });
    const eff = k.effectiveOf(pd, flow3);
    expect(eff.appliedCount).toBe(1);
    expect(resolveBudget(eff.policy as FlowPolicy).values.minBeats).toBe(8);
  });

  it("形状错的值（非「键→number」对象）显式 unsupported，不进 policy（绝不静默）", () => {
    const pd = mkProj(undefined, {
      format: "flow-overlay@1", flowId: "test-dual", origin: "user",
      patches: [{ kind: "set-policy", key: "budget", value: 5, reason: "t" }],
    });
    const eff = k.effectiveOf(pd, flow3);
    const out = (eff as unknown as { unsupported?: string[] }).unsupported ?? [];
    expect(out.join("｜")).toContain("budget");
    expect((eff.policy as { budget?: unknown }).budget).toBeUndefined();
  });

  it("项目配置非法 ⇒ 显式报错（沿用既有文案），绝不静默丢弃阈值面", () => {
    const pd = mkProj({ 项目: "p", 严肃性: "随便" });
    expect(() => k.effectiveOf(pd, flow3)).toThrow(/项目配置非法/);
  });
});
