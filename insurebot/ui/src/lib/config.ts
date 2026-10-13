// All settings come from the environment. Read lazily, so `next build` works without secrets.

function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === "") throw new Error(`Missing environment variable ${name}`);
  return value;
}

export function cfg() {
  const issuer = env("OIDC_ISSUER", "http://localhost:8080/realms/insurebot");
  const internal = env("OIDC_INTERNAL_URL", issuer);
  return {
    publicUrl: env("UI_PUBLIC_URL", "http://localhost:3005"),
    // Keycloak: the browser goes to `issuer`, this server talks to `internal` (same realm, Docker network)
    oidc: {
      issuer,
      authorizeUrl: `${issuer}/protocol/openid-connect/auth`,
      logoutUrl: `${issuer}/protocol/openid-connect/logout`,
      tokenUrl: `${internal}/protocol/openid-connect/token`,
      jwksUrl: `${internal}/protocol/openid-connect/certs`,
      clientId: env("UI_OIDC_CLIENT_ID", "insurebot-ui"),
      clientSecret: env("UI_OIDC_CLIENT_SECRET"),
    },
    // InsureBot's identity: tokens must carry it in "aud"
    resourceUrl: env("RESOURCE_URL", "http://localhost:3000/mcp"),
    // The gateway's entrances, seen from inside Docker
    entrances: {
      public: env("MCP_PUBLIC_URL", "http://gateway:80/mcp"),
      admin: env("MCP_ADMIN_URL", "http://gateway:81/mcp"),
      labCacheGood: env("MCP_LAB_CACHE_GOOD_URL", "http://gateway:82/mcp"),
      labCacheBroken: env("MCP_LAB_CACHE_BROKEN_URL", "http://gateway:83/mcp"),
    },
    // Attack lab: test accounts (from .env.test), used with the test client's password grant
    testClientId: env("TEST_CLIENT_ID", "insurebot-tests"),
    auditDatabaseUrl: env("LAB_AUDIT_DATABASE_URL"),
    mailpitUrl: env("MAILPIT_URL", "http://mailpit:8025"),
    jaegerPublicUrl: env("JAEGER_PUBLIC_URL", "http://localhost:16686"),
    pdpUrl: env("PDP_URL", "http://pdp:8181"),
    pdpApiKey: env("PDP_API_KEY"),
    policyFile: env("POLICY_FILE", "/policy/insurebot.cedar"),
    policyDefaultFile: env("POLICY_DEFAULT_FILE", "/app/policy-default/insurebot.cedar"),
  };
}

export const LAB_USERS = ["alice", "bob", "carol", "dave", "erin"] as const;
export type LabUser = (typeof LAB_USERS)[number];
export const LAB_USER_INFO: Record<LabUser, string> = {
  alice: "Acme agent",
  bob: "Globex agent",
  carol: "Acme admin",
  dave: "Initech agent (rate-limit flood)",
  erin: "Globex admin",
};
