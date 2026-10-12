"""imglib · 图像链路的共用确定性小件（stdlib-only）

为什么单独立一个文件：出图这条链上有两件必须**逐字节算法一致**的活——
① 从 `.md` 里取机读围栏块（`storyboard@1` / `asset-design@1`），
② 算指纹（画像/任务/设计件）。任务包与资产台账如果对块或对指纹的理解差一点，
`stale_design` 就永远判不出来（改了设定没重出图 = 本仓反复被咬的「半接状态」）。
所以 `tools/img-plan.py` 与 `tools/img-assets.py` 共用这里，指纹口径只有一处真相。

纪律：零第三方依赖；同输入同输出；出错一律点名，不静默兜底。
"""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parent.parent
PLACEHOLDER = "<必填"          # 画像里未填的值（presets/image/README.md 约定）
JSON_FENCE = re.compile(r"```json[ \t]*\r?\n(.*?)\r?\n```", re.S)


def sha12(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:12]


def sha16(*parts: Any) -> str:
    blob = json.dumps(parts, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()[:16]


def slug(text: str, max_len: int = 28) -> str:
    s = re.sub(r"[^0-9A-Za-z]+", "-", str(text)).strip("-").lower()
    return (s[:max_len] or "x")


def extract_block(md_path: Path, fmt: str) -> tuple[dict | None, str | None, list[str]]:
    """从 .md 里取指定 format 的 ```json 块。命中 0 块或 >1 块都算硬缺陷（点名，不静默取第一块）。"""
    if not md_path.exists():
        return None, None, [f"文件不存在: {md_path}"]
    try:
        text = md_path.read_text(encoding="utf-8")
    except Exception as e:
        return None, None, [f"读取失败 {md_path.name}: {e}"]
    hits, docs = [], []
    for m in JSON_FENCE.finditer(text):
        raw = m.group(1)
        try:
            obj = json.loads(raw)
        except Exception:
            continue
        if isinstance(obj, dict) and obj.get("format") == fmt:
            hits.append(obj)
            docs.append(raw)
    if not hits:
        return None, None, [f"{md_path.name}: 未找到 ```json 内嵌的 {fmt} 块（分镜表/资产表必须是机读块 + 人读正文双承载）"]
    if len(hits) > 1:
        return None, None, [f"{md_path.name}: 找到 {len(hits)} 个 {fmt} 块，无法判定哪个是当前版（请只保留一个）"]
    return hits[0], docs[0], []


def load_json(path: Path) -> tuple[Any, list[str]]:
    if not path.exists():
        return None, [f"文件不存在: {path}"]
    try:
        return json.loads(path.read_text(encoding="utf-8")), []
    except Exception as e:
        return None, [f"JSON 解析失败 {path.name}: {e}"]


def has_placeholder(obj: Any, where: str = "#") -> list[str]:
    """画像里的 <必填> 未填位（值层面，不是结构层面）。"""
    out = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            out += has_placeholder(v, f"{where}/{k}")
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            out += has_placeholder(v, f"{where}[{i}]")
    elif isinstance(obj, str) and obj.startswith(PLACEHOLDER):
        out.append(where)
    return out


# 设计件指纹的取字段口径：改这里 = 全部历史产物的 design_fingerprint 变，台账会集体报 stale。
# 特意**不含** notes（人读批注不该触发重出图）。
DESIGN_KEYS = ["id", "class", "name", "intent", "prompt_prefix", "negative", "maturity", "variants"]


def design_digest(asset: dict) -> str:
    """设计件字段指纹（stale_design 判定的键）。字段序固定，改描述即改摘要。"""
    picked = {k: asset.get(k) for k in DESIGN_KEYS}
    picked["design"] = asset.get("design") or {}
    return sha16(picked)
