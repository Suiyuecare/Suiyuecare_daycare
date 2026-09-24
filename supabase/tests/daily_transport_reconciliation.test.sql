begin;
select plan(45);
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

-- Owner-only fixture provisioning. Published immutable policies still satisfy
-- their real hash, author separation and trigger checks; no guard is replaced.
create function pg_temp.policy(n integer) returns void language plpgsql as $$
declare j jsonb; r jsonb; driver_id uuid:=case when n=1 then pg_temp.sid(50,3) else pg_temp.sid(50,4) end;
begin
 r:=jsonb_build_object('source_status','manual_unstandardized','vehicles',jsonb_build_array(jsonb_build_object('code','VAN','name','合成交通車','capacity',10,'taxonomy_status','manual_unstandardized')),'driver_authorizations',jsonb_build_array(jsonb_build_object('membership_id',driver_id,'authorization_label','合成人工授權','taxonomy_status','manual_unstandardized')));
 j:=jsonb_build_object('schema_version',1,'organization_id',pg_temp.sid(30),'branch_id',pg_temp.sid(40,n),'policy_key',pg_temp.sid(81,n),'version',1,'previous_version_id',null,'effective_from','2026-01-01','effective_to',null,'rule_payload',r,'publication_note','合成交通政策測試資料','created_by',pg_temp.sid(10),'approved_by',pg_temp.sid(10,2));
 insert into private.transport_policy_versions(id,organization_id,branch_id,policy_key,version,effective_from,rule_payload,publication_note,created_by,approved_by,created_reauth_challenge_id,approved_reauth_challenge_id,content_hash)
 values(pg_temp.sid(80,n),pg_temp.sid(30),pg_temp.sid(40,n),pg_temp.sid(81,n),1,'2026-01-01',r,'合成交通政策測試資料',pg_temp.sid(10),pg_temp.sid(10,2),pg_temp.sid(70),pg_temp.sid(70,2),encode(sha256(convert_to(j::text,'UTF8')),'hex'));
end; $$;
select pg_temp.policy(1);
select pg_temp.policy(2);
create function pg_temp.trip(k integer,v integer,people integer[],direction text default 'pickup',decision text default 'publish',service_date date default '2026-09-15',branch_no integer default 1) returns uuid language plpgsql as $$
declare trip_id uuid:=gen_random_uuid(); previous_id uuid; passengers jsonb;
begin
 select id into previous_id from public.transport_trip_plan_versions where trip_key=pg_temp.sid(90,k) and version=v-1;
 select jsonb_agg(jsonb_build_object('client_id',pg_temp.sid(60,n),'client_code','D-'||n,'display_name','合成個案'||n,'pickup_label','合成私密住址','dropoff_label','合成日照中心')) into passengers from unnest(people)n;
 insert into public.transport_trip_plan_versions(id,organization_id,branch_id,trip_key,version,previous_version_id,draft_status,direction,service_date,starts_at,ends_at,vehicle_code,vehicle_name_snapshot,vehicle_capacity_snapshot,driver_membership_id,driver_user_id,driver_display_name_snapshot,driver_authorization_label_snapshot,pickup_label,dropoff_label,passenger_snapshot,conflict_snapshot,rule_version_id,revision_reason,created_by,created_by_display_name,reauth_challenge_id,content_hash)
 values(trip_id,pg_temp.sid(30),pg_temp.sid(40,branch_no),pg_temp.sid(90,k),v,previous_id,'draft_ready',direction,service_date,(service_date::text||' 08:00+08')::timestamptz,(service_date::text||' 09:00+08')::timestamptz,'VAN','合成車輛',10,case when branch_no=1 then pg_temp.sid(50,3) else pg_temp.sid(50,4) end,pg_temp.sid(10,3),'合成駕駛','合成人工授權','合成私密住址','合成日照中心',passengers,'[]',pg_temp.sid(80,branch_no),'合成趟次版本',pg_temp.sid(10),'合成主管',pg_temp.sid(70),repeat('a',64));
 if decision is not null then
 insert into public.transport_trip_plan_decisions(organization_id,branch_id,trip_version_id,trip_key,decision,reason,reviewed_by,reviewer_display_name,reauth_challenge_id,content_hash)
 values(pg_temp.sid(30),pg_temp.sid(40,branch_no),trip_id,pg_temp.sid(90,k),decision,'合成獨立覆核完成原因',pg_temp.sid(10,2),'合成覆核主管',pg_temp.sid(70,2),repeat('b',64));
 end if;
 return trip_id;
end; $$;
create temp table first_trip as select pg_temp.trip(1,1,array[1]) id;
grant select on first_trip to authenticated;
set local role authenticated;
select is(pg_temp.dispatch_row(1)->>'status','assigned','one exact published trip satisfies pickup demand');
select is(pg_temp.dispatch_row(1)->'tripVersionIds',jsonb_build_array((select id from first_trip)),'reconciliation links exact published version');
select is(pg_temp.dispatch_row(1,'dropoff')->>'status','pending','pickup never satisfies dropoff');
reset role;
select pg_temp.trip(1,2,array[1],'pickup',null);
select pg_temp.trip(1,3,array[1],'pickup','reject');
set local role authenticated;
select is(pg_temp.dispatch_row(1)->'tripVersionIds',jsonb_build_array((select id from first_trip)),'later draft and rejected revision do not cancel effective publication');
reset role;
select pg_temp.trip(1,4,array[2]);
set local role authenticated;
select is(pg_temp.dispatch_row(1)->>'status','pending','published removal no longer assigns previous passenger');
select is(pg_temp.dispatch_row(2)->>'status','assigned','published replacement serves only exact new passenger');
reset role;
select pg_temp.trip(1,5,array[1],'pickup','publish','2026-09-16');
set local role authenticated;
select is(pg_temp.dispatch_row(2)->>'status','pending','moving latest publication to another date removes obsolete assignment');
reset role;
select pg_temp.trip(1,6,array[2],'dropoff');
select pg_temp.trip(8,1,array[7],'dropoff',null);
select pg_temp.trip(9,1,array[7],'dropoff','reject');
set local role authenticated;
select is(pg_temp.dispatch_row(2)->>'status','pending','published direction change cannot satisfy prior pickup direction');
select is(pg_temp.dispatch_row(2,'dropoff'),null::jsonb,'unrequested return-home direction is not fabricated by a published trip');
select is(pg_temp.dispatch_row(7,'dropoff')->>'status','pending','draft-only and rejected-only trips never satisfy demand');
reset role;
select pg_temp.trip(2,1,array[1,2]);
select pg_temp.trip(3,1,array[1]);
select pg_temp.trip(4,1,array[1],'pickup','publish','2026-09-16');
select pg_temp.trip(5,1,array[1],'pickup','publish','2026-09-15',2);
select pg_temp.trip(6,1,array[6]);
select pg_temp.trip(7,1,array[2],'dropoff');
set local role authenticated;
select is(pg_temp.dispatch_row(1)->>'status','conflict','two active trip keys are a visible conflict, never assigned');
select is(jsonb_array_length(pg_temp.dispatch_row(1)->'tripVersionIds'),2,'other date and other branch trips do not inflate exact matches');
select is(pg_temp.dispatch_row(2)->>'status','assigned','shared trip counts independently for its second client');
select is(jsonb_array_length(pg_temp.read_dispatch()->'dispatch'->'rows'),4,'cancelled passengers and unrequested directions add no demand');
select is(pg_temp.dispatch_row(6),null::jsonb,'cancelled daily intent stays excluded even with published transport');
select throws_ok($$select public.daily_transport_reconciliation(pg_temp.sid(30),pg_temp.sid(40,2),'2026-09-15')$$,'42501',null,'branch-scoped manager cannot request another branch');
select throws_ok($$select public.daily_transport_reconciliation(pg_temp.sid(30,2),pg_temp.sid(40,3),'2026-09-15')$$,'42501',null,'cross-organization projection denied');
select throws_ok($$select pg_temp.read_dispatch('infinity')$$,'42501',null,'unbounded date rejected');
reset role;

update private.executive_access_policy set allowed_user_id=pg_temp.sid(10,2),allowed_email='dispatch-2@example.invalid',google_subject='dispatch-2';
select pg_temp.claim(2);
set local role authenticated;
select is(jsonb_array_length(pg_temp.read_dispatch()->'clients'),1,'scoped staff sees only assigned client');
select is(pg_temp.read_dispatch()->'dispatch','{"status":"forbidden"}'::jsonb,'missing transport permission is not zero and has no details');
reset role;
-- Narrow local fixture grant, not a production role change or auth bypass.
insert into public.role_permissions(role_id,permission_id)
select '10000000-0000-4000-8000-000000000006',id from public.permissions where permission_key='transport_plans.read';
set local role authenticated;
select is(pg_temp.dispatch_row(1)->>'status','restricted','a hidden co-passenger makes transport result restricted, not unassigned');
select is(pg_temp.dispatch_row(1)->'tripVersionIds','[]'::jsonb,'restricted result reveals no trip identifiers, even alongside visible matches');
select is(pg_temp.dispatch_row(1,'dropoff')->>'status','pending','fully authorized exact direction with no trip remains pending');
reset role;
update public.organizations set is_active=false where id=pg_temp.sid(30);
set local role authenticated;
select throws_ok($$select pg_temp.read_dispatch()$$,'42501',null,'disabled organization cannot return a misleading empty projection');
reset role;
update public.organizations set is_active=true where id=pg_temp.sid(30);
update public.memberships set status='suspended' where id=pg_temp.sid(50,2);
set local role authenticated;
select throws_ok($$select pg_temp.read_dispatch()$$,'42501',null,'revoked staff cannot reuse earlier projection access');
reset role;
select is((select count(*)::integer from public.attendance_records where organization_id=pg_temp.sid(30)),0,'reading never creates attendance');
select is((select count(*)::integer from public.transport_execution_events where organization_id=pg_temp.sid(30)),0,'reading never creates transport execution');
select is((select count(*)::integer from private.transport_plan_operations where organization_id=pg_temp.sid(30)),0,'reading never automatically dispatches or creates operations');
select ok(exists(select 1 from public.audit_events where table_name='daily_transport_reconciliation'),'successful reads leave audit evidence');
select ok(not exists(select 1 from public.audit_events where table_name='daily_transport_reconciliation' and (metadata::text like '%合成%' or metadata::text like '%tripVersion%' or metadata::text like '%clientId%')),'read audit contains no raw PII or per-client identifiers');
update private.executive_access_policy set allowed_user_id=pg_temp.sid(10),allowed_email='dispatch-1@example.invalid',google_subject='dispatch-1';
select pg_temp.claim();
insert into public.clients(id,organization_id,branch_id,client_code,display_name,status,admitted_on)
select pg_temp.sid(60,n),pg_temp.sid(30),pg_temp.sid(40),'H-'||n,'合成歷史個案'||n,'suspended','2026-01-01' from generate_series(100,610)n;
set local role authenticated;
select is(jsonb_array_length(pg_temp.read_dispatch()->'clients'),3,'large inactive history does not consume the eligible daily client budget');
reset role;
insert into public.clients(id,organization_id,branch_id,client_code,display_name,status,admitted_on)
select pg_temp.sid(60,n),pg_temp.sid(30),pg_temp.sid(40),'A-'||n,'合成有效個案'||n,'active','2026-01-01' from generate_series(1000,1500)n;
set local role authenticated;
select throws_ok($$select pg_temp.read_dispatch()$$,'54000',null,'over-limit eligible scope fails closed instead of truncating to false counts');
reset role;
select * from finish();
rollback;
