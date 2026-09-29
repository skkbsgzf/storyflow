// 工单 WO-B13（波9）· 二进制预览数据面单测＋协议面集成测：
//   白名单后缀出字节流（MIME/长度/Range 正确），白名单外 415 带说明，越界 403，超限 413，
//   preview 元数据把「能不能内嵌＋URL＋为什么不能」一次说清（UI 不许靠空 body 猜）。
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { AddressInfo } from "node:net";
import { panelRaw, panelPreview } from "../src/panels.js";
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
    assert.equal(alias.status, 200, "A8 侧的 files?…&raw=1 拼法走同一个 panelRaw");
    assert.equal(alias.headers.get("content-type"), "image/png");
    assert.deepEqual([...Buffer.from(await alias.arrayBuffer())], [...PNG]);
    const aliasDocx = await fetch(`${base}/api/panel/files?project=p-b13&file=${encodeURIComponent("交付/稿子.docx")}&raw=1`);
    assert.equal(aliasDocx.status, 415);

    const docx = await fetch(`${base}/api/panel/raw?project=p-b13&file=${encodeURIComponent("交付/稿子.docx")}`);
    assert.equal(docx.status, 415);
    assert.equal((await docx.json()).code, "UNSUPPORTED_TYPE");

    const trav = await fetch(`${base}/api/panel/raw?project=p-b13&file=${encodeURIComponent("../../etc/passwd.png")}`);
    assert.equal(trav.status, 403);

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
