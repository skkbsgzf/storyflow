// R8 选择面 · decision@1 落盘与读模型（规范 R8 §1.2）。
// 决策是**运行中产生的事实**：只长在 <项目>/decisions/<key>.json，
// 铁律 6——不许写回 flow.inputs（resolveInputs 只在 flow_run 算一次，写回=伪造历史）。
// 本模块不 import kernel.ts（kernel 要 import 本模块做读模型，避免成环——同 cfg-template 惯例）。
import type { FsIo } from "./abstraction/fs.js";
import { assertSchema } from "./schema.js";

export interface Decision {
  format: "decision@1";
  key: string;
  by: string;
  at: string;
  picked: string[];
  excluded_tags?: string[];
  evidence: string;
  confidence?: number;
}

export class DecisionError extends Error {
  constructor(public code: string, msg: string) {
    super(`[${code}] ${msg}`);
  }
}

export function decisionsDir(io: FsIo, projectDir: string): string {
  return io.path.join(projectDir, "decisions");
}

/** 落一条决策：契约校验（by/evidence 必填，无来源的决策=猜即拒）→ 原子写 → 返回落盘件。 */
export function setDecision(io: FsIo, projectDir: string, input: Partial<Decision> & { key: string }): Decision {
  const d: Decision = {
    format: "decision@1",
    key: input.key,
    by: input.by ?? "",
    at: input.at ?? new Date().toISOString(),
    picked: input.picked ?? [],
    evidence: input.evidence ?? "",
  };
  if (input.excluded_tags?.length) d.excluded_tags = input.excluded_tags;
  if (input.confidence !== undefined) d.confidence = input.confidence;
  try {
    assertSchema("decision", d);
  } catch (e) {
    throw new DecisionError("DECISION_INVALID", `${e instanceof Error ? e.message : String(e)}（key=${d.key}：by/evidence/picked 必填——无来源的决策=猜）`);
  }
  // mkdir + 原子写合并为 writeTextAtomic（父目录由它负责建，字节序列与改前一致）
  io.fs.writeTextAtomic(io.path.join(decisionsDir(io, projectDir), `${d.key}.json`), JSON.stringify(d, null, 2) + "\n");
  return d;
}

/** 读全部决策：坏文件不静默——进 issues，合法条目照常回。 */
export function listDecisions(io: FsIo, projectDir: string): { decisions: Decision[]; issues: string[] } {
  const dir = decisionsDir(io, projectDir);
  const out: Decision[] = [];
  const issues: string[] = [];
  if (!io.fs.exists(dir)) return { decisions: out, issues };
  for (const f of io.fs.readDir(dir).filter((x) => x.endsWith(".json")).sort()) {
    const rel = `decisions/${f}`;
    let raw: unknown;
    try {
      raw = JSON.parse(io.fs.readText(io.path.join(dir, f)));
    } catch (e) {
      issues.push(`${rel}: JSON 解析失败（${e instanceof Error ? e.message : String(e)}）`);
      continue;
    }
    const d = raw as Decision & { key?: string };
    if (d.format !== "decision@1") {
      issues.push(`${rel}: format≠decision@1（实际 ${String(d.format)}）`);
      continue;
    }
    if (d.key !== f.replace(/\.json$/, "")) {
      issues.push(`${rel}: key=${d.key} 与文件名不符（选择面按 key 索引，不许漂移）`);
      continue;
    }
    if (!d.by || !d.evidence || !d.picked?.length) {
      issues.push(`${rel}: 缺 by/evidence/picked——该决策不可作为过滤依据（铁律 3）`);
      continue;
    }
    out.push(d);
  }
  return { decisions: out, issues };
}

/** 求值用快照：key → Decision（坏条目由调用方经 issues 可见）。 */
export function decisionsMap(io: FsIo, projectDir: string): Record<string, Decision> {
  return Object.fromEntries(listDecisions(io, projectDir).decisions.map((d) => [d.key, d]));
}
