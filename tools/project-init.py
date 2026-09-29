"""project-init · 按规范 R6 §五 新布局初始化一个空项目

创建：
  projects/<id>/
  ├─ 项目配置.json            # flowId 置 null——流程身份由内核 flow_start 绑定（铁律 8），init 不猜
  ├─ 输入/点子.md             # 人写：点子 / 素材 / 需求（骨架模板）
  ├─ 世界书/                  # 跨模块共享状态：设定 / 人物 / 时间线 / 词表
  ├─ 交付/README.md           # NN- 定序交付出口的命名说明
  ├─ registry/receipts/       # 机器区：收据（原 内部/收据 错位，R6 §五-1 归位）
  └─ snapshots/

纪律：
  - 目录已存在且非空 → 拒绝（绝不覆盖/合并存量项目）；
  - 只建骨架，不建 state.json / flow 绑定 / registry 索引（那是内核与 flow 的事）；
  - 不引 LLM、不联网；幂等性靠「已存在即拒绝」保证。

用法：
  python tools/project-init.py <projectId> [--dir projects]
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


def fail(msg: str) -> int:
    print(f"[ABORT] {msg}")
    return 1


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    base = ROOT / "projects"
    for i, a in enumerate(sys.argv):
        if a == "--dir" and i + 1 < len(sys.argv):
            base = ROOT / sys.argv[i + 1]
    if not args:
        print(__doc__)
        return 1
    pid = args[0]
    proj = base / pid
    if proj.exists() and any(proj.iterdir()):
        return fail(f"目录已存在且非空，拒绝初始化：{proj}")

    created = []

    def put(rel: str, text: str):
        p = proj / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8", newline="\n")
        created.append(rel)

    def mkdir(rel: str):
        (proj / rel).mkdir(parents=True, exist_ok=True)
        created.append(rel + "/")

    put("项目配置.json", json.dumps({
        "id": pid,
        "title": pid,
        "flowId": None,
        "flowVersion": None,
        "createdAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "layout": "r6",
    }, ensure_ascii=False, indent=2) + "\n")
    put("输入/点子.md", POINT_TMPL)
    put("世界书/设定.md", SHEDING_TMPL)
    put("世界书/人物.md", RENWU_TMPL)
    put("世界书/时间线.md", TIME_TMPL)
    put("世界书/词表.json", json.dumps(CIBIAO_SKEL, ensure_ascii=False, indent=2) + "\n")
    put("交付/README.md", DELIVERY_TMPL)
    mkdir("registry/receipts")
    mkdir("snapshots")

    print(f"initialized: {proj}")
    for c in created:
        print("  +", c)
    print("next: 绑定 flow 后由内核创建 state.json（流程身份以 state.json 为准，铁律 8）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
