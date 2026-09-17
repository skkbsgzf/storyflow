"""kit-config-init · 为全部 tool（kit op）注入内容配置项声明（R5 §二）

为什么要这一步：用户拍板「所有 tool 的位置，以及他们的内容配置项，都可以被用户或者优化 agent 优化」。
位置由 flow-overlay 管；内容配置项必须在 kit 侧有**声明**，否则优化 agent 无从下手、
前端面板无从渲染、内核无从校验「写了却没人认的键」。

本脚本把 kits/<域>/kit.json 的每个 op 补上 `config` 表：
    { "<key>": { "type", "default", "enum"?, "unit"?, "desc", "effect", "tunable_by"? } }
- `desc`   这个旋钮控制什么
- `effect` 调高/调低对产物的影响（优化 agent 的判据）
- 通用四项（depth / strictness / maxChars / model_tier）由内核兜底，不必在此重复声明

用法：
    python tools/kit-config-init.py            # 只补缺失的 op（幂等）
    python tools/kit-config-init.py --force    # 用本表覆盖已有 config
    python tools/kit-config-init.py --check    # 只报告哪些 op 还没声明 config（CI 用）
表未覆盖的 op 视为漏网：默认报错退出（`--allow-generic` 可放行，记为空 {} 只吃通用项）。
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FORCE = "--force" in sys.argv
CHECK = "--check" in sys.argv
ALLOW_GENERIC = "--allow-generic" in sys.argv

# (key, type, default, desc, effect, enum?)
# 表的组织：<域>/<op> → 旋钮清单。旋钮名用 ASCII（好写进 patch/CLI/代码），说明用中文。
TABLE: dict[str, list[tuple]] = {
    # ── 剧情域 ────────────────────────────────────────────────
    "plot/episodic-outline": [
        ("units", "number", 3, "首批细纲的单元数", "提高 = 一次摊得更开，返工成本更大"),
        ("hookPerUnit", "boolean", True, "每个单元末尾强制钩子", "关掉 = 单元之间可能泄气"),
        ("darklineDepth", "enum", "标准", "暗线铺陈力度", "提高 = 伏笔更厚，读者短期获得感下降", ["轻", "标准", "重"]),
        ("outlineDensity", "enum", "标准", "细纲颗粒度", "提高 = 写作期更省心、大纲期更贵", ["粗", "标准", "细"]),
    ],
    "plot/novel-bible": [
        ("quests", "number", 3, "开书三问的问答轮数", "提高 = 设定更稳，开书更慢"),
        ("powerSystem", "enum", "力量体系", "核心设定的骨架类型", "换了 = 全书冲突来源换血", ["力量体系", "情绪体系", "社会体系"]),
        ("deadlineRounds", "number", 3, "三问未答完最多许开书几轮", "提高 = 更难卡住，也更容易带病开书"),
    ],
    "plot/plot-choreographer": [
        ("actModel", "enum", "八段式", "结构模型选型", "换了 = 分集功能表全表重排", ["八段式", "三幕", "单元剧"]),
        ("cardDensity", "enum", "标准", "分场卡密度", "提高 = 每集卡点更多、拍摄成本更高", ["疏", "标准", "密"]),
        ("dataAnchor", "enum", "市场实盘", "节奏的标尺来源", "换成母题 = 少依赖实盘数据", ["市场实盘", "母题", "混合"]),
        ("lineCount", "number", 3, "三线骨架的线数", "提高 = 结构更丰富也更难收"),
    ],
    "plot/plot-redline": [
        ("angles", "number", 4, "代入的评审视角数（读者/编剧/甲方…）", "提高 = 更全面、成本线性上升"),
        ("harshness", "enum", "标准", "苛刻程度", "提高 = 更多打回更少漏网；过高会空转", ["温和", "标准", "苛刻"]),
        ("allowInject", "boolean", True, "框架单薄时是否允许提交流程重构建议", "关掉 = 只报问题不给方案"),
        ("voice", "enum", "说人话", "意见书的语体", "念指标 = 读者读不懂，说人话 = 可执行", ["说人话", "念指标"]),
    ],
    "plot/scene-breakdown": [
        ("shotsPerScene", "number", 6, "每个场景的分镜数", "提高 = 成稿更细、小纲更慢"),
        ("includeRationale", "boolean", True, "文末附创作思路页", "关掉 = 客户批注时缺少依据"),
        ("dialogLevel", "enum", "达意", "分镜里台词的打磨程度", "改成打磨 = 与成稿阶段重复劳动", ["达意", "打磨"]),
    ],
    "plot/script-drama-beat": [
        ("hookWindowSec", "number", 3, "前几秒必须出现钩子", "提高 = 更宽容；超过 5 秒观众已划走"),
        ("paywallCard", "boolean", True, "结尾强制付费卡点体检", "关掉 = 交付件可能不带商业钩子"),
        ("shotNotation", "enum", "△动作", "镜头标注法", "换了 = 与拍摄方约定不一致", ["△动作", "平板", "无"]),
    ],
    "plot/structure-design": [
        ("fuseCount", "number", 2, "融合的结构数", "提高 = 更独特、可读性风险上升"),
        ("injectUncertainty", "boolean", True, "是否输出不确定因素注入提案", "关掉 = 单薄问题被掩盖"),
        ("steps", "enum", "三步", "深挖/改造/融合的执行粒度", "两步 = 快，三步 = 稳", ["两步", "三步"]),
    ],
    "plot/world-forge": [
        ("factionCount", "number", 3, "势力矛盾条数", "提高 = 冲突来源更多，读者认知负担上升"),
        ("powerCost", "boolean", True, "力量必须有代价", "关掉 = 爽感无上限、后期崩盘"),
        ("wikiEntries", "number", 20, "wiki 词条库条目数", "提高 = RAG 更全，索引成本上升"),
    ],
    # ── 文学域 ────────────────────────────────────────────────
    "prose/dialogue-polish": [
        ("passes", "number", 3, "逐句过的遍数（声口/处境/去AI味）", "降低 = 省成本但机味残留"),
        ("maskTest", "boolean", True, "遮名三句测试（遮住名字能认出谁说话）", "关掉 = 人物声口趋同"),
        ("aiTraceDeck", "enum", "24类", "去AI味清单的档位", "精简 = 只查高频类，漏检增加", ["精简", "24类"]),
        ("preserveVoice", "boolean", True, "保留作者原有节奏不改成标准腔", "关掉 = 全部对话变成同一种腔调"),
    ],
    "prose/layer-canon": [
        ("sliceUnit", "enum", "按拍", "知情范围切片粒度", "按章 = 更省，越权漏检率上升", ["按章", "按拍"]),
        ("newWordPolicy", "enum", "首现即注", "新词第一次出现的处理", "延后注 = 前几章读者发懵", ["首现即注", "延后注"]),
        ("ledgerDiff", "boolean", True, "输出台账增量", "关掉 = 设定层与台账脱钩"),
    ],
    "prose/layer-scenes": [
        ("senseChannels", "number", 5, "五感计划的通道数", "降低 = 场景变扁平"),
        ("densityProfile", "enum", "随情绪波动", "笔墨密度的配比方式", "均一 = 读起来像说明书", ["均一", "随情绪波动"]),
        ("propsDepth", "enum", "陈列", "道具与布景的考据深度", "点到 = 快；考据 = 沉", ["点到", "陈列", "考据"]),
    ],
    "prose/layer-voices": [
        ("subtextDepth", "enum", "标准", "潜台词的显式程度", "提高 = 台词更耐读、更慢", ["浅", "标准", "深"]),
        ("maskTest", "boolean", True, "全员过遮名三句测试", "关掉 = 声口靠读者脑补"),
        ("perLineTag", "enum", "说话人+目的+潜台词", "每句台词的标注字段", "只标说话人 = 上下文不足", ["说话人", "说话人+目的", "说话人+目的+潜台词"]),
    ],
    "prose/novel-chapter": [
        ("chapterChars", "number", 3000, "单章目标字数", "提高 = 单章更沉、日更压力大"),
        ("hookStrength", "enum", "标准", "章末钩子强度", "提高 = 留存好、疲劳感上升", ["轻", "标准", "强"]),
        ("ledgerScope", "enum", "本拍", "台账切片的范围", "本阶段 = 更稳更慢", ["本拍", "本阶段"]),
        ("densityWave", "enum", "随情绪", "笔墨密度", "均一 = 无起伏", ["均一", "随情绪"]),
    ],
    "prose/novel-deai": [
        ("passes", "number", 4, "四遍法的遍数", "降低 = 省成本但覆盖律失效"),
        ("innerLoops", "number", 2, "精修内环轮数（判分→定向修订→收敛）", "提高 = 更收敛、更贵"),
        ("coverageLaw", "boolean", True, "覆盖律硬门槛（每条诊断必须被处理）", "关掉 = 诊断变成摆设"),
        ("metaphorBudget", "number", 6, "比喻意象的预算条数", "超标即视为堆砌"),
    ],
    "prose/novel-judge": [
        ("scale", "enum", "10分制", "评分标尺", "换 5 分制 = 与既有锚点样例不兼容", ["10分制", "5分制"]),
        ("dims", "number", 5, "评分维度数", "增加 = 更细也更慢"),
        ("worstThree", "boolean", True, "输出「最差三处」可执行反馈", "关掉 = 只有分数没有处方"),
        ("userVeto", "boolean", True, "用户判词恒优先于本表（§零否决权）", "关掉 = 与甲方意志冲突"),
    ],
    "prose/prose-assembler": [
        ("stampDims", "number", 6, "逐段六维盖章的维度数", "降低 = 拼装质量失控"),
        ("failFast", "boolean", True, "任一段未过即停（不带着问题下推）", "关掉 = 错误向下游放大"),
        ("beatFidelity", "enum", "严格", "对分场卡的忠实度", "允许微调 = 更顺但可能偏题", ["严格", "允许微调"]),
    ],
    "prose/render-prompt-seedance": [
        ("shotSec", "number", 5, "单镜头时长（秒）", "提高 = 镜头更少更慢"),
        ("cameraLock", "enum", "固定词库", "运镜词来源", "自由 = 模型理解不稳", ["固定词库", "自由"]),
        ("consistencyLock", "enum", "锁图", "跨镜头一致性的锁定方式", "锁描述 = 省图但漂移更快", ["锁图", "锁描述"]),
    ],
    "prose/script-final": [
        ("annotationLevel", "enum", "中括号备注", "特殊镜头/旁白的标注法", "内联 = 与台词混排，演员易误读", ["中括号备注", "内联"]),
        ("forbidInternalMark", "boolean", True, "禁止出现钩型/时长/尾钩等内部标注", "关掉 = 交付件泄露生产标记"),
        ("sceneHeaderStyle", "enum", "场次号+场景", "场次头写法", "简洁 = 与拍摄方约定不一致", ["场次号+场景", "简洁"]),
    ],
    # ── 检索域 ────────────────────────────────────────────────
    "search/deconstruct-book": [
        ("slots", "number", 6, "入库槽位数（梗/人设/剧情设计/导语/细化/片段）", "减少 = 拆书产出不完整"),
        ("variableReplace", "boolean", True, "产出带替换变量的模板条目", "关掉 = 素材不可复用"),
        ("traceability", "enum", "逐条溯源", "溯源纪律强度", "抽样 = 快但没法追责", ["逐条溯源", "抽样"]),
    ],
    "search/find-trope": [
        ("mainTropes", "number", 1, "主梗数量", "提高 = 焦点散"),
        ("subTropes", "number", 3, "辅梗数量", "提高 = 组合更新鲜也更难落实"),
        ("saturationCheck", "boolean", True, "判定梗族饱和度", "关掉 = 选到烂梗"),
        ("evolutionDepth", "enum", "两代", "沿演化链向上找的代数", "越深越新、越难写", ["一代", "两代", "链式"]),
    ],
    "search/internet-feel": [
        ("titleCount", "number", 10, "标题候选数", "提高 = 命中率上升、成本线性上升"),
        ("formulaDeck", "enum", "市场公式", "文案公式来源", "自创 = 不稳定", ["市场公式", "自创"]),
        ("templateCheck", "enum", "24类", "去模板化自检档位", "精简 = 漏检增加", ["精简", "24类"]),
    ],
    "search/material-dissect": [
        ("layers", "number", 4, "申论式剥离层数（现象/利益/权力/结构）", "减少 = 素材停在表面"),
        ("inversionCount", "number", 3, "关系逆位生成的爽点候选数", "提高 = 候选更多、筛选成本上升"),
        ("placement", "enum", "落位表", "素材落位方式", "散点 = 素材与结构脱钩", ["落位表", "散点"]),
    ],
    "search/topic-analysis-report": [
        ("sections", "number", 4, "报告板块数（市场/客群/竞品/数据）", "减少 = 分析不完整"),
        ("handoffSheet", "boolean", True, "输出创作约束移交单", "关掉 = 编剧步没硬约束"),
        ("dataCitations", "number", 5, "引用数据的条数下限", "降低 = 结论悬浮"),
    ],
    "search/topic-chief-aesthetic": [
        ("benchmark", "enum", "对标爆款", "强度标尺来源", "内部标准 = 与市场脱节", ["对标爆款", "内部标准"]),
        ("dims", "number", 3, "把控维度数（爆点强度/钩子冲击力/名场面可视化）", "减少 = 把控漏面"),
        ("writeInto", "boolean", True, "把控结论直接写入方案（视为终审通过）", "关掉 = 把控意见游离在方案外"),
    ],
    "search/topic-delivery-gate": [
        ("checklist", "enum", "逐条对账", "对「创作约束移交单」的核查方式", "抽样 = 硬条款可能漏", ["逐条对账", "抽样"]),
        ("vetoHard", "boolean", True, "硬条款违反一票否决", "关掉 = 合同风险自担"),
    ],
    "search/topic-proposal": [
        ("outlineDepth", "enum", "粗纲", "大纲的颗粒度", "细纲 = 更快进入成稿也更贵", ["粗纲", "细纲"]),
        ("firstEpisodes", "number", 3, "前三集初稿的集数", "提高 = 交付更重"),
        ("banBizLanguage", "boolean", True, "禁止出现商业分析语言", "关掉 = 方案串味"),
    ],
    "search/topic-zeitgeist": [
        ("windowDays", "number", 30, "情绪锚点的可举证时间窗（天）", "放宽 = 更容易凑数也更平庸"),
        ("evidenceCount", "number", 3, "锚点需要的举证条数", "降低 = 锚点是拍脑袋"),
        ("emotionAnchors", "number", 1, "锚定的社会情绪数", "提高 = 故事要兼顾的情绪更多"),
    ],
    # ── 确定性底座（tool 域）──────────────────────────────────
    "tool/kb_load": [
        ("dedupe", "boolean", True, "重复来源去重", "关掉 = 同一条款重复占预算"),
        ("sourceNote", "boolean", True, "每段带来源注记", "关掉 = 无法回溯条款出处"),
        ("maxChars", "number", 40000, "装载总字数上限", "超出即截断"),
    ],
    "tool/check_aesthetic_asserts": [
        ("scope", "enum", "整批", "检查范围", "单件 = 快但漏跨件一致性", ["单件", "整批"]),
        ("severityFloor", "enum", "block", "最低阻断级别", "调成 warn = 断言只提示不拦", ["warn", "block"]),
        ("dims", "array", ["钩型", "三件套", "时长", "密度", "梗点", "卡点", "合规", "编排表忠实性"], "参与的维度子集", "减少 = 检查更快、覆盖变窄"),
    ],
    "tool/check_trope_combo": [
        ("mode", "enum", "integrity", "检查模式", "strict = 更严，误报上升", ["integrity", "strict"]),
        ("skipMissing", "boolean", False, "缺产物时跳过而非阻断", "开启 = 静默放行风险"),
    ],
    "tool/render_html": [
        ("theme", "enum", "纸感", "交付页主题", "换了 = 交付观感变化", ["纸感", "暗色", "极简"]),
        ("maxSections", "number", 20, "合入的最大产物数", "提高 = 页面更全也更长"),
        ("inlineCss", "boolean", True, "样式内联（单文件离线可读）", "关掉 = 离开仓库即掉样式"),
    ],
    "tool/docx_ingest": [
        ("stripComments", "boolean", True, "解析后剥离原批注格式", "关掉 = 意见清单带格式噪声"),
        ("groupBy", "enum", "段落", "意见清单的分组方式", "按批注人 = 便于追责", ["段落", "批注人"]),
    ],
    "tool/continuity_slice": [
        ("sliceUnit", "enum", "章", "切片单位", "拍/场景 = 更细更慢", ["章", "拍", "场景"]),
        ("lookback", "number", 3, "回看范围（多少个单位）", "提高 = 更连续也更占预算"),
        ("includeRetired", "boolean", False, "是否包含已退役词条", "开启 = 噪声增加"),
    ],
    "tool/continuity_commit": [
        ("stateMachine", "enum", "draft/active/retired", "词条状态机", "自由 = 状态不可枚举", ["draft/active/retired", "自由"]),
        ("requireEvidence", "boolean", True, "回写必须带依据", "关掉 = 台账来源不明"),
    ],
    "tool/kb_search": [
        ("limit", "number", 8, "返回条目数上限", "提高 = 召回更全、上下文更挤"),
        ("tags", "string", "", "标签过滤（逗号分隔，空=不限）", "缩小 = 更准也更窄"),
        ("rerank", "enum", "关键词", "重排方式", "语义 = 更准但更贵", ["无", "关键词", "语义"]),
    ],
    "tool/meme_harvest": [
        ("sinceDays", "number", 30, "回看天数", "放宽 = 更全也更旧"),
        ("limit", "number", 20, "采集条数上限", "提高 = 素材更多、筛选成本上升"),
        ("sources", "array", [], "素材来源清单（空=默认源）", "限定来源 = 提升可控性"),
    ],
    "tool/kb_read": [
        ("mode", "enum", "全文", "读取模式", "摘要 = 省预算丢细节", ["全文", "摘要"]),
        ("maxChars", "number", 2000, "单条读取字数上限", "超出即截断"),
    ],
    "tool/flow_read_artifact": [
        ("which", "enum", "最新", "读取哪一版产物", "指定轮次 = 可复现历史判断", ["最新", "指定轮次"]),
        ("maxChars", "number", 4000, "单件读取字数上限", "超出即截断"),
    ],
    "tool/continuity_check": [
        ("dims", "array", ["矛盾", "知情范围", "伏笔逾期"], "参与的检查维度", "减少 = 更快但漏检"),
        ("severityFloor", "enum", "block", "最低阻断级别", "调成 warn = 只提示不拦", ["warn", "block"]),
    ],
    "tool/analyze-kakaxing": [
        ("topN", "number", 20, "题材×热度榜取前 N", "提高 = 样本更全"),
        ("genre", "string", "", "限定题材（空=全量）", "限定 = 更快更聚焦"),
    ],
    "tool/check-purity": [
        ("severityFloor", "enum", "block", "最低阻断级别", "调成 warn = 纯净度只提示", ["warn", "block"]),
        ("allowFrontmatter", "boolean", True, "允许 artifact@1 头部", "关掉 = 过程件也会被判污染"),
    ],
    "tool/export-doc": [
        ("style", "enum", "默认", "导出模板风格", "换了 = 交付观感变化", ["默认", "公文", "网文"]),
        ("verify", "boolean", True, "导出后计数/残渣硬断言", "关掉 = 交付失败不会被发现"),
        ("outDir", "string", "对外交付", "导出目录", "越界路径会被内核拒绝"),
    ],
    "tool/flow-kit-apply": [
        ("dryRun", "boolean", False, "只报告改动不写盘", "开启 = 安全预演"),
        ("keepSkill", "boolean", False, "迁移后保留 node.skill 兼容位", "保留 = 漂移风险"),
    ],
    "tool/flow-lint": [
        ("strict", "boolean", False, "warning 也视为失败", "开启 = 更严，可能卡住历史债"),
    ],
    "tool/flow-verify": [
        ("since", "string", "", "只看该时间之后的改动", "缩小 = 更快"),
        ("failOnMissingReceipt", "boolean", True, "声明了校验却无收据即失败", "关掉 = 虚报有缝可钻"),
    ],
    "tool/kit": [
        ("dest", "string", "projects", "vendor 目标目录", "改错 = 拷到不该拷的地方"),
        ("vendor", "boolean", True, "拷贝自治模型（含工具链）", "关掉 = 项目不自洽"),
    ],
    "tool/project-pages": [
        ("theme", "enum", "纸感", "工作台主题", "换了 = 观感变化", ["纸感", "暗色"]),
        ("embedFiles", "number", 20, "内嵌产物件数上限", "提高 = 页面更全也更重"),
    ],
    "tool/prose-scan": [
        ("threshold", "number", 0.5, "机味判定的阈值", "调低 = 更敏感误报多", ),
        ("dims", "array", ["配额", "句式", "比喻", "节奏"], "参与的统计维度", "减少 = 更快但画像不全"),
    ],
    "tool/render-flow": [
        ("layout", "enum", "纵向", "图示布局", "横向 = 宽图", ["纵向", "横向"]),
        ("theme", "enum", "纸感", "图示主题", "换了 = 观感变化", ["纸感", "暗色"]),
    ],
    "tool/serve": [
        ("port", "number", 8421, "监听端口", "占用时需改"),
        ("open", "boolean", False, "启动后自动打开浏览器", "开启 = 更顺手"),
    ],
    "tool/snapshot": [
        ("keep", "number", 10, "每节点保留的快照轮数", "提高 = 更可回溯也更占磁盘"),
        ("compress", "boolean", False, "快照压缩存储", "开启 = 省盘但不可直接读"),
    ],
    "tool/stage": [
        ("action", "enum", "list", "默认动作", "换动作 = 影响 CLI 默认输出", ["list", "validate", "tree"]),
    ],
    "tool/validate-kb": [
        ("strict", "boolean", False, "warning 也视为失败", "开启 = 更严"),
    ],
    "tool/whereami": [
        ("verbose", "boolean", False, "输出全部节点与输入清单", "开启 = 信息更全"),
    ],
    "tool/worldbook": [
        ("entries", "number", 50, "脚手架生成的词条上限", "提高 = 更全也更空"),
        ("crossLink", "boolean", True, "词条交叉链接", "关掉 = RAG 检索失效"),
    ],
}


def to_def(spec: tuple) -> dict:
    key, typ, default, desc, effect = spec[0], spec[1], spec[2], spec[3], spec[4]
    enum = spec[5] if len(spec) > 5 else None
    d: dict = {"type": typ}
    if default is not None or typ in ("string", "array"):
        d["default"] = default
    if enum:
        d["enum"] = list(enum)
    if typ == "number":
        d.setdefault("min", 0)
    d["desc"] = desc
    d["effect"] = effect
    d["tunable_by"] = ["user", "optimizer"]
    return d


def main() -> int:
    kits = sorted(ROOT.glob("kits/*/kit.json"))
    if not kits:
        print("ERROR 未找到 kits/*/kit.json")
        return 1
    covered, missing, touched = 0, [], 0
    for kp in kits:
        kit = json.loads(kp.read_text(encoding="utf-8"))
        kit_id = kit["id"]
        dirty = False
        for op_id, op in kit["ops"].items():
            full = f"{kit_id}/{op_id}"
            spec = TABLE.get(full)
            if not spec:
                if not ALLOW_GENERIC:
                    missing.append(full)
                if FORCE or "config" not in op:
                    op["config"] = {}
                    dirty = True
                continue
            covered += 1
            if "config" in op and not FORCE:
                continue
            op["config"] = {s[0]: to_def(s) for s in spec}
            dirty = True
        if dirty:
            touched += 1
            if not CHECK:
                kp.write_text(json.dumps(kit, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    total = sum(len(json.loads(p.read_text(encoding='utf-8'))["ops"]) for p in kits)
    mode = "check" if CHECK else ("force" if FORCE else "init")
    print(f"kit-config-{mode} ｜ {len(kits)} kits / {total} ops ｜ 表覆盖 {covered} ｜ 本轮写入 {touched} 个 kit")
    if missing:
        print(f"WARN  表未覆盖 {len(missing)} 个 op（将只吃通用四项 depth/strictness/maxChars/model_tier）：")
        for m in missing:
            print("      -", m)
        if not ALLOW_GENERIC:
            print("      修表或加 --allow-generic 放行")
            return 1
    if CHECK:
        bad = [f"{k['id']}/{op}" for p in kits for k in [json.loads(p.read_text(encoding='utf-8'))] for op, v in k["ops"].items() if "config" not in v]
        if bad:
            print(f"ERROR {len(bad)} 个 op 缺 config 声明：{', '.join(bad[:20])}")
            return 1
        print("OK 全部 op 已声明 config")
    return 0


if __name__ == "__main__":
    sys.exit(main())
