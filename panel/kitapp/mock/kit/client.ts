/** kit harness REST 客户端（浏览器侧直连，CORS 由 kit 放行 loopback 源）。
 *  桥的唯一数据出口——mock 层其余模块只认识本文件的方法。 */
import type { SessionInfo } from "@/lib/types";
import { getRealFetch } from "../runtime";

export const KIT_BASE: string = (() => {
  if (typeof window === "undefined") return "http://127.0.0.1:8431";
  const q = new URLSearchParams(window.location.search);
  return q.get("kit") || "http://127.0.0.1:8431";
})();

export interface KitSessionMeta {
  id: string;
  title?: string;
  updatedAt?: string;
  turns?: number;
  mode?: string;
  ended?: boolean;
  pinned?: boolean;
  archived?: boolean;
}

export async function kitJson<T>(path: string, init?: RequestInit): Promise<T> {
  // GET 加缓存击穿：chromium 按「默认可缓存」启发式缓存 410/404 错误体——
  // 旧进程时代的错误响应曾从缓存反复回放（服务端已换新代码仍 410），GET 一律绕开 HTTP 缓存。
  const isGet = !init?.method || init.method === "GET";
  const url = isGet ? `${KIT_BASE}${path}${path.includes("?") ? "&" : "?"}_=${Date.now()}` : `${KIT_BASE}${path}`;
  // 8s 超时：水合挂在网络上时快速失败回落教程，侧栏不许无限 Loading
  const res = await (await getRealFetch())(url, { ...init, signal: AbortSignal.timeout(8000) });
  const text = await res.text();
  try {
    (window as unknown as Record<string, unknown>).__kitLast = { url, status: res.status, body: text.slice(0, 200) };
  } catch { /* 非浏览器环境忽略 */ }
  if (!res.ok) throw new Error(`kit ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text) as T;
}

/** 当前项目：URL ?project= 优先，否则 hub 的 groups[].projects[] 第一个。 */
export async function kitProjectId(): Promise<string | null> {
  if (typeof window !== "undefined") {
    const q = new URLSearchParams(window.location.search).get("project");
    if (q) return q;
  }
  try {
    const hub = await kitJson<{ groups?: { projects?: { id: string }[] }[] }>("/api/hub");
    return (hub.groups ?? []).flatMap((g) => g.projects ?? []).map((p) => p.id)[0] ?? null;
  } catch {
    return null;
  }
}

export async function kitSessions(project: string): Promise<KitSessionMeta[]> {
  const r = await kitJson<KitSessionMeta[] | { sessions?: KitSessionMeta[] }>(
    `/api/projects/${encodeURIComponent(project)}/agent/sessions`,
  );
  return Array.isArray(r) ? r : (r.sessions ?? []);
}

export interface KitTranscript {
  id: string;
  title?: string;
  updatedAt?: string;
  turns?: number;
  messages: {
    role: "user" | "assistant" | "tool";
    content?: string;
    tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
    tool_call_id?: string;
    usage?: unknown;
    model?: { provider: string; id: string };
  }[];
  events: { ts: string; event: Record<string, unknown> }[];
}

export async function kitTranscript(project: string, sid: string): Promise<KitTranscript> {
  return kitJson<KitTranscript>(`/api/projects/${encodeURIComponent(project)}/agent/sessions/${encodeURIComponent(sid)}`);
}

export async function kitCreateSession(project: string, title = ""): Promise<{ id: string }> {
  return kitJson<{ id: string }>(`/api/projects/${encodeURIComponent(project)}/agent/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title }),
  });
}

// ── 生产线（批3）：状态 / 启动 / 停止 ──────────────────────────
export interface KitProductionStatus {
  project?: string;
  running?: boolean;
  startedAt?: string | null;
  last?: unknown;
  lastError?: string | null;
  flowNext?: { status?: string };
}

export async function kitProductionStatus(): Promise<KitProductionStatus> {
  return kitJson<KitProductionStatus>("/status");
}

/** journal 台账尾部（大事记时间轴数据源）。 */
export async function kitJournal(project: string, limit = 200): Promise<{ total: number; entries: Record<string, unknown>[]; note?: string }> {
  return kitJson(`/api/panel/journal?project=${encodeURIComponent(project)}&limit=${limit}`);
}

/** 工作区/项目/流程清单（hub）。 */
export async function kitHub(): Promise<unknown> {
  return kitJson("/api/hub");
}

export async function kitProductionStart(project: string): Promise<unknown> {
  return kitJson("/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ project }),
  });
}

export async function kitProductionStop(): Promise<unknown> {
  return kitJson("/stop", { method: "POST" });
}

// ── 生产线工程map（工单-20261004）：工作流图示化数据源 ──────────
export interface KitPlanNode {
  id: string;
  module: string;
  op: string;
  title: string;
  desc: string;
  kind: string;
  gateRole: string;
  output: string;
  status: string;
  round: number;
  failCount: number;
  at: string | null;
  submits: number;
  verdicts: number;
}
export interface KitFlowPlan {
  project: string;
  mode: "run" | "skeleton";
  degraded?: boolean;
  flow: { id: string; title: string; version: string; desc: string };
  running: boolean;
  flowStatus: string;
  startedAt: string | null;
  lastError: string | null;
  gate: { verdict: string; node: string | null; at: string | null };
  modules: { id: string; ref: string; name: string }[];
  nodes: KitPlanNode[];
  edges: { from: string; to: string; kind: string }[];
  stats: { total: number; done: number; awaiting: number };
}

/** 工作流地图（工程map/剧情树）：state ⊕ effective 读模型 ⊕ journal 走过路径。 */
export async function kitProductionPlan(project: string, flow = "novel"): Promise<KitFlowPlan> {
  return kitJson<KitFlowPlan>(`/api/panel/plan?project=${encodeURIComponent(project)}&flow=${encodeURIComponent(flow)}`);
}

/** 会话重命名（自动标题用：首问后以首句命名，替掉 demo 罐头 autoTitle）。 */
export async function kitRename(project: string, sid: string, title: string): Promise<void> {
  await kitJson(`/api/projects/${encodeURIComponent(project)}/agent/sessions/${encodeURIComponent(sid)}/rename`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title }),
  });
}

/** kit 文本读取（.md/.json/.txt 白名单 ≤200KB）——世界书卡片等产物走此端点。 */
export async function kitFileRead(project: string, file: string): Promise<{ path: string; content: string }> {
  return kitJson<{ path: string; content: string }>(
    `/api/panel/files?project=${encodeURIComponent(project)}&file=${encodeURIComponent(file)}`,
  );
}

export async function kitStop(project: string, sid: string): Promise<void> {
  await (await getRealFetch())(`${KIT_BASE}/api/projects/${encodeURIComponent(project)}/agent/sessions/${encodeURIComponent(sid)}/stop`, {
    method: "POST",
  }).catch(() => undefined);
}

/** 世界书 / RAG 检索与读卡（经内核动词白名单代理）。 */
export async function kitWorldbookSearch(project: string, q: string): Promise<{ hits?: { title?: string; summary?: string }[] }> {
  return kitJson("/api/kernel-verb", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ verb: "worldbook_search", args: { project, q } }),
  });
}

export async function kitKbSearch(q: string): Promise<{ hits?: { ref?: string; title?: string; snippet?: string }[] }> {
  return kitJson("/api/kernel-verb", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ verb: "kb_search", args: { q } }),
  });
}

export async function kitKbRead(ref: string): Promise<{ content?: string }> {
  return kitJson("/api/kernel-verb", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ verb: "kb_read", args: { ref } }),
  });
}

// ── 知识库卡片商店（工单-20261005）────────────────────────────
export interface KitKbCard {
  id: string;
  domain: string;
  file: string;
  title: string;
  type: string;
  typeName: string;
  status: string;
  version: string;
  updated: string;
  summary: string;
}
export interface KitKbCatalog {
  domains: { key: string; name: string; desc: string; count: number }[];
  cards: KitKbCard[];
  total: number;
}

/** 知识库全量目录（卡片商店数据源）：repoRoot/knowledge frontmatter 静态汇总。 */
export async function kitKbCatalog(): Promise<KitKbCatalog> {
  return kitJson<KitKbCatalog>("/api/panel/kb-catalog");
}

/** 打开一个 kit 回合（raw=1：pi 会话事件全保真），逐帧产出。raw 帧解包为 pi 事件本身；
 *  投影帧（delta/done/error）原样产出，消费方自选。流以 [DONE] 或流错误收束。 */
export async function* kitTurnRaw(
  project: string,
  sid: string,
  text: string,
  mode: string,
  signal?: AbortSignal,
): AsyncGenerator<Record<string, unknown>> {
  const res = await (await getRealFetch())(
    `${KIT_BASE}/api/projects/${encodeURIComponent(project)}/agent/sessions/${encodeURIComponent(sid)}/turn?raw=1`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, mode }),
      signal: signal ?? AbortSignal.timeout(300_000), // 回合可能跑几分钟；默认 5 分钟上限
    },
  );
  if (!res.ok || !res.body) throw new Error(`kit turn ${res.status}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const frame = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const line = frame.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      const payload = line.slice(6);
      if (payload === "[DONE]") return;
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(payload) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (parsed.type === "raw" && parsed.event) yield parsed.event as Record<string, unknown>;
      else if (parsed.type !== "open") yield parsed;
    }
  }
}

/** kit 侧整页 HTML 的绝对地址（iframe 嵌入面板用：pedia 全页/台账页等工作台并列面板）。 */
export function kitHtmlUrl(path: string): string {
  return `${KIT_BASE}${path}`;
}

/** git 分支信息（右侧 agent dock）：工作区根 = 仓库根。 */
export async function kitGitInfo(): Promise<{ current: string | null; branches: string[]; note?: string }> {
  return kitJson(`/api/panel/git-info`);
}

/** 切换分支（checkout；分支名服务端白名单校验）。 */
export async function kitGitCheckout(branch: string): Promise<{ ok?: boolean; current?: string; error?: string }> {
  return kitJson("/api/panel/git-checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ branch }),
  });
}
