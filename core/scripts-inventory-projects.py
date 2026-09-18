import json, os, glob

for pd in sorted(glob.glob('D:/storymasterv4/projects/*/')):
    pid = os.path.basename(pd.rstrip('/\\'))
    sj = os.path.join(pd, 'state.json')
    rj = os.path.join(pd, 'run-state.json')
    src = sj if os.path.isfile(sj) else (rj if os.path.isfile(rj) else None)
    if not src:
        print(f'{pid:26s} (无 state)')
        continue
    s = json.load(open(src, encoding='utf-8'))
    nodes = s.get('nodes', {})
    done = sum(1 for n in nodes.values() if n.get('status') == 'done')
    awaiting = [nid for nid, n in nodes.items() if n.get('status') == 'awaiting']
    fmt = 'state' if src == sj else 'run-state轻量'
    fid = s.get('flowId', '(未标)')
    extra = f' awaiting@{awaiting[0]}' if awaiting else ''
    print(f'{pid:26s} flow={fid:18s} done {done}/{total if (total:=len(nodes)) else 0}{extra}  [{fmt}]')
