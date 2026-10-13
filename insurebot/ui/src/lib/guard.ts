// Request guards for the UI's own API.
import { NextResponse } from "next/server";
import { cfg } from "./config";
import { accessTokenFor } from "./oidc";
import { currentSession, type Session } from "./session";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/**
 * State-changing calls must come from this page: same Origin, plus a custom header a cross-site form can't send.
 * (The session cookie is SameSite=Lax too: two layers against CSRF.)
 */
export function checkCsrf(req: Request) {
  const origin = req.headers.get("origin");
  if (origin !== cfg().publicUrl || req.headers.get("x-lab-csrf") !== "1") {
    throw new HttpError(403, "Cross-site request refused");
  }
}

export async function requireSession(): Promise<{ session: Session; token: string }> {
  const session = await currentSession();
  if (!session) throw new HttpError(401, "Log in first");
  try {
    return { session, token: await accessTokenFor(session) };
  } catch {
    throw new HttpError(401, "Your session expired. Log in again.");
  }
}

export function handle(fn: (req: Request, ctx: any) => Promise<Response>) {
  return async (req: Request, ctx: any) => {
    try {
      return await fn(req, ctx);
    } catch (err) {
      if (err instanceof HttpError) return NextResponse.json({ error: err.message }, { status: err.status });
      console.error("lab-ui error:", err instanceof Error ? err.message : err);
      return NextResponse.json({ error: "Something went wrong. See the UI container logs." }, { status: 500 });
    }
  };
}
