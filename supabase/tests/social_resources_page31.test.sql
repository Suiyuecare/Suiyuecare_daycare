begin;

select plan(49);

select results_eq(
  $$select permission_key collate "C" from public.permissions
    where permission_key like 'social_resources.%' order by permission_key collate "C"$$,
  $$values
    ('social_resources.manage'::text collate "C"),
    ('social_resources.read'::text collate "C")$$,
  'page 31 has separate read and manage permissions'
);

select results_eq(
  $$select role.role_key collate "C"
    from public.role_permissions grant_row
    join public.roles role on role.id = grant_row.role_id
    join public.permissions permission on permission.id = grant_row.permission_id
    where permission.permission_key = 'social_resources.manage'
      and role.is_system order by role.role_key collate "C"$$,
  $$values
    ('branch_supervisor'::text collate "C"),
    ('case_manager_social_worker'::text collate "C"),
    ('organization_manager'::text collate "C")$$,
  'manage permission is conservatively seeded to managers, supervisors and social workers'
);

select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.social_resources'::regclass),
  'social resources enforce RLS'
);

select ok(
  not has_table_privilege('anon', 'public.social_resources', 'select,insert,update,delete')
  and not has_table_privilege('authenticated', 'public.social_resources', 'select,insert,update,delete')
  and not has_table_privilege('service_role', 'public.social_resources', 'select,insert,update,delete'),
  'client and service roles cannot access the base resource table directly'
);

select ok(
  has_function_privilege('authenticated', 'public.social_resource_snapshot(uuid,uuid,integer,text,text,text,text)', 'execute')
  and not has_function_privilege('anon', 'public.social_resource_snapshot(uuid,uuid,integer,text,text,text,text)', 'execute')
  and not has_function_privilege('service_role', 'public.social_resource_snapshot(uuid,uuid,integer,text,text,text,text)', 'execute'),
  'snapshot RPC is authenticated-only'
);

select ok(
  has_function_privilege('authenticated', 'public.create_social_resource(uuid,uuid,integer,text,text,text,text,text,text,text,text,text,date,date,uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.update_social_resource(uuid,uuid,uuid,integer,text,text,text,text,text,text,text,text,text,date,date,bigint,uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.confirm_social_resource(uuid,uuid,uuid,bigint,uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.deactivate_social_resource(uuid,uuid,uuid,bigint,text,uuid)', 'execute')
  and not has_function_privilege('service_role', 'public.confirm_social_resource(uuid,uuid,uuid,bigint,uuid)', 'execute'),
  'all four write boundaries are authenticated-only and service-role cannot bypass them'
);

select ok(
  not (select prosecdef from pg_proc where oid = 'public.social_resource_snapshot(uuid,uuid,integer,text,text,text,text)'::regprocedure)
  and not (select prosecdef from pg_proc where oid = 'public.create_social_resource(uuid,uuid,integer,text,text,text,text,text,text,text,text,text,date,date,uuid)'::regprocedure),
  'public wrappers are SECURITY INVOKER'
);

select ok(
  (select prosecdef and coalesce(proconfig, '{}'::text[]) @> array['search_path=""']
   from pg_proc where oid = 'private.social_resource_snapshot_response(uuid,uuid,integer,text,text,text,text)'::regprocedure)
  and
  (select prosecdef and coalesce(proconfig, '{}'::text[]) @> array['search_path=""']
   from pg_proc where oid = 'private.manage_social_resource_atomic(text,uuid,uuid,uuid,integer,text,text,text,text,text,text,text,text,text,date,date,bigint,text,uuid)'::regprocedure),
  'private definer functions pin an empty search path'
);

select ok(
  position('pg_advisory_xact_lock' in pg_get_functiondef(
    'private.manage_social_resource_atomic(text,uuid,uuid,uuid,integer,text,text,text,text,text,text,text,text,text,date,date,bigint,text,uuid)'::regprocedure
  )) > 0
  and position('actor_user_id = v_actor' in pg_get_functiondef(
    'private.manage_social_resource_atomic(text,uuid,uuid,uuid,integer,text,text,text,text,text,text,text,text,text,date,date,bigint,text,uuid)'::regprocedure
  )) > 0,
  'writes serialize and replay by current actor plus idempotency key'
);

select ok(
  pg_get_function_result('public.social_resource_snapshot(uuid,uuid,integer,text,text,text,text)'::regprocedure)
    !~ '(created_by|updated_by|inactive_reason|actor_user_id|request_hash)',
  'snapshot output omits actor identities, deactivation reason and replay hashes'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '31000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'resource-manager@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '31000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'resource-social@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '31000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'resource-nurse@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '31000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'resource-other@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '31000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'resource-family@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());

insert into public.organizations (id, code, name) values
  ('31100000-0000-4000-8000-000000000001', 'resource_a', '資源測試機構 A'),
  ('31100000-0000-4000-8000-000000000002', 'resource_b', '資源測試機構 B');

insert into public.branches (id, organization_id, code, name) values
  ('31200000-0000-4000-8000-000000000001', '31100000-0000-4000-8000-000000000001', 'main', 'A 主分支'),
  ('31200000-0000-4000-8000-000000000002', '31100000-0000-4000-8000-000000000001', 'second', 'A 第二分支'),
  ('31200000-0000-4000-8000-000000000003', '31100000-0000-4000-8000-000000000002', 'main', 'B 主分支');

insert into public.profiles (id, display_name, kind) values
  ('31000000-0000-4000-8000-000000000001', '機構管理員', 'staff'),
  ('31000000-0000-4000-8000-000000000002', '分支社工', 'staff'),
  ('31000000-0000-4000-8000-000000000003', '無資源權護理師', 'staff'),
  ('31000000-0000-4000-8000-000000000004', '其他機構管理員', 'staff'),
  ('31000000-0000-4000-8000-000000000005', '家屬', 'family');

insert into public.memberships (id, organization_id, branch_id, profile_id, status) values
  ('31300000-0000-4000-8000-000000000001', '31100000-0000-4000-8000-000000000001', null, '31000000-0000-4000-8000-000000000001', 'active'),
  ('31300000-0000-4000-8000-000000000002', '31100000-0000-4000-8000-000000000001', '31200000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000002', 'active'),
  ('31300000-0000-4000-8000-000000000003', '31100000-0000-4000-8000-000000000001', '31200000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000003', 'active'),
  ('31300000-0000-4000-8000-000000000004', '31100000-0000-4000-8000-000000000002', null, '31000000-0000-4000-8000-000000000004', 'active'),
  ('31300000-0000-4000-8000-000000000005', '31100000-0000-4000-8000-000000000001', '31200000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000005', 'active');

insert into public.membership_roles (membership_id, role_id) values
  ('31300000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002'),
  ('31300000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000004'),
  ('31300000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000005'),
  ('31300000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000002'),
  ('31300000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000010');

insert into public.social_resources (
  id, organization_id, branch_id, reference_year, name, resource_type,
  audience_state, audience_detail, eligibility_state, eligibility_detail,
  contact_state, contact_detail, validity_state, valid_from, valid_until,
  last_confirmed_on, status, inactive_reason, inactivated_at, inactivated_by,
  created_by, updated_by
) values
  ('31400000-0000-4000-8000-000000000001', '31100000-0000-4000-8000-000000000001', '31200000-0000-4000-8000-000000000001', 2026, '未來生效資源', '社區支持', 'provided', '主要照顧者', 'missing', null, 'provided', '合成窗口 A', 'date_range', ((now() at time zone 'Asia/Taipei')::date + 10), ((now() at time zone 'Asia/Taipei')::date + 40), null, 'active', null, null, null, '31000000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000001'),
  ('31400000-0000-4000-8000-000000000002', '31100000-0000-4000-8000-000000000001', '31200000-0000-4000-8000-000000000001', 2025, '已到期資源', '福利諮詢', 'not_applicable', null, 'provided', '人工審核', 'missing', null, 'date_range', ((now() at time zone 'Asia/Taipei')::date - 400), ((now() at time zone 'Asia/Taipei')::date - 1), ((now() at time zone 'Asia/Taipei')::date - 30), 'active', null, null, null, '31000000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000001'),
  ('31400000-0000-4000-8000-000000000003', '31100000-0000-4000-8000-000000000001', '31200000-0000-4000-8000-000000000001', 2026, '期限缺值資源', '社區支持', 'missing', null, 'not_applicable', null, 'not_applicable', null, 'missing', null, null, null, 'active', null, null, null, '31000000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000001'),
  ('31400000-0000-4000-8000-000000000004', '31100000-0000-4000-8000-000000000001', '31200000-0000-4000-8000-000000000001', 2024, '停用資源', '舊資源', 'provided', '一般民眾', 'provided', '舊規則', 'provided', '舊窗口', 'not_applicable', null, null, '2024-01-01', 'inactive', '年度結束', now(), '31000000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000001'),
  ('31400000-0000-4000-8000-000000000005', '31100000-0000-4000-8000-000000000001', '31200000-0000-4000-8000-000000000002', 2026, '他分支資源', '社區支持', 'provided', '主要照顧者', 'provided', '人工確認', 'provided', '合成窗口 B', 'not_applicable', null, null, null, 'active', null, null, null, '31000000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000001'),
  ('31400000-0000-4000-8000-000000000006', '31100000-0000-4000-8000-000000000002', '31200000-0000-4000-8000-000000000003', 2026, '其他機構資源', '社區支持', 'provided', '主要照顧者', 'provided', '人工確認', 'provided', '合成窗口 C', 'not_applicable', null, null, null, 'active', null, null, null, '31000000-0000-4000-8000-000000000004', '31000000-0000-4000-8000-000000000004');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"31000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);

select is(
  (select item_total from public.social_resource_snapshot(
    '31100000-0000-4000-8000-000000000001',
    '31200000-0000-4000-8000-000000000001',
    null, null, 'all', null, null
  )),
  4::bigint,
  'manager receives only the exact selected branch total'
);

select is(
  (select effective_total from public.social_resource_snapshot(
    '31100000-0000-4000-8000-000000000001',
    '31200000-0000-4000-8000-000000000001',
    null, null, 'all', null, null
  )),
  0::bigint,
  'future, expired, missing-validity and inactive resources are not effective'
);

select is(
  (select expired_total from public.social_resource_snapshot(
    '31100000-0000-4000-8000-000000000001',
    '31200000-0000-4000-8000-000000000001',
    null, null, 'all', null, null
  )),
  1::bigint,
  'expired metric independently counts the dated expired row'
);

select is(
  (select pending_confirmation_total from public.social_resource_snapshot(
    '31100000-0000-4000-8000-000000000001',
    '31200000-0000-4000-8000-000000000001',
    null, null, 'all', null, null
  )),
  2::bigint,
  'pending confirmation counts only explicit missing confirmation dates'
);

select is(
  (select expiry_rule_status from public.social_resource_snapshot(
    '31100000-0000-4000-8000-000000000001',
    '31200000-0000-4000-8000-000000000001',
    null, null, 'all', null, null
  )),
  'not_configured'::text,
  'snapshot refuses to invent an expiring-soon threshold'
);

select is(
  (select confirmation_rule_status from public.social_resource_snapshot(
    '31100000-0000-4000-8000-000000000001',
    '31200000-0000-4000-8000-000000000001',
    null, null, 'all', null, null
  )),
  'missing_date_only'::text,
  'snapshot exposes the narrow technical pending-confirmation rule'
);

select ok(
  (select not type_options_truncated and not audience_options_truncated
   from public.social_resource_snapshot(
    '31100000-0000-4000-8000-000000000001',
    '31200000-0000-4000-8000-000000000001',
    null, null, 'all', null, null
  )),
  'filter option lists explicitly report whether their 200-value bounds truncated data'
);

select is(
  (select item_total from public.social_resource_snapshot(
    '31100000-0000-4000-8000-000000000001',
    '31200000-0000-4000-8000-000000000001',
    2026, '社區支持', 'active', '主要照顧者', '未來'
  )),
  1::bigint,
  'year, type, status, audience and keyword filters compose exactly'
);

select is(
  (select item_total from public.social_resource_snapshot(
    '31100000-0000-4000-8000-000000000001',
    '31200000-0000-4000-8000-000000000001',
    null, null, 'all', '__missing__', null
  )),
  1::bigint,
  'audience missing is distinct from not applicable'
);

select is(
  (select item_total from public.social_resource_snapshot(
    '31100000-0000-4000-8000-000000000001',
    '31200000-0000-4000-8000-000000000001',
    null, null, 'all', '__not_applicable__', null
  )),
  1::bigint,
  'audience not applicable is independently filterable'
);

select is(
  (select jsonb_array_length(items) from public.social_resource_snapshot(
    '31100000-0000-4000-8000-000000000001',
    '31200000-0000-4000-8000-000000000001',
    null, null, 'all', null, null
  )),
  4,
  'snapshot item projection matches its untruncated total'
);

select is(
  (select item_total from public.social_resource_snapshot(
    '31100000-0000-4000-8000-000000000001',
    '31200000-0000-4000-8000-000000000002',
    null, null, 'all', null, null
  )),
  1::bigint,
  'organization-wide manager may deliberately select another branch in the same organization'
);

select throws_ok(
  $$select * from public.social_resource_snapshot(
    '31100000-0000-4000-8000-000000000002',
    '31200000-0000-4000-8000-000000000003',
    null, null, 'all', null, null
  )$$,
  '42501',
  'social resource snapshot is not permitted in the selected tenant context',
  'cross-organization snapshot is denied'
);

reset role;

select ok(
  (select count(*) from public.audit_events
   where actor_user_id = '31000000-0000-4000-8000-000000000001'
     and table_name = 'social_resources'
     and action = 'select') >= 11,
  'each successful view or search writes an audit event'
);

select ok(
  not exists (
    select 1 from public.audit_events event
    where event.actor_user_id = '31000000-0000-4000-8000-000000000001'
      and event.table_name = 'social_resources'
      and event.metadata::text ~ '(未來生效|主要照顧者|合成窗口|社區支持)'
  ),
  'snapshot audit excludes search strings and resource content'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"31000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}', true);

select throws_ok(
  $$select * from public.social_resource_snapshot(
    '31100000-0000-4000-8000-000000000001',
    '31200000-0000-4000-8000-000000000001', null, null, 'all', null, null
  )$$,
  '42501',
  'social resource snapshot is not permitted in the selected tenant context',
  'staff without page read permission is denied'
);

select set_config('request.jwt.claims', '{"sub":"31000000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal1"}', true);
select throws_ok(
  $$select * from public.social_resource_snapshot(
    '31100000-0000-4000-8000-000000000001',
    '31200000-0000-4000-8000-000000000001', null, null, 'all', null, null
  )$$,
  '42501',
  'social resource snapshot is not permitted in the selected tenant context',
  'family AAL1 context cannot enter staff resource snapshot'
);

select set_config('request.jwt.claims', '{"sub":"31000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}', true);
select throws_ok(
  $$select * from public.create_social_resource(
    '31100000-0000-4000-8000-000000000001',
    '31200000-0000-4000-8000-000000000001', 2026, 'AAL1 資源', '測試',
    'missing', null, 'missing', null, 'missing', null, 'missing', null, null,
    '31500000-0000-4000-8000-000000000001'
  )$$,
  '42501',
  'social resource operation is not permitted in the selected tenant context',
  'AAL1 staff cannot write a social resource'
);

select set_config('request.jwt.claims', '{"sub":"31000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);

select lives_ok(
  $$select * from public.create_social_resource(
    '31100000-0000-4000-8000-000000000001',
    '31200000-0000-4000-8000-000000000001', 2026, '新建資源', '社區支持',
    'provided', '照顧者', 'missing', null, 'provided', '合成新窗口',
    'open_ended', (now() at time zone 'Asia/Taipei')::date, null,
    '31500000-0000-4000-8000-000000000002'
  )$$,
  'authorized manager can create an explicit-state resource'
);

select is(
  (select replayed from public.create_social_resource(
    '31100000-0000-4000-8000-000000000001',
    '31200000-0000-4000-8000-000000000001', 2026, '新建資源', '社區支持',
    'provided', '照顧者', 'missing', null, 'provided', '合成新窗口',
    'open_ended', (now() at time zone 'Asia/Taipei')::date, null,
    '31500000-0000-4000-8000-000000000002'
  )),
  true,
  'exact create replay returns the stored receipt'
);

reset role;
select is(
  (select count(*)::integer from private.social_resource_operations
   where actor_user_id = '31000000-0000-4000-8000-000000000001'
     and idempotency_key = '31500000-0000-4000-8000-000000000002'),
  1,
  'exact create replay stores one actor-scoped operation only'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"31000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);

select throws_ok(
  $$select * from public.create_social_resource(
    '31100000-0000-4000-8000-000000000001',
    '31200000-0000-4000-8000-000000000001', 2026, '不同名稱', '社區支持',
    'provided', '照顧者', 'missing', null, 'provided', '合成新窗口',
    'open_ended', (now() at time zone 'Asia/Taipei')::date, null,
    '31500000-0000-4000-8000-000000000002'
  )$$,
  '23505',
  'social resource idempotency conflict',
  'same actor and key with different content is rejected'
);

select lives_ok(
  $$select * from public.update_social_resource(
    '31100000-0000-4000-8000-000000000001',
    '31200000-0000-4000-8000-000000000001',
    '31400000-0000-4000-8000-000000000001', 2026, '未來生效資源新版',
    '社區支持', 'provided', '主要照顧者', 'missing', null, 'provided',
    '合成窗口 A', 'date_range',
    ((now() at time zone 'Asia/Taipei')::date + 10),
    ((now() at time zone 'Asia/Taipei')::date + 40), 1,
    '31500000-0000-4000-8000-000000000003'
  )$$,
  'version-matched active resource can be updated'
);

reset role;
select is(
  (select row_version from public.social_resources where id = '31400000-0000-4000-8000-000000000001'),
  2::bigint,
  'update increments row version exactly once'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"31000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);

select is(
  (select replayed from public.update_social_resource(
    '31100000-0000-4000-8000-000000000001',
    '31200000-0000-4000-8000-000000000001',
    '31400000-0000-4000-8000-000000000001', 2026, '未來生效資源新版',
    '社區支持', 'provided', '主要照顧者', 'missing', null, 'provided',
    '合成窗口 A', 'date_range',
    ((now() at time zone 'Asia/Taipei')::date + 10),
    ((now() at time zone 'Asia/Taipei')::date + 40), 1,
    '31500000-0000-4000-8000-000000000003'
  )),
  true,
  'exact update replay preserves the original version receipt'
);

select throws_ok(
  $$select * from public.confirm_social_resource(
    '31100000-0000-4000-8000-000000000001',
    '31200000-0000-4000-8000-000000000001',
    '31400000-0000-4000-8000-000000000001', 1,
    '31500000-0000-4000-8000-000000000004'
  )$$,
  '40001',
  'social resource version conflict',
  'stale expected version is rejected'
);

select lives_ok(
  $$select * from public.confirm_social_resource(
    '31100000-0000-4000-8000-000000000001',
    '31200000-0000-4000-8000-000000000001',
    '31400000-0000-4000-8000-000000000001', 2,
    '31500000-0000-4000-8000-000000000005'
  )$$,
  'version-matched resource can update its confirmation date'
);

reset role;
select is(
  (select last_confirmed_on from public.social_resources where id = '31400000-0000-4000-8000-000000000001'),
  (now() at time zone 'Asia/Taipei')::date,
  'confirmation uses server-derived Taiwan date'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"31000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);

select lives_ok(
  $$select * from public.deactivate_social_resource(
    '31100000-0000-4000-8000-000000000001',
    '31200000-0000-4000-8000-000000000001',
    '31400000-0000-4000-8000-000000000001', 3, '承辦單位停止提供',
    '31500000-0000-4000-8000-000000000006'
  )$$,
  'resource can be deactivated with a reason'
);

reset role;
select is(
  (select status from public.social_resources where id = '31400000-0000-4000-8000-000000000001'),
  'inactive'::text,
  'deactivation persists inactive state'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"31000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);

select throws_ok(
  $$select * from public.confirm_social_resource(
    '31100000-0000-4000-8000-000000000001',
    '31200000-0000-4000-8000-000000000001',
    '31400000-0000-4000-8000-000000000001', 4,
    '31500000-0000-4000-8000-000000000007'
  )$$,
  '23514',
  'inactive social resources are immutable',
  'inactive resource cannot be confirmed or rewritten'
);

select throws_ok(
  $$select * from public.update_social_resource(
    '31100000-0000-4000-8000-000000000001',
    '31200000-0000-4000-8000-000000000002',
    '31400000-0000-4000-8000-000000000002', 2025, '跨分支竄改', '福利諮詢',
    'not_applicable', null, 'provided', '人工審核', 'missing', null,
    'date_range', ((now() at time zone 'Asia/Taipei')::date - 400),
    ((now() at time zone 'Asia/Taipei')::date - 1), 1,
    '31500000-0000-4000-8000-000000000008'
  )$$,
  '42501',
  'social resource target is not available in the selected tenant context',
  'resource id cannot be paired with another branch scope'
);

reset role;

select is(
  (select count(*)::integer from public.audit_events
   where table_name = 'social_resources'
     and actor_user_id = '31000000-0000-4000-8000-000000000001'
     and action in ('insert', 'update')),
  4,
  'create, update, confirm and deactivate each write one mutation audit event'
);

select ok(
  not exists (
    select 1 from public.audit_events event
    where event.table_name = 'social_resources'
      and event.action in ('insert', 'update')
      and event.metadata::text ~ '(承辦單位停止提供|合成窗口|主要照顧者)'
  ),
  'write audit metadata excludes contact, audience and deactivation free text'
);

select throws_ok(
  $$update private.social_resource_operations set result_row_version = result_row_version + 1
    where idempotency_key = '31500000-0000-4000-8000-000000000002'$$,
  '55000',
  'social resource operation receipts are immutable',
  'operation receipts cannot be updated even by a migration role'
);

select throws_ok(
  $$delete from private.social_resource_operations
    where idempotency_key = '31500000-0000-4000-8000-000000000002'$$,
  '55000',
  'social resource operation receipts are immutable',
  'operation receipts cannot be deleted'
);

select throws_ok(
  $$insert into public.social_resources (
      organization_id, branch_id, reference_year, name, resource_type,
      audience_state, audience_detail, eligibility_state, eligibility_detail,
      contact_state, contact_detail, validity_state, valid_from, valid_until,
      created_by, updated_by
    ) values (
      '31100000-0000-4000-8000-000000000001',
      '31200000-0000-4000-8000-000000000001', 2026, '錯誤狀態', '測試',
      'not_applicable', '不應存在', 'missing', null, 'missing', null,
      'missing', null, null,
      '31000000-0000-4000-8000-000000000001',
      '31000000-0000-4000-8000-000000000001'
    )$$,
  '23514',
  null,
  'database rejects detail text when the field is marked not applicable'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"31000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}', true);

select lives_ok(
  $$select * from public.create_social_resource(
    '31100000-0000-4000-8000-000000000001',
    '31200000-0000-4000-8000-000000000001', 2026, '社工同鍵資源', '社區支持',
    'missing', null, 'not_applicable', null, 'not_applicable', null,
    'not_applicable', null, null,
    '31500000-0000-4000-8000-000000000002'
  )$$,
  'a different authorized actor may independently use the same idempotency UUID'
);

reset role;
select is(
  (select count(*)::integer from private.social_resource_operations
   where idempotency_key = '31500000-0000-4000-8000-000000000002'),
  2,
  'idempotency uniqueness is actor scoped rather than globally scoped'
);

select finish();
rollback;
