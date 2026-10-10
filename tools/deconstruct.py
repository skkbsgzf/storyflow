#!/usr/bin/env python3
"""deconstruct · 拆（逆向）的确定性操作面：采样、报告过门、回流落卡。

契约：contracts/deconstruct.schema.json（deconstruct-report@1，批次3a P5 契约先行）。
拆相铁律（ARCHITECTURE §3.5「凡可被写的，都可被拆」）在本工具的落法：
  1. 抽样优先，禁止全书记忆化冒充拆书——sample 默认只抽头/中/尾各一单元（小样本起步），
     --expand N 才扩大；清单只带单元元数据（id/位置/字数），绝不搬运正文；--dump 一次只出
     一单元且限长（喂给 mf_deconstruct 时以【单元id】行标注单元边界）。
  2. findings 不等于规则——land 只收 status=reviewed 的报告（归因是人审后的落卡前置），
     draft/landed 显式拒绝；状态推进是人的动作，本工具永不代推。
  3. 卡是手工资产——落卡前逐卡过 rule-card@1 信封自检；同 id 卡已存在即拒绝（绝不静默覆盖）；
     全部 finding 先全量校验、再统一落盘（不产生半截落卡）。

子命令：
  sample <样本文件> [--unit 章节|场景|字数] [--expand N] [--window N] [--dump <单元id>]
      确定性采样：默认抽头/中/尾各一单元；章节=按 md 标题切分、场景=按空行块切分、
      字数=定长窗格（非重叠，--window 缺省 2000）。输出采样清单 JSON（单元 id/位置/字数），
      绝不搬运正文；--dump <id> 输出单单元原文（限长截断）供拼进 mf_deconstruct。
  report <拆书报告.json>
      对照 deconstruct-report@1 手工等价校验（逐条点名）+ 摘要
      （claim 数 / 域分布 / 证据覆盖度：无引文、引文超限、refs 悬空逐条点名）。
  land <拆书报告.json> --to global | land <拆书报告.json> --to project --project <id>
      回流通道：把 status=reviewed 的 candidate_card 落到 knowledge/deconstruct/<stem>.md
      （全局）或 projects/<id>/规则/<stem>.md（项目；id 显式改写 pj-rules/<项目id>/<stem>）。
      落卡前过 rule-card@1 信封自检；同 id 卡已存在拒绝；落完回写报告 status=landed，
      并提示重编译（全局 kit-compile / 项目 kit-compile --project）。
  --selfcheck
      合成 fixture 全链自测（三切分采样 / --expand / 确定性 / 清单零正文 / 好报告过门 /
      坏报告逐条点名 / land 的 draft 拒绝与幂等拒绝两态）——全程临时目录，零写真实
      knowledge/ 与真实 projects/。

退出码：0 成功；1 校验失败 / 拒绝 / 输入不存在；2 用法错误（argparse）。
校验为 contracts/deconstruct.schema.json 的手工等价（纯 stdlib，不引 jsonschema——本仓口径）。
"""
import argparse
import json
import re
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIXTURE = Path(__file__).resolve().parent / "__fixtures__" / "deconstruct-report-sample.json"

# ── 契约常量（与 contracts/deconstruct.schema.json 逐项对齐）─────────────────────
FORMAT = "deconstruct-report@1"
TOP_REQUIRED = ("format", "source", "sampling", "findings", "summary", "status")
TOP_KEYS = set(TOP_REQUIRED)  # additionalProperties: false
SOURCE_REQUIRED = ("title", "file")
SOURCE_KEYS = {"title", "file", "scope"}
SAMPLING_REQUIRED = ("mode", "units", "expanded")
SAMPLING_KEYS = {"mode", "units", "expanded", "note"}
UNIT_REQUIRED = ("id", "location", "chars")
UNIT_KEYS = {"id", "location", "chars", "title"}
FINDING_REQUIRED = ("dimension", "claim", "evidence", "provenance", "candidate_card")
FINDING_KEYS = set(FINDING_REQUIRED)
EVIDENCE_REQUIRED = ("location", "quote")
EVIDENCE_KEYS = {"location", "quote"}
MODES = ("章节", "场景", "片段")
REPORT_STATUSES = ("draft", "reviewed", "landed")
UNIT_ID_RE = re.compile(r"^u[0-9]{3,}$")
DIMENSION_RE = re.compile(r"^[a-z][a-z0-9-]*$")
QUOTE_MAX = 200  # evidence 引文限长（与 core/src/agent.ts DECONSTRUCT_QUOTE_MAX 一致）

# ── rule-card@1 信封（contracts/rule.schema.json；不走 kb/rules 家法，见 schema 说明）──
CARD_REQUIRED = ("id", "type", "title", "dimension", "version", "status",
                 "activation_hint", "provenance", "updated", "clauses")
CARD_KEYS = {"format", "id", "type", "title", "dimension", "version", "status",
             "activation_hint", "provenance", "updated", "clauses", "scanner_qids"}
CARD_STATUSES = ("active", "retired")
CARD_ID_RE = re.compile(r"^kb/deconstruct/([a-z0-9-]+)$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
CLAUSE_REQUIRED = ("rule_id", "tier", "severity", "detect", "judge", "repair", "provenance_refs")
CLAUSE_KEYS = {"rule_id", "tier", "severity", "detect", "judge", "evidence_fields",
               "repair", "provenance_refs"}
CLAUSE_ID_RE = re.compile(r"^DC-[A-Z0-9-]+$")  # DC- 前缀 = 样本提取出身（区别台账 AE-id）
TIERS = ("S", "A", "B")
SEVERITIES = ("block", "major", "minor")
QID_RE = re.compile(r"^[a-z]+\.[a-z0-9-]+\.v[0-9]+\.(noul|choice|score)$")

# ── 采样常量 ────────────────────────────────────────────────────────────────────
UNIT_MODES = ("章节", "场景", "字数")
DEFAULT_WINDOW = 2000   # 字数模式窗格（非重叠定长窗）
DUMP_MAX = 8000         # --dump 单单元原文限长（超长截断，绝不整本搬运）
HEADING_RE = re.compile(r"^#{1,6}\s")


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


def check_card(card, dimension_expected: str, where: str, problems):
    """rule-card@1 信封自检（落卡前必过）：必填键 / 值域 / id↔域一致性 / 条款结构。"""
    if not isinstance(card, dict):
        problems.append(f"{where}.candidate_card 必须是对象")
        return
    _check_obj(card, CARD_REQUIRED, CARD_KEYS, f"{where}.candidate_card", problems)
    cid = card.get("id")
    stem = None
    if isinstance(cid, str):
        m = CARD_ID_RE.match(cid)
        if not m:
            problems.append(f"{where}.candidate_card.id 形状非法 {cid!r}（须 kb/deconstruct/<域>-<来源slug>）")
        else:
            stem = m.group(1)
            if not stem.startswith(f"{dimension_expected}-") or stem == dimension_expected:
                problems.append(f"{where}.candidate_card.id 段名须为 <域>-<来源slug> 形状（域={dimension_expected}）：{stem!r}")
    if "format" in card and card.get("format") != "rule-card@1":
        problems.append(f"{where}.candidate_card.format 必须是 \"rule-card@1\"（现为 {card.get('format')!r}）")
    if "type" in card and card.get("type") != "rule-corpus":
        problems.append(f"{where}.candidate_card.type 必须是 \"rule-corpus\"（现为 {card.get('type')!r}）")
    for k in ("title", "version"):
        if k in card and (not isinstance(card[k], str) or not str(card[k]).strip()):
            problems.append(f"{where}.candidate_card.{k} 必须是非空字符串")
    dim = card.get("dimension")
    if "dimension" in card:
        if not isinstance(dim, str) or not DIMENSION_RE.match(dim):
            problems.append(f"{where}.candidate_card.dimension 形状非法 {dim!r}（小写 slug）")
        elif dim != dimension_expected:
            problems.append(f"{where}.candidate_card.dimension={dim!r} 与 finding.dimension={dimension_expected!r} 不一致")
    if "status" in card and card.get("status") not in CARD_STATUSES:
        problems.append(f"{where}.candidate_card.status 非法 {card.get('status')!r}（∈ active|retired）")
    hints = card.get("activation_hint")
    if "activation_hint" in card:
        if not isinstance(hints, list) or len(hints) == 0 or not all(isinstance(x, str) and x.strip() for x in hints):
            problems.append(f"{where}.candidate_card.activation_hint 必须是非空字符串数组（≥1 条）")
    prov = card.get("provenance")
    if "provenance" in card:
        if not isinstance(prov, dict):
            problems.append(f"{where}.candidate_card.provenance 必须是对象（source + refs）")
        else:
            _check_obj(prov, ("source", "refs"), {"source", "refs"}, f"{where}.candidate_card.provenance", problems)
            if not isinstance(prov.get("source"), str) or not prov["source"].strip():
                problems.append(f"{where}.candidate_card.provenance.source 必须是非空字符串（拆产物出身声明）")
            if not isinstance(prov.get("refs"), list):
                problems.append(f"{where}.candidate_card.provenance.refs 必须是数组（回溯采样单元）")
    if "updated" in card and (not isinstance(card["updated"], str) or not DATE_RE.match(card["updated"])):
        problems.append(f"{where}.candidate_card.updated 须为 YYYY-MM-DD（现为 {card.get('updated')!r}）")
    clauses = card.get("clauses")
    if "clauses" in card:
        if not isinstance(clauses, list) or len(clauses) == 0:
            problems.append(f"{where}.candidate_card.clauses 必须是非空数组（草稿卡至少一条条款）")
        else:
            for j, c in enumerate(clauses):
                cwhere = f"{where}.candidate_card.clauses[{j}]"
                if not isinstance(c, dict):
                    problems.append(f"{cwhere} 必须是对象")
                    continue
                _check_obj(c, CLAUSE_REQUIRED, CLAUSE_KEYS, cwhere, problems)
                rid = c.get("rule_id")
                if "rule_id" in c and (not isinstance(rid, str) or not CLAUSE_ID_RE.match(rid)):
                    problems.append(f"{cwhere}.rule_id 形状非法 {rid!r}（须 DC- 前缀——样本提取出身，"
                                    f"复用别卡 AE-id = 拆书结论造假）")
                for k in ("detect", "judge", "repair"):
                    if k in c and (not isinstance(c[k], str) or not c[k].strip()):
                        problems.append(f"{cwhere}.{k} 必须是非空字符串（拆的目的是一等公民条款）")
                if "tier" in c and c.get("tier") not in TIERS:
                    problems.append(f"{cwhere}.tier 非法 {c.get('tier')!r}（∈ S|A|B）")
                if "severity" in c and c.get("severity") not in SEVERITIES:
                    problems.append(f"{cwhere}.severity 非法 {c.get('severity')!r}（∈ block|major|minor）")
                pr = c.get("provenance_refs")
                if "provenance_refs" in c and (
                    not isinstance(pr, list) or len(pr) == 0 or not all(isinstance(x, str) and x for x in pr)
                ):
                    problems.append(f"{cwhere}.provenance_refs 必须非空（拆（逆向）回流条款必须带条款级来源）")
                ef = c.get("evidence_fields")
                if "evidence_fields" in c and (not isinstance(ef, list) or not all(isinstance(x, str) for x in ef)):
                    problems.append(f"{cwhere}.evidence_fields 必须是字符串数组")
    sq = card.get("scanner_qids")
    if "scanner_qids" in card and (not isinstance(sq, list) or not all(isinstance(x, str) and QID_RE.match(x) for x in sq)):
        problems.append(f"{where}.candidate_card.scanner_qids 须为 qid 形状字符串数组"
                        f"（<family>.<slug>.v<N>.<noul|choice|score>；拆流草稿应留空数组）")
    return stem


def check_shape(d) -> list:
    """对照 deconstruct-report@1 的手工等价校验：返回问题列表（空 = 通过），逐条点名不合并。"""
    problems = []
    if not isinstance(d, dict):
        return ["顶层必须是 JSON 对象"]
    if d.get("format") != FORMAT:
        problems.append(f"format 必须是 \"{FORMAT}\"（现为 {d.get('format')!r}）")
    _check_obj(d, TOP_REQUIRED, TOP_KEYS, "顶层", problems)
    # source
    src = d.get("source")
    if "source" in d:
        if not isinstance(src, dict):
            problems.append("source 必须是对象（title + file）")
        else:
            _check_obj(src, SOURCE_REQUIRED, SOURCE_KEYS, "source", problems)
            for k in SOURCE_REQUIRED:
                if k in src and (not isinstance(src[k], str) or not src[k].strip()):
                    problems.append(f"source.{k} 必须是非空字符串")
            if "scope" in src and not isinstance(src["scope"], str):
                problems.append("source.scope 必须是字符串")
    # sampling
    unit_ids: set = set()
    smp = d.get("sampling")
    if "sampling" in d:
        if not isinstance(smp, dict):
            problems.append("sampling 必须是对象（mode + units + expanded）")
        else:
            _check_obj(smp, SAMPLING_REQUIRED, SAMPLING_KEYS, "sampling", problems)
            if "mode" in smp and smp.get("mode") not in MODES:
                problems.append(f"sampling.mode 非法 {smp.get('mode')!r}（∈ 章节|场景|片段）")
            if "expanded" in smp and not isinstance(smp.get("expanded"), bool):
                problems.append("sampling.expanded 必须是布尔（扩采痕迹）")
            if "note" in smp and not isinstance(smp.get("note"), str):
                problems.append("sampling.note 必须是字符串")
            units = smp.get("units")
            if "units" in smp:
                if not isinstance(units, list) or len(units) == 0:
                    problems.append("sampling.units 必须是非空数组（抽样优先纪律的坐标系）")
                else:
                    for i, u in enumerate(units):
                        uwhere = f"sampling.units[{i}]"
                        if not isinstance(u, dict):
                            problems.append(f"{uwhere} 必须是对象")
                            continue
                        _check_obj(u, UNIT_REQUIRED, UNIT_KEYS, uwhere, problems)
                        uid = u.get("id")
                        if "id" in u:
                            if not isinstance(uid, str) or not UNIT_ID_RE.match(uid):
                                problems.append(f"{uwhere}.id 形状非法 {uid!r}（须 u001 式编号）")
                            elif uid in unit_ids:
                                problems.append(f"{uwhere}.id 重复：{uid}")
                            else:
                                unit_ids.add(uid)
                        if "location" in u and (not isinstance(u["location"], str) or not u["location"].strip()):
                            problems.append(f"{uwhere}.location 必须是非空字符串（样本内位置）")
                        if "chars" in u and (not isinstance(u["chars"], int) or isinstance(u["chars"], bool) or u["chars"] < 0):
                            problems.append(f"{uwhere}.chars 必须是非负整数")
                        if "title" in u and not isinstance(u["title"], str):
                            problems.append(f"{uwhere}.title 必须是字符串")
    # findings
    findings = d.get("findings")
    if "findings" in d:
        if not isinstance(findings, list):
            problems.append("findings 必须是数组（允许空——拆完一无所获也是诚实结论）")
        else:
            for i, f in enumerate(findings):
                fwhere = f"findings[{i}]"
                if not isinstance(f, dict):
                    problems.append(f"{fwhere} 必须是对象")
                    continue
                _check_obj(f, FINDING_REQUIRED, FINDING_KEYS, fwhere, problems)
                dim = f.get("dimension")
                dim_ok = isinstance(dim, str) and DIMENSION_RE.match(dim)
                if "dimension" in f and not dim_ok:
                    problems.append(f"{fwhere}.dimension 形状非法 {dim!r}（小写 slug，落卡域）")
                if "claim" in f and (not isinstance(f["claim"], str) or not f["claim"].strip()):
                    problems.append(f"{fwhere}.claim 必须是非空字符串（归因结论，不是样本复述）")
                evs = f.get("evidence")
                if "evidence" in f:
                    if not isinstance(evs, list) or len(evs) == 0:
                        problems.append(f"{fwhere}.evidence 必须是非空数组——无引文的 claim 不许产出（防编造）")
                    else:
                        for j, e in enumerate(evs):
                            ewhere = f"{fwhere}.evidence[{j}]"
                            if not isinstance(e, dict):
                                problems.append(f"{ewhere} 必须是对象")
                                continue
                            _check_obj(e, EVIDENCE_REQUIRED, EVIDENCE_KEYS, ewhere, problems)
                            if "location" in e and (not isinstance(e["location"], str) or not e["location"].strip()):
                                problems.append(f"{ewhere}.location 必须是非空字符串（单元id+单元内定位）")
                            q = e.get("quote")
                            if "quote" in e:
                                if not isinstance(q, str) or not q.strip():
                                    problems.append(f"{ewhere}.quote 必须是非空字符串（原文摘录）")
                                elif len(q) > QUOTE_MAX:
                                    problems.append(f"{ewhere}.quote 超长（{len(q)} > {QUOTE_MAX} 字）——报告只带引文，截断限长")
                prov = f.get("provenance")
                if "provenance" in f:
                    if not isinstance(prov, dict):
                        problems.append(f"{fwhere}.provenance 必须是对象（refs）")
                    else:
                        _check_obj(prov, ("refs",), {"refs"}, f"{fwhere}.provenance", problems)
                        refs = prov.get("refs")
                        if isinstance(refs, list):
                            if len(refs) == 0:
                                problems.append(f"{fwhere}.provenance.refs 必须非空（回溯采样单元）")
                            for r in refs:
                                if not isinstance(r, str) or not UNIT_ID_RE.match(r):
                                    problems.append(f"{fwhere}.provenance.refs 形状非法 {r!r}（须单元 id u001 式）")
                                elif unit_ids and r not in unit_ids:
                                    problems.append(f"{fwhere}.provenance.refs 悬空：{r} 不在 sampling.units（机器可溯断链）")
                check_card(f.get("candidate_card"), dim if dim_ok else "?", fwhere, problems)
    if not isinstance(d.get("summary"), str):
        problems.append("summary 必须是字符串（人读总结）")
    if "status" in d and d.get("status") not in REPORT_STATUSES:
        problems.append(f"status 非法 {d.get('status')!r}（∈ draft|reviewed|landed）")
    return problems


# ── 采样器（确定性）────────────────────────────────────────────────────────────
def split_units(text: str, mode: str, window: int) -> list:
    """切分采样单元：返回 [(meta, 正文)]，meta 含 location（与 title 若章节）。确定性：同输入同输出。"""
    units = []
    lines = text.splitlines()
    if mode == "章节":
        heads = [i for i, l in enumerate(lines) if HEADING_RE.match(l)]
        if not heads:
            raise SystemExit("[ABORT] 章节=按 md 标题切分，样本里没有 md 标题行——改用 --unit 场景|字数")
        segs = []
        if heads[0] > 0 and "\n".join(lines[:heads[0]]).strip():
            segs.append((0, heads[0], ""))  # 首个标题前的前置内容（如有）自成一体
        for a, b in zip(heads, heads[1:] + [len(lines)]):
            segs.append((a, b, lines[a].lstrip("#").strip()))
        for a, b, title in segs:
            body = "\n".join(lines[a:b])
            if body.strip():
                units.append(({"location": f"L{a + 1}-L{b}", "title": title}, body))
    elif mode == "场景":
        # 空行块：连续非空行聚成一块，空行分隔（剧本场景/段落块的确定性近似）
        start, cur = None, []
        for i, l in enumerate(lines + [""]):
            if l.strip():
                if cur == []:
                    start = i
                cur.append(l)
            elif cur:
                units.append(({"location": f"L{start + 1}-L{i}", "title": ""}, "\n".join(cur)))
                cur = []
        units = [(m, b) for m, b in units if b.strip()]
    elif mode == "字数":
        step = max(1, window)
        for s in range(0, len(text), step):
            body = text[s:s + step]
            if body.strip():
                units.append(({"location": f"C{s}-C{s + len(body)}", "title": ""}, body))
    else:
        raise SystemExit(f"[ABORT] --unit 非法：{mode}（∈ 章节|场景|字数）")
    out = []
    for k, (meta, body) in enumerate(units, 1):
        meta = dict(meta)
        meta["id"] = f"u{k:03d}"
        meta["chars"] = len(body)
        out.append((meta, body))
    return out


def pick_indices(total: int, expand) -> list:
    """选单元下标：缺省头/中/尾各一（小样本起步）；--expand N 在全距等距取 N（确定性）。"""
    if total == 0:
        return []
    if expand is None:
        return sorted({0, total // 2, total - 1})
    n = max(2, min(int(expand), total))
    return sorted({round(i * (total - 1) / (n - 1)) for i in range(n)})


def do_sample(path: Path, mode: str, expand, window: int, dump: str | None) -> dict:
    """sample 本体（selfcheck 复用）：返回清单 dict（不含正文）；dump 给定时返回单单元原文。"""
    if not path.exists():
        print(f"[ABORT] 样本文件不存在：{path}", file=sys.stderr)
        raise SystemExit(1)
    text = path.read_text(encoding="utf-8")
    units = split_units(text, mode, window)
    if not units:
        print("[ABORT] 切分后没有任何非空采样单元", file=sys.stderr)
        raise SystemExit(1)
    picks = pick_indices(len(units), expand)
    if expand is not None and int(expand) >= len(units):
        print(f"· 注意：--expand {expand} ≥ 总单元数 {len(units)}，已全量选中——抽样优先纪律：谨慎对待「全覆盖」，"
              f"先小样本验证规则假设再扩大（ARCHITECTURE §3.5）")
    n_lines = len(text.splitlines())
    manifest = {
        "source": {"file": str(path), "chars": len(text), "lines": n_lines},
        "sampling": {
            "mode": mode,
            "total_units": len(units),
            "selected": len(picks),
            "expanded": expand is not None,
            "note": "清单只含单元元数据（id/位置/字数），绝不搬运正文——原文按单元用 --dump 取（一次一单元、限长）；"
                    f"喂给 mf_deconstruct 时以【单元id】行标注单元边界，单元数 ≤6（DECONSTRUCT_MAX_UNITS）",
        },
        "units": [units[i][0] for i in picks],
    }
    if dump is not None:
        hit = [u for u in units if u[0]["id"] == dump]
        if not hit:
            known = ", ".join(u[0]["id"] for u in units)
            print(f"[ABORT] --dump {dump} 不在采样单元里（可用：{known}）——先看清单再取原文", file=sys.stderr)
            raise SystemExit(1)
        meta, body = hit[0]
        text_out = body if len(body) <= DUMP_MAX else body[:DUMP_MAX] + f"…(截断，全单元 {len(body)} 字)"
        return {"dumped": meta, "text": text_out}
    return manifest


# ── 落卡（land）────────────────────────────────────────────────────────────────
def render_card_md(card: dict, source: dict, sampling: dict) -> str:
    """落卡正文：确定性组装（内容全部来自卡自身与报告元数据，不发明内容）。"""
    clauses = card["clauses"]
    lines = [
        "---",
        json.dumps(card, ensure_ascii=False, indent=2),
        "---",
        "",
        f"# {card['title']} · {card['id']}",
        "",
        "> **本卡是语料不是闸**（v5.0 拍板：只用 agent，不用断言）。",
        "> 拆（逆向）回流卡：条款提炼自样本，归因结论已经人审（deconstruct-report@1 status=reviewed）；",
        "> severity 是评审优先级，**不构成提交拦截**；能确定性计数的条款归扫描器出收据证据。",
        "",
        "## 来源样本",
        "",
        f"- 样本：{source.get('title', '')}（{source.get('file', '')}）",
        f"- 抽样：{sampling.get('mode', '?')} × {len(sampling.get('units', []))} 单元"
        f"（expanded={'是' if sampling.get('expanded') else '否'}）；evidence 引文留存于拆书报告，为唯一随卡凭据",
        "",
        f"## 条款（{len(clauses)} 条，id 均为 DC- 样本出身）",
        "",
    ]
    for c in clauses:
        lines.append(f"- **【{c['rule_id']}｜{c['severity']}·tier {c['tier']}】** {c['detect']}")
        lines.append(f"  - 判定：{c['judge']}")
        lines.append(f"  - repair：{c['repair']}")
        lines.append(f"  - 来源：{'、'.join(c['provenance_refs'])}")
    lines.append("")
    return "\n".join(lines)


def cmd_land(path: Path, to: str, pid: str | None, root: Path) -> int:
    """回流：reviewed 报告的 candidate_card → 全局 knowledge/deconstruct/ 或项目 规则/。
    先全量校验（形状 + 信封 + 落位冲突），再统一落盘——不产生半截落卡。"""
    d = load_json(path)
    problems = check_shape(d)
    if problems:
        print("[FAIL] 报告形状不符（contracts/deconstruct.schema.json），拒绝落卡：")
        for p in problems:
            print(f"  ! {p}")
        return 1
    status = d.get("status")
    if status == "draft":
        print("[FAIL] status=draft——findings 不等于规则：归因是人审后的落卡前置，"
              "请人审（对引文、认归因、定条款）后把 status 手工推为 reviewed 再 land")
        return 1
    if status == "landed":
        print("[FAIL] status=landed——本报告已回流过；卡是手工资产，重复落卡请先人工处理旧卡")
        return 1
    findings = d["findings"]
    if not findings:
        print("[FAIL] findings 为空——没有草稿卡可落")
        return 1
    if to == "project" and not pid:
        print("[FAIL] --to project 需要 --project <projectId>（落 projects/<id>/规则/）")
        return 1
    # 全量核位：stem 派生 / 同报告内重名 / 目标已存在（幂等保护，绝不静默覆盖）
    plan = []
    for i, f in enumerate(findings):
        card = f["candidate_card"]
        stem = CARD_ID_RE.match(card["id"]).group(1)
        if to == "global":
            final_id, rel = card["id"], Path("knowledge") / "deconstruct" / f"{stem}.md"
        else:
            final_id = f"pj-rules/{pid}/{stem}"
            rel = Path("projects") / pid / "规则" / f"{stem}.md"
        if any(p["rel"] == rel for p in plan):
            print(f"[FAIL] findings[{i}] 落位与前面 finding 撞名：{rel}——同报告内卡 id 段名须唯一")
            return 1
        target = root / rel
        if target.exists():
            print(f"[FAIL] findings[{i}] 目标卡已存在：{rel}——同 id 卡已存在即拒绝（卡是手工资产，绝不静默覆盖；"
                  "要重落请先人工处理旧卡）")
            return 1
        plan.append({"i": i, "card": card, "final_id": final_id, "rel": rel, "target": target})
    # 统一落盘
    for p in plan:
        card = dict(p["card"])
        if card["id"] != p["final_id"]:
            print(f"· 卡 id 按落点命名空间改写：{card['id']} → {p['final_id']}")
            card["id"] = p["final_id"]
        p["target"].parent.mkdir(parents=True, exist_ok=True)
        p["target"].write_text(render_card_md(card, d["source"], d["sampling"]), encoding="utf-8", newline="\n")
        print(f"  + {p['rel']}  （{p['final_id']}，条款 {len(card['clauses'])} 条）")
    # 回写报告 status=landed（记账；报告由持有人留存）
    d["status"] = "landed"
    path.write_text(json.dumps(d, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"landed：{len(plan)} 张卡落位；报告已回写 status=landed（{path}）")
    if to == "global":
        print("next: python tools/kit-compile.py  （全局落卡重编译 → kit/hypergraph.rag.json，kb 检索方可命中）")
    else:
        print(f"next: python tools/kit-compile.py --project {pid}  （项目档编译 → projects/{pid}/kit/，"
              "core kb_search 带 project 可命中）")
    return 0


# ── 子命令壳 ───────────────────────────────────────────────────────────────────
def cmd_sample(args) -> int:
    r = do_sample(Path(args.file if Path(args.file).is_absolute() else ROOT / args.file),
                  args.unit, args.expand, args.window, args.dump)
    print(json.dumps(r, ensure_ascii=False, indent=1))
    return 0


def cmd_report(path: Path) -> int:
    d = load_json(path)
    problems = check_shape(d)
    findings = d.get("findings") if isinstance(d, dict) else None
    if isinstance(findings, list):
        dims: dict = {}
        for f in findings:
            if isinstance(f, dict) and isinstance(f.get("dimension"), str):
                dims[f["dimension"]] = dims.get(f["dimension"], 0) + 1
        ev_n = sum(len(f.get("evidence", [])) for f in findings if isinstance(f, dict) and isinstance(f.get("evidence"), list))
        print(f"摘要：claim {len(findings)} 条 / 域分布 {dims or '—'} / 证据 {ev_n} 条"
              f"（quote ≤{QUOTE_MAX} 字）")
    if problems:
        print(f"[FAIL] deconstruct-report@1 校验不符（{len(problems)} 处，逐条点名）：")
        for p in problems:
            print(f"  ! {p}")
        return 1
    smp = d.get("sampling") if isinstance(d, dict) else None
    smp_desc = f"{smp.get('mode')}×{len(smp.get('units', []))} 单元" if isinstance(smp, dict) else "?"
    print(f"OK：{FORMAT} 形状合法（status={d.get('status') if isinstance(d, dict) else '?'}，sampling={smp_desc}）")
    return 0


def cmd_selfcheck() -> int:
    """合成 fixture 全链自测——全程临时目录，零写真实 knowledge/ 与真实 projects/。"""
    ok = True

    def step(no: str, cond: bool, detail: str = ""):
        nonlocal ok
        ok &= bool(cond)
        print(f"selfcheck {no} {'OK' if cond else 'FAIL'}{('：' + detail) if detail else ''}")

    # 合成样本：5 章 md（含首个标题前的前置块、空行块）——纯合成文本，非任何真实语料
    chapters = [f"# 第{i}章 合成章{i}\n\n这是合成样本第{i}章的段落一。\n段落二用于空行块与字数切分验证。\n\n第二段继续。\n"
                for i in range(1, 6)]
    sample_text = "前置说明（首个标题前的前置块）。\n\n" + "\n".join(chapters)
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        sample_path = tmp / "合成样本.md"
        sample_path.write_text(sample_text, encoding="utf-8")
        # 1. 章节：默认头/中/尾 3 单元（5 章选 {0,2,4}），清单零正文
        r1 = do_sample(sample_path, "章节", None, DEFAULT_WINDOW, None)
        step("1/8 章节·默认小样本=3 单元且含前置块", r1["sampling"]["selected"] == 3 and r1["sampling"]["total_units"] == 6)
        step("1/8 清单零正文（绝不搬运）", "合成样本第1章的段落一" not in json.dumps(r1, ensure_ascii=False))
        # 2. --expand 等距扩采 + 确定性（同输入两次同输出）
        r2a = do_sample(sample_path, "章节", 6, DEFAULT_WINDOW, None)
        r2b = do_sample(sample_path, "章节", 6, DEFAULT_WINDOW, None)
        step("2/8 --expand 6 全量等距且确定性", [u["id"] for u in r2a["units"]] == ["u001", "u002", "u003", "u004", "u005", "u006"] and r2a == r2b)
        # 3. 场景（空行块）与字数（定长窗格）切分
        r3 = do_sample(sample_path, "场景", None, DEFAULT_WINDOW, None)
        step("3/8 场景=空行块", r3["sampling"]["mode"] == "场景" and r3["sampling"]["total_units"] >= 6)
        r4 = do_sample(sample_path, "字数", 2, 500, None)
        step("4/8 字数=定长窗格", r4["sampling"]["mode"] == "字数" and all(u["chars"] <= 500 for u in r4["units"]))
        # 5. --dump 单单元限长
        d5 = do_sample(sample_path, "章节", None, DEFAULT_WINDOW, "u001")
        step("5/8 --dump 单单元含正文", "前置说明" in d5["text"] and len(d5["text"]) <= DUMP_MAX + 40)
        # 6. report：合法 fixture 过门；坏报告逐条点名
        good = load_json(FIXTURE)
        p_good = check_shape(good)
        step("6/8 report(fixture) 合法", not p_good, "；".join(p_good))
        bad = json.loads(FIXTURE.read_text(encoding="utf-8"))
        bad["format"] = "deconstruct-report@0"
        bad["extra"] = "契约外键"
        bad["sampling"]["mode"] = "全本"                 # 非法切分模式
        bad["sampling"]["units"][0]["id"] = "unit-1"    # 单元 id 形状坏
        bad["findings"][0]["evidence"] = []           # 无引文 claim
        bad["findings"][0]["provenance"]["refs"] = ["u999"]  # 悬空 refs
        bad["findings"][1]["candidate_card"]["clauses"][0]["rule_id"] = "AE-HOOK-PRIOR"  # 搬运台账 id
        bad["findings"][1]["evidence"][0]["quote"] = "超" * (QUOTE_MAX + 1)              # 引文超限
        p_bad = check_shape(bad)
        step("6/8 坏报告逐条点名 ≥8 处", len(p_bad) >= 8, f"实点名 {len(p_bad)} 处")
        for p in p_bad:
            print(f"    ! {p}")
        # 7/8. land 两态（draft 拒绝 / reviewed 落位 + 幂等拒绝）——临时 global 根
        draft = json.loads(FIXTURE.read_text(encoding="utf-8"))
        draft["status"] = "draft"
        draft_path = tmp / "draft-report.json"
        draft_path.write_text(json.dumps(draft, ensure_ascii=False, indent=2), encoding="utf-8")
        groot = tmp / "groot"
        rc = cmd_land(draft_path, "global", None, groot)
        step("7/8 land draft 拒绝且零写盘", rc == 1 and not (groot / "knowledge").exists())
        rev_path = tmp / "rev-report.json"
        rev_path.write_text(FIXTURE.read_text(encoding="utf-8"), encoding="utf-8")
        rc = cmd_land(rev_path, "global", None, groot)
        landed = sorted(p.relative_to(groot).as_posix() for p in groot.rglob("*.md"))
        after = json.loads(rev_path.read_text(encoding="utf-8"))
        step("7/8 land reviewed 落 knowledge/deconstruct/ 且回写 landed",
             rc == 0 and landed == [f"knowledge/deconstruct/{s}.md" for s in ("dialogue-yangban-duibai", "hook-hecheng-gouzi")]
             and after["status"] == "landed", f"落位 {landed}")
        # 幂等拒绝走「同 id 卡已存在」分支：用新的 reviewed 副本（非 landed 态）落同一根
        rev2_path = tmp / "rev-report-2.json"
        rev2_path.write_text(FIXTURE.read_text(encoding="utf-8"), encoding="utf-8")
        rc = cmd_land(rev2_path, "global", None, groot)
        step("7/8 land 幂等拒绝（同 id 卡已存在）", rc == 1)
        # 8/8. land --to project：落 projects/<id>/规则/，id 显式改写 pj-rules 命名空间
        proot = tmp / "proot"
        pj_path = tmp / "pj-report.json"
        pj_path.write_text(FIXTURE.read_text(encoding="utf-8"), encoding="utf-8")
        rc = cmd_land(pj_path, "project", "p-synthetic-demo", proot)
        plo = sorted(p.relative_to(proot).as_posix() for p in proot.rglob("*.md"))
        card_txt = (proot / "projects" / "p-synthetic-demo" / "规则" / "hook-hecheng-gouzi.md").read_text(encoding="utf-8") if rc == 0 else ""
        step("8/8 land project 落 规则/ 且 id 改写 pj-rules/",
             rc == 0 and plo == ["projects/p-synthetic-demo/规则/dialogue-yangban-duibai.md",
                                 "projects/p-synthetic-demo/规则/hook-hecheng-gouzi.md"]
             and "pj-rules/p-synthetic-demo/hook-hecheng-gouzi" in card_txt, f"落位 {plo}")
    print("selfcheck OK" if ok else "selfcheck FAIL")
    return 0 if ok else 1


def main() -> int:
    ap = argparse.ArgumentParser(description="deconstruct · 拆（逆向）确定性操作面：sample / report / land（--selfcheck 自测）")
    ap.add_argument("command", nargs="?", choices=("sample", "report", "land"), help="子命令")
    ap.add_argument("file", nargs="?", help="样本文件（sample）或拆书报告 JSON（report/land）")
    ap.add_argument("--unit", choices=UNIT_MODES, default="章节", help="切分模式（缺省 章节）")
    ap.add_argument("--expand", type=int, default=None, help="扩采到 N 单元（等距取；缺省头/中/尾 3 单元）")
    ap.add_argument("--window", type=int, default=DEFAULT_WINDOW, help="字数模式窗格大小（缺省 2000）")
    ap.add_argument("--dump", default=None, help="输出指定单元原文（一次一单元、限长截断）")
    ap.add_argument("--to", choices=("global", "project"), default=None, help="land 落点：global=knowledge/deconstruct/ / project=projects/<id>/规则/")
    ap.add_argument("--project", dest="project", default=None, help="land --to project 的项目 id")
    ap.add_argument("--selfcheck", action="store_true", help="合成 fixture 全链自测（临时目录，零真实写盘）")
    a = ap.parse_args()
    if a.selfcheck:
        return cmd_selfcheck()
    if not a.command or not a.file:
        ap.error("需要 <command> <file> 或 --selfcheck")
        return 2
    path = Path(a.file)
    path = path if path.is_absolute() else ROOT / path
    if a.command == "sample":
        return cmd_sample(a)
    if a.command == "report":
        return cmd_report(path)
    return cmd_land(path, a.to, a.project, ROOT)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    sys.exit(main())
