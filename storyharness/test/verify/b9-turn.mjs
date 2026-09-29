// B9 验收用：以 UTF-8 正确发一条最小回合（避开 curl 在 Git Bash 下的 GBK 参数转码干扰）
const base = process.argv[2] || "http://127.0.0.1:5199";
const project = process.argv[3] || "p-sh-demo2";
const text = process.argv[4] || "只回一句话：指标面验收通过。不要调用任何工具。";
const existing = process.argv[5] || "";

let sid = existing;
if (!sid) {
  const r = await fetch(`${base}/api/projects/${encodeURIComponent(project)}/agent/sessions`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "B9 指标验收·真回合" }),
  });
  sid = (await r.json()).id;
}
process.stdout.write("sid=" + sid + "\n");

const res = await fetch(`${base}/api/projects/${encodeURIComponent(project)}/agent/sessions/${sid}/turn`, {
  method: "POST", headers: { "content-type": "application/json; charset=utf-8" },
  body: JSON.stringify({ text, mode: "plan" }),
});
let buf = "";
const dec = new TextDecoder();
for await (const chunk of res.body) {
  buf += dec.decode(chunk, { stream: true });
  const parts = buf.split("\n\n");
  buf = parts.pop() ?? "";
  for (const p of parts) {
    const line = p.replace(/^data: /, "").trim();
    if (!line || line === "[DONE]") continue;
    try {
      const ev = JSON.parse(line);
      process.stdout.write(ev.type + " " + JSON.stringify(ev).slice(0, 260) + "\n");
    } catch { process.stdout.write("raw " + line.slice(0, 120) + "\n"); }
  }
}
process.stdout.write("sid=" + sid + "\n");
