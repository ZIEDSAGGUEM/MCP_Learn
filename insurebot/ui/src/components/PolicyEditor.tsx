"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";

type Status = { policyIds: string[]; loadedAt: string; lastError: string | null };

export default function PolicyEditor({ isAdmin }: { isAdmin: boolean }) {
  const [text, setText] = useState("");
  const [saved, setSaved] = useState("");
  const [status, setStatus] = useState<Status | null>(null);
  const [isDefault, setIsDefault] = useState(true);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad" | "warn"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const r = await api<{ text: string; isDefault: boolean; status: Status }>("/api/policy");
    setText(r.text);
    setSaved(r.text);
    setIsDefault(r.isDefault);
    setStatus(r.status);
  }
  useEffect(() => {
    load().catch((e) => setMsg({ tone: "bad", text: e.message }));
  }, []);

  async function act(action: "check" | "save" | "reset") {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ ok: boolean; saved?: boolean; errors?: string[]; policyIds?: string[] }>("/api/policy", { method: "POST", body: { action, text } });
      if (!r.ok) setMsg({ tone: "bad", text: `Cedar refused it: ${(r.errors ?? []).join("; ")}` });
      else if (action === "check") setMsg({ tone: "ok", text: `Valid. Policies: ${(r.policyIds ?? []).join(", ")}` });
      else {
        setMsg({ tone: "ok", text: action === "reset" ? "Restored the original rules. The PDP reloads them within 2 seconds." : "Saved. The PDP reloads it within 2 seconds. Try the change in the Playground or the Attack lab." });
        setTimeout(() => void load(), 2500);
        if (action === "reset") await load();
      }
    } catch (e) {
      setMsg({ tone: "bad", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="notice">
        These are InsureBot&apos;s authorization rules (<code>policy/insurebot.cedar</code>). The PDP reloads them every 2 seconds with no redeploy.
        A draft is checked by Cedar before it is saved, and a broken file never replaces the working rules.
        Try: change <code>20000</code> to <code>3000</code> (€30), save, then charge a premium as Alice.
      </div>
      <div className="panel">
        <div className="panel-head">
          <h2>Rules in force</h2>
          {status?.policyIds.map((id) => (
            <span key={id} className="chip accent mono">{id}</span>
          ))}
          <span className="grow" />
          {!isDefault && <span className="chip warn">changed from the original</span>}
          {status?.loadedAt && <span className="muted">loaded {new Date(status.loadedAt).toLocaleTimeString()}</span>}
        </div>
        <div className="panel-body stack">
          {status?.lastError && <div className="banner">The last file change didn&apos;t load: {status.lastError}. The previous rules stay in force.</div>}
          <textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} style={{ minHeight: 420 }} aria-label="Cedar policies" />
          {msg && <div className={`result ${msg.tone}`}>{msg.text}</div>}
          <div className="row">
            <button className="btn" disabled={busy} onClick={() => act("check")}>Check</button>
            <button className="btn primary" disabled={busy || !isAdmin || text === saved} onClick={() => act("save")}>Save</button>
            <button className="btn danger" disabled={busy || !isAdmin || isDefault} onClick={() => act("reset")}>Restore original</button>
            {!isAdmin && <span className="muted">Only admins can save. Log in as Carol or Erin.</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
