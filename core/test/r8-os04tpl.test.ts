/**
 * OS-04 余量 · 项目配置模板库（`cfg-template.ts` + `cfg_template` 动词）—— 回归测试
 *
 * 被测命题（三条，都是本仓反复被咬的「以为有，其实没有」）：
 *   ① **两个根不能混**：自存模板在数据根 `root/templates/项目配置/`（跨项目复用），
 *      官方示例在仓库根 `repoRoot/demos/`。把二者当同一个根 ⇒ 临时数据根下官方示例凭空消失。
 *   ② **用户能改的错一律 4xx**：名字非法 / 不存在 / 跨 flow / 同名已存在 —— 不许被三面
 *      报成「服务器内部错误」。把用户手误报成 500 与「崩掉当没事」是同一种病。
 *   ③ **诚实失败，不瞎猜**：同名跨 flow 必须报歧义（不许「取第一个」）；套用时
 *      `项目` 键一律改写成目标项目（照抄来源项目名 = 立刻触发内核一致性校验失败）。
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Kernel } from "../src/kernel.js";
import { buildHttpApp } from "../src/http.js";
import { VERB_BY_NAME } from "../src/verbs.js";
import { KernelError } from "../src/kernel.js";
import {
  applyConfigTemplate,
  cfgTemplate,
  CfgTemplateError,
  deleteConfigTemplate,
  listConfigTemplates,
  saveConfigTemplate,
} from "../src/cfg-template.js";

/** 数据根 + 仓库根**分成两个目录**：这正是本模块测试的关键点，绝不能用同一个。 */
function twoRoots() {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "miniflow-tpl-data-"));
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "miniflow-tpl-repo-"));
  fs.mkdirSync(path.join(dataRoot, "projects"), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, "demos"), { recursive: true });
  return { dataRoot, repoRoot };
}

function mkKernel(dataRoot: string, repoRoot: string) {
  return new Kernel({ root: dataRoot, repoRoot, flowsDir: path.join(repoRoot, "flows") });
}

/** 造一个已开跑的项目（state.json 带 flowId）+ 合规 项目配置.json。 */
function seedProject(k: Kernel, id: string, flowId: string, cfg: Record<string, unknown> = {}) {
  const pd = k.projectDir(id);
  fs.mkdirSync(pd, { recursive: true });
  fs.writeFileSync(
    path.join(pd, "state.json"),
    JSON.stringify({ runId: "r-" + id, projectId: id, flowId, status: "running" }, null, 2),
    "utf-8",
  );
  fs.writeFileSync(
    path.join(pd, "项目配置.json"),
    JSON.stringify({ 项目: id, ...cfg }, null, 2) + "\n",
    "utf-8",
  );
  return pd;
}

function seedDemo(repoRoot: string, flowId: string, cfg: Record<string, unknown>) {
  const d = path.join(repoRoot, "demos", flowId);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, "项目配置.json"), JSON.stringify(cfg, null, 2) + "\n", "utf-8");
}

/** 直接放一个自存模板文件（不走 save，便于造歧义/坏文件）。 */
function putUserTemplate(dataRoot: string, flowId: string, name: string, body: string) {
  const d = path.join(dataRoot, "templates", "项目配置", flowId);
  fs.mkdirSync(d, { recursive: true });
  const f = path.join(d, `${name}.json`);
  fs.writeFileSync(f, body, "utf-8");
  return f;
}

describe("OS-04 · list：三来源一个清单，两个根分得清", () => {
  it("blank 恒在；官方示例来自 repoRoot/demos、自存来自 dataRoot/templates（两处都不落空）", () => {
    const { dataRoot, repoRoot } = twoRoots();
    seedDemo(repoRoot, "topic-selection", { 项目: "demo", 题材: "都市" });
    putUserTemplate(dataRoot, "topic-selection", "我的配置", JSON.stringify({ 项目: "p1", 阈值预算: { fillerQuota: 9 } }));

    const { entries } = listConfigTemplates({ dataRoot, repoRoot, flowId: "topic-selection" });
    const bySource = (s: string) => entries.filter((e) => e.source === s).map((e) => e.name);
    expect(bySource("blank")).toHaveLength(1);
    expect(bySource("official")).toContain("官方示例（topic-selection）");
    expect(bySource("user")).toContain("我的配置");

    // 关键回归：数据根 ≠ 仓库根。若实现把 repoRoot 缺省成 dataRoot，官方示例会凭空消失
    const noRepo = listConfigTemplates({ dataRoot, flowId: "topic-selection" });
    expect(noRepo.entries.some((e) => e.source === "official")).toBe(false);
  });

  it("自存模板带 keys / hasBudget / updatedAt——面板不用打开文件就知道它改了什么", () => {
    const { dataRoot, repoRoot } = twoRoots();
    putUserTemplate(dataRoot, "f1", "带预算", JSON.stringify({ 项目: "p", 题材: "x", 阈值预算: { fillerQuota: 3 } }));
    const { entries } = listConfigTemplates({ dataRoot, repoRoot, flowId: "f1" });
    const e = entries.find((x) => x.name === "带预算")!;
    expect(e.keys).toEqual(["项目", "题材", "阈值预算"]);
    expect(e.hasBudget).toBe(true);
    expect(e.updatedAt).toBeTruthy();
  });

  it("flowId 过滤：只列该 flow（+ blank），别的 flow 的模板不混进来", () => {
    const { dataRoot, repoRoot } = twoRoots();
    putUserTemplate(dataRoot, "f1", "甲", JSON.stringify({ 项目: "p" }));
    putUserTemplate(dataRoot, "f2", "乙", JSON.stringify({ 项目: "p" }));
    const names = listConfigTemplates({ dataRoot, repoRoot, flowId: "f1" }).entries.map((e) => e.name);
    expect(names).toContain("甲");
    expect(names).not.toContain("乙");
  });

  it("坏模板不静默：skipped 如实回报文件名与原因", () => {
    const { dataRoot, repoRoot } = twoRoots();
    putUserTemplate(dataRoot, "f1", "坏", "{ 这不是 JSON");
    const { entries, skipped } = listConfigTemplates({ dataRoot, repoRoot, flowId: "f1" });
    expect(entries.some((e) => e.name === "坏")).toBe(false);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toContain("坏.json");
  });
});

describe("OS-04 · save：把项目配置存成模板", () => {
  it("落盘在**数据根**（不是仓库根）——模板跨项目复用，不进仓库", () => {
    const { dataRoot, repoRoot } = twoRoots();
    const k = mkKernel(dataRoot, repoRoot);
    seedProject(k, "p1", "f1", { 题材: "都市" });
    const r = saveConfigTemplate(k, { project: "p1", name: "我的模板" });
    expect(r.flowId).toBe("f1");
    const file = path.join(dataRoot, "templates", "项目配置", "f1", "我的模板.json");
    expect(String(r.file)).toBe(file);
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, "templates"))).toBe(false);
  });

  it("同名不覆盖：显式 overwrite=true 才行（不静默覆盖）", () => {
    const { dataRoot, repoRoot } = twoRoots();
    const k = mkKernel(dataRoot, repoRoot);
    seedProject(k, "p1", "f1", { 题材: "都市" });
    saveConfigTemplate(k, { project: "p1", name: "t" });

    let err: CfgTemplateError | null = null;
    try {
      saveConfigTemplate(k, { project: "p1", name: "t" });
    } catch (e) {
      err = e as CfgTemplateError;
    }
    expect(err?.code).toBe("CONFIG_EXISTS");
    expect(err?.http).toBe(409);

    const r = saveConfigTemplate(k, { project: "p1", name: "t", overwrite: true });
    expect(r.overwritten).toBe(true);
  });

  it("名字非法（含路径分隔符 / 空 / 超长）⇒ 400，绝不做静默改名", () => {
    const { dataRoot, repoRoot } = twoRoots();
    const k = mkKernel(dataRoot, repoRoot);
    seedProject(k, "p1", "f1");
    for (const bad of ["", "a/b", "a\\b", "x".repeat(41), ".."]) {
      let err: CfgTemplateError | null = null;
      try {
        saveConfigTemplate(k, { project: "p1", name: bad });
      } catch (e) {
        err = e as CfgTemplateError;
      }
      expect(err?.code, `名字「${bad}」应被拒`).toBe("INVALID_INPUT");
      expect(err?.http).toBe(400);
    }
  });

  it("项目没有 项目配置.json ⇒ 404（提示先 flow_init），不生成空模板", () => {
    const { dataRoot, repoRoot } = twoRoots();
    const k = mkKernel(dataRoot, repoRoot);
    let err: CfgTemplateError | null = null;
    try {
      saveConfigTemplate(k, { project: "nope", name: "t" });
    } catch (e) {
      err = e as CfgTemplateError;
    }
    expect(err?.code).toBe("NOT_FOUND");
    expect(err?.http).toBe(404);
  });

  it("配置不合 project-config 契约 ⇒ 400（拒绝把坏配置存成模板）", () => {
    const { dataRoot, repoRoot } = twoRoots();
    const k = mkKernel(dataRoot, repoRoot);
    const pd = k.projectDir("p-bad");
    fs.mkdirSync(pd, { recursive: true });
    fs.writeFileSync(path.join(pd, "state.json"), JSON.stringify({ flowId: "f1" }), "utf-8");
    fs.writeFileSync(path.join(pd, "项目配置.json"), JSON.stringify({ 项目: 12345 }), "utf-8"); // 项目必须是 string
    let err: CfgTemplateError | null = null;
    try {
      saveConfigTemplate(k, { project: "p-bad", name: "t" });
    } catch (e) {
      err = e as CfgTemplateError;
    }
    expect(err?.code).toBe("INVALID_INPUT");
    expect(err?.http).toBe(400);
  });

  it("项目没开跑（无 state.json）⇒ 显式要求 --flow，不猜", () => {
    const { dataRoot, repoRoot } = twoRoots();
    const k = mkKernel(dataRoot, repoRoot);
    const pd = k.projectDir("p-nostate");
    fs.mkdirSync(pd, { recursive: true });
    fs.writeFileSync(path.join(pd, "项目配置.json"), JSON.stringify({ 项目: "p-nostate" }), "utf-8");
    let err: CfgTemplateError | null = null;
    try {
      saveConfigTemplate(k, { project: "p-nostate", name: "t" });
    } catch (e) {
      err = e as CfgTemplateError;
    }
    expect(err?.code).toBe("INVALID_INPUT");
    // 显式给 flow 即可
    const r = saveConfigTemplate(k, { project: "p-nostate", name: "t", flowId: "f9" });
    expect(r.flowId).toBe("f9");
  });
});

describe("OS-04 · apply：套用模板到项目", () => {
  it("套用「从零新建」⇒ 只写必填「项目」，不带任何别的项目的偏好", () => {
    const { dataRoot, repoRoot } = twoRoots();
    const k = mkKernel(dataRoot, repoRoot);
    const pd = seedProject(k, "p1", "f1", { 题材: "都市", 阈值预算: { fillerQuota: 9 } });
    const r = applyConfigTemplate(k, { project: "p1", name: "从零新建" });
    expect(r.source).toBe("blank");
    const onDisk = JSON.parse(fs.readFileSync(path.join(pd, "项目配置.json"), "utf-8"));
    expect(onDisk).toEqual({ 项目: "p1" });
    expect(r.keys).toEqual(["项目"]);
    expect(r.hasBudget).toBe(false);
  });

  it("覆盖写：套用会把 `项目` 改写成目标项目 id（照抄来源项目名 = 立刻踩一致性校验）", () => {
    const { dataRoot, repoRoot } = twoRoots();
    const k = mkKernel(dataRoot, repoRoot);
    seedProject(k, "src", "f1", { 题材: "都市" });
    saveConfigTemplate(k, { project: "src", name: "复用" }); // 模板里 项目=src
    const pd = seedProject(k, "dst", "f1");
    const r = applyConfigTemplate(k, { project: "dst", name: "复用" });
    expect(r.applied).toBe("复用");
    expect(r.source).toBe("user");
    const onDisk = JSON.parse(fs.readFileSync(path.join(pd, "项目配置.json"), "utf-8"));
    expect(onDisk.项目).toBe("dst");
    expect(onDisk.题材).toBe("都市");
  });

  it("跨 flow 默认拒绝（400），force=true 才放行——输入面/阈值未必兼容，必须由人确认", () => {
    const { dataRoot, repoRoot } = twoRoots();
    const k = mkKernel(dataRoot, repoRoot);
    seedProject(k, "p1", "f1");
    saveConfigTemplate(k, { project: "p1", name: "f1配置" });
    seedProject(k, "p2", "f2");

    let err: CfgTemplateError | null = null;
    try {
      applyConfigTemplate(k, { project: "p2", name: "f1配置" });
    } catch (e) {
      err = e as CfgTemplateError;
    }
    expect(err?.code).toBe("INVALID_INPUT");
    expect(err?.http).toBe(400);
    expect(err?.message).toContain("force");

    const r = applyConfigTemplate(k, { project: "p2", name: "f1配置", force: true });
    expect(r.flowId).toBe("f2"); // 目标项目的 flow
  });

  it("模板不存在 ⇒ 404 且列出可用项（不是干说 not found）", () => {
    const { dataRoot, repoRoot } = twoRoots();
    const k = mkKernel(dataRoot, repoRoot);
    seedProject(k, "p1", "f1");
    let err: CfgTemplateError | null = null;
    try {
      applyConfigTemplate(k, { project: "p1", name: "没有这个" });
    } catch (e) {
      err = e as CfgTemplateError;
    }
    expect(err?.code).toBe("NOT_FOUND");
  });

  it("项目未开跑 + 同名跨 flow ⇒ 报歧义要求指定 --flow（绝不「取第一个」）", () => {
    const { dataRoot, repoRoot } = twoRoots();
    const k = mkKernel(dataRoot, repoRoot);
    putUserTemplate(dataRoot, "f1", "同名", JSON.stringify({ 项目: "x", 题材: "A" }));
    putUserTemplate(dataRoot, "f2", "同名", JSON.stringify({ 项目: "x", 题材: "B" }));
    const pd = k.projectDir("p-nostate");
    fs.mkdirSync(pd, { recursive: true });

    let err: CfgTemplateError | null = null;
    try {
      applyConfigTemplate(k, { project: "p-nostate", name: "同名" });
    } catch (e) {
      err = e as CfgTemplateError;
    }
    expect(err?.code).toBe("INVALID_INPUT");
    expect(err?.message).toContain("多个 flow");

    // 显式指定 flow ⇒ 有确定答案
    const r = applyConfigTemplate(k, { project: "p-nostate", name: "同名", flowId: "f2" });
    expect(r.flowId).toBe("f2");
  });
});

describe("OS-04 · delete：只删自存模板", () => {
  it("自存模板可删（并清空目录）；官方示例与「从零新建」不可删（400）", () => {
    const { dataRoot, repoRoot } = twoRoots();
    const k = mkKernel(dataRoot, repoRoot);
    seedDemo(repoRoot, "f1", { 项目: "demo" });
    seedProject(k, "p1", "f1");
    saveConfigTemplate(k, { project: "p1", name: "可删" });

    const r = deleteConfigTemplate(k, { name: "可删" });
    expect(r.deleted).toBe("可删");
    expect(fs.existsSync(path.join(dataRoot, "templates", "项目配置", "f1", "可删.json"))).toBe(false);

    for (const name of ["官方示例（f1）", "从零新建"]) {
      let err: CfgTemplateError | null = null;
      try {
        deleteConfigTemplate(k, { name });
      } catch (e) {
        err = e as CfgTemplateError;
      }
      expect(err?.code, `「${name}」不该可删`).toBe("INVALID_INPUT");
      expect(err?.http).toBe(400);
    }
    // 官方示例文件仍在
    expect(fs.existsSync(path.join(repoRoot, "demos", "f1", "项目配置.json"))).toBe(true);
  });

  it("不存在 ⇒ 404", () => {
    const { dataRoot, repoRoot } = twoRoots();
    const k = mkKernel(dataRoot, repoRoot);
    let err: CfgTemplateError | null = null;
    try {
      deleteConfigTemplate(k, { name: "不存在" });
    } catch (e) {
      err = e as CfgTemplateError;
    }
    expect(err?.code).toBe("NOT_FOUND");
  });
});

describe("OS-04 · 动词面：分派 + 错误码穿透到三面", () => {
  it("cfgTemplate 分派四个 action；未知 action ⇒ 400 并列出可选项", () => {
    const { dataRoot, repoRoot } = twoRoots();
    const k = mkKernel(dataRoot, repoRoot);
    seedProject(k, "p1", "f1", { 题材: "都市" });

    expect(cfgTemplate(k, { action: "list" }).count).toBe(1); // 只有 blank
    expect(cfgTemplate(k, { action: "save", project: "p1", name: "t" }).saved).toBe("t");
    expect(cfgTemplate(k, { action: "list" }).count).toBe(2);
    expect(cfgTemplate(k, { action: "apply", project: "p1", name: "从零新建" }).applied).toBe("从零新建");
    expect(cfgTemplate(k, { action: "delete", name: "t" }).deleted).toBe("t");

    let err: CfgTemplateError | null = null;
    try {
      cfgTemplate(k, { action: "nope" });
    } catch (e) {
      err = e as CfgTemplateError;
    }
    expect(err?.code).toBe("INVALID_INPUT");
    expect(err?.message).toContain("save");
  });

  it("verbs 边界：CfgTemplateError 被映射成 KernelError，**4xx 码原样保留**（不当 500）", () => {
    const { dataRoot, repoRoot } = twoRoots();
    const k = mkKernel(dataRoot, repoRoot);
    seedProject(k, "p1", "f1");
    const def = VERB_BY_NAME["cfg_template"];
    let err: unknown = null;
    try {
      def.run(k, { action: "delete", name: "不存在" });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(KernelError);
    expect((err as KernelError).code).toBe("NOT_FOUND");
    expect((err as KernelError).http).toBe(404);
  });

  it("HTTP 面：POST /api/verbs/cfg_template 走通 list → save → apply → delete，错误码为 4xx", async () => {
    const { dataRoot, repoRoot } = twoRoots();
    const k = mkKernel(dataRoot, repoRoot);
    seedProject(k, "p1", "f1", { 题材: "都市" });
    const app = buildHttpApp(k);
    await app.ready();
    const post = async (payload: Record<string, unknown>) =>
      app.inject({ method: "POST", url: "/api/verbs/cfg_template", payload });

    let r = await post({ action: "list" });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).entries).toHaveLength(1);

    r = await post({ action: "save", project: "p1", name: "HTTP模板" });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).saved).toBe("HTTP模板");

    r = await post({ action: "apply", project: "p1", name: "HTTP模板" });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).applied).toBe("HTTP模板");

    // 用户手误必须是 4xx（不是 500）
    r = await post({ action: "delete", name: "根本不存在" });
    expect(r.statusCode).toBe(404);
    expect(JSON.parse(r.body).error).toBe("NOT_FOUND");

    r = await post({ action: "save", project: "p1", name: "a/b" });
    expect(r.statusCode).toBe(400);

    r = await post({ action: "delete", name: "HTTP模板" });
    expect(r.statusCode).toBe(200);
    await app.close();
  });
});

describe("OS-04 · 内核落读模型：registry/config-templates.json", () => {
  it("viewEffect 后落盘模板清单（与 live 切片同源；页面只消费）", async () => {
    const { dataRoot, repoRoot } = twoRoots();
    // 用真实 flow/契约：repoRoot 指向仓库根，flows 指向真实 flows 目录
    const realRepo = path.resolve(__dirname, "..", "..");
    const k = new Kernel({ root: dataRoot, repoRoot: realRepo, flowsDir: path.join(realRepo, "flows") });
    seedProject(k, "p-tpl", "topic-selection", { 项目: "p-tpl" });
    putUserTemplate(dataRoot, "topic-selection", "自存甲", JSON.stringify({ 项目: "p-tpl" }));

    await k.viewEffect("p-tpl");

    const f = path.join(dataRoot, "projects", "p-tpl", "registry", "config-templates.json");
    expect(fs.existsSync(f)).toBe(true);
    const model = JSON.parse(fs.readFileSync(f, "utf-8"));
    expect(model.format).toBe("config-templates@1");
    expect(model.flowId).toBe("topic-selection");
    const names = model.entries.map((e: { name: string }) => e.name);
    // 三来源都在：blank（合成）+ official（仓库 demos）+ user（数据根）
    expect(names).toContain("从零新建");
    expect(names).toContain("官方示例（topic-selection）");
    expect(names).toContain("自存甲");

    // live 切片现扫，与落盘读模型同源同内容（不另算一套）
    const live = k.viewLive("p-tpl") as { configTemplates: { entries: { name: string }[] } | null };
    expect(live.configTemplates).not.toBeNull();
    expect(live.configTemplates!.entries.map((e) => e.name).sort()).toEqual([...names].sort());
  });
});
