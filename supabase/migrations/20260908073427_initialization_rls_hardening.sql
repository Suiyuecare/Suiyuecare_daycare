-- Complete defense-in-depth RLS coverage before opening the initialization
-- gate. These exact private ledgers already deny all direct API-role grants;
-- their access path remains the existing guarded postgres-owned functions.
-- No business data, policies, grants, or historical migrations are changed.
do $initialization_rls_hardening$
declare
  v_table text;
begin
  if not exists (
    select 1 from pg_roles
    where rolname = 'postgres' and (rolbypassrls or rolsuper)
  ) then
    raise exception 'RLS hardening requires the existing guarded postgres owner to bypass RLS';
  end if;

  foreach v_table in array array[
    'abnormal_event_operations',
    'claim_service_allocations',
    'feedback_complaint_event_details',
    'feedback_complaint_operations',
    'feedback_complaint_sensitive_versions',
    'feedback_deadline_rule_versions',
    'inventory_item_operations',
    'inventory_movement_operations',
    'inventory_policy_versions',
    'inventory_safety_levels',
    'meeting_action_update_operations',
    'meeting_minute_operations',
    'staff_certificate_exception_approvals',
    'staff_certificate_exception_operations',
    'staff_certificate_exception_requests',
    'staff_certificate_operations',
    'staff_lab_report_operations',
    'staff_tocc_operations',
    'staff_training_record_operations',
    'staff_training_rule_operations',
    'staff_training_rule_proposals',
    'staff_training_rule_versions',
    'staff_vaccination_operations',
    'staff_vital_sign_operations'
  ] loop
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'private' and c.relname = v_table
        and c.relkind = 'r' and pg_get_userbyid(c.relowner) = 'postgres'
    ) then
      raise exception 'Unexpected owner or missing private ledger: %', v_table;
    end if;

    -- Do not invent a permissive policy to accommodate unexpected privilege
    -- drift. Stop for review if this is no longer an internal-only ledger.
    if exists (
      select 1 from (values ('anon'), ('authenticated'), ('service_role')) r(role_name)
      where has_table_privilege(
        r.role_name, format('private.%I', v_table),
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
      )
    ) then
      raise exception 'Unexpected direct API-role grant on private ledger: %', v_table;
    end if;

    execute format('alter table private.%I enable row level security', v_table);
    execute format('alter table private.%I force row level security', v_table);
  end loop;
end;
$initialization_rls_hardening$;

-- Existing meeting SELECT policies and guarded service CRUD grants remain
-- unchanged. FORCE closes the owner-bypass gap for non-BYPASSRLS owners.
alter table public.meeting_minute_versions force row level security;
alter table public.meeting_action_updates force row level security;
