// Step 01 checks, run against the gateway: docker compose up -d && npm test
// Since step 02 every call needs a token, so these run as Alice.
import type { Client } from "@modelcontextprotocol/client";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { connect, rawRequest, tokenFor, viaGateway } from "./helpers.js";

let client: Client;
let aliceToken: string;

beforeAll(async () => {
  aliceToken = await tokenFor("alice", "quotes:read quotes:write");
  client = await connect(aliceToken);
});

afterAll(async () => {
  await client?.close();
});

async function startQuote(args: Record<string, unknown>) {
  const res = await client.callTool({ name: "start_quote", arguments: args });
  return res.structuredContent as { quoteId: string; priceEur: number; servedBy: string };
}

describe("Step 01: stateless InsureBot", () => {
  test("lists the tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["charge_premium", "email_quote", "get_customer", "get_quote", "search_customers", "start_quote"]);
  });

  test("start_quote then get_quote returns the same quote", async () => {
    const created = await startQuote({ age: 42, smoker: false, conditions: ["diabetes"] });
    expect(created.quoteId).toMatch(/^q_[A-Za-z0-9_-]{32}$/);

    const res = await client.callTool({ name: "get_quote", arguments: { quote_id: created.quoteId } });
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent).toMatchObject({ priceEur: created.priceEur, conditionsDeclared: 1 });
  });

  test.runIf(viaGateway)("Episode 1: calls are spread across pods (no sticky sessions)", async () => {
    // Round-robin is shared by ALL traffic, and other test files run in parallel (the step 07 flood
    // sends 1300 requests), so we don't insist on hitting all 3 pods, only on not being pinned to one.
    const pods = new Set<string>();
    for (let i = 0; i < 30; i++) {
      pods.add((await startQuote({ age: 30 + (i % 40), smoker: false })).servedBy);
    }
    expect(pods.size).toBeGreaterThanOrEqual(2);
  });

  test.runIf(viaGateway)("a quote created on one pod is served by another (shared Redis)", async () => {
    const created = await startQuote({ age: 55, smoker: true, conditions: [] });
    const servers = new Set<string>();
    for (let i = 0; i < 3; i++) {
      const res = await client.callTool({ name: "get_quote", arguments: { quote_id: created.quoteId } });
      const out = res.structuredContent as { createdBy: string; servedBy: string };
      expect(out.createdBy).toBe(created.servedBy);
      servers.add(out.servedBy);
    }
    // With round-robin, at least one read lands on a pod that did not create the quote
    expect([...servers].some((pod) => pod !== created.servedBy)).toBe(true);
  });

  test("raw 2026-07-28 request: no session, _meta envelope, private cache scope", async () => {
    const res = await rawRequest(aliceToken, "tools/list");
    expect(res.status).toBe(200);
    expect(res.headers.get("mcp-session-id")).toBeNull();
    expect(res.body.result).toMatchObject({ resultType: "complete", cacheScope: "private", ttlMs: 60000 });
    expect(res.body.result._meta["io.modelcontextprotocol/serverInfo"]).toMatchObject({ name: "insurebot" });
  });

  test("unknown quote ID returns 'Quote not found'", async () => {
    const res = await client.callTool({
      name: "get_quote",
      arguments: { quote_id: "q_" + "A".repeat(32) },
    });
    expect(res.isError).toBe(true);
    expect(res.content).toEqual([{ type: "text", text: "Quote not found" }]);
  });

  test("schema rejects bad input from the model (age 12, malformed ID)", async () => {
    const young = await client.callTool({ name: "start_quote", arguments: { age: 12, smoker: false } });
    expect(young.isError).toBe(true);

    const badId = await client.callTool({ name: "get_quote", arguments: { quote_id: "../../etc/passwd" } });
    expect(badId.isError).toBe(true);
  });
});
