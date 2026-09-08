begin;

-- Page 32 uses the institution-wide Asia/Taipei business date.  Keep every
-- current_date-based fixture on that same boundary so the future-date vector
-- remains deterministic when the database test runner executes during the
-- UTC/Taipei day-boundary window.
set local time zone 'Asia/Taipei';

select plan(55);

select results_eq(
  $$select permission_key collate "C" from public.permissions
    where permission_key like 'social_work_records.%'
    order by permission_key collate "C"$$,
  $$values
    ('social_work_records.manage'::text collate "C"),
    ('social_work_records.read'::text collate "C"),
    ('social_work_records.sign'::text collate "C")$$,
  'page 32 reuses the governed social-work read, manage and sign boundary'
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
  'page 32 does not widen the conservative role templates'
);

select ok(
  (select bool_and(relrowsecurity and relforcerowsecurity)
   from pg_class where oid in (
    'public.adaptation_assessment_versions'::regclass,
    'public.adaptation_follow_up_events'::regclass,
    'private.adaptation_assessment_operations'::regclass,
    'private.adaptation_follow_up_operations'::regclass
  )),
  'all page-32 history and receipt tables force RLS'
);

select ok(
  not has_table_privilege('authenticated', 'public.adaptation_assessment_versions', 'select,insert,update,delete')
  and not has_table_privilege('authenticated', 'public.adaptation_follow_up_events', 'select,insert,update,delete')
  and not has_table_privilege('service_role', 'public.adaptation_assessment_versions', 'select,insert,update,delete')
  and not has_table_privilege('service_role', 'public.adaptation_follow_up_events', 'select,insert,update,delete'),
  'browser and service roles cannot directly access public page-32 tables'
);

select ok(
  not has_table_privilege('authenticated', 'private.adaptation_assessment_operations', 'select,insert,update,delete')
  and not has_table_privilege('authenticated', 'private.adaptation_follow_up_operations', 'select,insert,update,delete')
  and not has_table_privilege('service_role', 'private.adaptation_assessment_operations', 'select,insert,update,delete')
  and not has_table_privilege('service_role', 'private.adaptation_follow_up_operations', 'select,insert,update,delete'),
  'private page-32 idempotency receipts have no direct client access'
);

select ok(
  has_function_privilege('authenticated', 'public.create_adaptation_assessment_draft(uuid,uuid,uuid,date,text,text,date,boolean,text,uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.revise_adaptation_assessment_draft(uuid,uuid,uuid,uuid,uuid,integer,date,text,text,date,boolean,text,uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.sign_adaptation_assessment(uuid,uuid,uuid,uuid,uuid,integer,uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.correct_adaptation_assessment(uuid,uuid,uuid,uuid,uuid,integer,date,text,text,date,boolean,text,text,uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.mutate_adaptation_follow_up(text,uuid,uuid,uuid,uuid,uuid,integer,date,text,text,text,uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.adaptation_assessment_snapshot(uuid,uuid,uuid,text,text,text,text,text)', 'execute')
  and not has_function_privilege('service_role', 'public.sign_adaptation_assessment(uuid,uuid,uuid,uuid,uuid,integer,uuid)', 'execute'),
  'only authenticated callers receive public page-32 RPC entrypoints'
);

select ok(
  not (select prosecdef from pg_proc where oid =
    'public.create_adaptation_assessment_draft(uuid,uuid,uuid,date,text,text,date,boolean,text,uuid)'::regprocedure)
  and not (select prosecdef from pg_proc where oid =
    'public.mutate_adaptation_follow_up(text,uuid,uuid,uuid,uuid,uuid,integer,date,text,text,text,uuid)'::regprocedure)
  and not (select prosecdef from pg_proc where oid =
    'public.adaptation_assessment_snapshot(uuid,uuid,uuid,text,text,text,text,text)'::regprocedure),
  'public page-32 wrappers remain SECURITY INVOKER'
);

select ok(
  (select prosecdef and coalesce(proconfig, '{}'::text[]) @> array['search_path=""']
   from pg_proc where oid =
    'private.mutate_adaptation_assessment_guarded(text,uuid,uuid,uuid,uuid,uuid,integer,date,text,text,date,boolean,text,text,uuid)'::regprocedure)
  and (select prosecdef and coalesce(proconfig, '{}'::text[]) @> array['search_path=""']
   from pg_proc where oid =
    'private.mutate_adaptation_follow_up_guarded(text,uuid,uuid,uuid,uuid,uuid,integer,date,text,text,text,uuid)'::regprocedure)
  and (select prosecdef and coalesce(proconfig, '{}'::text[]) @> array['search_path=""']
   from pg_proc where oid =
    'private.adaptation_assessment_snapshot_response(uuid,uuid,uuid,text,text,text,text,text)'::regprocedure),
  'private page-32 enforcing cores are pinned SECURITY DEFINER functions'
);

select ok(
  has_function_privilege('authenticated',
    'private.mutate_adaptation_assessment_guarded(text,uuid,uuid,uuid,uuid,uuid,integer,date,text,text,date,boolean,text,text,uuid)', 'execute')
  and not has_function_privilege('public',
    'private.mutate_adaptation_assessment_guarded(text,uuid,uuid,uuid,uuid,uuid,integer,date,text,text,date,boolean,text,text,uuid)', 'execute')
  and has_function_privilege('authenticated',
    'private.mutate_adaptation_follow_up_guarded(text,uuid,uuid,uuid,uuid,uuid,integer,date,text,text,text,uuid)', 'execute')
  and not has_function_privilege('public',
    'private.mutate_adaptation_follow_up_guarded(text,uuid,uuid,uuid,uuid,uuid,integer,date,text,text,text,uuid)', 'execute')
  and has_function_privilege('authenticated',
    'private.adaptation_assessment_snapshot_response(uuid,uuid,uuid,text,text,text,text,text)', 'execute')
  and not has_function_privilege('public',
    'private.adaptation_assessment_snapshot_response(uuid,uuid,uuid,text,text,text,text,text)', 'execute'),
  'private invoker targets have exact authenticated grants and no PUBLIC grant'
);

select ok(
  position('pg_advisory_xact_lock' in pg_get_functiondef(
    'private.mutate_adaptation_assessment_guarded(text,uuid,uuid,uuid,uuid,uuid,integer,date,text,text,date,boolean,text,text,uuid)'::regprocedure)) > 0
  and position('adaptation assessment authority expired' in pg_get_functiondef(
    'private.mutate_adaptation_assessment_guarded(text,uuid,uuid,uuid,uuid,uuid,integer,date,text,text,date,boolean,text,text,uuid)'::regprocedure)) > 0
  and position('v_after is distinct from v_bundle' in pg_get_functiondef(
    'private.adaptation_assessment_snapshot_response(uuid,uuid,uuid,text,text,text,text,text)'::regprocedure)) > 0,
  'writes serialize and reads and writes perform final authority checks'
);

select is(
  (select count(*) from pg_trigger where not tgisinternal and tgname in (
    'adaptation_assessment_versions_append_only',
    'adaptation_follow_up_events_append_only',
    'adaptation_assessment_operations_append_only',
    'adaptation_follow_up_operations_append_only'
  )), 4::bigint,
  'all assessment, follow-up and receipt streams are immutable'
);

select is(
  (select count(*) from pg_trigger where not tgisinternal and tgname in (
    'adaptation_assessment_versions_audit_row_change',
    'adaptation_follow_up_events_audit_row_change',
    'adaptation_assessment_operations_audit_row_change',
    'adaptation_follow_up_operations_audit_row_change'
  )), 4::bigint,
  'every committed page-32 stream has an exact audit trigger'
);

select is(
  (select count(*)
   from pg_constraint constraint_row
   join pg_class table_row on table_row.oid = constraint_row.conrelid
   join pg_namespace namespace_row on namespace_row.oid = table_row.relnamespace
   where constraint_row.contype = 'f'
     and namespace_row.nspname in ('public', 'private')
     and table_row.relname in (
       'adaptation_assessment_versions', 'adaptation_follow_up_events',
       'adaptation_assessment_operations', 'adaptation_follow_up_operations'
     )
     and array_length(constraint_row.conkey, 1) = 1
     and not exists (
       select 1 from pg_index index_row
       where index_row.indrelid = constraint_row.conrelid
         and index_row.indisvalid and index_row.indisready
         and constraint_row.conkey[1] = any(index_row.indkey)
     )), 0::bigint,
  'all single-column page-32 foreign keys have supporting indexes'
);

select is(
  (select count(*) from information_schema.columns
   where table_schema = 'public'
     and table_name = 'adaptation_assessment_versions'
     and column_name in (
       'score', 'total_score', 'clinical_score', 'diagnosis',
       'formula', 'risk_level'
     )), 0::bigint,
  'page 32 stores no invented score, formula, risk class or diagnosis column'
);

insert into auth.users (id, aud, role, email, created_at, updated_at) values
  ('32000000-0000-4000-8000-000000001001', 'authenticated', 'authenticated', 'manager32@example.invalid', now(), now()),
  ('32000000-0000-4000-8000-000000001002', 'authenticated', 'authenticated', 'worker32@example.invalid', now(), now()),
  ('32000000-0000-4000-8000-000000001003', 'authenticated', 'authenticated', 'unassigned32@example.invalid', now(), now()),
  ('32000000-0000-4000-8000-000000001004', 'authenticated', 'authenticated', 'other32@example.invalid', now(), now());

insert into public.organizations (id, code, name) values
  ('32100000-0000-4000-8000-000000000001', 'adaptation-a', '適應測試機構 A'),
  ('32100000-0000-4000-8000-000000000002', 'adaptation-b', '適應測試機構 B');

insert into public.branches (id, organization_id, code, name) values
  ('32200000-0000-4000-8000-000000000001', '32100000-0000-4000-8000-000000000001', 'main', 'A 主分支'),
  ('32200000-0000-4000-8000-000000000002', '32100000-0000-4000-8000-000000000001', 'second', 'A 次分支'),
  ('32200000-0000-4000-8000-000000000003', '32100000-0000-4000-8000-000000000002', 'main', 'B 主分支');

insert into public.profiles (id, display_name, kind) values
  ('32000000-0000-4000-8000-000000001001', '適應機構管理員', 'staff'),
  ('32000000-0000-4000-8000-000000001002', '指派社工', 'staff'),
  ('32000000-0000-4000-8000-000000001003', '未指派社工', 'staff'),
  ('32000000-0000-4000-8000-000000001004', '他機構管理員', 'staff');

insert into public.memberships (id, organization_id, branch_id, profile_id, status) values
  ('32300000-0000-4000-8000-000000000001', '32100000-0000-4000-8000-000000000001', null, '32000000-0000-4000-8000-000000001001', 'active'),
  ('32300000-0000-4000-8000-000000000002', '32100000-0000-4000-8000-000000000001', '32200000-0000-4000-8000-000000000001', '32000000-0000-4000-8000-000000001002', 'active'),
  ('32300000-0000-4000-8000-000000000003', '32100000-0000-4000-8000-000000000001', '32200000-0000-4000-8000-000000000001', '32000000-0000-4000-8000-000000001003', 'active'),
  ('32300000-0000-4000-8000-000000000004', '32100000-0000-4000-8000-000000000002', null, '32000000-0000-4000-8000-000000001004', 'active');

insert into public.membership_roles (membership_id, role_id) values
  ('32300000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002'),
  ('32300000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000004'),
  ('32300000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000004'),
  ('32300000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000002');

insert into public.clients (
  id, organization_id, branch_id, client_code, display_name, status,
  admitted_on, ended_on
) values
  ('32400000-0000-4000-8000-000000000001', '32100000-0000-4000-8000-000000000001', '32200000-0000-4000-8000-000000000001', 'AD-1', '合成個案 A', 'active', current_date - 90, null),
  ('32400000-0000-4000-8000-000000000002', '32100000-0000-4000-8000-000000000001', '32200000-0000-4000-8000-000000000001', 'AD-2', '合成個案 B', 'suspended', current_date - 60, null),
  ('32400000-0000-4000-8000-000000000003', '32100000-0000-4000-8000-000000000001', '32200000-0000-4000-8000-000000000002', 'AD-3', '他分支個案', 'active', current_date - 90, null),
  ('32400000-0000-4000-8000-000000000004', '32100000-0000-4000-8000-000000000002', '32200000-0000-4000-8000-000000000003', 'AD-4', '他機構個案', 'active', current_date - 90, null);

insert into public.client_assignments (
  id, organization_id, branch_id, client_id, assignee_user_id, assignment_kind
) values
  ('32500000-0000-4000-8000-000000000001', '32100000-0000-4000-8000-000000000001', '32200000-0000-4000-8000-000000000001', '32400000-0000-4000-8000-000000000001', '32000000-0000-4000-8000-000000001002', 'social-work'),
  ('32500000-0000-4000-8000-000000000002', '32100000-0000-4000-8000-000000000001', '32200000-0000-4000-8000-000000000001', '32400000-0000-4000-8000-000000000001', '32000000-0000-4000-8000-000000001001', 'management');

insert into private.reauth_challenges (
  id, user_id, session_id, nonce_sha256, idempotency_key,
  issued_jwt_iat, created_at, expires_at, consumed_at, consumed_jwt_iat,
  factor_method, factor_verified_at
) values (
  '32600000-0000-4000-8000-000000000001',
  '32000000-0000-4000-8000-000000001001',
  '32610000-0000-4000-8000-000000000001', repeat('8', 64),
  '32620000-0000-4000-8000-000000000001', clock_timestamp() - interval '2 minutes',
  clock_timestamp() - interval '2 minutes', clock_timestamp() + interval '6 minutes',
  clock_timestamp() - interval '30 seconds', clock_timestamp() - interval '30 seconds',
  'totp', clock_timestamp() - interval '30 seconds'
);

insert into private.reauth_events (
  user_id, session_id, challenge_id, aal, verification_method, verified_at
) values (
  '32000000-0000-4000-8000-000000001001',
  '32610000-0000-4000-8000-000000000001',
  '32600000-0000-4000-8000-000000000001', 'aal2', 'totp',
  (select factor_verified_at from private.reauth_challenges
   where id = '32600000-0000-4000-8000-000000000001')
);

create temporary table adaptation_create_result as
select null::uuid operation_id, null::uuid client_id,
  null::uuid assessment_key, null::uuid version_id,
  0::integer assessment_version, null::text record_state,
  current_date assessed_on, null::text adaptation_status,
  current_date reassessment_due_on, false needs_follow_up,
  null::text form_version_reference, clock_timestamp() committed_at,
  false replayed with no data;
create temporary table adaptation_revise_result (like adaptation_create_result);
create temporary table adaptation_sign_result (like adaptation_create_result);
create temporary table adaptation_correct_result (like adaptation_create_result);
create temporary table adaptation_second_result (like adaptation_create_result);
create temporary table adaptation_follow_track_result as
select null::uuid operation_id, null::uuid client_id,
  null::uuid assessment_key, null::uuid follow_up_event_id,
  0::integer follow_up_sequence, null::text follow_up_status,
  null::date due_on, clock_timestamp() committed_at,
  false replayed with no data;
create temporary table adaptation_follow_complete_result
  (like adaptation_follow_track_result);
create temporary table adaptation_follow_retrack_result
  (like adaptation_follow_track_result);

grant select, insert on
  adaptation_create_result, adaptation_revise_result, adaptation_sign_result,
  adaptation_correct_result, adaptation_second_result,
  adaptation_follow_track_result, adaptation_follow_complete_result,
  adaptation_follow_retrack_result
to authenticated;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"32000000-0000-4000-8000-000000001002","role":"authenticated","aal":"aal1","session_id":"32610000-0000-4000-8000-000000000099"}', true);

select throws_ok($$select * from public.adaptation_assessment_snapshot(
  '32100000-0000-4000-8000-000000000001',
  '32200000-0000-4000-8000-000000000001')$$,
  '42501', 'adaptation assessment snapshot is not permitted',
  'page-32 reads require AAL2'
);

select set_config('request.jwt.claims',
  '{"sub":"32000000-0000-4000-8000-000000001002","role":"authenticated","aal":"aal2","session_id":"32610000-0000-4000-8000-000000000099"}', true);

select throws_ok($$select * from public.adaptation_assessment_snapshot(
  '32100000-0000-4000-8000-000000000001',
  '32200000-0000-4000-8000-000000000002')$$,
  '42501', 'adaptation assessment snapshot is not permitted',
  'branch-scoped social worker cannot read another branch'
);

select throws_ok($$select * from public.create_adaptation_assessment_draft(
  '32100000-0000-4000-8000-000000000001',
  '32200000-0000-4000-8000-000000000001',
  '32400000-0000-4000-8000-000000000002', current_date,
  'adjusting', '不得建立未指派個案評估', current_date + 7, true,
  'manual-adaptation-v1', '32900000-0000-4000-8000-000000000001')$$,
  '42501', 'adaptation assessment operation is not permitted',
  'unassigned social worker cannot create for another client'
);

select set_config('request.jwt.claims',
  '{"sub":"32000000-0000-4000-8000-000000001001","role":"authenticated","aal":"aal2","session_id":"32610000-0000-4000-8000-000000000001"}', true);

insert into adaptation_create_result
select * from public.create_adaptation_assessment_draft(
  '32100000-0000-4000-8000-000000000001',
  '32200000-0000-4000-8000-000000000001',
  '32400000-0000-4000-8000-000000000001', current_date - 3,
  'adjusting', '合成人工適應摘要第一版', current_date + 7, true,
  'manual-adaptation-v1', '32900000-0000-4000-8000-000000000010');

select ok(
  (select not replayed and client_id = '32400000-0000-4000-8000-000000000001'
      and assessment_version = 1 and record_state = 'draft'
      and assessed_on = current_date - 3 and adaptation_status = 'adjusting'
      and reassessment_due_on = current_date + 7 and needs_follow_up
      and form_version_reference = 'manual-adaptation-v1'
      and operation_id is not null and assessment_key is not null
      and version_id is not null
   from adaptation_create_result),
  'quick create returns a complete receipt correlated to the exact client'
);

select ok(
  (select replayed
      and client_id = '32400000-0000-4000-8000-000000000001'
      and assessment_key = (select assessment_key from adaptation_create_result)
      and version_id = (select version_id from adaptation_create_result)
   from public.create_adaptation_assessment_draft(
    '32100000-0000-4000-8000-000000000001',
    '32200000-0000-4000-8000-000000000001',
    '32400000-0000-4000-8000-000000000001', current_date - 3,
    'adjusting', '合成人工適應摘要第一版', current_date + 7, true,
    'manual-adaptation-v1', '32900000-0000-4000-8000-000000000010')),
  'exact quick-create replay returns the same committed version'
);

select throws_ok($$select * from public.create_adaptation_assessment_draft(
  '32100000-0000-4000-8000-000000000001',
  '32200000-0000-4000-8000-000000000001',
  '32400000-0000-4000-8000-000000000001', current_date - 3,
  'settled', '變更同一冪等操作內容', current_date + 7, false,
  'manual-adaptation-v1', '32900000-0000-4000-8000-000000000010')$$,
  '23505', 'adaptation assessment idempotency conflict',
  'changed content conflicts on the same actor idempotency key'
);

select throws_ok($$select * from public.create_adaptation_assessment_draft(
  '32100000-0000-4000-8000-000000000001',
  '32200000-0000-4000-8000-000000000001',
  '32400000-0000-4000-8000-000000000001', current_date + 1,
  'settled', '未來評估日期不得建立', current_date + 8, false,
  'manual-adaptation-v1', '32900000-0000-4000-8000-000000000011')$$,
  '22023', 'future adaptation assessment date is invalid',
  'future assessment date is rejected'
);

select throws_ok($$select * from public.create_adaptation_assessment_draft(
  '32100000-0000-4000-8000-000000000001',
  '32200000-0000-4000-8000-000000000001',
  '32400000-0000-4000-8000-000000000001', current_date,
  'settled', '不得冒充官方表單', current_date + 8, false,
  'official-adaptation-scale', '32900000-0000-4000-8000-000000000012')$$,
  '22023', 'manual adaptation assessment content is invalid',
  'unpublished or official-looking form references are rejected'
);

insert into adaptation_revise_result
select * from public.revise_adaptation_assessment_draft(
  '32100000-0000-4000-8000-000000000001',
  '32200000-0000-4000-8000-000000000001',
  '32400000-0000-4000-8000-000000000001',
  (select assessment_key from adaptation_create_result),
  (select version_id from adaptation_create_result), 1,
  current_date - 3, 'adjusting', '合成人工適應摘要第二版',
  current_date + 5, true, 'manual-adaptation-v1',
  '32900000-0000-4000-8000-000000000013');

select ok(
  (select not replayed and assessment_version = 2 and record_state = 'draft'
      and assessment_key = (select assessment_key from adaptation_create_result)
   from adaptation_revise_result),
  'draft revision appends version two without replacing version one'
);

select throws_ok($$select * from public.revise_adaptation_assessment_draft(
  '32100000-0000-4000-8000-000000000001',
  '32200000-0000-4000-8000-000000000001',
  '32400000-0000-4000-8000-000000000001',
  (select assessment_key from adaptation_create_result),
  (select version_id from adaptation_create_result), 1,
  current_date - 3, 'adjusting', '過期修訂不得寫入', current_date + 5,
  true, 'manual-adaptation-v1',
  '32900000-0000-4000-8000-000000000014')$$,
  '40001', 'adaptation assessment version is stale',
  'stale expected assessment version is rejected'
);

select set_config('request.jwt.claims',
  '{"sub":"32000000-0000-4000-8000-000000001001","role":"authenticated","aal":"aal2","session_id":"32610000-0000-4000-8000-000000000099"}', true);
select throws_ok($$select * from public.sign_adaptation_assessment(
  '32100000-0000-4000-8000-000000000001',
  '32200000-0000-4000-8000-000000000001',
  '32400000-0000-4000-8000-000000000001',
  (select assessment_key from adaptation_revise_result),
  (select version_id from adaptation_revise_result), 2,
  '32900000-0000-4000-8000-000000000015')$$,
  '42501', 'current same-session recent AAL2 evidence is required for adaptation signing',
  'AAL2 JWT without a recent same-session challenge cannot sign'
);

select set_config('request.jwt.claims',
  '{"sub":"32000000-0000-4000-8000-000000001001","role":"authenticated","aal":"aal2","session_id":"32610000-0000-4000-8000-000000000001"}', true);
insert into adaptation_sign_result
select * from public.sign_adaptation_assessment(
  '32100000-0000-4000-8000-000000000001',
  '32200000-0000-4000-8000-000000000001',
  '32400000-0000-4000-8000-000000000001',
  (select assessment_key from adaptation_revise_result),
  (select version_id from adaptation_revise_result), 2,
  '32900000-0000-4000-8000-000000000016');

select ok(
  (select not replayed and assessment_version = 3 and record_state = 'signed'
      and client_id = '32400000-0000-4000-8000-000000000001'
   from adaptation_sign_result),
  'recent same-session AAL2 signs a new immutable assessment version'
);

reset role;
select ok(
  (select signature_purpose = '人工適應評估簽署'
      and signature_reauth_challenge_id = '32600000-0000-4000-8000-000000000001'
      and signed_by = '32000000-0000-4000-8000-000000001001'
   from public.adaptation_assessment_versions
   where id = (select version_id from adaptation_sign_result)),
  'signed version preserves signer, purpose and reauthentication evidence'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"32000000-0000-4000-8000-000000001001","role":"authenticated","aal":"aal2","session_id":"32610000-0000-4000-8000-000000000001"}', true);
insert into adaptation_correct_result
select * from public.correct_adaptation_assessment(
  '32100000-0000-4000-8000-000000000001',
  '32200000-0000-4000-8000-000000000001',
  '32400000-0000-4000-8000-000000000001',
  (select assessment_key from adaptation_sign_result),
  (select version_id from adaptation_sign_result), 3,
  current_date - 3, 'support_requested', '更正後合成人工評估摘要',
  current_date - 1, true, 'manual-adaptation-v1',
  '原簽署摘要有一處實際觀察需更正',
  '32900000-0000-4000-8000-000000000017');

select ok(
  (select not replayed and assessment_version = 4
      and record_state = 'corrected' and adaptation_status = 'support_requested'
      and reassessment_due_on = current_date - 1
   from adaptation_correct_result),
  'signed content changes only through a reasoned signed correction'
);

reset role;
select ok(
  (select count(*) = 4 and min(version) = 1 and max(version) = 4
      and count(distinct id) = 4
   from public.adaptation_assessment_versions
   where assessment_key = (select assessment_key from adaptation_create_result))
  and (select previous_version_id = (select version_id from adaptation_sign_result)
       from public.adaptation_assessment_versions
       where id = (select version_id from adaptation_correct_result)),
  'assessment history keeps four distinct linked versions'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"32000000-0000-4000-8000-000000001001","role":"authenticated","aal":"aal2","session_id":"32610000-0000-4000-8000-000000000001"}', true);
select throws_ok($$select * from public.revise_adaptation_assessment_draft(
  '32100000-0000-4000-8000-000000000001',
  '32200000-0000-4000-8000-000000000001',
  '32400000-0000-4000-8000-000000000001',
  (select assessment_key from adaptation_correct_result),
  (select version_id from adaptation_correct_result), 4,
  current_date - 3, 'settled', '不可回到草稿', current_date + 8,
  false, 'manual-adaptation-v1',
  '32900000-0000-4000-8000-000000000018')$$,
  '23514', 'signed adaptation assessment requires a correction',
  'signed or corrected assessment cannot return to draft revision'
);

reset role;
select throws_ok($$update public.adaptation_assessment_versions
  set assessment_summary = '直接覆寫'
  where id = (select version_id from adaptation_sign_result)$$,
  '55000', 'adaptation assessment history is append-only',
  'direct update of signed assessment history is rejected'
);
select throws_ok($$delete from public.adaptation_assessment_versions
  where id = (select version_id from adaptation_sign_result)$$,
  '55000', 'adaptation assessment history is append-only',
  'direct deletion of signed assessment history is rejected'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"32000000-0000-4000-8000-000000001001","role":"authenticated","aal":"aal2","session_id":"32610000-0000-4000-8000-000000000001"}', true);
insert into adaptation_follow_track_result
select * from public.mutate_adaptation_follow_up(
  'track',
  '32100000-0000-4000-8000-000000000001',
  '32200000-0000-4000-8000-000000000001',
  '32400000-0000-4000-8000-000000000001',
  (select assessment_key from adaptation_correct_result),
  (select version_id from adaptation_correct_result), 0,
  current_date + 1, '人工安排下一次支持確認', null, null,
  '32900000-0000-4000-8000-000000000020');

select ok(
  (select not replayed and client_id = '32400000-0000-4000-8000-000000000001'
      and follow_up_sequence = 1 and follow_up_status = 'pending'
      and due_on = current_date + 1 and follow_up_event_id is not null
   from adaptation_follow_track_result),
  'tracking appends the first pending event with a correlated client receipt'
);

select ok(
  (select replayed
      and follow_up_event_id =
        (select follow_up_event_id from adaptation_follow_track_result)
   from public.mutate_adaptation_follow_up(
    'track',
    '32100000-0000-4000-8000-000000000001',
    '32200000-0000-4000-8000-000000000001',
    '32400000-0000-4000-8000-000000000001',
    (select assessment_key from adaptation_correct_result),
    (select version_id from adaptation_correct_result), 0,
    current_date + 1, '人工安排下一次支持確認', null, null,
    '32900000-0000-4000-8000-000000000020')),
  'exact follow-up replay returns the stable committed event'
);

select throws_ok($$select * from public.mutate_adaptation_follow_up(
  'track',
  '32100000-0000-4000-8000-000000000001',
  '32200000-0000-4000-8000-000000000001',
  '32400000-0000-4000-8000-000000000001',
  (select assessment_key from adaptation_correct_result),
  (select version_id from adaptation_correct_result), 1,
  current_date + 2, '不得建立第二筆未結追蹤', null, null,
  '32900000-0000-4000-8000-000000000021')$$,
  '23514', 'an open adaptation follow-up already exists',
  'a second pending follow-up cannot replace the first'
);

insert into adaptation_follow_complete_result
select * from public.mutate_adaptation_follow_up(
  'complete_follow_up',
  '32100000-0000-4000-8000-000000000001',
  '32200000-0000-4000-8000-000000000001',
  '32400000-0000-4000-8000-000000000001',
  (select assessment_key from adaptation_correct_result),
  (select version_id from adaptation_correct_result), 1,
  null, null, '已完成第一次合成追蹤', null,
  '32900000-0000-4000-8000-000000000022');

select ok(
  (select not replayed and follow_up_sequence = 2
      and follow_up_status = 'completed' and due_on is null
   from adaptation_follow_complete_result),
  'completion appends sequence two and preserves the pending event'
);

select throws_ok($$select * from public.mutate_adaptation_follow_up(
  'cancel_follow_up',
  '32100000-0000-4000-8000-000000000001',
  '32200000-0000-4000-8000-000000000001',
  '32400000-0000-4000-8000-000000000001',
  (select assessment_key from adaptation_correct_result),
  (select version_id from adaptation_correct_result), 1,
  null, null, null, '過期狀態不得寫入',
  '32900000-0000-4000-8000-000000000023')$$,
  '40001', 'adaptation follow-up version is stale',
  'stale expected follow-up sequence is rejected'
);

insert into adaptation_follow_retrack_result
select * from public.mutate_adaptation_follow_up(
  'track',
  '32100000-0000-4000-8000-000000000001',
  '32200000-0000-4000-8000-000000000001',
  '32400000-0000-4000-8000-000000000001',
  (select assessment_key from adaptation_correct_result),
  (select version_id from adaptation_correct_result), 2,
  current_date - 1, '補做逾期支持確認', null, null,
  '32900000-0000-4000-8000-000000000024');

select ok(
  (select not replayed and follow_up_sequence = 3
      and follow_up_status = 'pending' and due_on = current_date - 1
   from adaptation_follow_retrack_result),
  'completed follow-up can be followed by a new distinct pending event'
);

reset role;
select ok(
  (select count(*) = 3 and min(sequence) = 1 and max(sequence) = 3
      and array_agg(follow_up_status order by sequence) =
        array['pending', 'completed', 'pending']::text[]
   from public.adaptation_follow_up_events
   where assessment_key = (select assessment_key from adaptation_correct_result)),
  'follow-up history remains a three-event append-only timeline'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"32000000-0000-4000-8000-000000001001","role":"authenticated","aal":"aal2","session_id":"32610000-0000-4000-8000-000000000001"}', true);

select ok(
  (select matching_total = 2 and item_total = 2
      and assessed_total = 1 and not_assessed_total = 1
      and reassessment_due_total = 1 and needs_follow_up_total = 1
      and open_follow_up_total = 1 and overdue_follow_up_total = 1
      and draft_total = 0 and completed_total = 1
   from public.adaptation_assessment_snapshot(
    '32100000-0000-4000-8000-000000000001',
    '32200000-0000-4000-8000-000000000001')),
  'snapshot metrics reconcile across every accessible client before detail limits'
);

select ok(
  (select matching_total = 1 and items -> 0 ->> 'client_id' =
      '32400000-0000-4000-8000-000000000002'
   from public.adaptation_assessment_snapshot(
    '32100000-0000-4000-8000-000000000001',
    '32200000-0000-4000-8000-000000000001', null, 'suspended',
    'not_assessed', 'all', null, 'all')),
  'current client service status and no-assessment filters compose exactly'
);

select ok(
  (select matching_total = 1
      and items -> 0 ->> 'adaptation_status' = 'support_requested'
      and (items -> 0 ->> 'reassessment_due')::boolean
      and (items -> 0 ->> 'follow_up_overdue')::boolean
   from public.adaptation_assessment_snapshot(
    '32100000-0000-4000-8000-000000000001',
    '32200000-0000-4000-8000-000000000001',
    '32400000-0000-4000-8000-000000000001', null, 'assessed',
    'due', 'support_requested', 'overdue')),
  'client, assessment, due, manual status and follow-up filters are exact'
);

select ok(
  (select assessment_method_status = 'manual_unstandardized_only'
      and form_publication_status = 'not_published_not_claimed'
      and offline_sync_status = 'not_configured'
      and follow_up_notification_status = 'none_not_sent'
      and not items_truncated and not client_options_truncated
      and not assessor_options_truncated
   from public.adaptation_assessment_snapshot(
    '32100000-0000-4000-8000-000000000001',
    '32200000-0000-4000-8000-000000000001')),
  'snapshot states manual-only, unpublished, online-only and no notification claims'
);

select ok(
  (select jsonb_array_length(items -> 0 -> 'version_history') = 4
      and (items -> 0 ->> 'version_history_total')::integer = 4
      and jsonb_array_length(items -> 0 -> 'follow_up_history') = 3
      and (items -> 0 ->> 'follow_up_history_total')::integer = 3
   from public.adaptation_assessment_snapshot(
    '32100000-0000-4000-8000-000000000001',
    '32200000-0000-4000-8000-000000000001')),
  'snapshot returns bounded histories with explicit complete totals'
);

select throws_ok($$select * from public.adaptation_assessment_snapshot(
  '32100000-0000-4000-8000-000000000001',
  '32200000-0000-4000-8000-000000000001', null, null,
  'forged_presence', 'all', null, 'all')$$,
  '42501', 'adaptation assessment snapshot is not permitted',
  'unknown snapshot filter values fail closed'
);

insert into adaptation_second_result
select * from public.create_adaptation_assessment_draft(
  '32100000-0000-4000-8000-000000000001',
  '32200000-0000-4000-8000-000000000001',
  '32400000-0000-4000-8000-000000000001', current_date,
  'settled', '較新日期的另一份合成人工評估', current_date + 14, false,
  'manual-adaptation-v1', '32900000-0000-4000-8000-000000000030');

select ok(
  (select not replayed and assessment_version = 1 and record_state = 'draft'
      and assessment_key <> (select assessment_key from adaptation_create_result)
      and client_id = '32400000-0000-4000-8000-000000000001'
   from adaptation_second_result),
  'a later assessment creates another chain instead of overwriting history'
);

select ok(
  (select items -> 0 ->> 'assessment_key' =
      (select assessment_key::text from adaptation_second_result)
      and items -> 0 ->> 'record_state' = 'draft'
      and items -> 0 ->> 'assessed_on' = current_date::text
      and (items -> 0 ->> 'needs_follow_up')::boolean = false
   from public.adaptation_assessment_snapshot(
    '32100000-0000-4000-8000-000000000001',
    '32200000-0000-4000-8000-000000000001',
    '32400000-0000-4000-8000-000000000001')),
  'latest assessment is selected by assessed date and appears immediately'
);

select set_config('request.jwt.claims',
  '{"sub":"32000000-0000-4000-8000-000000001002","role":"authenticated","aal":"aal2","session_id":"32610000-0000-4000-8000-000000000099"}', true);
select ok(
  (select matching_total = 1 and item_total = 1 and client_total = 1
      and items -> 0 ->> 'client_id' = '32400000-0000-4000-8000-000000000001'
   from public.adaptation_assessment_snapshot(
    '32100000-0000-4000-8000-000000000001',
    '32200000-0000-4000-8000-000000000001')),
  'assigned social worker sees only the assigned client and latest assessment'
);

select throws_ok($$select * from public.adaptation_assessment_snapshot(
  '32100000-0000-4000-8000-000000000002',
  '32200000-0000-4000-8000-000000000003')$$,
  '42501', 'adaptation assessment snapshot is not permitted',
  'cross-tenant snapshot is rejected'
);

reset role;
select ok(
  not exists (
    select 1 from public.audit_events event
    where event.table_name in (
      'adaptation_assessment_versions', 'adaptation_follow_up_events',
      'adaptation_assessment_operations', 'adaptation_follow_up_operations'
    ) and (
      event.metadata::text like '%合成人工適應摘要第一版%'
      or event.metadata::text like '%更正後合成人工評估摘要%'
      or event.metadata::text like '%補做逾期支持確認%'
    )
  ) and exists (
    select 1 from public.audit_events event
    where event.table_name = 'adaptation_assessment_versions'
      and event.metadata ->> 'narrative_logged' = 'false'
      and event.metadata ->> 'score_computed' = 'false'
      and event.metadata ->> 'diagnosis_computed' = 'false'
  ),
  'audit metadata excludes narratives, scores and diagnoses'
);

select is(
  (select count(*) from public.adaptation_assessment_versions
   where organization_id = '32100000-0000-4000-8000-000000000001'
     and branch_id = '32200000-0000-4000-8000-000000000001'),
  5::bigint,
  'two assessments retain all five immutable versions without overwrite'
);

select is(
  (select count(*) from private.adaptation_assessment_operations
   where actor_user_id = '32000000-0000-4000-8000-000000001001'),
  5::bigint,
  'failed and replayed assessment requests create no extra receipts'
);

select is(
  (select count(*) from private.adaptation_follow_up_operations
   where actor_user_id = '32000000-0000-4000-8000-000000001001'),
  3::bigint,
  'follow-up receipts contain one row per committed transition only'
);

select ok(
  (select bool_and(content_hash ~ '^[a-f0-9]{64}$')
   from public.adaptation_assessment_versions
   where organization_id = '32100000-0000-4000-8000-000000000001')
  and (select bool_and(content_hash ~ '^[a-f0-9]{64}$')
   from public.adaptation_follow_up_events
   where organization_id = '32100000-0000-4000-8000-000000000001'),
  'every immutable assessment and follow-up event carries a SHA-256 hash'
);

select ok(
  position('from matching' in pg_get_functiondef(
    'private.adaptation_assessment_snapshot_bundle(uuid,uuid,uuid,text,text,text,text,text,timestamptz)'::regprocedure)) > 0
  and position('limit 200' in pg_get_functiondef(
    'private.adaptation_assessment_snapshot_bundle(uuid,uuid,uuid,text,text,text,text,text,timestamptz)'::regprocedure)) > 0
  and position('cross join stats' in pg_get_functiondef(
    'private.adaptation_assessment_snapshot_bundle(uuid,uuid,uuid,text,text,text,text,text,timestamptz)'::regprocedure)) > 0,
  'snapshot calculates statistics from the complete matching set before bounded details'
);

select * from finish();
rollback;
