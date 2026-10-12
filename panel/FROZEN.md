# TOMBSTONE · panel/ 已退役（2026-10-13）

本目录现在只剩这份通告。**`panel/` 前端范本（902 件 tracked）与 `storyharness/desktop/`（5 件）、`storyharness/cali/`（1 件）已于 2026-10-13 整体出仓**，依据是 W4.4 湮灭批次2 第二刀，用户裁定原话「panel可删，这几个都删」。

## 退役的是什么

| 标的 | 件数 | 身份 |
| --- | --- | --- |
| `panel/`（app/components/lib/demo/hooks/public/e2e/bin/docs + 配置与 README 系） | 902 | pi-web fork 的**零构建前端范本**，2026-10-10 起冻结、零新投入；批次4 之后被仓内静态看板取代 |
| `panel/kitapp/`（Next.js fork） | 283 tracked + 40499 未跟踪 | 早在 `7c86cba4` 出仓；磁盘残留 1542 MB 于 2026-10-13 第一刀清尽 |
| `storyharness/desktop/`（electron 截图壳 main/shot/shots.cjs + package*） | 5 | panel 冻结连带候选 |
| `storyharness/cali/`（`calibrate.mjs`） | 1 | laya 冻结连带，仓内无消费者 |

## 没退役的：`/api/panel/*` 三读一写

**API 面一个字没删**，只是名字里的 `panel` 是历史遗留。它现在是项目看板的**通道 B**（见 `docs/工单-20261012-批次4-…md` W4.2、`adapter/README.md`）：

- `GET /api/panel/files?project=<id>[&file=<rel>]` — 两层树 / 单文件读取，回服务端 sha256
- `PUT /api/panel/files?project=<id>&file=<rel>` — 写端点（临时件 → 回读校验 → 原子替换；乐观锁 `expectHash`）
- `GET /api/panel/raw` / `GET /api/panel/preview` — 字节流与预览判定

实现在 `storyharness/src/panel-files.ts`，路由在 `storyharness/src/serve.ts`，测试 `storyharness/test/panel-files.test.ts` 照旧全绿。

删掉的是 `serve.ts` 里那段 **`/panel` 静态文件托管**（42 行，含 `/panel/client.mjs` → `adapter/storyflow-client.mjs` 的别名）。`storyharness/src/web.ts` 的自动开门目标也随之从 `/panel/` 改回协议面落地页。

## 界面现在在哪

项目看板 = **静态 HTML**，一命令出自包含单文件：

```
python tools/dashboard.py --project <id>     # 出 dashboard.html，双击即开
```

七区（知识总览 / 世界书 / 大事记 / 执行流水 / RAG 图谱 / 多维表格 / 产物文件），读写三通道见 W4.2。

## 想取回历史

```
git log --diff-filter=D --stat -- panel storyharness/desktop storyharness/cali
git ls-tree -r <上面那笔 commit>^ -- panel | wc -l     # 应为 902
git show <commit>^:panel/LICENSE                        # fork 的 MIT 授权文本随本体出仓，历史里可取
```

三条如实记录，供后人不必重新踩：

1. **`D:\storyflow-extracts` 里没有 panel 工程本体**——那目录只有 `kit-frontend-precut/`（300K，两个 HTML 模板）与 `panel-lite-batchBC/`（100K）。此前 ROADMAP 4.0 表「有存档」那句对 kitapp/panel 源码不成立，已在 `docs/ROADMAP.md` 就地加注。
2. **「`/panel/client.mjs` 与 `adapter/storyflow-client.mjs` byte-equal 有测试钉住」这句是假的**——原写在 `serve.ts` 注释里，仓内 `*.test.ts` 全量 grep 找不到任何钉这对比的用例。既然没有，摘掉托管块不破任何测试。
3. **没有测试打 `/panel` 静态路由**，`panel-files.test.ts` 覆盖的全是 `/api/panel/*`，所以本刀不需要改造任何测试断言。
