"""朱雀 AI 检测（官方 API 封装）——AI 味软信号检测 tool。

官方文档：https://cloud.tencent.com/document/product/1552/137539
Endpoint : POST https://ai-gateway.edgeone.link/v1/providers/zhuque-text/classify
鉴权     : Authorization: Bearer <API_KEY>（EdgeOne 控制台 → Makers → Models → 创建 API Key）
额度     : 每月免费 50 万 token（按 makers_models_usage.total_tokens 扣减）

定位（重要）：外部检测器是**软信号**——检测值方差大（同一作品不同章节 0%/44%/87% 均有实测），
本工具不做 block 裁决、不设硬阈值退出码；结果归人审，硬约束仍是 AE-PROSE-* 文本层断言。

用法：
    python tools/zhuque-check.py --file 对外交付/02-前三章终稿.md
    python tools/zhuque-check.py --file <md> --project p-fq-001     # 结果落收据 内部/收据/
    python tools/zhuque-check.py --text "……" --json
    echo "……" | python tools/zhuque-check.py

API Key 来源（优先级）：--key 参数 > 环境变量 ZHUQUE_API_KEY > 工作区根 .zhuque-key 文件（不入库）。
"""
import argparse
import hashlib
import json
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENDPOINT = "https://ai-gateway.edgeone.link/v1/providers/zhuque-text/classify"
LABELS = {"0": "人工", "1": "AI", "2": "疑似AI"}


def load_key(cli_key):
    if cli_key:
        return cli_key
    if os.environ.get("ZHUQUE_API_KEY"):
        return os.environ["ZHUQUE_API_KEY"].strip()
    kf = ROOT / ".zhuque-key"
    if kf.exists():
        return kf.read_text(encoding="utf-8").strip()
    return None


def detect(text, key, is_merge=True, timeout=60):
    import urllib.request

    req = urllib.request.Request(
        ENDPOINT,
        data=json.dumps({"text": text, "is_merge": is_merge}).encode("utf-8"),
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json",
                 "User-Agent": "miniflow-zhuque-check/1.0"},
        method="POST",
    )
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    data["_latencyMs"] = int((time.time() - t0) * 1000)
    return data


def summarize(data, top=5):
    """人读摘要：整体三分占比 + 可疑段落 top。"""
    labels = data.get("labels_ratio") or {}
    segs = [s for s in (data.get("segment_labels") or []) if s.get("label") != "0"]
    segs.sort(key=lambda s: s.get("conf", 0), reverse=True)
    lines = [
        f"softmax_confidence : {data.get('softmax_confidence')}",
        f"疑似风险占比       : {data.get('ratio_confidence')}",
        f"构成               : 人工 {labels.get('0', 0):.2%} ｜ AI {labels.get('1', 0):.2%} ｜ 疑似AI {labels.get('2', 0):.2%}",
        f"token 用量         : {data.get('makers_models_usage', {}).get('total_tokens', data.get('usage', {}).get('total_tokens', '?'))}（本月免费额度扣减口径）",
        f"耗时               : {data.get('_latencyMs')} ms",
    ]
    if segs:
        lines.append(f"可疑段落 top{min(top, len(segs))}：")
        for s in segs[:top]:
            excerpt = (s.get("text") or "").replace("\n", " ")[:48]
            lines.append(f"  [{LABELS.get(str(s.get('label')), s.get('label'))} {s.get('conf', 0):.2f}] {excerpt}…")
    return "\n".join(lines)


def receipt_path(project, source_name):
    d = ROOT / "projects" / project / "内部" / "收据"
    d.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    tag = hashlib.sha1(source_name.encode("utf-8")).hexdigest()[:6]
    return d / f"朱雀检测-{stamp}-{tag}.json"


LEDGER = ROOT / ".zhuque-usage.json"
MONTH = time.strftime("%Y-%m")


def quota_read():
    try:
        d = json.loads(LEDGER.read_text(encoding="utf-8"))
        return d if d.get("month") == MONTH else {"month": MONTH, "calls": 0, "tokens": 0}
    except Exception:
        return {"month": MONTH, "calls": 0, "tokens": 0}


def quota_write(d):
    LEDGER.write_text(json.dumps(d, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


def main():
    ap = argparse.ArgumentParser(description="朱雀 AI 味检测（官方 API，软信号；两级门的 L2——仅终稿/交付门对照用）")
    ap.add_argument("--file", help="待检文件（.md/.txt）")
    ap.add_argument("--text", help="直接传文本")
    ap.add_argument("--project", help="项目 id——提供则把结果落收据到 内部/收据/")
    ap.add_argument("--key", help="API Key（默认 env ZHUQUE_API_KEY 或工作区 .zhuque-key）")
    ap.add_argument("--no-merge", action="store_true", help="逐段独立出置信度（默认合并整篇）")
    ap.add_argument("--top", type=int, default=5, help="摘要中列出的可疑段落数")
    ap.add_argument("--json", action="store_true", help="输出完整 JSON（覆盖人读摘要）")
    ap.add_argument("--compare", help="本地打分 JSON（prose-scan --json 产物）→ 输出两级门对照表并写进收据")
    ap.add_argument("--budget", type=int, default=500000, help="本月 token 预算（默认 50 万；100%% 后拒绝调用，--force 强制）")
    ap.add_argument("--force", action="store_true", help="超预算仍强制调用")
    a = ap.parse_args()

    if a.file:
        text = Path(a.file).read_text(encoding="utf-8")
    elif a.text:
        text = a.text
    elif not sys.stdin.isatty():
        text = sys.stdin.read()
    else:
        ap.error("需要 --file / --text / stdin 其一")
    text = text.strip()
    if len(text) < 350:
        print(f"[warn] 送检文本 {len(text)} 字——朱雀网页口径 ≥350 字，过短结果的稳定性差", file=sys.stderr)

    key = load_key(a.key)
    if not key:
        print("[缺 API Key] 三选一：--key 参数 ｜ 环境变量 ZHUQUE_API_KEY ｜ 工作区根 .zhuque-key 文件。\n"
              "Key 获取：EdgeOne 控制台（console.tencentcloud.com/edgeone）→ Makers → Models → 创建 API Key。\n"
              "官方文档：https://cloud.tencent.com/document/product/1552/137539（每月免费 50 万 token）", file=sys.stderr)
        sys.exit(2)

    # 配额台账（50 万/月纪律）：100% 后拒绝调用，--force 才放行
    q = quota_read()
    if q["tokens"] > a.budget and not a.force:
        print(f"[配额用尽] 本月已用 {q['tokens']} / {a.budget} token（{q['calls']} 次）。"
              f"L1 本地打分（prose-scan --json）免费且够用；确需追加 → --force", file=sys.stderr)
        sys.exit(4)

    try:
        data = detect(text, key, is_merge=not a.no_merge)
    except Exception as e:
        print(f"[检测失败] {type(e).__name__}: {e}", file=sys.stderr)
        sys.exit(3)
    if data.get("status") not in ("success", None):
        print(f"[检测未成功] status={data.get('status')} msg={data.get('msg')}", file=sys.stderr)
        sys.exit(3)

    # 台账记账 + 预算预警（80% 提示）
    used = (data.get("makers_models_usage") or {}).get("total_tokens") or (data.get("usage") or {}).get("total_tokens") or 0
    q["calls"] += 1
    q["tokens"] += used
    quota_write(q)
    pct = q["tokens"] / a.budget if a.budget else 0
    if pct >= 0.8:
        print(f"[配额预警] 本月已用 {q['tokens']}/{a.budget} token（{pct:.0%}）——L2 只留终稿对照用", file=sys.stderr)

    compare = None
    if a.compare:
        try:
            local = json.loads(Path(a.compare).read_text(encoding="utf-8"))
            li = local.get("aiIndex")
            sm = data.get("softmax_confidence")
            rc = data.get("ratio_confidence")
            compare = {
                "localScan": a.compare, "aiIndex": li,
                "zhuqueSoftmax": sm, "zhuqueRatio": rc,
                "delta": (round(abs(li - sm * 100), 1) if isinstance(li, (int, float)) and isinstance(sm, (int, float)) else None),
            }
            if not a.json:
                print(f"两级门对照：本地AI味指数 {li}/100 ｜ 朱雀 softmax {sm} ｜ 疑似占比 {rc}"
                      f"（Δ={compare['delta']}——Δ 持续小 = 本地打分可单独站门）")
        except Exception as e:
            print(f"[对照失败] {e}（不影响检测结果）", file=sys.stderr)

    if a.json:
        print(json.dumps({"compare": compare, **data}, ensure_ascii=False, indent=2))
    else:
        print(summarize(data, top=a.top))

    if a.project:
        rp = receipt_path(a.project, a.file or "stdin")
        rp.write_text(json.dumps({
            "tool": "tools/zhuque-check.py", "endpoint": ENDPOINT, "at": time.strftime("%Y-%m-%d %H:%M:%S"),
            "source": a.file or "stdin", "chars": len(text),
            "compare": compare,
            "quota": q,
            "result": {k: v for k, v in data.items()},
        }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"收据：{rp.relative_to(ROOT)}", file=sys.stderr)


if __name__ == "__main__":
    main()
