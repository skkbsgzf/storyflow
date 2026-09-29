#!/usr/bin/env python3
"""kit-skills · 把 skills/*.md 技能卡编译为 tool 注册表（kit/skills.tools.json）。

目标（v0.8 目标3）：内置 Skill 一律以 **Tool 形态**被 agent 运行时加载——
名称即功能（`skill.<slug>`）、带版本号、带使用约束（trigger/inputs/outputs）。
用户自己导入加载的 skill 不进本表（另册）。

用法：python tools/kit-skills.py [--root .]
输出：kit/skills.tools.json
"""
import json, re, sys
from pathlib import Path

ROOT = Path(sys.argv[sys.argv.index('--root') + 1] if '--root' in sys.argv else '.')
SRC = ROOT / 'skills'
OUT = ROOT / 'kit' / 'skills.tools.json'

FM = re.compile(r'\A---\s*\n(.*?)\n---\s*\n?', re.S)


def field(fm: str, key: str) -> str:
    m = re.search(rf'^{key}:\s*(.+)$', fm, re.M)
    return m.group(1).strip().strip('"') if m else ''


def main() -> int:
    tools = []
    for p in sorted(SRC.glob('*.md')):
        if p.name.upper() == 'README.MD':
            continue
        text = p.read_text(encoding='utf-8')
        m = FM.match(text)
        fm = m.group(1) if m else ''
        slug = p.stem
        name = field(fm, 'name') or slug
        desc = field(fm, 'description')
        tools.append({
            'tool': f'skill.{slug}',
            'version': 1,
            'title': name,
            'summary': desc,
            'constraints': {
                'stage': field(fm, 'stage') or None,
                'trigger': field(fm, 'trigger') or None,
                'inputs': field(fm, 'inputs') or None,
                'outputs': field(fm, 'outputs') or None,
            },
            'source': f'skills/{p.name}',
        })
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        'format': 'storyflow-skill-tools@1',
        'note': '内置技能的 Tool 注册表：名称即功能、版本号、使用约束。用户自导 skill 另册（不进本表）。',
        'count': len(tools),
        'tools': tools,
    }, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'kit/skills.tools.json ← {len(tools)} tools')
    return 0


if __name__ == '__main__':
    sys.exit(main())
