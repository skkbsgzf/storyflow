import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { extractCtxUsage, conceptTermsOf } from "../src/metrics.js";
import { nodeFs, nodePath } from "../src/abstraction/adapters/node.js";

/** 测试走宿主盘：FS1 §四的 io 首参用这套默认适配器。 */
const io = { fs: nodeFs, path: nodePath };

/** 临时知识库夹具：两张卡（CJK 概念词 + 拉丁缩写），验证概念命中层与字面层的分工。 */
function makeKbRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miniflow-kb-"));
  const dir = path.join(root, "knowledge");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "index.json"),
    JSON.stringify({
      entries: [
        { id: "kb/test/redline", type: "t", title: "红线标准（读者弃书点）", file: "test/redline.md" },
        { id: "kb/test/market-na", type: "t", title: "对标 · Crush Depth", file: "test/market-na.md" },
      ],
    }),
  );
  fs.mkdirSync(path.join(dir, "test"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "test", "redline.md"),
    [
      "---",
      JSON.stringify({ id: "kb/test/redline", title: "红线标准（读者弃书点）" }),
      "---",
      "",
      "# 红线标准",
      "弃书点是硬红线。主角蒙辱不还手即触发弃书点，连续两处弃书点读者必走。",
      "判定：弃书点每章不得超过一处。",
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(dir, "test", "market-na.md"),
    ["---", JSON.stringify({ id: "kb/test/market-na", title: "对标 · Crush Depth" }), "---", "", "# 对标 NA 市场", "NA 市场对深海题材饱和度友好。"].join("\n"),
  );
  return root;
}

const artifact = (body: string, cites: string[] = []) =>
  ["---", "artifact: 1", "node: n1", "round: 1", ...(cites.length ? ["upstream:", ...cites.map((c) => `  - ${c}`)] : []), "---", "", body].join("\n");

describe("命中率 · 概念词命中层（extractCtxUsage）", () => {
  it("字面层照旧：头部引用即命中，与 root 无关", () => {
    const t = artifact("正文随便写。", ["kb/test/redline"]);
    expect(extractCtxUsage(t, ["kb/test/redline"]).used).toBe(1);
    expect(extractCtxUsage(t, ["kb/test/redline"], { root: makeKbRootSafe(), io }).used).toBe(1);
  });

  it("概念层：正文吃了卡的知识（弃书点）但没抄路径 → 计命中", () => {
    const root = makeKbRoot();
    const t = artifact("他深知蒙辱不还手是读者的弃书点，但他忍了。");
    expect(extractCtxUsage(t, ["kb/test/redline"]).used).toBe(0); // 无 root = 旧口径
    expect(extractCtxUsage(t, ["kb/test/redline"], { root, io }).used).toBe(1);
    expect(conceptTermsOf(io, root, "kb/test/redline")).toContain("弃书点");
  });

  it("正文与卡无关 → 不误报", () => {
    const root = makeKbRoot();
    const t = artifact("武大郎把炊饼进了炉，烤得两面金黄。");
    expect(extractCtxUsage(t, ["kb/test/redline"], { root, io }).used).toBe(0);
  });

  it("拉丁签名词按词边界匹配：natural 不得命中 NA 卡", () => {
    const root = makeKbRoot();
    expect(extractCtxUsage(artifact("it feels natural here"), ["kb/test/market-na"], { root, io }).used).toBe(0);
    expect(extractCtxUsage(artifact("对标 NA 市场的深海题材"), ["kb/test/market-na"], { root, io }).used).toBe(1);
  });
});

let cached: string | null = null;
function makeKbRootSafe(): string {
  return (cached ??= makeKbRoot());
}
