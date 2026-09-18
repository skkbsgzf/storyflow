# -*- coding: utf-8 -*-
"""check-purity · 纯净度扫描（AE-OUTPUT-PURITY）判定用例"""
import sys
import unittest
from pathlib import Path

import util

CLEAN = "---\nartifact: 1\nnode: n1\nround: 1\n---\n\n# 第一章\n\n武大郎把炊饼进了炉，芝麻香混着炭火气。"
DIRTY = CLEAN + "\n\n节点：m3.prose-assembler\n本节引用 kb/trope/hegemon-transmigrate 与 kb/craft/prose-constraints。"


class TestCheckPurity(unittest.TestCase):
    def setUp(self):
        self.name = util.fresh_name("purity")
        self.fid = util.fresh_name("flow")
        self.proj = util.make_project(self.name, self.fid)

    def tearDown(self):
        util.rm(self.name)
        util.rm(self.fid)

    def write(self, rel, text):
        p = self.proj / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")
        return p

    def test_clean_prose_passes(self):
        self.write("章节正文/第一章.md", CLEAN)
        rc, out, _ = util.run_tool("tools/check-purity.py", self.name)
        self.assertEqual(rc, 0, out)
        self.assertIn("0 处污染", out)

    def test_metadata_in_prose_fails(self):
        self.write("章节正文/第一章.md", DIRTY)
        rc, out, _ = util.run_tool("tools/check-purity.py", self.name)
        self.assertEqual(rc, 1, "正文里的执行元数据必须 exit 1")
        self.assertIn("第一章.md", out)

    def test_process_files_out_of_scope(self):
        # 小纲/大纲是过程件，合法承载流程词汇——同款污染内容在过程目录不算污染
        self.write("01-选题/选题报告.md", DIRTY)
        self.write("02-编剧/分场卡.md", "隔离声明：本稿仅使用本项目词汇\nroute=hot")
        rc, out, _ = util.run_tool("tools/check-purity.py", self.name)
        self.assertEqual(rc, 0, f"过程件不应被扫：{out}")


if __name__ == "__main__":
    unittest.main()
