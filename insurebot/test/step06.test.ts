// Step 06 tests: tenant isolation in Postgres with row-level security.
// Two levels: through MCP (what Claude would do), and straight in the database (what RLS does by itself).
import type { Client } from "@modelcontextprotocol/client";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { connect, tokenFor } from "./helpers.js";

try {
  process.loadEnvFile(".env"); // DATABASE_URL (insurebot_app) for the database-level tests
} catch {}
const APP_DB = process.env.DATABASE_URL ?? "";
const SUPERUSER_DB = process.env.SUPERUSER_DATABASE_URL ?? "postgres://postgres:devonly@127.0.0.1:5432/insurebot";

type Found = { customers: { id: string; name: string; city: string | null }[] };
let alice: Client, bob: Client;

beforeAll(async () => {
  alice = await connect(await tokenFor("alice", "quotes:read"));
  bob = await connect(await tokenFor("bob", "quotes:read"));
});
afterAll(async () => {
  await Promise.all([alice?.close(), bob?.close()]);
});

const search = async (client: Client, args: Record<string, unknown>) =>
  (await client.callTool({ name: "search_customers", arguments: args })).structuredContent as Found;
const names = (f: Found) => f.customers.map((c) => c.name).sort();

describe("Step 06: search_customers only sees your own agency", () => {
  test("'Dupont' exists in both agencies: Alice gets Acme's, Bob gets Globex's", async () => {
    expect(names(await search(alice, { name: "Dupont" }))).toEqual(["Jean Dupont"]);
    expect(names(await search(bob, { name: "Dupont" }))).toEqual(["Paul Dupont"]);
  });

  test("Episode 17: a Globex-only customer is invisible to Alice", async () => {
    expect(names(await search(alice, { name: "Lovelace" }))).toEqual([]);
    expect(names(await search(bob, { name: "Lovelace" }))).toEqual(["Ada Lovelace"]);
  });

  test("Episode 17: Alice (or an injected prompt) passes tenant_id: 'globex' → ignored", async () => {
    expect(names(await search(alice, { name: "Dupont", tenant_id: "globex", tenant: "globex" }))).toEqual(["Jean Dupont"]);
  });

  test("Episode 15: SQL injection in the name is just text", async () => {
    expect(names(await search(alice, { name: "x' OR 1=1 --" }))).toEqual([]);
    expect(names(await search(alice, { name: "' OR tenant_id='globex" }))).toEqual([]);
  });

  test("LIKE wildcards are literal: '%%' doesn't list everyone", async () => {
    expect(names(await search(alice, { name: "%%" }))).toEqual([]);
  });

  test("LLM02: results carry no email and no notes", async () => {
    const found = await search(alice, { name: "Jean" });
    expect(found.customers[0]).not.toHaveProperty("email");
    expect(found.customers[0]).not.toHaveProperty("notes");
  });
});

describe("Step 06: what RLS does inside Postgres (as insurebot_app)", () => {
  let db: pg.Client;
  beforeAll(async () => {
    db = new pg.Client({ connectionString: APP_DB });
    await db.connect();
  });
  afterAll(async () => {
    await db?.end();
  });

  // Run statements as one tenant, then roll back so nothing is left behind
  async function asTenant<T>(tenant: string, fn: () => Promise<T>): Promise<T> {
    await db.query("BEGIN");
    try {
      await db.query("SELECT set_config('app.tenant_id', $1, true)", [tenant]);
      return await fn();
    } finally {
      await db.query("ROLLBACK");
    }
  }

  test("no tenant set → zero rows (fails closed)", async () => {
    const { rowCount } = await db.query("SELECT * FROM customers");
    expect(rowCount).toBe(0);
  });

  test("a buggy query with no WHERE still returns only the current tenant's rows", async () => {
    const rows = await asTenant("acme", async () => (await db.query("SELECT DISTINCT tenant_id FROM customers")).rows);
    expect(rows).toEqual([{ tenant_id: "acme" }]);
  });

  test("acting as Acme, inserting a Globex row → rejected", async () => {
    await expect(
      asTenant("acme", () => db.query("INSERT INTO customers (tenant_id, name, email) VALUES ('globex', 'Sneaky', 'x@example.test')")),
    ).rejects.toThrow(/row-level security/);
  });

  test("acting as Acme, moving a customer to Globex → rejected", async () => {
    await expect(
      asTenant("acme", () => db.query("UPDATE customers SET tenant_id = 'globex' WHERE name = 'Jean Dupont'")),
    ).rejects.toThrow(/row-level security/);
  });

  test("the app role can't delete, and can't switch RLS off", async () => {
    await expect(asTenant("acme", () => db.query("DELETE FROM customers"))).rejects.toThrow(/permission denied/);
    await expect(db.query("ALTER TABLE customers DISABLE ROW LEVEL SECURITY")).rejects.toThrow(/must be owner/);
  });

  test("the tenant doesn't survive the transaction (safe connection pooling)", async () => {
    await asTenant("acme", async () => {});
    const { rows } = await db.query("SELECT coalesce(current_setting('app.tenant_id', true), '') AS t");
    expect(rows[0].t).toBe("");
  });
});

describe("Step 06: why FORCE and the separate app role matter", () => {
  let su: pg.Client;
  beforeAll(async () => {
    su = new pg.Client({ connectionString: SUPERUSER_DB });
    await su.connect();
  });
  afterAll(async () => {
    await su?.end();
  });

  test("with FORCE, even the table owner sees zero rows without a tenant", async () => {
    await su.query("BEGIN");
    try {
      await su.query("SET LOCAL ROLE insurebot_owner");
      expect((await su.query("SELECT * FROM customers")).rowCount).toBe(0);
    } finally {
      await su.query("ROLLBACK");
    }
  });

  test("WITHOUT FORCE, the owner sees every agency's rows (what the plan warned about)", async () => {
    await su.query("BEGIN"); // DDL is transactional in Postgres: rolled back below, nothing changes for real
    try {
      await su.query("ALTER TABLE customers NO FORCE ROW LEVEL SECURITY");
      await su.query("SET LOCAL ROLE insurebot_owner");
      const { rows } = await su.query("SELECT DISTINCT tenant_id FROM customers ORDER BY 1");
      expect(rows.map((r) => r.tenant_id)).toEqual(["acme", "globex"]);
    } finally {
      await su.query("ROLLBACK");
    }
  });

  test("a superuser bypasses RLS completely: never connect the app as postgres", async () => {
    const { rows } = await su.query("SELECT DISTINCT tenant_id FROM customers ORDER BY 1");
    expect(rows.map((r) => r.tenant_id)).toEqual(["acme", "globex"]);
  });
});
