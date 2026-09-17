import fs from "node:fs";
import path from "node:path";
import { assertSchema } from "./schema.js";

export interface ProjectConfig {
  项目: string;
  题材?: string;
  需求?: string;
  灵感?: string;
  严肃性?: "探索" | "标准" | "出品";
  风格?: "爽" | "标准";
  AB测试?: boolean;
  市场预估?: string;
  presets?: Record<string, "auto" | "semi" | "manual">;
  [k: string]: unknown;
}

export const CONFIG_FILE = "项目配置.json";

/** 读取并校验项目初始化配置；不存在返回 undefined，存在但非法抛错（开跑前大声失败）。 */
export function loadProjectConfig(projectDir: string): ProjectConfig | undefined {
  const file = path.join(projectDir, CONFIG_FILE);
  if (!fs.existsSync(file)) return undefined;
  const raw = JSON.parse(fs.readFileSync(file, "utf-8"));
  assertSchema("project-config", raw);
  const cfg = raw as ProjectConfig;
  const dirName = path.basename(projectDir);
  if (cfg.项目 && cfg.项目 !== dirName) {
    throw new Error(`${CONFIG_FILE} 的「项目」(${cfg.项目}) 与目录名 (${dirName}) 不一致`);
  }
  return cfg;
}

/**
 * 配置 → flow 输入（合并序：显式入参 > 配置 > flow 默认，故本函数产物会被显式入参覆盖）。
 * - 风格/AB测试 → route（AB优先：true=双版本+基线）
 * - 题材/需求/灵感 → direction 组合（flow 无 direction 输入则跳过）
 * - 其余字段原样回传入 state.inputs（背景卡与下游子代理可见）
 */
export function configToInputs(cfg: ProjectConfig, flow: { inputs?: Record<string, unknown> }): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (typeof cfg.AB测试 === "boolean") {
    out.route = cfg.AB测试 ? "dual" : styleToRoute(cfg.风格);
  } else if (cfg.风格) {
    out.route = styleToRoute(cfg.风格);
  }
  const hasDirection = "direction" in (flow.inputs ?? {});
  if (hasDirection && !out.direction) {
    const composed = [cfg.题材, cfg.需求, cfg.灵感].filter(Boolean).join("；");
    if (composed) out.direction = composed;
  }
  for (const k of ["题材", "需求", "灵感", "严肃性", "市场预估"] as const) {
    if (cfg[k]) out[k] = cfg[k];
  }
  if (cfg.AB测试 !== undefined) out.AB测试 = cfg.AB测试;
  return out;
}

function styleToRoute(style: string | undefined): string | undefined {
  if (style === "爽") return "hot";
  if (style === "标准") return "calm";
  return undefined;
}

/** 背景卡追加行：让每个子代理都带着出品定位与市场底气干活。 */
export function configCardLines(cfg: ProjectConfig, snapshotVersion?: string, snapshotCorpus?: number): string[] {
  const lines: string[] = [];
  const bits: string[] = [];
  if (cfg.严肃性) bits.push(`严肃性=${cfg.严肃性}`);
  if (cfg.风格) bits.push(`风格=${cfg.风格}`);
  if (cfg.AB测试 !== undefined) bits.push(`AB测试=${cfg.AB测试 ? "开（双版本+基线件）" : "关（单版本）"}`);
  if (bits.length) lines.push(`- 出品定位：${bits.join(" ｜ ")}`);
  if (cfg.市场预估) lines.push(`- 市场预估（甲方笔记）：${cfg.市场预估}`);
  if (snapshotVersion) {
    lines.push(`- 市场快照：kb/market/snapshot @${snapshotVersion}${snapshotCorpus ? `（${snapshotCorpus} 部样本）` : ""}——引用热度数据须以此为基线，不得编造`);
  }
  return lines;
}
