"""lintlib · 三个守门人共用的核账原语（flow-lint / module-lint / kit-lint）

存在理由：同一口径在三处各写一遍 = 本仓反复被咬的「两套真相」。以下三件事跨工具同义，
唯一实现放这里，其余 lint 一律 import：
  1. `sweep_retired` —— v5.0 断言协议退役后的反转守门（出现即 error）；
  2. `tracks` —— T/X 轨名单（唯一事实源 = tools/rules-init.py 的分诊表）；
  3. `rule_cards` / `ledger_path` —— 规则语料卡与退役台账的读取（口径一处定义）。
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
