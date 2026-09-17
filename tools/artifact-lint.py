"""artifact-lint · 过程交付件格式体检（规范 R4 §二/§三/§四）

对象：projects/<id>/ 下的过程交付件 .md（内部/ · 对外交付/ · 章节正文/ · 世界书/）
单一事实源：contracts/artifact-header.schema.json（头部字段）+ 本文件（目录准入/命名/污染）

检查项（E=error 阻断，W=warning 提示）：
  E1 头部存在且可解析（前 4 行内出现 ---）
  E2 九项必填齐全：artifact/id/class/node/round/state/at/by/upstream；artifact 恒为 1
  E3 class ↔ 目录互为逆函数（opinion|receipt|basis|draft|deliverable|world|input）
  E4 命名不承载轮次：v\\d / 第N版 / -rN（-rN 仅在构成节点判别时允许，如 -gate-r1）
  E5 正文两行规则：首行一级标题 + 紧接一行 > 摘要（≤80 字符）
  E6 污染禁令：会话口吻 / 工具残留 / 版本叙述
  E7 round 与 state.json nodes[].round 一致（有 state 时）
  E8 根级只允许输入材料（kind:novel-txt 产物），其余 .md 一律目录违规
  E9 upstream 元素形如 路径@sha1前12
  W1 收据类（内部/收据/）应为覆盖式：同 (node, basename) 多轮并存 → 提示（历轮归 snapshots/）
  W2 review 缺失（未过门的过程件应为 review: null，别默默省略）
用法：
  python tools/artifact-lint.py [projectId ...]     # 缺省扫描 projects/ 全部项目
  python tools/artifact-lint.py --require-header    # 头部缺失也报 error（迁移完成后用于 CI 收口）
退出码：有 error=1；--strict 让 warning 也失败

存量项目策略（规范 §六）：既有项目不做盘上文件搬迁。—— 未带 artifact@1 头部的历史文件
一律记 warn（"未迁移"），不阻断；一旦某文件带了头部，它就是"新格式"，按 E 严格校验。
"""
import json, sys, re, glob
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STRICT = "--strict" in sys.argv
REQUIRE_HEADER = "--require-header" in sys.argv

HEADER_REQUIRED = ("artifact", "id", "class", "node", "round", "state", "at", "by", "upstream")
CLASS_DIRS = {
    "opinion": ("内部/意见/",),
    "receipt": ("内部/收据/",),
    "basis": ("内部/依据/",),
    "draft": ("内部/稿本/",),
    "deliverable": ("对外交付/", "章节正文/"),
    "world": ("世界书/",),
    "input": (),  # 根级
}
HEADER_DIRS = ("内部/", "对外交付/", "章节正文/", "世界书/")
MACHINE_DIRS = ("registry/", "snapshots/", "assets/", ".git/")

POLLUTION = (
    ("会话口吻", re.compile(r"^(思考[：:]|分析过程|让我|我先|用户说|用户要求|用户想要|我需要|首先我|接下来我|按照要求|根据要求)")),
    ("工具残留", re.compile(r"^[A-Z][A-Z0-9_]*EOF$|\bwc -l\b|cat > |<<'[A-Z]")),
    ("版本叙述", re.compile(r"^(本轮|这一版|上一版|第\s*\d+\s*版)[,，。：:]")),
)
ROUND_IN_NAME = (
    ("vN", re.compile(r"v\d+", re.I)),
    ("第N版", re.compile(r"第\d+版")),
    ("_N版", re.compile(r"[-_]\d{1,2}版")),
    ("-rN", re.compile(r"[-_]r\d+", re.I)),
)


def parse_header(text: str):
    """YAML 头部 → dict（与 core/src/asserts.ts::parseArtifactHeader 同语义）。"""
    norm = text.lstrip("\ufeff")
    if not norm.startswith("---"):
        return None
    end = norm.find("\n---", 3)
    if end < 0:
        return None
    out, cur_obj, cur_list, pending = {}, None, None, ""
    for raw in norm[norm.index("\n") + 1 : end].split("\n"):
        if not raw.strip() or raw.strip().startswith("#"):
            continue
        indent = len(raw) - len(raw.lstrip())
        line = raw.strip()
        if line.startswith("- "):
            v = line[2:].strip().strip("\"'")
            if cur_list is None and pending:
                cur_list = []
                out[pending] = cur_list
                pending = ""
            if cur_list is not None:
                cur_list.append(v)
            continue
        m = re.match(r"^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$", line)
        if not m:
            continue
        k, v = m.group(1), m.group(2).strip()
        if indent == 0:
            cur_obj, cur_list, pending = None, None, ""
            if v == "":
                pending = k
            elif v in ("null", "~"):
                out[k] = None
            elif v == "[]":
                out[k] = []
            elif re.fullmatch(r"\d+", v):
                out[k] = int(v)
            elif v in ("true", "false"):
                out[k] = v == "true"
            else:
                out[k] = v.strip("\"'")
        else:
            if pending:
                cur_obj = {}
                out[pending] = cur_obj
                pending = ""
            if cur_obj is None:
                continue
            if v == "":
                cur_list = []
                cur_obj[k] = cur_list
            else:
                out_v = None if v == "null" else (int(v) if re.fullmatch(r"\d+", v) else v.strip("\"'"))
                cur_obj[k] = out_v
                cur_list = None
    if pending:
        out[pending] = []
    return out


def state_rounds(proj: Path):
    try:
        st = json.loads((proj / "state.json").read_text(encoding="utf-8"))
        return {k: (v or {}).get("round") for k, v in (st.get("nodes") or {}).items()}
    except Exception:
        return {}


def project_inputs(proj: Path):
    """根级输入材料白名单：state/flow 里 kind:novel-txt 节点的产物。"""
    allow = set()
    try:
        st = json.loads((proj / "state.json").read_text(encoding="utf-8"))
        fid = st.get("flowId")
        if fid:
            f = json.loads((ROOT / "flows" / fid / "flow.json").read_text(encoding="utf-8"))
            for _, n in (f.get("graph") or {}).get("nodes", {}).items():
                if n.get("kind") == "novel-txt" and n.get("output"):
                    allow.add(str(n["output"]).replace("\\", "/"))
    except Exception:
        pass
    return allow


def lint_file(proj: Path, rel: str, rounds: dict, inputs: set):
    errors, warnings = [], []
    rel = rel.replace("\\", "/")
    if any(rel.startswith(d) for d in MACHINE_DIRS):
        return errors, warnings
    if not rel.endswith(".md"):
        return errors, warnings
    abs_ = proj / rel
    text = abs_.read_text(encoding="utf-8", errors="replace")
    tag = f"[{proj.name}/{rel}]"
    in_root = "/" not in rel

    # 未带 artifact@1 头部 = 存量文件。策略见文件头：记 warn「未迁移」，不阻断；
    # 但根级出现过程件即使未迁移也要报 —— 那正是"过程文件在根级堆一堆"的病。
    is_new_format = parse_header(text) is not None and bool(re.search(r"^artifact\s*:\s*1\s*$", text.split("\n---", 1)[0], re.M))
    if not is_new_format:
        if in_root and rel not in inputs:
            yield_level = errors if REQUIRE_HEADER else warnings
            yield_level.append(
                f"{tag} 根级过程件（应入 内部/{{意见,收据,依据,稿本}} 或 对外交付/；规范 §一）"
            )
        elif any(rel.startswith(d) for d in HEADER_DIRS):
            msg = f"{tag} 未迁移：缺 artifact@1 头部（规范 §二）"
            (errors if REQUIRE_HEADER else warnings).append(msg)
        return errors, warnings

    managed = any(rel.startswith(d) for d in HEADER_DIRS)
    if not managed:
        return errors, warnings

    head = parse_header(text)
    if not head:
        errors.append(f"{tag} 缺 artifact@1 头部（须以 --- 开头，见 docs/规范-项目文件与流程配置-R4.md）")
        return errors, warnings

    for k in HEADER_REQUIRED:
        if k not in head:
            errors.append(f"{tag} 头部缺字段 {k}（九项必填，见规范 §二）")
    if head.get("artifact") != 1:
        errors.append(f"{tag} artifact 须为 1，实为 {head.get('artifact')!r}")
    if not isinstance(head.get("upstream"), list):
        errors.append(f"{tag} upstream 须为列表（无依赖写 []）")
    else:
        for u in head["upstream"]:
            if not re.match(r"^[^@]+@[0-9a-f]{6,12}$", str(u)):
                errors.append(f"{tag} upstream 元素须形如 路径@sha1前12：「{u}」")
    if not re.match(r"^[a-z]+(\.[a-z0-9-]+)+$", str(head.get("id", ""))):
        warnings.append(f"{tag} id「{head.get('id')}」建议形如 <kit>.<op> | core.<minitool>")
    if "<" in str(head.get("at", "")):
        errors.append(f"{tag} at 仍是模板占位符「{head.get('at')}」——须填实际产出时间")
    if head.get("round") is not None and head.get("version") not in (None, f"v{head['round']}"):
        errors.append(f"{tag} version={head.get('version')} 与 round={head['round']} 不一致（version 恒等于 round 的呈现）")
    if head.get("by") and not re.match(r"^(kit/[a-z]+\.[a-z0-9-]+|core/[a-z0-9_]+|user)$", str(head["by"])):
        warnings.append(f"{tag} by「{head['by']}」建议 <kit>.<op> / core/<minitool> / user")
    if "review" not in head:
        warnings.append(f"{tag} 头部缺 review（未过门写 review: null）")
    elif isinstance(head.get("review"), dict):
        rv = head["review"]
        if rv.get("verdict") and rv["verdict"] not in (
            "none", "awaiting", "pass", "pass-with-conditions", "send-back", "reject",
        ):
            errors.append(f"{tag} review.verdict 非法 {rv['verdict']}")
        if rv.get("reason") and len(str(rv["reason"])) > 80:
            warnings.append(f"{tag} review.reason 超长（≤40 字）")

    # 目录准入
    cls = head.get("class")
    if cls not in CLASS_DIRS:
        errors.append(f"{tag} class 非法 {cls!r}（合法：{'|'.join(CLASS_DIRS)}）")
    elif cls == "input":
        if not in_root:
            errors.append(f"{tag} class=input 应在项目根级，实为 {rel}")
    elif not any(rel.startswith(d) for d in CLASS_DIRS[cls]):
        errors.append(f"{tag} class={cls} 应落 {' 或 '.join(CLASS_DIRS[cls])}，实为 {rel}")

    # round 一致性
    node = str(head.get("node") or "")
    if node and rounds.get(node) is not None and head.get("round") is not None:
        if int(head["round"]) != int(rounds[node]):
            errors.append(f"{tag} round={head['round']} ≠ state.json nodes[{node}].round={rounds[node]}")

    # 命名
    base = Path(rel).name
    stem = base.replace(node, "") if node else base
    for label, pat in ROUND_IN_NAME:
        if pat.search(stem):
            errors.append(f"{tag} 文件名含轮次标记（{label}）；文件名不承载轮次，判别用 -<节点id>")
            break

    # 正文规则 + 污染
    after = text[text.find("\n---", 3) + 4 :].lstrip()
    lines = [l for l in after.split("\n") if l.strip()]
    if not lines:
        errors.append(f"{tag} 正文为空")
    else:
        if not re.match(r"^#\s", lines[0]):
            errors.append(f"{tag} 正文首行须为一级标题，实为「{lines[0][:30]}」")
        second = lines[1] if len(lines) > 1 else ""
        if second and not second.startswith(">"):
            errors.append(f"{tag} 标题后须紧接一行 > 摘要（≤60 字）")
        elif second.startswith(">") and len(second.lstrip("> ")) > 80:
            errors.append(f"{tag} 摘要超长（>80 字符）")
    for i, ln in enumerate(after.split("\n")):
        t = ln.strip()
        if not t:
            continue
        for label, pat in POLLUTION:
            if pat.search(t):
                errors.append(f"{tag} 正文污染·{label} @L{i+1}：{t[:40]}")

    # 收据覆盖式提示：同 node 多份收据
    if rel.startswith("内部/收据/"):
        sibs = [p.name for p in (proj / "内部" / "收据").glob(f"*-{node}*.md")] if node else []
        if len(sibs) > 1:
            warnings.append(f"{tag} 收据应为覆盖式（同节点一份）；发现 {len(sibs)} 份：{', '.join(sorted(sibs)[:4])}")
    return errors, warnings


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    projects = [ROOT / "projects" / a for a in args] if args else sorted(
        p for p in (ROOT / "projects").glob("*") if p.is_dir()
    )
    if not projects:
        print("未找到项目目录")
        return 0
    total_e = total_w = 0
    total_files = 0
    for proj in projects:
        rounds, inputs = state_rounds(proj), project_inputs(proj)
        errs_all, warns_all = [], []
        for p in sorted(proj.rglob("*.md")):
            rel = p.relative_to(proj).as_posix()
            e, w = lint_file(proj, rel, rounds, inputs)
            total_files += 1
            errs_all += e
            warns_all += w
        total_e += len(errs_all)
        total_w += len(warns_all)
        for x in errs_all:
            print("ERROR", x)
        for x in warns_all:
            print("WARN ", x)
        print(f"  · {proj.name}: {len(errs_all)} errors ｜ {len(warns_all)} warnings")
    print(f"--- {len(projects)} projects ｜ {total_files} md ｜ {total_e} errors ｜ {total_w} warnings")
    return 1 if total_e or (STRICT and total_w) else 0


if __name__ == "__main__":
    raise SystemExit(main())
