#!/usr/bin/env python3
"""laya_judge · Laya 学生判官 CLI：一个文本 × 全部 noul 条款 → 类型化判定 JSON。

供 storyharness 驱动器在环调用（每节一次，进程内装载一次判全部）。
判据 = questions.spec（v0.3+）全部 noul 题；state 字段由调用方按 spec 的
state_requires 组装（缺字段=该题跳过并显式回显，不猜值）。

用法：
  laya-venv python tools/laya-ft/laya_judge.py --student runs/laya-run-0923/student-v3 \
      --spec tools/laya-ft/questions.spec.json --state state.json [--threshold 0.5]
输出（stdout JSON）：{"answers": {qid: p_true}, "flagged": [qid], "threshold": 0.5,
                      "skipped": {qid: 原因}, "checkpoint": ...}
"""
import argparse, contextlib, io, json, sys
from pathlib import Path

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--student", required=True)
    ap.add_argument("--spec", default=str(Path(__file__).parent / "questions.spec.json"))
    ap.add_argument("--state", required=True, help="state JSON 文件（场景文本等字段）")
    ap.add_argument("--threshold", type=float, default=0.5)
    a = ap.parse_args()

    # stdout 契约：整进程只允许最后一份 JSON 落 stdout——import/装载/前向期任何库级
    # 打印（mcp/OTel 横幅）一律转 stderr，调用方按「最后一个完整 JSON 对象」解析兜底。
    sink = sys.stderr
    with contextlib.redirect_stdout(sink):
        import laya
        agent = laya.load(a.student)
    spec = json.loads(Path(a.spec).read_text(encoding="utf-8"))
    state = json.loads(Path(a.state).read_text(encoding="utf-8"))

    questions, skipped = {}, {}
    for qid, q in spec["questions"].items():
        if q["type"] != "noul":
            continue
        missing = [f for f in q.get("state_requires", []) if not state.get(f)]
        if missing:
            skipped[qid] = "缺 state 字段：" + ",".join(missing)
            continue
        questions[qid] = {"type": "noul", "instructions": q["instructions"]}

    if not questions:
        print(json.dumps({"answers": {}, "flagged": [], "skipped": skipped,
                          "note": "无可判 noul 题（state 字段不足）"}, ensure_ascii=False))
        return

    with contextlib.redirect_stdout(sink):
        res = agent.predict(state, questions)
    answers, flagged = {}, []
    for qid in questions:
        p = float(res["answers"].get(qid, {}).get("noul", 0.0))
        answers[qid] = round(p, 4)
        if p >= a.threshold:
            flagged.append(qid)
    print(json.dumps({
        "answers": answers, "flagged": flagged, "threshold": a.threshold,
        "skipped": skipped,
        "checkpoint": a.student,
        "disclaimer": "学生判官输出仅为复核优先级证据，不构成放行/拦截（P 值纪律）",
    }, ensure_ascii=False))

if __name__ == "__main__":
    main()
