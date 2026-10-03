import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const {
  createMcpExtensionConfigLoader,
  isMcpDisabledByOperator,
  mcpRuntimeFromInternals,
  runCodemodeSelfTest,
} = await jiti.import("./builtin-extensions.ts");
const { loadPiSdkInternals } = await jiti.import("./pi-sdk-internals.ts");

test("PI_WEB_DISABLE_MCP turns MCP off for any value but empty, 0, or false", () => {
  assert.equal(isMcpDisabledByOperator({}), false);
  for (const value of ["", " ", "0", "false", "FALSE"]) {
    assert.equal(isMcpDisabledByOperator({ PI_WEB_DISABLE_MCP: value }), false, JSON.stringify(value));
  }
  for (const value of ["1", "true", "yes", "on"]) {
    assert.equal(isMcpDisabledByOperator({ PI_WEB_DISABLE_MCP: value }), true, value);
  }
});

test("MCP is available only when the operator allows it and the internals loaded", () => {
  const internals = { ok: true, packageDir: "/sdk" };
  assert.deepEqual(mcpRuntimeFromInternals(internals, {}), { available: true, internals });
  assert.deepEqual(
    mcpRuntimeFromInternals(internals, { PI_WEB_DISABLE_MCP: "1" }),
    { available: false, reason: "PI_WEB_DISABLE_MCP is set" },
  );
  // The operator's switch is reported first: it is the one that would still apply after a fix.
  assert.deepEqual(
    mcpRuntimeFromInternals({ ok: false, reason: "moved" }, { PI_WEB_DISABLE_MCP: "1" }),
    { available: false, reason: "PI_WEB_DISABLE_MCP is set" },
  );
  assert.deepEqual(
    mcpRuntimeFromInternals({ ok: false, reason: "dist/extensions/mcp/runtime.js moved" }, {}),
    { available: false, reason: "dist/extensions/mcp/runtime.js moved" },
  );
});

test("the codemode self-test runs a script in the SDK's sandbox", async () => {
  assert.deepEqual(await runCodemodeSelfTest(), { available: true });
});

function definitionReturning(execute) {
  return async () => ({ name: "codemode", execute });
}

test("the codemode self-test reports a sandbox that fails, answers wrong, or hangs", async () => {
  assert.deepEqual(
    await runCodemodeSelfTest({
      createDefinition: async () => {
        throw new Error("Cannot find module quickjs.wasm");
      },
    }),
    { available: false, reason: "Cannot find module quickjs.wasm" },
  );

  assert.deepEqual(
    await runCodemodeSelfTest({
      createDefinition: definitionReturning(async () => ({
        content: [{ type: "text", text: "Script failed\n" }, { type: "text", text: "Script error:\nworker exited" }],
        isError: true,
      })),
    }),
    { available: false, reason: "the self-test script failed: Script failed\n Script error:\nworker exited" },
  );

  assert.deepEqual(
    await runCodemodeSelfTest({
      createDefinition: definitionReturning(async () => ({ content: [{ type: "text", text: "undefined" }] })),
    }),
    { available: false, reason: "the self-test script returned \"undefined\"" },
  );

  let signal;
  const hung = await runCodemodeSelfTest({
    timeoutMs: 20,
    createDefinition: definitionReturning((_id, _params, runSignal) => {
      signal = runSignal;
      return new Promise(() => {});
    }),
  });
  assert.deepEqual(hung, { available: false, reason: "the sandbox did not answer within 20 ms" });
  assert.equal(signal.aborted, true, "the script is aborted when the self-test gives up on it");
});

test("the MCP extension gets no servers from mcp.json but keeps autoEnableCodemode", async (t) => {
  const internals = await loadPiSdkInternals();
  assert.equal(internals.ok, true, internals.reason);
  const dir = await mkdtemp(join(tmpdir(), "pi-web-mcp-config-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const agentDir = join(dir, "agent");
  const project = join(dir, "project");
  await mkdir(agentDir, { recursive: true });
  await mkdir(join(project, ".pi"), { recursive: true });
  await writeFile(join(agentDir, "mcp.json"), JSON.stringify({
    autoEnableCodemode: false,
    mcpServers: { docs: { url: "https://example.com/mcp" } },
  }));
  await writeFile(join(project, ".pi", "mcp.json"), JSON.stringify({
    autoEnableCodemode: true,
    mcpServers: { local: { command: "never-started" } },
  }));

  const load = createMcpExtensionConfigLoader(internals, agentDir);
  const context = (trusted) => ({ cwd: project, isProjectTrusted: () => trusted });
  assert.deepEqual(load(context(false)), { servers: [], errors: [], autoEnableCodemode: false });
  // A trusted project's value overrides the global one, as in the CLI.
  assert.deepEqual(load(context(true)), { servers: [], errors: [], autoEnableCodemode: true });

  await writeFile(join(agentDir, "mcp.json"), "{ not json");
  await writeFile(join(project, ".pi", "mcp.json"), "{}");
  assert.deepEqual(load(context(true)), { servers: [], errors: [] });

  const throwing = createMcpExtensionConfigLoader({
    loadMcpConfig: () => {
      throw new Error("EACCES");
    },
  }, agentDir);
  assert.deepEqual(throwing(context(true)), { servers: [], errors: [] });
});
