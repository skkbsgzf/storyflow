// web（dsh `dsh web` 减法形态）：shell 一条命令拉起全栈并自动开浏览器。
//   ① 内核 HTTP 面（core up，默认 8421：动词/立项全通）
//   ② 本包协议面（默认 8431，进程内 startServe）：pi 单脑 agent 会话 + 生产线直驱
// （前端已随 2026-10-02 切割离仓：无页面服务；界面由外部宿主经 adapter 协议接入。）
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

export interface WebOptions { port?: number; kernelPort?: number; noOpen?: boolean }

/** B1 · manifest `runtime:` 节——声明化拉起命令（{port} 占位替换）。无节 = 回落 v4 缺省（向后兼容，见 ARCHITECTURE.md）。 */
interface RuntimeSpec { command: string; cwd?: string; port?: number; health?: string }
interface ManifestRuntime { kernel?: RuntimeSpec; ui?: RuntimeSpec }

export async function runWeb(cfg: HarnessConfig, opts: WebOptions = {}): Promise<void> {
  const root = cfg.workspaceRoot;
  const kids: ReturnType<typeof spawn>[] = [];

  // manifest：runtime 节读取（agent.base 曾供页面生成器注入 DATA.agentApi，前端切割后无消费者，不再写）。
  const manifestPath = path.join(root, ".storyharness.json");
  let manifest: Record<string, unknown> = {};
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")); } catch { /* 新建 */ }
  const port = opts.port ?? 8431;

  // B1 · runtime 节（声明化）：有节按声明拉起（{port} 占位替换），无节回落 v4 缺省。
  // log 明示来源（C-B1）：声明=「manifest runtime.kernel」；回落=「runtime 未声明，回落 v4 缺省」。
  // runtime.ui 已随前端切割退役：声明了也只是忽略（回显一句，不拉页面服务）。
  const rt = (manifest as { runtime?: ManifestRuntime }).runtime ?? {};
  const runtimeDeclared = Boolean(rt.kernel);
  const kernelPort = opts.kernelPort ?? rt.kernel?.port ?? 8421;
  const kernelSpec: RuntimeSpec = rt.kernel ?? { command: "npx tsx src/cli.ts up --port {port}", cwd: "core", port: kernelPort, health: "/" };
  const srcK = rt.kernel ? "manifest runtime.kernel" : "runtime 未声明，回落 v4 缺省";
  if (rt.ui) console.error("[storyharness] manifest runtime.ui 已忽略（前端已切割离仓，无页面服务可拉）");

  if (!(await ping(`http://127.0.0.1:${kernelPort}${kernelSpec.health ?? "/"}`))) {
    console.error(`[storyharness] 拉起内核（${srcK}，:${kernelPort}）…首次 tsx 冷启动可能要 1-2 分钟`);
    kids.push(quietSpawn(kernelSpec.command.replace("{port}", String(kernelPort)), [], path.join(root, kernelSpec.cwd ?? ".")));
  } else {
    console.error(`[storyharness] 内核已在 :${kernelPort}（复用，${srcK}）`);
  }

  const k = new KernelClient(cfg.kernelBase, root, cfg.corpus);
  startServe(k, cfg, port);
  console.error(`[storyharness] 协议面（pi 单脑 + 生产线）：http://127.0.0.1:${port}`);

  const okKernel = await waitUp(`http://127.0.0.1:${kernelPort}/`, 120_000);
  if (!okKernel) console.error("[storyharness] 警告：内核未就绪——立项/生产线稍后重试");
  // 自动开门目标 = 官方面板静态产物（8431 自托管 /panel/，零 Next 进程）；面板没起再回落协议面落地页。
  // 此前固定开 8431——协议面只有 API 说明页，用户每轮守活重启都收到一个"这个是啥"。
  const panelUrl = `http://127.0.0.1:${port}/panel/`;
  const panelUp = await waitUp(panelUrl, 15_000);
  const url = panelUp ? panelUrl : `http://127.0.0.1:${port}/`;
  console.error(`[storyharness] 就绪：${url}`);
  console.error("[storyharness] 界面 = 官方面板（pi-web fork）；协议细节见 adapter/README.md");
  if (!opts.noOpen) exec(`start "" "${url}"`);

  const cleanup = () => {
    for (const kid of kids) { try { kid.kill(); } catch { /* 忽略 */ } }
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
  await new Promise(() => { /* 常驻——退出走 Ctrl+C（同 serve） */ });
}
