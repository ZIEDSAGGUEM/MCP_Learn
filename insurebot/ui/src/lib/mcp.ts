// A raw MCP 2026-07-28 caller. The UI shows every request and response exactly as they travel,
// so it doesn't hide anything behind an SDK: you see the headers, the _meta envelope, the status codes.
import { randomBytes } from "node:crypto";

export const CAN_ASK_USER = { elicitation: { form: {} } }; // lets the server ask for a confirmation (MRTR)

export type Exchange = {
  request: { url: string; headers: Record<string, string>; body: unknown };
  response: { status: number; headers: Record<string, string>; body: any };
  traceId: string;
  ms: number;
};

export type McpOptions = {
  url: string;
  token?: string;
  method: string;
  params?: Record<string, unknown>;
  capabilities?: Record<string, unknown>;
  headers?: Record<string, string>; // extra or overriding headers (attacks)
  clientName?: string;
};

const SHOWN_RESPONSE_HEADERS = ["content-type", "www-authenticate", "retry-after", "cache-control", "vary", "x-upstream", "x-cache-status"];

/** "Bearer eyJ…a1b2c3": enough to see a token was sent, never enough to reuse it. */
export function redactToken(value: string) {
  const t = value.replace(/^Bearer\s+/i, "");
  return t.length > 16 ? `Bearer ${t.slice(0, 6)}…${t.slice(-6)}` : `Bearer ${t}`;
}

export async function mcp(o: McpOptions): Promise<Exchange> {
  const traceId = randomBytes(16).toString("hex");
  const traceparent = `00-${traceId}-${randomBytes(8).toString("hex")}-01`;
  const params = o.params ?? {};
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "mcp-protocol-version": "2026-07-28",
    "mcp-method": o.method,
    traceparent,
  };
  if (typeof params.name === "string") headers["mcp-name"] = params.name;
  if (o.token) headers.authorization = `Bearer ${o.token}`;
  Object.assign(headers, o.headers ?? {});
  for (const [k, v] of Object.entries(headers)) if (v === "") delete headers[k]; // "" = drop the header (attack demos)

  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: o.method,
    params: {
      ...params,
      _meta: {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientCapabilities": o.capabilities ?? {},
        "io.modelcontextprotocol/clientInfo": { name: o.clientName ?? "insurebot-lab-ui", version: "0.1.0" },
        traceparent,
      },
    },
  };

  const started = Date.now();
  let status = 0;
  let resHeaders: Record<string, string> = {};
  let parsed: any;
  try {
    const res = await fetch(o.url, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
    status = res.status;
    for (const h of SHOWN_RESPONSE_HEADERS) {
      const v = res.headers.get(h);
      if (v) resHeaders[h] = v;
    }
    parsed = parseBody(await res.text(), res.headers.get("content-type") ?? "");
  } catch (err) {
    parsed = { networkError: err instanceof Error ? err.message : String(err) };
  }

  const shownHeaders = { ...headers };
  if (shownHeaders.authorization) shownHeaders.authorization = redactToken(shownHeaders.authorization);
  return {
    request: { url: o.url, headers: shownHeaders, body },
    response: { status, headers: resHeaders, body: parsed },
    traceId,
    ms: Date.now() - started,
  };
}

/** JSON, or a Server-Sent-Events stream whose last JSON-RPC response is the answer. */
function parseBody(text: string, contentType: string): any {
  if (contentType.includes("text/event-stream")) {
    const messages = text
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => {
        try {
          return JSON.parse(l.slice(5).trim());
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    return messages.reverse().find((m) => m.result !== undefined || m.error !== undefined) ?? messages[0] ?? text;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Convenience views over an exchange */
export const resultOf = (x: Exchange) => x.response.body?.result;
export const errorOf = (x: Exchange) => x.response.body?.error;
export const textOf = (x: Exchange): string =>
  (resultOf(x)?.content ?? [])
    .filter((c: { type: string }) => c.type === "text")
    .map((c: { text: string }) => c.text)
    .join("\n");
