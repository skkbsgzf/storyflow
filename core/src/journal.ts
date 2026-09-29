import path from "node:path";
import type { JournalEvent, JournalEventKind } from "./types.js";
import { appendJsonl, readJsonl } from "./fsio.js";
import { assertSchema } from "./schema.js";
import { journalPath } from "./state.js";
import { nowIso } from "./ids.js";

export function journalAppend(
  projectDir: string,
  runId: string,
  event: JournalEventKind,
  opts: { nodeId?: string; detail?: string; refs?: string[]; actor?: string } = {},
): JournalEvent {
  const e: JournalEvent = {
    ts: nowIso(),
    runId,
    event,
    actor: opts.actor ?? "kernel",
    ...(opts.nodeId ? { nodeId: opts.nodeId } : {}),
    ...(opts.detail ? { detail: opts.detail } : {}),
    ...(opts.refs ? { refs: opts.refs } : {}),
  };
  assertSchema("journal-event", e);
  appendJsonl(journalPath(projectDir), e);
  return e;
}

export interface JournalQuery {
  since?: string;
  limit?: number;
  node?: string;
  event?: JournalEventKind;
}

export function journalQuery(projectDir: string, q: JournalQuery = {}): JournalEvent[] {
  let events = readJsonl<JournalEvent>(journalPath(projectDir));
  if (q.since) events = events.filter((e) => e.ts >= q.since!);
  if (q.node) events = events.filter((e) => e.nodeId === q.node);
  if (q.event) events = events.filter((e) => e.event === q.event);
  const limit = q.limit ?? 200;
  return events.slice(-limit);
}
