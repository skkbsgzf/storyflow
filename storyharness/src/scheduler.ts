// Q3 批调度器：消费 flow_next 的就绪批（AND-join），批内并发、批间串行，门/人裁即停。
// 收口埋点：每次 run 落一份 运行遥测 run-<ts>.json（节点/耗时/工具/提交轮数/判官证据/usage 汇总）
// ——「会话转工作流」与效率归口的数据面；失败不拖垮主流程。
import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type { HarnessConfig } from "./config.js";
import { resolveWorkspaceRoot } from "./config.js";
import type { KernelClient } from "./kernel.js";
import { runEntry, type NodeRunResult } from "./executor.js";

/* ---------- B2 · 跨项目并发锁（工单 B）：项目级 run.lock ----------
 * <projectDir>/内部/run.lock = { pid, host, startedAt, token }。
 * 同项目跨进程互斥：pid 存活 → 拒（报错指向持有者）；pid 已死 → 过期接管。
 * 跨主机场景 host 仅作信息展示（单机假设，代码内注明）。 */

export interface RunLock { pid: number; host: string; startedAt: string; token: string }

export function runLockPath(cfg: HarnessConfig): string {
  const root = cfg.workspaceRoot ?? resolveWorkspaceRoot();          // 测试精简 cfg 兜底
  const projectsDir = cfg.corpus?.projectsDir ?? "projects";         // 缺省对齐 V4_CORPUS
  return path.join(root, projectsDir, cfg.project ?? "p-unset", "内部", "run.lock");
}

function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";   // EPERM = 存活但非本用户
  }
}

export function readRunLock(cfg: HarnessConfig): RunLock | null {
  try { return JSON.parse(fs.readFileSync(runLockPath(cfg), "utf-8")) as RunLock; } catch { return null; }
}

export function acquireRunLock(cfg: HarnessConfig): { ok: true; token: string } | { ok: false; holder: RunLock } {
  const file = runLockPath(cfg);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const existing = readRunLock(cfg);
  if (existing && pidAlive(existing.pid)) return { ok: false, holder: existing };
  const token = randomBytes(8).toString("hex");
  const lock: RunLock = { pid: process.pid, host: os.hostname(), startedAt: new Date().toISOString(), token };
  // C-B2 · O_EXCL 原子创建：消除「读-写窗口」竞态（两进程同时判死同一旧锁、后写覆盖前写）。
  // 死锁接管 = 先删后 O_EXCL 重试一次；EEXIST = 抢者在窗口内赢 → 读它回敬给调用方。
  const writeFresh = (): boolean => {
    try {
      fs.writeFileSync(file, JSON.stringify(lock, null, 1), { flag: "wx" });   // O_EXCL
      return true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw e;
    }
  };
  if (!writeFresh()) {
    try { fs.unlinkSync(file); } catch { /* 删不掉即让对方赢 */ }
    if (!writeFresh()) {
      const winner = readRunLock(cfg);
      if (winner && pidAlive(winner.pid)) return { ok: false, holder: winner };
      return { ok: false, holder: winner ?? existing ?? lock };
    }
  }
  return { ok: true, token: lock.token };
}

export function releaseRunLock(cfg: HarnessConfig, token: string): void {
  const file = runLockPath(cfg);
  const cur = readRunLock(cfg);
  if (cur && cur.token === token) { try { fs.unlinkSync(file); } catch { /* 幂等 */ } }
}

export interface FlowRunResult {
  batches: number;
  ran: number;
  ok: boolean;
  stopped?: string;
  gate?: { nodeId?: string };
  results: NodeRunResult[];
  telemetry?: string;
}

/** 运行遥测汇总（sh-run-telemetry@1）：一次 run 的完整机器可读形状。 */
export function writeRunTelemetry(kernel: KernelClient, cfg: HarnessConfig, data: Record<string, unknown>): string | undefined {
  try {
    const dir = path.join(kernel.projectDir(cfg.project), kernel.corpus.telemetryDir);
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, `run-${Date.now()}.json`);
    fs.writeFileSync(f, JSON.stringify({ format: "sh-run-telemetry@1", project: cfg.project, ...data }, null, 1), "utf-8");
    return path.relative(kernel.projectDir(cfg.project), f);
  } catch { /* 遥测失败不拖垮主流程 */ return undefined; }
}

export async function runFlow(
  kernel: KernelClient,
  cfg: HarnessConfig,
  opts: { maxBatches?: number; dry?: boolean; stopCheck?: () => boolean; onEvent?: (e: Record<string, unknown>) => void; log?: (s: string) => void } = {},
): Promise<FlowRunResult> {
  const log = opts.log ?? ((s: string) => console.error(`[storyharness] ${s}`));
  const emit = opts.onEvent ?? (() => {});
  const results: NodeRunResult[] = [];
  const maxBatches = opts.maxBatches ?? 50;
  const t0 = Date.now();
  let batches = 0;

  // 批间 flow_next 瞬时重试（p-thick-01 实测：批间 fetch failed 会杀整场跑；flow_next 只读可安全重试）
  const flowNextRetry = async (): Promise<Awaited<ReturnType<KernelClient["flowNext"]>>> => {
    let lastErr: Error | null = null;
    for (let i = 0; i < 3; i++) {
      try { return await kernel.flowNext(cfg.project); } catch (e) {
        lastErr = e as Error;
        if (!/fetch failed|ECONNRESET|socket hang up|terminated|timed out|timeout/i.test(lastErr.message)) throw e;
        log(`flow_next 瞬时失败（${lastErr.message.slice(0, 60)}），3s 后重试 ${i + 1}/2`);
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
    throw lastErr ?? new Error("flow_next 重试穷尽");
  };

  // B2 · 项目级并发锁：跨进程同项目互斥（存活拒/死接管），全路径经 finally 释放
  const lock = acquireRunLock(cfg);
  if (!lock.ok) {
    const h = lock.holder;
    log(`run.lock 被持有：pid=${h.pid}（${h.host}，自 ${h.startedAt}）——同项目并发 run 被拒`);
    return { batches: 0, ran: 0, ok: false, results: [],
             stopped: `run.lock 被持有：pid=${h.pid}（${h.host}，自 ${h.startedAt}）` };
  }
  const lockToken = lock.token;
  try {

  // 收口：无论哪条路退出都落遥测
  const finish = (r: FlowRunResult): FlowRunResult => {
    const wallMs = Date.now() - t0;
    const nodes = results.map((x) => ({
      node: x.node, ok: x.ok, file: x.file,
      ...(x.meta ?? {}),
      detail: x.detail.slice(0, 200),
    }));
    const usageIn = results.reduce((a, x) => a + (x.meta?.usage.input ?? 0), 0);
    const usageOut = results.reduce((a, x) => a + (x.meta?.usage.output ?? 0), 0);
    const telemetry = writeRunTelemetry(kernel, cfg, {
      startedAt: new Date(t0).toISOString(),
      endedAt: new Date().toISOString(),
      wallMs, ok: r.ok, stopped: r.stopped ?? null, batches,
      dry: !!opts.dry,
      model: `${cfg.provider}.${cfg.model}`,
      totals: { nodes: results.length, okNodes: results.filter((x) => x.ok).length, usageIn, usageOut, },
      nodes,
    });
    return { ...r, telemetry };
  };

  for (let i = 0; i < maxBatches; i++) {
    if (opts.stopCheck?.()) {
      return finish({ batches, ran: results.length, ok: true, results, stopped: "收到 /stop，批边界中止" });
    }
    const next = await flowNextRetry();
    if (next.status === "completed") {
      return finish({ batches, ran: results.length, ok: true, results, stopped: undefined });
    }
    if (next.status !== "awaiting_input") {
      const gate = (next as { gate?: { nodeId?: string } }).gate;
      emit({ event: "gate_paused", node: gate?.nodeId ?? "-", note: `status=${next.status}` });
      return finish({
        batches, ran: results.length, ok: true, results,
        stopped: `status=${next.status}${gate?.nodeId ? `（门 ${gate.nodeId} 待人裁——工作台或 flow_gate 处理）` : ""}`,
        gate,
      });
    }
    const entries = next.batch?.length
      ? next.batch
      : next.nodeId
        ? [{ nodeId: next.nodeId, taskPackage: next.taskPackage, spawnPrompt: (next as { spawnPrompt?: string }).spawnPrompt }]
        : [];
    if (!entries.length) return finish({ batches, ran: results.length, ok: false, results, stopped: "flow_next 未返回任务包" });

    // AND-join 并发池：lane 个工人共享队列，单线程事件环内无竞态
    const lane = Math.min(cfg.maxParallel, entries.length);
    let idx = 0;
    log(`批 ${i + 1}：${entries.length} 节点，并发 ${lane}`);
    emit({ event: "batch", index: i + 1, nodes: entries.map((e) => e.nodeId) });
    const workers = Array.from({ length: lane }, async () => {
      while (idx < entries.length && !opts.stopCheck?.()) {
        const my = entries[idx++];
        emit({ event: "node_start", node: my.nodeId });
        try {
          const r = await runEntry(kernel, cfg, my, opts);
          emit({ event: "node_end", node: my.nodeId, ok: r.ok, detail: r.detail.slice(0, 200) });
          results.push(r);
        } catch (e) {
          emit({ event: "node_end", node: my.nodeId, ok: false, detail: `执行异常: ${(e as Error).message.slice(0, 180)}` });
          results.push({ node: my.nodeId, ok: false, detail: `执行异常: ${(e as Error).message}` });
        }
      }
    });
    await Promise.all(workers);
    batches = i + 1;
    if (opts.stopCheck?.()) {
      return finish({ batches, ran: results.length, ok: true, results, stopped: "收到 /stop，批后中止" });
    }

    const failed = results.filter((r) => !r.ok);
    if (failed.length) {
      return finish({ batches, ran: results.length, ok: false, results, stopped: `批内 ${failed.length} 节点失败：${failed.map((f) => f.node).join("、")}` });
    }
  }
  return finish({ batches, ran: results.length, ok: true, results, stopped: `达到批上限 ${maxBatches}` });
  } finally {
    releaseRunLock(cfg, lockToken);   // 全路径释放（含失败/stop/异常）
  }
}
