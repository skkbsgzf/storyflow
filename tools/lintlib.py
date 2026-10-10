"""lintlib · 三个守门人共用的核账原语（flow-lint / module-lint / kit-lint）

存在理由：同一口径在三处各写一遍 = 本仓反复被咬的「两套真相」。以下几件事跨工具同义，
唯一实现放这里，其余 lint 一律 import：
  1. `sweep_retired` —— v5.0 断言协议退役后的反转守门（出现即 error）；
  2. `tracks` —— T/X 轨名单（唯一事实源 = tools/rules-init.py 的分诊表）；
  3. `rule_cards` / `ledger_path` —— 规则语料卡与退役台账的读取（口径一处定义）；
  4. N3 豁免口径（批次3c R3）—— `SKILL_META_EXEMPT` / `KB_SEARCH_DOMAINS` /
     `CARD_MANUAL_EXEMPT` 三张显式豁免表 + `kb_card_edges`/`reach_closure` 目录可达闭包
     （kit-lint 与 kb-affinity 的悬空/孤儿账共用；表与理由见下方 N3 节注释）。
"""
import importlib.util
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# v5.0（工单 §三）：这些键已从契约白名单出账，任何 flow/module/overlay 里再出现即 error。
RETIRED_KEYS = {"asserts", "add_asserts", "remove_asserts"}


def sweep_retired(obj, where=""):
    """递归点名已退役字段，返回 [(json 路径, 键名)]。只认键名，不碰值（kind:"check" 合法）。"""
    hits = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            p = f"{where}.{k}"
            if k in RETIRED_KEYS:
                hits.append((p, k))
            hits.extend(sweep_retired(v, p))
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            hits.extend(sweep_retired(v, f"{where}[{i}]"))
    return hits


def _load_py(name, rel):
    spec = importlib.util.spec_from_file_location(name, ROOT / rel)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def tracks():
    """(T 轨扫描器 id, X 轨删除 id) —— 事实源 tools/rules-init.py，禁止在 lint 里抄名单。"""
    ri = _load_py("rules_init_for_lint", "tools/rules-init.py")
    return set(ri.TRACK_T), set(ri.TRACK_X)


# 引擎路由裁决（dim=meta）：随断言协议作废，但 aesthetic.ts 仍用它们做「非目标产物即跳过」的
# 结构性分流——它们不是质量扫描项，所以不进 T 轨台账核账。
ENGINE_META = {"AE-EXISTS", "AE-SKIP-NON-BEAT"}


def engine_scanner_ids():
    """core/src/aesthetic.ts 里真身实现的扫描器 id（`AE-X#子项` 归并为主 id）。

    注意子项名有小写（`AE-STRUCT-CAUSE#tailhook`）——字符类漏掉小写就会把已实装的
    条款误报成「无实现」（v5.0 批B 立账时踩过一次）。
    """
    src = (ROOT / "core" / "src" / "aesthetic.ts").read_text(encoding="utf-8")
    return {m.split("#")[0] for m in re.findall(r'"(AE-[A-Za-z0-9#\-]+)"', src)}


# prose-scan 层出数的 T 轨条款（可数半边在 tools/prose-scan.py 的配额层，不在 aesthetic.ts）。
# 记账口径：列在这里 = 已实装；没实装的不要塞进来（kit-lint 会点名「声称工具化但无实现」）。
PROSE_SCAN_SERVES = {"AE-AI-QUOTA": "明喻/破折号/文言壳/排比配额层"}


def scanner_coverage():
    """T 轨 → 实现面。返回 {id: 实现位置 | None}，None = 声称工具化但当前无实现（须 warn 记账）。"""
    t, _ = tracks()
    eng = engine_scanner_ids()
    out = {}
    for a in sorted(t):
        if a in eng:
            out[a] = "core/src/aesthetic.ts"
        elif a in PROSE_SCAN_SERVES:
            out[a] = f"tools/prose-scan.py（{PROSE_SCAN_SERVES[a]}）"
        else:
            out[a] = None
    return out


# 无实现者的 T 轨条款已知账（v5.0 批B 立账，补扫描器前不许假装验过）：
#   AE-NAT-HIT —— 24 类不自然词表命中：台账时代即无校验器（批C 销账未覆盖它），语义半边归 ai-trace 卡。
DECLARED_GAPS = {"AE-NAT-HIT": "词表命中未落扫描器；语义半边见 kb/rules/ai-trace"}


def ledger_path():
    """退役断言台账（v5.0 批B-3 归档只读）：先读新址，回退在库旧址。找不到返回 None。"""
    for rel in ("projects/_archived/assertions-ledger-v5.0.0/assertions.json",
                "knowledge/aesthetic/assertions.json"):
        p = ROOT / rel
        if p.exists():
            return p
    return None


def ledger_entries():
    """台账条目（[{"name","dim",...}]）；台账已归档时照常可读——它是规则卡的来源与去向账。"""
    p = ledger_path()
    if not p:
        return []
    try:
        d = json.loads(p.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001 - lint 读取失败由调用方回显
        return []
    return d.get("asserts") or d.get("assertions") or []


# ── N3 豁免口径（批次3c R3 落地；票源 = ROADMAP 批次3b N3，终版裁决状态见 T/N 终版表）──────────
# 三类豁免，全部显式可审计（本表即豁免清单，kit-lint / kb-affinity 运行时按类回显豁免账），
# 不是静默吞。豁免 ≠ 批准：每条带裁决出处；名单陈旧（指向已不存在的技能/域）由 kit-lint 点名。
#
#   ① 目录可达 —— 卡间 id 级互引覆盖：从「有消费的卡」正文提取 kb/<域>/<名> 引用做闭包
#      （reach_closure，不硬编码卡名单），被覆盖的卡不记「悬空/孤儿」。正当形态：structure
#      六母型卡经 kb/structure/catalog 正文导航 + R8 激活装载——Q2 实测 mention 图回归纯目录后，
#      id 级互引（137 笔）才是卡间导航真载体，静态「无 op 引用」≠ 检索/装载不可达。
#      域级变体（KB_SEARCH_DOMAINS 显式表）：域已接线（域内 ≥1 卡被 op 正面引用）、
#      卡面靠 kb_search/聚簇检索按需消费的域——glob 收窄后 benchmark/aesthetic 的「真孤儿」账
#      属设计形态（R1 2026-10-11 裁决口径，豁免归本票）。
#   ② 占位标注 —— stage:meta / 留库备用 / 草稿待审：技能带 stage:meta 或有明确裁决标注
#      （SKILL_META_EXEMPT 显式表）；卡 id 以 -draft 结尾（或 status=draft）＝草稿待审区，
#      转正前零执行面消费属设计（Q3 §2.2：knowledge/deconstruct/ 5 张草案；批次3d C×5
#      已转正迁出 aesthetic/craft 域，-draft 豁免随之清零，机制本身保留给未来草稿）。
#   ③ 人工链路证据件 —— 消费方是人工复查链路，零执行面消费属设计
#      （CARD_MANUAL_EXEMPT 显式表：semif-calibration 报告存批A 1 张，批D 四卷 2026-10-11
#      用户裁决删弃，laya 已裁暂不规划）。

# ② 占位标注 · 技能面：技能名 → 豁免理由（含裁决出处；T 编号见 ROADMAP T/N 终版表）
SKILL_META_EXEMPT: dict[str, str] = {
    "flow-synthesize": "stage:meta 装配手册，生成器未实现、skeleton-lint 人工装配链完整——T4「保留+记账」",
    "adapt-triage": "改编族四件套，无 flow 声明成簇——T5「记账维持（留库备用）/整链清退待裁」",
    "story-outline": "改编族四件套——T5 同上",
    "adapt-episode-map": "改编族四件套——T5 同上",
    "cold-open": "改编族四件套——T5 同上",
    "render-prompt-seedance": "图文视频「停留在提示词层」留库备用（用户 2026-10-11 已裁）",
    "topic-delivery-gate": "T6 改判「留库备用、不接线」（kit 纯粹化：交付对账属流程归宿主，2026-10-11 已判）",
}

# ① 目录可达 · 域级变体：域名 → 豁免理由。生效条件：该域内 ≥1 卡有 op 正面引用（域已接线），
#    否则豁免自动失效、悬空警告回归——防「整域失接」被本表吞掉。
KB_SEARCH_DOMAINS: dict[str, str] = {
    "benchmark": "generated 对标库 28 卡：glob 收窄后 24 卡无 op 直引，kb_search/聚簇检索按需消费是设计形态——R1 2026-10-11",
    "aesthetic": "消费最密域（12 op）+ kb_search 按需：glob 收窄后个别卡无 op 直引属设计形态——R1 2026-10-11",
}

# ③ 人工链路证据件：卡 id 前缀 → 豁免理由
CARD_MANUAL_EXEMPT: dict[str, str] = {
    "kb/semif-calibration/": "SemIf 校准报告存 1 张（批A；批D 四卷 2026-10-11 用户裁决删弃）：人工复查链路证据件，laya 已裁暂不规划，零执行面消费属设计——Q3 §三.3",
}

# 卡间 id 级互引 token（与 kb-affinity 的 KB_TOKEN 同口径：kb/<段>/<名> 或 glob；占位写法不匹配）
_KB_REF_RE = re.compile(r"kb/[A-Za-z0-9_\-\u4e00-\u9fff]+(?:/\*|/[A-Za-z0-9_\-\u4e00-\u9fff]+)")
_FRONT_BLOCK_RE = re.compile(r"\A---\s*\n(.*?)\n---\s*\n?", re.S)
_FRONT_ID_RE = re.compile(r'"id":\s*"([^"]+)"')


def draft_card(cid: str) -> bool:
    """② 草稿待审形状：id 以 -draft 结尾（草稿待审区家法；批次3d C×5 已转正迁出，
    deconstruct/ 草稿清零——机制保留给未来 land 流草稿）。"""
    return cid.endswith("-draft")


def kb_card_edges(root: Path = ROOT) -> dict[str, set[str]]:
    """knowledge/**/*.md（跳 README）→ {卡 id: 正文中引用的 kb id 集}。
    id 取 frontmatter "id" 优先，缺省路径派生（kb/<相对路径去 .md>，与 kb-affinity 盘扫同款）。
    只扫正文（frontmatter 之后）——provenance.refs 是出身账不是导航，与 rule_cards 的教训一致。"""
    edges: dict[str, set[str]] = {}
    kb_dir = root / "knowledge"
    if not kb_dir.is_dir():
        return edges
    for p in sorted(kb_dir.rglob("*.md")):
        if p.name.upper() == "README.MD":
            continue
        txt = p.read_text(encoding="utf-8")
        m = _FRONT_BLOCK_RE.match(txt)
        body = txt[m.end():] if m else txt
        cid = (_FRONT_ID_RE.search(m.group(1)).group(1) if m and _FRONT_ID_RE.search(m.group(1))
               else "kb/" + p.relative_to(kb_dir).as_posix().removesuffix(".md"))
        edges.setdefault(cid, set()).update(_KB_REF_RE.findall(body))
    return edges


def reach_closure(seeds, edges: dict[str, set[str]]) -> set:
    """① 目录可达：从 seeds（有消费的卡 id）出发的 id 互引闭包（BFS，不含 seeds 自身）。
    只沿 edges 里真实存在的卡走；确定性（sorted 迭代，同输入同输出）。"""
    seen: set = set()
    frontier = sorted(set(seeds) & set(edges))
    while frontier:
        nxt = []
        for c in frontier:
            for t in sorted(edges.get(c, ())):
                if t in edges and t not in seen and t not in seeds:
                    seen.add(t)
                    nxt.append(t)
        frontier = sorted(nxt)
    return seen


_CARD_ID_RE = re.compile(r'"id":\s*"(kb/rules/[a-z0-9-]+)"')
_REFS_RE = re.compile(r'"refs":\s*\[(.*?)\]', re.S)
_AE_RE = re.compile(r"AE-[A-Z0-9\-]+")


def rule_cards():
    """knowledge/rules/*.md → {卡 id: 卡头 provenance.refs 声明的来源 AE- 集合}。

    只读卡头 refs，不扫正文：正文里出现 `AE-DENSITY-WORDS` 这类 T 轨 id 是**条款互相引用**
    （「机器校验经 X 执行」），不是「把已退役条款当语料喂回」——按正文扫会天天假警。
    """
    out = {}
    for p in sorted((ROOT / "knowledge" / "rules").glob("*.md")):
        if p.name == "README.md":
            continue
        txt = p.read_text(encoding="utf-8")
        cid = _CARD_ID_RE.search(txt)
        refs = _REFS_RE.search(txt)
        out[cid.group(1) if cid else f"kb/rules/{p.stem}"] = (
            set(_AE_RE.findall(refs.group(1))) if refs else set()
        )
    return out
