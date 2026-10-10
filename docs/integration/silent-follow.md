# 静默追写宿主协议 · 编辑器内快诊断

> 读者：要把 `diag_scan` 接进编辑器「边写边标红」体验的宿主（写作软件、插件）。
> 数据源动词：`POST /api/v1/verbs/diag_scan`（三脸同源，详见 [rest-api-reference.md](rest-api-reference.md)）。
> 纪律：**大模型不进静默诊断链路**（D5 决议）——本协议只在确定性通道上运行，零 token。

## 一、调用节拍（推荐口径）

| 场景 | 节拍 | 入参 |
| --- | --- | --- |
| 段落级追写 | 每段落落笔停顿 ≥1s 触发一次（防抖，不打断输入） | `text=<本段>` |
| 章级体检 | 每 N 字（建议 2000–4000）或每章收束时一次 | `path=<章节文件>` |
| 全量核账 | 交付/验收门前一次 | `path=<终稿>` ＋ `proposal=true`（显式开 A 级） |

响应里的 `timing_ms.total` 是本机实测口径（S 级进程内直调，毫秒级；以响应值为准，不硬编码预算）。
宿主侧超时建议 ≥2s；超时不重试轰炸，等下一节拍。

## 二、标红数据形状（= diagnosis-report@1 的 items 子集）

每个标红位对应 `report.items[]` 一项，四键：

```jsonc
{ "rule_ref": "pj-rules/slop-dev#AE-PROSE-SLOP", "tier": "S", "severity": "major", "suggestion": "<条款 repair 的反向表达>" }
```

- 定位到原文：拿 `report.evidence[]` 里同 `rule_ref`（或 `scanner`）的条目，其 `location`/`quote` 是机读定位；
- `evidence[]` 是机器证据（可复核、可标红），`items[].suggestion` 是规则卡 repair 的回显——**两者都不是裁决**，接受/忽略归宿主的用户；
- 折叠的其余命中读 `report.evidence[]`（全量证据），计数声明对 `report.receipt` 收据文件核账。

## 三、默认保守三律（宿主默认行为，逐条遵守）

1. **只回高置信 top1–2，其余折叠**：`items[]` 按 `severity`（block > major > minor）取前 1–2 条直接标红提示，其余进「查看全部」折叠面板——标红是打断成本最高的 UI 动作，宁缺勿滥。
2. **S 级先行**：默认调用不带 `proposal`（A 级 laya 学生头关）——S 级毫秒级、纯确定性，够撑静默追写；A 级推理秒级起，只进「全量核账」类显式动作。
3. **A 级仅显式开启**：`proposal=true` 是用户点出来的动作；且项目 `项目配置.json.validation.tierThreshold` 不含 A 时内核直接不跑（通道门槛，响应 `applied_validation` 可核对）。

## 四、错误路径契约

- 错误信封与全 API 同形：`{ok:false, error:{code,message,detail}, meta}`（[rest-api-reference.md](rest-api-reference.md) §四）。本协议会遇到的码：`NO_PROJECT`/`TARGET_MISSING` 404、`BAD_ARGS` 400、`LAYA_UNAVAILABLE` 503（A 级权重/venv 缺位，`message` 自带回填指引——宿主应展示指引而不是吞掉重试）。
- **错误响应必须 `no-store`**：任何缓存层/宿主侧 HTTP 缓存不得缓存非 2xx 响应（教训在案：错误响应被缓存会让「修好了」看起来「还坏着」）。kit 自有面已按此设头；宿主自建代理/端点转发本动词时照办。
- 坏项目配置（`INVALID_INPUT` 400）= 项目 `项目配置.json` 非法，宿主应引导用户修配置而不是降级缺省。
