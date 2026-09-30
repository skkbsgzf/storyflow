import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Kernel } from "../src/kernel.js";
import { effectiveFlow3 } from "../src/modules.js";
import { listProductionPresets, loadPresetOverlay, suggestProductionPreset } from "../src/production-preset.js";
import type { FlowDescriptor } from "../src/types.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "miniflow-pp1-"));
}

// ═══════════════ manifest / overlay 装载 ═══════════════

describe("production-preset · manifest 与 overlay 装载", () => {
  it("真实仓库 5 个预设全部健康，overlay 归属正确", () => {
    const list = listProductionPresets(REPO_ROOT);
    const byId = new Map(list.map((p) => [p.id, p]));
    expect([...byId.keys()].sort()).toEqual(["comfyui-script", "screen-play", "short-story", "web-novel", "world-bible"]);
    for (const p of list) expect(p.broken).toBeUndefined();
    expect(byId.get("web-novel")?.flows).toEqual([{ flowId: "novel", hasOverlay: false }]);
    expect(byId.get("screen-play")?.flows).toEqual([{ flowId: "screenplay", hasOverlay: false }]);
    expect(byId.get("world-bible")?.flows).toEqual([{ flowId: "novel", hasOverlay: true }]);
    expect(byId.get("comfyui-script")?.flows).toEqual([{ flowId: "screenplay", hasOverlay: true }]);
    expect(byId.get("short-story")?.flows).toEqual([{ flowId: "topic", hasOverlay: true }]);
  });

  it("broken preset 照常列出（缺 manifest / 非法目录名跳过）", () => {
    const root = tmpRoot();
    fs.mkdirSync(path.join(root, "presets", "no-manifest"), { recursive: true });
    fs.mkdirSync(path.join(root, "presets", "Bad_ID"), { recursive: true });
    const list = listProductionPresets(root);
    expect(list.map((p) => p.id)).toEqual(["no-manifest"]);
    expect(list[0]?.broken).toMatch(/missing/);
  });

  it("loadPresetOverlay：缺失 = undefined；JSON/schema/flowId 不符 → 大声失败", () => {
    expect(loadPresetOverlay(REPO_ROOT, "web-novel", "novel")).toBeUndefined(); // manifest-only
    const overlay = loadPresetOverlay(REPO_ROOT, "world-bible", "novel");
    expect(overlay?.patches).toHaveLength(3);
    expect(overlay?.patches.every((p) => p.kind === "set-module")).toBe(true);

    const root = tmpRoot();
    const dir = path.join(root, "presets", "broken");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "overlay.novel.json"), "{ not json", "utf-8");
    expect(() => loadPresetOverlay(root, "broken", "novel")).toThrow(/JSON 非法/);
    fs.writeFileSync(
      path.join(dir, "overlay.novel.json"),
      JSON.stringify({ format: "flow-overlay@1", flowId: "novel", origin: "factory", reason: "x", patches: [{ kind: "nope-kind", reason: "x" }] }),
      "utf-8",
    );
    expect(() => loadPresetOverlay(root, "broken", "novel")).toThrow(/不合契约/);
    fs.writeFileSync(
      path.join(dir, "overlay.novel.json"),
      JSON.stringify({ format: "flow-overlay@1", flowId: "screenplay", origin: "factory", reason: "x", patches: [] }),
      "utf-8",
    );
    expect(() => loadPresetOverlay(root, "broken", "novel")).toThrow(/flowId 不符/);
  });
});

// ═══════════════ set-module remove（expander 层） ═══════════════

describe("production-preset · set-module remove", () => {
  it("effectiveFlow3：remove 裁掉模块实例，展开图无该模块节点，notes 留痕", () => {
    const flow = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "flows", "novel", "flow.json"), "utf-8")) as FlowDescriptor;
    const r = effectiveFlow3(REPO_ROOT, flow, {
      projectDir: tmpRoot(),
      overlays: [
        {
          format: "flow-overlay@1",
          flowId: "novel",
          origin: "factory",
          reason: "test",
          patches: [
            { kind: "set-module", id: "m3", remove: true, reason: "test" },
            { kind: "set-module", id: "m4", remove: true, reason: "test" },
            { kind: "set-module", id: "m5", remove: true, reason: "test" },
          ],
        },
      ],
    });
    const ids = Object.keys(r.flow.graph.nodes);
    expect(ids.some((id) => /^(m3|m4|m5)\./.test(id))).toBe(false);
    expect(ids.some((id) => id.startsWith("m2."))).toBe(true);
    expect(r.notes.join("；")).toContain("m4 removed");
    // 未触 remove 的模块照常
    const r2 = effectiveFlow3(REPO_ROOT, flow, { projectDir: tmpRoot(), overlays: [] });
    expect(Object.keys(r2.flow.graph.nodes).some((id) => id.startsWith("m4."))).toBe(true);
  });

  it("remove 不存在的模块实例 → 进 unsupported（不静默）", () => {
    const flow = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "flows", "novel", "flow.json"), "utf-8")) as FlowDescriptor;
    const r = effectiveFlow3(REPO_ROOT, flow, {
      projectDir: tmpRoot(),
      overlays: [
        { format: "flow-overlay@1", flowId: "novel", origin: "factory", reason: "test", patches: [{ kind: "set-module", id: "mx", remove: true, reason: "test" }] },
      ],
    });
    expect(r.unsupported.join("；")).toMatch(/模块实例不存在/);
  });
});

// ═══════════════ Kernel 集成（flow_run(opts.preset)） ═══════════════

describe("production-preset · kernel 集成", () => {
  it("world-bible 预设：novel 只剩 m1/m2（无台账/正文/结算），state.preset 持久", async () => {
    const root = tmpRoot();
    const kernel = new Kernel({ root });
    const projectId = "p-worldbible";
    fs.mkdirSync(path.join(root, "projects", projectId), { recursive: true });
    const stop = await kernel.flow_run("novel", projectId, { premise: "世界观锻造 e2e：修仙世界的盐业经济" }, { preset: "world-bible" });
    expect(stop.status === "awaiting_input" || stop.status === "suspended" || stop.status === "completed").toBe(true);
    const state = JSON.parse(fs.readFileSync(path.join(root, "projects", projectId, "state.json"), "utf-8"));
    expect(state.preset).toBe("world-bible");
    const ids: string[] = Object.keys(state.nodes);
    expect(ids.some((id) => /^(m3|m4|m5)\./.test(id))).toBe(false);
    expect(ids.some((id) => id.startsWith("m2."))).toBe(true);
  });

  it("comfyui-script 预设：screenplay 展开图含 m3.render-prompt-seedance", async () => {
    const root = tmpRoot();
    const kernel = new Kernel({ root });
    const projectId = "p-comfyui";
    fs.mkdirSync(path.join(root, "projects", projectId), { recursive: true });
    await kernel.flow_run("screenplay", projectId, { direction: "霸总短剧 e2e" }, { preset: "comfyui-script" });
    const state = JSON.parse(fs.readFileSync(path.join(root, "projects", projectId, "state.json"), "utf-8"));
    const ids: string[] = Object.keys(state.nodes);
    expect(ids).toContain("m3.render-prompt-seedance");
    expect(ids).toContain("m3.scene-breakdown");
  });

  it("short-story 预设：topic 裁掉交付页（无 m5.），其余模块照常", async () => {
    const root = tmpRoot();
    const kernel = new Kernel({ root });
    const projectId = "p-shortstory";
    fs.mkdirSync(path.join(root, "projects", projectId), { recursive: true });
    await kernel.flow_run("topic", projectId, { direction: "短篇 e2e", route: "hot" }, { preset: "short-story" });
    const state = JSON.parse(fs.readFileSync(path.join(root, "projects", projectId, "state.json"), "utf-8"));
    const ids: string[] = Object.keys(state.nodes);
    expect(ids.some((id) => id.startsWith("m5."))).toBe(false);
    expect(ids.some((id) => id.startsWith("m4."))).toBe(true);
  });

  it("缺省（不带 preset）novel 保持完整流水线；未知预设大声失败", async () => {
    const root = tmpRoot();
    const kernel = new Kernel({ root });
    const projectId = "p-default";
    fs.mkdirSync(path.join(root, "projects", projectId), { recursive: true });
    await kernel.flow_run("novel", projectId, { premise: "缺省流水线 e2e" });
    const state = JSON.parse(fs.readFileSync(path.join(root, "projects", projectId, "state.json"), "utf-8"));
    const ids: string[] = Object.keys(state.nodes);
    expect(ids.some((id) => id.startsWith("m4."))).toBe(true); // 正文模块在场
    expect(state.preset).toBeUndefined();
    await expect(kernel.flow_run("novel", "p-other", { premise: "x" }, { preset: "no-such" })).rejects.toThrow(/不存在/);
  });
});

// ═══════════════ flow_chain（跨流水线级联，Phase 2） ═══════════════

describe("production-preset · flow_chain 跨流水线级联", () => {
  it("搬运产物 → 新项目素材目录 → 目标流水线开跑（preset 透传 + 双边 journal 接力）", async () => {
    const root = tmpRoot();
    const kernel = new Kernel({ root });
    const fromId = "p-src";
    fs.mkdirSync(path.join(root, "projects", fromId), { recursive: true });
    fs.writeFileSync(path.join(root, "projects", fromId, "选题素材.md"), "# 选题素材\n\n甲方点子：级联 e2e。\n", "utf-8");
    await kernel.flow_run("topic", fromId, { direction: "级联源 e2e", route: "hot" });
    fs.mkdirSync(path.join(root, "projects", fromId, "01-选题"), { recursive: true });
    fs.writeFileSync(path.join(root, "projects", fromId, "01-选题", "选题报告.md"), "# 选题报告（级联源）\n\n> 成品在盘供搬运。\n", "utf-8");

    const r = await kernel.flow_chain(fromId, "screenplay", {
      preset: "comfyui-script",
      inputs: { direction: "级联目标 e2e：快剪店短剧" },
      copyArtifacts: ["01-选题/选题报告.md", "选题素材.md"],
    });
    expect(r.projectId).toBe(`${fromId}.screenplay`);
    expect(r.copied).toEqual(["00-素材/01-选题/选题报告.md", "00-素材/选题素材.md"]);
    for (const rel of r.copied) {
      expect(fs.existsSync(path.join(root, "projects", r.projectId, rel))).toBe(true);
    }
    const state = JSON.parse(fs.readFileSync(path.join(root, "projects", r.projectId, "state.json"), "utf-8"));
    expect(state.preset).toBe("comfyui-script");
    expect(Object.keys(state.nodes)).toContain("m3.render-prompt-seedance");
    const fromJournal = fs.readFileSync(path.join(root, "projects", fromId, "journal.jsonl"), "utf-8");
    expect(fromJournal).toContain("chain-out");
    const toJournal = fs.readFileSync(path.join(root, "projects", r.projectId, "journal.jsonl"), "utf-8");
    expect(toJournal).toContain("chain-in");
  });

  it("错误面：源缺失 NO_RUN / 搬运文件缺失 FILE_MISSING / 目标已存在 RUN_EXISTS", async () => {
    const root = tmpRoot();
    const kernel = new Kernel({ root });
    await expect(kernel.flow_chain("ghost", "screenplay", {})).rejects.toThrow(/源项目无 state/);
    const fromId = "p-src2";
    fs.mkdirSync(path.join(root, "projects", fromId), { recursive: true });
    fs.writeFileSync(path.join(root, "projects", fromId, "选题素材.md"), "# x\n", "utf-8");
    await kernel.flow_run("topic", fromId, { direction: "e2e", route: "hot" });
    await expect(
      kernel.flow_chain(fromId, "screenplay", { copyArtifacts: ["不存在.md"], inputs: { direction: "x" } }),
    ).rejects.toThrow(/源产物不存在/);
    await kernel.flow_chain(fromId, "screenplay", { inputs: { direction: "第一次级联" } });
    await expect(kernel.flow_chain(fromId, "screenplay", { inputs: { direction: "x" } })).rejects.toThrow(/已有 state/);
  });
});

// ═══════════════ R8 · Auto 预设路由（规则式 v1） ═══════════════

describe("production-preset · Auto 路由（规则式 v1）", () => {
  it("规则点名校验：screenplay 视频语义 → comfyui-script；novel 世界观 → world-bible；topic 短篇 → short-story", () => {
    expect(suggestProductionPreset("screenplay", { direction: "把这段做成带分镜提示词的短视频" })?.preset).toBe("comfyui-script");
    expect(suggestProductionPreset("novel", { premise: "修仙世界的世界观与势力设定集" })?.preset).toBe("world-bible");
    expect(suggestProductionPreset("topic", { direction: "一个短篇速成的小故事" })?.preset).toBe("short-story");
  });

  it("未命中 = undefined（缺省流水线）；project 结构位不参与路由；非字符串输入忽略", () => {
    expect(suggestProductionPreset("screenplay", { direction: "霸总短剧" })).toBeUndefined();
    expect(suggestProductionPreset("novel", { premise: "快剪店慢手艺" })).toBeUndefined();
    expect(suggestProductionPreset("novel", { project: { note: "世界观" }, premise: "普通长篇" })).toBeUndefined();
    expect(suggestProductionPreset("novel", { batchSize: 10 })).toBeUndefined();
    expect(suggestProductionPreset("novel", {})).toBeUndefined();
  });

  it("flow_run(preset:'auto')：命中 → 编排按解析后预设展开，state.preset 存解析 id（不存 'auto'），journal 留路由理由", async () => {
    const root = tmpRoot();
    const kernel = new Kernel({ root });
    const projectId = "p-auto";
    fs.mkdirSync(path.join(root, "projects", projectId), { recursive: true });
    await kernel.flow_run("screenplay", projectId, { direction: "把甲方点子做成分镜提示词视频" }, { preset: "auto" });
    const state = JSON.parse(fs.readFileSync(path.join(root, "projects", projectId, "state.json"), "utf-8"));
    expect(state.preset).toBe("comfyui-script");
    expect(Object.keys(state.nodes)).toContain("m3.render-prompt-seedance");
    const journal = fs.readFileSync(path.join(root, "projects", projectId, "journal.jsonl"), "utf-8");
    expect(journal).toContain("preset-route");
    expect(journal).toMatch(/Auto 路由（规则式 v1）：comfyui-script/);
  });

  it("flow_run(preset:'auto')：未命中 → 缺省流水线（state.preset 缺省）；显式 preset 不受影响", async () => {
    const root = tmpRoot();
    const kernel = new Kernel({ root });
    const projectId = "p-auto-miss";
    fs.mkdirSync(path.join(root, "projects", projectId), { recursive: true });
    await kernel.flow_run("screenplay", projectId, { direction: "霸总短剧" }, { preset: "auto" });
    const state = JSON.parse(fs.readFileSync(path.join(root, "projects", projectId, "state.json"), "utf-8"));
    expect(state.preset).toBeUndefined();
    expect(Object.keys(state.nodes)).not.toContain("m3.render-prompt-seedance");
    await expect(kernel.flow_run("screenplay", "p-bad", { direction: "x" }, { preset: "no-such" })).rejects.toThrow(/不存在/);
  });

  it("kernel.suggestPreset 预览面与规则同源", () => {
    const root = tmpRoot();
    const kernel = new Kernel({ root });
    expect(kernel.suggestPreset("screenplay", { direction: "comfy 视频提示词" })?.preset).toBe("comfyui-script");
    expect(kernel.suggestPreset("novel", { premise: "普通长篇" })).toBeUndefined();
  });
});
