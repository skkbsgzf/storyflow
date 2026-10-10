#!/usr/bin/env python3
"""diagnosis-validate · diagnosis-report@1 校验器（手工等价校验，纯 stdlib）+ 收据映射表

契约：contracts/diagnosis-report.schema.json（写/诊/改三相承载体，批次2 R2.1 契约先行）。
本工具是三条诊通道产物的过门器——S 扫描器收据聚合（quality-scan）、A 级学生头证据（laya）、
B 级卡驱动诊断（mf_analyze_card）——任何一方声称「产出的是 diagnosis-report@1」都先过这里。

与 diagnosis-page.py 的关系：页面生成器带的是渲染前提级轻校验（能画就画）；本工具是完整契约
等价校验（additionalProperties=false 逐键点名、值域核对、description 级纪律提示），供宿主/人
在「把一份 JSON 当诊断报告消费」之前过门。两处校验同为 stdlib 手工等价，不引 jsonschema。

quality-scan 收据 → diagnosis-report@1 字段映射（--map 打印；取舍不得的：quality-scan 是
生产件，本批次不硬改它的输出格式——动输出要连动 core quality-cli 桥与测试，只做映射+校验器）：

  quality-scan（tools/quality-scan.py stdout JSON / 收据 md）   diagnosis-report@1
  ----------------------------------------------------------  ----------------------------------
  project                                                      project
  file                                                         target
  receipt（收据文件路径）                                        receipt（顶层）
  engine.validations[].name（AE-id，稳定 id）                    evidence[].scanner
  engine.validations[].detail                                   evidence[].metric（字符串形态）
  （无行号——引擎检查粒度是文件级）                                evidence[].location（记 file 本身）
  report.receipt                                                evidence[].receipt
  prose_scan.runs[].path                                        evidence[].location
  prose_scan.runs[].aiIndex                                     evidence[].metric（数值）
  prose_scan.runs[].items[].reason                              evidence[].metric（字符串）
  summary.counts（pass/warn/block 分布）                          人读 summary（须引用收据，铁律 2）
  validations[].status（pass/warn/block）                        **无对应字段**——那是严重度线索，
                                                               转 items[].severity 须 agent 裁决
                                                               （机器只出证据，不裁决）
  prose_scan.findings[]（中文标签，无稳定 id）                     **只能进 quote/summary**——
                                                               scanner 字段必须填稳定 id（AE-id
                                                               或 laya qid），无 id 的标签不得
                                                               冒充 scanner

用法：
  python tools/diagnosis-validate.py <report.json>   # 完整契约校验（问题逐条点名 exit 1）
  python tools/diagnosis-validate.py --map           # 打印上面这张映射表
  python tools/diagnosis-validate.py --selfcheck     # fixture 过验 + 坏样本点名（零写盘）

退出码：0 通过；1 契约不符 / 输入不存在 / 非法 JSON；2 用法错误（argparse）。
"""
import argparse
import json
import re
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIXTURE = Path(__file__).resolve().parent / "__fixtures__" / "diagnosis-report-sample.json"

# diagnosis-report@1 手工等价形状常量（与 contracts/diagnosis-report.schema.json 逐项对齐）
TOP_REQUIRED = ("format", "project", "target", "engines", "evidence", "items", "summary", "receipt")
TOP_KEYS = set(TOP_REQUIRED) | {"opinion"}  # opinion 是可选顶层键（B 级观点的家），不是未知键
ENGINE_KEYS = {"ran", "note"}
EVIDENCE_REQUIRED = ("location",)
EVIDENCE_OPTIONAL = ("rule_ref", "quote", "metric", "scanner", "receipt")
EVIDENCE_KEYS = set(EVIDENCE_REQUIRED) | set(EVIDENCE_OPTIONAL)
ITEM_REQUIRED = ("rule_ref", "tier", "severity", "suggestion")
ITEM_KEYS = set(ITEM_REQUIRED)
TIERS = ("S", "A", "B")
SEVERITIES = ("block", "major", "minor")
# 报数必附收据（铁律 2）的计数声明线索：summary 出现这些词且顶层 receipt=null 时提示核对
COUNTY_RE = re.compile(r"已扫描|残留|\d+\s*处|检出\s*\d+")


def _check_keys(d: dict, required, allowed, where, problems):
    for k in required:
        if k not in d:
            problems.append(f"{where} 缺必填键: {k}")
    for k in d:
        if k not in allowed:
            problems.append(f"{where} 未知键（契约 additionalProperties=false）: {k}")


def check_shape(d) -> list:
    """完整契约等价校验：返回问题列表（空 = 通过），逐条点名不合并。"""
    problems = []
    if not isinstance(d, dict):
        return ["顶层必须是 JSON 对象"]
    if d.get("format") != "diagnosis-report@1":
        problems.append(f"format 必须是 \"diagnosis-report@1\"（现为 {d.get('format')!r}）")
    _check_keys(d, TOP_REQUIRED, TOP_KEYS, "顶层", problems)
    for k in ("project", "target", "summary"):
        if k in d and not isinstance(d[k], str):
            problems.append(f"顶层 {k} 必须是字符串（现为 {type(d[k]).__name__}）")
    if "receipt" in d and not (d["receipt"] is None or isinstance(d["receipt"], str)):
        problems.append("顶层 receipt 必须是字符串或 null（无可附收据显式记 null）")

    engines = d.get("engines")
    if "engines" in d:
        if not isinstance(engines, dict):
            problems.append("engines 必须是对象（s/a/agent 三引擎参与声明）")
        else:
            for k in engines:
                if k not in ("s", "a", "agent"):
                    problems.append(f"engines 未知键（值域 s|a|agent）: {k}")
                    continue
                e = engines[k]
                if not isinstance(e, dict):
                    problems.append(f"engines.{k} 必须是对象")
                    continue
                _check_keys(e, ("ran",), ENGINE_KEYS, f"engines.{k}", problems)
                if "ran" in e and not isinstance(e["ran"], bool):
                    problems.append(f"engines.{k}.ran 必须是布尔")

    evidence = d.get("evidence")
    if "evidence" in d:
        if not isinstance(evidence, list):
            problems.append("evidence 必须是数组（可为空，但容器必须在）")
        else:
            for i, ev in enumerate(evidence):
                if not isinstance(ev, dict):
                    problems.append(f"evidence[{i}] 必须是对象")
                    continue
                _check_keys(ev, EVIDENCE_REQUIRED, EVIDENCE_KEYS, f"evidence[{i}]", problems)
                loc = ev.get("location")
                if loc is not None and (not isinstance(loc, str) or not loc.strip()):
                    problems.append(f"evidence[{i}].location 必须是非空字符串（没有位置的证据不可复核）")
                if "metric" in ev and not (isinstance(ev["metric"], (int, float)) and not isinstance(ev["metric"], bool) or isinstance(ev["metric"], str)):
                    problems.append(f"evidence[{i}].metric 必须是数字或字符串（比值走字符串形态）")

    if "opinion" in d and d["opinion"] is not None:
        op = d["opinion"]
        if not isinstance(op, dict):
            problems.append("opinion 必须是对象（B 级观点的家，与 evidence 硬分离）")
        else:
            _check_keys(op, ("by", "text"), {"by", "text"}, "opinion", problems)
            for k in ("by", "text"):
                if k in op and not isinstance(op[k], str):
                    problems.append(f"opinion.{k} 必须是字符串")

    items = d.get("items")
    if "items" in d:
        if not isinstance(items, list):
            problems.append("items 必须是数组")
        else:
            for i, it in enumerate(items):
                if not isinstance(it, dict):
                    problems.append(f"items[{i}] 必须是对象")
                    continue
                _check_keys(it, ITEM_REQUIRED, ITEM_KEYS, f"items[{i}]", problems)
                if it.get("tier") is not None and it["tier"] not in TIERS:
                    problems.append(f"items[{i}].tier 非法 {it['tier']!r}（∈ S|A|B）")
                if it.get("severity") is not None and it["severity"] not in SEVERITIES:
                    problems.append(f"items[{i}].severity 非法 {it['severity']!r}（∈ block|major|minor，优先级不是闸）")
                for k in ITEM_REQUIRED:
                    if k in it and not isinstance(it[k], str):
                        problems.append(f"items[{i}].{k} 必须是字符串")
    return problems


def check_discipline(d) -> list:
    """description 级纪律（不构成契约违规，提示行供人核对，不计入退出码）。"""
    notes = []
    if isinstance(d, dict) and d.get("receipt") is None:
        ev = d.get("evidence") or []
        if ev:
            notes.append(f"顶层 receipt=null 但 evidence 有 {len(ev)} 条——核对每条 evidence.receipt 是否自足（收据制：证据必须可回查）")
        summary = str(d.get("summary", ""))
        if COUNTY_RE.search(summary):
            notes.append("顶层 receipt=null 且 summary 含计数声明——报数必附收据（铁律 2），无收据 = 删声明")
    return notes


def cmd_validate(path: Path) -> int:
    if not path.exists():
        print(f"[ABORT] 输入不存在：{path}", file=sys.stderr)
        return 1
    try:
        d = json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:  # noqa: BLE001
        print(f"[ABORT] 输入不是合法 JSON：{path}（{e}）", file=sys.stderr)
        return 1
    problems = check_shape(d)
    if problems:
        print("[FAIL] diagnosis-report@1 契约校验不符（contracts/diagnosis-report.schema.json）：")
        for p in problems:
            print(f"  ! {p}")
        return 1
    print(f"OK：diagnosis-report@1 契约合法（items={len(d.get('items') or [])}，"
          f"evidence={len(d.get('evidence') or [])}，opinion={'有' if d.get('opinion') else '无'}，"
          f"receipt={d.get('receipt')!r}）")
    for n in check_discipline(d):
        print(f"  · 提示：{n}")
    return 0


def cmd_selfcheck() -> int:
    """fixture 过验 + 坏样本逐条点名（内存构造，零写盘副作用）。"""
    rc = cmd_validate(FIXTURE)
    print(f"selfcheck 1/2 validate(fixture) → exit {rc}")
    ok = rc == 0
    bad = {
        "format": "diagnosis-report@2", "project": "p", "items": [
            {"rule_ref": "kb/rules/x#AE-Y", "tier": "S", "severity": "fatal", "suggestion": "s"},
            {"tier": "A", "severity": "minor", "suggestion": "s", "note": "多余键"},
        ],
        "evidence": [{"quote": "无定位的证据"}],
        "engines": {"x": {"ran": True}}, "summary": 3, "receipt": 0, "extra": True,
    }
    problems = check_shape(bad)
    # 期望点名：format / 缺 target / engines 未知键 / evidence 缺 location / severity 非法
    #           / items[1] 缺 rule_ref / items[1] 未知键 / summary 类型 / receipt 类型 / 顶层未知键
    print(f"selfcheck 2/2 坏样本点名：{len(problems)} 处（期望 ≥9）：")
    for p in problems:
        print(f"    ! {p}")
    ok &= len(problems) >= 9
    print("selfcheck OK" if ok else "selfcheck FAIL")
    return 0 if ok else 1


def main() -> int:
    ap = argparse.ArgumentParser(description="diagnosis-validate · diagnosis-report@1 契约校验器（手工等价，stdlib）")
    ap.add_argument("report", nargs="?", help="诊断报告 JSON 路径")
    ap.add_argument("--map", action="store_true", help="打印 quality-scan 收据 → diagnosis-report@1 字段映射表后退出")
    ap.add_argument("--selfcheck", action="store_true", help="fixture 过验 + 坏样本点名（零写盘）")
    a = ap.parse_args()
    if a.selfcheck:
        return cmd_selfcheck()
    if a.map:
        print(__doc__.split("quality-scan 收据 → diagnosis-report@1")[1].split("用法：")[0].rstrip())
        return 0
    if not a.report:
        ap.error("需要 <report.json> 或 --selfcheck / --map")
        return 2
    path = Path(a.report)
    return cmd_validate(path if path.is_absolute() else ROOT / path)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
