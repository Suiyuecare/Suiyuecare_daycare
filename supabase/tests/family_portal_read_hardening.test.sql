begin;

select plan(21);

select ok(
  to_regprocedure('private.has_current_governed_family_consent(uuid,text)') is not null
  and (
    select procedure.prosecdef
      and array_to_string(procedure.proconfig, ',') like 'search_path=%'
    from pg_proc procedure
    where procedure.oid =
      'private.has_current_governed_family_consent(uuid,text)'::regprocedure
  )
  and not has_function_privilege(
    'authenticated',
    'private.has_current_governed_family_consent(uuid,text)',
    'execute'
  ),
  'the governed-consent predicate is a locked private definer with no caller oracle'
);

select ok(
  has_function_privilege('authenticated', 'public.family_client_summaries()', 'execute')
  and has_function_privilege('authenticated', 'public.family_care_summaries(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.family_client_summaries()', 'execute')
  and not has_function_privilege('anon', 'public.family_care_summaries(uuid)', 'execute'),
  'only authenticated callers retain the narrow public family wrappers'
);

select ok(
  position(
    'has_current_governed_family_consent' in
    pg_get_functiondef('private.family_client_summaries()'::regprocedure)
  ) > 0
  and position(
    'and false' in
    lower(pg_get_functiondef('private.family_care_summaries(uuid)'::regprocedure))
  ) > 0,
  'client summaries use governed consent and care metadata is explicitly fail closed'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'c8000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'family-read-actor@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c8000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'family-read-a@example.invalid', '', now(), '{"provider":"phone","providers":["phone"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c8000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'family-read-b@example.invalid', '', now(), '{"provider":"phone","providers":["phone"]}'::jsonb, '{}'::jsonb, now(), now());

insert into public.organizations (id, code, name) values
  ('c8100000-0000-4000-8000-000000000001', 'family_read_a', '合成機構甲'),
  ('c8100000-0000-4000-8000-000000000002', 'family_read_b', '合成機構乙');

insert into public.branches (id, organization_id, code, name) values
  ('c8200000-0000-4000-8000-000000000001', 'c8100000-0000-4000-8000-000000000001', 'main', '合成分支甲'),
  ('c8200000-0000-4000-8000-000000000002', 'c8100000-0000-4000-8000-000000000002', 'main', '合成分支乙');

insert into public.profiles (id, display_name, kind) values
  ('c8000000-0000-4000-8000-000000000001', '合成授權人', 'staff'),
  ('c8000000-0000-4000-8000-000000000002', '合成家屬甲', 'family'),
  ('c8000000-0000-4000-8000-000000000003', '合成家屬乙', 'family');

insert into public.memberships (
  id, organization_id, branch_id, profile_id, status
) values
  ('c8250000-0000-4000-8000-000000000001', 'c8100000-0000-4000-8000-000000000001', null, 'c8000000-0000-4000-8000-000000000002', 'active'),
  ('c8250000-0000-4000-8000-000000000002', 'c8100000-0000-4000-8000-000000000002', null, 'c8000000-0000-4000-8000-000000000003', 'active');

insert into public.membership_roles (membership_id, role_id) values
  ('c8250000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000010'),
  ('c8250000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000010');

insert into public.clients (
  id, organization_id, branch_id, client_code, display_name, status,
  admitted_on, source_system
) values
  ('c8300000-0000-4000-8000-000000000001', 'c8100000-0000-4000-8000-000000000001', 'c8200000-0000-4000-8000-000000000001', 'SYN-GOOD', '合成可讀個案', 'active', (now() at time zone 'Asia/Taipei')::date - 10, 'test'),
  ('c8300000-0000-4000-8000-000000000002', 'c8100000-0000-4000-8000-000000000001', 'c8200000-0000-4000-8000-000000000001', 'SYN-UNCONSUMED', '合成未消耗證據', 'active', (now() at time zone 'Asia/Taipei')::date - 10, 'test'),
  ('c8300000-0000-4000-8000-000000000003', 'c8100000-0000-4000-8000-000000000001', 'c8200000-0000-4000-8000-000000000001', 'SYN-LEGACY', '合成舊授權', 'active', (now() at time zone 'Asia/Taipei')::date - 10, 'test'),
  ('c8300000-0000-4000-8000-000000000004', 'c8100000-0000-4000-8000-000000000001', 'c8200000-0000-4000-8000-000000000001', 'SYN-EXPIRED', '合成過期授權', 'active', (now() at time zone 'Asia/Taipei')::date - 10, 'test'),
  ('c8300000-0000-4000-8000-000000000005', 'c8100000-0000-4000-8000-000000000001', 'c8200000-0000-4000-8000-000000000001', 'SYN-REVOKED', '合成撤回授權', 'active', (now() at time zone 'Asia/Taipei')::date - 10, 'test'),
  ('c8300000-0000-4000-8000-000000000006', 'c8100000-0000-4000-8000-000000000001', 'c8200000-0000-4000-8000-000000000001', 'SYN-RELATION', '合成關係不符', 'active', (now() at time zone 'Asia/Taipei')::date - 10, 'test'),
  ('c8300000-0000-4000-8000-000000000007', 'c8100000-0000-4000-8000-000000000001', 'c8200000-0000-4000-8000-000000000001', 'SYN-CARE-ONLY', '合成僅照顧授權', 'active', (now() at time zone 'Asia/Taipei')::date - 10, 'test'),
  ('c8300000-0000-4000-8000-000000000008', 'c8100000-0000-4000-8000-000000000002', 'c8200000-0000-4000-8000-000000000002', 'SYN-CROSS', '合成跨租戶個案', 'active', (now() at time zone 'Asia/Taipei')::date - 10, 'test');

insert into private.reauth_challenges (
  id, user_id, session_id, nonce_sha256, idempotency_key, issued_jwt_iat,
  issued_jwt_jti, created_at, expires_at, consumed_at, consumed_jwt_iat,
  consumed_jwt_jti, factor_method, factor_verified_at
) values (
  'c8400000-0000-4000-8000-000000000001',
  'c8000000-0000-4000-8000-000000000001',
  'c8410000-0000-4000-8000-000000000001', repeat('a', 64),
  'c8420000-0000-4000-8000-000000000001',
  clock_timestamp() - interval '2 minutes', 'synthetic-before',
  clock_timestamp() - interval '1 minute', clock_timestamp() + interval '4 minutes',
  clock_timestamp() - interval '30 seconds', clock_timestamp() - interval '30 seconds',
  'synthetic-after', 'totp', clock_timestamp() - interval '30 seconds'
);

create temporary table family_read_consent_fixture (
  evidence_id uuid primary key,
  consent_id uuid not null unique,
  registration_key uuid not null unique,
  grant_key uuid not null unique,
  client_id uuid not null,
  recipient_id uuid not null,
  evidence_relationship text not null,
  consent_relationship text not null,
  scopes text[] not null,
  verified_at timestamptz not null,
  consent_expires_at timestamptz,
  revoked_at timestamptz,
  evidence_hash text not null,
  consumed boolean not null
);

insert into family_read_consent_fixture values
  ('c8500000-0000-4000-8000-000000000001', 'c8600000-0000-4000-8000-000000000001', 'c8510000-0000-4000-8000-000000000001', 'c8610000-0000-4000-8000-000000000001', 'c8300000-0000-4000-8000-000000000001', 'c8000000-0000-4000-8000-000000000002', '女兒', '女兒', array['care.read', 'client.read'], clock_timestamp() - interval '1 minute', null, null, repeat('1', 64), true),
  ('c8500000-0000-4000-8000-000000000002', 'c8600000-0000-4000-8000-000000000002', 'c8510000-0000-4000-8000-000000000002', 'c8610000-0000-4000-8000-000000000002', 'c8300000-0000-4000-8000-000000000002', 'c8000000-0000-4000-8000-000000000002', '女兒', '女兒', array['client.read'], clock_timestamp() - interval '1 minute', null, null, repeat('2', 64), false),
  ('c8500000-0000-4000-8000-000000000004', 'c8600000-0000-4000-8000-000000000004', 'c8510000-0000-4000-8000-000000000004', 'c8610000-0000-4000-8000-000000000004', 'c8300000-0000-4000-8000-000000000004', 'c8000000-0000-4000-8000-000000000002', '女兒', '女兒', array['client.read'], clock_timestamp() - interval '2 days', clock_timestamp() - interval '1 day', null, repeat('4', 64), true),
  ('c8500000-0000-4000-8000-000000000005', 'c8600000-0000-4000-8000-000000000005', 'c8510000-0000-4000-8000-000000000005', 'c8610000-0000-4000-8000-000000000005', 'c8300000-0000-4000-8000-000000000005', 'c8000000-0000-4000-8000-000000000002', '女兒', '女兒', array['client.read'], clock_timestamp() - interval '1 minute', null, clock_timestamp() - interval '10 seconds', repeat('5', 64), true),
  ('c8500000-0000-4000-8000-000000000006', 'c8600000-0000-4000-8000-000000000006', 'c8510000-0000-4000-8000-000000000006', 'c8610000-0000-4000-8000-000000000006', 'c8300000-0000-4000-8000-000000000006', 'c8000000-0000-4000-8000-000000000002', '女兒', '其他', array['client.read'], clock_timestamp() - interval '1 minute', null, null, repeat('6', 64), true),
  ('c8500000-0000-4000-8000-000000000007', 'c8600000-0000-4000-8000-000000000007', 'c8510000-0000-4000-8000-000000000007', 'c8610000-0000-4000-8000-000000000007', 'c8300000-0000-4000-8000-000000000007', 'c8000000-0000-4000-8000-000000000002', '女兒', '女兒', array['care.read'], clock_timestamp() - interval '1 minute', null, null, repeat('7', 64), true),
  ('c8500000-0000-4000-8000-000000000008', 'c8600000-0000-4000-8000-000000000008', 'c8510000-0000-4000-8000-000000000008', 'c8610000-0000-4000-8000-000000000008', 'c8300000-0000-4000-8000-000000000008', 'c8000000-0000-4000-8000-000000000003', '兒子', '兒子', array['client.read'], clock_timestamp() - interval '1 minute', null, null, repeat('8', 64), true);

insert into private.family_consent_verification_evidence (
  id, organization_id, branch_id, client_id, recipient_user_id,
  relationship, scopes, document_version, consent_expires_at, evidence_hash,
  verification_method, verified_at, otp_verified_at,
  relationship_verified_at, explicit_consent_verified_at, expires_at,
  registration_idempotency_key, request_hash, created_at
)
select
  fixture.evidence_id,
  client.organization_id,
  client.branch_id,
  fixture.client_id,
  fixture.recipient_id,
  fixture.evidence_relationship,
  fixture.scopes,
  'governed-' || right(fixture.client_id::text, 4),
  fixture.consent_expires_at,
  fixture.evidence_hash,
  'phone_otp',
  fixture.verified_at,
  fixture.verified_at,
  fixture.verified_at,
  fixture.verified_at,
  fixture.verified_at + interval '10 minutes',
  fixture.registration_key,
  repeat('b', 64),
  fixture.verified_at
from family_read_consent_fixture fixture
join public.clients client on client.id = fixture.client_id;

insert into public.consents (
  id, organization_id, branch_id, client_id, recipient_user_id,
  relationship, scopes, document_version, consented_at, expires_at,
  revoked_at, evidence_hash, created_by, workflow_version,
  verification_evidence_id, grant_reauth_challenge_id,
  grant_idempotency_key, grant_request_hash
)
select
  fixture.consent_id,
  client.organization_id,
  client.branch_id,
  fixture.client_id,
  fixture.recipient_id,
  fixture.consent_relationship,
  fixture.scopes,
  'governed-' || right(fixture.client_id::text, 4),
  fixture.verified_at,
  fixture.consent_expires_at,
  fixture.revoked_at,
  fixture.evidence_hash,
  'c8000000-0000-4000-8000-000000000001',
  1,
  fixture.evidence_id,
  'c8400000-0000-4000-8000-000000000001',
  fixture.grant_key,
  repeat('c', 64)
from family_read_consent_fixture fixture
join public.clients client on client.id = fixture.client_id;

update private.family_consent_verification_evidence evidence
set
  consumed_at = fixture.verified_at + interval '1 minute',
  consumed_by = 'c8000000-0000-4000-8000-000000000001',
  consumed_consent_id = fixture.consent_id
from family_read_consent_fixture fixture
where evidence.id = fixture.evidence_id
  and fixture.consumed;

insert into public.consents (
  id, organization_id, branch_id, client_id, recipient_user_id,
  relationship, scopes, document_version, consented_at, evidence_hash
) values (
  'c8600000-0000-4000-8000-000000000003',
  'c8100000-0000-4000-8000-000000000001',
  'c8200000-0000-4000-8000-000000000001',
  'c8300000-0000-4000-8000-000000000003',
  'c8000000-0000-4000-8000-000000000002',
  '女兒', array['*'], 'legacy-wildcard',
  clock_timestamp() - interval '1 year', repeat('3', 64)
);

insert into public.care_records (
  id, organization_id, branch_id, client_id, record_key, version,
  previous_version_id, category, status, occurred_at, data, source_system,
  signed_at, signed_by, signature_purpose, content_hash, correction_reason,
  created_by
) values
  ('c8700000-0000-4000-8000-000000000001', 'c8100000-0000-4000-8000-000000000001', 'c8200000-0000-4000-8000-000000000001', 'c8300000-0000-4000-8000-000000000001', 'c8710000-0000-4000-8000-000000000001', 1, null, 'family_visible_summary', 'signed', clock_timestamp() - interval '2 hours', '{"synthetic":"not_returned"}'::jsonb, 'test', clock_timestamp() - interval '110 minutes', 'c8000000-0000-4000-8000-000000000001', '合成簽署', repeat('d', 64), null, 'c8000000-0000-4000-8000-000000000001'),
  ('c8700000-0000-4000-8000-000000000002', 'c8100000-0000-4000-8000-000000000001', 'c8200000-0000-4000-8000-000000000001', 'c8300000-0000-4000-8000-000000000001', 'c8710000-0000-4000-8000-000000000001', 2, 'c8700000-0000-4000-8000-000000000001', 'family_visible_summary', 'voided', clock_timestamp() - interval '2 hours', '{"synthetic":"not_returned"}'::jsonb, 'test', clock_timestamp() - interval '100 minutes', 'c8000000-0000-4000-8000-000000000001', '合成作廢', repeat('e', 64), '合成作廢原因', 'c8000000-0000-4000-8000-000000000001'),
  ('c8700000-0000-4000-8000-000000000003', 'c8100000-0000-4000-8000-000000000001', 'c8200000-0000-4000-8000-000000000001', 'c8300000-0000-4000-8000-000000000001', 'c8710000-0000-4000-8000-000000000002', 1, null, 'private_internal_note', 'signed', clock_timestamp() - interval '1 hour', '{"synthetic":"not_returned"}'::jsonb, 'test', clock_timestamp() - interval '50 minutes', 'c8000000-0000-4000-8000-000000000001', '合成簽署', repeat('f', 64), null, 'c8000000-0000-4000-8000-000000000001');

select is((select count(*)::integer from public.care_records where client_id = 'c8300000-0000-4000-8000-000000000001'), 3, 'fixture contains signed, later-voided, and internal care rows');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"c8000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1","session_id":"c8800000-0000-4000-8000-000000000002"}'::text,
  true
);

select results_eq(
  $$select client_id, display_name from public.family_client_summaries()$$,
  $$values ('c8300000-0000-4000-8000-000000000001'::uuid, '合成可讀個案'::text)$$,
  'family A sees only its exact current consumed-evidence client.read grant'
);

select is(private.can_read_client('c8300000-0000-4000-8000-000000000001', 'clients.read', 'client.read'), true, 'exact governed client.read scope authorizes its bound client');
select is(private.can_read_client('c8300000-0000-4000-8000-000000000001', 'clients.read', 'care.read'), true, 'exact governed care.read scope authorizes only the same client');
select is(private.can_read_client('c8300000-0000-4000-8000-000000000001', 'clients.read', 'billing.read'), false, 'an absent category scope is not inferred from another scope');
select is(private.can_read_client('c8300000-0000-4000-8000-000000000003', 'clients.read', 'client.read'), false, 'legacy wildcard consent never authorizes family reads');
select is(private.can_read_client('c8300000-0000-4000-8000-000000000002', 'clients.read', 'client.read'), false, 'unconsumed verification evidence never authorizes family reads');
select is(private.can_read_client('c8300000-0000-4000-8000-000000000004', 'clients.read', 'client.read'), false, 'expired governed consent is rejected at statement time');
select is(private.can_read_client('c8300000-0000-4000-8000-000000000005', 'clients.read', 'client.read'), false, 'revoked governed consent is rejected at statement time');
select is(private.can_read_client('c8300000-0000-4000-8000-000000000006', 'clients.read', 'client.read'), false, 'relationship drift between proof and consent is rejected');
select is(private.can_read_client('c8300000-0000-4000-8000-000000000007', 'clients.read', 'client.read'), false, 'care.read does not silently imply client.read');
select is(private.can_read_client('c8300000-0000-4000-8000-000000000008', 'clients.read', 'client.read'), false, 'another family recipient and tenant remain isolated');
select is((select count(*)::integer from public.family_care_summaries('c8300000-0000-4000-8000-000000000001')), 0, 'signed, later-voided, and arbitrary internal care metadata remain unavailable without publication approval');

select set_config(
  'request.jwt.claims',
  '{"sub":"c8000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal1","session_id":"c8800000-0000-4000-8000-000000000003"}'::text,
  true
);

select results_eq(
  $$select client_id from public.family_client_summaries()$$,
  $$values ('c8300000-0000-4000-8000-000000000008'::uuid)$$,
  'family B sees only its own governed cross-tenant client grant'
);
select is(private.can_read_client('c8300000-0000-4000-8000-000000000001', 'clients.read', 'client.read'), false, 'family B cannot probe family A client authorization');

reset role;
update public.consents
set revoked_at = clock_timestamp()
where id = 'c8600000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"c8000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1","session_id":"c8800000-0000-4000-8000-000000000002"}'::text,
  true
);

select is((select count(*)::integer from public.family_client_summaries()), 0, 'revocation removes the final visible client on the next statement');
select is(private.can_read_client('c8300000-0000-4000-8000-000000000001', 'clients.read', 'client.read'), false, 'revocation immediately closes the exact client predicate');

reset role;
set local role anon;
select throws_ok(
  $$select count(*) from public.family_client_summaries()$$,
  '42501', null,
  'anonymous callers cannot invoke the family projection'
);

reset role;
select * from finish();
rollback;
