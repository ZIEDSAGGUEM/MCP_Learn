import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

// Passwords you set in Keycloak (Part A) live in .env.test (git-ignored)
try {
  process.loadEnvFile(".env.test");
} catch {
  // no .env.test: rely on real environment variables
}

// 127.0.0.1, not "localhost": the gateway listens on IPv4 only, and "localhost" may resolve to IPv6 (::1),
// where another local dev server could be listening on the same port.
export const MCP_URL = process.env.MCP_URL ?? "http://127.0.0.1:3000/mcp";
export const RESOURCE_URL = process.env.RESOURCE_URL ?? "http://localhost:3000/mcp";
export const OIDC_ISSUER = process.env.OIDC_ISSUER ?? "http://localhost:8080/realms/insurebot";
const TOKEN_URL = process.env.KEYCLOAK_TOKEN_URL ?? `${OIDC_ISSUER}/protocol/openid-connect/token`;

// Multi-pod tests only make sense through the gateway (3 replicas), not against one local process
export const viaGateway = !process.env.MCP_URL;

export type User = "alice" | "bob" | "carol" | "dave" | "erin"; // dave: initech (rate-limit flood), erin: globex admin

/**
 * Get an access token from Keycloak with the password grant.
 * Test-only shortcut: real clients (Claude, Inspector) use the browser login with PKCE.
 */
export async function tokenFor(user: User, scope: string, clientId = "insurebot-tests"): Promise<string> {
  const password = process.env[`${user.toUpperCase()}_PASSWORD`];
  if (!password) throw new Error(`Set ${user.toUpperCase()}_PASSWORD in .env.test (see .env.test.example)`);
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    body: new URLSearchParams({ grant_type: "password", client_id: clientId, username: user, password, scope }),
  });
  const body = (await res.json()) as { access_token?: string; error?: string; error_description?: string };
  if (!body.access_token) {
    throw new Error(`Keycloak refused a token for ${user} via ${clientId}: ${body.error} ${body.error_description ?? ""}`);
  }
  return body.access_token;
}

/** An SDK client speaking 2026-07-28, sending the given token on every request. */
export async function connect(token: string): Promise<Client> {
  // Without the pin, the SDK client uses the old 2025 handshake
  const client = new Client(
    { name: "insurebot-tests", version: "0.2.0" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  return client;
}

/**
 * A raw 2026-07-28 HTTP request, so tests can see status codes and headers
 * (401, 403, WWW-Authenticate) that the SDK client hides.
 */
export async function rawRequest(
  token: string | undefined,
  method: string,
  params: Record<string, unknown> = {},
  clientInfo = { name: "raw-test", version: "1" },
  clientCapabilities: Record<string, unknown> = {},
  url = MCP_URL,
  extraHeaders: Record<string, string> = {},
) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "mcp-protocol-version": "2026-07-28",
    "mcp-method": method,
  };
  if (typeof params.name === "string") headers["mcp-name"] = params.name;
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  Object.assign(headers, extraHeaders);
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params: {
        ...params,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientCapabilities": clientCapabilities,
          "io.modelcontextprotocol/clientInfo": clientInfo,
        },
      },
    }),
  });
  const text = await res.text();
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, headers: res.headers, body };
}
