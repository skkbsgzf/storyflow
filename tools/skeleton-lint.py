"""skeleton-lint · flow@3 草稿骨架校验（比 flow-lint 更早、更快，供生成循环内自检）

定位（WO-06）：只验「骨架合法性」——flow@3 文档结构自洽 + 模块库（modules/）存在时的
模块级核对。不派生节点与边（那是内核 modules.ts::expandFlow 的单点职责，R6 §三），
不校验 asserts/overlay（那是 flow-lint 的职责）。**绝不引入 LLM。**

检查项（E=error 阻断，W=warning 提示）——以冻结契约 contracts/flow.schema.json 为准：
  E-FORMAT   format 必须是 flow@3
  E-ID       id 缺失或含非法字符（须 ^[a-z][a-z0-9-]*$）
  E-TITLE    title 缺失
  E-VERSION  version 缺失
  E-STATUS   status 缺失或非 draft|official|retired
  E-SCHEMA   顶层出现冻结契约不允许的键（flow@3 只允许 format/id/title/desc/version/
             status/inputs/defaults/policy/modules/changelog）；graph/stages/outputs 是
             flow@2 遗留，另有定向提示
  E-MODULES  modules 缺失/非数组/为空；实例缺 id 或 module；实例 id 重复；实例 id 含「.」
             （与连接件派生 id 冲突）
  E-LINK     link / defaults.link 非 auto|manual
  E-CAPS     caps 非字符串数组；含空串；同实例内重复
  E-INSERT   insert 非 object；slot 键非法（合法：after:<tool> / before:<tool> / end）；
             值非 tool id 数组；同一 tool 被钉进多个插槽
  E-ITERATE  iterate 非 object 或缺 unit/over；unit 非 chapter|volume|episode
  E-VARY     vary 非 object；值非 object；vary 内的 caps/insert 不合上面同款规则

用法：
  python tools/skeleton-lint.py --file <flow@3.json> [--json] [--fix-hint]
  cat flow.json | python tools/skeleton-lint.py --json        # 也可从 stdin 读
退出码：有 error=1；否则 0（--strict 让 warning 也失败）。
--fix-hint：对每个 error 附「下一步该问用户什么」，供生成循环把问题抛回给人。
"""
import json, sys, re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STRICT = "--strict" in sys.argv
FIXHINT = "--fix-hint" in sys.argv
ASJSON = "--json" in sys.argv

SLOT_RE = re.compile(r"^(after|before):[a-z][a-z0-9-]*$|^end$")
ID_RE = re.compile(r"^[a-z][a-z0-9-]*$")

HINTS = {
    "E-FORMAT": "这是 flow@2 或未知格式（已随 v4.0.0 处决，转换器退役）。问用户：按 R6 §八 新写 flow@3 模块序列，还是从 git 历史找回该 flow 的老格式原件作参照？",
    "E-ID": "问用户：这个流程的英文短名（kebab-case，如 novel-fanqie）？",
    "E-TITLE": "问用户：这个流程给人看的名字？",
    "E-VERSION": "问用户：初版版本号（如 1.0.0）？",
    "E-STATUS": "定 status：草稿 draft / 商店可装 official？",
    "E-SCHEMA": "flow@3 只允许顶层键：format/id/title/desc/version/status/inputs/defaults/policy/modules/changelog。graph/stages/outputs 是 flow@2 遗留（已处决）——按 R6 §八 手写模块序列；交付物不再写 outputs，落 交付/ 目录（NN 按模块序）。",
    "E-MODULES": "问用户：需求要走哪几个工种（模块），什么顺序？（可用模块清单见 docs/骨架与文件格式-速查.md）",
    "E-LINK": "问用户：模块之间自动批准（auto）还是每段人工验收（manual）？",
    "E-CAPS": "问用户：这个模块想要什么能力（用能力词表：主线/人设/暗线/伏笔/正文…）？不写 caps = 只跑默认骨架。",
    "E-INSERT": "问用户：要显式钉住哪个工具、钉到哪个插槽（after:<tool>/before:<tool>/end）？不钉就由内核按 slot 默认落位。",
    "E-ITERATE": "问用户：按什么单位重复（chapter=章 / volume=卷 / episode=集），单位清单来自哪（over）？",
    "E-VARY": "问用户：哪些单位要有差异？差异是能力（caps）还是插工具（insert）？",
    "E-JSON": "文件不是合法 JSON。问用户：文件是否写完整（可能截断）？",
    "W-REG": "模块库 modules/ 未建或为空：module 引用与 caps 可满足性本轮没核对，生成循环应把它当「待核对」而非「已通过」。",
    "W-MODULE": "引用了不存在的模块。把可用模块清单给用户重选；禁止发明模块。",
    "W-CAPS": "请求的能力该模块不提供：要么换模块，要么承认该能力尚未工具化——绝不发明 tool。",
}

TOP_KEYS = {"format", "id", "title", "desc", "version", "status", "inputs",
            "defaults", "policy", "modules", "changelog"}
LEGACY_KEYS = {"graph", "stages", "outputs", "nodes", "edges", "quality",
               "harness", "engine", "roleModel", "dataBase", "upstream"}
UNITS = {"chapter", "volume", "episode"}


def load():
    if "--file" in sys.argv:
        p = Path(sys.argv[sys.argv.index("--file") + 1])
        try:
            return json.loads(p.read_text(encoding="utf-8-sig")), str(p)
        except json.JSONDecodeError as e:
            return {"__bad_json__": str(e)}, str(p)
        except FileNotFoundError:
            print(f"[ABORT] 文件不存在：{p}")
            sys.exit(2)
    data = sys.stdin.read()
    try:
        return json.loads(data), "<stdin>"
    except json.JSONDecodeError as e:
        return {"__bad_json__": str(e)}, "<stdin>"


def check_caps_like(caps, where, errs):
    if not isinstance(caps, list) or any(not isinstance(c, str) or not c.strip() for c in caps):
        errs.append(("E-CAPS", f"{where}.caps 须为非空字符串数组，实为 {caps!r}"))
        return
    dups = sorted({c for c in caps if caps.count(c) > 1})
    if dups:
        errs.append(("E-CAPS", f"{where}.caps 有重复：{'、'.join(dups)}（uniqueItems）"))


def check_insert(ins, where, errs):
    if not isinstance(ins, dict):
        errs.append(("E-INSERT", f"{where}.insert 须为 object，实为 {type(ins).__name__}"))
        return
    seen = {}
    for slot, tools in ins.items():
        if slot != "end" and not SLOT_RE.match(slot):
            errs.append(("E-INSERT", f"{where}.insert 槽位「{slot}」非法（合法：after:<tool>/before:<tool>/end）"))
        if not isinstance(tools, list) or any(not isinstance(t, str) or not ID_RE.match(t) for t in tools):
            errs.append(("E-INSERT", f"{where}.insert[\"{slot}\"] 须为 tool id 数组"))
            continue
        for t in tools:
            if t in seen and seen[t] != slot:
                errs.append(("E-INSERT", f"{where}.insert：tool「{t}」被同时钉进「{seen[t]}」与「{slot}」"))
            seen[t] = slot


def check_module_instance(m, idx, errs, ids):
    where = f"modules[{idx}]"
    mid = m.get("id")
    if not mid or not isinstance(mid, str) or not ID_RE.match(mid):
        errs.append(("E-MODULES", f"{where}.id 缺失或非法（须 {ID_RE.pattern}）"))
    else:
        if mid in ids:
            errs.append(("E-MODULES", f"模块实例 id「{mid}」重复（节点 id 前缀须唯一）"))
        ids.add(mid)
        if "." in mid:
            errs.append(("E-MODULES", f"实例 id「{mid}」含「.」——与连接件派生 id（<实例id>.link）冲突"))
    if not m.get("module") or not isinstance(m.get("module"), str):
        errs.append(("E-MODULES", f"{where}.module 缺失（须引用 modules/<id>/module.json 的模块 id）"))
    if "link" in m and m["link"] not in ("auto", "manual"):
        errs.append(("E-LINK", f"{where}.link={m['link']!r} 非法（auto|manual，缺省取 defaults.link）"))
    if "caps" in m:
        check_caps_like(m["caps"], where, errs)
    if "insert" in m:
        check_insert(m["insert"], where, errs)
    if "iterate" in m:
        it = m["iterate"]
        if not isinstance(it, dict) or not it.get("unit") or not it.get("over"):
            errs.append(("E-ITERATE", f"{where}.iterate 须为含 unit/over 的 object，实为 {it!r}"))
        elif it["unit"] not in UNITS:
            errs.append(("E-ITERATE", f"{where}.iterate.unit={it['unit']!r} 非法（chapter|volume|episode）"))
    if "vary" in m:
        v = m["vary"]
        if not isinstance(v, dict):
            errs.append(("E-VARY", f"{where}.vary 须为 object，实为 {type(v).__name__}"))
        else:
            for unit, diff in v.items():
                if not isinstance(diff, dict):
                    errs.append(("E-VARY", f"{where}.vary[\"{unit}\"] 须为 object"))
                    continue
                if "caps" in diff:
                    check_caps_like(diff["caps"], f"{where}.vary[\"{unit}\"]", errs)
                if "insert" in diff:
                    check_insert(diff["insert"], f"{where}.vary[\"{unit}\"]", errs)


def module_registry():
    """读 modules/*/module.json → {id: caps}；库不存在/为空返回 None（调用方降级为 W）。"""
    reg = {}
    for p in sorted(ROOT.glob("modules/*/module.json")):
        try:
            d = json.loads(p.read_text(encoding="utf-8-sig"))
            reg[d.get("id") or p.parent.name] = d.get("caps") or []
        except Exception:
            continue
    return reg or None


def lint(flow, src):
    errs, warns = [], []
    if "__bad_json__" in flow:
        errs.append(("E-JSON", f"{src} 不是合法 JSON：{flow['__bad_json__']}"))
        return errs, warns
    if flow.get("format") != "flow@3":
        errs.append(("E-FORMAT", f"format={flow.get('format')!r}，须为 \"flow@3\""))
    fid = flow.get("id")
    if not fid or not isinstance(fid, str) or not ID_RE.match(fid):
        errs.append(("E-ID", f"id={fid!r} 缺失或非法（{ID_RE.pattern}）"))
    if not flow.get("title"):
        errs.append(("E-TITLE", "title 缺失"))
    if not flow.get("version"):
        errs.append(("E-VERSION", "version 缺失（flow.schema required）"))
    st = flow.get("status")
    if not st:
        errs.append(("E-STATUS", "status 缺失（draft|official|retired）"))
    elif st not in ("draft", "official", "retired"):
        errs.append(("E-STATUS", f"status={st!r} 非法（draft|official|retired）"))
    for k in flow:
        if k not in TOP_KEYS:
            legacy = "（flow@2 遗留键）" if k in LEGACY_KEYS else ""
            errs.append(("E-SCHEMA", f"顶层键「{k}」不在 flow@3 冻结契约内{legacy}；允许：{', '.join(sorted(TOP_KEYS))}"))
    if "link" in flow.get("defaults", {}) and flow["defaults"]["link"] not in ("auto", "manual"):
        errs.append(("E-LINK", f"defaults.link={flow['defaults']['link']!r} 非法（auto|manual）"))

    mods = flow.get("modules")
    if not isinstance(mods, list) or not mods:
        errs.append(("E-MODULES", "modules 缺失、非数组或为空（flow@3 = 模块序列，至少一个模块实例）"))
        mods = []
    ids = set()
    for i, m in enumerate(mods):
        if isinstance(m, dict):
            check_module_instance(m, i, errs, ids)
        else:
            errs.append(("E-MODULES", f"modules[{i}] 须为 object"))

    reg = module_registry()
    if reg is None:
        if mods:
            warns.append(("W-REG", "模块库 modules/ 缺失或为空：module 引用与 caps 可满足性未核对"))
    else:
        for m in mods:
            if not isinstance(m, dict):
                continue
            ref = m.get("module")
            if ref and ref not in reg:
                warns.append(("W-MODULE", f"实例「{m.get('id')}」引用模块「{ref}」不存在（可用：{', '.join(sorted(reg))}）"))
                continue
            if ref and isinstance(m.get("caps"), list):
                have = set(reg[ref])
                for c in m["caps"]:
                    if isinstance(c, str) and have and c not in have:
                        warns.append(("W-CAPS", f"实例「{m.get('id')}」请求能力「{c}」，模块「{ref}」不提供（有：{'、'.join(sorted(have))}）"))
    return errs, warns


def main() -> int:
    flow, src = load()
    errs, warns = lint(flow, src)
    if ASJSON:
        print(json.dumps({
            "file": src, "ok": not errs,
            "errors": [{"code": c, "msg": m, **({"fixHint": HINTS[c]} if FIXHINT else {})} for c, m in errs],
            "warnings": [{"code": c, "msg": m, **({"fixHint": HINTS[c]} if FIXHINT else {})} for c, m in warns],
        }, ensure_ascii=False, indent=2))
    else:
        print(f"skeleton-lint · {src}")
        for c, m in errs:
            print(f"ERROR {c} {m}")
            if FIXHINT:
                print(f"      ↳ 下一步：{HINTS[c]}")
        for c, m in warns:
            print(f"WARN  {c} {m}")
            if FIXHINT:
                print(f"      ↳ 下一步：{HINTS[c]}")
        n_modules = len(flow.get("modules") or []) if isinstance(flow, dict) else 0
        print(f"--- {'PASS' if not errs else 'FAIL'} ｜ {n_modules} 模块实例 ｜ {len(errs)} errors ｜ {len(warns)} warnings")
    bad = bool(errs) or (STRICT and bool(warns))
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
