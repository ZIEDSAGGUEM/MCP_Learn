// Step 04 attack tests: charge_premium asks first (MRTR), never charges twice,
// and pays with InsureBot's own PayCo key.
import { beforeAll, describe, expect, test } from "vitest";
import { connect, rawRequest, tokenFor } from "./helpers.js";

try {
  process.loadEnvFile(".env"); // PAYCO_API_KEY, so the tests can count charges at PayCo
} catch {}
const PAYCO_URL = process.env.PAYCO_TEST_URL ?? "http://127.0.0.1:4000";
const PAYCO_API_KEY = process.env.PAYCO_API_KEY ?? "";

const CAN_ASK_USER = { elicitation: { form: {} } }; // a client that can show the confirmation
const YES = { confirm: { action: "accept", content: { confirm: true } } };
const NO = { confirm: { action: "accept", content: { confirm: false } } };

let alice: string; // token with payments:charge
let aliceNoPay: string; // token without it

beforeAll(async () => {
  alice = await tokenFor("alice", "quotes:read quotes:write payments:charge");
  aliceNoPay = await tokenFor("alice", "quotes:read quotes:write");
});

async function newQuote(token = alice): Promise<{ quoteId: string; priceEur: number }> {
  const client = await connect(token);
  const res = await client.callTool({ name: "start_quote", arguments: { age: 30 + Math.floor(Math.random() * 40), smoker: false } });
  await client.close();
  return res.structuredContent as { quoteId: string; priceEur: number };
}

function charge(token: string, quoteId: string, extra: Record<string, unknown> = {}, caps: Record<string, unknown> = CAN_ASK_USER) {
  return rawRequest(token, "tools/call", { name: "charge_premium", arguments: { quote_id: quoteId }, ...extra }, undefined, caps);
}

async function chargesAtPayCo(quoteId: string) {
  const res = await fetch(`${PAYCO_URL}/v1/charges`, { headers: { authorization: `Bearer ${PAYCO_API_KEY}` } });
  const { data } = (await res.json()) as { data: { id: string; amount_cents: number; metadata: Record<string, string> }[] };
  return data.filter((c) => c.metadata.quote_id === quoteId);
}

describe("Step 04: who may charge", () => {
  test("token without payments:charge → 403 naming payments:charge", async () => {
    const { quoteId } = await newQuote(aliceNoPay);
    const res = await charge(aliceNoPay, quoteId);
    expect(res.status).toBe(403);
    expect(res.headers.get("www-authenticate")).toContain("payments:charge");
  });

  test("a client that can't ask the user can't charge at all (-32021)", async () => {
    const { quoteId } = await newQuote();
    const res = await charge(alice, quoteId, {}, {});
    expect(res.body.error.code).toBe(-32021); // MissingRequiredClientCapability
    expect(await chargesAtPayCo(quoteId)).toHaveLength(0);
  });

  test("Bob can't even start charging Alice's quote", async () => {
    const { quoteId } = await newQuote();
    const bob = await tokenFor("bob", "quotes:read payments:charge");
    const res = await charge(bob, quoteId);
    expect(res.body.result.content).toEqual([{ type: "text", text: "Quote not found" }]);
  });
});

describe("Step 04: the human confirms first (MRTR)", () => {
  test("Episode 3: round 1 asks, with the real amount, and charges nothing", async () => {
    const { quoteId, priceEur } = await newQuote();
    const res = await charge(alice, quoteId);
    const result = res.body.result;
    expect(result.resultType).toBe("input_required");
    expect(result.inputRequests.confirm.method).toBe("elicitation/create");
    expect(result.inputRequests.confirm.params.message).toContain(`€${priceEur}`);
    expect(typeof result.requestState).toBe("string");
    expect(await chargesAtPayCo(quoteId)).toHaveLength(0);
  });

  test("skipping the question (a 'yes' without our state) just asks again", async () => {
    const { quoteId } = await newQuote();
    const res = await charge(alice, quoteId, { inputResponses: YES });
    expect(res.body.result.resultType).toBe("input_required");
    expect(await chargesAtPayCo(quoteId)).toHaveLength(0);
  });

  test("user says no → cancelled, nothing charged", async () => {
    const { quoteId } = await newQuote();
    const round1 = await charge(alice, quoteId);
    const res = await charge(alice, quoteId, { requestState: round1.body.result.requestState, inputResponses: NO });
    expect(res.body.result.structuredContent.status).toBe("cancelled");
    expect(await chargesAtPayCo(quoteId)).toHaveLength(0);
  });

  test("user says yes → charged once, the amount from OUR store", async () => {
    const { quoteId, priceEur } = await newQuote();
    const round1 = await charge(alice, quoteId);
    const res = await charge(alice, quoteId, { requestState: round1.body.result.requestState, inputResponses: YES });
    expect(res.body.result.structuredContent).toMatchObject({ status: "charged", amountEur: priceEur });
    const charges = await chargesAtPayCo(quoteId);
    expect(charges).toHaveLength(1);
    expect(charges[0]).toMatchObject({ id: res.body.result.structuredContent.receiptId, amount_cents: Math.round(priceEur * 100) });
    expect(charges[0].metadata.tenant).toBe("acme");
  });
});

describe("Step 04: requestState can't be tampered with or replayed (Episode 4)", () => {
  test("editing the state (amount €1) → 'Invalid or expired requestState', nothing charged", async () => {
    const { quoteId } = await newQuote();
    const state: string = (await charge(alice, quoteId)).body.result.requestState;
    // The state is readable (signed, NOT encrypted): v1.<payload>.<signature>
    const [version, payload, signature] = state.split(".");
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString());
    decoded.p.amountEur = 1;
    const forged = [version, Buffer.from(JSON.stringify(decoded)).toString("base64url"), signature].join(".");

    const res = await charge(alice, quoteId, { requestState: forged, inputResponses: YES });
    expect(res.body.error).toMatchObject({ code: -32602, message: "Invalid or expired requestState" });
    expect(await chargesAtPayCo(quoteId)).toHaveLength(0);
  });

  test("Bob replays Alice's state → rejected before the tool runs", async () => {
    const { quoteId } = await newQuote();
    const state = (await charge(alice, quoteId)).body.result.requestState;
    const bob = await tokenFor("bob", "quotes:read payments:charge");
    const res = await charge(bob, quoteId, { requestState: state, inputResponses: YES });
    expect(res.body.error).toMatchObject({ code: -32602, message: "Invalid or expired requestState" });
    expect(await chargesAtPayCo(quoteId)).toHaveLength(0);
  });

  test("a 'yes' given for quote A can't pay quote B", async () => {
    const a = await newQuote();
    const b = await newQuote();
    const stateForA = (await charge(alice, a.quoteId)).body.result.requestState;
    const res = await charge(alice, b.quoteId, { requestState: stateForA, inputResponses: YES });
    expect(res.body.result.isError).toBe(true);
    expect(await chargesAtPayCo(b.quoteId)).toHaveLength(0);
  });
});

describe("Step 04: never charge twice (Episode 5)", () => {
  test("re-sending the confirmed call returns the first receipt", async () => {
    const { quoteId } = await newQuote();
    const state = (await charge(alice, quoteId)).body.result.requestState;
    const first = await charge(alice, quoteId, { requestState: state, inputResponses: YES });
    const again = await charge(alice, quoteId, { requestState: state, inputResponses: YES });
    expect(again.body.result.structuredContent).toMatchObject({
      status: "already_paid",
      receiptId: first.body.result.structuredContent.receiptId,
    });
    expect(await chargesAtPayCo(quoteId)).toHaveLength(1);
  });

  test("5 identical calls at the same moment (on 3 pods) → exactly 1 charge", async () => {
    const { quoteId } = await newQuote();
    const state = (await charge(alice, quoteId)).body.result.requestState;
    const results = await Promise.all(
      Array.from({ length: 5 }, () => charge(alice, quoteId, { requestState: state, inputResponses: YES })),
    );
    const statuses = results.map((r) => r.body.result.structuredContent.status);
    expect(statuses.filter((s) => s === "charged")).toHaveLength(1);
    expect(await chargesAtPayCo(quoteId)).toHaveLength(1);
  });
});

describe("Step 04: InsureBot pays with its own key (Episode 9)", () => {
  test("PayCo rejects a user's token: only InsureBot's API key works", async () => {
    const res = await fetch(`${PAYCO_URL}/v1/charges`, { headers: { authorization: `Bearer ${alice}` } });
    expect(res.status).toBe(401);
  });
});
