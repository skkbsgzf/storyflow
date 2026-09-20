import { describe, expect, it, beforeAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Kernel } from "../src/kernel.js";
import { ROOT } from "../src/schema.js";

describe("K1+K2 · 项目背景卡与派发头", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miniflow-spawn-"));
  const projectId = "p-spawn";
  const kernel = new Kernel({ root });

  beforeAll(async () => {
    fs.cpSync(path.join(ROOT, "agents"), path.join(root, "agents"), { recursive: true });
    const dir = path.join(root, "projects", projectId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "选题素材.md"),
      "# 选题素材\n\n甲方点子：老牌发型师在连锁快剪店里坚持先洗后剪慢工出细活。\n",
      "utf-8",
    );
    fs.writeFileSync(
      path.join(dir, "词汇表.json"),
      JSON.stringify({ project: projectId, own: ["王拾"], banned: ["王楚钦", "马龙"] }),
      "utf-8",
    );
  });

  it("flow_next 默认输出不含 spawnPrompt（向后兼容，主线程零感知）", async () => {
    const stop = await kernel.flow_run("topic-selection", projectId, {
      route: "hot",
      region: "CN",
      direction: "老牌发型师（spawn 测试）",
    });
    expect(stop.status).toBe("awaiting_input");
    expect("spawnPrompt" in stop).toBe(false);
  });

  it("K1 背景卡：任务包含项目/阶段/甲方点子/红线/交付物", async () => {
    const stop = await kernel.flow_next(projectId);
    expect(stop.status).toBe("awaiting_input");
    if (stop.status !== "awaiting_input") return;
    const pkg = stop.taskPackage;
    expect(pkg.background).toBeTruthy();
    expect(pkg.background).toContain(`项目：${projectId}`);
    expect(pkg.background).toContain("阶段：S1");
    expect(pkg.background).toContain("甲方点子：");
    expect(pkg.background).toContain("老牌发型师");
    expect(pkg.background).toContain("王楚钦"); // banned 红线入卡
    expect(pkg.background).toContain("梗卡.md"); // 交付物路径
  });

  it("K2 派发头：角色/指令/交卷四要素/禁止项 齐备，batch 逐项渲染", async () => {
    const stop = await kernel.flow_next(projectId, { spawnPrompt: true });
    expect(stop.status).toBe("awaiting_input");
    if (stop.status !== "awaiting_input") return;
    const prompts = [stop.spawnPrompt, ...(stop.batch ?? []).map((b) => b.spawnPrompt)].filter(
      (s): s is string => !!s,
    );
    expect(prompts.length).toBeGreaterThanOrEqual(1);
    for (const p of prompts) {
      expect(p).toContain("【角色】");
      expect(p).toContain("【项目背景】");
      expect(p).toContain("【工作指令】");
      expect(p).toContain("【交卷】");
      expect(p).toContain("四要素");
      expect(p).toContain("projects/_archive"); // 禁止项在派发头里，不靠子代理自觉
      expect(p).toContain("仅允许 Read / Write / WebSearch"); // 工具纪律
    }
    // 单节点形态：顶层 spawnPrompt 对应 nodeId 的任务包（找梗师 → 交付物是梗卡）
    if (stop.nodeId === "tropes") expect(stop.spawnPrompt).toContain("梗卡.md");
  });

  it("降级：无 词汇表.json 时背景卡走通用合规提示（不崩、不出现专属词行）", async () => {
    const dir2 = path.join(root, "projects", "p-spawn2");
    fs.mkdirSync(dir2, { recursive: true });
    fs.writeFileSync(
      path.join(dir2, "选题素材.md"),
      "# 选题素材\n\n甲方点子：降级测试用的点子。\n",
      "utf-8",
    );
    // 注意：不创建 词汇表.json
    const run = await kernel.flow_run("topic-selection", "p-spawn2", { route: "hot", region: "CN", direction: "降级测试" });
    expect(["awaiting_input", "blocked"]).toContain(run.status);
    const stop = await kernel.flow_next("p-spawn2", { spawnPrompt: true });
    expect(stop.status).toBe("awaiting_input");
    if (stop.status !== "awaiting_input") return;
    expect(stop.taskPackage.background).toBeTruthy();
    expect(stop.taskPackage.background).not.toContain("项目专属词");
    expect(stop.spawnPrompt).toContain("不出现真实人名/机构名");
  });
});
