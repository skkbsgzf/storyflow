/**
 * 批次2.5 P3 · 改相闭环回归（repair-plan@1 + mf_apply_repairs，与 r24-triphase 同范式）：
 *  ① mf_apply_repairs 已注册进改相工具族：repair_plan 必填、path/text 选传；产出 = repair-plan@1 骨架
 *     （diff 回填、status=proposed），全程不写盘（项目目录零新增文件）；
 *  ② 诊→改同源断言：改单条款经 rule_ref 回到盘上规则卡，prompt 携带卡内条款 id 与 repair 原文——
 *     与诊断 prompt（buildCardDiagnosisPrompt）同吃一张卡，结构上不可能「诊 A 改 B」；
 *  ③ 护栏路径显式：B 级条款进单 INVALID_INPUT、条款不存在 CLAUSE_NOT_FOUND、卡不存在 CARD_NOT_FOUND、
 *     repair 与卡面不一致 INVALID_INPUT（同源铁律：改单不得发明卡外策略）；
 *  ④ 契约字段位对齐：工具输出骨架逐键对照 contracts/repair-plan.schema.json（顶层 + item），
 *     不用 JSON-Schema 校验器，TS 侧手工比对（与 r24 ③ 同口径）。
 * LLM 端点不真打：chatOnce 走全局 fetch，vi.stubGlobal 打桩返回固定补全（照 r24-triphase 离线口径）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Kernel } from "../src/kernel.js";
import { buildCardRepairPrompt, repairTools, type AgentModelConfig } from "../src/agent.js";
import { rootOf } from "../src/schema.js";

const CFG: AgentModelConfig = { baseUrl: "http://127.0.0.1:9", model: "mock-model" };

function mkKernel(): { kernel: Kernel; projectDir: string; repoRoot: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "r25-repair-"));
  const pid = "p-r25-demo";
  fs.mkdirSync(path.join(root, "projects", pid), { recursive: true });
  const kernel = new Kernel({ root });
  return { kernel, projectDir: kernel.projectDir(pid), repoRoot: kernel.repoRoot };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/** 读盘上真实规则卡的 frontmatter（与 r24-triphase 同款装载），供改单按卡内原文组装。 */
function readRuleCardFm(stem: string): Record<string, unknown> {
  const raw = fs.readFileSync(path.join(rootOf(), "knowledge", "rules", `${stem}.md`), "utf-8");
  const m = raw.match(/^---\r?\n(.*?)\r?\n---\r?\n/s);
  if (!m) throw new Error(`规则卡缺 frontmatter：kb/rules/${stem}`);
  return JSON.parse(m[1] ?? "{}") as Record<string, unknown>;
}

const MOCK_DIFF = '--- a/正文.md\n+++ b/正文.md\n@@ -3,1 +3,1 @@\n-旧句\n+新句';

function stubRepairFetch(captured: { prompts: string[] }): void {
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: { body?: string }) => {
    captured.prompts.push(JSON.parse(init?.body ?? "{}").messages?.[1]?.content ?? "");
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({ diff: MOCK_DIFF }) } }] }),
    };
  }));
}

describe("批次2.5 P3 · 改相闭环（mf_apply_repairs + repair-plan@1）", () => {
  it("① 工具注册：mf_apply_repairs 在改相工具族、repair_plan 必填、path/text 选传", () => {
    const { kernel, projectDir, repoRoot } = mkKernel();
    const tools = repairTools(CFG, kernel, projectDir, repoRoot);
    expect(tools.map((t) => t.name)).toEqual(["mf_apply_repairs"]);
    const tool = tools[0]!;
    expect(tool.parameters).toMatchObject({ type: "object" });
    expect(tool.parameters.required).toEqual(["repair_plan"]);
    const props = tool.parameters.properties as Record<string, unknown>;
    expect(Object.keys(props).sort()).toEqual(["path", "repair_plan", "text"].sort());
    // 改相纪律写在工具描述里（宿主可见面上第一眼就是护栏）
    expect(tool.description).toContain("绝不写盘");
    expect(tool.description).toContain("B 级");
  });

  it("① 实跑：合法改单 → 逐条产出 unified diff（status=proposed），全程不写盘", async () => {
    const { kernel, projectDir, repoRoot } = mkKernel();
    const fm = readRuleCardFm("curve");
    const clause = (fm.clauses as { rule_id: string; tier: string; repair: string }[])[0]!;
    const captured = { prompts: [] as string[] };
    stubRepairFetch(captured);
    const tools = repairTools(CFG, kernel, projectDir, repoRoot);
    const tool = tools.find((t) => t.name === "mf_apply_repairs")!;
    const plan = {
      format: "repair-plan@1",
      project: "p-r25-demo",
      target: "正文/第01章.md",
      diagnosis_ref: "projects/p-r25-demo/reports/diag-01.json",
      items: [{ rule_ref: `kb/rules/curve#${clause.rule_id}`, repair: clause.repair, tier: clause.tier, status: "proposed" }],
      summary: "测试改单",
    };
    const out = JSON.parse(await tool.exec({ repair_plan: JSON.stringify(plan), text: "测试正文" })) as {
      format: string; items: { diff: string; status: string }[];
    };
    // diff 输出形状：unified diff 标志行（---/+++/@@），status 停在 proposed
    expect(out.format).toBe("repair-plan@1");
    expect(out.items).toHaveLength(1);
    expect(out.items[0]!.diff).toBe(MOCK_DIFF);
    expect(out.items[0]!.diff).toContain("--- ");
    expect(out.items[0]!.diff).toContain("@@ ");
    expect(out.items[0]!.status).toBe("proposed");
    // 全程不写盘：项目目录零新增文件（改相铁律：工具链只产 diff，绝不写正文）
    const walk = (dir: string): string[] =>
      fs.existsSync(dir) ? fs.readdirSync(dir).flatMap((x) => {
        const p = path.join(dir, x);
        return fs.statSync(p).isDirectory() ? walk(p) : [p];
      }) : [];
    expect(walk(projectDir)).toEqual([]);
  });

  it("② 诊→改同源：同一 rule_ref 从卡进 prompt——条款 id 与 repair 原文同入，且改相纪律在 prompt 明示", async () => {
    const { kernel, projectDir, repoRoot } = mkKernel();
    const fm = readRuleCardFm("curve");
    const clause = (fm.clauses as { rule_id: string; tier: string; repair: string }[])[0]!;
    const captured = { prompts: [] as string[] };
    stubRepairFetch(captured);
    const tools = repairTools(CFG, kernel, projectDir, repoRoot);
    const tool = tools.find((t) => t.name === "mf_apply_repairs")!;
    await tool.exec({
      repair_plan: JSON.stringify({
        format: "repair-plan@1", project: "p", target: "正文.md", diagnosis_ref: null,
        items: [{ rule_ref: `kb/rules/curve#${clause.rule_id}`, repair: clause.repair }],
        summary: "",
      }),
      text: "测试正文",
    });
    expect(captured.prompts).toHaveLength(1);
    const prompt = captured.prompts[0]!;
    expect(prompt).toContain(`kb/rules/curve#${clause.rule_id}`); // 改的锚点 = 诊的锚点（同一 rule_ref）
    expect(prompt).toContain(clause.repair);                      // 策略原文来自卡（同源铁律）
    expect(prompt).toContain("顺手美化");                          // 只改本条款所涉，明示不做顺手美化
    expect(prompt).toContain("unified diff");                     // 只出 diff，不整篇改写
  });

  it("③ 护栏路径显式：B 级拒绝（INVALID_INPUT）/ 条款不存在（CLAUSE_NOT_FOUND）/ 卡不存在（CARD_NOT_FOUND）/ repair 发明卡外策略（INVALID_INPUT）", async () => {
    const { kernel, projectDir, repoRoot } = mkKernel();
    const tools = repairTools(CFG, kernel, projectDir, repoRoot);
    const tool = tools.find((t) => t.name === "mf_apply_repairs")!;
    const mkPlan = (items: unknown) => JSON.stringify({
      format: "repair-plan@1", project: "p", target: "正文.md", diagnosis_ref: null, items, summary: "",
    });
    // B 级条款进单：kb/rules/pacing#AE-CUSHION 盘上 tier=B → INVALID_INPUT 显式拒绝（绝不静默改稿）
    const pacing = readRuleCardFm("pacing");
    const bClause = (pacing.clauses as { rule_id: string; tier: string; repair: string }[]).find((c) => c.tier === "B")!;
    await expect(tool.exec({ repair_plan: mkPlan([{ rule_ref: `kb/rules/pacing#${bClause.rule_id}`, repair: bClause.repair }]), text: "正文" }))
      .rejects.toThrow(/B 级/);
    // 条款不存在：卡真实在盘但 clauses 无此 AE-id
    await expect(tool.exec({ repair_plan: mkPlan([{ rule_ref: "kb/rules/curve#AE-NO-SUCH-CLAUSE", repair: "x" }]), text: "正文" }))
      .rejects.toThrow(/条款不存在/);
    // 卡不存在：与 mf_analyze_card 同款 CARD_NOT_FOUND
    await expect(tool.exec({ repair_plan: mkPlan([{ rule_ref: "kb/rules/no-such-card#AE-X", repair: "x" }]), text: "正文" }))
      .rejects.toThrow(/卡不存在/);
    // 同源铁律：repair 与卡面不一致（发明卡外策略）→ 拒绝；且校验在动 LLM 之前（fetch 未被调用）
    const curve = readRuleCardFm("curve");
    const c0 = (curve.clauses as { rule_id: string; repair: string }[])[0]!;
    const captured = { prompts: [] as string[] };
    stubRepairFetch(captured);
    await expect(tool.exec({ repair_plan: mkPlan([{ rule_ref: `kb/rules/curve#${c0.rule_id}`, repair: "我自己想的新策略" }]), text: "正文" }))
      .rejects.toThrow(/与卡面不一致/);
    expect(captured.prompts).toHaveLength(0);
  });

  it("④ 契约字段位对齐：工具输出骨架逐键对照 contracts/repair-plan.schema.json（手查，不用校验器）", async () => {
    const { kernel, projectDir, repoRoot } = mkKernel();
    const schema = JSON.parse(fs.readFileSync(path.join(rootOf(), "contracts", "repair-plan.schema.json"), "utf-8")) as {
      required: string[];
      properties: Record<string, unknown>;
      definitions: { item: { required: string[]; properties: Record<string, unknown> } };
    };
    const fm = readRuleCardFm("meme");
    const clause = (fm.clauses as { rule_id: string; tier: string; repair: string }[]).find((c) => c.tier === "S")!;
    const captured = { prompts: [] as string[] };
    stubRepairFetch(captured);
    const tools = repairTools(CFG, kernel, projectDir, repoRoot);
    const tool = tools.find((t) => t.name === "mf_apply_repairs")!;
    const out = JSON.parse(await tool.exec({
      repair_plan: JSON.stringify({
        format: "repair-plan@1", project: "p", target: "正文.md", diagnosis_ref: null,
        items: [{ rule_ref: `kb/rules/meme#${clause.rule_id}`, repair: clause.repair }],
        summary: "",
      }),
      text: "正文",
    })) as Record<string, unknown>;
    // 顶层：required 全在，且没有 schema 之外的键（additionalProperties: false 的手工等价）
    expect(Object.keys(out).sort()).toEqual([...schema.required].sort());
    // item：required 全在，键集 ⊆ schema properties（status/receipt 由工具置初始态）
    const item = out.items as Record<string, unknown>[];
    expect(Object.keys(item[0]!).sort()).toEqual(Object.keys(schema.definitions.item.properties).sort());
    expect(out.format).toBe("repair-plan@1");
    expect(item[0]!.status).toBe("proposed");
    expect(item[0]!.receipt).toBeNull();
  });

  it("④ 改相 prompt 纯函数：与诊断 prompt 同先例，可离线组装（无网络无盘）", () => {
    const prompt = buildCardRepairPrompt(
      "kb/rules/curve#AE-CURVE-TYPE",
      { rule_id: "AE-CURVE-TYPE", tier: "A", repair: "按主型修整曲线走势" },
      "正文",
    );
    expect(prompt).toContain("AE-CURVE-TYPE");
    expect(prompt).toContain("按主型修整曲线走势");
    expect(prompt).toContain('{"diff"');
  });
});
