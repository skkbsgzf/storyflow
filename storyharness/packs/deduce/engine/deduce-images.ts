// 推演生图 seam：立绘（portrait，透明底）/ 背景（bg）。
// 后端（包配置 extensions.deduce.image.backend，契约在包 manifest）：
//   comfyui   —— 复用 XHS 工作台 scripts/imagegen.mjs（本机 ComfyUI + FLUX.2 Klein，纯黑底生成后本地去背出透明 PNG）
//   dashscope —— DashScope 文生图异步 API（qwen-image / wanx 系，需 dashscopeKey）
//   off/缺省  —— 显式报缺（页面用占位艺术兜底，不冒充有图）
// 资产落 <project>/推演/assets/{bg|portrait-<name>}.png，经 /api/deduce/asset 白名单供出。
import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";
import type { HarnessConfig } from "../../../src/config.js";
import { currentPackCtx } from "../../../src/packctx.js";
import type { DeduceConfig } from "./deduce.js";
import type { ScriptFile } from "./deduce.js";

export type ImageKind = "bg" | "portrait";

const assetsOf = (cfg: HarnessConfig, project: string) =>
  path.join(currentPackCtx().runtime.projectDir(cfg, project), "推演", "assets");

function buildPrompt(script: ScriptFile, kind: ImageKind, name: string): string {
  const style = script.style ? `视觉风格：${script.style}。` : "";
  if (kind === "portrait") {
    const c = script.characters.find((x) => x.name === name);
    if (!c) throw new Error(`角色不存在：${name}`);
    return `${style}galgame 角色立绘，单人半身像，正面微侧，${c.name}，气质：${c.archetype}，纯黑色背景，主体居中边缘干净便于抠图，高质量插画，细节丰富`;
  }
  return `${style}场景背景插画，无人物，空镜头，${script.premise.slice(0, 80)}，电影感构图，高细节，氛围光`;
}

async function runComfyui(im: NonNullable<DeduceConfig["image"]>, prompt: string, out: string, portrait: boolean): Promise<void> {
  const script = im.comfyuiScript;
  if (!script) throw new Error("生图未配置：extensions.deduce.image.comfyuiScript 缺失（XHS 工作台 scripts/imagegen.mjs 的绝对路径）");
  if (!fs.existsSync(script)) throw new Error(`生图脚本不存在：${script}`);
  const size = portrait ? 768 : 1024;
  const args = [script, "--instruction", prompt, "--out", out, "--size", String(size)];
  await new Promise<void>((resolve, reject) => {
    const p = spawn(im.comfyuiCommand ?? "node", args, { cwd: path.dirname(script), windowsHide: true });
    let outBuf = "", errBuf = "";
    const timer = setTimeout(() => { p.kill(); reject(new Error("生图超时（120s）——检查 ComfyUI（127.0.0.1:8188）是否在线")); }, 120_000);
    p.stdout.on("data", (c) => (outBuf += c));
    p.stderr.on("data", (c) => (errBuf += c));
    p.on("error", (e) => { clearTimeout(timer); reject(new Error(`生图进程起不来：${e.message}`)); });
    p.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0 && fs.existsSync(out)) return resolve();
      let msg = `生图失败（exit ${code}）`;
      try { msg = JSON.parse(outBuf.trim().split("\n").pop() ?? "{}").error ?? msg; } catch { /* 保底消息 */ }
      reject(new Error(`${msg}${errBuf && !outBuf ? "：" + errBuf.slice(0, 160) : ""}`));
    });
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function runDashscope(im: NonNullable<DeduceConfig["image"]>, prompt: string, out: string): Promise<void> {
  const key = im.dashscopeKey || process.env.DASHSCOPE_API_KEY || "";
  if (!key) throw new Error("生图未配置：dashscope 后端需要 extensions.deduce.image.dashscopeKey（或环境变量 DASHSCOPE_API_KEY）");
  const base = (im.dashscopeBase ?? "https://dashscope.aliyuncs.com").replace(/\/$/, "");
  const model = im.dashscopeModel ?? "qwen-image";
  const create = await fetch(`${base}/api/v1/services/aigc/text2image/image-synthesis`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "x-dashscope-async": "enable" },
    body: JSON.stringify({ model, input: { prompt }, parameters: { size: "1024*1024", n: 1 } }),
  });
  const cj: any = await create.json().catch(() => ({}));
  const taskId = cj?.output?.task_id;
  if (!create.ok || !taskId) throw new Error(`DashScope 建任务失败：${create.status} ${JSON.stringify(cj).slice(0, 160)}`);
  for (let i = 0; i < 40; i++) {
    await sleep(3000);
    const poll = await fetch(`${base}/api/v1/tasks/${taskId}`, { headers: { authorization: `Bearer ${key}` } });
    const pj: any = await poll.json().catch(() => ({}));
    const st = pj?.output?.task_status;
    if (st === "SUCCEEDED") {
      const url = pj?.output?.results?.[0]?.url;
      if (!url) throw new Error("DashScope 返回无图 URL");
      const bin = Buffer.from(await (await fetch(url)).arrayBuffer());
      fs.writeFileSync(out, bin);
      return;
    }
    if (st === "FAILED" || st === "CANCELED" || st === "UNKNOWN") throw new Error(`DashScope 任务 ${st}：${JSON.stringify(pj?.output ?? {}).slice(0, 160)}`);
  }
  throw new Error("DashScope 轮询超时（120s）");
}

export async function generateImage(cfg: HarnessConfig, pc: DeduceConfig, project: string, kind: ImageKind, name: string): Promise<{ ok: true; file: string; kind: string; backend: string }> {
  const sFile = path.join(currentPackCtx().runtime.projectDir(cfg, project), "推演", "script.json");
  if (!fs.existsSync(sFile)) throw new Error("项目缺 推演/script.json");
  const script = JSON.parse(fs.readFileSync(sFile, "utf-8")) as ScriptFile;
  const file = kind === "bg" ? "bg.png" : `portrait-${name}.png`;
  const out = path.join(assetsOf(cfg, project), file);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const prompt = buildPrompt(script, kind, name);
  const im = pc.image ?? {};
  const backend = im.backend ?? "off";
  if (backend === "comfyui") await runComfyui(im, prompt, out, kind === "portrait");
  else if (backend === "dashscope") await runDashscope(im, prompt, out);
  else throw new Error("生图未启用：配置 extensions.deduce.image.backend（comfyui | dashscope）");
  return { ok: true, file, kind, backend };
}
