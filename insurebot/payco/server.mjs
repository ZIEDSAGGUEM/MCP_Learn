// PayCo: a mock payment provider for the lab (step 04). Behaves like Stripe in the ways that matter:
//  - only InsureBot's own API key is accepted, never a user's token (Episode 9)
//  - Idempotency-Key: the same key returns the same charge, never a second one (Episode 5)
import { randomUUID } from "node:crypto";
import http from "node:http";

const API_KEY = process.env.PAYCO_API_KEY;
if (!API_KEY || API_KEY.length < 32) throw new Error("PAYCO_API_KEY must be set (at least 32 characters)");

const charges = []; // in memory: one PayCo instance in the lab
const byIdempotencyKey = new Map(); // key -> { bodyJson, charge }

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

http
  .createServer(async (req, res) => {
    // Authentication: InsureBot's API key only
    if (req.headers.authorization !== `Bearer ${API_KEY}`) {
      console.log(`401 ${req.method} ${req.url}: wrong or missing API key`);
      return send(res, 401, { error: "invalid_api_key" });
    }

    if (req.method === "GET" && req.url === "/v1/charges") return send(res, 200, { data: charges });

    if (req.method === "POST" && req.url === "/v1/charges") {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const key = req.headers["idempotency-key"];
      if (!key) return send(res, 400, { error: "idempotency_key_required" });

      const seen = byIdempotencyKey.get(key);
      if (seen) {
        // Same key + same request: replay the first result. Same key + different request: refuse.
        if (seen.bodyJson !== raw) return send(res, 409, { error: "idempotency_key_reused_with_different_request" });
        console.log(`replayed ${seen.charge.id} for key ${key}`);
        return send(res, 200, seen.charge, { "idempotent-replayed": "true" });
      }

      const body = JSON.parse(raw);
      if (!Number.isInteger(body.amount_cents) || body.amount_cents <= 0) return send(res, 400, { error: "invalid_amount" });
      const charge = {
        id: "ch_" + randomUUID().replaceAll("-", "").slice(0, 20),
        amount_cents: body.amount_cents,
        currency: body.currency,
        description: body.description,
        metadata: body.metadata ?? {},
        idempotency_key: key,
        created: new Date().toISOString(),
      };
      charges.push(charge);
      byIdempotencyKey.set(key, { bodyJson: raw, charge });
      console.log(`charged ${charge.amount_cents / 100} ${charge.currency} -> ${charge.id}`);
      return send(res, 201, charge);
    }

    send(res, 404, { error: "not_found" });
  })
  .listen(4000, "0.0.0.0", () => console.log("PayCo mock on :4000"));
