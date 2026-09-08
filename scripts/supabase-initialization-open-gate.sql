-- Restore only original schema USAGE after successful migration/RLS verification.
-- Never restore CREATE or pre-migration table/function default privileges.
-- Operators must verify exact local/remote migration parity before running.
begin;
do $$
begin
  if current_user <> 'postgres' then
    raise exception 'Initialization requires the verified postgres owner';
  end if;
  if has_schema_privilege('anon', 'public', 'CREATE')
     or has_schema_privilege('authenticated', 'public', 'CREATE') then
    raise exception 'Unexpected public schema CREATE privilege';
  end if;
  if to_regclass('public.clients') is null
     or to_regclass('public.meeting_minute_versions') is null
     or to_regclass('private.reauth_events') is null then
    raise exception 'Application schema is incomplete';
  end if;
  if exists (select 1 from auth.users)
     or exists (select 1 from public.profiles)
     or exists (select 1 from public.memberships)
     or exists (select 1 from storage.objects) then
    raise exception 'Initialization scope excludes accounts or attachments';
  end if;
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'private') and c.relkind in ('r', 'p')
      and (not c.relrowsecurity or not c.relforcerowsecurity
        or pg_get_userbyid(c.relowner) <> 'postgres')
  ) then
    raise exception 'Application table RLS, FORCE RLS or owner mismatch';
  end if;
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'private') and c.relkind in ('r', 'p')
      and has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,MAINTAIN')
  ) then
    raise exception 'Anonymous business-table privileges found';
  end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.prosecdef
      and (n.nspname <> 'private' or pg_get_userbyid(p.proowner) <> 'postgres'
        or not coalesce(p.proconfig @> array['search_path=""'], false))
  ) then
    raise exception 'SECURITY DEFINER namespace, owner or search_path mismatch';
  end if;
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
      and (has_table_privilege('authenticated', c.oid, 'TRUNCATE,MAINTAIN')
        or has_table_privilege('service_role', c.oid, 'TRUNCATE,MAINTAIN'))
  ) then
    raise exception 'Excessive API-role table privileges found';
  end if;
  if has_table_privilege('service_role', 'public.meeting_minute_versions', 'TRUNCATE')
     or has_table_privilege('service_role', 'public.meeting_action_updates', 'TRUNCATE') then
    raise exception 'Append-only privilege hardening is missing';
  end if;
end;
$$;
grant usage on schema public to public, anon, authenticated;
commit;
