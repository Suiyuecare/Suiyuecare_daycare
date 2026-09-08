begin;

select plan(29);

select ok(
  has_function_privilege(
    'authenticated',
    'public.authorized_care_plan_view_snapshot(uuid,uuid,date,uuid,date,date,text,text,integer,integer)',
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'private.authorized_care_plan_view_snapshot(uuid,uuid,date,uuid,date,date,text,text,integer,integer)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.authorized_care_plan_view_snapshot(uuid,uuid,date,uuid,date,date,text,text,integer,integer)',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'public.authorized_care_plan_view_snapshot(uuid,uuid,date,uuid,date,date,text,text,integer,integer)',
    'execute'
  )
  and not (
    select procedure.prosecdef
    from pg_proc procedure
    where procedure.oid =
      'public.authorized_care_plan_view_snapshot(uuid,uuid,date,uuid,date,date,text,text,integer,integer)'::regprocedure
  ),
  'Page55 public snapshot is an authenticated-only SECURITY INVOKER boundary'
);

select ok(
  (
    select procedure.prosecdef
      and procedure.provolatile = 'v'
      and coalesce(procedure.proconfig, '{}'::text[]) @> array['search_path=""']
    from pg_proc procedure
    where procedure.oid =
      'private.authorized_care_plan_view_snapshot(uuid,uuid,date,uuid,date,date,text,text,integer,integer)'::regprocedure
  ),
  'private response function is fixed-search-path, volatile, and SECURITY DEFINER for audit writes'
);

select ok(
  not has_function_privilege(
    'authenticated', 'private.authorized_care_plan_view_bundle(uuid,uuid,date,uuid,date,date,text,text,integer,integer,timestamp with time zone,timestamp with time zone)', 'execute'
  )
  and not has_function_privilege(
    'authenticated', 'private.authorized_care_plan_view_content_envelope(jsonb)', 'execute'
  )
  and not has_function_privilege(
    'authenticated', 'private.authorized_care_plan_view_provenance_envelope(jsonb)', 'execute'
  ),
  'authenticated cannot invoke Page55 source and envelope helpers directly'
);

select ok(
  position('private.has_permission' in pg_get_functiondef(
    'private.authorized_care_plan_view_snapshot(uuid,uuid,date,uuid,date,date,text,text,integer,integer)'::regprocedure
  )) > 0
  and position('clients.read' in pg_get_functiondef(
    'private.authorized_care_plan_view_snapshot(uuid,uuid,date,uuid,date,date,text,text,integer,integer)'::regprocedure
  )) > 0
  and position('care_plans.read' in pg_get_functiondef(
    'private.authorized_care_plan_view_snapshot(uuid,uuid,date,uuid,date,date,text,text,integer,integer)'::regprocedure
  )) > 0
  and position('private.can_staff_access_client' in pg_get_functiondef(
    'private.authorized_care_plan_view_bundle(uuid,uuid,date,uuid,date,date,text,text,integer,integer,timestamp with time zone,timestamp with time zone)'::regprocedure
  )) > 0
  and position('public.audit_events' in pg_get_functiondef(
    'private.authorized_care_plan_view_snapshot(uuid,uuid,date,uuid,date,date,text,text,integer,integer)'::regprocedure
  )) > 0,
  'snapshot enforces both read scopes plus per-client scope and audits every successful read'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '95500000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'page55-manager@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '95500000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'page55-assigned@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '95500000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'page55-unassigned@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '95500000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'page55-client-only@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '95500000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'page55-other-org@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());

insert into public.organizations (id, code, name) values
  ('95510000-0000-4000-8000-000000000001', 'page55_org_a', 'Page55 機構 A'),
  ('95510000-0000-4000-8000-000000000002', 'page55_org_b', 'Page55 機構 B');

insert into public.branches (id, organization_id, code, name) values
  ('95520000-0000-4000-8000-000000000001', '95510000-0000-4000-8000-000000000001', 'main', 'Page55 A 主分支'),
  ('95520000-0000-4000-8000-000000000002', '95510000-0000-4000-8000-000000000001', 'second', 'Page55 A 第二分支'),
  ('95520000-0000-4000-8000-000000000003', '95510000-0000-4000-8000-000000000002', 'main', 'Page55 B 主分支');

insert into public.profiles (id, display_name, kind) values
  ('95500000-0000-4000-8000-000000000001', 'Page55 管理員', 'staff'),
  ('95500000-0000-4000-8000-000000000002', 'Page55 指派讀者', 'staff'),
  ('95500000-0000-4000-8000-000000000003', 'Page55 未指派讀者', 'staff'),
  ('95500000-0000-4000-8000-000000000004', 'Page55 缺少計畫權限', 'staff'),
  ('95500000-0000-4000-8000-000000000005', 'Page55 其他機構', 'staff');

insert into public.roles (id, organization_id, role_key, name, description, is_system) values
  ('95530000-0000-4000-8000-000000000001', '95510000-0000-4000-8000-000000000001', 'page55_assigned_reader', 'Page55 指派讀者', '雙讀取權限但不含 view_all', false),
  ('95530000-0000-4000-8000-000000000002', '95510000-0000-4000-8000-000000000001', 'page55_client_only', 'Page55 個案讀者', '刻意缺少 care_plans.read', false);

insert into public.role_permissions (role_id, permission_id)
select '95530000-0000-4000-8000-000000000001', permission.id
from public.permissions permission
where permission.permission_key in ('clients.read', 'care_plans.read');

insert into public.role_permissions (role_id, permission_id)
select '95530000-0000-4000-8000-000000000002', permission.id
from public.permissions permission
where permission.permission_key = 'clients.read';

insert into public.memberships (id, organization_id, branch_id, profile_id, status) values
  ('95540000-0000-4000-8000-000000000001', '95510000-0000-4000-8000-000000000001', null, '95500000-0000-4000-8000-000000000001', 'active'),
  ('95540000-0000-4000-8000-000000000002', '95510000-0000-4000-8000-000000000001', '95520000-0000-4000-8000-000000000001', '95500000-0000-4000-8000-000000000002', 'active'),
  ('95540000-0000-4000-8000-000000000003', '95510000-0000-4000-8000-000000000001', '95520000-0000-4000-8000-000000000001', '95500000-0000-4000-8000-000000000003', 'active'),
  ('95540000-0000-4000-8000-000000000004', '95510000-0000-4000-8000-000000000001', '95520000-0000-4000-8000-000000000001', '95500000-0000-4000-8000-000000000004', 'active'),
  ('95540000-0000-4000-8000-000000000005', '95510000-0000-4000-8000-000000000002', null, '95500000-0000-4000-8000-000000000005', 'active');

insert into public.membership_roles (membership_id, role_id) values
  ('95540000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002'),
  ('95540000-0000-4000-8000-000000000002', '95530000-0000-4000-8000-000000000001'),
  ('95540000-0000-4000-8000-000000000003', '95530000-0000-4000-8000-000000000001'),
  ('95540000-0000-4000-8000-000000000004', '95530000-0000-4000-8000-000000000002'),
  ('95540000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000002');

insert into public.clients (
  id, organization_id, branch_id, client_code, display_name, status, source_system
) values
  ('95550000-0000-4000-8000-000000000001', '95510000-0000-4000-8000-000000000001', '95520000-0000-4000-8000-000000000001', 'P55-A-001', 'Page55 指派個案', 'active', 'test'),
  ('95550000-0000-4000-8000-000000000002', '95510000-0000-4000-8000-000000000001', '95520000-0000-4000-8000-000000000001', 'P55-A-002', 'Page55 未指派個案', 'active', 'test'),
  ('95550000-0000-4000-8000-000000000003', '95510000-0000-4000-8000-000000000001', '95520000-0000-4000-8000-000000000002', 'P55-A-003', 'Page55 其他分支個案', 'active', 'test'),
  ('95550000-0000-4000-8000-000000000004', '95510000-0000-4000-8000-000000000002', '95520000-0000-4000-8000-000000000003', 'P55-B-001', 'Page55 其他機構個案', 'active', 'test');

insert into public.client_assignments (
  id, organization_id, branch_id, client_id, assignee_user_id, assignment_kind
) values (
  '95560000-0000-4000-8000-000000000001',
  '95510000-0000-4000-8000-000000000001',
  '95520000-0000-4000-8000-000000000001',
  '95550000-0000-4000-8000-000000000001',
  '95500000-0000-4000-8000-000000000002',
  'case_management'
);

insert into private.reauth_challenges (
  id, user_id, session_id, nonce_sha256, idempotency_key, issued_jwt_iat,
  issued_jwt_jti, created_at, expires_at, consumed_at, consumed_jwt_iat,
  consumed_jwt_jti, factor_method, factor_verified_at
) values (
  '95570000-0000-4000-8000-000000000001',
  '95500000-0000-4000-8000-000000000001',
  '95571000-0000-4000-8000-000000000001',
  repeat('5', 64),
  '95572000-0000-4000-8000-000000000001',
  clock_timestamp() - interval '2 minutes',
  'page55-before-stepup',
  clock_timestamp() - interval '2 minutes',
  clock_timestamp() + interval '5 minutes',
  clock_timestamp() - interval '30 seconds',
  clock_timestamp() - interval '30 seconds',
  'page55-after-stepup',
  'totp',
  clock_timestamp() - interval '30 seconds'
);

insert into public.authorized_care_plans (
  id, organization_id, branch_id, client_id, plan_key, version,
  previous_version_id, status, effective_from, effective_to, source_system,
  source_record_id, source_provenance, authorized_on, authorization_reference,
  service_limits, plan_data, correction_reason, idempotency_key, created_by,
  approved_by, approved_at, approval_evidence_hash, approval_reauth_challenge_id,
  signed_by, signed_at, signature_purpose, signature_reauth_challenge_id, content_hash
) values (
  '95580000-0000-4000-8000-000000000001',
  '95510000-0000-4000-8000-000000000001',
  '95520000-0000-4000-8000-000000000001',
  '95550000-0000-4000-8000-000000000001',
  '95581000-0000-4000-8000-000000000001', 1, null, 'signed',
  '2026-09-01', '2026-09-30', 'central_html', 'CENTRAL-P55-A-V1',
  '{"batch":"golden","locator":"A-K"}'::jsonb,
  '2026-08-28', 'AUTH-P55-A-001',
  '{"legacy_code":"BA01","amount":"<img src=x onerror=alert(1)>"}'::jsonb,
  '{"legacy_html":"<script>globalThis.pwned=true</script>","note":"原始"}'::jsonb,
  null, '95582000-0000-4000-8000-000000000001',
  '95500000-0000-4000-8000-000000000001',
  '95500000-0000-4000-8000-000000000001', clock_timestamp(), repeat('a', 64),
  '95570000-0000-4000-8000-000000000001',
  '95500000-0000-4000-8000-000000000001', clock_timestamp(), 'Page55 核定簽署',
  '95570000-0000-4000-8000-000000000001', repeat('b', 64)
), (
  '95580000-0000-4000-8000-000000000002',
  '95510000-0000-4000-8000-000000000001',
  '95520000-0000-4000-8000-000000000001',
  '95550000-0000-4000-8000-000000000001',
  '95581000-0000-4000-8000-000000000001', 2,
  '95580000-0000-4000-8000-000000000001', 'signed',
  '2026-10-01', '2026-10-31', 'central_html', 'CENTRAL-P55-A-V2',
  '{"batch":"golden","locator":"B-C-D"}'::jsonb,
  '2026-09-20', 'AUTH-P55-A-002',
  '{"legacy_code":"BA02","quantity":8}'::jsonb,
  '{"legacy_section":"future"}'::jsonb,
  '中央核定下一期間版本', '95582000-0000-4000-8000-000000000002',
  '95500000-0000-4000-8000-000000000001',
  '95500000-0000-4000-8000-000000000001', clock_timestamp(), repeat('c', 64),
  '95570000-0000-4000-8000-000000000001',
  '95500000-0000-4000-8000-000000000001', clock_timestamp(), 'Page55 未來核定簽署',
  '95570000-0000-4000-8000-000000000001', repeat('d', 64)
), (
  '95580000-0000-4000-8000-000000000003',
  '95510000-0000-4000-8000-000000000001',
  '95520000-0000-4000-8000-000000000001',
  '95550000-0000-4000-8000-000000000001',
  '95581000-0000-4000-8000-000000000001', 3,
  '95580000-0000-4000-8000-000000000002', 'draft',
  '2026-11-01', '2026-11-30', 'central_html', 'CENTRAL-P55-A-DRAFT',
  '{"batch":"draft"}'::jsonb, null, null,
  '{}'::jsonb, '{}'::jsonb, '尚未完成的新版草稿',
  '95582000-0000-4000-8000-000000000003',
  '95500000-0000-4000-8000-000000000001',
  null, null, null, null, null, null, null, null, null
);

insert into public.authorized_care_plans (
  id, organization_id, branch_id, client_id, plan_key, version, status,
  effective_from, effective_to, source_system, source_record_id,
  source_provenance, service_limits, plan_data, idempotency_key, created_by
) values
  ('95580000-0000-4000-8000-000000000010', '95510000-0000-4000-8000-000000000001', '95520000-0000-4000-8000-000000000001', '95550000-0000-4000-8000-000000000002', '95581000-0000-4000-8000-000000000010', 1, 'draft', '2026-09-01', '2026-12-31', 'legacy_import', null, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '95582000-0000-4000-8000-000000000010', '95500000-0000-4000-8000-000000000001'),
  ('95580000-0000-4000-8000-000000000020', '95510000-0000-4000-8000-000000000001', '95520000-0000-4000-8000-000000000002', '95550000-0000-4000-8000-000000000003', '95581000-0000-4000-8000-000000000020', 1, 'draft', '2026-09-01', '2026-12-31', 'branch_two', null, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '95582000-0000-4000-8000-000000000020', '95500000-0000-4000-8000-000000000001'),
  ('95580000-0000-4000-8000-000000000030', '95510000-0000-4000-8000-000000000002', '95520000-0000-4000-8000-000000000003', '95550000-0000-4000-8000-000000000004', '95581000-0000-4000-8000-000000000030', 1, 'draft', '2026-09-01', '2026-12-31', 'other_org', null, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '95582000-0000-4000-8000-000000000030', '95500000-0000-4000-8000-000000000005');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"95500000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',
  true
);

select ok(
  (
    select expires_at - generated_at = interval '60 seconds'
      and snapshot_hash = encode(sha256(convert_to(snapshot_json, 'UTF8')), 'hex')
      and snapshot_json::jsonb #>> '{bounds,max_page_size}' = '25'
      and snapshot_json::jsonb #>> '{claim_eligibility_status}' = 'not_asserted'
    from public.authorized_care_plan_view_snapshot(
      '95510000-0000-4000-8000-000000000001',
      '95520000-0000-4000-8000-000000000001',
      '2026-09-08'
    )
  ),
  'current AAL2 without recent-session reauth receives a 60-second hashed bounded snapshot'
);

select ok(
  (
    select position('Page55 其他分支個案' in snapshot_json) = 0
      and position('Page55 其他機構個案' in snapshot_json) = 0
    from public.authorized_care_plan_view_snapshot(
      '95510000-0000-4000-8000-000000000001',
      '95520000-0000-4000-8000-000000000001',
      '2026-09-08'
    )
  ),
  'branch snapshot contains no cross-branch or cross-tenant values'
);

select results_eq(
  $$select
      plan ->> 'effective_state',
      plan #>> '{workflow_head,status}',
      plan #>> '{published_head,version}',
      plan ->> 'current_published_id',
      plan ->> 'display_version_id'
    from public.authorized_care_plan_view_snapshot(
      '95510000-0000-4000-8000-000000000001',
      '95520000-0000-4000-8000-000000000001',
      '2026-09-08'
    ) snapshot
    cross join lateral jsonb_array_elements(snapshot.snapshot_json::jsonb -> 'plans') plan
    where plan ->> 'plan_key' = '95581000-0000-4000-8000-000000000001'$$,
  $$values (
    'current'::text,
    'draft'::text,
    '2'::text,
    '95580000-0000-4000-8000-000000000001'::text,
    '95580000-0000-4000-8000-000000000002'::text
  )$$,
  'future published v2 and later draft v3 do not hide the date-effective signed v1'
);

select results_eq(
  $$select
      history -> 'plan_data' ->> 'value_state',
      history -> 'plan_data' ->> 'mapping_status',
      (history -> 'plan_data' ->> 'canonical_json')::jsonb ->> 'legacy_html',
      (history -> 'source_provenance' ->> 'canonical_json')::jsonb ->> 'locator'
    from public.authorized_care_plan_view_snapshot(
      '95510000-0000-4000-8000-000000000001',
      '95520000-0000-4000-8000-000000000001',
      '2026-09-08',
      '95550000-0000-4000-8000-000000000001'
    ) snapshot
    cross join lateral jsonb_array_elements(snapshot.snapshot_json::jsonb -> 'plans') plan
    cross join lateral jsonb_array_elements(plan -> 'history') history
    where history ->> 'version_id' = '95580000-0000-4000-8000-000000000001'$$,
  $$values (
    'unknown'::text,
    'needs_mapping'::text,
    '<script>globalThis.pwned=true</script>'::text,
    'A-K'::text
  )$$,
  'unknown legacy content and exact provenance remain bounded text with needs_mapping'
);

select results_eq(
  $$select
      (snapshot_json::jsonb #>> '{metrics,matching_stream_total}')::integer,
      (snapshot_json::jsonb #>> '{metrics,page_stream_count}')::integer,
      (snapshot_json::jsonb #>> '{metrics,history_version_count}')::integer,
      (snapshot_json::jsonb #>> '{metrics,current_total}')::integer,
      (snapshot_json::jsonb #>> '{metrics,not_published_total}')::integer,
      (snapshot_json::jsonb #>> '{metrics,needs_mapping_total}')::integer
    from public.authorized_care_plan_view_snapshot(
      '95510000-0000-4000-8000-000000000001',
      '95520000-0000-4000-8000-000000000001',
      '2026-09-08'
    )$$,
  $$values (2, 2, 4, 1, 1, 1)$$,
  'same snapshot carries exact full-filter totals, page rows, and selected complete history totals'
);

select results_eq(
  $$select
      (snapshot_json::jsonb #>> '{metrics,matching_stream_total}')::integer,
      (snapshot_json::jsonb #>> '{metrics,history_version_count}')::integer,
      jsonb_array_length(snapshot_json::jsonb -> 'client_options')
    from public.authorized_care_plan_view_snapshot(
      '95510000-0000-4000-8000-000000000001',
      '95520000-0000-4000-8000-000000000001',
      '2026-09-08', null, null, null, 'current', null, 1, 25
    )$$,
  $$values (1, 3, 2)$$,
  'effective filter, complete selected history, and authorized options share one source snapshot'
);

select results_eq(
  $$select option ->> 'source_system', (option ->> 'record_count')::integer
    from public.authorized_care_plan_view_snapshot(
      '95510000-0000-4000-8000-000000000001',
      '95520000-0000-4000-8000-000000000001',
      '2026-09-08'
    ) snapshot
    cross join lateral jsonb_array_elements(snapshot.snapshot_json::jsonb -> 'source_options') option
    order by option ->> 'source_system'$$,
  $$values ('central_html'::text, 1), ('legacy_import'::text, 1)$$,
  'source options use the exact displayed immutable version source'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"95500000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}',
  true
);
select throws_ok(
  $$select * from public.authorized_care_plan_view_snapshot(
    '95510000-0000-4000-8000-000000000001',
    '95520000-0000-4000-8000-000000000001', '2026-09-08'
  )$$,
  '42501', null,
  'AAL1 cannot read Page55'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"95500000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2"}',
  true
);
select throws_ok(
  $$select * from public.authorized_care_plan_view_snapshot(
    '95510000-0000-4000-8000-000000000001',
    '95520000-0000-4000-8000-000000000001', '2026-09-08'
  )$$,
  '42501', null,
  'clients.read without care_plans.read cannot open Page55'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"95500000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}',
  true
);
select throws_ok(
  $$select * from public.authorized_care_plan_view_snapshot(
    '95510000-0000-4000-8000-000000000001',
    '95520000-0000-4000-8000-000000000002', '2026-09-08'
  )$$,
  '42501', null,
  'branch-scoped assigned reader cannot switch to another branch'
);

select throws_ok(
  $$select * from public.authorized_care_plan_view_snapshot(
    '95510000-0000-4000-8000-000000000001',
    '95520000-0000-4000-8000-000000000001', '2026-09-08',
    '95550000-0000-4000-8000-000000000002'
  )$$,
  '42501', null,
  'explicit unassigned-client filter fails closed'
);

select is(
  (
    select (snapshot_json::jsonb #>> '{metrics,matching_stream_total}')::integer
    from public.authorized_care_plan_view_snapshot(
      '95510000-0000-4000-8000-000000000001',
      '95520000-0000-4000-8000-000000000001', '2026-09-08'
    )
  ),
  1,
  'assigned reader sees only the assigned client plan stream'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"95500000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}',
  true
);
select is(
  (
    select (snapshot_json::jsonb #>> '{metrics,matching_stream_total}')::integer
    from public.authorized_care_plan_view_snapshot(
      '95510000-0000-4000-8000-000000000001',
      '95520000-0000-4000-8000-000000000001', '2026-09-08'
    )
  ),
  0,
  'unassigned reader receives a truthful empty snapshot rather than branch data'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"95500000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal2"}',
  true
);
select throws_ok(
  $$select * from public.authorized_care_plan_view_snapshot(
    '95510000-0000-4000-8000-000000000001',
    '95520000-0000-4000-8000-000000000001', '2026-09-08'
  )$$,
  '42501', null,
  'another tenant manager cannot read the requested organization'
);

reset role;

select throws_ok(
  $$update public.authorized_care_plans
    set plan_data = '{"tampered":true}'::jsonb
    where id = '95580000-0000-4000-8000-000000000001'$$,
  '55000', null,
  'authorized plan versions remain append-only against direct UPDATE'
);

select throws_ok(
  $$delete from public.authorized_care_plans
    where id = '95580000-0000-4000-8000-000000000001'$$,
  '55000', null,
  'authorized plan versions remain append-only against direct DELETE'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"95500000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',
  true
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
      '95580000-0000-4000-8000-000000000004',
      '95510000-0000-4000-8000-000000000001',
      '95520000-0000-4000-8000-000000000001',
      '95550000-0000-4000-8000-000000000001',
      '95581000-0000-4000-8000-000000000001', 4,
      '95580000-0000-4000-8000-000000000003', 'voided',
      '2026-09-01', '2026-09-30', 'central_html', 'CENTRAL-P55-A-VOID',
      '{"batch":"golden","locator":"void"}'::jsonb,
      '2026-08-28', 'AUTH-P55-A-001',
      '{"legacy_code":"BA01"}'::jsonb, '{"legacy_section":"void"}'::jsonb,
      '主管機關作廢指定期間', '95582000-0000-4000-8000-000000000004',
      '95500000-0000-4000-8000-000000000001',
      '95500000-0000-4000-8000-000000000001', clock_timestamp(), repeat('e', 64),
      '95570000-0000-4000-8000-000000000001',
      '95500000-0000-4000-8000-000000000001', clock_timestamp(), 'Page55 作廢簽署',
      '95570000-0000-4000-8000-000000000001', repeat('f', 64)
    )$$,
  'a later immutable void version can terminally invalidate its matching period'
);

set local role authenticated;

select results_eq(
  $$select
      plan ->> 'effective_state',
      plan ->> 'current_published_id',
      plan ->> 'date_terminal_id',
      plan ->> 'date_terminal_status',
      plan #>> '{workflow_head,version}'
    from public.authorized_care_plan_view_snapshot(
      '95510000-0000-4000-8000-000000000001',
      '95520000-0000-4000-8000-000000000001', '2026-09-08',
      '95550000-0000-4000-8000-000000000001'
    ) snapshot
    cross join lateral jsonb_array_elements(snapshot.snapshot_json::jsonb -> 'plans') plan$$,
  $$values (
    'voided'::text,
    null::text,
    '95580000-0000-4000-8000-000000000004'::text,
    'voided'::text,
    '4'::text
  )$$,
  'date-terminal void removes currentPublishedId while retaining the exact workflow head'
);

select results_eq(
  $$select
      history ->> 'source_record_id',
      (history -> 'source_provenance' ->> 'canonical_json')::jsonb ->> 'locator',
      history #>> '{plan_data,mapping_status}',
      plan ->> 'history_count'
    from public.authorized_care_plan_view_snapshot(
      '95510000-0000-4000-8000-000000000001',
      '95520000-0000-4000-8000-000000000001', '2026-09-08',
      '95550000-0000-4000-8000-000000000001'
    ) snapshot
    cross join lateral jsonb_array_elements(snapshot.snapshot_json::jsonb -> 'plans') plan
    cross join lateral jsonb_array_elements(plan -> 'history') history
    where history ->> 'version_id' = '95580000-0000-4000-8000-000000000004'$$,
  $$values ('CENTRAL-P55-A-VOID'::text, 'void'::text, 'needs_mapping'::text, '4'::text)$$,
  'void history preserves exact central source evidence and the complete four-version chain'
);

reset role;

select lives_ok(
  $$insert into public.authorized_care_plans (
      id, organization_id, branch_id, client_id, plan_key, version, status,
      effective_from, effective_to, source_system, source_provenance,
      service_limits, plan_data, idempotency_key, created_by
    ) values (
      '95580000-0000-4000-8000-000000000021',
      '95510000-0000-4000-8000-000000000001',
      '95520000-0000-4000-8000-000000000002',
      '95550000-0000-4000-8000-000000000003',
      '95581000-0000-4000-8000-000000000021', 1, 'draft',
      '2026-09-01', '2026-12-31', 'oversized_legacy', '{}'::jsonb,
      '{}'::jsonb, jsonb_build_object('blob', repeat('x', 66000)),
      '95582000-0000-4000-8000-000000000021',
      '95500000-0000-4000-8000-000000000001'
    )$$,
  'legacy fixture can exist while the bounded Page55 projection remains fail closed'
);

set local role authenticated;

select throws_ok(
  $$select * from public.authorized_care_plan_view_snapshot(
    '95510000-0000-4000-8000-000000000001',
    '95520000-0000-4000-8000-000000000002', '2026-09-08'
  )$$,
  '54000', null,
  'snapshot rejects a selected complete history whose content exceeds 64 KiB'
);

select throws_ok(
  $$select * from public.authorized_care_plan_view_snapshot(
    '95510000-0000-4000-8000-000000000001',
    '95520000-0000-4000-8000-000000000001', '2026-09-08',
    null, null, null, 'all', null, 0, 25
  )$$,
  '42501', null,
  'invalid page bounds fail closed before any source read'
);

reset role;

select is(
  (
    select count(*)::integer
    from public.audit_events event
    where event.table_name = 'authorized_care_plan_view_snapshot'
      and event.action = 'select'
      and event.actor_user_id in (
        '95500000-0000-4000-8000-000000000001',
        '95500000-0000-4000-8000-000000000002',
        '95500000-0000-4000-8000-000000000003'
      )
  ),
  11,
  'every successful Page55 read writes exactly one audit event while rejected reads write none'
);

select ok(
  not exists (
    select 1
    from public.audit_events event
    where event.table_name = 'authorized_care_plan_view_snapshot'
      and event.actor_user_id in (
        '95500000-0000-4000-8000-000000000001',
        '95500000-0000-4000-8000-000000000002',
        '95500000-0000-4000-8000-000000000003'
      )
      and (
        event.metadata::text like '%95550000-%'
        or event.metadata::text like '%Page55%'
        or event.metadata::text like '%CENTRAL-P55%'
        or event.metadata::text like '%<script>%'
        or event.metadata ? 'snapshot_hash'
        or event.metadata ? 'filter_value'
      )
  ),
  'Page55 audit metadata contains counts and filter-presence only, never client, source, content, or hash values'
);

select ok(
  (
    select count(*) = 1
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'authorized_care_plan_view_snapshot'
  )
  and (
    select count(*) = 0
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname like 'authorized_care_plan_view_%'
      and procedure.proname <> 'authorized_care_plan_view_snapshot'
  ),
  'Page55 exposes one read-only public RPC and no public mutation or raw helper'
);

select * from finish();
rollback;
