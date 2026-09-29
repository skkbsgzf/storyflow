/**
 * R6 · 模块展开器（WO-01）回归测试
 *
 * 锁四件事：
 *   ① 默认骨架 4 节点（flow 不写 caps = 零上手成本）
 *   ② caps 加插件 → 节点增加且 slot 接线正确（桥接替换直连）
 *   ③ 连接件 <实例id>.link 两模式（auto 放行 / manual 挂人）与跨模块接线
 *   ④ 幂等：同一 flow 两次展开逐字节一致
 *   ⑤ requires 剪枝：前置缺失报错，不静默丢
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { effectiveFlow3, expandFlow3 } from "../src/modules.js";
import { ROOT } from "../src/schema.js";

/** 最小双模块夹具：plot（骨架 3 + 插件 1）+ prose（骨架 1）。 */
function writeFixture(root: string): void {
  fs.mkdirSync(path.join(root, "modules", "m-plot"), { recursive: true });
  fs.mkdirSync(path.join(root, "modules", "m-prose"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "modules", "m-plot", "module.json"),
    JSON.stringify({
      format: "module@1",
      id: "m-plot",
      name: "编剧",
      ops: {
        structure: {
          title: "结构", kind: "produce", skill: "structure-design",
          capability: ["结构"], knowledge: ["kb/craft/structure"], config: {},
        },
        choreo: {
          title: "主线编排", kind: "produce", skill: "plot-choreographer",
          capability: ["主线"], config: {},
        },
        bible: {
          title: "人设", kind: "produce", skill: "novel-bible",
          capability: ["人设"], config: {},
        },
        breakdown: {
          title: "分场", kind: "produce", skill: "scene-breakdown",
          capability: ["分场"], config: {},
        },
        foreshadow: {
          title: "伏笔", kind: "produce", skill: "foreshadow-plant",
          capability: ["伏笔"], slot: "before:breakdown",
          requires: ["choreo"],
          adds: { knowledge: ["kb/craft/foreshadow"], config: {} },
        },
      },
      skeleton: {
        spine: ["structure", "choreo", "bible", "breakdown"],
        edges: [
          ["structure", "choreo"],
          ["bible", "choreo"],
          ["choreo", "breakdown"],
        ],
      },
      caps: ["结构", "主线", "人设", "分场", "伏笔"],
    }),
    "utf-8",
  );
  fs.writeFileSync(
    path.join(root, "modules", "m-prose", "module.json"),
    JSON.stringify({
      format: "module@1",
      id: "m-prose",
      name: "写作",
      ops: {
        chapter: {
          title: "章写作", kind: "produce", skill: "novel-chapter",
          capability: ["正文"], config: {},
        },
      },
      skeleton: { spine: ["chapter"], edges: [] },
      caps: ["正文"],
    }),
    "utf-8",
  );
  fs.mkdirSync(path.join(root, "flows", "mini-f3"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "flows", "mini-f3", "flow.json"),
    JSON.stringify({
      format: "flow@3",
      id: "mini-f3",
      title: "最小模块序列",
      version: "1.0.0",
      status: "draft",
      modules: [
        { id: "m1", module: "m-plot", link: "auto" },
        { id: "m2", module: "m-prose", link: "manual" },
      ],
    }),
    "utf-8",
  );
}

describe("R6 · 模块展开器（expandFlow3）", () => {
  it("W-01 职责三件套：module.json io 原样传播进 composition（机器消费面）", () => {
    const flow = JSON.parse(
      fs.readFileSync(path.join(ROOT, "flows", "test-dual", "flow.json"), "utf-8"),
    );
    const r = expandFlow3(ROOT, flow);
    const m1 = r.modules.find((m) => m.id === "m1");
    expect(m1?.io).toBeTruthy();
    expect(m1?.io?.output?.file).toBe("选题报告.md");
    expect(m1?.io?.acceptance).toBeUndefined();  // v0.8：验收扫描约束随审核层退役 // v5.0：验收=scans 证据 + rules 语料，无 asserts
    expect(m1?.io?.input?.from).toBe("flow-input");
  });

  it("默认骨架：flow 不写 caps → 只启骨架 4 节点，跨模块经连接件接线", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "miniflow-mod1-"));
    writeFixture(root);
    fs.mkdirSync(path.join(root, "flows", "mini-f3"), { recursive: true });
    const flow = JSON.parse(fs.readFileSync(path.join(root, "flows", "mini-f3", "flow.json"), "utf-8"));
    const r = expandFlow3(root, flow);
    const ids = Object.keys(r.flow.graph.nodes).sort();
    // m-plot 骨架 4 + 连接件 1 + m-prose 骨架 1 = 6 节点；连接件归「进入模块」（m2.link）
    expect(ids).toEqual([
      "m1.bible", "m1.breakdown", "m1.choreo", "m1.structure", "m2.link", "m2.chapter",
    ].sort());
    expect(r.flow.graph.nodes["m2.link"].gate_role).toBe("link");
    expect(r.flow.graph.nodes["m2.link"].link_mode).toBe("manual"); // 进入 m2 的连接件取 m2 的 link=manual
    // 跨模块：上游终端 → 连接件 → 下游入口
    expect(r.flow.graph.edges.some((e: any) => e.from === "m1.breakdown" && e.to === "m2.link")).toBe(true);
    expect(r.flow.graph.edges.some((e: any) => e.from === "m2.link" && e.to === "m2.chapter")).toBe(true);
    // 合成 stages：assembler 背景卡与搬迁口径复用
    expect(r.flow.stages.map((s: any) => s.id)).toEqual(["m1", "m2"]);
  });

  it("caps 插件：caps=['伏笔'] → foreshadow 插到 before:breakdown（桥接替换直连）", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "miniflow-mod2-"));
    writeFixture(root);
    fs.mkdirSync(path.join(root, "flows", "mini-f3"), { recursive: true });
    const flow = JSON.parse(fs.readFileSync(path.join(root, "flows", "mini-f3", "flow.json"), "utf-8"));
    flow.modules[0].caps = ["伏笔"];
    const r = expandFlow3(root, flow);
    const ids = Object.keys(r.flow.graph.nodes);
    expect(ids).toContain("m1.foreshadow");
    expect(r.modules[0].plugins).toEqual(["m1.foreshadow"]);
    // 桥接：bible→breakdown（breakdown 的 seq 前驱）被 bible→foreshadow→breakdown 取代
    const es = r.flow.graph.edges;
    expect(es.some((e: any) => e.from === "m1.bible" && e.to === "m1.breakdown")).toBe(false);
    expect(es.some((e: any) => e.from === "m1.bible" && e.to === "m1.foreshadow")).toBe(true);
    expect(es.some((e: any) => e.from === "m1.foreshadow" && e.to === "m1.breakdown")).toBe(true);
    // adds 落到派生节点：知识（v5.0：adds.asserts 通道已随断言协议退役，节点上不得再出现 asserts）
    expect(r.flow.graph.nodes["m1.foreshadow"].asserts).toBeUndefined();
    expect(r.flow.graph.nodes["m1.foreshadow"].knowledge).toContain("kb/craft/foreshadow");
  });

  it("requires 剪枝：前置缺失报错（不静默丢）", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "miniflow-mod3-"));
    writeFixture(root);
    fs.mkdirSync(path.join(root, "flows", "mini-f3"), { recursive: true });
    const flow = JSON.parse(fs.readFileSync(path.join(root, "flows", "mini-f3", "flow.json"), "utf-8"));
    // foreshadow requires choreo；把 requires 指向不存在的工具 = 前置缺失
    const modPath = path.join(root, "modules", "m-plot", "module.json");
    const mod = JSON.parse(fs.readFileSync(modPath, "utf-8"));
    mod.ops.foreshadow.requires = ["choreo-nonexistent"];
    fs.writeFileSync(modPath, JSON.stringify(mod, null, 1), "utf-8");
    const broken = JSON.parse(JSON.stringify(flow));
    broken.modules = [{ id: "mx", module: "m-plot", caps: ["伏笔"] }];
    expect(() => expandFlow3(root, broken)).toThrow(/requires/);
  });

  it("幂等：同一 flow 两次展开逐字节一致", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "miniflow-mod4-"));
    writeFixture(root);
    fs.mkdirSync(path.join(root, "flows", "mini-f3"), { recursive: true });
    const flow = JSON.parse(fs.readFileSync(path.join(root, "flows", "mini-f3", "flow.json"), "utf-8"));
    flow.modules[0].caps = ["主线", "伏笔"];
    const a = JSON.stringify(expandFlow3(root, flow));
    const b = JSON.stringify(expandFlow3(root, flow));
    expect(b).toBe(a);
  });

  it("真仓模块：plot 模块对齐钦定形态（v2.1 骨架扩容：四段水线，锚点全可达）", () => {
    const mod = JSON.parse(fs.readFileSync(path.join(ROOT, "modules", "plot", "module.json"), "utf-8"));
    expect(mod.skeleton.spine).toEqual(["structure-design", "plot-choreographer", "scene-breakdown", "script-forge"]);
    expect(mod.skeleton.edges).toEqual([
      ["structure-design", "plot-choreographer"],
      ["plot-choreographer", "scene-breakdown"],
      ["scene-breakdown", "script-forge"],
    ]);
    expect(mod.io?.acceptance).toBeUndefined();  // v0.8：同上
    // 落位可达性（诊断 2026-09-19）：插件锚点不在骨架时，also_fits 必须有可用兜底
    const spine = new Set(mod.skeleton.spine);
    for (const [oid2, op2] of Object.entries(mod.ops) as [string, any][]) {
      if (spine.has(oid2)) continue;
      const slot: string = op2.slot ?? "";
      if (!slot || slot === "end") continue;
      const anchor = slot.split(":")[1];
      if (spine.has(anchor)) continue;
      const fits: string[] = op2.also_fits ?? [];
      expect(fits.some((a) => a === "end" || spine.has(a.split(":")[1])), oid2).toBe(true);
    }
  });
  it("真仓模块：topic/prose v2 精细化（单件交付 spine + 输出职责落盘名）", () => {
    const topic = JSON.parse(fs.readFileSync(path.join(ROOT, "modules", "topic", "module.json"), "utf-8"));
    expect(topic.skeleton.spine).toEqual(["topic-report"]);
    expect(topic.ops["topic-report"].output).toBe("选题报告.md");
    expect(topic.io?.acceptance).toBeUndefined();  // v0.8：同上
    const prose = JSON.parse(fs.readFileSync(path.join(ROOT, "modules", "prose", "module.json"), "utf-8"));
    expect(prose.skeleton.spine).toEqual(["ghostwrite", "novel-deai"]);
    expect(prose.ops["ghostwrite"].output).toBe("正文.md");
    expect(prose.ops["novel-deai"].output).toBe("终稿.md");
  });
});

/**
 * R7 · 生效编排（effectiveFlow3）——「声明了就必须生效」
 *
 * 锁住三类此前的「静默不生效」（2026-09-20 审计 + p-wxl-001 复盘）：
 *   ① `flow.policy` 被整个忽略（只读 defaults.link，且 adapt 硬编码 "propose"）
 *   ② `set-tool` / `set-input` 在 flow@3 结构性不可达（kernel 把 toolOverrides/inputs 硬编码为 {}）
 *      —— 铁证：`projects/ccwd-fq/registry/overlay.json` 里 2 条 `status:"applied"` 的 set-tool 从没被读
 *   ③ 非 flow@3 的 patch kind 静默丢弃（日志记 applied、内核没读）
 */
describe("R7 · 生效编排（effectiveFlow3）：声明了就必须生效", () => {
  /** 在夹具根写一个带 policy 声明的最小 flow@3。 */
  function miniFlow(root: string, policy?: Record<string, unknown>, defaults?: Record<string, unknown>) {
    return {
      format: "flow@3",
      id: "mini-f3",
      title: "最小模块序列",
      version: "1.0.0",
      status: "draft",
      defaults: defaults ?? { link: "manual" },
      policy,
      modules: [{ id: "m1", module: "m-plot", link: "auto" }],
    } as never;
  }
  function fixture(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "miniflow-eff3-"));
    writeFixture(root);
    return root;
  }
  const ov = (patches: unknown[]) =>
    ({ format: "flow-overlay@1", flowId: "mini-f3", origin: "user", reason: "t", patches }) as never;

  it("policy 起点取自 flow.json 声明——此前被整个忽略（adapt 硬编码 propose）", () => {
    const root = fixture();
    const r = effectiveFlow3(
      root,
      miniFlow(root, { link_default: "auto", adapt: "off", maxRounds: 3, awaitTimeoutMs: 60000 }),
    );
    expect(r.policy.link_default).toBe("auto"); // policy 声明胜过 defaults.link=manual
    expect(r.policy.adapt).toBe("off"); // 此前恒为 "propose" ⇒ 用户关掉优化器也没用
    expect(r.policy.maxRounds).toBe(3);
    expect(r.policy.awaitTimeoutMs).toBe(60000);
    expect(r.notes.join()).toMatch(/policy 起点取自 flow\.json/);
  });

  it("flow 未声明 policy 时回落 defaults.link（旧行为不破）", () => {
    const root = fixture();
    const r = effectiveFlow3(root, miniFlow(root, undefined, { link: "auto" }));
    expect(r.policy.link_default).toBe("auto");
    expect(r.policy.adapt).toBe("propose"); // 兜底值
  });

  it("set-tool 在 flow@3 真的进 toolOverrides（此前 kernel 硬编码 {}）", () => {
    const root = fixture();
    const r = effectiveFlow3(root, miniFlow(root), {
      overlays: [
        ov([
          {
            kind: "set-tool", kit: "m-plot", op: "bible", reason: "收窄注入 + 改旋钮",
            config: { maxChars: 2000 }, model_tier: "lite",
            add_knowledge: ["kb/craft/foreshadow"], remove_knowledge: ["kb/craft/structure"],
          },
        ]),
      ],
    });
    // key = <kit>.<op>，与 assembler.resolveNodeOp 的消费口径一致
    expect(r.toolOverrides["m-plot.bible"]).toEqual({
      config: { maxChars: 2000 }, model_tier: "lite",
      add_knowledge: ["kb/craft/foreshadow"], remove_knowledge: ["kb/craft/structure"],
    });
    expect(r.appliedCount).toBe(1);
    expect(r.unsupported).toEqual([]);
  });

  it("多条 set-tool 命中同一 op 时字段累加（与 legacy 分支同语义）", () => {
    const root = fixture();
    const r = effectiveFlow3(root, miniFlow(root), {
      overlays: [
        ov([{ kind: "set-tool", kit: "m-plot", op: "bible", reason: "a", add_knowledge: ["kb/a"] }]),
        ov([{ kind: "set-tool", kit: "m-plot", op: "bible", reason: "b", add_knowledge: ["kb/b"], model_tier: "lite" }]),
      ],
    });
    expect(r.toolOverrides["m-plot.bible"].add_knowledge).toEqual(["kb/a", "kb/b"]);
    expect(r.toolOverrides["m-plot.bible"].model_tier).toBe("lite");
  });

  it("set-input 在 flow@3 真的进 inputs（此前同样硬编码 {}）", () => {
    const root = fixture();
    const r = effectiveFlow3(root, miniFlow(root), {
      overlays: [ov([{ kind: "set-input", key: "chapters", value: 6, reason: "章数拍板" }])],
    });
    expect(r.inputs).toEqual({ chapters: 6 });
    expect(r.appliedCount).toBe(1);
  });

  it("set-module / insert-tool / set-policy 仍生效（回归）", () => {
    const root = fixture();
    const r = effectiveFlow3(root, miniFlow(root), {
      overlays: [
        ov([
          { kind: "set-policy", key: "link_default", value: "manual", reason: "p" },
          { kind: "set-module", id: "m1", caps: ["伏笔"], reason: "m" },
          { kind: "insert-tool", module: "m1", tool: "foreshadow", slot: "end", reason: "i" },
        ]),
      ],
    });
    expect(r.policy.link_default).toBe("manual");
    expect(r.appliedCount).toBe(3);
    expect(r.unsupported).toEqual([]);
  });

  it("flow@3 不消费的 kind 显式回显且不计入 appliedCount（不许静默丢弃）", () => {
    const root = fixture();
    const r = effectiveFlow3(root, miniFlow(root), {
      overlays: [
        ov([
          // 手工图语义：flow@3 无手画 graph，不消费
          { kind: "set-node", id: "m1.bible", config: { depth: "深" }, reason: "x" },
          { kind: "place-node", reason: "x" },
          { kind: "suppress-boundary", from: "a", to: "b", reason: "x" },
          // R6 已退役的 policy 键（optimize.ts 曾产出它）
          { kind: "set-policy", key: "kit_boundary", value: "auto", reason: "x" },
          // 合法的一条，用来验证对账
          { kind: "set-tool", kit: "m-plot", op: "bible", reason: "ok", config: { a: 1 } },
        ]),
      ],
    });
    expect(r.appliedCount).toBe(1); // 只有合法的 set-tool 计数
    expect(r.unsupported).toEqual([
      "kind=set-node（flow@3 不消费，见规范 R7 §一）",
      "kind=place-node（flow@3 不消费，见规范 R7 §一）",
      "kind=suppress-boundary（flow@3 不消费，见规范 R7 §一）",
      "set-policy:kit_boundary（不在 flow@3 policy 白名单）",
    ]);
    expect(r.notes.join()).toMatch(/未被 flow@3 消费/);
  });

  it("set-tool 缺 kit/op、set-input 缺 key → 显式 unsupported，不静默", () => {
    const root = fixture();
    const r = effectiveFlow3(root, miniFlow(root), {
      overlays: [
        ov([
          { kind: "set-tool", op: "bible", reason: "缺 kit" },
          { kind: "set-input", value: 1, reason: "缺 key" },
          { kind: "set-policy", key: "link_default", value: "乱写", reason: "非法取值" },
        ]),
      ],
    });
    expect(r.appliedCount).toBe(0);
    expect(r.unsupported.join("|")).toMatch(/set-tool（缺 kit\/op）/);
    expect(r.unsupported.join("|")).toMatch(/set-input（缺 key）/);
    expect(r.unsupported.join("|")).toMatch(/link_default=乱写/);
  });

  it("status=proposed/rejected 的补丁不参与合成（只有 applied 生效）", () => {
    const root = fixture();
    const r = effectiveFlow3(root, miniFlow(root), {
      overlays: [
        ov([
          { kind: "set-tool", kit: "m-plot", op: "bible", reason: "x", config: { a: 1 }, status: "proposed" },
          { kind: "set-input", key: "k", value: 1, reason: "x", status: "rejected" },
          { kind: "set-policy", key: "link_default", value: "manual", reason: "x", status: "applied" },
        ]),
      ],
    });
    expect(r.toolOverrides).toEqual({});
    expect(r.inputs).toEqual({});
    expect(r.appliedCount).toBe(1);
    expect(r.policy.link_default).toBe("manual");
  });

  it("真仓 flow：policy 声明被读取（此前整个被忽略，adapt 恒为 propose）", () => {
    const flow = JSON.parse(
      fs.readFileSync(path.join(ROOT, "flows", "test-dual", "flow.json"), "utf-8"),
    );
    // flow.json 声明 policy = { link_default: "auto", adapt: "off" }
    const r = effectiveFlow3(ROOT, flow);
    expect(r.policy.link_default).toBe("auto");
    expect(r.policy.adapt).toBe("off");
  });

  it("真仓 flow：无 overlay 时 toolOverrides/inputs 为空且无 unsupported（不误报）", () => {
    const flow = JSON.parse(
      fs.readFileSync(path.join(ROOT, "flows", "test-dual", "flow.json"), "utf-8"),
    );
    const r = effectiveFlow3(ROOT, flow);
    expect(r.toolOverrides).toEqual({});
    expect(r.inputs).toEqual({});
    expect(r.unsupported).toEqual([]);
    expect(r.appliedCount).toBe(0);
  });
});
