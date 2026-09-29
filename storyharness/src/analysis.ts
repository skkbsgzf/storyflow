// 分析手法工具（甲方口径「预训练分析手法」的本仓实现）：方法论不在代码里，而在 KB 卡里——
// 执行时经内核 kb_read 动态装载 methodology 卡（emotion-curve / character），LLM 按卡结构化分析。
// 产出 = 证据与建议（JSON），不进提交链当闸（v5.0 纪律）。
import * as fs from "node:fs";
import path from "node:path";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import type { KernelClient } from "./kernel.js";

export interface AnalysisDeps {
  kernel: KernelClient;
  models: unknown; // pi-ai Models（streamSimple）
  model: unknown;  // pi-ai Model
  projectDir: string;
}

const esc = (s: unknown) => String(s == null ? "" : s);

async function llmJson(models: unknown, model: unknown, prompt: string, maxTokens: number): Promise<string> {
  const m = models as { streamSimple: (mm: unknown, ctx: unknown, o: unknown) => { [Symbol.asyncIterator](): AsyncIterator<{ type: string; delta?: string; text?: string; error?: { errorMessage?: string } }> } };
  const es = m.streamSimple(model, {
    messages: [{ role: "user", content: prompt }],
    systemPrompt: "你是结构化分析器：只输出一个合法 JSON 对象，不加解释、不加代码围栏、不加前后缀。",
    tools: [],
  }, { maxTokens });
  let text = "";
  for await (const ev of es as AsyncIterable<{ type: string; delta?: string; text?: string; error?: { errorMessage?: string } }>) {
    if (ev.type === "text_delta") text += ev.delta ?? "";
    else if (ev.type === "error") throw new Error(ev.error?.errorMessage || "分析流错误");
  }
  return text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
}

async function loadCard(kernel: KernelClient, ref: string): Promise<string> {
  const r = (await kernel.kbRead(ref, 12_000)) as { content: string };
  return r.content;
}

function readText(projectDir: string, args: { path?: string; text?: string }): string {
  if (typeof args.text === "string" && args.text.trim()) return args.text;
  if (typeof args.path === "string" && args.path.trim()) {
    const abs = path.resolve(projectDir, args.path);
    if (!abs.startsWith(path.resolve(projectDir))) throw new Error(`路径越出项目：${args.path}`);
    return fs.readFileSync(abs, "utf-8");
  }
  throw new Error("缺输入：传 path 或 text");
}

/** 剧情曲线分析（emotion-curve 六型判别 + 失衡扫描 + 换轨建议）。 */
export function makeCurveTool(kernel: KernelClient, deps: { models: unknown; model: unknown; projectDir: string }): AgentTool {
  return {
    name: "mf_analyze_curve",
    label: "剧情曲线分析",
    description: "按情绪曲线六型判别卡（自 knowledge/ 动态装载）分析正文：曲线主型/逐段张力/失衡条款/换轨建议（JSON）",
    parameters: Type.Object({
      path: Type.Optional(Type.String({ description: "项目内正文路径（与 text 二选一）" })),
      text: Type.Optional(Type.String({ description: "直接传正文" })),
    }),
    execute: async (_id: string, args: any) => {
      const text = readText(deps.projectDir, args);
      const card = await loadCard(kernel, "kb/aesthetic/emotion-curve");
      const json = await llmJson(deps.models, deps.model,
        `你是剧情曲线分析师。严格按以下方法论卡执行六型判别与失衡扫描：\n\n${card}\n\n【待分析正文】\n${text.slice(0, 24_000)}\n\n输出 JSON：{"curve_type":"六型之一","confidence":"high|medium|low","segments":[{"range":"第1-3章","tension":6,"note":"一句话"}],"violations":[{"clause":"条款名","level":"major|minor","note":"一句话"}],"suggestions":["换轨建议（必须含前2拍铺垫代价）"]}`,
        4000);
      return { content: [{ type: "text" as const, text: json }], details: undefined };
    },
  } as AgentTool;
}

/** 人物塑造分析：确定性出场/台词统计 + character 卡维度评分。 */
export function makeCharacterTool(kernel: KernelClient, deps: { models: unknown; model: unknown; projectDir: string }): AgentTool {
  return {
    name: "mf_analyze_character",
    label: "人物塑造分析",
    description: "人物塑造分析：出场/台词归属统计（确定性）+ character 卡三维评分与弧线评估（JSON）",
    parameters: Type.Object({
      path: Type.Optional(Type.String({ description: "项目内正文路径" })),
      text: Type.Optional(Type.String()),
      names: Type.Optional(Type.String({ description: "逗号分隔的人物名单（缺省自动从正文高频人名推断）" })),
    }),
    execute: async (_id: string, args: any) => {
      const text = readText(deps.projectDir, args);
      // 确定性统计：名字表来自参数或「」/【】前的称呼，兜底取高频双字词太噪——只统计参数给定或「」主语
      let names = args.names ? String(args.names).split(/[,，]/).map((s: string) => s.trim()).filter(Boolean) : [];
      if (!names.length) {
        const cnt: Record<string, number> = {};
        for (const m of text.matchAll(/「([^」]{1,40})」/g)) {
          const seg = text.slice(Math.max(0, (m.index ?? 0) - 30), m.index ?? 0);
          const who = seg.match(/([\u4e00-\u9fa5]{2,4})(?:说|道|喊|问|答|笑|吼)/)?.[1];
          if (who) cnt[who] = (cnt[who] ?? 0) + 1;
        }
        names = Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([n]) => n);
      }
      const stats = names.map((n) => ({
        name: n,
        mentions: (text.match(new RegExp(n, "g")) ?? []).length,
        dialogueLines: (text.match(new RegExp(`「[^」]{0,2}${n}|${n}[^。\\n]{0,6}：「`, "g")) ?? []).length,
      }));
      const card = await loadCard(kernel, "kb/aesthetic/character");
      const json = await llmJson(deps.models, deps.model,
        `你是人物塑造分析师。严格按以下方法论卡执行三维（欲望/对抗/真相）与弧线评估：\n\n${card}\n\n【人物名单】${JSON.stringify(names)}\n【待分析正文】\n${text.slice(0, 24_000)}\n\n输出 JSON：{"characters":[{"name":"...","dimensions":{"欲望":"...","对抗":"...","真相":"..."},"arc":"弧线一句话","score":1-10,"risk":"塑造风险一句话"}],"relationships":[{"pair":"A-B","note":"关系动态一句话"}]}`,
        4000);
      return { content: [{ type: "text" as const, text: JSON.stringify({ stats, analysis: json }, null, 1).slice(0, 15_000) }], details: undefined };
    },
  } as AgentTool;
}

/** 工具环装配：curve + character（KB 方法论动态装载）。 */
export function makeAnalysisTools(kernel: KernelClient, deps: { models: unknown; model: unknown; projectDir: string }): AgentTool[] {
  return [makeCurveTool(kernel, deps), makeCharacterTool(kernel, deps)];
}

/** 独立分析入口（CLI analyze 用）：读项目内文件 → 分析 JSON。 */
export async function analyzeFile(kernel: KernelClient, deps: { models: unknown; model: unknown; projectDir: string }, kind: "curve" | "character", relPath: string, names?: string): Promise<string> {
  void kernel;
  const projectDir = path.resolve(deps.projectDir);
  const abs = path.resolve(projectDir, relPath);
  const text = fs.readFileSync(abs, "utf-8");
  if (kind === "curve") {
    const t = makeCurveTool(kernel, deps) as unknown as { execute: (id: string, params: { path: string }) => Promise<{ content: { text: string }[] }> };
    return (await t.execute("cli", { path: relPath })).content[0].text;
  }
  const t = makeCharacterTool(kernel, deps) as unknown as { execute: (id: string, params: { path: string; names?: string }) => Promise<{ content: { text: string }[] }> };
  return (await t.execute("cli", { path: relPath, names })).content[0].text;
}
