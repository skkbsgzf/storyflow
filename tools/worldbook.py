"""世界书 · 脚手架与校验（零依赖，所有叙事项目通用）

体系标准：knowledge/continuity/worldbook.md（小说/剧本双变体，逆向 deepwrite）。

用法：
  python tools/worldbook.py init <project> [--variant novel|drama]   # 生成本项目世界书骨架（不覆盖已有）
  python tools/worldbook.py check <project>                          # 校验索引与文件一致性
  python tools/worldbook.py tree <project>                           # 打印结构树
"""
import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
KIT_MARK = Path(__file__).resolve().parent / "kit.json"
def proj_dir(name):
    # kit vendor 模式：本工具被 kit.py 拷贝进 <project>/kit/ 内时，
    # kit/ 上一级即项目根（kit.json 为标记）；常驻模式返回中心工作区路径。
    if KIT_MARK.exists():
        return ROOT
    return ROOT / "projects" / name



VARIANTS = {
    "novel": {
        "结算单位": "章",
        "dirs": ["设定", "人物", "势力", "地理", "编年", "伏笔", "底牌"],
        "ledger": "编年/章账.md",
        "extra": "名目层入 设定/名目与黑话.md；成长阶/招式名目先登记再进正文",
    },
    "drama": {
        "结算单位": "集",
        "dirs": ["设定", "人物", "势力", "场景", "道具", "分集账", "伏笔", "底牌"],
        "ledger": "分集账/集账.md",
        "extra": "场景卡联动有名场景≤3 硬约束；道具卡管连续性信物；与 词汇表.json 并行（词汇表管专名安全，世界书管设定真相）",
    },
}

DISCIPLINE = """# 世界书纪律（{variant_name}变体）

> 体系标准：knowledge/continuity/worldbook.md ｜ 结算单位：**{unit}** ｜ 状态机：draft → active → retired（不删档）

## 章回结算五件（每{unit}交稿后、下一{unit}派发前）

1. 章卡/集卡（一句话+梗点+钩型+新名目）→ {ledger}
2. 人物状态推进（伤/钱/知情/关系/位置）→ 人物/*.md（当前状态改写+变动史追加）
3. 交接（下一{unit}写手必知的 3-5 条）→ {ledger} 末节
4. 伏笔变动（新埋/回收/顺期）→ 伏笔/台账.md
5. 世界揭示（本{unit}确立的新设定事实）→ 设定/*.md

## RAG 规则（写第 N {unit}的开工动作）

1. 读 index.json 按 tags 拉词条（不重读全书）
2. 读 {ledger} 末节（=上一{unit} handoff）
3. 读伏笔台账中 open 且临近回收的条目
4. 底牌按节点号取段，禁止整读

## 变体特例

{extra}
"""


def index_path(project: str) -> Path:
    return proj_dir(project) / "世界书" / "index.json"


def cmd_init(project: str, variant: str) -> int:
    spec = VARIANTS.get(variant)
    if not spec:
        print(f"未知变体: {variant}（可选: {', '.join(VARIANTS)}）")
        return 2
    base = proj_dir(project) / "世界书"
    if index_path(project).exists():
        print(f"已存在世界书: {index_path(project)}（init 不覆盖，如需重建请手动处理）")
        return 1
    created, skipped = [], []
    for d in ["."] + spec["dirs"]:
        target = base if d == "." else base / d
        target.mkdir(parents=True, exist_ok=True)
    idx = {
        "世界书": f"{project} 世界书（{variant_name(variant)}变体）",
        "变体": variant,
        "version": "1.0.0",
        "updated": "2026-09-17",
        "note": "唯一 RAG 入口；文件即真相；章(集)回交稿后按 纪律.md 结算五件",
        "状态机": "draft → active → retired",
        "sections": [
            {"id": d, "title": d, "format": "list", "file": f"世界书/{d}/", "entries": []}
            for d in spec["dirs"]
            if d not in ("伏笔", "底牌")
        ] + [
            {"id": "伏笔", "title": "伏笔台账", "format": "text", "file": "世界书/伏笔/台账.md"},
            {"id": "底牌", "title": "暗线底牌（作者专用·永不入正文）", "format": "text", "file": "世界书/底牌/暗线底牌.md"},
        ],
    }
    idx_file = base / "index.json"
    idx_file.write_text(json.dumps(idx, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    created.append(str(idx_file.relative_to(ROOT)))
    disc = base / "纪律.md"
    if not disc.exists():
        disc.write_text(DISCIPLINE.format(variant_name=variant_name(variant), unit=spec["结算单位"], **spec), encoding="utf-8")
        created.append(str(disc.relative_to(ROOT)))
    ledger = base / spec["ledger"]
    ledger.parent.mkdir(parents=True, exist_ok=True)
    if not ledger.exists():
        unit = spec["结算单位"]
        ledger.write_text(f"# {unit}账（逐{unit}结算 = handoff）\n\n> 每{unit}交稿后追加一节；下一{unit}写手只读末节。\n\n## 交接（开局状态 · 第 1 {unit}前）\n\n- （待填）\n", encoding="utf-8")
        created.append(str(ledger.relative_to(ROOT)))
    fb = base / "伏笔" / "台账.md"
    if not fb.exists():
        fb.write_text("# 伏笔台账\n\n| fid | 内容 | 埋点 | 预定回收 | 状态 |\n| --- | --- | --- | --- | --- |\n", encoding="utf-8")
        created.append(str(fb.relative_to(ROOT)))
    print(f"init [{variant_name(variant)}变体] created={len(created)} skipped={len(skipped)}")
    for c in created:
        print("  +", c)
    return 0


def variant_name(variant: str) -> str:
    return {"novel": "小说", "drama": "剧本"}.get(variant, variant)


def cmd_check(project: str) -> int:
    ip = index_path(project)
    if not ip.exists():
        print(f"MISSING 索引: {ip}")
        return 1
    d = json.loads(ip.read_text(encoding="utf-8"))
    problems, n_entries, statuses = [], 0, {}
    for s in d.get("sections", []):
        for e in s.get("entries", []):
            n_entries += 1
            f = proj_dir(project) / e.get("file", "")
            if not f.exists():
                problems.append(f"缺文件: {e['id']} -> {e['file']}")
            st = e.get("status", "?")
            statuses[st] = statuses.get(st, 0) + 1
            if st not in ("draft", "active", "retired"):
                problems.append(f"非法状态: {e['id']} ({st})")
    print(f"{project}: sections={len(d.get('sections', []))} entries={n_entries} status={statuses}")
    if problems:
        for p in problems:
            print("  !", p)
        return 1
    print("check OK")
    return 0


def cmd_tree(project: str) -> int:
    base = proj_dir(project) / "世界书"
    if not base.exists():
        print(f"无世界书: {base}")
        return 1

    def walk(d: Path, depth: int = 0):
        for child in sorted(d.iterdir()):
            if child.is_dir():
                print("  " * depth + child.name + "/")
                walk(child, depth + 1)
            else:
                print("  " * depth + child.name)

    walk(base)
    return 0


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("init", "check", "tree"):
        sp = sub.add_parser(name)
        sp.add_argument("project")
        if name == "init":
            sp.add_argument("--variant", default="novel", choices=list(VARIANTS))
    args = ap.parse_args()
    if args.cmd == "init":
        sys.exit(cmd_init(args.project, args.variant))
    if args.cmd == "check":
        sys.exit(cmd_check(args.project))
    if args.cmd == "tree":
        sys.exit(cmd_tree(args.project))


if __name__ == "__main__":
    main()
