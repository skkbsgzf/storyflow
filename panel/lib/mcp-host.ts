import type {
  ExtensionAPI,
  ExtensionContext,
  InlineExtension,
  McpExposure,
  McpServerConfig,
  McpServerEntry,
  McpTransportFactory,
} from "@earendil-works/pi-coding-agent";
import type { PiSdkInternals } from "./pi-sdk-internals";

// Pi Web decides which MCP servers a session connects (ADR 0006). The SDK's
// MCP extension is created with a `loadConfig` that returns no servers; this
// host reads `mcp.json` itself and hands the servers it wants to the extension
// through `pi.registerMcpServer()`:
//
// - Nothing connects until a session prompts. Browsing, switching sessions,
//   auto-naming and forking build wrappers that never prompt.
// - Before every prompt the wrapper asks the host to sync. Servers whose entry
//   changed are unregistered and registered again, so a change made anywhere
//   (the panel, `pi mcp add`, an editor, `git pull`) reaches every open session
//   on its next message without a reload. The prompt then waits up to 10 s for
//   servers still connecting, and Stop ends that wait.
// - A host that has not prompted for PI_WEB_MCP_IDLE_MS unregisters its servers.
//
// The extension does not report connection state, so the host watches the
// transports it creates through the factory pi-web gives it. A transport exists
// only once the extension has assigned the server's connection, which is what
// makes unregistering safe: before that, the extension's removal finds no
// connection to close, then connects the server anyway and loses it.

export const MCP_HOST_EXTENSION_NAME = "pi-web-mcp-host";

const DEFAULT_MCP_IDLE_MS = 10 * 60 * 1000;
const PROMPT_WAIT_MS = 10_000;
/** How long an unregister waits for the extension to start a connection it can close. */
const REPLACE_WAIT_MS = 5_000;
const MCP_EXTENSION_PATH = "builtin:mcp";
const LIST_METHODS = new Set(["tools/list", "resources/list", "resources/templates/list"]);

/**
 * PI_WEB_MCP_IDLE_MS: how long a session's MCP servers stay connected after its
 * last run. Unset or blank is 10 minutes, `0` keeps them until the session
 * closes, and invalid values fall back to the default with a warning.
 */
export function resolveMcpIdleMs(rawValue: string | undefined = process.env.PI_WEB_MCP_IDLE_MS): number {
  if (rawValue !== undefined && rawValue.trim() !== "") {
    const parsed = Number(rawValue);
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 2_147_483_647) return parsed;
    console.warn(`[pi-web] invalid PI_WEB_MCP_IDLE_MS "${rawValue}", falling back to 10 minutes`);
  }
  return DEFAULT_MCP_IDLE_MS;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** JSON with sorted keys, so an entry compares equal however its file orders it. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

const SCRIPT_EXPOSURES = new Set<McpExposure>(["codemode", "codemode-deferred"]);

/**
 * Without a working codemode sandbox, tools only scripts can reach would be
 * unreachable; `deferred` offers them through `tool_search` instead.
 */
export function withReachableExposure(config: McpServerConfig, codemodeAvailable: boolean): McpServerConfig {
  if (codemodeAvailable) return config;
  const exposure = config.exposure ?? "codemode";
  const toolExposure = config.toolExposure
    ? Object.fromEntries(Object.entries(config.toolExposure).map(([tool, value]) => [
        tool,
        SCRIPT_EXPOSURES.has(value) ? "deferred" as const : value,
      ]))
    : undefined;
  return {
    ...config,
    exposure: SCRIPT_EXPOSURES.has(exposure) ? "deferred" : exposure,
    ...(toolExposure ? { toolExposure } : {}),
  };
}

// ---------------------------------------------------------------------------
// Watching a connection through its transport
// ---------------------------------------------------------------------------

/** The part of pi-mcp's `McpTransport` the host observes. */
interface ObservedTransport {
  send(message: unknown): Promise<void>;
  onMessage(listener: (message: unknown) => void): () => void;
  onClose(listener: () => void): () => void;
}

/**
 * Report when a connection is ready, meaning the extension has registered its
 * tools, or when its transport closed first. The client sends `initialize`,
 * then `notifications/initialized`, then lists tools and resources when the
 * server's capabilities offer them, a page at a time; the extension registers
 * the tools in the same microtask chain that settles the last list. So once
 * every list request is answered and a macrotask passed without another one,
 * the tools are registered. Listening adds a listener and an own `send` on the
 * instance; the transport keeps its class, which the SDK checks.
 */
export function watchConnection(transport: ObservedTransport, done: (outcome: "ready" | "closed") => void): void {
  let finished = false;
  let initialized = false;
  let expectsLists: boolean | undefined;
  let listsSent = 0;
  const pending = new Set<unknown>();
  const finish = (outcome: "ready" | "closed") => {
    if (finished) return;
    finished = true;
    done(outcome);
  };
  const check = () => {
    setImmediate(() => {
      if (finished || !initialized || expectsLists === undefined || pending.size > 0) return;
      if (expectsLists && listsSent === 0) return;
      finish("ready");
    });
  };
  const send = transport.send.bind(transport);
  transport.send = (message: unknown) => {
    if (isRecord(message) && typeof message.method === "string") {
      if (message.id !== undefined && LIST_METHODS.has(message.method)) {
        pending.add(message.id);
        listsSent += 1;
      } else if (message.id === undefined && message.method === "notifications/initialized") {
        initialized = true;
        check();
      }
    }
    return send(message);
  };
  transport.onMessage((message) => {
    if (!isRecord(message) || message.method !== undefined || message.id === undefined) return;
    if (expectsLists === undefined && isRecord(message.result) && isRecord(message.result.capabilities)) {
      const { capabilities } = message.result;
      // As the SDK decides: tools when the capability is set, resources when it is present.
      expectsLists = Boolean(capabilities.tools) || capabilities.resources !== undefined;
      check();
      return;
    }
    if (pending.delete(message.id)) check();
  });
  transport.onClose(() => finish("closed"));
}

// ---------------------------------------------------------------------------
// The host
// ---------------------------------------------------------------------------

export type McpHostServerState =
  | "connecting"
  | "ready"
  | "failed"
  /** Another extension registered the name first, or the extension refused the config. */
  | "not-registered";

export interface McpHostServerStatus {
  name: string;
  scope: "global" | "project";
  state: McpHostServerState;
  error?: string;
}

class ConnectAttempt {
  /** Set once the extension created the server's transport, or the attempt ended. */
  started = false;
  settled = false;
  /** A prompt already waited for this attempt until the deadline; later prompts do not. */
  waited = false;
  state: "connecting" | "ready" | "failed" = "connecting";
  error: string | undefined;
  private readonly startedListeners = new Set<() => void>();
  private readonly settledListeners = new Set<() => void>();

  constructor(readonly configKey: string, readonly scope: "global" | "project") {}

  markStarted(): void {
    if (this.started) return;
    this.started = true;
    for (const listener of this.startedListeners) listener();
    this.startedListeners.clear();
  }

  settle(state: "ready" | "failed", error?: string): void {
    if (this.settled) return;
    this.settled = true;
    this.state = state;
    this.error = error;
    this.markStarted();
    for (const listener of this.settledListeners) listener();
    this.settledListeners.clear();
  }

  whenStarted(): Promise<void> {
    return this.started ? Promise.resolve() : new Promise((resolve) => this.startedListeners.add(resolve));
  }

  whenSettled(): Promise<void> {
    return this.settled ? Promise.resolve() : new Promise((resolve) => this.settledListeners.add(resolve));
  }
}

function delay(ms: number): { promise: Promise<void>; cancel: () => void } {
  let timer: NodeJS.Timeout | undefined;
  const promise = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
  return { promise, cancel: () => clearTimeout(timer) };
}

function aborted(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
}

/** One load of the host extension; a reload binds a new one. */
class HostInstance {
  private ctx: ExtensionContext | undefined;
  private active = false;
  private readonly attempts = new Map<string, ConnectAttempt>();
  private readonly problems = new Map<string, McpHostServerStatus>();
  private queue: Promise<void> = Promise.resolve();
  private idleTimer: NodeJS.Timeout | undefined;
  /** Between agent_start and agent_end; the idle timer never runs meanwhile. */
  private runActive = false;
  /** Prompts waiting in prepareForPrompt(); nor does it run while one waits. */
  private preparing = 0;

  constructor(private readonly pi: ExtensionAPI, private readonly options: Required<McpHostOptions>) {
    pi.on("session_start", (_event, ctx) => {
      this.ctx = ctx;
      // The built-in MCP extension may be switched off (-builtin:mcp) or replaced by one that
      // registers /mcp; such an extension would connect these servers its own way, so the
      // host hands it nothing.
      this.active = pi.getCommands().some((command) => command.name === "mcp" && command.sourceInfo?.path === MCP_EXTENSION_PATH);
    });
    pi.on("before_agent_start", () => {
      this.clearIdle();
      // Prompts that do not come through the wrapper, such as an extension's, still connect.
      void this.sync();
    });
    pi.on("agent_start", () => {
      this.runActive = true;
      this.clearIdle();
    });
    pi.on("agent_end", () => {
      this.runActive = false;
      this.armIdle();
    });
    pi.on("session_shutdown", () => {
      // The extension closes every connection itself.
      this.active = false;
      this.clearIdle();
    });
  }

  /** Called by the transport factory for every connection the extension opens. */
  attemptFor(entry: McpServerEntry): ConnectAttempt | undefined {
    const attempt = this.attempts.get(entry.name);
    return attempt && !attempt.settled && attempt.configKey === canonicalJson(entry.config) ? attempt : undefined;
  }

  sync(): Promise<void> {
    const synced = this.enqueue(async () => {
      if (!this.active || !this.ctx) return;
      const desired = this.desiredServers(this.ctx);
      for (const [name, attempt] of [...this.attempts]) {
        const wanted = desired.get(name);
        if (wanted && canonicalJson(wanted.config) === attempt.configKey) continue;
        await this.unregister(name);
      }
      for (const [name, wanted] of desired) {
        if (!this.attempts.has(name)) this.register(name, wanted.config, wanted.scope);
      }
    });
    // A prompt can register servers and then start no run: Stop during the wait, a
    // slash command, a preflight that rejects it. None reaches agent_end, so the idle
    // timer starts once the servers are registered, also when the sync finishes after
    // the prompt gave up on it. A run that does start stops the timer at agent_start.
    void synced.then(() => this.armIdle());
    return synced;
  }

  async prepareForPrompt(signal: AbortSignal): Promise<void> {
    this.clearIdle();
    // The wrapper prepares only prompts that start a run, so none is running now;
    // this also recovers from a run whose agent_end never arrived.
    this.runActive = false;
    this.preparing += 1;
    try {
      await this.waitForServers(signal);
    } finally {
      this.preparing -= 1;
      // Started now in case the prompt starts no run; agent_start stops it if one does.
      this.armIdle();
    }
  }

  private async waitForServers(signal: AbortSignal): Promise<void> {
    const stopped = aborted(signal);
    await Promise.race([this.sync(), stopped]);
    if (signal.aborted) return;
    const connecting = [...this.attempts.values()].filter((attempt) => !attempt.settled && !attempt.waited);
    if (connecting.length === 0) return;
    const deadline = delay(this.options.promptWaitMs);
    const timedOut = await Promise.race([
      Promise.all(connecting.map((attempt) => attempt.whenSettled())).then(() => false),
      deadline.promise.then(() => true),
      stopped.then(() => false),
    ]);
    deadline.cancel();
    // A server that outlasted one full wait is not waited for again; its tools arrive when it connects.
    if (timedOut) for (const attempt of connecting) attempt.waited = true;
  }

  serverStates(): McpHostServerStatus[] {
    const states: McpHostServerStatus[] = [...this.problems.values()];
    for (const [name, attempt] of this.attempts) {
      states.push({
        name,
        scope: attempt.scope,
        state: attempt.state,
        ...(attempt.error ? { error: attempt.error } : {}),
      });
    }
    return states.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Unregister everything, for idle and for a host whose session goes away. */
  release(): Promise<void> {
    return this.enqueue(async () => {
      for (const name of [...this.attempts.keys()]) await this.unregister(name);
    });
  }

  dispose(): void {
    this.active = false;
    this.clearIdle();
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const run = this.queue.then(operation);
    this.queue = run.catch((error: unknown) => {
      console.error("[pi-web] MCP host operation failed:", errorMessage(error));
    });
    return this.queue;
  }

  private desiredServers(ctx: ExtensionContext): Map<string, { config: McpServerConfig; scope: "global" | "project" }> {
    this.problems.clear();
    const desired = new Map<string, { config: McpServerConfig; scope: "global" | "project" }>();
    let loaded;
    try {
      // Project entries follow the project's trust, as in the pi CLI: the SDK reads
      // `.pi/mcp.json` only once the project is trusted (ADR 0006).
      loaded = this.options.internals.loadMcpConfig({
        agentDir: this.options.agentDir,
        cwd: ctx.cwd,
        projectTrusted: ctx.isProjectTrusted(),
      });
    } catch (error) {
      console.error("[pi-web] cannot read mcp.json:", errorMessage(error));
      return desired;
    }
    for (const entry of loaded.servers) {
      if (entry.config.enabled === false) continue;
      const scope = entry.scope === "project" ? "project" : "global";
      desired.set(entry.name, { config: withReachableExposure(entry.config, this.options.codemodeAvailable()), scope });
    }
    return desired;
  }

  private register(name: string, config: McpServerConfig, scope: "global" | "project"): void {
    const attempt = new ConnectAttempt(canonicalJson(config), scope);
    this.attempts.set(name, attempt);
    try {
      this.pi.registerMcpServer(name, config);
    } catch (error) {
      this.attempts.delete(name);
      this.problems.set(name, { name, scope: attempt.scope, state: "not-registered", error: errorMessage(error) });
    }
  }

  private async unregister(name: string): Promise<void> {
    const attempt = this.attempts.get(name);
    if (attempt && !attempt.started) {
      const deadline = delay(REPLACE_WAIT_MS);
      await Promise.race([attempt.whenStarted(), deadline.promise]);
      deadline.cancel();
    }
    this.attempts.delete(name);
    try {
      this.pi.unregisterMcpServer(name);
    } catch (error) {
      console.error(`[pi-web] cannot unregister MCP server "${name}":`, errorMessage(error));
    }
  }

  private clearIdle(): void {
    clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
  }

  private armIdle(): void {
    this.clearIdle();
    if (this.runActive || this.preparing > 0 || this.options.idleMs <= 0 || this.attempts.size === 0) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = undefined;
      if (this.ctx && !this.ctx.isIdle()) return;
      void this.release();
    }, this.options.idleMs);
    this.idleTimer.unref?.();
  }
}

export interface McpHostOptions {
  agentDir: string;
  internals: Pick<PiSdkInternals, "loadMcpConfig">;
  /** Whether codemode can run scripts; servers it cannot reach become `deferred`. */
  codemodeAvailable: () => boolean;
  idleMs?: number;
  promptWaitMs?: number;
}

/**
 * The MCP host of one session wrapper. Its extension is loaded beside the
 * SDK's MCP extension, and its transport factory wraps the one that extension
 * connects through.
 */
export class McpHost {
  private readonly options: Required<McpHostOptions>;
  private current: HostInstance | undefined;

  constructor(options: McpHostOptions) {
    this.options = {
      idleMs: resolveMcpIdleMs(),
      promptWaitMs: PROMPT_WAIT_MS,
      ...options,
    };
  }

  extension(): InlineExtension {
    return {
      name: MCP_HOST_EXTENSION_NAME,
      hidden: true,
      factory: (pi) => {
        this.current?.dispose();
        this.current = new HostInstance(pi, this.options);
      },
    };
  }

  wrapTransportFactory(factory: McpTransportFactory): McpTransportFactory {
    return (entry, cwd, authProvider) => {
      const attempt = this.current?.attemptFor(entry);
      let transport: ReturnType<McpTransportFactory>;
      try {
        transport = factory(entry, cwd, authProvider);
      } catch (error) {
        attempt?.settle("failed", errorMessage(error));
        throw error;
      }
      if (attempt) {
        attempt.markStarted();
        watchConnection(transport as unknown as ObservedTransport, (outcome) => {
          if (outcome === "ready") attempt.settle("ready");
          else attempt.settle("failed", "The connection closed before the server was ready");
        });
      }
      return transport;
    };
  }

  /** Sync the session's servers with `mcp.json`, then wait for the ones still connecting. */
  prepareForPrompt(signal: AbortSignal): Promise<void> {
    return this.current?.prepareForPrompt(signal) ?? Promise.resolve();
  }

  serverStates(): McpHostServerStatus[] {
    return this.current?.serverStates() ?? [];
  }

  /** Unregister every server now, as the idle timer does. */
  release(): Promise<void> {
    return this.current?.release() ?? Promise.resolve();
  }
}
