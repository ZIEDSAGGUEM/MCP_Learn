import { hostname } from "node:os";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  // 0.0.0.0 inside Docker; 127.0.0.1 when running on the laptop
  host: process.env.HOST ?? "127.0.0.1",
  // Host headers the server accepts (DNS-rebinding protection)
  allowedHosts: (process.env.ALLOWED_HOSTS ?? "localhost,127.0.0.1").split(",").map((h) => h.trim()),
  redisUrl: required("REDIS_URL"),
  // "stateless" also serves 2025-era clients (no sessions); "reject" accepts only 2026-07-28
  legacyMode: (process.env.LEGACY_MODE === "reject" ? "reject" : "stateless") as "reject" | "stateless",
  // Quotes expire: a leaked quote ID stops working after this (Lesson 1)
  quoteTtlSeconds: Number(process.env.QUOTE_TTL_SECONDS ?? 1800),
  // Which pod answered: lets you see statelessness in action (Episode 1)
  podName: process.env.POD_NAME ?? hostname(),

  // Step 02: auth is mandatory. Without these the server refuses to start,
  // so an unauthenticated copy can't be deployed by accident (Episode 20).
  // What tokens say in "iss" (Keycloak's public URL)
  oidcIssuer: required("OIDC_ISSUER"),
  // How this server reaches Keycloak (inside Docker: http://keycloak:8080/...)
  oidcInternalUrl: process.env.OIDC_INTERNAL_URL ?? required("OIDC_ISSUER"),
  // InsureBot's own identity: tokens must carry it in "aud" (Episode 9)
  resourceUrl: required("RESOURCE_URL"),

  // Step 04: payments
  paycoUrl: required("PAYCO_URL"),
  // InsureBot's own PayCo key. Never the user's token (Episode 9).
  paycoApiKey: required("PAYCO_API_KEY"),
  // HMAC key for MRTR requestState. Every pod needs the same key,
  // because round 2 of a confirmation can land on a different pod than round 1.
  requestStateKey: requiredSecret("REQUEST_STATE_KEY"),

  // Step 06: Postgres, connected as insurebot_app (never the owner, never a superuser)
  databaseUrl: required("DATABASE_URL"),

  // Step 07: email (Mailpit in the lab) and a per-agency request budget (LLM10, Episode 16)
  smtpUrl: required("SMTP_URL"),
  rateLimitPerMinute: Number(process.env.RATE_LIMIT_PER_MINUTE ?? 600),

  // Step 08: reports are slow on purpose, so you can watch "running" become "ready"
  reportDelayMs: Number(process.env.REPORT_DELAY_MS ?? 1500),

  // Step 10: the PDP (Cedar behind AuthZEN). If it can't be reached, every tool call is denied.
  pdpUrl: required("PDP_URL"),
  pdpApiKey: requiredSecret("PDP_API_KEY"),
};

function requiredSecret(name: string): string {
  const value = required(name);
  if (Buffer.byteLength(value) < 32) throw new Error(`${name} must be at least 32 bytes`);
  return value;
}

export const SCOPES = ["quotes:read", "quotes:write", "payments:charge", "reports:admin"] as const;
