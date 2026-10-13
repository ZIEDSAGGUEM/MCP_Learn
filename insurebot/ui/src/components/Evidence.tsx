"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";

type Row = { id: string; at: string; pod: string; trace_id: string | null; tenant_id: string | null; sub: string | null; client_id: string | null; tool: string | null; arg_keys: string[] | null; outcome: string; duration_ms: number | null };
type Mail = { total: number; byRecipient: Record<string, number>; latest: { id: string; at: string; to: string[]; subject: string; snippet: string }[] };

const tone = (o: string) => (o === "ok" ? "ok" : o === "input_required" ? "warn" : "bad");

export default function Evidence({ jaeger, trace, clearTrace }: { jaeger?: string; trace: string; clearTrace: () => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [totals, setTotals] = useState<{ outcome: string; n: number }[]>([]);
  const [mail, setMail] = useState<Mail | null>(null);
  const [mine, setMine] = useState(false);
  const [live, setLive] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const q = new URLSearchParams();
      if (mine) q.set("mine", "1");
      if (trace) q.set("trace", trace);
      const [a, m] = await Promise.all([api<{ rows: Row[]; totals: typeof totals }>(`/api/evidence/audit?${q}`), api<Mail>("/api/evidence/mail")]);
      setRows(a.rows);
      setTotals(a.totals);
      setMail(m);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [mine, trace]);

  useEffect(() => {
    void load();
    if (!live) return;
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [load, live]);

  const mallory = Object.entries(mail?.byRecipient ?? {}).filter(([a]) => a.includes("mallory")).reduce((n, [, c]) => n + c, 0);

  return (
    <div className="stack">
      {error && <div className="banner">{error}</div>}
      <div className="panel">
        <div className="panel-head">
          <h2>Audit log</h2>
          <span className="muted">read as insurebot_lab_viewer (SELECT only) · last 40 rows</span>
          <span className="grow" />
          {trace && (
            <button className="btn small" onClick={clearTrace}>
              trace {trace.slice(0, 10)}… ✕
            </button>
          )}
          <label className="row"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> my agency only</label>
          <label className="row"><input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} /> live</label>
        </div>
        <div className="panel-body stack">
          <div className="stats">
            <span className="muted">Last hour:</span>
            {totals.map((t) => (
              <span key={t.outcome} className={`chip ${tone(t.outcome)}`}>{t.outcome} {t.n}</span>
            ))}
          </div>
          <div className="scroll">
            <table className="t">
              <thead>
                <tr><th>Time</th><th>Agency</th><th>User</th><th>App</th><th>Tool</th><th>Argument names</th><th>Outcome</th><th>ms</th><th>Pod</th><th>Trace</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="mono">{new Date(r.at).toLocaleTimeString()}</td>
                    <td>{r.tenant_id ?? "—"}</td>
                    <td className="mono">{r.sub ?? "—"}</td>
                    <td>{r.client_id ?? "—"}</td>
                    <td className="mono">{r.tool ?? "—"}</td>
                    <td className="mono">{(r.arg_keys ?? []).join(", ")}</td>
                    <td><span className={`chip ${tone(r.outcome)}`}>{r.outcome}</span></td>
                    <td>{r.duration_ms ?? ""}</td>
                    <td className="mono">{r.pod.slice(0, 12)}</td>
                    <td>{r.trace_id && jaeger ? <a href={`${jaeger}/trace/${r.trace_id}`} target="_blank" rel="noreferrer" className="mono">{r.trace_id.slice(0, 8)}…</a> : "—"}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={10} className="muted">No rows yet{trace ? " for this trace (the audit row is written when the call finishes; give it a second)" : ""}.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ margin: 0 }}>Only argument names are stored, never values: no diagnoses or secrets end up in the audit log.</p>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>Mailpit</h2>
          <span className="muted">every email InsureBot sent</span>
          <span className="grow" />
          <span className={`chip ${mallory === 0 ? "ok" : "bad"}`}>to mallory.test: {mallory}</span>
          <a className="btn small" href="http://localhost:8025" target="_blank" rel="noreferrer">Open Mailpit</a>
        </div>
        <div className="panel-body stack">
          <div className="stats">
            {Object.entries(mail?.byRecipient ?? {}).map(([a, n]) => (
              <span key={a} className={`chip ${a.includes("mallory") ? "bad" : ""}`}>{a}: {n}</span>
            ))}
          </div>
          <div className="scroll">
            <table className="t">
              <thead><tr><th>Time</th><th>To</th><th>Subject</th><th>Start of the message</th></tr></thead>
              <tbody>
                {(mail?.latest ?? []).map((m) => (
                  <tr key={m.id}>
                    <td className="mono">{new Date(m.at).toLocaleTimeString()}</td>
                    <td>{m.to.join(", ")}</td>
                    <td>{m.subject}</td>
                    <td className="muted" style={{ whiteSpace: "normal" }}>{m.snippet}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head"><h2>Traces</h2></div>
        <div className="panel-body row">
          <span className="muted">Every call from this UI sends a <code>traceparent</code>, so each one can be opened in Jaeger: HTTP → tool → SQL.</span>
          {jaeger && <a className="btn small" href={`${jaeger}/search?service=insurebot`} target="_blank" rel="noreferrer">Open Jaeger</a>}
        </div>
      </div>
    </div>
  );
}
