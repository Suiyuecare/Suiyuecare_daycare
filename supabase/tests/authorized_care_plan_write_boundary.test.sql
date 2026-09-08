begin;

select plan(12);

select ok(
  has_table_privilege('authenticated', 'public.authorized_care_plans', 'select')
  and not has_table_privilege('authenticated', 'public.authorized_care_plans', 'insert')
  and not has_table_privilege('service_role', 'public.authorized_care_plans', 'insert')
  and not has_table_privilege('anon', 'public.authorized_care_plans', 'insert'),
  'application roles retain authorized-plan reads but cannot append directly'
);

select is(
  (
    select count(*)::integer
    from pg_policy policy
    where policy.polrelid = 'public.authorized_care_plans'::regclass
      and policy.polcmd = 'a'
  ),
  0,
  'no dormant INSERT policy can be reactivated by an accidental table grant'
);

select ok(
  (
    select relation.relrowsecurity and relation.relforcerowsecurity
    from pg_class relation
    where relation.oid = 'public.authorized_care_plans'::regclass
  )
  and exists (
    select 1
    from pg_policy policy
    where policy.polrelid = 'public.authorized_care_plans'::regclass
      and policy.polcmd = 'r'
  ),
  'the authoritative ledger remains forced-RLS with its read policy intact'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '55000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'authorized-boundary@example.invalid', '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
);

insert into public.organizations (id, code, name) values (
  '55010000-0000-4000-8000-000000000001',
  'authorized_boundary',
  '核定計畫邊界合成機構'
);

insert into public.branches (id, organization_id, code, name) values (
  '55020000-0000-4000-8000-000000000001',
  '55010000-0000-4000-8000-000000000001',
  'main',
  '核定計畫邊界合成分支'
);

insert into public.profiles (id, display_name, kind) values (
  '55000000-0000-4000-8000-000000000001',
  '核定計畫邊界合成主管',
  'staff'
);

insert into public.memberships (
  id, organization_id, branch_id, profile_id, status, starts_at
) values (
  '55030000-0000-4000-8000-000000000001',
  '55010000-0000-4000-8000-000000000001',
  null,
  '55000000-0000-4000-8000-000000000001',
  'active',
  clock_timestamp() - interval '1 year'
);

insert into public.membership_roles (membership_id, role_id) values (
  '55030000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002'
);

insert into public.clients (
  id, organization_id, branch_id, client_code, display_name, status,
  admitted_on, source_system
) values (
  '55040000-0000-4000-8000-000000000001',
  '55010000-0000-4000-8000-000000000001',
  '55020000-0000-4000-8000-000000000001',
  'AUTH-BOUNDARY-001',
  '核定計畫邊界合成個案',
  'active',
  '2026-01-01',
  'test'
);

insert into private.reauth_challenges (
  id, user_id, session_id, nonce_sha256, idempotency_key, issued_jwt_iat,
  issued_jwt_jti, created_at, expires_at, consumed_at, consumed_jwt_iat,
  consumed_jwt_jti, factor_method, factor_verified_at
) values (
  '55050000-0000-4000-8000-000000000001',
  '55000000-0000-4000-8000-000000000001',
  '55051000-0000-4000-8000-000000000001',
  repeat('5', 64),
  '55052000-0000-4000-8000-000000000001',
  clock_timestamp() - interval '2 minutes',
  'authorized-boundary-before-stepup',
  clock_timestamp() - interval '2 minutes',
  clock_timestamp() + interval '5 minutes',
  clock_timestamp() - interval '30 seconds',
  clock_timestamp() - interval '30 seconds',
  'authorized-boundary-after-stepup',
  'totp',
  clock_timestamp() - interval '30 seconds'
);

insert into private.reauth_events (
  user_id, session_id, challenge_id, aal, verification_method, verified_at
) values (
  '55000000-0000-4000-8000-000000000001',
  '55051000-0000-4000-8000-000000000001',
  '55050000-0000-4000-8000-000000000001',
  'aal2',
  'totp',
  clock_timestamp() - interval '30 seconds'
);

-- Database-owner setup represents an explicitly reviewed import/promotion seed,
-- not an application write path.
insert into public.authorized_care_plans (
  id, organization_id, branch_id, client_id, plan_key, version,
  previous_version_id, status, effective_from, effective_to, source_system,
  source_record_id, source_provenance, authorized_on, authorization_reference,
  service_limits, plan_data, correction_reason, idempotency_key, created_by,
  approved_by, approved_at, approval_evidence_hash, approval_reauth_challenge_id,
  signed_by, signed_at, signature_purpose, signature_reauth_challenge_id,
  content_hash
) values (
  '55060000-0000-4000-8000-000000000001',
  '55010000-0000-4000-8000-000000000001',
  '55020000-0000-4000-8000-000000000001',
  '55040000-0000-4000-8000-000000000001',
  '55061000-0000-4000-8000-000000000001',
  1, null, 'signed', '2026-09-01', '2026-12-31',
  'central_html_import', 'AUTH-BOUNDARY-SOURCE-001',
  '{"batch":"synthetic-reviewed-owner-seed","mapping_version":"v1"}'::jsonb,
  '2026-08-31', 'AUTH-BOUNDARY-REF-001',
  '{"synthetic_limit":1}'::jsonb,
  '{"synthetic_plan":"reviewed"}'::jsonb,
  null,
  '55062000-0000-4000-8000-000000000001',
  '55000000-0000-4000-8000-000000000001',
  '55000000-0000-4000-8000-000000000001',
  clock_timestamp() - interval '20 seconds',
  repeat('a', 64),
  '55050000-0000-4000-8000-000000000001',
  '55000000-0000-4000-8000-000000000001',
  clock_timestamp() - interval '10 seconds',
  '核定計畫邊界合成簽署',
  '55050000-0000-4000-8000-000000000001',
  repeat('c', 64)
);

select is(
  (
    select count(*)::integer
    from public.authorized_care_plans plan
    where plan.id = '55060000-0000-4000-8000-000000000001'
      and plan.source_system = 'central_html_import'
      and plan.content_hash = repeat('c', 64)
  ),
  1,
  'a reviewed database-owner seed remains available to read-only projections and guarded consumers'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '55000000-0000-4000-8000-000000000001',
    'role', 'authenticated',
    'aal', 'aal2',
    'session_id', '55051000-0000-4000-8000-000000000001',
    'iat', extract(epoch from now())::bigint,
    'jti', 'authorized-boundary-current'
  )::text,
  true
);

select throws_ok(
  $$
    insert into public.authorized_care_plans (
      organization_id, branch_id, client_id, plan_key, version, status,
      effective_from, effective_to, source_system, source_provenance,
      service_limits, plan_data, idempotency_key, created_by
    ) values (
      '55010000-0000-4000-8000-000000000001',
      '55020000-0000-4000-8000-000000000001',
      '55040000-0000-4000-8000-000000000001',
      '55070000-0000-4000-8000-000000000001',
      1, 'draft', '2026-09-01', '2026-12-31',
      'central_html_import', '{"forged":true}'::jsonb,
      '{"forged_limit":999}'::jsonb, '{"forged_plan":true}'::jsonb,
      '55071000-0000-4000-8000-000000000001',
      '55000000-0000-4000-8000-000000000001'
    )
  $$,
  '42501',
  null,
  'authenticated cannot forge even a draft authoritative plan'
);

select throws_ok(
  $$
    insert into public.authorized_care_plans (
      organization_id, branch_id, client_id, plan_key, version, status,
      effective_from, effective_to, source_system, source_record_id,
      source_provenance, authorized_on, authorization_reference,
      service_limits, plan_data, idempotency_key, created_by,
      approved_by, approved_at, approval_evidence_hash,
      approval_reauth_challenge_id, signed_by, signed_at, signature_purpose,
      signature_reauth_challenge_id, content_hash
    ) values (
      '55010000-0000-4000-8000-000000000001',
      '55020000-0000-4000-8000-000000000001',
      '55040000-0000-4000-8000-000000000001',
      '55070000-0000-4000-8000-000000000002',
      1, 'signed', '2026-09-01', '2026-12-31',
      'central_html_import', 'FORGED-SOURCE', '{"forged":true}'::jsonb,
      '2026-08-31', 'FORGED-REFERENCE',
      '{"forged_limit":999}'::jsonb, '{"forged_plan":true}'::jsonb,
      '55071000-0000-4000-8000-000000000002',
      '55000000-0000-4000-8000-000000000001',
      '55000000-0000-4000-8000-000000000001', clock_timestamp(), repeat('d', 64),
      '55050000-0000-4000-8000-000000000001',
      '55000000-0000-4000-8000-000000000001', clock_timestamp(),
      '瀏覽器偽造核定簽署', '55050000-0000-4000-8000-000000000001', repeat('e', 64)
    )
  $$,
  '42501',
  null,
  'authenticated cannot forge a signed authoritative plan or its hashes'
);

select is(
  (
    select count(*)::integer
    from public.authorized_care_plans plan
    where plan.organization_id = '55010000-0000-4000-8000-000000000001'
  ),
  1,
  'rejected application writes leave the authoritative ledger unchanged'
);

select is(
  (
    select (snapshot.snapshot_json::jsonb #>> '{metrics,matching_stream_total}')::integer
    from public.authorized_care_plan_view_snapshot(
      '55010000-0000-4000-8000-000000000001',
      '55020000-0000-4000-8000-000000000001',
      '2026-09-08', null, null, null, 'all', null, 1, 25
    ) snapshot
  ),
  1,
  'Page55 still reads the reviewed authoritative seed through its scoped snapshot'
);

select is(
  (
    select result.status::text
    from public.mutate_client_service_plan_workflow(
      '55010000-0000-4000-8000-000000000001',
      '55020000-0000-4000-8000-000000000001',
      'create_draft',
      '55040000-0000-4000-8000-000000000001',
      '55080000-0000-4000-8000-000000000001',
      null, 0, null,
      '55060000-0000-4000-8000-000000000001',
      repeat('c', 64),
      '2026-09-01', '2026-12-31', '2026-10-31',
      '55000000-0000-4000-8000-000000000001',
      jsonb_build_array(jsonb_build_object(
        'goal_id', '55081000-0000-4000-8000-000000000001',
        'item_order', 1,
        'goal', '核定計畫邊界合成服務目標',
        'target_outcome', '由人工確認的合成服務成果'
      )),
      jsonb_build_array(jsonb_build_object(
        'measure_id', '55082000-0000-4000-8000-000000000001',
        'item_order', 1,
        'goal_id', '55081000-0000-4000-8000-000000000001',
        'measure', '核定計畫邊界合成服務措施',
        'frequency', '合成服務日人工執行',
        'responsible_user_id', '55000000-0000-4000-8000-000000000001'
      )),
      '依已審查核定來源建立合成初稿',
      '55083000-0000-4000-8000-000000000001'
    ) result
  ),
  'draft',
  'Page52 guarded workflow can still bind a draft to the reviewed authoritative seed'
);

select ok(
  exists (
    select 1
    from public.client_service_plans plan
    where plan.plan_key = '55080000-0000-4000-8000-000000000001'
      and plan.authorized_care_plan_id = '55060000-0000-4000-8000-000000000001'
      and plan.authorized_limits_snapshot = '{"synthetic_limit":1}'::jsonb
      and plan.source_provenance ->> 'workflow' = 'page52_client_service_plan_v1'
  ),
  'the guarded service-plan row freezes the exact reviewed authorization ID and limits'
);

select is(
  (
    select result.claim_eligibility_status
    from public.client_service_plan_workflow_snapshot(
      '55010000-0000-4000-8000-000000000001',
      '55020000-0000-4000-8000-000000000001',
      '55040000-0000-4000-8000-000000000001',
      null,
      '2026-09-08',
      null
    ) result
  ),
  'blocked_not_configured',
  'the trusted source does not weaken Page52 official-claim fail-closed status'
);

reset role;

set local role service_role;

select throws_ok(
  $$
    insert into public.authorized_care_plans (
      organization_id, branch_id, client_id, plan_key, version, status,
      effective_from, effective_to, source_system, source_provenance,
      service_limits, plan_data, idempotency_key, created_by
    ) values (
      '55010000-0000-4000-8000-000000000001',
      '55020000-0000-4000-8000-000000000001',
      '55040000-0000-4000-8000-000000000001',
      '55070000-0000-4000-8000-000000000003',
      1, 'draft', '2026-09-01', '2026-12-31',
      'central_html_import', '{"forged":true}'::jsonb,
      '{"forged_limit":999}'::jsonb, '{"forged_plan":true}'::jsonb,
      '55071000-0000-4000-8000-000000000003',
      '55000000-0000-4000-8000-000000000001'
    )
  $$,
  '42501',
  null,
  'service_role also fails closed until a governed promotion writer exists'
);

reset role;

select * from finish();
rollback;
