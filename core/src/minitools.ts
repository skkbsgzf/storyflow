import fs from "node:fs";
import path from "node:path";
import type { FlowDescriptor, RunState, Validation } from "./types.js";
import { ROOT } from "./schema.js";
import { makeArtifact, inputFingerprint, listArtifacts } from "./registry.js";
import { runIntegrityAsserts, runDeclaredAsserts, blocked, dedupeValidations } from "./asserts.js";
import { runAestheticAsserts } from "./aesthetic.js";
import { journalAppend } from "./journal.js";

export interface CoreResult {
  ok: boolean;
  artifacts: string[];
  kind?: "missing" | "assert";
  reason?: string;
  problems?: Validation[];
}

/** 展开节点 loads（"kb/market/constraints"、"kb/benchmark/*"）→ 知识文件绝对路径列表。 */
function resolveLoads(loads: string | string[] | undefined): string[] {
  if (!loads) return [];
  const items = Array.isArray(loads) ? loads : [loads];
  const out: string[] = [];
  for (const item of items) {
    const rel = item.replace(/^kb\//, "").replace(/\/\*$/, "");
    const base = path.join(ROOT, "knowledge", rel);
    if (item.endsWith("/*") && fs.existsSync(base) && fs.statSync(base).isDirectory()) {
      for (const f of fs.readdirSync(base).sort()) {
        if (fs.statSync(path.join(base, f)).isFile()) out.push(path.join(base, f));
      }
    } else if (fs.existsSync(base) && fs.statSync(base).isFile()) {
      out.push(base);
    } else if (fs.existsSync(base + ".md")) {
      out.push(base + ".md");
    } else if (fs.existsSync(path.join(ROOT, item))) {
      out.push(path.join(ROOT, item));
    }
  }
  return out;
}

/**
 * core 步（零 token，内核进程内执行）。
 * M1 实现：kb_load（内建）；check_* 走 integrity 模式（美学断言 M2 接入）；
 * 其余 minitool 返回类型化 missing（不静默放行）。
 */
export async function runCoreNode(
  projectDir: string,
  flow: FlowDescriptor,
  state: RunState,
  nodeId: string,
): Promise<CoreResult> {
  const node = flow.graph.nodes[nodeId];
  const tool = node.minitool ?? "";
  const artifacts: string[] = [];

  if (tool === "kb_load") {
    const files = resolveLoads(node.loads);
    if (files.length === 0) {
      return { ok: false, artifacts, kind: "assert", reason: `kb_load 无匹配知识文件: ${JSON.stringify(node.loads)}` };
    }
    let combined = `# KB 装载 · ${nodeId}（${node.title ?? ""}）\n\n> 由 miniflow kernel kb_load 内建装载，来源 ${files.length} 个知识文件。\n`;
    for (const f of files) {
      const rel = path.relative(ROOT, f).replaceAll("\\", "/");
      combined += `\n\n---\n\n<!-- source: ${rel} -->\n\n` + fs.readFileSync(f, "utf-8");
    }
    const outRel = path.join("内部", `kb-${nodeId}.md`).replaceAll("\\", "/");
    fs.mkdirSync(path.join(projectDir, "内部"), { recursive: true });
    fs.writeFileSync(path.join(projectDir, outRel), combined, "utf-8");
    makeArtifact(projectDir, { path: outRel, node: nodeId, producer: "minitool:kb_load", inputs: {} });
    artifacts.push(outRel);
    return { ok: true, artifacts };
  }

  if (tool.startsWith("check_")) {
    // check_aesthetic_asserts 走美学断言表（机器可查维度）；其余 check_* 保持 integrity 模式
    const aesthetic = tool === "check_aesthetic_asserts";
    const upstream = flow.graph.edges
      .filter((e) => e.to === nodeId && !e.loop)
      .map((e) => e.from);
    // R5 §四：节点声明的 asserts 是契约——必须真跑。以前这里只有引擎全量，声明是空转的。
    const declared = nodeAsserts(node);
    const results: Validation[] = [];
    const checked: string[] = [];
    const contract: { rel: string; declared: number; checked: string[]; unverified: string[] }[] = [];
    for (const up of upstream) {
      for (const rel of artifactPathsOf(flow, up, projectDir)) {
        const abs = path.join(projectDir, rel);
        if (!fs.existsSync(abs)) continue;
        checked.push(rel);
        results.push(...runIntegrityAsserts(projectDir, rel));
        if (aesthetic) {
          // 引擎全量照跑（不因声明收窄而丢掉引擎自己发现的 block）
          const engine = runAestheticAsserts(projectDir, rel);
          results.push(...engine);
          // 声明契约：本次产物有没有真守住它声明的那几条
          const d = runDeclaredAsserts(projectDir, rel, declared, engine);
          results.push(...d.results);
          contract.push({ rel, declared: declared.length, checked: d.checked, unverified: d.unverified });
        }
      }
    }
    const reportRel = path.join("内部", `断言报告-${nodeId}.json`).replaceAll("\\", "/");
    fs.mkdirSync(path.join(projectDir, "内部"), { recursive: true });
    const unverified = [...new Set(contract.flatMap((c) => c.unverified))];
    // 引擎全量与声明派发会覆盖同一 id：去重后再落报告与判 block
    const finalResults = dedupeValidations(results);
    const report = {
      mode: aesthetic ? "aesthetic" : "integrity",
      node: nodeId,
      minitool: tool,
      checked,
      results: finalResults,
      ...(aesthetic
        ? {
            declared,
            contract,
            summary: {
              declared: declared.length,
              machineChecked: [...new Set(contract.flatMap((c) => c.checked))].length,
              unverified: unverified.length,
              block: finalResults.filter((r) => r.status === "block").length,
            },
          }
        : {}),
      note: aesthetic
        ? `check_aesthetic_asserts：引擎机器可查维度全量 + 节点声明断言逐条裁（${declared.length} 条声明，${unverified.length} 条无机器校验器→归评审/红方剖面，未执行且不冒充通过）`
        : "integrity 模式（存在性/残渣/计数一致性）",
    };
    fs.writeFileSync(path.join(projectDir, reportRel), JSON.stringify(report, null, 2) + "\n", "utf-8");
    makeArtifact(projectDir, {
      path: reportRel,
      node: nodeId,
      producer: `minitool:${tool}`,
      inputs: inputFingerprint(projectDir, checked), // 记录被检产物指纹——rerun 缓存命中判定依据
    });
    artifacts.push(reportRel);
    if (unverified.length) {
      // 声明了却无人能验——写进 journal，让「这条契约是空的」在运行记录里留痕（不静默）
      journalAppend(projectDir, state.runId, "warn", {
        nodeId,
        detail: `声明断言无机器校验器（未执行，归评审/红方剖面）：${unverified.join("、")}`,
        refs: [reportRel],
      });
    }
    const blocks = blocked(finalResults);
    if (blocks.length) {
      return { ok: false, artifacts, kind: "assert", reason: `${tool} block ${blocks.length} 项`, problems: blocks };
    }
    return { ok: true, artifacts };
  }

  if (tool === "render_html") {
    // 确定性交付页渲染（零 LLM）：收集注册产物（文本）→ 单文件 HTML（四件套合一），移动端可读
    const outRel = nodeOutput(node) ?? "对外交付/选题交付页.html";
    const arts = listArtifacts(projectDir, { latest: true }).filter((a) => /\.(md|json)$/i.test(a.path));
    const seen = new Set<string>();
    const sections: string[] = [];
    const esc = (t: string) => t.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    const mdToHtml = (t: string): string => {
      const lines = esc(t).split("\n");
      const out: string[] = [];
      let inList = false;
      for (const ln of lines) {
        const h = ln.match(/^(#{1,4}) (.+)$/);
        if (h) {
          if (inList) { out.push("</ul>"); inList = false; }
          const lv = Math.min(h[1].length + 1, 5);
          out.push(`<h${lv}>${h[2]}</h${lv}>`);
        } else if (/^- /.test(ln)) {
          if (!inList) { out.push("<ul>"); inList = true; }
          out.push(`<li>${ln.slice(2)}</li>`);
        } else if (/^\|/.test(ln)) {
          if (ln.includes("---")) continue;
          out.push(`<p class="row">${ln.replace(/\|/g, " ┃ ")}</p>`);
        } else if (ln.trim() === "") {
          if (inList) { out.push("</ul>"); inList = false; }
        } else {
          if (inList) { out.push("</ul>"); inList = false; }
          out.push(`<p>${ln}</p>`);
        }
      }
      if (inList) out.push("</ul>");
      return out.join("\n");
    };
    for (const a of arts) {
      if (seen.has(a.path)) continue;
      seen.add(a.path);
      let text: string;
      try {
        text = fs.readFileSync(path.join(projectDir, a.path), "utf-8");
      } catch {
        continue;
      }
      sections.push(`<section><h1>${esc(a.path)}</h1>${mdToHtml(text)}</section>`);
    }
    const flowTitle = flow.title ?? flow.id;
    const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(flowTitle)} · 交付页</title>
<style>
body{margin:0;background:#f3efe6;color:#2b2822;font:15px/1.75 "Noto Sans SC",system-ui,sans-serif}
header{background:#2b2822;color:#f4f1ea;padding:28px 22px}
header h1{margin:0;font-size:20px;letter-spacing:1px}
header p{margin:6px 0 0;color:#b8b0a2;font-size:12px}
main{max-width:860px;margin:0 auto;padding:10px 16px 60px}
section{background:#fffdf9;border:1px solid #e4ddcd;border-radius:4px;margin:18px 0;padding:22px 26px;box-shadow:0 2px 10px rgba(70,58,35,.07)}
section>h1{font-size:15px;color:#a5433a;border-bottom:1px solid #e4ddcd;padding-bottom:8px;letter-spacing:1px}
footer{text-align:center;color:#b3ab9b;font-size:11px;padding:20px;letter-spacing:2px}
</style></head>
<body>
<header><h1>${esc(flowTitle)} · 交付页</h1><p>由 miniflow 内核确定性渲染（零 LLM）｜ ${sections.length} 件产物合一</p></header>
<main>
${sections.join("\n")}
</main>
<footer>miniflow harness · 本页为单文件交付物，可离线浏览</footer>
</body></html>`;
    fs.mkdirSync(path.join(projectDir, path.dirname(outRel)), { recursive: true });
    fs.writeFileSync(path.join(projectDir, outRel), html, "utf-8");
    makeArtifact(projectDir, {
      path: outRel,
      node: nodeId,
      producer: "minitool:render_html",
      inputs: {},
      delivery: true,
    });
    artifacts.push(outRel);
    return { ok: true, artifacts };
  }

  return {
    ok: false,
    artifacts,
    kind: "missing",
    reason: `minitool「${tool || "(未声明)"}」未实现（M1 边界）——节点 ${nodeId} 保持未执行，不静默放行`,
  };
}

/** 节点产物路径：node.file || node.output || flow.outputs 声明。 */
/** 节点产物路径字段（flow@2 唯一名 output；file 为兼容位）。规范 R4 §5.1。 */
export function nodeOutput(node: { output?: string; file?: string }): string | undefined {
  return node.output ?? node.file;
}

/** 节点校验声明（flow@2 唯一名 asserts；check/review 为兼容位）。规范 R4 §5.1。 */
export function nodeAsserts(node: { asserts?: string[]; check?: string[]; review?: string }): string[] {
  return [...new Set([...(node.asserts ?? []), ...(node.check ?? []), ...(node.review ? [node.review] : [])])];
}

/** 交付出口条目的路径：path 优先（显式交付路径），缺省回落节点产物（规范 R4 §5.1）。 */
export function outputPathOf(
  flow: FlowDescriptor,
  entry: { node?: string; path?: string; file?: string },
): string | undefined {
  return entry.path ?? entry.file ?? (entry.node ? artifactPathOf(flow, entry.node) : undefined);
}

export function artifactPathOf(flow: FlowDescriptor, nodeId: string): string | undefined {
  const node = flow.graph.nodes[nodeId];
  if (!node) return undefined;
  const declared = flow.outputs?.find((o) => o.node === nodeId);
  return nodeOutput(node) ?? declared?.path ?? declared?.file;
}

/** 节点产物路径全集：单体产物 + iterate 实例展开（模板 {n}/{i} → 按前后缀匹配目录内数字实例）。 */
export function artifactPathsOf(flow: FlowDescriptor, nodeId: string, projectDir: string): string[] {
  const node = flow.graph.nodes[nodeId];
  if (!node) return [];
  const out = new Set<string>();
  const single = artifactPathOf(flow, nodeId);
  if (single) out.add(single);
  const tpl = (node as { iterate?: { artifact?: string } }).iterate?.artifact;
  if (tpl && (tpl.includes("{n}") || tpl.includes("{i}"))) {
    const head = tpl.split("{")[0];
    const tail = tpl.slice(tpl.indexOf("}") + 1);
    const dir = path.dirname(head);
    const prefix = path.basename(head);
    try {
      for (const f of fs.readdirSync(path.join(projectDir, dir))) {
        if (f.startsWith(prefix) && f.endsWith(tail) && /^\d+$/.test(f.slice(prefix.length, f.length - tail.length))) {
          out.add((dir === "." ? "" : dir + "/") + f);
        }
      }
    } catch {
      /* 目录不存在 = 无实例 */
    }
  }
  return [...out];
}
