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

  // ── script 执行体（module@1 kind=check 壳，R6 §一.11「script 壳入箱」）──
  // 外部确定性脚本，零 token，内核 spawn。调用约定：
  //   python <ROOT>/<script> <projects/<id>/<src>> <projects/<id>/<out>> --title <首标题> --node <id> --flow <flowId>
  // src = 沿上游边 BFS（跳过 link/gate 等无产物接缝）找到的最近 md 产物；
  // 快照由脚本自带 --node 完成（铁律 7），这里只补 artifact 注册。
  const script = (node as { script?: string }).script;
  if (script) {
    const scriptPath = path.join(ROOT, script);
    if (!fs.existsSync(scriptPath)) {
      return { ok: false, artifacts, kind: "missing", reason: `script 执行体不存在: ${script}` };
    }
    let src: string | undefined;
    const seen = new Set<string>([nodeId]);
    const queue = flow.graph.edges.filter((e) => e.to === nodeId).map((e) => e.from);
    while (queue.length && !src) {
      const up = queue.shift()!;
      if (seen.has(up)) continue;
      seen.add(up);
      const last = state.nodes[up]?.lastArtifact;
      if (last && last.endsWith(".md") && fs.existsSync(path.join(projectDir, last))) {
        src = last;
        break;
      }
      for (const e of flow.graph.edges) if (e.to === up) queue.push(e.from);
    }
    if (!src) {
      return { ok: false, artifacts, kind: "assert", reason: `script ${script} 找不到上游 md 产物（沿上游 BFS 无命中）` };
    }
    const cfg = (node as { config?: Record<string, unknown> }).config ?? {};
    const outDir = typeof cfg.outDir === "string" && !cfg.outDir.startsWith("@") ? cfg.outDir : "对外交付";
    const outRel = path.join(outDir, path.basename(src).replace(/\.md$/i, "") + ".docx").replaceAll("\\", "/");
    const title =
      /^#\s+(.+)$/m.exec(fs.readFileSync(path.join(projectDir, src), "utf-8"))?.[1]?.trim() ?? path.basename(src, ".md");
    fs.mkdirSync(path.join(projectDir, outDir), { recursive: true });
    const pid = path.basename(projectDir);
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    try {
      await promisify(execFile)(
        "python",
        [scriptPath, path.join("projects", pid, src), path.join("projects", pid, outRel),
         "--title", title, "--node", nodeId, "--flow", state.flowId ?? ""].filter((a) => a !== ""),
        { cwd: ROOT, windowsHide: true, maxBuffer: 32 * 1024 * 1024 },
      );
    } catch (e) {
      const tail = String((e as { stderr?: string })?.stderr ?? (e as { message?: string })?.message ?? "")
        .split("\n").filter(Boolean).slice(-5).join(" ｜ ");
      return { ok: false, artifacts, kind: "assert", reason: `script ${script} 退出非零：${tail}` };
    }
    makeArtifact(projectDir, { path: outRel, node: nodeId, producer: `script:${path.basename(script)}`, inputs: {} });
    artifacts.push(outRel);
    return { ok: true, artifacts };
  }

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

  // ── R6 · continuity_slice（台账切片注入）──
  // 世界书 台账/人物/设定 按当前单位（章/集）切片供写手；输出 JSON 收据（写前查账）。
  if (tool === "continuity_slice") {
    const wb = path.join(projectDir, "世界书");
    const slice: Record<string, unknown[]> = { characters: [], inventory: [], knowledge: [], promises: [], timeline: [] };
    // 人物状态：世界书/人物/*.md 的 frontmatter 或首段状态行
    const charDir = path.join(wb, "人物");
    if (fs.existsSync(charDir)) {
      for (const f of fs.readdirSync(charDir)) {
        if (!f.endsWith(".md")) continue;
        const raw = fs.readFileSync(path.join(charDir, f), "utf-8");
        const name = f.replace(".md", "");
        const status = /状态[：:]\s*(.+)/.exec(raw)?.[1]?.trim() ?? "active";
        slice.characters.push({ name, status, file: `人物/${f}` });
      }
    }
    // 伏笔台账：| fid | 内容 | 埋点 | 预定回收 | 状态 |
    const ledgerCands = [path.join(wb, "伏笔", "台账.md"), path.join(projectDir, "伏笔台账.md")];
    for (const lp of ledgerCands) {
      if (!fs.existsSync(lp)) continue;
      for (const ln of fs.readFileSync(lp, "utf-8").split("\n")) {
        if (!ln.trim().startsWith("|") || /^[\s|:\-]+$/.test(ln)) continue;
        const cells = ln.split("|").map((c) => c.trim()).filter(Boolean);
        if (cells.length < 4 || /编号|内容|状态/.test(cells[0])) continue;
        slice.promises.push({ fid: cells[0], content: cells[1], planted: cells[2], due: cells[3], status: cells[4] ?? "open" });
      }
      break;
    }
    // 编年/章账：末节 handoff
    const chronPath = path.join(wb, "编年", "章账.md");
    if (fs.existsSync(chronPath)) {
      const lines = fs.readFileSync(chronPath, "utf-8").split("\n").filter((l) => l.trim());
      slice.timeline = lines.slice(-5).map((l) => l.trim());
    }
    const outRel = path.join("registry", "receipts", `continuity-slice-${nodeId}.json`).replaceAll("\\", "/");
    fs.mkdirSync(path.join(projectDir, "registry", "receipts"), { recursive: true });
    fs.writeFileSync(path.join(projectDir, outRel), JSON.stringify(slice, null, 2) + "\n", "utf-8");
    makeArtifact(projectDir, { path: outRel, node: nodeId, producer: "minitool:continuity_slice", inputs: {} });
    artifacts.push(outRel);
    return { ok: true, artifacts };
  }

  // ── R6 · continuity_commit（台账结算）──
  // 读上游节点的章账/伏笔变动，原子回写世界书词条（状态机 draft/active/retired）。
  if (tool === "continuity_commit") {
    // 当前实现：校验世界书目录存在即可通过（增量回写由写手直接编辑世界书文件，
    // 台账结算节点作为流程闸口确认「世界书已更新」——后续版本做结构化 diff）。
    const wb = path.join(projectDir, "世界书");
    if (!fs.existsSync(wb)) {
      return { ok: false, artifacts, kind: "assert", reason: "世界书/ 目录不存在——台账结算需世界书先行" };
    }
    const entryCount = fs.readdirSync(wb).filter((f) => f.endsWith(".md")).length;
    const outRel = path.join("registry", "receipts", `continuity-commit-${nodeId}.json`).replaceAll("\\", "/");
    fs.mkdirSync(path.join(projectDir, "registry", "receipts"), { recursive: true });
    fs.writeFileSync(path.join(projectDir, outRel), JSON.stringify({ ok: true, worldbookEntries: entryCount, committedAt: new Date().toISOString() }, null, 2) + "\n", "utf-8");
    makeArtifact(projectDir, { path: outRel, node: nodeId, producer: "minitool:continuity_commit", inputs: {} });
    artifacts.push(outRel);
    return { ok: true, artifacts };
  }

  // ── R6 · kb_search（知识库检索 + 查重）──
  // 按 node.knowledge 的 glob 检索知识库条目，按 node.desc 中的关键词打分排序，输出匹配清单。
  if (tool === "kb_search" || tool === "dedup") {
    const kbDir = path.join(ROOT, "knowledge");
    const globs: string[] = [];
    for (const n of [node, ...(flow.graph.edges.filter((e) => e.to === nodeId).map((e) => flow.graph.nodes[e.from] ?? {}))]) {
      for (const k of (n as any).loads ?? (n as any).knowledge ?? (n as any).kb ?? []) {
        if (typeof k === "string" && k.includes("/")) globs.push(k);
      }
    }
    const files: string[] = [];
    for (const g of globs) {
      const base = path.join(ROOT, g.replace(/\/\*$/, ""));
      if (fs.existsSync(base) && fs.statSync(base).isDirectory()) {
        for (const f of fs.readdirSync(base)) if (f.endsWith(".md")) files.push(path.join(base, f));
      } else if (fs.existsSync(base)) files.push(base);
    }
    if (!files.length) {
      // 兜底：扫全 knowledge/
      for (const sub of ["trope", "benchmark", "aesthetic", "craft", "market", "formats"]) {
        const d = path.join(kbDir, sub);
        if (fs.existsSync(d)) for (const f of fs.readdirSync(d)) if (f.endsWith(".md")) files.push(path.join(d, f));
      }
    }
    const keywords: string[] = [];
    for (const src of ["内部/稿本/梗卡.md", "内部/稿本/热点素材.md"]) {
      const fp = path.join(projectDir, src);
      if (fs.existsSync(fp)) {
        const txt = fs.readFileSync(fp, "utf-8");
        for (const m of txt.matchAll(/[「『]([^」』]{2,8})[」』]/g)) keywords.push(m[1]);
        for (const m of txt.matchAll(/\*\*([^*\n]{2,8})\*\*/g)) keywords.push(m[1]);
      }
    }
    const hits: { file: string; title: string; score: number }[] = [];
    for (const f of files) {
      const txt = fs.readFileSync(f, "utf-8");
      let score = 0;
      for (const kw of keywords) if (txt.includes(kw)) score += 1;
      const title = /^#\s+(.+)/m.exec(txt)?.[1] ?? path.basename(f);
      if (score > 0 || keywords.length === 0) hits.push({ file: path.relative(ROOT, f), title, score });
    }
    hits.sort((a, b) => b.score - a.score);
    const outRel = path.join("registry", "receipts", `kb-search-${nodeId}.json`).replaceAll("\\", "/");
    fs.mkdirSync(path.join(projectDir, "registry", "receipts"), { recursive: true });
    fs.writeFileSync(path.join(projectDir, outRel), JSON.stringify({ tool, keywords, hits: hits.slice(0, 20), total: hits.length }, null, 2) + "\n", "utf-8");
    makeArtifact(projectDir, { path: outRel, node: nodeId, producer: `minitool:${tool}`, inputs: {} });
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
