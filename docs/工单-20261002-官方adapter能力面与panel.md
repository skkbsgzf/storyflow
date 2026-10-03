# 工单 · 官方 adapter 能力面与 panel 范本（2026-10-02）

> **状态**：批A ✅（84/84）｜批B ✅（panel/ 五组件 + index.html + /panel/* 静态托管 + 零依赖/别名守门）｜批C ✅（extension/ MV3 壳 + sync.mjs 复制打包 + 漂移守门）——storyharness **90/90**｜批D pinax 剥离：另立工单，未启动。

> 口径（用户拍板，2026-10-02 对话）：
> ① kit 必须有**官方 adapter + 官方 panel**：基础会话 UI 组件，形态对标 pi-web（agegr/pi-web，MIT）；
> ② 能力清单明确声明：**本地文件 / 世界书 / RAG / 创作改写**；
> ③ **主形态 = 零构建原生 ES module**（无框架、无打包器），且能**独立运行**（浏览器插件形态，直连本机 harness）；
> ④ 实际桥接层（产品私有映射）在更上方，**不属本仓**——pinax-harness 另做剥离，核心留在 kit 的 harness。
> 与《交接回执-前端切割与v4收拢-20261002》的关系：切割维持有效（v4 门面/生成页不回来）；**本工单是切割口径的修订**——kit 另起一个「契约定义的官方面」，`/api/panel/*` 的 410 对 `files/raw/preview` 三端点撤回（工作区未提交，直接改语义，不发破坏版）。

## 一 · 目标形态

```
kit 仓
├─ adapter/                    官方 adapter：能力声明总表 + storyflow-client.mjs（四能力全方法）
├─ panel/                      官方 panel 范本（零构建）
│  ├─ components/              ES module 组件：会话列表 / 对话流(turn SSE) / 输入框 /
│  │                           文件树·阅读 / 世界书·RAG 检索框
│  ├─ index.html               reference page（组件组装示范，连 8431/8421 即用）
│  ├─ extension/               浏览器插件壳（MV3 manifest + options 页，内联同一套组件）
│  └─ README.md                组件清单、接入两法（serve 托管 / 插件独立）、鉴权说明
└─ storyharness/src/serve.ts   +GET /panel/* 静态托管（白名单目录，零构建直接服务）
```

四能力 → 端点映射（写入 adapter/README，作为契约）：

| 能力 | 端点 | 现状 |
|---|---|---|
| 创作改写（会话） | `:8431 /api/projects/:id/agent/sessions[/turn SSE]` | 已有 |
| 本地文件 | `:8431 /api/panel/files`（树+读）· `/raw`（字节流）· `/preview`（判定元数据） | **批1 回归**（沿用 safe-project + 白名单 + 200KB/25MB 纪律，实现自 panels.ts 存档件对齐复刻） |
| 世界书 | 内核动词 `worldbook_search`（经 `/api/kernel-verb`） | **批1 补白名单**（现缺） |
| RAG | 内核动词 `kb_search` / `kb_read`（已在白名单） | 已有 |

## 二 · 批序与验收门禁

### 批A · 能力声明 + 文件端点回归（协议面）

1. `serve.ts`：重建 `/api/panel/files|raw|preview` 三端点（从 `D:\storyflow-extracts\deduce-engine` 同源的 panels.ts 存档对齐复刻；`safeProject`/`withinProject` 判定继续走 `safe-project.ts` 一把钥匙）；`worldbook|telemetry|changes|canvas` 维持 **410 GONE** 不复活。
2. `/api/kernel-verb` 白名单补 `worldbook_search`（组件检索用）。
3. `adapter/README.md`：能力声明总表（上表）+ 三同名辨析（adapter/ ≠ adapters/ ≠ pinax-adapter）。
4. `storyflow-client.mjs`：补 `sessions`、`turn(SSE)`、`files.list/read/rawUrl`、`worldbook.search`、`kb.search/read` 方法。
5. 门禁：`npm test` 全绿（含新文件端点测试：越界 403 / 白名单外 415 / 超限 413 / 退役面仍 410）；`tsc --noEmit` 0 错。

### 批B · panel 组件骨架（零构建）

1. `panel/components/*.js`：五个组件，原生 ES module、无依赖、无模板字面量外泄 XSS（统一 esc()）。
2. `panel/index.html`：组装示范页，开箱连 `http://127.0.0.1:8431`；口令场景走 `POST /api/login` 换 cookie 或 Bearer。
3. `serve.ts`：`GET /panel/*` 静态托管 `panel/` 目录（后缀白名单 + 目录越界拒绝，复用 core static.ts 的判定思想；no-store）。
4. 门禁：`page-lint` 思路的轻量检查（零依赖声明、esc 全覆盖）脚本化进批A的测试跑；组件在 Chrome/Edge 手工过一遍。

### 批C · 浏览器插件壳（独立运行形态）

1. `panel/extension/manifest.json`（MV3）：`host_permissions` = `http://127.0.0.1:8421/*`、`http://127.0.0.1:8431/*`；扩展页内联同一套 `panel/components`（构建脚本就是复制，无编译）。
2. `options` 页：harness 基址 + 口令配置（存 chrome.storage，Bearer 附带）。
3. 门禁：`chrome://extensions` 加载解包扩展，断网前端、只起 kit 两进程即可完整走通「建会话 → 改写 → 查文件 → 搜世界书」。

### 批D · pinax-harness 剥离（另立工单，挂在 pinax-storyharness 仓）

- 剥离原则：通用件（回合循环/重试/预算/transcript）**对 kit 实现重写对齐后删除**（pinax-adapter 是 NC 协议，不做代码搬移，保持 MIT 仓干净）；pinax 侧只留五 lookup 映射、流契约翻译、注入点。
- 验收：pinax-adapter 目录行数显著下降；kit 侧无任何 pinax import。

## 三 · 明确不做

- 不做工作台/画布/项目生成页（v4 形态，不回来）；`compat.ts` 与 legacy `/api/*` 冻结面不碰。
- panel 组件不引框架、不加构建器；`panel/` 不进 storyharness 测试覆盖面（组件纯静态，逻辑在 serve 侧测）。
- 桥接层（产品数据映射）不在 kit；`panel/` 只消费上面四能力契约。

## 四 · 现状备注

- 工作区处于「前端切割已做、未提交」状态；本工单批A 的「撤回 410」依赖未提交这一事实——**先落本工单再提交**，避免 410 进历史。
- 批A 动工前无需新决策；批B 组件拆分粒度、批C 是否进 Chrome 商店，动工时再对表。
