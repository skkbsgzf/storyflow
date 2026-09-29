// 工具环探针：定位哪个工具的 schema 让 zai 端点/解析器挂掉（一次性诊断件）
import fs from "node:fs";
import { makeModels, resolveModel } from "./src/llm.js";
import { buildTools } from "./src/tools.js";
import { KernelClient } from "./src/kernel.js";
import { CORPUS_LAYOUT } from "./probe-corpus.js";

const cfg = JSON.parse(fs.readFileSync(new URL("../.external/storyharness.json", import.meta.url), "utf-8"));
const models = makeModels({ provider: cfg.provider, model: cfg.model, apiKey: cfg.apiKey, baseUrl: cfg.baseUrl });
const model = resolveModel(models, cfg);
const k = new KernelClient("http://127.0.0.1:1", "D:/storymasterv4", CORPUS_LAYOUT);

const toolsAll = [
  ...buildTools(k, "p-sh-demo2", { lifecycle: true }),
];
const names = process.argv[2] ? process.argv[2].split(",") : toolsAll.map((t) => t.name);
const tools = toolsAll.filter((t) => names.includes(t.name));
console.log("tools:", tools.map((t) => t.name).join(","));

const models2 = models as unknown as { streamSimple: (m: unknown, c: unknown, o: unknown) => AsyncIterable<{ type: string }> };
const stream = models2.streamSimple(model, { systemPrompt: "你是助手", tools, messages: [{ role: "user", content: "用一句话自我介绍，不要调用工具" }] } as unknown as never, { maxTokens: 16384, thinking: 8192 });
let out = "";
for await (const ev of stream) {
  const e = ev as { type: string; delta?: string; errorMessage?: string };
  if (e.type === "text_delta") out += e.delta ?? "";
  if (e.type === "error") console.log("ERROR:", (e as unknown as { errorMessage?: string }).errorMessage);
}
console.log("最终正文:", out.slice(0, 200) || "(空)");
