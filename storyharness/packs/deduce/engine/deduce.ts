// 编剧推演引擎（点点点剧情推演）· 2026-09-29 v3/v4 · 2026-09-29 波13 包化：由底座 src/ 迁入 packs/deduce/，
// 经 manifest 三扩展点（pages/apis/config）挂载——新玩法照此形态做包，不再改底座五件套。
// 设计依据：docs/设计探索-编剧推演引擎-20260929.md。三条纪律写死在实现里：
//   1) 打分=建议面：分数只排序标注，作家终裁，永不构成闸（阈值清剿口径 2026-09-24）；
//   2) 引擎无私有账本：每拍现读 <project>/推演/ 下文件，产物即落盘（scene.json 就是盘上真相）；
//   3) 正文纯净：场景草稿只含正文，分数/选项/功能标签只进 clickstream.jsonl 与 scene.json。
// 打分形态：同底座 chat+JSON 批判（4 选项×4 维一次出）；接口形状 = typed decision
//   {decision, confidence, reason}（调研-Jev与SystemOne决策层-20260923 启示#1）。
// composite 加权在代码里算（场景位置→权重），模型只出维度分——证据与裁决分离。
// v2 新增：结构化 stimulus（speaker/line/narration，galgame 对话框用）、导入小说/设定、
//   笔记本、立绘/背景图资产（生图 seam：comfyui(Klein) / dashscope(qwen-image) / 占位）。
import * as fs from "node:fs";
import * as path from "node:path";
import type http from "node:http";
import type { HarnessConfig } from "../../../src/config.js";
import { makeModels, resolveModel, type LlmTarget } from "../../../src/llm.js";
import type { Models, Model } from "@earendil-works/pi-ai";
import { safeProject } from "../../../src/panels.js";
import { currentPackCtx } from "../../../src/packctx.js";
import { generateImage, type ImageKind } from "./deduce-images.js";

/** 包配置命名空间 extensions.deduce 的键形态（契约在包 manifest 的 extensions.config）。 */
export interface DeduceConfig {
  provider?: string; model?: string; apiKey?: string; baseUrl?: string;
  image?: {
    backend?: "comfyui" | "dashscope" | "off";
    comfyuiCommand?: string;
    comfyuiScript?: string;
    dashscopeKey?: string;
    dashscopeBase?: string;
    dashscopeModel?: string;
  };
}

// ── 数据形状 ──────────────────────────────────────────────
export interface Stimulus { speaker?: string; line: string; narration?: string }
export function stimulusText(s: Stimulus): string {
  return `${s.narration ? s.narration + " " : ""}${s.speaker ? s.speaker + "：" : ""}${s.line}`;
}
export function normStimulus(x: unknown): Stimulus {
  if (typeof x === "string") return { line: x };
  const o = (x ?? {}) as Record<string, unknown>;
  return { speaker: o.speaker ? String(o.speaker) : undefined, line: String(o.line ?? ""), narration: o.narration ? String(o.narration) : undefined };
}
export interface DeduceOption {
  id: string;
  kind: "推进" | "回避" | "意外" | "自由"; // 叙事功能四象限（保证选项空间多样性）
  text: string;   // 台词（空串 = 纯动作拍）
  action: string; // 动作描写
  effect: string; // 一句话叙事效果
}
export interface DimScore { p: number; why: string }
export interface OptionScore {
  id: string;
  persona: DimScore;  // 人设一致性（高好）
  drive: DimScore;    // 剧情推动力（高好）
  ooc: DimScore;      // OOC 风险（低好，加权时取反）
  emotion: DimScore;  // 情绪连贯性（高好）
  composite: number;  // 引擎按场景位置加权
}
export interface Probe { question: string; paths: { label: string; desc: string }[] }
export interface BeatRecord {
  n: number;
  stimulus: Stimulus;
  chosen: { text?: string; action?: string; kind?: string; custom?: boolean };
  ts: string;
}
export interface SceneFile {
  format: "deduce-scene@1";
  createdAt: string;
  updatedAt: string;
  beats: BeatRecord[];
  preferences: string[]; // ask_user 采纳的方向注记，喂回生成
  pending: null | {
    stimulus: Stimulus;
    options: DeduceOption[];
    scores: OptionScore[];
    probe: Probe | null;
    ts: string;
  };
}
export interface ScriptFile {
  format: "deduce-script@1";
  title: string;
  premise: string;
  opening: string;
  target_beats: number;
  style?: string; // 视觉风格（生图提示词用，如「古风世家宅门，电影感，冷暖对撞」）
  characters: {
    name: string;
    archetype: string;
    speech_pattern: string;
    vocabulary?: { 常用?: string[]; 禁用?: string[] };
    relationships?: Record<string, { stance: string; 暗线?: string }>;
    current_arc?: string;
    forbidden?: string[];
  }[];
  protagonist: string; // 每拍推演谁的反应
}

// ── 盘上路径（无私有账本：一切状态就是这几个文件 + 一个留档流）──
// 项目落位经底座挂载表解析（workspaceRoot/projects 优先，其次包内 templates/template-<id>）
const dirOf = (cfg: HarnessConfig, project: string) =>
  path.join(currentPackCtx().runtime.projectDir(cfg, project), "推演");
const scriptOf = (cfg: HarnessConfig, p: string) => path.join(dirOf(cfg, p), "script.json");
const sceneOf = (cfg: HarnessConfig, p: string) => path.join(dirOf(cfg, p), "scene.json");
const streamOf = (cfg: HarnessConfig, p: string) => path.join(dirOf(cfg, p), "clickstream.jsonl");
const notesOf = (cfg: HarnessConfig, p: string) => path.join(dirOf(cfg, p), "笔记本.md");
const assetsOf = (cfg: HarnessConfig, p: string) => path.join(dirOf(cfg, p), "assets");

function readJson<T>(file: string, what: string): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as T;
  } catch (e) {
    throw new Error(`${what} 读取失败（${path.basename(file)}）：${(e as Error).message}`);
  }
}
function writeJson(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 1), "utf-8");
}
function freshScene(): SceneFile {
  const now = new Date().toISOString();
  return { format: "deduce-scene@1", createdAt: now, updatedAt: now, beats: [], preferences: [], pending: null };
}
function loadScene(cfg: HarnessConfig, project: string): SceneFile {
  const f = sceneOf(cfg, project);
  if (!fs.existsSync(f)) return freshScene();
  const s = readJson<SceneFile>(f, "推演状态");
  // 兼容 v1 字符串 stimulus
  if (s.pending) s.pending.stimulus = normStimulus(s.pending.stimulus);
  for (const b of s.beats ?? []) b.stimulus = normStimulus(b.stimulus);
  return s;
}
function click(cfg: HarnessConfig, project: string, entry: Record<string, unknown>): void {
  try {
    fs.mkdirSync(path.dirname(streamOf(cfg, project)), { recursive: true });
    fs.appendFileSync(streamOf(cfg, project), JSON.stringify({ ts: new Date().toISOString(), by: "writer.click", ...entry }) + "\n", "utf-8");
  } catch { /* 留档失败不阻塞创作，但下次仍尝试 */ }
}
function listAssets(cfg: HarnessConfig, project: string): { bg: boolean; portraits: Record<string, boolean> } {
  const out = { bg: false, portraits: {} as Record<string, boolean> };
  try {
    for (const f of fs.readdirSync(assetsOf(cfg, project))) {
      if (f === "bg.png") out.bg = true;
      else if (f.startsWith("portrait-") && f.endsWith(".png")) out.portraits[f.slice("portrait-".length, -".png".length)] = true;
    }
  } catch { /* 无 assets 目录 */ }
  return out;
}

// ── LLM（同底座 pi-ai，一次调用出结构化 JSON）──────────────
// 档位：extensions.deduce 命名空间优先（文学判断钉强档），缺省跟随顶层 provider/model。
let cached: { key: string; models: Models; model: Model<never> } | null = null;
export function targetOf(cfg: HarnessConfig, pc?: DeduceConfig): LlmTarget {
  const d = pc ?? {};
  return {
    provider: d.provider ?? cfg.provider,
    model: d.model ?? cfg.model,
    apiKey: d.apiKey ?? cfg.apiKey,
    baseUrl: d.baseUrl ?? cfg.baseUrl,
  };
}
function modelOf(cfg: HarnessConfig, pc?: DeduceConfig) {
  const t = targetOf(cfg, pc);
  const key = JSON.stringify(t);
  if (!cached || cached.key !== key) {
    const models = makeModels(t);
    cached = { key, models, model: resolveModel(models, t) as Model<never> };
  }
  return cached;
}
function textOfMessage(m: { content?: unknown } | undefined): string {
  if (!m || !Array.isArray(m.content)) return "";
  return m.content.map((b: any) => (b?.type === "text" ? String(b.text ?? "") : "")).join("");
}
export async function chat(cfg: HarnessConfig, system: string, user: string, maxTokens = 8192, pc?: DeduceConfig): Promise<string> {
  const t = targetOf(cfg, pc);
  if (!t.apiKey && !t.baseUrl) {
    throw new Error("模型未配置：在 .external/storyharness.json 写 provider/model/apiKey（或设 PI_API_KEY）后再推演");
  }
  const { models, model } = modelOf(cfg, pc);
  const stream = models.streamSimple(
    model,
    { systemPrompt: system, messages: [{ role: "user", content: user }] } as never,
    { maxTokens, timeoutMs: 300_000 } as never,
  );
  let acc = "";
  for await (const ev of stream as never as AsyncIterable<any>) {
    if (ev.type === "text_delta") acc += String(ev.delta ?? "");
    else if (ev.type === "done") { if (!acc.trim()) acc = textOfMessage(ev.message); }
    else if (ev.type === "error") {
      throw new Error(`推演调用失败：${ev.error?.errorMessage || ev.errorMessage || textOfMessage(ev.error) || "provider 错误"}`);
    }
  }
  if (!acc.trim()) throw new Error("推演调用返回空内容（模型/网络问题，可重试）");
  return acc;
}
function extractJson(raw: string): any {
  let s = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  if (a < 0 || b <= a) throw new Error(`模型未返回 JSON：${raw.slice(0, 120)}…`);
  try {
    return JSON.parse(s.slice(a, b + 1));
  } catch {
    throw new Error(`模型返回的 JSON 解析失败：${s.slice(a, a + 160)}…`);
  }
}

// ── 提示词（中文，评分维度用自然语言描述，不依赖行话）───────
const SYSTEM = `你是剧情可能性引擎（编剧推演引擎）。你只做三件事：生成结构化的剧情候选；按给定维度打分；从文本提炼推演剧本。
铁律：
1. 只输出一个 JSON 对象——无 markdown 围栏、无解释、无注释。
2. 台词与动作必须符合角色卡的说话方式与禁用词表。
3. 打分只是证据不是判决：0 到 1 的数 + 一句话理由，理由要引用情境细节。
4. 全程中文。`;

function scriptBrief(script: ScriptFile): string {
  return JSON.stringify({
    标题: script.title, 场景前提: script.premise, 开场: script.opening, 目标拍数: script.target_beats,
    视觉风格: script.style ?? "",
    推演对象: script.protagonist,
    角色卡: script.characters,
  }, null, 1);
}
function beatsBrief(scene: SceneFile): string {
  if (!scene.beats.length) return "（尚无已定拍——本场刚开）";
  return scene.beats.map((b) => `第${b.n}拍 ${stimulusText(b.stimulus)}\n      反应：${b.chosen.custom ? "（作家自写）" : ""}${b.chosen.text ?? ""}${b.chosen.action ? `（${b.chosen.action}）` : ""}`).join("\n");
}
const GEN_INSTRUCTION = (no: number, total: number) => `## 任务（generate · 第${no}拍 / 共约${total}拍）
给出剧情的下一步，stimulus 为结构化对象：
1. stimulus.speaker：说话角色名（对手/旁人；若是纯旁白推进则留空串）。
2. stimulus.line：该角色的一句台词（≤40 字）；若 speaker 为空则 line 是旁白叙述（≤50 字）。
3. stimulus.narration：一小段动作/环境旁白（≤30 字，可为空串）。
   若「已定拍序列」为空：speaker 留空，line 原样使用剧本的「开场」。
4. options：恰 4 个「推演对象」的候选反应，叙事功能必须四象限各一个：推进（冲突升级或信息揭示）、回避（压抑/拖延，张力后移）、意外（低概率但合理的出格反应）、自由（你最有戏的一手）。
   - 每个含 text（台词，≤30 字，可为空串表示纯动作）、action（动作描写 ≤20 字）、effect（一句话叙事效果，≤20 字）。
   - 保守项（回避）也要写得有吸引力，不许凑数陪跑；意外要合理，不为怪而怪。
输出：{"stimulus":{"speaker":"...","line":"...","narration":"..."},"options":[{"kind":"推进","text":"...","action":"...","effect":"..."},{"kind":"回避",...},{"kind":"意外",...},{"kind":"自由",...]}`;
const SCORE_INSTRUCTION = `## 任务（score · 四维打分）
对每个候选按四维打分（p 为 0-1 小数，why 一句话且 ≤25 字，引用情境细节）：
- persona 人设一致性：这个反应是「推演对象」会做的吗？
- drive 剧情推动力：这个反应让故事向前走了吗（升级/揭示/关系变化）？
- ooc OOC 风险：这个反应破坏角色设定的程度（越低越好；彻底符合人设给 0.05 以下）。
- emotion 情绪连贯性：与上一拍（或开场情境）的情绪衔接吗？
另附 probe：仅当你认为两条路线难分高下、值得让作家表态叙事方向时，给 question（一句问作家的方向问题）+ paths（两条 {label, desc}，desc ≤20 字）；否则 probe=null。
输出：{"scores":[{"id":"opt-1","persona":{"p":0.9,"why":"..."},"drive":{...},"ooc":{...},"emotion":{...}},...4个],"probe":null|"{"question":"...","paths":[...]}"}`;
const IMPORT_INSTRUCTION = (mode: "novel" | "settings", total: number) => `## 任务（import · ${mode === "novel" ? "从小说文本提炼" : "从设定创建"}）
${mode === "novel"
    ? "从给定文本中挑一个冲突最鲜明的场景，提炼成一场可推演的戏（不要照抄大段原文，做戏剧化提纯）。"
    : "基于给定设定，从零创建一个开场即有张力的冲突场景剧本。"}
输出一个完整推演剧本 JSON：
{"format":"deduce-script@1","title":"第X章 · 场景名","premise":"场景前提：时间/地点/在场人物/各自目标与张力（≤120字）","opening":"开场刺激：一段具体的动作/台词描写（≤80字，具体到能直接开演）","target_beats":${total},"style":"视觉风格一句话（时代感+画面质感，供生图用）","protagonist":"推演对象（读者代入的主角）","characters":[{"name":"...","archetype":"...","speech_pattern":"说话方式一句话","vocabulary":{"常用":["..."],"禁用":["..."]},"relationships":{"某角色":{"stance":"表面态度","暗线":"隐藏动机"}},"current_arc":"本场内的弧线","forbidden":["绝不做的事"]},...3-4人]}
要求：characters 恰 3-4 人且必含 protagonist；opening 必须具体可演（有动作有台词），不许是背景介绍。`;

// composite：场景位置加权（早期重推动、后段重情绪，OOC 取反计惩罚）——数值是排序启发式，不是闸
function compositeOf(s: OptionScore, pos: number): number {
  const wDrive = pos < 0.4 ? 2 : 1;
  const wEmotion = pos >= 0.65 ? 2 : 1;
  const v = s.persona.p * 1 + s.drive.p * wDrive + (1 - s.ooc.p) * 1.2 + s.emotion.p * wEmotion;
  return Math.round((v / (1 + wDrive + 1.2 + wEmotion)) * 100) / 100;
}
const num = (x: unknown, d = 0.5) => {
  const n = Number(x);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : d;
};

// ── 拍循环动作 ────────────────────────────────────────────
async function deduceNext(cfg: HarnessConfig, project: string, pc: DeduceConfig) {
  if (!safeProject(project)) throw new Error(`project 非法：${project}`);
  const sFile = scriptOf(cfg, project);
  if (!fs.existsSync(sFile)) {
    throw new Error(`NO_SCRIPT|项目缺 推演/script.json（用「新建/导入」从小说或设定生成，或用官方模板 packs/deduce/templates/template-推演）`);
  }
  const script = readJson<ScriptFile>(sFile, "剧本");
  const scene = loadScene(cfg, project);
  if (scene.pending) return { ...publicState(script, scene), note: "已有待选拍（先采纳或换一批）" };

  const no = scene.beats.length + 1;
  const pos = scene.beats.length / Math.max(1, script.target_beats);
  const pref = scene.preferences.length ? `## 作家偏好注记（追问中的表态）\n${scene.preferences.map((p, i) => `${i + 1}. ${p}`).join("\n")}\n` : "";

  // Step 1 生成（结构化 stimulus + 四象限候选）；zai 推理模型的 max_tokens 含思维链——8192 防 JSON 截断
  const gen = extractJson(await chat(
    cfg, SYSTEM,
    `## 剧本\n${scriptBrief(script)}\n${pref}## 已定拍序列\n${beatsBrief(scene)}\n\n${GEN_INSTRUCTION(no, script.target_beats)}`,
    8192,
    pc,
  ));
  const rawOpts: any[] = Array.isArray(gen.options) ? gen.options : [];
  if (rawOpts.length < 2) throw new Error("生成候选不足 2 个（模型输出异常，可重试）");
  const options: DeduceOption[] = rawOpts.slice(0, 4).map((o, i) => ({
    id: `opt-${i + 1}`,
    kind: (["推进", "回避", "意外", "自由"] as const).includes(o.kind) ? o.kind : "自由",
    text: String(o.text ?? "").slice(0, 60),
    action: String(o.action ?? "").slice(0, 40),
    effect: String(o.effect ?? "").slice(0, 60),
  }));
  const first = no === 1;
  const gs = gen.stimulus ?? {};
  const stimulus: Stimulus = first
    ? { line: String(script.opening || gs.line || "") }
    : normStimulus({ speaker: String(gs.speaker ?? "") || undefined, line: String(gs.line ?? ""), narration: String(gs.narration ?? "") || undefined });
  if (!stimulus.line.trim()) throw new Error("模型未返回 stimulus.line（输出异常，可重试）");

  // Step 2 打分（chat+JSON 批判，一次出 4×4）
  let scores: OptionScore[] = [];
  let probe: Probe | null = null;
  let degraded: string | null = null;
  try {
    const sc = extractJson(await chat(
      cfg, SYSTEM,
      `## 剧本（角色卡）\n${scriptBrief(script)}\n${pref}## 此刻情境（第${no}拍刺激）\n${stimulusText(stimulus)}\n\n## 候选反应\n${options.map((o) => `${o.id}［${o.kind}］${o.text ? `台词：${o.text}　` : ""}动作：${o.action}`).join("\n")}\n\n${SCORE_INSTRUCTION}`,
      8192,
      pc,
    ));
    const byId = new Map<string, any>((Array.isArray(sc.scores) ? sc.scores : []).map((x: any) => [String(x?.id ?? ""), x]));
    scores = options.map((o) => {
      const x = byId.get(o.id) ?? {};
      const os: OptionScore = {
        id: o.id,
        persona: { p: num(x.persona?.p), why: String(x.persona?.why ?? "").slice(0, 80) },
        drive: { p: num(x.drive?.p), why: String(x.drive?.why ?? "").slice(0, 80) },
        ooc: { p: num(x.ooc?.p, 0.2), why: String(x.ooc?.why ?? "").slice(0, 80) },
        emotion: { p: num(x.emotion?.p), why: String(x.emotion?.why ?? "").slice(0, 80) },
        composite: 0,
      };
      os.composite = compositeOf(os, pos);
      return os;
    });
    if (sc.probe && typeof sc.probe.question === "string" && Array.isArray(sc.probe.paths)) {
      probe = {
        question: String(sc.probe.question).slice(0, 120),
        paths: sc.probe.paths.slice(0, 2).map((p: any) => ({ label: String(p?.label ?? "").slice(0, 24), desc: String(p?.desc ?? "").slice(0, 60) })),
      };
    }
  } catch (e) {
    // 打分失败不阻塞生成：候选照出（无分也要能选），报错随状态回显——显式失败，不冒充有分
    degraded = `打分步骤失败，本拍无分可选：${(e as Error).message.slice(0, 120)}`;
    scores = options.map((o) => ({ id: o.id, persona: { p: 0.5, why: "" }, drive: { p: 0.5, why: "" }, ooc: { p: 0.2, why: "" }, emotion: { p: 0.5, why: "" }, composite: 0.5 }));
  }

  scene.pending = { stimulus, options, scores, probe, ts: new Date().toISOString() };
  scene.updatedAt = scene.pending.ts;
  writeJson(sceneOf(cfg, project), scene);
  const st = publicState(script, scene) as Record<string, unknown>;
  if (degraded) st.degraded = degraded;
  return st;
}

function publicState(script: ScriptFile, scene: SceneFile) {
  const ranked = scene.pending
    ? [...scene.pending.options]
        .map((o) => ({ ...o, score: scene.pending!.scores.find((s) => s.id === o.id) ?? null }))
        .sort((a, b) => (b.score?.composite ?? 0) - (a.score?.composite ?? 0))
    : [];
  const top = ranked.map((r) => r.score?.composite ?? 0);
  const gapClose = ranked.length >= 2 && top[0] - top[1] < 0.15;
  return {
    title: script.title,
    premise: script.premise,
    style: script.style ?? "",
    protagonist: script.protagonist,
    characters: script.characters,
    targetBeats: script.target_beats,
    beats: scene.beats,
    pending: scene.pending ? { ...scene.pending, stimulus: scene.pending.stimulus, options: ranked } : null,
    ask: scene.pending?.probe && gapClose ? scene.pending.probe : null, // 分数接近 + 模型有探针 = 追问呈现
    gapClose,
    preferences: scene.preferences,
  };
}

function chooseBeat(cfg: HarnessConfig, project: string, body: { id?: string; index?: number; custom?: string }) {
  if (!safeProject(project)) throw new Error(`project 非法：${project}`);
  const script = readJson<ScriptFile>(scriptOf(cfg, project), "剧本");
  const scene = loadScene(cfg, project);
  if (!scene.pending) throw new Error("没有待选拍（先「推演下一拍」）");
  const chosen: BeatRecord["chosen"] = {};
  let chosenId = "custom";
  if (body.custom && body.custom.trim()) {
    chosen.custom = true;
    chosen.text = body.custom.trim().slice(0, 120);
  } else {
    // 页面按 composite 重排展示，提交一律带 id（存储序 index 仅作兜底）
    const opt = body.id
      ? scene.pending.options.find((o) => o.id === body.id)
      : scene.pending.options[Number(body.index)];
    if (!opt) throw new Error(`候选不存在：${body.id ?? body.index}（共 ${scene.pending.options.length} 个）`);
    chosenId = opt.id;
    chosen.text = opt.text;
    chosen.action = opt.action;
    chosen.kind = opt.kind;
  }
  const beat: BeatRecord = {
    n: scene.beats.length + 1,
    stimulus: scene.pending.stimulus,
    chosen,
    ts: new Date().toISOString(),
  };
  click(cfg, project, {
    kind: chosen.custom ? "custom" : "choose",
    beat: beat.n,
    evidence: {
      stimulus: stimulusText(scene.pending.stimulus),
      options: scene.pending.options.map((o) => ({ id: o.id, kind: o.kind, composite: scene.pending!.scores.find((s) => s.id === o.id)?.composite ?? null })),
    },
    chosen: chosenId,
    rejected: scene.pending.options.map((o) => o.id).filter((id) => id !== chosenId),
  });
  scene.beats.push(beat);
  scene.pending = null;
  scene.updatedAt = beat.ts;
  writeJson(sceneOf(cfg, project), scene);
  return { ok: true, beats: scene.beats.length };
}

function rollbackBeat(cfg: HarnessConfig, project: string) {
  if (!safeProject(project)) throw new Error(`project 非法：${project}`);
  const scene = loadScene(cfg, project);
  if (scene.pending) {
    // 待选态回退 = 弃掉本轮候选重推（丢弃分支入留档）
    click(cfg, project, { kind: "reroll", beat: scene.beats.length + 1, evidence: { discarded: scene.pending.options.map((o) => o.id) } });
    scene.pending = null;
  } else if (scene.beats.length) {
    const last = scene.beats[scene.beats.length - 1];
    click(cfg, project, { kind: "rollback", beat: last.n, evidence: { removed: last.chosen.kind ?? "custom", beatsAfter: scene.beats.length - 1 }, rejected: [last.chosen.kind ?? "custom"] });
    scene.beats.pop();
  } else {
    throw new Error("已在场首，无可回退");
  }
  scene.updatedAt = new Date().toISOString();
  writeJson(sceneOf(cfg, project), scene);
  return { ok: true };
}

function answerProbe(cfg: HarnessConfig, project: string, pick: number) {
  if (!safeProject(project)) throw new Error(`project 非法：${project}`);
  const scene = loadScene(cfg, project);
  const probe = scene.pending?.probe;
  if (!probe) throw new Error("当前没有待答追问");
  const path = probe.paths[Number(pick)];
  if (!path) throw new Error(`pick 越界：${pick}`);
  scene.preferences.push(`追问「${probe.question}」→ 选 ${path.label}（${path.desc}）`);
  click(cfg, project, { kind: "ask_answer", beat: scene.beats.length + 1, chosen: path.label, evidence: { question: probe.question, paths: probe.paths.map((p) => p.label) } });
  if (scene.pending) scene.pending.probe = null;
  scene.updatedAt = new Date().toISOString();
  writeJson(sceneOf(cfg, project), scene);
  return { ok: true };
}

async function assembleDraft(cfg: HarnessConfig, project: string, pc: DeduceConfig) {
  if (!safeProject(project)) throw new Error(`project 非法：${project}`);
  const script = readJson<ScriptFile>(scriptOf(cfg, project), "剧本");
  const scene = loadScene(cfg, project);
  if (scene.beats.length < 2) throw new Error("拍数不足（至少定 2 拍再收尾成稿）");
  const text = await chat(
    cfg,
    `你是编剧。把给定的拍序列串成一场戏的正文。铁律：1) 只输出正文本身——无标题、无拍号、无任何元信息或解释；2) 台词用「角色名：台词」行，动作与环境用叙述段；3) 忠实于每拍已定的刺激与反应，可补衔接细节但不得改写已定台词的意图；4) 全程中文。`,
    `## 剧本前提\n${script.premise}\n\n## 拍序列\n${beatsBrief(scene)}\n\n串成正文（约 ${scene.beats.length * 60} 字上下）。`,
    8192,
    pc,
  );
  const draftPath = path.join(dirOf(cfg, project), "场景草稿.md");
  fs.mkdirSync(path.dirname(draftPath), { recursive: true });
  fs.writeFileSync(draftPath, text.trim() + "\n", "utf-8");
  click(cfg, project, { kind: "draft", beat: scene.beats.length, evidence: { file: "推演/场景草稿.md", chars: text.trim().length } });
  return { ok: true, text: text.trim(), file: "推演/场景草稿.md" };
}

function resetScene(cfg: HarnessConfig, project: string) {
  if (!safeProject(project)) throw new Error(`project 非法：${project}`);
  const f = sceneOf(cfg, project);
  let archived = false;
  if (fs.existsSync(f)) {
    const runs = path.join(dirOf(cfg, project), "runs");
    fs.mkdirSync(runs, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
    fs.renameSync(f, path.join(runs, `scene-${stamp}.json`));
    archived = true;
  }
  click(cfg, project, { kind: "reset", evidence: { archived } });
  return { ok: true };
}

// ── v2：导入（小说/设定 → script.json）───────────────────
async function importScript(cfg: HarnessConfig, project: string, body: { mode?: string; text?: string; target_beats?: number }, pc: DeduceConfig) {
  if (!safeProject(project)) throw new Error(`project 非法：${project}`);
  const mode = body.mode === "settings" ? "settings" : "novel";
  const text = String(body.text ?? "").trim();
  if (text.length < 50) throw new Error(mode === "novel" ? "文本太短（至少粘贴 50 字，最好含一段冲突戏）" : "设定太短（至少 50 字）");
  const total = Math.min(20, Math.max(4, Number(body.target_beats) || 10));
  const raw = extractJson(await chat(
    cfg, SYSTEM,
    `## 给定文本\n${text.slice(0, 6000)}\n\n${IMPORT_INSTRUCTION(mode as "novel" | "settings", total)}`,
    8192,
    pc,
  ));
  const chars: any[] = Array.isArray(raw.characters) ? raw.characters : [];
  if (chars.length < 2) throw new Error("提炼失败：角色不足 2 人（换一段含对话冲突的文本重试）");
  const names = chars.map((c) => String(c.name ?? ""));
  const protagonist = String(raw.protagonist ?? "") || names[0];
  if (!names.includes(protagonist)) throw new Error(`提炼失败：protagonist（${protagonist}）不在角色列表`);
  const script: ScriptFile = {
    format: "deduce-script@1",
    title: String(raw.title ?? "第一章 · 无题场景").slice(0, 40),
    premise: String(raw.premise ?? "").slice(0, 300),
    opening: String(raw.opening ?? "").slice(0, 200),
    target_beats: Math.min(20, Math.max(4, Number(raw.target_beats) || total)),
    style: String(raw.style ?? "").slice(0, 60) || undefined,
    protagonist,
    characters: chars.slice(0, 5).map((c) => ({
      name: String(c.name ?? "").slice(0, 20),
      archetype: String(c.archetype ?? "").slice(0, 24),
      speech_pattern: String(c.speech_pattern ?? "").slice(0, 60),
      vocabulary: { 常用: (c.vocabulary?.常用 ?? []).slice(0, 4).map(String), 禁用: (c.vocabulary?.禁用 ?? []).slice(0, 4).map(String) },
      relationships: c.relationships ?? {},
      current_arc: String(c.current_arc ?? "").slice(0, 60),
      forbidden: (c.forbidden ?? []).slice(0, 3).map(String),
    })),
  };
  if (!script.opening.trim() || !script.premise.trim()) throw new Error("提炼失败：premise/opening 缺失（重试）");
  // 旧剧本归档，落新剧本，推演状态清零
  const sFile = scriptOf(cfg, project);
  fs.mkdirSync(path.dirname(sFile), { recursive: true });
  if (fs.existsSync(sFile)) {
    const runs = path.join(dirOf(cfg, project), "runs");
    fs.mkdirSync(runs, { recursive: true });
    fs.copyFileSync(sFile, path.join(runs, `script-${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}.json`));
  }
  writeJson(sFile, script);
  const hadScene = fs.existsSync(sceneOf(cfg, project));
  resetScene(cfg, project);
  click(cfg, project, { kind: "import", evidence: { mode, chars: script.characters.length, replacedScript: fs.existsSync(sFile) && hadScene } });
  return { ok: true, script: publicState(script, freshScene()) };
}

// ── v2：笔记本 ───────────────────────────────────────────
function readNotes(cfg: HarnessConfig, project: string): string {
  try { return fs.readFileSync(notesOf(cfg, project), "utf-8"); } catch { return ""; }
}
function saveNotes(cfg: HarnessConfig, project: string, text: string): { ok: true } {
  if (!safeProject(project)) throw new Error(`project 非法：${project}`);
  fs.mkdirSync(path.dirname(notesOf(cfg, project)), { recursive: true });
  fs.writeFileSync(notesOf(cfg, project), String(text ?? "").slice(0, 20000), "utf-8");
  return { ok: true };
}

// ── HTTP 面（先算后写；所有错误走 JSON 显式报错）────────────
const busyNext = new Set<string>();
const busyImg = new Set<string>();
export async function handleDeduceApi(
  res: http.ServerResponse,
  cfg: HarnessConfig,
  url: string,
  method: string,
  body: string,
  prefixLen: number,
  pc: DeduceConfig,
): Promise<void> {
  const q = new URLSearchParams(url.split("?")[1] ?? "");
  // 动作段 = 去挂载前缀（prefixLen 由底座挂载表给出，包不再自描前缀）
  const action = url.slice(prefixLen).split("?")[0];
  // project：query 优先，POST 兜底从 body 取（页面 POST 只带 body）
  let project = q.get("project") ?? "";
  let b: Record<string, unknown> = {};
  if (method === "POST" && body) {
    try { b = JSON.parse(body) as Record<string, unknown>; } catch { /* 空/坏 body：按缺省走 */ }
    if (!project && typeof b.project === "string") project = b.project;
  }
  const json = (status: number, payload: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(payload));
  };
  try {
    // S5 · 写面（POST）先落地：模板项目被推演写脏＝污染包内容物（demo 留档进包即此病灶）
    if (method === "POST" && safeProject(project)) currentPackCtx().runtime.materialize(cfg, project);
    if (!project) return json(400, { error: "project 必填（?project=<id>）" });
    if (action === "state" && method === "GET") {
      if (!safeProject(project)) return json(400, { error: `project 非法：${project}` });
      const sFile = scriptOf(cfg, project);
      if (!fs.existsSync(sFile)) {
        return json(404, { error: "NO_SCRIPT", note: "项目缺 推演/script.json（用「新建/导入」生成）", model: `${targetOf(cfg, pc).provider}/${targetOf(cfg, pc).model}`, notes: readNotes(cfg, project), assets: listAssets(cfg, project) });
      }
      const t = targetOf(cfg, pc);
      return json(200, {
        model: `${t.provider}/${t.model}`,
        notes: readNotes(cfg, project),
        assets: listAssets(cfg, project),
        imageBackend: pc.image?.backend ?? "off",
        ...publicState(readJson<ScriptFile>(sFile, "剧本"), loadScene(cfg, project)),
      });
    }
    if (action === "next" && method === "POST") {
      const key = project;
      if (busyNext.has(key)) return json(409, { error: "上一拍仍在推演中" });
      busyNext.add(key);
      try {
        return json(200, await deduceNext(cfg, project, pc));
      } finally {
        busyNext.delete(key);
      }
    }
    if (action === "asset" && method === "GET") {
      // 立绘/背景二进制：白名单单段文件名（含 CJK 角色名），只准出自 推演/assets/
      const file = q.get("file") ?? "";
      if (!/^[\p{L}\p{N}_-]+\.png$/u.test(file)) return json(400, { error: `file 非法：${file}` });
      const f = path.join(assetsOf(cfg, project), file);
      if (!fs.existsSync(f)) return json(404, { error: "NO_ASSET" });
      res.writeHead(200, { "content-type": "image/png", "cache-control": "no-store" });
      res.end(fs.readFileSync(f));
      return;
    }
    if (action === "image" && method === "POST") {
      const kind = String(b.kind ?? "") as ImageKind;
      if (kind !== "bg" && kind !== "portrait") return json(400, { error: `kind 非法：${kind}（bg|portrait）` });
      const name = kind === "portrait" ? String(b.name ?? "").slice(0, 20) : "";
      if (kind === "portrait" && !/^[\p{L}\p{N}_-]+$/u.test(name)) return json(400, { error: "portrait 需要 name" });
      const key = `${project}:${kind}:${name}`;
      if (busyImg.has(key)) return json(409, { error: "同一路生图正在进行" });
      busyImg.add(key);
      try {
        const r = await generateImage(cfg, pc, project, kind, name);
        return json(200, r);
      } finally {
        busyImg.delete(key);
      }
    }
    if (action === "import" && method === "POST") return json(200, await importScript(cfg, project, { mode: b.mode as string, text: b.text as string, target_beats: b.target_beats as number }, pc));
    if (action === "notes" && method === "POST") return json(200, saveNotes(cfg, project, String(b.text ?? "")));
    if (action === "choose" && method === "POST") return json(200, chooseBeat(cfg, project, { id: b.id as string, index: b.index as number, custom: b.custom as string }));
    if (action === "rollback" && method === "POST") return json(200, rollbackBeat(cfg, project));
    if (action === "probe" && method === "POST") return json(200, answerProbe(cfg, project, Number(b.pick)));
    if (action === "draft" && method === "POST") return json(200, await assembleDraft(cfg, project, pc));
    if (action === "reset" && method === "POST") return json(200, resetScene(cfg, project));
    return json(404, { error: `未知动作：${action}` });
  } catch (e) {
    return json(502, { error: (e as Error).message.slice(0, 300) });
  }
}
