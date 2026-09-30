#!/usr/bin/env node
// miniflow CLI —— 内核动词由 `verbs.ts` 唯一声明；本文件只管「参数解析 + 进程面（up/serve/mcp）」。
// R8-OPS 步骤 3：此前本文件持有一份 13 动词的 switch（动词表的第 1 份副本）。现在**零动词清单**。
import process from "node:process";
import type { IProcessLauncher } from "./abstraction/proc.js";
import { Kernel, KernelError } from "./kernel.js";
import { ROOT } from "./schema.js";
import { VERB_BY_NAME, flagsToArgs, usageFromVerbs } from "./verbs.js";
import { nodeFs, nodePath } from "./abstraction/adapters/node.js";

type Args = Record<string, string | boolean>;

function parseArgs(argv: string[]): { _: string[]; flags: Args } {
  const _: string[] = [];
  const flags: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? "";
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const eq = key.indexOf("=");
      if (eq >= 0) flags[key.slice(0, eq)] = key.slice(eq + 1);
      else if (i + 1 < argv.length && !(argv[i + 1] ?? "").startsWith("--")) flags[key] = argv[++i] ?? "";
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
    usageFromVerbs(),
    "进程面（非内核动词）:",
    "  up            [--port <number>] [--open]        首次启动：内核 API + legacy 页面端点 + 静态页 **同进程单端口**",
    "                                                  （端口占用自动顺延；--open 顺带打开浏览器）",
    "  serve         [--port <number>]                 HTTP 面（REST + OpenAPI；与 up 同实现，保留兼容）",
    "  mcp                                             MCP 面（stdio；tools 由动词表派生）",
    "",
    "动词表唯一源：core/src/verbs.ts —— CLI / HTTP(POST /api/verbs/<verb>) / MCP 三面均由其派生。",
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
  const out = (v: unknown): number => {
    console.log(JSON.stringify(v, null, 2));
    return 0;
  };

  try {
    // ① 内核动词：一律查 `verbs.ts` 的表（含入参归一化；特殊旗标面由 def.fromFlags 提供）
    const def = VERB_BY_NAME[verb];
    if (def) {
      const args = def.fromFlags ? def.fromFlags(kernel, flags) : flagsToArgs(def, flags);
      return out(await def.run(kernel, args));
    }

    // ② 进程面：需要常驻进程，天然不属于「内核动词表」
    switch (verb) {
      case "up": {
        // 首次启动：一个进程同时提供 内核 API + legacy 页面端点 + 静态页面（R8-OPS server 合一）。
        // 端口被占用是"首次启动"最常见的卡点，且与用户无关 ⇒ 自动顺延，不让人去查端口。
        const { startHttp } = await import("./http.js");
        const want = Number(flags.port ?? 8421);
        const chosen = await pickFreePort(want, want + 20);
        if (chosen === null) {
          console.error(`端口 ${want}–${want + 20} 全被占用；用 --port <n> 指定其他端口`);
          return 1;
        }
        if (chosen !== want) console.error(`[up] 端口 ${want} 被占用，已顺延到 ${chosen}`);
        if (!kernel.fs.exists(kernel.path.join(kernel.root, "index.html"))) {
          console.error("[up] 警告：入口页 index.html 不存在——页面需先由生成器产出（tools/project-pages.py）。");
        }
        if (flags.open) openBrowser(kernel.proc, `http://127.0.0.1:${chosen}/`);
        await startHttp(kernel, chosen);
        return 0; // up 常驻
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
    console.error(JSON.stringify({ error: "INTERNAL", message: e instanceof Error ? e.message : String(e) }, null, 2));
    return 1;
  }
}

/** 从 from 到 to 找第一个可监听端口（127.0.0.1）；全占则 null。 */
async function pickFreePort(from: number, to: number): Promise<number | null> {
  const net = await import("node:net");
  for (let p = from; p <= to; p++) {
    const free = await new Promise<boolean>((resolve) => {
      const srv = net.createServer();
      srv.once("error", () => resolve(false));
      srv.once("listening", () => srv.close(() => resolve(true)));
      srv.listen(p, "127.0.0.1");
    });
    if (free) return p;
  }
  return null;
}

/**
 * 打开浏览器（仅 `up --open` 时调用）；失败不影响服务本身。
 * 选哪条命令是宿主平台知识（留在本入口件里），「分离启动」这个动作本身走注入的 proc——
 * 抽象层新增 `detach` 形态的普查依据见规范 §3.1。
 */
function openBrowser(proc: IProcessLauncher, url: string): void {
  const [cmd, args] =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", "", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  try {
    proc.detach(cmd, args);
  } catch {
    /* 打开失败不是错误：把 URL 打出来即可 */
    console.error(`[up] 无法自动打开浏览器，请手动访问 ${url}`);
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
    if (!nodeFs.exists(nodePath.join(ROOT, "BETA"))) return;
    const { _, flags } = parseArgs(process.argv.slice(2));
    const rec = {
      ts: new Date().toISOString(),
      verb: _[0] ?? "?",
      argv: process.argv.slice(2),
      project: typeof flags.project === "string" ? flags.project : null,
      exit: code,
      ms: Date.now() - T0,
    };
    const dir = nodePath.join(ROOT, "trace");
    nodeFs.mkdir(dir, { recursive: true });
    nodeFs.appendText(nodePath.join(dir, "cli.jsonl"), JSON.stringify(rec) + "\n");
  } catch {
    /* 旁路 */
  }
});
