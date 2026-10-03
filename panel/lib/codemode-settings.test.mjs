import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { moduleCache: false });
const {
  codemodePreferenceOf,
  readCodemodePreference,
  withCodemodePreference,
  writeCodemodePreference,
} = await jiti.import("./codemode-settings.ts");
const { writePowerShellToolEnabled } = await jiti.import("./powershell-settings.ts");

test("Code mode is always on only when the resolved defaultTools list holds codemode", () => {
  assert.equal(codemodePreferenceOf(undefined), "automatic");
  assert.equal(codemodePreferenceOf([]), "automatic");
  assert.equal(codemodePreferenceOf(["+codemode"]), "always");
  assert.equal(codemodePreferenceOf(["read", "codemode"]), "always");
  assert.equal(codemodePreferenceOf(["+codemode", "-codemode"]), "automatic");
  assert.equal(codemodePreferenceOf(["read", "+grep"]), "automatic");
});

test("switching Code mode edits only the entries that name codemode", () => {
  // Unset: a modifier keeps pi's defaults instead of freezing today's list.
  assert.deepEqual(withCodemodePreference(undefined, "always"), ["+codemode"]);
  assert.deepEqual(withCodemodePreference(["+grep", "-write"], "always"), ["+grep", "-write", "+codemode"]);
  assert.deepEqual(withCodemodePreference(["read", "bash"], "always"), ["read", "bash", "+codemode"]);
  assert.deepEqual(withCodemodePreference(["read", "codemode", "-codemode"], "always"), ["read", "+codemode"]);

  assert.deepEqual(withCodemodePreference(["read", "codemode", "bash"], "automatic"), ["read", "bash"]);
  assert.deepEqual(withCodemodePreference(["+grep", "+codemode"], "automatic"), ["+grep"]);
  // An empty list means no tools at all, so a list of only modifiers is removed instead.
  assert.equal(withCodemodePreference(["+codemode"], "automatic"), undefined);
  assert.equal(withCodemodePreference(undefined, "automatic"), undefined);
  // A plain list that selected only codemode keeps meaning "these tools": now none.
  assert.deepEqual(withCodemodePreference(["codemode"], "automatic"), []);
});

test("writing Code mode keeps other settings and leaves an unchanged file alone", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-codemode-settings-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const settingsPath = join(dir, "settings.json");

  assert.equal(await readCodemodePreference(settingsPath), "automatic");
  await assert.rejects(stat(settingsPath), { code: "ENOENT" }, "reading does not create the file");

  await writeFile(settingsPath, JSON.stringify({ defaultModel: "m", defaultTools: ["+grep"] }));
  assert.equal(await writeCodemodePreference("always", settingsPath), "always");
  assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), {
    defaultModel: "m",
    defaultTools: ["+grep", "+codemode"],
  });
  assert.equal((await stat(settingsPath)).mode & 0o777, 0o600);

  const before = await readFile(settingsPath, "utf8");
  await writeFile(settingsPath, before.replace(/\n\s*/g, ""));
  const compact = await readFile(settingsPath, "utf8");
  assert.equal(await writeCodemodePreference("always", settingsPath), "always");
  assert.equal(await readFile(settingsPath, "utf8"), compact, "an unchanged preference is not rewritten");

  assert.equal(await writeCodemodePreference("automatic", settingsPath), "automatic");
  assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), { defaultModel: "m", defaultTools: ["+grep"] });

  await writeFile(settingsPath, JSON.stringify({ defaultTools: ["+codemode"] }));
  await writeCodemodePreference("automatic", settingsPath);
  assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), {});
});

test("Code mode survives the PowerShell switch, which rewrites the list as plain names", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-codemode-powershell-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const settingsPath = join(dir, "settings.json");

  await writeCodemodePreference("always", settingsPath);
  await writePowerShellToolEnabled(true, settingsPath, "win32");
  assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")).defaultTools, ["read", "powershell", "edit", "write", "codemode"]);
  assert.equal(await readCodemodePreference(settingsPath), "always");

  await writeCodemodePreference("automatic", settingsPath);
  assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")).defaultTools, ["read", "powershell", "edit", "write"]);
});

test("an unreadable settings file is reported, not overwritten", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-codemode-invalid-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const settingsPath = join(dir, "settings.json");
  await writeFile(settingsPath, "{ not json");
  await assert.rejects(writeCodemodePreference("always", settingsPath), SyntaxError);
  assert.equal(await readFile(settingsPath, "utf8"), "{ not json");
  await writeFile(settingsPath, JSON.stringify({ defaultTools: "codemode" }));
  await assert.rejects(readCodemodePreference(settingsPath), /defaultTools must be an array of strings/);
});
