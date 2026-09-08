begin;

select plan(36);

-- 1
select results_eq(
  $$select permission_key collate "C" from public.permissions
    where permission_key like 'document_printing.%'
    order by permission_key collate "C"$$,
  $$values
    ('document_printing.access'::text collate "C"),
    ('document_printing.manage'::text collate "C"),
    ('document_printing.read'::text collate "C")$$,
  'Page 62 exposes three narrow document-printing permissions'
);

-- 2
select ok(
  to_regclass('public.document_template_versions') is not null
  and to_regclass('public.document_print_jobs') is not null
  and to_regclass('private.document_print_operations') is not null
  and to_regclass('private.document_print_access_events') is not null,
  'Page 62 has dedicated immutable template, job, receipt, and access stores'
);

-- 3
select is((select count(*)::integer from pg_class where oid in (
  'public.document_template_versions'::regclass,
  'public.document_print_jobs'::regclass,
  'private.document_print_operations'::regclass,
  'private.document_print_access_events'::regclass
) and relrowsecurity and relforcerowsecurity), 4,
  'all Page-62 stores force RLS');

-- 4
select ok(
  not has_table_privilege('authenticated','public.document_template_versions','select,insert,update,delete')
  and not has_table_privilege('authenticated','public.document_print_jobs','select,insert,update,delete')
  and not has_table_privilege('service_role','private.document_print_operations','select,insert,update,delete')
  and not has_table_privilege('authenticated','private.document_print_access_events','select,insert,update,delete'),
  'browser and service roles cannot bypass Page-62 RPCs'
);

-- 5
select ok(
  has_function_privilege('authenticated','public.create_document_print_job(uuid,uuid,uuid,uuid,date,uuid)','execute')
  and has_function_privilege('authenticated','public.document_printing_snapshot(uuid,uuid)','execute')
  and has_function_privilege('authenticated','public.access_document_print_job(uuid,uuid,uuid,text)','execute')
  and not has_function_privilege('anon','public.document_printing_snapshot(uuid,uuid)','execute')
  and not has_function_privilege('service_role','public.create_document_print_job(uuid,uuid,uuid,uuid,date,uuid)','execute'),
  'only authenticated callers receive the narrow public Page-62 RPC surface'
);

-- 6
select ok(
  not (select prosecdef from pg_proc where oid='public.create_document_print_job(uuid,uuid,uuid,uuid,date,uuid)'::regprocedure)
  and not (select prosecdef from pg_proc where oid='public.document_printing_snapshot(uuid,uuid)'::regprocedure)
  and not (select prosecdef from pg_proc where oid='public.access_document_print_job(uuid,uuid,uuid,text)'::regprocedure)
  and (select prosecdef and coalesce(proconfig,'{}'::text[]) @> array['search_path=""']
    from pg_proc where oid='private.create_document_print_job_guarded(uuid,uuid,uuid,uuid,date,uuid)'::regprocedure)
  and (select prosecdef and coalesce(proconfig,'{}'::text[]) @> array['search_path=""']
    from pg_proc where oid='private.document_printing_snapshot_response(uuid,uuid)'::regprocedure)
  and (select prosecdef and coalesce(proconfig,'{}'::text[]) @> array['search_path=""']
    from pg_proc where oid='private.access_document_print_job_guarded(uuid,uuid,uuid,text)'::regprocedure),
  'public wrappers are invokers and private cores are pinned definers'
);

-- 7
select is((select count(*)::integer from pg_trigger where not tgisinternal
  and tgname in (
    'document_template_versions_append_only',
    'document_print_jobs_append_only',
    'document_print_operations_append_only',
    'document_print_access_events_append_only'
  )), 4, 'all Page-62 evidence stores reject update and delete');

-- 8
select is((select count(*)::integer from pg_trigger where not tgisinternal
  and tgname in (
    'document_template_versions_audit_row_change',
    'document_print_jobs_audit_row_change',
    'document_print_access_events_audit_row_change'
  )), 3, 'template, job, and access inserts are audited');

-- 9
select ok(exists(
  select 1 from pg_indexes
  where schemaname='private' and tablename='document_print_operations'
    and indexdef ~ '\(client_id\)'
), 'operation client foreign-key participation has a supporting index');

-- 10
select is((select count(*)::integer from public.document_template_versions), 0,
  'migration seeds no guessed official template or font asset');

-- 11
select ok(not private.document_template_definition_is_valid(
  '{"schema_version":1,"sections":[{"heading":"合成段落","rows":[{"label":"未知欄位","source_key":"client.unknown"}]}]}'::jsonb
), 'unknown source keys are rejected instead of being evaluated dynamically');

-- 12
select ok(not private.document_template_definition_is_valid(
  '{"schema_version":1,"sections":[{"heading":"合成段落","rows":[{"label":"姓名","source_key":"client.display_name","unsafe":"x"}]}]}'::jsonb
), 'template definition rejects undeclared fields');

-- Synthetic identities and tenant data only.
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
  ('00000000-0000-0000-0000-000000000000','62010000-0000-4000-8000-000000000001','authenticated','authenticated','page62-manager-a@example.invalid','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','62010000-0000-4000-8000-000000000002','authenticated','authenticated','page62-manager-b@example.invalid','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','62010000-0000-4000-8000-000000000003','authenticated','authenticated','page62-worker@example.invalid','',now(),'{}','{}',now(),now());

insert into public.organizations(id,code,name) values
  ('62020000-0000-4000-8000-000000000001','page62_a','文件列印合成機構甲'),
  ('62020000-0000-4000-8000-000000000002','page62_b','文件列印合成機構乙');
insert into public.branches(id,organization_id,code,name) values
  ('62030000-0000-4000-8000-000000000001','62020000-0000-4000-8000-000000000001','main','文件列印合成分支甲'),
  ('62030000-0000-4000-8000-000000000002','62020000-0000-4000-8000-000000000002','main','文件列印合成分支乙');
insert into public.profiles(id,display_name,kind,employee_code) values
  ('62010000-0000-4000-8000-000000000001','合成列印主管甲','staff','P62-A'),
  ('62010000-0000-4000-8000-000000000002','合成列印主管乙','staff','P62-B'),
  ('62010000-0000-4000-8000-000000000003','合成無權限照服員','staff','P62-C');
insert into public.memberships(id,organization_id,branch_id,profile_id,status) values
  ('62040000-0000-4000-8000-000000000001','62020000-0000-4000-8000-000000000001','62030000-0000-4000-8000-000000000001','62010000-0000-4000-8000-000000000001','active'),
  ('62040000-0000-4000-8000-000000000002','62020000-0000-4000-8000-000000000002','62030000-0000-4000-8000-000000000002','62010000-0000-4000-8000-000000000002','active'),
  ('62040000-0000-4000-8000-000000000003','62020000-0000-4000-8000-000000000001','62030000-0000-4000-8000-000000000001','62010000-0000-4000-8000-000000000003','active');
insert into public.membership_roles(membership_id,role_id) values
  ('62040000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002'),
  ('62040000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002'),
  ('62040000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000006');

insert into public.clients(
  id,organization_id,branch_id,client_code,display_name,status,admitted_on,ended_on
) values
  ('62060000-0000-4000-8000-000000000001','62020000-0000-4000-8000-000000000001','62030000-0000-4000-8000-000000000001','P62-A-001','合成列印個案甲','active',current_date-30,null),
  ('62060000-0000-4000-8000-000000000002','62020000-0000-4000-8000-000000000002','62030000-0000-4000-8000-000000000002','P62-B-001','合成列印個案乙','active',current_date-30,null);
insert into public.client_assignments(
  id,organization_id,branch_id,client_id,assignee_user_id,assignment_kind
) values
  ('62061000-0000-4000-8000-000000000001','62020000-0000-4000-8000-000000000001','62030000-0000-4000-8000-000000000001','62060000-0000-4000-8000-000000000001','62010000-0000-4000-8000-000000000001','document-printing'),
  ('62061000-0000-4000-8000-000000000002','62020000-0000-4000-8000-000000000002','62030000-0000-4000-8000-000000000002','62060000-0000-4000-8000-000000000002','62010000-0000-4000-8000-000000000002','document-printing');

insert into private.reauth_challenges(
  id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,
  created_at,expires_at,consumed_at,consumed_jwt_iat,factor_method,factor_verified_at
) values
  ('62050000-0000-4000-8000-000000000001','62010000-0000-4000-8000-000000000001','62051000-0000-4000-8000-000000000001',repeat('a',64),'62052000-0000-4000-8000-000000000001',now()-interval '2 minutes',now()-interval '2 minutes',now()+interval '5 minutes',now()-interval '30 seconds',now()-interval '30 seconds','totp',now()-interval '30 seconds'),
  ('62050000-0000-4000-8000-000000000002','62010000-0000-4000-8000-000000000002','62051000-0000-4000-8000-000000000002',repeat('b',64),'62052000-0000-4000-8000-000000000002',now()-interval '2 minutes',now()-interval '2 minutes',now()+interval '5 minutes',now()-interval '30 seconds',now()-interval '30 seconds','totp',now()-interval '30 seconds');
insert into private.reauth_events(user_id,session_id,challenge_id,aal,verification_method,verified_at) values
  ('62010000-0000-4000-8000-000000000001','62051000-0000-4000-8000-000000000001','62050000-0000-4000-8000-000000000001','aal2','totp',now()-interval '30 seconds'),
  ('62010000-0000-4000-8000-000000000002','62051000-0000-4000-8000-000000000002','62050000-0000-4000-8000-000000000002','aal2','totp',now()-interval '30 seconds');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"62010000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1","session_id":"62051000-0000-4000-8000-000000000001"}',true);

-- 13
select throws_ok($$select * from public.create_document_print_job(
  '62020000-0000-4000-8000-000000000001','62030000-0000-4000-8000-000000000001',
  '62070000-0000-4000-8000-000000000001','62060000-0000-4000-8000-000000000001',
  current_date,'62080000-0000-4000-8000-000000000001')$$,
  '42501','document print job is not permitted',
  'AAL1 is rejected before template content is inspected');

select set_config('request.jwt.claims','{"sub":"62010000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"62051000-0000-4000-8000-000000000001"}',true);

-- 14
select throws_ok($$select * from public.create_document_print_job(
  '62020000-0000-4000-8000-000000000002','62030000-0000-4000-8000-000000000002',
  '62070000-0000-4000-8000-000000000002','62060000-0000-4000-8000-000000000002',
  current_date,'62080000-0000-4000-8000-000000000002')$$,
  '42501','document print job is not permitted',
  'cross-tenant scope is rejected before template content is inspected');

-- 15
select ok((select payload->>'template_total'='0'
  and payload->>'client_total'='1' and payload->>'job_total'='0'
  and payload->>'template_governance_status'='not_configured'
  and payload->>'pdf_renderer_status'='available'
  and payload->>'font_asset_status'='not_configured'
  and payload->>'attachment_status'='not_configured'
  and payload->>'export_status'='pdf_only'
  and payload->>'offline_status'='disabled'
  from public.document_printing_snapshot(
    '62020000-0000-4000-8000-000000000001','62030000-0000-4000-8000-000000000001')),
  'empty snapshot invents no approved template, font, attachment, or offline capability');

reset role;
insert into public.document_template_versions(
  id,organization_id,branch_id,template_key,version,status,title,
  effective_from,effective_to,definition,watermark_text,footer_note,
  font_bucket,font_object_path,font_sha256,approved_by,approved_at,
  content_hash,created_at
) values (
  '62070000-0000-4000-8000-000000000001',
  '62020000-0000-4000-8000-000000000001',
  '62030000-0000-4000-8000-000000000001',
  'synthetic_client_summary',1,'approved','合成個案摘要',
  clock_timestamp()-interval '1 hour',null,
  '{"schema_version":1,"sections":[{"heading":"基本資料","rows":[{"label":"個案姓名","source_key":"client.display_name"},{"label":"個案代碼","source_key":"client.client_code"},{"label":"結案日期","source_key":"client.ended_on"},{"label":"文件日期","source_key":"document.date"}]}]}'::jsonb,
  '合成測試文件','僅供合成測試，不代表官方表單。',
  'private-doc-fonts','synthetic/page62/NotoSansTC.ttf',repeat('b',64),
  '62010000-0000-4000-8000-000000000001',clock_timestamp()-interval '2 hours',
  repeat('c',64),clock_timestamp()
);

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"62010000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"62051000-0000-4000-8000-000000000001"}',true);

-- 16
select ok((select payload->>'template_total'='1'
  and payload->'templates'->0->>'version_id'='62070000-0000-4000-8000-000000000001'
  and payload->'templates'->0->>'content_hash'=repeat('c',64)
  and payload->>'template_governance_status'='configured'
  and payload->>'font_asset_status'='configured'
  from public.document_printing_snapshot(
    '62020000-0000-4000-8000-000000000001','62030000-0000-4000-8000-000000000001')),
  'snapshot exposes exactly one governed current template and its immutable hash');

create temporary table page62_create as select *
from public.create_document_print_job(
  '62020000-0000-4000-8000-000000000001','62030000-0000-4000-8000-000000000001',
  '62070000-0000-4000-8000-000000000001','62060000-0000-4000-8000-000000000001',
  current_date,'62080000-0000-4000-8000-000000000010');

-- 17
select ok((select not replayed and template_version_id='62070000-0000-4000-8000-000000000001'
  and client_id='62060000-0000-4000-8000-000000000001'
  and document_date=current_date and render_model_hash ~ '^[a-f0-9]{64}$'
  from page62_create),
  'authorized AAL2 create returns an immutable print-job receipt');

-- 18
select ok((select payload->'jobs'->0->'render_model'->>'schemaVersion'='1'
  and payload->'jobs'->0->'render_model'->>'locale'='zh-TW'
  and payload->'jobs'->0->'render_model'->>'timezone'='Asia/Taipei'
  and payload->'jobs'->0->'render_model'->'template'->>'contentHash'=repeat('c',64)
  and (select render_model_hash from page62_create)=encode(sha256(convert_to(
    (payload->'jobs'->0->'render_model')::text,'UTF8')),'hex')
  from public.document_printing_snapshot(
    '62020000-0000-4000-8000-000000000001','62030000-0000-4000-8000-000000000001')),
  'job freezes locale, timezone, template hash, and canonical model hash');

-- 19
select ok((select
  payload->'jobs'->0->'render_model'->'sections'->0->'rows'->0->>'state'='recorded'
  and payload->'jobs'->0->'render_model'->'sections'->0->'rows'->0->>'value'='合成列印個案甲'
  and payload->'jobs'->0->'render_model'->'sections'->0->'rows'->2->>'state'='not_applicable'
  and payload->'jobs'->0->'render_model'->'sections'->0->'rows'->2->'value'='null'::jsonb
  from public.document_printing_snapshot(
    '62020000-0000-4000-8000-000000000001','62030000-0000-4000-8000-000000000001')),
  'render model keeps a recorded value distinct from not-applicable null');

-- 20
select ok((select replayed and job_id=(select job_id from page62_create)
  and render_model_hash=(select render_model_hash from page62_create)
  from public.create_document_print_job(
    '62020000-0000-4000-8000-000000000001','62030000-0000-4000-8000-000000000001',
    '62070000-0000-4000-8000-000000000001','62060000-0000-4000-8000-000000000001',
    current_date,'62080000-0000-4000-8000-000000000010')),
  'exact actor-scoped retry returns the original job');

-- 21
select throws_ok($$select * from public.create_document_print_job(
  '62020000-0000-4000-8000-000000000001','62030000-0000-4000-8000-000000000001',
  '62070000-0000-4000-8000-000000000001','62060000-0000-4000-8000-000000000001',
  current_date-1,'62080000-0000-4000-8000-000000000010')$$,
  '23505','document print idempotency conflict',
  'same actor key cannot be reused for a changed document date');

-- 22
select throws_ok($$select * from public.create_document_print_job(
  '62020000-0000-4000-8000-000000000001','62030000-0000-4000-8000-000000000001',
  '62070000-0000-4000-8000-000000000001','62060000-0000-4000-8000-000000000001',
  current_date-31,'62080000-0000-4000-8000-000000000011')$$,
  '42501','document client or document date is outside current scope',
  'document date before admission is rejected');

-- 23
select throws_ok($$select * from public.create_document_print_job(
  '62020000-0000-4000-8000-000000000001','62030000-0000-4000-8000-000000000001',
  '62070000-0000-4000-8000-000000000001','62060000-0000-4000-8000-000000000002',
  current_date,'62080000-0000-4000-8000-000000000012')$$,
  '42501','document client is outside current assignment',
  'cross-tenant client is rejected before document creation');

-- 24
select ok((select render_model_hash=(select render_model_hash from page62_create)
  and font_bucket='private-doc-fonts'
  and font_object_path='synthetic/page62/NotoSansTC.ttf'
  and font_sha256=repeat('b',64)
  from public.access_document_print_job(
    '62020000-0000-4000-8000-000000000001','62030000-0000-4000-8000-000000000001',
    (select job_id from page62_create),'preview')),
  'preview access records evidence before returning the exact immutable inputs');

-- 25
select ok((select render_model_hash=(select render_model_hash from page62_create)
  from public.access_document_print_job(
    '62020000-0000-4000-8000-000000000001','62030000-0000-4000-8000-000000000001',
    (select job_id from page62_create),'download')),
  'download access returns the same immutable render-model hash');

reset role;

-- 26
select ok((select count(*)=2 and count(*) filter(where action='preview')=1
  and count(*) filter(where action='download')=1
  and bool_and(render_model_hash=(select render_model_hash from page62_create))
  from private.document_print_access_events),
  'preview and download create separate immutable access evidence');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"62010000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"62051000-0000-4000-8000-000000000001"}',true);

-- 27
select ok((select payload->>'job_total'='1'
  and payload->'jobs'->0->>'job_id'=(select job_id::text from page62_create)
  and payload->'jobs'->0->>'preview_count'='1'
  and payload->'jobs'->0->>'download_count'='1'
  and payload->'jobs'->0->>'render_model_hash'=(select render_model_hash from page62_create)
  from public.document_printing_snapshot(
    '62020000-0000-4000-8000-000000000001','62030000-0000-4000-8000-000000000001')),
  'snapshot reconciles job, preview, download, and render-model hash');

select set_config('request.jwt.claims','{"sub":"62010000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"62051000-0000-4000-8000-000000000002"}',true);

-- 28
select throws_ok($$select * from public.access_document_print_job(
  '62020000-0000-4000-8000-000000000001','62030000-0000-4000-8000-000000000001',
  (select job_id from page62_create),'preview')$$,
  '42501','document access is not permitted',
  'other-tenant manager cannot access the job');

select set_config('request.jwt.claims','{"sub":"62010000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2","session_id":"62053000-0000-4000-8000-000000000003"}',true);

-- 29
select throws_ok($$select * from public.document_printing_snapshot(
  '62020000-0000-4000-8000-000000000001','62030000-0000-4000-8000-000000000001')$$,
  '42501','document printing snapshot is not permitted',
  'role without Page-62 permission receives no snapshot');

-- 30
select throws_ok($$update public.document_print_jobs set document_date=current_date-1$$,
  '42501',null,'authenticated callers cannot update immutable jobs directly');

reset role;

-- 31
select throws_ok($$update public.document_print_jobs set document_date=current_date-1$$,
  '55000','document template, job, operation, and access evidence is append-only',
  'even table owner cannot mutate a generated job');

-- 32
select throws_ok($$delete from public.document_template_versions$$,
  '55000','document template, job, operation, and access evidence is append-only',
  'approved template history cannot be deleted');

-- 33
select ok(not exists(select 1 from public.audit_events
  where table_name like '%document_print%'
    and metadata::text ~ '(合成列印個案甲|P62-A-001|synthetic/page62|private-doc-fonts)'),
  'audit metadata contains no client identity, code, or private font locator');

-- 34
select ok(exists(select 1 from public.audit_events
  where table_name='document_print_jobs' and action='print'
    and metadata->>'access_action'='download'
    and metadata->>'render_model_hash'=(select render_model_hash from page62_create))
  and exists(select 1 from public.audit_events
    where table_name='document_printing_snapshot'
      and metadata ? 'template_total' and metadata ? 'job_total'),
  'access and bounded snapshot audits retain correlation hashes and counts');

insert into public.document_template_versions(
  id,organization_id,branch_id,template_key,version,status,title,
  effective_from,effective_to,definition,watermark_text,footer_note,
  font_bucket,font_object_path,font_sha256,approved_by,approved_at,
  content_hash,created_at
) values (
  '62070000-0000-4000-8000-000000000002',
  '62020000-0000-4000-8000-000000000001',
  '62030000-0000-4000-8000-000000000001',
  'synthetic_client_summary',2,'approved','合成個案摘要重疊版',
  clock_timestamp()-interval '30 minutes',null,
  '{"schema_version":1,"sections":[{"heading":"基本資料","rows":[{"label":"個案姓名","source_key":"client.display_name"}]}]}'::jsonb,
  '合成測試文件','僅供合成測試，不代表官方表單。',
  'private-doc-fonts','synthetic/page62/NotoSansTC.ttf',repeat('b',64),
  '62010000-0000-4000-8000-000000000001',clock_timestamp()-interval '1 hour',
  repeat('d',64),clock_timestamp()
);

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"62010000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"62051000-0000-4000-8000-000000000001"}',true);

-- 35
select throws_ok($$select * from public.create_document_print_job(
  '62020000-0000-4000-8000-000000000001','62030000-0000-4000-8000-000000000001',
  '62070000-0000-4000-8000-000000000001','62060000-0000-4000-8000-000000000001',
  current_date,'62080000-0000-4000-8000-000000000020')$$,
  '55000','approved document template periods overlap',
  'overlapping approved periods fail closed instead of choosing a template');

-- 36
select ok((select payload->>'template_total'='0'
  and payload->>'template_governance_status'='not_configured'
  and payload->>'job_total'='1' from public.document_printing_snapshot(
    '62020000-0000-4000-8000-000000000001','62030000-0000-4000-8000-000000000001')),
  'overlap removes the unsafe template from current choices while preserving prior job history');

select * from finish();
rollback;
