import type express from "express";
import { principal } from "./auth.js";
import { config } from "./config.js";
import { redis } from "./redis.js";

/**
 * LLM10 / Episode 16: an agent stuck in a loop can send thousands of calls.
 * Each AGENCY gets a budget of requests per minute, counted in Redis so all pods share it.
 * One agency running wild can't slow down or bill the others.
 * Runs after authentication, so the agency comes from the verified token.
 */
export async function rateLimitPerTenant(req: express.Request, res: express.Response, next: express.NextFunction) {
  try {
    const who = principal(req.auth);
    const minute = Math.floor(Date.now() / 60_000);
    const key = `rl:${who.tenant}:${minute}`;
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, 120);
    if (count > config.rateLimitPerMinute) {
      const retryAfter = 60 - (Math.floor(Date.now() / 1000) % 60);
      res.set("Retry-After", String(retryAfter));
      return res.status(429).json({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32000, message: `Too many requests for your agency. Try again in ${retryAfter} s.` },
      });
    }
    next();
  } catch (err) {
    next(err);
  }
}
