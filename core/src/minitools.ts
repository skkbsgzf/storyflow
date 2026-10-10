import type { FlowDescriptor, RunState, Validation } from "./types.js";
import { nodeEnv, nodeFs, nodePath, nodeProc } from "./abstraction/defaults.js";
import type { IFileSystem, IFsPath } from "./abstraction/fs.js";
import type { IProcessLauncher } from "./abstraction/proc.js";
import { rootOf } from "./schema.js";
import { makeArtifact, inputFingerprint, listArtifacts } from "./registry.js";
import { runIntegrityAsserts, blocked, dedupeValidations } from "./asserts.js";
import { runAestheticAsserts } from "./aesthetic.js";
import { isBackEdge } from "./cond.js";
import { journalAppend } from "./journal.js";
import type { StandingMount } from "./assertion-preset/types.js";
import { applyGatePreset, declaredAestheticTypes, gateContext } from "./assertion-preset/executor.js";
import { runDeclaredAesthetic } from "./assertion-preset/registry.js";

export interface CoreResult {
  ok: boolean;
  artifacts: string[];
  kind?: "missing" | "assert";
  reason?: string;
  problems?: Validation[];
  /** AP1 §十：本节点门策略摘要（diagnosticEnabled=false 或无预设时缺省）。 */
  diagnosticSummary?: string;
}

/** 展开节点 loads（"kb/market/constraints"、"kb/benchmark/*"）→ 知识文件绝对路径列表。 */
function resolveLoads(loads: string | string[] | undefined, fs: IFileSystem, path: IFsPath): string[] {
  if (!loads) return [];
  const items = Array.isArray(loads) ? loads : [loads];
  const out: string[] = [];
  for (const item of items) {
    const rel = item.replace(/^kb\//, "").replace(/\/\*$/, "");
    const base = path.join(rootOf(), "knowledge", rel);
    if (item.endsWith("/*") && fs.stat(base)?.isDirectory) {
      for (const f of fs.readDir(base).sort()) {
        if (fs.stat(path.join(base, f))?.isFile) out.push(path.join(base, f));
      }
    } else if (fs.stat(base)?.isFile) {
      out.push(base);
    } else if (fs.exists(base + ".md")) {
      out.push(base + ".md");
    } else if (fs.exists(path.join(rootOf(), item))) {
      out.push(path.join(rootOf(), item));
    }
  }
  return out;
}

/** 脚本壳/机器件执行超时兜底（与 `GENERIC_CONFIG.timeoutMs` 的 default 同值；单一事实源见 kits.ts）。 */
export const SCRIPT_TIMEOUT_MS = 60000;

/**
 * core 步（零 token，内核进程内执行）。
 * M1 实现：kb_load（内建）；check_* 走 integrity 模式（美学断言 M2 接入）；
 * 其余 minitool 返回类型化 missing（不静默放行）。
 * `opts.timeoutMs`：由内核按「节点 config > op/overlay config > 通用默认」解析后传入（D#14）。
 */
export async function runCoreNode(
  projectDir: string,
  flow: FlowDescriptor,
  state: RunState,
  nodeId: string,
  opts: { timeoutMs?: number; budget?: Record<string, number>; presetMount?: StandingMount } = {},
  fs: IFileSystem = nodeFs,
  path: IFsPath = nodePath,
  proc: IProcessLauncher = nodeProc,
): Promise<CoreResult> {
  const node = flow.graph.nodes[nodeId];
  const artifacts: string[] = [];
  if (!node) return { ok: false, artifacts, kind: "missing", reason: `图中无节点 ${nodeId}` };
  const tool = node.minitool ?? "";

  // ── script 执行体（module@1 kind=check 壳，R6 §一.11「script 壳入箱」）──
  // 外部确定性脚本，零 token，内核 spawn。调用约定：
  //   <python|node> <rootOf()>/<script> <projects/<id>/<src>> <projects/<id>/<out>> --title <首标题> --node <id> --flow <flowId>
  //   执行器按脚本扩展名选：.py → python（解释器可由 MINIFLOW_PYTHON / STORYFLOW_PYTHON 覆盖，缺省 python），.js/.cjs/.mjs → node。
  // src = 沿上游边 BFS（跳过 link/gate 等无产物接缝）找到的最近 md 产物；
  // 快照由脚本自带 --node 完成（铁律 7），这里只补 artifact 注册。
  const script = (node as { script?: string }).script;
  if (script) {
    const scriptPath = path.join(rootOf(), script);
    if (!fs.exists(scriptPath)) {
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
      if (last && last.endsWith(".md") && fs.exists(path.join(projectDir, last))) {
        src = last;
        break;
      }
      for (const e of flow.graph.edges) if (e.to === up) queue.push(e.from);
    }
    if (!src) {
      return { ok: false, artifacts, kind: "assert", reason: `script ${script} 找不到上游 md 产物（沿上游 BFS 无命中）` };
    }
    const cfg = (node as { config?: Record<string, unknown> }).config ?? {};
    // 落盘路径以节点声明 output 为准（expandFlow3 对 script op 派生 `<模块目录>/<toolId>.docx`）——
    // 声明与落盘不一致 = flow-verify 必红（ccwd-fq 首跑教训）；outDir 仅作无声明时的兜底。
    const declared = typeof (node as { output?: string }).output === "string" ? (node as { output?: string }).output! : "";
    const outRel = declared && !declared.startsWith("@")
      ? declared
      : path.join(typeof cfg.outDir === "string" && !cfg.outDir.startsWith("@") ? cfg.outDir : "对外交付",
                  path.basename(src).replace(/\.md$/i, "") + ".docx").replaceAll("\\", "/");
    const outParent = path.dirname(path.join(projectDir, outRel));
    const title =
      /^#\s+(.+)$/m.exec(fs.readText(path.join(projectDir, src)))?.[1]?.trim() ?? path.basename(src, ".md");
    fs.mkdir(outParent, { recursive: true });
    const pid = path.basename(projectDir);
    // D#14：脚本壳超时。此前 spawn **不带 timeout** ⇒ 脚本卡住 = 内核永久卡住
    // （与阶段 A 修的 agent 侧悬置同一类故障）。值由调用方按「节点 config > op/overlay config >
    // 通用默认 60000ms」（GENERIC_CONFIG.timeoutMs）解析后传入；到时显式报错，不静默挂死。
    const timeoutMs = opts.timeoutMs && opts.timeoutMs >= 1000 ? opts.timeoutMs : SCRIPT_TIMEOUT_MS;
    // 执行器按扩展名选：.py → python 壳（原口径），.js/.cjs/.mjs → node（JS 确定性件如 delivery/method-brief）。
    // 解释器可配置（批次2.5 P4）：python 壳的解释器走环境面（IEnv，R7-2 入册）——
    //   MINIFLOW_PYTHON 优先（与 compat.ts regenPages 同一旋钮，单点不另立山头），
    //   其次 STORYFLOW_PYTHON（本批命名口径）；都缺省回退 `python`，与历史行为逐字节一致，零破坏。
    //   背景（AGENTS.md 已知坑）：Windows 商店 python stub（exit 49 秒退）会让脚本壳
    //   误报「退出非零」而非走到超时路径——把真 python 全路径配进任一变量即治本。
    const runner = /\.(?:m|c)?js$/.test(scriptPath)
      ? "node"
      : nodeEnv.get("MINIFLOW_PYTHON") ?? nodeEnv.get("STORYFLOW_PYTHON") ?? "python";
    const startedAt = Date.now();
    const r = await proc.runAsync(
      runner,
      [scriptPath, path.join("projects", pid, src), path.join("projects", pid, outRel),
       "--title", title, "--node", nodeId, "--flow", state.flowId ?? "",
       // v5.0.1：JS 壳追加 --config（节点旋钮 JSON），否则 op.config 声明到位却没人读。
       // python 壳（export-doc/prose-scan 等 argparse 件）保持老 argv——多传未知参数会让它们直接退出。
       ...(runner === "node" ? ["--config", JSON.stringify(cfg)] : [])].filter((a) => a !== ""),
      { cwd: rootOf(), maxBufferBytes: 32 * 1024 * 1024, timeoutMs, killSignal: "SIGTERM" },
    );
    // 超时与「退出非零」必须分开报——混在一起就分不清「脚本有 bug」和「脚本跑太久」（原 err.killed/err.signal 同判）
    if (r.timedOut || r.signal === "SIGTERM") {
      const elapsed = Date.now() - startedAt;
      return {
        ok: false, artifacts, kind: "assert",
        reason: `script ${script} 超时 ${timeoutMs}ms 被内核终止（已跑 ${elapsed}ms；调 GENERIC_CONFIG/timeoutMs 或节点 config.timeoutMs 放宽）`,
      };
    }
    if (r.status !== 0) {
      const tail = String(r.stderr || r.error || "").split("\n").filter(Boolean).slice(-5).join(" ｜ ");
      return { ok: false, artifacts, kind: "assert", reason: `script ${script} 退出非零：${tail}` };
    }
    makeArtifact(projectDir, { path: outRel, node: nodeId, producer: `script:${path.basename(script)}`, inputs: {} }, fs, path);
    artifacts.push(outRel);
    return { ok: true, artifacts };
  }

  if (tool === "kb_load") {
    const files = resolveLoads(node.loads, fs, path);
    if (files.length === 0) {
      return { ok: false, artifacts, kind: "assert", reason: `kb_load 无匹配知识文件: ${JSON.stringify(node.loads)}` };
    }
    let combined = `# KB 装载 · ${nodeId}（${node.title ?? ""}）\n\n> 由 miniflow kernel kb_load 内建装载，来源 ${files.length} 个知识文件。\n`;
    for (const f of files) {
      const rel = path.relative(rootOf(), f).replaceAll("\\", "/");
      combined += `\n\n---\n\n<!-- source: ${rel} -->\n\n` + fs.readText(f);
    }
    const outRel = path.join("内部", `kb-${nodeId}.md`).replaceAll("\\", "/");
    fs.mkdir(path.join(projectDir, "内部"), { recursive: true });
    fs.writeText(path.join(projectDir, outRel), combined);
    makeArtifact(projectDir, { path: outRel, node: nodeId, producer: "minitool:kb_load", inputs: {} }, fs, path);
    artifacts.push(outRel);
    return { ok: true, artifacts };
  }

  if (tool === "scan_quality" || tool.startsWith("check_")) {
    // v5.0（工单 §三）：check_aesthetic_asserts 改造为 scan_quality——引擎全量扫描照跑，
    // 但输出只是**证据**（findings + 收据），不拦截、不裁决：判决归 agent 与人（端尾验收）。
    // 其余 check_*（如 check_trope_combo）保持 integrity 模式——确定性完整性仍照旧可拦。
    const scan = tool === "scan_quality";
    const upstream = flow.graph.edges
      .filter((e) => e.to === nodeId && !isBackEdge(e))
      .map((e) => e.from);
    const results: Validation[] = [];      // 原始证据（报告 findings 保持原样，含被策略降级的项）
    const gatedResults: Validation[] = []; // 策略后结果（integrity 模式的裁决输入）
    const gateSummaries: string[] = [];    // AP1 §十：策略摘要（供任务包 diagnosticSummary 注入）
    const checked: string[] = [];
    for (const up of upstream) {
      for (const rel of artifactPathsOf(flow, up, projectDir, fs, path)) {
        const abs = path.join(projectDir, rel);
        if (!fs.exists(abs)) continue;
        checked.push(rel);
        const relRaw = [...runIntegrityAsserts(projectDir, rel, fs, path)];
        if (scan) {
          // 扫描器 = aesthetic.ts 全量确定性检查；其 pass/warn/block 标签只是证据分级，
          // 不构成提交闸——block 证据交由验收人/agent 决断（增补循环的输入）。
          relRaw.push(...runAestheticAsserts(projectDir, rel, opts.budget, fs, path));
        } else if (opts.presetMount) {
          // Assertion Preset v1：preset 声明的 AE-* 断言在 integrity 检查节点由注册表补跑
          relRaw.push(...runDeclaredAesthetic(declaredAestheticTypes(opts.presetMount), projectDir, rel, opts.budget, fs, path));
        }
        results.push(...relRaw);
        if (opts.presetMount && !scan) {
          const gated = applyGatePreset(
            opts.presetMount,
            relRaw,
            gateContext(projectDir, nodeId, node, rel, (state.nodes[nodeId]?.round ?? 0) + 1, fs, path),
          );
          gatedResults.push(...gated.problems);
          if (gated.summary) gateSummaries.push(`${rel} → ${gated.summary}`);
        } else {
          gatedResults.push(...relRaw);
        }
      }
    }
    const reportRel = path
      .join("内部", `${scan ? "质量扫描" : "检查报告"}-${nodeId}.json`)
      .replaceAll("\\", "/");
    const gateSummary = gateSummaries.length ? gateSummaries.join(" ｜ ") : undefined;
    fs.mkdir(path.join(projectDir, "内部"), { recursive: true });
    const finalResults = dedupeValidations(results);
    const report = {
      mode: scan ? "quality-evidence" : "integrity",
      node: nodeId,
      minitool: tool,
      checked,
      findings: finalResults,
      summary: scan
        ? {
            files: checked.length,
            pass: finalResults.filter((r) => r.status === "pass").length,
            warn: finalResults.filter((r) => r.status === "warn").length,
            block: finalResults.filter((r) => r.status === "block").length,
          }
        : undefined,
      gateSummary,
      note: scan
        ? "scan_quality：确定性扫描器全量证据（v5.0 agent-only——证据不是判决，本步不拦截；裁决归验收 agent/人，报数必附本报告文件）"
        : "integrity 模式（存在性/残渣/计数一致性）",
    };
    fs.writeText(path.join(projectDir, reportRel), JSON.stringify(report, null, 2) + "\n");
    makeArtifact(projectDir, {
      path: reportRel,
      node: nodeId,
      producer: `minitool:${tool}`,
      inputs: inputFingerprint(projectDir, checked, fs, path), // 记录被检产物指纹——rerun 缓存命中判定依据
    }, fs, path);
    artifacts.push(reportRel);
    if (scan && checked.length === 0) {
      // 空扫描 = 上游没东西可检——不是通过，是接线问题，显式留痕不静默
      journalAppend({ fs, path }, projectDir, state.runId, "warn", {
        nodeId,
        detail: `scan_quality 未检到任何上游产物（证据为空，非质量通过）——检查上游边/产物注册`,
        refs: [reportRel],
      });
    }
    if (!scan) {
      // 裁决用策略后结果：preset 的降级/升级/progressive 已生效；无 preset = 与原行为一致
      const blocks = blocked(dedupeValidations(gatedResults));
      if (blocks.length) {
        return { ok: false, artifacts, kind: "assert", reason: `${tool} block ${blocks.length} 项`, problems: blocks, diagnosticSummary: gateSummary };
      }
    }
    return { ok: true, artifacts, diagnosticSummary: gateSummary };
  }

  if (tool === "render_html") {
    // 确定性交付页渲染（零 LLM）：收集注册产物（文本）→ 单文件 HTML（四件套合一），移动端可读
    const outRel = nodeOutput(node) ?? "对外交付/选题交付页.html";
    const arts = listArtifacts(projectDir, { latest: true }, fs, path).filter((a) => /\.(md|json)$/i.test(a.path));
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
          const lv = Math.min((h[1] ?? "#").length + 1, 5);
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
        text = fs.readText(path.join(projectDir, a.path));
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
    fs.mkdir(path.join(projectDir, path.dirname(outRel)), { recursive: true });
    fs.writeText(path.join(projectDir, outRel), html);
    makeArtifact(projectDir, {
      path: outRel,
      node: nodeId,
      producer: "minitool:render_html",
      inputs: {},
      delivery: true,
    }, fs, path);
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
    if (fs.exists(charDir)) {
      for (const f of fs.readDir(charDir)) {
        if (!f.endsWith(".md")) continue;
        const raw = fs.readText(path.join(charDir, f));
        const name = f.replace(".md", "");
        const status = /状态[：:]\s*(.+)/.exec(raw)?.[1]?.trim() ?? "active";
        (slice.characters ??= []).push({ name, status, file: `人物/${f}` });
      }
    }
    // 伏笔台账：| fid | 内容 | 埋点 | 预定回收 | 状态 |
    const ledgerCands = [path.join(wb, "伏笔", "台账.md"), path.join(projectDir, "伏笔台账.md")];
    for (const lp of ledgerCands) {
      if (!fs.exists(lp)) continue;
      for (const ln of fs.readText(lp).split("\n")) {
        if (!ln.trim().startsWith("|") || /^[\s|:\-]+$/.test(ln)) continue;
        const cells = ln.split("|").map((c) => c.trim()).filter(Boolean);
        if (cells.length < 4 || /编号|内容|状态/.test(cells[0] ?? "")) continue;
        (slice.promises ??= []).push({ fid: cells[0] ?? "", content: cells[1] ?? "", planted: cells[2] ?? "", due: cells[3] ?? "", status: cells[4] ?? "open" });
      }
      break;
    }
    // 编年/章账：末节 handoff
    const chronPath = path.join(wb, "编年", "章账.md");
    if (fs.exists(chronPath)) {
      const lines = fs.readText(chronPath).split("\n").filter((l) => l.trim());
      slice.timeline = lines.slice(-5).map((l) => l.trim());
    }
    const outRel = path.join("registry", "receipts", `continuity-slice-${nodeId}.json`).replaceAll("\\", "/");
    fs.mkdir(path.join(projectDir, "registry", "receipts"), { recursive: true });
    fs.writeText(path.join(projectDir, outRel), JSON.stringify(slice, null, 2) + "\n");
    makeArtifact(projectDir, { path: outRel, node: nodeId, producer: "minitool:continuity_slice", inputs: {} }, fs, path);
    artifacts.push(outRel);
    return { ok: true, artifacts };
  }

  // ── R6 · continuity_commit（台账结算）──
  // 读上游节点的章账/伏笔变动，原子回写世界书词条（状态机 draft/active/retired）。
  if (tool === "continuity_commit") {
    // 当前实现：校验世界书目录存在即可通过（增量回写由写手直接编辑世界书文件，
    // 台账结算节点作为流程闸口确认「世界书已更新」——后续版本做结构化 diff）。
    const wb = path.join(projectDir, "世界书");
    if (!fs.exists(wb)) {
      return { ok: false, artifacts, kind: "assert", reason: "世界书/ 目录不存在——台账结算需世界书先行" };
    }
    const entryCount = fs.readDir(wb).filter((f) => f.endsWith(".md")).length;
    const outRel = path.join("registry", "receipts", `continuity-commit-${nodeId}.json`).replaceAll("\\", "/");
    fs.mkdir(path.join(projectDir, "registry", "receipts"), { recursive: true });
    fs.writeText(path.join(projectDir, outRel), JSON.stringify({ ok: true, worldbookEntries: entryCount, committedAt: new Date().toISOString() }, null, 2) + "\n");
    makeArtifact(projectDir, { path: outRel, node: nodeId, producer: "minitool:continuity_commit", inputs: {} }, fs, path);
    artifacts.push(outRel);
    return { ok: true, artifacts };
  }

  // ── R6 · kb_search（知识库检索 + 查重）──
  // 按 node.knowledge 的 glob 检索知识库条目，按 node.desc 中的关键词打分排序，输出匹配清单。
  if (tool === "kb_search" || tool === "dedup") {
    const kbDir = path.join(rootOf(), "knowledge");
    const globs: string[] = [];
    for (const n of [node, ...(flow.graph.edges.filter((e) => e.to === nodeId).map((e) => flow.graph.nodes[e.from] ?? {}))]) {
      for (const k of (n as any).loads ?? (n as any).knowledge ?? (n as any).kb ?? []) {
        if (typeof k === "string" && k.includes("/")) globs.push(k);
      }
    }
    const files: string[] = [];
    for (const g of globs) {
      const base = path.join(rootOf(), g.replace(/\/\*$/, ""));
      if (fs.stat(base)?.isDirectory) {
        for (const f of fs.readDir(base)) if (f.endsWith(".md")) files.push(path.join(base, f));
      } else if (fs.exists(base)) files.push(base);
    }
    if (!files.length) {
      // 兜底：扫全 knowledge/
      for (const sub of ["trope", "benchmark", "aesthetic", "craft", "market", "formats"]) {
        const d = path.join(kbDir, sub);
        if (fs.exists(d)) for (const f of fs.readDir(d)) if (f.endsWith(".md")) files.push(path.join(d, f));
      }
    }
    const keywords: string[] = [];
    for (const src of ["内部/稿本/梗卡.md", "内部/稿本/热点素材.md"]) {
      const fp = path.join(projectDir, src);
      if (fs.exists(fp)) {
        const txt = fs.readText(fp);
        for (const m of txt.matchAll(/[「『]([^」』]{2,8})[」』]/g)) { if (m[1]) keywords.push(m[1]); }
        for (const m of txt.matchAll(/\*\*([^*\n]{2,8})\*\*/g)) { if (m[1]) keywords.push(m[1]); }
      }
    }
    const hits: { file: string; title: string; score: number }[] = [];
    for (const f of files) {
      const txt = fs.readText(f);
      let score = 0;
      for (const kw of keywords) if (txt.includes(kw)) score += 1;
      const title = /^#\s+(.+)/m.exec(txt)?.[1] ?? path.basename(f);
      if (score > 0 || keywords.length === 0) hits.push({ file: path.relative(rootOf(), f), title, score });
    }
    hits.sort((a, b) => b.score - a.score);
    const outRel = path.join("registry", "receipts", `kb-search-${nodeId}.json`).replaceAll("\\", "/");
    fs.mkdir(path.join(projectDir, "registry", "receipts"), { recursive: true });
    fs.writeText(path.join(projectDir, outRel), JSON.stringify({ tool, keywords, hits: hits.slice(0, 20), total: hits.length }, null, 2) + "\n");
    makeArtifact(projectDir, { path: outRel, node: nodeId, producer: `minitool:${tool}`, inputs: {} }, fs, path);
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

/** 节点产物路径字段（flow@2 唯一名 output；file 为兼容位）。规范 R4 §5.1。 */
export function nodeOutput(node: { output?: string; file?: string }): string | undefined {
  return node.output ?? node.file;
}

/** 交付出口条目的路径：path 优先（显式交付路径），缺省回落节点产物（规范 R4 §5.1）。 */
export function outputPathOf(
  flow: FlowDescriptor,
  entry: { node?: string; path?: string; file?: string },
): string | undefined {
  return entry.path ?? entry.file ?? (entry.node ? artifactPathOf(flow, entry.node) : undefined);
}

export function artifactPathOf(flow: FlowDescriptor, nodeId: string): string | undefined {
  // 注意：`FlowDescriptor.graph` 在类型上是必填，但 **flow@3 的原始描述符里没有 graph**
  // （节点由 modules 派生，只有 effective@2 才有）。此处必须防御——否则一处 `.graph.nodes`
  // 就能让消费方（如 viewWorkbenchPayload）对整个 flow@3 项目 500 崩。
  const node = flow.graph?.nodes?.[nodeId];
  if (!node) return undefined;
  const declared = flow.outputs?.find((o) => o.node === nodeId);
  return nodeOutput(node) ?? declared?.path ?? declared?.file;
}

/** 节点产物路径全集：单体产物 + iterate 实例展开（模板 {n}/{i} → 按前后缀匹配目录内数字实例）。 */
export function artifactPathsOf(flow: FlowDescriptor, nodeId: string, projectDir: string, fs: IFileSystem = nodeFs, path: IFsPath = nodePath): string[] {
  const node = flow.graph.nodes[nodeId];
  if (!node) return [];
  const out = new Set<string>();
  const single = artifactPathOf(flow, nodeId);
  if (single) out.add(single);
  const tpl = (node as { iterate?: { artifact?: string } }).iterate?.artifact;
  if (tpl && (tpl.includes("{n}") || tpl.includes("{i}"))) {
    const head = tpl.split("{")[0] ?? "";
    const tail = tpl.slice(tpl.indexOf("}") + 1);
    const dir = path.dirname(head);
    const prefix = path.basename(head);
    try {
      for (const f of fs.readDir(path.join(projectDir, dir))) {
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
