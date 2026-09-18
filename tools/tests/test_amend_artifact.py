# -*- coding: utf-8 -*-
"""amend-artifact · 五步降级单命令：拒绝路径 + happy path 集成（铁律 10）"""
import json
import unittest

import util

CLEAN = "---\nartifact: 1\nnode: n1\nround: 1\n---\n\n# 第一章\n\n正文干净，炭火气。"


class TestAmendArtifact(unittest.TestCase):
    def setUp(self):
        self.name = util.fresh_name("amend")
        self.fid = util.fresh_name("flow")
        self.proj = util.make_project(self.name, self.fid, done_nodes=["n1"])
        util.make_flow(self.fid, {"n1": "章节正文/第一章.md"})
        f = self.proj / "章节正文" / "第一章.md"
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(CLEAN, encoding="utf-8")

    def tearDown(self):
        util.rm(self.name)
        util.rm(self.fid)

    def amend(self, *extra):
        return util.run_tool("tools/amend-artifact.py", "--project", self.name,
                             "--node", "n1", "--file", "章节正文/第一章.md", *extra)

    def test_missing_reason_rejected(self):
        rc, _, err = self.amend()
        self.assertNotEqual(rc, 0, "无 --reason 必须拒绝（argparse 必填）")

    def test_blank_reason_rejected(self):
        rc, _, err = self.amend("--reason", "   ")
        self.assertNotEqual(rc, 0, "空理由必须拒绝——绕流必须先声明意图")
        self.assertIn("不能为空", err)

    def test_undone_node_redirects_to_submit(self):
        st = self.proj / "state.json"
        d = json.loads(st.read_text(encoding="utf-8"))
        d["nodes"] = {}
        st.write_text(json.dumps(d, ensure_ascii=False), encoding="utf-8")
        rc, _, err = self.amend("--reason", "改一个错字")
        self.assertNotEqual(rc, 0)
        self.assertIn("flow_submit", err)

    def test_five_steps_happy_path(self):
        util.add_submit_record(self.name, "章节正文/第一章.md")
        rc, out, err = self.amend("--reason", "修订：删一处错别字（绕流重派发内核暂不支持）")
        self.assertEqual(rc, 0, out + err)
        # ① journal 意图声明
        journal = (self.proj / "journal.jsonl").read_text(encoding="utf-8")
        self.assertIn("绕流意图声明", journal)
        # ② 收据落盘
        receipts = list((self.proj / "内部" / "收据").glob("修订校验-*.md"))
        self.assertEqual(len(receipts), 1, f"收据必须落盘: {out}")
        # ③ 对照表登记
        ledger = (self.proj / "内部" / "依据" / "修订对照表.md").read_text(encoding="utf-8")
        self.assertIn("删一处错别字", ledger)
        # ④ 快照重拍
        idx = json.loads((self.proj / "snapshots" / "index.json").read_text(encoding="utf-8"))
        self.assertIn("n1", idx.get("snapshots", {}), "快照必须重拍")
        # ⑤ 复检通过
        self.assertIn("五步全部通过", out)


if __name__ == "__main__":
    unittest.main()
