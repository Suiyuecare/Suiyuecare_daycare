begin;

-- Assessment dates are Taiwan business dates.  Align current_date fixtures
-- with the production Asia/Taipei guard, including the UTC/Taipei boundary.
set local time zone 'Asia/Taipei';

select plan(60);

select is(
  (select count(*) from public.permissions where permission_key in (
    'occupational_therapy_assessments.read',
    'occupational_therapy_assessments.manage',
    'occupational_therapy_assessments.sign'
  )),
  3::bigint,
  'page 33 publishes exactly three governed permissions'
);

select ok(
  exists (
    select 1 from public.role_permissions role_permission
    join public.roles role on role.id = role_permission.role_id
    join public.permissions permission
      on permission.id = role_permission.permission_id
    where role.role_key = 'professional'
      and permission.permission_key = 'occupational_therapy_assessments.manage'
  ) and not exists (
    select 1 from public.role_permissions role_permission
    join public.roles role on role.id = role_permission.role_id
    join public.permissions permission
      on permission.id = role_permission.permission_id
    where role.role_key = 'case_manager_social_worker'
      and permission.permission_key in (
        'occupational_therapy_assessments.manage',
        'occupational_therapy_assessments.sign'
      )
  ),
  'write permissions are independently limited to professional role templates'
);

select ok(
  (select bool_and(relrowsecurity and relforcerowsecurity)
   from pg_class where oid in (
    'public.occupational_therapy_assessment_versions'::regclass,
    'private.occupational_therapy_assessment_operations'::regclass
  )),
  'assessment and receipt tables force RLS'
);

select ok(
  not has_table_privilege('authenticated',
    'public.occupational_therapy_assessment_versions',
    'select,insert,update,delete')
  and not has_table_privilege('service_role',
    'public.occupational_therapy_assessment_versions',
    'select,insert,update,delete')
  and not has_table_privilege('authenticated',
    'private.occupational_therapy_assessment_operations',
    'select,insert,update,delete')
  and not has_table_privilege('service_role',
    'private.occupational_therapy_assessment_operations',
    'select,insert,update,delete'),
  'browser and service roles have no direct table writes or reads'
);

select ok(
  has_function_privilege('authenticated',
    'public.create_occupational_therapy_assessment_draft(uuid,uuid,uuid,date,date,text,jsonb,text,text,text,text,text,uuid)',
    'execute')
  and has_function_privilege('authenticated',
    'public.revise_occupational_therapy_assessment_draft(uuid,uuid,uuid,uuid,uuid,integer,date,date,text,jsonb,text,text,text,text,text,uuid)',
    'execute')
  and has_function_privilege('authenticated',
    'public.sign_occupational_therapy_assessment(uuid,uuid,uuid,uuid,uuid,integer,uuid)',
    'execute')
  and has_function_privilege('authenticated',
    'public.correct_occupational_therapy_assessment(uuid,uuid,uuid,uuid,uuid,integer,date,date,text,jsonb,text,text,text,text,text,text,uuid)',
    'execute')
  and has_function_privilege('authenticated',
    'public.occupational_therapy_assessment_snapshot(uuid,uuid,uuid,uuid,text,text)',
    'execute')
  and not has_function_privilege('service_role',
    'public.sign_occupational_therapy_assessment(uuid,uuid,uuid,uuid,uuid,integer,uuid)',
    'execute'),
  'only authenticated callers receive the exact public RPC signatures'
);

select ok(
  not (select prosecdef from pg_proc where oid =
    'public.create_occupational_therapy_assessment_draft(uuid,uuid,uuid,date,date,text,jsonb,text,text,text,text,text,uuid)'::regprocedure)
  and not (select prosecdef from pg_proc where oid =
    'public.occupational_therapy_assessment_snapshot(uuid,uuid,uuid,uuid,text,text)'::regprocedure),
  'public wrappers remain SECURITY INVOKER'
);

select ok(
  (select prosecdef and coalesce(proconfig, '{}'::text[]) @>
      array['search_path=""']
   from pg_proc where oid =
    'private.mutate_occupational_therapy_assessment_guarded(text,uuid,uuid,uuid,uuid,uuid,integer,date,date,text,jsonb,text,text,text,text,text,text,uuid)'::regprocedure)
  and (select prosecdef and coalesce(proconfig, '{}'::text[]) @>
      array['search_path=""']
   from pg_proc where oid =
    'private.occupational_therapy_assessment_snapshot_response(uuid,uuid,uuid,uuid,text,text)'::regprocedure)
  and not has_function_privilege('public',
    'private.mutate_occupational_therapy_assessment_guarded(text,uuid,uuid,uuid,uuid,uuid,integer,date,date,text,jsonb,text,text,text,text,text,text,uuid)',
    'execute'),
  'private cores are pinned SECURITY DEFINER without PUBLIC execute'
);

select ok(
  position('pg_advisory_xact_lock' in pg_get_functiondef(
    'private.mutate_occupational_therapy_assessment_guarded(text,uuid,uuid,uuid,uuid,uuid,integer,date,date,text,jsonb,text,text,text,text,text,text,uuid)'::regprocedure)) > 0
  and position('authority expired' in pg_get_functiondef(
    'private.mutate_occupational_therapy_assessment_guarded(text,uuid,uuid,uuid,uuid,uuid,integer,date,date,text,jsonb,text,text,text,text,text,text,uuid)'::regprocedure)) > 0
  and position('v_after is distinct from v_bundle' in pg_get_functiondef(
    'private.occupational_therapy_assessment_snapshot_response(uuid,uuid,uuid,uuid,text,text)'::regprocedure)) > 0,
  'writes serialize and reads and writes recheck authority'
);

select is(
  (select count(*) from pg_trigger where not tgisinternal and tgname in (
    'occupational_therapy_assessment_versions_append_only',
    'occupational_therapy_assessment_operations_append_only'
  )), 2::bigint,
  'assessment versions and operation receipts are immutable'
);

select is(
  (select count(*) from pg_trigger where not tgisinternal and tgname in (
    'occupational_therapy_assessment_versions_audit_row_change',
    'occupational_therapy_assessment_operations_audit_row_change'
  )), 2::bigint,
  'both committed streams have exact audit triggers'
);

select is(
  (select count(*) from information_schema.columns
   where table_schema = 'public'
     and table_name = 'occupational_therapy_assessment_versions'
     and column_name in (
       'score', 'total_score', 'clinical_score', 'diagnosis',
       'formula', 'risk_level', 'automatic_due_on'
     )), 0::bigint,
  'page 33 stores no invented score formula diagnosis or automatic due date'
);

select ok(private.occupational_therapy_measurements_are_valid(
  '[
    {"name":"活動持續時間","state":"numeric","value":"12.50","unit":"分鐘","reason":null},
    {"name":"雙手操作觀察","state":"text","value":"合成人工觀察","unit":null,"reason":null},
    {"name":"握力","state":"missing","value":null,"unit":null,"reason":"本次未取得有效測量"},
    {"name":"戶外活動","state":"not_applicable","value":null,"unit":null,"reason":"本次評估情境不包含戶外活動"}
  ]'::jsonb
), 'manual measurements preserve numeric text text observation missing and not applicable');

select ok(not private.occupational_therapy_measurements_are_valid(
  '[{"name":"活動持續時間","state":"numeric","value":"12e3","unit":"分鐘","reason":null}]'::jsonb
), 'non-exact numeric notation fails closed');

select ok(not private.occupational_therapy_measurements_are_valid(
  '[{"name":"握力","state":"missing","value":null,"unit":null,"reason":""}]'::jsonb
), 'missing measurement requires a reason');

select ok(not private.occupational_therapy_measurements_are_valid(
  '[
    {"name":"握力","state":"numeric","value":"8","unit":"公斤","reason":null},
    {"name":"握力","state":"text","value":"重複名稱","unit":null,"reason":null}
  ]'::jsonb
), 'duplicate measurement names fail closed');

select ok(not private.occupational_therapy_measurements_are_valid(
  '[{"name":"握力","state":"text","value":"合成觀察","unit":null,"reason":null,"score":9}]'::jsonb
), 'unexpected measurement fields fail closed');

insert into auth.users (id, aud, role, email, created_at, updated_at) values
  ('33000000-0000-4000-8000-000000001001', 'authenticated', 'authenticated', 'manager33@example.invalid', now(), now()),
  ('33000000-0000-4000-8000-000000001002', 'authenticated', 'authenticated', 'therapist33@example.invalid', now(), now()),
  ('33000000-0000-4000-8000-000000001003', 'authenticated', 'authenticated', 'othertherapist33@example.invalid', now(), now()),
  ('33000000-0000-4000-8000-000000001004', 'authenticated', 'authenticated', 'othermanager33@example.invalid', now(), now());

insert into public.organizations (id, code, name) values
  ('33100000-0000-4000-8000-000000000001', 'ot_page33_a', '職能治療測試機構 A'),
  ('33100000-0000-4000-8000-000000000002', 'ot_page33_b', '職能治療測試機構 B');

insert into public.branches (id, organization_id, code, name) values
  ('33200000-0000-4000-8000-000000000001', '33100000-0000-4000-8000-000000000001', 'main', 'A 主分支'),
  ('33200000-0000-4000-8000-000000000002', '33100000-0000-4000-8000-000000000001', 'second', 'A 次分支'),
  ('33200000-0000-4000-8000-000000000003', '33100000-0000-4000-8000-000000000002', 'main', 'B 主分支');

insert into public.profiles (id, display_name, kind) values
  ('33000000-0000-4000-8000-000000001001', '合成機構管理員', 'staff'),
  ('33000000-0000-4000-8000-000000001002', '合成職能治療師甲', 'professional'),
  ('33000000-0000-4000-8000-000000001003', '合成職能治療師乙', 'professional'),
  ('33000000-0000-4000-8000-000000001004', '合成他機構管理員', 'staff');

insert into public.memberships (
  id, organization_id, branch_id, profile_id, status
) values
  ('33300000-0000-4000-8000-000000000001', '33100000-0000-4000-8000-000000000001', null, '33000000-0000-4000-8000-000000001001', 'active'),
  ('33300000-0000-4000-8000-000000000002', '33100000-0000-4000-8000-000000000001', '33200000-0000-4000-8000-000000000001', '33000000-0000-4000-8000-000000001002', 'active'),
  ('33300000-0000-4000-8000-000000000003', '33100000-0000-4000-8000-000000000001', '33200000-0000-4000-8000-000000000001', '33000000-0000-4000-8000-000000001003', 'active'),
  ('33300000-0000-4000-8000-000000000004', '33100000-0000-4000-8000-000000000002', null, '33000000-0000-4000-8000-000000001004', 'active');

insert into public.membership_roles (membership_id, role_id) values
  ('33300000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002'),
  ('33300000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000007'),
  ('33300000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000007'),
  ('33300000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000002');

insert into public.clients (
  id, organization_id, branch_id, client_code, display_name, status,
  admitted_on, ended_on
) values
  ('33400000-0000-4000-8000-000000000001', '33100000-0000-4000-8000-000000000001', '33200000-0000-4000-8000-000000000001', 'OT-1', '合成個案甲', 'active', current_date - 90, null),
  ('33400000-0000-4000-8000-000000000002', '33100000-0000-4000-8000-000000000001', '33200000-0000-4000-8000-000000000001', 'OT-2', '合成個案乙', 'suspended', current_date - 60, null),
  ('33400000-0000-4000-8000-000000000003', '33100000-0000-4000-8000-000000000001', '33200000-0000-4000-8000-000000000002', 'OT-3', '合成他分支個案', 'active', current_date - 90, null),
  ('33400000-0000-4000-8000-000000000004', '33100000-0000-4000-8000-000000000002', '33200000-0000-4000-8000-000000000003', 'OT-4', '合成他機構個案', 'active', current_date - 90, null);

insert into public.client_assignments (
  id, organization_id, branch_id, client_id, assignee_user_id,
  assignment_kind
) values
  ('33500000-0000-4000-8000-000000000001', '33100000-0000-4000-8000-000000000001', '33200000-0000-4000-8000-000000000001', '33400000-0000-4000-8000-000000000001', '33000000-0000-4000-8000-000000001002', 'occupational-therapy'),
  ('33500000-0000-4000-8000-000000000002', '33100000-0000-4000-8000-000000000001', '33200000-0000-4000-8000-000000000001', '33400000-0000-4000-8000-000000000001', '33000000-0000-4000-8000-000000001003', 'occupational-therapy-review');

insert into private.reauth_challenges (
  id, user_id, session_id, nonce_sha256, idempotency_key,
  issued_jwt_iat, created_at, expires_at, consumed_at, consumed_jwt_iat,
  factor_method, factor_verified_at
) values (
  '33600000-0000-4000-8000-000000000001',
  '33000000-0000-4000-8000-000000001002',
  '33610000-0000-4000-8000-000000000001', repeat('3', 64),
  '33620000-0000-4000-8000-000000000001',
  clock_timestamp() - interval '2 minutes',
  clock_timestamp() - interval '2 minutes',
  clock_timestamp() + interval '6 minutes',
  clock_timestamp() - interval '30 seconds',
  clock_timestamp() - interval '30 seconds',
  'totp', clock_timestamp() - interval '30 seconds'
);

insert into private.reauth_events (
  user_id, session_id, challenge_id, aal, verification_method, verified_at
) values (
  '33000000-0000-4000-8000-000000001002',
  '33610000-0000-4000-8000-000000000001',
  '33600000-0000-4000-8000-000000000001', 'aal2', 'totp',
  (select factor_verified_at from private.reauth_challenges
   where id = '33600000-0000-4000-8000-000000000001')
);

create temporary table ot_payloads (
  payload_key text primary key,
  measurements jsonb not null,
  functional_observation text not null,
  goals text not null,
  recommendations text not null,
  follow_up_plan text not null
);
insert into ot_payloads values
  ('first',
   '[{"name":"活動持續時間","state":"numeric","value":"12.50","unit":"分鐘","reason":null},{"name":"雙手操作觀察","state":"text","value":"合成人工觀察第一版","unit":null,"reason":null},{"name":"握力","state":"missing","value":null,"unit":null,"reason":"本次未取得有效測量"}]',
   '合成人工功能觀察第一版', '合成人工目標第一版',
   '合成人工建議第一版', '合成人工追蹤第一版'),
  ('revised',
   '[{"name":"活動持續時間","state":"numeric","value":"15.25","unit":"分鐘","reason":null},{"name":"雙手操作觀察","state":"text","value":"合成人工觀察第二版","unit":null,"reason":null},{"name":"戶外活動","state":"not_applicable","value":null,"unit":null,"reason":"本次評估情境不包含戶外活動"}]',
   '合成人工功能觀察第二版', '合成人工目標第二版',
   '合成人工建議第二版', '合成人工追蹤第二版'),
  ('corrected',
   '[{"name":"活動持續時間","state":"numeric","value":"14.75","unit":"分鐘","reason":null},{"name":"雙手操作觀察","state":"text","value":"合成人工更正觀察","unit":null,"reason":null}]',
   '合成人工功能觀察更正版', '合成人工目標更正版',
   '合成人工建議更正版', '合成人工追蹤更正版');

create temporary table ot_create_result as
select null::uuid operation_id, null::uuid client_id,
  null::uuid assessment_key, null::uuid version_id,
  0::integer assessment_version, null::text record_state,
  current_date assessed_on, null::uuid therapist_user_id,
  null::text service_status_at_assessment,
  current_date reassessment_due_on, null::text form_version_reference,
  clock_timestamp() committed_at, false replayed with no data;
create temporary table ot_revise_result (like ot_create_result);
create temporary table ot_sign_result (like ot_create_result);
create temporary table ot_correct_result (like ot_create_result);
create temporary table ot_second_result (like ot_create_result);

grant select on ot_payloads to authenticated;
grant select, insert on ot_create_result, ot_revise_result, ot_sign_result,
  ot_correct_result, ot_second_result to authenticated;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"33000000-0000-4000-8000-000000001002","role":"authenticated","aal":"aal1","session_id":"33610000-0000-4000-8000-000000000099"}', true);

select throws_ok($$select * from public.occupational_therapy_assessment_snapshot(
  '33100000-0000-4000-8000-000000000001',
  '33200000-0000-4000-8000-000000000001')$$,
  '42501', 'occupational_therapy assessment snapshot is not permitted',
  'reads require AAL2'
);

select set_config('request.jwt.claims',
  '{"sub":"33000000-0000-4000-8000-000000001002","role":"authenticated","aal":"aal2","session_id":"33610000-0000-4000-8000-000000000099"}', true);

select throws_ok($$select * from public.occupational_therapy_assessment_snapshot(
  '33100000-0000-4000-8000-000000000001',
  '33200000-0000-4000-8000-000000000002')$$,
  '42501', 'occupational_therapy assessment snapshot is not permitted',
  'branch-scoped professional cannot read another branch'
);

select throws_ok($$select * from public.create_occupational_therapy_assessment_draft(
  '33100000-0000-4000-8000-000000000001',
  '33200000-0000-4000-8000-000000000001',
  '33400000-0000-4000-8000-000000000002', current_date,
  current_date + 7, '人工排定：合成會議',
  (select measurements from ot_payloads where payload_key = 'first'),
  (select functional_observation from ot_payloads where payload_key = 'first'),
  (select goals from ot_payloads where payload_key = 'first'),
  (select recommendations from ot_payloads where payload_key = 'first'),
  (select follow_up_plan from ot_payloads where payload_key = 'first'),
  'manual-occupational-therapy-v1',
  '33900000-0000-4000-8000-000000000001')$$,
  '42501', 'occupational_therapy assessment operation is not permitted',
  'professional cannot write an unassigned client'
);

select set_config('request.jwt.claims',
  '{"sub":"33000000-0000-4000-8000-000000001001","role":"authenticated","aal":"aal2","session_id":"33610000-0000-4000-8000-000000000099"}', true);
select throws_ok($$select * from public.create_occupational_therapy_assessment_draft(
  '33100000-0000-4000-8000-000000000001',
  '33200000-0000-4000-8000-000000000001',
  '33400000-0000-4000-8000-000000000001', current_date,
  current_date + 7, '人工排定：合成會議',
  (select measurements from ot_payloads where payload_key = 'first'),
  (select functional_observation from ot_payloads where payload_key = 'first'),
  (select goals from ot_payloads where payload_key = 'first'),
  (select recommendations from ot_payloads where payload_key = 'first'),
  (select follow_up_plan from ot_payloads where payload_key = 'first'),
  'manual-occupational-therapy-v1',
  '33900000-0000-4000-8000-000000000002')$$,
  '42501', 'occupational_therapy assessment operation is not permitted',
  'non-professional manager cannot write an occupational therapy assessment'
);

select set_config('request.jwt.claims',
  '{"sub":"33000000-0000-4000-8000-000000001002","role":"authenticated","aal":"aal2","session_id":"33610000-0000-4000-8000-000000000001"}', true);

insert into ot_create_result
select * from public.create_occupational_therapy_assessment_draft(
  '33100000-0000-4000-8000-000000000001',
  '33200000-0000-4000-8000-000000000001',
  '33400000-0000-4000-8000-000000000001', current_date - 3,
  current_date + 7, '人工排定：合成服務會議紀錄',
  (select measurements from ot_payloads where payload_key = 'first'),
  (select functional_observation from ot_payloads where payload_key = 'first'),
  (select goals from ot_payloads where payload_key = 'first'),
  (select recommendations from ot_payloads where payload_key = 'first'),
  (select follow_up_plan from ot_payloads where payload_key = 'first'),
  'manual-occupational-therapy-v1',
  '33900000-0000-4000-8000-000000000010');

select ok(
  (select not replayed
      and client_id = '33400000-0000-4000-8000-000000000001'
      and assessment_version = 1 and record_state = 'draft'
      and assessed_on = current_date - 3
      and therapist_user_id = '33000000-0000-4000-8000-000000001002'
      and service_status_at_assessment = 'active'
      and reassessment_due_on = current_date + 7
      and form_version_reference = 'manual-occupational-therapy-v1'
      and operation_id is not null and assessment_key is not null
      and version_id is not null
   from ot_create_result),
  'create returns a complete receipt correlated to client and therapist'
);

reset role;
select ok(
  (select due_basis = '人工排定：合成服務會議紀錄'
      and measurements =
        (select measurements from ot_payloads where payload_key = 'first')
      and functional_observation =
        (select functional_observation from ot_payloads where payload_key = 'first')
      and goals = (select goals from ot_payloads where payload_key = 'first')
      and recommendations =
        (select recommendations from ot_payloads where payload_key = 'first')
      and follow_up_plan =
        (select follow_up_plan from ot_payloads where payload_key = 'first')
      and form_basis = 'manual_unstandardized'
   from public.occupational_therapy_assessment_versions
   where id = (select version_id from ot_create_result)),
  'draft persists every manual field exactly without scoring'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"33000000-0000-4000-8000-000000001002","role":"authenticated","aal":"aal2","session_id":"33610000-0000-4000-8000-000000000001"}', true);

select ok(
  (select replayed
      and assessment_key = (select assessment_key from ot_create_result)
      and version_id = (select version_id from ot_create_result)
   from public.create_occupational_therapy_assessment_draft(
    '33100000-0000-4000-8000-000000000001',
    '33200000-0000-4000-8000-000000000001',
    '33400000-0000-4000-8000-000000000001', current_date - 3,
    current_date + 7, '人工排定：合成服務會議紀錄',
    (select measurements from ot_payloads where payload_key = 'first'),
    (select functional_observation from ot_payloads where payload_key = 'first'),
    (select goals from ot_payloads where payload_key = 'first'),
    (select recommendations from ot_payloads where payload_key = 'first'),
    (select follow_up_plan from ot_payloads where payload_key = 'first'),
    'manual-occupational-therapy-v1',
    '33900000-0000-4000-8000-000000000010')),
  'exact replay returns the same committed version'
);

select throws_ok($$select * from public.create_occupational_therapy_assessment_draft(
  '33100000-0000-4000-8000-000000000001',
  '33200000-0000-4000-8000-000000000001',
  '33400000-0000-4000-8000-000000000001', current_date - 3,
  current_date + 8, '變更同一冪等內容',
  (select measurements from ot_payloads where payload_key = 'revised'),
  (select functional_observation from ot_payloads where payload_key = 'revised'),
  (select goals from ot_payloads where payload_key = 'revised'),
  (select recommendations from ot_payloads where payload_key = 'revised'),
  (select follow_up_plan from ot_payloads where payload_key = 'revised'),
  'manual-occupational-therapy-v1',
  '33900000-0000-4000-8000-000000000010')$$,
  '23505', 'occupational_therapy assessment idempotency conflict',
  'changed content conflicts on the same actor idempotency key'
);

select throws_ok($$select * from public.create_occupational_therapy_assessment_draft(
  '33100000-0000-4000-8000-000000000001',
  '33200000-0000-4000-8000-000000000001',
  '33400000-0000-4000-8000-000000000001', current_date,
  current_date + 8, '人工排定',
  (select measurements from ot_payloads where payload_key = 'first'),
  (select functional_observation from ot_payloads where payload_key = 'first'),
  (select goals from ot_payloads where payload_key = 'first'),
  (select recommendations from ot_payloads where payload_key = 'first'),
  (select follow_up_plan from ot_payloads where payload_key = 'first'),
  'official-occupational-therapy-scale',
  '33900000-0000-4000-8000-000000000011')$$,
  '22023', 'manual occupational_therapy assessment content is invalid',
  'official-looking or unpublished form references are rejected'
);

select throws_ok($$select * from public.create_occupational_therapy_assessment_draft(
  '33100000-0000-4000-8000-000000000001',
  '33200000-0000-4000-8000-000000000001',
  '33400000-0000-4000-8000-000000000001', current_date,
  current_date + 8, '人工排定',
  '[{"name":"握力","state":"missing","value":null,"unit":null,"reason":""}]'::jsonb,
  (select functional_observation from ot_payloads where payload_key = 'first'),
  (select goals from ot_payloads where payload_key = 'first'),
  (select recommendations from ot_payloads where payload_key = 'first'),
  (select follow_up_plan from ot_payloads where payload_key = 'first'),
  'manual-occupational-therapy-v1',
  '33900000-0000-4000-8000-000000000012')$$,
  '22023', 'manual occupational_therapy assessment content is invalid',
  'invalid missing measurement fails the write boundary'
);

select throws_ok($$select * from public.create_occupational_therapy_assessment_draft(
  '33100000-0000-4000-8000-000000000001',
  '33200000-0000-4000-8000-000000000001',
  '33400000-0000-4000-8000-000000000001', current_date + 1,
  current_date + 8, '人工排定',
  (select measurements from ot_payloads where payload_key = 'first'),
  (select functional_observation from ot_payloads where payload_key = 'first'),
  (select goals from ot_payloads where payload_key = 'first'),
  (select recommendations from ot_payloads where payload_key = 'first'),
  (select follow_up_plan from ot_payloads where payload_key = 'first'),
  'manual-occupational-therapy-v1',
  '33900000-0000-4000-8000-000000000013')$$,
  '22023', 'future occupational_therapy assessment date is invalid',
  'future assessment date is rejected'
);

insert into ot_revise_result
select * from public.revise_occupational_therapy_assessment_draft(
  '33100000-0000-4000-8000-000000000001',
  '33200000-0000-4000-8000-000000000001',
  '33400000-0000-4000-8000-000000000001',
  (select assessment_key from ot_create_result),
  (select version_id from ot_create_result), 1,
  current_date - 3, current_date + 5,
  '人工排定：合成跨專業會議紀錄',
  (select measurements from ot_payloads where payload_key = 'revised'),
  (select functional_observation from ot_payloads where payload_key = 'revised'),
  (select goals from ot_payloads where payload_key = 'revised'),
  (select recommendations from ot_payloads where payload_key = 'revised'),
  (select follow_up_plan from ot_payloads where payload_key = 'revised'),
  'manual-occupational-therapy-v1',
  '33900000-0000-4000-8000-000000000014');

select ok(
  (select not replayed and assessment_version = 2
      and record_state = 'draft'
      and therapist_user_id = '33000000-0000-4000-8000-000000001002'
      and assessment_key = (select assessment_key from ot_create_result)
   from ot_revise_result),
  'draft revision appends version two under the current professional'
);

select throws_ok($$select * from public.revise_occupational_therapy_assessment_draft(
  '33100000-0000-4000-8000-000000000001',
  '33200000-0000-4000-8000-000000000001',
  '33400000-0000-4000-8000-000000000001',
  (select assessment_key from ot_create_result),
  (select version_id from ot_create_result), 1,
  current_date - 3, current_date + 5, '人工排定',
  (select measurements from ot_payloads where payload_key = 'revised'),
  (select functional_observation from ot_payloads where payload_key = 'revised'),
  (select goals from ot_payloads where payload_key = 'revised'),
  (select recommendations from ot_payloads where payload_key = 'revised'),
  (select follow_up_plan from ot_payloads where payload_key = 'revised'),
  'manual-occupational-therapy-v1',
  '33900000-0000-4000-8000-000000000015')$$,
  '40001', 'occupational_therapy assessment version is stale',
  'stale expected version is rejected'
);

select set_config('request.jwt.claims',
  '{"sub":"33000000-0000-4000-8000-000000001002","role":"authenticated","aal":"aal2","session_id":"33610000-0000-4000-8000-000000000099"}', true);
select throws_ok($$select * from public.sign_occupational_therapy_assessment(
  '33100000-0000-4000-8000-000000000001',
  '33200000-0000-4000-8000-000000000001',
  '33400000-0000-4000-8000-000000000001',
  (select assessment_key from ot_revise_result),
  (select version_id from ot_revise_result), 2,
  '33900000-0000-4000-8000-000000000016')$$,
  '42501',
  'current same-session recent AAL2 evidence is required for occupational_therapy signing',
  'AAL2 JWT without same-session recent evidence cannot sign'
);

select set_config('request.jwt.claims',
  '{"sub":"33000000-0000-4000-8000-000000001003","role":"authenticated","aal":"aal2","session_id":"33610000-0000-4000-8000-000000000098"}', true);
select throws_ok($$select * from public.sign_occupational_therapy_assessment(
  '33100000-0000-4000-8000-000000000001',
  '33200000-0000-4000-8000-000000000001',
  '33400000-0000-4000-8000-000000000001',
  (select assessment_key from ot_revise_result),
  (select version_id from ot_revise_result), 2,
  '33900000-0000-4000-8000-000000000017')$$,
  '42501', 'only the current qualified occupational therapist may sign this draft',
  'another assigned professional cannot sign the current therapists draft'
);

select set_config('request.jwt.claims',
  '{"sub":"33000000-0000-4000-8000-000000001002","role":"authenticated","aal":"aal2","session_id":"33610000-0000-4000-8000-000000000001"}', true);
insert into ot_sign_result
select * from public.sign_occupational_therapy_assessment(
  '33100000-0000-4000-8000-000000000001',
  '33200000-0000-4000-8000-000000000001',
  '33400000-0000-4000-8000-000000000001',
  (select assessment_key from ot_revise_result),
  (select version_id from ot_revise_result), 2,
  '33900000-0000-4000-8000-000000000018');

select ok(
  (select not replayed and assessment_version = 3
      and record_state = 'signed'
      and therapist_user_id = '33000000-0000-4000-8000-000000001002'
   from ot_sign_result),
  'recent same-session AAL2 signs a new immutable version'
);

reset role;
select ok(
  (select signature_purpose = '人工職能治療評估簽署'
      and signature_reauth_challenge_id =
        '33600000-0000-4000-8000-000000000001'
      and signed_by = '33000000-0000-4000-8000-000000001002'
      and signer_display_name = '合成職能治療師甲'
      and signer_role_keys @> array['professional']::text[]
   from public.occupational_therapy_assessment_versions
   where id = (select version_id from ot_sign_result)),
  'signed version preserves signer role purpose and reauthentication evidence'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"33000000-0000-4000-8000-000000001002","role":"authenticated","aal":"aal2","session_id":"33610000-0000-4000-8000-000000000001"}', true);

select throws_ok($$select * from public.correct_occupational_therapy_assessment(
  '33100000-0000-4000-8000-000000000001',
  '33200000-0000-4000-8000-000000000001',
  '33400000-0000-4000-8000-000000000001',
  (select assessment_key from ot_sign_result),
  (select version_id from ot_sign_result), 3,
  current_date - 3, current_date - 1, '人工排定：合成會議',
  (select measurements from ot_payloads where payload_key = 'corrected'),
  (select functional_observation from ot_payloads where payload_key = 'corrected'),
  (select goals from ot_payloads where payload_key = 'corrected'),
  (select recommendations from ot_payloads where payload_key = 'corrected'),
  (select follow_up_plan from ot_payloads where payload_key = 'corrected'),
  'manual-occupational-therapy-v1', null,
  '33900000-0000-4000-8000-000000000019')$$,
  '22023', 'manual occupational_therapy assessment content is invalid',
  'signed correction requires a reason'
);

insert into ot_correct_result
select * from public.correct_occupational_therapy_assessment(
  '33100000-0000-4000-8000-000000000001',
  '33200000-0000-4000-8000-000000000001',
  '33400000-0000-4000-8000-000000000001',
  (select assessment_key from ot_sign_result),
  (select version_id from ot_sign_result), 3,
  current_date - 3, current_date - 1,
  '人工排定：合成個案研討紀錄',
  (select measurements from ot_payloads where payload_key = 'corrected'),
  (select functional_observation from ot_payloads where payload_key = 'corrected'),
  (select goals from ot_payloads where payload_key = 'corrected'),
  (select recommendations from ot_payloads where payload_key = 'corrected'),
  (select follow_up_plan from ot_payloads where payload_key = 'corrected'),
  'manual-occupational-therapy-v1',
  '原簽署內容有一處實際觀察需更正',
  '33900000-0000-4000-8000-000000000020');

select ok(
  (select not replayed and assessment_version = 4
      and record_state = 'corrected'
      and reassessment_due_on = current_date - 1
      and therapist_user_id = '33000000-0000-4000-8000-000000001002'
   from ot_correct_result),
  'signed content changes only through a reasoned signed correction'
);

reset role;
select ok(
  (select count(*) = 4 and min(version) = 1 and max(version) = 4
      and count(distinct id) = 4
   from public.occupational_therapy_assessment_versions
   where assessment_key = (select assessment_key from ot_create_result))
  and (select previous_version_id = (select version_id from ot_sign_result)
       from public.occupational_therapy_assessment_versions
       where id = (select version_id from ot_correct_result)),
  'history retains four distinct linearly linked versions'
);

select ok(
  (select measurements =
      (select measurements from ot_payloads where payload_key = 'first')
      and functional_observation =
        (select functional_observation from ot_payloads where payload_key = 'first')
   from public.occupational_therapy_assessment_versions
   where id = (select version_id from ot_create_result))
  and (select measurements =
      (select measurements from ot_payloads where payload_key = 'revised')
      and functional_observation =
        (select functional_observation from ot_payloads where payload_key = 'revised')
   from public.occupational_therapy_assessment_versions
   where id = (select version_id from ot_sign_result))
  and (select measurements =
      (select measurements from ot_payloads where payload_key = 'corrected')
      and functional_observation =
        (select functional_observation from ot_payloads where payload_key = 'corrected')
   from public.occupational_therapy_assessment_versions
   where id = (select version_id from ot_correct_result)),
  'old draft signed and corrected content remain exactly reproducible'
);

select ok(
  (select bool_and(
      service_status_at_assessment = 'active'
      and form_basis = 'manual_unstandardized'
      and form_version_reference = 'manual-occupational-therapy-v1'
    ) from public.occupational_therapy_assessment_versions
    where assessment_key = (select assessment_key from ot_create_result)),
  'service and manual form evidence remain stable across the chain'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"33000000-0000-4000-8000-000000001002","role":"authenticated","aal":"aal2","session_id":"33610000-0000-4000-8000-000000000001"}', true);
select throws_ok($$select * from public.revise_occupational_therapy_assessment_draft(
  '33100000-0000-4000-8000-000000000001',
  '33200000-0000-4000-8000-000000000001',
  '33400000-0000-4000-8000-000000000001',
  (select assessment_key from ot_correct_result),
  (select version_id from ot_correct_result), 4,
  current_date - 3, current_date + 8, '人工排定',
  (select measurements from ot_payloads where payload_key = 'first'),
  (select functional_observation from ot_payloads where payload_key = 'first'),
  (select goals from ot_payloads where payload_key = 'first'),
  (select recommendations from ot_payloads where payload_key = 'first'),
  (select follow_up_plan from ot_payloads where payload_key = 'first'),
  'manual-occupational-therapy-v1',
  '33900000-0000-4000-8000-000000000021')$$,
  '23514', 'signed occupational_therapy assessment requires a correction',
  'signed or corrected assessment cannot return to draft'
);

reset role;
select throws_ok($$update public.occupational_therapy_assessment_versions
  set functional_observation = '直接覆寫'
  where id = (select version_id from ot_sign_result)$$,
  '55000', 'occupational therapy assessment history is append-only',
  'direct update is rejected'
);
select throws_ok($$delete from public.occupational_therapy_assessment_versions
  where id = (select version_id from ot_sign_result)$$,
  '55000', 'occupational therapy assessment history is append-only',
  'direct delete is rejected'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"33000000-0000-4000-8000-000000001001","role":"authenticated","aal":"aal2","session_id":"33610000-0000-4000-8000-000000000097"}', true);

select ok(
  (select matching_total = 2 and item_total = 2
      and assessed_total = 1 and not_assessed_total = 1
      and due_total = 1 and upcoming_total = 0
      and draft_total = 0 and completed_total = 1
   from public.occupational_therapy_assessment_snapshot(
    '33100000-0000-4000-8000-000000000001',
    '33200000-0000-4000-8000-000000000001')),
  'manager snapshot metrics reconcile over the complete visible set'
);

select ok(
  (select matching_total = 1
      and items -> 0 ->> 'client_id' =
        '33400000-0000-4000-8000-000000000001'
      and items -> 0 ->> 'service_status' = 'active'
      and items -> 0 ->> 'therapist_user_id' =
        '33000000-0000-4000-8000-000000001002'
      and (items -> 0 ->> 'reassessment_due')::boolean
   from public.occupational_therapy_assessment_snapshot(
    '33100000-0000-4000-8000-000000000001',
    '33200000-0000-4000-8000-000000000001',
    '33400000-0000-4000-8000-000000000001',
    '33000000-0000-4000-8000-000000001002', 'active', 'due')),
  'client therapist current service status and due filters compose'
);

select ok(
  (select matching_total = 1
      and items -> 0 ->> 'client_id' =
        '33400000-0000-4000-8000-000000000002'
      and items -> 0 -> 'measurements' = 'null'::jsonb
   from public.occupational_therapy_assessment_snapshot(
    '33100000-0000-4000-8000-000000000001',
    '33200000-0000-4000-8000-000000000001', null, null,
    'suspended', 'not_assessed')),
  'current service and not-assessed filters keep missing assessment distinct'
);

select ok(
  (select assessment_method_status = 'manual_unstandardized_only'
      and form_publication_status = 'not_published_not_claimed'
      and due_rule_status = 'not_configured_manual_date_and_basis_only'
      and formula_status = 'not_configured'
      and score_status = 'not_configured'
      and diagnosis_status = 'not_configured'
      and attachment_status = 'not_configured'
      and export_status = 'not_configured'
      and reminder_status = 'not_configured'
      and offline_sync_status = 'not_configured'
   from public.occupational_therapy_assessment_snapshot(
    '33100000-0000-4000-8000-000000000001',
    '33200000-0000-4000-8000-000000000001')),
  'unpublished rules and unavailable capabilities are explicitly not configured'
);

select ok(
  (select jsonb_array_length(items -> 0 -> 'version_history') = 4
      and (items -> 0 ->> 'version_history_total')::integer = 4
      and items -> 0 -> 'measurements' -> 0 ->> 'value' = '14.75'
      and items -> 0 -> 'version_history' -> 0 -> 'measurements'
        -> 0 ->> 'value' = '12.50'
      and items -> 0 -> 'version_history' -> 2 -> 'measurements'
        -> 0 ->> 'value' = '15.25'
      and items -> 0 ->> 'goals' = '合成人工目標更正版'
      and items -> 0 ->> 'recommendations' = '合成人工建議更正版'
      and items -> 0 ->> 'follow_up_plan' = '合成人工追蹤更正版'
   from public.occupational_therapy_assessment_snapshot(
    '33100000-0000-4000-8000-000000000001',
    '33200000-0000-4000-8000-000000000001',
    '33400000-0000-4000-8000-000000000001')),
  'snapshot projects exact measurements narratives and all immutable versions'
);

select throws_ok($$select * from public.occupational_therapy_assessment_snapshot(
  '33100000-0000-4000-8000-000000000001',
  '33200000-0000-4000-8000-000000000001', null, null, null,
  'invented_rule')$$,
  '42501', 'occupational_therapy assessment snapshot is not permitted',
  'unknown due filter fails closed'
);

select throws_ok($$select * from public.occupational_therapy_assessment_snapshot(
  '33100000-0000-4000-8000-000000000001',
  '33200000-0000-4000-8000-000000000001', null,
  '33000000-0000-4000-8000-000000001004', null, 'all')$$,
  '42501', 'occupational_therapy therapist filter is not permitted',
  'unknown or out-of-scope therapist filter fails closed'
);

select set_config('request.jwt.claims',
  '{"sub":"33000000-0000-4000-8000-000000001002","role":"authenticated","aal":"aal2","session_id":"33610000-0000-4000-8000-000000000001"}', true);
insert into ot_second_result
select * from public.create_occupational_therapy_assessment_draft(
  '33100000-0000-4000-8000-000000000001',
  '33200000-0000-4000-8000-000000000001',
  '33400000-0000-4000-8000-000000000001', current_date,
  current_date + 14, '人工排定：合成下一次評估',
  (select measurements from ot_payloads where payload_key = 'first'),
  (select functional_observation from ot_payloads where payload_key = 'first'),
  (select goals from ot_payloads where payload_key = 'first'),
  (select recommendations from ot_payloads where payload_key = 'first'),
  (select follow_up_plan from ot_payloads where payload_key = 'first'),
  'manual-occupational-therapy-v1',
  '33900000-0000-4000-8000-000000000030');

select ok(
  (select not replayed and assessment_version = 1
      and record_state = 'draft'
      and assessment_key <> (select assessment_key from ot_create_result)
   from ot_second_result),
  'a later assessment creates another chain rather than overwriting history'
);

select ok(
  (select items -> 0 ->> 'assessment_key' =
      (select assessment_key::text from ot_second_result)
      and items -> 0 ->> 'record_state' = 'draft'
      and items -> 0 ->> 'assessed_on' = current_date::text
   from public.occupational_therapy_assessment_snapshot(
    '33100000-0000-4000-8000-000000000001',
    '33200000-0000-4000-8000-000000000001',
    '33400000-0000-4000-8000-000000000001')),
  'latest assessment is selected by assessed date immediately'
);

select ok(
  (select matching_total = 1 and item_total = 1 and client_total = 1
      and items -> 0 ->> 'client_id' =
        '33400000-0000-4000-8000-000000000001'
   from public.occupational_therapy_assessment_snapshot(
    '33100000-0000-4000-8000-000000000001',
    '33200000-0000-4000-8000-000000000001')),
  'assigned professional sees only assigned clients'
);

select throws_ok($$select * from public.occupational_therapy_assessment_snapshot(
  '33100000-0000-4000-8000-000000000002',
  '33200000-0000-4000-8000-000000000003')$$,
  '42501', 'occupational_therapy assessment snapshot is not permitted',
  'cross-tenant snapshot is rejected'
);

reset role;
select ok(
  not exists (
    select 1 from public.audit_events event
    where event.table_name in (
      'occupational_therapy_assessment_versions',
      'private.occupational_therapy_assessment_operations'
    ) and (
      event.metadata::text like '%合成人工功能觀察第一版%'
      or event.metadata::text like '%合成人工目標更正版%'
      or event.metadata::text like '%合成服務會議紀錄%'
      or event.metadata::text like '%33000000-0000-4000-8000-000000001004%'
    )
  ) and not exists (
    select 1 from public.audit_events event
    where event.table_name = 'occupational_therapy_assessment_versions'
      and event.action = 'select'
      and (
        event.metadata::text like '%33400000-0000-4000-8000-000000000001%'
        or event.metadata::text like '%33000000-0000-4000-8000-000000001002%'
        or event.metadata::text like '%"active"%'
        or event.metadata::text like '%"due"%'
      )
  ) and exists (
    select 1 from public.audit_events event
    where event.table_name = 'occupational_therapy_assessment_versions'
      and event.metadata ->> 'narrative_logged' = 'false'
      and event.metadata ->> 'filter_values_logged' = 'false'
      and event.metadata ->> 'score_computed' = 'false'
      and event.metadata ->> 'diagnosis_computed' = 'false'
  ),
  'audit metadata excludes narratives filter values scores and diagnoses'
);

select is(
  (select count(*) from public.occupational_therapy_assessment_versions
   where organization_id = '33100000-0000-4000-8000-000000000001'
     and branch_id = '33200000-0000-4000-8000-000000000001'),
  5::bigint,
  'two assessments retain all five immutable versions'
);

select is(
  (select count(*) from private.occupational_therapy_assessment_operations
   where actor_user_id = '33000000-0000-4000-8000-000000001002'),
  5::bigint,
  'failed and replayed requests create no extra receipts'
);

select ok(
  (select bool_and(content_hash ~ '^[a-f0-9]{64}$')
   from public.occupational_therapy_assessment_versions
   where organization_id = '33100000-0000-4000-8000-000000000001'),
  'every immutable version carries a SHA-256 hash'
);

select ok(
  position('from matching' in pg_get_functiondef(
    'private.occupational_therapy_assessment_snapshot_bundle(uuid,uuid,uuid,uuid,text,text,timestamptz)'::regprocedure)) > 0
  and position('limit 200' in pg_get_functiondef(
    'private.occupational_therapy_assessment_snapshot_bundle(uuid,uuid,uuid,uuid,text,text,timestamptz)'::regprocedure)) > 0
  and position('cross join stats' in pg_get_functiondef(
    'private.occupational_therapy_assessment_snapshot_bundle(uuid,uuid,uuid,uuid,text,text,timestamptz)'::regprocedure)) > 0,
  'statistics use complete matching rows before bounded details'
);

select ok(
  (select due_basis = '人工排定：合成個案研討紀錄'
      and form_basis = 'manual_unstandardized'
      and form_version_reference = 'manual-occupational-therapy-v1'
      and correction_reason = '原簽署內容有一處實際觀察需更正'
   from public.occupational_therapy_assessment_versions
   where id = (select version_id from ot_correct_result)),
  'manual due basis form reference and correction reason are preserved'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"33000000-0000-4000-8000-000000001001","role":"authenticated","aal":"aal2","session_id":"33610000-0000-4000-8000-000000000097"}', true);
select ok(
  (select not items_truncated and not client_options_truncated
      and not therapist_options_truncated and therapist_total = 1
   from public.occupational_therapy_assessment_snapshot(
    '33100000-0000-4000-8000-000000000001',
    '33200000-0000-4000-8000-000000000001')),
  'bounded option and detail lists disclose truncation explicitly'
);

reset role;
select is(
  (select count(*) from public.audit_events
   where table_name = 'occupational_therapy_assessment_versions'
     and action = 'select'),
  8::bigint,
  'every successful snapshot and filter view is audited'
);

select * from finish();
rollback;
