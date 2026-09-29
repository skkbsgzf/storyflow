/* engines.mjs — optional small-model ranking engine.
 * Point `llm.endpoint` at any OpenAI-compatible chat-completions server (llama.cpp / vLLM / Ollama …).
 * The model is an ADVISOR: its scores blend with the deterministic baseline; failures fall back, never block. */
export async function llmRank({ cfg, request, context, tools }) {
  const ep = cfg.llm.endpoint;
  const table = tools.map(t => `- ${t.toolkit}/${t.id}: ${String(t.description).slice(0, 120)}`).join('\n').slice(0, 8000);
  const body = {
    model: cfg.llm.model,
    temperature: 0,
    max_tokens: 600,
    messages: [
      { role: 'system', content: '你是工具路由建议器。给定任务与工具清单，为最相关的工具输出 JSON 数组（最多 8 个），元素形如 {"tool_id":"...","score":0.0-1.0,"reason":"≤20字"}。score 表示该工具对本任务的必要性。只输出 JSON。' },
      { role: 'user', content: `任务：${request}\n上下文：${context || '（无）'}\n工具清单：\n${table}` },
    ],
  };
  const ctrl = AbortSignal.timeout(cfg.llm.timeout_ms || 15000);
  const res = await fetch(ep, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctrl });
  if (!res.ok) throw new Error(`HTTP ${res.status} @ ${ep}`);
  const j = await res.json();
  const text = j?.choices?.[0]?.message?.content || '';
  const m = /\[[\s\S]*\]/.exec(text);
  if (!m) throw new Error('回复中无 JSON 数组');
  const arr = JSON.parse(m[0]);
  // Models echo the table verbatim, so tool_id may arrive as `toolkit/id` (that IS how the table is
  // printed) or as a bare id. Accept both; key the map by bare id (R3: a prefixed reply must not
  // silently miss every known tool and fall back).
  const byKey = new Map();
  for (const t of tools) { byKey.set(t.id, t.id); byKey.set(`${t.toolkit}/${t.id}`, t.id); }
  const out = {};
  for (const x of Array.isArray(arr) ? arr : []) {
    if (!x || typeof x.tool_id !== 'string') continue;
    const s = x.tool_id.trim();
    const id = byKey.get(s) ?? byKey.get(s.split('/').pop());
    if (id) out[id] = Math.max(0, Math.min(1, Number(x.score) || 0));
  }
  if (!Object.keys(out).length) throw new Error('模型未命中任何已知 tool_id');
  return out;
}

/* laya-v1 engine — Laya（非自回归 typed-decisions）打分：单次前向给全工具池打必要性分。
 * 通道 = 子进程调 python runner（src/laya_score.py，laya 包在可选 python 环境里）；
 * 失败可见回落 deterministic，绝不阻塞 route。配置：cfg.laya = { python, model_dir, subfolder }。 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

export async function layaRank({ cfg, request, context, tools }) {
  const py = cfg.laya?.python || "python";
  const runner = path.join(HERE, "laya_score.py");
  const payload = JSON.stringify({ request, context, tools: tools.map(t => ({ id: t.id, description: String(t.description).slice(0, 200) })) });
  const out = await new Promise((res, rej) => {
    const child = spawn(py, [runner], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
    let buf = "", err = "";
    child.stdout.on("data", d => { buf += d; });
    child.stderr.on("data", d => { err += d; });
    // stdin 必须 end()：runner 的 sys.stdin.read() 等 EOF——不关=永挂（此前超时真因）
    child.stdin.end(payload + "\n", "utf-8");
    child.on("close", code => {
      try { res(JSON.parse(buf)); } catch { rej(new Error("runner 输出非 JSON（" + code + "）：" + (err || buf).slice(0, 120))); }
    });
    child.on("error", rej);
    const timer = setTimeout(() => { try { child.kill(); } catch {} rej(new Error("laya runner 超时 240s")); }, 240000);
    child.on("close", () => clearTimeout(timer));
  });
  const scores = out.scores || {};
  if (!Object.keys(scores).length) throw new Error("laya runner 未命中任何工具");
  return scores;
}
