import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Kernel } from "../src/kernel.js";
import { MockFsAdapter, MockPathAdapter, MockProcLauncher } from "../src/abstraction/adapters/mock.js";
import { artifact } from "./helpers.js";

/**
 * FS1 · R3 出口判据：**内核整条 flow_run → flow_submit 跑在内存盘与假进程上**。
 *
 * 跑通即证明「运行时不再绑宿主盘」——这是 R7 拆包／浏览器宿主／嵌入式集成的前提。
 * 本测试同时是**普查器**：漏传 `fs`/`path`/`io` 的调用点会在这里现形——
 * 写去宿主盘 = 「真盘上不该存在的目录」那一问变红；读不到语料 = 任务包断言变红。
 *
 * 语料根字符串仍是宿主安装位置（`schema.ts::ROOT`，规范 FS1 §六 偏离清单）：
 * 内存树按同一个字符串播种，于是 `ROOT` 与 `kernel.repoRoot` 指向同一棵假盘树。
 * 数据根用 `/mock-data-root`：真盘上不存在、也不该被创建，泄漏即红。
 */
const HOST_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const REPO = HOST_ROOT;
const DATA_ROOT = "/mock-data-root";
const PROJECT_ID = "p-fs1-smoke";

const DIRECTION = "老牌发型师在连锁快剪店里坚持先洗后剪慢工出细活（FS1 冒烟）";

/** m1.topic-report 的正文夹具：与 kernel.e2e 同源（密度条款要真素材，不造空壳）。 */
const TOPIC_REPORT_BODY = `# 选题报告（FS1 冒烟夹具）

> 老牌发型师选题调研：梗密度、竞品对标与可用话题清单。

| 素材梗 | 来源 | 热度 |
| --- | --- | --- |
| 重生复仇梗 | 抖音热榜 | 120万 |
| 大龄女鹅梗 | 快手 | 98万 |
| 快剪十分钟梗 | B站 | 66万 |
| 慢工出细活梗 | 微博 | 52万 |
| 话题：手艺人的体面 | 知乎 | 43万 |
| 对标《繁花》节奏 | 剧集 | 31万 |
| 对标《我的阿勒泰》质感 | 剧集 | 27万 |
| 借鉴：单元剧结构 | 主创访谈 | 12万 |
| 话题：算法时代的手艺人 | 播客 | 11万 |
`;

/**
 * 把宿主语料目录克隆进内存盘。键里**原样保留** HOST_ROOT 的反斜杠——
 * 内核那侧是 `path.join(ROOT, …)`，MockPath 只按 "/" 分段，写成 posix 形式就对不上键。
 */
function seedTree(mock: MockFsAdapter, rel: string): void {
  const abs = path.join(HOST_ROOT, rel);
  if (!fs.existsSync(abs)) return;
  const stack = [abs];
  const files: string[] = [];
  while (stack.length) {
    const dir = stack.pop()!;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (/\.(json|md|ya?ml|txt|jsonl)$/i.test(e.name)) files.push(p);
    }
  }
  for (const f of files) {
    const relPath = path.relative(HOST_ROOT, f).replaceAll("\\", "/");
    mock.seed({ [`${REPO}/${relPath}`]: fs.readFileSync(f, "utf-8") });
  }
}

function mockKernel(): { kernel: Kernel; mock: MockFsAdapter; proc: MockProcLauncher } {
  const mock = new MockFsAdapter("/");
  for (const d of ["flows", "modules", "skills", "knowledge", "agents", "presets", "assertion-presets"]) seedTree(mock, d);
  mock.seed({ [`${DATA_ROOT}/projects/${PROJECT_ID}/选题素材.md`]: "# 选题素材\n\n甲方点子：老牌发型师。\n" });
  const proc = new MockProcLauncher();
  const kernel = new Kernel({
    root: DATA_ROOT,
    repoRoot: REPO,
    fs: mock,
    path: new MockPathAdapter(),
    proc,
  });
  return { kernel, mock, proc };
}

describe("FS1 · 可嵌入冒烟：topic flow 全程跑在内存盘", () => {
  it("flow_run 派发首步：任务包来自内存语料（技能/产物契约齐备）", async () => {
    const { kernel, mock } = mockKernel();
    const stop = await kernel.flow_run("topic", PROJECT_ID, { route: "hot", region: "CN", direction: DIRECTION });
    expect(stop.status).toBe("awaiting_input");
    if (stop.status !== "awaiting_input") return;
    expect(stop.nodeId).toBe("m1.topic-report");
    expect(stop.taskPackage.instruction.skill).toBe("topic-report");
    expect(stop.taskPackage.outputContract.file).toBe("01-选题/选题报告.md");
    // 运行事实落在内存盘：state.json 与生效编排都只在 mock 里
    expect(mock.exists(`${DATA_ROOT}/projects/${PROJECT_ID}/state.json`)).toBe(true);
    expect(mock.exists(`${DATA_ROOT}/projects/${PROJECT_ID}/registry/effective.json`)).toBe(true);
  });

  it("flow_submit 交卷：产物/登记/台账全部落在内存盘，宿主盘一根手指都没碰", async () => {
    const { kernel, mock, proc } = mockKernel();
    const run = await kernel.flow_run("topic", PROJECT_ID, { route: "hot", region: "CN", direction: DIRECTION });
    expect(run.status).toBe("awaiting_input");
    const pd = `${DATA_ROOT}/projects/${PROJECT_ID}`;

    const body = artifact("topic", "m1.topic-report", TOPIC_REPORT_BODY, { round: 1 });
    const stop = await kernel.flow_submit(PROJECT_ID, "m1.topic-report", { content: body });
    expect(stop.status).toBe("accepted");

    expect(mock.exists(`${pd}/01-选题/选题报告.md`)).toBe(true);
    expect(mock.readText(`${pd}/01-选题/选题报告.md`)).toContain("快剪十分钟梗");
    // 台账真实落点（state.ts::registryPath / journalPath、metrics.ts::metricsPath）
    expect(mock.exists(`${pd}/registry/artifacts.json`)).toBe(true);
    expect(mock.exists(`${pd}/journal.jsonl`)).toBe(true);
    expect(mock.readText(`${pd}/journal.jsonl`)).toContain("m1.topic-report");
    // 指标与诊断走 io 首参（FS1 §四）：交卷后 metrics.jsonl 必须有内容
    expect(mock.exists(`${pd}/registry/metrics.jsonl`)).toBe(true);
    expect(mock.readText(`${pd}/registry/metrics.jsonl`).trim().length).toBeGreaterThan(0);
    // agent 步不该起进程——假进程被调用 = 冒烟把宿主执行当真了
    expect(proc.calls).toEqual([]);

    // 泄漏检查：数据根是内存专用路径，真盘上出现同名目录 = 某处漏传 io
    expect(fs.existsSync(path.resolve(DATA_ROOT))).toBe(false);
    expect(fs.existsSync(path.join(HOST_ROOT, "projects", PROJECT_ID))).toBe(false);
  });

  it("语料只读：跑完之后假盘里的语料文件与宿主逐字节相同", async () => {
    const { kernel, mock } = mockKernel();
    await kernel.flow_run("topic", PROJECT_ID, { route: "hot", region: "CN", direction: DIRECTION });
    const body = artifact("topic", "m1.topic-report", TOPIC_REPORT_BODY, { round: 1 });
    await kernel.flow_submit(PROJECT_ID, "m1.topic-report", { content: body });
    for (const rel of ["flows/topic/flow.json", "modules/topic/module.json", "skills/topic-report.md"]) {
      expect(mock.readText(`${REPO}/${rel}`)).toBe(fs.readFileSync(path.join(HOST_ROOT, rel), "utf-8"));
    }
  });

  /**
   * 上一条只证明「没写脏语料」；这条证明**读**也走注入的适配器：宿主盘同内容 ⇒ 若某处偷偷
   * 用 node:fs 读 ROOT，前面所有断言照样绿。改一份内存里的技能卡，任务包必须跟着变。
   */
  it("语料读取只认注入的盘：内存里改了技能卡，任务包就是改过的", async () => {
    const { kernel, mock } = mockKernel();
    const skillFile = `${REPO}/skills/topic-report.md`;
    mock.writeText(skillFile, `${mock.readText(skillFile)}\n\nFS1-MOCK-MARKER 只存在于内存盘\n`);
    const stop = await kernel.flow_run("topic", PROJECT_ID, { route: "hot", region: "CN", direction: DIRECTION });
    expect(stop.status).toBe("awaiting_input");
    if (stop.status !== "awaiting_input") return;
    expect(stop.taskPackage.instruction.text).toContain("FS1-MOCK-MARKER");
  });
});
