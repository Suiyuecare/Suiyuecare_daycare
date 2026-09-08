begin;

select plan(39);

-- 1
select ok(
  to_regclass('public.staff_employment_versions') is not null
  and to_regclass('public.staff_management_proposals') is not null
  and to_regclass('private.staff_role_request_versions') is not null
  and to_regclass('private.staff_session_revocation_jobs') is not null,
  'Page 59 has dedicated immutable workflow and revocation evidence stores'
);

-- 2
select is((select count(*)::integer from pg_class where oid in (
  'public.staff_employment_versions'::regclass,
  'public.staff_management_proposals'::regclass,
  'private.staff_role_request_versions'::regclass,
  'private.staff_session_revocation_jobs'::regclass
) and relrowsecurity and relforcerowsecurity),4,
  'all Page-59 stores force RLS');

-- 3
select ok(
  not has_table_privilege('authenticated','public.staff_employment_versions','select')
  and not has_table_privilege('authenticated','public.staff_management_proposals','insert')
  and not has_table_privilege('authenticated','private.staff_session_revocation_jobs','select')
  and not has_table_privilege('service_role','private.staff_role_request_versions','select')
  and not has_table_privilege('authenticated','public.memberships','update')
  and not has_table_privilege('authenticated','public.membership_roles','insert'),
  'direct evidence, membership, and role-assignment writes are denied');

-- 4
select ok(
  has_function_privilege('authenticated',
    'public.staff_management_snapshot(uuid,uuid,text,uuid,text,text)','execute')
  and has_function_privilege('authenticated',
    'public.submit_staff_management_proposal(uuid,uuid,text,uuid,uuid,uuid,bigint,text,date,date,text,text,text,date,text,uuid)','execute')
  and not has_function_privilege('anon',
    'public.staff_management_snapshot(uuid,uuid,text,uuid,text,text)','execute')
  and not has_function_privilege('authenticated',
    'private.staff_management_snapshot_bundle(uuid,uuid,timestamptz,text,uuid,text,text)','execute'),
  'authenticated callers only receive pinned public RPC entrypoints');

-- 5
select ok((select count(*)=8 and bool_and(
  proconfig=array['search_path=""']::text[]
  and prosecdef=(pg_namespace.nspname='private'))
  from pg_proc join pg_namespace on pg_namespace.oid=pg_proc.pronamespace
  where (pg_namespace.nspname,proname) in (
    ('public','staff_management_snapshot'),
    ('public','submit_staff_management_proposal'),
    ('public','decide_staff_management_proposal'),
    ('public','request_staff_role_change'),
    ('private','staff_management_snapshot_response'),
    ('private','submit_staff_management_proposal_guarded'),
    ('private','decide_staff_management_proposal_guarded'),
    ('private','request_staff_role_change_guarded')
  )), 'public RPCs are invokers and private guarded cores are pinned definers');

-- 6
select is((select count(*)::integer from pg_trigger where not tgisinternal
  and tgname in (
    'staff_employment_versions_append_only',
    'staff_management_proposals_protect',
    'staff_role_request_versions_append_only',
    'staff_session_revocation_jobs_append_only'
  )),4,'Page-59 evidence cannot be overwritten or deleted');

-- 7
select ok((select count(*)=10 and bool_and(risk_level in (2,3))
  from public.permissions where permission_key like 'staff_management.%'),
  'Page 59 defines base, field-level, workflow, and approval permissions');

-- 8
select ok(not exists(
  select 1 from public.role_permissions rp
  join public.roles r on r.id=rp.role_id
  join public.permissions p on p.id=rp.permission_id
  where p.permission_key like 'staff_management.%'
    and r.role_key not in ('organization_manager','branch_supervisor')
), 'Page-59 defaults are limited to managers and branch supervisors');

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('00000000-0000-0000-0000-000000000000','59010000-0000-4000-8000-000000000001','authenticated','authenticated','page59-a@example.invalid','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','59010000-0000-4000-8000-000000000002','authenticated','authenticated','page59-b@example.invalid','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','59010000-0000-4000-8000-000000000003','authenticated','authenticated','page59-limited@example.invalid','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','59010000-0000-4000-8000-000000000004','authenticated','authenticated','page59-worker-a@example.invalid','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','59010000-0000-4000-8000-000000000005','authenticated','authenticated','page59-worker-b@example.invalid','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','59010000-0000-4000-8000-000000000006','authenticated','authenticated','page59-new@example.invalid','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','59010000-0000-4000-8000-000000000007','authenticated','authenticated','page59-other@example.invalid','',now(),'{}','{}',now(),now());
insert into public.organizations(id,code,name) values
('59020000-0000-4000-8000-000000000001','page59_a','合成機構 A'),
('59020000-0000-4000-8000-000000000002','page59_b','合成機構 B');
insert into public.branches(id,organization_id,code,name) values
('59030000-0000-4000-8000-000000000001','59020000-0000-4000-8000-000000000001','main','合成分支 A'),
('59030000-0000-4000-8000-000000000002','59020000-0000-4000-8000-000000000002','main','合成分支 B');
insert into public.profiles(id,display_name,kind,employee_code) values
('59010000-0000-4000-8000-000000000001','合成主管甲','staff','P59-1'),
('59010000-0000-4000-8000-000000000002','合成主管乙','staff','P59-2'),
('59010000-0000-4000-8000-000000000003','合成聘僱專員','staff','P59-3'),
('59010000-0000-4000-8000-000000000004','合成員工甲','staff','P59-4'),
('59010000-0000-4000-8000-000000000005','合成員工乙','professional','P59-5'),
('59010000-0000-4000-8000-000000000006','合成待到職人員','driver','P59-6'),
('59010000-0000-4000-8000-000000000007','合成跨機構人員','staff','P59-7');
insert into public.memberships(id,organization_id,branch_id,profile_id,status,starts_at) values
('59040000-0000-4000-8000-000000000001','59020000-0000-4000-8000-000000000001',null,'59010000-0000-4000-8000-000000000001','active',now()-interval '1 year'),
('59040000-0000-4000-8000-000000000002','59020000-0000-4000-8000-000000000001',null,'59010000-0000-4000-8000-000000000002','active',now()-interval '1 year'),
('59040000-0000-4000-8000-000000000003','59020000-0000-4000-8000-000000000001','59030000-0000-4000-8000-000000000001','59010000-0000-4000-8000-000000000003','active',now()-interval '1 year'),
('59040000-0000-4000-8000-000000000004','59020000-0000-4000-8000-000000000001','59030000-0000-4000-8000-000000000001','59010000-0000-4000-8000-000000000004','active',now()-interval '1 year'),
('59040000-0000-4000-8000-000000000005','59020000-0000-4000-8000-000000000001','59030000-0000-4000-8000-000000000001','59010000-0000-4000-8000-000000000005','active',now()-interval '1 year'),
('59040000-0000-4000-8000-000000000007','59020000-0000-4000-8000-000000000002','59030000-0000-4000-8000-000000000002','59010000-0000-4000-8000-000000000007','active',now()-interval '1 year');

insert into public.roles(id,organization_id,role_key,name,is_system) values
('59090000-0000-4000-8000-000000000001','59020000-0000-4000-8000-000000000001','employment_manager','合成聘僱專員',false);
insert into public.role_permissions(role_id,permission_id)
select '59090000-0000-4000-8000-000000000001',id from public.permissions
where permission_key in (
  'staff_management.read','staff_management.manage',
  'staff_management.identity.read','staff_management.employment.read',
  'staff_management.employment.manage'
);
insert into public.membership_roles(membership_id,role_id) values
('59040000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002'),
('59040000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002'),
('59040000-0000-4000-8000-000000000003','59090000-0000-4000-8000-000000000001'),
('59040000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000006'),
('59040000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000007'),
('59040000-0000-4000-8000-000000000007','10000000-0000-4000-8000-000000000003');

insert into private.reauth_challenges(
  id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,
  created_at,expires_at,consumed_at,consumed_jwt_iat,factor_method,factor_verified_at
) values
('59050000-0000-4000-8000-000000000001','59010000-0000-4000-8000-000000000001','59051000-0000-4000-8000-000000000001',repeat('a',64),'59052000-0000-4000-8000-000000000001',now()-interval '2 minutes',now()-interval '2 minutes',now()+interval '5 minutes',now()-interval '30 seconds',now()-interval '30 seconds','totp',now()-interval '30 seconds'),
('59050000-0000-4000-8000-000000000002','59010000-0000-4000-8000-000000000002','59051000-0000-4000-8000-000000000002',repeat('b',64),'59052000-0000-4000-8000-000000000002',now()-interval '2 minutes',now()-interval '2 minutes',now()+interval '5 minutes',now()-interval '30 seconds',now()-interval '30 seconds','totp',now()-interval '30 seconds'),
('59050000-0000-4000-8000-000000000003','59010000-0000-4000-8000-000000000003','59051000-0000-4000-8000-000000000003',repeat('c',64),'59052000-0000-4000-8000-000000000003',now()-interval '2 minutes',now()-interval '2 minutes',now()+interval '5 minutes',now()-interval '30 seconds',now()-interval '30 seconds','totp',now()-interval '30 seconds');
insert into private.reauth_events(user_id,session_id,challenge_id,aal,verification_method,verified_at) values
('59010000-0000-4000-8000-000000000001','59051000-0000-4000-8000-000000000001','59050000-0000-4000-8000-000000000001','aal2','totp',now()-interval '30 seconds'),
('59010000-0000-4000-8000-000000000002','59051000-0000-4000-8000-000000000002','59050000-0000-4000-8000-000000000002','aal2','totp',now()-interval '30 seconds'),
('59010000-0000-4000-8000-000000000003','59051000-0000-4000-8000-000000000003','59050000-0000-4000-8000-000000000003','aal2','totp',now()-interval '30 seconds');

select set_config('test.page59_today',((clock_timestamp() at time zone 'Asia/Taipei')::date)::text,true);

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"59010000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1","session_id":"59051000-0000-4000-8000-000000000001"}',true);

-- 9
select throws_ok($$select * from public.staff_management_snapshot(
  '59020000-0000-4000-8000-000000000001','59030000-0000-4000-8000-000000000001')$$,
  '42501','staff management snapshot is not permitted','AAL1 cannot read Page 59');

-- 10
select throws_ok($$select * from public.submit_staff_management_proposal(
  '59020000-0000-4000-8000-000000000001','59030000-0000-4000-8000-000000000001',
  '',null,null,null,null,'',null,null,null,null,null,null,null,null)$$,
  '42501','staff management proposal is not permitted',
  'AAL1 is rejected before malformed employment content is parsed');

select set_config('request.jwt.claims','{"sub":"59010000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"59051000-0000-4000-8000-000000000001"}',true);

-- 11
select throws_ok($$select * from public.submit_staff_management_proposal(
  '59020000-0000-4000-8000-000000000002','59030000-0000-4000-8000-000000000002',
  '',null,null,null,null,'',null,null,null,null,null,null,null,null)$$,
  '42501','staff management proposal is not permitted',
  'cross-tenant request is rejected before malformed content is parsed');

-- 12
select ok((select
  payload->>'identity_source'='profiles_memberships'
  and payload->>'role_source'='membership_roles_role_governance'
  and payload->>'qualification_source'='page72_terminal_projection'
  and payload->>'qualification_reminder_policy_status'='not_configured'
  and payload->'qualification_notice_days'='null'::jsonb
  and payload->'expiring_qualification_total'='null'::jsonb
  and payload->>'session_revocation_provider_status'='not_configured'
  and payload->>'session_revocation_verification_status'='not_verified'
  and (payload->>'session_revocation_sla_minutes')::integer=5
  and payload->>'onboarding_candidate_source_status'='not_configured'
  and (payload->>'profile_option_total')::integer=0
  and jsonb_array_length(payload->'profile_options')=0
  and payload->>'full_hr_payroll_scope'='excluded'
  from public.staff_management_snapshot(
    '59020000-0000-4000-8000-000000000001','59030000-0000-4000-8000-000000000001')),
  'snapshot exposes exact sources and does not invent reminders, HR scope, or revocation completion');

create temporary table page59_pending_a as select *
from public.submit_staff_management_proposal(
  '59020000-0000-4000-8000-000000000001','59030000-0000-4000-8000-000000000001',
  'employment_change','59060000-0000-4000-8000-000000000001',
  '59040000-0000-4000-8000-000000000004','59010000-0000-4000-8000-000000000004',
  2,'active',current_setting('test.page59_today')::date-365,null,
  '人工未標準化聘僱','合成照顧職務','人工登錄中',null,
  '合成聘僱異動 A','59080000-0000-4000-8000-000000000001');
create temporary table page59_pending_b as select *
from public.submit_staff_management_proposal(
  '59020000-0000-4000-8000-000000000001','59030000-0000-4000-8000-000000000001',
  'employment_change','59060000-0000-4000-8000-000000000002',
  '59040000-0000-4000-8000-000000000005','59010000-0000-4000-8000-000000000005',
  2,'active',current_setting('test.page59_today')::date-365,null,
  '人工未標準化聘僱','合成專業職務','人工登錄中',null,
  '合成聘僱異動 B','59080000-0000-4000-8000-000000000002');

-- 13
select is((select (payload->>'pending_proposal_total')::integer
  from public.staff_management_snapshot(
    '59020000-0000-4000-8000-000000000001',
    '59030000-0000-4000-8000-000000000001')),2,
  'multiple pending proposals coexist without a nullable decision-key collision');

-- 14
select ok((select proposal_status='pending' and not replayed
  and content_hash ~ '^[a-f0-9]{64}$' from page59_pending_a),
  'authorized employment proposer freezes an immutable pending proposal');

-- 15
select ok((select replayed from public.submit_staff_management_proposal(
  '59020000-0000-4000-8000-000000000001','59030000-0000-4000-8000-000000000001',
  'employment_change','59060000-0000-4000-8000-000000000001',
  '59040000-0000-4000-8000-000000000004','59010000-0000-4000-8000-000000000004',
  2,'active',current_setting('test.page59_today')::date-365,null,
  '人工未標準化聘僱','合成照顧職務','人工登錄中',null,
  '合成聘僱異動 A','59080000-0000-4000-8000-000000000001')),
  'exact actor-scoped retry returns the original proposal receipt');

-- 16
select throws_ok($$select * from public.submit_staff_management_proposal(
  '59020000-0000-4000-8000-000000000001','59030000-0000-4000-8000-000000000001',
  'employment_change','59060000-0000-4000-8000-000000000001',
  '59040000-0000-4000-8000-000000000004','59010000-0000-4000-8000-000000000004',
  2,'active',current_setting('test.page59_today')::date-365,null,
  '人工未標準化聘僱','不同職務','人工登錄中',null,
  '不同內容','59080000-0000-4000-8000-000000000001')$$,
  '23505','staff management idempotency conflict',
  'same actor key cannot be reused for changed employment content');

-- 17
select throws_ok($$select * from public.submit_staff_management_proposal(
  '59020000-0000-4000-8000-000000000001','59030000-0000-4000-8000-000000000001',
  'terminate','59060000-0000-4000-8000-000000000003',
  '59040000-0000-4000-8000-000000000004','59010000-0000-4000-8000-000000000004',
  2,'ended',current_setting('test.page59_today')::date-365,null,
  null,null,null,current_setting('test.page59_today')::date+1,
  '未來離職日不應立即停權','59080000-0000-4000-8000-000000000003')$$,
  '23514','staff termination must be immediate and target an active period',
  'future termination dates cannot cause contradictory immediate deactivation');

-- 18
select throws_ok($$select * from public.submit_staff_management_proposal(
  '59020000-0000-4000-8000-000000000001','59030000-0000-4000-8000-000000000001',
  'employment_change','59060000-0000-4000-8000-000000000004',
  '59040000-0000-4000-8000-000000000007','59010000-0000-4000-8000-000000000007',
  2,'active',current_setting('test.page59_today')::date-365,null,
  '人工未標準化聘僱','跨機構職務','人工登錄中',null,
  '跨機構不得異動','59080000-0000-4000-8000-000000000004')$$,
  '42501','staff membership is outside the selected branch',
  'cross-tenant staff targets are rejected');

-- 19
select throws_ok($$select * from public.submit_staff_management_proposal(
  '59020000-0000-4000-8000-000000000001','59030000-0000-4000-8000-000000000001',
  'onboard','59060000-0000-4000-8000-000000000008',
  '59040000-0000-4000-8000-000000000008','59010000-0000-4000-8000-000000000006',
  0,'active',current_setting('test.page59_today')::date,null,
  '人工未標準化聘僱','合成駕駛職務','人工登錄中',null,
  '無候選關係不得到職','59080000-0000-4000-8000-000000000008')$$,
  '55000','staff onboarding candidate source is not configured',
  'an unassociated global profile cannot be used as an onboarding candidate');

-- 20
select throws_ok($$select * from public.submit_staff_management_proposal(
  '59020000-0000-4000-8000-000000000001','59030000-0000-4000-8000-000000000001',
  'onboard','59060000-0000-4000-8000-000000000009',
  '59040000-0000-4000-8000-000000000009','59010000-0000-4000-8000-000000000007',
  0,'active',current_setting('test.page59_today')::date,null,
  '人工未標準化聘僱','跨機構職務','人工登錄中',null,
  '跨機構 profile 不得到職','59080000-0000-4000-8000-000000000009')$$,
  '55000','staff onboarding candidate source is not configured',
  'a profile already associated with another tenant is equally undiscoverable');

reset role;
insert into public.staff_management_proposals(
  id,organization_id,branch_id,proposal_key,action,target_membership_id,
  target_profile_id,expected_membership_version,target_membership_status,
  starts_on,ends_on,employment_type_text,job_title_text,
  registration_status_text,termination_effective_on,change_reason,
  target_display_name_snapshot,target_employee_code_snapshot,requested_by,
  requester_reauth_challenge_id,requested_at,request_idempotency_key,
  request_hash,content_hash
) values (
  '59070000-0000-4000-8000-000000000010',
  '59020000-0000-4000-8000-000000000001',
  '59030000-0000-4000-8000-000000000001',
  '59060000-0000-4000-8000-000000000010','onboard',
  '59040000-0000-4000-8000-000000000010',
  '59010000-0000-4000-8000-000000000006',0,'active',
  current_setting('test.page59_today')::date,null,
  '人工未標準化聘僱','合成待到職職務','人工登錄中',null,
  '合成舊系統待審到職','合成待到職人員','P59-6',
  '59010000-0000-4000-8000-000000000001',
  '59050000-0000-4000-8000-000000000001',clock_timestamp(),
  '59080000-0000-4000-8000-000000000010',repeat('d',64),repeat('e',64)
);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"59010000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"59051000-0000-4000-8000-000000000002"}',true);

-- 21
select throws_ok($$select * from public.decide_staff_management_proposal(
  '59020000-0000-4000-8000-000000000001','59030000-0000-4000-8000-000000000001',
  '59070000-0000-4000-8000-000000000010',3,0,
  repeat('e',64),'approve','不得核准未配置 Auth 的舊到職提案',
  '59081000-0000-4000-8000-000000000010')$$,
  '55000','staff onboarding candidate source is not configured',
  'legacy pending onboarding cannot create a membership without governed candidates and Auth');

select set_config('request.jwt.claims','{"sub":"59010000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"59051000-0000-4000-8000-000000000001"}',true);

-- 21
select throws_ok($$select * from public.decide_staff_management_proposal(
  '59020000-0000-4000-8000-000000000001','59030000-0000-4000-8000-000000000001',
  (select proposal_id from page59_pending_a),(select proposal_number from page59_pending_a),2,
  (select content_hash from page59_pending_a),'approve','不得自我核准',
  '59081000-0000-4000-8000-000000000001')$$,
  '42501','staff management proposal requires an independent reviewer',
  'proposal author cannot approve their own employment proposal');

select set_config('request.jwt.claims','{"sub":"59010000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"59051000-0000-4000-8000-000000000002"}',true);

-- 20
select ok((select proposal_status='rejected' and decision='reject'
  and result_employment_version_id is null and result_membership_version is null
  and result_revocation_job_id is null and not replayed
  from public.decide_staff_management_proposal(
    '59020000-0000-4000-8000-000000000001','59030000-0000-4000-8000-000000000001',
    (select proposal_id from page59_pending_b),(select proposal_number from page59_pending_b),2,
    (select content_hash from page59_pending_b),'reject','獨立審核駁回',
    '59081000-0000-4000-8000-000000000002')),
  'independent rejection returns a strict nullable result receipt');

-- 21
select ok((select replayed and proposal_status='rejected'
  from public.decide_staff_management_proposal(
    '59020000-0000-4000-8000-000000000001','59030000-0000-4000-8000-000000000001',
    (select proposal_id from page59_pending_b),(select proposal_number from page59_pending_b),2,
    (select content_hash from page59_pending_b),'reject','獨立審核駁回',
    '59081000-0000-4000-8000-000000000002')),
  'exact decision retry replays the rejected receipt');

-- 22
select ok((select proposal_status='approved' and decision='approve'
  and result_employment_version=1 and result_membership_version=3
  and result_revocation_job_id is null and not replayed
  from public.decide_staff_management_proposal(
    '59020000-0000-4000-8000-000000000001','59030000-0000-4000-8000-000000000001',
    (select proposal_id from page59_pending_a),(select proposal_number from page59_pending_a),2,
    (select content_hash from page59_pending_a),'approve','獨立審核通過',
    '59081000-0000-4000-8000-000000000003')),
  'independent approval atomically creates employment version one and advances membership');

-- 23
select results_eq(
  $$select status::text,staff_management_version from public.memberships
    where id='59040000-0000-4000-8000-000000000004'$$,
  $$values ('active'::text,3::bigint)$$,
  'approved employment state is projected from the existing membership source');

-- 24
select throws_ok($$select * from public.submit_staff_management_proposal(
  '59020000-0000-4000-8000-000000000001','59030000-0000-4000-8000-000000000001',
  'employment_change','59060000-0000-4000-8000-000000000005',
  '59040000-0000-4000-8000-000000000004','59010000-0000-4000-8000-000000000004',
  2,'active',current_setting('test.page59_today')::date-365,null,
  '人工未標準化聘僱','過期版本','人工登錄中',null,
  '過期版本不得送出','59080000-0000-4000-8000-000000000005')$$,
  '40001','staff membership version changed',
  'stale expected membership versions fail closed');

reset role;
-- 25
select throws_ok($$update public.staff_employment_versions
  set job_title_text='不可覆寫'
  where membership_id='59040000-0000-4000-8000-000000000004'$$,
  '55000','staff management evidence is append only',
  'approved employment evidence remains immutable even to the table owner');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"59010000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2","session_id":"59051000-0000-4000-8000-000000000003"}',true);

-- 26
select ok((select proposal_status='pending' and action='employment_change'
  from public.submit_staff_management_proposal(
    '59020000-0000-4000-8000-000000000001','59030000-0000-4000-8000-000000000001',
    'employment_change','59060000-0000-4000-8000-000000000006',
    '59040000-0000-4000-8000-000000000005','59010000-0000-4000-8000-000000000005',
    2,'active',current_setting('test.page59_today')::date-365,null,
    '人工未標準化聘僱','有限權限可送聘僱','人工登錄中',null,
    '僅有聘僱欄位權限','59080000-0000-4000-8000-000000000006')),
  'employment-only manager can submit employment without role or termination manage');

select set_config('request.jwt.claims','{"sub":"59010000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"59051000-0000-4000-8000-000000000001"}',true);
create temporary table page59_role_request as select *
from public.request_staff_role_change(
  '59020000-0000-4000-8000-000000000001','59030000-0000-4000-8000-000000000001',
  'assign_role','59040000-0000-4000-8000-000000000004',
  '10000000-0000-4000-8000-000000000005',3,
  '59082000-0000-4000-8000-000000000001');

-- 27
select ok((select request_status='pending' and expected_membership_version=3
  and not replayed from page59_role_request)
  and (select (payload->>'pending_role_request_total')::integer=1
    from public.staff_management_snapshot(
      '59020000-0000-4000-8000-000000000001',
      '59030000-0000-4000-8000-000000000001')),
  'Page 59 binds a Page-81 role request to the exact membership version');

-- 28
select throws_ok($$select * from public.approve_staff_role_change(
  '59020000-0000-4000-8000-000000000001','59030000-0000-4000-8000-000000000001',
  (select request_id from page59_role_request),3,
  '59083000-0000-4000-8000-000000000001')$$,
  '42501','role changes require an independent second approver',
  'role requester cannot approve the privilege expansion');

select set_config('request.jwt.claims','{"sub":"59010000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"59051000-0000-4000-8000-000000000002"}',true);

-- 29
select ok((select request_status='approved' and result_membership_version=4
  and not replayed from public.approve_staff_role_change(
    '59020000-0000-4000-8000-000000000001','59030000-0000-4000-8000-000000000001',
    (select request_id from page59_role_request),3,
    '59083000-0000-4000-8000-000000000002')),
  'independent Page-81 approval advances the exact Page-59 version');

-- 30
select ok(exists(select 1 from public.membership_roles
    where membership_id='59040000-0000-4000-8000-000000000004'
      and role_id='10000000-0000-4000-8000-000000000005'),
  'independent Page-81 approval applies the requested role once');

-- 31
select ok((select replayed and result_membership_version=4
  from public.approve_staff_role_change(
    '59020000-0000-4000-8000-000000000001','59030000-0000-4000-8000-000000000001',
    (select request_id from page59_role_request),3,
    '59083000-0000-4000-8000-000000000002')),
  'exact role approval retry replays without a duplicate assignment');

select set_config('request.jwt.claims','{"sub":"59010000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"59051000-0000-4000-8000-000000000001"}',true);
create temporary table page59_termination as select *
from public.submit_staff_management_proposal(
  '59020000-0000-4000-8000-000000000001','59030000-0000-4000-8000-000000000001',
  'terminate','59060000-0000-4000-8000-000000000007',
  '59040000-0000-4000-8000-000000000004','59010000-0000-4000-8000-000000000004',
  4,'ended',current_setting('test.page59_today')::date-365,null,
  null,null,null,current_setting('test.page59_today')::date,
  '合成立即離職停用','59080000-0000-4000-8000-000000000007');

select set_config('request.jwt.claims','{"sub":"59010000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"59051000-0000-4000-8000-000000000002"}',true);
create temporary table page59_termination_result as select *
from public.decide_staff_management_proposal(
  '59020000-0000-4000-8000-000000000001','59030000-0000-4000-8000-000000000001',
  (select proposal_id from page59_termination),(select proposal_number from page59_termination),4,
  (select content_hash from page59_termination),'approve','獨立核准立即停用',
  '59081000-0000-4000-8000-000000000004');

-- 32
select ok((select proposal_status='approved' and result_membership_version=5
  and result_revocation_job_id is not null
  and revocation_provider_status='not_configured'
  and revocation_verification_status='not_verified'
  and revocation_deadline_at=revocation_queued_at+interval '5 minutes'
  from page59_termination_result),
  'termination atomically queues a measurable fail-closed five-minute revocation receipt');

-- 33
select results_eq(
  $$select status::text,staff_management_version,ends_at is not null
    from public.memberships where id='59040000-0000-4000-8000-000000000004'$$,
  $$values ('ended'::text,5::bigint,true)$$,
  'approved termination immediately projects the existing membership as ended');

-- 34
select ok((select replayed and result_revocation_job_id=
    (select result_revocation_job_id from page59_termination_result)
  from public.decide_staff_management_proposal(
    '59020000-0000-4000-8000-000000000001','59030000-0000-4000-8000-000000000001',
    (select proposal_id from page59_termination),(select proposal_number from page59_termination),4,
    (select content_hash from page59_termination),'approve','獨立核准立即停用',
    '59081000-0000-4000-8000-000000000004'))
  and (select (payload->>'revocation_job_total')::integer=1
    from public.staff_management_snapshot(
      '59020000-0000-4000-8000-000000000001',
      '59030000-0000-4000-8000-000000000001')),
  'termination retry returns the same job and never queues a duplicate');

-- 35
select ok((select payload->>'session_revocation_provider_status'='not_configured'
  and payload->>'session_revocation_verification_status'='not_verified'
  and (payload->>'pending_revocation_total')::bigint=1
  and (payload->>'revocation_job_total')::bigint=1
  and payload->>'qualification_reminder_policy_status'='not_configured'
  from public.staff_management_snapshot(
    '59020000-0000-4000-8000-000000000001','59030000-0000-4000-8000-000000000001',
    'all',null,'all','合成')),
  'post-termination snapshot stays honest about provider and reminder boundaries');

-- 36
reset role;
select ok((select metadata ? 'search_present'
    and not metadata ? 'search' and not metadata::text like '%合成%'
  from public.audit_events
  where table_name='staff_management_snapshot'
  order by occurred_at desc limit 1),
  'sensitive staff searches are audited without storing the query text');

select * from finish();
rollback;
