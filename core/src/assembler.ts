import type { IFileSystem, IFsPath } from "./abstraction/fs.js";
import { nodeFs, nodePath } from "./abstraction/defaults.js";
import type { FlowDescriptor, FlowNode, KnowledgeCard, RunState, TaskPackage } from "./types.js";
import { contentSha12 } from "./ids.js";
import { upstreamOf } from "./plan.js";
import { condContextOf, isBackEdge, type CondContext } from "./cond.js";
import { artifactPathOf } from "./minitools.js";
import { listArtifacts } from "./registry.js";
import { rootOf } from "./schema.js";
import { ProfileRegistry } from "./profiles.js";
import { kitRegistry, resolveToolConfig, applyToolOverride, type ResolvedOp } from "./kits.js";
import type { ToolOverride, FlowPolicy } from "./overlay.js";
import { loadProjectConfig, configCardLines } from "./project-config.js";
import { applySkillOverlay, appliedPatchesFor } from "./skills.js";
import { bodySkeleton, classOfPath, foreignOwnTerms, headerTemplate } from "./asserts.js";
import { resolveBudget, DEFAULT_BUDGET } from "./budget.js";
import { poolEntries, resolveSelection, resolveSkillFromPool, type DecisionLite, type ExcludedCandidate, type PoolDecl } from "./selection.js";
import { decisionsMap } from "./decisions.js";

let regCache: { root: string; fs: IFileSystem; path: IFsPath; reg: ProfileRegistry } | undefined;
function profileRegistry(root: string, fs: IFileSystem = nodeFs, path: IFsPath = nodePath): ProfileRegistry {
  if (!regCache || regCache.root !== root || regCache.fs !== fs || regCache.path !== path) {
    const reg = new ProfileRegistry(root, fs, path);
    regCache = { root, fs, path, reg };
  }
  return regCache.reg;
}

/**
 * K1 项目背景卡：确定性组装，子代理不再「考古拼背景」（派发质量分析 R1 · R2）。
 * 全部来自盘上文件，缺文件优雅降级；卡片自带上限，不挤占产物上下文预算。
 */
export function buildBackgroundCard(projectDir: string, flow: FlowDescriptor, state: RunState, nodeId: string, fs: IFileSystem = nodeFs, path: IFsPath = nodePath): string {
  const node = flow.graph.nodes[nodeId];
  const stage = (flow.stages ?? []).find((s) => s.id === node?.stage || s.nodes?.includes(nodeId));
  const lines: string[] = [];
  lines.push(`- 项目：${state.projectId ?? ""}（${flow.title} @ v${flow.version}）`);
  if (stage) {
    lines.push(`- 阶段：${stage.id} ${stage.name}${stage.question ? ` —— 本阶段要回答：${stage.question}` : ""}`);
  }
  const briefFile = path.join(projectDir, "选题素材.md");
  if (fs.exists(briefFile)) {
    const brief = clip(fs.readText(briefFile).replace(/\s+/g, " ").trim(), 400);
    lines.push(`- 甲方点子：${brief.text}${brief.truncated ? "…" : ""}`);
  }
  const downstream = [...new Set(flow.graph.edges.filter((e) => e.from === nodeId && !isBackEdge(e)).map((e) => e.to))]
    .map((id) => flow.graph.nodes[id]?.title ?? id);
  const file = artifactPathOf(flow, nodeId) ?? "（未声明）";
  lines.push(`- 你的交付物：${file}（${node?.title ?? nodeId}）→ 供给下游：${downstream.slice(0, 3).join("、") || "阶段验收门"}`);
  // 词汇表：own 专属词 + banned 红线（缺表则降级为通用合规提示）
  try {
    const g = JSON.parse(fs.readText(path.join(projectDir, "词汇表.json"))) as {
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
    const cfg = loadProjectConfig(projectDir, fs, path);
    if (cfg) {
      let snapVersion: string | undefined;
      let snapCorpus: number | undefined;
      try {
        const snap = JSON.parse(fs.readText(path.join(rootOf(), "knowledge", "market", "snapshot.json"))) as {
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
function pathOfUpstream(projectDir: string, flow: FlowDescriptor, up: string, fs: IFileSystem, path: IFsPath): string | undefined {
  const declared = artifactPathOf(flow, up);
  if (declared) return declared;
  const arts = listArtifacts(projectDir, { node: up, latest: true }, fs, path);
  return arts.length ? arts[arts.length - 1]?.path : undefined;
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
function resolveKbPaths(root: string, ids: string[], fs: IFileSystem, path: IFsPath): { id: string; file: string }[] {
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
    if (id.endsWith("/*") && fs.stat(base)?.isDirectory) {
      for (const f of fs.readDir(base).sort()) {
        const p = path.join(base, f);
        if (fs.stat(p)?.isFile) push(p, true);
      }
    } else if (fs.stat(base)?.isFile) {
      push(base, false);
    } else if (fs.exists(base + ".md")) {
      push(base + ".md", false);
    } else if (fs.exists(path.join(root, id))) {
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
  caps: { total: number; card: number } = {
    total: DEFAULT_BUDGET.kbTotalCap?.value ?? 9000,
    card: DEFAULT_BUDGET.kbCardCap?.value ?? 1600,
  },
  pools: PoolDecl[] = [],
  decisions: Record<string, DecisionLite> = {},
  fs: IFileSystem = nodeFs,
  path: IFsPath = nodePath,
): {
  cards: KnowledgeCard[];
  text: string;
  missing: string[];
  excluded: string[];
  /** R8：因与本次决策不符而**主动不选**（≠missing 缺失、≠excluded 优化器剔除） */
  notSelected: ExcludedCandidate[];
  /** 池引用了不存在的决策 / 决策引用了不存在的标签——显式回显不静默 */
  poolIssues: string[];
} {
  const KB_TOTAL_CAP = caps.total;
  const KB_CARD_CAP = caps.card;
  const ex = new Set(exclude);
  // R8 §2.1：先按决策过滤池内 entries，再把命中的精确 id 交给 resolveKbPaths 展开（唯一 glob 实现保留）
  const notSelected: ExcludedCandidate[] = [];
  const poolIssues: string[] = [];
  const poolIds: string[] = [];
  for (const decl of pools) {
    const res = resolveSelection(poolEntries(root, decl.pool, fs, path), decisions, decl);
    poolIds.push(...res.loaded.map((e) => e.id));
    notSelected.push(...res.excluded);
    poolIssues.push(...res.issues);
  }
  const resolvedAll = resolveKbPaths(root, [...ids, ...poolIds], fs, path);
  const dropped = resolvedAll.filter((f) => ex.has(f.id));
  const files = resolvedAll.filter((f) => !ex.has(f.id));
  const found = new Set(files.map((f) => f.id));
  const missing = ids.filter((id) => !found.has(id) && !ex.has(id));
  for (const pid of poolIds) {
    if (!found.has(pid) && !ex.has(pid)) missing.push(`${pid}（池命中但文件装载失败）`);
  }
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
      raw = fs.readText(file);
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
  return {
    cards,
    text: blocks.join("\n\n"),
    missing,
    excluded: dropped.map((d) => d.id),
    notSelected,
    poolIssues,
  };
}

/**
 * 节点知识来源解析：显式 kit+op 优先；兼容期按 skill 反查 kit 操作。
 * R5：叠加 tool 级 overlay（set-tool）——改一处 op 声明，所有引用它的节点一起生效。
 * 注意 config 不在此叠加（由 resolveToolConfig 统一合成，避免两处各改一半）。
 */
export function resolveNodeOp(
  node: FlowNode,
  root = rootOf(),
  overrides?: Record<string, ToolOverride>,
  fs: IFileSystem = nodeFs,
  path: IFsPath = nodePath,
): ResolvedOp | undefined {
  const reg = kitRegistry(root, fs, path);
  const base = reg.resolve(node.kit, node.op) ?? (node.skill ? reg.bySkill(node.skill) : undefined);
  if (!base) return undefined;
  const ov = overrides?.[`${base.kit}.${base.op}`];
  if (!ov) return base;
  return applyToolOverride(base, {
    ...(ov.add_knowledge ? { add_knowledge: ov.add_knowledge } : {}),
    ...(ov.remove_knowledge ? { remove_knowledge: ov.remove_knowledge } : {}),
    ...(ov.model_tier ? { model_tier: ov.model_tier } : {}),
  });
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
  policy?: FlowPolicy | null,
  fs: IFileSystem = nodeFs,
  path: IFsPath = nodePath,
): TaskPackage {
  const node = flow.graph.nodes[nodeId];
  if (!node) throw new Error(`图中无节点 ${nodeId}`);
  // OS-02 阶段 C：装载预算改由「出厂默认 + policy.budget 覆盖」决定（此前是四个模块级常量，
  // 项目级改不了 ⇒ 面板无字段可渲染）。未知/越界键由 resolveBudget 显式回显进任务包。
  const budget = resolveBudget(policy);
  const CONTEXT_BUDGET = budget.values.contextBudget ?? DEFAULT_BUDGET.contextBudget?.value ?? 0;
  const SKILL_CAP = budget.values.skillCap ?? DEFAULT_BUDGET.skillCap?.value ?? 0;
  const KB_CARD_CAP = budget.values.kbCardCap;
  const KB_TOTAL_CAP = budget.values.kbTotalCap;

  // 输出契约
  const file = artifactPathOf(flow, nodeId);
  if (!file) throw new Error(`节点 ${nodeId} 未声明产物路径（file/output/outputs）`);

  // 上游产物上下文（哈希锚定 + 均摊摘录预算；穿透门节点）
  // 条件求值带上 run 状态（门裁决/根因）——与 compilePlan、前端面板同源（规范 R4 §5.2）
  const ups = effectiveUpstreams(flow, nodeId, state.inputs ?? {}, 0, condContextOf(state)).filter(
    (up) => (state.nodes[up]?.status ?? "none") === "done",
  );
  const refs = ups
    .map((up) => pathOfUpstream(projectDir, flow, up, fs, path))
    .filter((p): p is string => !!p);
  const perItem = Math.max(800, Math.floor(CONTEXT_BUDGET / Math.max(1, refs.length)));
  const context: TaskPackage["context"] = [];
  for (const ref of refs) {
    const abs = path.join(projectDir, ref);
    if (!fs.exists(abs)) continue;
    const raw = fs.readText(abs);
    const { text, truncated } = clip(raw, perItem);
    context.push({ ref, hash: contentSha12(raw), excerpt: text, truncated });
  }

  // kit 标尺（K1 装载复位）：kit/op 声明的判定条款为权威；节点 kb 仅在无 kit 归属时生效
  const opRef = resolveNodeOp(node, rootOf(), toolOverrides, fs, path);
  // R8 选择面：决策是**运行中事实**（decisions/<key>.json），装载与选技能都读它——
  // 不写回 state.inputs（铁律 6：resolveInputs 只跑一次，写回=伪造历史）。
  const decisions = decisionsMap({ fs, path }, projectDir);
  let skillPoolNote: string | undefined;
  let skillId: string | undefined;
  if (node.skill) {
    skillId = node.skill; // 节点显式指定：逃生口（有 skill_pool 的 op 上出现即 lint warn「绕过选择面」）
  } else if (opRef?.skillPool) {
    const picked = resolveSkillFromPool(opRef.skillPool, decisions, (rel) => fs.exists(path.join(rootOf(), "skills", rel)));
    skillId = picked.skill;
    skillPoolNote = picked.note;
  } else {
    skillId = opRef?.skill;
  }
  const knowledgeIds = [...new Set([...(opRef?.knowledge ?? []), ...(node.knowledge ?? node.kb ?? [])])];
  const kb = loadKnowledge(
    rootOf(),
    knowledgeIds,
    opRef?.excludeKnowledge ?? [],
    {
      total: budget.values.kbTotalCap ?? DEFAULT_BUDGET.kbTotalCap?.value ?? 9000,
      card: budget.values.kbCardCap ?? DEFAULT_BUDGET.kbCardCap?.value ?? 1600,
    },
    opRef?.knowledgePools ?? [],
    decisions,
    fs,
    path,
  );
  // R5 内容配置项：overlay.opConfig > 节点 config > op.default > 通用默认
  const ovKey = opRef ? `${opRef.kit}.${opRef.op}` : undefined;
  const cfg = resolveToolConfig(opRef, node.config, ovKey ? toolOverrides?.[ovKey]?.config : undefined);

  // 指令：标尺 + skill 方法论（封顶）+ 节点描述 + 契约回显
  let skillText = "";
  let skillTruncated = false;
  let patchMisses: string[] = [];
  if (skillId) {
    const skillFile = path.join(rootOf(), "skills", `${skillId}.md`);
    if (fs.exists(skillFile)) {
      // W-05 提示词补丁层：只有 status=applied 的 skill-overlay 补丁参与装载；
      // 未命中小节的补丁显式回显（任务包可见），不静默丢弃
      const patched = applySkillOverlay(fs.readText(skillFile), skillId, appliedPatchesFor(rootOf(), skillId, fs, path));
      const r = clip(patched.text, SKILL_CAP);
      skillText = r.text;
      skillTruncated = r.truncated;
      patchMisses = patched.misses;
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
  // R8 铁律 4：「为什么没装 X」必须有格子回答——本节与上面两段同构、语义不同（决策过滤 ≠ 缺失 ≠ 优化剔除）
  if (kb.notSelected.length) {
    parts.push(
      `## 未装载的候选（与本次决策不符——不是缺失，是过滤）\n\n${kb.notSelected.map((x) => `- ${x.id}（${x.reason}）`).join("\n")}`,
    );
  }
  if (kb.poolIssues.length) {
    parts.push(
      `## 选择面告警（池声明未能按决策求值——禁止假装已过滤）\n\n${kb.poolIssues.map((m) => `- ${m}`).join("\n")}`,
    );
  }
  if (skillPoolNote) {
    parts.push(`## 技能选择注记（skill_pool + 决策）\n\n- ${skillPoolNote}`);
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
  // OS-02 阶段 C：**未约束的旋钮显式列出**。它们不在 values 里（没有值），但旋钮是存在的——
  // 不写出来就等于「引擎偷偷替你定了档」的反面：作者不知道这里有个可调的口子。
  const unconstrained = Object.entries(cfg.defs)
    .filter(([k, d]) => !(k in cfg.values) && d.default === undefined)
    .map(([k, d]) => `- ${k} = （未约束；由执行方按自身能力选档）${d.desc ? `（${d.desc}）` : ""}`);
  if (unconstrained.length) {
    parts.push(
      `## 本步未约束的配置项（引擎不替作者拍板，见 contracts/module.schema.json）\n\n${unconstrained.join("\n")}`,
    );
  }
  if (cfg.unknownKeys.length) {
    parts.push(`## 配置告警（写了却没人认的键——禁止假装生效）\n\n${cfg.unknownKeys.map((k) => `- ${k}`).join("\n")}`);
  }
  // OS-02 阶段 C：阈值预算面的未知键/越界键显式回显（与配置告警同构——买了没生效的旋钮要说出来）。
  if (budget.issues.length) {
    parts.push(
      `## 阈值预算告警（flow.policy.budget 里没生效的键——禁止假装生效）\n\n${budget.issues.map((k) => `- ${k}`).join("\n")}`,
    );
  }
  if (patchMisses.length) {
    parts.push(`## 提示词补丁告警（skill-overlay 补丁未命中目标小节——已跳过，检查 section 拼写）\n\n${patchMisses.map((k) => `- ${k}`).join("\n")}`);
  }
  if (node.desc) parts.push(`## 本步要求\n\n${node.desc}`);
  // D5：禁词表前置。与交卷时的 glossary 断言**同源**（他项目 own 词），但用途相反——
  // 开跑前就告诉写手雷在哪，而不是写完了才打回（_918test：glossary 打回 2 次，全是别项目专名）。
  const banned = foreignOwnTerms(rootOf(), projectDir, fs, path);
  if (banned.length) {
    parts.push(
      `## 禁词表（本项目产物中不得出现；出现即 glossary 检查打回）\n\n${banned.map((w) => `- ${w}`).join("\n")}`,
    );
  }
  // v5.0（断言协议退役）：原「语义断言 unverified 清单注入评审步」的闭环已随三态裁决下架——
  // 评审步的判定依据 = K1 装载的规则语料卡（判定标尺段）+ scan_quality 证据文件（上游产物注册表可查）。
  parts.push(
    `## 输出契约\n\n- 产物路径：${file}\n- 上游依据：${refs.join("、") || "（无）"}\n- 完成后经 flow_submit 提交，提交链只做确定性完整性检查（存在/非空/残渣/头部/词汇表），不过 = 打回；质量裁决归评审 agent 与端尾验收`,
  );
  const instruction = { ...(skillId ? { skill: skillId } : {}), text: parts.join("\n\n") };

  const pkg: TaskPackage = {
    runId: state.runId,
    projectId: state.projectId ?? "",
    nodeId,
    kind: "agent",
    instruction,
    context,
    outputContract: { file },
    budget: { maxContextChars: budget.values.maxContextChars as number },
  };
  if (kb.cards.length) pkg.knowledge = kb.cards;
  if (opRef) pkg.toolConfig = cfg.values;
  if (opRef) {
    pkg.kitRef = {
      kit: opRef.kit,
      op: opRef.op,
      domain: opRef.domain,
      // R8：池+决策选中的技能优先回显（选择面生效时 kitRef 要说装的是哪个）
      skill: skillId ?? opRef.skill ?? "",
      kind: opRef.kind,
    };
  }
  // 角色剖面：节点显式声明 > 技能反向匹配 > 角色族缺省
  const prof = profileRegistry(rootOf(), fs, path).resolve({ ...node, ...(skillId ? { skill: skillId } : {}) });
  const projected = profileRegistry(rootOf(), fs, path).project(prof, skillId);
  if (projected) pkg.profile = projected;
  // K1 项目背景卡：子代理不再自行考古拼背景
  pkg.background = buildBackgroundCard(projectDir, flow, state, nodeId, fs, path);
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
  // AP1 §十：门点策略摘要随包下发——写手开跑前就知道上游哪条被降级/升级到哪一档，
  // 而不是写完才撞闸。字段未定义 = 本项目还没走过门点（区别于空串「走过但没触发」）。
  if (state.diagnosticSummary !== undefined) pkg.diagnosticSummary = state.diagnosticSummary;
  return pkg;
}
