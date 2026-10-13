// Step 05 tests: the gateway. Role-based tool lists, caching (Episode 6), WAF + header checks (Episode 7).
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, test } from "vitest";
import { rawRequest, tokenFor } from "./helpers.js";

const PUBLIC = "http://127.0.0.1:3000/mcp";
const ADMIN = "http://127.0.0.1:3002/mcp";
const LAB_GOOD_CACHE = "http://127.0.0.1:3003/mcp";
const LAB_BROKEN_CACHE = "http://127.0.0.1:3004/mcp";

let alice: string; // agent at Acme
let bob: string; // agent at Globex
let carol: string; // admin at Acme

beforeAll(async () => {
  alice = await tokenFor("alice", "quotes:read quotes:write");
  bob = await tokenFor("bob", "quotes:read quotes:write");
  carol = await tokenFor("carol", "quotes:read reports:admin");
});

const toolNames = (res: { body: any }) => (res.body.result.tools as { name: string }[]).map((t) => t.name).sort();

function call(token: string, url: string, tool: string, args: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  return rawRequest(token, "tools/call", { name: tool, arguments: args }, undefined, {}, url, headers);
}

describe("Step 05: the tool list depends on who is asking", () => {
  test("an agent sees 6 tools, an admin sees 9", async () => {
    expect(toolNames(await rawRequest(alice, "tools/list"))).toEqual(["charge_premium", "email_quote", "get_customer", "get_quote", "search_customers", "start_quote"]);
    expect(toolNames(await rawRequest(carol, "tools/list"))).toEqual(["agency_stats", "charge_premium", "email_quote", "export_report", "get_customer", "get_quote", "get_report", "search_customers", "start_quote"]);
  });

  test("MCP02: asking Keycloak for reports:admin doesn't make Alice an admin", async () => {
    // Keycloak hands out any optional scope a client asks for. The role is what counts.
    const aliceWithScope = await tokenFor("alice", "quotes:read reports:admin");
    expect(toolNames(await rawRequest(aliceWithScope, "tools/list"))).not.toContain("agency_stats");
    const res = await call(aliceWithScope, ADMIN, "agency_stats");
    expect(res.body.result?.isError ?? !!res.body.error).toBe(true);
  });

  test("every MCP response tells HTTP caches not to store it", async () => {
    const res = await rawRequest(alice, "tools/list");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("vary")).toContain("Authorization");
    // The same rule, as MCP says it inside the body:
    expect(res.body.result.cacheScope).toBe("private");
  });
});

describe("Step 05: shared caches (Episode 6)", () => {
  test("a cache that respects Cache-Control: Bob never gets Carol's admin tool list", async () => {
    const run = { "x-lab-run": randomUUID() }; // fresh cache entry for this test
    const asCarol = await rawRequest(carol, "tools/list", {}, undefined, {}, LAB_GOOD_CACHE, run);
    const asBob = await rawRequest(bob, "tools/list", {}, undefined, {}, LAB_GOOD_CACHE, run);
    expect(toolNames(asCarol)).toContain("agency_stats");
    expect(toolNames(asBob)).not.toContain("agency_stats");
    expect(asBob.headers.get("x-cache-status")).not.toBe("HIT");
  });

  test("LAB, the leak itself: a cache that IGNORES Cache-Control serves Carol's list to Bob", async () => {
    // This is Episode 6 happening. The server did everything right;
    // a misconfigured cache in front of it ("cache everything") still leaks.
    const run = { "x-lab-run": randomUUID() };
    await rawRequest(carol, "tools/list", {}, undefined, {}, LAB_BROKEN_CACHE, run);
    const asBob = await rawRequest(bob, "tools/list", {}, undefined, {}, LAB_BROKEN_CACHE, run);
    expect(asBob.headers.get("x-cache-status")).toBe("HIT");
    expect(toolNames(asBob)).toContain("agency_stats"); // Bob (Globex agent) sees Acme's admin tool
  });
});

describe("Step 05: WAF rules on headers (Episode 7)", () => {
  test("public entrance blocks admin tools by their Mcp-Name header", async () => {
    const res = await call(carol, PUBLIC, "agency_stats");
    expect(res.status).toBe(403);
  });

  test("admin entrance lets Carol use it, for her own agency only", async () => {
    const res = await call(carol, ADMIN, "agency_stats");
    expect(res.status).toBe(200);
    expect(res.body.result.structuredContent.tenant).toBe("acme");
  });

  test("bypass attempt: header says get_quote, body says agency_stats → WAF passes, server rejects -32020", async () => {
    const res = await rawRequest(
      carol,
      "tools/call",
      { name: "agency_stats", arguments: {} },
      undefined,
      {},
      PUBLIC,
      { "mcp-name": "get_quote" }, // what the WAF sees
    );
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(-32020); // HeaderMismatch
  });

  test("bypass attempt: no Mcp-Name header at all → -32020", async () => {
    const res = await fetch(PUBLIC, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2026-07-28",
        "mcp-method": "tools/call",
        authorization: `Bearer ${carol}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "agency_stats",
          arguments: {},
          _meta: {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientCapabilities": {},
            "io.modelcontextprotocol/clientInfo": { name: "no-header", version: "1" },
          },
        },
      }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error.code).toBe(-32020);
  });

  test("bypass attempt: header says tools/list, body does tools/call → -32020", async () => {
    const res = await rawRequest(alice, "tools/call", { name: "start_quote", arguments: { age: 40, smoker: false } }, undefined, {}, PUBLIC, {
      "mcp-method": "tools/list",
    });
    expect(res.body.error.code).toBe(-32020);
  });
});
