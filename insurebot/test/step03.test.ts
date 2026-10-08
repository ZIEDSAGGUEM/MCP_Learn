// Step 03 attack tests: a quote ID is useless to anyone but its owner.
import type { Client } from "@modelcontextprotocol/client";
import { createClient } from "redis";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { connect, tokenFor } from "./helpers.js";

const REDIS_URL = process.env.REDIS_TEST_URL ?? "redis://127.0.0.1:6380";
const NOT_FOUND = [{ type: "text", text: "Quote not found" }];

const subOf = (token: string) => JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).sub as string;

let alice: Client, bob: Client, carol: Client;
let aliceSub: string;
let aliceQuoteId: string;
const redis = createClient({ url: REDIS_URL });

beforeAll(async () => {
  const aliceToken = await tokenFor("alice", "quotes:read quotes:write");
  aliceSub = subOf(aliceToken);
  alice = await connect(aliceToken);
  bob = await connect(await tokenFor("bob", "quotes:read"));
  carol = await connect(await tokenFor("carol", "quotes:read"));
  await redis.connect();

  const created = await alice.callTool({
    name: "start_quote",
    arguments: { age: 42, smoker: false, conditions: ["diabetes"] },
  });
  aliceQuoteId = (created.structuredContent as { quoteId: string }).quoteId;
});

afterAll(async () => {
  await Promise.all([alice?.close(), bob?.close(), carol?.close()]);
  await redis.quit();
});

const getQuote = (client: Client, args: Record<string, unknown>) => client.callTool({ name: "get_quote", arguments: args });

describe("Step 03: quotes belong to their owner", () => {
  test("Alice can read her own quote, from any pod", async () => {
    for (let i = 0; i < 3; i++) {
      const res = await getQuote(alice, { quote_id: aliceQuoteId });
      expect(res.isError).toBeFalsy();
      expect(res.structuredContent).toMatchObject({ quoteId: aliceQuoteId, conditionsDeclared: 1 });
    }
  });

  test("Episode 2: Bob (Globex) with Alice's quote ID gets 'Quote not found'", async () => {
    const res = await getQuote(bob, { quote_id: aliceQuoteId });
    expect(res.isError).toBe(true);
    expect(res.content).toEqual(NOT_FOUND);
  });

  test("Carol, same agency (Acme) but another user, can't read it either", async () => {
    // Bound to the USER, not only the tenant: colleagues don't see each other's quotes
    const res = await getQuote(carol, { quote_id: aliceQuoteId });
    expect(res.content).toEqual(NOT_FOUND);
  });

  test("'not yours' looks exactly like 'doesn't exist' (no probing)", async () => {
    const stolen = await getQuote(bob, { quote_id: aliceQuoteId });
    const invented = await getQuote(bob, { quote_id: "q_" + "Z".repeat(32) });
    expect(stolen).toEqual(invented);
  });

  test("MCP07: Bob can't pass the owner as an argument", async () => {
    // The model (or Bob) adds fields claiming to be Alice. The schema drops unknown
    // fields and the owner comes only from the token, so nothing changes.
    const res = await getQuote(bob, { quote_id: aliceQuoteId, tenant: "acme", owner: aliceSub, sub: aliceSub });
    expect(res.content).toEqual(NOT_FOUND);
  });
});

describe("Step 03: how quotes are stored", () => {
  test("Redis key includes tenant and user from the token; no owner-less key exists", async () => {
    expect(await redis.exists(`quote:acme:${aliceSub}:${aliceQuoteId}`)).toBe(1);
    expect(await redis.exists(`quote:${aliceQuoteId}`)).toBe(0); // the old step 01 format is gone
  });

  test("quotes expire: TTL is set and at most 30 minutes", async () => {
    const ttl = await redis.ttl(`quote:acme:${aliceSub}:${aliceQuoteId}`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(1800);
  });

  test("Episode 10: IDs are random (192 bits), not sequential", async () => {
    const ids = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const res = await alice.callTool({ name: "start_quote", arguments: { age: 30, smoker: false } });
      ids.add((res.structuredContent as { quoteId: string }).quoteId);
    }
    expect(ids.size).toBe(20);
    for (const id of ids) expect(id).toMatch(/^q_[A-Za-z0-9_-]{32}$/);
  });
});
