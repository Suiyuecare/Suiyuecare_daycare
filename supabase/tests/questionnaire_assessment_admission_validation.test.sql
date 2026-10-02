begin;
select plan(40);
set local time zone 'Asia/Taipei';
select set_config('test.questionnaire_json_amr',floor(extract(epoch from clock_timestamp()-interval '2 minutes'))::text,true);

-- Synthetic actual Google admission, including a second active organization
-- membership/assignment. Membership alone must not expand the pinned approval.
insert into auth.users(id,aud,role,email,email_confirmed_at,created_at,updated_at) values
 ('b8100000-0000-4000-8000-000000000001','authenticated','authenticated','json-nurse@care.example.invalid',now()-interval '1 day',now()-interval '1 day',now());
insert into auth.identities(id,provider_id,user_id,identity_data,provider) values
 ('b8200000-0000-4000-8000-000000000001','synthetic-json-nurse','b8100000-0000-4000-8000-000000000001',
 '{"sub":"synthetic-json-nurse","email":"json-nurse@care.example.invalid","email_verified":true,"hd":"care.example.invalid"}','google');
insert into auth.sessions(id,user_id,created_at,aal) values
 ('b8300000-0000-4000-8000-000000000001','b8100000-0000-4000-8000-000000000001',now()-interval '3 minutes','aal1');
insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method) values
 ('b8400000-0000-4000-8000-000000000001','b8300000-0000-4000-8000-000000000001',
 to_timestamp(current_setting('test.questionnaire_json_amr')::bigint),to_timestamp(current_setting('test.questionnaire_json_amr')::bigint),'oauth');
insert into public.organizations(id,code,name) values
 ('b8500000-0000-4000-8000-000000000001','questionnaire_json_test','Synthetic approved organization'),
 ('b8500000-0000-4000-8000-000000000002','questionnaire_json_other','Synthetic unapproved organization');
insert into public.branches(id,organization_id,code,name) values
 ('b8600000-0000-4000-8000-000000000001','b8500000-0000-4000-8000-000000000001','main','Synthetic approved branch'),
 ('b8600000-0000-4000-8000-000000000002','b8500000-0000-4000-8000-000000000002','other','Synthetic other branch');
insert into public.profiles(id,display_name,kind) values
 ('b8100000-0000-4000-8000-000000000001','Synthetic questionnaire nurse','staff');
insert into public.memberships(id,organization_id,branch_id,profile_id,status,starts_at) values
 ('b8700000-0000-4000-8000-000000000001','b8500000-0000-4000-8000-000000000001','b8600000-0000-4000-8000-000000000001','b8100000-0000-4000-8000-000000000001','active',now()-interval '1 day'),
 ('b8700000-0000-4000-8000-000000000002','b8500000-0000-4000-8000-000000000002','b8600000-0000-4000-8000-000000000002','b8100000-0000-4000-8000-000000000001','active',now()-interval '1 day');
insert into public.membership_roles(membership_id,role_id)
 select m.id,r.id from public.memberships m cross join public.roles r
 where m.id in ('b8700000-0000-4000-8000-000000000001','b8700000-0000-4000-8000-000000000002') and r.role_key='nurse' and r.is_system;
insert into private.staff_google_access_grants(allowed_user_id,organization_id,company_email_domain,allowed_email,google_subject,enabled,approval_reference)
 values('b8100000-0000-4000-8000-000000000001','b8500000-0000-4000-8000-000000000001','care.example.invalid','json-nurse@care.example.invalid','synthetic-json-nurse',true,'Synthetic JSON validation approval');
insert into public.clients(id,organization_id,branch_id,client_code,display_name) values
 ('b8800000-0000-4000-8000-000000000001','b8500000-0000-4000-8000-000000000001','b8600000-0000-4000-8000-000000000001','SYN-JSON-1','Synthetic assigned client'),
 ('b8800000-0000-4000-8000-000000000002','b8500000-0000-4000-8000-000000000002','b8600000-0000-4000-8000-000000000002','SYN-JSON-2','Synthetic other assigned client');
insert into public.client_assignments(organization_id,branch_id,client_id,assignee_user_id,assignment_kind,starts_at) values
 ('b8500000-0000-4000-8000-000000000001','b8600000-0000-4000-8000-000000000001','b8800000-0000-4000-8000-000000000001','b8100000-0000-4000-8000-000000000001','synthetic-json',now()-interval '1 day'),
 ('b8500000-0000-4000-8000-000000000002','b8600000-0000-4000-8000-000000000002','b8800000-0000-4000-8000-000000000002','b8100000-0000-4000-8000-000000000001','synthetic-json',now()-interval '1 day');

create function pg_temp.json_login() returns boolean language plpgsql security invoker as $$ begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub','b8100000-0000-4000-8000-000000000001','session_id','b8300000-0000-4000-8000-000000000001',
 'aud','authenticated','role','authenticated','aal','aal1','email','json-nurse@care.example.invalid','is_anonymous',false,
 'iat',floor(extract(epoch from clock_timestamp())),'exp',floor(extract(epoch from clock_timestamp()+interval '30 minutes')),
 'amr',jsonb_build_array(jsonb_build_object('method','oauth','timestamp',current_setting('test.questionnaire_json_amr')::bigint)))::text,true);
 return public.is_staff_login_allowed(); end; $$;
create function pg_temp.json_payload(p_form text default 'spmsq') returns jsonb language sql security invoker as $$
 select jsonb_build_object('action','create','client_id','b8800000-0000-4000-8000-000000000001','form_key',p_form,
 'form_version',case p_form when 'spmsq' then 'spmsq-pfeiffer-10-education-adjusted-v1' when 'barthel_adl' then 'barthel-adl-0-100-v1' else 'mna-sf-revised-2009-traditional-chinese-v1' end,
 'assessed_on','2026-09-25','context',case when p_form='mna_sf' then '{"height_cm":"160","weight_kg":"60"}'::jsonb else '{}'::jsonb end,
 'answers',case p_form when 'spmsq' then (select jsonb_object_agg('spmsq_'||lpad(n::text,2,'0'),'{"state":"answered","value":"correct"}'::jsonb) from generate_series(1,10)n)
 when 'barthel_adl' then (select jsonb_object_agg(k,'{"state":"missing"}'::jsonb) from unnest(array['feeding','bathing','grooming','dressing','bowels','bladder','toilet_use','transfers','mobility','stairs'])k)
 else '{"food_intake":{"state":"missing"},"weight_loss":{"state":"missing"},"mobility":{"state":"missing"},"acute_stress_or_disease":{"state":"missing"},"neuropsychological":{"state":"missing"},"anthropometry":{"state":"answered","value":"bmi_gte_23"}}'::jsonb end);
$$;
create temporary table json_receipts(name text primary key,receipt jsonb not null);
create temporary table json_invalid_cases(n integer primary key,label text,code text,payload jsonb);
create temporary table json_counts(name text primary key,versions integer,operations integer,audits integer);
grant select,insert,update on json_receipts to authenticated;
grant select on json_invalid_cases to authenticated;
insert into json_invalid_cases values
 (1,'missing answer state','22023',jsonb_set(pg_temp.json_payload(),'{answers,spmsq_01}','{"value":"correct"}')),
 (2,'null answer state','22023',jsonb_set(pg_temp.json_payload(),'{answers,spmsq_01}','{"state":null,"value":"correct"}')),
 (3,'numeric answer state','22023',jsonb_set(pg_temp.json_payload(),'{answers,spmsq_01}','{"state":1,"value":"correct"}')),
 (4,'numeric answer value','22023',jsonb_set(pg_temp.json_payload(),'{answers,spmsq_01}','{"state":"answered","value":1}')),
 (5,'null answer value','22023',jsonb_set(pg_temp.json_payload(),'{answers,spmsq_01}','{"state":"answered","value":null}')),
 (6,'numeric not-applicable reason','22023',jsonb_set(pg_temp.json_payload('barthel_adl'),'{answers,feeding}','{"state":"not_applicable","reason":123}')),
 (7,'null not-applicable reason','22023',jsonb_set(pg_temp.json_payload('barthel_adl'),'{answers,feeding}','{"state":"not_applicable","reason":null}')),
 (8,'numeric measurement context','23514',jsonb_set(pg_temp.json_payload('mna_sf'),'{context}','{"height_cm":160,"weight_kg":60}')),
 (9,'null measurement context','23514',jsonb_set(pg_temp.json_payload('mna_sf'),'{context}','{"height_cm":null,"weight_kg":null}')),
 (10,'boolean measurement context','23514',jsonb_set(pg_temp.json_payload('mna_sf'),'{context}','{"height_cm":true,"weight_kg":"60"}')),
 (11,'null education context','23514',jsonb_set(pg_temp.json_payload(),'{context}','{"education_adjustment":null}')),
 (12,'array education context','23514',jsonb_set(pg_temp.json_payload(),'{context}','{"education_adjustment":[]}')),
 (13,'null qualitative note','23514',jsonb_set(pg_temp.json_payload(),'{context}','{"qualitative_note":null}'));

select is((select count(*)::integer from pg_constraint where conrelid='public.questionnaire_assessment_versions'::regclass
 and conname in ('questionnaire_answers_strict_json','questionnaire_context_strict_json') and not convalidated),2,'strict NOT VALID checks preserve historical upgrade gate');
select ok(not has_function_privilege('authenticated','private.questionnaire_answers_valid(text,jsonb)','execute')
 and not has_function_privilege('authenticated','private.questionnaire_assessment_authority(uuid,uuid,uuid,text,text)','execute'),'internal validators and authority have no direct authenticated execute grant');
set local role authenticated;
select is(pg_temp.json_login(),true,'actual approved Google AAL1 staff is admitted without an auth stub');
insert into json_receipts values('original',public.mutate_questionnaire_assessment('b8500000-0000-4000-8000-000000000001','b8600000-0000-4000-8000-000000000001',pg_temp.json_payload(),'b8900000-0000-4000-8000-000000000001'));
select is((select receipt->>'recordState' from json_receipts where name='original'),'draft','valid AAL1 answer record remains an unsigned draft');
select lives_ok($$select public.questionnaire_assessment_snapshot('b8500000-0000-4000-8000-000000000001','b8600000-0000-4000-8000-000000000001','spmsq','b8800000-0000-4000-8000-000000000001')$$,'valid answers remain readable');
select is(public.mutate_questionnaire_assessment('b8500000-0000-4000-8000-000000000001','b8600000-0000-4000-8000-000000000001',pg_temp.json_payload(),'b8900000-0000-4000-8000-000000000001')->>'versionId',
 (select receipt->>'versionId' from json_receipts where name='original'),'same request still replays the original version');
insert into json_receipts select 'revision',public.mutate_questionnaire_assessment('b8500000-0000-4000-8000-000000000001','b8600000-0000-4000-8000-000000000001',
 pg_temp.json_payload()||jsonb_build_object('action','revise','assessment_key',receipt->>'assessmentKey','previous_version_id',receipt->>'versionId','expected_version',1),'b8900000-0000-4000-8000-000000000002') from json_receipts where name='original';
select is((select (receipt->>'version')::integer from json_receipts where name='revision'),2,'valid revision retains the immutable chain');
select is((public.questionnaire_assessment_history('b8500000-0000-4000-8000-000000000001','b8600000-0000-4000-8000-000000000001','spmsq','b8800000-0000-4000-8000-000000000001',(select (receipt->>'assessmentKey')::uuid from json_receipts where name='original'))->>'total')::integer,2,'valid original and revision remain in history');
select lives_ok($$select public.mutate_questionnaire_assessment('b8500000-0000-4000-8000-000000000001','b8600000-0000-4000-8000-000000000001',pg_temp.json_payload('mna_sf'),'b8900000-0000-4000-8000-000000000003')$$,'valid string BMI context remains accepted');
select lives_ok($$select public.mutate_questionnaire_assessment('b8500000-0000-4000-8000-000000000001','b8600000-0000-4000-8000-000000000001',jsonb_set(pg_temp.json_payload('barthel_adl'),'{answers,feeding}','{"state":"not_applicable","reason":"Synthetic valid reason"}'),'b8900000-0000-4000-8000-000000000004')$$,'legitimate string not-applicable reason remains accepted');
reset role;
insert into json_counts select 'before-negative',
 (select count(*)::integer from public.questionnaire_assessment_versions),(select count(*)::integer from private.questionnaire_assessment_operations),(select count(*)::integer from public.audit_events);
set local role authenticated;
select throws_ok(format('select public.mutate_questionnaire_assessment(%L,%L,%L::jsonb,%L::uuid)',
 'b8500000-0000-4000-8000-000000000001','b8600000-0000-4000-8000-000000000001',payload::text,'b8a00000-0000-4000-8000-'||lpad(n::text,12,'0')),code,null,label||' is rejected by direct authenticated RPC') from json_invalid_cases order by n;
select throws_ok($$select public.questionnaire_assessment_snapshot('b8500000-0000-4000-8000-000000000002','b8600000-0000-4000-8000-000000000002','spmsq','b8800000-0000-4000-8000-000000000002')$$,'42501',null,'staff admission cannot cross its pinned organization for snapshot');
select throws_ok($$select public.questionnaire_assessment_list('b8500000-0000-4000-8000-000000000002','b8600000-0000-4000-8000-000000000002','spmsq','b8800000-0000-4000-8000-000000000002')$$,'42501',null,'active second membership and assignment cannot expand admission for list');
select throws_ok($$select public.questionnaire_assessment_history('b8500000-0000-4000-8000-000000000002','b8600000-0000-4000-8000-000000000002','spmsq','b8800000-0000-4000-8000-000000000002','b8b00000-0000-4000-8000-000000000001')$$,'42501',null,'staff history cannot cross the pinned organization');
select throws_ok($$select public.mutate_questionnaire_assessment('b8500000-0000-4000-8000-000000000002','b8600000-0000-4000-8000-000000000002',pg_temp.json_payload()||'{"client_id":"b8800000-0000-4000-8000-000000000002"}'::jsonb,'b8b00000-0000-4000-8000-000000000002')$$,'42501',null,'staff write cannot cross admission even with permission and assignment');
reset role;
select is((select count(*)::integer from public.questionnaire_assessment_versions),(select versions from json_counts where name='before-negative'),'all malformed and cross-admission calls create zero versions');
select is((select count(*)::integer from private.questionnaire_assessment_operations),(select operations from json_counts where name='before-negative'),'all negative calls create zero operation receipts');
select is((select count(*)::integer from public.audit_events),(select audits from json_counts where name='before-negative'),'all rejected calls create zero audit events');
select ok(not exists(select 1 from public.questionnaire_assessment_versions where private.questionnaire_answers_valid(form_key,answers) is not true
 or private.questionnaire_context_valid(form_key,answers,context) is not true),'valid immutable originals and revisions still satisfy strict JSON');
select is(private.questionnaire_context_valid('spmsq','{}','{"education_adjustment":null}'),false,'null education returns false rather than SQL NULL');
select is(private.questionnaire_context_valid('mna_sf','{"anthropometry":{"state":"answered","value":"bmi_gte_23"}}','{"height_cm":null,"weight_kg":null}'),false,'null BMI returns false rather than SQL NULL');

-- The independently pinned executive path must still work at AAL1 without a
-- routine staff grant; this provisions a synthetic real policy, never a stub.
update private.staff_google_access_grants set enabled=false where allowed_user_id='b8100000-0000-4000-8000-000000000001';
insert into private.executive_access_policy(allowed_user_id,allowed_email,google_subject,enabled,approval_reference)
 values('b8100000-0000-4000-8000-000000000001','json-nurse@care.example.invalid','synthetic-json-nurse',true,'Synthetic independently approved executive');
set local role authenticated;
select is(pg_temp.json_login(),true,'independently pinned executive Google AAL1 admission remains valid');
select lives_ok($$select public.mutate_questionnaire_assessment('b8500000-0000-4000-8000-000000000002','b8600000-0000-4000-8000-000000000002',pg_temp.json_payload()||'{"client_id":"b8800000-0000-4000-8000-000000000002"}'::jsonb,'b8c00000-0000-4000-8000-000000000001')$$,'executive exception retains scoped membership and assignment write authority');
reset role;
update public.memberships set ends_at=clock_timestamp()-interval '1 second' where id='b8700000-0000-4000-8000-000000000002';
insert into json_counts select 'before-executive-negative',(select count(*)::integer from public.questionnaire_assessment_versions),(select count(*)::integer from private.questionnaire_assessment_operations),(select count(*)::integer from public.audit_events);
set local role authenticated;
select throws_ok($$select public.questionnaire_assessment_snapshot('b8500000-0000-4000-8000-000000000002','b8600000-0000-4000-8000-000000000002','spmsq','b8800000-0000-4000-8000-000000000002')$$,'42501',null,'executive admission does not bypass expired target membership');
select throws_ok($$select public.mutate_questionnaire_assessment('b8500000-0000-4000-8000-000000000002','b8600000-0000-4000-8000-000000000002',pg_temp.json_payload()||'{"client_id":"b8800000-0000-4000-8000-000000000002"}'::jsonb,'b8c00000-0000-4000-8000-000000000002')$$,'42501',null,'executive write also fails when scoped membership ends');
reset role;
select is((select count(*)::integer from public.questionnaire_assessment_versions),(select versions from json_counts where name='before-executive-negative'),'revoked executive scope creates zero versions');
select is((select count(*)::integer from private.questionnaire_assessment_operations),(select operations from json_counts where name='before-executive-negative'),'revoked executive scope creates zero receipts');
select is((select count(*)::integer from public.audit_events),(select audits from json_counts where name='before-executive-negative'),'revoked executive scope creates zero audit events');
select * from finish();
rollback;
