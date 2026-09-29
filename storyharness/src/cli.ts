// StoryHarness CLI（pi 单脑：交互对话与产线执行同一 pi Agent）：
//   status <project>                 盘面（flow_next 状态/待办）
//   run-node <project> [--dry]       执行一个节点并交卷
//   run <project> [--max N]          批循环（Q3：AND-join 并发，maxParallel 旋钮）
//   serve [--port 8431]              Q4 协议面守护进程（/status /start /stop）
//   lint [flow]                      flow-lint
import * as fs from "node:fs";
import path from "node:path";
import { loadConfig } from "./config.js";
import { KernelClient } from "./kernel.js";
import { runNextNode, runEntry } from "./executor.js";
import { runFlow } from "./scheduler.js";
import { runHeadless } from "./headless.js";
import { analyzeFile } from "./analysis.js";
import { makeModels, resolveModel } from "./llm.js";
import { startServe } from "./serve.js";
import { runWeb } from "./web.js";

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const argOf = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const project = argOf("--project") ?? process.env.PI_PROJECT ?? "";

  if (cmd === "status") {
    const cfg = loadConfig({ project });
    const k = new KernelClient(cfg.kernelBase, cfg.workspaceRoot, cfg.corpus);
    const next = await k.flowNext(cfg.project);
    console.log(JSON.stringify({ status: next.status, node: next.nodeId, gate: next.gate, batch: next.batch?.length ?? 0 }, null, 1));
    return;
  }
  if (cmd === "run-node") {
    const cfg = loadConfig({ project });
    const k = new KernelClient(cfg.kernelBase, cfg.workspaceRoot, cfg.corpus);
    const r = await runNextNode(k, cfg, { dry: argv.includes("--dry") });
    console.log(JSON.stringify(r, null, 1));
    process.exit(r.ok ? 0 : 2);
  }
  if (cmd === "run") {
    const cfg = loadConfig({
      project,
      maxParallel: argOf("--max") ? Number(argOf("--max")) : undefined,
    });
    const k = new KernelClient(cfg.kernelBase, cfg.workspaceRoot, cfg.corpus);
    const r = await runFlow(k, cfg, { maxBatches: argOf("--batches") ? Number(argOf("--batches")) : undefined });
    console.log(JSON.stringify({ ...r, results: r.results.map((x) => ({ node: x.node, ok: x.ok, detail: x.detail.slice(0, 120) })) }, null, 1));
    process.exit(r.ok ? 0 : 2);
  }
  if (cmd === "headless") {
    const direction = argv[1] && !argv[1].startsWith("--") ? argv[1] : "";
    if (!direction) {
      console.log('用法：storyharness headless "<题材方向>" [--episodes N] [--flow screenplay] [--project p-xxx] [--batches M] [--max N] [--dry]');
      process.exit(1);
    }
    const cfg = loadConfig({
      project: argOf("--project") ?? "p-pending",
      maxParallel: argOf("--max") ? Number(argOf("--max")) : undefined,
    });
    const k = new KernelClient(cfg.kernelBase, cfg.workspaceRoot, cfg.corpus);
    const r = await runHeadless(k, cfg, {
      direction,
      flow: argOf("--flow"),
      episodes: argOf("--episodes") ? Number(argOf("--episodes")) : undefined,
      project: argOf("--project"),
      maxBatches: argOf("--batches") ? Number(argOf("--batches")) : undefined,
      dry: argv.includes("--dry"),
    });
    process.exit(r.ok ? 0 : 2);
    return;
  }
  if (cmd === "web") {
    const hn = argOf("--hostname");
    const cfg = loadConfig({ project: project || undefined, ...(hn ? { serve: { hostname: hn } } : {}) });   // 缺省回落文件配置——禁止硬塞幻影项目名（p-web 再生根因）
    await runWeb(cfg, {
      port: argOf("--port") ? Number(argOf("--port")) : undefined,
      uiPort: argOf("--ui-port") ? Number(argOf("--ui-port")) : undefined,
      kernelPort: argOf("--kernel-port") ? Number(argOf("--kernel-port")) : undefined,
      noOpen: argv.includes("--no-open"),
    });
    return;
  }
  if (cmd === "serve") {
    const hn = argOf("--hostname");
    const cfg = loadConfig({ project, ...(hn ? { serve: { hostname: hn } } : {}) });
    const k = new KernelClient(cfg.kernelBase, cfg.workspaceRoot, cfg.corpus);
    const port = argOf("--port") ? Number(argOf("--port")) : 8431;
    startServe(k, cfg, port, { dry: argv.includes("--dry"), maxBatches: argOf("--batches") ? Number(argOf("--batches")) : undefined });
    console.error("[storyharness] 协议面已启动，Ctrl+C 退出");
    await new Promise(() => { /* 守护进程常驻——显式不返回，退出走 Ctrl+C */ });
    return;
  }
  if (cmd === "analyze") {
    // analyze curve|character --file <项目内路径> [--names a,b,c]
    const kind = argv[1] as "curve" | "character";
    const cfg = loadConfig({ project });
    const k = new KernelClient(cfg.kernelBase, cfg.workspaceRoot, cfg.corpus);
    const models = makeModels({ provider: cfg.provider, model: cfg.model, apiKey: cfg.apiKey, baseUrl: cfg.baseUrl });
    const model = resolveModel(models, cfg);
    const rel = argOf("--file");
    if (!kind || (kind !== "curve" && kind !== "character") || !rel) {
      console.log('用法：analyze curve|character --file <项目内路径> [--names "名A,名B"]');
      process.exit(1);
    }
    const json = await analyzeFile(k, { models, model, projectDir: k.projectDir(cfg.project) }, kind, rel, argOf("--names"));
    console.log(json);
    return;
  }
  if (cmd === "lint") {
    const cfg = loadConfig({ project: project || "p-lint" });
    const k = new KernelClient(cfg.kernelBase, cfg.workspaceRoot, cfg.corpus);
    console.log(await k.flowLint(argv[1] && !argv[1].startsWith("--") ? argv[1] : undefined));
    return;
  }
  if (cmd === "--version" || cmd === "version") {
    const cfg = loadConfig({ project: project || "p-version" });
    // C-B1 · runtime 节回显：声明了哪些面（kernel/ui）一目了然
    let runtimeNote = "runtime 未声明（回落 v4 缺省）";
    try {
      const mf = JSON.parse(fs.readFileSync(path.join(cfg.workspaceRoot, ".storyharness.json"), "utf-8")) as { runtime?: { kernel?: unknown; ui?: unknown } };
      const faces = [mf.runtime?.kernel ? "kernel" : null, mf.runtime?.ui ? "ui" : null].filter(Boolean);
      runtimeNote = faces.length ? `runtime 已声明：${faces.join("+")}` : runtimeNote;
    } catch { /* 无 manifest 即回落 */ }
    console.log(`storyharness ${cfg.harnessVersion} · 语料=${cfg.corpusName} · workspace=${cfg.workspaceRoot} · ${runtimeNote}`);
    return;
  }
  console.log(`用法：
  storyharness status <project>              盘面
  storyharness run-node <project> [--dry]    执行一个节点并交卷
  storyharness run <project> [--max N]       批循环（AND-join 并发，maxParallel 旋钮）
  storyharness headless "<题材>" [选项]        冷启动建项目并自动跑排期（NDJSON 事件流）
  storyharness serve [--port 8431] [--hostname 127.0.0.1]  协议面守护进程（/status /start /stop + 会话 API；对外绑 0.0.0.0 须有口令）
  storyharness web [--hostname <ip>]           一键拉起内核+前端+协议面并开浏览器
  storyharness lint [flow]                   flow-lint`);
}

main().catch((e) => {
  console.error("[storyharness]", e.message);
  process.exit(1);
}).then(() => process.exit(0));   // pi 事件流残留句柄会让 libuv 在退出时断言——显式收口
