begin;

select plan(32);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '30000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'manager@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '30000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'family@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '30000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'supervisor@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '30000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'target@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());

insert into public.organizations (id, code, name) values
  ('31000000-0000-4000-8000-000000000001', 'rls_org_a', 'RLS 測試機構 A'),
  ('31000000-0000-4000-8000-000000000002', 'rls_org_b', 'RLS 測試機構 B');

insert into public.branches (id, organization_id, code, name) values
  ('32000000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000001', 'main', 'A 分支'),
  ('32000000-0000-4000-8000-000000000002', '31000000-0000-4000-8000-000000000002', 'main', 'B 分支');

insert into public.profiles (id, display_name, kind) values
  ('30000000-0000-4000-8000-000000000001', '測試主管', 'staff'),
  ('30000000-0000-4000-8000-000000000002', '測試家屬', 'family'),
  ('30000000-0000-4000-8000-000000000003', '測試分支主管', 'staff'),
  ('30000000-0000-4000-8000-000000000004', '待指派人員', 'staff');

insert into public.memberships (id, organization_id, branch_id, profile_id, status) values
  ('33000000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000001', null, '30000000-0000-4000-8000-000000000001', 'active'),
  ('33000000-0000-4000-8000-000000000002', '31000000-0000-4000-8000-000000000002', null, '30000000-0000-4000-8000-000000000002', 'active'),
  ('33000000-0000-4000-8000-000000000003', '31000000-0000-4000-8000-000000000001', '32000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000003', 'active'),
  ('33000000-0000-4000-8000-000000000004', '31000000-0000-4000-8000-000000000001', '32000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000004', 'active');

insert into public.membership_roles (membership_id, role_id) values
  ('33000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002'),
  ('33000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000010'),
  ('33000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000003');

insert into public.clients (id, organization_id, branch_id, client_code, display_name, source_system) values
  ('34000000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000001', '32000000-0000-4000-8000-000000000001', 'RLS-A-001', 'RLS 範例 A', 'test'),
  ('34000000-0000-4000-8000-000000000002', '31000000-0000-4000-8000-000000000002', '32000000-0000-4000-8000-000000000002', 'RLS-B-001', 'RLS 範例 B', 'test');

insert into public.consents (
  id, organization_id, branch_id, client_id, recipient_user_id, relationship,
  scopes, document_version, consented_at, evidence_hash
) values (
  '34100000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000002',
  '32000000-0000-4000-8000-000000000002', '34000000-0000-4000-8000-000000000002',
  '30000000-0000-4000-8000-000000000002', '家屬', array['client.read', 'care.read'],
  'family-consent-v1', clock_timestamp() - interval '1 day', repeat('a', 64)
);

insert into public.care_records (
  id, organization_id, branch_id, client_id, record_key, version, category,
  status, occurred_at, data, signed_at, signed_by, signature_purpose,
  content_hash, created_by
) values (
  '34200000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000002',
  '32000000-0000-4000-8000-000000000002', '34000000-0000-4000-8000-000000000002',
  '34210000-0000-4000-8000-000000000001', 1, 'family_visible_summary', 'signed',
  clock_timestamp() - interval '1 hour', '{"private_note":"must never reach family RPC"}'::jsonb,
  clock_timestamp() - interval '50 minutes', '30000000-0000-4000-8000-000000000001',
  '測試簽署', repeat('b', 64), '30000000-0000-4000-8000-000000000001'
);

insert into public.notifications (
  id, organization_id, branch_id, category, title, body, audience, status, created_by
) values (
  '34300000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000002',
  '32000000-0000-4000-8000-000000000002', 'family', '受限通知',
  '通知底表內容不可直接讀取', '{"kind":"direct"}'::jsonb, 'sent',
  '30000000-0000-4000-8000-000000000001'
);

insert into public.notification_deliveries (
  id, organization_id, branch_id, notification_id, recipient_user_id,
  channel, status, idempotency_key
) values (
  '34400000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000002',
  '32000000-0000-4000-8000-000000000002', '34300000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000002', 'pwa', 'delivered',
  '34410000-0000-4000-8000-000000000001'
);

-- A valid recent event lets the escalation tests isolate branch scope.
insert into private.reauth_challenges (
  id, user_id, session_id, nonce_sha256, idempotency_key, issued_jwt_iat,
  issued_jwt_jti, created_at, expires_at, consumed_at, consumed_jwt_iat,
  consumed_jwt_jti, factor_method, factor_verified_at
) values (
  '34500000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000003',
  '35000000-0000-4000-8000-000000000003', repeat('c', 64),
  '34510000-0000-4000-8000-000000000001', clock_timestamp() - interval '2 minutes',
  'supervisor-before-stepup', clock_timestamp() - interval '1 minute',
  clock_timestamp() + interval '4 minutes', clock_timestamp() - interval '30 seconds',
  clock_timestamp() - interval '30 seconds', 'supervisor-after-stepup', 'totp',
  clock_timestamp() - interval '30 seconds'
);

insert into private.reauth_events (
  user_id, session_id, challenge_id, aal, verification_method, verified_at
) values (
  '30000000-0000-4000-8000-000000000003', '35000000-0000-4000-8000-000000000003',
  '34500000-0000-4000-8000-000000000001', 'aal2', 'totp',
  clock_timestamp() - interval '30 seconds'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '30000000-0000-4000-8000-000000000001', 'role', 'authenticated',
    'aal', 'aal2', 'session_id', '35000000-0000-4000-8000-000000000001',
    'iat', extract(epoch from clock_timestamp() - interval '10 minutes')::bigint,
    'jti', 'manager-before-stepup',
    'amr', jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from clock_timestamp() - interval '10 minutes')::bigint))
  )::text,
  true
);

select is((select count(*)::integer from public.organizations), 1, 'organization manager sees only their organization');
select is(
  (select count(*)::integer from public.client_directory_snapshot(
    '31000000-0000-4000-8000-000000000001',
    '32000000-0000-4000-8000-000000000001',
    'case_center', 200, null, null, null
  )),
  1,
  'AAL2 organization manager receives tenant clients only through the audited directory'
);

reset role;
set local role service_role;
select is(
  (select replayed from public.issue_aal2_reauth_challenge(
    '34600000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    '35000000-0000-4000-8000-000000000001', repeat('d', 64),
    '34610000-0000-4000-8000-000000000001',
    clock_timestamp() - interval '10 minutes', 'manager-before-stepup', 300
  )),
  false,
  'trusted server issues a single-use reauthentication challenge'
);

select is(
  (select replayed from public.issue_aal2_reauth_challenge(
    '34600000-0000-4000-8000-000000000002',
    '30000000-0000-4000-8000-000000000001',
    '35000000-0000-4000-8000-000000000001', repeat('1', 64),
    '34610000-0000-4000-8000-000000000002',
    clock_timestamp() - interval '10 minutes', 'manager-before-stepup', 300
  )),
  false,
  'a newly issued challenge supersedes the prior pending challenge'
);

select ok(
  (select count(*) from private.reauth_challenges
   where user_id = '30000000-0000-4000-8000-000000000001'
     and session_id = '35000000-0000-4000-8000-000000000001'
     and consumed_at is null
     and invalidated_at is null) = 1
  and (select invalidated_at is not null from private.reauth_challenges
       where id = '34600000-0000-4000-8000-000000000001'),
  'only one pending challenge remains usable per user and session'
);

reset role;
set local role authenticated;
select is(
  public.record_aal2_reauth('34600000-0000-4000-8000-000000000002', repeat('1', 64)),
  false,
  'an old AAL2 token cannot consume a newly issued challenge'
);

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '30000000-0000-4000-8000-000000000001', 'role', 'authenticated',
    'aal', 'aal2', 'session_id', '35000000-0000-4000-8000-000000000001',
    'iat', extract(epoch from clock_timestamp())::bigint, 'jti', 'manager-after-stepup',
    'amr', jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from clock_timestamp())::bigint))
  )::text,
  true
);

select ok(
  public.record_aal2_reauth('34600000-0000-4000-8000-000000000002', repeat('1', 64)),
  'a new factor timestamp and refreshed JWT consume the challenge'
);
select is(
  public.record_aal2_reauth('34600000-0000-4000-8000-000000000002', repeat('1', 64)),
  false,
  'a consumed reauthentication challenge cannot be replayed'
);
select ok(public.has_recent_aal2(15), 'same session has recent challenge-backed AAL2 evidence');

select results_eq(
  $$select organization_id, branch_id, display_name, user_id from public.active_memberships$$,
  $$values ('31000000-0000-4000-8000-000000000001'::uuid, null::uuid, '測試主管'::text, '30000000-0000-4000-8000-000000000001'::uuid)$$,
  'active_memberships returns only the current user tenant context'
);
select throws_ok(
  $$select count(*) from private.reauth_challenges$$,
  '42501', null, 'authenticated cannot read private reauthentication challenges'
);
select results_eq(
  $$update public.branches set name = 'A 分支已覆核' where id = '32000000-0000-4000-8000-000000000001' returning name$$,
  $$values ('A 分支已覆核'::text)$$,
  'recent challenge-backed AAL2 permits an authorized high-risk update'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"30000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1","session_id":"35000000-0000-4000-8000-000000000002","amr":[{"method":"phone"}]}'::text,
  true
);
select throws_ok(
  $$select count(*) from public.clients$$,
  '42501', null,
  'family has no privilege to select full client base rows even with consent'
);
select is((select count(*)::integer from public.care_records), 0, 'family cannot select care payload base rows even with consent');
select is((select count(*)::integer from public.family_client_summaries()), 0, 'legacy wildcard consent does not authorize a family client summary');
select is((select count(*)::integer from public.family_care_summaries('34000000-0000-4000-8000-000000000002')), 0, 'care metadata remains unavailable until an explicit publication boundary exists');
select is((select count(*)::integer from public.notifications), 0, 'family cannot read notification base content');
select is((select count(*)::integer from public.notification_deliveries), 1, 'family sees only their recipient delivery row');
select throws_ok(
  $$insert into public.sync_operations (organization_id, branch_id, user_id, device_id, idempotency_key, entity_type, occurred_at, payload_hash)
    values ('31000000-0000-4000-8000-000000000002', '32000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', 'family-device', '34700000-0000-4000-8000-000000000001', 'care_record', clock_timestamp(), repeat('e', 64))$$,
  '42501', null, 'family cannot use staff offline synchronization'
);
select is(public.has_recent_aal2(15), false, 'AAL2 evidence is session and user specific');
select throws_ok(
  $$insert into public.clients (organization_id, branch_id, client_code, display_name, source_system)
    values ('31000000-0000-4000-8000-000000000001', '32000000-0000-4000-8000-000000000001', 'CROSS-TENANT', '禁止寫入', 'test')$$,
  '42501', null, 'cross-tenant insert is rejected by RLS'
);

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '30000000-0000-4000-8000-000000000003', 'role', 'authenticated',
    'aal', 'aal2', 'session_id', '35000000-0000-4000-8000-000000000003',
    'iat', extract(epoch from clock_timestamp())::bigint, 'jti', 'supervisor-after-stepup',
    'amr', jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from clock_timestamp() - interval '30 seconds')::bigint))
  )::text,
  true
);
select is(private.has_permission('31000000-0000-4000-8000-000000000001', null, 'memberships.manage'), false, 'branch-scoped membership cannot satisfy organization-level permission checks');
select ok(private.has_permission('31000000-0000-4000-8000-000000000001', '32000000-0000-4000-8000-000000000001', 'memberships.manage'), 'branch supervisor retains permission inside their own branch');
select throws_ok(
  $$insert into public.memberships (id, organization_id, branch_id, profile_id, status)
    values ('33000000-0000-4000-8000-000000000005', '31000000-0000-4000-8000-000000000001', null, '30000000-0000-4000-8000-000000000004', 'active')$$,
  '42501', null, 'branch supervisor cannot create an organization-wide membership'
);
select throws_ok(
  $$insert into public.membership_roles (membership_id, role_id, assigned_by)
    values ('33000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000006', '30000000-0000-4000-8000-000000000003')$$,
  '42501', null, 'branch supervisor cannot assign a system role'
);
select is((select count(*)::integer from public.organizations), 0, 'branch-scoped identity cannot read organization-level rows');

reset role;
update private.reauth_events
set verified_at = clock_timestamp() - interval '16 minutes'
where user_id = '30000000-0000-4000-8000-000000000001'
  and session_id = '35000000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '30000000-0000-4000-8000-000000000001', 'role', 'authenticated',
    'aal', 'aal2', 'session_id', '35000000-0000-4000-8000-000000000001',
    'iat', extract(epoch from clock_timestamp())::bigint, 'jti', 'manager-after-stepup',
    'amr', jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from clock_timestamp())::bigint))
  )::text,
  true
);
select is(public.has_recent_aal2(15), false, 'challenge-backed AAL2 evidence expires after fifteen minutes');

select set_config(
  'request.jwt.claims',
  '{"sub":"30000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1","session_id":"35000000-0000-4000-8000-000000000001","amr":[{"method":"password"}]}'::text,
  true
);
select throws_ok(
  $$select count(*) from public.clients$$,
  '42501', null,
  'AAL1 employee has no privilege to read client base rows through the Data API'
);
select is((select count(*)::integer from public.active_memberships), 0, 'AAL1 employee cannot obtain tenant context through the Data API');
select throws_ok(
  $$insert into public.sync_operations (organization_id, branch_id, user_id, device_id, idempotency_key, entity_type, occurred_at, payload_hash)
    values ('31000000-0000-4000-8000-000000000001', '32000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'manager-device', '34700000-0000-4000-8000-000000000002', 'care_record', clock_timestamp(), repeat('f', 64))$$,
  '42501', null, 'AAL1 employee cannot write offline synchronization operations'
);
select is(
  public.record_aal2_reauth('34600000-0000-4000-8000-000000000002', repeat('1', 64)),
  false,
  'AAL1 JWT cannot mint or refresh AAL2 evidence'
);

reset role;
set local role anon;
select throws_ok($$select count(*) from public.organizations$$, '42501', null, 'anon has no tenant table access');

reset role;
select * from finish();
rollback;
