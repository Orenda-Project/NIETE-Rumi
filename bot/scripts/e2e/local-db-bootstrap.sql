-- local-db-bootstrap.sql — the slice of Supabase the bot's schema and supabase-js expect, on plain Postgres.
-- Applied to every golden database before the schema (bd-z3ze4). Idempotent: roles are cluster-wide and
-- outlive one database, so they are created only when missing.
--
-- What it stands in for:
--   · the API roles PostgREST switches into (anon / authenticated / service_role) and the login role it
--     connects as (authenticator) — service_role bypasses RLS, exactly as on Supabase;
--   · the `extensions` schema Supabase installs extensions into (the dump qualifies `extensions.vector`);
--   · auth.uid() / auth.role() / auth.jwt(), which RLS policies call, read from the request's JWT claims;
--   · a minimal auth.users, for foreign keys that point at it.
-- Nothing here is a Supabase service: no GoTrue, no Storage, no Realtime. The bot uses none of them.

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated','supabase_admin','dashboard_user','supabase_auth_admin',
                           'supabase_storage_admin','supabase_realtime_admin','pgbouncer'] LOOP
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = r) THEN EXECUTE format('CREATE ROLE %I NOLOGIN NOINHERIT', r); END IF;
  END LOOP;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticator') THEN CREATE ROLE authenticator LOGIN NOINHERIT; END IF;
END $$;
-- Enforce the attributes every time, not only on creation: a role that already exists without them (a stand-in
-- made from a GRANT before this ran — bd-z3ze4.7, service_role lost BYPASSRLS on a fresh machine) is repaired.
ALTER ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
ALTER ROLE anon NOLOGIN NOINHERIT NOBYPASSRLS;
ALTER ROLE authenticated NOLOGIN NOINHERIT NOBYPASSRLS;
ALTER ROLE authenticator LOGIN NOINHERIT NOBYPASSRLS;
GRANT anon, authenticated, service_role TO authenticator;

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE EXTENSION IF NOT EXISTS pgcrypto    WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS vector      WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS btree_gist  WITH SCHEMA public;       -- the sandbox has it in public, not extensions

-- PostgREST ≥ 9 puts the whole claim set in request.jwt.claims; older Supabase SQL reads request.jwt.claim.*.
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(coalesce(current_setting('request.jwt.claim.sub', true), auth.jwt() ->> 'sub'), '')::uuid
$$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT nullif(coalesce(current_setting('request.jwt.claim.role', true), auth.jwt() ->> 'role'), '')
$$;
CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  email text, phone text, raw_user_meta_data jsonb, created_at timestamptz DEFAULT now()
);

GRANT USAGE ON SCHEMA public, extensions, auth TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon, authenticated, service_role;
-- Supabase's defaults: what a migration creates in public is reachable by the API roles (RLS still applies).
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
