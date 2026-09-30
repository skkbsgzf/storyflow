// R8 选择面 · resolveSelection（规范 R8 §1.3）——与 `resolveBudget` 同构：纯函数、无 IO、
// 返回 `{loaded, excluded, issues}`。治的病：**「选择」这件事在本仓没有家**——
// 候选库（knowledge/skills）只有「装不装得下」的截断（caps）与「点名清单」（ids），
// 没有「因与本次决策不符而主动不选」这一格。excluded 必须带理由（铁律 4）。
//
// 依赖纪律：本文件不 import kernel/assembler（selection 被 assembler 调用，不得成环）。
import fs from "node:fs";
import path from "node:path";

/** 候选库条目（求值用最小投影；完整形状见 contracts/catalog-entry.schema.json）。 */
export interface CatalogEntryLite {
  id: string;
  tags: string[];
}

/** 决策的求值投影（decision@1 的子集——坏的/缺来源的进不了这里）。 */
export interface DecisionLite {
  key: string;
  picked: string[];
  excluded_tags?: string[];
}

/** 池过滤声明。`$decision:<key>.<picked|tags|excluded_tags>` 是唯一的决策引用语法（不新造 DSL）。 */
export interface PoolWhere {
  tags?: string[];
  notTags?: string[];
}

export interface PoolDecl {
  /** `kb/trope/*` 目录池，或 `kb/aesthetic/style-routes` 精确条目 */
  pool: string;
  where?: PoolWhere;
  /** 缺省 block：显式不装，不装作选了、也不全装（铁律 2） */
  onMissingDecision?: "block" | "load-all-with-warning";
}

export interface ExcludedCandidate {
  id: string;
  decisionKey: string;
  reason: string;
}

export interface SelectionResult {
  loaded: CatalogEntryLite[];
  /** 因与决策不符而未选——不是缺失（missing）、不是优化器剔除（exclude），是第三类 */
  excluded: ExcludedCandidate[];
  issues: string[];
}

const REF = /^\$decision:([a-z][a-z0-9-]*)\.(picked|tags|excluded_tags)$/;

/**
 * 展开 one token → 标签数组。返回 undefined = 引用了不存在的决策（由调用方按
 * onMissingDecision 处置）；返回数组（含空）= 可求值。`tags` 是 `picked` 的别名（人写更顺）。
 */
export function expandTagToken(token: string, decisions: Record<string, DecisionLite>): string[] | undefined {
  const m = REF.exec(token.trim());
  if (!m) return [token];
  const d = decisions[m[1] ?? ""];
  if (!d) return undefined;
  return m[2] === "excluded_tags" ? [...(d.excluded_tags ?? [])] : [...d.picked];
}

/** pool → 该池的候选条目（前缀匹配；精确 id 单条）。 */
export function inScope(entry: CatalogEntryLite, pool: string): boolean {
  if (pool.endsWith("/*")) return entry.id.startsWith(pool.slice(0, -1));
  return entry.id === pool || entry.id.startsWith(`${pool}/`);
}

/**
 * 选择面求交（纯函数）：候选条目 ⊗ 决策 → 装载/排除/告警。
 * - 正过滤 `where.tags`：条目 tags 与展开集有交集才装载；无标签条目=未被命中=不装（铁律 2，带理由回显）。
 * - 反过滤 `where.notTags`：条目 tags 命中被排除标签即不装。
 * - 缺决策：block ⇒ 整池不装 + issues；load-all-with-warning ⇒ 全装 + issues（任务包出告警段）。
 */
export function resolveSelection(
  entries: CatalogEntryLite[],
  decisions: Record<string, DecisionLite>,
  decl: PoolDecl,
): SelectionResult {
  const scoped = entries.filter((e) => inScope(e, decl.pool));
  const excluded: ExcludedCandidate[] = [];
  const issues: string[] = [];
  const missingKeys = new Set<string>();
  const refKeys = new Set<string>();

  const expand = (tokens: string[] | undefined): string[] | undefined => {
    if (!tokens?.length) return [];
    const out: string[] = [];
    for (const t of tokens) {
      const m = REF.exec(t.trim());
      if (m?.[1]) refKeys.add(m[1]);
      const v = expandTagToken(t, decisions);
      if (v === undefined) {
        missingKeys.add(m?.[1] ?? t.trim());
        continue;
      }
      out.push(...v);
    }
    return out;
  };
  const want = expand(decl.where?.tags);
  const not = expand(decl.where?.notTags);

  if (missingKeys.size) {
    const keys = [...missingKeys].join("、");
    if ((decl.onMissingDecision ?? "block") === "block") {
      issues.push(`池 ${decl.pool}：引用决策 ${keys} 不存在——block：整池不装载（set_decision 落决策，或显式声明 onMissingDecision=load-all-with-warning）`);
      for (const e of scoped) excluded.push({ id: e.id, decisionKey: keys, reason: "决策缺失（block），未参与求值" });
      return { loaded: [], excluded, issues };
    }
    issues.push(`池 ${decl.pool}：引用决策 ${keys} 不存在——按声明全装（load-all-with-warning），本步未按决策过滤`);
    return { loaded: scoped, excluded, issues };
  }

  const tagUniverse = new Set(scoped.flatMap((e) => e.tags));
  const decisionKey = [...refKeys].join("、") || decl.pool;
  const loaded: CatalogEntryLite[] = [];
  for (const e of scoped) {
    const hitNot = (not ?? []).find((t) => e.tags.includes(t));
    if (hitNot) {
      excluded.push({ id: e.id, decisionKey, reason: `标签「${hitNot}」在排除名单里` });
      continue;
    }
    if (want?.length) {
      const hit = want.find((t) => e.tags.includes(t));
      if (hit) {
        loaded.push(e);
        continue;
      }
      excluded.push({
        id: e.id,
        decisionKey,
        reason: e.tags.length ? `标签 ${e.tags.join("/")} 不含本次所选 ${want.join("/")}` : `无标签候选不参与匹配（铁律 2：未命中=不装；补标签见 S4）`,
      });
      continue;
    }
    loaded.push(e); // 无正过滤 = 池内全装（notTags 仍生效）
  }
  // 决策引用的标签必须在候选池的 tags 并集里（§1.2 可校验）；找不到 = 决策写错，显式回显不静默
  const orphan = (want ?? []).filter((t) => t !== "all" && !tagUniverse.has(t));
  if (orphan.length) {
    issues.push(`池 ${decl.pool}：决策所选标签 ${orphan.join("、")} 在候选里不存在（决策引用了不存在的标签——检查 set_decision 的 picked）`);
  }
  return { loaded, excluded, issues };
}

// ── IO 适配器：候选库条目的磁盘读法（出厂候选在 repoRoot——两个根纪律，铁律 5）──

/** 读 knowledge md 的 JSON frontmatter（`---` 包裹）；解析失败 = 无标签，不炸。 */
function fmTags(file: string): string[] {
  try {
    const raw = fs.readFileSync(file, "utf-8");
    const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
    if (!m) return [];
    const fm = JSON.parse(m[1] ?? "{}") as { tags?: unknown; routes?: unknown };
    const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
    // routes 是旧名（S4 做 routes→tags 迁移）；此处并集读，两条轴都能过滤
    return [...new Set([...list(fm.tags), ...list(fm.routes)])];
  } catch {
    return [];
  }
}

/** 展开一个 pool 的候选条目（id 口径与 resolveKbPaths 的 toId 一致：kb/<相对路径去 .md>）。 */
export function poolEntries(root: string, pool: string): CatalogEntryLite[] {
  const kbRoot = path.join(root, "knowledge");
  const rel = pool.replace(/^kb\//, "").replace(/\/\*$/, "");
  const base = path.join(kbRoot, rel);
  const toId = (f: string): string => "kb/" + path.relative(kbRoot, f).replaceAll("\\", "/").replace(/\.md$/, "");
  const out: CatalogEntryLite[] = [];
  const pushFile = (f: string): void => {
    if (f.endsWith(".md")) out.push({ id: toId(f), tags: fmTags(f) });
  };
  if (!fs.existsSync(base)) return out;
  if (fs.statSync(base).isDirectory()) {
    for (const f of fs.readdirSync(base).sort()) {
      const p = path.join(base, f);
      if (fs.statSync(p).isFile()) pushFile(p);
    }
  } else {
    pushFile(base);
  }
  return out;
}

/**
 * skill_pool 求值（§2.2）：`style/*` + `decisions.style.picked=[zhang_ailing]` → `zhang_ailing`。
 * 无决策 = 显式报缺不回落（回落 = 引擎替作者挑文风 = 死约束）；
 * picked 指向不存在的技能文件 = 显式报缺（声明即契约）。
 * 返回 `{ skill, note }`：note 供任务包告警段（多选中只装首个——单技能装载语义）。
 */
export function resolveSkillFromPool(
  pool: string,
  decisions: Record<string, DecisionLite>,
  skillExists: (rel: string) => boolean,
): { skill: string; note?: string } {
  const key = pool.replace(/^([^/]+)\/.*$/, "$1");
  const dir = pool.endsWith("/*") ? pool.slice(0, -2) : null;
  const d = decisions[key];
  if (!d || !d.picked.length) {
    throw new Error(
      `选择未决: skill_pool=${pool} 没有决策（decisions/${key}.json）——须 set_decision，或在节点上显式逃生口 skill 字段；不回落`,
    );
  }
  const hit = d.picked.find((p) => skillExists(`${p}.md`) || (dir && skillExists(`${dir}/${p}.md`)));
  if (!hit) {
    throw new Error(
      `skill_pool=${pool}：决策 ${key}.picked=[${d.picked.join("、")}] 没有对应技能文件——声明即契约，不回落`,
    );
  }
  const note =
    d.picked.length > 1
      ? `决策 ${key} 选中 ${d.picked.length} 项（${d.picked.join("、")}），技能装载取首个命中：${hit}`
      : undefined;
  return { skill: dir && skillExists(`${dir}/${hit}.md`) ? `${dir}/${hit}` : hit, ...(note ? { note } : {}) };
}
