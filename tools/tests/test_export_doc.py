# -*- coding: utf-8 -*-
"""export-doc · docx 导出器硬断言（M0：残渣/空产物/期望计数）"""
import tempfile
import unittest
from pathlib import Path

import util

BEAT_MD = """# 剧本试稿

## 第一集《开门红》

**B1｜开场钩｜3秒**
【0-3秒】深夜大排档，炉火轰起。
分镜：炉火特写推到主角的脸。
台词：老王：这一炉，赌的是命。
表演：主角抹汗，眼神不躲。
尾钩→炭火里爆出一颗火星。

**B2｜反差｜8秒**
分镜：执法车停下，车门打开。
台词：执法者：谁家的灶？
表演：围观者后退半步。
尾钩→主角把围裙一甩。
"""


class TestExportDoc(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="_ut-export-"))

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmp, ignore_errors=True)

    def export(self, src_text, *extra):
        src = self.tmp / "src.md"
        src.write_text(src_text, encoding="utf-8")
        out = self.tmp / "out.docx"
        rc, so, se = util.run_tool("tools/export-doc.py", str(src), str(out), *extra)
        return rc, so + se, out

    def test_plain_export_ok(self):
        rc, log, out = self.export("# 分析报告\n\n正文一段，没有任何拍级结构。")
        self.assertEqual(rc, 0, log)
        self.assertTrue(out.exists() and out.stat().st_size > 0, "docx 必须落盘且非空")

    def test_residue_rejected(self):
        rc, log, _ = self.export("# 分析报告\n\n正文。\ncat > .\n")
        self.assertEqual(rc, 1, "heredoc/shell 残渣必须拒绝导出")
        self.assertIn("残渣", log)

    def test_empty_rejected(self):
        rc, log, _ = self.export("   \n")
        self.assertEqual(rc, 1)
        self.assertIn("产物为空", log)

    def test_beat_mode_exports(self):
        rc, log, out = self.export(BEAT_MD)
        self.assertEqual(rc, 0, log)
        self.assertTrue(out.exists(), "拍级结构必须导出 docx")

    def test_expect_episodes_mismatch_rejected(self):
        rc, log, _ = self.export(BEAT_MD, "--expect-episodes", "2")
        self.assertEqual(rc, 1, "声明 2 集实际 1 集 = 硬断言不过")
        self.assertIn("断言", log)


if __name__ == "__main__":
    unittest.main()
