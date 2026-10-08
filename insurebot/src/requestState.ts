import { createRequestStateCodec, type ServerContext } from "@modelcontextprotocol/server";
import { principal } from "./auth.js";
import { config } from "./config.js";

// What InsureBot remembers between round 1 (ask) and round 2 (answer) of a confirmation.
// "kind" says which tool minted it: a "yes" given to charge a card can't be replayed to send an email.
export type PaymentState = { kind: "payment"; quoteId: string; amountEur: number };
export type EmailState = { kind: "email"; quoteId: string; customerId: string };
export type ConfirmState = PaymentState | EmailState;

/**
 * MRTR requestState travels through the client, so the client can read, edit or replay it (Episode 4).
 *  - HMAC-signed: any edit breaks the signature → "Invalid or expired requestState"
 *  - expires after 5 minutes
 *  - bound to the user from the token: Bob can't replay Alice's state
 */
export const stateCodec = createRequestStateCodec<ConfirmState>({
  key: config.requestStateKey,
  ttlSeconds: 300,
  bind: (ctx: ServerContext) => {
    const who = principal(ctx.http?.authInfo);
    return `${who.tenant}:${who.sub}`;
  },
});
