/**
 * 批次3a P6 · 快诊断回归（diag_scan 动词 + diagnosis-report@1 + validation 声明位变现）：
 *  ① 注册：diag_scan 在动词单表里（MCP tool specs / CLI usage 由表派生，关系断言不抄名单）；
 *  ② 缺省语义 + S 级产出：无 validation 块 → 契约缺省（S+A/both/minor）回显 source=default；
 *     S 级=aesthetic 引擎真身进程内直调，合成文本命中 AE-PROSE-SLOP → evidence 带
 *     scanner/location/metric/receipt，报告与收据落盘（reports/ ＋ registry/receipts/）；
 *  ③ 契约字段位：报告顶层/engines/evidence/items 逐键对照 contracts/diagnosis-report.schema.json
 *     （手工等价，同 tools/diagnosis-validate.py 的 check_shape 口径）；
 *  ④ tierThreshold 通道门槛：=["S"] 时 proposal=true 也不进 A 通道（不触发 laya，engines.a 未跑有因）；
 *  ⑤ cardScope 消费：global=只装全局卡 / project=只装项目卡 / both=双家——items 只由装到的卡投影；
 *  ⑥ severityFloor 消费：block 下限把 major 项滤掉（评审优先级过滤，不是闸）；
 *  ⑦ dims 域过滤：对得上卡域的按域丢弃，对不上的全跑并注明（诚实边界）；
 *  ⑧ A 级缺失适配器显式失败：proposal=true 且缺 venv/权重 → LAYA_UNAVAILABLE(503)，
 *     错误文案带缺失路径/回填口径/验证方法，绝不静默降级。
 * 全程合成 fixture（临时数据根 + 临时 repoRoot），LLM/慢件零参与——S 级是纯 TS 进程内调用。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { Kernel, KernelError } from "../src/kernel.js";
import { VERB_BY_NAME, VERB_NAMES, usageFromVerbs, verbToolSpecs } from "../src/verbs.js";
import type { DiagScanResult } from "../src/diagnosis.js";

const PID = "p-diag-demo";
const VERB = VERB_BY_NAME["diag_scan"];

/** 合成待诊文本：含 AI 高频词（「值得注意的是」）→ AE-PROSE-SLOP 必命中；末段无钩型信号 → AE-WNF-HOOK 必命中。 */
const TEXT = [
  "# 第001章 合成体检样本",
  "",
  "值得注意的是，她把那枚铜币按在柜台上，没有说话。",
  "店主抬头看了一眼，又低头继续擦杯子。值得注意的是，柜后的门缝里透出一线光。",
  "她把铜币收回口袋，转身走进巷口。",
  "",
].join("\n");

/** 项目规则卡（pj- 命名空间，synthetic 域；条款 id 对齐引擎 AE-id——T 轨 id 上卡是项目卡合法用法）。 */
const PROJECT_CARD = [
  "---",
  JSON.stringify(
    {
      id: "pj-rules/slop-dev",
      type: "rule-corpus",
      title: "合成域 · 项目机味卡（fixture）",
      dimension: "slop-dev",
      version: "0.1.0",
      status: "active",
      activation_hint: ["m3.成文"],
      provenance: { source: "测试合成卡，非真实语料", refs: ["AE-PROSE-SLOP"] },
      updated: "2026-10-10",
      format: "rule-card@1",
      clauses: [
        {
          rule_id: "AE-PROSE-SLOP",
          tier: "S",
          severity: "major",
          judge: "正文命中 AI 高频词表",
          repair: "删改 AI 高频词，改用具体动作与感官落点",
        },
      ],
      scanner_qids: [],
    },
    null,
    2,
  ),
  "---",
  "",
  "# 合成域项目卡（fixture）",
  "",
].join("\n");

/** 全局规则卡（装在临时 repoRoot 的 knowledge/rules/ 下；域 hook，条款同样对齐引擎 AE-id）。 */
const GLOBAL_CARD = [
  "---",
  JSON.stringify(
    {
      id: "kb/rules/hook-fixture",
      type: "rule-corpus",
      title: "钩子域 · 全局卡（fixture）",
      dimension: "hook",
      version: "0.1.0",
      status: "active",
      activation_hint: ["端尾验收"],
      provenance: { source: "测试合成卡，非真实语料", refs: ["AE-WNF-HOOK"] },
      updated: "2026-10-10",
      format: "rule-card@1",
      clauses: [
        {
          rule_id: "AE-WNF-HOOK",
          tier: "S",
          severity: "block",
          judge: "章末无钩",
          repair: "章末三段内补悬念问句或转折信号",
        },
      ],
      scanner_qids: [],
    },
    null,
    2,
  ),
  "---",
  "",
  "# 钩子域全局卡（fixture）",
  "",
].join("\n");

interface Fixture {
  kernel: Kernel;
  root: string;
  projectDir: string;
}

/** 临时数据根 ＋ 临时 repoRoot（同目录）：全局卡可造、laya venv/权重天然缺位。 */
function mkFixture(opts: { validation?: Record<string, unknown>; withProjectCard?: boolean } = {}): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "diag-scan-"));
  fs.mkdirSync(path.join(root, "projects", PID, "章节正文"), { recursive: true });
  fs.mkdirSync(path.join(root, "projects", PID, "规则"), { recursive: true });
  const cfg: Record<string, unknown> = { 项目: PID };
  if (opts.validation) cfg.validation = opts.validation;
  fs.writeFileSync(path.join(root, "projects", PID, "项目配置.json"), JSON.stringify(cfg, null, 2) + "\n", "utf-8");
  fs.writeFileSync(path.join(root, "projects", PID, "章节正文", "第001章-合成.md"), TEXT, "utf-8");
  if (opts.withProjectCard) {
    fs.writeFileSync(path.join(root, "projects", PID, "规则", "pj-rules-slop-dev.md"), PROJECT_CARD, "utf-8");
  }
  fs.mkdirSync(path.join(root, "knowledge", "rules"), { recursive: true });
  fs.writeFileSync(path.join(root, "knowledge", "rules", "hook-fixture.md"), GLOBAL_CARD, "utf-8");
  const kernel = new Kernel({ root, repoRoot: root });
  return { kernel, root, projectDir: path.join(root, "projects", PID) };
}

function scan(f: Fixture, args: Record<string, unknown>): DiagScanResult {
  return VERB.run(f.kernel, { project: PID, ...args }) as DiagScanResult;
}

function evOf(r: DiagScanResult, scanner: string): Record<string, unknown> | undefined {
  return (r.report.evidence as Record<string, unknown>[]).find((e) => e.scanner === scanner);
}

// ── diagnosis-validate.py check_shape 的 TS 手工等价（只断形状，不引外部校验器）──
const TOP_REQUIRED = ["format", "project", "target", "engines", "evidence", "items", "summary", "receipt"] as const;
const TOP_OPTIONAL = ["opinion"];
const EVIDENCE_REQUIRED = ["location"] as const;
const EVIDENCE_OPTIONAL = ["rule_ref", "quote", "metric", "scanner", "receipt"];
const ITEM_REQUIRED = ["rule_ref", "tier", "severity", "suggestion"] as const;
const TIERS = ["S", "A", "B"];
const SEVERITIES = ["block", "major", "minor"];

function assertReportShape(report: Record<string, unknown>): void {
  for (const k of TOP_REQUIRED) expect(report, `顶层缺必填 ${k}`).toHaveProperty(k);
  for (const k of Object.keys(report)) {
    expect([...TOP_REQUIRED, ...TOP_OPTIONAL], `顶层未知键 ${k}`).toContain(k);
  }
  expect(report.format).toBe("diagnosis-report@1");
  const engines = report.engines as Record<string, { ran: boolean; note?: string }>;
  for (const k of Object.keys(engines)) expect(["s", "a", "agent"]).toContain(k);
  for (const e of Object.values(engines)) {
    expect(typeof e.ran).toBe("boolean");
    for (const k of Object.keys(e)) expect(["ran", "note"]).toContain(k);
  }
  const evidence = report.evidence as Record<string, unknown>[];
  expect(Array.isArray(evidence)).toBe(true);
  for (const ev of evidence) {
    for (const k of Object.keys(ev)) expect([...EVIDENCE_REQUIRED, ...EVIDENCE_OPTIONAL]).toContain(k);
    expect(String(ev.location).length).toBeGreaterThan(0);
  }
  const items = report.items as Record<string, unknown>[];
  expect(Array.isArray(items)).toBe(true);
  for (const it of items) {
    expect(Object.keys(it).sort()).toEqual([...ITEM_REQUIRED].sort());
    expect(TIERS).toContain(it.tier);
    expect(SEVERITIES).toContain(it.severity);
    for (const k of ITEM_REQUIRED) expect(typeof it[k]).toBe("string");
  }
  expect(report.receipt).toBeTruthy(); // 收据制：本路径必有 S 级收据可附
  expect(typeof report.summary).toBe("string");
}

afterEach(() => {
  // 临时根由各用例自清理兜底（Windows 句柄释放后再删）
});

function rmrf(p: string): void {
  fs.rmSync(p, { recursive: true, force: true });
}

describe("批次3a P6 · diag_scan 注册与产出", () => {
  it("① diag_scan 在动词单表：三面派生物（MCP specs / CLI usage）自动认得，参数形状正确", () => {
    expect(VERB_NAMES).toContain("diag_scan");
    expect(VERB.group.length).toBeGreaterThan(0);
    const names = VERB.params.map((p) => p.name);
    expect(names).toEqual(["project", "text", "path", "dims", "proposal"]);
    expect(VERB.params.find((p) => p.name === "project")?.required).toBe(true);
    expect(verbToolSpecs().map((s) => s.name)).toContain("diag_scan");
    expect(usageFromVerbs()).toContain("diag_scan");
  });

  it("② 缺省语义 + S 级产出：无 validation 块 → 缺省回显；AE-PROSE-SLOP 进 evidence，报告+收据落盘", () => {
    const f = mkFixture();
    try {
      const r = scan(f, { path: "章节正文/第001章-合成.md" });
      expect(r.ok).toBe(true);
      expect(r.applied_validation).toEqual({ tierThreshold: ["S", "A"], cardScope: "both", severityFloor: "minor", source: "default" });
      // S 级命中：合成文本的 AI 高频词必被引擎捕获，证据带稳定 AE-id 与机读位
      const ev = evOf(r, "AE-PROSE-SLOP");
      expect(ev, "AE-PROSE-SLOP 应命中（合成文本含两处「值得注意的是」）").toBeTruthy();
      expect(ev?.location).toBe("章节正文/第001章-合成.md");
      expect(String(ev?.metric)).toContain("值得注意的是");
      expect(ev?.receipt).toBe(r.receipt_path);
      // 全局卡（fixture）条款对齐引擎 id → 机械投影成 item（建议=repair 原文，同源铁律）
      const items = r.report.items as { rule_ref: string; tier: string; severity: string; suggestion: string }[];
      expect(items.some((i) => i.rule_ref === "kb/rules/hook-fixture#AE-WNF-HOOK" && i.tier === "S" && i.severity === "block")).toBe(true);
      // 落盘：报告进 reports/，收据进 registry/receipts/，且路径真实存在
      expect(r.report_path).toMatch(/^reports\/diagnosis-.*\.json$/);
      expect(r.receipt_path).toMatch(/^registry\/receipts\/diag-scan-.*\.json$/);
      expect(fs.existsSync(path.join(f.projectDir, r.report_path))).toBe(true);
      expect(fs.existsSync(path.join(f.projectDir, r.receipt_path))).toBe(true);
      // ③ 契约字段位（diagnosis-validate 同款形状，落盘件与返回体都要过）
      assertReportShape(r.report);
      assertReportShape(JSON.parse(fs.readFileSync(path.join(f.projectDir, r.report_path), "utf-8")) as Record<string, unknown>);
    } finally {
      rmrf(f.root);
    }
  });

  it("④ tierThreshold 通道门槛：=[\"S\"] 时 proposal=true 也不进 A 通道（不触发 laya 预检），engines.a 未跑有因", () => {
    const f = mkFixture({ validation: { tierThreshold: ["S"], cardScope: "both", severityFloor: "minor" } });
    try {
      // 若通道门槛失效，这里会走进 laya 预检并在缺权重时抛 LAYA_UNAVAILABLE——不抛即门槛生效
      const r = scan(f, { path: "章节正文/第001章-合成.md", proposal: true });
      const engines = r.report.engines as Record<string, { ran: boolean; note: string }>;
      expect(engines.a?.ran).toBe(false);
      expect(engines.a?.note).toContain("不含 A");
      expect(engines.s?.ran).toBe(true);
      expect(r.applied_validation.source).toBe("project-config");
    } finally {
      rmrf(f.root);
    }
  });

  it("⑤ cardScope 消费：project 只装项目卡（pj- 卡投影成 item）；global 只装全局卡；both 双家", () => {
    const fP = mkFixture({ validation: { cardScope: "project" }, withProjectCard: true });
    try {
      const r = scan(fP, { path: "章节正文/第001章-合成.md" });
      const items = r.report.items as { rule_ref: string }[];
      // 项目卡对齐引擎 id → item 来自 pj-rules/slop-dev；全局卡不装 → hook 卡条款不出现
      expect(items.some((i) => i.rule_ref === "pj-rules/slop-dev#AE-PROSE-SLOP")).toBe(true);
      expect(items.some((i) => i.rule_ref.startsWith("kb/rules/"))).toBe(false);
      expect(r.applied_validation.cardScope).toBe("project");
    } finally {
      rmrf(fP.root);
    }
    const fG = mkFixture({ validation: { cardScope: "global" }, withProjectCard: true });
    try {
      const r = scan(fG, { path: "章节正文/第001章-合成.md" });
      const items = r.report.items as { rule_ref: string }[];
      expect(items.some((i) => i.rule_ref === "pj-rules/slop-dev#AE-PROSE-SLOP")).toBe(false);
      expect(items.some((i) => i.rule_ref === "kb/rules/hook-fixture#AE-WNF-HOOK")).toBe(true);
    } finally {
      rmrf(fG.root);
    }
  });

  it("⑥ severityFloor 消费：=block 时 major 项被滤出报告（评审优先级下限，不是闸）", () => {
    const on = mkFixture({ validation: { severityFloor: "minor" }, withProjectCard: true });
    try {
      const r = scan(on, { path: "章节正文/第001章-合成.md" });
      expect((r.report.items as unknown[]).some((i) => (i as { rule_ref: string }).rule_ref === "pj-rules/slop-dev#AE-PROSE-SLOP")).toBe(true);
    } finally {
      rmrf(on.root);
    }
    const off = mkFixture({ validation: { severityFloor: "block" }, withProjectCard: true });
    try {
      const r = scan(off, { path: "章节正文/第001章-合成.md" });
      expect((r.report.items as unknown[]).some((i) => (i as { rule_ref: string }).rule_ref === "pj-rules/slop-dev#AE-PROSE-SLOP")).toBe(false);
      // 但证据不动：floor 只滤 items，机器证据全量保留
      expect(evOf(r, "AE-PROSE-SLOP")).toBeTruthy();
    } finally {
      rmrf(off.root);
    }
  });

  it("⑦ dims 域过滤：对得上卡域的按域丢弃，对不上的全跑并注明（诚实边界）", () => {
    const f = mkFixture({ withProjectCard: true });
    try {
      const r = scan(f, { path: "章节正文/第001章-合成.md", dims: ["kb/rules/hook"] });
      // slop-dev 域对得上项目卡 → 域外丢弃；hook 对得上全局卡 → 保留
      expect(evOf(r, "AE-PROSE-SLOP")).toBeUndefined();
      expect(evOf(r, "AE-WNF-HOOK")).toBeDefined();
      const engines = r.report.engines as Record<string, { note: string }>;
      expect(engines.s?.note).toContain("域外丢弃 1 条");
    } finally {
      rmrf(f.root);
    }
  });

  it("⑧ A 级缺失适配器显式失败：LAYA_UNAVAILABLE(503) 文案带缺失路径/回填口径/验证方法", () => {
    const f = mkFixture(); // 临时 repoRoot 无 venv 无权重 = 用户侧回填前的普遍现状
    try {
      let err: KernelError | undefined;
      try {
        scan(f, { path: "章节正文/第001章-合成.md", proposal: true });
      } catch (e) {
        err = e as KernelError;
      }
      expect(err, "缺权重必须显式失败，不许静默降级").toBeTruthy();
      expect(err?.code).toBe("LAYA_UNAVAILABLE");
      expect(err?.http).toBe(503);
      const msg = err?.message ?? "";
      // 路径分隔符无关（Windows join 出反斜杠）：只钉「缺什么 + 去哪回填 + 怎么验证」三要素
      expect(msg).toContain(path.join("runs", "laya-run-0923", "student-v3"));
      expect(msg).toContain(path.join("tools", "_vendor"));
      expect(msg).toContain("tools/_vendor/README.md");
      expect(msg).toContain("回填");
      expect(msg).toContain("不回落 4B/API");
      // 显式失败 = 不产报告不落盘
      expect(fs.existsSync(path.join(f.projectDir, "reports"))).toBe(false);
    } finally {
      rmrf(f.root);
    }
  });

  it("⑨ 入参门：text/path 都不给 = 400 BAD_ARGS；都给 = 400；目标缺件 = 404 TARGET_MISSING", () => {
    const f = mkFixture();
    try {
      expect(() => VERB.run(f.kernel, { project: PID })).toThrow(KernelError);
      expect(() => VERB.run(f.kernel, { project: PID, text: TEXT, path: "章节正文/第001章-合成.md" })).toThrow(/互斥/);
      expect(() => scan(f, { path: "章节正文/第999章-不存在.md" })).toThrow(/TARGET_MISSING|待诊文件不存在/);
      // text 直诊：落 内部/诊断暂存/ 留档，证据可回查
      const r = scan(f, { text: TEXT });
      expect(r.report.target).toMatch(/^内部\/诊断暂存\/diag-.*\.md$/);
      expect(fs.existsSync(path.join(f.projectDir, r.report.target as string))).toBe(true);
      assertReportShape(r.report);
    } finally {
      rmrf(f.root);
    }
  });
});
