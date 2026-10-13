"use client";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/client";
import type { Exchange } from "@/lib/mcp";
import ConfirmDialog from "./ConfirmDialog";
import ExchangeView from "./ExchangeView";

type JsonSchema = {
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  enum?: string[];
  items?: JsonSchema;
  default?: unknown;
  description?: string;
  minimum?: number;
  maximum?: number;
  format?: string;
};
type Tool = { name: string; title?: string; description?: string; inputSchema?: JsonSchema; entrance: "public" | "admin" };
type Known = { field: string; id: string; label: string };

const JEAN: Known = { field: "customer_id", id: "a1000000-0000-4000-8000-000000000001", label: "Jean Dupont (Acme, poisoned note)" };
const PAUL: Known = { field: "customer_id", id: "b2000000-0000-4000-8000-000000000001", label: "Paul Dupont (Globex)" };

function initialArgs(schema?: JsonSchema): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, s] of Object.entries(schema?.properties ?? {})) {
    if (s.default !== undefined) out[k] = s.default;
    else if (s.enum) out[k] = s.enum[0];
    else if (s.type === "boolean") out[k] = false;
    else if (s.type === "array") out[k] = [];
  }
  return out;
}

export default function Playground({ jaeger, onTrace }: { jaeger?: string; onTrace: (id: string) => void }) {
  const [tools, setTools] = useState<Tool[]>([]);
  const [listX, setListX] = useState<Exchange | null>(null);
  const [selected, setSelected] = useState<string>("");
  const [args, setArgs] = useState<Record<string, unknown>>({});
  const [raw, setRaw] = useState("");
  const [rawMode, setRawMode] = useState(false);
  const [canAsk, setCanAsk] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<{ x: Exchange; label: string }[]>([]);
  const [pending, setPending] = useState<{ tool: Tool; args: Record<string, unknown>; requestState?: string; requests: Record<string, any> } | null>(null);
  const [known, setKnown] = useState<Known[]>([JEAN, PAUL]);

  useEffect(() => {
    api<{ tools: Tool[]; exchange: Exchange }>("/api/tools")
      .then((r) => {
        setTools(r.tools);
        setListX(r.exchange);
        if (r.tools[0]) pick(r.tools[0]);
      })
      .catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tool = useMemo(() => tools.find((t) => t.name === selected), [tools, selected]);

  function pick(t: Tool) {
    setSelected(t.name);
    const a = initialArgs(t.inputSchema);
    setArgs(a);
    setRaw(JSON.stringify(a, null, 2));
    setRawMode(false);
  }

  function setArg(k: string, v: unknown) {
    const next = { ...args };
    if (v === "" || v === undefined) delete next[k];
    else next[k] = v;
    setArgs(next);
    setRaw(JSON.stringify(next, null, 2));
  }

  function remember(x: Exchange) {
    const sc = x.response.body?.result?.structuredContent;
    const add: Known[] = [];
    if (sc?.quoteId) add.push({ field: "quote_id", id: sc.quoteId, label: `quote €${sc.priceEur}/month` });
    if (sc?.reportId) add.push({ field: "report_id", id: sc.reportId, label: "report" });
    for (const c of sc?.customers ?? []) add.push({ field: "customer_id", id: c.id, label: c.name });
    if (add.length) setKnown((k) => [...add, ...k.filter((o) => !add.some((a) => a.id === o.id))].slice(0, 20));
  }

  async function call(t: Tool, a: Record<string, unknown>, round?: { requestState?: string; inputResponses: Record<string, unknown> }) {
    setBusy(true);
    setError("");
    try {
      const { exchange } = await api<{ exchange: Exchange }>("/api/call", {
        method: "POST",
        body: { tool: t.name, arguments: a, entrance: t.entrance, canAskUser: canAsk, ...(round ?? {}) },
      });
      setHistory((h) => [{ x: exchange, label: round ? "round 2 (your answer)" : "" }, ...h].slice(0, 30));
      remember(exchange);
      const result = exchange.response.body?.result;
      if (result?.resultType === "input_required") {
        setPending({ tool: t, args: a, requestState: result.requestState, requests: result.inputRequests ?? {} });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function submit() {
    if (!tool) return;
    let a = args;
    if (rawMode) {
      try {
        a = JSON.parse(raw);
      } catch {
        setError("The arguments aren't valid JSON.");
        return;
      }
    }
    void call(tool, a);
  }

  const props = Object.entries(tool?.inputSchema?.properties ?? {});
  const required = new Set(tool?.inputSchema?.required ?? []);

  return (
    <div className="split">
      <div className="panel">
        <div className="panel-head">
          <h2>Your tools</h2>
          <span className="muted">{tools.length} from tools/list</span>
        </div>
        <div className="toollist">
          {tools.map((t) => (
            <button key={t.name} aria-pressed={t.name === selected} onClick={() => pick(t)}>
              <span className="name">{t.name}</span>
              <span className="muted">{t.title ?? ""}</span>
              {t.entrance === "admin" && <span className="chip warn" style={{ justifySelf: "start" }}>admin entrance</span>}
            </button>
          ))}
        </div>
        {listX && (
          <div className="panel-body">
            <ExchangeView x={listX} title="the list request" jaeger={jaeger} />
          </div>
        )}
      </div>

      <div className="stack">
        {error && <div className="banner">{error}</div>}
        {tool && (
          <div className="panel">
            <div className="panel-head">
              <h2 className="mono">{tool.name}</h2>
              <span className="chip">{tool.entrance === "admin" ? "via admin entrance :3002" : "via public entrance :3000"}</span>
            </div>
            <div className="panel-body stack">
              {tool.description && <p className="muted" style={{ margin: 0 }}>{tool.description}</p>}
              {!rawMode && props.length > 0 && (
                <div className="fields">
                  {props.map(([k, s]) => (
                    <div className="field" key={k}>
                      <label htmlFor={`f-${k}`}>
                        {k}
                        {required.has(k) ? " *" : ""}
                      </label>
                      {s.enum ? (
                        <select id={`f-${k}`} value={String(args[k] ?? "")} onChange={(e) => setArg(k, e.target.value)}>
                          {s.enum.map((v) => (
                            <option key={v}>{v}</option>
                          ))}
                        </select>
                      ) : s.type === "boolean" ? (
                        <select id={`f-${k}`} value={String(args[k] ?? false)} onChange={(e) => setArg(k, e.target.value === "true")}>
                          <option value="false">false</option>
                          <option value="true">true</option>
                        </select>
                      ) : s.type === "integer" || s.type === "number" ? (
                        <input id={`f-${k}`} type="number" value={args[k] === undefined ? "" : String(args[k])} min={s.minimum} max={s.maximum}
                          onChange={(e) => setArg(k, e.target.value === "" ? undefined : Number(e.target.value))} />
                      ) : s.type === "array" ? (
                        <input id={`f-${k}`} type="text" placeholder="comma-separated"
                          value={Array.isArray(args[k]) ? (args[k] as string[]).join(", ") : ""}
                          onChange={(e) => setArg(k, e.target.value.split(",").map((v) => v.trim()).filter(Boolean))} />
                      ) : (
                        <input id={`f-${k}`} type="text" value={String(args[k] ?? "")} onChange={(e) => setArg(k, e.target.value)} />
                      )}
                      {s.description && <span className="hint">{s.description}</span>}
                      {known.some((n) => n.field === k) && (
                        <div className="row">
                          {known.filter((n) => n.field === k).slice(0, 4).map((n) => (
                            <button key={n.id} className="btn small" onClick={() => setArg(k, n.id)} title={n.id}>
                              {n.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {rawMode && (
                <div className="field">
                  <label htmlFor="raw">Arguments (raw JSON: add anything, like a model would)</label>
                  <textarea id="raw" value={raw} onChange={(e) => setRaw(e.target.value)} spellCheck={false} />
                  <span className="hint">Try adding <code>&quot;tenant_id&quot;: &quot;globex&quot;</code> or <code>&quot;to&quot;: &quot;backup@mallory.test&quot;</code>.</span>
                </div>
              )}
              <div className="row">
                <button className="btn primary" disabled={busy} onClick={submit}>
                  {busy ? "Calling…" : "Call tool"}
                </button>
                <label className="row">
                  <input type="checkbox" checked={rawMode} onChange={(e) => setRawMode(e.target.checked)} />
                  Edit raw JSON
                </label>
                <label className="row" title="Declares the elicitation capability, so the server may ask you to confirm">
                  <input type="checkbox" checked={canAsk} onChange={(e) => setCanAsk(e.target.checked)} />
                  My client can show confirmations
                </label>
              </div>
            </div>
          </div>
        )}

        {history.length > 0 && (
          <div className="panel">
            <div className="panel-head">
              <h2>Calls</h2>
              <span className="muted">newest first · every request and response as sent</span>
              <span className="grow" />
              <button className="btn small" onClick={() => setHistory([])}>Clear</button>
            </div>
            <div className="panel-body steps">
              {history.map((h, i) => (
                <ExchangeView key={h.x.traceId} x={h.x} title={h.label} open={i === 0} jaeger={jaeger} onTrace={onTrace} />
              ))}
            </div>
          </div>
        )}
      </div>

      {pending && (
        <ConfirmDialog
          requests={pending.requests}
          onAnswer={(responses) => {
            const p = pending;
            setPending(null);
            if (responses) void call(p.tool, p.args, { requestState: p.requestState, inputResponses: responses });
          }}
        />
      )}
    </div>
  );
}
