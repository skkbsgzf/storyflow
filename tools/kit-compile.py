#!/usr/bin/env python3
"""kit-compile · 把语料 md 编译为 HyperGraphRAG 图文件（storyflow-hypergraph@1）。

两种模式（产物同构，严格分根——双根铁律）：
  全局（缺省）：knowledge/**/*.md → kit/hypergraph.rag.json
    GitHub 上 knowledge 层只发布**一个向量图文件**（词条 + 关系边 + 统计），
    松散 md 是**本地可插拔层**（引擎现读盘；不进 git）。用户改/增 md 后重跑本脚本重建图。
  项目档（--project <id>）：projects/<id>/ 的 世界书/**/*.md（含记忆卡）+ 规则/**/*.md（若有）
    + 文风/**/*.md（若有，批次2.5 P1）→ projects/<id>/kit/hypergraph.rag.json（stats.scope=project）。
    **项目档绝不写全局 kit/；全局模式行为一字不变。**

图形态与内核 worldbook/graph.json 同族（worldbook-graph@1）：
  entries  {id, title, domain, path, tags}
  relations {from, to, kind, weight}   kind ∈ link(声明边) | mention(正文互涉)
条目 id 前缀：全局 kb/<域>/<名>；项目档 pj/<项目相对路径>（与全局不撞号）。
项目档 entries[].path 是**项目根相对** posix 路径（core kb 检索按 projectDir 解析正文）。

用法：
  python tools/kit-compile.py [--root .]                    # 全局
  python tools/kit-compile.py --project <id> [--root .]     # 项目档
  python tools/kit-compile.py [--project <id>] --check      # 干跑（批次2.5 P4）
  python tools/kit-compile.py --selfcheck                   # 聚类确定性自测（R2，合成语料）
退出码：成功 0；失败 1；--check 下不一致/盘上无产物也为 1（一致 0）。

编译期聚类（批次3c R2）：词条按「标题+正文首段」的字符 bigram TF-IDF 向量做凝聚聚类
（average-linkage cosine ≥ CLUSTER_SIM_THRESHOLD 才合并，全 stdlib、全确定性、重跑同簇号
同簇名）。写产物不回写卡：entries[].cluster 簇名 + 顶层 stats.clusters（簇名/成员数，簇数=
len）。检索面消费见 core/src/kb.ts kbSearch（两段式聚簇检索 + cluster 过滤参数）。

--check（干跑，零写盘）：按同一构建逻辑在内存里重编译，与盘上现存产物逐键比对——
  一致            exit 0，打印「一致」；
  不一致          exit 1，打印差异摘要（条目/边数变化 + 首个不一致 key）；
  盘上无产物      exit 1，提示先编译。
全局与 --project 两模式均支持；幂等，任何情况下不写盘。
"""
import json, math, re, sys
from pathlib import Path

# 卡头围栏（front() 与聚类/标题回落共用——先剥信封再谈正文）
FM_RE = re.compile(r'\A---\s*\n(.*?)\n---\s*\n?', re.S)


def parse_args(argv: list[str]):
    root = Path(argv[argv.index('--root') + 1] if '--root' in argv else '.')
    project = None
    for i, a in enumerate(argv):
        if a == '--project':
            if i + 1 >= len(argv):
                raise SystemExit('[ABORT] --project 缺项目 id')
            project = argv[i + 1]
    check = '--check' in argv
    selfcheck = '--selfcheck' in argv
    return root, project, check, selfcheck


def front(text: str) -> dict:
    """卡头解析（批次3b Q2 · A1 根因修复）：`---` 围栏内**先试 JSON**（本库卡信封约定，
    knowledge/README.md「JSON frontmatter + 人可读正文」，存量 107/107 张带头卡全部 JSON），
    失败再退 YAML 裸键行（历史行为，向后兼容——旧工具/手写裸键头仍可解析）。
    旧版只认裸键行：JSON 卡的行以 `"key":` 开头永不匹配 → id/title 全回落
    （title 落 `---` 分隔线、tags 空、声明 id 丢失），即 kb-health-20261011 A1 收据的伪边根因。"""
    m = FM_RE.match(text)
    if not m:
        return {}
    raw = m.group(1)
    try:
        fm = json.loads(raw)
        if isinstance(fm, dict):
            return fm
    except ValueError:  # 含 JSONDecodeError：非 JSON 才走裸键兜底
        pass
    out = {}
    for line in raw.splitlines():
        mm = re.match(r'^([A-Za-z_][\w-]*):\s*(.*)$', line)
        if mm:
            out[mm.group(1)] = mm.group(2).strip()
    return out


# ── 批次3c R2 · 编译期聚类（全 stdlib、全确定性；写产物不回写卡）──────────────────
# 方法：卡标题 + 正文首段 → 字符 bigram TF-IDF 向量（L2 归一）→ 凝聚聚类（average-linkage
# cosine，≥ 阈值才合并）。合并按「最高相似度胜出、并列取代表下标对最小」全序比较，无任何
# 随机源——重跑同簇号同簇名。簇标签 = 簇内向量求和的 top 词（权重降序、gram 升序破平）。
CLUSTER_SIM_THRESHOLD = 0.06  # 平均链接 cosine 合并阈值：0.06 下标题+正文首段共享几处双字词即聚；
                              # 调高簇更碎（对标族散成单例）、调低簇更大（aesthetic/rules 混簇）。
                              # 依据：R2 评测 3 轮扫描（0.08→0.06→0.04），0.06 档 after 总体与交叉
                              # 探针双优（cross MRR 0.0891 / 0.0874@0.04 / 0.0838@0.08），定档 0.06。
CLUSTER_TOP_K = 3             # 簇标签取 top 词数（如 簇#03[钩子,开篇,悬念]）
CLUSTER_TEXT_CHARS = 200      # 聚类语料窗口：标题+正文前 N 字（归一后）。200 字≈首段+表格头，
                              # 让同族模板语料（benchmark/rules/semif）有足够共现面凝聚成簇；
                              # 过小（首行）会让对标族 21/28 沦为单例簇，检索两段式失去锚点。
_GRAM_NORM = re.compile(r'[^0-9A-Za-z\u4e00-\u9fff]+')  # 归一：只留中英文与数字（kb-health 同式）


def _cluster_text(title: str, raw: str) -> str:
    """聚类语料 = 标题 + 正文前 CLUSTER_TEXT_CHARS 字：先剥 frontmatter，正文剥 markdown 记号后归一。"""
    m = FM_RE.match(raw)
    body = raw[m.end():] if m else raw
    buf: list[str] = [title]
    seen = 0
    for line in body.splitlines():
        s = line.strip()
        if not s:
            continue
        buf.append(s.lstrip('#>*`-—= \t'))
        seen += len(s)
        if seen >= CLUSTER_TEXT_CHARS:
            break
    return _GRAM_NORM.sub('', ''.join(buf)[:CLUSTER_TEXT_CHARS + 60])


def cluster_entries(entries: list, texts_by_rel: dict, path_prefix: str) -> list:
    """就地给 entries[i] 写 cluster（簇名），返回 stats.clusters 列表 [{name, size}]。

    entries 与 texts_by_rel 的对位键：entry['path'] 去 path_prefix 即 rel（build_graph 同款）。
    全程无随机：doc 序 = entries 序；合并 = (相似度降, 代表下标对升) 全序取最大。"""
    n = len(entries)
    if n == 0:
        return []
    docs = [_cluster_text(e.get('title') or '', texts_by_rel.get(e['path'].removeprefix(path_prefix), ''))
            for e in entries]
    grams = [{d[i:i + 2] for i in range(len(d) - 1)} for d in docs]
    df: dict = {}
    for g in grams:
        for x in g:
            df[x] = df.get(x, 0) + 1
    idf = {x: math.log(n / d) for x, d in df.items()}
    vecs: list[dict] = []
    for g in grams:
        v: dict = {}
        for x in g:
            v[x] = v.get(x, 0) + idf.get(x, 0.0)
        norm = math.sqrt(sum(w * w for w in v.values())) or 1.0
        vecs.append({x: w / norm for x, w in v.items()})

    def cos(a: dict, b: dict) -> float:
        if len(a) > len(b):
            a, b = b, a
        return sum(w * b.get(x, 0.0) for x, w in a.items())

    # 两两余弦矩阵先算死（n² 次向量点积），凝聚循环只查表求和——总体 O(n²) 点积 + O(n³) 查表，
    # n=120 时毫秒级，且查表口径让合并序列只依赖矩阵本身（确定性另一重保险）。
    cosm = [[0.0] * n for _ in range(n)]
    for i in range(n):
        for j in range(i + 1, n):
            c = cos(vecs[i], vecs[j])
            cosm[i][j] = cosm[j][i] = c

    # 凝聚聚类（average-linkage）：每轮找平均相似度最高且 ≥ 阈值的簇对合并
    clusters: list[list[int]] = [[i] for i in range(n)]

    def link(ca: list, cb: list) -> float:
        s = sum(cosm[i][j] for i in ca for j in cb)
        return s / (len(ca) * len(cb))

    while len(clusters) > 1:
        best_s, best_pair, best_key = -1.0, None, None
        for i in range(len(clusters)):
            for j in range(i + 1, len(clusters)):
                s = link(clusters[i], clusters[j])
                if s < CLUSTER_SIM_THRESHOLD:
                    continue
                # 破平：相似度并列时取「代表（首成员）下标对」最小者——负号化后比大小即最小者胜
                key = (-clusters[i][0], -clusters[j][0])
                if best_pair is None or s > best_s + 1e-12 or (abs(s - best_s) <= 1e-12 and key > best_key):
                    best_s, best_pair, best_key = s, (i, j), key
        if best_pair is None:
            break
        na, nb = best_pair
        a, b = clusters[na], clusters[nb]
        merged = sorted(a + b)
        clusters = [c for k, c in enumerate(clusters) if k not in (na, nb)] + [merged]
        clusters.sort(key=lambda c: c[0])  # 收敛表示态：按首成员下序，重跑形态唯一

    clusters.sort(key=lambda c: c[0])
    out: list = []
    for idx, members in enumerate(clusters, 1):
        agg: dict = {}
        for i in members:
            for x, w in vecs[i].items():
                agg[x] = agg.get(x, 0.0) + w
        # 标签优先纯中文 gram（表格数字/ASCII 碎片如「7均」「39」权重再高也不上标签——
        # 只影响簇名可读性，不影响成员划分）；簇内无中文 gram 才回退全量。
        cjk = {x: w for x, w in agg.items() if all('\u4e00' <= ch <= '\u9fff' for ch in x)}
        pool = cjk or agg
        top = sorted(pool.items(), key=lambda kv: (-kv[1], kv[0]))[:CLUSTER_TOP_K]
        label = ','.join(x for x, _ in top)
        name = f'簇#{idx:02d}[{label}]' if label else f'簇#{idx:02d}'
        for i in members:
            entries[i]['cluster'] = name
        out.append({'name': name, 'size': len(members)})
    return out


def build_graph(src_files: list, id_prefix: str, path_prefix: str):
    """扫卡 → (entries, relations, cluster_stats)。src_files = [(rel, Path)]；id = <id_prefix>/rel去.md；
    entries[].path = <path_prefix>+rel（全局带 knowledge/ 前缀，项目档带空前缀）；
    cluster_stats = 编译期聚类账（R2，entries[].cluster 已就地写入）。"""
    entries, by_title, texts = [], {}, {}
    # 与历史全局模式同序：按 Path 排序（Windows 下 PurePath 比较口径），保证产物逐字节可复现
    for rel, p in sorted(src_files, key=lambda x: x[1]):
        if p.name.upper() == 'README.MD':
            continue
        domain = rel.split('/')[0]
        text = p.read_text(encoding='utf-8')
        texts[rel] = text
        fm = front(text)
        eid = fm.get('id') or (id_prefix + '/' + rel.removesuffix('.md'))
        # title 回落：先剥 frontmatter 再取首个非空正文行（R2 起带信封无 title 的卡——如
        # user-style-rules 用户手改区补 track 信封——不再回落到『---』分隔线伪标题）
        fm_m = FM_RE.match(text)
        body = text[fm_m.end():] if fm_m else text
        first_line = next((l for l in body.splitlines() if l.strip()), '')
        title = fm.get('title') or (first_line.lstrip('# \n')[:60] if first_line.strip() else rel)
        # tags：JSON 信封下是真列表（直取）；裸键兜底下是逗号串（历史正则提取）——两态都收敛为 str 列表
        raw_tags = fm.get('tags')
        if isinstance(raw_tags, list):
            tags = [str(t).strip() for t in raw_tags if str(t).strip()]
        else:
            tags = re.findall(r'"?([\w\-组成]+)"?', raw_tags) if raw_tags else []
        entries.append({'id': eid, 'title': title, 'domain': domain, 'path': path_prefix + rel, 'tags': tags[:8]})
        by_title[title] = eid

    relations, seen = [], set()
    for e in entries:
        text = texts.get(e['path'].removeprefix(path_prefix), '')
        for other in entries:
            if other['id'] == e['id'] or not other['title']:
                continue
            if other['title'] in text:
                key = tuple(sorted((e['id'], other['id'])))
                if key not in seen:
                    seen.add(key)
                    relations.append({'from': e['id'], 'to': other['id'], 'kind': 'mention', 'weight': 1})
    cluster_stats = cluster_entries(entries, texts, path_prefix)
    return entries, relations, cluster_stats


def write_doc(out: Path, note: str, entries: list, relations: list, extra_stats: dict) -> None:
    stats = {'entries': len(entries), 'relations': len(relations),
             'domains': sorted({e['domain'] for e in entries})}
    stats.update(extra_stats)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({
        'format': 'storyflow-hypergraph@1',
        'note': note,
        'stats': stats,
        'entries': entries,
        'relations': relations,
    }, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def compile_doc(root: Path, project: str | None):
    """构建但不写盘 → (out, note, entries, relations, extra_stats)；无可编译语料返回 None。

    --check 干跑（批次2.5 P4）与正式编译共用此函数，保证「比对的就是会写盘的那份」。
    R2 起 extra_stats 带 clusters（编译期聚类账），entries[].cluster 同步进产物。"""
    if project is None:
        # ── 全局模式（与历史版本同构）──
        src = root / 'knowledge'
        out = root / 'kit' / 'hypergraph.rag.json'
        files = [(p.relative_to(src).as_posix(), p) for p in src.rglob('*.md')]
        entries, relations, clusters = build_graph(files, 'kb', 'knowledge/')
        return out, ('knowledge 语料的 HyperGraphRAG 编译产物（词条+关系边+编译期聚类簇）。源 md 是本地可插拔层，不进 git；改 md 后重跑 tools/kit-compile.py。',
                     entries, relations, {'clusters': clusters})
    # ── 项目档模式（R2.2）：只读 projects/<id>/，只写 projects/<id>/kit/ ──
    proj = root / 'projects' / project
    if not proj.is_dir():
        print(f'[ABORT] 项目目录不存在：{proj}')
        return None
    files: list = []
    # 世界书（含记忆卡）+ 项目级规则卡 + 文风卡（批次2.5 P1）；有 md 才编，
    # 空目录（只有 README）零贡献不报错——README 本就不入图（见 build_graph）。
    for sub in ('世界书', '规则', '文风'):
        d = proj / sub
        if d.is_dir():
            files.extend((p.relative_to(proj).as_posix(), p) for p in d.rglob('*.md'))
    if not files:
        print(f'[ABORT] 项目无可编译语料（世界书/ 规则/ 文风/ 下无 md）：{proj}')
        return None
    out = proj / 'kit' / 'hypergraph.rag.json'
    entries, relations, clusters = build_graph(files, 'pj', '')
    return out, (f'项目档 HyperGraphRAG 编译产物（scope=project；源=projects/{project}/ 世界书、规则卡与文风卡，含记忆卡）。'
                 f'改源后重跑 tools/kit-compile.py --project {project}；本产物绝不写全局 kit/。',
                 entries, relations, {'scope': 'project', 'clusters': clusters})


def check_doc(out: Path, entries: list, relations: list) -> int:
    """干跑比对（批次2.5 P4）：内存重编译结果 vs 盘上现存产物。零写盘、幂等。

    一致 exit 0；不一致/盘上无产物 exit 1，差异摘要 = 条目/边数变化 + 首个不一致 key。
    """
    if not out.exists():
        print(f'[CHECK] 盘上无产物：{out} —— 先跑 tools/kit-compile.py（项目档加 --project <id>）编译后再 --check')
        return 1
    try:
        disk = json.loads(out.read_text(encoding='utf-8'))
    except (OSError, ValueError) as e:
        print(f'[CHECK] 盘上产物不可读/非法 JSON：{out}（{e}）—— 重跑编译重建后再 --check')
        return 1
    disk_e: list = disk.get('entries') or []
    disk_r: list = disk.get('relations') or []
    if disk_e == entries and disk_r == relations:
        print(f'一致：{out}（{len(entries)} 词条 / {len(relations)} 边，与重编译结果逐键一致）')
        return 0
    # ── 差异摘要：先报数量变化，再定位首个不一致 key ──
    print(f'不一致：{out}')
    if len(disk_e) != len(entries) or len(disk_r) != len(relations):
        print(f'  数量变化：词条 盘上 {len(disk_e)} → 编译 {len(entries)}；边 盘上 {len(disk_r)} → 编译 {len(relations)}')
    def _first_diff(label: str, disk_list: list, new_list: list) -> None:
        for i in range(min(len(disk_list), len(new_list))):
            if disk_list[i] != new_list[i]:
                key = next((k for k in set(disk_list[i]) | set(new_list[i])
                            if (disk_list[i] or {}).get(k) != (new_list[i] or {}).get(k)), '')
                print(f'  首个不一致：{label}[{i}].{key}（盘上 {(disk_list[i] or {}).get(key)!r} → 编译 {(new_list[i] or {}).get(key)!r}）')
                return
        side = '盘上多出' if len(disk_list) > len(new_list) else '编译多出'
        i = min(len(disk_list), len(new_list))
        print(f'  首个不一致：{label}[{i}]（{side}：盘上 {disk_list[i] if i < len(disk_list) else "—"} / 编译 {new_list[i] if i < len(new_list) else "—"}）')
    if disk_e != entries:
        _first_diff('entries', disk_e, entries)
    else:
        _first_diff('relations', disk_r, relations)
    print('  重跑 tools/kit-compile.py（项目档加 --project <id>）可重建产物')
    return 1


def selfcheck() -> int:
    """聚类确定性自测（R2）：合成语料在内存里编译两遍，entries/relations/clusters 必须逐键一致；
    另钉簇名形状（簇#NN[top词]）与 stats 可归账。零真实语料依赖、零写盘。"""
    import tempfile
    corpus = {
        'aesthetic/hook.md': '---\n{\n  "id": "kb/aesthetic/hook",\n  "title": "开场钩子标准",\n  "tags": ["hook"]\n}\n---\n\n# 开场钩子标准\n\n三秒内必须让观众产生生理反应，开场即冲突。\n',
        'aesthetic/opening.md': '---\n{\n  "id": "kb/aesthetic/opening",\n  "title": "开篇钩子手法",\n  "tags": ["hook"]\n}\n---\n\n# 开篇钩子手法\n\n开场即冲突，悬念前置，三秒定去留。\n',
        'market/price.md': '---\n{\n  "id": "kb/market/price",\n  "title": "定价对标方法",\n  "tags": ["market"]\n}\n---\n\n# 定价对标方法\n\n热度分位与约束分布决定题材选择与定价对标。\n',
        'market/supply.md': '---\n{\n  "id": "kb/market/supply",\n  "title": "供给结构观察",\n  "tags": ["market"]\n}\n---\n\n# 供给结构观察\n\n题材热度矩阵决定供给结构，定价对标年年翻新。\n',
        'craft/zen.md': '---\n{\n  "id": "kb/craft/zen",\n  "title": "孤篇卡",\n  "tags": []\n}\n---\n\n# 孤篇卡\n\n与谁都不相似的孤立正文。\n',
    }
    with tempfile.TemporaryDirectory() as td:
        src = Path(td) / 'knowledge'
        for rel, content in corpus.items():
            fp = src / rel
            fp.parent.mkdir(parents=True, exist_ok=True)
            fp.write_text(content, encoding='utf-8')
        files = [(p.relative_to(src).as_posix(), p) for p in src.rglob('*.md')]

        def build():
            entries, relations, clusters = build_graph(files, 'kb', 'knowledge/')
            return json.dumps({'entries': entries, 'relations': relations, 'clusters': clusters},
                              ensure_ascii=False, sort_keys=True)

        a, b = build(), build()
        if a != b:
            print('[FAIL] 聚类确定性破坏：同一语料两次编译结果不一致')
            return 1
        doc = json.loads(a)
        names = [c['name'] for c in doc['clusters']]
        if len(names) != len(set(names)):
            print(f'[FAIL] 簇名重复：{names}')
            return 1
        if any(not re.fullmatch(r'簇#\d{2}(\[[^\]]+\])?', n) for n in names):
            print(f'[FAIL] 簇名形状不符：{names}')
            return 1
        sized = sum(c['size'] for c in doc['clusters'])
        if sized != len(doc['entries']):
            print(f'[FAIL] 簇成员账不平：{sized} ≠ {len(doc["entries"])}')
            return 1
        for e in doc['entries']:
            if not e.get('cluster'):
                print(f"[FAIL] 词条缺 cluster：{e['id']}")
                return 1
        print(f'selfcheck OK：合成 {len(doc["entries"])} 卡 → {len(names)} 簇（{"、".join(names)}），'
              f'两次编译逐字节一致，簇名唯一且成员账平')
        return 0


def main() -> int:
    root, project, check, selfcheck_only = parse_args(sys.argv[1:])
    if selfcheck_only:
        return selfcheck()
    built = compile_doc(root, project)
    if built is None:
        return 1
    out, (note, entries, relations, extra_stats) = built
    clusters = extra_stats.get('clusters') or []
    if check:
        return check_doc(out, entries, relations)
    if project is None:
        # ── 全局模式（A1 修复后产物=真 title/tags/声明 id；R2 起带编译期聚类；写盘路径行为与历史同构）──
        write_doc(out, note, entries, relations, extra_stats)
        print(f'kit/hypergraph.rag.json ← {len(entries)} 词条 / {len(relations)} 边 / {len(clusters)} 簇')
        return 0

    # ── 项目档模式（R2.2）：只读 projects/<id>/，只写 projects/<id>/kit/ ──
    write_doc(out, note, entries, relations, extra_stats)
    print(f'projects/{project}/kit/hypergraph.rag.json ← {len(entries)} 词条 / {len(relations)} 边 / {len(clusters)} 簇（scope=project；全局 kit/ 未动）')
    return 0


if __name__ == '__main__':
    sys.exit(main())
