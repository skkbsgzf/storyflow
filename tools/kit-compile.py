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
退出码：成功 0；失败 1。
"""
import json, re, sys
from pathlib import Path


def parse_args(argv: list[str]):
    root = Path(argv[argv.index('--root') + 1] if '--root' in argv else '.')
    project = None
    for i, a in enumerate(argv):
        if a == '--project':
            if i + 1 >= len(argv):
                raise SystemExit('[ABORT] --project 缺项目 id')
            project = argv[i + 1]
    return root, project


def front(text: str) -> dict:
    FM = re.compile(r'\A---\s*\n(.*?)\n---\s*\n?', re.S)
    m = FM.match(text)
    out = {}
    if m:
        for line in m.group(1).splitlines():
            mm = re.match(r'^([A-Za-z_][\w-]*):\s*(.*)$', line)
            if mm:
                out[mm.group(1)] = mm.group(2).strip()
    return out


def build_graph(src_files: list, id_prefix: str, path_prefix: str):
    """扫卡 → (entries, relations)。src_files = [(rel, Path)]；id = <id_prefix>/rel去.md；
    entries[].path = <path_prefix>+rel（全局带 knowledge/ 前缀，项目档带空前缀）。"""
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
        title = fm.get('title') or (text.lstrip('# \n').splitlines()[0][:60] if text.strip() else rel)
        tags = re.findall(r'"?([\w\-组成]+)"?', fm.get('tags', '')) if fm.get('tags') else []
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
    return entries, relations


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


def main() -> int:
    root, project = parse_args(sys.argv[1:])
    if project is None:
        # ── 全局模式（行为与历史版本逐字节一致）──
        src = root / 'knowledge'
        out = root / 'kit' / 'hypergraph.rag.json'
        files = [(p.relative_to(src).as_posix(), p) for p in src.rglob('*.md')]
        entries, relations = build_graph(files, 'kb', 'knowledge/')
        write_doc(out,
                  'knowledge 语料的 HyperGraphRAG 编译产物（词条+关系边）。源 md 是本地可插拔层，不进 git；改 md 后重跑 tools/kit-compile.py。',
                  entries, relations, {})
        print(f'kit/hypergraph.rag.json ← {len(entries)} 词条 / {len(relations)} 边')
        return 0

    # ── 项目档模式（R2.2）：只读 projects/<id>/，只写 projects/<id>/kit/ ──
    proj = root / 'projects' / project
    if not proj.is_dir():
        print(f'[ABORT] 项目目录不存在：{proj}')
        return 1
    files: list = []
    # 世界书（含记忆卡）+ 项目级规则卡 + 文风卡（批次2.5 P1）；有 md 才编，
    # 空目录（只有 README）零贡献不报错——README 本就不入图（见 build_graph）。
    for sub in ('世界书', '规则', '文风'):
        d = proj / sub
        if d.is_dir():
            files.extend((p.relative_to(proj).as_posix(), p) for p in d.rglob('*.md'))
    if not files:
        print(f'[ABORT] 项目无可编译语料（世界书/ 规则/ 文风/ 下无 md）：{proj}')
        return 1
    out = proj / 'kit' / 'hypergraph.rag.json'
    entries, relations = build_graph(files, 'pj', '')
    write_doc(out,
              f'项目档 HyperGraphRAG 编译产物（scope=project；源=projects/{project}/ 世界书、规则卡与文风卡，含记忆卡）。'
              f'改源后重跑 tools/kit-compile.py --project {project}；本产物绝不写全局 kit/。',
              entries, relations, {'scope': 'project'})
    print(f'projects/{project}/kit/hypergraph.rag.json ← {len(entries)} 词条 / {len(relations)} 边（scope=project；全局 kit/ 未动）')
    return 0


if __name__ == '__main__':
    sys.exit(main())
