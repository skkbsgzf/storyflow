"""artifact-lint · 过程交付件格式体检（规范 R6 §五：模块分段布局）

对象：projects/<id>/ 下的 .md 过程交付件。
单一事实源：contracts/artifact-header.schema.json（R6 头部：八项必填）+ 本文件（目录准入/命名/污染）。

R6 目录格局：
  新区（R6 合法区）：输入/ · 世界书/ · NN-模块名/（01-选题、02-方案…）· 交付/
  旧区（已退役，待搬迁）：根级散件 · 内部/ · 对外交付/ · 章节正文/
  机器区（不检）：registry/ · snapshots/ · kit/ · assets/ · .git/

判定规则（按头部代际分流，存量项目不受惊）：
  R6 头部（有 module 无 class）  → 全字段严格校验（E）；且必须落在新区，旧区=目录违规（E）
  R4 头部（有 class）           → 旧区=「待搬迁」warn；新区=「旧头待迁移」warn（不阻断批量转换窗口）
  无头部                        → 「未迁移」warn（铁律 10：只列清单，不自动搬、不阻断）
检查项（E=error 阻断，W=warning 提示）：
  E-HEAD   R6 头部缺失字段 / artifact≠1 / 多余键（additionalProperties:false）/ 占位符
  E-FIELD  id / module / node / state / by / upstream / review 逐项对冻结契约校验
  E-PLACE  R6 头部文件落在旧区；node 不得是连接件（<x>.link 不产 artifact）
  E-NAME   文件名承载轮次（vN / 第N版 / -rN）——仅对带头部文件
  E-BODY   正文两行规则（首行一级标题 + 紧接 > 摘要）· 污染禁令（会话口吻/工具残留/版本叙述）
  W-MOVE   旧区文件待搬迁（对应 docs/项目目录搬迁清单-*.md，人批后另批执行）
  W-LEGACY R4 头部待迁移（去 class/round/version，加 module）
  W-IDDIR  id 首段与 module 不一致 / world.·input. 前缀与所在目录不符
  W-RCPT   registry/receipts/ 同 (node, basename) 多份收据（应为覆盖式）
用法：
  python tools/artifact-lint.py [projectId ...]     # 缺省扫描 projects/ 全部项目
退出码：有 error=1；--strict 让 warning 也失败。
红线：本工具只读；禁止自动搬迁存量文件（铁律 10），禁止补拍快照洗白红档。
"""
import json, sys, re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STRICT = "--strict" in sys.argv

HEADER_REQUIRED = ("artifact", "id", "module", "node", "state", "at", "by", "upstream")
HEADER_KEYS = set(HEADER_REQUIRED) | {"review"}
MACHINE_DIRS = ("registry/", "snapshots/", "kit/", "assets/", ".git/")
NEW_ZONE = re.compile(r"^(输入/|世界书/|\d{2}-[^/]+/|交付/)")
LEGACY_ZONE = re.compile(r"^(内部/|对外交付/|章节正文/)")
ID_RE = re.compile(
    r"^([a-z][a-z0-9-]*\.[a-z0-9-]+(\.[a-z0-9-]+)*|world\.[^.]+\.[^.]+|input\.[^.]+)$"
)
NODE_RE = re.compile(r"^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*(\.link)?$")
MODULE_RE = re.compile(r"^[a-z][a-z0-9-]*$")
BY_RE = re.compile(r"^(module/[a-z][a-z0-9-]*\.[a-z0-9-]+|core/[a-z0-9_]+|user)$")
LINK_RE = re.compile(r"^[a-z][a-z0-9-]*\.link$")
UPSTREAM_RE = re.compile(r"^(kb/[A-Za-z0-9_./-]+|[^@\s]+@[0-9a-f]{6,12})$")

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


def header_generation(head) -> str:
    """头部代际：r6（带 module——R6 判别标记，混入的 class 等旧键由严格通道报多余键）/ r4 / none。"""
    if not isinstance(head, dict):
        return "none"
    if "module" in head:
        return "r6"
    if "class" in head or "round" in head or "node" in head:
        return "r4"
    return "none"


def check_r6(head, tag):
    """R6 头部逐项对 contracts/artifact-header.schema.json 校验。"""
    errors = []
    for k in HEADER_REQUIRED:
        if k not in head:
            errors.append(f"{tag} R6 头部缺字段 {k}（八项必填）")
    if head.get("artifact") != 1:
        errors.append(f"{tag} artifact 须为 1，实为 {head.get('artifact')!r}")
    for k in head:
        if k not in HEADER_KEYS:
            errors.append(f"{tag} 头部多余键「{k}」——R6 已删 class/round/version（版本归 git+snapshots）")
    if not ID_RE.match(str(head.get("id", ""))):
        errors.append(f"{tag} id「{head.get('id')}」非法（<实例id>.<tool> | world.<类>.<名> | input.<名>）")
    if not MODULE_RE.match(str(head.get("module", ""))):
        errors.append(f"{tag} module「{head.get('module')}」非法（模块实例 id，如 m2）")
    node = str(head.get("node") or "")
    if not NODE_RE.match(node):
        errors.append(f"{tag} node「{node}」非法（<实例id>.<tool>）")
    elif node.endswith(".link"):
        errors.append(f"{tag} node 不得是连接件（<x>.link 不产 artifact）")
    if head.get("state") not in ("draft", "final"):
        errors.append(f"{tag} state={head.get('state')!r} 非法（draft|final；旧 reviewed/superseded 由 snapshots+git 承担）")
    if "<" in str(head.get("at", "")):
        errors.append(f"{tag} at 仍是模板占位符「{head.get('at')}」——须填实际产出时间")
    if head.get("by") and not BY_RE.match(str(head["by"])):
        errors.append(f"{tag} by「{head.get('by')}」非法（module/<实例id>.<tool> | core/<minitool> | user）")
    if not isinstance(head.get("upstream"), list):
        errors.append(f"{tag} upstream 须为列表（无依赖写 []）")
    else:
        for u in head["upstream"]:
            if not UPSTREAM_RE.match(str(u)):
                errors.append(f"{tag} upstream 元素须形如 路径@sha1前12 或 知识卡 id（kb/…）：「{u}」")
    rv = head.get("review", "missing")
    if rv == "missing":
        pass  # review 可省略（等于 null）；写了就必须合法
    elif rv is None:
        pass
    elif isinstance(rv, dict):
        if not LINK_RE.match(str(rv.get("link", ""))):
            errors.append(f"{tag} review.link「{rv.get('link')}」非法（<实例id>.link）")
        if rv.get("verdict") not in ("pass", "reject"):
            errors.append(f"{tag} review.verdict={rv.get('verdict')!r} 非法（R6 两值：pass|reject）")
        if rv.get("reason") and len(str(rv["reason"])) > 80:
            errors.append(f"{tag} review.reason 超长（≤40 字）")
        for k in rv:
            if k not in ("link", "verdict", "at", "by", "reason"):
                errors.append(f"{tag} review 多余键「{k}」")
    else:
        errors.append(f"{tag} review 须为 null 或对象（link/verdict/at/by/reason），实为 {rv!r}")
    return errors


def lint_file(proj: Path, rel: str):
    errors, warnings = [], []
    rel = rel.replace("\\", "/")
    if any(rel.startswith(d) for d in MACHINE_DIRS):
        return errors, warnings
    if not rel.endswith(".md"):
        return errors, warnings
    abs_ = proj / rel
    try:
        text = abs_.read_text(encoding="utf-8", errors="replace")
    except Exception:
        return errors, warnings
    tag = f"[{proj.name}/{rel}]"
    in_root = "/" not in rel
    is_new_zone = bool(NEW_ZONE.match(rel)) if not in_root else False
    is_legacy = in_root or bool(LEGACY_ZONE.match(rel))

    head = parse_header(text)
    gen = header_generation(head)

    if gen == "none":
        # 无头部：存量/骨架文件。只列清单不阻断；旧区的病根（根级堆过程件）提示语指向搬迁清单。
        if is_legacy:
            warnings.append(f"{tag} W-MOVE 待搬迁：无头部旧区文件（见 docs/项目目录搬迁清单-{proj.name}.md）")
        else:
            warnings.append(f"{tag} 未迁移：无 artifact 头部（新区 {rel.split('/', 1)[0]}/）")
        return errors, warnings

    if gen == "r4":
        if is_new_zone:
            warnings.append(f"{tag} W-LEGACY 旧 R4 头部落进新区：去 class/round/version、加 module（R6 §五）")
        else:
            warnings.append(f"{tag} W-LEGACY R4 头部待迁移（W-MOVE：见搬迁清单）")
        return errors, warnings

    # R6 头部：严格校验
    errors += check_r6(head, tag)
    if is_legacy:
        errors.append(f"{tag} E-PLACE R6 产物落在退役区「{'项目根' if in_root else rel.split('/', 1)[0]}/」"
                      f"（合法区：输入/ 世界书/ NN-模块名/ 交付/）")
    # id ↔ 归属一致性（提示级：契约未硬性约束，先观察）
    hid = str(head.get("id") or "")
    if hid.startswith("world.") and not rel.startswith("世界书/"):
        warnings.append(f"{tag} W-IDDIR world. 产物应在 世界书/，实为 {rel}")
    if hid.startswith("input.") and not rel.startswith("输入/"):
        warnings.append(f"{tag} W-IDDIR input. 产物应在 输入/，实为 {rel}")
    if not (hid.startswith("world.") or hid.startswith("input.")):
        first = hid.split(".", 1)[0]
        if first and first != str(head.get("module")):
            warnings.append(f"{tag} W-IDDIR id 首段「{first}」≠ module「{head.get('module')}」")

    # 命名不承载轮次
    node = str(head.get("node") or "")
    base = Path(rel).name
    stem = base.replace(node, "") if node else base
    for label, pat in ROUND_IN_NAME:
        if pat.search(stem):
            errors.append(f"{tag} E-NAME 文件名含轮次标记（{label}）；判别用 -<节点id>，版本归 snapshots")
            break

    # 正文两行规则 + 污染
    after = text[text.find("\n---", 3) + 4 :].lstrip()
    lines = [l for l in after.split("\n") if l.strip()]
    if not lines:
        errors.append(f"{tag} E-BODY 正文为空")
    else:
        if not re.match(r"^#\s", lines[0]):
            errors.append(f"{tag} E-BODY 正文首行须为一级标题，实为「{lines[0][:30]}」")
        second = lines[1] if len(lines) > 1 else ""
        if second and not second.startswith(">"):
            errors.append(f"{tag} E-BODY 标题后须紧接一行 > 摘要（≤80 字符）")
        elif second.startswith(">") and len(second.lstrip("> ")) > 80:
            errors.append(f"{tag} E-BODY 摘要超长（>80 字符）")
    for i, ln in enumerate(after.split("\n")):
        t = ln.strip()
        if not t:
            continue
        for label, pat in POLLUTION:
            if pat.search(t):
                errors.append(f"{tag} E-BODY 正文污染·{label} @L{i+1}：{t[:40]}")
    return errors, warnings


def receipt_overlays(proj: Path):
    """收据应为覆盖式：registry/receipts/ 同 (node, basename) 多份 → W。"""
    out = []
    rdir = proj / "registry" / "receipts"
    if not rdir.is_dir():
        return out
    seen = {}
    for p in sorted(rdir.glob("*.md")):
        head = parse_header(p.read_text(encoding="utf-8", errors="replace") or "")
        node = str((head or {}).get("node") or "")
        if not node:
            continue
        key = (node, re.sub(r"[-_]r\d+", "", p.stem))
        seen.setdefault(key, []).append(p.name)
    for (node, stem), names in sorted(seen.items()):
        if len(names) > 1:
            out.append(f"[{proj.name}/registry/receipts] W-RCPT 收据应覆盖式：节点 {node} 有 {len(names)} 份「{stem}*」：{', '.join(sorted(names)[:4])}")
    return out


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    projects = [ROOT / "projects" / a for a in args] if args else sorted(
        p for p in (ROOT / "projects").glob("*") if p.is_dir() and not p.name.startswith("_")
    )
    if not projects:
        print("未找到项目目录")
        return 0
    total_e = total_w = total_files = 0
    for proj in projects:
        errs_all, warns_all = [], []
        for p in sorted(proj.rglob("*.md")):
            rel = p.relative_to(proj).as_posix()
            e, w = lint_file(proj, rel)
            total_files += 1
            errs_all += e
            warns_all += w
        errs_all += receipt_overlays(proj)
        total_e += len(errs_all)
        total_w += len(warns_all)
        for x in errs_all:
            print("ERROR", x)
        for x in warns_all:
            print("WARN ", x)
        print(f"  · {proj.name}: {len(errs_all)} errors ｜ {len(warns_all)} warnings")
    print(f"--- {len(projects)} projects ｜ {total_files} md ｜ {total_e} errors ｜ {total_w} warnings")
    print("--- 存量口径：旧区文件只列清单（W-MOVE），搬迁须人批 docs/项目目录搬迁清单-*.md 后另批执行")
    return 1 if total_e or (STRICT and total_w) else 0


if __name__ == "__main__":
    raise SystemExit(main())
