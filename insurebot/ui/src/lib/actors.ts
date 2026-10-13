// Attack-lab actors: the test accounts from .env.test, logged in with the test client's password grant.
// Lab only: this shortcut exists so one click can play Alice AND Bob. Real users log in through the browser.
import { cfg, type LabUser } from "./config";

const cache = new Map<string, { token: string; exp: number }>();

export async function tokenFor(user: LabUser, scope: string, clientId?: string): Promise<string> {
  const c = cfg();
  const client = clientId ?? c.testClientId;
  const key = `${user}|${scope}|${client}`;
  const hit = cache.get(key);
  if (hit && hit.exp - Date.now() > 30_000) return hit.token;
  const password = process.env[`${user.toUpperCase()}_PASSWORD`];
  if (!password) throw new Error(`${user.toUpperCase()}_PASSWORD is not set for the UI container (.env.test)`);
  const res = await fetch(c.oidc.tokenUrl, {
    method: "POST",
    body: new URLSearchParams({ grant_type: "password", client_id: client, username: user, password, scope }),
  });
  const body = (await res.json()) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!body.access_token) throw new Error(`Keycloak refused a token for ${user}: ${body.error} ${body.error_description ?? ""}`);
  cache.set(key, { token: body.access_token, exp: Date.now() + (body.expires_in ?? 60) * 1000 });
  return body.access_token;
}
