/**
 * diagnostics@1 · 旁路失败留痕（R8-OPS 诊断通道）
 *
 * 为什么需要它
 * ------------
 * 本仓有一类反复复发的病：**崩掉当没事 / 以为有其实没有**。它们共同的载体是裸 `catch {}`：
 *   · N6 —— `contracts/metrics.schema.json` 的 `phase.enum` 漏了 `link` ⇒ `recordMetric` 抛
 *     SchemaViolation ⇒ 被 `kernel.metric` 的 `catch {}`（注释写着「指标是旁路」）吞掉。
 *     实盘 11 个项目 + `_archived` 共 436 行 metrics，`link` 相 **0 条**、`boundary` 相 **0 条**，
 *     连接件驳回率对优化器完全不可见——而"指标是唯一调优依据"是本仓的第一原则。
 *   · `validate-kb` 的 FAIL 曾被 `KeyError:'graph'` 崩溃掩盖整批。
 *
 * 判据（不是所有 catch 都要改）
 * ----------------------------
 * 只有「**吞掉就会改变结论 / 让能力静默失效**」的 catch 必须留痕：
 *   ✅ 指标写入失败（后果：指标撒谎）
 *   ✅ 断言链台账读取失败（后果：声明了却不执行，且显示为无别名"正常"）
 *   ✅ 知识库索引读取失败（后果：上下文命中率结构性归零，被当成"标尺没用上"的证据）
 *   ✅ 审美/词汇表台账缺失（后果：去机味、禁忌词检查静默不适用）
 *   ❌ 半行 JSON 跳过、锁目录清理、默认值回退——纯容错，吞掉是对的
 *
 * 纪律
 * ----
 * 本模块**永不抛异常**：记账自身失败绝不能级联成业务失败。stderr 与文件双通道，
 * 任一失败都静默放弃（已经尽力外显过了）。
 *
 * 落点：`<dir>/registry/diagnostics.jsonl`。`dir` 既可以是项目目录，也可以是仓库根
 * （仓库级台账如 `knowledge/index.json` 的失败记在 `<root>/registry/`——与 `optimize.ts`
 * 读 `<root>/registry/miner-findings.json` 的既有约定一致）。
 */
import fs from "node:fs";
import path from "node:path";

export const DIAG_FORMAT = "diag@1";

export type DiagKind = "metric" | "assert" | "kb" | "aesthetic" | "overlay" | "feedback" | "io" | "other";

export interface DiagRecord {
  ts: string;
  format: typeof DIAG_FORMAT;
  kind: DiagKind;
  scope: string;
  detail: string;
}

export interface DiagSummary {
  count: number;
  byKind: Record<string, number>;
  byScope: Record<string, number>;
  recent: DiagRecord[];
}

const MAX_DETAIL = 500;
/** 进程内 stderr 去重：同一 (kind, scope) 只喊一次，避免长跑刷屏（文件仍逐条落盘）。 */
const seen = new Set<string>();

export function diagPath(dir: string): string {
  return path.join(dir, "registry", "diagnostics.jsonl");
}

/**
 * 记录一条旁路失败。返回落盘记录（便于测试断言）。**不抛异常。**
 */
export function recordDiag(dir: string, kind: DiagKind, scope: string, detail: unknown): DiagRecord {
  const msg = detail instanceof Error ? detail.message : String(detail);
  const rec: DiagRecord = {
    ts: new Date().toISOString(),
    format: DIAG_FORMAT,
    kind,
    scope,
    detail: msg.replace(/\s+/g, " ").slice(0, MAX_DETAIL),
  };
  const key = `${kind}|${scope}`;
  if (!seen.has(key)) {
    seen.add(key);
    try {
      process.stderr.write(`[diag:${kind}] ${scope} — ${rec.detail}\n`);
    } catch {
      /* 连 stderr 都写不了：只能放弃 */
    }
  }
  try {
    fs.mkdirSync(path.dirname(diagPath(dir)), { recursive: true });
    fs.appendFileSync(diagPath(dir), JSON.stringify(rec) + "\n", "utf-8");
  } catch {
    /* 记账自身失败：已尽力外显，不再级联 */
  }
  return rec;
}

/** 坏行容错读（与 `fsio.readJsonl` 同纪律：一行坏不炸整读）。 */
export function readDiags(dir: string, limit = 500): DiagRecord[] {
  let raw = "";
  try {
    raw = fs.readFileSync(diagPath(dir), "utf-8");
  } catch {
    return [];
  }
  const out: DiagRecord[] = [];
  for (const line of raw.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    try {
      out.push(JSON.parse(s) as DiagRecord);
    } catch {
      /* 坏行跳过 */
    }
  }
  return limit > 0 ? out.slice(-limit) : out;
}

/** 汇总：总数 + 分类计数 + 最近若干条（供 `flow_effect` / HTTP 面 / 页面展示）。 */
export function summarizeDiags(dir: string, recentLimit = 10): DiagSummary {
  const all = readDiags(dir, 0);
  const byKind: Record<string, number> = {};
  const byScope: Record<string, number> = {};
  for (const d of all) {
    byKind[d.kind] = (byKind[d.kind] ?? 0) + 1;
    byScope[d.scope] = (byScope[d.scope] ?? 0) + 1;
  }
  return { count: all.length, byKind, byScope, recent: all.slice(-recentLimit) };
}

/** 测试专用：清空进程内 stderr 去重表（不影响已落盘记录）。 */
export function resetDiagDedupe(): void {
  seen.clear();
}
