#!/usr/bin/env python3
"""state_builder · 从项目稿件组装 Laya 训练用增强 state。

师生输入同构纪律：教师标注与本模型推理必须用一模一样的 state 字段。
输出 cases.jsonl：{"case_id", "project", "file", "state": {场景文本/人设卡/章节位置}}

用法：
  python tools/laya-ft/state_builder.py --project p-kunxiu-001 \
      --file 04-写作/终稿.md --chunk 500 --out cases.jsonl
"""
import argparse, json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

PERSONA_KEYS = ("身份", "要什么", "怕什么", "被什么卡着", "语言拍子")

def persona_card(project: str, names) -> str:
    out = []
    for md in sorted((ROOT / "projects" / project / "世界书" / "人物").glob("*.md")):
        name = md.stem
        if names and name not in names:
            continue
        body = md.read_text(encoding="utf-8")
        body = re.sub(r"^---[\s\S]*?---\n", "", body)          # 去头部
        body = body.split("章账回写")[0]                        # 去章账回写段（历史事实不进判定面）
        keep = [l.strip() for l in body.splitlines() if any(l.strip().startswith(k) for k in PERSONA_KEYS)]
        if keep:
            out.append(f"{name}：" + " ".join(keep))
    return "\n".join(out)

def chapters(text: str):
    parts = re.split(r"^(##\s*第[一二三四五六七八九十百0-9]+章.*$)", text, flags=re.M)
    cur = "卷首"
    for seg in parts:
        m = re.match(r"^##\s*(第[一二三四五六七八九十百0-9]+章)", seg)
        if m:
            cur = m.group(1); continue
        if seg.strip():
            yield cur, seg

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", required=True)
    ap.add_argument("--file", required=True)
    ap.add_argument("--chunk", type=int, default=500, help="目标块大小（字符）")
    ap.add_argument("--personas", default="", help="逗号分隔的人设卡名（缺省=全部主角卡）")
    ap.add_argument("--pov", default="", help="视角人物名（needs_pov 题的证据字段；缺省=不注入，pov-leak 题会被标注循环跳过并告警）")
    ap.add_argument("--out", default="cases.jsonl")
    a = ap.parse_args()

    src = ROOT / "projects" / a.project / a.file
    text = src.read_text(encoding="utf-8")
    text = re.sub(r"^---[\s\S]*?---\n", "", text)   # 铁律 9：artifact@1 头部（过程元数据）不进判定面
    personas = persona_card(a.project, [x for x in a.personas.split(",") if x])
    pov_card = {"视角人物": a.pov} if a.pov else {}
    total = len(text)
    rows, done = [], 0
    cid = 0
    for ch, seg in chapters(text):
        buf = ""
        for para in [p for p in seg.split("\n") if p.strip()]:
            buf += para.strip() + "\n"
            if len(buf) >= a.chunk:
                cid += 1
                rows.append({
                    "case_id": f"{a.project}-{cid:04d}",
                    "project": a.project, "file": a.file,
                    "state": {"场景文本": buf.strip()[:a.chunk * 2], "人设卡": personas,
                              "章节位置": ch, **pov_card},
                })
                done += len(buf); buf = ""
        if buf.strip():
            cid += 1
            rows.append({"case_id": f"{a.project}-{cid:04d}", "project": a.project, "file": a.file,
                         "state": {"场景文本": buf.strip(), "人设卡": personas,
                                   "章节位置": ch, **pov_card}})
            done += len(buf)
    # v0.3 证据字段注入（师生输入同构；B 类五题的 state 加强，题面不变）：
    # 上一场收束→scene-value 转折参照；后续场景→curve-type 跨段序列；
    # 章末段→ending-hook 作答条件；开场切片→hook-strength/hook-type 判定对象。
    for i, r in enumerate(rows):
        st = r["state"]
        same = [x for x in rows if x["file"] == r["file"]]
        pos = same.index(r)
        st["上一场收束"] = same[pos - 1]["state"]["场景文本"][-150:] if pos else ""
        st["后续场景"] = "\n".join(x["state"]["场景文本"] for x in same[pos + 1:pos + 3])[:900]
        ch_rows = [x for x in same if x["state"].get("章节位置") == st.get("章节位置")]
        st["是否章末段"] = ch_rows[-1]["case_id"] == r["case_id"]
        st["开场切片"] = ch_rows[0]["state"]["场景文本"][:100]
    out = Path(a.out)
    out.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows), encoding="utf-8")
    print(f"[state] {len(rows)} cases → {out}（覆盖 {done}/{total} 字符）")

if __name__ == "__main__":
    main()
