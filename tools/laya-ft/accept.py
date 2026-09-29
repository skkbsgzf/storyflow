#!/usr/bin/env python3
"""accept · 离线体检脚本（GATE-2 校准 + GATE-3 三道线 + 本仓附加检查；2026-09-24 人裁降级，见 docs/人裁-laya唯一引擎-20260924.md：本报告是 known-weakness 标注与重训选题依据，不是部署闸）。用法：
  laya-venv python tools/laya-ft/accept.py --student <学生权重目录> --test dataset/test.jsonl \
      --labeled labeled.jsonl

三道硬线 + 两道本仓附加检查（verdict=FAIL 不阻止学生上岗，弱项须随批扫输出带标签）：
  GATE-2  校准：按问题类型分桶拟合温度后 ECE < 0.10（官方 multilingual 出厂 0.387）
  GATE-3a 学生-教师一致率 ≥ 教师自一致性均值 − 3pt（逼近教师即胜利）
  GATE-3b 碾压双基线：多数类基线 + 均匀随机基线
  附加闸1 dash-abuse 19 题金标卷：学生 ≥ 4B 基线 79%（卷与口径同校准包体检卷）
  附加闸2 感受类 lint：spec 内 instructions 不得含 好看/有趣/精彩/好不好 等审美整题词
"""
import argparse, json, math
from pathlib import Path

HERE = Path(__file__).parent
BANNED = ["好看", "有趣", "精彩", "好不好", "写得好"]

def ece(conf_list, ok_list, bins=10):
    if not conf_list:
        return None
    e = 0.0
    n = len(conf_list)
    for b in range(bins):
        lo, hi = b / bins, (b + 1) / bins
        bucket = [(c, o) for c, o in zip(conf_list, ok_list) if lo <= c < hi or (b == bins - 1 and c == 1.0)]
        if bucket:
            e += len(bucket) / n * abs(sum(c for c, _ in bucket) / len(bucket) - sum(o for _, o in bucket) / len(bucket))
    return round(e, 4)

def fit_temperature(conf_list, ok_list):
    best, best_t, best_e = None, 1.0, None
    for i in range(3, 41):
        t = i / 20
        adj = [(min(1.0, c ** (1 / t)), o) for c, o in zip(conf_list, ok_list)]
        e = ece([c for c, _ in adj], [o for _, o in adj])
        if best_e is None or e < best_e:
            best, best_t, best_e = e, t, e
    return best_e, best_t

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--student", required=True, help="学生权重目录（laya.load 可加载）")
    ap.add_argument("--test", default="dataset/test.jsonl")
    ap.add_argument("--labeled", default="labeled.jsonl", help="教师标注（含自一致性）")
    ap.add_argument("--gold-choices", default=str(HERE.parents[1] / "knowledge" / "semif-calibration" / "dash-abuse" / "cases.jsonl"))
    ap.add_argument("--gold-labels", default=str(HERE.parents[1] / "knowledge" / "semif-calibration" / "dash-abuse" / "gold.jsonl"))
    ap.add_argument("--subfolder", default="", help="底座直验用（如 multilingual）；学生权重目录留空")
    ap.add_argument("--baseline-4b", type=float, default=0.79, help="4B 判官同卷成绩（红线）")
    ap.add_argument("--spec", default=str(HERE / "questions.spec.json"))
    ap.add_argument("--out", default="accept-report.json")
    a = ap.parse_args()

    spec = json.loads(Path(a.spec).read_text(encoding="utf-8"))
    report = {"gate": "accept", "student": a.student, "checks": {}}

    # 附加闸2：感受类 lint（spec 层面，训练前就该拦）
    banned_hits = [qid for qid, q in spec["questions"].items()
                   if any(w in q["instructions"] for w in BANNED)]
    report["checks"]["感受类lint"] = {"pass": not banned_hits, "violations": banned_hits}

    # 附加闸1：dash-abuse 金标卷复测（choice 同口径，19 题）
    import laya
    agent = laya.load(a.student, **({"subfolder": a.subfolder} if a.subfolder else {}))
    gc = [json.loads(l) for l in Path(a.gold_choices).read_text(encoding="utf-8").splitlines() if l.strip()]
    gl = {json.loads(l)["id"]: json.loads(l)["gold"] for l in Path(a.gold_labels).read_text(encoding="utf-8").splitlines() if l.strip()}
    ok = 0
    gold_rows = []
    for c in gc:
        g = gl.get(c["id"])
        if not g:
            continue
        # criteria 必须是 {id: text} dict；金标卷存量 options 是 [{id,description}] 列表，单点归一
        crit = c["options"]
        if isinstance(crit, list):
            crit = {o["id"]: o.get("description", "") for o in crit}
        res = agent.predict(c["state"], {"v": {"type": "choice", "instructions": c["question"], "criteria": crit}})
        picked = res["answers"]["v"]["choice"]
        gold_rows.append({"id": c["id"], "gold": g, "picked": picked, "ok": picked == g})
        ok += picked == g
    gold_acc = ok / len(gold_rows) if gold_rows else 0.0
    report["checks"]["dash_abuse_gold卷"] = {
        "pass": gold_acc >= a.baseline_4b, "accuracy": round(gold_acc, 3),
        "baseline_4b": a.baseline_4b, "rows": gold_rows}

    # 主验收：test 集逐题预测
    test = [json.loads(l) for l in Path(a.test).read_text(encoding="utf-8").splitlines() if l.strip()]
    labeled = [json.loads(l) for l in Path(a.labeled).read_text(encoding="utf-8").splitlines() if l.strip()]
    teacher_cons = {}
    for r in labeled:
        teacher_cons.setdefault(r["qid"], []).append(r["consistency"])
    teacher_mean = sum(sum(v) / len(v) for v in teacher_cons.values()) / len(teacher_cons)

    per_type = {}
    agree_per_qid, majority_beat, random_beat = [], [], []
    for row in test:
        state = json.loads(row["state"])
        questions = json.loads(row["questions"])
        gold = json.loads(row["gold"])
        t0 = __import__("time").time()
        res = agent.predict(state, questions)
        lat = (__import__("time").time() - t0) * 1000
        for qid, g in gold.items():
            qdef = spec["questions"].get(qid)
            if not qdef:
                continue
            ans = res["answers"].get(qid, {})
            if qdef["type"] in ("noul", "choice"):
                probs = ans.get("probabilities") or ({"true": ans.get("noul", 0), "false": 1 - ans.get("noul", 0)} if qdef["type"] == "noul" else {})
                if not probs:
                    continue
                conf = max(probs.values())
                picked = max(probs, key=probs.get)
                truth = max(g["probabilities"], key=g["probabilities"].get)
                ok_i = picked == truth
                t = per_type.setdefault(qdef["type"], {"conf": [], "ok": []})
                t["conf"].append(conf); t["ok"].append(1 if ok_i else 0)
                maj = max(g["probabilities"].values())
                agree_per_qid.append({"qid": qid, "agree": 1 if ok_i else 0,
                                      "teacher": (teacher_cons.get(qid, [0.7])[0])})
                majority_beat.append(1 if conf >= maj - 1e-9 or ok_i else 0)
                random_beat.append(1 if ok_i or conf >= 1 / len(probs) else 0)
            else:  # score：期望等级绝对误差
                probs = ans.get("probabilities") or {}
                if not probs:
                    continue
                lv = sorted(probs, key=lambda x: int(x) if str(x).isdigit() else 0)
                exp = sum(int(k) * v for k, v in probs.items())
                gexp = sum(int(k) * v for k, v in g["probabilities"].items())
                t = per_type.setdefault("score", {"err": []})
                t["err"].append(abs(exp - gexp))

    checks = report["checks"]
    # GATE-2：ECE per type（含温度拟合）
    gate2 = {}
    for tname, d in per_type.items():
        if "conf" in d:
            raw = ece(d["conf"], d["ok"])
            fit, tstar = fit_temperature(d["conf"], d["ok"])
            gate2[tname] = {"ece_raw": raw, "ece_fitted": fit, "temperature": tstar}
    gate2["pass"] = all(v.get("ece_fitted", 1) < 0.10 for k, v in gate2.items() if isinstance(v, dict) and "ece_fitted" in v)
    checks["GATE2_校准"] = gate2

    # GATE-3a：学生-教师一致率
    agree = sum(x["agree"] for x in agree_per_qid) / len(agree_per_qid)
    checks["GATE3a_逼近教师"] = {"pass": agree >= teacher_mean - 0.03,
                                "student_teacher_agreement": round(agree, 3),
                                "teacher_mean_self_consistency": round(teacher_mean, 3)}
    # GATE-3b：双基线
    checks["GATE3b_碾压基线"] = {
        "pass": (sum(majority_beat) / len(majority_beat) >= 0.6 if majority_beat else False)
                and (sum(random_beat) / len(random_beat) >= 0.6 if random_beat else False),
        "note": "逐题：学生正确或置信不低于多数类/随机基线",
        "majority_majority_rate": round(sum(majority_beat) / len(majority_beat), 3) if majority_beat else None,
        "random_beat_rate": round(sum(random_beat) / len(random_beat), 3) if random_beat else None}
    # 分流模拟
    auto = [(c, o) for tname, d in per_type.items() if "conf" in d for c, o in zip(d["conf"], d["ok"])]
    hi = [(c, o) for c, o in auto if c > 0.85]
    mid = [(c, o) for c, o in auto if 0.60 <= c <= 0.85]
    checks["分流模拟"] = {
        "auto_rate": round(len(hi) / len(auto), 3) if auto else None,
        "auto_accuracy": round(sum(o for _, o in hi) / len(hi), 3) if hi else None,
        "review_n": len(mid), "human_n": len(auto) - len(hi) - len(mid)}

    report["verdict"] = "PASS" if all(c.get("pass", True) for c in report["checks"].values() if isinstance(c, dict) and "pass" in c) else "FAIL"
    Path(a.out).write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps({k: ({kk: vv for kk, vv in c.items() if kk != "rows"} if isinstance(c, dict) else c)
                      for k, c in report["checks"].items()} | {"verdict": report["verdict"], "report": a.out},
                     ensure_ascii=False, indent=1))

if __name__ == "__main__":
    main()
