import {
  createMcpExpressApp,
  getOAuthProtectedResourceMetadataUrl,
  requireBearerAuth,
} from "@modelcontextprotocol/express";
import { toNodeHandler } from "@modelcontextprotocol/node";
import type express from "express";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { auditRefusals, withAudit } from "./audit.js";
import { withPolicy } from "./authz.js";
import { principal, verifier } from "./auth.js";
import { config, SCOPES } from "./config.js";
import { redis } from "./redis.js";
import { stateCodec } from "./requestState.js";
import { pool } from "./db.js";
import { registerAdminTools } from "./tools/admin.js";
import { registerCustomerTools } from "./tools/customers.js";
import { registerEmailTools } from "./tools/email.js";
import { rateLimitPerTenant } from "./ratelimit.js";
import { registerPaymentTools } from "./tools/payments.js";
import { registerQuoteTools } from "./tools/quotes.js";

// A fresh McpServer for every request: nothing survives between calls in this process.
// Anything that must survive goes to Redis (or Postgres later).
const handler = createMcpHandler(
  ({ authInfo }) => {
    // withAudit: every tool call gets a trace span and an audit row (step 09)
    // withPolicy: every tool call is checked by the PDP first (step 10)
    const server = withAudit(withPolicy(new McpServer(
      { name: "insurebot", version: "0.10.0" },
      {
        // The tool list will depend on who is asking (roles),
        // so it must never be stored by a shared cache (Lesson 2, Episode 6).
        cacheHints: { "tools/list": { ttlMs: 60_000, cacheScope: "private" } },
        // Every echoed MRTR requestState is checked BEFORE a tool runs:
        // signature, expiry, and that it belongs to this user (Episode 4)
        requestState: { verify: stateCodec.verify },
      },
    )));
    registerQuoteTools(server);
    registerPaymentTools(server);
    registerCustomerTools(server);
    registerEmailTools(server);
    // Admins get extra tools, so the tool list depends on who is asking (Episode 6)
    if (authInfo && principal(authInfo).roles.includes("admin")) registerAdminTools(server);
    return server;
  },
  { legacy: config.legacyMode, onerror: (err) => console.error("mcp error:", err.message) },
);

const app = createMcpExpressApp({ host: config.host, allowedHosts: config.allowedHosts });
const node = toNodeHandler(handler);
const resourceUrl = new URL(config.resourceUrl);
const metadataUrl = getOAuthProtectedResourceMetadataUrl(resourceUrl);

app.get("/healthz", async (_req, res) => {
  const redisOk = redis.isReady && (await redis.ping()) === "PONG";
  res.status(redisOk ? 200 : 503).json({ ok: redisOk, pod: config.podName });
});

// RFC 9728 Protected Resource Metadata: tells clients (Claude, Inspector)
// which login server issues tokens for InsureBot and which scopes exist.
app.get(new URL(metadataUrl).pathname, (_req, res) => {
  res.json({
    resource: config.resourceUrl,
    authorization_servers: [config.oidcIssuer],
    scopes_supported: SCOPES,
    bearer_methods_supported: ["header"],
    resource_name: "InsureBot",
  });
});

// Every MCP request needs a valid token: signature, iss, aud, exp (Lesson 3).
// On failure: 401 + WWW-Authenticate pointing at the metadata above.
const auth = requireBearerAuth({ verifier, expectedResource: resourceUrl, resourceMetadataUrl: metadataUrl });

// cacheScope: "private" lives INSIDE the JSON body, and HTTP caches (nginx, CDNs) never read it.
// Say it in HTTP too: every MCP response depends on the caller's token, so no shared cache may store it (Episode 6).
function noSharedCache(_req: express.Request, res: express.Response, next: express.NextFunction) {
  res.set("Cache-Control", "private, no-store");
  res.set("Vary", "Authorization");
  next();
}

// toNodeHandler forwards req.auth to tools as ctx.http.authInfo.
// The SDK also rejects requests whose Mcp-Method / Mcp-Name headers disagree with the body (-32020, Episode 7).
// Order matters: who are you (auth) → is your agency over its budget (rate limit) → MCP
// auditRefusals first, so 401 / 403 / 429 are recorded too
app.all("/mcp", auditRefusals, noSharedCache, auth, rateLimitPerTenant, (req, res) => void node(req, res, req.body));

await redis.connect();
const httpServer = app.listen(config.port, config.host, () => {
  console.log(`insurebot ${config.podName} listening on http://${config.host}:${config.port}/mcp`);
  console.log(`trusting tokens from ${config.oidcIssuer} for audience ${config.resourceUrl}`);
});

// Docker sends SIGTERM on stop: finish in-flight requests, then close Redis.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    httpServer.close(async () => {
      await redis.quit();
      await pool.end();
      process.exit(0);
    });
  });
}
