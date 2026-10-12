"""dashboard · 项目看板聚合器（批次4 W4.1：一条命令出全量自包含 HTML 看板）

把项目知识体系一页摊开——七区：**总览 / 世界书 / 大事记（叙事时间线）/ 执行流水 / RAG 图谱 / 知识多维表格 / 产物文件区**。
数据全部来自既有生成器与盘上真相文件，本工具**只读取 kit 侧、只写 projects/ 侧**（双根红线）：

  · RAG 图谱   ← kit/hypergraph.rag.json + projects/<id>/kit/hypergraph.rag.json
                 （复用 tools/kb-graph-page.py 的 build_payload 双根合并去重口径）
  · 世界书     ← projects/<id>/世界书/**/*.md 卡片（复用 tools/worldbook_index.py 归纳层，
                 文件即真相；built_at 字段丢弃——它是生成时刻，破幂等）
  · 大事记     ← projects/<id>/世界书/时间线.md（或 世界书/编年/大事记.md）的人写叙事时间线，
                 复用 tools/chronicle.py 归纳器**在内存内**产出 chronicle@1（5W1H + 多轨 + 钻取）。
                 看板不写 chronicle.json——派生件由 chronicle.py 独占写，两处写会养出两套时序；
                 源 md 永不被本工具改写（kit 只给形，不猜你的内容）
  · 执行流水   ← projects/<id>/journal.jsonl（复用 tools/journal-page.py 三形态装载）。
                 **这是内核执行环台账，不是叙事大事记**——W4.6 口径纠偏：两套账分列不混排
  · 知识表格   ← knowledge/**/*.md（全局卡）+ 项目 世界书/规则/文风/*.md，
                 frontmatter 取 id/title/domain/track/status/version/tags/updated，正文内嵌供点击看全文
  · 产物区     ← projects/<id>/project-index.json（project-index@1 的 role/kind/hash/mtime）
                 + md/txt 首段摘要；**正文不内嵌**（全文读写见 W4.2 三通道）
  · 总览       ← 项目配置.json 摘要 + 各区计数 + reports/diagnosis-*.json 账 + 数据源健康表

工程范式与 tools/kb-graph-page.py / diagnosis-page.py 一致：
  · 零外部资源红线（ARCHITECTURE §9 不变量 6）：模板与产物 src/href/url()/@import 不得指 http(s):// 或 //host；
  · 幂等：页面**不携带生成时刻**，同一盘上输入重跑 sha256 逐字节一致（一切字段派生自盘上文件与稳定排序）；
  · 不回 call kit：数据生成时内联为惰性 JSON（</ 转义防提前闭合脚本）；
  · --selfcheck 合成 fixture 全链自测（形状校验 → 幂等两遍渲染 → 计数一致 → 零外部资源断言）。

用法：
  python tools/dashboard.py --project <id> [--root <数据父目录>] [--kit-root <kit 仓根>] [--out <html>] [--title <标题>]
      输出缺省 projects/<id>/dashboard.html（--root 平铺回退同 kit-compile 口径：
      先看 <root>/projects/<id>，再看 <root>/<id>——外部平铺项目根可直接出板）
      双根口径（架构红线 2「双根不许合一」）：--root 只管项目数据，全局 KB 板块与 RAG 图谱的全局档
      永远取 --kit-root（缺省本脚本所在仓根），所以外部根出板时知识体系照常齐全。
  python tools/dashboard.py --project <id> --print-payload   # 只出 dashboard@1 JSON（对账/排障，不写盘）
  python tools/dashboard.py --selfcheck

退出码：0 成功；1 项目/模板缺失 / 契约形状不符 / 零外部资源断言失败；2 用法错误（argparse）。
"""
import argparse
import html
import importlib.util
import json
import re
import sys
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TEMPLATE = Path(__file__).resolve().parent / "dashboard-template.html"

REQUIRED_TOP = ("format", "project", "title", "zones", "overview", "worldbook",
                "chronicle", "journal", "graph", "cards", "artifacts", "meta")

# 零外部资源红线（与 diagnosis-page / kb-graph-page 同表）：
# src/href 属性、CSS url()、@import 都不许指向 http(s):// 或协议相对 //host；锚点 # 与 xmlns 不在此列。
EXTERNAL_PATTERNS = (
    re.compile(r"""(?:src|href)\s*=\s*["']?(?:https?:)?//""", re.I),
    re.compile(r"""url\(\s*["']?(?:https?:)?//""", re.I),
    re.compile(r"""@import\s+(?:url\(\s*)?["']?(?:https?:)?//""", re.I),
)

# 产物区摘要只给文稿类（md/txt）；JSON/JSONL 只给字节与字符账（首段是花括号，摘要无意义）；
# doc/docx 等二进制只列元数据（编辑转 md 走改稿套件，见 W4.2）
SUMMARY_SUFFIXES = {".md", ".txt"}
META_SUFFIXES = {".json", ".jsonl"}
DOC_SUFFIXES = {".doc", ".docx", ".pdf", ".epub"}
SUMMARY_LIMIT = 140
SUMMARY_MAX_BYTES = 200_000   # 超大件不读正文（看板是索引不是镜像）

PROJECT_CONFIG_KEYS = ("id", "title", "灵感", "flowId", "flowVersion", "layout", "项目")


def load_sibling_module(filename: str):
    """按路径加载 tools/ 下同目录脚本（文件名带连字符，不能当包 import）。同文件只加载一次。"""
    cache = load_sibling_module.__dict__.setdefault("_cache", {})
    if filename in cache:
        return cache[filename]
    path = Path(__file__).resolve().parent / filename
    name = path.stem.replace("-", "_")
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise SystemExit(f"[ABORT] 无法加载复用件：{path}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    cache[filename] = mod
    return mod


def external_hits(text: str):
    """返回命中零外部资源红线的行（空列表 = 通过）。"""
    return [ln.strip()[:160] for ln in text.splitlines() if any(p.search(ln) for p in EXTERNAL_PATTERNS)]


def abs_path_hits(text: str):
    """分发前自检：页面里残留的本机绝对路径（工具不该写它们，作者原文里可能有）。
    只记账、不阻断——出板照常，提示由人决定要不要在上传前处理（W4.3）。"""
    return [m.group(0)[:80] for m in re.finditer(
        r"(?<![A-Za-z0-9])[A-Za-z]:(?:\\{1,2}|/)(?!/)[^\s\"'<>]{2,}|/(?:Users|home|mnt)/[^\s\"'<>]{3,}", text)]


def disp_path(p: Path, base: Path) -> str:
    """数据源健康表的展示串：**相对路径**，绝不写绝对路径。
    看板要挂到公网（W4.3 Cloudflare Pages），绝对路径＝把本机目录结构与用户名白送给访问者。
    锚点取不到相对形态时退回「只到项目 id 一层」的写法，也不外泄盘符。"""
    try:
        return str(p.relative_to(base)).replace("\\", "/")
    except ValueError:
        parts = p.parts
        for i, seg in enumerate(parts):
            if seg == "projects" and i + 1 < len(parts):
                return "/".join(parts[i:]).replace("\\", "/")
        return p.name


def parse_frontmatter(text: str):
    """卡片 frontmatter 双形态解析 → (dict, body)。

    ① JSON-in-fence（knowledge/ 语料卡现行形态：--- 包一段 JSON）；
    ② YAML 子集（世界书/规则卡形态，复用 worldbook_index.parse_frontmatter）。
    解析失败按无头处理（正文原样返回），不抛错——看板是展示面，残卡要能露出来而不是崩页。
    """
    m = re.match(r"^---\r?\n(.*?)\r?\n---\r?\n?", text, re.S)
    if not m:
        return {}, text
    raw, body = m.group(1), text[m.end():]
    try:
        d = json.loads(raw)
        if isinstance(d, dict):
            return d, body
    except Exception:
        pass
    try:
        wb = load_sibling_module("worldbook_index.py")
        fm, _ = wb.parse_frontmatter(text)
        return fm, body
    except SystemExit:
        return {}, body


def as_list(v):
    if isinstance(v, list):
        return [str(x) for x in v]
    if v in (None, ""):
        return []
    return [str(v)]


def first_para(body: str, limit: int = SUMMARY_LIMIT) -> str:
    for para in body.split("\n\n"):
        t = re.sub(r"[#*`>\[\]]", "", para).strip().replace("\n", " ")
        if len(t) >= 8:
            return t[:limit] + ("…" if len(t) > limit else "")
    return ""


def load_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def resolve_project(root: Path, project: str) -> Path:
    """双根定位（kit-compile 同口径）：先看 <root>/projects/<id>，回退 <root>/<id>（平铺外部项目根）。"""
    cand = root / "projects" / project
    if cand.is_dir():
        return cand
    flat = root / project
    if flat.is_dir():
        return flat
    return cand


# ────────────────────────────── 七区取数 ──────────────────────────────

def zone_graph(kit_root: Path, proj: Path, project: str, notices: list):
    """RAG 图谱区：全局编译图（+ 项目档）→ kb-graph-page 同款 payload。
    全局图锚 **kit 仓库根**（--kit-root），项目档锚项目目录——双根不合一（架构红线 2）。"""
    kb = load_sibling_module("kb-graph-page.py")
    g_path = kit_root / "kit" / "hypergraph.rag.json"
    p_path = proj / "kit" / "hypergraph.rag.json"
    if not g_path.exists():
        notices.append(f"全局编译图缺失：{g_path}（先跑 python tools/kit-compile.py）——RAG 图谱区与 KB 板块为空")
        payload = {"format": "kb-graph-page@1", "scope": "none", "project": project,
                   "clusters": [], "domains": [], "nodes": [], "links": [],
                   "meta": {"dropped_links": 0, "duplicate_ids": [], "global_stats": {}, "project_stats": {}}}
        return payload, None, None
    g = kb.load_graph(g_path)
    p = kb.load_graph(p_path) if p_path.exists() else None
    if p is None:
        notices.append(f"项目编译图缺失：{p_path}（跑 python tools/kit-compile.py --project {project}）——图谱仅全局档")
    return kb.build_payload(g, p, project), g, p


def zone_worldbook(proj: Path, notices: list):
    """世界书区：复用 worldbook_index 归纳层（文件即真相）；built_at 丢弃保幂等。"""
    wi = load_sibling_module("worldbook_index.py")
    graph = wi.build_index(proj)
    graph.pop("built_at", None)
    graph.pop("empty", None)
    if not graph.get("entries"):
        notices.append(f"世界书无词条卡片：{proj / '世界书'}（python tools/worldbook.py init {proj.name} 建骨架）")
    return graph


def zone_chronicle(proj: Path, notices: list):
    """大事记区：叙事 5W1H 多轨时间线。复用 tools/chronicle.py 在内存内出 chronicle@1——
    看板**不写** chronicle.json（派生件由 chronicle.py 独占写，两处写会养出两套时序），
    源 md 永不被改写。缺时间线文件＝空区不是错（骨架模板项目还没写编年属正常态）。"""
    empty = {"format": "chronicle@1", "project": proj.name, "sources": [],
             "bands": [], "lanes": [], "events": [], "stats": {},
             # 叙述层（W4.7）空态也要有人话，页面不留白：开场白说清为什么空、怎么才有
             "narrative": {
                 "lead": "这个项目还没有大事记。真相源是作者手写的 世界书/时间线.md，"
                         "或者 世界书/编年/大事记.md。写下第一条编年再重跑归纳器，"
                         "这一页就成了多轨时间线。",
                 "hint": "一条编年就是一行 - 开头的短句，写清何时、何地、谁做了什么，"
                         "末尾用（第N章）标章。要起因与手法说话，就在行里加〔因：…〕〔如何：…〕。",
                 "gaps": [],
                 "beats": [{"k": k, "label": lab} for k, lab in
                           (("s", "情境"), ("t", "起因"), ("a", "经过"), ("r", "落点"))],
             }}
    try:
        ch = load_sibling_module("chronicle.py")
    except Exception as e:  # noqa: BLE001 归纳器坏了不拖垮整张看板，但要显式说
        notices.append(f"chronicle 归纳器装载失败，大事记区为空：{e}")
        return empty
    missing = [rel for rel in ch.SOURCE_CANDIDATES if not (proj / rel).exists()]
    if len(missing) == len(ch.SOURCE_CANDIDATES):
        notices.append("大事记真相源不存在（" + " / ".join(ch.SOURCE_CANDIDATES) +
                       "）——该区为空，作者写下编年条目后重跑即有")
        return empty
    try:
        payload = ch.render_json(proj, proj.name)
    except SystemExit as e:  # 契约/形状校验不过＝不带病出板，但也不让整张看板黑屏
        notices.append(f"chronicle@1 校验未过，大事记区为空：{str(e)[:200]}")
        return empty
    for rel in missing:
        notices.append(f"大事记另一真相源 {rel} 不存在（已收其余源，多源可并存）")
    return payload


def zone_journal(proj: Path, notices: list):
    """执行流水区：journal.jsonl 三形态装载（复用 journal-page）；缺文件为空区不是错。
    注意区名——这是内核执行环台账（run/advance/submit…），**不是**叙事大事记（W4.6 纠偏）。"""
    jp = load_sibling_module("journal-page.py")
    src = proj / "journal.jsonl"
    if not src.exists():
        notices.append("执行流水台账不存在（projects/<id>/journal.jsonl）——该区为空，内核执行环落账后重跑即有")
        return {"entries": [], "skipped": 0}
    events, skipped = jp.load_events(src)
    return {"entries": events, "skipped": skipped}


def card_row(path: Path, base: Path, source: str, domain_default: str):
    """一张 md 卡 → 多维表格行（含正文供点击看全文）。"""
    try:
        text = path.read_text(encoding="utf-8")
    except Exception as e:  # noqa: BLE001
        return {"id": path.name, "title": path.stem, "domain": domain_default, "track": "",
                "status": "unreadable", "version": "", "tags": [], "updated": "", "type": "",
                "source": source, "path": path.relative_to(base).as_posix(),
                "body": f"[读取失败：{e}]", "bytes": 0}
    fm, body = parse_frontmatter(text)
    rel_parts = path.relative_to(base).as_posix().split("/")
    domain = str(fm.get("domain") or (rel_parts[0] if len(rel_parts) > 1 else domain_default))
    return {
        "id": str(fm.get("id") or path.stem),
        "title": str(fm.get("title") or path.stem),
        "domain": domain,
        "track": str(fm.get("track") or ""),
        "status": str(fm.get("status") or "active"),
        "version": str(fm.get("version") or ""),
        "tags": as_list(fm.get("tags")),
        "updated": str(fm.get("updated") or ""),
        "type": str(fm.get("type") or ""),
        "source": source,
        "path": path.relative_to(base).as_posix(),
        "body": body.strip("\n"),
        "bytes": len(text.encode("utf-8")),
    }


def zone_cards(kit_root: Path, proj: Path, project: str, notices: list):
    """知识多维表格区：全局 knowledge/ 语料卡（锚 --kit-root）+ 项目 世界书/规则/文风 卡
    （README 不入表，与 kit-compile 同口径）。"""
    rows = []
    kb_dir = kit_root / "knowledge"
    if kb_dir.is_dir():
        for p in sorted(kb_dir.rglob("*.md")):
            if p.name == "README.md":
                continue
            rows.append(card_row(p, kb_dir, "全局KB", "uncategorized"))
    else:
        notices.append(f"全局语料目录不存在：{kb_dir}（knowledge/ 是本地可插拔层，README 除外不入 git）")
    for sub in ("世界书", "规则", "文风"):
        d = proj / sub
        if not d.is_dir():
            continue
        for p in sorted(d.rglob("*.md")):
            if p.name == "README.md":
                continue
            rows.append(card_row(p, proj, f"项目·{sub}", sub))
    if not rows:
        notices.append("无任何知识卡——知识表格区为空")
    return rows


def zone_artifacts(proj: Path, notices: list):
    """产物区：project-index@1 清单 + md/txt 首段摘要；正文不内嵌（W4.2 通道）。"""
    idx_path = proj / "project-index.json"
    idx = load_json(idx_path) if idx_path.exists() else None
    if not isinstance(idx, dict) or idx.get("format") != "project-index@1":
        notices.append(f"产物索引缺失或格式不符：{idx_path}（先跑 python tools/project-index.py index --project {proj.name}）")
        return []
    rows = []
    for e in idx.get("entries", []):
        rel = str(e.get("path", ""))
        if not rel:
            continue
        p = proj / rel
        suffix = p.suffix.lower()
        row = {"path": rel, "role": str(e.get("role", "?")), "kind": str(e.get("kind", "?")),
               "mtime": str(e.get("mtime", "")), "hash": str(e.get("hash", "")),
               "bytes": p.stat().st_size if p.exists() else 0,
               "missing": not p.exists(), "summary": "", "chars": 0, "mode": "list"}
        if suffix in DOC_SUFFIXES:
            row["mode"] = "readonly"
            row["note"] = "二进制文档只读预览；编辑请转 md 走改稿套件（W4.2 通道 C）"
            if suffix in (".docx",) and p.exists():
                try:  # docx 元数据（零依赖 zipfile）：段落文本长度，不内嵌正文
                    with zipfile.ZipFile(p) as z:
                        xml = z.read("word/document.xml").decode("utf-8", "replace")
                    row["chars"] = len(re.sub(r"<[^>]+>", "", xml))
                except Exception:
                    pass
        elif p.exists() and suffix in SUMMARY_SUFFIXES and row["bytes"] <= SUMMARY_MAX_BYTES:
            try:
                body = p.read_text(encoding="utf-8")
                _, bare = parse_frontmatter(body)
                row["summary"] = first_para(bare)
                row["chars"] = len(bare)
                row["mode"] = "preview-meta"
            except Exception:
                pass
        elif p.exists() and suffix in META_SUFFIXES:
            row["chars"] = p.stat().st_size
            row["mode"] = "meta-only"
            if row["bytes"] > SUMMARY_MAX_BYTES:
                row["summary"] = f"（{row['bytes']} 字节，超出看板阈值 {SUMMARY_MAX_BYTES}，走 W4.2 通道读全文）"
        elif p.exists() and suffix in SUMMARY_SUFFIXES:
            row["summary"] = f"（{row['bytes']} 字节，超出看板摘要阈值 {SUMMARY_MAX_BYTES}，走 W4.2 通道读全文）"
            row["mode"] = "meta-only"
        elif p.exists():
            row["mode"] = "readonly"
        rows.append(row)
    return sorted(rows, key=lambda r: r["path"])


def zone_overview(project: str, kit_root: Path, proj: Path, graph_payload: dict,
                  wb: dict, chronicle: dict, journal: dict, cards: list, artifacts: list,
                  global_g: dict | None, notices: list):
    """总览区：项目配置摘要 + 七区计数 + 诊断报告账 + 数据源健康表。"""
    cfg_raw = load_json(proj / "项目配置.json") or {}
    cfg = {k: cfg_raw[k] for k in PROJECT_CONFIG_KEYS if k in cfg_raw}
    for k in ("sessionBrief", "openQuestions"):
        if isinstance(cfg_raw.get(k), list):
            cfg[k] = cfg_raw[k]
    reports = []
    for p in sorted((proj / "reports").glob("diagnosis-*.json")) if (proj / "reports").is_dir() else []:
        d = load_json(p)
        if not isinstance(d, dict):
            notices.append(f"诊断报告不是合法 JSON，已跳过：{p.name}")
            continue
        eng = d.get("engines") or {}
        reports.append({
            "path": f"reports/{p.name}",
            "target": str(d.get("target", "")),
            "items": len(d.get("items") or []),
            "evidence": len(d.get("evidence") or []),
            "summary": str(d.get("summary", "")),
            "engines": {k: bool((v or {}).get("ran")) for k, v in eng.items() if isinstance(v, dict)},
            "receipt": str(d.get("receipt", "")),
        })
    receipts = len(list((proj / "registry" / "receipts").glob("*.json"))) if (proj / "registry" / "receipts").is_dir() else 0

    domains, clusters = {}, {}
    for g in (global_g,):
        for e in (g or {}).get("entries", []):
            domains[e.get("domain", "?")] = domains.get(e.get("domain", "?"), 0) + 1
        for c in ((g or {}).get("stats") or {}).get("clusters", []) or []:
            clusters[c.get("name", "?")] = c.get("size", 0)
    by_status, by_domain_cards, by_track = {}, {}, {}
    for c in cards:
        by_status[c["status"]] = by_status.get(c["status"], 0) + 1
        by_domain_cards[c["domain"]] = by_domain_cards.get(c["domain"], 0) + 1
        if c["track"]:
            by_track[c["track"]] = by_track.get(c["track"], 0) + 1
    by_role, by_kind, total_bytes = {}, {}, 0
    for a in artifacts:
        by_role[a["role"]] = by_role.get(a["role"], 0) + 1
        by_kind[a["kind"]] = by_kind.get(a["kind"], 0) + 1
        total_bytes += a["bytes"]
    days = sorted({str(e.get("ts", ""))[:10] for e in journal["entries"] if e.get("ts")})
    return {
        "config": cfg,
        "kb": {"entries": (global_g or {}).get("stats", {}).get("entries", 0),
               "relations": (global_g or {}).get("stats", {}).get("relations", 0),
               "domains": [{"name": k, "count": v} for k, v in sorted(domains.items(), key=lambda kv: (-kv[1], kv[0]))],
               "clusters": [{"name": k, "count": v} for k, v in sorted(clusters.items(), key=lambda kv: (-kv[1], kv[0]))]},
        "worldbook": wb.get("stats", {}),
        "chronicle": {"events": len(chronicle.get("events", [])),
                      "bands": len(chronicle.get("bands", [])),
                      "lanes": len(chronicle.get("lanes", [])),
                      "sources": [s.get("file", "") for s in chronicle.get("sources", [])],
                      **{k: v for k, v in (chronicle.get("stats") or {}).items()
                         if k in ("withTime", "withPlace", "withWhy", "withHow",
                                  "withDrift", "approxTime", "uncoveredPeople")}},
        "journal": {"events": len(journal["entries"]), "days": len(days),
                    "first": days[0] if days else "", "last": days[-1] if days else ""},
        "graph": {"nodes": len(graph_payload.get("nodes", [])), "links": len(graph_payload.get("links", [])),
                  "scope": graph_payload.get("scope", "none")},
        "cards": {"total": len(cards), "global": sum(1 for c in cards if c["source"] == "全局KB"),
                  "project": sum(1 for c in cards if c["source"] != "全局KB"),
                  "byStatus": by_status, "byDomain": by_domain_cards, "byTrack": by_track},
        "artifacts": {"total": len(artifacts), "human": by_role.get("human", 0),
                      "generated": by_role.get("generated", 0), "byKind": by_kind, "bytes": total_bytes},
        "reports": reports,
        "receipts": receipts,
        "sources": [
            {"name": "全局编译图 kit/hypergraph.rag.json", "ok": global_g is not None,
             "detail": disp_path(kit_root / "kit" / "hypergraph.rag.json", kit_root)},
            {"name": "项目编译图 kit/hypergraph.rag.json", "ok": bool(proj.joinpath("kit/hypergraph.rag.json").exists()),
             "detail": disp_path(proj / "kit" / "hypergraph.rag.json", proj.parent.parent)},
            {"name": "世界书卡片 世界书/**/*.md", "ok": bool(wb.get("entries")), "detail": f"{len(wb.get('entries', []))} 词条"},
            {"name": "大事记真相源 世界书/时间线.md｜编年/大事记.md", "ok": bool(chronicle.get("events")),
             "detail": "；".join(s.get("file", "") for s in chronicle.get("sources", [])) or "两个候选源都不存在"},
            {"name": "执行流水台账 journal.jsonl", "ok": bool(journal["entries"]), "detail": f"{len(journal['entries'])} 事件"},
            {"name": "产物索引 project-index.json", "ok": bool(artifacts), "detail": f"{len(artifacts)} 件"},
            {"name": "项目配置 项目配置.json", "ok": bool(cfg), "detail": disp_path(proj / "项目配置.json", proj.parent.parent)},
        ],
    }


def check_shape(d: dict) -> list:
    """看板 payload 形状校验（渲染前提，dashboard@1）。返回问题列表（空 = 通过）。"""
    problems = []
    if not isinstance(d, dict):
        return ["顶层必须是 JSON 对象"]
    if d.get("format") != "dashboard@1":
        problems.append(f'format 必须是 "dashboard@1"（现为 {d.get("format")!r}）')
    for k in REQUIRED_TOP:
        if k not in d:
            problems.append(f"缺必填顶层键: {k}")
    for key in ("zones", "cards", "artifacts"):
        if key in d and not isinstance(d[key], list):
            problems.append(f"{key} 必须是数组")
    if "worldbook" in d and not isinstance(d["worldbook"], dict):
        problems.append("worldbook 必须是对象")
    if "graph" in d and not isinstance(d["graph"], dict):
        problems.append("graph 必须是对象")
    return problems


def build_payload(root: Path, project: str | None, kit_root: Path | None = None) -> tuple[dict, Path]:
    """root = 数据根（项目父目录，--root）；kit_root = 全局语料/编译图所在根（--kit-root，缺省本仓根）。
    双根不合一（架构红线 2）：外部平铺项目根出板时，KB 板块与 RAG 图谱仍取 kit 仓的全局档。"""
    notices: list = []
    kit_root = (kit_root or root).resolve()
    proj = resolve_project(root, project or "")
    gp, global_g, _ = zone_graph(kit_root, proj, project, notices)
    wb = zone_worldbook(proj, notices)
    chronicle = zone_chronicle(proj, notices)
    journal = zone_journal(proj, notices)
    cards = zone_cards(kit_root, proj, project, notices)
    artifacts = zone_artifacts(proj, notices)
    overview = zone_overview(project, kit_root, proj, gp, wb, chronicle, journal, cards,
                             artifacts, global_g, notices)
    title = str((overview["config"] or {}).get("title") or project)
    payload = {
        "format": "dashboard@1",
        "project": project,
        "title": title,
        "zones": ["overview", "worldbook", "chronicle", "journal", "graph", "cards", "artifacts"],
        "overview": overview,
        "worldbook": wb,
        "chronicle": chronicle,
        "journal": journal,
        "graph": gp,
        "cards": cards,
        "artifacts": artifacts,
        "meta": {
            # 分发安全（W4.3）：页面一旦挂上公网，绝对路径＝白送本机目录结构与用户名。
            # 这三项一律给**相对/名称**形态——数据来自哪个根，使用者自己传的就是那个根，不需要页面替他记盘符。
            "project_dir": disp_path(proj, root),
            "root": root.name,
            "kit_root": kit_root.name,
            "counts": {"worldbook_entries": len(wb.get("entries", [])),
                       "chronicle_events": len(chronicle.get("events", [])),
                       "chronicle_lanes": len(chronicle.get("lanes", [])),
                       "journal_events": len(journal["entries"]),
                       "graph_nodes": len(gp.get("nodes", [])),
                       "graph_links": len(gp.get("links", [])),
                       "cards": len(cards),
                       "artifacts": len(artifacts)},
            "notices": sorted(set(notices)),
        },
    }
    return payload, proj


def render(payload: dict, title: str) -> str:
    template = TEMPLATE.read_text(encoding="utf-8")
    hits = external_hits(template)
    if hits:
        raise SystemExit(f"[ABORT] 模板含外部资源引用（零依赖红线）: {hits[:3]}")
    # </ 转义成 <\/：防止正文里的 </script> 提前闭合脚本块（JSON 语义不变）。
    body = json.dumps(payload, ensure_ascii=False, sort_keys=True).replace("</", "<\\/")
    return template.replace("__TITLE__", html.escape(title, quote=True)).replace("__DASHBOARD__", body)


def cmd_build(project: str, out: str | None, root_dir: str, title: str | None,
              kit_root_dir: str | None = None) -> int:
    root = Path(root_dir).resolve()
    if not TEMPLATE.exists():
        print(f"[ABORT] 模板缺失：{TEMPLATE}", file=sys.stderr)
        return 1
    proj = resolve_project(root, project)
    if not proj.is_dir():
        print(f"[ABORT] 项目目录不存在：{proj}（--root {root}；平铺外部项目根同 kit-compile 口径）", file=sys.stderr)
        return 1
    payload, proj = build_payload(root, project, Path(kit_root_dir or ROOT).resolve())
    problems = check_shape(payload)
    if problems:
        print("[ABORT] 看板 payload 形状不符（dashboard@1）：", file=sys.stderr)
        for p in problems:
            print(f"  ! {p}", file=sys.stderr)
        return 1
    page = render(payload, title or payload["title"] or project)
    hits = external_hits(page)
    if hits:
        print("[FAIL] 产物含外部资源引用（零依赖红线）:", file=sys.stderr)
        for h in hits:
            print(f"  ! {h}", file=sys.stderr)
        return 1
    leaks = abs_path_hits(page)
    dst = Path(out) if out else proj / "dashboard.html"
    dst = dst if dst.is_absolute() else root / dst
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text(page, encoding="utf-8")
    c = payload["meta"]["counts"]
    size_kb = dst.stat().st_size / 1024
    print(f"dashboard → {dst}（世界书 {c['worldbook_entries']} 词条 / 大事记 {c['chronicle_events']} 事件·"
          f"{c['chronicle_lanes']} 轨 / 执行流水 {c['journal_events']} 事件 / "
          f"图谱 {c['graph_nodes']} 节点·{c['graph_links']} 边 / 知识卡 {c['cards']} / 产物 {c['artifacts']} 件；"
          f"零外部资源引用；{size_kb:.0f} KB）")
    for n in payload["meta"]["notices"]:
        print(f"  · 提示：{n}")
    if leaks:
        print(f"  · 分发前自检：页面残留 {len(leaks)} 处本机绝对路径（多为项目配置/原文里的自述路径，工具不替作者改写）。"
              f"上传公网前先看一眼——{'、'.join(leaks[:3])}")
    return 0


# ────────────────────────────── 合成 fixture ──────────────────────────────

def synth_root(base: Path):
    """合成一个最小可出板的项目树（不碰真实项目数据，与 kb-graph-page selfcheck 同思路）。"""
    proj = base / "projects" / "p-selfcheck"
    (proj / "世界书" / "人物").mkdir(parents=True)
    (proj / "规则").mkdir(parents=True)
    (proj / "输入" / "正文").mkdir(parents=True)
    (base / "knowledge" / "craft").mkdir(parents=True)
    (base / "kit").mkdir(parents=True)
    (base / "knowledge" / "craft" / "hub.md").write_text(
        "---\n" + json.dumps({"id": "kb/craft/hub", "title": "枢纽卡", "domain": "craft",
                              "track": "结构", "status": "active", "version": "1.0.0",
                              "tags": ["测试", "枢纽"], "updated": "2026-10-12"}, ensure_ascii=False) +
        "\n---\n\n# 枢纽卡\n\n正文首段，够长才当选。\n", encoding="utf-8")
    (proj / "世界书" / "人物" / "甲.md").write_text(
        "---\nid: 人物甲\ntitle: 人物甲\nstatus: active\ntags: [枢纽]\nlinks: [设定]\n---\n\n# 人物甲\n\n甲的首段文字，够八字以上。\n",
        encoding="utf-8")
    (proj / "世界书" / "设定.md").write_text(
        "---\nid: 设定\ntitle: 设定\nstatus: draft\n---\n\n# 设定\n\n世界设定正文，提到 人物甲 三次：人物甲 人物甲。\n",
        encoding="utf-8")
    # 大事记 fixture：卡片侧给 lane（三级标题＋括号化名收编），时间线侧给 5W1H 真相源
    (proj / "世界书" / "人物.md").write_text(
        "# 人物\n\n## 主角侧\n\n"
        "### 阿明（主角，首现第1章）\n\n- 一句话：自检人物\n\n"
        "### 阿红（女主，化名“白小姐”）\n\n- 一句话：自检人物\n",
        encoding="utf-8")
    (proj / "世界书" / "时间线.md").write_text(
        "---\n{\"id\": \"pj/worldbook/时间线\", \"title\": \"时间线\"}\n---\n\n"
        "# 时间线 · 编年骨架\n\n> 自检编年，非真实项目。\n\n"
        "## 故事前史（倒叙层）\n\n"
        "- **约三年前**：老宅火灾，白小姐幸存，阿明自此避祸（第12章）。\n\n"
        "## 第一日 · 6月24日（第1-3章）\n\n"
        "- 阿明与阿红进城，〔因：避祸〕〔如何：搭货车〕〔何地：第六分部〕落脚（第1章）。\n\n"
        "- **16:50** 阿红单独复查丑屋（第2章）（Δ 与第7章口径冲突）。\n\n",
        encoding="utf-8")
    (proj / "规则" / "项目规则.md").write_text("# 项目规则\n\n无 frontmatter 的卡也要进表。\n", encoding="utf-8")
    (proj / "输入" / "正文" / "第1章.md").write_text("# 第1章 开局\n\n第一章正文首段，长度够。\n", encoding="utf-8")
    (proj / "项目配置.json").write_text(json.dumps(
        {"id": "p-selfcheck", "title": "自检项目", "flowId": None, "layout": "r6",
         "sessionBrief": ["合成 fixture，非真实项目"]}, ensure_ascii=False), encoding="utf-8")
    (proj / "journal.jsonl").write_text(
        json.dumps({"ts": "2026-10-12T10:00:00", "runId": "r1", "event": "node.start",
                    "nodeId": "m1.n1", "actor": "agent", "detail": "开工"}, ensure_ascii=False) + "\n" +
        "坏行不是JSON\n" + json.dumps({"ts": "2026-10-12T11:00:00", "event": "node.done",
                                       "nodeId": "m1.n1", "detail": "交稿"}, ensure_ascii=False) + "\n",
        encoding="utf-8")
    hg = {"format": "storyflow-hypergraph@1",
          "stats": {"entries": 2, "relations": 1, "clusters": [{"name": "簇#01[枢纽]", "size": 2}]},
          "entries": [
              {"id": "kb/craft/hub", "title": "枢纽卡", "domain": "craft", "path": "knowledge/craft/hub.md",
               "tags": [], "cluster": "簇#01[枢纽]"},
              {"id": "kb/craft/leaf", "title": "叶卡", "domain": "craft", "path": "knowledge/craft/leaf.md",
               "tags": [], "cluster": "簇#01[枢纽]"}],
          "relations": [{"from": "kb/craft/hub", "to": "kb/craft/leaf", "kind": "mention", "weight": 1}]}
    (base / "kit" / "hypergraph.rag.json").write_text(json.dumps(hg, ensure_ascii=False), encoding="utf-8")
    (proj / "kit").mkdir(parents=True, exist_ok=True)
    (proj / "kit" / "hypergraph.rag.json").write_text(json.dumps(
        {"format": "storyflow-hypergraph@1",
         "stats": {"entries": 1, "relations": 0, "scope": "project"},
         "entries": [{"id": "pj/世界书/人物甲", "title": "人物甲", "domain": "世界书",
                      "path": "世界书/人物/甲.md", "tags": []}],
         "relations": []}, ensure_ascii=False), encoding="utf-8")
    (proj / "registry").mkdir(parents=True, exist_ok=True)
    (proj / "project-index.json").write_text(json.dumps({
        "format": "project-index@1", "project_id": "p-selfcheck", "root_scope": "projects/p-selfcheck",
        "entries": [
            {"path": "输入/正文/第1章.md", "role": "human", "kind": "正文", "hash": "aabbccdd00112233",
             "mtime": "2026-10-12T00:00:00"},
            {"path": "世界书/设定.md", "role": "human", "kind": "设定", "hash": "11223344aabbccdd",
             "mtime": "2026-10-12T00:00:00"},
            {"path": "reports/diagnosis-第1章.md-20261012000000.0.json", "role": "generated", "kind": "报告",
             "hash": "55667788", "mtime": "2026-10-12T00:00:00"},
            {"path": "输入/正文/缺失件.md", "role": "human", "kind": "正文", "hash": "0000", "mtime": "-"}]},
        ensure_ascii=False), encoding="utf-8")
    (proj / "reports").mkdir(parents=True, exist_ok=True)
    (proj / "reports" / "diagnosis-第1章.md-20261012000000.0.json").write_text(json.dumps(
        {"format": "diagnosis-report@1", "project": "p-selfcheck", "target": "输入/正文/第1章.md",
         "engines": {"s": {"ran": True, "note": "S 相扫描"}}, "evidence": [{"location": "1:1"}],
         "items": [], "summary": "合成诊断报告：证据 1 条，条目 0 项",
         "receipt": "registry/receipts/diag-scan-selfcheck.json"}, ensure_ascii=False), encoding="utf-8")
    return base


def cmd_selfcheck() -> int:
    if not TEMPLATE.exists():
        print(f"[ABORT] 模板缺失：{TEMPLATE}", file=sys.stderr)
        return 1
    with tempfile.TemporaryDirectory() as td:
        root = synth_root(Path(td))
        payload = build_payload(root, "p-selfcheck")[0]
        problems = check_shape(payload)
        assert not problems, problems
        # 计数一致性（同一盘上输入派生，七区互查）：世界书词条数 = 世界书卡片数；
        # 知识表格行数 = 全局卡 + 项目卡（世界书/规则/文风，README 除外）；产物条数 = 索引件数
        assert payload["meta"]["counts"]["worldbook_entries"] == 4, payload["meta"]["counts"]
        assert payload["meta"]["counts"]["cards"] == 6, payload["meta"]["counts"]   # 1 全局 + 4 世界书 + 1 规则
        assert payload["meta"]["counts"]["journal_events"] == 2, "坏行应跳过后剩 2 事件"
        assert payload["journal"]["skipped"] == 1, "坏行计数须显式上报"
        # 大事记区（W4.6）：5W1H 多轨时间线派生自 时间线.md＋卡片 lane，**零丢弃**＝源 bullet 数 == 事件数
        ch = payload["chronicle"]
        src_bullets = sum(1 for ln in (root / payload["meta"]["project_dir"] / "世界书" / "时间线.md")
                          .read_text(encoding="utf-8").splitlines() if ln.strip().startswith("- "))
        assert len(ch["events"]) == src_bullets == 3, (len(ch["events"]), src_bullets)
        assert len(ch["bands"]) == 2 and ch["format"] == "chronicle@1", ch["bands"]
        lane_names = {l["name"] for l in ch["lanes"]}
        assert lane_names == {"阿明", "阿红"}, lane_names          # 化名「白小姐」收编进 阿红，不自成一轨
        assert ch["stats"]["withDrift"] == 1 and ch["stats"]["withTime"] == 2, ch["stats"]
        # uncoveredPeople 是**记账不是闸**：甲.md 那张卡（title 人物甲）在编德里一次没出现，
        # 必须被点名而不是静默沉底——作者据此决定是补条目还是删卡。
        assert ch["stats"]["uncoveredPeople"] == ["人物甲"], ch["stats"]
        ev_marks = [e for e in ch["events"] if e["why"]]
        assert len(ev_marks) == 1 and ev_marks[0]["why"] == "避祸" and \
            ev_marks[0]["where"] == ["第六分部"], ev_marks
        assert "〔因：避祸〕" not in ev_marks[0]["what"], "声明位须从正文剥掉，不重复计字"
        assert all(e["line"] > 0 and e["file"] for e in ch["events"]), "每事件带源定位（file:line）"
        assert payload["meta"]["counts"]["chronicle_events"] == 3
        assert payload["meta"]["counts"]["artifacts"] == 4, payload["meta"]["counts"]
        # 双根合并口径随图谱区进板：全局 2 + 项目 1 = 3 节点
        assert payload["meta"]["counts"]["graph_nodes"] == 3, payload["meta"]["counts"]
        # 幂等：同一输入两次渲染逐字节一致（无生成时刻）
        p1 = render(payload, "selfcheck")
        p2 = render(build_payload(root, "p-selfcheck")[0], "selfcheck")
        if p1 != p2:
            print("[FAIL] 幂等破坏：同一输入两次渲染不一致", file=sys.stderr)
            return 1
        hits = external_hits(p1)
        if hits:
            print("[FAIL] 产物含外部资源引用（零依赖红线）:", file=sys.stderr)
            for h in hits:
                print(f"  ! {h}", file=sys.stderr)
            return 1
        # 产物区红线：正文不内嵌（只有摘要），缺失件显式标出，归属计数与索引一致
        arts = {a["path"]: a for a in payload["artifacts"]}
        assert "输入/正文/第1章.md" in arts, arts.keys()
        assert "第一章正文首段" in arts["输入/正文/第1章.md"]["summary"]
        assert "第1章 开局" not in str(payload["cards"]), "产物正文绝不进内嵌 payload（见 W4.2 通道）"
        assert arts["输入/正文/缺失件.md"]["missing"] is True, "索引有、盘上无的件要显式标 missing 不静默"
        jrow = arts["reports/diagnosis-第1章.md-20261012000000.0.json"]
        assert jrow["mode"] == "meta-only" and jrow["summary"] == "", "JSON 件只给账不给首段（摘要是花括号）"
        assert payload["overview"]["artifacts"]["human"] == 3, payload["overview"]["artifacts"]
        assert payload["overview"]["artifacts"]["generated"] == 1, payload["overview"]["artifacts"]
        assert len(payload["overview"]["reports"]) == 1, payload["overview"]["reports"]
        # 缺源＝空区不是错（骨架期项目还没写编年属正常态），提示须点名候选路径。
        # 放在幂等复渲之后——此处改盘只为造「无时间线」形态，不能再回头比渲染。
        (root / payload["meta"]["project_dir"] / "世界书" / "时间线.md").unlink()
        again = build_payload(root, "p-selfcheck")[0]
        assert again["chronicle"]["events"] == [] and again["chronicle"]["bands"] == []
        assert any("大事记真相源不存在" in n for n in again["meta"]["notices"]), again["meta"]["notices"]
        assert again["meta"]["counts"]["journal_events"] == 2, "大事记缺席不影响执行流水区"
        assert check_shape(again) == [], check_shape(again)
        tmp = Path(td) / "dashboard-selfcheck.html"
        tmp.write_text(p1, encoding="utf-8")
        size = tmp.stat().st_size
    print(f"selfcheck OK：世界书 {payload['meta']['counts']['worldbook_entries']} 词条 / "
          f"知识卡 {payload['meta']['counts']['cards']} / 图谱节点 {payload['meta']['counts']['graph_nodes']} / "
          f"大事记 {len(ch['events'])} 事件·{len(ch['lanes'])} 轨·{len(ch['bands'])} 段带（源 bullet 逐条对齐，零丢弃）/ "
          f"执行流水 {payload['meta']['counts']['journal_events']} 事件（坏行跳过 1）；"
          f"缺源项目＝空区不报错；两次渲染逐字节一致，产物 {size} 字节，零外部资源引用")
    return 0


def main() -> int:
    # 本机控制台默认 GBK，中文输出会 UnicodeEncodeError（--print-payload 实测踩过）——统一转 UTF-8，
    # 无法重配置（管道已关等）时降级替换，不让打印本身把工具打死。
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:  # noqa: BLE001
            pass
    ap = argparse.ArgumentParser(description="项目看板聚合器：七区自包含 HTML（批次4 W4.1 + W4.6 大事记）")
    ap.add_argument("--project", help="项目 id（projects/<id>；--root 平铺时 <root>/<id>）")
    ap.add_argument("--root", default=str(ROOT), help="数据根：projects/ 父目录或外部平铺项目父目录（缺省本脚本上一级）")
    ap.add_argument("--kit-root", default=str(ROOT),
                    help="全局语料根：knowledge/ 与 kit/hypergraph.rag.json 所在（缺省本仓根；与 --root 分开＝双根不合一）")
    ap.add_argument("--out", help="输出 HTML 路径（缺省 projects/<id>/dashboard.html）")
    ap.add_argument("--title", help="页标题（缺省 项目配置.json 的 title）")
    ap.add_argument("--selfcheck", action="store_true", help="合成 fixture 全链自测（形状 + 幂等 + 零外部资源）")
    ap.add_argument("--print-payload", action="store_true", help="只打印 dashboard@1 payload JSON（排障/对账用，不写盘）")
    args = ap.parse_args()
    if args.selfcheck:
        return cmd_selfcheck()
    if not args.project:
        ap.error("需要 --project <id>（或 --selfcheck）")
        return 2
    root = Path(args.root).resolve()
    if args.print_payload:
        proj = resolve_project(root, args.project)
        if not proj.is_dir():
            print(f"[ABORT] 项目目录不存在：{proj}", file=sys.stderr)
            return 1
        payload, _ = build_payload(root, args.project, Path(args.kit_root).resolve())
        print(json.dumps(payload, ensure_ascii=False, sort_keys=True, indent=1))
        return 0
    return cmd_build(args.project, args.out, args.root, args.title, args.kit_root)


if __name__ == "__main__":
    sys.exit(main())
