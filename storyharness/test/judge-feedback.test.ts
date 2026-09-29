// 工单 D-B1 · readLastJudgeFeedback 两态单测
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readLastJudgeFeedback } from "../src/executor.js";

const mk = () => fs.mkdtempSync(path.join(os.tmpdir(), "sh-jf-"));
const w = (dir: string, name: string, obj: unknown, ageMs = 0) => {
  const p = path.join(dir, name);
  fs.writeFileSync(p, JSON.stringify(obj), "utf-8");
  if (ageMs) { const t = new Date(Date.now() - ageMs); fs.utimesSync(p, t, t); }
};

test("B1：有 flagged 的过闸收据 → 注入数据源命中", () => {
  const dir = mk();
  w(dir, "a.json", { node: "m1.x", submit: { status: "accepted" }, judge: { ran: true, flagged: ["slop.ai-trace.v2.noul"] } }, 1000);
  const fb = readLastJudgeFeedback(dir, "m2.y");
  assert.equal(fb?.node, "m1.x");
  assert.deepEqual(fb?.flagged, ["slop.ai-trace.v2.noul"]);
});

test("B1：排除本节点 / 未过闸不算 / flagged 空不算", () => {
  const dir = mk();
  w(dir, "self.json", { node: "m1.x", submit: { status: "accepted" }, judge: { ran: true, flagged: ["c1"] } });
  assert.equal(readLastJudgeFeedback(dir, "m1.x"), null);       // 本节点排除
  const dir2 = mk();
  w(dir2, "rej.json", { node: "m1.x", submit: { status: "rejected" }, judge: { ran: true, flagged: ["c1"] } });
  assert.equal(readLastJudgeFeedback(dir2, "m2.y"), null);       // 被拒不算过闸
  const dir3 = mk();
  w(dir3, "clean.json", { node: "m1.x", submit: { status: "accepted" }, judge: { ran: true, flagged: [] } });
  assert.equal(readLastJudgeFeedback(dir3, "m2.y"), null);       // flagged 空
});

test("B1：多收据按 mtime 取最近 + 目录不存在零打扰", () => {
  const dir = mk();
  w(dir, "old.json", { node: "m1.old", submit: { status: "accepted" }, judge: { ran: true, flagged: ["old-c"] } }, 60_000);
  w(dir, "new.json", { node: "m1.new", submit: { status: "accepted" }, judge: { ran: true, flagged: ["new-c"] } });
  assert.equal(readLastJudgeFeedback(dir, "m2.y")?.flagged[0], "new-c");
  assert.equal(readLastJudgeFeedback(path.join(dir, "不存在"), "m2.y"), null);
});
