import { randomBytes } from "node:crypto";
import type { Principal } from "./auth.js";
import { config } from "./config.js";
import { redis } from "./redis.js";

export type Quote = {
  age: number;
  smoker: boolean;
  conditions: string[];
  priceEur: number;
  createdAt: string;
  createdBy: string; // pod name, for the statelessness demo
  // Kept in the value for audit logs (step 09). Access control uses the KEY, not these fields.
  ownerTenant: string;
  ownerSub: string;
};

// 24 random bytes = 192 bits, base64url = 32 characters. Unguessable (Episode 10).
export const QUOTE_ID_PATTERN = /^q_[A-Za-z0-9_-]{32}$/;

// Step 03: the owner is part of the key, and the owner comes from the verified token.
// Bob looking up Alice's quote ID builds "quote:globex:<bob>:q_…", which doesn't exist.
// Possession of a quote ID is never enough (Lesson 3, State Handle Hijacking, Episode 2).
const key = (owner: Principal, id: string) => `quote:${owner.tenant}:${owner.sub}:${id}`;

export async function saveQuote(owner: Principal, quote: Omit<Quote, "ownerTenant" | "ownerSub">): Promise<string> {
  const id = "q_" + randomBytes(24).toString("base64url");
  const value: Quote = { ...quote, ownerTenant: owner.tenant, ownerSub: owner.sub };
  // Expires on its own: a quote ID leaked in a log or transcript stops working (Lesson 3)
  await redis.set(key(owner, id), JSON.stringify(value), { EX: config.quoteTtlSeconds });
  return id;
}

/** Returns the quote only if it belongs to `owner`. "Missing" and "not yours" look the same. */
export async function loadQuote(owner: Principal, id: string): Promise<Quote | null> {
  const raw = await redis.get(key(owner, id));
  return raw ? (JSON.parse(raw) as Quote) : null;
}
