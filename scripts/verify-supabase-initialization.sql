-- Read-only verification with transaction-local role simulation, not an Auth/MFA test.
-- Run only against the explicitly approved project after opening the schema gate.
begin;
do $$
begin
  if current_user <> 'postgres' then
    raise exception 'Verification requires the verified postgres owner';
  end if;
  if not has_schema_privilege('anon', 'public', 'USAGE')
     or not has_schema_privilege('authenticated', 'public', 'USAGE')
     or has_schema_privilege('anon', 'public', 'CREATE')
     or has_schema_privilege('authenticated', 'public', 'CREATE') then
    raise exception 'Verify only after restoring USAGE while keeping CREATE denied';
  end if;
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'private') and c.relkind in ('r', 'p')
      and (not c.relrowsecurity or not c.relforcerowsecurity
        or pg_get_userbyid(c.relowner) <> 'postgres')
  ) then
    raise exception 'RLS, FORCE RLS or table-owner verification failed';
  end if;
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'private') and c.relkind in ('r', 'p')
      and has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,MAINTAIN')
  ) then
    raise exception 'Anonymous table privileges found';
  end if;
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
      and (has_table_privilege('authenticated', c.oid, 'TRUNCATE,MAINTAIN')
        or has_table_privilege('service_role', c.oid, 'TRUNCATE,MAINTAIN'))
  ) then
    raise exception 'Excessive API-role table privileges found';
  end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.prosecdef
      and (n.nspname <> 'private' or pg_get_userbyid(p.proowner) <> 'postgres'
        or not coalesce(p.proconfig @> array['search_path=""'], false))
  ) then
    raise exception 'SECURITY DEFINER namespace, owner or search_path verification failed';
  end if;
  if exists (select 1 from auth.users)
     or exists (select 1 from public.profiles)
     or exists (select 1 from public.memberships)
     or exists (select 1 from storage.objects) then
    raise exception 'Initialization scope excludes accounts and attachments';
  end if;
  if (select count(*) from public.organizations) <> 1
     or (select count(*) from public.branches) <> 1
     or (select count(*) from public.clients) <> 2 then
    raise exception 'Synthetic fixture counts differ from the approved scope';
  end if;
end;
$$;

set local role anon;
do $$
begin
  begin
    perform 1 from public.clients limit 1;
    raise exception 'Anonymous clients read unexpectedly permitted';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

-- Deliberately non-existent user; claims are test inputs, not a minted JWT/session.
select set_config('request.jwt.claims',
  '{"sub":"fbdd6216-f76a-4875-8b95-1ffb9867e7b6","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
do $$
declare
  v_table text;
  v_visible boolean;
begin
  foreach v_table in array array['clients', 'organizations', 'branches'] loop
    begin
      execute format('select exists (select 1 from public.%I)', v_table)
        into v_visible;
      if v_visible then
        raise exception 'Unassigned identity can read synthetic business data';
      end if;
    exception when insufficient_privilege then
      -- A deliberately RPC-only table may reject direct SELECT entirely.
      -- Verify each table independently; never grant access to satisfy a test.
      null;
    end;
  end loop;
end;
$$;
reset role;

select 'PASS' as initialization_database_checks,
  'role simulation only; no real Auth, MFA, frontend or cross-tenant E2E claim' as scope;
rollback;
