#!/usr/bin/env python3
"""repair-apply · 修复改单（repair-plan@1）的确定性操作面：校验、预演、记账——绝不应用 diff。

契约：contracts/repair-plan.schema.json（repair-plan@1，批次2.5 P3 契约先行）。
改相铁律（ARCHITECTURE §3.1/§3.2/§3.3）在本工具的落法：
  1. 工具链只产 diff/改单，**绝不写正文**——本工具不做 diff 应用本身（应用 = 宿主拿
     mf_apply_repairs 产出的 diff 走 batch-edit/自家写盘面，人裁）；本工具只做三件事：
     校验形状、预演清单、推进状态并落收据。
  2. B 级绝不入单——schema tier 值域只有 S|A；本工具按 schema 手工等价校验再拒一次
     （纵深防御：LLM 产出的改单可能绕过契约），B 级条款逐条点名拒绝。
  3. 同源铁律——dry-run 逐条对盘上规则卡核账（卡存在 / 条款存在 / tier·repair 与卡面一致），
     改单发明卡外策略 = 非法。

子命令：
  validate <plan.json>               对照 repair-plan@1 手工等价校验（纯形状，不读卡）
  dry-run  <plan.json>               列出将应用的 items（rule_ref/tier/target/repair），
                                     B 级拒绝点名；逐条对盘上规则卡核账（同源核账）
  status   <plan.json> [--set applied|rejected|rolled_back] [--item <rule_ref>]
                                     [--no-receipt]
                                     状态记账：proposed→applied｜proposed→rejected｜
                                     applied→rolled_back（回滚走 snapshots，收据留痕）；
                                     不带 --set 时只打印当前状态表（只读）
  --selfcheck                        fixture 全链自测（合法单过验 / 坏单逐条点名 / dry-run
                                     核账 / 状态转移与非法转移；全程临时目录 + --no-receipt，
                                     零写盘副作用）

退出码：0 成功；1 校验失败 / 核账失败 / 状态转移非法 / 输入不存在；2 用法错误（argparse）。
状态推进默认落收据（铁律 2：报数必附收据）至 projects/<id>/内部/收据/，--no-receipt 关闭
（仅调试用；宿主推进 applied/rolled_back 必须凭收据）。
"""
import argparse
import datetime as dt
import json
import re
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIXTURE = Path(__file__).resolve().parent / "__fixtures__" / "repair-plan-sample.json"

# repair-plan@1 手工等价校验的形状常量（与 contracts/repair-plan.schema.json 逐项对齐；
# lint 不引 jsonschema 是本仓口径——这里是校验器本体，同样纯 stdlib 手工核对）
TOP_REQUIRED = ("format", "project", "target", "diagnosis_ref", "items", "summary")
TOP_KEYS = set(TOP_REQUIRED)  # additionalProperties: false
ITEM_REQUIRED = ("rule_ref", "repair", "tier", "status")
ITEM_OPTIONAL = ("target", "diff", "receipt")
ITEM_KEYS = set(ITEM_REQUIRED) | set(ITEM_OPTIONAL)
TIERS = ("S", "A")  # 值域刻意不含 B——B 级绝不自动改稿（ARCHITECTURE §3.3）
STATUSES = ("proposed", "applied", "rejected", "rolled_back")
RULE_REF_RE = re.compile(r"^kb/rules/[a-z0-9-]+#AE-[A-Z0-9-]+$")
# 合法状态转移（记账口径）：产出(proposed) → 人裁应用(applied)/否决(rejected)；已应用可回滚
TRANSITIONS = {
    ("proposed", "applied"),
    ("proposed", "rejected"),
    ("applied", "rolled_back"),
}


def load_json(path: Path):
    if not path.exists():
        print(f"[ABORT] 输入不存在：{path}", file=sys.stderr)
        raise SystemExit(1)
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:  # noqa: BLE001
        print(f"[ABORT] 输入不是合法 JSON：{path}（{e}）", file=sys.stderr)
        raise SystemExit(1)


def _check_obj(d: dict, required, allowed, where, problems):
    """对象必填键 + additionalProperties:false 的手工等价（逐键点名）。"""
    for k in required:
        if k not in d:
            problems.append(f"{where} 缺必填键: {k}")
    for k in d:
        if k not in allowed:
            problems.append(f"{where} 未知键（契约 additionalProperties=false）: {k}")


def check_shape(d) -> list:
    """对照 repair-plan@1 的手工等价校验：返回问题列表（空 = 通过），逐条点名不合并。"""
    problems = []
    if not isinstance(d, dict):
        return ["顶层必须是 JSON 对象"]
    if d.get("format") != "repair-plan@1":
        problems.append(f"format 必须是 \"repair-plan@1\"（现为 {d.get('format')!r}）")
    _check_obj(d, TOP_REQUIRED, TOP_KEYS, "顶层", problems)
    for k in ("project", "target", "summary"):
        if k in d and not isinstance(d[k], str):
            problems.append(f"顶层 {k} 必须是字符串（现为 {type(d[k]).__name__}）")
    if "diagnosis_ref" in d and not (d["diagnosis_ref"] is None or isinstance(d["diagnosis_ref"], str)):
        problems.append("顶层 diagnosis_ref 必须是字符串或 null（无报告凭据的改单显式记 null）")
    items = d.get("items")
    if not isinstance(items, list) or len(items) == 0:
        problems.append("items 必须是非空数组（至少一条修订才进得了改相）")
        return problems
    for i, it in enumerate(items):
        where = f"items[{i}]"
        if not isinstance(it, dict):
            problems.append(f"{where} 必须是对象")
            continue
        _check_obj(it, ITEM_REQUIRED, ITEM_KEYS, where, problems)
        rr = it.get("rule_ref")
        if rr is not None and not isinstance(rr, str):
            problems.append(f"{where}.rule_ref 必须是字符串")
        elif isinstance(rr, str) and not RULE_REF_RE.match(rr):
            problems.append(f"{where}.rule_ref 形状非法 {rr!r}（须 kb/rules/<域>#<AE-id>，指向规则卡条款）")
        rep = it.get("repair")
        if rep is not None and (not isinstance(rep, str) or not rep.strip()):
            problems.append(f"{where}.repair 必须是非空字符串（逐字取自卡内 clauses[].repair）")
        tier = it.get("tier")
        if tier is not None and tier not in TIERS:
            hint = "——B 级主观审美绝不自动改稿（ARCHITECTURE §3.3），禁止入改单" if tier == "B" else ""
            problems.append(f"{where}.tier 非法 {tier!r}（值域 S|A，刻意不含 B）{hint}")
        st = it.get("status")
        if st is not None and st not in STATUSES:
            problems.append(f"{where}.status 非法 {st!r}（∈ proposed|applied|rejected|rolled_back）")
        for k in ("diff", "receipt"):
            if k in it and not (it[k] is None or isinstance(it[k], str)):
                problems.append(f"{where}.{k} 必须是字符串或 null")
        tgt = it.get("target")
        if "target" in it and tgt is not None:
            if not isinstance(tgt, dict):
                problems.append(f"{where}.target 必须是对象（file 必填 + line/anchor 可选）")
            else:
                if "file" not in tgt or not isinstance(tgt["file"], str) or not tgt["file"]:
                    problems.append(f"{where}.target.file 缺失或非字符串（修改定位必须有文件）")
                for k in ("line", "anchor"):
                    if k in tgt and k == "line" and not isinstance(tgt[k], int):
                        problems.append(f"{where}.target.line 必须是整数")
                    if k in tgt and k == "anchor" and not isinstance(tgt[k], str):
                        problems.append(f"{where}.target.anchor 必须是字符串（原文锚）")
                for k in tgt:
                    if k not in ("file", "line", "anchor"):
                        problems.append(f"{where}.target 未知键: {k}")
    return problems


def load_clause(card_stem: str):
    """读盘上规则卡（knowledge/rules/<域>.md）frontmatter 的 clauses；卡不存在返回 None。"""
    p = ROOT / "knowledge" / "rules" / f"{card_stem}.md"
    if not p.exists():
        return None
    m = re.match(r"^---\r?\n(.*?)\r?\n---\r?\n", p.read_text(encoding="utf-8"), re.S)
    if not m:
        raise SystemExit(f"[ABORT] 规则卡缺 frontmatter：{p}")
    fm = json.loads(m.group(1))
    return {c.get("rule_id"): c for c in fm.get("clauses", [])}


def crosscheck_cards(plan: dict) -> list:
    """同源核账（dry-run 用）：逐条对盘上规则卡核对卡存在 / 条款存在 / tier·repair 与卡面一致。"""
    problems = []
    for i, it in enumerate(plan.get("items", [])):
        rr = str(it.get("rule_ref", ""))
        m = RULE_REF_RE.match(rr)
        if not m:
            continue  # 形状错已由 check_shape 点名，此处不重复记账
        card_stem, clause_id = rr.split("#", 1)
        card_stem = card_stem.removeprefix("kb/rules/")  # rule_ref 已带 kb/rules/ 前缀，盘上路径按域文件名拼
        clauses = load_clause(card_stem)
        if clauses is None:
            problems.append(f"items[{i}] 卡不存在：kb/rules/{card_stem}（盘上无 knowledge/rules/{card_stem}.md）")
            continue
        clause = clauses.get(clause_id)
        if clause is None:
            problems.append(f"items[{i}] 条款不存在：{rr}（卡内 clauses 无 rule_id={clause_id}）")
            continue
        if clause.get("tier") != it.get("tier"):
            problems.append(f"items[{i}] tier={it.get('tier')!r} 与卡面标注（{clause.get('tier')!r}）不一致——分级以卡为唯一真源：{rr}")
        if clause.get("repair") != it.get("repair"):
            problems.append(f"items[{i}] repair 与卡面不一致——同源铁律：改单不得发明卡外策略（卡 {rr} 的 repair 原文：「{clause.get('repair')}」）")
    return problems


def print_items(plan: dict) -> int:
    """dry-run 清单：将应用 items 逐条列出（rule_ref/tier/target/repair）。"""
    n = 0
    for i, it in enumerate(plan.get("items", [])):
        tgt = it.get("target") or {}
        loc = tgt.get("file", plan.get("target", ""))
        if tgt.get("line") is not None:
            loc += f":{tgt['line']}"
        print(f"  [{i}] {it.get('rule_ref')}  tier={it.get('tier')}  status={it.get('status')}")
        print(f"      定位: {loc}" + (f"  锚: {tgt['anchor'][:40]}" if tgt.get("anchor") else ""))
        print(f"      策略: {it.get('repair')}")
        n += 1
    return n


def write_receipt(plan: dict, plan_path: Path, action: str, changed: list) -> Path:
    """状态推进收据（铁律 2）：落 projects/<id>/内部/收据/，项目目录缺席时落改单同目录。"""
    ts = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    pid = str(plan.get("project") or "").strip()
    base = ROOT / "projects" / pid / "内部" / "收据" if pid else plan_path.resolve().parent
    base.mkdir(parents=True, exist_ok=True)
    p = base / f"repair-apply-{plan_path.stem}-{ts}.md"
    lines = [
        f"# repair-apply 收据 · {action}",
        "",
        f"- 时间：{dt.datetime.now().isoformat(timespec='seconds')}",
        f"- 工具链：tools/repair-apply.py（改单记账面——校验/预演/状态推进，不做 diff 应用）",
        f"- 改单：{plan_path}",
        f"- 项目：{pid or '（改单未记项目，收据落改单同目录）'}",
        f"- 动作：{action}",
        "",
        "逐条记账：",
    ]
    for rr, old, new in changed:
        lines.append(f"  - {rr}: {old} → {new}")
    lines += [
        "",
        "边界声明：本收据只记改单状态转移，不代表正文已被修改；应用（写盘）归宿主拿 diff",
        "走 batch-edit/自家写盘面，人裁；回滚走 snapshots（rolled_back 条目同样在此留痕）。",
        "",
        f"复现命令：`python tools/repair-apply.py status {plan_path} --set {action.split('→')[-1] if '→' in action else action}`",
    ]
    p.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return p


def cmd_validate(path: Path) -> int:
    d = load_json(path)
    problems = check_shape(d)
    if problems:
        print(f"[FAIL] repair-plan@1 形状校验不符（contracts/repair-plan.schema.json）：")
        for p in problems:
            print(f"  ! {p}")
        return 1
    print(f"OK：repair-plan@1 形状合法（items={len(d['items'])}，diagnosis_ref={d.get('diagnosis_ref')!r}）")
    return 0


def cmd_dry_run(path: Path) -> int:
    plan = load_json(path)
    problems = check_shape(plan)
    if problems:
        print("[FAIL] 形状校验不符（先修形状再看清单）：")
        for p in problems:
            print(f"  ! {p}")
        return 1
    problems = crosscheck_cards(plan)
    print(f"dry-run · 将应用的 items（{len(plan['items'])} 条；diff 应用本身不在本工具——宿主拿 diff 人裁后写盘）：")
    print_items(plan)
    if problems:
        print("同源核账失败：")
        for p in problems:
            print(f"  ! {p}")
        return 1
    print("同源核账通过：全部条款在盘上卡面有据（卡/条款/tier/repair 逐条一致，无 B 级入单）")
    return 0


def cmd_status(path: Path, set_to: str | None, item_filter: str | None, no_receipt: bool) -> int:
    plan = load_json(path)
    problems = check_shape(plan)
    if problems:
        print("[FAIL] 改单形状不符，拒绝记账：")
        for p in problems:
            print(f"  ! {p}")
        return 1
    if set_to is None:
        print(f"当前状态（{path}）：")
        for it in plan["items"]:
            print(f"  {it['rule_ref']}  {it['status']}  receipt={it.get('receipt')}")
        return 0
    targets = [it for it in plan["items"] if item_filter is None or it["rule_ref"] == item_filter]
    if item_filter and not targets:
        print(f"[FAIL] --item {item_filter} 未命中改单内任何条款")
        return 1
    changed, skipped = [], []
    for it in targets:
        old = it["status"]
        if (old, set_to) not in TRANSITIONS:
            skipped.append((it["rule_ref"], old))
            continue
        it["status"] = set_to
        changed.append((it["rule_ref"], old, set_to))
    if not changed:
        print("[FAIL] 没有任何条款可转移：" + (f"非法转移 {targets[0]['status']}→{set_to}" if targets else "空"))
        for rr, old in skipped:
            print(f"  ! {rr}: {old}→{set_to} 不在合法转移表（proposed→applied｜proposed→rejected｜applied→rolled_back）")
        return 1
    for rr, old in skipped:
        print(f"  · 跳过 {rr}（{old}→{set_to} 非法转移）")
    path.write_text(json.dumps(plan, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"状态已推进（{len(changed)} 条）：")
    for rr, old, new in changed:
        print(f"  · {rr}: {old} → {new}")
    if no_receipt:
        print("（--no-receipt：未落收据——仅调试可用；宿主推进必须凭收据，铁律 2）")
    else:
        rcpt = write_receipt(plan, path, f"{changed[0][1]}→{set_to}", changed)
        print(f"收据：{rcpt}")
    return 0


def cmd_selfcheck() -> int:
    """fixture 全链自测：合法单过验 / 坏单逐条点名 / dry-run 核账 / 状态转移与非法转移。零写盘副作用。"""
    ok = True
    # 1. 合法 fixture：validate 过 + dry-run 过（同源核账对真实卡面）
    rc = cmd_validate(FIXTURE)
    print(f"selfcheck 1/4 validate(fixture) → exit {rc}")
    ok &= rc == 0
    rc = cmd_dry_run(FIXTURE)
    print(f"selfcheck 2/4 dry-run(fixture，对盘上卡核账) → exit {rc}")
    ok &= rc == 0
    with tempfile.TemporaryDirectory() as td:
        # 2. 坏单：B 级入单 + rule_ref 形状坏 + 缺必填 + 未知键——逐条点名，一条不少
        bad = {
            "format": "repair-plan@1", "project": "p", "target": "x.md", "diagnosis_ref": None,
            "items": [
                {"rule_ref": "kb/rules/pacing#AE-CUSHION", "repair": "垫一场戏", "tier": "B", "status": "proposed"},
                {"rule_ref": "curve#AE-CURVE-TYPE", "repair": "", "status": "proposed"},
            ],
            "summary": "", "extra": "契约外键",
        }
        bad_path = Path(td) / "bad-plan.json"
        bad_path.write_text(json.dumps(bad, ensure_ascii=False), encoding="utf-8")
        problems = check_shape(json.loads(bad_path.read_text(encoding="utf-8")))
        expect = 4  # B 级 tier / rule_ref 形状 / repair 空串 / 未知顶层键（AE-CUSHION 在盘上 tier=B，核账在 dry-run 层）
        hit = len(problems)
        print(f"selfcheck 3/4 坏单点名：{hit} 处（期望 ≥{expect}）：")
        for p in problems:
            print(f"    ! {p}")
        ok &= hit >= expect
        # 3. 状态转移：proposed→applied 合法；applied→applied 非法（均在临时副本 + --no-receipt）
        plan_path = Path(td) / "plan.json"
        plan_path.write_text(FIXTURE.read_text(encoding="utf-8"), encoding="utf-8")
        rc = cmd_status(plan_path, "applied", None, no_receipt=True)
        print(f"selfcheck 4/4 status proposed→applied（临时副本，--no-receipt）→ exit {rc}")
        ok &= rc == 0
        rc = cmd_status(plan_path, "applied", None, no_receipt=True)
        print(f"selfcheck 4/4 status applied→applied（应判非法）→ exit {rc}")
        ok &= rc == 1
        after = json.loads(plan_path.read_text(encoding="utf-8"))
        ok &= all(it["status"] == "applied" for it in after["items"])
    print("selfcheck OK" if ok else "selfcheck FAIL")
    return 0 if ok else 1


def main() -> int:
    ap = argparse.ArgumentParser(description="repair-apply · 修复改单（repair-plan@1）校验/预演/记账（不做 diff 应用）")
    ap.add_argument("command", nargs="?", choices=("validate", "dry-run", "status"), help="子命令")
    ap.add_argument("plan", nargs="?", help="改单 JSON 路径（repair-plan@1）")
    ap.add_argument("--set", dest="set_to", choices=("applied", "rejected", "rolled_back"), help="推进到的状态（缺省只读打印状态表）")
    ap.add_argument("--item", help="只推进匹配 rule_ref 的条款（缺省全部可转移条款）")
    ap.add_argument("--no-receipt", action="store_true", help="状态推进不落收据（仅调试；宿主推进必须凭收据）")
    ap.add_argument("--selfcheck", action="store_true", help="fixture 全链自测（零写盘副作用）")
    a = ap.parse_args()
    if a.selfcheck:
        return cmd_selfcheck()
    if not a.command or not a.plan:
        ap.error("需要 <command> <plan.json> 或 --selfcheck")
        return 2
    path = Path(a.plan)
    path = path if path.is_absolute() else ROOT / path
    if a.command == "validate":
        return cmd_validate(path)
    if a.command == "dry-run":
        return cmd_dry_run(path)
    return cmd_status(path, a.set_to, a.item, a.no_receipt)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
