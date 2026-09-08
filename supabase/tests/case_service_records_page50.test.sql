begin;
select plan(57);

select results_eq(
  $$select permission_key collate "C" from public.permissions where permission_key like 'case_service_records.%' order by 1$$,
  $$values ('case_service_records.manage'::text collate "C"),('case_service_records.read'::text collate "C"),('case_service_records.sign'::text collate "C")$$,
  'Page 50 exposes separate read, manage and sign scopes');
select is((select count(*) from public.role_permissions rp join public.permissions p on p.id=rp.permission_id
  where p.permission_key like 'case_service_records.%'),17::bigint,
  'five signing roles and one non-signing care-worker role receive conservative scopes');
select ok((select bool_and(relrowsecurity and relforcerowsecurity) from pg_class where oid in
  ('public.case_service_record_versions'::regclass,'private.case_service_record_operations'::regclass)),
  'record and operation ledgers force RLS');
select ok(not has_table_privilege('authenticated','public.case_service_record_versions','select,insert,update,delete')
  and not has_table_privilege('service_role','public.case_service_record_versions','select,insert,update,delete')
  and not has_table_privilege('authenticated','private.case_service_record_operations','select,insert,update,delete'),
  'browser and service roles cannot bypass guarded RPCs with direct table DML');
select ok(has_function_privilege('authenticated','public.mutate_case_service_record(uuid,uuid,text,jsonb,uuid)','execute')
  and has_function_privilege('authenticated','public.case_service_record_snapshot(uuid,uuid,date,date,uuid,text,uuid,text)','execute')
  and not has_function_privilege('service_role','public.mutate_case_service_record(uuid,uuid,text,jsonb,uuid)','execute'),
  'public Page-50 RPCs are authenticated-only');
select ok(not (select prosecdef from pg_proc where oid=
  'public.mutate_case_service_record(uuid,uuid,text,jsonb,uuid)'::regprocedure)
  and (select prosecdef and coalesce(proconfig,'{}'::text[]) @> array['search_path=""'] from pg_proc
    where oid='private.mutate_case_service_record_guarded(uuid,uuid,text,jsonb,uuid)'::regprocedure),
  'public mutation wrapper is invoker and guarded core is pinned definer');
select is((select count(*) from pg_trigger where not tgisinternal and tgname in
  ('case_service_record_versions_append_only','case_service_record_operations_append_only')),2::bigint,
  'both ledgers are append-only');
select is((select count(*) from pg_trigger where not tgisinternal and tgname in
  ('case_service_record_versions_audit_row_change','case_service_record_operations_audit_row_change')),2::bigint,
  'both ledgers audit inserts without copying narratives');
select ok(position('pg_advisory_xact_lock' in pg_get_functiondef(
  'private.mutate_case_service_record_guarded(uuid,uuid,text,jsonb,uuid)'::regprocedure))>0
  and position('expected_record_payload' in pg_get_functiondef(
  'private.mutate_case_service_record_guarded(uuid,uuid,text,jsonb,uuid)'::regprocedure))>0,
  'mutation serializes writes and binds a sign request to the selected full draft');
select is((select count(*) from pg_constraint constraint_row
  cross join lateral unnest(constraint_row.conkey) fk_column
  where constraint_row.contype='f' and constraint_row.conrelid in
    ('public.case_service_record_versions'::regclass,'private.case_service_record_operations'::regclass)
    and not exists(select 1 from pg_index index_row where index_row.indrelid=constraint_row.conrelid
      and index_row.indisvalid and index_row.indisready and fk_column=any(index_row.indkey))),0::bigint,
  'every Page-50 foreign-key column participates in a supporting index');

insert into auth.users(id,aud,role,email,created_at,updated_at) values
 ('50000000-1000-4000-8000-000000000001','authenticated','authenticated','manager50@example.invalid',now(),now()),
 ('50000000-1000-4000-8000-000000000002','authenticated','authenticated','worker50@example.invalid',now(),now()),
 ('50000000-1000-4000-8000-000000000003','authenticated','authenticated','outsider50@example.invalid',now(),now());
insert into public.organizations(id,code,name) values
 ('50000000-2000-4000-8000-000000000001','page50-a','服務紀錄測試機構 A'),
 ('50000000-2000-4000-8000-000000000002','page50-b','服務紀錄測試機構 B');
insert into public.branches(id,organization_id,code,name) values
 ('50000000-3000-4000-8000-000000000001','50000000-2000-4000-8000-000000000001','main','A 主分支'),
 ('50000000-3000-4000-8000-000000000002','50000000-2000-4000-8000-000000000001','other','A 次分支'),
 ('50000000-3000-4000-8000-000000000003','50000000-2000-4000-8000-000000000002','main','B 主分支');
insert into public.profiles(id,display_name,kind) values
 ('50000000-1000-4000-8000-000000000001','服務紀錄主管','staff'),
 ('50000000-1000-4000-8000-000000000002','指派照服員','staff'),
 ('50000000-1000-4000-8000-000000000003','未指派照服員','staff');
insert into public.memberships(id,organization_id,branch_id,profile_id,status) values
 ('50000000-4000-4000-8000-000000000001','50000000-2000-4000-8000-000000000001',null,'50000000-1000-4000-8000-000000000001','active'),
 ('50000000-4000-4000-8000-000000000002','50000000-2000-4000-8000-000000000001','50000000-3000-4000-8000-000000000001','50000000-1000-4000-8000-000000000002','active'),
 ('50000000-4000-4000-8000-000000000003','50000000-2000-4000-8000-000000000001','50000000-3000-4000-8000-000000000001','50000000-1000-4000-8000-000000000003','active');
insert into public.membership_roles(membership_id,role_id)
select '50000000-4000-4000-8000-000000000001',id from public.roles
where role_key='organization_manager' and is_system;
insert into public.membership_roles(membership_id,role_id)
select '50000000-4000-4000-8000-000000000002',id from public.roles
where role_key='care_worker' and is_system;
insert into public.membership_roles(membership_id,role_id)
select '50000000-4000-4000-8000-000000000003',id from public.roles
where role_key='care_worker' and is_system;
insert into public.clients(id,organization_id,branch_id,client_code,display_name,status,admitted_on) values
 ('50000000-5000-4000-8000-000000000001','50000000-2000-4000-8000-000000000001','50000000-3000-4000-8000-000000000001','P50-1','合成個案甲','active',current_date-90),
 ('50000000-5000-4000-8000-000000000002','50000000-2000-4000-8000-000000000001','50000000-3000-4000-8000-000000000001','P50-2','合成個案乙','active',current_date-90),
 ('50000000-5000-4000-8000-000000000003','50000000-2000-4000-8000-000000000001','50000000-3000-4000-8000-000000000002','P50-3','他分支個案','active',current_date-90);
insert into public.client_assignments(id,organization_id,branch_id,client_id,assignee_user_id,assignment_kind) values
 ('50000000-6000-4000-8000-000000000001','50000000-2000-4000-8000-000000000001','50000000-3000-4000-8000-000000000001','50000000-5000-4000-8000-000000000001','50000000-1000-4000-8000-000000000002','daily-care');

-- A synthetic completed execution is owner-seeded solely as a source fixture.
-- The production Page-50 workflow never writes or changes service_events.
alter table public.service_events disable trigger service_events_validate_client_service_plan;
insert into public.service_events(id,organization_id,branch_id,client_id,service_code,status,
  started_at,ended_at,staff_user_id,evidence,idempotency_key,content_hash) values
 ('50000000-7000-4000-8000-000000000001','50000000-2000-4000-8000-000000000001',
  '50000000-3000-4000-8000-000000000001','50000000-5000-4000-8000-000000000001',
  'SYN-P50-NOT-OFFICIAL','completed',clock_timestamp()-interval '3 hours',
  clock_timestamp()-interval '2 hours','50000000-1000-4000-8000-000000000001',
  '{"synthetic":true}','50000000-7100-4000-8000-000000000001',repeat('7',64)),
 ('50000000-7000-4000-8000-000000000002','50000000-2000-4000-8000-000000000001',
  '50000000-3000-4000-8000-000000000001','50000000-5000-4000-8000-000000000002',
  'SYN-P50-OTHER-CLIENT','completed',clock_timestamp()-interval '3 hours',
  clock_timestamp()-interval '2 hours','50000000-1000-4000-8000-000000000001',
  '{"synthetic":true}','50000000-7100-4000-8000-000000000002',repeat('6',64)),
 ('50000000-7000-4000-8000-000000000003','50000000-2000-4000-8000-000000000001',
  '50000000-3000-4000-8000-000000000001','50000000-5000-4000-8000-000000000001',
  'SYN-P50-PLANNED','planned',clock_timestamp()-interval '3 hours',null,
  '50000000-1000-4000-8000-000000000001','{"synthetic":true}',
  '50000000-7100-4000-8000-000000000003',repeat('5',64)),
 ('50000000-7000-4000-8000-000000000004','50000000-2000-4000-8000-000000000001',
  '50000000-3000-4000-8000-000000000001','50000000-5000-4000-8000-000000000001',
  'SYN-P50-BAD-HASH','completed',clock_timestamp()-interval '3 hours',
  clock_timestamp()-interval '2 hours','50000000-1000-4000-8000-000000000001',
  '{"synthetic":true}','50000000-7100-4000-8000-000000000004','not-a-hash'),
 ('50000000-7000-4000-8000-000000000005','50000000-2000-4000-8000-000000000001',
  '50000000-3000-4000-8000-000000000001','50000000-5000-4000-8000-000000000001',
  'SYN-P50-WRONG-AUTHOR','completed',clock_timestamp()-interval '3 hours',
  clock_timestamp()-interval '2 hours','50000000-1000-4000-8000-000000000003',
  '{"synthetic":true}','50000000-7100-4000-8000-000000000005',repeat('4',64));
alter table public.service_events enable trigger service_events_validate_client_service_plan;

create temporary table created as select * from public.mutate_case_service_record(null,null,null,null,null) with no data;
create temporary table revised (like created); create temporary table signed (like created);
create temporary table corrected (like created); create temporary table worker_created (like created);
create temporary table page50_times as select
  clock_timestamp()-interval '3 hours' as started_at,
  clock_timestamp()-interval '2 hours' as ended_at;
grant select,insert on created,revised,signed,corrected,worker_created to authenticated;
grant select on page50_times to authenticated;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"50000000-1000-4000-8000-000000000002","role":"authenticated","aal":"aal1","session_id":"50000000-8000-4000-8000-000000000002"}',true);
select throws_ok($$select * from public.case_service_record_snapshot(
  '50000000-2000-4000-8000-000000000001','50000000-3000-4000-8000-000000000001')$$,
  '42501','case-service-record snapshot is not permitted','AAL1 cannot read Page 50');
select set_config('request.jwt.claims','{"sub":"50000000-1000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"50000000-8000-4000-8000-000000000002"}',true);
select throws_ok($$select * from public.mutate_case_service_record(
  '50000000-2000-4000-8000-000000000001','50000000-3000-4000-8000-000000000001','save_record',
  jsonb_build_object('mode','create','record_key',null,'previous_version_id',null,'expected_version',0,
    'expected_content_hash',null,'client_id','50000000-5000-4000-8000-000000000002',
    'started_at',to_char(clock_timestamp()-interval '1 hour','YYYY-MM-DD"T"HH24:MI:SSOF'),
    'ended_at',to_char(clock_timestamp()-interval '30 minutes','YYYY-MM-DD"T"HH24:MI:SSOF'),
    'service_type','生活支持','service_content','不得建立','service_result','不得建立',
    'execution_reference_id',null,'reason','建立草稿'),
  '50000000-9000-4000-8000-000000000099')$$,
  '42501','case-service-record client is not permitted','unassigned worker cannot write another client');

select set_config('request.jwt.claims','{"sub":"50000000-1000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"50000000-8000-4000-8000-000000000001"}',true);
select throws_ok($$select * from public.mutate_case_service_record(
  '50000000-2000-4000-8000-000000000001','50000000-3000-4000-8000-000000000001','save_record',
  jsonb_build_object('mode','create','record_key',null,'previous_version_id',null,'expected_version',0,
    'expected_content_hash',null,'client_id','50000000-5000-4000-8000-000000000001',
    'started_at','2026-02-30T10:00:00+08:00','ended_at','2026-02-30T11:00:00+08:00',
    'service_type','生活支持','service_content','無效日期','service_result','無效日期',
    'execution_reference_id',null,'reason','建立草稿'),
  '50000000-9000-4000-8000-000000000090')$$,
  '22023','case-service-record date or execution reference is invalid','impossible calendar dates are rejected');
select throws_ok($$select * from public.mutate_case_service_record(
  '50000000-2000-4000-8000-000000000001','50000000-3000-4000-8000-000000000001','save_record',
  jsonb_build_object('mode','create','record_key',null,'previous_version_id',null,'expected_version',0,
    'expected_content_hash',null,'client_id','50000000-5000-4000-8000-000000000001',
    'started_at','2026-09-08','ended_at','2026-09-08T11:00:00+08:00',
    'service_type','生活支持','service_content','日期無時區','service_result','日期無時區',
    'execution_reference_id',null,'reason','建立草稿'),
  '50000000-9000-4000-8000-000000000091')$$,
  '22023','case-service-record manual field shape is invalid','date-only timestamps fail closed');
select throws_ok($$select * from public.mutate_case_service_record(
  '50000000-2000-4000-8000-000000000001','50000000-3000-4000-8000-000000000001','save_record',
  jsonb_build_object('mode','create','record_key',null,'previous_version_id',null,'expected_version',0,
    'expected_content_hash',null,'client_id','50000000-5000-4000-8000-000000000001',
    'started_at','2026-09-08T10:00:00','ended_at','2026-09-08T11:00:00+08:00',
    'service_type','生活支持','service_content','日期無時區','service_result','日期無時區',
    'execution_reference_id',null,'reason','建立草稿'),
  '50000000-9000-4000-8000-000000000092')$$,
  '22023','case-service-record manual field shape is invalid','timestamps without a timezone fail closed');

select throws_ok($$select * from public.mutate_case_service_record(
  '50000000-2000-4000-8000-000000000001','50000000-3000-4000-8000-000000000001','save_record',
  jsonb_build_object('mode','create','record_key',null,'previous_version_id',null,'expected_version',0,
    'expected_content_hash',null,'client_id','50000000-5000-4000-8000-000000000001',
    'started_at',(select started_at from page50_times),'ended_at',(select ended_at from page50_times),
    'service_type','生活支持','service_content','不得連結其他個案事件','service_result','拒絕建立',
    'execution_reference_id','50000000-7000-4000-8000-000000000002','reason','建立草稿'),
  '50000000-9000-4000-8000-000000000093')$$,
  '23514','linked execution evidence is not a completed exact-scope author event',
  'an execution from another client cannot support the narrative');
select throws_ok($$select * from public.mutate_case_service_record(
  '50000000-2000-4000-8000-000000000001','50000000-3000-4000-8000-000000000001','save_record',
  jsonb_build_object('mode','create','record_key',null,'previous_version_id',null,'expected_version',0,
    'expected_content_hash',null,'client_id','50000000-5000-4000-8000-000000000001',
    'started_at',(select started_at from page50_times),'ended_at',(select ended_at from page50_times),
    'service_type','生活支持','service_content','不得連結未完成事件','service_result','拒絕建立',
    'execution_reference_id','50000000-7000-4000-8000-000000000003','reason','建立草稿'),
  '50000000-9000-4000-8000-000000000094')$$,
  '23514','linked execution evidence is not a completed exact-scope author event',
  'a planned execution cannot support the narrative');
select throws_ok($$select * from public.mutate_case_service_record(
  '50000000-2000-4000-8000-000000000001','50000000-3000-4000-8000-000000000001','save_record',
  jsonb_build_object('mode','create','record_key',null,'previous_version_id',null,'expected_version',0,
    'expected_content_hash',null,'client_id','50000000-5000-4000-8000-000000000001',
    'started_at',(select started_at from page50_times),'ended_at',(select ended_at from page50_times),
    'service_type','生活支持','service_content','不得連結無效雜湊事件','service_result','拒絕建立',
    'execution_reference_id','50000000-7000-4000-8000-000000000004','reason','建立草稿'),
  '50000000-9000-4000-8000-000000000095')$$,
  '23514','linked execution evidence is not a completed exact-scope author event',
  'an execution without a trusted SHA-256 hash cannot support the narrative');
select throws_ok($$select * from public.mutate_case_service_record(
  '50000000-2000-4000-8000-000000000001','50000000-3000-4000-8000-000000000001','save_record',
  jsonb_build_object('mode','create','record_key',null,'previous_version_id',null,'expected_version',0,
    'expected_content_hash',null,'client_id','50000000-5000-4000-8000-000000000001',
    'started_at',(select started_at from page50_times),'ended_at',(select ended_at from page50_times),
    'service_type','生活支持','service_content','不得連結他人事件','service_result','拒絕建立',
    'execution_reference_id','50000000-7000-4000-8000-000000000005','reason','建立草稿'),
  '50000000-9000-4000-8000-000000000096')$$,
  '23514','linked execution evidence is not a completed exact-scope author event',
  'an execution authored by another staff member cannot support the narrative');

insert into created select * from public.mutate_case_service_record(
  '50000000-2000-4000-8000-000000000001','50000000-3000-4000-8000-000000000001','save_record',
  jsonb_build_object('mode','create','record_key',null,'previous_version_id',null,'expected_version',0,
    'expected_content_hash',null,'client_id','50000000-5000-4000-8000-000000000001',
    'started_at',(select started_at from page50_times),'ended_at',(select ended_at from page50_times),
    'service_type','生活支持','service_content','依現場安排提供人工生活支持並留下敘事。',
    'service_result','本次人工敘事記載服務已完成。',
    'execution_reference_id','50000000-7000-4000-8000-000000000001','reason','建立人工服務敘事草稿'),
  '50000000-9000-4000-8000-000000000001');
select is((select record_state from created),'draft','create returns a draft receipt');
select ok((select organization_id='50000000-2000-4000-8000-000000000001'
  and branch_id='50000000-3000-4000-8000-000000000001'
  and client_id='50000000-5000-4000-8000-000000000001'
  and actor_user_id='50000000-1000-4000-8000-000000000001'
  and idempotency_key='50000000-9000-4000-8000-000000000001'
  and previous_version_id is null and source_content_hash is null from created),
  'create receipt is bound to tenant, branch, client, actor, retry key and baseline');
select ok((select record_payload->>'source_kind'='manual_local'
  and record_payload->>'schema_kind'='manual_service_narrative_v1'
  and record_payload->>'statutory_rule_status'='not_configured'
  and record_payload->>'claim_eligibility_status'='not_configured'
  and record_payload->>'execution_reference_content_hash'=repeat('7',64) from created),
  'receipt returns persisted manual boundary and frozen execution hash');
select is((select replayed from public.mutate_case_service_record(
  '50000000-2000-4000-8000-000000000001','50000000-3000-4000-8000-000000000001','save_record',
  jsonb_build_object('mode','create','record_key',null,'previous_version_id',null,'expected_version',0,
    'expected_content_hash',null,'client_id','50000000-5000-4000-8000-000000000001',
    'started_at',(select started_at from page50_times),'ended_at',(select ended_at from page50_times),
    'service_type','生活支持','service_content','依現場安排提供人工生活支持並留下敘事。',
    'service_result','本次人工敘事記載服務已完成。',
    'execution_reference_id','50000000-7000-4000-8000-000000000001','reason','建立人工服務敘事草稿'),
  '50000000-9000-4000-8000-000000000001')),true,
  'same actor and exact request returns the stored receipt');
select throws_ok($$select * from public.mutate_case_service_record(
  '50000000-2000-4000-8000-000000000001','50000000-3000-4000-8000-000000000001','save_record',
  jsonb_build_object('mode','create','record_key',null,'previous_version_id',null,'expected_version',0,
    'expected_content_hash',null,'client_id','50000000-5000-4000-8000-000000000001',
    'started_at',(select started_at from page50_times),'ended_at',(select ended_at from page50_times),
    'service_type','生活支持','service_content','不同內容','service_result','不同結果',
    'execution_reference_id',null,'reason','建立不同草稿'),
  '50000000-9000-4000-8000-000000000001')$$,
  '23505','case-service-record idempotency conflict','same actor key with changed content is rejected');

reset role;
select ok((select started_at=(select started_at from page50_times)
  and ended_at=(select ended_at from page50_times) and service_content='依現場安排提供人工生活支持並留下敘事。'
  and execution_reference_status='linked_completed_event'
  and execution_reference_content_hash=repeat('7',64)
  and claim_eligibility_status='not_configured'
  from public.case_service_record_versions where id=(select version_id from created)),
  'stored draft preserves manual fields and only references trusted completed evidence');
select is((select count(*) from public.service_events),5::bigint,
  'creating a narrative does not create an extra execution authority');
select is((select count(*) from public.claim_items),0::bigint,
  'creating a narrative does not create or qualify a claim item');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"50000000-1000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"50000000-8000-4000-8000-000000000002"}',true);
select throws_ok(format($sql$select * from public.mutate_case_service_record(
  '50000000-2000-4000-8000-000000000001','50000000-3000-4000-8000-000000000001','save_record',
  jsonb_build_object('mode','revise','record_key','%s','previous_version_id','%s','expected_version',1,
    'expected_content_hash','%s','client_id','50000000-5000-4000-8000-000000000001',
    'started_at',(select started_at from page50_times),'ended_at',(select ended_at from page50_times),
    'service_type','生活支持','service_content','他人嘗試修改','service_result','不得修改',
    'execution_reference_id',null,'reason','他人修改草稿'),
  '50000000-9000-4000-8000-000000000010')$sql$,(select record_key from created),
  (select version_id from created),(select content_hash from created)),
  '42501','only the original author can revise the current draft',
  'an assigned co-worker cannot silently rewrite another author draft');

select set_config('request.jwt.claims','{"sub":"50000000-1000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"50000000-8000-4000-8000-000000000001"}',true);
insert into revised select * from public.mutate_case_service_record(
  '50000000-2000-4000-8000-000000000001','50000000-3000-4000-8000-000000000001','save_record',
  jsonb_build_object('mode','revise','record_key',(select record_key from created),
    'previous_version_id',(select version_id from created),'expected_version',1,
    'expected_content_hash',(select content_hash from created),
    'client_id','50000000-5000-4000-8000-000000000001',
    'started_at',(select started_at from page50_times),'ended_at',(select ended_at from page50_times),
    'service_type','生活支持','service_content','補充現場人工生活支持內容。',
    'service_result','人工核對後確認本次服務完成。',
    'execution_reference_id','50000000-7000-4000-8000-000000000001','reason','補充人工服務內容與結果'),
  '50000000-9000-4000-8000-000000000002');
select is((select version from revised),2,'author revision advances the linear draft version');
select is((select previous_version_id from revised),(select version_id from created),
  'revision receipt links the exact prior version');
select throws_ok(format($sql$select * from public.mutate_case_service_record(
  '50000000-2000-4000-8000-000000000001','50000000-3000-4000-8000-000000000001','save_record',
  jsonb_build_object('mode','revise','record_key','%s','previous_version_id','%s','expected_version',1,
    'expected_content_hash','%s','client_id','50000000-5000-4000-8000-000000000001',
    'started_at',(select started_at from page50_times),'ended_at',(select ended_at from page50_times),
    'service_type','生活支持','service_content','舊版內容','service_result','舊版結果',
    'execution_reference_id',null,'reason','舊版重送'),
  '50000000-9000-4000-8000-000000000011')$sql$,(select record_key from created),
  (select version_id from created),(select content_hash from created)),
  '40001','case-service-record version is stale','stale expected version is rejected');
select throws_ok(format($sql$select * from public.mutate_case_service_record(
  '50000000-2000-4000-8000-000000000001','50000000-3000-4000-8000-000000000001','sign_record',
  jsonb_build_object('record_key','%s','previous_version_id','%s','expected_version',2,
    'expected_content_hash','%s','client_id','50000000-5000-4000-8000-000000000001',
    'expected_record_payload',(select record_payload||jsonb_build_object('service_result','遭竄改') from revised)),
  '50000000-9000-4000-8000-000000000003')$sql$,(select record_key from revised),
  (select version_id from revised),(select content_hash from revised)),
  '42501','current same-session recent AAL2 evidence is required',
  'signing requires recent same-session AAL2 before content is accepted');

reset role;
insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,
  issued_jwt_iat,created_at,expires_at,consumed_at,consumed_jwt_iat,factor_method,factor_verified_at) values
 ('50000000-a000-4000-8000-000000000001','50000000-1000-4000-8000-000000000001',
  '50000000-8000-4000-8000-000000000001',repeat('5',64),
  '50000000-a100-4000-8000-000000000001',clock_timestamp()-interval '2 minutes',
  clock_timestamp()-interval '2 minutes',clock_timestamp()+interval '5 minutes',
  clock_timestamp()-interval '30 seconds',clock_timestamp()-interval '30 seconds','totp',
  clock_timestamp()-interval '30 seconds');
insert into private.reauth_events(user_id,session_id,challenge_id,aal,verification_method,verified_at) values
 ('50000000-1000-4000-8000-000000000001','50000000-8000-4000-8000-000000000001',
  '50000000-a000-4000-8000-000000000001','aal2','totp',
  (select factor_verified_at from private.reauth_challenges where id='50000000-a000-4000-8000-000000000001'));

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"50000000-1000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"50000000-8000-4000-8000-000000000001"}',true);
select throws_ok(format($sql$select * from public.mutate_case_service_record(
  '50000000-2000-4000-8000-000000000001','50000000-3000-4000-8000-000000000001','sign_record',
  jsonb_build_object('record_key','%s','previous_version_id','%s','expected_version',2,
    'expected_content_hash','%s','client_id','50000000-5000-4000-8000-000000000001',
    'expected_record_payload',(select record_payload||jsonb_build_object('service_result','遭竄改') from revised)),
  '50000000-9000-4000-8000-000000000003')$sql$,(select record_key from revised),
  (select version_id from revised),(select content_hash from revised)),
  '40001','case-service-record signed content has changed',
  'a sign receipt cannot be produced for a forged full draft payload');
reset role;
alter table public.service_events disable trigger service_events_validate_client_service_plan;
update public.service_events set status='voided'
where id='50000000-7000-4000-8000-000000000001';
alter table public.service_events enable trigger service_events_validate_client_service_plan;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"50000000-1000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"50000000-8000-4000-8000-000000000001"}',true);
select throws_ok(format($sql$select * from public.mutate_case_service_record(
  '50000000-2000-4000-8000-000000000001','50000000-3000-4000-8000-000000000001','sign_record',
  jsonb_build_object('record_key','%s','previous_version_id','%s','expected_version',2,
    'expected_content_hash','%s','client_id','50000000-5000-4000-8000-000000000001',
    'expected_record_payload',(select record_payload from revised)),
  '50000000-9000-4000-8000-000000000004')$sql$,(select record_key from revised),
  (select version_id from revised),(select content_hash from revised)),
  '23514','linked execution evidence is not a completed exact-scope author event',
  'signing revalidates that linked execution evidence remains completed');
reset role;
alter table public.service_events disable trigger service_events_validate_client_service_plan;
update public.service_events set status='completed'
where id='50000000-7000-4000-8000-000000000001';
alter table public.service_events enable trigger service_events_validate_client_service_plan;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"50000000-1000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"50000000-8000-4000-8000-000000000001"}',true);
insert into signed select * from public.mutate_case_service_record(
  '50000000-2000-4000-8000-000000000001','50000000-3000-4000-8000-000000000001','sign_record',
  jsonb_build_object('record_key',(select record_key from revised),'previous_version_id',(select version_id from revised),
    'expected_version',2,'expected_content_hash',(select content_hash from revised),
    'client_id','50000000-5000-4000-8000-000000000001',
    'expected_record_payload',(select record_payload from revised)),
  '50000000-9000-4000-8000-000000000004');
select is((select record_state from signed),'signed','recent AAL2 signs the exact selected draft');
select ok((select record_payload=(select record_payload from revised) and source_content_hash=(select content_hash from revised)
  and previous_version_id=(select version_id from revised) from signed),
  'sign receipt echoes the exact persisted draft payload and source binding');
reset role;
select ok((select signed_by='50000000-1000-4000-8000-000000000001'
  and signature_reauth_challenge_id='50000000-a000-4000-8000-000000000001'
  and signature_purpose='個案服務紀錄簽署' and signer_role_keys is not null
  from public.case_service_record_versions where id=(select version_id from signed)),
  'signed version freezes signer, roles, purpose and reauthentication evidence');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"50000000-1000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"50000000-8000-4000-8000-000000000001"}',true);
select throws_ok(format($sql$select * from public.mutate_case_service_record(
  '50000000-2000-4000-8000-000000000001','50000000-3000-4000-8000-000000000001','correct_record',
  jsonb_build_object('record_key','%s','previous_version_id','%s','expected_version',3,
    'expected_content_hash','%s','expected_author_user_id','50000000-1000-4000-8000-000000000003',
    'client_id','50000000-5000-4000-8000-000000000001',
    'started_at',(select started_at from page50_times),'ended_at',(select ended_at from page50_times),
    'service_type','生活支持','service_content','補充現場人工生活支持內容。',
    'service_result','紙本核對後修正人工服務結果。',
    'execution_reference_id','50000000-7000-4000-8000-000000000001',
    'reason','依紙本原始紀錄修正人工服務結果'),
  '50000000-9000-4000-8000-000000000005')$sql$,(select record_key from signed),
  (select version_id from signed),(select content_hash from signed)),
  '40001','case-service-record correction author has changed',
  'correction binds the immutable original author before writing');
insert into corrected select * from public.mutate_case_service_record(
  '50000000-2000-4000-8000-000000000001','50000000-3000-4000-8000-000000000001','correct_record',
  jsonb_build_object('record_key',(select record_key from signed),'previous_version_id',(select version_id from signed),
    'expected_version',3,'expected_content_hash',(select content_hash from signed),
    'expected_author_user_id','50000000-1000-4000-8000-000000000001',
    'client_id','50000000-5000-4000-8000-000000000001',
    'started_at',(select started_at from page50_times),'ended_at',(select ended_at from page50_times),
    'service_type','生活支持','service_content','補充現場人工生活支持內容。',
    'service_result','紙本核對後修正人工服務結果。',
    'execution_reference_id','50000000-7000-4000-8000-000000000001',
    'reason','依紙本原始紀錄修正人工服務結果'),
  '50000000-9000-4000-8000-000000000005');
select is((select record_state from corrected),'corrected','signed content creates an immutable corrected version');
select ok((select version=4 and previous_version_id=(select version_id from signed)
  and source_content_hash=(select content_hash from signed)
  and record_payload->>'service_result'='紙本核對後修正人工服務結果。' from corrected),
  'correction receipt binds prior version, prior hash and persisted changed content');
reset role;
select ok((select correction_reason='依紙本原始紀錄修正人工服務結果'
  and signature_purpose='個案服務紀錄更正簽署'
  and signature_reauth_challenge_id='50000000-a000-4000-8000-000000000001'
  from public.case_service_record_versions where id=(select version_id from corrected)),
  'corrected version freezes its reason and signature evidence');
select throws_ok(format($sql$update public.case_service_record_versions set service_result='改寫'
  where id='%s'$sql$,(select version_id from created)),
  '55000','case-service-record history is append-only','committed narrative versions cannot be updated');
select throws_ok(format($sql$delete from public.case_service_record_versions where id='%s'$sql$,
  (select version_id from created)),
  '55000','case-service-record history is append-only','committed narrative versions cannot be deleted');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"50000000-1000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"50000000-8000-4000-8000-000000000002"}',true);
insert into worker_created select * from public.mutate_case_service_record(
  '50000000-2000-4000-8000-000000000001','50000000-3000-4000-8000-000000000001','save_record',
  jsonb_build_object('mode','create','record_key',null,'previous_version_id',null,'expected_version',0,
    'expected_content_hash',null,'client_id','50000000-5000-4000-8000-000000000001',
    'started_at',(select started_at from page50_times),'ended_at',(select ended_at from page50_times),
    'service_type','活動陪伴','service_content','照服員人工輸入活動陪伴內容。',
    'service_result','人工記載活動陪伴已完成。','execution_reference_id',null,'reason','建立草稿'),
  '50000000-9000-4000-8000-000000000001');
select ok((select replayed=false and actor_user_id='50000000-1000-4000-8000-000000000002' from worker_created),
  'the same UUID is a distinct idempotency key for a different actor');
select is((select count(*) from public.case_service_record_snapshot(
  '50000000-2000-4000-8000-000000000001','50000000-3000-4000-8000-000000000001',
  null,null,null,null,'50000000-1000-4000-8000-000000000002',null)),1::bigint,
  'author filter has exact semantics within assigned-client scope');

select set_config('request.jwt.claims','{"sub":"50000000-1000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"50000000-8000-4000-8000-000000000001"}',true);
select ok((select service_total=2 and matching_total=2 and draft_total=1 and signed_total=0
  and corrected_total=1 and linked_execution_total=1 and changed_execution_total=0
  from public.case_service_record_snapshot('50000000-2000-4000-8000-000000000001',
    '50000000-3000-4000-8000-000000000001')),
  'untruncated metrics derive from the complete terminal record set');
select ok((select jsonb_array_length(item->'history')=4 and (item->>'history_total')::integer=4
  and item->'history'->0->>'record_state'='draft'
  and item->'history'->1->>'record_state'='draft'
  and item->'history'->2->>'record_state'='signed'
  and item->'history'->3->>'record_state'='corrected'
  from jsonb_array_elements((select records from public.case_service_record_snapshot(
    '50000000-2000-4000-8000-000000000001','50000000-3000-4000-8000-000000000001'))) item
  where item->>'record_key'=(select record_key::text from corrected)),
  'snapshot exposes the complete linear version and signature history');
select is((select matching_total from public.case_service_record_snapshot(
  '50000000-2000-4000-8000-000000000001','50000000-3000-4000-8000-000000000001',
  null,null,null,'生活支持',null,'corrected')),1::bigint,
  'service type and record-state filters combine exactly');
select ok((select schema_kind='manual_service_narrative_v1' and statutory_rule_status='not_configured'
  and attachment_status='not_configured' and export_status='not_configured'
  and notification_status='not_configured' and offline_status='not_configured'
  and claim_eligibility_status='not_configured'
  from public.case_service_record_snapshot('50000000-2000-4000-8000-000000000001',
    '50000000-3000-4000-8000-000000000001')),
  'statutory rules, attachments, export, notification, offline and claim eligibility fail closed');
select throws_ok($$select * from public.case_service_record_snapshot(
  '50000000-2000-4000-8000-000000000002','50000000-3000-4000-8000-000000000003')$$,
  '42501','case-service-record snapshot is not permitted','cross-tenant snapshot is denied');

reset role;
insert into public.case_service_record_versions(
  organization_id,branch_id,client_id,record_key,version,content_hash,record_state,started_at,ended_at,
  service_type,service_content,service_result,execution_reference_status,author_user_id,
  author_display_name,revision_reason,source_kind,schema_kind,statutory_rule_status,
  claim_eligibility_status,created_at)
select '50000000-2000-4000-8000-000000000001','50000000-3000-4000-8000-000000000001',
  '50000000-5000-4000-8000-000000000001',gen_random_uuid(),1,
  encode(sha256(convert_to(gs::text,'UTF8')),'hex'),'draft',clock_timestamp()-interval '2 days'-(gs||' minutes')::interval,
  clock_timestamp()-interval '2 days'-(gs||' minutes')::interval+interval '20 minutes',
  '批次合成人工敘事','合成資料量測試內容','合成資料量測試結果','not_linked',
  '50000000-1000-4000-8000-000000000001','服務紀錄主管','七年資料量截斷測試',
  'manual_local','manual_service_narrative_v1','not_configured','not_configured',clock_timestamp()
from generate_series(1,201) gs;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"50000000-1000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"50000000-8000-4000-8000-000000000001"}',true);
select ok((select records_truncated and jsonb_array_length(records)=200 and matching_total=203
  and service_total=203 and draft_total=202 and corrected_total=1
  from public.case_service_record_snapshot('50000000-2000-4000-8000-000000000001',
    '50000000-3000-4000-8000-000000000001')),
  '200-row display truncation preserves full-set totals');
select ok((select (records->0->>'started_at')::timestamptz >= (records->1->>'started_at')::timestamptz
  from public.case_service_record_snapshot('50000000-2000-4000-8000-000000000001',
    '50000000-3000-4000-8000-000000000001')),
  'records are ordered by service start time rather than entry creation time');

reset role;
alter table public.service_events disable trigger service_events_validate_client_service_plan;
update public.service_events set status='voided' where id='50000000-7000-4000-8000-000000000001';
alter table public.service_events enable trigger service_events_validate_client_service_plan;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"50000000-1000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"50000000-8000-4000-8000-000000000001"}',true);
select is((select changed_execution_total from public.case_service_record_snapshot(
  '50000000-2000-4000-8000-000000000001','50000000-3000-4000-8000-000000000001')),
  1::bigint,'a changed current execution status is surfaced without rewriting frozen evidence');

reset role;
select ok(not exists(select 1 from public.audit_events where table_name like '%case_service_record%'
  and (metadata::text like '%人工生活支持%' or metadata::text like '%紙本核對%' or metadata ? 'filters')),
  'audit metadata contains no narrative or filter values');
select ok(exists(select 1 from public.audit_events where table_name='case_service_record_versions'
  and action='select' and metadata->>'narrative_logged'='false'
  and metadata->>'filters_logged'='false'),
  'snapshot reads leave explicit no-narrative audit evidence');
select is((select count(*) from public.claim_items),0::bigint,
  'drafts, signatures and corrections never escalate claim eligibility');
select is((select count(*) from public.service_events),5::bigint,
  'the full narrative lifecycle never creates an extra service event');

select * from finish();
rollback;
