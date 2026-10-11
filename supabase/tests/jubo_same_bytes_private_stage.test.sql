begin;
select plan(14);

-- Synthetic schema/atomic-source checks only. These bytes are not an XLSX and
-- can never pass the fixed 23/17 approved-source attestation function.
select ok((select relrowsecurity and relforcerowsecurity from pg_class
 where oid='private.jubo_source_stage_operations'::regclass),
 'stage operation receipts force private RLS');
select ok(not has_table_privilege('anon','private.jubo_source_stage_operations','select')
 and not has_table_privilege('authenticated','private.jubo_source_stage_operations','insert')
 and not has_table_privilege('service_role','private.jubo_source_stage_operations','insert'),
 'source-stage receipts are unavailable to API roles');
select is((select data_type from information_schema.columns
 where table_schema='private' and table_name='jubo_source_batches' and column_name='source_bytes'),
 'bytea','exact source bytes are retained in private DB');
select is((select data_type from information_schema.columns
 where table_schema='private' and table_name='jubo_source_rows' and column_name='normalized_values'),
 'jsonb','normalized row values are preserved alongside raw values');
select is((select data_type from information_schema.columns
 where table_schema='private' and table_name='jubo_source_rows' and column_name='raw_cell_types'),
 'jsonb','original cell types are preserved');

insert into public.organizations(id,code,name) values
 ('bba00000-0000-4000-8000-000000000001','jubo_byte_synthetic','合成單位');
insert into public.branches(id,organization_id,code,name) values
 ('bba10000-0000-4000-8000-000000000001',
  'bba00000-0000-4000-8000-000000000001','synthetic','合成分支');

create function pg_temp.headers(p_width integer) returns jsonb
language sql as $$ select jsonb_agg(to_jsonb('合成欄' || i) order by i)
 from generate_series(0,p_width-1) i $$;
create function pg_temp.sections(p_width integer) returns jsonb
language sql as $$ select jsonb_agg('null'::jsonb order by i)
 from generate_series(0,p_width-1) i $$;
create function pg_temp.raw_row() returns jsonb
language sql as $$ select jsonb_agg(case when i=25 then to_jsonb('SYNTHETIC0001'::text)
 else 'null'::jsonb end order by i) from generate_series(0,94) i $$;
create function pg_temp.types(p_width integer) returns jsonb
language sql as $$ select jsonb_agg('null'::jsonb order by i)
 from generate_series(0,p_width-1) i $$;

select throws_ok($$insert into private.jubo_source_batches
 (organization_id,branch_id,source_kind,source_sha256,source_filename,storage_path,
  column_labels,section_labels,declared_row_count,mapping_version,source_storage_backend)
 values ('bba00000-0000-4000-8000-000000000001',
 'bba10000-0000-4000-8000-000000000001','client_master',repeat('a',64),
 'missing-bytes.xlsx',
 'organizations/bba00000-0000-4000-8000-000000000001/branches/bba10000-0000-4000-8000-000000000001/jubo/private-db/missing-bytes.xlsx',
 pg_temp.headers(95),pg_temp.sections(95),1,'jubo-master-monthly-202610-v1','private_db')$$,
 '23514',null,'private-db source cannot omit original bytes');
select throws_ok($$insert into private.jubo_source_batches
 (organization_id,branch_id,source_kind,source_sha256,source_filename,storage_path,
  column_labels,section_labels,declared_row_count,mapping_version,
  source_storage_backend,source_bytes)
 values ('bba00000-0000-4000-8000-000000000001',
 'bba10000-0000-4000-8000-000000000001','client_master',repeat('a',64),
 'wrong-digest.xlsx',
 'organizations/bba00000-0000-4000-8000-000000000001/branches/bba10000-0000-4000-8000-000000000001/jubo/private-db/wrong-digest.xlsx',
 pg_temp.headers(95),pg_temp.sections(95),1,'jubo-master-monthly-202610-v1',
 'private_db',decode('504b'||repeat('00',20),'hex'))$$,
 '23514',null,'source bytes cannot disagree with the batch digest');

insert into private.jubo_source_batches(id,organization_id,branch_id,source_kind,
 source_sha256,source_filename,storage_path,column_labels,section_labels,
 declared_row_count,mapping_version,source_storage_backend,source_bytes)
 select 'bba20000-0000-4000-8000-000000000001',
 'bba00000-0000-4000-8000-000000000001',
 'bba10000-0000-4000-8000-000000000001','client_master',
 encode(sha256(decode('504b'||repeat('00',20),'hex')),'hex'),
 'synthetic-master.xlsx',
 'organizations/bba00000-0000-4000-8000-000000000001/branches/bba10000-0000-4000-8000-000000000001/jubo/private-db/synthetic-master.xlsx',
 pg_temp.headers(95),pg_temp.sections(95),1,'jubo-master-monthly-202610-v1',
 'private_db',decode('504b'||repeat('00',20),'hex');
select is((select octet_length(source_bytes) from private.jubo_source_batches
 where id='bba20000-0000-4000-8000-000000000001'),22,
 'source batch retains the exact synthetic byte length');
select is((select source_sha256 from private.jubo_source_batches
 where id='bba20000-0000-4000-8000-000000000001'),
 encode(sha256(decode('504b'||repeat('00',20),'hex')),'hex'),
 'retained bytes match the batch digest');
select throws_ok($$update private.jubo_source_batches
 set source_bytes=decode('504b'||repeat('11',20),'hex')
 where id='bba20000-0000-4000-8000-000000000001'$$,
 '55000',null,'retained bytes cannot be overwritten');

select throws_ok($$insert into private.jubo_source_rows
 (batch_id,organization_id,branch_id,source_row_number,identity_sha256,
  raw_values,normalized_values,raw_cell_types,row_sha256)
 values ('bba20000-0000-4000-8000-000000000001',
 'bba00000-0000-4000-8000-000000000001',
 'bba10000-0000-4000-8000-000000000001',6,repeat('0',64),
 pg_temp.raw_row(),pg_temp.types(94),pg_temp.types(95),repeat('0',64))$$,
 '23514',null,'short normalized array is rejected');
select throws_ok($$insert into private.jubo_source_rows
 (batch_id,organization_id,branch_id,source_row_number,identity_sha256,
  raw_values,normalized_values,raw_cell_types,row_sha256)
 values ('bba20000-0000-4000-8000-000000000001',
 'bba00000-0000-4000-8000-000000000001',
 'bba10000-0000-4000-8000-000000000001',6,repeat('0',64),
 pg_temp.raw_row(),pg_temp.types(95),pg_temp.types(94),repeat('0',64))$$,
 '23514',null,'short cell-type array is rejected');
select throws_ok($$insert into private.jubo_source_rows
 (batch_id,organization_id,branch_id,source_row_number,identity_sha256,
  raw_values,row_sha256)
 values ('bba20000-0000-4000-8000-000000000001',
 'bba00000-0000-4000-8000-000000000001',
 'bba10000-0000-4000-8000-000000000001',6,repeat('0',64),
 pg_temp.raw_row(),repeat('0',64))$$,
 '22023',null,'private-DB row cannot omit normalized and cell-type evidence');

insert into private.jubo_source_rows(batch_id,organization_id,branch_id,
 source_row_number,identity_sha256,raw_values,normalized_values,raw_cell_types,row_sha256)
 values ('bba20000-0000-4000-8000-000000000001',
 'bba00000-0000-4000-8000-000000000001',
 'bba10000-0000-4000-8000-000000000001',6,repeat('0',64),
 pg_temp.raw_row(),pg_temp.types(95),pg_temp.types(95),repeat('0',64));
select is((select jsonb_array_length(normalized_values) from private.jubo_source_rows
 where batch_id='bba20000-0000-4000-8000-000000000001'),95,
 'raw and normalized source coordinates remain aligned');

select * from finish();
rollback;
