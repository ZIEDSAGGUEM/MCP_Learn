#!/bin/bash
# Lab UI: a login role that can READ the audit log and nothing else (member of insurebot_auditor).
# The app role (insurebot_app) still can't read it: the UI uses its own, separate role.
set -euo pipefail
: "${LAB_VIEWER_PASSWORD:?LAB_VIEWER_PASSWORD must be set}"

psql -v ON_ERROR_STOP=1 --username "${POSTGRES_USER:-postgres}" --dbname "${POSTGRES_DB:-insurebot}" \
  -v viewer_password="$LAB_VIEWER_PASSWORD" <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'insurebot_lab_viewer') THEN
    CREATE ROLE insurebot_lab_viewer LOGIN NOINHERIT;
  END IF;
END
$$;
ALTER ROLE insurebot_lab_viewer WITH LOGIN INHERIT PASSWORD :'viewer_password';
GRANT insurebot_auditor TO insurebot_lab_viewer;
GRANT CONNECT ON DATABASE insurebot TO insurebot_lab_viewer;
SQL
