/**
 * KB 检索/读卡（core/src/kb.ts）：verb 面的确定性单元。
 * ①打分：标题 > id > 标签 > 正文；②ref 三形态归一（卡片 id / 去前缀路径 / .md 路径）；
 * ③index.json 权威映射兜底。
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
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
});
