"""export-doc · 小纲/剧本 → Word doc 导出器（export_doc minitool 实现）

用法：python tools/export-doc.py <试稿md> <输出docx> [--ideas 思路md] [--title 标题]
                        [--node <节点id>] [--expect-episodes N] [--expect-beats N] [--allow-lossy]

解析拍级条目（B 编号｜钩型｜时长 + 【0-3秒】/分镜/台词/表演/尾钩），
输出可批注的 docx：每集一级标题，每分镜一组段落（场面/台词/承接），文末创作思路页与批注说明。

M0 硬断言（底座规格 §2.4，任一不过 exit 1，--allow-lossy 降级为警告并标记输出）：
  1) 残渣检测：heredoc 结束符 / shell 痕迹不得进入正文
  2) 计数一致：源文件 B 标记总数 == 解析导出分镜数（静默丢弃即失败）
  3) 集标题规范：## 第X集《标题》 形式（后缀破坏解析即失败）
  4) 期望值：--expect-episodes / --expect-beats
成功后自动快照（tools/snapshot.py）：--node 指定节点，捕获源 md 与思路 md（文本产物）。
"""
import argparse, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
KIT_MARK = Path(__file__).resolve().parent / "kit.json"
def proj_dir(name):
    # kit vendor 模式：本工具被 kit.py 拷贝进 <project>/kit/ 内时，
    # kit/ 上一级即项目根（kit.json 为标记）；常驻模式返回中心工作区路径。
    if KIT_MARK.exists():
        return ROOT
    return ROOT / "projects" / name


def snapshot_after_export(node, flow, out, note):
    """交付即快照（铁律 7）：源 md + 交付 docx 一并留档；失败可见不阻塞。"""
    if not node:
        return
    try:
        rel = SRC.resolve().relative_to(ROOT)
        project = rel.parts[1] if rel.parts[0] == "projects" else None
        if not project:
            print("snapshot: 跳过（源文件不在 projects/<id>/ 下）")
            return
        import snapshot as _snap
        proj_root = proj_dir(project)
        fmap = {SRC.resolve().relative_to(proj_root).as_posix(): str(SRC.resolve())}
        if out.resolve().exists() and out.resolve().is_relative_to(proj_root):
            fmap[out.resolve().relative_to(proj_root).as_posix()] = str(out.resolve())
        if ideas_path and Path(ideas_path).exists():
            fmap[Path(ideas_path).resolve().relative_to(proj_root).as_posix()] = str(ideas_path.resolve())
        entry = _snap.capture(project, node, fmap, note=note, flow=flow)
        print(f"snapshot: {node} r{entry['round']}（{len(entry['files'])} 文件）")
    except Exception as e:  # 快照失败不阻塞交付，但要可见
        print(f"snapshot: 失败（不阻塞）：{e}")


sys.path.insert(0, str(Path(__file__).resolve().parent))

ap = argparse.ArgumentParser()
ap.add_argument("src", type=Path)
ap.add_argument("out", type=Path)
ap.add_argument("--ideas", type=Path)
ap.add_argument("--title")
ap.add_argument("--node", help="快照节点 id（如 miniguided）；缺省则不快照")
ap.add_argument("--flow", default="topic-selection")
ap.add_argument("--expect-episodes", type=int)
ap.add_argument("--expect-beats", type=int)
ap.add_argument("--script-format", action="store_true", help="配合 --plain：剧本客户版式（人名按角色分色/【】样式）")
ap.add_argument("--plain", action="store_true", help="通用 md→docx 模式（标题/段落/列表/表格粗排），跳过 B 拍解析——用于分析报告/方案等非拍级产物")
ap.add_argument("--allow-lossy", action="store_true", help="断言不过时降级为警告继续导出（不推荐）")
args = ap.parse_args()

SRC, OUT = args.src, args.out
ideas_path = args.ideas
title = args.title or SRC.stem

text = SRC.read_text(encoding="utf-8")

# 解析集与拍
eps = []
for em in re.finditer(r"^## (第[一二三四五六七八九十]+集《([^」》]*)》)\n(.*?)(?=^## |\Z)", text, re.S | re.M):
    beats = []
    for bm in re.finditer(r"\*\*B(\d+)｜([^｜]+)｜(\d+)秒\*\*\n(.*?)(?=\*\*B\d+｜|^## |\Z)", em.group(3), re.S):
        body = bm.group(4)
        def grab(label):
            m = re.search(rf"{label}[：:]\s*\n?((?:(?!^[分表表尾演]|^\*\*|^\n\n).+\n?)*)", body, re.M)
            return re.sub(r"\n+", " / ", m.group(1)).strip().rstrip(" /") if m else ""
        beats.append({
            "no": int(bm.group(1)),
            "hook": bm.group(2),
            "sec": int(bm.group(3)),
            "open": (re.search(r"【0-3秒】([^\n]+)", body) or [None, ""])[1].strip(),
            "storyboard": (re.search(r"分镜：([^\n]+)", body) or [None, ""])[1].strip(),
            "dialogue": [l.strip() for l in re.findall(r"台词：\s*\n?((?:[-*]\s*)?[^：\n]+[：:][^\n]*)", body)],
            "perf": (re.search(r"表演：([^\n]+)", body) or [None, ""])[1].strip(),
            "tail": (re.search(r"尾钩→?\s*([^\n]+)", body) or [None, ""])[1].strip(),
        })
    eps.append({"head": em.group(1), "title": em.group(2), "beats": beats})

# ---------- --plain 通用模式：非拍级产物（报告/方案）直接 md→docx ----------
# 自动降级：源文档解析不出「第X集」B 拍结构（如小说「第X章」、报告）且未显式要求
# 集数校验时，批注壳版式对它毫无意义——自动转 plain，禁止静默产出空壳 docx
# （事故：novel 终稿导出只剩 256 字符批注说明，正文零字符）。
if not eps and not args.plain and not args.expect_episodes:
    print("[export-doc] 未解析出「第X集」B 拍结构——自动转 --plain 通用模式（小说/报告类）")
    args.plain = True

if args.plain:
    problems = []
    for i, ln in enumerate(text.splitlines(), 1):
        sr = ln.strip()
        if re.fullmatch(r"[A-Z][A-Z0-9_]*EOF", sr) or re.search(r"wc -l|cat > .|<<'[A-Z]", sr):
            problems.append(f"残渣 L{i}:「{sr[:50]}」")
    if not text.strip():
        problems.append("产物为空")
    if problems and not args.allow_lossy:
        print(f"[export-doc] 断言未过（{len(problems)} 项），拒绝导出：")
        for x in problems:
            print(f"  ✗ {x}")
        sys.exit(1)

    from docx import Document as _Doc
    from docx.oxml.ns import qn as _qn
    from docx.shared import Pt as _Pt, RGBColor as _RGBColor
    doc = _Doc()
    st = doc.styles["Normal"]
    st.font.name = "Calibri"
    st.font.size = _Pt(11)
    st.element.rPr.rFonts.set(_qn("w:eastAsia"), "微软雅黑")

    def _runs(par, t):
        for i, seg in enumerate(re.split(r"\*\*", t)):
            if seg:
                par.add_run(seg).bold = (i % 2 == 1)

    lines = text.split("\n")
    i = 0
    while i < len(lines):
        ln = lines[i].rstrip()
        if not ln.strip():
            i += 1
            continue
        h = re.match(r"^(#{1,4}) (.+)$", ln)
        if h:
            doc.add_heading(re.sub(r"\*\*", "", h.group(2)), level=min(len(h.group(1)) + 1, 4))
            i += 1
            continue
        if ln.startswith("|"):
            rows = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                cells = [c.strip() for c in lines[i].strip().strip("|").split("|")]
                if not all(re.match(r":?-{2,}:?$", c) for c in cells):
                    rows.append(cells)
                i += 1
            if rows:
                tb = doc.add_table(rows=len(rows), cols=len(rows[0]))
                tb.style = "Table Grid"
                for r, row in enumerate(rows):
                    for c, cell in enumerate(row[: len(rows[0])]):
                        tb.cell(r, c).text = re.sub(r"\*\*", "", cell)
            continue
        if re.match(r"^[-*] ", ln):
            par = doc.add_paragraph(style="List Bullet")
            _runs(par, ln[2:])
            i += 1
            continue
        if ln.startswith("> "):
            par = doc.add_paragraph()
            par.paragraph_format.left_indent = _Pt(18)
            r = par.add_run(ln[2:])
            r.italic = True
            i += 1
            continue
        if args.script_format:
            # 客户剧本版式：人名按角色分色；【】行灰蓝斜体；前置件【标题】加粗
            fm = re.match(r"^【(背景|主角|剧情概括)】\s*(.*)$", ln)
            dm = re.match(r"^([^【】（）:：]{1,10})（([^）]*)）[：:](.*)$", ln)
            sm = re.match(r"^([^【】（）:：]{1,10})[：:](.*)$", ln) if not dm else None
            bm = re.match(r"^【([^】]+)】$", ln)
            if fm:
                doc.add_heading(f"【{fm.group(1)}】", level=2)
                if fm.group(2):
                    par = doc.add_paragraph()
                    _runs(par, fm.group(2))
                i += 1
                continue
            if dm:
                par = doc.add_paragraph()
                name = dm.group(1)
                palette = ["1F6FB2", "B2452E", "2E7D4F", "7B4FB2", "B2862E", "2E93A8", "A84F7B", "5A6B2E", "8A4F2E", "3F5AA8"]
                color = palette[sum(ord(ch) for ch in name) % len(palette)]
                nr = par.add_run(name)
                nr.bold = True
                nr.font.color.rgb = _RGBColor(int(color[0:2], 16), int(color[2:4], 16), int(color[4:6], 16))
                if dm.group(2):
                    pr = par.add_run(f"（{dm.group(2)}）")
                    pr.italic = True
                    pr.font.color.rgb = _RGBColor(0x8A, 0x84, 0x7A)
                par.add_run("：" + dm.group(3))
                i += 1
                continue
            if sm and sm.group(1) and not sm.group(1).startswith("【"):
                par = doc.add_paragraph()
                name = sm.group(1)
                palette = ["1F6FB2", "B2452E", "2E7D4F", "7B4FB2", "B2862E", "2E93A8", "A84F7B", "5A6B2E", "8A4F2E", "3F5AA8"]
                color = palette[sum(ord(ch) for ch in name) % len(palette)]
                nr = par.add_run(name)
                nr.bold = True
                nr.font.color.rgb = _RGBColor(int(color[0:2], 16), int(color[2:4], 16), int(color[4:6], 16))
                par.add_run("：" + sm.group(2))
                i += 1
                continue
            if bm:
                par = doc.add_paragraph()
                r = par.add_run(f"【{bm.group(1)}】")
                r.italic = True
                r.font.color.rgb = _RGBColor(0x4F, 0x6D, 0x8C)
                i += 1
                continue
        par = doc.add_paragraph()
        _runs(par, ln)
        i += 1

    OUT.parent.mkdir(parents=True, exist_ok=True)
    doc.save(str(OUT))
    print(f"written (plain): {OUT} ({OUT.stat().st_size//1024} KB)")
    snapshot_after_export(args.node, args.flow, OUT, note=f"export-doc 自动快照（plain）→ {OUT.name}")
    sys.exit(0)

# ---------- M0 硬断言（底座规格 §2.4）----------
problems = []
# 1) 残渣检测：heredoc 结束符 / shell 痕迹
for i, ln in enumerate(text.splitlines(), 1):
    s = ln.strip()
    if re.fullmatch(r"[A-Z][A-Z0-9_]*EOF", s):
        problems.append(f"残渣 L{i}: heredoc 结束符混入正文「{s}」")
    elif re.search(r"\bwc -l\b|cat > .|<<'[A-Z]", s):
        problems.append(f"残渣 L{i}: shell 痕迹「{s[:60]}」")
# 2) 计数一致
src_beats = len(re.findall(r"\*\*B\d+｜", text))
parsed = sum(len(e["beats"]) for e in eps)
if src_beats != parsed:
    problems.append(f"计数不一致：源 B 标记 {src_beats} ≠ 解析导出 {parsed}（{src_beats - parsed} 个分镜被静默丢弃）")
# 3) 集标题规范（后缀/变体破坏解析即失败；三级标题是思路页小节，不受此限）
for i, ln in enumerate(text.splitlines(), 1):
    if re.match(r"^##(?!#)", ln) and "集" in ln and not re.fullmatch(r"## 第[一二三四五六七八九十百零]+集《[^》]*》\s*", ln):
        problems.append(f"集标题不合规范 L{i}:「{ln.strip()[:50]}」（须为 ## 第X集《标题》）")
# 4) 期望值
if args.expect_episodes is not None and len(eps) != args.expect_episodes:
    problems.append(f"集数 {len(eps)} ≠ 期望 {args.expect_episodes}")
if args.expect_beats is not None and parsed != args.expect_beats:
    problems.append(f"分镜数 {parsed} ≠ 期望 {args.expect_beats}")

if problems:
    print(f"[export-doc] 断言未过（{len(problems)} 项），{'降级导出(--allow-lossy)' if args.allow_lossy else '拒绝导出'}：")
    for p in problems:
        print(f"  ✗ {p}")
    if not args.allow_lossy:
        sys.exit(1)

# ---------- 渲染 docx ----------
from docx import Document
from docx.oxml.ns import qn
from docx.shared import Pt, RGBColor as _RGBColor, RGBColor

doc = Document()
style = doc.styles["Normal"]
style.font.name = "Calibri"
style.font.size = Pt(11)
style.element.rPr.rFonts.set(qn("w:eastAsia"), "微软雅黑")

def para(t, bold=False, size=None, color=None, indent=None):
    p = doc.add_paragraph()
    r = p.add_run(t)
    r.bold = bold
    if size: r.font.size = Pt(size)
    if color: r.font.color.rgb = RGBColor(*color)
    if indent: p.paragraph_format.left_indent = Pt(indent)
    return p

# 封面说明
para(title, bold=True, size=16)
para("小纲（分镜脚本）· 批注版 —— 请在 Word 中使用「审阅 → 新建批注」逐分镜提意见，也可直接修改正文；改完将文件回传，成品剧本将基于批注后版本产出。", size=10)
para("", size=6)

for ep in eps:
    doc.add_heading(ep["head"], level=1)
    for i, b in enumerate(ep["beats"], 1):
        para(f"分镜 {i}（{b['no']}）", bold=True, size=11.5)
        if b["open"]:
            para("开场画面：" + b["open"], indent=14)
        if b["storyboard"]:
            para("行动/画面：" + b["storyboard"], indent=14)
        for d in b["dialogue"]:
            para("台词：" + d, indent=14)
        if b["perf"]:
            para("表演：" + b["perf"], indent=14)
        if b["tail"]:
            para("承接：" + b["tail"], indent=14)
        para("", size=4)

# 创作思路页
if ideas_path and Path(ideas_path).exists():
    doc.add_page_break()
    doc.add_heading("创作思路页（为什么这么写）", level=1)
    for ln in Path(ideas_path).read_text(encoding="utf-8").split("\n"):
        ln = ln.rstrip()
        if not ln.strip(): continue
        h = re.match(r"^(#{1,3}) (.+)$", ln)
        if h: doc.add_heading(h.group(2), level=min(len(h.group(1)) + 1, 3))
        elif ln.startswith("- "): doc.add_paragraph(ln[2:], style="List Bullet")
        elif ln.startswith("> "): para(ln[2:], size=10)
        else: para(ln)

# 批注与回传说明
doc.add_page_break()
doc.add_heading("批注与回传说明", level=1)
for t in [
    "1. 逐分镜批注：光标选中分镜内的任意文字 → 审阅 → 新建批注。批注请落在具体分镜上。",
    "2. 直接修改：正文字可直接改（建议开启审阅 → 修订，改动可追溯）。",
    "3. 回传：改完的文件回传给工作流，即视为 S4 验收输入；成品剧本将基于批注后版本产出。",
    "4. 分镜时长（6-15 秒）与集末钩位为内部纪律，已内控，无需批注。",
]:
    para(t)

OUT.parent.mkdir(parents=True, exist_ok=True)
doc.save(str(OUT))
tag = "（⚠ 断言未过，--allow-lossy 降级导出）" if problems else ""
print(f"written: {OUT} ({OUT.stat().st_size//1024} KB, {parsed} beats / {len(eps)} eps){tag}")

# ---------- 自动快照（源 md + 交付 docx；铁律 7：交付即快照，flow-verify 红档检查项）----------
if not problems:
    snapshot_after_export(args.node, args.flow, OUT,
                          note=f"export-doc 自动快照：{parsed} beats / {len(eps)} eps → {OUT.name}")
