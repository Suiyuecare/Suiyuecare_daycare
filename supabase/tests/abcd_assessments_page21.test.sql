begin;
select plan(54);

select results_eq(
  $$select permission_key collate "C" from public.permissions where permission_key like 'abcd_assessments.%' order by 1$$,
  $$values ('abcd_assessments.manage'::text collate "C"),('abcd_assessments.read'::text collate "C")$$,
  'page 21 exposes read and governed manage scopes');
select is((select count(*) from public.role_permissions rp join public.permissions p on p.id=rp.permission_id
  where p.permission_key like 'abcd_assessments.%'),12::bigint,
  'six conservative system roles receive two page-21 permissions');
select ok((select bool_and(relrowsecurity and relforcerowsecurity) from pg_class where oid in
  ('public.abcd_assessment_versions'::regclass,'private.abcd_assessment_operations'::regclass)),
  'assessment and operation ledgers force RLS');
select ok(not has_table_privilege('authenticated','public.abcd_assessment_versions','select,insert,update,delete')
  and not has_table_privilege('service_role','public.abcd_assessment_versions','select,insert,update,delete')
  and not has_table_privilege('authenticated','private.abcd_assessment_operations','select,insert,update,delete'),
  'browser and service roles have no direct table access');
select ok(has_function_privilege('authenticated','public.mutate_abcd_assessment(uuid,uuid,text,jsonb,uuid)','execute')
  and has_function_privilege('authenticated','public.abcd_assessment_snapshot(uuid,uuid,uuid,integer,text,text,text,text)','execute')
  and not has_function_privilege('service_role','public.mutate_abcd_assessment(uuid,uuid,text,jsonb,uuid)','execute'),
  'only authenticated callers receive public RPCs');
select ok(not (select prosecdef from pg_proc where oid='public.mutate_abcd_assessment(uuid,uuid,text,jsonb,uuid)'::regprocedure)
  and (select prosecdef and coalesce(proconfig,'{}'::text[]) @> array['search_path=""'] from pg_proc
    where oid='private.mutate_abcd_assessment_guarded(uuid,uuid,text,jsonb,uuid)'::regprocedure),
  'public wrapper is invoker and guarded core is pinned definer');
select is((select count(*) from pg_trigger where not tgisinternal and tgname in
  ('abcd_assessment_versions_append_only','abcd_assessment_operations_append_only')),2::bigint,
  'both ledgers are append-only');
select is((select count(*) from pg_trigger where not tgisinternal and tgname in
  ('abcd_assessment_versions_audit_row_change','abcd_assessment_operations_audit_row_change')),2::bigint,
  'both ledgers are audited on insert');
select ok(position('pg_advisory_xact_lock' in pg_get_functiondef(
  'private.mutate_abcd_assessment_guarded(uuid,uuid,text,jsonb,uuid)'::regprocedure))>0
  and position('abcd-assessment-identity:' in pg_get_functiondef(
  'private.mutate_abcd_assessment_guarded(uuid,uuid,text,jsonb,uuid)'::regprocedure))>0,
  'mutation serializes idempotency plus type-year identity chains');
select is((select count(*) from pg_constraint c join pg_class t on t.oid=c.conrelid
  where c.contype='f' and t.relname in ('abcd_assessment_versions','abcd_assessment_operations')
    and array_length(c.conkey,1)=1 and not exists(select 1 from pg_index i where i.indrelid=c.conrelid
      and i.indisvalid and i.indisready and c.conkey[1]=any(i.indkey))),0::bigint,
  'every single-column page-21 foreign key has a supporting index');
select ok(exists(select 1 from pg_index i join pg_attribute a
  on a.attrelid=i.indrelid and a.attnum=i.indkey[0]
  where i.indrelid='private.abcd_assessment_operations'::regclass
    and i.indisvalid and i.indisready and a.attname='result_version_id'),
  'operation result-version foreign key has a leading lookup index');
select ok(not exists(select 1 from information_schema.columns where table_schema='public'
  and table_name='abcd_assessment_versions' and column_name in
  ('score','total_score','diagnosis','risk_level','automatic_reassessment')),
  'candidate ledger contains no invented score diagnosis or automatic decision columns');

insert into auth.users(id,aud,role,email,created_at,updated_at) values
 ('21100000-1000-4000-8000-000000000001','authenticated','authenticated','manager21@example.invalid',now(),now()),
 ('21100000-1000-4000-8000-000000000002','authenticated','authenticated','worker21@example.invalid',now(),now());
insert into public.organizations(id,code,name) values
 ('21100000-2000-4000-8000-000000000001','abcd-a','ABCD 測試機構 A'),
 ('21100000-2000-4000-8000-000000000002','abcd-b','ABCD 測試機構 B');
insert into public.branches(id,organization_id,code,name) values
 ('21100000-3000-4000-8000-000000000001','21100000-2000-4000-8000-000000000001','main','A 主分支'),
 ('21100000-3000-4000-8000-000000000002','21100000-2000-4000-8000-000000000001','other','A 次分支'),
 ('21100000-3000-4000-8000-000000000003','21100000-2000-4000-8000-000000000002','main','B 主分支');
insert into public.profiles(id,display_name,kind) values
 ('21100000-1000-4000-8000-000000000001','ABCD 主管','staff'),
 ('21100000-1000-4000-8000-000000000002','ABCD 指派照服員','staff');
insert into public.memberships(id,organization_id,branch_id,profile_id,status) values
 ('21100000-4000-4000-8000-000000000001','21100000-2000-4000-8000-000000000001',null,'21100000-1000-4000-8000-000000000001','active'),
 ('21100000-4000-4000-8000-000000000002','21100000-2000-4000-8000-000000000001','21100000-3000-4000-8000-000000000001','21100000-1000-4000-8000-000000000002','active');
insert into public.membership_roles(membership_id,role_id)
select '21100000-4000-4000-8000-000000000001',id from public.roles where role_key='organization_manager' and is_system;
insert into public.membership_roles(membership_id,role_id)
select '21100000-4000-4000-8000-000000000002',id from public.roles where role_key='care_worker' and is_system;
insert into public.clients(id,organization_id,branch_id,client_code,display_name,status,admitted_on) values
 ('21100000-5000-4000-8000-000000000001','21100000-2000-4000-8000-000000000001','21100000-3000-4000-8000-000000000001','AB-1','合成個案甲','active','2025-01-01'),
 ('21100000-5000-4000-8000-000000000002','21100000-2000-4000-8000-000000000001','21100000-3000-4000-8000-000000000001','AB-2','合成個案乙','active','2025-01-01'),
 ('21100000-5000-4000-8000-000000000003','21100000-2000-4000-8000-000000000001','21100000-3000-4000-8000-000000000002','AB-3','他分支個案','active','2025-01-01');
insert into public.client_assignments(id,organization_id,branch_id,client_id,assignee_user_id,assignment_kind) values
 ('21100000-6000-4000-8000-000000000001','21100000-2000-4000-8000-000000000001','21100000-3000-4000-8000-000000000001','21100000-5000-4000-8000-000000000001','21100000-1000-4000-8000-000000000002','daily-care');

create temporary table created as select * from public.mutate_abcd_assessment(null,null,null,null,null) with no data;
create temporary table type_b (like created); create temporary table prior_year (like created);
create temporary table revised (like created); create temporary table signed (like created);
create temporary table corrected (like created);
grant select,insert on created,type_b,prior_year,revised,signed,corrected to authenticated;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"21100000-1000-4000-8000-000000000002","role":"authenticated","aal":"aal1","session_id":"21100000-7000-4000-8000-000000000099"}',true);
select throws_ok($$select * from public.abcd_assessment_snapshot(
 '21100000-2000-4000-8000-000000000001','21100000-3000-4000-8000-000000000001')$$,
 '42501','ABCD assessment snapshot is not permitted','AAL1 cannot read Page 21');
select set_config('request.jwt.claims','{"sub":"21100000-1000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"21100000-7000-4000-8000-000000000099"}',true);
select throws_ok($$select * from public.abcd_assessment_snapshot(
 '21100000-2000-4000-8000-000000000001','21100000-3000-4000-8000-000000000002')$$,
 '42501','ABCD assessment snapshot is not permitted','branch-scoped worker cannot read another branch');
select throws_ok($$select * from public.mutate_abcd_assessment(
 '21100000-2000-4000-8000-000000000001','21100000-3000-4000-8000-000000000001','save_assessment',
 jsonb_build_object('mode','create','assessment_key',null,'previous_version_id',null,'expected_version',0,'expected_content_hash',null,
 'client_id','21100000-5000-4000-8000-000000000002','assessment_type','A','assessment_year',2026,
 'assessment_date','2026-09-01','manual_summary','不得建立','result',jsonb_build_object('state','missing','text',null,'reason','尚未記錄'),
 'reassessment',jsonb_build_object('state','missing','date',null,'basis','尚未指定'),'reason','建立候選初稿'),
 '21100000-8000-4000-8000-000000000099')$$,
 '42501','ABCD assessment client or identity is not permitted','unassigned worker cannot write another client');

select set_config('request.jwt.claims','{"sub":"21100000-1000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"21100000-7000-4000-8000-000000000001"}',true);
insert into created select * from public.mutate_abcd_assessment(
 '21100000-2000-4000-8000-000000000001','21100000-3000-4000-8000-000000000001','save_assessment',
 jsonb_build_object('mode','create','assessment_key',null,'previous_version_id',null,'expected_version',0,'expected_content_hash',null,
 'client_id','21100000-5000-4000-8000-000000000001','assessment_type','A','assessment_year',2026,
 'assessment_date','2026-09-01','manual_summary','人工 A 類候選摘要，不是正式題本結果',
 'result',jsonb_build_object('state','recorded','text','人工候選結果','reason',null),
 'reassessment',jsonb_build_object('state','recorded','date','2026-12-01','basis','人工依服務檢討日指定'),
 'reason','建立候選初稿'),'21100000-8000-4000-8000-000000000001');
select ok((select organization_id='21100000-2000-4000-8000-000000000001'
  and branch_id='21100000-3000-4000-8000-000000000001'
  and client_id='21100000-5000-4000-8000-000000000001'
  and idempotency_key='21100000-8000-4000-8000-000000000001'
  and assessment_state='draft' and previous_version_id is null and source_content_hash is null
  and record_payload->>'manual_summary'='人工 A 類候選摘要，不是正式題本結果'
  and record_payload->>'form_kind'='manual_unstandardized' from created),
  'create receipt binds tenant client operation and canonical persisted payload');
reset role;
select ok((select assessment_type='A' and assessment_year=2026 and result_state='recorded'
  and result_text='人工候選結果' and result_reason is null and reassessment_date='2026-12-01'
  from public.abcd_assessment_versions where id=(select version_id from created)),
  'manual result and reassessment fields preserve exact explicit values');
select ok((select form_kind='manual_unstandardized' and formal_rule_status='not_configured'
  from public.abcd_assessment_versions where id=(select version_id from created)),
  'record is explicitly unstandardized with formal rules unconfigured');
select is((select count(*) from public.abcd_assessment_versions
  where assessment_key=(select assessment_key from created)),1::bigint,
  'one create produces one immutable version');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"21100000-1000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"21100000-7000-4000-8000-000000000001"}',true);
select is((select replayed from public.mutate_abcd_assessment(
 '21100000-2000-4000-8000-000000000001','21100000-3000-4000-8000-000000000001','save_assessment',
 jsonb_build_object('mode','create','assessment_key',null,'previous_version_id',null,'expected_version',0,'expected_content_hash',null,
 'client_id','21100000-5000-4000-8000-000000000001','assessment_type','A','assessment_year',2026,
 'assessment_date','2026-09-01','manual_summary','人工 A 類候選摘要，不是正式題本結果',
 'result',jsonb_build_object('state','recorded','text','人工候選結果','reason',null),
 'reassessment',jsonb_build_object('state','recorded','date','2026-12-01','basis','人工依服務檢討日指定'),
 'reason','建立候選初稿'),'21100000-8000-4000-8000-000000000001')),true,
 'same actor and exact request replays');
select throws_ok($$select * from public.mutate_abcd_assessment(
 '21100000-2000-4000-8000-000000000001','21100000-3000-4000-8000-000000000001','save_assessment',
 jsonb_build_object('mode','create','assessment_key',null,'previous_version_id',null,'expected_version',0,'expected_content_hash',null,
 'client_id','21100000-5000-4000-8000-000000000001','assessment_type','B','assessment_year',2026,
 'assessment_date','2026-08-01','manual_summary','不同內容','result',jsonb_build_object('state','missing','text',null,'reason','尚缺'),
 'reassessment',jsonb_build_object('state','missing','date',null,'basis','尚缺'),'reason','建立候選初稿'),
 '21100000-8000-4000-8000-000000000001')$$,
 '23505','ABCD assessment idempotency conflict','same actor key with different request is rejected');
select throws_ok($$select * from public.mutate_abcd_assessment(
 '21100000-2000-4000-8000-000000000001','21100000-3000-4000-8000-000000000001','save_assessment',
 jsonb_build_object('mode','create','assessment_key',null,'previous_version_id',null,'expected_version',0,'expected_content_hash',null,
 'client_id','21100000-5000-4000-8000-000000000001','assessment_type','A','assessment_year',2026,
 'assessment_date','2026-09-02','manual_summary','重複 A 類年度鏈','result',jsonb_build_object('state','missing','text',null,'reason','尚缺'),
 'reassessment',jsonb_build_object('state','missing','date',null,'basis','尚缺'),'reason','建立重複候選初稿'),
 '21100000-8000-4000-8000-000000000002')$$,
 '23505','ABCD assessment identity already has a chain','same client year and type cannot start a second chain');

insert into type_b select * from public.mutate_abcd_assessment(
 '21100000-2000-4000-8000-000000000001','21100000-3000-4000-8000-000000000001','save_assessment',
 jsonb_build_object('mode','create','assessment_key',null,'previous_version_id',null,'expected_version',0,'expected_content_hash',null,
 'client_id','21100000-5000-4000-8000-000000000001','assessment_type','B','assessment_year',2026,
 'assessment_date','2026-08-01','manual_summary','人工 B 類獨立摘要','result',jsonb_build_object('state','missing','text',null,'reason','等待人工結果'),
 'reassessment',jsonb_build_object('state','missing','date',null,'basis','尚未人工指定'),'reason','建立 B 類獨立初稿'),
 '21100000-8000-4000-8000-000000000003');
select is((select assessment_type from type_b),'B','different type in same year creates an independent chain');
insert into prior_year select * from public.mutate_abcd_assessment(
 '21100000-2000-4000-8000-000000000001','21100000-3000-4000-8000-000000000001','save_assessment',
 jsonb_build_object('mode','create','assessment_key',null,'previous_version_id',null,'expected_version',0,'expected_content_hash',null,
 'client_id','21100000-5000-4000-8000-000000000001','assessment_type','A','assessment_year',2025,
 'assessment_date','2025-06-01','manual_summary','2025 人工 A 類獨立摘要','result',jsonb_build_object('state','not_applicable','text',null,'reason','本次人工標記不適用'),
 'reassessment',jsonb_build_object('state','not_applicable','date',null,'basis','人工判定不適用'),'reason','建立 2025 A 類初稿'),
 '21100000-8000-4000-8000-000000000004');
select is((select assessment_year from prior_year),2025,'same type in a different year creates an independent chain');

insert into revised select * from public.mutate_abcd_assessment(
 '21100000-2000-4000-8000-000000000001','21100000-3000-4000-8000-000000000001','save_assessment',
 jsonb_build_object('mode','revise','assessment_key',(select assessment_key from created),
 'previous_version_id',(select version_id from created),'expected_version',1,'expected_content_hash',(select content_hash from created),
 'client_id','21100000-5000-4000-8000-000000000001','assessment_type','A','assessment_year',2026,
 'assessment_date','2026-09-01','manual_summary','補充後的人工 A 類候選摘要',
 'result',jsonb_build_object('state','recorded','text','人工補充候選結果','reason',null),
 'reassessment',jsonb_build_object('state','recorded','date','2026-12-01','basis','人工依服務檢討日指定'),
 'reason','補充人工摘要與結果'),'21100000-8000-4000-8000-000000000005');
select is((select version from revised),2,'draft revision advances the linear version');
reset role;
select is((select previous_version_id from public.abcd_assessment_versions where id=(select version_id from revised)),
  (select version_id from created),'draft revision links the exact prior version');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"21100000-1000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"21100000-7000-4000-8000-000000000001"}',true);
select throws_ok(format($sql$select * from public.mutate_abcd_assessment(
 '21100000-2000-4000-8000-000000000001','21100000-3000-4000-8000-000000000001','save_assessment',
 jsonb_build_object('mode','revise','assessment_key','%s','previous_version_id','%s','expected_version',2,'expected_content_hash','%s',
 'client_id','21100000-5000-4000-8000-000000000001','assessment_type','B','assessment_year',2026,
 'assessment_date','2026-09-01','manual_summary','不得換類型','result',jsonb_build_object('state','missing','text',null,'reason','尚缺'),
 'reassessment',jsonb_build_object('state','missing','date',null,'basis','尚缺'),'reason','嘗試換類型'),
 '21100000-8000-4000-8000-000000000006')$sql$,(select assessment_key from revised),(select version_id from revised),(select content_hash from revised)),
 '40001','ABCD assessment type or year cannot change','a chain cannot change from A to B');
select throws_ok(format($sql$select * from public.mutate_abcd_assessment(
 '21100000-2000-4000-8000-000000000001','21100000-3000-4000-8000-000000000001','save_assessment',
 jsonb_build_object('mode','revise','assessment_key','%s','previous_version_id','%s','expected_version',1,'expected_content_hash','%s',
 'client_id','21100000-5000-4000-8000-000000000001','assessment_type','A','assessment_year',2026,
 'assessment_date','2026-09-01','manual_summary','舊版','result',jsonb_build_object('state','missing','text',null,'reason','舊版'),
 'reassessment',jsonb_build_object('state','missing','date',null,'basis','舊版'),'reason','舊版重送'),
 '21100000-8000-4000-8000-000000000007')$sql$,(select assessment_key from created),(select version_id from created),(select content_hash from created)),
 '40001','ABCD assessment version is stale','stale expected version is rejected');
select throws_ok(format($sql$select * from public.mutate_abcd_assessment(
 '21100000-2000-4000-8000-000000000001','21100000-3000-4000-8000-000000000001','sign_assessment',
 jsonb_build_object('client_id','21100000-5000-4000-8000-000000000001','assessment_key','%s',
 'previous_version_id','%s','expected_version',2,'expected_content_hash','%s','assessment_type','A','assessment_year',2026),
 '21100000-8000-4000-8000-000000000008')$sql$,(select assessment_key from revised),(select version_id from revised),(select content_hash from revised)),
 '42501','current same-session recent AAL2 evidence is required','signing fails without recent same-session AAL2');

reset role;
insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,
 created_at,expires_at,consumed_at,consumed_jwt_iat,factor_method,factor_verified_at) values
 ('21100000-9000-4000-8000-000000000001','21100000-1000-4000-8000-000000000001','21100000-7000-4000-8000-000000000001',repeat('2',64),
 '21100000-9000-4000-8000-000000000002',clock_timestamp()-interval '2 minutes',clock_timestamp()-interval '2 minutes',
 clock_timestamp()+interval '5 minutes',clock_timestamp()-interval '30 seconds',clock_timestamp()-interval '30 seconds','totp',clock_timestamp()-interval '30 seconds');
insert into private.reauth_events(user_id,session_id,challenge_id,aal,verification_method,verified_at) values
 ('21100000-1000-4000-8000-000000000001','21100000-7000-4000-8000-000000000001','21100000-9000-4000-8000-000000000001','aal2','totp',
 (select factor_verified_at from private.reauth_challenges where id='21100000-9000-4000-8000-000000000001'));
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"21100000-1000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"21100000-7000-4000-8000-000000000001"}',true);
insert into signed select * from public.mutate_abcd_assessment(
 '21100000-2000-4000-8000-000000000001','21100000-3000-4000-8000-000000000001','sign_assessment',
 jsonb_build_object('client_id','21100000-5000-4000-8000-000000000001','assessment_key',(select assessment_key from revised),
 'previous_version_id',(select version_id from revised),'expected_version',2,'expected_content_hash',(select content_hash from revised),
 'assessment_type','A','assessment_year',2026),'21100000-8000-4000-8000-000000000008');
select ok((select assessment_state='signed'
  and previous_version_id=(select version_id from revised)
  and source_content_hash=(select content_hash from revised)
  and record_payload->>'manual_summary'='補充後的人工 A 類候選摘要' from signed),
  'recent AAL2 signs the exact prior hash and echoes the persisted payload');
reset role;
select ok((select signed_by='21100000-1000-4000-8000-000000000001'
  and signature_reauth_challenge_id='21100000-9000-4000-8000-000000000001'
  and signature_purpose='ABCD 人工候選評估簽署'
  from public.abcd_assessment_versions where id=(select version_id from signed)),
  'signed version freezes signer purpose and same-session reauth evidence');
select ok((select current.manual_summary=prior.manual_summary and current.result_text=prior.result_text
  and current.assessment_type=prior.assessment_type and current.assessment_year=prior.assessment_year
  from public.abcd_assessment_versions current join public.abcd_assessment_versions prior
    on prior.id=current.previous_version_id where current.id=(select version_id from signed)),
  'signing copies the exact manual content and identity without inference');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"21100000-1000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"21100000-7000-4000-8000-000000000001"}',true);
select throws_ok(format($sql$select * from public.mutate_abcd_assessment(
 '21100000-2000-4000-8000-000000000001','21100000-3000-4000-8000-000000000001','save_assessment',
 jsonb_build_object('mode','revise','assessment_key','%s','previous_version_id','%s','expected_version',3,'expected_content_hash','%s',
 'client_id','21100000-5000-4000-8000-000000000001','assessment_type','A','assessment_year',2026,
 'assessment_date','2026-09-01','manual_summary','不可改回草稿','result',jsonb_build_object('state','missing','text',null,'reason','不可'),
 'reassessment',jsonb_build_object('state','missing','date',null,'basis','不可'),'reason','嘗試修訂已簽紀錄'),
 '21100000-8000-4000-8000-000000000009')$sql$,(select assessment_key from signed),(select version_id from signed),(select content_hash from signed)),
 '23514','only a draft ABCD assessment can be revised','signed record cannot return to draft');
insert into corrected select * from public.mutate_abcd_assessment(
 '21100000-2000-4000-8000-000000000001','21100000-3000-4000-8000-000000000001','correct_assessment',
 jsonb_build_object('client_id','21100000-5000-4000-8000-000000000001','assessment_key',(select assessment_key from signed),
 'previous_version_id',(select version_id from signed),'expected_version',3,'expected_content_hash',(select content_hash from signed),
 'assessment_type','A','assessment_year',2026,'assessment_date','2026-09-01',
 'manual_summary','查核後更正人工 A 類候選摘要','result',jsonb_build_object('state','recorded','text','人工更正結果','reason',null),
 'reassessment',jsonb_build_object('state','recorded','date','2026-12-15','basis','人工依更正後檢討日指定'),
 'reason','查核原始紀錄後更正人工摘要'),'21100000-8000-4000-8000-000000000010');
select ok((select assessment_state='corrected'
  and previous_version_id=(select version_id from signed)
  and source_content_hash=(select content_hash from signed)
  and record_payload->>'manual_summary'='查核後更正人工 A 類候選摘要' from corrected),
  'signed content creates a corrected version bound to its prior hash and persisted payload');
reset role;
select is((select correction_reason from public.abcd_assessment_versions where id=(select version_id from corrected)),
 '查核原始紀錄後更正人工摘要','correction reason is frozen on corrected version');
select is((select count(distinct assessment_key) from public.abcd_assessment_versions
  where client_id='21100000-5000-4000-8000-000000000001'),3::bigint,
  'A-2026 B-2026 and A-2025 remain three distinct chains');
select throws_ok(format($sql$update public.abcd_assessment_versions set manual_summary='改寫' where id='%s'$sql$,(select version_id from created)),
 '55000','ABCD assessment history is append-only','committed versions cannot be updated');
select throws_ok(format($sql$delete from public.abcd_assessment_versions where id='%s'$sql$,(select version_id from created)),
 '55000','ABCD assessment history is append-only','committed versions cannot be deleted');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"21100000-1000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"21100000-7000-4000-8000-000000000001"}',true);
select ok((select assessment_total=3 and matching_total=3 and a_total=2 and b_total=1
  and c_total=0 and d_total=0 and reassessment_missing_total=1
  and draft_total=2 and signed_total=1 from public.abcd_assessment_snapshot(
  '21100000-2000-4000-8000-000000000001','21100000-3000-4000-8000-000000000001')),
  'untruncated snapshot metrics use the complete matching set');
select is((select matching_total from public.abcd_assessment_snapshot(
 '21100000-2000-4000-8000-000000000001','21100000-3000-4000-8000-000000000001',null,2026,'B')),1::bigint,
 'year and type filters have exact semantics');
select is((select matching_total from public.abcd_assessment_snapshot(
 '21100000-2000-4000-8000-000000000001','21100000-3000-4000-8000-000000000001',null,null,null,'missing')),1::bigint,
 'manual reassessment-state filter has exact semantics');
select is((select matching_total from public.abcd_assessment_snapshot(
 '21100000-2000-4000-8000-000000000001','21100000-3000-4000-8000-000000000001',null,null,null,null,null,'合成個案甲')),3::bigint,
 'query matches client display name without searching narrative');
select ok((select jsonb_array_length(item->'history')=4
  and item->'history'->0->>'assessment_state'='draft'
  and item->'history'->1->>'assessment_state'='draft'
  and item->'history'->2->>'assessment_state'='signed'
  and item->'history'->3->>'assessment_state'='corrected'
  from jsonb_array_elements((select assessments from public.abcd_assessment_snapshot(
    '21100000-2000-4000-8000-000000000001','21100000-3000-4000-8000-000000000001'))) item
  where item->>'assessment_key'=(select assessment_key::text from corrected)),
  'snapshot returns complete linear history in version order');
select ok((select item ?& array['version_id','assessment_key','version','previous_version_id','content_hash',
  'assessment_state','client_id','client_display_name','assessment_type','assessment_year','assessment_date',
  'manual_summary','result_state','result_text','result_reason','reassessment_state','reassessment_date',
  'reassessment_basis','author_user_id','author_display_name','revision_reason','correction_reason',
  'signed_at','signed_by_user_id','signer_display_name','signer_role_keys','signature_purpose',
  'signature_reauth_challenge_id','form_kind','formal_rule_status','created_at','history','history_total']
  from jsonb_array_elements((select assessments from public.abcd_assessment_snapshot(
    '21100000-2000-4000-8000-000000000001','21100000-3000-4000-8000-000000000001'))) item limit 1),
  'real SQL snapshot exposes the strict TypeScript field contract');
select ok((select form_kind='manual_unstandardized' and formal_rule_status='not_configured'
  and attachment_status='not_configured' and notification_status='not_configured'
  and export_status='not_configured' and offline_status='not_configured'
  from public.abcd_assessment_snapshot('21100000-2000-4000-8000-000000000001','21100000-3000-4000-8000-000000000001')),
  'formal rules and all unsupported channels are explicitly unconfigured');
select throws_ok($$select * from public.abcd_assessment_snapshot(
 '21100000-2000-4000-8000-000000000001','21100000-3000-4000-8000-000000000001',null,null,'A',null,null,'x','extra')$$,
 '42883',null,'RPC signature rejects undeclared filter arguments');

reset role;
select ok(not exists(select 1 from public.audit_events where table_name='abcd_assessment_versions'
  and (metadata::text like '%人工候選結果%' or metadata::text like '%查核後更正%' or metadata ? 'query')),
  'audit metadata contains no summary result reason or query value');
select ok(exists(select 1 from public.audit_events where table_name='abcd_assessment_versions'
  and action='select' and metadata->>'narrative_logged'='false' and metadata->>'filters_logged'='false'),
  'snapshot reads leave explicit no-narrative audit evidence');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"21100000-1000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"21100000-7000-4000-8000-000000000001"}',true);
select throws_ok($$select * from public.abcd_assessment_snapshot(
 '21100000-2000-4000-8000-000000000002','21100000-3000-4000-8000-000000000003')$$,
 '42501','ABCD assessment snapshot is not permitted','cross-tenant snapshot is denied');
select throws_ok($$select * from public.mutate_abcd_assessment(
 '21100000-2000-4000-8000-000000000001','21100000-3000-4000-8000-000000000001','save_assessment',
 jsonb_build_object('mode','create','assessment_key',null,'previous_version_id',null,'expected_version',0,'expected_content_hash',null,
 'client_id','21100000-5000-4000-8000-000000000001','assessment_type','C','assessment_year',2026,
 'assessment_date','2026-07-01','manual_summary','多餘欄位','result',jsonb_build_object('state','missing','text',null,'reason','尚缺'),
 'reassessment',jsonb_build_object('state','missing','date',null,'basis','尚缺'),'reason','多餘欄位測試','score',99),
 '21100000-8000-4000-8000-000000000011')$$,
 '22023','ABCD draft payload shape is invalid','invented score field is rejected by strict payload shape');
select throws_ok($$select * from public.mutate_abcd_assessment(
 '21100000-2000-4000-8000-000000000001','21100000-3000-4000-8000-000000000001','save_assessment',
 jsonb_build_object('mode','create','assessment_key',null,'previous_version_id',null,'expected_version',0,'expected_content_hash',null,
 'client_id','21100000-5000-4000-8000-000000000001','assessment_type','C','assessment_year',2026,
 'assessment_date','2026-07-01','manual_summary','非法三態','result',jsonb_build_object('state','recorded','text',null,'reason',null),
 'reassessment',jsonb_build_object('state','recorded','date',null,'basis','非法日期'),'reason','非法三態測試'),
 '21100000-8000-4000-8000-000000000012')$$,
 '22023','ABCD manual candidate fields are invalid','invalid result and reassessment combinations fail closed');

reset role;
insert into public.abcd_assessment_versions(organization_id,branch_id,client_id,assessment_key,version,
 content_hash,assessment_state,assessment_type,assessment_year,assessment_date,manual_summary,
 result_state,result_text,result_reason,reassessment_state,reassessment_date,reassessment_basis,
 author_user_id,author_display_name,revision_reason)
select '21100000-2000-4000-8000-000000000001','21100000-3000-4000-8000-000000000001',
 '21100000-5000-4000-8000-000000000001',gen_random_uuid(),1,
 encode(sha256(convert_to((year_value::text||type_value),'UTF8')),'hex'),'draft',type_value,year_value,
 make_date(year_value,1,1),'批次合成人工候選摘要','missing',null,'批次缺值理由',
 'missing',null,'批次尚未人工指定','21100000-1000-4000-8000-000000000001','ABCD 主管','截斷測試'
from (select year_value,type_value from generate_series(2000,2050) year_value
  cross join (values('A'),('B'),('C'),('D')) type(type_value)
  where not (year_value=2025 and type_value='A') and not (year_value=2026 and type_value in ('A','B'))
  order by year_value,type_value limit 201) source;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"21100000-1000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"21100000-7000-4000-8000-000000000001"}',true);
select ok((select assessments_truncated and jsonb_array_length(assessments)=200
  and matching_total=204 and assessment_total=204 from public.abcd_assessment_snapshot(
  '21100000-2000-4000-8000-000000000001','21100000-3000-4000-8000-000000000001')),
  '200-row display truncation preserves complete-set totals');
select is((select (assessments->0->>'assessment_key')::uuid from public.abcd_assessment_snapshot(
 '21100000-2000-4000-8000-000000000001','21100000-3000-4000-8000-000000000001',null,2026)),
 (select assessment_key from corrected),'snapshot orders by manual assessment date before creation time');
select ok(position('client.display_name ilike' in replace(pg_get_functiondef(
 'private.abcd_assessment_snapshot_response(uuid,uuid,uuid,integer,text,text,text,text)'::regprocedure),E'\n',' '))>0
  and position('manual_summary ilike' in replace(pg_get_functiondef(
 'private.abcd_assessment_snapshot_response(uuid,uuid,uuid,integer,text,text,text,text)'::regprocedure),E'\n',' '))=0,
  'query searches client identity but never candidate narrative');

select * from finish();
rollback;
