#!/usr/bin/env python3
"""flow@1 → flow@2 迁移器（规范 R4 §五）。纯 stdlib。

做的事（全部机械、可回滚）：
  1. 节点字段唯一化：file→output、check→asserts；删除与 stage 重复的 review、已收编的 kb
  2. 产物路径按目录准入规则归位（内部/{意见,收据,依据,稿本} · 对外交付/ · 世界书/ · 根级输入）
  3. 边：补 role、结构化 when、删冗余 transform、补 params、id 统一 e- 前缀
  4. 顶层：format → flow@2、补 status

**文本级迁移**：只改需要改的片段，不动其余排版（紧凑单行节点保持单行、多行边保持多行）。
用法：python tools/flow-normalize.py [--check]
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REVIEW_OPS = {"plot-redline", "novel-judge"}
OPINION_HINTS = ("意见书", "评审表")
CANON_HINTS = ("圣经", "bible", "Bible")
NODE_SUFFIX = re.compile(r"-(?:R\d+|S\d+|终稿|抽检|初稿|大纲)$")


def load(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def strict_load(text: str, ctx: str) -> dict:
    """解析并拒绝重复键。JSON 规范允许重复键（后者胜），但文本级字段手术极易造出重复键——
    一旦出现，读者看到的语义与内核看到的语义不一致（曾致 role 双写、loop 语义丢失）。"""
    dups: list[str] = []

    def hook(pairs):
        keys = [k for k, _ in pairs]
        for k in dict.fromkeys(keys):
            if keys.count(k) > 1:
                dups.append(k)
        return dict(pairs)

    data = json.loads(text, object_pairs_hook=hook)
    if dups:
        raise ValueError(f"{ctx}: JSON 存在重复键 {sorted(set(dups))} —— 迁移器产出非法结构")
    return data


# ---------- 文本片段定位 ----------

def brace_span(text: str, start: int) -> tuple[int, int]:
    """从 start 处的 '{' 起做花括号配对，返回 (start, end)（end 为闭合括号之后）。"""
    depth = 0
    in_str = False
    esc = False
    i = start
    while i < len(text):
        ch = text[i]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
        else:
            if ch == '"':
                in_str = True
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    return start, i + 1
        i += 1
    raise ValueError("花括号不配对")


def node_spans(text: str) -> dict[str, tuple[int, int]]:
    """nodes 对象内每个节点的文本区间。"""
    m = re.search(r'"nodes"\s*:\s*\{', text)
    if not m:
        raise ValueError('未找到 "nodes"')
    out: dict[str, tuple[int, int]] = {}
    i = m.end()
    while i < len(text):
        km = re.compile(r'\s*"([A-Za-z0-9_\-]+)"\s*:\s*\{').match(text, i)
        if not km:
            break
        span = brace_span(text, km.end() - 1)
        out[km.group(1)] = span
        i = span[1]
        nxt = re.compile(r'\s*,\s*').match(text, i)
        if not nxt:
            break
        i = nxt.end()
    return out


def edge_spans(text: str) -> list[tuple[int, int]]:
    m = re.search(r'"edges"\s*:\s*\[', text)
    if not m:
        return []
    spans = []
    i = m.end()
    while i < len(text):
        j = text.find("{", i)
        if j < 0:
            break
        # 数组已闭合则停
        close = text.find("]", i)
        if 0 <= close < j:
            break
        span = brace_span(text, j)
        spans.append(span)
        i = span[1]
    return spans


def array_span(text: str, key: str) -> tuple[int, int] | None:
    """顶层（2 空格缩进）`"key": [ ... ]` 的方括号区间（返回含括号的 (start, end)）。
    限定缩进以免命中嵌套同名字段（顶层 outputs 与 graph.outputs 是两个概念）。"""
    m = re.search(r'\n  "' + key + r'"\s*:\s*\[', text)
    if not m:
        return None
    start = m.end() - 1
    depth, in_str, esc, i = 0, False, False, start
    while i < len(text):
        ch = text[i]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
        else:
            if ch == '"':
                in_str = True
            elif ch in "[{":
                depth += 1
            elif ch in "]}":
                depth -= 1
                if depth == 0:
                    return start, i + 1
        i += 1
    raise ValueError(f'"{key}" 数组不闭合')


# ---------- 归类规则 ----------

def opinion_name(base: str, node_id: str) -> str:
    stem = base[:-3] if base.endswith(".md") else base
    stem = NODE_SUFFIX.sub("", stem)
    return f"{stem}-{node_id}.md"


ADMITTED = ("内部/意见/", "内部/收据/", "内部/依据/", "内部/稿本/", "对外交付/", "章节正文/", "世界书/")


def classify(node: dict, node_id: str, deliverable: dict[str, str]) -> str | None:
    """节点产物路径（规范 R4 §一 的准入规则）。deliverable 仅收 对外交付/ 的交付出口。"""
    if node_id in deliverable:
        return deliverable[node_id]
    cur = node.get("output") or node.get("file")
    if not cur:
        return None
    cur = cur.replace("\\", "/")
    # 已落在准入目录内 → 保持不动（保证幂等，避免二次迁移重复加节点后缀）
    if cur.startswith(ADMITTED):
        return cur
    base = cur.split("/")[-1]
    kind = node.get("kind")
    if kind == "novel-txt":
        return base  # 根级输入材料
    if kind == "gate":
        return f"内部/意见/{opinion_name(base, node_id)}"
    if kind == "core":
        # 收据 = 零 token 确定性工具的全部输出（kb_load 的输入快照归 依据/）
        return f"内部/依据/{base}" if node.get("minitool") == "kb_load" else f"内部/收据/{base}"
    if kind == "agent":
        op = node.get("op") or ""
        if op in REVIEW_OPS or any(h in base for h in OPINION_HINTS):
            return f"内部/意见/{opinion_name(base, node_id)}"
        if any(h in base for h in CANON_HINTS):
            return "世界书/世界观圣经.md"  # canon 成品统一命名进 世界书/
        if base.startswith(("正文-", "终稿-")) or node.get("iterate"):
            return f"章节正文/{base}"  # 成文产物：交付级槽位
        return f"内部/稿本/{base}"
    return cur


def set_field(span: str, key: str, value_json: str) -> tuple[str, bool]:
    """设值；字段不存在则插入。兼容紧凑单行与多行两种排版。返回 (新span, 是否已存在)。"""
    pat = re.compile(r'("' + key + r'"\s*:\s*)(?:"(?:[^"\\]|\\.)*"|[^,}\n]+)')
    if pat.search(span):
        return pat.sub(lambda m: m.group(1) + value_json, span, count=1), True
    # 插入：多行排版插在闭合括号前一行；单行排版插在 } 之前
    nl = span.rfind("\n")
    if nl > 0:
        close = span.rfind("}")
        indent_m = re.search(r"\n([ \t]*)\}", span)
        indent = indent_m.group(1) + "  " if indent_m else "  "
        head = span[:close].rstrip()
        if head.endswith(","):
            head = head[:-1]
        if head.endswith("{"):
            sep = "\n"
        else:
            sep = ",\n"
        return head + sep + f'{indent}"{key}": {value_json}\n' + span[close:], False
    close = span.rfind("}")
    head = span[:close].rstrip()
    if head.endswith(","):
        head = head[:-1]
    sep = " " if head.endswith("{") else ", "
    return head + sep + f'"{key}": {value_json} ' + span[close:], False


# ---------- 节点改写（字段级，保排版） ----------

def drop_field(span: str, key: str) -> str:
    """从文本对象里删掉一个 `"key": <标量>` 字段（含其行的缩进/逗号）。"""
    val = r'"(?:[^"\\]|\\.)*"'
    out = re.sub(r'\n[ \t]*"' + key + r'"\s*:\s*' + val + r'\s*(,)?', "", span, count=1)
    if '"' + key + '"' in out:
        out = re.sub(r'"' + key + r'"\s*:\s*' + val + r'\s*,\s*', "", out, count=1)
    if '"' + key + '"' in out:
        out = re.sub(r'\s*,\s*"' + key + r'"\s*:\s*' + val, "", out, count=1)
    return out


def rewrite_node(span: str, node: dict, node_id: str, new_path: str | None, log: list[str]) -> str:
    out = span
    has_file = '"file"' in out
    has_output = '"output"' in out

    if has_file and has_output:
        # 病灶：同一概念两个字段名（file vs output）。output 为准，删 file。
        cur_out = (node.get("output") or "").replace("\\", "/")
        cur_file = (node.get("file") or "").replace("\\", "/")
        out = drop_field(out, "file")
        note = f"（file={cur_file} ≠ output={cur_out}，取 output）" if cur_file != cur_out else ""
        log.append(f"  {node_id}: 删 file（与 output 重复声明）{note}")
    elif has_file:
        out = re.sub(r'"file"(\s*:\s*)', r'"output"\1', out, count=1)
    if new_path:
        out, existed = set_field(out, "output", json.dumps(new_path, ensure_ascii=False))
        if not existed:
            log.append(f"  {node_id}: 补 output = {new_path}（原仅由 outputs[] 声明）")

    # 节点级 when（可选模块开关）：与边同构，字符串 → 结构化谓词
    if re.search(r'"when"\s*:\s*"', out):
        mw = re.search(r'"when"\s*:\s*"((?:[^"\\]|\\.)*)"', out)
        raw_w = mw.group(1) if mw else ""
        sw = struct_when(raw_w, node_id)
        if isinstance(sw, dict):
            out = re.sub(
                r'"when"(\s*:\s*)"(?:[^"\\]|\\.)*"',
                lambda mm: '"when"' + mm.group(1) + json.dumps(sw, ensure_ascii=False),
                out,
                count=1,
            )
            log.append(f"  {node_id}: when 字符串 → 结构化 {json.dumps(sw, ensure_ascii=False)}")
        else:
            log.append(f"  ! {node_id}: when 无法结构化「{raw_w}」——交给 lint 报 block")

    # check → asserts（唯一字段名）
    if '"check"' in out:
        out = re.sub(r'"check"(\s*:\s*)', r'"asserts"\1', out, count=1)
        log.append(f"  {node_id}: check → asserts")

    # review：取值恒等于 stage（gate 与 agent 皆是）——重复声明，删
    if re.search(r'"review"\s*:', out):
        out2 = re.sub(r'\n?\s*"review"\s*:\s*"(?:[^"\\]|\\.)*"\s*,?', "", out, count=1)
        if '"review"' in out2:
            out2 = re.sub(r'"review"\s*:\s*"(?:[^"\\]|\\.)*"\s*,\s*', "", out2, count=1)
        if '"review"' not in out2:
            out = out2
            log.append(f"  {node_id}: 删 review（取值与 stage 重复）")

    # kb：已收编进 kit.json
    if '"kb"' in out:
        out2 = re.sub(r'\n?\s*"kb"\s*:\s*\[[^\]]*\]\s*,?', "", out, count=1)
        if '"kb"' in out2:
            out2 = re.sub(r'"kb"\s*:\s*\[[^\]]*\]\s*,\s*', "", out2, count=1)
        if '"kb"' not in out2:
            out = out2
            log.append(f"  {node_id}: 删 kb（已收编进 kit.json）")

    # 收尾：对象内最后一个字段后不留逗号
    out = re.sub(r',(\s*\n\s*)\}', r'\1}', out)
    out = re.sub(r',(\s*)\}', r'\1}', out)
    return out


# ---------- 边改写 ----------

def struct_when(when, node_from: str) -> object:
    if not isinstance(when, str):
        return when
    w = when.strip()
    if w == "rejected":
        return {"verdict": "send-back"}
    if w == "challenge":
        return {"challenge": True}
    m = re.match(r"^(.*)根因[=：:]\s*(\S+)$", w)
    if m:
        return {"cause": m.group(2)}
    m = re.match(r"^([^=]+)=([^=]+)$", w)
    if m:
        return {"input": m.group(1).strip(), "eq": m.group(2).strip()}
    if w in ("还有未写章", "还有未完成章"):
        return {"loop": "pending"}
    return when  # 保持原样，交给 lint 报 block


def edge_role(e: dict, reason_reject: bool, when=None) -> str:
    """role 单值化。loop 语义可来自旧布尔 loop，也可来自 when 里的 loop 谓词（`还有未写章` 形态）。
    when 传入已结构化的形态（render_edge 先 struct_when 再定 role）。"""
    w = e.get("when") if when is None else when
    is_loop = bool(e.get("loop")) or (isinstance(w, dict) and w.get("loop") is not None)
    if is_loop:
        return "reject" if reason_reject else "loop"
    if e.get("optional"):
        return "optional"
    return "reject" if reason_reject else "flow"


def _parse_fields(seg: str) -> tuple[str, str, list[tuple[str, str]]]:
    """拆边对象为 (前缀, 后缀, [(key, value_json), ...])。value 保持原文本（含对象/数组）。"""
    lb = seg.index("{")
    rb = seg.rindex("}")
    inner = seg[lb + 1 : rb]
    fields: list[tuple[str, str]] = []
    i = 0
    while i < len(inner):
        while i < len(inner) and inner[i] in " \t\r\n,":
            i += 1
        m = re.compile(r'"([A-Za-z_][A-Za-z0-9_]*)"\s*:\s*').match(inner, i)
        if not m:
            break
        key = m.group(1)
        j = m.end()
        depth = 0
        in_str = False
        esc = False
        while j < len(inner):
            ch = inner[j]
            if in_str:
                if esc:
                    esc = False
                elif ch == "\\":
                    esc = True
                elif ch == '"':
                    in_str = False
            else:
                if ch == '"':
                    in_str = True
                elif ch in "[{":
                    depth += 1
                elif ch in "]}":
                    depth -= 1
                elif ch == "," and depth == 0:
                    break
            j += 1
        fields.append((key, inner[m.end() : j].strip()))
        i = j + 1
    return seg[: lb + 1], seg[rb:], fields


def _rebuild(seg: str, fields: list[tuple[str, str]]) -> str:
    lb = seg.index("{")
    rb = seg.rindex("}")
    if "\n" not in seg:  # 紧凑单行
        body = ", ".join(f'{json.dumps(k)}: {v}' for k, v in fields)
        # 保留原对齐风格：单行对象保持单行
        return seg[: lb + 1] + " " + body + " " + seg[rb:]
    # 多行：沿用首字段行的缩进
    indent_m = re.search(r"\n([ \t]*)\"", seg)
    indent = indent_m.group(1) if indent_m else "  "
    close_m = re.search(r"\n([ \t]*)\}$", seg)
    close_indent = close_m.group(1) if close_m else ""
    body = ",\n".join(f"{indent}{json.dumps(k)}: {v}" for k, v in fields)
    return seg[: lb + 1] + "\n" + body + "\n" + close_indent + seg[rb:]


def render_edge(e: dict, deliv: dict, flow_nodes: dict, seg: str, log: list[str]) -> str:
    tfn = str(e.get("transform") or "")
    reason_reject = tfn.endswith(".reject") or tfn == "sm.review.reject"
    eid = e["id"]
    if not re.match(r"^e-[a-z0-9-]+$", eid):
        eid = "e-" + re.sub(r"^e-?", "", eid)

    when = e.get("when")
    if isinstance(when, str):
        when = struct_when(when, e.get("from", ""))

    # role 由「transform 语义 + 结构化 when」共同决定；已迁移过的既有 role 沿用（幂等）
    role = e.get("role") or edge_role(e, reason_reject, when)

    params = e.get("params")
    if params is None and role == "reject":
        cause = when.get("cause") if isinstance(when, dict) else None
        params = {"scope": "本阶段", "mode": "定点重做" if cause else "回本阶段入口"}

    to_node = flow_nodes.get(e["to"]) or {}
    # via 仅在「旧 transform 记的语义 ≠ 目标节点执行体」时保留：
    #   skill.<id> / core.<minitool> 与目标节点执行体一致 → 纯冗余声明，删（漂移面归零）
    #   sm.<语义> 是编排语义，节点上没有对应执行体 → 必须保留（否则"这条线是抽检/复核"的信息丢失）
    body = str(to_node.get("skill") or to_node.get("minitool") or "")
    ns, _, name = tfn.partition(".")
    redundant = ns in ("skill", "core") and name == body
    if e.get("via") and is_redundant_via(e, flow_nodes):
        log.append(f"  边 {eid}: 删冗余 via={e['via']}（与目标节点执行体一致，派生即可）")
        via = None
    else:
        via = e.get("via") or (tfn if tfn and not redundant else None)

    _, _, fields = _parse_fields(seg)
    out: list[tuple[str, str]] = []
    for k, v in fields:
        if k == "id":
            out.append(("id", json.dumps(eid)))
        elif k == "transform":
            continue  # 执行语义派生自目标节点；role 统一由下方按规范位置插入
        elif k in ("optional", "loop"):
            continue  # 已折算进 role
        elif k == "role":
            continue  # 统一重建，避免与 transform 折算出的 role 形成重复键（曾致 JSON 重复键事故）
        elif k == "via":
            continue  # 统一重建（冗余的删、非冗余的按规范位置插回）
        elif k == "when":
            out.append(("when", when if isinstance(when, str) else json.dumps(when, ensure_ascii=False)))
        else:
            out.append((k, v))

    # 规范字段序：… to → role → when → params → via …（缺则插入、有则在原位，二次运行幂等）
    emitted = {k for k, _ in out}
    if "role" not in emitted:
        idx = next((i for i, (k, _) in enumerate(out) if k == "to"), len(out) - 1)
        out.insert(idx + 1, ("role", json.dumps(role)))
    if when is not None and "when" not in emitted:
        idx = next((i for i, (k, _) in enumerate(out) if k in ("role", "to")), 0)
        out.insert(idx + 1, ("when", when if isinstance(when, str) else json.dumps(when, ensure_ascii=False)))
    if params is not None and "params" not in emitted:
        idx = next((i for i, (k, _) in enumerate(out) if k in ("when", "role", "to")), 0)
        out.insert(idx + 1, ("params", json.dumps(params, ensure_ascii=False)))
    if via and "via" not in emitted:
        idx = next((i for i, (k, _) in enumerate(out) if k in ("when", "role", "to")), 0)
        out.insert(idx + 1, ("via", json.dumps(via)))

    dup = [k for k in {k for k, _ in out} if [x for x, _ in out].count(k) > 1]
    if dup:
        raise ValueError(f"边 {eid}: 字段重复 {sorted(dup)} —— 迁移器产出非法 JSON")

    if eid != e["id"]:
        log.append(f"  边 id {e['id']} → {eid}")
    if tfn:
        log.append(f"  边 {eid}: transform → role（执行语义派生自目标节点）")

    return _rebuild(seg, out)


def canonical_outputs(
    d: dict,
    path_map: dict[str, str | None],
    log: list[str],
) -> list[dict] | None:
    """顶层 outputs[] / deliverables[] → 唯一的「交付出口清单」。

    形态：`{ node, path?, title?, audience?, style? }`
      - 路径唯一事实源是节点 `output`（或 iterate.artifact）；`path` 仅在交付路径与之不同且**是合格路径**时出现
      - 旧 `file` 的 bare 名字（如 `World-Bible.md`）是迁移前残留 → 删，回落节点产物
      - `deliverables[]`（另一处声明，字段名还叫 file/name）并入，audience/style 保留为交付规格
    返回 None = 无需改写（幂等）。
    """
    outs = d.get("outputs")
    dlv = d.get("deliverables")
    if not isinstance(outs, list) and not isinstance(dlv, list):
        return None

    def node_path(nid: str | None) -> str:
        if not nid:
            return ""
        if path_map.get(nid):
            return str(path_map[nid]).replace("\\", "/")
        n = d["graph"]["nodes"].get(nid) or {}
        p = n.get("output") or n.get("file") or (n.get("iterate") or {}).get("artifact") or ""
        return str(p).replace("\\", "/")

    def qualified(raw: str) -> bool:
        return bool(raw) and "/" in raw and raw.split("/")[0] in ("内部", "对外交付", "章节正文", "世界书")

    # 节点存在性 + 文件名反查（清单条目指向已不存在的节点时按文件名重定位——节点拆分后的典型漂移）
    node_ids = set(d["graph"]["nodes"])
    by_base: dict[str, str] = {}
    for nid in node_ids:
        p = node_path(nid)
        if p:
            by_base.setdefault(p.split("/")[-1], nid)

    changed = False
    canon: list[dict] = []
    by_node: dict[str, dict] = {}
    for o in outs if isinstance(outs, list) else []:
        if isinstance(o, str):
            e = {"node": o}
            changed = True
        else:
            nid = o.get("node")
            raw = str(o.get("path") or o.get("file") or "").replace("\\", "/")
            if nid and nid not in node_ids:
                alt = by_base.get(raw.split("/")[-1])
                if alt:
                    log.append(f"  交付清单 节点「{nid}」不存在 → 按 {raw or '(无名)'} 重定位到「{alt}」")
                    nid = alt
                else:
                    log.append(f"  ! 交付清单 节点「{nid}」不存在且无法按文件名重定位（{raw or '(无名)'}）→ 丢弃")
                    changed = True
                    continue
            e = {"node": nid} if nid else {}
            if qualified(raw) and raw != node_path(nid):
                e["path"] = raw
            elif raw and not qualified(raw) and raw != node_path(nid):
                changed = True
                log.append(f"  交付清单 {nid or raw}: 删 path「{raw}」（非合格路径，回落节点产物）")
            for k in ("title", "audience", "style"):
                if o.get(k):
                    e[k] = o[k]
            if set(e) != {k for k in o if k != "file"}:
                changed = True
        if e.get("node") and e["node"] in by_node:
            # 同一节点的重复条目：保留已有（title 取前者），只并交付规格
            tgt = by_node[e["node"]]
            for k in ("title", "audience", "style"):
                if e.get(k) and not tgt.get(k):
                    tgt[k] = e[k]
            changed = True
            log.append(f"  交付清单 节点「{e['node']}」重复声明 → 合并")
            continue
        canon.append(e)
        if e.get("node"):
            by_node[e["node"]] = e

    # deliverables[] → 按 file 反查节点并入（另一处声明，字段名file/name）
    back: dict[str, str] = {}
    for nid in d["graph"]["nodes"]:
        p = node_path(nid)
        if p:
            back.setdefault(p, nid)
            back.setdefault(p.split("/")[-1], nid)
    added = 0
    for dl in dlv if isinstance(dlv, list) else []:
        p = str(dl.get("file") or dl.get("path") or "").replace("\\", "/")
        nid = back.get(p) or back.get(p.split("/")[-1])
        tgt = by_node.get(nid or "")
        if tgt is None:
            tgt = {"node": nid} if nid else {}
            if qualified(p) and p != node_path(nid):
                tgt["path"] = p
            canon.append(tgt)
            added += 1
            if nid:
                by_node[nid] = tgt
        if dl.get("name") and not tgt.get("title"):
            tgt["title"] = dl["name"]
        for k in ("audience", "style"):
            if dl.get(k):
                tgt[k] = dl[k]
        changed = True
    if added:
        log.append(f"  deliverables[] 并入 outputs[]（新增 {added} 条）")
    if not changed:
        return None
    # 定序：按 graph.nodes 的声明序（= 作者意图的 DAG 序），交付清单稳定可 diff
    seq = {nid: i for i, nid in enumerate(d["graph"]["nodes"])}
    canon.sort(key=lambda e: seq.get(str(e.get("node") or ""), len(seq)))
    return canon


def render_outputs_block(entries: list[dict]) -> str:
    """交付出口清单的规范排版：一条一行，字段序 node → path → title → audience → style。"""
    order = ("node", "path", "title", "audience", "style")
    lines = []
    for e in entries:
        keys = [k for k in order if k in e] + [k for k in e if k not in order]
        body = ", ".join(f'{json.dumps(k, ensure_ascii=False)}: {json.dumps(e[k], ensure_ascii=False)}' for k in keys)
        lines.append("    { " + body + " }")
    return "[\n" + ",\n".join(lines) + "\n  ]"


# ---------- 主流程 ----------

LEGACY_MARKERS = (
    ('"transform"', r'"transform"\s*:'),
    ('"file"', r'"file"\s*:'),
    ('node.check', r'"check"\s*:'),
    ('node.review', r'"review"\s*:'),
    ('node.kb', r'"kb"\s*:'),
    ('字符串 when', r'"when"\s*:\s*"'),
    ('布尔 loop', r'"loop"\s*:\s*(true|false)'),
    ('布尔 optional', r'"optional"\s*:\s*(true|false)'),
)


def is_redundant_via(e: dict, nodes: dict) -> bool:
    """via 与目标节点执行体一致 = 纯冗余声明（漂移面）。"""
    v = str(e.get("via") or "")
    if not v:
        return False
    to = nodes.get(e.get("to")) or {}
    body = str(to.get("skill") or to.get("minitool") or "")
    pre, _, rest = v.partition(".")
    if pre == "core":
        return rest == body
    if pre == "skill":
        return rest == body
    if pre in ("plot", "search", "prose", "tool"):
        return bool(to.get("kit") == pre and to.get("op") == rest)
    return False


def needs_migration(d: dict, text: str) -> list[str]:
    """结构化判定（不靠全文正则——`roleModel.review` 这类同名字段曾造成误判）。
    已是 flow@2 且无任何旧形态残留 → 不动盘上文件（保护手工写就的规范样板排版）。"""
    hits: list[str] = []
    if d.get("format") != "flow@2":
        hits.append("format=flow@1")
    if not d.get("status"):
        hits.append("缺 status")

    nodes = d["graph"]["nodes"]
    for key in ("file", "check", "review", "kb"):
        if any(key in n for n in nodes.values()):
            hits.append(f"node.{key}")
    if any(isinstance(n.get("when"), str) for n in nodes.values()):
        hits.append("节点 when 为字符串")

    edges = d["graph"]["edges"]
    if any("transform" in e for e in edges):
        hits.append("edge.transform")
    if any("loop" in e or "optional" in e for e in edges):
        hits.append("edge 布尔 loop/optional")
    if any(isinstance(e.get("when"), str) for e in edges):
        hits.append("边 when 为字符串")
    if any(not e.get("role") for e in edges):
        hits.append("边缺 role")
    if any(e.get("role") == "reject" and not (e.get("params") or {}).get("scope") for e in edges):
        hits.append("reject 边缺 params.scope")
    bad_ids = [e["id"] for e in edges if not re.match(r"^e-[a-z0-9-]+$", e["id"])]
    if bad_ids:
        hits.append(f"边 id 未规范化 {bad_ids[:3]}")
    if any(is_redundant_via(e, nodes) for e in edges):
        hits.append("边 via 冗余（与目标节点执行体一致）")

    sp = array_span(text, "outputs")
    if sp and re.search(r'"file"\s*:', text[sp[0] : sp[1]]):
        hits.append("交付清单 outputs[].file")
    if isinstance(d.get("deliverables"), list) and d["deliverables"]:
        hits.append("deliverables[]（应并入 outputs[]）")
    return hits


def normalize(flow_dir: Path, check_only: bool) -> list[str]:
    path = flow_dir / "flow.json"
    text = path.read_text(encoding="utf-8")
    d = strict_load(text, path.name)
    log: list[str] = [f"### {d.get('id')} ({path.name})"]

    todo = needs_migration(d, text)
    if not todo:
        if check_only:
            log.append("  ✓ 已是 flow@2 且字段全部规范化")
        else:
            log.append("  ✓ 已是 flow@2 且字段全部规范化（跳过，保持盘上排版）")
        return log
    log.append(f"  迁移项：{', '.join(todo)}")

    # 交付出口：只认 对外交付/，且同一路径只归首个声明的节点（其余保留自身过程件）
    deliverable: dict[str, str] = {}
    claimed: dict[str, str] = {}
    for o in d.get("outputs") or []:
        nid, f = o.get("node"), (o.get("path") or o.get("file") or "").replace("\\", "/")
        if not nid or not f.startswith("对外交付/"):
            continue
        if f in claimed:
            log.append(f"  ! 交付出口 {f} 被 {claimed[f]} 与 {nid} 同时声明 → 归 {claimed[f]}，{nid} 保留自身过程件")
            continue
        if nid not in d["graph"]["nodes"]:
            log.append(f"  ! 交付出口 {f} 指向不存在节点 {nid}（跳过）")
            continue
        claimed[f] = nid
        deliverable[nid] = f
    nodes = d["graph"]["nodes"]

    # 缺 output 的 core 节点：由 outputs[] 的声明补路径（再按准入归位）
    for o in d.get("outputs") or []:
        nid, f = o.get("node"), (o.get("path") or o.get("file"))
        if nid in nodes and f and not (nodes[nid].get("output") or nodes[nid].get("file")):
            if not f.replace("\\", "/").startswith("对外交付/"):
                nodes[nid]["output"] = f
                log.append(f"  {nid}: 由 outputs[] 补声明产物 {f}")

    # 节点路径改名账（供边/输出引用核对）
    remap: dict[str, str] = {}
    new_path_of: dict[str, str | None] = {}
    for nid, node in nodes.items():
        np_ = classify(node, nid, deliverable)
        new_path_of[nid] = np_
        cur = (node.get("output") or node.get("file") or "").replace("\\", "/")
        if np_ and np_ != cur:
            remap[cur] = np_
            log.append(f"  {nid}: {cur or '(无)'} → {np_}")

    spans = node_spans(text)
    edits: list[tuple[int, int, str]] = []
    for nid, (s, e) in spans.items():
        seg = text[s:e]
        new_seg = rewrite_node(seg, nodes[nid], nid, new_path_of.get(nid), log)
        if new_seg != seg:
            edits.append((s, e, new_seg))

    for s, e, seg in sorted(edges_span_wrap(text, nodes, log), reverse=True):
        edits.append((s, e, seg))

    for s, e, new_seg in sorted(edits, reverse=True):
        text = text[:s] + new_seg + text[e:]

    # 交付清单唯一化：outputs[] 归一（file→path、bare 名删）+ deliverables[] 并入
    canon = canonical_outputs(d, new_path_of, log)
    if canon is not None:
        sp = array_span(text, "outputs")
        if sp:
            text = text[: sp[0]] + render_outputs_block(canon) + text[sp[1] :]
            log.append("  交付清单 outputs[] 归一重排")
        m = re.search(r'\n  "deliverables"\s*:\s*\[', text)
        if m:
            dsp = array_span(text, "deliverables")
            if dsp:
                end = dsp[1] + (1 if text[dsp[1] : dsp[1] + 1] == "," else 0)
                text = text[: m.start()] + text[end:]
                log.append("  删 deliverables[]（已并入 outputs[]）")

    # 顶层：format → flow@2、补 status
    text = re.sub(r'"format"\s*:\s*"flow@1"', '"format": "flow@2"', text, count=1)
    d2 = json.loads(text)
    if "status" not in d2:
        ver = str(d2.get("version") or "")
        status = "draft" if "draft" in ver else "official"
        line = '"status": "' + status + '",'
        text = re.sub(
            r'(\n([ \t]*))("version"\s*:\s*"(?:[^"\\]|\\.)*"\s*,)',
            lambda m: m.group(1) + m.group(3) + m.group(1) + line,
            text,
            count=1,
        )
        log.append(f"  顶层补 status={status}")

    strict_load(text, f"flows/{d.get('id')}/flow.json")  # 合法性守卫：JSON 合法 **且** 无重复键
    if not check_only:
        path.write_text(text, encoding="utf-8")
    return log


def edges_span_wrap(text: str, nodes: dict, log: list[str]) -> list[tuple[int, int, str]]:
    d = strict_load(text, "edges")
    out = []
    spans = edge_spans(text)
    edge_list = d["graph"]["edges"]
    if len(spans) != len(edge_list):
        raise ValueError(f"边定位失败：文本 {len(spans)} ≠ JSON {len(edge_list)}")
    for (s, e), raw in zip(spans, edge_list):
        out.append((s, e, render_edge(raw, {}, nodes, text[s:e], log)))
    return out


def main() -> int:
    check_only = "--check" in sys.argv
    flows = sorted(p for p in (ROOT / "flows").iterdir() if (p / "flow.json").exists())
    if not flows:
        print("未找到 flow")
        return 1
    for fd in flows:
        log = normalize(fd, check_only)
        print("\n".join(log))
    print(f"\n{'[check] ' if check_only else ''}处理 {len(flows)} 个 flow")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
