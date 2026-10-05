/** kit 会话水合：启动时把 kit 的会话清单+transcript 灌进 mock store，pi-web UI 无感消费。 */
import type { SessionInfo } from "@/lib/types";
import { PROJECT_ROOT } from "../paths";
import { addSession } from "../sessions/store";
import { setDefaultModel } from "../data/models";
import { kitJson, kitProjectId, kitSessions, kitTranscript, type KitSessionMeta } from "./client";
import { firstUserText, transcriptToEntries } from "./convert";

let kitProject: string | null = null;
let kitAvailable = false;
/** kit 工具环目录（水合成功后拉取）：工具/技能面板的真数据源。 */
let kitRing: { tools: { name: string; description: string }[]; skills: { name: string; description: string }[] } | null = null;

export function kitRingCatalogs(): { tools: { name: string; description: string }[]; skills: { name: string; description: string }[] } | null {
  return kitRing;
}

/** kit 模式是否生效（水合成功）。 */
export function kitMode(): boolean {
  return kitAvailable;
}

/** 桥路由用：世界书检索（词面打分 + 一跳图扩展）。 */
export async function kitWorldbookBridge(q: string): Promise<unknown> {
  const { kitWorldbookSearch } = await import("./client");
  return kitWorldbookSearch(kitProjectName() ?? "", q);
}

/** 桥路由用：项目内文本读取（世界书卡片等）。 */
export async function kitEntryBridge(path: string): Promise<{ path: string; content: string }> {
  const project = kitProjectName();
  if (!project) throw new Error("kit 项目未就绪");
  const { kitFileRead } = await import("./client");
  return kitFileRead(project, path);
}

/** 桥路由用：RAG 方法论检索（kb_search）。 */
export async function kitKbSearchBridge(q: string): Promise<unknown> {
  const { kitKbSearch } = await import("./client");
  return kitKbSearch(q);
}

/** 桥路由用：读方法论卡全文（kb_read）。 */
export async function kitKbReadBridge(ref: string): Promise<unknown> {
  const { kitKbRead } = await import("./client");
  return kitKbRead(ref);
}

/** 桥路由用：journal 台账尾部。 */
export async function kitJournalBridge(project: string, limit: number): Promise<unknown> {
  const { kitJournal } = await import("./client");
  return kitJournal(project, limit);
}

/** 桥路由用：hub 清单。 */
export async function kitHubBridge(): Promise<unknown> {
  const { kitHub } = await import("./client");
  return kitHub();
}

/** 桥路由用：生产线状态。 */
export async function kitStatusBridge(): Promise<unknown> {
  const { kitProductionStatus } = await import("./client");
  return kitProductionStatus();
}

/** 桥路由用：生产线启动。 */
export async function kitStartBridge(project: string): Promise<unknown> {
  const { kitProductionStart } = await import("./client");
  return kitProductionStart(project);
}

/** 桥路由用：生产线停止。 */
export async function kitStopBridge(): Promise<unknown> {
  const { kitProductionStop } = await import("./client");
  return kitProductionStop();
}

/** 桥路由用：工作流地图（工程map/剧情树）。 */
export async function kitProductionPlanBridge(project: string, flow?: string): Promise<unknown> {
  const { kitProductionPlan } = await import("./client");
  return kitProductionPlan(project, flow);
}

/** 桥路由用：知识库全量目录（卡片商店数据源）。 */
export async function kitKbCatalogBridge(): Promise<unknown> {
  const { kitKbCatalog } = await import("./client");
  return kitKbCatalog();
}

/** 桥路由用：世界书 graph.json 全量（词条卡墙 + 关系图谱数据源）。 */
export async function kitWorldbookGraphBridge(): Promise<unknown> {
  const project = kitProjectName();
  if (!project) throw new Error("kit 项目未就绪");
  const { kitFileRead } = await import("./client");
  return kitFileRead(project, "世界书/graph.json");
}

export function kitProjectName(): string | null {
  return kitProject;
}

function hydrateOne(meta: KitSessionMeta, project: string): Promise<void> {
  return kitTranscript(project, meta.id)
    .then((t) => {
      const entries = transcriptToEntries(t.messages ?? []);
      addSession({
        id: meta.id,
        cwd: PROJECT_ROOT,
        created: meta.updatedAt ?? new Date().toISOString(),
        ...(meta.title ? { name: meta.title } : {}),
        entries,
        leafId: entries.length ? (entries[entries.length - 1] as { id: string }).id : null,
        transient: false,
        live: null,
      });
    })
    .catch(() => undefined); // 单会话坏不拖垮整批
}

/** 从 kit 水合全部会话。成功 = kitMode()；失败 = 回落教程罐头（离线开发友好）。
 *  调试探针：window.__kitProbe = {ran, project, count, err}。 */
export async function hydrateKitSessions(): Promise<boolean> {
  const w = window as unknown as Record<string, unknown>;
  const probe = { ran: true, project: null as string | null, count: 0, err: "" };
  w.__kitProbe = probe;
  try {
    kitProject = await kitProjectId();
    probe.project = kitProject;
    if (!kitProject) {
      probe.err = "no project resolved";
      w.__kitHydrateError = "no project resolved";
      return false;
    }
    const list = await kitSessions(kitProject);
    probe.count = list.length;
    await Promise.all(list.map((meta) => hydrateOne(meta, kitProject!)));
    kitAvailable = true;
    // 模型档位对齐 kit 配置（/api/agent/model）；首访打开最新会话而非教程欢迎页
    try {
      const m = await kitJson<{ provider?: string; model?: string }>("/api/agent/model");
      if (m.provider && m.model) setDefaultModel(m.provider, m.model);
    } catch { /* 模型面不可用不阻塞水合 */ }
    // 工具环目录（工具/技能面板真数据源）：40 技能卡 + 内核动词
    try {
      const reg = await kitJson<{ skills: { tool: string; title: string; summary: string }[]; verbs: string[] }>("/api/panel/tools");
      kitRing = {
        tools: [
          ...reg.verbs.map((v) => ({ name: v, description: `内核动词（协议面白名单）：${v}` })),
          ...reg.skills.map((s) => ({ name: s.tool, description: s.summary })),
        ],
        skills: reg.skills.map((s) => ({ name: s.title || s.tool, description: s.summary })),
      };
    } catch { /* 工具环不可达不阻塞水合 */ }
    try {
      const newest = list[0]?.id;
      if (newest) window.sessionStorage.setItem("pi-web:tab-open-session", JSON.stringify({ kind: "session", sessionId: newest }));
    } catch { /* storage 不可用忽略 */ }
    return true;
  } catch (e) {
    probe.err = String((e as Error)?.stack ?? e);
    w.__kitHydrateError = probe.err;
    kitAvailable = false;
    return false;
  }
}

export type { SessionInfo };

/** 桥路由用：git 分支信息 / 切换。 */
export async function kitGitInfoBridge(): Promise<unknown> {
  const { kitGitInfo } = await import("./client");
  return kitGitInfo();
}
export async function kitGitCheckoutBridge(branch: string): Promise<unknown> {
  const { kitGitCheckout } = await import("./client");
  return kitGitCheckout(branch);
}
