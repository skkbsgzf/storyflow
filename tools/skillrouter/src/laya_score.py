#!/usr/bin/env python3
"""laya_score · skillrouter laya-v1 引擎的打分 runner（python 侧）。

stdin:  {"request": "...", "context": "...", "tools": [{"id": "...", "description": "..."}]}
stdout: {"scores": {"tool_id": 0.0-1.0, ...}}

单次前向给全部工具打分（Laya 非自回归：问题数只增加 mask 位，几乎不增加耗时）。
模型/子目录经环境变量 LAYA_MODEL_DIR / LAYA_SUBFOLDER 配置（默认官方 multilingual）。
"""
import json, os, sys

# stdout 只允许最终 JSON：HF 下载进度条与断线重试日志必须抑制，
# 否则 engines.mjs 对 stdout 的 JSON 解析被污染 → 引擎假性失败回落。
os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")

def main():
    payload = json.loads(sys.stdin.read())
    request = str(payload.get("request", ""))
    context = str(payload.get("context", ""))
    tools = payload.get("tools") or []

    import laya
    model_dir = os.environ.get("LAYA_MODEL_DIR", "convaiinnovations/laya")
    subfolder = os.environ.get("LAYA_SUBFOLDER", "multilingual")
    agent = laya.load(model_dir, subfolder=subfolder) if subfolder else laya.load(model_dir)

    questions = {}
    for t in tools:
        tid = t["id"]
        desc = str(t.get("description", "")).strip()
        # 工具功能描述必须进题面：缺了 = 模型只看 id 盲猜（主线首版实测全池平庸分的根因）。
        # 原语选 score 而非 noul（09-24 双原语同卷实测）：score 排序正确（扫描任务
        # quality_scan 稳居第一），noul 排序噪声大（扫描题 snapshot 登顶）；量纲由归一解决。
        questions[tid] = {
            "type": "score",
            "instructions": f"待评估工具：{tid}。功能：{desc or '（无描述）'}。请评估该工具对完成上述任务的必要性。",
            "criteria": ["完全不相关", "边缘相关", "直接相关", "不可或缺"],
        }
    state = f"任务：{request}\n上下文：{context or '（无）'}"
    res = agent.predict(state, questions)

    scores = {}
    for tid, a in (res.get("answers") or {}).items():
        probs = a.get("probabilities") or {}
        lv = [float(probs.get(k, 0)) for k in ("0", "1", "2", "3")]
        s = sum(lv)
        scores[tid] = (lv[2] + lv[3] * 1.5 + lv[1] * 0.3) / s if s else 0.0
    # 池内最大值归一（建议制分档是相对的）：top 工具 ≈1.0，其余按序比例——
    # 修 raw 期望等级绝对值偏低（0.1-0.35）够不着分档线的量纲问题。
    mx = max(scores.values()) if scores else 0.0
    if mx > 0:
        scores = {k: round(v / mx, 3) for k, v in scores.items()}
    print(json.dumps({"scores": scores}))

if __name__ == "__main__":
    main()
