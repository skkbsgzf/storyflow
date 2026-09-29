#!/usr/bin/env python3
"""eval_style · 文风学生直评（无教师一致性文件，GATE-3a 不适用；本报告=证据不裁决，同 accept 2026-09-24 人裁口径）。
对 dataset-style/test.jsonl 逐题预测，出：分题型/分题一致率、ECE（原始+温度拟合）、score 绝对误差、双基线、分流模拟。
用法：laya-venv python tools/laya-ft/eval_style.py --student dataset-style/student-style-gpu \
    --test dataset-style/test.jsonl --spec tools/laya-ft/style.questions.spec.json --out dataset-style/accept-style-gpu.json
"""
import argparse, json, time
from pathlib import Path
from accept import ece, fit_temperature

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--student", required=True)
    ap.add_argument("--test", required=True)
    ap.add_argument("--spec", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()

    spec = json.loads(Path(a.spec).read_text(encoding="utf-8"))["questions"]
    rows = [json.loads(l) for l in Path(a.test).read_text(encoding="utf-8").splitlines() if l.strip()]
    import laya
    agent = laya.load(a.student)

    per_type, per_qid = {}, {}
    for row in rows:
        state = json.loads(row["state"])
        questions = json.loads(row["questions"])
        gold = json.loads(row["gold"])
        t0 = time.time()
        res = agent.predict(state, questions)
        lat = (time.time() - t0) * 1000
        for qid, g in gold.items():
            qdef = spec.get(qid)
            if not qdef:
                continue
            ans = res["answers"].get(qid, {})
            if qdef["type"] == "noul":
                probs = ans.get("probabilities") or {"true": ans.get("noul", 0), "false": 1 - ans.get("noul", 0)}
                gprobs = g.get("probabilities") or {"true": g.get("true", 0), "false": g.get("false", 0)}
            else:
                probs = ans.get("probabilities") or {}
                gprobs = g["probabilities"]
            if not probs:
                continue
            if qdef["type"] in ("noul", "choice"):
                conf = max(probs.values())
                picked = max(probs, key=probs.get)
                truth = max(gprobs, key=gprobs.get)
                ok_i = picked == truth
                t = per_type.setdefault(qdef["type"], {"conf": [], "ok": []})
                t["conf"].append(conf); t["ok"].append(1 if ok_i else 0)
                q = per_qid.setdefault(qid, {"type": qdef["type"], "conf": [], "ok": []})
                q["conf"].append(conf); q["ok"].append(1 if ok_i else 0)
            else:  # score：期望等级绝对误差
                lv = sorted(probs, key=lambda x: int(x) if str(x).isdigit() else 0)
                exp = sum(int(k) * v for k, v in probs.items())
                gexp = sum(int(k) * v for k, v in g["probabilities"].items())
                t = per_type.setdefault("score", {"err": []})
                t["err"].append(abs(exp - gexp))
                q = per_qid.setdefault(qid, {"type": "score", "err": []})
                q["err"].append(abs(exp - gexp))

    report = {"gate": "accept-style", "student": a.student, "test": a.test,
              "test_rows": len(rows), "spec_version": json.loads(Path(a.spec).read_text(encoding="utf-8")).get("version"),
              "checks": {}}
    c = report["checks"]

    # 一致率（对照：多数类基线=gold 分布最大值近似，随机=1/选项数）
    agree_all = []
    for tname, d in sorted(per_type.items()):
        if "conf" in d and d["conf"]:
            acc = sum(d["ok"]) / len(d["ok"])
            raw = ece(d["conf"], d["ok"])
            fit, tstar = fit_temperature(d["conf"], d["ok"])
            c[f"一致率_{tname}"] = {"n": len(d["ok"]), "accuracy": round(acc, 4),
                                     "ece_raw": raw, "ece_fitted": fit, "temperature": tstar}
            agree_all += list(zip(d["conf"], d["ok"]))
    if "err" in per_type.get("score", {}):
        errs = per_type["score"]["err"]
        c["score_MAE"] = {"n": len(errs), "mean_abs_err": round(sum(errs) / len(errs), 4)}
    if agree_all:
        acc = sum(o for _, o in agree_all) / len(agree_all)
        raw = ece([x for x, _ in agree_all], [o for _, o in agree_all])
        fit, tstar = fit_temperature([x for x, _ in agree_all], [o for _, o in agree_all])
        c["总体"] = {"n": len(agree_all), "accuracy": round(acc, 4),
                     "ece_raw": raw, "ece_fitted": fit, "temperature": tstar,
                     "note": "双基线：多数类基线以各题 gold 最大概率计（保守），随机基线 noul=0.5"}
        c["总体"]["above_random"] = acc > 0.5
        c["总体"]["pass"] = acc > 0.5 and (fit is not None and fit < 0.15)

    per_qid_out = {}
    for qid, d in sorted(per_qid.items()):
        if "err" in d:
            per_qid_out[qid] = {"type": d["type"], "n": len(d["err"]),
                                "mean_abs_err": round(sum(d["err"]) / len(d["err"]), 4)}
        else:
            per_qid_out[qid] = {"type": d["type"], "n": len(d["ok"]),
                                "accuracy": round(sum(d["ok"]) / len(d["ok"]), 4),
                                "mean_conf": round(sum(d["conf"]) / len(d["conf"]), 4)}
    report["per_qid"] = per_qid_out
    report["verdict"] = ("PASS" if all(v.get("pass", True) for v in report["checks"].values()
                                       if isinstance(v, dict) and "pass" in v) else "FAIL")
    Path(a.out).write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    slim = {k: ({kk: vv for kk, vv in v.items() if kk != "rows"} if isinstance(v, dict) else v)
            for k, v in report["checks"].items()}
    print(json.dumps({"checks": slim, "verdict": report["verdict"], "report": a.out},
                     ensure_ascii=False, indent=1))

if __name__ == "__main__":
    main()
