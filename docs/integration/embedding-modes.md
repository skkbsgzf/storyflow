# 嵌入模式参考 · miniflow

> 面向：要把内核**装进自己进程/产品**里的人（不是"在外面调一下"的人）。
> 事实源：`core/src/kernel.ts`（`KernelOptions` / `Kernel`）、`core/src/schema.ts`（两个根 + 契约目录）、
> `core/src/abstraction/`（本轮 R1 新落的 FS/进程抽象层）。

## 零、四种模式，一句话各自

| 模式 | 怎么接 | 隔离 | 现在能用？ |
| --- | --- | --- | --- |
| **A. stdio 子进程（MCP）** | 宿主拉起 `node dist/mcp.js`，走 MCP 工具 | 进程隔离，内核持有文件写权 | ✅ 27 工具 |
| **B. HTTP 服务** | `npm run serve`，REST + 静态页同端口 | 进程隔离 | ✅ 见 [rest-api-reference.md](rest-api-reference.md) |
| **C. 同进程嵌入（in-process）** | `import { Kernel } from "@miniflow/core"` 后 `new Kernel(opts)` | **无隔离**，同 V8 同事件循环 | ⚠️ 能用，但见第二节的"硬约束" |
| **D. 浏览器 / WASM** | 纯前端跑内核 | 沙箱 | ❌ 前置未齐（R6/R7） |

选模式经验：
**外部消费 → A/B；宿主自己就是 Node 服务且想要零进程开销 → C；D 目前别排期**。

## 一、模式 C：同进程嵌入

```ts
import { Kernel } from "./core/src/kernel.js";

const kernel = new Kernel({
  root: "D:/data",              // 数据根：projects/ 所在处
  repoRoot: "D:/storyflow-kit", // 仓库根：flows/ modules/ knowledge/ contracts/ 所在处
  // flowsDir: 缺省 = repoRoot/flows
  // assertionPreset: 缺省 novel-fanqie；预设不可用时门控静默不激活
});

await kernel.flow_run({ flow: "novel-ghostwrite", project: "p-1", inputs: { 题材: "..." } });
```

三个必须知道的点：

1. **两个根分开给**。缺省都是代码仓库根。混用的历史事故：临时数据根下 kit 注册表解析为空，
   「55 个 tool 的配置项」与知识装载**一起静默失效**（不报错，只是什么都没有）。
2. **契约目录**由 `MINIFLOW_CONTRACTS_DIR` 或 `repoRoot/contracts` 决定，启动时 ajv 编译
   `SCHEMA_IDS` 全集。**换内核版本必须同时换契约**，否则落盘校验会假绿/假红。
3. **动词即 API**：三面派生自 `verbs.ts`，同进程嵌入也走同一批 `def.run(kernel, args)`——
   不存在"嵌入模式专有接口"。要拿细粒度内部函数（`loadState` / `effectiveFlow` / `buildTaskPackage`）
   可以，但那些**不在兼容承诺内**，升级时先 grep。

## 二、模式 C 的硬约束（现状，别绕）

- **缺省仍是 Node 真实文件系统**：R3 之后内核业务代码走注入的 `kernel.fs / kernel.path / kernel.proc`，
  而 `KernelOptions` 的缺省值就是 Node 适配器（`nodeFs/nodePath/nodeProc` 单例）——不注入 = 行为与 R3 之前逐字节相同。
  ⇒ 嵌入方**默认必须运行在 Node**（或给足 polyfill 的 Deno/Bun），且进程有目标目录读写权；
  要换宿主（内存盘 / 远端 FS）就注入自己的 `IFileSystem`，`core/test/abstraction-smoke.test.ts` 是可直接抄的样板。
- **三面入口还没接线**：`cli` `http` `mcp` `agent` `agent-mcp` `export-cli` `quality-cli` `schema` `static`
  这 9 个文件仍直接 `import node:*`（`schema.ts::ROOT` 更是「宿主目录字符串」这个概念本身）。
  清零是 R6 的出口判据，详见 FS1 规范 §3.1 复普查与 §六 偏离清单。
- **无租户隔离**：`root` 之下的 `projects/*` 全部可见可写；路径越界只在 agent 工具环里判（`withinProject`），
  动词层不判。多租户部署请回到模式 A/B 做进程/端口切分。
- **原子写与锁**：写盘是 `tmp + rename`（Windows rename 失败先删后写）；`LockDir` 是尽力锁（lockdir），
  单写者纪律靠约定，不靠强制。**同一项目目录不要并发双开**。
- **BETA 留痕**：仓库根有 `BETA` 标记文件时，CLI/MCP 动词调用会追加写 `trace/cli.jsonl`。
  嵌入模式下这条不自动触发（它挂在 CLI/MCP 出口），需要宿主自己决定是否留痕。

## 三、模式 D 的前置：FS/进程抽象层

要在非 Node 环境跑内核，先得让内核**不直接碰 node:***。R1 落地基，R3 把内核核心（P0＋P1＋P2 共 33 个源文件）接了上去：

```
core/src/abstraction/
  fs.ts             IFileSystem · IFsPath · FsStats · FsEntry · {Mkdir,Remove,Copy}Options
  proc.ts           IProcessLauncher · ProcResult · ProcOptions · ProcExecutionError
  adapters/node.ts  NodeFsAdapter · NodePathAdapter · NodeProcLauncher（+ nodeFs/nodePath/nodeProc 单例）
  adapters/mock.ts  MockFsAdapter · MockPathAdapter · MockProcLauncher（内存实现，测试用）
```

- 接口方法集**由调用面普查反推**（`docs/规范-FS抽象层-FS1.md` §3.1 的原始调用计数），不是想象出来的理想 API；R6 追加的 `IFsPath.fromFileUrl` / `IProcessLauncher.detach` 同一条规矩（各自一处真实调用点，见 §3.1「R6 复普查」）。
- 内存适配器**不模拟时序**：`watchDir` 靠 `fire()` 显式驱动，`runAsync` 直接复用同步注册应答——要测超时就得自己给一个带 `timedOut` 的 handler。
- 语义对齐：`NodeFsAdapter.writeTextAtomic` 与原 `fsio.ts` 逐行同语义（退役件已删，原子写＋锁目录现收编在 `abstraction/jsonio.ts`）；
  Node/mock **同语义对表**由 `core/test/abstraction-mock.test.ts` 断言（同一份操作脚本跑两个适配器）。
- 错误码保真：mock 抛 errno 形状（`ENOENT/EEXIST/ENOTDIR/EISDIR/ENOTEMPTY`）。这是硬要求——
  `aesthetic.ts:94` 就分支在 `code === "ENOENT"` 上，抽象层丢了 `code` 就是行为变更。

**当前接线状态**：

| 项 | 状态 |
| --- | --- |
| 接口 + 两个适配器 + 自测 | ✅ R1 |
| `KernelOptions` 增 `fs?/path?/proc?` 注入位（`Kernel` 上 `readonly fs/path/proc`） | ✅ R3 |
| 内核核心文件改吃注入的 `fs` | ✅ R3（P0＋P1＋P2 共 **33 个源文件**，比工单原排的「R3 只做 P0 18 个」提前合并） |
| 旁路台账（journal/diag/metrics/decisions）改必传 `io` 束 | ✅ R3（漏传由编译器拦：剥掉 `= nodeFs/nodePath` 默认后 `tsc` 报 TS2554，收口时 0 处） |
| 世界书 / KB / minitool 改吃注入 | ✅ R3 迁移、R5 补**运行时证据**（工单 R5 卡面把这三项排在 R5，盘面实为 R3 的 P0 批次已迁；`core/test/fs-call-matrix.test.ts` 把 `worldbook_search` / `kb_search` / `continuity_slice` 三条链跑在内存盘上并断言宿主盘零泄漏） |
| 外围 9 个宿主面文件清零 | ✅ R6（出口判据达成：`abstraction/` 之外零 `node:fs` / `node:path` / `node:child_process`；运行时证据 `core/test/r6-host-free.test.ts`——agent 会话面、`fs_*` 工具族、系统提示、`flow_lint`、静态面 `GET /` 全在内存盘上跑完。R4 新增的 `api-v1.ts` 一开始就只经 `kernel.fs/path`，不在这 9 个里。**非 FS 族**宿主绑定六处仍在宿主件，逐条见 FS1 §3.1「R6 复普查」的死表，处置归 R7） |
| `@storyflow/core` + `@storyflow/adapters` 拆包 | ❌ 未做（R7） |
| mock 上跑通整条 flow 冒烟 | ✅ R3（`abstraction-smoke.test.ts` 4 用例：`flow_run`→`flow_submit` 全程内存盘，产物/注册表/journal/metrics 不落宿主目录，语料逐字节不变） |

⇒ 换句话说：**内核核心与外围入口都已能在注入的假 FS 上跑通**（R3 内存盘冒烟 ＋ R5 三条调用链 ＋ R6 宿主面四张面，判据都是「跑完宿主盘零泄漏」而非 grep），
但「可嵌入」仍不等于「可换宿主」。剩下的卡点两处，都不在 FS 族：
① **非 FS 族宿主绑定六处**（`node:process` ×3 / `node:net` ×1 / `node:crypto` ×1 / `node:module` ×1）——熵源、端口探测、env、`createRequire` 是宿主本职；
② **R7 拆包**——门禁是「`@storyflow/core` 在没有 `@types/node` 的 tsconfig 下 tsc 通过」，那才是浏览器/WASM 的真前置。
在此之前请按「同进程嵌入 ＝ Node 环境」规划（§一 硬约束那条不变）。

## 四、启动与依赖（所有模式通用）

```bash
cd core && npm install          # node_modules 在 git 跟踪内（本仓策略）
npm run build                   # tsc → dist/；宿主注册 MCP 走 dist/mcp.js，必须先 build
```

- 包：`@miniflow/core`（`"type": "module"`，**纯 ESM**），`bin.miniflow = ./dist/cli.js`。
- 运行时依赖只有 5 个：`fastify` / `@fastify/cors` / `@modelcontextprotocol/sdk` / `ajv` / `js-yaml`。
  没有数据库、没有队列、没有构建工具链依赖 ⇒ 嵌入方负担小。
- NodeNext 解析：**导入本项目源码时写 `.js` 后缀**（`import { Kernel } from "./kernel.js"`），
  tsx 直跑与 tsc 产物两条路都吃这个约定。
- 类型检查门槛：`strict` + `noUncheckedIndexedAccess`（索引访问必判空）。

## 五、可观测与故障排查

| 想看什么 | 去哪看 |
| --- | --- |
| 项目实时状态 | `GET /api/projects/{id}/live`（`revision` / `filesRevision` 两指纹决定要不要重渲染） |
| 旁路失败（不该静默的那些） | `GET /api/diagnostics`（仓库级）与 `/api/projects/{id}/diagnostics`（项目级），`count>0` ⇒ 本项目某个结论可能不可信 |
| 动作留痕 | `projects/<id>/journal/`；BETA 期另有 `trace/cli.jsonl`（含 `via:"cli"\|"mcp"`） |
| 编排真相 | `registry/effective.json`（生效编排 = flow ⊕ 出厂 overlay ⊕ 项目 overlay ⊕ kit 边界派生，单点 `overlay.ts::effectiveFlow`） |
| 动词面/工具面一致性 | `node scripts/gen-verbs-doc.mjs --check`（文档与 `verbs.ts` 对账） |

## 六、集成检查清单（接入方自查）

1. 两个根分别指对了吗？（`root` ≠ `repoRoot` 时尤其）
2. 契约目录与内核版本配对吗？
3. 只走动词，还是也引了内部函数？后者要写清"不承诺兼容"。
4. 同一项目目录有没有第二个写者？
5. 门与决策：`flow_gate` / `set_decision` 交回给人了吗？（见 `docs/Agent.md` 第五节）
6. 密钥：`.external/*` 或环境变量，**永不进 payload / journal / 提交物**。
7. 若目标是沙箱嵌入（D）：先确认 R6/R7 已完成，否则方案不成立。
