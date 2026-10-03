import { NextResponse } from "next/server";
import type { ToolSettingsResponse } from "@/lib/api-types";
import { isCodemodePreference, readCodemodePreference, writeCodemodePreference } from "@/lib/codemode-settings";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import {
  readPowerShellToolEnabled,
  writePowerShellToolEnabled,
} from "@/lib/powershell-settings";

export const dynamic = "force-dynamic";

// The only writer of the global `defaultTools` key: the PowerShell switch
// (Windows) and the Code mode choice (ADR 0006) both edit it, under the lock
// pi's SettingsManager takes on the same file.

function errorResponse(error: unknown, status = 500) {
  return NextResponse.json(
    { error: error instanceof Error ? error.message : String(error) },
    { status },
  );
}

async function readToolSettings(): Promise<ToolSettingsResponse> {
  // One after the other: both take the file lock, and a reader that finds it
  // held backs off for about a second.
  const powerShellEnabled = await readPowerShellToolEnabled();
  const codemode = await readCodemodePreference();
  return { isWindows: process.platform === "win32", powerShellEnabled, codemode };
}

export async function GET() {
  try {
    return NextResponse.json(await readToolSettings());
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: "Expected a JSON object" }, { status: 400 });
  }
  const changes = body as { enabled?: unknown; codemode?: unknown };
  if (("codemode" in changes) === ("enabled" in changes)) {
    return NextResponse.json({ error: "Send either enabled (PowerShell) or codemode" }, { status: 400 });
  }

  if ("codemode" in changes) {
    if (!isCodemodePreference(changes.codemode)) {
      return NextResponse.json({ error: "codemode must be \"automatic\" or \"always\"" }, { status: 400 });
    }
    try {
      await writeCodemodePreference(changes.codemode);
      return NextResponse.json(await readToolSettings());
    } catch (error) {
      return errorResponse(error);
    }
  }

  if (process.platform !== "win32") {
    return NextResponse.json({ error: "PowerShell tool settings are only available on Windows" }, { status: 404 });
  }
  if (typeof changes.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
  }
  try {
    await writePowerShellToolEnabled(changes.enabled);
    return NextResponse.json(await readToolSettings());
  } catch (error) {
    return errorResponse(error);
  }
}
