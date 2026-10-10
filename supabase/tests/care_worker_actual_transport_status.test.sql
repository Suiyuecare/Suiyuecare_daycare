begin;
select plan(28);

select ok(has_function_privilege('authenticated','public.care_worker_actual_transport_status(uuid,uuid,date)','execute')
  and not has_function_privilege('anon','public.care_worker_actual_transport_status(uuid,uuid,date)','execute')
  and not has_function_privilege('service_role','public.care_worker_actual_transport_status(uuid,uuid,date)','execute'),
  'only authenticated callers can enter the narrow projection');
select ok(not has_table_privilege('authenticated','public.transport_execution_events','select')
  and not has_table_privilege('authenticated','public.transport_execution_streams','select')
  and not has_table_privilege('authenticated','public.transport_trip_plan_versions','select'),
  'care workers receive no raw transport table reads');
select ok((select not prosecdef and proconfig @> array['search_path=""']
  from pg_proc where oid='public.care_worker_actual_transport_status(uuid,uuid,date)'::regprocedure)
  and (select prosecdef and proconfig @> array['search_path=""'] and pg_get_userbyid(proowner)='postgres'
  from pg_proc where oid='private.care_worker_actual_transport_status_guarded(uuid,uuid,date)'::regprocedure),
  'public invoker and private guarded definer keep pinned search paths');
select ok((select count(*)=1 from public.role_permissions rp
  join public.roles role on role.id=rp.role_id
  join public.permissions permission on permission.id=rp.permission_id
  where permission.permission_key='transport_case_status.read' and role.role_key='care_worker'),
  'the read key is granted only to the care-worker role template');
select ok(not exists(select 1 from public.role_permissions rp
  join public.roles role on role.id=rp.role_id
  join public.permissions permission on permission.id=rp.permission_id
  where role.role_key='care_worker' and permission.permission_key='transport_execution.read'),
  'care workers do not gain all-trip Page-48 snapshot access');
set local role anon;
select throws_ok($$select public.care_worker_actual_transport_status(gen_random_uuid(),gen_random_uuid(),current_date)$$,
  '42501',null,'anonymous caller cannot use the RPC');
reset role;

-- Only synthetic data is inserted and the complete test transaction rolls back.
select set_config('test.transport_case_amr',floor(extract(epoch from clock_timestamp()-interval '2 minutes'))::text,true);
insert into auth.users(id,aud,role,email,email_confirmed_at,created_at,updated_at) values
 ('f8100000-0000-4000-8000-000000000001','authenticated','authenticated','worker@case.example.invalid',now()-interval '1 day',now()-interval '1 day',now()),
 ('f8100000-0000-4000-8000-000000000002','authenticated','authenticated','manager@case.example.invalid',now(),now(),now()),
 ('f8100000-0000-4000-8000-000000000003','authenticated','authenticated','reviewer@case.example.invalid',now(),now(),now()),
 ('f8100000-0000-4000-8000-000000000004','authenticated','authenticated','driver@case.example.invalid',now(),now(),now());
insert into auth.identities(id,provider_id,user_id,identity_data,provider) values
 ('f8110000-0000-4000-8000-000000000001','synthetic-transport-worker','f8100000-0000-4000-8000-000000000001',
  '{"sub":"synthetic-transport-worker","email":"worker@case.example.invalid","email_verified":true,"hd":"case.example.invalid"}','google');
insert into auth.sessions(id,user_id,created_at,aal)
values('f8120000-0000-4000-8000-000000000001','f8100000-0000-4000-8000-000000000001',now()-interval '3 minutes','aal1');
insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method)
values(gen_random_uuid(),'f8120000-0000-4000-8000-000000000001',
  to_timestamp(current_setting('test.transport_case_amr')::bigint),
  to_timestamp(current_setting('test.transport_case_amr')::bigint),'oauth');
insert into public.organizations(id,code,name)
values('f8130000-0000-4000-8000-000000000001','transport-case-test','合成交通機構');
insert into public.branches(id,organization_id,code,name) values
 ('f8140000-0000-4000-8000-000000000001','f8130000-0000-4000-8000-000000000001','main','合成主分支'),
 ('f8140000-0000-4000-8000-000000000002','f8130000-0000-4000-8000-000000000001','other','合成其他分支');
insert into public.profiles(id,display_name,kind) values
 ('f8100000-0000-4000-8000-000000000001','合成照服員','staff'),
 ('f8100000-0000-4000-8000-000000000002','合成主管','staff'),
 ('f8100000-0000-4000-8000-000000000003','合成覆核員','staff'),
 ('f8100000-0000-4000-8000-000000000004','合成駕駛','driver');
insert into public.memberships(id,organization_id,branch_id,profile_id,status,starts_at) values
 ('f8150000-0000-4000-8000-000000000001','f8130000-0000-4000-8000-000000000001','f8140000-0000-4000-8000-000000000001','f8100000-0000-4000-8000-000000000001','active',now()-interval '1 day'),
 ('f8150000-0000-4000-8000-000000000002','f8130000-0000-4000-8000-000000000001','f8140000-0000-4000-8000-000000000001','f8100000-0000-4000-8000-000000000004','active',now()-interval '1 day');
insert into public.membership_roles(membership_id,role_id) values
 ('f8150000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000006'),
 ('f8150000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000008');
insert into private.staff_google_access_grants(allowed_user_id,organization_id,company_email_domain,
  allowed_email,google_subject,enabled,approval_reference)
values('f8100000-0000-4000-8000-000000000001','f8130000-0000-4000-8000-000000000001',
  'case.example.invalid','worker@case.example.invalid','synthetic-transport-worker',true,
  'Synthetic transport status approval');
insert into public.clients(id,organization_id,branch_id,client_code,display_name,admitted_on) values
 ('f8160000-0000-4000-8000-000000000001','f8130000-0000-4000-8000-000000000001','f8140000-0000-4000-8000-000000000001','TC-1','合成授權個案',(clock_timestamp() at time zone 'Asia/Taipei')::date-10),
 ('f8160000-0000-4000-8000-000000000002','f8130000-0000-4000-8000-000000000001','f8140000-0000-4000-8000-000000000001','TC-2','合成未授權個案',(clock_timestamp() at time zone 'Asia/Taipei')::date-10),
 ('f8160000-0000-4000-8000-000000000003','f8130000-0000-4000-8000-000000000001','f8140000-0000-4000-8000-000000000001','TC-3','合成已取消分工個案',(clock_timestamp() at time zone 'Asia/Taipei')::date-10);
insert into public.client_assignments(organization_id,branch_id,client_id,assignee_user_id,assignment_kind,starts_at)
values('f8130000-0000-4000-8000-000000000001','f8140000-0000-4000-8000-000000000001','f8160000-0000-4000-8000-000000000001','f8100000-0000-4000-8000-000000000001','care',now()-interval '1 day'),
 ('f8130000-0000-4000-8000-000000000001','f8140000-0000-4000-8000-000000000001','f8160000-0000-4000-8000-000000000003','f8100000-0000-4000-8000-000000000001','care',now()-interval '1 day');
insert into private.care_roster_versions(organization_id,branch_id,client_id,service_date,shift,
  staff_user_id,version,state,source_note,tasks,created_by)
select 'f8130000-0000-4000-8000-000000000001','f8140000-0000-4000-8000-000000000001',
  id,(clock_timestamp() at time zone 'Asia/Taipei')::date,'morning',
  'f8100000-0000-4000-8000-000000000001',1,'scheduled','Synthetic assigned roster','[]'::jsonb,
  'f8100000-0000-4000-8000-000000000002'
from public.clients where id in('f8160000-0000-4000-8000-000000000001',
  'f8160000-0000-4000-8000-000000000002','f8160000-0000-4000-8000-000000000003');
insert into private.care_roster_versions(organization_id,branch_id,client_id,service_date,shift,
  staff_user_id,version,state,source_note,tasks,created_by)
values('f8130000-0000-4000-8000-000000000001','f8140000-0000-4000-8000-000000000001',
  'f8160000-0000-4000-8000-000000000003',(clock_timestamp() at time zone 'Asia/Taipei')::date,
  'morning',null,2,'cancelled','Synthetic cancelled allocation','[]',
  'f8100000-0000-4000-8000-000000000002');

create function pg_temp.transport_case_claim() returns void language plpgsql as $$ begin
 perform set_config('request.jwt.claims',jsonb_build_object(
  'sub','f8100000-0000-4000-8000-000000000001',
  'session_id','f8120000-0000-4000-8000-000000000001',
  'aud','authenticated','role','authenticated','aal','aal1',
  'email','worker@case.example.invalid','is_anonymous',false,
  'iat',floor(extract(epoch from clock_timestamp())),
  'exp',floor(extract(epoch from clock_timestamp()+interval '30 minutes')),
  'amr',jsonb_build_array(jsonb_build_object('method','oauth',
    'timestamp',current_setting('test.transport_case_amr')::bigint)))::text,true);
 end; $$;
create function pg_temp.transport_case_read(p_branch uuid default 'f8140000-0000-4000-8000-000000000001')
returns jsonb language sql as $$
 select payload from public.care_worker_actual_transport_status(
  'f8130000-0000-4000-8000-000000000001',p_branch,
  (clock_timestamp() at time zone 'Asia/Taipei')::date);
$$;

set local role authenticated;
select pg_temp.transport_case_claim();
select is((select jsonb_array_length(pg_temp.transport_case_read()->'rows')),1,
  'an approved worker sees only their currently rostered and assigned client');
select is(pg_temp.transport_case_read()->'rows'->0->>'pickupStatus','not_scheduled',
  'without an accepted pickup passenger plan, status is not scheduled');
select is(pg_temp.transport_case_read()->'rows'->0->>'dropoffStatus','not_scheduled',
  'without an accepted return passenger plan, status is not scheduled');
select throws_ok($$select pg_temp.transport_case_read('f8140000-0000-4000-8000-000000000002')$$,
  '42501',null,'the same organization other branch is denied');
reset role;
select set_config('request.jwt.claims','{}',true);

-- Construct genuine schema-valid, append-only Page-48 event evidence.  The
-- projection joins plans only for direction; it never returns plans or names.
insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,
  issued_jwt_iat,created_at,expires_at,consumed_at,consumed_jwt_iat,factor_method,factor_verified_at)
values
 ('f8170000-0000-4000-8000-000000000001','f8100000-0000-4000-8000-000000000002','f8180000-0000-4000-8000-000000000001',repeat('1',64),gen_random_uuid(),now()-interval '2 minutes',now()-interval '2 minutes',now()+interval '5 minutes',now()-interval '1 minute',now()-interval '1 minute','totp',now()-interval '1 minute'),
 ('f8170000-0000-4000-8000-000000000002','f8100000-0000-4000-8000-000000000003','f8180000-0000-4000-8000-000000000002',repeat('2',64),gen_random_uuid(),now()-interval '2 minutes',now()-interval '2 minutes',now()+interval '5 minutes',now()-interval '1 minute',now()-interval '1 minute','totp',now()-interval '1 minute');
with source as (select
 'f8190000-0000-4000-8000-000000000001'::uuid id,
 'f8130000-0000-4000-8000-000000000001'::uuid organization_id,
 'f8140000-0000-4000-8000-000000000001'::uuid branch_id,
 'f8191000-0000-4000-8000-000000000001'::uuid policy_key,1 version,
 (clock_timestamp() at time zone 'Asia/Taipei')::date effective_from,
 ((clock_timestamp() at time zone 'Asia/Taipei')::date+1) effective_to,
 jsonb_build_object('source_status','manual_unstandardized',
  'vehicles',jsonb_build_array(jsonb_build_object('code','VAN-1','name','Synthetic vehicle',
   'capacity',8,'taxonomy_status','manual_unstandardized')),
  'driver_authorizations',jsonb_build_array(jsonb_build_object(
   'membership_id','f8150000-0000-4000-8000-000000000002',
   'authorization_label','Synthetic driver authorization','taxonomy_status','manual_unstandardized'))) payload,
 'Synthetic two-person transport policy approval'::text note,
 'f8100000-0000-4000-8000-000000000002'::uuid created_by,
 'f8100000-0000-4000-8000-000000000003'::uuid approved_by)
insert into private.transport_policy_versions(id,organization_id,branch_id,policy_key,version,
 effective_from,effective_to,rule_payload,publication_note,created_by,approved_by,
 created_reauth_challenge_id,approved_reauth_challenge_id,content_hash)
select id,organization_id,branch_id,policy_key,version,effective_from,effective_to,payload,note,
 created_by,approved_by,'f8170000-0000-4000-8000-000000000001',
 'f8170000-0000-4000-8000-000000000002',encode(sha256(convert_to(jsonb_build_object(
 'schema_version',1,'organization_id',organization_id,'branch_id',branch_id,
 'policy_key',policy_key,'version',version,'previous_version_id',null,
 'effective_from',effective_from,'effective_to',effective_to,'rule_payload',payload,
 'publication_note',note,'created_by',created_by,'approved_by',approved_by)::text,'UTF8')),'hex')
from source;

insert into public.transport_trip_plan_versions(id,organization_id,branch_id,trip_key,version,
 draft_status,direction,service_date,starts_at,ends_at,vehicle_code,vehicle_name_snapshot,
 vehicle_capacity_snapshot,driver_membership_id,driver_user_id,driver_display_name_snapshot,
 driver_authorization_label_snapshot,pickup_label,dropoff_label,passenger_snapshot,
 conflict_snapshot,rule_version_id,revision_reason,created_by,created_by_display_name,
 reauth_challenge_id,content_hash)
select plan.id,'f8130000-0000-4000-8000-000000000001','f8140000-0000-4000-8000-000000000001',
 plan.trip_key,1,'draft_ready',plan.direction,day.service_date,
 (day.service_date::text||case when plan.direction='pickup' then ' 08:00:00+08' else ' 16:00:00+08' end)::timestamptz,
 (day.service_date::text||case when plan.direction='pickup' then ' 09:00:00+08' else ' 17:00:00+08' end)::timestamptz,
 'VAN-1','Synthetic vehicle',8,'f8150000-0000-4000-8000-000000000002',
 'f8100000-0000-4000-8000-000000000004','Synthetic driver','Synthetic authorization',
 'Synthetic pickup','Synthetic dropoff',jsonb_build_array(jsonb_build_object(
   'client_id','f8160000-0000-4000-8000-000000000001','client_code','TC-1',
   'display_name','合成授權個案','pickup_label','Synthetic pickup','dropoff_label','Synthetic dropoff'),
   jsonb_build_object('client_id','f8160000-0000-4000-8000-000000000002','client_code','TC-2',
   'display_name','合成未授權個案','pickup_label','Synthetic pickup','dropoff_label','Synthetic dropoff')),
 '[]','f8190000-0000-4000-8000-000000000001','Synthetic plan',
 'f8100000-0000-4000-8000-000000000002','Synthetic manager',
 'f8170000-0000-4000-8000-000000000001',repeat('a',64)
from (select (clock_timestamp() at time zone 'Asia/Taipei')::date service_date) day
cross join (values
 ('f8200000-0000-4000-8000-000000000001'::uuid,'f8210000-0000-4000-8000-000000000001'::uuid,'pickup'),
 ('f8200000-0000-4000-8000-000000000002'::uuid,'f8210000-0000-4000-8000-000000000002'::uuid,'dropoff')
) plan(id,trip_key,direction);
insert into public.transport_trip_plan_decisions(organization_id,branch_id,
 trip_version_id,trip_key,decision,reason,reviewed_by,reviewer_display_name,
 reauth_challenge_id,content_hash)
select plan.organization_id,plan.branch_id,plan.id,plan.trip_key,'publish',
 'Synthetic accepted trip','f8100000-0000-4000-8000-000000000002',
 'Synthetic manager','f8170000-0000-4000-8000-000000000001',repeat('9',64)
from public.transport_trip_plan_versions plan where plan.id in(
 'f8200000-0000-4000-8000-000000000001','f8200000-0000-4000-8000-000000000002');
set local role authenticated;
select pg_temp.transport_case_claim();
select is(pg_temp.transport_case_read()->'rows'->0->>'pickupStatus','scheduled_unreported',
  'accepted pickup membership without an actual event is awaiting report');
select is(pg_temp.transport_case_read()->'rows'->0->>'dropoffStatus','scheduled_unreported',
  'accepted return membership without an actual event is awaiting report');
reset role;
select set_config('request.jwt.claims','{}',true);
insert into public.transport_execution_streams(id,organization_id,branch_id,trip_key,
 plan_version_id,plan_content_hash,plan_decision,service_date,started_by,
 started_by_display_name,started_session_id,content_hash)
select case when plan.direction='pickup' then 'f8220000-0000-4000-8000-000000000001'::uuid
 else 'f8220000-0000-4000-8000-000000000002'::uuid end,
 plan.organization_id,plan.branch_id,plan.trip_key,plan.id,plan.content_hash,'publish',
 plan.service_date,'f8100000-0000-4000-8000-000000000004','Synthetic driver',
 'f8180000-0000-4000-8000-000000000004',repeat('b',64)
from public.transport_trip_plan_versions plan where plan.id in(
 'f8200000-0000-4000-8000-000000000001','f8200000-0000-4000-8000-000000000002');
insert into public.transport_execution_events(organization_id,branch_id,stream_id,
 plan_version_id,trip_key,service_date,sequence,event_type,client_id,occurred_at,
 actor_user_id,actor_display_name,actor_session_id,content_hash)
select stream.organization_id,stream.branch_id,stream.id,stream.plan_version_id,
 stream.trip_key,stream.service_date,1,'trip_started',null,
 (stream.service_date::text||case when plan.direction='pickup' then ' 08:01:00+08' else ' 16:01:00+08' end)::timestamptz,
 'f8100000-0000-4000-8000-000000000004','Synthetic driver',
 'f8180000-0000-4000-8000-000000000004',repeat('c',64)
from public.transport_execution_streams stream
join public.transport_trip_plan_versions plan on plan.id=stream.plan_version_id
where stream.id in('f8220000-0000-4000-8000-000000000001',
 'f8220000-0000-4000-8000-000000000002');

set local role authenticated;
select pg_temp.transport_case_claim();
select is(pg_temp.transport_case_read()->'rows'->0->>'pickupStatus','scheduled_unreported',
  'trip_started is not a passenger boarding report');
reset role;
select set_config('request.jwt.claims','{}',true);
insert into public.transport_execution_events(organization_id,branch_id,stream_id,
 plan_version_id,trip_key,service_date,sequence,event_type,client_id,occurred_at,
 actor_user_id,actor_display_name,actor_session_id,content_hash)
select stream.organization_id,stream.branch_id,stream.id,stream.plan_version_id,
 stream.trip_key,stream.service_date,2,'passenger_boarded',
 'f8160000-0000-4000-8000-000000000001',
 (stream.service_date::text||case when plan.direction='pickup' then ' 08:10:00+08' else ' 16:10:00+08' end)::timestamptz,
 'f8100000-0000-4000-8000-000000000004','Synthetic driver',
 'f8180000-0000-4000-8000-000000000004',repeat('d',64)
from public.transport_execution_streams stream
join public.transport_trip_plan_versions plan on plan.id=stream.plan_version_id
where stream.id in('f8220000-0000-4000-8000-000000000001',
 'f8220000-0000-4000-8000-000000000002');
set local role authenticated;
select pg_temp.transport_case_claim();
select is(pg_temp.transport_case_read()->'rows'->0->>'pickupStatus','boarded',
  'actual pickup boarding is shown');
select is(pg_temp.transport_case_read()->'rows'->0->>'dropoffStatus','boarded',
  'actual return boarding is shown separately');
reset role;
select set_config('request.jwt.claims','{}',true);
insert into public.transport_execution_events(organization_id,branch_id,stream_id,
 plan_version_id,trip_key,service_date,sequence,event_type,client_id,occurred_at,
 actor_user_id,actor_display_name,actor_session_id,content_hash)
select stream.organization_id,stream.branch_id,stream.id,stream.plan_version_id,
 stream.trip_key,stream.service_date,3,'passenger_alighted',
 'f8160000-0000-4000-8000-000000000001',
 (stream.service_date::text||case when plan.direction='pickup' then ' 08:30:00+08' else ' 16:30:00+08' end)::timestamptz,
 'f8100000-0000-4000-8000-000000000004','Synthetic driver',
 'f8180000-0000-4000-8000-000000000004',repeat('e',64)
from public.transport_execution_streams stream
join public.transport_trip_plan_versions plan on plan.id=stream.plan_version_id
where stream.id in('f8220000-0000-4000-8000-000000000001',
 'f8220000-0000-4000-8000-000000000002');
-- A second passenger has real boarding evidence but no care-worker client grant.
insert into public.transport_execution_events(organization_id,branch_id,stream_id,
 plan_version_id,trip_key,service_date,sequence,event_type,client_id,occurred_at,
 actor_user_id,actor_display_name,actor_session_id,content_hash)
select stream.organization_id,stream.branch_id,stream.id,stream.plan_version_id,
 stream.trip_key,stream.service_date,4,'passenger_boarded',
 'f8160000-0000-4000-8000-000000000002',
 (stream.service_date::text||' 08:40:00+08')::timestamptz,
 'f8100000-0000-4000-8000-000000000004','Synthetic driver',
 'f8180000-0000-4000-8000-000000000004',repeat('f',64)
from public.transport_execution_streams stream
where stream.id='f8220000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.transport_case_claim();
select is(pg_temp.transport_case_read()->'rows'->0->>'pickupStatus','alighted',
  'actual pickup alighting supersedes boarding');
select is(pg_temp.transport_case_read()->'rows'->0->>'dropoffStatus','alighted',
  'actual return alighting supersedes boarding');
select ok(pg_temp.transport_case_read()::text !~ 'Synthetic vehicle|Synthetic driver|VAN-1|TC-2|TC-3|f8160000-0000-4000-8000-000000000002',
  'no vehicle, driver or other passenger identity leaks through the payload');
reset role;
select set_config('request.jwt.claims','{}',true);
insert into public.transport_execution_events(organization_id,branch_id,stream_id,
 plan_version_id,trip_key,service_date,sequence,event_type,client_id,occurred_at,note,
 resolves_pairing,actor_user_id,actor_display_name,actor_session_id,reauth_challenge_id,content_hash)
select stream.organization_id,stream.branch_id,stream.id,stream.plan_version_id,
 stream.trip_key,stream.service_date,5,'exception_recorded',
 'f8160000-0000-4000-8000-000000000001',
 (stream.service_date::text||' 08:50:00+08')::timestamptz,
 'Synthetic private incident note',false,
 'f8100000-0000-4000-8000-000000000004','Synthetic driver',
 'f8180000-0000-4000-8000-000000000004',
 'f8170000-0000-4000-8000-000000000001',repeat('4',64)
from public.transport_execution_streams stream
where stream.id='f8220000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.transport_case_claim();
select is(pg_temp.transport_case_read()->'rows'->0->>'pickupStatus','exception',
  'a passenger incident on the current accepted trip is visible as a redacted exception');
select ok(pg_temp.transport_case_read()::text !~ 'Synthetic private incident note|Synthetic driver|TC-2',
  'incident notes and other-passenger identity are not exposed to the caregiver');
reset role;
select set_config('request.jwt.claims','{}',true);
insert into public.transport_execution_events(organization_id,branch_id,stream_id,
 plan_version_id,trip_key,service_date,sequence,event_type,client_id,occurred_at,note,
 resolves_pairing,actor_user_id,actor_display_name,actor_session_id,reauth_challenge_id,content_hash)
select stream.organization_id,stream.branch_id,stream.id,stream.plan_version_id,
 stream.trip_key,stream.service_date,6,'exception_recorded',
 'f8160000-0000-4000-8000-000000000002',
 (stream.service_date::text||' 08:55:00+08')::timestamptz,
 'Synthetic other passenger incident',false,
 'f8100000-0000-4000-8000-000000000004','Synthetic driver',
 'f8180000-0000-4000-8000-000000000004',
 'f8170000-0000-4000-8000-000000000001',repeat('3',64)
from public.transport_execution_streams stream
where stream.id='f8220000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.transport_case_claim();
select is(pg_temp.transport_case_read()->'rows'->0->>'pickupStatus','exception',
  'another passenger later incident cannot replace the assigned client status');
reset role;
select ok(exists(select 1 from public.audit_events
  where table_name='care_worker_actual_transport_status' and action='select'
    and metadata->>'row_count'='1'),
  'each successful narrow read has an audit count without client identity');
select set_config('request.jwt.claims','{}',true);

-- A second accepted version makes an older trip non-current.  The event on
-- version 1 is synthetic legacy evidence after version 2 was published; the
-- normal write API prevents this, but a read projection must still fail closed.
create function pg_temp.transport_case_clone_plan(
  p_id uuid,p_trip_key uuid,p_version integer,p_previous_version_id uuid
) returns void language sql as $$
 insert into public.transport_trip_plan_versions(id,organization_id,branch_id,
  trip_key,version,previous_version_id,draft_status,direction,service_date,
  starts_at,ends_at,vehicle_code,vehicle_name_snapshot,vehicle_capacity_snapshot,
  driver_membership_id,driver_user_id,driver_display_name_snapshot,
  driver_authorization_label_snapshot,pickup_label,dropoff_label,
  passenger_snapshot,conflict_snapshot,rule_version_id,revision_reason,
  created_by,created_by_display_name,reauth_challenge_id,content_hash)
 select p_id,plan.organization_id,plan.branch_id,p_trip_key,p_version,
  p_previous_version_id,plan.draft_status,plan.direction,plan.service_date,
  plan.starts_at,plan.ends_at,plan.vehicle_code,plan.vehicle_name_snapshot,
  plan.vehicle_capacity_snapshot,plan.driver_membership_id,plan.driver_user_id,
  plan.driver_display_name_snapshot,plan.driver_authorization_label_snapshot,
  plan.pickup_label,plan.dropoff_label,
  case when p_version=2 then jsonb_build_array(plan.passenger_snapshot->1)
    else plan.passenger_snapshot end,plan.conflict_snapshot,
  plan.rule_version_id,'Synthetic supersession fixture',plan.created_by,
  plan.created_by_display_name,plan.reauth_challenge_id,repeat(p_version::text,64)
 from public.transport_trip_plan_versions plan
 where plan.id='f8200000-0000-4000-8000-000000000001';
$$;
select pg_temp.transport_case_clone_plan('f8200000-0000-4000-8000-000000000003',
 'f8210000-0000-4000-8000-000000000003',1,null);
select pg_temp.transport_case_clone_plan('f8200000-0000-4000-8000-000000000004',
 'f8210000-0000-4000-8000-000000000003',2,
 'f8200000-0000-4000-8000-000000000003');
insert into public.transport_trip_plan_decisions(organization_id,branch_id,
 trip_version_id,trip_key,decision,reason,reviewed_by,reviewer_display_name,
 reauth_challenge_id,content_hash)
select plan.organization_id,plan.branch_id,plan.id,plan.trip_key,'publish',
 'Synthetic supersession approval','f8100000-0000-4000-8000-000000000002',
 'Synthetic manager','f8170000-0000-4000-8000-000000000001',repeat('8',64)
from public.transport_trip_plan_versions plan where plan.id in(
 'f8200000-0000-4000-8000-000000000003',
 'f8200000-0000-4000-8000-000000000004') order by plan.version;
insert into public.transport_execution_streams(id,organization_id,branch_id,trip_key,
 plan_version_id,plan_content_hash,plan_decision,service_date,started_by,
 started_by_display_name,started_session_id,content_hash)
select 'f8220000-0000-4000-8000-000000000003',plan.organization_id,
 plan.branch_id,plan.trip_key,plan.id,plan.content_hash,'publish',
 plan.service_date,'f8100000-0000-4000-8000-000000000004',
 'Synthetic driver','f8180000-0000-4000-8000-000000000004',repeat('7',64)
from public.transport_trip_plan_versions plan
where plan.id='f8200000-0000-4000-8000-000000000003';
insert into public.transport_execution_events(organization_id,branch_id,stream_id,
 plan_version_id,trip_key,service_date,sequence,event_type,client_id,occurred_at,
 actor_user_id,actor_display_name,actor_session_id,content_hash)
select stream.organization_id,stream.branch_id,stream.id,stream.plan_version_id,
 stream.trip_key,stream.service_date,synthetic.sequence,synthetic.event_type,
 synthetic.client_id,(stream.service_date::text||synthetic.local_time)::timestamptz,
 'f8100000-0000-4000-8000-000000000004','Synthetic driver',
 'f8180000-0000-4000-8000-000000000004',repeat('6',64)
from public.transport_execution_streams stream cross join (values
 (1,'trip_started'::text,null::uuid,' 08:31:00+08'::text),
 (2,'passenger_boarded'::text,'f8160000-0000-4000-8000-000000000001'::uuid,' 08:40:00+08'::text)
) synthetic(sequence,event_type,client_id,local_time)
where stream.id='f8220000-0000-4000-8000-000000000003';
set local role authenticated;
select pg_temp.transport_case_claim();
select is(pg_temp.transport_case_read()->'rows'->0->>'pickupStatus','exception',
  'later actual event from a superseded trip cannot replace the current accepted trip');
reset role;
select ok(not exists(select 1 from private.transport_execution_projection(
  'f8130000-0000-4000-8000-000000000001',
  'f8140000-0000-4000-8000-000000000001') projection
  where projection.plan_version_id='f8200000-0000-4000-8000-000000000003'),
  'canonical Page-48 projection also excludes the superseded version');
select set_config('request.jwt.claims','{}',true);

-- Cancellation cannot normally follow execution, but imported legacy evidence
-- may contain both.  Match Page-48: the cancelled trip contributes no current
-- movement, while the independent return trip still does.
insert into private.transport_trip_cancellations(organization_id,branch_id,
 trip_version_id,trip_key,actor_user_id,actor_name,reason,reauth_challenge_id,
 idempotency_key,request_hash)
select plan.organization_id,plan.branch_id,plan.id,plan.trip_key,
 'f8100000-0000-4000-8000-000000000002','Synthetic manager',
 'Synthetic cancellation fixture','f8170000-0000-4000-8000-000000000001',
 gen_random_uuid(),repeat('5',64)
from public.transport_trip_plan_versions plan
where plan.id='f8200000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.transport_case_claim();
select is(pg_temp.transport_case_read()->'rows'->0->>'pickupStatus','not_scheduled',
  'cancelled pickup and superseded old membership do not imply a current ride plan');
select is(pg_temp.transport_case_read()->'rows'->0->>'dropoffStatus','alighted',
  'cancelling pickup never erases the separate valid return actual event');
reset role;
select set_config('request.jwt.claims','{}',true);
update public.client_assignments set ends_at=now()-interval '1 minute'
where client_id='f8160000-0000-4000-8000-000000000001'
  and assignee_user_id='f8100000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.transport_case_claim();
select is(jsonb_array_length(pg_temp.transport_case_read()->'rows'),0,
  'revoked client assignment removes a previously visible boarding history');
reset role;
select set_config('request.jwt.claims','{}',true);
update private.staff_google_access_grants set enabled=false
where allowed_user_id='f8100000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.transport_case_claim();
select throws_ok($$select pg_temp.transport_case_read()$$,'42501',null,
  'revoked Google staff approval immediately denies the read RPC');
select * from finish();
rollback;
