# -*- coding: utf-8 -*-
"""flow-verify · 产物脱流改动探测：三类红档 + 绿档 + flow@3 支持"""
import json
import sys
import unittest
from pathlib import Path

import util

HEADER = "---\nartifact: 1\nnode: n1\nround: 1\n---\n\n# 第一章\n\n正文干净。"


class TestFlowVerify(unittest.TestCase):
    def setUp(self):
        self.name = util.fresh_name("fv")
        self.fid = util.fresh_name("flow")
        self.proj = util.make_project(self.name, self.fid, done_nodes=["n1"])
        util.make_flow(self.fid, {"n1": "章节正文/第一章.md"})
        f = self.proj / "章节正文" / "第一章.md"
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(HEADER, encoding="utf-8")

    def tearDown(self):
        util.rm(self.name)
        util.rm(self.fid)

    def verify(self):
        return util.run_tool("tools/flow-verify.py", self.name)

    def snap(self):
        rc, _, err = util.run_tool("tools/snapshot.py", "capture", self.fid, self.name, "n1",
                                   "--files", "章节正文/第一章.md")
        self.assertEqual(rc, 0, f"夹具快照失败: {err}")

    def test_green_with_submit_and_snapshot(self):
        self.snap()
        util.add_submit_record(self.name, "章节正文/第一章.md")
        rc, out, _ = self.verify()
        self.assertEqual(rc, 0, out)
        self.assertIn("[绿]", out)

    def test_drift_after_snapshot_is_red(self):
        self.snap()
        util.add_submit_record(self.name, "章节正文/第一章.md")
        f = self.proj / "章节正文" / "第一章.md"
        f.write_text(HEADER + "\n\n偷偷改了一句。", encoding="utf-8")
        rc, out, _ = self.verify()
        self.assertEqual(rc, 1, "快照后又改未留档 = 交付阻塞")
        self.assertIn("快照后又被改", out)

    def test_never_snapshotted_is_red(self):
        util.add_submit_record(self.name, "章节正文/第一章.md")
        rc, out, _ = self.verify()
        self.assertEqual(rc, 1)
        self.assertIn("从未快照", out)

    def test_missing_file_is_red(self):
        (self.proj / "章节正文" / "第一章.md").unlink()
        rc, out, _ = self.verify()
        self.assertEqual(rc, 1)
        self.assertIn("产物文件不存在", out)

    def test_snapshot_without_submit_is_yellow(self):
        # 绕流新建：有快照但内核无提交记录——黄档（不阻塞，但必须显式可见）
        self.snap()
        rc, out, _ = self.verify()
        self.assertEqual(rc, 0, out)
        self.assertIn("[黄]", out)

    def test_flow3_effective_graph(self):
        # flow@3 项目：手画图不存在 → 读 effective@2 扁平 nodes
        flow_path = util.ROOT / "flows" / self.fid / "flow.json"
        flow_path.write_text(json.dumps({"id": self.fid, "format": "flow@3", "modules": []},
                                        ensure_ascii=False), encoding="utf-8")
        (self.proj / "registry").mkdir(parents=True, exist_ok=True)
        (self.proj / "registry" / "effective.json").write_text(json.dumps({
            "format": "effective@2", "flowId": self.fid,
            "nodes": {"n1": {"kind": "agent", "output": "章节正文/第一章.md"}}, "edges": [],
        }, ensure_ascii=False), encoding="utf-8")
        self.snap()
        util.add_submit_record(self.name, "章节正文/第一章.md")
        rc, out, _ = self.verify()
        self.assertEqual(rc, 0, out)
        self.assertIn("[绿]", out)

    def test_flow3_without_effective_aborts_cleanly(self):
        flow_path = util.ROOT / "flows" / self.fid / "flow.json"
        flow_path.write_text(json.dumps({"id": self.fid, "format": "flow@3", "modules": []},
                                        ensure_ascii=False), encoding="utf-8")
        rc, out, err = self.verify()
        self.assertEqual(rc, 1, "缺 effective.json 必须显式失败，不许静默绿")
        self.assertIn("effective.json", out + err)


if __name__ == "__main__":
    unittest.main()
