# 迁移链：flow@1 / 旧 run → flow@2 + R5（全工程一遍的固定顺序）

> 五步有依赖，**必须按序**执行；每步幂等，`--check` 先行、实跑在后，重跑无副作用。
> 适用对象：`flows/<id>/flow.json`（含用户自建流）与 `kits/`。旧项目的 `run-state.json → state.json`
> 由内核在首次 `flow_run`/`flow_resume` 时内建认领，不在此链内，**禁止手工转换在跑项目**。

## 顺序与职责

| 步 | 工具 | 做什么 | 幂等证明 |
| --- | --- | --- | --- |
| 1 | `python tools/kit-migrate.py` | skills/flows 反推合并进 `kits/<域>/kit.json`（新技能归家，op 断言/标尺入账） | 重跑输出一致；已有归属不覆盖 |
| 2 | `python tools/flow-kit-apply.py` | 节点 `skill(+kb)` → `kit`+`op` 文本级迁移（保排版） | 全部「无需改动」即收敛 |
| 3 | `python tools/flow-normalize.py`（可加 `--check`） | flow@1 → flow@2：`file/check/review/kb` → `output/asserts/kit.op`；边 `transform/optional/loop` → `role/when`；补 `status`；产物路径准入 | `--check` 全部「已是 flow@2」 |
| 4 | `python tools/r5-migrate.py`（可加 `--check`） | 删 legacy `gate_role:"验收门"`（R5 门由内核派生，不手画） | `已全部为 R5 形态（幂等）` |
| 5 | `python tools/kit-config-init.py`（`--check` / `--allow-generic`） | 为每个 op 注入 config 旋钮表；meta-tool（lint/迁移器自身）可 `--allow-generic` 吃通用四项 | `本轮写入 0 个 kit` 即收敛 |

## 收尾门禁（迁移后必跑）

```bash
python tools/flow-lint.py        # 0 errors（老字段=error，报错文案已附迁移命令）
python tools/kit-lint.py         # 0 errors（引用有效/漂移/孤儿/断言空转分级）
npx vitest run --root core       # 内核回归（当前 114 条）
node tools/page-lint.mjs         # 面板契约（改模板后必跑）
```

## 为什么必须迁移（不能只靠内核垫片）

内核为兼容留了三处垫片：`nodeOutput = output ?? file`、`nodeAsserts = asserts ∪ check ∪ review`、
`edgeRole = role ?? loop ?? optional`。**能跑 ≠ 等价**：`domainMap`/边界派生直接读 `node.kit`，不走
skill 兼容——未迁移的 flow 全节点被判「透明」，kit 边界验收门派生为 **0 个**，「人工只在 kit 边界」
静默失效（实测：同一份 flow 迁移前 `boundaries = []`，迁移后 4 个）。静态层是硬门：`flow-lint` 对
老字段与缺 `status` 直接判 error，未迁移的 flow 进不了 `flows/`。

## 旧 run 兼容口径（R5）

存量 run 首次接触 R5 **只认领 `overlayHash` 指纹，不重编译**——旧计划保持原样继续跑；
`state.overlayHash` 与生效编排不符时才 `replan`（受影响下游置 `pending` + `stale`）。

## 记账

- 2026-09-17：存量 7 条 flow 已全部迁至 flow@2 + R5 形态；`kits/` 四域 59 ops（表覆盖 55 +
  4 个 meta-tool 走 `--allow-generic` 通用四项）。
