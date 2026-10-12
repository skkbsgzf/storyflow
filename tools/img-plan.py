"""img-plan · 分镜表 + 美术资产表 + 后端画像 → image-job@1 任务包（确定性编排件）

零网络、零 token、纯 stdlib。它不提交、不出图、不判画面好坏——只做三件事：
① 把 `分镜表.md` / `美术资产表.md` 里内嵌的 storyboard@1 / asset-design@1 机读块取出来，
   拿 `contracts/*.schema.json` 同一份契约校验（校验器 tools/jsonschema_lite.py，静态门=契约的手工等价物口径）；
② 按画像的图模板与引擎档位，把每格/每件资产**组装成成品提示词**并实例化 graph 槽位；
③ 算出每个任务的指纹，落成 image-job@1——对接引擎的事实源，驱动器（kit 的或宿主自己的）照它执行。

纪律（每条对应一轮实测教训，改代码前先读 docs/工单-20261011-漫画视觉链路能力补足.md §〇/§二）：
  - **显式失败，不静默降级**：画像 `<必填>` 占位没填、引擎档位查无、能力位与声明冲突、越像素预算、
    引用悬空、依赖不成序 —— 全部进 `unresolved[]` 并点名要人覆写的旋钮，非空即 exit=1 且不落盘。
    静默改尺寸/降步数/换模型会出一批错图，白付一轮冷加载税（实测 460–1500s）。
  - **数值只出证据**：气泡超字数口径、每格像素偏低这类只进 `warnings[]`，不构成闸。
  - **可复现**：同输入必得同 job（seed 派生、task_id、指纹全确定性；时间戳只作人读 created_at）。

用法：
  python tools/img-plan.py <分镜表.md> <job.json> --profile <画像.json> [选项]
  # 内核 script 壳形态（core/src/minitools.ts:74 约定 <src> <out> --title --node --flow）原生兼容：
  #   位置参数 src 必须是含 storyboard@1 块的那个 .md；其余输入走 --assets/--profile。
选项：
  --profile <path>   image-profile@1 画像（必填）。缺省找顺序：<ws>/漫画/画像.json → --profile
  --assets <path>    美术资产表（asset-design@1 承载体）。不给则跳过资产任务，页面引用悬空会点名
  --pages <spec>     页范围，如 "1-4" 或 "2,3"（缺省全表）
  --comic-dir <名>   产物根目录名（默认 漫画）
  --check            只校验与对账，不落盘（仍按 unresolved 有无返回码）
  --out-dir <path>   job 落盘目录覆盖（默认与 src 同项目的 漫画/任务包/）
退出码：0 = 生成/校验通过；1 = 有 unresolved 硬缺陷或契约不过；2 = 用法/读文件错误。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
from jsonschema_lite import load_schema, validate  # noqa: E402
# 取块与指纹口径来自 imglib：任务包与资产台账必须算出同一个数，否则 stale_design 永远判不出
from imglib import (PLACEHOLDER, REPO, extract_block, has_placeholder,  # noqa: E402,F401
                    load_json, sha12, sha16, slug)
from imglib import design_digest as _design_digest  # noqa: E402

TOKEN = re.compile(r"^__([A-Z0-9_]+)__")           # 整值槽位
TOKEN_INNER = re.compile(r"__[A-Z0-9_]+__")
TOKEN_NAME = re.compile(r"__([A-Z0-9_]+)__")       # 非锚定，带捕获组：扫结构里的槽位名用

# 设计件字段 → 提示词片段顺序与中文引导词（类别决定装配次序，写死一处防漂移）
DESIGN_FIELDS: dict[str, list[tuple[str, str]]] = {
    "character": [("face", "脸型五官"), ("hair", "发型发色"), ("outfit", "服装"),
                  ("palette", "配色"), ("build", "体格"), ("marks", "标志特征"), ("age_range", "年龄感")],
    "background": [("space", "空间"), ("light", "光"), ("weather", "天气"),
                   ("era", "年代气质"), ("mood", "氛围"), ("depth", "景深")],
    "prop": [("form", "形制"), ("material", "材质"), ("scale", "尺度"),
             ("wear", "使用痕"), ("function", "用途")],
    "detail": [("motif", "纹样母题"), ("style", "图案风格"), ("density", "密度"),
               ("line_weight", "线条"), ("palette", "配色"), ("use_on", "应用位置")],
}
COLOR_WORDS = {"line_only": "纯线稿不上色", "flat": "平涂淡彩", "standard": "标准漫画上色", "vivid": "色彩浓烈"}
LINE_WORDS = {"thin": "细线", "medium": "中等线宽", "heavy": "粗线", "brush": "笔刷线"}
# 类别 → 任务 kind（人设出图即角色锚，其余三类是设计件）
KIND_OF_CLASS = {"character": "anchor", "background": "asset", "prop": "asset", "detail": "asset"}


def die(msg: str, code: int = 2) -> "None":
    print(f"[img-plan] 用法/读取错误: {msg}", file=sys.stderr)
    raise SystemExit(code)


def instantiate(template: Any, slots: dict[str, Any], filled: set[str], missing: set[str]) -> Any:
    if isinstance(template, dict):
        # `$` 前缀键是模板旁注（$comment），不进提交给引擎的图
        return {k: instantiate(v, slots, filled, missing) for k, v in template.items()
                if not (isinstance(k, str) and k.startswith("$"))}
    if isinstance(template, list):
        return [instantiate(v, slots, filled, missing) for v in template]
    if isinstance(template, str):
        m = TOKEN.match(template)
        if m and m.group(0) == template:
            key = m.group(1)
            if key in slots:
                filled.add(key)
                return slots[key]
            missing.add(key)
            return template
        def sub(t: re.Match) -> str:
            key = t.group(0)[2:-2]
            if key in slots:
                filled.add(key)
                return str(slots[key])
            missing.add(key)
            return t.group(0)
        return TOKEN_INNER.sub(sub, template)
    return template


class Planner:
    def __init__(self, profile: dict, storyboard: dict, assets: dict | None, args):
        self.profile = profile
        self.sb = storyboard
        self.assets = assets
        self.args = args
        self.tasks: list[dict] = []
        self.warnings: list[dict] = []
        self.unresolved: list[dict] = []
        self._seen: set[tuple] = set()
        self.by_asset: dict[str, dict] = {}      # asset_id → 设计件
        self.anchor_of: dict[str, str] = {}       # 角色 id → 锚图 task_id
        self.task_by_id: dict[str, dict] = {}
        self.engines = profile.get("engines", {}) or {}
        self.caps = profile.get("capabilities", {}) or {}
        self.budget = profile.get("budget", {}) or {}
        self.limits = profile.get("limits", {}) or {}
        self.digest = profile.get("_digest", "?")
        self.repo_digested = False

    # ── 记账 ──
    def warn(self, code: str, where: str, message: str) -> None:
        key = (code, where, message)
        if key in self._seen:
            return
        self._seen.add(key)
        self.warnings.append({"code": code, "where": where, "message": message})

    def bad(self, code: str, where: str, message: str, knob: str | None = None) -> None:
        key = (code, where, message)
        if key in self._seen:
            return
        self._seen.add(key)
        self.unresolved.append({"code": code, "where": where, "message": message, "knob": knob})

    # ── 画像侧预检 ──
    def check_profile(self) -> None:
        for where in has_placeholder(self.profile):
            knob = where.lstrip("#/").replace("/", ".")
            self.bad("PROFILE_SLOT_UNFILLED", knob,
                     f"画像必填值仍是 <必填> 占位（{knob}）——出厂画像不带本机模型名，用之前按 presets/image/README.md 填进 .external 或用户侧画像")
        # 加速档引用要能在签名表里找到（识别≠启用，但引用不许悬空）
        sig_path = self.args.acceleration
        sig_names: set[str] = set()
        if sig_path and sig_path.exists():
            doc, errs = load_json(sig_path)
            for e in errs:
                self.bad("ACCELERATION_TABLE_UNREADABLE", str(sig_path), e)
            if isinstance(doc, dict):
                sig_names = {x.get("name", "") for x in doc.get("entries", []) if isinstance(x, dict)}
        for name, eng in self.engines.items():
            acc = (eng or {}).get("accelerator")
            if acc and sig_names and acc not in sig_names:
                self.bad("ACCELERATOR_UNKNOWN", f"engines.{name}.accelerator",
                         f"档位 {name} 引用了签名表里没有的加速件 {acc}（先在 presets/image/acceleration.json 补条目并带出处，别凭印象写）")

    def pick_engine(self, declared: str | None, where: str) -> str | None:
        if declared:
            if declared in self.engines:
                return declared
            self.bad("ENGINE_UNKNOWN", where, f"声明的引擎档 {declared!r} 不在画像 engines 里（可用：{sorted(self.engines)}）")
            return None
        default = self.profile.get("default_engine")
        if default and default in self.engines:
            return default
        if self.engines:
            return sorted(self.engines)[0]
        self.bad("ENGINE_TABLE_EMPTY", where, "画像 engines 为空，无任何档位可用")
        return None

    def size_of(self, override: dict | None, where: str) -> dict | None:
        if override:
            w, h = int(override["w"]), int(override["h"])
        else:
            d = self.profile.get("size_default") or {"w": 1024, "h": 1024}
            w, h = int(d["w"]), int(d["h"])
        px = w * h
        cap = self.budget.get("max_pixels")
        if cap and px > int(cap):
            self.bad("OVER_PIXEL_BUDGET", where,
                     f"{w}x{h} = {px} 像素，越画像预算 max_pixels={cap}（实测安全口径 ~1MP；越界不静默缩图）",
                     knob=f"画像 budget.max_pixels 或 分镜表 {where} 的 size/per_panel")
            return None
        return {"w": w, "h": h}

    def resolve_template(self, path_str: str, where: str) -> tuple[Path | None, dict | None]:
        p = Path(path_str)
        if not p.is_absolute():
            p = REPO / path_str
        if not p.exists():
            self.bad("TEMPLATE_MISSING", where, f"图模板文件不存在: {path_str}（画像 graph 声明的路径要在 presets/image/graphs/ 下）")
            return None, None
        doc, errs = load_json(p)
        for e in errs:
            self.bad("TEMPLATE_UNPARSEABLE", where, e)
        if errs:
            return p, None
        return p, doc

    # ── 提示词装配（分镜提示词的唯一定义处）──
    def style_prefix(self, asset_over: dict | None = None) -> str:
        sb_style = (self.sb.get("style") or {}) if self.sb else {}
        if asset_over and asset_over.get("prompt_prefix"):
            return asset_over["prompt_prefix"].strip()
        return (sb_style.get("prompt_prefix") or self.profile.get("style_prefix") or "").strip()

    def negative_of(self, over: dict | None = None) -> str | None:
        sb_style = (self.sb.get("style") or {}) if self.sb else {}
        if not self.caps.get("negative_prompt", True):
            return None
        if over and over.get("negative"):
            return over["negative"].strip()
        return (sb_style.get("negative") or self.profile.get("negative_default") or "").strip() or None

    def color_word(self) -> str:
        intensity = ((self.sb.get("style") or {}) if self.sb else {}).get("color_intensity")
        return COLOR_WORDS.get(intensity or "", "")

    def design_phrase(self, asset: dict) -> str:
        cls = asset.get("class", "")
        design = asset.get("design") or {}
        bits = []
        for key, label in DESIGN_FIELDS.get(cls, []):
            val = design.get(key)
            if not val:
                continue
            # 离散档名翻成中文提示词。就地改 design 会污染设计件指纹（同一资产两次装配
            # 第二次拿到已翻译的值），所以只在装配时换算。
            if val in LINE_WORDS and key == "line_weight":
                val = LINE_WORDS[val]
            bits.append(f"{label}：{val}")
        refs = asset.get("refs") or []
        if refs:
            names = []
            for r in refs:
                aid = r.get("asset", "")
                tgt = self.by_asset.get(aid)
                if tgt:
                    names.append(f"{tgt.get('name', aid)}（{r.get('role', 'pattern')}）")
                else:
                    self.bad("ASSET_REF_DANGLING", asset.get("id", "?"),
                             f"资产 {asset.get('id')} 引用了不存在的资产 id {aid!r}（refs 只写 id，描述唯一来源是被引用资产）")
            if names:
                bits.append("引用元素：" + "、".join(names))
        return "；".join(bits)

    def asset_prompt(self, asset: dict, variant: dict | None, engine_word: str) -> str:
        parts = [p for p in [self.style_prefix(asset), engine_word,
                             f"设定图（{asset.get('name', '')}）", asset.get("intent", ""),
                             self.design_phrase(asset)] if p]
        if variant:
            vn, note = variant.get("name", ""), variant.get("note", "")
            if vn:
                parts.append(f"视角/变体：{vn}")
            if note:
                parts.append(f"该变体须交代：{note}")
        parts.append("干净底色、四周留白便于后期排版，无文字无水印")
        return "，".join(parts)

    def panel_prompt(self, page: dict, panel: dict, per_panel: bool, grid: str | None) -> tuple[str, str | None, list[str]]:
        """返回 (提示词, 气泡轨, 备注)。"""
        style = self.style_prefix()
        chars = panel.get("characters") or []
        notes: list[str] = []
        parts = [p for p in [style, self.color_word()] if p]
        if per_panel:
            parts.append("单格画面，完整构图出血到画框")
        else:
            parts.append(f"漫画分镜页，{grid or page.get('grid') or '2x2'} 宫格排版，格线清晰")
        # 身份保持：编辑链模板已经在 prompt 前加「保持 <image1> …」，此处按能力位补
        if chars:
            named = []
            for cid in chars:
                ch = self.character_of(cid)
                if ch:
                    named.append(ch.get("name", cid))
                    anchor = ch.get("anchor_asset") or ""
                    if not anchor and not self.anchor_of.get(cid):
                        notes.append(f"角色 {cid} 无锚图（既没定稿也没本包锚任务）——一致性靠 seed 兜底，画面身份会漂")
                else:
                    self.bad("CHARACTER_REF_DANGLING", f"p{page.get('page_no')}-{panel.get('panel_no')}",
                             f"本格引用角色 id {cid!r} 不在 storyboard.characters 里")
            if named:
                cons = self.consistency_for(chars)
                if cons == "reference_edit":
                    parts.append("保持参考图中的角色脸型、发型与服装一致，只改变动作与机位：" + "、".join(named))
                else:
                    parts.append("角色（按锚定设定复现）：" + "、".join(named))
        for slot, label in (("background", "背景"), ):
            aid = panel.get(slot)
            if aid:
                a = self.by_asset.get(aid)
                if a:
                    parts.append(f"{label}：{a.get('intent', '')}；{self.design_phrase(a)}")
                else:
                    self.bad("ASSET_REF_DANGLING", f"p{page.get('page_no')}-{panel.get('panel_no')}",
                             f"本格 {label} 引用资产 id {aid!r} 不在美术资产表里（缺 --assets 或 id 打错）")
        for slot, label in (("props", "道具"), ("details", "细节图案")):
            for aid in panel.get(slot) or []:
                a = self.by_asset.get(aid)
                if a:
                    parts.append(f"{label}：{a.get('name', aid)}——{a.get('intent', '')}")
                else:
                    self.bad("ASSET_REF_DANGLING", f"p{page.get('page_no')}-{panel.get('panel_no')}",
                             f"本格 {label} 引用资产 id {aid!r} 不在美术资产表里")
        if panel.get("shot"):
            parts.append(f"机位：{panel['shot']}")
        if panel.get("description"):
            parts.append(f"画面：{panel['description']}")
        bubbles = panel.get("bubbles") or []
        track = self.bubble_track(panel, len(bubbles))
        if track == "in_model" and bubbles:
            for b in bubbles:
                txt = (b.get("text") or "").strip()
                if txt:
                    parts.append(f"气泡文字：{txt}")
        elif track == "blank_layout" and bubbles:
            parts.append("气泡位置留白（文字后压，勿生成任何文字）")
            notes.append(f"本格 {len(bubbles)} 条文字走留白构图轨（画像 in_model_text={bool(self.caps.get('in_model_text'))}，口径 bubble_chars_max={self.limits.get('bubble_chars_max')}）")
        narr = panel.get("narration") or []
        if narr and track != "blank_layout":
            parts.append("旁白框文字：" + " / ".join(narr))
        return "，".join(p for p in parts if p), track, notes

    def bubble_track(self, panel: dict, n: int) -> str | None:
        if n == 0:
            return "none"
        declared = panel.get("bubble_mode")
        bubble_limit = self.limits.get("bubble_chars_max")
        over = [b for b in (panel.get("bubbles") or [])
                if bubble_limit and len((b.get("text") or "").strip()) > int(bubble_limit)]
        if over:
            self.warn("BUBBLE_OVER_LIMIT", f"p{panel.get('_page')}-{panel.get('panel_no')}",
                      f"{len(over)} 条气泡超过 in_model 口径 {bubble_limit} 字（实测只在短句+大字号下稳，长文未验）——复核清单，不拦截")
        if declared == "in_model":
            if not self.caps.get("in_model_text"):
                self.bad("CAPABILITY_MISMATCH", f"p{panel.get('_page')}-{panel.get('panel_no')}",
                         "本格声明 bubble_mode=in_model（模型内直出中文气泡），但画像 capabilities.in_model_text=false",
                         knob=f"画像 capabilities.in_model_text 或 分镜表 p{panel.get('_page')}-{panel.get('panel_no')}.bubble_mode")
                return None
            return "in_model"
        if declared == "blank_layout":
            return "blank_layout"
        if declared == "none":
            return "none"
        if self.caps.get("in_model_text") and not over:
            return "in_model"
        return "blank_layout"

    def character_of(self, cid: str) -> dict | None:
        for c in self.sb.get("characters") or []:
            if c.get("id") == cid:
                return c
        return None

    def consistency_for(self, chars: list[str]) -> str:
        declared = [self.character_of(c) or {} for c in chars]
        want = {d.get("consistency") for d in declared if d.get("consistency")}
        chosen = sorted(want)[0] if want else ("reference_edit" if self.caps.get("reference_edit") else "seed_lock")
        if chosen == "reference_edit" and not self.caps.get("reference_edit"):
            self.bad("CAPABILITY_MISMATCH", "characters.consistency",
                     f"角色 {chars} 声明一致性策略 reference_edit，但画像 capabilities.reference_edit=false",
                     knob="画像 capabilities.reference_edit / graph.ref_edit，或分镜表 characters[].consistency 改 seed_lock")
            return "seed_lock"
        if chosen == "lora" and not any((e or {}).get("lora") for e in self.engines.values()):
            self.warn("LORA_ENGINE_MISSING", "characters.consistency",
                      "声明 lora 一致性但画像没有任何档位挂 lora——本轮按 seed_lock 出，身份会漂；要真走得在画像 engines 里加 lora 档")
            return "seed_lock"
        return chosen

    def derive_seed(self, basis: str) -> int:
        return int(hashlib.sha256(basis.encode("utf-8")).hexdigest()[:8], 16) % 2**31

    # ── 建任务 ──
    def add_task(self, *, task_id: str, kind: str, prompt: str, cls: str | None = None,
                 asset_ref: str | None = None, variant: str | None = None, page_no: int | None = None,
                 panel_no: int | None = None, grid: str | None = None, size_override: dict | None = None,
                 engine_decl: str | None = None, template_key: str = "t2i", refs: list[dict] | None = None,
                 depends_on: list[str] | None = None, bubble_track: str | None = None,
                 bubble_over: int | None = None, consistency: str | None = None,
                 seed: int | None = None, where: str = "", design_digest: str | None = None,
                 notes: list[str] | None = None) -> None:
        where = where or task_id
        if task_id in self.task_by_id:
            self.bad("TASK_ID_DUPLICATE", where, f"task_id {task_id} 重复（改名会让台账历史断裂，请加区分位）")
            return
        engine = self.pick_engine(engine_decl, where)
        if engine is None:
            return
        eng = self.engines.get(engine) or {}
        size = self.size_of(size_override, where)
        if size is None:
            return
        tmpl_path = (self.profile.get("graph") or {}).get(template_key)
        if not tmpl_path:
            self.bad("TEMPLATE_NOT_DECLARED", where,
                     f"画像 graph 未声明 {template_key} 模板（{where} 需要它；reference_edit 类任务须画像 graph.ref_edit 指到图模板）",
                     knob=f"画像 graph.{template_key}")
            return
        tfile, tdoc = self.resolve_template(tmpl_path, where)
        if tdoc is None:
            return
        out_rel = self.output_rel(kind, task_id, cls)
        # seed 先定再拼槽：__SEED__ 是模板必填槽，原先在 slots_for 之后才算 seed，
        # 槽表里永远留 None 被过滤掉 ⇒ 每条任务都假报 TEMPLATE_SLOT_UNFILLED。
        seed_val = seed if seed is not None else self.derive_seed(f"{self.sb.get('_digest', '?')}|{task_id}")
        basis = "explicit" if seed is not None else "derived"
        slots = self.slots_for(eng, prompt, size, out_rel, refs or [], tmpl_path, where, engine, seed_val)
        filled, missing = set(), set()
        graph = instantiate(tdoc, slots, filled, missing)
        if missing:
            self.bad("TEMPLATE_SLOT_UNFILLED", where,
                     f"模板 {tmpl_path} 有槽位 plan 填不出：{sorted(missing)}（画像 graph.slots 未声明该槽位，或本任务缺对应输入——补声明件而不是改代码）")
            return
        # node_patch 覆盖（档位里的节点补丁照抄，执行侧不再自行决定）
        for nid, patch in (eng.get("node_patch") or {}).items():
            if nid in graph and isinstance(graph[nid], dict):
                graph[nid].setdefault("inputs", {}).update(patch or {})
            else:
                self.warn("NODE_PATCH_TARGET_ABSENT", where,
                          f"档位 {engine} 的 node_patch 指向节点 {nid}，模板 {tmpl_path} 里没有该节点（补丁未生效，检查模板与档位是否配套）")
        fp = sha16(self.digest, tmpl_path, engine, prompt, self.negative_of(), seed_val,
                   size["w"], size["h"], [(r.get("staged_as"), r.get("file"), r.get("source"), r.get("ref")) for r in (refs or [])])
        task = {
            "task_id": task_id, "kind": kind, "asset_ref": asset_ref, "asset_class": cls,
            "variant": variant, "page_no": page_no, "panel_no": panel_no, "grid": grid,
            "template": str(tmpl_path.relative_to(REPO)).replace("\\", "/") if tmpl_path.startswith(str(REPO)) else tmpl_path,
            "engine": engine, "accelerator": eng.get("accelerator"),
            "prompt": prompt, "negative": self.negative_of(),
            "seed": seed_val, "seed_basis": basis, "size": size, "pixels": size["w"] * size["h"],
            "refs": refs or [], "depends_on": depends_on or [], "bubble_track": bubble_track,
            "bubble_over_limit": bubble_over, "consistency": consistency, "output_rel": out_rel,
            "engine_patch": eng.get("node_patch"), "fingerprint": fp,
            "notes": notes or [], "_graph": graph, "_design_digest": design_digest,
        }
        self.tasks.append(task)
        self.task_by_id[task_id] = task

    def slots_for(self, eng: dict, prompt: str, size: dict, out_prefix: str,
                  refs: list[dict], tmpl_path: str, where: str, engine: str, seed_val: int) -> dict[str, Any]:
        models = self.profile.get("models") or {}
        res = int(min(size["w"], size["h"]))
        slots: dict[str, Any] = {
            "UNET": models.get("unet"), "CLIP": models.get("clip"), "VAE": models.get("vae"),
            "CHECKPOINT": models.get("unet"), "API_MODEL": models.get("api_model"),
            "PROMPT": prompt, "NEGATIVE": self.negative_of() or "",
            "RESOLUTION": res, "W": size["w"], "H": size["h"],
            "SEED": seed_val, "STEPS": eng.get("steps"), "CFG": eng.get("cfg"),
            "SAMPLER": eng.get("sampler"), "SCHEDULER": eng.get("scheduler", "simple"),
            "DENOISE": eng.get("denoise", 1.0), "OUT_PREFIX": out_prefix,
            "LORA": eng.get("lora"), "LORA_STRENGTH": eng.get("lora_strength", 1.0),
            "SIGMAS": eng.get("sigmas"),
        }
        # 参考图：模板里的 __REF_1__.. 按 refs 序填 staged_as（缺位与多余都要点名，不许少喂一张却不报）
        slot_names = TOKEN_SLOTS(tmpl_path)
        cap_slots = [i for i in range(1, 9) if f"REF_{i}" in slot_names]
        if refs and len(refs) > len(cap_slots):
            self.bad("REF_SLOT_OVERFLOW", where,
                     f"本任务解析到 {len(refs)} 张参考图，模板 {tmpl_path} 只有 {len(cap_slots)} 个参考图槽"
                     f"（多出来的会被静默丢掉——实图与指纹/收据对不上，正是「半接状态」那类最贵的坑）",
                     knob=f"分镜表 {where}.refs 删到 {len(cap_slots)} 张，或在画像 graph 里换一张带 {len(refs)} 个 LoadImage 槽的图模板")
        for i in cap_slots:
            if i <= len(refs):
                slots[f"REF_{i}"] = refs[i - 1].get("staged_as") or refs[i - 1].get("file")
            else:
                self.bad("REF_SLOT_EMPTY", where,
                         f"模板 {tmpl_path} 需要第 {i} 张参考图，本任务只解析到 {len(refs)} 张 refs（引擎档位 {engine}）",
                         knob=f"分镜表 {where}.refs 或 画像 graph.{tmpl_path}")
        return {k: v for k, v in slots.items() if v is not None}

    def output_rel(self, kind: str, task_id: str, cls: str | None) -> str:
        d = self.args.comic_dir
        sub = {"asset": f"assets/{cls or 'misc'}", "anchor": "anchors", "page": "pages", "panel": "panels"}[kind]
        return f"{d}/{sub}/{task_id}.png"

    def stage_name(self, task_id: str, ref_file: str) -> str:
        return f"{slug(task_id)}--{Path(ref_file).name}"

    # ── 主流程 ──
    def run(self) -> dict:
        self.check_profile()
        self.build_assets()
        self.build_pages()
        self.check_dependencies()
        prof_rel = rel(self.args.profile)
        job = {
            "format": "image-job@1",
            "job_id": self.job_id(),
            "created_at": None,
            "profile": {
                "id": self.profile.get("id", ""), "path": prof_rel, "digest": self.digest,
                "backend": self.profile.get("backend", ""), "base_url": non_placeholder(self.profile.get("base_url")),
                "capabilities": dict(self.caps), "acceleration_source": rel(self.args.acceleration) if self.args.acceleration else None,
            },
            "storyboard": {"path": rel(self.args.storyboard), "digest": self.sb.get("_digest")},
            "assets": ({"path": rel(self.args.assets), "digest": self.assets.get("_digest")} if self.assets else None),
            "policy": {
                "concurrency": self.args.concurrency,
                "timeout_s": int(self.budget.get("cold_timeout_s") or 1800),
                "resume": not self.args.no_resume,
                "on_guardrail": "fail_explicit",
                "on_task_fail": self.args.on_task_fail,
            },
            "tasks": [{k: v for k, v in t.items() if not k.startswith("_")} for t in self.tasks],
            "warnings": self.warnings,
            "unresolved": self.unresolved,
            "fingerprint": sha16([t["fingerprint"] for t in self.tasks], self.args.concurrency),
            "notes": self.job_notes(),
        }
        return job

    def job_notes(self) -> list[str]:
        notes = []
        if not self.assets:
            notes.append("未提供 --assets：本轮不出四类设计件，页面若引用资产 id 会进 unresolved")
        if self.profile.get("backend") == "off":
            notes.append("画像 backend=off：任务包可生成但不该提交（出图已显式关闭）")
        return notes

    def job_id(self) -> str:
        pages = sorted({t.get("page_no") for t in self.tasks if t.get("page_no")})
        rng = f"p{pages[0]}-{pages[-1]}" if pages else "assets-only"
        return f"job-{slug(self.profile.get('id', 'profile'), 20)}-{sha16(self.sb.get('_digest'), self.assets.get('_digest') if self.assets else None, rng)[:10]}"

    def build_assets(self) -> None:
        if not self.assets:
            return
        # 先把全集按 id 建索引：资产之间的 refs 可以前向引用（人设引最后一件纹样），
        # 边遍历边填索引会把合法引用误报成悬空。
        self.by_asset = {a.get("id", "?"): a for a in self.assets.get("assets") or []}
        for asset in self.assets.get("assets") or []:
            aid, cls = asset.get("id", "?"), asset.get("class", "")
            self.by_asset[aid] = asset
            if asset.get("maturity") != "locked":
                self.warn("ASSET_NOT_LOCKED", aid,
                          f"设计件 {aid} 处于 {asset.get('maturity') or '未声明'} 状态（未 locked 也可出图，但定稿前别把产物当母版复用）")
            variants = asset.get("variants") or [None]
            dd = design_digest(asset)
            for var in variants:
                vname = var.get("name") if var else None
                if cls == "character":
                    tid = f"k-{aid}" + (f"-{slug(vname)}" if vname else "")
                else:
                    tid = f"a-{aid}" + (f"-{slug(vname)}" if vname else "")
                where = tid
                size = asset.get("size")
                parts_word = COLOR_WORDS.get(((self.sb.get("style") or {}).get("color_intensity")), "") if cls != "detail" else ""
                prompt = self.asset_prompt(asset, var, parts_word)
                self.add_task(task_id=tid, kind=KIND_OF_CLASS[cls], cls=cls, asset_ref=aid, variant=vname,
                              prompt=prompt, size_override=size, engine_decl=None, template_key="t2i",
                              where=where, design_digest=dd,
                              notes=[f"设计件 {aid}（{cls}）产物；maturity={asset.get('maturity') or '未声明'}"],
                              bubble_track="none")
                if cls == "character" and not vname:
                    self.anchor_of[aid] = tid

    def build_pages(self) -> None:
        scope = page_scope(self.args.pages)
        ld = self.sb.get("layout_default") or {}
        for page in self.sb.get("pages") or []:
            pno = page.get("page_no")
            if scope and pno not in scope:
                continue
            per_panel = page.get("per_panel") if "per_panel" in page else ld.get("per_panel", False)
            grid = page.get("grid") or ld.get("grid") or "2x2"
            eng_decl = page.get("engine") or ld.get("engine")
            panels = page.get("panels") or []
            max_panels = self.limits.get("max_panels_per_page")
            if max_panels and len(panels) > int(max_panels):
                self.warn("TOO_MANY_PANELS", f"P{pno}", f"本页 {len(panels)} 格 > 画像 limits.max_panels_per_page={max_panels}（每格像素预算会被摊薄）")
            if not per_panel:
                prompt, track, notes = self.page_prompt(page, panels, grid, eng_decl)
                if notes:
                    for n in notes:
                        self.warn("PAGE_TRACK_NOTE", f"P{pno}", n)
                self.add_task(task_id=f"P{pno}", kind="page", prompt=prompt, page_no=pno, grid=grid,
                              size_override=None, engine_decl=eng_decl, template_key="t2i",
                              where=f"P{pno}", bubble_track=track,
                              depends_on=[self.anchor_of[c] for c in sorted({x for pl in panels for x in (pl.get('characters') or [])}) if self.anchor_of.get(c)],
                              notes=[f"整页一次出（{grid}）：每格像素 = 页像素/{len(panels) or 1}，手部等细节按此预算判"])
                return_pages = True
                continue
            for panel in panels:
                panel["_page"] = pno
                prompt, track, notes = self.panel_prompt(page, panel, True, grid)
                chars = panel.get("characters") or []
                cons = self.consistency_for(chars) if chars else None
                refs = self.panel_refs(page, panel, chars, cons)
                tmpl = "ref_edit" if cons == "reference_edit" and refs else "t2i"
                self.add_task(task_id=f"p{pno}-{panel.get('panel_no')}", kind="panel", prompt=prompt,
                              page_no=pno, panel_no=panel.get("panel_no"),
                              size_override=panel.get("size"), engine_decl=panel.get("engine") or eng_decl,
                              template_key=tmpl, refs=refs, consistency=cons, bubble_track=track,
                              bubble_over=len([b for b in (panel.get("bubbles") or [])
                                               if self.limits.get("bubble_chars_max")
                                               and len((b.get("text") or "").strip()) > int(self.limits["bubble_chars_max"])]),
                              depends_on=[r["from_task"] for r in refs if r.get("from_task")],
                              where=f"p{pno}-{panel.get('panel_no')}", notes=notes)

    def page_prompt(self, page: dict, panels: list[dict], grid: str, eng_decl: str | None) -> tuple[str, str | None, list[str]]:
        """整页提示词：把每格压成一段有序描述（一页一次出=格与格共享一次采样，最省钱也最不可控）。"""
        style = self.style_prefix()
        parts = [p for p in [style, self.color_word()] if p]
        parts.append(f"漫画分镜页，{grid} 宫格，格线清晰，阅读序自上而下从左而右")
        tracks, notes = set(), []
        chars = set()
        for pl in panels:
            desc = pl.get("description") or ""
            tag = f"第{pl.get('panel_no')}格"
            bits = [f"{tag}：{desc}"] if desc else []
            if pl.get("shot"):
                bits.append(f"机位 {pl['shot']}")
            for cid in pl.get("characters") or []:
                ch = self.character_of(cid)
                if ch:
                    bits.append(f"角色 {ch.get('name', cid)}")
                    chars.add(cid)
                else:
                    self.bad("CHARACTER_REF_DANGLING", tag, f"引用角色 id {cid!r} 不在 storyboard.characters")
            for b in pl.get("bubbles") or []:
                t = (b.get("text") or "").strip()
                if t:
                    tracks.add(self.bubble_track({**pl, "_page": page.get("page_no")}, 1) or "none")
            parts.append("；".join(bits))
        if chars and self.caps.get("reference_edit"):
            pass  # 整页任务带不了多参考图链（编辑链模板按单图槽设计），一致性走锚描述
        elif chars:
            notes.append("整页一次出且无参考图编辑链：角色身份靠锚描述复现，跨页漂移风险高（要保身份请改 per_panel）")
        track = "in_model" if tracks == {"in_model"} else ("blank_layout" if tracks else "none")
        if track == "in_model":
            for pl in panels:
                for b in pl.get("bubbles") or []:
                    t = (b.get("text") or "").strip()
                    if t:
                        parts.append(f"第{pl.get('panel_no')}格气泡：{t}")
        else:
            parts.append("气泡位置留白（文字后压，勿生成任何文字）")
        return "，".join(p for p in parts if p), track, notes

    def panel_refs(self, page: dict, panel: dict, chars: list[str], cons: str | None) -> list[dict]:
        refs: list[dict] = []
        tid = f"p{page.get('page_no')}-{panel.get('panel_no')}"
        for r in panel.get("refs") or []:
            src, ref = r.get("source"), r.get("ref")
            file = None
            from_task = None
            if src == "anchor":
                ch = self.character_of(ref or "")
                if not ch:
                    self.bad("CHARACTER_REF_DANGLING", tid, f"refs 引用角色 {ref!r}，characters 里查无")
                    continue
                file = ch.get("anchor_asset") or None
                if not file and self.anchor_of.get(ref):
                    from_task = self.anchor_of[ref]
                    file = self.task_by_id[from_task]["output_rel"] if from_task in self.task_by_id else None
                if not file:
                    self.bad("ANCHOR_MISSING", tid,
                             f"角色 {ref} 既无定稿锚图（characters[].anchor_asset）也无本包锚任务——参考图编辑链喂不出参考，不许静默改策略",
                             knob=f"分镜表 characters[{ref}].anchor_asset 或 先出 asset-design 里的 {ref}")
                    continue
            elif src == "asset":
                a = self.by_asset.get(ref or "")
                if not a:
                    self.bad("ASSET_REF_DANGLING", tid, f"refs 引用资产 id {ref!r}，美术资产表里查无（缺 --assets？）")
                    continue
                kind = KIND_OF_CLASS[a["class"]]
                t = f"k-{ref}" if kind == "anchor" else f"a-{ref}"
                if t in self.task_by_id:
                    from_task, file = t, self.task_by_id[t]["output_rel"]
                else:
                    self.bad("TASK_NOT_BUILT", tid, f"refs 指向资产 {ref} 的产物任务 {t} 未生成（被 --pages 过滤还是 id 打错？）")
                    continue
            elif src == "panel":
                t = f"p{ref}" if "-" in str(ref) else None
                if not t:
                    self.bad("REF_COORD_BAD", tid, f"panel 类参考要写 `页-格` 坐标（实得 {ref!r}）")
                    continue
                if t not in self.task_by_id:
                    self.bad("REF_ORDER", tid,
                             f"参考格 {t} 尚未生成（img-plan 只按阅读序建任务；跨页回指前页需该页任务已在包内）")
                    continue
                from_task, file = t, self.task_by_id[t]["output_rel"]
            elif src == "file":
                file = ref
            else:
                self.bad("REF_SOURCE_UNKNOWN", tid, f"refs.source={src!r} 不在 anchor/asset/panel/file 里")
                continue
            staged = self.stage_name(tid, file or "x")
            refs.append({"source": src, "ref": ref, "file": file, "staged_as": staged,
                         "role": r.get("role") or ("identity" if src == "anchor" else None), "from_task": from_task})
        if cons == "reference_edit" and not refs and chars:
            self.warn("NO_REF_FOR_EDIT", tid,
                      f"一致性策略 reference_edit 但本格没解析到参考图（改出 t2i 模板，身份靠锚描述）——如需保身份请在 refs 里补 anchor")
        return refs

    def check_dependencies(self) -> None:
        ids = set(self.task_by_id)
        order = {t["task_id"]: i for i, t in enumerate(self.tasks)}
        for t in self.tasks:
            for d in t["depends_on"]:
                if d not in ids:
                    self.bad("DEP_MISSING", t["task_id"], f"依赖的任务 {d} 不在本包（被页范围过滤掉了还是 id 变了？）")
                elif order[d] > order[t["task_id"]]:
                    self.bad("DEP_UNORDERED", t["task_id"],
                             f"依赖 {d} 排在本任务之后（img-plan 的建序把资产/锚图放在页面前；出现倒序说明引用写反了）",
                             knob=f"把 {t['task_id']} 的 depends_on 去掉或先单独出 {d}")
            for r in t["refs"]:
                r.pop("from_task", None)

    def report(self, job: dict, out_path: Path | None) -> int:
        tasks = job["tasks"]
        print("画像 %s（backend=%s，档位 %s）" % (job["profile"]["id"], job["profile"]["backend"],
                                                 sorted(self.engines)))
        print("任务 %d 条：资产 %d / 锚图 %d / 整页 %d / 逐格 %d" % (
            len(tasks),
            sum(1 for t in tasks if t["kind"] == "asset"),
            sum(1 for t in tasks if t["kind"] == "anchor"),
            sum(1 for t in tasks if t["kind"] == "page"),
            sum(1 for t in tasks if t["kind"] == "panel")))
        for w in job["warnings"]:
            print("  [警告·不拦] %s @ %s：%s" % (w["code"], w.get("where") or "-", w["message"]))
        for u in job["unresolved"]:
            print("  [硬缺陷] %s @ %s：%s%s" % (u["code"], u.get("where") or "-", u["message"],
                                                f"（旋钮：{u['knob']}）" if u.get("knob") else ""))
        if out_path:
            print("任务包: %s" % out_path.as_posix())
        else:
            print("（--check：未落盘）")
        return 1 if job["unresolved"] else 0


def non_placeholder(v: Any) -> Any:
    return None if isinstance(v, str) and v.startswith(PLACEHOLDER) else v


def rel(p: Path | None) -> str:
    if not p:
        return ""
    try:
        return str(Path(p).resolve().relative_to(REPO)).replace("\\", "/")
    except ValueError:
        return str(p).replace("\\", "/")


def design_digest(asset: dict) -> str:
    """设计件字段指纹：口径唯一真相在 `tools/imglib.py`（台账与任务包必须算同一个数）。"""
    return _design_digest(asset)


def page_scope(spec: str | None) -> set[int] | None:
    if not spec:
        return None
    out: set[int] = set()
    for part in spec.split(","):
        part = part.strip()
        if not part:
            continue
        m = re.match(r"^(\d+)\s*-\s*(\d+)$", part)
        if m:
            out.update(range(int(m.group(1)), int(m.group(2)) + 1))
        elif part.isdigit():
            out.add(int(part))
        else:
            die(f"--pages 里出现无法解析的片段 {part!r}（支持 1-4 / 2 / 1,3-5）")
    return out or None


def _walk_tokens(node: Any, out: set[str]) -> None:
    if isinstance(node, dict):
        for k, v in node.items():
            if isinstance(k, str) and k.startswith("$"):
                continue          # 旁注里出现的槽位名只是说明文字，不算本模板要的槽
            _walk_tokens(v, out)
    elif isinstance(node, list):
        for v in node:
            _walk_tokens(v, out)
    elif isinstance(node, str):
        out.update(m.group(1) for m in TOKEN_NAME.finditer(node))


def TOKEN_SLOTS(tmpl_path: str) -> set[str]:
    """模板里真正要填的槽位名。

    按**结构**走解析后的 JSON，不扫原始文本——旁注 `$comment` 里举例的 `__X__`
    曾被当成分辨率槽，plan 于是永远报 TEMPLATE_SLOT_UNFILLED（假失败）。
    """
    if tmpl_path not in _TMPL_SLOTS:
        doc, errs = load_json(Path(tmpl_path))
        if errs:
            _TMPL_SLOTS[tmpl_path] = set()
            return _TMPL_SLOTS[tmpl_path]
        found: set[str] = set()
        _walk_tokens(doc, found)
        _TMPL_SLOTS[tmpl_path] = found
    return _TMPL_SLOTS[tmpl_path]


_TMPL_SLOTS: dict[str, set[str]] = {}


def contract_problems(named: list[tuple[str, Any, str]]) -> list[str]:
    """把 (名字, 文档, 契约文件名) 逐个过 contracts/，返回可读问题行（空 = 全过）。"""
    out: list[str] = []
    for name, doc, schema in named:
        if doc is None:
            continue
        problems = validate(doc, load_schema(schema))
        for p in problems[:40]:
            out.append(f"{name} 不过 contracts/{schema}：{p}")
        if len(problems) > 40:
            out.append(f"{name} 不过 contracts/{schema}：…另有 {len(problems) - 40} 处")
    return out


def plan(profile: dict, sb: dict, assets: dict | None, args: Any) -> tuple[dict, Planner]:
    """指纹打底 + 编排。main 与 --selftest 共用同一条路，测试不许走旁门。"""
    profile["_digest"] = sha12(json.dumps({k: v for k, v in profile.items() if k != "_digest"},
                                          ensure_ascii=False, sort_keys=True))
    sb["_digest"] = sha12(json.dumps(sb, ensure_ascii=False, sort_keys=True))
    if assets:
        assets["_digest"] = sha12(json.dumps(assets, ensure_ascii=False, sort_keys=True))
    planner = Planner(profile, sb, assets, args)
    return planner.run(), planner


SYN_FILL = {"base_url": "http://127.0.0.1:18188", "unet": "synthetic-unet.safetensors",
            "clip": "synthetic-clip.safetensors", "vae": "synthetic-vae.safetensors",
            "api_model": "synthetic-api-model"}


def fill_placeholders(node: Any, key: str | None = None) -> Any:
    """把出厂画像的 `<必填…>` 占位换成合成值——A 批自测只验形状与编排，不碰任何真机参数。"""
    if isinstance(node, dict):
        return {k: fill_placeholders(v, k) for k, v in node.items()}
    if isinstance(node, list):
        return [fill_placeholders(v, key) for v in node]
    if isinstance(node, str) and node.startswith(PLACEHOLDER):
        return SYN_FILL.get(key, "synthetic-value")
    return node


def graph_problems(graph: Any) -> list[str]:
    """实例化后的 ComfyUI 图是否「可直接提交」的形状检查（不看画面，只看结构）。"""
    out: list[str] = []
    if not isinstance(graph, dict) or not graph:
        return ["图为空或不是字典"]
    for nid, node in graph.items():
        if str(nid).startswith("$"):
            out.append(f"节点位出现模板旁注键 {nid}（旁注没剥掉，提交给引擎会被当节点）")
            continue
        if not isinstance(node, dict) or "class_type" not in node or "inputs" not in node:
            out.append(f"节点 {nid} 缺 class_type/inputs")
            continue
        blob = json.dumps(node["inputs"], ensure_ascii=False)
        left = sorted({m.group(0) for m in TOKEN_NAME.finditer(blob)})
        if left:
            out.append(f"节点 {nid} 残留未填槽位 {left}")
    return out


def selftest() -> int:
    """A 批验收判据的自跑件（零网络、零写盘）：契约逐键对齐 + 出厂画像逐个拼得出合法图 + 坏例必须点名。

    跑法：`python tools/img-plan.py --selftest`。改过 img-plan/图模板/画像/契约后先跑它。
    """
    from types import SimpleNamespace
    fails: list[str] = []

    def check(cond: bool, msg: str) -> None:
        print(("  ok   " if cond else "  FAIL ") + msg)
        if not cond:
            fails.append(msg)

    FIX = REPO / "tools" / "__fixtures__"
    good_md = FIX / "comic-storyboard-sample.md"
    assets_md = FIX / "comic-assets-sample.md"
    bad_md = FIX / "comic-storyboard-bad.md"

    sb, _, errs = extract_block(good_md, "storyboard@1")
    check(not errs, f"好例分镜表取块：{errs or 'OK'}")
    assets, _, errs = extract_block(assets_md, "asset-design@1")
    check(not errs, f"资产表取块：{errs or 'OK'}")
    bad_sb, _, errs = extract_block(bad_md, "storyboard@1")
    check(not errs, f"坏例分镜表取块：{errs or 'OK'}")
    if errs or sb is None or assets is None or bad_sb is None:
        return 1

    problems = contract_problems((("分镜表", sb, "storyboard.schema.json"),
                                  ("美术资产表", assets, "asset-design.schema.json"),
                                  ("坏例分镜表", bad_sb, "storyboard.schema.json")))
    check(not problems, "fixture 过契约：" + (f"{len(problems)} 处：" + problems[0] if problems else "全过"))

    # engine-capability@1 由 B 批的 img-probe 产出，A 批先把形状钉住：
    # fixture 既是「过 schema」的样例，也必须**逐键覆盖**契约声明的每个字段——
    # 契约里写了却没人产出的字段，等于给宿主留了个假接口。
    cap, cap_errs = load_json(FIX / "engine-capability-sample.json")
    check(not cap_errs, f"能力探测 fixture 可读：{cap_errs or 'OK'}")
    if not cap_errs and isinstance(cap, dict):
        cschema = load_schema("engine-capability.schema.json")
        cp = validate(cap, cschema)
        check(not cp, "能力探测 fixture 过 engine-capability@1：" + (cp[0] if cp else "OK"))
        declared = set((cschema.get("properties") or {}))
        uncovered = sorted(declared - set(cap))
        check(not uncovered,
              f"engine-capability@1 逐键对齐（契约 {len(declared)} 键全在产出形状里）：未覆盖 {uncovered}")

    def opts(profile_path: Path, md_path: Path, pages: str | None = None) -> Any:
        return SimpleNamespace(storyboard=md_path, profile=profile_path, assets=assets_md,
                               acceleration=REPO / "presets" / "image" / "acceleration.json",
                               pages=pages, comic_dir="漫画", out=None, out_dir=None,
                               concurrency=1, on_task_fail="record_and_stop", no_resume=False,
                               check=True, title=None, node=None, flow=None)

    profiles = sorted((REPO / "presets" / "image" / "profiles").glob("*.json"))
    check(len(profiles) >= 2, f"出厂画像数量 {len(profiles)}（≥2：实测形状 + 通用形状）")
    for pfile in profiles:
        raw, errs = load_json(pfile)
        if errs:
            check(False, f"画像可读 {pfile.name}：{errs}")
            continue
        prof = fill_placeholders(raw)
        pf_problems = contract_problems((("画像", prof, "image-profile.schema.json"),))
        check(not pf_problems, f"[{pfile.name}] 画像填占位后过契约：" + (pf_problems[0] if pf_problems else "OK"))
        ref_cap = bool((prof.get("capabilities") or {}).get("reference_edit"))
        job, planner = plan(json.loads(json.dumps(prof)), json.loads(json.dumps(sb)),
                            json.loads(json.dumps(assets)), opts(pfile, good_md))
        codes = sorted({u["code"] for u in job["unresolved"]})
        if ref_cap:
            check(not job["unresolved"], f"[{pfile.name}] 合法分镜表零硬缺陷：" + (f"{job['unresolved'][:2]}" if job["unresolved"] else "OK"))
        else:
            check(codes == ["REF_SLOT_OVERFLOW"],
                  f"[{pfile.name}] 无参考图槽 ⇒ 只许显式拒绝不许静默丢图，实得 {codes}")
        job_problems = validate(job, load_schema("image-job.schema.json"))
        check(not job_problems, f"[{pfile.name}] 产物过 image-job@1 契约：" + (job_problems[0] if job_problems else "OK"))
        check(len(job["tasks"]) > 0, f"[{pfile.name}] 任务数 {len(job['tasks'])}")
        check(len({t["task_id"] for t in job["tasks"]}) == len(job["tasks"]), f"[{pfile.name}] task_id 唯一")
        check(len({t["fingerprint"] for t in job["tasks"]}) == len(job["tasks"]), f"[{pfile.name}] 任务指纹互不相同")
        gp: list[str] = []
        for t in planner.tasks:
            for g in graph_problems(t.get("_graph")):
                gp.append(f"{t['task_id']}: {g}")
        check(not gp, f"[{pfile.name}] {len(planner.tasks)} 张图全部实例化合法：" + (gp[0] if gp else "OK"))
        edits = [t for t in planner.tasks if t["template"].endswith("ref-edit.json")]
        check(all(isinstance((t["_graph"].get("4", {}).get("inputs") or {}).get("images"), dict) for t in edits),
              f"[{pfile.name}] 编辑链 images 槽是嵌套字典（扁平键能过校验但执行期 TypeError）：{len(edits)} 条")
        job2, _ = plan(json.loads(json.dumps(prof)), json.loads(json.dumps(sb)),
                       json.loads(json.dumps(assets)), opts(pfile, good_md))
        check(job2["fingerprint"] == job["fingerprint"] and job2["job_id"] == job["job_id"],
              f"[{pfile.name}] 同输入同指纹（可复现）")
        scoped, _ = plan(json.loads(json.dumps(prof)), json.loads(json.dumps(sb)),
                         json.loads(json.dumps(assets)), opts(pfile, good_md, pages="1"))
        check(not [t for t in scoped["tasks"] if t.get("page_no") == 2],
              f"[{pfile.name}] --pages 1 不碰第 2 页（覆盖面由人点名）")

    # 坏例：三类硬缺陷必须全部点名，且越预算/超槽位必须给出可操作旋钮
    for pfile in profiles:
        raw, _ = load_json(pfile)
        prof = fill_placeholders(raw)
        job, _ = plan(json.loads(json.dumps(prof)), json.loads(json.dumps(bad_sb)), None,
                      opts(pfile, bad_md))
        codes = {u["code"] for u in job["unresolved"]}
        for need in ("ASSET_REF_DANGLING", "OVER_PIXEL_BUDGET", "REF_SLOT_OVERFLOW"):
            check(need in codes, f"[坏例·{pfile.name}] 必须点名 {need}，实得 {sorted(codes)}")
        knobbed = [u for u in job["unresolved"] if u["code"] in ("OVER_PIXEL_BUDGET", "REF_SLOT_OVERFLOW")]
        check(all(u.get("knob") for u in knobbed), f"[坏例·{pfile.name}] 越预算/超槽位的点名都带旋钮（不许只喊失败）")

    print("\nimg-plan 自测 %s（%d 项失败）" % ("全绿" if not fails else "有失败", len(fails)))
    return 1 if fails else 0


def main() -> int:
    ap = argparse.ArgumentParser(description="分镜表 + 美术资产表 + 画像 → image-job@1（零网络）",
                                 allow_abbrev=False)
    # 内核 script 壳形态：<src> <out> --title --node --flow（core/src/minitools.ts:74）
    ap.add_argument("src", nargs="?", help="含 storyboard@1 块的分镜表 .md")
    ap.add_argument("out", nargs="?", help="image-job@1 落盘路径")
    ap.add_argument("--storyboard", dest="src_flag", help="同上（与位置参数二选一）")
    ap.add_argument("--assets", help="美术资产表 .md（asset-design@1）")
    ap.add_argument("--profile", help="image-profile@1 画像 json")
    ap.add_argument("--acceleration", default=str(REPO / "presets" / "image" / "acceleration.json"))
    ap.add_argument("--pages", help="页范围 1-4 / 2,3")
    ap.add_argument("--comic-dir", default="漫画", help="产物根目录名（默认 漫画）")
    ap.add_argument("--out-dir", help="job 落盘目录（src 缺 out 时用）")
    ap.add_argument("--concurrency", type=int, default=1, help="写进 job.policy（默认 1，放宽要人点名）")
    ap.add_argument("--on-task-fail", default="record_and_stop", choices=["record_and_stop", "record_and_continue"])
    ap.add_argument("--no-resume", action="store_true", help="关闭幂等续跑声明")
    ap.add_argument("--check", action="store_true", help="只校验不落盘")
    ap.add_argument("--selftest", action="store_true", help="跑 A 批验收自测（fixture + 出厂画像，零写盘）后退出")
    ap.add_argument("--title", default=None, help=argparse.SUPPRESS)
    ap.add_argument("--node", default=None, help=argparse.SUPPRESS)
    ap.add_argument("--flow", default=None, help=argparse.SUPPRESS)
    args = ap.parse_args()

    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

    if args.selftest:
        return selftest()

    src = Path(args.src) if args.src else (Path(args.src_flag) if args.src_flag else None)
    if not src:
        die("缺分镜表：位置参数 <src> 或 --storyboard 给一个")
    args.storyboard = src
    if not args.profile:
        die("缺画像：--profile <image-profile@1 json>（出厂件在 presets/image/profiles/）")

    sb, _, fmt_errs = extract_block(args.storyboard, "storyboard@1")
    if fmt_errs:
        for e in fmt_errs:
            print(f"  [硬缺陷] {e}", file=sys.stderr)
        return 1
    profile, p_errs = load_json(Path(args.profile))
    if p_errs:
        for e in p_errs:
            print(f"  [硬缺陷] {e}", file=sys.stderr)
        return 1
    assets = None
    if args.assets:
        assets, _, a_errs = extract_block(Path(args.assets), "asset-design@1")
        if a_errs:
            for e in a_errs:
                print(f"  [硬缺陷] {e}", file=sys.stderr)
            return 1

    # 契约校验（同一份 contracts/，Python 侧静态门）
    problems = contract_problems((("分镜表", sb, "storyboard.schema.json"),
                                  ("画像", profile, "image-profile.schema.json"),
                                  ("美术资产表", assets, "asset-design.schema.json")))
    for p in problems:
        print(p, file=sys.stderr)
    if problems:
        return 1

    args.profile = Path(args.profile)
    args.assets = Path(args.assets) if args.assets else None
    args.acceleration = Path(args.acceleration) if args.acceleration else None

    job, planner = plan(profile, sb, assets, args)

    out_path = None
    if not args.check:
        out_path = Path(args.out) if args.out else None
        if out_path is None:
            out_path = Path(args.out_dir or (args.storyboard.parent / args.comic_dir / "任务包")) / f"{job['job_id']}.json"
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(job, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return planner.report(job, out_path)


if __name__ == "__main__":
    sys.exit(main())
