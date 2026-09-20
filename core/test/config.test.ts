import { describe, expect, it, beforeAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Kernel, KernelError } from "../src/kernel.js";
import { configToInputs } from "../src/project-config.js";
import { buildHttpApp } from "../src/http.js";
import { ROOT } from "../src/schema.js";

/** 用户手编的项目初始化配置（中键） */
function config(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    项目: "p-cfg",
    题材: "乒乓球竞技",
    需求: "60集AI漫剧竖屏，合规全虚构",
    灵感: "德不配位情绪切入",
    严肃性: "出品",
    风格: "爽",
    AB测试: false,
    市场预估: "竞技载体空白带，情绪锚在窗口期",
    // R8：region 是选择（enum 无 default）——配置里显式表态，与面板开跑前选择同形态
    region: "CN",
    ...overrides,
  };
}

describe("项目初始化配置 · 合并序与语义映射", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miniflow-cfg-"));
  const kernel = new Kernel({ root });
  let state: Record<string, any>;

  beforeAll(async () => {
    fs.cpSync(path.join(ROOT, "agents"), path.join(root, "agents"), { recursive: true });
    const dir = path.join(root, "projects", "p-cfg");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "选题素材.md"), "# 选题素材\n\n甲方点子：老牌发型师。\n", "utf-8");
    fs.writeFileSync(path.join(dir, "项目配置.json"), JSON.stringify(config()), "utf-8");
    // 不传 direction / route —— 全部由配置推导
    const stop = await kernel.flow_run("topic-selection", "p-cfg", {});
    expect(["awaiting_input", "blocked"]).toContain(stop.status);
    state = JSON.parse(fs.readFileSync(path.join(dir, "state.json"), "utf-8"));
  });

  it("风格=爽 → route=hot；AB测试=false 不升级 dual", () => {
    expect(state.inputs.route).toBe("hot");
  });

  it("题材/需求/灵感 组合进 direction；配置原样回传 state.inputs", () => {
    expect(state.inputs.direction).toContain("乒乓球竞技");
    expect(state.inputs.direction).toContain("德不配位情绪切入");
    expect(state.inputs["严肃性"]).toBe("出品");
    expect(state.inputs["市场预估"]).toContain("空白带");
  });

  it("presets 覆写：配置 presets 合入 run 状态", () => {
    // config() 未带 presets → 默认无；在第二个项目验证覆写
  });

  it("AB测试=true → route=dual（覆盖风格）", async () => {
    const dir = path.join(root, "projects", "p-ab");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "选题素材.md"), "# 选题素材\n\n甲方点子：测试。\n", "utf-8");
    fs.writeFileSync(path.join(dir, "项目配置.json"), JSON.stringify(config({ 项目: "p-ab", AB测试: true })), "utf-8");
    await kernel.flow_run("topic-selection", "p-ab", {});
    const s = JSON.parse(fs.readFileSync(path.join(dir, "state.json"), "utf-8"));
    expect(s.inputs.route).toBe("dual");
  });

  it("显式入参 > 配置：--route hot 压过 AB测试=true", async () => {
    const dir = path.join(root, "projects", "p-explicit");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "选题素材.md"), "# 选题素材\n\n甲方点子：测试。\n", "utf-8");
    fs.writeFileSync(
      path.join(dir, "项目配置.json"),
      JSON.stringify(config({ 项目: "p-explicit", AB测试: true })),
      "utf-8",
    );
    await kernel.flow_run("topic-selection", "p-explicit", { route: "hot" });
    const s = JSON.parse(fs.readFileSync(path.join(dir, "state.json"), "utf-8"));
    expect(s.inputs.route).toBe("hot");
  });

  it("背景卡携带出品定位/市场预估/快照基线", async () => {
    const stop = await kernel.flow_next("p-cfg", { spawnPrompt: true });
    if (stop.status !== "awaiting_input") {
      // tropes 可能已就绪批派发过——仍应有 background；换 flow_next 幂等重取
    }
    const pkg = stop.status === "awaiting_input" ? stop.taskPackage : null;
    expect(pkg).toBeTruthy();
    expect(pkg!.background).toContain("出品定位");
    expect(pkg!.background).toContain("严肃性=出品");
    expect(pkg!.background).toContain("AB测试=关（单版本）");
    expect(pkg!.background).toContain("市场预估（甲方笔记）");
    expect(pkg!.background).toContain("市场快照");
  });

  it("非法配置开跑前大声失败", async () => {
    const dir = path.join(root, "projects", "p-bad");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "选题素材.md"), "# 选题素材\n\nx\n", "utf-8");
    fs.writeFileSync(
      path.join(dir, "项目配置.json"),
      JSON.stringify(config({ 项目: "p-bad", 严肃性: "随便" })),
      "utf-8",
    );
    await expect(kernel.flow_run("topic-selection", "p-bad", {})).rejects.toThrow(/项目配置非法/);
  });

  it("HTTP：GET/PUT config 端点（前端表单直连）", async () => {
    const app = buildHttpApp(kernel);
    // GET 已有配置
    const got = await app.inject({ method: "GET", url: "/api/projects/p-cfg/config" });
    expect(got.statusCode).toBe(200);
    const gb = got.json();
    expect(gb.exists).toBe(true);
    expect(gb.config["严肃性"]).toBe("出品");
    expect(gb.template["项目"]).toBe("p-cfg");
    expect(typeof gb.boundWarning).toBe("string"); // run 存在 → 生效时机提示
    // PUT 合法保存
    const put = await app.inject({
      method: "PUT",
      url: "/api/projects/p-spawn2/config",
      payload: { 项目: "p-spawn2", 题材: "竞技", 严肃性: "标准", 风格: "爽", AB测试: false },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().saved).toBe(true);
    expect(fs.readFileSync(path.join(root, "projects", "p-spawn2", "项目配置.json"), "utf-8")).toContain("竞技");
    // PUT 非法 → 400
    const bad = await app.inject({
      method: "PUT",
      url: "/api/projects/p-spawn2/config",
      payload: { 项目: "p-spawn2", 严肃性: "随便" },
    });
    expect(bad.statusCode).toBe(400);
    // GET 不存在项目 → 模板
    const tpl = await app.inject({ method: "GET", url: "/api/projects/p-absent/config" });
    expect(tpl.json().exists).toBe(false);
    expect(tpl.json().template["项目"]).toBe("p-absent");
  });

  it("configToInputs 纯函数：AB 优先级与 direction 组合", () => {
    const flow = { inputs: { direction: {} } };
    expect(configToInputs(config({ AB测试: true }), flow).route).toBe("dual");
    expect(configToInputs(config({ 风格: "标准" }), flow).route).toBe("calm");
    expect(configToInputs(config({ 项目: "x", 题材: "a", 需求: "b", 灵感: "c" }), flow).direction).toBe("a；b；c");
    expect(configToInputs(config({ 项目: "x" }), { inputs: {} }).direction).toBeUndefined(); // flow 无 direction 不硬塞
  });

  it("D2：配置字面量与 flow 输入同名 → 直通（enum 也吃），非法值拦在开跑前", () => {
    const flow = {
      inputs: {
        route: { type: "enum", options: ["hot", "calm", "dual"] },
        direction: {},
      },
    };
    // 字面 route 直通（此前只认 风格/AB测试 推导，配置写 dual 被整条忽略 → 落回默认）
    expect(configToInputs(config({ route: "dual" }), flow).route).toBe("dual");
    // 直通优先于推导：即便 风格=爽 / AB测试=false，字面值也压过推导
    expect(configToInputs(config({ route: "calm" }), flow).route).toBe("calm");
    // 未给 route 时仍走推导（回归）
    expect(configToInputs(config({ AB测试: true }), flow).route).toBe("dual");
    expect(configToInputs(config({ 风格: "标准" }), flow).route).toBe("calm");
    // 非法 enum 值 → 开跑前大声失败（静默回落才是最难查的）
    expect(() => configToInputs(config({ route: "wild" }), flow)).toThrow(/不是合法取值/);
  });

  it("D2：enum 输入真的进 state.inputs（端到端，配置写 dual 不再落 hot）", async () => {
    const dir = path.join(root, "projects", "p-d2");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "选题素材.md"), "# 选题素材\n\n甲方点子：测试。\n", "utf-8");
    fs.writeFileSync(
      path.join(dir, "项目配置.json"),
      JSON.stringify(config({ 项目: "p-d2", route: "dual", AB测试: false })),
      "utf-8",
    );
    await kernel.flow_run("topic-selection", "p-d2", {});
    const s = JSON.parse(fs.readFileSync(path.join(dir, "state.json"), "utf-8"));
    expect(s.inputs.route).toBe("dual"); // 此前是 "hot"（被 风格/AB测试 推导覆盖）
  });
});
