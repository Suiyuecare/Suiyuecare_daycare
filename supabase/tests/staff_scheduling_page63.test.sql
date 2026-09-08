begin;

select plan(34);

select ok(
  to_regclass('private.staff_scheduling_rule_versions') is not null
  and to_regclass('public.staff_schedule_versions') is not null
  and to_regclass('public.staff_schedule_decisions') is not null
  and to_regclass('private.staff_scheduling_operations') is not null,
  'Page 63 has dedicated immutable rule, schedule, decision and operation stores'
);

select is((select count(*)::integer from pg_class where oid in (
  'private.staff_scheduling_rule_versions'::regclass,
  'public.staff_schedule_versions'::regclass,
  'public.staff_schedule_decisions'::regclass,
  'private.staff_scheduling_operations'::regclass
) and relrowsecurity and relforcerowsecurity),4,
  'all Page-63 stores force RLS');

select ok(
  not has_table_privilege('authenticated','public.staff_schedule_versions','select')
  and not has_table_privilege('authenticated','public.staff_schedule_decisions','insert')
  and not has_table_privilege('service_role','private.staff_scheduling_rule_versions','select')
  and not has_table_privilege('service_role','private.staff_scheduling_operations','update'),
  'direct reads and writes are denied even to application service roles'
);

select ok(
  has_function_privilege('authenticated',
    'public.staff_scheduling_snapshot(uuid,uuid,date,date,uuid,text)','execute')
  and has_function_privilege('authenticated',
    'public.submit_staff_schedule(uuid,uuid,text,uuid,uuid,integer,text,uuid,timestamptz,timestamptz,text,text,text,text,integer,text,uuid)','execute')
  and has_function_privilege('authenticated',
    'public.decide_staff_schedule(uuid,uuid,uuid,uuid,integer,text,integer,text,text,uuid)','execute')
  and not has_function_privilege('anon',
    'public.staff_scheduling_snapshot(uuid,uuid,date,date,uuid,text)','execute')
  and not has_function_privilege('authenticated',
    'private.staff_scheduling_snapshot_bundle(uuid,uuid,timestamptz,date,date,uuid,text)','execute'),
  'authenticated callers only receive pinned public Page-63 entrypoints'
);

select ok((select count(*)=6 and bool_and(
  proconfig=array['search_path=""']::text[]
  and prosecdef=(pg_namespace.nspname='private'))
  from pg_proc join pg_namespace on pg_namespace.oid=pg_proc.pronamespace
  where (pg_namespace.nspname,proname) in (
    ('public','staff_scheduling_snapshot'),
    ('public','submit_staff_schedule'),
    ('public','decide_staff_schedule'),
    ('private','staff_scheduling_snapshot_response'),
    ('private','submit_staff_schedule_guarded'),
    ('private','decide_staff_schedule_guarded')
  )), 'public RPCs are invokers and guarded private cores are pinned definers');

select is((select count(*)::integer from pg_trigger where not tgisinternal
  and tgname in (
    'staff_scheduling_rules_append_only','staff_schedule_versions_append_only',
    'staff_schedule_decisions_append_only','staff_scheduling_operations_append_only'
  )),4,'all Page-63 evidence stores reject update and delete');

select ok((select count(*)=4 and bool_and(risk_level in (2,3))
  from public.permissions where permission_key like 'staff_scheduling.%'),
  'Page 63 defines separate read, manage, approve and override permissions');

select ok(not exists(
  select 1 from public.role_permissions assignment
  join public.roles role on role.id=assignment.role_id
  join public.permissions permission on permission.id=assignment.permission_id
  where permission.permission_key like 'staff_scheduling.%'
    and role.role_key not in ('organization_manager','branch_supervisor')
), 'Page-63 default permissions are limited to manager templates');

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,
  email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('00000000-0000-0000-0000-000000000000','63010000-0000-4000-8000-000000000001','authenticated','authenticated','page63-a@example.invalid','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-8000-000000000000','63010000-0000-4000-8000-000000000002','authenticated','authenticated','page63-b@example.invalid','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-8000-000000000000','63010000-0000-4000-8000-000000000003','authenticated','authenticated','page63-worker@example.invalid','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-8000-000000000000','63010000-0000-4000-8000-000000000004','authenticated','authenticated','page63-other@example.invalid','',now(),'{}','{}',now(),now());
insert into public.organizations(id,code,name) values
('63020000-0000-4000-8000-000000000001','page63_a','合成排班機構 A'),
('63020000-0000-4000-8000-000000000002','page63_b','合成排班機構 B');
insert into public.branches(id,organization_id,code,name) values
('63030000-0000-4000-8000-000000000001','63020000-0000-4000-8000-000000000001','main','合成排班分支 A'),
('63030000-0000-4000-8000-000000000002','63020000-0000-4000-8000-000000000001','second','合成未設定規則分支'),
('63030000-0000-4000-8000-000000000003','63020000-0000-4000-8000-000000000002','main','合成排班分支 B');
insert into public.profiles(id,display_name,kind,employee_code) values
('63010000-0000-4000-8000-000000000001','合成排班主管甲','staff','P63-A'),
('63010000-0000-4000-8000-000000000002','合成排班主管乙','staff','P63-B'),
('63010000-0000-4000-8000-000000000003','合成排班員工','professional','P63-W'),
('63010000-0000-4000-8000-000000000004','合成跨機構員工','staff','P63-X');
insert into public.memberships(id,organization_id,branch_id,profile_id,status,starts_at) values
('63040000-0000-4000-8000-000000000001','63020000-0000-4000-8000-000000000001',null,'63010000-0000-4000-8000-000000000001','active',now()-interval '1 year'),
('63040000-0000-4000-8000-000000000002','63020000-0000-4000-8000-000000000001',null,'63010000-0000-4000-8000-000000000002','active',now()-interval '1 year'),
('63040000-0000-4000-8000-000000000003','63020000-0000-4000-8000-000000000001','63030000-0000-4000-8000-000000000001','63010000-0000-4000-8000-000000000003','active',now()-interval '1 year'),
('63040000-0000-4000-8000-000000000004','63020000-0000-4000-8000-000000000002','63030000-0000-4000-8000-000000000003','63010000-0000-4000-8000-000000000004','active',now()-interval '1 year');
insert into public.membership_roles(membership_id,role_id) values
('63040000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002'),
('63040000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002'),
('63040000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000007'),
('63040000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000003');

insert into private.reauth_challenges(
  id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,
  created_at,expires_at,consumed_at,consumed_jwt_iat,factor_method,factor_verified_at
) values
('63050000-0000-4000-8000-000000000001','63010000-0000-4000-8000-000000000001','63051000-0000-4000-8000-000000000001',repeat('1',64),'63052000-0000-4000-8000-000000000001',now()-interval '2 minutes',now()-interval '2 minutes',now()+interval '5 minutes',now()-interval '30 seconds',now()-interval '30 seconds','totp',now()-interval '30 seconds'),
('63050000-0000-4000-8000-000000000002','63010000-0000-4000-8000-000000000002','63051000-0000-4000-8000-000000000002',repeat('2',64),'63052000-0000-4000-8000-000000000002',now()-interval '2 minutes',now()-interval '2 minutes',now()+interval '5 minutes',now()-interval '30 seconds',now()-interval '30 seconds','totp',now()-interval '30 seconds');
insert into private.reauth_events(user_id,session_id,challenge_id,aal,verification_method,verified_at) values
('63010000-0000-4000-8000-000000000001','63051000-0000-4000-8000-000000000001','63050000-0000-4000-8000-000000000001','aal2','totp',now()-interval '30 seconds'),
('63010000-0000-4000-8000-000000000002','63051000-0000-4000-8000-000000000002','63050000-0000-4000-8000-000000000002','aal2','totp',now()-interval '30 seconds');

insert into private.staff_scheduling_rule_versions(
  id,organization_id,branch_id,rule_set_key,version,previous_version_id,
  effective_from,effective_to,source_status,rule_payload,publication_note,created_by
) values (
  '63060000-0000-4000-8000-000000000001','63020000-0000-4000-8000-000000000001',
  '63030000-0000-4000-8000-000000000001','63061000-0000-4000-8000-000000000001',
  1,null,current_date-1,current_date+365,'manual_unstandardized',
  jsonb_build_object(
    'qualification_rules',jsonb_build_array(jsonb_build_object(
      'role_text','合成照顧職務','required_certificate_type','合成照服資格',
      'taxonomy_status','manual_unstandardized')),
    'work_rules',jsonb_build_object('max_shift_minutes',480,'min_rest_minutes',600,
      'source_status','manual_unstandardized'),
    'facilities',jsonb_build_array(jsonb_build_object(
      'facility_code','ROOM-A','name','合成活動室','capacity',10,
      'taxonomy_status','manual_unstandardized')),
    'vehicles',jsonb_build_array(jsonb_build_object(
      'vehicle_code','CAR-A','name','合成接送車','capacity',5,
      'taxonomy_status','manual_unstandardized')),
    'branch_capacity',20,'source_status','manual_unstandardized'
  ),'合成測試用人工未標準化規則','63010000-0000-4000-8000-000000000001'
);
insert into public.staff_certificate_versions(
  id,organization_id,branch_id,certificate_key,version,previous_version_id,
  record_status,correction_reason,staff_membership_id,staff_user_id,
  staff_display_name,staff_employee_code,certificate_type,certificate_number,
  effective_on,expires_on,registration_status,verification_status,evidence_status,
  attachment_reference,attachment_sha256,recorded_by,recorded_at,content_hash
) values (
  '63070000-0000-4000-8000-000000000001','63020000-0000-4000-8000-000000000001',
  '63030000-0000-4000-8000-000000000001','63071000-0000-4000-8000-000000000001',
  1,null,'active',null,'63040000-0000-4000-8000-000000000003',
  '63010000-0000-4000-8000-000000000003','合成排班員工','P63-W',
  '合成照服資格','SYNTHETIC-ONLY',current_date-30,current_date+365,
  'registered','verified','missing',null,null,
  '63010000-0000-4000-8000-000000000001',now(),repeat('a',64)
);

select throws_ok($$insert into private.staff_scheduling_rule_versions(
  organization_id,branch_id,rule_set_key,version,effective_from,effective_to,
  source_status,rule_payload,publication_note,created_by
) select organization_id,branch_id,'63061000-0000-4000-8000-000000000002',1,
  current_date,current_date+10,source_status,rule_payload,'重疊規則',created_by
  from private.staff_scheduling_rule_versions where id='63060000-0000-4000-8000-000000000001'$$,
  '23P01','staff scheduling rule periods cannot overlap',
  'rule versions cannot overlap in one branch');

select throws_ok($$insert into private.staff_scheduling_rule_versions(
  organization_id,branch_id,rule_set_key,version,effective_from,effective_to,
  source_status,rule_payload,publication_note,created_by
) values (
  '63020000-0000-4000-8000-000000000001','63030000-0000-4000-8000-000000000002',
  '63061000-0000-4000-8000-000000000003',1,current_date,current_date+10,
  'manual_unstandardized','{}','無效規則','63010000-0000-4000-8000-000000000001')$$,
  '23514',null,'partial or invented rule payloads fail closed');

set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object(
  'sub','63010000-0000-4000-8000-000000000001','aal','aal2',
  'session_id','63051000-0000-4000-8000-000000000001')::text,true);

select is((select payload->>'rule_configuration_status'
  from public.staff_scheduling_snapshot(
    '63020000-0000-4000-8000-000000000001','63030000-0000-4000-8000-000000000002',
    current_date,current_date+6,null,'all')),'not_configured',
  'unconfigured branch remains explicit and readable without fabricated defaults');

select throws_ok($$select * from public.submit_staff_schedule(
  '63020000-0000-4000-8000-000000000001','63030000-0000-4000-8000-000000000002',
  'create','63080000-0000-4000-8000-000000000099',null,0,null,
  '63040000-0000-4000-8000-000000000003',now()+interval '1 day',now()+interval '1 day 3 hours',
  '合成照顧職務','缺規則不可寫入','ROOM-A','CAR-A',3,'測試未設定','63090000-0000-4000-8000-000000000099')$$,
  '42501','scheduled staff is outside current branch or employment period',
  'a target membership from another branch is rejected before rule evaluation');

select throws_ok($$select * from public.submit_staff_schedule(
  '63020000-0000-4000-8000-000000000001','63030000-0000-4000-8000-000000000001',
  'create','63080000-0000-4000-8000-000000000098',null,0,null,
  '63040000-0000-4000-8000-000000000004',now()+interval '1 day',now()+interval '1 day 3 hours',
  '合成照顧職務','跨機構不可寫入','ROOM-A','CAR-A',3,'測試跨機構','63090000-0000-4000-8000-000000000098')$$,
  '42501','scheduled staff is outside current branch or employment period',
  'cross-organization target membership is rejected');

create temporary table first_draft as
select * from public.submit_staff_schedule(
  '63020000-0000-4000-8000-000000000001','63030000-0000-4000-8000-000000000001',
  'create','63080000-0000-4000-8000-000000000001',null,0,null,
  '63040000-0000-4000-8000-000000000003',
  date_trunc('day',now()+interval '1 day')+interval '9 hours',
  date_trunc('day',now()+interval '1 day')+interval '12 hours',
  '合成照顧職務','合成上午照顧服務','ROOM-A','CAR-A',3,
  '建立合成班表','63090000-0000-4000-8000-000000000001');

select ok((select not draft.replayed and draft.schedule_version=1
  and draft.schedule_status='draft_ready' and draft.conflict_count=0
  from first_draft draft),'a fully configured deterministic check creates a ready draft');

reset role;
select ok((select qualification_evidence @> jsonb_build_array(jsonb_build_object(
  'source_page',72,'record_version_id','63070000-0000-4000-8000-000000000001'))
  from public.staff_schedule_versions where id=(select schedule_version_id from first_draft)),
  'qualification evidence is frozen from the exact Page-72 terminal version');
set local role authenticated;

select ok((select result.replayed and result.schedule_version_id=(select schedule_version_id from first_draft)
  from public.submit_staff_schedule(
    '63020000-0000-4000-8000-000000000001','63030000-0000-4000-8000-000000000001',
    'create','63080000-0000-4000-8000-000000000001',null,0,null,
    '63040000-0000-4000-8000-000000000003',
    date_trunc('day',now()+interval '1 day')+interval '9 hours',
    date_trunc('day',now()+interval '1 day')+interval '12 hours',
    '合成照顧職務','合成上午照顧服務','ROOM-A','CAR-A',3,
    '建立合成班表','63090000-0000-4000-8000-000000000001') result),
  'an exact create replay returns the original immutable result');

select throws_ok($$select * from public.submit_staff_schedule(
  '63020000-0000-4000-8000-000000000001','63030000-0000-4000-8000-000000000001',
  'create','63080000-0000-4000-8000-000000000001',null,0,null,
  '63040000-0000-4000-8000-000000000003',
  date_trunc('day',now()+interval '1 day')+interval '9 hours',
  date_trunc('day',now()+interval '1 day')+interval '12 hours',
  '合成照顧職務','不同內容','ROOM-A','CAR-A',3,
  '建立合成班表','63090000-0000-4000-8000-000000000001')$$,
  '23505','staff scheduling idempotency key conflict',
  'same actor key with different content is rejected');

select throws_ok($$select * from first_draft draft cross join lateral
  public.decide_staff_schedule(
    '63020000-0000-4000-8000-000000000001','63030000-0000-4000-8000-000000000001',
    draft.schedule_version_id,draft.schedule_key,draft.schedule_version,draft.content_hash,
    draft.conflict_count,'publish','建立者不可自批','63090000-0000-4000-8000-000000000002')$$,
  '42501','staff scheduling creator cannot review the same draft',
  'draft creator cannot independently approve their own schedule');

reset role;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object(
  'sub','63010000-0000-4000-8000-000000000002','aal','aal2',
  'session_id','63051000-0000-4000-8000-000000000002')::text,true);

create temporary table first_publish as
select result.* from first_draft draft cross join lateral public.decide_staff_schedule(
  '63020000-0000-4000-8000-000000000001','63030000-0000-4000-8000-000000000001',
  draft.schedule_version_id,draft.schedule_key,draft.schedule_version,draft.content_hash,
  draft.conflict_count,'publish','獨立核對人工規則與原始證據',
  '63090000-0000-4000-8000-000000000003') result;

select ok((select not published.replayed and published.result_status='published'
  and published.review_mode='standard' and published.result_version=2
  from first_publish published),
  'independent recent-AAL2 reviewer publishes a conflict-free draft');

select ok((select result.replayed and result.result_version_id=(select result_version_id from first_publish)
  from first_draft draft cross join lateral public.decide_staff_schedule(
    '63020000-0000-4000-8000-000000000001','63030000-0000-4000-8000-000000000001',
    draft.schedule_version_id,draft.schedule_key,draft.schedule_version,draft.content_hash,
    draft.conflict_count,'publish','獨立核對人工規則與原始證據',
    '63090000-0000-4000-8000-000000000003') result),
  'an exact decision replay returns the original published version');

select throws_ok($$select * from first_publish published cross join lateral
  public.submit_staff_schedule(
    '63020000-0000-4000-8000-000000000001','63030000-0000-4000-8000-000000000001',
    'revise',published.schedule_key,published.result_version_id,published.result_version,
    published.content_hash,'63040000-0000-4000-8000-000000000003',
    date_trunc('day',now()+interval '1 day')+interval '9 hours',
    date_trunc('day',now()+interval '1 day')+interval '12 hours',
    '合成照顧職務','不可讓待審更正隱藏既有發布班表','ROOM-A','CAR-A',3,
    '發布後須另建明確替代流程','63090000-0000-4000-8000-000000000007')$$,
  '40001','staff scheduling chain is stale',
  'a published chain cannot become a pending revision that silently hides active work');

reset role;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object(
  'sub','63010000-0000-4000-8000-000000000001','aal','aal2',
  'session_id','63051000-0000-4000-8000-000000000001')::text,true);

create temporary table conflicted_draft as
select * from public.submit_staff_schedule(
  '63020000-0000-4000-8000-000000000001','63030000-0000-4000-8000-000000000001',
  'create','63080000-0000-4000-8000-000000000002',null,0,null,
  '63040000-0000-4000-8000-000000000003',
  date_trunc('day',now()+interval '1 day')+interval '10 hours',
  date_trunc('day',now()+interval '1 day')+interval '11 hours',
  '合成照顧職務','合成重疊服務','ROOM-A','CAR-A',3,
  '建立衝突示例','63090000-0000-4000-8000-000000000004');

select ok((select schedule_status='draft_conflicted' and conflict_count>=2
  from conflicted_draft),'overlap and resource conflicts remain explicit on the draft');

reset role;
select ok((select conflicts @> '[{"code":"staff_time_overlap"}]'::jsonb
  and conflicts @> '[{"code":"vehicle_capacity_exceeded"}]'::jsonb
  from public.staff_schedule_versions where id=(select schedule_version_id from conflicted_draft)),
  'conflict evidence explains staff overlap and vehicle capacity independently');

set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object(
  'sub','63010000-0000-4000-8000-000000000002','aal','aal2',
  'session_id','63051000-0000-4000-8000-000000000002')::text,true);

select throws_ok($$select * from conflicted_draft draft cross join lateral
  public.decide_staff_schedule(
    '63020000-0000-4000-8000-000000000001','63030000-0000-4000-8000-000000000001',
    draft.schedule_version_id,draft.schedule_key,draft.schedule_version,draft.content_hash,
    draft.conflict_count,'publish','不得靜默發布衝突','63090000-0000-4000-8000-000000000005')$$,
  '22023','staff scheduling decision does not match conflicts',
  'a conflicted draft cannot use the ordinary publish path');

create temporary table override_publish as
select result.* from conflicted_draft draft cross join lateral public.decide_staff_schedule(
  '63020000-0000-4000-8000-000000000001','63030000-0000-4000-8000-000000000001',
  draft.schedule_version_id,draft.schedule_key,draft.schedule_version,draft.content_hash,
  draft.conflict_count,'override','合成演示：已人工核對原衝突並限此班次覆核',
  '63090000-0000-4000-8000-000000000006') result;

select ok((select result_status='published' and review_mode='override'
  and conflict_count=(select conflict_count from conflicted_draft)
  from override_publish),'independent override preserves every original conflict');

reset role;
select ok((select decision='override' and reason like '合成演示%'
  and decided_by='63010000-0000-4000-8000-000000000002'
  from public.staff_schedule_decisions where id=(select decision_id from override_publish)),
  'override saves reviewer, reason and immutable original conflict count');

select throws_ok($$update public.staff_schedule_versions set role_text='不可覆寫'
  where id=(select result_version_id from first_publish)$$,
  '55000','staff scheduling evidence is append-only',
  'published schedule evidence cannot be overwritten');

select throws_ok($$delete from public.staff_schedule_decisions
  where id=(select decision_id from override_publish)$$,
  '55000','staff scheduling evidence is append-only',
  'override evidence cannot be deleted');

set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object(
  'sub','63010000-0000-4000-8000-000000000002','aal','aal2',
  'session_id','63051000-0000-4000-8000-000000000002')::text,true);

select ok((select
  (payload->>'record_total')::integer=2
  and (payload->>'published_total')::integer=2
  and (payload->>'overridden_total')::integer=1
  and jsonb_array_length(payload->'records')=2
  and payload->>'decision_engine'='deterministic_rule_assisted'
  and payload->>'ai_status'='not_used'
  and payload->>'automatic_publish_status'='disabled'
  from public.staff_scheduling_snapshot(
    '63020000-0000-4000-8000-000000000001','63030000-0000-4000-8000-000000000001',
    current_date,current_date+6,null,'all')),
  'snapshot metrics reconcile and never claim AI or automatic publication');

select ok((select payload->>'qualification_projection'='page72_terminal'
  and payload->>'rule_configuration_status'='configured_manual_unstandardized'
  and payload->'rule_version'->>'source_status'='manual_unstandardized'
  and payload->>'export_status'='disabled' and payload->>'offline_status'='disabled'
  from public.staff_scheduling_snapshot(
    '63020000-0000-4000-8000-000000000001','63030000-0000-4000-8000-000000000001',
    current_date,current_date+6,null,'all')),
  'snapshot exposes exact governance and disabled boundaries');

reset role;
select ok((select metadata ? 'staff_filter_present'
  and not metadata ? 'staff_membership_id' and not metadata ? 'service_need_text'
  from public.audit_events where table_name='staff_scheduling_snapshot'
  order by id desc limit 1),'read audit is minimized and excludes staff or service content');

set local role authenticated;

select throws_ok($$select * from public.staff_scheduling_snapshot(
  '63020000-0000-4000-8000-000000000001','63030000-0000-4000-8000-000000000003',
  current_date,current_date+6,null,'all')$$,'42501','staff scheduling snapshot is not permitted',
  'cross-organization branch snapshot is denied');

reset role;
select ok(position('pg_advisory_xact_lock' in pg_get_functiondef(
  'private.decide_staff_schedule_guarded(uuid,uuid,uuid,uuid,integer,text,integer,text,text,uuid)'::regprocedure))>0,
  'publication serializes staff, facility, vehicle, branch and chain decisions');

select ok(not exists(
  select 1 from pg_proc function join pg_namespace namespace on namespace.oid=function.pronamespace
  where namespace.nspname='public' and function.prosecdef
    and function.proname in ('staff_scheduling_snapshot','submit_staff_schedule','decide_staff_schedule')
), 'no public Page-63 RPC is security definer');

select * from finish();
rollback;
