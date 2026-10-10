# 路线图 · 三批次（2026-10-10 定盘）

> 配套规格：[`ARCHITECTURE.md`](ARCHITECTURE.md) §3 四相能力模型；细化拆解见 [`规划-四相能力落地-需求细化与排期-20261010.md`](规划-四相能力落地-需求细化与排期-20261010.md)。
> 排期原则（2026-10-10 用户决议）：**批次1 框架清理做干净 → 批次2 架构重建；图文视频能力与本地快诊断场景薄弱、底子不厚，整体压到批次3，架构重建后再慢慢排期。**

---

## 一、三批次总览

```
批次1 框架清理（✅ 2026-10-10 已完成）
    ↓
批次2 架构重建
    ├─ R2.1 契约先行：rule.schema.json（diagnosis-report 随三相前置）
    ├─ R2.2 项目文件体系（需求1：索引→增量→记忆→项目级 RAG）∥ R2.3 输出面收拢（需求3）
    └─ R2.4 写诊改三相打通 + 能力归并（需求4 主体）
    ↓
批次3 缓做（架构重建后慢慢排期）
    ├─ 本地快诊断服务化（需求2：S 级 + laya 环境回填 + 静默追写 + agent tool）
    ├─ 图文视频能力（seedance 族，声明已摘除留档）
    └─ 拆 · 逆向（需求4 收尾：deconstruct.schema + 采样/归因/回流）
```

## 二、批次1 · 框架清理（已完成 2026-10-10）

| 项 | 结果 | commit |
| --- | --- | --- |
| 索引净化 | node_modules 18,332 / 回执 9 / pycache 2 出库，tracked 20,050 → 1,707；.gitignore 增补 | `0aa1bf5c` |
| lint 归零 | base 三死声明（前端切割遗留）+ drama seedance 摘除；module-lint 5 err → 0 err；一次性探针/手术件出库 | `1e695318` |
| 文档重组 | 25 项过程文档归档 `docs/_archive/`；ARCHITECTURE / contracts / ROADMAP 三入口落地；全库路径式引用改写 | 本 commit |
| 测试收编 | storyharness/test 三件未跟踪测试入库 | 本批次 |

验收：三 lint 0 error、门禁双绿、core 433/434（1 环境例）+ storyharness 148/148 不回归、索引无垃圾。

## 三、批次2 · 架构重建

### R2.1 契约先行（1–1.5 周）

| 交付物 | 说明 |
| --- | --- |
| `contracts/rule.schema.json` | `rule_id / tier(S\|A\|B) / scope / 检测目标 / 判定逻辑 / 证据字段 / 严重度 / 修复策略 / provenance.refs` |
| 三 lint 增规则卡校验 | 卡面 ↔ 扫描器 qid 对账起步 |

### R2.2 项目文件体系（2–3 周，需求1）

| 交付物 | 说明 |
| --- | --- |
| `project-index.schema.json` + 索引生成器 | 路径探索 → `project-index.json`；角色标注（人写/生成）首问一次；项目根 v1 收纳 `projects/<id>/`（双根铁律） |
| 增量更新 | 生成物 vs 手写物区分标记；手改后索引正确失效 |
| 记忆本地化 | 会话 JSONL → 人机双读项目记忆卡 |
| 项目级 RAG | 项目内容 → 项目级 rag 包，与全局 `kit/` 严格隔离 |

验收：真实项目跑通 init→index→增量→RAG；全局 KB 零混入。

### R2.3 输出面收拢（1–2 周，需求3，可与 R2.2 并行）

| 交付物 | 说明 |
| --- | --- |
| 立场入规格 | kit 三输出（文档/自包含 HTML/数据包）；HTML 只读、零依赖、不回 call kit |
| 页面件补齐 | 时间轴大事记整页、诊断报告页（依赖 R2.4 契约） |
| panel/kitapp 冻结执行 | 存量保留、零新投入 |
| 宿主接入文档 | pinax-bridge 经验提炼进 `docs/integration/` |

### R2.4 三相打通 + 能力归并（2–3 周，需求4）

| 交付物 | 说明 |
| --- | --- |
| `diagnosis-report.schema.json` | `evidence[]`（程序判定）与 `opinion{}`（模型观点）硬分离 |
| 一源两视图收敛 | rules 17 卡 ↔ 扫描器 13 qid 对账：卡引用 qid、扫描器按卡执行 |
| 卡驱动诊断动词 | `mf_analyze_curve` 型一次性工具泛化为 `diag(dimension)` |
| 三相一致性测试 | 同卡诊/建/改结构上不可能矛盾；修改可回滚 |

## 四、批次3 · 缓做（架构重建后慢慢排期）

| 项 | 前置 | 说明 |
| --- | --- | --- |
| 本地快诊断服务化 | rule + diagnosis-report 契约；**laya 环境回填**（本机 `runs/` 权重与 `tools/_vendor/laya-venv` 缺位） | S 级确定性 <100ms；A 级 laya 学生头；静默追写默认保守（只标高置信 1–2 条）；绝不让大模型进静默链路 |
| 图文视频能力 | 声明式口径（规则进 KB，工具是执行器） | seedance 族按需求4 归并口径重建 |
| 拆 · 逆向 | rule 契约 | `deconstruct.schema.json` + 采样/归因/规则卡沉淀/复用回路 |

## 五、每期通用纪律

1. **契约先行** —— 无 schema 不写实现
2. **测试不回归** —— core 433/434（r8-os02cd 环境例除外）+ storyharness 148/148 是每期底线
3. **报数必附收据** —— 无收据 = 删声明
4. **提交可 revert** —— 每期独立提交
5. **CI 绿才算完成** —— tsc 0 错 + 全量测试 + 三 lint 0 error
