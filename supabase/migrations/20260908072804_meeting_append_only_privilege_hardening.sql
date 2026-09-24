-- TRUNCATE does not fire per-row append-only triggers. Keep the existing
-- service CRUD interface, but remove privileges that can bypass its intent.
-- No historical migration or business row is rewritten by this migration.
revoke truncate, references, trigger
  on table public.meeting_minute_versions, public.meeting_action_updates
  from service_role;

-- PostgreSQL 17 added MAINTAIN to table privileges. Enumerating the older
-- privilege list leaves it behind on managed installations with default ALL.
-- This changes future grants only; explicit CRUD grants on existing tables
-- remain unchanged. Every future exposed table must grant its own least scope.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated, service_role;

-- The deployed baseline and local PGlite both use PostgreSQL 17+. MAINTAIN
-- permits maintenance operations, never an application request capability.
-- Do not remove existing SELECT/INSERT/UPDATE/DELETE privileges here.
revoke maintain on all tables in schema public from anon, authenticated, service_role;
