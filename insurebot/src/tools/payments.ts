import { acceptedContent, inputRequired, requireScopes, type McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { principal } from "../auth.js";
import { authorize, policyDenied } from "../authz.js";
import { chargeCard } from "../payco.js";
import { loadQuote, QUOTE_ID_PATTERN } from "../quotes.js";
import { redis } from "../redis.js";
import { stateCodec, type ConfirmState } from "../requestState.js";

const confirmSchema = z.object({ confirm: z.boolean().describe("Charge the card?") });
const CARD_ON_FILE = "4242"; // mock: the customer's saved card. InsureBot never sees full card numbers.

export function registerPaymentTools(server: McpServer) {
  server.registerTool(
    "charge_premium",
    {
      title: "Charge first premium",
      description: "Charge the first monthly premium of a quote to the customer's card on file. Asks the user to confirm.",
      inputSchema: z.object({ quote_id: z.string().regex(QUOTE_ID_PATTERN, "Not a valid quote ID") }),
      outputSchema: z.object({
        status: z.enum(["charged", "already_paid", "cancelled", "in_progress"]),
        receiptId: z.string().optional(),
        amountEur: z.number().optional(),
      }),
      annotations: { destructiveHint: true, idempotentHint: true },
      // Moving money needs its own scope (Lesson 3: least privilege, step-up)
      scopeChallenge: requireScopes("payments:charge"),
    },
    async ({ quote_id }, ctx) => {
      const who = principal(ctx.http?.authInfo);
      // Owner check on EVERY round: round 2 is a brand-new request, maybe on another pod
      const quote = await loadQuote(who, quote_id);
      if (!quote) return { content: [{ type: "text", text: "Quote not found" }], isError: true };

      // Policy check with the real amount (rule "big-premium-needs-admin" in policy/insurebot.cedar)
      const policy = await authorize(who, "charge_premium", {
        type: "quote",
        id: quote_id,
        properties: { tenant: who.tenant, amountCents: Math.round(quote.priceEur * 100) },
      });
      if (!policy.allowed) {
        return policyDenied(
          policy.reasons.includes("big-premium-needs-admin")
            ? `Premiums above €200/month need an admin. This one is €${quote.priceEur}.`
            : "Not allowed by policy.",
        );
      }

      const payKey = `pay:${who.tenant}:${who.sub}:${quote_id}`;
      const already = await redis.get(payKey);
      if (already && already !== "pending") return paid("already_paid", already, quote.priceEur);

      // Round 1: no signed state yet → ask the human (Episode 3).
      // A client that sends a "yes" without our state skipped the question, so we ask anyway.
      // (The SDK has already verified signature, expiry and user binding of any state it got.)
      const state = ctx.mcpReq.requestState<ConfirmState>();
      if (!state || typeof state !== "object") {
        return inputRequired({
          inputRequests: {
            confirm: inputRequired.elicit({
              message: `Charge €${quote.priceEur} to the card ending ${CARD_ON_FILE} for quote ${quote_id}?`,
              requestedSchema: confirmSchema,
            }),
          },
          requestState: await stateCodec.mint({ kind: "payment", quoteId: quote_id, amountEur: quote.priceEur }, ctx),
        });
      }

      // Round 2: the "yes" must be for THIS quote and THIS amount (what the user actually saw)
      // ...and it must be a PAYMENT confirmation, not a "yes" given to another tool
      if (state.kind !== "payment" || state.quoteId !== quote_id || state.amountEur !== quote.priceEur) {
        return { content: [{ type: "text", text: "Confirmation doesn't match this quote. Please start again." }], isError: true };
      }
      const answer = acceptedContent(ctx.mcpReq.inputResponses, "confirm", confirmSchema);
      if (answer?.confirm !== true) {
        return {
          content: [{ type: "text", text: "Payment cancelled. Nothing was charged." }],
          structuredContent: { status: "cancelled" as const },
        };
      }

      // Episode 5: one charge per quote, even if the call is re-sent after a dropped connection.
      // SET NX = only the first request gets to charge; the others see "pending" or the receipt.
      const first = await redis.set(payKey, "pending", { NX: true, EX: 86_400 });
      if (!first) {
        const current = await redis.get(payKey);
        if (current && current !== "pending") return paid("already_paid", current, quote.priceEur);
        return {
          content: [{ type: "text", text: "This payment is already being processed." }],
          structuredContent: { status: "in_progress" as const },
        };
      }

      try {
        const charge = await chargeCard({
          amountEur: quote.priceEur, // from OUR store, never from the client
          description: `InsureBot first premium, quote ${quote_id}`,
          idempotencyKey: `insurebot-${quote_id}`, // PayCo dedupes too: two layers
          metadata: { tenant: who.tenant, quote_id },
        });
        await redis.set(payKey, charge.id, { EX: 86_400 });
        return paid("charged", charge.id, quote.priceEur);
      } catch (err) {
        await redis.del(payKey); // let the user retry; PayCo's idempotency key still prevents a double charge
        throw err;
      }
    },
  );
}

function paid(status: "charged" | "already_paid", receiptId: string, amountEur: number) {
  const text =
    status === "charged"
      ? `Charged €${amountEur}. Receipt ${receiptId}.`
      : `Already paid: €${amountEur}, receipt ${receiptId}. Nothing new was charged.`;
  return { content: [{ type: "text" as const, text }], structuredContent: { status, receiptId, amountEur } };
}
