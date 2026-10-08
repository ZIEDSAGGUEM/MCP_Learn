import {
  OAuthError,
  OAuthErrorCode,
  type AuthInfo,
  type OAuthTokenVerifier,
} from "@modelcontextprotocol/server";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { config } from "./config.js";

// Keycloak's public signing keys. jose fetches them lazily and caches them,
// so pods start fine even before the Keycloak realm exists.
const jwks = createRemoteJWKSet(new URL(`${config.oidcInternalUrl}/protocol/openid-connect/certs`));

export const verifier: OAuthTokenVerifier = {
  async verifyAccessToken(token: string): Promise<AuthInfo> {
    try {
      const { payload } = await jwtVerify(token, jwks, {
        issuer: config.oidcIssuer, // the right login server
        audience: config.resourceUrl, // issued for InsureBot, not another app (Episode 9)
        algorithms: ["RS256"], // never "none", never a downgraded algorithm
      }); // signature and exp are checked here too
      if (typeof payload.sub !== "string" || typeof payload.tenant !== "string" || !payload.tenant) {
        throw new Error("token has no sub or tenant");
      }
      const roles = (payload as { realm_access?: { roles?: unknown } }).realm_access?.roles;
      return {
        token,
        clientId: String(payload.azp ?? ""),
        scopes: typeof payload.scope === "string" ? payload.scope.split(" ").filter(Boolean) : [],
        expiresAt: payload.exp,
        resource: new URL(config.resourceUrl),
        extra: {
          sub: payload.sub,
          tenant: payload.tenant,
          roles: Array.isArray(roles) ? roles.filter((r): r is string => typeof r === "string") : [],
        },
      };
    } catch (err) {
      // Log the real reason for us; give the caller one generic answer
      console.warn("token rejected:", err instanceof Error ? err.message : err);
      throw new OAuthError(OAuthErrorCode.InvalidToken, "Invalid or expired token");
    }
  },
};

export type Principal = { sub: string; tenant: string; roles: string[] };

// Who is calling. Comes ONLY from the verified token,
// never from tool arguments and never from _meta clientInfo.
export function principal(authInfo: AuthInfo | undefined): Principal {
  const extra = authInfo?.extra as Partial<Principal> | undefined;
  if (!extra?.sub || !extra?.tenant) throw new Error("Unauthenticated");
  return { sub: extra.sub, tenant: extra.tenant, roles: extra.roles ?? [] };
}
