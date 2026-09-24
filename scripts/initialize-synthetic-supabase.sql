-- Explicit, administrator-run schema smoke-test data only. This is NOT seed.sql
-- and must never be added to automatic deployments or production bootstrap.
-- Requires the reviewed application migrations and the real Supabase Auth
-- schema. Never run the PGlite Auth bootstrap against a hosted project.
-- No users, credentials, memberships, clinical records, services, or messages.
-- Inactive flags are labels/defense in depth, NOT an authorization boundary.

begin isolation level serializable;
set local statement_timeout = '30s';
set local lock_timeout = '5s';

do $synthetic_initializer$
declare
  v_request_id constant text := 'synthetic-bootstrap-v1:0b255030-6ccc-4873-b413-47d041e24b35';
  v_organization constant jsonb := '{
    "id":"695aa1a0-bc4c-4e3f-a646-8b808d47440b",
    "code":"test_schema_bootstrap_v1",
    "name":"[TEST] 合成資料驗證機構",
    "timezone":"Asia/Taipei",
    "is_active":false,
    "settings":{"data_classification":"synthetic","purpose":"schema_smoke_test_only","initializer":"daycare_schema_bootstrap_v1"}
  }'::jsonb;
  v_branch constant jsonb := '{
    "id":"cfe2c618-3b54-47fa-a723-b9cac6c8302c",
    "organization_id":"695aa1a0-bc4c-4e3f-a646-8b808d47440b",
    "code":"test_isolation",
    "name":"[TEST] 隔離測試分支",
    "capacity":null,
    "is_active":false,
    "settings":{"data_classification":"synthetic","purpose":"schema_smoke_test_only","initializer":"daycare_schema_bootstrap_v1"}
  }'::jsonb;
  v_clients constant jsonb := '[
    {
      "id":"64ff4ecc-60e4-49c4-ab0a-cd6c66934eb6",
      "organization_id":"695aa1a0-bc4c-4e3f-a646-8b808d47440b",
      "branch_id":"cfe2c618-3b54-47fa-a723-b9cac6c8302c",
      "client_code":"TEST-001","external_key":null,
      "display_name":"[TEST] 合成個案 001","date_of_birth":null,
      "national_id_ciphertext":null,"status":"suspended",
      "admitted_on":null,"ended_on":null,
      "source_system":"synthetic_schema_bootstrap_v1",
      "source_updated_at":null,"row_version":1
    },
    {
      "id":"0b443162-9cd3-4283-9e53-15d9d5edb578",
      "organization_id":"695aa1a0-bc4c-4e3f-a646-8b808d47440b",
      "branch_id":"cfe2c618-3b54-47fa-a723-b9cac6c8302c",
      "client_code":"TEST-002","external_key":null,
      "display_name":"[TEST] 合成個案 002","date_of_birth":null,
      "national_id_ciphertext":null,"status":"suspended",
      "admitted_on":null,"ended_on":null,
      "source_system":"synthetic_schema_bootstrap_v1",
      "source_updated_at":null,"row_version":1
    }
  ]'::jsonb;
  v_table record;
  v_row_exists boolean;
  v_organization_count bigint;
  v_branch_count bigint;
  v_client_count bigint;
  v_is_fresh boolean;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('daycare.synthetic.schema_bootstrap.v1', 0)
  );

  -- Never create or impersonate an application user to satisfy audit or MFA.
  if auth.uid() is not null or exists (select 1 from auth.users) then
    raise exception using errcode = '55000',
      message = 'SYNTHETIC_INITIALIZER_AUTH_NOT_EMPTY';
  end if;

  -- Only the migration-owned catalogs and existing audit trail may be nonempty.
  -- Dynamic identifiers come from pg_catalog, never caller/file contents.
  for v_table in
    select n.nspname as schema_name, c.relname as table_name
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'private')
      and c.relkind in ('r', 'p')
      and not (
        n.nspname = 'public'
        and c.relname in (
          'permissions', 'roles', 'role_permissions', 'audit_events',
          'organizations', 'branches', 'clients'
        )
      )
    order by n.nspname, c.relname
  loop
    execute pg_catalog.format(
      'select exists (select 1 from %I.%I)',
      v_table.schema_name, v_table.table_name
    ) into v_row_exists;
    if v_row_exists then
      raise exception using errcode = '55000',
        message = 'SYNTHETIC_INITIALIZER_BUSINESS_DATA_NOT_EMPTY';
    end if;
  end loop;

  if exists (
    select 1 from public.roles
    where not is_system or organization_id is not null
  ) then
    raise exception using errcode = '55000',
      message = 'SYNTHETIC_INITIALIZER_ROLE_CATALOG_CONFLICT';
  end if;

  select count(*) into v_organization_count from public.organizations;
  select count(*) into v_branch_count from public.branches;
  select count(*) into v_client_count from public.clients;
  v_is_fresh := v_organization_count = 0 and v_branch_count = 0 and v_client_count = 0;

  if not v_is_fresh and not (
    v_organization_count = 1 and v_branch_count = 1 and v_client_count = 2
  ) then
    raise exception using errcode = '55000',
      message = 'SYNTHETIC_INITIALIZER_BASELINE_CONFLICT';
  end if;

  if v_is_fresh then
    if exists (select 1 from public.audit_events where request_id = v_request_id) then
      raise exception using errcode = '55000',
        message = 'SYNTHETIC_INITIALIZER_AUDIT_CONFLICT';
    end if;
    perform pg_catalog.set_config(
      'request.headers', jsonb_build_object('x-request-id', v_request_id)::text, true
    );

    insert into public.organizations (id, code, name, timezone, is_active, settings)
    values (
      (v_organization ->> 'id')::uuid,
      v_organization ->> 'code', v_organization ->> 'name',
      v_organization ->> 'timezone', false, v_organization -> 'settings'
    );
    insert into public.branches (id, organization_id, code, name, capacity, is_active, settings)
    values (
      (v_branch ->> 'id')::uuid, (v_branch ->> 'organization_id')::uuid,
      v_branch ->> 'code', v_branch ->> 'name', null, false, v_branch -> 'settings'
    );
    insert into public.clients (
      id, organization_id, branch_id, client_code, external_key,
      display_name, date_of_birth, national_id_ciphertext, status,
      admitted_on, ended_on, source_system, source_updated_at, row_version
    )
    select
      (entry ->> 'id')::uuid, (entry ->> 'organization_id')::uuid,
      (entry ->> 'branch_id')::uuid, entry ->> 'client_code', null,
      entry ->> 'display_name', null, null, 'suspended'::public.client_status,
      null, null, entry ->> 'source_system', null, 1
    from jsonb_array_elements(v_clients) as items(entry);
  end if;

  -- On replay, compare every business column and do not update timestamps,
  -- names, flags, versions, sources, or any existing user-owned content.
  if not exists (
    select 1 from public.organizations o
    where to_jsonb(o) - array['created_at', 'updated_at'] = v_organization
  ) or not exists (
    select 1 from public.branches b
    where to_jsonb(b) - array['created_at', 'updated_at'] = v_branch
  ) or exists (
    select 1 from jsonb_array_elements(v_clients) as expected(entry)
    where not exists (
      select 1 from public.clients c
      where to_jsonb(c) - array['created_at', 'updated_at'] = expected.entry
    )
  ) then
    raise exception using errcode = '55000',
      message = 'SYNTHETIC_INITIALIZER_CONTENT_CONFLICT';
  end if;

  -- Require the original four system-actor insert receipts, not a fabricated
  -- signed record or a user assignment. Missing auditing rolls back all writes.
  if (
    select count(*) from public.audit_events
    where request_id = v_request_id
  ) <> 4 or (
    select count(distinct (table_name, row_pk)) from public.audit_events
    where request_id = v_request_id
      and action = 'insert' and actor_user_id is null
      and metadata ->> 'system_actor' = 'true'
      and (table_name, row_pk) in (
        ('public.organizations', v_organization ->> 'id'),
        ('public.branches', v_branch ->> 'id'),
        ('public.clients', v_clients -> 0 ->> 'id'),
        ('public.clients', v_clients -> 1 ->> 'id')
      )
  ) <> 4 then
    raise exception using errcode = '55000',
      message = 'SYNTHETIC_INITIALIZER_AUDIT_CONFLICT';
  end if;
end;
$synthetic_initializer$;

commit;
