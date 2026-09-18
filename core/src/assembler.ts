import fs from "node:fs";
import path from "node:path";
import type { FlowDescriptor, FlowNode, KnowledgeCard, RunState, TaskPackage } from "./types.js";
import { contentSha12 } from "./ids.js";
import { upstreamOf } from "./plan.js";
import { condContextOf, type CondContext } from "./cond.js";
import { artifactPathOf, nodeAsserts } from "./minitools.js";
import { listArtifacts } from "./registry.js";
import { ROOT } from "./schema.js";
import { ProfileRegistry } from "./profiles.js";
import { kitRegistry, resolveToolConfig, applyToolOverride, type ResolvedOp } from "./kits.js";
import type { ToolOverride } from "./overlay.js";
import { loadProjectConfig, configCardLines } from "./project-config.js";
import { bodySkeleton, classOfPath, foreignOwnTerms, headerTemplate } from "./asserts.js";

const CONTEXT_BUDGET = 20000;
const SKILL_CAP = 6000;
/** 标尺装载预算：单卡封顶 + 总量封顶，防止长篇跑起来 worldbook 全量吃光上下文。 */
const KB_CARD_CAP = 1600;
const KB_TOTAL_CAP = 9000;

let regCache: { root: string; reg: ProfileRegistry } | undefined;
function profileRegistry(root: string): ProfileRegistry {
  if (!regCache || regCache.root !== root) {
    const reg = new ProfileRegistry(root);
    regCache = { root, reg };
  }
  return regCache.reg;
}

/**
 * K1 项目背景卡：确定性组装，子代理不再「考古拼背景」（派发质量分析 R1 · R2）。
 * 全部来自盘上文件，缺文件优雅降级；卡片自带上限，不挤占产物上下文预算。
 */
export function buildBackgroundCard(projectDir: string, flow: FlowDescriptor, state: RunState, nodeId: string): string {
  const node = flow.graph.nodes[nodeId];
  const stage = (flow.stages ?? []).find((s) => s.id === node?.stage || s.nodes?.includes(nodeId));
  const lines: string[] = [];
  lines.push(`- 项目：${state.projectId ?? ""}（${flow.title} @ v${flow.version}）`);
  if (stage) {
    lines.push(`- 阶段：${stage.id} ${stage.name}${stage.question ? ` —— 本阶段要回答：${stage.question}` : ""}`);
  }
  const briefFile = path.join(projectDir, "选题素材.md");
  if (fs.existsSync(briefFile)) {
    const brief = clip(fs.readFileSync(briefFile, "utf-8").replace(/\s+/g, " ").trim(), 400);
    lines.push(`- 甲方点子：${brief.text}${brief.truncated ? "…" : ""}`);
  }
  const downstream = [...new Set(flow.graph.edges.filter((e) => e.from === nodeId && !e.loop).map((e) => e.to))]
    .map((id) => flow.graph.nodes[id]?.title ?? id);
  const file = artifactPathOf(flow, nodeId) ?? "（未声明）";
  lines.push(`- 你的交付物：${file}（${node?.title ?? nodeId}）→ 供给下游：${downstream.slice(0, 3).join("、") || "阶段验收门"}`);
  // 词汇表：own 专属词 + banned 红线（缺表则降级为通用合规提示）
  try {
    const g = JSON.parse(fs.readFileSync(path.join(projectDir, "词汇表.json"), "utf-8")) as {
      own?: unknown;
      banned?: unknown;
    };
    if (Array.isArray(g.own) && g.own.length) lines.push(`- 项目专属词：${g.own.map(String).join("、")}（产物应使用；他项目专名禁止出现）`);
    if (Array.isArray(g.banned) && g.banned.length) lines.push(`- 合规红线：禁止出现 ${g.banned.map(String).join("、")}`);
  } catch {
    lines.push(`- 合规红线：不出现真实人名/机构名，不混入其他项目专名`);
  }
  // K1.5 项目初始化配置：出品定位/市场预估/快照基线——子代理带着底气干活，避免返工
  try {
    const cfg = loadProjectConfig(projectDir);
    if (cfg) {
      let snapVersion: string | undefined;
      let snapCorpus: number | undefined;
      try {
        const snap = JSON.parse(fs.readFileSync(path.join(ROOT, "knowledge", "market", "snapshot.json"), "utf-8")) as {
          version?: string;
          source?: { corpus?: number };
        };
        snapVersion = snap.version;
        snapCorpus = snap.source?.corpus;
      } catch {
        /* 无快照则不引用 */
      }
      lines.push(...configCardLines(cfg, snapVersion, snapCorpus));
    }
  } catch {
    /* 配置非法在 flow_run 已拦截；此处不再抛 */
  }
  return clip(lines.join("\n"), 1200).text;
}

/** 上游产物路径：flow 声明优先，回退到该节点最近注册的产物（kb_load 等内核生成物）。 */
function pathOfUpstream(projectDir: string, flow: FlowDescriptor, up: string): string | undefined {
  const declared = artifactPathOf(flow, up);
  if (declared) return declared;
  const arts = listArtifacts(projectDir, { node: up, latest: true });
  return arts.length ? arts[arts.length - 1].path : undefined;
}

/** 穿透门节点：门无产物，上下文/谱系应落到被评审的实质节点（限深防环）。 */
export function effectiveUpstreams(
  flow: FlowDescriptor,
  nodeId: string,
  inputs: Record<string, unknown>,
  depth = 0,
  extra?: Partial<CondContext>,
): string[] {
  const out: string[] = [];
  for (const up of upstreamOf(flow, nodeId, inputs, extra)) {
    const kind = flow.graph.nodes[up]?.kind;
    if ((kind === "gate" || kind === "srd") && depth < 4) {
      out.push(...effectiveUpstreams(flow, up, inputs, depth + 1, extra));
    } else {
      out.push(up);
    }
  }
  return [...new Set(out)];
}

function clip(text: string, cap: number): { text: string; truncated: boolean } {
  if (text.length <= cap) return { text, truncated: false };
  return { text: text.slice(0, cap), truncated: true };
}

/** kb 条目 id → 知识文件（支持 kb/... 路径、目录与 /* glob）。 */
function resolveKbPaths(root: string, ids: string[]): { id: string; file: string }[] {
  const out: { id: string; file: string }[] = [];
  const seen = new Set<string>();
  const kbRoot = path.join(root, "knowledge");
  // glob 展开后回填精确条目 id（便于核对"到底装了哪几张卡"，而非一串通配符）
  const toId = (f: string): string =>
    "kb/" + path.relative(kbRoot, f).replaceAll("\\", "/").replace(/\.md$/, "");
  for (const id of ids) {
    const rel = id.replace(/^kb\//, "").replace(/\/\*$/, "");
    const base = path.join(kbRoot, rel);
    const push = (file: string, exact: boolean): void => {
      if (seen.has(file)) return;
      seen.add(file);
      out.push({ id: exact ? toId(file) : id, file });
    };
    if (id.endsWith("/*") && fs.existsSync(base) && fs.statSync(base).isDirectory()) {
      for (const f of fs.readdirSync(base).sort()) {
        const p = path.join(base, f);
        if (fs.statSync(p).isFile()) push(p, true);
      }
    } else if (fs.existsSync(base) && fs.statSync(base).isFile()) {
      push(base, false);
    } else if (fs.existsSync(base + ".md")) {
      push(base + ".md", false);
    } else if (fs.existsSync(path.join(root, id))) {
      push(path.join(root, id), false);
    }
  }
  return out;
}

/**
 * K1 标尺装载（装载复位）：节点声明的判定条款真正进入执行上下文。
 *
 * R1 报告的病根：flow 的 agent 节点用 node.kb 声明知识，内核却只读 core 节点的
 * node.loads——35 个 agent 节点的知识声明与 74 条硬断言全部空转。此处把
 * 「kit/op → knowledge」落成带来源注记的标尺段，逐条裁剪 + 总量封顶；
 * 缺失条目不再静默丢弃，显式回显（约束不进上下文 = 约束不存在）。
 */
export function loadKnowledge(
  root: string,
  ids: string[],
  exclude: string[] = [],
): { cards: KnowledgeCard[]; text: string; missing: string[]; excluded: string[] } {
  const ex = new Set(exclude);
  const resolvedAll = resolveKbPaths(root, ids);
  const dropped = resolvedAll.filter((f) => ex.has(f.id));
  const files = resolvedAll.filter((f) => !ex.has(f.id));
  const found = new Set(files.map((f) => f.id));
  const missing = ids.filter((id) => !found.has(id) && !ex.has(id));
  const cards: KnowledgeCard[] = [];
  const blocks: string[] = [];
  let used = 0;
  for (const { id, file } of files) {
    if (used >= KB_TOTAL_CAP) {
      missing.push(`${id}（总量封顶未装载）`);
      continue;
    }
    let raw: string;
    try {
      raw = fs.readFileSync(file, "utf-8");
    } catch {
      continue;
    }
    const cap = Math.min(KB_CARD_CAP, KB_TOTAL_CAP - used);
    const { text, truncated } = clip(raw, cap);
    used += text.length;
    const rel = path.relative(root, file).replaceAll("\\", "/");
    cards.push({ id, path: rel, chars: text.length, ...(truncated ? { truncated: true } : {}) });
    blocks.push(`### ${id}${truncated ? "（超预算截断）" : ""}\n\n<!-- source: ${rel} -->\n\n${text}`);
  }
  return { cards, text: blocks.join("\n\n"), missing, excluded: dropped.map((d) => d.id) };
}

/**
 * 节点知识来源解析：显式 kit+op 优先；兼容期按 skill 反查 kit 操作。
 * R5：叠加 tool 级 overlay（set-tool）——改一处 op 声明，所有引用它的节点一起生效。
 * 注意 config 不在此叠加（由 resolveToolConfig 统一合成，避免两处各改一半）。
 */
export function resolveNodeOp(
  node: FlowNode,
  root = ROOT,
  overrides?: Record<string, ToolOverride>,
): ResolvedOp | undefined {
  const reg = kitRegistry(root);
  const base = reg.resolve(node.kit, node.op) ?? (node.skill ? reg.bySkill(node.skill) : undefined);
  if (!base) return undefined;
  const ov = overrides?.[`${base.kit}.${base.op}`];
  if (!ov) return base;
  return applyToolOverride(base, {
    ...(ov.add_knowledge ? { add_knowledge: ov.add_knowledge } : {}),
    ...(ov.remove_knowledge ? { remove_knowledge: ov.remove_knowledge } : {}),
    ...(ov.add_asserts ? { add_asserts: ov.add_asserts } : {}),
    ...(ov.remove_asserts ? { remove_asserts: ov.remove_asserts } : {}),
    ...(ov.model_tier ? { model_tier: ov.model_tier } : {}),
  });
}

/**
 * 某节点最近一次「声明断言无机器校验器」warn 里的 unverified id 清单（journal 尾扫）。
 * 供评审步任务包注入（语义断言闭环）；journal 缺失/解析失败 = 空清单（旁路不阻断）。
 */
function latestUnverified(projectDir: string, nodeId: string): string[] {
  try {
    const p = path.join(projectDir, "journal.jsonl");
    if (!fs.existsSync(p)) return [];
    const lines = fs.readFileSync(p, "utf-8").split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const l = lines[i].trim();
      if (!l) continue;
      let e: { nodeId?: string; event?: string; detail?: string };
      try {
        e = JSON.parse(l);
      } catch {
        continue;
      }
      if (e.nodeId === nodeId && e.event === "warn" && typeof e.detail === "string" && e.detail.includes("声明断言无机器校验器")) {
        const idx = e.detail.indexOf("：");
        return idx >= 0
          ? e.detail
              .slice(idx + 1)
              .split("、")
              .map((s) => s.trim())
              .filter((s) => /^[A-Z]/.test(s))
          : [];
      }
    }
  } catch {
    /* 旁路 */
  }
  return [];
}

/**
 * 任务包组装（上下文纪律的执行点）：
 * - 节点域隔离：只带本节点上游产物
 * - 哈希锚定：每个 context 条目带 sha1 前 12 位
 * - 预算裁剪：输出契约 > 上游产物（均摊）> 方法论细节
 * - 每轮重组：flow_next/flow_resume 都重新调用，禁止从对话续写
 */
export function buildTaskPackage(
  projectDir: string,
  flow: FlowDescriptor,
  state: RunState,
  nodeId: string,
  toolOverrides?: Record<string, ToolOverride>,
): TaskPackage {
  const node = flow.graph.nodes[nodeId];
  if (!node) throw new Error(`图中无节点 ${nodeId}`);

  // 输出契约
  const file = artifactPathOf(flow, nodeId);
  if (!file) throw new Error(`节点 ${nodeId} 未声明产物路径（file/output/outputs）`);

  // 上游产物上下文（哈希锚定 + 均摊摘录预算；穿透门节点）
  // 条件求值带上 run 状态（门裁决/根因）——与 compilePlan、前端面板同源（规范 R4 §5.2）
  const ups = effectiveUpstreams(flow, nodeId, state.inputs ?? {}, 0, condContextOf(state)).filter(
    (up) => (state.nodes[up]?.status ?? "none") === "done",
  );
  const refs = ups
    .map((up) => pathOfUpstream(projectDir, flow, up))
    .filter((p): p is string => !!p);
  const perItem = Math.max(800, Math.floor(CONTEXT_BUDGET / Math.max(1, refs.length)));
  const context: TaskPackage["context"] = [];
  for (const ref of refs) {
    const abs = path.join(projectDir, ref);
    if (!fs.existsSync(abs)) continue;
    const raw = fs.readFileSync(abs, "utf-8");
    const { text, truncated } = clip(raw, perItem);
    context.push({ ref, hash: contentSha12(raw), excerpt: text, truncated });
  }

  // kit 标尺（K1 装载复位）：kit/op 声明的判定条款为权威；节点 kb 仅在无 kit 归属时生效
  const opRef = resolveNodeOp(node, ROOT, toolOverrides);
  const skillId = node.skill ?? opRef?.skill;
  const knowledgeIds = [...new Set([...(opRef?.knowledge ?? []), ...(node.knowledge ?? node.kb ?? [])])];
  const kb = loadKnowledge(ROOT, knowledgeIds, opRef?.excludeKnowledge ?? []);
  const asserts = [...new Set([...nodeAsserts(node), ...(opRef?.asserts ?? [])])];
  // R5 内容配置项：overlay.opConfig > 节点 config > op.default > 通用默认
  const ovKey = opRef ? `${opRef.kit}.${opRef.op}` : undefined;
  const cfg = resolveToolConfig(opRef, node.config, ovKey ? toolOverrides?.[ovKey]?.config : undefined);

  // 指令：标尺 + skill 方法论（封顶）+ 节点描述 + 契约回显
  let skillText = "";
  let skillTruncated = false;
  if (skillId) {
    const skillFile = path.join(ROOT, "skills", `${skillId}.md`);
    if (fs.existsSync(skillFile)) {
      const r = clip(fs.readFileSync(skillFile, "utf-8"), SKILL_CAP);
      skillText = r.text;
      skillTruncated = r.truncated;
    }
  }
  const parts: string[] = [];
  if (kb.text) {
    const origin = opRef ? `kit ${opRef.kit}/${opRef.op}` : "节点 kb 声明";
    parts.push(`## 判定标尺（本步必须逐条对照的硬条款；出自 ${origin}）\n\n${kb.text}`);
  }
  if (kb.missing.length) {
    parts.push(
      `## 标尺缺口（声明了却不存在——禁止假装已遵守）\n\n${kb.missing.map((m) => `- ${m}`).join("\n")}`,
    );
  }
  if (kb.excluded.length) {
    parts.push(
      `## 已剔除条款（优化器按指标判定为死条款；不是缺失，是主动不用）\n\n${kb.excluded.map((m) => `- ${m}`).join("\n")}`,
    );
  }
  if (skillText) {
    parts.push(`## 方法论：${skillId}${skillTruncated ? "（超预算截断）" : ""}\n\n${skillText}`);
  }
  if (Object.keys(cfg.values).length) {
    const lines = Object.entries(cfg.values).map(([k, v]) => {
      const d = cfg.defs[k];
      return `- ${k} = ${String(v)}${d?.unit ? ` ${d.unit}` : ""}${d?.desc ? `（${d.desc}）` : ""}`;
    });
    parts.push(`## 本步配置（生效值；tool 的内容配置项，可由人或优化 agent 调优）\n\n${lines.join("\n")}`);
  }
  if (cfg.unknownKeys.length) {
    parts.push(`## 配置告警（写了却没人认的键——禁止假装生效）\n\n${cfg.unknownKeys.map((k) => `- ${k}`).join("\n")}`);
  }
  if (node.desc) parts.push(`## 本步要求\n\n${node.desc}`);
  // D5：禁词表前置。与交卷时的 glossary 断言**同源**（他项目 own 词），但用途相反——
  // 开跑前就告诉写手雷在哪，而不是写完了才打回（_918test：glossary 打回 2 次，全是别项目专名）。
  const banned = foreignOwnTerms(ROOT, projectDir);
  if (banned.length) {
    parts.push(
      `## 禁词表（本项目产物中不得出现；出现即 glossary 断言打回）\n\n${banned.map((w) => `- ${w}`).join("\n")}`,
    );
  }
  // R5 语义断言闭环（挖掘 N4）：kind=gate 的评审步「归评审」的 unverified 断言必须有真实
  // 消费方——auto 评审步交卷即 pass，语义断言会零消费落空。这里把上游最近一次提交的
  // unverified 清单注入评审任务包，评审 LLM 照单真读真裁（结论写进意见书/交卷 notes）。
  if (node.kind === "gate") {
    const rows: string[] = [];
    for (const up of new Set(ups)) {
      const un = latestUnverified(projectDir, up);
      if (un.length) rows.push(`- ${up}：${un.join("、")}`);
    }
    if (rows.length) {
      parts.push(
        `## 语义断言清单（机器不验，本步须逐条人裁）\n\n以下断言引擎无校验器、登记为 unverified——它们是否达标由你裁决：逐条给出 pass / 不达标（写明理由），放行即代表你已确认全部达标。\n\n${rows.join("\n")}`,
      );
    }
  }
  parts.push(
    `## 输出契约\n\n- 产物路径：${file}\n- 上游依据：${refs.join("、") || "（无）"}\n- 完成后经 flow_submit 提交，完整性断言不过 = 打回`,
  );
  const instruction = { ...(skillId ? { skill: skillId } : {}), text: parts.join("\n\n") };

  const pkg: TaskPackage = {
    runId: state.runId,
    projectId: state.projectId ?? "",
    nodeId,
    kind: "agent",
    instruction,
    context,
    outputContract: { file, asserts: [...asserts, "integrity"] },
    budget: { maxContextChars: CONTEXT_BUDGET + SKILL_CAP + KB_TOTAL_CAP },
  };
  if (kb.cards.length) pkg.knowledge = kb.cards;
  if (opRef) pkg.toolConfig = cfg.values;
  if (opRef) {
    pkg.kitRef = {
      kit: opRef.kit,
      op: opRef.op,
      domain: opRef.domain,
      skill: opRef.skill ?? skillId ?? "",
      kind: opRef.kind,
    };
  }
  // 角色剖面：节点显式声明 > 技能反向匹配 > 角色族缺省
  const prof = profileRegistry(ROOT).resolve({ ...node, ...(skillId ? { skill: skillId } : {}) });
  const projected = profileRegistry(ROOT).project(prof, skillId);
  if (projected) pkg.profile = projected;
  // K1 项目背景卡：子代理不再自行考古拼背景
  pkg.background = buildBackgroundCard(projectDir, flow, state, nodeId);
  // artifact@1 头部模板（规范 R4 §二）：agent 照抄开头，产物天生合规
  const round = (state.nodes[nodeId]?.round ?? 0) + 1;
  pkg.headerTemplate = headerTemplate({
    id: opRef ? `${opRef.kit}.${opRef.op}` : node.minitool ? `core.${node.minitool}` : `input.${nodeId}`,
    cls: classOfPath(file),
    node: nodeId,
    round,
    by: opRef ? `kit/${opRef.kit}.${opRef.op}` : node.minitool ? `core/${node.minitool}` : "user",
    upstream: context.map((c) => `${c.ref}@${c.hash ?? "000000000000"}`),
    skeleton: bodySkeleton(classOfPath(file)),
  });
  return pkg;
}
