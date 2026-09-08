begin;

select plan(21);

select ok(
  has_function_privilege(
    'authenticated',
    'public.client_directory_snapshot(uuid,uuid,public.client_directory_purpose,integer,text,uuid,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.client_directory_snapshot(uuid,uuid,public.client_directory_purpose,integer,text,uuid,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'public.client_directory_snapshot(uuid,uuid,public.client_directory_purpose,integer,text,uuid,uuid)',
    'execute'
  )
  and not (
    select procedure.prosecdef
    from pg_proc procedure
    where procedure.oid =
      'public.client_directory_snapshot(uuid,uuid,public.client_directory_purpose,integer,text,uuid,uuid)'::regprocedure
  ),
  'public directory wrapper is authenticated-only and SECURITY INVOKER'
);

select ok(
  has_function_privilege(
    'authenticated',
    'private.client_directory_snapshot(uuid,uuid,public.client_directory_purpose,integer,text,uuid,uuid)',
    'execute'
  )
  and (
    select procedure.prosecdef
      and coalesce(procedure.proconfig, '{}'::text[]) @> array['search_path=""']
      and procedure.provolatile = 'v'
    from pg_proc procedure
    where procedure.oid =
      'private.client_directory_snapshot(uuid,uuid,public.client_directory_purpose,integer,text,uuid,uuid)'::regprocedure
  ),
  'private directory core is a fixed-search-path volatile SECURITY DEFINER'
);

select ok(
  pg_get_function_result(
    'public.client_directory_snapshot(uuid,uuid,public.client_directory_purpose,integer,text,uuid,uuid)'::regprocedure
  ) ~ 'client_code text'
  and pg_get_function_result(
    'public.client_directory_snapshot(uuid,uuid,public.client_directory_purpose,integer,text,uuid,uuid)'::regprocedure
  ) !~ '(date_of_birth|external_key|national_id|source_system|source_updated_at)',
  'directory contract contains minimum operational identity and no demographics, external key, ciphertext, or source evidence'
);

select ok(
  position('private.can_staff_access_client' in pg_get_functiondef(
    'private.client_directory_snapshot(uuid,uuid,public.client_directory_purpose,integer,text,uuid,uuid)'::regprocedure
  )) > 0
  and position('public.audit_events' in pg_get_functiondef(
    'private.client_directory_snapshot(uuid,uuid,public.client_directory_purpose,integer,text,uuid,uuid)'::regprocedure
  )) > 0
  and position('order by visible.client_code, visible.id' in lower(pg_get_functiondef(
    'private.client_directory_snapshot(uuid,uuid,public.client_directory_purpose,integer,text,uuid,uuid)'::regprocedure
  ))) > 0,
  'directory core enforces per-client assignment, audit, and stable keyset ordering'
);

select ok(
  not has_table_privilege('authenticated', 'public.clients', 'select')
  and not has_table_privilege('service_role', 'public.clients', 'select'),
  'complete client base rows are not a direct authenticated or service-role surface'
);

select ok(
  not (
    lower(pg_get_functiondef(
      'public.daily_service_summary(uuid,date)'::regprocedure
    )) ~ '(from|join)[[:space:]]+public[.]clients'
  )
  and not (
    select procedure.prosecdef
    from pg_proc procedure
    where procedure.oid = 'public.daily_service_summary(uuid,date)'::regprocedure
  ),
  'daily summary remains SECURITY INVOKER without depending on revoked client base-table reads'
);

select results_eq(
  $$select enumlabel::text collate "C"
    from pg_enum
    where enumtypid = 'public.client_directory_purpose'::regtype
    order by enumsortorder$$,
  $$values
    ('case_center'::text collate "C"), ('core_daily'::text collate "C"), ('blood_glucose'::text collate "C"),
    ('client_registry'::text collate "C"), ('client_lifecycle'::text collate "C"), ('care_plans'::text collate "C"),
    ('service_usage'::text collate "C"), ('offline_sync'::text collate "C"), ('medication_plan'::text collate "C")$$,
  'directory purpose is a closed versioned enum rather than caller-controlled audit text'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '84700000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'directory-manager@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '84700000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'directory-assigned@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '84700000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'directory-no-read@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '84700000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'directory-blind-writer@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());

insert into public.organizations (id, code, name) values
  ('84710000-0000-4000-8000-000000000001', 'directory_org', '名錄測試機構');

insert into public.branches (id, organization_id, code, name) values
  ('84720000-0000-4000-8000-000000000001', '84710000-0000-4000-8000-000000000001', 'main', '名錄主分支'),
  ('84720000-0000-4000-8000-000000000002', '84710000-0000-4000-8000-000000000001', 'other', '名錄他分支');

insert into public.profiles (id, display_name, kind) values
  ('84700000-0000-4000-8000-000000000001', '名錄管理員', 'staff'),
  ('84700000-0000-4000-8000-000000000002', '名錄指派人員', 'staff'),
  ('84700000-0000-4000-8000-000000000003', '名錄無權人員', 'staff'),
  ('84700000-0000-4000-8000-000000000004', '無生日欄位管理者', 'staff');

insert into public.roles (
  id, organization_id, role_key, name, description, is_system
) values
  ('84730000-0000-4000-8000-000000000001', '84710000-0000-4000-8000-000000000001', 'directory_assigned_reader', '名錄指派讀取', '只有 clients.read', false),
  ('84730000-0000-4000-8000-000000000002', '84710000-0000-4000-8000-000000000001', 'directory_no_read', '名錄無讀取', '只有通知', false),
  ('84730000-0000-4000-8000-000000000003', '84710000-0000-4000-8000-000000000001', 'directory_blind_writer', '無生日欄位管理', '可管理主檔但沒有 clients.demographics.read', false);

insert into public.role_permissions (role_id, permission_id)
select '84730000-0000-4000-8000-000000000001', id
from public.permissions where permission_key = 'clients.read';

insert into public.role_permissions (role_id, permission_id)
select '84730000-0000-4000-8000-000000000002', id
from public.permissions where permission_key = 'notifications.read';

insert into public.role_permissions (role_id, permission_id)
select '84730000-0000-4000-8000-000000000003', id
from public.permissions
where permission_key in ('clients.read', 'clients.manage', 'clients.view_all');

insert into public.memberships (
  id, organization_id, branch_id, profile_id, status
) values
  ('84740000-0000-4000-8000-000000000001', '84710000-0000-4000-8000-000000000001', null, '84700000-0000-4000-8000-000000000001', 'active'),
  ('84740000-0000-4000-8000-000000000002', '84710000-0000-4000-8000-000000000001', '84720000-0000-4000-8000-000000000001', '84700000-0000-4000-8000-000000000002', 'active'),
  ('84740000-0000-4000-8000-000000000003', '84710000-0000-4000-8000-000000000001', '84720000-0000-4000-8000-000000000001', '84700000-0000-4000-8000-000000000003', 'active'),
  ('84740000-0000-4000-8000-000000000004', '84710000-0000-4000-8000-000000000001', '84720000-0000-4000-8000-000000000001', '84700000-0000-4000-8000-000000000004', 'active');

insert into public.membership_roles (membership_id, role_id) values
  ('84740000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002'),
  ('84740000-0000-4000-8000-000000000002', '84730000-0000-4000-8000-000000000001'),
  ('84740000-0000-4000-8000-000000000003', '84730000-0000-4000-8000-000000000002'),
  ('84740000-0000-4000-8000-000000000004', '84730000-0000-4000-8000-000000000003');

insert into public.clients (
  id, organization_id, branch_id, client_code, display_name, date_of_birth,
  status, admitted_on, source_system, external_key, national_id_ciphertext
) values
  ('84750000-0000-4000-8000-000000000001', '84710000-0000-4000-8000-000000000001', '84720000-0000-4000-8000-000000000001', 'A-001', '第一個案', '1940-01-01', 'active', null, 'central_html', 'secret-a', decode('abcd', 'hex')),
  ('84750000-0000-4000-8000-000000000002', '84710000-0000-4000-8000-000000000001', '84720000-0000-4000-8000-000000000001', 'B-002', '第二個案', '1941-02-02', 'active', '2026-01-01', 'local', null, null),
  ('84750000-0000-4000-8000-000000000003', '84710000-0000-4000-8000-000000000001', '84720000-0000-4000-8000-000000000002', 'C-003', '他分支個案', '1942-03-03', 'active', '2026-01-01', 'local', null, null);

insert into public.client_assignments (
  organization_id, branch_id, client_id, assignee_user_id, assignment_kind
) values (
  '84710000-0000-4000-8000-000000000001',
  '84720000-0000-4000-8000-000000000001',
  '84750000-0000-4000-8000-000000000002',
  '84700000-0000-4000-8000-000000000002',
  'primary'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"84700000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',
  true
);

select results_eq(
  $$select client_code collate "C", visible_count, has_more
    from public.client_directory_snapshot(
      '84710000-0000-4000-8000-000000000001',
      '84720000-0000-4000-8000-000000000001',
      'case_center', 1, null, null, null
    )$$,
  $$values ('A-001'::text collate "C", 2::bigint, true)$$,
  'first bounded page returns the stable first key and total authorized count'
);

select results_eq(
  $$select client_code collate "C", visible_count, has_more
    from public.client_directory_snapshot(
      '84710000-0000-4000-8000-000000000001',
      '84720000-0000-4000-8000-000000000001',
      'case_center', 1, 'A-001',
      '84750000-0000-4000-8000-000000000001', null
    )$$,
  $$values ('B-002'::text collate "C", 2::bigint, false)$$,
  'second keyset page resumes after the exact code and stable UUID tie-breaker'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"84700000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}',
  true
);

select results_eq(
  $$select client_code collate "C", admitted_on, visible_count, has_more
    from public.client_directory_snapshot(
      '84710000-0000-4000-8000-000000000001',
      '84720000-0000-4000-8000-000000000001',
      'client_registry', 200, null, null, null
    )$$,
  $$values ('B-002'::text collate "C", '2026-01-01'::date, 1::bigint, false)$$,
  'assigned reader receives only the actively assigned minimum directory row'
);

select is(
  (select count(*)::integer
   from public.client_directory_snapshot(
     '84710000-0000-4000-8000-000000000001',
     '84720000-0000-4000-8000-000000000001',
     'client_registry', 1, null, null,
     '84750000-0000-4000-8000-000000000001'
   )),
  0,
  'exact lookup cannot expose an unassigned same-branch client'
);

select throws_ok(
  $$select * from public.client_directory_snapshot(
    '84710000-0000-4000-8000-000000000001',
    '84720000-0000-4000-8000-000000000001',
    'blood_glucose', 200, null, null, null
  )$$,
  '42501', null,
  'purpose-specific health directory is denied without health.read'
);

select throws_ok(
  $$select * from public.client_directory_snapshot(
    '84710000-0000-4000-8000-000000000001',
    '84720000-0000-4000-8000-000000000002',
    'case_center', 200, null, null, null
  )$$,
  '42501', null,
  'branch-bound caller cannot select another branch directory'
);

select throws_ok(
  $$select * from public.client_directory_snapshot(
    '84710000-0000-4000-8000-000000000001',
    '84720000-0000-4000-8000-000000000001',
    'case_center', 201, null, null, null
  )$$,
  '42501', null,
  'directory page size is server bounded'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"84700000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}',
  true
);

select throws_ok(
  $$select * from public.client_directory_snapshot(
    '84710000-0000-4000-8000-000000000001',
    '84720000-0000-4000-8000-000000000001',
    'case_center', 200, null, null, null
  )$$,
  '42501', null,
  'active staff without clients.read is denied'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"84700000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2"}',
  true
);

select throws_ok(
  $$select * from public.create_local_client(
    '84710000-0000-4000-8000-000000000001',
    '84720000-0000-4000-8000-000000000001',
    'BLIND-NEW', '不可建立', '1950-01-01',
    '84760000-0000-4000-8000-000000000001'
  )$$,
  '42501', null,
  'create is denied when the combined form caller cannot read its DOB field'
);

select throws_ok(
  $$select * from public.update_local_client(
    '84710000-0000-4000-8000-000000000001',
    '84720000-0000-4000-8000-000000000001',
    '84750000-0000-4000-8000-000000000002',
    'B-002', '不可盲寫', null, 1,
    '84760000-0000-4000-8000-000000000002'
  )$$,
  '42501', null,
  'update is denied before a caller can blindly clear an unreadable DOB field'
);

reset role;

select ok(
  not exists (
    select 1 from public.clients where client_code = 'BLIND-NEW'
  )
  and exists (
    select 1 from public.clients
    where id = '84750000-0000-4000-8000-000000000002'
      and display_name = '第二個案'
      and date_of_birth = '1941-02-02'
      and row_version = 1
  )
  and not exists (
    select 1 from private.client_master_operations
    where actor_user_id = '84700000-0000-4000-8000-000000000004'
  ),
  'field-denied create and update leave client rows and immutable receipts unchanged'
);

select is(
  (select count(*)::integer
   from public.audit_events
   where table_name = 'clients'
     and metadata ->> 'projection' = 'client_directory_minimal'),
  4,
  'every successful directory page, including an empty exact lookup, is audited once'
);

select ok(
  not exists (
    select 1 from public.audit_events event
    where event.table_name = 'clients'
      and event.metadata ->> 'projection' = 'client_directory_minimal'
      and (
        event.row_pk is not null
        or event.metadata::text ~ '(A-001|B-002|第一個案|第二個案|1940-01-01|secret-a|abcd)'
      )
  ),
  'directory audit metadata contains purpose and counts but no client PII or identifiers'
);

select is(
  (select count(*)::integer
   from public.audit_events
   where actor_user_id = '84700000-0000-4000-8000-000000000003'
     and metadata ->> 'projection' = 'client_directory_minimal'),
  0,
  'denied directory calls do not create misleading success audit events'
);

select * from finish();
rollback;
