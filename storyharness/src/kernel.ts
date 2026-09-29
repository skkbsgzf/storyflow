// 内核 HTTP 面客户端 + 工作区/语料持有者：编排事实的唯一通道（R5 编排单源——harness 不重算任何编排）。
// 底座不硬编码语料路径：workspaceRoot + corpus 布局由 config 注入，随 KernelClient 下发给全链路。
import { execFile } from "node:child_process";
import * as fs from "node:fs";
import path from "node:path";
import type { CorpusLayout } from "./config.js";

export interface TaskPackageIO {
  outputContract?: { file?: string };
  output?: { file?: string };
  spawnPrompt?: string;
  instructions?: string;
  [k: string]: unknown;
}

export interface NextNode {
  nodeId: string;
  taskPackage?: TaskPackageIO;
  parallelWith?: string[];
  spawnPrompt?: string;
}

export interface NextResult {
  status: string;
  nodeId?: string;
  taskPackage?: TaskPackageIO;
  batch?: NextNode[];
  gate?: { nodeId?: string; verdict?: string };
  [k: string]: unknown;
}

export class KernelClient {
  constructor(
    readonly base: string,
    readonly workspaceRoot: string,
    readonly corpus: CorpusLayout,
  ) {}

  async verb<T = unknown>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    const r = await fetch(`${this.base}/api/verbs/${name}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(args),
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`内核动词 ${name} → HTTP ${r.status}: ${text.slice(0, 300)}`);
    // whereami 等桥接动词返回人读文本（非 JSON）——容错回退为原始字符串，工具层 text() 自会包裹
    try { return JSON.parse(text) as T; } catch { return text as unknown as T; }
  }

  flowNext(project: string) {
    return this.verb<NextResult>("flow_next", { project });
  }

  flowList() {
    return this.verb("flow_list", {});
  }

  flowInit(project: string) {
    return this.verb("flow_init", { project });
  }

  flowRun(flow: string, project: string, inputs: Record<string, unknown>) {
    return this.verb("flow_run", { flow, project, inputs });
  }

  flowResume(project: string) {
    return this.verb("flow_resume", { project });
  }

  flowSubmit(project: string, node: string, opts: { file?: string; content?: string; notes?: string; seal?: boolean }) {
    return this.verb("flow_submit", { project, node, ...opts });
  }

  flowEffect(project: string) {
    return this.verb("flow_effect", { project });
  }

  whereami(project: string) {
    return this.verb("whereami", { project });
  }

  worldbookSearch(project: string, q: string, cat?: string, k?: number) {
    return this.verb("worldbook_search", { project, q, cat, k });
  }

  qualityScan(project: string) {
    return this.verb("quality_scan", { project });
  }

  listDecisions(project: string) {
    return this.verb("list_decisions", { project });
  }

  /** KB 检索（内核只读动词，方法论事实源 = 语料仓 knowledge/） */
  kbSearch(q: string, dir?: string, k?: number) {
    return this.verb("kb_search", { q, dir, k });
  }

  kbRead(ref: string, maxChars?: number) {
    return this.verb("kb_read", maxChars ? { ref, max_chars: maxChars } : { ref });
  }

  /** 语料侧 flow-lint：命令与脚本路径均来自注入的 corpus 布局，底座不认死 v4。 */
  flowLint(flow?: string): Promise<string> {
    const script = path.join(this.workspaceRoot, this.corpus.lintTool);
    const args = [script, ...(flow ? [flow] : []), "--json"];
    return new Promise((resolve) => {
      execFile(this.corpus.lintCommand, args, { cwd: this.workspaceRoot, timeout: 90_000, maxBuffer: 4 << 20 }, (err, stdout, stderr) => {
        if (err && !stdout) resolve(`flow-lint 执行失败: ${err.message}\n${String(stderr).slice(0, 2000)}`);
        else resolve(String(stdout).slice(0, 16_000) || `exit=${err?.code ?? 0}`);
      });
    });
  }

  /** S5 · 包挂载表注入（serve 装完 packs 后给；不注入＝纯算式，CLI/headless 行为零变化）。
   *  底座不 import 挂载表的实现，只拿这两个函数——项目在哪，全仓只有一处答案。 */
  packDirs?: { lookup: (project: string) => string | null; land: (project: string) => string };

  /** 项目内容根：工作区在档优先，其次回落包内模板项目（`packs/<包>/templates/<id>`）。
   *  病灶实证：包化后模板项目不在 projects/ 下，面侧一切按工作区路径算 → 列表空 + NO_PROJECT 404，
   *  「包内项目选得中却打不开」。解析必须单点，不许包侧/面侧各判一套。 */
  projectDir(project: string): string {
    const primary = path.join(this.workspaceRoot, this.corpus.projectsDir, project);
    if (!fs.existsSync(primary) && this.packDirs) return this.packDirs.lookup(project) ?? primary;
    return primary;
  }

  /** S5 · 首写落地：模板项目要写盘（建会话/发消息/改名/归档/分叉/传附件/fs_write）时，
   *  先把整目录复制进工作区，返回可写路径——包内容物保持只读，读写两轴此后同源。 */
  materializeProject(project: string): string {
    const primary = path.join(this.workspaceRoot, this.corpus.projectsDir, project);
    if (fs.existsSync(primary)) return primary;
    if (!this.packDirs) return primary;
    return this.packDirs.land(project);
  }
}
