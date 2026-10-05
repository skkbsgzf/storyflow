// 波14 批2 · 包内模板项目「可选可聊」冒烟驱动（隔离工作区，mock LLM，不碰真仓 projects/）。
// 为什么单独一个文件：CJK 项目名经 Git Bash 传 argv 有编码风险（本批实测踩过），写死在 UTF-8 源码里最稳。
// 用法：node storyharness/test/verify/packtpl-smoke.mjs [http://127.0.0.1:8461] [项目id=template-推演]
const base = process.argv[2] || "http://127.0.0.1:8461";
const project = process.argv[3] || "template-推演";
const P = encodeURIComponent(project);
const out = (k, v) => console.log(`${k.padEnd(34)} ${v}`);

const j = async (label, url, opts) => {
  try {
    const r = await fetch(base + url, opts);
    const text = await r.text();
    out(label, `${r.status} ${text.slice(0, 220).replace(/\s+/g, " ")}`);
    return { st: r.status, text, json: (() => { try { return JSON.parse(text); } catch { return null; } })() };
  } catch (e) {
    out(label, `FETCH-FAIL ${(e && e.message) || e}`);
    return { st: 0, text: "", json: null };
  }
};

// 1) 门面读轴：会话清单（波13 之前的 404 病灶就在这条路上）
await j("GET sessions（读轴回落）", `/api/projects/${P}/agent/sessions`);
// 2) 建会话 = 首写：应触发 S5 落地（cpSync 进工作区），包内容物不动
const created = await j("POST sessions（首写落地）", `/api/projects/${P}/agent/sessions`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ title: "波14批2 冒烟·包内模板项目" }),
});
const sid = created.json && created.json.id;
if (!sid) { out("中止", "没拿到 sid，后面没得跑"); process.exit(2); }
// 3) 真回合（mock LLM）
const res = await fetch(`${base}/api/projects/${P}/agent/sessions/${sid}/turn`, {
  method: "POST", headers: { "content-type": "application/json; charset=utf-8" },
  body: JSON.stringify({ text: "只回一句话：包内模板项目冒烟通过。不要调用任何工具。", mode: "plan" }),
});
out("POST turn", `${res.status} SSE`);
if (res.ok) {
  const dec = new TextDecoder();
  let buf = "", types = [], delta = "";
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() ?? "";
    for (const p of parts) {
      const line = p.replace(/^data: /, "").trim();
      if (!line || line === "[DONE]") continue;
      try {
        const ev = JSON.parse(line);
        types.push(ev.type);
        if (ev.type === "delta" && typeof ev.text === "string") delta += ev.text;
        if (ev.type === "done" && typeof ev.text === "string" && !delta) delta = ev.text;   // 非流式 provider：正文只在 done 里
        if (ev.type === "error") out("turn error", JSON.stringify(ev).slice(0, 200));
      } catch { /* 非 JSON 帧忽略 */ }
    }
  }
  out("turn 事件", types.join(","));
  out("turn 回复", delta.trim().slice(0, 120) || "(空)← 助手气泡没字，前端会看到空回合");
}
// 4) 落地后两轴一致：清单能列出该会话，且模板组不再是它（工作区那份才是正档）
await j("GET sessions（落地后）", `/api/projects/${P}/agent/sessions`);
await j("GET sessions/:sid", `/api/projects/${P}/agent/sessions/${sid}`);
await j("GET sessions/:sid/stats", `/api/projects/${P}/agent/sessions/${sid}/stats`);
const hub = await j("GET hub（落地后分组）", `/api/hub`);
if (hub.json?.groups) out("hub 分组", hub.json.groups.map((g) => `${g.name}=[${g.projects.map((p) => p.id + (p.template ? "·模板" : "")).join(" ")}]`).join("  "));
// 5) S4 门禁：关包 → 包自己的 API 应 403；开回来 → 恢复
await j("POST packs 关 deduce", `/api/packs`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ project, pack: "deduce", enabled: false }),
});
await j("GET /api/deduce/state（应 403）", `/api/deduce/state?project=${P}`);
await j("POST packs 开 deduce", `/api/packs`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ project, pack: "deduce", enabled: true }),
});
await j("GET /api/deduce/state（应非 403）", `/api/deduce/state?project=${P}`);
// 6) 显式复制：换名落工作区，二次拒绝不覆盖
await j("POST packs/clone", `/api/packs/clone`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ project, to: "smoke-copy" }),
});
await j("POST packs/clone（重复应拒）", `/api/packs/clone`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ project, to: "smoke-copy" }),
});
out("sid", sid);
