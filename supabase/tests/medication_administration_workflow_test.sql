begin;

select plan(57);

select ok(
  to_regclass('private.medication_administration_operations') is not null
  and exists (
    select 1
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'private'
      and relation.relname = 'medication_administration_operations'
      and relation.relrowsecurity
      and relation.relforcerowsecurity
  ),
  'medication operation receipts are private and force RLS'
);

select ok(
  exists (
    select 1
    from pg_constraint definition
    where definition.conrelid = 'public.medication_administrations'::regclass
      and definition.conname = 'medication_administrations_plan_schedule_key'
      and definition.contype = 'u'
  ),
  'each plan and scheduled time remains unique'
);

select ok(
  exists (
    select 1
    from pg_constraint definition
    where definition.conrelid = 'public.medication_administrations'::regclass
      and definition.conname = 'medication_administrations_execution_reauth_fkey'
      and definition.confrelid = 'private.reauth_challenges'::regclass
      and definition.confdeltype = 'r'
  )
  and exists (
    select 1
    from pg_constraint definition
    where definition.conrelid = 'public.medication_administrations'::regclass
      and definition.conname = 'medication_administrations_verification_reauth_fkey'
      and definition.confrelid = 'private.reauth_challenges'::regclass
      and definition.confdeltype = 'r'
  ),
  'executor and verifier signatures reference immutable consumed challenges'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.record_medication_administration(uuid,uuid,uuid,public.medication_administration_status,timestamptz,numeric,text,text,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.record_medication_administration(uuid,uuid,uuid,public.medication_administration_status,timestamptz,numeric,text,text,uuid)',
    'execute'
  )
  and not (
    select procedure.prosecdef
    from pg_proc procedure
    where procedure.oid =
      'public.record_medication_administration(uuid,uuid,uuid,public.medication_administration_status,timestamptz,numeric,text,text,uuid)'::regprocedure
  ),
  'record RPC is an authenticated-only SECURITY INVOKER wrapper'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.verify_medication_administration(uuid,uuid,uuid,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.verify_medication_administration(uuid,uuid,uuid,uuid)',
    'execute'
  )
  and not (
    select procedure.prosecdef
    from pg_proc procedure
    where procedure.oid =
      'public.verify_medication_administration(uuid,uuid,uuid,uuid)'::regprocedure
  ),
  'verification RPC is an authenticated-only SECURITY INVOKER wrapper'
);

select ok(
  pg_get_function_result(
    'public.record_medication_administration(uuid,uuid,uuid,public.medication_administration_status,timestamptz,numeric,text,text,uuid)'::regprocedure
  ) !~ '(signed_by|challenge_id|content_hash|client_id|medication_plan_id)'
  and pg_get_function_result(
    'public.verify_medication_administration(uuid,uuid,uuid,uuid)'::regprocedure
  ) !~ '(signed_by|challenge_id|content_hash|client_id|medication_plan_id)'
  and not has_function_privilege(
    'authenticated',
    'private.record_medication_administration_atomic(uuid,uuid,uuid,public.medication_administration_status,timestamptz,numeric,text,text,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'private.verify_medication_administration_atomic(uuid,uuid,uuid,uuid)',
    'execute'
  ),
  'browser-callable medication mutations expose only minimal receipts and cannot call full evidence cores'
);

select is(
  pg_get_function_identity_arguments(
    'public.record_medication_administration(uuid,uuid,uuid,public.medication_administration_status,timestamptz,numeric,text,text,uuid)'::regprocedure
  ),
  'p_expected_organization_id uuid, p_expected_branch_id uuid, p_medication_administration_id uuid, p_status medication_administration_status, p_occurred_at timestamp with time zone, p_actual_dose numeric, p_dose_unit text, p_reason text, p_idempotency_key uuid',
  'record input has server-selected context and no caller-authored staff, source, signature, plan, or evidence ID'
);

select ok(
  (
    select
      procedure.prosecdef
      and array_to_string(procedure.proconfig, ',') like 'search_path=%'
    from pg_proc procedure
    where procedure.oid =
      'private.record_medication_administration_atomic(uuid,uuid,uuid,public.medication_administration_status,timestamptz,numeric,text,text,uuid)'::regprocedure
  )
  and (
    select
      procedure.prosecdef
      and array_to_string(procedure.proconfig, ',') like 'search_path=%'
    from pg_proc procedure
    where procedure.oid =
      'private.verify_medication_administration_atomic(uuid,uuid,uuid,uuid)'::regprocedure
  ),
  'private mutation cores are SECURITY DEFINER functions with empty search paths'
);

select ok(
  (
    select procedure.prosecdef
      and array_to_string(procedure.proconfig, ',') like 'search_path=%'
    from pg_proc procedure
    where procedure.oid =
      'private.medication_plan_is_unique_at_occurrence(uuid,uuid,uuid,uuid,uuid,timestamptz)'::regprocedure
  )
  and not has_function_privilege(
    'authenticated',
    'private.medication_plan_is_unique_at_occurrence(uuid,uuid,uuid,uuid,uuid,timestamptz)',
    'execute'
  ),
  'page-7 cutover selection is a private fixed-path helper unreachable from authenticated callers'
);

select ok(
  (
    select
      position('if found then' in function_definition)
        < position('v_now := clock_timestamp()' in function_definition)
      and position('for update;' in function_definition)
        < position('v_now := clock_timestamp()' in function_definition)
      and position('for share;' in function_definition)
        < position('v_now := clock_timestamp()' in function_definition)
      and position('v_now := clock_timestamp()' in function_definition)
        < position('outside the allowed 24-hour window' in function_definition)
    from (
      select pg_get_functiondef(
        'private.record_medication_administration_atomic(uuid,uuid,uuid,public.medication_administration_status,timestamptz,numeric,text,text,uuid)'::regprocedure
      ) as function_definition
    ) definition
  ),
  'record exact replay precedes mutable gates and new writes take a fresh clock after client, slot, and plan locks'
);

select ok(
  not has_table_privilege('authenticated', 'public.medication_plans', 'insert')
  and not has_table_privilege('authenticated', 'public.medication_plans', 'update')
  and not has_table_privilege('authenticated', 'public.medication_plans', 'delete')
  and not has_table_privilege('authenticated', 'public.medication_plans', 'select')
  and not has_table_privilege('service_role', 'public.medication_plans', 'insert')
  and not has_table_privilege('service_role', 'public.medication_plans', 'update')
  and not has_table_privilege('service_role', 'public.medication_plans', 'delete')
  and not has_table_privilege('service_role', 'public.medication_plans', 'select')
  and not has_table_privilege('authenticated', 'public.medication_administrations', 'insert')
  and not has_table_privilege('authenticated', 'public.medication_administrations', 'update')
  and not has_table_privilege('authenticated', 'public.medication_administrations', 'delete')
  and not has_table_privilege('authenticated', 'public.medication_administrations', 'select')
  and not has_table_privilege('service_role', 'public.medication_administrations', 'insert')
  and not has_table_privilege('service_role', 'public.medication_administrations', 'update')
  and not has_table_privilege('service_role', 'public.medication_administrations', 'delete')
  and not has_table_privilege('service_role', 'public.medication_administrations', 'select'),
  'authenticated and service roles cannot bypass minimal medication RPCs through direct table access'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '81000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'med-executor@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '81000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'med-verifier@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '81000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'med-read-only@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());

insert into public.organizations (id, code, name) values
  ('81100000-0000-4000-8000-000000000001', 'med_org_a', '用藥測試機構 A'),
  ('81100000-0000-4000-8000-000000000002', 'med_org_b', '用藥測試機構 B');

insert into public.branches (id, organization_id, code, name) values
  ('81200000-0000-4000-8000-000000000001', '81100000-0000-4000-8000-000000000001', 'main', '用藥 A 主分支'),
  ('81200000-0000-4000-8000-000000000002', '81100000-0000-4000-8000-000000000001', 'other', '用藥 A 其他分支'),
  ('81200000-0000-4000-8000-000000000003', '81100000-0000-4000-8000-000000000002', 'main', '用藥 B 主分支');

insert into public.roles (
  id, organization_id, role_key, name, description, is_system
) values (
  '81900000-0000-4000-8000-000000000001',
  '81100000-0000-4000-8000-000000000001',
  'medication_reader_without_identity',
  '僅用藥閱讀測試角色',
  'Regression fixture intentionally lacking clients.read.',
  false
);

insert into public.role_permissions (role_id, permission_id)
select '81900000-0000-4000-8000-000000000001', permission.id
from public.permissions permission
where permission.permission_key = 'medications.read';

insert into public.profiles (id, display_name, kind) values
  ('81000000-0000-4000-8000-000000000001', '用藥執行人', 'staff'),
  ('81000000-0000-4000-8000-000000000002', '獨立覆核人', 'staff'),
  ('81000000-0000-4000-8000-000000000003', '僅用藥閱讀人員', 'staff');

insert into public.memberships (
  id, organization_id, branch_id, profile_id, status
) values
  ('81300000-0000-4000-8000-000000000001', '81100000-0000-4000-8000-000000000001', '81200000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000001', 'active'),
  ('81300000-0000-4000-8000-000000000002', '81100000-0000-4000-8000-000000000001', '81200000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000002', 'active'),
  ('81300000-0000-4000-8000-000000000003', '81100000-0000-4000-8000-000000000002', '81200000-0000-4000-8000-000000000003', '81000000-0000-4000-8000-000000000001', 'active'),
  ('81300000-0000-4000-8000-000000000004', '81100000-0000-4000-8000-000000000001', '81200000-0000-4000-8000-000000000002', '81000000-0000-4000-8000-000000000001', 'active'),
  ('81300000-0000-4000-8000-000000000005', '81100000-0000-4000-8000-000000000001', '81200000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000003', 'active');

insert into public.membership_roles (membership_id, role_id) values
  ('81300000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000005'),
  ('81300000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000005'),
  ('81300000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000005'),
  ('81300000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000005'),
  ('81300000-0000-4000-8000-000000000005', '81900000-0000-4000-8000-000000000001');

insert into public.clients (
  id, organization_id, branch_id, client_code, display_name, status,
  admitted_on, ended_on, source_system
) values
  ('81400000-0000-4000-8000-000000000001', '81100000-0000-4000-8000-000000000001', '81200000-0000-4000-8000-000000000001', 'MED-A-VALID', '用藥有效個案', 'active', (now() at time zone 'Asia/Taipei')::date - 30, null, 'test'),
  ('81400000-0000-4000-8000-000000000002', '81100000-0000-4000-8000-000000000001', '81200000-0000-4000-8000-000000000001', 'MED-A-CLOSED', '用藥結案個案', 'closed', (now() at time zone 'Asia/Taipei')::date - 30, (now() at time zone 'Asia/Taipei')::date - 1, 'test'),
  ('81400000-0000-4000-8000-000000000003', '81100000-0000-4000-8000-000000000002', '81200000-0000-4000-8000-000000000003', 'MED-B-VALID', '跨機構有效個案', 'active', (now() at time zone 'Asia/Taipei')::date - 30, null, 'test'),
  ('81400000-0000-4000-8000-000000000004', '81100000-0000-4000-8000-000000000001', '81200000-0000-4000-8000-000000000002', 'MED-A-BRANCH2', '跨分支有效個案', 'active', (now() at time zone 'Asia/Taipei')::date - 30, null, 'test');

insert into public.client_assignments (
  id, organization_id, branch_id, client_id, assignee_user_id, assignment_kind
) values
  ('81500000-0000-4000-8000-000000000001', '81100000-0000-4000-8000-000000000001', '81200000-0000-4000-8000-000000000001', '81400000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000001', 'medication'),
  ('81500000-0000-4000-8000-000000000002', '81100000-0000-4000-8000-000000000001', '81200000-0000-4000-8000-000000000001', '81400000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000002', 'medication'),
  ('81500000-0000-4000-8000-000000000003', '81100000-0000-4000-8000-000000000001', '81200000-0000-4000-8000-000000000001', '81400000-0000-4000-8000-000000000002', '81000000-0000-4000-8000-000000000001', 'medication'),
  ('81500000-0000-4000-8000-000000000004', '81100000-0000-4000-8000-000000000002', '81200000-0000-4000-8000-000000000003', '81400000-0000-4000-8000-000000000003', '81000000-0000-4000-8000-000000000001', 'medication'),
  ('81500000-0000-4000-8000-000000000005', '81100000-0000-4000-8000-000000000001', '81200000-0000-4000-8000-000000000002', '81400000-0000-4000-8000-000000000004', '81000000-0000-4000-8000-000000000001', 'medication'),
  ('81500000-0000-4000-8000-000000000006', '81100000-0000-4000-8000-000000000001', '81200000-0000-4000-8000-000000000001', '81400000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000003', 'medication');

insert into private.reauth_challenges (
  id, user_id, session_id, nonce_sha256, idempotency_key, issued_jwt_iat,
  issued_jwt_jti, created_at, expires_at, consumed_at, consumed_jwt_iat,
  consumed_jwt_jti, factor_method, factor_verified_at
) values
  (
    '81600000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000001',
    '81700000-0000-4000-8000-000000000001', repeat('1', 64),
    '81800000-0000-4000-8000-000000000001', now() - interval '2 minutes',
    'executor-before', now() - interval '90 seconds',
    now() + interval '5 minutes', now() - interval '30 seconds',
    now() - interval '30 seconds', 'executor-after', 'totp',
    now() - interval '30 seconds'
  ),
  (
    '81600000-0000-4000-8000-000000000002',
    '81000000-0000-4000-8000-000000000002',
    '81700000-0000-4000-8000-000000000002', repeat('2', 64),
    '81800000-0000-4000-8000-000000000002', now() - interval '2 minutes',
    'verifier-before', now() - interval '90 seconds',
    now() + interval '5 minutes', now() - interval '30 seconds',
    now() - interval '30 seconds', 'verifier-after', 'webauthn',
    now() - interval '30 seconds'
  );

insert into private.reauth_events (
  user_id, session_id, challenge_id, aal, verification_method, verified_at
)
select user_id, session_id, id, 'aal2', factor_method, factor_verified_at
from private.reauth_challenges
where id in (
  '81600000-0000-4000-8000-000000000001',
  '81600000-0000-4000-8000-000000000002'
);

insert into public.medication_plans (
  id, organization_id, branch_id, client_id, record_key, version,
  medication_name, dose, dose_unit, route, schedule, high_risk,
  effective_from, effective_to, status, source_system, signed_at, signed_by,
  content_hash, created_by
) values
  ('81900000-0000-4000-8000-000000000001', '81100000-0000-4000-8000-000000000001', '81200000-0000-4000-8000-000000000001', '81400000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001', 1, '一般錠劑', 10, 'mg', '口服', '{}', false, now() - interval '30 days', now() + interval '30 days', 'active', 'test', now() - interval '1 day', '81000000-0000-4000-8000-000000000001', repeat('a', 64), '81000000-0000-4000-8000-000000000001'),
  ('81900000-0000-4000-8000-000000000002', '81100000-0000-4000-8000-000000000001', '81200000-0000-4000-8000-000000000001', '81400000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000002', 1, '高風險藥物', 5, 'mg', '口服', '{}', true, now() - interval '30 days', now() + interval '30 days', 'active', 'test', now() - interval '1 day', '81000000-0000-4000-8000-000000000001', repeat('b', 64), '81000000-0000-4000-8000-000000000001'),
  ('81900000-0000-4000-8000-000000000003', '81100000-0000-4000-8000-000000000001', '81200000-0000-4000-8000-000000000001', '81400000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000003', 1, '未簽署計畫', 1, '錠', '口服', '{}', false, now() - interval '30 days', now() + interval '30 days', 'draft', 'test', null, null, null, '81000000-0000-4000-8000-000000000001'),
  ('81900000-0000-4000-8000-000000000004', '81100000-0000-4000-8000-000000000001', '81200000-0000-4000-8000-000000000001', '81400000-0000-4000-8000-000000000002', '82000000-0000-4000-8000-000000000004', 1, '結案個案藥物', 2, 'mg', '口服', '{}', false, now() - interval '30 days', now() + interval '30 days', 'active', 'test', now() - interval '1 day', '81000000-0000-4000-8000-000000000001', repeat('c', 64), '81000000-0000-4000-8000-000000000001'),
  ('81900000-0000-4000-8000-000000000005', '81100000-0000-4000-8000-000000000002', '81200000-0000-4000-8000-000000000003', '81400000-0000-4000-8000-000000000003', '82000000-0000-4000-8000-000000000005', 1, '跨機構藥物', 3, 'mg', '口服', '{}', false, now() - interval '30 days', now() + interval '30 days', 'active', 'test', now() - interval '1 day', '81000000-0000-4000-8000-000000000001', repeat('d', 64), '81000000-0000-4000-8000-000000000001'),
  ('81900000-0000-4000-8000-000000000006', '81100000-0000-4000-8000-000000000001', '81200000-0000-4000-8000-000000000002', '81400000-0000-4000-8000-000000000004', '82000000-0000-4000-8000-000000000006', 1, '跨分支藥物', 4, 'mg', '口服', '{}', false, now() - interval '30 days', now() + interval '30 days', 'active', 'test', now() - interval '1 day', '81000000-0000-4000-8000-000000000001', repeat('e', 64), '81000000-0000-4000-8000-000000000001'),
  ('81900000-0000-4000-8000-000000000007', '81100000-0000-4000-8000-000000000001', '81200000-0000-4000-8000-000000000001', '81400000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000007', 1, '換藥舊版', 1, 'mg', '口服', '{}', false, now() - interval '30 days', null, 'active', 'test', now() - interval '1 day', '81000000-0000-4000-8000-000000000001', repeat('f', 64), '81000000-0000-4000-8000-000000000001'),
  ('81900000-0000-4000-8000-000000000008', '81100000-0000-4000-8000-000000000001', '81200000-0000-4000-8000-000000000001', '81400000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000007', 2, '換藥新版', 2, 'mg', '口服', '{}', false, now() - interval '4 minutes', null, 'active', 'test', now() - interval '1 minute', '81000000-0000-4000-8000-000000000002', repeat('1', 64), '81000000-0000-4000-8000-000000000001'),
  ('81900000-0000-4000-8000-000000000009', '81100000-0000-4000-8000-000000000001', '81200000-0000-4000-8000-000000000001', '81400000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000009', 1, '已停止藥物', 1, 'mg', '口服', '{}', false, now() - interval '30 days', null, 'active', 'test', now() - interval '1 day', '81000000-0000-4000-8000-000000000001', repeat('2', 64), '81000000-0000-4000-8000-000000000001');

insert into public.medication_administrations (
  id, organization_id, branch_id, client_id, medication_plan_id,
  scheduled_for, status, requires_second_verification, idempotency_key
) values
  ('82100000-0000-4000-8000-000000000001', '81100000-0000-4000-8000-000000000001', '81200000-0000-4000-8000-000000000001', '81400000-0000-4000-8000-000000000001', '81900000-0000-4000-8000-000000000001', now() - interval '30 minutes', 'scheduled', false, '82200000-0000-4000-8000-000000000001'),
  ('82100000-0000-4000-8000-000000000002', '81100000-0000-4000-8000-000000000001', '81200000-0000-4000-8000-000000000001', '81400000-0000-4000-8000-000000000001', '81900000-0000-4000-8000-000000000002', now() - interval '25 minutes', 'scheduled', false, '82200000-0000-4000-8000-000000000002'),
  ('82100000-0000-4000-8000-000000000003', '81100000-0000-4000-8000-000000000001', '81200000-0000-4000-8000-000000000001', '81400000-0000-4000-8000-000000000001', '81900000-0000-4000-8000-000000000001', now() - interval '20 minutes', 'scheduled', false, '82200000-0000-4000-8000-000000000003'),
  ('82100000-0000-4000-8000-000000000004', '81100000-0000-4000-8000-000000000001', '81200000-0000-4000-8000-000000000001', '81400000-0000-4000-8000-000000000001', '81900000-0000-4000-8000-000000000001', now() - interval '2 hours', 'scheduled', false, '82200000-0000-4000-8000-000000000004'),
  ('82100000-0000-4000-8000-000000000005', '81100000-0000-4000-8000-000000000001', '81200000-0000-4000-8000-000000000001', '81400000-0000-4000-8000-000000000001', '81900000-0000-4000-8000-000000000003', now() - interval '15 minutes', 'scheduled', false, '82200000-0000-4000-8000-000000000005'),
  ('82100000-0000-4000-8000-000000000006', '81100000-0000-4000-8000-000000000001', '81200000-0000-4000-8000-000000000001', '81400000-0000-4000-8000-000000000002', '81900000-0000-4000-8000-000000000004', now() - interval '10 minutes', 'scheduled', false, '82200000-0000-4000-8000-000000000006'),
  ('82100000-0000-4000-8000-000000000007', '81100000-0000-4000-8000-000000000002', '81200000-0000-4000-8000-000000000003', '81400000-0000-4000-8000-000000000003', '81900000-0000-4000-8000-000000000005', now() - interval '10 minutes', 'scheduled', false, '82200000-0000-4000-8000-000000000007'),
  ('82100000-0000-4000-8000-000000000008', '81100000-0000-4000-8000-000000000001', '81200000-0000-4000-8000-000000000002', '81400000-0000-4000-8000-000000000004', '81900000-0000-4000-8000-000000000006', now() - interval '10 minutes', 'scheduled', false, '82200000-0000-4000-8000-000000000008'),
  ('82100000-0000-4000-8000-000000000009', '81100000-0000-4000-8000-000000000001', '81200000-0000-4000-8000-000000000001', '81400000-0000-4000-8000-000000000001', '81900000-0000-4000-8000-000000000001', now() - interval '25 hours', 'scheduled', false, '82200000-0000-4000-8000-000000000009'),
  ('82100000-0000-4000-8000-000000000010', '81100000-0000-4000-8000-000000000001', '81200000-0000-4000-8000-000000000001', '81400000-0000-4000-8000-000000000001', '81900000-0000-4000-8000-000000000001', now() + interval '6 minutes', 'scheduled', false, '82200000-0000-4000-8000-000000000010'),
  ('82100000-0000-4000-8000-000000000011', '81100000-0000-4000-8000-000000000001', '81200000-0000-4000-8000-000000000001', '81400000-0000-4000-8000-000000000001', '81900000-0000-4000-8000-000000000001', now() - interval '5 minutes', 'scheduled', true, '82200000-0000-4000-8000-000000000011'),
  ('82100000-0000-4000-8000-000000000012', '81100000-0000-4000-8000-000000000001', '81200000-0000-4000-8000-000000000001', '81400000-0000-4000-8000-000000000001', '81900000-0000-4000-8000-000000000009', now() - interval '10 minutes', 'scheduled', false, '82200000-0000-4000-8000-000000000012'),
  ('82100000-0000-4000-8000-000000000013', '81100000-0000-4000-8000-000000000001', '81200000-0000-4000-8000-000000000001', '81400000-0000-4000-8000-000000000001', '81900000-0000-4000-8000-000000000007', now() - interval '10 minutes', 'scheduled', false, '82200000-0000-4000-8000-000000000013'),
  ('82100000-0000-4000-8000-000000000014', '81100000-0000-4000-8000-000000000001', '81200000-0000-4000-8000-000000000001', '81400000-0000-4000-8000-000000000001', '81900000-0000-4000-8000-000000000007', now() - interval '3 minutes', 'scheduled', false, '82200000-0000-4000-8000-000000000014'),
  ('82100000-0000-4000-8000-000000000015', '81100000-0000-4000-8000-000000000001', '81200000-0000-4000-8000-000000000001', '81400000-0000-4000-8000-000000000001', '81900000-0000-4000-8000-000000000008', now() - interval '3 minutes', 'scheduled', false, '82200000-0000-4000-8000-000000000015');

insert into private.medication_plan_terminations (
  id, organization_id, branch_id, client_id, medication_plan_id,
  termination_kind, replacement_plan_id, effective_at, reason, stopped_by,
  reauth_challenge_id, content_hash
) values
  ('82400000-0000-4000-8000-000000000001', '81100000-0000-4000-8000-000000000001', '81200000-0000-4000-8000-000000000001', '81400000-0000-4000-8000-000000000001', '81900000-0000-4000-8000-000000000007', 'replaced', '81900000-0000-4000-8000-000000000008', now() - interval '4 minutes', '測試換藥切點', '81000000-0000-4000-8000-000000000002', '81600000-0000-4000-8000-000000000002', repeat('3', 64)),
  ('82400000-0000-4000-8000-000000000002', '81100000-0000-4000-8000-000000000001', '81200000-0000-4000-8000-000000000001', '81400000-0000-4000-8000-000000000001', '81900000-0000-4000-8000-000000000009', 'stopped', null, now() - interval '4 minutes', '測試停止切點', '81000000-0000-4000-8000-000000000002', '81600000-0000-4000-8000-000000000002', repeat('4', 64));

select set_config(
  'test.medication_stop_effective_at',
  (
    select effective_at::text
    from private.medication_plan_terminations
    where medication_plan_id = '81900000-0000-4000-8000-000000000009'
  ),
  true
);

select throws_ok(
  $$insert into public.medication_administrations (
      organization_id, branch_id, client_id, medication_plan_id,
      scheduled_for, status, idempotency_key
    ) values (
      '81100000-0000-4000-8000-000000000001',
      '81200000-0000-4000-8000-000000000001',
      '81400000-0000-4000-8000-000000000001',
      '81900000-0000-4000-8000-000000000001',
      now() - interval '30 minutes', 'scheduled',
      '82200000-0000-4000-8000-000000000099'
    )$$,
  '23505',
  null,
  'the database rejects a duplicate plan and scheduled time'
);

set local role authenticated;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '81000000-0000-4000-8000-000000000001',
    'role', 'authenticated',
    'aal', 'aal1',
    'session_id', '81700000-0000-4000-8000-000000000001'
  )::text,
  true
);

select throws_ok(
  $$select * from public.record_medication_administration(
      '81100000-0000-4000-8000-000000000001',
      '81200000-0000-4000-8000-000000000001',
      '82100000-0000-4000-8000-000000000001',
      'administered', now() - interval '10 minutes', 10, 'mg', null,
      '82300000-0000-4000-8000-000000000001'
    )$$,
  '42501',
  'recent immutable AAL2 evidence is required for medication signing',
  'an AAL1 employee cannot record and sign medication'
);

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '81000000-0000-4000-8000-000000000001',
    'role', 'authenticated',
    'aal', 'aal2',
    'session_id', '81700000-0000-4000-8000-000000000099'
  )::text,
  true
);

select throws_ok(
  $$select * from public.record_medication_administration(
      '81100000-0000-4000-8000-000000000001',
      '81200000-0000-4000-8000-000000000001',
      '82100000-0000-4000-8000-000000000001',
      'administered', now() - interval '10 minutes', 10, 'mg', null,
      '82300000-0000-4000-8000-000000000002'
    )$$,
  '42501',
  'recent immutable AAL2 evidence is required for medication signing',
  'an AAL2 JWT without same-session terminal evidence is rejected'
);

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '81000000-0000-4000-8000-000000000001',
    'role', 'authenticated',
    'aal', 'aal2',
    'session_id', '81700000-0000-4000-8000-000000000001'
  )::text,
  true
);

select throws_ok(
  $$select * from public.record_medication_administration(
      '81100000-0000-4000-8000-000000000001',
      '81200000-0000-4000-8000-000000000001',
      '82100000-0000-4000-8000-000000000003',
      'refused', now() - interval '5 minutes', null, null, null,
      '82300000-0000-4000-8000-000000000003'
    )$$,
  '22023',
  'refused, held, and missed outcomes require a reason and cannot contain an administered dose',
  'refused medication requires a reason'
);

select throws_ok(
  $$select * from public.record_medication_administration(
      '81100000-0000-4000-8000-000000000001',
      '81200000-0000-4000-8000-000000000001',
      '82100000-0000-4000-8000-000000000003',
      'held', now() - interval '5 minutes', 10, 'mg', '暫停',
      '82300000-0000-4000-8000-000000000004'
    )$$,
  '22023',
  'refused, held, and missed outcomes require a reason and cannot contain an administered dose',
  'held medication cannot contain an administered dose'
);

select throws_ok(
  $$select * from public.record_medication_administration(
      '81100000-0000-4000-8000-000000000001',
      '81200000-0000-4000-8000-000000000001',
      '82100000-0000-4000-8000-000000000001',
      'administered', now() - interval '5 minutes', 'NaN'::numeric, 'mg', null,
      '82300000-0000-4000-8000-000000000005'
    )$$,
  '22023',
  'administered medication requires a finite positive actual dose and unit',
  'NaN actual dose is rejected'
);

select throws_ok(
  $$select * from public.record_medication_administration(
      '81100000-0000-4000-8000-000000000001',
      '81200000-0000-4000-8000-000000000001',
      '82100000-0000-4000-8000-000000000001',
      'administered', now() - interval '5 minutes', 'Infinity'::numeric, 'mg', null,
      '82300000-0000-4000-8000-000000000006'
    )$$,
  '22023',
  'administered medication requires a finite positive actual dose and unit',
  'Infinity actual dose is rejected'
);

select throws_ok(
  $$select * from public.record_medication_administration(
      '81100000-0000-4000-8000-000000000001',
      '81200000-0000-4000-8000-000000000001',
      '82100000-0000-4000-8000-000000000001',
      'administered', now() - interval '5 minutes', 10, 'mL', null,
      '82300000-0000-4000-8000-000000000007'
    )$$,
  '23514',
  'actual dose and unit must match the signed medication plan',
  'the actual unit must match the signed plan'
);

select throws_ok(
  $$select * from public.record_medication_administration(
      '81100000-0000-4000-8000-000000000001',
      '81200000-0000-4000-8000-000000000001',
      '82100000-0000-4000-8000-000000000001',
      'administered', now() - interval '5 minutes', 99999999.9999, 'mg', null,
      '82300000-0000-4000-8000-000000000020'
    )$$,
  '23514',
  'actual dose and unit must match the signed medication plan',
  'the first version fails closed on any actual-dose variance from the signed plan'
);

select throws_ok(
  $$select * from public.record_medication_administration(
      '81100000-0000-4000-8000-000000000001',
      '81200000-0000-4000-8000-000000000001',
      '82100000-0000-4000-8000-000000000005',
      'administered', now() - interval '5 minutes', 1, '錠', null,
      '82300000-0000-4000-8000-000000000008'
  )$$,
  '23514',
  'scheduled slot requires exactly one signed medication plan version effective at occurrence',
  'an unsigned or inactive plan cannot authorize execution'
);

select throws_ok(
  $$select * from public.record_medication_administration(
      '81100000-0000-4000-8000-000000000001',
      '81200000-0000-4000-8000-000000000001',
      '82100000-0000-4000-8000-000000000006',
      'administered', now() - interval '5 minutes', 2, 'mg', null,
      '82300000-0000-4000-8000-000000000009'
    )$$,
  '23514',
  'medication administration requires an active, admitted, and unended client',
  'a terminal client cannot receive a new medication outcome'
);

select throws_ok(
  $$select * from public.record_medication_administration(
      '81100000-0000-4000-8000-000000000001',
      '81200000-0000-4000-8000-000000000001',
      '82100000-0000-4000-8000-000000000007',
      'administered', now() - interval '5 minutes', 3, 'mg', null,
      '82300000-0000-4000-8000-000000000010'
    )$$,
  '42501',
  'medication administration is not permitted in the current client scope',
  'selected organization context cannot be used for another organization even when the actor has both memberships'
);

select throws_ok(
  $$select * from public.record_medication_administration(
      '81100000-0000-4000-8000-000000000001',
      '81200000-0000-4000-8000-000000000001',
      '82100000-0000-4000-8000-000000000008',
      'administered', now() - interval '5 minutes', 4, 'mg', null,
      '82300000-0000-4000-8000-000000000011'
    )$$,
  '42501',
  'medication administration is not permitted in the current client scope',
  'selected branch context cannot be used for another assigned branch'
);

select throws_ok(
  $$select * from public.record_medication_administration(
      '81100000-0000-4000-8000-000000000001',
      '81200000-0000-4000-8000-000000000001',
      '82100000-0000-4000-8000-000000000009',
      'missed', now() - interval '25 hours', null, null, '超過時限',
      '82300000-0000-4000-8000-000000000012'
    )$$,
  '22023',
  'medication occurrence or scheduled time is outside the allowed 24-hour window',
  'a new medication outcome older than 24 hours is rejected'
);

select throws_ok(
  $$select * from public.record_medication_administration(
      '81100000-0000-4000-8000-000000000001',
      '81200000-0000-4000-8000-000000000001',
      '82100000-0000-4000-8000-000000000010',
      'administered', now() + interval '6 minutes', 10, 'mg', null,
      '82300000-0000-4000-8000-000000000013'
    )$$,
  '22023',
  'medication occurrence or scheduled time is outside the allowed 24-hour window',
  'a new medication outcome more than five minutes in the future is rejected'
);

select results_eq(
  $$select
      status::text,
      requires_second_verification,
      finalization_state,
      signed_at is not null,
      replayed
    from public.record_medication_administration(
      '81100000-0000-4000-8000-000000000001',
      '81200000-0000-4000-8000-000000000001',
      '82100000-0000-4000-8000-000000000001',
      'administered', now() - interval '10 minutes', 10, 'mg', null,
      '82300000-0000-4000-8000-000000000014'
    )$$,
  $$values (
    'administered'::text,
    false,
    'signed'::text,
    true,
    false
  )$$,
  'a normal medication outcome is signed once by its executor'
);

reset role;

select ok(
  (
    select
      workflow_version = 1
      and execution_source = 'staff'
      and recorded_by = '81000000-0000-4000-8000-000000000001'::uuid
      and signed_by = recorded_by
      and execution_reauth_challenge_id = '81600000-0000-4000-8000-000000000001'::uuid
      and execution_content_hash = content_hash
      and content_hash ~ '^[a-f0-9]{64}$'
      and signed_at = execution_signed_at
    from public.medication_administrations
    where id = '82100000-0000-4000-8000-000000000001'
  ),
  'actor, source, exact first-factor evidence, signature time, and hash are server authored'
);

select ok(
  (
    select challenge.user_id = administration.recorded_by
      and challenge.consumed_at is not null
      and challenge.invalidated_at is null
      and challenge.factor_verified_at between
        administration.execution_signed_at - interval '15 minutes'
        and administration.execution_signed_at + interval '1 minute'
    from public.medication_administrations administration
    join private.reauth_challenges challenge
      on challenge.id = administration.execution_reauth_challenge_id
    where administration.id = '82100000-0000-4000-8000-000000000001'
  ),
  'the executor signature resolves to matching immutable terminal factor evidence'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '81000000-0000-4000-8000-000000000001',
    'role', 'authenticated',
    'aal', 'aal2',
    'session_id', '81700000-0000-4000-8000-000000000001'
  )::text,
  true
);

select results_eq(
  $$select medication_administration_id, finalization_state, replayed
    from public.record_medication_administration(
      '81100000-0000-4000-8000-000000000001',
      '81200000-0000-4000-8000-000000000001',
      '82100000-0000-4000-8000-000000000001',
      'administered', now() - interval '10 minutes', 10, 'mg', null,
      '82300000-0000-4000-8000-000000000014'
    )$$,
  $$values (
    '82100000-0000-4000-8000-000000000001'::uuid,
    'signed'::text,
    true
  )$$,
  'an exact record retry returns its immutable receipt'
);

reset role;

insert into private.reauth_challenges (
  id, user_id, session_id, nonce_sha256, idempotency_key, issued_jwt_iat,
  issued_jwt_jti, created_at, expires_at, consumed_at, consumed_jwt_iat,
  consumed_jwt_jti, factor_method, factor_verified_at
) values (
  '81600000-0000-4000-8000-000000000003',
  '81000000-0000-4000-8000-000000000001',
  '81700000-0000-4000-8000-000000000001', repeat('3', 64),
  '81800000-0000-4000-8000-000000000003', now() - interval '22 minutes',
  'executor-old-before', now() - interval '21 minutes',
  now() - interval '16 minutes', now() - interval '20 minutes',
  now() - interval '20 minutes', 'executor-old-after', 'totp',
  now() - interval '20 minutes'
);

update private.reauth_events
set challenge_id = '81600000-0000-4000-8000-000000000003',
    verification_method = 'totp',
    verified_at = (
      select factor_verified_at
      from private.reauth_challenges
      where id = '81600000-0000-4000-8000-000000000003'
    ),
    revoked_at = null
where user_id = '81000000-0000-4000-8000-000000000001'
  and session_id = '81700000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '81000000-0000-4000-8000-000000000001',
    'role', 'authenticated',
    'aal', 'aal2',
    'session_id', '81700000-0000-4000-8000-000000000001'
  )::text,
  true
);

select throws_ok(
  $$select * from public.record_medication_administration(
      '81100000-0000-4000-8000-000000000001',
      '81200000-0000-4000-8000-000000000001',
      '82100000-0000-4000-8000-000000000001',
      'administered', now() - interval '10 minutes', 10, 'mg', null,
      '82300000-0000-4000-8000-000000000014'
    )$$,
  '42501',
  'current AAL2 and immutable evidence are required to replay medication signing',
  'an exact committed receipt still requires a current-session step-up within fifteen minutes'
);

reset role;

update private.reauth_events
set challenge_id = '81600000-0000-4000-8000-000000000001',
    verification_method = 'totp',
    verified_at = (
      select factor_verified_at
      from private.reauth_challenges
      where id = '81600000-0000-4000-8000-000000000001'
    ),
    revoked_at = null
where user_id = '81000000-0000-4000-8000-000000000001'
  and session_id = '81700000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '81000000-0000-4000-8000-000000000001',
    'role', 'authenticated',
    'aal', 'aal2',
    'session_id', '81700000-0000-4000-8000-000000000001'
  )::text,
  true
);

select throws_ok(
  $$select * from public.record_medication_administration(
      '81100000-0000-4000-8000-000000000001',
      '81200000-0000-4000-8000-000000000001',
      '82100000-0000-4000-8000-000000000012',
      'administered', current_setting('test.medication_stop_effective_at')::timestamptz,
      1, 'mg', null,
      '82300000-0000-4000-8000-000000000021'
    )$$,
  '23514',
  'scheduled slot requires exactly one signed medication plan version effective at occurrence',
  'a stopped plan cannot receive a new execution exactly at its immutable stop cutover'
);

select results_eq(
  $$select medication_administration_id, finalization_state, replayed
    from public.record_medication_administration(
      '81100000-0000-4000-8000-000000000001',
      '81200000-0000-4000-8000-000000000001',
      '82100000-0000-4000-8000-000000000013',
      'administered', now() - interval '5 minutes', 1, 'mg', null,
      '82300000-0000-4000-8000-000000000022'
    )$$,
  $$values (
    '82100000-0000-4000-8000-000000000013'::uuid,
    'signed'::text,
    false
  )$$,
  'the replaced version remains the unique valid plan for an occurrence before the cutover'
);

select throws_ok(
  $$select * from public.record_medication_administration(
      '81100000-0000-4000-8000-000000000001',
      '81200000-0000-4000-8000-000000000001',
      '82100000-0000-4000-8000-000000000014',
      'administered', now() - interval '3 minutes', 1, 'mg', null,
      '82300000-0000-4000-8000-000000000023'
    )$$,
  '23514',
  'scheduled slot requires exactly one signed medication plan version effective at occurrence',
  'the old version cannot be used for an occurrence after its replacement cutover'
);

select results_eq(
  $$select medication_administration_id, finalization_state, replayed
    from public.record_medication_administration(
      '81100000-0000-4000-8000-000000000001',
      '81200000-0000-4000-8000-000000000001',
      '82100000-0000-4000-8000-000000000015',
      'administered', now() - interval '3 minutes', 2, 'mg', null,
      '82300000-0000-4000-8000-000000000024'
    )$$,
  $$values (
    '82100000-0000-4000-8000-000000000015'::uuid,
    'signed'::text,
    false
  )$$,
  'the replacement version is selected uniquely for an occurrence after the cutover'
);

reset role;

select results_eq(
  $$select count(*)::bigint
    from public.medication_administrations
    where id in (
      '82100000-0000-4000-8000-000000000012',
      '82100000-0000-4000-8000-000000000014'
    )
      and status = 'scheduled'
      and workflow_version is null$$,
  $$values (2::bigint)$$,
  'rejected stop and old-version attempts leave both scheduled slots unmodified'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '81000000-0000-4000-8000-000000000001',
    'role', 'authenticated',
    'aal', 'aal2',
    'session_id', '81700000-0000-4000-8000-000000000001'
  )::text,
  true
);

select throws_ok(
  $$select * from public.record_medication_administration(
      '81100000-0000-4000-8000-000000000001',
      '81200000-0000-4000-8000-000000000001',
      '82100000-0000-4000-8000-000000000001',
      'administered', now() - interval '10 minutes', 10, 'mg', '不同內容',
      '82300000-0000-4000-8000-000000000014'
    )$$,
  '23505',
  'medication administration idempotency conflict',
  'reusing a record retry key with different canonical content is rejected'
);

select results_eq(
  $$select
      status::text,
      requires_second_verification,
      finalization_state,
      signed_at is null,
      replayed
    from public.record_medication_administration(
      '81100000-0000-4000-8000-000000000001',
      '81200000-0000-4000-8000-000000000001',
      '82100000-0000-4000-8000-000000000002',
      'administered', now() - interval '8 minutes', 5, 'mg', null,
      '82300000-0000-4000-8000-000000000015'
    )$$,
  $$values (
    'administered'::text,
    true,
    'pending_verification'::text,
    true,
    false
  )$$,
  'a high-risk outcome preserves the first signature but remains pending and unsigned as a final record'
);

select throws_ok(
  $$select * from public.verify_medication_administration(
      '81100000-0000-4000-8000-000000000001',
      '81200000-0000-4000-8000-000000000001',
      '82100000-0000-4000-8000-000000000002',
      '82300000-0000-4000-8000-000000000016'
    )$$,
  '23514',
  'medication administration is not awaiting an independent second verifier',
  'the first executor cannot verify their own high-risk administration'
);

select results_eq(
  $$select finalization_state
    from public.medication_administration_day_snapshot(
      '81100000-0000-4000-8000-000000000001',
      '81200000-0000-4000-8000-000000000001',
      ((now() - interval '25 minutes') at time zone 'Asia/Taipei')::date
    )
    where administration_id = '82100000-0000-4000-8000-000000000002'$$,
  $$values ('pending_verification'::text)$$,
  'the daily snapshot does not count pending high-risk execution as signed completion'
);

select results_eq(
  $$select finalization_state, requires_second_verification
    from public.record_medication_administration(
      '81100000-0000-4000-8000-000000000001',
      '81200000-0000-4000-8000-000000000001',
      '82100000-0000-4000-8000-000000000004',
      'refused', now() - interval '5 minutes', null, null, '家屬表示已停用',
      '82300000-0000-4000-8000-000000000017'
    )$$,
  $$values ('pending_verification'::text, true)$$,
  'the provisional over-60-minute backfill rule requires a second verifier and derives its source'
);

select results_eq(
  $$select execution_source, late_entry
    from public.medication_administration_day_snapshot(
      '81100000-0000-4000-8000-000000000001',
      '81200000-0000-4000-8000-000000000001',
      ((now() - interval '2 hours') at time zone 'Asia/Taipei')::date
    )
    where administration_id = '82100000-0000-4000-8000-000000000004'$$,
  $$values ('staff_backfill'::text, true)$$,
  'an aged scheduled slot is server-marked as a backfill even when the caller supplies a recent occurrence time'
);

select results_eq(
  $$select finalization_state, requires_second_verification
    from public.record_medication_administration(
      '81100000-0000-4000-8000-000000000001',
      '81200000-0000-4000-8000-000000000001',
      '82100000-0000-4000-8000-000000000011',
      'held', now() - interval '3 minutes', null, null, '依既有例外註記暫停',
      '82300000-0000-4000-8000-000000000018'
    )$$,
  $$values ('pending_verification'::text, true)$$,
  'a slot already marked for second verification remains pending even for a normal plan'
);

reset role;

select throws_ok(
  $$update private.reauth_challenges
      set factor_method = 'phone'
      where id = '81600000-0000-4000-8000-000000000001'$$,
  '55000',
  'terminal reauthentication challenge evidence is immutable',
  'consumed factor evidence cannot be rewritten'
);

select throws_ok(
  $$update public.medication_administrations
      set reason = '試圖改寫'
      where id = '82100000-0000-4000-8000-000000000002'$$,
  '55000',
  'pending medication execution may only receive one independent final verification',
  'pending high-risk execution content is immutable before verification'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '81000000-0000-4000-8000-000000000002',
    'role', 'authenticated',
    'aal', 'aal2',
    'session_id', '81700000-0000-4000-8000-000000000002'
  )::text,
  true
);

select results_eq(
  $$select
      finalization_state,
      requires_second_verification,
      signed_at is not null,
      replayed
    from public.verify_medication_administration(
      '81100000-0000-4000-8000-000000000001',
      '81200000-0000-4000-8000-000000000001',
      '82100000-0000-4000-8000-000000000002',
      '82300000-0000-4000-8000-000000000019'
    )$$,
  $$values (
    'signed'::text,
    true,
    true,
    false
  )$$,
  'a different authorized employee independently final-signs high-risk medication'
);

select results_eq(
  $$select medication_administration_id, finalization_state, replayed
    from public.verify_medication_administration(
      '81100000-0000-4000-8000-000000000001',
      '81200000-0000-4000-8000-000000000001',
      '82100000-0000-4000-8000-000000000002',
      '82300000-0000-4000-8000-000000000019'
    )$$,
  $$values (
    '82100000-0000-4000-8000-000000000002'::uuid,
    'signed'::text,
    true
  )$$,
  'an exact verification retry returns the same immutable receipt'
);

reset role;

insert into private.reauth_challenges (
  id, user_id, session_id, nonce_sha256, idempotency_key, issued_jwt_iat,
  issued_jwt_jti, created_at, expires_at, consumed_at, consumed_jwt_iat,
  consumed_jwt_jti, factor_method, factor_verified_at
) values (
  '81600000-0000-4000-8000-000000000004',
  '81000000-0000-4000-8000-000000000002',
  '81700000-0000-4000-8000-000000000002', repeat('4', 64),
  '81800000-0000-4000-8000-000000000004', now() - interval '22 minutes',
  'verifier-old-before', now() - interval '21 minutes',
  now() - interval '16 minutes', now() - interval '20 minutes',
  now() - interval '20 minutes', 'verifier-old-after', 'webauthn',
  now() - interval '20 minutes'
);

update private.reauth_events
set challenge_id = '81600000-0000-4000-8000-000000000004',
    verification_method = 'webauthn',
    verified_at = (
      select factor_verified_at
      from private.reauth_challenges
      where id = '81600000-0000-4000-8000-000000000004'
    ),
    revoked_at = null
where user_id = '81000000-0000-4000-8000-000000000002'
  and session_id = '81700000-0000-4000-8000-000000000002';

set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '81000000-0000-4000-8000-000000000002',
    'role', 'authenticated',
    'aal', 'aal2',
    'session_id', '81700000-0000-4000-8000-000000000002'
  )::text,
  true
);

select throws_ok(
  $$select * from public.verify_medication_administration(
      '81100000-0000-4000-8000-000000000001',
      '81200000-0000-4000-8000-000000000001',
      '82100000-0000-4000-8000-000000000002',
      '82300000-0000-4000-8000-000000000019'
    )$$,
  '42501',
  'current AAL2 and immutable evidence are required to replay medication signing',
  'an exact verification replay also requires a current-session step-up within fifteen minutes'
);

select throws_ok(
  $$select * from public.verify_medication_administration(
      '81100000-0000-4000-8000-000000000001',
      '81200000-0000-4000-8000-000000000001',
      '82100000-0000-4000-8000-000000000004',
      '82300000-0000-4000-8000-000000000019'
    )$$,
  '23505',
  'medication verification idempotency conflict',
  'a verifier cannot reuse a receipt key for another administration'
);

reset role;

select ok(
  (
    select
      second_verified_by = '81000000-0000-4000-8000-000000000002'::uuid
      and signed_by = second_verified_by
      and signed_at = second_verified_at
      and execution_reauth_challenge_id = '81600000-0000-4000-8000-000000000001'::uuid
      and verification_reauth_challenge_id = '81600000-0000-4000-8000-000000000002'::uuid
      and content_hash ~ '^[a-f0-9]{64}$'
    from public.medication_administrations
    where id = '82100000-0000-4000-8000-000000000002'
  ),
  'the final row retains both distinct factor challenges and the verifier-authored final hash'
);

select throws_ok(
  $$update public.medication_administrations
      set reason = '簽後改寫'
      where id = '82100000-0000-4000-8000-000000000002'$$,
  '55000',
  null,
  'a final signed medication row cannot be modified'
);

select throws_ok(
  $$delete from public.medication_administrations
      where id = '82100000-0000-4000-8000-000000000002'$$,
  '55000',
  null,
  'a final signed medication row cannot be deleted'
);

select throws_ok(
  $$update private.medication_administration_operations
      set request_hash = repeat('f', 64)
      where medication_administration_id = '82100000-0000-4000-8000-000000000002'$$,
  '55000',
  'medication administration operation history is immutable',
  'actor-scoped medication receipts cannot be rewritten'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '81000000-0000-4000-8000-000000000001',
    'role', 'authenticated',
    'aal', 'aal2',
    'session_id', '81700000-0000-4000-8000-000000000001'
  )::text,
  true
);

select throws_ok(
  $$insert into public.medication_plans (
      organization_id, branch_id, client_id, medication_name, dose,
      dose_unit, route, schedule, effective_from, status, created_by
    ) values (
      '81100000-0000-4000-8000-000000000001',
      '81200000-0000-4000-8000-000000000001',
      '81400000-0000-4000-8000-000000000001',
      '偽造計畫', 1, '錠', '口服', '{}', now(), 'active',
      '81000000-0000-4000-8000-000000000001'
    )$$,
  '42501',
  null,
  'page 8 cannot forge an active plan before its governed version-and-sign workflow exists'
);

select throws_ok(
  $$update public.medication_administrations
      set recorded_by = '81000000-0000-4000-8000-000000000001'
      where id = '82100000-0000-4000-8000-000000000003'$$,
  '42501',
  null,
  'authenticated users cannot bypass page 7 by direct slot updates'
);

reset role;

update private.reauth_events
set revoked_at = clock_timestamp()
where user_id = '81000000-0000-4000-8000-000000000001'
  and session_id = '81700000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '81000000-0000-4000-8000-000000000001',
    'role', 'authenticated',
    'aal', 'aal2',
    'session_id', '81700000-0000-4000-8000-000000000001'
  )::text,
  true
);

select throws_ok(
  $$select * from public.record_medication_administration(
      '81100000-0000-4000-8000-000000000001',
      '81200000-0000-4000-8000-000000000001',
      '82100000-0000-4000-8000-000000000001',
      'administered', now() - interval '10 minutes', 10, 'mg', null,
      '82300000-0000-4000-8000-000000000014'
  )$$,
  '42501',
  'current AAL2 and immutable evidence are required to replay medication signing',
  'even an exact replay revalidates current unrevoked factor evidence'
);

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '81000000-0000-4000-8000-000000000003',
    'role', 'authenticated',
    'aal', 'aal1'
  )::text,
  true
);

select throws_ok(
  $$select * from public.medication_administration_day_snapshot(
      '81100000-0000-4000-8000-000000000001',
      '81200000-0000-4000-8000-000000000001',
      (now() at time zone 'Asia/Taipei')::date
    )$$,
  '42501',
  'medication snapshot is not permitted in the selected tenant context',
  'medications.read without clients.read cannot disclose client identity through the public snapshot RPC'
);

select * from finish();
rollback;
