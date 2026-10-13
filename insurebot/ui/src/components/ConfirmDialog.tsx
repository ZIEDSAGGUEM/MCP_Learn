"use client";
import { useState } from "react";

type InputRequest = { method: string; params?: { message?: string; requestedSchema?: { properties?: Record<string, { type?: string; description?: string }> } } };

// MRTR round 1 returned input_required: show the server's question, like Claude Code does.
export default function ConfirmDialog({
  requests,
  onAnswer,
}: {
  requests: Record<string, InputRequest>;
  onAnswer: (responses: Record<string, unknown> | null) => void;
}) {
  const [values, setValues] = useState<Record<string, Record<string, boolean>>>(() => {
    const v: Record<string, Record<string, boolean>> = {};
    for (const [k, r] of Object.entries(requests)) {
      v[k] = {};
      for (const [p, s] of Object.entries(r.params?.requestedSchema?.properties ?? {})) if (s.type === "boolean") v[k][p] = true;
    }
    return v;
  });
  return (
    <div className="modal-back" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
      <div className="modal">
        <h3 id="confirm-title">InsureBot asks you</h3>
        {Object.entries(requests).map(([key, r]) => (
          <div key={key} className="stack">
            <div className="result warn">{r.params?.message ?? `${r.method} (${key})`}</div>
            {Object.entries(r.params?.requestedSchema?.properties ?? {}).map(([p, s]) =>
              s.type === "boolean" ? (
                <label key={p} className="row">
                  <input
                    type="checkbox"
                    checked={values[key]?.[p] ?? false}
                    onChange={(e) => setValues({ ...values, [key]: { ...values[key], [p]: e.target.checked } })}
                  />
                  {s.description ?? p}
                </label>
              ) : null,
            )}
          </div>
        ))}
        <p className="muted" style={{ margin: 0 }}>
          This is MRTR: the server returned instead of waiting. Your answer goes back in a second request, with the signed note from round 1.
        </p>
        <div className="row">
          <button
            className="btn primary"
            onClick={() =>
              onAnswer(Object.fromEntries(Object.keys(requests).map((k) => [k, { action: "accept", content: values[k] ?? {} }])))
            }
          >
            Accept
          </button>
          <button className="btn" onClick={() => onAnswer(Object.fromEntries(Object.keys(requests).map((k) => [k, { action: "decline" }])))}>
            Decline
          </button>
          <button className="btn" onClick={() => onAnswer(null)}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
