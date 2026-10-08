import { createClient } from "redis";
import { config } from "./config.js";

// Shared by every pod: any pod can read what another pod wrote.
export const redis = createClient({ url: config.redisUrl });
redis.on("error", (err) => console.error("redis error:", err.message));
