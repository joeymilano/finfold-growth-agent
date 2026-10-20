-- Fix: service_role got "permission denied for table profiles" (42501) on
-- the new project. This is a base Postgres GRANT problem, not an RLS
-- problem and not a bad key — service_role should bypass RLS entirely, but
-- it never had table-level privileges on public.* to begin with on this
-- project (a known gotcha when tables are created via the SQL Editor and
-- the project's default privilege propagation to service_role didn't
-- apply). Safe to re-run.

-- 1. Grant on every table/sequence that exists right now.
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO service_role;
GRANT USAGE ON SCHEMA public TO service_role;

-- 2. Make sure any table/sequence/function created in the FUTURE (e.g. by
--    a later migration) automatically gets the same grant, so this never
--    has to be re-run after adding new tables.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;

-- 3. Verify: should return true for both rows below.
SELECT
  has_table_privilege('service_role', 'public.profiles', 'SELECT')      AS can_select_profiles,
  has_table_privilege('service_role', 'public.subscriptions', 'SELECT') AS can_select_subscriptions;
