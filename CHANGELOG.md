# Changelog · miniflow harness

版本唯一事实源：仓库根 `VERSION`。格式参考 Keep a Changelog；R1..R8 历史代际摘要附于 4.0.0 条目。

## [4.0.0] · 2026-09-21 · 协议基线（宣告文档：`docs/版本宣告-v4.0.0.md`）

### Added
- 全局版本治理首次落地：根 `VERSION` + 本 `CHANGELOG.md` + git tag 三件套；此前唯一版本指纹是 dist 目录名 `release-<sha>-dirty-<date>`。
- decision@1 / catalog-entry@1（R8-S1..S4b，候选库与选择面）随基线入库为核心面。

### Changed
- **协议基线固定**：flow@3 为唯一 flow 格式；module@1 接替 kit@1；flow@1/@2 与 `kits/` 转只读遗产（改动先迁移，工单批A..D 见宣告文档 §五）。
- 文档口径修复：AGENTS.md（铁律11 / R4 工具链 / R5 残留段）、flows/README、contracts/README、contracts/flow-pack.schema.json、docs/底座规格 中滞后的 flow@1 / kit@1 表述就地更新。

### Removed
- worktree `storymasterv4-d1d5` 与杂支 `metrics-caliber-d1d5`（was `be6ade4`；内容已重放 `4f3029b`，另存内容级快照）。

### Fixed
- be6ade4 快照树闭包：自 d1d5 索引重建 274 棵树（根树逐字节吻合）＋补回 2 个 blob；`git fsck` 缺失 10 → 4（残余属永久丢失提交的闭包，不可恢复）。复盘增量见 `docs/事故-2026-09-18-git目录误删与恢复.md` §七。

### 运维
- 备份三件套落盘 `D:/storymasterv4-rescue-20260921/`；git bundle 形态在本仓断链修复前不可用（walk 必踩 `f424b33 → d3bf007` 断点）。
- 加远端仍为第一优先待办：断链未愈 ＋ 无远端 = 再出事故仍然丢历史。

### 历史代际摘要（R1..R8 → 4.0.0）
R1 kit化 · R2 外部对照＋绕流事故复盘 · R3 kit底座落地 · R4 项目文件与流程配置 · R5 生成式flow与运行时编排 · R6 模块化flow（flow@3/module@1） · R7 开源部署与可调面 · R8 候选库与选择面。逐代规范见 `docs/规范-*.md`。
