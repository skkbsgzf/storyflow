// 工单 E-A · 权限四档工具集单测（D-E）：每档逐工具名断言——自测纪律：工具环必须逐工具验证
import { test } from "node:test";
import assert from "node:assert/strict";
import { toolsForMode, CHAT_MODES } from "../src/chat.js";
import { KernelClient } from "../src/kernel.js";
import path from "node:path";

const k = new KernelClient("http://127.0.0.1:1", path.resolve(), {
  projectsDir: "projects", receiptsDir: "内部/收据", quarantineDir: "内部/x",
  sessionsDir: "内部/sessions", telemetryDir: "内部/telemetry", lintTool: "tools/x.py", lintCommand: "node",
} as never);
const names = (mode: string) => toolsForMode(k, "p-t", mode as never).map((t) => t.name).sort();

test("权限四档的档位标签齐备", () => {
  assert.deepEqual(Object.keys(CHAT_MODES).sort(), ["auto", "confirm", "full", "plan"]);
  assert.ok(CHAT_MODES.plan.label === "计划模式" && CHAT_MODES.full.label === "完全访问");
});

test("plan 档：无 fs_write、无 flow 生命周期（只读）", () => {
  const n = names("plan");
  assert.ok(!n.includes("fs_write"), "plan 不得有 fs_write");
  assert.ok(!n.includes("mf_flow_run") && !n.includes("mf_flow_submit") && !n.includes("mf_flow_resume") && !n.includes("mf_flow_init"), "plan 不得推进流程");
  assert.ok(n.includes("fs_read") && n.includes("mf_whereami") && n.includes("mf_flow_next"), "plan 保留只读面");
});

test("confirm/auto/full 档：全环（fs_write + 生命周期六动词）", () => {
  for (const m of ["confirm", "auto", "full"]) {
    const n = names(m);
    assert.ok(n.includes("fs_write"), m + " 应有 fs_write");
    for (const v of ["mf_flow_init", "mf_flow_run", "mf_flow_next", "mf_flow_submit", "mf_flow_resume", "mf_flow_list"]) {
      assert.ok(n.includes(v), m + " 应有 " + v);
    }
  }
});

test("confirm 档系统提示带确认纪律，plan 带 只读 声明", () => {
  assert.match(CHAT_MODES.confirm.systemAddon, /确认/);
  assert.match(CHAT_MODES.plan.systemAddon, /只读/);
});
