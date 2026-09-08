begin;

select plan(33);

-- 1
select ok(
  to_regclass('public.organization_profile_proposals') is not null
  and to_regclass('public.organization_profile_versions') is not null
  and to_regclass('public.organization_profile_decisions') is not null
  and to_regclass('private.organization_profile_operations') is not null,
  'Page 58 has dedicated proposal, effective-version, decision, and receipt stores'
);

-- 2
select is((select count(*)::integer from pg_class where oid in (
  'public.organization_profile_proposals'::regclass,
  'public.organization_profile_versions'::regclass,
  'public.organization_profile_decisions'::regclass,
  'private.organization_profile_operations'::regclass
) and relrowsecurity and relforcerowsecurity),4,
  'all four Page-58 stores force RLS');

-- 3
select ok(
  not has_table_privilege('authenticated','public.organization_profile_proposals','select')
  and not has_table_privilege('authenticated','public.organization_profile_versions','insert')
  and not has_table_privilege('service_role','public.organization_profile_decisions','select')
  and not has_table_privilege('authenticated','private.organization_profile_operations','select'),
  'direct business and receipt table access is denied');

-- 4
select ok(
  has_function_privilege('authenticated',
    'public.organization_profile_snapshot(uuid,uuid)','execute')
  and has_function_privilege('authenticated',
    'public.decide_organization_profile_proposal(uuid,uuid,uuid,integer,integer,text,text,uuid)','execute')
  and not has_function_privilege('anon',
    'public.organization_profile_snapshot(uuid,uuid)','execute'),
  'only authenticated callers receive narrow public RPC entrypoints');

-- 5
select ok((select count(*)=5 and bool_and(
  proconfig=array['search_path=""']::text[]
  and prosecdef=(pg_namespace.nspname='private'))
  from pg_proc join pg_namespace on pg_namespace.oid=pg_proc.pronamespace
  where (pg_namespace.nspname,proname) in (
    ('public','organization_profile_snapshot'),
    ('public','submit_organization_profile_proposal'),
    ('public','decide_organization_profile_proposal'),
    ('private','organization_profile_snapshot_response'),
    ('private','decide_organization_profile_proposal_guarded')
  )), 'public RPCs are pinned invokers and private cores are pinned definers');

-- 6
select is((select count(*)::integer from pg_trigger where not tgisinternal
  and tgname in (
    'organization_profile_proposals_append_only',
    'organization_profile_versions_append_only',
    'organization_profile_decisions_append_only',
    'organization_profile_operations_append_only'
  )),4,'all Page-58 stores reject update and delete');

-- 7
select is((select count(*)::integer from pg_trigger where not tgisinternal
  and tgname in (
    'organization_profile_proposals_audit_row_change',
    'organization_profile_versions_audit_row_change',
    'organization_profile_decisions_audit_row_change',
    'organization_profile_operations_audit_row_change'
  )),4,'all Page-58 inserts have field-name-only audit triggers');

-- 8
select ok((select count(*)=8 and bool_and(risk_level in (2,3))
  from public.permissions where permission_key like 'organization_profile.%'),
  'Page 58 defines read, workflow, and five field-level permissions');

-- 9
select ok(not exists(
  select 1 from public.role_permissions rp
  join public.roles r on r.id=rp.role_id
  join public.permissions p on p.id=rp.permission_id
  where p.permission_key like 'organization_profile.%'
    and r.role_key not in ('organization_manager','branch_supervisor')
), 'Page-58 rights are narrowly defaulted to managers and supervisors');

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('00000000-0000-0000-0000-000000000000','58010000-0000-4000-8000-000000000001','authenticated','authenticated','page58-proposer@example.invalid','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','58010000-0000-4000-8000-000000000002','authenticated','authenticated','page58-reviewer@example.invalid','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','58010000-0000-4000-8000-000000000003','authenticated','authenticated','page58-worker@example.invalid','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','58010000-0000-4000-8000-000000000004','authenticated','authenticated','page58-other@example.invalid','',now(),'{}','{}',now(),now());
insert into public.organizations(id,code,name) values
('58020000-0000-4000-8000-000000000001','page58_a','合成機構 A'),
('58020000-0000-4000-8000-000000000002','page58_b','合成機構 B');
insert into public.branches(id,organization_id,code,name) values
('58030000-0000-4000-8000-000000000001','58020000-0000-4000-8000-000000000001','main','合成分支 A'),
('58030000-0000-4000-8000-000000000002','58020000-0000-4000-8000-000000000002','main','合成分支 B');
insert into public.profiles(id,display_name,kind,employee_code) values
('58010000-0000-4000-8000-000000000001','合成提案人','staff','P58-1'),
('58010000-0000-4000-8000-000000000002','合成審核人','staff','P58-2'),
('58010000-0000-4000-8000-000000000003','合成一般人員','staff','P58-3'),
('58010000-0000-4000-8000-000000000004','合成跨機構人員','staff','P58-4');
insert into public.memberships(id,organization_id,branch_id,profile_id,status) values
('58040000-0000-4000-8000-000000000001','58020000-0000-4000-8000-000000000001','58030000-0000-4000-8000-000000000001','58010000-0000-4000-8000-000000000001','active'),
('58040000-0000-4000-8000-000000000002','58020000-0000-4000-8000-000000000001','58030000-0000-4000-8000-000000000001','58010000-0000-4000-8000-000000000002','active'),
('58040000-0000-4000-8000-000000000003','58020000-0000-4000-8000-000000000001','58030000-0000-4000-8000-000000000001','58010000-0000-4000-8000-000000000003','active'),
('58040000-0000-4000-8000-000000000004','58020000-0000-4000-8000-000000000002','58030000-0000-4000-8000-000000000002','58010000-0000-4000-8000-000000000004','active');
insert into public.membership_roles(membership_id,role_id) values
('58040000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003'),
('58040000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003'),
('58040000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000006'),
('58040000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000003');

insert into private.reauth_challenges(
  id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,
  created_at,expires_at,consumed_at,consumed_jwt_iat,factor_method,factor_verified_at
) values
('58050000-0000-4000-8000-000000000001','58010000-0000-4000-8000-000000000001','58051000-0000-4000-8000-000000000001',repeat('a',64),'58052000-0000-4000-8000-000000000001',now()-interval '2 minutes',now()-interval '2 minutes',now()+interval '5 minutes',now()-interval '30 seconds',now()-interval '30 seconds','totp',now()-interval '30 seconds'),
('58050000-0000-4000-8000-000000000002','58010000-0000-4000-8000-000000000002','58051000-0000-4000-8000-000000000002',repeat('b',64),'58052000-0000-4000-8000-000000000002',now()-interval '2 minutes',now()-interval '2 minutes',now()+interval '5 minutes',now()-interval '30 seconds',now()-interval '30 seconds','totp',now()-interval '30 seconds'),
('58050000-0000-4000-8000-000000000004','58010000-0000-4000-8000-000000000004','58051000-0000-4000-8000-000000000004',repeat('d',64),'58052000-0000-4000-8000-000000000004',now()-interval '2 minutes',now()-interval '2 minutes',now()+interval '5 minutes',now()-interval '30 seconds',now()-interval '30 seconds','totp',now()-interval '30 seconds');
insert into private.reauth_events(user_id,session_id,challenge_id,aal,verification_method,verified_at) values
('58010000-0000-4000-8000-000000000001','58051000-0000-4000-8000-000000000001','58050000-0000-4000-8000-000000000001','aal2','totp',now()-interval '30 seconds'),
('58010000-0000-4000-8000-000000000002','58051000-0000-4000-8000-000000000002','58050000-0000-4000-8000-000000000002','aal2','totp',now()-interval '30 seconds'),
('58010000-0000-4000-8000-000000000004','58051000-0000-4000-8000-000000000004','58050000-0000-4000-8000-000000000004','aal2','totp',now()-interval '30 seconds');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"58010000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1","session_id":"58051000-0000-4000-8000-000000000001"}',true);

-- 10
select throws_ok($$select * from public.organization_profile_snapshot(
  '58020000-0000-4000-8000-000000000001','58030000-0000-4000-8000-000000000001')$$,
  '42501','organization profile snapshot is not permitted','AAL1 cannot read Page 58');

-- 11
select throws_ok($$select * from public.submit_organization_profile_proposal(
  '58020000-0000-4000-8000-000000000001','58030000-0000-4000-8000-000000000001','create',
  null,null,null,0,null,null,'','','2026-01-01',null,'','',
  '[]','[]',1,'','','','','','','','58080000-0000-4000-8000-000000000001')$$,
  '42501','organization profile proposal is not permitted',
  'AAL1 is rejected before malformed proposal content');

select set_config('request.jwt.claims','{"sub":"58010000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"58051000-0000-4000-8000-000000000001"}',true);

-- 12
select throws_ok($$select * from public.submit_organization_profile_proposal(
  '58020000-0000-4000-8000-000000000002','58030000-0000-4000-8000-000000000002','create',
  null,null,null,0,null,null,'','','2026-01-01',null,'','',
  '[]','[]',1,'','','','','','','','58080000-0000-4000-8000-000000000002')$$,
  '42501','organization profile proposal is not permitted',
  'cross-tenant scope is rejected before malformed proposal content');

-- 13
select ok((select version_total=0 and proposal_total=0 and active_version_total=0
  and pending_proposal_total=0 and official_taxonomy_status='not_configured'
  and permit_expiry_reminder_status='not_configured'
  and attachment_pipeline_status='not_configured' and export_status='disabled'
  and regulator_sync_status='disabled' and offline_status='disabled'
  from public.organization_profile_snapshot(
    '58020000-0000-4000-8000-000000000001','58030000-0000-4000-8000-000000000001')),
  'empty snapshot invents no taxonomy, reminder, attachment, export, sync, or offline capability');

create temporary table page58_first_proposal as select *
from public.submit_organization_profile_proposal(
  '58020000-0000-4000-8000-000000000001','58030000-0000-4000-8000-000000000001','create',
  '58060000-0000-4000-8000-000000000001','58061000-0000-4000-8000-000000000001',null,0,
  '2026-01-01','2026-12-31','合成許可 001','合成發證單位','2025-12-01','2026-12-31',
  '人工填寫有效','合成日照類型',
  '[{"service_key":"58062000-0000-4000-8000-000000000001","name":"合成服務","description":null,"taxonomy_status":"manual_unstandardized"}]',
  '[{"rate_key":"58063000-0000-4000-8000-000000000001","label":"合成費目","amount_decimal_text":"001200.00","currency_code":"TWD","effective_from":"2026-01-01","effective_to":"2026-12-31","taxonomy_status":"manual_unstandardized"}]',
  30,'合成人數單位','合成核定依據','合成聯絡窗口','02-0000-0000','synthetic@example.invalid',
  '合成地址','建立第一個完整版本','58080000-0000-4000-8000-000000000010');

-- 14
select ok((select proposal_number=1 and proposal_status='pending' and action='create'
  and expected_base_version=0 and not replayed from page58_first_proposal),
  'authorized proposer freezes a complete pending proposal');

-- 15
select ok((select content_hash ~ '^[a-f0-9]{64}$' from page58_first_proposal),
  'proposal receipt contains a content hash');

-- 16
select ok((select replayed from public.submit_organization_profile_proposal(
  '58020000-0000-4000-8000-000000000001','58030000-0000-4000-8000-000000000001','create',
  '58060000-0000-4000-8000-000000000001','58061000-0000-4000-8000-000000000001',null,0,
  '2026-01-01','2026-12-31','合成許可 001','合成發證單位','2025-12-01','2026-12-31',
  '人工填寫有效','合成日照類型',
  '[{"service_key":"58062000-0000-4000-8000-000000000001","name":"合成服務","description":null,"taxonomy_status":"manual_unstandardized"}]',
  '[{"rate_key":"58063000-0000-4000-8000-000000000001","label":"合成費目","amount_decimal_text":"001200.00","currency_code":"TWD","effective_from":"2026-01-01","effective_to":"2026-12-31","taxonomy_status":"manual_unstandardized"}]',
  30,'合成人數單位','合成核定依據','合成聯絡窗口','02-0000-0000','synthetic@example.invalid',
  '合成地址','建立第一個完整版本','58080000-0000-4000-8000-000000000010')),
  'exact actor-scoped retry returns the original proposal receipt');

-- 17
select throws_ok($$select * from public.submit_organization_profile_proposal(
  '58020000-0000-4000-8000-000000000001','58030000-0000-4000-8000-000000000001','create',
  '58060000-0000-4000-8000-000000000001','58061000-0000-4000-8000-000000000001',null,0,
  '2026-01-01','2026-12-31','不同許可','合成發證單位','2025-12-01','2026-12-31',
  '人工填寫有效','合成日照類型','[]','[]',30,'合成人數單位','合成核定依據',
  '合成聯絡窗口','02-0000-0000',null,'合成地址','不同內容',
  '58080000-0000-4000-8000-000000000010')$$,
  '23505','organization profile idempotency conflict',
  'same actor key cannot be reused for changed content');

reset role;
create temporary table page58_ids as select id proposal_id,proposal_number,profile_key,
  null::uuid version_id,null::uuid second_proposal_id,null::uuid reject_proposal_id
from public.organization_profile_proposals where proposal_key='58060000-0000-4000-8000-000000000001';
grant select,update on page58_ids to authenticated;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"58010000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"58051000-0000-4000-8000-000000000001"}',true);

-- 18
select throws_ok($$select * from public.decide_organization_profile_proposal(
  '58020000-0000-4000-8000-000000000001','58030000-0000-4000-8000-000000000001',
  (select proposal_id from page58_ids),(select proposal_number from page58_ids),0,
  'approve','自我核准不允許','58080000-0000-4000-8000-000000000011')$$,
  '42501','organization profile proposal requires an independent reviewer',
  'proposal author cannot approve their own proposal');

select set_config('request.jwt.claims','{"sub":"58010000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"58051000-0000-4000-8000-000000000002"}',true);
create temporary table page58_approval as select * from public.decide_organization_profile_proposal(
  '58020000-0000-4000-8000-000000000001','58030000-0000-4000-8000-000000000001',
  (select proposal_id from page58_ids),(select proposal_number from page58_ids),0,
  'approve','獨立核准合成版本','58080000-0000-4000-8000-000000000012');

-- 19
select ok((select decision='approve' and proposal_status='approved'
  and result_version=1 and effective_from='2026-01-01'::date
  and effective_to='2026-12-31'::date and not replayed from page58_approval),
  'different reviewer creates effective version one');

-- 20
select ok((select replayed from public.decide_organization_profile_proposal(
  '58020000-0000-4000-8000-000000000001','58030000-0000-4000-8000-000000000001',
  (select proposal_id from page58_ids),(select proposal_number from page58_ids),0,
  'approve','獨立核准合成版本','58080000-0000-4000-8000-000000000012')),
  'exact reviewer retry returns the original decision receipt');

-- 21
select ok((select version_total=1 and active_version_total=1
  and pending_proposal_total=0 and active_capacity=30
  and versions->0->'rate_items'->0->>'amount_decimal_text'='001200.00'
  and versions->0->>'taxonomy_status'='manual_unstandardized'
  from public.organization_profile_snapshot(
    '58020000-0000-4000-8000-000000000001','58030000-0000-4000-8000-000000000001')),
  'snapshot preserves exact decimal text and explicit unstandardized taxonomy');

reset role;
update page58_ids set version_id=(select id from public.organization_profile_versions
  where profile_key='58061000-0000-4000-8000-000000000001');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"58010000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"58051000-0000-4000-8000-000000000001"}',true);

create temporary table page58_correction as select * from public.submit_organization_profile_proposal(
  '58020000-0000-4000-8000-000000000001','58030000-0000-4000-8000-000000000001','correct',
  '58060000-0000-4000-8000-000000000002','58061000-0000-4000-8000-000000000001',
  (select version_id from page58_ids),1,'2026-01-01','2026-06-30','合成許可 001','合成發證單位',
  '2025-12-01','2026-12-31','人工填寫有效','合成日照類型','[]','[]',30,
  '合成人數單位','合成核定依據','合成聯絡窗口','02-0000-0000',null,'合成地址',
  '縮短第一期間以保留後續期間','58080000-0000-4000-8000-000000000020');
reset role;
update page58_ids set second_proposal_id=(select proposal_id from page58_correction);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"58010000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"58051000-0000-4000-8000-000000000002"}',true);

-- 22
select ok((select result_version=2 from public.decide_organization_profile_proposal(
  '58020000-0000-4000-8000-000000000001','58030000-0000-4000-8000-000000000001',
  (select second_proposal_id from page58_ids),(select proposal_number from page58_correction),1,
  'approve','核准期間更正','58080000-0000-4000-8000-000000000021')),
  'correction appends version two instead of updating version one');

-- 23
select ok((select version_total=1 and history_total=2
  and versions->0->>'version'='2' and versions->0->>'effective_to'='2026-06-30'
  from public.organization_profile_snapshot(
    '58020000-0000-4000-8000-000000000001','58030000-0000-4000-8000-000000000001')),
  'terminal projection changes while both immutable versions remain in history');

select set_config('request.jwt.claims','{"sub":"58010000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"58051000-0000-4000-8000-000000000001"}',true);
create temporary table page58_second_period as select * from public.submit_organization_profile_proposal(
  '58020000-0000-4000-8000-000000000001','58030000-0000-4000-8000-000000000001','create',
  '58060000-0000-4000-8000-000000000003','58061000-0000-4000-8000-000000000003',null,0,
  '2026-07-01',null,'合成許可 002','合成發證單位','2026-06-01',null,'人工填寫有效',
  '合成日照類型','[]','[]',32,'合成人數單位','合成核定依據','合成聯絡窗口',
  '02-0000-0000',null,'合成地址','建立下一期間','58080000-0000-4000-8000-000000000030');
select set_config('request.jwt.claims','{"sub":"58010000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"58051000-0000-4000-8000-000000000002"}',true);

-- 24
select ok((select result_version=1 from public.decide_organization_profile_proposal(
  '58020000-0000-4000-8000-000000000001','58030000-0000-4000-8000-000000000001',
  (select proposal_id from page58_second_period),(select proposal_number from page58_second_period),0,
  'approve','核准不重疊期間','58080000-0000-4000-8000-000000000031')),
  'a non-overlapping following effective period can be approved');

select set_config('request.jwt.claims','{"sub":"58010000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"58051000-0000-4000-8000-000000000001"}',true);
create temporary table page58_overlap as select * from public.submit_organization_profile_proposal(
  '58020000-0000-4000-8000-000000000001','58030000-0000-4000-8000-000000000001','create',
  '58060000-0000-4000-8000-000000000004','58061000-0000-4000-8000-000000000004',null,0,
  '2026-06-15','2026-08-01','合成許可 003','合成發證單位','2026-06-01',null,'人工填寫有效',
  '合成日照類型','[]','[]',20,'合成人數單位','合成核定依據','合成聯絡窗口',
  '02-0000-0000',null,'合成地址','故意重疊','58080000-0000-4000-8000-000000000040');
select set_config('request.jwt.claims','{"sub":"58010000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"58051000-0000-4000-8000-000000000002"}',true);

-- 25
select throws_ok($$select * from public.decide_organization_profile_proposal(
  '58020000-0000-4000-8000-000000000001','58030000-0000-4000-8000-000000000001',
  (select proposal_id from page58_overlap),(select proposal_number from page58_overlap),0,
  'approve','不得核准重疊期間','58080000-0000-4000-8000-000000000041')$$,
  '23514','organization profile effective periods overlap',
  'effective-period overlap is rejected atomically');

-- 26
select throws_ok($$select * from public.submit_organization_profile_proposal(
  '58020000-0000-4000-8000-000000000001','58030000-0000-4000-8000-000000000001','create',
  '58060000-0000-4000-8000-000000000005','58061000-0000-4000-8000-000000000005',null,0,
  '2027-01-01','2027-12-31','合成許可 004','合成發證單位','2026-12-01',null,'人工填寫有效',
  '合成日照類型','[]',
  '[{"rate_key":"58063000-0000-4000-8000-000000000010","label":"同費目","amount_decimal_text":"100.00","currency_code":"TWD","effective_from":"2027-01-01","effective_to":"2027-12-31","taxonomy_status":"manual_unstandardized"},{"rate_key":"58063000-0000-4000-8000-000000000011","label":"同費目","amount_decimal_text":"110.00","currency_code":"TWD","effective_from":"2027-06-01","effective_to":null,"taxonomy_status":"manual_unstandardized"}]',
  20,'合成人數單位','合成核定依據','合成聯絡窗口','02-0000-0000',null,'合成地址',
  '故意重疊費率','58080000-0000-4000-8000-000000000050')$$,
  '22023','organization profile proposal content is invalid',
  'same-label same-currency rate periods cannot overlap');

-- 27
select throws_ok($$select * from public.submit_organization_profile_proposal(
  '58020000-0000-4000-8000-000000000001','58030000-0000-4000-8000-000000000001','create',
  '58060000-0000-4000-8000-000000000007','58061000-0000-4000-8000-000000000007',null,0,
  '2027-01-01','2027-12-31','合成許可 007','合成發證單位','2026-12-01',null,'人工填寫有效',
  '合成日照類型','[]','[]',20,'合成人數單位','合成核定依據','合成聯絡窗口',
  '02-0000-0000','不是電子郵件','合成地址','故意錯誤聯絡信箱',
  '58080000-0000-4000-8000-000000000057')$$,
  '22023','organization profile proposal content is invalid',
  'database rejects malformed contact email instead of relying on the browser');

select set_config('request.jwt.claims','{"sub":"58010000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"58051000-0000-4000-8000-000000000001"}',true);
create temporary table page58_reject as select * from public.submit_organization_profile_proposal(
  '58020000-0000-4000-8000-000000000001','58030000-0000-4000-8000-000000000001','create',
  '58060000-0000-4000-8000-000000000006','58061000-0000-4000-8000-000000000006',null,0,
  '2028-01-01','2028-12-31','合成許可 006','合成發證單位','2027-12-01',null,'人工填寫有效',
  '合成日照類型','[]','[]',20,'合成人數單位','合成核定依據','合成聯絡窗口',
  '02-0000-0000',null,'合成地址','待駁回提案','58080000-0000-4000-8000-000000000060');
select set_config('request.jwt.claims','{"sub":"58010000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"58051000-0000-4000-8000-000000000002"}',true);

-- 28
create temporary table page58_rejection as select *
  from public.decide_organization_profile_proposal(
  '58020000-0000-4000-8000-000000000001','58030000-0000-4000-8000-000000000001',
  (select proposal_id from page58_reject),(select proposal_number from page58_reject),0,
  'reject','資料仍需人工確認','58080000-0000-4000-8000-000000000061');
select ok((select decision='reject' and proposal_status='rejected'
  and result_version_id is null and result_version is null and not replayed
  from page58_rejection),
  'rejection is immutable and creates no effective version');

-- 29
select ok((select proposals->0->>'status'='rejected' and proposal_total=5
  and pending_proposal_total=1 from public.organization_profile_snapshot(
    '58020000-0000-4000-8000-000000000001','58030000-0000-4000-8000-000000000001')),
  'proposal snapshot separates rejected and still-pending states');

-- 30
select throws_ok($$update public.organization_profile_versions set approved_capacity=99$$,
  '42501',null,'direct version update is denied');

-- 31
select throws_ok($$delete from public.organization_profile_proposals$$,
  '42501',null,'direct proposal delete is denied');

reset role;

-- 32
select ok(not exists(select 1 from public.audit_events
  where table_name like '%organization_profile%'
    and metadata::text ~ '(合成許可|合成地址|001200.00|資料仍需人工確認)'),
  'audit metadata contains no permit, contact, rate, or decision content');

-- 33
select ok(exists(select 1 from public.audit_events
  where table_name='organization_profile_snapshot'
    and metadata ? 'version_total' and metadata ? 'proposal_total')
  and not exists(select 1 from public.organization_profile_versions current_version
    join public.organization_profile_versions old_version
      on old_version.organization_id=current_version.organization_id
     and old_version.branch_id=current_version.branch_id
     and old_version.profile_key<>current_version.profile_key
     and not exists(select 1 from public.organization_profile_versions child
       where child.previous_version_id=current_version.id)
     and not exists(select 1 from public.organization_profile_versions child
       where child.previous_version_id=old_version.id)
     and daterange(current_version.effective_from,current_version.effective_to,'[]') &&
       daterange(old_version.effective_from,old_version.effective_to,'[]')),
  'audited snapshot exists and terminal effective periods do not overlap');

select * from finish();
rollback;
