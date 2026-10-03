import {
  createCodemodeExtension,
  createMcpExtension,
  createToolSearchExtension,
  type ExtensionAPI,
  type ExtensionContext,
  type ExtensionFactory,
  type InlineExtension,
  type LoadedMcpConfig,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { McpHost, type McpHostOptions } from "./mcp-host";
import { createPiWebMcpTransportFactory } from "./mcp-transport";
import { loadPiSdkInternals, type PiSdkInternals, type PiSdkInternalsResult } from "./pi-sdk-internals";

// The built-in extensions the pi CLI prepends from a module the SDK does not
// export (ADR 0006, "Loading"). Normal sessions load them under the CLI's
// names, so `-builtin:<name>`, project overrides, `noExtensions`, and
// replacement by a third-party extension that registers `/mcp`, `codemode`, or
// `tool_search` behave as in the CLI. `llama.cpp` is not among them: it serves
// a local model server, not a feature of the session. Chat-only and subagent
// sessions load none of them.

export const MCP_DISABLE_VARIABLE = "PI_WEB_DISABLE_MCP";

export type BuiltinFeatureStatus = { available: true } | { available: false; reason: string };

/**
 * Whether the operator turned MCP off for the whole server. Any value other
 * than empty, `0`, or `false` counts: a switch that guards a server should not
 * be undone by spelling `yes` instead of `1`.
 */
export function isMcpDisabledByOperator(environment: NodeJS.ProcessEnv = process.env): boolean {
  const value = environment[MCP_DISABLE_VARIABLE]?.trim().toLowerCase();
  return value !== undefined && value !== "" && value !== "0" && value !== "false";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------------------
// Code mode sandbox self-test
// ---------------------------------------------------------------------------

const SELF_TEST_SCRIPT = "return 6 * 7";
const SELF_TEST_OUTPUT = "42";
const SELF_TEST_TIMEOUT_MS = 10_000;

export interface CodemodeSelfTestOptions {
  timeoutMs?: number;
  /** The codemode tool to run; tests replace it. Defaults to the SDK's. */
  createDefinition?: () => Promise<ToolDefinition>;
}

/**
 * The SDK's codemode tool definition, taken from its public extension factory.
 * Only `registerTool` is used while loading; the stubs cover what a script
 * without tool calls, store writes, or `models` reaches at run time.
 */
async function sdkCodemodeDefinition(): Promise<ToolDefinition> {
  let definition: ToolDefinition | undefined;
  const pi = {
    registerTool: (tool: ToolDefinition) => {
      definition = tool;
    },
    getSettings: () => ({}),
    getAllTools: () => [],
    appendEntry: () => {},
  } as unknown as ExtensionAPI;
  await createCodemodeExtension({ models: false })(pi);
  if (!definition) throw new Error("the codemode extension registered no tool");
  return definition;
}

function resultText(result: { content?: readonly { type: string; text?: string }[] }): string[] {
  return (result.content ?? []).flatMap((block) => (block.type === "text" && block.text !== undefined ? [block.text] : []));
}

/**
 * Run one script through the SDK's codemode tool, with the QuickJS sandbox in
 * its worker thread exactly as a session runs it. The worker and the wasm file
 * are resolved from the SDK's own files at run time, which a bundled or
 * relocated install can break; when that happens the tool would fail every
 * call, so pi-web does not offer it.
 */
export async function runCodemodeSelfTest(options: CodemodeSelfTestOptions = {}): Promise<BuiltinFeatureStatus> {
  const timeoutMs = options.timeoutMs ?? SELF_TEST_TIMEOUT_MS;
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`the sandbox did not answer within ${timeoutMs} ms`));
    }, timeoutMs);
    timer.unref?.();
  });
  try {
    const run = (async () => {
      const definition = await (options.createDefinition ?? sdkCodemodeDefinition)();
      // Without a session context the script reaches no tools, store, or models.
      return await definition.execute("pi-web-self-test", { code: SELF_TEST_SCRIPT }, controller.signal, undefined, undefined as never);
    })();
    // A run that settles after the timeout must not surface as an unhandled rejection.
    run.catch(() => {});
    const result = await Promise.race([run, timedOut]);
    const text = resultText(result);
    if ((result as { isError?: boolean }).isError) {
      return { available: false, reason: `the self-test script failed: ${text.join(" ").trim() || "no output"}` };
    }
    if (!text.some((line) => line.trim() === SELF_TEST_OUTPUT)) {
      return { available: false, reason: `the self-test script returned ${JSON.stringify(text.join(" ").trim())}` };
    }
    return { available: true };
  } catch (error) {
    return { available: false, reason: errorMessage(error) };
  } finally {
    clearTimeout(timer);
  }
}

// Hot reload re-evaluates this module; globalThis keeps one self-test per process.
const CODEMODE_SANDBOX_KEY: symbol = Symbol.for("pi-web.codemodeSandbox");

/** The sandbox self-test, run once per server process on the first normal session. */
export function checkCodemodeSandbox(): Promise<BuiltinFeatureStatus> {
  const store = globalThis as Record<symbol, Promise<BuiltinFeatureStatus> | undefined>;
  return store[CODEMODE_SANDBOX_KEY] ??= runCodemodeSelfTest().then((status) => {
    if (!status.available) console.warn(`[pi-web] Code mode is off: ${status.reason}`);
    return status;
  });
}

// ---------------------------------------------------------------------------
// MCP
// ---------------------------------------------------------------------------

export type McpRuntimeResult =
  | { available: true; internals: PiSdkInternals }
  | { available: false; reason: string };

export function mcpRuntimeFromInternals(
  internals: PiSdkInternalsResult,
  environment: NodeJS.ProcessEnv = process.env,
): McpRuntimeResult {
  if (isMcpDisabledByOperator(environment)) {
    return { available: false, reason: `${MCP_DISABLE_VARIABLE} is set` };
  }
  if (!internals.ok) return { available: false, reason: internals.reason };
  return { available: true, internals };
}

const MCP_WARNED_KEY: symbol = Symbol.for("pi-web.mcpOffWarned");

async function loadMcpRuntime(): Promise<McpRuntimeResult> {
  const runtime = mcpRuntimeFromInternals(await loadPiSdkInternals());
  const store = globalThis as Record<symbol, string | undefined>;
  // The operator's switch is deliberate and needs no warning; a failed adapter does.
  if (!runtime.available && !isMcpDisabledByOperator() && store[MCP_WARNED_KEY] !== runtime.reason) {
    store[MCP_WARNED_KEY] = runtime.reason;
    console.warn(`[pi-web] MCP is off: ${runtime.reason}`);
  }
  return runtime;
}

/**
 * `loadConfig` for the SDK's MCP extension. Pi Web decides which servers a
 * session connects and registers them itself, so the extension connects none
 * on `session_start`, and its startup wait, which ignores Stop, never arms.
 * The file-level `autoEnableCodemode` still comes from `mcp.json`, as in the
 * CLI; reading it runs nothing.
 */
export function createMcpExtensionConfigLoader(
  internals: Pick<PiSdkInternals, "loadMcpConfig">,
  agentDir: string,
): (ctx: ExtensionContext) => LoadedMcpConfig {
  return (ctx) => {
    let autoEnableCodemode: boolean | undefined;
    try {
      autoEnableCodemode = internals.loadMcpConfig({
        agentDir,
        cwd: ctx.cwd,
        projectTrusted: ctx.isProjectTrusted(),
      }).autoEnableCodemode;
    } catch {
      // Unreadable files are reported where servers are managed, not on every session start.
    }
    return { servers: [], errors: [], ...(autoEnableCodemode === undefined ? {} : { autoEnableCodemode }) };
  };
}

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

/**
 * Registers nothing. A built-in that cannot run keeps its `builtin:<name>`
 * entry, so a setting that names it neither errors nor changes meaning.
 */
const unavailableExtension: ExtensionFactory = () => {};

function builtin(name: string, factory: ExtensionFactory): InlineExtension {
  return { name, factory, replaceable: true, builtin: true };
}

export interface PiWebBuiltinExtensionsOptions {
  agentDir: string;
  /** Timing overrides for tests. */
  mcpHost?: Pick<McpHostOptions, "idleMs" | "promptWaitMs">;
}

export interface PiWebBuiltinExtensions {
  /** For the resource loader's `extensionFactories`, in the CLI's order, then the MCP host. */
  extensions: InlineExtension[];
  /** Decides which MCP servers the session connects; undefined while MCP is off. */
  mcpHost: McpHost | undefined;
}

/** The built-in extensions of a normal session and the host that feeds the MCP one. */
export async function createPiWebBuiltinExtensions(
  options: PiWebBuiltinExtensionsOptions,
): Promise<PiWebBuiltinExtensions> {
  const [sandbox, mcp] = await Promise.all([checkCodemodeSandbox(), loadMcpRuntime()]);
  const mcpHost = mcp.available
    ? new McpHost({
        ...options.mcpHost,
        agentDir: options.agentDir,
        internals: mcp.internals,
        codemodeAvailable: () => sandbox.available,
      })
    : undefined;
  const extensions = [
    builtin("codemode", sandbox.available ? createCodemodeExtension() : unavailableExtension),
    builtin("tool-search", createToolSearchExtension()),
    builtin(
      "mcp",
      mcp.available && mcpHost
        ? createMcpExtension({
            loadConfig: createMcpExtensionConfigLoader(mcp.internals, options.agentDir),
            createTransport: mcpHost.wrapTransportFactory(createPiWebMcpTransportFactory(mcp.internals)),
            // `/mcp login` already shows the address in the chat; a browser
            // opened on the server host is one a remote user never sees.
            openUrl: () => {},
          })
        : unavailableExtension,
    ),
  ];
  if (mcpHost) extensions.push(mcpHost.extension());
  return { extensions, mcpHost };
}
