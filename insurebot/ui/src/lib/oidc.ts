// Keycloak login for the lab UI: authorization code + PKCE, confidential client (the secret stays here).
import { createHash } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { cfg } from "./config";
import { newId, type Claims, type Session, updateSession } from "./session";

export const LOGIN_SCOPES = "openid quotes:read quotes:write payments:charge reports:admin";

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;
const keys = () => (jwks ??= createRemoteJWKSet(new URL(cfg().oidc.jwksUrl)));

export function pkce() {
  const verifier = newId(48);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function authorizeUrl(state: string, nonce: string, challenge: string, loginHint?: string) {
  const c = cfg();
  const u = new URL(c.oidc.authorizeUrl);
  u.search = new URLSearchParams({
    client_id: c.oidc.clientId,
    redirect_uri: `${c.publicUrl}/api/auth/callback`,
    response_type: "code",
    scope: LOGIN_SCOPES,
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "login", // always show the login form, so switching between Alice and Bob is easy
    ...(loginHint ? { login_hint: loginHint } : {}),
  }).toString();
  return u.toString();
}

type TokenResponse = { access_token: string; refresh_token?: string; id_token?: string; expires_in: number };

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const c = cfg();
  const res = await fetch(c.oidc.tokenUrl, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: "Basic " + Buffer.from(`${encodeURIComponent(c.oidc.clientId)}:${encodeURIComponent(c.oidc.clientSecret)}`).toString("base64"),
    },
    body: new URLSearchParams(body),
  });
  const json = (await res.json()) as TokenResponse & { error?: string; error_description?: string };
  if (!res.ok || !json.access_token) throw new Error(`Keycloak: ${json.error ?? res.status} ${json.error_description ?? ""}`.trim());
  return json;
}

export async function exchangeCode(code: string, verifier: string) {
  const c = cfg();
  return tokenRequest({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: `${c.publicUrl}/api/auth/callback` });
}

/** Verify the access token the same way InsureBot does (signature, issuer, audience, expiry). */
export async function verifyAccessToken(token: string): Promise<Claims> {
  const c = cfg();
  const { payload } = await jwtVerify(token, keys(), { issuer: c.oidc.issuer, audience: c.resourceUrl, algorithms: ["RS256"] });
  return claimsFrom(payload);
}

export async function verifyIdToken(token: string, nonce: string) {
  const c = cfg();
  const { payload } = await jwtVerify(token, keys(), { issuer: c.oidc.issuer, audience: c.oidc.clientId, algorithms: ["RS256"] });
  if (payload.nonce !== nonce) throw new Error("ID token nonce mismatch");
}

export function claimsFrom(p: JWTPayload): Claims {
  const roles = ((p as { realm_access?: { roles?: string[] } }).realm_access?.roles ?? []).filter(
    (r) => !r.startsWith("default-roles") && r !== "offline_access" && r !== "uma_authorization",
  );
  return {
    sub: String(p.sub),
    tenant: String((p as { tenant?: string }).tenant ?? ""),
    roles,
    scopes: String((p as { scope?: string }).scope ?? "").split(" ").filter(Boolean),
    username: String((p as { preferred_username?: string }).preferred_username ?? p.sub),
    exp: Number(p.exp),
  };
}

/** A fresh access token for this session, refreshing it when it's about to expire (Keycloak: 5 minutes). */
export async function accessTokenFor(s: Session): Promise<string> {
  if (s.expiresAt - Date.now() > 30_000) return s.accessToken;
  if (!s.refreshToken) throw new Error("Session expired: log in again");
  const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: s.refreshToken });
  s.accessToken = t.access_token;
  s.refreshToken = t.refresh_token ?? s.refreshToken;
  s.expiresAt = Date.now() + t.expires_in * 1000;
  s.claims = await verifyAccessToken(t.access_token);
  updateSession(s);
  return s.accessToken;
}
