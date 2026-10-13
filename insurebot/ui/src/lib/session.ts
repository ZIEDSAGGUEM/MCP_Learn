// Backend-for-frontend sessions. The browser only ever holds a random session id in an HttpOnly cookie;
// the Keycloak tokens stay on this server, so an XSS bug in the page can't steal them.
// Lab note: sessions live in memory (one UI container). Restarting the UI logs everyone out.
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";

export type Claims = { sub: string; tenant: string; roles: string[]; scopes: string[]; username: string; exp: number };

export type Session = {
  id: string;
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  expiresAt: number; // ms
  claims: Claims;
  createdAt: number;
};

type Pending = { verifier: string; nonce: string; createdAt: number };

const SESSION_COOKIE = "lab_session";
const STATE_COOKIE = "lab_login_state";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

const g = globalThis as unknown as { __labSessions?: Map<string, Session>; __labPending?: Map<string, Pending> };
const sessions = (g.__labSessions ??= new Map());
const pending = (g.__labPending ??= new Map());

export const newId = (bytes = 32) => randomBytes(bytes).toString("base64url");

const cookieBase = { httpOnly: true, sameSite: "lax" as const, path: "/", secure: false }; // http://localhost lab

export async function currentSession(): Promise<Session | null> {
  const id = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!id) return null;
  const s = sessions.get(id);
  if (!s) return null;
  if (Date.now() - s.createdAt > SESSION_TTL_MS) {
    sessions.delete(id);
    return null;
  }
  return s;
}

export async function startSession(data: Omit<Session, "id" | "createdAt">): Promise<Session> {
  const session: Session = { ...data, id: newId(), createdAt: Date.now() };
  sessions.set(session.id, session);
  (await cookies()).set(SESSION_COOKIE, session.id, { ...cookieBase, maxAge: SESSION_TTL_MS / 1000 });
  return session;
}

export async function endSession(): Promise<Session | null> {
  const jar = await cookies();
  const id = jar.get(SESSION_COOKIE)?.value;
  const s = id ? (sessions.get(id) ?? null) : null;
  if (id) sessions.delete(id);
  jar.delete(SESSION_COOKIE);
  return s;
}

export function updateSession(s: Session) {
  sessions.set(s.id, s);
}

/** Login in progress: PKCE verifier + nonce, keyed by `state`, and the state also in a cookie (login CSRF). */
export async function rememberLogin(state: string, p: Omit<Pending, "createdAt">) {
  for (const [k, v] of pending) if (Date.now() - v.createdAt > 10 * 60 * 1000) pending.delete(k);
  pending.set(state, { ...p, createdAt: Date.now() });
  (await cookies()).set(STATE_COOKIE, state, { ...cookieBase, maxAge: 600 });
}

export async function takeLogin(state: string | null): Promise<Pending | null> {
  const jar = await cookies();
  const cookieState = jar.get(STATE_COOKIE)?.value;
  jar.delete(STATE_COOKIE);
  if (!state || !cookieState || state !== cookieState) return null;
  const p = pending.get(state) ?? null;
  pending.delete(state);
  return p;
}
