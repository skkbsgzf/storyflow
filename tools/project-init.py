"""project-init · 按规范 R6 §五 新布局初始化一个空项目

创建：
  projects/<id>/
  ├─ 项目配置.json            # flowId 置 null——流程身份由内核 flow_start 绑定（铁律 8），init 不猜
  │                           #   含 validation 校验标准声明位（批次2.5 P1，声明位先行）
  ├─ 输入/点子.md             # 人写：点子 / 素材 / 需求（骨架模板）
  ├─ 世界书/                  # 跨模块共享状态：设定 / 人物 / 时间线 / 词表
  ├─ 文风/                    # 人写：文风样本 + 文风规则卡（批次2.5 P1；rule-card@1 信封模板）
  ├─ 规则/                    # 人写：项目专属禁则/偏好卡（升格全局需过专名清洗）
  ├─ 交付/README.md           # NN- 定序交付出口的命名说明
  ├─ registry/receipts/       # 机器区：收据（原 内部/收据 错位，R6 §五-1 归位）
  └─ snapshots/

子命令：
  （缺省）      新项目全量骨架；目录已存在且非空 → 拒绝（绝不覆盖/合并存量项目）。
  --upgrade     存量项目补目录（批次2.5 P1）：逐件核对骨架清单，**只补缺失的文件/目录**，
                已存在的一律跳过、一个字节不动；项目配置.json 已存在也不动
                （validation 声明位要启用请手编，字段口径见 contracts/project-config.schema.json）。

纪律：
  - 只建骨架，不建 state.json / flow 绑定 / registry 索引（那是内核与 flow 的事）；
  - 不引 LLM、不联网；幂等性靠「新项目已存在即拒绝 / --upgrade 已存在即跳过」保证；
  - 模板是范式不是概括：kit 只给形，不猜你的内容——条款与样本必须由用户填实。

用法：
  python tools/project-init.py <projectId> [--dir projects]             # 新项目
  python tools/project-init.py <projectId> --upgrade [--dir projects]   # 存量项目补目录
退出码：成功 0；拒绝/失败 1。
"""
import json, sys, time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

POINT_TMPL = """# 点子

> 一句话卖点：〔在这里写一句话卖点，≤40 字〕

## 素材

- 〔素材 / 参考链接 / 热点，逐条列〕

## 需求

- 〔题材 / 篇幅 / 平台 / 受众等硬性要求〕
"""

SHEDING_TMPL = """# 设定

> 世界规则的最高约束，跨模块共享；改这里必须过 世界书/纪律 的口径。

- 〔力量体系 / 世界规则，逐条列〕
"""

RENWU_TMPL = """# 人物

> 主要人物卡。命名纪律：本项目的专名绝不进入其他项目（AGENTS 铁律 5）。

## 〔人物名〕

- 一句话：〔身份 × 欲望 × 缺口〕
"""

TIME_TMPL = """# 时间线

> 编年骨架：大事按序排，章账细节进 世界书/编年/。

- 〔第 1 日〕〔事件〕
"""

CIBIAO_SKEL = {
  "entries": []
}

DELIVERY_TMPL = """# 交付目录说明

- 本目录是**定序交付出口**：文件名 `NN-名称.md`（NN=两位序号，按交付顺序）。
- 只放对外终稿；过程产物留在各模块目录（`01-选题/` `02-方案/` `03-编剧/` `04-写作/` …）。
- 序号缺口是历史事实，禁止为好看而重排（禁止补拍洗白）。
"""

STYLE_DIR_README = """# 文风目录说明

- 本目录是**本项目独有文风**的家（需求1：每个项目允许独立的文风）：文风样本 md + 文风规则卡。
- `文风规则-模板.md` 是范式不是概括——**kit 只给形，不猜你的内容**：复制改名为正式卡
  （如 `文风规则-主线.md`），把样本与条款填实后才算生效；模板本身空着就是占位。
- 文风卡走 rule-card@1 信封（契约 contracts/rule.schema.json；kit-lint E12 同款信封校验）；
  dimension 固定 style，id 用 `pj-style/<项目id>/<名>` 命名空间（与全局 kb/rules/ 不撞号）。
- 编译：`python tools/kit-compile.py --project <id>` 后进项目档 RAG；core `kb_search` 带
  project 参数可命中（domain=文风）。本目录人写，索引工具标注 role=human（只读不覆写）。
"""

RULES_DIR_README = """# 规则目录说明

- 本目录是**项目专属规则**的家：项目禁则/偏好（专名保护、题材红线、平台特殊要求、叙事规约…）。
- `项目规则-模板.md` 是范式不是概括——**kit 只给形，不猜你的内容**：dimension 留空待你填
  （小写 slug，如 naming / platform-redline，契约 pattern `^[a-z][a-z0-9-]*$`），条款填实后才算生效。
- 立场铁律：本目录的卡是**语料不是闸**（v5.0 去闸化）——供 orchestrator 激活、agent 评审引用，
  severity 是评审优先级，**绝不构成提交拦截**。
- 升格纪律：项目规则要升格为全局规则（knowledge/rules/）时，必须先过**专名清洗**
  （本项目专名绝不进入其他项目，AGENTS 铁律 5）。
"""


def style_card_tmpl(pid: str, today: str) -> str:
    """文风规则卡模板（rule-card@1 信封合法；clauses 以注释态示例给出，未生效）。"""
    return f"""---
{{
  "id": "pj-style/{pid}/voice",
  "type": "rule-corpus",
  "title": "文风规则卡（模板——填实后复制改名生效）",
  "dimension": "style",
  "version": "0.1.0",
  "status": "active",
  "activation_hint": ["m3.成文", "polish"],
  "provenance": {{
    "source": "project-init 骨架模板（批次2.5 P1）——样本与条款由本项目人写填实",
    "refs": []
  }},
  "updated": "{today}",
  "format": "rule-card@1"
}}
---

# 文风规则 · 本项目独有文风

> **kit 只给形，不猜你的内容**：本卡是范式（rule-card@1 信封已合法），条款与样本必须由你填；
> 空着就是占位，不构成任何约束。

## 文风样本（人写——文风对齐的事实源）

- 〔贴 2-3 段最认可的成稿样本：句式、节奏、用词的实样〕

## 条款（示例注释态，未生效——填实后升格进 frontmatter 的 clauses[]）

<!-- 示例一（tier=A，句式指纹）：短句为主，单句 ≤ 25 字，从句嵌套 ≤ 两层 → repair：拆句重排。 -->
<!-- 示例二（tier=S，禁词）：全稿禁用〔本项目禁词表〕 → repair：按词表替换并复查语境。 -->
<!-- 示例三（tier=B，语感）：叙述贴主角体感，不出现上帝视角总结句 → repair：改为人物在场感知。 -->
<!-- 口径：tier S/A/B 与 severity block/major/minor 的定义见 contracts/rule.schema.json；
     severity 是评审优先级不是提交闸（v5.0 去闸化）；B 级产物只能「证据 + 建议」，绝不自动改稿。 -->
"""


def rule_card_tmpl(pid: str, today: str) -> str:
    """项目规则卡模板（rule-card@1 信封合法；dimension 留空待用户填）。"""
    return f"""---
{{
  "id": "pj-rules/{pid}/project",
  "type": "rule-corpus",
  "title": "项目规则卡（模板——填实后复制改名生效）",
  "dimension": "",
  "version": "0.1.0",
  "status": "active",
  "activation_hint": ["m2.编剧", "m3.成文"],
  "provenance": {{
    "source": "project-init 骨架模板（批次2.5 P1）——禁则与条款由本项目人写填实",
    "refs": []
  }},
  "updated": "{today}",
  "format": "rule-card@1"
}}
---

# 项目规则 · 本项目专属禁则与偏好

> **kit 只给形，不猜你的内容**：dimension 留空待填（小写 slug，如 naming / platform-redline，
> 契约 pattern `^[a-z][a-z0-9-]*$`）；禁则与条款必须由你填，空着就是占位。

## 项目禁则（人写）

- 〔项目专属禁则：专名保护（本项目专名绝不外流）、题材红线、平台特殊要求…〕

## 偏好（人写）

- 〔项目偏好：叙事习惯、章节体量、命名规约…〕

## 条款（示例注释态，未生效——填实后升格进 frontmatter 的 clauses[]）

<!-- 示例（tier=S，专名保护）：〔主角名〕〔势力名〕等项目专名不得出现在其他项目交付物 → repair：定位并替换。 -->
<!-- 升格纪律：本卡条款要升格为全局规则（knowledge/rules/）时，必须先过专名清洗（AGENTS 铁律 5）。 -->
"""


def config_json(pid: str) -> str:
    """项目配置.json 骨架。批次2.5 P1：补 schema required 键「项目」（此前缺它，flow_run 的
    project-config 校验会大声失败）；加 validation 校验标准声明位（additive optional，声明位先行）。
    JSON 无注释位，说明走「_注释」键（契约 additionalProperties:true，内核不消费下划线键）。"""
    return json.dumps({
        "项目": pid,
        "id": pid,
        "title": pid,
        "flowId": None,
        "flowVersion": None,
        "createdAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "layout": "r6",
        "validation": {
            "tierThreshold": ["S", "A"],
            "cardScope": "both",
            "severityFloor": "minor",
        },
        "_注释": "validation=校验标准声明位（批次2.5 P1，契约 contracts/project-config.schema.json）："
                "tierThreshold=本项目评审跑哪些分级（S/A/B 子集，缺省 S+A；B 级主观审美归 agent 评审通道）；"
                "cardScope=规则卡装载范围（global=全局 knowledge/rules 卡 / project=本项目 文风+规则 卡 / both=双家，缺省 both）；"
                "severityFloor=评审优先级下限（block|major|minor，缺省 minor=全量；是评审优先级不是提交闸）。"
                "声明位已变现（批次3a P6）：diag_scan 快诊断消费三旋钮（tierThreshold 定分级通道 / cardScope 定装卡 / severityFloor 定产出下限），口径见 core/src/diagnosis.ts。",
    }, ensure_ascii=False, indent=2) + "\n"


def skeleton_files(pid: str) -> list:
    """骨架件清单：(相对路径, 正文)；正文 None = 仅建目录。init 与 --upgrade 共用同一清单。"""
    today = time.strftime("%Y-%m-%d")
    return [
        ("项目配置.json", config_json(pid)),
        ("输入/点子.md", POINT_TMPL),
        ("世界书/设定.md", SHEDING_TMPL),
        ("世界书/人物.md", RENWU_TMPL),
        ("世界书/时间线.md", TIME_TMPL),
        ("世界书/词表.json", json.dumps(CIBIAO_SKEL, ensure_ascii=False, indent=2) + "\n"),
        ("文风/README.md", STYLE_DIR_README),
        ("文风/文风规则-模板.md", style_card_tmpl(pid, today)),
        ("规则/README.md", RULES_DIR_README),
        ("规则/项目规则-模板.md", rule_card_tmpl(pid, today)),
        ("交付/README.md", DELIVERY_TMPL),
        ("registry/receipts/", None),
        ("snapshots/", None),
    ]


def fail(msg: str) -> int:
    print(f"[ABORT] {msg}")
    return 1


def parse_base(argv: list) -> Path:
    base = ROOT / "projects"
    for i, a in enumerate(argv):
        if a == "--dir" and i + 1 < len(argv):
            base = ROOT / argv[i + 1]
    return base


def write_file(proj: Path, rel: str, text: str, created: list):
    p = proj / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8", newline="\n")
    created.append(rel)


def upgrade_project(proj: Path, pid: str) -> int:
    """存量项目补目录（批次2.5 P1）：只补缺失骨架件；已存在的文件一律跳过，绝不覆盖。"""
    if not proj.is_dir():
        return fail(f"项目目录不存在，--upgrade 只补存量项目：{proj}")
    created, skipped = [], []
    for rel, text in skeleton_files(pid):
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
    print("next: validation 声明位要启用请手编 项目配置.json（口径见 contracts/project-config.schema.json）；"
          f"补卡后 python tools/kit-compile.py --project {pid}")
    return 0


def main() -> int:
    argv = sys.argv[1:]
    upgrade = "--upgrade" in argv
    args = [a for a in argv if not a.startswith("--")]
    base = parse_base(argv)
    if not args:
        print(__doc__)
        return 1
    pid = args[0]
    proj = base / pid
    if upgrade:
        return upgrade_project(proj, pid)
    if proj.exists() and any(proj.iterdir()):
        return fail(f"目录已存在且非空，拒绝初始化：{proj}")

    created: list = []
    for rel, text in skeleton_files(pid):
        if text is None:
            (proj / rel).mkdir(parents=True, exist_ok=True)
            created.append(rel)
        else:
            write_file(proj, rel, text, created)

    print(f"initialized: {proj}")
    for c in created:
        print("  +", c)
    print("next: 绑定 flow 后由内核创建 state.json（流程身份以 state.json 为准，铁律 8）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
