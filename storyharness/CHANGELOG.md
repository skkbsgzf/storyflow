# StoryHarness 变更记录

## 未发布

- **fallback 回落桥改显式配置**：`cfg.fallback.command` + `cfg.fallback.script` 都配置才启用 python 非流式兜底；未配置时流断直接报「未配置 fallback 桥」失败，不再隐式借用 `D:/storymasterv4` 路径（v4 已归档）。需要桥的部署把这两项写进 `.external/storyharness.json`（`script` 相对 workspaceRoot）。

## 0.7.2 · A 组波 10：路线二视觉对标 pi-web（设计令牌 / 消息语法 / 工具胶囊 / 密度 / 两栏拖宽 / 统计位 / 状态行 / 轮级导航 / 文件树迁左）（2026-09-29）

依据 `docs/WO批次-storyharness波10-路线二视觉对标piweb-20260928.md`。「路线二」= **只搬 pi-web 的设计令牌值、布局几何与消息显示语法，不搬它的栈**（无 Tailwind v4 / React 19 / Next SSR / node-pty / Catppuccin SVG），逐处保留出处（MIT，Copyright (c) 2026 agegr，https://github.com/agegr/pi-web ，快照 `ui/refs/pi-web/globals.css`）。A14→A23 按序全落，零协议改动，**判据仍只看「pi-web 有的效果这边看不看得见」**。B 组与 C5/C7 拍板不在本版；**C5/C7 拍板前 8431 仍不得对外暴露**。

- **A14 设计令牌与五主题**：新建 `ui/src/styles.tokens.css`（唯一事实源，零依赖手写 CSS）——三层规矩写死在文件头：**语义令牌只在这里给颜色**（组件只写 `var(--text-muted)` 这类语义名，不许出现十六进制）、**旧名保留为别名段**（盘上 402 处 `var(--旧名)`，A14 不做全量改名，别名是过渡层）、**档位白名单在 `lib/store.ts` 的 THEMES**（这里加一个 `[data-theme=…]` 那边必须同步，否则存进来的假档位被白名单拦掉而这里默默不生效）。五档取舍：pi-web 的 light/dark/mist/rose/pine 五档里，我们的 `paper`（纸）/`ink`（墨）是品牌色且 paper 仍为默认，`dark`/`pine` 与 ink 同路数不并列，故只引进 **light/mist/rose** 三档新皮（`tokens` 名与 mist/rose 取值搬自靶子）。`lib/themes.ts`+`test/theme.test.mjs` 钉档位切换与持久化。
- **A15 消息显示语法**：`components/chat.css` 按靶子几何重排——助手正文**无气泡边框、整幅撑满内容列**（`--chat-content-max-width: 820px`，令牌值即实测 maxWidth），用户条仍是浅底胶囊；代码块/表格/引用块的字重与留白对齐。
- **A16 工具胶囊**：`components/Chat.tsx` 里的 `.tcard` 折叠态收成 999px 胶囊（状态判定单点 `lib/toolCard.ts`：在途/成功/失败/未知四态，未知显式点「·」不空白），展开态 `pre` 限高滚动；`lib/writeTools.ts` 的写类白名单继续是产物芯片的唯一来源。
- **A17 控件密度**：字号/行高/留白三档令牌化（正文 15px·行高 1.75 桌面 / 15px·1.75 移动，次级 11.5–12px），并把「密度」这类观感量交给 DOM 断言而不是人眼印象。
- **A18 两栏可拖宽**：`lib/panelLayout.ts`（取值域单点：侧 180–480 默认 260；右 300–1200，默认＝视口 42% 夹在 360–640；`clampPx/clampSide/clampRight/rightDefaultFromViewport/readWidth/widthFromDrag/nudgeWidth`，键名 `sh.layout.side|right`）+ `components/Resizer.tsx`（pointer 拖拽途中只改 signal、抬手才落盘；←/→ ±16px；双击回默认；`role=separator`+`aria-valuetext`）；`.resizer` 视觉 1px／命中 7px 用负 margin 回补，**未拖时三栏宽与 A14 令牌默认完全一致**；移动态一条都不渲染。
- **A19 列顶统计位**：`lib/sessionStats.ts` 新增 `colStats(s)` → 五位 `↑ ↓ ⭘ 成本 ▨`（缺数一律字面「查无」，估算口径带「（估）」，`s===null` 返回空表让组件显「读取中」而不是渲染五个 0）；取数 effect 从 `.topbar` 发起（原来只有轨迹页挂载才拉，**对话页插座是死的**）；`MetricsBar` 去重——同一屏不许两张脸，删掉上下文与累计两颗，只留本轮＋压缩明细。
- **A20 输入区状态行下移**：`.modes` 从 textarea 上方挪到发送键下方（引用行→输入框→发送→状态行），提示语与档位入口随迁；`.modes` 单行、放不下走横向滚（禁换行挤压）。
- **A21 轮级导航（ChatMinimap）**：`lib/minimap.ts`＋`test/minimap.test.mjs`（buildMinimap 纯算法：按 `.msg.user` 归轮、取用户前几行、工具徽标计数）＋`components/ChatMinimap.tsx`（右缘 12px 转轮 + hover 浮出 320px 面板；**刻度数＝轮数**，不是硬编码几颗装饰；点条目按 `data-msg` 找落点，目标被 tail 分页挡住时先补页再滚）；`<960px` 整条不渲染，判定收在 `hooks/useIsMobile.ts` 的 `MINIMAP_MQ` 单点（手机上没有 hover，装了就是看不见也点不着的死角）。
- **A22 文件树迁入左栏 + 清单单一来源**：`lib/store.ts` 收为唯一事实源（`fileRows/filesError/filePaths`(computed)/`previewPath` + `loadProjectFiles()`）——原状是 RightPanel 私存一份清单、Chat 的 `@` 提及再拉一次、两个 8 秒轮询各走各的时钟，**同一份盘上文件两套真相**（`@` 里能补全的新产物在文件树里还是旧的）。新建 `components/FileTree.tsx`+`filetree.css`：树住左栏 `.side-scroll` 下半部（对标靶子 EXPLORER 位），跟盘轮询归它一家且只在页面可见时跑，行 title＝「全路径 · 大小 · 时间」，点行 `jumpToFile`，高亮跟 `previewPath`；`lib/fileKind.ts` 的 `KIND_GLYPH` 用字形占位（▤ ◩ ▨ ♫ ± ≡ ◆）而不搬 Catppuccin SVG；RightPanel 删自有清单与分组/格式化函数、「文件」页签降级为纯预览面；Chat 的 `@` 候选改读 `filePaths`。行类名沿用 `.fdir/.frow`（既有 CDP 与 page-lint 的命中面，改名等于抹掉上一批验收线）。
- **A23 收口（本版）**：全量复跑（终轮 base 改为本会话自起的**私有实例 8455**——8431 用户实例跑到一半下线，同一份 dist 与同一份 workspace 数据，跑完即关）：`test:ui` **276/276**、`tsc --noEmit` 0E、`vite build` CSS 34.69 kB（gzip 7.70）／JS 109 kB（gzip 40.60）、`page-lint-ui` 工作区全表 **23/23**（17 选择器＋6 内置；表新增 `.explorer/.fdir/.frow/.mode-chip/.colstats`，**`.turnfiles`/`.tf-chip`/`.minimap` 三条会话条件面移出强制清单**，口径见下条坑④）、首页默认表 **9/9**、移动首页 **8/8**；CDP 十一张全过——`filetree` 16、`minimap` 12（含 1 条前置「进到多轮真会话」）、`colstats` 13、`msg` 24、`layout` 14、`theme` 16、`palette` 11、`qstick` 10、`mobile` 28、`export-actions` 17、`sw` 8。**本波未复跑**：`conn`/`auth-shell`（要闸内实例＋口令，8455 没开鉴权），沿用波 9 数字但不记在本波账上。逐条输出与未决见 `docs/收据-波10A21-A22-20260929.md`（A14/A15–A17/A18–A20 各自的交单收据同目录）。
- **验收脚本自身修的四个坑**（都属「量错信号会把对的实现判成失败」）：① `page-lint-ui.mjs` 原来在 `--remote-debugging-port=0` 下把「子进程退出」直接判环境问题，而本机 Edge 走 compat-layer relaunch——被 spawn 的进程打印完端点就 `code=0` 退出、真浏览器换 PID 重开，于是整条报「浏览器提前退出」而机器上明明有个活着的 headless 浏览器；改为自己挑空口把端口写死＋端点双路认（子进程 stderr 与轮询 `/json/version`）。② `filetree-check.cjs` 的折叠断言原用 `getClientRects()` 量 closed `<details>`：Chromium 现在以 `content-visibility:hidden` 实现收起，行盒仍返回非空 rect；改量「组高 + `el.open`」（实测 187→26→187px）。③ `export-actions-check.cjs` 的复制断言原来固定挑最后一条 assistant 正文，本轮那条只有 2 个字且无行内代码 → `mdSrc` 恒 false 的假失败；改为优先挑正文含 `code/pre` 的那条并回显 `hasCode`。另：`colstats-check` 的 A20 第⑨条从「必须四颗胶囊」改为认「档位入口在场（一颗 chip 或四颗胶囊）＋提示语在场」，`export-actions` 的 A7⑦ 从只认禁用占位改为两态都认（禁用须点名工单、可点须写明语义，唯独入口消失算失败）。④ **page-lint 的「首行会话」是个会变的被试**：`--click .srow` 只点侧栏第一条会话行，而首行是谁新建的没人管——0929 复跑时首行成了一条单轮 0 写出的新会话，于是 `.turnfiles`/`.tf-chip`/`.minimap` 三条同时假失败（三者按定义只在「这一轮真写出过文件」/「会话 ≥2 轮」时才挂载）。探针实证：换到多轮真会话上三者全在场（2 块、每块 1 颗胶囊、标签「本轮写出 1 个文件」）——**不是回归，是量错了信号**。处置=这三个选择器移出 page-lint 强制清单，改由 `msg-check.cjs`（本波补 2 条：每块「N 个文件」的 N 与胶囊颗数逐块对账、胶囊 title 是全路径）与 `minimap-check.cjs` 在自己进到的多轮真会话上钉；page-lint 只留「进了工作区必定在场」的面。
- **实测**：见上 A23。盘面数字：左栏 81 行／右栏 0 行／12 个目录组，行数＝后端 `/api/panel/files` 81 条，图标 81/81，title 三段 81/81，`@` 候选 8 条全部来自同一份清单（树外路径 0），手机抽屉末行底 783＝`.side-foot` 顶 783（不被压）。
- **未决**：① `scripts/fmcheck.cjs` 本轮**显式退 2 而非红**：夹具项目 `ccwd-fq` 已于 0928 归档移出 hub，全库扫过一遍在场项目里没有「`upstream:` ≥2 项块列表」的 md（逐项目 grep 0 命中，content-ops 三个未扫，不下全称结论）；该形态不是无人认领——`test/md-frontmatter.test.mjs` 已钉块列表解析／CRLF／`-x` 缺陷行／上元信息条＋转义四例，缺的只是「真产物 DOM 面」，补它要在隔离工作区造带块列表头的产物，禁止往真实项目塞测试件。② **图墙未更新**：本会话的 sites MCP 面不可用，`0.7.2 · 波 10 视觉对标` 章节待有站点面时补登记；实拍图已在 `docs/shots/`。③ **本版 dist 包内含同日「波 10.5」已落盘的改动**（`ModeDrawer` 上拉抽屉、按会话分桶档位、md 真表格/hr、分叉后端 `fork?at`；见 `docs/交接回执-波10.5-会话档位与md补强-20260929.md`），A 组只做了与之对齐的验收口与移动态触摸目标补齐（`.mode-chip` 27.8px→44px、`.ex-r` 23.8px→44px），**未替该单做验收**。④ Electron 桌面壳本轮未重打包（dist 变了，win 包仍是旧壳；`file://` 那条病已在 0.7.1 修，exe 实跑仍待用户本地会话）。⑤ A7① 复制断言在当前盘面是弱验（`hasCode=false`），只比了文本同源。⑥ 0.6.0–0.7.2 全部改动**未 commit**（等用户点名）。


## 0.7.1 · A 组波 9：pi-web 效果对齐（会话导出 / 消息操作 / 预览分流 / 命令面板 / 连接状态 / 移动收尾）（2026-09-28）

依据 `docs/WO批次-storyharness波9-AB组-piweb效果对齐-20260928.md` §一效果表，A6→A13 按序全落，**判据只看「pi-web 有的效果这边有没有」**。B 组（B9–B17）与 C 组四项拍板（C5/C6/C7/C9）不在本版；**C5/C7 拍板前 8431 仍不得对外暴露**。

- **A6 会话面板**：`lib/sessionFilter.ts`（视图档 进行中/已归档/全部 ＋ 查询串的唯一判据，纯函数，**只过滤已加载数据不发请求**——后端没有搜索路由，那是 B15，不许假装查得动全文）；`lib/sessionExport.ts`（会话导出，纯客户端：正文切分复用 `lib/replay`、产物清单复用 `lib/writeTools`，**不另起一套导出解析＝两份真相**）；左栏出筛会话输入框＋三档视图胶囊（带计数），归档/恢复往返走 `api.archiveSession`。新建会话与切会话的语义收进 `store.newSession/pickSession`——侧栏、命令面板、工作区三处各写一份的话，「手机上抽屉压屏」这类修法就得改三处。
- **A7 对话面交互**：`components/MsgActions.tsx` ＋ `lib/msgActions.ts`（消息操作条：复制 / 引用 / 重试；**assistant 复制的是 markdown 源而非渲染后富文本**，粘回编辑器还能用才是这条效果的本意）；composer 的 `@` 文件名补全（判定在 `lib/msgActions.mentionAtCursor/fileMentions`，能被 `node --test` 钉住），重试取「最后一句 user 原文」同样单点。`chat.css` 操作条样式与触摸目标。
- **A8 预览渲染层**：`lib/fileTree.ts`（右栏文件树按目录分组＋折叠态＋时间/大小列，`fmtMtime` 同年省年份、坏串给 `—` 不猜 1970）；`components/Preview.tsx` 分流口（md / diff / 纯文本现在就能看；图 / PDF / 音频按 `lib/fileKind.rawUrl` 的 B13 约定出址，**B13 未上线时 onError 显式降级并写明缺哪张工单，不静默留白**）；`components/DiffView.tsx` ＋ `lib/diff.ts`（unified diff 着色，数据面归 B12，本组件只吃字符串，缺数据不许编）。
- **A10 命令面板与快捷键**：`components/Palette.tsx` ＋ `lib/commands.ts`（命令表纯函数＋注入动作，**清单只从已加载的 signal 生成，面板打开零请求**）＋ `lib/keymap.ts`（键位判定唯一事实源，输入态豁免规则钉在纯函数里而不是组件里一句 if）。`Ctrl/⌘K` 呼出、上下键选、Enter 执行、`Esc` 收、`?` 开合快捷键表、`Ctrl/⌘B/J/1/2/3` 切页与栏。
- **A11 连接状态与 401 分诊**：`lib/conn.ts`（状态机纯函数 `titleFor/loginUrl/reportUnauthorized/setBusyTurn`）＋ `components/StatusBar.tsx`（**一屏只出一张横幅**：重登 → SW 更新 → 断网 → 掉线说明）＋ `statusbar.css`；`lib/api.ts` 每个响应过闸：401 记状态、成功记恢复，**不再静默空转**（0.7.0 那条「前端拿到 401 只是把错误咽下去」的已知缺口自此撤除）。切后台仍在生成的轮次把标题写成「⏳ 生成中… · StoryHarness」（任务栏只显示标题，这是唯一能触达用户的位置），流一收即复原。
- **A12 移动端收尾**：`lib/gesture.ts`（划动→手势的纯判定：`EDGE=26 / MIN_DX=56 / MAX_RATIO=0.62`；开抽屉只认边缘起势，关抽屉认整屏，太斜即让位给系统竖滚）＋ `hooks/useDrawerGesture.ts`（passive 监听、只在移动断点生效、`.tabs/.mbar/textarea/input/select/[data-no-swipe]` 上不抢手势）；触摸目标复扫后补齐四颗（`.btn/.pill` 41–43px→≥44、`.ma` 30→44、`.sb-btn` 34→44）；墨色档对比度复核：四处关键文字实测全部 ≥4.5:1（对话正文 10.56 / 侧栏项目行 4.55 / 次级小字 5.38 / 选中态主色 4.55），**4.55 是贴线过，本轮没有改色值，只把量法钉进脚本**；**加载骨架** `components/Skeleton.tsx`＋`.skel`（只动画透明度、尊重 `prefers-reduced-motion`）替掉右栏两处单行「载入××…」，空态文案统一「尚无」口径（`空工作区`→`该工作区尚无项目。`等四处）。主题标记自此落在 `<html>`（墨色档能刷整页背景，状态条也在 `.app` 这层 row-flex 之外占整行）。
- **A13 收口（本版）**：全量复跑见下「实测」，逐条输出落收据 `docs/收据-波9A13-全量复跑-20260928.txt`；A6/A7 交单时写明「接线面留给 CDP 实拍（A13）」，故新建 `scripts/export-actions-check.cjs`（17 条：筛会话归零＋空态回文、视图胶囊计数自洽、导出 Markdown/JSON 的**文件名＋blob 正文**与页面「共 N 条」对账、复制/引用/编辑并重发/`@` 补全全链路、「从此处分叉」禁用态点名等 B10）；`scripts/fmcheck.cjs` 的夹具查找随 A8 的文件树改造修正（**行内只显基名，同名副本在 `snapshots/` 里，改按目录组定位＋头部全路径认领**，否则验收脚本点到快照副本）；`scripts/mobile-check.cjs` 加两条反「假通过」的钉子——骨架规则进包／旧「载入中」文案出包（钉构建产物，不赌在途时序），以及**主动造空态**（筛会话筛不到＋切「已归档」）后再断言文案统一，否则页面上没有空态时该断言会空过；**CDP 页签认领改为脚本自开自关**（新 `scripts/cdp-page.cjs`，八脚本共用）——这台机器同时跑着别的会话的 headless Edge，`/json` 里的现成页签要么是别人的页、要么是浏览器为下载开的内部页（`edge://downloads-hub` 关不掉还会自开，且不接受 `setDeviceMetricsOverride`），实测让整轮验收「假失败」；`export-actions-check.cjs` 因此在原型层截住 `a[download].click`，导出证据改比文件名＋blob 正文，不落盘也不生页。**图墙已更新并发布**（`shots-wall/` → 公网页新增 0.7.1 段 11 张图证，复用原 projectId 与访问范围）；邻会话交接回执落 `docs/交接回执-波9A组-20260928.md`（改动清单＋mtime＋未决＋**写权越界自报**：A12 动了 A8/A6 的文案面、A11 动了 `Chat.tsx`/`chat.css`、A13 动了 `fmcheck.cjs` 与两个 `package.json`）。
- **实测**：ui `tsc --noEmit` 0E、`test:ui` **217/217**（0.7.0 收口时 148；波 9 A 组新建 6 个测试文件贡献 59 例（逐文件实跑对账：session 8 / msg-actions 6 / preview-layer 14 / palette 12 / conn 14 / gesture 5），另 B 组 B9 的 session-stats 9 例与 `md.test.mjs` 补的 1 例同盘在册——**初版此处写的「session 10 / msg-actions 10 / preview-layer 10 / palette 10」是抄来的数，实跑不是这样，已就地更正**）、`vite build` CSS 24.23KB / JS 100.33KB（gzip 5.51 / 37.27）；底座 `typecheck` 0E、`npm test` **63/63**。`page-lint` 五档全过——四张旧表不回退（首页 9/9、桌面工作区 17/17、移动首页 8/8、移动工作区 10/10）**＋波 9 新增面 19/19**（13 个波 9 节点选择器 `.macts,.ma,.pill,input[type=search],.rtabs,.turnfiles,.side-foot,.dot` 等 ＋ 6 项内置断言；出稿曾写 13/13，那是只数选择器，本版按实跑输出更正）。**CDP 八脚本全过共 98 条断言**（palette 11、qstick 10、fmcheck 10、mobile 28、export-actions 17、sw 8、auth-shell 6、conn 8；palette 旧记 12 与本轮实跑 11 对不上，以收据为准），图证 `docs/shots/{a11-*,a12-*,a13-*,palette,q-stick,m-*}.png`。
- **未决**：① 本版**含 B 组已落盘的 B1/波 3/B9 面**（`MetricsBar`/`sessionStats` 在树内），但 B9–B17 其余待人批，A 组未替其验收；② `storyharness/VERSION` 已置 0.7.1，但**运行中的 8431 顶栏版本戳实测仍是 v0.6.2**（本波 curl `/api/hub` → `"version":"0.6.2"`；badge 读的是服务端 version，实例在 0.6.2 时代启动，版本在 config 装载时读盘）——**截图顶栏因此都是 v0.6.2，但界面确实是本版新 dist**（静态面每次请求读 `ui/dist`，筛会话框/视图胶囊/操作条都在图上）。旧口径「仍报 0.7.0」是抄来的、没实测，此处按 curl 结果更正；重启后顶栏才见新号；③ A12 的骨架在「hub 取数失败」分支只有文案（`项目清单尚未载入 · 用上方 ↻ 重试。`）没有实拍——该态需后端故障才可达，`hubBusy` 真值下的骨架态未做 DOM 级实证；④ `MetricsBar`/`Trace` 的「指标读取中…」「该会话没有轮次记录。」两处未并进本轮骨架/文案统一：写权在 B9（`ui/Trace.tsx` 是 B9 明列文件），本波纪律是 A 组不越界，留作 B9 收口项；⑤ **C3（远程打开项目页调不通后端）仍挂 C 批未动**，写权 `tools/workflow-page-template.html`，属「手机能用」这条效果的洞；⑥ **A8 的文件树节点（`.fdir/.frow`）不在任何页面契约默认档里**——右栏「文件」页签不切过去就不挂载，该面由 `scripts/fmcheck.cjs` 的点击式实证覆盖，页面契约表不替它背书；⑦ `scripts/{perf,dshots,mshots,tshots}.cjs` 四个一次性实拍脚本仍用旧的「挑现成页签」，在这台机器上可能撞同一个坑（本轮只改了八个验收脚本）；⑧ 0.6.0–0.7.1 全部改动**未 commit**（等用户点名）；⑨ **桌面壳（Electron）那条路实测是坏的**（本波收口时顺手探的，无头 `file://` 复现壳的同一条寻址条件）：`desktop/main.cjs` 用 `loadFile(ui/dist/index.html)`，而 `lib/api.ts` 全部走**相对** `/api/*`（只有 `vite.config.ts` 的 dev proxy 兜住 `npm run dev`）→ `file://` origin 下 `fetch('/api/hub')` 直接 `Failed to fetch`、项目行 0、**窗口空白**；A11 的 401 分诊 `location.href='/login?next=…'` 与 B13 的 `rawUrl` 同一条病。壳头部注释「API 用绝对地址 http://127.0.0.1:8431」与盘面不符（旧口径）。exe 窗口实跑从 0.6.x 挂到现在没验过，所以这洞一直没被眼看见。**已就地修（同日收口后追加）**：`desktop/main.cjs` 改为**一律** `loadURL('http://127.0.0.1:<port>/')`（删掉 `DIST_INDEX` 与 `loadFile` 分支，头部注释同步改成实测口径），并把同一份改动打进已存在的发布包 `release/StoryHarness-win32-x64/resources/app/main.cjs`（避免为两行代码重跑 568MB 打包）；`node --check` 双份均过。**仍未验的是 exe 窗口实跑**（本机拉 GUI 必 `0xC0000142`，需用户在自己桌面会话双击一次），这条留在 B17。

## 0.7.0 · A 组收口：手机真能用 + 每轮产物看得见 + 测试兜底（2026-09-28）

依据 `docs/WO批次-storyharness前端0.7x-对标piweb-20260928.md`（对标 `agegr/pi-web`，同引擎）。波 1 四张工单（A1–A4）+ 波 2 收口（A5）全落；**B 组（WO-B1…B8）未随本版发布，见 §未决**。

- **WO-A1 移动壳 + PWA**：`lib/store.ts` 单点移动判定 `MOBILE_MQ='(max-width: 820px)'`（`isMobile()` 给非 DOM 安全的 signal 播种，`useIsMobile()` 给组件），左栏/右栏改抽屉（`leftOpen`/`rightOpen` 互斥，`go()` 离页即收），右栏默认在手机上不挂载（`rightOpen = !isMobile()`）；`styles.mobile.css` 新建（顶栏 nowrap+省略号、`.mbar` 返回+模式胶囊、触摸目标 ≥44×44、安全区内边距）；`100dvh` + `overscroll-behavior-y:none` 治 iOS 地址栏抖动；`index.html` viewport-fit=cover + 双 theme-color + manifest + apple-touch-icon，`public/manifest.webmanifest` + `icons/{192,512,svg}`。**离线壳于收口后补漏波补齐**：`public/sw.js`（导航 network-first、`/assets/*`+`/icons/*`+manifest cache-first——文件名带 hash 天然无陈旧；**`/api/*` 与 `/events` 一律不拦不缓存**，陈旧磁盘事实是本仓事故形态）+ `main.tsx` 生产态注册（dev 不注册，免与热更新互踩）+ `src/vite-env.d.ts`；`scripts/sw-check.cjs` 8/8 实证断网能开壳、缓存内 `/api/*`=0、复网即回真值。
- **WO-A2 对话面**：轮级产物清单 `components/TurnFiles.tsx` + 写类工具白名单 `lib/writeTools.ts`（实名 `fs_write`/参数 `path`；读类与 `mf_*` 一律不入清单，不硬凑假清单）→ 点芯片经 `store.jumpToFile` 单点入口在右栏真打开该文件；引用改稿（assistant 正文选中浮出 `.qbtn`，发送拼 `> 引用\n\n正文`，**零协议改动**）；长会话 tail 分页 + `atBottom` 钉底 + 「加载更早」+「↓ 回到底部」，翻页用 `useLayoutEffect` 补 `scrollHeight` 差；回放合并逻辑原样抽出 `lib/replay.ts`（三条等价性由 A4 钉测）。
- **WO-A3 可读性**：`AnsiText`（工具结果/判官明细上色，自写解析零依赖）、`FrontmatterCard`（R4 过程件头部独立卡，字段按 `contracts/artifact-header.schema.json` + 全盘 697 个实盘头部写渲染，缺项/未规范化显式标注不静默）、`MermaidBlock`（极简子集，超子集显式回落不冒充）、`lib/prefs.ts`（`sh.prefs.*` localStorage 偏好层：思维链/工具卡默认展开、`pageSize`、`quoteEnabled`，写入端与读取端共用一套解码校验）。
- **WO-A4 测试基线**：`ui/test/**` 从零到 **143 例全绿**（`npm run test:ui`，交单时 41 例，波 2 联调期补至 143）；`lib/api.ts` SSE 分帧抽成纯函数 `parseSseChunk` 零行为变更；`scripts/page-lint-ui.mjs` 无头 CDP 页面契约脚本。
- **WO-A5 收口（本版）**：`src/serve.ts` 静态面从只认 `/assets/` 扩到 `/icons/ + /manifest.webmanifest + /sw.js + /favicon.ico`，MIME 补 `application/manifest+json`，非 assets 一律 `no-store`（PWA 清单改一次即生效）；page-lint 实跑四档（首页默认表 9/9、桌面工作区深面 17/17、移动首页 8/8、移动工作区 10/10）并加 `--click`/`--viewport`（SPA 路由只在内存里，工作区面必须点进去验）；A2 三件事 CDP 实拍 `docs/shots/t-{turnfiles,turnfiles-open,quote,tail}.png`。SW 上线后四表复跑仍 9/9·17/17·8/8·10/10（零 console error 断言未被 SW 生命周期打破）；`ui/test/COVERAGE.md`「故意没覆盖」表里 FrontmatterCard 的渲染层欠账由 `scripts/fmcheck.cjs` 补齐——真实路径开 `01-选题/find-trope.md`：非白名单键 `class/round/version` 显式标「未规范化」零静默丢弃、必带 `module` 缺失被点名、`upstream` 渲成 5 个 `<li>`、反例「首行非 `---` 的文件不出卡」，9/9（图证 `docs/shots/m-fmcard.png`）。
- **实测**：ui `tsc --noEmit` 0E、build 产物 CSS 16.41KB / JS 66.15KB（gzip 4.02 / 24.82）、`test:ui` 143/143；底座 `typecheck` 0E、`npm test` 23/23；390×844 四视图 `scrollWidth==innerWidth` 无横向溢出；首屏 FCP 40ms（只记账，不构成闸）。SW 上线后 15:40 重建为 JS 67.24KB / CSS 16.41KB——**该包含 B 组在飞的 `Chat.tsx`（15:26）**，所以「页面断言全过」顺带替他们的改动做了一次渲染级冒烟，不构成对其工单的验收。
- **未决**：① 本版**不含 B 组**——`docs/交接回执-WO-B1-鉴权与路径边界-20260928.md` 显示 B1 已于同日 15:11–15:13 落盘（`SH_PASSWORD` 进 `config.ts`/`serve.ts`），但默认关闸、是否对外待人批，其余 B2–B8 未落；② 引用浮钮毛刺（`atBottom` 未及时翻转时 `Chat.tsx:83` 把「引用此段改稿」收起）已由 B 组波 3 抽出 `lib/quoteStick.ts` + `test/quote-stick.test.mjs` 接管，本版的 `tshots.cjs` 绕行实拍仍是有效收据；③ 0.6.0–0.7.0 全部改动**未 commit**（等用户点头）；④ `StoryHarness.exe` 桌面实跑仍需用户本地会话；⑤ PWA「添加到主屏幕」在真手机（iOS）上未装验过——需 https/localhost + 用户自己的隧道，且 WO-B1 口令是否开启会直接影响这条能不能走。

## 0.6.2 · markdown 渲染 + 工作流门标题（2026-09-28）

- `ui/src/lib/md.ts`：极小 md 渲染器（先转义后构造，原始 HTML 注不进去）——标题/列表/行内码/代码块/粗斜体/链接/引用块/表格行；R4 产物 YAML 头部整段吞掉压成元信息条。接入三处：assistant 气泡、右栏 .md 文件视图、世界书词条正文。
- 工作流面板真 bug：门节点标题读 `n.title`（link 门「连接 · 编剧（自动批准）」此前显示裸 id）；无 kit 的核生 link 门归「未归口」组如实标注——非语料缺陷。
- 打包 exe 真跑结论（本机）：远程会话下 GUI 子系统进程一律 0xC0000142 即退（EXITED -2147483645，`--headless=new` 亦然）——桌面模式必须由用户本地会话启动；渲染实拍继续走 Edge headless + CDP（同 Chromium 内核）。
- 实拍复检：选题报告.md 渲染（头部条+引用+表格行）、工作流门标题、对话回放合并——全过。ui tsc 0E，产物 45.8KB。

## 0.6.1 · Electron 桌面壳 + 回放合并修复（2026-09-28）
- **`desktop/`（Electron 33 薄壳）**：主进程先探 8431 健康——已就绪即附着，否则 spawn `node tsx src/cli.ts serve` 等健康（60×0.5s 超时）；窗口直接 `loadFile(ui/dist/index.html)`（API 绝对址 + serve CORS 全开，无需内置静态服务器），dist 缺失回落 `http://127.0.0.1:8431/`；壳退出带走自己拉起的 serve 子进程；启动失败出显错窗。`SH_SHOT=<png>` 环境变量 = 加载后截图自退（冒烟用）。打包：`npm run package`（electron-packager win-x64，产物 568MB 已 gitignore）。
- **本机坑复现**：bash 会话拉 GUI 子系统进程必 0xC0000142（rc=3）——桌面模式需用户会话启动；无头验证改走 Edge `--headless=new` + CDP（`desktop/shots.cjs` 连拍三视图）。
- **对话回放合并**：连续 assistant 段聚成一个气泡、`role=tool` 结果按 `tool_call_id` 折回工具卡——治「JSON 原文裸露成独立气泡」（实拍揪出）。
- hero 行 `align-items:center` 治「立项开跑」按钮被 flex 拉伸成竖排。
- 实测：ui tsc 0E、build 44.45KB；无头实拍首页/工作区对话/设置三视图 + 回放修复复检通过。

## 0.6.0 · 新壳：Vite+Preact 干净 SPA（弃单文件门面堆砌，2026-09-28）

**路线**（09-27 甲方拍板、09-28 接续）：`home.ts` 单文件门面已被证明走不通（50+ 散点字符串拼接、无组件化、并行会话同文件互踩），改 Vite + Preact + TS 从零建壳（`storyharness/ui/`），不搬 dsh monorepo（1677 文件依赖地狱）。前端只消费 8431 现有 API，后端零改动（除两行接线）。

- **3 页面**：首页（hero 立项 flow_run 一键开跑）／工作区（三栏：项目▸会话树 · 对话+轨迹 · 右栏世界书/文件/工作流）／设置（模型 provider/model/baseUrl/key、工作区注册、纸墨双主题、深链）。
- **对话面追平 dsh 核心体验**：SSE 流式（fetch 读流解析 `data:` 帧）＋思维链折叠（thinking_delta）＋工具卡片（tool_call/tool_result 状态 ✓/✗/⋯ 可展开参数与结果）＋■停止（AbortController + /stop 双管）＋权限四档胶囊。
- **会话管理**：新建/重命名/置顶/分叉/归档/删除全走既有端点；切项目自动开最近会话。
- **serve.ts 接线**：`/` 有 `ui/dist` 即服务新壳（assets 带 MIME+immutable，路径越界防护），无 dist 回落 `HOME_HTML` 旧门面——灰度共存，随时可退。`/api/hub` 增 `version` 字段。
- **实测**（无头 DOM 驱动）：首页树 40+ 项目渲染／工作区 18 会话嵌套+回放 8 消息+工具卡／文件树 72 项／工作流 20 节点按模块分组／实弹对话回合流式完整回复／设置页模型掩码——控制台零错误。ui `tsc` 0E，产物 JS 44KB；底座 `typecheck` 0E、`npm test` 0 fail。
- 未决：Electron 打包壳（另批）；旧 `home.ts` 与新壳并行一版后择期处决；工作流面板「other」组 = 无 kit 节点归口待查。

## 0.5.7 · 版本戳 + 0.5.6 遗留归拢（2026-09-27）

- **页脚版本戳**：`/` 门面页脚直接显示底座版本（serve 启动时注入）——「刷新了没变化」从此一眼可辨。
- 归拢 0.5.6 未记条目：hub 加载 8s 超时×3 退避（治永卡「加载中…」）；＋ 新项目回立项视图；
  官方模板项目 `projects/template-短剧`（预填配置，复制即用）。

## 0.5.6 · hub 超时自动重试 + 官方模板项目（2026-09-27）

- loadHub：8s 超时 ×3 次退避重试——栈重启瞬间加载不再永卡「加载中…」；失败仍有 ↻ 手动重试。
- ＋ 新项目：点击回到立项视图并聚焦输入框（此前点了无反应）。
- 模板项目 `projects/template-短剧`：预填 项目配置.json + README 用法（复制法/对话法）。

## 0.5.4 · 新建工作区（选文件夹 → 初始化 → 管多项目）+ 侧栏折叠 + 残骸清理（2026-09-27）

- **新建工作区**：工作区标题行 ＋ → 展开表单（名称 + 文件夹路径，目录自动创建）→ POST
  /api/workspaces：写 `.storyharness.json` manifest + 注册 `.storyharness.workspaces.json`；
  hub 分组从注册表读出——**选一个全新的、不在 v4 里的文件夹，初始化整个项目配置，下面管多个项目**。
- **侧栏工作区可折叠**：点工作区名 ▸/▾ 收起/展开项目列表（治「收不起来」）。
- **测试残骸清理**：33 个匿名 p-sh-2026* 时间戳项目与 p-t/p-web/p-sh-lock 归档至
  `_archived/test-debris-0927/`（headless 未带 --project 时自动命名的存量）。
- 根因记录：cli web 缺省 project 硬塞的幻影名已在 0.4.2 修；本轮另有 node:config maxChars
  string 脏告警一处（低优）。

测试：23/23 + tsc 0E。

## 0.5.3 · 中栏会话件去重（2026-09-27）

甲方截图点名：对话区的「＋ 新会话/会话列表」与左栏树（项目 ▸ 会话）功能重复。撤中栏会话件——
会话管理唯一入口 = 左栏树；主栏加「＋ 会话」（项目选中时显示）；切项目重置 SID 自动开该项目
最近会话（防跨项目串话）。

注意：本批与并行会话（分屏/全屏/showView 重构）同文件高频交叠——合入以最新态原子替换，
两次 Edit 冲突后改 python 原子写入。

## 0.5.2 · 侧栏归组 + 会话管理四件（2026-09-27）

## 0.5.2 · 侧栏归组 + 会话管理四件（2026-09-27）

- **同题归组**：门面左栏按 title 分组——同一题材的多轮项目（外卖骑手 ×6、曹操 ×3）收进组文件夹，
  组内子行 = 项目 id + 进度；单行项目维持原样。组展开态内存保持。
- **会话管理四件**：嵌套会话行挂 … 菜单——置顶（meta.pinned）/重命名/分叉（forkChat 全文复制
  新会话标题+「·分叉」）/归档（meta.archived，清单默认过滤）。后端 setSessionFlags + forkChat
  + serve 三端点（/pin /archive /fork）。
- 会话清单带 pinned/archived 位；嵌套展示过滤 archived（归档不删，二期做「已归档」视图）。

测试：23/23 + tsc 0E。

## 0.5.1 · 门面三件：回合终止 + 权限四档 + 树形侧栏（2026-09-27）

- **回合终止**：`POST /api/projects/:id/agent/sessions/:sid/stop` → abort 正在进行的 pi agent；
  门面发送键流式中变「■ 停止」；agent.abort 的回合优雅收口为 done（保留已生成部分，不算错误）。
- **权限四档**（对齐 Codex 模式）：输入栏档位选择器（localStorage 持久化）——
  plan=计划模式（只读：无 fs_write/无流程推进，保留盘面只读件）/confirm=变更前确认（全环+提示词
  确认纪律）/auto=自动编辑（写件直接、推进前说明）/full=完全访问（原状）。档位变更换新 agent
  （工具环按档重建，历史从会话 JSONL 重建不丢）；逐工具单测 4 条。
- **树形侧栏**：项目 ▸ 会话嵌套（Codex 式）——项目行加展开箭头，懒取该项目会话清单嵌套显示，
  点会话=选项目+开会话。
- **whereami 修复**：内核 whereami 桥返回人读文本，kernel.verb 无脑 JSON.parse 必炸（对话环
  mf_whereami 从未成功过、一直靠 agent 换路掩盖）——verb 解析容错回退原始字符串；冒烟实测。
- 自测纪律入档（feedback-selftest-toolchain）：交付前逐工具实弹冒烟，不靠 agent 换路掩盖。

测试：23/23（新增权限四档 4 条）+ tsc 0E。

## 0.4.5 · 产品门面（对齐 dsh desktop 形态，2026-09-26）

**问题**：产品一直没有自己的脸——`storyharness web` 打开的是语料包#1 的作业台（StoryFlow 工作台），
「启动后第一眼」缺失。参照 dsh desktop（左栏工作区+会话，中间品牌+大输入框，克制到只剩入口）：

- **`/` 产品门面**（8431 单端口自持，壳+数据零 python 依赖）：品牌 hero + 流程选择 + 一句话立项输入框
  （题材方向+集数 → flow_run 一键开跑）+ 左栏工作区分组项目清单（标题/进度 done/total，实时读 state.json）+
  状态灯（就绪/推进中）+ 作业台深链（8421）。
- **`/api/hub`**：工作区清单 API——flow 目录枚举 + 分组项目扫描（storymasterv4 + content-ops 第二包同框）。
- **`/api/kernel-verb`**：门面壳专用内核动词代理——**白名单三动词**（flow_init/flow_run/flow_next），
  禁止通配（壳不得成为内核的万能后门）。
- 立项即开跑：输入框直接 flow_run，沿用 headless 的已有 run 拒绝护栏（内核侧）。

测试：19/19 + tsc 0E。

## 0.4.4 · 判官闭环（工单 D-B，2026-09-26）
## 0.4.4 · 判官闭环（工单 D-B，2026-09-26）

- **B1 回喂写手（默认关）**：executor 读最近一个「过闸且 flagged 非空」收据（排除本节点），注入写前提示（自带「证据非闸、不构成拦截」声明）；`cfg.judge.feedback` 显式开启才生效——B2 校准抽样（13/13 全分歧）证明未过闸学生 flagged=噪声，回喂挂起等学生过闸。单测 3 条（两态+mtime 取最近）。
- **B2 校准抽样**：`storyharness/cali/calibrate.mjs`（同题面同文本，glm-5.3 全量档逐条款独立打分；≤4 次调用纪律实际用 2 次）——p-sh-final 两产物 13 个判断点**全分歧**（判官全 flagged / 强模型全 clean，理由具体到体裁与例证）。报告：`docs/实验-判官校准抽样-20260926.md`。**E2 航向修正：违规密度测量必须等学生过闸，未过闸期只做管线联通验证。**
- **B3 看门狗**：agent.prompt 外挂 960s watchdog（到点 agent.abort() 显式终结），SDK 超时失效兜底。

测试：19/19（新增 judge-feedback 3 条）+ tsc 0E。

## 0.4.3 · 流断桥回落 + executor v4 重写（2026-09-25）

p-sh-final 正式验收 soak 连续暴露两类流死亡，executor 整体重写收口：

- **900s 流超时**：OpenAI SDK 默认 10 分钟对全量档（glm-5.3+思维链）大节点不够——makeStreamFn 显式 timeoutMs=900_000。
- **Z.ai 网关断高档长思维 SSE**（流中死，非客户端超时；usage 显示 1079 token 后被掐）——客户端超时管不到。对策 = **桥回落**：流重试穷尽后走 python 非流式 POST（glm_chat.py 增 `--config`；executor 配 `fallback:` 节，缺省指 v4 仓 glm_chat.py），900s socket 实测可扛数分钟生成（sh.mts/demo2 全程实证）。dry 不回落（本就不交卷）。
- **executor v4 重写**：增量补丁把 runEntry 切碎了——一次性重排为 清盘（dry 跳过）→ agentFactory → 瞬时重试（换新 agent，429 不重试）→ 桥回落 → 正文真源裁决 → 自愈交卷环 → 判官证据 → 收据/遥测，全部特性一个函数里读完整。收据新增 quarantined/bridgeUsed 字段。

测试：16/16 + tsc 0E。

## 0.4.1 · 底座第二批（工单 C-B：dry 语义 / 锁加固 / transcript events / verify:pack）（2026-09-25）

**dry 语义钉死（C-B2）**：查清 stub 产物来源 = dry 会话中 agent 仍持有 fs_write 且提示词指示落盘。修法 = dry 收掉 fs_write + 换 DRY 提示词（正文作为最终回复输出）；headless 与 serve 的 run_start/run_end/final 事件带 `"dry":true`；dry 只写收据（带 dry:true）与遥测。
**锁写入加固（C-B2）**：acquireRunLock 改 O_EXCL（wx）原子创建——消除读-写窗口竞态；死接管=先删后重试一次；EEXIST=读胜者回敬。并发 acquire 单测（8 并发恰 1 胜）。
**transcript events（C-B3，与 C-A5 契约钉死）**：`GET /api/projects/:id/agent/sessions/:sid` 新增 `events` 字段——run_event 类（submit/integrity_reject/judge_evidence/chat_turn_end）按 JSONL 时序，形状 `[{ts, event}]`；messages 结构零改动；旧会话空数组合法。
**最小第二包 fixture（C-B4）**：`demos/mini-pack/`（独立语料仓 + verify.mjs + `npm run verify:pack`）——「换语料仓不改底座代码」固化为可重复回归（5 断言：协议面就绪/log 声明回落区分/ui 按命令拉起/协议 JSON/退出清场含按端口追杀孙进程）。



> 本文件记录 **harness 底座**（`storyharness/`，原名 `harness-pi/`）自身的版本演进。
> 语料仓（`flows/ skills/ knowledge/ modules/` 与项目数据）的版本另见仓库根 `VERSION` / `CHANGELOG.md`——两者独立发版，边界见 `ARCHITECTURE.md`。

## 0.3.1 · 快判官证据位 + 运行遥测（2026-09-25）

甲方拍板开工 laya 接入三步走的第一步，并把「快决策模型输出日志」立为架构埋点。

**判官证据位（laya 学生，纪律：只出证据不当闸）**
- 新增 `src/judge.ts`：`runLayaJudge`（spawnSync venv python → 判官 CLI）+ `parseLastJson`
  （stdout 污染兜底：整文 → 逐行 → 有界花括号回扫——position 148 教训的防御性收口）。
- executor 交卷过闸后对 .md 产物跑判官，证据入 会话流（judge_evidence 事件）/收据/遥测；
  **不触发打回、不参与裁决**（P 值纪律 + 阈值清剿口径）。默认关闭，`<workspace>/.external/storyharness.json`
  的 `judge:{enabled,command,script,student,spec,threshold}` 开启。
- 新增 CLI `judge --file <项目内相对路径>`（手动/冒烟）。
- `tools/laya-ft/laya_judge.py` 加固：import/装载/前向全程 stdout→stderr 重定向，stdout 契约 = 单份 JSON。

**运行遥测（会话转工作流的数据面）**
- scheduler 收口写 `内部/telemetry/run-<ts>.json`（sh-run-telemetry@1）：墙钟/批数/逐节点
  {耗时,工具数,提交轮数,usage,judge flagged}/totals——效率归口与后续「会话→工作流」挖掘的机器可读形状。
- chat 逐回合埋点：`chat_turn_end` 事件（rounds/toolCalls/usage）入会话 JSONL。
- CorpusLayout 新增 `telemetryDir`（缺省 `内部/telemetry`）。

**测试**：12/12（新增 parseLastJson 污染兜底 1 条）。实弹：judge 子命令对 p-sh-soak3/剧本.md 打分
7 题 flagged 0、3 题显式 skip（缺 state 字段不猜值）。

## 0.3.0 · 产品化第一批：全 pi 单脑（2026-09-25）

产品形态对标 DeepSeek Harness（`dsh`，本机 `C:\Users\Administrator\deepseek-harness_` 有开源源码）做减法、pi 做加法——
对话与产线**同一个 pi Agent**（单脑，两种驱动方式）。设计案：`docs/产品设计-storyharness-20260925.md`。

**入口形态（dsh 减法）**
- 新增 `web`：一条命令拉起内核（core up，8421）+ serve.py 前端（8420）+ 本包协议面（8431），健康检查后自动开浏览器；
  同时把 `.storyharness.json` 的 `agent.base` 指到本包协议面——生成器注入 `DATA.agentApi`，工作台「对话」页签换脑到 pi。
- 新增 `headless "<题材>" [--flow drama-flow] [--episodes N] [--project p-xxx] [--batches M] [--dry]`：
  冷启动建项目并自动跑排期，stdout NDJSON 事件流（run_start/batch/node_start/node_end/gate_paused/run_end/final），
  项目已有 run 时拒绝静默续跑。
- 包目录正名 `harness-pi/` → `storyharness/`（包名本来就是 storyharness）；收据前缀 `harness-pi-*.json` → `sh-*.json`。

**会话持久化 + 交互对话（pi 加法）**
- 新增 `src/sessions.ts`：会话 JSONL 落盘（`<project>/<corpus.sessionsDir>/<sid>.jsonl`，缺省 `内部/sessions/`），
  session_start/message/tool_call/tool_result/turn_end/run_event/session_end 七种事件；结果体 16KB 截断。
- executor 每节点经 `agent.subscribe` 把逐消息全文＋工具往返**边跑边落盘**（此前进程退即丢）。
- 新增 `src/chat.ts`：交互对话环（与执行器同一 pi Agent）；工具环带 lifecycle 开关——flow 生命周期六动词
  （flow_list/init/run/next/submit/resume）只进对话环，`flow_gate`/`set_decision` 仍不入环（铁律 6）；
  新增 `mf_kb_search`/`mf_kb_read`（接活 kernel.ts 死代码）。
- serve 扩 agent 会话 API，**镜像内核 http.ts 形状**（GET/POST sessions、GET/DELETE/rename/:sid、POST turn=SSE
  delta/tool_call/tool_result/round/done/error）——工作台对话页签零渲染改动换脑；executor 轨迹与 chat 会话同库同列。

**修复**
- serve `/stop` 此前只置位无人读——scheduler 每批边界与批内取件前都检查 `stopCheck`，stop 真正生效。
- 任务包点名 `model_tier=high|lite` 而 tiers 缺该档时，显式打降档声明日志（模型档位纪律：默默降档=虚报）。
- `makeModels` zai 分支：内联 apiKey 落本进程 `ZAI_API_KEY` env（zaiProvider 走 envApiKeyAuth，缺它即
  `Provider is not configured`）；`makeStreamFn` 显式 `maxTokens: 32768`（zai 全推理模型，max_tokens 含 reasoning）。
- **Windows 坑**：`web` 拉起子进程若 `stdio:"ignore"`，内核的 python 桥（whereami/quality_scan）孙进程全部
  `exit=3221225794`（0xC0000142 控制台初始化失败）——必须 `["ignore","pipe","pipe"]` + 排水。
- 前端对话页签用户消息曾双写（手工 append + pi message_end 各一次）——统一由 message_end 落盘。

**测试**
- 新增 `test/unit.test.ts`（node:test + tsx，零新依赖）：会话往返/坏文件容错/越界防护/stop 标志/NDJSON 形状/
  已有 run 拒绝/档位信号/头部合成——9 用例。`npm test`。

## 0.2.0 · 底座化封装（2026-09-24）

把原「pi-agent 执行器」从 v4 语料仓里剥离出来，做成可换语料仓的通用底座。

**语料剥离（核心）**
- 新增 `CorpusLayout`：底座对语料仓的唯一认知收敛为五字段布局（项目数据根 / 收据目录 / 备份目录 / lint 工具 / lint 命令）。
- 新增工作区根解析 `resolveWorkspaceRoot`：`STORYHARNESS_WORKSPACE` 环境变量 > 包上一级；语料布局由 `<workspace>/.storyharness.json` 清单注入，缺省回落 v4 布局。
- `KernelClient` 构造函数改收 `(base, workspaceRoot, corpus)`，`projectDir()` / `flowLint()` 全部经注入布局拼路径，底座代码内不再出现 `projects/内部/收据/tools/flow-lint.py` 等 v4 专属常量。
- 删除 `projectDirOf` / `REPO_ROOT` 等硬编码根；`executor` 收据、清盘备份、交卷落盘全部改走 `kernel.projectDir()`。
- 运行配置文件迁移：`<workspace>/.external/storyharness.json` 优先，旧名 `harness-pi.json` 兼容读（迁移期不断线）。
- 执行器系统提示去语料化：不再点名 v4 的 `flows/ state.json registry/`，改为通用「流程编排与运行状态文件」。

**版本标注**
- 新增 `VERSION` 文件与 `loadVersion()`：`--version` / `version` 子命令打印 `storyharness <版本> · 语料=<corpusName> · workspace=<根>`。
- 包名 `@storyflow/harness-pi` → `storyharness`，版本 `0.1.0` → `0.2.0`。

**兼容性**
- 对 v4 仓零改动即运行：无 `.storyharness.json` 时布局回落到与旧代码完全一致的默认值。
- 旧 `.external/harness-pi.json` 仍可被读取。

## 0.1.0 · pi-agent 执行器（初版）

基于 `@earendil-works/pi-agent-core` + `pi-ai` 的节点执行器：批调度（AND-join 并发）、协议面守护进程、逐节点交卷与收据制。当时与 v4 语料仓硬耦合（路径、内核动词、lint 均写死）。

## 0.4.0 · 底座协议面（工单 B：manifest runtime 节 + 并发锁 + SSE）（2026-09-25）

**B1 · web 启动声明化**：`.storyharness.json` 新增 `runtime:` 节（kernel/ui 各声明 command（含 `{port}` 占位）/cwd/port/health），`web.ts` 有节按声明拉起、无节回落 v4 缺省（兼容性回归通过）。语料仓从此可以没有 `core/` 与 `tools/serve.py`——「底座+语料包」的可执行定义。

**B2 · 项目级并发锁**：`runFlow` 起手获取 `<project>/内部/run.lock`（pid/host/startedAt/token）——存活拒（报错指向持有者）、死 pid 过期接管、全路径 finally 释放；headless 被拒输出 NDJSON final(ok=false)。p-sh-soak 双进程互踩实证的修复。

**B3 · serve SSE**：`GET /events` 逐事件推送 runFlow 事件流（run_start/batch/node_start/node_end/gate_paused/run_end/final，形状与 headless NDJSON 一致）；CORS 全开保持；断线客户端自行全量重拉 /status。

**测试**：lock 单测 3 条（获取/持有拒+释放/死 pid 接管）；全量 tsx --test 15/15；tsc --noEmit 0 错。
