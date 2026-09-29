// 工单 B2 · 项目级并发锁单测：初次获取 / 持有拒 / 释放后再获取 / 死 pid 接管。
// 存活性判定用本进程 pid（必活）与已退出子进程 pid（必死），不依赖平台特定行为。
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { acquireRunLock, readRunLock, releaseRunLock } from "../src/scheduler.js";

type Cfg = Parameters<typeof acquireRunLock>[0];

function tmpCfg(): Cfg {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sh-lock-"));
  return {
    workspaceRoot: root,
    project: "p-lock-test",
    corpus: { projectsDir: "projects" },
  } as unknown as Cfg;
}

function deadPid(): Promise<number> {
  return new Promise((res) => {
    const c = spawn(process.execPath, ["-e", ""]);
    c.on("close", () => res(c.pid));
  });
}

test("初次获取成功且文件含 pid/host/token", () => {
  const cfg = tmpCfg();
  const r = acquireRunLock(cfg);
  assert.ok(r.ok);
  const lock = readRunLock(cfg);
  assert.equal(lock?.pid, process.pid);
  assert.ok(lock?.token);
  assert.ok(fs.existsSync(path.join(cfg.workspaceRoot, cfg.corpus.projectsDir, cfg.project, "内部", "run.lock")));
});

test("存活持有者 → 第二次获取被拒且指向持有者；释放后可再获取", () => {
  const cfg = tmpCfg();
  const first = acquireRunLock(cfg);
  assert.ok(first.ok);
  const second = acquireRunLock(cfg);
  assert.ok(!second.ok);
  assert.equal(second.holder.pid, process.pid);
  releaseRunLock(cfg, (first as { token: string }).token);
  assert.ok(acquireRunLock(cfg).ok);
});

test("死 pid → 过期接管", async () => {
  const cfg = tmpCfg();
  const dead = await deadPid();
  const file = path.join(cfg.workspaceRoot, cfg.corpus.projectsDir, cfg.project, "内部", "run.lock");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ pid: dead, host: "ghost", startedAt: "2020-01-01", token: "old" }));
  const r = acquireRunLock(cfg);
  assert.ok(r.ok, "死 pid 应被接管");
});

test("并发 acquire：同刻竞争只允许一个成功，其余被拒", () => {
  const cfg = tmpCfg();
  const results = Array.from({ length: 8 }, () => acquireRunLock(cfg));
  const okCount = results.filter(r => r.ok).length;
  assert.equal(okCount, 1, `应恰有 1 个胜者，实得 ${okCount}`);
  const winners = results.filter(r => r.ok) as Array<{ token: string }>;
  const lock = readRunLock(cfg);
  assert.equal(lock?.token, winners[0].token, "盘上锁应属胜者");
});
