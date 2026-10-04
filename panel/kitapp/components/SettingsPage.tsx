"use client";

/** 设置专有页（批A）：kit 模型配置 + 连接自探针。 */
import { useCallback, useEffect, useState } from "react";

const ACCENT = "var(--accent, #a5433a)";
const OK_COLOR = "var(--status-ok, #5f9c7a)";

interface KitModel { configured?: boolean; source?: string; baseUrl?: string | null; model?: string; provider?: string; keyMasked?: string }
interface ProbeResult { hub?: string; model?: string; files?: string; journal?: string }

export function SettingsPage() {
  const [model, setModel] = useState<KitModel | null>(null);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState("");
  const [form, setForm] = useState({ provider: "", model: "", baseUrl: "" });

  const loadModel = useCallback(async () => {
    try {
      const r = await fetch("http://127.0.0.1:8431/api/agent/model");
      const body = (await r.json()) as KitModel;
      setModel(body);
      setForm({ provider: body.provider ?? "", model: body.model ?? "", baseUrl: body.baseUrl ?? "" });
    } catch (e) { setNote(`模型配置不可达：${String(e)}`); }
  }, []);

  const runProbe = useCallback(async () => {
    const p: ProbeResult = {};
    try {
      const hub = await fetch("http://127.0.0.1:8431/api/hub");
      p.hub = hub.ok ? `✓ ${((await hub.json()) as { workspace?: string }).workspace ?? "ok"}` : `✗ ${hub.status}`;
    } catch { p.hub = "✗ 不可达"; }
    try {
      const m = await fetch("http://127.0.0.1:8431/api/agent/model");
      p.model = m.ok ? "✓" : `✗ ${m.status}`;
    } catch { p.model = "✗ 不可达"; }
    try {
      const f = await fetch("http://127.0.0.1:8431/api/panel/files?project=p-sh-202609291020aye");
      p.files = f.ok ? "✓" : `✗ ${f.status}`;
    } catch { p.files = "✗ 不可达"; }
    try {
      const j = await fetch("http://127.0.0.1:8431/api/panel/journal?project=p-sh-202609291020aye");
      p.journal = j.ok ? "✓" : `✗ ${j.status}`;
    } catch { p.journal = "✗ 不可达"; }
    setProbe(p);
  }, []);

  useEffect(() => { void loadModel(); void runProbe(); }, [loadModel, runProbe]);

  const save = useCallback(async () => {
    setSaving(true);
    setNote("");
    try {
      const r = await fetch("http://127.0.0.1:8431/api/agent/model", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: form.provider, model: form.model, ...(form.baseUrl ? { baseUrl: form.baseUrl } : {}) }),
      });
      if (!r.ok) throw new Error(`${r.status}`);
      setNote("✓ 已保存——重启 kit web/serve 后生效");
      void loadModel();
    } catch (e) { setNote(`✗ ${String(e)}`); }
    finally { setSaving(false); }
  }, [form]);

  const labelStyle: React.CSSProperties = { fontSize: 12, color: "var(--text-muted)", whiteSpace: "nowrap" };
  const inputStyle: React.CSSProperties = { flex: 1, padding: "7px 10px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-panel, #fff)", color: "var(--text)", fontSize: 13, fontFamily: "inherit" };

  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 300, background: "var(--bg)", display: "flex", flexDirection: "column", overflow: "auto" }}>
      <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <b style={{ fontSize: 15, letterSpacing: 2 }}>⚙ 设置</b>
      </div>
      <div style={{ flex: 1, padding: 20, display: "flex", flexDirection: "column", gap: 20, maxWidth: 800 }}>
        {/* 连接自探针 */}
        <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <b style={{ fontSize: 13 }}>连接自探针</b>
            <button type="button" onClick={() => void runProbe()} style={{ padding: "3px 10px", border: "1px solid var(--border)", borderRadius: 5, background: "transparent", color: "var(--text-muted)", cursor: "pointer", fontSize: 11 }}>重新探测</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 8, fontSize: 12 }}>
            {probe ? Object.entries(probe).map(([k, v]) => (
              <div key={k} style={{ padding: "6px 8px", border: "1px solid var(--border)", borderRadius: 6, fontFamily: "var(--font-mono)", fontSize: 11 }}>
                <div style={{ color: "var(--text-muted)" }}>{k}</div>
                <div style={{ color: String(v).startsWith("✓") ? "var(--status-ok, #5f9c7a)" : "var(--text)" }}>{v}</div>
              </div>
            )) : <span style={labelStyle}>点「重新探测」检查 kit 连接…</span>}
          </div>
        </div>

        {/* 模型配置 */}
        <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>模型配置</div>
          {model && (
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>
              当前: {model.provider}/{model.model} · key: {model.keyMasked ?? "未配"} · source: {model.source ?? "—"}
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <label style={labelStyle}>Provider</label>
              <input style={inputStyle} value={form.provider} onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value }))} placeholder="zai" />
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <label style={labelStyle}>Model</label>
              <input style={inputStyle} value={form.model} onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))} placeholder="glm-5.3-flash" />
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <label style={labelStyle}>Base URL</label>
              <input style={inputStyle} value={form.baseUrl} onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))} placeholder="（可选）自定义端点" />
            </div>
            <button type="button" onClick={() => void save()} disabled={saving} style={{ ...chip(false), maxWidth: 120, textAlign: "center" }}>
              {saving ? "保存中…" : "保存模型配置"}
            </button>
            {note && <div style={{ fontSize: 12, color: note.startsWith("✓") ? OK_COLOR : "var(--text-muted)" }}>{note}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

function chip(on: boolean): React.CSSProperties {
  return {
    padding: "5px 12px", borderRadius: 6, fontSize: 12, cursor: "pointer",
    border: `1px solid ${on ? ACCENT : "var(--border)"}`,
    background: on ? "var(--bg-selected)" : "transparent",
    color: on ? ACCENT : "var(--text-muted)",
  };
}
