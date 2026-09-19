"""module-lint · module@1 底座体检（R6 模块工具箱的静态门）

治理目标：模块库（modules/*/module.json）是 flow@3 时代的单一能力事实源——
声明漂移 / 断链引用 / 不可执行 tool 在这里拦住。契约 = contracts/module.schema.json；
本工具是 schema 的**语义等价校验 + 交叉资源核账**（schema 管形状，lint 管引用真实性）。

检查项（E=error 阻断，W=warning 提示）：
  E-FORMAT        format 必须 = module@1
  E-ID            模块 id 缺失/非法/与目录名不一致
  E-NAME          name 缺失（面板模块卡片顶栏显示用）
  E-OPS-EMPTY     ops 为空（模块必须有工具箱）
  E-CAPS-EMPTY    caps 为空（caps 是渲染与选工具的唯一依据）
  E-FIELD-UNKNOWN tool 携带契约白名单外的字段（additionalProperties:false 的等价检查）
  E-KIND          kind 缺失或不在 produce|review|check（勘误 §十一.14：必填，不靠缺省隐含）
  E-BINDING       tool 无执行体：skill|minitools|script 三者皆缺
  E-IO-REQUIRED   spine 非空的模块缺 io 职责三件套（工单 W-01：输入/输出/验收声明式契约）
  E-IO-FILE       io.output.file 与末位 spine 工具产物文件名不一致（声明=落盘，W-02 可见性依赖）
  E-IO-ACCEPT-UNKNOWN io.acceptance.asserts 引用本模块 ops 未声明的断言 id（验收职责必须真挂载）
  W-IO-ACCEPT-EMPTY   io.acceptance.asserts 为空——模块交付无机器验收（显式可见，不冒充有验收）
  E-SKILL-MISSING op.skill 档案不存在（skills/<id>.md）
  E-MINITOOL-UNKNOWN op.minitools 未登记在 tools/minitools.json
  E-MINITOOL-IMPL    op.minitools 条目 impl 非 kernel|check-integrity（planned/None =
                     声明了但内核无执行体——ccwd-fq export-doc 事故的 lint 侧闭环）
  E-SCRIPT-MISSING   op.script 对应 tools/<script>.py 不存在
  E-KB-UNKNOWN    op.knowledge / adds.knowledge 条目不在 knowledge/index.json
  E-MODEL-TIER    model_tier 不在 high|low（勘误 §十一.13）
  E-SPINE-UNKNOWN spine 引用未声明的 tool
  E-SPINE-DUP     spine 重复项
  E-EDGE-ENDPOINT 骨架边端点不在 spine（规范 §一：edges 只写骨架成员之间）
  E-CAP-UNKNOWN   tool.capability ⊄ 模块 caps
  E-SLOT-REQUIRED 非骨架成员的 skill 类 tool 缺 slot（勘误 §十一.12 收窄口径）
  E-SLOT-BAD      slot/also_fits 非法（格式 after:|before:|end；锚点必须在本模块 ops）
  E-REQUIRES-UNKNOWN requires 引用本模块不存在的 tool
  E-REQUIRES-CYCLE   requires 成环
  E-ADDS-BAD      adds 键不在 asserts|knowledge|config
  W-SLOTLESS-MACHINE 机器件（script/minitools 类）缺 slot——不可玩=事实陈述（不阻断）
  W-CAPS-UNPROVIDED  caps 声明了但无任何 tool 提供（悬空能力，启用会落空）
  W-SLOT-CLASH       同一锚点同侧挂多个默认插入工具（展开序退化为声明序，请确认意图）
  W-REG              交叉资源缺失（knowledge/index.json 等）——显式提示，不静默

用法：
  python tools/module-lint.py [--json]            # 扫全库 modules/
  python tools/module-lint.py --module plot       # 只查一个模块
退出码：errors>0 → 1；否则 0。--strict 让 warning 也失败。
本工具 0 error 是 module@1 产物提交的门禁（R6 后接替 kit-lint 的守门职责）。
"""
import json
import sys
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ASJSON = "--json" in sys.argv
STRICT = "--strict" in sys.argv
ONLY = None
if "--module" in sys.argv:
    ONLY = sys.argv[sys.argv.index("--module") + 1]
FILE = None
if "--file" in sys.argv:
    FILE = Path(sys.argv[sys.argv.index("--file") + 1])

ID_RE = re.compile(r"^[a-z][a-z0-9-]*$")
SLOT_RE = re.compile(r"^(after|before):([a-z][a-z0-9-]*)$|^end$")
TOOL_FIELDS = {
    "title", "desc", "skill", "minitools", "script", "kind", "model_tier",
    "knowledge", "asserts", "config", "capability", "slot", "also_fits",
    "requires", "adds", "output",
}
KINDS = {"produce", "review", "check"}
TIERS = {"high", "low"}
ADDS_KEYS = {"asserts", "knowledge", "config"}
# 通用 Skill（脱离 flow 的轮末入口，R5 §6.0 / R6 勘误 §十一.15）：与机器件同待遇，不占流水线位
INLINE_SKILLS = {"orchestration-miner"}


def load(p):
    return json.loads(Path(p).read_text(encoding="utf-8"))


def has_cycle(requires):
    """requires 图找环：返回环上任意一条路径（空列表=无环）"""
    color = {}  # 0=白 1=灰 2=黑

    def dfs(n, stack):
        color[n] = 1
        for m in requires.get(n, []):
            if color.get(m, 0) == 1:
                return stack + [n, m]
            if color.get(m, 0) == 0:
                found = dfs(m, stack + [n])
                if found:
                    return found
        color[n] = 2
        return []

    for node in requires:
        if color.get(node, 0) == 0:
            found = dfs(node, [])
            if found:
                return found
    return []


def lint_module(path, kb_index, minitools_reg):
    d = load(path)
    errors, warnings = [], []
    # module.json → 模块 id 即目录名；散文件（fixture 等）→ 取文件名 stem
    mid = path.parent.name if path.stem == "module" else path.stem
    try:
        rel = str(path.relative_to(ROOT)).replace("\\", "/")
    except ValueError:
        rel = str(path)

    def E(code, msg, tool=None):
        errors.append({"code": code, "tool": tool, "msg": msg})

    def W(code, msg, tool=None):
        warnings.append({"code": code, "tool": tool, "msg": msg})

    if d.get("format") != "module@1":
        E("E-FORMAT", f"format 必须=module@1，实际 {d.get('format')!r}")
    if not ID_RE.match(d.get("id", "")):
        E("E-ID", f"id 缺失或非法（须 {ID_RE.pattern}）：{d.get('id')!r}")
    elif d["id"] != mid:
        E("E-ID", f"id 与目录名不一致：id={d['id']} 目录={mid}")
    if not d.get("name"):
        E("E-NAME", "name 缺失（面板顶栏显示用）")
    ops = d.get("ops", {})
    if not ops:
        E("E-OPS-EMPTY", "ops 为空——模块必须有工具箱")
    caps = d.get("caps", [])
    if not caps:
        E("E-CAPS-EMPTY", "caps 为空——caps 是渲染与选工具的唯一依据")
    cap_set = set(caps)

    spine = d.get("skeleton", {}).get("spine", [])
    edges = d.get("skeleton", {}).get("edges", [])
    spine_set = set(spine)
    if len(spine_set) != len(spine):
        E("E-SPINE-DUP", f"spine 有重复项：{[s for s in spine if spine.count(s) > 1]}")

    provided_caps = set()
    slot_claims = {}  # (anchor, side) -> [tool]
    requires = {}

    for oid, op in ops.items():
        unknown = set(op.keys()) - TOOL_FIELDS
        if unknown:
            E("E-FIELD-UNKNOWN", f"契约白名单外字段：{sorted(unknown)}", oid)
        kind = op.get("kind")
        if kind is None:
            E("E-KIND", "kind 缺失（勘误 §十一.14：必填）", oid)
        elif kind not in KINDS:
            E("E-KIND", f"kind 非法：{kind!r}（produce|review|check）", oid)
        bindings = [b for b in ("skill", "minitools", "script") if op.get(b)]
        if not bindings:
            E("E-BINDING", "无执行体：skill|minitools|script 三者皆缺", oid)
        if op.get("skill") and not (ROOT / "skills" / f"{op['skill']}.md").exists():
            E("E-SKILL-MISSING", f"技能档案缺失 skills/{op['skill']}.md", oid)
        for mt in op.get("minitools", []) or []:
            if mt not in minitools_reg:
                E("E-MINITOOL-UNKNOWN", f"minitool 未登记：{mt}", oid)
            else:
                # 注册 ≠ 实现：impl 只有 kernel|check-integrity 才有内核执行体
                # （ccwd-fq 事故：export-doc 声明层齐全、执行层 "(未声明)"，flow 永不能 completed）
                impl = (minitools_reg.get(mt) or {}).get("impl") if isinstance(minitools_reg.get(mt), dict) else None
                if impl not in ("kernel", "check-integrity"):
                    E("E-MINITOOL-IMPL", f"minitool {mt} 内核无执行体（impl={impl!r}，须 kernel|check-integrity）", oid)
        if op.get("script"):
            # script 值形态不一（"analyze-kakaxing" / "analyze-kakaxing.py" / "tools/x.py"）——规范化到文件名
            target = Path(op["script"]).name
            if not target.endswith(".py"):
                target += ".py"
            if not (ROOT / "tools" / target).exists():
                E("E-SCRIPT-MISSING", f"脚本缺失 tools/{target}", oid)
        tier = op.get("model_tier")
        if tier is not None and tier not in TIERS:
            E("E-MODEL-TIER", f"model_tier 非法：{tier!r}（high|low）", oid)

        kb_entries = list(op.get("knowledge", []) or []) + list((op.get("adds") or {}).get("knowledge", []) or [])
        for kb in kb_entries:
            if kb.endswith("/*"):
                continue  # 通配条目只在 flow 期展开，此处不核
            if kb not in kb_index:
                E("E-KB-UNKNOWN", f"知识条目不存在：{kb}", oid)

        for c in op.get("capability", []) or []:
            provided_caps.add(c)
            if c not in cap_set:
                E("E-CAP-UNKNOWN", f"capability {c!r} 不在模块 caps", oid)

        cap_list = op.get("capability")
        if not cap_list:
            E("E-CAP-UNKNOWN", "capability 缺失（渲染与选工具的唯一依据）", oid)

        slot = op.get("slot")
        is_skill = bool(op.get("skill"))
        if slot:
            m = SLOT_RE.match(slot)
            if not m:
                E("E-SLOT-BAD", f"slot 非法：{slot!r}", oid)
            elif m.group(2) and m.group(2) not in ops:
                E("E-SLOT-BAD", f"slot 锚点不存在：{slot}", oid)
            elif m.group(1):
                slot_claims.setdefault((m.group(2), m.group(1)), []).append(oid)
        elif is_skill and oid not in spine_set and op["skill"] not in INLINE_SKILLS:
            E("E-SLOT-REQUIRED", "非骨架成员的 skill 类 tool 缺 slot（勘误 §十一.12）", oid)
        elif not is_skill and oid not in spine_set:
            W("W-SLOTLESS-MACHINE", "机器件无 slot——不可玩（不可被启用为流水线节点）", oid)

        for af in op.get("also_fits", []) or []:
            m = SLOT_RE.match(af)
            if not m:
                E("E-SLOT-BAD", f"also_fits 非法：{af!r}", oid)
            elif m.group(2) and m.group(2) not in ops:
                E("E-SLOT-BAD", f"also_fits 锚点不存在：{af}", oid)

        req = op.get("requires", []) or []
        requires[oid] = req
        for r in req:
            if r not in ops:
                E("E-REQUIRES-UNKNOWN", f"requires 引用不存在的 tool：{r}", oid)

        adds = op.get("adds")
        if adds is not None and (not isinstance(adds, dict) or set(adds.keys()) - ADDS_KEYS):
            E("E-ADDS-BAD", f"adds 键非法（限 {sorted(ADDS_KEYS)}）：{sorted((adds or {}).keys())}", oid)

    for a, b in edges:
        if a not in spine_set or b not in spine_set:
            E("E-EDGE-ENDPOINT", f"骨架边 ({a},{b}) 端点必须都是 spine 成员")
        elif a == b:
            E("E-EDGE-ENDPOINT", f"骨架边自环：({a},{b})")

    for s in spine:
        if s not in ops:
            E("E-SPINE-UNKNOWN", f"spine 引用未声明的 tool：{s}")

    # ── 落位可达性（诊断 2026-09-19）：锚点不在骨架的启用工具，必须有可用的 also_fits 兜底──
    # 内核解析序 = slot → also_fits[]（首个可达）→ 声明 end；全不可达 = 内核响亮失败。
    # lint 静态侧提前拦：capability 声明在 caps 里（用户可勾选启用）却落不了位的 op 判 E。
    for oid2, op2 in ops.items():
        if oid2 in spine_set:
            continue
        slot_v = op2.get("slot")
        if not slot_v or slot_v == "end":
            continue
        m2 = re.match(r"^(before|after):([a-z][a-z0-9-]*)$", slot_v)
        if m2 and m2.group(2) in spine_set:
            continue
        reachable = False
        for af in op2.get("also_fits") or []:
            if af == "end":
                reachable = True
                break
            m3 = re.match(r"^(before|after):([a-z][a-z0-9-]*)$", af)
            if m3 and m3.group(2) in spine_set:
                reachable = True
                break
        if not reachable:
            E("E-SLOT-UNREACHABLE", f"slot {slot_v!r} 锚点不在骨架，also_fits 亦无可用兜底——启用即内核响亮失败", oid2)

    # ── W-01 模块职责三件套（io）：spine 模块必填，输出/验收必须真挂载 ──
    io = d.get("io")
    if spine:
        if not io:
            E("E-IO-REQUIRED", "spine 非空的模块缺 io 职责三件套（input/output/acceptance）")
        else:
            bad = [k for k in ("input", "output", "acceptance") if not isinstance(io.get(k), dict)]
            if bad:
                E("E-IO-REQUIRED", f"io 缺段：{bad}")
            else:
                last_op = ops.get(spine[-1], {})
                # 回退规则与 expandFlow3 逐字一致：显式 output > script 壳 .docx > 默认 .md
                if last_op.get("output"):
                    want = Path(str(last_op["output"])).name
                elif last_op.get("script"):
                    want = f"{spine[-1]}.docx"
                else:
                    want = f"{spine[-1]}.md"
                got = Path(str(io["output"].get("file", ""))).name
                if got != want:
                    E("E-IO-FILE", f"io.output.file「{got}」≠ 末位 spine 工具产物「{want}」（声明=落盘）")
                declared_asserts = set()
                for oid2, op2 in ops.items():
                    declared_asserts.update(op2.get("asserts") or [])
                for aid in io["acceptance"].get("asserts", []) or []:
                    if aid not in declared_asserts:
                        E("E-IO-ACCEPT-UNKNOWN", f"验收断言 {aid} 未声明在本模块任何 ops 的 asserts 上", "io")
                if not io["acceptance"].get("asserts"):
                    W("W-IO-ACCEPT-EMPTY", "验收断言为空——模块交付无机器验收", "io")

    cycle = has_cycle(requires)
    if cycle:
        E("E-REQUIRES-CYCLE", "requires 成环：" + " → ".join(cycle))

    for (anchor, side), tools in sorted(slot_claims.items()):
        if len(tools) > 1:
            W("W-SLOT-CLASH", f"{side}:{anchor} 同侧挂了多个默认插入工具 {tools}——展开序退化为声明序", tools[0])

    orphan_caps = cap_set - provided_caps
    if orphan_caps and ops:
        W("W-CAPS-UNPROVIDED", f"caps 声明了但无 tool 提供：{sorted(orphan_caps)}")

    return {
        "file": rel,
        "id": d.get("id", mid),
        "name": d.get("name", ""),
        "tools": len(ops),
        "spine": len(spine),
        "caps": len(caps),
        "errors": errors,
        "warnings": warnings,
    }


def main():
    kb_index = set()
    kb_path = ROOT / "knowledge" / "index.json"
    if kb_path.exists():
        idx = load(kb_path)
        entries = idx.get("entries", idx) if isinstance(idx, dict) else idx
        if isinstance(entries, dict):
            kb_index = set(entries.keys())
        elif isinstance(entries, list):
            kb_index = {e.get("id", e.get("path")) for e in entries if isinstance(e, dict)} | {
                e for e in entries if isinstance(e, str)
            }
    mt_path = ROOT / "tools" / "minitools.json"
    mt_reg = {}
    if mt_path.exists():
        mreg = load(mt_path)
        reg = mreg.get("minitools", mreg) if isinstance(mreg, dict) else mreg
        mt_reg = reg if isinstance(reg, dict) else {m.get("id"): m for m in reg if isinstance(m, dict)}

    mod_dir = ROOT / "modules"
    if FILE:
        if not FILE.exists():
            print(f"module-lint · 文件不存在：{FILE}")
            sys.exit(1)
        files = [FILE]
    else:
        files = sorted(mod_dir.glob("*/module.json")) if mod_dir.exists() else []
    if ONLY:
        files = [f for f in files if f.parent.name == ONLY]
        if not files:
            print(f"module-lint · 未找到模块 modules/{ONLY}/module.json")
            sys.exit(1)

    if not files:
        msg = "modules/ 库为空（0 模块）——module@1 尚未落地；WO-03 交付后复检。允许通过，但无东西可校验。"
        if ASJSON:
            print(json.dumps({"tool": "module-lint", "modules": [], "summary": {"errors": 0, "warnings": 0, "note": msg}}, ensure_ascii=False))
        else:
            print("module-lint · " + msg)
        sys.exit(0)

    kb_ok = kb_path.exists()
    reg_warning = None if kb_ok else {
        "code": "W-REG", "tool": None,
        "msg": "knowledge/index.json 缺失——E-KB-UNKNOWN 检查退化（显式提示，不静默）",
    }

    results = [lint_module(f, kb_index, mt_reg) for f in files]
    for r in results:
        if not kb_ok:
            r["warnings"].append(reg_warning)

    total_e = sum(len(r["errors"]) for r in results)
    total_w = sum(len(r["warnings"]) for r in results)

    if ASJSON:
        print(json.dumps({
            "tool": "module-lint",
            "format": "module@1",
            "modules": results,
            "summary": {"modules": len(results), "tools": sum(r["tools"] for r in results),
                        "errors": total_e, "warnings": total_w},
        }, ensure_ascii=False, indent=2))
    else:
        for r in results:
            print(f"--- {r['file']}  [{r['name']}] tools={r['tools']} spine={r['spine']} caps={r['caps']}")
            for e in r["errors"]:
                loc = f" [{e['tool']}]" if e["tool"] else ""
                print(f"  ERROR {e['code']}{loc}: {e['msg']}")
            for w in r["warnings"]:
                loc = f" [{w['tool']}]" if w["tool"] else ""
                print(f"  WARN  {w['code']}{loc}: {w['msg']}")
        print(f"module-lint · {len(results)} 模块 · {total_e} errors · {total_w} warnings" + ("（--strict 下 warnings 也失败）" if STRICT else ""))

    if total_e > 0 or (STRICT and total_w > 0):
        sys.exit(1)


if __name__ == "__main__":
    main()
