// Step 09 tests: audit log + tracing (MCP08, Episode 19), and no secrets or medical data in logs/traces (MCP01, LLM02).
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { rawRequest, tokenFor } from "./helpers.js";

try {
  process.loadEnvFile(".env");
} catch {}
const ADMIN = "http://localhost:3002/mcp";
const PUBLIC = "http://localhost:3000/mcp";
const JAEGER = process.env.JAEGER_URL ?? "http://localhost:16686";
const SUPERUSER_DB = process.env.SUPERUSER_DATABASE_URL ?? "postgres://postgres:devonly@127.0.0.1:5432/insurebot";

type AuditRow = { tenant_id: string | null; sub: string | null; client_id: string | null; tool: string | null; arg_keys: string[] | null; outcome: string; pod: string; trace_id: string };

let su: pg.Client; // reads the audit log, like an auditor would
let alice: string, carol: string;
const subOf = (token: string) => JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).sub as string;

beforeAll(async () => {
  su = new pg.Client({ connectionString: SUPERUSER_DB });
  await su.connect();
  alice = await tokenFor("alice", "quotes:read quotes:write payments:charge");
  carol = await tokenFor("carol", "quotes:read reports:admin");
});
afterAll(async () => {
  await su?.end();
});

/** A W3C traceparent header, so the test knows the trace ID the server will use. */
function newTrace() {
  const traceId = randomBytes(16).toString("hex");
  return { traceId, header: { traceparent: `00-${traceId}-${randomBytes(8).toString("hex")}-01` } };
}

const call = (token: string | undefined, tool: string, args: Record<string, unknown>, headers: Record<string, string>, url = PUBLIC, caps = {}) =>
  rawRequest(token, "tools/call", { name: tool, arguments: args }, undefined, caps, url, headers);

async function auditRows(traceId: string): Promise<AuditRow[]> {
  for (let i = 0; i < 20; i++) {
    const { rows } = await su.query<AuditRow>("SELECT * FROM audit_log WHERE trace_id = $1 ORDER BY id", [traceId]);
    if (rows.length) return rows;
    await new Promise((r) => setTimeout(r, 100));
  }
  return [];
}

async function jaegerTrace(traceId: string, wantSpan: string): Promise<{ spans: { operationName: string }[] }> {
  for (let i = 0; i < 40; i++) {
    const res = await fetch(`${JAEGER}/api/traces/${traceId}`);
    if (res.ok) {
      const t = ((await res.json()) as { data: { spans: { operationName: string }[] }[] }).data[0];
      if (t?.spans.some((s) => s.operationName === wantSpan)) return t;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`trace ${traceId} with span "${wantSpan}" not found in Jaeger`);
}

describe("Step 09: every tool call is audited", () => {
  test("start_quote → one row: who, which agency, which app, argument NAMES only, outcome", async () => {
    const t = newTrace();
    await call(alice, "start_quote", { age: 42, smoker: false, conditions: ["diabetes"] }, t.header);
    const [row] = await auditRows(t.traceId);
    expect(row).toMatchObject({
      tenant_id: "acme",
      sub: subOf(alice),
      client_id: "insurebot-tests",
      tool: "start_quote",
      arg_keys: ["age", "conditions", "smoker"],
      outcome: "ok",
    });
    expect(row.pod).toBeTruthy();
    expect(JSON.stringify(row)).not.toContain("diabetes"); // names, not values
  });

  test("a confirmation round is recorded as input_required", async () => {
    const created = await call(alice, "start_quote", { age: 30, smoker: false }, {});
    const quoteId = created.body.result.structuredContent.quoteId;
    const t = newTrace();
    await call(alice, "charge_premium", { quote_id: quoteId }, t.header, PUBLIC, { elicitation: { form: {} } });
    expect((await auditRows(t.traceId))[0].outcome).toBe("input_required");
  });
});

describe("Step 09: refused requests are audited too", () => {
  test("no token → 'unauthenticated', with the tool it tried", async () => {
    const t = newTrace();
    const res = await call(undefined, "get_quote", { quote_id: "q_" + "A".repeat(32) }, t.header);
    expect(res.status).toBe(401);
    expect(await auditRows(t.traceId)).toMatchObject([{ outcome: "unauthenticated", tool: "get_quote", sub: null }]);
  });

  test("missing scope → 'forbidden', and we know who tried", async () => {
    const readOnly = await tokenFor("alice", "quotes:read");
    const t = newTrace();
    const res = await call(readOnly, "start_quote", { age: 40, smoker: false }, t.header);
    expect(res.status).toBe(403);
    expect(await auditRows(t.traceId)).toMatchObject([{ outcome: "forbidden", tool: "start_quote", sub: subOf(readOnly), tenant_id: "acme" }]);
  });
});

describe("Step 09: Episode 19, 'who exported Acme's data?'", () => {
  test("the audit log names Carol, and Jaeger shows the same request down to the SQL", async () => {
    const t = newTrace();
    await call(carol, "export_report", { format: "csv" }, t.header, ADMIN);

    const [row] = await auditRows(t.traceId);
    expect(row).toMatchObject({ tool: "export_report", tenant_id: "acme", sub: subOf(carol), outcome: "ok" });

    // Same trace ID in Jaeger: HTTP → tool → the report's SQL (runs in the background, same trace)
    const trace = await jaegerTrace(t.traceId, "pg.query:COMMIT insurebot");
    const ops = trace.spans.map((s) => s.operationName);
    expect(ops).toContain("POST /mcp");
    expect(ops).toContain("tool export_report");
    expect(ops.some((o) => o.startsWith("pg.query:SELECT"))).toBe(true);
  }, 20_000); // spans reach Jaeger in batches

  test("the auditor's question, answered with one query", async () => {
    const { rows } = await su.query(
      `SELECT sub, client_id, count(*)::int AS exports, max(at) AS last
         FROM audit_log
        WHERE tenant_id = 'acme' AND tool = 'export_report' AND outcome = 'ok' AND at > now() - interval '1 day'
        GROUP BY sub, client_id`,
    );
    expect(rows.map((r) => r.sub)).toContain(subOf(carol));
  });
});

describe("Step 09: the audit log can't be tampered with by the app", () => {
  test("insurebot_app can INSERT, but not read, change or delete audit rows", async () => {
    const app = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await app.connect();
    try {
      await expect(app.query("SELECT * FROM audit_log LIMIT 1")).rejects.toThrow(/permission denied/);
      await expect(app.query("UPDATE audit_log SET outcome = 'ok'")).rejects.toThrow(/permission denied/);
      await expect(app.query("DELETE FROM audit_log")).rejects.toThrow(/permission denied/);
      await expect(app.query("TRUNCATE audit_log")).rejects.toThrow(/permission denied/);
    } finally {
      await app.end();
    }
  });
});

describe("Step 09: no secrets or medical data in traces and logs (MCP01, LLM02)", () => {
  test("a trace of start_quote holds no diagnosis, no token", async () => {
    const canary = `dx-${randomBytes(8).toString("hex")}`; // ≤ 40 chars: start_quote's schema limit
    const t = newTrace();
    const res = await call(alice, "start_quote", { age: 50, smoker: false, conditions: [canary] }, t.header);
    expect(res.body.result.isError).toBeFalsy(); // the tool really ran
    const trace = await jaegerTrace(t.traceId, "tool start_quote");
    const json = JSON.stringify(trace);
    expect(json).not.toContain(canary);
    expect(json).not.toContain("eyJ"); // JWT prefix
    expect(json).not.toMatch(/bearer/i);
  }, 20_000);

  test("container logs hold no tokens, keys, passwords or diagnoses", async () => {
    const logs = execFileSync("docker", ["compose", "logs", "--no-log-prefix", "insurebot", "gateway", "payco"], {
      encoding: "utf8",
      maxBuffer: 50 * 1024 * 1024,
    });
    expect(logs).not.toContain("eyJ");
    expect(logs).not.toContain("diabetes");
    for (const secret of [process.env.PAYCO_API_KEY, process.env.REQUEST_STATE_KEY, process.env.INSUREBOT_APP_PASSWORD]) {
      expect(secret).toBeTruthy();
      expect(logs).not.toContain(secret!);
    }
  });
});
