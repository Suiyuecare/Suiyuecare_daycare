begin;
select plan(27);
select ok((select bool_and(relrowsecurity and relforcerowsecurity) from pg_class where oid in ('private.care_roster_versions'::regclass,'private.care_roster_operations'::regclass)),'allocation and operation stores force RLS');
select ok(not has_table_privilege('authenticated','private.care_roster_versions','select,insert,update,delete'),'direct allocation access is denied');
select ok(not has_table_privilege('service_role','private.care_roster_operations','select,insert,update,delete'),'no service role mutation bypass');
set local role anon;
select throws_ok($$select public.care_roster_snapshot(gen_random_uuid(),gen_random_uuid(),current_date)$$,'42501',null,'anonymous snapshot denied');
reset role;
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
set local role authenticated;
select is(pg_temp.roster_read()->'assignments','[]'::jsonb,'initial roster is genuinely empty');
select is(pg_temp.roster_save()->>'version','1','authorized supervisor creates confirmed allocation');
select is(pg_temp.roster_save()->>'replayed','true','exact replay returns original receipt');
select throws_ok($$select pg_temp.roster_save('{"sourceNote":"不同安排依據"}')$$,'23505',null,'changed replay rejected');
select throws_ok($$select pg_temp.roster_save('{"idempotency_key":"c1800000-0000-4000-8000-000000000002"}')$$,'40001',null,'stale version rejected');
select throws_ok($$select pg_temp.roster_save('{"idempotency_key":"c1800000-0000-4000-8000-000000000002","clientId":"c1600000-0000-4000-8000-000000000002"}')$$,'42501',null,'allocation cannot implicitly grant worker another client');
select throws_ok($$select pg_temp.roster_save('{"approved":false}')$$,'22023',null,'unconfirmed CMS suggestions cannot become tasks');
select throws_ok($$select pg_temp.roster_save('{"tasks":["temperature","temperature"]}')$$,'22023',null,'duplicate tasks rejected');
select throws_ok($$select public.care_roster_snapshot('c1300000-0000-4000-8000-000000000001','c1400000-0000-4000-8000-000000000009','2026-09-12')$$,'42501',null,'cross branch denied');
reset role;
select is((select count(*)::integer from public.client_assignments where assignee_user_id='c1100000-0000-4000-8000-000000000002'),1,'no client permissions silently created');
select throws_ok($$update private.care_roster_versions set version=3$$,'55000',null,'historical allocation cannot change');
insert into public.measurements(organization_id,branch_id,client_id,measurement_kind,measured_at,numeric_value,unit,idempotency_key)
values('c1300000-0000-4000-8000-000000000001','c1400000-0000-4000-8000-000000000001','c1600000-0000-4000-8000-000000000001','temperature','2026-09-12T09:00:00+08:00',36.5,'celsius',gen_random_uuid()),
('c1300000-0000-4000-8000-000000000001','c1400000-0000-4000-8000-000000000001','c1600000-0000-4000-8000-000000000001','blood_pressure_systolic','2026-09-12T09:00:00+08:00',120,'mmHg',gen_random_uuid());
set local role authenticated;
select is(pg_temp.roster_read()->'assignments'->0->'tasks'->0->>'status','recorded','same client morning temperature is recorded');
select is(pg_temp.roster_read()->'assignments'->0->'tasks'->1->>'status','pending','blood pressure requires both values at same time');
select is(pg_temp.roster_read()->'assignments'->0->'tasks'->2->>'status','pending','no signed diary does not equal completed');
select lives_ok($$select pg_temp.roster_save('{"shift":"afternoon","idempotency_key":"c1800000-0000-4000-8000-000000000003"}')$$,'afternoon receives separate allocation');
select is((select item->'tasks'->0->>'status' from jsonb_array_elements(pg_temp.roster_read()->'assignments') item where item->>'shift'='afternoon'),'pending','morning observation never completes afternoon task');
select lives_ok($$select pg_temp.roster_save('{"staffUserId":null,"expectedVersion":1,"idempotency_key":"c1800000-0000-4000-8000-000000000004"}')$$,'supervisor can create visible unassigned revision');
reset role;
select is((select count(*)::integer from private.care_roster_versions),3,'replay and failed requests leave no extra versions');
update private.executive_access_policy set allowed_user_id='c1100000-0000-4000-8000-000000000002',allowed_email='roster-worker@example.invalid',google_subject='roster-2';
select pg_temp.roster_claim(2);
set local role authenticated;
select is(jsonb_array_length(pg_temp.roster_read()->'assignments'),1,'worker sees only their current allocated shift');
select is(pg_temp.roster_read()->'staffOptions','[]'::jsonb,'worker cannot enumerate staff');
select throws_ok($$select pg_temp.roster_save()$$,'42501',null,'worker cannot assign people');
reset role;
select ok(exists(select 1 from public.audit_events where table_name='care_roster_snapshot') and exists(select 1 from public.audit_events where table_name='care_roster_versions'),'reads and writes audited without raw care content');
select * from finish();
rollback;
