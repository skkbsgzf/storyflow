// 立意图（intent-graph@1）· 宇宙级可能空间 → 项目决策的单向桥（方案盘 20260924 拍板）。
// 图 CRUD 本体在 tools/intent-graph.py（单一实现，ig_load/propose/commit/exclude 走桥）；
// 本模块只承担与内核契约相邻的部分：图读取/校验 + ig_sync 落 decision@1
//（经 decisions.ts setDecision 单源，绝不手写 decision 文件——防双实现漂移）。
// 方向纪律：立意图 → decisions 单向（feeds_decision 桥同构）；已存在不回填；反向一律禁止。
import fs from "node:fs";
import path from "node:path";
import { setDecision } from "./decisions.js";

export interface IntentCandidate {
  id: string;
  title?: string;
  content?: string;
  /** 剪枝排序分——只排复核优先级，禁当放行闸（semif 纪律）；无 scorer 禁带 p */
  p?: number;
  scorer?: "human" | "semif-4b" | "laya-student" | "jev-api" | "untested";
  evidence?: string;
  status: "proposed" | "committed" | "excluded";
  excluded_reason?: string;
}

export interface IntentNode {
  id: string;
  kind: "立意" | "人物" | "世界观" | "主旨" | "题材" | "钩子" | "设定";
  title: string;
  content?: string;
  parent?: string | null;
  status: "open" | "committed" | "excluded";
  decision_key?: string;
  candidates: IntentCandidate[];
}

export interface IntentGraph {
  format: "intent-graph@1";
  universe: string;
  title: string;
  updated_at?: string;
  nodes: IntentNode[];
  edges?: { from: string; to: string; rel: "supports" | "contradicts" | "refines" | "feeds" }[];
  stats?: { nodes?: number; committed?: number; candidates?: number };
}

export class IntentError extends Error {
  constructor(public code: string, msg: string) {
    super(`[${code}] ${msg}`);
  }
}

export function intentGraphPath(repoRoot: string, uid: string): string {
  return path.join(repoRoot, "universes", uid, "intent-graph.json");
}

/** 读宇宙立意图：缺文件/坏 format 显式抛（不静默、不造空图）。 */
export function loadIntentGraph(repoRoot: string, uid: string): IntentGraph {
  const p = intentGraphPath(repoRoot, uid);
  if (!fs.existsSync(p)) throw new IntentError("INTENT_MISSING", `立意图不存在：${p}`);
  let g: IntentGraph;
  try {
    g = JSON.parse(fs.readFileSync(p, "utf-8")) as IntentGraph;
  } catch (e) {
    throw new IntentError("INTENT_INVALID", `JSON 解析失败：${p}（${e instanceof Error ? e.message : String(e)}）`);
  }
  if (g.format !== "intent-graph@1") {
    throw new IntentError("INTENT_INVALID", `format≠intent-graph@1（实际 ${String((g as { format?: unknown }).format)}）：${p}`);
  }
  if (g.universe !== uid) {
    throw new IntentError("INTENT_INVALID", `universe=${g.universe} 与目录名 ${uid} 不符（宇宙身份单源）`);
  }
  return g;
}

export interface IntentSyncResult {
  universe: string;
  written: { key: string; node: string; candidate: string }[];
  skipped: { key: string; reason: string }[];
  issues: string[];
}

/**
 * committed 候选 → decisions/<decision_key>.json（单向、不回填）。
 * 证据串内带 scorer+p 并明示「剪枝排序分，禁当放行闸」——P 值入 R8 证据链的拍板口径；
 * 不占用 confidence 字段（剪枝分 ≠ 决策置信，不混语义）。
 */
export function syncIntentDecisions(projectDir: string, g: IntentGraph): IntentSyncResult {
  const out: IntentSyncResult = { universe: g.universe, written: [], skipped: [], issues: [] };
  for (const n of g.nodes ?? []) {
    if (n.status !== "committed") continue;
    if (!n.decision_key) {
      out.skipped.push({ key: n.id, reason: "无 decision_key（节点未声明决策落点）" });
      continue;
    }
    const cand = (n.candidates ?? []).find((c) => c.status === "committed");
    if (!cand) {
      out.issues.push(`${n.id}: 节点 committed 但无 committed 候选（图不一致，跳过）`);
      continue;
    }
    const key = n.decision_key;
    const dpath = path.join(projectDir, "decisions", `${key}.json`);
    if (fs.existsSync(dpath)) {
      out.skipped.push({ key, reason: "决策已存在（单向桥不回填）" });
      continue;
    }
    const pTxt = cand.p !== undefined ? ` p=${cand.p}` : "";
    const scorer = cand.scorer ?? "untested";
    const excluded = (n.candidates ?? []).filter((c) => c.status === "excluded");
    const exTxt = excluded.length
      ? `｜排除候选：${excluded.map((c) => c.id).join(",")}（理由见意图图）`
      : "";
    const evidence =
      `立意图 ${g.universe}#${n.id}/${cand.id}（${n.title}${cand.title ? `·${cand.title}` : ""}）。` +
      `scorer=${scorer}${pTxt}（剪枝排序分，禁当放行闸）。` +
      `${cand.content ?? ""}｜依据：${cand.evidence ?? "图内无补充证据"}${exTxt}`;
    try {
      setDecision(projectDir, {
        key,
        by: `intent-graph:${g.universe}#${n.id}/${cand.id}`,
        picked: [cand.title || cand.id],
        evidence,
      });
      out.written.push({ key, node: n.id, candidate: cand.id });
    } catch (e) {
      out.issues.push(`${n.id}: setDecision 拒绝（${e instanceof Error ? e.message : String(e)}）`);
    }
  }
  return out;
}
