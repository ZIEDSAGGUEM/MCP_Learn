import { NextResponse } from "next/server";
import { cfg } from "@/lib/config";
import { exchangeCode, verifyAccessToken, verifyIdToken } from "@/lib/oidc";
import { startSession, takeLogin } from "@/lib/session";

export const dynamic = "force-dynamic";

// Keycloak sends the browser back here with ?code&state&iss
export async function GET(req: Request) {
  const c = cfg();
  const url = new URL(req.url);
  const fail = (why: string) => NextResponse.redirect(`${c.publicUrl}/?login_error=${encodeURIComponent(why)}`);
  if (url.searchParams.get("error")) return fail(url.searchParams.get("error_description") ?? url.searchParams.get("error")!);

  // RFC 9207: the redirect says which login server sent it; it must be ours (mix-up attacks, Lesson 3)
  const iss = url.searchParams.get("iss");
  if (iss && iss !== c.oidc.issuer) return fail("Login came back from an unexpected issuer");

  const login = await takeLogin(url.searchParams.get("state"));
  if (!login) return fail("Login state didn't match. Start again.");
  const code = url.searchParams.get("code");
  if (!code) return fail("No authorization code");

  try {
    const t = await exchangeCode(code, login.verifier);
    if (t.id_token) await verifyIdToken(t.id_token, login.nonce);
    const claims = await verifyAccessToken(t.access_token);
    await startSession({
      accessToken: t.access_token,
      refreshToken: t.refresh_token,
      idToken: t.id_token,
      expiresAt: Date.now() + t.expires_in * 1000,
      claims,
    });
    return NextResponse.redirect(`${c.publicUrl}/`);
  } catch (err) {
    console.error("login failed:", err instanceof Error ? err.message : err);
    return fail("Login failed. See the UI container logs.");
  }
}
