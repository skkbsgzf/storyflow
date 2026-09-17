"""flow-lint · flow@2 配置体检（规范 R4 §五/§六）

单一事实源：contracts/flow.schema.json（字段白名单） + tools/minitools.json（core 工具注册表）
            + kits/*/kit.json（kit.op 注册表） + skills/*.md（技能档案）

检查项（E=error 阻断，W=warning 提示）：
  E1 严格 JSON：重复键即错（文本级字段手术的经典事故：role 双写、loop 语义丢失）
  E2 旧字段名全面退场：node.file/check/review/kb、edge.transform/optional/loop、当字符串
  E3 边：id 形态、role 合法、reject 带 params.scope、when 可解析（与 cond.ts 同源规则）
  E4 via 与目标节点执行体一致时为冗余声明（应删）；显式声明须登记为 skill/core/sm
  E5 节点：kind 合法、stage ∈ 顶层 stages[].id、agent 必须 kit+op 且 kit 内存在该 op
  E6 产物路径准入：内部/{意见,收据,依据,稿本} · 对外交付 · 章节正文 · 世界书 · 根级仅输入材料
  E7 交付清单：node 必须存在、path（若声明）必须是合格路径、节点不得重复
  W1 字符串 when（可解析，建议结构化）；W2 iterate 缺 artifact；W3 graph.outputs 与交付清单不一致
用法：python tools/flow-lint.py [flowId ...]      # 缺省校验全部 flow
退出码：有 error=1（warning 不算失败）；--strict 让 warning 也失败
"""
import json, sys, glob, re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STRICT = "--strict" in sys.argv
REG = json.loads((ROOT / "tools" / "minitools.json").read_text(encoding="utf-8"))

KINDS = ("novel-txt", "core", "agent", "gate", "srd")
ROLES = ("flow", "reject", "optional", "loop", "batch")
ADMITTED = ("内部/意见/", "内部/收据/", "内部/依据/", "内部/稿本/", "对外交付/", "章节正文/", "世界书/")
LEGACY_NODE = ("file", "check", "review", "kb")
LEGACY_EDGE = ("transform", "optional", "loop")
MIGRATE_HINT = "；迁移：kit-migrate → flow-kit-apply → flow-normalize → r5-migrate（见 docs/迁移链-flow@1到R5.md）"
WHEN_KEYS = ("verdict", "challenge", "cause", "input", "eq", "gt", "lt", "loop", "any", "all")
VERDICT_ALIAS = {"rejected": "send-back", "send_back": "send-back"}


def strict_load(path: Path):
    """解析并拒绝重复键——前端看到的字段与内核读到的字段必须一致。"""
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


def when_parsable(w) -> bool:
    """与 core/src/cond.ts::evalWhen 同源的"能不能求值"判定。"""
    if w is None or w == "":
        return True
    if isinstance(w, dict):
        keys = [k for k in w if k in WHEN_KEYS]
        if not keys:
            return True  # 空谓词 = 无条件
        for k in ("any", "all"):
            if k in w and not all(when_parsable(x) for x in (w[k] or [])):
                return False
        return True
    s = str(w).strip()
    if s in ("rejected", "challenge"):
        return True
    if re.search(r"根因[=：:]\s*\S+", s):
        return True
    if re.match(r"^[^=]+=[^=]+$", s):
        return True
    return False


def node_output(n: dict) -> str:
    return str(n.get("output") or n.get("file") or "").replace("\\", "/")


def via_of(flow: dict, e: dict) -> str:
    """边执行语义：显式 via 优先，否则派生自目标节点。"""
    if e.get("via"):
        return str(e["via"])
    to = flow["graph"]["nodes"].get(e.get("to")) or {}
    if to.get("kit") and to.get("op"):
        return f"{to['kit']}.{to['op']}"
    if to.get("minitool"):
        return f"core.{to['minitool']}"
    return str(to.get("kind") or "")


def lint_flow(flow_id, kits, have_skill):
    errors, warnings = [], []
    fp = ROOT / "flows" / flow_id / "flow.json"
    try:
        f, dups = strict_load(fp)
    except Exception as ex:
        return [f"[{flow_id}] JSON 解析失败：{ex}"], []
    if dups:
        errors.append(f"[{flow_id}] JSON 重复键 {sorted(set(dups))}（前端与内核会读到不同值）")

    tag = f"[{flow_id}]"
    if f.get("format") != "flow@2":
        warnings.append(f"{tag} format={f.get('format')}（当前规范为 flow@2）")
    if not f.get("status"):
        errors.append(f"{tag} 缺顶层 status（页面按状态发布/归档）")
    if f.get("deliverables"):
        errors.append(f"{tag} 残留 deliverables[]（已并入 outputs[]）")

    g = f.get("graph") or {}
    nodes = g.get("nodes") or {}
    edges = g.get("edges") or []
    stage_ids = {s.get("id") for s in f.get("stages") or []}

    for nid, n in nodes.items():
        nt = f"{tag} 节点 {nid}"
        if n.get("kind") not in KINDS:
            errors.append(f"{nt}: kind 非法 {n.get('kind')}")
        if not n.get("title"):
            warnings.append(f"{nt}: 缺 title（页面/画布无标签）")
        for k in LEGACY_NODE:
            if k in n:
                errors.append(f"{nt}: 残留旧字段 {k}（flow@2 唯一名见规范 §5.1）{MIGRATE_HINT}")
        if n.get("stage") and stage_ids and n["stage"] not in stage_ids:
            errors.append(f"{nt}: stage={n['stage']} 不在顶层 stages[].id")
        if isinstance(n.get("when"), str):
            warnings.append(f"{nt}: when 为字符串「{n['when']}」（建议结构化）")
        if n.get("when") is not None and not when_parsable(n["when"]):
            errors.append(f"{nt}: when 不可求值「{n['when']}」——永久死条件")
        # agent/gate：kit + op 引用
        if n.get("kind") in ("agent", "gate"):
            kit, op = n.get("kit"), n.get("op")
            if not kit or not op:
                errors.append(f"{nt}: 缺 kit/op（agent 节点必须引用 kit.op，单一事实源）")
            elif op not in (kits.get(kit) or {}).get("ops", {}):
                errors.append(f"{nt}: kit 引用无效 {kit}/{op}")
            elif n.get("skill") and (kits[kit]["ops"][op].get("skill") != n["skill"]):
                errors.append(
                    f"{nt}: 漂移 node.skill={n['skill']} 但 {kit}/{op}.skill={kits[kit]['ops'][op].get('skill')}"
                )
        if n.get("minitool") and n["minitool"] not in REG.get("minitools", {}):
            errors.append(f"{nt}: minitool 未登记 {n['minitool']}")
        # 执行体缺失 = 能力声明了但触达即 blocked（本轮最有价值的一条拦截）
        if n.get("kind") == "core" and not n.get("minitool"):
            errors.append(f"{nt}: core 节点无 minitool —— 触达即 blocked（能力声明了、执行体不存在）")
        if n.get("iterate"):
            if not n["iterate"].get("artifact"):
                warnings.append(f"{nt}: iterate 缺 artifact（实例产物无槽位模板）")
            if not n["iterate"].get("unit"):
                errors.append(f"{nt}: iterate 缺 unit")
        # 产物路径准入
        out = node_output(n)
        if out:
            ok = out.startswith(ADMITTED) or (n.get("kind") == "novel-txt" and "/" not in out)
            if not ok:
                errors.append(f"{nt}: 产物 {out} 不在准入目录（规范 §一）")

    for e in edges:
        et = f"{tag} 边 {e.get('id','?')}"
        if not re.match(r"^e-[a-z0-9-]+$", str(e.get("id", ""))):
            errors.append(f"{et}: id 须形如 e-<slug>")
        for side in ("from", "to"):
            if e.get(side) not in nodes:
                errors.append(f"{et}: {side} 端点不存在 {e.get(side)}")
        if e.get("role") not in ROLES:
            errors.append(f"{et}: role 非法/缺失 {e.get('role')}（合法：{'|'.join(ROLES)}）")
        for k in LEGACY_EDGE:
            if k in e:
                errors.append(f"{et}: 残留旧字段 {k}（role 单值化后不应存在）{MIGRATE_HINT}")
        if isinstance(e.get("when"), str):
            if when_parsable(e["when"]):
                warnings.append(f"{et}: when 为字符串「{e['when']}」（建议结构化）")
            else:
                errors.append(f"{et}: when 不可求值「{e['when']}」——前端看得见、内核判不动的死线")
        elif e.get("when") is not None and not when_parsable(e["when"]):
            errors.append(f"{et}: when 结构非法 {e['when']}")
        if e.get("role") == "reject" and not (e.get("params") or {}).get("scope"):
            errors.append(f"{et}: 打回边必须带 params.scope（面板要渲染失效范围）")
        if e.get("via"):
            want = via_of(f, {k: v for k, v in e.items() if k != "via"})
            if e["via"] == want:
                warnings.append(f"{et}: via={e['via']} 与目标节点执行体一致 → 冗余声明，应删")
            else:
                pre, _, rest = str(e["via"]).partition(".")
                if pre == "sm":
                    if e["via"] not in REG.get("edgeSemantics", {}) and e["via"] not in (f.get("semantics") or {}):
                        warnings.append(f"{et}: 编排语义 '{e['via']}' 未登记（注册表 edgeSemantics 或 flow.semantics）——读者看不懂")
                elif pre in kits:
                    if rest and rest not in (kits[pre].get("ops") or {}):
                        errors.append(f"{et}: via={e['via']} 的 op 不存在于 kit {pre}")
                elif pre == "core":
                    if rest not in REG.get("minitools", {}):
                        errors.append(f"{et}: via minitool '{rest}' 未登记")
                elif pre == "skill":
                    if not (ROOT / "skills" / f"{rest}.md").exists():
                        errors.append(f"{et}: via skill '{rest}' 无档案（flow@2 应改用 <kit>.<op>）")
                else:
                    errors.append(f"{et}: via '{e['via']}' 无法解析（合法：<kit>.<op> | core.<minitool> | sm.<语义>）")

    # 交付清单
    seen_nodes = set()
    for o in f.get("outputs") or []:
        nid = o.get("node") if isinstance(o, dict) else o
        ot = f"{tag} 交付清单 {nid or '(无节点)'}"
        if not nid or nid not in nodes:
            errors.append(f"{ot}: node 不存在于 graph.nodes（清单早于节点拆分的典型漂移）")
            continue
        if nid in seen_nodes:
            errors.append(f"{ot}: 节点重复声明（一条即可，多产物走 iterate.artifact）")
        seen_nodes.add(nid)
        if isinstance(o, dict):
            p = str(o.get("path") or o.get("file") or "").replace("\\", "/")
            if p and ("/" not in p or not p.startswith(ADMITTED)):
                errors.append(f"{ot}: path「{p}」不是合格路径（合格形态：对外交付/NN-名.ext 或 内部/…）")
            if "file" in o:
                errors.append(f"{ot}: 残留 file（改用 path，缺省回落节点 output）")
            if "order" in o:
                warnings.append(f"{ot}: 残留 order（定序由 对外交付/NN- 前缀承担）")

    for nid in g.get("outputs") or []:
        if nid not in nodes:
            errors.append(f"{tag} graph.outputs 引用不存在节点 {nid}")

    return errors, warnings


def main():
    ids = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not ids:
        ids = sorted(Path(d).name for d in glob.glob(str(ROOT / "flows" / "*")) if (Path(d) / "flow.json").exists())
    kits = {}
    for kp in sorted(glob.glob(str(ROOT / "kits" / "*" / "kit.json"))):
        k = json.loads(Path(kp).read_text(encoding="utf-8"))
        kits[k["id"]] = k
    have_skill = {p.stem for p in (ROOT / "skills").glob("*.md")}
    total_e = total_w = 0
    for fid in ids:
        errs, warns = lint_flow(fid, kits, have_skill)
        total_e += len(errs)
        total_w += len(warns)
        for e in errs:
            print("ERROR", e)
        for w in warns:
            print("WARN ", w)
    print(f"--- {len(ids)} flows ｜ {total_e} errors ｜ {total_w} warnings")
    sys.exit(1 if total_e or (STRICT and total_w) else 0)


if __name__ == "__main__":
    main()
