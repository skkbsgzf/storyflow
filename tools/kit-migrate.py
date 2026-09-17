"""kit-migrate · 从 skills/ 与 flows/ 反推 kit@1 四域定义（可复跑审计的迁移工具）

用户拍板的四域：search 检索取数 / plot 剧情 / prose 文学 / tool 确定性底座。
单一事实源在此反向建立：技能 bind.knowledge ∪ 各 flow 节点的 kb（并集，避免任一侧漏载）
+ 节点 check（下游断言覆盖）→ kits/<domain>/kit.json。

用法：python tools/kit-migrate.py [--check]
  --check 只打印差异不写盘（CI 用）
"""
import json, re, sys, glob, os, collections
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WRITE = "--check" not in sys.argv

DOMAIN = {
    # search —— 检索取数：外部信息 → 结构化素材 / 方案
    "deconstruct-book": "search", "find-trope": "search", "material-dissect": "search",
    "topic-zeitgeist": "search", "topic-analysis-report": "search", "topic-proposal": "search",
    "topic-chief-aesthetic": "search", "topic-delivery-gate": "search", "internet-feel": "search",
    # plot —— 剧情：结构 / 大纲 / 分场 / 节拍（成文前锁定）
    "structure-design": "plot", "episodic-outline": "plot", "plot-choreographer": "plot",
    "scene-breakdown": "plot", "script-drama-beat": "plot", "novel-bible": "plot",
    "world-forge": "plot", "plot-redline": "plot",
    # prose —— 文学：层稿 / 成文 / 去AI味 / 评审
    "layer-voices": "prose", "layer-scenes": "prose", "layer-canon": "prose",
    "prose-assembler": "prose", "novel-deai": "prose", "novel-judge": "prose",
    "novel-chapter": "prose", "dialogue-polish": "prose", "script-final": "prose",
    "render-prompt-seedance": "prose",
}
REVIEW = {"plot-redline", "novel-judge"}  # 评审类：负载独立计量，裁决权默认人工

META = {
    "search": ("search kit", "检索取数域：市场盘面/梗库/素材/热点 → 结构化素材与选题方案"),
    "plot": ("plot kit", "剧情域：结构选型/大纲/分场/节拍——剧情在成文前锁定，成文层无权改戏"),
    "prose": ("prose kit", "文学域：层稿/成文/逐段盖章/去AI味/评审——文学质量内置在流水线"),
    "tool": ("tool kit", "确定性底座：零 LLM 的内核 minitool 与 tools/ 脚本，flow 底座共用"),
}


def frontmatter(p: Path) -> dict:
    t = p.read_text(encoding="utf-8")
    g = lambda pat, d="": (re.search(pat, t, re.M).group(1).strip() if re.search(pat, t, re.M) else d)
    kb, mt = [], []
    b = re.search(r"^bind:\s*\{(.*?)\}\s*$", t, re.M | re.S)
    if b:
        km = re.search(r"knowledge:\s*\[(.*?)\]", b.group(1), re.S)
        mm = re.search(r"minitools:\s*\[(.*?)\]", b.group(1), re.S)
        kb = re.findall(r'"([^"]+)"', km.group(1)) if km else []
        mt = re.findall(r'"([^"]+)"', mm.group(1)) if mm else []
    title = g(r"^name:\s*([^（(\n]+)")
    return {"desc": g(r"^description:\s*(.+)"), "tier": g(r"^model_tier:\s*(\S+)"),
            "title": title, "kb": kb, "minitools": mt}


def scan_flows() -> tuple:
    """节点引用反查：skill → kb 并集 / assist / 下游断言 / 使用次数。"""
    kb, assist, asserts, use = (collections.defaultdict(set), collections.defaultdict(set),
                                collections.defaultdict(set), collections.Counter())
    for f in sorted(glob.glob(str(ROOT / "flows" / "*" / "flow.json"))):
        fl = json.loads(Path(f).read_text(encoding="utf-8"))
        nodes, edges = fl["graph"]["nodes"], fl["graph"].get("edges", [])
        for nid, n in nodes.items():
            s = n.get("skill")
            if not s:
                continue
            use[s] += 1
            kb[s].update(n.get("kb") or [])
            assist[s].update(n.get("assist") or [])
            # 直接下游的 check_ 节点 → 本技能的产物断言
            for e in edges:
                if e.get("from") != nid:
                    continue
                down = nodes.get(e["to"], {})
                if down.get("kind") == "core" and str(down.get("minitool", "")).startswith("check_"):
                    asserts[s].update(down.get("check") or [])
    return kb, assist, asserts, use


def build_skill_kit(domain: str, skills: list, ctx: dict) -> dict:
    """反推 op。注意：flow 迁移后节点 kb 字段已删（信息已并入 kit），
    故与既有 kit.json 的 knowledge 取并集——重跑不会丢数据，kit.json 是权威。"""
    kbmap, asmap, armap = ctx["kb"], ctx["asserts"], ctx["assist"]
    prev = ROOT / "kits" / domain / "kit.json"
    existing = json.loads(prev.read_text(encoding="utf-8")).get("ops", {}) if prev.exists() else {}
    ops = {}
    for sid in sorted(skills):
        p = ROOT / "skills" / f"{sid}.md"
        if not p.exists():
            print(f"  !! 技能缺档: {sid}")
            continue
        fm = frontmatter(p)
        knowledge = sorted(set(fm["kb"]) | set(kbmap.get(sid, ())) | set(existing.get(sid, {}).get("knowledge", [])))
        op = {"skill": sid, "title": fm["title"] or sid, "desc": fm["desc"][:150]}
        if sid in REVIEW:
            op["kind"] = "review"
        if fm["tier"]:
            op["model_tier"] = fm["tier"]
        if knowledge:
            op["knowledge"] = knowledge
        if fm["minitools"]:
            op["minitools"] = fm["minitools"]
        merged_asserts = sorted(set(asmap.get(sid, ())) | set(existing.get(sid, {}).get("asserts", [])))
        if merged_asserts:
            op["asserts"] = merged_asserts
        if armap.get(sid):
            op["assist"] = sorted(armap[sid])
        ops[sid] = op
    name, desc = META[domain]
    return {"format": "kit@1", "id": domain, "domain": domain, "name": name,
            "desc": desc, "version": "0.1.0", "ops": ops}


def build_tool_kit() -> dict:
    reg = json.loads((ROOT / "tools" / "minitools.json").read_text(encoding="utf-8"))
    ops = {}
    for mid, m in reg["minitools"].items():
        op = {"title": m.get("name", mid), "minitools": [mid], "desc": m.get("desc", "")}
        if m.get("impl") == "planned":
            op["desc"] = "（planned，内核未实现，触达即 blocked）" + op["desc"]
        ops[mid] = op
    for p in sorted(glob.glob(str(ROOT / "tools" / "*.py"))):
        b = os.path.basename(p)
        if b in ("kit-migrate.py", "kit-lint.py"):
            continue
        try:
            head = Path(p).read_text(encoding="utf-8").split('"""')
            d = head[1].strip().splitlines()[0] if len(head) > 1 else ""
        except Exception:
            d = ""
        ops[b[:-3]] = {"script": f"tools/{b}", "title": b, "desc": d}
    return {"format": "kit@1", "id": "tool", "domain": "tool", "name": META["tool"][0],
            "desc": META["tool"][1], "version": "0.1.0", "ops": ops}


def main() -> None:
    if not DOMAIN:
        sys.exit("DOMAIN 表为空")
    kbmap, armap, asmap, use = scan_flows()
    known = {p.stem for p in (ROOT / "skills").glob("*.md")}
    unmapped = sorted(known - set(DOMAIN))
    ghost = sorted(set(DOMAIN) - known)
    if unmapped:
        print("!! 未归域技能（kit 会漏装）:", unmapped)
    if ghost:
        print("!! 归域表里的幽灵技能（无档案）:", ghost)

    kits = {d: build_skill_kit(d, [s for s, x in DOMAIN.items() if x == d], {"kb": kbmap, "asserts": asmap, "assist": armap})
            for d in ("search", "plot", "prose")}
    kits["tool"] = build_tool_kit()

    total_ops = sum(len(k["ops"]) for k in kits.values())
    for d, k in kits.items():
        n = len(k["ops"])
        nk = sum(len(o.get("knowledge", [])) for o in k["ops"].values())
        na = sum(len(o.get("asserts", [])) for o in k["ops"].values())
        print(f"  {d:8s} {n:3d} ops | 标尺条目 {nk:3d} | 覆盖断言 {na:3d}")
    print(f"  合计 {total_ops} ops ｜ 技能 {len(known)} ｜ 有流量的技能 {len(use)}")

    if not WRITE:
        print("(--check 模式：不写盘)")
        return
    for d, k in kits.items():
        out = ROOT / "kits" / d
        out.mkdir(parents=True, exist_ok=True)
        (out / "kit.json").write_text(json.dumps(k, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"  写出 kits/{d}/kit.json")


main()
