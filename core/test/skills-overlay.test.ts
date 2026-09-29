import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { applySkillOverlay, applyOnePatch, skillPatch, loadSkillOverlay, type SkillPatch } from "../src/skills.js";

const SKILL = ["---\nname: demo\n---", "", "# Demo", "", "## 工作流程", "", "第一步：做 A。", "", "## 纪律", "", "1. 不许瞎来。"].join("\n");

describe("W-05 · 提示词补丁层（skill-overlay@1）", () => {
  it("append 到指定小节末尾；replace 整节替换", () => {
    const append: SkillPatch = { id: "sp-1", target: "demo", section: "工作流程", op: "append", text: "第二步：做 B。", status: "applied", reason: "测试" };
    const t1 = applyOnePatch(SKILL, append).text;
    expect(t1).toContain("第一步：做 A。");
    expect(t1).toContain("第二步：做 B。");
    expect(t1.indexOf("第二步")).toBeLessThan(t1.indexOf("## 纪律"));

    const replace: SkillPatch = { id: "sp-2", target: "demo", section: "纪律", op: "replace", text: "1. 只许按流程来。", status: "applied", reason: "测试" };
    const t2 = applyOnePatch(SKILL, replace).text;
    expect(t2).toContain("只许按流程来。");
    expect(t2).not.toContain("不许瞎来");
    expect(t2).toContain("## 工作流程");
  });

  it("目标小节缺失 → miss 显式回显，原文不动", () => {
    const r = applyOnePatch(SKILL, { id: "sp-3", target: "demo", section: "不存在的小节", op: "append", text: "x", status: "applied", reason: "r" });
    expect(r.miss).toContain("小节不存在");
    expect(r.text).toBe(SKILL);
  });

  it("proposed 不参与装载；applySkillOverlay 只吃 applied", () => {
    const patches: SkillPatch[] = [
      { id: "p1", target: "demo", section: "工作流程", op: "append", text: "PROPOSED", status: "proposed", reason: "r" },
      { id: "p2", target: "demo", section: "工作流程", op: "append", text: "APPLIED", status: "applied", reason: "r" },
    ];
    const r = applySkillOverlay(SKILL, "demo", patches);
    expect(r.text).toContain("APPLIED");
    expect(r.text).not.toContain("PROPOSED");
    expect(r.misses).toHaveLength(0);
  });

  it("skillPatch 生命周期：add=proposed → approve=applied（校验目标存在）→ reject 校验状态机", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "miniflow-sk-"));
    fs.mkdirSync(path.join(root, "skills"), { recursive: true });
    fs.writeFileSync(path.join(root, "skills", "demo.md"), SKILL);
    // add：目标不存在要报错
    expect(() => skillPatch(root, { action: "add", target: "ghost", text: "x", reason: "r" })).toThrow(/不存在/);
    const ps = skillPatch(root, { action: "add", target: "demo", section: "工作流程", text: "第三步：自检。", reason: "用户批注" });
    expect(ps.at(-1)?.status).toBe("proposed");
    const id = ps.at(-1)!.id;
    // 批准时小节存在 → applied + 时间戳
    const ok = skillPatch(root, { action: "approve", id });
    expect(ok.find((x) => x.id === id)?.status).toBe("applied");
    expect(ok.find((x) => x.id === id)?.appliedAt).toBeTruthy();
    // 已 applied 不可再 reject；加载层 round-trip 一致
    expect(() => skillPatch(root, { action: "reject", id })).toThrow(/仅 proposed/);
    const reloaded = loadSkillOverlay(root);
    expect(reloaded.patches).toHaveLength(1);
    expect(reloaded.patches[0].text).toContain("自检");
  });
});
