# InsureBot attack report

Generated 2026-10-08 16:11 UTC by `npm run attack-report`, against the running lab.

**19 of 19 applicable attacks blocked** · 109 of 109 tests passed · 0 failed

Each row is an attack from the InsureBot story. "Blocked" means every test for it passed. The tests run the real attack
against the real stack (3 pods, gateway, Keycloak, Redis, Postgres, PDP, PayCo, Mailpit, Jaeger).

| # | Attack | OWASP / lesson | Blocked by (step) | Defence | Tests | Result |
|---|---|---|---|---|---|---|
| 1 | Calls land on any pod (no sticky sessions) | Lesson 1: stateless MCP | 01 | Stateless server; shared state in Redis | 2/2 | ✅ blocked |
| 2 | Bob reads Alice's quote with her quote ID | MCP07, State handle hijacking | 03 | Redis key = tenant + user from the token + random ID | 3/3 | ✅ blocked |
| 3 | Money moves without asking the human | LLM06 | 04 | MRTR confirmation before charging | 3/3 | ✅ blocked |
| 4 | Edited or replayed requestState | Lesson 2: MRTR | 04 | HMAC-signed requestState, bound to the user, 5-minute expiry | 3/3 | ✅ blocked |
| 5 | Double charge after a dropped connection | Lesson 2: no stream resume | 04 | Redis SET NX lock + PayCo idempotency key | 2/2 | ✅ blocked |
| 6 | Shared cache leaks an admin's tool list | MCP10, Lesson 2: cacheScope | 05 | cacheScope private + Cache-Control: private, no-store + Vary: Authorization | 3/3 | ✅ blocked |
| 7 | WAF fooled by a header that lies | Lesson 2: Mcp-Name header | 05 | SDK rejects header/body mismatch (-32020); WAF decides on headers | 4/4 | ✅ blocked |
| 8 | Another admin's report ID | MCP07 | 08 | Report ID = owner-bound handle | 1/1 | ✅ blocked |
| 9 | Token issued for another app / user token forwarded downstream | MCP07, Token passthrough | 02, 04 | Audience check; InsureBot pays PayCo with its own key | 2/2 | ✅ blocked |
| 10 | Guessable IDs | State handle hijacking | 03, 08 | 192-bit random IDs | 2/2 | ✅ blocked |
| 11 | All-powerful tokens / anyone can ask for an admin scope | MCP02, Scope minimization | 02, 05, 10 | Per-tool scopes + admin role checked by policy | 4/4 | ✅ blocked |
| 12 | Confused deputy through an OAuth proxy | Confused deputy | — | Not applicable: InsureBot is not an OAuth proxy to a third party | — | ➖ n/a |
| 13 | Prompt injection in a customer note tries to email data out | LLM01, LLM06, MCP06 | 07, 10 | No 'to' argument, fixed template, human confirmation, untrusted-text label, email-only-to-customer policy | 9/9 | ✅ blocked |
| 14 | Medical data leaks into chat, traces or logs | LLM02, MCP01 | 01, 06, 07, 09 | Minimal outputs; argument names only in audit; no bodies or values in traces | 3/3 | ✅ blocked |
| 15 | SQL injection through a tool argument | LLM05, MCP05 | 06 | Parameterized queries, escaped LIKE wildcards | 2/2 | ✅ blocked |
| 16 | Runaway agent floods the server | LLM10 | 07 | Per-agency rate limit in Redis, 429 + Retry-After | 1/1 | ✅ blocked |
| 17 | Agency taken from the model instead of the token | MCP07, MCP02 | 06 | Tenant from the token + Postgres RLS (ENABLE + FORCE) | 5/5 | ✅ blocked |
| 18 | Command injection through an external program | MCP05 | 08 | execFile with an argument array, format allowlist | 2/2 | ✅ blocked |
| 19 | "Who exported our data last night?" | MCP08 | 09 | Append-only audit log + traces linked by trace_id | 5/5 | ✅ blocked |
| 20 | Forgotten server without auth, secrets in Git, bad dependencies | MCP09, MCP04, MCP03, LLM03 | 11 | Shadow scan, refuse to start without auth, gitleaks, pinned images, lockfile check, tool fingerprints | 6/6 | ✅ blocked |

## Tests per attack

### 1. Calls land on any pod (no sticky sessions)

- ✅ `test/step01.test.ts` Step 01: stateless InsureBot Episode 1: calls are spread across pods (no sticky sessions)
- ✅ `test/step01.test.ts` Step 01: stateless InsureBot a quote created on one pod is served by another (shared Redis)

### 2. Bob reads Alice's quote with her quote ID

- ✅ `test/step03.test.ts` Step 03: quotes belong to their owner Episode 2: Bob (Globex) with Alice's quote ID gets 'Quote not found'
- ✅ `test/step03.test.ts` Step 03: quotes belong to their owner Carol, same agency (Acme) but another user, can't read it either
- ✅ `test/step03.test.ts` Step 03: quotes belong to their owner 'not yours' looks exactly like 'doesn't exist' (no probing)

### 3. Money moves without asking the human

- ✅ `test/step04.test.ts` Step 04: the human confirms first (MRTR) Episode 3: round 1 asks, with the real amount, and charges nothing
- ✅ `test/step04.test.ts` Step 04: the human confirms first (MRTR) skipping the question (a 'yes' without our state) just asks again
- ✅ `test/step04.test.ts` Step 04: the human confirms first (MRTR) user says no → cancelled, nothing charged

### 4. Edited or replayed requestState

- ✅ `test/step04.test.ts` Step 04: requestState can't be tampered with or replayed (Episode 4) editing the state (amount €1) → 'Invalid or expired requestState', nothing charged
- ✅ `test/step04.test.ts` Step 04: requestState can't be tampered with or replayed (Episode 4) Bob replays Alice's state → rejected before the tool runs
- ✅ `test/step04.test.ts` Step 04: requestState can't be tampered with or replayed (Episode 4) a 'yes' given for quote A can't pay quote B

### 5. Double charge after a dropped connection

- ✅ `test/step04.test.ts` Step 04: never charge twice (Episode 5) re-sending the confirmed call returns the first receipt
- ✅ `test/step04.test.ts` Step 04: never charge twice (Episode 5) 5 identical calls at the same moment (on 3 pods) → exactly 1 charge

### 6. Shared cache leaks an admin's tool list

- ✅ `test/step05.test.ts` Step 05: the tool list depends on who is asking every MCP response tells HTTP caches not to store it
- ✅ `test/step05.test.ts` Step 05: shared caches (Episode 6) a cache that respects Cache-Control: Bob never gets Carol's admin tool list
- ✅ `test/step05.test.ts` Step 05: shared caches (Episode 6) LAB, the leak itself: a cache that IGNORES Cache-Control serves Carol's list to Bob

### 7. WAF fooled by a header that lies

- ✅ `test/step05.test.ts` Step 05: WAF rules on headers (Episode 7) public entrance blocks admin tools by their Mcp-Name header
- ✅ `test/step05.test.ts` Step 05: WAF rules on headers (Episode 7) bypass attempt: header says get_quote, body says agency_stats → WAF passes, server rejects -32020
- ✅ `test/step05.test.ts` Step 05: WAF rules on headers (Episode 7) bypass attempt: no Mcp-Name header at all → -32020
- ✅ `test/step05.test.ts` Step 05: WAF rules on headers (Episode 7) bypass attempt: header says tools/list, body does tools/call → -32020

### 8. Another admin's report ID

- ✅ `test/step08.test.ts` Step 08: a slow job behind a handle Episode 8: Erin (Globex admin) with Carol's report ID gets 'Report not found'

### 9. Token issued for another app / user token forwarded downstream

- ✅ `test/step02.test.ts` Step 02: every request is authenticated Episode 9: a real Keycloak token issued for ANOTHER app → 401
- ✅ `test/step04.test.ts` Step 04: InsureBot pays with its own key (Episode 9) PayCo rejects a user's token: only InsureBot's API key works

### 10. Guessable IDs

- ✅ `test/step03.test.ts` Step 03: how quotes are stored Episode 10: IDs are random (192 bits), not sequential
- ✅ `test/step08.test.ts` Step 08: a slow job behind a handle report IDs are random and the tool only exists for admins

### 11. All-powerful tokens / anyone can ask for an admin scope

- ✅ `test/step02.test.ts` Step 02: scopes limit what a token can do Episode 11: read-only token can't create quotes → 403 insufficient_scope naming quotes:write
- ✅ `test/step04.test.ts` Step 04: who may charge token without payments:charge → 403 naming payments:charge
- ✅ `test/step05.test.ts` Step 05: the tool list depends on who is asking MCP02: asking Keycloak for reports:admin doesn't make Alice an admin
- ✅ `test/step10.test.ts` Step 10: the policies themselves (asked directly over AuthZEN) admin-tools-need-admin

### 13. Prompt injection in a customer note tries to email data out

- ✅ `test/step07.test.ts` Step 07: get_customer labels untrusted text a note can't close the label early and pretend to be outside it
- ✅ `test/step07.test.ts` Step 07: Episode 13, the fooled model tries to email Mallory email_quote has no 'to' argument at all
- ✅ `test/step07.test.ts` Step 07: Episode 13, the fooled model tries to email Mallory model adds to: backup@mallory.test → ignored; the user is shown Jean's real address
- ✅ `test/step07.test.ts` Step 07: Episode 13, the fooled model tries to email Mallory the email body is a fixed template: one quote, never a customer list
- ✅ `test/step07.test.ts` Step 07: Episode 13, the fooled model tries to email Mallory nothing is sent without the human's yes (round 1 only)
- ✅ `test/step07.test.ts` Step 07: Episode 13, the fooled model tries to email Mallory a 'yes' given to charge a card can't be replayed to send an email
- ✅ `test/step07.test.ts` Step 07: Episode 13, the fooled model tries to email Mallory Bob can't email an Acme customer, even with his own quote
- ✅ `test/step07.test.ts` Step 07: Episode 13, the fooled model tries to email Mallory a client that can't ask the user can't send email (-32021)
- ✅ `test/step10.test.ts` Step 10: the policies themselves (asked directly over AuthZEN) email-only-to-customer: the recipient must be the customer's own address

### 14. Medical data leaks into chat, traces or logs

- ✅ `test/step06.test.ts` Step 06: search_customers only sees your own agency LLM02: results carry no email and no notes
- ✅ `test/step09.test.ts` Step 09: no secrets or medical data in traces and logs (MCP01, LLM02) a trace of start_quote holds no diagnosis, no token
- ✅ `test/step09.test.ts` Step 09: no secrets or medical data in traces and logs (MCP01, LLM02) container logs hold no tokens, keys, passwords or diagnoses

### 15. SQL injection through a tool argument

- ✅ `test/step06.test.ts` Step 06: search_customers only sees your own agency Episode 15: SQL injection in the name is just text
- ✅ `test/step06.test.ts` Step 06: search_customers only sees your own agency LIKE wildcards are literal: '%%' doesn't list everyone

### 16. Runaway agent floods the server

- ✅ `test/step07.test.ts` Step 07: Episode 16, a runaway agent can't flood the server Initech floods → 429 with Retry-After; Globex keeps working

### 17. Agency taken from the model instead of the token

- ✅ `test/step06.test.ts` Step 06: search_customers only sees your own agency Episode 17: a Globex-only customer is invisible to Alice
- ✅ `test/step06.test.ts` Step 06: search_customers only sees your own agency Episode 17: Alice (or an injected prompt) passes tenant_id: 'globex' → ignored
- ✅ `test/step06.test.ts` Step 06: what RLS does inside Postgres (as insurebot_app) no tenant set → zero rows (fails closed)
- ✅ `test/step06.test.ts` Step 06: what RLS does inside Postgres (as insurebot_app) a buggy query with no WHERE still returns only the current tenant's rows
- ✅ `test/step06.test.ts` Step 06: what RLS does inside Postgres (as insurebot_app) acting as Acme, inserting a Globex row → rejected

### 18. Command injection through an external program

- ✅ `test/step08.test.ts` Step 08: Episode 18, command injection format is an allowlist: 'csv; touch /tmp/pwned' is rejected before anything runs
- ✅ `test/step08.test.ts` Step 08: Episode 18, command injection a customer named '$(touch /tmp/pwned) ; …' goes through gzip as plain data

### 19. "Who exported our data last night?"

- ✅ `test/step09.test.ts` Step 09: refused requests are audited too no token → 'unauthenticated', with the tool it tried
- ✅ `test/step09.test.ts` Step 09: refused requests are audited too missing scope → 'forbidden', and we know who tried
- ✅ `test/step09.test.ts` Step 09: Episode 19, 'who exported Acme's data?' the audit log names Carol, and Jaeger shows the same request down to the SQL
- ✅ `test/step09.test.ts` Step 09: Episode 19, 'who exported Acme's data?' the auditor's question, answered with one query
- ✅ `test/step09.test.ts` Step 09: the audit log can't be tampered with by the app insurebot_app can INSERT, but not read, change or delete audit rows

### 20. Forgotten server without auth, secrets in Git, bad dependencies

- ✅ `test/step11.test.ts` Step 11: what we install is what we reviewed lockfile: every package from the npm registry over HTTPS, with a sha512 hash
- ✅ `test/step11.test.ts` Step 11: what we install is what we reviewed every Docker image is pinned to a version AND a digest, none uses :latest
- ✅ `test/step11.test.ts` Step 11: tool poisoning (MCP03) the tools InsureBot exposes match the reviewed manifest
- ✅ `test/step11.test.ts` Step 11: shadow MCP servers (Episode 20, MCP09) every lab entrance refuses anonymous MCP calls
- ✅ `test/step11.test.ts` Step 11: shadow MCP servers (Episode 20, MCP09) a forgotten demo server without auth is found
- ✅ `test/step11.test.ts` Step 11: shadow MCP servers (Episode 20, MCP09) InsureBot itself refuses to start without its Keycloak settings

## Other checks (47)

Tests that support the defences without being tied to one attack (normal use, setup, discovery).

- ✅ `test/step01.test.ts` Step 01: stateless InsureBot lists the tools
- ✅ `test/step01.test.ts` Step 01: stateless InsureBot start_quote then get_quote returns the same quote
- ✅ `test/step01.test.ts` Step 01: stateless InsureBot raw 2026-07-28 request: no session, _meta envelope, private cache scope
- ✅ `test/step01.test.ts` Step 01: stateless InsureBot unknown quote ID returns 'Quote not found'
- ✅ `test/step01.test.ts` Step 01: stateless InsureBot schema rejects bad input from the model (age 12, malformed ID)
- ✅ `test/step02.test.ts` Step 02: every request is authenticated no token → 401 with a pointer to the login server
- ✅ `test/step02.test.ts` Step 02: every request is authenticated garbage token → 401
- ✅ `test/step02.test.ts` Step 02: every request is authenticated forged token (right claims, attacker's key) → 401
- ✅ `test/step02.test.ts` Step 02: every request is authenticated alg=none token → 401
- ✅ `test/step02.test.ts` Step 02: every request is authenticated a valid token works
- ✅ `test/step02.test.ts` Step 02: scopes limit what a token can do read-only token can still read
- ✅ `test/step02.test.ts` Step 02: scopes limit what a token can do _meta clientInfo is not identity: claiming to be 'admin' changes nothing
- ✅ `test/step02.test.ts` Step 02: discovery protected resource metadata names Keycloak and the 4 scopes
- ✅ `test/step03.test.ts` Step 03: quotes belong to their owner Alice can read her own quote, from any pod
- ✅ `test/step03.test.ts` Step 03: quotes belong to their owner MCP07: Bob can't pass the owner as an argument
- ✅ `test/step03.test.ts` Step 03: how quotes are stored Redis key includes tenant and user from the token; no owner-less key exists
- ✅ `test/step03.test.ts` Step 03: how quotes are stored quotes expire: TTL is set and at most 30 minutes
- ✅ `test/step04.test.ts` Step 04: who may charge a client that can't ask the user can't charge at all (-32021)
- ✅ `test/step04.test.ts` Step 04: who may charge Bob can't even start charging Alice's quote
- ✅ `test/step04.test.ts` Step 04: the human confirms first (MRTR) user says yes → charged once, the amount from OUR store
- ✅ `test/step05.test.ts` Step 05: the tool list depends on who is asking an agent sees 6 tools, an admin sees 9
- ✅ `test/step05.test.ts` Step 05: WAF rules on headers (Episode 7) admin entrance lets Carol use it, for her own agency only
- ✅ `test/step06.test.ts` Step 06: search_customers only sees your own agency 'Dupont' exists in both agencies: Alice gets Acme's, Bob gets Globex's
- ✅ `test/step06.test.ts` Step 06: what RLS does inside Postgres (as insurebot_app) acting as Acme, moving a customer to Globex → rejected
- ✅ `test/step06.test.ts` Step 06: what RLS does inside Postgres (as insurebot_app) the app role can't delete, and can't switch RLS off
- ✅ `test/step06.test.ts` Step 06: what RLS does inside Postgres (as insurebot_app) the tenant doesn't survive the transaction (safe connection pooling)
- ✅ `test/step06.test.ts` Step 06: why FORCE and the separate app role matter with FORCE, even the table owner sees zero rows without a tenant
- ✅ `test/step06.test.ts` Step 06: why FORCE and the separate app role matter WITHOUT FORCE, the owner sees every agency's rows (what the plan warned about)
- ✅ `test/step06.test.ts` Step 06: why FORCE and the separate app role matter a superuser bypasses RLS completely: never connect the app as postgres
- ✅ `test/step07.test.ts` Step 07: get_customer labels untrusted text Jean's note (the injection) comes back labeled as untrusted, with no email address
- ✅ `test/step07.test.ts` Step 07: get_customer labels untrusted text Bob (Globex) can't read Acme's customer (RLS)
- ✅ `test/step08.test.ts` Step 08: a slow job behind a handle export starts as 'running', becomes 'ready', and lists only Acme's customers
- ✅ `test/step08.test.ts` Step 08: a slow job behind a handle the public entrance blocks report tools (WAF)
- ✅ `test/step08.test.ts` Step 08: CSV formula injection a customer named =HYPERLINK(...) is written as text, not as a formula
- ✅ `test/step09.test.ts` Step 09: every tool call is audited start_quote → one row: who, which agency, which app, argument NAMES only, outcome
- ✅ `test/step09.test.ts` Step 09: every tool call is audited a confirmation round is recorded as input_required
- ✅ `test/step10.test.ts` Step 10: the policies themselves (asked directly over AuthZEN) only InsureBot may ask the PDP
- ✅ `test/step10.test.ts` Step 10: the policies themselves (asked directly over AuthZEN) AuthZEN discovery document
- ✅ `test/step10.test.ts` Step 10: the policies themselves (asked directly over AuthZEN) same-agency: allowed on your agency, denied on another (default deny)
- ✅ `test/step10.test.ts` Step 10: the policies themselves (asked directly over AuthZEN) big-premium-needs-admin: €455 denied for an agent, allowed for an admin; €50 fine for both
- ✅ `test/step10.test.ts` Step 10: the policies themselves (asked directly over AuthZEN) a malformed request is denied (400), never allowed
- ✅ `test/step10.test.ts` Step 10: the business rule, end to end Alice (agent) can't charge a €455 premium: refused before the user is even asked
- ✅ `test/step10.test.ts` Step 10: the business rule, end to end Carol (admin) can: the user is asked to confirm
- ✅ `test/step10.test.ts` Step 10: changing a rule needs no redeploy drop in a rule that freezes Globex's stats → applies within seconds; remove it → back to normal
- ✅ `test/step10.test.ts` Step 10: changing a rule needs no redeploy a policy file with a typo is NOT loaded: the last good policies stay in force
- ✅ `test/step11.test.ts` Step 11: secrets stay out of Git (MCP01) secret files are git-ignored and not tracked
- ✅ `test/step11.test.ts` Step 11: tool poisoning (MCP03) a hidden instruction added to a description changes the fingerprint

## Mutation checks done during the build

A test that can't fail proves nothing. Each of these was broken on purpose, the tests failed, then the fix was restored:

| Broken on purpose | What the tests caught |
|---|---|
| Quote key without the owner (step 03) | 6 of 8 step 03 tests failed: Bob read Alice's quote |
| No `Cache-Control` header (step 05) | Even the correctly configured cache leaked the admin tool list to Bob |
| RLS disabled on `customers` (step 06) | Alice's search returned Globex customers |
| `exec` instead of `execFile` (step 08, demo) | The injected `touch` command ran |
| A fake cloud key committed (step 11, throwaway clone) | gitleaks: "leaks found: 2" |
| A rogue MCP server without auth (step 11) | Shadow scan: "UNAUTHENTICATED MCP" |
| PDP stopped (step 10, manual) | Every tool call denied (fail closed) |

## Not covered

- **Episode 12, confused deputy:** InsureBot is not an OAuth proxy to a third-party API, so it can't happen here. It would apply if InsureBot ever used one shared client ID to act on users' Google or GitHub accounts.
- **A real model in the loop:** prompt-injection tests play the "fooled model" by sending what it would send. Connecting Claude is the next step to see it live.
- **Production concerns:** TLS, real secret storage, backups, multi-region, and a real (non-dev) Keycloak.
