// kb-eval-exec.ts —— 检索质量评测执行器 + 知识装载审计器（批次3c R1）。
//
// 评测要**函数级直调** core 的 kbSearch / loadKnowledge（TS 源），python 调不动 TS——
// 本件经 core 自带 tsx 跑（与 `npx tsx src/cli.ts` 同范式：单 namespace、import 适配
// 件即完成 registerAdapters）。用法（仓库根）：
//
//   core/node_modules/.bin/tsx scripts/kb-eval-exec.ts --load-audit plan.topic-proposal --out projects/_reports/kb-load-n1-20261011.json
//     —— 真实装载路径审计：kitRegistry 解析 op 声明 → assembler.loadKnowledge
//        （出厂预算 9000/1600、空决策=冷启动，与 buildTaskPackage 同参同序），
//        出 loaded/missing/分域计数收据。批次3c N1「benchmark 装载饥饿」的实测件。
//
//   core/node_modules/.bin/tsx scripts/kb-eval-exec.ts --run --probes <探针json> --out <指标json>
//     —— 检索质量评测：逐探针调 kbSearch（k=10），算 MRR / recall@5 / recall@10，
//        总体 + 分探针型（词面/交叉）+ 分域。批次3c R2 聚类索引的 before/after
//        硬门槛（after ≥ before）用同一探针集同路径复测。
//
// 确定性纪律：本件无时钟、无随机，同输入重跑收据逐字节一致（落 projects/_reports/，
// 不入库）。口径诚实（与 tools/kb-eval.py 头注同源）：探针是词面 + 同域交叉两档，
// **不是绝对语义评测**，分数只用于 before/after 相对比较，不自称 SOTA 绝对分。
//
// 位置说明：本件在 scripts/（仓库脚本域，非 core/src），import node:fs 不受
// core/src 的 FS 抽象层红线约束（该红线只管 core/src，六豁免宿主入口除外）；
// 对 core 件的引用走相对路径 .js 说明符（tsx 重映射 .ts，与 core 内部图同款）。
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { nodeFs, nodePath } from "../core/src/abstraction/adapters/node.js";
import { rootOf } from "../core/src/schema.js";
import { kitRegistry } from "../core/src/kits.js";
import { loadKnowledge } from "../core/src/assembler.js";
import { DEFAULT_BUDGET } from "../core/src/budget.js";
import { kbSearch } from "../core/src/kb.js";

// 宿主入口纪律（R7）：import Node 适配件即完成 registerAdapters（adapters/src/node.ts
// 模块尾自动注册），缺省 fs/path 才可用——与 core/src/cli.ts 同款行法。
void nodeFs;
void nodePath;

const REPO = path.resolve(import.meta.dirname, "..");

/** 确定性 JSON 落盘：2 空格缩进 + 末尾换行；键序 = 构造序（本件可控）。 */
function writeJson(outPath: string | undefined, obj: unknown): void {
  const text = JSON.stringify(obj, null, 2) + "\n";
  if (!outPath) {
    process.stdout.write(text);
    return;
  }
  const abs = path.resolve(REPO, outPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text, "utf-8");
  process.stdout.write(`已写收据：${outPath}（${Buffer.byteLength(text)} 字节）\n`);
}

const round6 = (x: number): number => Math.round(x * 1e6) / 1e6;

interface ProbeRow {
  rank: number | null;
  rr: number;
  in5: boolean;
  in10: boolean;
  type: string;
  domain: string;
}

/** 指标组：MRR / recall@5 / recall@10（k=10 内命中即 recall@10）。 */
function metricsOf(rows: ProbeRow[]): { probeCount: number; mrr: number; "recall@5": number; "recall@10": number } {
  const n = rows.length;
  if (!n) return { probeCount: 0, mrr: 0, "recall@5": 0, "recall@10": 0 };
  const sum = (f: (r: ProbeRow) => number) => rows.reduce((a, r) => a + f(r), 0);
  return {
    probeCount: n,
    mrr: round6(sum((r) => r.rr) / n),
    "recall@5": round6(sum((r) => (r.in5 ? 1 : 0)) / n),
    "recall@10": round6(sum((r) => (r.in10 ? 1 : 0)) / n),
  };
}

// ── 模式一：知识装载审计（N1 实测件）──

function loadAudit(kitOp: string): unknown {
  const [kit, op] = kitOp.split(".");
  if (!kit || !op) throw new Error(`--load-audit 参数形如 <kit>.<op>，得到：${kitOp}`);
  const opRef = kitRegistry(rootOf()).resolve(kit, op);
  if (!opRef) throw new Error(`模块解析失败：${kit}.${op}（modules/${kit}/module.json 里没有这个 op）`);
  // 与 assembler.buildTaskPackage 同参同序的真实装载路径：出厂预算 + 冷启动（空决策）。
  // flow 未覆写 budget（grep 证），决策缺失时 buildTaskPackage 也传 {}——此处即冷启动真值。
  const caps = {
    total: DEFAULT_BUDGET.kbTotalCap?.value ?? 9000,
    card: DEFAULT_BUDGET.kbCardCap?.value ?? 1600,
  };
  const kb = loadKnowledge(rootOf(), opRef.knowledge, opRef.excludeKnowledge ?? [], caps, opRef.knowledgePools ?? {}, {});
  const domainOf = (id: string) => id.split("/")[1] ?? "";
  const countBy = (list: string[]): Record<string, number> => {
    const m: Record<string, number> = {};
    for (const id of list) m[domainOf(id)] = (m[domainOf(id)] ?? 0) + 1;
    return m;
  };
  return {
    format: "kb-load-audit@1",
    口径:
      "真实装载路径：kitRegistry 解析 op 声明 → assembler.loadKnowledge（出厂预算 kbTotalCap=9000/kbCardCap=1600，空决策=冷启动；与 buildTaskPackage 同参同序，flow 未覆写 budget）。声明序 first-fit、超顶进 missing 显式回显。收据无时间戳，重跑逐字节一致。",
    kit,
    op,
    declared: opRef.knowledge,
    excludeKnowledge: opRef.excludeKnowledge,
    knowledgePools: opRef.knowledgePools,
    caps,
    loaded: kb.cards.map((c) => ({ id: c.id, chars: c.chars, ...(c.truncated ? { truncated: true } : {}) })),
    missing: kb.missing,
    excluded: kb.excluded,
    notSelected: kb.notSelected,
    poolIssues: kb.poolIssues,
    loadedCount: kb.cards.length,
    loadedChars: kb.cards.reduce((a, c) => a + c.chars, 0),
    truncatedCount: kb.cards.filter((c) => c.truncated).length,
    domainLoadedCounts: countBy(kb.cards.map((c) => c.id)),
    domainMissingCounts: countBy(kb.missing),
  };
}

// ── 模式二：检索质量评测（before/after 硬门槛的度量件）──

interface Probe {
  id: string;
  type: string;
  domain: string;
  target: string;
  query: string;
  donor?: string;
}

function runEval(probesPath: string): unknown {
  const abs = path.resolve(REPO, probesPath);
  const raw = fs.readFileSync(abs, "utf-8");
  const probes: Probe[] = (JSON.parse(raw) as { probes?: Probe[] }).probes ?? [];
  if (!probes.length) throw new Error(`探针集为空：${probesPath}`);
  const knowledgeDir = path.join(rootOf(), "knowledge");
  const K = 10; // 一次调用取 top-10，recall@5/@10 从同一结果切片（与单次检索行为一致）
  const perProbe: Array<ProbeRow & { id: string; domain: string; type: string; target: string; query: string; donor?: string; hit: boolean; top1: string | null }> = [];
  for (const p of probes) {
    const { hits } = kbSearch(knowledgeDir, { q: p.query, k: K });
    const idx = hits.findIndex((h) => h.id === p.target);
    const rank = idx >= 0 ? idx + 1 : null;
    perProbe.push({
      id: p.id,
      type: p.type,
      domain: p.domain,
      target: p.target,
      query: p.query,
      ...(p.donor ? { donor: p.donor } : {}),
      rank,
      rr: rank ? round6(1 / rank) : 0,
      hit: rank !== null,
      in5: rank !== null && rank <= 5,
      in10: rank !== null && rank <= 10,
      top1: hits[0]?.id ?? null,
    });
  }
  const byType: Record<string, ProbeRow[]> = {};
  const byDomain: Record<string, ProbeRow[]> = {};
  for (const r of perProbe) {
    (byType[r.type] ??= []).push(r);
    (byDomain[r.domain] ??= []).push(r);
  }
  const metricMap = (groups: Record<string, ProbeRow[]>): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(groups).sort()) out[k] = metricsOf(groups[k]);
    return out;
  };
  return {
    format: "kb-eval-metrics@1",
    口径:
      "逐探针直调 core/src/kb.ts::kbSearch（k=10，全局库、无项目档），对期望命中卡取名次。指标=MRR/recall@5/recall@10（总体+分探针型+分域）。探针两档（词面/同域交叉）非绝对语义评测——只用于 before/after 同探针集相对比较（R2 聚类索引硬门槛 after≥before），不自称 SOTA 绝对分。无时间戳无随机，重跑逐字节一致。",
    probesFile: path.relative(REPO, abs).replaceAll("\\", "/"),
    probesSha256: crypto.createHash("sha256").update(raw, "utf-8").digest("hex"),
    k: K,
    metrics: metricsOf(perProbe),
    byType: metricMap(byType),
    byDomain: metricMap(byDomain),
    perProbe,
  };
}

// ── 入口 ──

const args = process.argv.slice(2);
const getOpt = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const loadAuditArg = getOpt("--load-audit");
const probesPath = getOpt("--probes");
if (!loadAuditArg && !probesPath) {
  console.error("用法：tsx scripts/kb-eval-exec.ts --load-audit <kit>.<op> [--out <json>] 或 --run --probes <json> [--out <json>]");
  process.exit(2);
}
if (loadAuditArg) {
  writeJson(getOpt("--out"), loadAudit(loadAuditArg));
} else if (probesPath) {
  writeJson(getOpt("--out"), runEval(probesPath));
}
