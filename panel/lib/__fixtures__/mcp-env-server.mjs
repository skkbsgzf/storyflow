// A minimal MCP server for tests: newline-delimited JSON-RPC over stdio with
// `initialize`, `tools/list` and `tools/call`. Its tools report what the server
// process sees, so tests can check the environment pi-web starts it with.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

// A server that cannot start: it says why on stderr and exits before answering.
if (process.env.PI_WEB_FIXTURE_FAIL) {
  process.stderr.write(`${process.env.PI_WEB_FIXTURE_FAIL}\n`);
  process.exit(1);
}

const TOOLS = [
  {
    name: "env_has",
    description: "Whether the server's environment defines a variable.",
    inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
    annotations: { readOnlyHint: true },
  },
  {
    name: "env_get",
    description: "The value of a variable in the server's environment, or null.",
    inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
    annotations: { readOnlyHint: true },
  },
  {
    name: "spawn_child",
    description: "Start a long-running child process and return its pid.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    // No annotations: a tool its server does not mark read-only, without side effects.
    name: "record",
    description: "Return the note it was given.",
    inputSchema: { type: "object", properties: { note: { type: "string" } } },
  },
];

function send(message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
}

function toolResult(structuredContent) {
  return { content: [{ type: "text", text: JSON.stringify(structuredContent) }], structuredContent };
}

function callTool(name, args = {}) {
  switch (name) {
    case "env_has":
      return toolResult({ has: Object.hasOwn(process.env, args.name) });
    case "env_get":
      return toolResult({ value: process.env[args.name] ?? null });
    case "record":
      return toolResult({ recorded: args.note ?? null });
    case "spawn_child": {
      const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
      child.unref();
      return toolResult({ pid: child.pid });
    }
    default:
      return undefined;
  }
}

function answer(method, params) {
  switch (method) {
    case "initialize":
      return {
        protocolVersion: params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "pi-web-env-fixture", version: "1.0.0" },
      };
    case "ping":
      return {};
    case "tools/list":
      return { tools: TOOLS };
    case "tools/call":
      return callTool(params.name, params.arguments);
    default:
      return undefined;
  }
}

function handle({ id, method, params = {} }) {
  if (id === undefined) return; // notifications need no answer
  const result = answer(method, params);
  if (result) send({ id, result });
  else send({ id, error: { code: -32601, message: `Method not found: ${method}` } });
}

const input = createInterface({ input: process.stdin });
input.on("line", (line) => {
  if (line.trim()) handle(JSON.parse(line));
});
// MCP stdio shutdown: the client closes stdin and the server exits.
input.on("close", () => process.exit(0));
