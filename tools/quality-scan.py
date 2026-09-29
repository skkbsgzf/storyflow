#!/usr/bin/env python3
"""quality-scan v1 · v5.0 批A —— agent 的眼睛：确定性证据聚合器，不出判决。

设计约束（docs/v5.0工单-断言体系退役与规则语料化.md §一/§二 T 轨）：
  1. 单一实现：引擎侧 27 条 T 轨检查一律经 core/src/quality-cli.ts 桥接
     aesthetic.ts::runAestheticAsserts 真身，本脚本禁止重写任何一条计数逻辑；
  2. 只出证据：输出 = prose-scan（AI 味指数/八维画像/配额层）+ 引擎 findings
     的合并报告。pass/warn/block 字样沿用校验器原文只作**严重度线索**，
     裁决归 agent 评分与端尾人裁，本工具无闸效应；
  3. 收据纪律（铁律 10 升级版）：agent 报数必须引用本工具落盘的收据文件，
     无收据 = 不许在验收/评审意见里声称"已扫描"。

用法：
  python tools/quality-scan.py --project <id> --file <项目内相对路径>
        [--budget '{"similePerK":2}'] [--json] [--no-receipt]

输出：
  stdout：合并 JSON 报告
  收据： projects/<id>/内部/收据/quality-scan-<stem>-<ts>.md（默认落盘，--no-receipt 关）
"""
import argparse
import datetime as dt
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TSX = ROOT / "core" / "node_modules" / ".bin" / "tsx.cmd"
CLI = ROOT / "core" / "src" / "quality-cli.ts"


def run_prose_scan(file_abs: Path) -> dict:
    """配额层 + 八维画像 + AI 味指数（prose-scan 是这些指标的单一实现）。"""
    p = subprocess.run(
        [sys.executable, str(ROOT / "tools" / "prose-scan.py"), "--json", str(file_abs)],
        capture_output=True, text=True, encoding="utf-8", cwd=ROOT,
    )
    if p.returncode != 0:
        return {"error": (p.stderr or p.stdout).strip()[:500]}
    try:
        # prose-scan --json 可能输出多对象（逐章），统一收进 list
        raw = p.stdout.strip()
        objs = []
        dec = json.JSONDecoder()
        idx = 0
        while idx < len(raw):
            m = re.search(r"\{", raw[idx:])
            if not m:
                break
            start = idx + m.start()
            obj, end = dec.raw_decode(raw[start:])
            objs.append(obj)
            idx = end
        return {"runs": objs} if objs else {"error": "prose-scan 无输出"}
    except Exception as e:  # noqa: BLE001
        return {"error": f"prose-scan 解析失败: {e}"}


def run_engine(project_dir: Path, rel: str, budget: str | None) -> dict:
    if not TSX.exists():
        return {"error": f"缺 tsx：{TSX}（先在 core/ npm install）"}
    cmd = [str(TSX), str(CLI), "--project", str(project_dir), "--file", rel]
    if budget:
        cmd += ["--budget", budget]
    p = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", cwd=ROOT / "core")
    if p.returncode != 0:
        return {"error": (p.stderr or p.stdout).strip()[:800]}
    try:
        return json.loads(p.stdout)
    except Exception as e:  # noqa: BLE001
        return {"error": f"quality-cli 输出非 JSON: {e}", "raw": p.stdout[:400]}


def summarize(engine: dict, prose: dict) -> dict:
    vals = engine.get("validations", []) if isinstance(engine, dict) else []
    counts = {"pass": 0, "warn": 0, "block": 0}
    for v in vals:
        counts[v.get("status", "pass")] = counts.get(v.get("status", "pass"), 0) + 1
    ai = None
    runs = prose.get("runs") if isinstance(prose, dict) else None
    if runs:
        ai = {"avg_ai_index": round(sum(r.get("aiIndex", 0) for r in runs) / len(runs), 1),
              "files": len(runs),
              "items": [i for r in runs for i in r.get("items", [])]}
    return {"counts_note": "counts 只是证据分布，不是验收结论", "counts": counts,
            "engine_checks": len(vals), "ai_profile": ai,
            "engine_issues": engine.get("issues", []) if isinstance(engine, dict) else [],
            "prose_error": prose.get("error") if isinstance(prose, dict) else None,
            "engine_error": engine.get("error") if isinstance(engine, dict) else None}


def write_receipt(project_dir: Path, rel: str, report: dict) -> Path:
    ts = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    stem = Path(rel).stem
    out_dir = project_dir / "内部" / "收据"
    out_dir.mkdir(parents=True, exist_ok=True)
    p = out_dir / f"quality-scan-{stem}-{ts}.md"
    s = report["summary"]
    lines = [
        f"# quality-scan 收据 · {rel}",
        "",
        f"- 时间：{dt.datetime.now().isoformat(timespec='seconds')}",
        f"- 工具链：tools/quality-scan.py（prose-scan 配额/画像 + core quality-cli 引擎桥）",
        f"- 性质：**证据收据**。本报告不拦截、不放行；裁决归 agent 评分与端尾人裁（v5.0 工单 §一）。",
        f"- 引擎检查 {s['engine_checks']} 条；证据分布 pass/warn/block = "
        f"{s['counts'].get('pass',0)}/{s['counts'].get('warn',0)}/{s['counts'].get('block',0)}",
    ]
    if s.get("ai_profile"):
        ap = s["ai_profile"]
        lines.append(f"- AI 味画像：均值指数 {ap['avg_ai_index']}，配额命中 {len(ap['items'])} 项")
        for it in ap["items"]:
            lines.append(f"  - {it.get('reason')}（权 {it.get('w')}）")
    for v in report["engine"].get("validations", []):
        lines.append(f"- [{v['status']}] {v['name']}：{v.get('detail','')}")
    for err in (s.get("engine_error"), s.get("prose_error")):
        if err:
            lines.append(f"- ⚠ 执行异常：{err}")
    lines += ["", "复现命令：`" + report["cmd"] + "`"]
    p.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return p


def main() -> int:
    ap = argparse.ArgumentParser(description="quality-scan v1：agent 的确定性证据聚合器")
    ap.add_argument("--project", required=True, help="项目 id（projects/<id>）")
    ap.add_argument("--file", required=True, help="项目内相对路径")
    ap.add_argument("--budget", help='JSON：覆盖 R7 §二 C 表阈值键（未知键显式回显）')
    ap.add_argument("--no-receipt", action="store_true", help="不落盘收据（仅调试用；验收/评审引用必须凭收据）")
    a = ap.parse_args()

    project_dir = ROOT / "projects" / a.project
    file_abs = project_dir / a.file
    if not file_abs.exists():
        print(json.dumps({"error": f"文件不存在: {file_abs}"}, ensure_ascii=False))
        return 3

    prose = run_prose_scan(file_abs)
    engine = run_engine(project_dir, a.file, a.budget)
    report = {
        "tool": "quality-scan/v1",
        "contract": "evidence-only（v5.0 工单：agent-only 执行模型，本工具非闸）",
        "project": a.project, "file": a.file,
        "cmd": f"python tools/quality-scan.py --project {a.project} --file {a.file}",
        "prose_scan": prose, "engine": engine,
        "summary": summarize(engine, prose),
    }
    if not a.no_receipt:
        report["receipt"] = str(write_receipt(project_dir, a.file, report))
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
