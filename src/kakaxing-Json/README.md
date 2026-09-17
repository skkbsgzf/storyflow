# kakaxing-Json · 咔咔猩公开数据快照

抓取自 kakaxing.com（AI 短剧剧本供给平台）的**无需登录开放接口**（网关 `gateway.kakaxing.com`）。

## 日常更新（一键）

**双击 `update.cmd`** 即可：增量抓新（列表按上架时间倒序，遇到整页旧数据即停，日常几十秒）→ 自动重新渲染 browse.html。

| 方式 | 命令 | 说明 |
|---|---|---|
| 日常更新 | 双击 `update.cmd` | 增量抓新＋重新渲染，快 |
| 全量刷新 | `update.cmd full` | 所有接口翻到底，约 2-3 分钟 |
| 仅抓数据 | `node scrape-kakaxing.mjs [--inc]` | 不重渲染 |
| 仅重渲染 | `node build-viewer.mjs` | data/ → browse.html |

官方**工作日 10:00 批量上新**，不是实时变动——每天上班后跑一次 `update.cmd` 即与官网同步。browse.html 数据内嵌，更新后重新双击打开即可。

## 数据质量（每次 update 自动校验）

`verify.mjs` 在每次更新后自动运行（也可单独 `node verify.mjs`）：

- **ID 级重复：必须为 0**。抓取时按唯一 ID（scriptRawstoneId / memberId / aiScriptcommentId / aiShortfilmId）去重追加，JSONL 内不允许出现重复 ID。
- **标题级重复上架：平台行为，如实保留**。平台会把同一部剧隔几天换新 ID 重新上架（评分/字数微调的新版本，2026-09-14 快照中 44 个剧目多占 51 行，如《谁说败家子不能当魁首》国内市场挂了 4 版）。JSONL 忠实记录全部上架版本；**browse.html 展示层按「剧名＋市场」折叠，只显示最新版**，页头会标注折叠数量。做版本演化分析时请直接用 JSONL 原始数据。

## 数据集一览（data/）

| 文件 | 内容 | 规模（2026-09-14 抓取） |
|---|---|---|
| `scriptrawstone.jsonl` | 剧本市场全量列表（主数据集，每行一条 JSON） | 7938 部 |
| `queryConditions.json` | 全站分类体系（题材标签/评级/集数/市场，带计数） | — |
| `scriptwriter.jsonl` | 编剧名录（实名/城市/星级/报价） | 95 人 |
| `news.json` | 短剧快讯（行业新闻＋AI 摘要＋原文链接） | 10 条 |
| `scriptcomment.jsonl` | 评剧本市场列表 | 267 条 |
| `shortfilm.jsonl` | 拉片市场列表 | 1411 条 |
| `style-list.json` / `model-list.json` | AI 画风预设 / 模型目录与积分定价 | — |
| `_meta.json` | 本次抓取时间与各数据集计数 | — |

重跑 `update.cmd`（或 `node scrape-kakaxing.mjs`）即可刷新快照（JSONL 追加去重，不重复入库）。

## scriptrawstone.jsonl 字段字典（43 字段）

| 字段 | 含义 |
|---|---|
| `scriptRawstoneId` | 剧本唯一 ID（SPTRS 前缀） |
| `scriptName` / `scriptTitle` / `topName` | 剧名（国内剧多为同名三份；出海剧另有中文策划名） |
| `logline` / `scriptTheme` / `topSummary` | 一句话卖点 |
| `topPlanning` | **完整策划案**（八段式：剧名/频类/题材/一句话卖点/共情点/爽点内核/剧情主线/创新亮点＋对标剧） |
| `scriptCategory` | 频道：F=女频，M=男频 |
| `scriptTypeAi` / `scriptThemeAi` | AI 标注的频道与题材（中文逗号分隔） |
| `scriptGenres` | 原始题材标签（国内中文、北美英文，逗号分隔） |
| `characterType` | live=真人短剧，animation=AIGC 动画 |
| `regionType` | CN=国内市场，NA=北美出海 |
| `episodeNumber` | 集数（30/40/50/60/80） |
| `episodeDurationMin` / `episodeDurationMax` | 单集时长（分钟） |
| `wordCountLimit` | 单集字数上限 |
| `tokenNumber` | 总字数（万） |
| `actorNumberMax` / `sceneNumberMax` | 主要演员数 / 场景数上限 |
| `dialogueDensity` | 台词密度分级 |
| `scriptScore` / `scriptGrade` | AI 评分（80-95）/ 评级（S / A+ / A） |
| `scriptMatchingDegree` | 对标匹配度 |
| `topHot` | 热度（如「3.4亿」） |
| `takePoints` | 售价（积分，32万-45万） |
| `scriptProduct` | 商品 SKU（如 SCRIPT_RAWSTONE_90） |
| `topImage` / `scriptImageUrl` | 策划封面 / 剧本封面（腾讯 COS 直链，公开可读，带 AI 水印） |
| `createTime` | 上架时间（工作日 10:00 批量上新） |
| `outputLanguage` | 输出语言 |
| `purchaseType` / `isCollected` / `businessStatus` 等 | 交易/收藏状态（游客视角基本为空/false） |

## 拿不到的部分（需登录/付费）

- 剧本大纲全文与世界观设定：`POST /incubator/web/scriptrawstone/detail` → `NOT_TOKEN`（手机号注册＋RSA 加密登录）
- 已购内容与导出：登录＋积分支付
- 评剧本 8000 字报告 JSON：COS 签名 URL，直连 AccessDenied

## 合规提醒

- 元数据（标题/标签/评分/价格/集数）抓来做竞争分析与题材研究没问题。
- `topPlanning` 策划案文案是平台的 AI 生成创作内容（平台宣称时间戳确权）：**可内部分析，勿原文照搬进对外商业产品**。
- 本目录数据为静态快照，再次抓取请保持限速，勿并发轰接口。
