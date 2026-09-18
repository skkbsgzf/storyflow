#!/usr/bin/env node
// miniflow CLI —— 七动词 + serve/mcp（与 MCP/HTTP 共享同一内核）
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { Kernel, KernelError } from "./kernel.js";
import { ROOT } from "./schema.js";
import { skillPatch } from "./skills.js";

type Args = Record<string, string | boolean>;

function parseArgs(argv: string[]): { _: string[]; flags: Args } {
  const _: string[] = [];
  const flags: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const eq = key.indexOf("=");
      if (eq >= 0) flags[key.slice(0, eq)] = key.slice(eq + 1);
      else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) flags[key] = argv[++i];
      else flags[key] = true;
    } else {
      _.push(a);
    }
  }
  return { _, flags };
}

function usage(): string {
  return [
    "miniflow <verb> [options]",
    "",
    "动词（七动词）:",
    "  flow_list                                          列出 flows",
    "  flow_run    --flow <id> --project <id> [--k=v ...] [--config <path>]  开跑（自动装载 项目配置.json，自动迁移 run-state.json）",
    "  flow_init   --project <id>                          生成项目初始化配置模板（项目配置.json）",
    "  flow_next   --project <id> [--spawn-prompt]         推进到下一停靠点（--spawn-prompt 附带派发头）",
    "  flow_submit --project <id> --node <id> [--file <rel>|--content-file <path>] [--seal]",
    "              （iterate 节点：逐实例提交保持 awaiting，--seal 收口置 done）",
    "  flow_resume --project <id>                          崩溃/失败恢复",
    "  flow_gate   --project <id> --node <id> --verdict <pass|pass-with-conditions|send-back|reject>",
    "              [--comment <s>] [--root-cause-stage <id>] [--round <n>] [--token <t>]",
    "  flow_rerun  --project <id> --node <id> [--dry-run]",
    "",
    "动词（R5 生成式编排）:",
    "  flow_effect   --project <id>                        生效编排 + 指标汇总（tool 效率/上下文命中率）",
    "  flow_optimize --project <id> [--apply] [--actor s]  由指标产出编排调优提案；--apply 落 overlay（低风险自动，其余待批）",
    "  flow_mine     --project <id>                      组装编排挖掘包（journal/指标/中间文件），交编排挖掘师产出 findings@1 → flow_optimize 自动并入",
    "  skill_patch   --target <skill> --text <s> --reason <s> [--section <s>] [--op append|replace] [--origin user|miner|agent]",
    "                    提示词补丁（W-05）：默认 proposed 不生效；--approve <id> 批准装载 / --reject <id> 驳回 / --list [--target <skill>]",
    "  flow_overlay  --project <id> [--patches <file.json>] [--approve <id,...>] [--reason s] [--replan]",
    "                                                      改写运行时编排（tool 的位置与内容配置）；--replan 立即重编译计划",
    "",
    "脸:",
    "  serve --port 8421                                   HTTP 面（REST + OpenAPI）",
    "  mcp                                                 MCP 面（stdio）",
  ].join("\n");
}

async function main(): Promise<number> {
  const { _, flags } = parseArgs(process.argv.slice(2));
  const verb = _[0];
  if (!verb || flags.help || flags.h) {
    console.log(usage());
    return 0;
  }
  // --root <path>：把内核指向任意工作区根（验证层 dist/release-* 重拍用；缺省=本仓库）
  const kernel = flags.root
    ? new Kernel({ root: String(flags.root), repoRoot: String(flags.root) })
    : new Kernel();
  const projectId = String(flags.project ?? "");
  const out = (v: unknown) => {
    console.log(JSON.stringify(v, null, 2));
    return 0;
  };

  try {
    switch (verb) {
      case "flow_list":
        return out(kernel.flow_list());
      case "flow_run": {
        const inputs: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(flags)) {
          if (!["flow", "project", "config"].includes(k) && typeof v === "string") inputs[k] = v;
        }
        const projectDir = kernel.projectDir(String(flags.project));
        if (flags.config) {
          // 显式指定的初始化配置 → 落位为 项目配置.json（内核 flow_run 自动装载）
          fs.mkdirSync(projectDir, { recursive: true });
          fs.copyFileSync(String(flags.config), path.join(projectDir, "项目配置.json"));
        }
        return out(await kernel.flow_run(String(flags.flow), String(flags.project), inputs));
      }
      case "flow_init": {
        // 初始化配置模板：用户填 题材/需求/灵感/严肃性/风格/AB测试/市场预估 后再 flow_run
        const projectDir = kernel.projectDir(String(flags.project));
        fs.mkdirSync(projectDir, { recursive: true });
        const file = path.join(projectDir, "项目配置.json");
        if (fs.existsSync(file)) return out({ exists: true, file });
        const template = {
          项目: String(flags.project),
          题材: "",
          需求: "",
          灵感: "",
          严肃性: "标准",
          风格: "爽",
          AB测试: false,
          市场预估: "",
          presets: {},
        };
        fs.writeFileSync(file, JSON.stringify(template, null, 2) + "\n", "utf-8");
        return out({ created: file, hint: "填写后 flow_run 自动装载；显式入参 > 配置 > flow 默认" });
      }
      case "flow_next":
        return out(
          await kernel.flow_next(projectId, {
            spawnPrompt: flags["spawn-prompt"] === true || flags["spawn-prompt"] === "true",
          }),
        );
      case "flow_submit": {
        let content: string | undefined;
        if (flags["content-file"]) content = fs.readFileSync(String(flags["content-file"]), "utf-8");
        return out(
          await kernel.flow_submit(projectId, String(flags.node), {
            content,
            file: flags.file ? String(flags.file) : undefined,
            seal: flags.seal === true,
          }),
        );
      }
      case "flow_resume":
        return out(await kernel.flow_resume(projectId));
      case "flow_gate":
        return out(
          await kernel.flow_gate(projectId, {
            nodeId: String(flags.node),
            verdict: String(flags.verdict) as "pass" | "pass-with-conditions" | "send-back" | "reject",
            comment: flags.comment ? String(flags.comment) : undefined,
            rootCauseStage: flags["root-cause-stage"] ? String(flags["root-cause-stage"]) : undefined,
            round: flags.round !== undefined ? Number(flags.round) : undefined,
            token: flags.token ? String(flags.token) : undefined,
          }),
        );
      case "flow_rerun":
        return out(
          await kernel.flow_rerun(projectId, {
            nodeId: String(flags.node),
            dryRun: flags["dry-run"] === true || flags["dry-run"] === "true",
          }),
        );
      case "flow_effect":
        return out(kernel.viewEffect(projectId));
      case "flow_mine":
        return out(kernel.flowMine(projectId));
      case "skill_patch":
        return out(
          skillPatch(ROOT, (() => {
            if (flags.approve) return { action: "approve", id: String(flags.approve) };
            if (flags.reject) return { action: "reject", id: String(flags.reject) };
            if (flags.list) return { action: "list", target: flags.target ? String(flags.target) : undefined };
            return {
              action: "add",
              target: String(flags.target),
              text: String(flags.text),
              reason: String(flags.reason),
              section: flags.section ? String(flags.section) : undefined,
              op: flags.op ? (String(flags.op) as "append" | "replace") : undefined,
              origin: flags.origin ? (String(flags.origin) as "user" | "miner" | "agent") : undefined,
            };
          })()),
        );
      case "flow_optimize":
        return out(
          kernel.flowOptimize(projectId, {
            apply: flags.apply === true || flags.apply === "true",
            actor: flags.actor ? String(flags.actor) : undefined,
          }),
        );
      case "flow_overlay": {
        const patches = flags.patches
          ? (JSON.parse(fs.readFileSync(String(flags.patches), "utf-8")).patches ??
             JSON.parse(fs.readFileSync(String(flags.patches), "utf-8")))
          : undefined;
        return out(
          await kernel.flowOverlay(projectId, {
            patches,
            approve: flags.approve ? String(flags.approve).split(",").map((s) => s.trim()).filter(Boolean) : undefined,
            actor: flags.actor ? String(flags.actor) : undefined,
            reason: flags.reason ? String(flags.reason) : undefined,
            replan: flags.replan === true || flags.replan === "true",
          }),
        );
      }
      case "serve": {
        const { startHttp } = await import("./http.js");
        await startHttp(kernel, Number(flags.port ?? 8421));
        return 0; // serve 常驻
      }
      case "mcp": {
        const { startMcp } = await import("./mcp.js");
        await startMcp(kernel);
        return 0;
      }
      default:
        console.error(`未知动词: ${verb}\n${usage()}`);
        return 2;
    }
  } catch (e) {
    if (e instanceof KernelError) {
      console.error(JSON.stringify({ error: e.code, http: e.http, message: e.message }, null, 2));
      return 1;
    }
    console.error(JSON.stringify({ error: "INTERNAL", message: (e as Error).message }, null, 2));
    return 1;
  }
}

/**
 * beta 期 tool 调用留痕：repo 根存在 BETA 标记时，每次 CLI 调用追加一条到 <root>/trace/cli.jsonl。
 * 这是思维链存档（cot-capture）的机器侧信号——调用参数、退出码、耗时只有这里看得见。
 * 留痕是旁路：任何失败静默，绝不影响主流程；beta 结束删 BETA 即全链停止。
 */
const T0 = Date.now();
main().then((code) => {
  process.exitCode = code;
  try {
    if (!fs.existsSync(path.join(ROOT, "BETA"))) return;
    const { _, flags } = parseArgs(process.argv.slice(2));
    const rec = {
      ts: new Date().toISOString(),
      verb: _[0] ?? "?",
      argv: process.argv.slice(2),
      project: typeof flags.project === "string" ? flags.project : null,
      exit: code,
      ms: Date.now() - T0,
    };
    const dir = path.join(ROOT, "trace");
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, "cli.jsonl"), JSON.stringify(rec) + "\n");
  } catch {
    /* 旁路 */
  }
});
