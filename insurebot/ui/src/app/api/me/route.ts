import { NextResponse } from "next/server";
import { cfg, LAB_USER_INFO } from "@/lib/config";
import { currentSession } from "@/lib/session";
import { accessTokenFor } from "@/lib/oidc";

export const dynamic = "force-dynamic";

export async function GET() {
  const s = await currentSession();
  if (!s) return NextResponse.json({ loggedIn: false, users: LAB_USER_INFO });
  try {
    await accessTokenFor(s);
  } catch {
    return NextResponse.json({ loggedIn: false, users: LAB_USER_INFO, expired: true });
  }
  return NextResponse.json({
    loggedIn: true,
    claims: s.claims,
    tokenExpiresAt: s.expiresAt,
    users: LAB_USER_INFO,
    links: { jaeger: cfg().jaegerPublicUrl, mailpit: "http://localhost:8025", keycloak: "http://localhost:8080" },
  });
}
