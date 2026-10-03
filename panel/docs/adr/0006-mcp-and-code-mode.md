# 0006 — MCP servers and Code mode are managed like plugins

## Status

Accepted. Implemented in phases (see "Rollout"); P0 and P1 are in place.
Normal sessions load pi's built-in `codemode`, `tool-search`, and `mcp`
extensions and connect the servers in the global `mcp.json` and in a trusted
project's `.pi/mcp.json`, but nothing manages them from the browser yet.
Per-entry approval of project servers was dropped after P1 in favor of the
CLI's project trust (see "Safety").

## Context

pi 0.99 ships three built-in extensions with the CLI: `codemode` (the model
writes JavaScript that runs in a QuickJS worker and calls other tools),
`tool-search`, and `mcp` (servers from `mcp.json`, stdio or streamable HTTP,
OAuth, the `/mcp` command). The CLI prepends them from
`dist/extensions/index.js`, which the package does not export. The SDK root
exports the three factories (`createCodemodeExtension`,
`createToolSearchExtension`, `createMcpExtension`), but not the list, nor the
MCP config editor, connection class, or OAuth sign-in helper.

Pi Web loads none of them, so `"defaultTools": ["+codemode"]` does nothing and
`mcp.json` is ignored. The goal is for both features to be as easy to use as
the Plugins panel: paste something to add it, a switch to turn it off, a button
to remove it, and no session required to manage any of it.

Loading the extensions exactly as the CLI does is not enough, because Pi Web is
a long-lived, possibly remote server that runs many sessions in one process:

- **Fan-out.** The MCP extension connects every enabled server on
  `session_start`, once per `AgentSession`. Pi Web creates wrappers without a
  prompt — `get_tools` when switching sessions, auto-naming, SSE warm-up — and a
  visible session holds a liveness lease, so it is never reclaimed by the idle
  timer. Every browsed session would spawn every stdio server and keep it.
- **Stop.** The extension's `before_agent_start` handler waits up to 10 s for
  servers to connect and ignores the abort signal, so Stop does nothing during
  that wait.
- **Environment.** The stdio transport spawns servers with the whole
  `process.env`, including `PI_WEB_PASSWORD`.
- **Applying changes.** `mcp.json` is read once, on `session_start`; a change
  needs `/reload`.
- **Sign-in.** The OAuth callback listens on `127.0.0.1`, and the default
  `openUrl` opens a browser on the server host, which a remote Web user never
  sees.
- **Management UI.** The `/mcp` manager renders only when `ctx.mode === "tui"`.
- **Trust.** A project `.pi/mcp.json` is read once the project is trusted, and
  trust is inherited from ancestor folders, so a repository cloned under a
  trusted parent starts its servers on first open without anyone seeing them.
  The same holds for its `.pi/extensions`, which run earlier still.
- **Tool activation.** `withExtensionTools()` re-activates every extension tool
  whose exposure is `direct` or `model-only`, ignoring `defaultActive: false`,
  so loading `codemode` and `tool_search` would force both on in every session.

## Decision

### Loading

Normal sessions add the three factories to `extensionFactories` as
`{ name, factory, replaceable: true, builtin: true }`, with the CLI's names
(`codemode`, `tool-search`, `mcp`). `DefaultResourceLoader` resolves them as
`builtin:<name>` paths, so the shared `-builtin:<name>` setting, project
`+`/`-`/`!` overrides, `noExtensions`, and replacement by a third-party
extension that registers `/mcp`, `codemode`, or `tool_search` all behave as in
the CLI. Chat-only and subagent sessions do not load them.

### Pi Web decides which MCP servers a session connects

The `mcp` factory is created with a `loadConfig` that returns no servers, so
`session_start` connects nothing and the 10-second startup wait never arms. A
per-wrapper `McpHost` reads the global and project `mcp.json` itself and
registers the servers it wants through the public `pi.registerMcpServer()` /
`pi.unregisterMcpServer()`:

- **Before every prompt that starts a run** it reads the config and the
  project's trust, registers or unregisters only the servers whose entry changed,
  and waits up to 10 s for the ones still connecting. The wrapper runs this
  before `AgentSession.prompt()`, because `before_agent_start` runs before a
  run has an abort signal: Stop ends the wait and rejects the message unsent,
  which returns it to the composer. A server that outlasts one full wait is
  not waited for again. A change therefore reaches every open session on its
  next message, including changes made outside Pi Web (`pi mcp add`, a manual
  edit, `git pull`), and there is no Reload button. A sign-in made elsewhere
  needs no re-registration: the extension reconnects servers waiting for one
  when their stored tokens change.
- **Nothing connects until a session prompts.** Browsing, switching sessions,
  auto-naming, and forking start no MCP process. A host that has not prompted
  for `PI_WEB_MCP_IDLE_MS` (10 minutes) unregisters its servers.
- Operations on one host run in a serial queue, and a server is replaced only
  once the extension has opened its connection: the extension's
  `mcp_servers_change` handler closes `server.connection`, which it assigns
  only after loading the MCP runtime, so unregistering earlier finds nothing
  to close and the server connects anyway, out of reach. The extension does
  not report connection state, so the host watches the transports it creates
  through the factory Pi Web passes in: one exists only once the connection
  is assigned, and its messages show when the server's tools are listed.

This differs from the CLI in two visible ways, both shown in the panel: servers
report the scope `extension`, and a package extension that registers a server
with the same name first keeps it (reported as a name conflict).

### Settings › MCP, without a session

A new Settings section sits next to Plugins and is built from the same
`SettingsUi` primitives: servers grouped by Project and Global with a group
switch and an `n/m` count, a status dot per row, a detail pane with Sign in,
Test, Remove, and a switch, and an "Add MCP server" action.

- `GET /api/mcp` reads files only. It never spawns a process, opens a network
  connection, or runs a `!command` value.
- **Adding is one paste box.** `lib/mcp-import.ts` recognises a URL, a command
  line, `pi|claude|codex|gemini mcp add …`, Claude / Cursor / VS Code / Zed /
  opencode JSON, and Cursor and VS Code install links, and maps them to pi's
  schema; the server re-parses and validates with the SDK's
  `validateMcpServerConfig`. Missing values become password fields. A new
  server is tested automatically.
- **Test connection and OAuth sign-in run server-side**, through SDK modules
  the package does not export (`McpServerConnection`, `signInMcpServer`),
  loaded by file URL in `lib/pi-sdk-internals.ts`. A sign-in flow outlives the
  browser's event stream, and the "paste the redirected address" box is always
  shown, so sign-in works from a phone or a remote browser.
- **Writes** mirror the SDK's minimal `mcp.json` edits, under a file lock,
  atomically, `0600` for the global file, through the real path of a
  symlinked file, and refuse (`409 unparsable`) a file they cannot parse.
- **Secrets typed in the panel are stored as escaped literal values in the
  global `mcp.json`.** That matches how Pi Web stores provider API keys and lets
  the CLI read them. A server that carries a literal secret can only be saved
  globally, and the panel says so.
- **Remove is undoable for 60 seconds**; the removed entry is held server-side
  and never sent back to the browser.
- `/mcp` typed in the composer opens this panel when the command belongs to
  `builtin:mcp`; a third-party `/mcp` is sent as before.
- Registry search is deferred. The add panel links to `github.com/mcp`, whose
  Install buttons produce links the paste box accepts.

### Code mode

The panel offers one choice, **Automatic** or **Always on**:

- **Automatic** (default) writes nothing. `codemode` registers inactive, and
  the MCP extension activates it when a server with `codemode` exposure
  connects.
- **Always on** adds `+codemode` to `defaultTools` through
  `/api/tools/settings`, which stays the only writer of that key and shares its
  lock with the PowerShell switch.
- There is no **Never**: MCP tools with `codemode` or `deferred` exposure cannot
  be called without `codemode` or `tool_search`.

Before the first normal session, Pi Web runs one script through the SDK's
codemode tool. If the sandbox cannot run (its worker and wasm are resolved from
the SDK's files at run time), no session offers `codemode`: the
`builtin:codemode` entry stays, so settings that name it keep their meaning,
but registers nothing.

`codemode.mode`, `codemode.inlineBudget`, `autoEnableCodemode`, and the
`±builtin:*` entries stay file-only; they keep working as in the CLI.

`resolveActiveToolNames()` replaces `withExtensionTools()`. It respects
`defaultActive: false`, carries extension tools that were activated at runtime
(by the MCP extension or `tool_search`) across `set_tools` and `reload`, and
re-applies a session's pinned preset after `navigate_tree`, because the SDK
restores the branch's tool set from its transcript.

### Safety

- **Environment.** Pi Web spawns stdio servers with `inheritEnv: false` and
  the environment that project bash commands receive (`PI_WEB_PASSWORD`,
  `PORT`, `NODE_ENV`, and `NEXT_*` removed), plus the server's own `env`. An
  entry that references `PI_WEB_PASSWORD` is refused. If the internals adapter
  cannot load, MCP is off: Pi Web never falls back to the SDK's default
  transport.
- **Project entries follow project trust, as in the CLI.** A project
  `mcp.json` is read only once the project is trusted, inherited trust
  included, and every enabled entry then connects on the next prompt. An
  earlier version of this decision also approved each entry by the SHA-256 of
  its JSON, in a Pi Web-only `mcp-approvals.json`. It was dropped after P1: a
  trusted project's `.pi/extensions` already run inside the same boundary,
  earlier (when a session is browsed, not when it prompts) and with no
  approval, so gating only MCP entries stopped neither a malicious repository
  nor inherited trust, and it made Pi Web and the CLI disagree about which
  servers run. What Pi Web adds is visibility: the panel lists an untrusted
  project's entries with the command each would run, and the trust dialog
  lists them before the folder is trusted. Tightening trust itself (exact
  rather than inherited, or per entry) belongs upstream, for extensions and
  MCP servers alike.
- **Fresh folders.** Writing `.pi/mcp.json` makes a folder require trust, and
  `trustProject()` refuses a folder that does not. When neither the folder nor
  an ancestor has a trust decision, adding a project server trusts the folder
  in the same request, and the button says "Add and trust this folder".
- **Read-only.** A `tool_call` policy blocks MCP tools without
  `readOnlyHint: true` while the Read-only preset is pinned, for top-level and
  nested calls. The hint comes from the server; the policy guards against
  model mistakes, not against a malicious server.
- **File access.** Session file references no longer authorize paths that
  appear only in system messages or in the text of non-coding tool results;
  MCP results would otherwise make any string they contain readable through
  `/api/files`.
- **Subagents.** `Agent`, `get_subagent_result`, and `steer_subagent` become
  `model-only`, so a codemode script cannot start subagents.
- **Operators.** `PI_WEB_DISABLE_MCP=1` turns MCP off for the whole server.
  Nothing in the browser can override it.

### Transport, rendering, and lifecycle

- The SSE projection slims nested tool events (those with `parentToolCallId`),
  drops nested updates, removes `result` from `tool_execution_end`, omits
  `entry_appended`, coalesces updates per `toolCallId`, and truncates codemode
  call snapshots, which otherwise grow with the square of the number of calls.
- Extension dialogs queue instead of sharing one slot, so concurrent confirms
  from a script cannot overwrite each other.
- A wrapper is removed from the registry by identity, reports itself closing
  as soon as shutdown starts, and gives `session_shutdown` a deadline
  (`PI_WEB_SHUTDOWN_DEADLINE_MS`, 5 s), because closing an MCP connection has
  no upper bound.

## Rollout

- **P0 — foundation, no visible feature.** `resolveActiveToolNames()`, wrapper
  lifecycle, extension dialog queue, SSE projection, narrower file references,
  `model-only` subagent tools, the internals adapter with contract tests, the
  environment-scrubbing transport, and the shared settings components (Plugins
  and Skills move to them; their hard-coded English and tooltip-only reasons
  are fixed on the way).
- **P1 — runtime, not yet exposed.** Load the built-ins, `McpHost`, the
  Read-only policy, the Code mode writer, the sandbox self-test (a failing
  self-test registers `codemode`-exposure servers as `deferred` instead), and
  the codemode and MCP result views.
- **P2 — Settings › MCP ships.** Panel, routes, paste import, test, sign-in,
  project servers in the trust dialog, `/mcp` interception.
- **P3.** Registry search, editing an existing entry, TOML and YAML paste,
  per-tool exposure, the same fresh-folder fix for Plugins and Skills.
- **P4.** Per-session switches, MCP for subagents, and dropping the internals
  adapter once upstream exports what it needs.

## Consequences

- Pi Web and the CLI share `mcp.json`, `mcp-auth.json`, `trust.json`, and the
  `-builtin:<name>` settings, so both connect the same servers for the same
  project.
- The internals adapter couples Pi Web to file paths inside the SDK package.
  Contract tests fail on an SDK upgrade that moves or renames them; MCP then
  turns off with a visible reason instead of misbehaving.
- A `!command` value in `env`, `headers`, or `oauth.clientSecret` runs
  synchronously (up to 10 s) on every connection and blocks the event loop.
  Tests of such entries run one at a time, and the panel labels them.
- On Windows, a hard exit can leave stdio servers running: the transport's exit
  hook that kills the process group exists only on POSIX.
- Upstream requests that would remove Pi Web code: export the built-in list,
  the MCP config editor, `McpServerConnection`, and `signInMcpServer`; a status
  callback; abortable startup waits; asynchronous `!command` resolution; a
  configurable OAuth redirect URI; restoring `tool_search` loads on resume.
