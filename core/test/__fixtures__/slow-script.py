#!/usr/bin/env python
"""确定性夹具：故意慢的 script 壳（供 timeoutMs 回归用）。

内核以 `python <此文件> <src> <out> --title ... --node ... --flow ...` 调用。
本夹具不产出任何文件，只睡眠——用来证明「到时内核真的终止子进程并显式报错」，
而不是静静地一直挂住（OS-02 阶段 D · D#14 的回归面）。

睡眠时长取 argv 里的 `--sleep <秒>`（默认 8 秒），便于按需缩短。
"""
import sys
import time

sleep_s = 8.0
argv = sys.argv[1:]
if "--sleep" in argv:
    sleep_s = float(argv[argv.index("--sleep") + 1])

time.sleep(sleep_s)
print("{}")  # 内核按 stdout JSON 约定解析；正常路径下本行永远到不了（会被超时杀掉）
