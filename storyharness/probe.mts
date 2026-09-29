// pi-ai 流原始事件探针（一次性诊断件，验完即删）
import fs from "node:fs";
import { makeModels, resolveModel } from "./src/llm.js";

const cfg = JSON.parse(fs.readFileSync(new URL("../.external/storyharness.json", import.meta.url), "utf-8"));
const models = makeModels({ provider: cfg.provider, model: cfg.model, apiKey: cfg.apiKey, baseUrl: cfg.baseUrl });
const model = resolveModel(models, { ...cfg, model: process.argv[2] || cfg.model });
console.log("model:", model.id, "| maxTokens:", (model as unknown as { maxTokens?: number }).maxTokens, "| reasoning:", (model as unknown as { reasoning?: boolean }).reasoning);

const models2 = models as unknown as { streamSimple: (m: unknown, c: unknown, o: unknown) => AsyncIterable<unknown>; getProvider: (id: string) => { streamSimple: (...a: unknown[]) => AsyncIterable<unknown> } };
const provider = models2.getProvider("zai");
const raw = provider.streamSimple.bind(provider);
(provider as { streamSimple: (...a: unknown[]) => AsyncIterable<unknown> }).streamSimple = (...a: unknown[]) => {
  const it = raw(...a);
  return (async function* () {
    try { for await (const ev of it) yield ev; }
    catch (e) { console.log("RAW-STACK:", (e as Error).stack?.slice(0, 900)); throw e; }
  })();
};
const stream = models2.streamSimple(model, { systemPrompt: "", tools: [], messages: [{ role: "user", content: "用一句话自我介绍" }] } as unknown as never, { maxTokens: 32768, apiKey: cfg.apiKey });
for await (const ev of stream) {
  const e = ev as { type: string; delta?: string; content?: string; text?: string };
  console.log(e.type, JSON.stringify(ev).slice(0, 400));
}
