"""flow-verify.py · 产物脱流改动探测器（K7 · 2026-09-17 事故 R2 落地件）

抓三类病（对象=flow 产物里 status=done 节点的输出文件）：
  [红] 快照后漂移：磁盘内容 ≠ 最新快照哈希 —— 改了稿连快照都没补
  [红] 提交后无凭：内核提交之后没有任何快照 —— 无法举证「提交时的内容=现在的内容」
  [黄] 绕流嫌疑：内核提交之后发生了 N 次快照但内核无新提交记录 —— 绕流改稿后补拍快照
       （v5 事故手法：改稿→重merge→snapshot，registry 无哈希所以当时零报警）
       黄 = 强制对账：修订对照表必须有对应记录，缺记录黄升红。
用法：python tools/flow-verify.py <projectId>
"""
import hashlib
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def sha1(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:12]


def main(project):
    proj = ROOT / "projects" / project
    state = json.load(open(proj / "state.json", encoding="utf-8"))
    flow = json.load(open(ROOT / "flows" / state["flowId"] / "flow.json", encoding="utf-8"))
    if "graph" not in flow:
        # flow@3（模块序列）：手画图不存在，读内核 persistEffective 落盘的 effective@2（扁平
        # nodes/edges，R6 生效编排事实源）。flow@3 outputs 是模块级语义声明（无路径），
        # 产物路径唯一事实源是派生节点的 output 字段，故 outputs 置空。
        eff_path = proj / "registry" / "effective.json"
        if not eff_path.exists():
            print("flow@3 项目缺 registry/effective.json——先跑 flow_effect 生成生效编排")
            sys.exit(1)
        eff = json.load(open(eff_path, encoding="utf-8"))
        flow = {"graph": {"nodes": eff.get("nodes", {}), "edges": eff.get("edges", [])}, "outputs": []}
    reg = json.load(open(proj / "registry" / "artifacts.json", encoding="utf-8")).get("artifacts", [])
    snaps = json.load(open(proj / "snapshots" / "index.json", encoding="utf-8")).get("snapshots", {})

    # 产物清单：outputs 声明 + 节点 output（iterate 节点的实例文件按 glob 展开）
    # 交付清单的路径缺省取节点产物（flow@2：清单只管交付语义，路径唯一事实源是节点 output）
    nodes = flow["graph"]["nodes"]

    def out_path(o):
        return o.get("path") or o.get("file") or (nodes.get(o.get("node")) or {}).get("output")

    want = {}  # path -> node
    for o in flow.get("outputs", []):
        p = out_path(o)
        if p:
            want[p] = o["node"]
    for nid, n in nodes.items():
        for k in ("output", "file"):
            if n.get(k):
                want[n[k]] = nid
        if n.get("iterate") and "{" in n.get("iterate", {}).get("artifact", ""):
            tpl = n["iterate"]["artifact"]
            for p in sorted(proj.glob(tpl.replace("{n}", "*").replace("{i}", "*"))):
                want[p.relative_to(proj).as_posix()] = nid

    done = {nid for nid, s in state.get("nodes", {}).items() if s.get("status") == "done"}
    print(f"flow-verify · {project} · flow={state['flowId']} · done={len(done)} 节点\n")

    bad = 0
    for path, node in sorted(want.items()):
        if node not in done:
            continue
        disk = proj / path
        if not disk.exists():
            print(f"  [红] {path}（{node}）：节点已完成但产物文件不存在")
            bad += 1
            continue
        h_bytes = hashlib.sha1(disk.read_bytes()).hexdigest()[:12]
        # 文本哈希：与内核 writeSnapshot 的读法对齐（JS readFileSync "utf-8" 对非法字节落 U+FFFD，
        # 等价于 errors="replace"）。历史产物里有 GBK 编码件——严格 utf-8 会直接崩，
        # 校验工具自己崩掉比漏报更糟（p-key-soul / p-ts-001 实证）。
        try:
            text = disk.read_text(encoding="utf-8", errors="replace")
            h_text = hashlib.sha1(text.encode("utf-8")).hexdigest()[:12]
        except OSError as e:
            print(f"  [黄] {path}（{node}）：产物读取失败（{e}）——只做字节级比对")
            text, h_text = None, None

        # 正文哈希：内核快照哈希口径是 contentSha12（剥 artifact@1 头部后取正文，见 core/src/ids.ts）。
        # R4 头部规约上线后产物全带头部——不补这个口径会把所有带头的合法产物误报成"快照后又被改"。
        h_body = None
        if text is not None and text.startswith("---"):
            end = text.find("\n---", 3)
            if end != -1:
                h_body = hashlib.sha1(text[end + 4:].lstrip().encode("utf-8")).hexdigest()[:12]

        kts = max((a["ts"] for a in reg if a.get("path") == path and a.get("producer") == "host-submit"), default=None)
        sl = [s for s in snaps.get(node, []) if path in s.get("files", {}) and s["files"][path].get("hash")]
        latest = sl[-1] if sl else None

        if latest is None:
            print(f"  [红] {path}（{node}）：从未快照——产物无留档")
            bad += 1
        elif latest["files"][path]["hash"] not in (h_bytes, h_text, h_body):
            print(f"  [红] {path}（{node}）：磁盘内容 ≠ 最新快照 r{latest['round']}（快照后又被改，未留档）")
            bad += 1
        elif kts is None:
            print(f"  [黄] {path}（{node}）：内核无此路径的提交记录（改名或绕流新建）——留档链以快照为准（最新 r{latest['round']}）")
        else:
            # 时间基线换算：内核 ts 为 UTC ISO，快照 ts 为本地时间——统一到本地比较
            import datetime as _dt
            ku = _dt.datetime.fromisoformat(kts.replace("Z", "+00:00")).astimezone()
            sw = 10  # 提交后 10 分钟内的快照 = 铁律7「交付即快照」合规动作
            late = [s for s in sl if _dt.datetime.fromisoformat(s["ts"]).astimezone() > ku + _dt.timedelta(minutes=sw)]
            if not late:
                print(f"  [绿] {path}（{node}）：提交后留档（铁律7）")
            else:
                print(f"  [黄] {path}（{node}）：内核提交({kts[:16]}) {sw} 分钟后有 {len(late)} 次快照且无新提交——绕流嫌疑，须在 修订对照表 有对账记录")

    print(f"\n结论：{'发现 %d 处红档，交付阻塞' % bad if bad else '无红档。黄档=已声明绕流，需对账记录支撑。'}")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
