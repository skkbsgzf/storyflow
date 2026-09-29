// 工具环：项目文件系统（越界拒绝）+ miniflow 动词（HTTP 直连）+ flow-lint。
// 形状 = pi-agent-core AgentTool（TypeBox schema）。
import * as fs from "node:fs";
import path from "node:path";
import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { KernelClient } from "./kernel.js";

const IGNORE = new Set(["node_modules", ".git", "snapshots"]);
const CAP = 16_000;

function withinProject(kernel: KernelClient, project: string, rel: string): string {
  const abs = path.resolve(kernel.projectDir(project), rel);
  const root = path.resolve(kernel.projectDir(project));
  if (!abs.startsWith(root + path.sep) && abs !== root) throw new Error(`路径越出项目：${rel}`);
  return abs;
}

function text(t: string): { content: [{ type: "text"; text: string }]; details: undefined } {
  const trimmed = t.length > CAP ? t.slice(0, CAP) + `\n…(截断，全长 ${t.length})` : t;
  return { content: [{ type: "text", text: trimmed }], details: undefined };
}

export function buildTools(kernel: KernelClient, project: string, opts: { lifecycle?: boolean } = {}): AgentTool<any>[] {
  const dir = kernel.projectDir(project);
  const tools: AgentTool<any>[] = [
    {
      name: "fs_tree",
      label: "项目目录树",
      description: "列出项目目录树（两层，含文件大小）——先感知再动手",
      parameters: Type.Object({}),
      execute: async () => {
        const lines: string[] = [];
        const walk = (d: string, depth: number) => {
          if (depth > 2) return;
          let items: string[] = [];
          try { items = fs.readdirSync(d).filter((x) => !IGNORE.has(x) && !x.startsWith(".")); } catch { return; }
          for (const it of items.sort()) {
            const abs = path.join(d, it);
            if (fs.statSync(abs).isDirectory()) {
              lines.push(`${"  ".repeat(depth)}${it}/ (${fs.readdirSync(abs).length})`);
              walk(abs, depth + 1);
            } else {
              lines.push(`${"  ".repeat(depth)}${it} (${Math.round(fs.statSync(abs).size / 1024)}KB)`);
            }
          }
        };
        walk(dir, 0);
        return text(lines.join("\n") || "(空项目)");
      },
    },
    {
      name: "fs_read",
      label: "读项目文件",
      description: "读项目内文件（相对路径，越界拒绝）——输入素材/前文/世界书都在盘上",
      parameters: Type.Object({ path: Type.String({ description: "项目内相对路径" }) }),
      execute: async (_id: string, args: any) => {
        const abs = withinProject(kernel, project, String(args.path));
        const t = fs.readFileSync(abs, "utf-8");
        return text(t);
      },
    },
    {
      name: "fs_write",
      label: "写项目文件",
      description: "写项目内文件——产物按任务包输出契约路径落盘（这是交卷的唯一方式）",
      parameters: Type.Object({ path: Type.String(), content: Type.String() }),
      execute: async (_id: string, args: any) => {
        const abs = withinProject(kernel, project, String(args.path));
        const content = String(args.content ?? "");
        if (content.length > 512_000) throw new Error("内容超 500KB，拒绝一次写入");
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content, "utf-8");
        return text(`已写入 ${args.path}（${content.length} 字符）`);
      },
    },
    {
      name: "fs_grep",
      label: "搜索项目文件",
      description: "正则搜索项目文本文件（跳过 snapshots/ 与二进制）",
      parameters: Type.Object({ pattern: Type.String() }),
      execute: async (_id: string, args: any) => {
        const re = new RegExp(String(args.pattern));
        const hits: string[] = [];
        const walk = (d: string) => {
          if (hits.length >= 60) return;
          for (const it of fs.readdirSync(d).sort()) {
            if (hits.length >= 60) return;
            if (IGNORE.has(it) || it.startsWith(".")) continue;
            const abs = path.join(d, it);
            const st = fs.statSync(abs);
            if (st.isDirectory()) { walk(abs); continue; }
            if (st.size > 400_000) continue;
            try {
              fs.readFileSync(abs, "utf-8").split("\n").forEach((line, idx) => {
                if (hits.length < 60 && re.test(line)) hits.push(`${path.relative(dir, abs)}:${idx + 1}: ${line.trim().slice(0, 160)}`);
              });
            } catch { /* 二进制跳过 */ }
          }
        };
        walk(dir);
        return text(hits.join("\n") || "(无命中)");
      },
    },
    {
      name: "mf_worldbook_search",
      label: "世界书 GraphHyperRAG 检索",
      description: "创作前查设定口径（人物/势力/地理/规则）——命中 + 一跳关系扩展",
      parameters: Type.Object({
        q: Type.String({ description: "查询词" }),
        cat: Type.Optional(Type.String({ description: "限定分类（人物/设定/势力…）" })),
        k: Type.Optional(Type.Number({ description: "条数上限，默认 6" })),
      }),
      execute: async (_id: string, args: any) => text(JSON.stringify(await kernel.worldbookSearch(project, String(args.q), args.cat, args.k), null, 1)),
    },
    {
      name: "mf_whereami",
      label: "项目位置感知",
      description: "当前项目/节点/必读输入/应产输出",
      parameters: Type.Object({}),
      execute: async () => text(JSON.stringify(await kernel.whereami(project), null, 1)),
    },
    {
      name: "mf_list_decisions",
      label: "决策事实",
      description: "读项目全部决策（这一步凭什么这么选）",
      parameters: Type.Object({}),
      execute: async () => text(JSON.stringify(await kernel.listDecisions(project), null, 1)),
    },
    {
      name: "mf_quality_scan",
      label: "质量扫描",
      description: "跑全量扫描器出证据（JSON findings 收据）",
      parameters: Type.Object({}),
      execute: async () => text(JSON.stringify(await kernel.qualityScan(project), null, 1)),
    },
    {
      name: "flow_lint",
      label: "flow 守门",
      description: "跑 flow-lint（改过 flows/*/flow.json 后必跑）",
      parameters: Type.Object({ flow: Type.Optional(Type.String()) }),
      execute: async (_id: string, args: any) => text(await kernel.flowLint(args.flow ? String(args.flow) : undefined)),
    },
    {
      name: "mf_kb_search",
      label: "知识库检索",
      description: "检索语料仓 knowledge/（方法论/规则/工艺卡）——写前找尺子",
      parameters: Type.Object({
        q: Type.String({ description: "查询词" }),
        dir: Type.Optional(Type.String({ description: "限定目录（如 craft/rules）" })),
        k: Type.Optional(Type.Number({ description: "条数上限" })),
      }),
      execute: async (_id: string, args: any) => text(JSON.stringify(await kernel.kbSearch(String(args.q), args.dir, args.k), null, 1)),
    },
    {
      name: "mf_kb_read",
      label: "知识卡读取",
      description: "按 ref 读知识卡全文（配合 mf_kb_search 用）",
      parameters: Type.Object({
        ref: Type.String({ description: "知识卡 ref（kb_search 返回）" }),
        max_chars: Type.Optional(Type.Number({ description: "截断上限" })),
      }),
      execute: async (_id: string, args: any) => text(JSON.stringify(await kernel.kbRead(String(args.ref), args.max_chars ? Number(args.max_chars) : undefined), null, 1)),
    },
  ];
  // 只读盘面两件：所有权限档通用（计划模式也要能看盘面）
  tools.push(
    {
      name: "mf_flow_list",
      label: "流程清单",
      description: "列出工作区全部 flow（立项前先看有什么流程可跑）",
      parameters: Type.Object({}),
      execute: async () => text(JSON.stringify(await kernel.flowList(), null, 1)),
    },
    {
      name: "mf_flow_next",
      label: "盘面推进视图",
      description: "看下一个待办节点/任务包（只读，不推进）",
      parameters: Type.Object({ project: Type.String() }),
      execute: async (_id: string, args: any) => text(JSON.stringify(await kernel.flowNext(String(args.project)), null, 1)),
    },
  );
  if (opts.lifecycle) {
    // flow 生命周期变更动词（只进对话环；执行器保持「写完由 executor 确定性交卷」护栏）。
    // 护栏：flow_gate / set_decision 不入环（铁律 6 门裁决归人）；submit 照走内核完整性闸，拒因原样回带。
    tools.push(
      {
        name: "mf_flow_init",
        label: "项目初始化",
        description: "生成项目配置骨架（项目配置.json）——立项第一步",
        parameters: Type.Object({ project: Type.String({ description: "项目 id（p-xxx）" }) }),
        execute: async (_id: string, args: any) => text(JSON.stringify(await kernel.flowInit(String(args.project)), null, 1)),
      },
      {
        name: "mf_flow_run",
        label: "开跑流程",
        description: "绑定 flow 并开跑，生成 state.json（type=enum 的输入必须显式给值，缺了内核会抛「选择未决」）",
        parameters: Type.Object({
          flow: Type.String(),
          project: Type.String(),
          inputs: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
        }),
        execute: async (_id: string, args: any) => text(JSON.stringify(await kernel.flowRun(String(args.flow), String(args.project), (args.inputs ?? {}) as Record<string, unknown>), null, 1)),
      },
      {
        name: "mf_flow_submit",
        label: "交卷",
        description: "产物落盘后交卷（内核完整性闸校验头部/非空/残渣，被拒会带拒因回来——按拒因修了再交）",
        parameters: Type.Object({
          project: Type.String(),
          node: Type.String(),
          file: Type.Optional(Type.String({ description: "项目内相对路径（与 content 二择一）" })),
          content: Type.Optional(Type.String()),
          notes: Type.Optional(Type.String()),
          seal: Type.Optional(Type.Boolean({ description: "iterate 节点末实例收口" })),
        }),
        execute: async (_id: string, args: any) => text(JSON.stringify(await kernel.flowSubmit(String(args.project), String(args.node), {
          ...(args.file ? { file: String(args.file) } : {}),
          ...(args.content ? { content: String(args.content) } : {}),
          ...(args.notes ? { notes: String(args.notes) } : {}),
          ...(args.seal ? { seal: true } : {}),
        }), null, 1)),
      },
      {
        name: "mf_flow_resume",
        label: "恢复运行",
        description: "中断/崩溃后恢复 run（沿用快照内计划）",
        parameters: Type.Object({ project: Type.String() }),
        execute: async (_id: string, args: any) => text(JSON.stringify(await kernel.flowResume(String(args.project)), null, 1)),
      },
    );
  }
  return tools;
}
