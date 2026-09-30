/**
 * v5.0 批A · quality-scan 引擎桥 —— agent 的眼睛，只出证据不出判决。
 *
 * 存在理由（v5.0 工单 §一/§二 T 轨）：断言协议退役后，确定性计数（字数/台账矛盾/
 * 破折号配额/剧本格式…）仍必须由代码执行——LLM 数不准数（盘账：90 条台账仅 2 条
 * 真拦住过东西；prose-scan 15→0 实证）。本桥**复用** aesthetic.ts::runAestheticAsserts
 * 的单一实现，禁止在 Python 侧重写任何一条（两套真相 = 本仓旧病）。
 *
 * 与旧 check_aesthetic_asserts 的区别：不读节点声明、不做 pass/block 裁决、
 * 不进门——输出 findings 供 agent 评分取证；判决归 agent 与人（端尾验收）。
 *
 * 用法：tsx core/src/quality-cli.ts --project <项目绝对目录> --file <相对路径>
 *        [--budget '{"similePerK":2}']   （键须在 R7 §二 C 表白名单内，否则显式回显未生效）
 * 输出：stdout JSON { projectDir, file, budget, validations[], issues[] }
 */
import process from "node:process";
import { runAestheticAsserts } from "./aesthetic.js";
import { resolveBudget } from "./budget.js";
import { nodeFs, nodePath } from "./abstraction/adapters/node.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

const projectDir = arg("project");
const relPath = arg("file");
if (!projectDir || !relPath) {
  console.error("usage: tsx src/quality-cli.ts --project <projectDir> --file <relPath> [--budget json]");
  process.exit(2);
}

const absProject = nodePath.resolve(projectDir!);
const absFile = nodePath.join(absProject, relPath!);
if (!nodeFs.exists(absFile)) {
  console.error(`文件不存在: ${absFile}`);
  process.exit(3);
}

// 阈值：出厂默认为底，--budget 作 policy 式覆盖（未知键进 issues 显式回显，不静默）
const budgetArg = arg("budget");
let policyLike: Record<string, unknown> | null = null;
if (budgetArg) {
  try {
    policyLike = { budget: JSON.parse(budgetArg) };
  } catch {
    console.error("--budget 不是合法 JSON");
    process.exit(2);
  }
}
const res = resolveBudget(policyLike as never);

const validations = runAestheticAsserts(absProject, relPath!, res.values, nodeFs, nodePath);

console.log(
  JSON.stringify(
    {
      tool: "quality-cli",
      projectDir: absProject,
      file: relPath,
      budgetSources: Object.fromEntries(Object.entries(res.sources).filter(([, s]) => s === "policy")),
      issues: res.issues,
      validations,
    },
    null,
    2,
  ),
);
