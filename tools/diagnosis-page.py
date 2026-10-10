"""diagnosis-page · 诊断报告页生成器（diagnosis-report@1 → 自包含 HTML，零依赖）

输入符合 contracts/diagnosis-report.schema.json 的 JSON（诊断报告，写/诊/改三相承载体），
用 tools/diagnosis-template.html 渲染成单文件 HTML：诊断项（rule_ref/tier/severity/suggestion）、
程序判定证据（location/quote/metric/scanner/receipt）与模型观点分区展示——
观点区标「模型观点·仅供参考」，与证据硬分离（ARCHITECTURE §3.2 同源铁律的展示面）。
零外部请求、零运行时依赖、不反向调用 kit 接口（ARCHITECTURE §9 不变量 6）——双击即开。

写前先做轻量契约形状校验（stdlib 不带 jsonschema，这里钉住页面的渲染前提）：
format 必须是 diagnosis-report@1、顶层与 items[]/evidence[] 必填键齐全；
形状不符 exit 1 逐条点名，不静默渲染残页。

用法：
  python tools/diagnosis-page.py <report.json> [--out <html>] [--title <标题>]
  python tools/diagnosis-page.py --selfcheck
      # 自测：fixture（tools/__fixtures__/diagnosis-report-sample.json）→ 临时 HTML
      # + 契约形状校验 + 产物零外部资源断言（src/href/url()/@import 不得指 http(s):// 或 //host）

退出码：0 成功；1 输入不存在 / 非法 JSON / 契约形状不符 / 零外部资源断言失败；2 用法错误（argparse）。
幂等：同一输入重跑输出逐字节一致（页面不携带生成时刻）。
"""
import argparse
import html
import json
import re
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
KIT_MARK = Path(__file__).resolve().parent / "kit.json"
TEMPLATE = Path(__file__).resolve().parent / "diagnosis-template.html"
FIXTURE = Path(__file__).resolve().parent / "__fixtures__" / "diagnosis-report-sample.json"

REQUIRED_TOP = ("format", "project", "target", "engines", "evidence", "items", "summary", "receipt")
REQUIRED_ITEM = ("rule_ref", "tier", "severity", "suggestion")

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


def check_shape(d):
    """轻量契约校验（渲染前提）：返回问题列表（空 = 通过）。"""
    problems = []
    if d.get("format") != "diagnosis-report@1":
        problems.append(f"format 必须是 \"diagnosis-report@1\"（现为 {d.get('format')!r}）")
    for k in REQUIRED_TOP:
        if k not in d:
            problems.append(f"缺必填顶层键: {k}")
    for i, it in enumerate(d.get("items") or []):
        for k in REQUIRED_ITEM:
            if not isinstance(it, dict) or k not in it:
                problems.append(f"items[{i}] 缺必填键: {k}")
    for i, ev in enumerate(d.get("evidence") or []):
        if not isinstance(ev, dict) or "location" not in ev:
            problems.append(f"evidence[{i}] 缺必填键: location（没有位置的证据不可复核）")
    return problems


def render(report: dict, title: str) -> str:
    template = TEMPLATE.read_text(encoding="utf-8")
    hits = external_hits(template)
    if hits:
        raise SystemExit(f"[ABORT] 模板含外部资源引用（零依赖红线）: {hits[:3]}")
    # </ 转义成 <\/ ：防止文本里的 </script> 提前闭合脚本块（JSON 语义不变）。
    payload = json.dumps(report, ensure_ascii=False).replace("</", "<\\/")
    return template.replace("__TITLE__", html.escape(title, quote=True)).replace("__REPORT__", payload)


def load_report(path: Path):
    try:
        d = json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:
        raise SystemExit(f"[ABORT] 输入不是合法 JSON：{path}（{e}）")
    if not isinstance(d, dict):
        raise SystemExit(f"[ABORT] 输入顶层必须是 JSON 对象：{path}")
    problems = check_shape(d)
    if problems:
        print(f"[ABORT] 契约形状不符（contracts/diagnosis-report.schema.json）：", file=sys.stderr)
        for p in problems:
            print(f"  ! {p}", file=sys.stderr)
        raise SystemExit(1)
    return d


def cmd_convert(src: Path, out: Path | None, title: str | None) -> int:
    if not src.exists():
        print(f"[ABORT] 输入不存在：{src}", file=sys.stderr)
        return 1
    if not TEMPLATE.exists():
        print(f"[ABORT] 模板缺失：{TEMPLATE}", file=sys.stderr)
        return 1
    report = load_report(src)
    page = render(report, title or src.stem)
    out = out or src.with_suffix(".html")
    out = out if out.is_absolute() else ROOT / out
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(page, encoding="utf-8")
    n_items, n_evs = len(report.get("items") or []), len(report.get("evidence") or [])
    print(f"diagnosis-page → {out}（items={n_items} evidence={n_evs} opinion={'有' if report.get('opinion') else '无'}）")
    return 0


def cmd_selfcheck() -> int:
    """fixture 全链自测：装载 → 校验 → 渲染 → 产物零外部资源断言（临时文件，跑完即删）。"""
    if not FIXTURE.exists():
        print(f"[ABORT] fixture 缺失：{FIXTURE}", file=sys.stderr)
        return 1
    report = load_report(FIXTURE)
    page = render(report, "selfcheck")
    hits = external_hits(page)
    if hits:
        print("[FAIL] 产物含外部资源引用（零依赖红线）:", file=sys.stderr)
        for h in hits:
            print(f"  ! {h}", file=sys.stderr)
        return 1
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td) / "diagnosis-selfcheck.html"
        tmp.write_text(page, encoding="utf-8")
        size = tmp.stat().st_size
    print(f"selfcheck OK：items={len(report['items'])} evidence={len(report['evidence'])} "
          f"opinion={'有' if report.get('opinion') else '无'}，产物 {size} 字节，零外部资源引用")
    return 0


def main():
    ap = argparse.ArgumentParser(description="诊断报告 diagnosis-report@1 → 自包含 HTML")
    ap.add_argument("report", nargs="?", help="报告 JSON 路径（contracts/diagnosis-report.schema.json 形状）")
    ap.add_argument("--out", help="输出 HTML 路径（缺省与输入同目录同名 .html）")
    ap.add_argument("--title", help="页标题（缺省输入文件名）")
    ap.add_argument("--selfcheck", action="store_true", help="fixture 自测（契约校验 + 零外部资源断言）")
    args = ap.parse_args()
    if args.selfcheck:
        return cmd_selfcheck()
    if not args.report:
        ap.error("需要 <report.json> 或 --selfcheck")
        return 2
    src = Path(args.report)
    src = src if src.is_absolute() else ROOT / src
    out = Path(args.out) if args.out else None
    if out is not None and not out.is_absolute():
        out = ROOT / out
    return cmd_convert(src, out, args.title)


if __name__ == "__main__":
    sys.exit(main())
