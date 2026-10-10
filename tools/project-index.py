#!/usr/bin/env python3
"""project-index · 项目文件索引（project-index@1）：路径探索 → 索引 → 增量更新 → 会话记忆卡。

「一份报告说清项目数据根里每个文件是谁的、能不能动」。契约：contracts/project-index.schema.json
（R2.1 先行，本工具是 R2.2 的实现）。双根铁律：索引只描述数据根 projects/<id>/，
root_scope 永不指向 repoRoot；本工具对 projects/<id>/ 之外零写入。

子命令：
  build  <projectId> [--dir projects] [--all]
      全量探索 projects/<id>/，生成/重建 project-index.json（写入前过内置 schema 校验，
      校验不过宁失败退出也不落盘）。若存量索引在场，hybrid 升格记录会被继承（角色首标一次、增量维护）。
  diff   <projectId> [--dir projects] [--all] [--dry-run] [--receipt [路径]]
      与存量索引比对 hash+mtime → 三态清单（新增/变更/失踪）：
        - generated 条目与盘上不一致（mtime 变 + hash 变）⇒ 升格 hybrid，notes 注明「疑似手改」；
        - mtime 变但 hash 同 ⇒ 只刷新 mtime（内容没动，只是被 touch）；
        - human 条目变更 = 正常业务，只记账不裁决，工具永不全量覆盖/写回人写文件；
        - 失踪条目从索引移除（报告与收据留痕）。
      默认把增量写回索引（--dry-run 只报不写）；--receipt 落收据 json（缺省
      registry/receipts/project-index-diff-<时间戳>.json）——报数附收据纪律。
  memory <projectId> [--session <sid>] [--dir projects] [--sessions-dir 内部/sessions]
      会话 JSONL → 世界书/记忆卡-<sid>.md（人机双读）。frontmatter 带
      session_id/turns/updated/source；正文 = 确定性抽取的逐轮摘要行
      （用户输入首句 / 事件时间戳 / 轮序），不编内容、不取助手正文。
      记忆卡是派生物（非人类原文），已存在则按 session 整卡重建；零轮会话跳过并点名。
      重建后建议重跑 build 刷新索引行（重建会覆盖手改——记忆卡口径是可重建派生物）。

角色标注规则（首标一次，diff 增量维护）：
  generated（工具产物，可按源重建）：
    - kit/**                    项目级 RAG 编译产物（tools/kit-compile.py --project）
    - 世界书/graph.json          世界书索引（tools/worldbook-index.py 重建）
    - 世界书/记忆卡-*.md         本工具 memory 子命令的派生物
    - state.json / journal.jsonl / worldbook.html   内核状态 / 台账 / 查看层
    - 项目配置.json              init 骨架（手改会被 diff 升格 hybrid，不丢痕迹）
    - 交付/**                   定序交付出口 = 产物区
    - 内部/**（机器区子目录除外） agent 过程稿（意见/依据/稿本）
    - 根目录散落 *.md            executor 落盘稿
  human（人写，工具只读不覆写）：
    - 输入/**
    - 世界书/**（上面三类 generated 除外）

机器区排除（默认从索引纳管中剔除；--all 全量纳管）：
  registry/（含 registry/receipts/）、snapshots/、kit/、内部/sessions/、内部/telemetry/、
  内部/backup/、内部/收据/。project-index.json 自身任何模式下都不入表（自引用）。

用法：
  python tools/project-index.py <build|diff|memory> <projectId> [选项]
退出码：成功 0；拒绝/失败 1。
"""
import hashlib
import json
import re
import sys
import time
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FORMAT = "project-index@1"
GENERATOR = "tools/project-index.py@1.0.0"

# 机器区前缀（相对项目根的 posix 目录；默认不入索引，--all 解除）
MACHINE_DIRS = (
    "registry", "snapshots", "kit",
    "内部/sessions", "内部/telemetry", "内部/backup", "内部/收据",
)
INDEX_NAME = "project-index.json"

# 首标角色规则：generated 优先命中，其余按目录归 human
GENERATED_EXACT = {"世界书/graph.json", "state.json", "journal.jsonl", "worldbook.html", "项目配置.json"}


def fail(msg: str) -> int:
    print(f"[ABORT] {msg}")
    return 1


def parse_argv(argv: list[str]) -> dict:
    """极简旗标解析：--key value / --key 布尔；未知旗标报错（宁可显式失败）。"""
    out: dict = {"flags": {}, "args": []}
    known_bool = {"--all", "--dry-run", "--receipt"}
    known_val = {"--dir", "--session", "--sessions-dir"}
    i = 0
    while i < len(argv):
        a = argv[i]
        if a in known_bool:
            # --receipt 可带值也可不带（不带 = 收据落缺省路径）
            nxt = argv[i + 1] if i + 1 < len(argv) else None
            if a == "--receipt" and nxt and not nxt.startswith("--"):
                out["flags"][a] = nxt
                i += 2
            else:
                out["flags"][a] = True
                i += 1
        elif a in known_val:
            if i + 1 >= len(argv):
                raise SystemExit(f"[ABORT] {a} 缺值")
            out["flags"][a] = argv[i + 1]
            i += 2
        elif a.startswith("--"):
            raise SystemExit(f"[ABORT] 未知旗标：{a}")
        else:
            out["args"].append(a)
            i += 1
    return out


def proj_dir(pid: str, base: Path) -> Path:
    if not pid or "/" in pid or "\\" in pid or pid in (".", ".."):
        raise SystemExit(f"[ABORT] 非法项目 id：{pid!r}")
    p = base / pid
    if not p.is_dir():
        raise SystemExit(f"[ABORT] 项目目录不存在：{p}")
    return p


def to_posix(p: Path) -> str:
    return p.as_posix()


def sha16(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()[:16]


def mtime_iso(p: Path) -> str:
    return datetime.fromtimestamp(p.stat().st_mtime).isoformat(timespec="seconds")


def is_machine(rel: str) -> bool:
    parts = rel.split("/")
    for d in MACHINE_DIRS:
        dp = d.split("/")
        if parts[: len(dp)] == dp:
            return True
    return False


def role_of(rel: str) -> str:
    """首标角色：generated 命中表 → generated；输入/世界书人写区 → human；其余默认 generated（产物区口径）。"""
    if rel in GENERATED_EXACT:
        return "generated"
    if re.fullmatch(r"世界书/记忆卡-[^/]+\.md", rel):
        return "generated"
    if rel.startswith("kit/"):
        return "generated"
    if rel.startswith("输入/") or rel.startswith("世界书/"):
        return "human"
    if rel.startswith("交付/"):
        return "generated"
    if rel.startswith("内部/"):
        return "generated"
    if rel.endswith(".md") and "/" not in rel:
        return "generated"  # 根目录散落 md = executor 落盘稿
    return "generated"


def kind_of(rel: str) -> str:
    """人读语义标签（schema entry.kind）。"""
    if re.fullmatch(r"世界书/记忆卡-[^/]+\.md", rel):
        return "记忆卡"
    if rel == "世界书/graph.json":
        return "世界书索引"
    if rel.startswith("输入/"):
        return "素材"
    if rel.startswith("交付/"):
        return "交付"
    if rel.startswith("内部/sessions/"):
        return "会话"
    if "收据" in rel:
        return "收据"
    if rel == "state.json":
        return "状态"
    if rel == "journal.jsonl":
        return "台账"
    if rel == "项目配置.json":
        return "配置"
    if rel.startswith("世界书/"):
        return "设定"
    if rel.endswith(".md"):
        return "文档"
    return "文件"


def scan_entries(proj: Path, include_machine: bool) -> list[dict]:
    """探索项目根 → entry 列表（按 path 排序）。project-index.json 自身永不入表。"""
    entries = []
    for p in sorted(proj.rglob("*")):
        if not p.is_file():
            continue
        rel = to_posix(p.relative_to(proj))
        if rel == INDEX_NAME:
            continue
        if not include_machine and is_machine(rel):
            continue
        e: dict = {"path": rel, "role": role_of(rel), "kind": kind_of(rel)}
        if e["role"] == "generated" and rel.startswith("kit/"):
            e["notes"] = "项目级 RAG 编译产物（tools/kit-compile.py --project）"
        elif e["role"] == "generated" and re.fullmatch(r"世界书/记忆卡-[^/]+\.md", rel):
            e["notes"] = "会话记忆卡（tools/project-index.py memory 的派生物，可重建）"
        e["hash"] = sha16(p)
        e["mtime"] = mtime_iso(p)
        entries.append(e)
    return entries


def load_old(proj: Path) -> dict | None:
    f = proj / INDEX_NAME
    if not f.is_file():
        return None
    try:
        return json.loads(f.read_text(encoding="utf-8"))
    except Exception as exc:
        raise SystemExit(f"[ABORT] 存量索引损坏（拒绝在其上增量，请删后重建）：{f} · {exc}")


def validate_index(doc: dict, pid: str) -> None:
    """对照 contracts/project-index.schema.json 的硬约束自检；不过 = 拒绝落盘（宁可失败不写坏）。"""
    errs: list[str] = []
    if doc.get("format") != FORMAT:
        errs.append(f"format 必须 = {FORMAT}")
    for k in ("project_id", "generated_at", "generator", "root_scope", "entries", "stats"):
        if k not in doc:
            errs.append(f"缺必填顶层键：{k}")
    if doc.get("project_id") != pid:
        errs.append("project_id 与项目目录名不一致")
    if doc.get("root_scope") != f"projects/{pid}":
        errs.append(f"root_scope 钉死数据根：应为 projects/{pid}（双根铁律）")
    seen = set()
    for e in doc.get("entries", []):
        path = e.get("path", "?")
        if not isinstance(e.get("path"), str) or e["path"].startswith("/") or "\\" in e["path"] or e["path"].startswith("./"):
            errs.append(f"entry.path 非法：{path}")
        if e.get("role") not in ("human", "generated", "hybrid"):
            errs.append(f"entry.role 非法：{path} · {e.get('role')}")
        extra = set(e) - {"path", "role", "kind", "hash", "mtime", "notes"}
        if extra:
            errs.append(f"entry 多余键（additionalProperties:false）：{path} · {sorted(extra)}")
        if path in seen:
            errs.append(f"entry 重复：{path}")
        seen.add(path)
    for k, v in doc.get("stats", {}).items():
        if not isinstance(v, int) or isinstance(v, bool):
            errs.append(f"stats.{k} 必须是整数：{v!r}")
    if errs:
        raise SystemExit("[ABORT] 索引自检不过，拒绝落盘：\n  " + "\n  ".join(errs))


def build_doc(pid: str, entries: list[dict], old: dict | None) -> dict:
    """装配索引文档；存量索引在场时继承 hybrid 升格（角色首标一次、增量维护）。"""
    if old:
        carry = {e.get("path"): e for e in old.get("entries", []) if e.get("role") == "hybrid"}
        for e in entries:
            c = carry.get(e["path"])
            if c:
                e["role"] = "hybrid"
                if not e.get("notes"):
                    e["notes"] = c.get("notes") or "hybrid（继承自存量索引）"
                elif c.get("notes") and c["notes"] not in e["notes"]:
                    e["notes"] = c["notes"] + "；" + e["notes"]
    roles = [e["role"] for e in entries]
    return {
        "format": FORMAT,
        "project_id": pid,
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "generator": GENERATOR,
        "root_scope": f"projects/{pid}",
        "entries": entries,
        "stats": {
            "total": len(entries),
            "human": roles.count("human"),
            "generated": roles.count("generated"),
            "hybrid": roles.count("hybrid"),
        },
    }


def write_index(proj: Path, doc: dict, pid: str) -> None:
    validate_index(doc, pid)  # 校验不过 = SystemExit，绝不写坏盘
    (proj / INDEX_NAME).write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")


# ── 子命令 ────────────────────────────────────────────────────────────────────


def cmd_build(pid: str, flags: dict) -> int:
    base = ROOT / flags.get("--dir", "projects")
    proj = proj_dir(pid, base)
    old = load_old(proj)
    entries = scan_entries(proj, "--all" in flags)
    doc = build_doc(pid, entries, old)
    write_index(proj, doc, pid)
    s = doc["stats"]
    print(f"indexed: {proj / INDEX_NAME}")
    print(f"  entries={s['total']} human={s['human']} generated={s['generated']} hybrid={s['hybrid']}"
          + ("（含机器区）" if "--all" in flags else "（机器区已排除，--all 可全量纳管）"))
    if old:
        print("  hybrid 升格记录已从存量索引继承")
    return 0


def cmd_diff(pid: str, flags: dict) -> int:
    base = ROOT / flags.get("--dir", "projects")
    proj = proj_dir(pid, base)
    old = load_old(proj)
    if not old:
        return fail(f"存量索引不存在，先跑 build：{proj / INDEX_NAME}")
    old_by_path = {e["path"]: e for e in old.get("entries", [])}

    added: list[dict] = []
    changed: list[dict] = []
    missing: list[str] = []
    promoted: list[str] = []
    touched: list[str] = []  # mtime 变 hash 同：只刷新时间戳

    new_entries = scan_entries(proj, "--all" in flags)
    disk = {e["path"]: e for e in new_entries}

    for e in new_entries:
        o = old_by_path.get(e["path"])
        if o is None:
            added.append(e)
            continue
        if o.get("mtime") == e["mtime"]:
            continue  # mtime 未动 → 视为未变（第一依据，便宜）
        if o.get("hash") == e["hash"]:
            touched.append(e["path"])  # 内容没动，只是被 touch
            continue
        changed.append(e)
        if o.get("role") == "generated":
            e["role"] = "hybrid"
            e["notes"] = (o.get("notes") + "；" if o.get("notes") else "") + \
                f"疑似手改（generated 条目 hash/mtime 与索引不一致，{time.strftime('%Y-%m-%dT%H:%M:%S')} diff 升格）"
            promoted.append(e["path"])
        elif o.get("role") == "hybrid":
            e["role"] = "hybrid"
            e["notes"] = (o.get("notes") or "") + f"；{time.strftime('%Y-%m-%dT%H:%M:%S')} 再次手改"
        # human 变更：保持 human，只刷新 hash/mtime（人写文件变更=正常业务，工具不裁决不覆写）

    for path in sorted(set(old_by_path) - set(disk)):
        missing.append(path)

    # scan 产出已带刷新后的 hash/mtime 与本轮升格结果；build_doc 再从存量索引继承历史 hybrid
    doc = build_doc(pid, new_entries, old)
    write_index(proj, doc, pid)

    print(f"diff: {proj / INDEX_NAME}")
    print(f"  新增 {len(added)} · 变更 {len(changed)} · 失踪 {len(missing)} · 升格 hybrid {len(promoted)} · 仅 touch {len(touched)}")
    for e in added:
        print(f"  + 新增 [{e['role']}] {e['path']}")
    for e in changed:
        print(f"  ~ 变更 [{e['role']}] {e['path']}")
    for p in promoted:
        print(f"  ! 升格 hybrid（疑似手改）{p}")
    for p in missing:
        print(f"  - 失踪 {p}")
    for p in touched:
        print(f"  · 仅 touch（内容未变）{p}")

    receipt = flags.get("--receipt")
    if receipt:
        rpath = Path(receipt) if receipt is not True else \
            proj / "registry" / "receipts" / f"project-index-diff-{time.strftime('%Y%m%d-%H%M%S')}.json"
        if not rpath.is_absolute():
            rpath = proj / rpath  # 相对路径一律锚在项目目录内（全程不碰 projects/<id>/ 之外）
        if not str(rpath.resolve()).startswith(str(proj.resolve())):
            return fail(f"收据必须落在项目目录内（双根纪律）：{rpath}")
        rpath.parent.mkdir(parents=True, exist_ok=True)
        rpath.write_text(json.dumps({
            "tool": GENERATOR + " diff",
            "project_id": pid,
            "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "index": to_posix(proj.relative_to(ROOT)) + "/" + INDEX_NAME,
            "added": [e["path"] for e in added],
            "changed": [e["path"] for e in changed],
            "missing": missing,
            "hybrid_promoted": promoted,
            "touched_only": touched,
            "stats": doc["stats"],
        }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
        print(f"  收据：{rpath}")
    return 0


# ── memory：会话 JSONL → 记忆卡 ───────────────────────────────────────────────

TS = re.compile(r"^\d{4}-\d{2}-\d{2}T")


def user_text(content: object) -> str:
    """会话 message.content 归一为纯文本：字符串直取；分段数组拼 text 段。不编内容。"""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for c in content:
            if isinstance(c, str):
                parts.append(c)
            elif isinstance(c, dict) and isinstance(c.get("text"), str):
                parts.append(c["text"])
        return "\n".join(p for p in parts if p.strip())
    return ""


def first_sentence(text: str, cap: int = 80) -> str:
    """用户输入首句：压平空白后取到首个句读为止；超长截断加省略号。"""
    t = re.sub(r"\s+", " ", text.strip())
    if not t:
        return ""
    m = re.search(r"^.*?[。！？!?；;]", t)
    s = (m.group(0) if m else t).strip()
    return s[:cap] + ("…" if len(s) > cap else "")


def parse_session(f: Path) -> dict:
    """解析会话 JSONL：返回 {sid, turns:[(ts, 首句)], updated}。损坏行跳过（不编内容）。"""
    turns: list[tuple[str, str]] = []
    last_ts = ""
    for line in f.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            ev = json.loads(line)
        except ValueError:
            continue
        ts = ev.get("ts") if isinstance(ev.get("ts"), str) else ""
        if ts:
            last_ts = ts
        if ev.get("kind") == "message" and ev.get("role") == "user":
            text = user_text(ev.get("content"))
            if text.strip():
                turns.append((ts or "（无时间戳）", first_sentence(text)))
    updated = last_ts or mtime_iso(f)
    return {"sid": f.stem, "turns": turns, "updated": updated}


def cmd_memory(pid: str, flags: dict) -> int:
    base = ROOT / flags.get("--dir", "projects")
    proj = proj_dir(pid, base)
    sdir = proj / flags.get("--sessions-dir", "内部/sessions")
    only = flags.get("--session")
    if not sdir.is_dir():
        return fail(f"会话目录不存在：{sdir}")
    files = sorted(sdir.glob("*.jsonl"))
    if only:
        files = [f for f in files if f.stem == only]
        if not files:
            return fail(f"会话不存在：{only}（在 {sdir} 下）")
    out_dir = proj / "世界书"
    out_dir.mkdir(parents=True, exist_ok=True)
    written, skipped = [], []
    for f in files:
        s = parse_session(f)
        if not s["turns"]:
            skipped.append(s["sid"])
            continue
        rel_source = to_posix(f.relative_to(proj))
        lines = [
            "---",
            f"session_id: {s['sid']}",
            f"turns: {len(s['turns'])}",
            f"updated: {s['updated']}",
            f"source: {rel_source}",
            "---",
            "",
            f"# 记忆卡 · {s['sid']}",
            "",
            "> 由 tools/project-index.py memory 从会话 JSONL 确定性抽取（派生物，可重建；",
            "> 只记用户输入首句与时间戳，不含助手正文，不编内容）。",
            "",
        ]
        for i, (ts, sent) in enumerate(s["turns"], 1):
            lines.append(f"- 第{i}轮 · {ts} · 用户：{sent}")
        card = out_dir / f"记忆卡-{s['sid']}.md"
        card.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")
        written.append(to_posix(card.relative_to(proj)))
    print(f"memory: {len(written)} 卡重建 / {len(skipped)} 会话零输入轮跳过")
    for w in written:
        print(f"  + {w}")
    for s in skipped:
        print(f"  · 跳过（无用户输入）：{s}")
    print("next: python tools/kit-compile.py --project " + pid + "（把记忆卡编入项目 RAG 档）")
    return 0


def main() -> int:
    argv = sys.argv[1:]
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__)
        return 0 if argv else 1
    cmd = argv[0]
    if cmd not in ("build", "diff", "memory"):
        return fail(f"未知子命令：{cmd}（build / diff / memory）")
    parsed = parse_argv(argv[1:])
    args = parsed["args"]
    flags = parsed["flags"]
    if not args:
        return fail("缺项目 id：python tools/project-index.py <build|diff|memory> <projectId>")
    pid = args[0]
    if cmd == "build":
        return cmd_build(pid, flags)
    if cmd == "diff":
        return cmd_diff(pid, flags)
    return cmd_memory(pid, flags)


if __name__ == "__main__":
    raise SystemExit(main())
