begin;

select plan(62);

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

-- Synthetic Google identity, native session, session-owned AMR and an
-- independently approved grant. Email-only JWTs are never admission evidence.
insert into auth.identities(id,provider_id,user_id,identity_data,provider)
select ('59055000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'page59-google-'||n,
 ('59010000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 jsonb_build_object('sub','page59-google-'||n,'email',u.email,'email_verified',true),'google'
 from generate_series(1,3)n join auth.users u on u.id=('59010000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
insert into auth.sessions(id,user_id,created_at,updated_at,aal)
select ('59051000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 ('59010000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,now()-interval '3 minutes',now(),'aal2' from generate_series(1,3)n;
select set_config('test.page59_oauth',floor(extract(epoch from now()-interval '2 minutes'))::text,true);
select set_config('test.page59_totp',floor(extract(epoch from now()-interval '30 seconds'))::text,true);
insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method)
select ('59056000-0000-4000-8000-'||lpad((n*10+m)::text,12,'0'))::uuid,
 ('59051000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 to_timestamp(current_setting(case when m=1 then 'test.page59_oauth' else 'test.page59_totp' end)::bigint),
 to_timestamp(current_setting(case when m=1 then 'test.page59_oauth' else 'test.page59_totp' end)::bigint),
 case when m=1 then 'oauth' else 'totp' end from generate_series(1,3)n cross join generate_series(1,2)m;
insert into private.staff_google_access_grants(allowed_user_id,organization_id,company_email_domain,allowed_email,google_subject,enabled,approval_reference)
select u.id,'59020000-0000-4000-8000-000000000001','example.invalid',u.email,'page59-google-'||n,true,'synthetic Page59 admission review'
 from generate_series(1,3)n join auth.users u on u.id=('59010000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
create function pg_temp.page59_login(n integer,level text default 'aal2') returns void language plpgsql as $fixture$
declare actor_email text;
begin
 actor_email:=case n when 1 then 'page59-a@example.invalid' when 2 then 'page59-b@example.invalid' else 'page59-limited@example.invalid' end;
 perform set_config('request.jwt.claim.sub','',true); perform set_config('request.jwt.claim.role','',true);
 perform set_config('request.jwt.claims',jsonb_build_object(
  'sub','59010000-0000-4000-8000-'||lpad(n::text,12,'0'),
  'session_id','59051000-0000-4000-8000-'||lpad(n::text,12,'0'),
  'role','authenticated','aud','authenticated','aal',level,'is_anonymous',false,'email',actor_email,
  'iat',floor(extract(epoch from clock_timestamp())),'exp',floor(extract(epoch from clock_timestamp()+interval '30 minutes')),
  'amr',jsonb_build_array(jsonb_build_object('method','oauth','timestamp',current_setting('test.page59_oauth')::bigint))
   ||case when level='aal2' then jsonb_build_array(jsonb_build_object('method','totp','timestamp',current_setting('test.page59_totp')::bigint)) else '[]'::jsonb end)::text,true);
end; $fixture$;

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
insert into auth.sessions(id,user_id,created_at,updated_at) values
('59054000-0000-4000-8000-000000000004','59010000-0000-4000-8000-000000000004',now(),now()),
('59054000-0000-4000-8000-000000000005','59010000-0000-4000-8000-000000000005',now(),now());
insert into auth.refresh_tokens(user_id,session_id,token) values
('59010000-0000-4000-8000-000000000004','59054000-0000-4000-8000-000000000004','synthetic-page59-worker-token'),
('59010000-0000-4000-8000-000000000005','59054000-0000-4000-8000-000000000005','synthetic-page59-other-token');

set local role authenticated;
select pg_temp.page59_login(1,'aal1');

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

select pg_temp.page59_login(1,'aal2');

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
  and payload->>'session_revocation_provider_status'='supabase_native'
  and payload->>'session_revocation_verification_status'='verified'
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
select pg_temp.page59_login(2,'aal2');

-- 21
select throws_ok($$select * from public.decide_staff_management_proposal(
  '59020000-0000-4000-8000-000000000001','59030000-0000-4000-8000-000000000001',
  '59070000-0000-4000-8000-000000000010',3,0,
  repeat('e',64),'approve','不得核准未配置 Auth 的舊到職提案',
  '59081000-0000-4000-8000-000000000010')$$,
  '55000','staff onboarding candidate source is not configured',
  'legacy pending onboarding cannot create a membership without governed candidates and Auth');

select pg_temp.page59_login(1,'aal2');

-- 21
select throws_ok($$select * from public.decide_staff_management_proposal(
  '59020000-0000-4000-8000-000000000001','59030000-0000-4000-8000-000000000001',
  (select proposal_id from page59_pending_a),(select proposal_number from page59_pending_a),2,
  (select content_hash from page59_pending_a),'approve','不得自我核准',
  '59081000-0000-4000-8000-000000000001')$$,
  '42501','staff management proposal requires an independent reviewer',
  'proposal author cannot approve their own employment proposal');

select pg_temp.page59_login(2,'aal2');

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
select pg_temp.page59_login(3,'aal2');

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

select pg_temp.page59_login(1,'aal2');
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

select pg_temp.page59_login(2,'aal2');

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

select pg_temp.page59_login(1,'aal2');
create temporary table page59_termination as select *
from public.submit_staff_management_proposal(
  '59020000-0000-4000-8000-000000000001','59030000-0000-4000-8000-000000000001',
  'terminate','59060000-0000-4000-8000-000000000007',
  '59040000-0000-4000-8000-000000000004','59010000-0000-4000-8000-000000000004',
  4,'ended',current_setting('test.page59_today')::date-365,null,
  null,null,null,current_setting('test.page59_today')::date,
  '合成立即離職停用','59080000-0000-4000-8000-000000000007');

select pg_temp.page59_login(2,'aal2');
create temporary table page59_termination_result as select *
from public.decide_staff_management_proposal(
  '59020000-0000-4000-8000-000000000001','59030000-0000-4000-8000-000000000001',
  (select proposal_id from page59_termination),(select proposal_number from page59_termination),4,
  (select content_hash from page59_termination),'approve','獨立核准立即停用',
  '59081000-0000-4000-8000-000000000004');

-- 32
select ok((select proposal_status='approved' and result_membership_version=5
  and result_revocation_job_id is not null
  and revocation_provider_status='supabase_native'
  and revocation_verification_status='verified'
  and revocation_deadline_at=revocation_queued_at+interval '5 minutes'
  from page59_termination_result),
  'termination atomically revokes native sessions with a verified five-minute receipt');

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
select ok((select payload->>'session_revocation_provider_status'='supabase_native'
  and payload->>'session_revocation_verification_status'='verified'
  and (payload->>'pending_revocation_total')::bigint=0
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

select is((select count(*)::integer from auth.sessions where user_id='59010000-0000-4000-8000-000000000004'),0,
  'termination removes the actual target sessions');
select is((select count(*)::integer from auth.refresh_tokens where user_id='59010000-0000-4000-8000-000000000004'),0,
  'termination removes the actual target refresh tokens');
select ok(exists(select 1 from auth.sessions where user_id='59010000-0000-4000-8000-000000000005') and
 exists(select 1 from auth.refresh_tokens where user_id='59010000-0000-4000-8000-000000000005'),
 'termination preserves other employee sessions and refresh tokens');
select ok(not has_table_privilege('authenticated','private.staff_google_invitations','select')
 and not has_table_privilege('service_role','private.staff_google_invitations','update'),
 'invitation identities and approvals have no direct table access');
set local role authenticated;
select pg_temp.page59_login(1,'aal2');
create temporary table invitation_request as select public.staff_google_invitation_mutate(
 '59020000-0000-4000-8000-000000000001','59030000-0000-4000-8000-000000000001','propose',
 '59085000-0000-4000-8000-000000000001','new-staff@example.invalid','合成新員工','10000000-0000-4000-8000-000000000006') receipt;
select ok((select receipt->>'status'='pending' and receipt->'replayed'='false'::jsonb from invitation_request),
 'governed invitation remains pending without automatic privilege expansion');
select ok((public.staff_google_invitation_mutate(
 '59020000-0000-4000-8000-000000000001','59030000-0000-4000-8000-000000000001','propose',
 '59085000-0000-4000-8000-000000000001','new-staff@example.invalid','合成新員工','10000000-0000-4000-8000-000000000006')->>'replayed')::boolean,
 'identical invitation retry replays without a duplicate');
select throws_ok($$select public.staff_google_invitation_mutate(
 '59020000-0000-4000-8000-000000000001','59030000-0000-4000-8000-000000000001','propose',
 '59085000-0000-4000-8000-000000000001','new-staff@example.invalid','改名','10000000-0000-4000-8000-000000000006')$$,
 '23505','staff invitation idempotency conflict','same key cannot change invitation content');
select throws_ok($$select public.staff_google_invitation_mutate(
 '59020000-0000-4000-8000-000000000001','59030000-0000-4000-8000-000000000001','approve',
 '59085000-0000-4000-8000-000000000002',null,null,null,(select(receipt->>'id')::uuid from invitation_request))$$,
 '42501','staff invitation requires an independent approver','requester cannot approve own invitation');
select throws_ok($$select public.staff_google_invitation_mutate(
 '59020000-0000-4000-8000-000000000001','59030000-0000-4000-8000-000000000001',null,
 '59085000-0000-4000-8000-000000000003')$$,'42501','staff invitation is not permitted','direct RPC rejects null action');
select throws_ok($$select public.staff_google_invitation_mutate(
 '59020000-0000-4000-8000-000000000001','59030000-0000-4000-8000-000000000001','propose',
 '59085000-0000-4000-8000-000000000004','outsider@external.invalid','合成','10000000-0000-4000-8000-000000000006')$$,
 '22023','invalid company staff invitation','different company domain is rejected server-side');
select throws_ok($$select public.staff_google_invitation_mutate(
 '59020000-0000-4000-8000-000000000002','59030000-0000-4000-8000-000000000002','propose',
 '59085000-0000-4000-8000-000000000005','new-staff@example.invalid','合成','10000000-0000-4000-8000-000000000006')$$,
 '42501','staff invitation is not permitted','invitation cannot write into another tenant');
select pg_temp.page59_login(2,'aal2');
select is(public.staff_google_invitation_mutate(
 '59020000-0000-4000-8000-000000000001','59030000-0000-4000-8000-000000000001','approve',
 '59085000-0000-4000-8000-000000000002',null,null,null,(select(receipt->>'id')::uuid from invitation_request))->>'status',
 'approved','independent reviewer can approve the exact scoped invitation');
select ok((public.staff_google_invitation_mutate(
 '59020000-0000-4000-8000-000000000001','59030000-0000-4000-8000-000000000001','approve',
 '59085000-0000-4000-8000-000000000002',null,null,null,(select(receipt->>'id')::uuid from invitation_request))->>'replayed')::boolean,
 'independent approval retry preserves the original receipt');
select ok(not public.activate_approved_staff_google_account(),'email alone cannot activate without a genuine approved Google session');
reset role;
select ok(not exists(select 1 from public.audit_events where table_name='private.staff_google_invitations'
 and(metadata::text like '%new-staff%' or metadata::text like '%example.invalid%')),
 'invitation audit records omit plaintext email');

-- These fixtures exercise the actual admission predicate; no legacy CEO
-- replacement is installed. Malformed claims and revoked native state deny.
select pg_temp.page59_login(1,'aal2');
select ok(private.is_active_user(),'approved non-CEO native Google AAL2 remains an active user');
set local role authenticated;
select ok(public.can_begin_staff_mfa(),'approved non-CEO staff can start a real reauthentication challenge');
select set_config('request.jwt.claims',(auth.jwt()-'session_id')::text,true);
select ok(not public.is_staff_login_allowed(),'email and role cannot replace the native session identifier');
select pg_temp.page59_login(1,'aal2');
select set_config('request.jwt.claims',jsonb_set(auth.jwt(),'{amr}','[]'::jsonb)::text,true);
select ok(not public.is_staff_login_allowed(),'linked Google identity without same-session OAuth AMR cannot log in');
select pg_temp.page59_login(1,'aal2');
select set_config('request.jwt.claims',jsonb_set(auth.jwt(),'{role}','"service_role"'::jsonb)::text,true);
select ok(not public.is_staff_login_allowed(),'privileged role text cannot spoof staff login admission');
select pg_temp.page59_login(1,'aal1');
reset role;
select ok(not private.is_active_user(),'ordinary AAL1 does not gain the legacy AAL2 operation helper');
select pg_temp.page59_login(1,'aal2');
update private.staff_google_access_grants set enabled=false where allowed_user_id='59010000-0000-4000-8000-000000000001';
set local role authenticated;
select ok(not public.is_staff_login_allowed() and not public.can_begin_staff_mfa(),'disabled grant revokes login and MFA challenge eligibility');
reset role;
update private.staff_google_access_grants set enabled=true where allowed_user_id='59010000-0000-4000-8000-000000000001';
delete from auth.sessions where id='59051000-0000-4000-8000-000000000001';
set local role authenticated;
select ok(not public.is_staff_login_allowed(),'old Google JWT cannot survive deletion of the native session');
select * from finish();
rollback;
