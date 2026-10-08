import type { McpServer } from "@modelcontextprotocol/server";
import type { Principal } from "./auth.js";
import { principal } from "./auth.js";
import { config } from "./config.js";

/** Marks a result as "refused by policy" for the audit log. A Symbol never reaches the JSON on the wire. */
export const POLICY_DENIED = Symbol.for("insurebot.policyDenied");

type Value = string | number | boolean | string[];
export type Resource = { type: "agency" | "quote" | "customer"; id: string; properties: Record<string, Value> & { tenant: string } };

/**
 * Ask the PDP (AuthZEN). InsureBot is the PEP: it enforces what the PDP decides.
 * FAIL CLOSED: if the PDP is down, slow or answers anything odd, the answer is "no".
 */
export async function authorize(who: Principal, action: string, resource: Resource, context: Record<string, Value> = {}) {
  try {
    const res = await fetch(`${config.pdpUrl}/access/v1/evaluation`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${config.pdpApiKey}` },
      body: JSON.stringify({
        subject: { type: "user", id: who.sub, properties: { tenant: who.tenant, roles: who.roles } },
        action: { name: action },
        resource,
        context,
      }),
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) throw new Error(`PDP answered HTTP ${res.status}`);
    const body = (await res.json()) as { decision?: unknown; context?: { reasons?: string[] } };
    return { allowed: body.decision === true, reasons: body.context?.reasons ?? [] };
  } catch (err) {
    console.error("PDP unavailable, denying:", err instanceof Error ? err.message : err);
    return { allowed: false, reasons: ["pdp_unavailable"] };
  }
}

export function policyDenied(message = "Not allowed by policy.") {
  return { content: [{ type: "text" as const, text: message }], isError: true, [POLICY_DENIED]: true };
}

/**
 * Every tool call is checked against the policies first: action = tool name, resource = the caller's agency.
 * Tools that need finer rules (amount of a quote, recipient of an email) ask again with a specific resource.
 */
export function withPolicy(server: McpServer): McpServer {
  const register = server.registerTool.bind(server) as (...a: unknown[]) => unknown;
  (server as unknown as { registerTool: unknown }).registerTool = (name: string, cfg: unknown, cb: Function) =>
    register(name, cfg, async (args: unknown, ctx: any) => {
      const who = principal(ctx?.http?.authInfo);
      const { allowed } = await authorize(who, name, { type: "agency", id: who.tenant, properties: { tenant: who.tenant } });
      if (!allowed) return policyDenied();
      return cb(args, ctx);
    });
  return server;
}
