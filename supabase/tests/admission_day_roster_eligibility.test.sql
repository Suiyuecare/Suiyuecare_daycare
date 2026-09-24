begin;
select plan(70);
select set_config('test.roster_amr',floor(extract(epoch from clock_timestamp()-interval '2 minutes'))::text,true);
insert into auth.users(id,aud,role,email,email_confirmed_at,created_at,updated_at) values
('c1100000-0000-4000-8000-000000000001','authenticated','authenticated','roster-manager@example.invalid',now(),now(),now()),
('c1100000-0000-4000-8000-000000000002','authenticated','authenticated','roster-worker@example.invalid',now(),now(),now());
insert into auth.identities(id,provider_id,user_id,identity_data,provider)
select gen_random_uuid(),'roster-'||n,('c1100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
jsonb_build_object('sub','roster-'||n,'email',case when n=1 then 'roster-manager@example.invalid' else 'roster-worker@example.invalid' end,'email_verified',true),'google' from generate_series(1,2)n;
insert into auth.sessions(id,user_id,created_at,aal) select ('c1200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('c1100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,now()-interval '3 minutes','aal2' from generate_series(1,2)n;
insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method)
select gen_random_uuid(),('c1200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,to_timestamp(current_setting('test.roster_amr')::bigint),to_timestamp(current_setting('test.roster_amr')::bigint),method from generate_series(1,2)n cross join unnest(array['oauth','totp'])method;
insert into public.organizations(id,code,name) values('c1300000-0000-4000-8000-000000000001','roster-synthetic','合成機構');
insert into public.branches(id,organization_id,code,name) values('c1400000-0000-4000-8000-000000000001','c1300000-0000-4000-8000-000000000001','main','合成分支');
insert into public.profiles(id,display_name,kind) values('c1100000-0000-4000-8000-000000000001','合成主管','staff'),('c1100000-0000-4000-8000-000000000002','合成照服員','staff');
insert into public.memberships(id,organization_id,branch_id,profile_id,status,starts_at)
select ('c1500000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'c1300000-0000-4000-8000-000000000001','c1400000-0000-4000-8000-000000000001',('c1100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'active',now()-interval '1 year' from generate_series(1,2)n;
insert into public.membership_roles(membership_id,role_id) values
('c1500000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003'),
('c1500000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000006');
insert into public.clients(id,organization_id,branch_id,client_code,display_name,admitted_on)
select ('c1600000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'c1300000-0000-4000-8000-000000000001','c1400000-0000-4000-8000-000000000001','C-'||n,'合成個案'||n,'2026-01-01' from generate_series(1,2)n;
insert into public.client_assignments(organization_id,branch_id,client_id,assignee_user_id,assignment_kind,starts_at)
values('c1300000-0000-4000-8000-000000000001','c1400000-0000-4000-8000-000000000001','c1600000-0000-4000-8000-000000000001','c1100000-0000-4000-8000-000000000002','care',now()-interval '1 year');
insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,created_at,expires_at,consumed_at,consumed_jwt_iat,factor_method,factor_verified_at)
values('c1700000-0000-4000-8000-000000000001','c1100000-0000-4000-8000-000000000001','c1200000-0000-4000-8000-000000000001',repeat('1',64),gen_random_uuid(),now()-interval '2 minutes',now()-interval '2 minutes',now()+interval '5 minutes',now()-interval '1 minute',now()-interval '1 minute','totp',now()-interval '1 minute');
insert into private.reauth_events(user_id,session_id,challenge_id,aal,verification_method,verified_at)
values('c1100000-0000-4000-8000-000000000001','c1200000-0000-4000-8000-000000000001','c1700000-0000-4000-8000-000000000001','aal2','totp',now()-interval '1 minute');
create function pg_temp.roster_claim(p_n integer default 1) returns void language plpgsql as $$ begin
perform set_config('request.jwt.claims',jsonb_build_object('sub','c1100000-0000-4000-8000-'||lpad(p_n::text,12,'0'),'session_id','c1200000-0000-4000-8000-'||lpad(p_n::text,12,'0'),'role','authenticated','aud','authenticated','aal','aal2','is_anonymous',false,'email',case when p_n=1 then 'roster-manager@example.invalid' else 'roster-worker@example.invalid' end,'iat',floor(extract(epoch from now())),'exp',floor(extract(epoch from now()+interval '30 minutes')),'amr',jsonb_build_array(jsonb_build_object('method','oauth','timestamp',current_setting('test.roster_amr')::bigint),jsonb_build_object('method','totp','timestamp',current_setting('test.roster_amr')::bigint)))::text,true); end; $$;
create function pg_temp.roster_input(p_overrides jsonb default '{}') returns jsonb language sql as $$ select '{"clientId":"c1600000-0000-4000-8000-000000000001","serviceDate":"2026-09-12","shift":"morning","staffUserId":"c1100000-0000-4000-8000-000000000002","expectedVersion":0,"state":"scheduled","sourceNote":"已確認合成照顧計畫","tasks":["temperature","blood_pressure","care_diary"],"approved":true,"idempotency_key":"c1800000-0000-4000-8000-000000000001"}'::jsonb||p_overrides; $$;
create function pg_temp.roster_save(p_overrides jsonb default '{}') returns jsonb language sql as $$ select receipt from public.save_care_roster('c1300000-0000-4000-8000-000000000001','c1400000-0000-4000-8000-000000000001',pg_temp.roster_input(p_overrides)); $$;
create function pg_temp.roster_read() returns jsonb language sql as $$ select payload from public.care_roster_snapshot('c1300000-0000-4000-8000-000000000001','c1400000-0000-4000-8000-000000000001','2026-09-12'); $$;
select pg_temp.roster_claim();
set local role authenticated;
select throws_ok($$select pg_temp.roster_save()$$,'42501',null,'current executive admission remains fail closed');
reset role;
insert into private.executive_access_policy(allowed_user_id,allowed_email,google_subject,enabled,approval_reference)
values('c1100000-0000-4000-8000-000000000001','roster-manager@example.invalid','roster-1',true,'synthetic roster test');

reset role;
insert into public.clients(id,organization_id,branch_id,client_code,display_name,status,admitted_on,ended_on) values
 ('c1600000-0000-4000-8000-000000000003','c1300000-0000-4000-8000-000000000001','c1400000-0000-4000-8000-000000000001','C-3','合成待收案','active',null,null),
 ('c1600000-0000-4000-8000-000000000004','c1300000-0000-4000-8000-000000000001','c1400000-0000-4000-8000-000000000001','C-4','合成未到收案日','active','2026-10-01',null),
 ('c1600000-0000-4000-8000-000000000005','c1300000-0000-4000-8000-000000000001','c1400000-0000-4000-8000-000000000001','C-5','合成既有暫停','suspended','2026-01-01',null),
 ('c1600000-0000-4000-8000-000000000006','c1300000-0000-4000-8000-000000000001','c1400000-0000-4000-8000-000000000001','C-6','合成既有結案','closed','2026-01-01','2026-09-12'),
 ('c1600000-0000-4000-8000-000000000007','c1300000-0000-4000-8000-000000000001','c1400000-0000-4000-8000-000000000001','C-7','合成當日收案','active','2026-09-12',null);
insert into public.client_assignments(organization_id,branch_id,client_id,assignee_user_id,assignment_kind,starts_at)
select organization_id,branch_id,id,'c1100000-0000-4000-8000-000000000002','care',now()-interval '1 year' from public.clients where client_code in ('C-3','C-5');
-- Plans remain preparatory: even an explicit planned attendance cannot admit.
insert into private.client_weekly_versions(organization_id,branch_id,client_id,version,effective_from,plan,created_by)
select organization_id,branch_id,id,1,'2026-01-01',
 jsonb_build_object('effectiveFrom','2026-01-01','effectiveTo',null,'reason','合成既有週表',
 'days',(select jsonb_agg(jsonb_build_object('weekday',n,'attending',true,'startsAt','09:00','endsAt','16:00','outbound',null,'inbound',null)) from generate_series(1,7)n)),
 'c1100000-0000-4000-8000-000000000001' from public.clients where organization_id='c1300000-0000-4000-8000-000000000001';
create function pg_temp.read_day(p_date date default '2026-09-12') returns jsonb language sql as $$
 select payload from public.care_roster_snapshot('c1300000-0000-4000-8000-000000000001','c1400000-0000-4000-8000-000000000001',p_date);
$$;
create function pg_temp.weekly_state(p_client uuid,p_date date default '2026-09-12') returns text language sql as $$
 select payload->'days'->0->>'status' from public.client_weekly_snapshot('c1300000-0000-4000-8000-000000000001','c1400000-0000-4000-8000-000000000001',p_client,p_date);
$$;
create function pg_temp.transition(p_kind public.client_transition_kind,p_date date,p_expected bigint default 1,p_client uuid default 'c1600000-0000-4000-8000-000000000001') returns jsonb language sql as $$
 select to_jsonb(t) from public.transition_client('c1300000-0000-4000-8000-000000000001','c1400000-0000-4000-8000-000000000001',p_client,p_kind,p_date,'合成狀態異動理由','合成交接',
 p_expected,gen_random_uuid())t;
$$;
select ok(not has_function_privilege('authenticated','private.client_service_state_on(uuid,date)','execute'),'unscoped eligibility helper is not browser callable');
select ok(not has_function_privilege('service_role','private.assert_care_roster_authority(uuid,uuid,uuid)','execute'),'worker key has no roster authority bypass');
select ok(not (select prosecdef from pg_proc where oid='public.save_care_roster(uuid,uuid,jsonb)'::regprocedure),'public roster writer remains invoker');
select is(private.client_service_state_on('c1600000-0000-4000-8000-000000000003','2026-09-12'),'not_admitted','a client record with no admission is not eligible');
select is(private.client_service_state_on('c1600000-0000-4000-8000-000000000004','2026-09-12'),'not_admitted','future admission date is not brought forward');
select is(private.client_service_state_on('c1600000-0000-4000-8000-000000000005','2026-09-12'),'inactive','legacy suspended client stays ineligible without fabricated history');
select is(private.client_service_state_on('c1600000-0000-4000-8000-000000000006','2026-09-12'),'inactive','closure date itself is a blocking boundary');
select is(private.client_service_state_on('c1600000-0000-4000-8000-000000000007','2026-09-12'),'eligible','admission day itself is eligible');
set local role authenticated;
select throws_ok($$select pg_temp.roster_save(jsonb_build_object('clientId','c1600000-0000-4000-8000-000000000003','staffUserId',null,'idempotency_key',gen_random_uuid()))$$,'23514',null,'cannot allocate unadmitted client even with a weekly plan');
select throws_ok($$select pg_temp.roster_save(jsonb_build_object('clientId','c1600000-0000-4000-8000-000000000004','staffUserId',null,'idempotency_key',gen_random_uuid()))$$,'23514',null,'cannot allocate before future admission date');
select throws_ok($$select pg_temp.roster_save(jsonb_build_object('clientId','c1600000-0000-4000-8000-000000000005','staffUserId',null,'idempotency_key',gen_random_uuid()))$$,'23514',null,'cannot allocate suspended client');
select throws_ok($$select pg_temp.roster_save(jsonb_build_object('clientId','c1600000-0000-4000-8000-000000000006','staffUserId',null,'idempotency_key',gen_random_uuid()))$$,'23514',null,'cannot allocate closed client on closure date');
select is(pg_temp.weekly_state('c1600000-0000-4000-8000-000000000003'),'not_admitted','weekly expected uses same pending-admission boundary');
select is(pg_temp.weekly_state('c1600000-0000-4000-8000-000000000004'),'not_admitted','weekly expected excludes future admission');
select is(pg_temp.weekly_state('c1600000-0000-4000-8000-000000000005'),'inactive','weekly expected excludes suspension');
select is(pg_temp.weekly_state('c1600000-0000-4000-8000-000000000006'),'inactive','weekly expected excludes closure date');
select is(pg_temp.roster_save()->>'version','1','eligible admitted client can be explicitly allocated');
select is(pg_temp.roster_save()->>'replayed','true','same operation replays without another allocation');
select throws_ok($$select pg_temp.roster_save('{"sourceNote":"另一個安排依據"}')$$,'23505',null,'same idempotency key cannot be reused for changed payload');
select throws_ok($$select pg_temp.roster_save(jsonb_build_object('idempotency_key',gen_random_uuid()))$$,'40001',null,'same base with another key reports conflict');
select is(pg_temp.read_day()->'assignments'->0->>'isServiceEligible','true','manager receives explicit service eligibility');
select is(pg_temp.read_day()->'assignments'->0->>'serviceEligibility','eligible','manager receives explicit eligibility reason code');
reset role;
select is((select count(*)::integer from public.client_transitions),0,'allocation never creates admission or any lifecycle transition');
select is((select admitted_on from public.clients where client_code='C-3'),null::date,'failed allocation leaves pending admission unchanged');
select is((select count(*)::integer from private.care_roster_versions),1,'failed requests and replay do not add versions');
-- Simulate pre-fix invalid rows, not an authorized new scheduling action.
insert into private.care_roster_versions(organization_id,branch_id,client_id,service_date,shift,staff_user_id,version,state,source_note,tasks,created_by)
select organization_id,branch_id,id,'2026-09-12','morning','c1100000-0000-4000-8000-000000000002',1,'scheduled','合成修復前分工','["temperature"]','c1100000-0000-4000-8000-000000000001'
from public.clients where client_code in ('C-3','C-5');
set local role authenticated;
select is(jsonb_array_length(pg_temp.read_day()->'assignments'),3,'manager retains blocked allocations so they can be repaired');
select is((select a->>'state' from jsonb_array_elements(pg_temp.read_day()->'assignments')a where a->>'clientId'='c1600000-0000-4000-8000-000000000003'),'scheduled','read does not silently rewrite scheduled as cancelled');
select is((select a->>'isServiceEligible' from jsonb_array_elements(pg_temp.read_day()->'assignments')a where a->>'clientId'='c1600000-0000-4000-8000-000000000003'),'false','blocked allocation is explicitly ineligible');
select is((select a->'tasks'->0->>'status' from jsonb_array_elements(pg_temp.read_day()->'assignments')a where a->>'clientId'='c1600000-0000-4000-8000-000000000003'),'restricted','blocked tasks expose no care completion evidence');
select is((select a->'tasks'->0->>'evidenceAt' from jsonb_array_elements(pg_temp.read_day()->'assignments')a where a->>'clientId'='c1600000-0000-4000-8000-000000000003'),null,'blocked tasks do not contain a care evidence timestamp');
select throws_ok($$select pg_temp.roster_save(jsonb_build_object('clientId','c1600000-0000-4000-8000-000000000003','expectedVersion',1,'idempotency_key',gen_random_uuid()))$$,'23514',null,'existing invalid allocation cannot be rescheduled');
select lives_ok($$select pg_temp.roster_save(jsonb_build_object('clientId','c1600000-0000-4000-8000-000000000003','staffUserId',null,'state','cancelled','expectedVersion',1,'tasks','[]'::jsonb,'idempotency_key',gen_random_uuid()))$$,'manager can cancel an existing blocked allocation without admitting client');
select is((select a->>'state' from jsonb_array_elements(pg_temp.read_day()->'assignments')a where a->>'clientId'='c1600000-0000-4000-8000-000000000003'),'cancelled','repair appends a visible cancellation');
select throws_ok($$select pg_temp.roster_save(jsonb_build_object('clientId','c1600000-0000-4000-8000-000000000004','staffUserId',null,'state','cancelled','idempotency_key',gen_random_uuid()))$$,'22023',null,'cannot invent a cancellation for a nonexistent allocation');
reset role;
update private.executive_access_policy set allowed_user_id='c1100000-0000-4000-8000-000000000002',allowed_email='roster-worker@example.invalid',google_subject='roster-2';
select pg_temp.roster_claim(2);
set local role authenticated;
select is(jsonb_array_length(pg_temp.read_day()->'assignments'),1,'care worker sees only eligible own allocation, not blocked work');
select is(pg_temp.read_day()->'assignments'->0->>'clientId','c1600000-0000-4000-8000-000000000001','care worker only receives the eligible client');
select is(pg_temp.read_day()->'staffOptions','[]'::jsonb,'care worker cannot enumerate staff options');
select throws_ok($$select pg_temp.roster_save()$$,'42501',null,'care worker cannot repair or schedule allocations');
reset role;
update private.executive_access_policy set allowed_user_id='c1100000-0000-4000-8000-000000000001',allowed_email='roster-manager@example.invalid',google_subject='roster-1';
select pg_temp.roster_claim();
set local role authenticated;
-- Allocate tomorrow-in-the-fixture before the suspension is recorded.
select lives_ok($$select pg_temp.roster_save(jsonb_build_object('serviceDate','2026-09-13','idempotency_key',gen_random_uuid()))$$,'eligible date may be explicitly allocated before lifecycle changes');
select lives_ok($$select pg_temp.transition('suspend','2026-09-13')$$,'real lifecycle RPC records effective suspension');
select is(pg_temp.weekly_state('c1600000-0000-4000-8000-000000000001','2026-09-12'),'scheduled','later suspension does not erase prior eligible planned day');
select is(pg_temp.weekly_state('c1600000-0000-4000-8000-000000000001','2026-09-13'),'inactive','suspension effective date is excluded');
select is(pg_temp.read_day('2026-09-12')->'assignments'->0->>'isServiceEligible','true','historical roster remains eligible before suspension');
select is(pg_temp.read_day('2026-09-13')->'assignments'->0->>'isServiceEligible','false','manager sees earlier allocation blocked on suspension date');
select throws_ok($$select pg_temp.roster_save(jsonb_build_object('serviceDate','2026-09-13','expectedVersion',1,'idempotency_key',gen_random_uuid()))$$,'23514',null,'fresh write cannot reactivate suspended date');
select lives_ok($$select pg_temp.transition('resume','2026-09-14',2)$$,'real lifecycle RPC records later resumption');
select is(pg_temp.weekly_state('c1600000-0000-4000-8000-000000000001','2026-09-13'),'inactive','current active status does not erase a past suspension interval');
select is(pg_temp.weekly_state('c1600000-0000-4000-8000-000000000001','2026-09-14'),'scheduled','resumption effective date is included');
select lives_ok($$select pg_temp.roster_save(jsonb_build_object('serviceDate','2026-09-14','idempotency_key',gen_random_uuid()))$$,'resumed day may be explicitly allocated');
select lives_ok($$select pg_temp.transition('suspend','2026-09-14',3)$$,'same-day second transition remains ordered by row version');
select is(pg_temp.weekly_state('c1600000-0000-4000-8000-000000000001','2026-09-14'),'inactive','last same-day transition governs requested date');
select lives_ok($$select pg_temp.transition('resume','2026-09-14',4)$$,'same-day final explicit resume is a separate immutable event');
select is(pg_temp.weekly_state('c1600000-0000-4000-8000-000000000001','2026-09-14'),'scheduled','same-day final state is deterministic');
select lives_ok($$select pg_temp.transition('close','2026-09-15',5)$$,'real lifecycle RPC records closure');
select is(pg_temp.weekly_state('c1600000-0000-4000-8000-000000000001','2026-09-14'),'scheduled','later closure preserves prior eligible history');
select is(pg_temp.weekly_state('c1600000-0000-4000-8000-000000000001','2026-09-15'),'inactive','closure effective day is excluded from expected attendance');
select throws_ok($$select pg_temp.roster_save(jsonb_build_object('serviceDate','2026-09-15','idempotency_key',gen_random_uuid()))$$,'23514',null,'cannot allocate on closure day');
select is(pg_temp.roster_save()->>'replayed','true','receipt replay after closure proves original operation without recreating service');
reset role;
select is((select count(*)::integer from public.attendance_records),0,'planning and status projections never create attendance');
select is((select count(*)::integer from public.client_transitions),5,'only five explicit lifecycle commands created transitions');
select is((select count(*)::integer from public.client_assignments where assignee_user_id='c1100000-0000-4000-8000-000000000002'),3,'roster never expands target client authorization');
select throws_ok($$update private.care_roster_versions set state='cancelled'$$,'55000',null,'historical allocation evidence remains append only');
select throws_ok($$delete from private.care_roster_operations$$,'55000',null,'idempotent receipts remain append only');
select ok(not exists(select 1 from public.audit_events where table_name like 'care_roster%' and metadata::text like '%合成%'),'roster audit contains no care text or raw notes');
update public.organizations set is_active=false where id='c1300000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select pg_temp.roster_save()$$,'42501',null,'disabled organization cannot replay old write receipt');
select throws_ok($$select pg_temp.read_day()$$,'42501',null,'disabled organization cannot read allocation metadata');
select throws_ok($$select pg_temp.weekly_state('c1600000-0000-4000-8000-000000000001')$$,'42501',null,'disabled organization cannot read weekly plan');
select throws_ok($$select public.client_weekly_projection('c1300000-0000-4000-8000-000000000001','c1400000-0000-4000-8000-000000000001','2026-09-12')$$,'42501',null,'disabled organization cannot read expected attendance');
reset role;
update public.organizations set is_active=true where id='c1300000-0000-4000-8000-000000000001';
delete from public.role_permissions where role_id='10000000-0000-4000-8000-000000000003' and permission_id=(select id from public.permissions where permission_key='staff_scheduling.manage');
set local role authenticated;
select throws_ok($$select pg_temp.roster_save()$$,'42501',null,'revoked scheduling permission blocks receipt replay');
reset role;
select * from finish();
rollback;
