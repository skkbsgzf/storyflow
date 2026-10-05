# -*- coding: utf-8 -*-
# 推演引擎 A 期冒烟（玩小说）：树语义（branch/存档）+ 属性 effects + 既有全流程。
# 用法：python smoke-deduce.py [port]  ——对 template-推演（首次写面会自动 materialize）。
import json, sys, time, urllib.request, urllib.parse, urllib.error

PORT = sys.argv[1] if len(sys.argv) > 1 else "8434"
B = f"http://127.0.0.1:{PORT}/api/deduce/"
PID = "template-推演"
CS = r"D:\storymasterv4\projects\template-推演\推演\clickstream.jsonl"

def call(path, body=None, method="POST"):
    if method == "GET":
        req = urllib.request.Request(B + f"{path}?project={urllib.parse.quote(PID)}" + (f"&{body}" if body else ""))
    else:
        req = urllib.request.Request(B + path, data=json.dumps({"project": PID, **(body or {})}).encode("utf-8"),
                                     headers={"Content-Type": "application/json; charset=utf-8"})
    t = time.time()
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            d = json.load(r)
    except urllib.error.HTTPError as e:
        d = json.load(e)
    return d, time.time() - t

ok = True
def check(name, cond, detail=""):
    global ok
    print(("  PASS " if cond else "  FAIL ") + name + (f" | {detail}" if detail else ""))
    if not cond: ok = False

try:
    MARK = sum(1 for _ in open(CS, encoding="utf-8"))
except FileNotFoundError:
    MARK = 0

print("== G0. 页面 JS 语法 GATE")
import subprocess, re as _re, urllib.request as _u
_html = _u.urlopen(f"http://127.0.0.1:{PORT}/deduce", timeout=30).read().decode("utf-8")
_i = _html.find('<script>')
_j = _html.rfind('</script>')
open(r'D:\storymasterv4\storyharness\probe-live.js', 'w', encoding='utf-8').write(_html[_i + 8:_j])
_g = subprocess.run(["node", "--check", r"D:\storymasterv4\storyharness\probe-live.js"], capture_output=True, text=True)
check("页面 JS 语法合法", _g.returncode == 0, (_g.stderr or "ok").strip()[:120])

import shutil, os as _os
CANON = "D:/storymasterv4/storyharness/packs/deduce/templates/template-推演/推演/script.json"
LIVE = "D:/storymasterv4/projects/template-推演/推演/script.json"
if _os.path.exists(LIVE) and "退婚宴" not in open(LIVE, encoding="utf-8").read():
    _os.makedirs(_os.path.dirname(LIVE), exist_ok=True)
    shutil.copyfile(CANON, LIVE)
    print("  （剧本曾被 import 换掉——已从包内正典还原）")
print("== 0. reset + state（空场）")
call("reset")
d, _ = call("state", method="GET")
check("state 200 + 空场", d.get("title") == "第一章 · 退婚宴" and len(d.get("beats", [])) == 0)
check("A 期字段齐", all(k in d for k in ("attributes", "bookmarks", "tree")), str(sorted(d.keys()))[:80])

print("== 1. next（effects 提议 + 四象限 + 打分）")
d, dt = call("next")
p = d.get("pending") or {}
check("pending 生成", bool(p), json.dumps({k: d.get(k) for k in ("error", "degraded")}, ensure_ascii=False)[:120])
if p:
    check("stimulus 结构化", "line" in (p.get("stimulus") or {}))
    check("开场保真", p["stimulus"]["line"].startswith("沈志远举杯"), p["stimulus"]["line"][:36])
    check("四象限 4 候选", len(p["options"]) == 4 and {o["kind"] for o in p["options"]} == {"推进", "回避", "意外", "自由"})
    fx = p["options"][0].get("effects") or {}
    check("effects 提议在列", len(fx) > 0, json.dumps(fx, ensure_ascii=False)[:80])
    check("effects 归一（|Δ|≤15）", all(abs(v) <= 15 for o in p["options"] for v in (o.get("effects") or {}).values()))

print("== 2. choose（属性落账）→ next")
d2, _ = call("choose", {"id": p["options"][0]["id"]})
check("applied 回显", isinstance(d2.get("applied"), dict) and len(d2["applied"]) > 0, json.dumps(d2.get("applied"), ensure_ascii=False)[:80])
d, _ = call("state", method="GET")
check("attributes 结算", any(abs(v - 30) > 0 for v in (d.get("attributes") or {}).values()), json.dumps(d.get("attributes"), ensure_ascii=False)[:100])
check("树有 1 节点", len(d.get("tree", [])) == 1)
d, _ = call("next")
p2 = d.get("pending") or {}
check("第2拍生成", bool(p2))
if d.get("ask"):
    call("probe", {"pick": 0})

print("== 3. 存档 → 再推一拍 → 读档（树指针回跳）")
d, _ = call("save", {"name": "冒烟档"})
check("save ok", d.get("ok") and "冒烟档" in (d.get("bookmarks") or []))
d, _ = call("state", method="GET")
n_before = len(d.get("beats", []))
call("choose", {"custom": "把账算清楚。"})
d, _ = call("state", method="GET")
check("custom 已定为下一拍", len(d.get("beats", [])) == n_before + 1, str(n_before) + "->" + str(len(d.get("beats", []))))
d, _ = call("load", {"name": "冒烟档"})
check("load ok", d.get("ok"))
d, _ = call("state", method="GET")
check("读档回到存档拍", len(d.get("beats", [])) == n_before, str(len(d.get("beats", []))))
check("树节点保留（不删支线）", len(d.get("tree", [])) >= n_before + 1, str(len(d.get("tree", []))))

print("== 4. branch（从任意节点重推）")
side = [t for t in d.get("tree", []) if not t.get("onChain")]
check("存在支线节点", len(side) > 0)
if side:
    d, _ = call("branch", {"node": side[0]["id"]})
    check("branch ok", d.get("ok"))
    d, _ = call("state", method="GET")
    check("切到支线", any(t["id"] == side[0]["id"] and t.get("onChain") for t in d.get("tree", [])))

print("== 5. draft 纯正文 + 笔记本")
call("next")
d, _ = call("state", method="GET")
if d.get("pending"):
    call("choose", {"id": d["pending"]["options"][0]["id"]})
d, dt = call("draft")
txt = d.get("text", "")
check("draft ok", d.get("ok"), json.dumps({k: d.get(k) for k in ("error",)}, ensure_ascii=False)[:100])
if txt:
    bad = [w for w in ["opt-", "综合", "好感度", "打分", "第1拍", "OOC"] if w in txt]
    check("正文纯净（无属性/分数）", not bad, f"命中:{bad}" if bad else f"{len(txt)}字")
call("notes", {"text": "A 期冒烟笔记。"})
d, _ = call("state", method="GET")
check("notes 回读", "A 期冒烟笔记" in (d.get("notes") or ""))

print("== 6. asset 白名单 + 生图 seam 显式报缺")
d, _ = call("asset", "file=" + urllib.parse.quote("portrait-沈青梧.png"), method="GET")
check("缺图显式 404", d.get("error") == "NO_ASSET")
d, _ = call("asset", "file=..%2Fscript.json", method="GET")
check("路径穿越拒绝", "非法" in d.get("error", ""), d.get("error", ""))
d, _ = call("image", {"kind": "portrait", "name": "沈青梧"})
check("image 显式报缺或成功", d.get("ok") or ("生图" in d.get("error", "") or "ComfyUI" in d.get("error", "")), d.get("error", "")[:80])

print("== 7. import 替换剧本")
d, _ = call("import", {"mode": "settings", "text": "【mock设定】古风世家夺产故事：沈青梧之父亡故半年，股份被二叔沈志远代持侵吞。青梧手握亡父手记与账册把柄，志远拉拢周家逼婚改立。本场景=老宅书房夜谈对质，各有底牌，一触即发。", "target_beats": 8})
check("import ok", d.get("ok"), json.dumps({k: d.get(k) for k in ("error",)}, ensure_ascii=False)[:100])
d, _ = call("state", method="GET")
check("场景清零", len(d.get("beats", [])) == 0)

print("== 8. 留档核验（本轮新增）")
lines = [json.loads(x) for x in open(CS, encoding="utf-8")][MARK:]
check("clickstream 有账", len(lines) >= 8, f"本轮 {len(lines)} 条")
check("R8 形状全带", all("by" in x and "evidence" in x for x in lines), json.dumps(sorted({x['kind'] for x in lines}), ensure_ascii=False))

print()
print("SMOKE " + ("PASS" if ok else "FAIL"))
sys.exit(0 if ok else 1)
