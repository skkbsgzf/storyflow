// 项目简报（赋能前移）：确定性拼装项目上下文，chat/executor 醒来即带——
// 消「每次对话都 whereami/fs_tree/fs_read 考古」的病根（甲方 0927 指令）。
// 数据源 = 盘上事实（state.json / 项目配置.json / 最近遥测 / 判官收据），不猜值、缺失显式标注。
// 批次4 4.2（2026-10-12）：openQuestions 冷启动询问未答项随简报尾部「【待询问（冷启动）】」段下发。
import * as fs from "node:fs";
import path from "node:path";
import type { KernelClient } from "./kernel.js";

export interface OpenQuestion {
  key: string;
  question: string;
  options?: string[];
}

export interface BriefParts {
  project: string;
  flowId?: string;
  status?: string;
  stage?: string;
  next?: string;
  progress?: string;
  direction?: string;
  episodes?: number;
  gate?: string;
  telemetry?: string;
  sessionBrief?: string[];
  openQuestions?: OpenQuestion[];
}

export function gatherBriefParts(kernel: KernelClient, project: string): BriefParts {
  const dir = kernel.projectDir(project);
  const parts: BriefParts = { project };
  try {
    const st = JSON.parse(fs.readFileSync(path.join(dir, "state.json"), "utf-8"));
    parts.flowId = st.flowId;
    parts.status = st.status;
    parts.direction = st.inputs?.direction;
    parts.episodes = st.inputs?.episodes;
    const nodes = st.nodes ?? {};
    const total = Object.keys(nodes).length;
    const done = Object.entries(nodes).filter(([, v]: any) => v.status === "done").map(([n]) => n);
    parts.progress = `${done.length}/${total} 节点完成`;
    parts.gate = st.gate?.verdict === "awaiting" ? `门 ${st.gate.node} 待人裁（${st.gate.note ?? ""}）` : undefined;
    // 当前阶段：最后一个 done 节点的模块前缀（m1.x → m1）
    const lastDone = done[done.length - 1];
    parts.stage = lastDone ? lastDone.split(".")[0] : "m1";
    // 下一步：第一个非 done 节点
    const next = Object.entries(nodes).find(([, v]: any) => v.status !== "done");
    parts.next = next ? next[0] : "全部完成";
  } catch { /* 无 state：未立项项目，简报降级 */ }
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(dir, "项目配置.json"), "utf-8"));
    parts.direction = parts.direction ?? cfg.灵感 ?? cfg.direction;
    // 项目自述会话上下文（批次3e 改稿套件改造）：sessionBrief 字符串数组逐条注入简报——
    // 无 flow 的改稿/协作会话靠它携带文风卡路径、协作纪律、外部资产库位置等项目专属上下文。
    if (Array.isArray(cfg.sessionBrief)) parts.sessionBrief = cfg.sessionBrief.filter((x: unknown): x is string => typeof x === "string");
    // 冷启动询问（批次4 4.2）：只收未答项（answer 非空 = 已答，不再注入）——
    // 会话 agent 见单必须逐条向用户询问，答案回填 项目配置.json 的 openQuestions[].answer；
    // 询问归会话 agent，kit 不弹 UI。
    if (Array.isArray(cfg.openQuestions)) {
      const open = cfg.openQuestions
        .filter((q: any): q is OpenQuestion =>
          !!q && typeof q === "object"
          && typeof q.key === "string"
          && typeof q.question === "string"
          && !(typeof q.answer === "string" && q.answer.trim()))
        .map((q: OpenQuestion) => ({
          key: q.key,
          question: q.question,
          ...(Array.isArray(q.options) ? { options: q.options.filter((o) => typeof o === "string") } : {}),
        }));
      // 全答完不挂字段（未答清单为空 = 历史形状，简报零打扰）
      if (open.length) parts.openQuestions = open;
    }
  } catch { /* 无配置 */ }
  // 最近判官 flagged（过闸收据，mtime 最近一份）
  try {
    const recDir = path.join(dir, kernel.corpus.receiptsDir);
    const files = fs.readdirSync(recDir).filter((f) => f.endsWith(".json")).map((f) => path.join(recDir, f))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    for (const f of files) {
      JSON.parse(fs.readFileSync(f, "utf-8"));
      break;
    }
  } catch { /* 收据缺失 */ }
  // 最近遥测摘要
  try {
    const telDir = path.join(dir, kernel.corpus.telemetryDir);
    const files = fs.readdirSync(telDir).filter((f) => f.startsWith("run-")).map((f) => path.join(telDir, f))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    if (files.length) {
      const t = JSON.parse(fs.readFileSync(files[0], "utf-8"));
      const tt = t.totals ?? {};
      parts.telemetry = `最近 run：${tt.okNodes ?? "?"}/${tt.nodes ?? "?"} 节点过闸 · usage ${tt.usageIn ?? "?"}/${tt.usageOut ?? "?"} tok`;
    }
  } catch { /* 遥测缺失 */ }
  return parts;
}

/** 拼人类+LLM 双读的项目简报。空项目返回 null（调用方零打扰）；
 *  冷启动例外：有未答 openQuestions 也出简报（批次4 4.2——冷启动项目无 flow 无 direction，
 *  问题必须能送达会话 agent；历史配置不含该字段，零回归）。 */
export function buildProjectBrief(kernel: KernelClient, project: string): string | null {
  const p = gatherBriefParts(kernel, project);
  if (!p.flowId && !p.direction && !p.openQuestions?.length) return null;
  const lines = [
    `【项目简报（系统注入——本段是事实快照，直接采信，禁止再调工具重复核实）】`,
    `- 项目：${p.project}${p.flowId ? ` ｜ 流程：${p.flowId}` : ""}${p.status ? ` ｜ 状态：${p.status}` : ""}`,
  ];
  if (p.direction) lines.push(`- 题材方向：${p.direction}${p.episodes ? `（${p.episodes} 集）` : ""}`);
  if (p.sessionBrief?.length) lines.push(...p.sessionBrief.map((s) => `- ${s}`));
  if (p.progress) lines.push(`- 进度：${p.progress}`);
  if (p.next) lines.push(`- 下一步节点：${p.next}`);
  if (p.gate) lines.push(`- ⛔ ${p.gate}`);
  if (p.telemetry) lines.push(`- ${p.telemetry}`);
  lines.push(`- 以上简报已覆盖盘面事实：无需再调 whereami/fs_tree 重复核实；只读你真正需要的具体文件。`);
  // 冷启动询问段（批次4 4.2）：简报尾部独立段——未答项逐条带 question+options 下发，
  // 会话 agent 逐条向用户询问后把答案回填 项目配置.json 的 openQuestions[].answer；全答完本段消失。
  if (p.openQuestions?.length) {
    lines.push(`【待询问（冷启动）】以下 ${p.openQuestions.length} 项未答：逐条向用户询问，答案回填 项目配置.json 的 openQuestions[].answer（询问归会话 agent，kit 不弹 UI；全部答完本段自动消失）`);
    for (const q of p.openQuestions) {
      lines.push(`- 〔${q.key}〕${q.question}${q.options?.length ? `（选项：${q.options.join(" / ")}）` : ""}`);
    }
  }
  return lines.join("\n");
}
