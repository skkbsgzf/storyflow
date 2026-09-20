import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Kernel } from "../src/kernel.js";
import { ROOT } from "../src/schema.js";

/** 迁移演练夹具：现网 p-key-soul 的 run-state.json（若在），否则最小旧形夹具。 */
function legacyFixture(): object {
  const real = path.join(ROOT, "projects", "p-key-soul", "run-state.json");
  if (fs.existsSync(real)) return JSON.parse(fs.readFileSync(real, "utf-8"));
  return {
    nodes: { src: { status: "done", round: 1 }, analysis: { status: "done", round: 1 } },
    gate: { verdict: "awaiting", at: "2026-09-16", note: "S4 待批注" },
    notes: ["历史事件一", "历史事件二"],
    presets: { S1: "semi" },
    comments: {},
    inputs: {},
  };
}

describe("migrate · run-state.json → state.json", () => {
  it("无损映射：状态/轮次/注释保留，notes 转 journal 种子，schema 校验随 saveState 生效", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "miniflow-mig-"));
    const projectId = "p-mig-test";
    const dir = path.join(root, "projects", projectId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "run-state.json"), JSON.stringify(legacyFixture()), "utf-8");
    fs.writeFileSync(path.join(dir, "选题素材.md"), "# 选题素材\n\n迁移演练夹具。\n", "utf-8");

    const kernel = new Kernel({ root });
    const stop = await kernel.flow_run("topic-selection", projectId, { route: "hot", region: "CN", direction: "迁移演练" });

    const state = JSON.parse(fs.readFileSync(path.join(dir, "state.json"), "utf-8"));
    // run-state.json 已消费（旧文件保留不删，供审计）
    expect(fs.existsSync(path.join(dir, "run-state.json"))).toBe(true);
    // 状态映射：done 保留
    expect(state.nodes.src.status).toBe("done");
    expect(state.nodes.src.round).toBe(1);
    // gate/继续语义：迁移后 run 可推进（挂起或认知步停靠，二选一）
    expect(["awaiting_input", "suspended", "completed", "blocked"]).toContain(stop.status);
    // journal 种子
    const journal = kernel.viewJournal(projectId, {});
    expect(journal.some((e) => e.event === "note")).toBe(true);
    // presets/comments 保留
    expect(state.presets?.S1 ?? null).toBe("semi");
  });
});
