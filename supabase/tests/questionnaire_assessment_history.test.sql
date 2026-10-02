begin;
select plan(29);
set local time zone 'Asia/Taipei';
select set_config('test.questionnaire_history_amr',floor(extract(epoch from clock_timestamp()-interval '2 minutes'))::text,true);

-- Real, synthetic admitted Google staff fixture. No admission/authority
-- predicate is replaced, and no production credentials or records are used.
insert into auth.users(id,aud,role,email,email_confirmed_at,created_at,updated_at) values
 ('a7100000-0000-4000-8000-000000000001','authenticated','authenticated','history-nurse@care.example.invalid',now()-interval '1 day',now()-interval '1 day',now());
insert into auth.identities(id,provider_id,user_id,identity_data,provider) values
 ('a7200000-0000-4000-8000-000000000001','synthetic-history-nurse','a7100000-0000-4000-8000-000000000001',
  '{"sub":"synthetic-history-nurse","email":"history-nurse@care.example.invalid","email_verified":true,"hd":"care.example.invalid"}','google');
insert into auth.sessions(id,user_id,created_at,aal) values
 ('a7300000-0000-4000-8000-000000000001','a7100000-0000-4000-8000-000000000001',now()-interval '3 minutes','aal1');
insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method) values
 ('a7400000-0000-4000-8000-000000000001','a7300000-0000-4000-8000-000000000001',
  to_timestamp(current_setting('test.questionnaire_history_amr')::bigint),to_timestamp(current_setting('test.questionnaire_history_amr')::bigint),'oauth');
insert into public.organizations(id,code,name) values
 ('a7500000-0000-4000-8000-000000000001','questionnaire_history_test','Synthetic questionnaire history organization'),
 ('a7500000-0000-4000-8000-000000000002','questionnaire_history_other','Synthetic other organization');
insert into public.branches(id,organization_id,code,name) values
 ('a7600000-0000-4000-8000-000000000001','a7500000-0000-4000-8000-000000000001','main','Synthetic main'),
 ('a7600000-0000-4000-8000-000000000002','a7500000-0000-4000-8000-000000000002','other','Synthetic other');
insert into public.profiles(id,display_name,kind) values
 ('a7100000-0000-4000-8000-000000000001','Synthetic history nurse','staff');
insert into public.memberships(id,organization_id,branch_id,profile_id,status,starts_at) values
 ('a7700000-0000-4000-8000-000000000001','a7500000-0000-4000-8000-000000000001','a7600000-0000-4000-8000-000000000001',
  'a7100000-0000-4000-8000-000000000001','active',now()-interval '1 day');
insert into public.membership_roles(membership_id,role_id)
 select 'a7700000-0000-4000-8000-000000000001',id from public.roles where role_key='nurse' and is_system;
insert into private.staff_google_access_grants(allowed_user_id,organization_id,company_email_domain,allowed_email,google_subject,enabled,approval_reference)
 values('a7100000-0000-4000-8000-000000000001','a7500000-0000-4000-8000-000000000001','care.example.invalid',
  'history-nurse@care.example.invalid','synthetic-history-nurse',true,'Synthetic approved history nurse');
insert into public.clients(id,organization_id,branch_id,client_code,display_name) values
 ('a7800000-0000-4000-8000-000000000001','a7500000-0000-4000-8000-000000000001','a7600000-0000-4000-8000-000000000001','SYN-HIS-1','Synthetic assigned client'),
 ('a7800000-0000-4000-8000-000000000002','a7500000-0000-4000-8000-000000000001','a7600000-0000-4000-8000-000000000001','SYN-HIS-2','Synthetic unassigned client'),
 ('a7800000-0000-4000-8000-000000000003','a7500000-0000-4000-8000-000000000002','a7600000-0000-4000-8000-000000000002','SYN-HIS-3','Synthetic other client');
insert into public.client_assignments(organization_id,branch_id,client_id,assignee_user_id,assignment_kind,starts_at)
 values('a7500000-0000-4000-8000-000000000001','a7600000-0000-4000-8000-000000000001','a7800000-0000-4000-8000-000000000001',
  'a7100000-0000-4000-8000-000000000001','synthetic-history',now()-interval '1 day');

create function pg_temp.history_login() returns boolean language plpgsql security invoker as $$
begin
 perform set_config('request.jwt.claims',jsonb_build_object(
  'sub','a7100000-0000-4000-8000-000000000001','session_id','a7300000-0000-4000-8000-000000000001',
  'aud','authenticated','role','authenticated','aal','aal1','email','history-nurse@care.example.invalid','is_anonymous',false,
  'iat',floor(extract(epoch from clock_timestamp())),'exp',floor(extract(epoch from clock_timestamp()+interval '30 minutes')),
  'amr',jsonb_build_array(jsonb_build_object('method','oauth','timestamp',current_setting('test.questionnaire_history_amr')::bigint))
 )::text,true);
 return public.is_staff_login_allowed();
end; $$;
create function pg_temp.history_payload() returns jsonb language sql security invoker as $$
 select jsonb_build_object('action','create','client_id','a7800000-0000-4000-8000-000000000001',
  'form_key','spmsq','form_version','spmsq-pfeiffer-10-education-adjusted-v1','assessed_on','2026-09-25',
  'answers',(select jsonb_object_agg('spmsq_'||lpad(n::text,2,'0'),'{"state":"answered","value":"correct"}'::jsonb) from generate_series(1,10)n),
  'context','{"education_adjustment":"middle_or_high_school"}'::jsonb);
$$;
create function pg_temp.history_list(p_stamp timestamptz default null,p_key uuid default null) returns jsonb language sql security invoker as $$
 select public.questionnaire_assessment_list('a7500000-0000-4000-8000-000000000001','a7600000-0000-4000-8000-000000000001',
 'spmsq','a7800000-0000-4000-8000-000000000001',p_stamp,p_key);
$$;
create temporary table history_receipts(n integer primary key,receipt jsonb not null);
create temporary table history_pages(name text primary key,page jsonb not null);
grant select,insert,update on history_receipts,history_pages to authenticated;

select ok(not (select prosecdef from pg_proc where oid='public.questionnaire_assessment_list(uuid,uuid,text,uuid,timestamptz,uuid)'::regprocedure),'list public wrapper is invoker');
select ok(not (select prosecdef from pg_proc where oid='public.questionnaire_assessment_history(uuid,uuid,text,uuid,uuid,integer)'::regprocedure),'history public wrapper is invoker');
select ok(not has_function_privilege('anon','public.questionnaire_assessment_history(uuid,uuid,text,uuid,uuid,integer)','execute')
 and not has_function_privilege('service_role','public.questionnaire_assessment_list(uuid,uuid,text,uuid,timestamptz,uuid)','execute'),'new RPCs exclude anon and service role');
select ok((select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid='private.questionnaire_assessment_history_guarded(uuid,uuid,text,uuid,uuid,integer)'::regprocedure),'history guarded core pins search_path');

set local role authenticated;
select is(pg_temp.history_login(),true,'actual approved Google AAL1 staff is admitted');
insert into history_receipts
 select n,public.mutate_questionnaire_assessment('a7500000-0000-4000-8000-000000000001','a7600000-0000-4000-8000-000000000001',
 pg_temp.history_payload(),('a7900000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid) from generate_series(1,22)n;
select lives_ok($$select public.questionnaire_assessment_snapshot('a7500000-0000-4000-8000-000000000001','a7600000-0000-4000-8000-000000000001','spmsq','a7800000-0000-4000-8000-000000000001')$$,'multiple independent assessment chains no longer cause cardinality error');
insert into history_pages values('first',pg_temp.history_list());
insert into history_pages select 'second',pg_temp.history_list((page->'nextCursor'->>'createdAt')::timestamptz,(page->'nextCursor'->>'assessmentKey')::uuid) from history_pages where name='first';
select is((select (page->>'total')::integer from history_pages where name='first'),22,'list total counts independent assessments');
select is((select jsonb_array_length(page->'assessments') from history_pages where name='first'),20,'assessment list is bounded to twenty records');
select is((select jsonb_array_length(page->'assessments') from history_pages where name='second'),2,'assessment cursor returns remaining records');
select ok((select page->'nextCursor'='null'::jsonb from history_pages where name='second'),'last assessment page has no next cursor');
select is((select count(distinct item->>'assessmentKey')::integer from history_pages,jsonb_array_elements(page->'assessments')item),22,'assessment pages have no duplicated or missing chain');

do $$declare prior jsonb; n integer; begin
 select h.receipt into prior from history_receipts h where h.n=1;
 for n in 1..22 loop
   prior:=public.mutate_questionnaire_assessment('a7500000-0000-4000-8000-000000000001','a7600000-0000-4000-8000-000000000001',
    pg_temp.history_payload()||jsonb_build_object('action','revise','assessment_key',prior->>'assessmentKey','previous_version_id',prior->>'versionId','expected_version',(prior->>'version')::integer),
    ('a7a00000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid);
 end loop;
 update history_receipts set receipt=prior where history_receipts.n=1;
end; $$;
insert into history_pages select 'versions-first',public.questionnaire_assessment_history('a7500000-0000-4000-8000-000000000001','a7600000-0000-4000-8000-000000000001','spmsq','a7800000-0000-4000-8000-000000000001',(receipt->>'assessmentKey')::uuid) from history_receipts where n=1;
insert into history_pages select 'versions-second',public.questionnaire_assessment_history('a7500000-0000-4000-8000-000000000001','a7600000-0000-4000-8000-000000000001','spmsq','a7800000-0000-4000-8000-000000000001',(page->>'assessmentKey')::uuid,(page->>'nextBeforeVersion')::integer) from history_pages where name='versions-first';
select is((select (page->>'total')::integer from history_pages where name='versions-first'),23,'revision stays in its chosen assessment chain');
select is((select jsonb_array_length(page->'versions') from history_pages where name='versions-first'),20,'version history is bounded to twenty records');
select is((select (page->'versions'->0->>'version')::integer from history_pages where name='versions-first'),23,'history begins with newest version');
select is((select jsonb_array_length(page->'versions') from history_pages where name='versions-second'),3,'older version page remains accessible');
select is((select (page->'versions'->2->>'version')::integer from history_pages where name='versions-second'),1,'original version remains accessible');
select is((select count(distinct item->>'versionId')::integer from history_pages,jsonb_array_elements(page->'versions')item where name like 'versions-%'),23,'history pages contain every immutable version exactly once');
select is((public.questionnaire_assessment_snapshot('a7500000-0000-4000-8000-000000000001','a7600000-0000-4000-8000-000000000001','spmsq','a7800000-0000-4000-8000-000000000001')->'clients'->0->>'assessmentTotal')::integer,22,'revision does not create another independent assessment');
select throws_ok($$select pg_temp.history_list(now(),null)$$,'22023',null,'incomplete assessment cursor rejected');
select throws_ok($$select public.questionnaire_assessment_history('a7500000-0000-4000-8000-000000000001','a7600000-0000-4000-8000-000000000001','spmsq','a7800000-0000-4000-8000-000000000001','a7b00000-0000-4000-8000-000000000001')$$,'42501',null,'unknown chain is fail closed');
select throws_ok($$select public.questionnaire_assessment_list('a7500000-0000-4000-8000-000000000001','a7600000-0000-4000-8000-000000000001','spmsq','a7800000-0000-4000-8000-000000000002')$$,'42501',null,'unassigned same-branch client remains inaccessible');
select throws_ok($$select public.questionnaire_assessment_list('a7500000-0000-4000-8000-000000000002','a7600000-0000-4000-8000-000000000002','spmsq','a7800000-0000-4000-8000-000000000003')$$,'42501',null,'cross-tenant client remains inaccessible');
select throws_ok($$select public.questionnaire_assessment_history('a7500000-0000-4000-8000-000000000001','a7600000-0000-4000-8000-000000000001','gds_15','a7800000-0000-4000-8000-000000000001',(select (receipt->>'assessmentKey')::uuid from history_receipts where n=1))$$,'42501',null,'chain cannot be read under a different form');
reset role;
select is((select count(*)::integer from public.questionnaire_assessment_versions where client_id='a7800000-0000-4000-8000-000000000001'),44,'all originals and revisions persisted');
select ok(not exists(select 1 from public.audit_events where metadata->>'workflow' like 'questionnaire_assessment_%' and metadata ?| array['answers','context','client_id','assessment_key']),'read audit excludes answers context and scope identifiers');
select is((select count(*)::integer from public.questionnaire_assessment_versions where client_id='a7800000-0000-4000-8000-000000000001' and record_state<>'draft'),0,'new read flow does not create signed records');
update public.client_assignments set ends_at=clock_timestamp()-interval '1 second' where client_id='a7800000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select pg_temp.history_list()$$,'42501',null,'revoked assignment prevents subsequent list reads');
select throws_ok($$select public.questionnaire_assessment_history('a7500000-0000-4000-8000-000000000001','a7600000-0000-4000-8000-000000000001','spmsq','a7800000-0000-4000-8000-000000000001',(select (receipt->>'assessmentKey')::uuid from history_receipts where n=1))$$,'42501',null,'revoked assignment prevents subsequent history reads');
select throws_ok($$select public.questionnaire_assessment_snapshot('a7500000-0000-4000-8000-000000000001','a7600000-0000-4000-8000-000000000001','spmsq','a7800000-0000-4000-8000-000000000001')$$,'42501',null,'revoked assignment prevents snapshot reads');
select * from finish();
rollback;
