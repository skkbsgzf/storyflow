"""dashboard · 项目看板聚合器（看板 v3：六图标五面板 + 配置抽屉，工单-20261013 用户定盘）

看板 v3 是**静态自包含 HTML 的整体替换**（模板全换，v2 七区不保留），布局规格唯一真相
见 docs/工单-20261013-看板v3规格.md。本工具只负责把数据采齐、脱敏、按 v3 键面出 payload：

  · 世界书/人物  ← projects/<id>/世界书/**/*.md 卡片（复用 tools/worldbook_index.py 归纳层，
                 文件即真相；built_at 字段丢弃——它是生成时刻，破幂等）。
                 人物档案 = entries 按 cat=="人物" 过滤（前端做，模板职责）。
  · 大事记      ← 世界书/时间线.md（或 世界书/编年/大事记.md）的人写叙事时间线，
                 复用 tools/chronicle.py 归纳器**在内存内**产出 chronicle@1（5W1H + 多轨 + 钻取）。
                 看板不写 chronicle.json——派生件由 chronicle.py 独占写；源 md 永不被本工具改写。
  · 大纲/文档   ← projects/<id>/project-index.json（project-index@1 的 role/kind/hash/mtime）
                 + md/txt 首段摘要；**正文不内嵌**（文档阅读在页内走 File System Access 只读直读盘上文件，
                 规格裁定 §8.3：只读，不支持编辑保存；v2 的写通道不入 v3）。
                 §3.3 的排除清单（诊断报告 / registry / 编译产物）由**前端**过滤。
  · config.models ← 项目配置.json 的模型类非敏感字段 + <kit-root>/.external/storyharness.json 的
                 provider/model 名。**脱敏红线：apiKey / secret / token / password 类字段整棵跳过，
                 绝不入 payload**——看板可挂公网分发（check_shape 里有全文断言兜底）。
  · config.logs   ← projects/<id>/journal.jsonl 尾部 ≤1000 条 → {time, level, msg}
                （level 由事件名派生：error/fail→ERROR、warn/retry/skip/timeout→WARN、其余 INFO）。
  · config.snapshots ← projects/<id>/snapshots/index.json 最近 ≤50 条（time/name/hash/node/round/file）；
                 文本快照在体积预算内内嵌内容（预览与「生成恢复补丁」用），现行版文本每文件只嵌一次。

工程范式与 tools/kb-graph-page.py / diagnosis-page.py 一致：
  · 零外部资源红线（ARCHITECTURE §9 不变量 6）：模板与产物 src/href/url()/@import 不得指 http(s):// 或 //host；
  · 幂等：页面**不携带生成时刻**，同一盘上输入重跑 sha256 逐字节一致（一切字段派生自盘上文件与稳定排序）；
  · 不回 call kit：数据生成时内联为惰性 JSON（</ 转义防提前闭合脚本）；
  · --selfcheck 合成 fixture 全链自测（形状校验 → 脱敏断言 → 幂等两遍渲染 → 计数一致 → 零外部资源断言）。

用法：
  python tools/dashboard.py --project <id> [--root <数据父目录>] [--kit-root <kit 仓根>] [--out <html>] [--title <标题>]
      输出缺省 projects/<id>/dashboard.html（--root 平铺回退同 kit-compile 口径：
      先看 <root>/projects/<id>，再看 <root>/<id>——外部平铺项目根可直接出板）
      双根口径（架构红线 2「双根不许合一」）：--root 只管项目数据，config.models 的 .external 全局档
      永远取 --kit-root（缺省本脚本所在仓根），所以外部根出板时模型配置照常齐全。
  python tools/dashboard.py --project <id> --print-payload   # 只出 dashboard@1 JSON（对账/排障，不写盘）
  python tools/dashboard.py --selfcheck

退出码：0 成功；1 项目/模板缺失 / 契约形状不符 / 脱敏断言失败 / 零外部资源断言失败；2 用法错误（argparse）。
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

REQUIRED_TOP = ("format", "project", "title", "zones", "worldbook",
                "chronicle", "artifacts", "config", "meta")

# 零外部资源红线（与 diagnosis-page / kb-graph-page 同表）：
# src/href 属性、CSS url()、@import 都不许指向 http(s):// 或协议相对 //host；锚点 # 与 xmlns 不在此列。
EXTERNAL_PATTERNS = (
    re.compile(r"""(?:src|href)\s*=\s*["']?(?:https?:)?//""", re.I),
    re.compile(r"""url\(\s*["']?(?:https?:)?//""", re.I),
    re.compile(r"""@import\s+(?:url\(\s*)?["']?(?:https?:)?//""", re.I),
)

# 产物区摘要只给文稿类（md/txt）；JSON/JSONL 只给字节与字符账（首段是花括号，摘要无意义）；
# doc/docx 等二进制只列元数据（文档阅读面板对二进制只读提示，转 md 走改稿套件）
SUMMARY_SUFFIXES = {".md", ".txt"}
META_SUFFIXES = {".json", ".jsonl"}
DOC_SUFFIXES = {".doc", ".docx", ".pdf", ".epub"}
SUMMARY_LIMIT = 140
SUMMARY_MAX_BYTES = 200_000   # 超大件不读正文（看板是索引不是镜像）

# ── v3 config 采集口径 ──
LOG_TAIL = 1000               # 日志只收 journal.jsonl 尾部 N 条（规格 §十性能边界）
SNAP_TAKE = 50                # 历史快照只收最近 N 条
SNAP_READ_MAX = 200_000       # 快照单文件读取上限（字节，同文档阈值）
SNAP_EMBED_CAP = 60_000       # 单条快照文本内嵌上限（字符）
SNAP_EMBED_TOTAL = 240_000    # 快照文本内嵌总预算（字符）——payload ≤500KB 的主力守门员

# 模型配置只收这些键的**标量值**（白名单，宁可少收）；命中敏感键名的子树整棵跳过。
MODEL_VALUE_KEYS = ("model", "provider", "apiBase", "baseUrl", "endpoint", "comfyuiBase",
                    "temperature", "maxTokens", "max_tokens", "topP", "cache", "messageTemplate",
                    "backend")
SECRET_KEY_RE = re.compile(r"key|secret|token|password|credential", re.I)
SECRET_VALUE_RE = re.compile(r"sk-[A-Za-z0-9_\-]{8,}")

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
    """数据源/提示里的展示串：**相对路径**，绝不写绝对路径。
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


# ────────────────────────────── 面板取数 ──────────────────────────────

def zone_worldbook(proj: Path, notices: list):
    """世界书区：复用 worldbook_index 归纳层（文件即真相）；built_at 丢弃保幂等。
    人物档案面板不单独采数——前端按 cat=="人物" 过滤同一份 entries。"""
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
             # 叙述层空态也要有人话（v3 页面不展示导语，但 payload 保留契约字段，排障有账可查）
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


def zone_artifacts(proj: Path, notices: list):
    """产物区（大纲/文档两面板共用的数据源）：project-index@1 清单 + md/txt 首段摘要；
    正文不内嵌（文档阅读走页内 File System Access 只读直读，规格裁定 §8.3）。
    §3.3 的排除清单（诊断报告/registry/编译产物）按裁定 3 由**前端**过滤，payload 给 human+generated 全量。"""
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
            row["note"] = "二进制文档只读；转 md 走改稿套件（python tools/export-doc.py）"
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
                row["summary"] = f"（{row['bytes']} 字节，超出看板阈值 {SUMMARY_MAX_BYTES}）"
        elif p.exists() and suffix in SUMMARY_SUFFIXES:
            row["summary"] = f"（{row['bytes']} 字节，超出看板摘要阈值 {SUMMARY_MAX_BYTES}）"
            row["mode"] = "meta-only"
        elif p.exists():
            row["mode"] = "readonly"
        rows.append(row)
    return sorted(rows, key=lambda r: r["path"])


# ── v3 新增：config 三件（models / logs / snapshots） ──

def _walk_model_rows(obj, path: str, source: str, rows: list):
    """递归收模型类非敏感标量。敏感键名（key/secret/token/password/credential）的子树整棵跳过——
    白名单 + 黑名单双闸，apiKey 类字段在采集口就进不了 payload。"""
    if isinstance(obj, dict):
        for k in sorted(obj, key=str):
            ks = str(k)
            if SECRET_KEY_RE.search(ks):
                continue
            p = f"{path}.{ks}" if path else ks
            v = obj[k]
            if ks in MODEL_VALUE_KEYS and isinstance(v, (str, int, float, bool)):
                rows.append({"name": p, "value": v, "source": source})
            else:
                _walk_model_rows(v, p, source, rows)
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            _walk_model_rows(v, f"{path}[{i}]", source, rows)


def zone_models(kit_root: Path, proj: Path, notices: list):
    """模型配置：项目配置.json 非敏感字段 + .external/storyharness.json 的 provider/model 名。
    只读展示面（v3 裁定：无编辑、无 apiKey）——行 = {name(json 路径), value, source(来源文件)}。"""
    rows: list = []
    cfg = load_json(proj / "项目配置.json")
    if isinstance(cfg, dict):
        _walk_model_rows(cfg, "", "项目配置.json", rows)
    ext = kit_root / ".external" / "storyharness.json"
    if ext.exists():
        d = load_json(ext)
        if isinstance(d, dict):
            _walk_model_rows(d, "", ".external/storyharness.json", rows)
    else:
        notices.append(f"运行时配置不存在（{disp_path(ext, kit_root)}）——模型配置只收项目侧字段")
    rows.sort(key=lambda r: (r["source"], r["name"]))
    return rows


def _log_level(event: str) -> str:
    s = (event or "").lower()
    if "error" in s or "fail" in s:
        return "ERROR"
    if "warn" in s or "retry" in s or "skip" in s or "timeout" in s:
        return "WARN"
    return "INFO"


def zone_logs(proj: Path, notices: list):
    """日志：journal.jsonl 尾部 ≤1000 条 → {time, level, msg}。
    level 由事件名派生（error/fail→ERROR、warn/retry/skip/timeout→WARN、其余 INFO）；
    msg = 事件 + 节点 + 详情，detail 非字符串时紧凑 JSON（键序固定，不破幂等）。保持文件序（append-only 时序）。"""
    src = proj / "journal.jsonl"
    if not src.exists():
        notices.append("执行台账不存在（projects/<id>/journal.jsonl）——日志面板为空态")
        return []
    jp = load_sibling_module("journal-page.py")
    events, skipped = jp.load_events(src)
    if skipped:
        notices.append(f"journal.jsonl 有 {skipped} 坏行跳过（只收合法 JSON 事件）")
    total = len(events)
    if total > LOG_TAIL:
        notices.append(f"执行台账共 {total} 条，日志面板只收尾部 {LOG_TAIL} 条（规格 §十）")
    rows = []
    for e in events[-LOG_TAIL:]:
        ev = str(e.get("event", ""))
        msg = ev + (f" {e.get('nodeId')}" if e.get("nodeId") else "")
        detail = e.get("detail")
        if isinstance(detail, str) and detail:
            msg += f" — {detail}"
        elif detail is not None:
            msg += " — " + json.dumps(detail, ensure_ascii=False, sort_keys=True)
        rows.append({"time": str(e.get("ts", "")), "level": _log_level(ev), "msg": msg})
    return rows


def zone_snapshots(proj: Path, notices: list):
    """历史快照：snapshots/index.json 最近 ≤50 条（时间倒序，同刻按 node/round/file 稳定序）。
    文本快照在预算内内嵌内容（页内预览 + 生成恢复补丁用）；现行版文本每文件只嵌最近一条，
    页面跨轮复用同一份现行版做 diff。占位登记（hash/path 为 null）显式跳过，不入账。"""
    idx_path = proj / "snapshots" / "index.json"
    if not idx_path.exists():
        notices.append("无快照索引（projects/<id>/snapshots/index.json）——历史快照面板为空态")
        return []
    idx = load_json(idx_path)
    snaps = idx.get("snapshots") if isinstance(idx, dict) else None
    if not isinstance(snaps, dict):
        return []
    rows = []
    placeholders = 0
    for node in sorted(snaps, key=str):
        entries = snaps[node]
        if not isinstance(entries, list):
            continue
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            files = entry.get("files") or {}
            if not isinstance(files, dict):
                continue
            for fname in sorted(files, key=str):
                meta = files.get(fname) or {}
                if not isinstance(meta, dict) or not meta.get("path"):
                    placeholders += 1  # 占位登记（尚无内容）：显式记账，不静默丢
                    continue
                rows.append({"time": str(entry.get("ts", "")), "name": f"{node} · {fname}",
                             "node": str(node), "round": entry.get("round", 0), "file": fname,
                             "hash": str(meta.get("hash") or ""), "path": str(meta.get("path")),
                             "binary": bool(meta.get("binary")), "note": str(entry.get("note") or ""),
                             "text": "", "cur": "", "truncated": False, "curTruncated": False})
    if not rows:
        if placeholders:
            notices.append(f"快照索引只有 {placeholders} 条占位登记（尚无内容），无可用快照")
        return []
    if placeholders:
        notices.append(f"快照占位登记 {placeholders} 条（尚无内容）不入账")
    if len(rows) > SNAP_TAKE:
        notices.append(f"快照共 {len(rows)} 条，只收最近 {SNAP_TAKE} 条（规格 §十）")
    # 时间倒序（两次排序叠加：先 node/round/file 升序，再按 time 稳定倒序——同刻保持前者相对序）
    rows.sort(key=lambda r: (r["node"], r["round"], r["file"]))
    rows.sort(key=lambda r: r["time"], reverse=True)
    rows = rows[:SNAP_TAKE]
    # 内容内嵌（预算内）：快照文本逐条；现行版文本每文件只嵌一次（页面跨轮复用）
    budget = SNAP_EMBED_TOTAL
    cur_done: set = set()
    for r in rows:
        if r["binary"] or budget <= 0:
            continue
        try:
            sp = proj / r["path"]
            if sp.exists() and sp.stat().st_size <= SNAP_READ_MAX:
                t = sp.read_text(encoding="utf-8")
                r["text"] = t[:SNAP_EMBED_CAP]
                r["truncated"] = len(t) > SNAP_EMBED_CAP
                budget -= len(r["text"])
        except Exception:  # noqa: BLE001 读不出内容＝只给元数据，不崩板
            pass
        if r["file"] not in cur_done:
            try:
                cp = proj / r["file"]
                if cp.exists() and cp.stat().st_size <= SNAP_READ_MAX:
                    t = cp.read_text(encoding="utf-8")
                    r["cur"] = t[:SNAP_EMBED_CAP]
                    r["curTruncated"] = len(t) > SNAP_EMBED_CAP
                    budget -= len(r["cur"])
                    cur_done.add(r["file"])
            except Exception:  # noqa: BLE001
                pass
    return rows


# ────────────────────────────── payload 组装与校验 ──────────────────────────────

def check_shape(d: dict) -> list:
    """看板 v3 payload 形状校验（渲染前提，dashboard@1 + meta.layout_version="3"）。
    兼带**脱敏断言**：payload 全文不得出现 sk- 形态密钥串；config.models 行名不得命中敏感键名。
    返回问题列表（空 = 通过）。"""
    problems = []
    if not isinstance(d, dict):
        return ["顶层必须是 JSON 对象"]
    if d.get("format") != "dashboard@1":
        problems.append(f'format 必须是 "dashboard@1"（现为 {d.get("format")!r}）')
    if str((d.get("meta") or {}).get("layout_version")) != "3":
        problems.append('meta.layout_version 必须是 "3"（看板 v3）')
    for k in REQUIRED_TOP:
        if k not in d:
            problems.append(f"缺必填顶层键: {k}")
    for key in ("zones", "artifacts"):
        if key in d and not isinstance(d[key], list):
            problems.append(f"{key} 必须是数组")
    if "worldbook" in d:
        if not isinstance(d["worldbook"], dict):
            problems.append("worldbook 必须是对象")
        else:
            for k in ("entries", "relations"):
                if not isinstance(d["worldbook"].get(k), list):
                    problems.append(f"worldbook.{k} 必须是数组")
    if "chronicle" in d:
        if not isinstance(d["chronicle"], dict):
            problems.append("chronicle 必须是对象")
        else:
            for k in ("events", "lanes"):
                if not isinstance(d["chronicle"].get(k), list):
                    problems.append(f"chronicle.{k} 必须是数组")
    cfg = d.get("config")
    if "config" in d:
        if not isinstance(cfg, dict):
            problems.append("config 必须是对象")
        else:
            for k in ("models", "logs", "snapshots"):
                if not isinstance(cfg.get(k), list):
                    problems.append(f"config.{k} 必须是数组")
            for r in cfg.get("models") or []:
                if not isinstance(r, dict) or not {"name", "value", "source"} <= set(r):
                    problems.append(f"config.models 行必须是 {{name,value,source}}：{r!r}"[:120])
                elif SECRET_KEY_RE.search(str(r.get("name", ""))):
                    problems.append(f"config.models 行名命中敏感键名：{r.get('name')!r}")
            for r in cfg.get("logs") or []:
                if not isinstance(r, dict) or set(r) - {"time", "level", "msg"} or not {"time", "level", "msg"} <= set(r):
                    problems.append(f"config.logs 行键面必须恰为 {{time,level,msg}}：{r!r}"[:120])
                elif r.get("level") not in ("INFO", "WARN", "ERROR"):
                    problems.append(f"config.logs.level 必须是 INFO/WARN/ERROR：{r.get('level')!r}")
            for r in cfg.get("snapshots") or []:
                if not isinstance(r, dict) or not {"time", "name", "hash"} <= set(r):
                    problems.append(f"config.snapshots 行必须含 {{time,name,hash}}：{r!r}"[:120])
    # 脱敏断言（payload 全文）：sk- 形态密钥串零容忍——看板可公网分发，这是分发安全的机器闸。
    full = json.dumps(d, ensure_ascii=False, sort_keys=True)
    m = SECRET_VALUE_RE.search(full)
    if m:
        problems.append(f"payload 全文命中 sk- 形态密钥串（脱敏红线）：{m.group(0)[:16]}…")
    if '"apiKey"' in full or "'apiKey'" in full:
        problems.append('payload 全文出现 "apiKey" 键名（脱敏红线）')
    return problems


def build_payload(root: Path, project: str | None, kit_root: Path | None = None) -> tuple[dict, Path]:
    """root = 数据根（项目父目录，--root）；kit_root = 全局配置/语料所在根（--kit-root，缺省本仓根）。
    双根不合一（架构红线 2）：外部平铺项目根出板时，.external 模型档仍取 kit 仓根。"""
    notices: list = []
    kit_root = (kit_root or root).resolve()
    proj = resolve_project(root, project or "")
    wb = zone_worldbook(proj, notices)
    chronicle = zone_chronicle(proj, notices)
    artifacts = zone_artifacts(proj, notices)
    models = zone_models(kit_root, proj, notices)
    logs = zone_logs(proj, notices)
    snapshots = zone_snapshots(proj, notices)
    cfg_raw = load_json(proj / "项目配置.json") or {}
    title = str(cfg_raw.get("title") or project)
    payload = {
        "format": "dashboard@1",
        "project": project,
        "title": title,
        "zones": ["worldbook", "chronicle", "artifacts", "config"],
        "worldbook": wb,
        "chronicle": chronicle,
        "artifacts": artifacts,
        "config": {"models": models, "logs": logs, "snapshots": snapshots},
        "meta": {
            "layout_version": "3",
            # 分发安全（W4.3）：页面一旦挂上公网，绝对路径＝白送本机目录结构与用户名。
            # 这三项一律给**相对/名称**形态——数据来自哪个根，使用者自己传的就是那个根，不需要页面替他记盘符。
            "project_dir": disp_path(proj, root),
            "root": root.name,
            "kit_root": kit_root.name,
            "counts": {"worldbook_entries": len(wb.get("entries", [])),
                       "worldbook_relations": len(wb.get("relations", [])),
                       "chronicle_events": len(chronicle.get("events", [])),
                       "chronicle_lanes": len(chronicle.get("lanes", [])),
                       "artifacts": len(artifacts),
                       "models": len(models),
                       "logs": len(logs),
                       "snapshots": len(snapshots)},
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
        print("[ABORT] 看板 payload 形状/脱敏校验不符（dashboard@1 v3）：", file=sys.stderr)
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
    budget = "≤500KB 预算内" if dst.stat().st_size <= 500 * 1024 else "⚠ 超 500KB 预算（规格 §十）"
    print(f"dashboard v3 → {dst}（世界书 {c['worldbook_entries']} 词条·{c['worldbook_relations']} 边 / "
          f"大事记 {c['chronicle_events']} 事件·{c['chronicle_lanes']} 轨 / 产物 {c['artifacts']} 件 / "
          f"模型 {c['models']} 项 / 日志 {c['logs']} 条 / 快照 {c['snapshots']} 条；"
          f"零外部资源引用；{size_kb:.0f} KB，{budget}）")
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
    (proj / "snapshots").mkdir(parents=True)
    (base / ".external").mkdir(parents=True)
    (base / "kit").mkdir(parents=True)
    (proj / "世界书" / "人物" / "甲.md").write_text(
        "---\nid: 人物甲\ntitle: 人物甲\nstatus: active\ntags: [枢纽]\nlinks: [设定]\n---\n\n# 人物甲\n\n甲的首段文字，够八字以上。\n",
        encoding="utf-8")
    (proj / "世界书" / "人物" / "阿明.md").write_text(
        "---\nid: 阿明\ntitle: 阿明\nstatus: active\ntags: [主角]\nlinks: [设定]\n---\n\n# 阿明\n\n阿明的首段文字，够八字以上。\n",
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
    ch1 = "# 第1章 开局\n\n第一章正文首段，长度够。现行版内容，供快照补丁比对。\n"
    (proj / "输入" / "正文" / "第1章.md").write_text(ch1, encoding="utf-8")
    (proj / "项目配置.json").write_text(json.dumps(
        {"id": "p-selfcheck", "title": "自检项目", "flowId": None, "layout": "r6",
         "model": "pj-model-x", "provider": "pj-provider",
         "sessionBrief": ["合成 fixture，非真实项目"]}, ensure_ascii=False), encoding="utf-8")
    # .external 运行时配置（带真形 apiKey——payload 必须脱到一字不剩，selfcheck 逐字断言）
    (base / ".external" / "storyharness.json").write_text(json.dumps(
        {"project": "p-selfcheck", "provider": "zai", "model": "glm-5.3-flash",
         "apiKey": "sk-selfcheck-deadbeef0001",
         "extensions": {"deduce": {"provider": "zai", "model": "glm-5.3"}}}, ensure_ascii=False),
        encoding="utf-8")
    # journal 台账：含一条 error 事件（日志面板的 ERROR 级来源）＋一行坏行
    (proj / "journal.jsonl").write_text(
        json.dumps({"ts": "2026-10-12T10:00:00", "runId": "r1", "event": "node.start",
                    "nodeId": "m1.n1", "actor": "agent", "detail": "开工"}, ensure_ascii=False) + "\n" +
        "坏行不是JSON\n" +
        json.dumps({"ts": "2026-10-12T10:30:00", "runId": "r1", "event": "node.error",
                    "nodeId": "m1.n1", "detail": "扫描中断"}, ensure_ascii=False) + "\n" +
        json.dumps({"ts": "2026-10-12T11:00:00", "event": "node.done",
                    "nodeId": "m1.n1", "detail": "交稿"}, ensure_ascii=False) + "\n",
        encoding="utf-8")
    # 快照索引：两轮 + 一条占位登记（hash/path 为 null，显式不入账）
    (proj / "snapshots" / "index.json").write_text(json.dumps({
        "snapshots": {"m1": [
            {"round": 1, "ts": "2026-10-12 09:00", "note": "首拍",
             "files": {"输入/正文/第1章.md": {"hash": "aaaa11112222",
                                              "path": "snapshots/m1/r1/输入/正文/第1章.md"}}},
            {"round": 2, "ts": "2026-10-12 10:00", "note": "改后",
             "files": {"输入/正文/第1章.md": {"hash": "bbbb33334444",
                                              "path": "snapshots/m1/r2/输入/正文/第1章.md"},
                       "输入/正文/缺拍.md": {"hash": None, "path": None}}}]},
        "inputs": {}}, ensure_ascii=False), encoding="utf-8")
    for rnd, body in ((1, "# 第1章 开局\n\n第一拍快照内容，长度够。\n"),
                      (2, "# 第1章 开局\n\n第二拍快照内容，长度够。\n")):
        d = proj / "snapshots" / "m1" / f"r{rnd}" / "输入" / "正文"
        d.mkdir(parents=True, exist_ok=True)
        (d / "第1章.md").write_text(body, encoding="utf-8")
    hg = {"format": "storyflow-hypergraph@1",
          "stats": {"entries": 1, "relations": 0},
          "entries": [{"id": "kb/craft/hub", "title": "枢纽卡", "domain": "craft",
                       "path": "knowledge/craft/hub.md", "tags": []}],
          "relations": []}
    (base / "kit" / "hypergraph.rag.json").write_text(json.dumps(hg, ensure_ascii=False), encoding="utf-8")
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
        c = payload["meta"]["counts"]
        # 世界书：词条数 = 盘上卡片数（人物/甲 + 人物/阿明 + 设定 + 人物 + 时间线）；人物卡 = cat 过滤口径
        assert c["worldbook_entries"] == 5, c
        people = [e for e in payload["worldbook"]["entries"] if e.get("cat") == "人物"]
        assert sorted(e["title"] for e in people) == ["人物甲", "阿明"], people
        # 大事记：5W1H 多轨时间线派生自 时间线.md＋卡片 lane，零丢弃＝源 bullet 数 == 事件数
        ch = payload["chronicle"]
        src_bullets = sum(1 for ln in (root / payload["meta"]["project_dir"] / "世界书" / "时间线.md")
                          .read_text(encoding="utf-8").splitlines() if ln.strip().startswith("- "))
        assert len(ch["events"]) == src_bullets == 3, (len(ch["events"]), src_bullets)
        assert len(ch["bands"]) == 2 and ch["format"] == "chronicle@1", ch["bands"]
        assert {l["name"] for l in ch["lanes"]} == {"阿明", "阿红"}, ch["lanes"]
        assert ch["stats"]["withDrift"] == 1 and ch["stats"]["withTime"] == 2, ch["stats"]
        assert ch["stats"]["uncoveredPeople"] == ["人物甲"], ch["stats"]
        assert all(e["line"] > 0 and e["file"] for e in ch["events"]), "每事件带源定位（file:line）"
        assert c["chronicle_events"] == 3 and c["chronicle_lanes"] == 2, c
        # 产物区红线：正文不内嵌（只有摘要），缺失件显式标出，归属计数与索引一致
        arts = {a["path"]: a for a in payload["artifacts"]}
        assert len(arts) == 4 and c["artifacts"] == 4, c
        assert "第一章正文首段" in arts["输入/正文/第1章.md"]["summary"]
        assert arts["输入/正文/缺失件.md"]["missing"] is True, "索引有、盘上无的件要显式标 missing 不静默"
        # 模型配置：两来源齐收；apiKey 一字不漏（脱敏红线——selfcheck 里埋了真形 key 逐字断言）
        models = payload["config"]["models"]
        by_src = {}
        for r in models:
            by_src.setdefault(r["source"], []).append(r["name"])
        assert "项目配置.json" in by_src and "model" in by_src["项目配置.json"], by_src
        assert ".external/storyharness.json" in by_src, by_src
        assert "extensions.deduce.model" in by_src[".external/storyharness.json"], by_src
        assert not any(__import__("re").search(r"key|secret|token|password|credential", r["name"], re.I)
                       for r in models), models
        ptext = json.dumps(payload, ensure_ascii=False, sort_keys=True)
        assert "sk-selfcheck-deadbeef0001" not in ptext, "apiKey 值泄漏进 payload"
        assert "apiKey" not in ptext, "apiKey 键名泄漏进 payload"
        # 日志：尾部截取 + level 派生 + 键面恰为 {time,level,msg}；坏行不静默（notices 记账）
        logs = payload["config"]["logs"]
        assert len(logs) == 3, logs
        assert all(set(r) == {"time", "level", "msg"} for r in logs), logs
        assert any(r["level"] == "ERROR" and "扫描中断" in r["msg"] for r in logs), logs
        assert logs[0]["time"] == "2026-10-12T10:00:00", "日志保持文件序（append-only 时序）"
        assert any("坏行" in n for n in payload["meta"]["notices"]), payload["meta"]["notices"]
        # 快照：时间倒序、占位登记不入账、内容内嵌（最新轮带现行版文本供补丁）
        snaps = payload["config"]["snapshots"]
        assert [s["round"] for s in snaps] == [2, 1], snaps
        assert all(s["name"].startswith("m1 · ") for s in snaps), snaps
        assert snaps[0]["text"].startswith("# 第1章 开局") and "第二拍" in snaps[0]["text"], snaps[0]
        ch1_disk = (root / payload["meta"]["project_dir"] / "输入" / "正文" / "第1章.md").read_text(encoding="utf-8")
        assert snaps[0]["cur"] == ch1_disk, "现行版文本须逐字等于盘上文件"
        assert snaps[1].get("cur") in ("", None) or snaps[1]["cur"] == snaps[0]["cur"], "现行版每文件只嵌一次"
        assert all("缺拍" not in s["name"] for s in snaps), "占位登记（无 path）不入账"
        # 脱敏断言的反向题：坏 payload 必须被 check_shape 拦下
        import copy
        bad = copy.deepcopy(payload)
        bad["config"]["models"].append({"name": "apiKey", "value": "x", "source": "项目配置.json"})
        assert any("敏感键名" in p for p in check_shape(bad)), check_shape(bad)
        bad2 = copy.deepcopy(payload)
        bad2["config"]["models"][0]["value"] = "sk-abc12345defg"
        assert any("sk-" in p for p in check_shape(bad2)), check_shape(bad2)
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
        assert len(p1.encode("utf-8")) <= 500 * 1024, "payload 预算（规格 §十）"
        # 缺源＝空区不是错（骨架期项目还没写编年属正常态），提示须点名候选路径。
        # 放在幂等复渲之后——此处改盘只为造「无时间线」形态，不能再回头比渲染。
        (root / payload["meta"]["project_dir"] / "世界书" / "时间线.md").unlink()
        again = build_payload(root, "p-selfcheck")[0]
        assert again["chronicle"]["events"] == [] and again["chronicle"]["bands"] == []
        assert any("大事记真相源不存在" in n for n in again["meta"]["notices"]), again["meta"]["notices"]
        assert again["config"]["logs"], "大事记缺席不影响日志面板"
        assert check_shape(again) == [], check_shape(again)
        size = len(p1.encode("utf-8"))
    print(f"selfcheck OK：世界书 {c['worldbook_entries']} 词条（人物卡 {len(people)}）/ "
          f"大事记 {len(ch['events'])} 事件·{len(ch['lanes'])} 轨·{len(ch['bands'])} 段带（源 bullet 逐条对齐，零丢弃）/ "
          f"产物 {c['artifacts']} 件 / 模型 {len(models)} 项（apiKey 逐字脱敏＋反向题拦截）/ "
          f"日志 {len(logs)} 条（ERROR 级派生＋坏行记账）/ 快照 {len(snaps)} 条（时间倒序＋占位不入账）；"
          f"缺源项目＝空区不报错；两次渲染逐字节一致，产物 {size} 字节（≤500KB），零外部资源引用")
    return 0


def main() -> int:
    # 本机控制台默认 GBK，中文输出会 UnicodeEncodeError（--print-payload 实测踩过）——统一转 UTF-8，
    # 无法重配置（管道已关等）时降级替换，不让打印本身把工具打死。
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:  # noqa: BLE001
            pass
    ap = argparse.ArgumentParser(description="项目看板聚合器：六面板+配置抽屉自包含 HTML（看板 v3）")
    ap.add_argument("--project", help="项目 id（projects/<id>；--root 平铺时 <root>/<id>）")
    ap.add_argument("--root", default=str(ROOT), help="数据根：projects/ 父目录或外部平铺项目父目录（缺省本脚本上一级）")
    ap.add_argument("--kit-root", default=str(ROOT),
                    help="全局配置根：.external/ 与全局语料所在（缺省本仓根；与 --root 分开＝双根不合一）")
    ap.add_argument("--out", help="输出 HTML 路径（缺省 projects/<id>/dashboard.html）")
    ap.add_argument("--title", help="页标题（缺省 项目配置.json 的 title）")
    ap.add_argument("--selfcheck", action="store_true", help="合成 fixture 全链自测（形状+脱敏+幂等+零外部资源）")
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
