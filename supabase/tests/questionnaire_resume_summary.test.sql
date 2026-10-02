begin;
select plan(26);
set local time zone 'Asia/Taipei';
select set_config('test.resume_amr', floor(extract(epoch from clock_timestamp()-interval '2 minutes'))::text, true);

-- Synthetic approved Google nurse; real admission, role and assignment checks
-- remain in force. No actual care data or hosted project is accessed.
insert into auth.users(id,aud,role,email,email_confirmed_at,created_at,updated_at) values
 ('b9100000-0000-4000-8000-000000000001','authenticated','authenticated','resume-nurse@care.example.invalid',now()-interval '1 day',now()-interval '1 day',now());
insert into auth.identities(id,provider_id,user_id,identity_data,provider) values
 ('b9200000-0000-4000-8000-000000000001','synthetic-resume-nurse','b9100000-0000-4000-8000-000000000001',
  '{"sub":"synthetic-resume-nurse","email":"resume-nurse@care.example.invalid","email_verified":true,"hd":"care.example.invalid"}','google');
insert into auth.sessions(id,user_id,created_at,aal) values
 ('b9300000-0000-4000-8000-000000000001','b9100000-0000-4000-8000-000000000001',now()-interval '3 minutes','aal1');
insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method) values
 ('b9400000-0000-4000-8000-000000000001','b9300000-0000-4000-8000-000000000001',
  to_timestamp(current_setting('test.resume_amr')::bigint),to_timestamp(current_setting('test.resume_amr')::bigint),'oauth');
insert into public.organizations(id,code,name) values
 ('b9500000-0000-4000-8000-000000000001','questionnaire_resume_test','Synthetic questionnaire resume organization');
insert into public.branches(id,organization_id,code,name) values
 ('b9600000-0000-4000-8000-000000000001','b9500000-0000-4000-8000-000000000001','main','Synthetic main'),
 ('b9600000-0000-4000-8000-000000000002','b9500000-0000-4000-8000-000000000001','other','Synthetic other');
insert into public.profiles(id,display_name,kind) values
 ('b9100000-0000-4000-8000-000000000001','Synthetic resume nurse','staff');
insert into public.memberships(id,organization_id,branch_id,profile_id,status,starts_at) values
 ('b9700000-0000-4000-8000-000000000001','b9500000-0000-4000-8000-000000000001','b9600000-0000-4000-8000-000000000001',
  'b9100000-0000-4000-8000-000000000001','active',now()-interval '1 day');
insert into public.membership_roles(membership_id,role_id)
 select 'b9700000-0000-4000-8000-000000000001',id from public.roles where role_key='nurse' and is_system;
insert into private.staff_google_access_grants(allowed_user_id,organization_id,company_email_domain,allowed_email,google_subject,enabled,approval_reference)
 values('b9100000-0000-4000-8000-000000000001','b9500000-0000-4000-8000-000000000001','care.example.invalid',
  'resume-nurse@care.example.invalid','synthetic-resume-nurse',true,'Synthetic approved resume nurse');
insert into public.clients(id,organization_id,branch_id,client_code,display_name) values
 ('b9800000-0000-4000-8000-000000000001','b9500000-0000-4000-8000-000000000001','b9600000-0000-4000-8000-000000000001','SYN-RES-1','Synthetic assigned client'),
 ('b9800000-0000-4000-8000-000000000002','b9500000-0000-4000-8000-000000000001','b9600000-0000-4000-8000-000000000001','SYN-RES-2','Synthetic unassigned client'),
 ('b9800000-0000-4000-8000-000000000003','b9500000-0000-4000-8000-000000000001','b9600000-0000-4000-8000-000000000002','SYN-RES-3','Synthetic other branch client');
insert into public.clients(id,organization_id,branch_id,client_code,display_name,status) values
 ('b9800000-0000-4000-8000-000000000004','b9500000-0000-4000-8000-000000000001','b9600000-0000-4000-8000-000000000001','SYN-RES-4','Synthetic suspended client','suspended'),
 ('b9800000-0000-4000-8000-000000000005','b9500000-0000-4000-8000-000000000001','b9600000-0000-4000-8000-000000000001','SYN-RES-5','Synthetic closed client','closed');
insert into public.client_assignments(organization_id,branch_id,client_id,assignee_user_id,assignment_kind,starts_at)
 values
 ('b9500000-0000-4000-8000-000000000001','b9600000-0000-4000-8000-000000000001','b9800000-0000-4000-8000-000000000001',
  'b9100000-0000-4000-8000-000000000001','synthetic-resume',now()-interval '1 day'),
 ('b9500000-0000-4000-8000-000000000001','b9600000-0000-4000-8000-000000000001','b9800000-0000-4000-8000-000000000004',
  'b9100000-0000-4000-8000-000000000001','synthetic-resume',now()-interval '1 day'),
 ('b9500000-0000-4000-8000-000000000001','b9600000-0000-4000-8000-000000000001','b9800000-0000-4000-8000-000000000005',
  'b9100000-0000-4000-8000-000000000001','synthetic-resume',now()-interval '1 day');

create function pg_temp.resume_login() returns boolean language plpgsql security invoker as $$
begin
 perform set_config('request.jwt.claims',jsonb_build_object(
  'sub','b9100000-0000-4000-8000-000000000001','session_id','b9300000-0000-4000-8000-000000000001',
  'aud','authenticated','role','authenticated','aal','aal1','email','resume-nurse@care.example.invalid','is_anonymous',false,
  'iat',floor(extract(epoch from clock_timestamp())),'exp',floor(extract(epoch from clock_timestamp()+interval '30 minutes')),
  'amr',jsonb_build_array(jsonb_build_object('method','oauth','timestamp',current_setting('test.resume_amr')::bigint))
 )::text,true);
 return public.is_staff_login_allowed();
end; $$;
create function pg_temp.resume_payload(p_form text,p_date date) returns jsonb language sql security invoker as $$
 select jsonb_build_object('action','create','client_id','b9800000-0000-4000-8000-000000000001',
  'form_key',p_form,
  'form_version',case p_form when 'spmsq' then 'spmsq-pfeiffer-10-education-adjusted-v1'
    when 'gds_15' then 'gds-15-strict-complete-v1' end,
  'assessed_on',p_date,
  'answers',(select jsonb_object_agg(case p_form when 'spmsq' then 'spmsq_' else 'gds_' end||lpad(n::text,2,'0'),'{"state":"missing"}'::jsonb)
    from generate_series(1,case p_form when 'spmsq' then 10 else 15 end)n),
  'context','{}'::jsonb);
$$;
create function pg_temp.resume_summary() returns jsonb language sql security invoker as $$
 select public.questionnaire_resume_summary('b9500000-0000-4000-8000-000000000001','b9600000-0000-4000-8000-000000000001',
  'b9800000-0000-4000-8000-000000000001');
$$;
create temporary table resume_receipts(name text primary key,receipt jsonb not null);
grant select,insert,update on resume_receipts to authenticated;

select ok(not (select prosecdef from pg_proc where oid='public.questionnaire_resume_summary(uuid,uuid,uuid)'::regprocedure),
 'public resume wrapper runs as invoker');
select ok((select prosecdef and proconfig @> array['search_path=""'] from pg_proc
 where oid='private.questionnaire_resume_summary_guarded(uuid,uuid,uuid)'::regprocedure),
 'private guarded reader pins search_path');
select ok(not has_function_privilege('anon','public.questionnaire_resume_summary(uuid,uuid,uuid)','execute'),
 'anonymous caller cannot execute resume RPC');
select ok(not has_function_privilege('service_role','public.questionnaire_resume_summary(uuid,uuid,uuid)','execute'),
 'service role cannot bypass selected-client RPC');
select ok(not has_table_privilege('authenticated','public.questionnaire_assessment_versions','select'),
 'summary adds no direct clinical table grant');
select ok(exists(select 1 from pg_indexes where schemaname='public' and indexname='questionnaire_resume_client_saved_idx'),
 'latest-version lookup has a purpose-built index');

set local role authenticated;
select is(pg_temp.resume_login(),true,'actual approved Google AAL1 staff is admitted');
select is(jsonb_array_length(pg_temp.resume_summary()->'forms'),9,'all nine authorized forms appear once');
select is((select count(distinct f->>'formKey')::integer from jsonb_array_elements(pg_temp.resume_summary()->'forms')f),9,
 'form entries are unique');
select is((select count(*)::integer from jsonb_array_elements(pg_temp.resume_summary()->'forms')f where f->'latest'='null'::jsonb),9,
 'authorized empty forms are distinguishable from permission-hidden forms');
select ok(pg_temp.resume_summary()::text !~ '"answers"|"context"|"contentHash"|"authorUserId"',
 'metadata and audit-safe response contain no answers, context, hash or staff identifier');

insert into resume_receipts values('older',public.mutate_questionnaire_assessment(
 'b9500000-0000-4000-8000-000000000001','b9600000-0000-4000-8000-000000000001',
 pg_temp.resume_payload('spmsq','2026-09-25'),'b9900000-0000-4000-8000-000000000001'));
select is((select pg_temp.resume_summary()->'forms'->0->'latest'->>'versionId'),
 (select receipt->>'versionId' from resume_receipts where name='older'),'first saved version is resumable');
select pg_sleep(0.002);
insert into resume_receipts values('newer-save-earlier-date',public.mutate_questionnaire_assessment(
 'b9500000-0000-4000-8000-000000000001','b9600000-0000-4000-8000-000000000001',
 pg_temp.resume_payload('spmsq','2026-09-01'),'b9900000-0000-4000-8000-000000000002'));
select is((select pg_temp.resume_summary()->'forms'->0->'latest'->>'versionId'),
 (select receipt->>'versionId' from resume_receipts where name='newer-save-earlier-date'),
 'actual save timestamp beats the assessment date across independent chains');
select pg_sleep(0.002);
insert into resume_receipts
 select 'revision',public.mutate_questionnaire_assessment(
  'b9500000-0000-4000-8000-000000000001','b9600000-0000-4000-8000-000000000001',
  pg_temp.resume_payload('spmsq','2026-09-25')||jsonb_build_object(
   'action','revise','assessment_key',r.receipt->>'assessmentKey',
   'previous_version_id',r.receipt->>'versionId','expected_version',(r.receipt->>'version')::integer),
  'b9900000-0000-4000-8000-000000000003') from resume_receipts r where r.name='older';
select is((select pg_temp.resume_summary()->'forms'->0->'latest'->>'versionId'),
 (select receipt->>'versionId' from resume_receipts where name='revision'),
 'latest revision of an older chain becomes resume target');
select is((pg_temp.resume_summary()->'forms'->0->'latest'->>'version')::integer,2,
 'summary identifies the exact immutable revision');

insert into resume_receipts values('gds',public.mutate_questionnaire_assessment(
 'b9500000-0000-4000-8000-000000000001','b9600000-0000-4000-8000-000000000001',
 pg_temp.resume_payload('gds_15','2026-09-20'),'b9900000-0000-4000-8000-000000000004'));
select is((select f->'latest'->>'versionId' from jsonb_array_elements(pg_temp.resume_summary()->'forms')f where f->>'formKey'='gds_15'),
 (select receipt->>'versionId' from resume_receipts where name='gds'),
 'each form retains its own exact latest saved version');

-- A captured timestamp can outrank a later child if an old writer waited on
-- a lock. A nonterminal parent must never be offered as resumable even then.
reset role;
insert into public.questionnaire_assessment_versions(
 id,organization_id,branch_id,client_id,form_key,form_version,assessment_key,version,
 assessed_on,answers,context,record_state,content_hash,author_user_id,author_display_name,created_at
) select
 'b9a00000-0000-4000-8000-000000000001',
 'b9500000-0000-4000-8000-000000000001','b9600000-0000-4000-8000-000000000001',
 'b9800000-0000-4000-8000-000000000001','spmsq','spmsq-pfeiffer-10-education-adjusted-v1',
 'b9b00000-0000-4000-8000-000000000001',1,date '2026-09-22',p->'answers','{}'::jsonb,'draft',
 encode(sha256(convert_to(jsonb_build_object('form_key','spmsq',
  'form_version','spmsq-pfeiffer-10-education-adjusted-v1','assessed_on',date '2026-09-22',
  'answers',p->'answers','context','{}'::jsonb)::text,'UTF8')),'hex'),
 'b9100000-0000-4000-8000-000000000001','Synthetic resume nurse',clock_timestamp()+interval '1 hour'
 from (select pg_temp.resume_payload('spmsq','2026-09-22') p) source;
set local role authenticated;
insert into resume_receipts values('inverted-child',public.mutate_questionnaire_assessment(
 'b9500000-0000-4000-8000-000000000001','b9600000-0000-4000-8000-000000000001',
 pg_temp.resume_payload('spmsq','2026-09-22')||jsonb_build_object(
  'action','revise','assessment_key','b9b00000-0000-4000-8000-000000000001',
  'previous_version_id','b9a00000-0000-4000-8000-000000000001','expected_version',1),
 'b9900000-0000-4000-8000-000000000005'));
select is((select pg_temp.resume_summary()->'forms'->0->'latest'->>'versionId'),
 (select receipt->>'versionId' from resume_receipts where name='inverted-child'),
 'future-stamped nonterminal parent never outranks its current terminal child');

-- Remove only this role's cognition permission. An existing cognition draft
-- must disappear, while authorized emotion records and empty forms stay.
reset role;
delete from public.role_permissions rp using public.roles r,public.permissions p
 where rp.role_id=r.id and rp.permission_id=p.id and r.role_key='nurse' and r.is_system
  and p.permission_key='questionnaire_cognition.read';
set local role authenticated;
select is(jsonb_array_length(pg_temp.resume_summary()->'forms'),8,
 'an unpermitted form is absent rather than an explicit empty form');
select ok(not exists(select 1 from jsonb_array_elements(pg_temp.resume_summary()->'forms')f where f->>'formKey'='spmsq'),
 'existing draft identity is not leaked after a form permission is revoked');
select is((select f->'latest'->>'versionId' from jsonb_array_elements(pg_temp.resume_summary()->'forms')f where f->>'formKey'='gds_15'),
 (select receipt->>'versionId' from resume_receipts where name='gds'),
 'remaining authorized form still works');
select throws_ok($$select public.questionnaire_resume_summary('b9500000-0000-4000-8000-000000000001',
 'b9600000-0000-4000-8000-000000000001','b9800000-0000-4000-8000-000000000002')$$,
 '42501',null,'same-branch but unassigned client denied');
select throws_ok($$select public.questionnaire_resume_summary('b9500000-0000-4000-8000-000000000001',
 'b9600000-0000-4000-8000-000000000002','b9800000-0000-4000-8000-000000000003')$$,
 '42501',null,'other branch denied');

select lives_ok($$select public.questionnaire_resume_summary('b9500000-0000-4000-8000-000000000001',
 'b9600000-0000-4000-8000-000000000001','b9800000-0000-4000-8000-000000000004')$$,
 'suspended but still assigned client can resume');
select throws_ok($$select public.questionnaire_resume_summary('b9500000-0000-4000-8000-000000000001',
 'b9600000-0000-4000-8000-000000000001','b9800000-0000-4000-8000-000000000005')$$,
 '42501',null,'closed client cannot appear in active intake');
reset role;
update public.client_assignments set ends_at=clock_timestamp()-interval '1 second'
 where client_id='b9800000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select pg_temp.resume_summary()$$,'42501',null,'revoked client assignment prevents subsequent summary reads');
reset role;
select ok(not exists(select 1 from public.audit_events where metadata->>'workflow'='questionnaire_resume_summary_v1'
 and (metadata ?| array['answers','context','client_id','assessment_key','version_id','content_hash'])),
 'resume audit stores no clinical payload or direct client/version identifiers');
select * from finish();
rollback;
