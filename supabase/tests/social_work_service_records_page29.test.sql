begin;

select plan(50);

select results_eq(
  $$select permission_key collate "C" from public.permissions
    where permission_key like 'social_work_records.%'
    order by permission_key collate "C"$$,
  $$values
    ('social_work_records.manage'::text collate "C"),
    ('social_work_records.read'::text collate "C"),
    ('social_work_records.sign'::text collate "C")$$,
  'page 29 has separate read, manage and high-risk sign permissions'
);

select results_eq(
  $$select role.role_key collate "C", permission.permission_key collate "C"
    from public.role_permissions grant_row
    join public.roles role on role.id = grant_row.role_id
    join public.permissions permission on permission.id = grant_row.permission_id
    where permission.permission_key like 'social_work_records.%'
      and role.is_system
    order by role.role_key collate "C", permission.permission_key collate "C"$$,
  $$values
    ('branch_supervisor'::text collate "C", 'social_work_records.manage'::text collate "C"),
    ('branch_supervisor'::text collate "C", 'social_work_records.read'::text collate "C"),
    ('branch_supervisor'::text collate "C", 'social_work_records.sign'::text collate "C"),
    ('case_manager_social_worker'::text collate "C", 'social_work_records.manage'::text collate "C"),
    ('case_manager_social_worker'::text collate "C", 'social_work_records.read'::text collate "C"),
    ('case_manager_social_worker'::text collate "C", 'social_work_records.sign'::text collate "C"),
    ('organization_manager'::text collate "C", 'social_work_records.manage'::text collate "C"),
    ('organization_manager'::text collate "C", 'social_work_records.read'::text collate "C"),
    ('organization_manager'::text collate "C", 'social_work_records.sign'::text collate "C")$$,
  'only the three conservative staff templates receive page-29 permissions'
);

select ok(
  (select bool_and(relrowsecurity and relforcerowsecurity)
   from pg_class where oid in (
    'public.social_work_service_record_versions'::regclass,
    'public.social_work_follow_up_events'::regclass,
    'private.social_work_record_operations'::regclass,
    'private.social_work_follow_up_operations'::regclass
  )),
  'all page-29 history and receipt tables force RLS'
);

select ok(
  not has_table_privilege('authenticated', 'public.social_work_service_record_versions', 'select,insert,update,delete')
  and not has_table_privilege('authenticated', 'public.social_work_follow_up_events', 'select,insert,update,delete')
  and not has_table_privilege('service_role', 'public.social_work_service_record_versions', 'select,insert,update,delete')
  and not has_table_privilege('service_role', 'public.social_work_follow_up_events', 'select,insert,update,delete'),
  'browser and service roles cannot directly access public page-29 tables'
);

select ok(
  not has_table_privilege('authenticated', 'private.social_work_record_operations', 'select,insert,update,delete')
  and not has_table_privilege('authenticated', 'private.social_work_follow_up_operations', 'select,insert,update,delete')
  and not has_table_privilege('service_role', 'private.social_work_record_operations', 'select,insert,update,delete')
  and not has_table_privilege('service_role', 'private.social_work_follow_up_operations', 'select,insert,update,delete'),
  'private idempotency receipts have no direct client or service-role access'
);

select ok(
  has_function_privilege('authenticated', 'public.create_social_work_service_draft(uuid,uuid,uuid,timestamptz,text,text,text,uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.revise_social_work_service_draft(uuid,uuid,uuid,uuid,uuid,integer,timestamptz,text,text,text,uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.sign_social_work_service_record(uuid,uuid,uuid,uuid,uuid,integer,uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.correct_social_work_service_record(uuid,uuid,uuid,uuid,uuid,integer,timestamptz,text,text,text,text,uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.mutate_social_work_follow_up(text,uuid,uuid,uuid,uuid,uuid,integer,date,text,text,text,uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.social_work_service_snapshot(uuid,uuid,date,date,text,uuid,uuid)', 'execute')
  and not has_function_privilege('service_role', 'public.sign_social_work_service_record(uuid,uuid,uuid,uuid,uuid,integer,uuid)', 'execute'),
  'only authenticated callers receive public page-29 RPC entrypoints'
);

select ok(
  not (select prosecdef from pg_proc where oid =
    'public.create_social_work_service_draft(uuid,uuid,uuid,timestamptz,text,text,text,uuid)'::regprocedure)
  and not (select prosecdef from pg_proc where oid =
    'public.mutate_social_work_follow_up(text,uuid,uuid,uuid,uuid,uuid,integer,date,text,text,text,uuid)'::regprocedure)
  and not (select prosecdef from pg_proc where oid =
    'public.social_work_service_snapshot(uuid,uuid,date,date,text,uuid,uuid)'::regprocedure),
  'public page-29 wrappers remain SECURITY INVOKER'
);

select ok(
  (select prosecdef and coalesce(proconfig, '{}'::text[]) @> array['search_path=""']
   from pg_proc where oid =
    'private.mutate_social_work_service_record_guarded(text,uuid,uuid,uuid,uuid,uuid,integer,timestamptz,text,text,text,text,uuid)'::regprocedure)
  and (select prosecdef and coalesce(proconfig, '{}'::text[]) @> array['search_path=""']
   from pg_proc where oid =
    'private.mutate_social_work_follow_up_guarded(text,uuid,uuid,uuid,uuid,uuid,integer,date,text,text,text,uuid)'::regprocedure)
  and (select prosecdef and coalesce(proconfig, '{}'::text[]) @> array['search_path=""']
   from pg_proc where oid =
    'private.social_work_service_snapshot_response(uuid,uuid,date,date,text,uuid,uuid)'::regprocedure),
  'private enforcing cores are pinned SECURITY DEFINER functions'
);

select ok(
  has_function_privilege('authenticated',
    'private.mutate_social_work_service_record_guarded(text,uuid,uuid,uuid,uuid,uuid,integer,timestamptz,text,text,text,text,uuid)', 'execute')
  and not has_function_privilege('public',
    'private.mutate_social_work_service_record_guarded(text,uuid,uuid,uuid,uuid,uuid,integer,timestamptz,text,text,text,text,uuid)', 'execute')
  and has_function_privilege('authenticated',
    'private.mutate_social_work_follow_up_guarded(text,uuid,uuid,uuid,uuid,uuid,integer,date,text,text,text,uuid)', 'execute')
  and not has_function_privilege('public',
    'private.mutate_social_work_follow_up_guarded(text,uuid,uuid,uuid,uuid,uuid,integer,date,text,text,text,uuid)', 'execute')
  and has_function_privilege('authenticated',
    'private.social_work_service_snapshot_response(uuid,uuid,date,date,text,uuid,uuid)', 'execute')
  and not has_function_privilege('public',
    'private.social_work_service_snapshot_response(uuid,uuid,date,date,text,uuid,uuid)', 'execute'),
  'private invoker targets have exact authenticated grants and no PUBLIC grant'
);

select ok(
  position('pg_advisory_xact_lock' in pg_get_functiondef(
    'private.mutate_social_work_service_record_guarded(text,uuid,uuid,uuid,uuid,uuid,integer,timestamptz,text,text,text,text,uuid)'::regprocedure)) > 0
  and position('social-work authority expired' in pg_get_functiondef(
    'private.mutate_social_work_service_record_guarded(text,uuid,uuid,uuid,uuid,uuid,integer,timestamptz,text,text,text,text,uuid)'::regprocedure)) > 0
  and position('v_after is distinct from v_bundle' in pg_get_functiondef(
    'private.social_work_service_snapshot_response(uuid,uuid,date,date,text,uuid,uuid)'::regprocedure)) > 0,
  'writes serialize and both reads and writes perform final authority verification'
);

select is(
  (select count(*) from pg_trigger where not tgisinternal and tgname in (
    'social_work_service_versions_append_only',
    'social_work_follow_up_events_append_only',
    'social_work_record_operations_append_only',
    'social_work_follow_up_operations_append_only'
  )), 4::bigint,
  'all record, follow-up and receipt streams are immutable'
);

select is(
  (select count(*) from pg_trigger where not tgisinternal and tgname in (
    'social_work_service_record_versions_audit_row_change',
    'social_work_follow_up_events_audit_row_change',
    'social_work_record_operations_audit_row_change',
    'social_work_follow_up_operations_audit_row_change'
  )), 4::bigint,
  'every committed page-29 stream has the exact audit trigger'
);

select is(
  (select count(*)
   from pg_constraint constraint_row
   join pg_class table_row on table_row.oid = constraint_row.conrelid
   join pg_namespace namespace_row on namespace_row.oid = table_row.relnamespace
   where constraint_row.contype = 'f'
     and namespace_row.nspname in ('public', 'private')
     and table_row.relname in (
       'social_work_service_record_versions', 'social_work_follow_up_events',
       'social_work_record_operations', 'social_work_follow_up_operations'
     )
     and array_length(constraint_row.conkey, 1) = 1
     and not exists (
       select 1 from pg_index index_row
       where index_row.indrelid = constraint_row.conrelid
         and index_row.indisvalid and index_row.indisready
         and constraint_row.conkey[1] = any(index_row.indkey)
     )), 0::bigint,
  'all single-column page-29 foreign keys have supporting indexes'
);

insert into auth.users (id, aud, role, email, created_at, updated_at) values
  ('29000000-0000-4000-8000-000000001001', 'authenticated', 'authenticated', 'manager29@example.invalid', now(), now()),
  ('29000000-0000-4000-8000-000000001002', 'authenticated', 'authenticated', 'worker29@example.invalid', now(), now()),
  ('29000000-0000-4000-8000-000000001003', 'authenticated', 'authenticated', 'unassigned29@example.invalid', now(), now()),
  ('29000000-0000-4000-8000-000000001004', 'authenticated', 'authenticated', 'other29@example.invalid', now(), now());

insert into public.organizations (id, code, name) values
  ('29100000-0000-4000-8000-000000000001', 'social-work-a', '社工測試機構 A'),
  ('29100000-0000-4000-8000-000000000002', 'social-work-b', '社工測試機構 B');

insert into public.branches (id, organization_id, code, name) values
  ('29200000-0000-4000-8000-000000000001', '29100000-0000-4000-8000-000000000001', 'main', 'A 主分支'),
  ('29200000-0000-4000-8000-000000000002', '29100000-0000-4000-8000-000000000001', 'second', 'A 次分支'),
  ('29200000-0000-4000-8000-000000000003', '29100000-0000-4000-8000-000000000002', 'main', 'B 主分支');

insert into public.profiles (id, display_name, kind) values
  ('29000000-0000-4000-8000-000000001001', '社工機構管理員', 'staff'),
  ('29000000-0000-4000-8000-000000001002', '指派社工', 'staff'),
  ('29000000-0000-4000-8000-000000001003', '未指派社工', 'staff'),
  ('29000000-0000-4000-8000-000000001004', '他機構管理員', 'staff');

insert into public.memberships (id, organization_id, branch_id, profile_id, status) values
  ('29300000-0000-4000-8000-000000000001', '29100000-0000-4000-8000-000000000001', null, '29000000-0000-4000-8000-000000001001', 'active'),
  ('29300000-0000-4000-8000-000000000002', '29100000-0000-4000-8000-000000000001', '29200000-0000-4000-8000-000000000001', '29000000-0000-4000-8000-000000001002', 'active'),
  ('29300000-0000-4000-8000-000000000003', '29100000-0000-4000-8000-000000000001', '29200000-0000-4000-8000-000000000001', '29000000-0000-4000-8000-000000001003', 'active'),
  ('29300000-0000-4000-8000-000000000004', '29100000-0000-4000-8000-000000000002', null, '29000000-0000-4000-8000-000000001004', 'active');

insert into public.membership_roles (membership_id, role_id) values
  ('29300000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002'),
  ('29300000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000004'),
  ('29300000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000004'),
  ('29300000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000002');

insert into public.clients (
  id, organization_id, branch_id, client_code, display_name, status,
  admitted_on, ended_on
) values
  ('29400000-0000-4000-8000-000000000001', '29100000-0000-4000-8000-000000000001', '29200000-0000-4000-8000-000000000001', 'SW-1', '合成個案甲', 'active', current_date - 90, null),
  ('29400000-0000-4000-8000-000000000002', '29100000-0000-4000-8000-000000000001', '29200000-0000-4000-8000-000000000001', 'SW-2', '合成個案乙', 'active', current_date - 90, null),
  ('29400000-0000-4000-8000-000000000003', '29100000-0000-4000-8000-000000000001', '29200000-0000-4000-8000-000000000002', 'SW-3', '他分支個案', 'active', current_date - 90, null),
  ('29400000-0000-4000-8000-000000000004', '29100000-0000-4000-8000-000000000002', '29200000-0000-4000-8000-000000000003', 'SW-4', '他機構個案', 'active', current_date - 90, null);

insert into public.client_assignments (
  id, organization_id, branch_id, client_id, assignee_user_id, assignment_kind
) values
  ('29500000-0000-4000-8000-000000000001', '29100000-0000-4000-8000-000000000001', '29200000-0000-4000-8000-000000000001', '29400000-0000-4000-8000-000000000001', '29000000-0000-4000-8000-000000001002', 'social-work'),
  ('29500000-0000-4000-8000-000000000002', '29100000-0000-4000-8000-000000000001', '29200000-0000-4000-8000-000000000001', '29400000-0000-4000-8000-000000000001', '29000000-0000-4000-8000-000000001001', 'management');

insert into private.reauth_challenges (
  id, user_id, session_id, nonce_sha256, idempotency_key,
  issued_jwt_iat, created_at, expires_at, consumed_at, consumed_jwt_iat,
  factor_method, factor_verified_at
) values (
  '29600000-0000-4000-8000-000000000001',
  '29000000-0000-4000-8000-000000001001',
  '29610000-0000-4000-8000-000000000001', repeat('9', 64),
  '29620000-0000-4000-8000-000000000001', clock_timestamp() - interval '2 minutes',
  clock_timestamp() - interval '2 minutes', clock_timestamp() + interval '6 minutes',
  clock_timestamp() - interval '30 seconds', clock_timestamp() - interval '30 seconds',
  'totp', clock_timestamp() - interval '30 seconds'
);

insert into private.reauth_events (
  user_id, session_id, challenge_id, aal, verification_method, verified_at
) values (
  '29000000-0000-4000-8000-000000001001',
  '29610000-0000-4000-8000-000000000001',
  '29600000-0000-4000-8000-000000000001', 'aal2', 'totp',
  (select factor_verified_at from private.reauth_challenges
   where id = '29600000-0000-4000-8000-000000000001')
);

create temporary table social_work_record_create_result as
select null::uuid operation_id, null::uuid record_key, null::uuid version_id,
  0::integer record_version, null::text record_state,
  clock_timestamp() committed_at, false replayed with no data;
create temporary table social_work_record_revise_result
  (like social_work_record_create_result);
create temporary table social_work_record_sign_result
  (like social_work_record_create_result);
create temporary table social_work_record_correct_result
  (like social_work_record_create_result);
create temporary table social_work_record_second_result
  (like social_work_record_create_result);
create temporary table social_work_follow_up_track_result as
select null::uuid operation_id, null::uuid record_key,
  null::uuid follow_up_event_id, 0::integer follow_up_sequence,
  null::text follow_up_status, clock_timestamp() committed_at,
  false replayed with no data;
create temporary table social_work_follow_up_complete_result
  (like social_work_follow_up_track_result);
create temporary table social_work_follow_up_retrack_result
  (like social_work_follow_up_track_result);
create temporary table social_work_times as
select clock_timestamp() - interval '2 hours' as recent_occurred_at,
  clock_timestamp() - interval '3 days' as older_occurred_at;

grant select, insert on
  social_work_record_create_result, social_work_record_revise_result,
  social_work_record_sign_result, social_work_record_correct_result,
  social_work_record_second_result, social_work_follow_up_track_result,
  social_work_follow_up_complete_result, social_work_follow_up_retrack_result
to authenticated;
grant select on social_work_times to authenticated;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"29000000-0000-4000-8000-000000001002","role":"authenticated","aal":"aal1","session_id":"29610000-0000-4000-8000-000000000099"}', true);

select throws_ok($$select * from public.social_work_service_snapshot(
  '29100000-0000-4000-8000-000000000001',
  '29200000-0000-4000-8000-000000000001')$$,
  '42501', 'social-work snapshot is not permitted',
  'page-29 reads require AAL2'
);

select set_config('request.jwt.claims',
  '{"sub":"29000000-0000-4000-8000-000000001002","role":"authenticated","aal":"aal2","session_id":"29610000-0000-4000-8000-000000000099"}', true);

select throws_ok($$select * from public.social_work_service_snapshot(
  '29100000-0000-4000-8000-000000000001',
  '29200000-0000-4000-8000-000000000002')$$,
  '42501', 'social-work snapshot is not permitted',
  'branch-scoped social worker cannot read another branch'
);

select throws_ok($$select * from public.create_social_work_service_draft(
  '29100000-0000-4000-8000-000000000001',
  '29200000-0000-4000-8000-000000000001',
  '29400000-0000-4000-8000-000000000002', clock_timestamp() - interval '1 hour',
  '家庭支持', '未授權內容', '不得建立',
  '29900000-0000-4000-8000-000000000001')$$,
  '42501', 'social-work service operation is not permitted',
  'unassigned social worker cannot create a record for another client'
);

select set_config('request.jwt.claims',
  '{"sub":"29000000-0000-4000-8000-000000001001","role":"authenticated","aal":"aal2","session_id":"29610000-0000-4000-8000-000000000001"}', true);

insert into social_work_record_create_result
select * from public.create_social_work_service_draft(
  '29100000-0000-4000-8000-000000000001',
  '29200000-0000-4000-8000-000000000001',
  '29400000-0000-4000-8000-000000000001',
  (select recent_occurred_at from social_work_times),
  '家庭支持', '以合成資料記錄服務事實', '個案同意後續聯繫',
  '29900000-0000-4000-8000-000000000010');

select ok(
  (select not replayed and record_version = 1 and record_state = 'draft'
   and operation_id is not null and record_key is not null and version_id is not null
   from social_work_record_create_result),
  'new service draft returns a complete correlated receipt'
);

select ok(
  (select replayed and record_key =
      (select record_key from social_work_record_create_result)
    and version_id = (select version_id from social_work_record_create_result)
   from public.create_social_work_service_draft(
    '29100000-0000-4000-8000-000000000001',
    '29200000-0000-4000-8000-000000000001',
    '29400000-0000-4000-8000-000000000001',
    (select recent_occurred_at from social_work_times),
    '家庭支持', '以合成資料記錄服務事實', '個案同意後續聯繫',
    '29900000-0000-4000-8000-000000000010')),
  'exact draft replay returns the same committed version'
);

select throws_ok(format($sql$select * from public.create_social_work_service_draft(
  '29100000-0000-4000-8000-000000000001',
  '29200000-0000-4000-8000-000000000001',
  '29400000-0000-4000-8000-000000000001', %L,
  '家庭支持', '變更內容', '個案同意後續聯繫',
  '29900000-0000-4000-8000-000000000010')$sql$,
  (select recent_occurred_at from social_work_times)),
  '23505', 'social-work record idempotency conflict',
  'changed draft content conflicts on the same actor idempotency key'
);

insert into social_work_record_revise_result
select * from public.revise_social_work_service_draft(
  '29100000-0000-4000-8000-000000000001',
  '29200000-0000-4000-8000-000000000001',
  '29400000-0000-4000-8000-000000000001',
  (select record_key from social_work_record_create_result),
  (select version_id from social_work_record_create_result), 1,
  (select recent_occurred_at from social_work_times),
  '家庭支持', '補充合成服務事實', '個案同意一週後追蹤',
  '29900000-0000-4000-8000-000000000011');

select ok(
  (select not replayed and record_version = 2 and record_state = 'draft'
   and record_key = (select record_key from social_work_record_create_result)
   from social_work_record_revise_result),
  'draft revision appends version two without replacing version one'
);

select throws_ok($$select * from public.revise_social_work_service_draft(
  '29100000-0000-4000-8000-000000000001',
  '29200000-0000-4000-8000-000000000001',
  '29400000-0000-4000-8000-000000000001',
  (select record_key from social_work_record_create_result),
  (select version_id from social_work_record_create_result), 1,
  (select recent_occurred_at from social_work_times),
  '家庭支持', '過期修訂', '不得寫入',
  '29900000-0000-4000-8000-000000000012')$$,
  '40001', 'social-work record version is stale',
  'stale expected record version is rejected'
);

select set_config('request.jwt.claims',
  '{"sub":"29000000-0000-4000-8000-000000001001","role":"authenticated","aal":"aal2","session_id":"29610000-0000-4000-8000-000000000099"}', true);
select throws_ok($$select * from public.sign_social_work_service_record(
  '29100000-0000-4000-8000-000000000001',
  '29200000-0000-4000-8000-000000000001',
  '29400000-0000-4000-8000-000000000001',
  (select record_key from social_work_record_revise_result),
  (select version_id from social_work_record_revise_result), 2,
  '29900000-0000-4000-8000-000000000013')$$,
  '42501', 'current same-session recent AAL2 evidence is required for social-work signing',
  'AAL2 JWT without a recent same-session challenge cannot sign'
);

select set_config('request.jwt.claims',
  '{"sub":"29000000-0000-4000-8000-000000001001","role":"authenticated","aal":"aal2","session_id":"29610000-0000-4000-8000-000000000001"}', true);
insert into social_work_record_sign_result
select * from public.sign_social_work_service_record(
  '29100000-0000-4000-8000-000000000001',
  '29200000-0000-4000-8000-000000000001',
  '29400000-0000-4000-8000-000000000001',
  (select record_key from social_work_record_revise_result),
  (select version_id from social_work_record_revise_result), 2,
  '29900000-0000-4000-8000-000000000014');

select ok(
  (select not replayed and record_version = 3 and record_state = 'signed'
   from social_work_record_sign_result),
  'recent same-session AAL2 signs a new immutable version'
);

reset role;
select ok(
  (select signature_purpose = '社工服務紀錄簽署'
      and signature_reauth_challenge_id = '29600000-0000-4000-8000-000000000001'
      and signed_by = '29000000-0000-4000-8000-000000001001'
   from public.social_work_service_record_versions
   where id = (select version_id from social_work_record_sign_result)),
  'signed version preserves signer, purpose and reauthentication evidence'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"29000000-0000-4000-8000-000000001001","role":"authenticated","aal":"aal2","session_id":"29610000-0000-4000-8000-000000000001"}', true);
insert into social_work_record_correct_result
select * from public.correct_social_work_service_record(
  '29100000-0000-4000-8000-000000000001',
  '29200000-0000-4000-8000-000000000001',
  '29400000-0000-4000-8000-000000000001',
  (select record_key from social_work_record_sign_result),
  (select version_id from social_work_record_sign_result), 3,
  (select recent_occurred_at from social_work_times),
  '家庭支持', '更正後的合成服務事實', '個案同意兩日後追蹤',
  '原簽署紀錄有一處事實文字需更正',
  '29900000-0000-4000-8000-000000000015');

select ok(
  (select not replayed and record_version = 4 and record_state = 'corrected'
   and record_key = (select record_key from social_work_record_sign_result)
   from social_work_record_correct_result),
  'signed content is superseded only by a reasoned signed correction'
);

reset role;
select ok(
  (select count(*) = 4
      and min(version) = 1 and max(version) = 4
      and count(distinct id) = 4
   from public.social_work_service_record_versions
   where record_key = (select record_key from social_work_record_create_result))
  and (select previous_version_id = (select version_id from social_work_record_sign_result)
       from public.social_work_service_record_versions
       where id = (select version_id from social_work_record_correct_result)),
  'record history keeps four distinct linked versions'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"29000000-0000-4000-8000-000000001001","role":"authenticated","aal":"aal2","session_id":"29610000-0000-4000-8000-000000000001"}', true);
select throws_ok($$select * from public.revise_social_work_service_draft(
  '29100000-0000-4000-8000-000000000001',
  '29200000-0000-4000-8000-000000000001',
  '29400000-0000-4000-8000-000000000001',
  (select record_key from social_work_record_correct_result),
  (select version_id from social_work_record_correct_result), 4,
  (select recent_occurred_at from social_work_times),
  '家庭支持', '不可修訂', '不可寫入',
  '29900000-0000-4000-8000-000000000016')$$,
  '23514', 'signed social-work content requires a correction',
  'a signed or corrected terminal version cannot return to draft revision'
);

reset role;
select throws_ok($$update public.social_work_service_record_versions
  set service_content = '直接覆寫'
  where id = (select version_id from social_work_record_sign_result)$$,
  '55000', 'social-work service history is append-only',
  'direct update of signed history is rejected by immutability trigger'
);
select throws_ok($$delete from public.social_work_service_record_versions
  where id = (select version_id from social_work_record_sign_result)$$,
  '55000', 'social-work service history is append-only',
  'direct deletion of signed history is rejected by immutability trigger'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"29000000-0000-4000-8000-000000001001","role":"authenticated","aal":"aal2","session_id":"29610000-0000-4000-8000-000000000001"}', true);
insert into social_work_follow_up_track_result
select * from public.mutate_social_work_follow_up(
  'track',
  '29100000-0000-4000-8000-000000000001',
  '29200000-0000-4000-8000-000000000001',
  '29400000-0000-4000-8000-000000000001',
  (select record_key from social_work_record_correct_result),
  (select version_id from social_work_record_correct_result), 0,
  current_date + 1, '電話確認資源連結進度', null, null,
  '29900000-0000-4000-8000-000000000020');

select ok(
  (select not replayed and follow_up_sequence = 1
      and follow_up_status = 'pending' and follow_up_event_id is not null
   from social_work_follow_up_track_result),
  'tracking appends the first pending follow-up event'
);

select ok(
  (select replayed
      and follow_up_event_id =
        (select follow_up_event_id from social_work_follow_up_track_result)
   from public.mutate_social_work_follow_up(
    'track',
    '29100000-0000-4000-8000-000000000001',
    '29200000-0000-4000-8000-000000000001',
    '29400000-0000-4000-8000-000000000001',
    (select record_key from social_work_record_correct_result),
    (select version_id from social_work_record_correct_result), 0,
    current_date + 1, '電話確認資源連結進度', null, null,
    '29900000-0000-4000-8000-000000000020')),
  'exact follow-up replay returns the stable committed event'
);

select throws_ok($$select * from public.mutate_social_work_follow_up(
  'track',
  '29100000-0000-4000-8000-000000000001',
  '29200000-0000-4000-8000-000000000001',
  '29400000-0000-4000-8000-000000000001',
  (select record_key from social_work_record_correct_result),
  (select version_id from social_work_record_correct_result), 1,
  current_date + 2, '不得建立第二筆未結追蹤', null, null,
  '29900000-0000-4000-8000-000000000021')$$,
  '23514', 'an open social-work follow-up already exists',
  'a second pending follow-up cannot silently replace the first'
);

insert into social_work_follow_up_complete_result
select * from public.mutate_social_work_follow_up(
  'complete_follow_up',
  '29100000-0000-4000-8000-000000000001',
  '29200000-0000-4000-8000-000000000001',
  '29400000-0000-4000-8000-000000000001',
  (select record_key from social_work_record_correct_result),
  (select version_id from social_work_record_correct_result), 1,
  null, null, '已完成第一次合成追蹤', null,
  '29900000-0000-4000-8000-000000000022');

select ok(
  (select not replayed and follow_up_sequence = 2
      and follow_up_status = 'completed'
   from social_work_follow_up_complete_result),
  'completion appends sequence two and preserves the pending event'
);

select throws_ok($$select * from public.mutate_social_work_follow_up(
  'cancel_follow_up',
  '29100000-0000-4000-8000-000000000001',
  '29200000-0000-4000-8000-000000000001',
  '29400000-0000-4000-8000-000000000001',
  (select record_key from social_work_record_correct_result),
  (select version_id from social_work_record_correct_result), 1,
  null, null, null, '過期狀態不得寫入',
  '29900000-0000-4000-8000-000000000023')$$,
  '40001', 'social-work follow-up version is stale',
  'stale expected follow-up sequence is rejected'
);

insert into social_work_follow_up_retrack_result
select * from public.mutate_social_work_follow_up(
  'track',
  '29100000-0000-4000-8000-000000000001',
  '29200000-0000-4000-8000-000000000001',
  '29400000-0000-4000-8000-000000000001',
  (select record_key from social_work_record_correct_result),
  (select version_id from social_work_record_correct_result), 2,
  current_date - 1, '補做逾期資源確認', null, null,
  '29900000-0000-4000-8000-000000000024');

select ok(
  (select not replayed and follow_up_sequence = 3
      and follow_up_status = 'pending'
   from social_work_follow_up_retrack_result),
  'a completed follow-up can be followed by a new distinct pending event'
);

reset role;
select ok(
  (select count(*) = 3 and min(sequence) = 1 and max(sequence) = 3
      and array_agg(follow_up_status order by sequence) =
        array['pending', 'completed', 'pending']::text[]
   from public.social_work_follow_up_events
   where record_key = (select record_key from social_work_record_correct_result)),
  'follow-up event history remains a three-event append-only timeline'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"29000000-0000-4000-8000-000000001001","role":"authenticated","aal":"aal2","session_id":"29610000-0000-4000-8000-000000000001"}', true);
insert into social_work_record_second_result
select * from public.create_social_work_service_draft(
  '29100000-0000-4000-8000-000000000001',
  '29200000-0000-4000-8000-000000000001',
  '29400000-0000-4000-8000-000000000002',
  (select older_occurred_at from social_work_times),
  '福利諮詢', '較晚輸入但較早發生的合成服務', '保留為獨立草稿',
  '29900000-0000-4000-8000-000000000030');

select ok(
  (select not replayed and record_version = 1 and record_state = 'draft'
   from social_work_record_second_result),
  'a second service creates another record instead of overwriting the first'
);

select ok(
  (select matching_total = 2 and record_total = 2
      and records -> 0 ->> 'record_key' =
        (select record_key::text from social_work_record_correct_result)
      and records -> 1 ->> 'record_key' =
        (select record_key::text from social_work_record_second_result)
   from public.social_work_service_snapshot(
    '29100000-0000-4000-8000-000000000001',
    '29200000-0000-4000-8000-000000000001')),
  'snapshot orders terminal records by occurred_at rather than later created_at'
);

select ok(
  (select pending_follow_up_total = 1 and overdue_follow_up_total = 1
      and draft_total = 1 and signed_total = 1
   from public.social_work_service_snapshot(
    '29100000-0000-4000-8000-000000000001',
    '29200000-0000-4000-8000-000000000001')),
  'dashboard metrics reconcile to terminal records and latest follow-up state'
);

select is(
  (select matching_total from public.social_work_service_snapshot(
    '29100000-0000-4000-8000-000000000001',
    '29200000-0000-4000-8000-000000000001', null, null,
    '福利諮詢', null, null)),
  1::bigint,
  'service-type filter matches exactly one terminal record'
);

select is(
  (select matching_total from public.social_work_service_snapshot(
    '29100000-0000-4000-8000-000000000001',
    '29200000-0000-4000-8000-000000000001',
    (select (recent_occurred_at at time zone 'Asia/Taipei')::date
     from social_work_times),
    (select (recent_occurred_at at time zone 'Asia/Taipei')::date
     from social_work_times),
    '家庭支持', '29000000-0000-4000-8000-000000001001',
    '29400000-0000-4000-8000-000000000001')),
  1::bigint,
  'inclusive date, client, service type and author filters compose exactly'
);

select ok(
  (select offline_sync_status = 'not_configured'
      and follow_up_notification_status = 'none_not_sent'
      and not records_truncated
      and not client_options_truncated
      and not service_type_options_truncated
      and not author_options_truncated
   from public.social_work_service_snapshot(
    '29100000-0000-4000-8000-000000000001',
    '29200000-0000-4000-8000-000000000001')),
  'snapshot exposes honest offline/notification status and all projection bounds'
);

select ok(
  (select jsonb_array_length((records -> 0 -> 'version_history')) = 4
      and (records -> 0 ->> 'version_history_total')::integer = 4
      and jsonb_array_length((records -> 0 -> 'follow_up_history')) = 3
      and (records -> 0 ->> 'follow_up_history_total')::integer = 3
   from public.social_work_service_snapshot(
    '29100000-0000-4000-8000-000000000001',
    '29200000-0000-4000-8000-000000000001')),
  'snapshot returns bounded complete histories with explicit totals'
);

select set_config('request.jwt.claims',
  '{"sub":"29000000-0000-4000-8000-000000001002","role":"authenticated","aal":"aal2","session_id":"29610000-0000-4000-8000-000000000099"}', true);
select ok(
  (select matching_total = 1 and record_total = 1 and client_total = 1
      and records -> 0 ->> 'client_id' = '29400000-0000-4000-8000-000000000001'
   from public.social_work_service_snapshot(
    '29100000-0000-4000-8000-000000000001',
    '29200000-0000-4000-8000-000000000001')),
  'assigned social worker sees only the assigned client and that client record'
);

select throws_ok($$select * from public.social_work_service_snapshot(
  '29100000-0000-4000-8000-000000000002',
  '29200000-0000-4000-8000-000000000003')$$,
  '42501', 'social-work snapshot is not permitted',
  'cross-tenant snapshot is rejected'
);

reset role;
select ok(
  not exists (
    select 1 from public.audit_events event
    where event.table_name in (
      'social_work_service_record_versions', 'social_work_follow_up_events',
      'social_work_record_operations', 'social_work_follow_up_operations'
    )
      and (
        event.metadata::text like '%合成資料記錄服務事實%'
        or event.metadata::text like '%更正後的合成服務事實%'
        or event.metadata::text like '%補做逾期資源確認%'
      )
  )
  and exists (
    select 1 from public.audit_events event
    where event.table_name = 'social_work_service_record_versions'
      and event.metadata ->> 'narrative_logged' = 'false'
  ),
  'audit metadata records workflow facts without narrative content'
);

select is(
  (select count(*) from public.social_work_service_record_versions
   where organization_id = '29100000-0000-4000-8000-000000000001'
     and branch_id = '29200000-0000-4000-8000-000000000001'),
  5::bigint,
  'two service records retain all five immutable versions without overwrite'
);

select is(
  (select count(*) from private.social_work_record_operations
   where actor_user_id = '29000000-0000-4000-8000-000000001001'),
  5::bigint,
  'failed and replayed requests do not create extra operation receipts'
);

select is(
  (select count(*) from private.social_work_follow_up_operations
   where actor_user_id = '29000000-0000-4000-8000-000000001001'),
  3::bigint,
  'follow-up receipts contain one row per committed transition only'
);

select ok(
  (select bool_and(content_hash ~ '^[a-f0-9]{64}$')
   from public.social_work_service_record_versions
   where organization_id = '29100000-0000-4000-8000-000000000001')
  and (select bool_and(content_hash ~ '^[a-f0-9]{64}$')
   from public.social_work_follow_up_events
   where organization_id = '29100000-0000-4000-8000-000000000001'),
  'every immutable service and follow-up event carries a SHA-256 content hash'
);

select * from finish();
rollback;
