begin;
select plan(11);

insert into public.organizations(id, code, name) values
 ('aa300000-0000-4000-8000-000000000001', 'jubo_test', '合成來源機構');
insert into public.branches(id, organization_id, code, name) values
 ('aa310000-0000-4000-8000-000000000001', 'aa300000-0000-4000-8000-000000000001', 'one', '合成分支甲'),
 ('aa310000-0000-4000-8000-000000000002', 'aa300000-0000-4000-8000-000000000001', 'two', '合成分支乙');
insert into public.clients(id, organization_id, branch_id, client_code, display_name) values
 ('aa320000-0000-4000-8000-000000000001', 'aa300000-0000-4000-8000-000000000001',
  'aa310000-0000-4000-8000-000000000001', 'SYN-JB-1', '合成個案甲');

insert into private.jubo_source_batches(id, organization_id, branch_id, source_kind, source_sha256,
 source_filename, storage_path, column_labels, section_labels, declared_row_count, mapping_version) values
 ('aa330000-0000-4000-8000-000000000001', 'aa300000-0000-4000-8000-000000000001',
  'aa310000-0000-4000-8000-000000000001', 'client_master', repeat('a',64), 'synthetic.xlsx',
  'organizations/aa300000-0000-4000-8000-000000000001/branches/aa310000-0000-4000-8000-000000000001/jubo/synthetic.xlsx',
  '["身分識別","姓名","備註"]', '["基本資料","基本資料","基本資料"]', 1, 'jubo-v1');

select ok((select relrowsecurity and relforcerowsecurity from pg_class
 where oid = 'private.jubo_source_batches'::regclass), 'source batch forces RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_class
 where oid = 'private.jubo_source_rows'::regclass), 'source rows force RLS');
select ok(not has_table_privilege('authenticated', 'private.jubo_source_rows', 'select')
 and not has_table_privilege('service_role', 'private.jubo_source_rows', 'insert'),
 'browser and service role lack direct raw-row privileges');

insert into private.jubo_source_rows(id, batch_id, organization_id, branch_id,
 source_row_number, identity_sha256, raw_values, row_sha256) values
 ('aa340000-0000-4000-8000-000000000001', 'aa330000-0000-4000-8000-000000000001',
  'aa300000-0000-4000-8000-000000000001', 'aa310000-0000-4000-8000-000000000001',
  6, repeat('b',64), '["SYN-ID-1","合成個案甲","合成原始備註"]', repeat('0',64));
select is((select row_sha256 from private.jubo_source_rows where source_row_number=6),
 encode(sha256(convert_to('["SYN-ID-1", "合成個案甲", "合成原始備註"]'::jsonb::text,'UTF8')),'hex'),
 'database derives row hash from canonical raw JSON, not caller input');
select is((select jsonb_array_length(raw_values) from private.jubo_source_rows where source_row_number=6),
 3, 'original source cell positions are retained');

select throws_ok($$insert into private.jubo_source_rows(batch_id,organization_id,branch_id,source_row_number,
 identity_sha256,raw_values,row_sha256) values
 ('aa330000-0000-4000-8000-000000000001','aa300000-0000-4000-8000-000000000001',
  'aa310000-0000-4000-8000-000000000001',7,repeat('c',64),'["only two","cells"]',repeat('0',64))$$,
 '22023', 'JUBO_COLUMN_COUNT_MISMATCH', 'mismatched column count is rejected');
select throws_ok($$insert into private.jubo_source_rows(batch_id,organization_id,branch_id,source_row_number,
 identity_sha256,raw_values,row_sha256) values
 ('aa330000-0000-4000-8000-000000000001','aa300000-0000-4000-8000-000000000001',
  'aa310000-0000-4000-8000-000000000001',7,repeat('b',64),'["SYN-ID-1","合成重複","備註"]',repeat('0',64))$$,
 '23505', null, 'duplicate identity in one source batch is rejected');
select throws_ok($$insert into private.jubo_source_rows(batch_id,organization_id,branch_id,source_row_number,
 identity_sha256,raw_values,row_sha256) values
 ('aa330000-0000-4000-8000-000000000001','aa300000-0000-4000-8000-000000000001',
  'aa310000-0000-4000-8000-000000000002',7,repeat('d',64),'["SYN-ID-2","合成跨分支","備註"]',repeat('0',64))$$,
 '42501', 'JUBO_SOURCE_SCOPE_MISMATCH', 'row cannot be attached to another branch batch');
select throws_ok($$update private.jubo_source_rows set raw_values='[]'$$,
 '55000', null, 'source rows are append only');
select throws_ok($$delete from private.jubo_source_batches$$,
 '55000', null, 'source batch evidence cannot be deleted');
select ok(not exists(select 1 from public.audit_events where table_name like 'private.jubo_%'
 and metadata::text like '%合成原始備註%'), 'audit stores field names, not source values');

select * from finish();
rollback;
