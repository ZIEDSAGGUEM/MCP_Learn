import pg from "pg";
import type { Principal } from "./auth.js";
import { config } from "./config.js";

// Connects as insurebot_app: not the table owner and not a superuser, so RLS always applies.
export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });
pool.on("error", (err) => console.error("postgres pool error:", err.message));

/**
 * Run queries for ONE tenant. Every database access goes through here.
 *
 * set_config(..., true) is the parameterized form of SET LOCAL: it lasts only until
 * COMMIT/ROLLBACK, so a pooled connection never carries Acme's tenant into Globex's request.
 * The tenant comes from the verified token (Principal), never from tool arguments or the model.
 */
export async function withTenant<T>(who: Principal, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [who.tenant]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
