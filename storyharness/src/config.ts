// StoryHarness 底座 · 配置层。
// 关键设计：底座不假设自己住在哪个语料仓里——工作区根 + 语料布局全部经「注入」得到。
//   · workspaceRoot 解析顺序：STORYHARNESS_WORKSPACE 环境变量 > 包上一级（向后兼容旧布局）
//   · 语料清单 <workspaceRoot>/.storyharness.json 声明目录布局与语料侧工具命令（剥离点）
//   · 运行配置（provider/model/key/project）：<workspaceRoot>/.external/storyharness.json（旧名 harness-pi.json 兼容读）
//   · 协议面守护（B1）：SH_HOSTNAME / SH_PASSWORD / SH_TOKEN_TTL_HOURS / SH_ALLOWED_ORIGINS 或配置 serve 段；
//     口令缺省不设=不鉴权（只允许绑 loopback），对外绑定自动生成口令写 <workspace>/.external/credentials.json
// 底座代码里不再出现「projects/内部/收据/tools/flow-lint.py」这些 v4 专属路径——它们来自语料清单，缺省时回落到 v4 布局。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generatePassword, isLoopbackHost } from "./auth.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** 包目录 = src/ 的上一级 */
export const PKG_ROOT = path.resolve(HERE, "..");

/** 语料布局：底座对语料仓的唯一认知，全部可由 <workspace>/.storyharness.json 覆盖。 */
export interface CorpusLayout {
  /** 项目数据根（相对 workspaceRoot），默认 projects */
  projectsDir: string;
  /** 交卷收据目录（相对项目根） */
  receiptsDir: string;
  /** 派发清盘备份目录（相对项目根） */
  quarantineDir: string;
  /** 会话 JSONL 目录（相对项目根）——执行器/交互对话共用一套落盘 */
  sessionsDir: string;
  /** 运行遥测目录（相对项目根）——每次 run 收口落一份 run-<ts>.json 汇总 */
  telemetryDir: string;
  /** 语料侧 lint 工具（相对 workspaceRoot，如 tools/flow-lint.py） */
  lintTool: string;
  /** lint 执行命令，默认 python */
  lintCommand: string;
}

const V4_CORPUS: CorpusLayout = {
  projectsDir: "projects",
  receiptsDir: path.join("内部", "收据"),
  quarantineDir: path.join("内部", "storyharness", "backup"),
  sessionsDir: path.join("内部", "sessions"),
  telemetryDir: path.join("内部", "telemetry"),
  lintTool: path.join("tools", "flow-lint.py"),
  lintCommand: "python",
};

/** 工作区根：底座所服务的语料仓。env 注入优先，回退包上一级（旧 harness-pi 布局）。 */
export function resolveWorkspaceRoot(explicit?: string): string {
  return path.resolve(explicit || process.env.STORYHARNESS_WORKSPACE || path.resolve(PKG_ROOT, ".."));
}

/** 读语料清单：<workspaceRoot>/.storyharness.json 的 corpus 段，缺省回落 v4 布局。 */
function loadCorpus(workspaceRoot: string): { corpus: CorpusLayout; corpusName: string; manifestKernelBase?: string } {
  const manifestPath = process.env.STORYHARNESS_MANIFEST || path.join(workspaceRoot, ".storyharness.json");
  try {
    const m = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as {
      corpus?: Partial<CorpusLayout> & { name?: string };
      kernel?: { base?: string };
    };
    return {
      corpus: { ...V4_CORPUS, ...(m.corpus || {}) },
      corpusName: m.corpus?.name || path.basename(workspaceRoot),
      manifestKernelBase: m.kernel?.base,
    };
  } catch {
    return { corpus: V4_CORPUS, corpusName: path.basename(workspaceRoot) };
  }
}

export interface TierTarget { provider: string; model: string; apiKey?: string; baseUrl?: string }

/** 协议面（8431）守护配置 · 工单 WO-B1。缺省 = 绑 127.0.0.1 且不鉴权（本机开发形态零改变）。 */
export interface ServeConfig {
  /** 监听地址：env SH_HOSTNAME / 运行配置 serve.hostname / --hostname 覆盖，缺省 127.0.0.1 */
  hostname: string;
  /** 访问口令；undefined = 不启用鉴权（此时 hostname 必须是 loopback，否则 serve 起不来） */
  password?: string;
  /** 口令来源回显（免「哪来的密码」考古）：env=SH_PASSWORD，file=运行配置 serve.password，generated=自动生成 */
  passwordSource?: "env" | "file" | "generated";
  /** token 有效期（小时），缺省 72 */
  tokenTtlHours: number;
  /** CORS 追加白名单（精确源串匹配；loopback 源始终放行，8420/8421 作业台页靠它） */
  allowedOrigins: string[];
  /** generated 口令的落盘位置：<workspace>/.external/credentials.json */
  credentialsFile: string;
}

/** 自动生成口令的落盘读回：重启不换密码（磁盘真相 > 进程记忆）。 */
function readCredentials(file: string): string | undefined {
  try {
    const c = JSON.parse(fs.readFileSync(file, "utf-8")) as { password?: string };
    return c.password || undefined;
  } catch { return undefined; }
}

/** B1 · serve 面解析：env > 运行配置 serve 段 > 已生成的 credentials > 缺省。
 *  fail-closed：绑定非 loopback 而三处都没口令 → 生成强口令写 credentials 文件，绝不无口令对外敞开。 */
function loadServe(workspaceRoot: string, file: Record<string, unknown>, override?: Partial<ServeConfig>): ServeConfig {
  const s = (file.serve ?? {}) as Partial<ServeConfig>;
  const hostname = override?.hostname || process.env.SH_HOSTNAME || s.hostname || "127.0.0.1";
  const credentialsFile = path.join(workspaceRoot, ".external", "credentials.json");
  const allowedOrigins = [
    ...(process.env.SH_ALLOWED_ORIGINS ?? "").split(",").map((x) => x.trim()).filter(Boolean),
    ...(s.allowedOrigins ?? []),
  ];
  const tokenTtlHours = Number(process.env.SH_TOKEN_TTL_HOURS) || s.tokenTtlHours || 72;
  let password = process.env.SH_PASSWORD || s.password || readCredentials(credentialsFile);
  let passwordSource: ServeConfig["passwordSource"] = password
    ? (process.env.SH_PASSWORD ? "env" : s.password ? "file" : "generated")
    : undefined;
  if (!password && !isLoopbackHost(hostname)) {
    password = generatePassword();
    passwordSource = "generated";
    try {
      fs.mkdirSync(path.dirname(credentialsFile), { recursive: true });
      fs.writeFileSync(credentialsFile, JSON.stringify({
        $comment: "StoryHarness 协议面访问口令（对外绑定自动生成，见 WO-B1）。删掉本文件即换口令；设 SH_PASSWORD 或在 .external/storyharness.json 写 serve.password 可覆盖。",
        password, generatedAt: new Date().toISOString(), hostname,
      }, null, 1) + "\n", "utf-8");
    } catch { /* 写不进去也要带着口令启动，口令在 stderr 日志里 */ }
  }
  return { hostname, password, passwordSource, tokenTtlHours, allowedOrigins, credentialsFile };
}

export interface HarnessConfig {
  /** 底座版本（发版号，来自 VERSION / package.json） */
  harnessVersion: string;
  /** 工作区根（语料仓绝对路径） */
  workspaceRoot: string;
  /** 语料仓名（清单声明） */
  corpusName: string;
  /** 语料布局（注入点） */
  corpus: CorpusLayout;
  /** 协议面守护配置（B1：绑定地址 + 访问口令 + CORS 白名单） */
  serve: ServeConfig;
  kernelBase: string;
  project: string;
  provider: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  maxParallel: number;
  /** thinking 合理性旋钮（用户口径 2026-09-24）：off/low/medium/high → 推理 token 预算档 */
  thinking: "off" | "low" | "medium" | "high";
  /** per-op 档位表（Q2）：按任务包 model_tier 自动选模型；缺省全走顶层 provider/model */
  tiers?: Partial<Record<"default" | "high" | "lite", TierTarget>>;
  /** C7 · 成本价率表（USD / 1M tokens）——数字谁签谁负责，这是运营配置不是代码：
   *  键 = `provider/model` 或裸 model id；供应商 usage 行没回报 cost 时按此估算，
   *  未命中/未配置照旧「查无」（面板不许报 $0 冒充）。cacheRead 不填 = 缓存读不计价。 */
  pricing?: Record<string, { input: number; output: number; cacheRead?: number }>;
  /** 快判官（laya 学生）证据位：enabled 缺省 false。纪律：输出仅复核优先级证据，
   *  不当闸、不触发打回；只进 会话流/收据/遥测（P 值纪律 + 阈值清剿口径）。 */
  judge?: import("./judge.js").JudgeConfig & { feedback?: boolean };
  /** 流式死亡回落桥（python 非流式 POST）：Z.ai 网关对高档长思维流有断流行为，
   *  pi SSE 流重试穷尽后走桥（实测可扛数分钟生成）。缺省指向 v4 仓的 glm_chat.py。 */
  fallback?: { command?: string; script?: string; maxTokens?: number };
}

function loadVersion(): string {
  try {
    return fs.readFileSync(path.join(PKG_ROOT, "VERSION"), "utf-8").trim();
  } catch {
    try {
      return (JSON.parse(fs.readFileSync(path.join(PKG_ROOT, "package.json"), "utf-8")).version) || "0.0.0";
    } catch { return "0.0.0"; }
  }
}

/** 读运行配置文件：新名 storyharness.json 优先，回落旧名 harness-pi.json（迁移期不断线）。 */
function readRuntimeFile(workspaceRoot: string): Partial<HarnessConfig> & Record<string, unknown> {
  const candidates = [
    process.env.STORYHARNESS_CONFIG,
    path.join(workspaceRoot, ".external", "storyharness.json"),
    path.join(workspaceRoot, ".external", "harness-pi.json"),
  ].filter(Boolean) as string[];
  for (const p of candidates) {
    try { return JSON.parse(fs.readFileSync(p, "utf-8")); } catch { /* 试下一个 */ }
  }
  return {};
}

export function loadConfig(
  overrides: Partial<Omit<HarnessConfig, "serve">> & { workspaceRoot?: string; serve?: Partial<ServeConfig> } = {},
): HarnessConfig {
  const workspaceRoot = resolveWorkspaceRoot(overrides.workspaceRoot);
  const { corpus, corpusName, manifestKernelBase } = loadCorpus(workspaceRoot);
  const file = readRuntimeFile(workspaceRoot);
  const cfg: HarnessConfig = {
    harnessVersion: loadVersion(),
    workspaceRoot,
    corpusName,
    corpus,
    serve: loadServe(workspaceRoot, file, overrides.serve),
    kernelBase: process.env.MINIFLOW_KERNEL || (file.kernelBase as string) || manifestKernelBase || "http://127.0.0.1:8421",
    project: overrides.project || (file.project as string) || "",
    provider: process.env.PI_PROVIDER || (file.provider as string) || "zai",
    model: process.env.PI_MODEL || (file.model as string) || "glm-5.3",
    apiKey: process.env.PI_API_KEY || (file.apiKey as string),
    baseUrl: process.env.PI_BASE_URL || (file.baseUrl as string),
    maxParallel: overrides.maxParallel ?? (file.maxParallel as number) ?? 3,
    thinking: (process.env.PI_THINKING as HarnessConfig["thinking"]) || (file.thinking as string) || "medium",
    tiers: file.tiers as HarnessConfig["tiers"],
    judge: file.judge as HarnessConfig["judge"],
    fallback: file.fallback as HarnessConfig["fallback"],
  };
  if (!cfg.project) throw new Error("未指定项目：用 --project 或在 <workspace>/.external/storyharness.json 写 project");
  return cfg;
}
