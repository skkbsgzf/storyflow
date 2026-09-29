#!/usr/bin/env python3
"""laya-scan · 条款批扫唯一引擎位 = laya 学生头（2026-09-24 人裁：laya 唯一引擎，4B 永不兜底；学生上岗无过闸前置）。

口径（docs/人裁-laya唯一引擎-20260924.md）：
  - 生产扫描 = 本地学生（默认 runs/laya-run-0923/student-v3，laya.load 直载）。
  - 学生不可用（venv 缺 / 权重缺 / 加载失败）= 显式失败 exit 2，停下报缺等人裁决；本脚本无任何 4B/API 回落路径。
  - 输出 = 复核优先级证据（problem_p 只排序不做闸）；accept 体检已知弱项随输出带 known_weakness 标签。
  - 师生输入同构：案例组装复用 tools/laya-ft/state_builder.py（与教师标注同一组装器）。

并行口径（2026-09-24 深夜反转定稿）：
  - 本机有 GPU：RTX A4500 Laptop 15GB（驱动 CUDA 12.8）。早前「CPU-only 并行不省墙钟」的全部实测，
    根因是 laya-venv 装了 cpu 轮子——换装 torch 2.14.0+cu126 后 laya.load 自动上卡（权重 1.23GB 显存）。
  - GPU 快路径 = 同题集分组 predict_batch 打包：16 案×13 题扫描 4.0s（CPU 串行 203.0s → 50 倍）；
    数值差异仅 bf16 噪声级（max|Δp| 0.0114，top40 重合 38/40，均为差值 <0.01 的近并列换位）。
  - 无 CUDA/驱动异常 → 自动回落 CPU 逐案 predict；CPU 机提速可试 --workers N 多进程分片
    （内存封顶+错峰+被杀兜底），但本机 CPU 轮实测并行不省墙钟（203≈206≈210s）、打包反慢（564s），
    这两条留给外机参考。

用法（任意 python 均可，内部自动切 laya-venv 解释器）：
  python tools/laya-scan.py --project p-kunxiu-002 --file 05-底座/终稿抽样.md \
      [--chunk 500] [--pov 林寻] [--personas a,b] [--student <目录>] [--out <证据json>] \
      [--clauses qid,qid] [--workers N]
"""
import json, os, subprocess, sys, time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
VENV_PY = ROOT / "tools" / "_vendor" / "laya-venv" / "Scripts" / "python.exe"
DEFAULT_STUDENT = ROOT / "runs" / "laya-run-0923" / "student-v3"
SPEC_PATH = HERE / "laya-ft" / "questions.spec.json"
TMP_DIR = ROOT / "runs" / "laya-scan-tmp"

# GATE-1 v0.3 放行的可扫题（split 题不扫，与教师 pilot 同名单；qid→题面见 spec）
PASSES = [
    "semif.pov-leak.v1.noul", "slop.ai-trace.v2.noul", "craft.sensory-concrete.v1.noul",
    "aesthetic.conflict-clear.v1.noul", "aesthetic.dialogue-push.v1.noul", "craft.ending-hook.v1.noul",
    "semif.dash-abuse.v1.choice", "aesthetic.dialogue-defect.v1.choice", "slop.neg-pattern.v1.noul",
    "slop.reveal-stack.v1.noul", "craft.simile-suspend.v1.noul", "aesthetic.scene-value.v1.choice",
    "craft.daisy-chain.v1.noul",
]
# 每题"有问题"方向（与教师 pilot 同映射；缺失型题取 false）
PROBLEM = {
    "semif.pov-leak.v1.noul": ("noul", "true"),
    "slop.ai-trace.v2.noul": ("noul", "true"),
    "craft.sensory-concrete.v1.noul": ("noul", "false"),
    "aesthetic.conflict-clear.v1.noul": ("noul", "false"),
    "aesthetic.dialogue-push.v1.noul": ("noul", "false"),
    "craft.ending-hook.v1.noul": ("noul", "false"),
    "slop.neg-pattern.v1.noul": ("noul", "true"),
    "slop.reveal-stack.v1.noul": ("noul", "true"),
    "craft.simile-suspend.v1.noul": ("noul", "true"),
    "craft.daisy-chain.v1.noul": ("noul", "true"),
    "semif.dash-abuse.v1.choice": ("choice", "yes"),
    "aesthetic.dialogue-defect.v1.choice": ("choice", ["exposition", "pingpong", "onNose"]),
    "aesthetic.scene-value.v1.choice": ("choice", "none"),
}
# accept 体检（runs/laya-run-0923/accept-report-v03.json）已知弱项——随输出如实标注，不构成拦截
KNOWN_WEAKNESS = {"semif.dash-abuse.v1.choice": "student-v3 dash 金标卷 0.474（对照 4B 同卷 0.79），信号只进复核优先级，务必 agent 二审"}


def die(msg, code=2):
    print(f"[laya-scan] 显式失败：{msg}", flush=True)
    print("[laya-scan] 按人裁不回落 4B、不换引擎——停下报缺，进复核清单等人裁决。", flush=True)
    sys.exit(code)


def ensure_laya():
    # vendored laya 0.3.6 读 config 不带 encoding（site-packages 补丁会随 venv 重建丢失）——
    # 以 PYTHONUTF8=1 重跑自身作环境无关防线（agent.py:269 GBK 崩溃根因）
    if not sys.flags.utf8_mode and os.environ.get("PYTHONUTF8") != "1":
        os.environ["PYTHONUTF8"] = "1"
        os.execv(sys.executable, [sys.executable, str(Path(__file__).resolve()), *sys.argv[1:]])
    try:
        import laya  # noqa: F401
        return
    except ImportError:
        pass
    if not VENV_PY.exists():
        die(f"laya 解释器缺失：{VENV_PY}（venv 未重建？见 tools/_vendor 工单）")
    if str(VENV_PY).lower().replace("\\", "/") != os.path.realpath(sys.executable).lower().replace("\\", "/"):
        # 自动切 venv 重跑自身（保留全部参数）
        os.execv(str(VENV_PY), [str(VENV_PY), str(Path(__file__).resolve()), *sys.argv[1:]])
    die("venv 内 laya 包不可导入（site-packages 损坏或 GBK 补丁丢失）")


def problem_p(qid, dist):
    mode, key = PROBLEM[qid]
    if mode == "noul":
        return dist.get(key, 0.0)
    if isinstance(key, list):
        return sum(dist.get(k, 0.0) for k in key)
    return dist.get(key, 0.0)


def build_cases(args):
    """复用 state_builder（师生同构组装器）产 cases.jsonl 到临时位。返回 (cases, path)。"""
    out = TMP_DIR / f"cases-{int(time.time())}.jsonl"
    out.parent.mkdir(parents=True, exist_ok=True)
    cmd = [sys.executable, str(HERE / "laya-ft" / "state_builder.py"),
           "--project", args["project"], "--file", args["file"],
           "--chunk", str(args["chunk"]), "--out", str(out)]
    if args.get("pov"):
        cmd += ["--pov", args["pov"]]
    if args.get("personas"):
        cmd += ["--personas", args["personas"]]
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode != 0 or not out.exists():
        die(f"state_builder 失败 rc={r.returncode}：{(r.stderr or r.stdout or '')[-300:]}")
    cases = [json.loads(l) for l in out.read_text(encoding="utf-8").splitlines() if l.strip()]
    if not cases:
        die("state_builder 产出 0 案例（输入文件为空或分块失败）")
    return cases, out


def scan_cases(agent, cases, spec, qids, tag=""):
    """扫描主循环。设备自适应（09-24 实测）：
    - CUDA（本机 RTX A4500，torch 2.14.0+cu126）：逐案 predict 0.49s/案，同题集多案打包
      predict_batch 更省（4案0.93s）——GPU 分组打包是快路径。
    - CPU：逐案 predict 最快（打包反慢：padding 稀释，564s vs 203s），维持逐案。"""
    rows, errs, skipped, fwd = [], 0, 0, 0
    t1 = time.time()
    on_gpu = getattr(getattr(agent, "device", None), "type", "cpu") == "cuda"
    prepared = []  # (case, state, qbatch) 先做 needs_pov/题型过滤，再按题集分组
    for c in cases:
        state = c["state"] if isinstance(c.get("state"), dict) else json.loads(c["state"])
        qbatch = {}
        for qid in qids:
            qdef = spec[qid]
            if qdef.get("needs_pov") and not state.get("视角人物"):
                skipped += 1
                continue
            if qdef.get("type") not in ("noul", "choice"):
                continue
            qbatch[qid] = qdef
        if qbatch:
            prepared.append((c, state, qbatch))

    def consume(c, state, qbatch, answers):
        nonlocal errs, fwd
        fwd += 1
        for qid, qdef in qbatch.items():
            try:
                ans = answers.get(qid, {})
                if qdef["type"] == "noul":
                    p = ans.get("noul", ans.get("probabilities", {}).get("true"))
                    dist = {"true": p, "false": 1 - p}
                else:
                    dist = ans.get("probabilities") or {}
                if not dist:
                    raise KeyError("empty dist")
            except Exception as e:
                errs += 1
                print(f"{tag} FAIL {c.get('case_id')} {qid}: {str(e)[:120]}", flush=True)
                continue
            row = {"case_id": c.get("case_id"), "qid": qid,
                   "dist": {k: round(v, 4) for k, v in dist.items()},
                   "problem_p": round(problem_p(qid, dist), 4),
                   "章节位置": state.get("章节位置"), "章末段": state.get("是否章末段")}
            if qid in KNOWN_WEAKNESS:
                row["known_weakness"] = KNOWN_WEAKNESS[qid]
            rows.append(row)

    def run_one(c, state, qbatch):
        try:
            consume(c, state, qbatch, agent.predict(state, qbatch)["answers"])
        except Exception as e:
            print(f"{tag} FAIL {c.get('case_id')} 整批({len(qbatch)}题): {str(e)[:120]}", flush=True)

    if on_gpu:
        # 同题集分组 → 一次 predict_batch 打包多案（批失败退回逐案 predict）
        groups = {}
        for item in prepared:
            groups.setdefault(tuple(item[2]), []).append(item)
        for _, items in groups.items():
            qbatch = items[0][2]
            for s in range(0, len(items), 8):
                chunk = items[s:s + 8]
                try:
                    results = agent.predict_batch([it[1] for it in chunk], qbatch, batch_size=8)
                    for (c, state, _), res in zip(chunk, results):
                        consume(c, state, qbatch, res["answers"])
                except Exception as e:
                    print(f"{tag} BATCH-FAIL {len(chunk)}案: {str(e)[:120]} → 逐案", flush=True)
                    for c, state, _ in chunk:
                        run_one(c, state, qbatch)
                print(f"{tag} GPU 打包 {min(s+8,len(items))}/{len(items)} 案… rows={len(rows)} errs={errs}", flush=True)
    else:
        for c, state, qbatch in prepared:
            run_one(c, state, qbatch)
            if fwd % 5 == 0:
                print(f"{tag} 前向 {fwd}/{len(prepared)} 案… rows={len(rows)} errs={errs}", flush=True)
    return {"rows": rows, "errs": errs, "skipped": skipped, "forwards": fwd,
            "device": str(getattr(agent, "device", "cpu")),
            "scan_s": round(time.time() - t1, 1)}


def load_student(student):
    import laya
    t0 = time.time()
    try:
        agent = laya.load(str(student))
    except Exception as e:
        die(f"laya.load({student.name}) 失败：{e}")
    return agent, round(time.time() - t0, 1)


def child_main(args):
    """worker 分片子进程：读现成 cases 文件、扫自己那片、rows 落 --rows-out。不产报告。"""
    ensure_laya()
    idx, total = [int(x) for x in args["worker-shard"].split("/")]
    cases_path = Path(args["cases-file"])
    if not cases_path.exists():
        die(f"worker{idx}: cases 文件缺失 {cases_path}")
    all_cases = [json.loads(l) for l in cases_path.read_text(encoding="utf-8").splitlines() if l.strip()]
    mine = all_cases[idx::total]  # 轮转分片：长短片混布，避免某 worker 全拿长案例
    student = Path(args.get("student") or DEFAULT_STUDENT)
    if not student.exists():
        die(f"worker{idx}: 学生权重目录缺失 {student}")
    import laya  # noqa: F401
    spec = json.loads(SPEC_PATH.read_text(encoding="utf-8"))["questions"]
    qids = [q for q in (args.get("clauses").split(",") if args.get("clauses") else PASSES) if q in spec]
    agent, load_s = load_student(student)
    res = scan_cases(agent, mine, spec, qids, tag=f"[laya-scan w{idx}]")
    res["load_s"] = load_s
    res["shard"] = args["worker-shard"]
    res["cases"] = len(mine)
    Path(args["rows-out"]).write_text(json.dumps(res, ensure_ascii=False), encoding="utf-8")
    print(f"[laya-scan w{idx}] DONE {len(mine)}案 rows={len(res['rows'])} errs={res['errs']} "
          f"load={load_s}s scan={res['scan_s']}s", flush=True)


def free_ram_gb():
    """kernel32 空闲物理内存（GB）——venv 无 psutil，ctypes 直读；失败返回 None（不猜值）。"""
    import ctypes
    import ctypes.wintypes as wt

    class MEMORYSTATUSEX(ctypes.Structure):
        _fields_ = [("dwLength", wt.DWORD), ("dwMemoryLoad", wt.DWORD),
                    ("ullTotalPhys", ctypes.c_ulonglong), ("ullAvailPhys", ctypes.c_ulonglong),
                    ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong),
                    ("ullTotalVirtual", ctypes.c_ulonglong), ("ullAvailVirtual", ctypes.c_ulonglong),
                    ("ullAvailExtendedVirtual", ctypes.c_ulonglong)]

    m = MEMORYSTATUSEX()
    m.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
    if not ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(m)):
        return None
    return round(m.ullAvailPhys / 2 ** 30, 1)


def parent_parallel(args, cases, cases_path, spec, qids, n_students_dir):
    """多进程真并行：N 个 worker 各 load 一份学生、各扫一片，父进程只装配。
    实测（09-24 w4）：单份学生峰值 ws≈2.1GB；4 进程同时 load 挤爆 → 2 worker 被系统杀
    （rc=0xC0000409）——故起进程前按空闲内存封顶 + 错峰 load。"""
    workers = min(int(args["workers"]), len(cases))
    free = free_ram_gb()
    ram_note = f"空闲内存={'?' if free is None else str(free)+'GB'}"
    if free is not None:
        fit = 1 if free < 3.2 else int(free // 2.3)
        if fit < workers:
            print(f"[laya-scan] 并行封顶：{ram_note}，每 worker 峰值≈2.2GB → workers {workers}→{fit}"
                  f"（封顶不是换引擎，仍是学生；要跑满先腾内存窗口）", flush=True)
            workers = fit
    ncpu = os.cpu_count() or 4
    threads = max(1, ncpu // workers)
    env = dict(os.environ, PYTHONUTF8="1", OMP_NUM_THREADS=str(threads),
               MKL_NUM_THREADS=str(threads), OPENBLAS_NUM_THREADS=str(threads))
    rows, errs, skipped, fwd, failed_cases = [], 0, 0, 0, []
    shard_times, devices = [], set()
    # 先组装 cases 文件（state_builder 失败就 die，绝不先起 worker 留孤儿吃内存）
    procs, outs = [], []
    t0 = time.time()
    for i in range(workers):
        rows_out = TMP_DIR / f"shard-{int(time.time())}-{i}.json"
        cmd = [sys.executable, str(Path(__file__).resolve()),
               "--project", args["project"], "--file", args.get("file") or "-",
               "--cases-file", str(cases_path), "--worker-shard", f"{i}/{workers}",
               "--rows-out", str(rows_out), "--student", str(n_students_dir)]
        if args.get("clauses"):
            cmd += ["--clauses", args["clauses"]]
        p = subprocess.Popen(cmd, env=env)
        procs.append(p)
        outs.append((i, rows_out))
        print(f"[laya-scan] worker{i} 起（{workers} 进程并行，每进程 {threads} 线程；"
              f"每份峰值≈2.1GB；{ram_note}）", flush=True)
        if i + 1 < workers:
            time.sleep(8)  # 错峰 load：4 进程同瞬各要 2GB 会互相挤到 0xC0000409
    for i, (idx, f) in enumerate(outs):
        rc = procs[idx].wait()
        if rc != 0 or not f.exists():
            print(f"[laya-scan] worker{idx} 失败 rc={rc}（疑内存被杀？）——该片 {len(cases[idx::workers])} 案"
                  f"转父进程逐案兜底（仍是学生引擎）", flush=True)
            failed_cases.extend(cases[idx::workers])
            continue
        res = json.loads(f.read_text(encoding="utf-8"))
        rows.extend(res["rows"])
        errs += res["errs"]
        skipped += res["skipped"]
        fwd += res["forwards"]
        devices.add(str(res.get("device", "cpu")))
        shard_times.append({"worker": idx, "cases": res["cases"], "load_s": res["load_s"],
                            "scan_s": res["scan_s"]})
        f.unlink(missing_ok=True)
    wall = round(time.time() - t0, 1)
    if failed_cases:
        import laya  # noqa: F401
        agent, extra_load = load_student(n_students_dir)
        res = scan_cases(agent, failed_cases, spec, qids, tag="[laya-scan 兜底]")
        rows.extend(res["rows"])
        errs += res["errs"]
        skipped += res["skipped"]
        fwd += res["forwards"]
        wall = round(wall + extra_load + res["scan_s"], 1)
    return rows, errs, skipped, fwd, wall, {
        "workers": workers, "threads_per_worker": threads, "shard_wall_s": shard_times,
        "device": ",".join(sorted(devices)) or "cpu",
        "note": "多进程分片真并行（CPU 机外机参考；本机 GPU 单进程打包 4s，无需分片）"}


def main():
    argv = sys.argv[1:]
    args = {}
    i = 0
    while i < len(argv):
        if argv[i].startswith("--"):
            args[argv[i][2:]] = argv[i + 1] if i + 1 < len(argv) and not argv[i + 1].startswith("--") else ""
            i += 2
        else:
            i += 1
    if args.get("worker-shard"):
        if not args.get("cases-file") or not args.get("rows-out"):
            print("--worker-shard 需配 --cases-file 与 --rows-out")
            sys.exit(1)
        args.setdefault("chunk", "500")
        child_main(args)
        return
    for req in ("project",):
        if not args.get(req):
            print(__doc__)
            sys.exit(1)
    if not args.get("file"):
        print("缺 --file（或用 --worker-shard 走子进程模式）")
        sys.exit(1)

    ensure_laya()
    student = Path(args.get("student") or DEFAULT_STUDENT)
    if not student.exists():
        die(f"学生权重目录缺失：{student}")

    spec = json.loads(SPEC_PATH.read_text(encoding="utf-8"))["questions"]
    qids = [q for q in (args.get("clauses").split(",") if args.get("clauses") else PASSES) if q in spec]
    if not qids:
        die("无有效条款可扫（--clauses 全部不在 spec 或未经 GATE-1 放行）")

    cases, cases_path = build_cases(args)
    out_path = Path(args.get("out") or
                    ROOT / "projects" / args["project"] / "内部" /
                    f"laya批扫-{Path(args['file']).stem}-{time.strftime('%Y%m%d-%H%M%S')}.json")
    out_path.parent.mkdir(parents=True, exist_ok=True)

    workers = int(args.get("workers") or 1)
    par_info = None
    if workers > 1 and len(cases) > 1:
        t_load = 0.0
        rows, errs, skipped, fwd, scan_s, par_info = parent_parallel(args, cases, cases_path, spec, qids, student)
        dev = par_info.get("device", "?")
    else:
        agent, load_s = load_student(student)
        res = scan_cases(agent, cases, spec, qids, tag="[laya-scan]")
        rows, errs, skipped, fwd, scan_s = (res["rows"], res["errs"], res["skipped"],
                                            res["forwards"], res["scan_s"])
        dev = res.get("device", "cpu")
        t_load = load_s

    rows.sort(key=lambda r: -r["problem_p"])
    report = {
        "engine": f"laya-student ({student.name})",
        "engine_note": "唯一引擎=学生本地直扫；无 4B/教师 API 回落（docs/人裁-laya唯一引擎-20260924.md）",
        "device": dev,
        "spec_version": json.loads(SPEC_PATH.read_text(encoding='utf-8'))['version'],
        "input": {"project": args["project"], "file": args["file"], "cases": len(cases),
                  "pov": args.get("pov", ""), "chunk": args.get("chunk", "500")},
        "timing_s": {"load": t_load, "scan": scan_s},
        "parallel": par_info or {"workers": 1,
                                 "note": "device 自适应：cuda=同题集打包前向，cpu=逐案 predict（外机可 --workers 分片）"},
        "predict_forwards": {"calls": fwd, "cases": len(cases),
                             "note": "逐案批量前向（一次 predict 全题型）；旧逐题模式为 cases×题数 次"},
        "note": "problem_p 只排复核优先级，不做提交闸；≥0.5 进 agent 二审清单，改不改由 agent 对照 knowledge/rules 卡裁决。known_weakness 题信号权重自降。",
        "errors": errs, "skipped_no_pov": skipped, "rows": len(rows),
        "by_qid_mean_p": {q: round(sum(r['problem_p'] for r in rows if r['qid'] == q) /
                                   max(1, sum(1 for r in rows if r['qid'] == q)), 3) for q in qids},
        "top": rows[:int(args.get("top") or 40)],
    }
    out_path.write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"[laya-scan] ALL-DONE rows={len(rows)} errs={errs} skipped={skipped} "
          f"workers={workers} scan={scan_s}s → {out_path}")
    if errs:
        print(f"[laya-scan] 注意：{errs} 笔预测失败已如实记入 errors，非零=不静默")


if __name__ == "__main__":
    main()
