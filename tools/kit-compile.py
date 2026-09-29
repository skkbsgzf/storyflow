#!/usr/bin/env python3
"""kit-compile · 把 knowledge/**/*.md 语料编译为 HyperGraphRAG 图文件（kit/hypergraph.rag.json）。

目标（v0.8 目标4）：GitHub 上 knowledge 层只发布**一个向量图文件**（词条 + 关系边 + 统计），
松散 md 是**本地可插拔层**（引擎现读盘；不进 git）。用户改/增 md 后重跑本脚本重建图。

图形态与内核 worldbook/graph.json 同族（worldbook-graph@1）：
  entries  {id, title, domain, path, tags}
  relations {from, to, kind, weight}   kind ∈ link(声明边) | mention(正文互涉)
用法：python tools/kit-compile.py [--root .]
"""
import json, re, sys
from pathlib import Path

ROOT = Path(sys.argv[sys.argv.index('--root') + 1] if '--root' in sys.argv else '.')
SRC = ROOT / 'knowledge'
OUT = ROOT / 'kit' / 'hypergraph.rag.json'

FM = re.compile(r'\A---\s*\n(.*?)\n---\s*\n?', re.S)


def front(text: str) -> dict:
    m = FM.match(text)
    out = {}
    if m:
        for line in m.group(1).splitlines():
            mm = re.match(r'^([A-Za-z_][\w-]*):\s*(.*)$', line)
            if mm:
                out[mm.group(1)] = mm.group(2).strip()
    return out


def main() -> int:
    entries, by_title = [], {}
    texts = {}
    for p in sorted(SRC.rglob('*.md')):
        if p.name.upper() == 'README.MD':
            continue
        rel = p.relative_to(SRC).as_posix()
        domain = rel.split('/')[0]
        text = p.read_text(encoding='utf-8')
        texts[rel] = text
        fm = front(text)
        eid = fm.get('id') or ('kb/' + rel.removesuffix('.md'))
        title = fm.get('title') or (text.lstrip('# \n').splitlines()[0][:60] if text.strip() else rel)
        tags = re.findall(r'"?([\w\-组成]+)"?', fm.get('tags', '')) if fm.get('tags') else []
        entries.append({'id': eid, 'title': title, 'domain': domain, 'path': f'knowledge/{rel}', 'tags': tags[:8]})
        by_title[title] = eid

    relations, seen = [], set()
    for e in entries:
        text = texts.get(e['path'].removeprefix('knowledge/'), '')
        for other in entries:
            if other['id'] == e['id'] or not other['title']:
                continue
            if other['title'] in text:
                key = tuple(sorted((e['id'], other['id'])))
                if key not in seen:
                    seen.add(key)
                    relations.append({'from': e['id'], 'to': other['id'], 'kind': 'mention', 'weight': 1})

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        'format': 'storyflow-hypergraph@1',
        'note': 'knowledge 语料的 HyperGraphRAG 编译产物（词条+关系边）。源 md 是本地可插拔层，不进 git；改 md 后重跑 tools/kit-compile.py。',
        'stats': {'entries': len(entries), 'relations': len(relations), 'domains': sorted({e["domain"] for e in entries})},
        'entries': entries,
        'relations': relations,
    }, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'kit/hypergraph.rag.json ← {len(entries)} 词条 / {len(relations)} 边')
    return 0


if __name__ == '__main__':
    sys.exit(main())
