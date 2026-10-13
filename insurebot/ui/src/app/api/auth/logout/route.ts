import { NextResponse } from "next/server";
import { cfg } from "@/lib/config";
import { checkCsrf, handle } from "@/lib/guard";
import { endSession } from "@/lib/session";

export const dynamic = "force-dynamic";

// POST: ends the UI session, then returns Keycloak's logout URL so its SSO session ends too
export const POST = handle(async (req) => {
  checkCsrf(req);
  const c = cfg();
  const s = await endSession();
  const u = new URL(c.oidc.logoutUrl);
  u.searchParams.set("client_id", c.oidc.clientId);
  u.searchParams.set("post_logout_redirect_uri", `${c.publicUrl}/`);
  if (s?.idToken) u.searchParams.set("id_token_hint", s.idToken);
  return NextResponse.json({ logoutUrl: u.toString() });
});
