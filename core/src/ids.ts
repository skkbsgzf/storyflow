import { nodeHash } from "./abstraction/defaults.js";

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(prefix = "r"): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function sha12(text: string): string {
  // 哈希面（R7-2 入册）：sha1 由平台适配器提供（node:crypto / 浏览器自备纯 JS 实现）。
  return nodeHash.sha1Hex(text).slice(0, 12);
}

/** 切掉 artifact@1 头部，取正文（头部是元数据，不入指纹）。 */
export function bodyOf(text: string): string {
  const norm = text.replace(/^\uFEFF/, "");
  if (norm.startsWith("---")) {
    const end = norm.indexOf("\n---", 3);
    if (end >= 0) return norm.slice(end + 4).trimStart();
  }
  return text;
}

/**
 * 正文指纹（依赖图 / 缓存键 / 上下文锚定专用）。
 * 头部含 round/at/by——若计入指纹，同一份内容跨轮必然不同，
 * 确定性步的缓存永不命中、stale 判定也永远为真。规范 R4 §二。
 */
export function contentSha12(text: string): string {
  return sha12(bodyOf(text));
}

/** 稳定字符串化：键序无关（对齐 v3 flowHash 的 FNV-1a 思路）。 */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify((v as Record<string, unknown>)[k])).join(",") + "}";
}

export function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export function flowHashOf(flow: unknown): string {
  return fnv1a(stableStringify(flow));
}

/** gateToken 三重凭据（projectId:runId:gateNodeId），round 另行比对。 */
export function gateToken(projectId: string, runId: string, gateNodeId: string): string {
  return `approval:${projectId}:${runId}:${gateNodeId}`;
}
