// 官方面板数据接口 · 本地文件能力单测＋协议面集成测（工单-20261002 批A；写通道＝工单-20261012 W4.2 通道 B）：
//   files 树/读取（白名单外 400、越界 403、查无 404、坏 project 400）；raw 白名单出字节流（MIME/长度/Range 正确），
//   白名单外 415 带说明，越界 403，超限 413；preview 元数据四档说清；退役面（worldbook/telemetry/changes/canvas）410。
//   W4.2 写通道：PUT files 落盘（临时件校验＋原子替换）、越界 403、后缀 415、指纹过期 409、鉴权闸 401、错误路径 no-store。
// 自前端切割时的 panels-raw.test.ts 对齐复刻，import 换 panel-files.ts。
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { AddressInfo } from "node:net";
import { panelFiles, panelRaw, panelPreview, panelWrite } from "../src/panel-files.js";
import { KernelClient } from "../src/kernel.js";
import type { HarnessConfig } from "../src/config.js";
import { startServe } from "../src/serve.js";

// 1x1 PNG（真字节，浏览器可解）——数据面测试只需要「是个文件、后缀对、字节稳」。
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function tmpProject(): { root: string; kernel: KernelClient; dir: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sh-b13-"));
  const dir = path.join(root, "projects", "p-b13");
  fs.mkdirSync(path.join(dir, "交付"), { recursive: true });
  fs.writeFileSync(path.join(dir, "交付", "shot.png"), PNG);
  fs.writeFileSync(path.join(dir, "交付", "稿子.docx"), Buffer.from("fake docx bytes"));
  fs.writeFileSync(path.join(dir, "交付", "正文.md"), "# 正文\n", "utf-8");
  fs.writeFileSync(path.join(dir, "交付", "mark.svg"), Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'));
  const kernel = {
    projectDir: (p: string) => path.join(root, "projects", p),
    corpus: { projectsDir: "projects" },
  } as unknown as KernelClient;
  return { root, kernel, dir };
}

test("panelFiles：两层树每项带 path/sizeKB/mtime；单文件读取 200；白名单外 400；越界 403；查无 404；坏 project 400", () => {
  const { kernel } = tmpProject();
  const tree = panelFiles(kernel, "p-b13", "");
  assert.equal(tree.status, 200);
  const files = (tree.payload as { files: { path: string }[] }).files;
  assert.ok(files.some((f) => f.path === "交付/shot.png"));
  assert.ok(files.some((f) => f.path === "交付/正文.md"));
  const read = panelFiles(kernel, "p-b13", "交付/正文.md");
  assert.equal(read.status, 200);
  assert.equal((read.payload as { content: string }).content, "# 正文\n");
  assert.equal(panelFiles(kernel, "p-b13", "交付/shot.png").status, 400, "二进制后缀不在读取白名单");
  assert.equal(panelFiles(kernel, "p-b13", "../../outside.md").status, 403);
  assert.equal(panelFiles(kernel, "p-b13", "交付/没有.md").status, 404);
  assert.equal(panelFiles(kernel, "../else", "").status, 400);
});

test("panelRaw（白名单内）：200＋正确 MIME＋content-length＋accept-ranges，流出的字节与磁盘一致", async () => {
  const { kernel } = tmpProject();
  const r = panelRaw(kernel, "p-b13", "交付/shot.png");
  assert.equal(r.status, 200);
  assert.equal(r.headers["content-type"], "image/png");
  assert.equal(r.headers["content-length"], String(PNG.length));
  assert.equal(r.headers["accept-ranges"], "bytes");
  assert.equal(r.headers["x-content-type-options"], "nosniff");
  assert.match(r.headers["content-disposition"], /inline; filename\*=UTF-8''shot\.png/);
  assert.ok(r.stream);
  const chunks: Buffer[] = [];
  for await (const c of r.stream!) chunks.push(c as Buffer);
  assert.deepEqual([...Buffer.concat(chunks)], [...PNG]);
});

test("panelRaw（svg）：同源内联附 CSP 沙箱头，白名单图片不受影响", () => {
  const { kernel } = tmpProject();
  const svg = panelRaw(kernel, "p-b13", "交付/mark.svg");
  assert.equal(svg.status, 200);
  assert.equal(svg.headers["content-type"], "image/svg+xml");
  assert.match(svg.headers["content-security-policy"], /default-src 'none'/);
  assert.match(svg.headers["content-security-policy"], /sandbox/);
  svg.stream?.destroy();
  const png = panelRaw(kernel, "p-b13", "交付/shot.png");
  assert.equal(png.headers["content-security-policy"], undefined);
  png.stream?.destroy();
});

test("panelRaw（Range）：bytes=0-3 → 206 四字节与 content-range；bytes=-2 取尾；越界 → 416", () => {
  const { kernel } = tmpProject();
  const head = panelRaw(kernel, "p-b13", "交付/shot.png", "bytes=0-3");
  assert.equal(head.status, 206);
  assert.equal(head.headers["content-length"], "4");
  assert.equal(head.headers["content-range"], `bytes 0-3/${PNG.length}`);
  const tail = panelRaw(kernel, "p-b13", "交付/shot.png", "bytes=-2");
  assert.equal(tail.status, 206);
  assert.equal(tail.headers["content-range"], `bytes ${PNG.length - 2}-${PNG.length - 1}/${PNG.length}`);
  const bad = panelRaw(kernel, "p-b13", "交付/shot.png", "bytes=999999-1000000");
  assert.equal(bad.status, 416);
  assert.equal(bad.stream, undefined);
  assert.equal(bad.headers["content-range"], `bytes */${PNG.length}`);
  head.stream?.destroy();
  tail.stream?.destroy();
});

test("panelRaw（白名单外 / 越界 / 查无 / 超限）：全部显式 JSON 说明带 code，绝不空 body", () => {
  const { kernel, dir, root } = tmpProject();
  const no = panelRaw(kernel, "p-b13", "交付/稿子.docx");
  assert.equal(no.status, 415);
  assert.equal((no.payload as { code: string }).code, "UNSUPPORTED_TYPE");
  assert.ok(Array.isArray((no.payload as { allowed: string[] }).allowed));
  const out = panelRaw(kernel, "p-b13", "../../AGENTS.md");
  assert.equal(out.status, 403);
  assert.equal((out.payload as { code: string }).code, "OUT_OF_PROJECT");
  const miss = panelRaw(kernel, "p-b13", "交付/没有这张.png");
  assert.equal(miss.status, 404);
  assert.equal((miss.payload as { code: string }).code, "NOT_FOUND");
  assert.equal(panelRaw(kernel, "p-b13", "").status, 400);
  assert.equal(panelRaw(kernel, "p/../x", "交付/shot.png").status, 400);
  // 超上限：造一个 25MB+1 的 .png（只此一处大块头，用完删）
  const big = path.join(dir, "交付", "big.png");
  fs.writeFileSync(big, Buffer.alloc(25_000_001, 1));
  const over = panelRaw(kernel, "p-b13", "交付/big.png");
  assert.equal(over.status, 413);
  const p = over.payload as { code: string; size: number; limit: number };
  assert.equal(p.code, "TOO_LARGE");
  assert.equal(p.size, 25_000_001);
  assert.equal(p.limit, 25_000_000);
  fs.rmSync(root, { recursive: true, force: true });
});

test("panelPreview：inline / text / none / missing 四档各回 URL 或理由，不靠 UI 猜", () => {
  const { kernel } = tmpProject();
  const body = (r: ReturnType<typeof panelPreview>) => r.payload as Record<string, unknown>;
  const img = panelPreview(kernel, "p-b13", "交付/shot.png");
  assert.equal(img.status, 200);
  assert.equal(body(img).kind, "inline");
  assert.equal(body(img).mime, "image/png");
  assert.equal(body(img).url, `/api/panel/raw?project=p-b13&file=${encodeURIComponent("交付/shot.png")}`);
  const md = panelPreview(kernel, "p-b13", "交付/正文.md");
  assert.equal(body(md).kind, "text");
  assert.match(String(body(md).url), /^\/api\/panel\/files\?project=p-b13&file=/);
  const docx = panelPreview(kernel, "p-b13", "交付/稿子.docx");
  assert.equal(body(docx).kind, "none");
  assert.equal(body(docx).url, null);
  assert.match(String(body(docx).note), /不能直接看/);
  const gone = panelPreview(kernel, "p-b13", "交付/没了.png");
  assert.equal(body(gone).kind, "missing");
  assert.equal(gone.status, 200, "查无也回 200＋理由：面板显式说明而不是空白");
  assert.equal(panelPreview(kernel, "p-b13", "").status, 400);
  assert.equal(panelPreview(kernel, "p-b13", "../outside.png").status, 403);
});

// ── 协议面集成测：真起 serve，走 HTTP 头 ─────────────────────────

function serveCfg(root: string, password = ""): HarnessConfig {
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
    serve: { hostname: "127.0.0.1", password, passwordSource: password ? "env" : "none", tokenTtlHours: 72, allowedOrigins: [], credentialsFile: path.join(root, ".external", "credentials.json") },
    kernelBase: "http://127.0.0.1:9", project: "p-b13", provider: "zai", model: "test", maxParallel: 1, thinking: "low",
  } as unknown as HarnessConfig;
}

test("HTTP 集成：raw 出图（200 头全对＋字节 sha 一致）、Range 206、docx 415、越界 403、preview 元数据 JSON", async () => {
  const { root, dir } = tmpProject();
  const cfg = serveCfg(root);
  const server = startServe(new KernelClient(cfg.kernelBase, cfg.workspaceRoot, cfg.corpus), cfg, 0);
  await new Promise<void>((r) => server.once("listening", r));
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  try {
    const ok = await fetch(`${base}/api/panel/raw?project=p-b13&file=${encodeURIComponent("交付/shot.png")}`);
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("content-type"), "image/png");
    assert.equal(ok.headers.get("content-length"), String(PNG.length));
    const buf = Buffer.from(await ok.arrayBuffer());
    assert.deepEqual([...buf], [...PNG], "供出的字节与磁盘一致");
    assert.equal(fs.statSync(path.join(dir, "交付", "shot.png")).size, PNG.length);

    const partial = await fetch(`${base}/api/panel/raw?project=p-b13&file=${encodeURIComponent("交付/shot.png")}`, { headers: { range: "bytes=1-3" } });
    assert.equal(partial.status, 206);
    assert.equal(partial.headers.get("content-range"), `bytes 1-3/${PNG.length}`);
    assert.deepEqual([...Buffer.from(await partial.arrayBuffer())], [...PNG.subarray(1, 4)]);

    const alias = await fetch(`${base}/api/panel/files?project=p-b13&file=${encodeURIComponent("交付/shot.png")}&raw=1`);
    assert.equal(alias.status, 200, "files?…&raw=1 拼法走同一个 panelRaw");
    assert.equal(alias.headers.get("content-type"), "image/png");
    assert.deepEqual([...Buffer.from(await alias.arrayBuffer())], [...PNG]);
    const aliasDocx = await fetch(`${base}/api/panel/files?project=p-b13&file=${encodeURIComponent("交付/稿子.docx")}&raw=1`);
    assert.equal(aliasDocx.status, 415);

    const docx = await fetch(`${base}/api/panel/raw?project=p-b13&file=${encodeURIComponent("交付/稿子.docx")}`);
    assert.equal(docx.status, 415);
    assert.equal((await docx.json()).code, "UNSUPPORTED_TYPE");

    const trav = await fetch(`${base}/api/panel/raw?project=p-b13&file=${encodeURIComponent("../../etc/passwd.png")}`);
    assert.equal(trav.status, 403);

    const tree = await fetch(`${base}/api/panel/files?project=p-b13`);
    assert.equal(tree.status, 200);
    assert.ok(Array.isArray((await tree.json()).files));

    const meta = await fetch(`${base}/api/panel/preview?project=p-b13&file=${encodeURIComponent("交付/shot.png")}`);
    assert.equal(meta.status, 200);
    const j = await meta.json();
    assert.equal(j.kind, "inline");
    assert.equal(j.sizeKB, 0);
    assert.ok(j.url.startsWith("/api/panel/raw?"));
  } finally {
    server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("HTTP 集成：退役面（worldbook/telemetry/changes/canvas）仍 410 GONE 带 code", async () => {
  const { root } = tmpProject();
  const cfg = serveCfg(root);
  const server = startServe(new KernelClient(cfg.kernelBase, cfg.workspaceRoot, cfg.corpus), cfg, 0);
  await new Promise<void>((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    for (const name of ["worldbook", "telemetry", "changes", "canvas"]) {
      const r = await fetch(`${base}/api/panel/${name}?project=p-b13`);
      assert.equal(r.status, 410, `${name} 必须显式 410`);
      const j = await r.json();
      assert.equal(j.error, "GONE");
      assert.equal(j.code, "RETIRED_FACE");
      assert.equal(j.retired, name);
    }
  } finally {
    server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── W4.2 通道 B 写端点：panelWrite 单元面 ─────────────────────

const sha = (s: string) => createHash("sha256").update(Buffer.from(s, "utf-8")).digest("hex");
const tmpLeft = (dir: string) => fs.readdirSync(dir).filter((n) => n.includes(".wtmp-"));

test("panelWrite：新建落盘 200＋回账（bytes/hash/mtime/created），临时件不残留", () => {
  const { kernel, dir } = tmpProject();
  const r = panelWrite(kernel, "p-b13", "交付/新稿.md", { content: "# 新稿\n第一段。\n" });
  assert.equal(r.status, 200);
  const p = r.payload as { ok: boolean; created: boolean; replaced: boolean; bytes: number; hash: string; mtime: string; note: string };
  assert.equal(p.ok, true);
  assert.equal(p.created, true);
  assert.equal(p.replaced, false);
  assert.equal(p.bytes, Buffer.byteLength("# 新稿\n第一段。\n", "utf-8"));
  assert.equal(p.hash, sha("# 新稿\n第一段。\n"));
  assert.ok(p.mtime.length > 10);
  assert.match(p.note, /project-index diff/, "写入后必须提示重跑索引与 kit 自检（看板只提示不自动执行）");
  assert.equal(fs.readFileSync(path.join(dir, "交付", "新稿.md"), "utf-8"), "# 新稿\n第一段。\n");
  assert.deepEqual(tmpLeft(path.join(dir, "交付")), [], "临时件必须已被替换掉，不许留在盘上");
});

test("panelWrite：覆盖已存在文件必须带对的 expectHash；缺失 409、过期 409、原文件一个字节不动", () => {
  const { kernel, dir } = tmpProject();
  const abs = path.join(dir, "交付", "正文.md");
  const before = fs.readFileSync(abs, "utf-8");
  const cur = sha(before);
  const noHash = panelWrite(kernel, "p-b13", "交付/正文.md", { content: "盖掉" });
  assert.equal(noHash.status, 409);
  assert.equal((noHash.payload as { code: string }).code, "EXPECT_HASH_REQUIRED");
  assert.equal((noHash.payload as { hash: string }).hash, cur, "409 也要把当前指纹交回去，客户端才有得对");
  const stale = panelWrite(kernel, "p-b13", "交付/正文.md", { content: "盖掉", expectHash: sha("别的版本") });
  assert.equal(stale.status, 409);
  assert.equal((stale.payload as { code: string }).code, "CONFLICT");
  assert.equal(fs.readFileSync(abs, "utf-8"), before, "被拒的写入不许动盘");
  const ok = panelWrite(kernel, "p-b13", "交付/正文.md", { content: "# 正文（改过）\n", expectHash: cur });
  assert.equal(ok.status, 200);
  assert.equal((ok.payload as { replaced: boolean }).replaced, true);
  assert.equal(fs.readFileSync(abs, "utf-8"), "# 正文（改过）\n");
  assert.deepEqual(tmpLeft(path.join(dir, "交付")), []);
});

test("panelWrite：越界 403、坏 project 400、后缀白名单外 415、隐藏件 400、content 非字符串 400、超限 413", () => {
  const { kernel, root } = tmpProject();
  const out = panelWrite(kernel, "p-b13", "../../outside.md", { content: "逃逸" });
  assert.equal(out.status, 403);
  assert.equal((out.payload as { code: string }).code, "OUT_OF_PROJECT");
  assert.equal(fs.existsSync(path.join(root, "outside.md")), false, "越界写入必须一个字节都没落地");
  assert.equal(panelWrite(kernel, "p/../x", "a.md", { content: "x" }).status, 400);
  const json = panelWrite(kernel, "p-b13", "交付/state.json", { content: "{}" });
  assert.equal(json.status, 415, "json 是工具独占的派生件，面板不代写");
  assert.equal((json.payload as { code: string }).code, "UNSUPPORTED_TYPE");
  assert.deepEqual((json.payload as { allowed: string[] }).allowed, [".md", ".txt"]);
  assert.equal(panelWrite(kernel, "p-b13", "交付/稿子.docx", { content: "x" }).status, 415);
  assert.equal(panelWrite(kernel, "p-b13", "交付/.隐藏.md", { content: "x" }).status, 400);
  assert.equal(panelWrite(kernel, "p-b13", "交付/../../x.md", { content: "x" }).status, 403);
  assert.equal((panelWrite(kernel, "p-b13", "", { content: "x" }).payload as { code: string }).code, "MISSING_FILE");
  assert.equal(panelWrite(kernel, "p-b13", "交付/a.md", { content: 42 as unknown as string }).status, 400);
  assert.equal(panelWrite(kernel, "p-b13", "交付/a.md", {}).status, 400);
  const big = panelWrite(kernel, "p-b13", "交付/大.md", { content: "字".repeat(2_000_001) });
  assert.equal(big.status, 413);
  assert.equal((big.payload as { code: string }).code, "TOO_LARGE");
  assert.equal((big.payload as { limit: number }).limit, 2_000_000);
});

test("panelWrite：不存在的子目录自动建；目标已是目录 → 409 NOT_A_FILE；带旧指纹写新文件 → 409", () => {
  const { kernel, dir } = tmpProject();
  const r = panelWrite(kernel, "p-b13", "新目录/子.md", { content: "新建目录里的文件\n" });
  assert.equal(r.status, 200);
  assert.equal(fs.readFileSync(path.join(dir, "新目录", "子.md"), "utf-8"), "新建目录里的文件\n");
  fs.mkdirSync(path.join(dir, "交付", "是个目录.md"), { recursive: true });
  const notFile = panelWrite(kernel, "p-b13", "交付/是个目录.md", { content: "x" });
  assert.equal(notFile.status, 409);
  assert.equal((notFile.payload as { code: string }).code, "NOT_A_FILE");
  const ghost = panelWrite(kernel, "p-b13", "交付/还没建.md", { content: "x", expectHash: sha("幻觉版本") });
  assert.equal(ghost.status, 409, "盘上查无却带指纹 = 文件树过期，先重读");
  assert.equal(fs.existsSync(path.join(dir, "交付", "还没建.md")), false);
});

// ── W4.2 通道 B 写端点：HTTP 协议面 ─────────────────────

test("HTTP 集成：PUT files 落盘（200→读回一致），错误路径全部 no-store，POST 405", async () => {
  const { root, dir } = tmpProject();
  const cfg = serveCfg(root);
  const server = startServe(new KernelClient(cfg.kernelBase, cfg.workspaceRoot, cfg.corpus), cfg, 0);
  await new Promise<void>((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const put = (file: string, payload: unknown, raw?: string) => fetch(
    `${base}/api/panel/files?project=p-b13&file=${encodeURIComponent(file)}`,
    { method: "PUT", headers: { "content-type": "application/json" }, body: raw ?? JSON.stringify(payload) },
  );
  try {
    // 读端先把当前指纹交出来（客户端不必自己会 sha）
    const read = await fetch(`${base}/api/panel/files?project=p-b13&file=${encodeURIComponent("交付/正文.md")}`);
    assert.equal(read.headers.get("cache-control"), "no-store");
    const rj = await read.json();
    assert.equal(rj.content, "# 正文\n");
    assert.equal(rj.hash, sha("# 正文\n"));
    assert.equal(rj.truncated, false);

    const ok = await put("交付/正文.md", { content: "# 正文（在线改的）\n", expectHash: rj.hash });
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("cache-control"), "no-store", "写成功也不许缓存");
    const oj = await ok.json();
    assert.equal(oj.ok, true);
    assert.equal(oj.hash, sha("# 正文（在线改的）\n"));
    assert.equal(fs.readFileSync(path.join(dir, "交付", "正文.md"), "utf-8"), "# 正文（在线改的）\n");
    assert.deepEqual(fs.readdirSync(path.join(dir, "交付")).filter((n) => n.includes(".wtmp-")), []);

    const created = await put("交付/在线新建.md", { content: "新建\n" });
    assert.equal(created.status, 200);
    assert.equal((await created.json()).created, true);
    assert.equal(fs.readFileSync(path.join(dir, "交付", "在线新建.md"), "utf-8"), "新建\n");

    const trav = await put("../../outside.md", { content: "逃逸" });
    const docx = await put("交付/稿子.docx", { content: "x" });
    const conflict = await put("交付/正文.md", { content: "盖", expectHash: sha("过期副本") });
    const noHash = await put("交付/正文.md", { content: "盖" });
    const badJson = await put("交付/a.md", null, "{ 不是 JSON");
    const noFile = await put("", { content: "x" });
    const cases: [string, Response, number, string][] = [
      ["越界", trav, 403, "OUT_OF_PROJECT"],
      ["后缀", docx, 415, "UNSUPPORTED_TYPE"],
      ["指纹过期", conflict, 409, "CONFLICT"],
      ["缺指纹", noHash, 409, "EXPECT_HASH_REQUIRED"],
      ["坏 body", badJson, 400, "BAD_JSON"],
      ["缺 file", noFile, 400, "MISSING_FILE"],
    ];
    for (const [label, res, status, code] of cases) {
      assert.equal(res.status, status, `${label} 应回 ${status}`);
      assert.equal(res.headers.get("cache-control"), "no-store", `${label} 错误路径必须 no-store（缓存投毒红线）`);
      assert.equal(res.headers.get("content-type"), "application/json", `${label} 必须显式 JSON 说明，不给空 body`);
      assert.equal((await res.json()).code, code, `${label} 的 code`);
    }
    assert.equal(fs.existsSync(path.join(root, "outside.md")), false);

    const wrong = await fetch(`${base}/api/panel/files?project=p-b13&file=${encodeURIComponent("交付/正文.md")}`, { method: "POST" });
    assert.equal(wrong.status, 405);
    assert.equal(wrong.headers.get("cache-control"), "no-store");
    // 读通道没被写通道挤掉
    const tree = await fetch(`${base}/api/panel/files?project=p-b13`);
    assert.equal(tree.status, 200);
    assert.ok((await tree.json()).files.some((f: { path: string }) => f.path === "交付/在线新建.md"));
    const meta = await fetch(`${base}/api/panel/preview?project=p-b13&file=${encodeURIComponent("交付/正文.md")}`);
    assert.equal((await meta.json()).kind, "text");
  } finally {
    server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("HTTP 集成：写通道的预检——loopback 源 OPTIONS PUT 放行（含 credentials），公网源 403 且不回显", async () => {
  const { root } = tmpProject();
  const cfg = serveCfg(root);
  const server = startServe(new KernelClient(cfg.kernelBase, cfg.workspaceRoot, cfg.corpus), cfg, 0);
  await new Promise<void>((r) => server.once("listening", r));
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  try {
    const pre = await fetch(`${base}/api/panel/files?project=p-b13&file=x.md`, {
      method: "OPTIONS",
      headers: { origin: `http://127.0.0.1:${port + 1}`, "access-control-request-method": "PUT", "access-control-request-headers": "content-type" },
    });
    assert.equal(pre.status, 204, "loopback 源的预检必须过");
    assert.match(pre.headers.get("access-control-allow-methods") ?? "", /PUT/, "不放 PUT＝看板跨端口写不了");
    assert.equal(pre.headers.get("access-control-allow-origin"), `http://127.0.0.1:${port + 1}`);
    assert.equal(pre.headers.get("access-control-allow-credentials"), "true", "cookie 鉴权跨源要带凭据");
    const evil = await fetch(`${base}/api/panel/files?project=p-b13&file=x.md`, {
      method: "OPTIONS", headers: { origin: "https://evil.example", "access-control-request-method": "PUT" },
    });
    assert.equal(evil.status, 403);
    assert.equal(evil.headers.get("access-control-allow-origin"), null, "名单外的源一个头都不给");
    assert.equal(evil.headers.get("access-control-allow-credentials"), null);
  } finally {
    server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("HTTP 集成：设了口令 → 未过闸 PUT 401（盘上不动），口令换 cookie 后 PUT 200，过闸也不许越界", async () => {
  const { root, dir } = tmpProject();
  const cfg = serveCfg(root, "w42-口令");
  const server = startServe(new KernelClient(cfg.kernelBase, cfg.workspaceRoot, cfg.corpus), cfg, 0);
  await new Promise<void>((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const anon = await fetch(`${base}/api/panel/files?project=p-b13&file=${encodeURIComponent("交付/正文.md")}`, {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: "没口令也想写" }),
    });
    assert.equal(anon.status, 401, "写端点在 B1 闸门之后，未过闸根本进不来");
    assert.equal((await anon.json()).error, "UNAUTHORIZED");
    assert.equal(fs.readFileSync(path.join(dir, "交付", "正文.md"), "utf-8"), "# 正文\n", "被闸住＝盘上零改动");

    const bad = await fetch(`${base}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "错口令" }) });
    assert.equal(bad.status, 401);

    const login = await fetch(`${base}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "w42-口令" }) });
    assert.equal(login.status, 200);
    const cookies = login.headers.getSetCookie ? login.headers.getSetCookie() : [login.headers.get("set-cookie") ?? ""];
    const cookie = (cookies[0] ?? "").split(";")[0];
    assert.ok(cookie.startsWith("sh_token="), "登录必须发 cookie token");

    const authed = await fetch(`${base}/api/panel/files?project=p-b13&file=${encodeURIComponent("交付/正文.md")}`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ content: "# 正文（过闸后改的）\n", expectHash: sha("# 正文\n") }),
    });
    assert.equal(authed.status, 200);
    assert.equal((await authed.json()).ok, true);
    assert.equal(fs.readFileSync(path.join(dir, "交付", "正文.md"), "utf-8"), "# 正文（过闸后改的）\n");

    const stillOut = await fetch(`${base}/api/panel/files?project=p-b13&file=${encodeURIComponent("../../outside.md")}`, {
      method: "PUT", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ content: "过了闸也不许越界" }),
    });
    assert.equal(stillOut.status, 403, "过闸只解决「你是谁」，越界判定照旧");
    assert.equal(fs.existsSync(path.join(root, "outside.md")), false);
  } finally {
    server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
