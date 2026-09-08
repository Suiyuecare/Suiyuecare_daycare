begin;
select plan(45);

select results_eq(
  $$select permission_key collate "C" from public.permissions where permission_key like 'behavior_events.%' order by 1$$,
  $$values ('behavior_events.manage'::text collate "C"),('behavior_events.read'::text collate "C"),('behavior_events.sign'::text collate "C")$$,
  'page 20 exposes separate read, manage and sign scopes');
select is((select count(*) from public.role_permissions rp join public.permissions p on p.id=rp.permission_id
  where p.permission_key like 'behavior_events.%'),18::bigint,'six conservative system roles receive three page-20 permissions');
select ok((select bool_and(relrowsecurity and relforcerowsecurity) from pg_class where oid in
  ('public.behavior_event_versions'::regclass,'private.behavior_event_operations'::regclass)),
  'event and operation ledgers force RLS');
select ok(not has_table_privilege('authenticated','public.behavior_event_versions','select,insert,update,delete')
  and not has_table_privilege('service_role','public.behavior_event_versions','select,insert,update,delete')
  and not has_table_privilege('authenticated','private.behavior_event_operations','select,insert,update,delete'),
  'browser and service roles have no direct table access');
select ok(has_function_privilege('authenticated','public.mutate_behavior_event(uuid,uuid,text,jsonb,uuid)','execute')
  and has_function_privilege('authenticated','public.behavior_event_snapshot(uuid,uuid,date,date,uuid,text,text)','execute')
  and not has_function_privilege('service_role','public.mutate_behavior_event(uuid,uuid,text,jsonb,uuid)','execute'),
  'only authenticated callers receive public RPCs');
select ok(not (select prosecdef from pg_proc where oid='public.mutate_behavior_event(uuid,uuid,text,jsonb,uuid)'::regprocedure)
  and (select prosecdef and coalesce(proconfig,'{}'::text[]) @> array['search_path=""'] from pg_proc
    where oid='private.mutate_behavior_event_guarded(uuid,uuid,text,jsonb,uuid)'::regprocedure),
  'public wrapper is invoker and enforcing core is pinned definer');
select is((select count(*) from pg_trigger where not tgisinternal and tgname in
  ('behavior_event_versions_append_only','behavior_event_operations_append_only')),2::bigint,
  'both ledgers are append-only');
select is((select count(*) from pg_trigger where not tgisinternal and tgname in
  ('behavior_event_versions_audit_row_change','behavior_event_operations_audit_row_change')),2::bigint,
  'both ledgers are audited on insert');
select ok(position('pg_advisory_xact_lock' in pg_get_functiondef(
  'private.mutate_behavior_event_guarded(uuid,uuid,text,jsonb,uuid)'::regprocedure))>0
  and position('previous_version_id' in pg_get_functiondef(
  'private.mutate_behavior_event_guarded(uuid,uuid,text,jsonb,uuid)'::regprocedure))>0,
  'mutation serializes idempotency and linear version chains');
select is((select count(*) from pg_constraint c join pg_class t on t.oid=c.conrelid
  where c.contype='f' and t.relname in ('behavior_event_versions','behavior_event_operations')
    and array_length(c.conkey,1)=1 and not exists(select 1 from pg_index i where i.indrelid=c.conrelid
      and i.indisvalid and i.indisready and c.conkey[1]=any(i.indkey))),0::bigint,
  'every single-column page-20 foreign key has a supporting index');
select ok(exists(select 1 from pg_index i join pg_attribute a
  on a.attrelid=i.indrelid and a.attnum=i.indkey[0]
  where i.indrelid='private.behavior_event_operations'::regclass
    and i.indisvalid and i.indisready and a.attname='result_version_id'),
  'operation result-version foreign key has a leading lookup index');

insert into auth.users(id,aud,role,email,created_at,updated_at) values
 ('20000000-1000-4000-8000-000000000001','authenticated','authenticated','manager20@example.invalid',now(),now()),
 ('20000000-1000-4000-8000-000000000002','authenticated','authenticated','worker20@example.invalid',now(),now()),
 ('20000000-1000-4000-8000-000000000003','authenticated','authenticated','outsider20@example.invalid',now(),now());
insert into public.organizations(id,code,name) values
 ('20000000-2000-4000-8000-000000000001','behavior-a','行為測試機構 A'),
 ('20000000-2000-4000-8000-000000000002','behavior-b','行為測試機構 B');
insert into public.branches(id,organization_id,code,name) values
 ('20000000-3000-4000-8000-000000000001','20000000-2000-4000-8000-000000000001','main','A 主分支'),
 ('20000000-3000-4000-8000-000000000002','20000000-2000-4000-8000-000000000001','other','A 次分支'),
 ('20000000-3000-4000-8000-000000000003','20000000-2000-4000-8000-000000000002','main','B 主分支');
insert into public.profiles(id,display_name,kind) values
 ('20000000-1000-4000-8000-000000000001','行為主管','staff'),
 ('20000000-1000-4000-8000-000000000002','指派照服員','staff'),
 ('20000000-1000-4000-8000-000000000003','未指派照服員','staff');
insert into public.memberships(id,organization_id,branch_id,profile_id,status) values
 ('20000000-4000-4000-8000-000000000001','20000000-2000-4000-8000-000000000001',null,'20000000-1000-4000-8000-000000000001','active'),
 ('20000000-4000-4000-8000-000000000002','20000000-2000-4000-8000-000000000001','20000000-3000-4000-8000-000000000001','20000000-1000-4000-8000-000000000002','active'),
 ('20000000-4000-4000-8000-000000000003','20000000-2000-4000-8000-000000000001','20000000-3000-4000-8000-000000000001','20000000-1000-4000-8000-000000000003','active');
insert into public.membership_roles(membership_id,role_id)
select '20000000-4000-4000-8000-000000000001',id from public.roles where role_key='organization_manager' and is_system;
insert into public.membership_roles(membership_id,role_id)
select '20000000-4000-4000-8000-000000000002',id from public.roles where role_key='care_worker' and is_system;
insert into public.membership_roles(membership_id,role_id)
select '20000000-4000-4000-8000-000000000003',id from public.roles where role_key='care_worker' and is_system;
insert into public.clients(id,organization_id,branch_id,client_code,display_name,status,admitted_on) values
 ('20000000-5000-4000-8000-000000000001','20000000-2000-4000-8000-000000000001','20000000-3000-4000-8000-000000000001','BE-1','合成個案甲','active',current_date-90),
 ('20000000-5000-4000-8000-000000000002','20000000-2000-4000-8000-000000000001','20000000-3000-4000-8000-000000000001','BE-2','合成個案乙','active',current_date-90),
 ('20000000-5000-4000-8000-000000000003','20000000-2000-4000-8000-000000000001','20000000-3000-4000-8000-000000000002','BE-3','他分支個案','active',current_date-90);
insert into public.client_assignments(id,organization_id,branch_id,client_id,assignee_user_id,assignment_kind) values
 ('20000000-6000-4000-8000-000000000001','20000000-2000-4000-8000-000000000001','20000000-3000-4000-8000-000000000001','20000000-5000-4000-8000-000000000001','20000000-1000-4000-8000-000000000002','daily-care');

create temporary table created as select * from public.mutate_behavior_event(null,null,null,null,null) with no data;
create temporary table revised (like created); create temporary table signed (like created);
create temporary table corrected (like created); create temporary table void_created (like created);
create temporary table void_signed (like created); create temporary table voided (like created);
create temporary table older (like created);
create temporary table behavior_times as select clock_timestamp()-interval '2 hours' as first_occurred_at;
grant select,insert on created,revised,signed,corrected,void_created,void_signed,voided,older to authenticated;
grant select on behavior_times to authenticated;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"20000000-1000-4000-8000-000000000002","role":"authenticated","aal":"aal1","session_id":"20000000-7000-4000-8000-000000000099"}',true);
select throws_ok($$select * from public.behavior_event_snapshot('20000000-2000-4000-8000-000000000001','20000000-3000-4000-8000-000000000001')$$,
 '42501','behavior-event snapshot is not permitted','AAL1 cannot read Page 20');
select set_config('request.jwt.claims','{"sub":"20000000-1000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"20000000-7000-4000-8000-000000000099"}',true);
select throws_ok($$select * from public.behavior_event_snapshot('20000000-2000-4000-8000-000000000001','20000000-3000-4000-8000-000000000002')$$,
 '42501','behavior-event snapshot is not permitted','branch-scoped worker cannot read another branch');
select throws_ok($$select * from public.mutate_behavior_event('20000000-2000-4000-8000-000000000001','20000000-3000-4000-8000-000000000001','save_event',
 jsonb_build_object('mode','create','event_key',null,'previous_version_id',null,'expected_version',0,'expected_content_hash',null,
 'client_id','20000000-5000-4000-8000-000000000002','occurred_at',clock_timestamp()-interval '2 hours','event_type','活動參與',
 'antecedent',jsonb_build_object('state','missing','text',null),'behavior',jsonb_build_object('state','recorded','text','不得建立'),
 'intervention',jsonb_build_object('state','not_applicable','text',null),'outcome',jsonb_build_object('state','missing','text',null),'reason','建立事件初稿'),
 '20000000-8000-4000-8000-000000000099')$$,'42501','behavior-event client is not permitted','unassigned worker cannot write another client');

select set_config('request.jwt.claims','{"sub":"20000000-1000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"20000000-7000-4000-8000-000000000001"}',true);
insert into created select * from public.mutate_behavior_event(
 '20000000-2000-4000-8000-000000000001','20000000-3000-4000-8000-000000000001','save_event',
 jsonb_build_object('mode','create','event_key',null,'previous_version_id',null,'expected_version',0,'expected_content_hash',null,
 'client_id','20000000-5000-4000-8000-000000000001','occurred_at',(select first_occurred_at from behavior_times),'event_type','活動參與',
 'antecedent',jsonb_build_object('state','missing','text',null),'behavior',jsonb_build_object('state','recorded','text','個案提高音量並離開座位'),
 'intervention',jsonb_build_object('state','recorded','text','工作人員人工詢問意願並提供安靜座位'),
 'outcome',jsonb_build_object('state','not_applicable','text',null),'reason','建立事件初稿'),
 '20000000-8000-4000-8000-000000000001');
select is((select event_state from created),'draft','create returns a draft receipt');
reset role;
select ok((select antecedent_state='missing' and antecedent_text is null and behavior_state='recorded'
  and behavior_text='個案提高音量並離開座位' and outcome_state='not_applicable' and outcome_text is null
  from public.behavior_event_versions where id=(select version_id from created)),
  'four fields preserve explicit states and recorded text without inference');
select is((select count(*) from public.behavior_event_versions where event_key=(select event_key from created)),1::bigint,
  'one create produces one immutable version');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"20000000-1000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"20000000-7000-4000-8000-000000000001"}',true);
select is((select replayed from public.mutate_behavior_event(
 '20000000-2000-4000-8000-000000000001','20000000-3000-4000-8000-000000000001','save_event',
 jsonb_build_object('mode','create','event_key',null,'previous_version_id',null,'expected_version',0,'expected_content_hash',null,
 'client_id','20000000-5000-4000-8000-000000000001','occurred_at',(select first_occurred_at from behavior_times),
 'event_type','活動參與','antecedent',jsonb_build_object('state','missing','text',null),'behavior',jsonb_build_object('state','recorded','text','個案提高音量並離開座位'),
 'intervention',jsonb_build_object('state','recorded','text','工作人員人工詢問意願並提供安靜座位'),'outcome',jsonb_build_object('state','not_applicable','text',null),'reason','建立事件初稿'),
 '20000000-8000-4000-8000-000000000001')),true,'same actor and exact request replays');
select throws_ok($$select * from public.mutate_behavior_event(
 '20000000-2000-4000-8000-000000000001','20000000-3000-4000-8000-000000000001','save_event',
 jsonb_build_object('mode','create','event_key',null,'previous_version_id',null,'expected_version',0,'expected_content_hash',null,
 'client_id','20000000-5000-4000-8000-000000000001','occurred_at',clock_timestamp()-interval '2 hours','event_type','不同內容',
 'antecedent',jsonb_build_object('state','missing','text',null),'behavior',jsonb_build_object('state','recorded','text','不同內容'),
 'intervention',jsonb_build_object('state','missing','text',null),'outcome',jsonb_build_object('state','missing','text',null),'reason','建立事件初稿'),
 '20000000-8000-4000-8000-000000000001')$$,'23505','behavior-event idempotency conflict','same actor key with different request is rejected');

insert into revised select * from public.mutate_behavior_event(
 '20000000-2000-4000-8000-000000000001','20000000-3000-4000-8000-000000000001','save_event',
 jsonb_build_object('mode','revise','event_key',(select event_key from created),'previous_version_id',(select version_id from created),
 'expected_version',1,'expected_content_hash',(select content_hash from created),'client_id','20000000-5000-4000-8000-000000000001',
 'occurred_at',clock_timestamp()-interval '1 hour','event_type','活動參與','antecedent',jsonb_build_object('state','recorded','text','團體活動開始'),
 'behavior',jsonb_build_object('state','recorded','text','個案提高音量並離開座位'),'intervention',jsonb_build_object('state','recorded','text','人工詢問意願'),
 'outcome',jsonb_build_object('state','recorded','text','十分鐘後自行返回'),'reason','補齊實際發生時間與人工結果'),
 '20000000-8000-4000-8000-000000000002');
select is((select version from revised),2,'draft revision advances the linear version');
reset role;
select is((select previous_version_id from public.behavior_event_versions where id=(select version_id from revised)),
  (select version_id from created),'draft revision links the exact prior version');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"20000000-1000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"20000000-7000-4000-8000-000000000001"}',true);
select throws_ok(format($sql$select * from public.mutate_behavior_event(
 '20000000-2000-4000-8000-000000000001','20000000-3000-4000-8000-000000000001','save_event',
 jsonb_build_object('mode','revise','event_key','%s','previous_version_id','%s','expected_version',1,'expected_content_hash','%s',
 'client_id','20000000-5000-4000-8000-000000000001','occurred_at',clock_timestamp()-interval '1 hour','event_type','活動參與',
 'antecedent',jsonb_build_object('state','missing','text',null),'behavior',jsonb_build_object('state','recorded','text','舊版'),
 'intervention',jsonb_build_object('state','missing','text',null),'outcome',jsonb_build_object('state','missing','text',null),'reason','舊版重送'),
 '20000000-8000-4000-8000-000000000003')$sql$,(select event_key from created),(select version_id from created),(select content_hash from created)),
 '40001','behavior-event version is stale','stale expected version is rejected');
select throws_ok(format($sql$select * from public.mutate_behavior_event(
 '20000000-2000-4000-8000-000000000001','20000000-3000-4000-8000-000000000001','finalize_event',
 jsonb_build_object('decision','sign','client_id','20000000-5000-4000-8000-000000000001','event_key','%s',
 'previous_version_id','%s','expected_version',2,'expected_content_hash','%s','reason',null),
 '20000000-8000-4000-8000-000000000004')$sql$,(select event_key from revised),(select version_id from revised),(select content_hash from revised)),
 '42501','current same-session recent AAL2 evidence is required','signing fails without recent same-session AAL2');

reset role;
insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,
 created_at,expires_at,consumed_at,consumed_jwt_iat,factor_method,factor_verified_at) values
 ('20000000-9000-4000-8000-000000000001','20000000-1000-4000-8000-000000000001','20000000-7000-4000-8000-000000000001',repeat('2',64),
 '20000000-9000-4000-8000-000000000002',clock_timestamp()-interval '2 minutes',clock_timestamp()-interval '2 minutes',
 clock_timestamp()+interval '5 minutes',clock_timestamp()-interval '30 seconds',clock_timestamp()-interval '30 seconds','totp',clock_timestamp()-interval '30 seconds');
insert into private.reauth_events(user_id,session_id,challenge_id,aal,verification_method,verified_at) values
 ('20000000-1000-4000-8000-000000000001','20000000-7000-4000-8000-000000000001','20000000-9000-4000-8000-000000000001','aal2','totp',
 (select factor_verified_at from private.reauth_challenges where id='20000000-9000-4000-8000-000000000001'));
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"20000000-1000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"20000000-7000-4000-8000-000000000001"}',true);
insert into signed select * from public.mutate_behavior_event(
 '20000000-2000-4000-8000-000000000001','20000000-3000-4000-8000-000000000001','finalize_event',
 jsonb_build_object('decision','sign','client_id','20000000-5000-4000-8000-000000000001','event_key',(select event_key from revised),
 'previous_version_id',(select version_id from revised),'expected_version',2,'expected_content_hash',(select content_hash from revised),'reason',null),
 '20000000-8000-4000-8000-000000000004');
select is((select event_state from signed),'signed','recent AAL2 signs the exact draft as a new version');
reset role;
select ok((select signed_by='20000000-1000-4000-8000-000000000001' and signature_reauth_challenge_id='20000000-9000-4000-8000-000000000001'
  and signature_purpose='行為與情緒事件簽署' from public.behavior_event_versions where id=(select version_id from signed)),
  'signed version freezes signer, purpose and same-session reauth evidence');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"20000000-1000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"20000000-7000-4000-8000-000000000001"}',true);
insert into corrected select * from public.mutate_behavior_event(
 '20000000-2000-4000-8000-000000000001','20000000-3000-4000-8000-000000000001','correct_event',
 jsonb_build_object('client_id','20000000-5000-4000-8000-000000000001','event_key',(select event_key from signed),
 'previous_version_id',(select version_id from signed),'expected_version',3,'expected_content_hash',(select content_hash from signed),
 'occurred_at',clock_timestamp()-interval '70 minutes','event_type','活動參與','antecedent',jsonb_build_object('state','recorded','text','團體活動開始前'),
 'behavior',jsonb_build_object('state','recorded','text','個案提高音量並離開座位'),'intervention',jsonb_build_object('state','recorded','text','人工詢問意願'),
 'outcome',jsonb_build_object('state','recorded','text','十分鐘後自行返回'),'reason','查核紙本後修正實際發生時間'),
 '20000000-8000-4000-8000-000000000005');
select is((select event_state from corrected),'corrected','signed content creates a corrected version');
reset role;
select is((select correction_reason from public.behavior_event_versions where id=(select version_id from corrected)),
 '查核紙本後修正實際發生時間','correction reason is frozen on the corrected version');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"20000000-1000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"20000000-7000-4000-8000-000000000001"}',true);

insert into void_created select * from public.mutate_behavior_event(
 '20000000-2000-4000-8000-000000000001','20000000-3000-4000-8000-000000000001','save_event',
 jsonb_build_object('mode','create','event_key',null,'previous_version_id',null,'expected_version',0,'expected_content_hash',null,
 'client_id','20000000-5000-4000-8000-000000000001','occurred_at',clock_timestamp()-interval '4 hours','event_type','休息時段',
 'antecedent',jsonb_build_object('state','not_applicable','text',null),'behavior',jsonb_build_object('state','recorded','text','原紀錄選錯個案'),
 'intervention',jsonb_build_object('state','not_applicable','text',null),'outcome',jsonb_build_object('state','not_applicable','text',null),'reason','建立待作廢測試草稿'),
 '20000000-8000-4000-8000-000000000006');
insert into void_signed select * from public.mutate_behavior_event(
 '20000000-2000-4000-8000-000000000001','20000000-3000-4000-8000-000000000001','finalize_event',
 jsonb_build_object('decision','sign','client_id','20000000-5000-4000-8000-000000000001','event_key',(select event_key from void_created),
 'previous_version_id',(select version_id from void_created),'expected_version',1,'expected_content_hash',(select content_hash from void_created),'reason',null),
 '20000000-8000-4000-8000-000000000007');
insert into voided select * from public.mutate_behavior_event(
 '20000000-2000-4000-8000-000000000001','20000000-3000-4000-8000-000000000001','finalize_event',
 jsonb_build_object('decision','void','client_id','20000000-5000-4000-8000-000000000001','event_key',(select event_key from void_signed),
 'previous_version_id',(select version_id from void_signed),'expected_version',2,'expected_content_hash',(select content_hash from void_signed),
 'reason','確認原紀錄選取錯誤個案，依法定程序作廢'),
 '20000000-8000-4000-8000-000000000008');
select is((select event_state from voided),'voided','a signed event can be necessarily voided');
reset role;
select is((select void_reason from public.behavior_event_versions where id=(select version_id from voided)),
 '確認原紀錄選取錯誤個案，依法定程序作廢','void reason is frozen');
select throws_ok(format($sql$update public.behavior_event_versions set event_type='改寫' where id='%s'$sql$,(select version_id from created)),
 '55000','behavior-event history is append-only','committed versions cannot be updated');
select throws_ok(format($sql$delete from public.behavior_event_versions where id='%s'$sql$,(select version_id from created)),
 '55000','behavior-event history is append-only','committed versions cannot be deleted');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"20000000-1000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"20000000-7000-4000-8000-000000000001"}',true);
select throws_ok(format($sql$select * from public.mutate_behavior_event(
 '20000000-2000-4000-8000-000000000001','20000000-3000-4000-8000-000000000001','save_event',
 jsonb_build_object('mode','revise','event_key','%s','previous_version_id','%s','expected_version',3,'expected_content_hash','%s',
 'client_id','20000000-5000-4000-8000-000000000001','occurred_at',clock_timestamp()-interval '4 hours','event_type','休息時段',
 'antecedent',jsonb_build_object('state','missing','text',null),'behavior',jsonb_build_object('state','recorded','text','不可修訂'),
 'intervention',jsonb_build_object('state','missing','text',null),'outcome',jsonb_build_object('state','missing','text',null),'reason','嘗試修訂作廢紀錄'),
 '20000000-8000-4000-8000-000000000009')$sql$,(select event_key from voided),(select version_id from voided),(select content_hash from voided)),
 '23514','only a draft behavior event can be revised','voided events cannot return to draft');

insert into older select * from public.mutate_behavior_event(
 '20000000-2000-4000-8000-000000000001','20000000-3000-4000-8000-000000000001','save_event',
 jsonb_build_object('mode','create','event_key',null,'previous_version_id',null,'expected_version',0,'expected_content_hash',null,
 'client_id','20000000-5000-4000-8000-000000000001','occurred_at',clock_timestamp()-interval '8 hours','event_type','到站適應',
 'antecedent',jsonb_build_object('state','missing','text',null),'behavior',jsonb_build_object('state','recorded','text','個案於入口停留'),
 'intervention',jsonb_build_object('state','missing','text',null),'outcome',jsonb_build_object('state','missing','text',null),'reason','建立較晚輸入的較早事件'),
 '20000000-8000-4000-8000-000000000010');
select is((select (events->0->>'event_key')::uuid from public.behavior_event_snapshot(
 '20000000-2000-4000-8000-000000000001','20000000-3000-4000-8000-000000000001')),
 (select event_key from corrected),'snapshot orders by occurred_at rather than later created_at');
select ok((select event_total=3 and matching_total=3 and draft_total=1 and signed_total=1 and voided_total=1
  and missing_field_total=1 from public.behavior_event_snapshot(
 '20000000-2000-4000-8000-000000000001','20000000-3000-4000-8000-000000000001')),
 'untruncated snapshot metrics use the complete matching set');
select is((select matching_total from public.behavior_event_snapshot(
 '20000000-2000-4000-8000-000000000001','20000000-3000-4000-8000-000000000001',null,null,null,'休息時段',null)),1::bigint,
 'event-type filter has exact semantics');
select is((select jsonb_array_length(events) from public.behavior_event_snapshot(
 '20000000-2000-4000-8000-000000000001','20000000-3000-4000-8000-000000000001',null,null,null,null,'voided')),1,
 'state filter returns only matching current versions');
select ok((select jsonb_array_length(item->'history')=4
  and item->'history'->0->>'event_state'='draft'
  and item->'history'->1->>'event_state'='draft'
  and item->'history'->2->>'event_state'='signed'
  and item->'history'->3->>'event_state'='corrected'
  from jsonb_array_elements((select events from public.behavior_event_snapshot(
    '20000000-2000-4000-8000-000000000001','20000000-3000-4000-8000-000000000001'))) item
  where item->>'event_key'=(select event_key::text from corrected)),
  'snapshot returns the complete linear event history in version order');

reset role;
insert into public.behavior_event_versions(organization_id,branch_id,client_id,event_key,version,content_hash,event_state,
 occurred_at,event_type,antecedent_state,antecedent_text,behavior_state,behavior_text,intervention_state,intervention_text,
 outcome_state,outcome_text,author_user_id,author_display_name,revision_reason,created_at)
select '20000000-2000-4000-8000-000000000001','20000000-3000-4000-8000-000000000001',
 '20000000-5000-4000-8000-000000000001',gen_random_uuid(),1,encode(sha256(convert_to(gs::text,'UTF8')),'hex'),'draft',
 clock_timestamp()-interval '2 days'-(gs||' minutes')::interval,'批次合成事件','missing',null,'recorded','合成行為',
 'not_applicable',null,'missing',null,'20000000-1000-4000-8000-000000000001','行為主管','七年資料量截斷測試',clock_timestamp()
from generate_series(1,201) gs;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"20000000-1000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"20000000-7000-4000-8000-000000000001"}',true);
select ok((select events_truncated and jsonb_array_length(events)=200 and matching_total=204 and event_total=204
  from public.behavior_event_snapshot('20000000-2000-4000-8000-000000000001','20000000-3000-4000-8000-000000000001')),
  '200-row display truncation preserves full-set totals');
select is((select matching_total from public.behavior_event_snapshot(
 '20000000-2000-4000-8000-000000000001','20000000-3000-4000-8000-000000000001',
 ((clock_timestamp() at time zone 'Asia/Taipei')::date-1),
 (clock_timestamp() at time zone 'Asia/Taipei')::date,null,null,null)),3::bigint,
 'Taipei inclusive date filtering excludes older bulk records');
select ok((select attachment_status='not_configured' and notification_status='not_configured'
  and export_status='not_configured' and offline_status='not_configured'
  from public.behavior_event_snapshot('20000000-2000-4000-8000-000000000001','20000000-3000-4000-8000-000000000001')),
  'attachments, notifications, export and offline remain explicitly unconfigured');
reset role;
select ok(not exists(select 1 from public.audit_events where table_name='behavior_event_versions'
  and (metadata::text like '%個案提高音量%' or metadata::text like '%工作人員人工詢問%' or metadata ? 'filters')),
  'audit metadata contains no narrative or filter values');
select ok(exists(select 1 from public.audit_events where table_name='behavior_event_versions'
  and action='select' and metadata->>'narrative_logged'='false' and metadata->>'filters_logged'='false'),
  'snapshot reads leave explicit no-narrative audit evidence');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"20000000-1000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"20000000-7000-4000-8000-000000000001"}',true);
select throws_ok($$select * from public.behavior_event_snapshot(
 '20000000-2000-4000-8000-000000000002','20000000-3000-4000-8000-000000000003')$$,
 '42501','behavior-event snapshot is not permitted','cross-tenant snapshot is denied');
reset role;
select is((select count(distinct event_key) from public.behavior_event_versions where organization_id='20000000-2000-4000-8000-000000000001'),204::bigint,
  'every event remains independently keyed');
select ok(position('order by row.occurred_at desc,row.event_key' in replace(pg_get_functiondef(
 'private.behavior_event_snapshot_response(uuid,uuid,date,date,uuid,text,text)'::regprocedure),E'\n',' '))>0,
  'database snapshot contract explicitly orders by occurred_at');

select * from finish();
rollback;
