/**
 * 批次3a P5 · 拆（逆向）回归（mf_deconstruct + deconstruct-report@1，与 r24-triphase / r25-repair 同范式）：
 *  ① mf_deconstruct 已注册进拆相工具族：samples/dimension 必填、hint/source_title 选传；
 *     拆相纪律写在工具描述里（宿主可见面上第一眼就是护栏）；
 *  ② 拆相 prompt 纪律（buildDeconstructPrompt 纯函数）：每条 claim 必须带样本内 evidence 引文、
 *     无引文的 claim 不许产出（防编造）、抽样优先禁止全文记忆化、DC- 前缀 + kb/deconstruct 命名空间；
 *  ③ 实跑（fetch 打桩，不打真端点）：合法 findings → deconstruct-report@1 骨架（status=draft、
 *     sampling.mode=片段、单元来自【标记】解析、candidate_card 确定性盖章、引文超长截断限长），全程不写盘；
 *  ④ 采样阈值拒绝：单元数超 DECONSTRUCT_MAX_UNITS 显式拒绝（抽样优先，不做全文记忆化）；
 *  ⑤ 草稿硬校验拒绝路径：无 evidence 引文 / evidence 缺 location|quote / refs 悬空 / rule_id 复用
 *     台账 AE-id（非 DC- 前缀）——全部 INVALID_INPUT 显式点名，不静默；
 *  ⑥ 前置拒绝（不动 LLM）：清单式 samples（只有元数据没有文本）/ dimension 形状非法 / 缺 samples；
 *  ⑦ 输出契约字段位：顶层与 finding 逐键对照 contracts/deconstruct.schema.json（手工比对，不用校验器）。
 * 「B 级或无 evidence 草稿」的拒绝口径：引文纪律不分 tier——B 级草稿同样必须带样本内引文（②⑤双覆盖）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DECONSTRUCT_MAX_UNITS,
  DECONSTRUCT_QUOTE_MAX,
  buildDeconstructPrompt,
  deconstructTools,
  deconstructUnits,
  type AgentModelConfig,
} from "../src/agent.js";
import { Kernel } from "../src/kernel.js";
import { rootOf } from "../src/schema.js";

const CFG: AgentModelConfig = { baseUrl: "http://127.0.0.1:9", model: "mock-model" };

function mkKernel(): { kernel: Kernel; projectDir: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "p5-deconstruct-"));
  const pid = "p-p5-demo";
  fs.mkdirSync(path.join(root, "projects", pid), { recursive: true });
  const kernel = new Kernel({ root });
  return { kernel, projectDir: kernel.projectDir(pid) };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/** 合成采样片段：两个【标记】单元（纯合成文本，非任何真实语料）。 */
const SAMPLES = "【合成单元甲】她伸手去够那封信，门铃在这时响了。他又数了一遍，口袋里只剩三枚硬币。\n【合成单元乙】他把最后一枚棋子按在棋盘上，大厅安静得能听见灯丝的嗡鸣。";

/** 好草稿（模型回复桩）：一条 finding，字段齐备。 */
function goodFindings(quote?: string): string {
  return JSON.stringify({
    findings: [
      {
        dimension: "hook",
        claim: "合成样本的开篇钩子压在首段末句、以未完成动作收束——悬念来自动作中断而非信息隐瞒",
        evidence: [
          { location: "u001 首段末句", quote: quote ?? "她伸手去够那封信，门铃在这时响了。" },
        ],
        provenance: { refs: ["u001"] },
        candidate_card: {
          id: "kb/deconstruct/hook-dongzuo-zhongduan",
          type: "rule-corpus",
          title: "钩子域 · 合成样本提炼（动作中断式首拍钩）",
          dimension: "hook",
          version: "0.1.0",
          status: "active",
          activation_hint: ["m2.编剧"],
          provenance: { source: "拆书样本回流", refs: ["u001"] },
          clauses: [
            {
              rule_id: "DC-HOOK-ACTION-CUT",
              tier: "A",
              severity: "major",
              detect: "每集首拍的钩子句",
              judge: "钩子以未完成的动作收束；纯信息隐瞒不计入",
              repair: "把首拍钩子改写为进行中的动作并让外部事件在最紧处切断",
            },
          ],
        },
      },
    ],
    summary: "合成拆解：1 条钩子域草稿",
  });
}

function stubFetch(content: string, captured: { prompts: string[] }): void {
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: { body?: string }) => {
    captured.prompts.push(JSON.parse(init?.body ?? "{}").messages?.[1]?.content ?? "");
    return { ok: true, json: async () => ({ choices: [{ message: { content } }] }) };
  }));
}

const toolOf = () => deconstructTools(CFG).find((t) => t.name === "mf_deconstruct")!;

describe("批次3a P5 · 拆相（mf_deconstruct + deconstruct-report@1）", () => {
  it("① 工具注册：mf_deconstruct 在拆相工具族，samples/dimension 必填，描述带抽样与引文纪律", () => {
    const tools = deconstructTools(CFG);
    expect(tools.map((t) => t.name)).toEqual(["mf_deconstruct"]);
    const tool = tools[0]!;
    expect(tool.parameters.required).toEqual(["samples", "dimension"]);
    const props = Object.keys(tool.parameters.properties as Record<string, unknown>).sort();
    expect(props).toEqual(["dimension", "hint", "samples", "source_title"]);
    // 纪律上脸：抽样优先（≤6 单元）、引文纪律、不落卡
    expect(tool.description).toContain("≤6 单元");
    expect(tool.description).toContain("无引文的 claim 不许产出");
    expect(tool.description).toContain("绝不落卡不写盘");
  });

  it("② prompt 纪律：无引文不许产出 / 抽样优先 / DC- 前缀 / kb/deconstruct 命名空间 / 引文限长", () => {
    const prompt = buildDeconstructPrompt(SAMPLES, "hook", "开篇钩子规律", "合成样本");
    expect(prompt).toContain("无引文的 claim 不许产出");
    expect(prompt).toContain("抽样优先");
    expect(prompt).toContain("禁止全书记忆化");
    expect(prompt).toContain(`quote ≤${DECONSTRUCT_QUOTE_MAX} 字`);
    expect(prompt).toContain("DC- 前缀");
    expect(prompt).toContain("kb/deconstruct/hook-<来源slug小写连字符>");
    expect(prompt).toContain("rule-card@1");
    // 单元 id 映射上脸：模型必须照 u001/u002 引用
    expect(prompt).toContain("u001（标记：合成单元甲");
    expect(prompt).toContain("u002（标记：合成单元乙");
    // 人审前置：草稿不等于规则
    expect(prompt).toContain("findings 不等于规则");
    expect(prompt).toContain("tools/deconstruct.py land");
  });

  it("② 单元解析（确定性）：distinct【标记】→ u001 式 id；无标记=整段 1 单元", () => {
    const units = deconstructUnits(SAMPLES);
    expect(units.map((u) => u.id)).toEqual(["u001", "u002"]);
    expect(units[0]!.chars).toBeGreaterThan(0);
    const one = deconstructUnits("没有标记的一段文本");
    expect(one).toEqual([{ id: "u001", label: "（未标注·整段）", chars: "没有标记的一段文本".length }]);
  });

  it("③ 实跑（fetch 打桩）：合法 findings → deconstruct-report@1 骨架（draft / 片段 / 盖章 / 截断），全程不写盘", async () => {
    const { projectDir } = mkKernel();
    const captured = { prompts: [] as string[] };
    stubFetch(goodFindings("引".repeat(DECONSTRUCT_QUOTE_MAX + 57)), captured);
    const tool = toolOf();
    const out = JSON.parse(await tool.exec({ samples: SAMPLES, dimension: "hook", hint: "钩子规律", source_title: "合成样本" })) as {
      format: string; status: string; findings: { candidate_card: Record<string, unknown>; evidence: { quote: string }[] }[];
      sampling: { mode: string; units: { id: string }[] }; summary: string;
    };
    expect(out.format).toBe("deconstruct-report@1");
    expect(out.status).toBe("draft"); // 草稿态：人审前置
    expect(out.sampling.mode).toBe("片段");
    expect(out.sampling.units.map((u) => u.id)).toEqual(["u001", "u002"]);
    const card = out.findings[0]!.candidate_card;
    // 确定性盖章：format/type/updated/scanner_qids 不劳模型
    expect(card.format).toBe("rule-card@1");
    expect(card.type).toBe("rule-corpus");
    expect(String(card.updated)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(card.scanner_qids).toEqual([]);
    // 引文截断限长 + summary 注记
    expect(out.findings[0]!.evidence[0]!.quote.length).toBe(DECONSTRUCT_QUOTE_MAX);
    expect(out.summary).toContain("已截断限长");
    // 全程不写盘：项目目录零新增文件（落卡归人审后的 tools/deconstruct.py land）
    const walk = (dir: string): string[] =>
      fs.existsSync(dir) ? fs.readdirSync(dir).flatMap((x) => {
        const p = path.join(dir, x);
        return fs.statSync(p).isDirectory() ? walk(p) : [p];
      }) : [];
    expect(walk(projectDir)).toEqual([]);
  });

  it("④ 采样阈值拒绝：单元数超 DECONSTRUCT_MAX_UNITS 显式拒绝（抽样优先，不做全文记忆化）", async () => {
    const captured = { prompts: [] as string[] };
    stubFetch(goodFindings(), captured);
    const tool = toolOf();
    const many = Array.from({ length: DECONSTRUCT_MAX_UNITS + 1 }, (_, i) => `【单元${i}】文本${i}`).join("\n");
    await expect(tool.exec({ samples: many, dimension: "hook" })).rejects.toThrow(/超上限/);
    expect(captured.prompts).toHaveLength(0); // 校验在动 LLM 之前
  });

  it("⑤ 草稿硬校验拒绝路径：无 evidence / 缺 location·quote / refs 悬空 / rule_id 复用台账 AE-id（B 级同样必须带引文）", async () => {
    const tool = toolOf();
    const run = (content: string) => {
      const captured = { prompts: [] as string[] };
      stubFetch(content, captured);
      return tool.exec({ samples: SAMPLES, dimension: "hook" });
    };
    const noEvidence = JSON.stringify({
      findings: [{ dimension: "hook", claim: "无引文的读后感", evidence: [], provenance: { refs: ["u001"] }, candidate_card: { clauses: [{ rule_id: "DC-X", tier: "B", severity: "minor", detect: "d", judge: "j", repair: "r" }] } }],
      summary: "",
    });
    await expect(run(noEvidence)).rejects.toThrow(/无 evidence 引文/);
    const missingQuote = JSON.stringify({
      findings: [{ dimension: "hook", claim: "c", evidence: [{ location: "u001" }], provenance: { refs: ["u001"] }, candidate_card: { clauses: [{ rule_id: "DC-X", tier: "A", severity: "minor", detect: "d", judge: "j", repair: "r" }] } }],
      summary: "",
    });
    await expect(run(missingQuote)).rejects.toThrow(/缺 location\/quote/);
    const danglingRefs = JSON.stringify({
      findings: [{ dimension: "hook", claim: "c", evidence: [{ location: "u001", quote: "q" }], provenance: { refs: ["u999"] }, candidate_card: { clauses: [{ rule_id: "DC-X", tier: "A", severity: "minor", detect: "d", judge: "j", repair: "r" }] } }],
      summary: "",
    });
    await expect(run(danglingRefs)).rejects.toThrow(/悬空/);
    const ledgerId = goodFindings().replace("DC-HOOK-ACTION-CUT", "AE-HOOK-PRIOR"); // 搬运台账出身 id
    await expect(run(ledgerId)).rejects.toThrow(/DC- 前缀/);
    await expect(run("不是 JSON 的输出")).rejects.toThrow(/缺 findings 数组/);
  });

  it("⑥ 前置拒绝（不动 LLM）：清单式 samples / dimension 形状非法 / 缺 samples", async () => {
    const captured = { prompts: [] as string[] };
    stubFetch(goodFindings(), captured);
    const tool = toolOf();
    const manifest = JSON.stringify({ sampling: { mode: "章节" }, units: [{ id: "u001", location: "L1-L9", chars: 30 }] });
    await expect(tool.exec({ samples: manifest, dimension: "hook" })).rejects.toThrow(/采样清单/);
    await expect(tool.exec({ samples: SAMPLES, dimension: "钩子域" })).rejects.toThrow(/dimension 形状非法/);
    await expect(tool.exec({ dimension: "hook" })).rejects.toThrow(/缺 samples 参数/);
    expect(captured.prompts).toHaveLength(0);
  });

  it("⑦ 输出契约字段位：顶层与 finding 逐键对照 contracts/deconstruct.schema.json（手工等价比对）", async () => {
    const schema = JSON.parse(fs.readFileSync(path.join(rootOf(), "contracts", "deconstruct.schema.json"), "utf-8")) as {
      required: string[];
      properties: Record<string, unknown>;
      definitions: {
        finding: { required: string[]; properties: Record<string, unknown> };
        evidence: { required: string[] };
        sampling: { required: string[] };
        "candidate-card": { required: string[]; properties: Record<string, unknown> };
      };
    };
    const captured = { prompts: [] as string[] };
    stubFetch(goodFindings(), captured);
    const tool = toolOf();
    const out = JSON.parse(await tool.exec({ samples: SAMPLES, dimension: "hook" })) as {
      findings: { evidence: Record<string, unknown>[]; candidate_card: Record<string, unknown> }[];
    };
    // 顶层：required 全在，且没有 schema 之外的键（additionalProperties:false 的手工等价）
    expect(Object.keys(out).sort()).toEqual([...schema.required].sort());
    const f = (out.findings as Record<string, unknown>[])[0]!;
    expect(Object.keys(f).sort()).toEqual([...schema.definitions.finding.required].sort());
    expect(Object.keys(f.evidence[0]!).sort()).toEqual([...schema.definitions.evidence.required].sort());
    // candidate_card：键集 ⊆ schema properties（format/updated/scanner_qids 由工具盖章补齐）
    expect(Object.keys(f.candidate_card).every((k) => k in schema.definitions["candidate-card"].properties)).toBe(true);
    for (const k of schema.definitions["candidate-card"].required) {
      expect(k in f.candidate_card).toBe(true);
    }
    expect(f.candidate_card.status).toBe("active");
  });
});
