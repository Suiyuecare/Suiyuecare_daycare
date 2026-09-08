begin;

select plan(50);

select ok(
  to_regclass('private.client_service_plan_operations') is not null,
  'Page 52 has a dedicated immutable operation ledger'
);

select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class
    where oid = 'private.client_service_plan_operations'::regclass),
  'the operation ledger enables and forces RLS'
);

select ok(
  not has_table_privilege('authenticated','public.client_service_plans','insert')
  and not has_table_privilege('service_role','public.client_service_plans','insert')
  and not has_table_privilege('authenticated','private.client_service_plan_operations','select')
  and not has_table_privilege('service_role','private.client_service_plan_operations','select'),
  'direct service-plan and operation-ledger DML is denied'
);

select ok(
  has_function_privilege('authenticated',
    'public.mutate_client_service_plan_workflow(uuid,uuid,text,uuid,uuid,uuid,integer,text,uuid,text,date,date,date,uuid,jsonb,jsonb,text,uuid)','execute')
  and has_function_privilege('authenticated',
    'public.client_service_plan_workflow_snapshot(uuid,uuid,uuid,text,date,text)','execute')
  and not has_function_privilege('anon',
    'public.mutate_client_service_plan_workflow(uuid,uuid,text,uuid,uuid,uuid,integer,text,uuid,text,date,date,date,uuid,jsonb,jsonb,text,uuid)','execute')
  and not has_function_privilege('service_role',
    'public.client_service_plan_workflow_snapshot(uuid,uuid,uuid,text,date,text)','execute'),
  'only authenticated callers receive the public Page-52 RPC entrypoints'
);

select ok(
  not (select prosecdef from pg_proc where oid =
    'public.mutate_client_service_plan_workflow(uuid,uuid,text,uuid,uuid,uuid,integer,text,uuid,text,date,date,date,uuid,jsonb,jsonb,text,uuid)'::regprocedure)
  and not (select prosecdef from pg_proc where oid =
    'public.client_service_plan_workflow_snapshot(uuid,uuid,uuid,text,date,text)'::regprocedure)
  and (select prosecdef from pg_proc where oid =
    'private.mutate_client_service_plan_workflow_guarded(uuid,uuid,text,uuid,uuid,uuid,integer,text,uuid,text,date,date,date,uuid,jsonb,jsonb,text,uuid)'::regprocedure),
  'public wrappers are invokers and the private guarded core is a definer'
);

select is(
  (select count(*)::integer from pg_trigger where not tgisinternal
    and tgrelid = 'private.client_service_plan_operations'::regclass
    and tgname in ('client_service_plan_operations_append_only',
      'client_service_plan_operations_audit_row_change')),
  2,
  'the operation ledger has append-only and standard audit triggers'
);

select ok(
  exists (select 1 from pg_constraint where conname =
    'client_service_plan_operations_result_scope_fkey'
    and conrelid = 'private.client_service_plan_operations'::regclass)
  and exists (select 1 from pg_indexes where schemaname = 'private'
    and indexname = 'client_service_plan_operations_result_plan_idx')
  and exists (select 1 from pg_indexes where schemaname = 'private'
    and indexname = 'client_service_plan_operations_authorized_idx'),
  'operation evidence is scope-bound and foreign-key lookups are indexed'
);

select ok(
  position('p_signature' in pg_get_function_identity_arguments(
    'public.mutate_client_service_plan_workflow(uuid,uuid,text,uuid,uuid,uuid,integer,text,uuid,text,date,date,date,uuid,jsonb,jsonb,text,uuid)'::regprocedure)) = 0
  and position('approval_evidence' in pg_get_function_identity_arguments(
    'public.mutate_client_service_plan_workflow(uuid,uuid,text,uuid,uuid,uuid,integer,text,uuid,text,date,date,date,uuid,jsonb,jsonb,text,uuid)'::regprocedure)) = 0,
  'the public mutation never accepts browser-supplied signature evidence'
);

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('00000000-0000-0000-0000-000000000000','52010000-0000-4000-8000-000000000001','authenticated','authenticated','page52-manager@example.invalid','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','52010000-0000-4000-8000-000000000002','authenticated','authenticated','page52-unassigned@example.invalid','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','52010000-0000-4000-8000-000000000003','authenticated','authenticated','page52-outsider@example.invalid','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','52010000-0000-4000-8000-000000000004','authenticated','authenticated','page52-inactive@example.invalid','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','52010000-0000-4000-8000-000000000005','authenticated','authenticated','page52-manager2@example.invalid','',now(),'{}','{}',now(),now());

insert into public.organizations(id,code,name) values
('52020000-0000-4000-8000-000000000001','page52_a','合成服務計畫機構 A'),
('52020000-0000-4000-8000-000000000002','page52_b','合成服務計畫機構 B');
insert into public.branches(id,organization_id,code,name) values
('52030000-0000-4000-8000-000000000001','52020000-0000-4000-8000-000000000001','main','合成服務計畫分支 A'),
('52030000-0000-4000-8000-000000000002','52020000-0000-4000-8000-000000000001','other','合成服務計畫分支 A2'),
('52030000-0000-4000-8000-000000000003','52020000-0000-4000-8000-000000000002','main','合成服務計畫分支 B');
insert into public.profiles(id,display_name,kind) values
('52010000-0000-4000-8000-000000000001','合成服務計畫主管','staff'),
('52010000-0000-4000-8000-000000000002','合成未指派個管','staff'),
('52010000-0000-4000-8000-000000000003','合成外部主管','staff'),
('52010000-0000-4000-8000-000000000004','合成停用負責人','staff'),
('52010000-0000-4000-8000-000000000005','合成第二主管','staff');
insert into public.memberships(id,organization_id,branch_id,profile_id,status,starts_at) values
('52040000-0000-4000-8000-000000000001','52020000-0000-4000-8000-000000000001',null,'52010000-0000-4000-8000-000000000001','active',now()-interval '1 year'),
('52040000-0000-4000-8000-000000000002','52020000-0000-4000-8000-000000000001','52030000-0000-4000-8000-000000000001','52010000-0000-4000-8000-000000000002','active',now()-interval '1 year'),
('52040000-0000-4000-8000-000000000003','52020000-0000-4000-8000-000000000002',null,'52010000-0000-4000-8000-000000000003','active',now()-interval '1 year'),
('52040000-0000-4000-8000-000000000005','52020000-0000-4000-8000-000000000001',null,'52010000-0000-4000-8000-000000000005','active',now()-interval '1 year');
insert into public.membership_roles(membership_id,role_id) values
('52040000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002'),
('52040000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000004'),
('52040000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002'),
('52040000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000002');
insert into public.clients(id,organization_id,branch_id,client_code,display_name,status,admitted_on) values
('52050000-0000-4000-8000-000000000001','52020000-0000-4000-8000-000000000001','52030000-0000-4000-8000-000000000001','SYN-P52-A','合成服務計畫個案甲','active','2026-01-01'),
('52050000-0000-4000-8000-000000000002','52020000-0000-4000-8000-000000000002','52030000-0000-4000-8000-000000000003','SYN-P52-B','合成服務計畫個案乙','active','2026-01-01'),
('52050000-0000-4000-8000-000000000003','52020000-0000-4000-8000-000000000001','52030000-0000-4000-8000-000000000001','SYN-P52-C','合成分期核定個案','active','2026-01-01');

insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,
  issued_jwt_iat,created_at,expires_at,consumed_at,consumed_jwt_iat,factor_method,factor_verified_at) values
('52060000-0000-4000-8000-000000000001','52010000-0000-4000-8000-000000000001','52061000-0000-4000-8000-000000000001',repeat('1',64),'52062000-0000-4000-8000-000000000001',now()-interval '2 minutes',now()-interval '2 minutes',now()+interval '5 minutes',now()-interval '30 seconds',now()-interval '30 seconds','totp',now()-interval '30 seconds'),
('52060000-0000-4000-8000-000000000002','52010000-0000-4000-8000-000000000001','52061000-0000-4000-8000-000000000001',repeat('2',64),'52062000-0000-4000-8000-000000000002',now()-interval '6 minutes',now()-interval '6 minutes',now()-interval '4 minutes',now()-interval '5 minutes',now()-interval '5 minutes','totp',now()-interval '5 minutes');
insert into private.reauth_events(user_id,session_id,challenge_id,aal,verification_method,verified_at) values
('52010000-0000-4000-8000-000000000001','52061000-0000-4000-8000-000000000001','52060000-0000-4000-8000-000000000001','aal2','totp',now()-interval '30 seconds');

insert into public.authorized_care_plans(id,organization_id,branch_id,client_id,plan_key,
  version,status,effective_from,effective_to,source_system,source_record_id,
  source_provenance,authorized_on,authorization_reference,service_limits,plan_data,
  idempotency_key,created_by,approved_by,approved_at,approval_evidence_hash,
  approval_reauth_challenge_id,signed_by,signed_at,signature_purpose,
  signature_reauth_challenge_id,content_hash) values
('52070000-0000-4000-8000-000000000001','52020000-0000-4000-8000-000000000001',
 '52030000-0000-4000-8000-000000000001','52050000-0000-4000-8000-000000000001',
 '52071000-0000-4000-8000-000000000001',1,'signed','2026-09-01','2027-12-31',
 'central_html_import','SYN-P52-AUTH-1','{"source":"synthetic"}','2026-08-31',
 'SYN-P52-AUTH','{"synthetic_limit":true}','{"synthetic_plan":true}',
 '52072000-0000-4000-8000-000000000001','52010000-0000-4000-8000-000000000001',
 '52010000-0000-4000-8000-000000000001',now(),repeat('a',64),
 '52060000-0000-4000-8000-000000000001','52010000-0000-4000-8000-000000000001',
 now(),'合成核定計畫簽署','52060000-0000-4000-8000-000000000001',repeat('c',64));

insert into public.authorized_care_plans(id,organization_id,branch_id,client_id,plan_key,
  version,status,effective_from,effective_to,source_system,source_record_id,
  source_provenance,authorized_on,authorization_reference,service_limits,plan_data,
  idempotency_key,created_by,approved_by,approved_at,approval_evidence_hash,
  approval_reauth_challenge_id,signed_by,signed_at,signature_purpose,
  signature_reauth_challenge_id,content_hash) values
('52b70000-0000-4000-8000-000000000001','52020000-0000-4000-8000-000000000001',
 '52030000-0000-4000-8000-000000000001','52050000-0000-4000-8000-000000000003',
 '52b71000-0000-4000-8000-000000000001',1,'signed','2026-01-01','2026-12-31',
 'central_html_import','SYN-P52-PERIOD-1','{"source":"synthetic"}','2025-12-31',
 'SYN-P52-PERIOD','{"period":1}','{"synthetic_plan":1}',
 '52b72000-0000-4000-8000-000000000001','52010000-0000-4000-8000-000000000001',
 '52010000-0000-4000-8000-000000000001',now(),repeat('3',64),
 '52060000-0000-4000-8000-000000000001','52010000-0000-4000-8000-000000000001',
 now(),'合成分期核定簽署','52060000-0000-4000-8000-000000000001',repeat('4',64));
insert into public.authorized_care_plans(id,organization_id,branch_id,client_id,plan_key,
  version,previous_version_id,status,effective_from,effective_to,source_system,source_record_id,
  source_provenance,authorized_on,authorization_reference,service_limits,plan_data,
  correction_reason,idempotency_key,created_by,approved_by,approved_at,approval_evidence_hash,
  approval_reauth_challenge_id,signed_by,signed_at,signature_purpose,
  signature_reauth_challenge_id,content_hash)
select '52b70000-0000-4000-8000-000000000002',organization_id,branch_id,client_id,plan_key,
  2,id,'signed','2026-10-01','2026-12-31',source_system,'SYN-P52-PERIOD-2',
  source_provenance,authorized_on,authorization_reference,'{"period":2}',
  '{"synthetic_plan":2}','第四季核定版本生效','52b72000-0000-4000-8000-000000000002',
  created_by,approved_by,now(),repeat('5',64),approval_reauth_challenge_id,
  signed_by,now(),'合成第四季核定簽署',signature_reauth_challenge_id,repeat('6',64)
from public.authorized_care_plans where id='52b70000-0000-4000-8000-000000000001';

create temporary table page52_receipts(label text primary key,payload jsonb not null);
grant select,insert,update on page52_receipts to authenticated;

set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object(
  'sub','52010000-0000-4000-8000-000000000001','role','authenticated','aal','aal1',
  'session_id','52061000-0000-4000-8000-000000000001')::text,true);

select throws_ok($$select * from public.client_service_plan_workflow_snapshot(
  '52020000-0000-4000-8000-000000000001','52030000-0000-4000-8000-000000000001',
  null,null,'2026-09-08',null)$$,'42501',null,
  'AAL1 staff cannot read the Page-52 snapshot');

select throws_ok($$select * from public.mutate_client_service_plan_workflow(
  '52020000-0000-4000-8000-000000000001','52030000-0000-4000-8000-000000000001',
  'create_draft','52050000-0000-4000-8000-000000000001','52080000-0000-4000-8000-000000000001',
  null,0,null,'52070000-0000-4000-8000-000000000001',repeat('c',64),
  '2026-09-01','2026-12-31','2026-10-31','52010000-0000-4000-8000-000000000001',
  jsonb_build_array(jsonb_build_object('goal_id','520a0000-0000-4000-8000-000000000001','item_order',1,'goal','合成服務參與目標','target_outcome','合成人工檢討成果')),
  jsonb_build_array(jsonb_build_object('measure_id','520b0000-0000-4000-8000-000000000001','item_order',1,'goal_id','520a0000-0000-4000-8000-000000000001','measure','合成結構化活動支持','frequency','合成服務日執行','responsible_user_id','52010000-0000-4000-8000-000000000001')),
  '建立合成服務計畫初稿','52090000-0000-4000-8000-000000000001')$$,
  '42501',null,'AAL1 staff cannot create a plan');

select set_config('request.jwt.claims',jsonb_build_object(
  'sub','52010000-0000-4000-8000-000000000002','role','authenticated','aal','aal2',
  'session_id','52061000-0000-4000-8000-000000000002')::text,true);
select throws_ok($$select * from public.mutate_client_service_plan_workflow(
  '52020000-0000-4000-8000-000000000001','52030000-0000-4000-8000-000000000001',
  'create_draft','52050000-0000-4000-8000-000000000001','52080000-0000-4000-8000-000000000002',
  null,0,null,'52070000-0000-4000-8000-000000000001',repeat('c',64),
  '2026-09-01','2026-12-31','2026-10-31','52010000-0000-4000-8000-000000000002',
  jsonb_build_array(jsonb_build_object('goal_id','520a0000-0000-4000-8000-000000000002','item_order',1,'goal','合成未指派目標','target_outcome','合成未指派成果')),
  jsonb_build_array(jsonb_build_object('measure_id','520b0000-0000-4000-8000-000000000002','item_order',1,'goal_id','520a0000-0000-4000-8000-000000000002','measure','合成未指派措施','frequency','合成未指派頻率','responsible_user_id','52010000-0000-4000-8000-000000000002')),
  '未指派個管不得建立計畫','52090000-0000-4000-8000-000000000002')$$,
  '42501',null,'an unassigned case manager cannot create for the client');

select set_config('request.jwt.claims',jsonb_build_object(
  'sub','52010000-0000-4000-8000-000000000003','role','authenticated','aal','aal2',
  'session_id','52061000-0000-4000-8000-000000000003')::text,true);
select throws_ok($$select * from public.client_service_plan_workflow_snapshot(
  '52020000-0000-4000-8000-000000000001','52030000-0000-4000-8000-000000000001',
  null,null,'2026-09-08',null)$$,'42501',null,
  'a cross-tenant manager cannot read another tenant snapshot');

select set_config('request.jwt.claims',jsonb_build_object(
  'sub','52010000-0000-4000-8000-000000000001','role','authenticated','aal','aal2',
  'session_id','52061000-0000-4000-8000-000000000001',
  'iat',extract(epoch from now())::bigint,'jti','page52-manager-current')::text,true);

select is((select option->>'authorized_care_plan_id'
  from public.client_service_plan_workflow_snapshot(
    '52020000-0000-4000-8000-000000000001','52030000-0000-4000-8000-000000000001',
    null,null,'2026-09-08',null) snapshot,
    lateral jsonb_array_elements(snapshot.authorizations) option
  where option->>'client_id'='52050000-0000-4000-8000-000000000003'),
  '52b70000-0000-4000-8000-000000000001',
  'September authorization options retain the date-applicable version one');
select is((select option->>'authorized_care_plan_id'
  from public.client_service_plan_workflow_snapshot(
    '52020000-0000-4000-8000-000000000001','52030000-0000-4000-8000-000000000001',
    null,null,'2026-11-08',null) snapshot,
    lateral jsonb_array_elements(snapshot.authorizations) option
  where option->>'client_id'='52050000-0000-4000-8000-000000000003'),
  '52b70000-0000-4000-8000-000000000002',
  'November authorization options advance to the date-applicable version two');

select throws_ok($$insert into public.client_service_plans(organization_id,branch_id,
  client_id,authorized_care_plan_id,effective_from,effective_to,source_system,idempotency_key,created_by)
  values('52020000-0000-4000-8000-000000000001','52030000-0000-4000-8000-000000000001',
  '52050000-0000-4000-8000-000000000001','52070000-0000-4000-8000-000000000001',
  '2026-09-01','2026-12-31','local','52090000-0000-4000-8000-000000000099',
  '52010000-0000-4000-8000-000000000001')$$,'42501',null,
  'authenticated direct INSERT is denied even to a manager');

insert into page52_receipts(label,payload)
select 'draft',to_jsonb(result) from public.mutate_client_service_plan_workflow(
  '52020000-0000-4000-8000-000000000001','52030000-0000-4000-8000-000000000001',
  'create_draft','52050000-0000-4000-8000-000000000001','52080000-0000-4000-8000-000000000001',
  null,0,null,'52070000-0000-4000-8000-000000000001',repeat('c',64),
  '2026-09-01','2026-12-31','2026-10-31','52010000-0000-4000-8000-000000000001',
  jsonb_build_array(jsonb_build_object('goal_id','520a0000-0000-4000-8000-000000000001','item_order',1,'goal','合成服務參與目標','target_outcome','合成人工檢討成果')),
  jsonb_build_array(jsonb_build_object('measure_id','520b0000-0000-4000-8000-000000000001','item_order',1,'goal_id','520a0000-0000-4000-8000-000000000001','measure','合成結構化活動支持','frequency','合成服務日執行','responsible_user_id','52010000-0000-4000-8000-000000000001')),
  '建立合成服務計畫初稿','52090000-0000-4000-8000-000000000001') result;

select is((select payload->>'status' from page52_receipts where label='draft'),'draft',
  'create_draft appends a draft terminal');
select is((select payload#>>'{persisted_payload,source_provenance,workflow}'
  from page52_receipts where label='draft'),'page52_client_service_plan_v1',
  'the persisted draft carries the explicit Page-52 workflow marker');
select is((select payload#>>'{persisted_payload,source_provenance,claim_eligibility_status}'
  from page52_receipts where label='draft'),'blocked_not_configured',
  'the persisted draft is explicitly blocked from claims');
select is((select payload#>>'{persisted_payload,planned_services,0,responsible_display_name}'
  from page52_receipts where label='draft'),'合成服務計畫主管',
  'responsible-person identity is resolved and frozen by the server');
select ok((select payload->>'payload_hash' ~ '^[a-f0-9]{64}$'
  and (payload->>'replayed')::boolean = false from page52_receipts where label='draft'),
  'the first receipt carries a server hash and is not a replay');

select is((select result.replayed from public.mutate_client_service_plan_workflow(
  '52020000-0000-4000-8000-000000000001','52030000-0000-4000-8000-000000000001',
  'create_draft','52050000-0000-4000-8000-000000000001','52080000-0000-4000-8000-000000000001',
  null,0,null,'52070000-0000-4000-8000-000000000001',repeat('c',64),
  '2026-09-01','2026-12-31','2026-10-31','52010000-0000-4000-8000-000000000001',
  jsonb_build_array(jsonb_build_object('goal_id','520a0000-0000-4000-8000-000000000001','item_order',1,'goal','合成服務參與目標','target_outcome','合成人工檢討成果')),
  jsonb_build_array(jsonb_build_object('measure_id','520b0000-0000-4000-8000-000000000001','item_order',1,'goal_id','520a0000-0000-4000-8000-000000000001','measure','合成結構化活動支持','frequency','合成服務日執行','responsible_user_id','52010000-0000-4000-8000-000000000001')),
  '建立合成服務計畫初稿','52090000-0000-4000-8000-000000000001') result),true,
  'the same actor receives an exact replay for the same key and content');

select throws_ok($$select * from public.mutate_client_service_plan_workflow(
  '52020000-0000-4000-8000-000000000001','52030000-0000-4000-8000-000000000001',
  'create_draft','52050000-0000-4000-8000-000000000001','52080000-0000-4000-8000-000000000001',
  null,0,null,'52070000-0000-4000-8000-000000000001',repeat('c',64),
  '2026-09-01','2026-12-31','2026-10-31','52010000-0000-4000-8000-000000000001',
  jsonb_build_array(jsonb_build_object('goal_id','520a0000-0000-4000-8000-000000000001','item_order',1,'goal','不同內容不得重送','target_outcome','合成人工檢討成果')),
  jsonb_build_array(jsonb_build_object('measure_id','520b0000-0000-4000-8000-000000000001','item_order',1,'goal_id','520a0000-0000-4000-8000-000000000001','measure','合成結構化活動支持','frequency','合成服務日執行','responsible_user_id','52010000-0000-4000-8000-000000000001')),
  '建立合成服務計畫初稿','52090000-0000-4000-8000-000000000001')$$,
  '23505',null,'the same actor and key with different content conflicts');

select set_config('request.jwt.claims',jsonb_build_object(
  'sub','52010000-0000-4000-8000-000000000005','role','authenticated','aal','aal2',
  'session_id','52061000-0000-4000-8000-000000000005')::text,true);
select throws_ok($$select * from public.mutate_client_service_plan_workflow(
  '52020000-0000-4000-8000-000000000001','52030000-0000-4000-8000-000000000001',
  'create_draft','52050000-0000-4000-8000-000000000001','52080000-0000-4000-8000-000000000001',
  null,0,null,'52070000-0000-4000-8000-000000000001',repeat('c',64),
  '2026-09-01','2026-12-31','2026-10-31','52010000-0000-4000-8000-000000000001',
  jsonb_build_array(jsonb_build_object('goal_id','520a0000-0000-4000-8000-000000000001','item_order',1,'goal','合成服務參與目標','target_outcome','合成人工檢討成果')),
  jsonb_build_array(jsonb_build_object('measure_id','520b0000-0000-4000-8000-000000000001','item_order',1,'goal_id','520a0000-0000-4000-8000-000000000001','measure','合成結構化活動支持','frequency','合成服務日執行','responsible_user_id','52010000-0000-4000-8000-000000000001')),
  '建立合成服務計畫初稿','52090000-0000-4000-8000-000000000001')$$,
  '23505',null,'another actor cannot replay the first actors operation receipt');

select set_config('request.jwt.claims',jsonb_build_object(
  'sub','52010000-0000-4000-8000-000000000001','role','authenticated','aal','aal2',
  'session_id','52061000-0000-4000-8000-000000000001',
  'iat',extract(epoch from now())::bigint,'jti','page52-manager-current')::text,true);
select throws_ok(format($sql$select * from public.mutate_client_service_plan_workflow(
  '52020000-0000-4000-8000-000000000001','52030000-0000-4000-8000-000000000001',
  'revise_draft','52050000-0000-4000-8000-000000000001','52080000-0000-4000-8000-000000000001',
  %L,1,%L,'52070000-0000-4000-8000-000000000001',repeat('c',64),
  '2026-09-01','2026-12-31','2026-10-31','52010000-0000-4000-8000-000000000001',
  jsonb_build_array(jsonb_build_object('goal_id','520a0000-0000-4000-8000-000000000001','item_order',1,'goal','合成服務參與目標','target_outcome','合成人工檢討成果')),
  jsonb_build_array(jsonb_build_object('measure_id','520b0000-0000-4000-8000-000000000001','item_order',1,'goal_id','520a0000-0000-4000-8000-000000000001','measure','合成結構化活動支持','frequency','合成服務日執行','responsible_user_id','52010000-0000-4000-8000-000000000001')),
  '修訂版本基準錯誤測試','52090000-0000-4000-8000-000000000003')$sql$,
  (select payload->>'plan_id' from page52_receipts where label='draft'),repeat('0',64)),
  '40001',null,'a stale terminal payload hash is rejected');

select throws_ok(format($sql$select * from public.mutate_client_service_plan_workflow(
  '52020000-0000-4000-8000-000000000001','52030000-0000-4000-8000-000000000001',
  'sign','52050000-0000-4000-8000-000000000001','52080000-0000-4000-8000-000000000001',
  %L,1,%L,'52070000-0000-4000-8000-000000000001',repeat('c',64),
  null,null,null,null,null,null,'草稿不得直接簽署測試','52090000-0000-4000-8000-000000000004')$sql$,
  (select payload->>'plan_id' from page52_receipts where label='draft'),
  (select payload->>'payload_hash' from page52_receipts where label='draft')),
  '23514',null,'a draft cannot skip approval and be signed');

select set_config('request.jwt.claims',jsonb_build_object(
  'sub','52010000-0000-4000-8000-000000000001','role','authenticated','aal','aal2',
  'session_id','52061000-0000-4000-8000-000000000099')::text,true);
select throws_ok(format($sql$select * from public.mutate_client_service_plan_workflow(
  '52020000-0000-4000-8000-000000000001','52030000-0000-4000-8000-000000000001',
  'approve','52050000-0000-4000-8000-000000000001','52080000-0000-4000-8000-000000000001',
  %L,1,%L,'52070000-0000-4000-8000-000000000001',repeat('c',64),
  null,null,null,null,null,null,'主管核准合成服務計畫','52090000-0000-4000-8000-000000000005')$sql$,
  (select payload->>'plan_id' from page52_receipts where label='draft'),
  (select payload->>'payload_hash' from page52_receipts where label='draft')),
  '42501',null,'approval requires recent AAL2 in the same session');

select set_config('request.jwt.claims',jsonb_build_object(
  'sub','52010000-0000-4000-8000-000000000001','role','authenticated','aal','aal2',
  'session_id','52061000-0000-4000-8000-000000000001',
  'iat',extract(epoch from now())::bigint,'jti','page52-manager-current')::text,true);
insert into page52_receipts(label,payload)
select 'approved',to_jsonb(result) from public.mutate_client_service_plan_workflow(
  '52020000-0000-4000-8000-000000000001','52030000-0000-4000-8000-000000000001',
  'approve','52050000-0000-4000-8000-000000000001','52080000-0000-4000-8000-000000000001',
  (select (payload->>'plan_id')::uuid from page52_receipts where label='draft'),1,
  (select payload->>'payload_hash' from page52_receipts where label='draft'),
  '52070000-0000-4000-8000-000000000001',repeat('c',64),null,null,null,null,null,null,
  '主管核准合成服務計畫','52090000-0000-4000-8000-000000000005') result;

select is((select payload->>'status' from page52_receipts where label='approved'),'approved',
  'approve appends an approved version');
select ok((select payload#>>'{persisted_payload,reason}'='主管核准合成服務計畫'
  and payload->>'previous_payload_hash'=(select payload->>'payload_hash' from page52_receipts where label='draft')
  from page52_receipts where label='approved'),
  'approval freezes the exact prior payload hash and reason');

insert into page52_receipts(label,payload)
select 'signed',to_jsonb(result) from public.mutate_client_service_plan_workflow(
  '52020000-0000-4000-8000-000000000001','52030000-0000-4000-8000-000000000001',
  'sign','52050000-0000-4000-8000-000000000001','52080000-0000-4000-8000-000000000001',
  (select (payload->>'plan_id')::uuid from page52_receipts where label='approved'),2,
  (select payload->>'payload_hash' from page52_receipts where label='approved'),
  '52070000-0000-4000-8000-000000000001',repeat('c',64),null,null,null,null,null,null,
  '簽署核准合成服務計畫','52090000-0000-4000-8000-000000000006') result;

select is((select payload->>'status' from page52_receipts where label='signed'),'signed',
  'sign appends a signed version');
select ok((select payload#>>'{persisted_payload,status}'='signed'
  and payload#>>'{persisted_payload,goals,0,goal}'='合成服務參與目標'
  from page52_receipts where label='signed'),
  'signing preserves approved structured content exactly');

insert into page52_receipts(label,payload)
select 'revision',to_jsonb(result) from public.mutate_client_service_plan_workflow(
  '52020000-0000-4000-8000-000000000001','52030000-0000-4000-8000-000000000001',
  'revise_draft','52050000-0000-4000-8000-000000000001','52080000-0000-4000-8000-000000000001',
  (select (payload->>'plan_id')::uuid from page52_receipts where label='signed'),3,
  (select payload->>'payload_hash' from page52_receipts where label='signed'),
  '52070000-0000-4000-8000-000000000001',repeat('c',64),
  '2026-09-01','2026-12-31','2026-11-30','52010000-0000-4000-8000-000000000001',
  jsonb_build_array(jsonb_build_object('goal_id','520a0000-0000-4000-8000-000000000001','item_order',1,'goal','修訂後合成服務參與目標','target_outcome','修訂後合成人工檢討成果')),
  jsonb_build_array(jsonb_build_object('measure_id','520b0000-0000-4000-8000-000000000001','item_order',1,'goal_id','520a0000-0000-4000-8000-000000000001','measure','修訂後合成活動支持','frequency','修訂後合成服務頻率','responsible_user_id','52010000-0000-4000-8000-000000000001')),
  '依檢討結果建立修訂草稿','52090000-0000-4000-8000-000000000007') result;

select is((select payload->>'status' from page52_receipts where label='revision'),'draft',
  'revision appends a new draft without changing the signed version');

select is((select (plans->0->>'version')::integer from public.client_service_plan_workflow_snapshot(
  '52020000-0000-4000-8000-000000000001','52030000-0000-4000-8000-000000000001',
  null,null,'2026-09-08','52080000-0000-4000-8000-000000000001')),4,
  'snapshot returns the workflow head for editing');
select is((select (plans->0->>'published_version')::integer from public.client_service_plan_workflow_snapshot(
  '52020000-0000-4000-8000-000000000001','52030000-0000-4000-8000-000000000001',
  null,null,'2026-09-08','52080000-0000-4000-8000-000000000001')),3,
  'snapshot separately returns the date-applicable published head');
select is((select plans->0->>'stream_operational_status' from public.client_service_plan_workflow_snapshot(
  '52020000-0000-4000-8000-000000000001','52030000-0000-4000-8000-000000000001',
  null,null,'2026-09-08','52080000-0000-4000-8000-000000000001')),'signed_current',
  'a newer draft does not hide or invalidate the current signed published version');
select is((select (plans->0->>'history_total')::integer from public.client_service_plan_workflow_snapshot(
  '52020000-0000-4000-8000-000000000001','52030000-0000-4000-8000-000000000001',
  null,'draft','2026-09-08','52080000-0000-4000-8000-000000000001')),4,
  'snapshot filters and history refer to the same stable stream');
select is((select executable_total from public.client_service_plan_workflow_snapshot(
  '52020000-0000-4000-8000-000000000001','52030000-0000-4000-8000-000000000001',
  null,null,'2026-09-08','52080000-0000-4000-8000-000000000001')),1::bigint,
  'full-set executable totals use the published stream rather than the draft head');

reset role;
insert into public.client_service_plans(id,organization_id,branch_id,client_id,
  authorized_care_plan_id,plan_key,version,status,effective_from,effective_to,
  source_system,source_provenance,authorized_limits_snapshot,goals,planned_services,
  responsible_user_id,review_due_on,idempotency_key,created_by) values
('520c0000-0000-4000-8000-000000000001','52020000-0000-4000-8000-000000000001',
 '52030000-0000-4000-8000-000000000001','52050000-0000-4000-8000-000000000001',
 '52070000-0000-4000-8000-000000000001','520c1000-0000-4000-8000-000000000001',
 1,'draft','2026-09-01','2026-12-31','legacy_import','{"source":"synthetic_legacy"}',
 '{"synthetic_limit":true}','[{"legacy_goal":"原始舊格式目標"}]',
 '[{"legacy_measure":"原始舊格式措施"}]','52010000-0000-4000-8000-000000000001',
 '2026-10-31','520c2000-0000-4000-8000-000000000001','52010000-0000-4000-8000-000000000001');

set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object(
  'sub','52010000-0000-4000-8000-000000000001','role','authenticated','aal','aal2',
  'session_id','52061000-0000-4000-8000-000000000001',
  'iat',extract(epoch from now())::bigint,'jti','page52-manager-current')::text,true);
select is((select plans->0->>'content_mapping_status' from public.client_service_plan_workflow_snapshot(
  '52020000-0000-4000-8000-000000000001','52030000-0000-4000-8000-000000000001',
  null,'needs_mapping','2026-09-08',null)),'needs_mapping',
  'legacy noncanonical content is visible as needs_mapping');
select is((select plans->0#>>'{unmapped_content,goals,0,legacy_goal}' from public.client_service_plan_workflow_snapshot(
  '52020000-0000-4000-8000-000000000001','52030000-0000-4000-8000-000000000001',
  null,'needs_mapping','2026-09-08',null)),'原始舊格式目標',
  'legacy content is retained verbatim for explicit manual mapping');

reset role;
insert into public.service_events(id,organization_id,branch_id,client_id,
  client_service_plan_id,service_code,status,started_at,ended_at,staff_user_id,
  evidence,idempotency_key,signed_at,signed_by,content_hash) values
('520d0000-0000-4000-8000-000000000001','52020000-0000-4000-8000-000000000001',
 '52030000-0000-4000-8000-000000000001','52050000-0000-4000-8000-000000000001',
 (select (payload->>'plan_id')::uuid from page52_receipts where label='signed'),
 'SYN-P52-NOT-OFFICIAL','completed','2026-09-08 09:00:00+08','2026-09-08 10:00:00+08',
 '52010000-0000-4000-8000-000000000001','{"synthetic":true}',
 '520d1000-0000-4000-8000-000000000001',now(),
 '52010000-0000-4000-8000-000000000001',repeat('7',64));
insert into public.claim_batches(id,organization_id,branch_id,claim_period_start,
  claim_period_end,format_version,status,created_by) values
('520e0000-0000-4000-8000-000000000001','52020000-0000-4000-8000-000000000001',
 '52030000-0000-4000-8000-000000000001','2026-09-01','2026-09-30',
 'page52-synthetic-unconfigured','draft','52010000-0000-4000-8000-000000000001');
insert into public.claim_items(id,organization_id,branch_id,claim_batch_id,client_id,
  service_event_id,service_code,service_date,units,amount,evidence_hash) values
('520f0000-0000-4000-8000-000000000001','52020000-0000-4000-8000-000000000001',
 '52030000-0000-4000-8000-000000000001','520e0000-0000-4000-8000-000000000001',
 '52050000-0000-4000-8000-000000000001','520d0000-0000-4000-8000-000000000001',
 'SYN-P52-NOT-OFFICIAL','2026-09-08',1,100,repeat('7',64));

set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object(
  'sub','52010000-0000-4000-8000-000000000001','role','authenticated','aal','aal2',
  'session_id','52061000-0000-4000-8000-000000000001',
  'iat',extract(epoch from now())::bigint,'jti','page52-manager-current')::text,true);
select throws_ok($$select * from public.validate_claim_batch(
  '52020000-0000-4000-8000-000000000001','52030000-0000-4000-8000-000000000001',
  '520e0000-0000-4000-8000-000000000001',100,
  '520e1000-0000-4000-8000-000000000001')$$,'23514',null,
  'a signed Page-52 workflow plan is rejected by actual claim validation');

-- Build an approved Page-52 terminal with approval evidence from five minutes
-- earlier, then sign it through the guarded RPC using the actor's current
-- same-session reauthentication. This proves approval is historical evidence,
-- not a timestamp that must be regenerated during signing.
reset role;
select set_config('request.jwt.claims','{}',true);
insert into public.client_service_plans(id,organization_id,branch_id,client_id,
  authorized_care_plan_id,plan_key,version,status,effective_from,effective_to,
  source_system,source_provenance,authorized_limits_snapshot,goals,planned_services,
  responsible_user_id,review_due_on,idempotency_key,created_by) values
('52a10000-0000-4000-8000-000000000001','52020000-0000-4000-8000-000000000001',
 '52030000-0000-4000-8000-000000000001','52050000-0000-4000-8000-000000000001',
 '52070000-0000-4000-8000-000000000001','52a00000-0000-4000-8000-000000000001',
 1,'draft','2027-01-01','2027-03-31','local',
 '{"schema_version":1,"source_system":"local","capture_method":"staff_entry","authority":"facility","workflow":"page52_client_service_plan_v1","legal_rule_status":"not_configured","claim_eligibility_status":"blocked_not_configured"}',
 '{"synthetic_limit":true}',
 '[{"goal_id":"52aa0000-0000-4000-8000-000000000001","item_order":1,"goal":"延遲簽署合成目標","target_outcome":"延遲簽署合成成果"}]',
 '[{"measure_id":"52ab0000-0000-4000-8000-000000000001","item_order":1,"goal_id":"52aa0000-0000-4000-8000-000000000001","measure":"延遲簽署合成措施","frequency":"合成服務日執行","responsible_user_id":"52010000-0000-4000-8000-000000000001","responsible_display_name":"合成服務計畫主管","qualification_status":"active_membership_only"}]',
 '52010000-0000-4000-8000-000000000001','2027-02-28',
 '52a20000-0000-4000-8000-000000000001','52010000-0000-4000-8000-000000000001');
insert into public.client_service_plans(id,organization_id,branch_id,client_id,
  authorized_care_plan_id,plan_key,version,previous_version_id,status,
  effective_from,effective_to,source_system,source_provenance,authorized_limits_snapshot,
  goals,planned_services,responsible_user_id,review_due_on,correction_reason,
  idempotency_key,created_by,approved_by,approved_at,approval_evidence_hash,
  approval_reauth_challenge_id)
select '52a10000-0000-4000-8000-000000000002',organization_id,branch_id,client_id,
  authorized_care_plan_id,plan_key,2,id,'approved',effective_from,effective_to,
  source_system,source_provenance,authorized_limits_snapshot,goals,planned_services,
  responsible_user_id,review_due_on,'五分鐘前完成主管核准',
  '52a20000-0000-4000-8000-000000000002','52010000-0000-4000-8000-000000000001',
  '52010000-0000-4000-8000-000000000001',now()-interval '5 minutes',repeat('e',64),
  '52060000-0000-4000-8000-000000000002'
from public.client_service_plans where id='52a10000-0000-4000-8000-000000000001';
insert into page52_receipts(label,payload)
select 'delayed_approved',jsonb_build_object(
  'plan_id',plan.id,'version',plan.version,
  'payload_hash',private.client_service_plan_payload_hash(
    plan,repeat('c',64),plan.correction_reason))
from public.client_service_plans plan where plan.id='52a10000-0000-4000-8000-000000000002';

set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object(
  'sub','52010000-0000-4000-8000-000000000001','role','authenticated','aal','aal2',
  'session_id','52061000-0000-4000-8000-000000000001',
  'iat',extract(epoch from now())::bigint,'jti','page52-manager-current')::text,true);
insert into page52_receipts(label,payload)
select 'delayed_signed',to_jsonb(result) from public.mutate_client_service_plan_workflow(
  '52020000-0000-4000-8000-000000000001','52030000-0000-4000-8000-000000000001',
  'sign','52050000-0000-4000-8000-000000000001','52a00000-0000-4000-8000-000000000001',
  '52a10000-0000-4000-8000-000000000002',2,
  (select payload->>'payload_hash' from page52_receipts where label='delayed_approved'),
  '52070000-0000-4000-8000-000000000001',repeat('c',64),null,null,null,null,null,null,
  '核准後延遲五分鐘完成簽署','52a20000-0000-4000-8000-000000000003') result;
select is((select payload->>'status' from page52_receipts where label='delayed_signed'),'signed',
  'the same actor can sign more than one minute after approval with current AAL2');
select ok((select approved.approved_at = signed.approved_at
    and signed.signed_at > signed.approved_at + interval '1 minute'
  from public.client_service_plans approved
  join public.client_service_plans signed on signed.previous_version_id=approved.id
  where approved.id='52a10000-0000-4000-8000-000000000002'),
  'delayed signing freezes the historical approval timestamp and evidence');

reset role;
insert into public.authorized_care_plans(id,organization_id,branch_id,client_id,plan_key,
  version,previous_version_id,status,effective_from,effective_to,source_system,source_record_id,
  source_provenance,authorized_on,authorization_reference,service_limits,plan_data,
  correction_reason,idempotency_key,created_by,approved_by,approved_at,approval_evidence_hash,
  approval_reauth_challenge_id,signed_by,signed_at,signature_purpose,
  signature_reauth_challenge_id,content_hash)
select '52070000-0000-4000-8000-000000000002',organization_id,branch_id,client_id,plan_key,
  2,id,'signed',effective_from,effective_to,source_system,'SYN-P52-AUTH-2',source_provenance,
  authorized_on,authorization_reference,service_limits,'{"synthetic_plan":"replacement"}',
  '合成核定來源已更新','52072000-0000-4000-8000-000000000002',
  '52010000-0000-4000-8000-000000000001','52010000-0000-4000-8000-000000000001',
  now(),repeat('b',64),'52060000-0000-4000-8000-000000000001',
  '52010000-0000-4000-8000-000000000001',now(),'合成更新核定計畫簽署',
  '52060000-0000-4000-8000-000000000001',repeat('d',64)
from public.authorized_care_plans where id='52070000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object(
  'sub','52010000-0000-4000-8000-000000000001','role','authenticated','aal','aal2',
  'session_id','52061000-0000-4000-8000-000000000001',
  'iat',extract(epoch from now())::bigint,'jti','page52-manager-current')::text,true);
insert into page52_receipts(label,payload)
select 'voided',to_jsonb(result) from public.mutate_client_service_plan_workflow(
  '52020000-0000-4000-8000-000000000001','52030000-0000-4000-8000-000000000001',
  'void','52050000-0000-4000-8000-000000000001','52080000-0000-4000-8000-000000000001',
  (select (payload->>'plan_id')::uuid from page52_receipts where label='revision'),4,
  (select payload->>'payload_hash' from page52_receipts where label='revision'),
  '52070000-0000-4000-8000-000000000001',repeat('c',64),null,null,null,null,null,null,
  '核定來源變更後安全作廢舊計畫','52090000-0000-4000-8000-000000000008') result;

select is((select payload->>'status' from page52_receipts where label='voided'),'voided',
  'an outdated authorization still permits safe void of the terminal stream');
select ok((select payload#>>'{persisted_payload,authorized_care_plan_id}'=
  '52070000-0000-4000-8000-000000000001'
  and payload#>>'{persisted_payload,goals,0,goal}'='修訂後合成服務參與目標'
  from page52_receipts where label='voided'),
  'void freezes the historical source and content without rebinding authorization');
select throws_ok(format($sql$select * from public.mutate_client_service_plan_workflow(
  '52020000-0000-4000-8000-000000000001','52030000-0000-4000-8000-000000000001',
  'revise_draft','52050000-0000-4000-8000-000000000001','52080000-0000-4000-8000-000000000001',
  %L,5,%L,'52070000-0000-4000-8000-000000000002',repeat('d',64),
  '2026-09-01','2026-12-31','2026-11-30','52010000-0000-4000-8000-000000000001',
  jsonb_build_array(jsonb_build_object('goal_id','520a0000-0000-4000-8000-000000000001','item_order',1,'goal','作廢後不得再修訂目標','target_outcome','作廢後不得再修訂成果')),
  jsonb_build_array(jsonb_build_object('measure_id','520b0000-0000-4000-8000-000000000001','item_order',1,'goal_id','520a0000-0000-4000-8000-000000000001','measure','作廢後不得再修訂措施','frequency','作廢後不得再修訂頻率','responsible_user_id','52010000-0000-4000-8000-000000000001')),
  '作廢後不得再修訂版本','52090000-0000-4000-8000-000000000009')$sql$,
  (select payload->>'plan_id' from page52_receipts where label='voided'),
  (select payload->>'payload_hash' from page52_receipts where label='voided')),
  '40001',null,'no operation can append after a voided terminal');
select is((select plans->0->>'stream_operational_status' from public.client_service_plan_workflow_snapshot(
  '52020000-0000-4000-8000-000000000001','52030000-0000-4000-8000-000000000001',
  null,null,'2026-09-08','52080000-0000-4000-8000-000000000001')),'not_executable',
  'a date-applicable voided published head makes the stream non-executable');

reset role;
select is((select count(*)::integer from private.client_service_plan_operations
  where result_plan_key='52080000-0000-4000-8000-000000000001'),5,
  'one immutable operation exists for each appended workflow version');
select throws_ok($$update private.client_service_plan_operations set result_reason='不可改寫證據內容'
  where result_plan_key='52080000-0000-4000-8000-000000000001'$$,
  '55000',null,'operation evidence is append-only even for the table owner');
select ok(exists(select 1 from public.audit_events where table_name='client_service_plans'
  and metadata->>'workflow'='page52_client_service_plan_v1'
  and metadata->>'narrative_logged'='false'),
  'mutations write redacted Page-52 audit evidence');
select ok(exists(select 1 from public.audit_events where table_name='client_service_plans'
  and row_pk='workflow_snapshot' and metadata @> '{"filters_logged":false,"query_logged":false,"results_logged":false}'),
  'snapshot reads are audited without filters, query terms, or result content');

update public.memberships set status='suspended'
where id='52040000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object(
  'sub','52010000-0000-4000-8000-000000000001','role','authenticated','aal','aal2',
  'session_id','52061000-0000-4000-8000-000000000001')::text,true);
select throws_ok($$select * from public.mutate_client_service_plan_workflow(
  '52020000-0000-4000-8000-000000000001','52030000-0000-4000-8000-000000000001',
  'create_draft','52050000-0000-4000-8000-000000000001','52080000-0000-4000-8000-000000000001',
  null,0,null,'52070000-0000-4000-8000-000000000001',repeat('c',64),
  '2026-09-01','2026-12-31','2026-10-31','52010000-0000-4000-8000-000000000001',
  jsonb_build_array(jsonb_build_object('goal_id','520a0000-0000-4000-8000-000000000001','item_order',1,'goal','合成服務參與目標','target_outcome','合成人工檢討成果')),
  jsonb_build_array(jsonb_build_object('measure_id','520b0000-0000-4000-8000-000000000001','item_order',1,'goal_id','520a0000-0000-4000-8000-000000000001','measure','合成結構化活動支持','frequency','合成服務日執行','responsible_user_id','52010000-0000-4000-8000-000000000001')),
  '建立合成服務計畫初稿','52090000-0000-4000-8000-000000000001')$$,
  '42501',null,'exact replay fails closed after actor authority is revoked');

select * from finish();
rollback;
