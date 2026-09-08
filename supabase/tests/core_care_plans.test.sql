begin;

select plan(41);

select ok(
  to_regclass('public.authorized_care_plans') is not null
  and to_regclass('public.client_service_plans') is not null,
  'both care plan version tables exist'
);

select is(
  (
    select count(*)::integer
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname in ('authorized_care_plans', 'client_service_plans')
      and relation.relkind = 'r'
      and relation.relrowsecurity
      and relation.relforcerowsecurity
  ),
  2,
  'both care plan tables enable and force RLS'
);

select ok(
  has_table_privilege('authenticated', 'public.authorized_care_plans', 'select')
  and not has_table_privilege('authenticated', 'public.authorized_care_plans', 'insert')
  and not has_table_privilege('authenticated', 'public.authorized_care_plans', 'update')
  and not has_table_privilege('authenticated', 'public.authorized_care_plans', 'delete')
  and has_table_privilege('authenticated', 'public.client_service_plans', 'select')
  and not has_table_privilege('authenticated', 'public.client_service_plans', 'insert')
  and not has_table_privilege('authenticated', 'public.client_service_plans', 'update')
  and not has_table_privilege('authenticated', 'public.client_service_plans', 'delete')
  and not has_table_privilege('anon', 'public.authorized_care_plans', 'select')
  and not has_table_privilege('anon', 'public.client_service_plans', 'select'),
  'care-plan sources are readable but neither version table permits direct authenticated writes'
);

select ok(
  has_function_privilege('authenticated', 'public.daily_service_summary(uuid,date)', 'execute')
  and not has_function_privilege('anon', 'public.daily_service_summary(uuid,date)', 'execute')
  and not (
    select procedure.prosecdef
    from pg_proc procedure
    where procedure.oid = 'public.daily_service_summary(uuid,date)'::regprocedure
  ),
  'daily summary is authenticated-only and SECURITY INVOKER'
);

select is(
  pg_get_function_identity_arguments('public.daily_service_summary(uuid,date)'::regprocedure),
  'p_client_id uuid, p_service_date date',
  'daily summary accepts no client-supplied tenant identifier'
);

select ok(
  position(
    'client-service-plan:' in
    pg_get_functiondef('private.validate_client_service_plan_version()'::regprocedure)
  ) > 0
  and position(
    'authorized-care-plan:' in
    pg_get_functiondef('private.validate_client_service_plan_version()'::regprocedure)
  ) > position(
    'client-service-plan:' in
    pg_get_functiondef('private.validate_client_service_plan_version()'::regprocedure)
  ),
  'service plan insert locks service and authorized streams in the shared order'
);

select ok(
  exists (
    select 1
    from public.role_permissions role_permission
    join public.roles role on role.id = role_permission.role_id
    join public.permissions permission on permission.id = role_permission.permission_id
    where role.role_key = 'care_worker'
      and permission.permission_key = 'care_plans.read'
  )
  and not exists (
    select 1
    from public.role_permissions role_permission
    join public.roles role on role.id = role_permission.role_id
    join public.permissions permission on permission.id = role_permission.permission_id
    where role.role_key = 'care_worker'
      and permission.permission_key in ('care_plans.write', 'care_plans.approve', 'care_plans.sign')
  ),
  'care worker role is read-only for care plans'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '40000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'plan-manager-a@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '40000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'plan-worker-a@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '40000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'plan-manager-b@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '40000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'plan-unassigned-a@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '40000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'plan-case-manager-a@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());

insert into public.organizations (id, code, name) values
  ('41000000-0000-4000-8000-000000000001', 'care_plan_org_a', '照顧計畫測試機構 A'),
  ('41000000-0000-4000-8000-000000000002', 'care_plan_org_b', '照顧計畫測試機構 B');

insert into public.branches (id, organization_id, code, name) values
  ('42000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000001', 'main', '照顧計畫 A 分支'),
  ('42000000-0000-4000-8000-000000000002', '41000000-0000-4000-8000-000000000002', 'main', '照顧計畫 B 分支');

insert into public.profiles (id, display_name, kind) values
  ('40000000-0000-4000-8000-000000000001', 'A 機構管理員', 'staff'),
  ('40000000-0000-4000-8000-000000000002', 'A 指派照服員', 'staff'),
  ('40000000-0000-4000-8000-000000000003', 'B 機構管理員', 'staff'),
  ('40000000-0000-4000-8000-000000000004', 'A 未指派照服員', 'staff'),
  ('40000000-0000-4000-8000-000000000005', 'A 指派個管', 'staff');

insert into public.memberships (id, organization_id, branch_id, profile_id, status) values
  ('43000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000001', null, '40000000-0000-4000-8000-000000000001', 'active'),
  ('43000000-0000-4000-8000-000000000002', '41000000-0000-4000-8000-000000000001', '42000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000002', 'active'),
  ('43000000-0000-4000-8000-000000000003', '41000000-0000-4000-8000-000000000002', null, '40000000-0000-4000-8000-000000000003', 'active'),
  ('43000000-0000-4000-8000-000000000004', '41000000-0000-4000-8000-000000000001', '42000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000004', 'active'),
  ('43000000-0000-4000-8000-000000000005', '41000000-0000-4000-8000-000000000001', '42000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000005', 'active');

insert into public.membership_roles (membership_id, role_id) values
  ('43000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002'),
  ('43000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000006'),
  ('43000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002'),
  ('43000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000006'),
  ('43000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000004');

insert into public.clients (
  id, organization_id, branch_id, client_code, display_name, source_system
) values
  ('44000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000001', '42000000-0000-4000-8000-000000000001', 'PLAN-A-001', '計畫測試個案 A', 'test'),
  ('44000000-0000-4000-8000-000000000002', '41000000-0000-4000-8000-000000000002', '42000000-0000-4000-8000-000000000002', 'PLAN-B-001', '計畫測試個案 B', 'test');

insert into public.client_assignments (
  id, organization_id, branch_id, client_id, assignee_user_id, assignment_kind
) values
(
  '44100000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000001',
  '42000000-0000-4000-8000-000000000001', '44000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000002', 'daily_care'
),
(
  '44100000-0000-4000-8000-000000000005', '41000000-0000-4000-8000-000000000001',
  '42000000-0000-4000-8000-000000000001', '44000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000005', 'case_management'
);

insert into private.reauth_challenges (
  id, user_id, session_id, nonce_sha256, idempotency_key, issued_jwt_iat,
  issued_jwt_jti, created_at, expires_at, consumed_at, consumed_jwt_iat,
  consumed_jwt_jti, factor_method, factor_verified_at
) values
(
  '45000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001',
  '45100000-0000-4000-8000-000000000001', repeat('a', 64),
  '45200000-0000-4000-8000-000000000001', clock_timestamp() - interval '2 minutes',
  'plan-manager-before-stepup', clock_timestamp() - interval '1 minute',
  clock_timestamp() + interval '4 minutes', clock_timestamp() - interval '30 seconds',
  clock_timestamp() - interval '30 seconds', 'plan-manager-after-stepup', 'totp',
  clock_timestamp() - interval '30 seconds'
),
(
  '45000000-0000-4000-8000-000000000005', '40000000-0000-4000-8000-000000000005',
  '45100000-0000-4000-8000-000000000005', repeat('6', 64),
  '45200000-0000-4000-8000-000000000005', clock_timestamp() - interval '2 minutes',
  'plan-case-manager-before-stepup', clock_timestamp() - interval '1 minute',
  clock_timestamp() + interval '4 minutes', clock_timestamp() - interval '30 seconds',
  clock_timestamp() - interval '30 seconds', 'plan-case-manager-after-stepup', 'totp',
  clock_timestamp() - interval '30 seconds'
);

insert into private.reauth_events (
  user_id, session_id, challenge_id, aal, verification_method, verified_at
) values
(
  '40000000-0000-4000-8000-000000000001', '45100000-0000-4000-8000-000000000001',
  '45000000-0000-4000-8000-000000000001', 'aal2', 'totp',
  clock_timestamp() - interval '30 seconds'
),
(
  '40000000-0000-4000-8000-000000000005', '45100000-0000-4000-8000-000000000005',
  '45000000-0000-4000-8000-000000000005', 'aal2', 'totp',
  clock_timestamp() - interval '30 seconds'
);

-- A cross-tenant draft provides a real row for SELECT isolation tests.
insert into public.authorized_care_plans (
  id, organization_id, branch_id, client_id, plan_key, version, status,
  effective_from, effective_to, source_system, source_provenance,
  service_limits, plan_data, idempotency_key, created_by
) values (
  '46000000-0000-4000-8000-000000000099', '41000000-0000-4000-8000-000000000002',
  '42000000-0000-4000-8000-000000000002', '44000000-0000-4000-8000-000000000002',
  '46100000-0000-4000-8000-000000000099', 1, 'draft', '2026-09-01', '2026-09-30',
  'test', '{"source":"synthetic"}'::jsonb, '{}'::jsonb, '{}'::jsonb,
  '46200000-0000-4000-8000-000000000099', '40000000-0000-4000-8000-000000000003'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '40000000-0000-4000-8000-000000000001', 'role', 'authenticated',
    'aal', 'aal2', 'session_id', '45100000-0000-4000-8000-000000000001',
    'iat', extract(epoch from clock_timestamp())::bigint,
    'jti', 'plan-manager-after-stepup',
    'amr', jsonb_build_array(jsonb_build_object(
      'method', 'totp',
      'timestamp', extract(epoch from clock_timestamp() - interval '30 seconds')::bigint
    ))
  )::text,
  true
);

select throws_ok(
  $$insert into public.authorized_care_plans (
      id, organization_id, branch_id, client_id, plan_key, version, status,
      effective_from, effective_to, source_system, source_record_id,
      source_provenance, authorized_on, authorization_reference, service_limits,
      plan_data, idempotency_key, created_by, approved_by, approved_at,
      approval_evidence_hash, approval_reauth_challenge_id, signed_by, signed_at,
      signature_purpose, signature_reauth_challenge_id, content_hash
    ) values (
      '46000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000001',
      '42000000-0000-4000-8000-000000000001', '44000000-0000-4000-8000-000000000001',
      '46100000-0000-4000-8000-000000000001', 1, 'signed', '2026-09-01', '2026-09-30',
      'central_html', 'synthetic-authorized-plan-v1', '{"batch":"synthetic"}'::jsonb,
      '2026-08-28', 'SYNTHETIC-AUTH-001', '{"limits":[]}'::jsonb,
      '{"summary":"synthetic"}'::jsonb, '46200000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001',
      clock_timestamp(), repeat('b', 64), '45000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000001', clock_timestamp(), '核定計畫簽署測試',
      '45000000-0000-4000-8000-000000000001', repeat('c', 64)
    )$$,
  '42501',
  null,
  'even an AAL2 manager cannot directly fabricate a signed authorized source'
);

-- The central import/promotion writer is intentionally not configured yet.
-- Seed reviewed synthetic source versions as the test owner; the separate
-- write-boundary suite proves browser and service-role direct DML is denied.
reset role;
select set_config('request.jwt.claims', '{}'::text, true);
insert into public.authorized_care_plans (
  id, organization_id, branch_id, client_id, plan_key, version, status,
  effective_from, effective_to, source_system, source_record_id,
  source_provenance, authorized_on, authorization_reference, service_limits,
  plan_data, idempotency_key, created_by, approved_by, approved_at,
  approval_evidence_hash, approval_reauth_challenge_id, signed_by, signed_at,
  signature_purpose, signature_reauth_challenge_id, content_hash
) values (
  '46000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000001',
  '42000000-0000-4000-8000-000000000001', '44000000-0000-4000-8000-000000000001',
  '46100000-0000-4000-8000-000000000001', 1, 'signed', '2026-09-01', '2026-09-30',
  'central_html', 'synthetic-authorized-plan-v1', '{"batch":"synthetic"}'::jsonb,
  '2026-08-28', 'SYNTHETIC-AUTH-001', '{"limits":[]}'::jsonb,
  '{"summary":"synthetic"}'::jsonb, '46200000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001',
  clock_timestamp(), repeat('b', 64), '45000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001', clock_timestamp(), '核定計畫簽署測試',
  '45000000-0000-4000-8000-000000000001', repeat('c', 64)
);

select lives_ok(
  $$insert into public.authorized_care_plans (
      id, organization_id, branch_id, client_id, plan_key, version,
      previous_version_id, status, effective_from, effective_to, source_system,
      source_record_id, source_provenance, authorized_on, authorization_reference,
      service_limits, plan_data, correction_reason, idempotency_key, created_by,
      approved_by, approved_at, approval_evidence_hash, approval_reauth_challenge_id,
      signed_by, signed_at, signature_purpose, signature_reauth_challenge_id, content_hash
    ) values (
      '46000000-0000-4000-8000-000000000002', '41000000-0000-4000-8000-000000000001',
      '42000000-0000-4000-8000-000000000001', '44000000-0000-4000-8000-000000000001',
      '46100000-0000-4000-8000-000000000001', 2,
      '46000000-0000-4000-8000-000000000001', 'signed', '2026-09-01', '2026-09-30',
      'central_html', 'synthetic-authorized-plan-v2', '{"batch":"synthetic"}'::jsonb,
      '2026-08-28', 'SYNTHETIC-AUTH-001', '{"limits":[]}'::jsonb,
      '{"summary":"synthetic correction"}'::jsonb, '修正來源摘要',
      '46200000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000001', clock_timestamp(), repeat('d', 64),
      '45000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001',
      clock_timestamp(), '核定計畫更正簽署測試', '45000000-0000-4000-8000-000000000001',
      repeat('e', 64)
    )$$,
  'a linked correction creates the next immutable authorized version'
);

select throws_ok(
  $$insert into public.authorized_care_plans (
      id, organization_id, branch_id, client_id, plan_key, version, status,
      effective_from, effective_to, source_system, source_provenance,
      service_limits, plan_data, idempotency_key, created_by, approved_by,
      approved_at, approval_evidence_hash, approval_reauth_challenge_id,
      signed_by, signed_at, signature_purpose, signature_reauth_challenge_id,
      content_hash
    ) values (
      '46000000-0000-4000-8000-000000000003', '41000000-0000-4000-8000-000000000001',
      '42000000-0000-4000-8000-000000000001', '44000000-0000-4000-8000-000000000001',
      '46100000-0000-4000-8000-000000000003', 1, 'signed', '2026-09-15', '2026-10-15',
      'local', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb,
      '46200000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000001', clock_timestamp(), repeat('f', 64),
      '45000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001',
      clock_timestamp(), '重疊計畫測試', '45000000-0000-4000-8000-000000000001',
      repeat('1', 64)
    )$$,
  '23P01',
  null,
  'an unlinked signed plan stream cannot overlap the effective period'
);

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '40000000-0000-4000-8000-000000000001', 'role', 'authenticated',
    'aal', 'aal2', 'session_id', '45100000-0000-4000-8000-000000000009',
    'iat', extract(epoch from clock_timestamp())::bigint,
    'jti', 'aal2-without-current-session-reauth',
    'amr', jsonb_build_array(jsonb_build_object(
      'method', 'totp',
      'timestamp', extract(epoch from clock_timestamp())::bigint
    ))
  )::text,
  true
);

set local role authenticated;
select throws_ok(
  $$insert into public.authorized_care_plans (
      organization_id, branch_id, client_id, plan_key, status,
      effective_from, effective_to, source_system, authorized_on,
      authorization_reference, idempotency_key, created_by, approved_by,
      approved_at, approval_evidence_hash, approval_reauth_challenge_id,
      signed_by, signed_at, signature_purpose, signature_reauth_challenge_id,
      content_hash
    ) values (
      '41000000-0000-4000-8000-000000000001', '42000000-0000-4000-8000-000000000001',
      '44000000-0000-4000-8000-000000000001', '46100000-0000-4000-8000-000000000004',
      'signed', '2026-10-01', '2026-10-31', 'local', '2026-09-28',
      'SYNTHETIC-AUTH-NO-REAUTH', '46200000-0000-4000-8000-000000000008',
      '40000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001',
      clock_timestamp(), repeat('4', 64), '45000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000001', clock_timestamp(),
      '缺少本工作階段重新驗證', '45000000-0000-4000-8000-000000000001', repeat('5', 64)
    )$$,
  '42501',
  null,
  'authenticated users cannot bypass the disabled authorized-plan write boundary'
);

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '40000000-0000-4000-8000-000000000001', 'role', 'authenticated',
    'aal', 'aal2', 'session_id', '45100000-0000-4000-8000-000000000001',
    'iat', extract(epoch from clock_timestamp())::bigint,
    'jti', 'plan-manager-after-stepup',
    'amr', jsonb_build_array(jsonb_build_object(
      'method', 'totp',
      'timestamp', extract(epoch from clock_timestamp() - interval '30 seconds')::bigint
    ))
  )::text,
  true
);

reset role;
select throws_ok(
  $$insert into public.authorized_care_plans (
      organization_id, branch_id, client_id, effective_from, effective_to,
      source_system, idempotency_key, created_by
    ) values (
      '41000000-0000-4000-8000-000000000001', '42000000-0000-4000-8000-000000000001',
      '44000000-0000-4000-8000-000000000001', '2026-10-02', '2026-10-01',
      'local', '46200000-0000-4000-8000-000000000004',
      '40000000-0000-4000-8000-000000000001'
    )$$,
  '23514',
  null,
  'database rejects an invalid effective period'
);

-- Page 52 withdraws direct authenticated INSERT. Exercise the inherited core
-- trigger invariants as the test owner; authenticated workflow behavior and
-- direct-DML denial are covered by its dedicated pgTAP file.
reset role;
select set_config('request.jwt.claims', '{}'::text, true);
select lives_ok(
  $$insert into public.client_service_plans (
      id, organization_id, branch_id, client_id, authorized_care_plan_id,
      plan_key, version, status, effective_from, effective_to, source_system,
      source_provenance, authorized_limits_snapshot, goals, planned_services,
      responsible_user_id, review_due_on, idempotency_key, created_by,
      approved_by, approved_at, approval_evidence_hash,
      approval_reauth_challenge_id, signed_by, signed_at, signature_purpose,
      signature_reauth_challenge_id, content_hash
    ) values (
      '47000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000001',
      '42000000-0000-4000-8000-000000000001', '44000000-0000-4000-8000-000000000001',
      '46000000-0000-4000-8000-000000000002', '47100000-0000-4000-8000-000000000001',
      1, 'signed', '2026-09-01', '2026-09-30', 'local', '{"source":"synthetic"}'::jsonb,
      '{"limits":[]}'::jsonb, '[{"goal":"synthetic"}]'::jsonb,
      '[{"service":"synthetic"}]'::jsonb, '40000000-0000-4000-8000-000000000001',
      '2026-09-30', '47200000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000001', clock_timestamp(), repeat('2', 64),
      '45000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001',
      clock_timestamp(), '個案服務計畫簽署測試', '45000000-0000-4000-8000-000000000001',
      repeat('3', 64)
    )$$,
  'owner fixture creates a signed client service plan within authorized limits'
);

select throws_ok(
  $$insert into public.client_service_plans (
      organization_id, branch_id, client_id, authorized_care_plan_id,
      effective_from, effective_to, source_system, idempotency_key, created_by
    ) values (
      '41000000-0000-4000-8000-000000000001', '42000000-0000-4000-8000-000000000001',
      '44000000-0000-4000-8000-000000000001', '46000000-0000-4000-8000-000000000002',
      '2026-08-01', '2026-09-30', 'local', '47200000-0000-4000-8000-000000000002',
      '40000000-0000-4000-8000-000000000001'
    )$$,
  '23503',
  null,
  'service plan cannot exceed the signed authorized plan period'
);

select throws_ok(
  $$insert into public.client_service_plans (
      organization_id, branch_id, client_id, authorized_care_plan_id,
      effective_from, effective_to, source_system, authorized_limits_snapshot,
      idempotency_key, created_by
    ) values (
      '41000000-0000-4000-8000-000000000001', '42000000-0000-4000-8000-000000000001',
      '44000000-0000-4000-8000-000000000001', '46000000-0000-4000-8000-000000000002',
      '2026-09-01', '2026-09-30', 'local', '{"mismatch":true}'::jsonb,
      '47200000-0000-4000-8000-000000000003',
      '40000000-0000-4000-8000-000000000001'
    )$$,
  '23514',
  null,
  'service plan cannot alter the signed authorization-limit snapshot'
);

-- The attendance workflow migration withdraws direct INSERT from
-- authenticated users. Seed this historical summary source as the test owner;
-- attendance mutation behavior is covered by its dedicated pgTAP file.
reset role;
insert into public.attendance_records (
  id, organization_id, branch_id, client_id, service_date, status,
  checked_in_at, checked_out_at, idempotency_key, recorded_by
) values (
  '48000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000001',
  '42000000-0000-4000-8000-000000000001', '44000000-0000-4000-8000-000000000001',
  '2026-09-01', 'present', '2026-09-01 08:00:00+08', '2026-09-01 16:00:00+08',
  '48100000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001'
);

-- The later vital-set migration intentionally withdraws direct measurement
-- INSERT from authenticated users. Seed this historical summary source as the
-- test owner; vital RPC behavior is covered in its dedicated pgTAP file.
insert into public.measurements (
  id, organization_id, branch_id, client_id, measurement_kind, measured_at,
  numeric_value, unit, context, source, recorded_by, idempotency_key
) values (
  '48200000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000001',
  '42000000-0000-4000-8000-000000000001', '44000000-0000-4000-8000-000000000001',
  'body_temperature', '2026-09-01 09:00:00+08', 36.5, 'Cel', '{"synthetic":true}'::jsonb,
  'test', '40000000-0000-4000-8000-000000000001',
  '48300000-0000-4000-8000-000000000001'
);

-- The care-diary boundary likewise withdraws direct care-record mutations.
-- Seed this historical daily-summary source as the test owner; its dedicated
-- RPC and direct-DML denial are covered by care_diary_draft_boundary.test.sql.
insert into public.care_records (
  id, organization_id, branch_id, client_id, record_key, version, category,
  status, occurred_at, data, created_by
) values (
  '48400000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000001',
  '42000000-0000-4000-8000-000000000001', '44000000-0000-4000-8000-000000000001',
  '48500000-0000-4000-8000-000000000001', 1, 'daily_care', 'draft',
  '2026-09-01 10:00:00+08', '{"synthetic":true}'::jsonb,
  '40000000-0000-4000-8000-000000000001'
);

-- The completed-service workflow also withdraws direct service-event writes.
-- Seed and exercise the lower-level plan guard as the test owner; the
-- authenticated RPC boundary is covered in complete_service_event.test.sql.
reset role;
insert into public.service_events (
  id, organization_id, branch_id, client_id, client_service_plan_id,
  service_code, status, started_at, ended_at, staff_user_id, evidence,
  idempotency_key
) values (
  '48600000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000001',
  '42000000-0000-4000-8000-000000000001', '44000000-0000-4000-8000-000000000001',
  '47000000-0000-4000-8000-000000000001', 'SYNTHETIC-SERVICE', 'completed',
  '2026-09-01 11:00:00+08', '2026-09-01 11:30:00+08',
  '40000000-0000-4000-8000-000000000001', '{"synthetic":true}'::jsonb,
  '48700000-0000-4000-8000-000000000001'
);
reset role;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '40000000-0000-4000-8000-000000000001', 'role', 'authenticated',
    'aal', 'aal2', 'session_id', '45100000-0000-4000-8000-000000000001'
  )::text,
  true
);

select results_eq(
  $$select attendance_count, measurement_count, care_record_count, service_event_count
    from public.daily_service_summary('44000000-0000-4000-8000-000000000001', '2026-09-01')$$,
  $$values (1::bigint, 1::bigint, 1::bigint, 1::bigint)$$,
  'daily summary returns source counts from one statement snapshot'
);

select results_eq(
  $$select authorized_care_plan_id, client_service_plan_id
    from public.daily_service_summary('44000000-0000-4000-8000-000000000001', '2026-09-01')$$,
  $$values (
      '46000000-0000-4000-8000-000000000002'::uuid,
      '47000000-0000-4000-8000-000000000001'::uuid
    )$$,
  'daily summary selects the unique latest effective plan versions'
);

select results_eq(
  $$select attendance_source_ids, measurement_source_ids,
           care_record_source_ids, service_event_source_ids
    from public.daily_service_summary('44000000-0000-4000-8000-000000000001', '2026-09-01')$$,
  $$values (
      array['48000000-0000-4000-8000-000000000001'::uuid],
      array['48200000-0000-4000-8000-000000000001'::uuid],
      array['48400000-0000-4000-8000-000000000001'::uuid],
      array['48600000-0000-4000-8000-000000000001'::uuid]
    )$$,
  'daily summary returns exact source IDs for drill-down'
);

select ok(
  exists (
    select 1
    from public.service_events event
    where event.id = '48600000-0000-4000-8000-000000000001'
      and event.client_service_plan_id = '47000000-0000-4000-8000-000000000001'
  ),
  'completed service event remains traceable to the signed client service plan'
);

reset role;
select throws_ok(
  $$insert into public.service_events (
      organization_id, branch_id, client_id, service_code, status, started_at,
      ended_at, staff_user_id, evidence, idempotency_key
    ) values (
      '41000000-0000-4000-8000-000000000001', '42000000-0000-4000-8000-000000000001',
      '44000000-0000-4000-8000-000000000001', 'SYNTHETIC-NO-PLAN', 'completed',
      '2026-09-01 12:00:00+08', '2026-09-01 12:30:00+08',
      '40000000-0000-4000-8000-000000000001', '{}'::jsonb,
      '48700000-0000-4000-8000-000000000002'
    )$$,
  '23514',
  null,
  'completed service event without a current signed plan is rejected'
);

insert into public.service_events (
  id, organization_id, branch_id, client_id, service_code, status, started_at,
  staff_user_id, evidence, idempotency_key
) values (
  '48600000-0000-4000-8000-000000000002', '41000000-0000-4000-8000-000000000001',
  '42000000-0000-4000-8000-000000000001', '44000000-0000-4000-8000-000000000001',
  'SYNTHETIC-PLANNED', 'planned', '2026-09-02 11:00:00+08',
  '40000000-0000-4000-8000-000000000001', '{}'::jsonb,
  '48700000-0000-4000-8000-000000000003'
);

select lives_ok(
  $$update public.service_events
    set client_service_plan_id = '47000000-0000-4000-8000-000000000001',
        status = 'in_progress'
    where id = '48600000-0000-4000-8000-000000000002'$$,
  'a planned event may attach its signed service plan exactly once when execution starts'
);

select throws_ok(
  $$update public.service_events
    set client_service_plan_id = null
    where id = '48600000-0000-4000-8000-000000000002'$$,
  '23514',
  null,
  'an attached service-plan source key cannot be removed or replaced'
);
reset role;

select lives_ok(
  $$insert into public.client_service_plans (
      id, organization_id, branch_id, client_id, authorized_care_plan_id,
      plan_key, version, previous_version_id, status, effective_from,
      effective_to, source_system, source_provenance,
      authorized_limits_snapshot, goals, planned_services,
      responsible_user_id, review_due_on, correction_reason, idempotency_key,
      created_by, approved_by, approved_at, approval_evidence_hash,
      approval_reauth_challenge_id
    ) values (
      '47000000-0000-4000-8000-000000000002', '41000000-0000-4000-8000-000000000001',
      '42000000-0000-4000-8000-000000000001', '44000000-0000-4000-8000-000000000001',
      '46000000-0000-4000-8000-000000000002', '47100000-0000-4000-8000-000000000001',
      2, '47000000-0000-4000-8000-000000000001', 'approved', '2026-09-01',
      '2026-09-30', 'local', '{"source":"synthetic"}'::jsonb,
      '{"limits":[]}'::jsonb, '[{"goal":"synthetic"}]'::jsonb,
      '[{"service":"synthetic"}]'::jsonb, '40000000-0000-4000-8000-000000000001',
      '2026-09-30', '送交核准', '47200000-0000-4000-8000-000000000004',
      '40000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001',
      clock_timestamp(), repeat('7', 64), '45000000-0000-4000-8000-000000000001'
    )$$,
  'owner fixture may create an approved immutable service-plan version'
);

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '40000000-0000-4000-8000-000000000005', 'role', 'authenticated',
    'aal', 'aal2', 'session_id', '45100000-0000-4000-8000-000000000005',
    'iat', extract(epoch from clock_timestamp())::bigint,
    'jti', 'plan-case-manager-after-stepup',
    'amr', jsonb_build_array(jsonb_build_object(
      'method', 'totp',
      'timestamp', extract(epoch from clock_timestamp() - interval '30 seconds')::bigint
    ))
  )::text,
  true
);

select lives_ok(
  $$insert into public.client_service_plans (
      id, organization_id, branch_id, client_id, authorized_care_plan_id,
      plan_key, version, previous_version_id, status, effective_from,
      effective_to, source_system, source_record_id, source_provenance,
      authorized_limits_snapshot, goals, planned_services,
      responsible_user_id, review_due_on, correction_reason, idempotency_key,
      created_by, approved_by, approved_at, approval_evidence_hash,
      approval_reauth_challenge_id, signed_by, signed_at, signature_purpose,
      signature_reauth_challenge_id, content_hash
    )
    select
      '47000000-0000-4000-8000-000000000003', organization_id, branch_id,
      client_id, authorized_care_plan_id, plan_key, 3,
      '47000000-0000-4000-8000-000000000002', 'signed', effective_from,
      effective_to, source_system, source_record_id, source_provenance,
      authorized_limits_snapshot, goals, planned_services,
      responsible_user_id, review_due_on, '簽署已核准版本',
      '47200000-0000-4000-8000-000000000005',
      '40000000-0000-4000-8000-000000000005', approved_by, approved_at,
      approval_evidence_hash, approval_reauth_challenge_id,
      '40000000-0000-4000-8000-000000000005', clock_timestamp(),
      '個管簽署已核准服務計畫', '45000000-0000-4000-8000-000000000005',
      repeat('8', 64)
    from public.client_service_plans
    where id = '47000000-0000-4000-8000-000000000002'$$,
  'owner fixture may sign unchanged content carrying manager approval evidence'
);

reset role;
select throws_ok(
  $$insert into public.client_service_plans (
      id, organization_id, branch_id, client_id, authorized_care_plan_id,
      plan_key, version, previous_version_id, status, effective_from,
      effective_to, source_system, source_record_id, source_provenance,
      authorized_limits_snapshot, goals, planned_services,
      responsible_user_id, review_due_on, correction_reason, idempotency_key,
      created_by, approved_by, approved_at, approval_evidence_hash,
      approval_reauth_challenge_id, signed_by, signed_at, signature_purpose,
      signature_reauth_challenge_id, content_hash
    )
    select
      '47000000-0000-4000-8000-000000000004', organization_id, branch_id,
      client_id, authorized_care_plan_id, plan_key, 4,
      '47000000-0000-4000-8000-000000000003', 'signed', effective_from,
      effective_to, source_system, source_record_id, source_provenance,
      authorized_limits_snapshot, '[{"goal":"unauthorized change"}]'::jsonb,
      planned_services, responsible_user_id, review_due_on,
      '未重新核准的內容異動', '47200000-0000-4000-8000-000000000006',
      '40000000-0000-4000-8000-000000000005', approved_by, approved_at,
      approval_evidence_hash, approval_reauth_challenge_id,
      '40000000-0000-4000-8000-000000000005', clock_timestamp(),
      '不可簽署未核准異動', '45000000-0000-4000-8000-000000000005',
      repeat('9', 64)
    from public.client_service_plans
    where id = '47000000-0000-4000-8000-000000000003'$$,
  '42501',
  null,
  'a signer cannot change content while carrying another user approval'
);

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '40000000-0000-4000-8000-000000000001', 'role', 'authenticated',
    'aal', 'aal2', 'session_id', '45100000-0000-4000-8000-000000000001',
    'iat', extract(epoch from clock_timestamp())::bigint,
    'jti', 'plan-manager-after-stepup',
    'amr', jsonb_build_array(jsonb_build_object(
      'method', 'totp',
      'timestamp', extract(epoch from clock_timestamp() - interval '30 seconds')::bigint
    ))
  )::text,
  true
);

-- Regression: terminal selection is per stable stream before comparing active
-- streams. A higher version number in a voided old stream must not hide the
-- valid version-one replacement stream.
select set_config('request.jwt.claims', '{}'::text, true);
insert into public.authorized_care_plans (
  id, organization_id, branch_id, client_id, plan_key, version, status,
  effective_from, effective_to, source_system, source_record_id,
  source_provenance, authorized_on, authorization_reference, service_limits,
  plan_data, idempotency_key, created_by, approved_by, approved_at,
  approval_evidence_hash, approval_reauth_challenge_id, signed_by, signed_at,
  signature_purpose, signature_reauth_challenge_id, content_hash
) values (
  '49000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000001',
  '42000000-0000-4000-8000-000000000001', '44000000-0000-4000-8000-000000000001',
  '49100000-0000-4000-8000-000000000001', 1, 'signed', '2026-12-01', '2026-12-31',
  'local', 'synthetic-december-old-v1', '{"source":"synthetic"}'::jsonb,
  '2026-11-28', 'SYNTHETIC-DECEMBER-OLD', '{"limits":[]}'::jsonb,
  '{"summary":"old December stream"}'::jsonb,
  '49200000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001', clock_timestamp(), repeat('a', 64),
  '45000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001',
  clock_timestamp(), '舊核定計畫簽署', '45000000-0000-4000-8000-000000000001',
  repeat('b', 64)
);

insert into public.client_service_plans (
  id, organization_id, branch_id, client_id, authorized_care_plan_id,
  plan_key, version, status, effective_from, effective_to, source_system,
  source_provenance, authorized_limits_snapshot, goals, planned_services,
  responsible_user_id, review_due_on, idempotency_key, created_by,
  approved_by, approved_at, approval_evidence_hash,
  approval_reauth_challenge_id, signed_by, signed_at, signature_purpose,
  signature_reauth_challenge_id, content_hash
) values (
  '49300000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000001',
  '42000000-0000-4000-8000-000000000001', '44000000-0000-4000-8000-000000000001',
  '49000000-0000-4000-8000-000000000001', '49400000-0000-4000-8000-000000000001',
  1, 'signed', '2026-12-01', '2026-12-31', 'local',
  '{"source":"synthetic"}'::jsonb, '{"limits":[]}'::jsonb,
  '[{"goal":"old December goal"}]'::jsonb,
  '[{"service":"old December service"}]'::jsonb,
  '40000000-0000-4000-8000-000000000001', '2026-12-31',
  '49500000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001', clock_timestamp(), repeat('c', 64),
  '45000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001',
  clock_timestamp(), '舊個案服務計畫簽署', '45000000-0000-4000-8000-000000000001',
  repeat('d', 64)
);

insert into public.client_service_plans (
  id, organization_id, branch_id, client_id, authorized_care_plan_id,
  plan_key, version, previous_version_id, status, effective_from,
  effective_to, source_system, source_record_id, source_provenance,
  authorized_limits_snapshot, goals, planned_services,
  responsible_user_id, review_due_on, correction_reason, idempotency_key,
  created_by, approved_by, approved_at, approval_evidence_hash,
  approval_reauth_challenge_id, signed_by, signed_at, signature_purpose,
  signature_reauth_challenge_id, content_hash
)
select
  '49300000-0000-4000-8000-000000000002', organization_id, branch_id,
  client_id, authorized_care_plan_id, plan_key, 2,
  '49300000-0000-4000-8000-000000000001', 'voided', effective_from,
  effective_to, source_system, source_record_id, source_provenance,
  authorized_limits_snapshot, goals, planned_services, responsible_user_id,
  review_due_on, '舊服務計畫流已作廢',
  '49500000-0000-4000-8000-000000000002',
  '40000000-0000-4000-8000-000000000001', approved_by, approved_at,
  approval_evidence_hash, approval_reauth_challenge_id,
  '40000000-0000-4000-8000-000000000001', clock_timestamp(),
  '作廢舊服務計畫流', '45000000-0000-4000-8000-000000000001',
  repeat('f', 64)
from public.client_service_plans
where id = '49300000-0000-4000-8000-000000000001';

insert into public.authorized_care_plans (
  id, organization_id, branch_id, client_id, plan_key, version,
  previous_version_id, status, effective_from, effective_to, source_system,
  source_record_id, source_provenance, authorized_on,
  authorization_reference, service_limits, plan_data, correction_reason,
  idempotency_key, created_by, approved_by, approved_at,
  approval_evidence_hash, approval_reauth_challenge_id, signed_by, signed_at,
  signature_purpose, signature_reauth_challenge_id, content_hash
)
select
  '49000000-0000-4000-8000-000000000002', organization_id, branch_id,
  client_id, plan_key, 2, '49000000-0000-4000-8000-000000000001',
  'voided', effective_from, effective_to, source_system,
  'synthetic-december-old-v2-void', source_provenance, authorized_on,
  authorization_reference, service_limits, plan_data,
  '舊核定計畫流已作廢', '49200000-0000-4000-8000-000000000002',
  '40000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001', clock_timestamp(), repeat('1', 64),
  '45000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001', clock_timestamp(),
  '作廢舊核定計畫流', '45000000-0000-4000-8000-000000000001',
  repeat('2', 64)
from public.authorized_care_plans
where id = '49000000-0000-4000-8000-000000000001';

insert into public.authorized_care_plans (
  id, organization_id, branch_id, client_id, plan_key, version, status,
  effective_from, effective_to, source_system, source_record_id,
  source_provenance, authorized_on, authorization_reference, service_limits,
  plan_data, idempotency_key, created_by, approved_by, approved_at,
  approval_evidence_hash, approval_reauth_challenge_id, signed_by, signed_at,
  signature_purpose, signature_reauth_challenge_id, content_hash
) values (
  '49000000-0000-4000-8000-000000000003', '41000000-0000-4000-8000-000000000001',
  '42000000-0000-4000-8000-000000000001', '44000000-0000-4000-8000-000000000001',
  '49100000-0000-4000-8000-000000000003', 1, 'signed', '2026-12-01', '2026-12-31',
  'local', 'synthetic-december-new-v1', '{"source":"synthetic"}'::jsonb,
  '2026-11-30', 'SYNTHETIC-DECEMBER-NEW', '{"limits":[]}'::jsonb,
  '{"summary":"new December stream"}'::jsonb,
  '49200000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001', clock_timestamp(), repeat('3', 64),
  '45000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001',
  clock_timestamp(), '新核定計畫簽署', '45000000-0000-4000-8000-000000000001',
  repeat('4', 64)
);

insert into public.client_service_plans (
  id, organization_id, branch_id, client_id, authorized_care_plan_id,
  plan_key, version, status, effective_from, effective_to, source_system,
  source_provenance, authorized_limits_snapshot, goals, planned_services,
  responsible_user_id, review_due_on, idempotency_key, created_by,
  approved_by, approved_at, approval_evidence_hash,
  approval_reauth_challenge_id, signed_by, signed_at, signature_purpose,
  signature_reauth_challenge_id, content_hash
) values (
  '49300000-0000-4000-8000-000000000003', '41000000-0000-4000-8000-000000000001',
  '42000000-0000-4000-8000-000000000001', '44000000-0000-4000-8000-000000000001',
  '49000000-0000-4000-8000-000000000003', '49400000-0000-4000-8000-000000000003',
  1, 'signed', '2026-12-01', '2026-12-31', 'local',
  '{"source":"synthetic"}'::jsonb, '{"limits":[]}'::jsonb,
  '[{"goal":"new December goal"}]'::jsonb,
  '[{"service":"new December service"}]'::jsonb,
  '40000000-0000-4000-8000-000000000001', '2026-12-31',
  '49500000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001', clock_timestamp(), repeat('5', 64),
  '45000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001',
  clock_timestamp(), '新個案服務計畫簽署', '45000000-0000-4000-8000-000000000001',
  repeat('6', 64)
);

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '40000000-0000-4000-8000-000000000001', 'role', 'authenticated',
    'aal', 'aal2', 'session_id', '45100000-0000-4000-8000-000000000001'
  )::text,
  true
);

select results_eq(
  $$select authorized_care_plan_id, client_service_plan_id
    from public.daily_service_summary('44000000-0000-4000-8000-000000000001', '2026-12-15')$$,
  $$values (
      '49000000-0000-4000-8000-000000000003'::uuid,
      '49300000-0000-4000-8000-000000000003'::uuid
    )$$,
  'daily summary ignores higher-version voided streams and selects the signed replacement streams'
);

-- Subsequent rows are owner-only reviewed fixtures for future-period terminal
-- semantics, not authenticated plan issuance.
select set_config('request.jwt.claims', '{}'::text, true);

-- Regression: a service plan remains immutable but is no longer executable as
-- soon as its authorization is replaced by a newer terminal version.
insert into public.authorized_care_plans (
  id, organization_id, branch_id, client_id, plan_key, version, status,
  effective_from, effective_to, source_system, source_record_id,
  source_provenance, authorized_on, authorization_reference, service_limits,
  plan_data, idempotency_key, created_by, approved_by, approved_at,
  approval_evidence_hash, approval_reauth_challenge_id, signed_by, signed_at,
  signature_purpose, signature_reauth_challenge_id, content_hash
) values (
  '49600000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000001',
  '42000000-0000-4000-8000-000000000001', '44000000-0000-4000-8000-000000000001',
  '49700000-0000-4000-8000-000000000001', 1, 'signed', '2027-01-01', '2027-01-31',
  'local', 'synthetic-january-v1', '{"source":"synthetic"}'::jsonb,
  '2026-12-28', 'SYNTHETIC-JANUARY', '{"limits":[]}'::jsonb,
  '{"summary":"January v1"}'::jsonb,
  '49800000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001', clock_timestamp(), repeat('7', 64),
  '45000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001',
  clock_timestamp(), '一月核定計畫簽署', '45000000-0000-4000-8000-000000000001',
  repeat('8', 64)
);

insert into public.client_service_plans (
  id, organization_id, branch_id, client_id, authorized_care_plan_id,
  plan_key, version, status, effective_from, effective_to, source_system,
  source_provenance, authorized_limits_snapshot, goals, planned_services,
  responsible_user_id, review_due_on, idempotency_key, created_by,
  approved_by, approved_at, approval_evidence_hash,
  approval_reauth_challenge_id, signed_by, signed_at, signature_purpose,
  signature_reauth_challenge_id, content_hash
) values (
  '49900000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000001',
  '42000000-0000-4000-8000-000000000001', '44000000-0000-4000-8000-000000000001',
  '49600000-0000-4000-8000-000000000001', '49910000-0000-4000-8000-000000000001',
  1, 'signed', '2027-01-01', '2027-01-31', 'local',
  '{"source":"synthetic"}'::jsonb, '{"limits":[]}'::jsonb,
  '[{"goal":"January goal"}]'::jsonb,
  '[{"service":"January service"}]'::jsonb,
  '40000000-0000-4000-8000-000000000001', '2027-01-31',
  '49920000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001', clock_timestamp(), repeat('9', 64),
  '45000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001',
  clock_timestamp(), '一月個案服務計畫簽署', '45000000-0000-4000-8000-000000000001',
  repeat('a', 64)
);

insert into public.authorized_care_plans (
  id, organization_id, branch_id, client_id, plan_key, version,
  previous_version_id, status, effective_from, effective_to, source_system,
  source_record_id, source_provenance, authorized_on,
  authorization_reference, service_limits, plan_data, correction_reason,
  idempotency_key, created_by, approved_by, approved_at,
  approval_evidence_hash, approval_reauth_challenge_id, signed_by, signed_at,
  signature_purpose, signature_reauth_challenge_id, content_hash
)
select
  '49600000-0000-4000-8000-000000000002', organization_id, branch_id,
  client_id, plan_key, 2, '49600000-0000-4000-8000-000000000001',
  'signed', effective_from, effective_to, source_system,
  'synthetic-january-v2', source_provenance, authorized_on,
  authorization_reference, service_limits,
  '{"summary":"January v2 replacement"}'::jsonb,
  '核定計畫已更新', '49800000-0000-4000-8000-000000000002',
  '40000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001', clock_timestamp(), repeat('b', 64),
  '45000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001', clock_timestamp(),
  '更新核定計畫簽署', '45000000-0000-4000-8000-000000000001',
  repeat('c', 64)
from public.authorized_care_plans
where id = '49600000-0000-4000-8000-000000000001';

reset role;
select throws_ok(
  $$insert into public.service_events (
      id, organization_id, branch_id, client_id, client_service_plan_id,
      service_code, status, started_at, ended_at, staff_user_id, evidence,
      idempotency_key
    ) values (
      '49930000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000001',
      '42000000-0000-4000-8000-000000000001', '44000000-0000-4000-8000-000000000001',
      '49900000-0000-4000-8000-000000000001', 'SYNTHETIC-STALE-AUTH', 'completed',
      '2027-01-15 10:00:00+08', '2027-01-15 10:30:00+08',
      '40000000-0000-4000-8000-000000000001', '{}'::jsonb,
      '49940000-0000-4000-8000-000000000001'
    )$$,
  '23514',
  null,
  'an executed event cannot use a service plan after its authorization is replaced'
);
set local role authenticated;

select is(
  (select count(*)::integer from public.authorized_care_plans where client_id = '44000000-0000-4000-8000-000000000002'),
  0,
  'organization A cannot read organization B care plans'
);

select throws_ok(
  $$insert into public.authorized_care_plans (
      organization_id, branch_id, client_id, effective_from, effective_to,
      source_system, idempotency_key, created_by
    ) values (
      '41000000-0000-4000-8000-000000000002', '42000000-0000-4000-8000-000000000002',
      '44000000-0000-4000-8000-000000000002', '2026-10-01', '2026-10-31',
      'local', '46200000-0000-4000-8000-000000000005',
      '40000000-0000-4000-8000-000000000001'
    )$$,
  '42501',
  null,
  'cross-tenant care plan insert is rejected by RLS'
);

select throws_ok(
  $$update public.authorized_care_plans
    set plan_data = '{"overwritten":true}'::jsonb
    where id = '46000000-0000-4000-8000-000000000002'$$,
  '42501',
  null,
  'authenticated role has no version overwrite privilege'
);

reset role;
select throws_ok(
  $$update public.authorized_care_plans
    set plan_data = '{"overwritten":true}'::jsonb
    where id = '46000000-0000-4000-8000-000000000002'$$,
  '55000',
  null,
  'append-only trigger also blocks privileged version overwrite'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"40000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1","session_id":"45100000-0000-4000-8000-000000000001","amr":[{"method":"password"}]}'::text,
  true
);

select is((select count(*)::integer from public.authorized_care_plans), 0, 'AAL1 employee cannot read care plan versions');
select is(
  (select count(*)::integer from public.daily_service_summary('44000000-0000-4000-8000-000000000001', '2026-09-01')),
  0,
  'AAL1 employee cannot obtain a daily service summary'
);
select throws_ok(
  $$insert into public.authorized_care_plans (
      organization_id, branch_id, client_id, effective_from, effective_to,
      source_system, idempotency_key, created_by
    ) values (
      '41000000-0000-4000-8000-000000000001', '42000000-0000-4000-8000-000000000001',
      '44000000-0000-4000-8000-000000000001', '2026-11-01', '2026-11-30',
      'local', '46200000-0000-4000-8000-000000000006',
      '40000000-0000-4000-8000-000000000001'
    )$$,
  '42501',
  null,
  'AAL1 employee cannot insert a care plan draft'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"40000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"45100000-0000-4000-8000-000000000002","amr":[{"method":"totp"}]}'::text,
  true
);

select is((select count(*)::integer from public.authorized_care_plans), 7, 'assigned care worker can read their client plan history');
select is(
  (select count(*)::integer from public.daily_service_summary('44000000-0000-4000-8000-000000000001', '2026-09-01')),
  1,
  'assigned care worker can read the complete daily summary'
);
select throws_ok(
  $$insert into public.authorized_care_plans (
      organization_id, branch_id, client_id, effective_from, effective_to,
      source_system, idempotency_key, created_by
    ) values (
      '41000000-0000-4000-8000-000000000001', '42000000-0000-4000-8000-000000000001',
      '44000000-0000-4000-8000-000000000001', '2026-11-01', '2026-11-30',
      'local', '46200000-0000-4000-8000-000000000007',
      '40000000-0000-4000-8000-000000000002'
    )$$,
  '42501',
  null,
  'read-only care worker role cannot create a plan version'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"40000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2","session_id":"45100000-0000-4000-8000-000000000004","amr":[{"method":"totp"}]}'::text,
  true
);
select is((select count(*)::integer from public.authorized_care_plans), 0, 'unassigned worker cannot read another client plan');
select is(
  (select count(*)::integer from public.daily_service_summary('44000000-0000-4000-8000-000000000001', '2026-09-01')),
  0,
  'unassigned worker cannot read another client daily summary'
);

reset role;
set local role anon;
select throws_ok(
  $$select count(*) from public.daily_service_summary('44000000-0000-4000-8000-000000000001', '2026-09-01')$$,
  '42501',
  null,
  'anonymous role cannot invoke the daily summary'
);

reset role;
select is(
  (
    select count(*)::integer
    from public.audit_events event
    where event.table_name in (
      'public.authorized_care_plans',
      'public.client_service_plans'
    )
      and event.action = 'insert'
  ),
  15,
  'care plan version creation is recorded in the audit ledger'
);

select * from finish();
rollback;
