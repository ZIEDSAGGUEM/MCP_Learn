// Step 10 tests: policy as code. Cedar policies in policy/*.cedar, served by the PDP over AuthZEN.
import { rm, writeFile } from "node:fs/promises";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { rawRequest, tokenFor } from "./helpers.js";

try {
  process.loadEnvFile(".env");
} catch {}
const PDP = process.env.PDP_TEST_URL ?? "http://127.0.0.1:8181";
const PDP_KEY = process.env.PDP_API_KEY ?? "";
const ADMIN = "http://127.0.0.1:3002/mcp";
const SUPERUSER_DB = process.env.SUPERUSER_DATABASE_URL ?? "postgres://postgres:devonly@127.0.0.1:5432/insurebot";

type Props = Record<string, string | number | boolean | string[]>;
async function ask(subject: Props, action: string, resource: { type: string; id: string; properties: Props }, context: Props = {}) {
  const res = await fetch(`${PDP}/access/v1/evaluation`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${PDP_KEY}` },
    body: JSON.stringify({ subject: { type: "user", id: "u1", properties: subject }, action: { name: action }, resource, context }),
  });
  return (await res.json()) as { decision: boolean; context: { reasons: string[] } };
}
const agent = { tenant: "acme", roles: [] as string[] };
const admin = { tenant: "acme", roles: ["admin"] };
const acme = { type: "agency", id: "acme", properties: { tenant: "acme" } };
const quote = (cents: number) => ({ type: "quote", id: "q1", properties: { tenant: "acme", amountCents: cents } });
const customer = { type: "customer", id: "c1", properties: { tenant: "acme", email: "jean.dupont@example.test" } };

describe("Step 10: the policies themselves (asked directly over AuthZEN)", () => {
  test("only InsureBot may ask the PDP", async () => {
    const body = JSON.stringify({ subject: { type: "user", id: "x" }, action: { name: "a" }, resource: { type: "agency", id: "acme" } });
    const noKey = await fetch(`${PDP}/access/v1/evaluation`, { method: "POST", headers: { "content-type": "application/json" }, body });
    const wrongKey = await fetch(`${PDP}/access/v1/evaluation`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer not-the-key" },
      body,
    });
    expect([noKey.status, wrongKey.status]).toEqual([401, 401]);
  });

  test("AuthZEN discovery document", async () => {
    const res = await fetch(`${PDP}/.well-known/authzen-configuration`);
    expect(((await res.json()) as { access_evaluation_endpoint: string }).access_evaluation_endpoint).toMatch(/\/access\/v1\/evaluation$/);
  });

  test("same-agency: allowed on your agency, denied on another (default deny)", async () => {
    expect((await ask(agent, "start_quote", acme)).decision).toBe(true);
    const other = await ask(agent, "start_quote", { type: "agency", id: "globex", properties: { tenant: "globex" } });
    expect(other).toMatchObject({ decision: false, context: { reasons: [] } });
  });

  test("admin-tools-need-admin", async () => {
    for (const tool of ["agency_stats", "export_report", "get_report"]) {
      expect(await ask(agent, tool, acme)).toMatchObject({ decision: false, context: { reasons: ["admin-tools-need-admin"] } });
      expect((await ask(admin, tool, acme)).decision).toBe(true);
    }
  });

  test("big-premium-needs-admin: €455 denied for an agent, allowed for an admin; €50 fine for both", async () => {
    expect(await ask(agent, "charge_premium", quote(45500))).toMatchObject({ decision: false, context: { reasons: ["big-premium-needs-admin"] } });
    expect((await ask(admin, "charge_premium", quote(45500))).decision).toBe(true);
    expect((await ask(agent, "charge_premium", quote(5000))).decision).toBe(true);
    expect((await ask(agent, "charge_premium", quote(20000))).decision).toBe(true); // exactly €200 is allowed
  });

  test("email-only-to-customer: the recipient must be the customer's own address", async () => {
    expect((await ask(agent, "email_quote", customer, { recipient: "jean.dupont@example.test" })).decision).toBe(true);
    expect(await ask(agent, "email_quote", customer, { recipient: "backup@mallory.test" })).toMatchObject({
      decision: false,
      context: { reasons: ["email-only-to-customer"] },
    });
    expect((await ask(agent, "email_quote", customer)).decision).toBe(false); // no recipient given → deny
  });

  test("a malformed request is denied (400), never allowed", async () => {
    const res = await fetch(`${PDP}/access/v1/evaluation`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${PDP_KEY}` },
      body: JSON.stringify({ subject: { id: "x" } }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { decision: boolean }).decision).toBe(false);
  });
});

describe("Step 10: the business rule, end to end", () => {
  let su: pg.Client;
  beforeAll(async () => {
    su = new pg.Client({ connectionString: SUPERUSER_DB });
    await su.connect();
  });
  afterAll(async () => {
    await su?.end();
  });

  const CAN_ASK = { elicitation: { form: {} } };
  const expensive = { age: 99, smoker: true, conditions: ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"] }; // €455/month

  async function quoteFor(token: string) {
    const res = await rawRequest(token, "tools/call", { name: "start_quote", arguments: expensive });
    return res.body.result.structuredContent as { quoteId: string; priceEur: number };
  }

  test("Alice (agent) can't charge a €455 premium: refused before the user is even asked", async () => {
    const alice = await tokenFor("alice", "quotes:read quotes:write payments:charge");
    const { quoteId, priceEur } = await quoteFor(alice);
    expect(priceEur).toBeGreaterThan(200);
    const res = await rawRequest(alice, "tools/call", { name: "charge_premium", arguments: { quote_id: quoteId } }, undefined, CAN_ASK);
    expect(res.body.result.isError).toBe(true);
    expect(res.body.result.content[0].text).toContain("needs an admin");

    const { rows } = await su.query("SELECT outcome FROM audit_log WHERE tool = 'charge_premium' AND outcome = 'policy_denied' AND at > now() - interval '1 minute'");
    expect(rows.length).toBeGreaterThan(0); // the refusal is in the audit log
  });

  test("Carol (admin) can: the user is asked to confirm", async () => {
    const carol = await tokenFor("carol", "quotes:read quotes:write payments:charge");
    const { quoteId } = await quoteFor(carol);
    const res = await rawRequest(carol, "tools/call", { name: "charge_premium", arguments: { quote_id: quoteId } }, undefined, CAN_ASK);
    expect(res.body.result.resultType).toBe("input_required");
  });
});

describe("Step 10: changing a rule needs no redeploy", () => {
  const FREEZE = "policy/zz-test-freeze.cedar";
  const BROKEN = "policy/zz-test-broken.cedar";
  afterAll(async () => {
    await rm(FREEZE, { force: true });
    await rm(BROKEN, { force: true });
  });

  async function statsOutcome(token: string) {
    const res = await rawRequest(token, "tools/call", { name: "agency_stats", arguments: {} }, undefined, {}, ADMIN);
    return res.body.result?.isError ? "denied" : "ok";
  }
  async function waitFor(token: string, want: "ok" | "denied") {
    for (let i = 0; i < 30; i++) {
      if ((await statsOutcome(token)) === want) return want;
      await new Promise((r) => setTimeout(r, 250));
    }
    return statsOutcome(token);
  }

  test("drop in a rule that freezes Globex's stats → applies within seconds; remove it → back to normal", async () => {
    const erin = await tokenFor("erin", "quotes:read reports:admin"); // Globex admin
    expect(await statsOutcome(erin)).toBe("ok");

    await writeFile(
      FREEZE,
      `@id("test-freeze-globex-stats")\nforbid (principal, action == Action::"agency_stats", resource)\nwhen { principal.tenant == "globex" };\n`,
    );
    expect(await waitFor(erin, "denied")).toBe("denied");

    await rm(FREEZE);
    expect(await waitFor(erin, "ok")).toBe("ok");
  }, 30_000);

  test("a policy file with a typo is NOT loaded: the last good policies stay in force", async () => {
    const erin = await tokenFor("erin", "quotes:read reports:admin");
    await writeFile(BROKEN, `forbid (principal, action, resource) when { this is not cedar };\n`);
    await new Promise((r) => setTimeout(r, 3000)); // longer than one reload cycle
    expect(await statsOutcome(erin)).toBe("ok"); // still the old, good policies
    // and the typo didn't open anything either: an agent still can't use admin tools
    expect((await ask(agent, "export_report", acme)).decision).toBe(false);
    await rm(BROKEN);
  }, 30_000);
});
