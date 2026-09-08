begin;
set local time zone 'Asia/Taipei';
select plan(46);
select ok((select bool_and(relrowsecurity and relforcerowsecurity) from pg_class where oid in ('public.data_inventory_versions'::regclass,'private.data_inventory_operations'::regclass)),'inventory streams force RLS');
select ok(not has_table_privilege('authenticated','public.data_inventory_versions','select,insert,update,delete') and not has_table_privilege('service_role','private.data_inventory_operations','select,insert,update,delete'),'no direct table access');
select ok(not has_function_privilege('anon','public.mutate_data_inventory(uuid,uuid,jsonb,uuid)','execute') and has_function_privilege('authenticated','public.mutate_data_inventory(uuid,uuid,jsonb,uuid)','execute'),'only authenticated gets RPC');
insert into auth.users(id) values('83000000-0000-4000-8000-000000001001'),('83000000-0000-4000-8000-000000001002'),('83000000-0000-4000-8000-000000001003');
insert into public.organizations(id,code,name) values('83100000-0000-4000-8000-000000000001','inventory-a','合成盤點機構'),('83100000-0000-4000-8000-000000000002','inventory-b','合成其他機構');
insert into public.branches(id,organization_id,code,name) values
 ('83200000-0000-4000-8000-000000000001','83100000-0000-4000-8000-000000000001','main','合成分支甲'),
 ('83200000-0000-4000-8000-000000000002','83100000-0000-4000-8000-000000000001','other','合成分支乙'),
 ('83200000-0000-4000-8000-000000000003','83100000-0000-4000-8000-000000000002','main','他機構分支');
insert into public.profiles(id,display_name,kind) values
 ('83000000-0000-4000-8000-000000001001','合成盤點主管甲','staff'),('83000000-0000-4000-8000-000000001002','合成覆核主管乙','staff'),('83000000-0000-4000-8000-000000001003','合成家屬','family');
insert into public.memberships(id,organization_id,branch_id,profile_id,status,starts_at) values
 ('83300000-0000-4000-8000-000000000001','83100000-0000-4000-8000-000000000001','83200000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000001001','active',now()-interval '1 day'),
 ('83300000-0000-4000-8000-000000000002','83100000-0000-4000-8000-000000000001','83200000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000001002','active',now()-interval '1 day'),
 ('83300000-0000-4000-8000-000000000003','83100000-0000-4000-8000-000000000001','83200000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000001003','active',now()-interval '1 day');
insert into public.membership_roles(membership_id,role_id) select m.id,r.id from public.memberships m join public.roles r on r.is_system and r.role_key=(case when m.profile_id='83000000-0000-4000-8000-000000001003' then 'family' else 'branch_supervisor' end) where m.organization_id='83100000-0000-4000-8000-000000000001';
insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,created_at,expires_at,consumed_at,consumed_jwt_iat,factor_method,factor_verified_at)
select ('83610000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,('83000000-0000-4000-8000-'||lpad((1000+i)::text,12,'0'))::uuid,
 ('83600000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,repeat(i::text,64),('83620000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
 clock_timestamp()-interval '2 minutes',clock_timestamp()-interval '2 minutes',clock_timestamp()+interval '3 minutes',clock_timestamp()-interval '30 seconds',clock_timestamp()-interval '30 seconds','totp',clock_timestamp()-interval '30 seconds' from generate_series(1,2) i;
insert into private.reauth_events(user_id,session_id,challenge_id,aal,verification_method,verified_at) select user_id,session_id,id,'aal2','totp',factor_verified_at from private.reauth_challenges where id::text like '83610000%';
insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,created_at,expires_at,consumed_at,consumed_jwt_iat,factor_method,factor_verified_at)
values('83610000-0000-4000-8000-000000000003','83000000-0000-4000-8000-000000001002','83600000-0000-4000-8000-000000000003',repeat('3',64),'83620000-0000-4000-8000-000000000003',
 clock_timestamp()-interval '22 minutes',clock_timestamp()-interval '22 minutes',clock_timestamp()-interval '18 minutes',clock_timestamp()-interval '20 minutes',clock_timestamp()-interval '20 minutes','totp',clock_timestamp()-interval '20 minutes');
insert into private.reauth_events(user_id,session_id,challenge_id,aal,verification_method,verified_at) select user_id,session_id,id,'aal2','totp',factor_verified_at from private.reauth_challenges where id='83610000-0000-4000-8000-000000000003';
create temporary table inventory_test_data(k text primary key,v jsonb);
insert into inventory_test_data values('content','{"status":"received","source":"previous_system","accountableRole":"branch_supervisor","periodStart":"2026-01-01","periodEnd":"2026-08-31","expectedCount":3,"actualCount":3,"missingRequired":0,"unmapped":0,"conflicts":0,"criticalDifferences":0,"keyFields":"passed","amounts":"passed","attachments":"passed","evidenceReference":"83700000-0000-4000-8000-000000000001","reasonCode":"none"}');
insert into inventory_test_data select 'save',jsonb_build_object('action','save','itemKey','client_master','expectedVersion',0,'content',v) from inventory_test_data where k='content';
grant select,insert,update on inventory_test_data to authenticated;
select ok(private.data_inventory_content_valid((select v from inventory_test_data where k='content')),'valid bounded metadata');
select ok(not private.data_inventory_content_valid((select v||'{"name":"forbidden"}' from inventory_test_data where k='content')),'unknown PHI field denied');
select ok(not private.data_inventory_content_valid(jsonb_set((select v from inventory_test_data where k='content'),'{expectedCount}','-1')),'negative count denied');
select ok(not private.data_inventory_content_valid(jsonb_set((select v from inventory_test_data where k='content'),'{status}','"not_applicable"')),'NA cannot contain known counts without reason');
select ok(not private.data_inventory_content_valid(jsonb_set((select v from inventory_test_data where k='content'),'{periodStart}','"2026-02-30"')),'invalid date denied');
select ok(not private.data_inventory_content_valid(jsonb_set((select v from inventory_test_data where k='content'),'{evidenceReference}','"https://forbidden.example"')),'external evidence URL denied');
select ok(not private.data_inventory_reviewable('client_master',jsonb_set((select v from inventory_test_data where k='content'),'{expectedCount}','null')),'unknown source count blocks review');
select ok(not private.data_inventory_reviewable('client_master',jsonb_set((select v from inventory_test_data where k='content'),'{actualCount}','2')),'mismatch blocks review');
select ok(not private.data_inventory_reviewable('billing',jsonb_set((select v from inventory_test_data where k='content'),'{amounts}','"not_applicable"')),'billing cannot skip amount review');
select ok(not private.data_inventory_reviewable('history_attachments',jsonb_set((select v from inventory_test_data where k='content'),'{attachments}','"not_applicable"')),'attachments dataset cannot skip attachment review');
select ok(not private.data_inventory_reviewable('client_master',jsonb_set((select v from inventory_test_data where k='content'),'{criticalDifferences}','1')),'critical differences block review');
select ok(not private.data_inventory_reviewable('client_master',jsonb_set((select v from inventory_test_data where k='content'),'{unmapped}','1')),'unmapped fields block review');
set local role authenticated;
select set_config('request.jwt.claims','{}',true);
select throws_ok($$select public.data_inventory_snapshot('83100000-0000-4000-8000-000000000001','83200000-0000-4000-8000-000000000001')$$,'42501','inventory snapshot denied','no user denied');
select set_config('request.jwt.claims','{"sub":"83000000-0000-4000-8000-000000001001","aal":"aal1"}',true);
select throws_ok($$select public.data_inventory_snapshot('83100000-0000-4000-8000-000000000001','83200000-0000-4000-8000-000000000001')$$,'42501','inventory snapshot denied','AAL1 denied');
select set_config('request.jwt.claims','{"sub":"83000000-0000-4000-8000-000000001003","aal":"aal2"}',true);
select throws_ok($$select public.data_inventory_snapshot('83100000-0000-4000-8000-000000000001','83200000-0000-4000-8000-000000000001')$$,'42501','inventory snapshot denied','family denied');
select set_config('request.jwt.claims','{"sub":"83000000-0000-4000-8000-000000001001","aal":"aal2","session_id":"83600000-0000-4000-8000-000000000001"}',true);
select throws_ok($$select public.data_inventory_snapshot('83100000-0000-4000-8000-000000000001','83200000-0000-4000-8000-000000000002')$$,'42501','inventory snapshot denied','other branch denied');
select throws_ok($$select public.data_inventory_snapshot('83100000-0000-4000-8000-000000000002','83200000-0000-4000-8000-000000000003')$$,'42501','inventory snapshot denied','other organization denied');
insert into inventory_test_data select 'v1',public.mutate_data_inventory('83100000-0000-4000-8000-000000000001','83200000-0000-4000-8000-000000000001',(select v from inventory_test_data where k='save'),'83800000-0000-4000-8000-000000000001');
select is((select v#>>'{result,reviewState}' from inventory_test_data where k='v1'),'pending','save persists pending manual metadata');
select is((public.mutate_data_inventory('83100000-0000-4000-8000-000000000001','83200000-0000-4000-8000-000000000001',(select v from inventory_test_data where k='save'),'83800000-0000-4000-8000-000000000001')->>'replayed')::boolean,true,'exact key replay');
select throws_ok($$select public.mutate_data_inventory('83100000-0000-4000-8000-000000000001','83200000-0000-4000-8000-000000000001',jsonb_set((select v from inventory_test_data where k='save'),'{content,actualCount}','2'),'83800000-0000-4000-8000-000000000001')$$,'23505','inventory idempotency conflict','same key other payload denied');
select throws_ok($$select public.mutate_data_inventory('83100000-0000-4000-8000-000000000001','83200000-0000-4000-8000-000000000001',(select v from inventory_test_data where k='save'),'83800000-0000-4000-8000-000000000009')$$,'40001','inventory version stale','stale expected version denied');
insert into inventory_test_data select 'verify',jsonb_build_object('action','verify','itemKey','client_master','expectedVersion',1,'expectedVersionId',v#>>'{result,versionId}','expectedContentHash',v#>>'{result,contentHash}') from inventory_test_data where k='v1';
select throws_ok($$select public.mutate_data_inventory('83100000-0000-4000-8000-000000000001','83200000-0000-4000-8000-000000000001',(select v from inventory_test_data where k='verify'),'83800000-0000-4000-8000-000000000002')$$,'42501','inventory independent reviewer required','self review denied');
select set_config('request.jwt.claims','{"sub":"83000000-0000-4000-8000-000000001002","aal":"aal2","session_id":"83600000-0000-4000-8000-000000000099"}',true);
select throws_ok($$select public.mutate_data_inventory('83100000-0000-4000-8000-000000000001','83200000-0000-4000-8000-000000000001',(select v from inventory_test_data where k='verify'),'83800000-0000-4000-8000-000000000002')$$,'42501','inventory recent AAL2 required','missing same session reauth denied');
select set_config('request.jwt.claims','{"sub":"83000000-0000-4000-8000-000000001002","aal":"aal2","session_id":"83600000-0000-4000-8000-000000000003"}',true);
select throws_ok($$select public.mutate_data_inventory('83100000-0000-4000-8000-000000000001','83200000-0000-4000-8000-000000000001',(select v from inventory_test_data where k='verify'),'83800000-0000-4000-8000-000000000002')$$,'42501','inventory recent AAL2 required','old same session AAL2 beyond fifteen minutes denied');
select set_config('request.jwt.claims','{"sub":"83000000-0000-4000-8000-000000001002","aal":"aal2","session_id":"83600000-0000-4000-8000-000000000002"}',true);
select throws_ok($$select public.mutate_data_inventory('83100000-0000-4000-8000-000000000001','83200000-0000-4000-8000-000000000001',jsonb_set((select v from inventory_test_data where k='verify'),'{expectedContentHash}',to_jsonb(repeat('f',64))),'83800000-0000-4000-8000-000000000002')$$,'40001','inventory version stale','review content hash must match');
insert into inventory_test_data select 'v2',public.mutate_data_inventory('83100000-0000-4000-8000-000000000001','83200000-0000-4000-8000-000000000001',(select v from inventory_test_data where k='verify'),'83800000-0000-4000-8000-000000000002');
select is((select v#>>'{result,reviewState}' from inventory_test_data where k='v2'),'manually_verified','independent reviewer verifies metadata only');
select is((select v#>>'{result,contentHash}' from inventory_test_data where k='v1'),(select v#>>'{result,contentHash}' from inventory_test_data where k='v2'),'review preserves exact content hash');
select is((public.mutate_data_inventory('83100000-0000-4000-8000-000000000001','83200000-0000-4000-8000-000000000001',(select v from inventory_test_data where k='verify'),'83800000-0000-4000-8000-000000000002')->>'replayed')::boolean,true,'review exact receipt replay');
insert into inventory_test_data select 'revise',jsonb_build_object('action','save','itemKey','client_master','expectedVersion',2,'content',jsonb_set(v,'{reasonCode}','"data_correction"')) from inventory_test_data where k='content';
insert into inventory_test_data select 'v3',public.mutate_data_inventory('83100000-0000-4000-8000-000000000001','83200000-0000-4000-8000-000000000001',(select v from inventory_test_data where k='revise'),'83800000-0000-4000-8000-000000000003');
select is((select v#>>'{result,reviewState}' from inventory_test_data where k='v3'),'pending','revision clears verification');
select is((select v#>'{result,reviewedBy}' from inventory_test_data where k='v3'),'null'::jsonb,'revision removes reviewer evidence');
select is((public.data_inventory_snapshot('83100000-0000-4000-8000-000000000001','83200000-0000-4000-8000-000000000001')#>>'{records,0,historyTotal}')::integer,3,'snapshot has three immutable versions');
select is(public.data_inventory_snapshot('83100000-0000-4000-8000-000000000001','83200000-0000-4000-8000-000000000001')->>'formalPromotionStatus','not_configured','never asserts formal import promotion');
select throws_ok($$select * from public.data_inventory_versions$$,'42501',null,'direct table read denied');
reset role;
update public.memberships set ends_at=clock_timestamp()-interval '1 second' where id='83300000-0000-4000-8000-000000000002';
set local role authenticated;
select throws_ok($$select public.mutate_data_inventory('83100000-0000-4000-8000-000000000001','83200000-0000-4000-8000-000000000001',(select v from inventory_test_data where k='verify'),'83800000-0000-4000-8000-000000000002')$$,'42501','inventory operation denied','revoked membership blocks existing receipt');
reset role;
update public.memberships set ends_at=null where id='83300000-0000-4000-8000-000000000002';
select set_config('request.jwt.claims','{}',true);
update public.profiles set is_active=false where id='83000000-0000-4000-8000-000000001002';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"83000000-0000-4000-8000-000000001002","aal":"aal2","session_id":"83600000-0000-4000-8000-000000000002"}',true);
select throws_ok($$select public.data_inventory_snapshot('83100000-0000-4000-8000-000000000001','83200000-0000-4000-8000-000000000001')$$,'42501','inventory snapshot denied','inactive employee denied');
reset role;
select set_config('request.jwt.claims','{}',true);
update public.profiles set is_active=true where id='83000000-0000-4000-8000-000000001002';
update public.organizations set is_active=false where id='83100000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"83000000-0000-4000-8000-000000001002","aal":"aal2","session_id":"83600000-0000-4000-8000-000000000002"}',true);
select throws_ok($$select public.data_inventory_snapshot('83100000-0000-4000-8000-000000000001','83200000-0000-4000-8000-000000000001')$$,'42501','inventory snapshot denied','inactive organization denied');
reset role;
update public.organizations set is_active=true where id='83100000-0000-4000-8000-000000000001';
delete from public.role_permissions where role_id='10000000-0000-4000-8000-000000000003' and permission_id=(select id from public.permissions where permission_key='audit.view');
set local role authenticated;
select throws_ok($$select public.data_inventory_snapshot('83100000-0000-4000-8000-000000000001','83200000-0000-4000-8000-000000000001')$$,'42501','inventory snapshot denied','current permission revoke denied');
reset role;
select throws_ok($$update public.data_inventory_versions set review_state='pending'$$,'55000','data inventory is append-only','owner cannot overwrite');
select throws_ok($$delete from private.data_inventory_operations$$,'55000','data inventory is append-only','receipts immutable');
select is((select count(*) from public.data_inventory_versions where organization_id='83100000-0000-4000-8000-000000000001'),3::bigint,'only intended three writes persisted');
select is((select count(*) from public.audit_events where table_name='public.data_inventory_versions' and action='insert' and organization_id='83100000-0000-4000-8000-000000000001'),3::bigint,'one safe canonical audit per version');
select is((select count(*) from public.audit_events where table_name='public.data_inventory_versions' and action='select' and organization_id='83100000-0000-4000-8000-000000000001'),2::bigint,'successful snapshots produce canonical select audits');
select ok(not exists(select 1 from public.audit_events where table_name='public.data_inventory_versions' and metadata::text like '%83700000%'),'audit never copies raw evidence reference');
select * from finish();
rollback;
