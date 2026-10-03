import type { McpServerConfig, McpTransportFactory } from "@earendil-works/pi-coding-agent";
import type { PiSdkInternals } from "./pi-sdk-internals";
import { sanitizeProjectCommandEnvironment } from "./project-command-env";

// MCP servers are started on behalf of a project like its bash commands, so
// they get the same environment: the server's own, without the variables that
// configure or guard this Next.js process (ADR 0006, "Safety → Environment").
// The SDK's default stdio transport passes the whole `process.env` instead.

const WEB_PASSWORD_VARIABLE = "PI_WEB_PASSWORD";

type TransportInternals = Pick<
  PiSdkInternals,
  "createDefaultTransport" | "StdioTransport" | "getConfigValueEnvVarNames" | "isCommandConfigValue"
>;
type ConfigValueInternals = Pick<PiSdkInternals, "getConfigValueEnvVarNames" | "isCommandConfigValue">;

export interface PiWebMcpTransportOptions {
  /** Environment stdio servers start from, before sanitizing. Defaults to `process.env` at connect time. */
  baseEnvironment?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}

/** The values pi resolves in this process before it connects: `${NAME}`, `$NAME`, `!command`. */
function resolvedConfigValues(config: McpServerConfig): [field: string, value: string][] {
  if (!("url" in config)) {
    return Object.entries(config.env ?? {}).map(([key, value]): [string, string] => [`env "${key}"`, value]);
  }
  const values = Object.entries(config.headers ?? {}).map(([key, value]): [string, string] => [`header "${key}"`, value]);
  if (config.oauth?.clientSecret !== undefined) values.push(["oauth.clientSecret", config.oauth.clientSecret]);
  return values;
}

/**
 * The field of `config` whose value references `PI_WEB_PASSWORD`, or
 * undefined. Values resolve against this process's environment, which still
 * holds the password, so removing it from the server's environment is not
 * enough. Names compare case-insensitively, as Windows resolves them. A
 * `!command` can read the variable without a `$` reference, so any mention
 * counts; the SDK still runs it with this process's whole environment.
 */
export function findWebPasswordReference(
  config: McpServerConfig,
  internals: ConfigValueInternals,
): string | undefined {
  for (const [field, value] of resolvedConfigValues(config)) {
    const references = internals.isCommandConfigValue(value)
      ? value.toUpperCase().includes(WEB_PASSWORD_VARIABLE)
      : internals.getConfigValueEnvVarNames(value).some((name) => name.toUpperCase() === WEB_PASSWORD_VARIABLE);
    if (references) return field;
  }
  return undefined;
}

/** The sanitized environment with the server's own `env` on top; a Windows name replaces any casing of itself. */
function serverEnvironment(
  baseEnvironment: NodeJS.ProcessEnv,
  configured: Record<string, string>,
  platform: NodeJS.Platform,
): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const [name, value] of Object.entries(sanitizeProjectCommandEnvironment(baseEnvironment, platform))) {
    if (value !== undefined) environment[name] = value;
  }
  for (const [name, value] of Object.entries(configured)) {
    if (platform === "win32") {
      for (const existing of Object.keys(environment)) {
        if (existing.toUpperCase() === name.toUpperCase()) delete environment[existing];
      }
    }
    environment[name] = value;
  }
  return environment;
}

/**
 * The transport factory pi-web gives the SDK's MCP connections. HTTP servers
 * use the SDK's transport unchanged. A stdio server gets the transport the
 * SDK would build, with every option it passes (command and args with `~`
 * expanded, cwd resolved against the session, piped stderr) and its `env`
 * values resolved by the SDK, but started with `inheritEnv: false` from the
 * sanitized environment. It never falls back to the SDK's stdio transport.
 */
export function createPiWebMcpTransportFactory(
  internals: TransportInternals,
  options: PiWebMcpTransportOptions = {},
): McpTransportFactory {
  const platform = options.platform ?? process.platform;
  return (entry, cwd, authProvider) => {
    const field = findWebPasswordReference(entry.config, internals);
    if (field) {
      throw new Error(`MCP server "${entry.name}" ${field} references ${WEB_PASSWORD_VARIABLE}, which Pi Web does not pass to MCP servers`);
    }
    const transport = internals.createDefaultTransport(entry, cwd, authProvider);
    if ("url" in entry.config) return transport;
    if (!(transport instanceof internals.StdioTransport)) {
      throw new Error(`MCP server "${entry.name}": the SDK did not create a stdio transport`);
    }
    const { env: configured = {}, ...stdioOptions } = transport.options;
    // `env` must hold only the entry's own values; anything else would be the
    // SDK passing environment that pi-web has not sanitized.
    const declared = new Set(Object.keys(entry.config.env ?? {}));
    const unexpected = Object.keys(configured).find((name) => !declared.has(name));
    if (unexpected !== undefined) {
      throw new Error(`MCP server "${entry.name}": the SDK set environment variable ${unexpected}, which its config does not declare`);
    }
    return new internals.StdioTransport({
      ...stdioOptions,
      env: serverEnvironment(options.baseEnvironment ?? process.env, configured, platform),
      inheritEnv: false,
    });
  };
}
