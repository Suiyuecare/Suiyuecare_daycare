begin;

select plan(62);

select ok(to_regclass('public.transport_execution_streams') is not null
  and to_regclass('public.transport_execution_events') is not null
  and to_regclass('private.transport_execution_operations') is not null,
  'Page 48 has dedicated immutable stream, event and operation stores');

select is((select count(*)::integer from pg_class where oid in(
  'public.transport_execution_streams'::regclass,
  'public.transport_execution_events'::regclass,
  'private.transport_execution_operations'::regclass)
  and relrowsecurity and relforcerowsecurity),3,
  'all Page-48 stores force RLS');

select ok(not has_table_privilege('authenticated','public.transport_execution_streams','select')
  and not has_table_privilege('authenticated','public.transport_execution_events','insert')
  and not has_table_privilege('service_role','private.transport_execution_operations','select'),
  'direct application table access is denied');

select ok(has_function_privilege('authenticated',
  'public.mutate_transport_execution(uuid,uuid,jsonb,uuid)','execute')
  and has_function_privilege('authenticated',
  'public.transport_execution_snapshot(uuid,uuid,date,text,text,text,text)','execute')
  and not has_function_privilege('anon',
  'public.mutate_transport_execution(uuid,uuid,jsonb,uuid)','execute'),
  'only authenticated callers receive public Page-48 RPC entrypoints');

select ok(not exists(select 1 from pg_proc function join pg_namespace namespace
  on namespace.oid=function.pronamespace where namespace.nspname='public'
  and function.prosecdef and function.proname in(
    'mutate_transport_execution','transport_execution_snapshot'))
  and exists(select 1 from pg_proc function join pg_namespace namespace
    on namespace.oid=function.pronamespace where namespace.nspname='private'
    and function.prosecdef and function.proname='mutate_transport_execution_guarded'),
  'public wrappers are invokers and the guarded private core is a definer');

select is((select count(*)::integer from pg_trigger where not tgisinternal and tgname in(
  'transport_execution_streams_append_only','transport_execution_events_append_only',
  'transport_execution_operations_append_only')),3,
  'every execution evidence store has an append-only trigger');

select is((select count(*)::integer from pg_trigger where not tgisinternal and tgname in(
  'transport_execution_streams_audit_row_change',
  'transport_execution_events_audit_row_change',
  'transport_execution_operations_audit_row_change')),3,
  'every Page-48 table has the standard audit-row-change trigger');

select ok((select count(*)=5 and bool_and(risk_level in(2,3)) from public.permissions
  where permission_key like 'transport_execution.%'),
  'read, record, exception, complete and manage-any permissions are separate');

select ok((select count(*)=4 from public.role_permissions assignment
  join public.roles role on role.id=assignment.role_id
  join public.permissions permission on permission.id=assignment.permission_id
  where role.role_key='transport_driver' and permission.permission_key like 'transport_execution.%')
  and not exists(select 1 from public.role_permissions assignment
    join public.roles role on role.id=assignment.role_id
    join public.permissions permission on permission.id=assignment.permission_id
    where role.role_key='transport_driver'
      and permission.permission_key='transport_execution.manage_any'),
  'driver template can execute assigned trips but never receives manage-any');

select ok((select count(*)>=10 from pg_indexes where schemaname in('public','private')
  and indexname like 'transport_execution_%'),
  'execution foreign keys and bounded snapshot paths are indexed');

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('00000000-0000-0000-0000-000000000000','48010000-0000-4000-8000-000000000001','authenticated','authenticated','page48-manager@example.invalid','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','48010000-0000-4000-8000-000000000002','authenticated','authenticated','page48-reviewer@example.invalid','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','48010000-0000-4000-8000-000000000003','authenticated','authenticated','page48-driver-a@example.invalid','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-8000-000000000004','48010000-0000-4000-8000-000000000004','authenticated','authenticated','page48-driver-b@example.invalid','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','48010000-0000-4000-8000-000000000005','authenticated','authenticated','page48-outsider@example.invalid','',now(),'{}','{}',now(),now());

insert into public.organizations(id,code,name) values
('48020000-0000-4000-8000-000000000001','page48_a','合成接送機構 A'),
('48020000-0000-4000-8000-000000000002','page48_b','合成接送機構 B');
insert into public.branches(id,organization_id,code,name) values
('48030000-0000-4000-8000-000000000001','48020000-0000-4000-8000-000000000001','main','合成接送分支 A'),
('48030000-0000-4000-8000-000000000002','48020000-0000-4000-8000-000000000001','other','合成接送分支 A2'),
('48030000-0000-4000-8000-000000000003','48020000-0000-4000-8000-000000000002','main','合成接送分支 B');
insert into public.profiles(id,display_name,kind,employee_code) values
('48010000-0000-4000-8000-000000000001','合成接送主管','staff','P48-M'),
('48010000-0000-4000-8000-000000000002','合成獨立覆核者','staff','P48-R'),
('48010000-0000-4000-8000-000000000003','合成駕駛甲','driver','P48-A'),
('48010000-0000-4000-8000-000000000004','合成駕駛乙','driver','P48-B'),
('48010000-0000-4000-8000-000000000005','合成外部主管','staff','P48-X');
insert into public.memberships(id,organization_id,branch_id,profile_id,status,starts_at) values
('48040000-0000-4000-8000-000000000001','48020000-0000-4000-8000-000000000001',null,'48010000-0000-4000-8000-000000000001','active',now()-interval '1 year'),
('48040000-0000-4000-8000-000000000002','48020000-0000-4000-8000-000000000001',null,'48010000-0000-4000-8000-000000000002','active',now()-interval '1 year'),
('48040000-0000-4000-8000-000000000003','48020000-0000-4000-8000-000000000001','48030000-0000-4000-8000-000000000001','48010000-0000-4000-8000-000000000003','active',now()-interval '1 year'),
('48040000-0000-4000-8000-000000000004','48020000-0000-4000-8000-000000000001','48030000-0000-4000-8000-000000000001','48010000-0000-4000-8000-000000000004','active',now()-interval '1 year'),
('48040000-0000-4000-8000-000000000005','48020000-0000-4000-8000-000000000002',null,'48010000-0000-4000-8000-000000000005','active',now()-interval '1 year');
insert into public.membership_roles(membership_id,role_id) values
('48040000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002'),
('48040000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002'),
('48040000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000008'),
('48040000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000008'),
('48040000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000002');
insert into public.clients(id,organization_id,branch_id,client_code,display_name,status,admitted_on) values
('48050000-0000-4000-8000-000000000001','48020000-0000-4000-8000-000000000001','48030000-0000-4000-8000-000000000001','SYN-E01','合成乘客甲','active',current_date-100),
('48050000-0000-4000-8000-000000000002','48020000-0000-4000-8000-000000000001','48030000-0000-4000-8000-000000000001','SYN-E02','合成乘客乙','active',current_date-100),
('48050000-0000-4000-8000-000000000003','48020000-0000-4000-8000-000000000001','48030000-0000-4000-8000-000000000001','SYN-E03','合成乘客丙','active',current_date-100);

insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,
  issued_jwt_iat,created_at,expires_at,consumed_at,consumed_jwt_iat,factor_method,factor_verified_at) values
('48060000-0000-4000-8000-000000000001','48010000-0000-4000-8000-000000000001','48061000-0000-4000-8000-000000000001',repeat('1',64),'48062000-0000-4000-8000-000000000001',now()-interval '2 minutes',now()-interval '2 minutes',now()+interval '5 minutes',now()-interval '30 seconds',now()-interval '30 seconds','totp',now()-interval '30 seconds'),
('48060000-0000-4000-8000-000000000002','48010000-0000-4000-8000-000000000002','48061000-0000-4000-8000-000000000002',repeat('2',64),'48062000-0000-4000-8000-000000000002',now()-interval '2 minutes',now()-interval '2 minutes',now()+interval '5 minutes',now()-interval '30 seconds',now()-interval '30 seconds','totp',now()-interval '30 seconds'),
('48060000-0000-4000-8000-000000000003','48010000-0000-4000-8000-000000000003','48061000-0000-4000-8000-000000000003',repeat('3',64),'48062000-0000-4000-8000-000000000003',now()-interval '2 minutes',now()-interval '2 minutes',now()+interval '5 minutes',now()-interval '30 seconds',now()-interval '30 seconds','totp',now()-interval '30 seconds');
insert into private.reauth_events(user_id,session_id,challenge_id,aal,verification_method,verified_at) values
('48010000-0000-4000-8000-000000000001','48061000-0000-4000-8000-000000000001','48060000-0000-4000-8000-000000000001','aal2','totp',now()-interval '30 seconds'),
('48010000-0000-4000-8000-000000000003','48061000-0000-4000-8000-000000000003','48060000-0000-4000-8000-000000000003','aal2','totp',now()-interval '30 seconds');

create temporary table page48_clock as
with local_day as (select (now() at time zone 'Asia/Taipei')::date service_date)
select service_date,(service_date::text||' 00:00:00+08')::timestamptz planned_at,
  clock_timestamp() actual_at from local_day;
grant select on page48_clock to authenticated;

with source as (select
  '48070000-0000-4000-8000-000000000001'::uuid id,
  '48020000-0000-4000-8000-000000000001'::uuid organization_id,
  '48030000-0000-4000-8000-000000000001'::uuid branch_id,
  '48071000-0000-4000-8000-000000000001'::uuid policy_key,1 version,
  clock.service_date effective_from,clock.service_date+1 effective_to,
  jsonb_build_object('source_status','manual_unstandardized','vehicles',jsonb_build_array(
    jsonb_build_object('code','VAN-A','name','合成接送車 A','capacity',8,'taxonomy_status','manual_unstandardized'),
    jsonb_build_object('code','VAN-B','name','合成接送車 B','capacity',8,'taxonomy_status','manual_unstandardized'),
    jsonb_build_object('code','VAN-C','name','合成接送車 C','capacity',8,'taxonomy_status','manual_unstandardized'),
    jsonb_build_object('code','VAN-D','name','合成接送車 D','capacity',8,'taxonomy_status','manual_unstandardized')),
    'driver_authorizations',jsonb_build_array(
      jsonb_build_object('membership_id','48040000-0000-4000-8000-000000000003','authorization_label','合成駕駛甲人工授權','taxonomy_status','manual_unstandardized'),
      jsonb_build_object('membership_id','48040000-0000-4000-8000-000000000004','authorization_label','合成駕駛乙人工授權','taxonomy_status','manual_unstandardized'))) payload,
  '兩位合成人員核准接送執行測試規則'::text note,
  '48010000-0000-4000-8000-000000000001'::uuid created_by,
  '48010000-0000-4000-8000-000000000002'::uuid approved_by
  from page48_clock clock)
insert into private.transport_policy_versions(id,organization_id,branch_id,policy_key,version,
  effective_from,effective_to,rule_payload,publication_note,created_by,approved_by,
  created_reauth_challenge_id,approved_reauth_challenge_id,content_hash)
select id,organization_id,branch_id,policy_key,version,effective_from,effective_to,payload,note,
  created_by,approved_by,'48060000-0000-4000-8000-000000000001',
  '48060000-0000-4000-8000-000000000002',encode(sha256(convert_to(jsonb_build_object(
    'schema_version',1,'organization_id',organization_id,'branch_id',branch_id,
    'policy_key',policy_key,'version',version,'previous_version_id',null,
    'effective_from',effective_from,'effective_to',effective_to,'rule_payload',payload,
    'publication_note',note,'created_by',created_by,'approved_by',approved_by)::text,'UTF8')),'hex')
from source;

insert into public.transport_trip_plan_versions(id,organization_id,branch_id,trip_key,
  version,draft_status,direction,service_date,starts_at,ends_at,vehicle_code,
  vehicle_name_snapshot,vehicle_capacity_snapshot,driver_membership_id,driver_user_id,
  driver_display_name_snapshot,driver_employee_code_snapshot,
  driver_authorization_label_snapshot,pickup_label,dropoff_label,passenger_snapshot,
  conflict_snapshot,rule_version_id,revision_reason,created_by,created_by_display_name,
  reauth_challenge_id,content_hash)
select plan.id,'48020000-0000-4000-8000-000000000001',
  '48030000-0000-4000-8000-000000000001',plan.trip_key,1,'draft_ready','pickup',
  clock.service_date,clock.planned_at,clock.planned_at+interval '1 hour',plan.vehicle_code,
  plan.vehicle_name,8,plan.driver_membership,plan.driver_user,plan.driver_name,
  plan.driver_code,plan.driver_auth,'合成集合點','合成日照中心',plan.passengers,'[]',
  '48070000-0000-4000-8000-000000000001','建立合成接送執行計畫',
  '48010000-0000-4000-8000-000000000001','合成接送主管',
  '48060000-0000-4000-8000-000000000001',plan.content_hash
from page48_clock clock cross join lateral (values
  ('48080000-0000-4000-8000-000000000001'::uuid,
   '48081000-0000-4000-8000-000000000001'::uuid,'VAN-A','合成接送車 A',
   '48040000-0000-4000-8000-000000000003'::uuid,
   '48010000-0000-4000-8000-000000000003'::uuid,'合成駕駛甲','P48-A','合成駕駛甲人工授權',
   jsonb_build_array(
     jsonb_build_object('client_id','48050000-0000-4000-8000-000000000001','client_code','SYN-E01','display_name','合成乘客甲','pickup_label','合成住址甲','dropoff_label','合成日照中心'),
     jsonb_build_object('client_id','48050000-0000-4000-8000-000000000002','client_code','SYN-E02','display_name','合成乘客乙','pickup_label','合成住址乙','dropoff_label','合成日照中心')),repeat('a',64)),
  ('48080000-0000-4000-8000-000000000002'::uuid,
   '48081000-0000-4000-8000-000000000002'::uuid,'VAN-B','合成接送車 B',
   '48040000-0000-4000-8000-000000000004'::uuid,
   '48010000-0000-4000-8000-000000000004'::uuid,'合成駕駛乙','P48-B','合成駕駛乙人工授權',
   jsonb_build_array(jsonb_build_object('client_id','48050000-0000-4000-8000-000000000003','client_code','SYN-E03','display_name','合成乘客丙','pickup_label','合成住址丙','dropoff_label','合成日照中心')),repeat('b',64)),
  ('48080000-0000-4000-8000-000000000003'::uuid,
   '48081000-0000-4000-8000-000000000003'::uuid,'VAN-C','合成接送車 C',
   '48040000-0000-4000-8000-000000000003'::uuid,
   '48010000-0000-4000-8000-000000000003'::uuid,'合成駕駛甲','P48-A','合成駕駛甲人工授權',
   jsonb_build_array(jsonb_build_object('client_id','48050000-0000-4000-8000-000000000003','client_code','SYN-E03','display_name','合成乘客丙','pickup_label','合成住址丙','dropoff_label','合成日照中心')),repeat('c',64)),
  ('48080000-0000-4000-8000-000000000004'::uuid,
   '48081000-0000-4000-8000-000000000004'::uuid,'VAN-D','合成接送車 D',
   '48040000-0000-4000-8000-000000000003'::uuid,
   '48010000-0000-4000-8000-000000000003'::uuid,'合成駕駛甲','P48-A','合成駕駛甲人工授權',
   jsonb_build_array(jsonb_build_object('client_id','48050000-0000-4000-8000-000000000003','client_code','SYN-E03','display_name','合成乘客丙','pickup_label','合成住址丙','dropoff_label','合成日照中心')),repeat('d',64))
) plan(id,trip_key,vehicle_code,vehicle_name,driver_membership,driver_user,driver_name,
  driver_code,driver_auth,passengers,content_hash);

insert into public.transport_trip_plan_decisions(id,organization_id,branch_id,
  trip_version_id,trip_key,decision,reason,reviewed_by,reviewer_display_name,
  reauth_challenge_id,content_hash)
select gen_random_uuid(),'48020000-0000-4000-8000-000000000001',
  '48030000-0000-4000-8000-000000000001',plan.id,plan.trip_key,'publish',
  '獨立核對合成接送執行計畫','48010000-0000-4000-8000-000000000002',
  '合成獨立覆核者','48060000-0000-4000-8000-000000000002',repeat('e',64)
from (values
  ('48080000-0000-4000-8000-000000000001'::uuid,'48081000-0000-4000-8000-000000000001'::uuid),
  ('48080000-0000-4000-8000-000000000002'::uuid,'48081000-0000-4000-8000-000000000002'::uuid),
  ('48080000-0000-4000-8000-000000000003'::uuid,'48081000-0000-4000-8000-000000000003'::uuid)
) plan(id,trip_key);

set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object(
  'sub','48010000-0000-4000-8000-000000000004','aal','aal2',
  'session_id','48061000-0000-4000-8000-000000000004')::text,true);

select throws_ok($$select * from public.mutate_transport_execution(
  '48020000-0000-4000-8000-000000000001','48030000-0000-4000-8000-000000000001',
  jsonb_build_object('event_type','trip_started','plan_version_id','48080000-0000-4000-8000-000000000001',
  'expected_trip_key','48081000-0000-4000-8000-000000000001',
  'expected_plan_content_hash',repeat('a',64),'expected_sequence',0,
  'occurred_at',(select actual_at from page48_clock),'client_id',null,'note',null,
  'resolves_pairing',false),'48090000-0000-4000-8000-000000000099')$$,
  '42501','transport trip is not assigned to actor',
  'a driver cannot start another driver exact published assignment');

create temporary table second_start as select * from public.mutate_transport_execution(
  '48020000-0000-4000-8000-000000000001','48030000-0000-4000-8000-000000000001',
  jsonb_build_object('event_type','trip_started','plan_version_id','48080000-0000-4000-8000-000000000002',
  'expected_trip_key','48081000-0000-4000-8000-000000000002',
  'expected_plan_content_hash',repeat('b',64),'expected_sequence',0,
  'occurred_at',(select actual_at from page48_clock),'client_id',null,'note',null,
  'resolves_pairing',false),'48090000-0000-4000-8000-000000000001');

select ok((select not replayed and event_type='trip_started' and sequence=1
  and status='in_progress' from second_start),
  'assigned driver starts its exact published plan using employee AAL2');

select throws_ok($$select * from public.mutate_transport_execution(
  '48020000-0000-4000-8000-000000000001','48030000-0000-4000-8000-000000000001',
  jsonb_build_object('event_type','exception_recorded','plan_version_id','48080000-0000-4000-8000-000000000002',
  'expected_trip_key','48081000-0000-4000-8000-000000000002',
  'expected_plan_content_hash',repeat('b',64),'expected_sequence',1,
  'occurred_at',(select actual_at from page48_clock),'client_id',null,
  'note','合成例外沒有近期重新驗證','resolves_pairing',false),
  '48090000-0000-4000-8000-000000000002')$$,
  '42501','recent same-session transport reauthentication required',
  'exception recording fails closed without recent same-session reauthentication');

select is((select matching_trip_total::integer from public.transport_execution_snapshot(
  '48020000-0000-4000-8000-000000000001','48030000-0000-4000-8000-000000000001',
  (select service_date from page48_clock),'','','all','all')),1,
  'driver snapshot exposes only its exact published assignment');

reset role; set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object(
  'sub','48010000-0000-4000-8000-000000000003','aal','aal1',
  'session_id','48061000-0000-4000-8000-000000000003')::text,true);
select throws_ok($$select * from public.mutate_transport_execution(
  '48020000-0000-4000-8000-000000000001','48030000-0000-4000-8000-000000000001',
  jsonb_build_object('event_type','trip_started','plan_version_id','48080000-0000-4000-8000-000000000001',
  'expected_trip_key','48081000-0000-4000-8000-000000000001',
  'expected_plan_content_hash',repeat('a',64),'expected_sequence',0,
  'occurred_at',(select actual_at from page48_clock),'client_id',null,'note',null,
  'resolves_pairing',false),'48090000-0000-4000-8000-000000000003')$$,
  '42501','transport execution operation not permitted',
  'AAL1 cannot append even an ordinary trip event');

reset role; set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object(
  'sub','48010000-0000-4000-8000-000000000003','aal','aal2',
  'session_id','48061000-0000-4000-8000-000000000003')::text,true);

select throws_ok($$select * from public.mutate_transport_execution(
  '48020000-0000-4000-8000-000000000001','48030000-0000-4000-8000-000000000002',
  jsonb_build_object('event_type','trip_started','plan_version_id','48080000-0000-4000-8000-000000000001',
  'expected_trip_key','48081000-0000-4000-8000-000000000001',
  'expected_plan_content_hash',repeat('a',64),'expected_sequence',0,
  'occurred_at',(select actual_at from page48_clock),'client_id',null,'note',null,
  'resolves_pairing',false),'48090000-0000-4000-8000-000000000004')$$,
  '42501','transport execution operation not permitted',
  'cross-branch mutation is denied before plan contents are used');

select throws_ok($$select * from public.mutate_transport_execution(
  '48020000-0000-4000-8000-000000000001','48030000-0000-4000-8000-000000000001',
  jsonb_build_object('event_type','passenger_boarded','plan_version_id','48080000-0000-4000-8000-000000000001',
  'expected_trip_key','48081000-0000-4000-8000-000000000001',
  'expected_plan_content_hash',repeat('a',64),'expected_sequence',0,
  'occurred_at',(select actual_at from page48_clock),'client_id','48050000-0000-4000-8000-000000000001',
  'note',null,'resolves_pairing',false),'48090000-0000-4000-8000-000000000005')$$,
  '55000','transport trip must start from this plan first',
  'passenger movement cannot precede trip start');

create temporary table first_start as select * from public.mutate_transport_execution(
  '48020000-0000-4000-8000-000000000001','48030000-0000-4000-8000-000000000001',
  jsonb_build_object('event_type','trip_started','plan_version_id','48080000-0000-4000-8000-000000000001',
  'expected_trip_key','48081000-0000-4000-8000-000000000001',
  'expected_plan_content_hash',repeat('a',64),'expected_sequence',0,
  'occurred_at',(select actual_at from page48_clock),'client_id',null,'note',null,
  'resolves_pairing',false),'48090000-0000-4000-8000-000000000001');

select ok((select not replayed and sequence=1 and status='in_progress'
  and unmatched_passenger_count=2 and actual_started_at=(select actual_at from page48_clock)
  from first_start),'trip start freezes exact timing and exposes both unmatched passengers');

reset role;
select ok((select plan_version_id='48080000-0000-4000-8000-000000000001'
  and trip_key='48081000-0000-4000-8000-000000000001'
  and plan_content_hash=repeat('a',64) and plan_decision='publish'
  and started_by='48010000-0000-4000-8000-000000000003'
  from public.transport_execution_streams
  where plan_version_id='48080000-0000-4000-8000-000000000001'),
  'execution stream freezes exact accepted plan, assignment actor and decision');

set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object(
  'sub','48010000-0000-4000-8000-000000000003','aal','aal2',
  'session_id','48061000-0000-4000-8000-000000000003')::text,true);
select ok((select replayed and event_id=(select event_id from first_start)
  from public.mutate_transport_execution(
  '48020000-0000-4000-8000-000000000001','48030000-0000-4000-8000-000000000001',
  jsonb_build_object('event_type','trip_started','plan_version_id','48080000-0000-4000-8000-000000000001',
  'expected_trip_key','48081000-0000-4000-8000-000000000001',
  'expected_plan_content_hash',repeat('a',64),'expected_sequence',0,
  'occurred_at',(select actual_at from page48_clock),'client_id',null,'note',null,
  'resolves_pairing',false),'48090000-0000-4000-8000-000000000001')),
  'exact actor-scoped retry returns its original event receipt');

reset role;
delete from public.membership_roles
where membership_id='48040000-0000-4000-8000-000000000003'
  and role_id='10000000-0000-4000-8000-000000000008';
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object(
  'sub','48010000-0000-4000-8000-000000000003','aal','aal2',
  'session_id','48061000-0000-4000-8000-000000000003')::text,true);
select throws_ok($$select * from public.mutate_transport_execution(
  '48020000-0000-4000-8000-000000000001','48030000-0000-4000-8000-000000000001',
  jsonb_build_object('event_type','trip_started','plan_version_id','48080000-0000-4000-8000-000000000001',
  'expected_trip_key','48081000-0000-4000-8000-000000000001',
  'expected_plan_content_hash',repeat('a',64),'expected_sequence',0,
  'occurred_at',(select actual_at from page48_clock),'client_id',null,'note',null,
  'resolves_pairing',false),'48090000-0000-4000-8000-000000000001')$$,
  '42501','transport execution operation not permitted',
  'exact replay fails closed after the actor permission is revoked');
reset role;
insert into public.membership_roles(membership_id,role_id) values(
  '48040000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000008');
insert into public.memberships(id,organization_id,branch_id,profile_id,status,starts_at) values(
  '48040000-0000-4000-8000-000000000006','48020000-0000-4000-8000-000000000001',null,
  '48010000-0000-4000-8000-000000000003','active',now()-interval '1 year');
insert into public.membership_roles(membership_id,role_id) values(
  '48040000-0000-4000-8000-000000000006','10000000-0000-4000-8000-000000000008');
update public.memberships set status='ended'
where id='48040000-0000-4000-8000-000000000003';
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object(
  'sub','48010000-0000-4000-8000-000000000003','aal','aal2',
  'session_id','48061000-0000-4000-8000-000000000003')::text,true);
select throws_ok($$select * from public.mutate_transport_execution(
  '48020000-0000-4000-8000-000000000001','48030000-0000-4000-8000-000000000001',
  jsonb_build_object('event_type','trip_started','plan_version_id','48080000-0000-4000-8000-000000000001',
  'expected_trip_key','48081000-0000-4000-8000-000000000001',
  'expected_plan_content_hash',repeat('a',64),'expected_sequence',0,
  'occurred_at',(select actual_at from page48_clock),'client_id',null,'note',null,
  'resolves_pairing',false),'48090000-0000-4000-8000-000000000001')$$,
  '42501','transport replay authority expired',
  'exact replay fails closed after the published driver assignment is revoked');
reset role;
update public.memberships set status='active'
where id='48040000-0000-4000-8000-000000000003';

set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object(
  'sub','48010000-0000-4000-8000-000000000003','aal','aal2',
  'session_id','48061000-0000-4000-8000-000000000003')::text,true);

select throws_ok($$select * from public.mutate_transport_execution(
  '48020000-0000-4000-8000-000000000001','48030000-0000-4000-8000-000000000001',
  jsonb_build_object('event_type','trip_started','plan_version_id','48080000-0000-4000-8000-000000000001',
  'expected_trip_key','48081000-0000-4000-8000-000000000001',
  'expected_plan_content_hash',repeat('a',64),'expected_sequence',0,
  'occurred_at',(select actual_at+interval '1 second' from page48_clock),'client_id',null,
  'note',null,'resolves_pairing',false),'48090000-0000-4000-8000-000000000001')$$,
  '23505','transport execution idempotency conflict',
  'same actor key with different event content is rejected');

reset role;
select ok((select count(*)=2 from private.transport_execution_operations
  where idempotency_key='48090000-0000-4000-8000-000000000001'),
  'the same idempotency UUID is independently scoped to two actors');
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object(
  'sub','48010000-0000-4000-8000-000000000003','aal','aal2',
  'session_id','48061000-0000-4000-8000-000000000003')::text,true);

select throws_ok($$select * from public.mutate_transport_execution(
  '48020000-0000-4000-8000-000000000001','48030000-0000-4000-8000-000000000001',
  jsonb_build_object('event_type','trip_started','plan_version_id','48080000-0000-4000-8000-000000000001',
  'expected_trip_key','48081000-0000-4000-8000-000000000001',
  'expected_plan_content_hash',repeat('a',64),'expected_sequence',1,
  'occurred_at',(select actual_at from page48_clock),'client_id',null,'note',null,
  'resolves_pairing',false),'48090000-0000-4000-8000-000000000006')$$,
  '40001','transport trip already started','one trip key cannot open a second execution stream');

select throws_ok($$select * from public.mutate_transport_execution(
  '48020000-0000-4000-8000-000000000001','48030000-0000-4000-8000-000000000001',
  jsonb_build_object('event_type','passenger_alighted','plan_version_id','48080000-0000-4000-8000-000000000001',
  'expected_trip_key','48081000-0000-4000-8000-000000000001',
  'expected_plan_content_hash',repeat('a',64),'expected_sequence',1,
  'occurred_at',(select actual_at from page48_clock),'client_id','48050000-0000-4000-8000-000000000001',
  'note',null,'resolves_pairing',false),'48090000-0000-4000-8000-000000000007')$$,
  '23514','passenger must board before alighting','alighting before boarding is rejected');

select throws_ok($$select * from public.mutate_transport_execution(
  '48020000-0000-4000-8000-000000000001','48030000-0000-4000-8000-000000000001',
  jsonb_build_object('event_type','passenger_boarded','plan_version_id','48080000-0000-4000-8000-000000000001',
  'expected_trip_key','48081000-0000-4000-8000-000000000001',
  'expected_plan_content_hash',repeat('a',64),'expected_sequence',1,
  'occurred_at',(select actual_at from page48_clock),'client_id','48050000-0000-4000-8000-000000000003',
  'note',null,'resolves_pairing',false),'48090000-0000-4000-8000-000000000008')$$,
  '23503','client is not a passenger on this plan','an unrelated client cannot be recorded');

select throws_ok($$select * from public.mutate_transport_execution(
  '48020000-0000-4000-8000-000000000001','48030000-0000-4000-8000-000000000001',
  jsonb_build_object('event_type','passenger_boarded','plan_version_id','48080000-0000-4000-8000-000000000001',
  'expected_trip_key','48081000-0000-4000-8000-000000000001',
  'expected_plan_content_hash',repeat('a',64),'expected_sequence',1,
  'occurred_at',(select actual_at-interval '1 second' from page48_clock),
  'client_id','48050000-0000-4000-8000-000000000001','note',null,
  'resolves_pairing',false),'48090000-0000-4000-8000-000000000009')$$,
  '23514','transport event time cannot move backwards',
  'actual event time cannot move backwards within a trip');

create temporary table first_board as select * from public.mutate_transport_execution(
  '48020000-0000-4000-8000-000000000001','48030000-0000-4000-8000-000000000001',
  jsonb_build_object('event_type','passenger_boarded','plan_version_id','48080000-0000-4000-8000-000000000001',
  'expected_trip_key','48081000-0000-4000-8000-000000000001',
  'expected_plan_content_hash',repeat('a',64),'expected_sequence',1,
  'occurred_at',(select actual_at from page48_clock),'client_id','48050000-0000-4000-8000-000000000001',
  'note',null,'resolves_pairing',false),'48090000-0000-4000-8000-000000000010');
select ok((select sequence=2 and client_id='48050000-0000-4000-8000-000000000001'
  and unmatched_passenger_count=2 from first_board),
  'boarding appends the next exact sequence without claiming a completed pair');

select throws_ok($$select * from public.mutate_transport_execution(
  '48020000-0000-4000-8000-000000000001','48030000-0000-4000-8000-000000000001',
  jsonb_build_object('event_type','passenger_boarded','plan_version_id','48080000-0000-4000-8000-000000000001',
  'expected_trip_key','48081000-0000-4000-8000-000000000001',
  'expected_plan_content_hash',repeat('a',64),'expected_sequence',1,
  'occurred_at',(select actual_at from page48_clock),'client_id','48050000-0000-4000-8000-000000000002',
  'note',null,'resolves_pairing',false),'48090000-0000-4000-8000-000000000011')$$,
  '40001','transport execution sequence changed','stale expected sequence is rejected');

select throws_ok($$select * from public.mutate_transport_execution(
  '48020000-0000-4000-8000-000000000001','48030000-0000-4000-8000-000000000001',
  jsonb_build_object('event_type','passenger_boarded','plan_version_id','48080000-0000-4000-8000-000000000001',
  'expected_trip_key','48081000-0000-4000-8000-000000000001',
  'expected_plan_content_hash',repeat('a',64),'expected_sequence',2,
  'occurred_at',(select actual_at from page48_clock),'client_id','48050000-0000-4000-8000-000000000001',
  'note',null,'resolves_pairing',false),'48090000-0000-4000-8000-000000000012')$$,
  '23514','passenger boarding is duplicate or already resolved','duplicate boarding is rejected');

select throws_ok($$select * from public.mutate_transport_execution(
  '48020000-0000-4000-8000-000000000001','48030000-0000-4000-8000-000000000001',
  jsonb_build_object('event_type','trip_completed','plan_version_id','48080000-0000-4000-8000-000000000001',
  'expected_trip_key','48081000-0000-4000-8000-000000000001',
  'expected_plan_content_hash',repeat('a',64),'expected_sequence',2,
  'occurred_at',(select actual_at from page48_clock),'client_id',null,
  'note','合成測試嘗試提前完成','resolves_pairing',false),
  '48090000-0000-4000-8000-000000000013')$$,
  '23514','all passenger pairs require evidence or resolution',
  'trip cannot complete while any passenger pair is unresolved');

select throws_ok($$select * from public.mutate_transport_execution(
  '48020000-0000-4000-8000-000000000001','48030000-0000-4000-8000-000000000001',
  jsonb_build_object('event_type','exception_recorded','plan_version_id','48080000-0000-4000-8000-000000000001',
  'expected_trip_key','48081000-0000-4000-8000-000000000001',
  'expected_plan_content_hash',repeat('a',64),'expected_sequence',2,
  'occurred_at',(select actual_at from page48_clock),'client_id',null,
  'note','合成測試無個案卻處理解決','resolves_pairing',true),
  '48090000-0000-4000-8000-000000000014')$$,
  '23514','invalid transport execution payload',
  'pairing resolution must identify one exact passenger');

create temporary table pairing_resolution as select * from public.mutate_transport_execution(
  '48020000-0000-4000-8000-000000000001','48030000-0000-4000-8000-000000000001',
  jsonb_build_object('event_type','exception_recorded','plan_version_id','48080000-0000-4000-8000-000000000001',
  'expected_trip_key','48081000-0000-4000-8000-000000000001',
  'expected_plan_content_hash',repeat('a',64),'expected_sequence',2,
  'occurred_at',(select actual_at from page48_clock),'client_id','48050000-0000-4000-8000-000000000002',
  'note','合成測試：乘客乙請假未搭車，人工解決配對','resolves_pairing',true),
  '48090000-0000-4000-8000-000000000015');
select ok((select sequence=3 and resolves_pairing and exception_count=1
  and unmatched_passenger_count=1 from pairing_resolution),
  'explained client exception resolves only that passenger pairing');

create temporary table first_alight as select * from public.mutate_transport_execution(
  '48020000-0000-4000-8000-000000000001','48030000-0000-4000-8000-000000000001',
  jsonb_build_object('event_type','passenger_alighted','plan_version_id','48080000-0000-4000-8000-000000000001',
  'expected_trip_key','48081000-0000-4000-8000-000000000001',
  'expected_plan_content_hash',repeat('a',64),'expected_sequence',3,
  'occurred_at',(select actual_at from page48_clock),'client_id','48050000-0000-4000-8000-000000000001',
  'note',null,'resolves_pairing',false),'48090000-0000-4000-8000-000000000016');
select ok((select sequence=4 and unmatched_passenger_count=0 from first_alight),
  'alighting closes the boarded passenger pair');

create temporary table trip_exception as select * from public.mutate_transport_execution(
  '48020000-0000-4000-8000-000000000001','48030000-0000-4000-8000-000000000001',
  jsonb_build_object('event_type','exception_recorded','plan_version_id','48080000-0000-4000-8000-000000000001',
  'expected_trip_key','48081000-0000-4000-8000-000000000001',
  'expected_plan_content_hash',repeat('a',64),'expected_sequence',4,
  'occurred_at',(select actual_at from page48_clock),'client_id',null,
  'note','合成測試：道路壅塞但不影響乘客配對','resolves_pairing',false),
  '48090000-0000-4000-8000-000000000017');
select ok((select sequence=5 and exception_count=2 and unmatched_passenger_count=0
  from trip_exception),'trip-level exception is separate from passenger pairing resolution');

create temporary table first_complete as select * from public.mutate_transport_execution(
  '48020000-0000-4000-8000-000000000001','48030000-0000-4000-8000-000000000001',
  jsonb_build_object('event_type','trip_completed','plan_version_id','48080000-0000-4000-8000-000000000001',
  'expected_trip_key','48081000-0000-4000-8000-000000000001',
  'expected_plan_content_hash',repeat('a',64),'expected_sequence',5,
  'occurred_at',(select actual_at from page48_clock),'client_id',null,
  'note','合成測試：所有乘客配對核對完成','resolves_pairing',false),
  '48090000-0000-4000-8000-000000000018');
select ok((select sequence=6 and status='completed' and actual_completed_at is not null
  and unmatched_passenger_count=0 and exception_count=2 and late_seconds>=0
  from first_complete),'completed receipt reconciles timing, exceptions and zero unmatched passengers');

select ok((select replayed and event_id=(select event_id from first_complete)
  from public.mutate_transport_execution(
  '48020000-0000-4000-8000-000000000001','48030000-0000-4000-8000-000000000001',
  jsonb_build_object('event_type','trip_completed','plan_version_id','48080000-0000-4000-8000-000000000001',
  'expected_trip_key','48081000-0000-4000-8000-000000000001',
  'expected_plan_content_hash',repeat('a',64),'expected_sequence',5,
  'occurred_at',(select actual_at from page48_clock),'client_id',null,
  'note','合成測試：所有乘客配對核對完成','resolves_pairing',false),
  '48090000-0000-4000-8000-000000000018')),
  'exact completion retry returns the original terminal receipt');

select throws_ok($$select * from public.mutate_transport_execution(
  '48020000-0000-4000-8000-000000000001','48030000-0000-4000-8000-000000000001',
  jsonb_build_object('event_type','exception_recorded','plan_version_id','48080000-0000-4000-8000-000000000001',
  'expected_trip_key','48081000-0000-4000-8000-000000000001',
  'expected_plan_content_hash',repeat('a',64),'expected_sequence',6,
  'occurred_at',(select actual_at from page48_clock),'client_id',null,
  'note','合成測試完成後不得補事件','resolves_pairing',false),
  '48090000-0000-4000-8000-000000000019')$$,
  '55000','completed transport trip cannot receive another event',
  'completed trip rejects every later event');

select throws_ok($$select * from public.mutate_transport_execution(
  '48020000-0000-4000-8000-000000000001','48030000-0000-4000-8000-000000000001',
  jsonb_build_object('event_type','trip_started','plan_version_id','48080000-0000-4000-8000-000000000003',
  'expected_trip_key','48081000-0000-4000-8000-000000000003',
  'expected_plan_content_hash',repeat('c',64),'expected_sequence',0,
  'occurred_at',(select actual_at+interval '6 minutes' from page48_clock),
  'client_id',null,'note',null,'resolves_pairing',false),
  '48090000-0000-4000-8000-000000000020')$$,
  '23514','transport event time is outside service boundary',
  'actual event cannot be more than five minutes in the future');

select throws_ok($$select * from public.mutate_transport_execution(
  '48020000-0000-4000-8000-000000000001','48030000-0000-4000-8000-000000000001',
  jsonb_build_object('event_type','trip_started','plan_version_id','48080000-0000-4000-8000-000000000004',
  'expected_trip_key','48081000-0000-4000-8000-000000000004',
  'expected_plan_content_hash',repeat('d',64),'expected_sequence',0,
  'occurred_at',(select actual_at from page48_clock),'client_id',null,'note',null,
  'resolves_pairing',false),'48090000-0000-4000-8000-000000000021')$$,
  '40001','transport plan is not the latest effective publication',
  'an unapproved plan can never authorize execution');

reset role;
insert into public.transport_execution_events(organization_id,branch_id,stream_id,
  plan_version_id,trip_key,service_date,sequence,event_type,client_id,occurred_at,note,
  resolves_pairing,actor_user_id,actor_display_name,actor_session_id,
  reauth_challenge_id,committed_at,content_hash)
select stream.organization_id,stream.branch_id,stream.id,stream.plan_version_id,stream.trip_key,
  stream.service_date,series.value,'exception_recorded',null,clock.actual_at,
  '合成測試：大量趟次例外事件 '||series.value,false,
  '48010000-0000-4000-8000-000000000001','合成接送主管',
  '48061000-0000-4000-8000-000000000001','48060000-0000-4000-8000-000000000001',
  clock.actual_at,encode(sha256(convert_to('page48-bulk-'||series.value,'UTF8')),'hex')
from public.transport_execution_streams stream cross join page48_clock clock
cross join generate_series(2,302) series(value)
where stream.plan_version_id='48080000-0000-4000-8000-000000000002';

select throws_ok($$insert into public.transport_execution_events(
  organization_id,branch_id,stream_id,plan_version_id,trip_key,service_date,sequence,
  event_type,client_id,occurred_at,note,resolves_pairing,actor_user_id,
  actor_display_name,actor_session_id,reauth_challenge_id,content_hash)
select stream.organization_id,stream.branch_id,stream.id,stream.plan_version_id,
  '48081000-0000-4000-8000-000000000099',stream.service_date,999,
  'exception_recorded',null,(select actual_at from page48_clock),
  '合成高權限錯寫事件不得脫離原趟次',false,
  '48010000-0000-4000-8000-000000000001','合成接送主管',
  '48061000-0000-4000-8000-000000000001','48060000-0000-4000-8000-000000000001',
  repeat('9',64) from public.transport_execution_streams stream
where stream.plan_version_id='48080000-0000-4000-8000-000000000001'$$,
  '23503',null,'event composite FK prevents a high-privilege trip-key mismatch');

select throws_ok($$insert into private.transport_execution_operations(
  organization_id,branch_id,actor_user_id,idempotency_key,request_hash,stream_id,
  event_id,event_type,plan_version_id,trip_key,service_date,client_id,sequence,
  result_status,actual_started_at,actual_completed_at,exception_count,
  unmatched_passenger_count,late_seconds,resolves_pairing,event_content_hash,
  plan_content_hash,committed_at)
select stream.organization_id,stream.branch_id,'48010000-0000-4000-8000-000000000001',
  '48090000-0000-4000-8000-000000000099',repeat('8',64),stream.id,
  complete.event_id,complete.event_type,stream.plan_version_id,
  '48081000-0000-4000-8000-000000000099',stream.service_date,null,
  complete.sequence,complete.status,complete.actual_started_at,complete.actual_completed_at,
  complete.exception_count,complete.unmatched_passenger_count,complete.late_seconds,
  complete.resolves_pairing,complete.event_content_hash,complete.plan_content_hash,
  complete.committed_at from public.transport_execution_streams stream
cross join first_complete complete
where stream.plan_version_id='48080000-0000-4000-8000-000000000001'$$,
  '23503',null,'operation composite FKs prevent a high-privilege trip-key mismatch');

select throws_ok($$update public.transport_execution_streams set plan_content_hash=repeat('f',64)
  where plan_version_id='48080000-0000-4000-8000-000000000001'$$,
  '55000','transport execution evidence is append-only','execution stream cannot be overwritten');
select throws_ok($$delete from public.transport_execution_events
  where id=(select event_id from first_complete)$$,
  '55000','transport execution evidence is append-only','execution event cannot be deleted');
select throws_ok($$update private.transport_execution_operations set late_seconds=999
  where event_id=(select event_id from first_complete)$$,
  '55000','transport execution evidence is append-only','idempotency receipt cannot be rewritten');

insert into public.transport_trip_plan_versions(id,organization_id,branch_id,trip_key,
  version,previous_version_id,draft_status,direction,service_date,starts_at,ends_at,
  vehicle_code,vehicle_name_snapshot,vehicle_capacity_snapshot,driver_membership_id,
  driver_user_id,driver_display_name_snapshot,driver_employee_code_snapshot,
  driver_authorization_label_snapshot,pickup_label,dropoff_label,passenger_snapshot,
  conflict_snapshot,rule_version_id,revision_reason,created_by,created_by_display_name,
  reauth_challenge_id,content_hash)
select '48080000-0000-4000-8000-000000000011','48020000-0000-4000-8000-000000000001',
  '48030000-0000-4000-8000-000000000001','48081000-0000-4000-8000-000000000001',
  2,'48080000-0000-4000-8000-000000000001','draft_ready','pickup',service_date,
  planned_at,planned_at+interval '1 hour','VAN-A','合成接送車 A',8,
  '48040000-0000-4000-8000-000000000003','48010000-0000-4000-8000-000000000003',
  '合成駕駛甲','P48-A','合成駕駛甲人工授權','合成集合點','合成日照中心',
  jsonb_build_array(
    jsonb_build_object('client_id','48050000-0000-4000-8000-000000000001','client_code','SYN-E01','display_name','合成乘客甲','pickup_label','合成住址甲','dropoff_label','合成日照中心'),
    jsonb_build_object('client_id','48050000-0000-4000-8000-000000000002','client_code','SYN-E02','display_name','合成乘客乙','pickup_label','合成住址乙','dropoff_label','合成日照中心')),
  '[]','48070000-0000-4000-8000-000000000001','執行後建立但不得再發布的版本',
  '48010000-0000-4000-8000-000000000001','合成接送主管',
  '48060000-0000-4000-8000-000000000001',repeat('f',64)
from page48_clock;
select throws_ok($$insert into public.transport_trip_plan_decisions(
  organization_id,branch_id,trip_version_id,trip_key,decision,reason,reviewed_by,
  reviewer_display_name,reauth_challenge_id,content_hash) values(
  '48020000-0000-4000-8000-000000000001','48030000-0000-4000-8000-000000000001',
  '48080000-0000-4000-8000-000000000011','48081000-0000-4000-8000-000000000001',
  'publish','執行開始後不可切換原計畫版本','48010000-0000-4000-8000-000000000002',
  '合成獨立覆核者','48060000-0000-4000-8000-000000000002',repeat('1',64))$$,
  '55000','an executing transport trip cannot publish another plan version',
  'publication cannot replace the exact plan after execution has started');

set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object(
  'sub','48010000-0000-4000-8000-000000000001','aal','aal2',
  'session_id','48061000-0000-4000-8000-000000000001')::text,true);

select ok((select matching_trip_total=3 and jsonb_array_length(trips)=3
  and pending_total=1 and in_progress_total=1 and completed_total=1
  and late_total=2 and unmatched_trip_total=1
  from public.transport_execution_snapshot(
    '48020000-0000-4000-8000-000000000001','48030000-0000-4000-8000-000000000001',
    (select service_date from page48_clock),'','','all','all')),
  'snapshot detail and complete-set status metrics reconcile');

select ok((select (trip->>'execution_sequence')::integer=302
  and jsonb_array_length(trip->'events')=300 and (trip->>'events_truncated')::boolean
  and (trip->'events'->0->>'sequence')::integer=3
  and (trip->'events'->299->>'sequence')::integer=302
  from public.transport_execution_snapshot(
    '48020000-0000-4000-8000-000000000001','48030000-0000-4000-8000-000000000001',
    (select service_date from page48_clock),'VAN-B','','all','all') snapshot
  cross join lateral jsonb_array_elements(snapshot.trips) trip),
  'snapshot returns the latest 300 contiguous events and marks truncation');

select ok((select (completed->>'status')='completed'
  and (completed->>'exception_count')::integer=2
  and (completed->>'unmatched_passenger_count')::integer=0
  and completed->'passengers' @> '[{"client_code":"SYN-E02","pairing_resolved":true}]'::jsonb
  from public.transport_execution_snapshot(
    '48020000-0000-4000-8000-000000000001','48030000-0000-4000-8000-000000000001',
    (select service_date from page48_clock),'VAN-A','','completed','with_exception') snapshot
  cross join lateral jsonb_array_elements(snapshot.trips) completed),
  'completed detail preserves passenger pairing and exception evidence');

select is((select matching_trip_total::integer from public.transport_execution_snapshot(
  '48020000-0000-4000-8000-000000000001','48030000-0000-4000-8000-000000000001',
  (select service_date from page48_clock),'VAN-A','','completed','with_exception')),1,
  'vehicle, completion and exception filters compose on one snapshot');
select is((select matching_trip_total::integer from public.transport_execution_snapshot(
  '48020000-0000-4000-8000-000000000001','48030000-0000-4000-8000-000000000001',
  (select service_date from page48_clock),'','合成駕駛甲','all','all')),2,
  'driver filter includes both exact plans for the selected driver');
select is((select matching_trip_total::integer from public.transport_execution_snapshot(
  '48020000-0000-4000-8000-000000000001','48030000-0000-4000-8000-000000000001',
  (select service_date from page48_clock),'','','all','late')),2,
  'late means actual start strictly after planned start');
select is((select matching_trip_total::integer from public.transport_execution_snapshot(
  '48020000-0000-4000-8000-000000000001','48030000-0000-4000-8000-000000000001',
  (select service_date from page48_clock),'','','all','unmatched')),1,
  'unmatched filter includes only started trips with unresolved passenger pairs');

select ok((select (pending->>'unmatched_passenger_count')::integer=0
  and pending->>'status'='not_started'
  from public.transport_execution_snapshot(
    '48020000-0000-4000-8000-000000000001','48030000-0000-4000-8000-000000000001',
    (select service_date from page48_clock),'VAN-C','','not_started','without_exception') snapshot
  cross join lateral jsonb_array_elements(snapshot.trips) pending),
  'not-started trips always report zero unmatched passengers');

select ok((select late_definition='actual_start_after_planned_start'
  and offline_status='not_configured' and export_status='not_configured'
  and notification_status='not_configured'
  from public.transport_execution_snapshot(
    '48020000-0000-4000-8000-000000000001','48030000-0000-4000-8000-000000000001',
    (select service_date from page48_clock),'','','all','all')),
  'snapshot declares late semantics and every unconfigured integration boundary');

reset role;
select ok((select metadata->>'workflow'='page48_transport_execution_v1'
  and not metadata ? 'driver_user_id' and not metadata ? 'passengers'
  from public.audit_events where table_name='transport_execution_snapshot'
  order by id desc limit 1),
  'read audit is minimized and excludes driver and passenger identities');

set local role authenticated;

select throws_ok($$select * from public.transport_execution_snapshot(
  '48020000-0000-4000-8000-000000000002','48030000-0000-4000-8000-000000000001',
  (select service_date from page48_clock),'','','all','all')$$,
  '42501','transport execution snapshot not permitted',
  'cross-organization snapshot is denied');

reset role; set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object(
  'sub','48010000-0000-4000-8000-000000000005','aal','aal2',
  'session_id','48061000-0000-4000-8000-000000000005')::text,true);
select throws_ok($$select * from public.transport_execution_snapshot(
  '48020000-0000-4000-8000-000000000001','48030000-0000-4000-8000-000000000001',
  (select service_date from page48_clock),'','','all','all')$$,
  '42501','transport execution snapshot not permitted',
  'caller from another tenant cannot read this branch');

reset role;
select ok(position('transport-trip:' in pg_get_functiondef(
  'private.mutate_transport_execution_guarded(uuid,uuid,jsonb,uuid)'::regprocedure))>0
  and position('transport-vehicle:' in pg_get_functiondef(
  'private.mutate_transport_execution_guarded(uuid,uuid,jsonb,uuid)'::regprocedure))>0
  and position('transport-driver:' in pg_get_functiondef(
  'private.mutate_transport_execution_guarded(uuid,uuid,jsonb,uuid)'::regprocedure))>0
  and position('transport-client:' in pg_get_functiondef(
  'private.mutate_transport_execution_guarded(uuid,uuid,jsonb,uuid)'::regprocedure))>0,
  'mutation serializes trip, vehicle, driver and sorted passenger resources');

select ok((select count(*)=2 from public.transport_execution_streams)
  and (select count(*)=308 from public.transport_execution_events)
  and (select count(*)=7 from private.transport_execution_operations),
  'logical mutations create one stream, event and operation row without replay duplicates');

select ok((select count(*)>=317 from public.audit_events where table_name in(
  'public.transport_execution_streams','public.transport_execution_events',
  'private.transport_execution_operations','transport_execution_snapshot')),
  'writes and reads leave complete audit evidence');

select * from finish();
rollback;
