// HTTP/SSE 门面：任务级端点。Pinax 客户端经 fetch+ReadableStream 消费。
// 端点：POST /v1/pinax/tasks（开跑+SSE）、POST /v1/pinax/tasks/:id/resume（恢复+SSE）、
//       POST /v1/pinax/tasks/:id/cancel（取消）、GET /v1/pinax/tasks/:id（状态）、GET /healthz
import * as http from "node:http";
import { loadConfig } from "./config.js";
import { TaskStore, isValidTaskId, newTaskId, type TaskSnapshot } from "./store.js";
import { createRun, type RunHandle } from "./runner.js";
import { parseNarrativeAgentSseEvent, createNarrativeAgentStreamEvent, serializeNarrativeAgentSseEvent, NARRATIVE_TOOL_LIMITS, PINAX_TOOL_NAMES } from "./contract.js";
import type { TurnRequest } from "./prompt.js";

interface TaskExecution {
  run?: RunHandle;
  /** Resolves only after the terminal snapshot has been written. */
  settled?: Promise<TaskSnapshot>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isValidBookId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 120
    && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value);
}

function isTerminal(status: TaskSnapshot["status"]): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function json(res: http.ServerResponse, code: number, body: unknown) {
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
  });
  res.end(JSON.stringify(body));
}

function sseHead(res: http.ServerResponse) {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
    "access-control-allow-origin": "*",
  });
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks = [];
  let bytes = 0;
  for await (const c of req) { bytes += c.length; if (bytes > 2_000_000) throw new Error("request-too-large"); chunks.push(c); }
  return Buffer.concat(chunks).toString("utf-8");
}

function validate(reqBody: unknown): { ok: true; value: TurnRequest } | { ok: false; error: string } {
  const b = reqBody as TurnRequest;
  if (!isRecord(b)) return { ok: false, error: "请求体必须是 JSON 对象" };
  if (typeof b.requestId !== "string" || !b.requestId.trim() || /[\u0000-\u001f\u007f]/.test(b.requestId)) return { ok: false, error: "requestId 必须是非空字符串" };
  if (b.taskId !== undefined && !isValidTaskId(b.taskId)) return { ok: false, error: "taskId 必须是 1–80 字符的 ASCII 标识（list 为保留值）" };
  if (!["init", "continue", "auto", "respond"].includes(b.mode)) return { ok: false, error: "mode 必须是 init/continue/auto/respond" };
  if (!isRecord(b.kernel) || !Array.isArray(b.kernel.blocks) || b.kernel.blocks.some((block) => !isRecord(block))) return { ok: false, error: "kernel.blocks 必须是对象数组" };
  if (!isRecord(b.resources) || !isRecord(b.resources.domains)) return { ok: false, error: "resources.domains 必须是对象" };
  for (const [name, items] of Object.entries(b.resources.domains)) {
    if (![...PINAX_TOOL_NAMES, "manuscript", "notes", "outline"].includes(name) || !Array.isArray(items) || items.some((item) => !isRecord(item))) {
      return { ok: false, error: "resources.domains 仅接受已声明资料域的对象数组" };
    }
  }
  if (b.taskKind !== undefined && !["assistant", "narrative"].includes(b.taskKind)) return { ok: false, error: "invalid-task-kind" };
  if (b.maxTokens !== undefined && (!Number.isInteger(b.maxTokens) || b.maxTokens < 200 || b.maxTokens > 8000)) return { ok: false, error: "maxTokens 必须在 200–8000 之间" };
  if (b.bookId === null) delete b.bookId;
  if (b.bookId !== undefined && !isValidBookId(b.bookId)) return { ok: false, error: "bookId 必须是 1–120 字符的非空标识" };
  if (b.budget !== undefined) {
    if (!isRecord(b.budget) || Object.values(b.budget).some((value) => typeof value !== "number" || !Number.isFinite(value) || value <= 0)) {
      return { ok: false, error: "budget 必须包含有限正数" };
    }
    if (b.budget.agentTimeoutMs !== undefined && b.budget.agentTimeoutMs > 2_147_483_647) return { ok: false, error: "agentTimeoutMs 超出定时器范围" };
  }
  return { ok: true, value: b };
}

async function readTurn(req: http.IncomingMessage): Promise<ReturnType<typeof validate>> {
  const body = await readBody(req);
  let value: unknown;
  try { value = JSON.parse(body); } catch { return { ok: false, error: "请求体不是有效 JSON" }; }
  return validate(value);
}

export function startServer(overrides = {}) {
  const cfg = loadConfig(overrides);
  const store = new TaskStore(cfg.tasksDir);
  const active = new Map<string, TaskExecution>();

  async function execute(turn: TurnRequest, initial: TaskSnapshot, res: http.ServerResponse, resumeMessages?: unknown[]) {
    const taskId = initial.taskId;
    const owner: TaskExecution = {};
    // Callers check after reading the body. No await separates that check from this reservation.
    active.set(taskId, owner);
    try {
      store.append(initial);
      let run: RunHandle;
      try {
        run = createRun(turn, cfg, {
          revision: turn.resources.revision, currentPlaceId: turn.resources.currentPlaceId,
          domains: turn.resources.domains as never,
        }, { resumeMessages });
      } catch (e) {
        const message = String((e as Error)?.message || e).slice(0, 240);
        store.append({ ...initial, status: "failed", error: { code: "PINAX_ADAPTER_START_FAILED", message, retryable: false } });
        return json(res, 500, { ok: false, error: "task-start-failed", taskId, status: "failed", message });
      }
      owner.run = run;
      let off = () => {};
      owner.settled = run.done.then((final) => {
        // Task identity, book ownership and creation time belong to the original journal.
        const persisted = { ...final, taskId, bookId: initial.bookId, createdAt: initial.createdAt };
        store.append(persisted);
        return persisted;
      }).finally(() => {
        off();
        if (active.get(taskId) === owner) active.delete(taskId);
      });
      // A disconnected SSE client relinquishes only the writer, never the task owner.
      let clientGone = res.destroyed;
      res.on("error", () => { clientGone = true; });
      res.on("close", () => { clientGone = true; if (!res.writableEnded) run.abort("PINAX_ADAPTER_CLIENT_DISCONNECTED"); });
      if (!clientGone) sseHead(res);
      off = run.onFrame((frame) => {
        if (clientGone || res.destroyed || res.writableEnded) return;
        try { res.write(frame); } catch { clientGone = true; }
      });
      await owner.settled;
      if (!clientGone && !res.destroyed && !res.writableEnded) res.end();
    } finally {
      // Synchronous setup failure has no settled promise to release its reservation.
      if (!owner.settled && active.get(taskId) === owner) active.delete(taskId);
    }
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${cfg.host}`);
    const seg = url.pathname.split("/").filter(Boolean);

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,POST,OPTIONS",
        "access-control-allow-headers": "content-type",
      });
      return res.end();
    }
    if (url.pathname === "/healthz") return json(res, 200, { ok: true, service: "pinax-adapter", port: cfg.port, model: `${cfg.provider}.${cfg.model}` });

    try {
      // POST /v1/pinax/tasks
      if (req.method === "POST" && seg.join("/") === "v1/pinax/tasks") {
        const parsed = await readTurn(req);
        if (!parsed.ok) return json(res, 400, { error: parsed.error });
        const turn = parsed.value;
        const taskId = turn.taskId || newTaskId();
        if (active.has(taskId)) return json(res, 409, { ok: false, error: "task-already-running", taskId });
        if (store.has(taskId)) return json(res, 409, { ok: false, error: "task-already-exists", taskId });
        if (active.size >= 4) return json(res, 429, { ok: false, error: "adapter-busy" });
        turn.taskId = taskId;
        const snapshot: TaskSnapshot = {
          taskId, requestId: turn.requestId, status: "running", createdAt: Date.now(), updatedAt: Date.now(),
          mode: turn.mode, ...(turn.bookId ? { bookId: turn.bookId } : {}),
          steps: 0, toolCalls: 0, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          messages: [], finalText: "",
        };
        return await execute(turn, snapshot, res);
      }

      // POST /v1/pinax/tasks/:id/resume | /cancel, GET /v1/pinax/tasks/:id
      if (seg[0] === "v1" && seg[1] === "pinax" && seg[2] === "tasks" && seg[3] && (seg.length === 4 || seg.length === 5)) {
        const taskId = seg[3];
        const action = seg[4];
        if (req.method === "GET" && taskId === "list" && !action) {
          const bookId = url.searchParams.has("bookId") ? url.searchParams.get("bookId") : undefined;
          if (bookId !== undefined && !isValidBookId(bookId)) return json(res, 400, { error: "invalid-book-id" });
          return json(res, 200, { tasks: store.list(50, { bookId }) });
        }
        if (!isValidTaskId(taskId)) return json(res, 400, { error: "invalid-task-id" });
        if (req.method === "GET" && !action) {
          const snap = store.load(taskId);
          return snap ? json(res, 200, {
            ...snap, messages: undefined, finalTextChars: snap.finalText.length,
            executionActive: active.has(taskId), interrupted: snap.status === "running" && !active.has(taskId),
          })
            : json(res, 404, { error: "task-not-found" });
        }
        if (req.method === "POST" && action === "cancel") {
          const owner = active.get(taskId);
          if (owner?.run && owner.settled) {
            owner.run.abort("PINAX_ADAPTER_CANCELLED");
            const final = await owner.settled;
            return json(res, 200, { ok: true, stopped: true, cancelling: false, status: final.status, taskId });
          }
          const snap = store.load(taskId);
          if (!snap) return json(res, 404, { ok: false, stopped: false, error: "task-not-found", taskId });
          if (owner || !isTerminal(snap.status)) {
            return json(res, 409, { ok: false, stopped: false, error: "task-not-active", status: snap.status, taskId });
          }
          return json(res, 200, { ok: true, stopped: true, cancelling: false, status: snap.status, taskId });
        }
        if (req.method === "POST" && action === "resume") {
          // Read first: another request may acquire or finish the owner while the body arrives.
          const parsed = await readTurn(req);
          if (!parsed.ok) return json(res, 400, { error: parsed.error });
          if (parsed.value.taskId !== undefined && parsed.value.taskId !== taskId) return json(res, 400, { error: "task-id-mismatch" });
          if (active.has(taskId)) return json(res, 409, { ok: false, error: "task-already-running", taskId });
          const snap = store.load(taskId);
          if (!snap) return json(res, 404, { error: "task-not-found" });
          if (!snap.messages?.length) return json(res, 422, { error: "task-not-resumable", hint: "无转录快照" });
          if (snap.bookId && parsed.value.bookId !== undefined && parsed.value.bookId !== snap.bookId) {
            return json(res, 409, { error: "task-book-mismatch", taskId });
          }
          // Legacy unbound journals can still resume without bookId. They cannot be silently claimed.
          if (!snap.bookId && parsed.value.bookId !== undefined) return json(res, 422, { error: "task-book-unbound", taskId });
          if (active.size >= 4) return json(res, 429, { ok: false, error: "adapter-busy" });
          const turn = { ...parsed.value, taskId, bookId: snap.bookId };
          const snapshot: TaskSnapshot = {
            ...snap, requestId: turn.requestId, mode: turn.mode, status: "running", error: undefined,
            steps: 0, toolCalls: 0, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          };
          return await execute(turn, snapshot, res, snap.messages);
        }
      }

      // 契约自检：GET /v1/pinax/contract 回显一帧，供 Pinax 侧用 parseNarrativeAgentSseEvent 验证接线
      if (req.method === "GET" && url.pathname === "/v1/pinax/contract") {
        sseHead(res);
        const frame = serializeNarrativeAgentSseEvent(
          createNarrativeAgentStreamEvent("step.start", { stepIndex: 0, toolChoice: "auto" }, { requestId: "contract-probe", seq: 1, at: Date.now() }),
        );
        res.write(frame);
        // 自检用同一把 parser：解析不出自己发的帧 = 契约镜像件坏了
        if (!parseNarrativeAgentSseEvent(frame)) {
          res.write(serializeNarrativeAgentSseEvent(createNarrativeAgentStreamEvent("error", { code: "SELF_CHECK_FAILED", message: "本地契约件无法解析自身产物" }, { requestId: "contract-probe", seq: 2 })));
        }
        return res.end();
      }

      return json(res, 404, { error: "not-found", endpoints: ["/v1/pinax/tasks", "/v1/pinax/tasks/:id", "/v1/pinax/tasks/:id/resume", "/v1/pinax/tasks/:id/cancel", "/v1/pinax/contract", "/healthz"] });
    } catch (e) {
      if (res.destroyed || res.writableEnded) return;
      const message = String((e as Error)?.message || e).slice(0, 300);
      if (res.headersSent) {
        res.write(serializeNarrativeAgentSseEvent(createNarrativeAgentStreamEvent("error", { code: "PINAX_ADAPTER_INTERNAL", message, retryable: false })));
        return res.end();
      }
      return json(res, 500, { ok: false, error: "adapter-internal", message });
    }
  });

  server.listen(cfg.port, cfg.host, () => {
    console.error(`[pinax-adapter] listening on http://${cfg.host}:${cfg.port} (model=${cfg.provider}.${cfg.model}, toolResultCap=${NARRATIVE_TOOL_LIMITS.maxResultChars})`);
  });
  return server;
}

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, "/")}`).href) {
  startServer();
}
