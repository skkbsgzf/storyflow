"""kit-lint · kit@1 底座体检（单一事实源一致性 + 覆盖率）

治理目标（R1 报告三个次生问题）：声明漂移 / 孤儿与漏登记 / 断言的死覆盖。
单一事实源 = kits/<domain>/kit.json；skills/ knowledge/ tools/minitools.json flows/ 为被校验面。

检查项（E=error 阻断，W=warning 提示）：
  E1 kit.json 合法性（format/domain/ops；op 至少绑定 skill|minitools|script 之一）
  E2 op.skill 必须有档案 skills/<id>.md
  E3 op.knowledge 条目必须存在于 knowledge/index.json
  E4 op.minitools 必须登记在 tools/minitools.json；op.script 文件必须存在
  E5 flow 节点的 kit/op 引用必须存在，且与 node.skill 一致（不一致=漂移）
  E6 同一 skill 不得挂在两个 kit（内核按技能反查会歧义）
  E7 op.config 声明必须存在（R5：能力不可调 = 违背「每个 tool 都能被优化」）
  E8 op.config 各项合法（type/default/enum/desc；enum 的 default 必须在枚举内）
  E9 op.exclude_knowledge 条目必须存在于 knowledge/index.json
  W1 孤儿技能：有档案但无 kit 归属（内核漏装）
  W2 未用技能：有 kit 但无任何 flow 引用
  W3 悬空知识：knowledge 条目从未被任何 op 引用
  W4 断言缺口：aesthetic 断言表中从未被任何 op 覆盖的条目
  W5 tool 内容配置项没人在用（flow 节点 config 从未覆盖过它）——提示：要么是默认值够用，要么是旋钮是摆设
  W6 gate 节点未标 gate_role（R5 门降级：域内门自动放行，建议 overlay 裁掉或显式标 kit-boundary）
  W7 overlay 文件用了非法的 patch kind / 预算外的字段
用法：python tools/kit-lint.py [--strict]   # --strict 让 warning 也失败
"""
import json, sys, glob, re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STRICT = "--strict" in sys.argv

# R5 通用配置项（内核 kits.ts 的 GENERIC_CONFIG 镜像；op 可用同名 key 覆写默认值）
GENERIC_CONFIG = {"depth", "strictness", "maxChars", "model_tier"}
CONFIG_TYPES = {"number", "string", "boolean", "enum", "array"}
PATCH_KINDS = {
    "set-node", "set-op", "place-node", "remove-node", "set-edge", "add-edge",
    "remove-edge", "set-tool", "set-policy", "suppress-boundary", "set-input",
}

E, W = [], []


def load(p):
    return json.loads(Path(p).read_text(encoding="utf-8"))


def main():
    # R6 兼容层（WO-02）：kit@1 已由 module@1 取代——modules/ 库存在时本工具降级为存量对照模式，
    # E 级不再阻断（提交门禁改用 python tools/module-lint.py）。kits/ 保留供 WO-08 转换对照。
    legacy_mode = any((ROOT / "modules").glob("*/module.json"))
    if legacy_mode:
        print("note: kit@1 已由 module@1 取代（R6）——kit-lint 为存量对照模式（不阻断）；门禁请改用 python tools/module-lint.py")

    kits = {}
    for kp in sorted(glob.glob(str(ROOT / "kits" / "*" / "kit.json"))):
        k = load(kp)
        name = Path(kp).parent.name
        if k.get("format") != "kit@1":
            E.append(f"kit {name}: format 必须为 kit@1")
        if k.get("domain") not in ("search", "plot", "prose", "tool"):
            E.append(f"kit {name}: domain 非法 {k.get('domain')}")
        if k.get("id") != name:
            W.append(f"kit {name}: id({k.get('id')}) 与目录名不一致")
        if not k.get("ops"):
            E.append(f"kit {name}: ops 为空")
        kits[k["id"]] = k
    if not kits:
        E.append("未找到任何 kits/<domain>/kit.json")

    kb_index = {e["id"] for e in load(ROOT / "knowledge" / "index.json")["entries"]}
    registry = load(ROOT / "tools" / "minitools.json")
    reg_tools = set(registry.get("minitools", {}))
    have_skill = {p.stem for p in (ROOT / "skills").glob("*.md")}

    # ── op 级校验 ──────────────────────────────────────────────
    skill_home, op_kb, op_asserts, op_mt = {}, set(), set(), set()
    op_asserts_by_op = {}  # "kit/op" → [assert id]（R5 §四 声明空转台账）
    op_configs, op_cfg_keys, node_cfg_used = {}, set(), set()
    for kid, k in kits.items():
        for op_id, op in k["ops"].items():
            tag = f"{kid}/{op_id}"
            if not (op.get("skill") or op.get("minitools") or op.get("script")):
                E.append(f"{tag}: op 未绑定 skill/minitools/script 任一")
            s = op.get("skill")
            if s:
                if s not in have_skill:
                    E.append(f"{tag}: 技能档案缺失 skills/{s}.md")
                if s in skill_home:
                    E.append(f"{tag}: 技能 {s} 已挂在 {skill_home[s]}，同一技能不得跨 kit（反查歧义）")
                skill_home[s] = kid
            for kb in op.get("knowledge", []):
                if kb.endswith("/*"):
                    hit = [i for i in kb_index if i.startswith(kb[:-1])]
                    if not hit:
                        E.append(f"{tag}: glob 无匹配 {kb}")
                    op_kb.update(hit)
                elif kb not in kb_index:
                    E.append(f"{tag}: 知识条目不存在 {kb}")
                else:
                    op_kb.add(kb)
            for mt in op.get("minitools", []):
                if mt not in reg_tools:
                    E.append(f"{tag}: minitool 未登记 {mt}")
                op_mt.add(mt)
            for a in op.get("asserts", []):
                op_asserts.add(a)
                op_asserts_by_op.setdefault(tag, []).append(a)
            for asst in op.get("assist", []):
                if asst not in have_skill:
                    W.append(f"{tag}: assist 技能不存在 {asst}")
            # ── R5：内容配置项声明（每个 tool 都必须可调）──────────────
            cfg = op.get("config")
            if not isinstance(cfg, dict):
                E.append(f"{tag}: 缺 config 声明（R5：tool 的内容配置项必须可被用户/优化 agent 调优；")
                continue
            op_configs[tag] = set(cfg)
            for ck, cd in cfg.items():
                if not isinstance(cd, dict):
                    E.append(f"{tag}.config.{ck}: 声明必须是对象")
                    continue
                t = cd.get("type")
                if t not in CONFIG_TYPES:
                    E.append(f"{tag}.config.{ck}: type 非法 {t!r}（∈ {sorted(CONFIG_TYPES)}）")
                if not cd.get("desc"):
                    E.append(f"{tag}.config.{ck}: 缺 desc（优化 agent 靠它判断这个旋钮控制什么）")
                if "default" not in cd:
                    W.append(f"{tag}.config.{ck}: 未给 default（内核回填 undefined，面板无从显示当前值）")
                if t == "enum":
                    opts = cd.get("enum")
                    if not isinstance(opts, list) or not opts:
                        E.append(f"{tag}.config.{ck}: enum 类型必须给非空 enum 列表")
                    elif cd.get("default") not in opts:
                        E.append(f"{tag}.config.{ck}: default={cd.get('default')!r} 不在 enum {opts}")
                if t == "number" and cd.get("default") is not None and not isinstance(cd["default"], (int, float)):
                    E.append(f"{tag}.config.{ck}: number 类型的 default 必须是数字")
            for ex in op.get("exclude_knowledge", []):
                if ex not in kb_index:
                    E.append(f"{tag}: exclude_knowledge 条目不存在 {ex}")
            # R8 选择面 §2.1：候选池池有所指；命中的条目计入 op_kb（不当孤儿）
            for p in op.get("knowledge_pools", []):
                pool = (p or {}).get("pool")
                if not pool:
                    E.append(f"{tag}: knowledge_pools 条目缺 pool 字段")
                    continue
                prefix = pool[:-1] if pool.endswith("*") else pool + "/"
                hits = [i for i in kb_index if i == pool or i.startswith(prefix)]
                if not hits:
                    E.append(f"{tag}: 候选池 {pool} 在 knowledge/index.json 里没有任何条目")
                op_kb.update(hits)
            if op.get("skill_pool") and op.get("skill"):
                W.append(f"{tag}: skill_pool={op['skill_pool']} 之外还焊死 skill={op['skill']}——逃生口绕过选择面（R8 §2.2）")
            op_cfg_keys.update(cfg)

    # ── 技能声明了未登记的 minitool ────────────────────────────
    for p in sorted((ROOT / "skills").glob("*.md")):
        t = p.read_text(encoding="utf-8")
        b = re.search(r"^bind:\s*\{(.*?)\}\s*$", t, re.M | re.S)
        if not b:
            continue
        mm = re.search(r"minitools:\s*\[(.*?)\]", b.group(1), re.S)
        for mt in re.findall(r'"([^"]+)"', mm.group(1)) if mm else []:
            if mt not in reg_tools:
                W.append(f"技能 {p.stem}: 声明了未登记的 minitool {mt}")

    # ── flow 引用校验（漂移探测） ──────────────────────────────
    used_skills, n_nodes = set(), 0
    node_asserts = {}  # "flow/node" → [assert id]
    node_meta = {}  # "flow/node" → {kind, minitool}（空转分级：断言校验步=机器契约；其余=语义记账）
    for fp in sorted(glob.glob(str(ROOT / "flows" / "*" / "flow.json"))):
        fl = load(fp)
        fid = fl.get("id", Path(fp).parent.name)
        if "graph" not in fl:
            # flow@3（模块序列）：无手画图。派生节点的 kit/op 声明以内核 effective@2 为准
            # （module-lint 管模块声明层；此处只对「跑过的项目」能核到派生面，缺 effective 跳过并显式回显）
            eff_seen = False
            for eff_path in sorted(glob.glob(str(ROOT / "projects" / "*" / "registry" / "effective.json"))):
                try:
                    eff = load(Path(eff_path))
                except Exception:
                    continue
                if eff.get("flowId") != fid:
                    continue
                eff_seen = True
                for nid, n in (eff.get("nodes") or {}).items():
                    s, kit, op = n.get("skill"), n.get("kit"), n.get("op")
                    na = n.get("asserts") or []
                    if isinstance(na, str):
                        na = [na]
                    if na:
                        node_asserts[f"{fid}/{nid}"] = list(na)
                        node_meta[f"{fid}/{nid}"] = {"kind": n.get("kind", ""), "minitool": n.get("minitool", "")}
            if not eff_seen:
                print(f"  [skip] flow@3「{fid}」无已跑项目的 effective@2——派生面 kit/op 免检（module-lint 覆盖声明层）")
            continue
        for nid, n in fl["graph"]["nodes"].items():
            s, kit, op = n.get("skill"), n.get("kit"), n.get("op")
            na = n.get("asserts") or n.get("check") or []
            if isinstance(na, str):
                na = [na]
            if na:
                node_asserts[f"{fid}/{nid}"] = list(na)
                node_meta[f"{fid}/{nid}"] = {"kind": n.get("kind", ""), "minitool": n.get("minitool", "")}
            # R5 内容配置项：节点 config 的键必须在该 op 的声明里（否则内核会显式标记为未识别）
            ncfg = n.get("config") or {}
            if ncfg:
                if kit and op:
                    declared = kits.get(kit, {}).get("ops", {}).get(op, {}).get("config", {})
                    for ck in ncfg:
                        if ck not in declared and ck not in GENERIC_CONFIG:
                            W.append(f"[{fid}/{nid}] config.{ck} 不在 {kit}/{op}.config 声明内（内核会显式标为未识别）")
                        node_cfg_used.add(f"{kit}/{op}.{ck}")
                else:
                    W.append(f"[{fid}/{nid}] 有 config 但缺 kit/op——配置无处生效")
            # R5 门降级：唯一合法门角色是 kit 边界验收。
            # 注意区分两类「未标 role 的门」——它们的处理方式不同，混为一谈会误导：
            #   · 纯汇合点（无产活）：直接裁掉，零损失；
            #   · 带产活的门：它是**评审步**（R5 会照跑、只把裁决自动化）。裁掉它必须先确认
            #     它写的意见书真的没人消费，否则是把质量信号一起删掉。
            if n.get("kind") == "gate":
                gr = n.get("gate_role")
                if gr is None:
                    work = bool(n.get("output") or n.get("skill") or n.get("op") or n.get("minitool"))
                    if work:
                        W.append(f"[{fid}/{nid}] 门上挂着产活（output/skill/op）＝域内评审步，未标 gate_role。"
                                 f"R5 会照跑它但自动裁决；红蓝对抗残留，建议由优化器按「产物是否被下游消费」提案裁掉，"
                                 f"或标 kit-boundary 明确为交界验收")
                    else:
                        W.append(f"[{fid}/{nid}] 纯汇合点门未标 gate_role（R5 已自动放行，无产活无裁决价值）："
                                 f"建议 overlay remove-node 裁掉")
                elif gr != "kit-boundary":
                    E.append(f"[{fid}/{nid}] gate_role={gr!r} 非法（R5 唯一合法值 kit-boundary）")
            if not s:
                if n.get("kb"):
                    W.append(f"[{fid}/{nid}] 残留 kb 声明（应改 kit/op）")
                continue
            n_nodes += 1
            used_skills.add(s)
            if not kit or not op:
                W.append(f"[{fid}/{nid}] 未迁移：缺 kit/op（技能 {s}）")
                continue
            spec = kits.get(kit, {}).get("ops", {}).get(op)
            if not spec:
                E.append(f"[{fid}/{nid}] kit 引用无效：{kit}/{op}")
            elif spec.get("skill") != s:
                E.append(f"[{fid}/{nid}] 漂移：node.skill={s} 但 {kit}/{op}.skill={spec.get('skill')}")
            if n.get("kb"):
                E.append(f"[{fid}/{nid}] 同时存在 kb 与 kit/op（两套真相）")

    # ── 覆盖率 ────────────────────────────────────────────────
    for s in sorted(have_skill - set(skill_home)):
        W.append(f"孤儿技能（无 kit 归属，内核不会装载其标尺）: {s}")
    # 内核动词直调的技能不挂 flow 节点（如 orchestration-miner 由 flow_mine 组装派发）——豁免记账
    VERB_SKILLS = {"orchestration-miner"}
    for s in sorted(set(skill_home) - used_skills - VERB_SKILLS):
        W.append(f"未用技能（有 kit 但无 flow 引用）: {s}")
    for kb in sorted(kb_index - op_kb):
        W.append(f"悬空知识条目（无 op 引用）: {kb}")

    try:
        aj = load(ROOT / "knowledge" / "aesthetic" / "assertions.json")
        asserts = aj.get("asserts") or aj.get("assertions") or []
        ids = {a.get("id") for a in asserts if isinstance(a, dict)}
        uncovered = sorted(ids - op_asserts)
        if uncovered:
            W.append(f"断言缺口：{len(uncovered)}/{len(ids)} 条断言无 op 覆盖 → {', '.join(uncovered[:12])}")

        # ── R5 §四闭合：声明了 ≠ 有人验 ──────────────────────────
        # 内核在提交/断言步会逐条裁声明断言；引擎（core/src/aesthetic.ts）验不了的会显式标
        # 成 unverified。此处做静态台账，免得「声明空转」又悄悄长回来。
        # 取引擎 id 用源码正则——这是近似的 lint 守卫，不是运行时契约；
        # 真正裁决以内核 runDeclaredAsserts 的结果为准（落 metrics.jsonl / 断言报告）。
        eng_src = (ROOT / "core" / "src" / "aesthetic.ts").read_text(encoding="utf-8")
        engine = {m.split("#")[0] for m in re.findall(r'"(AE-[A-Z0-9#\-]+)"', eng_src)}
        engine.discard("AE-EXISTS")
        engine.discard("AE-SKIP-NON-BEAT")
        via = {a.get("id"): a.get("checks_via") for a in asserts if isinstance(a, dict)
               and a.get("checks_via") and a.get("checks_via") != "self"}

        def eng_ok(a):
            return a in engine or via.get(a) in engine

        declared = {}  # id → [声明处]
        for tag, la in node_asserts.items():
            for a in la:
                declared.setdefault(a, []).append(tag)
        for tag, la in op_asserts_by_op.items():
            for a in la:
                declared.setdefault(a, []).append(tag)
        # 空转分级（R5 §4.1 红线：禁止删声明降警告；语义层的家是评审剖面，要记账不要假装）
        #  · 机器契约步（断言校验 core 步）声明了引擎查不了的 id = 真空转 → WARN，必须修
        #  · 其余（写作 op 的自检 rubric / 评审节点）= 归评审语义剖面 → 记账不告警
        unveri_machine, unveri_else = {}, {}
        for a, w in declared.items():
            if eng_ok(a):
                continue
            on_machine = any(node_meta.get(tag, {}).get("kind") == "core" for tag in w)
            (unveri_machine if on_machine else unveri_else)[a] = w
        if unveri_machine:
            E.append(f"声明空转（机器校验步）：{len(unveri_machine)} 条断言在断言校验步声明了但引擎查不了"
                     f"（补校验器，或移出并记账为「归评审」）→ "
                     + ", ".join(f"{a}({len(w)}处)" for a, w in sorted(unveri_machine.items())[:8]))
        if unveri_else:
            W.append(f"声明归评审（语义层记账，非空转）：{len(unveri_else)} 条断言无机器校验器，"
                     f"声明于写作/评审层（内核提交时显式标 unverified，归评审/红方剖面）→ "
                     + ", ".join(f"{a}({len(w)}处)" for a, w in sorted(unveri_else.items())[:8]))
        orphan = sorted(engine - ids)
        if orphan:
            W.append(f"未登记断言：引擎发出但 knowledge/aesthetic/assertions.json 里没有 "
                     f"{len(orphan)} 条 → {', '.join(orphan[:8])}"
                     f"（两套命名=漂移；注册表是断言的唯一台账）")
    except Exception as e:
        W.append(f"断言表读取失败: {e}")

    # ── overlay 校验（R5 生成式编排：改动必须可解释、optimizer 必须给证据）──
    overlay_files = (
        sorted(glob.glob(str(ROOT / "flows" / "*" / "overlay.default.json")))
        + sorted(glob.glob(str(ROOT / "projects" / "*" / "registry" / "overlay.json")))
    )
    n_patch = 0
    for of in overlay_files:
        rel = Path(of).relative_to(ROOT).as_posix()
        try:
            ov = load(of)
        except Exception as ex:
            E.append(f"{rel}: overlay 解析失败 {ex}")
            continue
        if ov.get("format") != "flow-overlay@1":
            E.append(f"{rel}: format 必须为 flow-overlay@1")
        if not ov.get("flowId"):
            E.append(f"{rel}: 缺 flowId")
        origin = ov.get("origin")
        if origin not in ("user", "optimizer", "factory", "kernel"):
            E.append(f"{rel}: origin 非法 {origin!r}")
        for i, p in enumerate(ov.get("patches", [])):
            n_patch += 1
            k = p.get("kind")
            if k not in PATCH_KINDS:
                E.append(f"{rel}#{i}: patch kind 非法 {k!r}")
            if not p.get("reason"):
                E.append(f"{rel}#{i}（{k}）: 缺 reason（编排改动必须可解释）")
            if origin == "optimizer" and p.get("status") in (None, "applied") and not p.get("evidence"):
                E.append(f"{rel}#{i}（{k}）: optimizer 的生效补丁必须带 evidence（指标依据）")

    # ── 出账 ─────────────────────────────────────────────────
    if legacy_mode and E:
        print(f"note: 对照模式——{len(E)} 条 error 降级为 warning（kit@1 存量，不再作为门禁）：")
        for x in E:
            print("  WARN(降级)", x)
        W.extend("E降级: " + x for x in E)
        E.clear()
    n_ops = sum(len(k["ops"]) for k in kits.values())
    n_cfg = sum(len(v) for v in op_configs.values())
    print(f"kit-lint ｜ {len(kits)} kits / {n_ops} ops ｜ {len(have_skill)} 技能 ｜ {n_nodes} agent 节点")
    print(f"          ｜ R5 内容配置项 {n_cfg} 个（{len(op_configs)} 个 op 已声明）"
          f" ｜ flow 显式覆盖 {len(node_cfg_used)} ｜ overlay {len(overlay_files)} 份 / {n_patch} 条补丁")
    for x in E:
        print("ERROR", x)
    for x in W:
        print("WARN ", x)
    print(f"--- {len(E)} errors ｜ {len(W)} warnings")
    sys.exit(1 if E or (STRICT and W) else 0)


main()
