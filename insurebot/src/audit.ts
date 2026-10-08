import type { AuthInfo, McpServer } from "@modelcontextprotocol/server";
import { context, propagation, SpanStatusCode, trace, type Context } from "@opentelemetry/api";
import type express from "express";
import { POLICY_DENIED } from "./authz.js";
import { config } from "./config.js";
import { pool } from "./db.js";

const tracer = trace.getTracer("insurebot");

type AuditRow = {
  traceId?: string;
  tenant?: string;
  sub?: string;
  clientId?: string;
  method?: string;
  tool?: string;
  argKeys?: string[];
  outcome: "ok" | "error" | "input_required" | "policy_denied" | "unauthenticated" | "forbidden" | "rate_limited";
  durationMs?: number;
};

/** Append one row. The app's DB role can only INSERT into audit_log (db/004_audit.sql). */
async function writeAudit(row: AuditRow) {
  try {
    await pool.query(
      `INSERT INTO audit_log (pod, trace_id, tenant_id, sub, client_id, method, tool, arg_keys, outcome, duration_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [config.podName, row.traceId ?? null, row.tenant ?? null, row.sub ?? null, row.clientId ?? null, row.method ?? null,
       row.tool ?? null, row.argKeys ?? null, row.outcome, row.durationMs ?? null],
    );
  } catch (err) {
    // Never crash a request because the audit write failed, but make it loud
    console.error("AUDIT WRITE FAILED:", err instanceof Error ? err.message : err);
  }
}

function who(authInfo: AuthInfo | undefined) {
  const extra = authInfo?.extra as { sub?: string; tenant?: string } | undefined;
  return { sub: extra?.sub, tenant: extra?.tenant, clientId: authInfo?.clientId || undefined };
}

/**
 * Wrap every tool registered on this server: one trace span + one audit row per call.
 * Done once here, so a new tool can't "forget" to be audited (MCP08).
 */
export function withAudit(server: McpServer): McpServer {
  const register = server.registerTool.bind(server) as (...a: unknown[]) => unknown;
  (server as unknown as { registerTool: unknown }).registerTool = (name: string, cfg: unknown, cb: Function) =>
    register(name, cfg, async (args: Record<string, unknown>, ctx: any) => {
      const started = Date.now();
      const caller = who(ctx?.http?.authInfo);
      // Continue the client's trace if it sent one in _meta (MCP 2026-07-28 convention),
      // otherwise continue the HTTP request's trace (traceparent header)
      const meta = ctx?.mcpReq?._meta as Record<string, unknown> | undefined;
      const parent: Context =
        typeof meta?.traceparent === "string"
          ? propagation.extract(context.active(), { traceparent: meta.traceparent, tracestate: meta.tracestate })
          : context.active();

      return tracer.startActiveSpan(
        `tool ${name}`,
        // Attributes: who and what, never argument values (no PII in traces)
        { attributes: { "mcp.tool": name, "insurebot.tenant": caller.tenant ?? "", "mcp.arg_keys": Object.keys(args ?? {}) } },
        parent,
        async (span) => {
          let outcome: AuditRow["outcome"] = "ok";
          try {
            const result = await cb(args, ctx);
            if (result?.[POLICY_DENIED]) outcome = "policy_denied";
            else if (result?.resultType === "input_required") outcome = "input_required";
            else if (result?.isError) outcome = "error";
            return result;
          } catch (err) {
            outcome = "error";
            span.recordException(err as Error);
            throw err;
          } finally {
            span.setAttribute("insurebot.outcome", outcome);
            if (outcome === "error") span.setStatus({ code: SpanStatusCode.ERROR });
            span.end();
            await writeAudit({
              traceId: span.spanContext().traceId,
              ...caller,
              method: "tools/call",
              tool: name,
              argKeys: Object.keys(args ?? {}).sort(),
              outcome,
              durationMs: Date.now() - started,
            });
          }
        },
      );
    });
  return server;
}

const DENIED: Record<number, AuditRow["outcome"]> = { 401: "unauthenticated", 403: "forbidden", 429: "rate_limited" };

/**
 * Requests refused BEFORE a tool runs (no token, missing scope, over the rate limit) are audited too:
 * a burst of 401s or 403s is often the first sign of an attack.
 */
export function auditRefusals(req: express.Request, res: express.Response, next: express.NextFunction) {
  const started = Date.now();
  const traceId = trace.getSpan(context.active())?.spanContext().traceId;
  res.on("finish", () => {
    const outcome = DENIED[res.statusCode];
    if (!outcome) return;
    void writeAudit({
      traceId,
      ...who(req.auth),
      method: req.get("mcp-method") ?? undefined,
      tool: req.get("mcp-name") ?? undefined,
      outcome,
      durationMs: Date.now() - started,
    });
  });
  next();
}
