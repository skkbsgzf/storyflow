# Pi Web - Development Notes

## Quick Start

```bash
npm run dev   # port 30141
```

Typecheck: `node_modules/.bin/tsc --noEmit`  
Lint: `npm run lint`  
**Never run `next build` during dev** — pollutes `.next/` and breaks `npm run dev`.

### Dev server troubleshooting

- Before starting a server, run `lsof -nP -iTCP:30141 -sTCP:LISTEN` and reuse the existing Pi Web process when it is healthy. A second `next dev` for the same checkout cannot use a different port as a workaround because both processes contend for `.next/dev/lock`.
- A browser-only `Module ... factory is not available` overlay usually means that tab has a stale Turbopack/HMR graph; it does not prove the server or source is broken. First call the browser's explicit reload action, then compare the current server log and a direct HTTP/API request.
- Restart only after the failure reproduces from a fresh page and the server-side checks also fail. Stop the exact dev process gracefully, move `.next` into a `mktemp -d` backup, and restart with the standard `npm run dev` command.
- Do not use `next dev --webpack` as a fallback. This repository's development graph can fail on `undici` imports such as `node:console`; development is expected to use Turbopack.
- Next.js may append a generated `BEGIN:nextjs-agent-rules` block to `AGENTS.md` when `next dev` starts. Treat that as generated tooling output, verify it with `git status`, and do not include it in an unrelated feature commit.

---

## Architecture

```
Browser                Next.js Server              AgentSession (in-process)
  │                        │                               │
  ├─ GET /api/sessions ────▶ reads ~/.pi/agent/sessions/   │
  ├─ GET /api/sessions/[id] reads .jsonl file directly     │
  ├─ GET /api/agent/running ───────▶ running id snapshot   │
  │                        │                               │
  ├─ send message ─────────▶ POST /api/agent/[id]          │
  │                        │   startRpcSession() ─────────▶│ createAgentSession()
  │                        │   session.send(cmd) ─────────▶│ session.prompt()
  │                        │                               │
  ├─ SSE connect ──────────▶ GET /api/agent/[id]/events    │
  │                        │   session.onEvent() ◀─────────│ session.subscribe()
  │◀── data: {...} ─────────│                               │
```

**Session browsing** (read-only): reads `.jsonl` files through SDK `SessionManager` helpers and `lib/session-reader.ts` — no AgentSession created.  
**Sending a message**: `startRpcSession()` in `lib/rpc-manager.ts` creates an AgentSession in-process.

---

## File Map

```
app/api/
  sessions/route.ts               GET  list all sessions
  sessions/[id]/route.ts          GET/PATCH/DELETE session
  sessions/[id]/context/route.ts  GET ?leafId= — context for a specific leaf
  sessions/[id]/export/route.ts   GET exported HTML for a session
  agent/new/route.ts              POST { cwd, message, toolNames?, provider?, modelId? }
  agent/[id]/route.ts             GET state | POST any command
  agent/[id]/events/route.ts      GET SSE stream
  agent/running/route.ts          GET currently-running session ids
  auth/api-key/[provider]/route.ts POST/DELETE provider API key storage
  auth/login/[provider]/route.ts  GET OAuth/device-code SSE | POST manual code
  auth/logout/[provider]/route.ts POST OAuth logout
  auth/providers/route.ts         GET OAuth and API-key provider lists
  cwd/validate/route.ts           POST validate/select a cwd
  default-cwd/route.ts            POST create ~/pi-cwd/YYYYMMDD (local date)
  files/[...path]/route.ts        GET file contents for viewer
  home/route.ts                   GET user home directory
  models/route.ts                 GET { models, modelList, defaultModel }
  models/enabled/route.ts         GET/PUT enabledModels switches for the Models panel
  models/default/route.ts         PUT save the default model / reasoning level for new sessions
  models/refresh/route.ts         POST fetch provider catalogs from pi.dev on demand
  models-config/route.ts          GET/PUT — read/write ~/.pi/agent/models.json
  models-config/catalog/route.ts  GET models.dev pricing presets
  models-config/discover/route.ts POST fetch a configured provider's upstream model list
  models-config/test/route.ts     POST test a configured model/provider
  plugins/route.ts                GET/POST package plugin management
  skills/route.ts                 GET/PATCH loaded skills and disable-model-invocation
  skills/install/route.ts         POST install skills through npx skills add
  skills/search/route.ts          GET/POST skills.sh search
  subagents/settings/route.ts     GET/PUT built-in subagent feature setting
  worktrees/route.ts              GET/POST/DELETE git worktrees
  web-auth/route.ts               GET status | POST login | DELETE logout (browser password)
  plugins/check/route.ts          POST check plugin package updates
  project-trust/route.ts          GET/POST project trust for package installs
  sessions/search/route.ts        GET session search
  sessions/[id]/state/route.ts    GET live wrapper state when the session is running
  sessions/[id]/auto-name/route.ts POST generate a session title
  terminal/route.ts               POST create a terminal session
  terminal/[id]/route.ts          GET stream | POST input/resize | DELETE kill
  cwd/browse/route.ts             GET browse allowed cwd directories | POST create child directory
  open-in-explorer/route.ts       GET availability | POST open a cwd in the OS file manager (loopback only)
  app-update/route.ts             GET current vs latest published pi-web version
  file-index/route.ts             GET file list for @-mentions
  git/status/route.ts             GET changed files for a cwd
  git/diff/route.ts               GET diff for one changed file
  provider-usage/query/route.ts   POST provider usage quotas
  push/config/route.ts            GET VAPID public key for push subscriptions
  push/subscribe/route.ts         POST register a push subscription
  tools/settings/route.ts         GET/PUT defaultTools switches: PowerShell (Windows) and Code mode (automatic / always)

lib/
  agent-client.ts      typed fetch helper for /api/agent commands
  default-preferences.ts  write defaultModel/defaultThinkingLevel; detect project-level shadowing
  draft-store.ts       local draft persistence helpers
  extension-ui-queue.ts  FIFO queues for extension dialogs and custom panels, keyed by request id
  file-access.ts       allowed file roots for /api/files and worktrees
  linked-directory.ts  directory links that lead outside the allowed roots + the allow-link check
  default-cwd.ts       dated ~/pi-cwd/YYYYMMDD path for "Use default directory"
  file-paths.ts        client/server path encoding helpers
  display-path.ts      display-only `~` / `./` path shortening for the settings panels
  file-tree-visibility.ts  which entries the file tree lists: git check-ignore, name-list fallback
  enabled-models.ts    pure minimal-edit engine for the `enabledModels` pattern list
  enabled-models-runtime.ts  SDK adapter: per-pattern resolution, provider kinds, settings IO
  markdown.ts          shared markdown helpers
  gfm-autolink-email-loader.cjs  bundler loader: remark-gfm's email regex without a lookbehind literal (#753)
  node-cli.ts          locate bundled npm-cli.js / npx-cli.js so npm/npx spawn without a shell (Windows npm.cmd)
  npx.ts               npx runner used by skill install
  plugin-updates.ts    npm view update checks for /api/plugins/check
  pi-types.ts          local structural types for pi SDK objects
  pi-sdk-internals.ts  file-URL loader for SDK modules the package does not export (MCP connection, config, OAuth)
  mcp-transport.ts     MCP transport factory: stdio servers get the sanitized project-command env, never PI_WEB_PASSWORD
  builtin-extensions.ts  codemode / tool-search / mcp built-ins for normal sessions, PI_WEB_DISABLE_MCP, sandbox self-test
  mcp-read-only-policy.ts  tool_call policy: read-only sessions block MCP tools without readOnlyHint, nested calls too
  mcp-host.ts          per-wrapper MCP host: registers mcp.json servers before a prompt, waits for them, idles them out
  mcp-tool-display.ts  `server/tool` label for an mcp__ call from its result's details (never parsed from the name), JSON result indenting
  codemode-view.ts     display helpers for codemode cards: script, nested calls, header-free output, progress
  codemode-settings.ts Code mode automatic / always as `+codemode` in the global defaultTools
  global-settings-file.ts  locked read-modify-write of the global settings.json (shared with SettingsManager's lock)
  rpc-manager.ts      AgentSessionWrapper + registry + startRpcSession
  session-reader.ts   SessionManager wrappers + path cache + buildSessionContext adapter
  subagent-settings.ts  read/write ~/.pi/agent/agents/settings.json
  tool-presets.ts     PRESET_NONE/READ_ONLY/DEFAULT/FULL + getPresetFromTools()
  tool-preset-preference.ts  browser-persisted default for fresh sessions
  types.ts            shared TypeScript types
  normalize.ts        normalizeToolCalls() — field name mismatch between file format and our types
  worktree.ts         project/worktree resolution and git worktree operations

components/
  AppShell.tsx        layout + URL state + tab management
  SessionSidebar.tsx  session tree + FileExplorer
  ChatWindow.tsx      chat composition + completion sound wrapper
  ChatInput.tsx       input bar + model/thinking/tools/compact controls
  MessageView.tsx     renders one message (user/assistant/toolCall/toolResult)
  CodemodeToolView.tsx  codemode card body: highlighted script + the tool calls it made
  BranchNavigator.tsx in-session branch switcher
  ChatMinimap.tsx     scroll minimap alongside the message list
  MarkdownBody.tsx    markdown renderer
  ModelsConfig.tsx    modal for editing models.json (opened from sidebar bottom)
  EnabledModelsSection.tsx  model switches inside ModelsConfig, backed by enabledModels
  OAuthPastePanel.tsx paste box for a server-side sign-in's redirected address or code
  AgentsConfig.tsx    built-in subagent toggle + agent profile editor
  PluginsConfig.tsx   modal for installed package plugins
  SkillsConfig.tsx    modal for loaded/search/installable skills
  FileExplorer.tsx    file tree inside sidebar
  FileIcons.tsx       file icon helpers
  FileViewer.tsx      file content in a tab
  TabBar.tsx          tab bar (Chat + open file tabs)

hooks/
  useAgentSession.ts  messages + streaming + SSE + fork/navigate/reconciliation logic
  useAudio.ts         completion sound + browser AudioContext unlock
  useDragDrop.ts      shared drag/drop state
  useIsMobile.ts      responsive breakpoint hook
  useTheme.ts         theme state
```

---

## Key Design Decisions & Traps

### AgentSession lifecycle (`lib/rpc-manager.ts`)
- One `AgentSessionWrapper` per session id, keyed in `globalThis.__piSessions`
- `globalThis` survives Next.js hot-reload; plain module-level Map does not
- Idle timeout: 10 minutes by default (`PI_WEB_IDLE_TIMEOUT_MS`, `0` disables). Concurrent `startRpcSession()` calls share a single start Promise (`globalThis.__piStartLocks`)
- Stop cannot cancel an SDK run that awaits a promise ignoring the abort signal (a third-party extension handler or tool): `inner.abort()` never returns and the session keeps reporting running. Stop (`abort`, and `abort_bash` likewise) therefore sets `forceShutdownOnIdle` and arms the idle timer, which shuts the wrapper down one idle timeout after the first Stop even though it is still running, so the session recovers without a server restart. Commands that arrive meanwhile — a reload's `get_tools`, Stop pressed again — keep that deadline instead of pushing it back, or a user retrying would keep the stuck run alive. With `PI_WEB_IDLE_TIMEOUT_MS=0` the timer still arms after Stop, at the 10-minute default (#656).
- A wrapper is closing from the moment `shutdown()` or `destroy()` starts, not once it is disposed: `isAlive()` turns false before extensions have handled `session_shutdown`, so the routes that check it stop sending commands to one that is about to be disposed, and `startRpcSession()` builds a fresh wrapper — but only once the closing one has disposed (`closingRpcSessionWait()`, at most the deadline below plus a second, counted from the first caller that waits, so a shutdown still binding extensions can be overtaken; `setRpcSessionTools()` waits for that or for a start already under way, then applies the selection to the wrapper it left instead of writing through a second `SessionManager`). Until then the closing wrapper still owns the session: an extension's `session_shutdown` may append to the file, which a replacement opened earlier would branch away from, and `dispose()` releases provider resources such as a Codex websocket by session id, which the replacement shares. During `shutdown()`, `isRunning()` still reports a stuck run until disposal, so it still counts as busy. The closing wrapper stays in `__piSessions` until it is disposed or replaced, and its `onDestroy` removes the entry only while the entry still points at it; deleting by id let a late cleanup unregister the replacement, leaving it orphaned beside a third wrapper on the same file. A wrapper registered before a hot reload still deletes by id, so `registerRpcWrapper()` clears the callback of the entry it replaces. Extensions get `PI_WEB_SHUTDOWN_DEADLINE_MS` (5 s by default; `0` or an invalid value keeps the default) to handle `session_shutdown`, after which the wrapper logs once and disposes anyway (`shutdown()` still waits for extension binding to finish first, without a deadline): closing an MCP connection has no upper bound, since it waits for a token refresh in flight and for a stdio child whose grandchild may keep stdout open. The deadline timer is unref'd, so it never holds a quitting process open.

### Fork never touches the running AgentSession
Never fork through `AgentSession.fork()` / `AgentSessionRuntime.fork()`: they replace the session in place (after fork, `inner.sessionId` is the *new* id, and the runtime aborts the current run first, because the TUI holds one session per process). A wrapper still registered under the old id would then serve the forked state and corrupt the `parentSession` chain.

`send("fork")` and `send("fork_branch")` instead open a separate `SessionManager` on the source file and `createBranchedSession()` from it, so the source's in-memory session is never mutated. That is why forking is allowed **while the source is running** (only a running `!` shell command refuses it): the copy needs only finished entries, and pi appends each one synchronously in this same process, so the file on disk already holds them. The in-flight assistant message lands at `message_end`, after the fork point. A source whose first user message has not landed has no file yet, and fork refuses it with the upstream "has not been saved yet" wording. After a fork, an idle source is shut down because the browser moves to the child; a running source is left alone and keeps its run, and the sidebar keeps showing it as running. `clone` still refuses a running session: it copies the current branch, which is the run in progress.

### In-session branching waits for the run
pi's `navigateTree()` refuses while streaming or compacting, and that is structural: one file has one leaf pointer, a running agent appends every finished message under it, and navigating also swaps the agent's context. Moving the leaf mid-run would hang the rest of the turn off another branch. "Edit from here" is therefore hidden while the session is busy, and the BranchNavigator renders read-only (`locked`) with a note instead of switching; `handleLeafChange` refuses too, because switching only the view would render the live run under a different branch while the server leaf stayed put. To branch from a running session, fork it.

### Two kinds of branching — don't confuse them
- **Fork** ("New session" on user message): creates a new independent `.jsonl` file. Shown as a child in the sidebar tree via `parentSession` header field.
- **In-session branch** ("Edit from here" / BranchNavigator): calls `navigate_tree` within the same file. Multiple entries share the same `parentId`. Switching between them calls `/api/sessions/[id]/context?leafId=`.

### Session files can be fully rewritten
`parentSession` in the header is **display metadata only** — has zero effect on chat content. Safe to `writeFileSync` the entire file (pi does this itself during migrations). Used when cascade-reparenting children on delete.

### ToolCall field normalization
Pi stores toolCall blocks as `{type:"toolCall", id, name, arguments}` but `ToolCallContent` uses `{toolCallId, toolName, input}`. `normalizeToolCalls()` in `lib/normalize.ts` handles this — called in both `session-reader.ts` (file load) and `handleAgentEvent` in `hooks/useAgentSession.ts` (streaming).

### New session tool preset
Tool names are passed at session creation (`POST /api/agent/new` -> `toolNames[]`) and persisted in versioned `pi-web:tool-selection` custom entries. No entry means a legacy session and keeps Pi's default behavior; an empty array means Chat only. Chat only resolves before services are created, loads no extensions/skills/prompts/themes, and replaces Pi's base prompt with the ordered contents of Pi's discovered context files. Crossing the Chat-only boundary rebuilds the wrapper; changing between nonempty presets updates it in place.

**Exact system prompts go through `before_agent_start`.** Since pi 0.86 the prompt lives in the transcript: `agent.state.systemPrompt` is a getter replayed from persisted system messages (assigning it throws), and the agent loop's request context has no `systemPrompt` field, so neither mutating the state nor patching `prepareNextTurnWithContext` reaches the model. Chat-only sessions and subagent profiles in replace mode register `lib/exact-system-prompt.ts` as an inline extension factory on the resource loader; its `before_agent_start` handler returns `{ systemPrompt }`, which the SDK projects as the provider's leading system prompt for the whole run while the transcript keeps recording Pi's structured sections. `get_state.systemPrompt` reports the exact prompt for those wrappers because the SDK state only shows the structured sections. Subagents persist their active tools plus profile-level skill and extension loading switches in `resourceSnapshot`; loaded extensions cannot expose the reserved `Agent`, `get_subagent_result`, or `steer_subagent` tools to a subagent. See `docs/adr/0002-chat-only-tool-selection.md`.

The last preset explicitly selected by the user is stored in browser `localStorage` and initializes fresh-session composers only. Existing sessions never trust that preference; they use their live `get_tools` state or pi's default when no wrapper exists.

**Tool exposure (pi >= 0.99).** Every tool reports an `exposure`: pi activates `direct` and `model-only` tools on registration unless their definition sets `defaultActive: false` (`codemode` and `tool_search` do), leaves `codemode` and `deferred` tools undeclared until something activates them, and ignores `hidden` (withdrawn) tools in `setActiveToolsByName()`; `get_tools` leaves hidden tools out. A preset replaces only the coding tools. `resolveActiveToolNames()` carries every other tool that is active and still registered and not hidden, so what an extension, `tool_search`, or a `defaultTools` entry such as `+codemode` activated survives startup, `set_tools`, and `reload`, and a tool an extension switched off stays off; a preset never turns `codemode` on by itself. It adds nothing else: pi activates extension tools itself — every one it would activate on registration when it builds or reloads a session, then each newly registered one — so re-adding them on every apply would override an extension (or a branch's recorded loadout) that keeps a `direct` tool off. `reload` carries the set pi rebuilt from the previous one after extensions started again, not the previous set, so a tool an extension switched off while restarting stays off. `navigateTree()` restores the target branch's loadout from its transcript, which brought `write` back under a Read-only pin and dropped `codemode`, so after navigation a normal session applies its pinned selection again (the restored set when it has none) and carries the session's own tools over from the branch it left: `codemode`, `tool_search`, and pi-web's subagent tools, which the built-in subagent setting turns on for the whole session. Other extension tools follow the target branch's recorded loadout, as in the pi CLI, so a tool registered after that branch point stays off there until a reload. Chat-only and subagent wrappers keep what pi restored. **Built-in extensions.** The pi CLI prepends its built-in `codemode`, `tool-search`, `mcp` and `llama.cpp` extensions from a module the SDK does not export. `lib/builtin-extensions.ts` rebuilds the first three from the factories the SDK root does export, under the CLI's names with `replaceable: true, builtin: true`, so `-builtin:<name>`, project overrides and replacement by a third-party extension behave as in the CLI; `noExtensions` turns them off too. Only normal sessions load them, never Chat-only or subagent wrappers. The MCP extension gets a `loadConfig` that returns no servers (only the file's `autoEnableCodemode`), so it connects nothing from `mcp.json` on `session_start` and its startup wait, which ignores Stop, never arms; pi-web registers the servers a session should connect itself (see **MCP host** below). Servers it is given connect through `createPiWebMcpTransportFactory()`, and `openUrl` opens no browser on the server host. MCP is off — the `mcp` entry registers nothing — when `PI_WEB_DISABLE_MCP` is set to anything but empty, `0` or `false`, or when `lib/pi-sdk-internals.ts` cannot load; pi-web never falls back to the SDK's own transport. `codemode` is offered only after a once-per-process self-test has run a script through the SDK's own sandbox (`checkCodemodeSandbox()`): its QuickJS worker and wasm are resolved from the SDK's files at run time, and a tool that fails every call is worse than none. A built-in that cannot run keeps its `builtin:<name>` entry with an empty factory, so a setting naming it still means the same. Normal sessions also load `lib/mcp-read-only-policy.ts`: while the session's pinned selection is read-only (it names tools and none of `bash`, `powershell`, `edit`, `write`; no pin is not read-only), its `tool_call` handler blocks every MCP tool — the MCP extension's, or any named `mcp__` — whose definition lacks `annotations.readOnlyHint: true`. A codemode script's calls pass through `tool_call` too, so they are blocked the same way. It reads the pin from the session entries, which `set_tools` writes before applying it and cannot change mid-run. The hint is the server's word: the policy guards against model mistakes, not a malicious server. Code mode's choice is **Automatic** (nothing written; the MCP extension activates `codemode` when a `codemode`-exposure server connects) or **Always on** (`+codemode` in the global `defaultTools`); there is no Never. `/api/tools/settings` is the only writer of that key, for this and the PowerShell switch, through `lib/global-settings-file.ts`, which takes the lock pi's `SettingsManager` takes on the same file. `lib/codemode-settings.ts` edits only the entries naming `codemode` and appends `+codemode`, which works on a plain and a modifier-only list alike; a modifier-only list it leaves empty is removed, because `defaultTools: []` means no tools at all, not pi's defaults. `defaultTools` may hold `+name` / `-name` modifiers: read the resolved list through `SettingsManager.getDefaultTools()`, and `lib/powershell-settings.ts` resolves the raw global list with the same rule before it edits it, since appending a plain name to a modifier-only list would drop pi's default tools.

### MCP host (`lib/mcp-host.ts`)
- `createPiWebBuiltinExtensions()` returns `{ extensions, mcpHost }`; `startRpcSession()` passes the host to the wrapper. The host's inline extension reads the global and project `mcp.json` itself and hands the servers it wants to the SDK's MCP extension with `pi.registerMcpServer()`, so the extension's own `loadConfig` stays empty (ADR 0006). It stays inactive unless `/mcp` belongs to `builtin:mcp`: with `-builtin:mcp`, or a third-party extension that registers `/mcp`, another implementation would connect the servers through its own, unscrubbed transport.
- **Nothing connects until a prompt.** Before a prompt that starts a run (`!inner.isStreaming`), the wrapper calls `prepareForPrompt()`: the host diffs `mcp.json` against what it registered, unregisters and re-registers only entries whose canonical JSON changed, then waits up to 10 s for servers still connecting. A server that outlasts one full wait is not waited for again. `before_agent_start` also syncs, without waiting, for prompts that do not come through the wrapper.
- **Stop during that wait** aborts it, and the prompt is rejected unsent with `MCP_WAIT_STOPPED_MESSAGE`, so the client restores the draft. It cannot live in `before_agent_start`: pi emits it before the run has an abort signal, and `AgentSession.abort()` does nothing until a run is active. The `abort` command waits for the withdrawn prompt to unwind before it checks `isRunning()`.
- **Connection state comes from the transports.** The extension reports none, so `wrapTransportFactory()` wraps pi-web's transport factory and `watchConnection()` listens on each transport it creates (an extra listener and an own `send` on the instance, never a wrapper object: the SDK checks `instanceof StdioTransport`). Ready means every `tools/list` / `resources/list` / `resources/templates/list` request is answered and a macrotask passed without another page being requested; the extension registers the tools in the microtasks that settle the last list. A transport that closes first, or a factory that throws (such as a `PI_WEB_PASSWORD` reference), is failed.
- **Never unregister a server before its transport exists.** The extension assigns `server.connection` only after loading the MCP runtime, and its removal closes that connection; unregistering earlier finds nothing to close, and the extension connects the server anyway with no way left to close it. The host waits (at most 5 s) for the transport before unregistering. Once it exists, `close()` is safe even mid-handshake: the connection throws away the client when the handshake finishes.
- A host that has not run for `PI_WEB_MCP_IDLE_MS` (10 minutes; `0` disables) unregisters its servers, unless `ctx.isIdle()` says a run is still going; the next prompt registers them again. The timer is stopped from `agent_start` to `agent_end` and while a prompt waits in `prepareForPrompt()`, and started again at `agent_end`, when `prepareForPrompt()` returns, and whenever a sync finishes. Never rely on `agent_end` alone: a prompt that registers servers and then starts no run (Stop during the wait, a slash command, a rejected preflight) never emits it, and a sync Stop gave up on still finishes in the queue afterwards. A reload binds a new host instance with nothing registered.
- MCP tools register as `mcp__<server>__<tool>`, sanitized to `[A-Za-z0-9_-]` and hashed past 64 characters, so the name cannot be split back: `docs.v2/search.pages` and `docs_v2/search_pages` register alike, and either part may hold `__`. A tool card reads `server/tool` only from its result's details (`{ server, tool }`); a running call, the status line and a codemode script's calls keep the registered name, which is also what scripts call.
- Project `.pi/mcp.json` entries follow the project's trust, as in the pi CLI: the host passes `ctx.isProjectTrusted()` (pi-web's `resolveProjectTrust`, inherited trust included) to `loadMcpConfig`, which reads the project file only when it is true, and connects every entry it returns. There is no per-entry approval, because a trusted project's `.pi/extensions` already run inside the same boundary, and earlier (on browsing, not on the first prompt). A project entry replaces a global one of the same name. Without a working codemode sandbox, servers with `codemode` exposure are registered as `deferred`, reachable through `tool_search`.

### Model defaults for new sessions
`GET /api/models` returns `defaultModel` read from `~/.pi/agent/settings.json`. `ChatWindow` pre-selects this on mount for new sessions. Explicit browser model/thinking selections are applied atomically during AgentSession construction and are **session-scoped**: startup never writes `settings.json`, and neither does a mid-session `set_model` / `set_thinking_level`. That matches pi since 0.84.3, where `/model` and `/thinking` only persist on Ctrl+S; before that pi-web wrote every new-session pick back, so a one-off model silently became the TUI's default too (#871).

The explicit "save as default" is the star on each row of the model selector and the reasoning menu, the Web counterpart of Ctrl+S: `PUT /api/models/default` writes `defaultProvider`/`defaultModel` or `defaultThinkingLevel` (`lib/default-preferences.ts`), and the hook then also selects that row for the current chat, as Ctrl+S does. The route only accepts a model the selector can offer (in the resolved `enabledModels` scope), so a saved default always takes effect. A project `.pi/settings.json` value for a written key wins over the global one, so the route refuses with `409 { reason: "project-scope", settingsPath }` instead of reporting a save the user would never see. The model star marks the resolved `defaultModel`; the reasoning star marks `savedDefaultThinkingLevel`, the raw setting, because the resolved `defaultThinkingLevel` also folds in `:level` pins and per-model levels that the global write does not change. Both menus render `SelectorRow` (`components/SelectorRow.tsx`), which highlights the whole row like a session-list row and keeps one right-hand gutter for the star: the default row shows a small static filled star there, and every other row's save button floats into the same spot on hover or keyboard focus (always visible on touch screens, which have no hover). `ModelSelector` only shows stars when given `onSetDefault`; the subagent profile form reuses it without one.

The reasoning control stays usable while a run streams (#851). pi-agent-core snapshots `reasoning` into the loop config when a run starts, but `AgentSession`'s `prepareRequest` / `prepareNextTurnWithContext` hooks re-read `agent.state.thinkingLevel` before every model request, so `set_thinking_level` mid-run applies from the next request; only the response already streaming keeps its level. `lib/thinking-level-mid-run.integration.test.mjs` pins that SDK behavior with the faux provider — if an SDK upgrade breaks it, disable the control again rather than let it change nothing.

### Remote provider catalogs
pi's built-in model lists are generated when the SDK is built and pi-web pins one SDK version, so a model a provider ships after that release is invisible until pi-web publishes a new version (#914). The SDK carries the other half: each built-in provider is wrapped in a pi.dev catalog overlay that `ModelRuntime.refresh()` fetches and persists to `~/.pi/agent/models-store.json`, and restoring that overlay needs no network. Both of pi-web's refresh paths ask for the offline half only (`createAgentSessionServices()` and `lib/provider-usage.ts` pass `allowNetwork: false`), which is why running the pi CLI once used to be the fix — the CLI refreshed with the network on and pi-web read what it left behind.

`lib/model-catalog-refresh.ts` runs that network pass, and **only when the user asks for it**: the "Refresh catalog" button in `EnabledModelsSection` posts to `/api/models/refresh`. Nothing refreshes catalogs on a timer or on another request's path — a pass fetches a catalog per authenticated provider, and a save must not wait on a slow one, the same reason `/api/auth/api-key/[provider]` stores the credential itself instead of calling `ModelRuntime.login()`. `refresh()` is called with `force: true`, since pressing the button is exactly a request to skip the SDK's four-hour freshness window, but *without* `allowNetwork`, so the runtime keeps applying its own `PI_OFFLINE` rule instead of pi-web overriding it; the module reports `reason: "offline"` rather than pretending a pass ran. `shareModelCatalogRefresh()` joins concurrent presses for the same providers so two tabs cannot race over the store file.

Change detection compares the model ids and names the runtime exposes, never the stored bytes: a successful revalidation rewrites `checkedAt` and `etag` on every pass. It only decides whether `invalidateModelsCache()` runs and whether the panel reloads — the overlay itself reaches the UI through the ordinary `/api/models` and `/api/models/enabled` loads, which build a fresh runtime that restores the store, so the refresh route never returns a model list of its own.

### `enabledModels` scoping
The `enabledModels` setting uses pi's `--models` syntax: minimatch globs against `provider/modelId` or a bare `modelId`, fuzzy matching for non-glob patterns, and an optional `:thinkingLevel` suffix. Never compare those patterns as literal strings — `lib/model-scope.ts` delegates to the SDK's `resolveModelScopeWithDiagnostics()` so pi-web and the TUI agree on the visible model list, and falls back to all available models when patterns resolve to nothing. `startRpcSession()` resolves that scope before creating an AgentSession and passes the selected initial model, thinking pin, and SDK-native `scopedModels` atomically; `GET /api/models` reuses the helper only for selector data, `thinkingLevelPins`, and `modelScopeWarnings` display.

Editing that setting from the Models panel goes through `/api/models/enabled`, never through pattern strings composed in the browser. Each toggle is a **minimal edit** of the stored list (`lib/enabled-models.ts`): a pattern that matches no available model is preserved verbatim, only the pattern covering the switched-off model is expanded in place (keeping its `:level` suffix), and every provider that ends up fully enabled with two or more entries collapses back into one glob — pi refreshes provider catalogs from the network into `models-store.json`, so an enumerated list rots when a model is renamed (deepseek's `deepseek-v4-flash` became `deepseek-flash`), while a glob heals itself. A lone exact reference is a deliberate pick and is left alone. **Never assume `provider/*` covers a provider**: pi matches with minimatch, whose `*` stops at `/`, so that glob silently misses every nested model id (`commandcode/sakana/fugu-ultra`, most OpenRouter ids) — writing it turned "enable all" into 15 of 71 models. `resolveProviderGlobs()` resolves `provider/*` then `provider/**` and keeps one only when its match set is exactly the provider's models; a provider that neither covers is written model by model. Also never rewrite the whole list from `getAvailable()` the way the TUI's `/scoped-models` does — it only sees providers that currently pass `checkAuth()`, so that would delete every entry for a provider whose credential is missing right now, and flatten globs and pins.

Disabling the last enabled model is refused with `409 { reason: "last-model" }`: pi falls back to every model when a scope resolves to nothing, so an empty list silently means the opposite. Writes always target the global settings file; a project `.pi/settings.json` replaces the global array instead of merging, so the route reports `scope: "project"`, renders the switches read-only, and returns that file's path as `settingsPath` — the banner names the file it just wrote (`~/.pi/agent/settings.json · enabledModels 20/104`) instead of describing the effect in prose. Built-in *and* extension-registered providers get per-model switches; models.json providers are switched as a whole by `EnabledModelsProviderSwitch` in their detail header, next to Delete, because a custom model can simply be deleted and both bulk buttons only ever sent the same provider-wide write. That switch is on only when every model of the provider is on, so a partial selection reads as off beside the sidebar's `1/2` badge and one click completes it; reading it as "any enabled" would leave partial unreachable in both directions once the last-model guard blocks the way down. Why it cannot move is its tooltip, not body text. `op: "prune"` is the only operation that drops unmatched entries, for cleaning up after such a rename; everything else preserves them. Saving models.json re-reads the switches through `op: "resync"`, which repairs the stored patterns against the new catalog: it rewrites renamed **models** and then renamed **providers**, **cuts back entries whose provider prefix no longer scopes them**, and re-asserts the providers that were fully enabled before the save. (Model references first: they still spell the old provider id, which the provider rewrite would otherwise have replaced already.) All three are needed because a pattern's meaning depends on the catalog. pi matches a pattern against the bare `modelId` as well as `provider/modelId`, so `stepfun/*` also matches another provider's model whose id *is* `stepfun/Step-5-Preview` — renaming a provider to `stepfun` silently enabled three `commandcode` models, and switching stepfun off then wrote them into the file. In the other direction, renaming a model to an id with a slash drops it out of `provider/*` (minimatch `*` stops at `/`), so a fully enabled provider silently loses it. A model renamed in the panel is a known move, not the kind of mismatch worth preserving: leaving `stepfun/ddd` behind after it became `stepfun/ddd1` loses the selection, and when it was the only entry the scope resolves to nothing, which pi reads as "no scope" and quietly enables every model. `ModelsConfig` mirrors every array move of the draft in `savedModelIdsRef` so `collectModelRenames()` can tell a rename from an add or a delete without guessing. Only `resync` repairs entries; ordinary toggles stay minimal edits and never rewrite what the user did not touch. A models.json provider missing from the runtime (unsaved edits, no models, a key that does not work) must not be reported as a sign-in problem, which is why it has its own control: the switch renders disabled with that reason as its tooltip, while `EnabledModelsSection` — now built-in only — keeps the sign-in empty state. See `docs/adr/0004-enabled-models-toggles.md`.

### SSE reconnect on page refresh mid-stream
On `ChatWindow` mount, `GET /api/agent/[id]` is called. If `state.isStreaming === true`, SSE is reconnected automatically. `thinkingLevel` and `isCompacting` are also synced from this response.

### Compaction SSE events
Newer pi emits `compaction_start` / `compaction_end`; older versions emitted `auto_compaction_start` / `auto_compaction_end`. `handleAgentEvent` accepts both sets to keep `isCompacting` in sync. Manual compact is a blocking POST — the button stays disabled until the response returns.

### Tool execution events on the SSE stream
- Calls a tool makes itself through `ctx.executeTool()` (a codemode script's) emit `tool_execution_*` with `parentToolCallId` and ids `<parent>/<n>`. `toClientAgentEvent()` sends their start and end slim with `parentToolCallId`, and drops their updates. Test for nesting *before* rebuilding an update: the rebuild keeps only `toolCallId`, `toolName` and `partialResult`, so a nested update would reach the browser as a top-level tool. `handleAgentEvent` keeps nested events out of the running-tools phase, and `AgentSessionWrapper` never records them for replay; a parent's end also forgets every id under `<parent>/`, and `agent_end` clears the replay set.
- `tool_execution_end` never carries `result`, which can hold up to 1 MiB of bash output in `structuredContent`: the browser reads only its ids and renders the tool result message that follows. `entry_appended` is omitted, since nothing reads it and a custom entry can be 1 MiB.
- A codemode update publishes every call made so far each time one starts or ends, so its `details.calls` is cut to the newest 200 with `omittedCalls` counting the rest.
- A codemode card shows the script and the calls it made (`details.calls`) as rows inside the card, never as cards of their own: those calls never reach the model as tool calls. `handleAgentEvent` keeps a running script's progress snapshot in `activeToolResults`, as it does for shell output, so the card lists calls while they run; a snapshot has no content, which is how the card tells it from a finished result and skips the empty output. The finished result's "Script completed / Wall time / Output:" header is dropped from the output, since the card's colour and duration already say it.
- `createAgentEventStream()` coalesces `tool_execution_update` per `toolCallId` (latest wins, `TOOL_UPDATE_COALESCE_MS`). Before forwarding a `tool_execution_end` it discards that id's pending update, and `agent_end` discards them all: an update delivered after the end would put the tool back in the running phase. Everything else is forwarded at once, so a pending update can arrive after unrelated events.

### Transcript system messages, usage entries and context edits (pi >= 0.86)
- Every new session's first request persists a `message` entry with `role: "system"` holding the prompt sections and tool declarations; later prompt or tool changes append more. The agent loop announces them with `message_start` / `message_end` like any message. They are provider input, never conversation: `toClientAgentEvent()` drops them before the SSE stream (they carry every tool schema), `handleAgentEvent` skips any that slip through, `entryToUiMessage()` returns null for them, and `BranchNavigator` / `lib/project-tree.ts` never label or preview a branch with one. They still count toward `messageCount` and `totalMessages`, exactly as the SDK counts them.
- `usage` entries (`kind: "cache_warm"`) record prompt-cache warming that is billed but never enters model context. `computeSessionStats()` adds them like compaction usage so the token/cost counters match `/session` in the TUI.
- `context_edit` entries omit or replace an earlier entry's model context without changing raw history; the UI ignores them. A retain-none compaction stores its own id in `firstKeptEntryId`.
- `SessionManager.listAll()` now reads files newest-mtime first (then reverse filename) so `--resume` can render progressively; its stable sort keeps that order for sessions with equal activity time, and `listSessionsIncremental()` reproduces it from the stat fingerprints it already keeps.

### Running state polling + reconciliation
- The sidebar polls `/api/agent/running` every 2.5 seconds while the tab is visible and pauses polling in background tabs. The session-list response remains the initial fallback.
- `invalidateSessionListCache()` bumps the generation but **keeps** the previous scan, and the cache is fresh only while its recorded generation matches. Ordinary agent activity invalidates it constantly, and rebuilding costs hundreds of milliseconds because `loadAllSessions()` re-reads every forked and subagent session. Callers that only need metadata — mapping search hits to sidebar rows — pass `listAllSessions({ allowStale: true })` to read the previous scan and let the rebuild happen in the background. A stale scan is a complete catalogue apart from sessions created seconds ago, so those callers accept a brief window where a brand-new session is not yet listed.
- `useAgentSession` treats per-session SSE as primary for chat events and opens it before each prompt. `prompt_done` completes the current UI stage and notification immediately, but the idle SSE stays open for a 30-second grace window and is reused by the next prompt. `agent_start` cancels that close timer; `agent_settled` finishes extension-injected runs that have no wrapper-level `prompt_done` and starts a fresh grace window. Do not close on the first `agent_end`: retries, compaction, and extension-queued messages can continue the same logical prompt.
- While a run is active, `useAgentSession` periodically calls `GET /api/agent/[id]` and also reconciles on `visibilitychange`/`online`. This fixes missed terminal events from background tabs or half-open connections.
- Prompt runs use a monotonic run id; late SSE or slow reconciliation responses from an old run must be ignored so they cannot resurrect stale streaming bubbles.
- Every SSE (re)connection in `useAgentSession` is gated on `sessionHookMountedRef`. React Strict Mode (on by default in `next dev`) re-runs effects in declaration order after a simulated unmount: the mount-only effect's cleanup sets that ref to `false`, and it is only restored when that effect re-runs, *after* the warm-session effect. The warm-session effect therefore re-asserts the ref before `maintainEventsConnected()`. Without it a dev-server tab never opened the event stream on mount or when switching back to a running session, so streamed output and new messages stayed invisible until the 15-second reconcile poll or a page refresh (`next start` was unaffected).

### Worktrees and project grouping
- `lib/worktree.ts` resolves linked worktree top-levels back to the main repo `projectRoot`; `listAllSessions()` attaches that to each `SessionInfo` so all worktrees for one repo are grouped together in the sidebar.
- Worktree operations are served by `/api/worktrees` and guarded by the same allowed-root rules as `/api/files`.
- New worktrees are created under `<repoRoot>-worktrees/<sanitized-branch>`. Existing branches are reused; otherwise `git worktree add -b` creates the branch.
- Removing a dirty worktree returns `409` with `{ dirty: true }` so the UI can ask before retrying with `force`.
- Sessions whose cwd points at a removed worktree are inferred back into the main project instead of becoming a phantom project row.
- git prints POSIX-style absolute paths even on Windows, so every path read out of git goes through `toNativePath()` (`lib/paths.ts`) before it is compared or returned. Compare paths with `samePath()`, never `===` — raw equality made `isTopLevel` permanently false on Windows and hid the worktree switcher entirely. Branch names are not paths and must keep their forward slashes. Browser code cannot apply Node path rules, so `/api/worktrees` resolves `currentWorktreePath` server-side; the sidebar must use that identity for highlighting and removal fallback.

### File access allow-list
- `/api/files` is intentionally not a general filesystem browser. Allowed roots come from session cwds, their resolved project roots, and roots explicitly added with `allowFileRoot()`.
- `/api/files/...?sessionId=` also reads (never lists) a file outside the roots when that exact path appears in the session, so a chat link to it opens (`lib/session-file-references-core.ts`). Four things never count: transcript system messages (they carry every tool schema), the codemode script store, `context_edit` replacements (the UI never shows them, and they often restate a tool result), and the result of any tool other than pi's coding tools and the subagent tools — MCP, codemode, third-party extensions relay text a remote party controls, and any string in it would become readable. Such a result still authorizes its `details.fullOutputPath` and the arguments of the coding-tool calls it made through `ctx.executeTool()` (`nestedCalls`); arguments of its nested MCP calls do not count, because a script hands one MCP result to the next call without the model reading it. User and assistant messages, the model's own tool call arguments (MCP calls included) and the other entries count as before. Tools are matched by name, so keep the list in step with `CODING_TOOL_NAMES`.
- `/api/cwd/validate` and `/api/worktrees` call `allowFileRoot()` when they make a new location browsable. "Use default directory" is no exception: `/api/default-cwd` only creates `~/pi-cwd/YYYYMMDD`, and the sidebar selects it through `/api/cwd/validate` like any other directory.
- Allowed roots are stored slash-normalized, but that is a Set-key convention, not a correctness requirement: `isPathWithinRoots()` (`lib/path-security.ts`, the single implementation behind `isFilePathAllowed()`) re-resolves and case-folds both sides, so either path form authorizes correctly. Keep that one implementation — it is the security boundary.
- A UNC cwd (`\\host\share\dir`) must survive the `/api/files/[...path]` round-trip. `encodeFilePathForApi()` folds the `//` root into the first segment (`%2F%2Fhost`) because a literal `//` URL prefix is 308-normalized away before routing; `filePathFromApiSegments()` decodes it back. Never split UNC paths into segments and rejoin them — that silently turns `\\host\share` into the relative-looking `host/share` and every allow-check fails with 403.
- What `type=list` leaves out is visibility, never access: hidden entries stay readable by path. `lib/file-tree-visibility.ts` matches a listing's entries against the ignore rules with one `git check-ignore --no-index --stdin`, then asks one `git ls-files` which of the matched names hold a tracked path, since ignoring never applies to what Git tracks — so a tracked `build/` is listed and an ignored directory with a force-added file shows just that file. Never let check-ignore consult the index itself: it scans the whole index once per name, which took seconds for a 1,000-entry folder in a 200k-file repository and then fell back at the 5s timeout. `.git` and `.DS_Store` are always hidden. The fixed name list (`node_modules`, `dist`, `build`, …) applies only where Git has no view: outside a work tree, when git fails or times out, and inside a directory that is itself ignored with nothing tracked below it (otherwise a scratch dir under a dotfiles repo that ignores `*` would list empty). Names go to check-ignore as `./name`, since it rejects pathspec magic such as a leading `:(` for the whole batch, and to ls-files under `--literal-pathspecs`, so `*.log` or `[id]` cannot match a tracked `app.log` or `i`. Both calls pass `-c core.fsmonitor=false`, because reading the index otherwise runs a hook configured by whatever repository the user just expanded.
- A directory link (symlink or Windows junction) is authorized by where it resolves, so one inside a root that leads outside every root is listed but refused beneath it (#748). Never authorize the lexical path instead: a link committed to a cloned repo would then expose `~/.ssh` or `/` without the operator doing anything. The listing reports such a link's target as `outsideLinkTarget`; the explorer shows it with an "Allow browsing" button that posts `?type=allow-link` with that target. `checkLinkedDirectoryApproval()` (`lib/linked-directory.ts`) requires the link to sit in a directory that is inside the roots after resolving links and to still point where the operator was shown, then the route `allowFileRoot()`s the target until the server restarts — exactly the grant `/api/cwd/validate` gives any directory, so the endpoint widens nothing a caller could not already reach.
- `isExistingPathWithinRoots()` refuses any path with a `..` segment. Authorization (lexical, and Node's JS `realpathSync` alike) collapses `..` before resolving links, while the filesystem applies it after, so `link/../x` names a file beside the link's target: `/api/file-index?cwd=<project>/link/..` listed the folder holding it. Query-string and body paths reach the check verbatim; in `/api/files/[...path]` URL parsing drops literal `..` segments, and an encoded slash inside one segment (`link%2F..%2Fx`) is refused by the route itself, because a file referenced by the session skips the existing-path check. A link whose target contains a root or the home folder (`/`, `~`, a parent of the project) is listed with `outsideLinkEncloses`, and the explorer asks for confirmation before allowing it.

### Plugins and skills
- `/api/plugins` uses pi's `SettingsManager` + `DefaultPackageManager` for global/project package install, remove, update, enable, and disable. Disabling writes empty `extensions/skills/prompts/themes` arrays for that package entry.
- `/api/skills` uses `DefaultResourceLoader` so settings paths, package skills, and project `.agents/skills` are listed the same way the runtime sees them.
- Skill toggling edits only the `disable-model-invocation` frontmatter key on the target `SKILL.md`; keep that surgical so user formatting survives.
- `/api/skills/install` shells through `npx skills add ... --agent pi`; project installs run with the selected cwd.
- Each sidebar group of the Skills and Plugins panels (a skill scope, a package scope; not standalone extensions) has a small switch in its heading (`ConfigSidebarGroupSwitch`), with the same rule as the Models panel's provider switch: on only while every row is, so a partial group reads as off beside its `n/m` count and one click completes it. It lives in the heading row so the sidebar loses no height, which matters in the 190px phone layout. A switch sends one request with a list (`PATCH /api/skills` with `filePaths`, `POST /api/plugins` with `packages`) and gets a result per item, so a refused row does not stop the rest; what it left undone is shown under that group's heading (`ConfigSidebarGroupStatus`). `SettingsManager` records load and write failures instead of throwing, and `flush()` still resolves; the bulk plugin path reads them back with `drainErrors()`, or an unreadable settings.json would report success. An entry already in the requested state is left alone, and enabling keeps an entry's own keys such as `autoload`. Disabling empties the four resource lists and nothing keeps the filters they replaced, so switching a group off leaves an enabled filtered package on (the SDK reports every object entry as `filtered`) and says so, and the bulk route refuses one. `PATCH /api/skills` edits only `.md` files: the roots it allows also hold `auth.json`, settings and project files.
- The Skills and Plugins panels are built from the shared blocks in `components/SettingsUi.tsx` (`ConfigScopeTag`, `ConfigScopeSwitch`, `ConfigAddSourcePanel`, `ConfigDetailGrid`, `ConfigFooterStatus`, `ConfigTrustNotice`), `itemsToSwitch()` in `components/settings-ui-helpers.ts`, and `lib/display-path.ts`; a new settings section reuses them instead of copying a panel. Why a control is unavailable is visible text — a scope switch's `disabledReason` (under the switch's whole line, so controls passed as its `children` stay level with it), the note under a detail header, a footer summary that opens its diagnostics — never only a `title` tooltip, which a touch screen cannot show. `SettingsUi.tsx` takes every word as a prop and holds no state, so it renders outside the i18n provider; the panels pass `t()` strings. `ConfigTrustNotice` shows its button only when given `onTrust`, and neither panel passes one yet: trusting from Settings needs `AppShell`'s trust state threaded through `SettingsPanel` and a reload of the panel afterwards.

### Built-in subagents
- The global `builtInEnabled` switch is persisted in `~/.pi/agent/agents/settings.json` and defaults to `false` when the file or field is absent. Malformed settings fail closed; atomic updates preserve unknown fields.
- The inline built-in extension factory is always present so reloading an existing wrapper can apply setting changes, but it registers no tools while disabled. After changing the switch, the user must explicitly reload the current session.
- When enabled, only a recognized legacy `pi-subagents` extension that registers any reserved tool (`Agent`, `get_subagent_result`, or `steer_subagent`) is removed. Unrelated extensions remain loaded, and resolved conflict diagnostics are discarded.
- Runtime `Agent` dispatch checks the setting again so a stale tool call cannot start a subagent after the feature is switched off.
- `Agent`, `get_subagent_result`, and `steer_subagent` register with `exposure: "model-only"`: pi declares and activates them like `direct` tools, but never lets another tool reach them through `ctx.executeTool()`, so a codemode script cannot start, collect, or steer a subagent. A run started from a script would record the nested call id (`<codemode call>/<n>`) as its `parentToolCallId`, which no transcript entry carries, and the chat would lose its link to the child session. `lib/subagent-extension.integration.test.mjs` pins this against a real `AgentSession`.
- See `docs/adr/0003-built-in-subagent-toggle.md` for the precedence and persistence rationale.
- A run stays in `getSubagentRuns()` from dispatch until its result entry is written, so `get()` reports a persisted `running` / `queued` status with no result and no running wrapper as `interrupted`: the process that owned it stopped mid-run and nothing will ever finish it. Returning the stale `running` kept `get_subagent_result({ wait: true })` polling forever after a restart.
- Individual built-in profiles (`general-purpose`, `explore`, `plan`) are switched off by name in the same file's `disabledBuiltIns` array, never by copying them out to a `.md` file: a copy freezes the built-in prompt at the version it was copied from and is visible to the other runtimes reading those directories. `builtInProfiles()` stamps `enabled` onto the constants so the panel, the `Agent` tool description, and `resolveSubagentProfile` agree; each write is a minimal edit that preserves names it did not touch, including ones no built-in claims (a newer build's). Reading the list fails *open* — the feature switch beside it has already failed closed — while `PATCH /api/subagents/profiles` with `scope: "builtin"` performs the write and `PUT`/`DELETE` still refuse that scope. A same-name file replaces the built-in outright and is switched off through its own frontmatter. Only the switch is live for a built-in; the rest of the form stays read-only. See `docs/adr/0005-built-in-subagent-disable.md`.
- A background run's completion notification (`notifyParent`) is skipped when the parent already collected the same result with `get_subagent_result`: the tool marks a finished background run consumed and the notification takes that mark. The check cannot happen only when the completion promise resolves — the parent is usually still inside its `get_subagent_result` poll at that moment (500ms interval) and `deliverAs: "followUp"` would just queue the duplicate until that turn ends. So `notifyParent` holds the message while the parent `isRunning()` and re-checks the mark before sending; an idle parent is still notified immediately. The mark names the run (`sessionId` + `completedAt`), never just the session: `resume` reruns the same session id, and a parent that polls *after* a notification was delivered leaves a mark nothing takes, which a session-keyed mark let swallow the next run's notification and strand the parent (#987). `resume` keeps the mark: a parent can collect a run and resume it in the same turn while that run's notification is still held, and the mark must still suppress it.
- Agent profile files (`~/.pi/agent/agents/*.md`, project `.pi/agents/*.md`) are shared with other runtimes, so a save round-trips the frontmatter keys this app does not own (`name`, `allowed_subagents`, `exclude_extensions`, `disallowed_tools`, …) and carries foreign `ext:` tool selectors through. Managed keys are exactly `description`, `display_name`, `tools`, `load_skills`, `load_extensions`, `enabled`, `inherit_context`, `run_in_background`, `model`, `thinking`, `max_turns`.
- A background run's completion reaches the parent through `sendCustomMessage`, and pi's `convertToLlm` replays every `custom` message to the model as a plain `user` turn. `subagentNotificationText()` therefore prefixes the report with `SUBAGENT_NOTIFICATION_PREFIX` so a compaction pass — whose prompt asks what *the user* wants — does not file the subagent's output under Goal / Constraints (#875). Foreground `Agent` and `get_subagent_result` results keep the bare `subagentFinalText()`: they are already `toolResult` messages and need no marker. Keep the prefix in code, not in a profile prompt, so the model cannot drop it. A run started by `resume` carries an in-memory `resumed` flag, and its notification adds a line saying it supersedes the earlier report: `resume` reuses the session ID, so the plain text is identical to the first run's and the parent cannot tell a new result from a repeat (#985).
- The `skills` / `extensions` spellings pi-subagents reads are seeded on first save and kept in step while they are booleans; a hand-authored whitelist such as `extensions: pi-advisor-flow` is never rewritten, and the two flags fall back to those aliases when `load_skills` / `load_extensions` are absent.

### Web password throttling
- `lib/auth-throttle.ts` is deliberately global, not per-IP: Next 16 route handlers have no socket address and `x-forwarded-for` is spoofable, while the server binds `127.0.0.1` for a single operator. Failures double the delay (1s → 60s cap) for everyone; a success or 5 idle minutes resets it. The reset window must stay longer than the max delay or waiting out one block restarts the burst.
- State lives on `globalThis` under `Symbol.for("pi-web:auth-throttle")` so it survives hot reload and is shared by every module instance. Tests reset it with `recordAuthSuccess()`.
- `POST /api/web-auth` and every `Authorization: Basic` header on `/api/*` share the counter; `proxy.ts` checks Basic before its `/api/web-auth` exemption, so `GET /api/web-auth` is not an unthrottled password oracle. A valid session cookie is checked first and is never blocked. While blocked, Basic gets `429` even with the right password (otherwise the answer leaks), and a Basic success does not reset the counter: Basic clients authenticate on every request, so a reset would restart an interleaved guesser at the base delay. The proxy and route handlers share the `globalThis` state under both `next dev` and `next start` (checked by failing one and observing `429` on the other).

### Auth and model config
- `ModelsConfig` combines models from `~/.pi/agent/models.json` with provider auth status from pi's `AuthStorage`/`ModelRegistry`.
- Provider listing is capability-driven, never id-driven: `lib/provider-listing.ts` decides membership from `auth.apiKey.login` / `auth.oauth` plus the stored credential type, so dual-auth providers (anthropic and github-copilot today — which providers declare both changes between SDK releases, so never assume it from an id) appear exactly once and never fall through both lists (#309). `lib/provider-listing-runtime.ts` adapts `ModelRuntime` to those pure helpers.
- auth.json holds **one** credential per provider and `ModelRuntime.logout()` deletes whichever it is. The delete routes therefore use `removeStoredCredentialIfType()` to compare and delete under the same file lock used by pi's auth storage. `ModelsConfig` also refreshes *both* provider lists after any auth change — refreshing one leaves a dual-auth provider rendered twice.
- OAuth/device-code/manual-code flows are streamed by `GET /api/auth/login/[provider]`; manual code responses POST back with a short-lived token stored in `globalThis.__piLoginCallbacks`.
- API-key routes store and remove keys through `AuthStorage`. Status endpoints must never return the raw key.
- The model test route is `app/api/models-config/test/route.ts`; `app/api/models/test/` is not a real route.

### Mobile software keyboard (`hooks/useViewportHeight.ts`)
- While an editor has focus and the visual viewport is more than `KEYBOARD_MIN_HEIGHT_PX` (60px) shorter than `innerHeight / scale`, the hook writes `visualViewport.height` to `--app-viewport-height`. Compare against the zoom-corrected height: iOS auto-zoom and pinch zoom shrink the visual viewport on their own, and skipping zoomed pages left the composer behind the keyboard. Smaller shrinks are Safari toolbars.
- WebKit settles the shrunken height only after the keyboard animation, often without another `resize` (bugs.webkit.org 265578), and an IME candidate bar resizes the keyboard with no viewport event at all. Every trigger therefore starts one non-restarting chain of re-reads (`SETTLE_DELAYS_MS`), and composition/input/keyup events on a focused editor count as triggers. Reading once per event kept the full-screen height; the page then scrolled to the caret and `scrollTo(0, 0)` fought the user's finger, which reads as a jittering composer.
- The same check sets `<html data-keyboard-open>`. Under `(max-width: 640px), (pointer: coarse) and (max-height: 500px)` CSS then hides `.chat-input-controls` and `.extension-status-shelf` and drops the bottom safe-area padding the keyboard already covers. Phone landscape is included because it has the least height; tablets keep their controls. `MobilePwaLayout.test.mjs` asserts each targeted class exists on its component, so a rename cannot leave a rule silently dead.

### Completion sound
- `hooks/useAudio.ts` stores the toggle in `localStorage` as `pi-sound-enabled` and reuses one `AudioContext`.
- Browser autoplay policy means sound must be unlocked from a user gesture; `ChatInput` calls the unlock hook from interactive controls, and `ChatWindow` plays the tone from `onAgentEnd`.

### Exported session HTML
- `/api/sessions/[id]/export` delegates to pi's export helper, then patches recursive tree helpers in the generated HTML to iterative versions so very deep linear sessions do not overflow the browser call stack.

### Old Safari (iOS 16.2)
- `/` renders entirely on the client, so one script chunk the browser cannot *parse* is a blank page, not a broken feature (#753). Next 16 compiles for Safari 16.4+ by default; the `browserslist` in `package.json` lowers Safari and iOS to 16.2 so SWC turns class `static {}` blocks into private static fields. That reaches Next's own client runtime, but other node_modules keep the syntax they ship unless they are in `transpilePackages`; mermaid and `@mermaid-js/parser` are listed there because their lazy diagram chunks are full of static blocks. Keep the other browserslist entries at Next's defaults.
- SWC cannot downlevel a RegExp **lookbehind** (`(?<=`, `(?<!`), which Safari parses only from 16.4. Do not write one in client code: `lib/markdown.ts` emulates its leading lookbehinds with `replaceNotPrecededBy()`. A lookbehind built at runtime (`new RegExp("(?<=…)")` inside `try`) only fails when it runs, which is how `lib/gfm-autolink-email-loader.cjs` fixes the email regex in `mdast-util-gfm-autolink-literal`; the loader is registered for both webpack and Turbopack in `next.config.ts` and fails the build if that regex changes upstream.

## Pi Session File Format

Location: `~/.pi/agent/sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl`

```jsonl
{"type":"session","version":3,"id":"<uuid>","timestamp":"...","cwd":"/path","parentSession":"/abs/path/to/parent.jsonl"}
{"type":"model_change","id":"<8hex>","parentId":null,"provider":"zenmux","modelId":"claude-sonnet-4-6","timestamp":"..."}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"user","content":"..."}}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"assistant","content":[...],...}}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"toolResult","toolCallId":"...","content":[...]}}
{"type":"compaction","id":"<8hex>","parentId":"<8hex>","summary":"...","firstKeptEntryId":"<8hex>","tokensBefore":N}
{"type":"session_info","id":"...","parentId":"...","name":"user-defined name"}
```

`entryIds[]` in `SessionContext` is a parallel array to `messages[]` — maps each displayed message back to its `.jsonl` entry id, used for fork and navigate_tree calls.

---

## CSS Variables (`app/globals.css`)

```
--bg --bg-panel --bg-hover --bg-selected --border
--text --text-muted --text-dim
--accent --user-bg --tool-bg
--font-mono
```



