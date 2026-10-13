"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import AttackLab from "./AttackLab";
import Evidence from "./Evidence";
import Playground from "./Playground";
import PolicyEditor from "./PolicyEditor";

type Me =
  | { loggedIn: false; users: Record<string, string>; expired?: boolean }
  | {
      loggedIn: true;
      users: Record<string, string>;
      tokenExpiresAt: number;
      claims: { sub: string; tenant: string; roles: string[]; scopes: string[]; username: string };
      links: { jaeger: string; mailpit: string; keycloak: string };
    };

const TABS = [
  { id: "playground", label: "Playground" },
  { id: "attacks", label: "Attack lab" },
  { id: "evidence", label: "Evidence" },
  { id: "policies", label: "Policies" },
] as const;
type TabId = (typeof TABS)[number]["id"];

export default function Dashboard() {
  const [me, setMe] = useState<Me | null>(null);
  const [tab, setTab] = useState<TabId>("playground");
  const [trace, setTrace] = useState("");
  const [loginError, setLoginError] = useState("");

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("login_error")) {
      setLoginError(q.get("login_error")!);
      window.history.replaceState(null, "", "/");
    }
    try {
      const saved = localStorage.getItem("lab-tab") as TabId | null;
      if (saved && TABS.some((t) => t.id === saved)) setTab(saved);
    } catch {}
    api<Me>("/api/me").then(setMe).catch(() => setMe({ loggedIn: false, users: {} }));
  }, []);

  function go(t: TabId) {
    setTab(t);
    try {
      localStorage.setItem("lab-tab", t);
    } catch {}
  }

  async function logout() {
    const r = await api<{ logoutUrl: string }>("/api/auth/logout", { method: "POST", body: {} });
    window.location.href = r.logoutUrl;
  }

  if (!me) return <main className="muted">Loading…</main>;

  if (!me.loggedIn) {
    return (
      <main>
        <div className="hero">
          <h1>InsureBot Security Lab</h1>
          <p className="muted" style={{ margin: 0 }}>
            Log in through Keycloak as one of the lab users. The UI is just another MCP client: it goes through the same gateway,
            tokens, row-level security and policies as Claude does. Your tokens stay on the UI server; the browser only holds a session cookie.
          </p>
          {loginError && <div className="banner">Login failed: {loginError}</div>}
          {me.expired && <div className="banner">Your session expired. Log in again.</div>}
          <div className="users">
            {Object.entries(me.users).map(([u, info]) => (
              <a key={u} href={`/api/auth/login?as=${u}`}>
                <b>Log in as {u}</b>
                <span className="muted">{info}</span>
              </a>
            ))}
          </div>
          <p className="muted" style={{ margin: 0 }}>Passwords are the ones you set in Keycloak (also in <code>.env.test</code>).</p>
        </div>
      </main>
    );
  }

  const c = me.claims;
  const isAdmin = c.roles.includes("admin");
  return (
    <>
      <div className="top">
        <div className="top-inner">
          <div className="brand">
            InsureBot Security Lab<small>MCP 2026-07-28</small>
          </div>
          <div className="who">
            <b>{c.username}</b>
            <span className="chip accent">agency {c.tenant}</span>
            {isAdmin && <span className="chip warn">admin</span>}
            {c.scopes.filter((s) => s.includes(":")).map((s) => (
              <span key={s} className="chip mono">{s}</span>
            ))}
            <button className="btn small" onClick={logout}>Log out</button>
          </div>
        </div>
        <nav className="tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" className="tab" aria-selected={tab === t.id} onClick={() => go(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
      </div>
      <main>
        {tab === "playground" && <Playground jaeger={me.links.jaeger} onTrace={(id) => { setTrace(id); go("evidence"); }} />}
        {tab === "attacks" && <AttackLab jaeger={me.links.jaeger} onTrace={(id) => { setTrace(id); go("evidence"); }} />}
        {tab === "evidence" && <Evidence jaeger={me.links.jaeger} trace={trace} clearTrace={() => setTrace("")} />}
        {tab === "policies" && <PolicyEditor isAdmin={isAdmin} />}
      </main>
    </>
  );
}
