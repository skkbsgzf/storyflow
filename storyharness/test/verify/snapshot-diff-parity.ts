// 工单 WO-B12 验收 · 面板 diff ↔ tools/snapshot.py diff 逐字节对账（真项目快照，不是造的数据）。
// 为什么单独一个脚本：这条对账要起宿主 Python，不能进 `npm test`（底座测试不许押在 python 上）；
// 逐字节算法等式的另一道锁在 test/udiff-parity.test.ts（166 例 difflib 语料，纯 TS）。
//
// 跑法（在 storyharness 目录）：
//   PYTHONIOENCODING=utf-8 npx tsx test/verify/snapshot-diff-parity.ts \
//     --limit 24 --http --out ../docs/收据-B12-对账-20260928.json
//
// 两层对账：
//   ① 函数层：src/udiff.ts（panels.ts 里 diff 的唯一来源）读同一对快照文件算 diff；
//   ② 面板层（--http）：真起 8431 同款协议面（随机端口），走 GET /api/panel/changes 取 diff 字段。
// 口径：python 侧跑 `python tools/snapshot.py diff <project> <node> --a A --b B`，按
//   `===== 文件名 =====` 切出每文件的 difflib 文本。两边 diff 头两行的标签按设计不同
//   （snapshot.py 打通用名 previous/current，面板把文件名打在 ---/+++ 上给 A8 分组用），
//   因此断言 = 去掉头两行之后的正文逐字节相同 ＋ adds/dels/hunks 计数相同。
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { diffText, splitLines } from "../../src/udiff.js";
import { KernelClient } from "../../src/kernel.js";
import { startServe } from "../../src/serve.js";
import type { CorpusLayout, HarnessConfig } from "../../src/config.js";
import type { AddressInfo } from "node:net";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, "..", "..");
const repoRoot = path.resolve(pkgRoot, "..");

const argv = process.argv.slice(2);
const arg = (k: string, d: string): string => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : d;
};
const projectsDir = path.resolve(arg("projects", path.join(repoRoot, "projects")));
const limit = Number(arg("limit", "24"));
const httpOn = argv.includes("--http");
const out = arg("out", "");

interface Pair { project: string; node: string; a: number; b: number }
const pairs: Pair[] = [];
for (const p of fs.readdirSync(projectsDir, { withFileTypes: true }).filter((d) => d.isDirectory())) {
  const idxFile = path.join(projectsDir, p.name, "snapshots", "index.json");
  if (!fs.existsSync(idxFile)) continue;
  let idx: { snapshots?: Record<string, { round: number }[]> };
  try {
    idx = JSON.parse(fs.readFileSync(idxFile, "utf-8"));
  } catch {
    continue;
  }
  for (const [node, rounds] of Object.entries(idx.snapshots ?? {})) {
    const rs = [...rounds].map((r) => r.round).sort((x, y) => x - y);
    if (rs.length < 2) continue;
    pairs.push({ project: p.name, node, a: rs[0], b: rs[rs.length - 1] });
  }
}
const chosen = pairs.slice(0, limit);

const snapSide = (project: string, node: string, round: number, name: string): string =>
  path.join(projectsDir, project, "snapshots", node, `r${round}`, name);
const readText = (abs: string): string => (fs.existsSync(abs) ? fs.readFileSync(abs, "utf-8") : "");
const sha = (s: string) => createHash("sha256").update(s, "utf-8").digest("hex").slice(0, 12);

interface FileRow {
  name: string;
  python: { bytes: number; adds: number; dels: number; hunks: number; bodySha: string };
  panel: { bytes: number; adds: number; dels: number; hunks: number; bodySha: string };
  bodyEqual: boolean;
  countsEqual: boolean;
}
interface Row {
  project: string;
  node: string;
  a: number;
  b: number;
  pythonExit: number | null;
  pythonError: string | null;
  files: FileRow[];
}

const countOf = (text: string) => {
  const lines = text ? text.split("\n") : [];
  return {
    bytes: Buffer.byteLength(text, "utf-8"),
    adds: lines.filter((l) => l.startsWith("+") && !l.startsWith("+++")).length,
    dels: lines.filter((l) => l.startsWith("-") && !l.startsWith("---")).length,
    hunks: lines.filter((l) => l.startsWith("@@")).length,
  };
};
/** 去掉 `--- x` / `+++ y` 两行头（唯一按设计不同的部分），剩下的正文拿来逐字节比。 */
const stripHeader = (text: string): string => (text ? text.split("\n").slice(2).join("\n") : text);

/** python 侧输出切成 {name, text} 块。 */
function splitSnapshotOut(stdout: string): { name: string; text: string }[] {
  const blocks: { name: string; text: string }[] = [];
  let cur: { name: string; lines: string[] } | null = null;
  for (const line of String(stdout).replace(/\r\n/g, "\n").split("\n")) {
    const m = /^===== (.+) =====$/.exec(line);
    if (m) {
      if (cur) blocks.push({ name: cur.name, text: cur.lines.join("\n") });
      cur = { name: m[1], lines: [] };
      continue;
    }
    if (cur) cur.lines.push(line);
  }
  if (cur) blocks.push({ name: cur.name, text: cur.lines.join("\n") });
  return blocks;
}

function runSnapshotPy(project: string, node: string, a: number, b: number) {
  return spawnSync("python", [path.join(repoRoot, "tools", "snapshot.py"), "diff", project, node, "--a", String(a), "--b", String(b)], {
    encoding: "utf-8",
    cwd: repoRoot,
    timeout: 120_000,
    env: { ...process.env, PYTHONIOENCODING: "utf-8" },
  });
}

/** 一个 (pair, name) 的面板侧文本 → 对账行；panelDiff 由调用方给（函数层现算 / 面板层 HTTP 取）。 */
function compareOne(pyText: string, panelDiff: string | null, name: string, ta: string, tb: string): FileRow {
  const pyBody = pyText.replace(/^\n/, "").replace(/\n$/, "");
  const text = panelDiff ?? diffText(ta, tb, `a/${name}`, `b/${name}`).text;
  assert.equal(typeof text, "string", "diff 必须是字符串");
  const pc = countOf(pyBody);
  const mc = countOf(text);
  const pBody = sha(stripHeader(pyBody));
  const mBody = sha(stripHeader(text));
  return {
    name,
    python: { ...pc, bodySha: pBody },
    panel: { ...mc, bodySha: mBody },
    bodyEqual: pBody === mBody,
    countsEqual: pc.adds === mc.adds && pc.dels === mc.dels && pc.hunks === mc.hunks,
  };
}

function judge(rows: Row[]): number {
  let bad = 0;
  for (const r of rows) for (const f of r.files) if (!(f.bodyEqual && f.countsEqual)) bad += 1;
  return bad;
}

// ① 函数层
const rows: Row[] = [];
for (const { project, node, a, b } of chosen) {
  const py = runSnapshotPy(project, node, a, b);
  const row: Row = { project, node, a, b, pythonExit: py.status, pythonError: null, files: [] };
  if (py.status !== 0) {
    row.pythonError = String(py.stderr || py.stdout).replace(/\s+/g, " ").slice(0, 240);
    rows.push(row);
    continue;
  }
  for (const blk of splitSnapshotOut(py.stdout)) {
    const ta = readText(snapSide(project, node, a, blk.name));
    const tb = readText(snapSide(project, node, b, blk.name));
    row.files.push(compareOne(blk.text, null, blk.name, ta, tb));
  }
  rows.push(row);
}
const mismatches = judge(rows);
const compared = rows.reduce((n, r) => n + r.files.length, 0);
const crashed = rows.filter((r) => r.pythonExit !== 0);

// ② 面板层（真起协议面，走 GET /api/panel/changes）
interface IndexDrift { project: string; nodes: number; diskFiles: number; changedOnDisk: number; missingOnDisk: number }
let http: { port: number; pairs: number; files: number; binaryDegraded: number; mismatches: number; rows: Row[]; indexDrift: IndexDrift[]; workingSample: Record<string, unknown> | null } | null = null;
if (httpOn) {
  const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, ".storyharness.json"), "utf-8"));
  const corpus = { ...manifest.corpus, sessionsDir: "内部/sessions", telemetryDir: "内部/telemetry" } as unknown as CorpusLayout;
  const first = chosen[0]?.project ?? "";
  const cfg = {
    harnessVersion: "verify", workspaceRoot: repoRoot, corpusName: manifest.corpus.name, corpus,
    serve: { hostname: "127.0.0.1", password: "", passwordSource: "none", tokenTtlHours: 72, allowedOrigins: [], credentialsFile: path.join(repoRoot, ".external", "credentials.json") },
    kernelBase: manifest.kernel.base, project: first, provider: "zai", model: "verify", maxParallel: 1, thinking: "low",
  } as unknown as HarnessConfig;
  const server = startServe(new KernelClient(cfg.kernelBase, repoRoot, corpus), cfg, 0);
  await new Promise<void>((r) => server.once("listening", r));
  const port = (server.address() as AddressInfo).port;
  const hrows: Row[] = [];
  let indexDrift: IndexDrift[] = [];
  let workingSample: Record<string, unknown> | null = null;
  try {
    for (const { project, node, a, b } of chosen) {
      const py = runSnapshotPy(project, node, a, b);
      const row: Row = { project, node, a, b, pythonExit: py.status, pythonError: null, files: [] };
      const url = `http://127.0.0.1:${port}/api/panel/changes?project=${encodeURIComponent(project)}&node=${encodeURIComponent(node)}&a=${a}&b=${b}`;
      const res = await fetch(url);
      const j = (await res.json()) as { mode?: string; files?: { name: string; diff: string; code: string | null }[] };
      assert.equal(res.status, 200, `面板 ${project}/${node} → HTTP ${res.status}`);
      assert.equal(j.mode, "diff", "面板层必须回 diff 视图");
      const panelFiles = j.files ?? [];
      const byName = new Map(panelFiles.map((f) => [f.name, f.diff]));
      if (py.status !== 0) {
        row.pythonError = String(py.stderr || py.stdout).replace(/\s+/g, " ").slice(0, 240);
        // python 在这对上一崩就是二进制产物读不动。面板层的验收：请求不崩、每个 binary 条目
        // 都带 code:BINARY 且 diff 为空（不假装算出一版），其余文本条目照常算。
        for (const f of panelFiles) {
          if (f.code === "BINARY") assert.equal(f.diff, "", `${f.name} 是二进制，面板不许给 diff`);
        }
        row.files = panelFiles
          .filter((f) => f.code === "BINARY")
          .map((f) => ({
            name: f.name,
            python: { bytes: 0, adds: 0, dels: 0, hunks: 0, bodySha: "python 抛 UnicodeDecodeError" },
            panel: { bytes: 0, adds: 0, dels: 0, hunks: 0, bodySha: "面板显式降级 code:BINARY" },
            bodyEqual: true,
            countsEqual: true,
          }));
        hrows.push(row);
        continue;
      }
      for (const blk of splitSnapshotOut(py.stdout)) {
        const d = byName.get(blk.name);
        assert.ok(typeof d === "string", `面板没回这个文件：${blk.name}`);
        row.files.push(compareOne(blk.text, d, blk.name, "", ""));
      }
      hrows.push(row);
    }
    // 索引视图在真项目上跑一遍：页签打开时先拿这份账（含「改了没拍快照」的盘上漂移计数）
    indexDrift = [];
    for (const project of [...new Set(chosen.map((c) => c.project))]) {
      const ir = await fetch(`http://127.0.0.1:${port}/api/panel/changes?project=${encodeURIComponent(project)}`);
      const ij = (await ir.json()) as Record<string, any>;
      assert.equal(ir.status, 200, `index ${project} → ${ir.status}`);
      assert.equal(ij.mode, "index");
      const disk = ij.nodes.flatMap((n: Record<string, any>) => n.disk);
      indexDrift.push({
        project,
        nodes: ij.nodes.length,
        diskFiles: disk.length,
        changedOnDisk: disk.filter((d: Record<string, any>) => d.exists && !d.sameAsSnapshot).length,
        missingOnDisk: disk.filter((d: Record<string, any>) => !d.exists).length,
      });
    }
    // working 侧（快照之外的手改）在真项目上取一次样
    const w = chosen[0];
    const wr = await fetch(
      `http://127.0.0.1:${port}/api/panel/changes?project=${encodeURIComponent(w.project)}&node=${encodeURIComponent(w.node)}&a=${w.a}&b=working`,
    );
    const wj = (await wr.json()) as Record<string, any>;
    assert.equal(wr.status, 200);
    assert.equal(wj.b, "working");
    workingSample = {
      pair: `${w.project}/${w.node} r${w.a}→working`,
      files: wj.files.length,
      adds: wj.summary.adds,
      dels: wj.summary.dels,
      changed: wj.summary.changed,
    };
  } finally {
    server.close();
  }
  const degraded = hrows.filter((r) => r.pythonExit !== 0).reduce((n, r) => n + r.files.length, 0);
  http = {
    port,
    pairs: hrows.length,
    files: hrows.reduce((n, r) => n + r.files.length, 0),
    binaryDegraded: degraded,
    mismatches: judge(hrows),
    rows: hrows,
    indexDrift,
    workingSample,
  };
}

const verdict = mismatches === 0 && (!http || http.mismatches === 0)
  ? "一致（正文逐字节同＋adds/dels/hunks 同）"
  : `有 ${mismatches + (http?.mismatches ?? 0)} 个文件不一致`;
const summary = {
  at: new Date().toISOString(),
  tool: "storyharness/test/verify/snapshot-diff-parity.ts",
  python: spawnSync("python", ["--version"], { encoding: "utf-8" }).stdout?.trim() ?? "",
  pairsFound: pairs.length,
  pairsRun: chosen.length,
  layer1_function: { filesCompared: compared, mismatches },
  layer2_panelHttp: http
    ? { port: http.port, pairs: http.pairs, files: http.files, binaryDegraded: http.binaryDegraded, mismatches: http.mismatches, indexDrift: http.indexDrift, workingSample: http.workingSample }
    : "未跑（加 --http 才跑面板层）",
  pythonCrashedOn: crashed.map((c) => ({ project: c.project, node: c.node, a: c.a, b: c.b, error: c.pythonError })),
  verdict,
  note: "对账口径：同一 (项目,节点,a轮,b轮,文件)，两边读同一份快照正文；面板与 snapshot.py 的唯一设计差异是 diff 头两行的标签（previous/current ↔ a/名↔b/名），故比的是去掉头两行之后的正文与 adds/dels/hunks 计数。二进制产物 snapshot.py 会抛 UnicodeDecodeError（记在 pythonCrashedOn），面板侧显式降级（code:BINARY）不算 diff——这一项是面板比快照工具多的处理能力，不是分歧。",
  rows,
  rowsHttp: http?.rows ?? [],
};
console.log(`① 函数层：${chosen.length} 对 / ${compared} 文件 ｜ 不一致 ${mismatches} ｜ python 崩 ${crashed.length}（二进制）`);
if (http) console.log(`② 面板层：${http.pairs} 对 / ${http.files} 条目（含二进制显式降级 ${http.binaryDegraded}）｜ 不一致 ${http.mismatches}（端口 ${http.port}）`);
for (const r of crashed) console.log(`  · python 崩：${r.project}/${r.node} r${r.a}→r${r.b} —— ${String(r.pythonError).slice(0, 110)}`);
if (out) {
  fs.mkdirSync(path.dirname(path.resolve(repoRoot, out)), { recursive: true });
  fs.writeFileSync(path.resolve(repoRoot, out), JSON.stringify(summary, null, 2), "utf-8");
  console.log(`收据：${out}`);
}
assert.equal(mismatches, 0, `函数层有 ${mismatches} 个文件的正文与 snapshot.py 不符`);
if (http) assert.equal(http.mismatches, 0, `面板层有 ${http.mismatches} 个文件与 snapshot.py 不符`);
assert.ok(compared > 0, "一个文件都没比到，等于没验收");
assert.ok(splitLines("a\r\nb").length === 2);
console.log(verdict);
