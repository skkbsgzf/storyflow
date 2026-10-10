#!/usr/bin/env python3
"""kb-graph-page · 知识图谱自包含页生成器（storyflow-hypergraph@1 → 单文件力导向图，零依赖）

输入：kit/hypergraph.rag.json（全局编译图，kit-compile.py 产物；--project 时再并入
projects/<id>/kit/hypergraph.rag.json 项目档，节点标 source=global|project，同 id 撞号时
项目侧优先——与 core kb 双根合并去重口径一致）。
输出：单文件 HTML——内联 Canvas + 内联 JS 力导向布局，零外部请求（kitapp 图谱交互的零依赖
复刻，功能收敛：节点拖拽 / 画布平移 / 滚轮缩放 / 悬停显名 / 分类图例点击隔离 /
度数定半径 / 枢纽名常显 / 项目卡描金环）。数据内嵌为惰性 JSON（</ 转义防提前闭脚本）。
分类着色按 entries 的 domain 字段（编译图无独立类型字段，域即分类——kit-compile 口径）。

工程范式与 tools/diagnosis-page.py 一致：
  · 写盘前零外部资源断言（src/href/url()/@import 不得指 http(s):// 或 //host）；
  · 幂等（页面不携带生成时刻，同一输入重跑 sha256 一致）；
  · --selfcheck 自测（合成图 → 形状校验 → 渲染两遍逐字节一致 → 零外部资源断言 → 临时落盘）。
  · 只读 kit/（全局产物只读），页面一律写 projects/ 侧（不入 git）。

用法：
  python tools/kb-graph-page.py [--project <id>] [--out <html>] [--root <dir>]
      缺省输出：全局 → projects/_reports/kb-graph.html；
                --project → projects/<id>/kb-graph.html（与世界书 pedia 页同目录惯例）。
  python tools/kb-graph-page.py --selfcheck

退出码：0 成功；1 输入不存在 / 非法 JSON / 契约形状不符 / 零外部资源断言失败；2 用法错误（argparse）。
"""
import argparse
import copy
import html
import json
import re
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TEMPLATE = Path(__file__).resolve().parent / "kb-graph-template.html"

# 零外部资源红线（ARCHITECTURE §9 不变量 6）：与 diagnosis-page 同表——
# src/href 属性、CSS url()、@import 都不许指向 http(s):// 或协议相对 //host。
EXTERNAL_PATTERNS = (
    re.compile(r"""(?:src|href)\s*=\s*["']?(?:https?:)?//""", re.I),
    re.compile(r"""url\(\s*["']?(?:https?:)?//""", re.I),
    re.compile(r"""@import\s+(?:url\(\s*)?["']?(?:https?:)?//""", re.I),
)


def external_hits(text):
    """返回命中零外部资源红线的行（空列表 = 通过）。"""
    return [ln.strip()[:160] for ln in text.splitlines() if any(p.search(ln) for p in EXTERNAL_PATTERNS)]


def load_graph(path: Path) -> dict:
    if not path.exists():
        sys.exit(f"[ABORT] 编译图不存在：{path}（先跑 python tools/kit-compile.py"
                 + ("" if "projects" not in str(path) else f" --project {path.parent.parent.name}") + "）")
    try:
        g = json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:  # noqa: BLE001
        sys.exit(f"[ABORT] 输入不是合法 JSON：{path}（{e}）")
    problems = check_shape(g)
    if problems:
        print(f"[ABORT] 契约形状不符（storyflow-hypergraph@1）：{path}", file=sys.stderr)
        for p in problems:
            print(f"  ! {p}", file=sys.stderr)
        sys.exit(1)
    return g


def check_shape(g) -> list:
    """轻量契约校验（渲染前提）：format / entries / relations 形状。返回问题列表（空 = 通过）。"""
    problems = []
    if not isinstance(g, dict):
        return ["顶层必须是 JSON 对象"]
    if g.get("format") != "storyflow-hypergraph@1":
        problems.append(f'format 必须是 "storyflow-hypergraph@1"（现为 {g.get("format")!r}）')
    entries = g.get("entries")
    if not isinstance(entries, list) or not entries:
        problems.append("entries 必须是非空数组（空图无处下笔）")
        return problems
    for i, e in enumerate(entries):
        if not isinstance(e, dict) or not e.get("id") or not e.get("domain"):
            problems.append(f"entries[{i}] 缺 id/domain（分类着色按 domain，缺了没法归色）")
            break
    rels = g.get("relations")
    if rels is not None and not isinstance(rels, list):
        problems.append("relations 若有必须是数组")
    return problems


def build_payload(global_g: dict, project_g: dict | None, project: str | None) -> dict:
    """双图 → 页面数据：nodes（去重：同 id 项目侧优先）/ links（下标化）/ domains 计数。"""
    nodes, by_id, dropped_links, dup_ids = [], {}, 0, []
    for source, g in (("global", global_g), ("project", project_g)):
        if g is None:
            continue
        for e in g.get("entries", []):
            cid = e["id"]
            if cid in by_id:
                if source == "project":  # 同 id 撞号：项目侧优先（与 kb.ts 去重口径一致）
                    dup_ids.append(cid)
                    nodes[by_id[cid]] = {**e, "source": source}
                continue
            by_id[cid] = len(nodes)
            nodes.append({**e, "source": source})
    links = []
    for source, g in (("global", global_g), ("project", project_g)):
        if g is None:
            continue
        for r in g.get("relations") or []:
            s, t = by_id.get(r.get("from")), by_id.get(r.get("to"))
            if s is None or t is None or s == t:
                dropped_links += 1
                continue
            links.append({"s": s, "t": t, "k": r.get("kind", "mention")})
    degree = [0] * len(nodes)
    for l in links:
        degree[l["s"]] += 1
        degree[l["t"]] += 1
    for n, d in zip(nodes, degree):
        n["degree"] = d
    dom_count: dict = {}
    for n in nodes:
        key = f"{n['domain']}|{n['source']}"
        dom_count[key] = dom_count.get(key, 0) + 1
    domains = [
        {"name": k.split("|")[0], "source": k.split("|")[1], "count": v}
        for k, v in sorted(dom_count.items(), key=lambda kv: (-kv[1], kv[0]))
    ]
    return {
        "format": "kb-graph-page@1",
        "scope": "project+global" if project_g is not None else "global",
        "project": project,
        "domains": domains,
        "nodes": nodes,
        "links": links,
        "meta": {"dropped_links": dropped_links, "duplicate_ids": sorted(set(dup_ids)),
                 "global_stats": global_g.get("stats") or {},
                 "project_stats": (project_g or {}).get("stats") or {}},
    }


def render(payload: dict, title: str) -> str:
    template = TEMPLATE.read_text(encoding="utf-8")
    hits = external_hits(template)
    if hits:
        raise SystemExit(f"[ABORT] 模板含外部资源引用（零依赖红线）: {hits[:3]}")
    # </ 转义成 <\/：防止文本里的 </script> 提前闭合脚本块（JSON 语义不变）。
    body = json.dumps(payload, ensure_ascii=False, sort_keys=True).replace("</", "<\\/")
    return template.replace("__TITLE__", html.escape(title, quote=True)).replace("__GRAPH__", body)


def out_path_for(root: Path, project: str | None, out: str | None) -> Path:
    if out:
        p = Path(out)
        return p if p.is_absolute() else root / p
    if project:
        return root / "projects" / project / "kb-graph.html"
    return root / "projects" / "_reports" / "kb-graph.html"


def cmd_build(project: str | None, out: str | None, root_dir: str) -> int:
    root = Path(root_dir).resolve()
    g = load_graph(root / "kit" / "hypergraph.rag.json")
    pg = None
    if project:
        pg = load_graph(root / "projects" / project / "kit" / "hypergraph.rag.json")
    payload = build_payload(g, pg, project)
    page = render(payload, (project + " + 全局 kit") if project else "全局 kit")
    hits = external_hits(page)
    if hits:
        print("[FAIL] 产物含外部资源引用（零依赖红线）:", file=sys.stderr)
        for h in hits:
            print(f"  ! {h}", file=sys.stderr)
        return 1
    dst = out_path_for(root, project, out)
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text(page, encoding="utf-8")
    sc = "（scope=project+global，项目卡描金环）" if pg is not None else ""
    print(f"kb-graph-page → {dst}（节点 {len(payload['nodes'])} / 边 {len(payload['links'])} / "
          f"域 {len(payload['domains'])}{sc}；悬边丢弃 {payload['meta']['dropped_links']}）零外部资源引用")
    return 0


def cmd_selfcheck() -> int:
    """合成图全链自测：形状校验 → 渲染两遍逐字节一致（幂等）→ 零外部资源断言 → 临时落盘。"""
    if not TEMPLATE.exists():
        print(f"[ABORT] 模板缺失：{TEMPLATE}", file=sys.stderr)
        return 1
    g = {
        "format": "storyflow-hypergraph@1",
        "stats": {"entries": 3, "relations": 3, "domains": ["aesthetic"]},
        "entries": [
            {"id": "kb/aesthetic/hub", "title": "枢纽卡", "domain": "aesthetic", "path": "knowledge/aesthetic/hub.md", "tags": []},
            {"id": "kb/aesthetic/leaf", "title": "---", "domain": "aesthetic", "path": "knowledge/aesthetic/leaf.md", "tags": []},
            {"id": "kb/aesthetic/other", "title": "另一张", "domain": "aesthetic", "path": "knowledge/aesthetic/other.md", "tags": []},
        ],
        "relations": [
            {"from": "kb/aesthetic/hub", "to": "kb/aesthetic/leaf", "kind": "mention", "weight": 1},
            {"from": "kb/aesthetic/hub", "to": "kb/aesthetic/other", "kind": "mention", "weight": 1},
            {"from": "kb/aesthetic/ghost", "to": "kb/aesthetic/hub", "kind": "mention", "weight": 1},
        ],
    }
    # 项目档：与全局撞一号（kb/aesthetic/hub——项目卡抄全局 id 的真实形态）+ 自有项目卡
    p = {
        "format": "storyflow-hypergraph@1",
        "stats": {"entries": 2, "relations": 2, "domains": ["规则"], "scope": "project"},
        "entries": [
            {"id": "kb/aesthetic/hub", "title": "项目侧副本", "domain": "aesthetic", "path": "备份/hub.md", "tags": []},
            {"id": "pj/规则/设定", "title": "项目设定", "domain": "规则", "path": "规则/设定.md", "tags": []},
        ],
        "relations": [
            {"from": "kb/aesthetic/hub", "to": "pj/规则/设定", "kind": "mention", "weight": 1},
            {"from": "kb/aesthetic/hub", "to": "kb/aesthetic/hub", "kind": "mention", "weight": 1},
        ],
    }
    problems = check_shape(g)
    assert not problems, problems
    # 双根合并口径一起钉住：同 id 项目侧优先去重（3+2−1=4 节点）、悬边/自环丢弃（ghost + 自环 = 2）
    payload = build_payload(g, p, "p-selfcheck")
    assert payload["scope"] == "project+global"
    assert len(payload["nodes"]) == 4, f"同 id 项目侧优先应去重为 4 节点，实得 {len(payload['nodes'])}"
    assert payload["nodes"][0]["source"] == "project" and payload["nodes"][0]["title"] == "项目侧副本"
    assert payload["links"] and len(payload["links"]) == 3
    assert payload["meta"]["dropped_links"] == 2, f"ghost 悬边 + 自环应丢弃 2 条，实得 {payload['meta']['dropped_links']}"
    assert payload["meta"]["duplicate_ids"] == ["kb/aesthetic/hub"]
    p1 = render(payload, "selfcheck")
    p2 = render(build_payload(g, copy.deepcopy(p), "p-selfcheck"), "selfcheck")
    if p1 != p2:
        print("[FAIL] 幂等破坏：同一输入两次渲染不一致", file=sys.stderr)
        return 1
    hits = external_hits(p1)
    if hits:
        print("[FAIL] 产物含外部资源引用（零依赖红线）:", file=sys.stderr)
        for h in hits:
            print(f"  ! {h}", file=sys.stderr)
        return 1
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td) / "kb-graph-selfcheck.html"
        tmp.write_text(p1, encoding="utf-8")
        size = tmp.stat().st_size
    print(f"selfcheck OK：节点 {len(payload['nodes'])} 边 {len(payload['links'])}（悬边丢弃 "
          f"{payload['meta']['dropped_links']}，同 id 项目侧优先），产物 {size} 字节，两次渲染逐字节一致，零外部资源引用")
    return 0


def main():
    ap = argparse.ArgumentParser(description="知识图谱 storyflow-hypergraph@1 → 自包含力导向页")
    ap.add_argument("--project", help="并入 projects/<id>/kit/hypergraph.rag.json 项目档（节点标 source，项目侧描金环）")
    ap.add_argument("--out", help="输出 HTML 路径（缺省 projects/_reports/ 或项目目录下 kb-graph.html）")
    ap.add_argument("--root", default=str(ROOT), help="仓库根（缺省本脚本上一级）")
    ap.add_argument("--selfcheck", action="store_true", help="合成图自测（形状校验 + 幂等 + 零外部资源断言）")
    args = ap.parse_args()
    if args.selfcheck:
        return cmd_selfcheck()
    return cmd_build(args.project, args.out, args.root)


if __name__ == "__main__":
    sys.exit(main())
