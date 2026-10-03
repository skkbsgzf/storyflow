import {
  defaultToolEntries,
  getGlobalSettingsPath,
  readGlobalSettings,
  updateGlobalSettings,
} from "./global-settings-file";
import { resolveDefaultToolEntries } from "./powershell-settings";

// Code mode offers one choice (ADR 0006, "Code mode"):
// - "automatic" writes nothing: `codemode` registers inactive, and the MCP
//   extension activates it when a server with `codemode` exposure connects.
// - "always" adds `+codemode` to the global `defaultTools`, so every new
//   session starts with it active.
// There is no "never": MCP tools with `codemode` exposure cannot be called
// without it. `codemode.mode`, `codemode.inlineBudget`, and
// `autoEnableCodemode` stay file-only.

export const CODEMODE_PREFERENCES = ["automatic", "always"] as const;
export type CodemodePreference = typeof CODEMODE_PREFERENCES[number];

const CODEMODE = "codemode";

export function isCodemodePreference(value: unknown): value is CodemodePreference {
  return typeof value === "string" && (CODEMODE_PREFERENCES as readonly string[]).includes(value);
}

function isToolModifier(entry: string): boolean {
  return entry.startsWith("+") || entry.startsWith("-");
}

function namesCodemode(entry: string): boolean {
  return (isToolModifier(entry) ? entry.slice(1) : entry) === CODEMODE;
}

/** "always" when the resolved `defaultTools` list starts sessions with `codemode` active. */
export function codemodePreferenceOf(entries: readonly string[] | undefined): CodemodePreference {
  return entries !== undefined && resolveDefaultToolEntries(entries).includes(CODEMODE) ? "always" : "automatic";
}

/**
 * The `defaultTools` entries for `preference`, edited minimally: every entry
 * naming `codemode` is dropped, and "always" appends `+codemode`, which adds it
 * to a plain list and to pi's defaults alike. Undefined means "remove the key":
 * a list that held only modifiers and ends up empty would otherwise read as
 * "no tools at all" instead of pi's defaults.
 */
export function withCodemodePreference(
  entries: readonly string[] | undefined,
  preference: CodemodePreference,
): string[] | undefined {
  const kept = (entries ?? []).filter((entry) => !namesCodemode(entry));
  if (preference === "always") return [...kept, `+${CODEMODE}`];
  if (kept.length > 0) return kept;
  return entries !== undefined && entries.some((entry) => !isToolModifier(entry)) ? [] : undefined;
}

export async function readCodemodePreference(settingsPath = getGlobalSettingsPath()): Promise<CodemodePreference> {
  return readGlobalSettings(settingsPath, (settings) => codemodePreferenceOf(defaultToolEntries(settings)));
}

/** Writes the global settings only when the preference changes them. */
export async function writeCodemodePreference(
  preference: CodemodePreference,
  settingsPath = getGlobalSettingsPath(),
): Promise<CodemodePreference> {
  if (await readCodemodePreference(settingsPath) === preference) return preference;
  return updateGlobalSettings(settingsPath, (settings) => {
    const next = withCodemodePreference(defaultToolEntries(settings), preference);
    if (next === undefined) delete settings.defaultTools;
    else settings.defaultTools = next;
    return codemodePreferenceOf(next);
  });
}
