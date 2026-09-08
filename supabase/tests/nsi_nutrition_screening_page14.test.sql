begin;

-- Screening dates are Taiwan business dates.  Keep current_date fixtures on
-- the same Asia/Taipei boundary as the production future-date guard.
set local time zone 'Asia/Taipei';

select plan(52);

select is(
  (select count(*) from public.permissions where permission_key in (
    'nsi_nutrition_screenings.read', 'nsi_nutrition_screenings.manage',
    'nsi_nutrition_screenings.sign'
  )),
  3::bigint,
  'page 14 publishes separate read manage and sign permissions'
);

select ok(
  exists (
    select 1 from public.role_permissions role_permission
    join public.roles role on role.id = role_permission.role_id
    join public.permissions permission
      on permission.id = role_permission.permission_id
    where role.role_key = 'professional'
      and permission.permission_key = 'nsi_nutrition_screenings.manage'
  ) and exists (
    select 1 from public.role_permissions role_permission
    join public.roles role on role.id = role_permission.role_id
    join public.permissions permission
      on permission.id = role_permission.permission_id
    where role.role_key = 'case_manager_social_worker'
      and permission.permission_key = 'nsi_nutrition_screenings.read'
  ),
  'approved staff templates receive governed manual nutrition observation permissions'
);

select ok(
  (select bool_and(relrowsecurity and relforcerowsecurity)
   from pg_class where oid in (
    'public.nsi_nutrition_screening_versions'::regclass,
    'private.nsi_nutrition_screening_operations'::regclass
  )),
  'candidate versions and operation receipts force RLS'
);

select ok(
  not has_table_privilege('authenticated',
    'public.nsi_nutrition_screening_versions', 'select,insert,update,delete')
  and not has_table_privilege('service_role',
    'public.nsi_nutrition_screening_versions', 'select,insert,update,delete')
  and not has_table_privilege('authenticated',
    'private.nsi_nutrition_screening_operations', 'select,insert,update,delete')
  and not has_table_privilege('service_role',
    'private.nsi_nutrition_screening_operations', 'select,insert,update,delete'),
  'browser and service roles receive no direct table privileges'
);

select ok(
  has_function_privilege('authenticated',
    'public.create_nsi_nutrition_screening_draft(uuid,uuid,uuid,date,jsonb,text,uuid)',
    'execute')
  and has_function_privilege('authenticated',
    'public.revise_nsi_nutrition_screening_draft(uuid,uuid,uuid,uuid,uuid,integer,date,jsonb,text,uuid)',
    'execute')
  and has_function_privilege('authenticated',
    'public.sign_nsi_nutrition_screening(uuid,uuid,uuid,uuid,uuid,integer,uuid)',
    'execute')
  and has_function_privilege('authenticated',
    'public.nsi_nutrition_screening_snapshot(uuid,uuid,uuid,text,text)', 'execute')
  and not has_function_privilege('service_role',
    'public.sign_nsi_nutrition_screening(uuid,uuid,uuid,uuid,uuid,integer,uuid)',
    'execute'),
  'authenticated callers receive only exact public RPC signatures'
);

select ok(
  not (select prosecdef from pg_proc where oid =
    'public.create_nsi_nutrition_screening_draft(uuid,uuid,uuid,date,jsonb,text,uuid)'::regprocedure)
  and not (select prosecdef from pg_proc where oid =
    'public.nsi_nutrition_screening_snapshot(uuid,uuid,uuid,text,text)'::regprocedure),
  'public wrappers remain SECURITY INVOKER'
);

select ok(
  (select prosecdef and coalesce(proconfig, '{}'::text[]) @>
      array['search_path=""']
   from pg_proc where oid =
    'private.mutate_nsi_nutrition_screening_guarded(text,uuid,uuid,uuid,uuid,uuid,integer,date,jsonb,text,uuid)'::regprocedure)
  and (select prosecdef and coalesce(proconfig, '{}'::text[]) @>
      array['search_path=""']
   from pg_proc where oid =
    'private.nsi_nutrition_screening_snapshot_response(uuid,uuid,uuid,text,text)'::regprocedure)
  and not has_function_privilege('public',
    'private.mutate_nsi_nutrition_screening_guarded(text,uuid,uuid,uuid,uuid,uuid,integer,date,jsonb,text,uuid)',
    'execute'),
  'private cores are pinned SECURITY DEFINER without PUBLIC execute'
);

select ok(
  position('pg_advisory_xact_lock' in pg_get_functiondef(
    'private.mutate_nsi_nutrition_screening_guarded(text,uuid,uuid,uuid,uuid,uuid,integer,date,jsonb,text,uuid)'::regprocedure)) > 0
  and position('authority expired' in pg_get_functiondef(
    'private.mutate_nsi_nutrition_screening_guarded(text,uuid,uuid,uuid,uuid,uuid,integer,date,jsonb,text,uuid)'::regprocedure)) > 0
  and position('v_after is distinct from v_bundle' in pg_get_functiondef(
    'private.nsi_nutrition_screening_snapshot_response(uuid,uuid,uuid,text,text)'::regprocedure)) > 0,
  'writes serialize and reads and writes recheck authority'
);

select is(
  (select count(*) from pg_trigger where not tgisinternal and tgname in (
    'nsi_nutrition_screening_versions_append_only',
    'nsi_nutrition_screening_operations_append_only'
  )), 2::bigint,
  'candidate versions and operation receipts are append-only'
);

select is(
  (select count(*) from pg_trigger where not tgisinternal and tgname in (
    'nsi_nutrition_screening_versions_audit_row_change',
    'nsi_nutrition_screening_operations_audit_row_change'
  )), 2::bigint,
  'both committed streams have exact audit triggers'
);

select is(
  (select count(*) from information_schema.columns
   where table_schema = 'public' and table_name = 'nsi_nutrition_screening_versions'
     and column_name in (
       'official_score', 'formal_risk', 'diagnosis', 'signed_at',
       'signed_by', 'care_decision', 'automatic_due_on'
     )), 0::bigint,
  'candidate storage has no formal score risk diagnosis signature or decision'
);

select ok(
  private.nsi_nutrition_candidate_rule_snapshot() @> '{
    "version_id":"nsi-manual-nutrition-observations-candidate-v1",
    "instrument":"manual_unstandardized_nutrition_observations",
    "activation_status":"candidate_unactivated",
    "formal_use_permitted":false,
    "governance_review_required":true,
    "completeness_policy":"all_fields_answered_for_non_clinical_count",
    "present_count_policy":"count_present_only_when_complete_non_clinical",
    "missing_policy":"no_count_and_never_zero",
    "not_applicable_policy":"no_count_and_never_zero",
    "formal_questionnaire_status":"not_configured",
    "licensed_source_status":"not_configured",
    "formal_weights_status":"not_configured",
    "formal_scoring_status":"not_configured",
    "formal_risk_classification_status":"not_configured"
  }'::jsonb,
  'candidate snapshot records fail-closed governance boundaries'
);

select ok(
  jsonb_array_length(private.nsi_nutrition_candidate_rule_snapshot() -> 'field_ids') = 6
  and (select count(distinct item_id) from jsonb_array_elements_text(
    private.nsi_nutrition_candidate_rule_snapshot() -> 'field_ids'
  ) item_id) = 6,
  'candidate snapshot fixes six unique ordered manual fields'
);

select ok(
  jsonb_array_length(
    private.nsi_nutrition_candidate_rule_snapshot() -> 'field_definitions'
  ) = 6
  and private.nsi_nutrition_candidate_rule_snapshot() -> 'answer_values' =
    '["present","absent"]'::jsonb,
  'candidate snapshot pins six neutral manual definitions and explicit values'
);

create temporary table nsi_nutrition_payloads (
  payload_key text primary key,
  answers jsonb not null
);

insert into nsi_nutrition_payloads values
  ('zero', '{
    "nutrition_observation_01":{"state":"answered","value":"absent"},
    "nutrition_observation_02":{"state":"answered","value":"absent"},
    "nutrition_observation_03":{"state":"answered","value":"absent"},
    "nutrition_observation_04":{"state":"answered","value":"absent"},
    "nutrition_observation_05":{"state":"answered","value":"absent"},
    "nutrition_observation_06":{"state":"answered","value":"absent"}
  }'),
  ('two', '{
    "nutrition_observation_01":{"state":"answered","value":"present"},
    "nutrition_observation_02":{"state":"answered","value":"present"},
    "nutrition_observation_03":{"state":"answered","value":"absent"},
    "nutrition_observation_04":{"state":"answered","value":"absent"},
    "nutrition_observation_05":{"state":"answered","value":"absent"},
    "nutrition_observation_06":{"state":"answered","value":"absent"}
  }'),
  ('four', '{
    "nutrition_observation_01":{"state":"answered","value":"present"},
    "nutrition_observation_02":{"state":"answered","value":"present"},
    "nutrition_observation_03":{"state":"answered","value":"present"},
    "nutrition_observation_04":{"state":"answered","value":"present"},
    "nutrition_observation_05":{"state":"answered","value":"absent"},
    "nutrition_observation_06":{"state":"answered","value":"absent"}
  }'),
  ('five', '{
    "nutrition_observation_01":{"state":"answered","value":"present"},
    "nutrition_observation_02":{"state":"answered","value":"present"},
    "nutrition_observation_03":{"state":"answered","value":"present"},
    "nutrition_observation_04":{"state":"answered","value":"present"},
    "nutrition_observation_05":{"state":"answered","value":"present"},
    "nutrition_observation_06":{"state":"answered","value":"absent"}
  }'),
  ('six', '{
    "nutrition_observation_01":{"state":"answered","value":"present"},
    "nutrition_observation_02":{"state":"answered","value":"present"},
    "nutrition_observation_03":{"state":"answered","value":"present"},
    "nutrition_observation_04":{"state":"answered","value":"present"},
    "nutrition_observation_05":{"state":"answered","value":"present"},
    "nutrition_observation_06":{"state":"answered","value":"present"}
  }');

insert into nsi_nutrition_payloads (payload_key, answers)
select 'missing', jsonb_set(answers, '{nutrition_observation_01}', '{"state":"missing"}')
from nsi_nutrition_payloads where payload_key = 'four';
insert into nsi_nutrition_payloads (payload_key, answers)
select 'not_applicable', jsonb_set(
  answers, '{nutrition_observation_01}',
  '{"state":"not_applicable","reason":"合成測試本次無法確認"}'
)
from nsi_nutrition_payloads where payload_key = 'four';

select ok(private.nsi_nutrition_answers_are_valid(
  (select answers from nsi_nutrition_payloads where payload_key = 'four')),
  'six exact answered observation fields are valid'
);

select ok(private.nsi_nutrition_answers_are_valid(
  (select answers from nsi_nutrition_payloads where payload_key = 'missing')),
  'explicit missing is valid data'
);

select ok(private.nsi_nutrition_answers_are_valid(
  (select answers from nsi_nutrition_payloads where payload_key = 'not_applicable')),
  'explicit not-applicable with reason is valid data'
);

select ok(not private.nsi_nutrition_answers_are_valid(
  (select answers - 'nutrition_observation_06' from nsi_nutrition_payloads where payload_key = 'four')),
  'five-field payload fails closed'
);

select ok(not private.nsi_nutrition_answers_are_valid(
  (select answers || '{"clinical_score":9}'::jsonb
   from nsi_nutrition_payloads where payload_key = 'four')),
  'invented answer or score key fails closed'
);

select ok(not private.nsi_nutrition_answers_are_valid(
  (select jsonb_set(answers, '{nutrition_observation_01}',
    '{"state":"answered","value":"unknown"}'::jsonb)
   from nsi_nutrition_payloads where payload_key = 'four')),
  'unknown answer value fails closed'
);

select ok(not private.nsi_nutrition_answers_are_valid(
  (select jsonb_set(answers, '{nutrition_observation_01}',
    '{"state":"not_applicable","reason":""}'::jsonb)
   from nsi_nutrition_payloads where payload_key = 'four')),
  'not-applicable without reason fails closed'
);

select is(private.nsi_nutrition_trial_preview(
  (select answers from nsi_nutrition_payloads where payload_key = 'zero')
) ->> 'observed_count', '0', 'zero-observed vector is reproducible');

select ok(private.nsi_nutrition_trial_preview(
  (select answers from nsi_nutrition_payloads where payload_key = 'two')
) = '{"status":"candidate_complete","observed_count":2}'::jsonb,
  'two-observed vector is reproducible without a score or band');

select ok(private.nsi_nutrition_trial_preview(
  (select answers from nsi_nutrition_payloads where payload_key = 'four')
) = '{"status":"candidate_complete","observed_count":4}'::jsonb,
  'four-observed vector is reproducible without a score or band');

select ok(private.nsi_nutrition_trial_preview(
  (select answers from nsi_nutrition_payloads where payload_key = 'six')
) = '{"status":"candidate_complete","observed_count":6}'::jsonb,
  'six-observed vector is reproducible without becoming formal risk');

select ok(private.nsi_nutrition_trial_preview(
  (select answers from nsi_nutrition_payloads where payload_key = 'missing')
) = '{"status":"incomplete","observed_count":null}'::jsonb,
  'missing is never counted as zero and produces no number');

select ok(private.nsi_nutrition_trial_preview(
  (select answers from nsi_nutrition_payloads where payload_key = 'not_applicable')
) = '{"status":"incomplete","observed_count":null}'::jsonb,
  'not applicable remains distinct and produces no number');

insert into auth.users (id, aud, role, email, created_at, updated_at) values
  ('12001200-0000-4000-8000-000000000001', 'authenticated',
   'authenticated', 'nsi_nutrition-page14@example.invalid', now(), now());

insert into public.organizations (id, code, name) values
  ('12101200-0000-4000-8000-000000000001', 'nsi_nutrition_page14', '人工營養觀察合成測試機構');

insert into public.branches (id, organization_id, code, name) values
  ('12201200-0000-4000-8000-000000000001', '12101200-0000-4000-8000-000000000001', 'main', '合成主分支'),
  ('12201200-0000-4000-8000-000000000002', '12101200-0000-4000-8000-000000000001', 'other', '合成其他分支');

insert into public.profiles (id, display_name, kind) values
  ('12001200-0000-4000-8000-000000000001', '合成人工營養觀察人員', 'professional');

insert into public.memberships (
  id, organization_id, branch_id, profile_id, status
) values (
  '12301200-0000-4000-8000-000000000001',
  '12101200-0000-4000-8000-000000000001',
  '12201200-0000-4000-8000-000000000001',
  '12001200-0000-4000-8000-000000000001', 'active'
);

insert into public.membership_roles (membership_id, role_id) values
  ('12301200-0000-4000-8000-000000000001',
   '10000000-0000-4000-8000-000000000007');

insert into public.clients (
  id, organization_id, branch_id, client_code, display_name, status,
  admitted_on, ended_on
) values
  ('12401200-0000-4000-8000-000000000001', '12101200-0000-4000-8000-000000000001', '12201200-0000-4000-8000-000000000001', 'nutrition-1', '合成指派個案甲', 'active', current_date - 100, null),
  ('12401200-0000-4000-8000-000000000002', '12101200-0000-4000-8000-000000000001', '12201200-0000-4000-8000-000000000001', 'nutrition-2', '合成指派個案乙', 'suspended', current_date - 80, null),
  ('12401200-0000-4000-8000-000000000003', '12101200-0000-4000-8000-000000000001', '12201200-0000-4000-8000-000000000001', 'nutrition-3', '合成未指派個案', 'active', current_date - 60, null),
  ('12401200-0000-4000-8000-000000000004', '12101200-0000-4000-8000-000000000001', '12201200-0000-4000-8000-000000000002', 'nutrition-4', '合成其他分支個案', 'active', current_date - 40, null);

insert into public.client_assignments (
  id, organization_id, branch_id, client_id, assignee_user_id,
  assignment_kind
) values
  ('12501200-0000-4000-8000-000000000001', '12101200-0000-4000-8000-000000000001', '12201200-0000-4000-8000-000000000001', '12401200-0000-4000-8000-000000000001', '12001200-0000-4000-8000-000000000001', 'nsi-nutrition-screening'),
  ('12501200-0000-4000-8000-000000000002', '12101200-0000-4000-8000-000000000001', '12201200-0000-4000-8000-000000000001', '12401200-0000-4000-8000-000000000002', '12001200-0000-4000-8000-000000000001', 'nsi-nutrition-screening');

insert into private.reauth_challenges (
  id, user_id, session_id, nonce_sha256, idempotency_key,
  issued_jwt_iat, created_at, expires_at, consumed_at, consumed_jwt_iat,
  factor_method, factor_verified_at
) values (
  '12601200-0000-4000-8000-000000000001',
  '12001200-0000-4000-8000-000000000001',
  '12611200-0000-4000-8000-000000000001', repeat('2', 64),
  '12621200-0000-4000-8000-000000000001',
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
  '12001200-0000-4000-8000-000000000001',
  '12611200-0000-4000-8000-000000000001',
  '12601200-0000-4000-8000-000000000001', 'aal2', 'totp',
  (select factor_verified_at from private.reauth_challenges
   where id = '12601200-0000-4000-8000-000000000001')
);

create temporary table nsi_nutrition_create_result as
select null::uuid operation_id, null::uuid client_id,
  null::uuid assessment_key, null::uuid version_id,
  0::integer assessment_version, null::text record_state,
  current_date assessed_on, null::uuid author_user_id,
  null::text service_status_at_assessment, null::text rule_version_id,
  null::text governance_status, null::text preview_status,
  null::integer preview_observed_count,
  null::text content_hash,
  clock_timestamp() committed_at, false replayed with no data;
create temporary table nsi_nutrition_revise_result (like nsi_nutrition_create_result);

grant select on nsi_nutrition_payloads to authenticated;
grant select, insert on nsi_nutrition_create_result, nsi_nutrition_revise_result to authenticated;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"12001200-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1","session_id":"12611200-0000-4000-8000-000000000001"}', true);

select throws_ok($$select * from public.nsi_nutrition_screening_snapshot(
  '12101200-0000-4000-8000-000000000001',
  '12201200-0000-4000-8000-000000000001')$$,
  '42501', 'manual nutrition observation snapshot is not permitted',
  'reads reject insufficient assurance level'
);

select set_config('request.jwt.claims',
  '{"sub":"12001200-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"12611200-0000-4000-8000-000000000099"}', true);

select throws_ok($$select * from public.nsi_nutrition_screening_snapshot(
  '12101200-0000-4000-8000-000000000001',
  '12201200-0000-4000-8000-000000000002')$$,
  '42501', 'manual nutrition observation snapshot is not permitted',
  'branch-scoped professional cannot read another branch'
);

select throws_ok($$select * from public.create_nsi_nutrition_screening_draft(
  '12101200-0000-4000-8000-000000000001',
  '12201200-0000-4000-8000-000000000001',
  '12401200-0000-4000-8000-000000000003', current_date,
  (select answers from nsi_nutrition_payloads where payload_key = 'four'),
  'nsi-manual-nutrition-observations-candidate-v1',
  '12701200-0000-4000-8000-000000000001')$$,
  '42501', 'manual nutrition observation candidate operation is not permitted',
  'unassigned client fails closed'
);

select throws_ok($$select * from public.create_nsi_nutrition_screening_draft(
  '12101200-0000-4000-8000-000000000001',
  '12201200-0000-4000-8000-000000000001',
  '12401200-0000-4000-8000-000000000001', current_date,
  (select answers from nsi_nutrition_payloads where payload_key = 'four'),
  'nsi-manual-nutrition-observations-candidate-v1',
  '12701200-0000-4000-8000-000000000002')$$,
  '42501', 'current same-session recent AAL2 evidence is required for manual nutrition observation draft writes',
  'AAL2 without same-session recent evidence cannot write'
);

select set_config('request.jwt.claims',
  '{"sub":"12001200-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"12611200-0000-4000-8000-000000000001"}', true);

insert into nsi_nutrition_create_result
select * from public.create_nsi_nutrition_screening_draft(
  '12101200-0000-4000-8000-000000000001',
  '12201200-0000-4000-8000-000000000001',
  '12401200-0000-4000-8000-000000000001', current_date - 3,
  (select answers from nsi_nutrition_payloads where payload_key = 'four'),
  'nsi-manual-nutrition-observations-candidate-v1',
  '12701200-0000-4000-8000-000000000010');

select ok(
  (select not replayed
      and client_id = '12401200-0000-4000-8000-000000000001'
      and assessment_version = 1 and record_state = 'draft_preview'
      and author_user_id = '12001200-0000-4000-8000-000000000001'
      and service_status_at_assessment = 'active'
      and rule_version_id = 'nsi-manual-nutrition-observations-candidate-v1'
      and governance_status = 'candidate_unactivated'
      and preview_status = 'candidate_complete'
      and preview_observed_count = 4
      and content_hash ~ '^[a-f0-9]{64}$'
      and operation_id is not null and assessment_key is not null
      and version_id is not null
   from nsi_nutrition_create_result),
  'create returns a complete candidate-only receipt'
);

reset role;

select ok(
  (select answers =
        (select answers from nsi_nutrition_payloads where payload_key = 'four')
      and write_reauth_challenge_id =
        '12601200-0000-4000-8000-000000000001'
   from public.nsi_nutrition_screening_versions
   where id = (select version_id from nsi_nutrition_create_result)),
  'draft preserves explicit answers and same-session AAL2 evidence'
);

select ok(
  (select rule_snapshot = private.nsi_nutrition_candidate_rule_snapshot()
      and rule_snapshot_hash = encode(
        sha256(convert_to(rule_snapshot::text, 'UTF8')), 'hex'
      ) and governance_status = 'candidate_unactivated'
   from public.nsi_nutrition_screening_versions
   where id = (select version_id from nsi_nutrition_create_result)),
  'stored snapshot and hash reproduce the unactivated candidate rule'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"12001200-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"12611200-0000-4000-8000-000000000001"}', true);

select ok(
  (select replayed
      and assessment_key = (select assessment_key from nsi_nutrition_create_result)
      and version_id = (select version_id from nsi_nutrition_create_result)
   from public.create_nsi_nutrition_screening_draft(
    '12101200-0000-4000-8000-000000000001',
    '12201200-0000-4000-8000-000000000001',
    '12401200-0000-4000-8000-000000000001', current_date - 3,
    (select answers from nsi_nutrition_payloads where payload_key = 'four'),
    'nsi-manual-nutrition-observations-candidate-v1',
    '12701200-0000-4000-8000-000000000010')),
  'exact replay returns the original committed version'
);

select throws_ok($$select * from public.create_nsi_nutrition_screening_draft(
  '12101200-0000-4000-8000-000000000001',
  '12201200-0000-4000-8000-000000000001',
  '12401200-0000-4000-8000-000000000001', current_date - 3,
  (select answers from nsi_nutrition_payloads where payload_key = 'five'),
  'nsi-manual-nutrition-observations-candidate-v1',
  '12701200-0000-4000-8000-000000000010')$$,
  '23505', 'manual nutrition observation idempotency conflict',
  'changed content conflicts on the same actor idempotency key'
);

select throws_ok($$select * from public.create_nsi_nutrition_screening_draft(
  '12101200-0000-4000-8000-000000000001',
  '12201200-0000-4000-8000-000000000001',
  '12401200-0000-4000-8000-000000000001', current_date + 1,
  (select answers from nsi_nutrition_payloads where payload_key = 'four'),
  'nsi-manual-nutrition-observations-candidate-v1',
  '12701200-0000-4000-8000-000000000011')$$,
  '22023', 'manual nutrition observation candidate payload is invalid',
  'future assessment date fails closed'
);

insert into nsi_nutrition_revise_result
select * from public.revise_nsi_nutrition_screening_draft(
  '12101200-0000-4000-8000-000000000001',
  '12201200-0000-4000-8000-000000000001',
  '12401200-0000-4000-8000-000000000001',
  (select assessment_key from nsi_nutrition_create_result),
  (select version_id from nsi_nutrition_create_result), 1, current_date - 2,
  (select answers from nsi_nutrition_payloads where payload_key = 'five'),
  'nsi-manual-nutrition-observations-candidate-v1',
  '12701200-0000-4000-8000-000000000012');

select ok(
  (select not replayed and assessment_version = 2
      and record_state = 'draft_preview'
      and assessment_key = (select assessment_key from nsi_nutrition_create_result)
      and preview_observed_count = 5
      and content_hash ~ '^[a-f0-9]{64}$'
   from nsi_nutrition_revise_result),
  'revision appends version two with reproducible candidate preview'
);

select throws_ok($$select * from public.revise_nsi_nutrition_screening_draft(
  '12101200-0000-4000-8000-000000000001',
  '12201200-0000-4000-8000-000000000001',
  '12401200-0000-4000-8000-000000000001',
  (select assessment_key from nsi_nutrition_create_result),
  (select version_id from nsi_nutrition_create_result), 1, current_date - 2,
  (select answers from nsi_nutrition_payloads where payload_key = 'five'),
  'nsi-manual-nutrition-observations-candidate-v1',
  '12701200-0000-4000-8000-000000000013')$$,
  '40001', 'manual nutrition observation candidate version is stale',
  'stale expected version cannot fork the chain'
);

reset role;

select ok(
  (select count(*) = 2
      and min(version) = 1 and max(version) = 2
      and count(*) filter (where previous_version_id is null) = 1
      and count(*) filter (where previous_version_id =
        (select version_id from nsi_nutrition_create_result)) = 1
   from public.nsi_nutrition_screening_versions
   where assessment_key = (select assessment_key from nsi_nutrition_create_result)),
  'candidate history is one linear two-version chain'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"12001200-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"12611200-0000-4000-8000-000000000001"}', true);

select throws_ok($$select * from public.sign_nsi_nutrition_screening(
  '12101200-0000-4000-8000-000000000001',
  '12201200-0000-4000-8000-000000000001',
  '12401200-0000-4000-8000-000000000001',
  (select assessment_key from nsi_nutrition_revise_result),
  (select version_id from nsi_nutrition_revise_result), 2,
  '12701200-0000-4000-8000-000000000014')$$,
  '55000', 'formal NSI questionnaire, licensed source, weights, and risk classification are not activated; formal signing is blocked',
  'sign permission cannot bypass an unactivated candidate rule'
);

reset role;

select is(
  (select count(*) from public.nsi_nutrition_screening_versions
   where assessment_key = (select assessment_key from nsi_nutrition_create_result)),
  2::bigint,
  'blocked signing creates no formal or additional version'
);

select throws_ok(
  format('update public.nsi_nutrition_screening_versions set assessed_on = current_date where id = %L',
    (select version_id from nsi_nutrition_revise_result)),
  '55000', 'manual nutrition observation candidate history is append-only',
  'committed version cannot be updated'
);

select throws_ok(
  format('delete from public.nsi_nutrition_screening_versions where id = %L',
    (select version_id from nsi_nutrition_revise_result)),
  '55000', 'manual nutrition observation candidate history is append-only',
  'committed version cannot be deleted'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"12001200-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"12611200-0000-4000-8000-000000000001"}', true);

select ok(
  (select matching_total = 2 and item_total = 2
      and not_assessed_total = 1 and candidate_complete_total = 1
      and incomplete_total = 0 and draft_total = 1
      and not items_truncated and not client_options_truncated
      and rule_activation_status = 'candidate_unactivated'
      and formal_sign_status = 'blocked_rule_not_activated'
      and formal_score_status = 'not_available'
      and formal_risk_classification_status = 'not_available'
      and diagnosis_status = 'blocked'
      and care_decision_status = 'blocked'
      and nutrition_follow_up_status = 'not_configured'
      and nutrition_referral_status = 'not_configured'
      and attachment_status = 'not_configured'
      and export_status = 'not_configured'
      and offline_sync_status = 'not_configured'
      and notification_status = 'not_configured'
   from public.nsi_nutrition_screening_snapshot(
    '12101200-0000-4000-8000-000000000001',
    '12201200-0000-4000-8000-000000000001')),
  'snapshot reports full-set metrics and unavailable boundaries'
);

select ok(
  (select exists (
        select 1 from jsonb_array_elements(items) item
        where item ->> 'client_id' =
          '12401200-0000-4000-8000-000000000001'
          and (item ->> 'assessment_version')::integer = 2
          and item ->> 'content_hash' ~ '^[a-f0-9]{64}$'
          and jsonb_array_length(item -> 'version_history') = 2
          and item -> 'version_history' -> 0 ->> 'version_id' =
            (select version_id::text from nsi_nutrition_revise_result)
          and item -> 'version_history' -> 0 ->> 'content_hash' ~
            '^[a-f0-9]{64}$'
      )
   from public.nsi_nutrition_screening_snapshot(
    '12101200-0000-4000-8000-000000000001',
    '12201200-0000-4000-8000-000000000001')),
  'snapshot returns terminal version and complete ordered chain'
);

select ok(
  (select matching_total = 1 and item_total = 1
      and not_assessed_total = 1 and draft_total = 0
      and items -> 0 ->> 'client_id' =
        '12401200-0000-4000-8000-000000000002'
   from public.nsi_nutrition_screening_snapshot(
    '12101200-0000-4000-8000-000000000001',
    '12201200-0000-4000-8000-000000000001', null,
    'not_assessed', 'all')),
  'not-assessed filter remains distinct from incomplete draft'
);

select ok(
  (select matching_total = 1 and item_total = 1
      and items -> 0 ->> 'client_id' =
        '12401200-0000-4000-8000-000000000001'
   from public.nsi_nutrition_screening_snapshot(
    '12101200-0000-4000-8000-000000000001',
    '12201200-0000-4000-8000-000000000001',
    '12401200-0000-4000-8000-000000000001',
    'candidate_complete', 'all_answered')),
  'exact-client and answer filters compose without scope widening'
);

reset role;

select ok(
  exists (
    select 1 from public.audit_events event
    where event.table_name in (
      'nsi_nutrition_screening_versions', 'public.nsi_nutrition_screening_versions'
    ) and event.organization_id =
      '12101200-0000-4000-8000-000000000001'
  ) and not exists (
    select 1 from public.audit_events event
    where event.organization_id =
      '12101200-0000-4000-8000-000000000001'
      and (coalesce(event.metadata::text, '') || ' ' ||
        coalesce(event.row_pk, '') || ' ' ||
        coalesce(array_to_string(event.changed_fields, ','), '')) ~
        'nutrition_observation_01.*value|合成測試本次無法確認|"value":"present"'
  ),
  'audit records actions without answer or narrative values'
);

select ok(
  exists (
    select 1 from public.audit_events event
    where event.table_name = 'nsi_nutrition_screening_versions'
      and event.action = 'select'
      and event.metadata @> '{
        "answers_logged":false,
        "personal_data_logged":false,
        "filter_values_logged":false,
        "formal_score_returned":false,
        "formal_risk_classification_returned":false,
        "diagnosis_returned":false,
        "follow_up_returned":false,
        "referral_returned":false,
        "notification_returned":false
      }'::jsonb
  ),
  'view and search audit excludes answers PII filters and formal score'
);

select ok(
  (select condef ~ 'UNIQUE \(actor_user_id, idempotency_key\)'
   from (
     select pg_get_constraintdef(oid) as condef
     from pg_constraint
     where conname = 'nsi_nutrition_screening_operations_actor_key'
   ) constraint_row),
  'idempotency is scoped to the acting user'
);

select is(
  (select count(*) from public.nsi_nutrition_screening_versions
   where record_state <> 'draft_preview'
      or governance_status <> 'candidate_unactivated'),
  0::bigint,
  'page 14 creates no signed formal or activated records'
);

select * from finish();
rollback;
