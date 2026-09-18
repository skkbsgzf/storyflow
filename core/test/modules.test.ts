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
import { expandFlow3 } from "../src/modules.js";
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
          adds: { asserts: ["AE-FORESHADOW-CLOSE"], knowledge: ["kb/craft/foreshadow"], config: {} },
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
    // adds 落到派生节点：断言 + 知识
    expect(r.flow.graph.nodes["m1.foreshadow"].asserts).toContain("AE-FORESHADOW-CLOSE");
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

  it("真仓模块：plot 模块对齐钦定形态（v2 精细化：工具箱 11 / 骨架 1 = script-forge）", () => {
    const mod = JSON.parse(fs.readFileSync(path.join(ROOT, "modules", "plot", "module.json"), "utf-8"));
    expect(Object.keys(mod.ops).length).toBe(11);
    expect(mod.skeleton.spine).toEqual(["script-forge"]);
    expect(mod.ops["script-forge"].asserts).toContain("AE-SCRIPT-FIELDS");
  });
  it("真仓模块：topic/prose v2 精细化（单件交付 spine + 输出职责落盘名）", () => {
    const topic = JSON.parse(fs.readFileSync(path.join(ROOT, "modules", "topic", "module.json"), "utf-8"));
    expect(topic.skeleton.spine).toEqual(["topic-report"]);
    expect(topic.ops["topic-report"].output).toBe("选题报告.md");
    expect(topic.ops["topic-report"].asserts).toContain("AE-REPORT-DENSITY");
    const prose = JSON.parse(fs.readFileSync(path.join(ROOT, "modules", "prose", "module.json"), "utf-8"));
    expect(prose.skeleton.spine).toEqual(["ghostwrite", "novel-deai"]);
    expect(prose.ops["ghostwrite"].output).toBe("正文.md");
    expect(prose.ops["novel-deai"].output).toBe("终稿.md");
  });
});
