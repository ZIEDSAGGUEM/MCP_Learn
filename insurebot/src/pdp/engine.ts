// Cedar policy engine for the PDP: loads *.cedar files and evaluates AuthZEN requests.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import * as cedar from "@cedar-policy/cedar-wasm/nodejs";

type Value = string | number | boolean | string[];
export type AuthZenRequest = {
  subject: { type: string; id: string; properties?: Record<string, Value> };
  action: { name: string; properties?: Record<string, Value> };
  resource: { type: string; id: string; properties?: Record<string, Value> };
  context?: Record<string, Value>;
};
export type Decision = { decision: boolean; reasons: string[]; errors: string[] };

let policies: Record<string, string> = {};
let loadedText = "";
let loadedAt = "";
let lastError: string | null = null;

/** What is in force right now (for the lab UI's policy editor). */
export function status() {
  return { policyIds: Object.keys(policies), loadedAt, lastError };
}

/** Parse a draft WITHOUT loading it: lets an editor check a change before saving it. */
export function check(text: string): { ok: true; policyIds: string[] } | { ok: false; errors: string[] } {
  const parts = cedar.policySetTextToParts(text);
  if (parts.type !== "success") return { ok: false, errors: parts.errors.map((e) => e.message) };
  const parse = cedar.checkParsePolicySet({ staticPolicies: text });
  if (parse.type !== "success") return { ok: false, errors: parse.errors.map((e) => e.message) };
  return { ok: true, policyIds: parts.policies.map((p, i) => p.match(/@id\("([^"]+)"\)/)?.[1] ?? `policy${i}`) };
}

/**
 * Load every *.cedar file in the folder. If the new text doesn't parse, KEEP the last good policies:
 * a typo must never switch authorization off (or on).
 */
export async function loadPolicies(dir: string): Promise<void> {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".cedar")).sort();
  const text = (await Promise.all(files.map((f) => readFile(join(dir, f), "utf8")))).join("\n");
  if (text === loadedText) return;

  const parts = cedar.policySetTextToParts(text);
  if (parts.type !== "success") {
    lastError = parts.errors.map((e) => e.message).join("; ");
    console.error("policies NOT reloaded, parse error:", JSON.stringify(parts.errors));
    return;
  }
  const next: Record<string, string> = {};
  parts.policies.forEach((p, i) => {
    const id = p.match(/@id\("([^"]+)"\)/)?.[1] ?? `policy${i}`;
    next[next[id] ? `${id}#${i}` : id] = p;
  });
  policies = next;
  loadedText = text;
  loadedAt = new Date().toISOString();
  lastError = null;
  console.log(`loaded ${Object.keys(policies).length} policies from ${files.join(", ")}`);
}

// AuthZEN types are lower-case words ("user", "quote"); Cedar entity types are capitalized
const cedarType = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

export function evaluate(req: AuthZenRequest): Decision {
  const principal = { type: cedarType(req.subject.type), id: req.subject.id };
  const resource = { type: cedarType(req.resource.type), id: req.resource.id };
  const answer = cedar.isAuthorized({
    principal,
    action: { type: "Action", id: req.action.name },
    resource,
    context: req.context ?? {},
    policies: { staticPolicies: policies },
    entities: [
      { uid: principal, attrs: req.subject.properties ?? {}, parents: [] },
      { uid: resource, attrs: req.resource.properties ?? {}, parents: [] },
    ],
  });
  if (answer.type !== "success") {
    return { decision: false, reasons: [], errors: answer.errors.map((e) => e.message) }; // fail closed
  }
  return {
    decision: answer.response.decision === "allow",
    reasons: answer.response.diagnostics.reason,
    errors: answer.response.diagnostics.errors.map((e) => `${e.policyId}: ${e.error.message}`),
  };
}
