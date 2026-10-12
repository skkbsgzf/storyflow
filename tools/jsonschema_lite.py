"""jsonschema-lite · contracts/*.schema.json 的纯 stdlib 子集校验器

存在理由：本仓纪律是「lint = 契约在静态门的手工等价物，纯 stdlib 不引第三方」（tools/kit-lint.py:360、
tools/_vendor/README.md 的显式失败口径）。图像链路的确定性件（img-plan / img-assets / img-drive）
必须拿**同一份 contracts/*.schema.json** 校验读写两端，否则就是第二套真相——
但 Python 侧没有 jsonschema 包，也不许为此引依赖（node_modules 那 6.5k/11.9k 文件的教训在前）。

支持的草稿子集（够用且只这些）：type（含 null 与联合）、required、properties、
additionalProperties:false、items、enum、const、pattern、minLength/maxLength、
minimum/maximum、minItems/maxItems、allOf、if/then/else、description/title（忽略）。
**不支持** $ref/anyOf/oneOf/not——契约里出现这些键，本校验器会显式点名拒绝，
而不是当作通过（静默放过比报错危险）。

用法：
    from jsonschema_lite import validate, load_schema
    problems = validate(obj, load_schema("contracts/storyboard.schema.json"))
    # problems: ["<路径>: <说明>", ...]，空列表即通过
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent

# 出现即拒绝的键：本校验器不实现它们，静默放过会制造「已校验」假象
UNSUPPORTED_KEYS = ("$ref", "anyOf", "oneOf", "not", "$defs", "definitions", "dependentRequired")

_TYPE_CHECKS = {
    "object": lambda v: isinstance(v, dict),
    "array": lambda v: isinstance(v, list),
    "string": lambda v: isinstance(v, str),
    "integer": lambda v: isinstance(v, int) and not isinstance(v, bool),
    "number": lambda v: isinstance(v, (int, float)) and not isinstance(v, bool),
    "boolean": lambda v: isinstance(v, bool),
    "null": lambda v: v is None,
}


def load_schema(name_or_path: str) -> dict:
    """按契约名或相对/绝对路径读 schema。读不到/解析不了 = 显式失败（不返回空 schema 蒙人）。"""
    p = Path(name_or_path)
    if not p.is_absolute():
        cand = ROOT / name_or_path
        if not cand.exists():
            cand = ROOT / "contracts" / name_or_path
        p = cand
    if not p.exists():
        raise FileNotFoundError(f"契约文件不存在: {p}")
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception as e:  # 坏 JSON 不许当「无约束」放过
        raise ValueError(f"契约解析失败 {p.name}: {e}") from e


def _walk_unsupported(schema: Any, where: str, out: list[str]) -> None:
    if isinstance(schema, dict):
        for k in UNSUPPORTED_KEYS:
            if k in schema:
                out.append(f"{where}: 契约用了未实现的键 {k}（本校验器不静默放过，请改契约或扩本件）")
        for k, v in schema.items():
            _walk_unsupported(v, f"{where}/{k}" if k in ("properties", "items", "additionalProperties", "if", "then", "else") else where, out)
    elif isinstance(schema, list):
        for i, v in enumerate(schema):
            _walk_unsupported(v, where, out)


def validate(value: Any, schema: dict, *, check_unsupported: bool = True) -> list[str]:
    """返回值是问题清单（空 = 通过）。路径用 JSON Pointer 风格片段，便于人定位到字段位。"""
    problems: list[str] = []
    if check_unsupported:
        _walk_unsupported(schema, "#", problems)
    _node(value, schema, "", problems)
    return problems


def _node(v: Any, s: dict, path: str, out: list[str]) -> None:
    if not isinstance(s, dict):
        return
    t = s.get("type")
    if t is not None:
        types = t if isinstance(t, list) else [t]
        if not any(_TYPE_CHECKS.get(x, lambda _v: True)(v) for x in types):
            out.append(f"{path or '#'}: 类型应为 {'|'.join(types)}，实为 {type(v).__name__}")
            return
    if "const" in s and v != s["const"]:
        out.append(f"{path or '#'}: 应为常量 {s['const']!r}，实为 {v!r}")
    if "enum" in s and v not in s["enum"]:
        out.append(f"{path or '#'}: 值 {v!r} 不在允许集合 {s['enum']}")
    if isinstance(v, dict):
        _obj(v, s, path, out)
    elif isinstance(v, list):
        _arr(v, s, path, out)
    elif isinstance(v, str):
        _str(v, s, path, out)
    elif isinstance(v, (int, float)) and not isinstance(v, bool):
        _num(v, s, path, out)
    for branch in s.get("allOf", []) or []:
        _node(v, branch, path, out)
    if "if" in s:
        probe: list[str] = []
        _node(v, s["if"], path, probe)
        branch = s.get("then") if not probe else s.get("else")
        if branch:
            _node(v, branch, path, out)


def _obj(v: dict, s: dict, path: str, out: list[str]) -> None:
    props = s.get("properties", {}) or {}
    for need in s.get("required", []) or []:
        if need not in v:
            out.append(f"{path or '#'}: 缺必填字段 {need}")
    ap = s.get("additionalProperties", True)
    if ap is False:
        for k in v:
            if k not in props:
                out.append(f"{path or '#'}: 出现契约外字段 {k}（additionalProperties:false）")
    elif isinstance(ap, dict):
        for k, sub in v.items():
            if k not in props:
                _node(sub, ap, f"{path}/{k}", out)
    for k, sub in props.items():
        if k in v:
            _node(v[k], sub, f"{path}/{k}", out)


def _arr(v: list, s: dict, path: str, out: list[str]) -> None:
    if "minItems" in s and len(v) < s["minItems"]:
        out.append(f"{path or '#'}: 元素数 {len(v)} < minItems {s['minItems']}")
    if "maxItems" in s and len(v) > s["maxItems"]:
        out.append(f"{path or '#'}: 元素数 {len(v)} > maxItems {s['maxItems']}")
    items = s.get("items")
    if isinstance(items, dict):
        for i, sub in enumerate(v):
            _node(sub, items, f"{path}[{i}]", out)
    elif isinstance(items, list):
        for i, sub in enumerate(v):
            if i < len(items):
                _node(sub, items[i], f"{path}[{i}]", out)


def _str(v: str, s: dict, path: str, out: list[str]) -> None:
    if "minLength" in s and len(v) < s["minLength"]:
        out.append(f"{path or '#'}: 长度 {len(v)} < minLength {s['minLength']}")
    if "maxLength" in s and len(v) > s["maxLength"]:
        out.append(f"{path or '#'}: 长度 {len(v)} > maxLength {s['maxLength']}")
    pat = s.get("pattern")
    if isinstance(pat, str):
        try:
            if not re.search(pat, v):
                out.append(f"{path or '#'}: 不匹配 {pat!r}（实值 {v[:40]!r}）")
        except re.error:
            out.append(f"{path or '#'}: 契约 pattern {pat!r} 在本引擎不可编译，请改契约")


def _num(v: Any, s: dict, path: str, out: list[str]) -> None:
    if "minimum" in s and v < s["minimum"]:
        out.append(f"{path or '#'}: {v} < minimum {s['minimum']}")
    if "maximum" in s and v > s["maximum"]:
        out.append(f"{path or '#'}: {v} > maximum {s['maximum']}")
