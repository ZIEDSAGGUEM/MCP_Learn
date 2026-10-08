# MCP_Learn

A 13-week study plan on securing MCP servers (spec 2026-07-28), and the project built along the way.

| Path | What |
|---|---|
| [`file.md`](file.md) | The study plan and reading list |
| [`insurebot/`](insurebot/) | InsureBot: a multi-tenant MCP server for insurance agencies, hardened step by step (Keycloak, Redis, Postgres RLS, MRTR payments, audit + tracing, Cedar policies). See its README. |

Run it: `cd insurebot` and follow [`insurebot/README.md`](insurebot/README.md).

**Result:** 19 of 19 applicable attacks blocked, 109 tests passing. See the
[attack report](insurebot/security/ATTACK-REPORT.md) and the [inventory](insurebot/INVENTORY.md).
