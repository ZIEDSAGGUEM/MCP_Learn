// Step 08 tests: reports. A slow job behind a handle (Episode 8), an external command (Episode 18),
// and data that ends up in Excel (CSV formula injection).
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { gunzipSync } from "node:zlib";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { rawRequest, tokenFor } from "./helpers.js";

const ADMIN = "http://localhost:3002/mcp";
const PUBLIC = "http://localhost:3000/mcp";
const SUPERUSER_DB = process.env.SUPERUSER_DATABASE_URL ?? "postgres://postgres:devonly@127.0.0.1:5432/insurebot";

// Planted in Acme's customers for this file only
const SHELL_NAME = `Mallory $(touch /tmp/pwned) ; touch /tmp/pwned2 | \`touch /tmp/pwned3\``;
const FORMULA_NAME = `=HYPERLINK("http://mallory.test/steal","Click here")`;
const planted = [randomUUID(), randomUUID()];

let carol: string; // Acme admin
let erin: string; // Globex admin
let su: pg.Client;

beforeAll(async () => {
  carol = await tokenFor("carol", "quotes:read reports:admin");
  erin = await tokenFor("erin", "quotes:read reports:admin");
  su = new pg.Client({ connectionString: SUPERUSER_DB });
  await su.connect();
  await su.query(
    "INSERT INTO customers (id, tenant_id, name, email) VALUES ($1, 'acme', $2, 'x1@example.test'), ($3, 'acme', $4, 'x2@example.test')",
    [planted[0], SHELL_NAME, planted[1], FORMULA_NAME],
  );
});

afterAll(async () => {
  await su.query("DELETE FROM customers WHERE id = ANY($1)", [planted]);
  await su.end();
});

const call = (token: string, tool: string, args: Record<string, unknown>, url = ADMIN) =>
  rawRequest(token, "tools/call", { name: tool, arguments: args }, undefined, {}, url);

async function exportAndWait(token: string, format: "csv" | "csv.gz") {
  const started = await call(token, "export_report", { format });
  const reportId: string = started.body.result.structuredContent.reportId;
  for (let i = 0; i < 40; i++) {
    const res = await call(token, "get_report", { report_id: reportId });
    if (res.body.result.structuredContent?.status === "ready") return { reportId, started, res };
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("report never became ready");
}

describe("Step 08: a slow job behind a handle", () => {
  test("export starts as 'running', becomes 'ready', and lists only Acme's customers", async () => {
    const { started, res } = await exportAndWait(carol, "csv");
    expect(started.body.result.structuredContent.status).toBe("running");
    const csv: string = res.body.result.content[0].text;
    expect(csv).toContain('"acme"');
    expect(csv).toContain('"Jean Dupont"');
    expect(csv).not.toContain("Paul Dupont"); // Globex (RLS)
    expect(csv).not.toContain("Ada Lovelace");
  });

  test("Episode 8: Erin (Globex admin) with Carol's report ID gets 'Report not found'", async () => {
    const { reportId } = await exportAndWait(carol, "csv");
    const res = await call(erin, "get_report", { report_id: reportId });
    expect(res.body.result.content).toEqual([{ type: "text", text: "Report not found" }]);
  });

  test("report IDs are random and the tool only exists for admins", async () => {
    const alice = await tokenFor("alice", "quotes:read reports:admin");
    const res = await call(alice, "export_report", { format: "csv" });
    expect(res.body.result?.isError ?? !!res.body.error).toBe(true);
    const ids = new Set<string>();
    for (let i = 0; i < 5; i++) ids.add((await call(carol, "export_report", { format: "csv" })).body.result.structuredContent.reportId);
    expect(ids.size).toBe(5);
    for (const id of ids) expect(id).toMatch(/^r_[A-Za-z0-9_-]{32}$/);
  });

  test("the public entrance blocks report tools (WAF)", async () => {
    expect((await call(carol, "export_report", { format: "csv" }, PUBLIC)).status).toBe(403);
    expect((await call(carol, "get_report", { report_id: "r_" + "A".repeat(32) }, PUBLIC)).status).toBe(403);
  });
});

describe("Step 08: Episode 18, command injection", () => {
  test("format is an allowlist: 'csv; touch /tmp/pwned' is rejected before anything runs", async () => {
    for (const format of ["csv; touch /tmp/pwned", "csv.gz && id", "$(id)", "--help"]) {
      const res = await call(carol, "export_report", { format });
      expect(res.body.result.isError).toBe(true);
    }
  });

  test("a customer named '$(touch /tmp/pwned) ; …' goes through gzip as plain data", async () => {
    const { res } = await exportAndWait(carol, "csv.gz");
    const blob = res.body.result.content[0].resource;
    expect(blob.mimeType).toBe("application/gzip");
    const csv = gunzipSync(Buffer.from(blob.blob, "base64")).toString("utf8");
    expect(csv).toContain("$(touch /tmp/pwned)"); // the name survived, as text

    // ...and nothing ran on any of the 3 pods
    for (const index of [1, 2, 3]) {
      const out = execFileSync(
        "docker",
        ["compose", "exec", "-T", "--index", String(index), "insurebot", "sh", "-c", "ls /tmp/pwned /tmp/pwned2 /tmp/pwned3 2>/dev/null | wc -l"],
        { encoding: "utf8" },
      );
      expect(out.trim()).toBe("0");
    }
  });
});

describe("Step 08: CSV formula injection", () => {
  test("a customer named =HYPERLINK(...) is written as text, not as a formula", async () => {
    const { res } = await exportAndWait(carol, "csv");
    const csv: string = res.body.result.content[0].text;
    expect(csv).toContain(`"'=HYPERLINK(""http://mallory.test/steal"",""Click here"")"`); // leading ' = text in Excel
    expect(csv).not.toMatch(/(^|,)"=HYPERLINK/m);
  });
});
