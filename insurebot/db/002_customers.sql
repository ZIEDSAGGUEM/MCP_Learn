-- Step 06: customers, isolated per agency by row-level security (RLS).
-- Safe to run again: everything is "if not exists" or replaced.

CREATE TABLE IF NOT EXISTS customers (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  text NOT NULL,
  name       text NOT NULL,
  email      text NOT NULL,
  city       text,
  notes      text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customers_tenant_name ON customers (tenant_id, name);

-- The app role doesn't own the table, so it can't ALTER it or switch RLS off
ALTER TABLE customers OWNER TO insurebot_owner;

-- Turn RLS on. FORCE makes it apply to the table OWNER as well:
-- without FORCE, insurebot_owner would see every agency's rows.
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers FORCE ROW LEVEL SECURITY;

-- The rule: a row is visible (USING) and writable (WITH CHECK) only when its tenant_id
-- equals app.tenant_id, which the app sets per transaction from the VERIFIED TOKEN.
-- If app.tenant_id isn't set, current_setting(..., true) returns NULL or '' and nothing matches:
-- forgetting to set it fails CLOSED (zero rows), never open.
DROP POLICY IF EXISTS tenant_isolation ON customers;
CREATE POLICY tenant_isolation ON customers
  USING      (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

REVOKE ALL ON customers FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO insurebot_app;
GRANT SELECT, INSERT, UPDATE ON customers TO insurebot_app;  -- no DELETE, no TRUNCATE
