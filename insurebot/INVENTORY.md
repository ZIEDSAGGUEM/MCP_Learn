# InsureBot inventory

Every place InsureBot (or a copy of it) runs, and every service it depends on. Episode 20 / MCP09: a server that isn't on
this list is a **shadow server**. Find it with `npx tsx scripts/shadow-mcp-scan.ts`, then protect it or shut it down.

Rule: a new deployment is added here **before** it starts. InsureBot refuses to start without `OIDC_ISSUER` and
`RESOURCE_URL`, so a copy can't run without authentication by accident.

## MCP endpoints

| Name | URL | Auth | Exposed to | Owner | Purpose |
|---|---|---|---|---|---|
| InsureBot public entrance | http://localhost:3000/mcp | Keycloak token, WAF blocks admin tools | 127.0.0.1 only | Zied | Agents (Alice, Bob) |
| InsureBot admin entrance | http://localhost:3002/mcp | Keycloak token + admin role (Cedar) | 127.0.0.1 only | Zied | Admins (Carol, Erin) |
| Lab: good shared cache | http://localhost:3003/mcp | Keycloak token | 127.0.0.1 only | Zied | Step 05 cache lesson |
| Lab: broken shared cache | http://localhost:3004/mcp | Keycloak token | 127.0.0.1 only | Zied | Step 05: shows the Episode 6 leak. Never deploy. |
| Security Lab UI (MCP client, not a server) | http://localhost:3005 | Keycloak login (`insurebot-ui`, PKCE) | 127.0.0.1 only | Zied | Lab only: its Attack lab uses the test accounts. Never deploy. |

## Supporting services (lab)

| Service | URL | Auth | Holds |
|---|---|---|---|
| Keycloak | http://localhost:8080 | admin / admin (dev only) | Users, roles, client config |
| PDP (Cedar + AuthZEN) | http://localhost:8181 | `PDP_API_KEY` | Authorization policies (`policy/*.cedar`) |
| Postgres | localhost:5432 | `insurebot_app` (pods), `postgres` (migrations) | Customers (RLS), audit log |
| Redis | localhost:6381 | none, 127.0.0.1 only | Quotes, payments state, reports, rate limits |
| PayCo (mock) | http://localhost:4000 | `PAYCO_API_KEY` | Charges |
| Mailpit | http://localhost:8025 | none, 127.0.0.1 only | Every email sent |
| Jaeger | http://localhost:16686 | none, 127.0.0.1 only | Traces (no PII by design) |

## Secrets

| Secret | Where | Rotate by |
|---|---|---|
| `PAYCO_API_KEY`, `REQUEST_STATE_KEY`, `PDP_API_KEY`, `INSUREBOT_APP_PASSWORD` | `.env` (git-ignored) | New value in `.env`, `docker compose up -d` |
| Test user passwords | `.env.test` (git-ignored) and Keycloak | Keycloak admin, then `.env.test` |
| Realm export with password hashes | `keycloak/insurebot-realm.json` (git-ignored) | Re-export after changes |

If a secret is ever committed: **revoke it first**. Deleting the file doesn't remove it from Git history.
