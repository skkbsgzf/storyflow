# -*- coding: utf-8 -*-
# 推演引擎 v2 全流程冒烟（galgame 化）：next(结构化stimulus) → choose → probe → custom → reroll/rollback
# → draft(纯正文) → notes → asset白名单 → image显式报缺 → import(替换剧本)
# 用法：python storyharness/packs/deduce/tools/smoke-deduce.py [port] [project]
#   （波14 批2 起本件从包 templates/ 挪到包 tools/：模板只留出厂三件 script.json/README/mock-llm.py，
#    运行留档不再随包走——见 docs/交接回执-波14推演模板落地与扩展包面板）
import json, os, sys, time, urllib.request, urllib.parse, urllib.error

PORT = sys.argv[1] if len(sys.argv) > 1 else "8434"
PID = sys.argv[2] if len(sys.argv) > 2 else "template-推演"
B = f"http://127.0.0.1:{PORT}/api/deduce/"
# 留档计数按被试项目定位（script 在 <ws>/projects/<pid>/推演/ 或包 templates 下同一落位规则）
# 缺省打本仓 projects/ 下的被试项目；隔离工作区用 SMOKE_PROJECT_ROOT 指过去。
# 注意：模板项目（template-*）在包内是只读的，冒烟打的应当是它「首写落地」后的工作区副本。
PROJ_ROOT = os.environ.get("SMOKE_PROJECT_ROOT") or os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", "projects"))
CS = os.path.join(PROJ_ROOT, PID, "推演", "clickstream.jsonl")

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

print("== 0. reset + state（空场）")
call("reset")
d, _ = call("state", method="GET")
check("state 200 + 空场", d.get("title") == "第一章 · 退婚宴" and len(d.get("beats", [])) == 0)
check("v2 字段齐", all(k in d for k in ("notes", "assets", "imageBackend", "premise", "characters")), d.get("imageBackend", "?"))
check("模型身份显式", d.get("model"), str(d.get("model")))

print("== 1. next（结构化 stimulus + 四象限 + 打分）")
d, dt = call("next")
p = d.get("pending") or {}
check("pending 生成", bool(p), json.dumps({k: d.get(k) for k in ("error", "degraded")}, ensure_ascii=False)[:150])
if p:
    st = p["stimulus"]
    check("stimulus 结构化", isinstance(st, dict) and "line" in st, json.dumps(st, ensure_ascii=False)[:80])
    check("开场保真", st.get("line", "").startswith("沈志远举杯"), st.get("line", "")[:40])
    check("4 候选四象限", len(p["options"]) == 4 and {o["kind"] for o in p["options"]} == {"推进", "回避", "意外", "自由"})
    check("四维分齐全", all(o.get("score") and o["score"]["composite"] > 0 for o in p["options"]))

print("== 2. choose + next（第2拍）")
call("choose", {"id": p["options"][0]["id"]})
d, dt = call("next")
p2 = d.get("pending") or {}
check("第2拍 stimulus 推进", bool(p2) and "开场" not in p2["stimulus"]["line"][:20], (p2.get("stimulus", {}).get("line", "") or "")[:40])
if d.get("ask"):
    d2, _ = call("probe", {"pick": 0})
    check("probe 提交", d2.get("ok"))

print("== 3. custom / reroll / rollback")
d, _ = call("choose", {"custom": "沈青梧：把账算清楚。"})
check("自写采纳", d.get("ok"))
call("next")
d, _ = call("rollback"); check("reroll ok", d.get("ok"))
d, _ = call("rollback"); check("rollback 退拍", d.get("ok"))
d, _ = call("state", method="GET")
check("回到第1拍", len(d.get("beats", [])) == 1, str(len(d.get("beats", []))))

print("== 4. 补拍 + draft 纯正文")
call("next")
d, _ = call("state", method="GET")
call("choose", {"id": d["pending"]["options"][0]["id"]})
d, dt = call("draft")
txt = d.get("text", "")
check("draft ok", d.get("ok"), json.dumps({k: d.get(k) for k in ("error",)}, ensure_ascii=False)[:120])
if txt:
    bad = [w for w in ["opt-", "综合", "人设一致性", "打分", "第1拍", "OOC"] if w in txt]
    check("正文纯净", not bad, f"命中:{bad}" if bad else f"{len(txt)}字")

print("== 5. 笔记本")
d, _ = call("notes", {"text": "冒烟笔记：第3拍要回收那把刀。"})
check("notes 保存", d.get("ok"))
d, _ = call("state", method="GET")
check("notes 回读", "回收那把刀" in (d.get("notes") or ""))

print("== 6. asset 白名单")
d, _ = call("asset", "file=" + urllib.parse.quote("portrait-沈青梧.png"), method="GET")
check("缺图显式 404", d.get("error") == "NO_ASSET")
d, _ = call("asset", "file=..%2Fscript.json", method="GET")
check("路径穿越拒绝", d.get("error") and "非法" in d.get("error", ""), d.get("error", ""))

print("== 7. 生图 seam（ComfyUI 不在线 → 显式报缺）")
d, dt = call("image", {"kind": "portrait", "name": "沈青梧"})
err = d.get("error", "")
check("image 显式报缺或成功", d.get("ok") or ("生图" in err or "ComfyUI" in err or "超时" in err), err[:100])

print("== 8. import（小说/设定 → 替换剧本）")
d, dt = call("import", {"mode": "settings", "text": "【mock设定】古风世家夺产故事：沈青梧之父亡故半年，股份被二叔沈志远代持侵吞。青梧手握亡父手记与账册把柄，志远拉拢周家逼婚改立。本场景=老宅书房夜谈对质，各有底牌，一触即发。", "target_beats": 8})
check("import ok", d.get("ok"), json.dumps({k: d.get(k) for k in ("error",)}, ensure_ascii=False)[:120])
if d.get("ok"):
    sc = d.get("script", {})
    check("新剧本就位", sc.get("title") == "第二章 · 灯下对质", str(sc.get("title")))
    check("style 提炼", bool(sc.get("style")), str(sc.get("style")))
d, _ = call("state", method="GET")
check("场景清零", len(d.get("beats", [])) == 0)

print("== 9. 留档核验（本轮新增）")
lines = [json.loads(x) for x in open(CS, encoding="utf-8")][MARK:]
check("clickstream 有账", len(lines) >= 8, f"本轮 {len(lines)} 条")
check("R8 形状全带", all("by" in x and "evidence" in x for x in lines), json.dumps([x["kind"] for x in lines], ensure_ascii=False))

print()
print("SMOKE " + ("PASS" if ok else "FAIL"))
sys.exit(0 if ok else 1)
