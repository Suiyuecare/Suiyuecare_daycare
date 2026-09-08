begin;

select plan(48);

select ok(
  exists (
    select 1
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'private'
      and relation.relname = 'client_master_operations'
      and relation.relkind = 'r'
      and relation.relrowsecurity
      and relation.relforcerowsecurity
  ),
  'client master operation ledger exists with forced RLS'
);

select ok(
  not has_table_privilege('authenticated', 'public.clients', 'insert')
  and not has_table_privilege('authenticated', 'public.clients', 'update')
  and not has_table_privilege('authenticated', 'public.clients', 'delete')
  and not has_table_privilege('service_role', 'public.clients', 'insert')
  and not has_table_privilege('service_role', 'public.clients', 'update')
  and not has_table_privilege('service_role', 'public.clients', 'delete'),
  'authenticated and service role cannot bypass the client master RPCs'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.create_local_client(uuid,uuid,text,text,date,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.create_local_client(uuid,uuid,text,text,date,uuid)',
    'execute'
  )
  and not (
    select procedure.prosecdef
    from pg_proc procedure
    where procedure.oid =
      'public.create_local_client(uuid,uuid,text,text,date,uuid)'::regprocedure
  ),
  'public create-local RPC is authenticated-only and SECURITY INVOKER'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.update_local_client(uuid,uuid,uuid,text,text,date,bigint,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.update_local_client(uuid,uuid,uuid,text,text,date,bigint,uuid)',
    'execute'
  )
  and not (
    select procedure.prosecdef
    from pg_proc procedure
    where procedure.oid =
      'public.update_local_client(uuid,uuid,uuid,text,text,date,bigint,uuid)'::regprocedure
  ),
  'public update-local RPC is authenticated-only and SECURITY INVOKER'
);

select ok(
  (
    select procedure.prosecdef
      and coalesce(procedure.proconfig, '{}'::text[]) @> array['search_path=""']
    from pg_proc procedure
    where procedure.oid =
      'private.create_local_client_atomic(uuid,uuid,text,text,date,uuid)'::regprocedure
  )
  and (
    select procedure.prosecdef
      and coalesce(procedure.proconfig, '{}'::text[]) @> array['search_path=""']
    from pg_proc procedure
    where procedure.oid =
      'private.update_local_client_atomic(uuid,uuid,uuid,text,text,date,bigint,uuid)'::regprocedure
  ),
  'private atomic writers are fixed-search-path SECURITY DEFINER functions'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'private.create_local_client_atomic(uuid,uuid,text,text,date,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'private.update_local_client_atomic(uuid,uuid,uuid,text,text,date,bigint,uuid)',
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'private.create_local_client_guarded(uuid,uuid,text,text,date,uuid)',
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'private.update_local_client_guarded(uuid,uuid,uuid,text,text,date,bigint,uuid)',
    'execute'
  )
  and position('clients.view_all' in pg_get_functiondef(
    'private.create_local_client_guarded(uuid,uuid,text,text,date,uuid)'::regprocedure
  )) > 0
  and position('clients.read' in pg_get_functiondef(
    'private.update_local_client_guarded(uuid,uuid,uuid,text,text,date,bigint,uuid)'::regprocedure
  )) > 0,
  'authenticated callers reach only guarded private writers with the API-equivalent permission checks'
);

select ok(
  exists (
    select 1 from pg_constraint constraint_definition
    where constraint_definition.conrelid = 'private.client_master_operations'::regclass
      and constraint_definition.conname = 'client_master_operations_actor_idempotency_key'
  )
  and exists (
    select 1
    from pg_index index_definition
    join pg_class index_relation on index_relation.oid = index_definition.indexrelid
    where index_definition.indrelid = 'private.client_master_operations'::regclass
      and index_relation.relname = 'client_master_operations_scope_client_idx'
  )
  and exists (
    select 1
    from pg_index index_definition
    join pg_class index_relation on index_relation.oid = index_definition.indexrelid
    where index_definition.indrelid = 'private.client_master_operations'::regclass
      and index_relation.relname = 'client_master_operations_reauth_idx'
  ),
  'operation receipts have actor idempotency, tenant-client, and evidence indexes'
);

select ok(
  position('pg_advisory_xact_lock' in pg_get_functiondef(
    'private.create_local_client_atomic(uuid,uuid,text,text,date,uuid)'::regprocedure
  )) > 0
  and position('pg_advisory_xact_lock' in pg_get_functiondef(
    'private.update_local_client_atomic(uuid,uuid,uuid,text,text,date,bigint,uuid)'::regprocedure
  )) > 0
  and position('for update' in lower(pg_get_functiondef(
    'private.update_local_client_atomic(uuid,uuid,uuid,text,text,date,bigint,uuid)'::regprocedure
  ))) > 0,
  'idempotency is serialized and updates lock the selected client'
);

select ok(
  pg_get_function_arguments(
    'public.update_local_client(uuid,uuid,uuid,text,text,date,bigint,uuid)'::regprocedure
  ) !~ '(source_system|source_updated_at|external_key|national_id|status|admitted_on|ended_on)',
  'local update signature cannot accept provenance, ciphertext, or lifecycle fields'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '77000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'client-master-manager@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '77000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'client-master-supervisor@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '77000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'client-master-other@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '77000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'client-master-assigned-writer@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());

insert into public.organizations (id, code, name) values
  ('77100000-0000-4000-8000-000000000001', 'client_master_a', '個案主檔測試機構 A'),
  ('77100000-0000-4000-8000-000000000002', 'client_master_b', '個案主檔測試機構 B');

insert into public.branches (id, organization_id, code, name) values
  ('77200000-0000-4000-8000-000000000001', '77100000-0000-4000-8000-000000000001', 'main', 'A 主分支'),
  ('77200000-0000-4000-8000-000000000002', '77100000-0000-4000-8000-000000000001', 'second', 'A 第二分支'),
  ('77200000-0000-4000-8000-000000000003', '77100000-0000-4000-8000-000000000002', 'main', 'B 主分支');

insert into public.profiles (id, display_name, kind) values
  ('77000000-0000-4000-8000-000000000001', 'A 機構管理員', 'staff'),
  ('77000000-0000-4000-8000-000000000002', 'A 分支主管', 'staff'),
  ('77000000-0000-4000-8000-000000000003', 'B 機構管理員', 'staff'),
  ('77000000-0000-4000-8000-000000000004', 'A 指派主檔人員', 'staff');

insert into public.roles (
  id, organization_id, role_key, name, description, is_system
) values (
  '77350000-0000-4000-8000-000000000001',
  '77100000-0000-4000-8000-000000000001',
  'client_master_assigned_writer', '指派主檔人員',
  'clients.read + clients.manage + demographics without clients.view_all', false
);

insert into public.role_permissions (role_id, permission_id)
select '77350000-0000-4000-8000-000000000001', id
from public.permissions
where permission_key in (
  'clients.read', 'clients.manage', 'clients.demographics.read'
);

insert into public.memberships (
  id, organization_id, branch_id, profile_id, status
) values
  ('77300000-0000-4000-8000-000000000001', '77100000-0000-4000-8000-000000000001', null, '77000000-0000-4000-8000-000000000001', 'active'),
  ('77300000-0000-4000-8000-000000000002', '77100000-0000-4000-8000-000000000001', '77200000-0000-4000-8000-000000000001', '77000000-0000-4000-8000-000000000002', 'active'),
  ('77300000-0000-4000-8000-000000000003', '77100000-0000-4000-8000-000000000002', null, '77000000-0000-4000-8000-000000000003', 'active'),
  ('77300000-0000-4000-8000-000000000004', '77100000-0000-4000-8000-000000000001', '77200000-0000-4000-8000-000000000001', '77000000-0000-4000-8000-000000000004', 'active');

insert into public.membership_roles (membership_id, role_id) values
  ('77300000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002'),
  ('77300000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000003'),
  ('77300000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002'),
  ('77300000-0000-4000-8000-000000000004', '77350000-0000-4000-8000-000000000001');

insert into public.clients (
  id, organization_id, branch_id, client_code, display_name, date_of_birth,
  status, admitted_on, ended_on, source_system, external_key, row_version
) values
  ('77400000-0000-4000-8000-000000000001', '77100000-0000-4000-8000-000000000001', '77200000-0000-4000-8000-000000000001', 'LOCAL-001', '本機個案', '1950-01-01', 'active', '2026-01-01', null, 'local', null, 1),
  ('77400000-0000-4000-8000-000000000002', '77100000-0000-4000-8000-000000000001', '77200000-0000-4000-8000-000000000001', 'CENTRAL-001', '中央個案', '1945-02-02', 'active', '2026-01-01', null, 'central', 'central-client-1', 1),
  ('77400000-0000-4000-8000-000000000003', '77100000-0000-4000-8000-000000000001', '77200000-0000-4000-8000-000000000001', 'CLOSED-001', '結案個案', '1940-03-03', 'closed', '2025-01-01', '2026-01-01', 'local', null, 1),
  ('77400000-0000-4000-8000-000000000004', '77100000-0000-4000-8000-000000000001', '77200000-0000-4000-8000-000000000002', 'OTHER-BRANCH', '他分支個案', '1955-04-04', 'active', '2026-01-01', null, 'local', null, 1),
  ('77400000-0000-4000-8000-000000000005', '77100000-0000-4000-8000-000000000002', '77200000-0000-4000-8000-000000000003', 'OTHER-ORG', '他機構個案', '1960-05-05', 'active', '2026-01-01', null, 'local', null, 1),
  ('77400000-0000-4000-8000-000000000006', '77100000-0000-4000-8000-000000000001', '77200000-0000-4000-8000-000000000001', 'ASSIGNED-WRITE', '指派可改個案', '1958-06-06', 'active', '2026-01-01', null, 'local', null, 1);

insert into public.client_assignments (
  organization_id, branch_id, client_id, assignee_user_id, assignment_kind
) values (
  '77100000-0000-4000-8000-000000000001',
  '77200000-0000-4000-8000-000000000001',
  '77400000-0000-4000-8000-000000000006',
  '77000000-0000-4000-8000-000000000004',
  'primary'
);

insert into private.reauth_challenges (
  id, user_id, session_id, nonce_sha256, idempotency_key, issued_jwt_iat,
  issued_jwt_jti, created_at, expires_at, consumed_at, consumed_jwt_iat,
  consumed_jwt_jti, factor_method, factor_verified_at
) values
  ('77500000-0000-4000-8000-000000000001', '77000000-0000-4000-8000-000000000001', '77600000-0000-4000-8000-000000000001', repeat('a', 64), '77700000-0000-4000-8000-000000000001', now() - interval '2 minutes', 'client-master-before-a', now() - interval '1 minute', now() + interval '4 minutes', now() - interval '30 seconds', now() - interval '30 seconds', 'client-master-after-a', 'totp', now() - interval '30 seconds'),
  ('77500000-0000-4000-8000-000000000002', '77000000-0000-4000-8000-000000000002', '77600000-0000-4000-8000-000000000002', repeat('b', 64), '77700000-0000-4000-8000-000000000002', now() - interval '2 minutes', 'client-master-before-s', now() - interval '1 minute', now() + interval '4 minutes', now() - interval '30 seconds', now() - interval '30 seconds', 'client-master-after-s', 'totp', now() - interval '30 seconds'),
  ('77500000-0000-4000-8000-000000000003', '77000000-0000-4000-8000-000000000001', '77600000-0000-4000-8000-000000000003', repeat('c', 64), '77700000-0000-4000-8000-000000000003', now() - interval '18 minutes', 'client-master-before-stale', now() - interval '17 minutes', now() - interval '12 minutes', now() - interval '16 minutes', now() - interval '16 minutes', 'client-master-after-stale', 'totp', now() - interval '16 minutes'),
  ('77500000-0000-4000-8000-000000000004', '77000000-0000-4000-8000-000000000004', '77600000-0000-4000-8000-000000000004', repeat('d', 64), '77700000-0000-4000-8000-000000000004', now() - interval '2 minutes', 'client-master-before-w', now() - interval '1 minute', now() + interval '4 minutes', now() - interval '30 seconds', now() - interval '30 seconds', 'client-master-after-w', 'totp', now() - interval '30 seconds');

insert into private.reauth_events (
  user_id, session_id, challenge_id, aal, verification_method, verified_at
) values
  ('77000000-0000-4000-8000-000000000001', '77600000-0000-4000-8000-000000000001', '77500000-0000-4000-8000-000000000001', 'aal2', 'totp', now() - interval '30 seconds'),
  ('77000000-0000-4000-8000-000000000002', '77600000-0000-4000-8000-000000000002', '77500000-0000-4000-8000-000000000002', 'aal2', 'totp', now() - interval '30 seconds'),
  ('77000000-0000-4000-8000-000000000001', '77600000-0000-4000-8000-000000000003', '77500000-0000-4000-8000-000000000003', 'aal2', 'totp', now() - interval '16 minutes'),
  ('77000000-0000-4000-8000-000000000004', '77600000-0000-4000-8000-000000000004', '77500000-0000-4000-8000-000000000004', 'aal2', 'totp', now() - interval '30 seconds');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"77000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1","session_id":"77600000-0000-4000-8000-000000000001"}'::text,
  true
);

select throws_ok(
  $$select * from public.create_local_client(
    '77100000-0000-4000-8000-000000000001',
    '77200000-0000-4000-8000-000000000001',
    'NEW-001', '新個案', '1950-06-06',
    '77800000-0000-4000-8000-000000000001'
  )$$,
  '42501', null,
  'AAL1 cannot create a client master row'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"77000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"77600000-0000-4000-8000-000000000099"}'::text,
  true
);

select throws_ok(
  $$select * from public.create_local_client(
    '77100000-0000-4000-8000-000000000001',
    '77200000-0000-4000-8000-000000000001',
    'NEW-001', '新個案', '1950-06-06',
    '77800000-0000-4000-8000-000000000002'
  )$$,
  '42501', null,
  'an AAL2 JWT without same-session immutable evidence is denied'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"77000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"77600000-0000-4000-8000-000000000001"}'::text,
  true
);

select throws_ok(
  $$select * from public.create_local_client(
    '77100000-0000-4000-8000-000000000001',
    '77200000-0000-4000-8000-000000000001',
    E'BAD\nCODE', '新個案', '1950-06-06',
    '77800000-0000-4000-8000-000000000003'
  )$$,
  '22023', 'valid local client master fields are required',
  'control characters are rejected in client codes'
);

select throws_ok(
  $$select * from public.create_local_client(
    '77100000-0000-4000-8000-000000000001',
    '77200000-0000-4000-8000-000000000001',
    'NEW-FUTURE', '新個案', '2099-01-01',
    '77800000-0000-4000-8000-000000000004'
  )$$,
  '22023', 'valid local client master fields are required',
  'future birth dates are rejected'
);

select results_eq(
  $$select row_version, replayed
    from public.create_local_client(
      '77100000-0000-4000-8000-000000000001',
      '77200000-0000-4000-8000-000000000001',
      '  NEW-001  ', '  新個案  ', '1950-06-06',
      '77800000-0000-4000-8000-000000000005'
    )$$,
  $$values (1::bigint, false)$$,
  'authorized create returns version one and a non-replay result'
);

reset role;
select results_eq(
  $$select client_code, display_name, date_of_birth, status::text,
           source_system, external_key, national_id_ciphertext, row_version
    from public.clients where client_code = 'NEW-001'$$,
  $$values ('NEW-001'::text, '新個案'::text, '1950-06-06'::date,
            'active'::text, 'local'::text, null::text, null::bytea, 1::bigint)$$,
  'creation trims local fields and cannot prefill central identity or ciphertext'
);

select results_eq(
  $$select reauth_challenge_id
    from private.client_master_operations
    where actor_user_id = '77000000-0000-4000-8000-000000000001'
      and idempotency_key = '77800000-0000-4000-8000-000000000005'$$,
  $$values ('77500000-0000-4000-8000-000000000001'::uuid)$$,
  'creation receipt retains the exact immutable reauthentication challenge'
);
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"77000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"77600000-0000-4000-8000-000000000001"}'::text,
  true
);

select results_eq(
  $$select row_version, replayed
    from public.create_local_client(
      '77100000-0000-4000-8000-000000000001',
      '77200000-0000-4000-8000-000000000001',
      'NEW-001', '新個案', '1950-06-06',
      '77800000-0000-4000-8000-000000000005'
    )$$,
  $$values (1::bigint, true)$$,
  'same create request replays the immutable result'
);

reset role;
select is(
  (select count(*)::integer from public.clients where client_code = 'NEW-001'),
  1,
  'create replay does not duplicate the client'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"77000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"77600000-0000-4000-8000-000000000001"}'::text,
  true
);

select throws_ok(
  $$select * from public.create_local_client(
    '77100000-0000-4000-8000-000000000001',
    '77200000-0000-4000-8000-000000000001',
    'NEW-CHANGED', '新個案', '1950-06-06',
    '77800000-0000-4000-8000-000000000005'
  )$$,
  '23505', 'client master idempotency conflict',
  'same create idempotency key cannot represent different content'
);

select throws_ok(
  $$select * from public.create_local_client(
    '77100000-0000-4000-8000-000000000001',
    '77200000-0000-4000-8000-000000000001',
    'NEW-001', '重複代碼個案', '1951-01-01',
    '77800000-0000-4000-8000-000000000006'
  )$$,
  '23505', null,
  'organization client code uniqueness remains authoritative'
);

select throws_ok(
  $$select * from public.create_local_client(
    '77100000-0000-4000-8000-000000000002',
    '77200000-0000-4000-8000-000000000001',
    'MISMATCH', '錯誤範圍', '1950-01-01',
    '77800000-0000-4000-8000-000000000007'
  )$$,
  '42501', null,
  'mismatched organization and branch are denied'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"77000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"77600000-0000-4000-8000-000000000002"}'::text,
  true
);

select results_eq(
  $$select row_version, replayed
    from public.create_local_client(
      '77100000-0000-4000-8000-000000000001',
      '77200000-0000-4000-8000-000000000001',
      'SUPERVISOR-OWN', '主管分支個案', '1952-01-01',
      '77800000-0000-4000-8000-000000000008'
    )$$,
  $$values (1::bigint, false)$$,
  'branch supervisor can create only inside the assigned branch'
);

select throws_ok(
  $$select * from public.create_local_client(
    '77100000-0000-4000-8000-000000000001',
    '77200000-0000-4000-8000-000000000002',
    'SUPERVISOR-OTHER', '他分支', '1952-01-01',
    '77800000-0000-4000-8000-000000000009'
  )$$,
  '42501', null,
  'branch supervisor cannot create in another branch'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"77000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2","session_id":"77600000-0000-4000-8000-000000000004"}'::text,
  true
);

select throws_ok(
  $$select * from public.create_local_client(
    '77100000-0000-4000-8000-000000000001',
    '77200000-0000-4000-8000-000000000001',
    'ASSIGNED-CREATE', '不得建立', '1958-06-07',
    '77800000-0000-4000-8000-000000000019'
  )$$,
  '42501',
  'local client creation requires read, manage, demographic field, and branch-wide client authority',
  'custom assigned writer cannot create an immediately invisible unassigned client'
);

select results_eq(
  $$select row_version, replayed
    from public.update_local_client(
      '77100000-0000-4000-8000-000000000001',
      '77200000-0000-4000-8000-000000000001',
      '77400000-0000-4000-8000-000000000006',
      'ASSIGNED-WRITE-2', '指派可改個案新版', '1958-06-07', 1,
      '77800000-0000-4000-8000-000000000020'
    )$$,
  $$values (2::bigint, false)$$,
  'custom read+manage+demographics writer can update an actively assigned local client without view-all'
);

reset role;
delete from public.client_assignments
where client_id = '77400000-0000-4000-8000-000000000006'
  and assignee_user_id = '77000000-0000-4000-8000-000000000004';
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"77000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2","session_id":"77600000-0000-4000-8000-000000000004"}'::text,
  true
);

select throws_ok(
  $$select * from public.update_local_client(
    '77100000-0000-4000-8000-000000000001',
    '77200000-0000-4000-8000-000000000001',
    '77400000-0000-4000-8000-000000000006',
    'ASSIGNED-WRITE-2', '指派可改個案新版', '1958-06-07', 1,
    '77800000-0000-4000-8000-000000000020'
  )$$,
  '42501',
  'local client update requires current assignment, read, manage, and demographic field authority',
  'an exact update replay is hidden immediately after client assignment is revoked'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"77000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"77600000-0000-4000-8000-000000000001"}'::text,
  true
);

select throws_ok(
  $$insert into public.clients (
      organization_id, branch_id, client_code, display_name, source_system
    ) values (
      '77100000-0000-4000-8000-000000000001',
      '77200000-0000-4000-8000-000000000001',
      'DIRECT', '直接新增', 'local'
    )$$,
  '42501', null,
  'authenticated cannot directly insert a client'
);

select throws_ok(
  $$update public.clients
    set source_system = 'forged', row_version = 99
    where id = '77400000-0000-4000-8000-000000000001'$$,
  '42501', null,
  'authenticated cannot directly forge source ownership or row version'
);

select throws_ok(
  $$delete from public.clients
    where id = '77400000-0000-4000-8000-000000000001'$$,
  '42501', null,
  'authenticated cannot directly delete a client'
);

select results_eq(
  $$select row_version, replayed
    from public.update_local_client(
      '77100000-0000-4000-8000-000000000001',
      '77200000-0000-4000-8000-000000000001',
      '77400000-0000-4000-8000-000000000001',
      'LOCAL-001-A', '本機個案新版', '1950-01-02', 1,
      '77800000-0000-4000-8000-000000000010'
    )$$,
  $$values (2::bigint, false)$$,
  'authorized local update advances one optimistic version'
);

reset role;
select results_eq(
  $$select client_code, display_name, date_of_birth, source_system,
           external_key, status::text, admitted_on, ended_on, row_version
    from public.clients
    where id = '77400000-0000-4000-8000-000000000001'$$,
  $$values ('LOCAL-001-A'::text, '本機個案新版'::text, '1950-01-02'::date,
            'local'::text, null::text, 'active'::text, '2026-01-01'::date,
            null::date, 2::bigint)$$,
  'local update preserves provenance and lifecycle while advancing row version'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"77000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"77600000-0000-4000-8000-000000000001"}'::text,
  true
);

select results_eq(
  $$select row_version, replayed
    from public.update_local_client(
      '77100000-0000-4000-8000-000000000001',
      '77200000-0000-4000-8000-000000000001',
      '77400000-0000-4000-8000-000000000001',
      'LOCAL-001-B', '本機個案第三版', '1950-01-03', 2,
      '77800000-0000-4000-8000-000000000011'
    )$$,
  $$values (3::bigint, false)$$,
  'a second independently keyed update advances to version three'
);

select results_eq(
  $$select row_version, replayed
    from public.update_local_client(
      '77100000-0000-4000-8000-000000000001',
      '77200000-0000-4000-8000-000000000001',
      '77400000-0000-4000-8000-000000000001',
      'LOCAL-001-A', '本機個案新版', '1950-01-02', 1,
      '77800000-0000-4000-8000-000000000010'
    )$$,
  $$values (2::bigint, true)$$,
  'old exact replay returns its stored result after the client later changes'
);

reset role;
select is(
  (
    select count(*)::integer
    from private.client_master_operations
    where client_id = '77400000-0000-4000-8000-000000000001'
      and operation_kind = 'update_local'
  ),
  2,
  'update replay does not create a duplicate operation receipt'
);
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"77000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"77600000-0000-4000-8000-000000000001"}'::text,
  true
);

select throws_ok(
  $$select * from public.update_local_client(
    '77100000-0000-4000-8000-000000000001',
    '77200000-0000-4000-8000-000000000001',
    '77400000-0000-4000-8000-000000000001',
    'DIFFERENT', '不同內容', '1950-01-02', 1,
    '77800000-0000-4000-8000-000000000010'
  )$$,
  '23505', 'client master idempotency conflict',
  'same update idempotency key cannot represent different content'
);

select throws_ok(
  $$select * from public.update_local_client(
    '77100000-0000-4000-8000-000000000001',
    '77200000-0000-4000-8000-000000000001',
    '77400000-0000-4000-8000-000000000001',
    'LOCAL-STALE', '過期版本', '1950-01-04', 2,
    '77800000-0000-4000-8000-000000000012'
  )$$,
  '40001', 'client master row version conflict',
  'stale base row version is rejected'
);

select throws_ok(
  $$select * from public.update_local_client(
    '77100000-0000-4000-8000-000000000001',
    '77200000-0000-4000-8000-000000000001',
    '77400000-0000-4000-8000-000000000001',
    'LOCAL-001-B', '本機個案第三版', '1950-01-03', 3,
    '77800000-0000-4000-8000-000000000013'
  )$$,
  '22023', 'client master update must change at least one local field',
  'no-op client updates are rejected'
);

select throws_ok(
  $$select * from public.update_local_client(
    '77100000-0000-4000-8000-000000000001',
    '77200000-0000-4000-8000-000000000001',
    '77400000-0000-4000-8000-000000000002',
    'CENTRAL-CHANGED', '不得變更中央個案', '1945-02-03', 1,
    '77800000-0000-4000-8000-000000000014'
  )$$,
  '42501', 'client is outside the editable local tenant scope',
  'central-source identity is fail-closed to local updates'
);

select throws_ok(
  $$select * from public.update_local_client(
    '77100000-0000-4000-8000-000000000001',
    '77200000-0000-4000-8000-000000000001',
    '77400000-0000-4000-8000-000000000003',
    'CLOSED-CHANGED', '不得變更結案個案', '1940-03-04', 1,
    '77800000-0000-4000-8000-000000000015'
  )$$,
  '42501', 'client is outside the editable local tenant scope',
  'terminal client master is not reopened through demographic updates'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"77000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"77600000-0000-4000-8000-000000000002"}'::text,
  true
);

select throws_ok(
  $$select * from public.update_local_client(
    '77100000-0000-4000-8000-000000000001',
    '77200000-0000-4000-8000-000000000002',
    '77400000-0000-4000-8000-000000000004',
    'OTHER-BRANCH-X', '他分支變更', '1955-04-05', 1,
    '77800000-0000-4000-8000-000000000016'
  )$$,
  '42501', 'local client update requires current assignment, read, manage, and demographic field authority',
  'branch supervisor without permission in the selected branch is stopped by the guarded DB wrapper'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"77000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1","session_id":"77600000-0000-4000-8000-000000000001"}'::text,
  true
);

select throws_ok(
  $$select * from public.update_local_client(
    '77100000-0000-4000-8000-000000000001',
    '77200000-0000-4000-8000-000000000001',
    '77400000-0000-4000-8000-000000000001',
    'LOCAL-AAL1', 'AAL1 不得變更', '1950-01-05', 3,
    '77800000-0000-4000-8000-000000000017'
  )$$,
  '42501', null,
  'AAL1 cannot update a local client'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"77000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"77600000-0000-4000-8000-000000000003"}'::text,
  true
);

select throws_ok(
  $$select * from public.update_local_client(
    '77100000-0000-4000-8000-000000000001',
    '77200000-0000-4000-8000-000000000001',
    '77400000-0000-4000-8000-000000000001',
    'LOCAL-STALE-AAL2', '過期驗證', '1950-01-05', 3,
    '77800000-0000-4000-8000-000000000018'
  )$$,
  '42501', null,
  'stale reauthentication evidence cannot authorize a client update'
);

reset role;

insert into private.reauth_challenges (
  id, user_id, session_id, nonce_sha256, idempotency_key, issued_jwt_iat,
  issued_jwt_jti, created_at, expires_at, consumed_at, consumed_jwt_iat,
  consumed_jwt_jti, factor_method, factor_verified_at
) values (
  '77500000-0000-4000-8000-000000000010',
  '77000000-0000-4000-8000-000000000001',
  '77600000-0000-4000-8000-000000000001',
  repeat('e', 64),
  '77700000-0000-4000-8000-000000000010',
  now() - interval '1 minute', 'client-master-before-fresh',
  now() - interval '30 seconds', now() + interval '4 minutes',
  now() - interval '5 seconds', now() - interval '5 seconds',
  'client-master-after-fresh', 'totp', now() - interval '5 seconds'
);

update private.reauth_events
set
  challenge_id = '77500000-0000-4000-8000-000000000010',
  verification_method = 'totp',
  verified_at = now() - interval '5 seconds',
  revoked_at = null
where user_id = '77000000-0000-4000-8000-000000000001'
  and session_id = '77600000-0000-4000-8000-000000000001';

select set_config(
  'request.jwt.claims',
  '{"sub":"77000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"77600000-0000-4000-8000-000000000001"}'::text,
  true
);

select is(
  private.current_client_master_reauth_challenge(),
  '77500000-0000-4000-8000-000000000010'::uuid,
  'old and fresh consumed challenges bind deterministically to the fresh current-session evidence'
);

set local role authenticated;
select results_eq(
  $$select row_version, replayed
    from public.create_local_client(
      '77100000-0000-4000-8000-000000000001',
      '77200000-0000-4000-8000-000000000001',
      'FRESH-EVIDENCE', '新證據個案', '1957-07-07',
      '77800000-0000-4000-8000-000000000021'
    )$$,
  $$values (1::bigint, false)$$,
  'fresh current-session evidence authorizes the guarded create workflow'
);

reset role;
select results_eq(
  $$select reauth_challenge_id
    from private.client_master_operations
    where actor_user_id = '77000000-0000-4000-8000-000000000001'
      and idempotency_key = '77800000-0000-4000-8000-000000000021'$$,
  $$values ('77500000-0000-4000-8000-000000000010'::uuid)$$,
  'the new operation receipt retains the fresh challenge rather than older valid evidence'
);

select throws_ok(
  $$update private.client_master_operations
    set request_hash = repeat('f', 64)
    where idempotency_key = '77800000-0000-4000-8000-000000000005'$$,
  '55000', 'client master operation receipts are immutable',
  'even the table owner cannot rewrite an operation receipt'
);

select throws_ok(
  $$delete from private.client_master_operations
    where idempotency_key = '77800000-0000-4000-8000-000000000005'$$,
  '55000', 'client master operation receipts are immutable',
  'even the table owner cannot delete an operation receipt'
);

select ok(
  exists (
    select 1 from public.audit_events event
    where event.table_name = 'private.client_master_operations'
      and event.action = 'insert'
      and event.organization_id = '77100000-0000-4000-8000-000000000001'
  )
  and exists (
    select 1 from public.audit_events event
    where event.table_name = 'public.clients'
      and event.action in ('insert', 'update')
      and event.organization_id = '77100000-0000-4000-8000-000000000001'
  ),
  'client master rows and immutable operation receipts are audited without payloads'
);

select * from finish();
rollback;
