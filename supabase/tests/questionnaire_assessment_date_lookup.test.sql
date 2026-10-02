begin;
select plan(33);
set local time zone 'Asia/Taipei';
select set_config('test.questionnaire_date_amr',floor(extract(epoch from clock_timestamp()-interval '2 minutes'))::text,true);

-- Synthetic approved Google staff. Admission, form permission, branch and
-- assignment predicates remain the production implementations.
insert into auth.users(id,aud,role,email,email_confirmed_at,created_at,updated_at) values
 ('d1100000-0000-4000-8000-000000000001','authenticated','authenticated','date-nurse@care.example.invalid',now()-interval '1 day',now()-interval '1 day',now());
insert into auth.identities(id,provider_id,user_id,identity_data,provider) values
 ('d1200000-0000-4000-8000-000000000001','synthetic-date-nurse','d1100000-0000-4000-8000-000000000001',
  '{"sub":"synthetic-date-nurse","email":"date-nurse@care.example.invalid","email_verified":true,"hd":"care.example.invalid"}','google');
insert into auth.sessions(id,user_id,created_at,aal) values
 ('d1300000-0000-4000-8000-000000000001','d1100000-0000-4000-8000-000000000001',now()-interval '3 minutes','aal1');
insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method) values
 ('d1400000-0000-4000-8000-000000000001','d1300000-0000-4000-8000-000000000001',
  to_timestamp(current_setting('test.questionnaire_date_amr')::bigint),to_timestamp(current_setting('test.questionnaire_date_amr')::bigint),'oauth');
insert into public.organizations(id,code,name) values
 ('d1500000-0000-4000-8000-000000000001','questionnaire_date_test','Synthetic questionnaire date organization'),
 ('d1500000-0000-4000-8000-000000000002','questionnaire_date_other','Synthetic other organization');
insert into public.branches(id,organization_id,code,name) values
 ('d1600000-0000-4000-8000-000000000001','d1500000-0000-4000-8000-000000000001','main','Synthetic main'),
 ('d1600000-0000-4000-8000-000000000002','d1500000-0000-4000-8000-000000000002','other','Synthetic other');
insert into public.profiles(id,display_name,kind) values
 ('d1100000-0000-4000-8000-000000000001','Synthetic date nurse','staff');
insert into public.memberships(id,organization_id,branch_id,profile_id,status,starts_at) values
 ('d1700000-0000-4000-8000-000000000001','d1500000-0000-4000-8000-000000000001','d1600000-0000-4000-8000-000000000001',
  'd1100000-0000-4000-8000-000000000001','active',now()-interval '1 day');
insert into public.membership_roles(membership_id,role_id)
 select 'd1700000-0000-4000-8000-000000000001',id from public.roles where role_key='nurse' and is_system;
insert into private.staff_google_access_grants(allowed_user_id,organization_id,company_email_domain,allowed_email,google_subject,enabled,approval_reference)
 values('d1100000-0000-4000-8000-000000000001','d1500000-0000-4000-8000-000000000001','care.example.invalid',
  'date-nurse@care.example.invalid','synthetic-date-nurse',true,'Synthetic approved date nurse');
insert into public.clients(id,organization_id,branch_id,client_code,display_name) values
 ('d1800000-0000-4000-8000-000000000001','d1500000-0000-4000-8000-000000000001','d1600000-0000-4000-8000-000000000001','SYN-DATE-1','Synthetic assigned client'),
 ('d1800000-0000-4000-8000-000000000002','d1500000-0000-4000-8000-000000000001','d1600000-0000-4000-8000-000000000001','SYN-DATE-2','Synthetic unassigned client'),
 ('d1800000-0000-4000-8000-000000000003','d1500000-0000-4000-8000-000000000002','d1600000-0000-4000-8000-000000000002','SYN-DATE-3','Synthetic other client');
insert into public.client_assignments(organization_id,branch_id,client_id,assignee_user_id,assignment_kind,starts_at)
 values('d1500000-0000-4000-8000-000000000001','d1600000-0000-4000-8000-000000000001','d1800000-0000-4000-8000-000000000001',
  'd1100000-0000-4000-8000-000000000001','synthetic-date',now()-interval '1 day');

create function pg_temp.date_login() returns boolean language plpgsql security invoker as $$
begin
 perform set_config('request.jwt.claims',jsonb_build_object(
  'sub','d1100000-0000-4000-8000-000000000001','session_id','d1300000-0000-4000-8000-000000000001',
  'aud','authenticated','role','authenticated','aal','aal1','email','date-nurse@care.example.invalid','is_anonymous',false,
  'iat',floor(extract(epoch from clock_timestamp())),'exp',floor(extract(epoch from clock_timestamp()+interval '30 minutes')),
  'amr',jsonb_build_array(jsonb_build_object('method','oauth','timestamp',current_setting('test.questionnaire_date_amr')::bigint))
 )::text,true);
 return public.is_staff_login_allowed();
end; $$;
create function pg_temp.date_payload(p_date date) returns jsonb language sql security invoker as $$
 select jsonb_build_object('action','create','client_id','d1800000-0000-4000-8000-000000000001',
  'form_key','spmsq','form_version','spmsq-pfeiffer-10-education-adjusted-v1','assessed_on',p_date,
  'answers',(select jsonb_object_agg('spmsq_'||lpad(n::text,2,'0'),'{"state":"missing"}'::jsonb)
    from generate_series(1,10)n),'context','{}'::jsonb);
$$;
create function pg_temp.date_lookup(p_date date,p_stamp timestamptz default null,p_key uuid default null)
 returns jsonb language sql security invoker as $$
 select public.questionnaire_assessment_date_lookup(
  'd1500000-0000-4000-8000-000000000001','d1600000-0000-4000-8000-000000000001',
  'spmsq','d1800000-0000-4000-8000-000000000001',p_date,p_stamp,p_key);
$$;
create temporary table date_receipts(n integer primary key,receipt jsonb not null);
create temporary table date_pages(name text primary key,page jsonb not null);
grant select,insert,update on date_receipts,date_pages to authenticated;

select ok(not (select prosecdef from pg_proc where oid=
 'public.questionnaire_assessment_date_lookup(uuid,uuid,text,uuid,date,timestamptz,uuid)'::regprocedure),
 'public date lookup wrapper is invoker');
select ok((select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid=
 'private.questionnaire_assessment_date_lookup_guarded(uuid,uuid,text,uuid,date,timestamptz,uuid)'::regprocedure),
 'guarded reader pins search_path');
select ok(not has_function_privilege('anon','public.questionnaire_assessment_date_lookup(uuid,uuid,text,uuid,date,timestamptz,uuid)','execute')
 and not has_function_privilege('service_role','public.questionnaire_assessment_date_lookup(uuid,uuid,text,uuid,date,timestamptz,uuid)','execute'),
 'anonymous and service role cannot execute date lookup');
select ok(not has_function_privilege('anon','private.questionnaire_assessment_date_lookup_guarded(uuid,uuid,text,uuid,date,timestamptz,uuid)','execute')
 and not has_function_privilege('service_role','private.questionnaire_assessment_date_lookup_guarded(uuid,uuid,text,uuid,date,timestamptz,uuid)','execute'),
 'guarded core is not a privileged bypass for anonymous or service role');
select ok(not has_table_privilege('authenticated','public.questionnaire_assessment_versions','select'),
 'new reader adds no direct clinical table grant');

set local role authenticated;
select is(pg_temp.date_login(),true,'approved Google AAL1 staff is admitted');
select is((pg_temp.date_lookup(date '2026-09-25')->>'total')::integer,0,'authorized date with no records is an empty result');
select is((select count(*)::integer from (values
 ('spmsq'),('gds_15'),('fall_risk_taipei_115'),('nsi_determine'),('barthel_adl'),
 ('lawton_iadl'),('eat10_swallowing'),('bsrs5'),('mna_sf')) f(form_key)
 where (public.questionnaire_assessment_date_lookup(
 'd1500000-0000-4000-8000-000000000001','d1600000-0000-4000-8000-000000000001',
 f.form_key,'d1800000-0000-4000-8000-000000000001',date '2026-09-25')->>'total')::integer=0),9,
 'same guarded metadata RPC handles all nine authorized forms');
select throws_ok($$select pg_temp.date_lookup(null)$$,'22023',null,'date filter is required');
select throws_ok($$select pg_temp.date_lookup(date '2200-01-01')$$,'22023',null,'future assessment date rejected');
select throws_ok($$select pg_temp.date_lookup(date '2026-09-25',now(),null)$$,'22023',null,'cursor fields must be paired');

insert into date_receipts
 select n,public.mutate_questionnaire_assessment(
  'd1500000-0000-4000-8000-000000000001','d1600000-0000-4000-8000-000000000001',
  pg_temp.date_payload(case when n<=55 then date '2026-09-25' else date '2026-09-24' end),
  ('d1900000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid)
 from generate_series(1,58)n;
insert into date_pages values('first',pg_temp.date_lookup(date '2026-09-25'));
insert into date_pages select 'second',pg_temp.date_lookup(date '2026-09-25',
 (page->'nextCursor'->>'createdAt')::timestamptz,(page->'nextCursor'->>'assessmentKey')::uuid)
 from date_pages where name='first';
insert into date_pages select 'third',pg_temp.date_lookup(date '2026-09-25',
 (page->'nextCursor'->>'createdAt')::timestamptz,(page->'nextCursor'->>'assessmentKey')::uuid)
 from date_pages where name='second';
select is((select (page->>'total')::integer from date_pages where name='first'),55,
 'total counts terminal versions on only the selected date');
select is((select jsonb_array_length(page->'assessments') from date_pages where name='first'),20,
 'filter is applied before twenty-row page limit despite interleaved other dates');
select is((select jsonb_array_length(page->'assessments') from date_pages where name='second'),20,
 'exact microsecond cursor reaches the second full same-date page');
select ok((select page->'nextCursor'<>'null'::jsonb from date_pages where name='second'),
 'second page continues when more than fifty same-date assessments exist');
select is((select jsonb_array_length(page->'assessments') from date_pages where name='third'),15,
 'third page reaches the remaining same-date records past fifty assessments');
select ok((select page->'nextCursor'='null'::jsonb from date_pages where name='third'),
 'third and final page has no cursor');
select is((select count(distinct item->>'assessmentKey')::integer from date_pages,
 jsonb_array_elements(page->'assessments')item),55,'three pages neither duplicate nor omit chains');
select ok((select bool_and(item->>'assessedOn'='2026-09-25') from date_pages,
 jsonb_array_elements(page->'assessments')item),'each row carries the selected terminal date');
select ok((select bool_and(item ?& array['assessmentKey','versionId','version','assessedOn','savedAt','recordState','assessmentCreatedAt']
 and (select count(*) from jsonb_object_keys(item))=7) from date_pages,jsonb_array_elements(page->'assessments')item),
 'each row exposes only the exact seven approved metadata fields');
select ok((select bool_and(page::text !~ '"answers"|"context"|"contentHash"|"authorUserId"')
 from date_pages),'no answer, context, hash or staff identifier enters any page');
select throws_ok($$select pg_temp.date_lookup(date '2026-09-24',
 (select (page->'nextCursor'->>'createdAt')::timestamptz from date_pages where name='first'),
 (select (page->'nextCursor'->>'assessmentKey')::uuid from date_pages where name='first'))$$,
 '22023',null,'cursor cannot be replayed under another selected date');
select throws_ok($$select public.questionnaire_assessment_date_lookup(
 'd1500000-0000-4000-8000-000000000001','d1600000-0000-4000-8000-000000000001',
 'gds_15','d1800000-0000-4000-8000-000000000001',date '2026-09-25',
 (select (page->'nextCursor'->>'createdAt')::timestamptz from date_pages where name='first'),
 (select (page->'nextCursor'->>'assessmentKey')::uuid from date_pages where name='first'))$$,
 '22023',null,'cursor from another form is not a valid continuation');
select throws_ok($$select pg_temp.date_lookup(date '2026-09-25',
 now(),'d1a00000-0000-4000-8000-000000000001')$$,
 '22023',null,'unknown or manipulated cursor rejected');

insert into date_receipts
 select 59,public.mutate_questionnaire_assessment(
  'd1500000-0000-4000-8000-000000000001','d1600000-0000-4000-8000-000000000001',
  pg_temp.date_payload(date '2026-09-24')||jsonb_build_object(
   'action','revise','assessment_key',r.receipt->>'assessmentKey',
   'previous_version_id',r.receipt->>'versionId','expected_version',(r.receipt->>'version')::integer),
  'd1900000-0000-4000-8000-000000000059')
 from date_receipts r where r.n=1;
select is((pg_temp.date_lookup(date '2026-09-25')->>'total')::integer,54,
 'changing terminal assessment date removes chain from original date');
select is((pg_temp.date_lookup(date '2026-09-24')->>'total')::integer,4,
 'revised chain appears once under its new terminal date');
select is((select item->>'versionId' from jsonb_array_elements(pg_temp.date_lookup(date '2026-09-24')->'assessments')item
 where item->>'assessmentKey'=(select receipt->>'assessmentKey' from date_receipts where n=1)),
 (select receipt->>'versionId' from date_receipts where n=59),
 'lookup returns exact terminal version, never original answer-bearing version');
select throws_ok($$select public.questionnaire_assessment_date_lookup(
 'd1500000-0000-4000-8000-000000000001','d1600000-0000-4000-8000-000000000001',
 'spmsq','d1800000-0000-4000-8000-000000000002',date '2026-09-25')$$,
 '42501',null,'same-branch unassigned client is denied');
select throws_ok($$select public.questionnaire_assessment_date_lookup(
 'd1500000-0000-4000-8000-000000000002','d1600000-0000-4000-8000-000000000002',
 'spmsq','d1800000-0000-4000-8000-000000000003',date '2026-09-25')$$,
 '42501',null,'cross-organization client is denied');
reset role;
delete from public.role_permissions rp using public.roles r,public.permissions p
 where rp.role_id=r.id and rp.permission_id=p.id and r.role_key='nurse' and r.is_system
  and p.permission_key='questionnaire_cognition.read';
set local role authenticated;
select throws_ok($$select pg_temp.date_lookup(date '2026-09-25')$$,'42501',null,
 'revoked form permission blocks subsequent date reads');
select is((public.questionnaire_assessment_date_lookup(
 'd1500000-0000-4000-8000-000000000001','d1600000-0000-4000-8000-000000000001',
 'gds_15','d1800000-0000-4000-8000-000000000001',date '2026-09-25')->>'total')::integer,0,
 'another authorized form still reads independently after cognition permission removal');
reset role;
update public.client_assignments set ends_at=clock_timestamp()-interval '1 second'
 where client_id='d1800000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select public.questionnaire_assessment_date_lookup(
 'd1500000-0000-4000-8000-000000000001','d1600000-0000-4000-8000-000000000001',
 'gds_15','d1800000-0000-4000-8000-000000000001',date '2026-09-25')$$,
 '42501',null,'revoked assignment prevents even authorized form read');
reset role;
select ok(not exists(select 1 from public.audit_events
 where metadata->>'workflow'='questionnaire_assessment_date_lookup_v1'
 and metadata ?| array['answers','context','client_id','assessment_key','version_id','content_hash','assessed_on']),
 'date lookup audits exclude answers and direct clinical identifiers');
select * from finish();
rollback;
