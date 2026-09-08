begin;

select plan(31);

select ok(
  to_regclass('private.service_event_operations') is not null
  and exists (
    select 1
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'private'
      and relation.relname = 'service_event_operations'
      and relation.relrowsecurity
      and relation.relforcerowsecurity
  ),
  'the exact-replay ledger exists privately with forced RLS'
);

select ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'service_events'
      and column_name = 'signature_reauth_challenge_id'
      and is_nullable = 'YES'
  )
  and exists (
    select 1
    from pg_constraint constraint_definition
    where constraint_definition.conrelid = 'public.service_events'::regclass
      and constraint_definition.conname = 'service_events_signature_reauth_challenge_fkey'
      and constraint_definition.confrelid = 'private.reauth_challenges'::regclass
      and constraint_definition.confdeltype = 'r'
  )
  and to_regclass('public.service_events_signature_reauth_challenge_idx') is not null
  and exists (
    select 1
    from pg_trigger trigger_definition
    where trigger_definition.tgrelid = 'private.reauth_challenges'::regclass
      and trigger_definition.tgname = 'reauth_challenges_protect_terminal_evidence'
      and not trigger_definition.tgisinternal
  ),
  'service signatures reference restricted immutable challenge evidence while legacy rows remain nullable'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.complete_service_event(uuid,uuid,uuid,text,timestamptz,timestamptz,text,text,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.complete_service_event(uuid,uuid,uuid,text,timestamptz,timestamptz,text,text,uuid)',
    'execute'
  )
  and not (
    select procedure.prosecdef
    from pg_proc procedure
    where procedure.oid =
      'public.complete_service_event(uuid,uuid,uuid,text,timestamptz,timestamptz,text,text,uuid)'::regprocedure
  ),
  'the public completion RPC is an authenticated-only SECURITY INVOKER wrapper'
);

select is(
  pg_get_function_identity_arguments(
    'public.complete_service_event(uuid,uuid,uuid,text,timestamptz,timestamptz,text,text,uuid)'::regprocedure
  ),
  'p_expected_organization_id uuid, p_expected_branch_id uuid, p_client_id uuid, p_service_code text, p_started_at timestamp with time zone, p_ended_at timestamp with time zone, p_result text, p_notes text, p_idempotency_key uuid',
  'the completion RPC accepts only the server-selected tenant context and no caller-authored plan, actor, signature, or hash'
);

select ok(
  (
    select procedure.prosecdef
    from pg_proc procedure
    where procedure.oid =
      'private.complete_service_event_atomic(uuid,uuid,uuid,text,timestamptz,timestamptz,text,text,uuid)'::regprocedure
  )
  and has_function_privilege(
    'authenticated',
    'private.complete_service_event_atomic(uuid,uuid,uuid,text,timestamptz,timestamptz,text,text,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'private.complete_service_event_atomic(uuid,uuid,uuid,text,timestamptz,timestamptz,text,text,uuid)',
    'execute'
  ),
  'the private transaction definer is unavailable to anonymous callers and validates authenticated callers itself'
);

select ok(
  (
    select
      (length(function_definition) - length(replace(
        function_definition,
        'private.has_recent_aal2(15)',
        ''
      ))) / length('private.has_recent_aal2(15)') >= 2
      and position(
        'recent AAL2 reauthentication expired before service signing'
        in function_definition
      ) > position('for share;' in function_definition)
      and position(
        'v_now := clock_timestamp()'
        in function_definition
      ) > position(
        'recent AAL2 reauthentication expired before service signing'
        in function_definition
      )
    from (
      select pg_get_functiondef(
        'private.complete_service_event_atomic(uuid,uuid,uuid,text,timestamptz,timestamptz,text,text,uuid)'::regprocedure
      ) as function_definition
    ) definition
  ),
  'the signer rechecks recent AAL2 after plan row locks and before capturing signed_at'
);

select ok(
  (
    select
      position('return;' in function_definition) < position(
        'v_now := clock_timestamp()'
        in function_definition
      )
      and position(
        'service completion permission expired before service signing'
        in function_definition
      ) < position(
        'v_now := clock_timestamp()'
        in function_definition
      )
      and position(
        'v_now := clock_timestamp()'
        in function_definition
      ) < position(
        'service times are outside the allowed 24-hour window'
        in function_definition
      )
      and position(
        'service times are outside the allowed 24-hour window'
        in function_definition
      ) < position('v_content_hash := encode' in function_definition)
    from (
      select pg_get_functiondef(
        'private.complete_service_event_atomic(uuid,uuid,uuid,text,timestamptz,timestamptz,text,text,uuid)'::regprocedure
      ) as function_definition
    ) definition
  ),
  'exact replay precedes the post-lock fresh time window while hashing follows it'
);

select ok(
  (
    select
      position(
        'service completion permission expired before service signing'
        in function_definition
      ) < position('from private.reauth_events reauth' in function_definition)
      and position('for share of reauth, challenge' in function_definition)
          < position('v_now := clock_timestamp()' in function_definition)
      and position(
        'recent immutable AAL2 evidence is required before service signing'
        in function_definition
      ) < position('v_content_hash := encode' in function_definition)
      and position(
        '''signature_reauth_challenge_id'', v_signature_challenge.id'
        in function_definition
      ) > position('v_content_hash := encode' in function_definition)
    from (
      select pg_get_functiondef(
        'private.complete_service_event_atomic(uuid,uuid,uuid,text,timestamptz,timestamptz,text,text,uuid)'::regprocedure
      ) as function_definition
    ) definition
  ),
  'the signer locks exact session evidence after final authorization and hashes its challenge ID before insert'
);

select ok(
  not has_table_privilege('authenticated', 'public.service_events', 'insert')
  and not has_table_privilege('authenticated', 'public.service_events', 'update')
  and not has_table_privilege('authenticated', 'public.service_events', 'delete')
  and not has_table_privilege('authenticated', 'private.service_event_operations', 'select'),
  'authenticated callers cannot bypass the RPC or read its private ledger'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '70000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'service-signer@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '70000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'service-other@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());

insert into public.organizations (id, code, name) values
  ('71000000-0000-4000-8000-000000000001', 'service_org_a', '服務紀錄測試機構 A'),
  ('71000000-0000-4000-8000-000000000002', 'service_org_b', '服務紀錄測試機構 B');

insert into public.branches (id, organization_id, code, name) values
  ('72000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', 'main', '服務 A 主分支'),
  ('72000000-0000-4000-8000-000000000002', '71000000-0000-4000-8000-000000000001', 'other', '服務 A 其他分支'),
  ('72000000-0000-4000-8000-000000000003', '71000000-0000-4000-8000-000000000002', 'main', '服務 B 主分支');

insert into public.profiles (id, display_name, kind) values
  ('70000000-0000-4000-8000-000000000001', '服務簽署人員', 'staff'),
  ('70000000-0000-4000-8000-000000000002', '其他機構人員', 'staff');

insert into public.memberships (
  id, organization_id, branch_id, profile_id, status
) values
  ('72100000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', 'active'),
  ('72100000-0000-4000-8000-000000000002', '71000000-0000-4000-8000-000000000002', '72000000-0000-4000-8000-000000000003', '70000000-0000-4000-8000-000000000002', 'active'),
  ('72100000-0000-4000-8000-000000000003', '71000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000002', '70000000-0000-4000-8000-000000000001', 'active');

insert into public.membership_roles (membership_id, role_id) values
  ('72100000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000004'),
  ('72100000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000004'),
  ('72100000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000004');

insert into public.clients (
  id, organization_id, branch_id, client_code, display_name, status,
  admitted_on, ended_on, source_system
) values
  ('73000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001', 'SERVICE-A-VALID', '服務有效個案', 'active', (now() at time zone 'Asia/Taipei')::date - 30, null, 'test'),
  ('73000000-0000-4000-8000-000000000002', '71000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001', 'SERVICE-A-NOPLAN', '服務無計畫個案', 'active', (now() at time zone 'Asia/Taipei')::date - 30, null, 'test'),
  ('73000000-0000-4000-8000-000000000003', '71000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001', 'SERVICE-A-CLOSED', '服務結案個案', 'closed', (now() at time zone 'Asia/Taipei')::date - 30, (now() at time zone 'Asia/Taipei')::date - 1, 'test'),
  ('73000000-0000-4000-8000-000000000004', '71000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000002', 'SERVICE-A-BRANCH2', '服務跨分支個案', 'active', (now() at time zone 'Asia/Taipei')::date - 30, null, 'test'),
  ('73000000-0000-4000-8000-000000000005', '71000000-0000-4000-8000-000000000002', '72000000-0000-4000-8000-000000000003', 'SERVICE-B-CLIENT', '服務跨機構個案', 'active', (now() at time zone 'Asia/Taipei')::date - 30, null, 'test');

insert into public.client_assignments (
  id, organization_id, branch_id, client_id, assignee_user_id, assignment_kind
) values
  ('73100000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001', '73000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', 'daily_care'),
  ('73100000-0000-4000-8000-000000000002', '71000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001', '73000000-0000-4000-8000-000000000002', '70000000-0000-4000-8000-000000000001', 'daily_care'),
  ('73100000-0000-4000-8000-000000000003', '71000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001', '73000000-0000-4000-8000-000000000003', '70000000-0000-4000-8000-000000000001', 'daily_care'),
  ('73100000-0000-4000-8000-000000000004', '71000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000002', '73000000-0000-4000-8000-000000000004', '70000000-0000-4000-8000-000000000001', 'daily_care');

insert into private.reauth_challenges (
  id, user_id, session_id, nonce_sha256, idempotency_key, issued_jwt_iat,
  issued_jwt_jti, created_at, expires_at, consumed_at, consumed_jwt_iat,
  consumed_jwt_jti, factor_method, factor_verified_at
) values (
  '74000000-0000-4000-8000-000000000001',
  '70000000-0000-4000-8000-000000000001',
  '74100000-0000-4000-8000-000000000001', repeat('a', 64),
  '74200000-0000-4000-8000-000000000001', clock_timestamp() - interval '2 minutes',
  'service-before-stepup', clock_timestamp() - interval '90 seconds',
  clock_timestamp() + interval '5 minutes', clock_timestamp() - interval '30 seconds',
  clock_timestamp() - interval '30 seconds', 'service-after-stepup', 'totp',
  clock_timestamp() - interval '30 seconds'
);

insert into private.reauth_events (
  user_id, session_id, challenge_id, aal, verification_method, verified_at
)
select
  challenge.user_id,
  challenge.session_id,
  challenge.id,
  'aal2',
  challenge.factor_method,
  challenge.factor_verified_at
from private.reauth_challenges challenge
where challenge.id = '74000000-0000-4000-8000-000000000001';

insert into public.authorized_care_plans (
  id, organization_id, branch_id, client_id, plan_key, version, status,
  effective_from, effective_to, source_system, source_record_id,
  source_provenance, authorized_on, authorization_reference, service_limits,
  plan_data, idempotency_key, created_by, approved_by, approved_at,
  approval_evidence_hash, approval_reauth_challenge_id, signed_by, signed_at,
  signature_purpose, signature_reauth_challenge_id, content_hash
) values (
  '74300000-0000-4000-8000-000000000001',
  '71000000-0000-4000-8000-000000000001',
  '72000000-0000-4000-8000-000000000001',
  '73000000-0000-4000-8000-000000000001',
  '74400000-0000-4000-8000-000000000001', 1, 'signed',
  (now() at time zone 'Asia/Taipei')::date - 30,
  (now() at time zone 'Asia/Taipei')::date + 30,
  'test', 'service-authorization', '{"source":"synthetic"}'::jsonb,
  (now() at time zone 'Asia/Taipei')::date - 31, 'TEST-AUTHORIZATION',
  '{}'::jsonb, '{}'::jsonb,
  '74500000-0000-4000-8000-000000000001',
  '70000000-0000-4000-8000-000000000001',
  '70000000-0000-4000-8000-000000000001', clock_timestamp(), repeat('b', 64),
  '74000000-0000-4000-8000-000000000001',
  '70000000-0000-4000-8000-000000000001', clock_timestamp(),
  '測試核定計畫簽署', '74000000-0000-4000-8000-000000000001', repeat('c', 64)
);

insert into public.client_service_plans (
  id, organization_id, branch_id, client_id, authorized_care_plan_id,
  plan_key, version, status, effective_from, effective_to, source_system,
  source_record_id, source_provenance, authorized_limits_snapshot, goals,
  planned_services, idempotency_key, created_by, approved_by, approved_at,
  approval_evidence_hash, approval_reauth_challenge_id, signed_by, signed_at,
  signature_purpose, signature_reauth_challenge_id, content_hash
) values (
  '74600000-0000-4000-8000-000000000001',
  '71000000-0000-4000-8000-000000000001',
  '72000000-0000-4000-8000-000000000001',
  '73000000-0000-4000-8000-000000000001',
  '74300000-0000-4000-8000-000000000001',
  '74700000-0000-4000-8000-000000000001', 1, 'signed',
  (now() at time zone 'Asia/Taipei')::date - 30,
  (now() at time zone 'Asia/Taipei')::date + 30,
  'test', 'service-plan', '{"source":"synthetic"}'::jsonb,
  '{}'::jsonb, '[]'::jsonb, '[]'::jsonb,
  '74800000-0000-4000-8000-000000000001',
  '70000000-0000-4000-8000-000000000001',
  '70000000-0000-4000-8000-000000000001', clock_timestamp(), repeat('d', 64),
  '74000000-0000-4000-8000-000000000001',
  '70000000-0000-4000-8000-000000000001', clock_timestamp(),
  '測試個案服務計畫簽署', '74000000-0000-4000-8000-000000000001', repeat('e', 64)
);

select throws_ok(
  $$insert into public.service_events (
      organization_id, branch_id, client_id, client_service_plan_id,
      service_code, status, started_at, ended_at, staff_user_id,
      evidence, idempotency_key, signed_at, signed_by, signature_purpose,
      content_hash
    ) values (
      '71000000-0000-4000-8000-000000000001',
      '72000000-0000-4000-8000-000000000001',
      '73000000-0000-4000-8000-000000000001',
      '74600000-0000-4000-8000-000000000001',
      'BA98', 'completed', now() - interval '2 hours', now() - interval '1 hour',
      '70000000-0000-4000-8000-000000000001', '{"result":"missing evidence"}'::jsonb,
      '75000000-0000-4000-8000-000000000098', now(),
      '70000000-0000-4000-8000-000000000001', '完成服務與執行證據簽署', repeat('9', 64)
    )$$,
  '23514',
  null,
  'the dedicated signature purpose cannot be stored without a reauthentication challenge'
);

set local role authenticated;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '70000000-0000-4000-8000-000000000001',
    'role', 'authenticated',
    'aal', 'aal1',
    'session_id', '74100000-0000-4000-8000-000000000001'
  )::text,
  true
);

select throws_ok(
  $$select * from public.complete_service_event(
      '71000000-0000-4000-8000-000000000001',
      '72000000-0000-4000-8000-000000000001',
      '73000000-0000-4000-8000-000000000001', 'BA01',
      now() - interval '2 hours', now() - interval '1 hour',
      '已完成', null, '75000000-0000-4000-8000-000000000001'
    )$$,
  '42501',
  'recent AAL2 reauthentication is required to complete and sign a service',
  'an AAL1 employee cannot complete and sign a service'
);

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '70000000-0000-4000-8000-000000000001',
    'role', 'authenticated',
    'aal', 'aal2',
    'session_id', '74100000-0000-4000-8000-000000000099'
  )::text,
  true
);

select throws_ok(
  $$select * from public.complete_service_event(
      '71000000-0000-4000-8000-000000000001',
      '72000000-0000-4000-8000-000000000001',
      '73000000-0000-4000-8000-000000000001', 'BA01',
      now() - interval '2 hours', now() - interval '1 hour',
      '已完成', null, '75000000-0000-4000-8000-000000000002'
    )$$,
  '42501',
  'recent AAL2 reauthentication is required to complete and sign a service',
  'an AAL2 JWT without a recent same-session step-up cannot sign'
);

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '70000000-0000-4000-8000-000000000001',
    'role', 'authenticated',
    'aal', 'aal2',
    'session_id', '74100000-0000-4000-8000-000000000001'
  )::text,
  true
);

select throws_ok(
  $$select * from public.complete_service_event(
      '71000000-0000-4000-8000-000000000001',
      '72000000-0000-4000-8000-000000000001',
      '73000000-0000-4000-8000-000000000002', 'BA01',
      now() - interval '2 hours', now() - interval '1 hour',
      '已完成', null, '75000000-0000-4000-8000-000000000003'
    )$$,
  '23514',
  'service date requires exactly one current signed authorization',
  'a client without a current signed plan is rejected'
);

select throws_ok(
  $$select * from public.complete_service_event(
      '71000000-0000-4000-8000-000000000001',
      '72000000-0000-4000-8000-000000000001',
      '73000000-0000-4000-8000-000000000003', 'BA01',
      now() - interval '2 hours', now() - interval '1 hour',
      '已完成', null, '75000000-0000-4000-8000-000000000004'
    )$$,
  '23514',
  'client must be active, admitted, and unended on the service date',
  'a terminal client cannot receive a new completed service'
);

select throws_ok(
  $$select * from public.complete_service_event(
      '71000000-0000-4000-8000-000000000001',
      '72000000-0000-4000-8000-000000000001',
      '73000000-0000-4000-8000-000000000004', 'BA01',
      now() - interval '2 hours', now() - interval '1 hour',
      '已完成', null, '75000000-0000-4000-8000-000000000005'
    )$$,
  '42501',
  'service completion is not permitted in the current client scope',
  'a multi-branch employee cannot use the selected main-branch context for another-branch client'
);

select throws_ok(
  $$select * from public.complete_service_event(
      '71000000-0000-4000-8000-000000000001',
      '72000000-0000-4000-8000-000000000001',
      '73000000-0000-4000-8000-000000000005', 'BA01',
      now() - interval '2 hours', now() - interval '1 hour',
      '已完成', null, '75000000-0000-4000-8000-000000000006'
    )$$,
  '42501',
  'service completion is not permitted in the current client scope',
  'a cross-tenant service completion is rejected without leaking plan state'
);

select throws_ok(
  $$select * from public.complete_service_event(
      '71000000-0000-4000-8000-000000000001',
      '72000000-0000-4000-8000-000000000001',
      '73000000-0000-4000-8000-000000000001', 'BA01',
      now() - interval '1 hour', now() - interval '2 hours',
      '已完成', null, '75000000-0000-4000-8000-000000000007'
    )$$,
  '22023',
  'service end time cannot precede its start time',
  'a negative service duration is rejected'
);

select throws_ok(
  $$select * from public.complete_service_event(
      '71000000-0000-4000-8000-000000000001',
      '72000000-0000-4000-8000-000000000001',
      '73000000-0000-4000-8000-000000000001', 'BA01',
      now() - interval '26 hours', now() - interval '25 hours',
      '已完成', null, '75000000-0000-4000-8000-000000000008'
    )$$,
  '22023',
  'service times are outside the allowed 24-hour window',
  'a new service outside the 24-hour window is rejected'
);

select throws_ok(
  $$select * from public.complete_service_event(
      '71000000-0000-4000-8000-000000000001',
      '72000000-0000-4000-8000-000000000001',
      '73000000-0000-4000-8000-000000000001', 'BA 01',
      now() - interval '2 hours', now() - interval '1 hour',
      '已完成', null, '75000000-0000-4000-8000-000000000009'
    )$$,
  '22023',
  'service code must contain one to forty allowed characters',
  'the database independently rejects a malformed service code'
);

reset role;

insert into private.reauth_challenges (
  id, user_id, session_id, nonce_sha256, idempotency_key, issued_jwt_iat,
  issued_jwt_jti, created_at, expires_at, consumed_at, consumed_jwt_iat,
  consumed_jwt_jti, factor_method, factor_verified_at
) values (
  '74000000-0000-4000-8000-000000000002',
  '70000000-0000-4000-8000-000000000001',
  '74100000-0000-4000-8000-000000000001', repeat('f', 64),
  '74200000-0000-4000-8000-000000000002', clock_timestamp() - interval '22 minutes',
  'service-stale-before', clock_timestamp() - interval '21 minutes',
  clock_timestamp() - interval '16 minutes', clock_timestamp() - interval '20 minutes',
  clock_timestamp() - interval '20 minutes', 'service-stale-after', 'totp',
  clock_timestamp() - interval '20 minutes'
);

select throws_ok(
  $$update private.reauth_challenges
      set factor_method = 'phone'
      where id = '74000000-0000-4000-8000-000000000002'$$,
  '55000',
  'terminal reauthentication challenge evidence is immutable',
  'a consumed challenge cannot be rewritten after it becomes audit evidence'
);

update private.reauth_events
set challenge_id = '74000000-0000-4000-8000-000000000002',
    verification_method = 'totp',
    verified_at = clock_timestamp() - interval '30 seconds',
    revoked_at = null
where user_id = '70000000-0000-4000-8000-000000000001'
  and session_id = '74100000-0000-4000-8000-000000000001';

set local role authenticated;

select throws_ok(
  $$select * from public.complete_service_event(
      '71000000-0000-4000-8000-000000000001',
      '72000000-0000-4000-8000-000000000001',
      '73000000-0000-4000-8000-000000000001', 'BA01',
      now() - interval '2 hours', now() - interval '1 hour',
      '已完成', null, '75000000-0000-4000-8000-000000000011'
    )$$,
  '42501',
  'recent immutable AAL2 evidence is required before service signing',
  'a mutable recent event pointer cannot disguise stale or mismatched immutable factor evidence'
);

reset role;

update private.reauth_events event
set challenge_id = challenge.id,
    verification_method = challenge.factor_method,
    verified_at = challenge.factor_verified_at,
    revoked_at = null
from private.reauth_challenges challenge
where event.user_id = '70000000-0000-4000-8000-000000000001'
  and event.session_id = '74100000-0000-4000-8000-000000000001'
  and challenge.id = '74000000-0000-4000-8000-000000000001';

set local role authenticated;

select results_eq(
  $$select
      client_id,
      authorized_care_plan_id,
      client_service_plan_id,
      service_code,
      status::text,
      signed_by,
      signature_purpose,
      signature_reauth_challenge_id,
      replayed
    from public.complete_service_event(
      '71000000-0000-4000-8000-000000000001',
      '72000000-0000-4000-8000-000000000001',
      '73000000-0000-4000-8000-000000000001', 'ba01',
      now() - interval '2 hours', now() - interval '1 hour',
      ' 已依計畫完成 ', ' 個案配合穩定 ',
      '75000000-0000-4000-8000-000000000010'
    )$$,
  $$values (
    '73000000-0000-4000-8000-000000000001'::uuid,
    '74300000-0000-4000-8000-000000000001'::uuid,
    '74600000-0000-4000-8000-000000000001'::uuid,
    'BA01'::text,
    'completed'::text,
    '70000000-0000-4000-8000-000000000001'::uuid,
    '完成服務與執行證據簽署'::text,
    '74000000-0000-4000-8000-000000000001'::uuid,
    false
  )$$,
  'an authorized employee atomically creates a completed signed service with server-derived plans'
);

reset role;

select results_eq(
  $$select
      organization_id,
      branch_id,
      client_id,
      client_service_plan_id,
      staff_user_id,
      evidence,
      signed_by,
      signature_purpose,
      signature_reauth_challenge_id,
      exists (
        select 1
        from private.reauth_challenges challenge
        where challenge.id = service.signature_reauth_challenge_id
          and challenge.user_id = service.signed_by
          and challenge.session_id = '74100000-0000-4000-8000-000000000001'
          and challenge.consumed_at is not null
          and challenge.invalidated_at is null
          and challenge.factor_method in ('totp', 'webauthn', 'phone')
          and challenge.factor_verified_at between
            service.signed_at - interval '15 minutes'
            and service.signed_at + interval '1 minute'
      ),
      content_hash ~ '^[a-f0-9]{64}$',
      signed_at between now() - interval '1 minute' and clock_timestamp() + interval '1 minute'
    from public.service_events service
    where client_id = '73000000-0000-4000-8000-000000000001'
      and service_code = 'BA01'$$,
  $$values (
    '71000000-0000-4000-8000-000000000001'::uuid,
    '72000000-0000-4000-8000-000000000001'::uuid,
    '73000000-0000-4000-8000-000000000001'::uuid,
    '74600000-0000-4000-8000-000000000001'::uuid,
    '70000000-0000-4000-8000-000000000001'::uuid,
    '{"notes":"個案配合穩定","result":"已依計畫完成"}'::jsonb,
    '70000000-0000-4000-8000-000000000001'::uuid,
    '完成服務與執行證據簽署'::text,
    '74000000-0000-4000-8000-000000000001'::uuid,
    true,
    true,
    true
  )$$,
  'stored scope, actor, narrow evidence, signature purpose, hash, and time are server authored'
);

select ok(
  (
    select event.content_hash = encode(
      sha256(
        convert_to(
          jsonb_build_object(
            'schema_version', 1,
            'organization_id', event.organization_id,
            'branch_id', event.branch_id,
            'client_id', event.client_id,
            'authorized_care_plan_id', plan.authorized_care_plan_id,
            'client_service_plan_id', event.client_service_plan_id,
            'service_code', event.service_code,
            'started_at', to_char(event.started_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
            'ended_at', to_char(event.ended_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
            'staff_user_id', event.staff_user_id,
            'evidence', event.evidence,
            'signed_at', to_char(event.signed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
            'signed_by', event.signed_by,
            'signature_purpose', event.signature_purpose,
            'signature_reauth_challenge_id', event.signature_reauth_challenge_id
          )::text,
          'UTF8'
        )
      ),
      'hex'
    )
    from public.service_events event
    join public.client_service_plans plan on plan.id = event.client_service_plan_id
    where event.client_id = '73000000-0000-4000-8000-000000000001'
      and event.service_code = 'BA01'
  ),
  'the stored signature hash is the canonical server calculation over derived scope, plans, actor, evidence, and signature'
);

select ok(
  (
    select event.idempotency_key <>
      '75000000-0000-4000-8000-000000000010'::uuid
    from public.service_events event
    where event.client_id = '73000000-0000-4000-8000-000000000001'
      and event.service_code = 'BA01'
  ),
  'the public retry key is transformed into a tenant-and-actor-derived base-row key'
);

set local role authenticated;

select results_eq(
  $$select service_event_id, signature_reauth_challenge_id, replayed
    from public.complete_service_event(
      '71000000-0000-4000-8000-000000000001',
      '72000000-0000-4000-8000-000000000001',
      '73000000-0000-4000-8000-000000000001', 'BA01',
      now() - interval '2 hours', now() - interval '1 hour',
      '已依計畫完成', '個案配合穩定',
      '75000000-0000-4000-8000-000000000010'
    )$$,
  $$select id, signature_reauth_challenge_id, true
    from public.service_events
    where client_id = '73000000-0000-4000-8000-000000000001'
      and service_code = 'BA01'$$,
  'an exact request returns the same committed service as a replay'
);

select throws_ok(
  $$select * from public.complete_service_event(
      '71000000-0000-4000-8000-000000000001',
      '72000000-0000-4000-8000-000000000002',
      '73000000-0000-4000-8000-000000000001', 'BA01',
      now() - interval '2 hours', now() - interval '1 hour',
      '已依計畫完成', '個案配合穩定',
      '75000000-0000-4000-8000-000000000010'
    )$$,
  '42501',
  'service completion does not belong to the selected tenant context',
  'an exact replay cannot be reinterpreted under another selected branch context'
);

select is(
  (
    select count(*)::integer
    from public.service_events
    where client_id = '73000000-0000-4000-8000-000000000001'
      and service_code = 'BA01'
  ),
  1,
  'an exact replay creates no duplicate service event'
);

select throws_ok(
  $$select * from public.complete_service_event(
      '71000000-0000-4000-8000-000000000001',
      '72000000-0000-4000-8000-000000000001',
      '73000000-0000-4000-8000-000000000001', 'BA01',
      now() - interval '2 hours', now() - interval '1 hour',
      '改成其他結果', '個案配合穩定',
      '75000000-0000-4000-8000-000000000010'
    )$$,
  '23505',
  'service event idempotency conflict',
  'reusing the actor-global retry key for changed content is rejected'
);

select results_eq(
  $$select service_event_count, service_event_source_ids
    from public.daily_service_summary(
      '73000000-0000-4000-8000-000000000001',
      (select (started_at at time zone 'Asia/Taipei')::date
       from public.service_events
       where client_id = '73000000-0000-4000-8000-000000000001'
         and service_code = 'BA01')
    )$$,
  $$select 1::bigint, array_agg(id order by started_at, id)
    from public.service_events
    where client_id = '73000000-0000-4000-8000-000000000001'
      and service_code = 'BA01'$$,
  'daily service summary count and drill-down source IDs include the signed service exactly once'
);

select throws_ok(
  $$insert into public.service_events (
      organization_id, branch_id, client_id, client_service_plan_id,
      service_code, status, started_at, ended_at, staff_user_id,
      evidence, idempotency_key, signed_at, signed_by, signature_purpose,
      content_hash
    ) values (
      '71000000-0000-4000-8000-000000000001',
      '72000000-0000-4000-8000-000000000001',
      '73000000-0000-4000-8000-000000000001',
      '74600000-0000-4000-8000-000000000001',
      'BA99', 'completed', now() - interval '2 hours', now() - interval '1 hour',
      '70000000-0000-4000-8000-000000000001', '{"result":"bypass"}'::jsonb,
      '75000000-0000-4000-8000-000000000099', now(),
      '70000000-0000-4000-8000-000000000001', 'caller supplied', repeat('f', 64)
    )$$,
  '42501',
  null,
  'an authenticated caller cannot insert a signed service row directly'
);

select * from finish();
rollback;
