"""img-assets · 美术资产与出图产物台账（asset-registry@1 确定性重建件）

作者 2026-10-11 点名的「产物管理」落在这里：把 **设计件 ↔ 任务 ↔ 产物文件 ↔ 收据** 四方对上账，
产出一份可反复重建的台账。**它不是手写件**：同一 job + 同一收据目录必得同一台账（除 built_at）。

四条纪律（对应 contracts/asset-registry.schema.json 的四条）：
  ① 台账只记账不裁决——状态回答「有没有出、出的是不是这一版指纹」，不回答「好不好看」；
     好坏归人眼与 vision 复核（红线 4/5），本件里没有任何阈值打回。
  ② 无收据 = 无产物——文件躺在盘上也不算，current.receipt 指不出即降级 ungenerated 并点名。
  ③ stale_design 必须点名——产物指纹落后于当前任务/设计件（改了设定没重出图）；
     收据没写 task_fingerprint 也按这一类处理：**无法证明是哪一版就宁可当没出，不许当已出**。
  ④ 废稿归档不硬删——history 收全部收据（含 failed / blocked_guardrail），路径可能指向归档子树。

零网络、零 token、纯 stdlib。不改 job、不改收据、不动产物文件，只读。

用法：
  python tools/img-assets.py build --job <image-job@1.json> [--receipts <目录>] [--assets <美术资产表.md>]
                                   [--storyboard <分镜表.md>] [--project-root <目录>] [--out <台账.json>] [--check]
  python tools/img-assets.py --selftest     # A 批验收自测（合成收据，零写仓库）
退出码：0 = 台账建成且无 unresolved；1 = 有 unresolved（缺件/悬空/落后/孤儿）；2 = 用法或读取错误。
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
from jsonschema_lite import load_schema, validate  # noqa: E402
from imglib import REPO, design_digest, extract_block, load_json, sha12  # noqa: E402

STATUS_ORDER = ["ungenerated", "generated", "failed", "needs_rerun", "stale_design"]
NOTE = ("本台账只记账事实（有无同指纹成功收据、产物文件在不在盘、设计件与任务指纹是否落后），"
        "不裁决画面质量；好坏归人眼与 vision 复核。状态不是闸：它不构成打回理由。")


def die(msg: str, code: int = 2) -> None:
    print(f"[img-assets] 用法/读取错误: {msg}", file=sys.stderr)
    raise SystemExit(code)


def rel_to(path: Path, *roots: Path) -> str:
    """尽量给出相对路径（台账要能进项目、可复核）；都不沾就给绝对路径的正斜杠形态。"""
    p = Path(path)
    for r in roots:
        try:
            return str(p.resolve().relative_to(Path(r).resolve())).replace("\\", "/")
        except ValueError:
            continue
    return str(p).replace("\\", "/")


def infer_project_root(job_path: Path) -> Path:
    """产物相对路径以项目根为基准：从 job 位置往上找 `projects/<id>` 那一层，找不到退回 cwd。"""
    p = Path(job_path).resolve()
    for anc in [p.parent, *p.parents]:
        if anc.parent.name == "projects":
            return anc
    return Path.cwd()


def load_receipts(directory: Path | None, *bases: Path) -> tuple[list[dict], list[dict]]:
    """扫收据目录。返回 (可读收据, 点名问题)。

    目录里混进别人家的件时按 `format` 让路；连 format 都没有或压根解析不了的，必须点名——
    「扫过但没看懂」不能被静默当成「没有这回事」（否则覆盖面声明就是假的）。
    """
    receipts: list[dict] = []
    problems: list[dict] = []
    if not directory:
        return receipts, problems
    d = Path(directory)
    if not d.exists():
        problems.append({"code": "PARSE_FAIL", "where": rel_to(d, REPO),
                         "message": "收据目录不存在（本轮按「无任何收据」记账，不等于产物没出——请确认路径）"})
        return receipts, problems
    for f in sorted(d.rglob("*.json"), key=lambda x: str(x).replace("\\", "/")):
        at = rel_to(f, *bases, d, REPO)
        doc, errs = load_json(f)
        if errs:
            problems.append({"code": "PARSE_FAIL", "where": at, "message": errs[0]})
            continue
        if not isinstance(doc, dict):
            problems.append({"code": "PARSE_FAIL", "where": at,
                             "message": "收据不是对象（跳过，不猜它想表达什么）"})
            continue
        fmt = doc.get("format")
        if fmt is not None and fmt != "image-receipt@1":
            continue                      # 别家的收据，不属本台账的账本
        problems_ = validate(doc, load_schema("image-receipt.schema.json"))
        if problems_:
            problems.append({"code": "PARSE_FAIL", "where": at,
                             "message": f"不过 contracts/image-receipt.schema.json：{problems_[0]}"})
            continue
        if doc.get("task_id"):
            doc["_path"] = at
            doc["_sort"] = (str(doc.get("at") or ""), at)
            receipts.append(doc)
        else:
            problems.append({"code": "PARSE_FAIL", "where": at,
                             "message": "收据缺 task_id，无法归账（点名，不静默丢）"})
    return receipts, problems


class Ledger:
    def __init__(self, job: dict, receipts: list[dict], assets: dict | None, sb: dict | None,
                 project_root: Path, job_path: Path, receipts_dir: Path | None):
        self.job = job
        self.assets = assets
        self.sb = sb
        self.project_root = Path(project_root)
        self.job_path = Path(job_path)
        self.receipts_dir = receipts_dir
        self.unresolved: list[dict] = []
        self._seen: set[tuple] = set()
        self.by_task: dict[str, list[dict]] = {}
        seen: set[str] = set()
        for r in receipts:
            self.by_task.setdefault(r["task_id"], []).append(r)
            seen.add(r["task_id"])
        self.receipts = receipts
        task_ids = {t["task_id"] for t in job.get("tasks") or []}
        for tid in sorted(seen - task_ids):
            paths = sorted(r["_path"] for r in self.by_task[tid])
            self.bad("ORPHAN_RECEIPT", tid,
                     f"收据指向 job 里不存在的任务 {tid}（{paths[0]}{'…' if len(paths) > 1 else ''}）——"
                     f"多半是任务改过 id 或换了包版本，产物别按这一版记账")

    def bad(self, code: str, where: str, message: str) -> None:
        key = (code, where, message)
        if key in self._seen:
            return
        self._seen.add(key)
        self.unresolved.append({"code": code, "where": where, "message": message})

    # ── 设计件侧 ──
    def asset_index(self) -> dict[str, dict]:
        return {a.get("id", "?"): a for a in (self.assets or {}).get("assets") or []}

    def check_digests(self) -> None:
        """表/画像改了但包没重算 = 台账覆盖面造假，必须点名（与 stale_design 同源的那类坑）。"""
        for label, doc, ref in (("分镜表", self.sb, self.job.get("storyboard") or {}),
                                ("美术资产表", self.assets, self.job.get("assets") or {})):
            if doc is None or not ref:
                continue
            now = sha12(json.dumps({k: v for k, v in doc.items() if k != "_digest"},
                                   ensure_ascii=False, sort_keys=True))
            claimed = ref.get("digest")
            if claimed and now != claimed:
                self.bad("FINGERPRINT_STALE", ref.get("path") or label,
                         f"{label}当前内容摘要 {now} ≠ 任务包记录的 {claimed}："
                         f"表改过但包没重算，台账判不出这一版产物对不对（先重跑 img-plan 再重建台账）")

    # ── 单条对账 ──
    def entry(self, task: dict, by_asset: dict[str, dict]) -> dict:
        tid = task["task_id"]
        rs = sorted(self.by_task.get(tid, []), key=lambda r: r["_sort"])
        aid = task.get("asset_ref")
        issues: list[str] = []
        design_fp: str | None = None
        maturity = None
        asset_name = None
        if aid:
            a = by_asset.get(aid)
            if a is None:
                self.bad("ASSET_REF_DANGLING", tid,
                         f"任务的资产引用 {aid!r} 不在美术资产表里（表缺件还是 id 打错？产物无法与设计对账）")
            else:
                design_fp = design_digest(a)
                maturity = a.get("maturity")
                asset_name = a.get("name")

        cur: dict | None = None
        def note_of(r: dict) -> str | None:
            return r.get("error") or (r.get("guardrail") or {}).get("knob")

        history = [{"file": (f.replace("\\", "/") if isinstance(f, str) else None),
                    "receipt": r["_path"], "fingerprint": r.get("task_fingerprint"),
                    "status": r.get("status"), "at": r.get("at"), "note": note_of(r)}
                   for r in rs for f in (r.get("files") or [None])]

        ok = [r for r in rs if r.get("status") == "ok"]
        matched = [r for r in ok if r.get("task_fingerprint") == task["fingerprint"]]
        latest = rs[-1] if rs else None

        def current_of(r: dict) -> dict:
            files = r.get("files") or []
            return {"file": (files[0].replace("\\", "/") if files else task.get("output_rel", "")),
                    "receipt": r["_path"], "at": r.get("at"), "engine": r.get("engine"),
                    "accelerator": r.get("accelerator"), "seed": r.get("seed"),
                    "size": r.get("size"), "seconds": r.get("seconds")}

        def file_present(r: dict) -> tuple[bool, list[str]]:
            missing = []
            for f in r.get("files") or []:
                if not (self.project_root / str(f)).exists():
                    missing.append(str(f).replace("\\", "/"))
            return (bool(r.get("files")) and not missing), missing

        if not rs:
            status = "ungenerated"
            issues.append("无任何收据（没出过，或执行侧没写收据——后者按「无收据=无产物」记账）")
        elif matched:
            r = matched[-1]
            present, missing = file_present(r)
            if present:
                status = "generated"
                cur = current_of(r)
            else:
                status = "ungenerated"
                issues.append(f"收据说出了但文件不在盘：{('、'.join(missing) or '(收据 files 为空)')}")
                self.bad("FILE_MISSING", tid,
                         f"{r['_path']} 声明的产物文件在 {self.project_root.as_posix()} 下找不到："
                         f"{('、'.join(missing) or 'files 数组为空')}")
        elif ok:
            r = ok[-1]
            status = "stale_design"
            why = ("收据没写 task_fingerprint，无法证明产物属于当前这一版任务"
                   if r.get("task_fingerprint") is None else
                   f"产物指纹 {r.get('task_fingerprint')} 落后于当前任务指纹 {task['fingerprint']}")
            issues.append(f"有产物但不是这一版（旧件在 history，不进 current）：{why}")
            self.bad("FINGERPRINT_STALE", tid,
                     f"{why}（收据 {r['_path']}）——改了设定/提示词没重出图，这类半接状态必须重跑")
        else:
            cur = None
            if latest["status"] == "failed":
                status = "failed"
                issues.append(f"最近一次尝试失败：{latest.get('error') or '(收据未写原因)'}")
            elif latest["status"] == "blocked_guardrail":
                g = latest.get("guardrail") or {}
                status = "ungenerated"
                issues.append(f"护栏显式失败（{g.get('tripped')}，旋钮 {g.get('knob')}）：压根没提交，不是画得不好")
            elif latest["status"] == "skipped_idempotent":
                status = "ungenerated"
                issues.append("幂等跳过但没有同指纹的成功收据可指——按没出记账，不拿旧产物冒充新版")
            else:
                status = "ungenerated"
                issues.append(f"收据状态 {latest.get('status')!r} 不构成产物")

        for w in self.job.get("warnings") or []:
            if w.get("where") == tid and w.get("code") == "ASSET_NOT_LOCKED":
                issues.append("设计件未 locked（可出图，但别把产物当定稿母版复用）")

        return {"task_id": tid, "kind": task["kind"], "class": task.get("asset_class"),
                "asset_id": aid, "asset_name": asset_name, "variant": task.get("variant"),
                "page_no": task.get("page_no"), "panel_no": task.get("panel_no"),
                "design_fingerprint": design_fp, "fingerprint": task["fingerprint"],
                "status": status, "current": cur, "history": history,
                "maturity": maturity, "issues": issues}

    def build(self) -> dict:
        self.check_digests()
        by_asset = self.asset_index()
        tasks = self.job.get("tasks") or []
        entries = [self.entry(t, by_asset) for t in tasks]
        if len(entries) != len(tasks):
            self.bad("TASK_NOT_COVERED", self.job.get("job_id", "?"),
                     f"台账条目 {len(entries)} 条 ≠ 任务 {len(tasks)} 条（漏记账就是假账）")
        by_status = {s: sum(1 for e in entries if e["status"] == s) for s in STATUS_ORDER}
        by_class: dict[str, int] = {}
        for e in entries:
            if e.get("class"):
                by_class[e["class"]] = by_class.get(e["class"], 0) + 1
        roots = sorted({str(Path(t.get("output_rel", "")).parent.as_posix())
                        for t in tasks if t.get("output_rel")})
        return {
            "format": "asset-registry@1",
            "built_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            "job": {"path": rel_to(self.job_path, self.project_root, REPO),
                    "job_id": self.job.get("job_id", ""),
                    "job_fingerprint": self.job.get("fingerprint", "")},
            "profile": (self.job.get("profile") or {}).get("id"),
            "storyboard": ({"path": (self.job.get("storyboard") or {}).get("path", ""),
                            "digest": (self.job.get("storyboard") or {}).get("digest")}
                           if self.job.get("storyboard") else None),
            "assets": ({"path": (self.job.get("assets") or {}).get("path", ""),
                        "digest": (self.job.get("assets") or {}).get("digest")}
                       if self.job.get("assets") else None),
            "entries": entries,
            "summary": {"total": len(entries), "by_status": by_status, "by_class": by_class},
            "unresolved": self.unresolved,
            "scanned": {"job": rel_to(self.job_path, self.project_root, REPO),
                        "receipts_dir": rel_to(self.receipts_dir, self.project_root, REPO) if self.receipts_dir else None,
                        "receipt_files": len(self.receipts),
                        "product_roots": roots,
                        "project_root": str(self.project_root.as_posix())},
            "warnings": ["%s @ %s：%s" % (w.get("code"), w.get("where") or "-", w.get("message"))
                         for w in self.job.get("warnings") or []],
            "note": NOTE,
        }


def cmd_build(args: argparse.Namespace) -> int:
    job, errs = load_json(Path(args.job))
    if errs:
        die(errs[0])
    problems = validate(job, load_schema("image-job.schema.json"))
    if problems:
        print(f"任务包不过 contracts/image-job.schema.json（{len(problems)} 处）：", file=sys.stderr)
        for p in problems[:20]:
            print(f"  {p}", file=sys.stderr)
        return 1
    if (job.get("unresolved") or []) and not args.allow_unresolved_job:
        print("任务包自带 unresolved（plan 期硬缺陷）：先修分镜表/画像再重算包，"
              "台账不给半接状态记账。（确实要看现状用 --allow-unresolved-job）", file=sys.stderr)
        return 1

    project_root = Path(args.project_root) if args.project_root else infer_project_root(Path(args.job))
    receipts_dir = Path(args.receipts) if args.receipts else None
    receipts, r_problems = load_receipts(receipts_dir, project_root)
    assets = sb = None
    if args.assets:
        assets, _, a_errs = extract_block(Path(args.assets), "asset-design@1")
        if a_errs:
            die(a_errs[0])
    if args.storyboard:
        sb, _, s_errs = extract_block(Path(args.storyboard), "storyboard@1")
        if s_errs:
            die(s_errs[0])

    ledger = Ledger(job, receipts, assets, sb, project_root, Path(args.job), receipts_dir)
    for p in r_problems:
        ledger.bad(p["code"], p["where"], p["message"])
    reg = ledger.build()

    problems = validate(reg, load_schema("asset-registry.schema.json"))
    if problems:
        print(f"台账不过 contracts/asset-registry.schema.json（{len(problems)} 处）：", file=sys.stderr)
        for p in problems[:20]:
            print(f"  {p}", file=sys.stderr)
        return 1

    out_path = None
    if not args.check:
        out_path = Path(args.out) if args.out else \
            project_root / Path((job["tasks"][0].get("output_rel") or "漫画/x").split("/")[0]) / "资产台账.json"
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(reg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    s = reg["summary"]
    print("台账 %d 条：已出 %d / 未出 %d / 失败 %d / 落后 %d / 待重跑 %d" % (
        s["total"], s["by_status"]["generated"], s["by_status"]["ungenerated"],
        s["by_status"]["failed"], s["by_status"]["stale_design"], s["by_status"]["needs_rerun"]))
    if s["by_class"]:
        print("按类：" + "、".join(f"{k} {v}" for k, v in sorted(s["by_class"].items())))
    print("扫了：收据 %d 份 @ %s｜产物根 %s" % (
        reg["scanned"]["receipt_files"], reg["scanned"]["receipts_dir"] or "(未给目录)",
        "、".join(reg["scanned"]["product_roots"]) or "-"))
    for e in reg["entries"]:
        if e["issues"]:
            print("  [%s] %s：%s" % (e["status"], e["task_id"], "；".join(e["issues"])))
    for u in reg["unresolved"]:
        print("  [对不上账] %s @ %s：%s" % (u["code"], u.get("where") or "-", u["message"]))
    print("声明：%s" % reg["note"])
    if out_path:
        print("台账: %s" % out_path.as_posix())
    else:
        print("（--check：未落盘）")
    return 1 if reg["unresolved"] else 0


def selftest() -> int:
    """A 批验收自测：真跑一遍 img-plan 出包 → 造合成收据四种情形 → 重建台账并逐条断言。

    零写仓库：job、收据与产物文件全落在临时目录；同名两次重建必须逐字节一致（除 built_at）。
    """
    from types import SimpleNamespace
    import importlib.util
    import tempfile

    fails: list[str] = []

    def check(cond: bool, msg: str) -> None:
        print(("  ok   " if cond else "  FAIL ") + msg)
        if not cond:
            fails.append(msg)

    spec = importlib.util.spec_from_file_location("img_plan_selftest", REPO / "tools" / "img-plan.py")
    if spec is None or spec.loader is None:
        print("  FAIL 载不入 img-plan.py（自测与真链路必须同源）")
        return 1
    plan_mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(plan_mod)

    FIX = REPO / "tools" / "__fixtures__"
    sb, _, errs = extract_block(FIX / "comic-storyboard-sample.md", "storyboard@1")
    assets, _, a_errs = extract_block(FIX / "comic-assets-sample.md", "asset-design@1")
    prof_raw, p_errs = load_json(REPO / "presets" / "image" / "profiles" / "qwen-image-2-1-comfyui.json")
    if errs or a_errs or p_errs:
        print(f"  FAIL fixture/画像读取：{errs + a_errs + p_errs}")
        return 1
    prof = plan_mod.fill_placeholders(prof_raw)

    with tempfile.TemporaryDirectory(prefix="img-assets-") as td:
        root = Path(td) / "projects" / "p-selftest"
        root.mkdir(parents=True)
        job_path = root / "漫画" / "任务包" / "job.json"
        job_path.parent.mkdir(parents=True, exist_ok=True)
        args = SimpleNamespace(storyboard=FIX / "comic-storyboard-sample.md",
                               profile=REPO / "presets" / "image" / "profiles" / "qwen-image-2-1-comfyui.json",
                               assets=FIX / "comic-assets-sample.md",
                               acceleration=REPO / "presets" / "image" / "acceleration.json",
                               pages=None, comic_dir="漫画", concurrency=1,
                               on_task_fail="record_and_stop", no_resume=False, check=False,
                               title=None, node=None, flow=None)
        job, planner = plan_mod.plan(json.loads(json.dumps(prof)), json.loads(json.dumps(sb)),
                                     json.loads(json.dumps(assets)), args)
        check(not job["unresolved"], f"链路起点：img-plan 出包零硬缺陷（实得 {[u['code'] for u in job['unresolved']]}）")
        job_path.write_text(json.dumps(job, ensure_ascii=False, indent=2), encoding="utf-8")

        rdir = root / "漫画" / "收据"
        rdir.mkdir(parents=True, exist_ok=True)

        def write_receipt(t: dict, status: str, *, fp: str | None = "same", at: str = "2026-10-11 10:00:00") -> dict:
            files = []
            if status == "ok":
                f = root / t["output_rel"]
                f.parent.mkdir(parents=True, exist_ok=True)
                f.write_bytes(b"\x89PNG\r\n\x1a\n synthetic")
                files = [t["output_rel"].replace("\\", "/")]
            r = {"format": "image-receipt@1", "status": status, "task_id": t["task_id"],
                 "job_id": job["job_id"], "job_fingerprint": job["fingerprint"],
                 "task_fingerprint": (t["fingerprint"] if fp == "same" else
                                      (None if fp == "none" else "old00000000000")),
                 "kind": t["kind"], "asset_ref": t.get("asset_ref"), "asset_class": t.get("asset_class"),
                 "variant": t.get("variant"), "page_no": t.get("page_no"), "panel_no": t.get("panel_no"),
                 "profile": job["profile"]["id"], "backend": "comfyui", "engine": t["engine"],
                 "prompt": t["prompt"], "seed": t["seed"], "size": t["size"],
                 "files": files, "seconds": 30.0 if status == "ok" else None,
                 "at": at, "driver": "kit/img-assets-selftest"}
            if status == "failed":
                r["error"] = "引擎不可达：http://127.0.0.1:18188 拒连（起法见 presets/image/README.md）"
            if status == "blocked_guardrail":
                r["guardrail"] = {"tripped": "vram_reserve", "observed": 1.2, "limit": 2.0,
                                  "knob": "画像 budget.vram_reserve_gb"}
            fp8 = (r["task_fingerprint"] or "nofp")[:8]
            seq = len(list(rdir.glob(f"{t['task_id']}-*.json")))
            (rdir / f"{t['task_id']}-{fp8}-{seq}.json").write_text(
                json.dumps(r, ensure_ascii=False, indent=2), encoding="utf-8")
            return r

        ts = {t["task_id"]: t for t in job["tasks"]}
        gen = ts["k-char-linwan-front"]
        stale = ts["a-bg-snowpass"]
        failed = ts["a-prop-brass-lantern"]
        guard = ts["a-detail-rosette-dense"]
        nofp = ts["p1-1"]
        write_receipt(gen, "ok")
        write_receipt(gen, "failed", at="2026-10-11 09:00:00")      # 废稿在前，成功在后
        write_receipt(stale, "ok", fp="other")
        write_receipt(failed, "failed")
        write_receipt(guard, "blocked_guardrail")
        write_receipt(nofp, "ok", fp="none")
        orphan = {"format": "image-receipt@1", "status": "ok", "task_id": "p99-99",
                  "files": ["漫画/panels/p99-99.png"], "at": "2026-10-11 11:00:00"}
        (rdir / "orphan.json").write_text(json.dumps(orphan, ensure_ascii=False), encoding="utf-8")
        (rdir / "broken.json").write_text("{ not json", encoding="utf-8")

        opts = SimpleNamespace(job=job_path, receipts=rdir, assets=FIX / "comic-assets-sample.md",
                               storyboard=FIX / "comic-storyboard-sample.md", project_root=root,
                               out=None, check=False, allow_unresolved_job=False)
        reg_json = root / "reg.json"

        def rebuild() -> dict:
            opts.out = reg_json
            rc = cmd_build(opts)
            return json.loads(reg_json.read_text(encoding="utf-8")), rc

        reg, rc = rebuild()
        st = {e["task_id"]: e["status"] for e in reg["entries"]}
        check(rc == 1, "有对不上账时返回码必须非零（不谎报「齐了」）")
        check(st.get(gen["task_id"]) == "generated", f"成功收据 + 文件在盘 = generated（实得 {st.get(gen['task_id'])}）")
        check(len([h for h in next(e for e in reg["entries"] if e["task_id"] == gen["task_id"])["history"]]) == 2,
              "废稿进 history 不硬删（同任务两条：failed 在前、ok 在后）")
        check(st.get(stale["task_id"]) == "stale_design", f"产物指纹落后 = stale_design（实得 {st.get(stale['task_id'])}）")
        check(st.get(failed["task_id"]) == "failed", f"失败就是 failed（实得 {st.get(failed['task_id'])}）")
        check(st.get(guard["task_id"]) == "ungenerated", f"护栏失败是「诚实的没出」（实得 {st.get(guard['task_id'])}）")
        check(st.get(nofp["task_id"]) == "stale_design", f"收据缺指纹不许当已出（实得 {st.get(nofp['task_id'])}）")
        codes = {u["code"] for u in reg["unresolved"]}
        check({"ORPHAN_RECEIPT", "PARSE_FAIL", "FINGERPRINT_STALE"} <= codes,
              f"孤儿收据/读不懂的件/落后都点名，实得 {sorted(codes)}")
        check(len(reg["entries"]) == len(job["tasks"]),
              f"台账覆盖 job.tasks 全集（{len(reg['entries'])}/{len(job['tasks'])}）")
        check(reg["summary"]["total"] == len(reg["entries"]), "summary.total 与条目数一致")
        check("不裁决" in reg["note"], "台账带不裁决声明（好坏归人眼与 vision）")
        check(validate(reg, load_schema("asset-registry.schema.json")) == [], "台账过 asset-registry@1 契约")

        reg2, _ = rebuild()
        a = json.dumps({k: v for k, v in reg.items() if k != "built_at"}, ensure_ascii=False, sort_keys=True)
        b = json.dumps({k: v for k, v in reg2.items() if k != "built_at"}, ensure_ascii=False, sort_keys=True)
        check(a == b, "确定性重建：同输入两次逐字节一致（除 built_at）")

        # 表改过没重算包 → 必须点名（stale 的另一半：设计动了、包还是旧的）
        sb2 = json.loads(json.dumps(sb))
        sb2["notes"] = "改过的分镜表"
        (root / "sb.md").write_text("```json\n" + json.dumps(sb2, ensure_ascii=False) + "\n```\n", encoding="utf-8")
        opts2 = SimpleNamespace(**vars(opts))
        opts2.storyboard = root / "sb.md"
        opts2.out = reg_json
        rc2 = cmd_build(opts2)
        reg3 = json.loads(reg_json.read_text(encoding="utf-8"))
        check(rc2 == 1 and any("分镜表当前内容摘要" in u["message"] for u in reg3["unresolved"]),
              "表改了包没重算 → 台账点名，不拿旧产物冒充新版")

    print("\nimg-assets 自测 %s（%d 项失败）" % ("全绿" if not fails else "有失败", len(fails)))
    return 1 if fails else 0


def parse() -> argparse.Namespace:
    ap = argparse.ArgumentParser(description="设计件 ↔ 任务 ↔ 产物 ↔ 收据 四方对账，重建 asset-registry@1",
                                 allow_abbrev=False)
    ap.add_argument("cmd", nargs="?", default="build", choices=["build"], help="build（缺省）")
    ap.add_argument("--job", help="image-job@1 任务包路径（事实源）")
    ap.add_argument("--receipts", help="收据目录（递归扫 *.json）")
    ap.add_argument("--assets", help="美术资产表 .md（asset-design@1 承载体）")
    ap.add_argument("--storyboard", help="分镜表 .md（用于判「表改了包没重算」）")
    ap.add_argument("--project-root", help="产物相对路径的基准根（缺省从 job 位置推 projects/<id>）")
    ap.add_argument("--out", help="台账落盘路径（缺省 <项目根>/<漫画>/资产台账.json）")
    ap.add_argument("--check", action="store_true", help="只校验不落盘")
    ap.add_argument("--allow-unresolved-job", action="store_true",
                    help="job 自带 unresolved 时仍出账（只读现状用；默认拒绝，别给半接状态记账）")
    ap.add_argument("--selftest", action="store_true", help="跑 A 批验收自测（临时目录，零写仓库）后退出")
    return ap.parse_args()


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    args = parse()
    if args.selftest:
        return selftest()
    if not args.job:
        die("缺 --job <image-job@1.json>")
    return cmd_build(args)


if __name__ == "__main__":
    sys.exit(main())
