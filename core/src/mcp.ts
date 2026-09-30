// miniflow MCP 面：**动词表派生的 tools** + **故事上下文派生的 resources / prompts**（stdio transport）。
// 交付不自动注册进宿主。
//
// R8-OPS 步骤 3：此前这里是 7 个手写 `registerTool`（list/run/next/submit/resume/gate/rerun），
// 与 CLI 的 13 个动词不同步 ⇒ `flow_init`（初始化面板的落点）/`flow_effect`/`flow_mine`/
// `skill_patch`/`flow_optimize`/`flow_overlay` 在 MCP 面上**根本不存在**。
// 现在改为逐条遍历 `VERBS` —— 新增动词只改 `verbs.ts` 一处，MCP 自动跟上。
//
// R4（工单 20261001）：只有 verbs 的 MCP 面等于「客户端每次都要把上下文重新塞进参数」。
// 现在补四类只读资源（世界书图/词条/运行态/产物正文）与两个提示模板（世界书体检/裁决辅助），
// 让宿主能「看见故事」而不是只「命令内核」。资源与提示的**清单本身**也派生自本文件的
// `MCP_RESOURCES` / `MCP_PROMPTS`，测试直接对着两张表断言——不在别处抄第二份名单。
import { z } from "zod";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { Kernel } from "./kernel.js";
import { ROOT } from "./schema.js";
import { VERBS, verbToolSpecs, zodOf } from "./verbs.js";
import { loadWorldbookGraph } from "./kernel-view.js";
import { contentTypeOf } from "./static.js";
import { nodeFs, nodePath } from "./abstraction/adapters/node.js";

// 形状派生点已上移到 `verbs.ts`（R4：HTTP 前置校验与 OpenAPI 生成要同一份，不能反向依赖 MCP）。
// 这里保留旧 import 面，`core/test/r8-*.test.ts` 的既有引用不因此断裂。
export { verbToolSpecs, zodOf };

const json = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, null, 2) }] });

/**
 * BETA 期 MCP 面动词调用留痕：与 `core/src/cli.ts` 写同一处 `trace/cli.jsonl`（同形状 + `via:"mcp"`）。
 * 为什么要写：内核动作自 A#23 起改走 MCP 面，而留痕原来只在 CLI 出口——
 * 走 MCP 的一轮在台账上等于"什么都没干"，`tools/method-brief.mjs` 的工具账会整体瞎掉。
 * 旁路纪律照旧：BETA 不在位就什么都不写；写失败静默，绝不影响动词返回（长参数截断，别把正文灌进台账）。
 */
function traceMcp(verb: string, args: Record<string, unknown>, ms: number, exit: number): void {
  try {
    if (!nodeFs.exists(nodePath.join(ROOT, "BETA"))) return;
    const argv = [verb];
    for (const [k, v] of Object.entries(args ?? {})) {
      if (v === undefined || v === null || v === false) continue;
      argv.push(`--${k}`, (typeof v === "string" ? v : JSON.stringify(v)).slice(0, 120));
    }
    const dir = nodePath.join(ROOT, "trace");
    nodeFs.mkdir(dir, { recursive: true });
    nodeFs.appendText(
      nodePath.join(dir, "cli.jsonl"),
      JSON.stringify({
        ts: new Date().toISOString(),
        verb,
        argv,
        project: typeof args?.project === "string" ? args.project : null,
        exit,
        ms,
        via: "mcp",
      }) + "\n",
    );
  } catch {
    /* 旁路 */
  }
}

// ── R4 · 资源面（只读）────────────────────────────────────────────────

/** 单次回显的条目上限：超限不静默裁，`truncated` 如实标注（客户端知道自己在看几分之几）。 */
const LIST_CAP = 300;

export interface McpResourceSpec {
  name: string;
  /**
   * URI 模板。工单卡面上写的是 `wb://graph` 这类**前缀名**，但资源必须按项目寻址
   * （世界书/运行态/产物全是项目级数据），故落地为带变量的模板：`wb://{project}/graph`。
   * 变量值按 `encodeURIComponent` 进出——项目 id 允许含中文（`deriveProjectName` 由灵感提炼）。
   */
  uriTemplate: string;
  variables: string[];
  title: string;
  description: string;
  mimeType: string;
}

/** 资源清单（单一事实源：注册、文档、测试都读这张表）。 */
export const MCP_RESOURCES: McpResourceSpec[] = [
  {
    name: "wb-graph",
    uriTemplate: "wb://{project}/graph",
    variables: ["project"],
    title: "世界书归纳图",
    description:
      "项目世界书全图（worldbook-graph@1）：词条 id/cat/title/tags/summary/path + 关系边 a/b/weight/src。" +
      "事实源 = <项目>/世界书/graph.json（python tools/worldbook_index.py 重建）。",
    mimeType: "application/json",
  },
  {
    name: "wb-entry",
    uriTemplate: "wb://{project}/entry/{id}",
    variables: ["project", "id"],
    title: "世界书单词条",
    description: "单个词条正文卡片 + 其全部一跳关系（含对端标题与证据来源 src）。id 取自 wb://{project}/graph。",
    mimeType: "application/json",
  },
  {
    name: "flow-state",
    uriTemplate: "flow://{project}/state",
    variables: ["project"],
    title: "运行态切片",
    description:
      "项目实时运行态：state ⊕ 编排指纹（overlayHash/planHash）⊕ overlay ⊕ 指标汇总 ⊕ 旁路诊断 ⊕ 决策面 + revision 指纹。" +
      "与面板轮询的 /api/projects/<id>/live 同源同形（不含产物正文）。",
    mimeType: "application/json",
  },
  {
    name: "artifact-content",
    uriTemplate: "artifact://{project}/{+path}",
    variables: ["project", "path"],
    title: "已登记产物正文",
    description:
      "产物正文原文。**只读已登记的产物**（registry/artifacts.json）——未注册 = 不可读，与 HTTP 面同一判定，" +
      "因此路径穿越天然无效（登记表里没有的就是读不到）。",
    mimeType: "text/plain",
  },
];

export interface McpPromptSpec {
  name: string;
  title: string;
  description: string;
  args: { name: string; required: boolean; desc: string }[];
}

/** 提示模板清单（同样只读盘面事实，内核不做任何 LLM 判断）。 */
export const MCP_PROMPTS: McpPromptSpec[] = [
  {
    name: "review-worldbook",
    title: "世界书体检",
    description:
      "把项目世界书的结构事实摆成一份可评审的简报：分类分布、孤儿词条、缺摘要词条，" +
      "给了 q 再附 GraphHyperRAG 命中与一跳扩展。语义判断（设定是否自洽、谁该合并）归评审者。",
    args: [
      { name: "project", required: true, desc: "项目 id" },
      { name: "q", required: false, desc: "查询词（给了就附检索命中；多词空格分隔）" },
      { name: "cat", required: false, desc: "限定分类（人物/设定/势力/场景/道具/伏笔/底牌…）" },
      { name: "k", required: false, desc: "命中条数上限（默认 6）" },
    ],
  },
  {
    name: "gate-assist",
    title: "裁决辅助",
    description:
      "裁一个门前的一次性材料盘：门悬置多久、被裁节点声明、本轮已登记产物与确定性完整性结果、旁路诊断、" +
      "四种裁决各自的后果与凭据（token/round）。只摆事实，不构成裁决（人工裁决只在 kit 边界）。",
    args: [
      { name: "project", required: true, desc: "项目 id" },
      { name: "node", required: false, desc: "门节点 id（缺省 = state.gate.node 当前悬置的门）" },
    ],
  },
];

const encVar = (v: string): string => encodeURIComponent(v);
/** URI 模板匹配回来的变量是**百分号编码**的（SDK 不解码），统一在这里解一次。 */
const decVar = (v: string | string[] | undefined): string => {
  const raw = Array.isArray(v) ? v.join("/") : (v ?? "");
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw; // 非法转义序列：原样交出，让「读不到」成为可见事实，不静默改字
  }
};

/** 内核错误（无世界书/无 run/坏 flow…）一律折成 JSON-RPC 应用错误，不把堆栈崩了服务端。 */
function asMcpError<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof McpError) throw e;
    throw new McpError(ErrorCode.InvalidParams, e instanceof Error ? e.message : String(e));
  }
}

const jsonContents = (uri: string, data: unknown) => ({
  contents: [{ uri, mimeType: "application/json", text: JSON.stringify(data, null, 2) }],
});

/** 项目 id 清单：`projects/` 下的一级目录。`_` 前缀是仓库级容器（`_archived`），不是项目。 */
function projectIds(kernel: Kernel): string[] {
  const dir = kernel.path.join(kernel.root, "projects");
  if (!kernel.fs.exists(dir)) return [];
  return kernel.fs.readDir(dir).filter((d) => !d.startsWith("_")).sort();
}

/** 词条 id → 词条本体（找不到返回 undefined，由调用方决定怎么报错）。 */
function wbEntry(kernel: Kernel, project: string, id: string) {
  const g = loadWorldbookGraph(kernel, project);
  const entry = g.entries.find((e) => e.id === id);
  return { g, entry };
}

function registerResources(server: McpServer, kernel: Kernel): void {
  const spec = (name: string): McpResourceSpec => MCP_RESOURCES.find((r) => r.name === name)!;

  // ① 世界书全图
  server.registerResource(
    "wb-graph",
    new ResourceTemplate(spec("wb-graph").uriTemplate, {
      list: () => ({
        resources: projectIds(kernel).map((id) => ({
          uri: `wb://${encVar(id)}/graph`,
          name: `世界书图 · ${id}`,
          mimeType: "application/json",
        })),
      }),
    }),
    { title: spec("wb-graph").title, description: spec("wb-graph").description, mimeType: "application/json" },
    (uri, vars) =>
      asMcpError(() => {
        const project = decVar(vars.project);
        const g = loadWorldbookGraph(kernel, project);
        const entries = g.entries.slice(0, LIST_CAP);
        const relations = g.relations.slice(0, LIST_CAP);
        return jsonContents(uri.href, {
          project,
          format: "worldbook-graph@1",
          built_at: g.built_at ?? null,
          counts: { entries: g.entries.length, relations: g.relations.length },
          truncated: { entries: g.entries.length > entries.length, relations: g.relations.length > relations.length },
          entries,
          relations,
        });
      }),
  );

  // ② 世界书单词条 + 其一跳关系
  server.registerResource(
    "wb-entry",
    new ResourceTemplate(spec("wb-entry").uriTemplate, {
      list: () => {
        const resources: { uri: string; name: string; mimeType: string }[] = [];
        for (const project of projectIds(kernel)) {
          let g: { entries: { id: string; title: string; cat: string }[] };
          try {
            g = loadWorldbookGraph(kernel, project);
          } catch {
            continue; // 没有世界书的项目不占资源位（不是错误，是事实）
          }
          for (const e of g.entries) {
            if (resources.length >= LIST_CAP) break;
            resources.push({
              uri: `wb://${encVar(project)}/entry/${encVar(e.id)}`,
              name: `${e.cat} · ${e.title}`,
              mimeType: "application/json",
            });
          }
          if (resources.length >= LIST_CAP) break;
        }
        return { resources };
      },
    }),
    { title: spec("wb-entry").title, description: spec("wb-entry").description, mimeType: "application/json" },
    (uri, vars) =>
      asMcpError(() => {
        const project = decVar(vars.project);
        const id = decVar(vars.id);
        const { g, entry } = wbEntry(kernel, project, id);
        if (!entry) {
          throw new McpError(
            ErrorCode.InvalidParams,
            `世界书无词条 ${id}（项目 ${project} 共 ${g.entries.length} 条，可读 wb://${encVar(project)}/graph 取清单）`,
          );
        }
        const relations = g.relations
          .filter((r) => r.a === id || r.b === id)
          .map((r) => {
            const other = r.a === id ? r.b : r.a;
            return { with: other, with_title: g.entries.find((e) => e.id === other)?.title ?? other, weight: r.weight, src: r.src };
          })
          .sort((a, b) => b.weight - a.weight);
        return jsonContents(uri.href, { project, entry, relations });
      }),
  );

  // ③ 运行态切片
  server.registerResource(
    "flow-state",
    new ResourceTemplate(spec("flow-state").uriTemplate, {
      list: () => ({
        resources: projectIds(kernel).map((id) => ({
          uri: `flow://${encVar(id)}/state`,
          name: `运行态 · ${id}`,
          mimeType: "application/json",
        })),
      }),
    }),
    { title: spec("flow-state").title, description: spec("flow-state").description, mimeType: "application/json" },
    (uri, vars) =>
      asMcpError(() => {
        const project = decVar(vars.project);
        return jsonContents(uri.href, kernel.viewLive(project));
      }),
  );

  // ④ 已登记产物正文
  server.registerResource(
    "artifact-content",
    new ResourceTemplate(spec("artifact-content").uriTemplate, {
      list: () => {
        const resources: { uri: string; name: string; mimeType: string }[] = [];
        for (const project of projectIds(kernel)) {
          for (const a of kernel.viewArtifacts(project, { latest: true })) {
            if (resources.length >= LIST_CAP) break;
            const rel = String((a as { path?: string }).path ?? "");
            if (!rel) continue;
            resources.push({
              uri: `artifact://${encVar(project)}/${rel.split("/").map(encVar).join("/")}`,
              name: `${project} · ${rel}`,
              mimeType: contentTypeOf(rel, kernel.path),
            });
          }
          if (resources.length >= LIST_CAP) break;
        }
        return { resources };
      },
    }),
    { title: spec("artifact-content").title, description: spec("artifact-content").description, mimeType: "text/plain" },
    (uri, vars) =>
      asMcpError(() => {
        const project = decVar(vars.project);
        // `{+path}` 保留分隔符，匹配回来的是一整串（各段仍带百分号编码）；整串解码即可——
        // 登记表里的键是纯相对路径，不含需要原样保留的 %2F。
        const rel = decVar(vars.path);
        const text = kernel.viewArtifactContent(project, rel);
        if (text === undefined) {
          throw new McpError(
            ErrorCode.InvalidParams,
            `未注册产物不可读：${project}/${rel}（未注册=不存在；清单见 artifact://${encVar(project)}/ 的 resources/list）`,
          );
        }
        return { contents: [{ uri: uri.href, mimeType: contentTypeOf(rel, kernel.path), text }] };
      }),
  );
}

// ── R4 · 提示模板面 ────────────────────────────────────────────────────

/**
 * 世界书体检简报：全部是盘面可数事实（分类分布 / 孤儿 / 缺摘要 / 检索命中），
 * 语义判断留给评审者——内核不评价「设定好不好」。
 */
export function worldbookReviewBrief(
  kernel: Kernel,
  opts: { project: string; q?: string; cat?: string; k?: number },
): string {
  const g = loadWorldbookGraph(kernel, opts.project);
  const linked = new Set<string>();
  for (const r of g.relations) {
    linked.add(r.a);
    linked.add(r.b);
  }
  const orphans = g.entries.filter((e) => !linked.has(e.id));
  const noSummary = g.entries.filter((e) => !(e.summary ?? "").trim());
  const byCat = new Map<string, number>();
  for (const e of g.entries) byCat.set(e.cat, (byCat.get(e.cat) ?? 0) + 1);
  const cats = [...byCat.entries()].sort((a, b) => b[1] - a[1]);
  const show = (list: { id: string; title: string; cat: string }[], n = 20): string =>
    list.slice(0, n).map((e) => `  - ${e.id}（${e.cat}）${e.title}`).join("\n") || "  （无）";

  const lines: string[] = [
    `# 世界书体检 · ${opts.project}`,
    `图索引 worldbook-graph@1，built_at=${g.built_at ?? "未记录"}；词条 ${g.entries.length}，关系边 ${g.relations.length}。`,
    "",
    "## 分类分布",
    ...cats.map(([c, n]) => `  ${c}：${n}`),
    "",
    `## 孤儿词条（图中无任何关系边）${orphans.length} 条`,
    show(orphans),
    "",
    `## 缺摘要词条（检索打分吃不到 summary）${noSummary.length} 条`,
    show(noSummary),
  ];

  if (opts.q) {
    const hit = kernel.worldbookSearch(opts.project, { q: opts.q, cat: opts.cat, k: opts.k });
    lines.push("", `## 检索「${opts.q}」${opts.cat ? `（限定 ${opts.cat}）` : ""}命中 ${hit.hits.length} 条`);
    for (const h of hit.hits) {
      lines.push(`  - ${h.id}（${h.cat}）${h.title} · 分 ${h.score} · ${h.summary ?? "（无摘要）"}`);
    }
    if (hit.expansion.length) {
      lines.push(`  一跳扩展 ${hit.expansion.length} 条：`);
      for (const x of hit.expansion) lines.push(`    · ${x.id}（${x.cat}）${x.title} ← ${x.from}（weight=${x.weight}）`);
    }
  }

  lines.push(
    "",
    "## 口径",
    "  以上全是 graph.json 的可数事实；设定是否自洽、谁该合并、哪条是伏笔没埋，归评审者判断。",
    "  重建归纳层：python tools/worldbook_index.py --root projects/<id>（world-forge 节点交卷即自带）。",
    "  正文按需读资源 wb://{project}/graph 与 wb://{project}/entry/{id}。",
  );
  return lines.join("\n");
}

/**
 * 裁决辅助简报：材料盘 + 后果说明 + 凭据提醒。
 * 刻意**不下结论**（铁律 6：人工裁决只在 kit 边界，且人是唯一裁决者），
 * 也不给「过/不过」的数值线（阈值清剿口径：数值只记账，不构成打回闸）。
 */
export function gateAssistBrief(kernel: Kernel, opts: { project: string; node?: string }): string {
  const live = kernel.viewLive(opts.project) as {
    state: {
      flowId?: string;
      preset?: string;
      status?: string;
      gate?: { verdict?: string; node?: string; at?: string; round?: number; token?: string; note?: string };
      nodes?: Record<string, { status?: string; round?: number; verdict?: string; stale?: boolean }>;
      policy?: { gate_mode?: string };
    } | null;
    diagnostics?: { count?: number };
    decisions?: { decisions?: unknown[] };
    revision?: string;
  };
  const state = live.state;
  if (!state) {
    return [
      `# 裁决辅助 · ${opts.project}`,
      "",
      "项目未开跑（无 state.json）。先 flow_run（或 flow_list 看可用 flow）——没有运行态就没有可裁的门。",
    ].join("\n");
  }

  const gate = state.gate ?? {};
  const nodeId = opts.node ?? gate.node ?? "";
  const lines: string[] = [`# 裁决辅助 · ${opts.project} · ${nodeId || "（无门）"}`, ""];

  if (gate.verdict === "awaiting") {
    const hours = gate.at ? (Date.now() - Date.parse(gate.at)) / 3_600_000 : NaN;
    lines.push(
      ...[
        `## 当前悬置门`,
        `  ${gate.node}（第 ${String(gate.round)} 轮，open ${gate.at ?? "未记录"}${Number.isFinite(hours) ? `，已 ${hours.toFixed(1)} 小时` : ""}）`,
        `  凭据：token=${gate.token ?? "（无）"} round=${String(gate.round)} —— 裁决必须原样带回，陈旧轮次会被 STALE_GATE 拒。`,
        gate.note ? `  悬置说明：${gate.note}` : "",
        opts.node && opts.node !== gate.node ? `  注意：你指定的 ${opts.node} 不是当前悬置的门（当前 = ${gate.node}），以下按你指定的节点摆材料。` : "",
        "",
      ].filter(Boolean),
    );
  } else {
    lines.push(`## 门状态`, `  state.gate = ${String(gate.verdict ?? "无")}@${gate.node ?? "-"}（非 awaiting——材料照摆，但此刻没有等人裁的门）`, "");
  }

  const flow = asBrief(() => kernel.loadFlow(state.flowId ?? ""));
  const eff = flow ? asBrief(() => kernel.effectiveOf(kernel.projectDir(opts.project), flow, state.preset)) : null;
  const node = (eff?.flow.graph.nodes ?? {})[nodeId] as
    | { kind?: string; gate_role?: string; title?: string; module?: string; kit?: string; op?: string; output?: string; skill?: string }
    | undefined;
  lines.push(`## 被裁节点声明（生效编排 = flow ⊕ overlay ⊕ 边界派生）`);
  if (!node) {
    lines.push(`  生效编排里没有 ${nodeId || "（未给节点）"}——请核对 flow=${state.flowId} 与项目 overlay。`);
  } else {
    lines.push(
      ...[
        `  ${node.title ?? nodeId} · kind=${node.kind ?? "-"} gate_role=${node.gate_role ?? "-"} 模块=${node.module ?? node.kit ?? "-"}`,
        node.op ? `  执行体：${node.kit ?? "?"}.${node.op}` : "",
        node.skill ? `  评审技能：${node.skill}` : "",
        node.output ? `  本步产物：${node.output}` : "",
      ].filter(Boolean),
    );
  }
  lines.push("");

  const arts = kernel.viewArtifacts(opts.project, { latest: true }) as { path?: string; node?: string; validations?: { name: string; status: string }[] }[];
  const own = arts.filter((a) => !!nodeId && a.node === nodeId);
  lines.push(`## 已登记产物（最新一版 ${arts.length} 件，正文读 artifact://${encodeURIComponent(opts.project)}/<path>）`);
  if (!arts.length) {
    lines.push(`  （本项目还没有登记产物——评审步的产物就是材料，现在裁 = 裁空气）`);
  } else if (!own.length) {
    lines.push(`  （门 ${nodeId || "-"} 自身没有登记产物；以下按 node → 路径列全量，逐项对照后再裁）`);
  }
  for (const a of arts.slice(0, 20)) {
    const v = a.validations ?? [];
    const bad = v.filter((x) => x.status !== "pass");
    lines.push(`  - ${a.node ?? "?"} → ${a.path} · 完整性检查 ${v.length} 项${bad.length ? `，其中非 pass ${bad.length} 项：${bad.map((x) => `${x.name}(${x.status})`).join("、")}` : " 全过"}`);
  }
  if (arts.length > 20) lines.push(`  …另有 ${arts.length - 20} 件（完整清单见 resources/list 里的 artifact:// 项）`);
  lines.push("");

  const diagCount = live.diagnostics?.count ?? 0;
  lines.push(`## 旁路诊断`, `  count=${diagCount}${diagCount > 0 ? " —— 有旁路失败，本项目某些结论的证据链可能不完整，裁决前先读 /api/projects/" + opts.project + "/diagnostics" : "（无）"}`, "");

  lines.push(`## 裁决后果（flow_gate 的真实语义，不是建议）`);
  if (node?.gate_role === "link") {
    lines.push(`  连接件只接受两值：pass / pass-with-conditions ⇒ 放行进入本模块；send-back / reject ⇒ 重跑整个上游模块（累计达 policy.maxRounds 即停机等人）。`);
  } else {
    lines.push(
      `  pass / pass-with-conditions ⇒ 节点 done、继续推进；`,
      `  send-back ⇒ 回本阶段入口定点重做，失效范围限本阶段（跨阶段返工要 force=true + rootCauseStage，那是人工强行介入，不是门语义）；`,
      `  reject ⇒ state.status = failed，run 终止。`,
    );
  }
  if (state.policy?.gate_mode === "manual") lines.push(`  本项目 policy.gate_mode = manual（显式退回手动门）。`);
  lines.push(
    "",
    "## 口径",
    `  运行态指纹 revision=${live.revision ?? "-"}（材料盘随盘面变；决策面 ${(live.decisions?.decisions ?? []).length} 条）。`,
    "  本简报只摆事实与后果，不构成裁决：语义判决归评审者对照 knowledge/rules/ 语料卡，数值证据只记账不打回。",
  );
  return lines.join("\n");
}

/** gateAssistBrief 里的「读不到就降级成一行说明」——prompt 正文不该因为一个坏 flow 整体抛错。 */
function asBrief<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

function promptShape(spec: McpPromptSpec): Record<string, z.ZodTypeAny> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const a of spec.args) {
    shape[a.name] = a.required ? z.string().describe(a.desc) : z.string().optional().describe(a.desc);
  }
  return shape;
}

function registerPrompts(server: McpServer, kernel: Kernel): void {
  server.registerPrompt(
    "review-worldbook",
    {
      title: MCP_PROMPTS[0]!.title,
      description: MCP_PROMPTS[0]!.description,
      argsSchema: promptShape(MCP_PROMPTS[0]!) as z.ZodRawShape,
    },
    ((args: Record<string, string | undefined>) => ({
      description: `世界书体检 · ${args?.project ?? ""}`,
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: asMcpError(() =>
              worldbookReviewBrief(kernel, {
                project: String(args?.project ?? ""),
                q: args?.q || undefined,
                cat: args?.cat || undefined,
                k: args?.k ? Number(args.k) : undefined,
              }),
            ),
          },
        },
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: "请依据以上盘面事实给出世界书修订清单：每条 = 哪个词条 + 缺什么 + 怎么补（重建索引/补摘要/连边），不要泛泛而谈。",
          },
        },
      ],
    })) as never,
  );

  server.registerPrompt(
    "gate-assist",
    {
      title: MCP_PROMPTS[1]!.title,
      description: MCP_PROMPTS[1]!.description,
      argsSchema: promptShape(MCP_PROMPTS[1]!) as z.ZodRawShape,
    },
    ((args: Record<string, string | undefined>) => ({
      description: `裁决材料盘 · ${args?.project ?? ""}${args?.node ? ` · ${args.node}` : ""}`,
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: gateAssistBrief(kernel, { project: String(args?.project ?? ""), node: args?.node || undefined }),
          },
        },
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: "请对照 knowledge/rules/ 相关域卡裁决本门，并说明依据来自哪张卡/哪件产物；打回必须写清失效范围与重做要求。",
          },
        },
      ],
    })) as never,
  );
}

/** 构建 MCP server（不连接 transport）—— 单独导出以便测试用 in-memory transport 真握手。 */
export function buildMcpServer(kernel: Kernel): McpServer {
  const server = new McpServer({ name: "miniflow", version: "0.1.0" });

  const specs = verbToolSpecs();
  VERBS.forEach((def, i) => {
    server.registerTool(
      def.name,
      { description: def.description, inputSchema: specs[i]?.inputSchema as z.ZodRawShape },
      (async (args: Record<string, unknown>) => {
        const t0 = Date.now();
        try {
          const out = await def.run(kernel, args ?? {});
          traceMcp(def.name, args ?? {}, Date.now() - t0, 0);
          return json(out);
        } catch (e) {
          traceMcp(def.name, args ?? {}, Date.now() - t0, 1);
          throw e;
        }
      }) as never,
    );
  });

  registerResources(server, kernel);
  registerPrompts(server, kernel);

  return server;
}

export async function startMcp(kernel: Kernel): Promise<void> {
  const server = buildMcpServer(kernel);
  await server.connect(new StdioServerTransport());
  console.error(
    [
      `miniflow MCP server ready (stdio) · ${VERBS.length} verbs: ${VERBS.map((v) => v.name).join(", ")}`,
      `  resources ×${MCP_RESOURCES.length}: ${MCP_RESOURCES.map((r) => r.uriTemplate).join("  ")}`,
      `  prompts ×${MCP_PROMPTS.length}: ${MCP_PROMPTS.map((p) => p.name).join(", ")}`,
    ].join("\n"),
  );
}

// 直接运行：tsx src/mcp.ts 或 node dist/mcp.js（dist 后缀也要能自启动，宿主注册走这条路）
// 锚点必须吃住路径分隔符：`/mcp\.(ts|js)$/` 会把 `agent-mcp.ts` 也认成本文件——
// 那个入口自启动时会连带把 miniflow 面挂上 stdout，两个 server 抢同一条 stdio。
if (process.argv[1] && /(^|\/)mcp\.(ts|js)$/.test(process.argv[1].replace(/\\/g, "/"))) {
  startMcp(new Kernel()).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
