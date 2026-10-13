"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import type { Outcome } from "@/lib/scenarios";
import ExchangeView from "./ExchangeView";

type ScenarioInfo = { id: string; episode: string; step: string; title: string; story: string; defence: string };

export default function AttackLab({ jaeger, onTrace }: { jaeger?: string; onTrace: (id: string) => void }) {
  const [list, setList] = useState<ScenarioInfo[]>([]);
  const [results, setResults] = useState<Record<string, Outcome>>({});
  const [running, setRunning] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ scenarios: ScenarioInfo[] }>("/api/attacks").then((r) => setList(r.scenarios)).catch((e) => setError(e.message));
  }, []);

  async function run(id: string) {
    setRunning((s) => new Set(s).add(id));
    try {
      const out = await api<Outcome>(`/api/attacks/${id}`, { method: "POST", body: {} });
      setResults((r) => ({ ...r, [id]: out }));
    } catch (e) {
      setResults((r) => ({ ...r, [id]: { verdict: "error", summary: e instanceof Error ? e.message : String(e), steps: [] } }));
    } finally {
      setRunning((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
    }
  }

  async function runAll() {
    for (const s of list) await run(s.id); // one at a time: the flood scenario shouldn't overlap the others
  }

  const done = Object.values(results);
  const blocked = done.filter((r) => r.verdict === "blocked").length;

  return (
    <div className="stack">
      <div className="notice">
        Each card replays one attack from the InsureBot story against the running lab and decides from the real responses.
        The actors (Alice, Bob, Carol, Dave, Erin) log in with the test accounts from <code>.env.test</code>, independent of who you are logged in as.
      </div>
      {error && <div className="banner">{error}</div>}
      <div className="row">
        <button className="btn primary" onClick={runAll} disabled={running.size > 0 || list.length === 0}>
          {running.size > 0 ? "Running…" : `Run all ${list.length} attacks`}
        </button>
        {done.length > 0 && (
          <span className={`chip ${blocked === done.length ? "ok" : "bad"}`}>
            {blocked}/{done.length} blocked
          </span>
        )}
      </div>
      <div className="cards">
        {list.map((s) => {
          const r = results[s.id];
          return (
            <article key={s.id} className={`card ${r?.verdict ?? ""}`}>
              <header>
                <div className="row">
                  <span className="chip accent">{s.episode}</span>
                  <span className="chip">{s.step}</span>
                  {r && <span className={`chip ${r.verdict === "blocked" ? "ok" : "bad"}`}>{r.verdict === "blocked" ? "✓ blocked" : r.verdict === "leaked" ? "✗ leaked" : "error"}</span>}
                </div>
                <h3>{s.title}</h3>
              </header>
              <div className="body">
                <div><span className="label">Attack</span><div>{s.story}</div></div>
                <div><span className="label">Defence</span><div className="muted">{s.defence}</div></div>
                {r && <div className={`result ${r.verdict === "blocked" ? "ok" : "bad"}`}>{r.summary}</div>}
                {r && r.steps.length > 0 && (
                  <details className="x">
                    <summary>{r.steps.length} {r.steps.length === 1 ? "step" : "steps"}</summary>
                    <div className="inner steps">
                      {r.steps.map((st, i) =>
                        st.exchange ? (
                          <div key={i} className="stack" style={{ gap: 4 }}>
                            <div className="muted"><b>{st.actor}</b> · {st.label}</div>
                            <ExchangeView x={st.exchange} jaeger={jaeger} onTrace={onTrace} />
                          </div>
                        ) : (
                          <div key={i} className="step-note"><b>{st.actor}</b> · {st.label}: {st.note}</div>
                        ),
                      )}
                    </div>
                  </details>
                )}
              </div>
              <footer>
                <button className="btn" onClick={() => run(s.id)} disabled={running.has(s.id)}>
                  {running.has(s.id) ? "Running…" : r ? "Run again" : "Run attack"}
                </button>
              </footer>
            </article>
          );
        })}
      </div>
    </div>
  );
}
