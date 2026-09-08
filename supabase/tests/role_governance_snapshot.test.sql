begin;

select plan(17);

select ok(
  has_function_privilege(
    'authenticated',
    'public.role_governance_snapshot(uuid,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.role_governance_snapshot(uuid,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'public.role_governance_snapshot(uuid,uuid)',
    'execute'
  )
  and not (
    select procedure.prosecdef
    from pg_proc procedure
    where procedure.oid =
      'public.role_governance_snapshot(uuid,uuid)'::regprocedure
  ),
  'the page-81 snapshot is an authenticated-only SECURITY INVOKER RPC'
);

select ok(
  (
    select procedure.prosecdef
    from pg_proc procedure
    where procedure.oid =
      'private.role_governance_snapshot_response(uuid,uuid)'::regprocedure
  )
  and position(
    'SET search_path TO ''''' in pg_get_functiondef(
      'private.role_governance_snapshot_response(uuid,uuid)'::regprocedure
    )
  ) > 0
  and has_function_privilege(
    'authenticated',
    'private.role_governance_snapshot_response(uuid,uuid)',
    'execute'
  ),
  'the private snapshot definer has a fixed empty search path and an authenticated caller boundary'
);

select ok(
  not has_table_privilege(
    'authenticated', 'public.role_governance_requests', 'select'
  )
  and not has_table_privilege(
    'service_role', 'public.role_governance_requests', 'select'
  ),
  'governance evidence has no direct application SELECT grant'
);

select ok(
  position('request_hash' in pg_get_function_result(
    'public.request_role_governance_change(uuid,uuid,text,uuid,uuid,text,text,text,text,uuid)'::regprocedure
  )) = 0
  and not has_function_privilege(
    'authenticated',
    'private.request_role_governance_change_atomic(uuid,uuid,text,uuid,uuid,text,text,text,text,uuid)',
    'execute'
  ),
  'the public request receipt and callable private boundary do not expose the internal request hash'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '81100000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'snapshot-manager@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '81100000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'snapshot-no-role@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '81100000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'snapshot-target@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '81100000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'snapshot-approver@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());

insert into public.organizations (id, code, name) values
  ('81200000-0000-4000-8000-000000000001', 'snapshot_a', '快照測試機構 A'),
  ('81200000-0000-4000-8000-000000000002', 'snapshot_b', '快照測試機構 B');

insert into public.branches (id, organization_id, code, name) values
  ('81300000-0000-4000-8000-000000000001', '81200000-0000-4000-8000-000000000001', 'a_main', 'A 主分支'),
  ('81300000-0000-4000-8000-000000000002', '81200000-0000-4000-8000-000000000001', 'a_other', 'A 其他分支'),
  ('81300000-0000-4000-8000-000000000003', '81200000-0000-4000-8000-000000000002', 'b_main', 'B 主分支');

insert into public.profiles (id, display_name, kind) values
  ('81100000-0000-4000-8000-000000000001', '快照管理者', 'staff'),
  ('81100000-0000-4000-8000-000000000002', '無治理權限者', 'staff'),
  ('81100000-0000-4000-8000-000000000003', '本分支目標人員', 'staff'),
  ('81100000-0000-4000-8000-000000000004', '其他分支人員', 'staff');

insert into public.memberships (
  id, organization_id, branch_id, profile_id, status
) values
  ('81400000-0000-4000-8000-000000000001', '81200000-0000-4000-8000-000000000001', null, '81100000-0000-4000-8000-000000000001', 'active'),
  ('81400000-0000-4000-8000-000000000002', '81200000-0000-4000-8000-000000000001', '81300000-0000-4000-8000-000000000001', '81100000-0000-4000-8000-000000000002', 'active'),
  ('81400000-0000-4000-8000-000000000003', '81200000-0000-4000-8000-000000000001', '81300000-0000-4000-8000-000000000001', '81100000-0000-4000-8000-000000000003', 'active'),
  ('81400000-0000-4000-8000-000000000004', '81200000-0000-4000-8000-000000000001', '81300000-0000-4000-8000-000000000002', '81100000-0000-4000-8000-000000000004', 'active');

insert into public.membership_roles (membership_id, role_id) values
  ('81400000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002'),
  ('81400000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000006');

insert into public.roles (
  id, organization_id, role_key, name, is_system, is_active
) values
  ('81500000-0000-4000-8000-000000000001', '81200000-0000-4000-8000-000000000001', 'snapshot_role_a', 'A 自訂角色', false, true),
  ('81500000-0000-4000-8000-000000000002', '81200000-0000-4000-8000-000000000002', 'snapshot_role_b', 'B 自訂角色', false, true);

insert into private.reauth_challenges (
  id, user_id, session_id, nonce_sha256, idempotency_key, issued_jwt_iat,
  issued_jwt_jti, created_at, expires_at, consumed_at, consumed_jwt_iat,
  consumed_jwt_jti, factor_method, factor_verified_at
) values (
  '81600000-0000-4000-8000-000000000001',
  '81100000-0000-4000-8000-000000000001',
  '81600000-0000-4000-8000-000000000002',
  repeat('a', 64),
  '81600000-0000-4000-8000-000000000003',
  clock_timestamp() - interval '2 minutes',
  'snapshot-before',
  clock_timestamp() - interval '1 minute',
  clock_timestamp() + interval '4 minutes',
  clock_timestamp() - interval '30 seconds',
  clock_timestamp() - interval '30 seconds',
  'snapshot-after',
  'totp',
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
where challenge.id = '81600000-0000-4000-8000-000000000001';

insert into public.role_governance_requests (
  organization_id, branch_id, operation, target_role_id,
  role_key, role_name, status, requested_by,
  requested_reauth_challenge_id, request_idempotency_key, request_hash,
  requested_at
) values (
  '81200000-0000-4000-8000-000000000001',
  '81300000-0000-4000-8000-000000000001',
  'create_role',
  '81700000-0000-4000-8000-000000000001',
  'pending_snapshot_role',
  '待核准快照角色',
  'pending',
  '81100000-0000-4000-8000-000000000001',
  '81600000-0000-4000-8000-000000000001',
  '81700000-0000-4000-8000-000000000002',
  repeat('b', 64),
  clock_timestamp() - interval '10 minutes'
);

-- More than one page of pending rows proves pending-first behavior and the
-- explicit truncation metadata without relying only on a source-code check.
insert into public.role_governance_requests (
  organization_id, branch_id, operation, target_role_id,
  role_key, role_name, status, requested_by,
  requested_reauth_challenge_id, request_idempotency_key, request_hash,
  requested_at
)
select
  '81200000-0000-4000-8000-000000000001',
  '81300000-0000-4000-8000-000000000001',
  'create_role',
  gen_random_uuid(),
  'bulk_snapshot_role_' || series.value,
  '批次待核准角色 ' || series.value,
  'pending',
  '81100000-0000-4000-8000-000000000001',
  '81600000-0000-4000-8000-000000000001',
  gen_random_uuid(),
  encode(sha256(convert_to('snapshot-' || series.value, 'UTF8')), 'hex'),
  clock_timestamp() - make_interval(secs => series.value)
from generate_series(1, 205) as series(value);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"81100000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"81600000-0000-4000-8000-000000000002"}',
  true
);

select throws_ok(
  $$select * from public.role_governance_requests limit 1$$,
  '42501', null,
  'an authenticated manager cannot directly read the governance evidence ledger'
);

select is(
  (select organization_id from public.role_governance_snapshot(
    '81200000-0000-4000-8000-000000000001',
    '81300000-0000-4000-8000-000000000001'
  )),
  '81200000-0000-4000-8000-000000000001'::uuid,
  'the snapshot returns the exact selected organization'
);

select is(
  (select branch_id from public.role_governance_snapshot(
    '81200000-0000-4000-8000-000000000001',
    '81300000-0000-4000-8000-000000000001'
  )),
  '81300000-0000-4000-8000-000000000001'::uuid,
  'the snapshot returns the exact selected branch'
);

select ok(
  (select
      roles @> '[{"role_key":"snapshot_role_a"}]'::jsonb
      and not roles @> '[{"role_key":"snapshot_role_b"}]'::jsonb
   from public.role_governance_snapshot(
     '81200000-0000-4000-8000-000000000001',
     '81300000-0000-4000-8000-000000000001'
   )),
  'role projection includes the selected tenant role and excludes another tenant'
);

select ok(
  (select
      memberships @> '[{"display_name":"本分支目標人員"}]'::jsonb
      and memberships @> '[{"display_name":"快照管理者"}]'::jsonb
      and not memberships @> '[{"display_name":"其他分支人員"}]'::jsonb
   from public.role_governance_snapshot(
     '81200000-0000-4000-8000-000000000001',
     '81300000-0000-4000-8000-000000000001'
   )),
  'member projection includes exact-branch and organization-wide rows but excludes another branch'
);

select ok(
  (select
      jsonb_array_length(requests) = 200
      and request_total = 206
      and pending_total = 206
      and requests_truncated
      and not exists (
        select 1
        from jsonb_array_elements(requests) request
        where request ->> 'status' <> 'pending'
      )
   from public.role_governance_snapshot(
     '81200000-0000-4000-8000-000000000001',
     '81300000-0000-4000-8000-000000000001'
   )),
  'over-limit queues return 200 pending-first rows with total, pending, and truncation metadata'
);

select ok(
  (select
      (requests -> 0) ? 'requested_by_current_actor'
      and not ((requests -> 0) ? 'requested_reauth_challenge_id')
      and not ((requests -> 0) ? 'request_hash')
      and not ((requests -> 0) ? 'request_idempotency_key')
   from public.role_governance_snapshot(
     '81200000-0000-4000-8000-000000000001',
     '81300000-0000-4000-8000-000000000001'
   )),
  'request projection supplies the self-approval boolean and omits sensitive evidence'
);

reset role;
select ok(
  exists (
    select 1
    from public.audit_events event
    where event.organization_id = '81200000-0000-4000-8000-000000000001'
      and event.branch_id = '81300000-0000-4000-8000-000000000001'
      and event.actor_user_id = '81100000-0000-4000-8000-000000000001'
      and event.action = 'select'
      and event.table_name = 'role_governance_snapshot'
      and event.metadata ->> 'projection' = 'page81_minimal'
      and not event.metadata ? 'display_name'
  ),
  'each successful snapshot read leaves a non-PII tenant/branch audit event'
);

set local role authenticated;

select throws_ok(
  $$select * from public.role_governance_snapshot(
    '81200000-0000-4000-8000-000000000002',
    '81300000-0000-4000-8000-000000000003'
  )$$,
  '42501', null,
  'a manager cannot read another tenant snapshot'
);

select throws_ok(
  $$select * from public.role_governance_snapshot(
    '81200000-0000-4000-8000-000000000001',
    '81300000-0000-4000-8000-000000000003'
  )$$,
  '42501', null,
  'a branch paired to another tenant is rejected'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"81100000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}',
  true
);

select throws_ok(
  $$select * from public.role_governance_snapshot(
    '81200000-0000-4000-8000-000000000001',
    '81300000-0000-4000-8000-000000000001'
  )$$,
  '42501', null,
  'an active member without roles.manage cannot read the governance snapshot'
);

reset role;
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select throws_ok(
  $$select * from public.role_governance_requests limit 1$$,
  '42501', null,
  'service-role credentials cannot directly read governance evidence'
);

reset role;
select set_config('request.jwt.claims', '{}'::text, true);

select ok(
  position(
    'case when request.status = ''pending'' then 0 else 1 end' in lower(pg_get_functiondef(
      'private.role_governance_snapshot_response(uuid,uuid)'::regprocedure
    ))
  ) > 0,
  'the snapshot SQL definition explicitly orders pending requests before history'
);

select * from finish();
rollback;
