import { NextResponse } from "next/server";
import { authorizeUrl, pkce } from "@/lib/oidc";
import { newId, rememberLogin } from "@/lib/session";
import { handle } from "@/lib/guard";

export const dynamic = "force-dynamic";

// GET /api/auth/login?as=alice → Keycloak's login page (PKCE + state + nonce)
export const GET = handle(async (req) => {
  const hint = new URL(req.url).searchParams.get("as") ?? undefined;
  const { verifier, challenge } = pkce();
  const state = newId();
  const nonce = newId();
  await rememberLogin(state, { verifier, nonce });
  return NextResponse.redirect(authorizeUrl(state, nonce, challenge, hint?.match(/^[a-z]{1,20}$/) ? hint : undefined));
});
