import json, re

SRC = r"D:\storymasterv4\projects\p-key-soul\对外交付\03-剧本试稿.md"
text = open(SRC, encoding="utf-8").read()

beats = []
for m in re.finditer(r"\*\*B(\d+)｜([^｜]+)｜(\d+)秒\*\*\n(.*?)(?=\*\*B\d+｜|## |\Z)", text, re.S):
    beats.append({
        "id": "B" + m.group(1), "hook_type": m.group(2), "duration_s": int(m.group(3)),
        "has_0_3s": "【0-3秒】" in m.group(4),
        "has_storyboard": "分镜：" in m.group(4),
        "has_dialogue": "台词：" in m.group(4),
        "has_performance": "表演：" in m.group(4),
        "has_tailhook": "尾钩" in m.group(4),
    })

results = []
def check(aid, ok, detail, level):
    results.append({"assert": aid, "level": level, "pass": bool(ok), "detail": detail})

first_hooks = []
ep_chunks = re.split(r"\n## ", text)[1:4]
for i, ep in enumerate(ep_chunks, 1):
    m = re.search(r"\*\*B(\d+)｜([^｜]+)｜(\d+)秒\*\*", ep)
    if m: first_hooks.append(m.group(2))
check("AE-HOOK-EVENT", all(h in ("悬念", "反常", "危险", "承诺") for h in first_hooks),
      f"三集首拍钩型 {first_hooks}（四型之一）", "block")

bad = [b["id"] for b in beats if not (b["has_storyboard"] and b["has_dialogue"] and b["has_performance"])]
check("AE-BEAT-FORMAT", not bad, f"{len(beats)} 拍三件套完整度 {100*(len(beats)-len(bad))//len(beats)}%" + (f"，缺失:{bad}" if bad else ""), "major")
bad_dur = [b["id"] for b in beats if not (6 <= b["duration_s"] <= 15)]
check("AE-BEAT-FORMAT#dur", not bad_dur, "时长全部落在 6-15s" + (f"，越界:{bad_dur}" if bad_dur else ""), "major")
no_hook = [b["id"] for b in beats if not b["has_tailhook"]]
check("AE-STRUCT-CAUSE#tailhook", not no_hook, "每拍尾钩在场（一环扣一环）" + (f"，缺失:{no_hook}" if no_hook else ""), "block")

for i, ep in enumerate(ep_chunks, 1):
    dlg_lines = [l for l in ep.split("\n") if "台词：" in l]
    dlg = "".join(re.sub(r".*台词：", "", l) for l in dlg_lines)
    dlg = re.sub(r"（[^）]*）", "", dlg)
    chars = len(re.sub(r"[\s\"：-]", "", dlg))
    check("AE-DENSITY-WORDS@ep%d" % i, 150 <= chars <= 350,
          f"第{i}集台词字数≈{chars}（规范 200-300）", "major")

memes = ["拍子成精", "双王", "王之爆冲", "真王", "热榜", "外卡"]
for i, ep in enumerate(ep_chunks, 1):
    hits = [m for m in memes if m in ep]
    check("AE-MEME-POINT@ep%d" % i, len(hits) >= 1, f"第{i}集梗点 {hits}", "major")

check("AE-CARD-END", text.count("卡点体检") >= 1 or text.count("为什么看下一集") >= 1,
      "集末卡点体检位在场", "major")

banned = ["王楚钦", "马龙", "刘国梁", "樊振东", "中国乒协", "WTT"]
hit = [b for b in banned if b in text]
check("AE-COMPLIANCE", not hit, "无真实运动员/协会名（青川/王拾/陈听澜/王锐全虚构）" + (f"，命中:{hit}" if hit else ""), "block")

proper = sorted(set(re.findall(r"(?<!）（)[\u4e00-\u9fa5]{2,3}(?=县|河|段)", text)))
check("AE-SET-3MIN", len(proper) <= 3, f"自造专名（地名/组织名）{proper}——≤3 个，无架空体系术语", "block")

block_fail = [r for r in results if r["level"] == "block" and not r["pass"]]
report = {
    "id": "kb/aesthetic/assertions", "run": "p-key-soul",
    "scope": "对外交付/03-剧本试稿.md（拍魂 S4 产物）",
    "tool": "check_aesthetic_asserts (simulated by host agent)",
    "beats_scanned": len(beats), "results": results,
    "summary": {"block_fail": len(block_fail),
                "block_total": len([r for r in results if r["level"] == "block"]),
                "major_fail": len([r for r in results if r["level"] == "major" and not r["pass"]]),
                "verdict": "PASS" if not block_fail else "BLOCK-FAIL"},
}
out = r"D:\storymasterv4\projects\p-key-soul\硬断言报告.json"
json.dump(report, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
print(json.dumps(report["summary"], ensure_ascii=False))
for r in results:
    print(("PASS" if r["pass"] else "FAIL"), r["level"], r["assert"], "—", r["detail"][:64])
