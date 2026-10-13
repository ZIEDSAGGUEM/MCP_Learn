import { NextResponse } from "next/server";
import { auditPool } from "@/lib/db";
import { handle, requireSession } from "@/lib/guard";

export const dynamic = "force-dynamic";

// The latest audit rows. ?mine=1 limits to your agency; ?trace=<id> finds one request.
export const GET = handle(async (req) => {
  const { session } = await requireSession();
  const q = new URL(req.url).searchParams;
  const where: string[] = [];
  const args: unknown[] = [];
  const trace = q.get("trace");
  if (trace && /^[0-9a-f]{32}$/.test(trace)) {
    args.push(trace);
    where.push(`trace_id = $${args.length}`);
  }
  if (q.get("mine") === "1") {
    args.push(session.claims.tenant);
    where.push(`tenant_id = $${args.length}`);
  }
  const { rows } = await auditPool().query(
    `SELECT id, at, pod, trace_id, tenant_id, left(sub, 8) AS sub, client_id, method, tool, arg_keys, outcome, duration_ms
       FROM audit_log ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY id DESC LIMIT 40`,
    args,
  );
  const { rows: totals } = await auditPool().query(
    `SELECT outcome, count(*)::int AS n FROM audit_log WHERE at > now() - interval '1 hour' GROUP BY outcome ORDER BY n DESC`,
  );
  return NextResponse.json({ rows, totals });
});
