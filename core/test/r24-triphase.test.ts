/**
 * R2.4 写诊改三相打通 · 三相一致性回归（同源铁律的结构断言，ARCHITECTURE §3.2）：
 *  ① 卡驱动诊断工具 mf_analyze_card 已在 agent 工具环，任意 kb/rules 规则卡都能组装诊断 prompt；
 *  ② 诊与建同一来源：prompt 同时携带卡内条款 id（clauses[].rule_id）与修复策略文本（clauses[].repair）——
 *     结构上不可能「诊的是 A 条款、建的是 B 主意」；
 *  ③ 输出契约对齐 diagnosis-report@1 的 items 语义字段位（rule_ref/tier/severity/evidence/suggestion）；
 *  ④ mf_analyze_curve 保留为薄别名：内部调通用实现，卡固定 kb/aesthetic/emotion-curve；
 *  ⑤ 卡不存在 = 显式 CARD_NOT_FOUND（不静默）；缺 card 参数 = 显式 INVALID_INPUT。
 * LLM 端点不真打：chatOnce 走全局 fetch，用 vi.stubGlobal 打桩返回固定补全（照 agent.test.ts 的离线口径）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Kernel } from "../src/kernel.js";
import { analysisTools, buildCardDiagnosisPrompt, type AgentModelConfig } from "../src/agent.js";
import { rootOf } from "../src/schema.js";

const CFG: AgentModelConfig = { baseUrl: "http://127.0.0.1:9", model: "mock-model" };

function mkKernel(): { kernel: Kernel; projectDir: string; repoRoot: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "r24-triphase-"));
  const pid = "p-r24-demo";
  fs.mkdirSync(path.join(root, "projects", pid), { recursive: true });
  const kernel = new Kernel({ root });
  return { kernel, projectDir: kernel.projectDir(pid), repoRoot: kernel.repoRoot };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/** 读盘上真实规则卡（knowledge/rules/<stem>.md，语料本地层现读盘）并解析 JSON frontmatter。 */
function readRuleCard(stem: string): { raw: string; fm: Record<string, unknown> } {
  const raw = fs.readFileSync(path.join(rootOf(), "knowledge", "rules", `${stem}.md`), "utf-8");
  const m = raw.match(/^---\r?\n(.*?)\r?\n---\r?\n/s);
  if (!m) throw new Error(`规则卡缺 frontmatter：kb/rules/${stem}`);
  return { raw, fm: JSON.parse(m[1]) as Record<string, unknown> };
}

describe("R2.4 · 卡驱动诊断工具（mf_analyze_card）", () => {
  it("① 工具环注册：mf_analyze_card 在环、card 必填；mf_analyze_curve 薄别名在环且无 card 参数；mf_analyze_character 保持原样", () => {
    const { kernel, projectDir, repoRoot } = mkKernel();
    const tools = analysisTools(CFG, kernel, projectDir, repoRoot);
    const names = tools.map((t) => t.name);
    expect(names).toContain("mf_analyze_card");
    expect(names).toContain("mf_analyze_curve");
    expect(names).toContain("mf_analyze_character");
    const card = tools.find((t) => t.name === "mf_analyze_card")!;
    expect(card.parameters).toMatchObject({ type: "object" });
    expect(card.parameters.required).toEqual(["card"]);
    const alias = tools.find((t) => t.name === "mf_analyze_curve")!;
    expect((alias.parameters.properties as Record<string, unknown>).card).toBeUndefined();
    expect(alias.parameters.required).toEqual(["path"]); // 兼容历史形状：别名仍要求 path
  });

  it("① 任意 kb/rules 卡都能组装 prompt：16 张卡逐卡过 prompt 组装器（卡存在、条款升格齐）", () => {
    const { kernel, projectDir, repoRoot } = mkKernel();
    const tools = analysisTools(CFG, kernel, projectDir, repoRoot);
    const tool = tools.find((t) => t.name === "mf_analyze_card")!;
    const stems = fs.readdirSync(path.join(rootOf(), "knowledge", "rules"))
      .filter((f) => f.endsWith(".md") && f !== "README.md")
      .map((f) => f.replace(/\.md$/, ""));
    expect(stems.length).toBe(16); // 全仓域卡数钉住：收敛不许悄悄丢卡
    for (const stem of stems) {
      const { raw, fm } = readRuleCard(stem);
      // 卡在盘上（工具按盘上核账读卡不炸）且 prompt 组装包含卡内容与卡 id
      const prompt = buildCardDiagnosisPrompt(`kb/rules/${stem}`, raw, "测试正文");
      expect(prompt).toContain(String(fm.id));
      expect(prompt).toContain(String(fm.title));
      // 收敛字段齐：format + clauses 逐条带 rule_id/tier/severity/repair
      expect(fm.format).toBe("rule-card@1");
      const clauses = fm.clauses as { rule_id: string; tier: string; severity: string; repair?: string }[];
      expect(Array.isArray(clauses)).toBe(true);
      expect(clauses.length).toBeGreaterThan(0);
      for (const c of clauses) {
        expect(c.rule_id).toMatch(/^AE-[A-Z0-9-]+$/);
        expect(["S", "A", "B"]).toContain(c.tier);
        expect(["block", "major", "minor"]).toContain(c.severity);
      }
      // 卡内条款与 provenance.refs 对得上（结构化视图不许发明卡外条款）
      const refs = (fm.provenance as { refs: string[] }).refs;
      for (const c of clauses) expect(refs).toContain(c.rule_id);
      void tool; // 工具在环已在 ① 断言；此处钉卡面收敛完整性
    }
  });

  it("② 诊与建同一来源：prompt 同时含条款 id 与 repair 文本（curve 卡实样）", () => {
    const { raw, fm } = readRuleCard("curve");
    const prompt = buildCardDiagnosisPrompt("kb/rules/curve", raw, "正文");
    const clauses = fm.clauses as { rule_id: string; repair: string }[];
    for (const c of clauses) {
      expect(prompt).toContain(c.rule_id); // 诊的锚点（条款判定目标）
      expect(prompt).toContain(c.repair); // 建的锚点（修复策略原文）——同一来源
    }
    // 同源铁律的 prompt 语义约束：建议必须是 repair 的反向表达
    expect(prompt).toContain("反向表达");
    expect(prompt).toContain("同源铁律");
  });

  it("③ 输出契约字段位：prompt 输出 JSON 形状含 rule_ref/tier/severity/evidence/suggestion（对齐 diagnosis-report@1 items 语义）+ evidence/opinion 分离", () => {
    const prompt = buildCardDiagnosisPrompt("kb/rules/curve", "---\n{}\n---\n卡", "正文");
    for (const field of ['"rule_ref"', '"tier"', '"severity"', '"evidence"', '"suggestion"']) {
      expect(prompt).toContain(field);
    }
    // B 级纪律（2026-10-10 决议）：卡外观点只能进 opinion，不得混进 items
    expect(prompt).toContain('"opinion"');
    expect(prompt).toContain("不得混进 items");
  });

  it("④ 别名行为：mf_analyze_curve 内部调通用实现（卡固定 emotion-curve，走同一 prompt 组装器）", async () => {
    const { kernel, projectDir, repoRoot } = mkKernel();
    let captured = "";
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: { body?: string }) => {
      captured = JSON.parse(init?.body ?? "{}").messages?.[1]?.content ?? "";
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: '{"items":[],"opinion":{"by":"mock","text":"ok"}}' } }] }),
      };
    }));
    const tools = analysisTools(CFG, kernel, projectDir, repoRoot);
    const alias = tools.find((t) => t.name === "mf_analyze_curve")!;
    const out = await alias.exec({ text: "测试正文" });
    expect(out).toContain('"opinion"'); // 打桩补全原样透传
    expect(captured).toContain("emotion-curve"); // 别名固定卡
    expect(captured).toContain("反向表达"); // 走的是通用诊断 prompt（同款同源约束）
  });

  it("④ 通用工具实跑：mf_analyze_card 按 kb/rules/curve 组装并透传 LLM JSON（fetch 打桩，不打真端点）", async () => {
    const { kernel, projectDir, repoRoot } = mkKernel();
    let captured = "";
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: { body?: string }) => {
      captured = JSON.parse(init?.body ?? "{}").messages?.[1]?.content ?? "";
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: '{"items":[{"rule_ref":"kb/rules/curve#AE-CURVE-TYPE"}]}', } }] }),
      };
    }));
    const tools = analysisTools(CFG, kernel, projectDir, repoRoot);
    const tool = tools.find((t) => t.name === "mf_analyze_card")!;
    const out = await tool.exec({ card: "kb/rules/curve", text: "正文" });
    expect(JSON.parse(out)).toMatchObject({ items: [{ rule_ref: "kb/rules/curve#AE-CURVE-TYPE" }] });
    expect(captured).toContain("AE-CURVE-TYPE");
  });

  it("⑤ 错误路径显式：卡不存在 = CARD_NOT_FOUND；缺 card 参数 = INVALID_INPUT（都不静默）", async () => {
    const { kernel, projectDir, repoRoot } = mkKernel();
    const tools = analysisTools(CFG, kernel, projectDir, repoRoot);
    const tool = tools.find((t) => t.name === "mf_analyze_card")!;
    await expect(tool.exec({ card: "kb/rules/no-such-card", text: "正文" })).rejects.toThrow(/卡不存在/);
    await expect(tool.exec({ text: "正文" })).rejects.toThrow(/缺 card 参数/);
  });
});
