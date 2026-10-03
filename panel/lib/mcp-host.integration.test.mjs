import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxProvider, fauxText } from "@earendil-works/pi-ai";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

// mcp.json, the MCP log, and the OAuth store all live in the agent directory.
const agentDir = await mkdtemp(join(tmpdir(), "pi-web-mcp-host-agent-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
test.after(() => rm(agentDir, { recursive: true, force: true }));

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const { AgentSessionWrapper, MCP_WAIT_STOPPED_MESSAGE } = await jiti.import("./rpc-manager.ts");
const { createPiWebBuiltinExtensions } = await jiti.import("./builtin-extensions.ts");

const FIXTURE = fileURLToPath(new URL("./__fixtures__/mcp-env-server.mjs", import.meta.url));

function writeMcpConfig(servers) {
  return writeFile(join(agentDir, "mcp.json"), JSON.stringify({ mcpServers: servers }));
}

function fixtureServer() {
  return { command: process.execPath, args: [FIXTURE], exposure: "direct" };
}

async function waitFor(condition, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("timed out");
    await delay(20);
  }
}

async function startSession(t, hostOptions) {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-mcp-host-cwd-"));
  const faux = fauxProvider({ models: [{ id: "faux-mcp-host" }] });
  const modelRuntime = await ModelRuntime.create({
    authPath: join(agentDir, "auth.json"),
    modelsPath: null,
    refreshOnCreate: false,
  });
  modelRuntime.registerNativeProvider(faux.provider);
  const settingsManager = SettingsManager.inMemory({});
  const { extensions, mcpHost } = await createPiWebBuiltinExtensions({ agentDir, mcpHost: hostOptions });
  assert.ok(mcpHost, "MCP is available");
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    extensionFactories: extensions,
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
    model: faux.getModel("faux-mcp-host"),
    sessionManager: SessionManager.inMemory(cwd),
    settingsManager,
    resourceLoader,
  });
  const wrapper = new AgentSessionWrapper(session, { mcpHost });
  t.after(async () => {
    wrapper.destroy();
    await rm(cwd, { recursive: true, force: true });
  });
  wrapper.beginExtensionBinding();
  await wrapper.waitUntilReady();
  return { session, wrapper, faux, mcpHost };
}

/** The tools a request declares: system messages add and remove them in order. */
function declaredTools(context) {
  const tools = new Set();
  for (const message of context.messages) {
    if (message.role !== "system") continue;
    for (const tool of message.toolsRemoved ?? []) tools.delete(tool.name);
    for (const tool of message.toolsAdded ?? []) tools.add(tool.name);
  }
  return [...tools];
}

/** Prompt through the wrapper, as the browser does, and report the tools the model was offered. */
async function promptAndSeeTools(wrapper, faux) {
  let offered;
  faux.setResponses([(context) => {
    offered = declaredTools(context);
    return fauxAssistantMessage([fauxText("ok")]);
  }]);
  await wrapper.send({ type: "prompt", message: "hello" });
  await waitFor(() => !wrapper.isRunning());
  return offered;
}

test("a prompt connects the configured servers before the model sees its request", async (t) => {
  await writeMcpConfig({ fixture: fixtureServer() });
  t.after(() => rm(join(agentDir, "mcp.json"), { force: true }));
  const { session, wrapper, faux, mcpHost } = await startSession(t);

  await delay(100);
  assert.ok(!session.getAllTools().some((tool) => tool.name.startsWith("mcp__")), "nothing connects before a prompt");
  assert.deepEqual(mcpHost.serverStates(), []);

  const offered = await promptAndSeeTools(wrapper, faux);
  assert.ok(offered.includes("mcp__fixture__env_has"), `offered: ${offered}`);
  assert.deepEqual(mcpHost.serverStates(), [{ name: "fixture", scope: "global", state: "ready" }]);

  // A change to mcp.json, made anywhere, reaches the session on its next prompt.
  await writeMcpConfig({ renamed: fixtureServer() });
  const afterRename = await promptAndSeeTools(wrapper, faux);
  assert.ok(afterRename.includes("mcp__renamed__env_has"), `offered: ${afterRename}`);
  assert.ok(!afterRename.includes("mcp__fixture__env_has"), `offered: ${afterRename}`);
});

test("Stop while servers connect withdraws the message unsent", async (t) => {
  // Starts, then never answers `initialize`; the client gives up after `timeout` seconds.
  await writeMcpConfig({
    silent: { command: process.execPath, args: ["-e", "process.stdin.resume()"], exposure: "direct", timeout: 2 },
  });
  t.after(() => rm(join(agentDir, "mcp.json"), { force: true }));
  const { session, wrapper, faux, mcpHost } = await startSession(t, { idleMs: 200 });
  faux.setResponses([() => fauxAssistantMessage([fauxText("should not run")])]);

  const started = Date.now();
  const prompting = wrapper.send({ type: "prompt", message: "hello" });
  await delay(300);
  assert.equal(wrapper.isRunning(), true, "the prompt is admitted while it waits");
  await wrapper.send({ type: "abort" });
  await assert.rejects(prompting, { message: MCP_WAIT_STOPPED_MESSAGE });
  assert.ok(Date.now() - started < 2_000, "Stop did not wait out the connection");
  assert.equal(wrapper.isRunning(), false);
  assert.equal(faux.state.callCount, 0);
  assert.deepEqual(session.messages.filter((message) => message.role === "user"), []);

  // No run started, so no agent_end will either; the server still idles out.
  assert.deepEqual(mcpHost.serverStates().map((server) => server.name), ["silent"]);
  await waitFor(() => mcpHost.serverStates().length === 0, 5_000);
});
