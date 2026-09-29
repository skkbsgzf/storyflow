// B组 · 工单 B12：udiff.ts 与 CPython difflib 的逐字节对账（快照 diff 同源的第一道锁）。
// 语料 = fixtures/udiff-parity.json，由本机 Python 3.13.14 difflib.unified_diff(..., lineterm="")
// 生成并签入（166 例：随机小样本 150 + 长文本 autojunk 16，含 3 例「无变更」）；
// 再生成脚本与口径见 docs/收据-B12快照diff同源-20260928.md。
// 真项目快照层面的对账（面板 HTTP ↔ tools/snapshot.py）由 test/verify/snapshot-diff-parity.mjs 跑。
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { diffText, splitLines, unifiedDiffLines } from "../src/udiff.js";

const here = path.dirname(fileURLToPath(import.meta.url));
interface Case { a: string[]; b: string[]; n: number; from: string; to: string; expect: string }
const cases = JSON.parse(fs.readFileSync(path.join(here, "fixtures/udiff-parity.json"), "utf-8")) as Case[];

test("difflib 语料 166 例逐字节一致（含 autojunk 长文本与空 diff）", () => {
  assert.equal(cases.length, 166, "语料条数变了要重新生成并更新本断言");
  const bad: number[] = [];
  cases.forEach((c, i) => {
    if (unifiedDiffLines(c.a, c.b, c.from, c.to, c.n).text !== c.expect) bad.push(i);
  });
  assert.deepEqual(bad, [], `${bad.length} 例与 difflib 不符，前若干下标：${bad.slice(0, 5)}`);
});

test("无变更 → 空串（与 \"\\n\".join([]) 同）", () => {
  const same = cases.filter((c) => c.expect === "");
  assert.ok(same.length >= 1, "语料里要有「完全相同」例");
  for (const c of same) {
    const r = unifiedDiffLines(c.a, c.b, c.from, c.to, c.n);
    assert.equal(r.text, "");
    assert.equal(r.adds, 0);
    assert.equal(r.dels, 0);
    assert.equal(r.hunks, 0);
  }
});

test("adds/dels 与 +/- 正文行计数一致，hunks 与 @@ 行数一致", () => {
  for (const c of cases) {
    const r = unifiedDiffLines(c.a, c.b, c.from, c.to, c.n);
    const lines = r.text ? r.text.split("\n") : [];
    assert.equal(r.adds, lines.filter((l) => l.startsWith("+") && !l.startsWith("+++")).length);
    assert.equal(r.dels, lines.filter((l) => l.startsWith("-") && !l.startsWith("---")).length);
    assert.equal(r.hunks, lines.filter((l) => l.startsWith("@@")).length);
  }
});

test("splitLines = read_text(universal newlines) + str.splitlines", () => {
  assert.deepEqual(splitLines(""), []);
  assert.deepEqual(splitLines("a\n"), ["a"]);
  assert.deepEqual(splitLines("a\r\nb\rc"), ["a", "b", "c"]);
  assert.deepEqual(splitLines("\n\n"), ["", ""]);
  assert.deepEqual(splitLines("a\n\n"), ["a", ""]);
  // splitlines 的额外切点（\v \f \u0085 \u2028）也照 python 口径切
  assert.deepEqual(splitLines("a\u000bb\u000cc"), ["a", "b", "c"]);
  assert.deepEqual(splitLines("a\u2028b\u0085c"), ["a", "b", "c"]);
  assert.equal(splitLines("a\r\nb").join("\n"), "a\nb");
});

test("diffText 默认标签 = previous/current（snapshot.py diff_text 同形）", () => {
  const d = diffText("一\n二\n三\n", "一\n贰\n三\n");
  assert.ok(d.text.startsWith("--- previous\n+++ current\n@@"));
  assert.equal(d.adds, 1);
  assert.equal(d.dels, 1);
});
