import { test } from "node:test";
import assert from "node:assert/strict";
import { createNarrativeAgentStreamEvent, serializeNarrativeAgentSseEvent, parseNarrativeAgentSseEvent, NARRATIVE_TOOL_LIMITS } from "../src/pinax/contract.js";
import { buildPinaxTools, type ResourceSnapshot } from "../src/pinax/tools.js";

const snapshot: ResourceSnapshot = {
  revision: "rev_test_1",
  currentPlaceId: "p_wutown",
  domains: {
    world_lookup: [
      { id: "c_yanning", title: "沈砚宁", type: "角色", summary: "青梧镇药庐女医，善辨百草。", aliases: ["砚宁"], relations: [{ type: "师徒", targetId: "c_laozhou" }] },
      { id: "c_laozhou", title: "老周", type: "角色", summary: "镇口刻碑匠，砚宁养父。" },
      { id: "k_talisman", title: "引路符", type: "物品", text: "燃尽后可指向亡者安息之地，一日仅一次。" },
    ],
    geo_lookup: [
      { id: "p_wutown", title: "青梧镇", position: { x: 10, y: 8 }, connectedPlaces: ["p_yunmen"] },
      { id: "p_yunmen", title: "云门山", position: { x: 14, y: 12 }, connectedPlaces: ["p_wutown"] },
    ],
    history_lookup: [
      { id: "h_fire", title: "药庐大火", time: "十二年前冬", summary: "砚宁生父葬于火，老周抱出砚宁。", cause: "灯仆" },
    ],
    memory_lookup: [
      { id: "m_promise", title: "守镇之约", summary: "砚宁答应老周不离镇。", trust: "confirmed-memory" },
    ],
    politics_lookup: [
      { id: "f_xuantie", title: "玄铁商会", faction: "商会", controls: ["p_yunmen"], summary: "近年频购青梧山场。" },
    ],
  },
};

async function callTool(name: string, params: Record<string, unknown>) {
  const tools = buildPinaxTools(snapshot);
  const tool = tools.find((t) => t.name === name)!;
  const r = await tool.execute("tc_1", params as never);
  return JSON.parse((r.content[0] as { text?: string }).text ?? "{}");
}

test("契约帧可被上游 parser 往返解析", () => {
  const frame = serializeNarrativeAgentSseEvent(
    createNarrativeAgentStreamEvent("tool.call", { callId: "tc:9", toolName: "world_lookup", action: "search", requestId: "r1", seq: 2 }),
  );
  const parsed = parseNarrativeAgentSseEvent(frame);
  assert.ok(parsed);
  assert.equal(parsed!.type, "tool.call");
  assert.equal(parsed!.schemaVersion, 1);
  assert.equal(parsed!.toolName, "world_lookup");
});

test("越界事件类型构造即拒", () => {
  assert.throws(() => createNarrativeAgentStreamEvent("tool_result" as never, {}));
});

test("world_lookup search/get/related", async () => {
  const s = await callTool("world_lookup", { action: "search", query: "药庐 女医" });
  assert.ok(s.items.length >= 1);
  assert.match(s.items.join("|"), /沈砚宁/);
  const g = await callTool("world_lookup", { action: "get", id: "k_talisman" });
  assert.match(g.items.join(""), /引路符/);
  const rel = await callTool("world_lookup", { action: "related", id: "c_yanning" });
  assert.ok(rel.items.some((l: string) => l.includes("老周")));
  const miss = await callTool("world_lookup", { action: "get", id: "nope" });
  assert.deepEqual(miss.warnings, ["entry-not-found"]);
});

test("geo route 无直达时明示不虚构", async () => {
  const r = await callTool("geo_lookup", { action: "route", id: "p_wutown", to: "p_yunmen" });
  assert.ok(r.warnings.join("").includes("直达"));
  const bad = await callTool("geo_lookup", { action: "route", id: "p_wutown", to: "不存在" });
  assert.deepEqual(bad.warnings, ["endpoint-not-found"]);
});

test("结果信封限额：单条≤maxItemChars，总≤maxResultChars", async () => {
  const s = await callTool("world_lookup", { action: "search", query: "" });
  assert.ok(s.items.length <= NARRATIVE_TOOL_LIMITS.maxItems);
  const g = await callTool("world_lookup", { action: "get", id: "c_yanning" });
  const raw = JSON.stringify(g);
  assert.ok(raw.length <= NARRATIVE_TOOL_LIMITS.maxResultChars, `result too long: ${raw.length}`);
});

test("memory/politics/history 各自 action 可用", async () => {
  const m = await callTool("memory_lookup", { action: "search", query: "守镇" });
  assert.match(m.items.join("|"), /守镇之约/);
  const p = await callTool("politics_lookup", { action: "current" });
  assert.ok(Array.isArray(p.items));
  const h = await callTool("history_lookup", { action: "trace", query: "大火" });
  assert.match(h.items.join("|"), /药庐大火/);
});

test("只暴露快照非空域的工具", async () => {
  const tools = buildPinaxTools({ revision: "r", domains: { world_lookup: snapshot.domains.world_lookup } });
  // 五 lookup 之外的新能力工具（manuscript/notes/outline/calc）走快照域/hooks 注册，
  // 本断言只钉原生五 lookup 的暴露纪律：无 hooks 无新域 → 仅 world_lookup
  assert.deepEqual(tools.map((t) => t.name).filter((n) => n.endsWith("_lookup")), ["world_lookup"]);
  const extended = buildPinaxTools({ revision: "r", domains: { manuscript: [{ id: "chapter-a", title: "第一章", text: "钥匙落在码头。" }], notes: [{ id: "note-a", title: "计划", text: "下章找钥匙。" }], outline: [{ id: "outline-a", title: "回家", summary: "找到钥匙" }] } });
  for (const name of ["manuscript_search", "manuscript_get", "notes_search", "outline_lookup", "calc_evaluate"]) assert.ok(extended.some(tool => tool.name === name));
  const search = extended.find(tool => tool.name === "manuscript_search")!;
  const result = await search.execute("read", { query: "钥匙" });
  const payload = JSON.parse((result.content[0] as { text: string }).text);
  assert.equal(payload.hits[0].id, "chapter-a");
  assert.ok(JSON.stringify(payload).length <= NARRATIVE_TOOL_LIMITS.maxResultChars);

});
