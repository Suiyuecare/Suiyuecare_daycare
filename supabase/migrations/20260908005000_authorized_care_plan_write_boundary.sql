-- Until a governed central-source promotion workflow exists, no application
-- role may append directly to the authoritative care-plan ledger.  Keeping the
-- old permissive INSERT policy would make a future accidental grant silently
-- re-enable browser-authored "central" plans, so remove both the policy and the
-- underlying table privilege.  Database-owner migrations may still load
-- explicitly reviewed migration fixtures and a future guarded RPC can receive
-- only the narrow privileges it needs.

drop policy if exists authorized_care_plans_insert
  on public.authorized_care_plans;

revoke insert on table public.authorized_care_plans
  from public, anon, authenticated, service_role;

comment on table public.authorized_care_plans is
  'Append-only authoritative care-plan ledger. Direct application-role INSERT is disabled until a governed central-source promotion boundary is implemented.';
