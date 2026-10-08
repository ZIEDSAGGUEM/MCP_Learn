import { config } from "./config.js";

export type Charge = { id: string; amount_cents: number; currency: string };

/**
 * Charge a card through PayCo.
 * Uses InsureBot's OWN API key. The user's access token is never forwarded (Episode 9: token passthrough).
 * The idempotency key makes a repeated call return the first charge instead of charging again (Episode 5).
 */
export async function chargeCard(opts: {
  amountEur: number;
  description: string;
  idempotencyKey: string;
  metadata: Record<string, string>;
}): Promise<Charge> {
  const res = await fetch(`${config.paycoUrl}/v1/charges`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.paycoApiKey}`,
      "idempotency-key": opts.idempotencyKey,
    },
    body: JSON.stringify({
      amount_cents: Math.round(opts.amountEur * 100),
      currency: "EUR",
      description: opts.description,
      metadata: opts.metadata,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`PayCo refused the charge (HTTP ${res.status})`);
  return (await res.json()) as Charge;
}
