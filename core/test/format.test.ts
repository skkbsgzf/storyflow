import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArtifactHeader, runHeaderAsserts, classOfPath, headerTemplate } from "../src/asserts.js";
import { evalWhen, edgeRole, isBackEdge, edgeVia, condContextOf } from "../src/cond.js";
import { contentSha12, sha12 } from "../src/ids.js";
import { expandedFlow } from "./helpers.js";

const HEADER = `---
artifact: 1
id: plot.review.multi-view
class: opinion
node: gate-r1
round: 3
version: v3
state: reviewed
at: 2026-09-17 19:20
by: kit/plot.plot-redline
upstream:
  - 内部/稿本/梗卡.md@725d620ff5e2
review:
  gate: gate-r1
  verdict: pass
  at: 2026-09-17 19:25
  by: user
  reason: 梗组合成立，进结构
---

# 多视角意见书 · R1

> 红方四视角意见；结论：放行进结构。

## 一、目标读者

- 内容
`;

/** 只取头部（切掉夹具夹带的正文），供"正文规则"类用例拼接自定义正文。 */
const HDR = HEADER.slice(0, HEADER.indexOf("\n---", 3) + 5);

function tmpProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "miniflow-fmt-"));
}

describe("artifact-header · 头部解析（规范 R4 §二）", () => {
  it("解析标量 + 列表 + 一层嵌套对象", () => {
    const h = parseArtifactHeader(HEADER)!;
    expect(h.artifact).toBe(1);
    expect(h.round).toBe(3);
    expect(h.id).toBe("plot.review.multi-view");
    expect(h.upstream).toEqual(["内部/稿本/梗卡.md@725d620ff5e2"]);
    expect((h.review as Record<string, unknown>).verdict).toBe("pass");
  });

  it("无头部返回 null", () => {
    expect(parseArtifactHeader("# 标题\n\n正文\n")).toBeNull();
  });

  it("class 与目录准入互为逆函数", () => {
    expect(classOfPath("内部/意见/多视角意见书-gate-r1.md")).toBe("opinion");
    expect(classOfPath("内部/收据/断言报告.json")).toBe("receipt");
    expect(classOfPath("内部/依据/kb-market.md")).toBe("basis");
    expect(classOfPath("内部/稿本/梗卡.md")).toBe("draft");
    expect(classOfPath("对外交付/01-选题报告.md")).toBe("deliverable");
    expect(classOfPath("章节正文/第1章.md")).toBe("deliverable");
    expect(classOfPath("世界书/世界观圣经.md")).toBe("world");
    expect(classOfPath("选题素材.md")).toBe("input");
  });

  it("headerTemplate 产出可直接通过校验的头部", () => {
    const dir = tmpProject();
    const tpl = headerTemplate({
      id: "plot.review.multi-view",
      cls: "opinion",
      node: "gate-r1",
      round: 3,
      by: "kit/plot.plot-redline",
      upstream: ["内部/稿本/梗卡.md@725d620ff5e2"],
    });
    const md = tpl + "\n# 意见书\n\n> 结论：放行。\n\n正文。\n";
    fs.mkdirSync(path.join(dir, "内部", "意见"), { recursive: true });
    fs.writeFileSync(path.join(dir, "内部/意见/多视角意见书-gate-r1.md"), md, "utf-8");
    const r = runHeaderAsserts(dir, "内部/意见/多视角意见书-gate-r1.md", { node: "gate-r1", round: 3 });
    expect(r.map((x) => `${x.name}:${x.status}`)).toEqual(["artifact-header:pass"]);
  });
});

describe("artifact-header · 校验拦截", () => {
  const write = (dir: string, rel: string, text: string): void => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text, "utf-8");
  };
  const block = (dir: string, rel: string, expect0: string, opts = {}): void => {
    const r = runHeaderAsserts(dir, rel, opts);
    expect(r.length).toBe(1);
    expect(r[0].status).toBe("block");
    expect(r[0].detail ?? "").toContain(expect0);
  };

  it("缺头部 → block", () => {
    const dir = tmpProject();
    write(dir, "内部/稿本/梗卡.md", "# 梗卡\n\n主梗。\n");
    block(dir, "内部/稿本/梗卡.md", "缺 artifact@1 头部");
  });

  it("class 与目录不符 → block", () => {
    const dir = tmpProject();
    const md = HEADER.replace("class: opinion", "class: draft") + "\n# t\n\n> s\n\nbody\n";
    write(dir, "内部/意见/多视角意见书-gate-r1.md", md);
    block(dir, "内部/意见/多视角意见书-gate-r1.md", "应落 内部/稿本/");
  });

  it("round 与 run 状态不符 → block（版本号清晰）", () => {
    const dir = tmpProject();
    write(dir, "内部/意见/多视角意见书-gate-r1.md", HEADER);
    block(dir, "内部/意见/多视角意见书-gate-r1.md", "round=3 ≠ 当前轮 1", { node: "gate-r1", round: 1 });
  });

  it("文件名带轮次标记 → block", () => {
    const dir = tmpProject();
    write(dir, "内部/意见/评审表-终稿-r1.md", HEADER);
    block(dir, "内部/意见/评审表-终稿-r1.md", "文件名含轮次标记");
  });

  it("正文出现会话口吻 → block（污染禁令）", () => {
    const dir = tmpProject();
    write(dir, "内部/意见/多视角意见书-gate-r1.md", HEADER + "\n# t\n\n> s\n\n让我先看一下上游产物。\n");
    block(dir, "内部/意见/多视角意见书-gate-r1.md", "会话口吻");
  });

  it("正文首行非标题 / 缺摘要 → block", () => {
    const dir = tmpProject();
    write(dir, "内部/意见/多视角意见书-gate-r1.md", HDR + "\n直接写正文，没有标题。\n");
    block(dir, "内部/意见/多视角意见书-gate-r1.md", "正文首行须为一级标题");
  });

  it("根级出现过程件（非输入材料）→ block", () => {
    const dir = tmpProject();
    write(dir, "梗卡.md", HEADER);
    block(dir, "梗卡.md", "根级仅允许输入材料", { rootInputs: ["选题素材.md"] });
  });

  it("根级输入材料不参与头部管辖", () => {
    const dir = tmpProject();
    write(dir, "选题素材.md", "# 选题素材\n\n甲方点子。\n");
    expect(runHeaderAsserts(dir, "选题素材.md", { rootInputs: ["选题素材.md"] })).toEqual([]);
  });

  it("非 md 与管辖外目录不校验", () => {
    const dir = tmpProject();
    write(dir, "内部/收据/断言报告.json", "{}");
    expect(runHeaderAsserts(dir, "内部/收据/断言报告.json")).toEqual([]);
  });
});

describe("when 谓词 · 结构化与兼容（规范 R4 §5.2）", () => {
  const ctx = condContextOf({
    inputs: { route: "dual", 批注回流: "on", pendingChapters: 3 },
    lastRejectReason: "梗选型撞车",
    gate: { verdict: "send-back" },
    nodes: { "gate-r2": { verdict: "challenge" } },
    pendingInstances: 3,
  });

  it("verdict / cause / input / gt / challenge", () => {
    expect(evalWhen({ verdict: "send-back" }, ctx).active).toBe(true);
    expect(evalWhen({ verdict: "pass" }, ctx).active).toBe(false);
    expect(evalWhen({ cause: "梗选型" }, ctx).active).toBe(true);
    expect(evalWhen({ cause: "结构单薄" }, ctx).active).toBe(false);
    expect(evalWhen({ input: "route", eq: "dual" }, ctx).active).toBe(true);
    expect(evalWhen({ input: "route", eq: "hot" }, ctx).active).toBe(false);
    expect(evalWhen({ input: "pendingChapters", gt: 0 }, ctx).active).toBe(true);
    expect(evalWhen({ challenge: true }, ctx).active).toBe(true);
  });

  it("any / all 组合", () => {
    expect(evalWhen({ any: [{ verdict: "pass" }, { verdict: "send-back" }] }, ctx).active).toBe(true);
    expect(evalWhen({ all: [{ verdict: "send-back" }, { cause: "结构" }] }, ctx).active).toBe(false);
  });

  it("loop 回边条件（替代不可解析的『还有未写章』）", () => {
    expect(evalWhen({ loop: "pending" }, ctx).active).toBe(true);
    expect(evalWhen({ loop: "pending" }, { ...ctx, pendingInstances: 0 }).active).toBe(false);
  });

  it("缺省 = 无条件", () => {
    expect(evalWhen(undefined, ctx).active).toBe(true);
    expect(evalWhen({}, ctx).active).toBe(true);
  });

  it("flow@1 字符串形态已处决：非对象谓词一律不活跃（不静默放行、不解析嗅探）", () => {
    expect(evalWhen("rejected" as never, ctx).active).toBe(false);
    expect(evalWhen("rejected" as never, ctx).reason).toContain("已处决");
    expect(evalWhen("还有未写章" as never, ctx).active).toBe(false);
  });

  it("嵌套 any/all 的内层字符串同样拒绝（结构化是唯一形态）", () => {
    expect(evalWhen({ any: ["rejected", { verdict: "pass" }] } as never, ctx).active).toBe(false);
  });
});

describe("边角色与派生（规范 R4 §5.1）", () => {
  // flow@3：图由 expandFlow3 派生（与内核同一展开单点），边级契约跑在派生图上
  const flow = expandedFlow("topic");

  it("role 单值判别：flow@1 的 optional/loop 布尔折算已处决（不再折算）", () => {
    expect(edgeRole({ id: "x", from: "a", to: "b" })).toBe("flow");
    expect(edgeRole({ id: "x", from: "a", to: "b", role: "reject" })).toBe("reject");
    // 老布尔字段不再有解释权：缺 role 一律按 flow
    expect(edgeRole({ id: "x", from: "a", to: "b", optional: true, loop: true } as never)).toBe("flow");
  });

  it("回边 = loop ∪ reject（打回边必须排除出前向计划，否则成环）", () => {
    expect(isBackEdge({ id: "x", from: "a", to: "b", role: "loop" })).toBe(true);
    expect(isBackEdge({ id: "x", from: "a", to: "b", role: "reject" })).toBe(true);
    expect(isBackEdge({ id: "x", from: "a", to: "b", role: "flow" })).toBe(false);
  });

  it("via 派生自目标节点执行体；显式 via 优先", () => {
    const e = flow.graph.edges.find((x) => x.to === "m1.find-trope" && x.role === "flow")!;
    // flow@3 派生边的 via = `skill.<op 技能名>`（expandFlow3 规则），显式 via 仍优先
    expect(edgeVia(flow, { ...e, via: undefined })).toBe("topic.find-trope");
    expect(edgeVia(flow, e)).toBe("skill.find-trope");
    expect(edgeVia(flow, { ...e, via: "custom.op" })).toBe("custom.op");
  });

  it("全部边都有 role，且打回边带 params", () => {
    for (const e of flow.graph.edges) {
      expect(e.role, `${e.id} 缺 role`).toBeDefined();
      if (e.role === "reject") {
        expect(e.params?.scope, `${e.id} 缺 params.scope`).toBeTruthy();
      }
    }
  });
});

describe("正文指纹（规范 R4 §二）", () => {
  it("头部元数据不入指纹：同正文跨轮指纹相同", () => {
    const a = HEADER + "\n# t\n\n> s\n\n正文一致。\n";
    const b = HEADER.replace("round: 3", "round: 7").replace("version: v3", "version: v7").replace(
      "at: 2026-09-17 19:20",
      "at: 2026-09-18 09:00",
    ) + "\n# t\n\n> s\n\n正文一致。\n";
    expect(sha12(a)).not.toBe(sha12(b));
    expect(contentSha12(a)).toBe(contentSha12(b));
  });

  it("正文变化 → 指纹变化", () => {
    const a = HEADER + "\n# t\n\n> s\n\n正文甲。\n";
    const b = HEADER + "\n# t\n\n> s\n\n正文乙。\n";
    expect(contentSha12(a)).not.toBe(contentSha12(b));
  });
});
