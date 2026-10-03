// 推演生图 seam：立绘（portrait，透明底）/ 背景（bg）。
// 后端（包配置 extensions.deduce.image.backend，契约在包 manifest）：
//   comfyui   —— 本机 ComfyUI 直连 API（qwen_image_2.1 漫画风工作流，实测 A4500 单图 ~175s；立绘纯黑底配前端 screen 混合）
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
  const style = script.style ? `${script.style}，` : "漫画风格，赛璐璐分色上色，清晰墨线，";
  if (kind === "portrait") {
    const c = script.characters.find((x) => x.name === name);
    if (!c) throw new Error(`角色不存在：${name}`);
    return `${style}漫画风格角色立绘，单人半身像，正面微侧，${c.name}，气质：${c.archetype}，${c.speech_pattern ? `神态：${c.speech_pattern}，` : ""}纯黑色背景，主体居中边缘干净，高质量漫画插画，细节丰富`;
  }
  return `${style}漫画风格场景背景插画，无人物，空镜头，${script.premise.slice(0, 80)}，电影感构图，氛围光，高细节`;
}

async function runComfyui(im: NonNullable<DeduceConfig["image"]>, prompt: string, out: string, portrait: boolean): Promise<void> {
  const base = (im.comfyuiBase ?? "http://127.0.0.1:8188").replace(/\/$/, "");
  const width = portrait ? 768 : 1216;
  const height = portrait ? 1024 : 704;
  const seed = Math.floor(Math.random() * 2 ** 31);
  const graph: Record<string, unknown> = {
    "1": { class_type: "UNETLoader", inputs: { unet_name: im.comfyuiUnet ?? "qwen_image_2.1_int8_convrot.safetensors", weight_dtype: "default" } },
    "2": { class_type: "CLIPLoader", inputs: { clip_name: im.comfyuiClip ?? "qwen3vl_8b_int8_convrot.safetensors", type: "qwen_image" } },
    "3": { class_type: "VAELoader", inputs: { vae_name: im.comfyuiVae ?? "qwen_image_2.1_vae_bf16.safetensors" } },
    "4": { class_type: "CLIPTextEncode", inputs: { text: prompt, clip: ["2", 0] } },
    "5": { class_type: "CLIPTextEncode", inputs: { text: "低画质，模糊，多人，文字，水印，畸形", clip: ["2", 0] } },
    "6": { class_type: "ModelSamplingAuraFlow", inputs: { model: ["1", 0], shift: 1.0 } },
    "7": { class_type: "EmptySD3LatentImage", inputs: { width, height, batch_size: 1 } },
    "8": { class_type: "KSampler", inputs: { model: ["6", 0], positive: ["4", 0], negative: ["5", 0], latent_image: ["7", 0], seed, steps: 20, cfg: 2.5, sampler_name: "euler", scheduler: "simple", denoise: 1.0 } },
    "9": { class_type: "VAEDecode", inputs: { samples: ["8", 0], vae: ["3", 0] } },
    "10": { class_type: "SaveImage", inputs: { images: ["9", 0], filename_prefix: "deduce-gen" } },
  };
  const post = async (path: string, body: unknown, timeoutMs = 600000): Promise<any> => {
    const r = await fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
    return r.json();
  };
  let pid = "";
  try {
    const r = await post("/prompt", { prompt: graph, client: "storyharness-deduce" });
    pid = String(r.prompt_id ?? "");
    if (!pid) throw new Error(`ComfyUI 拒绝工作流：${JSON.stringify(r).slice(0, 200)}`);
  } catch (e) {
    throw new Error(`生图未就绪：连不上 ComfyUI（${base}）——python start-comfyui.py。原因：${(e as Error).message.slice(0, 120)}`);
  }
  const t0 = Date.now();
  while (Date.now() - t0 < 20 * 60_000) {
    await new Promise((r) => setTimeout(r, 8000));
    let h: any = {};
    try {
      h = await (await fetch(`${base}/history/${pid}`, { signal: AbortSignal.timeout(30000) })).json();
    } catch { continue; }
    const entry = h[pid];
    if (!entry) continue;
    const st = entry.status ?? {};
    if (st.status_str === "error") throw new Error(`ComfyUI 执行出错：${JSON.stringify((st.messages ?? []).slice(-1)).slice(0, 200)}`);
    if (st.status_str !== "success") continue;
    for (const o of Object.values(entry.outputs ?? {})) {
      for (const img of (o as any).images ?? []) {
        const view = `${base}/view?filename=${encodeURIComponent(img.filename)}&type=${encodeURIComponent(img.type ?? "output")}`;
        const bin = Buffer.from(await (await fetch(view)).arrayBuffer());
        fs.writeFileSync(out, bin);
        return;
      }
    }
    throw new Error("ComfyUI 执行成功但无图输出");
  }
  throw new Error("生图超时（20 分钟）——首次运行需加载 20GB 权重，属正常；重试一次即命中缓存");
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
