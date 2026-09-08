begin;

select plan(68);

select ok(
  to_regclass('private.family_consent_verification_evidence') is not null
  and to_regclass('private.consent_revocation_operations') is not null
  and (
    select relation.relrowsecurity and relation.relforcerowsecurity
    from pg_class relation
    where relation.oid = 'private.family_consent_verification_evidence'::regclass
  )
  and (
    select relation.relrowsecurity and relation.relforcerowsecurity
    from pg_class relation
    where relation.oid = 'private.consent_revocation_operations'::regclass
  ),
  'verification and revocation evidence tables are private and force RLS'
);

select ok(
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'consents'
      and column_name = 'workflow_version' and is_nullable = 'YES'
  )
  and exists (
    select 1 from pg_constraint definition
    where definition.conrelid = 'public.consents'::regclass
      and definition.conname = 'consents_workflow_completeness_check'
  )
  and exists (
    select 1 from pg_constraint definition
    where definition.conrelid = 'public.consents'::regclass
      and definition.conname = 'consents_governed_content_check'
  ),
  'legacy consents remain explicitly nullable while workflow rows require complete governed evidence'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.register_family_consent_verification(uuid,uuid,uuid,uuid,text,text[],text,timestamptz,text,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.register_family_consent_verification(uuid,uuid,uuid,uuid,text,text[],text,timestamptz,text,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.register_family_consent_verification(uuid,uuid,uuid,uuid,text,text[],text,timestamptz,text,uuid)',
    'execute'
  )
  and not (
    select procedure.prosecdef from pg_proc procedure
    where procedure.oid =
      'public.register_family_consent_verification(uuid,uuid,uuid,uuid,text,text[],text,timestamptz,text,uuid)'::regprocedure
  ),
  'only the service role can call the public SECURITY INVOKER verification registrar'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.grant_family_consent(uuid,uuid,uuid,uuid,uuid,text,text[],text,timestamptz,text,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'public.grant_family_consent(uuid,uuid,uuid,uuid,uuid,text,text[],text,timestamptz,text,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.grant_family_consent(uuid,uuid,uuid,uuid,uuid,text,text[],text,timestamptz,text,uuid)',
    'execute'
  )
  and not (
    select procedure.prosecdef from pg_proc procedure
    where procedure.oid =
      'public.grant_family_consent(uuid,uuid,uuid,uuid,uuid,text,text[],text,timestamptz,text,uuid)'::regprocedure
  ),
  'grant is exposed only as an authenticated SECURITY INVOKER wrapper'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.revoke_family_consent(uuid,uuid,uuid,text,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'public.revoke_family_consent(uuid,uuid,uuid,text,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.revoke_family_consent(uuid,uuid,uuid,text,uuid)',
    'execute'
  )
  and not (
    select procedure.prosecdef from pg_proc procedure
    where procedure.oid =
      'public.revoke_family_consent(uuid,uuid,uuid,text,uuid)'::regprocedure
  ),
  'revocation is exposed only as an authenticated SECURITY INVOKER wrapper'
);

select ok(
  (
    select procedure.prosecdef
      and array_to_string(procedure.proconfig, ',') like 'search_path=%'
    from pg_proc procedure
    where procedure.oid =
      'private.register_family_consent_verification_atomic(uuid,uuid,uuid,uuid,text,text[],text,timestamptz,text,uuid)'::regprocedure
  )
  and (
    select procedure.prosecdef
      and array_to_string(procedure.proconfig, ',') like 'search_path=%'
    from pg_proc procedure
    where procedure.oid =
      'private.grant_family_consent_atomic(uuid,uuid,uuid,uuid,uuid,text,text[],text,timestamptz,text,uuid)'::regprocedure
  )
  and (
    select procedure.prosecdef
      and array_to_string(procedure.proconfig, ',') like 'search_path=%'
    from pg_proc procedure
    where procedure.oid =
      'private.revoke_family_consent_atomic(uuid,uuid,uuid,text,uuid)'::regprocedure
  )
  and not has_function_privilege(
    'anon',
    'private.grant_family_consent_atomic(uuid,uuid,uuid,uuid,uuid,text,text[],text,timestamptz,text,uuid)',
    'execute'
  ),
  'all privileged workflow cores are private SECURITY DEFINER functions with locked search paths and no PUBLIC execute'
);

select ok(
  not has_table_privilege('authenticated', 'public.consents', 'insert')
  and not has_table_privilege('authenticated', 'public.consents', 'update')
  and not has_table_privilege('authenticated', 'public.consents', 'delete')
  and not has_table_privilege('service_role', 'public.consents', 'insert')
  and not has_table_privilege('service_role', 'public.consents', 'update')
  and not has_table_privilege('service_role', 'public.consents', 'delete'),
  'authenticated and service roles cannot directly create, expand, revoke, restore, or delete consent rows'
);

select ok(
  not has_table_privilege('authenticated', 'private.family_consent_verification_evidence', 'select')
  and not has_table_privilege('authenticated', 'private.family_consent_verification_evidence', 'insert')
  and not has_table_privilege('service_role', 'private.family_consent_verification_evidence', 'select')
  and not has_table_privilege('service_role', 'private.family_consent_verification_evidence', 'insert')
  and not has_table_privilege('authenticated', 'private.consent_revocation_operations', 'select')
  and not has_table_privilege('service_role', 'private.consent_revocation_operations', 'insert'),
  'application roles cannot directly read or forge private proof and revocation ledgers'
);

select results_eq(
  $$select private.canonical_family_consent_scopes(
      array[' care.read ', 'CLIENT.READ', 'care.read', '', null]
    )$$,
  $$values (array['care.read', 'client.read']::text[])$$,
  'scope canonicalization trims, lowercases, de-duplicates, and sorts values'
);

select ok(
  exists (
    select 1 from pg_constraint definition
    where definition.conrelid = 'private.family_consent_verification_evidence'::regclass
      and definition.conname = 'family_consent_verification_evidence_hash_key'
      and definition.contype = 'u'
  )
  and exists (
    select 1 from pg_constraint definition
    where definition.conrelid = 'private.family_consent_verification_evidence'::regclass
      and definition.conname = 'family_consent_verification_evidence_consumption_check'
  )
  and not exists (
    select 1 from information_schema.columns
    where table_schema = 'private'
      and table_name = 'family_consent_verification_evidence'
      and column_name in ('otp', 'otp_code', 'verification_code', 'token', 'secret')
  ),
  'verification is one-time, evidence hashes cannot be reused, and no OTP or secret value is stored'
);

select ok(
  exists (
    select 1 from pg_constraint definition
    where definition.conrelid = 'private.consent_revocation_operations'::regclass
      and definition.conname = 'consent_revocation_operations_consent_scope_fkey'
      and definition.confdeltype = 'r'
  )
  and exists (
    select 1 from pg_class index_relation
    where index_relation.relname = 'consent_revocation_operations_consent_idx'
  )
  and exists (
    select 1 from pg_class index_relation
    where index_relation.relname = 'consents_grant_reauth_challenge_idx'
  ),
  'consent evidence uses scope-bound restrictive foreign keys with lookup indexes'
);

select ok(
  position(
    'pg_advisory_xact_lock' in pg_get_functiondef(
      'private.register_family_consent_verification_atomic(uuid,uuid,uuid,uuid,text,text[],text,timestamptz,text,uuid)'::regprocedure
    )
  ) > 0
  and position(
    'pg_advisory_xact_lock' in pg_get_functiondef(
      'private.grant_family_consent_atomic(uuid,uuid,uuid,uuid,uuid,text,text[],text,timestamptz,text,uuid)'::regprocedure
    )
  ) > 0
  and position(
    'pg_advisory_xact_lock' in pg_get_functiondef(
      'private.revoke_family_consent_atomic(uuid,uuid,uuid,text,uuid)'::regprocedure
    )
  ) > 0
  and position(
    'if found then' in pg_get_functiondef(
      'private.grant_family_consent_atomic(uuid,uuid,uuid,uuid,uuid,text,text[],text,timestamptz,text,uuid)'::regprocedure
    )
  ) < position(
    'has_recent_aal2' in pg_get_functiondef(
      'private.grant_family_consent_atomic(uuid,uuid,uuid,uuid,uuid,text,text[],text,timestamptz,text,uuid)'::regprocedure
    )
  ),
  'advisory locks make idempotency concurrency-safe and exact grant replay precedes mutable authorization checks'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'e1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'consent-manager@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e1000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'consent-stale@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e1000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'consent-no-permission@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e1000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'consent-family-a@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e1000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'consent-family-b@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());

insert into public.organizations (id, code, name) values
  ('e2000000-0000-4000-8000-000000000001', 'consent_org_a', '家屬授權測試機構 A'),
  ('e2000000-0000-4000-8000-000000000002', 'consent_org_b', '家屬授權測試機構 B');

insert into public.branches (id, organization_id, code, name) values
  ('e3000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001', 'main', '家屬授權 A 主分支'),
  ('e3000000-0000-4000-8000-000000000002', 'e2000000-0000-4000-8000-000000000002', 'main', '家屬授權 B 主分支');

insert into public.profiles (id, display_name, kind) values
  ('e1000000-0000-4000-8000-000000000001', '授權管理員', 'staff'),
  ('e1000000-0000-4000-8000-000000000002', '逾時管理員', 'staff'),
  ('e1000000-0000-4000-8000-000000000003', '無授權權限人員', 'staff'),
  ('e1000000-0000-4000-8000-000000000004', '家屬 A', 'family'),
  ('e1000000-0000-4000-8000-000000000005', '家屬 B', 'family');

insert into public.memberships (
  id, organization_id, branch_id, profile_id, status
) values
  ('e4000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001', null, 'e1000000-0000-4000-8000-000000000001', 'active'),
  ('e4000000-0000-4000-8000-000000000002', 'e2000000-0000-4000-8000-000000000002', null, 'e1000000-0000-4000-8000-000000000001', 'active'),
  ('e4000000-0000-4000-8000-000000000003', 'e2000000-0000-4000-8000-000000000001', null, 'e1000000-0000-4000-8000-000000000002', 'active'),
  ('e4000000-0000-4000-8000-000000000004', 'e2000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000003', 'active');

insert into public.membership_roles (membership_id, role_id) values
  ('e4000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002'),
  ('e4000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002'),
  ('e4000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002'),
  ('e4000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000006');

insert into public.clients (
  id, organization_id, branch_id, client_code, display_name, status,
  admitted_on, ended_on, source_system
) values
  ('e5000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000001', 'CONSENT-A-001', '授權個案 A', 'active', (now() at time zone 'Asia/Taipei')::date - 10, null, 'test'),
  ('e5000000-0000-4000-8000-000000000002', 'e2000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000001', 'CONSENT-A-002', '已結案個案 A', 'closed', (now() at time zone 'Asia/Taipei')::date - 20, (now() at time zone 'Asia/Taipei')::date - 1, 'test'),
  ('e5000000-0000-4000-8000-000000000003', 'e2000000-0000-4000-8000-000000000002', 'e3000000-0000-4000-8000-000000000002', 'CONSENT-B-001', '授權個案 B', 'active', (now() at time zone 'Asia/Taipei')::date - 10, null, 'test');

insert into private.reauth_challenges (
  id, user_id, session_id, nonce_sha256, idempotency_key, issued_jwt_iat,
  issued_jwt_jti, created_at, expires_at, consumed_at, consumed_jwt_iat,
  consumed_jwt_jti, factor_method, factor_verified_at
) values
  ('e6000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'e6100000-0000-4000-8000-000000000001', repeat('1', 64), 'e6200000-0000-4000-8000-000000000001', now() - interval '2 minutes', 'consent-manager-before', now() - interval '1 minute', now() + interval '4 minutes', now() - interval '30 seconds', now() - interval '30 seconds', 'consent-manager-after', 'totp', now() - interval '30 seconds'),
  ('e6000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000002', 'e6100000-0000-4000-8000-000000000002', repeat('2', 64), 'e6200000-0000-4000-8000-000000000002', now() - interval '25 minutes', 'consent-stale-before', now() - interval '24 minutes', now() - interval '15 minutes', now() - interval '20 minutes', now() - interval '20 minutes', 'consent-stale-after', 'totp', now() - interval '20 minutes'),
  ('e6000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-000000000003', 'e6100000-0000-4000-8000-000000000003', repeat('3', 64), 'e6200000-0000-4000-8000-000000000003', now() - interval '2 minutes', 'consent-worker-before', now() - interval '1 minute', now() + interval '4 minutes', now() - interval '30 seconds', now() - interval '30 seconds', 'consent-worker-after', 'totp', now() - interval '30 seconds');

insert into private.reauth_events (
  user_id, session_id, challenge_id, aal, verification_method, verified_at
) values
  ('e1000000-0000-4000-8000-000000000001', 'e6100000-0000-4000-8000-000000000001', 'e6000000-0000-4000-8000-000000000001', 'aal2', 'totp', now() - interval '30 seconds'),
  ('e1000000-0000-4000-8000-000000000002', 'e6100000-0000-4000-8000-000000000002', 'e6000000-0000-4000-8000-000000000002', 'aal2', 'totp', now() - interval '20 minutes'),
  ('e1000000-0000-4000-8000-000000000003', 'e6100000-0000-4000-8000-000000000003', 'e6000000-0000-4000-8000-000000000003', 'aal2', 'totp', now() - interval '30 seconds');

insert into public.consents (
  id, organization_id, branch_id, client_id, recipient_user_id, relationship,
  scopes, document_version, consented_at, evidence_hash
) values (
  'e6300000-0000-4000-8000-000000000001',
  'e2000000-0000-4000-8000-000000000002',
  'e3000000-0000-4000-8000-000000000002',
  'e5000000-0000-4000-8000-000000000003',
  'e1000000-0000-4000-8000-000000000005',
  '家屬', array['*'], 'legacy-v1', clock_timestamp() - interval '1 year',
  repeat('9', 64)
);

with evidence_time as (
  select clock_timestamp() - interval '20 minutes' as verified_at
)
insert into private.family_consent_verification_evidence (
  id, organization_id, branch_id, client_id, recipient_user_id,
  relationship, scopes, document_version, evidence_hash,
  verification_method, verified_at, otp_verified_at,
  relationship_verified_at, explicit_consent_verified_at, expires_at,
  registration_idempotency_key, request_hash, created_at
)
select
  'e7000000-0000-4000-8000-000000000099',
  'e2000000-0000-4000-8000-000000000001',
  'e3000000-0000-4000-8000-000000000001',
  'e5000000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000004',
  '女兒', array['client.read'], 'expired-v1', repeat('f', 64),
  'phone_otp', verified_at, verified_at, verified_at, verified_at,
  verified_at + interval '10 minutes',
  'e7100000-0000-4000-8000-000000000099', repeat('e', 64), verified_at
from evidence_time;

create temporary table consent_test_state (
  label text primary key,
  evidence_id uuid,
  consent_id uuid
);
grant select on consent_test_state to authenticated, service_role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"e1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"e6100000-0000-4000-8000-000000000001"}'::text,
  true
);

select throws_ok(
  $$select * from public.register_family_consent_verification(
      'e2000000-0000-4000-8000-000000000001',
      'e3000000-0000-4000-8000-000000000001',
      'e5000000-0000-4000-8000-000000000001',
      'e1000000-0000-4000-8000-000000000004',
      '女兒', array['client.read'], 'consent-v1', null,
      repeat('a', 64), 'e7100000-0000-4000-8000-000000000001'
    )$$,
  '42501', null,
  'an authenticated browser cannot register trusted family verification evidence'
);

reset role;
set local role service_role;
select set_config('request.jwt.claims', '{}'::text, true);

select results_eq(
  $$select verification_expires_at - verified_at, replayed
    from public.register_family_consent_verification(
      'e2000000-0000-4000-8000-000000000001',
      'e3000000-0000-4000-8000-000000000001',
      'e5000000-0000-4000-8000-000000000001',
      'e1000000-0000-4000-8000-000000000004',
      ' 女兒 ', array['care.read', 'CLIENT.READ', 'care.read'],
      ' consent-v1 ', null, upper(repeat('a', 64)),
      'e7100000-0000-4000-8000-000000000001'
    )$$,
  $$values (interval '10 minutes', false)$$,
  'the trusted server registers one ten-minute proof without a caller-authored verification time'
);

reset role;
select results_eq(
  $$select relationship, scopes, document_version, evidence_hash,
           verification_method, verified_at = otp_verified_at,
           verified_at = relationship_verified_at,
           verified_at = explicit_consent_verified_at,
           verified_at = created_at, consumed_at is null
    from private.family_consent_verification_evidence
    where registration_idempotency_key = 'e7100000-0000-4000-8000-000000000001'$$,
  $$values (
    '女兒'::text, array['care.read', 'client.read']::text[],
    'consent-v1'::text, repeat('a', 64), 'phone_otp'::text,
    true, true, true, true, true
  )$$,
  'verification stores canonical content and server timestamps but no OTP value'
);

set local role service_role;
select results_eq(
  $$select replayed
    from public.register_family_consent_verification(
      'e2000000-0000-4000-8000-000000000001',
      'e3000000-0000-4000-8000-000000000001',
      'e5000000-0000-4000-8000-000000000001',
      'e1000000-0000-4000-8000-000000000004',
      '女兒', array['client.read', 'care.read', 'CLIENT.READ'],
      'consent-v1', null, repeat('a', 64),
      'e7100000-0000-4000-8000-000000000001'
    )$$,
  $$values (true)$$,
  'scope order and duplicates do not change an exact semantic verification replay'
);

reset role;
select is(
  (
    select count(*)::integer
    from private.family_consent_verification_evidence
    where registration_idempotency_key = 'e7100000-0000-4000-8000-000000000001'
  ),
  1,
  'verification replay creates no duplicate proof'
);

set local role service_role;
select throws_ok(
  $$select * from public.register_family_consent_verification(
      'e2000000-0000-4000-8000-000000000001',
      'e3000000-0000-4000-8000-000000000001',
      'e5000000-0000-4000-8000-000000000001',
      'e1000000-0000-4000-8000-000000000004',
      '女兒', array['client.read'], 'consent-v1', null,
      repeat('a', 64), 'e7100000-0000-4000-8000-000000000001'
    )$$,
  '23505', 'family consent verification idempotency conflict',
  'a verification retry cannot silently reduce the consent scopes'
);

select throws_ok(
  $$select * from public.register_family_consent_verification(
      'e2000000-0000-4000-8000-000000000001',
      'e3000000-0000-4000-8000-000000000001',
      'e5000000-0000-4000-8000-000000000001',
      'e1000000-0000-4000-8000-000000000004',
      '女兒', array['care.read', 'client.read'], 'consent-v1', null,
      repeat('a', 64), 'e7100000-0000-4000-8000-000000000002'
    )$$,
  '23505', 'family consent evidence hash was already registered',
  'the same external evidence hash cannot be reused under another idempotency key'
);

select throws_ok(
  $$select * from public.register_family_consent_verification(
      'e2000000-0000-4000-8000-000000000002',
      'e3000000-0000-4000-8000-000000000002',
      'e5000000-0000-4000-8000-000000000003',
      'e1000000-0000-4000-8000-000000000005',
      '家屬', array['client.read'], 'legacy-reuse', null,
      repeat('9', 64), 'e7100000-0000-4000-8000-000000000008'
    )$$,
  '23505', 'family consent evidence hash was already registered',
  'a legacy consent evidence hash cannot be recycled into the governed workflow'
);

select throws_ok(
  $$select * from public.register_family_consent_verification(
      'e2000000-0000-4000-8000-000000000001',
      'e3000000-0000-4000-8000-000000000001',
      'e5000000-0000-4000-8000-000000000001',
      'e1000000-0000-4000-8000-000000000004',
      '女兒', array['*'], 'wildcard-v1', null,
      repeat('b', 64), 'e7100000-0000-4000-8000-000000000003'
    )$$,
  '22023', 'valid canonical family consent verification fields are required',
  'wildcard family consent is prohibited in the governed workflow'
);

select throws_ok(
  $$select * from public.register_family_consent_verification(
      'e2000000-0000-4000-8000-000000000001',
      'e3000000-0000-4000-8000-000000000001',
      'e5000000-0000-4000-8000-000000000001',
      'e1000000-0000-4000-8000-000000000004',
      '女兒', array['health.full'], 'invalid-v1', null,
      repeat('b', 64), 'e7100000-0000-4000-8000-000000000004'
    )$$,
  '22023', 'valid canonical family consent verification fields are required',
  'scopes outside the explicit family whitelist are rejected'
);

select throws_ok(
  $$insert into private.family_consent_verification_evidence (
      organization_id, branch_id, client_id, recipient_user_id,
      relationship, scopes, document_version, evidence_hash,
      verification_method, verified_at, otp_verified_at,
      relationship_verified_at, explicit_consent_verified_at, expires_at,
      registration_idempotency_key, request_hash, created_at
    ) values (
      'e2000000-0000-4000-8000-000000000001',
      'e3000000-0000-4000-8000-000000000001',
      'e5000000-0000-4000-8000-000000000001',
      'e1000000-0000-4000-8000-000000000004',
      '女兒', array['client.read'], 'forged-v1', repeat('b', 64),
      'phone_otp', now(), now(), now(), now(), now() + interval '10 minutes',
      'e7100000-0000-4000-8000-000000000005', repeat('b', 64), now()
    )$$,
  '42501', null,
  'the service role cannot bypass the registrar with a forged private proof row'
);

select results_eq(
  $$select replayed
    from public.register_family_consent_verification(
      'e2000000-0000-4000-8000-000000000001',
      'e3000000-0000-4000-8000-000000000001',
      'e5000000-0000-4000-8000-000000000001',
      'e1000000-0000-4000-8000-000000000004',
      '女兒', array['client.read', 'care.read', 'health.summary'],
      'consent-v2', null, repeat('b', 64),
      'e7100000-0000-4000-8000-000000000006'
    )$$,
  $$values (false)$$,
  'a distinct document version receives its own distinct unconsumed proof'
);

select results_eq(
  $$select replayed
    from public.register_family_consent_verification(
      'e2000000-0000-4000-8000-000000000001',
      'e3000000-0000-4000-8000-000000000001',
      'e5000000-0000-4000-8000-000000000002',
      'e1000000-0000-4000-8000-000000000004',
      '女兒', array['client.read'], 'closed-v1', null,
      repeat('c', 64), 'e7100000-0000-4000-8000-000000000007'
    )$$,
  $$values (false)$$,
  'trusted verification may be staged before the staff grant validates current client lifecycle'
);

reset role;
insert into consent_test_state (label, evidence_id)
select 'happy', id from private.family_consent_verification_evidence
where registration_idempotency_key = 'e7100000-0000-4000-8000-000000000001';
insert into consent_test_state (label, evidence_id)
select 'version2', id from private.family_consent_verification_evidence
where registration_idempotency_key = 'e7100000-0000-4000-8000-000000000006';
insert into consent_test_state (label, evidence_id)
select 'closed', id from private.family_consent_verification_evidence
where registration_idempotency_key = 'e7100000-0000-4000-8000-000000000007';
insert into consent_test_state (label, evidence_id)
values ('expired', 'e7000000-0000-4000-8000-000000000099');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"e1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1","session_id":"e6100000-0000-4000-8000-000000000001"}'::text,
  true
);

select throws_ok(
  $$select * from public.grant_family_consent(
      'e2000000-0000-4000-8000-000000000001',
      'e3000000-0000-4000-8000-000000000001',
      (select evidence_id from consent_test_state where label = 'happy'),
      'e5000000-0000-4000-8000-000000000001',
      'e1000000-0000-4000-8000-000000000004',
      '女兒', array['client.read', 'care.read'], 'consent-v1', null,
      repeat('a', 64), 'e7200000-0000-4000-8000-000000000001'
    )$$,
  '42501', 'family consent grant requires AAL2',
  'an AAL1 employee cannot consume family verification evidence'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"e1000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"e6100000-0000-4000-8000-000000000002"}'::text,
  true
);

select throws_ok(
  $$select * from public.grant_family_consent(
      'e2000000-0000-4000-8000-000000000001',
      'e3000000-0000-4000-8000-000000000001',
      (select evidence_id from consent_test_state where label = 'happy'),
      'e5000000-0000-4000-8000-000000000001',
      'e1000000-0000-4000-8000-000000000004',
      '女兒', array['client.read', 'care.read'], 'consent-v1', null,
      repeat('a', 64), 'e7200000-0000-4000-8000-000000000002'
    )$$,
  '42501', 'family consent grant is not permitted',
  'a stale AAL2 event cannot authorize a family consent grant'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"e1000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2","session_id":"e6100000-0000-4000-8000-000000000003"}'::text,
  true
);

select throws_ok(
  $$select * from public.grant_family_consent(
      'e2000000-0000-4000-8000-000000000001',
      'e3000000-0000-4000-8000-000000000001',
      (select evidence_id from consent_test_state where label = 'happy'),
      'e5000000-0000-4000-8000-000000000001',
      'e1000000-0000-4000-8000-000000000004',
      '女兒', array['client.read', 'care.read'], 'consent-v1', null,
      repeat('a', 64), 'e7200000-0000-4000-8000-000000000003'
    )$$,
  '42501', 'family consent grant is not permitted',
  'recent AAL2 cannot replace consents.manage permission'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"e1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"e6100000-0000-4000-8000-000000000001"}'::text,
  true
);

select throws_ok(
  $$select * from public.grant_family_consent(
      'e2000000-0000-4000-8000-000000000001',
      'e3000000-0000-4000-8000-000000000001',
      (select evidence_id from consent_test_state where label = 'happy'),
      'e5000000-0000-4000-8000-000000000001',
      'e1000000-0000-4000-8000-000000000004',
      '女兒', array['client.read'], 'consent-v1', null,
      repeat('a', 64), 'e7200000-0000-4000-8000-000000000004'
    )$$,
  '42501', 'family consent verification evidence does not match the grant',
  'staff cannot reduce or expand scopes beyond the exact verified content'
);

select throws_ok(
  $$select * from public.grant_family_consent(
      'e2000000-0000-4000-8000-000000000001',
      'e3000000-0000-4000-8000-000000000001',
      (select evidence_id from consent_test_state where label = 'happy'),
      'e5000000-0000-4000-8000-000000000001',
      'e1000000-0000-4000-8000-000000000005',
      '女兒', array['client.read', 'care.read'], 'consent-v1', null,
      repeat('a', 64), 'e7200000-0000-4000-8000-000000000005'
    )$$,
  '42501', 'family consent verification evidence does not match the grant',
  'verification for one family account cannot be retargeted to another recipient'
);

select throws_ok(
  $$select * from public.grant_family_consent(
      'e2000000-0000-4000-8000-000000000002',
      'e3000000-0000-4000-8000-000000000002',
      (select evidence_id from consent_test_state where label = 'happy'),
      'e5000000-0000-4000-8000-000000000001',
      'e1000000-0000-4000-8000-000000000004',
      '女兒', array['client.read', 'care.read'], 'consent-v1', null,
      repeat('a', 64), 'e7200000-0000-4000-8000-000000000006'
    )$$,
  '23514', 'family consent requires an active admitted and unended client',
  'selected organization and branch cannot be substituted around an evidence record'
);

select throws_ok(
  $$select * from public.grant_family_consent(
      'e2000000-0000-4000-8000-000000000001',
      'e3000000-0000-4000-8000-000000000001',
      (select evidence_id from consent_test_state where label = 'closed'),
      'e5000000-0000-4000-8000-000000000002',
      'e1000000-0000-4000-8000-000000000004',
      '女兒', array['client.read'], 'closed-v1', null,
      repeat('c', 64), 'e7200000-0000-4000-8000-000000000007'
    )$$,
  '23514', 'family consent requires an active admitted and unended client',
  'a closed client cannot receive a new family grant'
);

select throws_ok(
  $$select * from public.grant_family_consent(
      'e2000000-0000-4000-8000-000000000001',
      'e3000000-0000-4000-8000-000000000001',
      (select evidence_id from consent_test_state where label = 'expired'),
      'e5000000-0000-4000-8000-000000000001',
      'e1000000-0000-4000-8000-000000000004',
      '女兒', array['client.read'], 'expired-v1', null,
      repeat('f', 64), 'e7200000-0000-4000-8000-000000000008'
    )$$,
  '23514', 'family consent verification evidence expired',
  'verification evidence older than ten minutes cannot be consumed'
);

select results_eq(
  $$select document_version, scopes, consented_at is not null,
           expires_at is null, revoked_at is null, replayed
    from public.grant_family_consent(
      'e2000000-0000-4000-8000-000000000001',
      'e3000000-0000-4000-8000-000000000001',
      (select evidence_id from consent_test_state where label = 'happy'),
      'e5000000-0000-4000-8000-000000000001',
      'e1000000-0000-4000-8000-000000000004',
      ' 女兒 ', array['care.read', 'CLIENT.READ', 'care.read'],
      ' consent-v1 ', null, upper(repeat('a', 64)),
      'e7200000-0000-4000-8000-000000000009'
    )$$,
  $$values (
    'consent-v1'::text, array['care.read', 'client.read']::text[],
    true, true, true, false
  )$$,
  'an authorized recent-AAL2 manager consumes matching proof and appends one canonical grant'
);

reset role;
insert into consent_test_state (label, consent_id)
select 'consent1', id from public.consents
where grant_idempotency_key = 'e7200000-0000-4000-8000-000000000009';

select results_eq(
  $$select consent.organization_id, consent.branch_id, consent.client_id,
           consent.recipient_user_id, consent.relationship, consent.scopes,
           consent.document_version, consent.workflow_version,
           consent.verification_evidence_id = evidence.id,
           consent.grant_reauth_challenge_id,
           consent.grant_request_hash ~ '^[a-f0-9]{64}$',
           consent.consented_at = evidence.verified_at,
           consent.created_by, consent.supersedes_consent_id is null
    from public.consents consent
    join private.family_consent_verification_evidence evidence
      on evidence.id = consent.verification_evidence_id
    where consent.grant_idempotency_key = 'e7200000-0000-4000-8000-000000000009'$$,
  $$values (
    'e2000000-0000-4000-8000-000000000001'::uuid,
    'e3000000-0000-4000-8000-000000000001'::uuid,
    'e5000000-0000-4000-8000-000000000001'::uuid,
    'e1000000-0000-4000-8000-000000000004'::uuid,
    '女兒'::text, array['care.read', 'client.read']::text[],
    'consent-v1'::text, 1::smallint, true,
    'e6000000-0000-4000-8000-000000000001'::uuid, true, true,
    'e1000000-0000-4000-8000-000000000001'::uuid, true
  )$$,
  'the grant derives tenant, recipient, canonical content, immutable challenge, proof, and actor evidence'
);

select results_eq(
  $$select consumed_at is not null, consumed_by, consumed_consent_id,
           consumed_at <= expires_at
    from private.family_consent_verification_evidence
    where registration_idempotency_key = 'e7100000-0000-4000-8000-000000000001'$$,
  $$values (
    true,
    'e1000000-0000-4000-8000-000000000001'::uuid,
    (select consent_id from consent_test_state where label = 'consent1'),
    true
  )$$,
  'successful grant atomically consumes the one-time proof and binds the resulting consent'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"e1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"e6100000-0000-4000-8000-000000000001"}'::text,
  true
);

select results_eq(
  $$select document_version, scopes, replayed
    from public.grant_family_consent(
      'e2000000-0000-4000-8000-000000000001',
      'e3000000-0000-4000-8000-000000000001',
      (select evidence_id from consent_test_state where label = 'happy'),
      'e5000000-0000-4000-8000-000000000001',
      'e1000000-0000-4000-8000-000000000004',
      '女兒', array['client.read', 'care.read'], 'consent-v1', null,
      repeat('a', 64), 'e7200000-0000-4000-8000-000000000009'
    )$$,
  $$values ('consent-v1'::text, array['care.read', 'client.read']::text[], true)$$,
  'an exact committed grant replays even though its proof is now consumed'
);

select throws_ok(
  $$select * from public.grant_family_consent(
      'e2000000-0000-4000-8000-000000000001',
      'e3000000-0000-4000-8000-000000000001',
      (select evidence_id from consent_test_state where label = 'happy'),
      'e5000000-0000-4000-8000-000000000001',
      'e1000000-0000-4000-8000-000000000004',
      '母親', array['client.read', 'care.read'], 'consent-v1', null,
      repeat('a', 64), 'e7200000-0000-4000-8000-000000000009'
    )$$,
  '23505', 'family consent grant idempotency conflict',
  'a committed grant key cannot be replayed with changed relationship content'
);

select throws_ok(
  $$select * from public.grant_family_consent(
      'e2000000-0000-4000-8000-000000000001',
      'e3000000-0000-4000-8000-000000000001',
      (select evidence_id from consent_test_state where label = 'happy'),
      'e5000000-0000-4000-8000-000000000001',
      'e1000000-0000-4000-8000-000000000004',
      '女兒', array['client.read', 'care.read'], 'consent-v1', null,
      repeat('a', 64), 'e7200000-0000-4000-8000-000000000010'
    )$$,
  '23514', 'family consent verification evidence was already consumed',
  'consumed verification cannot create another consent under a new key'
);

select throws_ok(
  $$select * from public.grant_family_consent(
      'e2000000-0000-4000-8000-000000000001',
      'e3000000-0000-4000-8000-000000000001',
      (select evidence_id from consent_test_state where label = 'version2'),
      'e5000000-0000-4000-8000-000000000001',
      'e1000000-0000-4000-8000-000000000004',
      '女兒', array['client.read', 'care.read', 'health.summary'],
      'consent-v2', null, repeat('b', 64),
      'e7200000-0000-4000-8000-000000000011'
    )$$,
  '23505', 'existing family consent must be revoked before a new version',
  'scope expansion requires revocation and a new append-only version'
);

select throws_ok(
  $$insert into public.consents (
      organization_id, branch_id, client_id, recipient_user_id, relationship,
      scopes, document_version, consented_at, evidence_hash
    ) values (
      'e2000000-0000-4000-8000-000000000001',
      'e3000000-0000-4000-8000-000000000001',
      'e5000000-0000-4000-8000-000000000001',
      'e1000000-0000-4000-8000-000000000004',
      '女兒', array['*'], 'forged', now(), repeat('d', 64)
    )$$,
  '42501', null,
  'authenticated staff cannot forge a wildcard consent by direct insertion'
);

select throws_ok(
  $$update public.consents
    set scopes = array['client.read', 'billing.read']
    where id = (select consent_id from consent_test_state where label = 'consent1')$$,
  '42501', null,
  'authenticated staff cannot expand consent scopes in place'
);

select throws_ok(
  $$delete from public.consents
    where id = (select consent_id from consent_test_state where label = 'consent1')$$,
  '42501', null,
  'authenticated staff cannot delete consent history'
);

reset role;
set local role service_role;
select throws_ok(
  $$insert into public.consents (
      organization_id, branch_id, client_id, recipient_user_id, relationship,
      scopes, document_version, consented_at, evidence_hash
    ) values (
      'e2000000-0000-4000-8000-000000000001',
      'e3000000-0000-4000-8000-000000000001',
      'e5000000-0000-4000-8000-000000000001',
      'e1000000-0000-4000-8000-000000000004',
      '女兒', array['client.read'], 'service-forged', now(), repeat('d', 64)
    )$$,
  '42501', null,
  'service credentials cannot bypass verification with a direct consent insert'
);

select throws_ok(
  $$update public.consents set revoked_at = now()
    where id = (select consent_id from consent_test_state where label = 'consent1')$$,
  '42501', null,
  'service credentials cannot bypass the governed revocation operation'
);

select throws_ok(
  $$delete from public.consents
    where id = (select consent_id from consent_test_state where label = 'consent1')$$,
  '42501', null,
  'service credentials cannot delete consent history'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"e1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1","session_id":"e6100000-0000-4000-8000-000000000001"}'::text,
  true
);

select throws_ok(
  $$select * from public.revoke_family_consent(
      'e2000000-0000-4000-8000-000000000001',
      'e3000000-0000-4000-8000-000000000001',
      (select consent_id from consent_test_state where label = 'consent1'),
      '家屬要求撤銷', 'e7300000-0000-4000-8000-000000000001'
    )$$,
  '42501', 'family consent revocation requires AAL2',
  'AAL1 cannot revoke a family consent'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"e1000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"e6100000-0000-4000-8000-000000000002"}'::text,
  true
);

select throws_ok(
  $$select * from public.revoke_family_consent(
      'e2000000-0000-4000-8000-000000000001',
      'e3000000-0000-4000-8000-000000000001',
      (select consent_id from consent_test_state where label = 'consent1'),
      '家屬要求撤銷', 'e7300000-0000-4000-8000-000000000002'
    )$$,
  '42501', 'family consent revocation is not permitted',
  'stale AAL2 evidence cannot revoke a family consent'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"e1000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2","session_id":"e6100000-0000-4000-8000-000000000003"}'::text,
  true
);

select throws_ok(
  $$select * from public.revoke_family_consent(
      'e2000000-0000-4000-8000-000000000001',
      'e3000000-0000-4000-8000-000000000001',
      (select consent_id from consent_test_state where label = 'consent1'),
      '家屬要求撤銷', 'e7300000-0000-4000-8000-000000000003'
    )$$,
  '42501', 'family consent revocation is not permitted',
  'recent AAL2 without consents.manage cannot revoke a grant'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"e1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"e6100000-0000-4000-8000-000000000001"}'::text,
  true
);

select throws_ok(
  $$select * from public.revoke_family_consent(
      'e2000000-0000-4000-8000-000000000001',
      'e3000000-0000-4000-8000-000000000001',
      (select consent_id from consent_test_state where label = 'consent1'),
      '   ', 'e7300000-0000-4000-8000-000000000004'
    )$$,
  '22023', 'valid family consent revocation fields are required',
  'revocation requires a non-empty reason'
);

select results_eq(
  $$select consent_id = (select consent_id from consent_test_state where label = 'consent1'),
           revoked_at is not null, replayed
    from public.revoke_family_consent(
      'e2000000-0000-4000-8000-000000000001',
      'e3000000-0000-4000-8000-000000000001',
      (select consent_id from consent_test_state where label = 'consent1'),
      ' 家屬要求撤銷 ', 'e7300000-0000-4000-8000-000000000005'
    )$$,
  $$values (true, true, false)$$,
  'an authorized manager irreversibly revokes one exact consent at server time'
);

reset role;
select results_eq(
  $$select operation.organization_id, operation.branch_id,
           operation.client_id, operation.recipient_user_id,
           operation.actor_user_id, operation.reason,
           operation.request_hash ~ '^[a-f0-9]{64}$',
           operation.reauth_challenge_id, operation.revoked_at = operation.created_at,
           consent.revoked_at = operation.revoked_at
    from private.consent_revocation_operations operation
    join public.consents consent on consent.id = operation.consent_id
    where operation.idempotency_key = 'e7300000-0000-4000-8000-000000000005'$$,
  $$values (
    'e2000000-0000-4000-8000-000000000001'::uuid,
    'e3000000-0000-4000-8000-000000000001'::uuid,
    'e5000000-0000-4000-8000-000000000001'::uuid,
    'e1000000-0000-4000-8000-000000000004'::uuid,
    'e1000000-0000-4000-8000-000000000001'::uuid,
    '家屬要求撤銷'::text, true,
    'e6000000-0000-4000-8000-000000000001'::uuid,
    true, true
  )$$,
  'revocation ledger binds exact scope, recipient, actor, reason, challenge, request hash, and server time'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"e1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"e6100000-0000-4000-8000-000000000001"}'::text,
  true
);

select results_eq(
  $$select revoked_at is not null, replayed
    from public.revoke_family_consent(
      'e2000000-0000-4000-8000-000000000001',
      'e3000000-0000-4000-8000-000000000001',
      (select consent_id from consent_test_state where label = 'consent1'),
      '家屬要求撤銷', 'e7300000-0000-4000-8000-000000000005'
    )$$,
  $$values (true, true)$$,
  'an exact revocation retry returns the immutable original result'
);

select throws_ok(
  $$select * from public.revoke_family_consent(
      'e2000000-0000-4000-8000-000000000001',
      'e3000000-0000-4000-8000-000000000001',
      (select consent_id from consent_test_state where label = 'consent1'),
      '不同原因', 'e7300000-0000-4000-8000-000000000005'
    )$$,
  '23505', 'family consent revocation idempotency conflict',
  'a revocation key cannot be replayed with changed reason'
);

select throws_ok(
  $$select * from public.revoke_family_consent(
      'e2000000-0000-4000-8000-000000000001',
      'e3000000-0000-4000-8000-000000000001',
      (select consent_id from consent_test_state where label = 'consent1'),
      '再次撤銷', 'e7300000-0000-4000-8000-000000000006'
    )$$,
  '23514', 'family consent is already revoked',
  'a revoked consent cannot receive a second independent revocation'
);

reset role;
select throws_ok(
  $$update public.consents set revoked_at = null
    where id = (select consent_id from consent_test_state where label = 'consent1')$$,
  '55000', 'family consent versions are immutable and revocation is irreversible',
  'even the owner cannot restore a revoked consent'
);

select throws_ok(
  $$update public.consents set scopes = array['client.read']
    where id = (select consent_id from consent_test_state where label = 'consent1')$$,
  '55000', 'family consent versions are immutable and revocation is irreversible',
  'even the owner cannot rewrite scopes on a revoked version'
);

select throws_ok(
  $$delete from public.consents
    where id = (select consent_id from consent_test_state where label = 'consent1')$$,
  '55000', 'family consent history cannot be deleted',
  'even the owner cannot delete a revoked consent version'
);

select throws_ok(
  $$update private.consent_revocation_operations
    set reason = '竄改'
    where idempotency_key = 'e7300000-0000-4000-8000-000000000005'$$,
  '55000', 'consent revocation history is immutable',
  'revocation evidence rejects owner updates'
);

select throws_ok(
  $$delete from private.consent_revocation_operations
    where idempotency_key = 'e7300000-0000-4000-8000-000000000005'$$,
  '55000', 'consent revocation history is immutable',
  'revocation evidence rejects owner deletes'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"e1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"e6100000-0000-4000-8000-000000000001"}'::text,
  true
);

select results_eq(
  $$select document_version, scopes,
           revoked_at is null, replayed
    from public.grant_family_consent(
      'e2000000-0000-4000-8000-000000000001',
      'e3000000-0000-4000-8000-000000000001',
      (select evidence_id from consent_test_state where label = 'version2'),
      'e5000000-0000-4000-8000-000000000001',
      'e1000000-0000-4000-8000-000000000004',
      '女兒', array['health.summary', 'care.read', 'client.read'],
      'consent-v2', null, repeat('b', 64),
      'e7200000-0000-4000-8000-000000000011'
    )$$,
  $$values (
    'consent-v2'::text,
    array['care.read', 'client.read', 'health.summary']::text[],
    true, false
  )$$,
  'after revocation, newly verified expanded scopes append as a new document version'
);

reset role;
insert into consent_test_state (label, consent_id)
select 'consent2', id from public.consents
where grant_idempotency_key = 'e7200000-0000-4000-8000-000000000011';

select results_eq(
  $$select workflow_version, supersedes_consent_id,
           verification_evidence_id = (
             select evidence_id from consent_test_state where label = 'version2'
           ), revoked_at is null
    from public.consents
    where id = (select consent_id from consent_test_state where label = 'consent2')$$,
  $$values (
    1::smallint,
    (select consent_id from consent_test_state where label = 'consent1'),
    true, true
  )$$,
  'the new immutable grant links its previous revoked version and distinct consumed proof'
);

select ok(
  exists (
    select 1 from public.audit_events event
    where event.table_name = 'public.consents'
      and event.action in ('insert', 'update')
      and event.organization_id = 'e2000000-0000-4000-8000-000000000001'
      and event.actor_user_id = 'e1000000-0000-4000-8000-000000000001'
  )
  and exists (
    select 1 from public.audit_events event
    where event.table_name = 'private.family_consent_verification_evidence'
      and event.action = 'update'
      and event.actor_user_id = 'e1000000-0000-4000-8000-000000000001'
  )
  and exists (
    select 1 from public.audit_events event
    where event.table_name = 'private.consent_revocation_operations'
      and event.action = 'insert'
      and event.actor_user_id = 'e1000000-0000-4000-8000-000000000001'
  ),
  'grant, proof consumption, consent revocation, and immutable evidence are fully audited'
);

select results_eq(
  $$select workflow_version is null, verification_evidence_id is null,
           grant_reauth_challenge_id is null, scopes
    from public.consents where id = 'e6300000-0000-4000-8000-000000000001'$$,
  $$values (true, true, true, array['*']::text[])$$,
  'legacy rows remain explicitly identifiable without pretending they satisfy the new evidence workflow'
);

select throws_ok(
  $$update public.consents set scopes = array['client.read']
    where id = 'e6300000-0000-4000-8000-000000000001'$$,
  '55000', 'family consent versions are immutable and revocation is irreversible',
  'legacy consent content is also frozen against in-place modernization'
);

update public.memberships
set status = 'ended'
where id = 'e4000000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"e1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"e6100000-0000-4000-8000-000000000001"}'::text,
  true
);

select results_eq(
  $$select document_version, revoked_at is not null, replayed
    from public.grant_family_consent(
      'e2000000-0000-4000-8000-000000000001',
      'e3000000-0000-4000-8000-000000000001',
      (select evidence_id from consent_test_state where label = 'happy'),
      'e5000000-0000-4000-8000-000000000001',
      'e1000000-0000-4000-8000-000000000004',
      '女兒', array['client.read', 'care.read'], 'consent-v1', null,
      repeat('a', 64), 'e7200000-0000-4000-8000-000000000009'
    )$$,
  $$values ('consent-v1'::text, true, true)$$,
  'an exact committed grant remains replayable after staff membership changes'
);

select results_eq(
  $$select revoked_at is not null, replayed
    from public.revoke_family_consent(
      'e2000000-0000-4000-8000-000000000001',
      'e3000000-0000-4000-8000-000000000001',
      (select consent_id from consent_test_state where label = 'consent1'),
      '家屬要求撤銷', 'e7300000-0000-4000-8000-000000000005'
    )$$,
  $$values (true, true)$$,
  'an exact committed revocation remains replayable after staff membership changes'
);

select throws_ok(
  $$select * from public.revoke_family_consent(
      'e2000000-0000-4000-8000-000000000001',
      'e3000000-0000-4000-8000-000000000001',
      (select consent_id from consent_test_state where label = 'consent2'),
      '新撤銷要求', 'e7300000-0000-4000-8000-000000000007'
    )$$,
  '42501', 'family consent revocation is not permitted',
  'ended staff membership cannot authorize a new revocation'
);

select * from finish();
rollback;
