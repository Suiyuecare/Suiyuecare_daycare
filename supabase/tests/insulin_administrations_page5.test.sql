begin;

select plan(46);

select results_eq(
  $$select permission_key collate "C" from public.permissions where permission_key like 'insulin_administrations.%' order by permission_key collate "C"$$,
  $$values
    ('insulin_administrations.authorize_late'::text collate "C"),
    ('insulin_administrations.execute'::text collate "C"),
    ('insulin_administrations.read'::text collate "C"),
    ('insulin_administrations.verify'::text collate "C")$$,
  'Page 5 exposes four narrow permissions'
);

select ok((select bool_and(relrowsecurity and relforcerowsecurity)
  from pg_class where oid in (
    'public.insulin_governance_versions'::regclass,
    'public.insulin_plan_designations'::regclass,
    'public.insulin_administration_events'::regclass,
    'private.insulin_administration_operations'::regclass
  )), 'all Page 5 governance and evidence ledgers force RLS');

select ok(
  not has_table_privilege('authenticated','public.insulin_governance_versions','select,insert,update,delete')
  and not has_table_privilege('authenticated','public.insulin_plan_designations','select,insert,update,delete')
  and not has_table_privilege('authenticated','public.insulin_administration_events','select,insert,update,delete')
  and not has_table_privilege('service_role','public.insulin_administration_events','select,insert,update,delete')
  and not has_table_privilege('authenticated','private.insulin_administration_operations','select,insert,update,delete'),
  'browser and service roles cannot bypass Page 5 RPCs'
);

select ok(
  has_function_privilege('authenticated','public.mutate_insulin_administration(uuid,uuid,text,uuid,uuid,integer,uuid,timestamptz,text,text,text,text,text,uuid)','execute')
  and has_function_privilege('authenticated','public.insulin_administration_snapshot(uuid,uuid,date,text,uuid,text)','execute')
  and not has_function_privilege('anon','public.insulin_administration_snapshot(uuid,uuid,date,text,uuid,text)','execute')
  and not has_function_privilege('service_role','public.mutate_insulin_administration(uuid,uuid,text,uuid,uuid,integer,uuid,timestamptz,text,text,text,text,text,uuid)','execute'),
  'only authenticated callers receive the Page 5 RPC surface'
);

select ok(
  not (select prosecdef from pg_proc where oid='public.mutate_insulin_administration(uuid,uuid,text,uuid,uuid,integer,uuid,timestamptz,text,text,text,text,text,uuid)'::regprocedure)
  and not (select prosecdef from pg_proc where oid='public.insulin_administration_snapshot(uuid,uuid,date,text,uuid,text)'::regprocedure)
  and (select prosecdef and coalesce(proconfig,'{}'::text[]) @> array['search_path=""']
    from pg_proc where oid='private.mutate_insulin_administration_guarded(uuid,uuid,text,uuid,uuid,integer,uuid,timestamptz,text,text,text,text,text,uuid)'::regprocedure)
  and (select prosecdef and coalesce(proconfig,'{}'::text[]) @> array['search_path=""']
    from pg_proc where oid='private.insulin_administration_snapshot_response(uuid,uuid,date,text,uuid,text)'::regprocedure),
  'public wrappers are invokers and private cores are pinned definers'
);

select ok(
  exists (select 1 from pg_trigger where not tgisinternal and tgname='insulin_governance_versions_prevent_mutation')
  and exists (select 1 from pg_trigger where not tgisinternal and tgname='insulin_plan_designations_prevent_mutation')
  and exists (select 1 from pg_trigger where not tgisinternal and tgname='insulin_administration_events_prevent_mutation')
  and exists (select 1 from pg_trigger where not tgisinternal and tgname='insulin_administration_operations_prevent_mutation')
  and exists (select 1 from pg_trigger where not tgisinternal and tgname='insulin_governance_versions_audit_row_change')
  and exists (select 1 from pg_trigger where not tgisinternal and tgname='insulin_plan_designations_audit_row_change')
  and exists (select 1 from pg_trigger where not tgisinternal and tgname='insulin_administration_events_audit_row_change'),
  'Page 5 evidence is append-only and exact audit triggers are installed'
);

select ok(
  not has_function_privilege('public','private.require_insulin_reauth(uuid,timestamptz)','execute')
  and not has_function_privilege('authenticated','private.insulin_staff_snapshot(uuid,uuid,uuid,timestamptz)','execute')
  and not has_function_privilege('authenticated','private.insulin_qualification_version(uuid,uuid,uuid,uuid,text[],timestamptz)','execute')
  and not has_function_privilege('service_role','private.insulin_plan_slot_is_valid(uuid,uuid,uuid,uuid,uuid,timestamptz)','execute'),
  'private qualification, reauthentication and plan evidence helpers are unreachable'
);

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
  ('00000000-0000-0000-0000-000000000000','05000000-0000-4000-8000-000000000101','authenticated','authenticated','page5-supervisor@example.invalid','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','05000000-0000-4000-8000-000000000102','authenticated','authenticated','page5-executor@example.invalid','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','05000000-0000-4000-8000-000000000103','authenticated','authenticated','page5-reviewer@example.invalid','',now(),'{}','{}',now(),now());
insert into public.organizations(id,code,name) values
  ('05100000-0000-4000-8000-000000000101','p5','合成胰島素測試機構');
insert into public.branches(id,organization_id,code,name) values
  ('05200000-0000-4000-8000-000000000101','05100000-0000-4000-8000-000000000101','main','合成主分支'),
  ('05200000-0000-4000-8000-000000000102','05100000-0000-4000-8000-000000000101','other','合成其他分支');
insert into public.profiles(id,display_name,kind) values
  ('05000000-0000-4000-8000-000000000101','合成督導','staff'),
  ('05000000-0000-4000-8000-000000000102','合成執行護理師','staff'),
  ('05000000-0000-4000-8000-000000000103','合成覆核護理師','staff');
insert into public.memberships(id,organization_id,branch_id,profile_id,status,starts_at) values
  ('05300000-0000-4000-8000-000000000101','05100000-0000-4000-8000-000000000101',null,'05000000-0000-4000-8000-000000000101','active',clock_timestamp()-interval '1 day'),
  ('05300000-0000-4000-8000-000000000102','05100000-0000-4000-8000-000000000101','05200000-0000-4000-8000-000000000101','05000000-0000-4000-8000-000000000102','active',clock_timestamp()-interval '1 day'),
  ('05300000-0000-4000-8000-000000000103','05100000-0000-4000-8000-000000000101','05200000-0000-4000-8000-000000000101','05000000-0000-4000-8000-000000000103','active',clock_timestamp()-interval '1 day');
insert into public.membership_roles(membership_id,role_id) values
  ('05300000-0000-4000-8000-000000000101','10000000-0000-4000-8000-000000000002'),
  ('05300000-0000-4000-8000-000000000102','10000000-0000-4000-8000-000000000005'),
  ('05300000-0000-4000-8000-000000000103','10000000-0000-4000-8000-000000000005');
insert into public.clients(id,organization_id,branch_id,client_code,display_name,status,admitted_on,source_system) values
  ('05400000-0000-4000-8000-000000000101','05100000-0000-4000-8000-000000000101','05200000-0000-4000-8000-000000000101','P5-A','合成個案甲','active',current_date-30,'test'),
  ('05400000-0000-4000-8000-000000000102','05100000-0000-4000-8000-000000000101','05200000-0000-4000-8000-000000000102','P5-B','合成個案乙','active',current_date-30,'test');
insert into public.client_assignments(id,organization_id,branch_id,client_id,assignee_user_id,assignment_kind) values
  ('05500000-0000-4000-8000-000000000101','05100000-0000-4000-8000-000000000101','05200000-0000-4000-8000-000000000101','05400000-0000-4000-8000-000000000101','05000000-0000-4000-8000-000000000102','medication'),
  ('05500000-0000-4000-8000-000000000102','05100000-0000-4000-8000-000000000101','05200000-0000-4000-8000-000000000101','05400000-0000-4000-8000-000000000101','05000000-0000-4000-8000-000000000103','medication');

insert into public.staff_certificate_versions(
  id,organization_id,branch_id,certificate_key,version,previous_version_id,
  record_status,correction_reason,staff_membership_id,staff_user_id,
  staff_display_name,staff_employee_code,certificate_type,certificate_number,
  effective_on,expires_on,registration_status,verification_status,evidence_status,
  attachment_reference,attachment_sha256,recorded_by,recorded_at,content_hash
) values
  ('05d00000-0000-4000-8000-000000000101','05100000-0000-4000-8000-000000000101','05200000-0000-4000-8000-000000000101','05d10000-0000-4000-8000-000000000101',1,null,'active',null,'05300000-0000-4000-8000-000000000101','05000000-0000-4000-8000-000000000101','合成督導',null,'insulin_supervisor','SYN-SUP-001',current_date-30,current_date+30,'registered','verified','provided','trusted-upload://synthetic/page5/supervisor',repeat('1',64),'05000000-0000-4000-8000-000000000101',clock_timestamp()-interval '1 day',repeat('a',64)),
  ('05d00000-0000-4000-8000-000000000102','05100000-0000-4000-8000-000000000101','05200000-0000-4000-8000-000000000101','05d10000-0000-4000-8000-000000000102',1,null,'active',null,'05300000-0000-4000-8000-000000000102','05000000-0000-4000-8000-000000000102','合成執行護理師',null,'insulin_executor','SYN-EXE-001',current_date-30,current_date+30,'registered','verified','provided','trusted-upload://synthetic/page5/executor',repeat('2',64),'05000000-0000-4000-8000-000000000101',clock_timestamp()-interval '1 day',repeat('b',64)),
  ('05d00000-0000-4000-8000-000000000103','05100000-0000-4000-8000-000000000101','05200000-0000-4000-8000-000000000101','05d10000-0000-4000-8000-000000000103',1,null,'active',null,'05300000-0000-4000-8000-000000000103','05000000-0000-4000-8000-000000000103','合成覆核護理師',null,'insulin_reviewer','SYN-REV-001',current_date-30,current_date+30,'registered','verified','provided','trusted-upload://synthetic/page5/reviewer',repeat('3',64),'05000000-0000-4000-8000-000000000101',clock_timestamp()-interval '1 day',repeat('c',64)),
  ('05d00000-0000-4000-8000-000000000104','05100000-0000-4000-8000-000000000101','05200000-0000-4000-8000-000000000101','05d10000-0000-4000-8000-000000000104',1,null,'active',null,'05300000-0000-4000-8000-000000000102','05000000-0000-4000-8000-000000000102','合成執行護理師',null,'insulin_reviewer','SYN-REV-SELF',current_date-30,current_date+30,'registered','verified','provided','trusted-upload://synthetic/page5/self-review-regression',repeat('4',64),'05000000-0000-4000-8000-000000000101',clock_timestamp()-interval '1 day',repeat('d',64));

select ok(
  private.insulin_qualification_version(
    '05100000-0000-4000-8000-000000000101',
    '05200000-0000-4000-8000-000000000101',
    '05300000-0000-4000-8000-000000000102',
    '05000000-0000-4000-8000-000000000102',
    array['insulin_executor'], clock_timestamp()
  ) = '05d00000-0000-4000-8000-000000000102'
  and private.insulin_qualification_version(
    '05100000-0000-4000-8000-000000000101',
    '05200000-0000-4000-8000-000000000101',
    '05300000-0000-4000-8000-000000000102',
    '05000000-0000-4000-8000-000000000103',
    array['insulin_executor'], clock_timestamp()
  ) is null,
  'terminal qualification evidence is bound to both the current membership and actor user'
);

create temporary table page5_values as select
  date_trunc('minute',clock_timestamp()) on_time,
  date_trunc('minute',clock_timestamp()) - interval '2 hours' late_time,
  date_trunc('minute',clock_timestamp()) + interval '1 minute' governed_dose_time,
  clock_timestamp() - interval '30 seconds' verified_at;
grant select on page5_values to authenticated;

insert into private.reauth_challenges(
  id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,
  created_at,expires_at,consumed_at,consumed_jwt_iat,factor_method,factor_verified_at
) select challenge_id,user_id,session_id,repeat(digit,64),idempotency_key,
  verified_at-interval '1 minute',verified_at-interval '1 minute',
  verified_at+interval '5 minutes',verified_at,verified_at,'totp',verified_at
from page5_values cross join (values
  ('05600000-0000-4000-8000-000000000101'::uuid,'05000000-0000-4000-8000-000000000101'::uuid,'05700000-0000-4000-8000-000000000101'::uuid,'05800000-0000-4000-8000-000000000101'::uuid,'1'),
  ('05600000-0000-4000-8000-000000000102'::uuid,'05000000-0000-4000-8000-000000000102'::uuid,'05700000-0000-4000-8000-000000000102'::uuid,'05800000-0000-4000-8000-000000000102'::uuid,'2'),
  ('05600000-0000-4000-8000-000000000103'::uuid,'05000000-0000-4000-8000-000000000103'::uuid,'05700000-0000-4000-8000-000000000103'::uuid,'05800000-0000-4000-8000-000000000103'::uuid,'3')
) fixture(challenge_id,user_id,session_id,idempotency_key,digit);
insert into private.reauth_events(user_id,session_id,challenge_id,aal,verification_method,verified_at)
select user_id,session_id,id,'aal2',factor_method,factor_verified_at
from private.reauth_challenges where id in (
  '05600000-0000-4000-8000-000000000101',
  '05600000-0000-4000-8000-000000000102',
  '05600000-0000-4000-8000-000000000103'
);

insert into public.medication_plans(
  id,organization_id,branch_id,client_id,record_key,version,medication_name,
  dose,dose_unit,route,schedule,high_risk,effective_from,effective_to,status,
  source_system,signed_at,signed_by,content_hash,created_by,workflow_version,
  workflow_state,medication_key,schedule_key,row_version,submitted_at,submitted_by,
  approved_at,approved_by,approval_reauth_challenge_id,approval_signature_purpose
) select id,'05100000-0000-4000-8000-000000000101',branch_id,client_id,
  record_key,1,name,dose,'U','subcutaneous',
  jsonb_build_object('times',jsonb_build_array(to_char(slot at time zone 'Asia/Taipei','HH24:MI'))),
  true,clock_timestamp()-interval '5 days',clock_timestamp()+interval '5 days','active',
  'local',clock_timestamp()-interval '1 day','05000000-0000-4000-8000-000000000103',
  content_hash,'05000000-0000-4000-8000-000000000101',2,'approved',
  medication_key,schedule_key,3,clock_timestamp()-interval '2 days',
  '05000000-0000-4000-8000-000000000101',clock_timestamp()-interval '1 day',
  '05000000-0000-4000-8000-000000000103','05600000-0000-4000-8000-000000000103',
  '用藥計畫獨立核准簽署'
from page5_values cross join lateral (values
  ('05900000-0000-4000-8000-000000000101'::uuid,'05200000-0000-4000-8000-000000000101'::uuid,'05400000-0000-4000-8000-000000000101'::uuid,'05910000-0000-4000-8000-000000000101'::uuid,'合成胰島素甲',12.5::numeric,on_time,'insulin-a',repeat('a',64),repeat('1',64)),
  ('05900000-0000-4000-8000-000000000102'::uuid,'05200000-0000-4000-8000-000000000101'::uuid,'05400000-0000-4000-8000-000000000101'::uuid,'05910000-0000-4000-8000-000000000102'::uuid,'合成胰島素乙',10::numeric,late_time,'insulin-b',repeat('b',64),repeat('2',64)),
  ('05900000-0000-4000-8000-000000000103'::uuid,'05200000-0000-4000-8000-000000000101'::uuid,'05400000-0000-4000-8000-000000000101'::uuid,'05910000-0000-4000-8000-000000000103'::uuid,'合成規則外劑量',200::numeric,governed_dose_time,'insulin-c',repeat('c',64),repeat('3',64)),
  ('05900000-0000-4000-8000-000000000104'::uuid,'05200000-0000-4000-8000-000000000102'::uuid,'05400000-0000-4000-8000-000000000102'::uuid,'05910000-0000-4000-8000-000000000104'::uuid,'合成跨分支胰島素',6::numeric,on_time,'insulin-d',repeat('d',64),repeat('4',64))
) plan(id,branch_id,client_id,record_key,name,dose,slot,medication_key,content_hash,schedule_key);

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"05000000-0000-4000-8000-000000000101","role":"authenticated","aal":"aal2","session_id":"05700000-0000-4000-8000-000000000101"}',true);
select ok((select governance_status='not_configured' and plan_designation_status='not_configured'
  and qualification_status='not_configured' and dose_rule_status='not_configured'
  and late_entry_rule_status='not_configured' and matching_total=0
  and items='[]'::jsonb and not can_execute and not can_review and not can_authorize_late
  from public.insulin_administration_snapshot(
    '05100000-0000-4000-8000-000000000101','05200000-0000-4000-8000-000000000101',
    ((select on_time from page5_values) at time zone 'Asia/Taipei')::date,'all',null,'all'
  )), 'empty governance and designation are explicitly not configured');
select throws_ok($$select * from public.mutate_insulin_administration(
  '05100000-0000-4000-8000-000000000101','05200000-0000-4000-8000-000000000101',
  'authorize_late',null,null,0,'05900000-0000-4000-8000-000000000102',
  (select late_time from page5_values),null,null,null,null,'合成逾時原因',
  '05a00000-0000-4000-8000-000000000101')$$,
  '55000','insulin qualification, dose, and late-entry governance is not configured',
  'late authorization fails closed before governance publication');
reset role;
select is((select count(*)::integer from public.insulin_administration_events),0,
  'a not-configured request writes no insulin evidence');

insert into public.insulin_governance_versions(
  id,organization_id,branch_id,version,status,effective_from,effective_to,
  dose_unit,dose_min_text,dose_max_text,early_window_minutes,late_after_minutes,
  executor_role_keys,reviewer_role_keys,supervisor_role_keys,
  executor_certificate_types,reviewer_certificate_types,supervisor_certificate_types,
  published_at,published_by,content_hash
) values (
  '05b00000-0000-4000-8000-000000000101','05100000-0000-4000-8000-000000000101',
  '05200000-0000-4000-8000-000000000101',1,'published',clock_timestamp()-interval '2 days',null,
  'U','0.1','100',15,60,array['nurse'],array['nurse'],array['organization_manager'],
  array['insulin_executor'],array['insulin_reviewer'],array['insulin_supervisor'],
  clock_timestamp()-interval '2 days','05000000-0000-4000-8000-000000000101',repeat('e',64)
);

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"05000000-0000-4000-8000-000000000102","role":"authenticated","aal":"aal2","session_id":"05700000-0000-4000-8000-000000000102"}',true);
select ok((select governance_status='published' and plan_designation_status='not_configured'
  and matching_total=0 and not can_execute and not can_review and not can_authorize_late
  from public.insulin_administration_snapshot(
    '05100000-0000-4000-8000-000000000101','05200000-0000-4000-8000-000000000101',
    ((select on_time from page5_values) at time zone 'Asia/Taipei')::date,'all',null,'all'
  )), 'published rules without governed plan designations remain fail closed');
select throws_ok($$select * from public.mutate_insulin_administration(
  '05100000-0000-4000-8000-000000000101','05200000-0000-4000-8000-000000000101',
  'execute',null,null,0,'05900000-0000-4000-8000-000000000101',
  (select on_time from page5_values),'12.5','U','LEFT_ARM','左上臂',null,
  '05a00000-0000-4000-8000-000000000102')$$,
  '23514','exactly one approved effective designated Page-8 plan is required',
  'execution without a governed designation is rejected');
reset role;

insert into public.insulin_plan_designations(
  id,organization_id,branch_id,client_id,medication_plan_id,governance_version_id,
  designation_kind,evidence_source,published_at,published_by,content_hash
) values
  ('05c00000-0000-4000-8000-000000000101','05100000-0000-4000-8000-000000000101','05200000-0000-4000-8000-000000000101','05400000-0000-4000-8000-000000000101','05900000-0000-4000-8000-000000000101','05b00000-0000-4000-8000-000000000101','insulin','manual_governed',clock_timestamp()-interval '1 day','05000000-0000-4000-8000-000000000101',repeat('5',64)),
  ('05c00000-0000-4000-8000-000000000102','05100000-0000-4000-8000-000000000101','05200000-0000-4000-8000-000000000101','05400000-0000-4000-8000-000000000101','05900000-0000-4000-8000-000000000102','05b00000-0000-4000-8000-000000000101','insulin','manual_governed',clock_timestamp()-interval '1 day','05000000-0000-4000-8000-000000000101',repeat('6',64)),
  ('05c00000-0000-4000-8000-000000000103','05100000-0000-4000-8000-000000000101','05200000-0000-4000-8000-000000000101','05400000-0000-4000-8000-000000000101','05900000-0000-4000-8000-000000000103','05b00000-0000-4000-8000-000000000101','insulin','manual_governed',clock_timestamp()-interval '1 day','05000000-0000-4000-8000-000000000101',repeat('7',64));

insert into public.insulin_governance_versions(
  id,organization_id,branch_id,version,status,effective_from,effective_to,
  dose_unit,dose_min_text,dose_max_text,early_window_minutes,late_after_minutes,
  executor_role_keys,reviewer_role_keys,supervisor_role_keys,
  executor_certificate_types,reviewer_certificate_types,supervisor_certificate_types,
  published_at,published_by,content_hash
) values (
  '05b00000-0000-4000-8000-000000000102','05100000-0000-4000-8000-000000000101',
  '05200000-0000-4000-8000-000000000101',2,'published',clock_timestamp()+interval '12 hours',null,
  'U','0.1','50',10,45,array['nurse'],array['nurse'],array['organization_manager'],
  array['insulin_executor'],array['insulin_reviewer'],array['insulin_supervisor'],
  clock_timestamp()-interval '1 day','05000000-0000-4000-8000-000000000101',repeat('9',64)
);
select is(private.insulin_plan_slot_is_valid(
  '05100000-0000-4000-8000-000000000101','05200000-0000-4000-8000-000000000101',
  '05400000-0000-4000-8000-000000000101','05900000-0000-4000-8000-000000000101',
  '05b00000-0000-4000-8000-000000000102',(select on_time from page5_values)+interval '1 day'
),false,'an old designation cannot be silently evaluated under a different governance version');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"05000000-0000-4000-8000-000000000102","role":"authenticated","aal":"aal2","session_id":"05700000-0000-4000-8000-000000000102"}',true);
select ok((select not replayed and operation_kind='execute' and state='pending_review'
  and event_sequence=1 and previous_event_id is null and executed_at is not null
  and completion_status='pending_independent_review' and qualification_status='published'
  and dose_rule_status='published' and late_entry_rule_status='published'
  and offline_status='not_configured'
  from public.mutate_insulin_administration(
    '05100000-0000-4000-8000-000000000101','05200000-0000-4000-8000-000000000101',
    'execute',null,null,0,'05900000-0000-4000-8000-000000000101',
    (select on_time from page5_values),'12.5','U','LEFT_ARM','左上臂',null,
    '05a00000-0000-4000-8000-000000000103'
  )), 'executor records exact Page-8 plan dose and receives pending-review evidence');
reset role;

select ok((select count(*)=1 and bool_and(event_kind='executed' and state='pending_review')
  and bool_and(dose_text='12.5' and dose_unit='U' and site_code='LEFT_ARM')
  and bool_and(executed_at=created_at and executor_user_id='05000000-0000-4000-8000-000000000102')
  and bool_and(executor_reauth_challenge_id='05600000-0000-4000-8000-000000000102')
  and bool_and(reviewer_user_id is null and reviewed_at is null)
  from public.insulin_administration_events where medication_plan_id='05900000-0000-4000-8000-000000000101'),
  'execution freezes exact decimal, site, server time, executor and AAL2 evidence');

create temporary table page5_on_time as select administration_key,id event_id,event_sequence
from public.insulin_administration_events where medication_plan_id='05900000-0000-4000-8000-000000000101';
grant select on page5_on_time to authenticated;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"05000000-0000-4000-8000-000000000102","role":"authenticated","aal":"aal2","session_id":"05700000-0000-4000-8000-000000000102"}',true);
select ok((select replayed and event_sequence=1 from public.mutate_insulin_administration(
  '05100000-0000-4000-8000-000000000101','05200000-0000-4000-8000-000000000101',
  'execute',null,null,0,'05900000-0000-4000-8000-000000000101',
  (select on_time from page5_values),'12.5','U','LEFT_ARM','左上臂',null,
  '05a00000-0000-4000-8000-000000000103'
)), 'exact actor-scoped retry returns the original execution receipt');
select throws_ok($$select * from public.mutate_insulin_administration(
  '05100000-0000-4000-8000-000000000101','05200000-0000-4000-8000-000000000101',
  'execute',null,null,0,'05900000-0000-4000-8000-000000000101',
  (select on_time from page5_values),'12.5','U','RIGHT_ARM','右上臂',null,
  '05a00000-0000-4000-8000-000000000103')$$,
  '23505','insulin idempotency conflict','changed evidence cannot reuse an idempotency key');
select throws_ok($$select * from public.mutate_insulin_administration(
  '05100000-0000-4000-8000-000000000101','05200000-0000-4000-8000-000000000101',
  'execute',null,null,0,'05900000-0000-4000-8000-000000000101',
  (select on_time from page5_values),'12.5','U','RIGHT_ARM','右上臂',null,
  '05a00000-0000-4000-8000-000000000104')$$,
  '23505','insulin slot already has a stream','a second execution stream for one plan slot is rejected');
select throws_ok($$select * from public.mutate_insulin_administration(
  '05100000-0000-4000-8000-000000000101','05200000-0000-4000-8000-000000000101',
  'review',(select administration_key from page5_on_time),(select event_id from page5_on_time),1,
  null,null,null,null,null,null,null,'05a00000-0000-4000-8000-000000000105')$$,
  '42501','insulin executor cannot independently review','executor cannot self-review');
reset role;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"05000000-0000-4000-8000-000000000103","role":"authenticated","aal":"aal2","session_id":"05700000-0000-4000-8000-000000000103"}',true);
select ok((select not replayed and operation_kind='review' and state='completed'
  and event_sequence=2 and previous_event_id=(select event_id from page5_on_time)
  and reviewed_at>=executed_at and completion_status='completed'
  from public.mutate_insulin_administration(
    '05100000-0000-4000-8000-000000000101','05200000-0000-4000-8000-000000000101',
    'review',(select administration_key from page5_on_time),(select event_id from page5_on_time),1,
    null,null,null,null,null,null,null,'05a00000-0000-4000-8000-000000000106'
  )), 'a different currently qualified nurse completes independent review');
select ok((select replayed and state='completed' from public.mutate_insulin_administration(
  '05100000-0000-4000-8000-000000000101','05200000-0000-4000-8000-000000000101',
  'review',(select administration_key from page5_on_time),(select event_id from page5_on_time),1,
  null,null,null,null,null,null,null,'05a00000-0000-4000-8000-000000000106'
)), 'exact reviewer retry returns the completed receipt');
select throws_ok($$select * from public.mutate_insulin_administration(
  '05100000-0000-4000-8000-000000000101','05200000-0000-4000-8000-000000000101',
  'review',(select administration_key from page5_on_time),(select event_id from page5_on_time),1,
  null,null,null,null,null,null,null,'05a00000-0000-4000-8000-000000000107')$$,
  '40001','insulin review base event is stale','stale review base is rejected');
reset role;

select ok((select count(*)=2 and min(executor_user_id::text)='05000000-0000-4000-8000-000000000102'
  and max(reviewer_user_id::text)='05000000-0000-4000-8000-000000000103'
  and bool_or(event_kind='reviewed' and reviewer_reauth_challenge_id='05600000-0000-4000-8000-000000000103')
  from public.insulin_administration_events where administration_key=(select administration_key from page5_on_time)),
  'completed chain retains distinct executor and reviewer identities and evidence');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"05000000-0000-4000-8000-000000000102","role":"authenticated","aal":"aal2","session_id":"05700000-0000-4000-8000-000000000102"}',true);
select throws_ok($$select * from public.mutate_insulin_administration(
  '05100000-0000-4000-8000-000000000101','05200000-0000-4000-8000-000000000101',
  'execute',null,null,0,'05900000-0000-4000-8000-000000000102',
  (select late_time from page5_values),'10','U','LEFT_ARM','左上臂',null,
  '05a00000-0000-4000-8000-000000000108')$$,
  '42501','late insulin execution requires supervisor authorization evidence',
  'late execution fails closed without supervisor evidence');
reset role;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"05000000-0000-4000-8000-000000000101","role":"authenticated","aal":"aal2","session_id":"05700000-0000-4000-8000-000000000101"}',true);
select ok((select not replayed and operation_kind='authorize_late' and state='late_authorized'
  and event_sequence=1 and completion_status='pending_independent_review'
  from public.mutate_insulin_administration(
    '05100000-0000-4000-8000-000000000101','05200000-0000-4000-8000-000000000101',
    'authorize_late',null,null,0,'05900000-0000-4000-8000-000000000102',
    (select late_time from page5_values),null,null,null,null,'交通延誤後由督導核准補登',
    '05a00000-0000-4000-8000-000000000109'
  )), 'supervisor appends reasoned late-entry authorization');
reset role;

select ok((select event_kind='late_authorized' and late_entry and late_reason='交通延誤後由督導核准補登'
  and late_authorizer_user_id='05000000-0000-4000-8000-000000000101'
  and late_authorizer_reauth_challenge_id='05600000-0000-4000-8000-000000000101'
  and dose_text is null and executed_at is null
  from public.insulin_administration_events where medication_plan_id='05900000-0000-4000-8000-000000000102'),
  'late authorization freezes reason, supervisor and AAL2 without claiming execution');
create temporary table page5_late as select administration_key,id event_id,event_sequence
from public.insulin_administration_events where medication_plan_id='05900000-0000-4000-8000-000000000102';
grant select on page5_late to authenticated;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"05000000-0000-4000-8000-000000000102","role":"authenticated","aal":"aal2","session_id":"05700000-0000-4000-8000-000000000102"}',true);
select ok((select state='pending_review' and event_sequence=2
  and previous_event_id=(select event_id from page5_late) and executed_at is not null
  from public.mutate_insulin_administration(
    '05100000-0000-4000-8000-000000000101','05200000-0000-4000-8000-000000000101',
    'execute',(select administration_key from page5_late),(select event_id from page5_late),1,
    '05900000-0000-4000-8000-000000000102',(select late_time from page5_values),
    '10','U','ABDOMEN_LEFT','左腹部',null,'05a00000-0000-4000-8000-000000000110'
  )), 'executor consumes a different supervisor late authorization and remains pending review');
reset role;

select ok((select event_kind='executed' and late_entry
  and late_authorizer_user_id='05000000-0000-4000-8000-000000000101'
  and executor_user_id='05000000-0000-4000-8000-000000000102'
  and late_authorizer_user_id<>executor_user_id and reviewer_user_id is null
  from public.insulin_administration_events where medication_plan_id='05900000-0000-4000-8000-000000000102'
  order by event_sequence desc limit 1),
  'late execution retains separate supervisor and executor evidence');
create temporary table page5_late_executed as select id event_id
from public.insulin_administration_events
where administration_key=(select administration_key from page5_late)
order by event_sequence desc limit 1;
grant select on page5_late_executed to authenticated;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"05000000-0000-4000-8000-000000000103","role":"authenticated","aal":"aal2","session_id":"05700000-0000-4000-8000-000000000103"}',true);
select ok((select state='completed' and event_sequence=3 and reviewed_at is not null
  from public.mutate_insulin_administration(
    '05100000-0000-4000-8000-000000000101','05200000-0000-4000-8000-000000000101',
    'review',(select administration_key from page5_late),
    (select event_id from page5_late_executed),2,
    null,null,null,null,null,null,null,'05a00000-0000-4000-8000-000000000111'
  )), 'independent reviewer completes the three-person late chain');
reset role;
select is((select count(*)::integer from public.insulin_administration_events
  where administration_key=(select administration_key from page5_late)),3,
  'late authorization, execution and review are three immutable events');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"05000000-0000-4000-8000-000000000102","role":"authenticated","aal":"aal2","session_id":"05700000-0000-4000-8000-000000000102"}',true);
select throws_ok($$select * from public.mutate_insulin_administration(
  '05100000-0000-4000-8000-000000000101','05200000-0000-4000-8000-000000000101',
  'execute',null,null,0,'05900000-0000-4000-8000-000000000103',
  (select governed_dose_time from page5_values),'200','U','LEFT_ARM','左上臂',null,
  '05a00000-0000-4000-8000-000000000112')$$,
  '23514','insulin dose is outside published versioned organization rule',
  'only the published organization rule supplies the maximum-dose rejection');
select throws_ok($$select * from public.mutate_insulin_administration(
  '05100000-0000-4000-8000-000000000101','05200000-0000-4000-8000-000000000101',
  'execute',null,null,0,'05900000-0000-4000-8000-000000000103',
  (select governed_dose_time from page5_values),'20','U','LEFT_ARM','左上臂',null,
  '05a00000-0000-4000-8000-000000000113')$$,
  '23514','insulin dose and unit must exactly match approved Page-8 plan',
  'caller cannot substitute a dose different from the approved plan');
select throws_ok($$select * from public.mutate_insulin_administration(
  '05100000-0000-4000-8000-000000000101','05200000-0000-4000-8000-000000000101',
  'execute',null,null,0,'05900000-0000-4000-8000-000000000104',
  (select on_time from page5_values),'6','U','LEFT_ARM','左上臂',null,
  '05a00000-0000-4000-8000-000000000114')$$,
  '42501','insulin plan is outside current scope','cross-branch plan access fails closed');
reset role;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"05000000-0000-4000-8000-000000000102","role":"authenticated","aal":"aal2","session_id":"05700000-0000-4000-8000-000000000999"}',true);
select throws_ok($$select * from public.mutate_insulin_administration(
  '05100000-0000-4000-8000-000000000101','05200000-0000-4000-8000-000000000101',
  'execute',null,null,0,'05900000-0000-4000-8000-000000000103',
  (select governed_dose_time from page5_values),'200','U','LEFT_ARM','左上臂',null,
  '05a00000-0000-4000-8000-000000000115')$$,
  '42501','current same-session insulin AAL2 evidence is required',
  'a different session cannot reuse recent AAL2 evidence');
reset role;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"05000000-0000-4000-8000-000000000102","role":"authenticated","aal":"aal2","session_id":"05700000-0000-4000-8000-000000000102"}',true);
select ok((select matching_total=(case when
    ((select late_time from page5_values) at time zone 'Asia/Taipei')::date =
    ((select on_time from page5_values) at time zone 'Asia/Taipei')::date
    then 2 else 1 end)
  and scheduled_total=0 and late_authorized_total=0
  and pending_review_total=0 and completed_total=(case when
    ((select late_time from page5_values) at time zone 'Asia/Taipei')::date =
    ((select on_time from page5_values) at time zone 'Asia/Taipei')::date
    then 2 else 1 end)
  and late_exception_total=0
  and jsonb_array_length(items)=(case when
    ((select late_time from page5_values) at time zone 'Asia/Taipei')::date =
    ((select on_time from page5_values) at time zone 'Asia/Taipei')::date
    then 2 else 1 end)
  and not items_truncated
  and (select array_agg(item->>'ordered_dose_text' order by item->>'ordered_dose_text')
    from jsonb_array_elements(items) item) = (case when
      ((select late_time from page5_values) at time zone 'Asia/Taipei')::date =
      ((select on_time from page5_values) at time zone 'Asia/Taipei')::date
      then array['10','12.5']::text[] else array['12.5']::text[] end)
  and governance_status='published' and plan_designation_status='published'
  and qualification_status='published' and dose_rule_status='published'
  and late_entry_rule_status='published' and can_execute and can_review
  and not can_authorize_late and offline_status='not_configured'
  and attachment_status='not_configured' and external_delivery_status='not_configured'
  and delivery_claim='no_external_delivery_claim'
  from public.insulin_administration_snapshot(
    '05100000-0000-4000-8000-000000000101','05200000-0000-4000-8000-000000000101',
    ((select on_time from page5_values) at time zone 'Asia/Taipei')::date,'all',null,'completed'
  )), 'snapshot metrics and capability flags derive from one Taiwan-day server projection');
select ok((select bool_and(jsonb_array_length(item->'history') in (2,3))
  from public.insulin_administration_snapshot(
    '05100000-0000-4000-8000-000000000101','05200000-0000-4000-8000-000000000101',
    ((select on_time from page5_values) at time zone 'Asia/Taipei')::date,'all',null,'completed'
  ) snapshot cross join lateral jsonb_array_elements(snapshot.items) item),
  'snapshot exposes the complete immutable history for each completed slot');
select throws_ok($$select * from public.insulin_administration_snapshot(
  '05100000-0000-4000-8000-000000000101','05200000-0000-4000-8000-000000000102',
  ((select on_time from page5_values) at time zone 'Asia/Taipei')::date,'all',null,'all')$$,
  '42501','insulin snapshot is not permitted','snapshot cannot cross the actor branch scope');
select throws_ok($$select * from public.insulin_administration_events$$,
  '42501',null,'authenticated callers cannot select insulin evidence directly');
select throws_ok($$insert into public.insulin_administration_events(
  organization_id,branch_id,client_id,administration_key,event_sequence,event_kind,state,
  medication_plan_id,medication_plan_version,medication_plan_content_hash,
  governance_version_id,scheduled_for,late_entry,content_hash
) values (
  '05100000-0000-4000-8000-000000000101','05200000-0000-4000-8000-000000000101',
  '05400000-0000-4000-8000-000000000101',gen_random_uuid(),1,'executed','pending_review',
  '05900000-0000-4000-8000-000000000101',1,repeat('a',64),
  '05b00000-0000-4000-8000-000000000101',(select on_time from page5_values),false,repeat('f',64)
)$$,'42501',null,'authenticated callers cannot forge insulin events');
reset role;

select throws_ok($$update public.insulin_administration_events set site_text='覆寫' where true$$,
  '55000','insulin_administration_events is append-only','insulin event updates are rejected');
select throws_ok($$delete from public.insulin_administration_events where true$$,
  '55000','insulin_administration_events is append-only','insulin event deletion is rejected');

select ok((select count(*)=2 and bool_and(content_hash ~ '^[a-f0-9]{64}$')
  from public.insulin_administration_events where event_kind='reviewed'),
  'both completions have immutable content hashes');
select ok((select count(*)>=6 and bool_and(
  not (metadata ? 'dose_text') and not (metadata ? 'site_text') and not (metadata ? 'late_reason')
  ) from public.audit_events where table_name in (
    'public.insulin_governance_versions','public.insulin_plan_designations','public.insulin_administration_events',
    'insulin_administration_snapshot'
  )), 'Page 5 audit metadata excludes dose, site and narrative content');

insert into public.insulin_governance_versions(
  id,organization_id,branch_id,version,status,effective_from,effective_to,
  dose_unit,dose_min_text,dose_max_text,early_window_minutes,late_after_minutes,
  executor_role_keys,reviewer_role_keys,supervisor_role_keys,
  executor_certificate_types,reviewer_certificate_types,supervisor_certificate_types,
  published_at,published_by,content_hash
) values (
  '05b00000-0000-4000-8000-000000000103','05100000-0000-4000-8000-000000000101',
  '05200000-0000-4000-8000-000000000101',3,'published',clock_timestamp()-interval '1 day',null,
  'U','0.1','100',15,60,array['nurse'],array['nurse'],array['organization_manager'],
  array['insulin_executor'],array['insulin_reviewer'],array['insulin_supervisor'],
  clock_timestamp()-interval '1 day','05000000-0000-4000-8000-000000000101',repeat('9',64)
);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"05000000-0000-4000-8000-000000000101","role":"authenticated","aal":"aal2","session_id":"05700000-0000-4000-8000-000000000101"}',true);
select ok((select governance_status='not_configured' and qualification_status='not_configured'
  and dose_rule_status='not_configured' and late_entry_rule_status='not_configured'
  and matching_total=0 and items='[]'::jsonb and not can_authorize_late
  from public.insulin_administration_snapshot(
    '05100000-0000-4000-8000-000000000101','05200000-0000-4000-8000-000000000101',
    ((select on_time from page5_values) at time zone 'Asia/Taipei')::date,'all',null,'all'
  )), 'ambiguous overlapping governance fails closed as not configured');
select throws_ok($$select * from public.mutate_insulin_administration(
  '05100000-0000-4000-8000-000000000101','05200000-0000-4000-8000-000000000101',
  'authorize_late',null,null,0,'05900000-0000-4000-8000-000000000102',
  (select late_time from page5_values),null,null,null,null,'不應被接受',
  '05a00000-0000-4000-8000-000000000116')$$,
  '55000','insulin qualification, dose, and late-entry governance is not configured',
  'all writes fail closed when no single published governance version exists');
reset role;

select * from finish();
rollback;
