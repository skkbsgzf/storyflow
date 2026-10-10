#!/usr/bin/env python3
"""habit-distill · 用户创作习惯提炼通道（批次3c R3）：collect → distill → land。

定位（ARCHITECTURE §3.5「拆=样本→规则回流」的**个人变体**）：
  拆（逆向）从「别人的样本」提规则；习惯通道从「用户自己的成稿与决策记录」提创作习惯。
  两者同构：素材 →（归纳）→ 草稿卡 → 人审 → 落 knowledge/craft/（文风域，user-style-rules 的家）。
  工程模式照抄 tools/deconstruct.py：素材清单零正文搬运 / 草稿与人审分离 / land 拒绝纪律。

诚实边界（本工具的头等纪律，写死在行为里）：
  **习惯归纳是语义工作，本工具不做。** collect/distill 只做「素材组装 + 格式骨架」，
  绝不发明条款内容——草稿卡的 clauses 留空、status=draft；条款由人归纳填写
  （或未来批次接 LLM 的 agent 局部件完成，对齐 mf_deconstruct 模式——本包克制，
  不新增 core agent 工具）。land 只收「人已归纳条款并显式推 status」的草稿，
  工具永不代推状态。不冒充智能。

子命令：
  collect <projectId> [--dir projects]
      确定性收集素材清单 → projects/_reports/habit-collect-<projectId>.json：
      ① 成稿产物（projects/<id>/交付|正文 区 md：标题 + 首段引文≤100字 + 字数统计，
         绝不整文搬运）；② 记忆卡清单（世界书/记忆卡-*.md：session_id/轮数/updated）；
      ③ user-style-rules 既有条款清单（knowledge/craft/user-style-rules.md 的 ### R 条目，
         标注是否有机械判定——新习惯条款须与之对表防重复）。
      收据不含生成时刻，同状态重跑逐字节一致；收据落 projects/_reports/（gitignore 域）。
  distill <素材收据.json> [--slug <slug>] [--track 文风|通用]
      素材收据 → 习惯卡**草稿** projects/_reports/habit-drafts/habit-<slug>-draft.md：
      rule-card@1 信封形状（复用既有契约形态，**不新增契约**），status=draft、clauses=[]
      （语义提炼未发生）、条款 id 前缀预留 HB-（habit 出身，区别台账 AE-id 与拆书 DC-id）、
      provenance 指向素材收据与来源文件；正文=素材底账（成稿清单/既有条款对照/占位条款区）。
      草稿落 projects/_reports/habit-drafts/ 而非 knowledge/ 待审区——比 deconstruct 的
      「待审区即 knowledge/」更保守一档：习惯卡的语义提炼尚未发生，knowledge/ 只收人审后的卡。
      同名草稿已存在拒绝（不覆盖）。
  land <草稿.md> [--to <knowledge子域>]
      人审后落库：status=draft 拒落（归纳与人审是前置）、status=landed 拒落（已落过）、
      clauses 空骨架拒落、条款 id 非 HB- 前缀拒落（出身纪律，防搬运台账/拆书 id）、
      目标 knowledge/<域>/habit-<slug>.md 已存在拒落（同 id 拒覆盖，绝不静默覆盖）。
      缺省落 knowledge/craft/（文风域）；--to 须是盘上已存在的 knowledge/ 子目录
      （rules/ 除外——那是 AE-id 台账迁移卡的家法，习惯卡不去）；跨域落点显式改写卡 id。
      落完把草稿存根 status 记为 landed（防重复人审），并提示 kit-compile 重编译。
  --selfcheck
      合成 fixture 全链自测（临时目录：collect 素材账与引文限长 / distill 骨架 /
      draft 拒落 / 空骨架拒落 / 人审后落位 / 同 id 幂等拒绝 / 收据确定性）——
      零写真实 projects/ 与真实 knowledge/。

退出码：0 成功；1 校验失败 / 拒绝 / 输入不存在；2 用法错误（argparse）。
"""
import argparse
import json
import re
import sys
import tempfile
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# ── 常量 ────────────────────────────────────────────────────────────────────────
COLLECT_FORMAT = "habit-collect@1"
DELIVERY_DIRS = ("交付", "正文")          # 成稿产物区（哪个存在用哪个；项目实际以 正文/ 为主）
MEMORY_DIR = "世界书"                     # 记忆卡所在（tools/project-index.py memory 的产物）
MEMORY_CARD_RE = re.compile(r"^记忆卡-.+\.md$")
SESSIONS_DIR = "内部/sessions"
STYLE_RULES_REL = "knowledge/craft/user-style-rules.md"
EXCERPT_MAX = 100                        # 首段引文限长（纪律：引文≤100 字，绝不整文搬运）
RULE_HEAD_RE = re.compile(r"^#{2,3}\s+(R\d+)\s*[·•]\s*(.+?)\s*$")  # 用户手改区标题层级不一（##/### 兼容）
MACHINE_RE = re.compile(r"^\s*[-*]?\s*机械判定[：:]\s*(.*)$")
FRONT_KV_RE = re.compile(r"^([A-Za-z_][\w-]*):\s*(.*)$")
FRONT_BLOCK_RE = re.compile(r"\A---\s*\n(.*?)\n---\s*\n?", re.S)
HB_ID_RE = re.compile(r"^HB-[A-Z0-9-]+$")
CARD_ID_RE = re.compile(r"^kb/([a-z][a-z0-9-]*)/habit-([a-z0-9-]+)$")
DRAFT_SUFFIX = "-draft"
DRAFTS_DIRNAME = "habit-drafts"          # 草稿区：projects/_reports/habit-drafts/

DRAFT_BANNER = (
    "> **草稿待提炼**（habit-distill 产出）：本卡只做了素材组装与格式骨架，习惯归纳是语义工作——\n"
    "> 条款由人归纳填写（HB- 前缀；口径/判定/修复三柱参照 knowledge/deconstruct/ 草稿卡式样），\n"
    "> 填好后把 status 推为 active 再 land 落 knowledge/；本工具绝不代推状态、不发明条款。"
)
LANDED_BANNER = (
    "> **本卡是语料不是闸**（v5.0：只用 agent，不用断言）。\n"
    "> 用户习惯卡（habit-distill 通道）：条款提炼自用户成稿与会话素材，已经人审（status=active）；\n"
    "> 出身收据见 provenance.refs；可机械计数的条款可归 prose-scan/quality-scan 出收据证据。"
)


def load_json(path: Path):
    if not path.exists():
        print(f"[ABORT] 输入不存在：{path}", file=sys.stderr)
        raise SystemExit(1)
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:  # noqa: BLE001
        print(f"[ABORT] 输入不是合法 JSON：{path}（{e}）", file=sys.stderr)
        raise SystemExit(1)


def to_posix(p: Path) -> str:
    return p.as_posix()


def _strip_front(text: str) -> str:
    m = FRONT_BLOCK_RE.match(text)
    return text[m.end():] if m else text


def first_paragraph(body: str, cap: int = EXCERPT_MAX) -> str:
    """首段引文：跳过标题行与空行，取首个非空行，压平空白；超长截断加省略号（≤cap 字）。"""
    for line in body.splitlines():
        s = re.sub(r"\s+", " ", line.strip())
        if not s or s.startswith("#") or s.startswith(">"):
            continue
        return s[:cap] + ("…" if len(s) > cap else "")
    return ""


# ── collect：素材清单（确定性，零正文搬运）───────────────────────────────────────
def parse_style_rules(root: Path) -> list:
    """user-style-rules 既有条款清单：### R<n> · <名> + 是否带机械判定（留空=仅人工执行）。"""
    p = root / STYLE_RULES_REL
    if not p.exists():
        return []
    out, cur = [], None
    for line in p.read_text(encoding="utf-8").splitlines():
        h = RULE_HEAD_RE.match(line)
        if h:
            cur = {"rule": h.group(1), "name": h.group(2), "machine": False}
            out.append(cur)
            continue
        if cur is not None:
            m = MACHINE_RE.match(line)
            if m:
                val = m.group(1).strip()
                if val and not val.startswith("留空"):
                    cur["machine"] = True
    return out


def collect_material(pid: str, root: Path, projects_dir: str = "projects") -> dict:
    """素材收集本体（selfcheck 复用）：返回收据 dict（含限长引文，绝不整文搬运）。"""
    proj = root / projects_dir / pid
    if not proj.is_dir():
        print(f"[ABORT] 项目目录不存在：{proj}", file=sys.stderr)
        raise SystemExit(1)
    # ① 成稿产物
    drafts, chars_total = [], 0
    seen_rels: set = set()
    for sub in DELIVERY_DIRS:
        d = proj / sub
        if not d.is_dir():
            continue
        for p in sorted(d.rglob("*.md")):
            rel = to_posix(p.relative_to(proj))
            if rel in seen_rels:
                continue
            seen_rels.add(rel)
            body = _strip_front(p.read_text(encoding="utf-8"))
            heads = re.findall(r"^#\s+(.+?)\s*$", body, re.M)
            drafts.append({
                "file": rel,
                "title": heads[0] if heads else p.stem,
                "chars": len(body),
                "excerpt": first_paragraph(body),
            })
            chars_total += len(body)
    drafts.sort(key=lambda x: x["file"])
    # ② 记忆卡清单（frontmatter 的 session_id/turns/updated；卡本身是派生物，清单只记账）
    memory_cards = []
    wdir = proj / MEMORY_DIR
    if wdir.is_dir():
        for p in sorted(wdir.glob("记忆卡-*.md")):
            fm = {}
            m = FRONT_BLOCK_RE.match(p.read_text(encoding="utf-8"))
            if m:
                for line in m.group(1).splitlines():
                    kv = FRONT_KV_RE.match(line)
                    if kv:
                        fm[kv.group(1)] = kv.group(2).strip()
            memory_cards.append({
                "file": to_posix(p.relative_to(proj)),
                "session_id": fm.get("session_id", p.stem.removeprefix("记忆卡-")),
                "turns": int(fm["turns"]) if str(fm.get("turns", "")).isdigit() else None,
                "updated": fm.get("updated", ""),
            })
    # ③ 会话（只计数，内容不进收据——会话归纳走 project-index memory 先落记忆卡）
    sdir = proj / SESSIONS_DIR
    sessions = sorted(x.name for x in sdir.glob("*.jsonl")) if sdir.is_dir() else []
    # ④ 既有习惯条款（user-style-rules）
    rules = parse_style_rules(root)
    return {
        "format": COLLECT_FORMAT,
        "project": pid,
        "root_scope": f"{projects_dir}/{pid}/",   # 双根铁律：素材只收数据根，repoRoot 语料只对表条款清单
        "drafts": drafts,
        "memory_cards": memory_cards,
        "sessions": {"dir": SESSIONS_DIR, "count": len(sessions)},
        "existing_rules": rules,
        "stats": {
            "drafts": len(drafts),
            "chars_total": chars_total,
            "memory_cards": len(memory_cards),
            "sessions": len(sessions),
            "existing_rules": len(rules),
        },
        "note": f"素材清单只带标题+首段引文（≤{EXCERPT_MAX} 字）+字数，绝不整文搬运；"
                "收据落 projects/_reports/（不入库）；引文出处=数据根 projects/ 下的原文件",
    }


def cmd_collect(pid: str, root: Path, projects_dir: str) -> int:
    receipt = collect_material(pid, root, projects_dir)
    out = root / projects_dir / "_reports" / f"habit-collect-{pid}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    s = receipt["stats"]
    print(f"collect: 成稿 {s['drafts']} 篇（{s['chars_total']} 字）／记忆卡 {s['memory_cards']} 张"
          f"／会话 {s['sessions']} 个／既有习惯条款 {s['existing_rules']} 条")
    for d in receipt["drafts"][:5]:
        print(f"  · {d['file']}（{d['chars']} 字）：{d['excerpt']}")
    if len(receipt["drafts"]) > 5:
        print(f"  …（其余 {len(receipt['drafts']) - 5} 篇见收据）")
    if s["drafts"] == 0 and s["memory_cards"] == 0:
        print("  · 注意：成稿与记忆卡皆空——没有素材就没有归纳，先跑生产线或 project-index memory")
    print(f"收据 → {out}")
    print(f"next: python tools/habit-distill.py distill \"{out}\"")
    return 0


# ── distill：素材收据 → 习惯卡草稿（只组装，不归纳）─────────────────────────────
def render_draft_md(env: dict, receipt: dict) -> str:
    """草稿正文：确定性组装（内容全部来自收据与信封自身，不发明内容）。"""
    s = receipt["stats"]
    lines = [
        "---",
        json.dumps(env, ensure_ascii=False, indent=2),
        "---",
        "",
        f"# {env['title']}",
        "",
        DRAFT_BANNER,
        "",
        "## 素材底账",
        "",
        f"- 成稿 {s['drafts']} 篇 / 共 {s['chars_total']} 字（清单只带标题+首段引文≤{EXCERPT_MAX} 字，原文在项目数据根）",
        f"- 记忆卡 {s['memory_cards']} 张 / 会话 {s['sessions']} 个（逐轮用户输入账见 projects/<id>/世界书/记忆卡-*.md）",
        f"- 既有习惯条款 {s['existing_rules']} 条（user-style-rules）——**新条款须与下表对表防重复**",
        "",
        "## 成稿清单（标题 · 字数 · 首段引文）",
        "",
    ]
    for d in receipt["drafts"]:
        lines.append(f"- {d['title']}（{d['chars']} 字）：{d['excerpt']}")
    lines += ["", "## 既有条款对照（user-style-rules）", ""]
    for r in receipt["existing_rules"]:
        lines.append(f"- {r['rule']} · {r['name']}（机械判定：{'有' if r['machine'] else '无——仅人工/评审执行'}）")
    lines += [
        "",
        "## 条款（待归纳——留空）",
        "",
        "（由人归纳后填写：每条 `HB-<大写SLUG>` 前缀 + 口径/判定/修复；"
        "带「机械判定」口径的条款可被 prose-scan 自动扫描。填好前本卡不生效、不许 land。）",
        "",
    ]
    return "\n".join(lines)


def cmd_distill(receipt_path: Path, root: Path, slug: str | None, track: str, projects_dir: str) -> int:
    d = load_json(receipt_path)
    if not isinstance(d, dict) or d.get("format") != COLLECT_FORMAT:
        print(f"[FAIL] 输入不是 {COLLECT_FORMAT} 收据（先跑 collect）", file=sys.stderr)
        return 1
    pid = d.get("project") or ""
    slug = slug or re.sub(r"[^a-z0-9-]+", "-", str(pid).lower()).strip("-")
    if not slug or not re.fullmatch(r"[a-z0-9-]+", slug):
        print(f"[FAIL] slug 非法：{slug!r}（须小写字母数字连字符；用 --slug 显式指定）", file=sys.stderr)
        return 1
    if d["stats"]["drafts"] == 0 and d["stats"]["memory_cards"] == 0:
        print("[FAIL] 收据里成稿与记忆卡皆空——没有素材就没有归纳，拒绝产空草稿", file=sys.stderr)
        return 1
    try:
        receipt_rel = to_posix(receipt_path.relative_to(root)) if receipt_path.is_relative_to(root) \
            else to_posix(receipt_path)
    except ValueError:
        receipt_rel = to_posix(receipt_path)
    env = {
        "track": track,
        "id": f"kb/craft/habit-{slug}",
        "format": "rule-card@1",
        "type": "rule-corpus",
        "title": f"用户习惯卡（草稿）· {slug}",
        "dimension": "habit",
        "version": "0.1.0",
        "status": "draft",
        "activation_hint": ["m3.成文", "polish"],
        "scanner_qids": [],
        "provenance": {
            "source": "habit-distill 素材组装草稿——语义归纳未发生，条款待人/未来 LLM 批次提炼"
                      "（tools/habit-distill.py 头注边界；转正=人填条款+推 status+land）",
            "refs": [receipt_rel, STYLE_RULES_REL]
                    + [x["file"] for x in d["drafts"][:5]],
        },
        "updated": date.today().isoformat(),
        "clauses": [],
    }
    out_dir = root / projects_dir / "_reports" / DRAFTS_DIRNAME
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"habit-{slug}{DRAFT_SUFFIX}.md"
    if out.exists():
        print(f"[FAIL] 草稿已存在：{out}——同名草稿拒绝覆盖（要重做请先人工处理旧稿）", file=sys.stderr)
        return 1
    out.write_text(render_draft_md(env, d), encoding="utf-8", newline="\n")
    print(f"distill: 草稿骨架 → {out}")
    print(f"  信封：{env['id']}（status=draft，clauses=[]——语义提炼未发生）")
    print("next（人的活，工具不代劳）：归纳条款（HB- 前缀+口径/判定/修复，对表 user-style-rules 防重复）"
          " → frontmatter status 推 active → land")
    return 0


# ── land：人审后的草稿 → knowledge/<域>/（复用 deconstruct land 的拒绝纪律）─────────
def cmd_land(draft_path: Path, root: Path, to: str) -> int:
    text = draft_path.read_text(encoding="utf-8") if draft_path.exists() else ""
    if not text:
        print(f"[ABORT] 草稿不存在：{draft_path}", file=sys.stderr)
        raise SystemExit(1)
    m = FRONT_BLOCK_RE.match(text)
    if not m:
        print("[FAIL] frontmatter 缺失（习惯草稿必须是 JSON frontmatter 的 rule-card@1 信封形状）", file=sys.stderr)
        return 1
    try:
        env = json.loads(m.group(1))
    except Exception as e:  # noqa: BLE001
        print(f"[FAIL] frontmatter 不是合法 JSON（{e}）", file=sys.stderr)
        return 1
    if not isinstance(env, dict):
        print("[FAIL] frontmatter 必须是 JSON 对象", file=sys.stderr)
        return 1
    cid = env.get("id", "")
    mm = CARD_ID_RE.match(cid)
    if not mm:
        print(f"[FAIL] 卡 id 形状非法 {cid!r}（须 kb/<域>/habit-<slug>）", file=sys.stderr)
        return 1
    dom, slug = mm.group(1), mm.group(2)
    status = env.get("status")
    if status == "draft":
        print("[FAIL] status=draft——习惯归纳与人审是落库前置：先归纳条款（HB- 前缀）并手工把 status "
              "推为 active，再 land。本工具永不代推状态（deconstruct land 同纪律）", file=sys.stderr)
        return 1
    if status == "landed":
        print("[FAIL] status=landed——本草稿已落过库；目标卡已存在即拒绝（绝不静默覆盖）", file=sys.stderr)
        return 1
    if status not in ("active", "retired"):
        print(f"[FAIL] status 非法 {status!r}（∈ draft|active|retired|landed）", file=sys.stderr)
        return 1
    clauses = env.get("clauses")
    if not isinstance(clauses, list) or not clauses:
        print("[FAIL] clauses 为空骨架——空骨架只是素材组装，不是条款；先归纳填写再落库", file=sys.stderr)
        return 1
    for i, c in enumerate(clauses):
        rid = c.get("rule_id") if isinstance(c, dict) else None
        if not isinstance(rid, str) or not HB_ID_RE.match(rid):
            print(f"[FAIL] clauses[{i}].rule_id 形状非法 {rid!r}（须 HB- 前缀——习惯出身，"
                  "复用台账 AE-id / 拆书 DC-id = 结论造假）", file=sys.stderr)
            return 1
        if not isinstance(c.get("detect"), str) or not c["detect"].strip():
            print(f"[FAIL] clauses[{i}].detect 缺失——条款主句（口径）不能为空", file=sys.stderr)
            return 1
    # 落点：--to 须是盘上已存在的 knowledge/ 子目录；rules/ 是 AE-id 家法，习惯卡不去
    kdom = root / "knowledge" / to
    if to == "rules" or not kdom.is_dir():
        print(f"[FAIL] --to {to!r} 非法：须是盘上已存在的 knowledge/ 子目录（rules/ 除外——"
              "那是台账迁移卡的家法）", file=sys.stderr)
        return 1
    final_id = f"kb/{to}/habit-{slug}"
    target = kdom / f"habit-{slug}.md"
    if target.exists():
        print(f"[FAIL] 目标卡已存在：{to_posix(target.relative_to(root))}——同 id 卡已存在即拒绝"
              "（卡是手工资产，绝不静默覆盖；要重落请先人工处理旧卡）", file=sys.stderr)
        return 1
    # 统一写盘：id 按落点改写（显式打印）、草稿横幅换已落库横幅、存根记 landed
    body = text[m.end():]
    if final_id != cid:
        print(f"· 卡 id 按落点命名空间改写：{cid} → {final_id}")
        env["id"] = final_id
    new_text = "---\n" + json.dumps(env, ensure_ascii=False, indent=2) + "\n---\n" + body
    new_text = new_text.replace(DRAFT_BANNER, LANDED_BANNER)
    target.write_text(new_text, encoding="utf-8", newline="\n")
    stub = "---\n" + json.dumps({**env, "id": final_id, "status": "landed"}, ensure_ascii=False, indent=2)
    draft_path.write_text(stub + "\n---\n" + body, encoding="utf-8", newline="\n")
    print(f"landed：{to_posix(target.relative_to(root))}（{final_id}，条款 {len(clauses)} 条；"
          f"草稿存根已记 status=landed）")
    print(f"next: python tools/kit-compile.py  （把新卡编入 kit/hypergraph.rag.json，kb 检索方可命中；"
          "并人工补 track 归属确认——R2 板块口径见 knowledge/README.md）")
    return 0


# ── --selfcheck：合成 fixture 全链自测（临时目录，零真实写盘）────────────────────
def cmd_selfcheck() -> int:
    ok = True

    def step(no: str, cond: bool, detail: str = ""):
        nonlocal ok
        ok &= bool(cond)
        print(f"selfcheck {no} {'OK' if cond else 'FAIL'}{('：' + detail) if detail else ''}")

    long_para = "这是合成项目第一章的长段落，" * 20   # 远超 100 字，用于钉引文限长
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        # 合成 mini 仓：项目（成稿×2 + 记忆卡×1 + 会话×1）+ knowledge/craft/user-style-rules
        proj = tmp / "projects" / "p-synthetic"
        (proj / "正文").mkdir(parents=True)
        (proj / "交付").mkdir()
        (proj / "正文" / "001-合成第一章.md").write_text(
            f"# 合成第一章\n\n{long_para}\n\n第二段。\n", encoding="utf-8")
        (proj / "交付" / "交付说明.md").write_text("# 交付说明\n\n合成交付首页段落。\n", encoding="utf-8")
        (proj / "世界书").mkdir()
        (proj / "世界书" / "记忆卡-s1.md").write_text(
            "---\nsession_id: s1\nturns: 3\nupdated: 2026-10-11T00:00:00Z\nsource: 内部/sessions/s1.jsonl\n---\n\n# 记忆卡\n",
            encoding="utf-8")
        (proj / "内部" / "sessions").mkdir(parents=True)
        (proj / "内部" / "sessions" / "s1.jsonl").write_text(
            '{"kind":"message","role":"user","ts":"2026-10-11T00:00:00Z","content":"合成输入"}\n', encoding="utf-8")
        craft = tmp / "knowledge" / "craft"
        craft.mkdir(parents=True)
        (craft / "user-style-rules.md").write_text(
            "# 合成规则\n\n### R1 · 合成口径一\n- 机械判定：合成特征计数\n\n"
            "### R2 · 合成口径二\n- 机械判定：留空——仅人工执行\n", encoding="utf-8")

        # 1/7 collect：三路素材齐 + 计数正确
        r1 = collect_material("p-synthetic", tmp)
        s = r1["stats"]
        step("1/7 collect 三路素材（成稿2/记忆卡1/条款2/会话1）",
             (s["drafts"], s["memory_cards"], s["sessions"], s["existing_rules"]) == (2, 1, 1, 2)
             and r1["existing_rules"][0]["machine"] and not r1["existing_rules"][1]["machine"])
        # 2/7 引文限长（≤100+省略号）且清单零整文搬运
        exc = next(d for d in r1["drafts"] if d["file"].endswith("001-合成第一章.md"))["excerpt"]
        step("2/7 引文限长 ≤100 字且不整文搬运", len(exc) <= EXCERPT_MAX + 1 and long_para not in json.dumps(r1, ensure_ascii=False))
        # 3/7 收据确定性（同状态重跑逐字节一致）
        a = json.dumps(collect_material("p-synthetic", tmp), ensure_ascii=False, sort_keys=True)
        b = json.dumps(collect_material("p-synthetic", tmp), ensure_ascii=False, sort_keys=True)
        step("3/7 收据确定性（重跑一致）", a == b)
        # 4/7 distill：骨架草稿（status=draft、clauses 空）——先落收据（模拟 cmd_collect 写盘）
        receipt_path = tmp / "projects" / "_reports" / "habit-collect-p-synthetic.json"
        receipt_path.parent.mkdir(parents=True, exist_ok=True)
        receipt_path.write_text(json.dumps(r1, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        rc = cmd_distill(receipt_path, tmp, None, "文风", "projects")
        draft = tmp / "projects" / "_reports" / DRAFTS_DIRNAME / "habit-p-synthetic-draft.md"
        env = json.loads(FRONT_BLOCK_RE.match(draft.read_text(encoding="utf-8")).group(1)) if draft.exists() else {}
        step("4/7 distill 骨架草稿（status=draft、clauses=[]、素材入正文）",
             rc == 0 and env.get("status") == "draft" and env.get("clauses") == []
             and "合成第一章" in draft.read_text(encoding="utf-8"))
        # 5/7 land：draft 拒落（零写盘）；空骨架推 status 后仍拒落
        rc = cmd_land(draft, tmp, "craft")
        step("5/7 land draft 拒落且零写盘", rc == 1 and not (tmp / "knowledge" / "craft" / "habit-p-synthetic.md").exists())
        txt = draft.read_text(encoding="utf-8").replace('"status": "draft"', '"status": "active"', 1)
        draft.write_text(txt, encoding="utf-8")
        rc = cmd_land(draft, tmp, "craft")
        step("5/7 空骨架（clauses=[]）即使 active 也拒落", rc == 1)
        # 6/7 人审后落位：填 HB- 条款 + status=active → 落 knowledge/craft/、横幅替换、存根记 landed
        txt = draft.read_text(encoding="utf-8").replace(
            '"clauses": []',
            '"clauses": [\n    {\n      "rule_id": "HB-SYNTH-1",\n      "detect": "合成条款口径主句",\n'
            '      "judge": "合成判定",\n      "repair": "合成修复"\n    }\n  ]', 1)
        draft.write_text(txt, encoding="utf-8")
        rc = cmd_land(draft, tmp, "craft")
        landed = tmp / "knowledge" / "craft" / "habit-p-synthetic.md"
        landed_txt = landed.read_text(encoding="utf-8") if landed.exists() else ""
        stub_env = json.loads(FRONT_BLOCK_RE.match(draft.read_text(encoding="utf-8")).group(1))
        step("6/7 人审后落 knowledge/craft/（横幅替换、存根 landed、id 不变）",
             rc == 0 and landed.exists() and LANDED_BANNER in landed_txt
             and DRAFT_BANNER not in landed_txt and stub_env["status"] == "landed"
             and stub_env["id"] == "kb/craft/habit-p-synthetic")
        # 7/7 幂等：新 active 副本再 land 同 id → 拒绝；--to rules 拒绝（家法域）
        draft2 = tmp / "projects" / "_reports" / DRAFTS_DIRNAME / "habit-p-synthetic-draft2.md"
        draft2.write_text(txt.replace('"status": "landed"', '"status": "active"', 1), encoding="utf-8")
        rc = cmd_land(draft2, tmp, "craft")
        step("7/7 幂等拒绝（同 id 卡已存在）", rc == 1)
        draft3 = tmp / "projects" / "_reports" / DRAFTS_DIRNAME / "habit-p-synthetic-draft3.md"
        draft3.write_text(txt.replace('"status": "landed"', '"status": "active"', 1), encoding="utf-8")
        rc = cmd_land(draft3, tmp, "rules")
        step("7/7 --to rules 拒绝（台账迁移卡家法域）", rc == 1)
    print("selfcheck OK" if ok else "selfcheck FAIL")
    return 0 if ok else 1


def main() -> int:
    ap = argparse.ArgumentParser(
        description="habit-distill · 用户习惯提炼通道：collect（素材清单）/ distill（草稿骨架）/ land（人审落库）")
    ap.add_argument("command", nargs="?", choices=("collect", "distill", "land"), help="子命令")
    ap.add_argument("file", nargs="?", help="projectId（collect）或素材收据/草稿路径（distill/land）")
    ap.add_argument("--slug", default=None, help="distill：草稿 slug（缺省由 projectId 派生）")
    ap.add_argument("--track", choices=("文风", "通用"), default="文风", help="distill：草稿 track 板块（缺省 文风）")
    ap.add_argument("--to", default="craft", help="land：落点 knowledge/ 子域（缺省 craft；须盘上已存在，rules 除外）")
    ap.add_argument("--dir", dest="projects_dir", default="projects", help="项目数据根目录名（缺省 projects）")
    ap.add_argument("--selfcheck", action="store_true", help="合成 fixture 全链自测（临时目录，零真实写盘）")
    a = ap.parse_args()
    if a.selfcheck:
        return cmd_selfcheck()
    if not a.file:
        ap.error("需要 <command> <file> 或 --selfcheck")
        return 2
    if a.command == "collect":
        return cmd_collect(a.file, ROOT, a.projects_dir)
    path = Path(a.file)
    path = path if path.is_absolute() else ROOT / path
    if a.command == "distill":
        return cmd_distill(path, ROOT, a.slug, a.track, a.projects_dir)
    return cmd_land(path, ROOT, a.to)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    sys.exit(main())
