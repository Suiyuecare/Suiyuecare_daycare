begin;

-- Assessment dates are Taiwan business dates.  Keep current_date fixtures on
-- the same Asia/Taipei boundary as the production future-date guard.
set local time zone 'Asia/Taipei';

select plan(50);

select is(
  (select count(*) from public.permissions
   where permission_key like 'psychosocial_assessment.%'),
  0::bigint,
  'page 28 does not create an ungoverned permission namespace'
);

select ok(
  (select bool_and(relrowsecurity and relforcerowsecurity)
   from pg_class where oid in (
    'public.psychosocial_assessment_versions'::regclass,
    'private.psychosocial_assessment_operations'::regclass
  )),
  'page-28 assessment and receipt tables force RLS'
);

select ok(
  not has_table_privilege('authenticated',
    'public.psychosocial_assessment_versions', 'select,insert,update,delete')
  and not has_table_privilege('service_role',
    'public.psychosocial_assessment_versions', 'select,insert,update,delete')
  and not has_table_privilege('authenticated',
    'private.psychosocial_assessment_operations', 'select,insert,update,delete')
  and not has_table_privilege('service_role',
    'private.psychosocial_assessment_operations', 'select,insert,update,delete'),
  'browser and service roles have no direct page-28 table access'
);

select ok(
  has_function_privilege('authenticated',
    'public.create_psychosocial_assessment_draft(uuid,uuid,uuid,date,date,text,jsonb,text,text,uuid)', 'execute')
  and has_function_privilege('authenticated',
    'public.revise_psychosocial_assessment_draft(uuid,uuid,uuid,uuid,uuid,integer,date,date,text,jsonb,text,text,uuid)', 'execute')
  and has_function_privilege('authenticated',
    'public.sign_psychosocial_assessment(uuid,uuid,uuid,uuid,uuid,integer,uuid)', 'execute')
  and has_function_privilege('authenticated',
    'public.correct_psychosocial_assessment(uuid,uuid,uuid,uuid,uuid,integer,date,date,text,jsonb,text,text,text,uuid)', 'execute')
  and has_function_privilege('authenticated',
    'public.psychosocial_assessment_snapshot(uuid,uuid,uuid,uuid,text,text)', 'execute')
  and not has_function_privilege('service_role',
    'public.sign_psychosocial_assessment(uuid,uuid,uuid,uuid,uuid,integer,uuid)', 'execute'),
  'only authenticated callers receive public page-28 RPCs'
);

select ok(
  not (select prosecdef from pg_proc where oid =
    'public.create_psychosocial_assessment_draft(uuid,uuid,uuid,date,date,text,jsonb,text,text,uuid)'::regprocedure)
  and not (select prosecdef from pg_proc where oid =
    'public.psychosocial_assessment_snapshot(uuid,uuid,uuid,uuid,text,text)'::regprocedure),
  'public page-28 wrappers remain SECURITY INVOKER'
);

select ok(
  (select prosecdef and coalesce(proconfig, '{}'::text[]) @>
      array['search_path=""']
   from pg_proc where oid =
    'private.mutate_psychosocial_assessment_guarded(text,uuid,uuid,uuid,uuid,uuid,integer,date,date,text,jsonb,text,text,text,uuid)'::regprocedure)
  and (select prosecdef and coalesce(proconfig, '{}'::text[]) @>
      array['search_path=""']
   from pg_proc where oid =
    'private.psychosocial_assessment_snapshot_response(uuid,uuid,uuid,uuid,text,text)'::regprocedure)
  and not has_function_privilege('public',
    'private.mutate_psychosocial_assessment_guarded(text,uuid,uuid,uuid,uuid,uuid,integer,date,date,text,jsonb,text,text,text,uuid)', 'execute'),
  'private page-28 cores are pinned SECURITY DEFINER without PUBLIC execute'
);

select ok(
  position('pg_advisory_xact_lock' in pg_get_functiondef(
    'private.mutate_psychosocial_assessment_guarded(text,uuid,uuid,uuid,uuid,uuid,integer,date,date,text,jsonb,text,text,text,uuid)'::regprocedure)) > 0
  and position('authority expired' in pg_get_functiondef(
    'private.mutate_psychosocial_assessment_guarded(text,uuid,uuid,uuid,uuid,uuid,integer,date,date,text,jsonb,text,text,text,uuid)'::regprocedure)) > 0
  and position('v_after is distinct from v_bundle' in pg_get_functiondef(
    'private.psychosocial_assessment_snapshot_response(uuid,uuid,uuid,uuid,text,text)'::regprocedure)) > 0,
  'writes serialize and reads and writes recheck authority'
);

select is(
  (select count(*) from pg_trigger where not tgisinternal and tgname in (
    'psychosocial_assessment_versions_append_only',
    'psychosocial_assessment_operations_append_only'
  )), 2::bigint,
  'assessment versions and operation receipts are immutable'
);

select is(
  (select count(*) from pg_trigger where not tgisinternal and tgname in (
    'psychosocial_assessment_versions_audit_row_change',
    'psychosocial_assessment_operations_audit_row_change'
  )), 2::bigint,
  'both committed streams have exact audit triggers'
);

select is(
  (select count(*) from information_schema.columns
   where table_schema = 'public'
     and table_name = 'psychosocial_assessment_versions'
     and column_name in (
       'score', 'total_score', 'clinical_score', 'diagnosis',
       'formula', 'risk_level'
     )), 0::bigint,
  'page 28 stores no invented score, formula, risk class or diagnosis'
);

select ok(private.psychosocial_dimensions_are_valid(
  '{
    "family_relationships":{"state":"provided","detail":"合成家庭互動紀錄"},
    "social_support":{"state":"missing","detail":null},
    "social_participation":{"state":"not_applicable","detail":null},
    "communication_context":{"state":"provided","detail":"合成溝通偏好"},
    "resource_access":{"state":"missing","detail":null}
  }'::jsonb
), 'structured domains accept explicit provided, missing and not applicable');

select ok(not private.psychosocial_dimensions_are_valid(
  '{
    "family_relationships":{"state":"unknown_state","detail":null},
    "social_support":{"state":"missing","detail":null},
    "social_participation":{"state":"not_applicable","detail":null},
    "communication_context":{"state":"provided","detail":"合成內容"},
    "resource_access":{"state":"missing","detail":null}
  }'::jsonb
), 'unknown domain state fails closed');

insert into auth.users (id, aud, role, email, created_at, updated_at) values
  ('28000000-0000-4000-8000-000000001001', 'authenticated', 'authenticated', 'manager28@example.invalid', now(), now()),
  ('28000000-0000-4000-8000-000000001002', 'authenticated', 'authenticated', 'worker28@example.invalid', now(), now()),
  ('28000000-0000-4000-8000-000000001003', 'authenticated', 'authenticated', 'unassigned28@example.invalid', now(), now()),
  ('28000000-0000-4000-8000-000000001004', 'authenticated', 'authenticated', 'other28@example.invalid', now(), now());

insert into public.organizations (id, code, name) values
  ('28100000-0000-4000-8000-000000000001', 'psychosocial-a', '心理社會測試機構 A'),
  ('28100000-0000-4000-8000-000000000002', 'psychosocial-b', '心理社會測試機構 B');

insert into public.branches (id, organization_id, code, name) values
  ('28200000-0000-4000-8000-000000000001', '28100000-0000-4000-8000-000000000001', 'main', 'A 主分支'),
  ('28200000-0000-4000-8000-000000000002', '28100000-0000-4000-8000-000000000001', 'second', 'A 次分支'),
  ('28200000-0000-4000-8000-000000000003', '28100000-0000-4000-8000-000000000002', 'main', 'B 主分支');

insert into public.profiles (id, display_name, kind) values
  ('28000000-0000-4000-8000-000000001001', '心理社會機構管理員', 'staff'),
  ('28000000-0000-4000-8000-000000001002', '指派社工', 'staff'),
  ('28000000-0000-4000-8000-000000001003', '未指派社工', 'staff'),
  ('28000000-0000-4000-8000-000000001004', '他機構管理員', 'staff');

insert into public.memberships (
  id, organization_id, branch_id, profile_id, status
) values
  ('28300000-0000-4000-8000-000000000001', '28100000-0000-4000-8000-000000000001', null, '28000000-0000-4000-8000-000000001001', 'active'),
  ('28300000-0000-4000-8000-000000000002', '28100000-0000-4000-8000-000000000001', '28200000-0000-4000-8000-000000000001', '28000000-0000-4000-8000-000000001002', 'active'),
  ('28300000-0000-4000-8000-000000000003', '28100000-0000-4000-8000-000000000001', '28200000-0000-4000-8000-000000000001', '28000000-0000-4000-8000-000000001003', 'active'),
  ('28300000-0000-4000-8000-000000000004', '28100000-0000-4000-8000-000000000002', null, '28000000-0000-4000-8000-000000001004', 'active');

insert into public.membership_roles (membership_id, role_id) values
  ('28300000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002'),
  ('28300000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000004'),
  ('28300000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000004'),
  ('28300000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000002');

insert into public.clients (
  id, organization_id, branch_id, client_code, display_name, status,
  admitted_on, ended_on
) values
  ('28400000-0000-4000-8000-000000000001', '28100000-0000-4000-8000-000000000001', '28200000-0000-4000-8000-000000000001', 'PS-1', '合成個案甲', 'active', current_date - 90, null),
  ('28400000-0000-4000-8000-000000000002', '28100000-0000-4000-8000-000000000001', '28200000-0000-4000-8000-000000000001', 'PS-2', '合成個案乙', 'suspended', current_date - 60, null),
  ('28400000-0000-4000-8000-000000000003', '28100000-0000-4000-8000-000000000001', '28200000-0000-4000-8000-000000000002', 'PS-3', '他分支個案', 'active', current_date - 90, null),
  ('28400000-0000-4000-8000-000000000004', '28100000-0000-4000-8000-000000000002', '28200000-0000-4000-8000-000000000003', 'PS-4', '他機構個案', 'active', current_date - 90, null);

insert into public.client_assignments (
  id, organization_id, branch_id, client_id, assignee_user_id,
  assignment_kind
) values
  ('28500000-0000-4000-8000-000000000001', '28100000-0000-4000-8000-000000000001', '28200000-0000-4000-8000-000000000001', '28400000-0000-4000-8000-000000000001', '28000000-0000-4000-8000-000000001002', 'social-work'),
  ('28500000-0000-4000-8000-000000000002', '28100000-0000-4000-8000-000000000001', '28200000-0000-4000-8000-000000000001', '28400000-0000-4000-8000-000000000001', '28000000-0000-4000-8000-000000001001', 'management');

insert into private.reauth_challenges (
  id, user_id, session_id, nonce_sha256, idempotency_key,
  issued_jwt_iat, created_at, expires_at, consumed_at, consumed_jwt_iat,
  factor_method, factor_verified_at
) values (
  '28600000-0000-4000-8000-000000000001',
  '28000000-0000-4000-8000-000000001001',
  '28610000-0000-4000-8000-000000000001', repeat('2', 64),
  '28620000-0000-4000-8000-000000000001',
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
  '28000000-0000-4000-8000-000000001001',
  '28610000-0000-4000-8000-000000000001',
  '28600000-0000-4000-8000-000000000001', 'aal2', 'totp',
  (select factor_verified_at from private.reauth_challenges
   where id = '28600000-0000-4000-8000-000000000001')
);

create temporary table psychosocial_create_result as
select null::uuid operation_id, null::uuid client_id,
  null::uuid assessment_key, null::uuid version_id,
  0::integer assessment_version, null::text record_state,
  current_date assessed_on, null::uuid responsible_user_id,
  null::text service_status_at_assessment,
  current_date reassessment_due_on, null::text form_version_reference,
  clock_timestamp() committed_at, false replayed with no data;
create temporary table psychosocial_revise_result
  (like psychosocial_create_result);
create temporary table psychosocial_sign_result
  (like psychosocial_create_result);
create temporary table psychosocial_correct_result
  (like psychosocial_create_result);
create temporary table psychosocial_second_result
  (like psychosocial_create_result);

grant select, insert on psychosocial_create_result,
  psychosocial_revise_result, psychosocial_sign_result,
  psychosocial_correct_result, psychosocial_second_result
to authenticated;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"28000000-0000-4000-8000-000000001002","role":"authenticated","aal":"aal1","session_id":"28610000-0000-4000-8000-000000000099"}', true);

select throws_ok($$select * from public.psychosocial_assessment_snapshot(
  '28100000-0000-4000-8000-000000000001',
  '28200000-0000-4000-8000-000000000001')$$,
  '42501', 'psychosocial assessment snapshot is not permitted',
  'page-28 reads require AAL2'
);

select set_config('request.jwt.claims',
  '{"sub":"28000000-0000-4000-8000-000000001002","role":"authenticated","aal":"aal2","session_id":"28610000-0000-4000-8000-000000000099"}', true);

select throws_ok($$select * from public.psychosocial_assessment_snapshot(
  '28100000-0000-4000-8000-000000000001',
  '28200000-0000-4000-8000-000000000002')$$,
  '42501', 'psychosocial assessment snapshot is not permitted',
  'branch-scoped worker cannot read another branch'
);

select throws_ok($$select * from public.create_psychosocial_assessment_draft(
  '28100000-0000-4000-8000-000000000001',
  '28200000-0000-4000-8000-000000000001',
  '28400000-0000-4000-8000-000000000002', current_date,
  current_date + 7, '人工排定：合成服務會議',
  '{"family_relationships":{"state":"missing","detail":null},"social_support":{"state":"missing","detail":null},"social_participation":{"state":"missing","detail":null},"communication_context":{"state":"missing","detail":null},"resource_access":{"state":"missing","detail":null}}'::jsonb,
  '不得建立未指派個案評估', 'manual-psychosocial-v1',
  '28900000-0000-4000-8000-000000000001')$$,
  '42501', 'psychosocial assessment operation is not permitted',
  'unassigned worker cannot create for another client'
);

select set_config('request.jwt.claims',
  '{"sub":"28000000-0000-4000-8000-000000001001","role":"authenticated","aal":"aal2","session_id":"28610000-0000-4000-8000-000000000001"}', true);

insert into psychosocial_create_result
select * from public.create_psychosocial_assessment_draft(
  '28100000-0000-4000-8000-000000000001',
  '28200000-0000-4000-8000-000000000001',
  '28400000-0000-4000-8000-000000000001', current_date - 3,
  current_date + 7, '人工排定：合成服務會議紀錄',
  '{"family_relationships":{"state":"provided","detail":"合成家庭互動紀錄"},"social_support":{"state":"missing","detail":null},"social_participation":{"state":"not_applicable","detail":null},"communication_context":{"state":"provided","detail":"合成溝通偏好"},"resource_access":{"state":"missing","detail":null}}'::jsonb,
  '合成人工心理社會摘要第一版', 'manual-psychosocial-v1',
  '28900000-0000-4000-8000-000000000010');

select ok(
  (select not replayed
      and client_id = '28400000-0000-4000-8000-000000000001'
      and assessment_version = 1 and record_state = 'draft'
      and assessed_on = current_date - 3
      and responsible_user_id = '28000000-0000-4000-8000-000000001001'
      and service_status_at_assessment = 'active'
      and reassessment_due_on = current_date + 7
      and form_version_reference = 'manual-psychosocial-v1'
      and operation_id is not null and assessment_key is not null
      and version_id is not null
   from psychosocial_create_result),
  'create returns a complete receipt correlated to the exact client'
);

select ok(
  (select replayed
      and assessment_key = (select assessment_key from psychosocial_create_result)
      and version_id = (select version_id from psychosocial_create_result)
   from public.create_psychosocial_assessment_draft(
    '28100000-0000-4000-8000-000000000001',
    '28200000-0000-4000-8000-000000000001',
    '28400000-0000-4000-8000-000000000001', current_date - 3,
    current_date + 7, '人工排定：合成服務會議紀錄',
    '{"family_relationships":{"state":"provided","detail":"合成家庭互動紀錄"},"social_support":{"state":"missing","detail":null},"social_participation":{"state":"not_applicable","detail":null},"communication_context":{"state":"provided","detail":"合成溝通偏好"},"resource_access":{"state":"missing","detail":null}}'::jsonb,
    '合成人工心理社會摘要第一版', 'manual-psychosocial-v1',
    '28900000-0000-4000-8000-000000000010')),
  'exact replay returns the same committed version'
);

select throws_ok($$select * from public.create_psychosocial_assessment_draft(
  '28100000-0000-4000-8000-000000000001',
  '28200000-0000-4000-8000-000000000001',
  '28400000-0000-4000-8000-000000000001', current_date - 3,
  current_date + 8, '變更同一冪等內容',
  '{"family_relationships":{"state":"missing","detail":null},"social_support":{"state":"missing","detail":null},"social_participation":{"state":"missing","detail":null},"communication_context":{"state":"missing","detail":null},"resource_access":{"state":"missing","detail":null}}'::jsonb,
  '變更同一冪等操作內容', 'manual-psychosocial-v1',
  '28900000-0000-4000-8000-000000000010')$$,
  '23505', 'psychosocial assessment idempotency conflict',
  'changed content conflicts on the same actor idempotency key'
);

select throws_ok($$select * from public.create_psychosocial_assessment_draft(
  '28100000-0000-4000-8000-000000000001',
  '28200000-0000-4000-8000-000000000001',
  '28400000-0000-4000-8000-000000000001', current_date,
  current_date + 8, '人工排定',
  '{"family_relationships":{"state":"missing","detail":null},"social_support":{"state":"missing","detail":null},"social_participation":{"state":"missing","detail":null},"communication_context":{"state":"missing","detail":null},"resource_access":{"state":"missing","detail":null}}'::jsonb,
  '不得冒充官方量表', 'official-psychosocial-scale',
  '28900000-0000-4000-8000-000000000011')$$,
  '22023', 'manual psychosocial assessment content is invalid',
  'official-looking or unpublished form references are rejected'
);

select throws_ok($$select * from public.create_psychosocial_assessment_draft(
  '28100000-0000-4000-8000-000000000001',
  '28200000-0000-4000-8000-000000000001',
  '28400000-0000-4000-8000-000000000001', current_date,
  current_date + 8, '人工排定',
  '{"family_relationships":{"state":"provided","detail":null},"social_support":{"state":"missing","detail":null},"social_participation":{"state":"missing","detail":null},"communication_context":{"state":"missing","detail":null},"resource_access":{"state":"missing","detail":null}}'::jsonb,
  '有填狀態不得缺敘事', 'manual-psychosocial-v1',
  '28900000-0000-4000-8000-000000000012')$$,
  '22023', 'manual psychosocial assessment content is invalid',
  'provided domain requires its narrative'
);

select throws_ok($$select * from public.create_psychosocial_assessment_draft(
  '28100000-0000-4000-8000-000000000001',
  '28200000-0000-4000-8000-000000000001',
  '28400000-0000-4000-8000-000000000001', current_date + 1,
  current_date + 8, '人工排定',
  '{"family_relationships":{"state":"missing","detail":null},"social_support":{"state":"missing","detail":null},"social_participation":{"state":"missing","detail":null},"communication_context":{"state":"missing","detail":null},"resource_access":{"state":"missing","detail":null}}'::jsonb,
  '未來評估日期不得建立', 'manual-psychosocial-v1',
  '28900000-0000-4000-8000-000000000013')$$,
  '22023', 'future psychosocial assessment date is invalid',
  'future assessment date is rejected'
);

insert into psychosocial_revise_result
select * from public.revise_psychosocial_assessment_draft(
  '28100000-0000-4000-8000-000000000001',
  '28200000-0000-4000-8000-000000000001',
  '28400000-0000-4000-8000-000000000001',
  (select assessment_key from psychosocial_create_result),
  (select version_id from psychosocial_create_result), 1,
  current_date - 3, current_date + 5,
  '人工排定：合成跨專業會議紀錄',
  '{"family_relationships":{"state":"provided","detail":"合成家庭互動更新"},"social_support":{"state":"provided","detail":"合成支持網絡"},"social_participation":{"state":"not_applicable","detail":null},"communication_context":{"state":"provided","detail":"合成溝通偏好"},"resource_access":{"state":"missing","detail":null}}'::jsonb,
  '合成人工心理社會摘要第二版', 'manual-psychosocial-v1',
  '28900000-0000-4000-8000-000000000014');

select ok(
  (select not replayed and assessment_version = 2
      and record_state = 'draft'
      and assessment_key = (select assessment_key from psychosocial_create_result)
   from psychosocial_revise_result),
  'draft revision appends version two without replacement'
);

select throws_ok($$select * from public.revise_psychosocial_assessment_draft(
  '28100000-0000-4000-8000-000000000001',
  '28200000-0000-4000-8000-000000000001',
  '28400000-0000-4000-8000-000000000001',
  (select assessment_key from psychosocial_create_result),
  (select version_id from psychosocial_create_result), 1,
  current_date - 3, current_date + 5, '人工排定',
  '{"family_relationships":{"state":"missing","detail":null},"social_support":{"state":"missing","detail":null},"social_participation":{"state":"missing","detail":null},"communication_context":{"state":"missing","detail":null},"resource_access":{"state":"missing","detail":null}}'::jsonb,
  '過期修訂不得寫入', 'manual-psychosocial-v1',
  '28900000-0000-4000-8000-000000000015')$$,
  '40001', 'psychosocial assessment version is stale',
  'stale expected version is rejected'
);

select set_config('request.jwt.claims',
  '{"sub":"28000000-0000-4000-8000-000000001001","role":"authenticated","aal":"aal2","session_id":"28610000-0000-4000-8000-000000000099"}', true);
select throws_ok($$select * from public.sign_psychosocial_assessment(
  '28100000-0000-4000-8000-000000000001',
  '28200000-0000-4000-8000-000000000001',
  '28400000-0000-4000-8000-000000000001',
  (select assessment_key from psychosocial_revise_result),
  (select version_id from psychosocial_revise_result), 2,
  '28900000-0000-4000-8000-000000000016')$$,
  '42501',
  'current same-session recent AAL2 evidence is required for psychosocial signing',
  'AAL2 JWT without same-session recent evidence cannot sign'
);

select set_config('request.jwt.claims',
  '{"sub":"28000000-0000-4000-8000-000000001001","role":"authenticated","aal":"aal2","session_id":"28610000-0000-4000-8000-000000000001"}', true);
insert into psychosocial_sign_result
select * from public.sign_psychosocial_assessment(
  '28100000-0000-4000-8000-000000000001',
  '28200000-0000-4000-8000-000000000001',
  '28400000-0000-4000-8000-000000000001',
  (select assessment_key from psychosocial_revise_result),
  (select version_id from psychosocial_revise_result), 2,
  '28900000-0000-4000-8000-000000000017');

select ok(
  (select not replayed and assessment_version = 3
      and record_state = 'signed'
   from psychosocial_sign_result),
  'recent same-session AAL2 signs a new immutable version'
);

reset role;
select ok(
  (select signature_purpose = '人工心理社會評估簽署'
      and signature_reauth_challenge_id =
        '28600000-0000-4000-8000-000000000001'
      and signed_by = '28000000-0000-4000-8000-000000001001'
   from public.psychosocial_assessment_versions
   where id = (select version_id from psychosocial_sign_result)),
  'signed version preserves signer, purpose and reauthentication evidence'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"28000000-0000-4000-8000-000000001001","role":"authenticated","aal":"aal2","session_id":"28610000-0000-4000-8000-000000000001"}', true);

select throws_ok($$select * from public.correct_psychosocial_assessment(
  '28100000-0000-4000-8000-000000000001',
  '28200000-0000-4000-8000-000000000001',
  '28400000-0000-4000-8000-000000000001',
  (select assessment_key from psychosocial_sign_result),
  (select version_id from psychosocial_sign_result), 3,
  current_date - 3, current_date - 1, '人工排定：合成會議',
  '{"family_relationships":{"state":"provided","detail":"合成更正"},"social_support":{"state":"provided","detail":"合成支持"},"social_participation":{"state":"not_applicable","detail":null},"communication_context":{"state":"provided","detail":"合成偏好"},"resource_access":{"state":"missing","detail":null}}'::jsonb,
  '更正後合成人工摘要', 'manual-psychosocial-v1', null,
  '28900000-0000-4000-8000-000000000018')$$,
  '22023', 'manual psychosocial assessment content is invalid',
  'signed correction requires a reason'
);

insert into psychosocial_correct_result
select * from public.correct_psychosocial_assessment(
  '28100000-0000-4000-8000-000000000001',
  '28200000-0000-4000-8000-000000000001',
  '28400000-0000-4000-8000-000000000001',
  (select assessment_key from psychosocial_sign_result),
  (select version_id from psychosocial_sign_result), 3,
  current_date - 3, current_date - 1,
  '人工排定：合成個案研討紀錄',
  '{"family_relationships":{"state":"provided","detail":"合成家庭互動更正"},"social_support":{"state":"provided","detail":"合成支持網絡更正"},"social_participation":{"state":"not_applicable","detail":null},"communication_context":{"state":"provided","detail":"合成溝通偏好更正"},"resource_access":{"state":"missing","detail":null}}'::jsonb,
  '更正後合成人工心理社會摘要', 'manual-psychosocial-v1',
  '原簽署內容有一處實際觀察需更正',
  '28900000-0000-4000-8000-000000000019');

select ok(
  (select not replayed and assessment_version = 4
      and record_state = 'corrected'
      and reassessment_due_on = current_date - 1
   from psychosocial_correct_result),
  'signed content changes only through a reasoned signed correction'
);

reset role;
select ok(
  (select count(*) = 4 and min(version) = 1 and max(version) = 4
      and count(distinct id) = 4
   from public.psychosocial_assessment_versions
   where assessment_key =
     (select assessment_key from psychosocial_create_result))
  and (select previous_version_id =
        (select version_id from psychosocial_sign_result)
       from public.psychosocial_assessment_versions
       where id = (select version_id from psychosocial_correct_result)),
  'history retains four distinct linked versions'
);

select ok(
  (select bool_and(
      responsible_user_id = '28000000-0000-4000-8000-000000001001'
      and service_status_at_assessment = 'active'
    ) from public.psychosocial_assessment_versions
    where assessment_key =
      (select assessment_key from psychosocial_create_result)),
  'responsible worker and service-status evidence remain stable across a chain'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"28000000-0000-4000-8000-000000001001","role":"authenticated","aal":"aal2","session_id":"28610000-0000-4000-8000-000000000001"}', true);
select throws_ok($$select * from public.revise_psychosocial_assessment_draft(
  '28100000-0000-4000-8000-000000000001',
  '28200000-0000-4000-8000-000000000001',
  '28400000-0000-4000-8000-000000000001',
  (select assessment_key from psychosocial_correct_result),
  (select version_id from psychosocial_correct_result), 4,
  current_date - 3, current_date + 8, '人工排定',
  '{"family_relationships":{"state":"missing","detail":null},"social_support":{"state":"missing","detail":null},"social_participation":{"state":"missing","detail":null},"communication_context":{"state":"missing","detail":null},"resource_access":{"state":"missing","detail":null}}'::jsonb,
  '不可回到草稿', 'manual-psychosocial-v1',
  '28900000-0000-4000-8000-000000000020')$$,
  '23514', 'signed psychosocial assessment requires a correction',
  'signed or corrected assessment cannot return to draft'
);

reset role;
select throws_ok($$update public.psychosocial_assessment_versions
  set assessment_summary = '直接覆寫'
  where id = (select version_id from psychosocial_sign_result)$$,
  '55000', 'psychosocial assessment history is append-only',
  'direct update is rejected'
);
select throws_ok($$delete from public.psychosocial_assessment_versions
  where id = (select version_id from psychosocial_sign_result)$$,
  '55000', 'psychosocial assessment history is append-only',
  'direct delete is rejected'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"28000000-0000-4000-8000-000000001001","role":"authenticated","aal":"aal2","session_id":"28610000-0000-4000-8000-000000000001"}', true);

select ok(
  (select matching_total = 2 and item_total = 2
      and assessed_total = 1 and not_assessed_total = 1
      and due_total = 1 and upcoming_total = 0
      and draft_total = 0 and completed_total = 1
   from public.psychosocial_assessment_snapshot(
    '28100000-0000-4000-8000-000000000001',
    '28200000-0000-4000-8000-000000000001')),
  'snapshot metrics reconcile before the detail limit'
);

select ok(
  (select matching_total = 1
      and items -> 0 ->> 'client_id' =
        '28400000-0000-4000-8000-000000000001'
      and items -> 0 ->> 'service_status' = 'active'
      and items -> 0 ->> 'responsible_user_id' =
        '28000000-0000-4000-8000-000000001001'
      and (items -> 0 ->> 'reassessment_due')::boolean
   from public.psychosocial_assessment_snapshot(
    '28100000-0000-4000-8000-000000000001',
    '28200000-0000-4000-8000-000000000001',
    '28400000-0000-4000-8000-000000000001',
    '28000000-0000-4000-8000-000000001001', 'active', 'due')),
  'client, responsible worker, service status and due filters compose'
);

select ok(
  (select matching_total = 1
      and items -> 0 ->> 'client_id' =
        '28400000-0000-4000-8000-000000000002'
   from public.psychosocial_assessment_snapshot(
    '28100000-0000-4000-8000-000000000001',
    '28200000-0000-4000-8000-000000000001', null, null,
    'suspended', 'not_assessed')),
  'current service status and no-assessment filters compose'
);

select ok(
  (select assessment_method_status = 'manual_unstandardized_only'
      and form_publication_status = 'not_published_not_claimed'
      and due_rule_status = 'not_configured_manual_date_and_basis_only'
      and score_status = 'not_configured'
      and diagnosis_status = 'not_configured'
      and attachment_status = 'not_configured'
      and export_status = 'not_configured'
      and offline_sync_status = 'not_configured'
   from public.psychosocial_assessment_snapshot(
    '28100000-0000-4000-8000-000000000001',
    '28200000-0000-4000-8000-000000000001')),
  'unpublished rules and unavailable capabilities are explicitly not configured'
);

select ok(
  (select jsonb_array_length(items -> 0 -> 'version_history') = 4
      and (items -> 0 ->> 'version_history_total')::integer = 4
      and items -> 0 -> 'dimensions' -> 'social_support' ->> 'state'
        = 'provided'
   from public.psychosocial_assessment_snapshot(
    '28100000-0000-4000-8000-000000000001',
    '28200000-0000-4000-8000-000000000001',
    '28400000-0000-4000-8000-000000000001')),
  'snapshot returns bounded history and explicit structured states'
);

select throws_ok($$select * from public.psychosocial_assessment_snapshot(
  '28100000-0000-4000-8000-000000000001',
  '28200000-0000-4000-8000-000000000001', null, null, null,
  'invented_rule')$$,
  '42501', 'psychosocial assessment snapshot is not permitted',
  'unknown due filter fails closed'
);

insert into psychosocial_second_result
select * from public.create_psychosocial_assessment_draft(
  '28100000-0000-4000-8000-000000000001',
  '28200000-0000-4000-8000-000000000001',
  '28400000-0000-4000-8000-000000000001', current_date,
  current_date + 14, '人工排定：合成下一次會談',
  '{"family_relationships":{"state":"missing","detail":null},"social_support":{"state":"missing","detail":null},"social_participation":{"state":"missing","detail":null},"communication_context":{"state":"provided","detail":"合成新紀錄"},"resource_access":{"state":"not_applicable","detail":null}}'::jsonb,
  '較新日期的另一份合成人工評估', 'manual-psychosocial-v1',
  '28900000-0000-4000-8000-000000000030');

select ok(
  (select not replayed and assessment_version = 1
      and record_state = 'draft'
      and assessment_key <>
        (select assessment_key from psychosocial_create_result)
   from psychosocial_second_result),
  'a later assessment creates another chain rather than overwriting history'
);

select ok(
  (select items -> 0 ->> 'assessment_key' =
      (select assessment_key::text from psychosocial_second_result)
      and items -> 0 ->> 'record_state' = 'draft'
      and items -> 0 ->> 'assessed_on' = current_date::text
   from public.psychosocial_assessment_snapshot(
    '28100000-0000-4000-8000-000000000001',
    '28200000-0000-4000-8000-000000000001',
    '28400000-0000-4000-8000-000000000001')),
  'latest assessment is selected by assessment date immediately'
);

select set_config('request.jwt.claims',
  '{"sub":"28000000-0000-4000-8000-000000001002","role":"authenticated","aal":"aal2","session_id":"28610000-0000-4000-8000-000000000099"}', true);
select ok(
  (select matching_total = 1 and item_total = 1 and client_total = 1
      and items -> 0 ->> 'client_id' =
        '28400000-0000-4000-8000-000000000001'
   from public.psychosocial_assessment_snapshot(
    '28100000-0000-4000-8000-000000000001',
    '28200000-0000-4000-8000-000000000001')),
  'assigned worker sees only the assigned client'
);

select throws_ok($$select * from public.psychosocial_assessment_snapshot(
  '28100000-0000-4000-8000-000000000002',
  '28200000-0000-4000-8000-000000000003')$$,
  '42501', 'psychosocial assessment snapshot is not permitted',
  'cross-tenant snapshot is rejected'
);

reset role;
select ok(
  not exists (
    select 1 from public.audit_events event
    where event.table_name in (
      'psychosocial_assessment_versions',
      'psychosocial_assessment_operations'
    ) and (
      event.metadata::text like '%合成人工心理社會摘要第一版%'
      or event.metadata::text like '%合成家庭互動紀錄%'
      or event.metadata::text like '%合成服務會議紀錄%'
    )
  ) and exists (
    select 1 from public.audit_events event
    where event.table_name = 'psychosocial_assessment_versions'
      and event.metadata ->> 'narrative_logged' = 'false'
      and event.metadata ->> 'filter_values_logged' = 'false'
      and event.metadata ->> 'score_computed' = 'false'
      and event.metadata ->> 'diagnosis_computed' = 'false'
  ),
  'audit metadata excludes narrative, sensitive filters, score and diagnosis'
);

select is(
  (select count(*) from public.psychosocial_assessment_versions
   where organization_id = '28100000-0000-4000-8000-000000000001'
     and branch_id = '28200000-0000-4000-8000-000000000001'),
  5::bigint,
  'two assessments retain all five immutable versions'
);

select is(
  (select count(*) from private.psychosocial_assessment_operations
   where actor_user_id = '28000000-0000-4000-8000-000000001001'),
  5::bigint,
  'failed and replayed requests create no extra receipts'
);

select ok(
  (select bool_and(content_hash ~ '^[a-f0-9]{64}$')
   from public.psychosocial_assessment_versions
   where organization_id = '28100000-0000-4000-8000-000000000001'),
  'every immutable version carries a SHA-256 hash'
);

select ok(
  position('from matching' in pg_get_functiondef(
    'private.psychosocial_assessment_snapshot_bundle(uuid,uuid,uuid,uuid,text,text,timestamptz)'::regprocedure)) > 0
  and position('limit 200' in pg_get_functiondef(
    'private.psychosocial_assessment_snapshot_bundle(uuid,uuid,uuid,uuid,text,text,timestamptz)'::regprocedure)) > 0
  and position('cross join stats' in pg_get_functiondef(
    'private.psychosocial_assessment_snapshot_bundle(uuid,uuid,uuid,uuid,text,text,timestamptz)'::regprocedure)) > 0,
  'statistics use complete matching rows before bounded details'
);

select ok(
  (select due_basis = '人工排定：合成個案研討紀錄'
      and form_basis = 'manual_unstandardized'
      and form_version_reference = 'manual-psychosocial-v1'
   from public.psychosocial_assessment_versions
   where id = (select version_id from psychosocial_correct_result)),
  'manual due-date basis and non-standardized form evidence are preserved'
);

select ok(
  (select not items_truncated and not client_options_truncated
      and not responsible_options_truncated
      and responsible_total = 1
   from public.psychosocial_assessment_snapshot(
    '28100000-0000-4000-8000-000000000001',
    '28200000-0000-4000-8000-000000000001')),
  'bounded option and detail lists disclose truncation explicitly'
);

select * from finish();
rollback;
