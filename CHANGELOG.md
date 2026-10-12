## Unreleased · 批次4 W4.4 湮灭第一刀：磁盘残留清理（2026-10-13）

1. **执行范围（用户裁定「全删（含水浒 116 件）」）**：`panel/kitapp/`（40499 件 / 1542 MB）、`panel/extension-dist/`（1170 件 / 17.5 MB）、`projects/p-sh-*` **61 个目录**（非空 1 / 空壳 60，合计 116 件 / 117 KB）。三项删前逐个验过 `git ls-files` = 0（`projects/` 下 tracked 只有它自己的 `.gitignore`），全是未跟踪磁盘残留——所以这一刀**不产生任何 git deletion**，删完 `git status --short` 的 deleted 行数为 0。`du -sh panel` 由 1.7G 降至 **12M**，合计释放约 1.55 GB。
2. **删前留账**：清单收据 `projects/_reports/w44-purge-manifest-20261012.json`（`purge-manifest@1`，34 KB），逐目录记件数与字节；唯一有内容的 `p-sh-202609291020aye`（水浒人物世界书卡 116 件）**逐文件记 sha256**——文件按裁定删了不可恢复，但「删了什么」有据可查。红线四条（`projects/p-menghe-01/`、`projects/_reports/`、`docs/_archive/`、`D:\写作\Kit Project\`）删前 assert 存在、删后逐个复核仍在，`p-menghe-01` 93 件、`_reports` 320 件未动。
3. **账本数字第二次漂移**：待裁账 D1 记的是 57 目录，删前实测 **61**（尾部多 `p-sh-2026101216392ft`、`p-sh-202610121641oum` 两个 0 字节空壳）；并行 session 的 `87a1ef72` 同时把工单数字改成 61 并注明「当日仍新增 11」。**产生源仍在**：8431 现役服务收 flow_run 时按时间戳自动命名新项目目录且不复用，所以这次清的是结果不是原因，治源（固定 id 复用或清扫策略）归 W4.4 收尾，未做。删后复查 `projects/` 无 `p-sh-*` 再生。
4. **删除时撞过一次文件锁，没有杀进程**：第一轮 `rmtree` 删掉约 1 GB 后在 `panel/kitapp/node_modules/@next/swc-win32-x64-msvc/next-swc.win32-x64-msvc.node` 上 PermissionError——被一个 `next dev -p 30142`（cmd 17792 → node 11552，起于 00:48）持有。处置是先查血缘与端口（30142 `curl` 得 000，并未在服务；`scripts/ops/README.md:12` 也早记了「30142 面板 dev 热更（kitapp）随 pi-web fork 线退役移除」），**等它自己退出后重试成功**，全程未 `taskkill` 任何进程，用户的 8431 活栈未触。
5. **一处验收标准不成立，如实记**：工单写的「`grep -rn kitapp` 仓内 tracked 文件仅剩 docs/_archive 与本文档」实测**不成立**——`git grep -l kitapp` 命中 **15 个** tracked 文件。其中只有 `storyharness/src/serve.ts:229` 是运行时路径（`OUT_DIR = panel/kitapp/out`），但下一行 `fs.existsSync(OUT_DIR/index.html)` 守卫着，缺产物即回落 `panel/` 零构建范本，`/panel` 静态面不受影响（该 `out` 目录本就不存在，回落路径一直在走）；其余 14 处是注释、gitignore 规则与文档记述。正名归第 3 项 tracked 退役那一刀。
6. **本刀未动（仍待裁）**：第 3 项 903 tracked 的 `panel/` 零构建范本 + `serve.ts` 27 处 `/panel` 引用 + `panel-files.test.ts` 改造（随看板 v1 验收）、第 4 项 `storyharness/desktop/` 5 tracked、第 5 项 `storyharness/cali/`、以及工单后并入的 `projects/proj_*` 空壳 ×3（`proj_livetest01`／`proj_muwoefim891r`／`proj_muxulht3n90m`，另有 `p-t`）——最后这类不在用户这次点头的三类里，要删得单独裁。
7. **闸门**：只删未跟踪磁盘件，未触任何入库文件、代码或测试路径，故未重跑测试套件（第 3 项 tracked 退役时按工单跑三 lint + core + storyharness 全量并同步改造 `panel-files.test.ts`）。文档同步三处：待裁账 D1（一览表行 + 执行记录 + D4 commit 实录）、工单 W4.4（清单表 1/2/6 项标已删 + 验收标准四条按实测勾/驳 + 状态行 + 末尾 ※ 追认注不改史）。
8. **「还能不能追回来」的三条如实口径（复查后才敢说）**：① tracked 那 **283 件在 git 历史里可取回**——删除发生在 `7c86cba4`，`git ls-tree -r 7c86cba4^ -- panel/kitapp | wc -l` = 283，`git cat-file -s` 抽样命中；② ROADMAP 4.0 表里「`D:\storyflow-extracts` 有存档」这句**对 kitapp 源码不成立**——实测该目录只有 `kit-frontend-precut/`（300K，两个 HTML 模板）与 `panel-lite-batchBC/`（100K），没有 Next.js 工程本体，README 也不提 kitapp（已在 ROADMAP 就地加注，未改原句）；③ 那 4 万件未跟踪残留**只留了聚合数（件数/字节），没有逐文件清单**——清单收据只对水浒 116 件逐文件记了 sha256。按工单原述与删除时撞锁的路径（`kitapp/node_modules/@next/swc-win32-x64-msvc/next-swc.win32-x64-msvc.node`）判断，这批大头是 `node_modules` 与构建缓存，`npm install` 可重建，所以没逐件留账；若里面混过谁的手工产物，那份账追不回来——这里明说，不含糊过去。真正不可恢复且由用户点名裁定的只有水浒世界书卡 116 件。


## Unreleased · 批次4 W4.3 Cloudflare 分发文档（+ 看板分发安全改造）（2026-10-12）

1. **交付形态**：一页文档 `docs/integration/dashboard-deploy.md`（九节，纯托管声明、零 kit 侧代码依赖）——§1 出板命令 → §2 上传前三条（**先配 Access 再上传**、看「分发前自检」点名、页面就是作品本身无 sidecar）→ §3 Pages Direct Upload 三步 + `wrangler pages deploy` 两行 → §4 Access 邮箱验证码（One-time PIN）policy 配置 → §5 局部更新与回滚、`?v=` 绕缓存 → §6 **两种形态取舍表**（纯静态 vs 在线写）→ §7 首次上真账号验收清单 → §8 局限 → §9 相关件与官方出处链接。工单原文的 `--out dist/` 不可用（`--out` 要文件名），文档统一 `--out dist/index.html` 并解释它为什么就是 Pages 根路径的入口。
2. **撞出来的真缺陷（分发安全，已修）**：看板 payload 的 `meta.project_dir`/`meta.root`/`meta.kit_root` 与「数据源健康表」的 `detail` 写的是**本机绝对路径**（`D:\storyflow-kit`、`projects\p-menghe-01\世界书\...`）。本地看没问题，页面一挂公网就是白送目录结构和用户名。现由新增的 `dashboard.py::disp_path()` 统一给相对/名称形态（实测出板字段现为 `projects/p-menghe-01` / `storyflow-kit`），`--selfcheck` 里两处按 `meta.project_dir` 定位源文件的消费方改从 `root` 拼（行为不变）。
3. **作者原文里的路径＝只点名不阻断**：新增 `abs_path_hits()` 在出板后扫整页，命中仍剩 3 处且全部来自**作者正文**（模型缓存路径、影子副本自述路径）。工具不替作者改写，改为在出板 stdout 加一行「分发前自检：页面残留 N 处本机绝对路径……上传公网前先看一眼」——自设阈值不当隐形闸，处置权在人。正则细化过 `(?!/)`，避免把占位文案 `http://127.0.0.1:8431` 误判成路径。
4. **验收（本地可复现部分 29/29，收据 `projects/_reports/w43-static-dist-verify-20261012.json`，脚本 `w43-static-dist-check.mjs`，诊断件 `w43-leak-probe.cjs`）**：dist 自包含、零外部资源独立正则复扫 0 命中（不轻信生成器自述）、balanced-brace 提取内嵌 payload 校验工具字段 0 绝对路径、凭据三探针 0 命中、出板 stdout 主动点名、连跑两次幂等、`--out dist/index.html` 与默认出板逐字节一致、390×844@2x 手机视口七区导航在位/逐区可见/计数与 payload 逐区相等（`[82,6,52,0,128,131,82]`）/横向溢出 0px、三通道入口在位、`file://` 直开零控制台报错、9 张截图。**出板 sha256 由 W4.2 段的 `10c8ae63…` 变为 `5bd17ff21d22429c…`**（632 KB），变化只来自第 2 条的相对化，七区数据未变。
5. **如实口径（CF 那一半没走）**：本机既无 `wrangler`/`cloudflared` 也无测试账号凭据，§3–§4 控制台步骤按官方文档写、文档里显式标注「未在测试账号实走」，「看板产物在 CF 域名下打开、未登录被拦」这条验收 **blocked on 用户 CF 账号**（§7 给了逐项打勾清单和本地对照基准）。查证过并写进文档的事实：Pages Free 每次部署 ≤20,000 文件、单件 ≤25 MiB；Zero Trust Access 免费 ≤50 用户；self-hosted Access 应用要求域名属账号内活跃 zone（`*.pages.dev` 可能需先添加）。wrangler 命令加了「以 `--help` 为准，本机未装」的口子，不编控制台细节。
6. **工单「截图入 docs」没照做（越界一记，已在工单写明）**：截图里是真实项目数据，而 `docs/` 入 git、AGENTS.md 明写真实语料不入库。截图落在 gitignore 的 `projects/_reports/`，文档只引路径。
7. **在线写形态的边界（§6 取舍表）**：纯静态＝只读＋通道 C＋通道 A（本机授权，https 下也能用）；要在手机上看板直接写盘，需要 `cloudflared tunnel --url http://127.0.0.1:8431` + `SH_PASSWORD=<口令> SH_ALLOWED_ORIGINS=https://<项目名>.pages.dev` 起 serve——那就不是纯静态托管，文档分开列并写清风险面。
8. **闸门**：`dashboard.py --selfcheck` 复绿、`python -m py_compile` 0 错；三 lint 0 error（flow 0E/0W、module 0E/33W 存量、kit 0E/2W 存量）；storyharness 161/161（本单零 TS 改动，复跑确认无回归）。
9. **遗留裁定项集中落账（用户口径「遗留项落文档即可」）**：新增 `docs/待裁账-批次4-20261012.md`，把散在对话、工单与收据里的待裁点收成一处（A1–D4 十三条，每条给现状、`path:line`/收据证据、可选项与推荐、裁定后要动的文件）。复点时发现 W4.4 删除清单的数字已漂移并按实测更正：`projects/p-sh-*` 现为 **57** 个目录（工单原文 14），仍只有 `p-sh-202609291020aye` 有内容（116 件水浒世界书卡、242K、git 未跟踪，删了追不回来）；`storyharness/desktop` tracked 为 5（工单写 6）；`serve.ts` 的 `/panel` 引用 27 处（工单写 23）；`panel/kitapp` 磁盘残留实测 1.6G。本账只记录、不代决，也未删任何文件。


## Unreleased · 批次4 W4.2 产物读写三通道（本地授权 / 8431 PUT / diff+ops）（2026-10-12）

1. **通道 A（本地主力，`tools/dashboard-template.html`）**：产物区「授权项目目录」走 `showDirectoryPicker({mode:"readwrite"})`，handle 逐段遍历（`fsFileHandle` 对 `..`、反斜杠、盘符段直接抛「路径含越界段」），读写都落在用户授权目录内；授权目录名与项目 id 不一致时状态条出警示而非静默。非 Chromium 系（Firefox/Safari）无该 API 时明说「走通道 B，或只读＋下载」，不假装可用。
2. **通道 B（在线，`storyharness/src/panel-files.ts` + `serve.ts`）**：新增写端点 `PUT /api/panel/files?project=&file=`，body `{content, expectHash}`。写纪律＝临时件（同目录 `.<base>.wtmp-<hex>`）→ 回读校验 sha256 与长度 → `renameSync` 原子替换；任何一步失败即 unlink 临时件并 500，绝不半截写。乐观锁：目标存在而不带 `expectHash` → 409 `EXPECT_HASH_REQUIRED`；带了指纹但对不上 → 409 `CONFLICT` 并交回盘上当前指纹，**零写入**。读端点回服务端 sha256（截断前算），作为指纹的唯一真相——不靠浏览器 `crypto.subtle`（file:// 与老引擎上未必有，各算一套必对不上）。鉴权沿用既有 B1 口令门（cookie `sh_token` / Bearer），未登录 PUT → 401 且盘上不动。写端错误路径（403/415/409/400/405）一律 `no-store`（缓存投毒红线）。CORS 预检放 PUT 并回 `allow-credentials`，只在已回显具体 loopback 源时给。
3. **写白名单比读白名单更窄**：只收 `.md/.txt`，**`.json` 排除**——JSON 是可写的派生件，而派生件由工具独占写（红线），面板代写会养出「工具与面板两套真相」。doc/docx 只读并提示「转 md 走改稿套件（`tools/export-doc.py`）」，抽屉给下载副本不给 textarea。单次写入上限 200 万字符，超限 413 显式报数不半截写。
4. **通道 C（补丁流）**：编辑器产 unified diff + 同源 ops.json → `batch-edit.py` 应用（先 `--dry-run`，后真应用 + `--receipt`）。**顺带修两个真缺陷**：① 相邻 hunk 的 3 行上下文重叠却不合并，`git apply --check` 直接拒；② 文本末尾换行被 `split("\n")` 算成幽灵空行，hunk 行数虚高、diff 不可应用。现为 `splitLines()`（跟踪 `aNL/bNL`）+ `diffScript()` 重叠窗口合并 + `\ No newline at end of file` 标记；修后 `git apply` 结果与编辑器意图**逐字节一致**。
5. **写后纪律**：任何通道保存成功，回执只**提示**重跑 `project-index diff` 与 `kit-compile --check`，看板不自动执行（报数附收据、不越权代跑）。
6. **验收（真浏览器 + 真盘上字节，实测在 `p-menghe-01` 的临时副本 `p-w42a` 上，真项目文件零改动）**：通道 A/B **32/32**（收据 `projects/_reports/w42-channelsAB-verify-20261012.json`，截图 9 张），含保存后整项目快照比对「只有目标文件变了」、409 拒绝后盘上仍是别人的版本、`../` 逃逸在 handle 层与服务端双拒（403 `OUT_OF_PROJECT` 且盘上无此文件）、docx/`.json`/隐藏件三类写入被拒、错误路径四个全 `no-store`、无 cookie PUT 401、预检放 PUT 而对 `https://evil.example` 回 403 无 ACAO；通道 C **18/18**（收据 `projects/_reports/w42-channelC-verify-20261012.json` + batch-edit 收据 `projects/_reports/w42-channelC-batch-edit-receipt.json`），含 `git apply --check`/真 apply 逐字节一致、`batch-edit --dry-run` exit 0 盘上未动、真应用 exit 0 + 收据键齐、count 与原文命中数不符 → exit 1 零写入；`repair-apply.py` 的 `validate`/`dry-run`/`status` 三态跑通（只读，各 exit 0）+ `--selfcheck` 4/4。storyharness **161/161**（本单 +7 测）+ `tsc --noEmit` 0 错；三 lint 0 error（flow 0E/0W、module 0E/33W 存量、kit 0E/2W 存量）；`p-menghe-01` 看板重建两次 sha256 逐字节一致（当时 `10c8ae63f9de7891…`，632 KB。该值随后因 W4.3 分发安全改造而变更，现值见本节末 W4.3 段）。
7. **质量声明分层（如实）**：**机器层**＝上述断言全绿（磁盘字节、HTTP 状态码与响应头、diff 可应用性、收据键、幂等 sha）。**人工层缺口**＝通道 A 的 Chrome 原生选择器无法自动化（本机只有 headless shell 1228，CDP `Page.handleFileChooser` 不存在，注入拦截后 picker 以 AbortError 收尾），故用**按规范形状伪造的目录 handle**（落到 HTTP→Node fs）驱动全部前端逻辑；前端代码与盘上字节都是真的，唯一未经机器验证的一环是 Chrome 自己的 picker 与 `createWritable` 实现——需人工点一次（步骤记在收据 `manual_step`）。
8. **已知边界（不粉饰）**：① `batch-edit.py` 多条 op 的 `old` 完全相同时，`validate` 按**原文**计数放过、应用是顺序替换，第二条静默落空且退出码仍 0；模板侧已加检测提示（建议改走通道 A/B 直存），是否把「重复 old」拒进 validate **待用户裁定**。② `repair-apply.py` 自述「不做 diff 应用」，是 repair-plan@1 改单台账；编辑器 diff 的记账落在 `batch-edit --receipt`，两条链只在「改单驱动改稿」时汇合，本单不宣称 diff 自动流进改单。
9. **顺带修的看板 UI 缺陷**：产物区两个状态条早先「先写 DOM 再由 `renderArtifacts()` 重渲染」，具体理由（授权目录与项目 id 不一致、8431 要口令、跨域被拦）会被通用文案盖掉——看着像「连上了」，其实没有。改为文案一律进 `fsState.msg`/`apiState.msg`，渲染只读 state。
10. **适配层同步（`adapter/`）**：参考客户端补 `fileWrite(project, file, content, expectHash)`（`PUT`；4xx 不抛、原样交回 `{status,...payload}`——冲突是预期状态，调用方要拿 `payload.hash` 重读合流；5xx 才抛）；`adapter/README.md` 补写端点入能力面与全端点表，并把**鉴权说明**写死（两条通道、401 时盘上零改动、写端纪律与全部错误码、`no-store` 红线、只提示不代跑对账）。实测 **11/11**（起真 serve + 真口令：未登录 401 盘上不动 / 读回 sha256 / 带指纹写 200 盘上逐字符一致 / 过期指纹 409 零写入 / 无指纹覆盖 409 / `../../逃逸.md` 403 / `.json` 415 / 新建含子目录 200 `created:true`），收据 `projects/_reports/w42-adapter-client-filewrite-20261012.json`。
11. **越界一记（请裁是否保留）**：`fileWrite` 实测撞出一个**既存缺口**——`/api/login` 的 token 只在 HttpOnly cookie 里（响应体是 `{ok,ttlHours}`），而 Node/Electron 主进程的 `fetch` 没有 cookie 罐，于是参考客户端 `login()` 拿不到 token、登录后依旧 401，任何非浏览器宿主都走不通带口令的能力面（不只是写端点）。改在**客户端侧**收口：`login()` 从 `Set-Cookie` 抠出 `sh_token` 转走 Bearer，返回值加 `tokenVia` 记哪条路（body / set-cookie / none）；服务端零改动，token 仍不进响应体（不进日志与代理缓存）。浏览器侧行为不变（cookie 自动随请求走）。
12. **A1 缺口补跑（2026-10-12 晚，14/14，收据 `projects/_reports/w4a1-native-pfs-verify-20261012.json`，截图 3 张 `w4a1-*.png`）**：第 7 条那个「唯一未经机器验证的一环」被切掉一大块——改用浏览器自己的持久文件系统句柄 `navigator.storage.getDirectory()`（无弹窗、不需要人点）当 `fsState.root`，驱动模板真实的 `fsFileHandle`/`readViaA`/`edSave`，这一回 `createWritable().write()` 是 **Chromium 自己的实装**。落盘证据两招：关掉浏览器后去持久 profile 目录 grep 到本次写入的标记串（字节在 OS 盘上，不是页面内存）；同一 profile 重开浏览器、重新 `getDirectory()` 读回，内容仍在。断言含种子 149 字符逐字符相等、打字后 `edState.text` 实时更新、回执「已落盘＋回读 sha 一致＋对账提示且不自动执行」、保存后状态位消失、PFS 树里只有目标件无临时件、`../逃逸.md` 在 `fsFileHandle` 层抛错、**真项目文件 sha 前后一致**（`33b87f413e976765…`，写只进 PFS）、控制台零报错。**仍剩的**只有「点授权 → 浏览器弹目录列表 → 选中真目录 → Chromium 把字节写进那个真目录」这一段（PFS 与真目录句柄在 Chromium 内部不是同一条写路径），所以第 7 条的人工一步保留，但意义从「验证我们的代码」降为「确认浏览器行为」。**顺带记两条口径**：① `file://` 上 PFS 被浏览器按安全策略拒（实测 `SecurityError`），工装起了一次 loopback http 服务喂同一个看板文件——看板要同时用通道 A/B，http(s) 源比 `file://` 省心；② 撞出一个看板小缺陷，编辑器「有未保存改动」状态位打字时不实时点亮（input 监听只更 `edState`、不重画 chips，数据是对的、坏的只是提示时机），记在待裁账 **C5**。
13. **A1 再补一轮：把「要你点的那一次」做成零输入入口（2026-10-12 深夜，15/15，收据 `projects/_reports/w4a1-wrapper-verify-20261012.json`，截图 `w4a1-6/7/8`）**：用户照第 12 条的步骤点了三次都没成（现场截图：`Failed to fetch` → `读不到：HTTP 404` → 「只读 · 世界书/设定.md」＋Windows 另存为框）。三个坑都不在看板代码里，而在「怎么把它打开」上：① 双击 `dashboard.html` 是 `file://` 源，通道 B 跨域被拦、PFS 也被安全策略拒；② 用户活栈 8431 是 W4.2 之前的旧构建，CORS 响应缺 `Access-Control-Allow-Credentials`、`Allow-Methods` 里没有 `PUT`，带 cookie 的写请求到不了服务端（**没有重启用户活栈**，另起 8433 新构建 serve）；③ 通道 B 的地址输入框长在产物区工具条上，而**抽屉打开时会盖住工具条**——指引假设了它可见，这条是我的错，已记为待裁账 **C6**（推荐把通道控件就地复制进拒绝抽屉）。解法是一页工装服务（只绑 127.0.0.1，不进 `tools/`）：同源 iframe 加载真看板 + `/api/*` 代理到 8433，页面加载完自动切产物区、填同源地址、点「连通」——**全部经真 DOM 事件（`input.value`＋`button.click()`），看板代码零改动**，等价于替用户做那两步手工操作。端到端断言：顶条自报连通 → 状态条「通道 B 连通（93 件）」→ 点行开的是编辑器而非拒绝抽屉（`编辑 世界书/设定.md / 通道 B · sha af490ce2…`）→ 读到全文与盘上逐字节一致 → 回执含 hash/字节数/「不自动执行」→ 盘上真写进去且**整项目快照比对只有目标件变**、无 `.wtmp` 残留 → 绕开看板改盘上后再存 → 409 拒绝且零写入 → 还原后逐字节一致、收尾快照回初始态 → iframe 内 `showDirectoryPicker` 存在且 `isSecureContext` 为真、授权按钮在位 → 无头里 picker 仍以 `AbortError` 收尾（＝机器测不到，人工那一步照旧保留）。写入目标一律是临时副本 `projects/p-w4a1`（整目录拷贝 + `dashboard.py --project p-w4a1` 重出板），真项目 `世界书/设定.md` 的 sha 前后都是 `af490ce206da61d3…`，零改动。**入口**：`http://127.0.0.1:8434/`（临时副本，随便写）与 `http://127.0.0.1:8432/`（真项目，保存即真改）；iframe 里若原生弹窗不出来，顶条有「在新标签打开同一块看板」的兜底链接。
14. **修掉 C6：拒绝抽屉里就地给通道控件（2026-10-12 深夜，13/13，收据 `projects/_reports/w4c6-drawer-channel-verify-20261012.json`，截图 `w4c6-1/2/3`）**：用户照第 13 条的入口点「打开阅读 / 编辑」仍旧掉进「只读 + 下载副本」的抽屉——因为那条入口依赖工装页替他连通，而**看板本身在「未连通」这个状态下没有可达的补救入口**：通道控件长在产物区工具条上，抽屉一开就把它盖住，于是「没连通 → 只读 → 找不到连通的地方」成了死循环，第一次用的人只能点下载。这是待裁账 **C6**，按推荐案①直接修：`editorRefuse()` 在「这件按策略可编（md/txt、非只读）且两条通道都没就位」时，抽屉正文长出 ①「授权项目目录（本地读写）」与 ②地址框＋「连通」钮，地址按 http(s) 源**预填 `location.origin`（零打字）**；任一条通了就 `await openEditor(rel)` 自动把抽屉换成编辑器，不必关抽屉重点一遍。`apiPing()` 加可选入参 `baseArg`（抽屉里的输入框与工具条不是同一元素），不传时行为与改前逐字相同。①在无头里必然 AbortError，抽屉给人话出路「你取消了或本浏览器不支持，改走②」而不是静默；doc/docx/json 等本就不可编的件**不长**这些控件（长了只会误导）。验的是用户实际那条路：不开工装页、不预连通 → 点行 → 「打开阅读 / 编辑」→ 拒绝抽屉 → 抽屉内②连通 → 自动重开编辑器 → 改字 → 回执含 hash/字节数/「不自动执行」→ 盘上真写进去、整项目快照只有目标件变 → 还原后逐字节一致、收尾快照回初始态 → pageerror 0。**回归全绿**：工装页 15/15、W4.6 大事记 26/26、W4.7 叙述层 27/27、`dashboard.py --selfcheck` 通过；看板连跑两次 sha 逐字节一致（`p-menghe-01` 现为 `ef0dac4617e9f6fa…`，634 KB；`p-w4a1` 为 `993b7c7fd0070f7c…`）——因本条模板改动，第 12/13 条与 W4.7 段记的 `b8644956…` 已过期。写入目标仍是临时副本 `projects/p-w4a1`，真项目 `世界书/设定.md` 的 sha 前后都是 `af490ce206da61d3…`，零改动。


## Unreleased · 批次4 W4.7 大事记叙述层（STAR 娓娓道来，人读优先）（2026-10-12）

1. **用户口径**：2026-10-12 用户定盘「不管是大事记还是时间线，都是人读的，需要满足 STAR 法则，娓娓道来，语言有故事感，这点要高质量，其余的继续往下做，我再决策」。本单在 chronicle@1 上加 `narrative` 叙述层：工具只把**已登记字段**拼成中文句子，作者原文（what/why/how/drift 与段带 note/sub、轨道 aliases）逐字进句、只补句末标点；缺的字段明说缺；邻拍只讲先后不讲因果（不猜红线不变）。
2. **契约**：`contracts/chronicle-event.schema.json` 顶层 required 增 `narrative{lead,hint,gaps[],beats[]}`；`bands[].intro`、`lanes[].arc`、`events[].narr`（四拍 s/t/a/r，text 非空）与 `events[].gap` 入 required。
3. **合成器 `tools/chronicle.py` 叙述层**：四拍＝情境/起因/经过/落点；`label_of` 邻拍短标签四道清洗（去括号场景标、去行首标点、跳过地点短语、不截半截引号）；`chronicle_lead` 一拍一段开场白；`event_gaps` 缺项账（记账不是闸，打回只来自确定性完整性或作者点名）；`STYLE_BAD` 文风闸（破折号、「不是…而是」、模型腔词表）只扫工具合成句，作者原文豁免。
4. **审稿改（人读质量，自读实文后改）**：① 起因缺省句从「起因源里没写。工具不替作者猜。」改为「起因这一项，源里没有写。」——不猜口径全篇只在开场白与看板提示里讲一次，五十二件事不盖五十二遍同一句免责声明；② 段带导语与轨道串讲补「头一拍/末一拍」「开头那一拍/收尾那一拍」，给读者一条可跟的线（只报序不报因果）；③ 引号嵌套降一级（「」→『』）统一收进 `q()`。
5. **看板叙述版 UI（`dashboard-template.html`）**：大事记区顶部加开场白卡（`.chlead`，pre-wrap 一拍一段）＋缺项账行＋选中段带导语卡；抽屉改「先讲后查」：STAR 四拍（`.beats`，字段空的那拍灰斜体 `.miss`）→ 缺项 chips → 折叠的 5W1H 十一栏明细与段带导语（`<details>`，对账通道保留）→ 原文整段 → 钻取；每条轨名旁加「讲」钮开轨道串讲抽屉（arc 段 + 逐拍列表，点拍跳该事件钻取，「只看这条轨」回多轨图）。页面只渲染、不改写工具文本。
6. **验收**：`chronicle.py --selfcheck` 全绿（四拍序、作者原文逐字忠实、缺项诚实、标签卫生、头尾拍在位、文风闸）；Playwright 真浏览器 **27 项**叙述断言全绿（开场白/段带导语/轨道串讲与盘上 chronicle.json 逐字比对、miss 灰显与字段空否一致、串讲点拍跳转、文风闸摘作者原文后 0 命中且未摘时的唯一命中可归因作者原文 e001 自带的破折号）；W4.6 的 26 项回归全绿（抽屉 `[data-focus]` 选择器改锁钻取区可见 chip，因 5W1H 明细已折叠进 details）；`dashboard.html` 两次构建逐字节一致（`b8644956…`）；三 lint 0 error（warn 存量）；storyharness 154/154。收据 `projects/_reports/chronicle-w47-narrative-verify-20261012.json`。
7. **质量声明分层（如实）**：机器层＝文风闸 + 逐字断言 + 盘上逐字比对，全绿；语义层＝作者人眼抽查（本单自读开场白、5 段导语、2 轨串讲、6 事件四拍，第 4 条审稿改即由此来）；规则库空档＝`STYLE_BAD` 只覆盖已列词条，词表外的模型腔不在闸内，靠人眼兜。
8. **待裁不变**：W4.6 第 9 条两点（是否在 `时间线.md` 补 `〔因：…〕/〔如何：…〕`、是否建势力卡）仍待用户裁定，本单不代决。


## Unreleased · 批次4 W4.6 大事记（叙事 5W1H 多轨时间线）+ 看板六区升七区（2026-10-12）

1. **契约 `contracts/chronicle-event.schema.json`**（新增，`chronicle@1`）：事件 = `id/seq/band/layer/file+line/when{raw,clock,days,abs,via,approx}/where[]/whereCards[]/who[]/faction[]/what/why/how/refs[]/drift/tracks[]/body/storyKey[]`，聚合件 = `{format,project,sources[],bands[],lanes[],events[],stats}`。`when.via` 只允许 `bold-head|bold-inline|bare-clock` 三取值；近似时刻（"深夜11点"→23:00、"约十二年前"）**只记账不冒充作者断言**。全程避开 `$ref/anyOf/oneOf/$defs`，让 `tools/jsonschema_lite.py` 能用**同一份 schema** 校验产出——不另立第二套真相。
2. **归纳器 `tools/chronicle.py`**（新增，纯 stdlib，`--selfcheck`）：真相源 = `世界书/时间线.md`（平铺）或 `世界书/编年/大事记.md`（骨架式），两者可并存一并收；派生件 `世界书/chronicle.json` **工具独占写、重建即覆盖、源 md 永不被改写**（立场同 `worldbook-history@1`，零新增记录负担）。行法解析只收高置信形态：`**…**` 时间戳、冒号前地点短语与 `【…】` 场景标、`（第N章）/（第N-M章）`、`Δ` 矛盾标记、`## 第一日 · 6月24日（第1-17章）` 段带。**不猜原则**：`why/how/何地` 只从显式行内标记 `〔因：…〕/〔如何：…〕/〔何地：…〕` 取（成对式 `〔因〕…〔果〕…` 实测会把整句吞进字段，改为自封闭"键：值"式并从 `what` 剥离不重复计字），缺省留空显示「未登记」，禁止用叙述句硬填。轨道 lane = 人物卡 ∪ 势力卡命中（`人物.md` 三级标题含括号化名 → "白小姐"命中白灼；`人物/*.md` 一人一卡；`设定.md` 粗体条目与「组织」节），一事件可上多轨；**地点不进 lane**（只进 `where`/`whereCards`），避免泳道被场景名淹没；未上轨人物进 `stats.uncoveredPeople` 供人补，**不静默丢弃**。
3. **看板大事记区（真身多轨，`dashboard.py` + `dashboard-template.html`）**：新增 `zone_chronicle`——**在内存内复用 `chronicle.py` 出 chronicle@1，看板不写 `chronicle.json`**（派生件写权归归纳器独占，两处写会养出两套时序）。缺真相源＝空区 + 显式提示，不是错；归纳器装载失败或契约校验不过也不黑屏，落 notice。视图为视频编辑式多轨泳道：段带头行 + 编年全览行 + 每 lane 一行（左侧名字栏 sticky）、事件块横向排布、Δ 块红描边、未上轨事件单列；「按故事内时序 / 按揭示顺序」双时序切换 + 段带筛选 + 轨道收起 + 搜索 + 聚焦淡出。钻取=点块开抽屉，5W1H 十一栏（何时/何地/何人/何势/何事/何因/如何/章/Δ/段带/源）+ 原文逐段 + 涉及轨道；抽屉里点人名＝按 lane 隔离高亮，「退出」回全貌。`who` 命中地点卡时可跳知识卡全文（`byPath` 复用）。
4. **口径纠偏（W4.1 接错数据源的收口）**：journal 16 项 `event` 枚举全是执行环，是 **agent 执行流水**，与叙事大事记无关。区名与文案改为「执行流水（journal）」，与本单「大事记」并列不混排；改名点覆盖 `dashboard.py`/`dashboard-template.html`/`journal-page.py` docstring+argparse/`journal-template.html` 页标题/`docs/integration/host-integration.md`/`docs/ROADMAP.md`/`contracts/README.md`/`storyharness/src/serve.ts` 注释。**生成器行为红线未动**：同一 fixture 改名前后生成的正文逐字节一致，差异仅 3 行标题文案（`<title>`/`<h1>`/`.proj` 说明行）。`panel/extension-dist/` 冻结域按 W4.4 第 3 项处置，本单不动。
5. **看板升七区**：`ZONES = 总览/世界书/大事记/执行流水/RAG 图谱/知识表格/产物`；`REQUIRED_TOP` 纳入 `chronicle`；`meta.counts` 拆 `chronicle_events`/`chronicle_lanes` 与 `journal_events`；总览统计卡与数据源健康表分列两账；`cmd_build` 打印分列。
6. **实跑（p-menghe-01）**：52 事件 / 5 段带 / 26 轨（人物 23 · 势力 3），**零丢弃**（52 条 bullet 全成事件，每条带 `file`+`line`）；`withRefs 52`、`withWho 39`、`withPlace 11`、`withTime 9`（+`approxTime 5`）、`withFaction 6`、`withDrift 2`、`withWhy 0`、`withHow 0`（原稿未打 `〔因：〕/〔如何：〕` 标记，符合"不猜"缺省）、`uncoveredPeople ["温韫"]`（记账非闸，供作者补卡或补时间线）；`chronicle.json` 连跑 sha256 逐字节一致（`feb15232…`），`dashboard.html` 两次构建逐字节一致（`ab4d9d12…`，564 KB，零外部资源引用 0 命中）。看板大事记区 Playwright 真浏览器 26 项 DOM/渲染断言全绿，含**块总数 155 == payload 派生期望**（每事件 `tracks.length+1`＋未上轨单块）、抽屉正文与源 md 逐字一致、零丢弃投影、console 0 报错。收据 `projects/_reports/chronicle-w46-verify-20261012.json`。
7. **三 lint 0 error**：flow-lint 5 flow / 0 error / 0 warn；module-lint 8 模块 / 0 error / 33 warn（存量）；kit-lint 0 error / 2 warn（存量）。
8. **测试与已知阻塞（如实分列）**：storyharness **154/154 全绿**（本单只改 `serve.ts` 两行注释）。core **491/499，8 项失败**，全部在预设枚举路径，与本单改动无关（`core/` 目录零改动，且失败输出中 `chronicle|dashboard|journal|大事记` 0 命中）：① `assertion-preset.test.ts` ×2 与 `ap1-override.test.ts` ×5——tracked commit `7c86cba4`（批次4 定盘 + 废弃湮灭批次 1，用户拍板）删了 `assertion-presets/` 四套预设并给 `assertion-preset.schema.json` 落 tombstone，测试仍断言 `['minimal','novel-fanqie',…]`，实测得 `[]`；② `production-preset.test.ts` ×1——工作树含 untracked `presets/image/`（视觉链路工单在建）与 tracked `presets/skeletons/`，而测试钉的是 5 个 id 白名单。**属既存目录/删档漂移，按用户「不用管既存的目录冲突后续我会处理」不动工**；W4.6 验收标准里的 `core 498/499` 基线需在批次1 湮灭收尾后重记。
9. **待裁（数据侧，非缺陷）**：① 是否在 `时间线.md` 补 `〔因：…〕/〔如何：…〕` 标记（现 52/52 该两项未登记，工具按红线不猜）；② 是否建势力卡（今日仅 3 条势力轨 vs 23 条人物轨）。


## Unreleased · 批次4 W4.1 项目看板（2026-10-12）

> ※ 本节写下时把 journal 台账称作「大事记」，2026-10-12 用户重定义后由 **W4.6** 纠偏：journal 区名现为「执行流水」，「大事记」归叙事 5W1H 多轨时间线；本节取数口径（`journal-page.load_events`）本身正确，仅命名错位。另：本节所述「六区」现为 **七区**（W4.6 新增大事记区），模板与聚合器均已升级。历史记录照原文保留。

1. **看板聚合器 `tools/dashboard.py`**（新增）：一条命令出全量自包含 HTML 项目看板——六区 = 总览（项目档案/会话简报/冷启动待询问 + KB 板块与编译期簇 + 知识分布 + 产物构成 + 诊断报告账 + 数据源健康表）/ 世界书 / 大事记 / RAG 图谱 / 知识多维表格 / 产物文件区。取数**全部复用既有生成器**：`kb-graph-page.build_payload`（双根合并去重口径）、`worldbook_index.build_index`（文件即真相，`built_at` 丢弃保幂等）、`journal-page.load_events`（三形态装载）、`project-index@1` 清单、卡片 frontmatter 双形态解析（knowledge/ 的 JSON-in-fence 与 世界书/规则 的 YAML 子集）。
2. **固定模板 `tools/dashboard-template.html`**（新增）：左侧导航 + 主区 tab，暗色系金调对齐 diagnosis/kb-graph 模板；知识表格带 域/track/状态 筛选 + 全列排序 + 搜索 + 点行看卡全文（正文内嵌，不回 call kit）；产物区为**只读清单 + 首段摘要**（正文不内嵌，读写见 W4.2 三通道；JSON/台账类只给字节账不给花括号摘要）。
3. **双根口径（架构红线 2）**：`--root` 只当数据根（`projects/<id>` → 回退 `<root>/<id>` 平铺外部项目根，同 kit-compile 语义），全局语料与编译图永远取 `--kit-root`（缺省本仓根）。实测外部平铺根 `D:\写作\Kit Project/梦核网文小说项目` 出板：全局 117 词条 + 项目 10 词条 = 127 节点、知识卡 131、产物 144 件。
4. **Windows 输出编码**：`main()` 起手把 stdout/stderr 重配置为 UTF-8——本机控制台 GBK 下 `--print-payload` 实测 UnicodeEncodeError，中文输出现场即崩。
5. **顺手修既存渲染 bug（越界一记，请裁）**：`tools/kb-graph-template.html` 里 links 用 `idxOf.get(l.s)` 查表，而 `build_payload` 产出的 `links[].s/t` 是**节点下标**（整数），恒查不到 → **图谱页所有边被静默丢弃**（p-menghe-01 实测 payload 23 边、页面渲染 0 边）。改为下标/id 双形态兼容认。该 bug 对 `--selfcheck` 不可见（自测只校验 Python 侧 payload，不校验浏览器渲染）。看板图谱区同点此处不再犯。
6. **验收（15/15 绿，收据 `projects/_reports/dashboard-w41-verify-20261012.json`）**：`--selfcheck` 合成 fixture 过（形状 + 两次渲染逐字节一致 + 计数 + 坏行跳过 + 缺失件显式标记 + 正文不内嵌）；p-menghe-01 实跑出板 502 KB（<5MB 无须说明）；同输入两次构建 sha256 逐字节一致（幂等，页面不携带生成时刻）；产物全文跑零外部资源红线 0 命中；六区计数独立对账全等（知识卡 131=120 全局+11 项目 / 图谱节点 128=117+11 / 世界书 6=世界书 md 件数 / 产物 82=索引件数、人写 78=索引 human 件数）；三 lint 0 error（flow 0 warn / module 33 warn 存量 / kit 2 warn 存量）；四个既有生成器工作树干净未改动，diagnosis 与 kb-graph selfcheck 各自复绿。
7. **已知空区（数据缺失非缺陷）**：大事记区今日所有项目均为空——本仓 `projects/**` 无一份 `journal.jsonl`（台账由内核执行环落账），看板显式提示"有账后重跑即出"而非静默空白页。浏览器实拍受限于本会话无可见 surface（viewport 0×0），改以 DOM 级断言取证（六区渲染节点数、抽屉全文 1,915 字符、排序/筛选/边渲染 23/元数据标注均实测通过，console 0 报错）。



## Unreleased · 官方 panel 范本批B/C（2026-10-02）

1. **panel/ 零构建组件范本**（对标 pi-web，MIT）：五个原生 ES module 组件（会话列表 / turn 流式对话流 / 输入框 / 文件树预览 / 世界书·RAG 双页签检索）+ 组装示范页 `index.html`；统一 esc()、client 注入式、组件零依赖（裸包名 import 有测试拒门）。
2. **`/panel/*` 静态托管**：serve 白名单后缀直出 `panel/` 目录（越界 403 / 查无 404 / 白名单外 415）；`/panel/client.mjs` 为固定别名 → `adapter/storyflow-client.mjs`（byte-equal 测试钉住单一事实源）。
3. **浏览器插件壳（独立运行形态）**：`panel/extension/` MV3 manifest（host_permissions 授权本机 8421/8431，permissions 仅 storage）+ options 页（基址/口令 → chrome.storage）+ popup 面板；`sync.mjs` 复制即打包，副本漂移有测试红。
4. **测试**：新增 `panel-static.test.ts`、`panel-extension.test.ts`；storyharness **90/90** 全绿（在 deduce 整包挪出后的树上验证）。

## Unreleased · deduce 包整体挪出（2026-10-02）

1. **推演引擎离仓**：`storyharness/packs/deduce/` 整体移出至独立存放区 `D:\storyflow-deduce\`（v4 完整线 763 行引擎 + galgame 页面壳 ‖ kit 纯 API 线 641 行，双线并存未合并，血缘见其 README）；`verify/packtpl-smoke.mjs` 随迁。本仓自此**无内置扩展包**，挂载机制（`src/packs.ts` 三根扫描：内置 `packs/`｜工作区 `<ws>/packs/`｜manifest `runtime.packs`）原样保留——拷回即复活。
2. **文档口径**：README（架构图/源码地图/§2.2/快速开始）、AGENTS.md 同步「无内置包」；`/api/deduce/*` 随包离仓，官方数据面以批A 的 files/raw/preview + worldbook_search 为准。

## Unreleased · 官方 adapter 能力面批A（2026-10-02）

1. **本地文件能力回归（工单-20261002 批A）**：`/api/panel/files`（两层树/文本读取 ≤200KB）、`/raw`（图/PDF/音频白名单字节流，25MB 上限 + Range）、`/preview`（预览判定元数据 kind:inline|text|none|missing）以官方能力面身份回归，实现自切割存档对齐复刻为 `src/panel-files.ts`（safeProject 走 `safe-project.ts` 同一把越界钥匙）；`worldbook/telemetry/changes/canvas` 维持 **410 GONE**（`code:"RETIRED_FACE"`）。
2. **`/api/kernel-verb` 白名单 +1**：`worldbook_search`（世界书检索经协议面可达，此前只有 kb_search/kb_read）。
3. **adapter 能力声明**：`adapter/README.md` 新增四能力总表（创作改写/本地文件/世界书/RAG → 端点 → client 方法）与三同名辨析（adapter/ ≠ adapters/ ≠ pinax-adapter）；`storyflow-client.mjs` 补 `fileList/fileRead/fileRawUrl/filePreview/worldbookSearch/kbSearch/kbRead`。
4. **测试**：新增 `panel-files.test.ts`（files 树/读取 + raw MIME/Range/415/403/413 + preview 四档 + 退役面 410，13 测）；storyharness **84/84** 全绿；两道生成门禁 OK。

## Unreleased · 前端切割（2026-10-02）

1. **仓内前端整体退役**：门面 `home.ts`、面板数据面 `panels.ts`、deduce 包页面壳（galgame）、页面生成与交付链（`tools/serve.py`、`project-pages.py`、`package.py`、`author-home.py`、三个 HTML 模板、`page-lint.mjs`）、根 `index.html` 全部删除；孤儿工具 `udiff.ts` 与面板 verify 脚本随迁。被切文件的存档指针见 `docs/交接回执-前端切割与v4收拢-20261002.md`。
2. **协议面行为**：`/api/panel/*` → **410 GONE**（显式点名退役，不静默 404）；`GET /` 改为一页协议面落地说明（无 UI 壳）；`web` 启动器不再拉页面服务（:8420 面退役），manifest `agent.base`/`runtime.ui` 不再消费。
3. **幸存件迁移**：`safeProject` 迁至 `src/safe-project.ts`（serve/packgate/auth.test/deduce 引擎共用）；`stripPromptFields` 并入 `serve.ts`；deduce 包转纯 API 形态（manifest 1.1.0，pages 扩展点移除，`/api/deduce/*` 不变）；`kit.py` vendor 集剔除 serve.py。
4. **测试与门禁**：storyharness 76/76（删 3 个面板测试文件与 udiff 孤儿测试后）；core 427/428（唯一失败为本机 `python` 商店 stub 环境问题，与切割无关，见 AGENTS.md 已知坑）；两道生成门禁 OK；`adapters/dist` 重建对齐 src（此前陈旧导致 FS 注册面单文件跑挂）。
5. **core 未动**：`compat.ts`（页面批注兼容面）按「legacy 面冻结」纪律保留，列退役候选（见交接回执）。

## Unreleased · 工单 R7-2/R7-3 + R8 主体（2026-10-01）

1. **@storyflow/adapters 物理拆包**：FS 抽象层契约（fs/proc/env/hash 四接口）+ 注册表 + Node/Mock 实现整体迁至 adapters/ 独立包（build 产 dist，core 经 file: 依赖消费）；core/src/abstraction/ 全部变为 re-export shim——旧路径零改动，166 处尾参默认原样可用。
2. **core 库面净化（R7-2）**：库面 node:* import 清零（ids 的 crypto 归 IHasher、kernel 死码 createRequire 验尸、compat Buffer 归 fnv1a、库面 console 退场、process.env 归 IEnv 含 platform()）；schema.ts::ROOT 惰性化（rootOf()/contractsDirOf()，loadAjv 惰性）；cfg-template 模块级求值收编；api-v1/compat 的 fastify 类型换本地结构化子集（库面不依赖 fastify 类型）。
3. **纯度门**：core/tsconfig.pure.json——types:[] 无 @types/node 下全库 tsc 0 错；广谱判据 node:(fs|path|child_process|crypto|module) 在 core/src 零命中（含宿主入口）。
4. **红线修复**：http.ts 自启动守卫只认 http.ts 导致 dist/http.js 静默退出（先于本轮即存在）——对齐 mcp 的 .ts|.js 双认；dist/cli.js flow_list 与 dist/http.js v1/openapi/legacy 弃用头三冒烟全通。
5. **R8 Auto 预设路由（规则式 v1）**：suggestProductionPreset（关键词+输入形状，可解释回执）+ flow_run(preset:"auto") 接线——state.preset 存解析后 id、journal 留路由理由；kernel.suggestPreset 预览面。模型式路由后置。
6. **ProcOptions.envDelta**：库面传差量、适配器负责继承合并（verbs.ts 不再展开 process.env）。
7. 测试 38 文件/426 用例全绿（+5 Auto 路由）；死表守门（R7-1 注册面 / R6 例外表）按「少一处=表过期」设计同步销账。

## Unreleased · 工单 R7-1（FS Phase 4 前置：平台缺省适配器注册面，2026-10-01）

**一句话**：`@storyflow/core` 侧**不再 import 任何宿主实现**——R3 立下的 166 处尾参默认 `fs: IFileSystem = nodeFs`
的「缺省」从一个实例改成**一次查找**（新增 `core/src/abstraction/defaults.ts`：注册表＋转发代理）。
拆包（R7-3）的硬前置就此解开，而**调用点一行没动**：名字保留、含义换掉，Node 宿主注册进去的正是原来那三家。

**行为变更一处**（其余为等价换管道）：**未注册就用 = 抛错点名**，不再有静默回落。以前宿主忘了注入会悄悄写真宿主盘、
编译照过；现在跨包消费者在 Node 上跑必须先登记（实测抓到 `storyharness/test/kit-wiring.test.ts`，
补一行 side-effect import 后 storyharness 套件 94/94 绿）。这是 R7-1 唯一的**外溢面**，也是这张表的价值：
「core 不依赖宿主」这件事从此在运行时也成立，而不只是 grep 上成立。

1. **注册表**（`core/src/abstraction/defaults.ts`，零 `node:*`、不 import 适配器实现）：`registerAdapters({fs,path,proc})`
   / `currentAdapters()` / 三个 `Proxy` 转发对象。逐次调用查表 ⇒ 注册时机不受 import 顺序约束；转发对象身份稳定
   ⇒ FS1 D4 的「按适配器身份分桶」缓存语义与 R6-4 的 `mcpFor` WeakMap 分桶都不变；重复注册以后者为准、只登记引用不复制。
2. **Node 侧登记**：`abstraction/adapters/node.ts` 末行 side-effect 注册自家三家（入口件 import 它即完成）；
   新增 `core/vitest.config.ts` 把 `test/setup-adapters.ts` 挂成 `setupFiles`——这份 setup 同时是浏览器/WASM 宿主
   该照抄的那一行（换成自家实现即可）。
3. **28 个文件的 import 行改指 `defaults.js`**：一次 `tools/batch-edit.py --manifest`（该工具本轮升 v2，支持多文件同批：
   逐文件字面校验、任一处不成立整批拒绝零写入、per-file sha256 前/后收据），收据 `.receipt-r7-1-imports.json`（仓库根，与 R4 那批收据同一处）。
   仍直连 Node 适配器的只剩**七个宿主入口件**（`cli.ts` `mcp.ts` `export-cli.ts` `quality-cli.ts` `http.ts` `schema.ts` `cfg-template.ts`）。
4. **`http.ts` 显式登记**：HTTP 面本就跑 Node，靠 `schema.ts` 的传递 import 侥幸拿到实现的话，断在哪天是运行时启动即抛、
   编译期拦不住——那一行写成显式副作用 import 并在注释里点名理由。
5. **新门 `core/test/defaults-registration.test.ts`（8 例）**：双向死表（豁免区之外只剩七件）／`defaults.ts` 自身干净
   （只查 import 形态——未注册那句错误消息里必然写着该 import 哪一件，按裸文本匹配会把自己的指路消息判成违规，
   本轮自测就被绊过一次）／尾参默认去向普查逐数（**166 总 / 156 经注册表 / 10 在 `cfg-template.ts` / 27 个文件**）／
   未注册抛／注册即转发＋宿主盘零泄漏／后注册覆盖（含 `sep` getter）／只登记引用／setup 后身份稳定。
6. **规范同步改写**（不留第二套真相）：FS1 §四第 1、2、4 条按注册语义重写 ＋ 新增 **§4.1 注册面** ＋ §六 追加
   D-R7-1…D-R7-4。第 4 条顺手纠正 R7 门禁的写法：工单字面那条「core 包在无 `@types/node` 下 tsc 通过」**跑起来是空转的**
   （fastify／MCP SDK 的 d.ts 带 `/// <reference types="node" />`，传递性把 `@types/node` 拉回类型图，`types: []` 拦不住），
   能落地的门是「import 普查双向死表」＋「依赖出包」。

**门禁实测**：`tsc --noEmit` 0 error；`npx vitest run` **38 文件 / 421 用例**全绿（R6 交付基线 37/413 ⇒ ＋1 文件 ＋8 用例）；
`gen-openapi --check`／`gen-verbs-doc --check` OK（19 路由＋27 动词）；漏传门复跑 **TS2554 = 0 / TS1016 = 8**（`.leakcheck` 已删）；
入口冒烟复验 `flow_list` 0、`quality-cli` 3 项 0、`export-cli mermaid` 0、`up --port 8498`：`GET /` 200 text/html 2200 字节／
`/.git/config` 404／`/api/v1/projects` 200／`/api/v1/verbs` `ok:true`（冒烟进程按 CommandLine 核验后自杀，端口已释放）；
`storyharness` 套件 94/94。**提交状态（2026-10-01 01:19 的实况，不是本会话的动作）**：验收方 ZCode 出的
`docs/验收回执-R1-R6-20261001.md` 建议「R7 落地前先分轮提交」，随后落了四个切片提交
（`7b20668e` R1-R3 ／ `97395502` R4 ／ `8be82859` R5 ／ `f48dadf7` R6）——**R7-1 的代码当时正在盘面上，被同一批
`git add` 一起扫进了切片 1/4 与 4/4**：注册表、两个新测试件、`core/vitest.config.ts`、`tools/batch-edit.py` 与
28 个 import 换向现在都在 HEAD 里，而提交信息写的是 R1-R3/R6。仍在盘面的只有本轮四份文档改动、
`storyharness/test/kit-wiring.test.ts` 那一行登记，以及五张收据/回执（untracked）。
**审计提示**：按提交信息找 R7-1 会找错地方，用 `git log -- core/src/abstraction/defaults.ts`。
邻会话交接回执：`docs/交接回执-注册面R7-1-20261001.md`（写集逐件 sha256＋mtime、最短验收三命令、行为变更一处、未决 N1–N7）。

**未做/挂账（诚实面）**：① **R7-2 core 包净身**——非 FS 族 `node:*` 六处（`kernel.ts:577-578` 的 `createRequire` 疑似死码，
先验尸再处置）、`ids.ts::sha12` 同步 sha1、`api-v1.ts`/`compat.ts` 的 fastify 类型形状、`process.env` ×5 文件／`Buffer` ×1／`console` ×1；
② **R7-3 物理拆包**——`@storyflow/core` ＋ `@storyflow/adapters` 目录拆分与旧路径 re-export，红线是
`core/dist/cli.js`／`core/dist/mcp.js` 不能断（宿主 MCP 注册指着它们）；③ 模块级求值两件（`schema.ts::ROOT` 即 FS1 D3、
`cfg-template.ts` 的 10 处尾参默认）本轮**故意没动**——它们在宿主入口死表里，硬推只会把注册表写成第二个真相；
④ 注册表是**进程级单表**，多宿主并存（同进程两家盘）需要的是显式传 `kernel`，不是靠这张表兜——这一点与 D4 同源，写进 §4.1。

---

## Unreleased · 工单 R6（FS Phase 3：宿主面清零，2026-09-30）

**一句话**：R3 收口时挂着的那 9 个宿主面文件全部改吃注入，`core/src` 除 `abstraction/adapters/*` 外
**零 `node:fs` / `node:path` / `node:child_process`**——工单 R6 的出口判据达成，M3 的前半（全内核零 `node:fs`）成立。
证据不是 grep，是**跑**：会话面、`fs_*` 工具族、系统提示、`flow_lint`、静态面 `GET /` 整条跑在内存盘上，
跑完宿主盘一条都不许多（`core/test/r6-host-free.test.ts`，与 R5 的 `fs-call-matrix.test.ts` 同一把尺）。

**行为变更四处**（其余为等价换管道）：
① `agent.ts` 七个公开函数的首参由路径字符串改 `kernel`（`loadModelConfig` / `saveModelConfig` /
`listSessions` / `createSession` / `getSession` / `deleteSession` / `renameSession`）——**破坏性签名变更**，
但全仓直接 import 者只有 `core/test/agent.test.ts`（已同步改），`storyharness/` 用自有副本、`adapter/` 走 HTTP，外溢面实测为零；
② `export const agentMcp` 单例下架，改 `mcpFor(kernel)` 按注入盘分桶（默认 Node 盘仍是同一实例 ⇒ 现网 HTTP 逐字节不变）；
③ `flow_lint` 的子进程 cwd 由「projectDir 上跳两级」改 `kernel.repoRoot`——默认盘面（`root === repoRoot`）同值，
分离数据根的宿主上这才是对的（只有仓库根有 `tools/flow-lint.py`）；
④ 静态面读盘改 `kernel.fs.stat` + `readBuffer`，出口按 Fastify 惯例包一层 `Buffer.from(…)`——发出字节不变。

1. **接口扩容两件**（§四第 5 条走的普查，不是加偏好）：`IFsPath.fromFileUrl(url)`（唯一调用点 `schema.ts:15`
   用 `import.meta.url` 定位包根，此前是宿主件里最后一条 `node:url`）、`IProcessLauncher.detach(cmd, args)`
   （`cli.ts` 的 `up --open`，不返回结果、失败只以抛错表达）。Node＋Mock 双实现，对表测试进 `abstraction-mock.test.ts`。
2. **`agent.ts` 整件零 `node:*`**：内部件（`readSession` / `writeSession` / `sessionFile` / `withinProject` / `fsTools` /
   `analysisTools`）与公开件一律从 `kernel.fs` / `kernel.path` / `kernel.proc` 取管道；`analysisTools` 里那份
   抄自 `withinProject` 的「resolve + sep」越界判定收编成单点调用（两套真相必然漂移）。
3. **`flow_lint` 走 `proc.runAsync`，四态返回各有测试**：有输出（截断透传）／启动层错误（`执行失败: …` ＋ stderr）／
   退出非零且无输出（`退出码 N（无输出）` ＋ stderr）／退出零无输出（`exit=0` 占位）。特意补了第三态：
   把它折叠进「执行失败」会把 flow-lint 的 stderr 诊断缩成一句干巴巴的 `exit=1`。
4. **`http.ts` 静态面与 openapi 读取吃 kernel**：`resolveStaticPath(kernel.root, url, kernel.fs, kernel.path)`、
   `contentTypeOf(abs, kernel.path)`、`Buffer.from(kernel.fs.readBuffer(abs))`；白名单判定（敏感段/敏感前缀/穿越）
   在内存盘上照样 404，有测试。
5. **入口件按纪律显式用 Node 适配器**（不是漏网）：`cli.ts` `mcp.ts` `quality-cli.ts` `export-cli.ts` `schema.ts`
   的 BETA 留痕、包根定位、CLI 进程面本就属宿主职责（§四第 1/2 条），改吃注入反倒会把台账写进内存盘。
   `cli.ts` 的 `openBrowser` 因此收 `proc: IProcessLauncher` 形参——平台选命令留在入口，起进程交给抽象层。
   （**R7-1 起本条口径更新**：core 侧那 28 个文件的 `nodeFs`/`nodePath` 改从注册表取，本条列的入口件才是直连 Node 实现的一方；
   名册以 `core/test/defaults-registration.test.ts` 的死表为准，此处不抄第二遍。）
6. **普查门写成双向测试**：`r6-host-free.test.ts` 走 `core/src/**/*.ts`（排除 `abstraction/`），
   `import` 与 `import("node:x")` 两种形态都算。剩余**非 FS 族**宿主绑定钉成死表六处：
   `node:process` ×3（`cli.ts` `export-cli.ts` `quality-cli.ts`）、`node:net` ×1（`cli.ts` 端口探测）、
   `node:crypto` ×1（`ids.ts`）、`node:module` ×1（`kernel.ts` 的 `createRequire`）——多一处=新尾巴，少一处=表过期，
   两样都当场红。这六处属宿主面（FS1 D7 同族），完整达成在 R7 拆包。
7. **漏传门（§四第 7 条）在 R6 实抓两处**：剥掉类型标注形态的尾参默认后 `TS2554` 点名 `mcp.ts` 的 R4 资源面
   两处 `contentTypeOf(rel)` 没传 `kernel.path`——正是「尾参默认漏传也编译通过」的现行犯，已修，复跑 TS2554 = **0**。
   顺带纠正该门的复现命令：按字面 ` = nodeFs` 粗剥会把常量初始化一起削掉，满屏 TS1005 假语法错反倒埋掉真漏传，
   剥离必须按 `: IFileSystem = nodeFs` 这种**类型标注形态**做（命令已写进 FS1 §四第 7 条）。
8. **门禁数字**：`npx tsc --noEmit` **0 error**；`vitest run` **37 文件 / 413 用例**全绿（R5 交付基线 36/397 ⇒ ＋1 文件 ＋16 用例）；
   本轮两件单独跑：`r6-host-free` **15 用例**、`abstraction-mock` **18 用例**（R6 补 `fromFileUrl` 对表与 `detach` 两条）；
   `gen-openapi --check` OK（**19 路由 ＋ 27 动词**）；
   `gen-verbs-doc --check` OK（27 动词）；漏传门 TS2554 = 0（TS1016 = 8，剥离副产物，同 R3 口径）。
   真机冒烟：`cli.ts flow_list` 退 0、`quality-cli` 对临时项目退 0、`export-cli --flow novel --target mermaid` 退 0、
   `cli.ts up` 起服务后 `GET /` = 200 `text/html` 2200 字节、`/api/projects` 与 `/api/v1/projects` = 200、
   `/.git/config` = 404（白名单在真盘上照样拦）。
9. **未做/挂账（诚实面）**：① 非 FS 族 `node:*` 六处仍在宿主件，「core 包在无 `@types/node` 下 tsc 通过」归 R7；
   ② `schema.ts::ROOT` 仍是宿主字符串（FS1 D3 未解，R7 的真活）；③ `AgentMcp` 的连接缓存仍是进程级
   （按盘分桶只解决「读哪张盘的配置」，跨宿主复用连接的条件归 R7）；④ 工单卡面 P1/P2 的 15 个文件本轮无写集
   （R3 已消化），按卡面重跑就是重复施工；⑤ **R7 那道门禁按字面跑是空转的**——`types: []` 编整个 `src` 实测 0 error，
   因为 fastify／MCP SDK 一路的 d.ts 带 `/// <reference types="node" />`，`@types/node` 传递性进场照样解析 `node:*`；
   六处里 `kernel.ts:577` 的 `createRequire` 还查无调用点（疑似死码）。R7 的门禁已就地改写为
   「import 普查双向死表 ＋ core 包把 fastify/MCP SDK 留在包外做真无 node 编译」，实测三条见工单 R7 段。

**偏离记录**：卡面 vs 盘面共七条（D-R6-1…D-R6-7），全文口径见 `docs/规范-FS抽象层-FS1.md` §六表，此处不抄第二遍
（同一件事在两处各写一遍是本仓的漂移病根）。摘要：P1/P2 无写集／接口扩容两件／`agent.ts` 签名改 kernel／
`agentMcp` → `mcpFor` 分桶／`flow_lint` cwd 与四态返回／非 FS 族六处留 R7／静态面 Buffer 包装。

---

## Unreleased · 工单 R5（FS Phase 2 核验 ＋ SSE 通用化，2026-09-30）

**行为变更两处**（其余为新增面）：① 两条 SSE 流在静默期都会补一帧 `{"type":"heartbeat","ts":…}`——对旧的对话流客户端是
**纯增量**，前提是「未知 `type` 忽略」这条兼容底线不破（仓内两个消费方 `adapter/storyflow-client.mjs`、`storyharness/src/home.ts` 实测都忽略）；
② 对话流的断线检测改挂**响应**（`reply.raw`）而非请求：Node 在请求体读完时就给 `IncomingMessage` 发 `close`，
旧写法让 POST 回合「刚连上就断开」，实测只有 `open` 帧抵达对端——这是 R5 迁管道时实踩并修掉的既有缺陷，不是新引入的行为。

1. **新增 `core/src/sse.ts`（内核 SSE 的唯一出口）**：`sseFrame` / `SSE_FRAME_DONE` / `emitSseEvents(sink, source, opts)`
   ＋ 心跳常量与钳制（`DEFAULT_HEARTBEAT_MS = 10_000`、可调区间 `50`–`30_000`、`heartbeatMsOf()` 非正数/非数字回落缺省）
   ＋ `closeSignalOf(res)`。线格式（`data:` 单字段帧 ＋ `[DONE]` 收口）只在这里抄一份，两条流共用。
2. **新增 `core/src/project-stream.ts`（台账 → 事件投影）**：`JOURNAL_TO_SSE` 是对 `JournalEventKind` 的**穷举** `Record`
   （加第 17 种 kind 不补表就编译不过）；`PROJECT_EVENT_TYPES` 是投影出的 4 种；`projectEvents()` 是事件源。
   投影保留 `event`（台账原 kind）与 `refs`，**不编造 `nodeId`**——事件不许变成第二套真相。
3. **`AgentEvent` 扩 5 种**（`node_start` / `node_complete` / `node_error` / `gate_pending` / `heartbeat`）：
   扩的是盘上已有的那一个联合，**没有新建 `FlowEvent`**（工单卡面的名字，见下方偏离 D-R5-①）。
4. **v1 第 19 条路由 `GET /api/v1/projects/:id/stream`**：`V1Route` 新增 `sse?: true`（handler 返回事件源而非数据），
   `V1Ctx` 新增 `closeSignal`。**流开始前的校验仍回 JSON 信封**（此刻头未发）——项目不存在 ⇒ `404 NO_PROJECT` 带 `meta.route`，
   客户端按 `ok` 分支即可，不必为流写第二套错误处理。`buildOpenApiV1()` 为 `sse` 行产 `text/event-stream` 响应与逐字段事件 schema。
5. **legacy 对话流 `/turn` 迁到统一管道**（卡面第 5 条「行为不变」）：写帧/收口/钳制全部改由 `sse.ts` 承担，
   线格式逐字节不变（`open` 帧在前、`[DONE]` 收口、错误补一帧 `error`），并由 `test/sse-stream.test.ts` 真握手锁住。
6. **台账是事件源，不是进程内总线**：内核每个节点动作本来就追加 `journal.jsonl`，加一层 in-process 事件总线等于第二套真相，
   且跨进程宿主（CLI 起 run、HTTP 在看）收不到。订阅点之前的历史不重放（游标＝台账**行数**，用 ts 会在同毫秒多条事件上漏或重）；
   台账被整本重写（回滚/清场）时重新对齐末尾。重读节拍与心跳**分家**（`LEDGER_POLL_DEFAULT_MS = 1_000`）：心跳保活可以慢，
   事件延迟上限 = `min(1s, heartbeatMs)`；`watchDir` 命中只提前唤醒，**正确性不依赖它**（FS1 §五）。
7. **句柄不泄漏的形状**：泵 `finally` 里只把 `it.return()` **递进**源、**不等**它——异步生成器只在 yield 点处理关闭请求，
   卡在长 await（LLM 请求、节拍 sleep）里的源会让那个 await 永挂并把 HTTP 连接钉死。需要确定性释放的源自己接同一把信号
   （`projectEvents({stopSignal})` ⇒ `finally { cancel() }`），HTTP 面在调用 handler **之前**成型信号并共用。
   回归锁：`watch`/`cancel` 计数各 1（含真 HTTP 握手那条）。
8. **对账脚本扩容**：`scripts/gen-openapi.mjs --check` 现在按 `V1_ROUTES` 逐行校验 200 响应的 **media**
   （`sse` 行必须 `text/event-stream`，其余 `application/json`）——「文档说有、代码没有」的那类坑，面/表/文档三方对账多一根轴。
9. **门禁数字**：`npx tsc -p tsconfig.json --noEmit` **0 error**；`vitest run` **36 文件 / 397 用例**全绿（+2 文件 +13 用例：
   `sse-stream` 10、`fs-call-matrix` 3）；`gen-verbs-doc --check` OK（27 动词）；`gen-openapi --write/--check` OK
   （**19 路由 ＋ 27 动词**，47 个操作）；宿主面普查仍 **9 个文件**，与 R3 收口时逐字相同——R5 两个新文件零 `node:*`。
   卡面门禁「worldbook_search / continuity_slice / kb_search verb 全通」的落点＝`fs-call-matrix.test.ts` 在 `MockFsAdapter` 上跑通三条链并断言宿主盘无泄漏目录。
10. **未做/挂账（诚实面）**：① agent 会话面（含 `/turn`）仍未进 v1 契约，剩下的活是载荷形状（线格式已同源）；
    ② 断线重连的续传（`?since=`）未做，中间断掉那段只能回查 `GET /api/v1/projects/{id}/journal`；
    ③ `run-start`/`run-end`/`verdict`/`rerun`/`snapshot`/`note`/`warn`/`chain-out`/`chain-in` 九种 kind **不投影**，
    是 `JOURNAL_TO_SSE` 里逐条 `null` 的显式表态，扩词汇表归 owner 拍板；④ 多项目聚合流未做。

**偏离记录（工单卡面 vs 盘面）**：

| # | 卡面 | 盘面 | 为什么 |
|---|---|---|---|
| D-R5-① | 「`FlowEvent` 增 5 种」 | 扩的是 `agent.ts::AgentEvent` | 盘上没有 `FlowEvent` 这个类型；`docs/integration/sse-events.md` 早在 R4 前就写了这条提醒。建第二个类型 = 两套事件词汇表必然漂移 |
| D-R5-② | 写集含 `verbs.ts`（VerbContext） | **未动** `verbs.ts` | 事件源选了 journal 台账（见第 6 条），不需要把「发事件的能力」塞进动词执行上下文；真那么做就是内存总线，跨进程宿主收不到 |
| D-R5-③ | 写集含 `kb.ts`（全 FS 化）/`kernel-view.ts`/`minitools.ts` | 三者在 **R3 已迁完**（复普查查无它们） | 卡面按 R1 时的 44 文件普查排的批次，R3 提前合并 P0+P1+P2 已覆盖。R5 补的是**运行时证据**（`fs-call-matrix.test.ts`），不是重复劳动 |
| D-R5-④ | 门禁「规范 §3.2/§4.2 调用矩阵全销账」 | FS1 **没有 §4.2** | 章节号到 §3.3 语义对表，其后是「四、注入纪律」（无子节）。口径按 §3.2 ＋ §3.3，已在 §3.2 末补 R5 复核段说明 |
| D-R5-⑤ | 写集只列 6 个文件 | 新增 2 个文件（`sse.ts` `project-stream.ts`）＋改 4 个（`agent.ts` `api-v1.ts` `http.ts` `gen-openapi.mjs`） | 卡面第 4 条要求「emitSseEvents 通用 helper」——通用件必须有家；投影表与 FS1 §3.2 同理由放独立文件，`http.ts` 排在 R6 批三，塞进去等于把要退役的宿主面当新家的地基 |
| D-R5-⑥ | 「pi-agent SSE 迁到统一 helper（行为不变）」 | 行为不变，但**多修了两处既有缺陷** | ① `req.raw` 的 `close` 在 POST 上过早触发（连接被静掐）；② 源收尾靠 `await it.return()` 会永挂。两处都是迁管道时暴露的，留着不叫「行为不变」，叫「行为不变地坏着」 |
| D-R5-⑦ | — | `worldbookSearch` 的 `expansion[].via` 恒等于同条目的 `id` | 顺手发现、**未改**（载荷形状不属本卡）。语义看着应是「经由哪个命中词条扩展」，而那个信息已在 `from` 里；`via` 目前是冗余字段。归 owner 裁定是修字段还是改文档 |

## Unreleased · 工单 R4（四件套：MCP 资源/提示 + REST 标准化，2026-09-30）

**行为变更两处**（其余为新增面）：① `core/src/mcp.ts` 的自启动守卫由 `/mcp\.(ts|js)$/` 改为 `/(^|\/)mcp\.(ts|js)$/`
——旧正则把 `agent-mcp.ts` 也算成自己，任何以该名运行的入口都会误抢 stdout；② OpenAPI 的形状派生点从 `mcp.ts` 上移到 `verbs.ts`
（`mcp.ts` 转出保持旧 import 面，`core/test/r8-*.test.ts` 的引用不因此断裂）。

1. **MCP 资源面 ×4（新增 `MCP_RESOURCES` 表）**：`wb://{project}/graph`（世界书归纳图全图）、
   `wb://{project}/entry/{id}`（单词条＋全部一跳关系，按 weight 降序、带证据 `src`）、
   `flow://{project}/state`（运行态切片，与 HTTP `/api/projects/<id>/live` 同源同形，走 `kernel.viewLive`）、
   `artifact://{project}/{+path}`（**只读 `registry/artifacts.json` 登记过的**产物正文）。
   注册、`resources/list`、文档、测试四处读同一张表；`LIST_CAP = 300` 超限**不静默裁**，`truncated` 如实标注。
2. **MCP 提示面 ×2（新增 `MCP_PROMPTS` 表）**：`review-worldbook`（分类分布／孤儿词条／缺摘要词条／检索命中＋一跳扩展）、
   `gate-assist`（门悬置时长与凭据、被裁节点生效编排声明、本轮登记产物与完整性结果、旁路诊断、四种裁决后果）。
   两个模板**只摆事实不下结论**（语义判决归评审者对照 `knowledge/rules/`，数值证据只记账不构成打回闸）；
   未开跑的项目返回一行说明而不是抛错。
3. **偏离记录（工单卡面 vs 盘面）**：① 卡面写 SDK 1.7，实装 **1.30.0**（`package.json` 声明 `^1.7.0`），
   API 按 1.30 真实签名落（`registerResource` 四参重载、`ResourceTemplate` 的 `list` 必填位、`registerPrompt` 的 `argsSchema`）；
   ② 卡面写 `wb://graph` 这类前缀名，落地为**按项目寻址的 URI 模板**（世界书/运行态/产物全是项目级数据），
   变量进出走 `encodeURIComponent`，中文项目 id 往返有测试；③ `{path}` 匹配不到带 `/` 的产物路径，改用 RFC 6570 保留展开 `{+path}`。
4. **REST v1（新增 `core/src/api-v1.ts`）**：`V1_ROUTES` 18 条路由 ＋ 统一信封
   `ApiResponse {ok,data,meta{apiVersion,route,at,verb?}}` / `ApiError {ok:false,error{code,message,detail?},meta}`，
   状态码源于错误本体（`ApiError.http` / `KernelError.http`，兜底 500）。
   动词直通 `POST /api/v1/verbs/:verb` 执行前跑 `verbArgIssues()`（zod，派生自动词表）⇒ `400 VALIDATION` 逐条点名；
   legacy `/api/verbs/:verb` **不加校验**（形状已冻结）。
5. **偏离记录（旧路由不做 301）**：legacy `/api/*` 载荷**逐字节不变**，改由 `registerLegacyMarkers` 挂
   `deprecation: true` ＋ `successor-version: /api/v1` 响应头。理由：`POST` 走 301 会被降级成 GET（写操作静默改语义），
   且 legacy 载荷被仓内 **11 个文件**按字段直读（`grep '/api/projects|/api/verbs|/api/openapi'` 命中：`adapter/storyflow-client.mjs`、
   `storyharness/` 多处、`tools/workflow-page-template.html`、`tools/page-lint.mjs`）。
6. **OpenAPI 生成（新增 `scripts/gen-openapi.mjs` ＋ `contracts/http-openapi-v1.json`）**：文档派生自 `V1_ROUTES` ⊕ `VERBS`，
   27 个动词各出一条 `/api/v1/verbs/{name}`（通配符那条做不到 grep 对账），运行时 `GET /api/v1/openapi.json` 同一函数产出。
   `--check` 查四件事：生成物与提交文件逐字节一致／每条路由有对应 method／无表外孤儿路径／动词必填参数进 `schema.required`。
   legacy `contracts/http-openapi.json` 冻结 v1.2 不回改。
7. **修一处共用单点**：legacy `/api/projects/:id/graph` 的 flowId 寻源（state 优先、回落首个可读 flow）上移为
   `resolveProjectFlowId()`，两个面共用；顺带把「state.json 损坏 → 500」改为「回落 → 报 NO_FLOW」，
   让报出来的错是**能修的那个**（记为偏离 D-R4-④）。
8. **文档同步**：`docs/Agent.md`（§一 派生图加 v1/资源/提示；§六 诚实面五行改写；§七 加 gen-openapi 门禁），
   `docs/integration/mcp-reference.md`（新增 六 资源面／七 提示面／八 握手，纪律补两条「不在注册处硬写 URI」），
   `docs/integration/rest-api-reference.md`（新增 二 v1 面四小节，错误形状拆 legacy/v1 两套，九 诚实面），
   `docs/integration/embedding-modes.md`（**销 R3 欠账**：接线状态表 5 行改 ✅，"可嵌入只是接口就位"一句改写为「核心已能在假 FS 上跑通整条 flow，但换宿主仍未齐」）。
9. **测试**：34 文件 / **384 用例**（+16：`r8-verbs` +9 MCP in-memory 真握手，`r8-server` +7 v1 信封与 legacy 零回归）。
   `npx tsc --noEmit` 0 error；`gen-verbs-doc --check` OK（27 动词）；`gen-openapi --check` OK（18 路由＋27 动词）。
   宿主 API 普查仍为 **9 个文件**（R4 新增的 `api-v1.ts` 只经 `kernel.fs/path`，未进名单）。
10. **未做/挂账（诚实面）**：① agent 会话面（含 SSE `/turn`）未进 v1 也不在任何契约——补它要先定 SSE 的 v1 表达，属 R5；
    ② 资源变更通知 `list_changed`/订阅未做（R5 走 `watchDir`）；③ `zod` 被 `verbs.ts`/`mcp.ts` 直接 import，
    但仍是 MCP SDK 的**传递依赖**、未列入 `core/package.json`——拆包（R7）与外部依赖轮（R8）必须显式处理，否则新环境 `npm ci` 后可能悬空。

## Unreleased · 工单 R3（FS 抽象层 Phase 1：内核核心迁移，2026-09-30）

**行为变更**：内核的读写管道全面改走注入适配器（缺省 = Node 适配器 ⇒ 宿主使用路径不变）；
`extractCtxUsage` 新增一条抛错（给了 `root` 没给 `io`）；`decisions`/`journal`/`diag`/`metrics` 的公开签名
由「尾参默认」改为「必传首参 `io`」——**这是 breaking 的内部签名变更**，仓内调用点已全量透传，外部消费者需同步。

1. **注入位落位**：`KernelOptions` 增 `fs?: IFileSystem` / `path?: IFsPath` / `proc?: IProcessLauncher`，
   `Kernel` 上 `readonly fs/path/proc` 三件套；`Kernel` 结构上即满足 `FsIo = { fs, path }`，故台账调用写成 `journalAppend(kernel, dir, …)`。
2. **语义件收编**：新增 `core/src/abstraction/jsonio.ts`（`readJson` / `writeJsonAtomic` / `appendJsonl` / `readJsonl` / `LockDir`，
   尾参 `fs`/`path`），退役件 `core/src/fsio.ts` 删除（无 import 者，`git rm`）——「原子写 + 锁目录」只留一个家。
3. **写集 = P0 + P1 + P2 共 33 个源文件**（工单原排 R3 只做 P0 18 个，提前合并的理由与后果记在 `docs/规范-FS抽象层-FS1.md` §3.2）：
   `kernel*.ts` `state` `registry` `asserts` `minitools` `compat` `kb` `project-config` `assertion-preset/*`
   ＋ `modules` `overlay` `assembler` `aesthetic` ＋ `metrics` `diag` `decisions` `skills` `kits` `optimize` `selection`
   `intent` `cfg-template` `profiles` `production-preset` `journal` `verbs`。三面（CLI/HTTP/MCP）与两个入口桥的动词调用一并改为显式适配器。
4. **台账 io 束化（FS1 §四 第 6 条）**：写路径函数改必传首参 `io: FsIo`，`src`（除 `abstraction/`）内 **104 处调用**全量透传——
   `journalAppend/journalQuery` 58、`recordDiag/readDiags/summarizeDiags/diagPath` 27、
   `readMetrics/recordMetric/metricsPath` 8、`setDecision/listDecisions/decisionsMap/decisionsDir` 11，外加 `syncIntentDecisions`。理由写在 fs.ts 头注：
   尾参默认漏传**编译照过**、台账静默写进真宿主盘；必传首参把这件事交给编译器。
5. **`runAsync` 进 v1**（FS1 §2.2 追加）：`minitools.ts` 脚本壳本就是 `promisify(execFile)`（超时 60s + SIGTERM），
   同步化会冻住 HTTP/MCP 宿主；`ProcResult` 的 `signal`/`timedOut` 与「退非零」分开建模，`verbs.ts` 的 `bridge()` 改吃 `kernel.proc.exec`。
6. **可复现的漏传门**（FS1 §四 第 7 条）：临时剥掉 `src`（除 `abstraction/`）全部 ` = nodeFs` / ` = nodePath` 尾参默认后跑
   `tsc --noEmit`，`TS2554` 即全部漏传点。R3 首轮报 **28 处 / 9 个文件**（`kernel` 6、`verbs` 7、`export-cli` 4、
   `kernel-optimize` 3、`kernel-run` 3、`minitools` 2、`assertion-preset/registry` 1、`kernel-view` 1、`quality-cli` 1），收口时 **0 处**。
   其中 `kernel.ts::ctx` 的 `loadState(projectDir)` 是内存盘冒烟第一条逼出来的——它让 `flow_submit` 直接报「项目无 state.json」。
7. **内存盘端到端冒烟**（新增 `core/test/abstraction-smoke.test.ts`，4 用例）：`flow_run`→`flow_submit` 全程跑在 `MockFsAdapter`
   ＋ `MockProcLauncher` 上——①任务包来自内存语料、②产物/注册表/journal/metrics 全落内存盘且宿主盘无泄漏目录、
   ③跑完语料逐字节不变（只读承诺）、④改内存里的技能卡任务包跟着变（证明**读**也走注入适配器）。假进程 `calls` 为空 = agent 步没起子进程。
8. **规范同步**：`docs/规范-FS抽象层-FS1.md` §2.2（`runAsync` 与 `signal/timedOut`）、§3.1（R3 复普查：`node:(fs|path|child_process)` 文件 44 → **9**）、
   §3.2（实际写集口径）、§3.3（新增 6 行语义对表：`runAsync`/`writeTextAtomic`/`exists+stat` 合并/`remove`/`stat()` 布尔字段/`path.posix`）、
   §四（第 6、7 条注入纪律）、**新增 §六 偏离清单 D1–D8**（含 `schema.ts::ROOT` 仍是宿主字符串、缓存按适配器身份分桶、
   `node:crypto`/`process.env`/console 不在 v1 范围）。
9. 测试 **34 文件 / 368 用例**（+1 文件 +4 用例；`r8-verbs` 的 `fromFlags` 负样本改为真内核——它现在真的读盘）。
   tsc 严格模式全绿；`node scripts/gen-verbs-doc.mjs --check` OK（27 动词逐行一致）。

## Unreleased · 工单 R2（AP1 收尾：断言覆盖 + 预设三级链 + 诊断注入，2026-10-01）

**行为变更三处**（其余为新增声明面）：门点取挂载改走 `Kernel.assertionMount()` 单点；
`applyGatePreset` 的诊断行追加现场证据；`policy.defaultPreset` 参与 `overlayHash` 因而可触发 replan。

1. **三类断言覆盖 patch 进 overlay**（`set-assertion-preset` / `disable-assertion` / `insert-assertion`）：
   契约 `contracts/flow-overlay.schema.json` kind 枚举 14→17 ＋ 新字段 `presetId/assertions/assertion/patch/group`；
   解析 `core/src/modules.ts::effectiveFlow3`（`FLOW3_KINDS` 同步，形状非法→`unsupported`，存在性判定推迟到挂载期）；
   合成 `core/src/assertion-preset/executor.ts::applyAssertionOverrides`——深复制派生挂载（原挂载干净 = 跨项目不污染），
   progressive 计数与原挂载共享同一个 Map，四类「引用不到」全落 `ignored` 并进诊断通道。
   `disable-assertion` 语义定为**免拦人不免检查**：证据留、status 降 warn、不计数。
2. **预设选择三级链**（§九）：`KernelOptions.assertionPreset` > `flow.policy.defaultPreset` ⊕ `set-policy:defaultPreset`
   > `novel-fanqie`；`POLICY_KEYS` 增 `defaultPreset`（非空串校验），`contracts/flow.schema.json` 同步声明。
   坏 id 仍静默不激活 = **无调制**，确定性完整性照拦（预设是调制器，不是闸门总开关）。
3. **诊断摘要注入**（§十）：两处门点写 `state.diagnosticSummary`/`diagnosticFrom`（`run-state.schema.json` 同步），
   `buildTaskPackage` 随任务包下发 `pkg.diagnosticSummary`（`task-package.schema.json` 同步）；
   check_\* 节点摘要按产物前缀路径并落检查报告 `gateSummary`（收据）。摘要行含现场证据，
   三态口径分明：缺省=没走过门点 / 空串=走过但无调制 / 非空=有事实。
4. **规范补写**：`docs/规范-断言预设-AP1.md` 增 §七/§九/§十（设计稿编号，实现先于成文；§八 工单未要求、磁盘无实现，
   编号留空不虚构），并显式标注两处偏离设计稿：`applyAssertionOverrides` 返回 `OverrideReceipt` 而非裸挂载、
   `defaultPreset` 走既有 `overlayHash` 指纹不豁免 replan。
5. 测试 33 文件/364 用例（+20：`core/test/ap1-override.test.ts` —— 执行器合成 8 项、编排解析 5 项、
   端到端三级链与注入 7 项；验收线「阈值提高后同输入不再 block」在 e2e 可见）。
   tsc 严格模式全绿；R1 四门禁复跑不变（`gen-verbs-doc --check` OK；`abstraction/` 外 `node:*` 仍 44 文件）。

## Unreleased · 工单 R1（FS 抽象层 Phase 0 + 集成文档四件套，2026-10-01）

**零行为变更**：本轮全部为新增文件，内核现有代码一行未改。

1. **FS/进程抽象层接口落库**（`core/src/abstraction/`）：`fs.ts`（`IFileSystem`/`IFsPath`）、`proc.ts`（`IProcessLauncher`）、
   `adapters/node.ts`（原子写沿用 `fsio.ts` 语义）、`adapters/mock.ts`（内存实现，带 errno 形状异常）。
   接口方法集由调用面普查反推，规范：`docs/规范-FS抽象层-FS1.md`（含 §3.2 迁移矩阵——修正了工单 R3/R6 的文件计数，
   并点名工单未列的 `agent-mcp.ts` `export-cli.ts` `journal.ts` `quality-cli.ts`）。
2. **`IFileSystem.watchDir` 进 v1**（拍板点①）：为 R5 的项目级 SSE 预留，缺省 `persistent:false`，正确性不得依赖 watch。
3. **集成文档四件套**：`docs/Agent.md`（入口 + 生成动词表）与 `docs/integration/{mcp-reference,rest-api-reference,sse-events,embedding-modes}.md`。
   三份文档如实标注现状缺口：MCP 无 resources/prompts、REST 无 `/api/v1` 与统一包装、SSE 只有 agent 对话流、
   **抽象层尚未接线**（`KernelOptions` 无 `fs/path/proc` 注入位，R3 才注入）——"可嵌入"目前是接口就位，不是能力。
4. **动词表文档生成器** `scripts/gen-verbs-doc.mjs`（`--write` / `--check`）：文档成为动词表的第四个派生面，
   `--check` 入门禁。经 core 自带 tsx 直读 `core/src/verbs.ts`，无需先 build（`MINIFLOW_VERBS_FROM_DIST=1` 走 dist）。
5. 测试 32 文件/344 用例（+17：`core/test/abstraction-mock.test.ts` —— mock 自测 + Node/mock 同语义对表 + proc 脚本化），
   tsc 严格模式全绿；`abstraction/` 之外 `node:fs|path|child_process` 文件数不变（44）。

## 0.10.0 · 断言预设 AP1 + 生产线预设 PP1 + 跨流水线级联（2026-09-30）

1. **kernel.ts 拆分**：2280 行单文件 → 489 行门面 + kernel-run/optimize/view/config/base 五文件（free function + kernel 显式传参，公开 API 零变化；KernelError 独立 kernel-base.ts 防运行时环）。
2. **Assertion Preset（AP1）**：断言预设四层架构（discovery/registry/mount/composition，core/src/assertion-preset/）——gate-preset.yml 声明断言分组、gate 行为（warn-only/block-critical/strict）、progressive 渐进阈值与条件启用；接入 doSubmit 提交链与 check_* 节点两处门点；随包 4 个系统预设（novel-fanqie 缺省/screenplay-audio/prose-light/minimal）；when 条件求值器为无 new Function 的安全子集。
3. **Production Preset（PP1）**：生产线预设 presets/<id>/（manifest + overlay.<flowId>.json）——flow_run(opts.preset) 选线、state.preset 持久、生效编排 = flow ⊕ 出厂 overlay ⊕ 预设 overlay ⊕ 项目 overlay；set-module 新增 remove 语义（模块实例裁剪，连接按剩余序重派生）；drama 模块注册 render-prompt-seedance op；随包 5 个预设（web-novel/screen-play/world-bible/comfyui-script/short-story）。
4. **flow_chain 跨流水线级联**：源项目产物确定性搬运到新项目 00-素材/（sourceMaterials「在盘即声明」语义），显式输入开跑目标流水线，双边 journal 接力留痕（chain-out/chain-in 新契约枚举）。
5. 新依赖：core +js-yaml（预设文件解析）。测试 31 文件/325 用例（+27），tsc 严格模式（含 noUncheckedIndexedAccess）全绿。规范文档：docs/规范-断言预设-AP1.md、docs/规范-生产线预设-PP1.md。

## 0.9.0 · 推演回归 + 两条运行时接线（2026-09-30）

1. **推演模式随包回归**：packs/deduce（galgame 点点点剧情推演，engine/pages/templates/tools 四件）——挂载表自动装载，/deduce 即玩；模板项目 template-推演 随包（首写落地）。
2. **Skill 即 Tool 装载**：执行环读 kit/skills.tools.json，40 技能以 skill_<slug> 工具进 agent（版本+约束在描述，调用返回源卡全文；缺卡报缺）。
3. **HyperGraphRAG 装载**：kbSearch/kbRead 优先走 kit/hypergraph.rag.json 编译图（115 词条/5998 边）；缺图回落扫盘；缺源卡带指引报缺。
4. 行为修复：配置内联 apiKey 优先于环境变量；模型侧 stopReason=error 透出为 error 事件（不再空气泡）。
5. core 测试套迁移收口（flows 用途化/acceptance 可选化/夹具 test-dual），298/298；storyharness 94/94（+packgate 11、kit-wiring 3）。

## 0.8.0 · 故事 Kit 重构（2026-09-29）

定位改版：**轻量、可玩性高的故事 kit 提供者**，与创作工作区彻底解耦。

1. flows 按用途归一：screenplay / novel / prose / topic 四条（删除主题流与项目细节）；demos 全删。
2. 运行时精简：判官层（judge.ts + 证据/回喂链路 + judge 子命令 + 配置段）整体移除；
   module io.acceptance 验收约束层移除；detect 检测模块移除——审核归宿主（docs/PROTOCOL-REVIEW.md 三通道接入）。
3. Skill 即 Tool：kit/skills.tools.json（40 技能 → skill.* 工具：名称即功能+版本+约束），tools/kit-skills.py 编译。
4. knowledge 层改为发布编译产物 kit/hypergraph.rag.json（115 词条/5998 边 HyperGraphRAG）；源 md 不进 git（本地可插拔），tools/kit-compile.py 重建。
5. 新增 adapter/ 适配层：REST+SSE 接口协议 + 零依赖参考客户端 storyflow-client.mjs（浏览器/Electron/移动端同构）。
6. flow id 变更：drama-flow→screenplay、novel-longform→novel、novel-prose→prose、topic-selection→topic（headless 默认 screenplay）。

# Changelog · miniflow harness

版本唯一事实源：仓库根 `VERSION`。格式参考 Keep a Changelog；R1..R8 历史代际摘要附于 4.0.0 条目。

## [5.0.0] · 2026-09-21 · v5.0 工单：断言体系退役与规则语料化（agent-only 执行模型）

拍板（2026-09-21 用户指令）：「确认不用的全部干掉，疑似有用的喂给 orchestrator 当做语料，未来我只用 agent，不用断言。」宣告文档：`docs/版本宣告-v5.0.0.md`（含 90 条去向总表 = 工单 §二 正式版；批0 盘账：全库 journal 真正打回过东西的断言只有 2 个 id 共 7 次，25 条以「无机器校验器」名义空转 170 次 warn）。**废除对象 = 断言协议（声明式提交闸 + pass/block/unverified 三态裁决 + node/op `asserts` 字段），不是检查能力**：可数的 27 条转扫描器证据（T 轨），不可数的 50 条转规则语料（C 轨），13 条随红蓝对抗/监管残族删除（X 轨）。

### Added（批A · 先立）
- **`knowledge/rules/` 规则语料库**：C 轨 50 条 → 16 张域卡（hook/pacing/curve/character/conflict/scene/reversal/dialogue/visual/ending/ai-trace/deconstruct/continuity/meme/setting/platform），`tools/rules-init.py` 从台账生成、原文零改动、卡头 `provenance.refs` 记来源 id 可回溯；措辞去闸化（「判 block」读作优先级，不构成拦截）。
- **质量扫描工具链**：`tools/quality-scan.py` + `core/src/quality-cli.ts` 桥（复用 `aesthetic.ts` 全量扫描器，JSON findings + 退出码恒 0——证据工具无权裁决）；内核 minitool `scan_quality`（原 `check_aesthetic_asserts` 改造：照跑全量、只出 `内部/质量扫描-*.json` 收据不拦截；空扫描 journal 显式留痕「非质量通过」）。
- **module@1 验收面新契约**：`io.acceptance.{scans,rules}`（扫描器 id + 规则卡 id），取代已退役的 `io.acceptance.asserts`。
- 演练：p-yaomo-fx-001 agent-only 验收样例（批A-3）。

### Changed（批B · 后破）
- **提交链无断言闸**：`core/src/kernel.ts::flow_submit` 删除 `runDeclaredAsserts` 三态派发与 对外交付/ 引擎全量闸——唯一残留闸 = 确定性完整性（`runIntegrityAsserts` 存在性/空文/残渣/计数 + `runHeaderAsserts` 头部 + 词汇表守卫）；`core/src/asserts.ts` 三态裁决层整层下架（`checks_via` 别名转译随之消失——扫描器直接报真名）。
- **指标更名**：`RunMetric.asserts` → `checks`；汇总 `assertPass/assertBlock` → `checkPass/checkBlock`。打回成本口径（block×溢价+retries×2）算术不变，只是打回只剩完整性来源。
- **数据层清扫**（一次性迁移器 `tools/asserts-retire.py`，逐条回显）：`flows/*/flow.json` 与 `modules/*/module.json` 全部 `asserts` 字段/引用删除，`check_aesthetic_asserts`→`scan_quality` 改名（9 条 flow / 9 个模块）；`contracts/flow.schema.json` asserts 出白名单。
- **守门反转**：flow-lint `E-ASSERTS-RETIRED`（flow.json/出厂 overlay 出现 asserts/add_asserts/remove_asserts = error）、module-lint 同名规则 + kit-lint `E11`（overlay 补丁带退役断言字段即 error）；kit-lint「断言覆盖」账改挂「规则语料与扫描器台账」（v5.0 台账：规则卡 16 张 / C 轨 50 条全覆盖 = error 级；T 轨 26/27 有实现，缺口 W4 点名 AE-NAT-HIT 不静默）。
- **前端 v5.0 面**：`tools/workflow-page-template.html` 验收区改「扫描/规则」证据 chips +「机器只出证据，裁决归 agent 与端尾验收」；历史项目数据只在生成器单点归一（`tools/project-pages.py`：`assert`→`check`、`unverified`→`warn`、标 `legacy` 并在页面显式标出历史口径——面板零双名兜底，R4 §5.3 不破）；`tools/page-lint.mjs` 新增四账（op 带 asserts / acceptance 形状非 `{scans,rules}` / 非 legacy 模块报告检查名以 AE- 开头 / nodeInfoPaper 泄 asserts = FAIL）。
- **测试改写**（批B-4）：`r5-generative.test.ts`「声明断言必须被执行」套件换 v5.0 回归锁（扫描器 block 级产物提交照收；残渣违规照样打回且 problems 零 AE- 名、落 `checks.block`；`scan_quality` 收据 `mode:quality-evidence`、无 declared/unverified 口径、有 block 证据不判败本步）；WO-A 五用例改 `runAestheticAsserts` 直调（密度真名/章末钩三态/伏笔逾期/纯净度/禁不可拍摄）；`kits.test.ts` 断言台账套件改锁归档（90 条无重复、引擎 id 全在册、`io.acceptance.scans` 逐条可回溯归档、checks_via 目标在册）。

### Removed
- X 轨 13 条：红蓝对抗残族 6（AE-RED-*/AE-PR-*）＋监管/评审步残族 3（AE-OVER-*/AE-ROUTE-EXCLUSIVE）＋随协议作废元条款 4。`unverified` 态自此不存在。
- **断言台账退役归档**：`knowledge/aesthetic/assertions.json` → `projects/_archived/assertions-ledger-v5.0.0/`（只读原件 + README，规则卡与 kit-lint 台账都从它回溯）。
- 一次性迁移器 `tools/asserts-retire.py`、`tools/asserts-retire-kb.py`（批C 收口退役；幂等复跑实证仅 1 处命中 = minitools.json 里「原 check_aesthetic_asserts」溯源注记，非活引用）。

### 记账（批C · 文档与版本）
- `AGENTS.md`：版本治理行 + 铁律 3/9 去「断言」措辞、K1 补「质量条款的家 = 规则语料 + 激活制」、能力注册表工具链改口径、新增「质量证据工具链（v5.0）」条、前端消费纪律字段清单更新（`io.acceptance{scans,rules}`）、R5「声明即契约」→「证据即收据（报数必附收据，铁律10 升级）」、「R5 存量记账」→「v5.0 断言退役收口」。模型档位纪律、人工裁决边界未动（工单 §三 明令）。
- `docs/规范-生成式flow与运行时编排-R5.md` §4.1 就地标退役 + §十 销账；新增 `docs/规范-规则语料与orchestrator激活-v6.md`（编号顺延）；`flows/README.md` 断言口径清扫；`docs/版本宣告-v5.0.0.md`（90 条去向总表由 lintlib 口径单点生成）。

### 门禁（v5.0.0 收口实测）
- vitest **281/281** 全绿 + `tsc --noEmit` 0 错；flow-lint 9 flow **0E**/7W；module-lint 9 模块 **0E**/34W；kit-lint **0E**/41W（含 W4×1 AE-NAT-HIT 显式账）；page-lint 70/70（p-yaomo-fx-001 重生成页）。
- 工单 §四 批B 验收口径：`flow_submit` 链上 grep 不到任何 AE- 字样（kernel.ts/asserts.ts 源码 0 命中；打回回归锁断言 problems 无 AE- 名）；flows JSON 残余 AE- 全部 confined 于 changelog 历史条目与 0.3.0/3.1.0/6.0.1 口径声明（逐文件 JSON 路径核账）。

## [4.2.0] · 2026-09-21 · 工单批D：kit@1 清场（能力唯一事实源 = modules/）

宣告文档 §五 批D 落地：`kits/` 四域 kit.json 删除、kit-lint 由「只提示迁移」转阻断门禁、三个 kit 迁移器退役。module@1 自此是能力的唯一之家（铁律11），协议字段名 `kit`（节点 `kit`+`op`、`ResolvedOp.kit`、`kitRef`）保留不动——已冻结的引用协议，值域现为模块 id。

### Changed
- **装载器单源化** `core/src/kits.ts::KitRegistry`：删除 `kits/` 目录扫描块（原「kits 先装、modules 按 id 合并、kit 为既有权威」的双源逻辑连同 WO-03 同 id op 级补缺一并消失）；`modules/*/module.json` 成唯一装载源，模块即权威。归一化补 `minitools`（数组，此前只认单数遗留键致 30 个机器件的执行体声明被静默丢弃）与 `exclude_knowledge`。
- **kit-lint 转阻断 + 事实源切换** `tools/kit-lint.py`：数据源 `kits/*/kit.json` → `modules/*/module.json`，删 legacy 对照模式的 E 级降级（error 自此真阻断、exit 1）；删 format/domain 轴检查（模块无 kit@1 四域轴）与 assist 校验（该字段随 kit@1 退役，内核无消费方）。
- **跨模块重复技能 E6→W8**：`scene-breakdown` 合法双家（plot 骨架步 + drama 主工具）。铁律11 是「必有 ≥1 家」而非「至多 1 家」，flow@3 派生节点一律携 kit+op 显式引用、bySkill 反查仅兜底，歧义无害但须记账。
- `core/src/schema.ts`：`"kit"` 从 `SCHEMA_IDS` 除名（`contracts/kit.schema.json` 只读留档）；`tools/project-pages.py::kits_summary_build` 去 kits glob。
- 7 个 flow 无改动（flow@3 派生节点早已引用模块 id，批B 起 `kits/` 对活流程即惰性遗产）。

### Added
- **`planned` 占位契约**（`contracts/module.schema.json` + `tools/module-lint.py`）：铁律11「能力必须有家」的诚实形态——`planned:true` 豁免 `E-MINITOOL-IMPL`、显式记 `W-PLANNED`（占位可见，不冒充有实现）。三件落位：`docx_ingest`→delivery（批注回流）、`continuity_check`→base（连续性校验）、`meme_harvest`→topic。planned 件用**独立 capability**，绝不与现役 agent 步共享 cap（否则 caps 自动拉入生产编排并在首节点 block 整条流——meme_harvest 曾误挂「时代情绪锚」致 topic-selection e2e 全红，已改判为「热点采集」）。
- 三个悬空 cap 自此有主：delivery「批注回流」、base「连续性校验」、topic「热点采集」。
- `exclude_knowledge` 迁入 module@1 契约（module-lint E-KB-UNKNOWN 核对 + 装载器消费）。

### Fixed
- **find-trope 注入收窄回归**（批D 排查中定位并修复，非「报告后搁置」）：批A 前真正生效的标尺装载源是 `kits/search`，其 find-trope 带 D1-D5 落地的 `kb/market/brief-four-questions` + 三张 `na-*` 海外梗卡剔除；`modules/topic` 副本无这两字段。清场使 modules 转唯一权威 = D1-D5 收窄静默回归。修复：字段随迁 `modules/topic`（`caliber.test.ts` D4 断言转绿，改指 `topic`）。
- **装载器丢机器件执行体**：`ops.*.minitools` 数组此前不被读取（只认单数 `minitool`），30 个机器件的执行体声明在装载层被吞；补数组形态与 `script`。
- **`project-pages.py` 陈旧 effective 崩页**：`registry/effective.json` 的 composition 实例不在 `flow.modules`（如 drama-flow 的 m4 delivery 已收）时 `next()` 抛 StopIteration → 整页崩。改为按「无 caps 请求」渲染该实例工具箱并显式回显 stale 警告（p-slj-002/003 复跑实证）。

### Removed
- `kits/` 五域 kit.json；`tools/kit-migrate.py`、`tools/kit-config-init.py`、`tools/flow-kit-apply.py`（kit@1 迁移三件套，仅自身与 AGENTS/R5 文档引用）；`modules/base` 的 `flow-kit-apply`/`kit-config-init` 两个已退役脚本壳 op。`assist` 字段口径退役（记账）。

### 记账
- 权威规格就地改写：`AGENTS.md`（版本治理行 / 铁律11 / K1 装载 / 能力注册表工具链 / R5 工具链 / R5 配置可调条款，`kits/` 字样清零）；`docs/版本宣告-v4.0.0.md`（§二 工种工具箱行、§三 规则3、§四 处决清单#9、§五 批D 全标闭合，含 spine-less 落位定案）；`docs/规范-生成式flow与运行时编排-R5.md`（状态行去 kit-config-init、适用范围/§二 配置源切 modules、§九 工具表补 planned/W8）；`docs/规范-模块化flow与工具箱-R6.md`（§十一 勘误新增 #17 无骨架工具箱落位口径、#18 planned 占位契约、#19 kit@1 清场回写）。
- **base 无骨架模块落位口径定案**（原记「缺口归批D」）：`spine=[]` 工具箱模块不靠 caps 落位（无锚=module-lint E-PLACE），改用实例 `insert:{"end":[…]}` 显式有序启用；`expandFlow3` 的 `explicitInsert` 路径本就支持，内核零改动。
- 门禁：tsc 0 错；**vitest 271/271**（含 kernel.e2e / r5-generative / r7-runtime 三套内核端到端——modules 单源装载下 flow_run/link 门/buildTaskPackage 全绿，即批D 运行时验收）；flow-lint 0E/2W；kit-lint 0E/42W（阻断口径）；module-lint 0E/34W（含 3 条 W-PLANNED）；validate-kb 通过（90 断言）；12 个项目工作台页重生成 + page-lint 全 exit 0。

## [4.1.1] · 2026-09-21 · 工单批C：断言台账收敛

宣告文档 §五 批C（断言台账收敛）落地；权威规格行同步销账（R5 §十 #2/#3/#4/#5）。

### Changed
- **断言标识字段统一单名**：`knowledge/aesthetic/assertions.json` 条目 `asserts[].id` → `name`（与引擎 `Validation.name` 同名；「两套命名=漂移」就地根除）。方向选择：引擎侧字段不动——`name` 已持久化进各项目 `registry/artifacts.json` 与 metrics，改名即旧数据静默变 unverified，双名兜底又违 R4 §5.3。消费方三处随迁：`core/src/asserts.ts::checksVia`、`tools/kit-lint.py`、`tools/validate-kb.py`。台账版本 1.0.0→1.1.0（90 条）。
- `kit-lint.py`：AE-EXISTS/AE-SKIP-NON-BEAT 不再从引擎集 discard（已作为 dim=meta 路由裁决入册）；「断言缺口」分母改质量条款集（meta 不摊派 op 覆盖）。

### Added
- 补登引擎 3 个 id：`AE-CH-LEN`（多章正文每章 CJK 下限，prose/block）、`AE-EXISTS`（产物缺失入口守卫，meta/block）、`AE-SKIP-NON-BEAT`（非拍级豁免显式回显，meta/minor）——引擎 14 个 id 自此全量在册。
- `kits.test.ts` 台账体检 3 项：标识字段只有 `name` 且无重复；引擎发出 id 全在台账；`checks_via` 别名目标必须真实在册（别名指虚空=声明链静默降级）。

### Fixed
- `tools/validate-kb.py` 读 `asserts[].id` 随字段更名失联（KeyError→改 `name`）。

### 记账
- AGENTS.md「R5 存量残留」行改写为 v4.1.1 收口口径（活账只指 kit-lint 实时输出，文档不抄数）；`docs/规范-生成式flow与运行时编排-R5.md` §十 #2/#3/#4/#5 销账（划线+闭合依据）；`docs/版本宣告-v4.0.0.md` 断言台账行转「已收敛」。
- 门禁：tsc 0 错；vitest 270/270；kit-lint 0E（「未登记断言」警告清零，42W→41W）；flow-lint 0E/2W；module-lint 0E/34W；validate-kb 通过（90 断言）。

## [4.1.0] · 2026-09-21 · 工单批A+批B：flow@3 唯一格式落地

宣告文档 §五 工单批A（存量迁移，commit 6768c0a）与批B（代码层处决）合入本版本；flow@1/@2 手画图与兼容分支自此彻底退场，flow@3 成为唯一可执行 flow 格式。

### Added
- 内核修复：`advance` 全部调用点（flow_next / submit / gate / rerun / resume）改为只吃盘上原始描述符（flow@3 `raw`），不再把派生图当 bootstrap——修复了每推进一次读模型便静默降级一次的系统性错位（links 清空、项目/出厂 overlay 丢失、link 门被 itb-* 边界假门顶替）。
- 回归测试 `kernel.e2e.test.ts`：读模型不因推进动词降级（推进后 registry/effective.json 仍含 4 links、5 composition、无 itb-* 假门）。
- `format.test.ts`：flow@1 字符串谓词处决断言（非对象谓词一律不活跃、不解析嗅探；嵌套 any/all 内层字符串同样拒绝；role 单值判别）。

### Changed
- 7 个 flow 存量迁移至 flow@3；7 处残留 `gate` 评审步随批A拆除（人工裁决收敛到 `gate_role:"kit-boundary"` 跨域交接门）。
- `core/src/cond.ts`：`edgeRole` 只看 `role`（flow@1 optional/loop 布尔折算删除）；`evalWhen` 非对象谓词直接判不活跃并给出「已处决」理由，`evalLegacy`（32 行字符串求值）与 `isLoopEdge` 别名删除。`core/src/types.ts`：`WhenPredicate = StructuredWhen`，`FlowEdge` 不再声明 transform/optional/loop。
- `tools/flow-lint.py`：E-FORMAT 文案改为处决公告（指向 R6 §八 手工重建，不再指向迁移工具）；`skeleton-lint.py` 口径同步。
- 前端镜像 `tools/workflow-page-template.html`：edgeRole/evalWhen/whenText/LEGACY_CANVAS 与内核同语义；`page-lint.mjs` 新增「边 when 全部结构化」探针。
- `contracts/flow.schema.json`、AGENTS.md（版本治理 / R4 工具链 / R5 工具链）口径同步：flow@2 手画形态已处决，一次性转换工具退役。

### Removed
- `tools/flow-normalize.py`（796 行）、`tools/flow-v3-migrate.py`、`tools/r5-migrate.py` 三个一次性迁移器删除；`modules/base/module.json` 与 `kits/tool/kit.json` 中对应 op 登记同步移除（flow 工具能力仍由 flow-lint/flow-verify 承载）。
- 测试契约随迁：`flows.test.ts` 断言唯一合法格式为 flow@3；`plan.test.ts`/`kits.test.ts` 夹具改标 flow@2→派生只读。

## [4.0.1] · 2026-09-21 · 远端兜底落地

### Added
- 远端 `origin`（github.com/skkbsgzf/storyflow，私有）＋ 镜像工具 `tools/push-mirror.py`：断链历史经确定性重写后推远端（本地 ref 不动，新旧 SHA 映射表在 rescue 目录）；机制与硬事实见事故留档 §7.4。
- replace 桥 #2：`f424b336 → 990352c9`（替身根提交），本地 `log --all` 全量遍历不再中断。

### Fixed
- 缺失 blob `187bb1eb` 定位为 R6 规范文档 09-18 17:20 版；镜像行以诚实占位符替代，本地原状保留。

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
