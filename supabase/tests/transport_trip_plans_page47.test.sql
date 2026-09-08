begin;

select plan(37);

select ok(to_regclass('private.transport_policy_versions') is not null
  and to_regclass('public.transport_trip_plan_versions') is not null
  and to_regclass('public.transport_trip_plan_decisions') is not null
  and to_regclass('private.transport_plan_operations') is not null,
  'Page 47 has dedicated policy, trip, decision and operation stores');

select is((select count(*)::integer from pg_class where oid in(
  'private.transport_policy_versions'::regclass,'public.transport_trip_plan_versions'::regclass,
  'public.transport_trip_plan_decisions'::regclass,'private.transport_plan_operations'::regclass)
  and relrowsecurity and relforcerowsecurity),4,'all Page-47 stores force RLS');

select ok(not has_table_privilege('authenticated','public.transport_trip_plan_versions','select')
  and not has_table_privilege('authenticated','public.transport_trip_plan_decisions','insert')
  and not has_table_privilege('service_role','private.transport_policy_versions','select')
  and not has_table_privilege('service_role','private.transport_plan_operations','update'),
  'direct application table access is denied');

select ok(has_function_privilege('authenticated',
  'public.mutate_transport_trip_plan(uuid,uuid,text,jsonb,uuid)','execute')
  and has_function_privilege('authenticated',
  'public.transport_trip_plan_snapshot(uuid,uuid,date,text,text,text,text)','execute')
  and not has_function_privilege('anon',
  'public.mutate_transport_trip_plan(uuid,uuid,text,jsonb,uuid)','execute'),
  'only authenticated callers receive public Page-47 RPC entrypoints');

select ok((select count(*)=4 and bool_and(relrowsecurity and relforcerowsecurity)
  from pg_class where oid in('private.transport_policy_versions'::regclass,
    'public.transport_trip_plan_versions'::regclass,
    'public.transport_trip_plan_decisions'::regclass,
    'private.transport_plan_operations'::regclass)),
  'RLS cannot be bypassed by a missing FORCE flag');

select is((select count(*)::integer from pg_trigger where not tgisinternal and tgname in(
  'transport_policy_append_only','transport_trip_append_only',
  'transport_decision_append_only','transport_operation_append_only')),4,
  'all Page-47 evidence stores are append-only');

select ok((select count(*)=4 and bool_and(risk_level in(2,3)) from public.permissions
  where permission_key like 'transport_plans.%'),
  'read, manage, approve and override permissions are separate');

select ok((select count(*)=1 from public.role_permissions assignment
  join public.roles role on role.id=assignment.role_id
  join public.permissions permission on permission.id=assignment.permission_id
  where role.role_key='transport_driver' and permission.permission_key like 'transport_plans.%')
  and exists(select 1 from public.role_permissions assignment
    join public.roles role on role.id=assignment.role_id
    join public.permissions permission on permission.id=assignment.permission_id
    where role.role_key='transport_driver' and permission.permission_key='transport_plans.read'),
  'driver template receives read only, not approval or override');

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('00000000-0000-0000-0000-000000000000','47010000-0000-4000-8000-000000000001','authenticated','authenticated','page47-a@example.invalid','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','47010000-0000-4000-8000-000000000002','authenticated','authenticated','page47-b@example.invalid','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','47010000-0000-4000-8000-000000000003','authenticated','authenticated','page47-driver@example.invalid','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','47010000-0000-4000-8000-000000000004','authenticated','authenticated','page47-other@example.invalid','',now(),'{}','{}',now(),now());
insert into public.organizations(id,code,name) values
('47020000-0000-4000-8000-000000000001','page47_a','合成交通機構 A'),
('47020000-0000-4000-8000-000000000002','page47_b','合成交通機構 B');
insert into public.branches(id,organization_id,code,name) values
('47030000-0000-4000-8000-000000000001','47020000-0000-4000-8000-000000000001','main','合成交通分支 A'),
('47030000-0000-4000-8000-000000000002','47020000-0000-4000-8000-000000000001','no_policy','合成未設定分支'),
('47030000-0000-4000-8000-000000000003','47020000-0000-4000-8000-000000000002','main','合成交通分支 B');
insert into public.profiles(id,display_name,kind,employee_code) values
('47010000-0000-4000-8000-000000000001','合成交通主管甲','staff','P47-A'),
('47010000-0000-4000-8000-000000000002','合成交通主管乙','staff','P47-B'),
('47010000-0000-4000-8000-000000000003','合成駕駛甲','driver','P47-D'),
('47010000-0000-4000-8000-000000000004','合成其他機構主管','staff','P47-X');
insert into public.memberships(id,organization_id,branch_id,profile_id,status,starts_at) values
('47040000-0000-4000-8000-000000000001','47020000-0000-4000-8000-000000000001',null,'47010000-0000-4000-8000-000000000001','active',now()-interval '1 year'),
('47040000-0000-4000-8000-000000000002','47020000-0000-4000-8000-000000000001',null,'47010000-0000-4000-8000-000000000002','active',now()-interval '1 year'),
('47040000-0000-4000-8000-000000000003','47020000-0000-4000-8000-000000000001','47030000-0000-4000-8000-000000000001','47010000-0000-4000-8000-000000000003','active',now()-interval '1 year'),
('47040000-0000-4000-8000-000000000004','47020000-0000-4000-8000-000000000002',null,'47010000-0000-4000-8000-000000000004','active',now()-interval '1 year');
insert into public.membership_roles(membership_id,role_id) values
('47040000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002'),
('47040000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002'),
('47040000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000008'),
('47040000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000002');
insert into public.clients(id,organization_id,branch_id,client_code,display_name,status,admitted_on) values
('47050000-0000-4000-8000-000000000001','47020000-0000-4000-8000-000000000001','47030000-0000-4000-8000-000000000001','SYN-T01','合成個案甲','active',current_date-100),
('47050000-0000-4000-8000-000000000002','47020000-0000-4000-8000-000000000001','47030000-0000-4000-8000-000000000001','SYN-T02','合成個案乙','active',current_date-100),
('47050000-0000-4000-8000-000000000003','47020000-0000-4000-8000-000000000001','47030000-0000-4000-8000-000000000001','SYN-T03','合成個案丙','active',current_date-100);

insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,
  issued_jwt_iat,created_at,expires_at,consumed_at,consumed_jwt_iat,factor_method,factor_verified_at) values
('47060000-0000-4000-8000-000000000001','47010000-0000-4000-8000-000000000001','47061000-0000-4000-8000-000000000001',repeat('1',64),'47062000-0000-4000-8000-000000000001',now()-interval '2 minutes',now()-interval '2 minutes',now()+interval '5 minutes',now()-interval '30 seconds',now()-interval '30 seconds','totp',now()-interval '30 seconds'),
('47060000-0000-4000-8000-000000000002','47010000-0000-4000-8000-000000000002','47061000-0000-4000-8000-000000000002',repeat('2',64),'47062000-0000-4000-8000-000000000002',now()-interval '2 minutes',now()-interval '2 minutes',now()+interval '5 minutes',now()-interval '30 seconds',now()-interval '30 seconds','totp',now()-interval '30 seconds');
insert into private.reauth_events(user_id,session_id,challenge_id,aal,verification_method,verified_at) values
('47010000-0000-4000-8000-000000000001','47061000-0000-4000-8000-000000000001','47060000-0000-4000-8000-000000000001','aal2','totp',now()-interval '30 seconds'),
('47010000-0000-4000-8000-000000000002','47061000-0000-4000-8000-000000000002','47060000-0000-4000-8000-000000000002','aal2','totp',now()-interval '30 seconds');

with source as (select
  '47070000-0000-4000-8000-000000000001'::uuid id,
  '47020000-0000-4000-8000-000000000001'::uuid organization_id,
  '47030000-0000-4000-8000-000000000001'::uuid branch_id,
  '47071000-0000-4000-8000-000000000001'::uuid policy_key,1 version,
  current_date effective_from,current_date+30 effective_to,
  jsonb_build_object('source_status','manual_unstandardized','vehicles',jsonb_build_array(
    jsonb_build_object('code','VAN-A','name','合成接送車 A','capacity',2,'taxonomy_status','manual_unstandardized'),
    jsonb_build_object('code','VAN-B','name','合成接送車 B','capacity',8,'taxonomy_status','manual_unstandardized')),
    'driver_authorizations',jsonb_build_array(jsonb_build_object(
      'membership_id','47040000-0000-4000-8000-000000000003',
      'authorization_label','機構人工授權測試版本','taxonomy_status','manual_unstandardized'))) payload,
  '兩位合成人員核准交通資源測試規則'::text note,
  '47010000-0000-4000-8000-000000000001'::uuid created_by,
  '47010000-0000-4000-8000-000000000002'::uuid approved_by)
insert into private.transport_policy_versions(id,organization_id,branch_id,policy_key,version,
  effective_from,effective_to,rule_payload,publication_note,created_by,approved_by,
  created_reauth_challenge_id,approved_reauth_challenge_id,content_hash)
select id,organization_id,branch_id,policy_key,version,effective_from,effective_to,payload,note,
  created_by,approved_by,'47060000-0000-4000-8000-000000000001',
  '47060000-0000-4000-8000-000000000002',encode(sha256(convert_to(jsonb_build_object(
    'schema_version',1,'organization_id',organization_id,'branch_id',branch_id,
    'policy_key',policy_key,'version',version,'previous_version_id',null,
    'effective_from',effective_from,'effective_to',effective_to,'rule_payload',payload,
    'publication_note',note,'created_by',created_by,'approved_by',approved_by)::text,'UTF8')),'hex')
from source;

select throws_ok($$insert into private.transport_policy_versions(
  organization_id,branch_id,policy_key,version,effective_from,effective_to,rule_payload,
  publication_note,created_by,approved_by,created_reauth_challenge_id,
  approved_reauth_challenge_id,content_hash) values(
  '47020000-0000-4000-8000-000000000001','47030000-0000-4000-8000-000000000002',
  '47071000-0000-4000-8000-000000000099',1,current_date,current_date+1,'{}',
  '不完整規則不得發布','47010000-0000-4000-8000-000000000001',
  '47010000-0000-4000-8000-000000000002','47060000-0000-4000-8000-000000000001',
  '47060000-0000-4000-8000-000000000002',repeat('0',64))$$,
  '23514',null,'partial transport policies fail closed');

set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub','47010000-0000-4000-8000-000000000001',
  'aal','aal2','session_id','47061000-0000-4000-8000-000000000001')::text,true);

select is((select policy_status from public.transport_trip_plan_snapshot(
  '47020000-0000-4000-8000-000000000001','47030000-0000-4000-8000-000000000002',
  current_date+1,'all','','','all')),'not_configured',
  'an unconfigured branch is explicit and never receives invented resources');

select throws_ok($$select * from public.mutate_transport_trip_plan(
  '47020000-0000-4000-8000-000000000001','47030000-0000-4000-8000-000000000002',
  'save_trip',jsonb_build_object('mode','create','trip_key',null,'previous_version_id',null,
  'expected_version',0,'expected_content_hash',null,'direction','pickup','service_date',current_date+1,
  'starts_at',((current_date+1)::text||' 08:00+08')::timestamptz,
  'ends_at',((current_date+1)::text||' 09:00+08')::timestamptz,'vehicle_code','VAN-A',
  'driver_membership_id','47040000-0000-4000-8000-000000000003','pickup_label','合成起點',
  'dropoff_label','合成終點','passengers',jsonb_build_array(jsonb_build_object(
  'client_id','47050000-0000-4000-8000-000000000001','pickup_label','合成住址',
  'dropoff_label','合成中心')),'revision_reason','測試未設定規則'),
  '47080000-0000-4000-8000-000000000099')$$,'55000',
  'transport policy is not uniquely configured','writes fail closed without one active policy');

create temporary table first_draft as select * from public.mutate_transport_trip_plan(
  '47020000-0000-4000-8000-000000000001','47030000-0000-4000-8000-000000000001',
  'save_trip',jsonb_build_object('mode','create','trip_key',null,'previous_version_id',null,
  'expected_version',0,'expected_content_hash',null,'direction','pickup','service_date',current_date+1,
  'starts_at',((current_date+1)::text||' 08:00+08')::timestamptz,
  'ends_at',((current_date+1)::text||' 09:00+08')::timestamptz,'vehicle_code','VAN-A',
  'driver_membership_id','47040000-0000-4000-8000-000000000003','pickup_label','合成集合點',
  'dropoff_label','合成日照中心','passengers',jsonb_build_array(
    jsonb_build_object('client_id','47050000-0000-4000-8000-000000000001','pickup_label','合成住址 A','dropoff_label','合成中心'),
    jsonb_build_object('client_id','47050000-0000-4000-8000-000000000002','pickup_label','合成住址 B','dropoff_label','合成中心')),
  'revision_reason','建立第一筆合成趟次'),'47080000-0000-4000-8000-000000000001');

select ok((select not replayed and version=1 and status='draft_ready' and conflict_count=0
  from first_draft),'configured resources create a ready immutable draft');

reset role;
select ok((select jsonb_array_length(passenger_snapshot)=2
  and passenger_snapshot @> '[{"client_code":"SYN-T01","pickup_label":"合成住址 A"}]'::jsonb
  and vehicle_capacity_snapshot=2 and driver_authorization_label_snapshot='機構人工授權測試版本'
  from public.transport_trip_plan_versions where id=(select trip_version_id from first_draft)),
  'trip freezes exact passenger, vehicle and driver evidence');
set local role authenticated;

select ok((select replayed and trip_version_id=(select trip_version_id from first_draft)
  from public.mutate_transport_trip_plan(
  '47020000-0000-4000-8000-000000000001','47030000-0000-4000-8000-000000000001',
  'save_trip',jsonb_build_object('mode','create','trip_key',null,'previous_version_id',null,
  'expected_version',0,'expected_content_hash',null,'direction','pickup','service_date',current_date+1,
  'starts_at',((current_date+1)::text||' 08:00+08')::timestamptz,
  'ends_at',((current_date+1)::text||' 09:00+08')::timestamptz,'vehicle_code','VAN-A',
  'driver_membership_id','47040000-0000-4000-8000-000000000003','pickup_label','合成集合點',
  'dropoff_label','合成日照中心','passengers',jsonb_build_array(
    jsonb_build_object('client_id','47050000-0000-4000-8000-000000000001','pickup_label','合成住址 A','dropoff_label','合成中心'),
    jsonb_build_object('client_id','47050000-0000-4000-8000-000000000002','pickup_label','合成住址 B','dropoff_label','合成中心')),
  'revision_reason','建立第一筆合成趟次'),'47080000-0000-4000-8000-000000000001')),
  'exact save retry returns original result');

select throws_ok($$select * from public.mutate_transport_trip_plan(
  '47020000-0000-4000-8000-000000000001','47030000-0000-4000-8000-000000000001',
  'save_trip',jsonb_build_object('mode','create','trip_key',null,'previous_version_id',null,
  'expected_version',0,'expected_content_hash',null,'direction','pickup','service_date',current_date+1,
  'starts_at',((current_date+1)::text||' 08:00+08')::timestamptz,
  'ends_at',((current_date+1)::text||' 09:00+08')::timestamptz,'vehicle_code','VAN-B',
  'driver_membership_id','47040000-0000-4000-8000-000000000003','pickup_label','不同內容',
  'dropoff_label','合成日照中心','passengers',jsonb_build_array(jsonb_build_object(
  'client_id','47050000-0000-4000-8000-000000000001','pickup_label','合成住址 A','dropoff_label','合成中心')),
  'revision_reason','不同內容'),'47080000-0000-4000-8000-000000000001')$$,
  '23505','transport plan idempotency conflict','same actor key with different content is rejected');

select throws_ok($$select * from first_draft draft cross join lateral
  public.mutate_transport_trip_plan('47020000-0000-4000-8000-000000000001',
  '47030000-0000-4000-8000-000000000001','decide_trip',jsonb_build_object(
  'decision','publish','trip_version_id',draft.trip_version_id,'expected_trip_key',draft.trip_key,
  'expected_version',draft.version,'expected_content_hash',draft.content_hash,
  'expected_conflict_count',draft.conflict_count,'expected_rule_version_id',draft.rule_version_id,
  'reason','建立者不得核准自己的趟次'),'47080000-0000-4000-8000-000000000002')$$,
  '42501','transport creator cannot review own draft','creator cannot self-approve');

reset role; set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub','47010000-0000-4000-8000-000000000002',
  'aal','aal2','session_id','47061000-0000-4000-8000-000000000002')::text,true);
create temporary table first_publish as select result.* from first_draft draft cross join lateral
  public.mutate_transport_trip_plan('47020000-0000-4000-8000-000000000001',
  '47030000-0000-4000-8000-000000000001','decide_trip',jsonb_build_object(
  'decision','publish','trip_version_id',draft.trip_version_id,'expected_trip_key',draft.trip_key,
  'expected_version',draft.version,'expected_content_hash',draft.content_hash,
  'expected_conflict_count',draft.conflict_count,'expected_rule_version_id',draft.rule_version_id,
  'reason','獨立核對車輛駕駛乘員與時間'),'47080000-0000-4000-8000-000000000003') result;

select ok((select not replayed and status='published' and decision='publish' from first_publish),
  'another recent-AAL2 manager publishes a clear trip');

select ok((select result.replayed and result.status='published' from first_draft draft cross join lateral
  public.mutate_transport_trip_plan('47020000-0000-4000-8000-000000000001',
  '47030000-0000-4000-8000-000000000001','decide_trip',jsonb_build_object(
  'decision','publish','trip_version_id',draft.trip_version_id,'expected_trip_key',draft.trip_key,
  'expected_version',draft.version,'expected_content_hash',draft.content_hash,
  'expected_conflict_count',draft.conflict_count,'expected_rule_version_id',draft.rule_version_id,
  'reason','獨立核對車輛駕駛乘員與時間'),'47080000-0000-4000-8000-000000000003') result),
  'exact decision retry returns original result');

reset role; set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub','47010000-0000-4000-8000-000000000001',
  'aal','aal2','session_id','47061000-0000-4000-8000-000000000001')::text,true);
create temporary table conflicted_draft as select * from public.mutate_transport_trip_plan(
  '47020000-0000-4000-8000-000000000001','47030000-0000-4000-8000-000000000001',
  'save_trip',jsonb_build_object('mode','create','trip_key',null,'previous_version_id',null,
  'expected_version',0,'expected_content_hash',null,'direction','pickup','service_date',current_date+1,
  'starts_at',((current_date+1)::text||' 08:30+08')::timestamptz,
  'ends_at',((current_date+1)::text||' 09:30+08')::timestamptz,'vehicle_code','VAN-A',
  'driver_membership_id','47040000-0000-4000-8000-000000000003','pickup_label','合成第二集合點',
  'dropoff_label','合成日照中心','passengers',jsonb_build_array(
    jsonb_build_object('client_id','47050000-0000-4000-8000-000000000001','pickup_label','合成住址 A','dropoff_label','合成中心'),
    jsonb_build_object('client_id','47050000-0000-4000-8000-000000000002','pickup_label','合成住址 B','dropoff_label','合成中心'),
    jsonb_build_object('client_id','47050000-0000-4000-8000-000000000003','pickup_label','合成住址 C','dropoff_label','合成中心')),
  'revision_reason','建立完整衝突測試趟次'),'47080000-0000-4000-8000-000000000004');

select ok((select status='draft_conflicted' and conflict_count=5 from conflicted_draft),
  'capacity, vehicle, driver and two client conflicts remain explicit');

reset role;
select ok((select conflict_snapshot @> '[{"code":"vehicle_capacity_exceeded"}]'::jsonb
  and conflict_snapshot @> '[{"code":"vehicle_time_overlap"}]'::jsonb
  and conflict_snapshot @> '[{"code":"driver_time_overlap"}]'::jsonb
  and (select count(*) from jsonb_array_elements(conflict_snapshot) item
    where item->>'code'='client_time_overlap')=2
  from public.transport_trip_plan_versions where id=(select trip_version_id from conflicted_draft)),
  'all resource conflicts preserve structured codes and identities');

set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub','47010000-0000-4000-8000-000000000002',
  'aal','aal2','session_id','47061000-0000-4000-8000-000000000002')::text,true);
select throws_ok($$select * from conflicted_draft draft cross join lateral
  public.mutate_transport_trip_plan('47020000-0000-4000-8000-000000000001',
  '47030000-0000-4000-8000-000000000001','decide_trip',jsonb_build_object(
  'decision','publish','trip_version_id',draft.trip_version_id,'expected_trip_key',draft.trip_key,
  'expected_version',draft.version,'expected_content_hash',draft.content_hash,
  'expected_conflict_count',draft.conflict_count,'expected_rule_version_id',draft.rule_version_id,
  'reason','衝突趟次不可一般發布'),'47080000-0000-4000-8000-000000000005')$$,
  '23514','transport decision does not match conflicts','ordinary publish cannot hide conflicts');

create temporary table override_publish as select result.* from conflicted_draft draft cross join lateral
  public.mutate_transport_trip_plan('47020000-0000-4000-8000-000000000001',
  '47030000-0000-4000-8000-000000000001','decide_trip',jsonb_build_object(
  'decision','override','trip_version_id',draft.trip_version_id,'expected_trip_key',draft.trip_key,
  'expected_version',draft.version,'expected_content_hash',draft.content_hash,
  'expected_conflict_count',draft.conflict_count,'expected_rule_version_id',draft.rule_version_id,
  'reason','合成測試：逐項核對衝突並限此趟次例外發布'),'47080000-0000-4000-8000-000000000006') result;

select ok((select status='published' and decision='override' and conflict_count=5
  from override_publish),'independent override publishes while preserving conflicts');

reset role;
select ok((select decision='override' and reviewed_by='47010000-0000-4000-8000-000000000002'
  and reason like '合成測試%' from public.transport_trip_plan_decisions
  where trip_version_id=(select trip_version_id from conflicted_draft)),
  'override preserves reviewer and explicit reason');

select throws_ok($$update public.transport_trip_plan_versions set pickup_label='不可覆寫'
  where id=(select trip_version_id from first_draft)$$,'55000',
  'transport planning evidence is append-only','published trip cannot be overwritten');

select throws_ok($$delete from public.transport_trip_plan_decisions
  where trip_version_id=(select trip_version_id from conflicted_draft)$$,'55000',
  'transport planning evidence is append-only','override decision cannot be deleted');

set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub','47010000-0000-4000-8000-000000000002',
  'aal','aal2','session_id','47061000-0000-4000-8000-000000000002')::text,true);
select ok((select matching_trip_total=2 and jsonb_array_length(trips)=2
  and passenger_total=5 and capacity_conflict_total=1 and pending_publication_total=0
  from public.transport_trip_plan_snapshot('47020000-0000-4000-8000-000000000001',
  '47030000-0000-4000-8000-000000000001',current_date+1,'all','','','all')),
  'snapshot detail and complete-set metrics reconcile');

select ok((select policy_status='manual_unstandardized' and policy_version=1
  and jsonb_array_length(vehicles)=2 and jsonb_array_length(drivers)=1
  and offline_status='not_configured' and export_status='not_configured'
  and notification_provider_status='not_configured'
  from public.transport_trip_plan_snapshot('47020000-0000-4000-8000-000000000001',
  '47030000-0000-4000-8000-000000000001',current_date+1,'all','','','all')),
  'snapshot exposes manual governance and every unconfigured boundary');

select is((select matching_trip_total::integer from public.transport_trip_plan_snapshot(
  '47020000-0000-4000-8000-000000000001','47030000-0000-4000-8000-000000000001',
  current_date+1,'pickup','VAN-A','P47-D','published')),2,
  'direction, vehicle, driver and status filters use one snapshot');

reset role;
select ok((select metadata->>'workflow'='page47_transport_plan_v1'
  and not metadata ? 'driver_membership_id' and not metadata ? 'passenger_snapshot'
  from public.audit_events where table_name='transport_trip_plan_snapshot'
  order by id desc limit 1),'read audit is minimized and excludes people and locations');

set local role authenticated;

select throws_ok($$select * from public.transport_trip_plan_snapshot(
  '47020000-0000-4000-8000-000000000002','47030000-0000-4000-8000-000000000001',
  current_date+1,'all','','','all')$$,'42501','transport plan snapshot not permitted',
  'cross-organization snapshot is denied');

reset role; set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub','47010000-0000-4000-8000-000000000004',
  'aal','aal2','session_id','47061000-0000-4000-8000-000000000004')::text,true);
select throws_ok($$select * from public.transport_trip_plan_snapshot(
  '47020000-0000-4000-8000-000000000001','47030000-0000-4000-8000-000000000001',
  current_date+1,'all','','','all')$$,'42501','transport plan snapshot not permitted',
  'a caller from another organization cannot read this branch');

reset role;
select ok(position('transport-vehicle:' in pg_get_functiondef(
  'private.mutate_transport_trip_plan_guarded(uuid,uuid,text,jsonb,uuid)'::regprocedure))>0
  and position('transport-driver:' in pg_get_functiondef(
  'private.mutate_transport_trip_plan_guarded(uuid,uuid,text,jsonb,uuid)'::regprocedure))>0
  and position('transport-client:' in pg_get_functiondef(
  'private.mutate_transport_trip_plan_guarded(uuid,uuid,text,jsonb,uuid)'::regprocedure))>0,
  'publication serializes vehicle, driver and every passenger decision');

select ok(not exists(select 1 from pg_proc function join pg_namespace namespace
  on namespace.oid=function.pronamespace where namespace.nspname='public'
  and function.prosecdef and function.proname in(
    'mutate_transport_trip_plan','transport_trip_plan_snapshot')),
  'no public Page-47 RPC is security definer');

set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub','47010000-0000-4000-8000-000000000001',
  'aal','aal1','session_id','47061000-0000-4000-8000-000000000001')::text,true);
select throws_ok($$select * from public.mutate_transport_trip_plan(
  '47020000-0000-4000-8000-000000000001','47030000-0000-4000-8000-000000000001',
  'save_trip','{}','47080000-0000-4000-8000-000000000098')$$,'42501',
  'transport plan operation not permitted','AAL1 cannot write even before content parsing');

reset role;
select ok((select count(*)=2 and bool_and(content_hash~'^[a-f0-9]{64}$')
  from public.transport_trip_plan_versions),
  'every frozen trip has a SHA-256 content hash');

select ok((select count(*)=4
  and count(*) filter(where action='save_trip')=2
  and count(*) filter(where action='decide_trip')=2 from private.transport_plan_operations),
  'operation ledger contains one row per committed logical action');

select ok((select count(*)>=3 from public.audit_events
  where table_name in('transport_trip_plan_versions','transport_trip_plan_decisions',
    'transport_trip_plan_snapshot')),'writes and reads leave audit evidence');

select * from finish();
rollback;
