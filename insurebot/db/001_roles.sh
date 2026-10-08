#!/bin/bash
# Step 06: two roles with separate jobs.
#   insurebot_owner: owns the tables, can't log in
#   insurebot_app:   what the pods connect as; reads/writes rows, can't change the schema, can't bypass RLS
# Never connect the app as "postgres": superusers ignore row-level security completely.
set -euo pipefail
: "${INSUREBOT_APP_PASSWORD:?INSUREBOT_APP_PASSWORD must be set}"

psql -v ON_ERROR_STOP=1 --username "${POSTGRES_USER:-postgres}" --dbname "${POSTGRES_DB:-insurebot}" \
  -v app_password="$INSUREBOT_APP_PASSWORD" <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'insurebot_owner') THEN
    CREATE ROLE insurebot_owner NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'insurebot_app') THEN
    CREATE ROLE insurebot_app LOGIN;
  END IF;
END
$$;

ALTER ROLE insurebot_app WITH LOGIN PASSWORD :'app_password'
  NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
SQL
