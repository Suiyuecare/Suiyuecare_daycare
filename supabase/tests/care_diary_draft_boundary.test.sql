begin;

select plan(25);

select ok(
  has_function_privilege(
    'authenticated',
    'public.record_care_diary_draft(uuid,uuid,uuid,timestamptz,text,text,text,boolean,text,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.record_care_diary_draft(uuid,uuid,uuid,timestamptz,text,text,text,boolean,text,uuid)',
    'execute'
  )
  and not (
    select procedure.prosecdef
    from pg_proc procedure
    where procedure.oid =
      'public.record_care_diary_draft(uuid,uuid,uuid,timestamptz,text,text,text,boolean,text,uuid)'::regprocedure
  ),
  'the public care-diary writer is an authenticated-only SECURITY INVOKER wrapper'
);

select is(
  pg_get_function_identity_arguments(
    'public.record_care_diary_draft(uuid,uuid,uuid,timestamptz,text,text,text,boolean,text,uuid)'::regprocedure
  ),
  'p_expected_organization_id uuid, p_expected_branch_id uuid, p_client_id uuid, p_occurred_at timestamp with time zone, p_shift text, p_care_item text, p_note text, p_abnormal boolean, p_follow_up text, p_idempotency_key uuid',
  'the care-diary RPC requires the trusted current organization and branch context'
);

select ok(
  (
    select procedure.prosecdef
    from pg_proc procedure
    where procedure.oid =
      'private.record_care_diary_draft_atomic(uuid,uuid,uuid,timestamptz,text,text,text,boolean,text,uuid)'::regprocedure
  )
  and has_function_privilege(
    'authenticated',
    'private.record_care_diary_draft_atomic(uuid,uuid,uuid,timestamptz,text,text,text,boolean,text,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'private.record_care_diary_draft_atomic(uuid,uuid,uuid,timestamptz,text,text,text,boolean,text,uuid)',
    'execute'
  ),
  'the private transaction definer validates authenticated callers itself'
);

select ok(
  not has_table_privilege('authenticated', 'public.care_records', 'insert')
  and not has_table_privilege('authenticated', 'public.care_records', 'update')
  and not has_table_privilege('authenticated', 'public.care_records', 'delete'),
  'authenticated callers cannot forge drafts, signatures, corrections, or authorship with direct DML'
);

select ok(
  (
    select
      position('if found then' in function_definition)
        < position('from public.clients client' in function_definition)
      and position('return;' in function_definition)
        < position('from public.clients client' in function_definition)
      and position('from public.clients client' in function_definition)
        < position('v_now := clock_timestamp()' in function_definition)
      and position('v_now := clock_timestamp()' in function_definition)
        < position('outside the allowed 24-hour draft window' in function_definition)
    from (
      select pg_get_functiondef(
        'private.record_care_diary_draft_atomic(uuid,uuid,uuid,timestamptz,text,text,text,boolean,text,uuid)'::regprocedure
      ) as function_definition
    ) definition
  ),
  'exact replay precedes mutable lifecycle checks and new writes use a post-lock clock'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '81000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'diary-a@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '81000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'diary-no-permission@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());

insert into public.organizations (id, code, name) values
  ('82000000-0000-4000-8000-000000000001', 'diary_org_a', '照顧日誌測試機構 A'),
  ('82000000-0000-4000-8000-000000000002', 'diary_org_b', '照顧日誌測試機構 B');

insert into public.branches (id, organization_id, code, name) values
  ('83000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001', 'main', '照顧日誌 A 主分支'),
  ('83000000-0000-4000-8000-000000000002', '82000000-0000-4000-8000-000000000002', 'main', '照顧日誌 B 主分支');

insert into public.profiles (id, display_name, kind) values
  ('81000000-0000-4000-8000-000000000001', '照顧日誌人員', 'staff'),
  ('81000000-0000-4000-8000-000000000002', '無照顧權限人員', 'staff');

insert into public.memberships (
  id, organization_id, branch_id, profile_id, status
) values
  ('84000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001', null, '81000000-0000-4000-8000-000000000001', 'active'),
  ('84000000-0000-4000-8000-000000000002', '82000000-0000-4000-8000-000000000002', null, '81000000-0000-4000-8000-000000000001', 'active'),
  ('84000000-0000-4000-8000-000000000003', '82000000-0000-4000-8000-000000000001', null, '81000000-0000-4000-8000-000000000002', 'active');

insert into public.membership_roles (membership_id, role_id) values
  ('84000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002'),
  ('84000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002');

insert into private.reauth_challenges (
  id, user_id, session_id, nonce_sha256, idempotency_key, issued_jwt_iat,
  issued_jwt_jti, created_at, expires_at, consumed_at, consumed_jwt_iat,
  consumed_jwt_jti, factor_method, factor_verified_at
) values (
  '84100000-0000-4000-8000-000000000001',
  '81000000-0000-4000-8000-000000000001',
  '84200000-0000-4000-8000-000000000001', repeat('d', 64),
  '84300000-0000-4000-8000-000000000001', clock_timestamp() - interval '2 minutes',
  'diary-before-stepup', clock_timestamp() - interval '1 minute',
  clock_timestamp() + interval '4 minutes', clock_timestamp() - interval '30 seconds',
  clock_timestamp() - interval '30 seconds', 'diary-after-stepup', 'totp',
  clock_timestamp() - interval '30 seconds'
);

insert into private.reauth_events (
  user_id, session_id, challenge_id, aal, verification_method, verified_at
) values (
  '81000000-0000-4000-8000-000000000001',
  '84200000-0000-4000-8000-000000000001',
  '84100000-0000-4000-8000-000000000001', 'aal2', 'totp',
  clock_timestamp() - interval '30 seconds'
);

insert into public.clients (
  id, organization_id, branch_id, client_code, display_name, status,
  admitted_on, ended_on, source_system
) values
  ('85000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001', '83000000-0000-4000-8000-000000000001', 'DIARY-A-001', '照顧日誌個案 A1', 'active', (now() at time zone 'Asia/Taipei')::date - 10, null, 'test'),
  ('85000000-0000-4000-8000-000000000002', '82000000-0000-4000-8000-000000000001', '83000000-0000-4000-8000-000000000001', 'DIARY-A-002', '照顧日誌結案個案', 'closed', (now() at time zone 'Asia/Taipei')::date - 10, (now() at time zone 'Asia/Taipei')::date - 1, 'test'),
  ('85000000-0000-4000-8000-000000000003', '82000000-0000-4000-8000-000000000002', '83000000-0000-4000-8000-000000000002', 'DIARY-B-001', '照顧日誌個案 B1', 'active', (now() at time zone 'Asia/Taipei')::date - 10, null, 'test');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"81000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1","session_id":"84200000-0000-4000-8000-000000000001"}'::text,
  true
);

select throws_ok(
  $$select * from public.record_care_diary_draft(
      '82000000-0000-4000-8000-000000000001',
      '83000000-0000-4000-8000-000000000001',
      '85000000-0000-4000-8000-000000000001', now() - interval '1 hour',
      'morning', '生活照顧', '精神穩定', false, null,
      '86000000-0000-4000-8000-000000000001'
    )$$,
  '42501',
  'care diary draft is not permitted',
  'AAL1 cannot create a care-diary draft'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"81000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"84200000-0000-4000-8000-000000000001"}'::text,
  true
);

select results_eq(
  $$select version, status, replayed
    from public.record_care_diary_draft(
      '82000000-0000-4000-8000-000000000001',
      '83000000-0000-4000-8000-000000000001',
      '85000000-0000-4000-8000-000000000001', now() - interval '1 hour',
      'morning', ' 生活照顧 ', ' 精神穩定 ', false, null,
      '86000000-0000-4000-8000-000000000002'
    )$$,
  $$values (1, 'draft'::public.record_status, false)$$,
  'an authorized AAL2 actor creates one care-diary draft'
);

select results_eq(
  $$select organization_id, branch_id, client_id, record_key, version,
           category, status, occurred_at, source_system, created_by,
           data -> 'fields' ->> 'shift', data -> 'fields' ->> 'care_item',
           data -> 'fields' ->> 'note', data -> 'fields' ->> 'abnormal',
           data -> '_request' ->> 'page_slug',
           (data -> '_request' ->> 'idempotency_hash') ~ '^[a-f0-9]{64}$',
           signed_at is null and signed_by is null and content_hash is null
    from public.care_records
    where organization_id = '82000000-0000-4000-8000-000000000001'
      and record_key = '86000000-0000-4000-8000-000000000002'$$,
  $$values (
    '82000000-0000-4000-8000-000000000001'::uuid,
    '83000000-0000-4000-8000-000000000001'::uuid,
    '85000000-0000-4000-8000-000000000001'::uuid,
    '86000000-0000-4000-8000-000000000002'::uuid,
    1,
    'staff/daily-care/care-diary'::text,
    'draft'::public.record_status,
    now() - interval '1 hour',
    'local'::text,
    '81000000-0000-4000-8000-000000000001'::uuid,
    'morning'::text,
    '生活照顧'::text,
    '精神穩定'::text,
    'false'::text,
    'staff/daily-care/care-diary'::text,
    true,
    true
  )$$,
  'scope, actor, category, signature state, normalized fields, and request hash are server-derived'
);

select results_eq(
  $$select version, status, replayed
    from public.record_care_diary_draft(
      '82000000-0000-4000-8000-000000000001',
      '83000000-0000-4000-8000-000000000001',
      '85000000-0000-4000-8000-000000000001', now() - interval '1 hour',
      'morning', '生活照顧', '精神穩定', false, null,
      '86000000-0000-4000-8000-000000000002'
    )$$,
  $$values (1, 'draft'::public.record_status, true)$$,
  'the exact normalized request safely replays'
);

select is(
  (
    select count(*)::integer
    from public.care_records
    where organization_id = '82000000-0000-4000-8000-000000000001'
      and record_key = '86000000-0000-4000-8000-000000000002'
  ),
  1,
  'an exact replay creates no duplicate record'
);

select throws_ok(
  $$select * from public.record_care_diary_draft(
      '82000000-0000-4000-8000-000000000001',
      '83000000-0000-4000-8000-000000000001',
      '85000000-0000-4000-8000-000000000001', now() - interval '1 hour',
      'morning', '生活照顧', '內容已改變', false, null,
      '86000000-0000-4000-8000-000000000002'
    )$$,
  '23505',
  'care diary idempotency conflict',
  'reusing a key for changed content is rejected'
);

select throws_ok(
  $$select * from public.record_care_diary_draft(
      '82000000-0000-4000-8000-000000000001',
      '83000000-0000-4000-8000-000000000001',
      '85000000-0000-4000-8000-000000000003', now() - interval '30 minutes',
      'morning', '生活照顧', '', false, null,
      '86000000-0000-4000-8000-000000000003'
    )$$,
  '42501',
  'care diary draft is not permitted',
  'selected organization A rejects a client the actor can access in organization B'
);

select throws_ok(
  $$select * from public.record_care_diary_draft(
      '82000000-0000-4000-8000-000000000001',
      '83000000-0000-4000-8000-000000000001',
      '85000000-0000-4000-8000-000000000002', now() - interval '30 minutes',
      'morning', '生活照顧', '', false, null,
      '86000000-0000-4000-8000-000000000004'
    )$$,
  '23514',
  'care diary requires an active admitted client',
  'a terminal client cannot receive a new care-diary draft'
);

select throws_ok(
  $$select * from public.record_care_diary_draft(
      '82000000-0000-4000-8000-000000000001',
      '83000000-0000-4000-8000-000000000001',
      '85000000-0000-4000-8000-000000000001', now() - interval '25 hours',
      'morning', '生活照顧', '', false, null,
      '86000000-0000-4000-8000-000000000005'
    )$$,
  '22023',
  'care diary time is outside the allowed 24-hour draft window',
  'new drafts older than 24 hours are rejected'
);

select throws_ok(
  $$select * from public.record_care_diary_draft(
      '82000000-0000-4000-8000-000000000001',
      '83000000-0000-4000-8000-000000000001',
      '85000000-0000-4000-8000-000000000001', now() + interval '6 minutes',
      'morning', '生活照顧', '', false, null,
      '86000000-0000-4000-8000-000000000006'
    )$$,
  '22023',
  'care diary time is outside the allowed 24-hour draft window',
  'new drafts more than five minutes in the future are rejected'
);

select throws_ok(
  $$select * from public.record_care_diary_draft(
      '82000000-0000-4000-8000-000000000001',
      '83000000-0000-4000-8000-000000000001',
      '85000000-0000-4000-8000-000000000001', now(),
      'night', '生活照顧', '', false, null,
      '86000000-0000-4000-8000-000000000007'
    )$$,
  '22023',
  'valid care diary draft fields are required',
  'unknown shifts are rejected by the database'
);

select throws_ok(
  $$select * from public.record_care_diary_draft(
      '82000000-0000-4000-8000-000000000001',
      '83000000-0000-4000-8000-000000000001',
      '85000000-0000-4000-8000-000000000001', now(),
      'morning', '   ', '', false, null,
      '86000000-0000-4000-8000-000000000008'
    )$$,
  '22023',
  'valid care diary draft fields are required',
  'a blank care item is rejected after normalization'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"81000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}'::text,
  true
);

select throws_ok(
  $$select * from public.record_care_diary_draft(
      '82000000-0000-4000-8000-000000000001',
      '83000000-0000-4000-8000-000000000001',
      '85000000-0000-4000-8000-000000000001', now(),
      'morning', '生活照顧', '', false, null,
      '86000000-0000-4000-8000-000000000009'
    )$$,
  '42501',
  'care diary draft is not permitted',
  'a user without care-record write permission cannot create a draft'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"81000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"84200000-0000-4000-8000-000000000001"}'::text,
  true
);

select throws_ok(
  $$insert into public.care_records (
      organization_id, branch_id, client_id, record_key, version, category,
      status, occurred_at, data, created_by
    ) values (
      '82000000-0000-4000-8000-000000000001',
      '83000000-0000-4000-8000-000000000001',
      '85000000-0000-4000-8000-000000000001',
      '86000000-0000-4000-8000-000000000010', 1, 'staff/daily-care/care-diary',
      'draft', now(), '{}'::jsonb,
      '81000000-0000-4000-8000-000000000001'
    )$$,
  '42501',
  null,
  'direct draft insertion is denied'
);

select throws_ok(
  $$insert into public.care_records (
      organization_id, branch_id, client_id, record_key, version, category,
      status, occurred_at, data, created_by, signed_at, signed_by,
      signature_purpose, content_hash
    ) values (
      '82000000-0000-4000-8000-000000000001',
      '83000000-0000-4000-8000-000000000001',
      '85000000-0000-4000-8000-000000000001',
      '86000000-0000-4000-8000-000000000011', 1, 'forged',
      'signed', now(), '{}'::jsonb,
      '81000000-0000-4000-8000-000000000001', now(),
      '81000000-0000-4000-8000-000000000001', '偽造簽署', repeat('a', 64)
    )$$,
  '42501',
  null,
  'direct signed-record forgery is denied even to a role with signing permission'
);

select throws_ok(
  $$update public.care_records
    set data = jsonb_build_object('forged', true)
    where record_key = '86000000-0000-4000-8000-000000000002'$$,
  '42501',
  null,
  'direct draft mutation is denied'
);

select throws_ok(
  $$delete from public.care_records
    where record_key = '86000000-0000-4000-8000-000000000002'$$,
  '42501',
  null,
  'direct care-record deletion is denied'
);

select lives_ok(
  $$select * from public.transition_client(
      '82000000-0000-4000-8000-000000000001',
      '83000000-0000-4000-8000-000000000001',
      '85000000-0000-4000-8000-000000000001', 'close',
      (now() at time zone 'Asia/Taipei')::date,
      '測試結案', '照顧日誌重送驗證', 1,
      '84400000-0000-4000-8000-000000000001'
    )$$,
  'the production lifecycle boundary can close the client before replay'
);

select results_eq(
  $$select version, status, replayed
    from public.record_care_diary_draft(
      '82000000-0000-4000-8000-000000000001',
      '83000000-0000-4000-8000-000000000001',
      '85000000-0000-4000-8000-000000000001', now() - interval '1 hour',
      'morning', '生活照顧', '精神穩定', false, null,
      '86000000-0000-4000-8000-000000000002'
    )$$,
  $$values (1, 'draft'::public.record_status, true)$$,
  'an exact committed request remains replayable after a later terminal lifecycle change'
);

select is(
  (
    select count(*)::integer
    from public.care_records
    where organization_id = '82000000-0000-4000-8000-000000000001'
      and record_key = '86000000-0000-4000-8000-000000000002'
  ),
  1,
  'terminal-state replay still creates no duplicate record'
);

select * from finish();
rollback;
