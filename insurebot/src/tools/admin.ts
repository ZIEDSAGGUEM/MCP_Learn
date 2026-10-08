import { requireScopes, type McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { principal } from "../auth.js";
import { redis } from "../redis.js";
import type { Quote } from "../quotes.js";
import { loadReport, REPORT_ID_PATTERN, startReport } from "../reports.js";

// "Admins only" is no longer checked here: it's the policy "admin-tools-need-admin" in policy/insurebot.cedar,
// enforced for every tool by withPolicy (step 10). Registration below still hides these tools from non-admins.

/**
 * Admin-only tools. Registered only for callers with the "admin" realm role,
 * so admins and agents get DIFFERENT tool lists. That's why tools/list must
 * never be cached by a shared cache (Episode 6).
 */
export function registerAdminTools(server: McpServer) {
  server.registerTool(
    "agency_stats",
    {
      title: "Agency statistics",
      description: "Admins only: number of open quotes and their total monthly premium for your agency.",
      inputSchema: z.object({}),
      outputSchema: z.object({ tenant: z.string(), openQuotes: z.number(), totalMonthlyEur: z.number() }),
      // Any user can ASK Keycloak for reports:admin (scopes aren't role-restricted),
      // so the scope alone isn't enough: the role is checked too, by the policy (MCP02: scope creep).
      scopeChallenge: requireScopes("reports:admin"),
    },
    async (_args, ctx) => {
      const who = principal(ctx.http?.authInfo);
      // Only the caller's own agency: the tenant comes from the token
      let openQuotes = 0;
      let totalMonthlyEur = 0;
      for await (const keys of redis.scanIterator({ MATCH: `quote:${who.tenant}:*`, COUNT: 200 })) {
        for (const key of keys) {
          const raw = await redis.get(key);
          if (!raw) continue;
          openQuotes++;
          totalMonthlyEur += (JSON.parse(raw) as Quote).priceEur;
        }
      }
      const output = { tenant: who.tenant, openQuotes, totalMonthlyEur: Math.round(totalMonthlyEur * 100) / 100 };
      return {
        content: [{ type: "text", text: `${who.tenant}: ${openQuotes} open quotes, €${output.totalMonthlyEur}/month in total` }],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    "export_report",
    {
      title: "Export agency report",
      description: "Admins only: start building a CSV report of your agency. Returns a report ID; fetch it with get_report.",
      // An allowlist, not free text: nothing the model types can reach the gzip command line (Episode 18)
      inputSchema: z.object({ format: z.enum(["csv", "csv.gz"]).default("csv") }),
      outputSchema: z.object({ reportId: z.string(), status: z.literal("running") }),
      scopeChallenge: requireScopes("reports:admin"),
    },
    async ({ format }, ctx) => {
      const who = principal(ctx.http?.authInfo);
      const reportId = await startReport(who, format);
      return {
        content: [{ type: "text", text: `Report ${reportId} is being built. Call get_report to fetch it.` }],
        structuredContent: { reportId, status: "running" as const },
      };
    },
  );

  server.registerTool(
    "get_report",
    {
      title: "Get report",
      description: "Admins only: check or download a report you started with export_report.",
      inputSchema: z.object({ report_id: z.string().regex(REPORT_ID_PATTERN, "Not a valid report ID") }),
      outputSchema: z.object({
        status: z.enum(["running", "ready", "failed"]),
        format: z.string(),
        rows: z.number().optional(),
        bytes: z.number().optional(),
      }),
      scopeChallenge: requireScopes("reports:admin"),
    },
    async ({ report_id }, ctx) => {
      const who = principal(ctx.http?.authInfo);
      // Looked up under the CALLER's tenant and user: another admin's report ID finds nothing (Episode 8)
      const report = await loadReport(who, report_id);
      if (!report) return { content: [{ type: "text", text: "Report not found" }], isError: true };
      if (report.status !== "ready") {
        return {
          content: [{ type: "text", text: `Report is ${report.status}.` }],
          structuredContent: { status: report.status, format: report.format },
        };
      }
      const data = Buffer.from(report.dataBase64, "base64");
      const meta = { status: "ready" as const, format: report.format, rows: report.rows, bytes: data.length };
      if (report.format === "csv") {
        return { content: [{ type: "text", text: data.toString("utf8") }], structuredContent: meta };
      }
      return {
        content: [
          {
            type: "resource",
            resource: { uri: `insurebot://reports/${report_id}.csv.gz`, mimeType: "application/gzip", blob: report.dataBase64 },
          },
        ],
        structuredContent: meta,
      };
    },
  );
}
