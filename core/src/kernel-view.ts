// kernel-view.ts —— 只读视图面（view* / worldbookSearch / 工作台 payload / 诊断）（从 kernel.ts 拆出，委托见 kernel.ts）。

import fs from "node:fs";
import path from "node:path";
import type { FlowDescriptor, RunState, TaskPackage, Validation } from "./types.js";
import { ROOT, assertSchema } from "./schema.js";
import { atomicWriteText, LockDir } from "./fsio.js";
import { listDecisions, setDecision, decisionsDir } from "./decisions.js";
import { gateToken, nowIso } from "./ids.js";
import { compilePlan, PlanCycleError, upstreamOf } from "./plan.js";
import { resolveInputs, evalWhen, isBackEdge, condContextOf, pendingInstancesOf, type CondContext } from "./cond.js";
import {
  freshState, loadState, saveState, migrateRunState, writeJournalSeed,
  legacyStatePath, planDrifted,
} from "./state.js";
import { journalAppend, journalQuery } from "./journal.js";
import {
  makeArtifact, captureSnapshot, inputFingerprint, listArtifacts, readRegisteredText, readSnapshots,
} from "./registry.js";
import { runIntegrityAsserts, runHeaderAsserts, blocked, checkGlossary, dedupeValidations } from "./asserts.js";
import { runCoreNode, artifactPathOf, nodeOutput, outputPathOf } from "./minitools.js";
import { buildTaskPackage, effectiveUpstreams, resolveNodeOp } from "./assembler.js";
import { effectiveFlow3 } from "./modules.js";
import { resolveBudget } from "./budget.js";
import { renderSpawnPrompt } from "./spawn.js";
import { loadProjectConfig, configToInputs, configBudget, type ProjectConfig } from "./project-config.js";
import { listConfigTemplates } from "./cfg-template.js";
import type { BatchEntry, FlowNode, MetricPhase, RunMetric } from "./types.js";
import {
  effectiveFlow, isBoundaryGate, isWorkGate, factoryOverlayPath, projectOverlayPath, readOverlay, writeProjectOverlay,
  type EffectiveFlow, type FlowOverlay, type FlowPolicy, type OverlayPatch,
} from "./overlay.js";
import { recordMetric, readMetrics, summarizeMetrics, extractCtxUsage } from "./metrics.js";
import { recordDiag, summarizeDiags } from "./diag.js";
import { proposeFromMetrics, buildReport, overlayFromProposals, readMinerFindings, minerToProposals } from "./optimize.js";
import { resolveToolConfig } from "./kits.js";
import { fnv1a, stableStringify } from "./ids.js";
import type { Kernel, AdvanceStop, GateRequest } from "./kernel.js";
import { KernelError } from "./kernel-base.js";

/** 世界书 graph.json（worldbook-graph@1，tools/worldbook-index.py 产物）的词条/边最小形状。 */
interface WbEntry {
  id: string;
  cat: string;
  title: string;
  status?: string;
  version?: string;
  tags?: string[];
  links?: string[];
  summary?: string;
  path: string;
  mtime?: string;
}
interface WbRel {
  a: string;
  b: string;
  src: string;
  weight: number;
}

/**
 * 轻量稳定指纹（djb2）——只用于「变没变」的判定，**不是**安全哈希。
 * 页面轮询靠它决定要不要重新渲染，所以必须对同样的输入给出同样的值（键序确定：调用方自己拼数组）。
 */
function fingerprint(parts: unknown[]): string {
  const s = JSON.stringify(parts);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}


export function viewProjects(kernel: Kernel) {
    const projectsDir = path.join(kernel.root, "projects");
    if (!fs.existsSync(projectsDir)) return [];
    const out: Array<Record<string, unknown>> = [];
    for (const d of fs.readdirSync(projectsDir).sort()) {
      const dir = kernel.projectDir(d);
      if (!fs.statSync(dir).isFile?.() && !fs.statSync(dir).isDirectory()) continue;
      const state = loadState(dir);
      const legacy = state ? undefined : (() => {
        try { return JSON.parse(fs.readFileSync(legacyStatePath(dir), "utf-8")); } catch { return undefined; }
      })();
      const raw: RunState | undefined = state ?? legacy;
      const nodes = raw?.nodes ?? {};
      const order = raw?.plan?.order ?? Object.keys(nodes);
      const pending = order.filter((id) => (nodes[id]?.status ?? "none") !== "done");
      const focus = order.find((id) => (nodes[id]?.status ?? "none") !== "done") ?? null;
      out.push({
        projectId: d,
        flowId: raw?.flowId ?? null,
        status: raw?.status ?? "none",
        focus: state ? focus : focus,
        gateAwaiting: raw?.gate?.verdict === "awaiting",
        pendingCount: pending.length,
        migrated: Boolean(state),
      });
    }
    return out;
  }


export function viewArtifacts(kernel: Kernel, projectId: string, opts: { node?: string; latest?: boolean }) {
    return listArtifacts(kernel.projectDir(projectId), opts);
  }


export function viewArtifactContent(kernel: Kernel, projectId: string, relPath: string): string | undefined {
    return readRegisteredText(kernel.projectDir(projectId), relPath);
  }


export function viewJournal(kernel: Kernel, projectId: string, q: { since?: string; limit?: number; node?: string }) {
    return journalQuery(kernel.projectDir(projectId), q);
  }


export function viewSnapshots(kernel: Kernel, projectId: string, node: string) {
    return readSnapshots(kernel.projectDir(projectId), node);
  }

  /** 初始化配置读取：无文件时返回模板（前端表单直接绑定中键字段）。 */

export function viewLive(kernel: Kernel, projectId: string, opts: { files?: boolean } = {}) {
    const projectDir = kernel.projectDir(projectId);
    const readJson = (rel: string): unknown => {
      try {
        return JSON.parse(fs.readFileSync(path.join(projectDir, rel), "utf-8"));
      } catch {
        return null;
      }
    };
    const state = loadState(projectDir) ?? readJson("run-state.json");
    const eff = readJson(path.join("registry", "effective.json")) as { overlayHash?: string; planHash?: string } | null;
    const overlay = readJson(path.join("registry", "overlay.json"));
    const optimize = readJson(path.join("registry", "optimize.json"));
    const metrics = readJson(path.join("registry", "metrics-summary.json"));
    const diagnostics = summarizeDiags(projectDir);
    // R8 选择面：决策事实是运行中数据，随 live 切片现读现回（坏条目进 issues，不静默）
    const decisions = listDecisions(projectDir);

    const s = state as { status?: string; gate?: { verdict?: string; node?: string }; nodes?: Record<string, { status?: string; round?: number; verdict?: string }> } | null;

    // OS-04 余量：模板清单**每次现算**并入 live 切片——模板库是用户随时会增删的东西，
    // 靠「上次 flow_effect 落盘的读模型」会立刻过期（面板会显示上一个版本的模板列表，那是撒谎）。
    const stateFlowId = (state as { flowId?: string } | null)?.flowId;
    let configTemplates: { entries: unknown[]; skipped: string[] } | null = null;
    if (stateFlowId) {
      try {
        const { entries, skipped } = listConfigTemplates({ dataRoot: kernel.root, repoRoot: kernel.repoRoot, flowId: stateFlowId });
        configTemplates = { entries, skipped };
      } catch {
        configTemplates = null; // 扫描失败 ⇒ 面板显式降级，不编造一份空清单
      }
    }
    const tplFingerprint = (configTemplates?.entries ?? []).map((e) => {
      const x = e as { name?: string; source?: string; updatedAt?: string };
      return [x.name ?? null, x.source ?? null, x.updatedAt ?? null];
    });

    const revision = fingerprint([
      s?.status ?? null,
      s?.gate?.verdict ?? null,
      s?.gate?.node ?? null,
      Object.entries(s?.nodes ?? {}).map(([k, v]) => [k, v.status ?? null, v.round ?? 0, v.verdict ?? null]),
      eff?.overlayHash ?? null,
      eff?.planHash ?? null,
      (metrics as { events?: number } | null)?.events ?? null,
      diagnostics.count,
      decisions.decisions.map((d) => [d.key, d.picked, d.by, d.at]),
      tplFingerprint,
    ]);

    // 产物指纹：只取「路径 + 大小 + mtime」，不读正文——重活留给 files=true 那一次
    const artifacts = listArtifacts(projectDir, { latest: true });
    const filesRevision = fingerprint(
      artifacts.map((a) => {
        try {
          const st = fs.statSync(path.join(projectDir, a.path));
          return [a.path, st.size, Math.round(st.mtimeMs)];
        } catch {
          return [a.path, -1, -1];
        }
      }),
    );

    const base = {
      project: projectId,
      state,
      eff,
      overlay,
      optimize,
      metrics,
      diagnostics,
      decisions,
      configTemplates,
      revision,
      filesRevision,
    };
    if (!opts.files) return base;

    const wb = kernel.viewWorkbenchPayload(projectId);
    // 文件柜卡片「备注修改时间」：与 wb.files 同键空间 stat 一轮。生成器注入的 DATA.mtimes
    // 只覆盖生成时刻——live 刷新若不带时间，新产物卡片会开天窗。格式对齐生成器 MM-DD HH:MM。
    const mtimes: Record<string, string> = {};
    const two = (n: number) => String(n).padStart(2, "0");
    for (const rel of Object.keys(wb.files)) {
      try {
        const d = new Date(fs.statSync(path.join(projectDir, rel)).mtimeMs);
        mtimes[rel] = `${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
      } catch { /* stat 失败该文件不显时间，卡片降级 */ }
    }
    return { ...base, files: wb.files, snapshots: wb.snapshots, mtimes };
  }

  /** GraphHyperRAG 世界书词条（graph.json 条目形状的最小子集）。 */

export function loadWorldbookGraph(kernel: Kernel, projectId: string): { entries: WbEntry[]; relations: WbRel[]; built_at?: string } {
    const file = path.join(kernel.projectDir(projectId), "世界书", "graph.json");
    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(file, "utf-8"));
    } catch {
      throw new KernelError(
        "NO_WORLDBOOK",
        404,
        `项目 ${projectId} 无世界书图索引（世界书/graph.json）——` +
          `python tools/worldbook_index.py --root projects/${projectId} 重建（world-forge 节点交卷即自带）`,
      );
    }
    const g = raw as { entries?: WbEntry[]; relations?: WbRel[]; built_at?: string };
    return { entries: g.entries ?? [], relations: g.relations ?? [], built_at: g.built_at };
  }

  /**
   * GraphHyperRAG 世界书检索（创作时 agent 直调；CLI/HTTP/MCP 三面同源）。
   * 打分：标题等值 > 标题含串 > tag 命中 > 摘要命中 > CJK 双字分片局部命中；
   * 扩展：命中词条沿关系边走一跳（weight 降序取前 3）——写手据此拉齐设定口径，不靠记忆硬编。
   */

export function worldbookSearch(kernel: Kernel, projectId: string, opts: { q: string; cat?: string; k?: number }) {
    const q = (opts.q ?? "").trim();
    if (!q) throw new KernelError("INVALID_INPUT", 400, "worldbook_search 缺查询词 q");
    const k = Math.min(Math.max(opts.k ?? 6, 1), 30);
    const { entries, relations, built_at } = loadWorldbookGraph(kernel, projectId);
    const byId = new Map(entries.map((e) => [e.id, e]));
    const pool = opts.cat ? entries.filter((e) => e.cat === opts.cat) : entries;
    const terms = q.toLowerCase().split(/[\s,，、;；/]+/).filter(Boolean);
    const bigrams = (s: string): string[] => {
      const t = [...s.toLowerCase()];
      return t.length < 2 ? [s.toLowerCase()] : t.slice(0, -1).map((_, i) => (t[i] ?? "") + (t[i + 1] ?? ""));
    };
    const score = (e: WbEntry): number => {
      let s = 0;
      const title = e.title.toLowerCase();
      for (const t of terms) {
        if (title === t) s += 20;
        else if (title.includes(t)) s += 12;
        if ((e.tags ?? []).some((x) => x.toLowerCase().includes(t))) s += 6;
        if ((e.summary ?? "").toLowerCase().includes(t)) s += 4;
        const bg = bigrams(t);
        s += Math.min(4, bg.filter((b) => title.includes(b)).length);
      }
      return s;
    };
    const hits = pool
      .map((e) => ({ e, s: score(e) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || a.e.id.localeCompare(b.e.id, "zh"))
      .slice(0, k);
    // 一跳关系扩展：weight 降序的邻边，命中集之外取前 3
    const hitIds = new Set(hits.map((x) => x.e.id));
    const adj = new Map<string, { with: string; weight: number; src: string }[]>();
    for (const r of relations) {
      if (byId.has(r.a) && byId.has(r.b)) {
        (adj.get(r.a) ?? adj.set(r.a, []).get(r.a)!).push({ with: r.b, weight: r.weight, src: r.src });
        (adj.get(r.b) ?? adj.set(r.b, []).get(r.b)!).push({ with: r.a, weight: r.weight, src: r.src });
      }
    }
    const expansion: { id: string; title: string; cat: string; via: string; weight: number; from: string }[] = [];
    for (const x of hits) {
      for (const nb of (adj.get(x.e.id) ?? []).sort((a, b) => b.weight - a.weight).slice(0, 3)) {
        if (hitIds.has(nb.with)) continue;
        hitIds.add(nb.with);
        const t = byId.get(nb.with)!;
        expansion.push({ id: t.id, title: t.title, cat: t.cat, via: nb.with, weight: nb.weight, from: x.e.id });
      }
    }
    return {
      query: q,
      cat: opts.cat,
      graph: { format: "worldbook-graph@1", built_at, entries: entries.length, relations: relations.length },
      hits: hits.map((x) => ({
        id: x.e.id, title: x.e.title, cat: x.e.cat, status: x.e.status, path: x.e.path,
        summary: x.e.summary, score: x.s,
        relations: (adj.get(x.e.id) ?? []).sort((a, b) => b.weight - a.weight).slice(0, 5)
          .map((r) => ({ with: r.with, title: byId.get(r.with)?.title ?? r.with, weight: r.weight, src: r.src })),
      })),
      expansion: expansion.slice(0, k),
    };
  }

  /** 兼容桥：旧 workflow.html 的 DATA payload 同构形状。 */

export function viewWorkbenchPayload(kernel: Kernel, projectId: string) {
    const projectDir = kernel.projectDir(projectId);
    const state = loadState(projectDir);
    let flowId: string | undefined = state?.flowId;
    if (!flowId) {
      // 旧 run-state 项目：按 whereami 同款重叠度匹配
      for (const d of fs.existsSync(kernel.flowsDir) ? fs.readdirSync(kernel.flowsDir) : []) {
        try {
          const f = kernel.loadFlow(d);
          // flow@3 的原始描述符没有 graph（节点由 modules 派生）⇒ 用 modules 长度兜底。
          // 不作兜底的话这里会**静默跳过全部 flow@3**，落到"没有 flow"——又一处「以为有，其实没有」。
          const g = (f as unknown as { graph?: { nodes?: Record<string, unknown> } }).graph;
          const m = (f as unknown as { modules?: unknown[] }).modules;
          const count = g?.nodes ? Object.keys(g.nodes).length : (m?.length ?? 0);
          if (count) { flowId = d; break; }
        } catch { /* skip */ }
      }
    }
    const flow = flowId ? kernel.loadFlow(flowId) : undefined;
    const files: Record<string, string> = {};
    let total = 0;
    const wanted = new Set<string>(
      (flow?.outputs ?? []).map((o) => (flow ? outputPathOf(flow, o) : undefined)).filter((p): p is string => !!p),
    );
    for (const a of listArtifacts(projectDir, { latest: true })) wanted.add(a.path); // 注册产物并入（旧页面 extra+glob 语义）
    for (const rel of wanted) {
      const abs = path.join(projectDir, rel);
      if (!fs.existsSync(abs)) continue;
      if (fs.statSync(abs).size > 512 * 1024) continue;
      files[rel] = fs.readFileSync(abs, "utf-8");
      total += files[rel].length;
      if (total > 2_000_000) break;
    }
    const snapshots: Record<string, unknown[]> = {};
    // 节点集：flow@2 走原始 graph；flow@3 原始描述符没有 graph ⇒ 补上内核落盘的 effective@2 节点。
    // （此前直接读 `flow?.graph.nodes`：flow@3 项目一进本函数就 500 —— 已实测 p-wxl-001。）
    const effRaw = (() => {
      try {
        return JSON.parse(fs.readFileSync(path.join(projectDir, "registry", "effective.json"), "utf-8")) as { nodes?: Record<string, unknown> };
      } catch {
        return null;
      }
    })();
    const gRaw = (flow as unknown as { graph?: { nodes?: Record<string, unknown> } } | undefined)?.graph;
    const snapshotNodes = new Set<string>([
      ...Object.keys(gRaw?.nodes ?? {}),
      ...Object.keys(effRaw?.nodes ?? {}),
    ]);
    for (const nodeId of snapshotNodes) {
      const snaps = readSnapshots(projectDir, nodeId);
      if (snaps.length) snapshots[nodeId] = snaps;
    }
    return {
      flow,
      files,
      runstate: state ?? (() => { try { return JSON.parse(fs.readFileSync(legacyStatePath(projectDir), "utf-8")); } catch { return {}; } })(),
      project: projectId,
      snapshots,
      // R8-OPS：旁路失败的可见面。页面据此显示「本项目有 N 条诊断」——能力必须有家的第③环（UI 可见）。
      diagnostics: summarizeDiags(projectDir),
      // R8 选择面：决策三问（选了哪个/凭什么/排除了啥）的 UI 可见环
      decisions: listDecisions(projectDir),
    };
  }

  /**
   * 诊断通道只读面（R8-OPS）：旁路失败汇总。
   * `projectId` 缺省 = 仓库级（知识库索引/台账类失败记在 `<root>/registry/diagnostics.jsonl`）。
   */

export function viewDiagnostics(kernel: Kernel, projectId?: string) {
    if (!projectId) return { scope: "repo" as const, dir: kernel.repoRoot, ...summarizeDiags(kernel.repoRoot, 20) };
    const projectDir = kernel.projectDir(projectId);
    return { scope: "project" as const, projectId, dir: projectDir, ...summarizeDiags(projectDir, 20) };
  }
