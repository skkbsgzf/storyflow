import re, json, html
from pathlib import Path

ROOT = Path(r"D:\storymasterv4\projects\p-ts-001")

def md2h(md: str) -> str:
    out, i = [], 0
    lines = md.split("\n")
    def esc(s): return html.escape(s)
    def inline(s):
        s = esc(s)
        s = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", s)
        s = re.sub(r"`([^`]+)`", r"<code>\1</code>", s)
        return s
    while i < len(lines):
        ln = lines[i]
        if not ln.strip(): i += 1; continue
        h = re.match(r"^(#{1,4}) (.+)$", ln)
        if h:
            out.append(f"<h{min(len(h.group(1))+1,5)}>{inline(h.group(2))}</h{min(len(h.group(1))+1,5)}>"); i += 1; continue
        if re.match(r"^-{3,}$", ln.strip()): out.append("<hr>"); i += 1; continue
        if ln.startswith("|"):
            rows = []
            while i < len(lines) and lines[i].startswith("|"):
                cells = [c.strip() for c in lines[i].strip("|").split("|")]
                if not all(re.match(r":?-{2,}:?$", c) for c in cells): rows.append(cells)
                i += 1
            t = "<table><tr>" + "".join(f"<th>{inline(c)}</th>" for c in rows[0]) + "</tr>"
            for r in rows[1:]: t += "<tr>" + "".join(f"<td>{inline(c)}</td>" for c in r) + "</tr>"
            out.append(t + "</table>"); continue
        if re.match(r"^- ", ln):
            buf = []
            while i < len(lines) and re.match(r"^- ", lines[i]): buf.append(lines[i][2:]); i += 1
            out.append("<ul>" + "".join(f"<li>{inline(b)}</li>" for b in buf) + "</ul>"); continue
        if ln.startswith(">"):
            buf = []
            while i < len(lines) and lines[i].startswith(">"): buf.append(lines[i].lstrip("> ")); i += 1
            out.append("<blockquote>" + "<br>".join(inline(b) for b in buf if b) + "</blockquote>"); continue
        if ln.startswith("####"):  # beat record -> styled card
            out.append(f"<div class='beat'>{inline(ln.replace('#### ', ''))}</div>"); i += 1; continue
        buf = []
        while i < len(lines) and lines[i].strip() and not re.match(r"^(#{1,4} |\||- |> |####|-{3,}$)", lines[i]):
            buf.append(lines[i]); i += 1
        out.append("<p>" + "<br>".join(inline(b) for b in buf) + "</p>"); continue
    return "\n".join(out)

tabs = [
    ("①调研报告", "选题分析报告.md"),
    ("②梗卡", "梗卡.md"),
    ("③框架案", "故事框架案.md"),
    ("④方案·合理版", "选题方案-合理版.md"),
    ("⑤方案·爽版", "选题方案-爽版.md"),
    ("⑥前三章剧本", "前三章剧本.md"),
    ("⑦R1-R4 意见书", "多视角意见书-R4.md"),
]
tab_html, body_html = [], []
for n, (label, f) in enumerate(tabs):
    md = (ROOT / f).read_text(encoding="utf-8")
    md = re.sub(r"^---\n.*?\n---\n", "", md, flags=re.S)  # strip frontmatter
    tab_html.append(f'<button class="tab{" on" if n==0 else ""}" onclick="show({n})">{html.escape(label)}</button>')
    body_html.append(f'<div class="page{" on" if n==0 else ""}" id="p{n}">{md2h(md)}</div>')

html_doc = f"""<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>选题交付页 · 不肯生锈的人（run p-ts-001）</title>
<style>
body{{font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;margin:0;background:#0f1115;color:#e8e8ea}}
header{{padding:18px 16px 10px;background:linear-gradient(135deg,#141824,#0f1115)}}
header h1{{font-size:20px;margin:0 0 6px}}
header .sub{{font-size:12px;color:#9aa}}
.tabs{{display:flex;overflow-x:auto;gap:6px;padding:10px 12px;position:sticky;top:0;background:#0f1115ee;backdrop-filter:blur(6px)}}
.tab{{flex-shrink:0;border:1px solid #2a2f3a;background:#161a22;color:#cfd4dd;border-radius:16px;padding:6px 12px;font-size:13px}}
.tab.on{{background:#e8b33d;border-color:#e8b33d;color:#141414;font-weight:700}}
.page{{display:none;padding:6px 16px 60px;line-height:1.75;font-size:15px}}
.page.on{{display:block}}
h2{{border-left:4px solid #e8b33d;padding-left:10px;margin-top:26px}}
table{{border-collapse:collapse;width:100%;font-size:13px;margin:10px 0}}
th,td{{border:1px solid #2a2f3a;padding:6px 8px;text-align:left}}
th{{background:#161a22}}
code{{background:#1c2130;padding:1px 5px;border-radius:4px;font-size:12px}}
blockquote{{border-left:3px solid #4a5568;margin:10px 0;padding:6px 12px;color:#aab;background:#141824}}
.beat{{background:#141824;border:1px solid #232937;border-radius:8px;padding:8px 12px;margin:14px 0 8px;font-weight:700;color:#e8b33d;font-size:14px}}
ul{{padding-left:20px}} li{{margin:3px 0}}
.cards{{display:grid;gap:10px;margin:12px 0}}
.card{{border:1px solid #2a2f3a;border-radius:10px;padding:10px 12px;background:#141824}}
.card .tag{{display:inline-block;font-size:11px;border-radius:4px;padding:1px 6px;margin-bottom:4px}}
.card.r .tag{{background:#3d5a80;color:#fff}} .card.s .tag{{background:#a5433a;color:#fff}}
</style></head><body>
<header><h1>《不肯生锈的人》选题交付页</h1>
<div class="sub">flow: topic-selection v3.0.0 ｜ run: p-ts-001 ｜ 快照 2026-09-14 ｜ 生成：确定性渲染，零 LLM</div></header>
<div class="cards" style="padding:0 16px">
<div class="card r"><div class="tag">合理版 · calm</div><div class="t"><b>《不肯生锈的人》</b></div><div class="d">平缓×深沉 · 对标《扫地姑娘》浓度 · 每集≤1爆点 · 时代错位变体：旧技能=硬通货</div></div>
<div class="card s"><div class="tag">爽版 · hot</div><div class="t"><b>《AI 崩了，全网求我复工》</b></div><div class="d">激进×快餐 · 每集≥3爽点 · 零时差打脸 · 主推路线（前三章剧本按本档产出）</div></div>
</div>
<div class="tabs">{''.join(tab_html)}</div>
{''.join(body_html)}
<script>function show(n){{document.querySelectorAll('.tab').forEach((t,i)=>t.classList.toggle('on',i===n));document.querySelectorAll('.page').forEach((p,i)=>p.classList.toggle('on',i===n));window.scrollTo(0,0);}}</script>
</body></html>"""

out = ROOT / "选题交付页.html"
out.write_text(html_doc, encoding="utf-8")
print("written:", out, f"({out.stat().st_size//1024} KB)")
