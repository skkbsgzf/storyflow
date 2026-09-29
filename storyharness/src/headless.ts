// headless（dsh 减法）：一条命令冷启动编剧项目并自动跑排期，NDJSON 事件流打到 stdout。
//   storyharness headless "<题材>" [--episodes N] [--flow screenplay] [--project p-xxx]
//                              [--batches M] [--max N] [--dry]
// 事件契约（每行一个 JSON 对象，机器可消费；人类可读进度走 stderr）：
//   {event:"run_start", project, flow, direction, episodes, model, resumed?}
//   {event:"batch", index, nodes:[...]}
//   {event:"node_start"|"node_end", node, ...}
//   {event:"gate_paused", node, note}
//   {event:"run_end", ok, batches, ran, stopped?}
//   {event:"final", project, ok, summary}
// 会话侧：每节点执行全程已由 executor 落 内部/sessions/<sid>.jsonl（网页「对话」页签可见）。
import type { KernelClient } from "./kernel.js";
import type { HarnessConfig } from "./config.js";
import { runFlow } from "./scheduler.js";
import * as fs from "node:fs";
import path from "node:path";

export interface HeadlessOptions {
  direction: string;
  flow?: string;
  episodes?: number;
  project?: string;
  maxBatches?: number;
  dry?: boolean;
  emit?: (e: Record<string, unknown>) => void;
}

export function emitNdjson(e: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(e) + "\n");
}

export async function runHeadless(kernel: KernelClient, cfg: HarnessConfig, opts: HeadlessOptions): Promise<{ ok: boolean; project: string; summary: string }> {
  const emit = opts.emit ?? emitNdjson;
  const flow = opts.flow || "screenplay";
  const episodes = opts.episodes ?? 6;
  const project = opts.project || `p-sh-${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12)}${Math.random().toString(36).slice(2, 5)}`;

  // 冷启动：state.json 已存在 = 该项目已有 run，拒绝静默续跑（选择必须有事实）
  if (fs.existsSync(path.join(kernel.projectDir(project), "state.json"))) {
    emit({ event: "final", project, ok: false, summary: `项目 ${project} 已有 run（state.json 在盘）——换 --project 新名或先处理存量` });
    return { ok: false, project, summary: "项目已存在 run" };
  }

  const runCfg: HarnessConfig = { ...cfg, project };
  emit({ event: "run_start", project, flow, direction: opts.direction, episodes, model: `${cfg.provider}.${cfg.model}` });
  try {
    await kernel.verb("flow_run", { flow, project, inputs: { direction: opts.direction, episodes } });
  } catch (e) {
    emit({ event: "final", project, ok: false, summary: `flow_run 失败：${(e as Error).message}` });
    return { ok: false, project, summary: `flow_run 失败：${(e as Error).message}` };
  }

  const result = await runFlow(kernel, runCfg, {
    dry: opts.dry,
    maxBatches: opts.maxBatches,
    onEvent: emit,
  });
  emit({
    event: "run_end", ok: result.ok, batches: result.batches, ran: result.ran,
    ...(opts.dry ? { dry: true } : {}),
    ...(result.stopped ? { stopped: result.stopped } : {}),
  });
  const summary = result.ok
    ? `${result.ran} 节点 / ${result.batches} 批${result.stopped ? `（${result.stopped}）` : ""}`
    : `失败：${result.stopped ?? "未知"}`;
  emit({ event: "final", project, ok: result.ok, ...(opts.dry ? { dry: true } : {}), summary, workbench: `projects/${project}/workflow.html` });
  return { ok: result.ok, project, summary };
}
