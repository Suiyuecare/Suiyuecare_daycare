begin;
select plan(49);

select results_eq(
  $$select permission_key collate "C" from public.permissions where permission_key like 'client_reports.%' order by 1$$,
  $$values ('client_reports.manage'::text collate "C"),('client_reports.read'::text collate "C")$$,
  'Page 22 has independent client-report read and manage permissions');
select is((select count(*) from public.role_permissions grant_row
  join public.permissions permission on permission.id=grant_row.permission_id
  where permission.permission_key like 'client_reports.%'),8::bigint,
  'five conservative roles can read and three roles can manage');
select ok((select bool_and(relrowsecurity and relforcerowsecurity) from pg_class where oid in (
  'private.client_report_attachments'::regclass,
  'public.client_inspection_report_versions'::regclass,
  'private.client_inspection_report_operations'::regclass)),
  'all Page-22 evidence tables force RLS');
select ok(not has_table_privilege('authenticated','public.client_inspection_report_versions','select,insert,update,delete')
  and not has_table_privilege('service_role','public.client_inspection_report_versions','select,insert,update,delete')
  and not has_table_privilege('authenticated','private.client_report_attachments','select,insert,update,delete')
  and not has_table_privilege('authenticated','private.client_inspection_report_operations','select,insert,update,delete'),
  'browser and service roles have no direct report or attachment DML');
select ok(has_function_privilege('authenticated',
    'public.append_client_inspection_report(uuid,uuid,jsonb,uuid)','execute')
  and has_function_privilege('authenticated',
    'public.client_inspection_report_snapshot(uuid,uuid,uuid,text,date,date,text,text,text,text,text,text)','execute')
  and not has_function_privilege('service_role',
    'public.append_client_inspection_report(uuid,uuid,jsonb,uuid)','execute'),
  'only authenticated callers receive public Page-22 RPC grants');
select ok(not (select prosecdef from pg_proc where oid=
    'public.append_client_inspection_report(uuid,uuid,jsonb,uuid)'::regprocedure)
  and (select prosecdef and coalesce(proconfig,'{}'::text[]) @> array['search_path=""']
    from pg_proc where oid=
      'private.append_client_inspection_report_guarded(uuid,uuid,jsonb,uuid)'::regprocedure),
  'public mutation wrapper is invoker and guarded core is pinned definer');
select is((select count(*) from pg_trigger where not tgisinternal and tgname in (
  'client_report_attachments_append_only',
  'client_inspection_report_versions_append_only',
  'client_inspection_report_operations_append_only')),3::bigint,
  'attachment, version and operation evidence are append-only');
select is((select count(*) from pg_trigger where not tgisinternal and tgname in (
  'client_report_attachments_audit_row_change',
  'client_inspection_report_versions_audit_row_change',
  'client_inspection_report_operations_audit_row_change')),3::bigint,
  'all Page-22 evidence rows have correctly named insert-audit triggers');
select is((select count(*) from pg_constraint constraint_row
  join pg_class relation on relation.oid=constraint_row.conrelid
  join pg_namespace namespace on namespace.oid=relation.relnamespace
  cross join lateral unnest(constraint_row.conkey) fk_column
  where constraint_row.contype='f' and namespace.nspname in ('public','private')
    and relation.relname in ('client_report_attachments',
      'client_inspection_report_versions','client_inspection_report_operations')
    and not exists(select 1 from pg_index index_row
      where index_row.indrelid=relation.oid and fk_column=any(index_row.indkey))),0::bigint,
  'every Page-22 foreign-key column participates in an index');
select is(private.client_report_attachment_pipeline_enabled(
  '22000000-2000-4000-8000-000000000001',
  '22000000-3000-4000-8000-000000000001'),false,
  'attachment upload and scanning pipeline fails closed until configured');

insert into auth.users(id,aud,role,email,created_at,updated_at) values
 ('22000000-1000-4000-8000-000000000001','authenticated','authenticated','manager22@example.invalid',now(),now()),
 ('22000000-1000-4000-8000-000000000002','authenticated','authenticated','nurse22@example.invalid',now(),now()),
 ('22000000-1000-4000-8000-000000000003','authenticated','authenticated','unassigned22@example.invalid',now(),now()),
 ('22000000-1000-4000-8000-000000000004','authenticated','authenticated','other22@example.invalid',now(),now());
insert into public.organizations(id,code,name) values
 ('22000000-2000-4000-8000-000000000001','report-a','檢查報告測試機構 A'),
 ('22000000-2000-4000-8000-000000000002','report-b','檢查報告測試機構 B');
insert into public.branches(id,organization_id,code,name) values
 ('22000000-3000-4000-8000-000000000001','22000000-2000-4000-8000-000000000001','main','A 主分支'),
 ('22000000-3000-4000-8000-000000000002','22000000-2000-4000-8000-000000000001','other','A 次分支'),
 ('22000000-3000-4000-8000-000000000003','22000000-2000-4000-8000-000000000002','main','B 主分支');
insert into public.profiles(id,display_name,kind) values
 ('22000000-1000-4000-8000-000000000001','檢查報告主管','staff'),
 ('22000000-1000-4000-8000-000000000002','指派護理人員','staff'),
 ('22000000-1000-4000-8000-000000000003','未指派護理人員','staff'),
 ('22000000-1000-4000-8000-000000000004','他機構主管','staff');
insert into public.memberships(id,organization_id,branch_id,profile_id,status) values
 ('22000000-4000-4000-8000-000000000001','22000000-2000-4000-8000-000000000001',null,'22000000-1000-4000-8000-000000000001','active'),
 ('22000000-4000-4000-8000-000000000002','22000000-2000-4000-8000-000000000001','22000000-3000-4000-8000-000000000001','22000000-1000-4000-8000-000000000002','active'),
 ('22000000-4000-4000-8000-000000000003','22000000-2000-4000-8000-000000000001','22000000-3000-4000-8000-000000000001','22000000-1000-4000-8000-000000000003','active'),
 ('22000000-4000-4000-8000-000000000004','22000000-2000-4000-8000-000000000002',null,'22000000-1000-4000-8000-000000000004','active');
insert into public.membership_roles(membership_id,role_id)
select '22000000-4000-4000-8000-000000000001',id from public.roles
where role_key='organization_manager' and is_system;
insert into public.membership_roles(membership_id,role_id)
select '22000000-4000-4000-8000-000000000002',id from public.roles
where role_key='nurse' and is_system;
insert into public.membership_roles(membership_id,role_id)
select '22000000-4000-4000-8000-000000000003',id from public.roles
where role_key='nurse' and is_system;
insert into public.membership_roles(membership_id,role_id)
select '22000000-4000-4000-8000-000000000004',id from public.roles
where role_key='organization_manager' and is_system;
insert into public.clients(id,organization_id,branch_id,client_code,display_name,status,admitted_on) values
 ('22000000-5000-4000-8000-000000000001','22000000-2000-4000-8000-000000000001','22000000-3000-4000-8000-000000000001','R22-1','合成個案甲','active',current_date-90),
 ('22000000-5000-4000-8000-000000000002','22000000-2000-4000-8000-000000000001','22000000-3000-4000-8000-000000000001','R22-2','合成個案乙','active',current_date-90),
 ('22000000-5000-4000-8000-000000000003','22000000-2000-4000-8000-000000000001','22000000-3000-4000-8000-000000000002','R22-3','他分支個案','active',current_date-90),
 ('22000000-5000-4000-8000-000000000004','22000000-2000-4000-8000-000000000002','22000000-3000-4000-8000-000000000003','R22-4','他機構個案','active',current_date-90);
insert into public.client_assignments(id,organization_id,branch_id,client_id,assignee_user_id,assignment_kind) values
 ('22000000-6000-4000-8000-000000000001','22000000-2000-4000-8000-000000000001','22000000-3000-4000-8000-000000000001','22000000-5000-4000-8000-000000000001','22000000-1000-4000-8000-000000000002','clinical-report');

create temporary table first_report as select * from public.append_client_inspection_report(null,null,null,null) with no data;
create temporary table actor_report (like first_report);
create temporary table exact_report (like first_report);
create temporary table key_report (like first_report);
create temporary table corrected_report (like first_report);
create temporary table voided_report (like first_report);
grant select,insert on first_report,actor_report,exact_report,key_report,corrected_report,voided_report to authenticated;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"22000000-1000-4000-8000-000000000002","role":"authenticated","aal":"aal1","session_id":"22000000-7000-4000-8000-000000000002"}',true);
select throws_ok($$select * from public.client_inspection_report_snapshot(
 '22000000-2000-4000-8000-000000000001','22000000-3000-4000-8000-000000000001')$$,
 '42501','client inspection report snapshot is not permitted','AAL1 cannot read client reports');
select throws_ok($$select * from public.append_client_inspection_report(
 '22000000-2000-4000-8000-000000000001','22000000-3000-4000-8000-000000000001',
 jsonb_build_object('action','create','report_key','22000000-8000-4000-8000-000000000001','previous_version_id',null,
 'expected_base_version',0,'client_id','22000000-5000-4000-8000-000000000001','report_type','展示檢查',
 'examined_on',current_date,'result_status','missing','result_text',null,'result_reason','來源尚未提供結果文字',
 'source_status','present','source_text','展示院所','source_reason',null,'attachment_status','missing',
 'attachment_id',null,'attachment_sha256',null,'attachment_source_filename',null,'correction_reason',null),
 '22000000-9000-4000-8000-000000000001')$$,
 '42501','client inspection report client is not permitted','AAL1 cannot create client reports');
select set_config('request.jwt.claims','{"sub":"22000000-1000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"22000000-7000-4000-8000-000000000002"}',true);
select throws_ok($$select * from public.client_inspection_report_snapshot(
 '22000000-2000-4000-8000-000000000001','22000000-3000-4000-8000-000000000002')$$,
 '42501','client inspection report snapshot is not permitted','branch membership cannot cross branches');
select throws_ok($$select * from public.client_inspection_report_snapshot(
 '22000000-2000-4000-8000-000000000001','22000000-3000-4000-8000-000000000001',
 '22000000-5000-4000-8000-000000000002')$$,
 '42501','client inspection report snapshot is not permitted','assigned nurse cannot request an unassigned client');
select set_config('request.jwt.claims','{"sub":"22000000-1000-4000-8000-000000000003","role":"authenticated","aal":"aal2","session_id":"22000000-7000-4000-8000-000000000003"}',true);
select throws_ok($$select * from public.append_client_inspection_report(
 '22000000-2000-4000-8000-000000000001','22000000-3000-4000-8000-000000000001',
 jsonb_build_object('action','create','report_key','22000000-8000-4000-8000-000000000002','previous_version_id',null,
 'expected_base_version',0,'client_id','22000000-5000-4000-8000-000000000001','report_type','展示檢查',
 'examined_on',current_date,'result_status','missing','result_text',null,'result_reason','來源尚未提供結果文字',
 'source_status','present','source_text','展示院所','source_reason',null,'attachment_status','missing',
 'attachment_id',null,'attachment_sha256',null,'attachment_source_filename',null,'correction_reason',null),
 '22000000-9000-4000-8000-000000000002')$$,
 '42501','client inspection report client is not permitted','unassigned nurse cannot create for another client');

select set_config('request.jwt.claims','{"sub":"22000000-1000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"22000000-7000-4000-8000-000000000001"}',true);
insert into first_report select * from public.append_client_inspection_report(
 '22000000-2000-4000-8000-000000000001','22000000-3000-4000-8000-000000000001',
 jsonb_build_object('action','create','report_key','22000000-8000-4000-8000-000000000010','previous_version_id',null,
 'expected_base_version',0,'client_id','22000000-5000-4000-8000-000000000001','report_type','合成胸部影像報告',
 'examined_on',current_date-10,'result_status','present','result_text','合成檢查結果原文','result_reason',null,
 'source_status','present','source_text','合成檢查院所','source_reason',null,'attachment_status','missing',
 'attachment_id',null,'attachment_sha256',null,'attachment_source_filename',null,'correction_reason',null),
 '22000000-9000-4000-8000-000000000010');
select ok((select version=1 and record_status='active' and not replayed
  and not duplicate_warning from first_report),
  'create appends one active original version without requiring recent reauthentication');
reset role;
select ok((select result_status='present' and result_text='合成檢查結果原文'
  and result_reason is null and source_status='present' and source_text='合成檢查院所'
  and source_reason is null and attachment_status='missing' and attachment_id is null
  from public.client_inspection_report_versions where id=(select record_version_id from first_report)),
  'stored report preserves explicit result, source and attachment states');
select ok((select payload_hash ~ '^[a-f0-9]{64}$' and content_hash ~ '^[a-f0-9]{64}$'
  and payload_hash<>content_hash from public.client_inspection_report_versions
  where id=(select record_version_id from first_report)),
  'business payload and immutable record hashes are both frozen');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"22000000-1000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"22000000-7000-4000-8000-000000000001"}',true);
select is((select replayed from public.append_client_inspection_report(
 '22000000-2000-4000-8000-000000000001','22000000-3000-4000-8000-000000000001',
 jsonb_build_object('action','create','report_key','22000000-8000-4000-8000-000000000010','previous_version_id',null,
 'expected_base_version',0,'client_id','22000000-5000-4000-8000-000000000001','report_type','合成胸部影像報告',
 'examined_on',current_date-10,'result_status','present','result_text','合成檢查結果原文','result_reason',null,
 'source_status','present','source_text','合成檢查院所','source_reason',null,'attachment_status','missing',
 'attachment_id',null,'attachment_sha256',null,'attachment_source_filename',null,'correction_reason',null),
 '22000000-9000-4000-8000-000000000010')),true,
 'same actor and exact request receives the original receipt');
select throws_ok($$select * from public.append_client_inspection_report(
 '22000000-2000-4000-8000-000000000001','22000000-3000-4000-8000-000000000001',
 jsonb_build_object('action','create','report_key','22000000-8000-4000-8000-000000000010','previous_version_id',null,
 'expected_base_version',0,'client_id','22000000-5000-4000-8000-000000000001','report_type','不同內容',
 'examined_on',current_date-10,'result_status','missing','result_text',null,'result_reason','這是不同內容的缺值理由',
 'source_status','present','source_text','合成檢查院所','source_reason',null,'attachment_status','missing',
 'attachment_id',null,'attachment_sha256',null,'attachment_source_filename',null,'correction_reason',null),
 '22000000-9000-4000-8000-000000000010')$$,
 '23505','client inspection report idempotency conflict','same actor key with different content conflicts');

select set_config('request.jwt.claims','{"sub":"22000000-1000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"22000000-7000-4000-8000-000000000002"}',true);
insert into actor_report select * from public.append_client_inspection_report(
 '22000000-2000-4000-8000-000000000001','22000000-3000-4000-8000-000000000001',
 jsonb_build_object('action','create','report_key','22000000-8000-4000-8000-000000000011','previous_version_id',null,
 'expected_base_version',0,'client_id','22000000-5000-4000-8000-000000000001','report_type','合成其他檢查',
 'examined_on',current_date-3,'result_status','not_applicable','result_text',null,'result_reason','此項僅保存完成狀態故不適用',
 'source_status','missing','source_text',null,'source_reason','來源單位仍待人工確認補齊','attachment_status','not_applicable',
 'attachment_id',null,'attachment_sha256',null,'attachment_source_filename',null,'correction_reason',null),
 '22000000-9000-4000-8000-000000000010');
select ok((select version=1 and not replayed from actor_report),
  'the same idempotency key is independently scoped to a different actor');

select set_config('request.jwt.claims','{"sub":"22000000-1000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"22000000-7000-4000-8000-000000000001"}',true);
select throws_ok($$select * from public.append_client_inspection_report(
 '22000000-2000-4000-8000-000000000001','22000000-3000-4000-8000-000000000001',
 jsonb_build_object('action','create','report_key','22000000-8000-4000-8000-000000000012','previous_version_id',null,
 'expected_base_version',0,'client_id','22000000-5000-4000-8000-000000000001','report_type','合成附件檢查',
 'examined_on',current_date,'result_status','missing','result_text',null,'result_reason','來源尚未提供結果文字',
 'source_status','present','source_text','合成檢查院所','source_reason',null,'attachment_status','provided',
 'attachment_id','22000000-a000-4000-8000-000000000099','attachment_sha256',repeat('9',64),
 'attachment_source_filename','untrusted.pdf','correction_reason',null),
 '22000000-9000-4000-8000-000000000012')$$,
 '42501','client inspection report attachment pipeline is not configured',
 'arbitrary attachment identifiers cannot masquerade as stored evidence');
reset role;
insert into private.client_report_attachments(id,organization_id,branch_id,client_id,sha256,
 source_filename,storage_status,scan_status,registered_by) values
 ('22000000-a000-4000-8000-000000000001','22000000-2000-4000-8000-000000000001',
 '22000000-3000-4000-8000-000000000001','22000000-5000-4000-8000-000000000001',repeat('a',64),
 'trusted-but-disabled.pdf','stored','clean','22000000-1000-4000-8000-000000000001');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"22000000-1000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"22000000-7000-4000-8000-000000000001"}',true);
select throws_ok($$select * from public.append_client_inspection_report(
 '22000000-2000-4000-8000-000000000001','22000000-3000-4000-8000-000000000001',
 jsonb_build_object('action','create','report_key','22000000-8000-4000-8000-000000000013','previous_version_id',null,
 'expected_base_version',0,'client_id','22000000-5000-4000-8000-000000000001','report_type','合成附件檢查',
 'examined_on',current_date,'result_status','missing','result_text',null,'result_reason','來源尚未提供結果文字',
 'source_status','present','source_text','合成檢查院所','source_reason',null,'attachment_status','provided',
 'attachment_id','22000000-a000-4000-8000-000000000001','attachment_sha256',repeat('a',64),
 'attachment_source_filename','trusted-but-disabled.pdf','correction_reason',null),
 '22000000-9000-4000-8000-000000000013')$$,
 '42501','client inspection report attachment pipeline is not configured',
 'even registry metadata cannot be newly attached while upload and scanning are disabled');
select throws_ok($$select * from public.append_client_inspection_report(
 '22000000-2000-4000-8000-000000000001','22000000-3000-4000-8000-000000000001',
 jsonb_build_object('action','create','report_key','22000000-8000-4000-8000-000000000014','previous_version_id',null,
 'expected_base_version',0,'client_id','22000000-5000-4000-8000-000000000001','report_type','狀態驗證',
 'examined_on',current_date,'result_status','missing','result_text',null,'result_reason','',
 'source_status','present','source_text','合成檢查院所','source_reason',null,'attachment_status','missing',
 'attachment_id',null,'attachment_sha256',null,'attachment_source_filename',null,'correction_reason',null),
 '22000000-9000-4000-8000-000000000014')$$,
 '22023','client inspection report content is invalid','missing result requires a non-empty reason');

insert into exact_report select * from public.append_client_inspection_report(
 '22000000-2000-4000-8000-000000000001','22000000-3000-4000-8000-000000000001',
 jsonb_build_object('action','create','report_key','22000000-8000-4000-8000-000000000020','previous_version_id',null,
 'expected_base_version',0,'client_id','22000000-5000-4000-8000-000000000001','report_type','合成胸部影像報告',
 'examined_on',current_date-10,'result_status','present','result_text','合成檢查結果原文','result_reason',null,
 'source_status','present','source_text','合成檢查院所','source_reason',null,'attachment_status','missing',
 'attachment_id',null,'attachment_sha256',null,'attachment_source_filename',null,'correction_reason',null),
 '22000000-9000-4000-8000-000000000020');
select ok((select exact_duplicate_count=1 and key_field_duplicate_count=1
  and attachment_duplicate_count=0 and duplicate_warning from exact_report),
  'identical business content produces an explainable exact and key warning');
insert into key_report select * from public.append_client_inspection_report(
 '22000000-2000-4000-8000-000000000001','22000000-3000-4000-8000-000000000001',
 jsonb_build_object('action','create','report_key','22000000-8000-4000-8000-000000000021','previous_version_id',null,
 'expected_base_version',0,'client_id','22000000-5000-4000-8000-000000000001','report_type','合成胸部影像報告',
 'examined_on',current_date-10,'result_status','missing','result_text',null,'result_reason','原始來源尚未提供檢查結果',
 'source_status','present','source_text','合成檢查院所','source_reason',null,'attachment_status','missing',
 'attachment_id',null,'attachment_sha256',null,'attachment_source_filename',null,'correction_reason',null),
 '22000000-9000-4000-8000-000000000021');
select ok((select exact_duplicate_count=0 and key_field_duplicate_count=2
  and attachment_duplicate_count=0 and duplicate_warning from key_report),
  'same client type date and source warns separately without auto-merging');

select ok((select record_total=4 and active_total=4 and voided_total=0
  and missing_result_total=1 and missing_attachment_total=3
  and duplicate_warning_total=3 and jsonb_array_length(records)=4
  from public.client_inspection_report_snapshot(
    '22000000-2000-4000-8000-000000000001','22000000-3000-4000-8000-000000000001')),
  'snapshot totals use the complete matching terminal set');
select is((select record_total from public.client_inspection_report_snapshot(
  '22000000-2000-4000-8000-000000000001','22000000-3000-4000-8000-000000000001',
  null,null,null,null,'all','all','all','all','exact',null)),2::bigint,
  'exact duplicate filter returns both matching terminal reports');
select is((select record_total from public.client_inspection_report_snapshot(
  '22000000-2000-4000-8000-000000000001','22000000-3000-4000-8000-000000000001',
  null,null,null,null,'all','missing','all','all','all',null)),1::bigint,
  'result tri-state filter distinguishes missing from present and not applicable');
select ok((select (record->>'exact_duplicate_count')::integer=1
  and (record->>'key_field_duplicate_count')::integer=2
  and jsonb_array_length(record->'duplicate_bases')=2
  and jsonb_array_length(record->'duplicate_matches')=3
  from public.client_inspection_report_snapshot(
    '22000000-2000-4000-8000-000000000001','22000000-3000-4000-8000-000000000001') snapshot,
    lateral jsonb_array_elements(snapshot.records) record
  where record->>'report_key'='22000000-8000-4000-8000-000000000010'),
  'snapshot explains exact and key matches without merging report identities');
select is((select history_total from public.client_inspection_report_snapshot(
  '22000000-2000-4000-8000-000000000001','22000000-3000-4000-8000-000000000001')),
  4::bigint,'snapshot initially exposes one immutable version per visible report');

select throws_ok(format($sql$select * from public.append_client_inspection_report(
 '22000000-2000-4000-8000-000000000001','22000000-3000-4000-8000-000000000001',
 jsonb_build_object('action','correct','report_key','22000000-8000-4000-8000-000000000010',
 'previous_version_id','%s','expected_base_version',1,'client_id','22000000-5000-4000-8000-000000000001',
 'report_type','合成胸部影像報告','examined_on',current_date-10,'result_status','present',
 'result_text','合成更正後檢查結果原文','result_reason',null,'source_status','present','source_text','合成檢查院所',
 'source_reason',null,'attachment_status','missing','attachment_id',null,'attachment_sha256',null,
 'attachment_source_filename',null,'correction_reason','查核來源文件後補正結果文字'),
 '22000000-9000-4000-8000-000000000030')$sql$,(select record_version_id from first_report)),
 '42501','current same-session recent AAL2 evidence is required',
 'correction fails without recent same-session AAL2');
reset role;

insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,
 issued_jwt_iat,created_at,expires_at,consumed_at,consumed_jwt_iat,factor_method,factor_verified_at) values
 ('22000000-b000-4000-8000-000000000001','22000000-1000-4000-8000-000000000001',
 '22000000-7000-4000-8000-000000000001',repeat('b',64),'22000000-b000-4000-8000-000000000002',
 clock_timestamp()-interval '2 minutes',clock_timestamp()-interval '2 minutes',clock_timestamp()+interval '5 minutes',
 clock_timestamp()-interval '30 seconds',clock_timestamp()-interval '30 seconds','totp',clock_timestamp()-interval '30 seconds');
insert into private.reauth_events(user_id,session_id,challenge_id,aal,verification_method,verified_at) values
 ('22000000-1000-4000-8000-000000000001','22000000-7000-4000-8000-000000000001',
 '22000000-b000-4000-8000-000000000001','aal2','totp',
 (select factor_verified_at from private.reauth_challenges where id='22000000-b000-4000-8000-000000000001'));

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"22000000-1000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"22000000-7000-4000-8000-000000000001"}',true);
insert into corrected_report select * from public.append_client_inspection_report(
 '22000000-2000-4000-8000-000000000001','22000000-3000-4000-8000-000000000001',
 jsonb_build_object('action','correct','report_key','22000000-8000-4000-8000-000000000010',
 'previous_version_id',(select record_version_id from first_report),'expected_base_version',1,
 'client_id','22000000-5000-4000-8000-000000000001','report_type','合成胸部影像報告',
 'examined_on',current_date-10,'result_status','present','result_text','合成更正後檢查結果原文','result_reason',null,
 'source_status','present','source_text','合成檢查院所','source_reason',null,'attachment_status','missing',
 'attachment_id',null,'attachment_sha256',null,'attachment_source_filename',null,
 'correction_reason','查核來源文件後補正結果文字'),
 '22000000-9000-4000-8000-000000000030');
select ok((select version=2 and previous_version_id=(select record_version_id from first_report)
  and record_status='active' and not replayed from corrected_report),
  'recent AAL2 appends a correction linked to the exact terminal version');
reset role;
select ok((select count(*)=2 and count(*) filter (where reauth_challenge_id is not null)=1
  and count(*) filter (where correction_reason='查核來源文件後補正結果文字')=1
  from public.client_inspection_report_versions
  where report_key='22000000-8000-4000-8000-000000000010'),
  'correction preserves both versions and freezes reauthentication evidence');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"22000000-1000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"22000000-7000-4000-8000-000000000001"}',true);
select throws_ok(format($sql$select * from public.append_client_inspection_report(
 '22000000-2000-4000-8000-000000000001','22000000-3000-4000-8000-000000000001',
 jsonb_build_object('action','correct','report_key','22000000-8000-4000-8000-000000000010',
 'previous_version_id','%s','expected_base_version',1,'client_id','22000000-5000-4000-8000-000000000001',
 'report_type','合成胸部影像報告','examined_on',current_date-10,'result_status','present','result_text','舊版更正',
 'result_reason',null,'source_status','present','source_text','合成檢查院所','source_reason',null,
 'attachment_status','missing','attachment_id',null,'attachment_sha256',null,'attachment_source_filename',null,
 'correction_reason','使用過期終端版本嘗試更正'),
 '22000000-9000-4000-8000-000000000031')$sql$,(select record_version_id from first_report)),
 '40001','client inspection report version is stale','stale expected terminal version is rejected');

insert into voided_report select * from public.append_client_inspection_report(
 '22000000-2000-4000-8000-000000000001','22000000-3000-4000-8000-000000000001',
 jsonb_build_object('action','void','report_key','22000000-8000-4000-8000-000000000010',
 'previous_version_id',(select record_version_id from corrected_report),'expected_base_version',2,
 'client_id','22000000-5000-4000-8000-000000000001','correction_reason','確認來源文件並非此個案故依法作廢'),
 '22000000-9000-4000-8000-000000000032');
select ok((select version=3 and record_status='voided' and exact_duplicate_count=0
  and key_field_duplicate_count=0 and attachment_duplicate_count=0
  and not duplicate_warning from voided_report),
  'void appends a terminal version and suppresses duplicate classification');
select throws_ok($$select * from public.append_client_inspection_report(
 '22000000-2000-4000-8000-000000000001','22000000-3000-4000-8000-000000000001',
 jsonb_build_object('action','void','report_key','22000000-8000-4000-8000-000000000010',
 'previous_version_id',(select record_version_id from voided_report),'expected_base_version',3,
 'client_id','22000000-5000-4000-8000-000000000001','correction_reason','不得再次修改已作廢的終端版本'),
 '22000000-9000-4000-8000-000000000033')$$,
 '23514','voided client inspection report is terminal','voided terminal cannot receive another version');
reset role;

select throws_ok(format($sql$update public.client_inspection_report_versions
  set report_type='不得覆寫' where id='%s'$sql$,(select record_version_id from first_report)),
  '55000','client inspection report history is append-only','report versions cannot be updated');
select throws_ok(format($sql$delete from public.client_inspection_report_versions
  where id='%s'$sql$,(select record_version_id from first_report)),
  '55000','client inspection report history is append-only','report versions cannot be deleted');
select throws_ok($$update private.client_inspection_report_operations
  set request_hash=repeat('0',64) where result_version_id=(select record_version_id from first_report)$$,
  '55000','client inspection report history is append-only','operation receipts cannot be changed');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"22000000-1000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"22000000-7000-4000-8000-000000000001"}',true);
select ok((select record_total=4 and active_total=3 and voided_total=1
  and duplicate_warning_total=2 and history_total=6
  from public.client_inspection_report_snapshot(
    '22000000-2000-4000-8000-000000000001','22000000-3000-4000-8000-000000000001')),
  'post-void metrics and history use one terminal per report and every immutable version');
select is((select record_total from public.client_inspection_report_snapshot(
  '22000000-2000-4000-8000-000000000001','22000000-3000-4000-8000-000000000001',
  null,'合成胸部影像報告',current_date-10,current_date-10,'all','all','all','all','all',null)),
  3::bigint,'client type and inclusive date filters have exact semantics');
select is((select record_total from public.client_inspection_report_snapshot(
  '22000000-2000-4000-8000-000000000001','22000000-3000-4000-8000-000000000001',
  null,null,null,null,'voided','all','all','all','all',null)),
  1::bigint,'record-status filter isolates the voided terminal');
select is((select record_total from public.client_inspection_report_snapshot(
  '22000000-2000-4000-8000-000000000001','22000000-3000-4000-8000-000000000001',
  null,null,null,null,'all','all','missing','all','all',null)),
  1::bigint,'source tri-state filter isolates an explicitly missing source');
select is((select attachment_pipeline_status from public.client_inspection_report_snapshot(
  '22000000-2000-4000-8000-000000000001','22000000-3000-4000-8000-000000000001')),
  'not_configured','snapshot declares attachment pipeline unavailable');
select * from public.client_inspection_report_snapshot(
  '22000000-2000-4000-8000-000000000001','22000000-3000-4000-8000-000000000001',
  null,null,null,null,'all','all','all','all','all','合成更正後檢查結果原文');
reset role;
select ok(not exists(select 1 from public.audit_events audit
  where audit.table_name='client_inspection_report_versions' and audit.action='select'
    and (audit.metadata::text like '%合成更正後檢查結果原文%'
      or audit.metadata::text like '%合成檢查院所%')),
  'read audit never stores result content, source text, or search keywords');
select ok((select count(*) >= 6 from public.audit_events audit
  where audit.table_name in ('public.client_inspection_report_versions',
    'private.client_inspection_report_operations','client_inspection_report_versions')),
  'creates, corrections, voids, operations and reads leave audit evidence');

update public.client_assignments set starts_at=now()-interval '2 seconds',
  ends_at=now()-interval '1 second'
where assignee_user_id='22000000-1000-4000-8000-000000000002'
  and client_id='22000000-5000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"22000000-1000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"22000000-7000-4000-8000-000000000002"}',true);
select throws_ok($$select * from public.append_client_inspection_report(
 '22000000-2000-4000-8000-000000000001','22000000-3000-4000-8000-000000000001',
 jsonb_build_object('action','create','report_key','22000000-8000-4000-8000-000000000011','previous_version_id',null,
 'expected_base_version',0,'client_id','22000000-5000-4000-8000-000000000001','report_type','合成其他檢查',
 'examined_on',current_date-3,'result_status','not_applicable','result_text',null,'result_reason','此項僅保存完成狀態故不適用',
 'source_status','missing','source_text',null,'source_reason','來源單位仍待人工確認補齊','attachment_status','not_applicable',
 'attachment_id',null,'attachment_sha256',null,'attachment_source_filename',null,'correction_reason',null),
 '22000000-9000-4000-8000-000000000010')$$,
 '42501','client inspection report client is not permitted',
 'exact replay fails closed after client assignment is revoked');
reset role;

delete from public.role_permissions grant_row using public.roles role, public.permissions permission
where grant_row.role_id=role.id and grant_row.permission_id=permission.id
  and role.role_key='organization_manager' and role.is_system
  and permission.permission_key='client_reports.manage';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"22000000-1000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"22000000-7000-4000-8000-000000000001"}',true);
select throws_ok($$select * from public.append_client_inspection_report(
 '22000000-2000-4000-8000-000000000001','22000000-3000-4000-8000-000000000001',
 jsonb_build_object('action','create','report_key','22000000-8000-4000-8000-000000000010','previous_version_id',null,
 'expected_base_version',0,'client_id','22000000-5000-4000-8000-000000000001','report_type','合成胸部影像報告',
 'examined_on',current_date-10,'result_status','present','result_text','合成檢查結果原文','result_reason',null,
 'source_status','present','source_text','合成檢查院所','source_reason',null,'attachment_status','missing',
 'attachment_id',null,'attachment_sha256',null,'attachment_source_filename',null,'correction_reason',null),
 '22000000-9000-4000-8000-000000000010')$$,
 '42501','client inspection report client is not permitted',
 'exact replay fails closed after manage permission is revoked');
reset role;

select * from finish();
rollback;
