// 工具桥：Pinax 五 lookup → pi-agent 工具环。
// 数据源 = 请求携带的资源快照（snapshot），由 Pinax 客户端从 narrativeResourceIndex 现建带上来——
// 这解决了「数据在浏览器 stores、Node fs 看不见」的一致性缺口（注意事项 3 的落地答案）。
// 语义镜像上游：action 枚举、限额（maxItems/maxQueryChars/maxResultChars）、结果形状（domain/action/items/revision/warnings）。
import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { NARRATIVE_TOOL_LIMITS, NARRATIVE_READ_TOOLS, PINAX_TOOL_NAMES, type PinaxToolName } from "./contract.js";
import { NARRATIVE_BEAT_PLAN_TOOL, narrativeBeatPlanRevision, narrativeBeatPlanToolSchema, validateNarrativeBeatPlanInput, type BeatPlan } from "./beatPlan.js";
import { registerCapabilities, safeCalcEval, type CapabilityManifest } from "./toolManifest.js";

const L = NARRATIVE_TOOL_LIMITS;

export interface SnapshotItem {
  id: string;
  title?: string;
  type?: string;
  summary?: string;
  text?: string;
  aliases?: string[];
  tags?: string[];
  relations?: { type: string; targetId: string }[];
  trust?: string;
  sourceRefs?: string[];
  /** geo 专用 */
  position?: { x: number; y: number };
  connectedPlaces?: string[];
  routeFrom?: string;
  /** politics 专用 */
  faction?: string;
  controls?: string[];
  /** history 专用 */
  time?: string;
  cause?: string;
}

export interface ResourceSnapshot {
  revision?: string;
  currentPlaceId?: string;
  domains: Partial<Record<PinaxToolName | "manuscript" | "notes" | "outline", SnapshotItem[]>>;
}

function clip(value: string, limit: number): string {
  const s = String(value ?? "");
  return s.length > limit ? `${s.slice(0, limit - 1)}…` : s;
}

function itemLine(item: SnapshotItem, limit: number): string {
  const parts = [
    item.id,
    item.title ? `《${item.title}》` : "",
    item.type ? `[${item.type}]` : "",
    item.trust ? `(${item.trust})` : "",
    clip(item.summary || item.text || "", limit),
  ].filter(Boolean);
  return parts.join(" ");
}

function matchScore(item: SnapshotItem, query: string): number {
  const q = query.toLowerCase().trim();
  if (!q) return 1;
  const hay = [item.title, item.summary, item.text, ...(item.aliases || []), ...(item.tags || [])]
    .filter(Boolean).join(" ").toLowerCase();
  let score = 0;
  for (const token of q.split(/\s+/)) {
    if (!token) continue;
    if (item.title && item.title.toLowerCase().includes(token)) score += 4;
    if (item.aliases?.some((a) => a.toLowerCase().includes(token))) score += 3;
    if (hay.includes(token)) score += 1;
  }
  return score;
}

function search(domain: PinaxToolName, snapshot: ResourceSnapshot, query: string): SnapshotItem[] {
  const items = snapshot.domains[domain] || [];
  return items
    .map((item) => ({ item, score: matchScore(item, String(query || "").slice(0, L.maxQueryChars)) }))
    .filter((x) => x.score > 0 || !String(query || "").trim())
    .sort((a, b) => b.score - a.score)
    .slice(0, L.maxItems)
    .map((x) => x.item);
}

function getById(domain: PinaxToolName, snapshot: ResourceSnapshot, id: string): SnapshotItem | undefined {
  return (snapshot.domains[domain] || []).find((i) => i.id === id);
}

function resultEnvelope(domain: PinaxToolName, action: string, snapshot: ResourceSnapshot, items: SnapshotItem[], warnings: string[] = []) {
  const perItem = action === "get" ? L.maxGetItemChars : L.maxItemChars;
  const lines = items.map((item) => {
    const head = itemLine(item, perItem);
    const rel = (item.relations || []).slice(0, 8).map((r) => `${r.type}->${r.targetId}`).join(",");
    return rel ? `${head} 关系[${rel}]` : head;
  });
  const body = JSON.stringify({
    domain,
    action,
    revision: snapshot.revision || "snapshot",
    items: lines,
    warnings,
  });
  return clip(body, L.maxResultChars);
}

const SearchParams = Type.Object({
  action: Type.Union([Type.Literal("search"), Type.Literal("get"), Type.Literal("related")]),
  query: Type.Optional(Type.String({ description: `关键词，≤${L.maxQueryChars}字` })),
  id: Type.Optional(Type.String({ description: "条目 id（get/related 用）" })),
});

const GeoParams = Type.Object({
  action: Type.Union([Type.Literal("current"), Type.Literal("get"), Type.Literal("nearby"), Type.Literal("route")]),
  id: Type.Optional(Type.String()),
  to: Type.Optional(Type.String({ description: "route 目标地点 id" })),
});

const TraceParams = Type.Object({
  action: Type.Union([Type.Literal("search"), Type.Literal("get"), Type.Literal("trace")]),
  query: Type.Optional(Type.String()),
  id: Type.Optional(Type.String()),
});

const GetSearchParams = Type.Object({
  action: Type.Union([Type.Literal("search"), Type.Literal("get")]),
  query: Type.Optional(Type.String()),
  id: Type.Optional(Type.String()),
});

const PoliticsParams = Type.Object({
  action: Type.Union([Type.Literal("current"), Type.Literal("get"), Type.Literal("trace")]),
  query: Type.Optional(Type.String()),
  id: Type.Optional(Type.String()),
});

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }], details: undefined };
}

export function buildPinaxTools(snapshot: ResourceSnapshot, allowed?: string[], hooks?: { onBeatPlan?: (plan: BeatPlan, revision: string) => void }): AgentTool<any>[] {
  // 只暴露「快照里有资源」的域——镜像上游 registry 的 availableToolNames（无资源域不进目录）
  const present = PINAX_TOOL_NAMES.filter((n) => (snapshot.domains[n]?.length || 0) > 0);
  const names = allowed?.length ? present.filter((n) => allowed.includes(n)) : present;
  const tools: AgentTool<any>[] = [];

  if (names.includes("world_lookup")) {
    tools.push({
      name: "world_lookup",
      label: "世界书查询",
      description: NARRATIVE_READ_TOOLS.world_lookup.description + ` 单次最多返回 ${L.maxItems} 条。`,
      parameters: SearchParams,
      execute: async (_id, p: any) => {
        if (p.action === "get") {
          const item = getById("world_lookup", snapshot, p.id || "");
          return textResult(resultEnvelope("world_lookup", "get", snapshot, item ? [item] : [], item ? [] : ["entry-not-found"]));
        }
        if (p.action === "related") {
          const anchor = getById("world_lookup", snapshot, p.id || "");
          const targets = (anchor?.relations || []).map((r) => getById("world_lookup", snapshot, r.targetId)).filter(Boolean) as SnapshotItem[];
          return textResult(resultEnvelope("world_lookup", "related", snapshot, targets.slice(0, L.maxItems), anchor ? [] : ["anchor-not-found"]));
        }
        return textResult(resultEnvelope("world_lookup", "search", snapshot, search("world_lookup", snapshot, p.query || "")));
      },
    });
  }

  if (names.includes("geo_lookup")) {
    tools.push({
      name: "geo_lookup",
      label: "地理查询",
      description: NARRATIVE_READ_TOOLS.geo_lookup.description,
      parameters: GeoParams,
      execute: async (_id, p: any) => {
        const items = snapshot.domains.geo_lookup || [];
        if (p.action === "current") {
          const cur = items.find((i) => i.id === snapshot.currentPlaceId) || items.slice(0, 1);
          return textResult(resultEnvelope("geo_lookup", "current", snapshot, Array.isArray(cur) ? cur.slice(0, L.maxItems) : [cur]));
        }
        if (p.action === "get") {
          const item = getById("geo_lookup", snapshot, p.id || "");
          return textResult(resultEnvelope("geo_lookup", "get", snapshot, item ? [item] : [], item ? [] : ["place-not-found"]));
        }
        if (p.action === "route") {
          const from = getById("geo_lookup", snapshot, p.id || "") || items[0];
          const to = getById("geo_lookup", snapshot, p.to || "");
          if (!from || !to) return textResult(resultEnvelope("geo_lookup", "route", snapshot, [], ["endpoint-not-found"]));
          const hop = (from.connectedPlaces || []).includes(to.id) ? "直达" : "无已知直达路线（不得虚构行程）";
          return textResult(resultEnvelope("geo_lookup", "route", snapshot, [from, to], [`route:${hop}`]));
        }
        const cur = getById("geo_lookup", snapshot, snapshot.currentPlaceId || "");
        const near = cur?.connectedPlaces?.map((id) => getById("geo_lookup", snapshot, id)).filter(Boolean) as SnapshotItem[];
        return textResult(resultEnvelope("geo_lookup", "nearby", snapshot, (near || items).slice(0, L.maxItems)));
      },
    });
  }

  const traceTool = (name: PinaxToolName, label: string, params: any) => {
    tools.push({
      name,
      label,
      description: NARRATIVE_READ_TOOLS[name].description,
      parameters: params,
      execute: async (_id: string, p: any) => {
        if (p.action === "get" || p.action === "current") {
          const item = getById(name, snapshot, p.id || "");
          return textResult(resultEnvelope(name, p.action, snapshot, item ? [item] : [], item ? [] : ["entry-not-found"]));
        }
        if (p.action === "trace") {
          const anchor = getById(name, snapshot, p.id || "");
          const chain = search(name, snapshot, p.query || anchor?.title || "");
          return textResult(resultEnvelope(name, "trace", snapshot, chain, anchor ? [] : ["anchor-not-found"]));
        }
        return textResult(resultEnvelope(name, "search", snapshot, search(name, snapshot, p.query || "")));
      },
    });
  };

  if (names.includes("history_lookup")) traceTool("history_lookup", "历史查询", TraceParams);
  if (names.includes("memory_lookup")) traceTool("memory_lookup", "记忆事实查询", GetSearchParams);
  if (names.includes("politics_lookup")) traceTool("politics_lookup", "政治关系查询", PoliticsParams);

  // BeatPlan 规划轮（②）：计划先行工具——模型提交节拍计划，镜像 Pinax 契约校验受理；
  // continue 模式不暴露（复用当前计划，镜像上游「extend 复用」语义）。
  if (hooks?.onBeatPlan) {
    tools.push({
      name: NARRATIVE_BEAT_PLAN_TOOL,
      label: "节拍规划",
      description: "本轮写正文前先提交节拍计划：回应义务、因果步骤、角色行动（action+result）、最终新增信息与可观察收束条件。计划受理后再产出正文，不得偏离已提交计划。",
      parameters: narrativeBeatPlanToolSchema(),
      execute: async (_id, p: any) => {
        const r = validateNarrativeBeatPlanInput(p);
        if (!r.valid) return textResult(JSON.stringify({ ok: false, error: r.error }));
        const revision = narrativeBeatPlanRevision(r.plan);
        hooks.onBeatPlan?.(r.plan, revision);
        return textResult(JSON.stringify({ ok: true, revision, note: "计划已受理：按计划产出正文，不得偏离已提交的因果步骤与收束条件。" }));
      },
    });
  }

  // —— Pinax 原生能力 → 工具（经 toolManifest 转换接口注册；数据走快照新域） ——
  const domainItems = (domain: string): SnapshotItem[] => {
    const raw = (snapshot as unknown as Record<string, Record<string, SnapshotItem[]>>).domains[domain];
    return Array.isArray(raw) ? raw : [];
  };
  const clipText = (item: SnapshotItem): string =>
    [item.title ? `《${item.title}》` : "", item.text || item.summary || ""].filter(Boolean).join("\n").slice(0, 1200);

  const domainPresent = (domain: string) => domainItems(domain).length > 0;
  const domainCapability = (manifest: CapabilityManifest) => (manifest.domain && domainPresent(manifest.domain) ? registerCapabilities([manifest]) : []);
  tools.push(...registerCapabilities([{
    id: "calc_evaluate",
    title: "确定性算术",
    desc: "复算数值：只接受数字与 + - * / ( ) 的算式，确定性求值。涉及数值的回答必须经本工具复算，禁止心算后直接报结论。",
    kind: "query",
    knowledge: [],
    parameters: { type: "object", properties: { expression: { type: "string", description: "如：1200 * 3 + 450 / 2" } }, required: ["expression"] },
    execute: async (p: Record<string, unknown>) => {
      try {
        const value = safeCalcEval(String(p.expression || ""));
        return JSON.stringify({ ok: true, expression: String(p.expression || ""), value });
      } catch (e) {
        return JSON.stringify({ ok: false, expression: String(p.expression || ""), error: String((e as Error).message || e) });
      }
    },
  }]));
  tools.push(...domainCapability({
    id: "manuscript_search", title: "正文快照检索", kind: "query", domain: "manuscript", knowledge: ["manuscript"],
    desc: "在本轮已加载的有界章节正文快照中检索关键词，返回命中的章节与上下文。找伏笔或查剧情可先检索，快照可能只覆盖章节前段，不得宣称已通读全书，引用时给出章节。",
    parameters: { type: "object", properties: { query: { type: "string", description: "检索关键词（人名/物件/情节点）" } }, required: ["query"] },
    execute: async (p: Record<string, unknown>) => {
      const q = String(p.query || "").trim().slice(0, L.maxQueryChars).toLowerCase();
      if (!q) return JSON.stringify({ ok: false, error: "query 必填" });
      const hits = domainItems("manuscript")
        .map((item) => {
          const text = String(item.text || item.summary || "");
          const at = text.toLowerCase().indexOf(q);
          return { item, at, text };
        })
        .filter((x) => x.at >= 0)
        .slice(0, L.maxItems)
        .map((x) => ({ id: x.item.id, title: x.item.title || "", excerpt: x.text.slice(Math.max(0, x.at - 120), x.at + 360), sourceRefs: x.item.sourceRefs || [] }));
      return JSON.stringify({ ok: true, domain: "manuscript", action: "search", query: q, hits, total: hits.length, revision: snapshot.revision || "" });
    },
  }));
  tools.push(...domainCapability({
    id: "manuscript_get", title: "章节正文读取", kind: "query", domain: "manuscript", knowledge: ["manuscript"],
    desc: "按章节 id 读取该章正文（有界截尾）。只返回有界片段，不能声称已通读章节。",
    parameters: { type: "object", properties: { id: { type: "string", description: "章节条目 id" } }, required: ["id"] },
    execute: async (p: Record<string, unknown>) => {
      const item = domainItems("manuscript").find((i) => i.id === String(p.id || "")) || null;
      return JSON.stringify({ ok: Boolean(item), domain: "manuscript", action: "get", items: item ? [{ id: item.id, title: item.title || "", text: clipText(item), sourceRefs: item.sourceRefs || [] }] : [], revision: snapshot.revision || "" });
    },
  }));
  tools.push(...domainCapability({
    id: "notes_search", title: "构思与速记检索", kind: "query", domain: "notes", knowledge: ["notes"],
    desc: "检索当前作品的构思文档与速记。注意：构思/速记只代表作者意图与建议，不得冒充正文已发生的事实。",
    parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    execute: async (p: Record<string, unknown>) => {
      const q = String(p.query || "").trim().slice(0, L.maxQueryChars).toLowerCase();
      const hits = domainItems("notes").filter((item) => `${item.title || ""} ${item.text || item.summary || ""}`.toLowerCase().includes(q)).slice(0, L.maxItems);
      return JSON.stringify({ ok: true, domain: "notes", action: "search", items: hits.map((i) => ({ id: i.id, title: i.title || "", text: clipText(i), sourceRefs: i.sourceRefs || [] })), revision: snapshot.revision || "" });
    },
  }));
  tools.push(...domainCapability({
    id: "outline_lookup", title: "大纲查询", kind: "query", domain: "outline", knowledge: ["outline"],
    desc: "查询当前作品大纲节点（标题/意图/状态）。大纲只代表作者意图。",
    parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    execute: async (p: Record<string, unknown>) => {
      const q = String(p.query || "").trim().slice(0, L.maxQueryChars).toLowerCase();
      const all = domainItems("outline");
      const hits = q ? all.filter((i) => `${i.title || ""} ${i.summary || ""}`.toLowerCase().includes(q)) : all;
      return JSON.stringify({ ok: true, domain: "outline", action: "search", items: hits.slice(0, L.maxItems).map((i) => ({ id: i.id, title: i.title || "", text: i.summary || "", sourceRefs: i.sourceRefs || [] })), total: all.length, revision: snapshot.revision || "" });
    },
  }));

  return tools;
}
