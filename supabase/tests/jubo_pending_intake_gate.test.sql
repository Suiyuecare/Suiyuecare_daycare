begin;
select plan(19);

-- Every row below is synthetic. The two pinned digest strings are metadata
-- fixtures only, not proof that these generated rows came from those files.
select set_config('test.jubo_amr',floor(extract(epoch from now()-interval '2 minutes'))::text,true);
insert into auth.users(id,aud,role,email,email_confirmed_at,created_at,updated_at) values
 ('fa100000-0000-4000-8000-000000000001','authenticated','authenticated',
  'synthetic-jubo@example.invalid',now()-interval '1 day',now()-interval '1 day',now());
insert into auth.identities(id,provider_id,user_id,identity_data,provider) values
 (gen_random_uuid(),'synthetic-jubo-google','fa100000-0000-4000-8000-000000000001',
  '{"sub":"synthetic-jubo-google","email":"synthetic-jubo@example.invalid","email_verified":true}','google');
insert into auth.sessions(id,user_id,created_at,aal) values
 ('fa110000-0000-4000-8000-000000000001','fa100000-0000-4000-8000-000000000001',
  now()-interval '3 minutes','aal2');
insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method)
 select gen_random_uuid(),'fa110000-0000-4000-8000-000000000001',
  to_timestamp(current_setting('test.jubo_amr')::bigint),
  to_timestamp(current_setting('test.jubo_amr')::bigint),method
 from unnest(array['oauth','totp']) method;
insert into public.organizations(id,code,name) values
 ('fa120000-0000-4000-8000-000000000001','jubo_gate_synthetic','合成機構'),
 ('fa120000-0000-4000-8000-000000000002','jubo_gate_other','合成其他機構');
insert into public.branches(id,organization_id,code,name) values
 ('fa130000-0000-4000-8000-000000000001','fa120000-0000-4000-8000-000000000001','main','合成分支'),
 ('fa130000-0000-4000-8000-000000000002','fa120000-0000-4000-8000-000000000002','foreign','合成外部分支');
insert into public.profiles(id,display_name,kind) values
 ('fa100000-0000-4000-8000-000000000001','合成管理員','staff');
insert into public.memberships(id,organization_id,branch_id,profile_id,status,starts_at) values
 ('fa140000-0000-4000-8000-000000000001','fa120000-0000-4000-8000-000000000001',
  'fa130000-0000-4000-8000-000000000001','fa100000-0000-4000-8000-000000000001',
  'active',now()-interval '1 day');
insert into public.membership_roles(membership_id,role_id) values
 ('fa140000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002');
insert into private.executive_access_policy(allowed_user_id,allowed_email,google_subject,enabled,approval_reference)
 values ('fa100000-0000-4000-8000-000000000001','synthetic-jubo@example.invalid',
  'synthetic-jubo-google',true,'synthetic fixture');

create function pg_temp.master_row(p_n integer) returns jsonb language sql as $$
 select jsonb_agg(case i
   when 2 then to_jsonb('合成個案' || p_n)
   when 3 then to_jsonb('男性'::text)
   when 9 then case when p_n <= 5 then to_jsonb('2026/07/01'::text) else 'null'::jsonb end
   when 15 then to_jsonb(case when p_n <= 17 then '服務中'
     when p_n = 18 then '暫停服務' else '結案' end)
   when 23 then to_jsonb('1945/01/02'::text)
   when 25 then to_jsonb('SYN-ID-' || lpad(p_n::text,4,'0'))
   when 29 then to_jsonb('0900000000'::text)
   else 'null'::jsonb end order by i)
 from generate_series(0,94) i;
$$;
create function pg_temp.monthly_row(p_n integer) returns jsonb language sql as $$
 select jsonb_agg(case i
   when 3 then to_jsonb('服務中'::text)
   when 7 then to_jsonb('合成個案' || p_n)
   when 8 then to_jsonb('男'::text)
   when 9 then to_jsonb(((date '1945-01-02' - date '1899-12-30')::text || '.0'))
   when 22 then to_jsonb('0900000000'::text)
   when 29 then to_jsonb('SYN-ID-' || lpad(p_n::text,4,'0'))
   else 'null'::jsonb end order by i)
 from generate_series(0,190) i;
$$;
create function pg_temp.footer_row() returns jsonb language sql as $$
 select jsonb_agg(case when i=0 then to_jsonb('合成來源註記'::text)
   else 'null'::jsonb end order by i)
 from generate_series(0,94) i;
$$;
insert into private.jubo_source_batches(id,organization_id,branch_id,source_kind,source_sha256,
 source_filename,storage_path,column_labels,section_labels,declared_row_count,mapping_version)
 select 'fa150000-0000-4000-8000-000000000001',
  'fa120000-0000-4000-8000-000000000001','fa130000-0000-4000-8000-000000000001',
  'client_master','7ddb8c84f7a8e7faa3bc74f147ee82fc3fcf465844c630764a1c4062146e42a7',
  'synthetic-master.xlsx',
  'organizations/fa120000-0000-4000-8000-000000000001/branches/fa130000-0000-4000-8000-000000000001/jubo/synthetic-master.xlsx',
  (select jsonb_agg(to_jsonb('欄位'||i) order by i) from generate_series(0,94) i),
  (select jsonb_agg(to_jsonb('合成區段'::text) order by i) from generate_series(0,94) i),
  23,'jubo-master-monthly-202610-v1';
insert into private.jubo_source_batches(id,organization_id,branch_id,source_kind,source_sha256,
 source_filename,storage_path,column_labels,section_labels,declared_row_count,mapping_version)
 select 'fa150000-0000-4000-8000-000000000002',
  'fa120000-0000-4000-8000-000000000001','fa130000-0000-4000-8000-000000000001',
  'daycare_monthly_summary','aa1e02c2bc1029bc78d8f7e46c68f979fbdfa1d7010a5ec8e29818bc54854ff4',
  'synthetic-monthly.xlsx',
  'organizations/fa120000-0000-4000-8000-000000000001/branches/fa130000-0000-4000-8000-000000000001/jubo/synthetic-monthly.xlsx',
  (select jsonb_agg(to_jsonb('欄位'||i) order by i) from generate_series(0,190) i),
  (select jsonb_agg(to_jsonb('合成區段'::text) order by i) from generate_series(0,190) i),
  17,'jubo-master-monthly-202610-v1';
insert into private.jubo_source_rows(batch_id,organization_id,branch_id,source_row_number,
 identity_sha256,raw_values,row_sha256)
 select 'fa150000-0000-4000-8000-000000000001',
  'fa120000-0000-4000-8000-000000000001','fa130000-0000-4000-8000-000000000001',
  5+n,repeat('0',64),pg_temp.master_row(n),repeat('0',64)
 from generate_series(1,23) n;
insert into private.jubo_source_rows(batch_id,organization_id,branch_id,source_row_number,
 identity_sha256,raw_values,row_sha256)
 select 'fa150000-0000-4000-8000-000000000002',
  'fa120000-0000-4000-8000-000000000001','fa130000-0000-4000-8000-000000000001',
  4+n,repeat('0',64),pg_temp.monthly_row(n),repeat('0',64)
 from generate_series(1,17) n;
insert into private.jubo_source_nonrecord_rows(batch_id,organization_id,branch_id,
 source_row_number,raw_values,row_sha256,review_reason,reviewed_by) values
 ('fa150000-0000-4000-8000-000000000001',
  'fa120000-0000-4000-8000-000000000001','fa130000-0000-4000-8000-000000000001',
  29,pg_temp.footer_row(),repeat('0',64),'合成來源 A 欄註記已人工核對，非個案',
  'fa100000-0000-4000-8000-000000000001');

select is(private.jubo_source_date_iso('1945/01/02')::text,'1945-01-02',
 'slash date normalizes without changing value');
select is(private.jubo_source_date_iso(((date '1945-01-02'-date '1899-12-30')::text||'.0'))::text,
 '1945-01-02','Excel serial with decimal suffix normalizes');
select is(private.jubo_source_date_iso('1945/02/30'),null,
 'impossible date is not inferred');
select is(private.jubo_source_sex('男性'),'male','master sex normalizes');
select is(private.jubo_source_sex('男'),'male','monthly sex normalizes');
select ok((select relrowsecurity and relforcerowsecurity from pg_class
 where oid='private.jubo_source_nonrecord_rows'::regclass),
 'footer evidence is behind forced RLS');
select ok(not has_table_privilege('authenticated','private.jubo_source_nonrecord_rows','select')
 and not has_table_privilege('service_role','private.jubo_source_nonrecord_rows','insert'),
 'raw footer cannot be accessed from browser or service role');
select ok(not has_function_privilege('anon','public.jubo_pending_intake_preflight(uuid,uuid,uuid,uuid)','execute')
 and not has_function_privilege('service_role','public.jubo_pending_intake_preflight(uuid,uuid,uuid,uuid)','execute'),
 'preflight is denied to anonymous and service role');
select throws_ok($$update private.jubo_source_nonrecord_rows set review_reason='tamper'$$,
 '55000',null,'reviewed footer cannot be overwritten');
select throws_ok($$insert into private.jubo_source_nonrecord_rows(batch_id,organization_id,branch_id,
 source_row_number,raw_values,row_sha256,review_reason,reviewed_by) values
 ('fa150000-0000-4000-8000-000000000001',
 'fa120000-0000-4000-8000-000000000001','fa130000-0000-4000-8000-000000000001',
 30,pg_temp.master_row(1),repeat('0',64),'合成資料誤作頁尾，應該拒絕',
 'fa100000-0000-4000-8000-000000000001')$$,
 '22023','JUBO_NONRECORD_INVALID','a client-like row cannot be disguised as footer');

select set_config('request.jwt.claims',jsonb_build_object(
 'sub','fa100000-0000-4000-8000-000000000001',
 'session_id','fa110000-0000-4000-8000-000000000001',
 'role','authenticated','aud','authenticated','aal','aal2',
 'is_anonymous',false,'email','synthetic-jubo@example.invalid',
 'iat',floor(extract(epoch from now())),
 'exp',floor(extract(epoch from now()+interval '30 minutes')),
 'amr',jsonb_build_array(jsonb_build_object('method','oauth',
   'timestamp',current_setting('test.jubo_amr')::bigint),
  jsonb_build_object('method','totp',
   'timestamp',current_setting('test.jubo_amr')::bigint)))::text,true);
create function pg_temp.preflight(p_org uuid default 'fa120000-0000-4000-8000-000000000001',
 p_branch uuid default 'fa130000-0000-4000-8000-000000000001') returns jsonb
 language sql security invoker as $$
 select public.jubo_pending_intake_preflight(p_org,p_branch,
  'fa150000-0000-4000-8000-000000000001',
  'fa150000-0000-4000-8000-000000000002');
$$;
set local role authenticated;
select is((pg_temp.preflight()->>'masterRows')::integer,23,'23 master rows visible as counts only');
select is((pg_temp.preflight()->>'monthlyRows')::integer,17,'17 monthly rows join, not another client group');
select is((pg_temp.preflight()->>'nonrecordRows')::integer,1,'A-only footer is reviewed separately');
select is((pg_temp.preflight()->'fieldDifferences'->>'birthDate')::integer,0,
 'date formats compare after canonical normalization');
select is((pg_temp.preflight()->'fieldDifferences'->>'sex')::integer,0,
 'sex formats compare after canonical normalization');
select is((pg_temp.preflight()->>'missingFirstServiceDates')::integer,18,
 'missing first-service dates are counted without guessing');
select is((pg_temp.preflight()->>'approvedForPromotion')::boolean,false,
 'even consistent source remains fail closed before lifecycle and artifact attestation');
select throws_ok($$select pg_temp.preflight('fa120000-0000-4000-8000-000000000002',
 'fa130000-0000-4000-8000-000000000002')$$,'42501',null,
 'other organization cannot read source comparison');
reset role;
select is((select count(*)::integer from public.clients
 where organization_id='fa120000-0000-4000-8000-000000000001'),0,
 'preflight never creates operational clients');
select * from finish();
rollback;
