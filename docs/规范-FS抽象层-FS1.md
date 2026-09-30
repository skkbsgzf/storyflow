# 规范 · FS 抽象层 FS1（v1.0）

> 落地轮：R1（接口 + Node/mock 适配器）→ R3（内核核心迁移）→ R5（世界书/KB + SSE）→ R6（外围）
> → R7-1（**平台缺省适配器注册面**，§4.1）→ R7-2（core 包净身）→ R7-3（拆包发布）。
> 工单：`docs/工单-20261001-预设收尾与FS抽象层.md`。
> 本规范的接口集合**由现状调用面反推**，不是先画接口再找调用点。§3.1 的普查数字即证据，改接口须先改普查。

---

## 一、目标与非目标

**目标**：让内核语义与宿主 IO 解耦，使「同一份内核代码」能跑在三种盘上——真实文件系统（Node）、内存（测试/冒烟）、以及未来的浏览器/WASM（R7 拆包后的 Virtual 适配器）。判定标准自 R7-1 起是**两条**：① `core/src` 除 `abstraction/` 外不出现 `node:fs`、`node:path`、`node:child_process`；② 除豁免区（`abstraction/adapters/`）与死表所列七个宿主入口件外，core 侧不 import 任何适配器实现——缺省一律走 `abstraction/defaults.ts` 的注册表（§4.1）。只查 ① 会漏掉「import 了 Node 实现但没用 `node:*`」这种半抽象，②就是补这一刀的门。

**非目标**：
- 不做异步化。现网 100% 同步调用（`*Sync`），抽象层照旧同步；异步是另一笔账，不在本轮混入。
- 不做通用 VFS。只覆盖内核真实用到的原语，其余一律不进接口（宁缺毋滥，加了没人调 = 漂移源）。
- 不改写现有行为。适配器的职责是「换管道不换水性」，任何语义差异必须在 §3.3 表上明写。

---

## 二、接口（v1）

### 2.1 `IFileSystem` / `IFsPath`（`core/src/abstraction/fs.ts`）

```ts
interface IFileSystem {
  readText(path): string                  // 缺失即抛（ENOENT）
  readBuffer(path): Uint8Array            // 仅一处调用：静态文件服务
  writeText(path, text): void             // 不建父目录
  appendText(path, text): void
  writeTextAtomic(path, text): void       // tmp+rename+Windows 回退；自动建父目录
  exists(path): boolean
  stat(path): FsStats | undefined         // 缺失返回 undefined，不抛
  readDir(path): string[]
  readDirEntries(path): FsEntry[]         // Dirent 的替身，只暴露 isFile/isDirectory
  mkdir(path, {recursive?}): void         // recursive:false 且已存在 → 抛 EEXIST
  remove(path, {recursive?, force?}): void
  rename(from, to): void
  copy(from, to, {recursive?}): void
  watchDir(path, onChange): () => void    // 见 §5
}
interface IFsPath {
  join / resolve / dirname / basename / extname / relative / sep / posixJoin / format
  fromFileUrl(url): string              // R6 追加（`node:url` 收进豁免区），调用点见 §3.1 R6 复普查
}
```

三条设计决断，实现者不得自行改判：

1. **`stat` 不抛**。现网 `statSync` 28 处里绝大多数前面跟着 `existsSync`，合并成一次调用；返回 `undefined` 比抛错少一条 try/catch，也更贴近「探针」语义。
2. **`run` 与 `exec` 并存**（§2.2）。两者各对应一处真实调用且**判断逻辑不同**（一个看 status，一个靠抛错），合并会逼 R3 改判断，属于「换水性」。
3. **`posixJoin` 与 `sep` 分开**。产物内的相对路径跨平台必须恒为 `/`（现网 `path.posix.join` 2 处即为此），不能由平台 `sep` 推导。

### 2.2 `IProcessLauncher`（`core/src/abstraction/proc.ts`）

```ts
interface IProcessLauncher {
  run(cmd, args, opts?): ProcResult       // 永不抛；status/error 自带失败信息
  exec(cmd, args, opts?): string          // 非零退出或启动失败 → ProcExecutionError
  runAsync(cmd, args, opts?): Promise<ProcResult>   // R3 追加的第三形态，依据见本节末
}
```

`ProcResult = { status: number|null, stdout, stderr, error?, signal?, timedOut? }`。`error` 对应 `spawnSync` 的 `r.error`（解释器不存在这类启动层失败），与「跑起来了但退 1」是两回事，不许折叠；`signal` / `timedOut` 同理——「超时被 SIGTERM 杀掉」和「脚本自己退非零」在 `minitools.ts` 的脚本壳里走两条不同报错文案，折叠即丢诊断。

**`runAsync` 是 R3 追加的**，它不违反 §一「不做异步化」：现网 `minitools.ts:121` 的脚本壳本来就是 `promisify(execFile)`（带 `timeoutMs` + `killSignal`，docx 导出这类最长 60s）。换成同步 `run` 会把 HTTP/MCP 宿主整个冻住，所以抽象层照搬既有异步形态。**口径仍然收窄**：没有异步调用点的地方一律同步，本轮不主动异步化任何一件原本同步的事。

**`detach` 与 `fromFileUrl` 是 R6 追加的两件**，走的仍是同一条口径：先有调用点，再进接口（普查见 §3.1 R6 复普查），§四第 5 条不是走过场。
- `detach(cmd, args)` **不返回结果、失败只以抛错表达**：`cli.ts` 的 `up --open` 要的是「把浏览器递出去就完事」。用 `run` 会把 `spawnSync` 的退出码语义硬塞给一个本不该等的动作，用 `exec` 更是直接抛——两者都要调用方改写判断逻辑，属于 §2.2「不合并形态」的同一个理由。
- `fromFileUrl(url)` 现网唯一调用点是 `schema.ts` 用 `import.meta.url` 定位包根。§四第 4 条的豁免区只有 `abstraction/adapters/*`，把它留在宿主件里就是 R6 收口后最后一条 `node:url` 尾巴。Mock 实现按字面剥前缀并解码——虚拟盘上「模块在哪」本无意义，不接平台细节。

---

## 三、现状调用面（v1 的依据）

### 3.1 原语普查（`grep` 于 2026-10-01，`core/src`，**不含** `abstraction/`）

| 原语 | 次数 | 原语 | 次数 |
|---|---|---|---|
| `readFileSync` | 98 | `rmSync` | 6 |
| `existsSync` | 94 | `renameSync` | 5 |
| `mkdirSync` | 40 | `appendFileSync` | 5 |
| `readdirSync` | 31（其中 `{withFileTypes:true}` 3 处） | `cpSync(recursive)` | 2 |
| `statSync` | 28 | `copyFileSync` | 2 |
| `writeFileSync` | 23 | `unlinkSync` / `rmdirSync` | 各 1 |
| 非 utf-8 读（Buffer） | 1（`http.ts:249`） | `spawnSync` / `execFileSync` | 各 2 |

`path.*` 用量：`join` 241、`resolve` 24、`dirname` 19、`basename` 17、`relative` 12、`sep` 7、`extname` 3、`posix.join` 2、`format` 1。

按 errno 分流的地方**只有一处**：`aesthetic.ts:94` 判 `code === "ENOENT"`。因此 mock 的异常必须带 `code`，否则这处分流会在内存盘上静默改变行为。

**R3 复普查（2026-09-30，同一命令）**：除 `abstraction/` 外仍 import `node:(fs|path|child_process)` 的文件 = **9 个**（开工时 44）——P3 的 7 个宿主入口（`agent.ts` `agent-mcp.ts` `cli.ts` `mcp.ts` `http.ts` `static.ts` `schema.ts`）加两个入口桥（`export-cli.ts` `quality-cli.ts`：动词调用已改为显式吃 `k.fs` / `nodeFs`，文件自身仍是 CLI 宿主面）。**P0/P1/P2 已清零**。另两条追加：`promisify(execFile)` 1 处（脚本壳）走 `proc.runAsync`；`node:crypto` 1 处（`ids.ts` 的 sha1）**不在 FS1 判据内**——把 crypto 加进 grep 会得到 10 个文件，那第 10 个就是它，它不碰路径，见 §六 D7。

**R6 复普查（2026-09-30）**：上面那 9 个宿主面文件**全部清零**。复现命令两条，口径不同，都要跑：
```bash
grep -rln "node:fs" core/src --include="*.ts"        # 出口判据原文：只剩 abstraction/adapters/node.ts（fs.ts 那条是注释提法，不是 import）
grep -rn 'from "node:\|import("node:' core/src --include="*.ts" | grep -v abstraction/adapters/   # import 形态：动态 import 一样算宿主绑定
```
第二条的盘面输出就是下面这张例外表，逐字钉在 `core/test/r6-host-free.test.ts` 里做**双向**断言（多一处=新长出一条尾巴，少一处=本表过期）：`cli.ts` 的 `node:process`＋`node:net`（`pickFreePort` 的端口探测只有 net 有）、`export-cli.ts` 与 `quality-cli.ts` 的 `node:process`、`ids.ts` 的 `node:crypto`、`kernel.ts` 的 `node:module`（`createRequire` 读 package.json 版本）。共 6 处，**非 FS 族，出口判据不计**，留给 R7 拆包按包边界处置（§六 D-R6-6）。

**接口扩容两件的调用点**（§四第 5 条要的那张普查）：`fileURLToPath` 1 处 = `schema.ts:15` 的包根定位；`spawn(…,{detached:true}).unref()` 1 处 = `cli.ts` 的 `openBrowser`。

§3.2 名单里工单点过名却没进过批次的 `verbs.ts` 一并复核：**零 `node:*` import**（盘面唯一命中 `node: flags.node` 是字段名，不是模块）。

### 3.2 迁移矩阵（文件 → 批次 → 轮次）

| 批次 | 归属轮 | 文件数 | 清单 |
|---|---|---|---|
| P0 | R3 | 18 | `kernel.ts` `kernel-{run,view,optimize,config}.ts` `state.ts` `registry.ts` `asserts.ts` `minitools.ts` `project-config.ts` `compat.ts` `kb.ts` `fsio.ts`（退役） `assertion-preset/{discovery,executor,index,mount,resolver}.ts` |
| P1 | R6 批一 | 4 | `modules.ts` `overlay.ts` `assembler.ts` `aesthetic.ts` |
| P2 | R6 批二 | 11 | `metrics.ts` `diag.ts` `decisions.ts` `skills.ts` `kits.ts` `optimize.ts` `selection.ts` `intent.ts` `cfg-template.ts` `profiles.ts` `production-preset.ts` |
| P3 | R6 批三 | 7 | `agent.ts` `cli.ts` `mcp.ts` `http.ts` `static.ts` `verbs.ts` `schema.ts` |
| **工单未列名** | 需补排 | **4** | `agent-mcp.ts` `export-cli.ts` `journal.ts` `quality-cli.ts`（均直接用 `node:fs`/`node:path`，P0–P3 任何一批都没提它们） |

**四批合计 44 = 盘面实测全集**（`grep -rlE "node:(fs|path|child_process)" core/src --include="*.ts" \| grep -v abstraction/` = 44 行，R1 结束时一条不少一条不多）。

**这一段是 R1 的实际发现，不是笔误**：工单 R3 的写集标题是「8+ 文件 / 上述 10 文件」，
盘面实测 **P0 = 18**；工单 R6 的三批共 22 个文件，盘面外围实测 **26**（多出的 4 个即上表末行）。
差距来自 0.10.0 的 kernel 拆分与 `assertion-preset/` 新增目录。R3/R6 开工前以本表为准；
另外工单 R3 清单里点到的 `kernel-base.ts` **不在盘面 44 之列**（它只放 `KernelError`，无 fs/path 依赖），已剔除。
出口判据仍是 `abstraction/` 之外零 `node:*`。工单 R3 关键设计里点名的 `spawn.ts` **不在普查面上**：
它是纯文本渲染器（任务包 → spawn prompt，`renderSpawnPrompt`），不碰 `child_process`；真正起进程的是
`compat.ts`（`proc.run`）与 `minitools.ts`（`proc.runAsync`）两处，本轮已改吃 `IProcessLauncher`。

**R3 实际写集 = P0 + P1 + P2 全部 33 个文件，不是工单原排的「P0 18 个」**。理由：P1/P2 与 P0 互相调用（`kernel-run.ts` 直接调 `modules.ts`/`overlay.ts`/`aesthetic.ts`/`metrics.ts`），只迁 P0 会让被调方继续以尾参默认吃宿主盘——抽象层刚立就漏，且「半抽象」违反 §四第 3 条。R6 因此只剩 P3 的 7 个入口文件 + 2 个入口桥。

**R5 复核（工单 R5 的门禁项「§3.2/§4.2 调用矩阵全销账」）**：

- 卡面点名的三个 FS 化对象 `kb.ts` / `kernel-view.ts` / `minitools.ts` **在 R3 已迁完**（P0 批次；复普查里查无它们），
  所以 R5 没有新的 FS 化写集。为防「文档说迁了、盘上没人验过」，R5 补的是**运行时证据**：
  `core/test/fs-call-matrix.test.ts` 把世界书检索、`kb_search`、`continuity_slice` 三条调用链跑在 `MockFsAdapter` 上，
  并断言宿主盘没有泄漏目录——三条全绿即 §3.2 里这几行的迁移不是纸面账。
- **本文没有 §4.2**：章节号到 §3.3 语义对表，其后是「四、注入纪律」（无子节）。卡面那处引用按 §3.2（迁移矩阵）＋ §3.3（语义对表）理解，不是本文漏写了一节。
- R5 收口时的宿主面名单（复现：`grep -rlE "node:(fs|path|child_process)" core/src --include="*.ts"` 再 `grep -v abstraction/`）
  ＝ **9 个**，与 R3 收口时逐字相同：`agent.ts` `agent-mcp.ts` `cli.ts` `export-cli.ts` `http.ts` `mcp.ts` `quality-cli.ts` `schema.ts` `static.ts`。
  R5 新增的 `sse.ts` / `project-stream.ts` **零** `node:*`——`watchDir` 走注入的 `IFileSystem`（这正是拍板点① 把 `watchDir` 放进 v1 的用意），
  所以 R6 的开工面就是上面这 9 个，一条不多。

**R6 收口（销账）**：这 9 个文件全部改完，出口判据达成（复现命令见 §3.1 R6 复普查）。三条如实登记：
- **卡面 P1/P2 无写集**：P1 的 4 件（`modules.ts` `overlay.ts` `assembler.ts` `aesthetic.ts`）与 P2 的 11 件在 R3 就随 P0 一起过了（见上方「R3 实际写集」段），R6 真实开工面是 P3 的入口件＋两个入口桥共 9 个文件，不是卡面 22 个。
- **「换 import 源」不等于「吃注入」**：`cli.ts` `mcp.ts` `quality-cli.ts` `export-cli.ts` `schema.ts` 按 §四第 1/2 条**显式**使用 `nodeFs`/`nodePath`（入口件本职——BETA 留痕与包根定位仍写宿主盘，改吃注入反而会把台账写进内存盘）；真正换成吃 kernel 的是 `agent.ts` `http.ts` `static.ts` `agent-mcp.ts` 四件。运行时证据 = `core/test/r6-host-free.test.ts`：会话 CRUD、`fs_*` 工具族、`buildSystemPrompt`、`flow_lint`、静态面 `GET /` 全部在 `MockFsAdapter` 上跑完，跑断言宿主盘没长出 `/mock-r6-*` 那棵树。
- **漏传门（§四第 7 条）实抓两处**：`mcp.ts` 的 R4 资源面两处 `contentTypeOf(rel)` 没传 `kernel.path`，剥掉尾参默认后 TS2554 点名——这是 §四第 2 条「尾参默认漏传也编译通过」的现行犯，已修（改传 `kernel.path`）。复跑 TS2554 = 0。

### 3.3 语义对表（适配器之间不许漂移）

| 方法 | Node 实现 | Mock 实现 | 现网依赖点 |
|---|---|---|---|
| `writeTextAtomic` | 建父目录 → 写 `p.tmp-<pid>-<rand>` → rename；rename 失败则删目标再 rename | 建父目录 → 一次性替换，不留 tmp | `fsio.ts` 全部写入、registry/state/journal |
| `mkdir` 非递归 | 已存在抛 `EEXIST`，父缺失抛 `ENOENT` | 同 | `LockDir.acquire`（互斥全靠这条） |
| `stat` | 先 `existsSync` 再 `statSync`，缺则 `undefined` | Map 查表 | 快照时间戳、陈旧锁判定（`mtimeMs`） |
| `readDir` | 不排序（排序留给调用方） | 同 | 现网 31 处里大量自己 `.sort()` |
| `remove` | `rmSync` 承接 `unlinkSync`/`rmdirSync` | 子树删除；空目录外非递归删目录抛 `ENOTEMPTY` | 清理与回滚 |
| `copy` | `recursive` 走 `cpSync`，否则 `copyFileSync` | 同 | 项目复制（`compat.ts` 2 处）、附件拷贝（`kernel-run.ts`/`verbs.ts`） |
| `exec` | 非零抛 `ProcExecutionError(status,stderr)` | 按注册应答，非零同样抛 | `verbs.ts:113` 世界书批处理 |
| `run` | `spawnSync`，`error` 字段保留 | 未注册 → `status:127 + error` | `compat.ts:100` 页面生成器 |
| `runAsync` | `promisify(execFile)`，超时/信号拆成 `timedOut`/`signal` | 直接复用注册应答（不模拟时序；要超时就给一个带 `timedOut` 的 handler） | `minitools.ts:121` 脚本壳 |
| `writeTextAtomic` 取代手写「建目录 + tmp + rename」 | 与退役的 `fsio.atomicWriteText` 逐字节同形（`JSON.stringify(o,null,2)+"\n"`） | 整文件替换，不留 tmp | `writeJsonAtomic` 全部落点（state / registry / effective / decisions） |
| `exists` + `stat` 合并 | 旧代码两次探针，现一次 | Map 查表 | 快照时间戳、`LockDir` 陈旧锁判定 |
| `remove` 取代 `rmdirSync` / `unlinkSync` | `rmSync` 的 `force`/`recursive` 承接两种老写法 | 非递归删非空目录抛 `ENOTEMPTY` | 清理与回滚、`compat.ts` 归档 |
| `stat()?.isDirectory` 取代 `statSync().isDirectory()` | `FsStats.isFile`/`isDirectory` 是**布尔字段**，当方法调会 TS2349 | 同 | 目录遍历；`readDirEntries` 的 `FsEntry` 同理 |
| `path.posix.dirname/basename` 无对应物 | 注入的 `path` 是平台实现，`IFsPath` 只有 `posixJoin` | 恒 posix | `modules.ts` 两处——产物内相对路径的归一仍在调用点 `rel.replaceAll("\\", "/")` 单点做 |

---

## 四、注入纪律（R3 起生效）

1. **构造函数注入**：`KernelOptions` 增 `fs?: IFileSystem` / `path?: IFsPath` / `proc?: IProcessLauncher`，缺省 = **当前注册的平台缺省适配器**（`abstraction/defaults.ts`，机制见本节末 §4.1）。R7-1 之前这条写的是「Node 适配器（`nodeFs`/`nodePath`/`nodeProc`）」——那个实例现在只属于宿主入口件与注册表里登记的那一家，core 侧拿到的同名对象是查表的转发。
2. **模块级只读函数不引全局单例**：签名加尾参 `fs: IFileSystem = nodeFs` / `path: IFsPath = nodePath`，调用方从 kernel 透传。理由与 `kernel: Kernel` 传参同构——显式、可测、不留隐式全局态。**写路径不享有这条默认值**（第 6 条）。**R7-1 实测口径**：这类尾参默认全仓 **166 处**（`fs` 78 / `path` 85 / `proc` 2 / `io` 束 1），分布在 **28 个文件**；其中 156 处（27 文件）的默认值自 R7-1 起取自注册表，10 处仍在宿主入口 `cfg-template.ts` 直连 Node 单例（§4.1 末的死表）。数字逐处锁在 `core/test/defaults-registration.test.ts` 的普查用例，改正则口径要连那个断言一起改。
3. **禁止半抽象**：一个文件进了某批次就必须一次过，不许留 `import fs from "node:fs"` 的尾巴（出口判据按文件计数）。
4. **适配器之外不许 import `node:*`**（`abstraction/adapters/*` 是唯一豁免区）。R6 后的达成度分两档说：**FS 族（fs / path / child_process）已零**，这是工单 R6 的出口判据；**非 FS 族还剩 6 处**（`node:process` ×3、`node:net` ×1、`node:crypto` ×1、`node:module` ×1，逐条见 §3.1 R6 复普查）。这条纪律的完整达成在 R7 拆包，但**门禁写法以工单 R7 的「开工前实测」为准**：字面那条「core 包在无 `@types/node` 的 tsconfig 下 tsc 通过」是空转的（fastify/MCP SDK 的 d.ts 带 `/// <reference types="node" />`，传递性把 `@types/node` 拉回类型图），所以能落地的门是两条——**① import 普查双向死表**（`r6-host-free.test.ts` ＋ §4.1 的注册普查）＋ **② 依赖出包**（core 包不留 fastify/MCP SDK，否则「无 node 类型」永远只是自证）。
   **R7-1 又加一层普查**：豁免区之外仍 import Node 适配器的只剩**七个宿主入口件**（`cli.ts` `mcp.ts` `export-cli.ts` `quality-cli.ts` `http.ts` `schema.ts` `cfg-template.ts`），逐字死表双向断言在 `core/test/defaults-registration.test.ts`。这条是「谁还能碰宿主实现」的名单，与上面「谁还在 import `node:*`」是两张表，别混。
5. **接口扩容须走普查**：想加方法先在 §3.1 找到调用点；找不到调用点的方法不进 v1。
6. **台账/写路径用必传首参 `io: FsIo`**（`FsIo = { fs, path }`，`Kernel` 结构上即满足）：`journalAppend(io, dir, …)`、`recordDiag(io, dir, …)`、`readMetrics(io, dir)`、`setDecision(io, …)`。理由不是风格：尾参默认**漏传也编译通过**，结果是台账静默写进真宿主盘——嵌入式宿主上就是数据泄漏。必传首参把这件事交给编译器。
7. **漏传检查是可复现的门**（R3 实测口径）：把 `src`（除 `abstraction/`）里所有 ` = nodeFs` / ` = nodePath` 尾参默认临时剥掉，再跑 `tsc --noEmit`，报出的 `TS2554` 就是全部漏传调用点（`TS1016` 是剥离动作本身的副产物，与调用点无关）。R3 收口时 **TS2554 = 0**。这条门不是仪式感——它实抓了一处：`kernel.ts::ctx` 的 `loadState(projectDir)` 一直吃宿主盘，由 §六 末的内存盘冒烟逼出来。

**R6 复现修正（口径同一条，命令要写准）**：剥离必须按**类型标注形态**做，不能按字面 ` = nodeFs` 粗剥——
```bash
cp -r src .leakcheck/src && sed -i 's/: IFileSystem = nodeFs/: IFileSystem/g; s/: IFsPath = nodePath/: IFsPath/g; s/: IProcessLauncher = nodeProc/: IProcessLauncher/g; s/: FsIo = { fs: nodeFs, path: nodePath }/: FsIo/g' $(find .leakcheck/src -name '*.ts')
npx tsc -p .leakcheck/tsconfig.json --noEmit | grep TS2554    # 期望：无输出（=0）
```
按字面粗剥会把常量初始化一起削掉（`const X = nodePath.join(…)` → `const X.join(…)`），满屏 TS1005 假语法错，真漏传反倒被埋掉——R6 第一遍就这么跑的，22 条 TS1005 里一条 TS2554 都没剩下，那条门当场失效。R6 收口：**TS2554 = 0**，TS1016 = 8（副产物：`projectDir?: string` 之后跟一个必需参数，同 R3 口径）。

### 4.1 平台缺省适配器的注册面（R7-1 新增）

拆包要求 `@storyflow/core` 不 import 任何宿主实现，而 §四第 2 条的 166 处尾参默认仍要有一个「缺省值」。两全只有一招：**把「缺省」从一个实例改成一次查找**。

- **表**：`core/src/abstraction/defaults.ts`（零 `node:*`、不 import 任何适配器实现）导出 `registerAdapters({ fs, path, proc })` / `currentAdapters()`，以及三个转发对象 `nodeFs` / `nodePath` / `nodeProc`（`Proxy` 逐次调用查表，方法绑回注册实例）。
- **谁注册**：Node 宿主 = `adapters/node.ts` 末行的 side-effect（入口件 import 它即完成登记）；core 测试 = `core/vitest.config.ts` 的 `setupFiles: ["./test/setup-adapters.ts"]`；跨包消费者 = 自家 Node 测试里自行 import 适配器件（实测案例：`storyharness/test/kit-wiring.test.ts` 补了这一行）。**这张表同时是「宿主该做什么」的唯一说明面**——浏览器/WASM 宿主照 `setup-adapters.ts` 那行换成自家实现即可，core 侧零改动。
- **未注册就用 = 抛错点名**，不静默回落。理由同第 6 条：回落任何一家实现都会让「core 不依赖宿主」在运行时被悄悄违背，嵌入式宿主上就是数据写错盘；抛错至多启动失败，写错盘不可追回。
- **转发对象身份稳定**（进程内 `nodeFs === nodeFs`），所以 D4 的「按适配器身份分桶」缓存语义与 R6-4 的 `mcpFor` WeakMap 分桶不变——注册后的平台缺省仍是一个桶。
- **重复注册以后者为准**，且表只登记引用、不复制不包装：测试换假盘、宿主换实现都靠这条；换进去的对象行为即转发对象行为。
- **时机**：尾参默认表达式在**每次调用**时求值，所以注册时机不受 import 顺序约束；入口件先 import 适配器、内核函数随后调用，是本仓所有 CLI/MCP/HTTP 面的实际形态。
- **名字不改**（仍叫 `nodeFs`/`nodePath`/`nodeProc`）：改名要动 166 处尾参，换来的只是语义纯洁，不值；含义以本节为准，§四第 1/2 条已同步改写。
- **门**：`core/test/defaults-registration.test.ts` 八例——①豁免区之外的适配器 import 死表（七件，双向）②`defaults.ts` 自身零 `node:*` 且不 import 适配器（只查 import 形态：那句指路的错误消息里必然写着适配器路径，按裸文本匹配会把自己的消息判成违规）③尾参默认去向普查（166 总数 / 156 经注册表 / 10 在 `cfg-template.ts` / 27 个文件，逐数断言）④未注册抛 ⑤注册即转发（宿主盘零泄漏）⑥后注册覆盖（含 `sep` getter）⑦只登记引用不复制 ⑧setup 后状态可用且身份稳定。

---

## 五、`watchDir` 的定位（拍板点① 已入 v1）

R1–R4 期间现网**零** `fs.watch` 调用，它是为 R5 的 SSE 事件流预留的唯一缝：没有它，R5 就得在 `http.ts` 里直接 `import fs from "node:fs"`，而 `http.ts` 排在 R6 批三——等于抽象层刚立就自破一例。

**R5 已落地，唯一调用点是 `core/src/project-stream.ts::projectEvents`**（`GET /api/v1/projects/:id/stream` 的事件源）。
现网形态与当初的预判一致：watch 命中只把「该重读了」置真，事件由**节拍重读台账**推出；
取消函数在生成器的 `finally` 里调用，断开信号由源自己盯（`stopSignal`）——只靠调用方 `it.return()` 的话，
卡在节拍 `await` 里的生成器永远走不到 yield 点，监听句柄就泄漏。回归锁在 `core/test/sse-stream.test.ts`（watch/cancel 计数）。

约束：
- 回调参数是**文件名**（不含路径），取消函数幂等。
- Node 实现 `persistent: false`——监听不得拖住进程退出（CLI 动词跑完就该走）。
- Mock 实现不模拟事件时序，由 `fire(dirPath, name)` 显式驱动；测试里不许依赖真实 fs.watch 的到达时间。
- 语义弱保证：fs.watch 在不同平台的事件合并/丢失行为不一致，**任何正确性不得依赖 watch**。它只能作为「提示重读」的信号，重读路径必须仍能独立工作。

---

## 六、R3 落地的偏离与例外（验收对着这张表，不对着代码猜）

| # | 偏离 | 为什么 | 影响面 / 回收轮次 |
|---|---|---|---|
| D1 | `IProcessLauncher` 多出 `runAsync`（§2.2） | 现网脚本壳本就是 `promisify(execFile)`，同步化会冻住 HTTP/MCP 宿主 | 纯新增形态，既有 `run`/`exec` 判断逻辑零改动 |
| D2 | 写路径改必传首参 `io: FsIo`，与工单「fs 一律尾参」不同 | 台账漏传 = 静默写真宿主盘且编译照过，尾参默认拦不住 | `journal` / `diag` / `metrics` / `decisions` + `syncIntentDecisions`，调用点全部透传 `kernel` |
| D3 | **语料根仍是宿主字符串**：`schema.ts::ROOT` 被 `assembler.ts` / `minitools.ts` 当语料根直接用 | 展开单点（flow@3）与知识索引按字符串寻址，R3 只换管道不换寻址 | 冒烟测试必须把内存树播种在同一个字符串下（`abstraction-smoke.test.ts` 头注）；真解耦在 R7 拆包 |
| D4 | 缓存按**适配器身份**分桶：`assembler.ts` 的注册表缓存键含 `fs`/`path` 引用，`metrics.ts` 的概念索引 `Map<IFileSystem, …>` | 只按 root 字符串缓存，内存盘会吃到宿主盘的旧条目（同 root 同名不同盘） | 宿主单实例行为不变；多适配器并存才可见 |
| D5 | `extractCtxUsage(text, ids, { root, io })`：给了 `root` 没给 `io` **直接抛错** | 概念层拿不到 io 会静默跳过 ⇒ 上下文命中率假崩，而命中率是调编排的判据 | 内核指标面；宁可抛，不交一份不可信指标 |
| D6 | `mkdirSync`+原子写 → `writeTextAtomic`；`existsSync`+`statSync` → `stat()` | 少一次系统调用，把「父目录自动建」收到适配器单点 | 落盘字节不变（`writeJsonAtomic` 输出逐字节相同，R3 已比对） |
| D7 | 不进抽象层的宿主面：`process.stderr.write`（`diag.ts`）、`console.*`、`process.env`、`Buffer`、`import.meta.url`、`node:crypto`（`ids.ts` sha1） | FS1 v1 只管「盘 + 路径 + 子进程」三面；env/console/熵属宿主面 | 出口判据按 `node:(fs\|path\|child_process)` 计数，`node:crypto` 不在其列；R6/R7 议题 |
| D8 | 退役件 `core/src/fsio.ts` 已删（`git rm`），语义件迁至 `abstraction/jsonio.ts` | `readJson/writeJsonAtomic/appendJsonl/readJsonl/LockDir` 全部改吃注入的 `fs`/`path`，旧文件名留着就是第二套真相 | 注释里的历史提及不算引用；`docs/` 相关口径以本节为准 |
| D-R6-1 | 卡面 P1/P2（15 个文件）在 R6 无写集，R6 实做 P3 的 9 个 | 它们已随 R3「禁止半抽象」一并过了；按卡面重跑一遍就是重复施工 | 见 §3.2「R6 收口」；工单执行记录 R6 行 |
| D-R6-2 | 接口扩容两件：`IFsPath.fromFileUrl`、`IProcessLauncher.detach` | 各有一处真实调用点（`schema.ts:15` / `cli.ts` 的 `openBrowser`），§四第 5 条走的是普查不是偏好 | Node＋Mock 双实现，对表测试在 `abstraction-mock.test.ts` |
| D-R6-3 | `agent.ts` 的公开签名：会话 CRUD 与模型配置读写（`loadModelConfig` / `saveModelConfig` / `listSessions` / `createSession` / `getSession` / `deleteSession` / `renameSession`）首参由 `projectDir`/`repoRoot` 字符串改为首传 `kernel`；`buildSystemPrompt` / `buildTools` / `runTurn` 本就首传 kernel，本轮只把内部换成 `kernel.fs`/`kernel.path`/`kernel.proc` | 首传字符串 = 内部只能用模块级 Node 适配器或尾参默认，拦不住吃宿主盘（§四第 2 条的老病）；kernel 一传到底才有盘/路径/子进程三面同时换的余地 | 全仓直接 import 者只有 `core/test/agent.test.ts`（已改签名）；`storyharness/` 用自有副本、`adapter/` 走 HTTP——外溢面实测为零 |
| D-R6-4 | `export const agentMcp` 单例 → `mcpFor(kernel)` 按注入盘分桶（`WeakMap<IFileSystem, AgentMcp>`） | 单例固定吃 Node 适配器，注入盘的宿主会在这一处悄悄回宿主盘读 `.external/agent-mcp.json`——正是 §四第 3 条禁的半抽象 | 默认 Node 盘仍是同一实例 ⇒ 现网 HTTP 行为逐字节不变；同盘同桶/异盘异桶由 `r6-host-free.test.ts` 锁 |
| D-R6-5 | `flow_lint`：`execFileSync` → `proc.runAsync`，cwd 由「projectDir 上跳两级」改 `kernel.repoRoot`，并补「退出非零且无输出」分支 | 分离数据根的宿主上只有 repoRoot 有 `tools/flow-lint.py`；折叠那条分支会把 stderr 诊断缩成一句 `exit=1` | 返回文案四态各有测试逐态锁 |
| D-R6-6 | 非 FS 族 `node:*` 六处仍留宿主件（process ×3 / net ×1 / crypto ×1 / module ×1） | FS1 v1 只管「盘 + 路径 + 子进程」，env/熵/端口探测/`createRequire` 属宿主面（与 D7 同族） | 完整达成在 R7 拆包；例外表逐条钉在 `r6-host-free.test.ts` |
| D-R6-7 | 静态面 `readBuffer` 出 `Uint8Array`，出口包一层 `Buffer.from(…)` | Fastify 的二进制出口按 Buffer 走；裸 `Uint8Array` 会被当对象序列化成 JSON | `GET /` 的 200/内容类型/白名单 404 有内存盘测试，另有 `up` 真机冒烟（200，2200 字节）|
| D-R7-1 | 尾参默认的三个名字 `nodeFs`/`nodePath`/`nodeProc` 从「Node 单例」改指「注册表当前注册的平台缺省」（转发代理）；28 个文件的 import 行由 `adapters/node.js` 改指 `defaults.js` | core 包不许 import 宿主实现，而 §四第 2 条的 166 处默认必须有缺省值；名字保留是因为改名动 166 处而语义不换 | Node 宿主注册的正是那三家 ⇒ 现网行为逐字节不变；**未注册的宿主从「静默吃宿主盘」变「抛错点名」**——跨包消费者 `storyharness/test/kit-wiring.test.ts` 实测被这条拦下、补登记后 94/94 绿 |
| D-R7-2 | `http.ts` 显式加一行 side-effect import（`import "./abstraction/adapters/node.js"`） | HTTP 面本就跑在 Node 上，登记不该靠 `schema.ts` 的传递 import 侥幸拿到实现——侥幸断在哪天就是启动即抛，且断在运行时不是编译期 | 无行为变化，只把隐式依赖写显；R7-3 拆包后这一行归 `@storyflow/adapters` 的入口件 |
| D-R7-3 | 七个宿主入口件仍直连 Node 适配器（死表见 §4.1） | `cli.ts`/`mcp.ts`/`export-cli.ts`/`quality-cli.ts` 是入口、本就 Node；`http.ts` 是登记点；`schema.ts::ROOT`（D3 未解）与 `cfg-template.ts` 是模块级求值，import 期就要真 `path` | R7-2 收模块级两件；R7-3 随拆包把入口四件请出 core 包 |
| D-R7-4 | `tools/batch-edit.py` 升 v2：`--manifest` 多文件同批（逐文件字面校验、任一处不成立 = 整批拒绝零写入、一份合并 diff ＋ per-file sha256 前/后收据） | 28 个文件的同一处 import 行换字面串，按本仓批量纪律是一批，不该摊成 28 次调用（碎片 diff 互不可见、回滚逐处） | 单文件 `--file/--ops` 形态不变，既有调用点零影响；本批收据 `.receipt-r7-1-imports.json`（仓库根） |

**冒烟测试的三条断言就是这三类偏离的验收面**（`core/test/abstraction-smoke.test.ts`）：①`flow_run`→`flow_submit` 全程只写内存盘 + 宿主盘无泄漏目录；②跑完语料逐字节不变（只读承诺）；③改内存里的技能卡，任务包内容跟着变——**读**也走注入适配器（宿主盘同内容时，前两条抓不到静默的宿主盘读）。
