import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Principal } from "./auth.js";
import { config } from "./config.js";
import { withTenant } from "./db.js";
import type { Quote } from "./quotes.js";
import { redis } from "./redis.js";

const run = promisify(execFile);

export type ReportFormat = "csv" | "csv.gz";
export type Report =
  | { status: "running"; format: ReportFormat; createdAt: string }
  | { status: "failed"; format: ReportFormat; createdAt: string }
  | { status: "ready"; format: ReportFormat; createdAt: string; rows: number; dataBase64: string };

export const REPORT_ID_PATTERN = /^r_[A-Za-z0-9_-]{32}$/;
const TTL_SECONDS = 3600;

// A report ID is a handle, exactly like a quote ID (Episode 8): random, bound to its owner, expiring.
// Stored in Redis, not on the pod's disk, so any pod can answer get_report.
const key = (owner: Principal, id: string) => `report:${owner.tenant}:${owner.sub}:${id}`;

export async function loadReport(owner: Principal, id: string): Promise<Report | null> {
  const raw = await redis.get(key(owner, id));
  return raw ? (JSON.parse(raw) as Report) : null;
}

/** Starts building a report in the background and returns its ID at once. */
export async function startReport(owner: Principal, format: ReportFormat): Promise<string> {
  const id = "r_" + randomBytes(24).toString("base64url");
  const createdAt = new Date().toISOString();
  await redis.set(key(owner, id), JSON.stringify({ status: "running", format, createdAt } satisfies Report), { EX: TTL_SECONDS });

  // Not awaited: the tool call returns now, the client polls get_report
  void build(owner, format)
    .then(({ rows, data }) => ({ status: "ready", format, createdAt, rows, dataBase64: data.toString("base64") }) satisfies Report)
    .catch((err) => {
      console.error("report failed:", err instanceof Error ? err.message : err);
      return { status: "failed", format, createdAt } satisfies Report;
    })
    .then((report) => redis.set(key(owner, id), JSON.stringify(report), { EX: TTL_SECONDS }));
  return id;
}

async function build(owner: Principal, format: ReportFormat): Promise<{ rows: number; data: Buffer }> {
  if (config.reportDelayMs > 0) await new Promise((r) => setTimeout(r, config.reportDelayMs)); // "it's slow"

  // Customers come through RLS: only the admin's own agency
  const { rows: customers } = await withTenant(owner, (db) =>
    db.query<{ name: string; city: string | null; created_at: Date }>("SELECT name, city, created_at FROM customers ORDER BY name"),
  );
  let openQuotes = 0;
  let monthlyEur = 0;
  for await (const keys of redis.scanIterator({ MATCH: `quote:${owner.tenant}:*`, COUNT: 200 })) {
    for (const k of keys) {
      const raw = await redis.get(k);
      if (raw) {
        openQuotes++;
        monthlyEur += (JSON.parse(raw) as Quote).priceEur;
      }
    }
  }

  const lines = [
    ["agency", "open_quotes", "monthly_premium_eur"].map(csvCell).join(","),
    [owner.tenant, String(openQuotes), monthlyEur.toFixed(2)].map(csvCell).join(","),
    "",
    ["customer", "city", "since"].map(csvCell).join(","),
    ...customers.map((c) => [c.name, c.city ?? "", c.created_at.toISOString().slice(0, 10)].map(csvCell).join(",")),
  ];
  const csv = Buffer.from(lines.join("\n") + "\n", "utf8");
  if (format === "csv") return { rows: customers.length, data: csv };
  return { rows: customers.length, data: await gzip(csv) };
}

/**
 * Compress with the system gzip (Episode 18: the classic place for command injection).
 *  - execFile, never exec: no shell, so ; | $( ) ` in data are just bytes
 *  - fixed program, fixed flags, "--" before the path: nothing from the user becomes an option
 *  - the path is ours (random temp dir), never built from user input
 */
async function gzip(data: Buffer): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "insurebot-report-"));
  const file = join(dir, "report.csv");
  try {
    await writeFile(file, data);
    const { stdout } = await run("gzip", ["-n", "-c", "--", file], { encoding: "buffer", maxBuffer: 20 * 1024 * 1024, timeout: 10_000 });
    return stdout;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * CSV formula injection: a customer named =HYPERLINK("http://mallory.test","Click") would become
 * a live formula when an admin opens the report in Excel. Prefix such cells with ' so they stay text.
 */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}
