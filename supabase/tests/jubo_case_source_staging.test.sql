begin;
select plan(15);

create function pg_temp.jubo_test_row(p_identity text, p_name text, p_note text)
returns jsonb language sql as $$
  select jsonb_agg(case i
    when 25 then to_jsonb(p_identity)
    when 2 then to_jsonb(p_name)
    when 30 then to_jsonb(p_note)
    else 'null'::jsonb end order by i)
  from generate_series(0, 94) as i;
$$;

create function pg_temp.jubo_test_monthly_row(p_identity text)
returns jsonb language sql as $$
  select jsonb_agg(case when i = 29 then to_jsonb(p_identity)
    else 'null'::jsonb end order by i)
  from generate_series(0, 190) as i;
$$;

insert into public.organizations(id, code, name) values
 ('aa300000-0000-4000-8000-000000000001', 'jubo_test', '合成來源機構');
insert into public.branches(id, organization_id, code, name) values
 ('aa310000-0000-4000-8000-000000000001', 'aa300000-0000-4000-8000-000000000001', 'one', '合成分支甲'),
 ('aa310000-0000-4000-8000-000000000002', 'aa300000-0000-4000-8000-000000000001', 'two', '合成分支乙');
insert into public.clients(id, organization_id, branch_id, client_code, display_name) values
 ('aa320000-0000-4000-8000-000000000001', 'aa300000-0000-4000-8000-000000000001',
  'aa310000-0000-4000-8000-000000000001', 'SYN-JB-1', '合成個案甲');

insert into private.jubo_source_batches(id, organization_id, branch_id, source_kind, source_sha256,
 source_filename, storage_path, column_labels, section_labels, declared_row_count, mapping_version)
 select
 'aa330000-0000-4000-8000-000000000001', 'aa300000-0000-4000-8000-000000000001',
  'aa310000-0000-4000-8000-000000000001', 'client_master', repeat('a',64), 'synthetic.xlsx',
  'organizations/aa300000-0000-4000-8000-000000000001/branches/aa310000-0000-4000-8000-000000000001/jubo/synthetic.xlsx',
  (select jsonb_agg(to_jsonb('欄位' || i) order by i) from generate_series(0,94) i),
  (select jsonb_agg(to_jsonb('基本資料'::text) order by i) from generate_series(0,94) i),
  1, 'jubo-v1';

insert into private.jubo_source_batches(id, organization_id, branch_id, source_kind, source_sha256,
 source_filename, storage_path, column_labels, section_labels, declared_row_count, mapping_version)
 select
 'aa330000-0000-4000-8000-000000000002', 'aa300000-0000-4000-8000-000000000001',
 'aa310000-0000-4000-8000-000000000001', 'daycare_monthly_summary', repeat('f',64),
 'monthly-synthetic.xlsx',
 'organizations/aa300000-0000-4000-8000-000000000001/branches/aa310000-0000-4000-8000-000000000001/jubo/monthly-synthetic.xlsx',
 (select jsonb_agg(to_jsonb('欄位' || i) order by i) from generate_series(0,190) i),
 (select jsonb_agg(to_jsonb('月表'::text) order by i) from generate_series(0,190) i),
 1, 'jubo-v1';

select ok((select relrowsecurity and relforcerowsecurity from pg_class
 where oid = 'private.jubo_source_batches'::regclass), 'source batch forces RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_class
 where oid = 'private.jubo_source_rows'::regclass), 'source rows force RLS');
select ok(not has_table_privilege('authenticated', 'private.jubo_source_rows', 'select')
 and not has_table_privilege('service_role', 'private.jubo_source_rows', 'insert'),
 'browser and service role lack direct raw-row privileges');
select ok(not has_function_privilege('authenticated', 'private.validate_jubo_source_row()', 'execute')
 and not has_function_privilege('service_role', 'private.validate_jubo_source_row()', 'execute'),
 'identity-derived trigger is not directly callable by browser or service role');

insert into private.jubo_source_rows(id, batch_id, organization_id, branch_id,
 source_row_number, identity_sha256, raw_values, row_sha256) values
 ('aa340000-0000-4000-8000-000000000001', 'aa330000-0000-4000-8000-000000000001',
  'aa300000-0000-4000-8000-000000000001', 'aa310000-0000-4000-8000-000000000001',
  6, repeat('b',64), pg_temp.jubo_test_row('SYN-ID-0001','合成個案甲','合成原始備註'), repeat('0',64));
select is((select row_sha256 from private.jubo_source_rows where source_row_number=6),
 encode(sha256(convert_to(pg_temp.jubo_test_row('SYN-ID-0001','合成個案甲','合成原始備註')::text,'UTF8')),'hex'),
 'database derives row hash from canonical raw JSON, not caller input');
select is((select identity_sha256 from private.jubo_source_rows where source_row_number=6),
 encode(sha256(convert_to('SYNID0001','UTF8')),'hex'),
 'database derives identity hash from retained source identity, not caller input');
select is((select jsonb_array_length(raw_values) from private.jubo_source_rows where source_row_number=6),
 95, 'original source cell positions are retained');

insert into private.jubo_source_rows(batch_id,organization_id,branch_id,source_row_number,
 raw_values) values
 ('aa330000-0000-4000-8000-000000000002','aa300000-0000-4000-8000-000000000001',
  'aa310000-0000-4000-8000-000000000001',5,
  pg_temp.jubo_test_monthly_row('SYN-ID-0002'));
select is((select identity_sha256 from private.jubo_source_rows
 where batch_id='aa330000-0000-4000-8000-000000000002'),
 encode(sha256(convert_to('SYNID0002','UTF8')),'hex'),
 'monthly summary identity is derived from its own source column');

select throws_ok($$insert into private.jubo_source_rows(batch_id,organization_id,branch_id,source_row_number,
 identity_sha256,raw_values,row_sha256) values
 ('aa330000-0000-4000-8000-000000000001','aa300000-0000-4000-8000-000000000001',
  'aa310000-0000-4000-8000-000000000001',7,repeat('c',64),'["only two","cells"]',repeat('0',64))$$,
 '22023', 'JUBO_COLUMN_COUNT_MISMATCH', 'mismatched column count is rejected');
select throws_ok($$insert into private.jubo_source_rows(batch_id,organization_id,branch_id,source_row_number,
 identity_sha256,raw_values,row_sha256) values
 ('aa330000-0000-4000-8000-000000000001','aa300000-0000-4000-8000-000000000001',
  'aa310000-0000-4000-8000-000000000001',7,repeat('c',64),pg_temp.jubo_test_row('SYN-ID-0001','合成重複','備註'),repeat('0',64))$$,
 '23505', null, 'duplicate identity in one source batch is rejected');
select throws_ok($$insert into private.jubo_source_rows(batch_id,organization_id,branch_id,source_row_number,
 identity_sha256,raw_values,row_sha256) values
 ('aa330000-0000-4000-8000-000000000001','aa300000-0000-4000-8000-000000000001',
  'aa310000-0000-4000-8000-000000000001',7,repeat('e',64),pg_temp.jubo_test_row('bad','合成個案','備註'),repeat('0',64))$$,
 '22023', 'JUBO_SOURCE_IDENTITY_INVALID', 'invalid source identity fails closed');
select throws_ok($$insert into private.jubo_source_rows(batch_id,organization_id,branch_id,source_row_number,
 identity_sha256,raw_values,row_sha256) values
 ('aa330000-0000-4000-8000-000000000001','aa300000-0000-4000-8000-000000000001',
  'aa310000-0000-4000-8000-000000000002',7,repeat('d',64),pg_temp.jubo_test_row('SYN-ID-0002','合成跨分支','備註'),repeat('0',64))$$,
 '42501', 'JUBO_SOURCE_SCOPE_MISMATCH', 'row cannot be attached to another branch batch');
select throws_ok($$update private.jubo_source_rows set raw_values='[]'$$,
 '55000', null, 'source rows are append only');
select throws_ok($$delete from private.jubo_source_batches$$,
 '55000', null, 'source batch evidence cannot be deleted');
select ok(not exists(select 1 from public.audit_events where table_name like 'private.jubo_%'
 and metadata::text like '%合成原始備註%'), 'audit stores field names, not source values');

select * from finish();
rollback;
