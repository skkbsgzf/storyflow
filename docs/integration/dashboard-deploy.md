# 看板分发 · Cloudflare Pages + Access（W4.3）

一句话：**看板是一个自包含的 HTML 文件**，静态托管到 Cloudflare Pages 就能在任何设备打开你的项目全貌；配 Cloudflare Access 之后，只有你邮箱收验证码的人看得见。代价是它是**只读**的形态——想改盘上的产物，走改稿套件或自开 8431 隧道（§6）。

> **看板 v3（2026-10-13 整体替换）**：模板换为六图标五面板＋配置抽屉（世界书 / 人物 / 大纲 / 大事记 / 文档阅读 / 配置），`meta.layout_version="3"`；payload 键面 `worldbook{entries,relations}` + `artifacts[]` + `chronicle{events,lanes}` + `config{models,logs,snapshots}`——v2 的知识表格 / 执行流水 / RAG 图谱三区数据**不再入 payload**（`cards` 连正文内嵌是旧体积大头）。文档阅读**只读**（File System Access 只读授权），v2 的编辑三通道不入板；`/api/panel/files` 的 PUT 端点保留为 API 原语、无看板入口。`config.models` 只收 provider/model 类非敏感字段（`.external/storyharness.json` 的 apiKey 一律不入 payload，`--selfcheck` 有全文断言）。实测 p-menghe-01：payload 减重 632KB → **170KB**（≤500KB 预算），幂等双跑 sha256 一致（`f3901e04…`）。

本页文档的实测数字来自 2026-10-12 的真实出板与真浏览器校验（p-menghe-01），收据 `projects/_reports/w43-static-dist-verify-20261012.json`。凡是要用你自己 Cloudflare 账号才能确认的部分，我在 §4 和 §7 明确标了「未在测试账号实走」，不当已验证的结论讲。

---

## 1. 出板：一条命令，产物就是一个目录

```bash
cd D:/storyflow-kit
python tools/dashboard.py --project p-menghe-01 --root . --kit-root . --out dist/index.html
```

为什么文件名要叫 `index.html`：Pages 把根路径 `/` 直接指向 `index.html`，叫 `dashboard.html` 就得多一次重定向、手机上还要输长 URL。

- `--root` 是数据根，`--kit-root` 是全局语料根（双根不合一，外部平铺项目根同 `kit-compile` 口径）。
- 产物目录里**只有这一件文件**——没有 `assets/`、没有 sidecar、不请求任何外部资源（实测独立正则扫 `src`/`href`/`url()`/`@import`：0 命中；`dashboard.py` 自己也有这条红线断言，命中直接 `[FAIL]` 退出码 1）。
- 换输出路径不改内容：`dist/index.html` 与默认出板 `projects/<id>/dashboard.html` 逐字节一致，sha256 `5bd17ff21d22429c…`（632 KB）。同一输入连跑两次也逐字节一致——页面不携带生成时刻。
- 单文件体积远在配额内：Cloudflare Pages Free 计划每次部署最多 20,000 个文件、单文件 ≤25 MiB。

---

## 2. 上传前必看（三条，一条都别跳）

1. **先配 Access，再上传。** Pages 的 URL 是 `<项目名>.pages.dev`，可猜、可被搜索引擎爬。先传后配等于开了一段公开窗口，而且传上去的内容已经被 CDN 缓存过一轮。
2. **看出板命令的「分发前自检」那一行。** 它会点名页面里残留几处本机绝对路径。工具自己写的字段现在全部是相对形态（`meta.project_dir`＝`projects/p-menghe-01`，`meta.root`/`meta.kit_root` 只留目录名，数据源健康表 `detail` 同理）；剩下的命中来自**项目配置与知识卡原文**里作者自己写下的路径，工具不替作者改写。本次 p-menghe-01 是 3 处（两条模型缓存路径、一条影子副本自述路径）。要不要在上传前抹掉由你决定，代价是访问者能看出你机器上的目录结构。
3. **页面里就是作品本身。** 七区带正文首段摘要、大事记叙述、世界书词条、产物清单——公开这个 URL 等于公开你的书。Access 是唯一的门，别用「URL 没人知道」当访问控制。

---

## 3. 上传：控制台直传，或 wrangler

**A. 控制台 Direct Upload（不用命令行）**

1. Cloudflare dashboard → **Workers & Pages** → **Create application** → **Pages** → **Direct Upload**
2. 项目名随便取（就是 `<项目名>.pages.dev`），点 **Upload assets**
3. 把 `dist/` 目录整个拖进去（不是那个 HTML 文件——目录结构才是站点根），**Save and Deploy**

**B. wrangler（适合脚本化，改稿后一条命令重传）**

```bash
npx wrangler pages project create <项目名> --production-branch main   # 首次
npx wrangler pages deploy dist --project-name <项目名>                # 每次更新
```

命令以你本地 `npx wrangler pages --help` 的实际输出为准——我这边没装 wrangler，也没 CF 凭据，所以这两行没在我这儿跑过，属于文档受限项。

---

## 4. Access 保护（邮箱验证码，50 人以内免费）

Cloudflare Zero Trust 的 Access 免费额度是 50 个用户，本项目自用足够。思路是：给这个域名建一个 Access 应用，登录方式选 One-time PIN（不需要接 IdP），policy 只 Allow 你自己的邮箱。

1. **Zero Trust 控制台**（one.dash.cloudflare.com）→ 选中你的 Team 域名
2. **Access → Applications → Add application → Self-hosted**
   - 名称：`storyflow-dashboard`
   - 域名：填 `<项目名>.pages.dev`，或你自己的自定义域名（更稳）。注意 self-hosted 应用要求域名属于账号里的活跃 zone；若下拉里选不到 `pages.dev`，先在 Zero Trust 的 **Custom hostnames / Zones** 里把它加进来，或者给 Pages 项目挂一个已托管在 CF 的自定义域名。
   - **Configure → Login method → One-time PIN**
3. **Access → Policies → Create a policy**
   - Access rule：`Allow` + `Emails` + 你的邮箱（可加多个）
   - Action：`Require`
   - Session Duration：按使用习惯，30 分钟起；手机偶尔看就设长一点（如 12 小时）
4. 把 policy 关联到第 2 步的应用。未登录访问会 302 到 Cloudflare 的登录页，**拿不到任何项目数据**。

※ 本节按 Cloudflare 官方文档写，**没有在我的测试账号实走过一遍**（本机没有凭据）。第一次走请对着 §7 逐项打勾；如果控制台措辞变了，就在本文档对应步骤后面补一行实际名称，别让它烂在聊天里。

---

## 5. 更新：改稿之后重出一版

1. 数据变了就先重跑 §1 的出板命令（同一 `--out dist/index.html`）。
2. 重新部署：控制台再拖一次 `dist/`，或 `npx wrangler pages deploy dist --project-name <项目名>`。每次部署都有独立的 Deployment 版本，Pages 的项目页可以一键 **Rollback**，出问题能退回上一版。
3. 手机上还是旧内容？两层缓存：Pages 边缘缓存 + 手机浏览器。硬刷（下拉不一定够），或者干脆在 URL 后面加 `?v=20261012` 绕开。

---

## 6. 任意设备的两种形态（关键取舍）

| 形态 | 能做什么 | 前置条件 |
| --- | --- | --- |
| **纯静态**（Pages + Access） | 看五面板（世界书/人物/大纲/大事记）、配置抽屉（模型只读 / 日志 / 历史快照预览＋补丁复制）、文档阅读（File System Access **只读**授权后按类型渲染）；恢复快照＝页内生成补丁文本复制，落盘由调用方执行 | 无（就是 §1–§4） |
| **在线写**（通道 B，8431） | 看板 v3 已无写入口；要在任意设备写盘，用你自己的客户端直调 `PUT /api/panel/files`（端点现役，纪律见 `adapter/README.md`） | 你自己把 8431 暴露出去（如 cloudflared 隧道），口令必设，并把客户端源放行（见下） |

在线写那条线的硬要求，照抄即可：

```bash
# 终端 1：把本地 8431 挂到隧道（临时隧道 URL 每次会变，正式用建议命名隧道）
cloudflared tunnel --url http://127.0.0.1:8431

# 终端 2：起 serve，口令 + 放行 Pages 源
cd D:/storyflow-kit/storyharness
SH_PASSWORD=<你的口令> SH_ALLOWED_ORIGINS=https://<项目名>.pages.dev \
  npx tsx src/cli.ts serve --hostname 0.0.0.0 --port 8431 --project p-menghe-01
```

- 口令也可以写进 `.external/storyharness.json` 的 `serve.password`，放行源写 `serve.allowedOrigins`（数组），优先级是 env > 运行配置 > 已生成的 credentials 文件。
- **没设口令时非 loopback 绑定是 fail-closed**：serve 自己会生成强口令写进 `.external/credentials.json`（B1 行为）。别把「我不知道口令了」当成「口令消失了」——去那个文件里读。
- 跨源这一步最容易踩：看板页在 `*.pages.dev`，8431 在隧道域名上，预检不放行就等于浏览器侧写不了。`SH_ALLOWED_ORIGINS` 只接受**精确源**（scheme://host，不带尾斜杠），并且只在命中时回 `Access-Control-Allow-Credentials: true`；默认只放行 loopback http 源。
- 把 8431 挂公网＝把改稿写权限挂公网。写白名单只收 `.md/.txt`、`.json` 一律 415（派生件工具独占写）、越界 403、错误路径 `no-store`、未登录 401 且盘上不动——这些是兜底，不是让你省掉口令和 Access 的理由。

---

## 7. 第一次上真账号的验收清单

- [ ] 无痕窗口打开 Pages URL → 被 302 到 Cloudflare 登录 / 收邮箱验证码，**看不到任何项目内容**
- [ ] 登录后面板计数与本地版一致（p-menghe-01 v3 本次：世界书 6 词条·11 边 / 大事记 52 事件·26 轨 / 产物 80 件（大纲树，已排除 2 份诊断报告）/ 模型 6 项 / 日志 0 / 快照 0；v2 七区计数存档：总览 82 件 / 执行流水 0 / RAG 128 节点·23 边 / 知识卡 131）
- [ ] 手机 390 宽不破版：七区逐区可见、横向溢出 0 条像素（本地已实测，截图 `projects/_reports/w43-m-1..7-*.png`）
- [ ] 出板命令的「分发前自检」提示已看过，残留的本机路径是否处理过，是你明确的选择而不是没注意到
- [ ] 若要用在线写：Pages 源已进 `allowedOrigins`，看板产物区状态条显示「通道 B 连通（N 件）」，而不是「8431 要口令」或「通道 B 不通」
- [ ] 回滚路径确认过：Pages 项目里能看到上一次 Deployment 且能切回去

---

## 8. 局限与不做的事（如实）

- kit **不托管、不代部署、不保存任何 Cloudflare 凭据**。本页只给步骤。
- 静态页**不回连 kit**，零 kit 侧代码依赖：`file://` 直接打开即全部面板渲染。
- docx 二进制编辑仍然不做；看板 v3 里 doc/docx 在大纲树标「二进制」、文档阅读面板给转 md 提示（`python tools/export-doc.py`）。
- 文档阅读的授权动作必须在**看这块屏幕的那台设备**上手工完成一次，且换设备要重新授权——这是浏览器的安全模型，不是本项目的实现限制。
- Cloudflare 控制台的具体措辞可能变（Access 应用类型、Pages 直传入口）；本页按 2026-10 官方文档写，CF 侧那边走通一次后请把差异补进 §4/§7。

---

## 9. 相关件与出处

- 出板器：`tools/dashboard.py`（零外部资源红线 + 脱敏断言 + `--selfcheck` + 分发前自检）
- 模板：`tools/dashboard-template.html`（v3：六图标五面板 + 配置抽屉 + 双主题；规格唯一真相 `docs/工单-20261013-看板v3规格.md`）
- 写端点纪律与全部错误码：`adapter/README.md`「写端点纪律」段
- 工单与验收：`docs/工单-20261012-批次4-项目看板与湮灭批次2.md` W4.3
- §7 清单与 §4 的走查归到待裁账 **A2** 条目（`docs/待裁账-批次4-20261012.md`），实走后的差异回改本文档
- 校验脚本与收据：`w43-static-dist-check.mjs` → `projects/_reports/w43-static-dist-verify-20261012.json`
- Cloudflare 官方：[Pages Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/)、[Pages 配额](https://developers.cloudflare.com/pages/platform/limits/)、[Access 策略](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/)、[One-time PIN 登录](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/)、[Self-hosted 应用](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/)
