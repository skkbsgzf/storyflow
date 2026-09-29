// 工单 WO-B12（波9）· 变更页签数据面单测＋协议面集成测：
//   index 视图出「节点×轮次账＋最新轮文件的盘上现状」，diff 视图出逐文件 unified diff，
//   两侧读法与 tools/snapshot.py 同口径（缺失当空文本、越界拒绝、二进制显式降级不崩）。
//   diff 算法本身的逐字节对账在 test/udiff-parity.test.ts + test/verify/snapshot-diff-parity.mjs。
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { AddressInfo } from "node:net";
import { panelChanges } from "../src/panels.js";
import { KernelClient } from "../src/kernel.js";
import type { HarnessConfig } from "../src/config.js";
import { startServe } from "../src/serve.js";

const NODE = "m2.novel-writer";
const NAME = "03-写作/第一章.md";
const R1 = "# 第一章\n\n风从河面上来。\n\n他站在桥上。\n";
const R2 = "# 第一章（改）\n\n风从河面上来。\n\n他站在桥上，没有回头。\n\n新加的一段。\n";

const sha1_12 = (buf: Buffer) => createHash("sha1").update(buf).digest("hex").slice(0, 12);

/** 造一个「拍过两轮快照」的项目：snapshots/index.json 的 hash 口径 = snapshot.py（文本按原字节 sha1 前 12）。 */
function tmpProject(opts: { index?: unknown; handEditDisk?: boolean; deleteDisk?: boolean; noIndexFile?: boolean } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sh-b12-"));
  const dir = path.join(root, "projects", "p-b12");
  fs.mkdirSync(path.join(dir, "03-写作"), { recursive: true });
  fs.mkdirSync(path.join(dir, "snapshots", NODE, "r1", "03-写作"), { recursive: true });
  fs.mkdirSync(path.join(dir, "snapshots", NODE, "r2", "03-写作"), { recursive: true });
  fs.writeFileSync(path.join(dir, "snapshots", NODE, "r1", NAME), R1, "utf-8");
  fs.writeFileSync(path.join(dir, "snapshots", NODE, "r2", NAME), R2, "utf-8");
  // 二进制产物一条（docx 那种：capture 按字节留档，index 里 binary:true）
  fs.mkdirSync(path.join(dir, "snapshots", NODE, "r2", "04-交付"), { recursive: true });
  const bin = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 1, 2, 3]);
  fs.mkdirSync(path.join(dir, "snapshots", NODE, "r1", "04-交付"), { recursive: true });
  fs.writeFileSync(path.join(dir, "snapshots", NODE, "r2", "04-交付", "稿.docx"), bin);
  fs.writeFileSync(path.join(dir, "snapshots", NODE, "r1", "04-交付", "稿.docx"), bin);
  const cur = opts.deleteDisk ? null : (opts.handEditDisk ? R2.replace("新加的一段。", "新加的一段（手改）。") : R2);
  if (cur !== null) fs.writeFileSync(path.join(dir, NAME), cur, "utf-8");

  const idx = opts.index ?? {
    snapshots: {
      [NODE]: [
        { round: 1, ts: "2026-09-27 10:00", note: "初稿", files: { [NAME]: { hash: sha1_12(Buffer.from(R1, "utf-8")), path: `snapshots/${NODE}/r1/${NAME}` }, "04-交付/稿.docx": { hash: sha1_12(bin), path: `snapshots/${NODE}/r1/04-交付/稿.docx`, binary: true } } },
        { round: 2, ts: "2026-09-28 11:30", note: "按要求改结尾", files: { [NAME]: { hash: sha1_12(Buffer.from(R2, "utf-8")), path: `snapshots/${NODE}/r2/${NAME}` }, "04-交付/稿.docx": { hash: sha1_12(bin), path: `snapshots/${NODE}/r2/04-交付/稿.docx`, binary: true } } },
      ],
    },
    inputs: {},
  };
  if (!opts.noIndexFile) fs.writeFileSync(path.join(dir, "snapshots", "index.json"), JSON.stringify(idx, null, 2), "utf-8");
  const kernel = { projectDir: (p: string) => path.join(root, "projects", p), corpus: { projectsDir: "projects" } } as unknown as KernelClient;
  return { root, dir, kernel };
}

const body = (r: ReturnType<typeof panelChanges>) => r.payload as Record<string, any>;

test("index 视图：节点×轮次账＋最新轮文件的盘上现状（改了没拍快照一目了然）", () => {
  const { kernel } = tmpProject({ handEditDisk: true });
  const p = body(panelChanges(kernel, "p-b12", "", "", "", ""));
  assert.equal(p.mode, "index");
  assert.equal(p.available, true);
  assert.equal(p.nodes.length, 1);
  const n = p.nodes[0];
  assert.equal(n.node, NODE);
  assert.deepEqual(n.rounds.map((r: any) => r.round), [1, 2]);
  assert.equal(n.latest, 2);
  assert.equal(n.rounds[1].note, "按要求改结尾");
  const md = n.disk.find((d: any) => d.name === NAME);
  assert.equal(md.exists, true);
  assert.equal(md.sameAsSnapshot, false, "盘上已手改 → 与 r2 的 hash 不同");
  assert.equal(md.sizeKB, 0);
  assert.ok(md.mtime);
});

test("index 视图：盘上就是最新快照 → sameAsSnapshot true；没有 index.json → 显式空态不 500", () => {
  const ok = body(panelChanges(tmpProject().kernel, "p-b12", "", "", "", ""));
  assert.equal(ok.nodes[0].disk.find((d: any) => d.name === NAME).sameAsSnapshot, true);
  const { kernel } = tmpProject({ noIndexFile: true });
  const none = body(panelChanges(kernel, "p-b12", "", "", "", ""));
  assert.equal(none.available, false);
  assert.deepEqual(none.nodes, []);
  assert.match(none.note, /snapshot/);
});

test("diff 视图 r1→r2：unified 头带文件名，adds/dels 与正文行数一致，summary 归口", () => {
  const { kernel } = tmpProject();
  const r = panelChanges(kernel, "p-b12", NODE, "1", "2", "");
  assert.equal(r.status, 200);
  const p = body(r);
  assert.equal(p.mode, "diff");
  assert.equal(p.a, 1);
  assert.equal(p.b, 2);
  const f = p.files.find((x: any) => x.name === NAME);
  assert.equal(f.inA, true);
  assert.equal(f.inB, true);
  assert.ok(f.diff.startsWith(`--- a/${NAME}\n+++ b/${NAME}\n@@`), `头部形状：${f.diff.slice(0, 60)}`);
  const lines = f.diff.split("\n");
  assert.equal(f.adds, lines.filter((l: string) => l.startsWith("+") && !l.startsWith("+++")).length);
  assert.equal(f.dels, lines.filter((l: string) => l.startsWith("-") && !l.startsWith("---")).length);
  assert.equal(f.hunks, lines.filter((l: string) => l.startsWith("@@")).length);
  assert.equal(f.unchanged, false);
  assert.equal(p.summary.adds, p.files.reduce((n: number, x: any) => n + x.adds, 0));
});

test("diff 视图 b=working：手改/删盘上文件都现形；b 缺省=最新轮", () => {
  const edited = body(panelChanges(tmpProject({ handEditDisk: true }).kernel, "p-b12", NODE, "2", "working", ""));
  const f = edited.files.find((x: any) => x.name === NAME);
  assert.equal(f.inB, true);
  assert.match(f.diff, /\+新加的一段（手改）/);
  assert.match(f.diff, /-新加的一段。/);
  assert.match(edited.bNote, /当前文件/);

  const gone = body(panelChanges(tmpProject({ deleteDisk: true }).kernel, "p-b12", NODE, "2", "working", ""));
  const g = gone.files.find((x: any) => x.name === NAME);
  assert.equal(g.inB, false, "盘上被删 → b 侧空文本（snapshot.py 同款：不存在当空）");
  assert.equal(g.adds, 0);
  assert.ok(g.dels > 0);

  const same = body(panelChanges(tmpProject().kernel, "p-b12", NODE, "1", "", ""));
  assert.equal(same.b, 2, "b 缺省取最新一轮");
});

test("降级条目不崩也不哑：二进制显式说明、两侧皆查无显式说明、并集名单覆盖新增/删除", () => {
  const p = body(panelChanges(tmpProject().kernel, "p-b12", NODE, "1", "2", ""));
  const docx = p.files.find((x: any) => x.name === "04-交付/稿.docx");
  assert.equal(docx.binary, true);
  assert.equal(docx.code, "BINARY");
  assert.equal(docx.diff, "");
  assert.match(docx.note, /snapshot\.py/);
  assert.ok(docx.sizeA > 0 && docx.sizeB > 0);
  assert.equal(p.summary.changed, 1, "二进制降级不进「有变更」计数");
});

test("越界与坏参数：index 名字写 ../ 只标 OUT_OF_PROJECT 不读项目外；缺参/错轮次各自显式回错", () => {
  const evil = {
    snapshots: { [NODE]: [
      { round: 1, ts: "", note: "", files: { [NAME]: { hash: null, path: null } } },
      { round: 2, ts: "", note: "", files: { ["../../../../Windows/win.ini"]: { hash: null, path: null } } },
    ] },
  };
  const { kernel } = tmpProject({ index: evil });
  const p = body(panelChanges(kernel, "p-b12", NODE, "1", "2", ""));
  const bad = p.files.find((x: any) => x.name.includes("win.ini"));
  assert.equal(bad.code, "OUT_OF_PROJECT");
  assert.equal(bad.diff, "", "越界路径一个字节都不读");
  assert.equal(bad.sizeA, 0);
  assert.equal(bad.sizeB, 0);

  assert.equal(panelChanges(kernel, "p/../x", "", "", "", "").status, 400);
  const noA = panelChanges(kernel, "p-b12", NODE, "", "", "");
  assert.equal(noA.status, 400);
  assert.match(body(noA).error, /a（起始轮次）必填/);
  const badA = panelChanges(kernel, "p-b12", NODE, "x", "", "");
  assert.equal(badA.status, 400);
  assert.match(body(badA).error, /a 必须是整数轮次：x/);
  assert.equal(panelChanges(kernel, "p-b12", NODE, "1", "x", "").status, 400);
  const badNode = panelChanges(kernel, "p-b12", "m9.没有这个节点", "1", "2", "");
  assert.equal(badNode.status, 404);
  assert.equal(body(badNode).code, "NODE_NOT_FOUND");
  assert.deepEqual(body(badNode).available, [NODE]);
  const badRound = body(panelChanges(kernel, "p-b12", NODE, "9", "", ""));
  assert.equal(badRound.code, "ROUND_NOT_FOUND");
  assert.deepEqual(badRound.available, [1, 2]);
  const badFile = panelChanges(kernel, "p-b12", NODE, "1", "2", "没登记的文件.md");
  assert.equal(badFile.status, 404);
  assert.equal(body(badFile).code, "FILE_NOT_IN_ROUNDS");
});

// ── 协议面集成测 ───────────────────────────────────────────────

function serveCfg(root: string): HarnessConfig {
  const corpus = {
    projectsDir: "projects",
    receiptsDir: path.join("内部", "收据"),
    quarantineDir: path.join("内部", "backup"),
    sessionsDir: path.join("内部", "sessions"),
    telemetryDir: path.join("内部", "telemetry"),
    lintTool: path.join("tools", "flow-lint.py"),
    lintCommand: "python",
  };
  return {
    harnessVersion: "test", workspaceRoot: root, corpusName: "tmp", corpus,
    serve: { hostname: "127.0.0.1", password: "", passwordSource: "none", tokenTtlHours: 72, allowedOrigins: [], credentialsFile: path.join(root, ".external", "credentials.json") },
    kernelBase: "http://127.0.0.1:9", project: "p-b12", provider: "zai", model: "test", maxParallel: 1, thinking: "low",
  } as unknown as HarnessConfig;
}

test("HTTP 集成：/api/panel/changes 无 node 出索引、带 node&a 出 diff、坏轮次 404 带可选轮次", async () => {
  const { root } = tmpProject();
  const cfg = serveCfg(root);
  const server = startServe(new KernelClient(cfg.kernelBase, cfg.workspaceRoot, cfg.corpus), cfg, 0);
  await new Promise<void>((r) => server.once("listening", r));
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  try {
    const list = await fetch(`${base}/api/panel/changes?project=p-b12`);
    assert.equal(list.status, 200);
    const lj = await list.json();
    assert.equal(lj.mode, "index");
    assert.equal(lj.nodes[0].node, NODE);

    const diff = await fetch(`${base}/api/panel/changes?project=p-b12&node=${encodeURIComponent(NODE)}&a=1&b=2`);
    assert.equal(diff.status, 200);
    const dj = await diff.json();
    assert.equal(dj.mode, "diff");
    const f = dj.files.find((x: any) => x.name === NAME);
    assert.ok(f.diff.includes("@@"));
    assert.ok(f.adds > 0);

    const one = await fetch(`${base}/api/panel/changes?project=p-b12&node=${encodeURIComponent(NODE)}&a=1&b=2&file=${encodeURIComponent(NAME)}`);
    const oj = await one.json();
    assert.equal(oj.files.length, 1, "file 参数把视图收到单产物");

    const round404 = await fetch(`${base}/api/panel/changes?project=p-b12&node=${encodeURIComponent(NODE)}&a=7`);
    assert.equal(round404.status, 404);
    assert.deepEqual((await round404.json()).available, [1, 2]);

    const noProject = await fetch(`${base}/api/panel/changes`);
    assert.equal(noProject.status, 400);
  } finally {
    server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
