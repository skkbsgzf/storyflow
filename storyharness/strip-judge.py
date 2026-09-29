# 一次性手术脚本：从 storyharness executor/config/chat/cli/brief/scheduler/home 摘除判官层
import io, re, subprocess, os
os.chdir(r'D:\storyflow-kit\storyharness')

def edit(path, pairs, must=True):
    p = path
    s = io.open(p, encoding='utf-8').read()
    for old, new in pairs:
        if old not in s:
            if must:
                raise SystemExit(f'ANCHOR MISS in {path}: {old[:70]!r}')
            continue
        s = s.replace(old, new, 1)
    io.open(p, 'w', encoding='utf-8', newline='').write(s)
    print('edited', path)

# ---------- executor.ts ----------
p = 'src/executor.ts'
s = io.open(p, encoding='utf-8').read()
s = s.replace('import { runLayaJudge, type JudgeEvidence } from "./judge.js";\n', '')
s = s.replace('  /** 判官证据（cfg.judge.enabled 且 .md 产物过闸后才有） */\n  judge?: JudgeEvidence;\n', '')
# readLastJudgeFeedback 函数整体（从注释头到下一个顶级注释头）
i = s.find('/** D-B1 · 读最近一个')
j = s.find('/** 执行一个已派发的任务包')
assert i > 0 and j > i, (i, j)
s = s[:i] + s[j:]
# 两段回喂块：从注释行起到第二个「判官回喂」console 行的行尾
i = s.find('  // 未过闸期 flagged=噪声')
marker = '条件注入写前提示`);'
assert i > 0
k = s.find(marker, i)
end = s.find('\n', k) + 1
s = s[:i] + s[end:]
# 证据运行块
i = s.find('  // 不当闸、不触发打回（P 值纪律）；学生未过闸前默认关闭（cfg.judge.enabled）。')
assert i > 0
k = s.find('未跑（${judge.error}）`});', i)
end = s.find('\n', k) + 1
s = s[:i] + s[end:]
s = s.replace('    judge: judge ? { ran: judge.ran, flagged: judge.flagged, error: judge.error } : undefined,\n', '')
s = s.replace('return { node, file, ok: !rejected, judge, meta:', 'return { node, file, ok: !rejected, meta:')
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('executor done')
EOF_MARKER_NOT_USED = None
