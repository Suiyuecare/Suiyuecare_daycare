begin;
select plan(43);
-- Synthetic local-only sources; this suite uses real Google/session admission.
create function pg_temp.sid(category integer,n integer default 1) returns uuid language sql immutable as $$
 select ('d7'||lpad(category::text,2,'0')||'0000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
$$;
select ok(not has_function_privilege('authenticated','private.daily_transport_reconciliation_data(uuid,uuid,date)','execute'),'raw stable builder is not callable');
select ok(not has_function_privilege('service_role','public.daily_transport_reconciliation(uuid,uuid,date)','execute'),'service role has no new read bypass');
select ok(not (select prosecdef from pg_proc where oid='public.daily_transport_reconciliation(uuid,uuid,date)'::regprocedure),'public wrapper remains invoker');
select is((select provolatile::text from pg_proc where oid='private.daily_transport_reconciliation_data(uuid,uuid,date)'::regprocedure),'s','sources use one stable snapshot');
set local role anon;
select throws_ok($$select public.daily_transport_reconciliation(pg_temp.sid(30),pg_temp.sid(40),current_date)$$,'42501',null,'anonymous access denied');
reset role;
select set_config('test.dispatch_amr',floor(extract(epoch from clock_timestamp()-interval '2 minutes'))::text,true);
insert into auth.users(id,aud,role,email,email_confirmed_at,created_at,updated_at)
select pg_temp.sid(10,n),'authenticated','authenticated','dispatch-'||n||'@example.invalid',now(),now(),now() from generate_series(1,3)n;
insert into auth.identities(id,provider_id,user_id,identity_data,provider)
select gen_random_uuid(),'dispatch-'||n,pg_temp.sid(10,n),jsonb_build_object('sub','dispatch-'||n,'email','dispatch-'||n||'@example.invalid','email_verified',true),'google' from generate_series(1,3)n;
insert into auth.sessions(id,user_id,created_at,aal)
select pg_temp.sid(20,n),pg_temp.sid(10,n),now()-interval '3 minutes','aal2' from generate_series(1,3)n;
insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method)
select gen_random_uuid(),pg_temp.sid(20,n),to_timestamp(current_setting('test.dispatch_amr')::bigint),to_timestamp(current_setting('test.dispatch_amr')::bigint),method from generate_series(1,3)n cross join unnest(array['oauth','totp'])method;
insert into public.organizations(id,code,name) values(pg_temp.sid(30),'dispatch-synthetic','合成機構'),(pg_temp.sid(30,2),'dispatch-other','其他合成機構');
insert into public.branches(id,organization_id,code,name) values
(pg_temp.sid(40),pg_temp.sid(30),'main','合成分支'),(pg_temp.sid(40,2),pg_temp.sid(30),'other','另一合成分支'),(pg_temp.sid(40,3),pg_temp.sid(30,2),'main','其他機構分支');
insert into public.profiles(id,display_name,kind)
values(pg_temp.sid(10),'合成主管','staff'),(pg_temp.sid(10,2),'合成照服員','staff'),(pg_temp.sid(10,3),'合成駕駛','driver');
insert into public.memberships(id,organization_id,branch_id,profile_id,status,starts_at)
select pg_temp.sid(50,n),pg_temp.sid(30),pg_temp.sid(40),pg_temp.sid(10,n),'active',now()-interval '1 year' from generate_series(1,3)n;
insert into public.memberships(id,organization_id,branch_id,profile_id,status,starts_at)
values(pg_temp.sid(50,4),pg_temp.sid(30),pg_temp.sid(40,2),pg_temp.sid(10,3),'active',now()-interval '1 year');
insert into public.membership_roles(membership_id,role_id) values
(pg_temp.sid(50),'10000000-0000-4000-8000-000000000003'),(pg_temp.sid(50,2),'10000000-0000-4000-8000-000000000006'),(pg_temp.sid(50,3),'10000000-0000-4000-8000-000000000008');
insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,created_at,expires_at,consumed_at,consumed_jwt_iat,factor_method,factor_verified_at)
select pg_temp.sid(70,n),pg_temp.sid(10,n),pg_temp.sid(20,n),repeat(n::text,64),gen_random_uuid(),now()-interval '2 minutes',now()-interval '2 minutes',now()+interval '5 minutes',now()-interval '1 minute',now()-interval '1 minute','totp',now()-interval '1 minute' from generate_series(1,2)n;
insert into private.reauth_events(user_id,session_id,challenge_id,aal,verification_method,verified_at)
select pg_temp.sid(10,n),pg_temp.sid(20,n),pg_temp.sid(70,n),'aal2','totp',now()-interval '1 minute' from generate_series(1,2)n;
create function pg_temp.claim(n integer default 1) returns void language plpgsql as $$ begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.sid(10,n),'session_id',pg_temp.sid(20,n),'role','authenticated','aud','authenticated','aal','aal2','is_anonymous',false,'email','dispatch-'||n||'@example.invalid','iat',floor(extract(epoch from now())),'exp',floor(extract(epoch from now()+interval '30 minutes')),'amr',jsonb_build_array(jsonb_build_object('method','oauth','timestamp',current_setting('test.dispatch_amr')::bigint),jsonb_build_object('method','totp','timestamp',current_setting('test.dispatch_amr')::bigint)))::text,true);
end; $$;
create function pg_temp.read_dispatch(p_date date default '2026-09-15') returns jsonb language sql as $$
 select payload from public.daily_transport_reconciliation(pg_temp.sid(30),pg_temp.sid(40),p_date);
$$;
create function pg_temp.dispatch_row(n integer,p_direction text default 'pickup') returns jsonb language sql as $$
 select r from jsonb_array_elements(pg_temp.read_dispatch()->'dispatch'->'rows') r where r->>'clientId'=pg_temp.sid(60,n)::text and r->>'direction'=p_direction;
$$;
select pg_temp.claim();
set local role authenticated;
select throws_ok($$select pg_temp.read_dispatch()$$,'42501',null,'unapproved Google account denied');
reset role;
insert into private.executive_access_policy(allowed_user_id,allowed_email,google_subject,enabled,approval_reference)
values(pg_temp.sid(10),'dispatch-1@example.invalid','dispatch-1',true,'synthetic dispatch test');
set local role authenticated;
select is(pg_temp.read_dispatch()->'clients','[]'::jsonb,'empty authorized source is an explicit empty list');
select is(pg_temp.read_dispatch()->'dispatch','{"status":"ready","rows":[]}'::jsonb,'empty complete transport source is not an unavailable state');
reset role;

insert into public.clients(id,organization_id,branch_id,client_code,display_name,status,admitted_on)
select pg_temp.sid(60,n),pg_temp.sid(30),pg_temp.sid(40),'D-'||n,'合成個案'||n,
 case when n=5 then 'suspended'::public.client_status else 'active'::public.client_status end,
 case when n=3 then null when n=4 then date '2026-09-16' else date '2026-01-01' end from generate_series(1,8)n;
insert into public.client_assignments(organization_id,branch_id,client_id,assignee_user_id,assignment_kind,starts_at)
values(pg_temp.sid(30),pg_temp.sid(40),pg_temp.sid(60),pg_temp.sid(10,2),'care',now()-interval '1 year');
create function pg_temp.day(n integer,weekday integer) returns jsonb language sql as $$
 select jsonb_build_object('weekday',weekday,'attending',true,'startsAt','09:00','endsAt','16:00',
 'outbound',case when n<>7 then jsonb_build_object('location','合成私密地址','contact','合成私密電話','windowStart','08:00','windowEnd','09:00','wheelchair',false) else null end,
 'inbound',case when n in(1,7) then jsonb_build_object('location','合成私密地址','contact','合成私密電話','windowStart','16:00','windowEnd','17:00','wheelchair',false) else null end);
$$;
insert into private.client_weekly_versions(organization_id,branch_id,client_id,version,effective_from,effective_to,plan,created_by)
select pg_temp.sid(30),pg_temp.sid(40),pg_temp.sid(60,n),1,'2026-01-01',case when n=8 then date '2026-09-14' else null end,
 jsonb_build_object('days',(select jsonb_agg(pg_temp.day(n,d)) from generate_series(1,7)d)),pg_temp.sid(10) from generate_series(1,8)n;
insert into private.client_weekly_exceptions(organization_id,branch_id,client_id,service_date,version,day,reason,created_by)
values(pg_temp.sid(30),pg_temp.sid(40),pg_temp.sid(60,6),'2026-09-15',1,'{"weekday":2,"attending":false,"startsAt":null,"endsAt":null,"outbound":null,"inbound":null}','合成單日取消',pg_temp.sid(10));
set local role authenticated;
select is(jsonb_array_length(pg_temp.read_dispatch()->'clients'),3,'exclude cancelled, pending admission, future admission, suspension and expired plan');
select is(jsonb_array_length(pg_temp.read_dispatch()->'dispatch'->'rows'),4,'weekly outbound and inbound produce exact two-direction demand');
select is(pg_temp.dispatch_row(1)->>'status','pending','unassigned demand is explicit pending');
select is(pg_temp.dispatch_row(1,'dropoff')->>'status','pending','return-home direction is independent');
select ok(pg_temp.read_dispatch()::text not like '%合成私密%' and pg_temp.read_dispatch()::text not like '%displayName%','snapshot never returns address, contact or profile details');
reset role;


-- Core daily additions: no auth function replacements or hosted data.
create function pg_temp.read_daily(p_date date default '2026-09-15') returns jsonb language sql as $$
 select payload from public.core_daily_snapshot(pg_temp.sid(30),pg_temp.sid(40),p_date);
$$;
create function pg_temp.daily_client(n integer) returns jsonb language sql as $$
 select c from jsonb_array_elements(pg_temp.read_daily()->'clients') c where c->>'id'=pg_temp.sid(60,n)::text;
$$;
select ok(not has_function_privilege('authenticated','private.core_daily_snapshot_data(uuid,uuid,date)','execute'),'raw daily builder not callable');
select ok(not has_function_privilege('service_role','public.core_daily_snapshot(uuid,uuid,date)','execute'),'no service role bypass');
select ok(not (select prosecdef from pg_proc where oid='public.core_daily_snapshot(uuid,uuid,date)'::regprocedure),'public daily wrapper invoker');
select is((select provolatile::text from pg_proc where oid='private.core_daily_snapshot_data(uuid,uuid,date)'::regprocedure),'s','daily sources share stable snapshot');
insert into public.clients(id,organization_id,branch_id,client_code,display_name,status,admitted_on)
select pg_temp.sid(60,n),pg_temp.sid(30),pg_temp.sid(40),'D-'||n,'合成個案'||n,'active','2026-01-01' from generate_series(9,11)n;
insert into private.client_weekly_exceptions(organization_id,branch_id,client_id,service_date,version,day,reason,created_by)
values(pg_temp.sid(30),pg_temp.sid(40),pg_temp.sid(60,10),'2026-09-15',1,'{"weekday":2,"attending":false,"startsAt":null,"endsAt":null,"outbound":null,"inbound":null}','合成未排服務',pg_temp.sid(10));
insert into public.attendance_records(organization_id,branch_id,client_id,service_date,status,source,idempotency_key,recorded_by,checked_in_at)
select pg_temp.sid(30),pg_temp.sid(40),pg_temp.sid(60,n),'2026-09-15',case when n=2 then 'leave'::public.attendance_status else 'present'::public.attendance_status end,'staff',gen_random_uuid(),pg_temp.sid(10),case when n=2 then null else '2026-09-15 09:00+08'::timestamptz end
from unnest(array[2,5,11])n;
insert into public.measurements(organization_id,branch_id,client_id,measurement_kind,measured_at,numeric_value,unit,source,recorded_by,idempotency_key,measurement_set_id,request_hash)
values(pg_temp.sid(30),pg_temp.sid(40),pg_temp.sid(60),'pulse','2026-09-15 09:00+08',72,'bpm','staff',pg_temp.sid(10),gen_random_uuid(),gen_random_uuid(),repeat('a',64)),
(pg_temp.sid(30),pg_temp.sid(40),pg_temp.sid(60),'pulse','2026-09-15 10:00+08',74,'bpm','staff',pg_temp.sid(10),gen_random_uuid(),gen_random_uuid(),repeat('b',64)),
(pg_temp.sid(30),pg_temp.sid(40),pg_temp.sid(60),'pulse','2026-09-14 23:59+08',90,'bpm','staff',pg_temp.sid(10),gen_random_uuid(),gen_random_uuid(),repeat('c',64));
insert into public.care_records(organization_id,branch_id,client_id,record_key,category,status,occurred_at,data,created_by)
values(pg_temp.sid(30),pg_temp.sid(40),pg_temp.sid(60),gen_random_uuid(),'staff/daily-care/care-diary','draft','2026-09-15 10:00+08','{"note":"SECRET_SYNTHETIC_NOTE","abnormal":true}',pg_temp.sid(10));
set local role authenticated;
select is(jsonb_array_length(pg_temp.read_daily()->'measurements'),1,'latest measurement per kind only, other Taipei day excluded');
select is((pg_temp.read_daily()->'measurements'->0->>'numeric_value')::numeric,74::numeric,'latest measurement value preserved');
select is(pg_temp.read_daily()->'careDiaries'->0->'data','{"abnormal":true,"has_abnormal_flag":false}'::jsonb,'diary carries minimal flags only');
select ok(pg_temp.read_daily()::text not like '%SECRET_SYNTHETIC_NOTE%','notes do not enter summary response');
select is(pg_temp.read_daily()->'careDiaries'->0->>'status','draft','draft is preserved and not promoted to signed');
select is(pg_temp.daily_client(1)->>'scheduleStatus','scheduled','scheduled person is explicitly applicable');
select is(pg_temp.daily_client(6)->>'scheduleStatus','not_scheduled','cancelled day is not missing care');
select is(pg_temp.daily_client(8)->>'scheduleStatus','unknown','expired plan is unknown, not no service');
select is(pg_temp.daily_client(9)->>'scheduleStatus','unknown','missing weekly plan is unknown');
select is(pg_temp.daily_client(10)->>'scheduleStatus','not_scheduled','explicit day off known without weekly plan');
select is(pg_temp.daily_client(11)->>'eligibility','eligible','unplanned arrival remains visible');
select is((select a->>'status' from jsonb_array_elements(pg_temp.read_daily()->'attendance')a where a->>'client_id'=pg_temp.sid(60,11)::text),'present','actual unplanned arrival available in same payload');
select is((select a->>'status' from jsonb_array_elements(pg_temp.read_daily()->'attendance')a where a->>'client_id'=pg_temp.sid(60,2)::text),'leave','leave preserved independently from scheduled status');
select is(pg_temp.daily_client(5)->>'eligibility','inactive','inactive client evidence retained without becoming an eligible case');
select is(pg_temp.daily_client(3),null::jsonb,'not admitted without evidence does not enter daily roster');
select is(pg_temp.daily_client(4),null::jsonb,'future admission without evidence does not enter daily roster');
select throws_ok($$select public.core_daily_snapshot(pg_temp.sid(30),pg_temp.sid(40,2),'2026-09-15')$$,'42501',null,'crossbranch daily read denied');
select throws_ok($$select public.core_daily_snapshot(pg_temp.sid(30,2),pg_temp.sid(40,3),'2026-09-15')$$,'42501',null,'cross organization daily read denied');
select throws_ok($$select pg_temp.read_daily('infinity')$$,'42501',null,'infinite day denied');
reset role;
update private.executive_access_policy set allowed_user_id=pg_temp.sid(10,2),allowed_email='dispatch-2@example.invalid',google_subject='dispatch-2';
select pg_temp.claim(2);
set local role authenticated;
select is(jsonb_array_length(pg_temp.read_daily()->'clients'),1,'assigned staff sees only assigned case');
select is(jsonb_array_length(pg_temp.read_daily()->'attendance'),0,'hidden case attendance never returned');
reset role;
update public.memberships set status='suspended' where id=pg_temp.sid(50,2);
set local role authenticated;
select throws_ok($$select pg_temp.read_daily()$$,'42501',null,'revoked session cannot read daily source');
reset role;
set local role anon;
select throws_ok($$select pg_temp.read_daily()$$,'42501',null,'anonymous daily read denied');
reset role;
select is((select count(*)::integer from public.attendance_records where organization_id=pg_temp.sid(30)),3,'read creates no attendance');
select ok(exists(select 1 from public.audit_events where table_name='core_daily_snapshot'),'daily read audited');
select ok(not exists(select 1 from public.audit_events where table_name='core_daily_snapshot' and metadata::text like '%合成%'),'audit has no PII');
select * from finish();
rollback;
