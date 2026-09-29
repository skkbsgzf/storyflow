// 快判官（laya 学生）证据位——纪律红线：输出仅为复核优先级证据（P 值纪律），
// 不构成放行/拦截、不触发打回；只进 会话流 + 收据 + 运行遥测。
// stdout 契约：判官进程整程只落一份 JSON；解析按「最后一个完整 JSON 对象」兜底
// （历史教训：库级横幅曾混入 stdout 尾部，position 148 解析炸）。
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { HarnessConfig } from "./config.js";

export interface JudgeEvidence {
  ran: boolean;
  error?: string;
  flagged?: string[];
  answers?: Record<string, number>;
  skipped?: Record<string, string>;
  threshold?: number;
  checkpoint?: string;
  disclaimer?: string;
}

export interface JudgeConfig {
  enabled?: boolean;
  /** venv python 绝对路径（MS Store 存根 spawn 假死坑——必须真 python） */
  command?: string;
  /** 判官脚本（相对 workspaceRoot 或绝对） */
  script?: string;
  /** 学生 checkpoint（相对 workspaceRoot 或绝对） */
  student?: string;
  /** questions.spec（相对 workspaceRoot 或绝对） */
  spec?: string;
  threshold?: number;
  /** 场景文本截断上限（字符），缺省 12000 */
  maxChars?: number;
  /** 超时 ms，缺省 300000（学生前向秒级，留足冷装载） */
  timeoutMs?: number;
}

/** 从混噪文本中取最后一个可解析的 JSON 对象：整文 → 逐行（从尾） → 有界花括号回扫。 */
export function parseLastJson(text: string): Record<string, unknown> | null {
  const t = text.trim();
  if (!t) return null;
  try { const v = JSON.parse(t); if (v && typeof v === "object") return v as Record<string, unknown>; } catch { /* 落下一档 */ }
  const lines = t.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i].trim();
    if (!l.startsWith("{")) continue;
    try { const v = JSON.parse(l); if (v && typeof v === "object") return v as Record<string, unknown>; } catch { /* 上一行 */ }
  }
  const first = t.indexOf("{");
  if (first < 0) return null;
  const window = t.length > 262_144 ? t.slice(-262_144) : t;
  for (let end = window.length; end > 0; end--) {
    if (window[end - 1] !== "}") continue;
    try {
      const v = JSON.parse(window.slice(window.indexOf("{", 0) , end));
      if (v && typeof v === "object") return v as Record<string, unknown>;
    } catch { /* 缩窗重试 */ }
  }
  return null;
}

const resolve = (cfg: HarnessConfig, p?: string) =>
  p && !path.isAbsolute(p) ? path.join(cfg.workspaceRoot, p) : p;

/** 对一份已交卷的 .md 产物跑学生判官；任何失败都降级为 {ran:false,error}，绝不抛出拖垮主流程。 */
export function runLayaJudge(cfg: HarnessConfig, absFile: string): JudgeEvidence {
  const j = cfg.judge;
  if (!j?.enabled) return { ran: false, error: "judge 未启用" };
  const command = j.command;
  const script = resolve(cfg, j.script);
  const student = resolve(cfg, j.student);
  const spec = resolve(cfg, j.spec);
  if (!command || !script || !student) return { ran: false, error: "judge 配置缺 command/script/student" };
  if (!fs.existsSync(script)) return { ran: false, error: `判官脚本不存在：${script}` };
  if (!fs.existsSync(absFile)) return { ran: false, error: `产物不存在：${absFile}` };

  let stateFile = "";
  try {
    // state 组装：只给场景文本（其余 state_requires 缺席 → 判官侧显式 skip，不猜值）
    const scene = fs.readFileSync(absFile, "utf-8").slice(0, j.maxChars ?? 12_000);
    stateFile = path.join(os.tmpdir(), `sh-judge-${process.pid}-${Date.now()}.json`);
    fs.writeFileSync(stateFile, JSON.stringify({ 场景文本: scene }, null, 1), "utf-8");
    const args = [script, "--student", student, "--state", stateFile];
    if (spec) args.push("--spec", spec);
    if (j.threshold) args.push("--threshold", String(j.threshold));
    const p = spawnSync(command, args, {
      encoding: "utf-8",
      timeout: j.timeoutMs ?? 300_000,
      maxBuffer: 16 << 20,
      env: { ...process.env, PYTHONIOENCODING: "utf-8", HF_HUB_OFFLINE: "1" },
    });
    if (p.error) return { ran: false, error: `判官进程失败：${p.error.message}` };
    const parsed = parseLastJson((p.stdout || "") + (p.stderr || ""));
    if (!parsed) return { ran: false, error: `判官无可解析 JSON（exit=${p.status}）：${String(p.stderr || "").slice(0, 160)}` };
    return {
      ran: true,
      flagged: (parsed.flagged as string[]) ?? [],
      answers: (parsed.answers as Record<string, number>) ?? {},
      skipped: (parsed.skipped as Record<string, string>) ?? {},
      threshold: parsed.threshold as number | undefined,
      checkpoint: parsed.checkpoint as string | undefined,
      disclaimer: parsed.disclaimer as string | undefined,
    };
  } catch (e) {
    return { ran: false, error: `判官异常：${(e as Error).message}` };
  } finally {
    if (stateFile) { try { fs.rmSync(stateFile, { force: true }); } catch { /* 临时件 */ } }
  }
}
