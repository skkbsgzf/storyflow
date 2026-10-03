import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate as nextMacrotask, setTimeout as delay } from "node:timers/promises";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { McpHost, resolveMcpIdleMs, watchConnection, withReachableExposure } = await jiti.import("./mcp-host.ts");

class FakeTransport {
  sent = [];
  messageListeners = new Set();
  closeListeners = new Set();
  async send(message) {
    this.sent.push(message);
  }
  onMessage(listener) {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }
  onClose(listener) {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }
  receive(message) {
    for (const listener of this.messageListeners) listener(message);
  }
  close() {
    for (const listener of this.closeListeners) listener();
  }
  /** The client side of a handshake: initialize answered, then initialized sent. */
  async handshake(capabilities) {
    this.receive({ jsonrpc: "2.0", id: 0, result: { protocolVersion: "2025-06-18", capabilities } });
    await this.send({ jsonrpc: "2.0", method: "notifications/initialized" });
  }
}

test("PI_WEB_MCP_IDLE_MS defaults to 10 minutes and 0 keeps servers connected", (t) => {
  t.mock.method(console, "warn", () => {});
  assert.equal(resolveMcpIdleMs(undefined), 600_000);
  assert.equal(resolveMcpIdleMs(" "), 600_000);
  assert.equal(resolveMcpIdleMs("0"), 0);
  assert.equal(resolveMcpIdleMs("1500"), 1500);
  assert.equal(resolveMcpIdleMs("soon"), 600_000);
  assert.equal(resolveMcpIdleMs("-1"), 600_000);
});

test("without a codemode sandbox, script-only tools are offered through tool_search", () => {
  const config = { command: "srv", toolExposure: { a: "codemode-deferred", b: "direct", c: "codemode" } };
  assert.equal(withReachableExposure(config, true), config);
  assert.deepEqual(withReachableExposure(config, false), {
    command: "srv",
    exposure: "deferred",
    toolExposure: { a: "deferred", b: "direct", c: "deferred" },
  });
  assert.deepEqual(withReachableExposure({ url: "https://x", exposure: "direct" }, false), { url: "https://x", exposure: "direct" });
  assert.deepEqual(withReachableExposure({ url: "https://x", exposure: "hidden" }, false), { url: "https://x", exposure: "hidden" });
});

function watched(transport) {
  const outcomes = [];
  watchConnection(transport, (outcome) => outcomes.push(outcome));
  return outcomes;
}

test("a connection is ready once its tool lists are answered, every page of them", async () => {
  const transport = new FakeTransport();
  const outcomes = watched(transport);
  await transport.handshake({ tools: {} });
  await nextMacrotask();
  assert.deepEqual(outcomes, [], "tools are expected but not listed yet");

  await transport.send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  transport.receive({ jsonrpc: "2.0", id: 1, result: { tools: [], nextCursor: "2" } });
  // The client asks for the next page in the microtasks that follow the answer.
  await Promise.resolve();
  await transport.send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: { cursor: "2" } });
  await nextMacrotask();
  assert.deepEqual(outcomes, []);

  // A server-initiated request is not an answer.
  transport.receive({ jsonrpc: "2.0", id: 7, method: "roots/list" });
  transport.receive({ jsonrpc: "2.0", id: 2, result: { tools: [] } });
  await nextMacrotask();
  assert.deepEqual(outcomes, ["ready"]);
  transport.close();
  assert.deepEqual(outcomes, ["ready"]);
});

test("a server without lists is ready after the handshake, and a closed one is not", async () => {
  const bare = new FakeTransport();
  const bareOutcomes = watched(bare);
  await bare.handshake({ prompts: {} });
  await nextMacrotask();
  assert.deepEqual(bareOutcomes, ["ready"]);

  const closed = new FakeTransport();
  const closedOutcomes = watched(closed);
  closed.close();
  await closed.handshake({});
  await nextMacrotask();
  assert.deepEqual(closedOutcomes, ["closed"]);
});

// ---------------------------------------------------------------------------

const MCP_COMMAND = { name: "mcp", sourceInfo: { path: "builtin:mcp" } };

function entry(name, config, scope = "global") {
  return { name, config, source: `/agent/${scope}.json`, scope };
}

/**
 * A pi whose MCP extension connects what is registered through the host's
 * transport factory, when the test says so.
 */
function setup({ servers = [], commands = [MCP_COMMAND], codemodeAvailable = true, projectTrusted = true, ...options } = {}) {
  const handlers = new Map();
  const log = [];
  const registered = new Map();
  const pi = {
    on(event, handler) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
    getCommands: () => commands,
    registerMcpServer(name, config) {
      if (name === "taken") throw new Error(`MCP server "taken" is registered by /ext/other.ts`);
      registered.set(name, config);
      log.push(`register ${name}`);
    },
    unregisterMcpServer(name) {
      registered.delete(name);
      log.push(`unregister ${name}`);
    },
  };
  const config = { servers };
  const loads = [];
  const host = new McpHost({
    agentDir: "/agent",
    internals: {
      loadMcpConfig: (loadOptions) => {
        loads.push(loadOptions);
        return { servers: config.servers, errors: [] };
      },
    },
    codemodeAvailable: () => codemodeAvailable,
    promptWaitMs: 5_000,
    idleMs: 0,
    ...options,
  });
  host.extension().factory(pi);
  const ctx = { cwd: "/project", isProjectTrusted: () => projectTrusted, isIdle: () => true };
  const emit = (event) => {
    for (const handler of handlers.get(event) ?? []) handler({ type: event }, ctx);
  };
  emit("session_start");
  const transports = new Map();
  const factory = host.wrapTransportFactory((serverEntry) => {
    if (serverEntry.config.command === "broken") throw new Error("env \"TOKEN\" references PI_WEB_PASSWORD");
    const transport = new FakeTransport();
    transports.set(serverEntry.name, transport);
    return transport;
  });
  /** What the MCP extension does for a registered server: open its transport. */
  const connect = (name) => factory({ name, config: registered.get(name), source: "<inline:pi-web-mcp-host>", scope: "extension" }, "/project", undefined);
  return { host, log, registered, config, loads, emit, ctx, transports, connect };
}

test("nothing is registered until a prompt, then only the servers that may connect", async () => {
  const { host, log, registered } = setup({
    servers: [
      entry("docs", { url: "https://docs.example/mcp" }),
      entry("off", { command: "srv", enabled: false }),
      entry("repo", { command: "repo-srv" }, "project"),
      entry("taken", { command: "srv" }),
    ],
    // Nothing connects here, so the prompt would wait the whole time.
    promptWaitMs: 10,
  });
  assert.deepEqual(log, []);

  await host.prepareForPrompt(new AbortController().signal);
  assert.deepEqual(log, ["register docs", "register repo"]);
  assert.deepEqual([...registered.keys()], ["docs", "repo"]);
  assert.deepEqual(host.serverStates(), [
    { name: "docs", scope: "global", state: "connecting" },
    { name: "repo", scope: "project", state: "connecting" },
    { name: "taken", scope: "global", state: "not-registered", error: "MCP server \"taken\" is registered by /ext/other.ts" },
  ]);
});

test("project entries follow the project's trust, which the SDK applies when it reads mcp.json", async () => {
  const trusted = setup({ promptWaitMs: 10 });
  await trusted.host.prepareForPrompt(new AbortController().signal);
  assert.deepEqual(trusted.loads, [{ agentDir: "/agent", cwd: "/project", projectTrusted: true }]);

  const untrusted = setup({ projectTrusted: false, promptWaitMs: 10 });
  await untrusted.host.prepareForPrompt(new AbortController().signal);
  assert.deepEqual(untrusted.loads, [{ agentDir: "/agent", cwd: "/project", projectTrusted: false }]);
});

test("a prompt waits for servers still connecting, until they are ready", async () => {
  const { host, connect, transports } = setup({ servers: [entry("docs", { command: "docs-srv" })] });
  let prepared = false;
  const preparing = host.prepareForPrompt(new AbortController().signal).then(() => {
    prepared = true;
  });
  await delay(10);
  connect("docs");
  await delay(10);
  assert.equal(prepared, false);
  await transports.get("docs").handshake({});
  await preparing;
  assert.deepEqual(host.serverStates(), [{ name: "docs", scope: "global", state: "ready" }]);
});

test("Stop ends the wait at once", async () => {
  const { host, connect } = setup({ servers: [entry("slow", { command: "slow-srv" })] });
  const controller = new AbortController();
  const started = Date.now();
  const preparing = host.prepareForPrompt(controller.signal);
  await delay(10);
  connect("slow");
  controller.abort();
  await preparing;
  assert.ok(Date.now() - started < 1_000);
});

test("a server that outlasted one wait does not hold up the next prompt", async () => {
  const { host, connect } = setup({ servers: [entry("slow", { command: "slow-srv" })], promptWaitMs: 40 });
  const first = host.prepareForPrompt(new AbortController().signal);
  await delay(5);
  connect("slow");
  const firstStarted = Date.now();
  await first;
  assert.ok(Date.now() - firstStarted >= 25);
  const secondStarted = Date.now();
  await host.prepareForPrompt(new AbortController().signal);
  assert.ok(Date.now() - secondStarted < 25);
});

test("a server whose transport cannot be built fails without a wait", async () => {
  const { host, connect } = setup({ servers: [entry("leaky", { command: "broken" })] });
  const preparing = host.prepareForPrompt(new AbortController().signal);
  await delay(5);
  assert.throws(() => connect("leaky"), /PI_WEB_PASSWORD/);
  await preparing;
  assert.deepEqual(host.serverStates(), [{
    name: "leaky",
    scope: "global",
    state: "failed",
    error: "env \"TOKEN\" references PI_WEB_PASSWORD",
  }]);
});

test("a changed entry is replaced only once the extension has opened its connection", async () => {
  const { host, log, config, connect, transports } = setup({ servers: [entry("docs", { command: "v1" })] });
  // Registered, but the extension has not opened a connection yet.
  void host.prepareForPrompt(new AbortController().signal);
  await delay(5);
  config.servers = [entry("docs", { command: "v2" })];
  const second = host.prepareForPrompt(new AbortController().signal);
  await delay(30);
  // Unregistering now would leave the extension nothing to close; it would connect v1 anyway.
  assert.deepEqual(log, ["register docs"]);
  connect("docs");
  await transports.get("docs").handshake({});
  await delay(5);
  assert.deepEqual(log, ["register docs", "unregister docs", "register docs"]);
  connect("docs");
  await transports.get("docs").handshake({});
  await second;

  config.servers = [];
  await host.prepareForPrompt(new AbortController().signal);
  assert.deepEqual(log, ["register docs", "unregister docs", "register docs", "unregister docs"]);
  assert.deepEqual(host.serverStates(), []);
});

test("an unchanged entry is left connected, however its file orders the keys", async () => {
  const { host, log, config, connect, transports } = setup({ servers: [entry("docs", { command: "srv", args: ["-v"] })] });
  const first = host.prepareForPrompt(new AbortController().signal);
  await delay(5);
  connect("docs");
  await transports.get("docs").handshake({});
  await first;
  config.servers = [entry("docs", { args: ["-v"], command: "srv" })];
  await host.prepareForPrompt(new AbortController().signal);
  assert.deepEqual(log, ["register docs"]);
});

test("servers are registered with the exposure codemode can serve", async () => {
  const { host, registered } = setup({ servers: [entry("docs", { command: "srv" })], codemodeAvailable: false });
  void host.prepareForPrompt(new AbortController().signal);
  await delay(5);
  assert.deepEqual(registered.get("docs"), { command: "srv", exposure: "deferred" });
});

test("the host stays out of the way when another extension owns /mcp", async () => {
  const { host, log } = setup({
    servers: [entry("docs", { command: "srv" })],
    commands: [{ name: "mcp", sourceInfo: { path: "/ext/other-mcp.ts" } }],
  });
  await host.prepareForPrompt(new AbortController().signal);
  assert.deepEqual(log, []);
});

test("an idle host unregisters its servers, but not while a run is going", async () => {
  const { host, log, emit, ctx, connect, transports } = setup({ servers: [entry("docs", { command: "srv" })], idleMs: 20 });
  const preparing = host.prepareForPrompt(new AbortController().signal);
  await delay(5);
  connect("docs");
  await transports.get("docs").handshake({});
  await preparing;
  emit("agent_start");
  await delay(50);
  assert.deepEqual(log, ["register docs"], "a run keeps its servers");

  let idle = false;
  ctx.isIdle = () => idle;
  emit("agent_end");
  await delay(50);
  assert.deepEqual(log, ["register docs"], "a run pi still reports busy keeps its servers");

  idle = true;
  emit("agent_end");
  emit("agent_start");
  await delay(50);
  assert.deepEqual(log, ["register docs"], "a new run cancels the idle timer");

  emit("agent_end");
  await delay(50);
  assert.deepEqual(log, ["register docs", "unregister docs"]);
  // The next prompt connects them again.
  void host.prepareForPrompt(new AbortController().signal);
  await delay(5);
  assert.deepEqual(log, ["register docs", "unregister docs", "register docs"]);
});

test("servers registered for a prompt that starts no run still idle out", async () => {
  // Stop during the wait, a slash command, a rejected preflight: no agent_end follows.
  const { host, log, connect, transports } = setup({ servers: [entry("docs", { command: "srv" })], idleMs: 20 });
  const preparing = host.prepareForPrompt(new AbortController().signal);
  await delay(5);
  connect("docs");
  await transports.get("docs").handshake({});
  await preparing;
  await delay(50);
  assert.deepEqual(log, ["register docs", "unregister docs"]);
});

test("a sync that finishes after Stop gave up on it still lets its servers idle out", async () => {
  const { host, log, config, connect, transports } = setup({ servers: [entry("docs", { command: "v1" })], idleMs: 20 });
  // v1 is registered, but the extension has not opened its connection yet...
  void host.prepareForPrompt(new AbortController().signal);
  await delay(5);
  // ...so replacing it waits, and Stop ends the prompt while the sync is still queued.
  config.servers = [entry("docs", { command: "v2" })];
  const controller = new AbortController();
  const stopped = host.prepareForPrompt(controller.signal);
  await delay(5);
  controller.abort();
  await stopped;
  assert.deepEqual(log, ["register docs"]);

  connect("docs");
  await transports.get("docs").handshake({});
  await delay(5);
  assert.deepEqual(log, ["register docs", "unregister docs", "register docs"]);
  // The extension opens v2's connection in turn; the idle timer then releases it.
  connect("docs");
  await transports.get("docs").handshake({});
  await delay(50);
  assert.deepEqual(log, ["register docs", "unregister docs", "register docs", "unregister docs"]);
});

test("the idle timer does not run while a prompt waits for its servers", async () => {
  const { host, log, connect, transports } = setup({ servers: [entry("docs", { command: "srv" })], idleMs: 20 });
  let prepared = false;
  const preparing = host.prepareForPrompt(new AbortController().signal).then(() => {
    prepared = true;
  });
  await delay(5);
  connect("docs");
  await delay(60);
  assert.equal(prepared, false);
  assert.deepEqual(log, ["register docs"]);
  await transports.get("docs").handshake({});
  await preparing;
  await delay(50);
  assert.deepEqual(log, ["register docs", "unregister docs"]);
});
