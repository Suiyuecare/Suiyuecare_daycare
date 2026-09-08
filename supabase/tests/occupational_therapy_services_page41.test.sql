begin;

select plan(52);

select is(
  (select count(*) from public.permissions where permission_key in (
    'occupational_therapy_services.read', 'occupational_therapy_services.manage',
    'occupational_therapy_services.sign'
  )), 3::bigint,
  'page 41 publishes exactly three dedicated permissions'
);
select ok(
  exists (
    select 1 from public.role_permissions role_permission
    join public.roles role on role.id = role_permission.role_id
    join public.permissions permission on permission.id = role_permission.permission_id
    where role.role_key = 'professional'
      and permission.permission_key = 'occupational_therapy_services.manage'
  ) and not exists (
    select 1 from public.role_permissions role_permission
    join public.roles role on role.id = role_permission.role_id
    join public.permissions permission on permission.id = role_permission.permission_id
    where role.role_key = 'case_manager_social_worker'
      and permission.permission_key in (
        'occupational_therapy_services.manage', 'occupational_therapy_services.sign'
      )
  ), 'writes are limited to the professional role template'
);
select ok(
  (select bool_and(relrowsecurity and relforcerowsecurity)
   from pg_class where oid in (
    'public.occupational_therapy_service_record_versions'::regclass,
    'private.occupational_therapy_service_operations'::regclass
  )), 'service versions and receipts force RLS'
);
select ok(
  not has_table_privilege('authenticated',
    'public.occupational_therapy_service_record_versions',
    'select,insert,update,delete')
  and not has_table_privilege('service_role',
    'public.occupational_therapy_service_record_versions',
    'select,insert,update,delete')
  and not has_table_privilege('authenticated',
    'private.occupational_therapy_service_operations',
    'select,insert,update,delete'),
  'browser and service roles receive no direct table access'
);
select ok(
  has_function_privilege('authenticated',
    'public.create_occupational_therapy_service_draft(uuid,uuid,uuid,timestamptz,jsonb,jsonb,jsonb,uuid)', 'execute')
  and has_function_privilege('authenticated',
    'public.revise_occupational_therapy_service_draft(uuid,uuid,uuid,uuid,uuid,integer,timestamptz,jsonb,jsonb,jsonb,uuid)', 'execute')
  and has_function_privilege('authenticated',
    'public.sign_occupational_therapy_service_record(uuid,uuid,uuid,uuid,uuid,integer,uuid)', 'execute')
  and has_function_privilege('authenticated',
    'public.correct_occupational_therapy_service_record(uuid,uuid,uuid,uuid,uuid,integer,timestamptz,jsonb,jsonb,jsonb,text,uuid)', 'execute')
  and has_function_privilege('authenticated',
    'public.occupational_therapy_service_snapshot(uuid,uuid,date,date,uuid,uuid,text,text)', 'execute')
  and not has_function_privilege('service_role',
    'public.sign_occupational_therapy_service_record(uuid,uuid,uuid,uuid,uuid,integer,uuid)', 'execute'),
  'only authenticated callers receive exact public RPC signatures'
);
select ok(
  not (select prosecdef from pg_proc where oid =
    'public.create_occupational_therapy_service_draft(uuid,uuid,uuid,timestamptz,jsonb,jsonb,jsonb,uuid)'::regprocedure)
  and not (select prosecdef from pg_proc where oid =
    'public.occupational_therapy_service_snapshot(uuid,uuid,date,date,uuid,uuid,text,text)'::regprocedure)
  and (select prosecdef and coalesce(proconfig, '{}'::text[]) @>
      array['search_path=""'] from pg_proc where oid =
    'private.mutate_occupational_therapy_service_guarded(text,uuid,uuid,uuid,uuid,uuid,integer,timestamptz,jsonb,jsonb,jsonb,text,uuid)'::regprocedure)
  and not has_function_privilege('public',
    'private.mutate_occupational_therapy_service_guarded(text,uuid,uuid,uuid,uuid,uuid,integer,timestamptz,jsonb,jsonb,jsonb,text,uuid)', 'execute'),
  'public wrappers are invoker and private core is pinned and not public'
);
select ok(
  position('pg_advisory_xact_lock' in pg_get_functiondef(
    'private.mutate_occupational_therapy_service_guarded(text,uuid,uuid,uuid,uuid,uuid,integer,timestamptz,jsonb,jsonb,jsonb,text,uuid)'::regprocedure)) > 0
  and position('authority expired' in pg_get_functiondef(
    'private.mutate_occupational_therapy_service_guarded(text,uuid,uuid,uuid,uuid,uuid,integer,timestamptz,jsonb,jsonb,jsonb,text,uuid)'::regprocedure)) > 0
  and position('v_after is distinct from v_bundle' in pg_get_functiondef(
    'private.occupational_therapy_service_snapshot_response(uuid,uuid,date,date,uuid,uuid,text,text)'::regprocedure)) > 0,
  'writes serialize and reads and writes recheck authority'
);
select is((select count(*) from pg_trigger where not tgisinternal and tgname in (
  'occupational_therapy_service_record_versions_append_only',
  'occupational_therapy_service_operations_append_only'
)), 2::bigint, 'both service streams are append only');
select is((select count(*) from pg_trigger where not tgisinternal and tgname in (
  'occupational_therapy_service_record_versions_audit_row_change',
  'occupational_therapy_service_operations_audit_row_change'
)), 2::bigint, 'both service streams carry exact audit triggers');
select is((select count(*) from information_schema.columns
  where table_schema = 'public'
    and table_name = 'occupational_therapy_service_record_versions'
    and column_name in ('score','formula','diagnosis',
      'automatic_recommendation','attachment_url','offline_payload')),
  0::bigint,
  'service records store no invented formula diagnosis recommendation or unsafe attachment path'
);
select ok(private.occupational_therapy_service_value_is_valid(
  '{"state":"recorded","text":"合成服務內容","reason":null}'::jsonb
), 'recorded value preserves explicit text');
select ok(private.occupational_therapy_service_value_is_valid(
  '{"state":"missing","text":null,"reason":"合成示例：本次未取得"}'::jsonb
), 'missing is explicit and reasoned');
select ok(private.occupational_therapy_service_value_is_valid(
  '{"state":"not_applicable","text":null,"reason":"合成示例：本次情境不適用"}'::jsonb
), 'not applicable is distinct and reasoned');
select ok(not private.occupational_therapy_service_value_is_valid(
  '{"state":"missing","text":null,"reason":""}'::jsonb
), 'missing without a reason fails closed');
select ok(not private.occupational_therapy_service_value_is_valid(
  '{"state":"recorded","text":"合成服務內容","reason":null,"score":9}'::jsonb
), 'unexpected clinical fields fail closed');

insert into auth.users (id, aud, role, email, created_at, updated_at) values
  ('40000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'manager40@example.invalid', now(), now()),
  ('40000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'therapist40@example.invalid', now(), now()),
  ('40000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'reviewer40@example.invalid', now(), now()),
  ('40000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'other40@example.invalid', now(), now());
insert into public.organizations (id, code, name) values
  ('40100000-0000-4000-8000-000000000001', 'pt_service_40_a', '合成職能治療服務機構 A'),
  ('40100000-0000-4000-8000-000000000002', 'pt_service_40_b', '合成職能治療服務機構 B');
insert into public.branches (id, organization_id, code, name) values
  ('40200000-0000-4000-8000-000000000001', '40100000-0000-4000-8000-000000000001', 'main', '合成 A 主分支'),
  ('40200000-0000-4000-8000-000000000002', '40100000-0000-4000-8000-000000000001', 'second', '合成 A 次分支'),
  ('40200000-0000-4000-8000-000000000003', '40100000-0000-4000-8000-000000000002', 'main', '合成 B 主分支');
insert into public.profiles (id, display_name, kind) values
  ('40000000-0000-4000-8000-000000000001', '合成服務主管', 'staff'),
  ('40000000-0000-4000-8000-000000000002', '合成職能治療師甲', 'professional'),
  ('40000000-0000-4000-8000-000000000003', '合成職能治療師乙', 'professional'),
  ('40000000-0000-4000-8000-000000000004', '合成他機構主管', 'staff');
insert into public.memberships (id, organization_id, branch_id, profile_id, status) values
  ('40300000-0000-4000-8000-000000000001', '40100000-0000-4000-8000-000000000001', null, '40000000-0000-4000-8000-000000000001', 'active'),
  ('40300000-0000-4000-8000-000000000002', '40100000-0000-4000-8000-000000000001', '40200000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000002', 'active'),
  ('40300000-0000-4000-8000-000000000003', '40100000-0000-4000-8000-000000000001', '40200000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000003', 'active'),
  ('40300000-0000-4000-8000-000000000004', '40100000-0000-4000-8000-000000000002', null, '40000000-0000-4000-8000-000000000004', 'active');
insert into public.membership_roles (membership_id, role_id) values
  ('40300000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002'),
  ('40300000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000007'),
  ('40300000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000007'),
  ('40300000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000002');
insert into public.clients (id, organization_id, branch_id, client_code,
  display_name, status, admitted_on, ended_on) values
  ('40400000-0000-4000-8000-000000000001', '40100000-0000-4000-8000-000000000001', '40200000-0000-4000-8000-000000000001', 'PTS-1', '合成服務個案甲', 'active', current_date - 90, null),
  ('40400000-0000-4000-8000-000000000002', '40100000-0000-4000-8000-000000000001', '40200000-0000-4000-8000-000000000001', 'PTS-2', '合成服務個案乙', 'suspended', current_date - 60, null),
  ('40400000-0000-4000-8000-000000000003', '40100000-0000-4000-8000-000000000001', '40200000-0000-4000-8000-000000000002', 'PTS-3', '合成他分支個案', 'active', current_date - 60, null),
  ('40400000-0000-4000-8000-000000000004', '40100000-0000-4000-8000-000000000002', '40200000-0000-4000-8000-000000000003', 'PTS-4', '合成他機構個案', 'active', current_date - 60, null);
insert into public.client_assignments (id, organization_id, branch_id,
  client_id, assignee_user_id, assignment_kind) values
  ('40500000-0000-4000-8000-000000000001', '40100000-0000-4000-8000-000000000001', '40200000-0000-4000-8000-000000000001', '40400000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000002', 'occupational-therapy-service'),
  ('40500000-0000-4000-8000-000000000002', '40100000-0000-4000-8000-000000000001', '40200000-0000-4000-8000-000000000001', '40400000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000003', 'occupational-therapy-review');

insert into private.reauth_challenges (id, user_id, session_id,
  nonce_sha256, idempotency_key, issued_jwt_iat, created_at, expires_at,
  consumed_at, consumed_jwt_iat, factor_method, factor_verified_at) values
  ('40600000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000002', '40610000-0000-4000-8000-000000000001', repeat('4',64), '40620000-0000-4000-8000-000000000001', clock_timestamp()-interval '2 minutes', clock_timestamp()-interval '2 minutes', clock_timestamp()+interval '6 minutes', clock_timestamp()-interval '30 seconds', clock_timestamp()-interval '30 seconds', 'totp', clock_timestamp()-interval '30 seconds'),
  ('40600000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000003', '40610000-0000-4000-8000-000000000002', repeat('5',64), '40620000-0000-4000-8000-000000000002', clock_timestamp()-interval '2 minutes', clock_timestamp()-interval '2 minutes', clock_timestamp()+interval '6 minutes', clock_timestamp()-interval '30 seconds', clock_timestamp()-interval '30 seconds', 'totp', clock_timestamp()-interval '30 seconds');
insert into private.reauth_events (user_id, session_id, challenge_id, aal,
  verification_method, verified_at) values
  ('40000000-0000-4000-8000-000000000002', '40610000-0000-4000-8000-000000000001', '40600000-0000-4000-8000-000000000001', 'aal2', 'totp', (select factor_verified_at from private.reauth_challenges where id='40600000-0000-4000-8000-000000000001')),
  ('40000000-0000-4000-8000-000000000003', '40610000-0000-4000-8000-000000000002', '40600000-0000-4000-8000-000000000002', 'aal2', 'totp', (select factor_verified_at from private.reauth_challenges where id='40600000-0000-4000-8000-000000000002'));

insert into public.occupational_therapy_assessment_versions (
  id, organization_id, branch_id, client_id, assessment_key, version,
  previous_version_id, record_state, assessed_on, therapist_user_id,
  therapist_display_name, service_status_at_assessment,
  reassessment_due_on, due_basis, measurements, functional_observation,
  goals, recommendations, follow_up_plan, form_basis,
  form_version_reference, correction_reason, signed_at, signed_by,
  signer_display_name, signer_role_keys, signature_purpose,
  signature_reauth_challenge_id, content_hash, created_at
) values (
  '40700000-0000-4000-8000-000000000001',
  '40100000-0000-4000-8000-000000000001',
  '40200000-0000-4000-8000-000000000001',
  '40400000-0000-4000-8000-000000000001',
  '40710000-0000-4000-8000-000000000001', 1, null, 'signed',
  current_date - 10, '40000000-0000-4000-8000-000000000002',
  '合成職能治療師甲', 'active', current_date + 20,
  '合成示例：人工排定複評',
  '[{"name":"合成人工觀察","state":"text","value":"合成評估內容","unit":null,"reason":null}]'::jsonb,
  '合成功能觀察', '合成目標', '合成建議', '合成追蹤',
  'manual_unstandardized', 'manual-occupational-therapy-v1', null,
  clock_timestamp()-interval '1 minute',
  '40000000-0000-4000-8000-000000000002', '合成職能治療師甲',
  array['professional'], '人工職能治療評估簽署',
  '40600000-0000-4000-8000-000000000001', repeat('a',64),
  clock_timestamp()-interval '1 minute'
);

create temporary table service_payloads (
  payload_key text primary key, service_content jsonb not null,
  client_reaction jsonb not null, recommendation jsonb not null
);
insert into service_payloads values
  ('first',
   '{"state":"recorded","text":"合成服務內容第一版","reason":null}',
   '{"state":"missing","text":null,"reason":"合成示例：本次未取得個案反應"}',
   '{"state":"not_applicable","text":null,"reason":"合成示例：本次未形成建議"}'),
  ('revised',
   '{"state":"recorded","text":"合成服務內容第二版","reason":null}',
   '{"state":"recorded","text":"合成個案反應第二版","reason":null}',
   '{"state":"recorded","text":"合成人工建議第二版","reason":null}'),
  ('corrected',
   '{"state":"recorded","text":"合成服務內容更正版","reason":null}',
   '{"state":"not_applicable","text":null,"reason":"合成示例：更正後不適用"}',
   '{"state":"recorded","text":"合成人工建議更正版","reason":null}');
create temporary table create_result as
select null::uuid operation_id, null::uuid organization_id,
  null::uuid branch_id, null::uuid client_id, null::uuid record_key,
  null::uuid version_id, 0::integer record_version, null::text record_state,
  clock_timestamp() occurred_at, null::uuid therapist_user_id,
  null::text service_status_at_occurrence,
  null::uuid assessment_reference_version_id,
  clock_timestamp() committed_at, false replayed with no data;
create temporary table revise_result (like create_result);
create temporary table sign_result (like create_result);
create temporary table correct_result (like create_result);
create temporary table no_assessment_result (like create_result);
grant select on service_payloads to authenticated;
grant select, insert on create_result, revise_result, sign_result,
  correct_result, no_assessment_result to authenticated;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"40000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1","session_id":"40610000-0000-4000-8000-000000000099"}', true);
select throws_ok($$select * from public.occupational_therapy_service_snapshot(
  '40100000-0000-4000-8000-000000000001',
  '40200000-0000-4000-8000-000000000001')$$,
  '42501', 'occupational therapy service snapshot is not permitted',
  'reads require an AAL2 staff session');

select set_config('request.jwt.claims',
  '{"sub":"40000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"40610000-0000-4000-8000-000000000099"}', true);
select throws_ok($$select * from public.occupational_therapy_service_snapshot(
  '40100000-0000-4000-8000-000000000001',
  '40200000-0000-4000-8000-000000000002')$$,
  '42501', 'occupational therapy service snapshot is not permitted',
  'branch-scoped professional cannot read another branch');
select throws_ok($$select * from public.create_occupational_therapy_service_draft(
  '40100000-0000-4000-8000-000000000001',
  '40200000-0000-4000-8000-000000000001',
  '40400000-0000-4000-8000-000000000002', clock_timestamp()-interval '1 day',
  (select service_content from service_payloads where payload_key='first'),
  (select client_reaction from service_payloads where payload_key='first'),
  (select recommendation from service_payloads where payload_key='first'),
  '40900000-0000-4000-8000-000000000001')$$,
  '42501', 'occupational therapy service operation is not permitted',
  'unassigned client write fails closed');

select set_config('request.jwt.claims',
  '{"sub":"40000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"40610000-0000-4000-8000-000000000099"}', true);
select throws_ok($$select * from public.create_occupational_therapy_service_draft(
  '40100000-0000-4000-8000-000000000001',
  '40200000-0000-4000-8000-000000000001',
  '40400000-0000-4000-8000-000000000001', clock_timestamp()-interval '1 day',
  (select service_content from service_payloads where payload_key='first'),
  (select client_reaction from service_payloads where payload_key='first'),
  (select recommendation from service_payloads where payload_key='first'),
  '40900000-0000-4000-8000-000000000002')$$,
  '42501', 'occupational therapy service operation is not permitted',
  'non-professional manager cannot create a service draft');

select set_config('request.jwt.claims',
  '{"sub":"40000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"40610000-0000-4000-8000-000000000099"}', true);
insert into create_result select *
from public.create_occupational_therapy_service_draft(
  '40100000-0000-4000-8000-000000000001',
  '40200000-0000-4000-8000-000000000001',
  '40400000-0000-4000-8000-000000000001', clock_timestamp()-interval '1 day',
  (select service_content from service_payloads where payload_key='first'),
  (select client_reaction from service_payloads where payload_key='first'),
  (select recommendation from service_payloads where payload_key='first'),
  '40900000-0000-4000-8000-000000000010');
select ok((select not replayed and record_version=1 and record_state='draft'
    and therapist_user_id='40000000-0000-4000-8000-000000000002'
    and assessment_reference_version_id='40700000-0000-4000-8000-000000000001'
  from create_result),
  'draft creation freezes therapist and latest effective terminal assessment');

reset role;
select ok((select service_content=
      (select service_content from service_payloads where payload_key='first')
    and client_reaction->>'state'='missing'
    and recommendation->>'state'='not_applicable'
    and assessment_reference_key='40710000-0000-4000-8000-000000000001'
    and assessment_reference_version=1
  from public.occupational_therapy_service_record_versions
  where id=(select version_id from create_result)),
  'draft persists exact values and database-selected assessment reference');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"40000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"40610000-0000-4000-8000-000000000099"}', true);
select ok((select replayed and version_id=(select version_id from create_result)
  from public.create_occupational_therapy_service_draft(
    '40100000-0000-4000-8000-000000000001',
    '40200000-0000-4000-8000-000000000001',
    '40400000-0000-4000-8000-000000000001',
    (select occurred_at from create_result),
    (select service_content from service_payloads where payload_key='first'),
    (select client_reaction from service_payloads where payload_key='first'),
    (select recommendation from service_payloads where payload_key='first'),
    '40900000-0000-4000-8000-000000000010')),
  'exact actor-scoped replay returns same committed version');
select throws_ok($$select * from public.create_occupational_therapy_service_draft(
  '40100000-0000-4000-8000-000000000001',
  '40200000-0000-4000-8000-000000000001',
  '40400000-0000-4000-8000-000000000001',
  (select occurred_at from create_result),
  (select service_content from service_payloads where payload_key='revised'),
  (select client_reaction from service_payloads where payload_key='revised'),
  (select recommendation from service_payloads where payload_key='revised'),
  '40900000-0000-4000-8000-000000000010')$$,
  '23505', 'occupational therapy service idempotency conflict',
  'changed request conflicts on same actor key');
select throws_ok($$select * from public.create_occupational_therapy_service_draft(
  '40100000-0000-4000-8000-000000000001',
  '40200000-0000-4000-8000-000000000001',
  '40400000-0000-4000-8000-000000000001', clock_timestamp()+interval '1 day',
  (select service_content from service_payloads where payload_key='first'),
  (select client_reaction from service_payloads where payload_key='first'),
  (select recommendation from service_payloads where payload_key='first'),
  '40900000-0000-4000-8000-000000000011')$$,
  '22023', 'future occupational therapy service occurrence is invalid',
  'future occurrence fails closed');

insert into revise_result select *
from public.revise_occupational_therapy_service_draft(
  '40100000-0000-4000-8000-000000000001',
  '40200000-0000-4000-8000-000000000001',
  '40400000-0000-4000-8000-000000000001',
  (select record_key from create_result), (select version_id from create_result), 1,
  (select occurred_at from create_result),
  (select service_content from service_payloads where payload_key='revised'),
  (select client_reaction from service_payloads where payload_key='revised'),
  (select recommendation from service_payloads where payload_key='revised'),
  '40900000-0000-4000-8000-000000000012');
select ok((select record_version=2 and record_state='draft' and not replayed
  from revise_result), 'draft revision appends version two');
select throws_ok($$select * from public.revise_occupational_therapy_service_draft(
  '40100000-0000-4000-8000-000000000001',
  '40200000-0000-4000-8000-000000000001',
  '40400000-0000-4000-8000-000000000001',
  (select record_key from create_result), (select version_id from create_result), 1,
  (select occurred_at from create_result),
  (select service_content from service_payloads where payload_key='revised'),
  (select client_reaction from service_payloads where payload_key='revised'),
  (select recommendation from service_payloads where payload_key='revised'),
  '40900000-0000-4000-8000-000000000013')$$,
  '40001', 'occupational therapy service version is stale',
  'stale expected version is rejected');

select throws_ok($$select * from public.sign_occupational_therapy_service_record(
  '40100000-0000-4000-8000-000000000001',
  '40200000-0000-4000-8000-000000000001',
  '40400000-0000-4000-8000-000000000001',
  (select record_key from revise_result), (select version_id from revise_result), 2,
  '40900000-0000-4000-8000-000000000014')$$,
  '42501', 'recent same-session AAL2 is required for occupational therapy service signing',
  'sign requires recent same-session AAL2');

select set_config('request.jwt.claims',
  '{"sub":"40000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2","session_id":"40610000-0000-4000-8000-000000000002"}', true);
select throws_ok($$select * from public.sign_occupational_therapy_service_record(
  '40100000-0000-4000-8000-000000000001',
  '40200000-0000-4000-8000-000000000001',
  '40400000-0000-4000-8000-000000000001',
  (select record_key from revise_result), (select version_id from revise_result), 2,
  '40900000-0000-4000-8000-000000000015')$$,
  '42501', 'only the current occupational therapist may sign this draft',
  'another assigned therapist cannot sign this draft');

select set_config('request.jwt.claims',
  '{"sub":"40000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"40610000-0000-4000-8000-000000000001"}', true);
insert into sign_result select *
from public.sign_occupational_therapy_service_record(
  '40100000-0000-4000-8000-000000000001',
  '40200000-0000-4000-8000-000000000001',
  '40400000-0000-4000-8000-000000000001',
  (select record_key from revise_result), (select version_id from revise_result), 2,
  '40900000-0000-4000-8000-000000000016');
select ok((select record_version=3 and record_state='signed' and not replayed
  from sign_result), 'recent AAL2 signs a new immutable version');

reset role;
select ok((select signature_purpose='職能治療服務紀錄簽署'
    and signature_reauth_challenge_id='40600000-0000-4000-8000-000000000001'
    and signed_by='40000000-0000-4000-8000-000000000002'
    and signer_role_keys @> array['professional']::text[]
  from public.occupational_therapy_service_record_versions
  where id=(select version_id from sign_result)),
  'signed version freezes signer role purpose and reauthentication evidence');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"40000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"40610000-0000-4000-8000-000000000001"}', true);
select throws_ok($$select * from public.correct_occupational_therapy_service_record(
  '40100000-0000-4000-8000-000000000001',
  '40200000-0000-4000-8000-000000000001',
  '40400000-0000-4000-8000-000000000001',
  (select record_key from sign_result), (select version_id from sign_result), 3,
  (select occurred_at from sign_result),
  (select service_content from service_payloads where payload_key='corrected'),
  (select client_reaction from service_payloads where payload_key='corrected'),
  (select recommendation from service_payloads where payload_key='corrected'),
  null, '40900000-0000-4000-8000-000000000017')$$,
  '22023', 'occupational therapy service content is invalid',
  'signed correction requires a reason');
insert into correct_result select *
from public.correct_occupational_therapy_service_record(
  '40100000-0000-4000-8000-000000000001',
  '40200000-0000-4000-8000-000000000001',
  '40400000-0000-4000-8000-000000000001',
  (select record_key from sign_result), (select version_id from sign_result), 3,
  (select occurred_at from sign_result),
  (select service_content from service_payloads where payload_key='corrected'),
  (select client_reaction from service_payloads where payload_key='corrected'),
  (select recommendation from service_payloads where payload_key='corrected'),
  '原簽署服務內容需做狹義更正',
  '40900000-0000-4000-8000-000000000018');
select ok((select record_version=4 and record_state='corrected' and not replayed
  from correct_result), 'reasoned correction appends signed corrected version');

reset role;
select ok((select count(*)=4 and min(version)=1 and max(version)=4
    and count(distinct id)=4
  from public.occupational_therapy_service_record_versions
  where record_key=(select record_key from create_result)),
  'history retains four distinct linearly linked versions');
select ok(
  (select service_content=(select service_content from service_payloads where payload_key='first')
   from public.occupational_therapy_service_record_versions
   where id=(select version_id from create_result))
  and (select service_content=(select service_content from service_payloads where payload_key='revised')
   from public.occupational_therapy_service_record_versions
   where id=(select version_id from sign_result))
  and (select service_content=(select service_content from service_payloads where payload_key='corrected')
   from public.occupational_therapy_service_record_versions
   where id=(select version_id from correct_result)),
  'draft signed and corrected narratives remain exactly reproducible');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"40000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"40610000-0000-4000-8000-000000000001"}', true);
select ok((select replayed and version_id=(select version_id from correct_result)
  from public.correct_occupational_therapy_service_record(
    '40100000-0000-4000-8000-000000000001',
    '40200000-0000-4000-8000-000000000001',
    '40400000-0000-4000-8000-000000000001',
    (select record_key from correct_result),
    (select version_id from sign_result), 3,
    (select occurred_at from sign_result),
    (select service_content from service_payloads where payload_key='corrected'),
    (select client_reaction from service_payloads where payload_key='corrected'),
    (select recommendation from service_payloads where payload_key='corrected'),
    '原簽署服務內容需做狹義更正',
    '40900000-0000-4000-8000-000000000018')),
  'exact correction retry returns the same committed terminal version');
select throws_ok($$select * from public.correct_occupational_therapy_service_record(
  '40100000-0000-4000-8000-000000000001',
  '40200000-0000-4000-8000-000000000001',
  '40400000-0000-4000-8000-000000000001',
  (select record_key from correct_result),
  (select version_id from sign_result), 3,
  (select occurred_at from sign_result),
  (select service_content from service_payloads where payload_key='corrected'),
  (select client_reaction from service_payloads where payload_key='corrected'),
  (select recommendation from service_payloads where payload_key='corrected'),
  '同一操作鍵改用不同更正理由必須拒絕',
  '40900000-0000-4000-8000-000000000018')$$,
  '23505', 'occupational therapy service idempotency conflict',
  'changed correction content cannot reuse an actor-scoped key');
reset role;

select throws_ok($$update public.occupational_therapy_service_record_versions
  set recommendation='{"state":"recorded","text":"覆寫","reason":null}'::jsonb$$,
  '55000', 'occupational therapy service history is append-only',
  'signed and draft history cannot be updated in place');
select throws_ok($$delete from public.occupational_therapy_service_record_versions$$,
  '55000', 'occupational therapy service history is append-only',
  'service history cannot be deleted');
select throws_ok($$update private.occupational_therapy_service_operations
  set result_version=result_version+1$$,
  '55000', 'occupational therapy service history is append-only',
  'operation receipts are append only');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"40000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"40610000-0000-4000-8000-000000000001"}', true);
select ok((select record_total=1 and matching_total=1
    and records->0->>'record_state'='corrected'
    and jsonb_array_length(records->0->'version_history')=4
    and (records->0->>'version_history_total')::integer=4
  from public.occupational_therapy_service_snapshot(
    '40100000-0000-4000-8000-000000000001',
    '40200000-0000-4000-8000-000000000001')),
  'snapshot returns one terminal record with all four immutable versions');
select ok((select draft_total=0 and signed_total=0 and corrected_total=1
    and linked_assessment_total=1 and not records_truncated
  from public.occupational_therapy_service_snapshot(
    '40100000-0000-4000-8000-000000000001',
    '40200000-0000-4000-8000-000000000001')),
  'snapshot metrics are computed from the complete matching set');
select ok((select assessment_link_status='readonly_latest_terminal'
    and formula_status='not_configured'
    and diagnosis_status='not_configured'
    and automatic_recommendation_status='not_configured'
    and attachment_status='not_configured'
    and export_status='not_configured'
    and offline_sync_status='not_configured'
  from public.occupational_therapy_service_snapshot(
    '40100000-0000-4000-8000-000000000001',
    '40200000-0000-4000-8000-000000000001')),
  'ungoverned formula diagnosis recommendation attachment export and offline claims stay closed');
select ok((select matching_total=1 and records->0->>'record_state'='corrected'
  from public.occupational_therapy_service_snapshot(
    '40100000-0000-4000-8000-000000000001',
    '40200000-0000-4000-8000-000000000001',
    null,null,null,null,'corrected',null)),
  'record-state filter returns the exact terminal state');
select ok((select matching_total=1 and jsonb_array_length(records)=1
  from public.occupational_therapy_service_snapshot(
    '40100000-0000-4000-8000-000000000001',
    '40200000-0000-4000-8000-000000000001',
    null,null,null,null,null,'更正版')),
  'keyword filter searches the exact visible narrative without logging its value');
select throws_ok($$select * from public.occupational_therapy_service_snapshot(
  '40100000-0000-4000-8000-000000000001',
  '40200000-0000-4000-8000-000000000001',
  current_date,current_date-1)$$,
  '42501', 'occupational therapy service snapshot is not permitted',
  'reversed date filters fail closed');
select throws_ok($$select * from public.occupational_therapy_service_snapshot(
  '40100000-0000-4000-8000-000000000001',
  '40200000-0000-4000-8000-000000000001',
  null,null,null,'40000000-0000-4000-8000-000000000004')$$,
  '42501', 'occupational therapy service therapist filter is not permitted',
  'unknown therapist filters cannot become broad queries');
select throws_ok($$select * from public.occupational_therapy_service_snapshot(
  '40100000-0000-4000-8000-000000000001',
  '40200000-0000-4000-8000-000000000001',
  null,null,'40400000-0000-4000-8000-000000000002')$$,
  '42501', 'occupational therapy service client filter is not permitted',
  'unassigned client filters fail closed');
reset role;

select ok((select count(*)>=5 and bool_and(
    metadata->>'filter_values_logged'='false'
    and metadata->>'narrative_logged'='false'
    and not (metadata ? 'keyword')
  ) from public.audit_events
  where table_name='occupational_therapy_service_record_versions'
    and action='select'),
  'snapshot audits record counts and fingerprints but no keyword or narrative');
select ok((select count(*)=4
    and count(*) filter (where reauth_challenge_id is null)=2
    and count(*) filter (where reauth_challenge_id is not null)=2
  from private.occupational_therapy_service_operations),
  'four successful operations preserve exact draft versus high-risk reauth evidence');
select ok((select count(*)=4 and count(distinct content_hash)=4
    and bool_and(content_hash ~ '^[a-f0-9]{64}$')
  from public.occupational_therapy_service_record_versions),
  'each immutable version carries a distinct reproducible content hash');
select ok((select count(*)=4 and bool_and(
    assessment_reference_version_id='40700000-0000-4000-8000-000000000001'
    and assessment_reference_key='40710000-0000-4000-8000-000000000001'
    and assessment_reference_version=1
  ) from public.occupational_therapy_service_record_versions),
  'every version freezes the server-selected Page 33 assessment reference');
select ok((select count(*)=4
    and count(*) filter (where previous_version_id is null)=1
    and count(distinct previous_version_id) filter (
      where previous_version_id is not null)=3
  from public.occupational_therapy_service_record_versions
  where record_key=(select record_key from create_result)),
  'the version chain has one root and three unique append-only links');

select * from finish();
rollback;
