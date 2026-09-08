begin;

-- Assessment dates are Taiwan business dates.  Keep current_date fixtures on
-- the same Asia/Taipei boundary as the production future-date guard.
set local time zone 'Asia/Taipei';

select plan(50);

select is(
  (select count(*) from public.permissions where permission_key in (
    'assessments.read', 'assessments.manage'
  )),
  2::bigint,
  'page 11 publishes read and manage permissions'
);

select ok(
  exists (
    select 1 from public.role_permissions role_permission
    join public.roles role on role.id = role_permission.role_id
    join public.permissions permission
      on permission.id = role_permission.permission_id
    where role.role_key = 'professional'
      and permission.permission_key = 'assessments.manage'
  ) and exists (
    select 1 from public.role_permissions role_permission
    join public.roles role on role.id = role_permission.role_id
    join public.permissions permission
      on permission.id = role_permission.permission_id
    where role.role_key = 'case_manager_social_worker'
      and permission.permission_key = 'assessments.read'
  ),
  'approved staff templates receive the governed assessment permissions'
);

select ok(
  (select bool_and(relrowsecurity and relforcerowsecurity)
   from pg_class where oid in (
    'public.spmsq_assessment_versions'::regclass,
    'private.spmsq_assessment_operations'::regclass
  )),
  'candidate versions and operation receipts force RLS'
);

select ok(
  not has_table_privilege('authenticated',
    'public.spmsq_assessment_versions', 'select,insert,update,delete')
  and not has_table_privilege('service_role',
    'public.spmsq_assessment_versions', 'select,insert,update,delete')
  and not has_table_privilege('authenticated',
    'private.spmsq_assessment_operations', 'select,insert,update,delete')
  and not has_table_privilege('service_role',
    'private.spmsq_assessment_operations', 'select,insert,update,delete'),
  'browser and service roles receive no direct table privileges'
);

select ok(
  has_function_privilege('authenticated',
    'public.create_spmsq_assessment_draft(uuid,uuid,uuid,date,jsonb,jsonb,jsonb,text,uuid)',
    'execute')
  and has_function_privilege('authenticated',
    'public.revise_spmsq_assessment_draft(uuid,uuid,uuid,uuid,uuid,integer,date,jsonb,jsonb,jsonb,text,uuid)',
    'execute')
  and has_function_privilege('authenticated',
    'public.sign_spmsq_assessment(uuid,uuid,uuid,uuid,uuid,integer,uuid)',
    'execute')
  and has_function_privilege('authenticated',
    'public.spmsq_assessment_snapshot(uuid,uuid,uuid,text,text)',
    'execute')
  and not has_function_privilege('service_role',
    'public.sign_spmsq_assessment(uuid,uuid,uuid,uuid,uuid,integer,uuid)',
    'execute'),
  'authenticated callers receive only the exact public RPC signatures'
);

select ok(
  not (select prosecdef from pg_proc where oid =
    'public.create_spmsq_assessment_draft(uuid,uuid,uuid,date,jsonb,jsonb,jsonb,text,uuid)'::regprocedure)
  and not (select prosecdef from pg_proc where oid =
    'public.spmsq_assessment_snapshot(uuid,uuid,uuid,text,text)'::regprocedure),
  'public wrappers remain SECURITY INVOKER'
);

select ok(
  (select prosecdef and coalesce(proconfig, '{}'::text[]) @>
      array['search_path=""']
   from pg_proc where oid =
    'private.mutate_spmsq_assessment_guarded(text,uuid,uuid,uuid,uuid,uuid,integer,date,jsonb,jsonb,jsonb,text,uuid)'::regprocedure)
  and (select prosecdef and coalesce(proconfig, '{}'::text[]) @>
      array['search_path=""']
   from pg_proc where oid =
    'private.spmsq_assessment_snapshot_response(uuid,uuid,uuid,text,text)'::regprocedure)
  and not has_function_privilege('public',
    'private.mutate_spmsq_assessment_guarded(text,uuid,uuid,uuid,uuid,uuid,integer,date,jsonb,jsonb,jsonb,text,uuid)',
    'execute'),
  'private cores are pinned SECURITY DEFINER without PUBLIC execute'
);

select ok(
  position('pg_advisory_xact_lock' in pg_get_functiondef(
    'private.mutate_spmsq_assessment_guarded(text,uuid,uuid,uuid,uuid,uuid,integer,date,jsonb,jsonb,jsonb,text,uuid)'::regprocedure)) > 0
  and position('authority expired' in pg_get_functiondef(
    'private.mutate_spmsq_assessment_guarded(text,uuid,uuid,uuid,uuid,uuid,integer,date,jsonb,jsonb,jsonb,text,uuid)'::regprocedure)) > 0
  and position('v_after is distinct from v_bundle' in pg_get_functiondef(
    'private.spmsq_assessment_snapshot_response(uuid,uuid,uuid,text,text)'::regprocedure)) > 0,
  'writes serialize and reads and writes recheck authority'
);

select is(
  (select count(*) from pg_trigger where not tgisinternal and tgname in (
    'spmsq_assessment_versions_append_only',
    'spmsq_assessment_operations_append_only'
  )), 2::bigint,
  'candidate versions and operation receipts are append-only'
);

select is(
  (select count(*) from pg_trigger where not tgisinternal and tgname in (
    'spmsq_assessment_versions_audit_row_change',
    'spmsq_assessment_operations_audit_row_change'
  )), 2::bigint,
  'both committed streams have exact audit triggers'
);

select is(
  (select count(*) from information_schema.columns
   where table_schema = 'public' and table_name = 'spmsq_assessment_versions'
     and column_name in (
       'official_score', 'diagnosis', 'signed_at', 'signed_by',
       'care_decision', 'automatic_due_on'
     )), 0::bigint,
  'candidate storage has no official score diagnosis signature or decision columns'
);

select ok(
  private.spmsq_candidate_rule_snapshot() @> '{
    "activation_status":"candidate_unactivated",
    "formal_use_permitted":false,
    "missing_policy":"no_preview_and_never_zero",
    "not_applicable_policy":"no_preview_and_never_zero",
    "cultural_adjustment":{"status":"not_configured","numeric_effect":0}
  }'::jsonb,
  'candidate rule snapshot records every fail-closed governance boundary'
);

select ok(
  jsonb_array_length(
    private.spmsq_candidate_rule_snapshot() -> 'item_ids'
  ) = 10
  and (select count(distinct item_id) from jsonb_array_elements_text(
    private.spmsq_candidate_rule_snapshot() -> 'item_ids'
  ) item_id) = 10,
  'candidate snapshot fixes ten unique ordered answer slots'
);

select ok(
  private.spmsq_education_context_is_valid(
    '{"state":"not_applicable","reason":"合成測試教育脈絡不適用"}'::jsonb
  ) and private.spmsq_cultural_context_is_valid(
    '{"state":"recorded","note":"合成測試文化與語言脈絡"}'::jsonb
  ),
  'education and cultural context preserve explicit nonnumeric states'
);

create temporary table spmsq_payloads (
  payload_key text primary key,
  answers jsonb not null,
  education_context jsonb not null,
  cultural_context jsonb not null
);

insert into spmsq_payloads values
  ('complete', '{
    "spmsq_01":{"state":"answered","value":"incorrect"},
    "spmsq_02":{"state":"answered","value":"correct"},
    "spmsq_03":{"state":"answered","value":"incorrect"},
    "spmsq_04":{"state":"answered","value":"correct"},
    "spmsq_05":{"state":"answered","value":"correct"},
    "spmsq_06":{"state":"answered","value":"incorrect"},
    "spmsq_07":{"state":"answered","value":"correct"},
    "spmsq_08":{"state":"answered","value":"correct"},
    "spmsq_09":{"state":"answered","value":"correct"},
    "spmsq_10":{"state":"answered","value":"correct"}
  }'::jsonb, '{"state":"answered","value":"middle_or_high_school"}',
  '{"state":"recorded","note":"合成測試文化脈絡第一版"}'),
  ('revised', '{
    "spmsq_01":{"state":"answered","value":"incorrect"},
    "spmsq_02":{"state":"answered","value":"incorrect"},
    "spmsq_03":{"state":"answered","value":"incorrect"},
    "spmsq_04":{"state":"answered","value":"incorrect"},
    "spmsq_05":{"state":"answered","value":"correct"},
    "spmsq_06":{"state":"answered","value":"correct"},
    "spmsq_07":{"state":"answered","value":"correct"},
    "spmsq_08":{"state":"answered","value":"correct"},
    "spmsq_09":{"state":"answered","value":"correct"},
    "spmsq_10":{"state":"answered","value":"correct"}
  }'::jsonb, '{"state":"answered","value":"beyond_high_school"}',
  '{"state":"recorded","note":"合成測試文化脈絡第二版"}'),
  ('missing', '{
    "spmsq_01":{"state":"missing"},
    "spmsq_02":{"state":"answered","value":"correct"},
    "spmsq_03":{"state":"answered","value":"correct"},
    "spmsq_04":{"state":"answered","value":"correct"},
    "spmsq_05":{"state":"answered","value":"correct"},
    "spmsq_06":{"state":"answered","value":"correct"},
    "spmsq_07":{"state":"answered","value":"correct"},
    "spmsq_08":{"state":"answered","value":"correct"},
    "spmsq_09":{"state":"answered","value":"correct"},
    "spmsq_10":{"state":"answered","value":"correct"}
  }'::jsonb, '{"state":"answered","value":"middle_or_high_school"}',
  '{"state":"missing"}'),
  ('not_applicable', '{
    "spmsq_01":{"state":"not_applicable","reason":"合成測試不適用理由"},
    "spmsq_02":{"state":"answered","value":"correct"},
    "spmsq_03":{"state":"answered","value":"correct"},
    "spmsq_04":{"state":"answered","value":"correct"},
    "spmsq_05":{"state":"answered","value":"correct"},
    "spmsq_06":{"state":"answered","value":"correct"},
    "spmsq_07":{"state":"answered","value":"correct"},
    "spmsq_08":{"state":"answered","value":"correct"},
    "spmsq_09":{"state":"answered","value":"correct"},
    "spmsq_10":{"state":"answered","value":"correct"}
  }'::jsonb, '{"state":"answered","value":"middle_or_high_school"}',
  '{"state":"not_applicable","reason":"合成測試文化脈絡不適用"}');

select ok(private.spmsq_answers_are_valid(
  (select answers from spmsq_payloads where payload_key = 'complete')),
  'ten exact answered slots are valid'
);

select ok(private.spmsq_answers_are_valid(
  (select answers from spmsq_payloads where payload_key = 'missing')),
  'an explicit missing answer is valid data'
);

select ok(private.spmsq_answers_are_valid(
  (select answers from spmsq_payloads where payload_key = 'not_applicable')),
  'an explicit not-applicable answer with reason is valid data'
);

select ok(not private.spmsq_answers_are_valid(
  (select answers - 'spmsq_10' from spmsq_payloads where payload_key = 'complete')),
  'nine answers fail closed'
);

select ok(not private.spmsq_answers_are_valid(
  (select answers || '{"clinical_score":9}'::jsonb
   from spmsq_payloads where payload_key = 'complete')),
  'an invented answer or score key fails closed'
);

select ok(not private.spmsq_answers_are_valid(
  (select jsonb_set(answers, '{spmsq_01}',
    '{"state":"not_applicable","reason":""}'::jsonb)
   from spmsq_payloads where payload_key = 'complete')),
  'not-applicable without a reason fails closed'
);

select is(
  private.spmsq_trial_preview(
    (select answers from spmsq_payloads where payload_key = 'complete'),
    '{"state":"answered","value":"grade_school_or_less"}'::jsonb
  ) ->> 'adjusted_errors', '2',
  'grade-school context deterministically adjusts three errors to two'
);

select is(
  private.spmsq_trial_preview(
    (select answers from spmsq_payloads where payload_key = 'complete'),
    '{"state":"answered","value":"middle_or_high_school"}'::jsonb
  ) ->> 'adjusted_errors', '3',
  'middle-or-high-school context keeps three errors'
);

select is(
  private.spmsq_trial_preview(
    (select answers from spmsq_payloads where payload_key = 'complete'),
    '{"state":"answered","value":"beyond_high_school"}'::jsonb
  ) ->> 'adjusted_errors', '4',
  'beyond-high-school context deterministically adjusts three errors to four'
);

select ok(
  private.spmsq_trial_preview(
    (select answers from spmsq_payloads where payload_key = 'missing'),
    (select education_context from spmsq_payloads where payload_key = 'missing')
  ) @> '{"status":"incomplete","raw_errors":null,"adjusted_errors":null,"band_key":null}'::jsonb,
  'missing is never counted as zero and produces no preview number'
);

select ok(
  private.spmsq_trial_preview(
    (select answers from spmsq_payloads where payload_key = 'not_applicable'),
    (select education_context from spmsq_payloads where payload_key = 'not_applicable')
  ) @> '{"status":"incomplete","raw_errors":null,"adjusted_errors":null,"band_key":null}'::jsonb,
  'not applicable is never counted as zero and produces no preview number'
);

insert into auth.users (id, aud, role, email, created_at, updated_at) values
  ('11001100-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'spmsq-professional@example.invalid', now(), now());

insert into public.organizations (id, code, name) values
  ('11101100-0000-4000-8000-000000000001', 'spmsq_page11', 'SPMSQ 合成測試機構');

insert into public.branches (id, organization_id, code, name) values
  ('11201100-0000-4000-8000-000000000001', '11101100-0000-4000-8000-000000000001', 'main', '合成主分支'),
  ('11201100-0000-4000-8000-000000000002', '11101100-0000-4000-8000-000000000001', 'other', '合成其他分支');

insert into public.profiles (id, display_name, kind) values
  ('11001100-0000-4000-8000-000000000001', '合成 SPMSQ 評估人員', 'professional');

insert into public.memberships (
  id, organization_id, branch_id, profile_id, status
) values (
  '11301100-0000-4000-8000-000000000001',
  '11101100-0000-4000-8000-000000000001',
  '11201100-0000-4000-8000-000000000001',
  '11001100-0000-4000-8000-000000000001', 'active'
);

insert into public.membership_roles (membership_id, role_id) values
  ('11301100-0000-4000-8000-000000000001',
   '10000000-0000-4000-8000-000000000007');

insert into public.clients (
  id, organization_id, branch_id, client_code, display_name, status,
  admitted_on, ended_on
) values
  ('11401100-0000-4000-8000-000000000001', '11101100-0000-4000-8000-000000000001', '11201100-0000-4000-8000-000000000001', 'SPMSQ-1', '合成指派個案甲', 'active', current_date - 100, null),
  ('11401100-0000-4000-8000-000000000002', '11101100-0000-4000-8000-000000000001', '11201100-0000-4000-8000-000000000001', 'SPMSQ-2', '合成指派個案乙', 'suspended', current_date - 80, null),
  ('11401100-0000-4000-8000-000000000003', '11101100-0000-4000-8000-000000000001', '11201100-0000-4000-8000-000000000001', 'SPMSQ-3', '合成未指派個案', 'active', current_date - 60, null),
  ('11401100-0000-4000-8000-000000000004', '11101100-0000-4000-8000-000000000001', '11201100-0000-4000-8000-000000000002', 'SPMSQ-4', '合成其他分支個案', 'active', current_date - 40, null);

insert into public.client_assignments (
  id, organization_id, branch_id, client_id, assignee_user_id,
  assignment_kind
) values
  ('11501100-0000-4000-8000-000000000001', '11101100-0000-4000-8000-000000000001', '11201100-0000-4000-8000-000000000001', '11401100-0000-4000-8000-000000000001', '11001100-0000-4000-8000-000000000001', 'spmsq-assessment'),
  ('11501100-0000-4000-8000-000000000002', '11101100-0000-4000-8000-000000000001', '11201100-0000-4000-8000-000000000001', '11401100-0000-4000-8000-000000000002', '11001100-0000-4000-8000-000000000001', 'spmsq-assessment');

insert into private.reauth_challenges (
  id, user_id, session_id, nonce_sha256, idempotency_key,
  issued_jwt_iat, created_at, expires_at, consumed_at, consumed_jwt_iat,
  factor_method, factor_verified_at
) values (
  '11601100-0000-4000-8000-000000000001',
  '11001100-0000-4000-8000-000000000001',
  '11611100-0000-4000-8000-000000000001', repeat('1', 64),
  '11621100-0000-4000-8000-000000000001',
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
  '11001100-0000-4000-8000-000000000001',
  '11611100-0000-4000-8000-000000000001',
  '11601100-0000-4000-8000-000000000001', 'aal2', 'totp',
  (select factor_verified_at from private.reauth_challenges
   where id = '11601100-0000-4000-8000-000000000001')
);

create temporary table spmsq_create_result as
select null::uuid operation_id, null::uuid client_id,
  null::uuid assessment_key, null::uuid version_id,
  0::integer assessment_version, null::text record_state,
  current_date assessed_on, null::uuid author_user_id,
  null::text service_status_at_assessment, null::text rule_version_id,
  null::text governance_status, null::text preview_status,
  null::integer preview_raw_errors, null::integer preview_adjusted_errors,
  null::text preview_band_key, clock_timestamp() committed_at,
  false replayed with no data;
create temporary table spmsq_revise_result (like spmsq_create_result);

grant select on spmsq_payloads to authenticated;
grant select, insert on spmsq_create_result, spmsq_revise_result
  to authenticated;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"11001100-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1","session_id":"11611100-0000-4000-8000-000000000001"}', true);

select throws_ok($$select * from public.spmsq_assessment_snapshot(
  '11101100-0000-4000-8000-000000000001',
  '11201100-0000-4000-8000-000000000001')$$,
  '42501', 'SPMSQ assessment snapshot is not permitted',
  'reads reject an insufficient assurance level'
);

select set_config('request.jwt.claims',
  '{"sub":"11001100-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"11611100-0000-4000-8000-000000000099"}', true);

select throws_ok($$select * from public.spmsq_assessment_snapshot(
  '11101100-0000-4000-8000-000000000001',
  '11201100-0000-4000-8000-000000000002')$$,
  '42501', 'SPMSQ assessment snapshot is not permitted',
  'branch-scoped professional cannot read another branch'
);

select throws_ok($$select * from public.create_spmsq_assessment_draft(
  '11101100-0000-4000-8000-000000000001',
  '11201100-0000-4000-8000-000000000001',
  '11401100-0000-4000-8000-000000000003', current_date,
  (select answers from spmsq_payloads where payload_key = 'complete'),
  (select education_context from spmsq_payloads where payload_key = 'complete'),
  (select cultural_context from spmsq_payloads where payload_key = 'complete'),
  'spmsq-pfeiffer-10-education-adjusted-v1',
  '11701100-0000-4000-8000-000000000001')$$,
  '42501', 'SPMSQ candidate assessment operation is not permitted',
  'an unassigned client fails closed'
);

select throws_ok($$select * from public.create_spmsq_assessment_draft(
  '11101100-0000-4000-8000-000000000001',
  '11201100-0000-4000-8000-000000000001',
  '11401100-0000-4000-8000-000000000001', current_date,
  (select answers from spmsq_payloads where payload_key = 'complete'),
  (select education_context from spmsq_payloads where payload_key = 'complete'),
  (select cultural_context from spmsq_payloads where payload_key = 'complete'),
  'spmsq-pfeiffer-10-education-adjusted-v1',
  '11701100-0000-4000-8000-000000000002')$$,
  '42501', 'current same-session recent AAL2 evidence is required for SPMSQ draft writes',
  'AAL2 without same-session recent evidence cannot write'
);

select set_config('request.jwt.claims',
  '{"sub":"11001100-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"11611100-0000-4000-8000-000000000001"}', true);

insert into spmsq_create_result
select * from public.create_spmsq_assessment_draft(
  '11101100-0000-4000-8000-000000000001',
  '11201100-0000-4000-8000-000000000001',
  '11401100-0000-4000-8000-000000000001', current_date - 3,
  (select answers from spmsq_payloads where payload_key = 'complete'),
  (select education_context from spmsq_payloads where payload_key = 'complete'),
  (select cultural_context from spmsq_payloads where payload_key = 'complete'),
  'spmsq-pfeiffer-10-education-adjusted-v1',
  '11701100-0000-4000-8000-000000000010');

select ok(
  (select not replayed
      and client_id = '11401100-0000-4000-8000-000000000001'
      and assessment_version = 1 and record_state = 'draft_preview'
      and author_user_id = '11001100-0000-4000-8000-000000000001'
      and service_status_at_assessment = 'active'
      and rule_version_id = 'spmsq-pfeiffer-10-education-adjusted-v1'
      and governance_status = 'candidate_unactivated'
      and preview_status = 'candidate_complete'
      and preview_raw_errors = 3 and preview_adjusted_errors = 3
      and preview_band_key = 'mild_3_4_errors'
      and operation_id is not null and assessment_key is not null
      and version_id is not null
   from spmsq_create_result),
  'create returns a complete candidate-only receipt'
);

reset role;

select ok(
  (select answers =
        (select answers from spmsq_payloads where payload_key = 'complete')
      and education_context =
        (select education_context from spmsq_payloads where payload_key = 'complete')
      and cultural_context =
        (select cultural_context from spmsq_payloads where payload_key = 'complete')
      and write_reauth_challenge_id =
        '11601100-0000-4000-8000-000000000001'
   from public.spmsq_assessment_versions
   where id = (select version_id from spmsq_create_result)),
  'draft preserves all explicit states and same-session AAL2 evidence'
);

select ok(
  (select rule_snapshot = private.spmsq_candidate_rule_snapshot()
      and rule_snapshot_hash = encode(
        sha256(convert_to(rule_snapshot::text, 'UTF8')), 'hex'
      ) and governance_status = 'candidate_unactivated'
   from public.spmsq_assessment_versions
   where id = (select version_id from spmsq_create_result)),
  'stored rule snapshot and hash reproduce the unactivated candidate rule'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"11001100-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"11611100-0000-4000-8000-000000000001"}', true);

select ok(
  (select replayed
      and assessment_key = (select assessment_key from spmsq_create_result)
      and version_id = (select version_id from spmsq_create_result)
   from public.create_spmsq_assessment_draft(
    '11101100-0000-4000-8000-000000000001',
    '11201100-0000-4000-8000-000000000001',
    '11401100-0000-4000-8000-000000000001', current_date - 3,
    (select answers from spmsq_payloads where payload_key = 'complete'),
    (select education_context from spmsq_payloads where payload_key = 'complete'),
    (select cultural_context from spmsq_payloads where payload_key = 'complete'),
    'spmsq-pfeiffer-10-education-adjusted-v1',
    '11701100-0000-4000-8000-000000000010')),
  'exact replay returns the original committed version'
);

select throws_ok($$select * from public.create_spmsq_assessment_draft(
  '11101100-0000-4000-8000-000000000001',
  '11201100-0000-4000-8000-000000000001',
  '11401100-0000-4000-8000-000000000001', current_date - 3,
  (select answers from spmsq_payloads where payload_key = 'revised'),
  (select education_context from spmsq_payloads where payload_key = 'revised'),
  (select cultural_context from spmsq_payloads where payload_key = 'revised'),
  'spmsq-pfeiffer-10-education-adjusted-v1',
  '11701100-0000-4000-8000-000000000010')$$,
  '23505', 'SPMSQ assessment idempotency conflict',
  'changed content conflicts on the same actor idempotency key'
);

select throws_ok($$select * from public.create_spmsq_assessment_draft(
  '11101100-0000-4000-8000-000000000001',
  '11201100-0000-4000-8000-000000000001',
  '11401100-0000-4000-8000-000000000001', current_date + 1,
  (select answers from spmsq_payloads where payload_key = 'complete'),
  (select education_context from spmsq_payloads where payload_key = 'complete'),
  (select cultural_context from spmsq_payloads where payload_key = 'complete'),
  'spmsq-pfeiffer-10-education-adjusted-v1',
  '11701100-0000-4000-8000-000000000011')$$,
  '22023', 'SPMSQ candidate assessment payload is invalid',
  'future assessment date fails closed'
);

insert into spmsq_revise_result
select * from public.revise_spmsq_assessment_draft(
  '11101100-0000-4000-8000-000000000001',
  '11201100-0000-4000-8000-000000000001',
  '11401100-0000-4000-8000-000000000001',
  (select assessment_key from spmsq_create_result),
  (select version_id from spmsq_create_result), 1, current_date - 2,
  (select answers from spmsq_payloads where payload_key = 'revised'),
  (select education_context from spmsq_payloads where payload_key = 'revised'),
  (select cultural_context from spmsq_payloads where payload_key = 'revised'),
  'spmsq-pfeiffer-10-education-adjusted-v1',
  '11701100-0000-4000-8000-000000000012');

select ok(
  (select not replayed and assessment_version = 2
      and record_state = 'draft_preview'
      and assessment_key = (select assessment_key from spmsq_create_result)
      and preview_raw_errors = 4 and preview_adjusted_errors = 5
      and preview_band_key = 'moderate_5_7_errors'
   from spmsq_revise_result),
  'revision appends version two with a reproducible candidate preview'
);

select throws_ok($$select * from public.revise_spmsq_assessment_draft(
  '11101100-0000-4000-8000-000000000001',
  '11201100-0000-4000-8000-000000000001',
  '11401100-0000-4000-8000-000000000001',
  (select assessment_key from spmsq_create_result),
  (select version_id from spmsq_create_result), 1, current_date - 2,
  (select answers from spmsq_payloads where payload_key = 'revised'),
  (select education_context from spmsq_payloads where payload_key = 'revised'),
  (select cultural_context from spmsq_payloads where payload_key = 'revised'),
  'spmsq-pfeiffer-10-education-adjusted-v1',
  '11701100-0000-4000-8000-000000000013')$$,
  '40001', 'SPMSQ candidate assessment version is stale',
  'stale expected version cannot fork the chain'
);

reset role;

select ok(
  (select count(*) = 2
      and min(version) = 1 and max(version) = 2
      and count(*) filter (where previous_version_id is null) = 1
      and count(*) filter (where previous_version_id =
        (select version_id from spmsq_create_result)) = 1
   from public.spmsq_assessment_versions
   where assessment_key = (select assessment_key from spmsq_create_result)),
  'the candidate history is one linear two-version chain'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"11001100-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"11611100-0000-4000-8000-000000000001"}', true);

select throws_ok($$select * from public.sign_spmsq_assessment(
  '11101100-0000-4000-8000-000000000001',
  '11201100-0000-4000-8000-000000000001',
  '11401100-0000-4000-8000-000000000001',
  (select assessment_key from spmsq_revise_result),
  (select version_id from spmsq_revise_result), 2,
  '11701100-0000-4000-8000-000000000014')$$,
  '55000', 'SPMSQ candidate rule is not activated; formal signing is blocked',
  'formal signing is fail-closed while the candidate rule is unactivated'
);

reset role;

select is(
  (select count(*) from public.spmsq_assessment_versions
   where assessment_key = (select assessment_key from spmsq_create_result)),
  2::bigint,
  'blocked signing creates no formal or additional version'
);

select throws_ok(
  format('update public.spmsq_assessment_versions set assessed_on = current_date where id = %L',
    (select version_id from spmsq_revise_result)),
  '55000', 'SPMSQ candidate assessment history is append-only',
  'a committed version cannot be updated'
);

select throws_ok(
  format('delete from public.spmsq_assessment_versions where id = %L',
    (select version_id from spmsq_revise_result)),
  '55000', 'SPMSQ candidate assessment history is append-only',
  'a committed version cannot be deleted'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"11001100-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"11611100-0000-4000-8000-000000000001"}', true);

select ok(
  (select matching_total = 2 and item_total = 2
      and not_assessed_total = 1 and candidate_complete_total = 1
      and incomplete_total = 0 and draft_total = 1
      and not items_truncated and not client_options_truncated
      and rule_activation_status = 'candidate_unactivated'
      and formal_sign_status = 'blocked_rule_not_activated'
      and formal_score_status = 'not_available'
      and care_decision_status = 'blocked'
      and cultural_adjustment_status = 'not_configured_context_only'
      and attachment_status = 'not_configured'
      and export_status = 'not_configured'
      and offline_sync_status = 'not_configured'
   from public.spmsq_assessment_snapshot(
    '11101100-0000-4000-8000-000000000001',
    '11201100-0000-4000-8000-000000000001')),
  'snapshot reports full-set metrics and every unavailable boundary'
);

select ok(
  (select (items -> 0 ->> 'client_id')::uuid in (
        '11401100-0000-4000-8000-000000000001',
        '11401100-0000-4000-8000-000000000002'
      ) and exists (
        select 1 from jsonb_array_elements(items) item
        where item ->> 'client_id' =
          '11401100-0000-4000-8000-000000000001'
          and (item ->> 'assessment_version')::integer = 2
          and jsonb_array_length(item -> 'version_history') = 2
          and item -> 'version_history' -> 0 ->> 'version_id' =
            (select version_id::text from spmsq_revise_result)
      )
   from public.spmsq_assessment_snapshot(
    '11101100-0000-4000-8000-000000000001',
    '11201100-0000-4000-8000-000000000001')),
  'snapshot returns the terminal version and complete ordered chain'
);

select ok(
  (select matching_total = 1 and item_total = 1
      and not_assessed_total = 1 and draft_total = 0
      and items -> 0 ->> 'client_id' =
        '11401100-0000-4000-8000-000000000002'
   from public.spmsq_assessment_snapshot(
    '11101100-0000-4000-8000-000000000001',
    '11201100-0000-4000-8000-000000000001', null,
    'not_assessed', 'all')),
  'not-assessed filter remains distinct from an incomplete assessment'
);

select ok(
  (select matching_total = 1 and item_total = 1
      and items -> 0 ->> 'client_id' =
        '11401100-0000-4000-8000-000000000001'
   from public.spmsq_assessment_snapshot(
    '11101100-0000-4000-8000-000000000001',
    '11201100-0000-4000-8000-000000000001',
    '11401100-0000-4000-8000-000000000001',
    'candidate_complete', 'answered')),
  'exact-client preview and education filters compose without scope widening'
);

reset role;

select ok(
  exists (
    select 1 from public.audit_events event
    where event.table_name in (
      'spmsq_assessment_versions',
      'public.spmsq_assessment_versions'
    ) and event.organization_id =
      '11101100-0000-4000-8000-000000000001'
  ) and not exists (
    select 1 from public.audit_events event
    where event.organization_id =
      '11101100-0000-4000-8000-000000000001'
      and (coalesce(event.metadata::text, '') || ' ' ||
        coalesce(event.row_pk, '') || ' ' ||
        coalesce(array_to_string(event.changed_fields, ','), '')) ~
        '合成測試文化脈絡|"incorrect"|spmsq_01.*value'
  ),
  'audit records actions without answer or cultural narrative values'
);

select ok(
  exists (
    select 1 from public.audit_events event
    where event.table_name = 'spmsq_assessment_versions'
      and event.action = 'select'
      and event.metadata @> '{
        "answers_logged":false,
        "personal_data_logged":false,
        "filter_values_logged":false,
        "formal_score_returned":false
      }'::jsonb
  ),
  'view and search audit explicitly excludes answers PII filters and formal score'
);

select ok(
  (select condef ~ 'UNIQUE \(actor_user_id, idempotency_key\)'
   from (
     select pg_get_constraintdef(oid) as condef
     from pg_constraint
     where conname = 'spmsq_assessment_operations_actor_key'
   ) constraint_row),
  'idempotency is scoped to the acting user'
);

select is(
  (select count(*) from public.spmsq_assessment_versions
   where record_state <> 'draft_preview'
      or governance_status <> 'candidate_unactivated'),
  0::bigint,
  'page 11 creates no signed official or activated records'
);

select * from finish();
rollback;
