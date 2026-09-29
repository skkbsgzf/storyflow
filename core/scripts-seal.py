"""为产物文件注入 artifact@1 头部（实验批辅助工具）。
用法: python scripts-seal.py <file> <node> <id> <class> <by> [--up 路径]... [--round N] [--state draft]
头部字段按 contracts/artifact-header.schema.json；upstream 自动算 sha1 前 12 位。
"""
import hashlib, sys, io, os, datetime

def sha12(p):
    with open(p, 'rb') as f:
        return hashlib.sha1(f.read()).hexdigest()[:12]

def main():
    a = sys.argv[1:]
    if len(a) < 5:
        print(__doc__); sys.exit(2)
    fp, node, aid, cls, by = a[0], a[1], a[2], a[3], a[4]
    ups, rnd, st = [], 1, 'draft'
    i = 5
    while i < len(a):
        if a[i] == '--up':
            ups.append(a[i+1]); i += 2
        elif a[i] == '--round':
            rnd = int(a[i+1]); i += 2
        elif a[i] == '--state':
            st = a[i+1]; i += 2
        else:
            i += 1
    text = io.open(fp, encoding='utf-8').read()
    if text.startswith('---'):
        print('已有头部，跳过'); return
    # 剥掉原正文首行标题前的内容（保留全部正文），正文规则由校验器管
    at = datetime.datetime.now().strftime('%Y-%m-%d %H:%M')
    lines = [f'artifact: {1}', f'id: {aid}', f'class: {cls}', f'node: {node}',
             f'round: {rnd}', f'version: v{rnd}', f'state: {st}', f'at: {at}', f'by: {by}']
    if ups:
        lines.append('upstream:')
        for u in ups:
            lines.append(f'  - {u}@{sha12(u)}')
    header = '---\n' + '\n'.join(lines) + '\n---\n\n'
    io.open(fp, 'w', encoding='utf-8', newline='\n').write(header + text)
    print('sealed:', fp, '| upstream:', [f'{u}@{sha12(u)}' for u in ups])

main()
