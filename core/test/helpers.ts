import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../src/schema.js";
import { expandFlow3, type Flow3Descriptor } from "../src/modules.js";
import type { FlowDescriptor } from "../src/types.js";

/** 载入真实 flow 描述符（磁盘原样；flow@3 不含手画图，要图用 expandedFlow）。 */
export function loadFlow(id: string): FlowDescriptor {
  return JSON.parse(fs.readFileSync(path.join(ROOT, "flows", id, "flow.json"), "utf-8")) as FlowDescriptor;
}

/** flow@3 → expandFlow3 派生描述符（与内核 effectiveOf 同一展开单点）；flow@2 原样返回。 */
export function expandedFlow(id: string): FlowDescriptor {
  const j = loadFlow(id) as FlowDescriptor | (Flow3Descriptor & { format: "flow@3" });
  if ((j as { format: string }).format === "flow@3") {
    return expandFlow3(ROOT, j as Flow3Descriptor).flow as FlowDescriptor;
  }
  return j as FlowDescriptor;
}

/** 由产物路径推 class（与内核 classOfPath 同规则，规范 R4 §一）。 */
export function classOf(relPath: string): string {
  const p = relPath.replaceAll("\\", "/");
  if (p.startsWith("对外交付/") || p.startsWith("章节正文/")) return "deliverable";
  if (p.startsWith("内部/意见/")) return "opinion";
  if (p.startsWith("内部/收据/")) return "receipt";
  if (p.startsWith("内部/依据/")) return "basis";
  if (p.startsWith("内部/稿本/")) return "draft";
  if (p.startsWith("内部/")) return "draft";
  if (p.startsWith("世界书/")) return "world";
  return "input";
}

/** 节点产物路径（图形态描述符：节点 output 唯一；清单 path 为交付路径兜底）。 */
export function outputOf(flow: FlowDescriptor, nodeId: string): string {
  const n = flow.graph.nodes[nodeId];
  const declared = flow.outputs?.find((o) => o.node === nodeId);
  return (n.output ?? n.file ?? declared?.path ?? declared?.file) as string;
}

export interface MdOpts {
  /** 头部 round（= state.nodes[node].round + 1）；给了 projectDir 时自动推导，无需手填 */
  round?: number;
  /** 项目目录：给了就按 state.json 推导当前轮（打回后 round 只增，手填极易过期） */
  projectDir?: string;
  /** 头部 node（默认由 outPath 反查） */
  node?: string;
  id?: string;
  by?: string;
  /** 摘要行 */
  summary?: string;
  /** 是否省略头部（用于校验头部拦截的负样本） */
  noHeader?: boolean;
}

/** 由 state.json 推导该节点本轮应有的 round（= 已记录轮次 + 1）。 */
export function expectedRound(projectDir: string, nodeId: string): number {
  try {
    const st = JSON.parse(fs.readFileSync(path.join(projectDir, "state.json"), "utf-8")) as {
      nodes?: Record<string, { round?: number }>;
    };
    return (st.nodes?.[nodeId]?.round ?? 0) + 1;
  } catch {
    return 1;
  }
}

/**
 * 造合规过程交付件（artifact@1 头部 + 正文两行规则，规范 R4 §二）。
 * 测试夹具一律走这里——契约变了就只改一处。
 */
export function artifact(flowId: string, nodeId: string, body: string, opts: MdOpts = {}): string {
  const flow = expandedFlow(flowId);
  const out = outputOf(flow, nodeId);
  if (opts.noHeader) return body;
  const node = flow.graph.nodes[nodeId] ?? {};
  const round = opts.round ?? (opts.projectDir ? expectedRound(opts.projectDir, nodeId) : 1);
  const kitOp = node.kit && node.op ? `${node.kit}.${node.op}` : node.minitool ? `core.${node.minitool}` : nodeId;
  const by = opts.by ?? (node.kit && node.op ? `kit/${node.kit}.${node.op}` : `core/${node.minitool ?? "kb_load"}`);
  const title = (node.title as string) ?? nodeId;
  const head = [
    "---",
    "artifact: 1",
    `id: ${opts.id ?? kitOp}`,
    `class: ${classOf(out)}`,
    `node: ${opts.node ?? nodeId}`,
    `round: ${round}`,
    `version: v${round}`,
    "state: draft",
    "at: 2026-09-17 19:50",
    `by: ${by}`,
    "upstream: []",
    "review: null",
    "---",
    "",
    `# ${title}`,
    `> ${opts.summary ?? "e2e 夹具"}`,
    "",
  ].join("\n");
  return head + body;
}

/**
 * R5：为测试锁定 bootstrap 编排语义（手动门 + 不派生 kit 边界验收）。
 *
 * 生产默认是「域内门自动放行、kit 边界挂人工」；但既有 e2e 测试断言的是**门语义本身**
 * （STALE_GATE / send-back 级联 / 阶段回滚）。用一份显式 overlay 声明，而不是让测试
 * 悄悄依赖一个早晚会变的默认值——顺带也测了 overlay 装载链路。
 */
export function lockBootstrapPolicy(projectDir: string, flowId: string): void {
  const dir = path.join(projectDir, "registry");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "overlay.json"),
    JSON.stringify(
      {
        format: "flow-overlay@1",
        flowId,
        origin: "user",
        reason: "测试锁定：bootstrap 编排语义（手动门 / 不派生边界验收）",
        patches: [
          { kind: "set-policy", key: "gate_mode", value: "manual", reason: "测试要断言门语义本身" },
          { kind: "set-policy", key: "kit_boundary", value: "off", reason: "测试要断言 bootstrap 计划序" },
        ],
      },
      null,
      2,
    ) + "\n",
    "utf-8",
  );
}
