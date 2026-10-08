-- Step 09: audit log (MCP08). One row per tool call, and per refused request (401/403/429).
-- Append-only for the app: it can INSERT, but not read, change or delete rows.
-- So a compromised app (or a bug) can't hide what it did.

CREATE TABLE IF NOT EXISTS audit_log (
  id          bigserial PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT now(),
  pod         text NOT NULL,          -- which instance answered
  trace_id    text,                   -- open the same request in Jaeger
  tenant_id   text,                   -- from the verified token (NULL when there was no valid token)
  sub         text,                   -- user id from the token
  client_id   text,                   -- which app made the call (azp)
  method      text,                   -- tools/call, ...
  tool        text,
  arg_keys    text[],                 -- argument NAMES only, never values: no medical data or secrets here (MCP01, LLM02)
  outcome     text NOT NULL,          -- ok | error | input_required | unauthenticated | forbidden | rate_limited
  duration_ms integer
);
CREATE INDEX IF NOT EXISTS audit_log_tenant_at ON audit_log (tenant_id, at DESC);
CREATE INDEX IF NOT EXISTS audit_log_trace ON audit_log (trace_id);

ALTER TABLE audit_log OWNER TO insurebot_owner;
REVOKE ALL ON audit_log FROM PUBLIC;
GRANT INSERT ON audit_log TO insurebot_app;
GRANT USAGE ON SEQUENCE audit_log_id_seq TO insurebot_app;

-- Who reads it: a separate auditor role (no login yet; grant it to a human or a SIEM connector later)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'insurebot_auditor') THEN
    CREATE ROLE insurebot_auditor NOLOGIN;
  END IF;
END
$$;
GRANT SELECT ON audit_log TO insurebot_auditor;
