"""flow-lint · flow@3 配置体检（R6 模块序列形态）

单一事实源：contracts/flow.schema.json（flow@3 字段白名单） + modules/*/module.json（模块库，
经 tools/module-lint.py 体检）。flow@3 只写「模块序列」：走哪几个模块、每个模块要什么能力（caps）、
模块之间怎么放行（link）——节点与边由内核 modules.ts::expandFlow 派生，本工具不派生图，
只做**序列与引用的静态核账**。

检查项（E=error 阻断，W=warning 提示）：
  E-JSON      严格 JSON：重复键即错（前端与内核会读到不同值）
  E-FORMAT    format 非 flow@3 / 残留 graph·stages → 报错并附迁移命令（一次性转换，规范 R6 §八）
  E-ID        流程 id 缺失/非法
  E-TITLE     title 缺失
  E-VERSION   version 缺失
  E-STATUS    status 缺失或不在 draft|official|retired
  E-FIELD     顶层字段不在 flow@3 白名单
  E-LINK      link / defaults.link / policy.link_default / policy.adapt 非法
  E-MODULES   modules 缺失/非数组/为空
  E-INSTANCE  实例缺 id/module；id 非法；id 含「.」（与连接件派生 id 冲突）；实例 id 重复
  E-MODULE-REF  引用的模块在 modules/ 库不存在（附可用清单）
  E-CAPS      caps 请求了模块不提供的能力（附缺口与可用能力——差值没有工具承载）
  E-INSERT    insert 的 slot 键非法 / 锚点或 tool 不在目标模块 / 同一 tool 被钉进多个插槽
  E-REQUIRES-UNSAT  启用集（骨架 ∪ caps 触发 ∪ insert）不满足某 tool 的 requires——展开器会硬报错
  E-ITERATE   iterate 缺 unit/over；unit 不在 chapter|volume|episode
  E-VARY      vary 结构非法；内嵌 caps/insert 同款规则
  E-OUTPUTS   outputs 元素缺 module/title；module 未引用本 flow 的实例 id
  W-REG       模块库缺失/为空——引用与能力检查退化（显式提示，不静默）
  W-ENUM-DEFAULT  inputs[type=enum] 带 default——「选择」被当成「值」管（R8 §零；存量清零后升 error）
  W-INSERT-REDUNDANT  insert 的 tool 已在骨架或会被 caps 自动触发——冗余声明，应删
  W-MANUAL-NONE     全 flow 无 manual 连接件（全自动流水线——确认是有意为之）

用法：
  python tools/flow-lint.py [flowId ...]      # 缺省校验全部 flow
  python tools/flow-lint.py --json            # 结构化输出（agent 消费）
退出码：有 error=1（warning 不算失败）；--strict 让 warning 也失败。
"""
import json
import sys
import glob
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STRICT = "--strict" in sys.argv
ASJSON = "--json" in sys.argv

ID_RE = re.compile(r"^[a-z][a-z0-9-]*$")
SLOT_RE = re.compile(r"^(after|before):([a-z][a-z0-9-]*)$|^end$")
TOP_FIELDS = {
    "format", "id", "title", "desc", "version", "status", "inputs",
    "defaults", "policy", "modules", "outputs", "changelog",
}
MIGRATE_SCRIPT = ROOT / "tools" / "flow-v3-migrate.py"


def migrate_hint(flow_path: Path) -> str:
    try:
        rel = flow_path.relative_to(ROOT).as_posix()
    except ValueError:
        rel = str(flow_path)
    if MIGRATE_SCRIPT.exists():
        return f"；迁移：python tools/flow-v3-migrate.py --flow {rel}"
    return (f"；迁移：python tools/flow-v3-migrate.py --flow {rel}"
            f"（工具由 WO-08 交付，当前未落地——转换规则见 docs/规范-模块化flow与工具箱-R6.md §八）")


def strict_load(path: Path):
    """解析并拒绝重复键——文本级字段手术的经典事故。"""
    text = path.read_text(encoding="utf-8")
    dups = []

    def hook(pairs):
        keys = [k for k, _ in pairs]
        for k in dict.fromkeys(keys):
            if keys.count(k) > 1:
                dups.append(k)
        return dict(pairs)

    data = json.loads(text, object_pairs_hook=hook)
    return data, dups


def load_module(mid):
    p = ROOT / "modules" / mid / "module.json"
    if not p.exists():
        return None
    return json.loads(p.read_text(encoding="utf-8"))


def check_insert(module, insert, spine_set, enabled, where, E):
    """insert 与 vary.insert 共用的核账；返回冗余声明清单（交由调用方转 W）"""
    redundant = []
    if not isinstance(insert, dict):
        E("E-INSERT", f"{where}.insert 必须是 object")
        return redundant
    claimed = {}
    for slot, tools in insert.items():
        m = SLOT_RE.match(slot)
        if not m:
            E("E-INSERT", f"{where}.insert slot 非法（合法 after:<tool>/before:<tool>/end）：{slot!r}")
            continue
        if m.group(2) and m.group(2) not in module.get("ops", {}):
            E("E-INSERT", f"{where}.insert slot 锚点不在目标模块：{slot!r}")
        if not isinstance(tools, list):
            E("E-INSERT", f"{where}.insert[{slot!r}] 值必须是 tool id 数组")
            continue
        for t in tools:
            if t not in module.get("ops", {}):
                E("E-INSERT", f"{where}.insert 引用目标模块不存在的 tool：{t}（slot {slot!r}）")
                continue
            if t in claimed:
                E("E-INSERT", f"同一 tool 被钉进多个插槽：{t}（{claimed[t]} 与 {slot!r}）")
            claimed[t] = slot
            if t in spine_set:
                redundant.append(f"{where}: {t} 已在骨架（slot {slot!r}）——冗余声明，应删")
            elif t in enabled:
                # caps 已自动触发：同 slot = 纯冗余；不同 slot = 合法的位置覆盖（insert 的精细控制用途）
                default_slot = module["ops"][t].get("slot")
                if slot == default_slot or default_slot is None:
                    redundant.append(f"{where}: {t} 已被 caps 自动触发且 slot 与默认一致（{slot!r}）——冗余声明，应删")
            else:
                enabled.add(t)
    return redundant


def lint_flow(path: Path, lib_available, lib_ids):
    result = {"file": path.as_posix(), "errors": [], "warnings": []}

    def E(code, msg):
        result["errors"].append({"code": code, "msg": msg})

    def W(code, msg):
        result["warnings"].append({"code": code, "msg": msg})

    try:
        d, dups = strict_load(path)
    except Exception as ex:
        E("E-JSON", f"解析失败：{ex}")
        return result
    if dups:
        E("E-JSON", f"JSON 重复键 {sorted(set(dups))}")

    fmt = d.get("format")
    if fmt != "flow@3" or "graph" in d or "stages" in d:
        E("E-FORMAT", f"format 必须=flow@3（实际 {fmt!r}），手写 graph/stages 已废弃{migrate_hint(path)}")

    if not ID_RE.match(d.get("id", "")):
        E("E-ID", f"id 缺失或非法（{ID_RE.pattern}）：{d.get('id')!r}")
    if not d.get("title"):
        E("E-TITLE", "title 缺失")
    if not d.get("version"):
        E("E-VERSION", "version 缺失")
    if d.get("status") not in ("draft", "official", "retired"):
        E("E-STATUS", f"status 缺失或非法：{d.get('status')!r}（draft|official|retired）")

    unknown_top = set(d.keys()) - TOP_FIELDS
    if unknown_top:
        E("E-FIELD", f"顶层字段不在 flow@3 白名单：{sorted(unknown_top)}{migrate_hint(path)}")

    # R8 判据：取值空间有限枚举且互斥 = 「选择」，不许有 default（有值即须有决策事实）。
    # S1 阶段只点名不阻断；存量清零后（S4）升 E-ENUM-DEFAULT。
    ins = d.get("inputs", {}) or {}
    if isinstance(ins, dict):
        for k, spec in ins.items():
            if isinstance(spec, dict) and spec.get("type") == "enum" and "default" in spec:
                W("W-ENUM-DEFAULT", f"inputs.{k}（enum=选择）带 default={spec['default']!r}——"
                                    f"选择应走 decisions/，不藏在默认值里（R8 §零 判据）")

    defaults = d.get("defaults", {}) or {}
    if not isinstance(defaults, dict) or set(defaults.keys()) - {"link"}:
        E("E-LINK", f"defaults 只允许 {{link}}：{defaults!r}")
    elif defaults.get("link") not in (None, "auto", "manual"):
        E("E-LINK", f"defaults.link 非法：{defaults.get('link')!r}")
    policy = d.get("policy", {}) or {}
    if not isinstance(policy, dict):
        E("E-LINK", "policy 必须是 object")
    else:
        if policy.get("link_default") not in (None, "auto", "manual"):
            E("E-LINK", f"policy.link_default 非法：{policy.get('link_default')!r}")
        if policy.get("adapt") not in (None, "off", "propose", "apply"):
            E("E-LINK", f"policy.adapt 非法：{policy.get('adapt')!r}（off|propose|apply）")

    modules = d.get("modules")
    if not isinstance(modules, list) or not modules:
        E("E-MODULES", "modules 缺失、非数组或为空——模块序列是 flow@3 的流程本体")
        return result

    seen_ids, any_manual = {}, False
    for inst in modules:
        if not isinstance(inst, dict):
            E("E-INSTANCE", f"模块实例必须是 object：{inst!r}")
            continue
        iid, mid = inst.get("id"), inst.get("module")
        where = f"modules[{iid or '?'}]"
        if not iid or not isinstance(iid, str) or not ID_RE.match(iid):
            E("E-INSTANCE", f"{where}: 实例 id 缺失或非法（{ID_RE.pattern}）")
        else:
            if "." in iid:
                E("E-INSTANCE", f"{where}: 实例 id 含「.」——与连接件派生 id <实例id>.link 冲突")
            if iid in seen_ids:
                E("E-INSTANCE", f"实例 id 重复：{iid}（已在 {seen_ids[iid]}）")
            seen_ids[iid] = where
        if not mid:
            E("E-INSTANCE", f"{where}: module 引用缺失")
            continue
        if inst.get("link") not in (None, "auto", "manual"):
            E("E-LINK", f"{where}: link 非法：{inst.get('link')!r}")
        if inst.get("link") == "manual":
            any_manual = True

        if not lib_available:
            continue
        module = load_module(mid)
        if module is None:
            E("E-MODULE-REF", f"{where}: 模块 {mid!r} 不在 modules/ 库（可用：{sorted(lib_ids)}）")
            continue

        mops = module.get("ops", {})
        spine_set = set(module.get("skeleton", {}).get("spine", []))
        mcaps = set(module.get("caps", []))

        caps = inst.get("caps")
        enabled = set(spine_set)
        if caps is not None:
            if not isinstance(caps, list):
                E("E-CAPS", f"{where}: caps 必须是数组")
            else:
                gap = [c for c in caps if c not in mcaps]
                if gap:
                    E("E-CAPS", f"{where}: 请求了模块 {mid} 不提供的能力 {gap}（可用：{sorted(mcaps)}）")
                for oid, op in mops.items():
                    if set(op.get("capability", []) or []) & set(caps):
                        enabled.add(oid)

        redundant = check_insert(module, inst.get("insert", {}) or {}, spine_set, enabled, where, E)

        # requires 可满足性：启用集（骨架 ∪ caps 触发 ∪ insert）必须喂饱每个启用 tool 的前置
        for t in sorted(enabled):
            op = mops.get(t, {})
            missing = [r for r in op.get("requires", []) or [] if r not in enabled]
            if missing:
                E("E-REQUIRES-UNSAT", f"{where}: 启用 {t} 但其前置未启用 {missing}（补 caps/insert 或去掉该能力）")

        iterate = inst.get("iterate")
        if iterate is not None:
            if not isinstance(iterate, dict) or not iterate.get("unit") or not iterate.get("over"):
                E("E-ITERATE", f"{where}: iterate 须为 object 且必含 unit/over")
            elif iterate.get("unit") not in ("chapter", "volume", "episode"):
                E("E-ITERATE", f"{where}: iterate.unit 非法：{iterate.get('unit')!r}（chapter|volume|episode）")

        vary = inst.get("vary")
        if vary is not None:
            if not isinstance(vary, dict):
                E("E-VARY", f"{where}: vary 必须是 object")
            else:
                for unit, delta in vary.items():
                    vw = f"{where}.vary[{unit}]"
                    if not isinstance(delta, dict) or set(delta.keys()) - {"caps", "insert"}:
                        E("E-VARY", f"{vw}: 只允许 caps/insert 键")
                        continue
                    dcaps = delta.get("caps")
                    denabled = set(spine_set)
                    if isinstance(dcaps, list):
                        for oid, op in mops.items():
                            if set(op.get("capability", []) or []) & set(dcaps):
                                denabled.add(oid)
                    if dcaps is not None:
                        if not isinstance(dcaps, list):
                            E("E-VARY", f"{vw}.caps 必须是数组")
                        else:
                            gap = [c for c in dcaps if c not in mcaps]
                            if gap:
                                E("E-VARY", f"{vw}: 请求了模块 {mid} 不提供的能力 {gap}（可用：{sorted(mcaps)}）")
                    if "insert" in delta:
                        redundant += check_insert(module, delta.get("insert") or {}, spine_set, denabled, vw, E)
        for hint in redundant:
            W("W-INSERT-REDUNDANT", hint)

    if not lib_available:
        W("W-REG", "modules/ 库缺失或为空——E-MODULE-REF/E-CAPS/E-REQUIRES-UNSAT 检查退化（显式提示，不静默）")

    outputs = d.get("outputs", [])
    if not isinstance(outputs, list):
        E("E-OUTPUTS", "outputs 必须是数组")
    else:
        for o in outputs:
            if not isinstance(o, dict) or not o.get("module") or not o.get("title"):
                E("E-OUTPUTS", f"outputs 元素必须含 module/title：{o!r}")
            elif o.get("module") not in seen_ids:
                E("E-OUTPUTS", f"outputs[].module 未引用本 flow 的实例 id：{o['module']!r}（实例：{sorted(seen_ids)}）")

    if not any_manual and len(seen_ids) > 1:
        W("W-MANUAL-NONE", "全 flow 无 manual 连接件——全自动流水线，请确认是有意为之")

    return result


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if args:
        paths = []
        for a in args:
            p = Path(a)
            if not p.exists():
                p = ROOT / "flows" / a / "flow.json"
            if not p.exists():
                print(f"flow-lint · 找不到 flow：{a}")
                sys.exit(1)
            paths.append(p)
    else:
        paths = sorted(Path(f) for f in glob.glob(str(ROOT / "flows" / "*" / "flow.json")))

    lib_dir = ROOT / "modules"
    lib_ids = {p.parent.name for p in lib_dir.glob("*/module.json")} if lib_dir.exists() else set()
    lib_available = bool(lib_ids)

    results = [lint_flow(p, lib_available, lib_ids) for p in paths]
    total_e = sum(len(r["errors"]) for r in results)
    total_w = sum(len(r["warnings"]) for r in results)

    if ASJSON:
        print(json.dumps({"tool": "flow-lint", "format": "flow@3", "flows": results,
                          "summary": {"flows": len(results), "errors": total_e, "warnings": total_w}},
                         ensure_ascii=False, indent=2))
    else:
        for r in results:
            print(f"--- {r['file']}")
            for e in r["errors"]:
                print(f"  ERROR {e['code']}: {e['msg']}")
            for w in r["warnings"]:
                print(f"  WARN  {w['code']}: {w['msg']}")
        print(f"flow-lint · {len(results)} flow · {total_e} errors · {total_w} warnings" + ("（--strict 下 warnings 也失败）" if STRICT else ""))

    if total_e > 0 or (STRICT and total_w > 0):
        sys.exit(1)


if __name__ == "__main__":
    main()
