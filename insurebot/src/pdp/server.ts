// PDP (Policy Decision Point), step 10. Answers "may this subject do this action on this resource?"
// over the AuthZEN Authorization API 1.0 (https://openid.net/specs/authorization-api-1_0.html).
// InsureBot is the PEP (Policy Enforcement Point): it asks here before acting, and denies if this is down.
import { timingSafeEqual } from "node:crypto";
import express from "express";
import * as z from "zod/v4";
import { evaluate, loadPolicies } from "./engine.js";

const PORT = Number(process.env.PDP_PORT ?? 8181);
const POLICY_DIR = process.env.POLICY_DIR ?? "./policy";
const API_KEY = process.env.PDP_API_KEY ?? "";
if (Buffer.byteLength(API_KEY) < 32) throw new Error("PDP_API_KEY must be set (at least 32 bytes)");

const value = z.union([z.string(), z.number().int(), z.boolean(), z.array(z.string())]);
const props = z.record(z.string(), value).optional();
const evaluationRequest = z.object({
  subject: z.object({ type: z.string().min(1), id: z.string().min(1), properties: props }),
  action: z.object({ name: z.string().min(1), properties: props }),
  resource: z.object({ type: z.string().min(1), id: z.string().min(1), properties: props }),
  context: props,
});

const app = express();
app.use(express.json({ limit: "32kb" }));

app.get("/healthz", (_req, res) => res.json({ ok: true }));

// AuthZEN discovery
app.get("/.well-known/authzen-configuration", (req, res) => {
  const base = `${req.protocol}://${req.get("host")}`;
  res.json({ policy_decision_point: base, access_evaluation_endpoint: `${base}/access/v1/evaluation` });
});

// Only InsureBot may ask: the decisions (and their reasons) are internal information
function requireApiKey(req: express.Request, res: express.Response, next: express.NextFunction) {
  const given = Buffer.from(req.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${API_KEY}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
}

app.post("/access/v1/evaluation", requireApiKey, (req, res) => {
  const parsed = evaluationRequest.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ decision: false, context: { error: "invalid request" } });
  const result = evaluate(parsed.data);
  res.json({ decision: result.decision, context: { reasons: result.reasons, errors: result.errors } });
});

await loadPolicies(POLICY_DIR);
// Reload every 2 s: a policy change takes effect without a rebuild or a redeploy
setInterval(() => void loadPolicies(POLICY_DIR).catch((err) => console.error("policy reload failed:", err.message)), 2000);

app.listen(PORT, "0.0.0.0", () => console.log(`PDP (Cedar, AuthZEN) on :${PORT}, policies from ${POLICY_DIR}`));
