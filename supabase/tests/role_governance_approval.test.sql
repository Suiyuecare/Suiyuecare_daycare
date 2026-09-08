begin;

select plan(51);

select ok(
  has_function_privilege(
    'authenticated',
    'public.request_role_governance_change(uuid,uuid,text,uuid,uuid,text,text,text,text,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.request_role_governance_change(uuid,uuid,text,uuid,uuid,text,text,text,text,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'public.request_role_governance_change(uuid,uuid,text,uuid,uuid,text,text,text,text,uuid)',
    'execute'
  )
  and not (
    select procedure.prosecdef
    from pg_proc procedure
    where procedure.oid =
      'public.request_role_governance_change(uuid,uuid,text,uuid,uuid,text,text,text,text,uuid)'::regprocedure
  ),
  'role-change requests use an authenticated-only SECURITY INVOKER RPC'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.approve_role_governance_change(uuid,uuid,uuid,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.approve_role_governance_change(uuid,uuid,uuid,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'public.approve_role_governance_change(uuid,uuid,uuid,uuid)',
    'execute'
  )
  and not (
    select procedure.prosecdef
    from pg_proc procedure
    where procedure.oid =
      'public.approve_role_governance_change(uuid,uuid,uuid,uuid)'::regprocedure
  ),
  'role-change approvals use an authenticated-only SECURITY INVOKER RPC'
);

select ok(
  (
    select procedure.prosecdef
    from pg_proc procedure
    where procedure.oid =
      'private.request_role_governance_change_atomic(uuid,uuid,text,uuid,uuid,text,text,text,text,uuid)'::regprocedure
  )
  and (
    select procedure.prosecdef
    from pg_proc procedure
    where procedure.oid =
      'private.approve_role_governance_change_atomic(uuid,uuid,uuid,uuid)'::regprocedure
  )
  and not has_function_privilege(
    'authenticated',
    'private.request_role_governance_change_atomic(uuid,uuid,text,uuid,uuid,text,text,text,text,uuid)',
    'execute'
  )
  and (
    select procedure.prosecdef
    from pg_proc procedure
    where procedure.oid =
      'private.request_role_governance_change_minimal(uuid,uuid,text,uuid,uuid,text,text,text,text,uuid)'::regprocedure
  )
  and has_function_privilege(
    'authenticated',
    'private.request_role_governance_change_minimal(uuid,uuid,text,uuid,uuid,text,text,text,text,uuid)',
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'private.approve_role_governance_change_atomic(uuid,uuid,uuid,uuid)',
    'execute'
  ),
  'full request evidence stays private while the minimal receipt shim and approval core remain caller-validating definers'
);

select ok(
  not has_table_privilege('authenticated', 'public.role_governance_requests', 'insert')
  and not has_table_privilege('authenticated', 'public.role_governance_requests', 'select')
  and not has_table_privilege('authenticated', 'public.role_governance_requests', 'update')
  and not has_table_privilege('authenticated', 'public.role_governance_requests', 'delete')
  and not has_table_privilege('service_role', 'public.role_governance_requests', 'insert')
  and not has_table_privilege('service_role', 'public.role_governance_requests', 'select')
  and not has_table_privilege('service_role', 'public.role_governance_requests', 'update')
  and not has_table_privilege('service_role', 'public.role_governance_requests', 'delete'),
  'no application database role can directly read, author, or decide governance requests'
);

select ok(
  not has_table_privilege('authenticated', 'public.roles', 'insert')
  and not has_table_privilege('authenticated', 'public.roles', 'update')
  and not has_table_privilege('authenticated', 'public.roles', 'delete')
  and not has_table_privilege('authenticated', 'public.role_permissions', 'insert')
  and not has_table_privilege('authenticated', 'public.role_permissions', 'update')
  and not has_table_privilege('authenticated', 'public.role_permissions', 'delete')
  and not has_table_privilege('authenticated', 'public.membership_roles', 'insert')
  and not has_table_privilege('authenticated', 'public.membership_roles', 'update')
  and not has_table_privilege('authenticated', 'public.membership_roles', 'delete'),
  'authenticated sessions have no direct role-definition or assignment DML'
);

select ok(
  not has_table_privilege('service_role', 'public.roles', 'insert')
  and not has_table_privilege('service_role', 'public.roles', 'update')
  and not has_table_privilege('service_role', 'public.roles', 'delete')
  and not has_table_privilege('service_role', 'public.role_permissions', 'insert')
  and not has_table_privilege('service_role', 'public.role_permissions', 'update')
  and not has_table_privilege('service_role', 'public.role_permissions', 'delete')
  and not has_table_privilege('service_role', 'public.membership_roles', 'insert')
  and not has_table_privilege('service_role', 'public.membership_roles', 'update')
  and not has_table_privilege('service_role', 'public.membership_roles', 'delete'),
  'service-role credentials cannot bypass the two-person workflow with direct DML'
);

select ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_class
   where oid = 'public.role_governance_requests'::regclass),
  'the governance ledger has forced row-level security'
);

select ok(
  position(
    'request.organization_id = p_expected_organization_id' in
    pg_get_functiondef(
      'private.approve_role_governance_change_atomic(uuid,uuid,uuid,uuid)'::regprocedure
    )
  ) > 0
  and position(
    'request.branch_id = p_expected_branch_id' in
    pg_get_functiondef(
      'private.approve_role_governance_change_atomic(uuid,uuid,uuid,uuid)'::regprocedure
    )
  ) > 0,
  'approval locks the request only inside the selected organization and branch'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '91000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'role-requester@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '91000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'role-approver@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '91000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'role-bad-evidence@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '91000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'role-target@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());

insert into public.organizations (id, code, name) values
  ('92000000-0000-4000-8000-000000000001', 'role_gov_a', '權限治理測試機構 A'),
  ('92000000-0000-4000-8000-000000000002', 'role_gov_b', '權限治理測試機構 B');

insert into public.branches (id, organization_id, code, name) values
  ('93000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', 'a_main', '權限治理 A 主分支'),
  ('93000000-0000-4000-8000-000000000002', '92000000-0000-4000-8000-000000000001', 'a_second', '權限治理 A 第二分支'),
  ('93000000-0000-4000-8000-000000000003', '92000000-0000-4000-8000-000000000002', 'b_main', '權限治理 B 主分支');

insert into public.profiles (id, display_name, kind) values
  ('91000000-0000-4000-8000-000000000001', '治理申請人', 'staff'),
  ('91000000-0000-4000-8000-000000000002', '治理核准人', 'staff'),
  ('91000000-0000-4000-8000-000000000003', '治理錯誤證據人', 'staff'),
  ('91000000-0000-4000-8000-000000000004', '治理目標人員', 'staff');

insert into public.memberships (
  id, organization_id, branch_id, profile_id, status
) values
  ('94000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', null, '91000000-0000-4000-8000-000000000001', 'active'),
  ('94000000-0000-4000-8000-000000000002', '92000000-0000-4000-8000-000000000002', null, '91000000-0000-4000-8000-000000000001', 'active'),
  ('94000000-0000-4000-8000-000000000003', '92000000-0000-4000-8000-000000000001', null, '91000000-0000-4000-8000-000000000002', 'active'),
  ('94000000-0000-4000-8000-000000000004', '92000000-0000-4000-8000-000000000002', null, '91000000-0000-4000-8000-000000000002', 'active'),
  ('94000000-0000-4000-8000-000000000005', '92000000-0000-4000-8000-000000000001', null, '91000000-0000-4000-8000-000000000003', 'active'),
  ('94000000-0000-4000-8000-000000000006', '92000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000004', 'active'),
  ('94000000-0000-4000-8000-000000000007', '92000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000004', 'active'),
  ('94000000-0000-4000-8000-000000000008', '92000000-0000-4000-8000-000000000002', '93000000-0000-4000-8000-000000000003', '91000000-0000-4000-8000-000000000004', 'active');

insert into public.membership_roles (membership_id, role_id) values
  ('94000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002'),
  ('94000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002'),
  ('94000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002'),
  ('94000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000002'),
  ('94000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000002');

insert into public.roles (
  id, organization_id, role_key, name, is_system, is_active
) values
  ('96000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', 'existing_a', '既有 A 角色', false, true),
  ('96000000-0000-4000-8000-000000000002', '92000000-0000-4000-8000-000000000002', 'existing_b', '既有 B 角色', false, true),
  ('96000000-0000-4000-8000-000000000003', '92000000-0000-4000-8000-000000000001', 'inactive_a', '停用 A 角色', false, false);

insert into private.reauth_challenges (
  id, user_id, session_id, nonce_sha256, idempotency_key, issued_jwt_iat,
  issued_jwt_jti, created_at, expires_at, consumed_at, consumed_jwt_iat,
  consumed_jwt_jti, factor_method, factor_verified_at
) values
  ('95000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', '95100000-0000-4000-8000-000000000001', repeat('1', 64), '95200000-0000-4000-8000-000000000001', clock_timestamp() - interval '2 minutes', 'requester-before', clock_timestamp() - interval '1 minute', clock_timestamp() + interval '4 minutes', clock_timestamp() - interval '30 seconds', clock_timestamp() - interval '30 seconds', 'requester-after', 'totp', clock_timestamp() - interval '30 seconds'),
  ('95000000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000002', '95100000-0000-4000-8000-000000000002', repeat('2', 64), '95200000-0000-4000-8000-000000000002', clock_timestamp() - interval '2 minutes', 'approver-before', clock_timestamp() - interval '1 minute', clock_timestamp() + interval '4 minutes', clock_timestamp() - interval '30 seconds', clock_timestamp() - interval '30 seconds', 'approver-after', 'webauthn', clock_timestamp() - interval '30 seconds'),
  ('95000000-0000-4000-8000-000000000003', '91000000-0000-4000-8000-000000000003', '95100000-0000-4000-8000-000000000003', repeat('3', 64), '95200000-0000-4000-8000-000000000003', clock_timestamp() - interval '2 minutes', 'mismatch-before', clock_timestamp() - interval '1 minute', clock_timestamp() + interval '4 minutes', clock_timestamp() - interval '30 seconds', clock_timestamp() - interval '30 seconds', 'mismatch-after', 'phone', clock_timestamp() - interval '30 seconds');

insert into private.reauth_events (
  user_id, session_id, challenge_id, aal, verification_method, verified_at
)
select
  challenge.user_id,
  challenge.session_id,
  challenge.id,
  'aal2',
  challenge.factor_method,
  case
    -- Keep the third fixture deliberately mismatched. The valid fixtures use
    -- the exact persisted timestamp instead of a second clock_timestamp()
    -- call, which can differ by a millisecond under a loaded full-suite run.
    when challenge.id = '95000000-0000-4000-8000-000000000003'
      then challenge.factor_verified_at + interval '10 seconds'
    else challenge.factor_verified_at
  end
from private.reauth_challenges challenge
where challenge.id in (
  '95000000-0000-4000-8000-000000000001',
  '95000000-0000-4000-8000-000000000002',
  '95000000-0000-4000-8000-000000000003'
)
order by challenge.id;

-- Production callers intentionally have no direct SELECT on the evidence
-- ledger. This transaction-local definer exists only so pgTAP can inspect
-- internal evidence without weakening production grants.
create function pg_temp.role_governance_requests_for_test()
returns setof public.role_governance_requests
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.role_governance_requests;
$$;
revoke all on function pg_temp.role_governance_requests_for_test()
  from public;
grant execute on function pg_temp.role_governance_requests_for_test()
  to authenticated;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1","session_id":"95100000-0000-4000-8000-000000000001"}',
  true
);

select throws_ok(
  $$select * from public.request_role_governance_change(
      '92000000-0000-4000-8000-000000000001',
      '93000000-0000-4000-8000-000000000001',
      'create_role', '96000000-0000-4000-8000-000000000010', null, null,
      'aal1_denied', 'AAL1 denied', null,
      '97000000-0000-4000-8000-000000000001'
    )$$,
  '42501', null,
  'an AAL1 claim cannot request a role change even with a recent event'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"95100000-0000-4000-8000-000000000001"}',
  true
);

select throws_ok(
  $$insert into public.roles (
      id, organization_id, role_key, name, is_system
    ) values (
      '96000000-0000-4000-8000-000000000011',
      '92000000-0000-4000-8000-000000000001',
      'direct_role', '直接新增角色', false
    )$$,
  '42501', null,
  'an authenticated manager cannot directly insert a tenant role'
);

select throws_ok(
  $$insert into public.role_permissions (role_id, permission_id, granted_by)
    select '96000000-0000-4000-8000-000000000001', id,
           '91000000-0000-4000-8000-000000000001'
    from public.permissions where permission_key = 'medications.verify'$$,
  '42501', null,
  'an authenticated manager cannot directly grant a permission'
);

select throws_ok(
  $$insert into public.membership_roles (membership_id, role_id, assigned_by)
    values (
      '94000000-0000-4000-8000-000000000006',
      '96000000-0000-4000-8000-000000000001',
      '91000000-0000-4000-8000-000000000001'
    )$$,
  '42501', null,
  'an authenticated manager cannot directly assign a role'
);

select throws_ok(
  $$insert into public.role_governance_requests (
      organization_id, branch_id, operation, target_role_id, role_key, role_name,
      requested_by, requested_reauth_challenge_id, request_idempotency_key,
      request_hash
    ) values (
      '92000000-0000-4000-8000-000000000001',
      '93000000-0000-4000-8000-000000000001',
      'create_role', '96000000-0000-4000-8000-000000000012',
      'forged_role', '偽造角色',
      '91000000-0000-4000-8000-000000000001',
      '95000000-0000-4000-8000-000000000001',
      '97000000-0000-4000-8000-000000000012', repeat('f', 64)
    )$$,
  '42501', null,
  'an authenticated manager cannot forge a governance ledger row'
);

select throws_ok(
  $$select * from public.request_role_governance_change(
      '92000000-0000-4000-8000-000000000001',
      '93000000-0000-4000-8000-000000000001',
      'grant_permission', '96000000-0000-4000-8000-000000000002', null,
      'medications.verify', null, null, null,
      '97000000-0000-4000-8000-000000000002'
    )$$,
  '42501', null,
  'a multi-tenant actor cannot target an organization-B role from selected organization A'
);

select throws_ok(
  $$select * from public.request_role_governance_change(
      '92000000-0000-4000-8000-000000000001',
      '93000000-0000-4000-8000-000000000001',
      'assign_role', '96000000-0000-4000-8000-000000000001',
      '94000000-0000-4000-8000-000000000007', null, null, null, null,
      '97000000-0000-4000-8000-000000000003'
    )$$,
  '42501', null,
  'a selected branch cannot assign a role to another branch membership'
);

select throws_ok(
  $$select * from public.request_role_governance_change(
      '92000000-0000-4000-8000-000000000001',
      '93000000-0000-4000-8000-000000000001',
      'assign_role', '96000000-0000-4000-8000-000000000001',
      '94000000-0000-4000-8000-000000000008', null, null, null, null,
      '97000000-0000-4000-8000-000000000004'
    )$$,
  '42501', null,
  'a selected organization cannot assign a role to another organization membership'
);

select throws_ok(
  $$select * from public.request_role_governance_change(
      '92000000-0000-4000-8000-000000000001',
      '93000000-0000-4000-8000-000000000001',
      'grant_permission', '10000000-0000-4000-8000-000000000002', null,
      'medications.verify', null, null, null,
      '97000000-0000-4000-8000-000000000005'
    )$$,
  '42501', null,
  'tenant governance cannot mutate a system role permission set'
);

select throws_ok(
  $$select * from public.request_role_governance_change(
      '92000000-0000-4000-8000-000000000001',
      '93000000-0000-4000-8000-000000000001',
      'deactivate_role', '10000000-0000-4000-8000-000000000002', null,
      null, null, null, null,
      '97000000-0000-4000-8000-000000000006'
    )$$,
  '42501', null,
  'tenant governance cannot deactivate a system role'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"91000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2","session_id":"95100000-0000-4000-8000-000000000003"}',
  true
);

select throws_ok(
  $$select * from public.request_role_governance_change(
      '92000000-0000-4000-8000-000000000001',
      '93000000-0000-4000-8000-000000000001',
      'create_role', '96000000-0000-4000-8000-000000000013', null, null,
      'mismatch_evidence', '錯誤證據角色', null,
      '97000000-0000-4000-8000-000000000007'
    )$$,
  '42501', 'immutable AAL2 evidence is required for role governance',
  'a recent event that does not exactly match its immutable challenge is rejected'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"95100000-0000-4000-8000-000000000001"}',
  true
);

select results_eq(
  $$select status, replayed
    from public.request_role_governance_change(
      '92000000-0000-4000-8000-000000000001',
      '93000000-0000-4000-8000-000000000001',
      'create_role', '96000000-0000-4000-8000-000000000010', null, null,
      'new_role_one', '新角色一', '第一筆治理角色',
      '97000000-0000-4000-8000-000000000010'
    )$$,
  $$values ('pending'::text, false)$$,
  'a qualified requester creates one pending tenant-role request'
);

select ok(
  (select request_hash ~ '^[a-f0-9]{64}$'
      and requested_by = '91000000-0000-4000-8000-000000000001'
      and requested_reauth_challenge_id = '95000000-0000-4000-8000-000000000001'
      and requested_at between clock_timestamp() - interval '1 minute' and clock_timestamp() + interval '1 minute'
   from pg_temp.role_governance_requests_for_test()
   where request_idempotency_key = '97000000-0000-4000-8000-000000000010'),
  'the request stores server-derived hash, actor, time, and exact consumed challenge evidence'
);

select results_eq(
  $$select status, replayed
    from public.request_role_governance_change(
      '92000000-0000-4000-8000-000000000001',
      '93000000-0000-4000-8000-000000000001',
      'create_role', '96000000-0000-4000-8000-000000000010', null, null,
      'new_role_one', '新角色一', '第一筆治理角色',
      '97000000-0000-4000-8000-000000000010'
    )$$,
  $$values ('pending'::text, true)$$,
  'an exact pending request retry returns the durable request'
);

select is(
  (select count(*)::integer
   from pg_temp.role_governance_requests_for_test()
   where request_idempotency_key = '97000000-0000-4000-8000-000000000010'),
  1,
  'an exact request retry creates no duplicate ledger row'
);

select throws_ok(
  $$select * from public.request_role_governance_change(
      '92000000-0000-4000-8000-000000000001',
      '93000000-0000-4000-8000-000000000001',
      'create_role', '96000000-0000-4000-8000-000000000010', null, null,
      'new_role_one', '已變更名稱', '第一筆治理角色',
      '97000000-0000-4000-8000-000000000010'
    )$$,
  '23505', 'role change request idempotency conflict',
  'reusing a request key with changed content is rejected'
);

select results_eq(
  $$select status, replayed
    from public.request_role_governance_change(
      '92000000-0000-4000-8000-000000000001',
      '93000000-0000-4000-8000-000000000001',
      'create_role', '96000000-0000-4000-8000-000000000020', null, null,
      'new_role_two', '新角色二', null,
      '97000000-0000-4000-8000-000000000020'
    )$$,
  $$values ('pending'::text, false)$$,
  'a second independent role request can remain pending in the same organization'
);

select is(
  (select count(*)::integer
   from pg_temp.role_governance_requests_for_test()
   where organization_id = '92000000-0000-4000-8000-000000000001'
     and status = 'pending'),
  2,
  'approval idempotency uniqueness does not collapse multiple pending requests'
);

select throws_ok(
  $$select * from public.approve_role_governance_change(
      '92000000-0000-4000-8000-000000000001',
      '93000000-0000-4000-8000-000000000001',
      (select id from pg_temp.role_governance_requests_for_test()
       where request_idempotency_key = '97000000-0000-4000-8000-000000000010'),
      '97100000-0000-4000-8000-000000000010'
    )$$,
  '42501', 'role changes require an independent second approver',
  'the requester cannot approve their own role change'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"91000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2","session_id":"95100000-0000-4000-8000-000000000003"}',
  true
);

select throws_ok(
  $$select * from public.approve_role_governance_change(
      '92000000-0000-4000-8000-000000000001',
      '93000000-0000-4000-8000-000000000001',
      (select id from pg_temp.role_governance_requests_for_test()
       where request_idempotency_key = '97000000-0000-4000-8000-000000000010'),
      '97100000-0000-4000-8000-000000000011'
    )$$,
  '42501', 'independent immutable AAL2 evidence is required for role approval',
  'an approver with mismatched challenge evidence cannot apply the request'
);

select ok(
  not exists (
    select 1 from public.roles
    where id = '96000000-0000-4000-8000-000000000010'
  )
  and (select status = 'pending'
       from pg_temp.role_governance_requests_for_test()
       where request_idempotency_key = '97000000-0000-4000-8000-000000000010'),
  'a rejected approval leaves both the target and governance request unchanged'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"91000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"95100000-0000-4000-8000-000000000002"}',
  true
);

select throws_ok(
  $$select * from public.approve_role_governance_change(
      '92000000-0000-4000-8000-000000000002',
      '93000000-0000-4000-8000-000000000003',
      (select id from pg_temp.role_governance_requests_for_test()
       where request_idempotency_key = '97000000-0000-4000-8000-000000000010'),
      '97100000-0000-4000-8000-000000000012'
    )$$,
  '42501', 'role change request is outside the selected tenant context',
  'a multi-tenant approver cannot approve an A request through selected context B'
);

select results_eq(
  $$select status, replayed
    from public.approve_role_governance_change(
      '92000000-0000-4000-8000-000000000001',
      '93000000-0000-4000-8000-000000000001',
      (select id from pg_temp.role_governance_requests_for_test()
       where request_idempotency_key = '97000000-0000-4000-8000-000000000010'),
      '97100000-0000-4000-8000-000000000010'
    )$$,
  $$values ('approved'::text, false)$$,
  'an independent qualified approver atomically applies the role creation'
);

select results_eq(
  $$select organization_id, role_key, name, description, is_system, is_active
    from public.roles
    where id = '96000000-0000-4000-8000-000000000010'$$,
  $$values (
    '92000000-0000-4000-8000-000000000001'::uuid,
    'new_role_one'::text, '新角色一'::text, '第一筆治理角色'::text,
    false, true
  )$$,
  'role scope, metadata, system flag, and active state are server applied exactly'
);

select ok(
  (select approved_by = '91000000-0000-4000-8000-000000000002'
      and approved_reauth_challenge_id = '95000000-0000-4000-8000-000000000002'
      and approved_reauth_challenge_id <> requested_reauth_challenge_id
      and approval_hash ~ '^[a-f0-9]{64}$'
      and approved_at = applied_at
      and approved_at between clock_timestamp() - interval '1 minute' and clock_timestamp() + interval '1 minute'
   from pg_temp.role_governance_requests_for_test()
   where request_idempotency_key = '97000000-0000-4000-8000-000000000010'),
  'approval stores an independent actor, exact challenge, server time, and durable hash'
);

select results_eq(
  $$select status, replayed
    from public.approve_role_governance_change(
      '92000000-0000-4000-8000-000000000001',
      '93000000-0000-4000-8000-000000000001',
      (select id from pg_temp.role_governance_requests_for_test()
       where request_idempotency_key = '97000000-0000-4000-8000-000000000010'),
      '97100000-0000-4000-8000-000000000010'
    )$$,
  $$values ('approved'::text, true)$$,
  'an exact approval retry returns the durable approval receipt'
);

select throws_ok(
  $$select * from public.approve_role_governance_change(
      '92000000-0000-4000-8000-000000000001',
      '93000000-0000-4000-8000-000000000001',
      (select id from pg_temp.role_governance_requests_for_test()
       where request_idempotency_key = '97000000-0000-4000-8000-000000000010'),
      '97100000-0000-4000-8000-000000000099'
    )$$,
  '23505', 'role change request was already decided',
  'a changed approval idempotency key cannot replay an approved request'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"95100000-0000-4000-8000-000000000001"}',
  true
);

select results_eq(
  $$select status, replayed
    from public.request_role_governance_change(
      '92000000-0000-4000-8000-000000000001',
      '93000000-0000-4000-8000-000000000001',
      'create_role', '96000000-0000-4000-8000-000000000010', null, null,
      'new_role_one', '新角色一', '第一筆治理角色',
      '97000000-0000-4000-8000-000000000010'
    )$$,
  $$values ('approved'::text, true)$$,
  'the original request exactly replays after its target state has changed'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"91000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"95100000-0000-4000-8000-000000000002"}',
  true
);

select throws_ok(
  $$select * from public.approve_role_governance_change(
      '92000000-0000-4000-8000-000000000001',
      '93000000-0000-4000-8000-000000000001',
      (select id from pg_temp.role_governance_requests_for_test()
       where request_idempotency_key = '97000000-0000-4000-8000-000000000020'),
      '97100000-0000-4000-8000-000000000010'
    )$$,
  '23505', null,
  'one approver cannot reuse an approval key for a different request'
);

select ok(
  not exists (
    select 1 from public.roles
    where id = '96000000-0000-4000-8000-000000000020'
  )
  and (select status = 'pending'
       from pg_temp.role_governance_requests_for_test()
       where request_idempotency_key = '97000000-0000-4000-8000-000000000020'),
  'an approval-key collision rolls back both target creation and ledger transition'
);

select results_eq(
  $$select status, replayed
    from public.approve_role_governance_change(
      '92000000-0000-4000-8000-000000000001',
      '93000000-0000-4000-8000-000000000001',
      (select id from pg_temp.role_governance_requests_for_test()
       where request_idempotency_key = '97000000-0000-4000-8000-000000000020'),
      '97100000-0000-4000-8000-000000000020'
    )$$,
  $$values ('approved'::text, false)$$,
  'the rolled-back request remains independently approvable with a new key'
);

select is(
  (select count(*)::integer
   from public.roles
   where id = '96000000-0000-4000-8000-000000000020'),
  1,
  'the successful retry creates the second role exactly once'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"95100000-0000-4000-8000-000000000001"}',
  true
);

select results_eq(
  $$select status, replayed
    from public.request_role_governance_change(
      '92000000-0000-4000-8000-000000000001',
      '93000000-0000-4000-8000-000000000001',
      'grant_permission', '96000000-0000-4000-8000-000000000010', null,
      'medications.verify', null, null, null,
      '97000000-0000-4000-8000-000000000030'
    )$$,
  $$values ('pending'::text, false)$$,
  'a permission grant is staged without changing the role immediately'
);

select ok(
  not exists (
    select 1
    from public.role_permissions grant_row
    join public.permissions permission on permission.id = grant_row.permission_id
    where grant_row.role_id = '96000000-0000-4000-8000-000000000010'
      and permission.permission_key = 'medications.verify'
  ),
  'a pending permission request has no early side effect'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"91000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"95100000-0000-4000-8000-000000000002"}',
  true
);

select results_eq(
  $$select status, replayed
    from public.approve_role_governance_change(
      '92000000-0000-4000-8000-000000000001',
      '93000000-0000-4000-8000-000000000001',
      (select id from pg_temp.role_governance_requests_for_test()
       where request_idempotency_key = '97000000-0000-4000-8000-000000000030'),
      '97100000-0000-4000-8000-000000000030'
    )$$,
  $$values ('approved'::text, false)$$,
  'the independent approval applies the permission grant'
);

select results_eq(
  $$select permission.permission_key, grant_row.granted_by
    from public.role_permissions grant_row
    join public.permissions permission on permission.id = grant_row.permission_id
    where grant_row.role_id = '96000000-0000-4000-8000-000000000010'
      and permission.permission_key = 'medications.verify'$$,
  $$values (
    'medications.verify'::text,
    '91000000-0000-4000-8000-000000000002'::uuid
  )$$,
  'the permission grant records the approving actor, not the requester'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"95100000-0000-4000-8000-000000000001"}',
  true
);

select results_eq(
  $$select status, replayed
    from public.request_role_governance_change(
      '92000000-0000-4000-8000-000000000001',
      '93000000-0000-4000-8000-000000000001',
      'grant_permission', '96000000-0000-4000-8000-000000000010', null,
      'medications.verify', null, null, null,
      '97000000-0000-4000-8000-000000000030'
    )$$,
  $$values ('approved'::text, true)$$,
  'a permission request exactly replays after the grant changed mutable state'
);

select results_eq(
  $$select status, replayed
    from public.request_role_governance_change(
      '92000000-0000-4000-8000-000000000001',
      '93000000-0000-4000-8000-000000000001',
      'assign_role', '96000000-0000-4000-8000-000000000010',
      '94000000-0000-4000-8000-000000000006', null, null, null, null,
      '97000000-0000-4000-8000-000000000040'
    )$$,
  $$values ('pending'::text, false)$$,
  'a same-branch membership assignment is staged successfully'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"91000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"95100000-0000-4000-8000-000000000002"}',
  true
);

select results_eq(
  $$select status, replayed
    from public.approve_role_governance_change(
      '92000000-0000-4000-8000-000000000001',
      '93000000-0000-4000-8000-000000000001',
      (select id from pg_temp.role_governance_requests_for_test()
       where request_idempotency_key = '97000000-0000-4000-8000-000000000040'),
      '97100000-0000-4000-8000-000000000040'
    )$$,
  $$values ('approved'::text, false)$$,
  'the independent approval atomically applies the membership role'
);

select results_eq(
  $$select membership_id, role_id, assigned_by
    from public.membership_roles
    where membership_id = '94000000-0000-4000-8000-000000000006'
      and role_id = '96000000-0000-4000-8000-000000000010'$$,
  $$values (
    '94000000-0000-4000-8000-000000000006'::uuid,
    '96000000-0000-4000-8000-000000000010'::uuid,
    '91000000-0000-4000-8000-000000000002'::uuid
  )$$,
  'the membership assignment is branch-bound and attributes the approver'
);

reset role;
select set_config('request.jwt.claims', '{}'::text, true);

select throws_ok(
  $$update public.role_governance_requests
    set role_name = '竄改後名稱'
    where request_idempotency_key = '97000000-0000-4000-8000-000000000010'$$,
  '55000', 'role governance request identity and evidence are immutable',
  'even an owner-level write cannot alter immutable request identity or evidence'
);

select throws_ok(
  $$delete from public.role_governance_requests
    where request_idempotency_key = '97000000-0000-4000-8000-000000000010'$$,
  '55000', 'role governance requests are immutable',
  'governance evidence cannot be deleted'
);

select is(
  (select count(*)::integer
   from pg_temp.role_governance_requests_for_test()
   where request_idempotency_key in (
     '97000000-0000-4000-8000-000000000010',
     '97000000-0000-4000-8000-000000000020',
     '97000000-0000-4000-8000-000000000030',
     '97000000-0000-4000-8000-000000000040'
   )),
  4,
  'the four accepted logical requests have exactly four immutable ledger rows'
);

select * from finish();
rollback;
