begin;
select plan(90);

-- All people and cases are synthetic. Exercise the real Google/session/grant
-- admission path, rather than overriding an auth predicate in this suite.
select set_config('test.aal1_amr',floor(extract(epoch from clock_timestamp()-interval '2 minutes'))::text,true);
insert into auth.users(id,aud,role,email,email_confirmed_at,created_at,updated_at)
values('d0100000-0000-4000-8000-000000000001','authenticated','authenticated',
 'nurse@care.example.invalid',now()-interval '1 day',now()-interval '1 day',now());
insert into auth.identities(id,provider_id,user_id,identity_data,provider)
values('d0200000-0000-4000-8000-000000000001','synthetic-clinical-staff',
 'd0100000-0000-4000-8000-000000000001',
 '{"sub":"synthetic-clinical-staff","email":"nurse@care.example.invalid","email_verified":true,"hd":"care.example.invalid"}','google');
insert into auth.sessions(id,user_id,created_at,aal)
values('d0300000-0000-4000-8000-000000000001','d0100000-0000-4000-8000-000000000001',now()-interval '3 minutes','aal1');
insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method)
values(gen_random_uuid(),'d0300000-0000-4000-8000-000000000001',
 to_timestamp(current_setting('test.aal1_amr')::bigint),
 to_timestamp(current_setting('test.aal1_amr')::bigint),'oauth');
insert into public.organizations(id,code,name) values
 ('d0500000-0000-4000-8000-000000000001','synthetic-aal1-org','Synthetic clinical organization'),
 ('d0500000-0000-4000-8000-000000000002','synthetic-other-org','Synthetic other organization');
insert into public.branches(id,organization_id,code,name) values
 ('d0600000-0000-4000-8000-000000000001','d0500000-0000-4000-8000-000000000001','main','Synthetic main branch'),
 ('d0600000-0000-4000-8000-000000000002','d0500000-0000-4000-8000-000000000001','other','Synthetic other branch'),
 ('d0600000-0000-4000-8000-000000000003','d0500000-0000-4000-8000-000000000002','foreign','Synthetic foreign branch');
insert into public.profiles(id,display_name,kind)
values('d0100000-0000-4000-8000-000000000001','Synthetic nurse','staff');
insert into public.memberships(id,organization_id,branch_id,profile_id,status,starts_at)
values('d0700000-0000-4000-8000-000000000001','d0500000-0000-4000-8000-000000000001',
 'd0600000-0000-4000-8000-000000000001','d0100000-0000-4000-8000-000000000001',
 'active',now()-interval '1 day');
insert into public.membership_roles(membership_id,role_id)
values('d0700000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003');
insert into public.role_permissions(role_id,permission_id)
select '10000000-0000-4000-8000-000000000003',id from public.permissions
where permission_key in ('clients.read','clients.view_all','clients.demographics.read',
 'health.read','medications.read','body_assessments.read','body_assessments.manage',
 'behavior_events.read','behavior_events.manage','abcd_assessments.read',
 'abcd_assessments.manage','insulin_administrations.read','insulin_administrations.execute')
on conflict do nothing;
insert into public.clients(id,organization_id,branch_id,client_code,display_name,admitted_on) values
 ('d0800000-0000-4000-8000-000000000001','d0500000-0000-4000-8000-000000000001','d0600000-0000-4000-8000-000000000001','SYN-AAL1-1','Synthetic assigned client',current_date-10),
 ('d0800000-0000-4000-8000-000000000002','d0500000-0000-4000-8000-000000000001','d0600000-0000-4000-8000-000000000001','SYN-AAL1-2','Synthetic unassigned client',current_date-10),
 ('d0800000-0000-4000-8000-000000000003','d0500000-0000-4000-8000-000000000001','d0600000-0000-4000-8000-000000000002','SYN-AAL1-3','Synthetic other-branch client',current_date-10),
 ('d0800000-0000-4000-8000-000000000004','d0500000-0000-4000-8000-000000000002','d0600000-0000-4000-8000-000000000003','SYN-AAL1-4','Synthetic foreign client',current_date-10);
insert into public.client_assignments(organization_id,branch_id,client_id,assignee_user_id,assignment_kind,starts_at)
values('d0500000-0000-4000-8000-000000000001','d0600000-0000-4000-8000-000000000001',
 'd0800000-0000-4000-8000-000000000001','d0100000-0000-4000-8000-000000000001',
 'synthetic_clinical_test',now()-interval '1 day');

create function pg_temp.aal1_claims() returns boolean language plpgsql security invoker as $$
begin
 perform set_config('request.jwt.claims',jsonb_build_object(
  'sub','d0100000-0000-4000-8000-000000000001',
  'session_id','d0300000-0000-4000-8000-000000000001',
  'aud','authenticated','role','authenticated','aal','aal1',
  'email','nurse@care.example.invalid','is_anonymous',false,
  'iat',floor(extract(epoch from clock_timestamp())),
  'exp',floor(extract(epoch from clock_timestamp()+interval '30 minutes')),
  'amr',jsonb_build_array(jsonb_build_object('method','oauth',
    'timestamp',current_setting('test.aal1_amr')::bigint)))::text,true);
 return public.is_staff_login_allowed();
end; $$;
create temporary table approved_drafts(kind text primary key, receipt jsonb not null);
grant select,insert on approved_drafts to authenticated;
create function pg_temp.body_draft(p_client uuid,p_prior jsonb default null) returns jsonb
language sql stable as $$
 select jsonb_build_object('action',case when p_prior is null then 'create' else 'revise' end,
  'client_id',p_client,'assessment_key',p_prior->'assessment_key',
  'previous_version_id',p_prior->'version_id',
  'expected_version',coalesce((p_prior->>'version')::integer,0),
  'expected_content_hash',p_prior->'content_hash',
  'observed_at',now()-interval '1 hour',
  'instrument','manual_nonstandard_body_observation_v1',
  'observations',jsonb_build_array(jsonb_build_object('area','left_arm','state','normal',
    'description',null,'reason',null,'disposition',null)),
  'reason','合成測試人工身體觀察');
$$;
create function pg_temp.abcd_draft(p_client uuid,p_prior jsonb default null) returns jsonb
language sql stable as $$
 select jsonb_build_object('mode',case when p_prior is null then 'create' else 'revise' end,
  'client_id',p_client,'assessment_key',p_prior->'assessment_key',
  'previous_version_id',p_prior->'version_id',
  'expected_version',coalesce((p_prior->>'version')::integer,0),
  'expected_content_hash',p_prior->'content_hash',
  'assessment_type','A','assessment_year',extract(year from now() at time zone 'Asia/Taipei')::integer,
  'assessment_date',(now() at time zone 'Asia/Taipei')::date,
  'manual_summary','合成測試人工候選摘要',
  'result',jsonb_build_object('state','missing','text',null,'reason','尚未記錄'),
  'reassessment',jsonb_build_object('state','missing','date',null,'basis','尚未指定'),
  'reason','建立合成候選初稿');
$$;
create function pg_temp.behavior_draft(p_client uuid,p_prior jsonb default null) returns jsonb
language sql stable as $$
 select jsonb_build_object('mode',case when p_prior is null then 'create' else 'revise' end,
  'client_id',p_client,'event_key',p_prior->'event_key',
  'previous_version_id',p_prior->'version_id',
  'expected_version',coalesce((p_prior->>'version')::integer,0),
  'expected_content_hash',p_prior->'content_hash',
  'occurred_at',now()-interval '1 hour','event_type','活動參與',
  'antecedent',jsonb_build_object('state','missing','text',null),
  'behavior',jsonb_build_object('state','recorded','text','合成行為觀察'),
  'intervention',jsonb_build_object('state','missing','text',null),
  'outcome',jsonb_build_object('state','missing','text',null),
  'reason','建立合成事件初稿');
$$;

select ok(not has_function_privilege('authenticated','private.has_permission_for_snapshot(uuid,uuid,text)','execute')
 and not has_function_privilege('authenticated','private.can_staff_access_client_for_snapshot(uuid,text)','execute'),
 'new private read helpers cannot be called by API roles');
select ok((select bool_and(prosecdef and proconfig @> array['search_path=""']
  and pg_get_userbyid(proowner)='postgres') from pg_proc
 where oid in ('private.has_permission_for_snapshot(uuid,uuid,text)'::regprocedure,
               'private.can_staff_access_client_for_snapshot(uuid,text)'::regprocedure,
               'private.insulin_base_authority_for_snapshot(uuid,uuid,text)'::regprocedure)),
 'new helpers run with fixed search path and reviewed owner');
select ok(has_function_privilege('authenticated',
 'private.has_google_assessment_draft_access(uuid,uuid,text,uuid)','execute')
 and has_function_privilege('authenticated',
 'private.has_recent_body_assessment_aal2(uuid,uuid)','execute')
 and not has_function_privilege('anon',
 'private.has_google_assessment_draft_access(uuid,uuid,text,uuid)','execute')
 and not has_function_privilege('anon',
 'private.has_recent_body_assessment_aal2(uuid,uuid)','execute'),
 'only authenticated can call two scoped boolean private preflight helpers');
select ok((select bool_and(prosecdef and proconfig @> array['search_path=""']
 and pg_get_userbyid(proowner)='postgres') from pg_proc
 where oid in ('private.has_google_assessment_draft_access(uuid,uuid,text,uuid)'::regprocedure,
               'private.has_recent_body_assessment_aal2(uuid,uuid)'::regprocedure))
 and (select bool_and(not prosecdef) from pg_proc
 where oid in ('public.has_google_assessment_draft_access(uuid,uuid,text,uuid)'::regprocedure,
               'public.has_recent_body_assessment_aal2(uuid,uuid)'::regprocedure)),
 'public preflight wrappers are invoker-only and private implementations have fixed definer scope');

set local role authenticated;
select is(pg_temp.aal1_claims(),false,'unapproved Google session cannot enter');
select throws_ok($$select public.body_assessment_snapshot(
 'd0500000-0000-4000-8000-000000000001','d0600000-0000-4000-8000-000000000001')$$,
 '42501',null,'unapproved Google session cannot read clinical snapshot');
reset role;
select set_config('request.jwt.claims','{}',true);
insert into private.staff_google_access_grants(allowed_user_id,organization_id,
 company_email_domain,allowed_email,google_subject,enabled,approval_reference)
values('d0100000-0000-4000-8000-000000000001','d0500000-0000-4000-8000-000000000001',
 'care.example.invalid','nurse@care.example.invalid','synthetic-clinical-staff',true,
 'Synthetic explicit approval');
set local role authenticated;
select is(pg_temp.aal1_claims(),true,'individually approved Google AAL1 session is admitted');
select is(private.is_active_user(),false,'normal Google work session does not become global AAL2');
select is(public.has_recent_aal2(15),false,'snapshot access does not fabricate reauthentication');
select is(public.has_recent_body_assessment_aal2(
 'd0500000-0000-4000-8000-000000000001','d0600000-0000-4000-8000-000000000001'),false,
 'body-specific signer preflight never admits AAL1');
select is(public.has_google_assessment_draft_access(
 'd0500000-0000-4000-8000-000000000001','d0600000-0000-4000-8000-000000000001',
 'body','d0800000-0000-4000-8000-000000000001'),true,
 'approved Google staff can preflight one assigned body draft');
select is(public.has_google_assessment_draft_access(
 'd0500000-0000-4000-8000-000000000001','d0600000-0000-4000-8000-000000000001',
 'body',null),true,'approved Google staff can preflight the branch before parsing a draft');
select is(public.has_google_assessment_draft_access(
 'd0500000-0000-4000-8000-000000000001','d0600000-0000-4000-8000-000000000001',
 'abcd','d0800000-0000-4000-8000-000000000001'),true,
 'approved Google staff can preflight one assigned ABCD draft');
select is(public.has_google_assessment_draft_access(
 'd0500000-0000-4000-8000-000000000001','d0600000-0000-4000-8000-000000000001',
 'behavior','d0800000-0000-4000-8000-000000000001'),true,
 'approved Google staff can preflight one assigned behavior draft');
select is(public.has_google_assessment_draft_access(
 'd0500000-0000-4000-8000-000000000001','d0600000-0000-4000-8000-000000000002',
 'body',null),false,'draft preflight rejects a different branch');
select is(public.has_google_assessment_draft_access(
 'd0500000-0000-4000-8000-000000000001','d0600000-0000-4000-8000-000000000001',
 'medication',null),false,'draft preflight never admits medication execution');
select is((select count(*)::integer from public.client_master_snapshot(
 'd0500000-0000-4000-8000-000000000001','d0600000-0000-4000-8000-000000000001','view')),2,
 'case master returns only two same-branch visible cases');
select is((select client_total::integer from public.body_assessment_snapshot(
 'd0500000-0000-4000-8000-000000000001','d0600000-0000-4000-8000-000000000001')),2,
 'body assessment page loads in approved AAL1 scope');
select is((select client_total::integer from public.abcd_assessment_snapshot(
 'd0500000-0000-4000-8000-000000000001','d0600000-0000-4000-8000-000000000001')),2,
 'ABCD page loads in approved AAL1 scope');
select is((select client_total::integer from public.behavior_event_snapshot(
 'd0500000-0000-4000-8000-000000000001','d0600000-0000-4000-8000-000000000001')),2,
 'behavior page loads in approved AAL1 scope');
select is((select count(*)::integer from public.medication_administration_day_snapshot(
 'd0500000-0000-4000-8000-000000000001','d0600000-0000-4000-8000-000000000001',current_date)),0,
 'medication page gives true empty list rather than authorization error');
select is((select count(*)::integer from public.client_tocc_snapshot(
 'd0500000-0000-4000-8000-000000000001','d0600000-0000-4000-8000-000000000001')),0,
 'TOCC page gives true empty list rather than authorization error');
select is((select can_execute from public.insulin_administration_snapshot(
 'd0500000-0000-4000-8000-000000000001','d0600000-0000-4000-8000-000000000001',current_date)),false,
 'insulin page is readable but execution remains disabled');
select is((select can_review from public.insulin_administration_snapshot(
 'd0500000-0000-4000-8000-000000000001','d0600000-0000-4000-8000-000000000001',current_date)),false,
 'AAL1 cannot second-review insulin');
select is((select can_authorize_late from public.insulin_administration_snapshot(
 'd0500000-0000-4000-8000-000000000001','d0600000-0000-4000-8000-000000000001',current_date)),false,
 'AAL1 cannot authorize late insulin');
select throws_ok($$select public.body_assessment_snapshot(
 'd0500000-0000-4000-8000-000000000001','d0600000-0000-4000-8000-000000000002')$$,
 '42501',null,'same-organization different branch body list denied');
select throws_ok($$select public.abcd_assessment_snapshot(
 'd0500000-0000-4000-8000-000000000002','d0600000-0000-4000-8000-000000000003')$$,
 '42501',null,'different-organization ABCD list denied');
select throws_ok($$select public.behavior_event_snapshot(
 'd0500000-0000-4000-8000-000000000001','d0600000-0000-4000-8000-000000000002')$$,
 '42501',null,'different-branch behavior list denied');
select throws_ok($$select public.medication_administration_day_snapshot(
 'd0500000-0000-4000-8000-000000000001','d0600000-0000-4000-8000-000000000002',current_date)$$,
 '42501',null,'different-branch medication list denied');
select throws_ok($$select public.client_tocc_snapshot(
 'd0500000-0000-4000-8000-000000000001','d0600000-0000-4000-8000-000000000002')$$,
 '42501',null,'different-branch TOCC list denied');
select throws_ok($$select public.insulin_administration_snapshot(
 'd0500000-0000-4000-8000-000000000001','d0600000-0000-4000-8000-000000000002',current_date)$$,
 '42501',null,'different-branch insulin list denied');
select throws_ok($$select public.mutate_body_assessment(
 'd0500000-0000-4000-8000-000000000001','d0600000-0000-4000-8000-000000000001',
 '{"action":"sign"}',gen_random_uuid())$$,
 '42501',null,'AAL1 cannot bypass protected body signature');
select throws_ok($$select public.mutate_abcd_assessment(
 'd0500000-0000-4000-8000-000000000001','d0600000-0000-4000-8000-000000000001',
 'save_assessment','{}',gen_random_uuid())$$,
 '42501',null,'AAL1 cannot bypass protected ABCD mutation');
select throws_ok($$select public.mutate_behavior_event(
 'd0500000-0000-4000-8000-000000000001','d0600000-0000-4000-8000-000000000001',
 'create','{}',gen_random_uuid())$$,
 '42501',null,'AAL1 cannot bypass protected behavior mutation');
select throws_ok($$select public.client_inspection_report_snapshot(
 'd0500000-0000-4000-8000-000000000001','d0600000-0000-4000-8000-000000000001')$$,
 '42501',null,'inspection medical report remains behind original AAL2 gate');

reset role;
select set_config('request.jwt.claims','{}',true);
delete from public.role_permissions where role_id='10000000-0000-4000-8000-000000000003'
 and permission_id=(select id from public.permissions where permission_key='clients.view_all');
insert into auth.users(id,aud,role,email,email_confirmed_at,created_at,updated_at)
values('d0100000-0000-4000-8000-000000000003','authenticated','authenticated',
 'approver@care.example.invalid',now()-interval '1 day',now()-interval '1 day',now());
insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,
 idempotency_key,issued_jwt_iat,created_at,expires_at,consumed_at,
 consumed_jwt_iat,factor_method,factor_verified_at)
values('d0a00000-0000-4000-8000-000000000001',
 'd0100000-0000-4000-8000-000000000003',
 'd0a00000-0000-4000-8000-000000000002',repeat('9',64),
 'd0a00000-0000-4000-8000-000000000003',now()-interval '3 minutes',
 now()-interval '2 minutes',now()+interval '5 minutes',now()-interval '1 minute',
 now()-interval '1 minute','totp',now()-interval '1 minute');
insert into public.insulin_governance_versions(id,organization_id,branch_id,
 version,status,effective_from,dose_unit,dose_min_text,dose_max_text,
 early_window_minutes,late_after_minutes,executor_role_keys,reviewer_role_keys,
 supervisor_role_keys,executor_certificate_types,reviewer_certificate_types,
 supervisor_certificate_types,published_at,published_by,content_hash)
values('d0b00000-0000-4000-8000-000000000001',
 'd0500000-0000-4000-8000-000000000001',
 'd0600000-0000-4000-8000-000000000001',1,'published',now()-interval '3 days',
 'U','1','100',15,60,array['nurse'],array['nurse'],array['branch_supervisor'],
 array['insulin_executor'],array['insulin_reviewer'],array['insulin_supervisor'],
 now()-interval '3 days','d0100000-0000-4000-8000-000000000001',repeat('a',64));
insert into public.medication_plans(id,organization_id,branch_id,client_id,
 record_key,version,medication_name,dose,dose_unit,route,schedule,high_risk,
 effective_from,effective_to,status,source_system,signed_at,signed_by,
 content_hash,created_by,workflow_version,workflow_state,medication_key,
 schedule_key,row_version,submitted_at,submitted_by,approved_at,approved_by,
 approval_reauth_challenge_id,approval_signature_purpose)
values('d0c00000-0000-4000-8000-000000000001',
 'd0500000-0000-4000-8000-000000000001',
 'd0600000-0000-4000-8000-000000000001',
 'd0800000-0000-4000-8000-000000000002',
 'd0c00000-0000-4000-8000-000000000002',1,'Synthetic unassigned insulin',10,
 'U','subcutaneous','{"times":["12:00"]}'::jsonb,true,
 now()-interval '2 days',now()+interval '2 days','active','local',
 now()-interval '1 day','d0100000-0000-4000-8000-000000000003',
 repeat('b',64),'d0100000-0000-4000-8000-000000000001',2,'approved',
 'synthetic-insulin',repeat('c',64),3,now()-interval '2 days',
 'd0100000-0000-4000-8000-000000000001',now()-interval '1 day',
 'd0100000-0000-4000-8000-000000000003',
 'd0a00000-0000-4000-8000-000000000001','用藥計畫獨立核准簽署');
insert into public.insulin_plan_designations(id,organization_id,branch_id,
 client_id,medication_plan_id,governance_version_id,designation_kind,
 evidence_source,published_at,published_by,content_hash)
values('d0d00000-0000-4000-8000-000000000001',
 'd0500000-0000-4000-8000-000000000001',
 'd0600000-0000-4000-8000-000000000001',
 'd0800000-0000-4000-8000-000000000002',
 'd0c00000-0000-4000-8000-000000000001',
 'd0b00000-0000-4000-8000-000000000001','insulin',
 'manual_governed',now()-interval '1 day',
 'd0100000-0000-4000-8000-000000000001',repeat('d',64));
set local role authenticated;
select pg_temp.aal1_claims();
select is((select count(*)::integer from public.client_master_snapshot(
 'd0500000-0000-4000-8000-000000000001','d0600000-0000-4000-8000-000000000001','view')),1,
 'without view-all, case master shows only the active assignment');
select is(public.has_google_assessment_draft_access(
 'd0500000-0000-4000-8000-000000000001','d0600000-0000-4000-8000-000000000001',
 'body','d0800000-0000-4000-8000-000000000002'),false,
 'draft preflight rejects an unassigned same-branch client');
select is((select client_total::integer from public.body_assessment_snapshot(
 'd0500000-0000-4000-8000-000000000001','d0600000-0000-4000-8000-000000000001')),1,
 'body client selector hides unassigned same-branch client');
select is((select client_total::integer from public.abcd_assessment_snapshot(
 'd0500000-0000-4000-8000-000000000001','d0600000-0000-4000-8000-000000000001')),1,
 'ABCD client selector hides unassigned same-branch client');
select is((select client_total::integer from public.behavior_event_snapshot(
 'd0500000-0000-4000-8000-000000000001','d0600000-0000-4000-8000-000000000001')),1,
 'behavior client selector hides unassigned same-branch client');
select is((select plan_designation_status from public.insulin_administration_snapshot(
 'd0500000-0000-4000-8000-000000000001','d0600000-0000-4000-8000-000000000001',current_date)),
 'restricted','AAL1 does not reveal real designation for unassigned client');
select ok((select matching_total=0 and items='[]'::jsonb
 from public.insulin_administration_snapshot(
 'd0500000-0000-4000-8000-000000000001','d0600000-0000-4000-8000-000000000001',current_date)),
 'AAL1 insulin list excludes unassigned client despite real designated plan');
reset role;
select set_config('request.jwt.claims','{}',true);
select is((select bool_and(metadata->>'designation_configured' is null)
  from public.audit_events where actor_user_id='d0100000-0000-4000-8000-000000000001'
    and action='select' and table_name='insulin_administration_snapshot'),true,
 'AAL1 audit metadata also does not disclose all-branch insulin designation');
set local role authenticated;
select pg_temp.aal1_claims();
insert into approved_drafts(kind,receipt)
select 'body',to_jsonb(result) from public.mutate_body_assessment(
 'd0500000-0000-4000-8000-000000000001','d0600000-0000-4000-8000-000000000001',
 pg_temp.body_draft('d0800000-0000-4000-8000-000000000001'),
 'd0900000-0000-4000-8000-000000000001') result;
select is((select receipt->>'record_state' from approved_drafts where kind='body'),'draft',
 'approved Google AAL1 can persist unsigned body draft');
select is((select replayed from public.mutate_body_assessment(
 'd0500000-0000-4000-8000-000000000001','d0600000-0000-4000-8000-000000000001',
 pg_temp.body_draft('d0800000-0000-4000-8000-000000000001'),
 'd0900000-0000-4000-8000-000000000001')),true,'body draft replay is idempotent');
select is((select record_state from public.mutate_body_assessment(
 'd0500000-0000-4000-8000-000000000001','d0600000-0000-4000-8000-000000000001',
 pg_temp.body_draft('d0800000-0000-4000-8000-000000000001',
  (select receipt from approved_drafts where kind='body')),
 'd0900000-0000-4000-8000-000000000002')),'draft','AAL1 can revise an unsigned body draft');
insert into approved_drafts(kind,receipt)
select 'abcd',to_jsonb(result) from public.mutate_abcd_assessment(
 'd0500000-0000-4000-8000-000000000001','d0600000-0000-4000-8000-000000000001',
 'save_assessment',pg_temp.abcd_draft('d0800000-0000-4000-8000-000000000001'),
 'd0900000-0000-4000-8000-000000000003') result;
select is((select receipt->>'assessment_state' from approved_drafts where kind='abcd'),'draft',
 'approved Google AAL1 can persist unsigned ABCD candidate draft');
select is((select replayed from public.mutate_abcd_assessment(
 'd0500000-0000-4000-8000-000000000001','d0600000-0000-4000-8000-000000000001',
 'save_assessment',pg_temp.abcd_draft('d0800000-0000-4000-8000-000000000001'),
 'd0900000-0000-4000-8000-000000000003')),true,'ABCD candidate replay is idempotent');
select is((select assessment_state from public.mutate_abcd_assessment(
 'd0500000-0000-4000-8000-000000000001','d0600000-0000-4000-8000-000000000001',
 'save_assessment',pg_temp.abcd_draft('d0800000-0000-4000-8000-000000000001',
  (select receipt from approved_drafts where kind='abcd')),
 'd0900000-0000-4000-8000-000000000004')),'draft','AAL1 can revise an unsigned ABCD candidate');
insert into approved_drafts(kind,receipt)
select 'behavior',to_jsonb(result) from public.mutate_behavior_event(
 'd0500000-0000-4000-8000-000000000001','d0600000-0000-4000-8000-000000000001',
 'save_event',pg_temp.behavior_draft('d0800000-0000-4000-8000-000000000001'),
 'd0900000-0000-4000-8000-000000000005') result;
select is((select receipt->>'event_state' from approved_drafts where kind='behavior'),'draft',
 'approved Google AAL1 can persist unsigned behavior draft');
select is((select replayed from public.mutate_behavior_event(
 'd0500000-0000-4000-8000-000000000001','d0600000-0000-4000-8000-000000000001',
 'save_event',pg_temp.behavior_draft('d0800000-0000-4000-8000-000000000001'),
 'd0900000-0000-4000-8000-000000000005')),true,'behavior draft replay is idempotent');
select is((select event_state from public.mutate_behavior_event(
 'd0500000-0000-4000-8000-000000000001','d0600000-0000-4000-8000-000000000001',
 'save_event',pg_temp.behavior_draft('d0800000-0000-4000-8000-000000000001',
  (select receipt from approved_drafts where kind='behavior')),
 'd0900000-0000-4000-8000-000000000006')),'draft','AAL1 can revise an unsigned behavior event');
select throws_ok($$select public.mutate_body_assessment(
 'd0500000-0000-4000-8000-000000000001','d0600000-0000-4000-8000-000000000001',
 pg_temp.body_draft('d0800000-0000-4000-8000-000000000002'),
 'd0900000-0000-4000-8000-000000000007')$$,
 '42501',null,'AAL1 body draft cannot target unassigned client');
select throws_ok($$select public.mutate_abcd_assessment(
 'd0500000-0000-4000-8000-000000000001','d0600000-0000-4000-8000-000000000001',
 'save_assessment',pg_temp.abcd_draft('d0800000-0000-4000-8000-000000000002'),
 'd0900000-0000-4000-8000-000000000008')$$,
 '42501',null,'AAL1 ABCD draft cannot target unassigned client');
select throws_ok($$select public.mutate_behavior_event(
 'd0500000-0000-4000-8000-000000000001','d0600000-0000-4000-8000-000000000001',
 'save_event',pg_temp.behavior_draft('d0800000-0000-4000-8000-000000000002'),
 'd0900000-0000-4000-8000-000000000009')$$,
 '42501',null,'AAL1 behavior draft cannot target unassigned client');
select throws_ok($$select public.mutate_body_assessment(
 'd0500000-0000-4000-8000-000000000001','d0600000-0000-4000-8000-000000000001',
 '{"action":"correct"}',gen_random_uuid())$$,
 '42501',null,'AAL1 body correction stays behind AAL2');
select throws_ok($$select public.mutate_abcd_assessment(
 'd0500000-0000-4000-8000-000000000001','d0600000-0000-4000-8000-000000000001',
 'sign_assessment',(select jsonb_build_object('client_id','d0800000-0000-4000-8000-000000000001',
   'assessment_key',receipt->'assessment_key','previous_version_id',receipt->'version_id',
   'expected_version',(receipt->>'version')::integer,'expected_content_hash',receipt->'content_hash',
   'assessment_type','A','assessment_year',extract(year from now() at time zone 'Asia/Taipei')::integer)
   from approved_drafts where kind='abcd'),gen_random_uuid())$$,
 '42501',null,'AAL1 ABCD signature requires a real AAL2 factor');
select throws_ok($$select public.mutate_abcd_assessment(
 'd0500000-0000-4000-8000-000000000001','d0600000-0000-4000-8000-000000000001',
 'correct_assessment',(select jsonb_build_object('client_id','d0800000-0000-4000-8000-000000000001',
   'assessment_key',receipt->'assessment_key','previous_version_id',receipt->'version_id',
   'expected_version',(receipt->>'version')::integer,'expected_content_hash',receipt->'content_hash',
   'assessment_type','A','assessment_year',extract(year from now() at time zone 'Asia/Taipei')::integer,
   'assessment_date',(now() at time zone 'Asia/Taipei')::date,
   'manual_summary','合成更正摘要',
   'result',jsonb_build_object('state','missing','text',null,'reason','尚未記錄'),
   'reassessment',jsonb_build_object('state','missing','date',null,'basis','尚未指定'),
   'reason','合成更正理由至少八字') from approved_drafts where kind='abcd'),gen_random_uuid())$$,
 '42501',null,'AAL1 ABCD correction requires a real AAL2 factor');
select throws_ok($$select public.mutate_behavior_event(
 'd0500000-0000-4000-8000-000000000001','d0600000-0000-4000-8000-000000000001',
 'finalize_event','{}',gen_random_uuid())$$,
 '42501',null,'AAL1 behavior signature/void remains behind AAL2');
select throws_ok($$select public.mutate_behavior_event(
 'd0500000-0000-4000-8000-000000000001','d0600000-0000-4000-8000-000000000001',
 'correct_event','{}',gen_random_uuid())$$,
 '42501',null,'AAL1 behavior correction remains behind AAL2');
select throws_ok($$select public.body_assessment_snapshot(
 'd0500000-0000-4000-8000-000000000001','d0600000-0000-4000-8000-000000000001',
 'd0800000-0000-4000-8000-000000000002')$$,
 '42501',null,'direct body URL cannot address unassigned client');
select throws_ok($$select public.abcd_assessment_snapshot(
 'd0500000-0000-4000-8000-000000000001','d0600000-0000-4000-8000-000000000001',
 'd0800000-0000-4000-8000-000000000002')$$,
 '42501',null,'direct ABCD URL cannot address unassigned client');
select throws_ok($$select public.behavior_event_snapshot(
 'd0500000-0000-4000-8000-000000000001','d0600000-0000-4000-8000-000000000001',
 null,null,'d0800000-0000-4000-8000-000000000002')$$,
 '42501',null,'direct behavior URL cannot address unassigned client');
reset role;
select set_config('request.jwt.claims','{}',true);
insert into public.memberships(id,organization_id,branch_id,profile_id,status,starts_at)
values('d0700000-0000-4000-8000-000000000004',
 'd0500000-0000-4000-8000-000000000001',
 'd0600000-0000-4000-8000-000000000002',
 'd0100000-0000-4000-8000-000000000001','active',now()-interval '1 day');
insert into public.membership_roles(membership_id,role_id)
values('d0700000-0000-4000-8000-000000000004',
 '10000000-0000-4000-8000-000000000003');
insert into public.client_assignments(organization_id,branch_id,client_id,
 assignee_user_id,assignment_kind,starts_at)
values('d0500000-0000-4000-8000-000000000001',
 'd0600000-0000-4000-8000-000000000002',
 'd0800000-0000-4000-8000-000000000003',
 'd0100000-0000-4000-8000-000000000001',
 'synthetic_second_branch',now()-interval '1 day');
set local role authenticated;
select pg_temp.aal1_claims();
select is(public.has_google_assessment_draft_access(
 'd0500000-0000-4000-8000-000000000001','d0600000-0000-4000-8000-000000000001',
 'body','d0800000-0000-4000-8000-000000000003'),false,
 'dual-branch staff cannot preflight second-branch client through first branch');
select is(public.has_google_assessment_draft_access(
 'd0500000-0000-4000-8000-000000000001','d0600000-0000-4000-8000-000000000002',
 'body','d0800000-0000-4000-8000-000000000003'),true,
 'dual-branch staff may preflight the assigned client in the exact second branch');
reset role;
select set_config('request.jwt.claims','{}',true);
insert into auth.sessions(id,user_id,created_at,aal)
values('d0300000-0000-4000-8000-000000000004',
 'd0100000-0000-4000-8000-000000000001',now()-interval '3 minutes','aal2');
insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method)
select gen_random_uuid(),'d0300000-0000-4000-8000-000000000004',
 to_timestamp(current_setting('test.aal1_amr')::bigint),
 to_timestamp(current_setting('test.aal1_amr')::bigint),method
from (values('oauth'),('totp')) factor(method);
insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,
 idempotency_key,issued_jwt_iat,created_at,expires_at,consumed_at,
 consumed_jwt_iat,factor_method,factor_verified_at)
values('d0e00000-0000-4000-8000-000000000001',
 'd0100000-0000-4000-8000-000000000001',
 'd0300000-0000-4000-8000-000000000004',repeat('e',64),
 'd0e00000-0000-4000-8000-000000000002',now()-interval '3 minutes',
 now()-interval '2 minutes',now()+interval '5 minutes',now()-interval '30 seconds',
 now()-interval '30 seconds','totp',now()-interval '30 seconds');
insert into private.reauth_events(user_id,session_id,challenge_id,aal,
 verification_method,verified_at)
values('d0100000-0000-4000-8000-000000000001',
 'd0300000-0000-4000-8000-000000000004',
 'd0e00000-0000-4000-8000-000000000001','aal2','totp',now()-interval '30 seconds');
create function pg_temp.staff_aal2_claims() returns boolean language plpgsql security invoker as $$
begin
 perform set_config('request.jwt.claims',jsonb_build_object(
  'sub','d0100000-0000-4000-8000-000000000001',
  'session_id','d0300000-0000-4000-8000-000000000004',
  'aud','authenticated','role','authenticated','aal','aal2',
  'email','nurse@care.example.invalid','is_anonymous',false,
  'iat',floor(extract(epoch from clock_timestamp())),
  'exp',floor(extract(epoch from clock_timestamp()+interval '30 minutes')),
  'amr',jsonb_build_array(
    jsonb_build_object('method','oauth','timestamp',current_setting('test.aal1_amr')::bigint),
    jsonb_build_object('method','totp','timestamp',current_setting('test.aal1_amr')::bigint)))::text,true);
 return public.is_staff_login_allowed();
end; $$;
set local role authenticated;
select is(pg_temp.staff_aal2_claims(),true,'approved non-executive Google staff may upgrade to AAL2');
select is(public.has_recent_body_assessment_aal2(
 'd0500000-0000-4000-8000-000000000001','d0600000-0000-4000-8000-000000000001'),true,
 'approved staff with live body signer permission and same-session challenge passes body-only preflight');
select is((select client_total::integer from public.body_assessment_snapshot(
 'd0500000-0000-4000-8000-000000000001','d0600000-0000-4000-8000-000000000001')),1,
 'approved staff AAL2 retains assigned-client body read');
insert into approved_drafts(kind,receipt)
select 'body-aal2',to_jsonb(result) from public.mutate_body_assessment(
 'd0500000-0000-4000-8000-000000000001','d0600000-0000-4000-8000-000000000001',
 pg_temp.body_draft('d0800000-0000-4000-8000-000000000001'),
 'd0900000-0000-4000-8000-000000000010') result;
select is((select receipt->>'record_state' from approved_drafts where kind='body-aal2'),'draft',
 'approved staff AAL2 may save an assigned body draft');
select is((select record_state from public.mutate_body_assessment(
 'd0500000-0000-4000-8000-000000000001','d0600000-0000-4000-8000-000000000001',
 (select jsonb_build_object('action','sign',
   'client_id','d0800000-0000-4000-8000-000000000001',
   'assessment_key',receipt->'assessment_key',
   'previous_version_id',receipt->'version_id',
   'expected_version',(receipt->>'version')::integer,
   'expected_content_hash',receipt->'content_hash',
   'reason','本人確認已核對所選部位的人工觀察與處置')
   from approved_drafts where kind='body-aal2'),
 'd0900000-0000-4000-8000-000000000011')),'signed',
 'approved staff with recent same-session AAL2 can sign own completed body draft');
insert into approved_drafts(kind,receipt)
select 'body-aal2-future',to_jsonb(result) from public.mutate_body_assessment(
 'd0500000-0000-4000-8000-000000000001','d0600000-0000-4000-8000-000000000001',
 pg_temp.body_draft('d0800000-0000-4000-8000-000000000001'),
 'd0900000-0000-4000-8000-000000000012') result;
reset role;
select set_config('request.jwt.claims','{}',true);
update public.role_permissions set granted_at=now()+interval '1 day'
where role_id='10000000-0000-4000-8000-000000000003'
  and permission_id=(select id from public.permissions
    where permission_key='body_assessments.read');
set local role authenticated;
select pg_temp.staff_aal2_claims();
select throws_ok($$select public.body_assessment_snapshot(
 'd0500000-0000-4000-8000-000000000001','d0600000-0000-4000-8000-000000000001')$$,
 '42501',null,'future-dated body read grant does not admit AAL2 staff early');
reset role;
select set_config('request.jwt.claims','{}',true);
update public.role_permissions set granted_at=now()-interval '1 day'
where role_id='10000000-0000-4000-8000-000000000003'
  and permission_id=(select id from public.permissions
    where permission_key='body_assessments.read');
update public.role_permissions set granted_at=now()+interval '1 day'
where role_id='10000000-0000-4000-8000-000000000003'
  and permission_id=(select id from public.permissions
    where permission_key='body_assessments.sign');
set local role authenticated;
select pg_temp.staff_aal2_claims();
select is(public.has_recent_body_assessment_aal2(
 'd0500000-0000-4000-8000-000000000001','d0600000-0000-4000-8000-000000000001'),false,
 'future-dated body sign grant closes body-only signer preflight');
select throws_ok($$select public.mutate_body_assessment(
 'd0500000-0000-4000-8000-000000000001','d0600000-0000-4000-8000-000000000001',
 (select jsonb_build_object('action','sign',
   'client_id','d0800000-0000-4000-8000-000000000001',
   'assessment_key',receipt->'assessment_key',
   'previous_version_id',receipt->'version_id',
   'expected_version',(receipt->>'version')::integer,
   'expected_content_hash',receipt->'content_hash',
   'reason','合成預排授權不可提前簽署')
   from approved_drafts where kind='body-aal2-future'),
 'd0900000-0000-4000-8000-000000000013')$$,
 '42501',null,'future-dated body sign grant does not admit AAL2 staff early');
reset role;
select set_config('request.jwt.claims','{}',true);
update public.role_permissions set granted_at=now()-interval '1 day'
where role_id='10000000-0000-4000-8000-000000000003'
  and permission_id=(select id from public.permissions
    where permission_key='body_assessments.sign');
update public.membership_roles set assigned_at=now()+interval '1 day'
where membership_id='d0700000-0000-4000-8000-000000000001'
  and role_id='10000000-0000-4000-8000-000000000003';
set local role authenticated;
select pg_temp.staff_aal2_claims();
select is(public.has_recent_body_assessment_aal2(
 'd0500000-0000-4000-8000-000000000001','d0600000-0000-4000-8000-000000000001'),false,
 'future-dated role assignment closes body-only signer preflight');
select throws_ok($$select public.body_assessment_snapshot(
 'd0500000-0000-4000-8000-000000000001','d0600000-0000-4000-8000-000000000001')$$,
 '42501',null,'future-dated role assignment does not admit AAL2 staff early');
reset role;
select set_config('request.jwt.claims','{}',true);
update public.membership_roles set assigned_at=now()-interval '1 day'
where membership_id='d0700000-0000-4000-8000-000000000001'
  and role_id='10000000-0000-4000-8000-000000000003';
update private.staff_google_access_grants set enabled=false
where allowed_user_id='d0100000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.aal1_claims();
select throws_ok($$select public.body_assessment_snapshot(
 'd0500000-0000-4000-8000-000000000001','d0600000-0000-4000-8000-000000000001')$$,
 '42501',null,'revoked Google approval immediately closes clinical read');
select pg_temp.staff_aal2_claims();
select is(public.has_recent_body_assessment_aal2(
 'd0500000-0000-4000-8000-000000000001','d0600000-0000-4000-8000-000000000001'),false,
 'revoked staff Google approval closes body-only signer preflight');
select throws_ok($$select public.body_assessment_snapshot(
 'd0500000-0000-4000-8000-000000000001','d0600000-0000-4000-8000-000000000001')$$,
 '42501',null,'revoked staff Google grant also closes AAL2 body read');
reset role;
select set_config('request.jwt.claims','{}',true);
-- Separately test an owner-pinned executive with a global organization-manager
-- membership and no routine staff grant.
insert into auth.users(id,aud,role,email,email_confirmed_at,created_at,updated_at)
values('d0100000-0000-4000-8000-000000000002','authenticated','authenticated',
 'owner@care.example.invalid',now()-interval '1 day',now()-interval '1 day',now());
insert into auth.identities(id,provider_id,user_id,identity_data,provider)
values('d0200000-0000-4000-8000-000000000002','synthetic-clinical-owner',
 'd0100000-0000-4000-8000-000000000002',
 '{"sub":"synthetic-clinical-owner","email":"owner@care.example.invalid","email_verified":true,"hd":"care.example.invalid"}','google');
insert into auth.sessions(id,user_id,created_at,aal)
values('d0300000-0000-4000-8000-000000000002','d0100000-0000-4000-8000-000000000002',now()-interval '3 minutes','aal1');
insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method)
values(gen_random_uuid(),'d0300000-0000-4000-8000-000000000002',
 to_timestamp(current_setting('test.aal1_amr')::bigint),
 to_timestamp(current_setting('test.aal1_amr')::bigint),'oauth');
insert into public.profiles(id,display_name,kind)
values('d0100000-0000-4000-8000-000000000002','Synthetic owner','staff');
insert into public.memberships(id,organization_id,profile_id,status,starts_at)
values('d0700000-0000-4000-8000-000000000002','d0500000-0000-4000-8000-000000000001',
 'd0100000-0000-4000-8000-000000000002','active',now()-interval '1 day');
insert into public.membership_roles(membership_id,role_id)
values('d0700000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002');
insert into private.executive_access_policy(
 allowed_user_id,allowed_email,google_subject,enabled,approval_reference)
values('d0100000-0000-4000-8000-000000000002','owner@care.example.invalid',
 'synthetic-clinical-owner',true,'Synthetic pinned executive approval');
create function pg_temp.executive_aal1_claims() returns boolean language plpgsql security invoker as $$
begin
 perform set_config('request.jwt.claims',jsonb_build_object(
  'sub','d0100000-0000-4000-8000-000000000002',
  'session_id','d0300000-0000-4000-8000-000000000002',
  'aud','authenticated','role','authenticated','aal','aal1',
  'email','owner@care.example.invalid','is_anonymous',false,
  'iat',floor(extract(epoch from clock_timestamp())),
  'exp',floor(extract(epoch from clock_timestamp()+interval '30 minutes')),
  'amr',jsonb_build_array(jsonb_build_object('method','oauth',
    'timestamp',current_setting('test.aal1_amr')::bigint)))::text,true);
 return public.is_staff_login_allowed();
end; $$;
set local role authenticated;
select is(pg_temp.executive_aal1_claims(),true,'owner-pinned executive AAL1 enters without staff grant');
select is(private.is_active_user(),false,'executive AAL1 still cannot use general AAL2 root');
select is((select count(*)::integer from public.client_master_snapshot(
 'd0500000-0000-4000-8000-000000000001','d0600000-0000-4000-8000-000000000002','view')),1,
 'global executive can read another authorized branch case master');
select is((select client_total::integer from public.body_assessment_snapshot(
 'd0500000-0000-4000-8000-000000000001','d0600000-0000-4000-8000-000000000002')),1,
 'global executive can read authorized second branch body list');
select is((select client_total::integer from public.abcd_assessment_snapshot(
 'd0500000-0000-4000-8000-000000000001','d0600000-0000-4000-8000-000000000002')),1,
 'global executive can read authorized second branch ABCD list');
select is((select client_total::integer from public.behavior_event_snapshot(
 'd0500000-0000-4000-8000-000000000001','d0600000-0000-4000-8000-000000000002')),1,
 'global executive can read authorized second branch behavior list');
select throws_ok($$select public.body_assessment_snapshot(
 'd0500000-0000-4000-8000-000000000002','d0600000-0000-4000-8000-000000000003')$$,
 '42501',null,'global executive still cannot cross organization');
reset role;
select set_config('request.jwt.claims','{}',true);
insert into auth.sessions(id,user_id,created_at,aal)
values('d0300000-0000-4000-8000-000000000003','d0100000-0000-4000-8000-000000000002',now()-interval '3 minutes','aal2');
insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method)
select gen_random_uuid(),'d0300000-0000-4000-8000-000000000003',
 to_timestamp(current_setting('test.aal1_amr')::bigint),
 to_timestamp(current_setting('test.aal1_amr')::bigint),method
from (values('oauth'),('totp')) factor(method);
delete from public.role_permissions where role_id='10000000-0000-4000-8000-000000000002'
 and permission_id=(select id from public.permissions where permission_key='clients.read');
create function pg_temp.executive_aal2_claims() returns boolean language plpgsql security invoker as $$
begin
 perform set_config('request.jwt.claims',jsonb_build_object(
  'sub','d0100000-0000-4000-8000-000000000002',
  'session_id','d0300000-0000-4000-8000-000000000003',
  'aud','authenticated','role','authenticated','aal','aal2',
  'email','owner@care.example.invalid','is_anonymous',false,
  'iat',floor(extract(epoch from clock_timestamp())),
  'exp',floor(extract(epoch from clock_timestamp()+interval '30 minutes')),
  'amr',jsonb_build_array(
    jsonb_build_object('method','oauth','timestamp',current_setting('test.aal1_amr')::bigint),
    jsonb_build_object('method','totp','timestamp',current_setting('test.aal1_amr')::bigint)))::text,true);
 return public.is_staff_login_allowed();
end; $$;
set local role authenticated;
select is(pg_temp.executive_aal2_claims(),true,'AAL2 executive remains admitted with narrow role permission removed');
select throws_ok($$select public.abcd_assessment_snapshot(
 'd0500000-0000-4000-8000-000000000001','d0600000-0000-4000-8000-000000000001',
 'd0800000-0000-4000-8000-000000000001')$$,
 '42501',null,'AAL2 ABCD client read still requires independently granted clients.read');
select throws_ok($$select public.behavior_event_snapshot(
 'd0500000-0000-4000-8000-000000000001','d0600000-0000-4000-8000-000000000001',
 null,null,'d0800000-0000-4000-8000-000000000001')$$,
 '42501',null,'AAL2 behavior client read still requires independently granted clients.read');
reset role;
select set_config('request.jwt.claims','{}',true);
update private.executive_access_policy set enabled=false;
set local role authenticated;
select pg_temp.executive_aal1_claims();
select throws_ok($$select public.body_assessment_snapshot(
 'd0500000-0000-4000-8000-000000000001','d0600000-0000-4000-8000-000000000001')$$,
 '42501',null,'disabled executive policy immediately closes clinical read');
select pg_temp.executive_aal2_claims();
select throws_ok($$select public.body_assessment_snapshot(
 'd0500000-0000-4000-8000-000000000001','d0600000-0000-4000-8000-000000000001')$$,
 '42501',null,'disabled executive policy immediately closes AAL2 body read too');
select * from finish();
rollback;
