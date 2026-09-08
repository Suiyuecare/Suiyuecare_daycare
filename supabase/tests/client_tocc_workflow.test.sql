begin;

select plan(64);

select ok(
  exists (
    select 1
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'client_tocc_assessments'
      and relation.relkind = 'r'
      and relation.relrowsecurity
      and relation.relforcerowsecurity
  ),
  'TOCC assessments exist with forced RLS'
);

select ok(
  (
    select bool_and(relation.relrowsecurity and relation.relforcerowsecurity)
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'private'
      and relation.relname in (
        'client_tocc_operations',
        'client_tocc_batch_operations'
      )
  ),
  'single and batch replay ledgers use forced RLS'
);

select ok(
  not has_table_privilege('authenticated', 'public.client_tocc_assessments', 'select')
  and not has_table_privilege('authenticated', 'public.client_tocc_assessments', 'insert')
  and not has_table_privilege('authenticated', 'public.client_tocc_assessments', 'update')
  and not has_table_privilege('authenticated', 'public.client_tocc_assessments', 'delete')
  and not has_table_privilege('authenticated', 'public.client_tocc_assessments', 'truncate')
  and not has_table_privilege('service_role', 'public.client_tocc_assessments', 'select')
  and not has_table_privilege('service_role', 'public.client_tocc_assessments', 'insert')
  and not has_table_privilege('service_role', 'public.client_tocc_assessments', 'update')
  and not has_table_privilege('service_role', 'public.client_tocc_assessments', 'delete')
  and not has_table_privilege('service_role', 'public.client_tocc_assessments', 'truncate'),
  'authenticated and service roles have no direct TOCC table access'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.record_client_tocc_assessment(uuid,uuid,uuid,date,text,text,text,text,text,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.record_client_tocc_assessment(uuid,uuid,uuid,date,text,text,text,text,text,uuid)',
    'execute'
  )
  and not (
    select procedure.prosecdef
    from pg_proc procedure
    where procedure.oid =
      'public.record_client_tocc_assessment(uuid,uuid,uuid,date,text,text,text,text,text,uuid)'::regprocedure
  ),
  'single public writer is authenticated-only SECURITY INVOKER'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.record_client_tocc_batch(uuid,uuid,jsonb,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.record_client_tocc_batch(uuid,uuid,jsonb,uuid)',
    'execute'
  )
  and not (
    select procedure.prosecdef
    from pg_proc procedure
    where procedure.oid =
      'public.record_client_tocc_batch(uuid,uuid,jsonb,uuid)'::regprocedure
  ),
  'batch public writer is authenticated-only SECURITY INVOKER'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.client_tocc_snapshot(uuid,uuid,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.client_tocc_snapshot(uuid,uuid,uuid)',
    'execute'
  )
  and not (
    select procedure.prosecdef
    from pg_proc procedure
    where procedure.oid =
      'public.client_tocc_snapshot(uuid,uuid,uuid)'::regprocedure
  ),
  'snapshot public RPC is authenticated-only SECURITY INVOKER'
);

select ok(
  (
    select procedure.prosecdef
      and coalesce(procedure.proconfig, '{}'::text[]) @> array['search_path=""']
    from pg_proc procedure
    where procedure.oid =
      'private.record_client_tocc_assessment_atomic(uuid,uuid,uuid,date,text,text,text,text,text,uuid)'::regprocedure
  ),
  'shared private single-item core is fixed-search-path SECURITY DEFINER'
);

select ok(
  pg_get_function_arguments(
    'public.record_client_tocc_assessment(uuid,uuid,uuid,date,text,text,text,text,text,uuid)'::regprocedure
  ) !~ '(actor|signature|source|hash|expiry|valid_through|signed_at|signed_by|challenge)',
  'single caller cannot provide actor, signature, source, hash, expiry, or challenge fields'
);

select ok(
  position(
    'private.record_client_tocc_assessment_atomic'
    in pg_get_functiondef(
      'private.record_client_tocc_batch_atomic(uuid,uuid,jsonb,uuid)'::regprocedure
    )
  ) > 0,
  'batch items invoke the same private single-item validation and write core'
);

select ok(
  position(
    'v_now := clock_timestamp();'
    in substring(
      pg_get_functiondef(
        'private.record_client_tocc_assessment_atomic(uuid,uuid,uuid,date,text,text,text,text,text,uuid)'::regprocedure
      )
      from position(
        'TOCC assessment authority expired'
        in pg_get_functiondef(
          'private.record_client_tocc_assessment_atomic(uuid,uuid,uuid,date,text,text,text,text,text,uuid)'::regprocedure
        )
      )
    )
  ) > 0,
  'signed_at clock is refreshed after lock-time authority rechecks'
);

select ok(
  pg_get_function_result(
    'public.client_tocc_snapshot(uuid,uuid,uuid)'::regprocedure
  ) !~ '(signed_by|challenge|content_hash|idempotency|source|display_name|client_code)',
  'snapshot exposes only the minimal TOCC business projection'
);

select is(
  private.calculate_tocc_valid_through(
    '2026-01-31',
    'calendar-month-asia-taipei-v1'
  ),
  '2026-02-28'::date,
  'non-leap January month-end clamps to February month-end'
);

select is(
  private.calculate_tocc_valid_through(
    '2024-01-31',
    'calendar-month-asia-taipei-v1'
  ),
  '2024-02-29'::date,
  'leap-year January month-end clamps to February 29'
);

select is(
  private.calculate_tocc_valid_through(
    '2026-08-31',
    'calendar-month-asia-taipei-v1'
  ),
  '2026-09-30'::date,
  '31-day month advances to a 30-day destination month deterministically'
);

select is(
  private.calculate_tocc_valid_through(
    '2024-02-29',
    'calendar-month-asia-taipei-v1'
  ),
  '2024-03-29'::date,
  'leap day advances to the same ordinal in March'
);

select ok(
  exists (
    select 1 from pg_trigger trigger_definition
    where trigger_definition.tgrelid = 'public.client_tocc_assessments'::regclass
      and trigger_definition.tgname = 'client_tocc_assessments_prevent_mutation'
      and not trigger_definition.tgisinternal
  ),
  'formal TOCC records have an owner-level immutability trigger'
);

select ok(
  (
    select count(*) = 3
    from pg_trigger trigger_definition
    where trigger_definition.tgname in (
      'client_tocc_assessments_audit_row_change',
      'client_tocc_operations_audit_insert',
      'client_tocc_batch_operations_audit_insert'
    )
      and not trigger_definition.tgisinternal
  ),
  'formal records and both exact-replay ledgers are audited'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '83000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'tocc-writer@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '83000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'tocc-unassigned@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '83000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'tocc-reader@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '83000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'tocc-other-org@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '83000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'tocc-health-only@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());

insert into public.organizations (id, code, name) values
  ('83100000-0000-4000-8000-000000000001', 'tocc_org_a', 'TOCC 測試機構 A'),
  ('83100000-0000-4000-8000-000000000002', 'tocc_org_b', 'TOCC 測試機構 B');

insert into public.branches (id, organization_id, code, name) values
  ('83200000-0000-4000-8000-000000000001', '83100000-0000-4000-8000-000000000001', 'main', 'A 主分支'),
  ('83200000-0000-4000-8000-000000000002', '83100000-0000-4000-8000-000000000001', 'second', 'A 第二分支'),
  ('83200000-0000-4000-8000-000000000003', '83100000-0000-4000-8000-000000000002', 'main', 'B 主分支');

insert into public.profiles (id, display_name, kind) values
  ('83000000-0000-4000-8000-000000000001', 'TOCC 寫入護理師', 'staff'),
  ('83000000-0000-4000-8000-000000000002', 'TOCC 未指派護理師', 'staff'),
  ('83000000-0000-4000-8000-000000000003', 'TOCC 唯讀專業人員', 'professional'),
  ('83000000-0000-4000-8000-000000000004', 'TOCC 其他機構主管', 'staff'),
  ('83000000-0000-4000-8000-000000000005', 'TOCC 僅健康讀取', 'professional');

insert into public.roles (
  id, organization_id, role_key, name, description, is_system
) values (
  '83900000-0000-4000-8000-000000000001',
  '83100000-0000-4000-8000-000000000001',
  'tocc_health_only',
  'TOCC 僅健康讀取',
  'Deliberately lacks clients.read for snapshot boundary tests.',
  false
);

insert into public.role_permissions (role_id, permission_id)
select '83900000-0000-4000-8000-000000000001', permission.id
from public.permissions permission
where permission.permission_key = 'health.read';

insert into public.memberships (
  id, organization_id, branch_id, profile_id, status
) values
  ('83300000-0000-4000-8000-000000000001', '83100000-0000-4000-8000-000000000001', '83200000-0000-4000-8000-000000000001', '83000000-0000-4000-8000-000000000001', 'active'),
  ('83300000-0000-4000-8000-000000000002', '83100000-0000-4000-8000-000000000001', '83200000-0000-4000-8000-000000000001', '83000000-0000-4000-8000-000000000002', 'active'),
  ('83300000-0000-4000-8000-000000000003', '83100000-0000-4000-8000-000000000001', '83200000-0000-4000-8000-000000000001', '83000000-0000-4000-8000-000000000003', 'active'),
  ('83300000-0000-4000-8000-000000000004', '83100000-0000-4000-8000-000000000002', null, '83000000-0000-4000-8000-000000000004', 'active'),
  ('83300000-0000-4000-8000-000000000005', '83100000-0000-4000-8000-000000000001', '83200000-0000-4000-8000-000000000001', '83000000-0000-4000-8000-000000000005', 'active');

insert into public.membership_roles (membership_id, role_id) values
  ('83300000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000005'),
  ('83300000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000005'),
  ('83300000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000007'),
  ('83300000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000002'),
  ('83300000-0000-4000-8000-000000000005', '83900000-0000-4000-8000-000000000001');

insert into public.clients (
  id, organization_id, branch_id, client_code, display_name, status,
  admitted_on, ended_on, source_system
) values
  ('83400000-0000-4000-8000-000000000001', '83100000-0000-4000-8000-000000000001', '83200000-0000-4000-8000-000000000001', 'TOCC-A-001', 'TOCC 個案一', 'active', '2020-01-01', null, 'test'),
  ('83400000-0000-4000-8000-000000000002', '83100000-0000-4000-8000-000000000001', '83200000-0000-4000-8000-000000000001', 'TOCC-A-002', 'TOCC 個案二', 'active', '2020-01-01', null, 'test'),
  ('83400000-0000-4000-8000-000000000003', '83100000-0000-4000-8000-000000000001', '83200000-0000-4000-8000-000000000001', 'TOCC-A-003', 'TOCC 已結案個案', 'closed', '2020-01-01', '2026-01-01', 'test'),
  ('83400000-0000-4000-8000-000000000004', '83100000-0000-4000-8000-000000000001', '83200000-0000-4000-8000-000000000002', 'TOCC-A2-001', 'TOCC 他分支個案', 'active', '2020-01-01', null, 'test'),
  ('83400000-0000-4000-8000-000000000005', '83100000-0000-4000-8000-000000000002', '83200000-0000-4000-8000-000000000003', 'TOCC-B-001', 'TOCC 他機構個案', 'active', '2020-01-01', null, 'test');

insert into public.client_assignments (
  organization_id, branch_id, client_id, assignee_user_id, assignment_kind
) values
  ('83100000-0000-4000-8000-000000000001', '83200000-0000-4000-8000-000000000001', '83400000-0000-4000-8000-000000000001', '83000000-0000-4000-8000-000000000001', 'nurse'),
  ('83100000-0000-4000-8000-000000000001', '83200000-0000-4000-8000-000000000001', '83400000-0000-4000-8000-000000000002', '83000000-0000-4000-8000-000000000001', 'nurse'),
  ('83100000-0000-4000-8000-000000000001', '83200000-0000-4000-8000-000000000001', '83400000-0000-4000-8000-000000000003', '83000000-0000-4000-8000-000000000001', 'nurse'),
  ('83100000-0000-4000-8000-000000000001', '83200000-0000-4000-8000-000000000001', '83400000-0000-4000-8000-000000000001', '83000000-0000-4000-8000-000000000003', 'professional'),
  ('83100000-0000-4000-8000-000000000001', '83200000-0000-4000-8000-000000000001', '83400000-0000-4000-8000-000000000001', '83000000-0000-4000-8000-000000000005', 'professional');

insert into private.reauth_challenges (
  id, user_id, session_id, nonce_sha256, idempotency_key, issued_jwt_iat,
  issued_jwt_jti, created_at, expires_at, consumed_at, consumed_jwt_iat,
  consumed_jwt_jti, factor_method, factor_verified_at
) values
  ('83500000-0000-4000-8000-000000000001', '83000000-0000-4000-8000-000000000001', '83600000-0000-4000-8000-000000000001', repeat('a', 64), '83700000-0000-4000-8000-000000000001', now() - interval '2 minutes', 'tocc-before-1', now() - interval '1 minute', now() + interval '4 minutes', now() - interval '30 seconds', now() - interval '30 seconds', 'tocc-after-1', 'totp', now() - interval '30 seconds'),
  ('83500000-0000-4000-8000-000000000002', '83000000-0000-4000-8000-000000000002', '83600000-0000-4000-8000-000000000002', repeat('b', 64), '83700000-0000-4000-8000-000000000002', now() - interval '2 minutes', 'tocc-before-2', now() - interval '1 minute', now() + interval '4 minutes', now() - interval '30 seconds', now() - interval '30 seconds', 'tocc-after-2', 'totp', now() - interval '30 seconds'),
  ('83500000-0000-4000-8000-000000000003', '83000000-0000-4000-8000-000000000003', '83600000-0000-4000-8000-000000000003', repeat('c', 64), '83700000-0000-4000-8000-000000000003', now() - interval '2 minutes', 'tocc-before-3', now() - interval '1 minute', now() + interval '4 minutes', now() - interval '30 seconds', now() - interval '30 seconds', 'tocc-after-3', 'totp', now() - interval '30 seconds'),
  ('83500000-0000-4000-8000-000000000004', '83000000-0000-4000-8000-000000000004', '83600000-0000-4000-8000-000000000004', repeat('d', 64), '83700000-0000-4000-8000-000000000004', now() - interval '2 minutes', 'tocc-before-4', now() - interval '1 minute', now() + interval '4 minutes', now() - interval '30 seconds', now() - interval '30 seconds', 'tocc-after-4', 'totp', now() - interval '30 seconds'),
  ('83500000-0000-4000-8000-000000000098', '83000000-0000-4000-8000-000000000001', '83600000-0000-4000-8000-000000000001', repeat('f', 64), '83700000-0000-4000-8000-000000000098', now() - interval '18 minutes', 'tocc-before-old-same-session', now() - interval '17 minutes', now() - interval '12 minutes', now() - interval '16 minutes', now() - interval '16 minutes', 'tocc-after-old-same-session', 'totp', now() - interval '16 minutes'),
  ('83500000-0000-4000-8000-000000000099', '83000000-0000-4000-8000-000000000001', '83600000-0000-4000-8000-000000000099', repeat('e', 64), '83700000-0000-4000-8000-000000000099', now() - interval '18 minutes', 'tocc-before-stale', now() - interval '17 minutes', now() - interval '12 minutes', now() - interval '16 minutes', now() - interval '16 minutes', 'tocc-after-stale', 'totp', now() - interval '16 minutes');

insert into private.reauth_events (
  user_id, session_id, challenge_id, aal, verification_method, verified_at
) values
  ('83000000-0000-4000-8000-000000000001', '83600000-0000-4000-8000-000000000001', '83500000-0000-4000-8000-000000000001', 'aal2', 'totp', now() - interval '30 seconds'),
  ('83000000-0000-4000-8000-000000000002', '83600000-0000-4000-8000-000000000002', '83500000-0000-4000-8000-000000000002', 'aal2', 'totp', now() - interval '30 seconds'),
  ('83000000-0000-4000-8000-000000000003', '83600000-0000-4000-8000-000000000003', '83500000-0000-4000-8000-000000000003', 'aal2', 'totp', now() - interval '30 seconds'),
  ('83000000-0000-4000-8000-000000000004', '83600000-0000-4000-8000-000000000004', '83500000-0000-4000-8000-000000000004', 'aal2', 'totp', now() - interval '30 seconds'),
  ('83000000-0000-4000-8000-000000000001', '83600000-0000-4000-8000-000000000099', '83500000-0000-4000-8000-000000000099', 'aal2', 'totp', now() - interval '16 minutes');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"83000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1","session_id":"83600000-0000-4000-8000-000000000001"}',
  true
);

select throws_ok(
  $$select * from public.record_client_tocc_assessment(
    '83100000-0000-4000-8000-000000000001',
    '83200000-0000-4000-8000-000000000001',
    '83400000-0000-4000-8000-000000000001',
    '2026-01-31', 'clear', null, null, 'not_required', 'none_required',
    '83800000-0000-4000-8000-000000000001'
  )$$,
  '42501', 'TOCC assessment is not permitted',
  'AAL1 cannot create a formal TOCC assessment'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"83000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"83600000-0000-4000-8000-000000000090"}',
  true
);

select throws_ok(
  $$select * from public.record_client_tocc_assessment(
    '83100000-0000-4000-8000-000000000001',
    '83200000-0000-4000-8000-000000000001',
    '83400000-0000-4000-8000-000000000001',
    '2026-01-31', 'clear', null, null, 'not_required', 'none_required',
    '83800000-0000-4000-8000-000000000002'
  )$$,
  '42501', 'TOCC assessment is not permitted',
  'AAL2 JWT without same-session immutable evidence is denied'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"83000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"83600000-0000-4000-8000-000000000099"}',
  true
);

select throws_ok(
  $$select * from public.record_client_tocc_assessment(
    '83100000-0000-4000-8000-000000000001',
    '83200000-0000-4000-8000-000000000001',
    '83400000-0000-4000-8000-000000000001',
    '2026-01-31', 'clear', null, null, 'not_required', 'none_required',
    '83800000-0000-4000-8000-000000000003'
  )$$,
  '42501', 'TOCC assessment is not permitted',
  'reauthentication older than 15 minutes is denied'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"83000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"83600000-0000-4000-8000-000000000001"}',
  true
);

reset role;
select is(
  private.current_client_tocc_reauth_challenge(),
  '83500000-0000-4000-8000-000000000001'::uuid,
  'freshest valid immutable challenge wins when the session also has stale evidence'
);
set local role authenticated;

select throws_ok(
  $$select * from public.record_client_tocc_assessment(
    '83100000-0000-4000-8000-000000000001',
    '83200000-0000-4000-8000-000000000001',
    '83400000-0000-4000-8000-000000000001',
    '2099-01-01', 'clear', null, null, 'not_required', 'none_required',
    '83800000-0000-4000-8000-000000000004'
  )$$,
  '22023', 'valid TOCC assessment fields are required',
  'future Taiwan business dates are rejected'
);

select throws_ok(
  $$select * from public.record_client_tocc_assessment(
    '83100000-0000-4000-8000-000000000001',
    '83200000-0000-4000-8000-000000000001',
    '83400000-0000-4000-8000-000000000001',
    '2026-01-31', 'monitor', null, null, 'pending', 'pending',
    '83800000-0000-4000-8000-000000000005'
  )$$,
  '22023', 'valid TOCC assessment fields are required',
  'non-clear results require a symptom or risk summary'
);

select throws_ok(
  $$select * from public.record_client_tocc_assessment(
    '83100000-0000-4000-8000-000000000001',
    '83200000-0000-4000-8000-000000000001',
    '83400000-0000-4000-8000-000000000001',
    '2026-01-31', 'action_required', '有症狀', null, 'pending', 'none_required',
    '83800000-0000-4000-8000-000000000006'
  )$$,
  '22023', 'valid TOCC assessment fields are required',
  'action-required results cannot claim that no action is required'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"83000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2","session_id":"83600000-0000-4000-8000-000000000003"}',
  true
);

select throws_ok(
  $$select * from public.record_client_tocc_assessment(
    '83100000-0000-4000-8000-000000000001',
    '83200000-0000-4000-8000-000000000001',
    '83400000-0000-4000-8000-000000000001',
    '2026-01-31', 'clear', null, null, 'not_required', 'none_required',
    '83800000-0000-4000-8000-000000000007'
  )$$,
  '42501', 'TOCC assessment is not permitted',
  'assigned reader without health.write cannot create TOCC records'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"83000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"83600000-0000-4000-8000-000000000002"}',
  true
);

select throws_ok(
  $$select * from public.record_client_tocc_assessment(
    '83100000-0000-4000-8000-000000000001',
    '83200000-0000-4000-8000-000000000001',
    '83400000-0000-4000-8000-000000000001',
    '2026-01-31', 'clear', null, null, 'not_required', 'none_required',
    '83800000-0000-4000-8000-000000000008'
  )$$,
  '42501', 'TOCC client is outside the active assigned scope',
  'write-capable but unassigned staff cannot create a TOCC record'
);

select is(
  (select count(*)::integer from public.client_tocc_snapshot(
    '83100000-0000-4000-8000-000000000001',
    '83200000-0000-4000-8000-000000000001',
    '83400000-0000-4000-8000-000000000001'
  )),
  0,
  'unassigned staff cannot read an existing-client TOCC projection'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"83000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"83600000-0000-4000-8000-000000000001"}',
  true
);

select throws_ok(
  $$select * from public.record_client_tocc_assessment(
    '83100000-0000-4000-8000-000000000001',
    '83200000-0000-4000-8000-000000000002',
    '83400000-0000-4000-8000-000000000004',
    '2026-01-31', 'clear', null, null, 'not_required', 'none_required',
    '83800000-0000-4000-8000-000000000009'
  )$$,
  '42501', 'TOCC assessment is not permitted',
  'cross-branch write is denied before client lookup'
);

select throws_ok(
  $$select * from public.record_client_tocc_assessment(
    '83100000-0000-4000-8000-000000000002',
    '83200000-0000-4000-8000-000000000003',
    '83400000-0000-4000-8000-000000000005',
    '2026-01-31', 'clear', null, null, 'not_required', 'none_required',
    '83800000-0000-4000-8000-000000000010'
  )$$,
  '42501', 'TOCC assessment is not permitted',
  'cross-organization write is denied before client lookup'
);

select throws_ok(
  $$select * from public.record_client_tocc_assessment(
    '83100000-0000-4000-8000-000000000001',
    '83200000-0000-4000-8000-000000000001',
    '83400000-0000-4000-8000-000000000003',
    '2026-01-01', 'clear', null, null, 'not_required', 'none_required',
    '83800000-0000-4000-8000-000000000011'
  )$$,
  '42501', 'TOCC client is outside the active assigned scope',
  'closed clients cannot receive a new formal TOCC assessment'
);

select results_eq(
  $$select assessment_version, assessment_date, valid_through,
           result_status collate "C", evidence_status collate "C",
           action_status collate "C", replayed
    from public.record_client_tocc_assessment(
      '83100000-0000-4000-8000-000000000001',
      '83200000-0000-4000-8000-000000000001',
      '83400000-0000-4000-8000-000000000001',
      '2026-01-31', ' CLEAR ', null, null, ' NOT_REQUIRED ', ' NONE_REQUIRED ',
      '83800000-0000-4000-8000-000000000001'
    )$$,
  $$values (
    1::integer,
    '2026-01-31'::date,
    '2026-02-28'::date,
    'clear'::text collate "C",
    'not_required'::text collate "C",
    'none_required'::text collate "C",
    false
  )$$,
  'authorized single write normalizes statuses and applies the versioned calendar-month rule'
);

reset role;
select results_eq(
  $$select source collate "C", signed_by, signature_purpose collate "C",
           signature_reauth_challenge_id,
           validity_rule_version collate "C",
           content_hash ~ '^[a-f0-9]{64}$'
    from public.client_tocc_assessments
    where client_id = '83400000-0000-4000-8000-000000000001'
      and assessment_version = 1$$,
  $$values (
    'staff'::text collate "C",
    '83000000-0000-4000-8000-000000000001'::uuid,
    '個案 TOCC 評估確認'::text collate "C",
    '83500000-0000-4000-8000-000000000001'::uuid,
    'calendar-month-asia-taipei-v1'::text collate "C",
    true
  )$$,
  'actor, source, purpose, immutable challenge, formula version, and hash are server authored'
);
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"83000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"83600000-0000-4000-8000-000000000001"}',
  true
);

select results_eq(
  $$select assessment_version, replayed
    from public.record_client_tocc_assessment(
      '83100000-0000-4000-8000-000000000001',
      '83200000-0000-4000-8000-000000000001',
      '83400000-0000-4000-8000-000000000001',
      '2026-01-31', 'clear', null, null, 'not_required', 'none_required',
      '83800000-0000-4000-8000-000000000001'
    )$$,
  $$values (1::integer, true)$$,
  'exact single request replays the original immutable result'
);

reset role;
select is(
  (select count(*)::integer
   from private.client_tocc_operations
   where actor_user_id = '83000000-0000-4000-8000-000000000001'
     and idempotency_key = '83800000-0000-4000-8000-000000000001'),
  1,
  'single exact replay creates no duplicate record or receipt'
);
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"83000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"83600000-0000-4000-8000-000000000001"}',
  true
);

select throws_ok(
  $$select * from public.record_client_tocc_assessment(
    '83100000-0000-4000-8000-000000000001',
    '83200000-0000-4000-8000-000000000001',
    '83400000-0000-4000-8000-000000000001',
    '2026-01-31', 'monitor', '內容改變', null, 'pending', 'pending',
    '83800000-0000-4000-8000-000000000001'
  )$$,
  '23505', 'TOCC assessment idempotency conflict',
  'same actor and item key cannot represent changed content'
);

select results_eq(
  $$select assessment_version, replayed
    from public.record_client_tocc_assessment(
      '83100000-0000-4000-8000-000000000001',
      '83200000-0000-4000-8000-000000000001',
      '83400000-0000-4000-8000-000000000001',
      (clock_timestamp() at time zone 'Asia/Taipei')::date,
      'monitor', '咳嗽', '持續觀察', 'pending', 'in_progress',
      '83800000-0000-4000-8000-000000000020'
    )$$,
  $$values (2::integer, false)$$,
  'later assessment appends version two'
);

reset role;
select ok(
  exists (
    select 1
    from public.client_tocc_assessments current_assessment
    join public.client_tocc_assessments previous_assessment
      on previous_assessment.id = current_assessment.previous_assessment_id
    where current_assessment.client_id = '83400000-0000-4000-8000-000000000001'
      and current_assessment.assessment_version = 2
      and previous_assessment.assessment_version = 1
  ),
  'version two preserves a same-client predecessor link'
);
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"83000000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal2"}',
  true
);

select throws_ok(
  $$select * from public.client_tocc_snapshot(
    '83100000-0000-4000-8000-000000000001',
    '83200000-0000-4000-8000-000000000001',
    '83400000-0000-4000-8000-000000000001'
  )$$,
  '42501', 'TOCC snapshot is not permitted',
  'health.read without clients.read cannot access the TOCC snapshot'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"83000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}',
  true
);

select results_eq(
  $$select assessment_version, validity_status collate "C",
           result_status collate "C"
    from public.client_tocc_snapshot(
      '83100000-0000-4000-8000-000000000001',
      '83200000-0000-4000-8000-000000000001',
      '83400000-0000-4000-8000-000000000001'
    )$$,
  $$values (
    2::integer,
    'current'::text collate "C",
    'monitor'::text collate "C"
  )$$,
  'assigned reader receives only the latest authorized current projection'
);

select throws_ok(
  $$select * from public.client_tocc_snapshot(
    '83100000-0000-4000-8000-000000000001',
    '83200000-0000-4000-8000-000000000002',
    null
  )$$,
  '42501', 'TOCC snapshot is not permitted',
  'cross-branch snapshot selection is denied'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"83000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"83600000-0000-4000-8000-000000000001"}',
  true
);

select throws_ok(
  $$insert into public.client_tocc_assessments (
    organization_id, branch_id, client_id, assessment_version,
    assessment_date, valid_through, validity_rule_version, result_status,
    evidence_status, action_status, source, signed_at, signed_by,
    signature_purpose, signature_reauth_challenge_id, content_hash
  ) values (
    '83100000-0000-4000-8000-000000000001',
    '83200000-0000-4000-8000-000000000001',
    '83400000-0000-4000-8000-000000000002',
    1, current_date, current_date + 30,
    'calendar-month-asia-taipei-v1', 'clear', 'not_required',
    'none_required', 'staff', now(),
    '83000000-0000-4000-8000-000000000001', '個案 TOCC 評估確認',
    '83500000-0000-4000-8000-000000000001', repeat('a', 64)
  )$$,
  '42501', null,
  'authenticated cannot directly insert a formal TOCC record'
);

select throws_ok(
  $$update public.client_tocc_assessments
    set result_status = 'monitor'
    where client_id = '83400000-0000-4000-8000-000000000001'$$,
  '42501', null,
  'authenticated cannot directly rewrite a formal TOCC record'
);

select throws_ok(
  $$delete from public.client_tocc_assessments
    where client_id = '83400000-0000-4000-8000-000000000001'$$,
  '42501', null,
  'authenticated cannot directly delete a formal TOCC record'
);

reset role;
set local role service_role;
select throws_ok(
  $$insert into public.client_tocc_assessments (
    organization_id, branch_id, client_id, assessment_version,
    assessment_date, valid_through, validity_rule_version, result_status,
    evidence_status, action_status, source, signed_at, signed_by,
    signature_purpose, signature_reauth_challenge_id, content_hash
  ) values (
    '83100000-0000-4000-8000-000000000001',
    '83200000-0000-4000-8000-000000000001',
    '83400000-0000-4000-8000-000000000002',
    1, current_date, current_date + 30,
    'calendar-month-asia-taipei-v1', 'clear', 'not_required',
    'none_required', 'staff', now(),
    '83000000-0000-4000-8000-000000000001', '個案 TOCC 評估確認',
    '83500000-0000-4000-8000-000000000001', repeat('a', 64)
  )$$,
  '42501', null,
  'service role cannot bypass the governed TOCC writer'
);

reset role;
insert into public.client_assignments (
  organization_id, branch_id, client_id, assignee_user_id, assignment_kind
) values (
  '83100000-0000-4000-8000-000000000001',
  '83200000-0000-4000-8000-000000000001',
  '83400000-0000-4000-8000-000000000001',
  '83000000-0000-4000-8000-000000000002',
  'nurse'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"83000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"83600000-0000-4000-8000-000000000002"}',
  true
);

select results_eq(
  $$select assessment_version, replayed
    from public.record_client_tocc_assessment(
      '83100000-0000-4000-8000-000000000001',
      '83200000-0000-4000-8000-000000000001',
      '83400000-0000-4000-8000-000000000001',
      '2026-01-31', 'clear', null, null, 'not_required', 'none_required',
      '83800000-0000-4000-8000-000000000001'
    )$$,
  $$values (3::integer, false)$$,
  'the same UUID item key is independent for a different actor'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"83000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"83600000-0000-4000-8000-000000000001"}',
  true
);

select results_eq(
  $$select status collate "C", count(*)::bigint
    from public.record_client_tocc_batch(
      '83100000-0000-4000-8000-000000000001',
      '83200000-0000-4000-8000-000000000001',
      jsonb_build_array(
        jsonb_build_object(
          'client_id', '83400000-0000-4000-8000-000000000001',
          'assessment_date', (clock_timestamp() at time zone 'Asia/Taipei')::date,
          'result_status', 'action_required',
          'symptom_summary', '發燒',
          'risk_summary', '需追蹤',
          'evidence_status', 'pending',
          'action_status', 'pending',
          'idempotency_key', '83800000-0000-4000-8000-000000000030'
        ),
        jsonb_build_object(
          'client_id', '83400000-0000-4000-8000-000000000002',
          'assessment_date', (clock_timestamp() at time zone 'Asia/Taipei')::date,
          'result_status', 'clear',
          'evidence_status', 'not_required',
          'action_status', 'none_required',
          'idempotency_key', '83800000-0000-4000-8000-000000000031'
        ),
        jsonb_build_object(
          'client_id', '83400000-0000-4000-8000-000000000002',
          'assessment_date', '2099-01-01',
          'result_status', 'clear',
          'evidence_status', 'not_required',
          'action_status', 'none_required',
          'idempotency_key', '83800000-0000-4000-8000-000000000032'
        )
      ),
      '83800000-0000-4000-8000-000000000100'
    )
    group by status
    order by status collate "C"$$,
  $$values
    ('failed'::text collate "C", 1::bigint),
    ('success'::text collate "C", 2::bigint)$$,
  'batch preserves two successes while returning one failed item'
);

select results_eq(
  $$select item_index, (error ->> 'code') collate "C",
           (error ->> 'sqlstate') collate "C",
           (error ->> 'retryable')::boolean
    from public.record_client_tocc_batch(
      '83100000-0000-4000-8000-000000000001',
      '83200000-0000-4000-8000-000000000001',
      jsonb_build_array(
        jsonb_build_object(
          'client_id', '83400000-0000-4000-8000-000000000001',
          'assessment_date', (clock_timestamp() at time zone 'Asia/Taipei')::date,
          'result_status', 'action_required', 'symptom_summary', '發燒',
          'risk_summary', '需追蹤', 'evidence_status', 'pending',
          'action_status', 'pending',
          'idempotency_key', '83800000-0000-4000-8000-000000000030'
        ),
        jsonb_build_object(
          'client_id', '83400000-0000-4000-8000-000000000002',
          'assessment_date', (clock_timestamp() at time zone 'Asia/Taipei')::date,
          'result_status', 'clear', 'evidence_status', 'not_required',
          'action_status', 'none_required',
          'idempotency_key', '83800000-0000-4000-8000-000000000031'
        ),
        jsonb_build_object(
          'client_id', '83400000-0000-4000-8000-000000000002',
          'assessment_date', '2099-01-01', 'result_status', 'clear',
          'evidence_status', 'not_required', 'action_status', 'none_required',
          'idempotency_key', '83800000-0000-4000-8000-000000000032'
        )
      ),
      '83800000-0000-4000-8000-000000000100'
    ) where status = 'failed'$$,
  $$values (
    3::integer,
    'validation_failed'::text collate "C",
    '22023'::text collate "C",
    false
  )$$,
  'failed batch item has a stable structured error without a stack or payload'
);

reset role;
select is(
  (select count(*)::integer
   from private.client_tocc_operations
   where actor_user_id = '83000000-0000-4000-8000-000000000001'
     and idempotency_key in (
       '83800000-0000-4000-8000-000000000030',
       '83800000-0000-4000-8000-000000000031',
       '83800000-0000-4000-8000-000000000032'
     )),
  2,
  'only the two successful batch items create immutable receipts'
);
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"83000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"83600000-0000-4000-8000-000000000001"}',
  true
);

select results_eq(
  $$select count(*)::bigint,
           bool_and(batch_replayed),
           bool_or(item_replayed)
    from public.record_client_tocc_batch(
      '83100000-0000-4000-8000-000000000001',
      '83200000-0000-4000-8000-000000000001',
      jsonb_build_array(
        jsonb_build_object(
          'client_id', '83400000-0000-4000-8000-000000000001',
          'assessment_date', (clock_timestamp() at time zone 'Asia/Taipei')::date,
          'result_status', 'action_required', 'symptom_summary', '發燒',
          'risk_summary', '需追蹤', 'evidence_status', 'pending',
          'action_status', 'pending',
          'idempotency_key', '83800000-0000-4000-8000-000000000030'
        ),
        jsonb_build_object(
          'client_id', '83400000-0000-4000-8000-000000000002',
          'assessment_date', (clock_timestamp() at time zone 'Asia/Taipei')::date,
          'result_status', 'clear', 'evidence_status', 'not_required',
          'action_status', 'none_required',
          'idempotency_key', '83800000-0000-4000-8000-000000000031'
        ),
        jsonb_build_object(
          'client_id', '83400000-0000-4000-8000-000000000002',
          'assessment_date', '2099-01-01', 'result_status', 'clear',
          'evidence_status', 'not_required', 'action_status', 'none_required',
          'idempotency_key', '83800000-0000-4000-8000-000000000032'
        )
      ),
      '83800000-0000-4000-8000-000000000100'
    )$$,
  $$values (3::bigint, true, false)$$,
  'exact outer batch replay returns the frozen three-item result without rerunning items'
);

reset role;
select is(
  (select count(*)::integer
   from private.client_tocc_batch_operations
   where actor_user_id = '83000000-0000-4000-8000-000000000001'
     and idempotency_key = '83800000-0000-4000-8000-000000000100'),
  1,
  'exact outer batch replay creates no duplicate batch receipt'
);
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"83000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"83600000-0000-4000-8000-000000000001"}',
  true
);

select throws_ok(
  $$select * from public.record_client_tocc_batch(
    '83100000-0000-4000-8000-000000000001',
    '83200000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'client_id', '83400000-0000-4000-8000-000000000001',
      'assessment_date', (clock_timestamp() at time zone 'Asia/Taipei')::date,
      'result_status', 'clear', 'evidence_status', 'not_required',
      'action_status', 'none_required',
      'idempotency_key', '83800000-0000-4000-8000-000000000030'
    )),
    '83800000-0000-4000-8000-000000000100'
  )$$,
  '23505', 'TOCC batch idempotency conflict',
  'same outer batch key cannot represent changed items'
);

select results_eq(
  $$select status collate "C", count(*)::bigint,
           bool_and(item_replayed) filter (where status = 'success')
    from public.record_client_tocc_batch(
      '83100000-0000-4000-8000-000000000001',
      '83200000-0000-4000-8000-000000000001',
      jsonb_build_array(
        jsonb_build_object(
          'client_id', '83400000-0000-4000-8000-000000000001',
          'assessment_date', (clock_timestamp() at time zone 'Asia/Taipei')::date,
          'result_status', 'action_required', 'symptom_summary', '發燒',
          'risk_summary', '需追蹤', 'evidence_status', 'pending',
          'action_status', 'pending',
          'idempotency_key', '83800000-0000-4000-8000-000000000030'
        ),
        jsonb_build_object(
          'client_id', '83400000-0000-4000-8000-000000000002',
          'assessment_date', (clock_timestamp() at time zone 'Asia/Taipei')::date,
          'result_status', 'clear', 'evidence_status', 'not_required',
          'action_status', 'none_required',
          'idempotency_key', '83800000-0000-4000-8000-000000000031'
        ),
        jsonb_build_object(
          'client_id', '83400000-0000-4000-8000-000000000002',
          'assessment_date', '2099-01-01', 'result_status', 'clear',
          'evidence_status', 'not_required', 'action_status', 'none_required',
          'idempotency_key', '83800000-0000-4000-8000-000000000032'
        )
      ),
      '83800000-0000-4000-8000-000000000101'
    )
    group by status
    order by status collate "C"$$,
  $$values
    ('failed'::text collate "C", 1::bigint, null::boolean),
    ('success'::text collate "C", 2::bigint, true)$$,
  'new outer retry replays prior successes item-by-item and retries only the failed item'
);

reset role;
select is(
  (select count(*)::integer
   from private.client_tocc_operations
   where actor_user_id = '83000000-0000-4000-8000-000000000001'
     and idempotency_key in (
       '83800000-0000-4000-8000-000000000030',
       '83800000-0000-4000-8000-000000000031'
     )),
  2,
  'new outer retry does not duplicate already-successful item receipts'
);
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"83000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"83600000-0000-4000-8000-000000000001"}',
  true
);

select results_eq(
  $$select status collate "C", item_replayed, batch_replayed
    from public.record_client_tocc_batch(
      '83100000-0000-4000-8000-000000000001',
      '83200000-0000-4000-8000-000000000001',
      jsonb_build_array(jsonb_build_object(
        'client_id', '83400000-0000-4000-8000-000000000002',
        'assessment_date', (clock_timestamp() at time zone 'Asia/Taipei')::date,
        'result_status', 'monitor', 'risk_summary', '修正後可處理',
        'evidence_status', 'pending', 'action_status', 'pending',
        'idempotency_key', '83800000-0000-4000-8000-000000000032'
      )),
      '83800000-0000-4000-8000-000000000102'
    )$$,
  $$values ('success'::text collate "C", false, false)$$,
  'a previously failed item can succeed with corrected content and the same unused item key'
);

select results_eq(
  $$select status collate "C", (error ->> 'code') collate "C"
    from public.record_client_tocc_batch(
      '83100000-0000-4000-8000-000000000001',
      '83200000-0000-4000-8000-000000000001',
      jsonb_build_array(jsonb_build_object(
        'client_id', '83400000-0000-4000-8000-000000000002',
        'assessment_date', (clock_timestamp() at time zone 'Asia/Taipei')::date,
        'result_status', 'clear', 'evidence_status', 'not_required',
        'action_status', 'none_required',
        'source', 'caller-forged',
        'idempotency_key', '83800000-0000-4000-8000-000000000033'
      )),
      '83800000-0000-4000-8000-000000000103'
    )$$,
  $$values (
    'failed'::text collate "C",
    'validation_failed'::text collate "C"
  )$$,
  'batch rejects caller-supplied source or other non-allowlisted evidence fields'
);

select throws_ok(
  $$select * from public.record_client_tocc_batch(
    '83100000-0000-4000-8000-000000000001',
    '83200000-0000-4000-8000-000000000001',
    '[]'::jsonb,
    '83800000-0000-4000-8000-000000000104'
  )$$,
  '22023', 'TOCC batch must contain between 1 and 100 items',
  'empty batches are rejected before any work'
);

select throws_ok(
  $$select * from public.record_client_tocc_batch(
    '83100000-0000-4000-8000-000000000001',
    '83200000-0000-4000-8000-000000000001',
    '{"client_id":"83400000-0000-4000-8000-000000000002"}'::jsonb,
    '83800000-0000-4000-8000-000000000105'
  )$$,
  '22023', 'TOCC batch must contain between 1 and 100 items',
  'non-array batch payloads fail with the controlled validation contract'
);

reset role;

select throws_ok(
  $$update public.client_tocc_assessments
    set risk_summary = 'owner-forged'
    where client_id = '83400000-0000-4000-8000-000000000001'
      and assessment_version = 1$$,
  '55000', 'formal TOCC records and operation receipts are immutable',
  'even the table owner cannot rewrite a formal TOCC record'
);

select throws_ok(
  $$delete from public.client_tocc_assessments
    where client_id = '83400000-0000-4000-8000-000000000001'
      and assessment_version = 1$$,
  '55000', 'formal TOCC records and operation receipts are immutable',
  'even the table owner cannot delete a formal TOCC record'
);

select throws_ok(
  $$update private.client_tocc_operations
    set request_hash = repeat('f', 64)
    where actor_user_id = '83000000-0000-4000-8000-000000000001'
      and idempotency_key = '83800000-0000-4000-8000-000000000001'$$,
  '55000', 'formal TOCC records and operation receipts are immutable',
  'even the table owner cannot rewrite a single-item replay receipt'
);

select throws_ok(
  $$delete from private.client_tocc_batch_operations
    where actor_user_id = '83000000-0000-4000-8000-000000000001'
      and idempotency_key = '83800000-0000-4000-8000-000000000100'$$,
  '55000', 'formal TOCC records and operation receipts are immutable',
  'even the table owner cannot delete a batch replay receipt'
);

delete from public.client_assignments
where client_id = '83400000-0000-4000-8000-000000000001'
  and assignee_user_id = '83000000-0000-4000-8000-000000000001'
  and ends_at is null;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"83000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"83600000-0000-4000-8000-000000000001"}',
  true
);

select is(
  (select count(*)::integer
   from public.client_tocc_snapshot(
     '83100000-0000-4000-8000-000000000001',
     '83200000-0000-4000-8000-000000000001',
     '83400000-0000-4000-8000-000000000001'
   )),
  0,
  'snapshot immediately hides a client after the actor assignment is revoked'
);

select throws_ok(
  $$select * from public.record_client_tocc_batch(
    '83100000-0000-4000-8000-000000000001',
    '83200000-0000-4000-8000-000000000001',
    jsonb_build_array(
      jsonb_build_object(
        'client_id', '83400000-0000-4000-8000-000000000001',
        'assessment_date', (clock_timestamp() at time zone 'Asia/Taipei')::date,
        'result_status', 'action_required', 'symptom_summary', '發燒',
        'risk_summary', '需追蹤', 'evidence_status', 'pending',
        'action_status', 'pending',
        'idempotency_key', '83800000-0000-4000-8000-000000000030'
      ),
      jsonb_build_object(
        'client_id', '83400000-0000-4000-8000-000000000002',
        'assessment_date', (clock_timestamp() at time zone 'Asia/Taipei')::date,
        'result_status', 'clear', 'evidence_status', 'not_required',
        'action_status', 'none_required',
        'idempotency_key', '83800000-0000-4000-8000-000000000031'
      ),
      jsonb_build_object(
        'client_id', '83400000-0000-4000-8000-000000000002',
        'assessment_date', '2099-01-01', 'result_status', 'clear',
        'evidence_status', 'not_required', 'action_status', 'none_required',
        'idempotency_key', '83800000-0000-4000-8000-000000000032'
      )
    ),
    '83800000-0000-4000-8000-000000000100'
  )$$,
  '42501', 'TOCC batch replay client access is not permitted',
  'exact batch replay fails closed when any successful client assignment was revoked'
);

reset role;

select ok(
  exists (
    select 1 from public.audit_events event
    where event.table_name = 'public.client_tocc_assessments'
      and event.action = 'insert'
      and event.organization_id = '83100000-0000-4000-8000-000000000001'
  )
  and exists (
    select 1 from public.audit_events event
    where event.table_name = 'private.client_tocc_operations'
      and event.action = 'insert'
      and event.organization_id = '83100000-0000-4000-8000-000000000001'
  )
  and exists (
    select 1 from public.audit_events event
    where event.table_name = 'private.client_tocc_batch_operations'
      and event.action = 'insert'
      and event.organization_id = '83100000-0000-4000-8000-000000000001'
  )
  and exists (
    select 1 from public.audit_events event
    where event.table_name = 'client_tocc_assessments'
      and event.action = 'select'
      and event.organization_id = '83100000-0000-4000-8000-000000000001'
      and event.metadata ->> 'projection' = 'page9_latest'
  ),
  'formal records, replay receipts, and snapshot reads leave tenant-scoped audit events'
);

select * from finish();
rollback;
