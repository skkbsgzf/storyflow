"""kit-lint · 能力注册表体检（单一事实源一致性 + 覆盖率）

v4.2.0（工单批D）：数据源从 kits/<domain>/kit.json 切到 modules/<id>/module.json——
kit@1 已清场，本工具与 module-lint 同为阻断门禁（module-lint 管契约结构，本工具管
运行时事实源一致性：引用漂移 / 孤儿 / 规则与扫描器台账 / 配置面 / overlay 合法性）。
单一事实源 = modules/<id>/module.json；skills/ knowledge/ tools/minitools.json flows/ 为被校验面。

v5.0（工单 §三「断言覆盖/漂移类检查改挂规则引用有效性口径」）：原「断言缺口 / 声明空转」两笔
账随声明式断言协议下架。改挂的三笔账：①规则卡引用必须真存在（kb/rules/* 按盘上核账）；
②台账 C 轨条目必须有家（进卡）；③T 轨声称工具化的必须真有实现（防止「退役=把能力删了」）。

检查项（E=error 阻断，W=warning 提示）：
  E1 module.json 合法性（id/ops；op 至少绑定 skill|minitools|script 之一）
  E2 op.skill 必须有档案 skills/<id>.md
  E3 op.knowledge 条目必须存在于 knowledge/index.json（kb/rules/* 规则卡按盘上核账）
  E4 op.minitools 必须登记在 tools/minitools.json；op.script 文件必须存在
  E5 flow 节点的 kit/op 引用必须存在，且与 node.skill 一致（不一致=漂移）
  E7 op.config 声明必须存在（R5：能力不可调 = 违背「每个 tool 都能被优化」）
  E8 op.config 各项合法（type/default/enum/desc；enum 的 default 必须在枚举内）
  E9 op.exclude_knowledge 条目必须存在于 knowledge/index.json
  E11 overlay 补丁里出现已退役断言字段（add_asserts/remove_asserts/asserts）——v5.0 协议下架
  E12 规则卡 frontmatter 信封不合法（缺必填字段 / type·status 值域 / activation_hint·provenance
      形状）——契约 = contracts/rule.schema.json（rule-card@1，批次2 R2.1 契约先行），本 lint 是
      它在静态门的手工等价物（contracts/README.md 口径）：纯 stdlib 结构校验，不引 jsonschema；
      必填字段清单从 schema 读，不在 lint 里抄第二份名单（抄必漂移，见 _patch_kinds 教训）
  E13 规则卡 scanner_qids 引用了 laya spec 里不存在的 qid（防编造：qid 事实源 =
      tools/laya-ft/questions.spec.json + style.questions.spec.json，qid 永不复用）
  W1 孤儿技能：有档案但无模块归属（内核漏装）
  W2 未用技能：有模块归属但无任何 flow 引用
  W3 悬空知识：knowledge 条目从未被任何 op 引用（规则卡豁免：激活归决策，不归 op 引用）
  W4 扫描器台账缺口：T 轨条目声称工具化但当前无实现（点名，禁止静默蒸发）
  W9 规则语料账：台账 C 轨条目未进任何规则卡 / 卡内引用了 T·X 轨 id（双轨拆分须写明）
  W5 tool 内容配置项没人在用（flow 节点 config 从未覆盖过它）——提示：要么是默认值够用，要么是旋钮是摆设
  W6 gate 节点未标 gate_role（R5 门降级：域内门自动放行，建议 overlay 裁掉或显式标 kit-boundary）
  W7 overlay 文件用了非法的 patch kind / 预算外的字段
  W8 跨模块重复技能：bySkill 反查歧义（批D 口径——原 E6 降级：铁律11 要求「必有 ≥1 家」而非
     「至多 1 家」；flow@3 派生节点一律携 kit+op 显式引用，反查只是无绑定节点的兜底路径，
     重复家无害但须记账。事故前身：kit@1 时代同技能跨 kit 会静默取首个家）
  W10 规则卡收敛字段（clauses/scanner_qids）待铺开的记账（批次2.4 写诊改三相打通时收敛，
     现状缺省合法不阻断；clauses 条目缺 rule_id/tier/severity 同账）
N3 豁免口径（批次3c R3，表 = tools/lintlib.py，逐类显式回显非静默吞）：
  W1 孤儿技能 / W2 未用技能 / W3 悬空知识 三账先过豁免再出 warn——
  ① 目录可达（id 级互引闭包 + 域级检索域变体）② stage:meta/留库备用/草稿待审占位
  ③ 人工链路证据件；豁免名单指向不存在的技能 = 名单陈旧，显式点名
用法：python tools/kit-lint.py [--strict]   # --strict 让 warning 也失败
"""
import json, sys, glob, re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
from lintlib import (  # noqa: E402  台账口径唯一实现（三个 lint 共用）
    CARD_MANUAL_EXEMPT,
    DECLARED_GAPS,
    KB_SEARCH_DOMAINS,
    SKILL_META_EXEMPT,
    draft_card,
    kb_card_edges,
    ledger_entries,
    reach_closure,
    rule_cards,
    scanner_coverage,
    sweep_retired,
    tracks,
)

STRICT = "--strict" in sys.argv

# R5 通用配置项（内核 kits.ts 的 GENERIC_CONFIG 镜像；op 可用同名 key 覆写默认值）
GENERIC_CONFIG = {"depth", "strictness", "maxChars", "model_tier"}
CONFIG_TYPES = {"number", "string", "boolean", "enum", "array"}


def _patch_kinds() -> set:
    """patch kind 的唯一事实源 = contracts/flow-overlay.schema.json（内核 overlay.ts 与之逐项对齐）。
    本地抄一份必漂移：R5 时代这张表缺 set-module/insert-tool/set-link 三种 flow@3 实际消费的 kind，
    于是「合规补丁」被本 lint 判 error（实测 p-yaomo-002 人工插入大纲那条）。"""
    schema = json.loads((ROOT / "contracts" / "flow-overlay.schema.json").read_text(encoding="utf-8"))
    kinds = schema["$defs"]["patch"]["properties"]["kind"]["enum"]
    if not isinstance(kinds, list) or not kinds:
        raise SystemExit("contracts/flow-overlay.schema.json 的 patch.kind.enum 缺失或为空——拒绝静默放行")
    return set(kinds)


PATCH_KINDS = _patch_kinds()

E, W = [], []


def load(p):
    return json.loads(Path(p).read_text(encoding="utf-8"))


def main():
    kits = {}
    for kp in sorted(glob.glob(str(ROOT / "modules" / "*" / "module.json"))):
        k = load(kp)
        name = Path(kp).parent.name
        if k.get("id") != name:
            W.append(f"module {name}: id({k.get('id')}) 与目录名不一致")
        if not k.get("ops"):
            E.append(f"module {name}: ops 为空")
        kits[k["id"]] = k
    if not kits:
        E.append("未找到任何 modules/<id>/module.json（能力注册表事实源缺失）")

    kb_index = {e["id"] for e in load(ROOT / "knowledge" / "index.json")["entries"]}
    # v5.0 批A：规则语料卡（knowledge/rules/*.md）不入 kb 检索台账，按盘上核账并入引用面——
    # op.knowledge 写 kb/rules/<域> 即可被 K1 装载；「未激活」不是「悬空」（激活归决策记账）。
    cards = rule_cards()
    rule_ids = set(cards)
    kb_index |= rule_ids
    registry = load(ROOT / "tools" / "minitools.json")
    reg_tools = set(registry.get("minitools", {}))
    have_skill = {p.stem for p in (ROOT / "skills").glob("*.md")}

    # ── op 级校验 ──────────────────────────────────────────────
    skill_home, op_kb, op_mt = {}, set(), set()
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
                    W.append(f"{tag}: 技能 {s} 同时挂在 {skill_home[s]} 与本模块——bySkill 反查歧义"
                             f"（批D 口径 W8：flow@3 引用均带 kit+op，反查仅兜底；家多不违铁律11）")
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
            # v5.0：op.asserts 采集随断言协议退役（质量条款的家 = op.knowledge 规则卡）
            # assist 字段随 kit@1 退役（批D）：模块 op 无此键，内核无消费方
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
    for fp in sorted(glob.glob(str(ROOT / "flows" / "*" / "flow.json"))):
        fl = load(fp)
        fid = fl.get("id", Path(fp).parent.name)
        if "graph" not in fl:
            # flow@3（模块序列）：无手画图。派生节点的 kit/op 声明以内核 effective@2 为准，
            # 声明层由 module-lint 守（v5.0：原「派生面节点断言采集」随协议下架，此处无其他消费方）。
            # 批次3a P7：技能引用账按内核规则 1（工具选择）轻量展开——
            # spine ∪ capability∩caps ∪ 显式 insert（不做槽位排序，与引用账无关）。
            # 此前直接 continue 导致 flow@3 时代 used_skills 恒空、「未用技能」38 条全员误报。
            for inst in fl.get("modules", []) or []:
                if not isinstance(inst, dict):
                    continue
                spec = kits.get(inst.get("module"))
                if not spec:
                    E.append(f"[{fid}] kit 引用无效：{inst.get('module')!r}（flow@3 modules[].module）")
                    continue
                spine = set((spec.get("skeleton") or {}).get("spine", []))
                caps_wanted = set(inst.get("caps") or [])
                insert: set = set()
                for tools in (inst.get("insert") or {}).values():
                    insert.update(tools or [])
                for vary in (inst.get("vary") or {}).values():
                    for tools in (vary.get("insert") or {}).values():
                        insert.update(tools or [])
                for op_id, op_spec in spec.get("ops", {}).items():
                    if op_id not in spine and op_id not in insert \
                            and not (set(op_spec.get("capability") or []) & caps_wanted):
                        continue
                    s = op_spec.get("skill")
                    if s:
                        used_skills.add(s)
                        n_nodes += 1
            continue
        for nid, n in fl["graph"]["nodes"].items():
            s, kit, op = n.get("skill"), n.get("kit"), n.get("op")
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
    # N3 豁免账（批次3c R3）：三类口径显式豁免（表与裁决出处 = tools/lintlib.py），逐类回显，不是静默吞。
    # 豁免表自检：名单指向已不存在的技能 = 名单陈旧，显式点名（防豁免名单静默失效/静默扩权）。
    for s in sorted(SKILL_META_EXEMPT):
        if s not in have_skill:
            W.append(f"N3 豁免表陈旧：技能 {s} 不在 skills/——请清理 tools/lintlib.py SKILL_META_EXEMPT（豁免名单失效即删）")
    exempt_meta_skill: list = []
    for s in sorted(have_skill - set(skill_home)):
        if s in SKILL_META_EXEMPT:  # ② stage:meta/占位标注（T4：装配手册不绑模块是本性）
            exempt_meta_skill.append(s)
            continue
        W.append(f"孤儿技能（无模块归属，内核不会装载其标尺）: {s}")
    # 内核动词直调的技能不挂 flow 节点（如 orchestration-miner 由 flow_mine 组装派发）——豁免记账
    VERB_SKILLS = {"orchestration-miner"}
    for s in sorted(set(skill_home) - used_skills - VERB_SKILLS):
        if s in SKILL_META_EXEMPT:  # ② 留库备用/待拍板占位（T5 改编族、render-prompt-seedance、T6 改判）
            exempt_meta_skill.append(s)
            continue
        W.append(f"未用技能（有模块归属但无 flow 引用）: {s}")
    # ① 目录可达（id 互引闭包）＋ 域级变体（检索域）＋ ②草稿待审 ＋ ③人工链路：悬空知识四路豁免
    reach = reach_closure(op_kb, kb_card_edges())
    dom_wired = {i.split("/")[1] for i in op_kb if i.count("/") >= 2 and i.startswith("kb/")}
    exempt_reach, exempt_dom, exempt_draft, exempt_manual = [], [], [], []
    for kb in sorted(kb_index - op_kb - rule_ids):
        dom = kb.split("/")[1] if kb.count("/") >= 2 else ""
        if kb in reach:  # ① 目录可达：被有消费的卡正文 id 级互引覆盖（catalog 导航 + R8 激活）
            exempt_reach.append(kb)
        elif dom in KB_SEARCH_DOMAINS and dom in dom_wired:  # ①域级变体：域已接线、卡面按需检索（R1 口径）
            exempt_dom.append(kb)
        elif draft_card(kb):  # ② 草稿待审：转正前零执行面消费属设计（Q3 §2.2）
            exempt_draft.append(kb)
        elif any(kb.startswith(pfx) for pfx in CARD_MANUAL_EXEMPT):  # ③ 人工链路证据件
            exempt_manual.append(kb)
        else:
            W.append(f"悬空知识条目（无 op 引用）: {kb}")

    # ── v5.0 规则语料与扫描器台账（原「断言覆盖/声明空转」账本改挂此口径）────────
    # 口径唯一实现在 tools/lintlib.py：T/X 轨名单来自 rules-init.py，引擎实现面来自
    # aesthetic.ts 源码，规则卡来自 knowledge/rules/*.md 的 provenance.refs。
    # 三笔账：①C 轨必须进卡（语料不遗漏）；②T 轨必须有实现（退役 ≠ 把检查能力删掉，
    # 工单 §五 风险 2 的保险丝）；③卡不许引用已退役的 X 轨 id（红蓝残名回潮）。
    try:
        t_track, x_track = tracks()
        entries = ledger_entries()
        if not entries:
            W.append("规则语料账：退役台账读不到（projects/_archived/assertions-ledger-v5.0.0/assertions.json）"
                     "——C 轨覆盖度免检（显式回显，不静默）")
        else:
            ledger_ids = {a.get("name") for a in entries if isinstance(a, dict) and a.get("name")}
            c_track = ledger_ids - t_track - x_track
            card_refs = {}
            for cid, refs in cards.items():
                for r in refs:
                    card_refs.setdefault(r, []).append(cid)
            missing = sorted(c_track - set(card_refs))
            if missing:
                E.append(f"规则语料缺口：{len(missing)}/{len(c_track)} 条 C 轨条款未进任何规则卡（agent 无从激活）"
                         f"→ {', '.join(missing[:12])}")
            stray = sorted((set(card_refs) & t_track) | (set(card_refs) & x_track))
            if stray:
                W.append(f"规则卡引用了非 C 轨 id：{len(stray)} 条（T 轨=可数半边归扫描器，X 轨=已删除）"
                         f"→ {', '.join(stray[:10])}（双轨拆分须写明，不许把已删条款当语料喂回）")
            cov = scanner_coverage()
            gap = {a: DECLARED_GAPS.get(a, "未声明实现面") for a, impl in cov.items() if impl is None}
            if gap:
                W.append(f"扫描器台账缺口：T 轨 {len(gap)}/{len(cov)} 条声称工具化但无实现 → "
                         + ", ".join(f"{a}（{r}）" for a, r in sorted(gap.items())))
            wired = sum(1 for v in cov.values() if v)
            print(f"          ｜ v5.0 台账：规则卡 {len(cards)} 张 / C 轨 {len(c_track)} 条全覆盖 "
                  f"｜ T 轨扫描器 {wired}/{len(cov)} 有实现")
    except Exception as e:  # noqa: BLE001 - 台账读取失败必须显式回显，不许静默降级
        W.append(f"v5.0 规则语料/扫描器台账读取失败: {e}")

    # ── 批次2 R2.1：规则卡信封结构校验（rule-card@1）──────────────────────────
    # 口径：lint 是「契约在静态门的手工等价物」（contracts/README.md）——纯 stdlib 结构校验，
    # 不引 jsonschema。必填清单与值域以 contracts/rule.schema.json 为唯一事实源（本文件不抄
    # 第二份名单，同 _patch_kinds 的教训）。现状纪律：存量卡必须全绿（不得新增 error）；
    # 收敛字段（clauses/scanner_qids）批次2.4 才铺开，缺失只记账 WARN 不阻断。
    n_rule_cards, n_pending, n_spec_qids = 0, 0, 0
    try:
        rs = load(ROOT / "contracts" / "rule.schema.json")
        req_env = rs["required"]
        spec_qids = set()
        for rel in ("tools/laya-ft/questions.spec.json", "tools/laya-ft/style.questions.spec.json"):
            sp = ROOT / rel
            if sp.exists():
                spec_qids |= set(load(sp).get("questions", {}))
        n_spec_qids = len(spec_qids)
        for p in sorted((ROOT / "knowledge" / "rules").glob("*.md")):
            if p.name == "README.md":  # 索引页，不是规则卡
                continue
            n_rule_cards += 1
            rel = f"knowledge/rules/{p.name}"
            txt = p.read_text(encoding="utf-8")
            m = re.match(r"^---\r?\n(.*?)\r?\n---\r?\n", txt, re.S)
            if not m:
                E.append(f"{rel}: frontmatter 缺失（规则卡必须是 JSON frontmatter，rule-card@1 信封）")
                continue
            try:
                fm = json.loads(m.group(1))
            except Exception as ex:
                E.append(f"{rel}: frontmatter 不是合法 JSON（{ex}）")
                continue
            if not isinstance(fm, dict):
                E.append(f"{rel}: frontmatter 必须是 JSON 对象")
                continue
            miss = [k for k in req_env if k not in fm]
            if miss:
                E.append(f"{rel}: 缺信封必填字段 {miss}（契约 contracts/rule.schema.json）")
            if fm.get("type") != "rule-corpus":
                E.append(f"{rel}: type={fm.get('type')!r} 非法（须 rule-corpus）")
            if fm.get("status") not in ("active", "retired"):
                E.append(f"{rel}: status={fm.get('status')!r} 非法（∈ active|retired）")
            ah = fm.get("activation_hint")
            if ah is not None and (not isinstance(ah, list) or not ah
                                   or not all(isinstance(x, str) and x for x in ah)):
                E.append(f"{rel}: activation_hint 必须是非空字符串数组")
            prov = fm.get("provenance")
            if prov is not None and (not isinstance(prov, dict) or not prov.get("source")
                                     or not isinstance(prov.get("refs"), list)):
                E.append(f"{rel}: provenance 必须含 source + refs[]（来源账，铁律 6）")
            # 收敛字段：缺失记账（W10），写错值是契约违规（E）
            card_qids = fm.get("scanner_qids")
            clauses = fm.get("clauses")
            if not isinstance(card_qids, list) and not isinstance(clauses, list):
                n_pending += 1
            if card_qids is not None:
                if not isinstance(card_qids, list):
                    E.append(f"{rel}: scanner_qids 必须是数组")
                else:
                    for q in card_qids:
                        if not isinstance(q, str) or not re.match(
                                r"^[a-z]+\.[a-z0-9-]+\.v[0-9]+\.(noul|choice|score)$", q):
                            E.append(f"{rel}: scanner_qid 形状非法 {q!r}"
                                     f"（<family>.<slug>.v<N>.<noul|choice|score>）")
                        elif spec_qids and q not in spec_qids:
                            E.append(f"{rel}: scanner_qid 编造 {q!r}（不在 laya 两份 spec 的 questions 键里）")
            if clauses is not None:
                if not isinstance(clauses, list):
                    E.append(f"{rel}: clauses 必须是数组")
                else:
                    for i, c in enumerate(clauses):
                        if not isinstance(c, dict):
                            E.append(f"{rel}#clauses[{i}]: 必须是对象")
                            continue
                        cmiss = [k for k in ("rule_id", "tier", "severity") if k not in c]
                        if cmiss:
                            W.append(f"{rel}#clauses[{i}]: 缺 {cmiss}（批次2.4 收敛字段，暂 WARN）")
                        if "tier" in c and c["tier"] not in ("S", "A", "B"):
                            E.append(f"{rel}#clauses[{i}]: tier={c['tier']!r} 非法（∈ S|A|B）")
                        if "severity" in c and c["severity"] not in ("block", "major", "minor"):
                            E.append(f"{rel}#clauses[{i}]: severity={c['severity']!r} 非法"
                                     f"（∈ block|major|minor，去闸化后是优先级不是闸）")
        if n_pending:
            W.append(f"规则卡收敛字段（clauses/scanner_qids）待铺开：{n_pending}/{n_rule_cards} 张未带"
                     f"（批次2.4 写诊改三相打通时收敛，现状不阻断）")
    except Exception as e:  # noqa: BLE001 - 契约校验跑不成的显式回显
        W.append(f"规则卡契约校验未跑成（contracts/rule.schema.json 读取/解析失败）: {e}")

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
            # v5.0 反转守门：overlay 里再出现断言通道 = error（可调面只剩 config/knowledge/model_tier）
            for jp, key in sweep_retired(p):
                E.append(f"{rel}#{i}（{k}）{jp} 用了已退役字段「{key}」——断言协议 v5.0 下架，"
                         f"判定条款改 op.knowledge 规则卡，机器项走 scan_quality 证据")
            if not p.get("reason"):
                E.append(f"{rel}#{i}（{k}）: 缺 reason（编排改动必须可解释）")
            if origin == "optimizer" and p.get("status") in (None, "applied") and not p.get("evidence"):
                E.append(f"{rel}#{i}（{k}）: optimizer 的生效补丁必须带 evidence（指标依据）")

    # ── 出账 ─────────────────────────────────────────────────
    n_ops = sum(len(k["ops"]) for k in kits.values())
    n_cfg = sum(len(v) for v in op_configs.values())
    print(f"kit-lint ｜ {len(kits)} modules / {n_ops} ops ｜ {len(have_skill)} 技能 ｜ {n_nodes} agent 节点")
    print(f"          ｜ R5 内容配置项 {n_cfg} 个（{len(op_configs)} 个 op 已声明）"
          f" ｜ flow 显式覆盖 {len(node_cfg_used)} ｜ overlay {len(overlay_files)} 份 / {n_patch} 条补丁")
    print(f"          ｜ rule-card@1 信封校验 {n_rule_cards} 张规则卡 ｜ laya spec qid 对账源 {n_spec_qids} 条")
    # N3 豁免账回显（显式可审计：机制与名单 = tools/lintlib.py N3 节；逐类计数 + 目录可达逐条点名）
    n_exempt = (len(exempt_reach) + len(exempt_dom) + len(exempt_draft)
                + len(exempt_manual) + len(exempt_meta_skill))
    dom_detail = "、".join(
        f"{d}×{sum(1 for k in exempt_dom if k.split('/')[1] == d)}" for d in sorted(KB_SEARCH_DOMAINS))
    print(f"          ｜ N3 豁免账 {n_exempt} 条（显式豁免非静默吞）"
          f"：目录可达 {len(exempt_reach)}（{'、'.join(exempt_reach) if exempt_reach else '—'}）"
          f" ＋ 检索域 {len(exempt_dom)}（{dom_detail}）＋ 草稿待审 {len(exempt_draft)}"
          f" ＋ 人工链路 {len(exempt_manual)} ＋ meta/占位技能 {len(exempt_meta_skill)}"
          f"（{'、'.join(sorted(set(exempt_meta_skill))) or '—'}）")
    for x in E:
        print("ERROR", x)
    for x in W:
        print("WARN ", x)
    print(f"--- {len(E)} errors ｜ {len(W)} warnings")
    sys.exit(1 if E or (STRICT and W) else 0)


main()
