begin;

select plan(44);

select ok(
  to_regclass('private.claim_service_allocations') is not null,
  'claim service allocation ledger exists'
);

select ok(
  not (select p.prosecdef from pg_proc p where p.oid = 'public.validate_claim_batch(uuid,uuid,uuid,numeric,uuid)'::regprocedure)
  and not (select p.prosecdef from pg_proc p where p.oid = 'public.export_claim_batch(uuid,uuid,uuid,numeric,uuid)'::regprocedure)
  and not (select p.prosecdef from pg_proc p where p.oid = 'public.reconcile_claim_batch(uuid,uuid,uuid,numeric,jsonb,uuid)'::regprocedure),
  'public claim workflow RPCs are SECURITY INVOKER'
);

select ok(
  has_function_privilege('authenticated', 'public.validate_claim_batch(uuid,uuid,uuid,numeric,uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.export_claim_batch(uuid,uuid,uuid,numeric,uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.reconcile_claim_batch(uuid,uuid,uuid,numeric,jsonb,uuid)', 'execute')
  and not has_function_privilege('anon', 'public.validate_claim_batch(uuid,uuid,uuid,numeric,uuid)', 'execute')
  and not has_function_privilege('anon', 'public.export_claim_batch(uuid,uuid,uuid,numeric,uuid)', 'execute')
  and not has_function_privilege('anon', 'public.reconcile_claim_batch(uuid,uuid,uuid,numeric,jsonb,uuid)', 'execute'),
  'claim workflow RPCs are authenticated-only'
);

select ok(
  not has_table_privilege('authenticated', 'public.claim_batches', 'update')
  and not has_table_privilege('authenticated', 'public.claim_items', 'update'),
  'authenticated cannot bypass claim workflows with direct updates'
);

select ok(
  exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.claim_items'::regclass
      and c.conname = 'claim_items_units_finite_check'
  )
  and exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.claim_items'::regclass
      and c.conname = 'claim_items_amount_finite_check'
  ),
  'claim item numeric inputs have finite-value constraints'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '70000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'claims-a@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '70000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'claims-b@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());

insert into public.organizations (id, code, name) values
  ('70100000-0000-4000-8000-000000000001', 'claims_org_a', '申報測試機構 A'),
  ('70100000-0000-4000-8000-000000000002', 'claims_org_b', '申報測試機構 B');

insert into public.branches (id, organization_id, code, name) values
  ('70200000-0000-4000-8000-000000000001', '70100000-0000-4000-8000-000000000001', 'main', '申報 A 分支'),
  ('70200000-0000-4000-8000-000000000002', '70100000-0000-4000-8000-000000000002', 'main', '申報 B 分支');

insert into public.profiles (id, display_name, kind) values
  ('70000000-0000-4000-8000-000000000001', 'A 申報人員', 'staff'),
  ('70000000-0000-4000-8000-000000000002', 'B 申報人員', 'staff');

insert into public.memberships (id, organization_id, branch_id, profile_id, status) values
  ('70300000-0000-4000-8000-000000000001', '70100000-0000-4000-8000-000000000001', '70200000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', 'active'),
  ('70300000-0000-4000-8000-000000000002', '70100000-0000-4000-8000-000000000002', '70200000-0000-4000-8000-000000000002', '70000000-0000-4000-8000-000000000002', 'active'),
  ('70300000-0000-4000-8000-000000000003', '70100000-0000-4000-8000-000000000002', '70200000-0000-4000-8000-000000000002', '70000000-0000-4000-8000-000000000001', 'active');

insert into public.membership_roles (membership_id, role_id) values
  ('70300000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000009'),
  ('70300000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000009'),
  ('70300000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000009');

insert into public.clients (
  id, organization_id, branch_id, client_code, display_name, source_system
) values
  ('70400000-0000-4000-8000-000000000001', '70100000-0000-4000-8000-000000000001', '70200000-0000-4000-8000-000000000001', 'CLAIM-A-001', '申報測試個案 A', 'test'),
  ('70400000-0000-4000-8000-000000000002', '70100000-0000-4000-8000-000000000002', '70200000-0000-4000-8000-000000000002', 'CLAIM-B-001', '申報測試個案 B', 'test');

insert into private.reauth_challenges (
  id, user_id, session_id, nonce_sha256, idempotency_key, issued_jwt_iat,
  issued_jwt_jti, created_at, expires_at, consumed_at, consumed_jwt_iat,
  consumed_jwt_jti, factor_method, factor_verified_at
) values (
  '70500000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001',
  '70600000-0000-4000-8000-000000000001', repeat('a', 64),
  '70700000-0000-4000-8000-000000000001', clock_timestamp() - interval '2 minutes',
  'claims-before-stepup', clock_timestamp() - interval '1 minute',
  clock_timestamp() + interval '4 minutes', clock_timestamp() - interval '30 seconds',
  clock_timestamp() - interval '30 seconds', 'claims-after-stepup', 'totp',
  clock_timestamp() - interval '30 seconds'
);

insert into private.reauth_events (
  user_id, session_id, challenge_id, aal, verification_method, verified_at
) values (
  '70000000-0000-4000-8000-000000000001', '70600000-0000-4000-8000-000000000001',
  '70500000-0000-4000-8000-000000000001', 'aal2', 'totp',
  clock_timestamp() - interval '30 seconds'
);

insert into public.authorized_care_plans (
  id, organization_id, branch_id, client_id, plan_key, version, status,
  effective_from, effective_to, source_system, source_record_id,
  source_provenance, authorized_on, authorization_reference, service_limits,
  plan_data, idempotency_key, created_by, approved_by, approved_at,
  approval_evidence_hash, approval_reauth_challenge_id, signed_by, signed_at,
  signature_purpose, signature_reauth_challenge_id, content_hash
) values (
  '70800000-0000-4000-8000-000000000001', '70100000-0000-4000-8000-000000000001',
  '70200000-0000-4000-8000-000000000001', '70400000-0000-4000-8000-000000000001',
  '70900000-0000-4000-8000-000000000001', 1, 'signed', '2026-08-01', '2026-09-30',
  'test', 'claims-authorized-plan', '{"source":"synthetic"}'::jsonb,
  '2026-07-30', 'CLAIM-AUTH-001', '{"units":100}'::jsonb, '{}'::jsonb,
  '70a00000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001',
  '70000000-0000-4000-8000-000000000001', clock_timestamp(), repeat('b', 64),
  '70500000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001',
  clock_timestamp(), '申報測試核定計畫', '70500000-0000-4000-8000-000000000001', repeat('c', 64)
);

insert into public.client_service_plans (
  id, organization_id, branch_id, client_id, authorized_care_plan_id,
  plan_key, version, status, effective_from, effective_to, source_system,
  source_record_id, source_provenance, authorized_limits_snapshot, goals,
  planned_services, idempotency_key, created_by, approved_by, approved_at,
  approval_evidence_hash, approval_reauth_challenge_id, signed_by, signed_at,
  signature_purpose, signature_reauth_challenge_id, content_hash
) values (
  '70b00000-0000-4000-8000-000000000001', '70100000-0000-4000-8000-000000000001',
  '70200000-0000-4000-8000-000000000001', '70400000-0000-4000-8000-000000000001',
  '70800000-0000-4000-8000-000000000001', '70c00000-0000-4000-8000-000000000001',
  1, 'signed', '2026-08-01', '2026-09-30', 'test', 'claims-service-plan',
  '{"source":"synthetic"}'::jsonb, '{"units":100}'::jsonb,
  '[{"goal":"synthetic"}]'::jsonb, '[{"service":"synthetic"}]'::jsonb,
  '70d00000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001',
  '70000000-0000-4000-8000-000000000001', clock_timestamp(), repeat('d', 64),
  '70500000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001',
  clock_timestamp(), '申報測試服務計畫', '70500000-0000-4000-8000-000000000001', repeat('e', 64)
);

insert into public.service_events (
  id, organization_id, branch_id, client_id, client_service_plan_id,
  service_code, status, started_at, ended_at, staff_user_id, evidence,
  idempotency_key, signed_at, signed_by, content_hash
) values
  ('71000000-0000-4000-8000-000000000001', '70100000-0000-4000-8000-000000000001', '70200000-0000-4000-8000-000000000001', '70400000-0000-4000-8000-000000000001', '70b00000-0000-4000-8000-000000000001', 'SVC-A', 'completed', '2026-09-05 09:00:00+08', '2026-09-05 10:00:00+08', '70000000-0000-4000-8000-000000000001', '{}'::jsonb, '71100000-0000-4000-8000-000000000001', clock_timestamp(), '70000000-0000-4000-8000-000000000001', repeat('1', 64)),
  ('71000000-0000-4000-8000-000000000002', '70100000-0000-4000-8000-000000000001', '70200000-0000-4000-8000-000000000001', '70400000-0000-4000-8000-000000000001', '70b00000-0000-4000-8000-000000000001', 'SVC-B', 'completed', '2026-09-06 09:00:00+08', '2026-09-06 10:00:00+08', '70000000-0000-4000-8000-000000000001', '{}'::jsonb, '71100000-0000-4000-8000-000000000002', clock_timestamp(), '70000000-0000-4000-8000-000000000001', repeat('2', 64)),
  ('71000000-0000-4000-8000-000000000003', '70100000-0000-4000-8000-000000000001', '70200000-0000-4000-8000-000000000001', '70400000-0000-4000-8000-000000000001', '70b00000-0000-4000-8000-000000000001', 'SVC-UNSIGNED', 'completed', '2026-09-07 09:00:00+08', '2026-09-07 10:00:00+08', '70000000-0000-4000-8000-000000000001', '{}'::jsonb, '71100000-0000-4000-8000-000000000003', null, null, null),
  ('71000000-0000-4000-8000-000000000004', '70100000-0000-4000-8000-000000000001', '70200000-0000-4000-8000-000000000001', '70400000-0000-4000-8000-000000000001', '70b00000-0000-4000-8000-000000000001', 'SVC-AUG', 'completed', '2026-08-20 09:00:00+08', '2026-08-20 10:00:00+08', '70000000-0000-4000-8000-000000000001', '{}'::jsonb, '71100000-0000-4000-8000-000000000004', clock_timestamp(), '70000000-0000-4000-8000-000000000001', repeat('4', 64)),
  ('71000000-0000-4000-8000-000000000005', '70100000-0000-4000-8000-000000000001', '70200000-0000-4000-8000-000000000001', '70400000-0000-4000-8000-000000000001', '70b00000-0000-4000-8000-000000000001', 'SVC-HASH', 'completed', '2026-09-08 09:00:00+08', '2026-09-08 10:00:00+08', '70000000-0000-4000-8000-000000000001', '{}'::jsonb, '71100000-0000-4000-8000-000000000005', clock_timestamp(), '70000000-0000-4000-8000-000000000001', repeat('5', 64));

insert into public.claim_batches (
  id, organization_id, branch_id, claim_period_start, claim_period_end,
  format_version, status, created_by
) values
  ('72000000-0000-4000-8000-000000000001', '70100000-0000-4000-8000-000000000001', '70200000-0000-4000-8000-000000000001', '2026-09-01', '2026-09-30', 'test-main', 'draft', '70000000-0000-4000-8000-000000000001'),
  ('72000000-0000-4000-8000-000000000002', '70100000-0000-4000-8000-000000000001', '70200000-0000-4000-8000-000000000001', '2026-09-01', '2026-09-30', 'test-duplicate', 'draft', '70000000-0000-4000-8000-000000000001'),
  ('72000000-0000-4000-8000-000000000003', '70100000-0000-4000-8000-000000000001', '70200000-0000-4000-8000-000000000001', '2026-09-01', '2026-09-30', 'test-unsigned', 'draft', '70000000-0000-4000-8000-000000000001'),
  ('72000000-0000-4000-8000-000000000004', '70100000-0000-4000-8000-000000000001', '70200000-0000-4000-8000-000000000001', '2026-09-01', '2026-09-30', 'test-period', 'draft', '70000000-0000-4000-8000-000000000001'),
  ('72000000-0000-4000-8000-000000000005', '70100000-0000-4000-8000-000000000001', '70200000-0000-4000-8000-000000000001', '2026-09-01', '2026-09-30', 'test-evidence', 'draft', '70000000-0000-4000-8000-000000000001'),
  ('72000000-0000-4000-8000-000000000006', '70100000-0000-4000-8000-000000000002', '70200000-0000-4000-8000-000000000002', '2026-09-01', '2026-09-30', 'test-branch-b', 'draft', '70000000-0000-4000-8000-000000000002'),
  ('72000000-0000-4000-8000-000000000008', '70100000-0000-4000-8000-000000000001', '70200000-0000-4000-8000-000000000001', '2026-09-01', '2026-09-30', 'test-input-guards', 'draft', '70000000-0000-4000-8000-000000000001');

insert into public.claim_items (
  id, organization_id, branch_id, claim_batch_id, client_id,
  service_event_id, service_code, service_date, units, amount, evidence_hash
) values
  ('72100000-0000-4000-8000-000000000001', '70100000-0000-4000-8000-000000000001', '70200000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001', '70400000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', 'SVC-A', '2026-09-05', 1, 10.00, repeat('1', 64)),
  ('72100000-0000-4000-8000-000000000002', '70100000-0000-4000-8000-000000000001', '70200000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001', '70400000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000002', 'SVC-B', '2026-09-06', 2, 20.00, repeat('2', 64)),
  ('72100000-0000-4000-8000-000000000003', '70100000-0000-4000-8000-000000000001', '70200000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000002', '70400000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', 'SVC-A', '2026-09-05', 1, 10.00, repeat('1', 64)),
  ('72100000-0000-4000-8000-000000000004', '70100000-0000-4000-8000-000000000001', '70200000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000003', '70400000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000003', 'SVC-UNSIGNED', '2026-09-07', 1, 5.00, repeat('3', 64)),
  ('72100000-0000-4000-8000-000000000005', '70100000-0000-4000-8000-000000000001', '70200000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000004', '70400000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000004', 'SVC-AUG', '2026-08-20', 1, 5.00, repeat('4', 64)),
  ('72100000-0000-4000-8000-000000000006', '70100000-0000-4000-8000-000000000001', '70200000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000005', '70400000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000005', 'SVC-HASH', '2026-09-08', 1, 5.00, repeat('6', 64));

-- Defensive export tests use deliberately forged validation evidence. The
-- production validation RPC would reject each of these batches.
update public.claim_batches batch
set
  status = 'validated',
  validation_idempotency_key = ids.validation_key,
  validation_request_hash = encode(
    sha256(convert_to(jsonb_build_object(
      'operation', 'claim_validation',
      'organization_id', batch.organization_id,
      'branch_id', batch.branch_id,
      'claim_batch_id', batch.id,
      'expected_total_amount', 5.00::numeric(14,2)
    )::text, 'UTF8')),
    'hex'
  )
from (values
  ('72000000-0000-4000-8000-000000000003'::uuid, '72200000-0000-4000-8000-000000000003'::uuid),
  ('72000000-0000-4000-8000-000000000004'::uuid, '72200000-0000-4000-8000-000000000004'::uuid),
  ('72000000-0000-4000-8000-000000000005'::uuid, '72200000-0000-4000-8000-000000000005'::uuid)
) ids(batch_id, validation_key)
where batch.id = ids.batch_id;

insert into public.claim_batches (
  id, organization_id, branch_id, claim_period_start, claim_period_end,
  format_version, status, snapshot_hash, snapshot_item_count,
  snapshot_total_amount, exported_at, snapshot_hash_version, created_by
) values (
  '72000000-0000-4000-8000-000000000007', '70100000-0000-4000-8000-000000000001',
  '70200000-0000-4000-8000-000000000001', '2026-07-01', '2026-07-31',
  'legacy-test', 'rejected', repeat('9', 64), 1, 0.00,
  clock_timestamp(), 'legacy-js-v1',
  '70000000-0000-4000-8000-000000000001'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"70000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1","session_id":"70600000-0000-4000-8000-000000000001","amr":[{"method":"password"}]}'::text,
  true
);

select throws_ok(
  $$select * from public.validate_claim_batch(
      '70100000-0000-4000-8000-000000000001',
      '70200000-0000-4000-8000-000000000001',
      '72000000-0000-4000-8000-000000000001', 30.00,
      '72300000-0000-4000-8000-000000000001'
    )$$,
  '42501', null,
  'AAL1 employee cannot validate a claim batch'
);

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '70000000-0000-4000-8000-000000000001', 'role', 'authenticated',
    'aal', 'aal2', 'session_id', '70600000-0000-4000-8000-000000000001',
    'iat', extract(epoch from clock_timestamp())::bigint, 'jti', 'claims-after-stepup',
    'amr', jsonb_build_array(jsonb_build_object(
      'method', 'totp',
      'timestamp', extract(epoch from clock_timestamp() - interval '30 seconds')::bigint
    ))
  )::text,
  true
);

select throws_ok(
  $$select * from public.export_claim_batch(
      '70100000-0000-4000-8000-000000000001',
      '70200000-0000-4000-8000-000000000001',
      '72000000-0000-4000-8000-000000000001', 30.00,
      '72400000-0000-4000-8000-000000000001'
    )$$,
  '55000', null,
  'draft claim batch cannot be exported'
);

select is(
  (select (result.status, result.item_count, result.total_amount, result.replayed)::text
   from public.validate_claim_batch(
      '70100000-0000-4000-8000-000000000001',
      '70200000-0000-4000-8000-000000000001',
     '72000000-0000-4000-8000-000000000001', 30.00,
     '72300000-0000-4000-8000-000000000001'
   ) result),
  '(validated,2,30.00,f)',
  'eligible draft batch validates atomically with exact count and amount'
);

select is(
  (select result.replayed from public.validate_claim_batch(
      '70100000-0000-4000-8000-000000000001',
      '70200000-0000-4000-8000-000000000001',
    '72000000-0000-4000-8000-000000000001', 30.00,
    '72300000-0000-4000-8000-000000000001'
  ) result),
  true,
  'claim validation safely replays the same idempotency operation'
);

select throws_ok(
  $$insert into public.claim_items (
      organization_id, branch_id, claim_batch_id, client_id, service_event_id,
      service_code, service_date, units, amount, evidence_hash
    ) values (
      '70100000-0000-4000-8000-000000000001', '70200000-0000-4000-8000-000000000001',
      '72000000-0000-4000-8000-000000000001', '70400000-0000-4000-8000-000000000001',
      '71000000-0000-4000-8000-000000000005', 'SVC-HASH', '2026-09-08', 1, 1,
      repeat('5', 64)
    )$$,
  '55000', null,
  'validated claim item set is frozen before export'
);

select is(
  (select (result.status, result.item_count, result.total_amount, result.replayed)::text
   from public.export_claim_batch(
      '70100000-0000-4000-8000-000000000001',
      '70200000-0000-4000-8000-000000000001',
     '72000000-0000-4000-8000-000000000001', 30.00,
     '72400000-0000-4000-8000-000000000001'
   ) result),
  '(exported,2,30.00,f)',
  'validated eligible batch exports one immutable snapshot atomically'
);

select ok(
  exists (
    select 1 from public.claim_batches batch
    where batch.id = '72000000-0000-4000-8000-000000000001'
      and batch.snapshot_hash_version = 'postgres-jsonb-v1'
      and batch.snapshot_item_count = 2
      and batch.snapshot_total_amount = 30.00
      and batch.snapshot_hash ~ '^[a-f0-9]{64}$'
  ),
  'export stores exact immutable snapshot metadata'
);

reset role;
select is(
  (select count(*)::integer from private.claim_service_allocations
   where claim_batch_id = '72000000-0000-4000-8000-000000000001'),
  2,
  'export reserves each service event in the private allocation ledger'
);
set local role authenticated;

select is(
  (select result.replayed from public.export_claim_batch(
      '70100000-0000-4000-8000-000000000001',
      '70200000-0000-4000-8000-000000000001',
    '72000000-0000-4000-8000-000000000001', 30.00,
    '72400000-0000-4000-8000-000000000001'
  ) result),
  true,
  'claim export safely replays the same idempotency operation'
);

select is(
  (select (result.status, result.item_count, result.total_amount, result.replayed)::text
   from public.validate_claim_batch(
      '70100000-0000-4000-8000-000000000001',
      '70200000-0000-4000-8000-000000000001',
    '72000000-0000-4000-8000-000000000001', 30.00,
    '72300000-0000-4000-8000-000000000001'
  ) result),
  '(validated,2,30.00,t)',
  'claim validation exactly replays after the batch advances to export'
);

select throws_ok(
  $$select * from public.export_claim_batch(
      '70100000-0000-4000-8000-000000000001',
      '70200000-0000-4000-8000-000000000001',
      '72000000-0000-4000-8000-000000000001', 31.00,
      '72400000-0000-4000-8000-000000000001'
    )$$,
  '23505', null,
  'same export idempotency key with different content conflicts'
);

select is(
  (select result.status from public.validate_claim_batch(
      '70100000-0000-4000-8000-000000000001',
      '70200000-0000-4000-8000-000000000001',
    '72000000-0000-4000-8000-000000000002', 10.00,
    '72300000-0000-4000-8000-000000000002'
  ) result),
  'validated'::public.claim_status,
  'second batch may validate before allocation conflict is resolved at export'
);

select ok(
  position('client-service-plan:' in pg_get_functiondef('private.lock_claim_plan_scopes(uuid)'::regprocedure)) > 0
  and position('authorized-care-plan:' in pg_get_functiondef('private.lock_claim_plan_scopes(uuid)'::regprocedure)) > 0
  and position('pg_advisory_xact_lock' in pg_get_functiondef('private.lock_claim_plan_scopes(uuid)'::regprocedure)) > 0,
  'claim validation uses both plan-scope advisory lock namespaces'
);

select throws_ok(
  $$select * from public.export_claim_batch(
      '70100000-0000-4000-8000-000000000001',
      '70200000-0000-4000-8000-000000000001',
      '72000000-0000-4000-8000-000000000002', 10.00,
      '72400000-0000-4000-8000-000000000002'
    )$$,
  '23514', null,
  'one service event cannot be exported in two claim batches'
);

select throws_ok(
  $$insert into public.claim_items (
      organization_id, branch_id, claim_batch_id, client_id, service_event_id,
      service_code, service_date, units, amount, evidence_hash
    ) values (
      '70100000-0000-4000-8000-000000000001', '70200000-0000-4000-8000-000000000001',
      '72000000-0000-4000-8000-000000000001', '70400000-0000-4000-8000-000000000001',
      '71000000-0000-4000-8000-000000000005', 'SVC-HASH', '2026-09-08', 1, 1,
      repeat('5', 64)
    )$$,
  '55000', null,
  'claim item insert is rejected after export'
);

select throws_ok(
  $$update public.claim_items set amount = 99 where id = '72100000-0000-4000-8000-000000000001'$$,
  '42501', null,
  'claim item update privilege remains revoked after export'
);

select throws_ok(
  $$delete from public.claim_items where id = '72100000-0000-4000-8000-000000000001'$$,
  '42501', null,
  'claim item delete privilege remains absent after export'
);

select throws_ok(
  $$select * from public.export_claim_batch(
      '70100000-0000-4000-8000-000000000001',
      '70200000-0000-4000-8000-000000000001',
      '72000000-0000-4000-8000-000000000003', 5.00,
      '72400000-0000-4000-8000-000000000003'
    )$$,
  '23514', null,
  'unsigned service evidence is rejected at export'
);

select throws_ok(
  $$select * from public.export_claim_batch(
      '70100000-0000-4000-8000-000000000001',
      '70200000-0000-4000-8000-000000000001',
      '72000000-0000-4000-8000-000000000004', 5.00,
      '72400000-0000-4000-8000-000000000004'
    )$$,
  '23514', null,
  'service outside claim period is rejected at export'
);

select throws_ok(
  $$select * from public.export_claim_batch(
      '70100000-0000-4000-8000-000000000001',
      '70200000-0000-4000-8000-000000000001',
      '72000000-0000-4000-8000-000000000005', 5.00,
      '72400000-0000-4000-8000-000000000005'
    )$$,
  '23514', null,
  'mismatched evidence hash is rejected at export'
);

select throws_ok(
  $$select * from public.reconcile_claim_batch(
      '70100000-0000-4000-8000-000000000001',
      '70200000-0000-4000-8000-000000000001',
      '72000000-0000-4000-8000-000000000001', 30.00,
      jsonb_build_array(jsonb_build_object(
        'claim_item_id', '72100000-0000-4000-8000-000000000001',
        'outcome', 'accepted', 'response_code', 'OK'
      )),
      '72500000-0000-4000-8000-000000000001'
    )$$,
  '23514', null,
  'partial reconciliation is rejected'
);

select throws_ok(
  $$select * from public.reconcile_claim_batch(
      '70100000-0000-4000-8000-000000000001',
      '70200000-0000-4000-8000-000000000001',
      '72000000-0000-4000-8000-000000000001', 30.00,
      jsonb_build_array(
        jsonb_build_object('claim_item_id', '72100000-0000-4000-8000-000000000001', 'outcome', 'accepted', 'response_code', 'OK'),
        jsonb_build_object('claim_item_id', '72100000-0000-4000-8000-000000000001', 'outcome', 'rejected', 'response_code', 'DUP')
      ),
      '72500000-0000-4000-8000-000000000001'
    )$$,
  '23514', null,
  'duplicate reconciliation rows are rejected'
);

select throws_ok(
  $$select * from public.reconcile_claim_batch(
      '70100000-0000-4000-8000-000000000001',
      '70200000-0000-4000-8000-000000000001',
      '72000000-0000-4000-8000-000000000001', 30.00,
      jsonb_build_array(
        jsonb_build_object('claim_item_id', '72100000-0000-4000-8000-000000000001', 'outcome', 'accepted', 'response_code', 'OK'),
        jsonb_build_object('claim_item_id', '72100000-0000-4000-8000-000000000002', 'outcome', 'rejected', 'response_code', 'NO'),
        jsonb_build_object('claim_item_id', '72100000-0000-4000-8000-000000000099', 'outcome', 'accepted', 'response_code', 'EXTRA')
      ),
      '72500000-0000-4000-8000-000000000001'
    )$$,
  '23514', null,
  'extra reconciliation rows are rejected even when all real items are present'
);

select is(
  (select (result.status, result.item_count, result.accepted_count, result.rejected_count, result.total_amount, result.replayed)::text
   from public.reconcile_claim_batch(
      '70100000-0000-4000-8000-000000000001',
      '70200000-0000-4000-8000-000000000001',
     '72000000-0000-4000-8000-000000000001', 30.00,
     jsonb_build_array(
       jsonb_build_object('claim_item_id', '72100000-0000-4000-8000-000000000001', 'outcome', 'accepted', 'response_code', ' OK ', 'response_message', ' done '),
       jsonb_build_object('claim_item_id', '72100000-0000-4000-8000-000000000002', 'outcome', 'rejected', 'response_code', ' NO ', 'response_message', null)
     ),
     '72500000-0000-4000-8000-000000000001'
   ) result),
  '(reconciled,2,1,1,30.00,f)',
  'complete reconciliation atomically records exact outcomes'
);

select is(
  (select string_agg(item.response_outcome || ':' || item.response_code, ',' order by item.id)
   from public.claim_items item
   where item.claim_batch_id = '72000000-0000-4000-8000-000000000001'),
  'accepted:OK,rejected:NO',
  'reconciliation stores normalized response values'
);

select is(
  (select result.replayed
   from public.reconcile_claim_batch(
      '70100000-0000-4000-8000-000000000001',
      '70200000-0000-4000-8000-000000000001',
     '72000000-0000-4000-8000-000000000001', 30.00,
     jsonb_build_array(
       jsonb_build_object('claim_item_id', '72100000-0000-4000-8000-000000000002', 'outcome', 'rejected', 'response_code', 'NO', 'response_message', null),
       jsonb_build_object('claim_item_id', '72100000-0000-4000-8000-000000000001', 'outcome', 'accepted', 'response_code', 'OK', 'response_message', 'done')
     ),
     '72500000-0000-4000-8000-000000000001'
   ) result),
  true,
  'reconciliation replay is order-independent and idempotent'
);

select throws_ok(
  $$select * from public.reconcile_claim_batch(
      '70100000-0000-4000-8000-000000000001',
      '70200000-0000-4000-8000-000000000001',
      '72000000-0000-4000-8000-000000000001', 30.00,
      jsonb_build_array(
        jsonb_build_object('claim_item_id', '72100000-0000-4000-8000-000000000001', 'outcome', 'rejected', 'response_code', 'CHANGED'),
        jsonb_build_object('claim_item_id', '72100000-0000-4000-8000-000000000002', 'outcome', 'accepted', 'response_code', 'CHANGED')
      ),
      '72500000-0000-4000-8000-000000000001'
    )$$,
  '23505', null,
  'same reconciliation idempotency key with different result conflicts'
);

reset role;
update public.claim_batches
set status = 'voided'
where id = '72000000-0000-4000-8000-000000000001';
set local role authenticated;

select is(
  (select (result.status, result.replayed)::text
   from public.export_claim_batch(
      '70100000-0000-4000-8000-000000000001',
      '70200000-0000-4000-8000-000000000001',
     '72000000-0000-4000-8000-000000000001', 30.00,
     '72400000-0000-4000-8000-000000000001'
   ) result),
  '(exported,t)',
  'successful export receipt exactly replays after a later void'
);

select is(
  (select (result.status, result.item_count, result.accepted_count, result.rejected_count, result.total_amount, result.replayed)::text
   from public.reconcile_claim_batch(
      '70100000-0000-4000-8000-000000000001',
      '70200000-0000-4000-8000-000000000001',
     '72000000-0000-4000-8000-000000000001', 30.00,
     jsonb_build_array(
       jsonb_build_object('claim_item_id', '72100000-0000-4000-8000-000000000002', 'outcome', 'rejected', 'response_code', 'NO', 'response_message', null),
       jsonb_build_object('claim_item_id', '72100000-0000-4000-8000-000000000001', 'outcome', 'accepted', 'response_code', 'OK', 'response_message', 'done')
     ),
     '72500000-0000-4000-8000-000000000001'
   ) result),
  '(reconciled,2,1,1,30.00,t)',
  'successful reconciliation receipt exactly replays after a later void'
);

select throws_ok(
  $$select * from public.reconcile_claim_batch(
      '70100000-0000-4000-8000-000000000001',
      '70200000-0000-4000-8000-000000000001',
      '72000000-0000-4000-8000-000000000007', 0.00,
      jsonb_build_array(jsonb_build_object(
        'claim_item_id', '72100000-0000-4000-8000-000000000099',
        'outcome', 'accepted', 'response_code', 'OK'
      )),
      '72500000-0000-4000-8000-000000000007'
    )$$,
  '55000', null,
  'legacy JavaScript snapshot fails closed for reconciliation'
);

select is(
  (select (summary.item_count, summary.total_amount, summary.responded_item_count, summary.rejected_item_count, summary.has_immutable_snapshot)::text
   from public.claim_batch_summaries('70200000-0000-4000-8000-000000000001', 200) summary
   where summary.id = '72000000-0000-4000-8000-000000000001'),
  '(2,30.00,2,1,t)',
  'claim summary returns exact snapshot count, amount, response/rejection counts, and immutable state'
);

select is(
  (select (summary.has_immutable_snapshot, summary.legacy_response_unknown)::text
   from public.claim_batch_summaries('70200000-0000-4000-8000-000000000001', 200) summary
   where summary.id = '72000000-0000-4000-8000-000000000007'),
  '(f,t)',
  'legacy rows are neither advertised as canonical snapshots nor as zero known responses'
);

select is(
  (select count(*)::integer
   from public.claim_batch_summaries('70200000-0000-4000-8000-000000000099', 200)),
  0,
  'claim summary returns no rows for a branch outside actor scope'
);

select throws_ok(
  $$select * from public.validate_claim_batch(
      '70100000-0000-4000-8000-000000000001',
      '70200000-0000-4000-8000-000000000001',
      '72000000-0000-4000-8000-000000000006', 0.00,
      '72300000-0000-4000-8000-000000000006'
    )$$,
  '42501', null,
  'multi-scope actor cannot validate a batch outside the selected tenant context'
);

select throws_ok(
  $$select * from public.export_claim_batch(
      '70100000-0000-4000-8000-000000000001',
      '70200000-0000-4000-8000-000000000001',
      '72000000-0000-4000-8000-000000000006', 0.00,
      '72400000-0000-4000-8000-000000000006'
    )$$,
  '42501', null,
  'multi-scope actor cannot export a batch outside the selected tenant context'
);

select throws_ok(
  $$select * from public.reconcile_claim_batch(
      '70100000-0000-4000-8000-000000000001',
      '70200000-0000-4000-8000-000000000001',
      '72000000-0000-4000-8000-000000000006', 0.00,
      jsonb_build_array(jsonb_build_object(
        'claim_item_id', '72100000-0000-4000-8000-000000000099',
        'outcome', 'accepted', 'response_code', 'OK'
      )),
      '72500000-0000-4000-8000-000000000006'
    )$$,
  '42501', null,
  'multi-scope actor cannot reconcile a batch outside the selected tenant context'
);

reset role;

select throws_ok(
  $$insert into public.claim_batches (
      organization_id, branch_id, claim_period_start, claim_period_end,
      format_version, status, snapshot_hash, snapshot_item_count,
      snapshot_total_amount, exported_at, created_by
    ) values (
      '70100000-0000-4000-8000-000000000001', '70200000-0000-4000-8000-000000000001',
      '2026-09-01', '2026-09-30', 'test-prefilled-draft', 'draft',
      repeat('8', 64), 1, 1, clock_timestamp(),
      '70000000-0000-4000-8000-000000000001'
    )$$,
  '23514', null,
  'draft batch cannot prefill snapshot or export metadata'
);

select throws_ok(
  $$insert into public.claim_items (
      organization_id, branch_id, claim_batch_id, client_id, service_event_id,
      service_code, service_date, units, amount, evidence_hash
    ) values (
      '70100000-0000-4000-8000-000000000001', '70200000-0000-4000-8000-000000000001',
      '72000000-0000-4000-8000-000000000008', '70400000-0000-4000-8000-000000000001',
      '71000000-0000-4000-8000-000000000005', 'SVC-HASH', '2026-09-08',
      'NaN'::numeric, 1, repeat('5', 64)
    )$$,
  '23514', null,
  'NaN claim units are rejected by a database constraint'
);

select throws_ok(
  $$insert into public.claim_items (
      organization_id, branch_id, claim_batch_id, client_id, service_event_id,
      service_code, service_date, units, amount, evidence_hash, response_code
    ) values (
      '70100000-0000-4000-8000-000000000001', '70200000-0000-4000-8000-000000000001',
      '72000000-0000-4000-8000-000000000008', '70400000-0000-4000-8000-000000000001',
      '71000000-0000-4000-8000-000000000005', 'SVC-HASH', '2026-09-08',
      1, 1, repeat('5', 64), 'PRESET'
    )$$,
  '23514', null,
  'claim item cannot prefill a reconciliation response'
);

select * from finish();
rollback;
