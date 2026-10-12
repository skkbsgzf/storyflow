"""chronicle · 大事记归纳器（chronicle@1，零依赖）

大事记 = 叙事世界的 5W1H 时间线（工单-20261012 W4.6，用户 2026-10-12 定盘）。
扫描项目的人写真相源，编译为派生件 世界书/chronicle.json：
  format = chronicle@1
  bands    段带（时间线里的章节分带：故事前史/第一日/第一夜/…，含日期、章区间、Δ 说明）
  lanes    轨道（人物 lane + 势力 lane——视频编辑软件式的多轨，象征不同人/势力的行为与反馈）
  events   事件（when/where/who/what/why/how + 章 refs + Δ 矛盾 + 归属轨道 + 原文行号）
  stats    零丢弃账（各字段命中数、有卡无事件的人、近似定位数）

真相源（只读，工具绝不改写源文件）：
  世界书/时间线.md         # project-init 骨架自带（presets/skeletons/writing.json）
  世界书/编年/大事记.md     # 小说变体结算第 5 件的落位（knowledge/continuity/worldbook.md:74）
二者并存时按此序收，事件 source 各自标注。**不另立第二套人写账**——本产物是派生件，
重建即覆盖、工具独占写（立场同 tools/worldbook_history.py 的 worldbook-history@1）。

派生纪律（**不猜**是硬口径，与 AGENTS「kit 只给形，不猜你的内容」同构）：
  · when   只认时间字形的加粗标记（**16:50** / **约十二年前** / **凌晨1:00**）；无标记留空
  · where  卡面命中（设定.md「关键地点」条目与 地理/ 卡名）+ 行法命中（行首短语截到最短地点后缀）
  · who    卡面命中：人物.md 的 `### 名（…化名“X”…）` 与 人物/*.md 一人一卡（含 ／ 并列名与化名）
  · 轨道   人物 lane ∪ 势力 lane（设定.md「组织」条目与 势力/*.md）；一条事件可上多轨
  · why/how 只认行内声明位 `〔因：…〕` / `〔如何：…〕`（另可选 `〔何地：…〕` 直接声明处所）；
    缺省留空，看板详情显示「未登记」，绝不代填
  · 故事内时序定位由 约X年前/X月X日/HH:MM 近似折算（锚第一段带日期），stats.approxTime 记账
  · 解析不出的字段一律留空并进 stats，**禁止用叙述句硬填**

消费方：tools/dashboard.py 大事记区（多轨泳道 + 钻取抽屉）。本工具不回 call 内核，
内核也不消费本产物；页面侧只读内联数据。

用法：
  python tools/chronicle.py --root projects/<id>          # 重建 chronicle.json 并回显统计
  python tools/chronicle.py --root projects/<id> --quiet
  python tools/chronicle.py --print-payload --root <id>   # 只打印 payload（对账用）
  python tools/chronicle.py --selfcheck                   # 合成 fixture 全链自测
"""
import argparse
import json
import re
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WBDIR = "世界书"
# 真相源候选（存在即收，按此序）
SOURCE_CANDIDATES = (f"{WBDIR}/时间线.md", f"{WBDIR}/编年/大事记.md")
REQUIRED_TOP = ("format", "project", "sources", "bands", "lanes", "events", "stats", "narrative")

# ── 时间字形（when 判据：命中才算时间，其余加粗一律不当时间）──
RE_CLOCK = re.compile(r"^\d{1,2}[:：]\d{2}(?:[:：]\d{2})?$")
RE_REL = re.compile(r"^约?[〇一二三四五六七八九十百千万两半\d]+"
                    r"(?:分钟|小时|秒钟|秒|年|月|日|天|夜|周|春秋)(?:前|后|内|起|整)$")
RE_DATE = re.compile(r"^约?\d{1,2}月\d{1,2}(?:日|号)?(?:[-–—]\d{1,2}(?:月)?\d{1,2}日?)?$")
RE_HINT = re.compile(r"(凌晨|清晨|早晨|早上|上午|中午|下午|傍晚|黄昏|晚上|夜里|半夜|深夜|午夜|次日|翌日)")
RE_POINT = re.compile(r"\d{1,2}[点时]\d{0,2}分?$")
RE_NUM = re.compile(r"\d")
# 段带日期：6月24日 / 6月24日深夜-25日凌晨
RE_MD = re.compile(r"(\d{1,2})月(\d{1,2})日")
RE_HHMM = re.compile(r"(\d{1,2})[:：](\d{2})")
RE_CHAP = re.compile(r"第(\d+)(?:[-–—~](\d+))?章")
RE_DRIFT = re.compile(r"[（(]([^（）()]*Δ[^（）()]*)[）)]")
RE_MARK = re.compile(r"〔(因|如何|何地)：([^〔〕]{1,60})〕")

# 相对量 → 天（故事内时序近似折算；年月按定长近似，只用于排序不用于展示）
REL_DAYS = {"分钟": 1 / 1440.0, "小时": 1 / 24.0, "秒钟": 1 / 86400.0, "秒": 1 / 86400.0,
            "天": 1.0, "日": 1.0, "夜": 1.0, "周": 7.0, "月": 30.0, "年": 365.0, "春秋": 365.0}
CN_NUM = {"〇": 0, "一": 1, "二": 2, "两": 2, "三": 3, "四": 4, "五": 5, "六": 6,
          "七": 7, "八": 8, "九": 9, "十": 10, "半": 0.5, "千": 1000, "万": 10000}

PLACE_SUFFIX = ("大楼", "栋", "街", "巷", "馆", "广场", "车站", "站", "厅", "室", "堂", "苑",
                "公寓", "学校", "中学", "大学", "影院", "剧院", "天台", "电梯", "仓库",
                "工厂", "电子厂", "厂房", "商场", "分部", "办公室", "厕所", "隔间", "教室",
                "甬道", "子屋", "丑屋", "废墟", "灵堂", "城堡", "码头", "店")
HEAD_CUT = r"[：:。；，,、（）()【】《》「」“”·…—\-\s]"
HEAD_MAX = 6          # 行法地点只认 ≤6 字的紧名词，长出来就是叙述不是地名
LANE_SKIP_SUFFIX = ("相关", "其他", "杂项", "禁令", "条例", "须知", "公告")


def num_cn(token: str) -> float:
    """中文/阿拉伯数字片段 → 数值（位/十/百/千/万 常见读法，解析失败返回 None）。"""
    token = token.strip()
    if token.isdigit():
        return float(token)
    total, cur = 0.0, 0.0
    for ch in token:
        if ch == "十":
            cur = (cur or 1) * 10
        elif ch in ("百", "千"):
            cur = (cur or 1) * {"百": 100, "千": 1000}[ch]
        elif ch == "万":
            total += (cur or 1) * 10000
            cur = 0
        else:
            v = CN_NUM.get(ch)
            if v is None:
                return None
            cur += v
    total += cur
    return total if total > 0 else None


def looks_like_time(raw: str) -> bool:
    """加粗/冒号前短语是否是时间表述——判据收窄，宁缺毋滥。"""
    s = (raw or "").strip().strip("*＿_ 　:：·—-、，,「」“”\"'()（）【】[]")
    if not s or len(s) > 18:
        return False
    if RE_CLOCK.match(s) or RE_REL.match(s) or RE_DATE.match(s):
        return True
    if RE_HINT.search(s) and RE_NUM.search(s):
        return True
    if RE_POINT.search(s):
        return True
    return False


def rel_to_days(raw: str):
    """约十二年前 → -4380.0；绝对日期（约6月17日）不当相对量（交 abs_md 走日历定位）。"""
    if RE_DATE.match((raw or "").strip()):
        return None
    m = re.match(r"^约?([〇一二三四五六七八九十百千万两半\d]+)(分钟|小时|秒钟|秒|年|月|日|天|夜|周|春秋)(?:前|后|内|起|整)?", raw)
    if not m:
        return None
    n = num_cn(m.group(1))
    if n is None:
        return None
    d = n * REL_DAYS[m.group(2)]
    return -d if "前" in raw or raw.endswith("前") else d


def abs_md(raw: str):
    """`6月17日` / `约6月17日` → (6, 17)；否则 None。（只取首个日期，区间另说）"""
    m = re.search(r"(\d{1,2})月(\d{1,2})日?", raw or "")
    return (int(m.group(1)), int(m.group(2))) if m else None


PM_WORDS = ("下午", "傍晚", "晚上", "夜里", "半夜", "深夜", "午夜")


def clock_of(raw: str):
    """钟表时刻 → (分钟数或 None, 是否做了 12 小时平移)。平移属近似，调用方记 approxTime。"""
    m = RE_HHMM.search(raw or "")
    if m:
        return int(m.group(1)) * 60 + int(m.group(2)), False
    m = re.search(r"(\d{1,2})[点时](\d{1,2})?分?", raw or "")
    if not m:
        return None, False
    h, mi = int(m.group(1)), int(m.group(2) or 0)
    shifted = any(w in (raw or "") for w in PM_WORDS) and h < 12
    return (h + 12 if shifted else h) * 60 + mi, shifted


# ── frontmatter 双形态（JSON-in-fence 优先，回落 YAML 子集）──
_SIBLING_CACHE = {}


def load_sibling(filename: str):
    """按路径加载 tools/ 下兄弟脚本（命名带 - 无法 import）。"""
    cache = _SIBLING_CACHE
    if filename not in cache:
        import importlib.util
        path = ROOT / "tools" / filename
        spec = importlib.util.spec_from_file_location(path.stem.replace("-", "_"), path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        cache[filename] = mod
    return cache[filename]


def parse_frontmatter(text: str):
    body = text
    if text.startswith("---"):
        m = re.match(r"^---\r?\n(.*?)\r?\n---\r?\n?", text, re.S)
        if m:
            body = text[m.end():]
            raw = m.group(1).strip()
            try:
                fm = json.loads(raw)
                if isinstance(fm, dict):
                    return fm, body
            except Exception:
                pass
            wi = load_sibling("worldbook_index.py")
            try:
                yfm, _ = wi.parse_frontmatter(text)
                return (yfm or {}), body
            except Exception:
                return {}, body
    return {}, body


# ── 卡面词表（人物 / 势力 / 地点）：姓名与化名的来源 ──
def split_names(base: str):
    """`程羽笑／三妹／魇` → ['程羽笑','三妹','魇']；`界／纯白空间／十二房间` 同理。"""
    parts = [p.strip() for p in re.split(r"[／/、｜|]", base) if p.strip()]
    out = []
    for p in parts:
        if len(p) < 2 or p.endswith(LANE_SKIP_SUFFIX):
            continue
        out.append(p)
    return out


def aliases_from_paren(paren: str):
    """括号说明里的化名：`化名“白小姐”` / `本名「阿瑶」` / （黑雾态首现…）。"""
    out = []
    for m in re.finditer(r"(?:化名|本名又名|又名|俗称|代号)[为是]?\s*[「“\"']([^」”\"']+)[」”\"']", paren or ""):
        a = m.group(1).strip()
        if 2 <= len(a) <= 8:
            out.append(a)
    return out


def card_head_names(md: str, level: str = "###"):
    """`### 柯秒（主角，首现第1章）` → [{name, aliases}]。"""
    out = []
    for line in md.splitlines():
        if not line.startswith(level + " "):
            continue
        text = line[len(level) + 1:].strip()
        base, _, rest = text.partition("（")
        paren = rest if rest else ""
        names = split_names(base.strip())
        if not names:
            continue
        aliases = aliases_from_paren(paren)
        for n in names[1:]:
            aliases.append(n)
        out.append({"name": names[0], "aliases": aliases})
    return out


def quoted_aliases(text: str):
    out = []
    for m in re.finditer(r"[「“]([^」”]{2,10})[」”]", text or ""):
        out.append(m.group(1).strip())
    return out


def bullet_bold_names(md: str, section: str):
    """`## 组织` / `## 关键地点` 段内的 `**名字**（…）` 条目 → [{name, aliases}]。

    加粗里可能自带全角括号（`**岑溪中学（岑中）**`）：名取括号前主体，
    括号内只认两类化名——引号里的（「巴比特工会」）、以及 ≤3 字的短别名（岑中）；
    「游戏公司」这类四字说明一律不入别名，避免说明词抢命中。"""
    out, hit = [], False
    for line in md.splitlines():
        if line.startswith("## "):
            hit = section in line
            continue
        if not hit or not line.startswith("- **"):
            continue
        m = re.match(r"^- \*\*([^*]+?)\*\*(.*)$", line)
        if not m:
            continue
        raw = m.group(1).strip()
        base, _, paren = raw.partition("（")
        seg = m.group(2).split("：", 1)[0].split("。", 1)[0][:40]
        paren = (paren.rstrip("）") + " " + seg).strip()
        names = split_names(base.strip())
        if not names:
            continue
        aliases = quoted_aliases(paren)
        for tok in re.split(r"[，,、；;（）()]", paren):
            tok = tok.strip()
            if 2 <= len(tok) <= 3 and not RE_NUM.search(tok) and "名" not in tok:
                aliases.append(tok)
        out.append({"name": names[0], "aliases": sorted(set(aliases))})
    return out


def collect_lanes(proj: Path):
    """人物/势力/地点候选：卡面文件优先，平铺总卡（人物.md / 设定.md）兜住现形项目。"""
    people, factions, places = [], [], []

    def add(bucket, name, aliases, src):
        name = (name or "").strip()
        if len(name) < 2 or name.endswith(LANE_SKIP_SUFFIX):
            return
        for rec in bucket:
            if rec["name"] == name:
                rec["aliases"] = sorted(set(rec["aliases"]) | set(aliases))
                return
        bucket.append({"name": name, "aliases": sorted(set(aliases)), "source": src})

    pdir = proj / WBDIR / "人物"
    if pdir.is_dir():
        for p in sorted(pdir.glob("*.md")):
            if p.name.upper() == "README.MD":
                continue
            fm, _ = parse_frontmatter(p.read_text(encoding="utf-8"))
            add(people, fm.get("title") or p.stem, [], f"{WBDIR}/人物/{p.name}")
    fdir = proj / WBDIR / "势力"
    if fdir.is_dir():
        for p in sorted(fdir.glob("*.md")):
            if p.name.upper() == "README.MD":
                continue
            fm, _ = parse_frontmatter(p.read_text(encoding="utf-8"))
            add(factions, fm.get("title") or p.stem, [], f"{WBDIR}/势力/{p.name}")
    gdir = proj / WBDIR / "地理"
    if gdir.is_dir():
        for p in sorted(gdir.glob("*.md")):
            if p.name.upper() == "README.MD":
                continue
            fm, _ = parse_frontmatter(p.read_text(encoding="utf-8"))
            add(places, fm.get("title") or p.stem, [], f"{WBDIR}/地理/{p.name}")

    pc = proj / WBDIR / "人物.md"
    if pc.is_dir() is False and pc.exists():
        for rec in card_head_names(pc.read_text(encoding="utf-8")):
            add(people, rec["name"], rec["aliases"], f"{WBDIR}/人物.md")
    sc = proj / WBDIR / "设定.md"
    if sc.exists():
        text = sc.read_text(encoding="utf-8")
        for rec in bullet_bold_names(text, "组织"):
            add(factions, rec["name"], rec["aliases"], f"{WBDIR}/设定.md#组织")
        for rec in bullet_bold_names(text, "关键地点"):
            add(places, rec["name"], rec["aliases"], f"{WBDIR}/设定.md#关键地点")
    return people, factions, places


def matcher(cards):
    """卡名+化名 → [(词, 卡名)]，长词优先（先命中全称，避免简称抢占）。"""
    pairs = []
    for c in cards:
        for w in [c["name"]] + list(c["aliases"]):
            if len(w) >= 2:
                pairs.append((w, c["name"]))
    pairs.sort(key=lambda p: (-len(p[0]), p[0]))
    return pairs


def hits(text: str, pairs):
    out = []
    for w, owner in pairs:
        if w in text and owner not in out:
            out.append(owner)
    return out


# ── 段带与事件解析 ──
def parse_band_heading(line: str, idx: int):
    text = line[3:].strip()
    name, sep, tail = text.partition(" · ")
    if not sep:
        name, sep, tail = text.partition("（")
        tail = tail.rstrip("）") if sep else ""
    name = name.strip()
    chap = None
    for m in RE_CHAP.finditer(text):
        chap = {"from": int(m.group(1)), "to": int(m.group(2) or m.group(1))}
        break
    md = RE_MD.search(tail)
    date = f"{md.group(1)}月{md.group(2)}日" if md else ""
    note, drift = "", ""
    mn = re.search(r"※(.*)$", tail)
    if mn:
        note = mn.group(1).strip()
    tail = tail.split("※")[0].strip()          # sub 只留「日期/地点（章区间）」，※ 说明另存 note
    dm = RE_DRIFT.search(text)
    if dm:
        drift = dm.group(1).strip()
    layer = "prehistory" if ("前史" in name or "倒叙" in text) else "story"
    return {"id": f"b{idx}", "name": name, "sub": tail.strip(), "layer": layer,
            "date": date, "chapters": chap, "note": note, "drift": drift}


def lead_time(text: str):
    """行首时间标记：`**16:50** 正文` / `**约十二年前**：正文` / 正文里首个时间形加粗；
    再兜一层裸钟表时刻（`16:50` / `凌晨3点`）——只认字形，不作推断。"""
    m = re.match(r"^\*\*(.+?)\*\*[：: ]*", text)
    if m and looks_like_time(m.group(1)):
        return m.group(1).strip(), text[m.end():], "bold-head"
    for bm in re.finditer(r"\*\*(.+?)\*\*", text):
        if looks_like_time(bm.group(1)):
            return bm.group(1).strip(), text, "bold-inline"
    cm = re.search(r"\d{1,2}[:：]\d{2}(?!\d)"
                   r"|(?:凌晨|清晨|早上|上午|中午|下午|傍晚|黄昏|晚上|夜里|半夜|深夜|午夜)\s*\d{1,2}[点时:：]", text)
    if cm:
        tail = text[cm.end():].lstrip("，,、 ：:") if cm.start() == 0 else text
        return cm.group(0).strip(), tail, "bare-clock"
    return "", text, ""


def lead_place(text: str, place_pairs):
    """行法地点：行首短语（截到分隔符前）若是已知地点卡的开头、或以地点后缀收尾且 ≤6 字 → 取之。

    `幻影科技大楼A栋403` → `幻影科技大楼`；`工会三人组登场` / `肉山二阶段` / `第十三轮推开厕所`
    一律不出 where——长出来的部分是叙述不是地名（不猜口径）。"""
    head = re.sub(r"\*\*.*?\*\*", "", text).strip()
    head = re.split(HEAD_CUT, head, 1)[0].strip()
    if not head or len(head) > 12:
        return ""
    for w, _ in place_pairs:
        if head.startswith(w):
            return w
    for i in range(2, min(HEAD_MAX, len(head)) + 1):
        seg = head[:i]
        if any(seg.endswith(s) for s in PLACE_SUFFIX):
            return seg
    return ""


def build_events(path: Path, proj: Path, people_p, faction_p, place_p):
    """一份真相源 md → (段带, 事件)。bullet 与其续行/子条合成一条事件（零丢弃）。"""
    text = path.read_text(encoding="utf-8")
    fm, _body = parse_frontmatter(text)
    rel = path.relative_to(proj).as_posix().replace("\\", "/")
    lines = text.splitlines()
    bands, items, band = [], [], None
    bi = 0
    for ln, raw in enumerate(lines, start=1):
        line = raw.rstrip()
        if line.startswith("## "):
            bi += 1
            band = parse_band_heading(line, bi)
            band.update({"file": rel, "line": ln})
            bands.append(band)
            continue
        if line.startswith("- ") and band is not None:
            items.append([band, ln, line[2:].strip()])
            continue
        if items and re.match(r"^\s+-\s", line):        # 子条：并入上一事件正文（不另立事件）
            items[-1][2] += " " + line.strip()[1:].strip()
        elif items and re.match(r"^\s{2,}\S", line):    # 续行：同上
            items[-1][2] += " " + line.strip()
    events = []
    for seq, (band, ln, item) in enumerate(items, start=1):
        when_raw, rest, when_via = lead_time(item)
        clock, shifted = clock_of(when_raw)
        who = hits(item, people_p)
        fac = hits(item, faction_p)
        drift = "；".join(m.group(1).strip() for m in RE_DRIFT.finditer(item))
        marks = {}
        for k, v in RE_MARK.findall(item):
            marks.setdefault(k, []).append(v.strip())
        why = "；".join(marks.get("因", []))
        how = "；".join(marks.get("如何", []))
        declared = marks.get("何地", [])
        plc_card = hits(item, place_p)
        plc = list(declared) + list(plc_card)
        lp = lead_place(rest, place_p)
        if lp:
            plc.append(lp)
        # 去重与去包含冗余：同值只留一个；短名若被更长的行法短语包含，只留长者
        plc = list(dict.fromkeys(plc))
        plc = [x for x in plc if not any(y != x and x in y for y in plc)]
        refs = [{"from": int(m.group(1)), "to": int(m.group(2) or m.group(1))}
                for m in RE_CHAP.finditer(item)]
        what = re.sub(r"〔(?:因|如何|何地)：[^〔〕]*〕", "", rest).strip()
        what = re.sub(r"\*\*(.+?)\*\*", r"\1", what).strip(" ：:、-—")
        ev = {
            "id": f"e{seq:03d}",
            "seq": seq,
            "band": band["id"],
            "layer": band["layer"],
            "file": rel,
            "line": ln,
            "when": {"raw": when_raw, "clock": clock,
                     "days": rel_to_days(when_raw), "abs": list(abs_md(when_raw) or ()),
                     "via": when_via,
                     "approx": bool(when_raw) and (RE_REL.match(when_raw) is not None
                                                   or shifted or when_raw.startswith("约"))},
            "where": plc,
            "whereCards": plc_card,
            "who": who,
            "faction": fac,
            "what": what,
            "why": why,
            "how": how,
            "refs": refs,
            "drift": drift,
            "body": item,
        }
        ev["tracks"] = who + fac
        events.append(ev)
    # 无 ## 分带时整篇算一带（骨架模板只有一句说明的项目也出板）
    if not bands:
        bands = [{"id": "b1", "name": fm.get("title") or path.stem, "sub": "",
                  "layer": "story", "date": "", "chapters": None, "note": "",
                  "file": rel, "line": 1}]
        for e in events:
            e["band"] = "b1"
    return bands, events, fm


def story_key(ev, band_days):
    """故事内时序排序键：绝对日期直接落日历；相对量叠在段基准日上；再按钟表时刻、文件序。
    （键只做排序展示，全部近似值由 stats.approxTime 记账，不冒充作者断言。）"""
    w = ev["when"]
    if w.get("abs"):
        d = w["abs"][0] * 31 + w["abs"][1]
    else:
        d = band_days.get(ev["band"], 0.0)
        if w["days"] is not None:
            d = d + w["days"]
    return (d, w["clock"] if w["clock"] is not None else -1, ev["seq"])


def assign_band_days(bands, events):
    """段带基准日（天）：锚第一个可解析日期的段带；解析不出的沿用前带 +1（近似）。"""
    days, prev = {}, None
    for b in bands:
        m = re.search(r"(\d{1,2})月(\d{1,2})日", b.get("date") or "")
        if m:
            v = (int(m.group(1)) * 31 + int(m.group(2)))  # 年内单调即可，只用于排序
            prev = v
        elif prev is not None:
            prev = prev + 1
        days[b["id"]] = prev if prev is not None else float(b["id"][1:])
    # 前史段：其事件自带相对量（约X年前），基准日取首个 story 段基准日
    story = [d for b, d in days.items() if b not in ("",) and not _pre(b, bands)]
    anchor = min(story) if story else 0.0
    for b in bands:
        if _pre(b["id"], bands):
            days[b["id"]] = anchor
    return days


def _pre(bid, bands):
    for b in bands:
        if b["id"] == bid:
            return b["layer"] == "prehistory"
    return False


def build_payload(proj: Path, project: str) -> dict:
    people, factions, places = collect_lanes(proj)
    people_p, faction_p, place_p = matcher(people), matcher(factions), matcher(places)
    all_bands, all_events, sources = [], [], []
    for rel in SOURCE_CANDIDATES:
        p = proj / rel
        if not p.exists():
            continue
        bands, events, fm = build_events(p, proj, people_p, faction_p, place_p)
        base = len(all_bands)
        ren = {}
        for b in bands:
            nid = f"b{base + bands.index(b) + 1}"
            ren[b["id"]] = nid
            b["id"] = nid
            all_bands.append(b)
        for e in events:
            e["band"] = ren.get(e["band"], e["band"])
            e["id"] = f"e{len(all_events) + 1:03d}"
            e["seq"] = len(all_events) + 1
            all_events.append(e)
        note = ""
        m = re.search(r"^>\s*(.+)$", p.read_text(encoding="utf-8"), re.M)
        if m:
            note = m.group(1).strip()
        sources.append({"file": rel, "title": fm.get("title") or p.stem,
                        "id": fm.get("id") or "", "note": note,
                        "events": len(events), "bands": len(bands)})
    band_days = assign_band_days(all_bands, all_events)
    for e in all_events:
        e["storyKey"] = story_key(e, band_days)
    order_by_band = {}
    for e in all_events:
        order_by_band.setdefault(e["band"], []).append(e["storyKey"])
    # 段带排序键（供「按故事内时序」分带）
    band_key = {bid: [min(v)[0], min(v)[1]] for bid, v in order_by_band.items()}
    for b in all_bands:
        b["storySort"] = band_key.get(b["id"], [float(b["id"][1:]), 0])

    # lane 账：泳道=人物轨 ∪ 势力轨（工单 W4.6 口径：象征不同人/势力的行为与反馈）；
    # 地点不入轨（只进事件 where），避免泳道被场景名淹没。只保留有命中的轨道。
    lane_defs = [("person", people), ("faction", factions)]
    lanes = []
    for kind, cards in lane_defs:
        for c in cards:
            n = sum(1 for e in all_events if c["name"] in (e["who"] if kind == "person"
                      else e["faction"]))
            if n:
                lanes.append({"id": f"{kind[0]}-{c['name']}", "name": c["name"],
                              "kind": kind, "aliases": c["aliases"],
                              "source": c["source"], "events": n})
    lanes.sort(key=lambda l: (-l["events"], l["kind"], l["name"]))
    covered = {l["name"] for l in lanes if l["kind"] == "person"}
    stats = {
        "events": len(all_events),
        "bands": len(all_bands),
        "lanes": len(lanes),
        "laneKinds": {k: sum(1 for l in lanes if l["kind"] == k) for k in ("person", "faction")},
        "withTime": sum(1 for e in all_events if e["when"]["raw"]),
        "withPlace": sum(1 for e in all_events if e["where"]),
        "withWho": sum(1 for e in all_events if e["who"]),
        "withFaction": sum(1 for e in all_events if e["faction"]),
        "withRefs": sum(1 for e in all_events if e["refs"]),
        "withDrift": sum(1 for e in all_events if e["drift"]),
        "withWhy": sum(1 for e in all_events if e["why"]),
        "withHow": sum(1 for e in all_events if e["how"]),
        "approxTime": sum(1 for e in all_events if e["when"]["approx"]),
        "uncoveredPeople": sorted({c["name"] for c in people} - covered),
        "chapterSpan": None,
    }
    chs = [r["from"] for e in all_events for r in e["refs"]]
    cht = [r["to"] for e in all_events for r in e["refs"]]
    if chs:
        stats["chapterSpan"] = {"from": min(chs), "to": max(cht)}
    payload = {
        "format": "chronicle@1",
        "project": project,
        "sources": sources,
        "bands": all_bands,
        "lanes": lanes,
        "events": [{**e, "storyKey": [e["storyKey"][0], e["storyKey"][1], e["storyKey"][2]]}
                   for e in all_events],
        "stats": stats,
    }
    return attach_narrative(payload)


def check_shape(payload: dict):
    errs = []
    for k in REQUIRED_TOP:
        if k not in payload:
            errs.append(f"顶层缺键 {k}")
    if payload.get("format") != "chronicle@1":
        errs.append(f"format 非 chronicle@1：{payload.get('format')}")
    for e in payload.get("events", []):
        for k in ("id", "band", "file", "line", "when", "who", "tracks", "body"):
            if k not in e:
                errs.append(f"事件缺键 {k}：{e.get('id')}")
                break
        beats = e.get("narr")
        if not isinstance(beats, list) or [b.get("k") for b in beats] != [k for k, _ in NARR_BEATS]:
            errs.append(f"事件叙述缺 STAR 四拍或顺序错：{e.get('id')}")
        elif any(not (b.get("text") or "").strip() for b in beats):
            errs.append(f"叙述有空句（人读的页面不许留白）：{e.get('id')}")
        if not isinstance(e.get("gap"), list):
            errs.append(f"事件缺 gap 清单：{e.get('id')}")
    for b in payload.get("bands", []):
        if not (b.get("intro") or "").strip():
            errs.append(f"段带缺导语：{b.get('id')}")
    for l in payload.get("lanes", []):
        if not (l.get("arc") or "").strip():
            errs.append(f"轨道缺串讲：{l.get('id')}")
    for l in payload.get("lanes", []):
        if not l.get("name") or not l.get("kind"):
            errs.append(f"轨道缺 name/kind：{l}")
    nar = payload.get("narrative") or {}
    if not (nar.get("lead") or "").strip():
        errs.append("缺全篇开场白 narrative.lead")
    return errs


def validate_contract(payload: dict):
    """拿同一份 contracts/chronicle-event.schema.json 校验（不另写第二套真相）。"""
    lite = load_sibling("jsonschema_lite.py")
    schema = lite.load_schema("contracts/chronicle-event.schema.json")
    return lite.validate(payload, schema)


def render_json(proj: Path, project: str):
    payload = build_payload(proj, project)
    errs = check_shape(payload)
    if errs:
        raise SystemExit("[ABORT] chronicle 形状校验失败：" + "；".join(errs[:8]))
    bad = validate_contract(payload)
    if bad:
        raise SystemExit("[ABORT] chronicle@1 契约校验失败：" + "；".join(bad[:8]))
    return payload


# ── 叙述层（STAR，给人读的）─────────────────────────────────────────────
# 口径（2026-10-12 用户定盘）：大事记与时间线都是人读的，要满足 STAR、娓娓道来、有故事感。
# 但「不猜」红线不让步——叙述层只做三件事：①把已登记的字段串成中文句子；②作者原文
# （what/why/how/drift）逐字进句，只补句末标点；③缺项直说「源里没写」，绝不代填、绝不
# 由相邻事件推因果。所以这里的每一句话都能指回某个字段或某行原文，机器可复核。
# 文风硬口径（同用户成稿纪律）：不用破折号，不用「不是…而是」翻案句，不用模型腔套话，
# 引号只用中文引号，句子短、一拍一句。STYLE_BAD 是机器闸，--selfcheck 逐条扫。
NARR_BEATS = (("s", "情境"), ("t", "起因"), ("a", "经过"), ("r", "落点"))
STYLE_BAD = re.compile(r"——|不是[^。！？]{0,14}而是|值得注意|值得一提|综上所述|总而言之|"
                       r"赋能|闭环|抓手|颗粒度|深入(?:探讨|剖析)|在一定程度上")
CN_COUNT = {1: "一", 2: "两", 3: "三", 4: "四", 5: "五", 6: "六", 7: "七", 8: "八",
            9: "九", 10: "十"}


def cn_n(n: int) -> str:
    return CN_COUNT.get(n, str(n))


def names_phrase(names, limit: int = 3, unit: str = "人") -> str:
    """['柯秒','白灼'] → 「柯秒、白灼两人」；超过 limit 个只列前几个再报总数。"""
    n = len(names or [])
    if n == 0:
        return ""
    if n == 1:
        return names[0]
    if n <= limit:
        return "、".join(names) + cn_n(n) + unit
    return "、".join(names[:limit]) + "等" + str(n) + unit


def end_sentence(text: str) -> str:
    """作者原文进叙述时只补句末标点（不改一字）。"""
    t = (text or "").strip()
    if not t:
        return ""
    return t if t[-1] in "。！？…”」』" else t + "。"


def style_scan(text: str, exempt=()) -> str:
    """文风闸：把作者原文摘掉再扫工具自己写的部分，命中返回该词（空串＝干净）。"""
    t = text or ""
    for x in exempt:
        if x:
            t = t.replace(x, "")
    m = STYLE_BAD.search(t)
    return m.group(0) if m else ""


def refs_phrase(refs) -> str:
    """[{from:12,to:13}] → 「第12到13章」；多条 → 「第4章、第33章」。"""
    out = []
    for r in refs or []:
        f, t = r.get("from"), r.get("to")
        if f is None:
            continue
        out.append(f"第{f}章" if (t is None or t == f) else f"第{f}到{t}章")
    return "、".join(out)


def label_of(ev) -> str:
    """一条事件的短标签（叙述里引用邻拍用）。优先取正文首个实义短语，章号只当兜底——
    邻拍报章号会读成「下一拍是第33章」这种没头没尾的句子。四道清洗：
    ① 括注与场景标（（实为402）/【天堂影院】）整组摘掉，它们是补充说明不是事件名；
    ② 摘完可能剩下前导标点（「：柯秒纯白之梦」），一并 lstrip；
    ③ 行首是处所（「幻影科技大楼A栋403：假面试」）时跳到下一段，地名当标签读不出事件；
    ④ 段太短（<2 字）跳过。引号不当切分点（「喂养」是事件名的一部分），但截断时不留半截引号。
    全部落空才退回原文前 16 字。"""
    w = (ev.get("what") or "").strip()
    if w:
        src = re.sub(r"（[^（）]*）|\([^()]*\)|【[^【】]*】", "", w).strip()
        src = src.lstrip("：:、，,；;·—-－【】（）() 　*")
        where = ev.get("where") or []
        for seg in re.split(r"[，。；：、（(【】]", src):
            seg = seg.strip()
            if len(seg) < 2:
                continue
            if any(seg.startswith(x) or x.startswith(seg) for x in where):
                continue
            if len(seg) <= HEAD_MAX + 4 and any(seg.endswith(s) for s in PLACE_SUFFIX):
                continue
            seg = seg[:16]
            if seg.count("「") > seg.count("」"):      # 引号不截半截
                seg = seg.split("「", 1)[0].strip()
            if len(seg) >= 2:
                return seg
        return (src or w)[:16]
    r = refs_phrase((ev.get("refs") or [])[:1])
    return r or ev.get("id", "")


def narr_situation(ev, band) -> str:
    """STAR 的 S：何时何地何人，全部取自已登记字段与段带标题。"""
    when = ev.get("when") or {}
    head = []
    if ev.get("layer") == "prehistory" and (band or {}).get("name"):
        head.append(band["name"] + "这一层")
    date = (band or {}).get("date") or ""
    if date and not when.get("abs"):
        head.append(date)
    if when.get("raw"):
        head.append(when["raw"])
    where = ev.get("where") or []
    if where:
        head.append("、".join(where[:2]) + ("等" + str(len(where)) + "处" if len(where) > 2 else ""))
    out = []
    if head:
        out.append("，".join(head) + "。")
    else:
        out.append("源里没给这一拍的时刻与处所。")
    who = ev.get("who") or []
    fac = ev.get("faction") or []
    # 措辞守「不猜」：who/faction 是卡面命中（这一行里点到了这个名字），不是场景在场证明——
    # 「白灼身世」这类条目里人物未必在场，所以只说「点到」，不说「在场」。
    if who:
        out.append("这一拍点到" + names_phrase(who) + "。")
    if fac:
        out.append("另有" + names_phrase(fac, unit="方") + "牵在其中。")
    return "".join(out)


def narr_task(ev) -> str:
    """STAR 的 T：起因。只有作者打了〔因：…〕才算数，没打就直说没写。
    口径说明（工具不代填）全篇只在开场白与看板提示里讲一次，单事件这里只陈述事实，
    免得五十二件事盖五十二遍同一句免责声明——读起来像盖章不像讲故事。"""
    why = (ev.get("why") or "").strip()
    if why:
        return "起因是作者自己写下的「" + why + "」。"
    return "起因这一项，源里没有写。"


def narr_action(ev) -> str:
    """STAR 的 A：经过。正文用作者原话，手法只认〔如何：…〕声明位。"""
    what = (ev.get("what") or "").strip()
    out = []
    if what:
        out.append(end_sentence(what))
    else:
        out.append("这一拍源里只有一行短记，正文没展开。")
    how = (ev.get("how") or "").strip()
    if how:
        out.append("手法是作者自己写下的「" + how + "」。")
    return "".join(out)


def narr_result(ev, nxt) -> str:
    """STAR 的 R：落点。章号、Δ 记号、以及源里的下一拍（只讲先后，不讲因果）。"""
    out = []
    refs = ev.get("refs") or []
    rp = refs_phrase(refs)
    if rp:
        out.append("这一件记在" + rp + "。" if len(refs) == 1 else "这几处分别记在" + rp + "。")
    else:
        out.append("源里没标章。")
    drift = (ev.get("drift") or "").strip()
    if drift:
        # Δ 是作者自己的记号，语义随项目走（有时是矛盾，有时是「此处无漂移」的声明），
        # 叙述层只把原文端出来，不替作者断言它是矛盾。
        out.append("同一条还带了 Δ 记号，原文是「" + drift + "」。")
    if nxt is not None:
        out.append("源里紧接着的下一拍是" + q(label_of(nxt)) + "。")
    return "".join(out)


def q(lab: str) -> str:
    """把邻拍标签包进引号：标签里若自带引号，按中文嵌套规矩降一级（「」→『』）。"""
    return "「" + (lab or "").replace("「", "『").replace("」", "』") + "」"


def story_sorted(evs) -> list:
    """按故事内时序排（storyKey 三键），导语/串讲里的头尾拍用它，与看板默认档位同向。"""
    return sorted(evs, key=lambda e: ((e.get("storyKey") or [0, 0, 0]) + [0, 0, 0])[:3])


def event_gaps(ev) -> list:
    """缺项清单（记账，不是闸）：作者要补哪一项，看板就照这一行提示。"""
    when = ev.get("when") or {}
    gaps = []
    if not when.get("raw"):
        gaps.append("时刻未标")
    if not (ev.get("where") or []):
        gaps.append("处所未标")
    if not (ev.get("who") or []):
        gaps.append("未命中人物卡")
    if not (ev.get("faction") or []):
        gaps.append("未命中势力卡")
    if not (ev.get("why") or "").strip():
        gaps.append("起因未登记")
    if not (ev.get("how") or "").strip():
        gaps.append("手法未登记")
    if not (ev.get("refs") or []):
        gaps.append("章未标")
    return gaps


def event_narrative(ev, band, nxt) -> list:
    return [{"k": k, "label": lab, "text": fn(ev, band, nxt)}
            for (k, lab), fn in zip(NARR_BEATS, (
                lambda e, b, n: narr_situation(e, b),
                lambda e, b, n: narr_task(e),
                lambda e, b, n: narr_action(e),
                lambda e, b, n: narr_result(e, n)))]


def band_intro(band, evs) -> str:
    """段带导语：这一段叫什么、收了几件事、几条轨、覆盖哪些章，作者的 ※ 说明与 Δ 逐字带上。
    去重口径：※ 说明里已含 Δ 原文时不再重复一遍（同一句话读两次就不叫娓娓道来了）。"""
    out = []
    name = band.get("name") or band.get("id")
    sub = (band.get("sub") or "").strip()
    out.append("这一段叫「" + name + "」。" if not sub
               else "这一段叫「" + name + "」，段标题上还写着「" + sub + "」。")
    lane_n = len({t for e in evs for t in (e.get("tracks") or [])})
    ch = band.get("chapters") or {}
    second = "收了" + str(len(evs)) + "件事，牵到" + str(lane_n) + "条轨道"
    if ch.get("from") is not None:
        second += ("，正文覆盖第" + str(ch["from"]) + "章"
                   if ch.get("to") in (None, ch.get("from"))
                   else "，正文覆盖第" + str(ch["from"]) + "到" + str(ch["to"]) + "章")
    out.append(second + "。")
    if len(evs) >= 2:
        ss = story_sorted(evs)
        h, t = label_of(ss[0]), label_of(ss[-1])
        if h and t and h != t:
            out.append("头一拍是" + q(h) + "，末一拍是" + q(t) + "。")
    if band.get("layer") == "prehistory" and "倒叙" not in sub and "前史" not in sub:
        out.append("它属于倒叙层，讲的是正文开始之前的事。")
    note = (band.get("note") or "").strip()
    drift = (band.get("drift") or "").strip()
    if note:
        out.append("作者在段标题上留了一句说明，原文是「" + note + "」。")
    if drift and drift not in note and drift not in sub:
        out.append("段标题上还带了 Δ 记号，原文是「" + drift + "」。")
    return "".join(out)


def lane_arc(lane, evs) -> str:
    """轨道串讲：这条轨上几件事、跨几段、最早最晚记在第几章，化名照源里写法带上。"""
    out = []
    bands_n = len({e.get("band") for e in evs})
    chs = [r["from"] for e in evs for r in (e.get("refs") or [])]
    cht = [r["to"] for e in evs for r in (e.get("refs") or [])]
    s = lane["name"] + "这条轨上有" + str(len(evs)) + "件事，横跨" + str(bands_n) + "个段带"
    if chs:
        s += "，最早记在第" + str(min(chs)) + "章，最晚记在第" + str(max(cht)) + "章"
    out.append(s + "。")
    if len(evs) >= 2:
        ss = story_sorted(evs)
        h, t = label_of(ss[0]), label_of(ss[-1])
        if h and t and h != t:
            out.append("开头那一拍是" + q(h) + "，收尾那一拍是" + q(t) + "。")
    al = lane.get("aliases") or []
    if al:
        out.append("源里也写作「" + "」、「".join(al) + "」。")
    return "".join(out)


def chronicle_lead(sources, bands, lanes, events, stats) -> str:
    """全篇开场白：把覆盖面与空档一次讲清（报数附收据的口语版）。
    一拍一段（换行分隔），页面按段落渲染——长句堆一块就不叫娓娓道来了。"""
    srcs = "、".join(s.get("file", "") for s in sources) or "（暂无真相源）"
    n = stats.get("events", 0)
    lk = stats.get("laneKinds") or {}
    paras = ["这本大事记由 " + srcs + " 归纳而来，收了" + str(n) + "件事，分成"
             + str(stats.get("bands", 0)) + "段，牵出" + str(stats.get("lanes", 0))
             + "条轨道，人物轨" + str(lk.get("person", 0)) + "条、势力轨"
             + str(lk.get("faction", 0)) + "条。"]
    if n:
        paras.append(str(n) + "件事里，标了章的有" + str(stats.get("withRefs", 0))
                     + "件，点到人物卡的有" + str(stats.get("withWho", 0))
                     + "件，写了时刻的有" + str(stats.get("withTime", 0)) + "件（其中"
                     + str(stats.get("approxTime", 0)) + "件是相对量或钟表折算，只用来排序），"
                     "落了处所的有" + str(stats.get("withPlace", 0)) + "件。")
        wy, wh = stats.get("withWhy", 0), stats.get("withHow", 0)
        if wy or wh:
            paras.append("起因登记了" + str(wy) + "件，手法登记了" + str(wh) + "件。")
        else:
            paras.append("起因与手法两项一件也没登记。这两项工具按不猜的口径留空，"
                         "要它们说话，得作者在源里那一行写下〔因：…〕〔如何：…〕。")
        if stats.get("withDrift", 0):
            paras.append("带 Δ 记号的有" + str(stats.get("withDrift", 0))
                         + "件，记号是作者自己打的，原文逐字进了详情。")
    unc = stats.get("uncoveredPeople") or []
    if unc:
        paras.append("有卡却一次没上轨的人物是" + "、".join(unc) + "，留给作者自查。")
    if not events:
        paras.append("真相源还没写条目，这一页因此是空的。写下第一条编年再重跑即有。")
    return "\n".join(paras)


GAP_HINT = ("要补哪一项，就在源里那一行加记号：**时刻** 写时刻、（第N章）写章、"
            "〔因：…〕写起因、〔如何：…〕写手法、〔何地：…〕写处所，重跑归纳器即入账。")


def attach_narrative(payload: dict) -> dict:
    """把叙述层挂进 payload（bands[].intro / lanes[].arc / events[].narr+gap / narrative）。
    只读已登记字段，产出确定性文本；同一输入两次跑逐字节一致。"""
    bands, lanes, events = payload["bands"], payload["lanes"], payload["events"]
    band_by = {b["id"]: b for b in bands}
    evs_by_band = {}
    for e in events:
        evs_by_band.setdefault(e["band"], []).append(e)
    for b in bands:
        b["intro"] = band_intro(b, evs_by_band.get(b["id"], []))
    for l in lanes:
        l["arc"] = lane_arc(l, [e for e in events if l["name"] in (e.get("tracks") or [])])
    for i, e in enumerate(events):
        e["narr"] = event_narrative(e, band_by.get(e["band"]), events[i + 1] if i + 1 < len(events) else None)
        e["gap"] = event_gaps(e)
    gap_count = {}
    for e in events:
        for g in e["gap"]:
            gap_count[g] = gap_count.get(g, 0) + 1
    payload["narrative"] = {
        "lead": chronicle_lead(payload["sources"], bands, lanes, events, payload["stats"]),
        "hint": GAP_HINT,
        "gaps": [{"k": k, "n": v} for k, v in sorted(gap_count.items(), key=lambda kv: (-kv[1], kv[0]))],
        "beats": [{"k": k, "label": lab} for k, lab in NARR_BEATS],
    }
    return payload


# ── 自测（合成 fixture，两遍逐字节一致 + 零丢弃 + 化名/Δ/声明位）──
def synth_project(base: Path):
    wb = base / WBDIR
    (wb / "编年").mkdir(parents=True, exist_ok=True)
    (wb / "人物.md").write_text(
        "# 人物\n\n## 主角侧\n\n"
        "### 柯秒（主角，首现第1章）\n\n- 一句话：测试\n\n"
        "### 白灼（女主，化名“白小姐”）\n\n- 一句话：测试\n\n"
        "### 程羽笑／三妹／魇（名字第55章查出）\n\n- 一句话：测试\n",
        encoding="utf-8")
    (wb / "设定.md").write_text(
        "# 设定\n\n## 组织\n\n- **务虚学会**：官方唯二组织之一。\n\n"
        "- **工会**（早期名「巴比特工会」，第10章）：官方组织之二。\n\n"
        "- **残响**：敌对组织，代号 魑魅魍魉。\n\n## 关键地点\n\n"
        "- **幻影科技大楼**：游戏公司。\n\n- **岑溪中学（岑中）**：S级副本所在。\n",
        encoding="utf-8")
    (wb / "时间线.md").write_text(
        "---\n{\n  \"id\": \"pj/worldbook/时间线\",\n  \"title\": \"时间线\"\n}\n---\n\n"
        "# 时间线 · 编年骨架\n\n> 编年骨架：大事按序排。\n\n"
        "## 故事前史（倒叙层）\n\n"
        "- **约十二年前**：岑溪中学地震，程羽笑被锁进厕所隔间（第61章）。\n\n"
        "## 第一日 · 6月24日（第1-17章）\n\n"
        "- **16:50** 幻影科技大楼A栋403：假面试，「白小姐」快问快答（第1章）\n"
        "- 白灼摊牌：受托接引。\n"
        "- 火锅局敲定护航委托（第9-10章）。**（Δ实际成行时间与队伍见下）**\n"
        "- **世界观大叙述**：渊芯事件，残响起疑〔因：柯厘追查渊芯泄漏〕〔如何：白灼带路入界〕。\n"
        "- 深夜11点，柯秒在〔何地：不眠者公寓〕独自下界复查丑屋（第26章）。\n",
        encoding="utf-8")
    (wb / "编年" / "大事记.md").write_text(
        "# 大事记\n\n## 第二日 · 6月25日（第28-37章）※日期为推断（Δ护航委托原定6月25日下午）\n\n"
        "- 务虚学会正式报到，柯秒精神力检测S（第28章）。\n",
        encoding="utf-8")
    return base


def cmd_selfcheck() -> int:
    with tempfile.TemporaryDirectory() as td:
        base = synth_project(Path(td) / "p-selfcheck")
        p1 = render_json(base, "p-selfcheck")
        s1 = json.dumps(p1, ensure_ascii=False, sort_keys=True, indent=1)
        p2 = render_json(base, "p-selfcheck")
        s2 = json.dumps(p2, ensure_ascii=False, sort_keys=True, indent=1)
        st = p1["stats"]
        # 零丢弃：两份源文件的 bullet 全成事件
        bullets = 0
        for rel in SOURCE_CANDIDATES:
            p = base / rel
            if p.exists():
                bullets += sum(1 for l in p.read_text(encoding="utf-8").splitlines()
                              if l.startswith("- ") and l[2:].strip())
        assert st["events"] == bullets == 7, f"零丢弃失败：events={st['events']} bullets={bullets}"
        assert len(p1["sources"]) == 2, f"双真相源未都收：{len(p1['sources'])}"
        assert st["bands"] == 3, f"段带数 {st['bands']} != 3"
        assert st["withTime"] == 3, f"when 命中 {st['withTime']} != 3（约十二年前 / 16:50 / 深夜11点）"
        assert st["approxTime"] == 2, f"近似 {st['approxTime']} != 2（相对量 + 12小时平移各一）"
        assert st["withDrift"] == 1, f"Δ 记账 {st['withDrift']} != 1"
        assert st["withWhy"] == 1 and st["withHow"] == 1, "〔因〕〔如何〕声明位未生效"
        assert st["withRefs"] == 5, f"章 refs 命中 {st['withRefs']} != 5"
        assert st["withWho"] == 6, f"who 命中 {st['withWho']} != 6"
        assert st["withFaction"] == 2, f"势力命中 {st['withFaction']} != 2"
        assert st["withPlace"] == 3, f"where 命中 {st['withPlace']} != 3（卡名2 + 〔何地〕声明1）"
        assert st["chapterSpan"] == {"from": 1, "to": 61}, st["chapterSpan"]
        by = {e["id"]: e for e in p1["events"]}
        head = by["e002"]
        assert head["when"]["raw"] == "16:50" and head["when"]["via"] == "bold-head", head["when"]
        assert "白灼" in head["who"], f"化名「白小姐」未归并到白灼：{head['who']}"
        assert head["where"] == ["幻影科技大楼"], f"where 未截到后缀锚定形：{head['where']}"
        assert head["whereCards"] == ["幻影科技大楼"], f"whereCards 应留卡名：{head['whereCards']}"
        pre = by["e001"]
        assert pre["when"]["days"] == -4380.0, pre["when"]
        assert pre["layer"] == "prehistory" and pre["where"] == ["岑溪中学"], pre
        assert pre["whereCards"] == ["岑溪中学"], pre["whereCards"]
        assert all("tracks" in e and "storyKey" in e for e in p1["events"])
        big = by["e005"]
        assert big["when"]["raw"] == "", f"非时间加粗被误当 when：{big['when']}"
        assert big["why"] == "柯厘追查渊芯泄漏", big["why"]
        assert big["how"] == "白灼带路入界", big["how"]
        night = by["e006"]
        assert night["when"]["via"] == "bare-clock" and night["when"]["clock"] == 23 * 60, night["when"]
        assert night["where"] == ["不眠者公寓"] and "〔何地〕" not in night["what"], night
        assert by["e007"]["file"].endswith("大事记.md"), by["e007"]["file"]
        lane_names = {l["name"] for l in p1["lanes"]}
        assert "程羽笑" in lane_names, f"并列名未建轨：{lane_names}"
        assert any(l["kind"] == "faction" and l["name"] == "残响" for l in p1["lanes"]), "势力轨缺失"
        assert all(l["kind"] in ("person", "faction") for l in p1["lanes"]), "地点不应入轨"
        bands_by = {b["id"]: b for b in p1["bands"]}
        assert bands_by["b3"]["sub"] == "6月25日（第28-37章）", bands_by["b3"]
        assert bands_by["b3"]["note"].startswith("日期为推断"), bands_by["b3"]["note"]
        assert "Δ" in bands_by["b3"]["drift"], bands_by["b3"]["drift"]
        assert bands_by["b3"]["chapters"] == {"from": 28, "to": 37}, bands_by["b3"]
        assert bands_by["b1"]["layer"] == "prehistory", bands_by["b1"]
        assert st["uncoveredPeople"] == [], st["uncoveredPeople"]
        # ── 叙述层（STAR，人读的）：结构、忠实度、文风闸 ──
        nar = p1["narrative"]
        assert nar["lead"].strip() and "\n" in nar["lead"], "开场白缺失或没分段"
        assert "7件事" in nar["lead"] and "3段" in nar["lead"], nar["lead"]
        assert [b["k"] for b in nar["beats"]] == ["s", "t", "a", "r"], nar["beats"]
        assert nar["hint"].strip() and "〔因：…〕" in nar["hint"], nar["hint"]
        assert all(b["intro"].strip() for b in p1["bands"]), "段带导语有空"
        assert all(l["arc"].strip() for l in p1["lanes"]), "轨道串讲有空"
        # 导语/串讲要给读者一条线：两件以上的段带与轨道必须点出头尾两拍
        for b in p1["bands"]:
            evs = [e for e in p1["events"] if e["band"] == b["id"]]
            if len(evs) >= 2:
                assert "头一拍是" in b["intro"] and "末一拍是" in b["intro"], (b["id"], b["intro"])
        for l in p1["lanes"]:
            evs = [e for e in p1["events"] if l["name"] in (e.get("tracks") or [])]
            if len(evs) >= 2:
                assert "开头那一拍是" in l["arc"] and "收尾那一拍是" in l["arc"], (l["id"], l["arc"])
        verbatim = []            # 作者原文（叙述层只许逐字搬，不许改写）
        for e in p1["events"]:
            beats = e["narr"]
            assert [b["k"] for b in beats] == ["s", "t", "a", "r"], e["id"]
            assert all(b["text"].strip() for b in beats), f"叙述有空句：{e['id']}"
            txt = {b["k"]: b["text"] for b in beats}
            verbatim += [e["what"], e["why"], e["how"], e["drift"], e["body"]]
            # A 拍＝作者原话（只补句末标点），不许增删字
            assert end_sentence(e["what"]) in txt["a"] if e["what"] else "没展开" in txt["a"], e["id"]
            # T 拍：有〔因：〕就逐字带上，没有就直说没写，绝不代填
            if e["why"]:
                assert "「" + e["why"] + "」" in txt["t"], (e["id"], txt["t"])
            else:
                assert txt["t"] == "起因这一项，源里没有写。", (e["id"], txt["t"])
            # R 拍：有章就报章，Δ 只端原文不下断言
            if e["refs"]:
                assert refs_phrase(e["refs"]) in txt["r"], (e["id"], txt["r"])
            if e["drift"]:
                assert "「" + e["drift"] + "」" in txt["r"], (e["id"], txt["r"])
            # S 拍：时刻与处所只搬已登记字段
            if e["when"]["raw"]:
                assert e["when"]["raw"] in txt["s"], (e["id"], txt["s"])
            for w in e["where"][:2]:
                assert w in txt["s"], (e["id"], txt["s"])
            for w in e["who"]:
                assert w in txt["s"], (e["id"], txt["s"])
            # 缺项账要诚实：没标时刻就必须列出来
            assert ("时刻未标" in e["gap"]) == (not e["when"]["raw"]), (e["id"], e["gap"])
            assert ("起因未登记" in e["gap"]) == (not e["why"]), (e["id"], e["gap"])
        for b in p1["bands"]:
            verbatim += [b.get("note", ""), b.get("drift", ""), b.get("sub", "")]
        for l in p1["lanes"]:
            verbatim += list(l.get("aliases") or [])
        # 邻拍短标签：行首处所要跳过、引号不截半截、不许以前导标点开头
        assert label_of(by["e002"]) == "假面试", label_of(by["e002"])
        for e in p1["events"]:
            lab = label_of(e)
            assert lab and lab[0] not in "：:、，,；;（(【】", (e["id"], lab)
            assert lab.count("「") == lab.count("」"), (e["id"], lab)
        # 文风闸：摘掉作者原文后，工具自己写的字里不许出现破折号/翻案句/模型腔
        composed = [nar["lead"], nar["hint"]] + [b["text"] for e in p1["events"] for b in e["narr"]] \
            + [b["intro"] for b in p1["bands"]] + [l["arc"] for l in p1["lanes"]]
        for t in composed:
            bad = style_scan(t, exempt=verbatim)
            assert not bad, f"文风闸命中「{bad}」：{t[:60]}"
        _pp, _ff, _ll = collect_lanes(base)
        by_name = {c["name"]: c["aliases"] for c in _ll + _ff}
        assert "岑中" in by_name.get("岑溪中学", []), by_name.get("岑溪中学")
        assert "巴比特工会" in by_name.get("工会", []), by_name.get("工会")
        assert s1 == s2, "两遍渲染不一致（非确定源混入）"
        print(f"chronicle selfcheck OK ｜ 事件 {st['events']} ｜ 段带 {st['bands']} ｜ "
              f"轨道 {st['lanes']} ｜ 未覆盖人物 {st['uncoveredPeople']}")
    return 0


def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
    ap = argparse.ArgumentParser(description="大事记归纳器：时间线 md → chronicle@1 派生件（W4.6）")
    ap.add_argument("--root", help="项目目录（projects/<id>；平铺根同 kit-compile 口径）")
    ap.add_argument("--out", help="输出 JSON 路径（缺省 <项目>/世界书/chronicle.json）")
    ap.add_argument("--quiet", action="store_true")
    ap.add_argument("--print-payload", action="store_true", help="只打印 payload（对账用，不写盘）")
    ap.add_argument("--selfcheck", action="store_true", help="合成 fixture 全链自测")
    args = ap.parse_args()
    if args.selfcheck:
        return cmd_selfcheck()
    if not args.root:
        ap.error("需要 --root <项目目录>（或 --selfcheck）")
        return 2
    proj = Path(args.root)
    if not proj.is_absolute():
        proj = ROOT / proj
    proj = proj.resolve()
    if not proj.is_dir():
        alt = proj.parent / proj.name
        if not alt.is_dir():
            print(f"[ABORT] 项目目录不存在：{proj}", file=sys.stderr)
            return 1
        proj = alt
    payload = render_json(proj, proj.name)
    text = json.dumps(payload, ensure_ascii=False, indent=1)
    if args.print_payload:
        print(text)
        return 0
    out = Path(args.out) if args.out else proj / WBDIR / "chronicle.json"
    if not out.is_absolute():
        out = ROOT / out
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text, encoding="utf-8")
    if not args.quiet:
        st = payload["stats"]
        print(f"chronicle@1 → {out} ｜ 事件 {st['events']} ｜ 段带 {st['bands']} ｜ 轨道 {st['lanes']}"
              f"（人物 {st['laneKinds']['person']}/势力 {st['laneKinds']['faction']}）｜ when {st['withTime']}"
              f" ｜ where {st['withPlace']} ｜ who {st['withWho']} ｜ 章ref {st['withRefs']}"
              f" ｜ Δ {st['withDrift']} ｜ 未登记 why/how {st['events'] - st['withWhy']}"
              f"/{st['events'] - st['withHow']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
