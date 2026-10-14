"""apply-wizard · 向导板答案回填器（看板 v4 工单 V4-5 交付物 3）

向导板（tools/dashboard.py --wizard <id> → projects/<id>/wizard.html）是纯静态页面：五步走完
只**生成** 项目配置.json 的完整新 JSON，由用户复制保存。本工具接最后一棒：读保存的向导 JSON
（--answers <文件>），按 contracts/project-config.schema.json 逐条校验，把
openQuestions[].answer 与 loadedModules **原位更新**进 projects/<id>/项目配置.json。

合并语义（不是整档替换）：向导页内嵌基档做过脱敏（敏感键整棵剔除），所以只回填这两处、
其余现存字段（含被剥掉的敏感字段）原样保留——原位改档，绝不吃档。

用法：
  python tools/apply-wizard.py --answers <向导JSON> --project <id> [--dir projects]
      --dir 口径同 tools/project-index.py：项目基目录 = <仓根>/--dir（缺省 projects）。

校验（逐条点名，任一失败退出 1，零写入）：
  · 答案文件必须是合法 JSON 对象（坏 JSON 点名解析错因）；
  · 必须携带 openQuestions[]（条目含 key/question 字符串）或 loadedModules[]——空手来回拒收；
  · openQuestions/loadedModules 按契约 schema 校验（jsonschema_lite，同 img 链路口径）；
  · loadedModules 的 id 必须在本仓 modules/<id>/module.json 有实体（不存在的模块名=幻觉，点名）；
  · answer 回填目标键必须在现存 项目配置.json 的 openQuestions 里存在（答案无处安放=点名）；
  · 合并后的整档再过一遍 schema——带病不落盘。

退出码：0 成功；1 校验/回填失败（全部问题逐条点名）；2 用法错误（argparse）。
"""
import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONFIG_NAME = "项目配置.json"
SCHEMA = "contracts/project-config.schema.json"


def load_sibling_module(filename: str):
    """按路径加载 tools/ 下同目录脚本（同 dashboard.py 口径，同文件只加载一次）。"""
    import importlib.util
    cache = load_sibling_module.__dict__.setdefault("_cache", {})
    if filename in cache:
        return cache[filename]
    path = Path(__file__).resolve().parent / filename
    spec = importlib.util.spec_from_file_location(path.stem.replace("-", "_"), path)
    if spec is None or spec.loader is None:
        raise SystemExit(f"[ABORT] 无法加载复用件：{path}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    cache[filename] = mod
    return mod


def fail(problems: list) -> int:
    """逐条点名退出 1（不静默、不部分写）。"""
    print("[FAIL] 回填中止，零写入。问题清单：", file=sys.stderr)
    for p in problems:
        print(f"  ! {p}", file=sys.stderr)
    return 1


def known_module_ids() -> set:
    return {p.parent.name for p in (ROOT / "modules").glob("*/module.json")}


def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:  # noqa: BLE001 本机控制台 GBK 兜底（同 dashboard.py）
            pass
    ap = argparse.ArgumentParser(description="向导板答案回填：openQuestions[].answer + loadedModules 原位更新 项目配置.json")
    ap.add_argument("--answers", required=True, help="用户保存的向导 JSON 文件（步骤⑤生成的完整新 JSON）")
    ap.add_argument("--project", required=True, help="项目 id（<dir>/<id>/项目配置.json）")
    ap.add_argument("--dir", default="projects", help="项目基目录（相对仓根或绝对路径，缺省 projects，同 project-index 口径）")
    args = ap.parse_args()

    pid = args.project
    if not pid or "/" in pid or "\\" in pid or pid in (".", ".."):
        print(f"[ABORT] 非法项目 id：{pid!r}", file=sys.stderr)
        return 1
    base = Path(args.dir)
    base = base if base.is_absolute() else ROOT / base
    proj = base / pid
    cfg_path = proj / CONFIG_NAME

    problems: list = []

    # ① 答案文件：坏 JSON 点名
    ap_path = Path(args.answers)
    ap_path = ap_path if ap_path.is_absolute() else ROOT / ap_path
    if not ap_path.exists():
        print(f"[ABORT] 答案文件不存在：{ap_path}", file=sys.stderr)
        return 1
    try:
        answers = json.loads(ap_path.read_text(encoding="utf-8"))
    except Exception as e:  # noqa: BLE001 解析错因原样点名
        print(f"[ABORT] 答案文件 JSON 解析失败：{ap_path}: {e}", file=sys.stderr)
        return 1
    if not isinstance(answers, dict):
        print(f"[ABORT] 答案文件顶层必须是 JSON 对象（实为 {type(answers).__name__}）：{ap_path}", file=sys.stderr)
        return 1

    has_q = isinstance(answers.get("openQuestions"), list)
    has_m = "loadedModules" in answers
    if not has_q and not has_m:
        problems.append("答案文件既无 openQuestions[] 也无 loadedModules——空手来回拒收"
                        "（向导步骤⑤生成的 JSON 应含这两处）")

    # ② 契约 schema 校验（jsonschema_lite 读同一份 contracts/，不养第二套真相）
    lite = load_sibling_module("jsonschema_lite.py")
    try:
        schema = lite.load_schema(SCHEMA)
    except (FileNotFoundError, ValueError) as e:
        print(f"[ABORT] {e}", file=sys.stderr)
        return 1
    for p in lite.validate(answers, schema):
        problems.append(f"答案文件不合契约：{p}")

    # ③ loadedModules：数组、字符串、模块实体存在
    mods = answers.get("loadedModules")
    if "loadedModules" in answers:
        if not isinstance(mods, list):
            problems.append(f"loadedModules 必须是数组（实为 {type(mods).__name__}）")
        elif not all(isinstance(x, str) and x for x in mods):
            problems.append("loadedModules 必须是非空字符串数组")
        else:
            ids = known_module_ids()
            for x in mods:
                if x not in ids:
                    problems.append(f"loadedModules 里的模块 {x!r} 在 modules/ 无实体（可用：{sorted(ids)}）")

    # ④ 现存配置必须存在且为对象
    if not cfg_path.exists():
        print(f"[ABORT] 项目配置不存在：{cfg_path}（先跑 python tools/project-init.py 初始化项目）", file=sys.stderr)
        return 1
    try:
        cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
    except Exception as e:  # noqa: BLE001
        print(f"[ABORT] 现存 {cfg_path} JSON 解析失败：{e}", file=sys.stderr)
        return 1
    if not isinstance(cfg, dict):
        print(f"[ABORT] 现存 {cfg_path} 顶层不是 JSON 对象", file=sys.stderr)
        return 1

    # ⑤ answer 回填：目标键必须已在现存 openQuestions 里
    cur_q = cfg.get("openQuestions")
    if not isinstance(cur_q, list):
        cur_q = []
    by_key = {e.get("key"): e for e in cur_q if isinstance(e, dict) and isinstance(e.get("key"), str)}
    if has_q:
        for i, e in enumerate(answers["openQuestions"]):
            if not isinstance(e, dict) or not isinstance(e.get("key"), str):
                problems.append(f"答案 openQuestions[{i}] 必须是有 key 的对象")
                continue
            v = e.get("answer")
            if v is None or (isinstance(v, str) and not v.strip()):
                continue  # 未作答＝不动现存值，不算错
            if not isinstance(v, str):
                problems.append(f"答案 openQuestions[{i}].answer 必须是字符串（实为 {type(v).__name__}）")
                continue
            tgt = by_key.get(e["key"])
            if tgt is None:
                problems.append(f"答案键 {e['key']!r} 在现存 项目配置.json 的 openQuestions 里不存在（答案无处安放）")
                continue
            tgt["answer"] = v.strip()
    if problems:
        return fail(problems)

    if isinstance(mods, list) and all(isinstance(x, str) and x for x in mods):
        cfg["loadedModules"] = list(mods)

    # ⑥ 合并后整档再过 schema——带病不落盘
    for p in lite.validate(cfg, schema):
        problems.append(f"回填后的 项目配置.json 不合契约：{p}")
    if problems:
        return fail(problems)

    cfg_path.write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + "\n",
                        encoding="utf-8", newline="\n")
    n_ans = sum(1 for e in cur_q if isinstance(e, dict) and isinstance(e.get("answer"), str) and e["answer"].strip())
    print(f"applied → {cfg_path}")
    print(f"  openQuestions：{n_ans}/{len(cur_q)} 问已带 answer（本次回填自 {ap_path.name}）")
    if "loadedModules" in cfg:
        print(f"  loadedModules = {json.dumps(cfg['loadedModules'], ensure_ascii=False)}")
    print("  next: 全部答完后可重跑 dashboard.py --wizard 复核，或直接进生产线")
    return 0


if __name__ == "__main__":
    sys.exit(main())
