// web（dsh `dsh web` 减法形态）：shell 一条命令拉起全栈并自动开浏览器。
//   ① 内核 HTTP 面（core up，默认 8421：内核 API + 静态页同源——动词/立项/工作台全通）
//   ② serve.py 前端（默认 8420：指纹巡检/页面重生成/外发隧道；页面重生成后内核静态面同盘即见）
//   ③ 本包协议面（默认 8431，进程内 startServe）：pi 单脑 agent 会话 + 生产线直驱
// 同时把 .storyharness.json 的 agent.base 指到本包协议面——生成器把它注入 DATA.agentApi，
// 工作台「对话」页签即换脑到 pi（manifest 在 serve.py page_inputs 指纹里，页面自动重生成）。
import { spawn, exec } from "node:child_process";
import * as fs from "node:fs";
import path from "node:path";
import http from "node:http";
import type { HarnessConfig } from "./config.js";
import { startServe } from "./serve.js";
import { KernelClient } from "./kernel.js";

const ping = (url: string) => new Promise<boolean>((resolve) => {
  const req = http.get(url, (r) => { r.resume(); resolve(true); });
  req.on("error", () => resolve(false));
  req.setTimeout(1500, () => { req.destroy(); resolve(false); });
});

/** 子进程拉起：stdio 必须给 pipe 并排水——"ignore" 会让 Windows 下 python 孙进程
 *  控制台初始化失败（0xC0000142，内核 whereami/quality_scan 桥全体阵亡）。 */
function quietSpawn(cmd: string, args: string[], cwd: string) {
  const kid = spawn(cmd, args, { cwd, shell: true, stdio: ["ignore", "pipe", "pipe"] });
  kid.stdout?.resume();
  kid.stderr?.resume();
  kid.on("error", () => { /* 拉起失败由端口健康检查兜底报告 */ });
  return kid;
}

async function waitUp(url: string, ms: number): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await ping(url)) return true;
    await new Promise((r) => setTimeout(r, 600));
  }
  return false;
}

export interface WebOptions { port?: number; uiPort?: number; kernelPort?: number; noOpen?: boolean }

/** B1 · manifest `runtime:` 节——声明化拉起命令（{port} 占位替换）。无节 = 回落 v4 缺省（向后兼容，见 ARCHITECTURE.md）。 */
interface RuntimeSpec { command: string; cwd?: string; port?: number; health?: string }
interface ManifestRuntime { kernel?: RuntimeSpec; ui?: RuntimeSpec }

export async function runWeb(cfg: HarnessConfig, opts: WebOptions = {}): Promise<void> {
  const root = cfg.workspaceRoot;
  const kids: ReturnType<typeof spawn>[] = [];

  // manifest：agent.base → 本包协议面（生成器注入 DATA.agentApi，页面换脑到 pi）
  const manifestPath = path.join(root, ".storyharness.json");
  let manifest: Record<string, unknown> = {};
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")); } catch { /* 新建 */ }
  const agent = (manifest as { agent?: { base?: string } }).agent ?? {};
  const port = opts.port ?? 8431;
  const wantBase = `http://127.0.0.1:${port}`;
  if (agent.base !== wantBase) {
    agent.base = wantBase;
    manifest.agent = agent;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 1) + "\n", "utf-8");
    console.error(`[storyharness] .storyharness.json agent.base → ${wantBase}（页面由 serve.py 巡检自动重生成）`);
  }

  // B1 · runtime 节（声明化）：有节按声明拉起（{port} 占位替换），无节回落 v4 缺省。
  // log 明示来源（C-B1）：声明=「manifest runtime.*」；回落=「runtime 未声明，回落 v4 缺省」。
  const rt = (manifest as { runtime?: ManifestRuntime }).runtime ?? {};
  const runtimeDeclared = Boolean(rt.kernel || rt.ui);
  const kernelPort = opts.kernelPort ?? rt.kernel?.port ?? 8421;
  const uiPort = opts.uiPort ?? rt.ui?.port ?? 8420;
  const kernelSpec: RuntimeSpec = rt.kernel ?? { command: "npx tsx src/cli.ts up --port {port}", cwd: "core", port: kernelPort, health: "/" };
  const uiSpec: RuntimeSpec = rt.ui ?? { command: "python tools/serve.py {port}", cwd: ".", port: uiPort, health: "/" };
  const srcK = rt.kernel ? "manifest runtime.kernel" : "runtime 未声明，回落 v4 缺省";
  const srcU = rt.ui ? "manifest runtime.ui" : "runtime 未声明，回落 v4 缺省";

  if (!(await ping(`http://127.0.0.1:${kernelPort}${kernelSpec.health ?? "/"}`))) {
    console.error(`[storyharness] 拉起内核（${srcK}，:${kernelPort}）…首次 tsx 冷启动可能要 1-2 分钟`);
    kids.push(quietSpawn(kernelSpec.command.replace("{port}", String(kernelPort)), [], path.join(root, kernelSpec.cwd ?? ".")));
  } else {
    console.error(`[storyharness] 内核已在 :${kernelPort}（复用，${srcK}）`);
  }
  if (!(await ping(`http://127.0.0.1:${uiPort}${uiSpec.health ?? "/"}`))) {
    console.error(`[storyharness] 拉起前端（${srcU}，:${uiPort}）…`);
    kids.push(quietSpawn(uiSpec.command.replace("{port}", String(uiPort)), [], path.join(root, uiSpec.cwd ?? ".")));
  } else {
    console.error(`[storyharness] 前端已在 :${uiPort}（复用，${srcU}）`);
  }

  const k = new KernelClient(cfg.kernelBase, root, cfg.corpus);
  startServe(k, cfg, port);
  console.error(`[storyharness] 协议面（pi 单脑 + 生产线）：http://127.0.0.1:${port}`);

  const okKernel = await waitUp(`http://127.0.0.1:${kernelPort}/`, 120_000);
  const okUi = await waitUp(`http://127.0.0.1:${uiPort}/`, 30_000);
  if (!okKernel) console.error("[storyharness] 警告：内核未就绪——对话/立项稍后重试或刷新页面");
  if (okUi || okKernel) {
    const url = `http://127.0.0.1:${okKernel ? kernelPort : uiPort}/`;
    console.error(`[storyharness] 就绪：${url}`);
    console.error("[storyharness] 项目中心（projects.html）可新建编剧项目；工作台「对话」页签 = pi 单脑；▶ 执行器 = 产线批循环");
    if (!opts.noOpen) exec(`start "" "${url}"`);
  } else {
    console.error("[storyharness] 内核与前端都未就绪——检查端口占用后重试");
  }

  const cleanup = () => {
    for (const kid of kids) { try { kid.kill(); } catch { /* 忽略 */ } }
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
  await new Promise(() => { /* 常驻——退出走 Ctrl+C（同 serve） */ });
}
