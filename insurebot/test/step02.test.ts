// Step 02 attack tests: who is calling, and what may their token do?
// Needs Part A done in Keycloak and passwords in .env.test.
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { describe, expect, test } from "vitest";
import { MCP_URL, OIDC_ISSUER, RESOURCE_URL, rawRequest, tokenFor } from "./helpers.js";

const START_QUOTE = { name: "start_quote", arguments: { age: 40, smoker: false } };

describe("Step 02: every request is authenticated", () => {
  test("no token → 401 with a pointer to the login server", async () => {
    const res = await rawRequest(undefined, "tools/list");
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toMatch(/^Bearer .*resource_metadata="[^"]+oauth-protected-resource/);
  });

  test("garbage token → 401", async () => {
    const res = await rawRequest("not-a-real-token", "tools/list");
    expect(res.status).toBe(401);
  });

  test("forged token (right claims, attacker's key) → 401", async () => {
    // Mallory copies every claim Alice's token has, but can't sign with Keycloak's key
    const { privateKey } = await generateKeyPair("RS256");
    const forged = await new SignJWT({ tenant: "acme", scope: "quotes:read quotes:write", azp: "insurebot-tests" })
      .setProtectedHeader({ alg: "RS256", kid: "mallory-key" })
      .setIssuer(OIDC_ISSUER)
      .setAudience(RESOURCE_URL)
      .setSubject("00000000-0000-0000-0000-000000000000")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
    const res = await rawRequest(forged, "tools/list");
    expect(res.status).toBe(401);
  });

  test("alg=none token → 401", async () => {
    const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const now = Math.floor(Date.now() / 1000);
    const unsigned =
      enc({ alg: "none", typ: "JWT" }) +
      "." +
      enc({ iss: OIDC_ISSUER, aud: RESOURCE_URL, sub: "x", tenant: "acme", scope: "quotes:write", exp: now + 300 }) +
      ".";
    const res = await rawRequest(unsigned, "tools/list");
    expect(res.status).toBe(401);
  });

  test("Episode 9: a real Keycloak token issued for ANOTHER app → 401", async () => {
    // other-app has no insurebot-audience scope, so "aud" doesn't name InsureBot
    const otherAppToken = await tokenFor("alice", "openid", "other-app");
    const res = await rawRequest(otherAppToken, "tools/list");
    expect(res.status).toBe(401);
  });

  test("a valid token works", async () => {
    const token = await tokenFor("alice", "quotes:read quotes:write");
    const res = await rawRequest(token, "tools/list");
    expect(res.status).toBe(200);
  });
});

describe("Step 02: scopes limit what a token can do", () => {
  test("Episode 11: read-only token can't create quotes → 403 insufficient_scope naming quotes:write", async () => {
    const readOnly = await tokenFor("alice", "quotes:read");
    const res = await rawRequest(readOnly, "tools/call", START_QUOTE);
    expect(res.status).toBe(403);
    const challenge = res.headers.get("www-authenticate") ?? "";
    expect(challenge).toContain('error="insufficient_scope"');
    expect(challenge).toContain("quotes:write");
  });

  test("read-only token can still read", async () => {
    const readOnly = await tokenFor("alice", "quotes:read");
    const res = await rawRequest(readOnly, "tools/call", {
      name: "get_quote",
      arguments: { quote_id: "q_" + "A".repeat(32) },
    });
    expect(res.status).toBe(200); // reaches the tool ("Quote not found"), not blocked by scope
  });

  test("_meta clientInfo is not identity: claiming to be 'admin' changes nothing", async () => {
    const readOnly = await tokenFor("alice", "quotes:read");
    const res = await rawRequest(readOnly, "tools/call", START_QUOTE, { name: "admin", version: "9.9" });
    expect(res.status).toBe(403);
  });
});

describe("Step 02: discovery", () => {
  test("protected resource metadata names Keycloak and the 4 scopes", async () => {
    const res = await fetch(new URL("/.well-known/oauth-protected-resource/mcp", MCP_URL));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      resource: RESOURCE_URL,
      authorization_servers: [OIDC_ISSUER],
      scopes_supported: ["quotes:read", "quotes:write", "payments:charge", "reports:admin"],
    });
  });
});
