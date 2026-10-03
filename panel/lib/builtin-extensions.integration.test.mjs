import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { fauxProvider } from "@earendil-works/pi-ai";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

// The MCP extension keeps its log and OAuth store in the agent directory.
const agentDir = await mkdtemp(join(tmpdir(), "pi-web-builtins-agent-"));
process.env.PI_CODING_AGENT_DIR = agentDir;

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");
const { createPiWebBuiltinExtensions } = await jiti.import("./builtin-extensions.ts");

const FIXTURE = fileURLToPath(new URL("./__fixtures__/mcp-env-server.mjs", import.meta.url));

test.after(() => rm(agentDir, { recursive: true, force: true }));

async function startSession(t, { settings = {}, extensionFactories = [] } = {}) {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-builtins-cwd-"));
  const faux = fauxProvider({ models: [{ id: "faux-builtins" }] });
  const modelRuntime = await ModelRuntime.create({
    authPath: join(agentDir, "auth.json"),
    modelsPath: null,
    refreshOnCreate: false,
  });
  modelRuntime.registerNativeProvider(faux.provider);
  const settingsManager = SettingsManager.inMemory(settings);
  // Built-in extensions load as `builtin:<name>` resources, which `noExtensions` would disable.
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    extensionFactories: [...(await createPiWebBuiltinExtensions({ agentDir })).extensions, ...extensionFactories],
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  });
  await resourceLoader.reload();
  const { session } = await createAgentSession({
    cwd,
    agentDir,
    modelRuntime,
    model: faux.getModel("faux-builtins"),
    sessionManager: SessionManager.inMemory(cwd),
    settingsManager,
    resourceLoader,
  });
  const wrapper = new AgentSessionWrapper(session);
  wrapper.beginExtensionBinding();
  await wrapper.waitUntilReady();
  t.after(async () => {
    wrapper.destroy();
    await rm(cwd, { recursive: true, force: true });
  });
  return { session, faux };
}

function toolNames(session) {
  return session.getAllTools().map((tool) => tool.name);
}

function commandNames(session) {
  return session.extensionRunner.getRegisteredCommands().map((command) => command.name);
}

async function waitFor(condition, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("timed out");
    await delay(20);
  }
}

test("a normal session loads codemode and tool_search inactive and the MCP extension", async (t) => {
  const { session } = await startSession(t);
  const names = toolNames(session);
  assert.ok(names.includes("codemode"));
  assert.ok(names.includes("tool_search"));
  assert.ok(!session.getActiveToolNames().includes("codemode"));
  assert.ok(!session.getActiveToolNames().includes("tool_search"));
  assert.ok(commandNames(session).includes("mcp"));
});

test("defaultTools +codemode activates the built-in codemode tool", async (t) => {
  const { session } = await startSession(t, { settings: { defaultTools: ["+codemode"] } });
  assert.ok(session.getActiveToolNames().includes("codemode"));
});

test("-builtin:<name> in the extensions setting leaves that built-in out", async (t) => {
  const { session } = await startSession(t, { settings: { extensions: ["-builtin:mcp", "-builtin:codemode"] } });
  assert.ok(!toolNames(session).includes("codemode"));
  assert.ok(toolNames(session).includes("tool_search"));
  assert.ok(!commandNames(session).includes("mcp"));
});

test("servers in mcp.json are not connected when a session starts", async (t) => {
  // The MCP host connects them before a prompt (lib/mcp-host.integration.test.mjs);
  // the extension itself must not, or every browsed session would start them.
  const marker = join(agentDir, "spawned");
  const script = `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "")`;
  await writeFile(join(agentDir, "mcp.json"), JSON.stringify({
    mcpServers: { configured: { command: process.execPath, args: ["-e", script], exposure: "direct" } },
  }));
  t.after(() => rm(join(agentDir, "mcp.json"), { force: true }));

  const { session } = await startSession(t);
  await delay(200);
  assert.equal(existsSync(marker), false, "the configured server was started");
  assert.ok(!toolNames(session).some((name) => name.startsWith("mcp__")));
});

test("servers an extension registers connect through Pi Web's transport", async (t) => {
  // Unset, the reference would fail to resolve under any transport.
  const previousPassword = process.env.PI_WEB_PASSWORD;
  process.env.PI_WEB_PASSWORD = "web-password";
  t.after(() => {
    if (previousPassword === undefined) delete process.env.PI_WEB_PASSWORD;
    else process.env.PI_WEB_PASSWORD = previousPassword;
  });
  const registering = {
    name: "registers-servers",
    factory: (pi) => {
      pi.registerMcpServer("fixture", { command: process.execPath, args: [FIXTURE], exposure: "direct" });
      // The SDK's own transport would start this one; Pi Web's refuses it.
      pi.registerMcpServer("leaky", {
        command: process.execPath,
        args: [FIXTURE],
        env: { TOKEN: "${PI_WEB_PASSWORD}" },
        exposure: "direct",
      });
    },
  };
  const { session } = await startSession(t, { extensionFactories: [registering] });
  await waitFor(() => toolNames(session).includes("mcp__fixture__env_has"));
  assert.ok(session.getActiveToolNames().includes("mcp__fixture__env_has"));
  assert.ok(!toolNames(session).some((name) => name.startsWith("mcp__leaky__")));
});
