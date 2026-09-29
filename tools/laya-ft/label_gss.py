#!/usr/bin/env python3
"""label_gss · 教师标注 + GATE-1 自一致性（教师自己都答不稳的题，学生不可能学会）。

教师后端：
  --backend daemon  本机 Qwen3.5-4B 常驻（http://127.0.0.1:8937，流程打通用/第二意见）
  --backend api     OpenAI 兼容强模型（--endpoint/--model/--api-key-env，正式标注用）

每 (案例×问题) 独立采样 K 次（temperature=1.0）→ 频率即软标签分布；
自一致性 = 采样最大频率份额。GATE-1 判定：qid 均值 >0.75 放行 / 0.60-0.75 磨措辞 / <0.60 拆维度。
"""
import argparse, json, os, random, re, sys, threading, time
from concurrent.futures import ThreadPoolExecutor
import urllib.request
from pathlib import Path

HERE = Path(__file__).parent
SPEC = json.loads((HERE / "questions.spec.json").read_text(encoding="utf-8"))

SYS = "你是网文与编剧质量评审教师。只输出 JSON，不输出别的。"

def ask(backend, endpoint, model, key_env, state, qid, qdef):
    if qdef["type"] == "noul":
        schema = f'{{"{qid}": {{"p_true": 0.0到1.0}}}}'
    elif qdef["type"] == "choice":
        opts = ",".join(f'"{k}"' for k in qdef["criteria"])
        schema = f'{{"{qid}": {{"probabilities": {{{opts}: 概率和为1}}}}}}'
    else:
        lv = ",".join(f'"{i}"' for i in range(len(qdef["criteria"])))
        schema = f'{{"{qid}": {{"probabilities": {{{lv}: 概率和为1}}}}}}'
    state_s = json.dumps(state, ensure_ascii=False)
    user = f"评审对象（JSON）：{state_s}\n评审任务：{qdef['instructions']}\n只输出这个形状的 JSON：{schema}"
    if backend == "daemon":
        url = "http://127.0.0.1:8937/v1/chat/completions"
        models = json.loads(urllib.request.urlopen(url.replace("/chat/completions", "/models"), timeout=10).read())["data"]
        body = {"model": models[0]["id"], "messages": [{"role": "system", "content": SYS}, {"role": "user", "content": user}], "temperature": 1.0, "max_tokens": 200}
        hdr = {"content-type": "application/json"}
    else:
        url = endpoint
        hdr = {"content-type": "application/json", "authorization": "Bearer " + os.environ.get(key_env or "", "")}
        # 推理型 API 模型：reasoning 全算进 max_tokens——deepseek-flash ~1300，GLM-5.3 实测更长，
        # 2000 会把 JSON 截断甚至 content 吃空（09-26 冒烟实证），4000 起步
        body = {"model": model, "messages": [{"role": "system", "content": SYS}, {"role": "user", "content": user}], "temperature": 1.0, "max_tokens": 4000}
    req = urllib.request.Request(url, data=json.dumps(body).encode("utf-8"), headers=hdr)
    # 429/5xx 指数退避：推理模型 token 吞吐大（4000/笔），持续并发必撞 TPM 限流——
    # 1s 重试只会烧光 K 个采样预算（09-26 夜跑实证：6 workers 下 95% 组 429 全灭），
    # 撞墙就歇让出窗口，同一采样重试不计失败
    for attempt in range(6):
        try:
            out = json.loads(urllib.request.urlopen(req, timeout=180).read())
            return out["choices"][0]["message"]["content"]
        except urllib.error.HTTPError as e:
            if e.code not in (429, 500, 502, 503, 504) or attempt == 5:
                raise
            time.sleep(min(30 * (attempt + 1) + random.randint(0, 15), 180))
    raise RuntimeError("unreachable")

def parse(content, qid, qdef):
    m = re.search(r"\{[\s\S]*\}", content)
    if not m:
        raise ValueError("无 JSON：" + content[:80])
    j = json.loads(m.group(0))[qid]
    if qdef["type"] == "noul":
        p = max(0.0, min(1.0, float(j["p_true"])))
        return {"true": round(p, 4), "false": round(1 - p, 4)}
    probs = {k: max(0.0, min(1.0, float(v))) for k, v in j["probabilities"].items()}
    s = sum(probs.values()) or 1.0
    return {k: v / s for k, v in probs.items()}

def consistency(dists):
    return sum(max(d.values()) for d in dists) / len(dists)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cases", default="cases.jsonl")
    ap.add_argument("--qids", default="all", help="逗号分隔；缺省=spec 全部")
    ap.add_argument("--samples", type=int, default=5)
    ap.add_argument("--limit", type=int, default=0, help="只标前 N 案例（冒烟）")
    ap.add_argument("--backend", choices=["daemon", "api"], default="daemon")
    ap.add_argument("--seed", type=int, default=20260923, help="分层抽样随机种子")
    ap.add_argument("--endpoint", default="", help="api 后端的 chat/completions 完整 URL")
    ap.add_argument("--model", default="")
    ap.add_argument("--api-key-env", default="TEACHER_API_KEY")
    ap.add_argument("--out", default="labeled.jsonl")
    ap.add_argument("--report", default="gate1-report.json")
    ap.add_argument("--workers", type=int, default=1,
                    help="并发 worker 数（api 后端用；共享写锁，续跑/脏行语义不变）")
    a = ap.parse_args()

    qids = list(SPEC["questions"]) if a.qids in ("all", "") else [q for q in a.qids.split(",") if q]
    cases = [json.loads(l) for l in Path(a.cases).read_text(encoding="utf-8").splitlines() if l.strip()]
    if a.limit:
        # 分层抽样：先按（项目×文件）打散再取前 N，避免 --limit 只吃到单一来源
        rng = random.Random(a.seed)
        by_src = {}
        for c in cases:
            by_src.setdefault((c["project"], c["file"]), []).append(c)
        groups = [v for v in by_src.values()]
        for g in groups:
            rng.shuffle(g)
        interleaved = [c for tup in zip(*[g + [None] * (max(len(x) for x in groups) - len(g)) for g, x in
                                          ((g, g) for g in groups)]) for c in tup if c]
        cases = interleaved[: a.limit]
    print(f"[gss] {len(cases)} 案例 × {len(qids)} 题 × K={a.samples}（backend={a.backend}）", file=sys.stderr)

    rows, per_q, skipped = [], {}, {}
    allfail, last_err_all = {}, {}
    # 断点续跑：out 已有且**干净**（errors==0）的 (case_id, qid) 不重标；
    # errors>0 的脏行（部分样本失败→软标签只剩少数样本，一致性失真）不认领，本轮末尾重写时清除。
    # 新行逐条 append 落盘（长任务崩溃不丢进度）
    out_path = Path(a.out)
    done_keys = set()
    dirty_dropped = 0
    glued_dropped = 0
    if out_path.exists():
        for l in out_path.read_text(encoding="utf-8").splitlines():
            if not l.strip():
                continue
            try:
                r = json.loads(l)
            except json.JSONDecodeError:
                glued_dropped += 1  # 行粘连（旧版无尾换行遗留）或崩溃半行：不认领，组会重标
                continue
            if r.get("errors", 0):
                dirty_dropped += 1
                continue
            rows.append(r)
            done_keys.add((r["case_id"], r["qid"]))
            per_q.setdefault(r["qid"], []).append(r["consistency"])
        if glued_dropped:
            print(f"[gss] 警告：{glued_dropped} 行解析失败被弃（行粘连/半行），对应组本轮重标", file=sys.stderr, flush=True)
        if dirty_dropped:
            print(f"[gss] 清掉脏行 {dirty_dropped} 条（errors>0，一致性不可信），对应组重标", file=sys.stderr, flush=True)
        if done_keys:
            print(f"[gss] 续跑：认领已标 {len(done_keys)} 条", file=sys.stderr, flush=True)
    fh = out_path.open("a", encoding="utf-8")
    todo = sum(1 for c in cases for qid in qids
               if (c["case_id"], qid) not in done_keys
               and not (SPEC["questions"].get(qid, {}).get("needs_pov") and not c["state"].get("视角人物")))
    print(f"[gss] 待标 {todo} 调用组 ×K={a.samples} ≈{todo * a.samples * 6 / 3600:.1f}h（估）", file=sys.stderr, flush=True)
    n_new = 0
    wlock = threading.Lock()

    def process(c, qid, qdef):
        nonlocal n_new
        dists, errs, last_err = [], 0, ""
        for _ in range(a.samples):
            try:
                content = ask(a.backend, a.endpoint, a.model, a.api_key_env, c["state"], qid, qdef)
                dists.append(parse(content, qid, qdef))
            except Exception as e:
                errs += 1
                last_err = f"{type(e).__name__}: {e}"[:120]
                time.sleep(1)
        with wlock:
            if not dists:
                allfail[qid] = allfail.get(qid, 0) + 1
                last_err_all[qid] = last_err
                return
            keys = set().union(*[set(d) for d in dists])
            soft = {k: round(sum(d.get(k, 0) for d in dists) / len(dists), 4) for k in keys}
            cons = max(soft.values())
            row = {"case_id": c["case_id"], "qid": qid, "type": qdef["type"],
                   "state": c["state"], "gold_soft": soft, "consistency": round(cons, 3),
                   "errors": errs, "last_error": last_err}
            per_q.setdefault(qid, []).append(cons)
            rows.append(row)
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")
            fh.flush()
            n_new += 1
            if n_new % 25 == 0:
                print(f"[gss] 本轮新增 {n_new}/{todo}", file=sys.stderr, flush=True)

    jobs = [(c, qid, SPEC["questions"][qid]) for c in cases for qid in qids
            if (c["case_id"], qid) not in done_keys and qid in SPEC["questions"]
            and not (SPEC["questions"][qid].get("needs_pov") and not c["state"].get("视角人物"))]
    print(f"[gss] workers={a.workers}", file=sys.stderr, flush=True)
    if a.workers <= 1:
        for c, qid, qdef in jobs:
            process(c, qid, qdef)
    else:
        with ThreadPoolExecutor(max_workers=a.workers) as ex:
            list(ex.map(lambda j: process(*j), jobs))
    fh.close()

    gate1 = {}
    for qid, cons in per_q.items():
        mean = sum(cons) / len(cons)
        gate1[qid] = {"mean_self_consistency": round(mean, 3), "n": len(cons),
                      "verdict": "pass" if mean > 0.75 else ("polish" if mean >= 0.60 else "split")}
    report = {"gate": "GATE-1", "thresholds": {"pass": ">0.75", "polish": "0.60-0.75", "split": "<0.60"},
              "questions": gate1,
              "skipped_no_evidence_field": skipped,
              "all_samples_failed": {qid: {"n": v, "last_error": last_err_all.get(qid, "")}
                                     for qid, v in allfail.items()},
              "note": "split 的 qid：拆成可检查子维度后以新 qid 重走，qid 不复用；"
                      "skipped_* 非空 = 该题证据字段缺失（state_builder 未注入），不算未通过；"
                      "all_samples_failed 非空 = 教师调用全败（接口/配额问题），该组未标不是教师分歧"}
    Path(a.report).write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    # 尾换行必须有：下一 pass 以 append 续写，缺它会把两行粘成一行，
    # 续跑认领时 json.loads 静默丢组（09-27 夜跑实证）
    Path(a.out).write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + ("\n" if rows else ""), encoding="utf-8")
    if allfail:
        print(f"[gss] 警告：{sum(allfail.values())} 组五样本全败未标（见报告 all_samples_failed），"
              f"GATE-1 结论按残缺数据算，先修接口再重跑", file=sys.stderr, flush=True)
    print(json.dumps(report, ensure_ascii=False, indent=1))

if __name__ == "__main__":
    main()
