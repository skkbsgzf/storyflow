"""journal-page · 大事记时间轴页生成器（journal JSONL → 自包含 HTML，零依赖）

输入 journal 台账（契约：contracts/journal-event.schema.json，一行一事件），
用 tools/journal-template.html 渲染成单文件时间轴页：数据生成时内联，
零外部请求、零运行时依赖、不反向调用 kit 接口（ARCHITECTURE §9 不变量 6）——
双击即开，宿主可直接嵌链接 / iframe。

数据装载三形态（自动识别）：
  ① journal.jsonl（主形态）：一行一事件，坏行跳过计数，事件保持文件序（append-only 时序）；
  ② 整文件 JSON 数组：协议面 GET /api/projects/{id}/journal 切片形态；
  ③ 整文件对象 {entries:[…]}：页面数据包形态。
只保留 schema 已知键（ts/runId/event/nodeId/actor/detail/refs），其余丢弃。

用法：
  python tools/journal-page.py <project>                        # 项目模式 → projects/<id>/journal.html
  python tools/journal-page.py <project> --out <html>           # 指定输出路径
  python tools/journal-page.py --input <journal.jsonl> [--out <html>] [--title <标题>]

退出码：0 成功；1 输入不存在 / 模板缺失 / 模板含外部资源引用；2 用法错误（argparse）。
幂等：同一输入重跑输出逐字节一致（页面不携带生成时刻，一切字段派生自输入）。
"""
import argparse
import html
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
KIT_MARK = Path(__file__).resolve().parent / "kit.json"
TEMPLATE = Path(__file__).resolve().parent / "journal-template.html"

EVENT_KEYS = ("ts", "runId", "event", "nodeId", "actor", "detail", "refs")

# 零外部资源红线（ARCHITECTURE §9 不变量 6）：src/href 属性、CSS url()、@import
# 都不许指向 http(s):// 或协议相对 //host；锚点 # 与 xmlns 命名空间不在此列。
EXTERNAL_PATTERNS = (
    re.compile(r"""(?:src|href)\s*=\s*["']?(?:https?:)?//""", re.I),
    re.compile(r"""url\(\s*["']?(?:https?:)?//""", re.I),
    re.compile(r"""@import\s+(?:url\(\s*)?["']?(?:https?:)?//""", re.I),
)


def proj_dir(name):
    # kit vendor 模式：本工具被 kit.py 拷贝进 <project>/kit/ 内时，
    # kit/ 上一级即项目根（kit.json 为标记）；常驻模式返回中心工作区路径。
    if KIT_MARK.exists():
        return ROOT
    return ROOT / "projects" / name


def external_hits(text):
    """返回命中零外部资源红线的行（空列表 = 通过）。"""
    return [ln.strip()[:160] for ln in text.splitlines() if any(p.search(ln) for p in EXTERNAL_PATTERNS)]


def slim(d):
    """事件瘦身：只留 schema 已知键，顺序按 EVENT_KEYS（确定性）。"""
    return {k: d[k] for k in EVENT_KEYS if k in d}


def load_events(path: Path):
    """journal 数据装载（三形态自动识别）。返回 (events, skipped)。"""
    text = path.read_text(encoding="utf-8")
    events, skipped = [], 0
    for ln in text.splitlines():
        ln = ln.strip()
        if not ln:
            continue
        try:
            d = json.loads(ln)
        except Exception:
            skipped += 1
            continue
        if isinstance(d, dict):
            events.append(slim(d))
        else:
            skipped += 1
    if not events:
        # 兜底：整文件 JSON（数组 = REST 切片；对象 = {entries:[…]} 数据包）
        try:
            whole = json.loads(text)
        except Exception:
            whole = None
        if isinstance(whole, list):
            events = [slim(d) for d in whole if isinstance(d, dict)]
        elif isinstance(whole, dict) and isinstance(whole.get("entries"), list):
            events = [slim(d) for d in whole["entries"] if isinstance(d, dict)]
    return events, skipped


def render(events, title):
    template = TEMPLATE.read_text(encoding="utf-8")
    hits = external_hits(template)
    if hits:
        raise SystemExit(f"[ABORT] 模板含外部资源引用（零依赖红线）: {hits[:3]}")
    # </ 转义成 <\/ ：防止事件文本里的 </script> 提前闭合脚本块（JSON 语义不变）。
    payload = json.dumps({"entries": events}, ensure_ascii=False).replace("</", "<\\/")
    return template.replace("__TITLE__", html.escape(title, quote=True)).replace("__JOURNAL__", payload)


def main():
    ap = argparse.ArgumentParser(description="journal 台账 → 自包含 HTML 大事记时间轴页")
    ap.add_argument("project", nargs="?", help="项目 id（projects/<id>/journal.jsonl）")
    ap.add_argument("--input", help="journal 数据路径（jsonl / JSON 数组 / {entries:[…]}）")
    ap.add_argument("--out", help="输出 HTML 路径（缺省与输入同目录 journal.html）")
    ap.add_argument("--title", help="页标题（缺省项目 id / 输入目录名）")
    args = ap.parse_args()
    if not args.project and not args.input:
        ap.error("需要 <project> 或 --input <journal 数据路径>")
        return 2
    if args.input:
        src = Path(args.input)
        src = src if src.is_absolute() else ROOT / src
        default_title = src.parent.name
    else:
        src = proj_dir(args.project) / "journal.jsonl"
        default_title = args.project
    if not src.exists():
        print(f"[ABORT] 输入不存在：{src}", file=sys.stderr)
        return 1
    if not TEMPLATE.exists():
        print(f"[ABORT] 模板缺失：{TEMPLATE}", file=sys.stderr)
        return 1
    events, skipped = load_events(src)
    title = args.title or default_title
    out = Path(args.out) if args.out else src.with_suffix(".html")
    out = out if out.is_absolute() else ROOT / out
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(render(events, title), encoding="utf-8")
    note = f"，坏行跳过 {skipped}" if skipped else ""
    print(f"journal-page → {out}（events={len(events)}{note}）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
