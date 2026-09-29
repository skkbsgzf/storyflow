"""GraphHyperRAG 图索引器（世界书 归纳层）

扫描项目 世界书/**/*.md 卡片（文件即真相），编译为 世界书/graph.json：
  format = worldbook-graph@1
  entries   词条：id/cat/title/status/version/tags/summary/path/mtime/links
  relations 边：frontmatter links（声明边）+ 标题互涉（共现边，带 mentions 计数）
  stats     分类计数 / 边计数 / 孤立节点数

关系三来源（归纳）：
  ① links:  frontmatter 声明边（权威，weight 2）
  ② mention: 正文出现其他词条标题（weight 1，每对计 mentions 次）
  ③ alias:  tags 与标题的交叉命中（weight 1）
检索消费方：内核 worldbook_search 动词（CLI/HTTP/MCP 三面）+ worldbook.html pedia 页。
人工维护的 世界书/index.json（RAG 词条库账本）**不读不写**——本工具只认卡片文件。

用法：
  python tools/worldbook-index.py --root projects/<id>      # 重建 graph.json 并回显统计
  python tools/worldbook-index.py --root projects/<id> --quiet
"""
import json
import re
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WBDIR = "世界书"

# 顶层散件（总览/纪律/时间线等）算 cat=总览；子目录名即分类
TOP_DOC_RE = re.compile(r"^(?!_).+\.md$")


def parse_frontmatter(text: str):
    """YAML 子集解析：key: value / key: [a, b] / key:\n- a。只取标量与字符串列表。"""
    m = re.match(r"^---\r?\n(.*?)\r?\n---", text, re.S)
    if not m:
        return {}, text
    raw = m.group(1)
    fm = {}
    for line in raw.splitlines():
        lm = re.match(r"^(\w[\w-]*):\s*(.*)$", line)
        if lm:
            k, v = lm.group(1), lm.group(2).strip()
            if v.startswith("[") and v.endswith("]"):
                items = [x.strip().strip("'\"") for x in v[1:-1].split(",") if x.strip()]
                fm[k] = items
            else:
                fm[k] = v.strip("'\"")
    # 列表续行（- item）
    cur = None
    for line in raw.splitlines():
        lm = re.match(r"^- (.+)$", line.strip()) if line.startswith("- ") else None
        if lm and cur:
            fm[cur] = (fm[cur] if isinstance(fm[cur], list) else [])
            fm[cur].append(lm.group(1).strip().strip("'\""))
        else:
            km = re.match(r"^(\w[\w-]*):\s*$", line)
            cur = km.group(1) if km else (cur if isinstance(fm.get(cur), list) else None)
    return fm, text[m.end():]


def first_para(body: str, limit: int = 120) -> str:
    for para in body.split("\n\n"):
        t = re.sub(r"[#*`>\[\]]", "", para).strip()
        if len(t) >= 8:
            return t[:limit] + ("…" if len(t) > limit else "")
    return ""


def build_index(proj: Path) -> dict:
    wb = proj / WBDIR
    if not wb.is_dir():
        return {"format": "worldbook-graph@1", "empty": True, "entries": [], "relations": [],
                "stats": {"entries": 0, "edges": 0, "isolated": 0, "byCat": {}},
                "built_at": datetime.now().strftime("%Y-%m-%d %H:%M")}
    entries = []
    by_id = {}
    for p in sorted(wb.rglob("*.md")):
        rel = p.relative_to(proj).as_posix().replace("\\", "/")
        cat = p.parent.name if p.parent != wb else "总览"
        try:
            text = p.read_text(encoding="utf-8")
        except Exception:
            continue
        fm, body = parse_frontmatter(text)
        title = fm.get("title") or p.stem
        eid = fm.get("id") or p.stem
        tags = fm.get("tags") if isinstance(fm.get("tags"), list) else ([fm["tags"]] if fm.get("tags") else [])
        links = fm.get("links") if isinstance(fm.get("links"), list) else ([fm["links"]] if fm.get("links") else [])
        try:
            mtime = datetime.fromtimestamp(p.stat().st_mtime).strftime("%m-%d %H:%M")
        except OSError:
            mtime = ""
        e = {
            "id": eid, "cat": cat, "title": title,
            "status": fm.get("status") or "active",
            "version": fm.get("version") or "",
            "tags": tags, "links": links,
            "summary": first_para(body),
            "path": rel, "mtime": mtime,
        }
        entries.append(e)
        by_id[eid] = e
        by_id[title] = e  # 标题也能当键（mention 归并）

    # 关系归纳
    edges = {}

    def add_edge(a, b, src, weight):
        if a == b or not a or not b:
            return
        key = (a, b) if a < b else (b, a)
        rec = edges.setdefault(key, {"a": key[0], "b": key[1], "src": set(), "weight": 0})
        rec["src"].add(src)
        rec["weight"] += weight

    for e in entries:
        for lk in e["links"]:                      # ① 声明边
            tgt = by_id.get(lk)
            if tgt:
                add_edge(e["id"], tgt["id"], "link", 2)
        body_path = proj / e["path"]
        try:
            body_text = body_path.read_text(encoding="utf-8")
        except Exception:
            continue
        for other in entries:                       # ② 标题互涉（跳过自身与总览长文互涉噪音：标题长度≥2）
            if other["id"] == e["id"] or len(other["title"]) < 2:
                continue
            n = body_text.count(other["title"])
            if n:
                add_edge(e["id"], other["id"], "mention", min(n, 3))
        for t in e["tags"]:                         # ③ tag 交叉：tag 恰是别的词条标题
            hit = by_id.get(t)
            if hit and hit["id"] != e["id"]:
                add_edge(e["id"], hit["id"], "tag", 1)

    relations = [
        {**rec, "src": "+".join(sorted(rec["src"]))}
        for rec in sorted(edges.values(), key=lambda r: (-r["weight"], r["a"], r["b"]))
    ]
    deg = {}
    for r in relations:
        deg[r["a"]] = deg.get(r["a"], 0) + 1
        deg[r["b"]] = deg.get(r["b"], 0) + 1
    by_cat = {}
    for e in entries:
        by_cat[e["cat"]] = by_cat.get(e["cat"], 0) + 1
    return {
        "format": "worldbook-graph@1",
        "project": proj.name,
        "built_at": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "entries": entries,
        "relations": relations,
        "stats": {
            "entries": len(entries),
            "edges": len(relations),
            "isolated": sum(1 for e in entries if deg.get(e["id"], 0) == 0),
            "byCat": dict(sorted(by_cat.items())),
        },
    }


def main():
    argv = sys.argv[1:]
    if "--root" not in argv:
        print(__doc__)
        sys.exit(1)
    root = Path(argv[argv.index("--root") + 1])
    proj = root if root.is_absolute() else ROOT / root
    if not proj.is_dir():
        sys.exit(f"[ABORT] 项目不存在：{proj}")
    graph = build_index(proj)
    out = proj / WBDIR / "graph.json"
    out.write_text(json.dumps(graph, ensure_ascii=False, indent=1), encoding="utf-8")
    if "--quiet" not in argv:
        st = graph["stats"]
        print(f"worldbook-graph@1 → {out} ｜ 词条 {st['entries']} ｜ 关系边 {st['edges']} ｜ "
              f"孤立 {st['isolated']} ｜ 分类 {json.dumps(st['byCat'], ensure_ascii=False)}")


if __name__ == "__main__":
    main()
