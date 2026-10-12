"""project-init · 按规范 R6 §五 新布局初始化一个空项目

创建：
  projects/<id>/
  ├─ 项目配置.json            # flowId 置 null——流程身份由内核 flow_start 绑定（铁律 8），init 不猜
  │                           #   含 validation 校验标准声明位（批次2.5 P1，声明位先行）
  │                           #   --domain 显式给出时另注入 openQuestions 冷启动询问（批次4 4.2）
  ├─ 输入/点子.md             # 人写：点子 / 素材 / 需求（骨架模板；剧本短剧变体为 分集梗概.md）
  ├─ 世界书/                  # 跨模块共享状态：设定 / 人物 / 时间线 / 词表
  ├─ 文风/                    # 人写：文风样本 + 文风规则卡（批次2.5 P1；rule-card@1 信封模板）
  ├─ 规则/                    # 人写：项目专属禁则/偏好卡（升格全局需过专名清洗）
  ├─ 交付/README.md           # NN- 定序交付出口的命名说明
  ├─ registry/receipts/       # 机器区：收据（原 内部/收据 错位，R6 §五-1 归位）
  └─ snapshots/

骨架解耦（批次4 4.2）：骨架模板不在代码里，声明式预设 JSON 是唯一事实源
  presets/skeletons/writing.json          # 缺省 writing 骨架（与历史行为逐字节同构）
  presets/skeletons/writing-剧本短剧.json # 变体样例：分集梗概输入面 + 剧本短剧询问清单
结构（宁简勿繁）：{domain, description, openQuestions?, files:{路径:模板文本}, directories:[路径]}。
占位符三个：{project}=项目id、{today}=%Y-%m-%d、{createdAt}=%Y-%m-%dT%H:%M:%S，装配期 str.replace 回填
（不用 str.format——模板内含 JSON 花括号）。装配序 = files 声明序在前、directories 在后（与历史清单同序）。

子命令：
  （缺省）      新项目全量骨架；目录已存在且非空 → 拒绝（绝不覆盖/合并存量项目）。
                缺省 writing 装配：只装文件与目录，不注入 openQuestions——历史行为逐字节不变。
  --domain <名|custom:<路径>>  领域骨架装配（批次4 4.2）：名 = presets/skeletons/<名>.json；
                custom:<路径> = 外部预设 JSON（同构装配，相对路径锚仓库根，与 --import 同口径）。
                显式给 --domain 时把预设里的 openQuestions 预填进 项目配置.json（冷启动询问声明位：
                会话 agent 见未答项必须向用户逐条询问、答案回填 answer 字段——询问归会话 agent，kit 不弹 UI）。
                未知 domain 报错并列出可用清单。
  --upgrade     存量项目补目录（批次2.5 P1）：逐件核对骨架清单，**只补缺失的文件/目录**，
                已存在的一律跳过、一个字节不动；项目配置.json 已存在也不动
                （validation / openQuestions 声明位要启用请手编，字段口径见 contracts/project-config.schema.json）。
  --import <成稿目录>  批次3e 改稿套件导入件：把既有成稿正文拷入 <项目>/输入/<subdir>/
                （--subdir 指定 输入/ 下的子目录名，默认「正文」；保留源目录相对结构；只收 .md/.txt；
                相对路径按仓库根解析，自导入精确拦截：仅当目标 输入/<subdir>/ 落在源目录子树内才拒绝
                （源=项目根会边拷边复制自己）；源是项目内平行目录（如 正文_原版/）放行——原位项目收编自有正文的正场景）。
                **不覆盖**：同名目标一律跳过并在清单标 skipped——重复 --import 同源 = 全部 skipped 零破坏。
                拷贝清单收据落 registry/receipts/project-import-<时间戳>.json
                （源/目标/字节数/action 逐条——报数必附收据）。
                拷完自动 project-index.py build（sys.executable 同解释器子进程；索引失败不吞 = 导入失败退出非零；
                导入件在索引里 role=human、kind=导入）。要求项目已存在：不存在先 init（报错带两步命令）。

纪律：
  - 只建骨架，不建 state.json / flow 绑定 / registry 索引（那是内核与 flow 的事）；
  - 不引 LLM、不联网；幂等性靠「新项目已存在即拒绝 / --upgrade 已存在即跳过 / --import 同名即跳过」保证；
  - 模板是范式不是概括：kit 只给形，不猜你的内容——条款与样本必须由用户填实。

用法：
  python tools/project-init.py <projectId> [--dir projects]             # 新项目（writing 缺省骨架）
  python tools/project-init.py <projectId> --domain writing-剧本短剧     # 领域变体（含 openQuestions 预填）
  python tools/project-init.py <projectId> --domain custom:<预设.json>   # 外部预设同构装配
  python tools/project-init.py <projectId> --upgrade [--dir projects]   # 存量项目补目录
  python tools/project-init.py <projectId> --import <成稿目录> [--subdir 正文] [--dir projects]
                                                                        # 改稿套件：成稿导入 + 自动索引
退出码：成功 0；拒绝/失败 1。

改稿套件七步 runbook（完整方法卡 kb/method/revise-workflow，读卡：core kb_read --ref kb/method/revise-workflow）：
  ① 本命令 --import 导入成稿 →（② 盘点索引已随导入自动 build）→ ③ deconstruct sample 抽样
  → ④ 会话内 mf_deconstruct 归因出卡草稿，人审后 land --to project → ⑤ kit-compile --project 建项目 RAG
  → ⑥ 新想法落位（输入/点子.md／规则/／文风/，落完重跑⑤）
  → ⑦ 431 会话诊改循环（diag_scan + mf_analyze_card 诊 → repair-plan@1 → mf_apply_repairs 出 diff → 人审应用）。
"""
import json, os, subprocess, sys, time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PRESET_DIR = ROOT / "presets" / "skeletons"


def fail(msg: str) -> int:
    print(f"[ABORT] {msg}")
    return 1


# ── 骨架预设装载与装配（批次4 4.2 骨架解耦）─────────────────────────────────────

def load_preset(domain: str):
    """读领域骨架预设：名 → presets/skeletons/<名>.json；custom:<路径> → 外部 JSON（相对锚仓库根）。
    返回预设 dict；出错打印 [ABORT] 并返回 None（缺文件点名可用清单，坏结构点名原因——不静默）。"""
    if domain.startswith("custom:"):
        raw = domain[len("custom:"):]
        p = Path(raw)
        if not p.is_absolute():
            p = ROOT / raw  # 与 --import 同口径：相对路径锚仓库根
        name = f"custom:{raw}"
    else:
        p = PRESET_DIR / f"{domain}.json"
        name = f"presets/skeletons/{domain}.json"
    if not p.is_file():
        avail = ", ".join(sorted(x.stem for x in PRESET_DIR.glob("*.json"))) or "（presets/skeletons/ 为空）"
        fail(f"未知领域骨架：{domain}（找不到 {name}）——可用：{avail}；或 custom:<预设JSON路径>")
        return None
    try:
        doc = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        fail(f"预设 JSON 不可读/非法：{name}（{e}）")
        return None
    files = doc.get("files") if isinstance(doc, dict) else None
    if not isinstance(files, dict) or not all(isinstance(k, str) and isinstance(v, str) for k, v in files.items()):
        fail(f"预设 JSON 结构非法（须含 files:{{路径:模板文本}}，值为字符串）：{name}")
        return None
    dirs = doc.get("directories", [])
    if not isinstance(dirs, list) or not all(isinstance(d, str) for d in dirs):
        fail(f"预设 JSON 结构非法（directories 须为字符串列表）：{name}")
        return None
    oq = doc.get("openQuestions", [])
    if not isinstance(oq, list) or not all(
        isinstance(q, dict) and isinstance(q.get("key"), str) and isinstance(q.get("question"), str) for q in oq
    ):
        fail(f"预设 JSON 结构非法（openQuestions 须为 [{{key,question,…}}]）：{name}")
        return None
    return doc


def assemble_skeleton(preset: dict, pid: str) -> list:
    """预设 JSON → 骨架件清单 [(相对路径, 正文)]；与历史清单同序：files 声明序在前、directories 在后。
    占位符 str.replace 直替（不用 str.format——模板内含 JSON 花括号）。"""
    today = time.strftime("%Y-%m-%d")
    now = time.strftime("%Y-%m-%dT%H:%M:%S")
    items: list = []
    for rel, tmpl in preset["files"].items():
        items.append((rel, tmpl.replace("{createdAt}", now).replace("{today}", today).replace("{project}", pid)))
    for d in preset.get("directories", []):
        items.append((d, None))  # 目录件：仅建目录
    return items


def inject_open_questions(cfg_text: str, questions: list) -> str:
    """把领域预设的 openQuestions 预填进 项目配置.json 文本（解析 → 插在 _注释 之前 → 原格式重序列化）。
    仅 --domain 显式给出且新写配置时发生；缺省路径不注入（历史行为逐字节不变）。"""
    cfg = json.loads(cfg_text)
    merged: dict = {}
    for k, v in cfg.items():
        if k == "_注释":
            merged["openQuestions"] = questions
        merged[k] = v
    if "openQuestions" not in merged:
        merged["openQuestions"] = questions
    return json.dumps(merged, ensure_ascii=False, indent=2) + "\n"


def write_file(proj: Path, rel: str, text: str, created: list):
    p = proj / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8", newline="\n")
    created.append(rel)


def upgrade_project(proj: Path, pid: str, items: list) -> int:
    """存量项目补目录（批次2.5 P1）：只补缺失骨架件；已存在的文件一律跳过，绝不覆盖。
    项目配置.json 已存在即跳过（openQuestions 预填只落新写件；存量要启用请手编）。"""
    if not proj.is_dir():
        return fail(f"项目目录不存在，--upgrade 只补存量项目：{proj}")
    created, skipped = [], []
    for rel, text in items:
        p = proj / rel
        if text is None:  # 目录件：缺才建，在则不动
            if not p.exists():
                p.mkdir(parents=True, exist_ok=True)
                created.append(rel)
            continue
        if p.exists():
            skipped.append(rel)  # 一个字节都不动
            continue
        write_file(proj, rel, text, created)
    print(f"upgraded: {proj}")
    for c in created:
        print("  +", c)
    for s in skipped:
        print("  =", s, "（已存在，跳过不覆盖）")
    print("next: validation / openQuestions 声明位要启用请手编 项目配置.json（口径见 contracts/project-config.schema.json）；"
          f"补卡后 python tools/kit-compile.py --project {pid}")
    return 0


# ── --import：改稿套件导入件（批次3e）─────────────────────────────────────────
IMPORT_SUFFIXES = (".md", ".txt")


def import_docs(proj: Path, pid: str, src_arg: str, subdir: str, base: Path) -> int:
    """成稿导入（批次3e）：递归拷 .md/.txt 进 输入/<subdir>/，不覆盖、落收据、自动索引。
    幂等：同源重跑 = 全部 skipped 零破坏；索引失败不吞（导入即失败，退出非零）。"""
    if not proj.is_dir():
        return fail(f"项目不存在：{proj}——改稿导入要求项目已存在，先建骨架再导入：\n"
                    f"  1. python tools/project-init.py {pid}\n"
                    f"  2. python tools/project-init.py {pid} --import <成稿目录>")
    src = Path(src_arg)
    if not src.is_absolute():
        src = ROOT / src  # 与仓库其他工具同口径：相对路径锚仓库根
    if not src.is_dir():
        return fail(f"源目录不存在或不是目录：{src}")
    if not subdir or subdir in (".", "..") or "/" in subdir or "\\" in subdir:
        return fail(f"--subdir 非法（须为 输入/ 下的单层目录名，不含路径分隔符）：{subdir!r}")
    target_root = proj / "输入" / subdir
    # 自导入精确化（批次3e 实战口径）：只拦「目标落在源目录子树内」（会边拷边复制自己）；
    # 源是项目内的平行目录（如 正文_原版/ → 输入/正文/）是「原位项目收编自有正文」的正场景，放行
    if target_root.resolve().is_relative_to(src.resolve()):
        return fail(f"目标 输入/{subdir}/ 落在源目录子树内，拒绝自拷贝：{src} → {target_root}")

    # 全量先核账再落盘：清单只收 .md/.txt，逐个对位；目标已存在 = skipped（绝不覆盖）
    files = [p for p in sorted(src.rglob("*")) if p.is_file() and p.suffix.lower() in IMPORT_SUFFIXES]
    if not files:
        return fail(f"源目录里没有 .md/.txt 文件，无可导入：{src}")
    plan: list = []
    for p in files:
        rel = p.relative_to(src).as_posix()
        dest = target_root.joinpath(*rel.split("/"))
        plan.append((p, dest, {
            "source": rel,
            "target": dest.relative_to(proj).as_posix(),
            "bytes": p.stat().st_size,
            "action": "skipped" if dest.exists() else "copied",
        }))
    copied, skipped = [], []
    for p, dest, e in plan:
        if e["action"] != "copied":
            skipped.append(e)
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(p.read_bytes())  # 二进制拷贝：不碰内容与换行
        copied.append(e)

    # 收据（报数必附收据）：时间戳命名绝不覆盖旧收据；同秒重跑加序号
    rdir = proj / "registry" / "receipts"
    rdir.mkdir(parents=True, exist_ok=True)
    rpath = rdir / f"project-import-{time.strftime('%Y%m%d-%H%M%S')}.json"
    n = 2
    while rpath.exists():
        rpath = rdir / f"project-import-{time.strftime('%Y%m%d-%H%M%S')}-{n}.json"
        n += 1
    rpath.write_text(json.dumps({
        "tool": "tools/project-init.py --import",
        "project_id": pid,
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "source": src.resolve().as_posix(),
        "target": (Path("输入") / subdir).as_posix(),
        "files": [e for _, _, e in plan],
        "stats": {
            "copied": len(copied),
            "skipped": len(skipped),
            "total": len(plan),
            "bytes_copied": sum(e["bytes"] for e in copied),
        },
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")

    # 自动索引（同解释器子进程；失败不吞——索引失败导入即失败；输出收齐后按序回显，UTF-8 管道）
    r = subprocess.run(
        [sys.executable, str(ROOT / "tools" / "project-index.py"), "build", pid, "--dir", str(base)],
        capture_output=True, text=True, encoding="utf-8",
        env=dict(os.environ, PYTHONIOENCODING="utf-8"),
    )
    print(f"imported: {len(copied)} 篇 / skipped {len(skipped)} 篇（同名不覆盖）→ 输入/{subdir}/")
    for e in copied:
        print(f"  + {e['target']}（{e['bytes']} B）")
    for e in skipped:
        print(f"  = {e['target']}（已存在，跳过）")
    print(f"receipt: {rpath.relative_to(proj).as_posix()}")
    out = (r.stdout or "") + (r.stderr or "")
    if out.strip():
        print(out.rstrip())
    if r.returncode != 0:
        return fail(f"导入后自动索引失败（project-index build 退出码 {r.returncode}）——导入不算完成，先排索引再重跑 --import（全 skipped 零破坏）")
    entries = "?"
    try:
        doc = json.loads((proj / "project-index.json").read_text(encoding="utf-8"))
        entries = str(doc.get("stats", {}).get("total", "?"))
    except Exception:
        pass
    print(f"index: entries={entries}（--import 自动 build；导入件 role=human / kind=导入）")
    print("next: 改稿七步 runbook 见方法卡 kb/method/revise-workflow"
          "（core: node dist/cli.js kb_read --ref kb/method/revise-workflow）")
    return 0


def parse_flags(argv: list) -> tuple[list, dict]:
    """极简解析：位置参数 + --key value 旗标（取值旗标 --dir/--domain/--import/--subdir；
    其余 -- 开头按布尔记）。缺值旗标记 True，由调用方显式报错。"""
    known_val = {"--dir", "--domain", "--import", "--subdir"}
    pos, flags = [], {}
    i = 0
    while i < len(argv):
        a = argv[i]
        if a in known_val:
            # 取值旗标：下一项缺失或又是一个旗标 = 缺值（记 True，调用方显式报错，不误吞旗标）
            if i + 1 >= len(argv) or argv[i + 1].startswith("--"):
                flags[a] = True
                i += 1
            else:
                flags[a] = argv[i + 1]
                i += 2
        elif a.startswith("--"):
            flags[a] = True
            i += 1
        else:
            pos.append(a)
            i += 1
    return pos, flags


def main() -> int:
    argv = sys.argv[1:]
    pos, flags = parse_flags(argv)
    d = flags.get("--dir", "projects")
    base = ROOT / (d if isinstance(d, str) else "projects")
    if not pos:
        print(__doc__)
        return 1
    pid = pos[0]
    proj = base / pid
    # 领域骨架解析（批次4 4.2）：缺省 writing 只装文件不注入询问（历史行为逐字节不变）；
    # 显式 --domain 装配预设全量（文件 + openQuestions 预填）。
    domain = flags.get("--domain")
    if domain is True:
        return fail("--domain 缺值：--domain <writing|writing-剧本短剧|custom:<预设JSON路径>>")
    domain_given = domain is not None
    preset = load_preset(str(domain) if domain_given else "writing")
    if preset is None:
        return 1
    items = assemble_skeleton(preset, pid)
    questions = preset.get("openQuestions") or []
    injected = bool(domain_given and questions)
    if injected:
        items = [(rel, inject_open_questions(text, questions) if rel == "项目配置.json" else text)
                 for rel, text in items]
    if "--import" in flags:
        src = flags.get("--import")
        if src is True:
            return fail("--import 缺值：--import <成稿目录>")
        subdir = flags.get("--subdir", "正文")
        if subdir is True:
            return fail("--subdir 缺值：--subdir <输入/下的子目录名>（缺省「正文」）")
        return import_docs(proj, pid, str(src), str(subdir), base)
    if "--upgrade" in flags:
        return upgrade_project(proj, pid, items)
    if proj.exists() and any(proj.iterdir()):
        return fail(f"目录已存在且非空，拒绝初始化：{proj}")

    created: list = []
    for rel, text in items:
        if text is None:
            (proj / rel).mkdir(parents=True, exist_ok=True)
            created.append(rel)
        else:
            write_file(proj, rel, text, created)

    print(f"initialized: {proj}")
    for c in created:
        print("  +", c)
    if injected:
        print(f"next: 冷启动询问 {len(questions)} 项已预填 项目配置.json openQuestions——"
              "会话 agent 逐条向用户询问并把答案回填 answer 字段（图/视频场景必须拿到生图接口）")
    print("next: 绑定 flow 后由内核创建 state.json（流程身份以 state.json 为准，铁律 8）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
