begin;

select plan(21);

select ok(
  has_function_privilege(
    'authenticated',
    'public.client_master_snapshot(uuid,uuid,text)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.client_master_snapshot(uuid,uuid,text)',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'public.client_master_snapshot(uuid,uuid,text)',
    'execute'
  )
  and not (
    select procedure.prosecdef
    from pg_proc procedure
    where procedure.oid =
      'public.client_master_snapshot(uuid,uuid,text)'::regprocedure
  ),
  'public client snapshot is authenticated-only and SECURITY INVOKER'
);

select ok(
  (
    select procedure.prosecdef
      and coalesce(procedure.proconfig, '{}'::text[]) @> array['search_path=""']
      and procedure.provolatile = 'v'
    from pg_proc procedure
    where procedure.oid =
      'private.client_master_snapshot(uuid,uuid,text)'::regprocedure
  ),
  'private snapshot is a fixed-search-path volatile SECURITY DEFINER for audit writes'
);

select ok(
  pg_get_function_result(
    'public.client_master_snapshot(uuid,uuid,text)'::regprocedure
  ) ~ 'date_of_birth date'
  and pg_get_function_result(
    'public.client_master_snapshot(uuid,uuid,text)'::regprocedure
  ) !~ '(national_id|external_key|actor_user_id|created_by)',
  'snapshot returns date of birth but excludes ciphertext, external identity, and actor fields'
);

select ok(
  position('private.has_permission' in pg_get_functiondef(
    'private.client_master_snapshot(uuid,uuid,text)'::regprocedure
  )) > 0
  and position('private.can_staff_access_client' in pg_get_functiondef(
    'private.client_master_snapshot(uuid,uuid,text)'::regprocedure
  )) > 0
  and position('public.audit_events' in pg_get_functiondef(
    'private.client_master_snapshot(uuid,uuid,text)'::regprocedure
  )) > 0,
  'snapshot checks page permission, per-client scope, and writes an audit event'
);

select results_eq(
  $$select role.role_key collate "C"
    from public.role_permissions grant_row
    join public.roles role on role.id = grant_row.role_id
    join public.permissions permission on permission.id = grant_row.permission_id
    where permission.permission_key = 'clients.demographics.read'
      and role.is_system
    order by role.role_key$$,
  $$values
    ('branch_supervisor'::text collate "C"),
    ('case_manager_social_worker'::text collate "C"),
    ('nurse'::text collate "C"),
    ('organization_manager'::text collate "C")$$,
  'demographic reads are conservatively seeded to the four approved system roles only'
);

select ok(
  not has_table_privilege('authenticated', 'public.clients', 'select')
  and not has_table_privilege('service_role', 'public.clients', 'select'),
  'authenticated and service-role sessions cannot select the complete client base table'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '82700000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'snapshot-manager@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '82700000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'snapshot-assigned@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '82700000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'snapshot-no-read@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '82700000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'snapshot-other-org@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());

insert into public.organizations (id, code, name) values
  ('82710000-0000-4000-8000-000000000001', 'snapshot_a', '快照測試機構 A'),
  ('82710000-0000-4000-8000-000000000002', 'snapshot_b', '快照測試機構 B');

insert into public.branches (id, organization_id, code, name) values
  ('82720000-0000-4000-8000-000000000001', '82710000-0000-4000-8000-000000000001', 'main', 'A 主分支'),
  ('82720000-0000-4000-8000-000000000002', '82710000-0000-4000-8000-000000000001', 'second', 'A 第二分支'),
  ('82720000-0000-4000-8000-000000000003', '82710000-0000-4000-8000-000000000002', 'main', 'B 主分支');

insert into public.profiles (id, display_name, kind) values
  ('82700000-0000-4000-8000-000000000001', '機構管理員', 'staff'),
  ('82700000-0000-4000-8000-000000000002', '指派工作人員', 'staff'),
  ('82700000-0000-4000-8000-000000000003', '無讀取權人員', 'staff'),
  ('82700000-0000-4000-8000-000000000004', '其他機構管理員', 'staff');

insert into public.roles (
  id, organization_id, role_key, name, description, is_system
) values
  ('82730000-0000-4000-8000-000000000001', '82710000-0000-4000-8000-000000000001', 'snapshot_assigned_reader', '指派讀取者', '只有 clients.read', false),
  ('82730000-0000-4000-8000-000000000002', '82710000-0000-4000-8000-000000000001', 'snapshot_no_client_read', '無個案讀取', '不含 clients.read', false);

insert into public.role_permissions (role_id, permission_id)
select '82730000-0000-4000-8000-000000000001', id
from public.permissions
where permission_key = 'clients.read';

insert into public.role_permissions (role_id, permission_id)
select '82730000-0000-4000-8000-000000000002', id
from public.permissions
where permission_key = 'notifications.read';

insert into public.memberships (
  id, organization_id, branch_id, profile_id, status
) values
  ('82740000-0000-4000-8000-000000000001', '82710000-0000-4000-8000-000000000001', null, '82700000-0000-4000-8000-000000000001', 'active'),
  ('82740000-0000-4000-8000-000000000002', '82710000-0000-4000-8000-000000000001', '82720000-0000-4000-8000-000000000001', '82700000-0000-4000-8000-000000000002', 'active'),
  ('82740000-0000-4000-8000-000000000003', '82710000-0000-4000-8000-000000000001', '82720000-0000-4000-8000-000000000001', '82700000-0000-4000-8000-000000000003', 'active'),
  ('82740000-0000-4000-8000-000000000004', '82710000-0000-4000-8000-000000000002', null, '82700000-0000-4000-8000-000000000004', 'active');

insert into public.membership_roles (membership_id, role_id) values
  ('82740000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002'),
  ('82740000-0000-4000-8000-000000000002', '82730000-0000-4000-8000-000000000001'),
  ('82740000-0000-4000-8000-000000000003', '82730000-0000-4000-8000-000000000002'),
  ('82740000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000002');

insert into public.clients (
  id, organization_id, branch_id, client_code, display_name, date_of_birth,
  status, admitted_on, source_system
) values
  ('82750000-0000-4000-8000-000000000001', '82710000-0000-4000-8000-000000000001', '82720000-0000-4000-8000-000000000001', 'ASSIGNED-001', '指派個案', '1950-01-01', 'active', '2026-01-01', 'local'),
  ('82750000-0000-4000-8000-000000000002', '82710000-0000-4000-8000-000000000001', '82720000-0000-4000-8000-000000000001', 'UNASSIGNED-002', '未指派個案', '1951-02-02', 'active', '2026-01-02', 'central_html'),
  ('82750000-0000-4000-8000-000000000003', '82710000-0000-4000-8000-000000000001', '82720000-0000-4000-8000-000000000002', 'OTHER-BRANCH', '他分支個案', '1952-03-03', 'active', '2026-01-03', 'local'),
  ('82750000-0000-4000-8000-000000000004', '82710000-0000-4000-8000-000000000002', '82720000-0000-4000-8000-000000000003', 'OTHER-ORG', '他機構個案', '1953-04-04', 'active', '2026-01-04', 'local');

insert into public.client_assignments (
  organization_id, branch_id, client_id, assignee_user_id, assignment_kind
) values (
  '82710000-0000-4000-8000-000000000001',
  '82720000-0000-4000-8000-000000000001',
  '82750000-0000-4000-8000-000000000001',
  '82700000-0000-4000-8000-000000000002',
  'primary'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"82700000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',
  true
);

select results_eq(
  $$select client_code, date_of_birth, visible_count
    from public.client_master_snapshot(
      '82710000-0000-4000-8000-000000000001',
      '82720000-0000-4000-8000-000000000001',
      'view'
    )$$,
  $$values
    ('ASSIGNED-001'::text, '1950-01-01'::date, 2::bigint),
    ('UNASSIGNED-002'::text, '1951-02-02'::date, 2::bigint)$$,
  'branch-wide manager receives the exact selected branch projection and visible count'
);

select is(
  (select count(*)::integer from public.client_master_snapshot(
    '82710000-0000-4000-8000-000000000001',
    '82720000-0000-4000-8000-000000000001',
    'search'
  )),
  2,
  'search interaction returns the same authorized snapshot'
);

reset role;

select is(
  (select count(*)::integer
   from public.audit_events
   where actor_user_id = '82700000-0000-4000-8000-000000000001'
     and table_name = 'clients'
     and metadata ->> 'projection' = 'page60_minimal'),
  2,
  'each view and search writes one audit event'
);

select results_eq(
  $$select metadata ->> 'interaction', (metadata ->> 'result_count')::integer
    from public.audit_events
    where actor_user_id = '82700000-0000-4000-8000-000000000001'
      and table_name = 'clients'
      and metadata ->> 'projection' = 'page60_minimal'
    order by id$$,
  $$values ('view'::text, 2::integer), ('search'::text, 2::integer)$$,
  'audit metadata records only interaction type and aggregate count'
);

select ok(
  not exists (
    select 1
    from public.audit_events event
    where event.actor_user_id = '82700000-0000-4000-8000-000000000001'
      and event.table_name = 'clients'
      and (
        event.row_pk is not null
        or event.metadata::text ~ '(ASSIGNED|UNASSIGNED|指派個案|未指派個案|1950-01-01|1951-02-02)'
      )
  ),
  'snapshot audit does not retain client identifiers, names, codes, or birth dates'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"82700000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}',
  true
);

select results_eq(
  $$select client_code, date_of_birth, visible_count
    from public.client_master_snapshot(
      '82710000-0000-4000-8000-000000000001',
      '82720000-0000-4000-8000-000000000001',
      'view'
    )$$,
  $$values ('ASSIGNED-001'::text, null::date, 1::bigint)$$,
  'assigned reader sees only the actively assigned client and DOB remains masked without field permission'
);

select isnt(
  (select count(*)::integer from public.client_master_snapshot(
    '82710000-0000-4000-8000-000000000001',
    '82720000-0000-4000-8000-000000000001',
    'view'
  )),
  2,
  'assigned reader cannot infer the unassigned same-branch client through the snapshot'
);

select throws_ok(
  $$select * from public.client_master_snapshot(
    '82710000-0000-4000-8000-000000000001',
    '82720000-0000-4000-8000-000000000002',
    'view'
  )$$,
  '42501', null,
  'branch membership cannot select another branch'
);

select throws_ok(
  $$select * from public.client_master_snapshot(
    '82710000-0000-4000-8000-000000000002',
    '82720000-0000-4000-8000-000000000003',
    'view'
  )$$,
  '42501', null,
  'caller cannot select another organization context'
);

select throws_ok(
  $$select * from public.client_master_snapshot(
    '82710000-0000-4000-8000-000000000001',
    '82720000-0000-4000-8000-000000000001',
    'export'
  )$$,
  '42501', null,
  'unrecognized audit interaction is denied'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"82700000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}',
  true
);

select throws_ok(
  $$select * from public.client_master_snapshot(
    '82710000-0000-4000-8000-000000000001',
    '82720000-0000-4000-8000-000000000001',
    'view'
  )$$,
  '42501', null,
  'active staff without clients.read is denied'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"82700000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2"}',
  true
);

select throws_ok(
  $$select * from public.client_master_snapshot(
    '82710000-0000-4000-8000-000000000001',
    '82720000-0000-4000-8000-000000000001',
    'view'
  )$$,
  '42501', null,
  'other-organization manager cannot select the first organization'
);

reset role;
update public.branches
set is_active = false
where id = '82720000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"82700000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',
  true
);

select throws_ok(
  $$select * from public.client_master_snapshot(
    '82710000-0000-4000-8000-000000000001',
    '82720000-0000-4000-8000-000000000001',
    'view'
  )$$,
  '42501', null,
  'inactive selected branch is denied'
);

reset role;
select is(
  (select count(*)::integer
   from public.audit_events
   where actor_user_id in (
     '82700000-0000-4000-8000-000000000002',
     '82700000-0000-4000-8000-000000000003',
     '82700000-0000-4000-8000-000000000004'
   )
     and table_name = 'clients'
     and metadata ->> 'projection' = 'page60_minimal'),
  2,
  'only successful assigned-reader snapshots are audited; denied calls leave no misleading success audit'
);

select ok(
  (select count(*) from public.audit_events
   where table_name = 'clients'
     and metadata ->> 'projection' = 'page60_minimal') >= 4,
  'successful page-60 snapshot events are retained in the common audit table'
);

select * from finish();
rollback;
