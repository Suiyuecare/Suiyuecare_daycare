begin;
set local timezone='Asia/Taipei';
select plan(56);

select results_eq(
  $$select permission_key collate "C" from public.permissions
    where permission_key like 'client_vaccinations.%' order by 1$$,
  $$values ('client_vaccinations.manage'::text collate "C"),
    ('client_vaccinations.read'::text collate "C")$$,
  'Page 23 has independent read and manage permissions');
select is((select count(*) from public.role_permissions grant_row
  join public.permissions permission on permission.id=grant_row.permission_id
  where permission.permission_key like 'client_vaccinations.%'),8::bigint,
  'five conservative roles can read and three roles can manage');
select ok((select bool_and(relrowsecurity and relforcerowsecurity) from pg_class
  where oid in ('private.client_vaccination_evidence_registry'::regclass,
    'public.client_vaccination_versions'::regclass,
    'private.client_vaccination_operations'::regclass,
    'private.client_vaccination_batch_operations'::regclass)),
  'all Page-23 evidence tables force RLS');
select ok(not has_table_privilege('authenticated','public.client_vaccination_versions',
    'select,insert,update,delete')
  and not has_table_privilege('service_role','public.client_vaccination_versions',
    'select,insert,update,delete')
  and not has_table_privilege('authenticated','private.client_vaccination_operations',
    'select,insert,update,delete')
  and not has_table_privilege('authenticated','private.client_vaccination_batch_operations',
    'select,insert,update,delete')
  and not has_table_privilege('authenticated','private.client_vaccination_evidence_registry',
    'select,insert,update,delete'),
  'browser and service roles have no direct vaccination evidence DML');
select ok(has_function_privilege('authenticated',
    'public.append_client_vaccination(uuid,uuid,text,uuid,uuid,integer,uuid,text,text,date,text,text,text,uuid,text,text,text,text,text,uuid)','execute')
  and has_function_privilege('authenticated',
    'public.append_client_vaccination_batch(uuid,uuid,jsonb,uuid)','execute')
  and has_function_privilege('authenticated',
    'public.client_vaccination_snapshot(uuid,uuid,uuid,text,text,date,date,text,text)','execute')
  and not has_function_privilege('service_role',
    'public.append_client_vaccination_batch(uuid,uuid,jsonb,uuid)','execute'),
  'only authenticated callers receive all three public Page-23 RPCs');
select ok(not (select prosecdef from pg_proc where oid=
    'public.append_client_vaccination_batch(uuid,uuid,jsonb,uuid)'::regprocedure)
  and (select prosecdef and coalesce(proconfig,'{}'::text[]) @> array['search_path=""']
    from pg_proc where oid=
      'private.append_client_vaccination_batch_guarded(uuid,uuid,jsonb,uuid)'::regprocedure),
  'batch wrapper is invoker and guarded core is a pinned definer');
select is((select count(*) from pg_trigger where not tgisinternal and tgname in (
  'client_vaccination_evidence_append_only','client_vaccination_versions_append_only',
  'client_vaccination_operations_append_only',
  'client_vaccination_batch_operations_append_only')),4::bigint,
  'registry, versions, single receipts and batch receipts are append-only');
select is(private.client_vaccination_attachment_pipeline_enabled(
  '23000000-2000-4000-8000-000000000001',
  '23000000-3000-4000-8000-000000000001'),false,
  'manual attachment pipeline explicitly fails closed');

insert into auth.users(id,aud,role,email,created_at,updated_at) values
 ('23000000-1000-4000-8000-000000000001','authenticated','authenticated','manager23@example.invalid',now(),now()),
 ('23000000-1000-4000-8000-000000000002','authenticated','authenticated','nurse23@example.invalid',now(),now()),
 ('23000000-1000-4000-8000-000000000003','authenticated','authenticated','unassigned23@example.invalid',now(),now()),
 ('23000000-1000-4000-8000-000000000004','authenticated','authenticated','other23@example.invalid',now(),now());
insert into public.organizations(id,code,name) values
 ('23000000-2000-4000-8000-000000000001','vax-a','疫苗測試機構 A'),
 ('23000000-2000-4000-8000-000000000002','vax-b','疫苗測試機構 B');
insert into public.branches(id,organization_id,code,name) values
 ('23000000-3000-4000-8000-000000000001','23000000-2000-4000-8000-000000000001','main','A 主分支'),
 ('23000000-3000-4000-8000-000000000002','23000000-2000-4000-8000-000000000001','other','A 次分支'),
 ('23000000-3000-4000-8000-000000000003','23000000-2000-4000-8000-000000000002','main','B 主分支');
insert into public.profiles(id,display_name,kind) values
 ('23000000-1000-4000-8000-000000000001','疫苗紀錄主管','staff'),
 ('23000000-1000-4000-8000-000000000002','指派護理人員','staff'),
 ('23000000-1000-4000-8000-000000000003','未指派護理人員','staff'),
 ('23000000-1000-4000-8000-000000000004','他機構主管','staff');
insert into public.memberships(id,organization_id,branch_id,profile_id,status) values
 ('23000000-4000-4000-8000-000000000001','23000000-2000-4000-8000-000000000001',null,'23000000-1000-4000-8000-000000000001','active'),
 ('23000000-4000-4000-8000-000000000002','23000000-2000-4000-8000-000000000001','23000000-3000-4000-8000-000000000001','23000000-1000-4000-8000-000000000002','active'),
 ('23000000-4000-4000-8000-000000000003','23000000-2000-4000-8000-000000000001','23000000-3000-4000-8000-000000000001','23000000-1000-4000-8000-000000000003','active'),
 ('23000000-4000-4000-8000-000000000004','23000000-2000-4000-8000-000000000002',null,'23000000-1000-4000-8000-000000000004','active');
insert into public.membership_roles(membership_id,role_id)
select '23000000-4000-4000-8000-000000000001',id from public.roles
  where role_key='organization_manager' and is_system;
insert into public.membership_roles(membership_id,role_id)
select '23000000-4000-4000-8000-000000000002',id from public.roles
  where role_key='nurse' and is_system;
insert into public.membership_roles(membership_id,role_id)
select '23000000-4000-4000-8000-000000000003',id from public.roles
  where role_key='nurse' and is_system;
insert into public.membership_roles(membership_id,role_id)
select '23000000-4000-4000-8000-000000000004',id from public.roles
  where role_key='organization_manager' and is_system;
insert into public.clients(id,organization_id,branch_id,client_code,display_name,status,admitted_on) values
 ('23000000-5000-4000-8000-000000000001','23000000-2000-4000-8000-000000000001','23000000-3000-4000-8000-000000000001','V23-1','合成個案甲','active',current_date-90),
 ('23000000-5000-4000-8000-000000000002','23000000-2000-4000-8000-000000000001','23000000-3000-4000-8000-000000000001','V23-2','合成個案乙','active',current_date-90),
 ('23000000-5000-4000-8000-000000000003','23000000-2000-4000-8000-000000000001','23000000-3000-4000-8000-000000000002','V23-3','他分支個案','active',current_date-90),
 ('23000000-5000-4000-8000-000000000004','23000000-2000-4000-8000-000000000002','23000000-3000-4000-8000-000000000003','V23-4','他機構個案','active',current_date-90),
 ('23000000-5000-4000-8000-000000000005','23000000-2000-4000-8000-000000000001','23000000-3000-4000-8000-000000000001','V23-5','暫停個案','suspended',current_date-90);
insert into public.client_assignments(id,organization_id,branch_id,client_id,assignee_user_id,assignment_kind) values
 ('23000000-6000-4000-8000-000000000001','23000000-2000-4000-8000-000000000001','23000000-3000-4000-8000-000000000001','23000000-5000-4000-8000-000000000001','23000000-1000-4000-8000-000000000002','clinical-vaccination');

create function pg_temp.vax_item(
  p_item_key uuid,p_vaccination_key uuid,p_client_id uuid,p_name text,p_dose text,
  p_date date,p_provider text,p_evidence text default 'missing'
) returns jsonb language sql as $$
  select jsonb_build_object('idempotency_key',p_item_key,'record',jsonb_build_object(
    'action','create','vaccination_key',p_vaccination_key,
    'previous_version_id',null,'expected_base_version',0,'client_id',p_client_id,
    'vaccine_name',p_name,'dose_number',p_dose,'vaccinated_on',p_date,
    'lot_number',null,'provider_name',p_provider,'evidence_status',p_evidence,
    'evidence_reference_id',null,'evidence_sha256',null,'evidence_file_name',null,
    'source_system','manual_entry','source_record_id',null,'correction_reason',null));
$$;

create temporary table first_receipt (
  organization_id uuid,branch_id uuid,vaccination_key uuid,record_version_id uuid,
  version integer,previous_version_id uuid,record_status text,client_id uuid,
  content_hash text,record_payload jsonb,duplicate_warning boolean,duplicate_count integer,
  duplicate_basis text,recorded_at timestamptz,replayed boolean);
create temporary table nurse_receipt (like first_receipt);
create temporary table duplicate_receipt (like first_receipt);
create temporary table corrected_receipt (like first_receipt);
create temporary table voided_receipt (like first_receipt);
create temporary table trusted_void_receipt (like first_receipt);
create temporary table batch_receipt (
  batch_id uuid,batch_idempotency_key uuid,request_hash text,item_total integer,
  succeeded_total integer,rejected_total integer,results jsonb,replayed boolean);
create temporary table batch_replay (like batch_receipt);
create temporary table nurse_batch (like batch_receipt);
grant select,insert on first_receipt,nurse_receipt,duplicate_receipt,
  corrected_receipt,voided_receipt,trusted_void_receipt,batch_receipt,batch_replay,
  nurse_batch to authenticated;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"23000000-1000-4000-8000-000000000002","role":"authenticated","aal":"aal1","session_id":"23000000-7000-4000-8000-000000000002"}',true);
select lives_ok($$select * from public.client_vaccination_snapshot(
 '23000000-2000-4000-8000-000000000001','23000000-3000-4000-8000-000000000001')$$,
 'allowlisted AAL1 session may read assigned vaccination records');
select throws_ok($$select * from public.append_client_vaccination(
 '23000000-2000-4000-8000-000000000001','23000000-3000-4000-8000-000000000001',
 'create','23000000-8000-4000-8000-000000000001',null,0,
 '23000000-5000-4000-8000-000000000002','流感疫苗','第1劑',current_date,null,
 '合成院所','missing',null,null,null,'manual_entry',null,null,
 '23000000-9000-4000-8000-000000000001')$$,
 '42501','client vaccination client is not permitted','AAL1 does not bypass the assigned-client boundary');
select set_config('request.jwt.claims','{"sub":"23000000-1000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"23000000-7000-4000-8000-000000000002"}',true);
select throws_ok($$select * from public.client_vaccination_snapshot(
 '23000000-2000-4000-8000-000000000001','23000000-3000-4000-8000-000000000002')$$,
 '42501','client vaccination snapshot is not permitted','branch membership cannot cross branches');
select throws_ok($$select * from public.client_vaccination_snapshot(
 '23000000-2000-4000-8000-000000000001','23000000-3000-4000-8000-000000000001',
 '23000000-5000-4000-8000-000000000002')$$,
 '42501','client vaccination snapshot is not permitted','assigned nurse cannot request an unassigned client');
select set_config('request.jwt.claims','{"sub":"23000000-1000-4000-8000-000000000003","role":"authenticated","aal":"aal2","session_id":"23000000-7000-4000-8000-000000000003"}',true);
select throws_ok($$select * from public.append_client_vaccination(
 '23000000-2000-4000-8000-000000000001','23000000-3000-4000-8000-000000000001',
 'create','23000000-8000-4000-8000-000000000002',null,0,
 '23000000-5000-4000-8000-000000000001','流感疫苗','第1劑',current_date,null,
 '合成院所','missing',null,null,null,'manual_entry',null,null,
 '23000000-9000-4000-8000-000000000002')$$,
 '42501','client vaccination client is not permitted','unassigned nurse cannot create a vaccination');

select set_config('request.jwt.claims','{"sub":"23000000-1000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"23000000-7000-4000-8000-000000000001"}',true);
select lives_ok($$select * from public.client_vaccination_snapshot(
 '23000000-2000-4000-8000-000000000001','23000000-3000-4000-8000-000000000002')$$,
 'organization-wide manager may intentionally access another branch in the same tenant');
select throws_ok($$select * from public.append_client_vaccination(
 '23000000-2000-4000-8000-000000000002','23000000-3000-4000-8000-000000000003',
 'create','23000000-8000-4000-8000-000000000004',null,0,
 '23000000-5000-4000-8000-000000000004','流感疫苗','第1劑',current_date,null,
 '合成院所','missing',null,null,null,'manual_entry',null,null,
 '23000000-9000-4000-8000-000000000004')$$,
 '42501','client vaccination client is not permitted','organization manager cannot cross tenants');
select throws_ok($$select * from public.append_client_vaccination(
 '23000000-2000-4000-8000-000000000001','23000000-3000-4000-8000-000000000001',
 'create','23000000-8000-4000-8000-000000000005',null,0,
 '23000000-5000-4000-8000-000000000005','流感疫苗','第1劑',current_date,null,
 '合成院所','missing',null,null,null,'manual_entry',null,null,
 '23000000-9000-4000-8000-000000000005')$$,
 '42501','client vaccination client is not permitted','suspended clients cannot receive new records');
select throws_ok($$select * from public.append_client_vaccination(
 '23000000-2000-4000-8000-000000000001','23000000-3000-4000-8000-000000000001',
 'create','23000000-8000-4000-8000-000000000006',null,0,
 '23000000-5000-4000-8000-000000000001','流感疫苗','第1劑',
 (clock_timestamp() at time zone 'Asia/Taipei')::date+1,null,
 '合成院所','missing',null,null,null,'manual_entry',null,null,
 '23000000-9000-4000-8000-000000000006')$$,
 '22023','client vaccination content is invalid','future Taipei vaccination dates are rejected');

insert into first_receipt select * from public.append_client_vaccination(
 '23000000-2000-4000-8000-000000000001','23000000-3000-4000-8000-000000000001',
 'create','23000000-8000-4000-8000-000000000010',null,0,
 '23000000-5000-4000-8000-000000000001','COVID-19','第1劑',
 (clock_timestamp() at time zone 'Asia/Taipei')::date,'LOT-23-A','合成接種院所',
 'missing',null,null,null,'manual_entry',null,null,
 '23000000-9000-4000-8000-000000000010');
select ok((select version=1 and record_status='active' and not replayed
  and not duplicate_warning and duplicate_count=0
  and record_payload=jsonb_build_object(
    'client_id','23000000-5000-4000-8000-000000000001'::uuid,
    'vaccine_name','COVID-19','dose_number','第1劑','vaccinated_on',current_date,
    'lot_number','LOT-23-A','provider_name','合成接種院所',
    'evidence_status','missing','evidence_reference_id',null,
    'evidence_sha256',null,'evidence_file_name',null,
    'source_system','manual_entry','source_record_id',null)
  from first_receipt),
  'create appends one active immutable original');
reset role;
select ok((select normalized_vaccine_name='covid-19'
  and normalized_dose_number='第1劑'
  and source_system='manual_entry' and source_record_id is null
  and source_provenance @> '{"capture_method":"staff_transcription","authority":"facility"}'::jsonb
  and evidence_status='missing' and payload_hash~'^[a-f0-9]{64}$'
  and content_hash~'^[a-f0-9]{64}$'
  from public.client_vaccination_versions
  where id=(select record_version_id from first_receipt)),
  'stored facts freeze normalized duplicate keys, provenance, evidence state and hashes');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"23000000-1000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"23000000-7000-4000-8000-000000000001"}',true);
select is((select replayed from public.append_client_vaccination(
 '23000000-2000-4000-8000-000000000001','23000000-3000-4000-8000-000000000001',
 'create','23000000-8000-4000-8000-000000000010',null,0,
 '23000000-5000-4000-8000-000000000001','COVID-19','第1劑',
 (clock_timestamp() at time zone 'Asia/Taipei')::date,'LOT-23-A','合成接種院所',
 'missing',null,null,null,'manual_entry',null,null,
 '23000000-9000-4000-8000-000000000010')),true,
  'same actor and exact request replays the frozen receipt');
select throws_ok($$select * from public.append_client_vaccination(
 '23000000-2000-4000-8000-000000000001','23000000-3000-4000-8000-000000000001',
 'create','23000000-8000-4000-8000-000000000010',null,0,
 '23000000-5000-4000-8000-000000000001','COVID-19','第1劑',current_date,
 'LOT-23-A','不同院所','missing',null,null,null,'manual_entry',null,null,
 '23000000-9000-4000-8000-000000000010')$$,
 '23505','client vaccination idempotency conflict','same actor key with changed content conflicts');

select set_config('request.jwt.claims','{"sub":"23000000-1000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"23000000-7000-4000-8000-000000000002"}',true);
insert into nurse_receipt select * from public.append_client_vaccination(
 '23000000-2000-4000-8000-000000000001','23000000-3000-4000-8000-000000000001',
 'create','23000000-8000-4000-8000-000000000011',null,0,
 '23000000-5000-4000-8000-000000000001','流感疫苗','年度劑次',current_date,
 null,'合成接種院所','not_applicable',null,null,null,'manual_entry',null,null,
 '23000000-9000-4000-8000-000000000010');
select ok((select version=1 and not replayed from nurse_receipt),
  'the same idempotency UUID is independently scoped to another actor');

reset role;
insert into private.client_vaccination_evidence_registry(
 id,organization_id,branch_id,client_id,sha256,source_filename,storage_status,
 scan_status,source_system,source_record_id,registered_by) values
 ('23000000-a000-4000-8000-000000000001','23000000-2000-4000-8000-000000000001',
 '23000000-3000-4000-8000-000000000001','23000000-5000-4000-8000-000000000001',
 repeat('a',64),'trusted-vax-proof.pdf','stored','clean','legacy_migration','legacy-proof-1',
 '23000000-1000-4000-8000-000000000001');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"23000000-1000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"23000000-7000-4000-8000-000000000001"}',true);
select throws_ok($$select * from public.append_client_vaccination(
 '23000000-2000-4000-8000-000000000001','23000000-3000-4000-8000-000000000001',
 'create','23000000-8000-4000-8000-000000000012',null,0,
 '23000000-5000-4000-8000-000000000001','肺炎鏈球菌疫苗','第1劑',current_date,
 null,'合成接種院所','provided','23000000-a000-4000-8000-000000000001',
 repeat('a',64),'trusted-vax-proof.pdf','manual_entry',null,null,
 '23000000-9000-4000-8000-000000000012')$$,
 '42501','client vaccination attachment pipeline is not configured',
 'browser manual RPC cannot attach even an arbitrary trusted-registry identifier');

insert into duplicate_receipt select * from public.append_client_vaccination(
 '23000000-2000-4000-8000-000000000001','23000000-3000-4000-8000-000000000001',
 'create','23000000-8000-4000-8000-000000000020',null,0,
 '23000000-5000-4000-8000-000000000001',' covid-19 ',' 第1劑 ',current_date,
 null,'另一合成院所','missing',null,null,null,'manual_entry',null,null,
 '23000000-9000-4000-8000-000000000020');
select ok((select duplicate_warning and duplicate_count=1
  and vaccination_key<>'23000000-8000-4000-8000-000000000010'
  from duplicate_receipt),
  'normalized same-client vaccine and dose only warn without merging identities');
reset role;
select is((select count(*) from public.client_vaccination_versions
  where vaccination_key in ('23000000-8000-4000-8000-000000000010',
    '23000000-8000-4000-8000-000000000020')),2::bigint,
  'duplicate warning preserves both independent records');

insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,
 issued_jwt_iat,created_at,expires_at,consumed_at,consumed_jwt_iat,
 factor_method,factor_verified_at) values
 ('23000000-c000-4000-8000-000000000080','23000000-1000-4000-8000-000000000001',
 '23000000-7000-4000-8000-000000000080',repeat('8',64),
 '23000000-c000-4000-8000-000000000081',clock_timestamp()-interval '30 minutes',
 clock_timestamp()-interval '30 minutes',clock_timestamp()-interval '25 minutes',
 clock_timestamp()-interval '29 minutes',clock_timestamp()-interval '29 minutes',
 'totp',clock_timestamp()-interval '29 minutes'),
 ('23000000-c000-4000-8000-000000000010','23000000-1000-4000-8000-000000000001',
 '23000000-7000-4000-8000-000000000099',repeat('f',64),
 '23000000-c000-4000-8000-000000000011',clock_timestamp()-interval '2 minutes',
 clock_timestamp()-interval '2 minutes',clock_timestamp()+interval '5 minutes',
 clock_timestamp()-interval '30 seconds',clock_timestamp()-interval '30 seconds',
 'totp',clock_timestamp()-interval '30 seconds'),
 ('23000000-c000-4000-8000-000000000001','23000000-1000-4000-8000-000000000001',
 '23000000-7000-4000-8000-000000000001',repeat('c',64),
 '23000000-c000-4000-8000-000000000002',clock_timestamp()-interval '2 minutes',
 clock_timestamp()-interval '2 minutes',clock_timestamp()+interval '5 minutes',
 clock_timestamp()-interval '30 seconds',clock_timestamp()-interval '30 seconds',
 'totp',clock_timestamp()-interval '30 seconds');
insert into private.reauth_events(user_id,session_id,challenge_id,aal,verification_method,verified_at)
select challenge.user_id,challenge.session_id,challenge.id,'aal2','totp',
 challenge.factor_verified_at from private.reauth_challenges challenge
where challenge.id in ('23000000-c000-4000-8000-000000000080',
 '23000000-c000-4000-8000-000000000010','23000000-c000-4000-8000-000000000001');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"23000000-1000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"23000000-7000-4000-8000-000000000080"}',true);
select throws_ok($$select * from public.append_client_vaccination_batch(
 '23000000-2000-4000-8000-000000000001','23000000-3000-4000-8000-000000000001',
 jsonb_build_array(pg_temp.vax_item('23000000-9000-4000-8000-000000000080',
  '23000000-8000-4000-8000-000000000080','23000000-5000-4000-8000-000000000002',
  '批次重新驗證測試','第1劑',current_date,'合成接種院所')),
 '23000000-b000-4000-8000-000000000080')$$,
 '42501','current same-session recent AAL2 evidence is required',
 'batch rejects stale same-session AAL2 evidence before ledger creation');
select set_config('request.jwt.claims','{"sub":"23000000-1000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"23000000-7000-4000-8000-000000000098"}',true);
select throws_ok($$select * from public.append_client_vaccination_batch(
 '23000000-2000-4000-8000-000000000001','23000000-3000-4000-8000-000000000001',
 jsonb_build_array(pg_temp.vax_item('23000000-9000-4000-8000-000000000098',
  '23000000-8000-4000-8000-000000000098','23000000-5000-4000-8000-000000000002',
  '批次重新驗證測試','第1劑',current_date,'合成接種院所')),
 '23000000-b000-4000-8000-000000000098')$$,
 '42501','current same-session recent AAL2 evidence is required',
 'batch rejects recent AAL2 evidence from a different session');
select set_config('request.jwt.claims','{"sub":"23000000-1000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"23000000-7000-4000-8000-000000000001"}',true);
insert into batch_receipt select * from public.append_client_vaccination_batch(
 '23000000-2000-4000-8000-000000000001','23000000-3000-4000-8000-000000000001',
 jsonb_build_array(
   jsonb_set(pg_temp.vax_item('23000000-9000-4000-8000-000000000010',
    '23000000-8000-4000-8000-000000000010','23000000-5000-4000-8000-000000000001',
    'COVID-19','第1劑',(clock_timestamp() at time zone 'Asia/Taipei')::date,
      '合成接種院所'),
    '{record,lot_number}',to_jsonb('LOT-23-A'::text)),
   pg_temp.vax_item('23000000-9000-4000-8000-000000000030',
    '23000000-8000-4000-8000-000000000030','23000000-5000-4000-8000-000000000002',
    'B 型肝炎疫苗','第1劑',current_date,'合成接種院所'),
   pg_temp.vax_item('23000000-9000-4000-8000-000000000031',
    '23000000-8000-4000-8000-000000000031','23000000-5000-4000-8000-000000000002',
    'B 型肝炎疫苗','第2劑',
      (clock_timestamp() at time zone 'Asia/Taipei')::date+1,'合成接種院所')),
 '23000000-b000-4000-8000-000000000010');
select is((select jsonb_build_object(
  'key_ok',batch_idempotency_key='23000000-b000-4000-8000-000000000010',
  'hash_ok',request_hash~'^[a-f0-9]{64}$','item_total',item_total,
  'succeeded_total',succeeded_total,'rejected_total',rejected_total,'replayed',replayed)
  from batch_receipt),
  '{"key_ok":true,"hash_ok":true,"item_total":3,"succeeded_total":2,"rejected_total":1,"replayed":false}'::jsonb,
  'atomic batch receipt freezes its scoped key, hash and explicit partial counts');
select ok((select results->0->>'status'='replayed'
  and (results->0->'receipt'->>'replayed')::boolean
  and results->0->'receipt'->'record_payload'->>'vaccine_name'='COVID-19'
  and (select count(*) from jsonb_object_keys(
    results->0->'receipt'->'record_payload'))=12
  and results->1->>'status'='created'
  and not (results->1->'receipt'->>'replayed')::boolean
  and results->2->>'status'='rejected'
  and results->2->'receipt'='null'::jsonb
  and results->2->'error'->>'code'='INVALID_CLIENT_VACCINATION_RECORD'
  from batch_receipt),
  'single and batch operation keys interoperate and partial errors are structured');
reset role;
select ok((select count(*)=1 from private.client_vaccination_batch_operations
  where id=(select batch_id from batch_receipt)
    and reauth_challenge_id='23000000-c000-4000-8000-000000000001'
    and not (results->0->'receipt' ? 'record_payload')
    and not (results->1->'receipt' ? 'record_payload')),
  'outer ledger atomically stores IDs and hashes without duplicating hydrated record payload');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"23000000-1000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"23000000-7000-4000-8000-000000000001"}',true);
insert into batch_replay select * from public.append_client_vaccination_batch(
 '23000000-2000-4000-8000-000000000001','23000000-3000-4000-8000-000000000001',
 jsonb_build_array(
   jsonb_set(pg_temp.vax_item('23000000-9000-4000-8000-000000000010',
    '23000000-8000-4000-8000-000000000010','23000000-5000-4000-8000-000000000001',
    'COVID-19','第1劑',(clock_timestamp() at time zone 'Asia/Taipei')::date,
      '合成接種院所'),
    '{record,lot_number}',to_jsonb('LOT-23-A'::text)),
   pg_temp.vax_item('23000000-9000-4000-8000-000000000030',
    '23000000-8000-4000-8000-000000000030','23000000-5000-4000-8000-000000000002',
    'B 型肝炎疫苗','第1劑',current_date,'合成接種院所'),
   pg_temp.vax_item('23000000-9000-4000-8000-000000000031',
    '23000000-8000-4000-8000-000000000031','23000000-5000-4000-8000-000000000002',
    'B 型肝炎疫苗','第2劑',
      (clock_timestamp() at time zone 'Asia/Taipei')::date+1,'合成接種院所')),
 '23000000-b000-4000-8000-000000000010');
select ok((select replayed and batch_id=(select batch_id from batch_receipt)
  and request_hash=(select request_hash from batch_receipt)
  and results->0->>'status'='replayed' and results->1->>'status'='replayed'
  and results->0->'receipt'->'record_payload'=
    (select results->0->'receipt'->'record_payload' from batch_receipt)
  and results->2=(select results->2 from batch_receipt) from batch_replay),
  'exact outer replay returns the same IDs, hash and rejection while marking successes replayed');
select throws_ok($$select * from public.append_client_vaccination_batch(
 '23000000-2000-4000-8000-000000000001','23000000-3000-4000-8000-000000000001',
 jsonb_build_array(jsonb_set(pg_temp.vax_item('23000000-9000-4000-8000-000000000010',
  '23000000-8000-4000-8000-000000000010','23000000-5000-4000-8000-000000000001',
  'COVID-19','第1劑',(clock_timestamp() at time zone 'Asia/Taipei')::date,
    '合成接種院所'),
  '{record,lot_number}',to_jsonb('LOT-23-A'::text))),
 '23000000-b000-4000-8000-000000000010')$$,
 '23505','client vaccination batch idempotency conflict',
 'same outer key with a changed length conflicts before item processing');
reset role;
select ok((select count(*)=1 from private.client_vaccination_batch_operations
    where actor_user_id='23000000-1000-4000-8000-000000000001'
      and batch_idempotency_key='23000000-b000-4000-8000-000000000010')
  and not exists(select 1 from public.client_vaccination_versions
    where vaccination_key='23000000-8000-4000-8000-000000000031'),
  'outer conflicts create neither a second ledger row nor a rejected-item tail record');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"23000000-1000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"23000000-7000-4000-8000-000000000098"}',true);
select throws_ok(format($sql$select * from public.append_client_vaccination(
 '23000000-2000-4000-8000-000000000001','23000000-3000-4000-8000-000000000001',
 'correct','23000000-8000-4000-8000-000000000010','%s',1,
 '23000000-5000-4000-8000-000000000001','COVID-19','第1劑',current_date,
 'LOT-23-A','更正後合成院所','missing',null,null,null,'manual_entry',null,
 '查核接種來源後更正接種院所','23000000-9000-4000-8000-000000000040')$sql$,
 (select record_version_id from first_receipt)),
 '42501','current same-session recent AAL2 evidence is required',
 'correction fails without recent same-session AAL2');
reset role;

insert into public.client_vaccination_versions(
 id,organization_id,branch_id,client_id,vaccination_key,version,
 previous_version_id,record_status,correction_reason,vaccine_name,
 normalized_vaccine_name,dose_number,normalized_dose_number,vaccinated_on,
 lot_number,provider_name,evidence_status,evidence_reference_id,evidence_sha256,
 evidence_file_name,source_system,source_record_id,source_provenance,payload_hash,
 content_hash,recorded_by,recorded_by_display_name,recorded_at
) values (
 '23000000-d000-4000-8000-000000000001','23000000-2000-4000-8000-000000000001',
 '23000000-3000-4000-8000-000000000001','23000000-5000-4000-8000-000000000001',
 '23000000-8000-4000-8000-000000000060',1,null,'active',null,
 '肺炎鏈球菌疫苗','肺炎鏈球菌疫苗','第1劑','第1劑',current_date,null,'合成匯入院所',
 'provided','23000000-a000-4000-8000-000000000001',repeat('a',64),
 'trusted-vax-proof.pdf','legacy_migration','legacy-vax-60',
 '{"schema_version":1,"source_system":"legacy_migration","authority":"legacy_source"}'::jsonb,
 repeat('d',64),repeat('e',64),'23000000-1000-4000-8000-000000000001',
 '疫苗紀錄主管',clock_timestamp());

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"23000000-1000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"23000000-7000-4000-8000-000000000001"}',true);
select throws_ok($$select * from public.append_client_vaccination(
 '23000000-2000-4000-8000-000000000001','23000000-3000-4000-8000-000000000001',
 'correct','23000000-8000-4000-8000-000000000060',
 '23000000-d000-4000-8000-000000000001',1,
 '23000000-5000-4000-8000-000000000001','肺炎鏈球菌疫苗','第1劑',current_date,
 null,'合成匯入院所','missing',null,null,null,'manual_entry',null,
 '嘗試更正含可信證明的匯入來源紀錄','23000000-9000-4000-8000-000000000060')$$,
 '55000','trusted-origin client vaccination correction is not configured',
 'trusted evidence or imported provenance cannot be silently downgraded by correction');
reset role;
select is((select count(*) from public.client_vaccination_versions
  where vaccination_key='23000000-8000-4000-8000-000000000060'),1::bigint,
  'rejected trusted-origin correction appends no version or evidence downgrade');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"23000000-1000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"23000000-7000-4000-8000-000000000001"}',true);
insert into trusted_void_receipt select * from public.append_client_vaccination(
 '23000000-2000-4000-8000-000000000001','23000000-3000-4000-8000-000000000001',
 'void','23000000-8000-4000-8000-000000000060',
 '23000000-d000-4000-8000-000000000001',1,
 '23000000-5000-4000-8000-000000000001',null,null,null,null,null,null,null,null,null,
 null,null,'確認可信匯入來源不屬本個案故作廢','23000000-9000-4000-8000-000000000061');
select ok((select version=2 and record_status='voided'
  and record_payload->>'evidence_status'='provided'
  and record_payload->>'evidence_reference_id'='23000000-a000-4000-8000-000000000001'
  and record_payload->>'evidence_sha256'=repeat('a',64)
  and record_payload->>'evidence_file_name'='trusted-vax-proof.pdf'
  and record_payload->>'source_system'='legacy_migration'
  and record_payload->>'source_record_id'='legacy-vax-60'
  from trusted_void_receipt),
  'trusted-origin void copies the exact proof and source chain without downgrade');
insert into corrected_receipt select * from public.append_client_vaccination(
 '23000000-2000-4000-8000-000000000001','23000000-3000-4000-8000-000000000001',
 'correct','23000000-8000-4000-8000-000000000010',
 (select record_version_id from first_receipt),1,
 '23000000-5000-4000-8000-000000000001','COVID-19','第1劑',current_date,
 'LOT-23-A','更正後合成院所','missing',null,null,null,'manual_entry',null,
 '查核接種來源後更正接種院所','23000000-9000-4000-8000-000000000040');
select ok((select version=2 and previous_version_id=(select record_version_id from first_receipt)
  and record_status='active' and duplicate_count=1 and not replayed
  from corrected_receipt),
  'recent same-session AAL2 appends an exact linked correction');
select throws_ok(format($sql$select * from public.append_client_vaccination(
 '23000000-2000-4000-8000-000000000001','23000000-3000-4000-8000-000000000001',
 'correct','23000000-8000-4000-8000-000000000010','%s',1,
 '23000000-5000-4000-8000-000000000001','COVID-19','第1劑',current_date,
 null,'過期版本院所','missing',null,null,null,'manual_entry',null,
 '嘗試以已過期版本再次更正紀錄','23000000-9000-4000-8000-000000000041')$sql$,
 (select record_version_id from first_receipt)),
 '40001','client vaccination version is stale','stale expected terminal version is rejected');
insert into voided_receipt select * from public.append_client_vaccination(
 '23000000-2000-4000-8000-000000000001','23000000-3000-4000-8000-000000000001',
 'void','23000000-8000-4000-8000-000000000010',
 (select record_version_id from corrected_receipt),2,
 '23000000-5000-4000-8000-000000000001',null,null,null,null,null,null,null,null,null,
 null,null,'確認來源不屬此個案故依法作廢','23000000-9000-4000-8000-000000000042');
select ok((select version=3 and previous_version_id=(select record_version_id from corrected_receipt)
  and record_status='voided' and duplicate_count=0 and not duplicate_warning
  from voided_receipt),
  'void appends one terminal version and excludes the record from duplicate warnings');
select throws_ok($$select * from public.append_client_vaccination(
 '23000000-2000-4000-8000-000000000001','23000000-3000-4000-8000-000000000001',
 'void','23000000-8000-4000-8000-000000000010',
 (select record_version_id from voided_receipt),3,
 '23000000-5000-4000-8000-000000000001',null,null,null,null,null,null,null,null,null,
 null,null,'不得再次修改已作廢的終端紀錄','23000000-9000-4000-8000-000000000043')$$,
 '23514','voided client vaccination is terminal','voided terminal cannot receive another version');
reset role;

select ok((select count(*)=3 and min(version)=1 and max(version)=3
  and count(*) filter(where reauth_challenge_id is not null)=2
  and count(distinct evidence_status)=1 and min(evidence_status)='missing'
  from public.client_vaccination_versions
  where vaccination_key='23000000-8000-4000-8000-000000000010'),
  'linear correction and void chain freezes every version, proof state and reauth evidence');
select throws_ok(format($sql$update public.client_vaccination_versions
  set provider_name='不得覆寫' where id='%s'$sql$,
  (select record_version_id from first_receipt)),
  '55000','client vaccination evidence is append-only','version rows cannot be updated');
select throws_ok($$delete from private.client_vaccination_operations
  where result_version_id=(select record_version_id from first_receipt)$$,
  '55000','client vaccination evidence is append-only','single-operation receipts cannot be deleted');
select throws_ok($$update private.client_vaccination_batch_operations
  set request_hash=repeat('0',64) where id=(select batch_id from batch_receipt)$$,
  '55000','client vaccination evidence is append-only','batch receipts cannot be changed');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"23000000-1000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"23000000-7000-4000-8000-000000000001"}',true);
select ok((select record_total=5 and history_total=8 and missing_evidence_total=3
  and duplicate_warning_total=0 and current_month_total=5
  and duplicate_rule_status='configured'
  and duplicate_basis='same_client_normalized_vaccine_and_dose'
  and duplicate_resolution='warning_only_no_auto_merge'
  and medical_interpretation_status='not_evaluated'
  and reminder_schedule_status='not_configured' and reminder_days is null
  and reminder_total is null and attachment_pipeline_status='not_configured'
  and attachment_scan_status='not_configured' and batch_maximum_items=20
  and offline_status='not_configured'
  from public.client_vaccination_snapshot(
    '23000000-2000-4000-8000-000000000001','23000000-3000-4000-8000-000000000001')),
  'strict snapshot metrics and honest capability states use terminal records and full history');
select ok((select record_total=1 and vaccine_total=5
  and (vaccine_options->0 ? 'vaccine_name')
  and (dose_options->0 ? 'dose_number')
  from public.client_vaccination_snapshot(
    '23000000-2000-4000-8000-000000000001','23000000-3000-4000-8000-000000000001',
    null,' COVID-19 ',null,null,null,'all',null)),
  'raw option values round-trip through trimmed exact vaccine filtering');
select ok((select client_total=3 and
  (select count(*) from jsonb_array_elements(client_options) option
    where (option->>'can_record')::boolean)=2
  from public.client_vaccination_snapshot(
    '23000000-2000-4000-8000-000000000001','23000000-3000-4000-8000-000000000001')),
  'client options expose assigned scope and active-client recordability separately');
select is((select record_total from public.client_vaccination_snapshot(
  '23000000-2000-4000-8000-000000000001','23000000-3000-4000-8000-000000000001',
  null,null,null,null,null,'voided',null)),2::bigint,
  'status filter isolates both voided terminals');
select * from public.client_vaccination_snapshot(
  '23000000-2000-4000-8000-000000000001','23000000-3000-4000-8000-000000000001',
  null,null,null,null,null,'all','合成接種院所');
reset role;
select ok(not exists(select 1 from public.audit_events audit
  where audit.table_name='client_vaccination_versions'
    and (audit.metadata::text like '%COVID-19%'
      or audit.metadata::text like '%合成接種院所%')),
  'audit metadata never stores vaccine, provider or search text');
select ok((select count(*)>=8 from public.audit_events audit
  where audit.table_name in ('public.client_vaccination_versions',
    'private.client_vaccination_operations',
    'private.client_vaccination_batch_operations','client_vaccination_versions',
    'client_vaccination_batch_operations')),
  'creates, corrections, voids, batch receipts and reads leave audit evidence');

insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,
 issued_jwt_iat,created_at,expires_at,consumed_at,consumed_jwt_iat,
 factor_method,factor_verified_at) values
 ('23000000-c000-4000-8000-000000000020','23000000-1000-4000-8000-000000000002',
 '23000000-7000-4000-8000-000000000002',repeat('9',64),
 '23000000-c000-4000-8000-000000000021',clock_timestamp()-interval '2 minutes',
 clock_timestamp()-interval '2 minutes',clock_timestamp()+interval '5 minutes',
 clock_timestamp()-interval '30 seconds',clock_timestamp()-interval '30 seconds',
 'totp',clock_timestamp()-interval '30 seconds');
insert into private.reauth_events(user_id,session_id,challenge_id,aal,verification_method,verified_at)
values ('23000000-1000-4000-8000-000000000002',
 '23000000-7000-4000-8000-000000000002','23000000-c000-4000-8000-000000000020',
 'aal2','totp',(select factor_verified_at from private.reauth_challenges
   where id='23000000-c000-4000-8000-000000000020'));
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"23000000-1000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"23000000-7000-4000-8000-000000000002"}',true);
insert into nurse_batch select * from public.append_client_vaccination_batch(
 '23000000-2000-4000-8000-000000000001','23000000-3000-4000-8000-000000000001',
 jsonb_build_array(
  pg_temp.vax_item('23000000-9000-4000-8000-000000000050',
   '23000000-8000-4000-8000-000000000050','23000000-5000-4000-8000-000000000001',
   '破傷風疫苗','追加劑',current_date,'合成接種院所'),
  pg_temp.vax_item('23000000-9000-4000-8000-000000000051',
   '23000000-8000-4000-8000-000000000051','23000000-5000-4000-8000-000000000002',
   '破傷風疫苗','追加劑',current_date,'合成接種院所')),
 '23000000-b000-4000-8000-000000000050');
select ok((select succeeded_total=1 and rejected_total=1
  and results->0->>'status'='created' and results->1->>'status'='rejected'
  and results->1->'error'->>'code'='NOT_AUTHORIZED' from nurse_batch),
  'batch uses the guarded per-item path and explicitly records partial authorization failure');
select ok((select replayed and succeeded_total=1 and rejected_total=1
  and results->0->>'status'='replayed' and results->1->>'status'='rejected'
  from public.append_client_vaccination_batch(
   '23000000-2000-4000-8000-000000000001','23000000-3000-4000-8000-000000000001',
   jsonb_build_array(
    pg_temp.vax_item('23000000-9000-4000-8000-000000000050',
     '23000000-8000-4000-8000-000000000050','23000000-5000-4000-8000-000000000001',
     '破傷風疫苗','追加劑',current_date,'合成接種院所'),
    pg_temp.vax_item('23000000-9000-4000-8000-000000000051',
     '23000000-8000-4000-8000-000000000051','23000000-5000-4000-8000-000000000002',
     '破傷風疫苗','追加劑',current_date,'合成接種院所')),
   '23000000-b000-4000-8000-000000000050')),
  'exact replay re-authorizes successful items but preserves an inaccessible rejected item');
reset role;

update public.client_assignments set starts_at=now()-interval '2 seconds',
  ends_at=now()-interval '1 second'
where assignee_user_id='23000000-1000-4000-8000-000000000002'
  and client_id='23000000-5000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"23000000-1000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"23000000-7000-4000-8000-000000000002"}',true);
select throws_ok($$select * from public.append_client_vaccination_batch(
 '23000000-2000-4000-8000-000000000001','23000000-3000-4000-8000-000000000001',
 jsonb_build_array(
  pg_temp.vax_item('23000000-9000-4000-8000-000000000050',
   '23000000-8000-4000-8000-000000000050','23000000-5000-4000-8000-000000000001',
   '破傷風疫苗','追加劑',current_date,'合成接種院所'),
  pg_temp.vax_item('23000000-9000-4000-8000-000000000051',
   '23000000-8000-4000-8000-000000000051','23000000-5000-4000-8000-000000000002',
   '破傷風疫苗','追加劑',current_date,'合成接種院所')),
 '23000000-b000-4000-8000-000000000050')$$,
 '42501','client vaccination batch replay authority expired',
 'batch replay fails closed after a successful item assignment is revoked');
reset role;

insert into public.client_vaccination_versions(
 id,organization_id,branch_id,client_id,vaccination_key,version,
 previous_version_id,record_status,correction_reason,vaccine_name,
 normalized_vaccine_name,dose_number,normalized_dose_number,vaccinated_on,
 lot_number,provider_name,evidence_status,evidence_reference_id,evidence_sha256,
 evidence_file_name,source_system,source_record_id,source_provenance,payload_hash,
 content_hash,recorded_by,recorded_by_display_name,recorded_at
)
select ('23100000-d000-4000-8000-'||lpad(series::text,12,'0'))::uuid,
 '23000000-2000-4000-8000-000000000001'::uuid,
 '23000000-3000-4000-8000-000000000001'::uuid,
 '23000000-5000-4000-8000-000000000002'::uuid,
 ('23100000-8000-4000-8000-'||lpad(series::text,12,'0'))::uuid,
 1,null,'active',null,'合成容量疫苗 '||series,
 private.normalize_client_vaccination_text('合成容量疫苗 '||series),
 '容量測試劑次','容量測試劑次',current_date-1,null,'合成容量院所',
 'missing',null,null,null,'manual_entry',null,
 '{"schema_version":1,"source_system":"manual_entry","capture_method":"test_fixture","authority":"facility"}'::jsonb,
 repeat('1',64),repeat('2',64),'23000000-1000-4000-8000-000000000001'::uuid,
 '疫苗紀錄主管',clock_timestamp()
from generate_series(1,201) series;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"23000000-1000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"23000000-7000-4000-8000-000000000001"}',true);
select ok((select record_total=207 and jsonb_array_length(records)=200
  and records_truncated and history_total=210 and jsonb_array_length(history)=210
  and not history_truncated
  from public.client_vaccination_snapshot(
    '23000000-2000-4000-8000-000000000001',
    '23000000-3000-4000-8000-000000000001')),
  'history totals cover every matching chain even when the deterministic record page truncates at 200');
reset role;

delete from public.role_permissions grant_row using public.roles role,public.permissions permission
where grant_row.role_id=role.id and grant_row.permission_id=permission.id
  and role.role_key='organization_manager' and role.is_system
  and permission.permission_key='client_vaccinations.manage';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"23000000-1000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"23000000-7000-4000-8000-000000000001"}',true);
select throws_ok($$select * from public.append_client_vaccination(
 '23000000-2000-4000-8000-000000000001','23000000-3000-4000-8000-000000000001',
 'create','23000000-8000-4000-8000-000000000010',null,0,
 '23000000-5000-4000-8000-000000000001','COVID-19','第1劑',current_date,
 'LOT-23-A','合成接種院所','missing',null,null,null,'manual_entry',null,null,
 '23000000-9000-4000-8000-000000000010')$$,
 '42501','client vaccination client is not permitted',
 'single exact replay fails closed after manage permission is revoked');
reset role;

select * from finish();
rollback;
