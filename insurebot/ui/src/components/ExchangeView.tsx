"use client";
import type { Exchange } from "@/lib/mcp";

export function summarize(x: Exchange) {
  const body = x.response.body ?? {};
  const result = body.result;
  const error = body.error;
  const text =
    (result?.content ?? [])
      .filter((c: { type: string }) => c.type === "text")
      .map((c: { text: string }) => c.text)
      .join("\n") ||
    error?.message ||
    (typeof body === "string" ? body : body.error ?? body.networkError ?? "");
  let tone: "ok" | "bad" | "warn" = "ok";
  if (x.response.status >= 400 || error || result?.isError || body.networkError) tone = "bad";
  else if (result?.resultType === "input_required") tone = "warn";
  const pod = x.response.headers["x-upstream"] ?? result?.structuredContent?.servedBy;
  return { result, error, text: String(text), tone, pod };
}

export default function ExchangeView({ x, title, open, jaeger, onTrace }: { x: Exchange; title?: string; open?: boolean; jaeger?: string; onTrace?: (id: string) => void }) {
  const s = summarize(x);
  const rpc = x.response.body?.error?.code;
  return (
    <details className="x" open={open}>
      <summary>
        <span className={`chip ${s.tone === "ok" ? "ok" : s.tone === "bad" ? "bad" : "warn"}`}>HTTP {x.response.status || "—"}</span>
        {rpc !== undefined && <span className="chip bad">JSON-RPC {rpc}</span>}
        {s.result?.resultType && <span className="chip">{s.result.resultType}</span>}
        {s.result?.isError && <span className="chip bad">isError</span>}
        <span className="mono">{x.request.body && (x.request.body as any).params?.name ? (x.request.body as any).params.name : (x.request.body as any)?.method}</span>
        {title && <span className="muted">{title}</span>}
        <span className="grow" />
        {s.pod && <span className="chip">pod {String(s.pod).replace(/:3000$/, "")}</span>}
        <span className="muted">{x.ms} ms</span>
      </summary>
      <div className="inner">
        {s.text && <div className={`result ${s.tone}`}>{s.text}</div>}
        <div className="row">
          {jaeger && (
            <a className="btn small" href={`${jaeger}/trace/${x.traceId}`} target="_blank" rel="noreferrer">
              Open trace in Jaeger
            </a>
          )}
          {onTrace && (
            <button className="btn small" onClick={() => onTrace(x.traceId)}>
              Find in audit log
            </button>
          )}
          <span className="muted mono">trace {x.traceId.slice(0, 12)}…</span>
        </div>
        <div className="two">
          <div>
            <div className="label">Request · POST {x.request.url}</div>
            <pre className="json">{JSON.stringify({ headers: x.request.headers, body: x.request.body }, null, 2)}</pre>
          </div>
          <div>
            <div className="label">Response</div>
            <pre className="json">{JSON.stringify({ status: x.response.status, headers: x.response.headers, body: x.response.body }, null, 2)}</pre>
          </div>
        </div>
      </div>
    </details>
  );
}
