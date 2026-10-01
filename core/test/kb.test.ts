/**
 * KB 检索/读卡（core/src/kb.ts）：verb 面的确定性单元。
 * ①打分：标题 > id > 标签 > 正文；②ref 三形态归一（卡片 id / 去前缀路径 / .md 路径）；
 * ③index.json 权威映射兜底。
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { kbRead, kbSearch } from "../src/kb.js";

function tmpKb(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kb-"));
  fs.mkdirSync(path.join(dir, "aesthetic"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "aesthetic", "curve.md"),
    `---\n{\n  "id": "kb/aesthetic/curve",\n  "title": "情绪曲线标准（六型判别）",\n  "tags": ["curve", "pacing"]\n}\n---\n\n# 情绪曲线标准\n\n全剧情绪曲线类型可判明，且无失衡段。\n`,
    "utf-8",
  );
  fs.writeFileSync(
    path.join(dir, "aesthetic", "other.md"),
    `---\n{\n  "id": "kb/aesthetic/other",\n  "title": "无关卡"\n}\n---\n\n# 无关卡\n\n内容与曲线无关。\n`,
    "utf-8",
  );
  fs.writeFileSync(
    path.join(dir, "index.json"),
    JSON.stringify({ entries: [{ id: "kb/aesthetic/curve", file: "aesthetic/curve.md" }] }),
    "utf-8",
  );
  return dir;
}

describe("KB 检索/读卡（agent 原生知识库输入的确定性面）", () => {
  // graphSearch 修复用例的图文件放在 os.tmpdir()/kit（knowledgeDir 的兄弟目录，loadGraph 约定位）——
  // 该路径跨进程共享，每个用例前清一次，杜绝顺序污染。
  beforeEach(() => {
    fs.rmSync(path.join(os.tmpdir(), "kit"), { recursive: true, force: true });
  });
  it("①打分：标题命中 > 正文命中；无关卡不入列", () => {
    const dir = tmpKb();
    const r = kbSearch(dir, { q: "情绪曲线" });
    expect(r.hits.length).toBe(1);
    expect(r.hits[0].id).toBe("kb/aesthetic/curve");
    expect(r.hits[0].score).toBeGreaterThanOrEqual(8);
  });

  it("②ref 三形态归一：id / 去前缀路径 / .md 路径", () => {
    const dir = tmpKb();
    for (const ref of ["kb/aesthetic/curve", "aesthetic/curve", "aesthetic/curve.md"]) {
      const r = kbRead(dir, ref);
      expect(r.file.replace(/\\/g, "/")).toBe("aesthetic/curve.md");
      expect(r.content).toContain("情绪曲线标准");
    }
  });

  it("③读不存在的卡 = 显式报错（不静默空串）", () => {
    const dir = tmpKb();
    expect(() => kbRead(dir, "kb/aesthetic/none")).toThrow(/知识卡不存在/);
  });

  it("④编译图路径：--- 残缺 title 不参与打分，正文命中 +2 并回真实摘要", () => {
    const dir = tmpKb();
    // loadGraph 约定：图在 knowledgeDir/../kit/hypergraph.rag.json（knowledge 的兄弟目录）
    fs.mkdirSync(path.join(dir, "..", "kit"), { recursive: true });
    // 带 knowledge/ 前缀的图条目按 repo 根相对解析——源卡要在 <tmpbase>/knowledge/ 再放一份
    fs.mkdirSync(path.join(dir, "..", "knowledge", "aesthetic"), { recursive: true });
    fs.copyFileSync(path.join(dir, "aesthetic", "curve.md"), path.join(dir, "..", "knowledge", "aesthetic", "curve.md"));
    fs.writeFileSync(
      path.join(dir, "..", "kit", "hypergraph.rag.json"),
      JSON.stringify({
        format: "hypergraph-rag@1",
        entries: [
          { id: "kb/aesthetic/curve", title: "---", domain: "aesthetic", path: "aesthetic/curve.md", tags: ["curve"] },
          { id: "kb/aesthetic/curve2", title: "---", domain: "aesthetic", path: "knowledge/aesthetic/curve.md", tags: [] },
          { id: "kb/aesthetic/other", title: "无关卡", domain: "aesthetic", path: "aesthetic/other.md", tags: [] },
        ],
      }),
      "utf-8",
    );
    const r = kbSearch(dir, { q: "情绪曲线" });
    expect(r.total).toBe(2); // 两种 path 形态（裸路径 / knowledge/ 前缀）都命中同一张源卡
    expect(r.hits[0].id).toBe("kb/aesthetic/curve");
    expect(r.hits[0].title).toBe("kb/aesthetic/curve"); // --- title 回退 id 展示
    expect(r.hits[0].score).toBeGreaterThanOrEqual(2);  // 正文命中 +2
    expect(r.hits[0].excerpt).toContain("情绪曲线标准"); // 真实正文摘要，不再是「标签：/域词条」
    // 清理共享路径（loadGraph 找的是 knowledgeDir 的兄弟目录，留在 os.tmpdir/kit 会污染其它用例）
    fs.rmSync(path.join(dir, "..", "kit"), { recursive: true, force: true });
    fs.rmSync(path.join(dir, "..", "knowledge"), { recursive: true, force: true });
  });
});
