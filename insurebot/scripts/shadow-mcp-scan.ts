// Step 11, Episode 20 / MCP09: find MCP endpoints that answer WITHOUT a token ("shadow" servers).
// Usage: npx tsx scripts/shadow-mcp-scan.ts [url ...]
// With no arguments it scans the lab's ports on localhost.

export type Finding = { url: string; verdict: "UNAUTHENTICATED MCP" | "protected" | "not MCP" | "unreachable"; detail: string };

const DEFAULT_PORTS = [3000, 3001, 3002, 3003, 3004, 3999, 4000, 8025, 8080, 8181];
export const defaultTargets = () => DEFAULT_PORTS.map((p) => `http://localhost:${p}/mcp`);

const HEADERS = { "content-type": "application/json", accept: "application/json, text/event-stream" };

/** Probe one URL, as an anonymous client, with a 2026-07-28 request and a 2025-style handshake. */
export async function probe(url: string): Promise<Finding> {
  const modern = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list",
    params: {
      _meta: {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientCapabilities": {},
        "io.modelcontextprotocol/clientInfo": { name: "shadow-mcp-scan", version: "1" },
      },
    },
  };
  const legacy = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "shadow-mcp-scan", version: "1" } },
  };
  const attempts: [string, object, Record<string, string>][] = [
    ["2026-07-28 tools/list", modern, { "mcp-protocol-version": "2026-07-28", "mcp-method": "tools/list" }],
    ["2025 initialize", legacy, {}],
  ];

  let sawProtected = "";
  for (const [label, body, extra] of attempts) {
    let res: Response;
    try {
      res = await fetch(url, { method: "POST", headers: { ...HEADERS, ...extra }, body: JSON.stringify(body), signal: AbortSignal.timeout(2000) });
    } catch {
      return { url, verdict: "unreachable", detail: "no answer" };
    }
    if (res.status === 401 || res.status === 403) {
      sawProtected = `${res.status} on ${label}`;
      continue;
    }
    const text = await res.text();
    // Plain JSON, or the first SSE "data:" line
    const json = text.trim().startsWith("{") ? text : text.split("\n").find((l) => l.startsWith("data:"))?.slice(5);
    try {
      const msg = JSON.parse(json ?? "");
      if (msg?.result?.tools || msg?.result?.serverInfo || msg?.result?.capabilities) {
        const tools = msg.result.tools?.map((t: { name: string }) => t.name).join(", ");
        return { url, verdict: "UNAUTHENTICATED MCP", detail: `answered ${label} without a token${tools ? `: ${tools}` : ""}` };
      }
    } catch {
      // not JSON-RPC
    }
  }
  return sawProtected ? { url, verdict: "protected", detail: sawProtected } : { url, verdict: "not MCP", detail: "no MCP answer" };
}

export async function scan(targets: string[]): Promise<Finding[]> {
  return Promise.all(targets.map(probe));
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const targets = process.argv.slice(2).length ? process.argv.slice(2) : defaultTargets();
  const findings = await scan(targets);
  for (const f of findings) console.log(`${f.verdict.padEnd(20)} ${f.url}  ${f.detail}`);
  const shadows = findings.filter((f) => f.verdict === "UNAUTHENTICATED MCP");
  if (shadows.length) {
    console.error(`\n${shadows.length} MCP endpoint(s) answer without a token. Add auth or shut them down, and list every server in INVENTORY.md.`);
    process.exit(1);
  }
}
