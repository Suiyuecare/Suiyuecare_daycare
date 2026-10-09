begin;
select plan(142);

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
 ('fa130000-0000-4000-8000-000000000002','fa120000-0000-4000-8000-000000000002','foreign','合成外部分支'),
 ('fa130000-0000-4000-8000-000000000003','fa120000-0000-4000-8000-000000000001','sibling','合成同機構分支');
insert into public.profiles(id,display_name,kind) values
 ('fa100000-0000-4000-8000-000000000001','合成管理員','staff');
insert into public.memberships(id,organization_id,branch_id,profile_id,status,starts_at) values
 ('fa140000-0000-4000-8000-000000000001','fa120000-0000-4000-8000-000000000001',
  'fa130000-0000-4000-8000-000000000001','fa100000-0000-4000-8000-000000000001',
  'active',now()-interval '1 day'),
 ('fa140000-0000-4000-8000-000000000003','fa120000-0000-4000-8000-000000000001',
  'fa130000-0000-4000-8000-000000000003','fa100000-0000-4000-8000-000000000001',
  'active',now()-interval '1 day');
insert into public.membership_roles(membership_id,role_id) values
 ('fa140000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002'),
 ('fa140000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002');
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
   when 32 then case when p_n=1 then to_jsonb('合成戶籍地址'::text) else 'null'::jsonb end
   when 35 then case when p_n=1 then to_jsonb('合成現住地址'::text) else 'null'::jsonb end
   when 48 then case when p_n=1 then to_jsonb('第 3 級'::text) else 'null'::jsonb end
   when 54 then case when p_n=1 then to_jsonb('合成身障註記'::text)
     when p_n=2 then to_jsonb('不適用'::text) else 'null'::jsonb end
   when 78 then case when p_n=1 then to_jsonb('合成Ａ'||chr(10)||'聯絡人') else 'null'::jsonb end
   when 79 then case when p_n=1 then to_jsonb('0900'||chr(10)||'000001') else 'null'::jsonb end
   when 80 then case when p_n=1 then to_jsonb('合成代理人'::text) else 'null'::jsonb end
   when 81 then case when p_n=1 then to_jsonb('0900000002'::text) else 'null'::jsonb end
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

-- The remaining assertions exercise only synthetic byte/hash binding and the
-- private pending registry. Production's fixed source hash helper is verified
-- before the rollback-only synthetic replacement below.
select is(private.jubo_expected_source_sha256('client_master'),
 '7ddb8c84f7a8e7faa3bc74f147ee82fc3fcf465844c630764a1c4062146e42a7',
 'production master source digest remains pinned');
select ok(not has_function_privilege('authenticated',
 'private.register_verified_jubo_pair(uuid,uuid,uuid,uuid,bytea,bytea,jsonb,jsonb,text)','execute')
 and not has_function_privilege('service_role',
 'private.register_verified_jubo_pair(uuid,uuid,uuid,uuid,bytea,bytea,jsonb,jsonb,text)','execute'),
 'only trusted database worker may attest source bytes');
create or replace function private.jubo_expected_source_sha256(p_kind text) returns text
 language sql immutable security invoker set search_path = '' as $$
 select case p_kind
  when 'client_master' then encode(sha256(convert_to('synthetic master workbook bytes!', 'UTF8')),'hex')
  when 'daycare_monthly_summary' then encode(sha256(convert_to('synthetic monthly workbook bytes!', 'UTF8')),'hex')
  else null end;
$$;
insert into private.jubo_source_batches(id,organization_id,branch_id,source_kind,source_sha256,
 source_filename,storage_path,column_labels,section_labels,declared_row_count,mapping_version)
 select 'fa150000-0000-4000-8000-000000000003',organization_id,branch_id,source_kind,
  encode(sha256(convert_to('synthetic master workbook bytes!', 'UTF8')),'hex'),
  'synthetic-byte-master.xlsx',
  'organizations/fa120000-0000-4000-8000-000000000001/branches/fa130000-0000-4000-8000-000000000001/jubo/synthetic-byte-master.xlsx',
  column_labels,section_labels,declared_row_count,mapping_version
 from private.jubo_source_batches where id='fa150000-0000-4000-8000-000000000001';
insert into private.jubo_source_batches(id,organization_id,branch_id,source_kind,source_sha256,
 source_filename,storage_path,column_labels,section_labels,declared_row_count,mapping_version)
 select 'fa150000-0000-4000-8000-000000000004',organization_id,branch_id,source_kind,
  encode(sha256(convert_to('synthetic monthly workbook bytes!', 'UTF8')),'hex'),
  'synthetic-byte-monthly.xlsx',
  'organizations/fa120000-0000-4000-8000-000000000001/branches/fa130000-0000-4000-8000-000000000001/jubo/synthetic-byte-monthly.xlsx',
  column_labels,section_labels,declared_row_count,mapping_version
 from private.jubo_source_batches where id='fa150000-0000-4000-8000-000000000002';
insert into private.jubo_source_rows(batch_id,organization_id,branch_id,source_row_number,
 identity_sha256,raw_values,row_sha256)
 select 'fa150000-0000-4000-8000-000000000003',organization_id,branch_id,
  source_row_number,repeat('0',64),raw_values,repeat('0',64)
 from private.jubo_source_rows where batch_id='fa150000-0000-4000-8000-000000000001';
insert into private.jubo_source_rows(batch_id,organization_id,branch_id,source_row_number,
 identity_sha256,raw_values,row_sha256)
 select 'fa150000-0000-4000-8000-000000000004',organization_id,branch_id,
  source_row_number,repeat('0',64),raw_values,repeat('0',64)
 from private.jubo_source_rows where batch_id='fa150000-0000-4000-8000-000000000002';
create function pg_temp.attest(p_master_bytes bytea default convert_to('synthetic master workbook bytes!','UTF8'),
 p_master_headers jsonb default null,p_org uuid default 'fa120000-0000-4000-8000-000000000001')
 returns uuid language sql security invoker as $$
 select private.register_verified_jubo_pair(p_org,
  'fa130000-0000-4000-8000-000000000001',
  'fa150000-0000-4000-8000-000000000003',
  'fa150000-0000-4000-8000-000000000004',
  p_master_bytes,convert_to('synthetic monthly workbook bytes!','UTF8'),
  coalesce(p_master_headers,(select column_labels from private.jubo_source_batches
    where id='fa150000-0000-4000-8000-000000000003')),
  (select column_labels from private.jubo_source_batches
    where id='fa150000-0000-4000-8000-000000000004'),
  'jubo-xlsx-reader-202610-v1');
$$;
select throws_ok($$select pg_temp.attest()$$,'22023',
 'JUBO_ATTESTATION_ROW_COUNT_MISMATCH',
 '23/17 clients alone are insufficient while A-only source footer is unreviewed');
insert into private.jubo_source_nonrecord_rows(batch_id,organization_id,branch_id,
 source_row_number,raw_values,row_sha256,review_reason,reviewed_by)
 select 'fa150000-0000-4000-8000-000000000003',organization_id,branch_id,
  source_row_number,raw_values,repeat('0',64),'合成來源 A 欄註記已人工核對，非個案',reviewed_by
 from private.jubo_source_nonrecord_rows
 where batch_id='fa150000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.attest(convert_to('synthetic tampered workbook bytes!','UTF8'))$$,
 '22023','JUBO_ATTESTATION_HASH_MISMATCH','DB recomputes actual bytes and rejects a changed file');
select throws_ok($$select pg_temp.attest(convert_to('synthetic master workbook bytes!','UTF8'),'[]'::jsonb)$$,
 '22023','JUBO_ATTESTATION_SOURCE_MISMATCH','all staged 95 master labels must match parser output');
select throws_ok($$select pg_temp.attest(convert_to('synthetic master workbook bytes!','UTF8'),null,
 'fa120000-0000-4000-8000-000000000002')$$,
 '22023','JUBO_ATTESTATION_SOURCE_MISMATCH','attestation cannot mix tenant scopes');
select set_config('test.jubo_pair',pg_temp.attest()::text,true);
select ok((select master_byte_length=32 and monthly_byte_length=33 and
  master_nonrecord_rows_sha256=private.jubo_nonrecord_rows_sha256(master_batch_id) and
  jsonb_array_length(master.column_labels)=95 and jsonb_array_length(monthly.column_labels)=191
  from private.jubo_verified_source_pairs pair
  join private.jubo_source_batches master on master.id=pair.master_batch_id
  join private.jubo_source_batches monthly on monthly.id=pair.monthly_batch_id
  where pair.id=current_setting('test.jubo_pair')::uuid),
 'verified pair binds byte lengths and 95/191 header widths');
select throws_ok($$insert into private.jubo_source_rows(batch_id,organization_id,branch_id,
 source_row_number,identity_sha256,raw_values,row_sha256) values
 ('fa150000-0000-4000-8000-000000000003',
  'fa120000-0000-4000-8000-000000000001','fa130000-0000-4000-8000-000000000001',
  100,repeat('0',64),pg_temp.master_row(99),repeat('0',64))$$,
 '55000','JUBO_SOURCE_ALREADY_ATTESTED',
 'attested client-source rows cannot be appended after byte verification');
select throws_ok($$insert into private.jubo_source_nonrecord_rows(batch_id,organization_id,branch_id,
 source_row_number,raw_values,row_sha256,review_reason,reviewed_by) values
 ('fa150000-0000-4000-8000-000000000003',
  'fa120000-0000-4000-8000-000000000001','fa130000-0000-4000-8000-000000000001',
  101,pg_temp.footer_row(),repeat('0',64),'合成來源 A 欄註記已人工核對，非個案',
  'fa100000-0000-4000-8000-000000000001')$$,
 '55000','JUBO_SOURCE_ALREADY_ATTESTED',
 'attested nonrecord-source rows cannot be appended after byte verification');

insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,
 issued_jwt_iat,created_at,expires_at,consumed_at,consumed_jwt_iat,factor_method,factor_verified_at)
 values ('fa160000-0000-4000-8000-000000000001','fa100000-0000-4000-8000-000000000001',
  'fa110000-0000-4000-8000-000000000001',repeat('e',64),
  'fa170000-0000-4000-8000-000000000001',now()-interval '3 minutes',
  now()-interval '2 minutes',now()+interval '3 minutes',now()-interval '1 minute',
  now()-interval '1 minute','totp',now()-interval '1 minute');
insert into private.reauth_events(user_id,session_id,challenge_id,aal,verification_method,verified_at)
 values ('fa100000-0000-4000-8000-000000000001',
  'fa110000-0000-4000-8000-000000000001',
  'fa160000-0000-4000-8000-000000000001','aal2','totp',now()-interval '1 minute');
create function pg_temp.review_one(p_row uuid,p_sha text,p_decision text,p_number integer)
 returns jsonb language sql security invoker as $$
 select public.review_jubo_master_row('fa120000-0000-4000-8000-000000000001',
  'fa130000-0000-4000-8000-000000000001',current_setting('test.jubo_pair')::uuid,
  p_row,p_sha,p_decision,'合成資料已逐欄檢視，來源符合待核作業',
  ('fa800000-0000-4000-8000-'||lpad(p_number::text,12,'0'))::uuid);
$$;
create function pg_temp.commit_pending(p_number integer default 1) returns jsonb
 language sql security invoker as $$
 select public.commit_jubo_pending_registry('fa120000-0000-4000-8000-000000000001',
  'fa130000-0000-4000-8000-000000000001',current_setting('test.jubo_pair')::uuid,
  ('fa900000-0000-4000-8000-'||lpad(p_number::text,12,'0'))::uuid);
$$;
set local role anon;
select throws_ok($$select pg_temp.commit_pending()$$,'42501',null,
 'anonymous cannot commit pending registry');
reset role;
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
set local role authenticated;
select throws_ok($$select pg_temp.commit_pending()$$,'42501',
 'JUBO_PENDING_REVIEWS_INCOMPLETE','zero per-case reviews cannot pass');
reset role;
create function pg_temp.review_all() returns void language plpgsql security invoker as $$
declare r record; n integer := 0;
begin
 for r in select id,row_sha256 from private.jubo_source_rows
   where batch_id='fa150000-0000-4000-8000-000000000003'
   order by source_row_number loop
   n:=n+1;
   perform pg_temp.review_one(r.id,r.row_sha256,
     case when n=1 then 'held' else 'approved' end,n);
 end loop;
end;
$$;
select pg_temp.review_all();
select is((select count(*)::integer from private.jubo_master_row_reviews
 where pair_id=current_setting('test.jubo_pair')::uuid),23,
 'every source master row has a separate reviewed decision');
set local role authenticated;
select throws_ok($$select pg_temp.commit_pending()$$,'42501',
 'JUBO_PENDING_REVIEWS_INCOMPLETE','a held latest review prevents entire transaction');
reset role;
select is((select count(*)::integer from private.jubo_pending_master_rows),0,
 'incomplete approvals wrote no pending master');
select pg_temp.review_one(source_row.id,source_row.row_sha256,'approved',24)
 from private.jubo_source_rows source_row
 where source_row.batch_id='fa150000-0000-4000-8000-000000000003'
   and source_row.source_row_number=6;
select is((select max(review_version) from private.jubo_master_row_reviews
 where source_row_id=(select id from private.jubo_source_rows
  where batch_id='fa150000-0000-4000-8000-000000000003' and source_row_number=6)),2,
 'later approved version supersedes held decision without overwriting history');
select is((pg_temp.review_one(source_row.id,source_row.row_sha256,'approved',24)->>'replayed')::boolean,true,
 'review idempotency key safely returns prior decision'
 ) from private.jubo_source_rows source_row
 where source_row.batch_id='fa150000-0000-4000-8000-000000000003'
   and source_row.source_row_number=6;
insert into public.clients(id,organization_id,branch_id,client_code,display_name,status)
 values ('fa180000-0000-4000-8000-000000000001',
  'fa120000-0000-4000-8000-000000000001','fa130000-0000-4000-8000-000000000001',
  'SYN-UNBOUND','合成既有個案','suspended');
set local role authenticated;
select throws_ok($$select pg_temp.commit_pending()$$,'23505',
 'JUBO_EXISTING_CLIENT_IDENTITY_UNBOUND',
 'legacy client without exact identity binding blocks pending copy');
reset role;
insert into private.client_intake_identities(organization_id,branch_id,client_id,identity_sha256)
 values ('fa120000-0000-4000-8000-000000000001',
  'fa130000-0000-4000-8000-000000000001',
  'fa180000-0000-4000-8000-000000000001',
  encode(sha256(convert_to('SYN-UNBOUND-OTHER','UTF8')),'hex'));
create function pg_temp.fail_pending() returns trigger language plpgsql as $$
 begin raise exception using errcode='P0001',message='synthetic pending fault'; end; $$;
create trigger zz_pending_fault after insert on private.jubo_pending_master_rows
 for each row execute function pg_temp.fail_pending();
set local role authenticated;
select throws_ok($$select pg_temp.commit_pending()$$,'P0001','synthetic pending fault',
 'fault after first pending row rolls back entire operation');
reset role;
select is((select count(*)::integer from private.jubo_pending_master_operations),0,
 'failed transaction leaves no idempotency receipt');
select is((select count(*)::integer from private.jubo_pending_master_rows),0,
 'failed transaction leaves no pending rows');
drop trigger zz_pending_fault on private.jubo_pending_master_rows;
set local role authenticated;
select set_config('test.jubo_receipt',pg_temp.commit_pending()::text,true);
select is((current_setting('test.jubo_receipt')::jsonb->>'pendingMasterRows')::integer,23,
 'single transaction records 23 isolated pending master rows');
select is((current_setting('test.jubo_receipt')::jsonb->>'monthlyReferences')::integer,17,
 'monthly summary links to existing source identities only');
select is((current_setting('test.jubo_receipt')::jsonb->>'publicClientsCreated')::integer,0,
 'receipt explicitly says no public clients were created');
select is((pg_temp.commit_pending()->>'replayed')::boolean,true,
 'same idempotency key replays prior receipt without duplicate rows');
select throws_ok($$select pg_temp.commit_pending(2)$$,'23505','JUBO_PAIR_ALREADY_COMMITTED',
 'new operation key cannot commit the same pair twice');
reset role;
select is((select count(*)::integer from private.jubo_pending_master_rows),23,
 'readback verifies all 23 pending rows');
select is((select count(*)::integer from private.jubo_pending_master_rows
 where monthly_source_row_id is not null),17,
 'monthly rows did not become second set of cases');
select is((select count(*)::integer from private.jubo_pending_master_rows
 where source_status='暫停服務'),1,'suspended origin remains pending and isolated');
select is((select count(*)::integer from private.jubo_pending_master_rows
 where source_status='結案'),5,'closed origins remain pending and isolated');
select is((select count(*)::integer from private.jubo_pending_master_rows
 where source_first_service_on is null),18,'unknown first service dates stay null');
select ok((select bool_and(not care_eligible and admitted_on is null)
 from private.jubo_pending_master_rows),'no pending row is care eligible or admitted');
select is((select count(*)::integer from public.clients
 where organization_id='fa120000-0000-4000-8000-000000000001'),1,
 'isolated registry is not public.clients formal promotion');
select ok(current_setting('test.jubo_receipt') not like '%合成個案%'
 and current_setting('test.jubo_receipt') not like '%SYN-ID%'
 and not exists(select 1 from public.audit_events
   where table_name like 'private.jubo_%' and metadata::text like '%SYN-ID%'),
 'receipts and audits expose no source identities');

select throws_ok($$select private.jubo_profile_from_master(
 jsonb_set(master_row.raw_values,'{48}','"第 9 級"'::jsonb),pending,'SYN-CODE')
 from private.jubo_pending_master_rows pending
 join private.jubo_source_rows master_row on master_row.id=pending.source_row_id
 where master_row.source_row_number=6$$,
 '22023','JUBO_PROFILE_CMS_INVALID',
 'unrecognized CMS grade fails closed instead of assigning a guessed level');
select throws_ok($$select private.jubo_profile_from_master(
 jsonb_set(master_row.raw_values,'{25}','"SYN-ID-9999"'::jsonb),pending,'SYN-CODE')
 from private.jubo_pending_master_rows pending
 join private.jubo_source_rows master_row on master_row.id=pending.source_row_id
 where master_row.source_row_number=6$$,
 '22023','JUBO_PROFILE_SOURCE_MISMATCH',
 'profile identity must hash to the exact reviewed source identity');
select throws_ok($$select private.jubo_profile_from_master(
 jsonb_set(master_row.raw_values,'{32}','123'::jsonb),pending,'SYN-CODE')
 from private.jubo_pending_master_rows pending
 join private.jubo_source_rows master_row on master_row.id=pending.source_row_id
 where master_row.source_row_number=6$$,
 '22023','JUBO_PROFILE_SOURCE_INVALID',
 'unexpected non-text source cell cannot be silently coerced to an address');

-- Public master promotion remains owner-only and disabled to app roles. This
-- test invokes it locally as postgres with synthetic AAL2 evidence only.
select ok(not has_function_privilege('authenticated',
 'private.promote_jubo_public_pending_candidate(uuid,uuid,uuid,uuid)','execute')
 and not has_function_privilege('service_role',
 'private.promote_jubo_public_pending_candidate(uuid,uuid,uuid,uuid)','execute'),
 'public pending promotion has no Data API or service-role execute grant');
set local role authenticated;
select throws_ok($$insert into public.clients(organization_id,branch_id,client_code,
 display_name,status) values('fa120000-0000-4000-8000-000000000001',
 'fa130000-0000-4000-8000-000000000001','SYN-BYPASS','合成未審個案','pending')$$,
 '42501',null,
 'authenticated manager cannot directly insert an unreviewed pending client');
reset role;
select throws_ok($$insert into public.clients(organization_id,branch_id,client_code,
 display_name,status) values('fa120000-0000-4000-8000-000000000001',
 'fa130000-0000-4000-8000-000000000001','SYN-BYPASS-OWNER','合成未審個案','pending')$$,
 '42501','JUBO_PENDING_CLIENT_REQUIRES_REVIEWED_OPERATION',
 'even table owner needs an immutable promotion operation to insert pending');
select ok((select count(*)=0 from information_schema.columns column_info
 where column_info.table_schema='public' and column_info.column_name='client_id'
   and column_info.data_type='uuid'
   and not exists(select 1 from pg_trigger trigger_info
     where trigger_info.tgrelid=(quote_ident(column_info.table_schema)||'.'||
       quote_ident(column_info.table_name))::regclass
       and trigger_info.tgname='jubo_pending_client_no_activity')),
 'every public UUID client_id table has pending-client write gate');
create function pg_temp.promote_public(p_number integer default 1) returns jsonb
 language sql security invoker as $$
 select private.promote_jubo_public_pending_candidate(
  'fa120000-0000-4000-8000-000000000001',
  'fa130000-0000-4000-8000-000000000001',current_setting('test.jubo_pair')::uuid,
  ('faa00000-0000-4000-8000-'||lpad(p_number::text,12,'0'))::uuid);
$$;
select throws_ok($$select private.promote_jubo_public_pending_candidate(
 'fa120000-0000-4000-8000-000000000002',
 'fa130000-0000-4000-8000-000000000002',
 current_setting('test.jubo_pair')::uuid,
 'faa00000-0000-4000-8000-000000000001')$$,'42501',null,
 'different tenant cannot promote the reviewed source pair');
select throws_ok($$select private.promote_jubo_public_pending_candidate(
 'fa120000-0000-4000-8000-000000000001',
 'fa130000-0000-4000-8000-000000000003',
 current_setting('test.jubo_pair')::uuid,
 'faa00000-0000-4000-8000-000000000001')$$,'42501',
 'JUBO_PUBLIC_PENDING_SCOPE_MISMATCH',
 'manager of another branch in the same tenant cannot promote source across branches');
select set_config('test.jubo_good_jwt',current_setting('request.jwt.claims'),true);
select set_config('request.jwt.claims',jsonb_set(
 current_setting('request.jwt.claims')::jsonb,'{aal}','"aal1"'::jsonb)::text,true);
select throws_ok($$select pg_temp.promote_public()$$,'42501',null,
 'public pending promotion requires fresh AAL2 evidence even for an administrator');
select set_config('request.jwt.claims',current_setting('test.jubo_good_jwt'),true);
create function pg_temp.fail_public_pending() returns trigger language plpgsql as $$
 begin if new.status='pending' then
   raise exception using errcode='P0001',message='synthetic public pending fault';
 end if; return new; end; $$;
create trigger zz_public_pending_fault after insert on public.clients
 for each row execute function pg_temp.fail_public_pending();
select throws_ok($$select pg_temp.promote_public()$$,'P0001','synthetic public pending fault',
 'fault after first public client insert rolls back all 23');
select is((select count(*)::integer from private.jubo_public_pending_promotions),0,
 'failed public promotion leaves no immutable receipt');
select is((select count(*)::integer from public.clients
 where source_system='jubo' and organization_id='fa120000-0000-4000-8000-000000000001'),0,
 'failed public promotion leaves no client shell');
drop trigger zz_public_pending_fault on public.clients;
select throws_ok($$select pg_temp.promote_public()$$,'42501',
 'JUBO_PROFILE_MAPPING_V2_REVIEW_REQUIRED',
 'all prior v1 row approvals remain insufficient after the v2 display mapping change');
select is((select count(*)::integer from public.clients where source_system='jubo'),0,
 'missing v2 profile review rolls back every pending client shell');
-- V2 is separately previewed and approved. The original cells and display
-- transformation are returned to an authorized person, never in audit output.
create function pg_temp.v2_preview_one(p_row uuid,p_purpose text default 'jubo_intake_profile_mapping_v2')
 returns jsonb language sql security invoker as $$
 select public.preview_jubo_profile_mapping_v2(
  'fa120000-0000-4000-8000-000000000001',
  'fa130000-0000-4000-8000-000000000001',
  current_setting('test.jubo_pair')::uuid,p_row,p_purpose);
$$;
create function pg_temp.v2_review_one(p_preview jsonb,p_decision text,p_number integer,
 p_source_sha text default null,p_fingerprint text default null,p_preview_sha text default null,
 p_purpose text default 'jubo_intake_profile_mapping_v2')
 returns jsonb language sql security invoker as $$
 select public.review_jubo_profile_mapping_v2(
  'fa120000-0000-4000-8000-000000000001',
  'fa130000-0000-4000-8000-000000000001',
  current_setting('test.jubo_pair')::uuid,(p_preview->>'sourceRowId')::uuid,
  (p_preview->>'previewId')::uuid,
  coalesce(p_source_sha,p_preview->>'sourceRowSha256'),
  coalesce(p_fingerprint,p_preview->>'mappingReviewSha256'),
  coalesce(p_preview_sha,p_preview->>'previewSha256'),p_purpose,p_decision,
  '合成測試逐欄核對原值、顯示值與正規化警示後作出決定',
  ('fab00000-0000-4000-8000-'||lpad(p_number::text,12,'0'))::uuid);
$$;
select set_config('test.jubo_first_row',(select id::text from private.jubo_source_rows
 where batch_id='fa150000-0000-4000-8000-000000000003' and source_row_number=6),true);
select ok(not has_function_privilege('anon',
 'public.preview_jubo_profile_mapping_v2(uuid,uuid,uuid,uuid,text)','execute')
 and not has_function_privilege('service_role',
 'public.review_jubo_profile_mapping_v2(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,uuid)','execute')
 and not has_table_privilege('authenticated','private.jubo_profile_mapping_v2_previews','select'),
 'raw v2 preview and immutable evidence are inaccessible to anon and service role');
set local role authenticated;
select throws_ok($$select public.preview_jubo_profile_mapping_v2(
 'fa120000-0000-4000-8000-000000000002',
 'fa130000-0000-4000-8000-000000000002',
 current_setting('test.jubo_pair')::uuid,current_setting('test.jubo_first_row')::uuid,
 'jubo_intake_profile_mapping_v2')$$,'42501',null,
 'other organization cannot preview a v2 source row');
select throws_ok($$select public.preview_jubo_profile_mapping_v2(
 'fa120000-0000-4000-8000-000000000001',
 'fa130000-0000-4000-8000-000000000003',
 current_setting('test.jubo_pair')::uuid,current_setting('test.jubo_first_row')::uuid,
 'jubo_intake_profile_mapping_v2')$$,'42501',null,
 'sibling branch cannot preview a source row');
select throws_ok($$select pg_temp.v2_preview_one(current_setting('test.jubo_first_row')::uuid,'other purpose')$$,
 '22023','JUBO_PROFILE_V2_PREVIEW_INVALID','preview rejects an unrelated purpose');
reset role;
select set_config('request.jwt.claims',jsonb_set(current_setting('test.jubo_good_jwt')::jsonb,
 '{aal}','"aal1"'::jsonb)::text,true);
set local role authenticated;
select throws_ok($$select pg_temp.v2_preview_one(current_setting('test.jubo_first_row')::uuid)$$,
 '42501',null,'v2 preview requires fresh AAL2');
reset role;
select set_config('request.jwt.claims',jsonb_set(current_setting('test.jubo_good_jwt')::jsonb,
 '{session_id}','"fa110000-0000-4000-8000-000000000099"'::jsonb)::text,true);
set local role authenticated;
select throws_ok($$select pg_temp.v2_preview_one(current_setting('test.jubo_first_row')::uuid)$$,
 '42501',null,'v2 preview refuses another session without reauthentication');
reset role;
select set_config('request.jwt.claims',current_setting('test.jubo_good_jwt'),true);
set local role authenticated;
select set_config('test.jubo_v2_first_preview',
 pg_temp.v2_preview_one(current_setting('test.jubo_first_row')::uuid)::text,true);
select ok((current_setting('test.jubo_v2_first_preview')::jsonb
  ->'originalMappedValues'->'primaryContactName'->>'value') like '%'||chr(10)||'%'
 and (current_setting('test.jubo_v2_first_preview')::jsonb
  ->'displayProfile'->'contacts'->0->>'name')='合成A / 聯絡人'
 and (current_setting('test.jubo_v2_first_preview')::jsonb
  ->'normalizationFieldIndices'->'nfkc') @> '[78]'::jsonb
 and (current_setting('test.jubo_v2_first_preview')::jsonb
  ->'normalizationFieldIndices'->'contactSeparator') @> '[78]'::jsonb,
 'one preview shows original control/NFKC values beside explicit display changes');
reset role;
select ok((select presented_payload_sha256=current_setting('test.jubo_v2_first_preview')::jsonb->>'previewSha256'
 and mapping_review_sha256=current_setting('test.jubo_v2_first_preview')::jsonb->>'mappingReviewSha256'
 and source_row_sha256=current_setting('test.jubo_v2_first_preview')::jsonb->>'sourceRowSha256'
 from private.jubo_profile_mapping_v2_previews
 where id=(current_setting('test.jubo_v2_first_preview')::jsonb->>'previewId')::uuid),
 'preview binds purpose, original source SHA, normalized display fingerprint and payload hash');
select set_config('request.jwt.claims',jsonb_set(current_setting('test.jubo_good_jwt')::jsonb,
 '{session_id}','"fa110000-0000-4000-8000-000000000099"'::jsonb)::text,true);
set local role authenticated;
select throws_ok($$select pg_temp.v2_review_one(current_setting('test.jubo_v2_first_preview')::jsonb,
 'approved',1)$$,'42501',null,'review cannot reuse another session preview');
reset role;
select set_config('request.jwt.claims',current_setting('test.jubo_good_jwt'),true);
select throws_ok($$update private.jubo_source_rows
 set raw_values=jsonb_set(raw_values,'{78}','"changed after preview"'::jsonb)
 where id=current_setting('test.jubo_first_row')::uuid$$,
 '55000',null,'attested source cells cannot change after a preview was issued');
set local role authenticated;
select throws_ok($$select pg_temp.v2_review_one(current_setting('test.jubo_v2_first_preview')::jsonb,
 'approved',1,repeat('0',64))$$,'42501','JUBO_PROFILE_V2_PREVIEW_MISMATCH',
 'changed source digest cannot be approved');
select throws_ok($$select public.review_jubo_profile_mapping_v2(
 'fa120000-0000-4000-8000-000000000001',
 'fa130000-0000-4000-8000-000000000001',current_setting('test.jubo_pair')::uuid,
 current_setting('test.jubo_first_row')::uuid,
 (current_setting('test.jubo_v2_first_preview')::jsonb->>'previewId')::uuid,
 null,current_setting('test.jubo_v2_first_preview')::jsonb->>'mappingReviewSha256',
 current_setting('test.jubo_v2_first_preview')::jsonb->>'previewSha256',
 'jubo_intake_profile_mapping_v2','approved',
 '合成測試逐欄核對原值與顯示值後作出決定',
 'fab00000-0000-4000-8000-000000000001')$$,
 '22023','JUBO_PROFILE_V2_REVIEW_INVALID',
 'null source hash is rejected before any decision is written');
select throws_ok($$select pg_temp.v2_review_one(current_setting('test.jubo_v2_first_preview')::jsonb,
 'approved',1,null,repeat('0',64))$$,'42501','JUBO_PROFILE_V2_PREVIEW_MISMATCH',
 'stale v2 mapping fingerprint cannot be approved');
select throws_ok($$select pg_temp.v2_review_one(current_setting('test.jubo_v2_first_preview')::jsonb,
 'approved',1,null,null,repeat('0',64))$$,'42501','JUBO_PROFILE_V2_PREVIEW_MISMATCH',
 'changed original/display preview hash cannot be approved');
select throws_ok($$select pg_temp.v2_review_one(current_setting('test.jubo_v2_first_preview')::jsonb,
 'approved',1,null,null,null,'other purpose')$$,'22023','JUBO_PROFILE_V2_REVIEW_INVALID',
 'review purpose cannot be substituted');
reset role;
delete from public.membership_roles where membership_id='fa140000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select pg_temp.v2_review_one(current_setting('test.jubo_v2_first_preview')::jsonb,
 'approved',1)$$,'42501','INTAKE_ACCESS_DENIED',
 'revoked import permission blocks review even with a prior preview and AAL2');
reset role;
insert into public.membership_roles(membership_id,role_id) values
 ('fa140000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002');
set local role authenticated;
select is((pg_temp.v2_review_one(current_setting('test.jubo_v2_first_preview')::jsonb,
 'held',1)->>'decision'),'held','held decision is persisted for one exact preview');
select is((pg_temp.v2_review_one(current_setting('test.jubo_v2_first_preview')::jsonb,
 'held',1)->>'replayed')::boolean,true,'same request key replays without a second row');
select throws_ok($$select pg_temp.v2_review_one(current_setting('test.jubo_v2_first_preview')::jsonb,
 'approved',1)$$,'23505','JUBO_PROFILE_V2_IDEMPOTENCY_CONFLICT',
 'same key cannot change its decision');
select throws_ok($$select pg_temp.v2_review_one(current_setting('test.jubo_v2_first_preview')::jsonb,
 'approved',2)$$,'23505','JUBO_PROFILE_V2_PREVIEW_ALREADY_REVIEWED',
 'one preview cannot support two different decisions');
reset role;
select throws_ok($$select pg_temp.promote_public()$$,'42501',
 'JUBO_PROFILE_MAPPING_V2_REVIEW_REQUIRED',
 'a held latest v2 decision blocks promotion');
create function pg_temp.review_all_v2() returns void language plpgsql security invoker as $$
declare r record; n integer:=2; p jsonb;
begin
 for r in select id from private.jubo_source_rows
   where batch_id='fa150000-0000-4000-8000-000000000003'
   order by source_row_number loop
   p:=pg_temp.v2_preview_one(r.id);
   perform pg_temp.v2_review_one(p,'approved',n);
   n:=n+1;
 end loop;
end;
$$;
select pg_temp.review_all_v2();
select is((select count(*)::integer from private.jubo_profile_mapping_v2_reviews),24,
 '23 new human-review calls produce 23 latest approved v2 decisions plus held history');
select ok((select bool_and(review.review_purpose='jubo_intake_profile_mapping_v2'
  and review.presented_payload_sha256=preview.presented_payload_sha256
  and review.mapping_review_sha256=preview.mapping_review_sha256
  and review.source_row_sha256=preview.source_row_sha256
  and review.reviewer_user_id=preview.actor_user_id
  and review.reauth_challenge_id=preview.reauth_challenge_id)
 from private.jubo_profile_mapping_v2_reviews review
 join private.jubo_profile_mapping_v2_previews preview on preview.id=review.preview_id),
 'each decision preserves the same reviewer, AAL2, purpose and exact preview evidence');
create function pg_temp.fail_pending_profile() returns trigger language plpgsql as $$
 begin raise exception using errcode='P0001',message='synthetic profile fault'; end; $$;
create trigger zz_pending_profile_fault after insert on private.client_intake_versions
 for each row execute function pg_temp.fail_pending_profile();
select throws_ok($$select pg_temp.promote_public()$$,'P0001','synthetic profile fault',
 'profile version failure rolls back the entire reviewed public promotion');
select is((select count(*)::integer from private.client_intake_versions),0,
 'failed profile write leaves no partial intake versions');
select is((select count(*)::integer from private.jubo_intake_profile_sources),0,
 'failed profile write leaves no JUBO version-source links');
select is((select count(*)::integer from private.jubo_public_pending_promotions),0,
 'failed profile write leaves no promotion receipt');
drop trigger zz_pending_profile_fault on private.client_intake_versions;
select set_config('test.jubo_public_receipt',pg_temp.promote_public()::text,true);
select is((current_setting('test.jubo_public_receipt')::jsonb->>'publicPendingClients')::integer,23,
 'single reviewed operation creates 23 pending public master shells');
select is((current_setting('test.jubo_public_receipt')::jsonb->>'monthlyMatches')::integer,17,
 '17 monthly rows are linked only and not duplicated');
select ok((current_setting('test.jubo_public_receipt')::jsonb->>'sourceActive')::integer=17
 and (current_setting('test.jubo_public_receipt')::jsonb->>'sourceSuspended')::integer=1
 and (current_setting('test.jubo_public_receipt')::jsonb->>'sourceClosed')::integer=5,
 'receipt distinguishes all three source lifecycle counts');
select is((select count(*)::integer from public.clients
 where source_system='jubo' and status='pending' and admitted_on is null
   and ended_on is null),23,
 'all 23 public cases remain pending without invented admission dates');
select is((select count(*)::integer from private.jubo_public_pending_links),23,
 'each pending public case links back to one reviewed master row');
select is((select count(*)::integer from private.client_intake_versions version_row
 join public.clients client on client.id=version_row.client_id
 where client.source_system='jubo' and client.status='pending'
   and version_row.version=1),23,
 'each of the 23 pending clients receives intake profile version one');
select is((select count(*)::integer from private.jubo_intake_profile_sources),23,
 'each intake profile version has its own immutable JUBO source link');
select is((select count(*)::integer from private.jubo_intake_profile_sources source_link
 join private.jubo_source_rows original_row on original_row.id=source_link.master_source_row_id
 where source_link.source_sheet_row=original_row.source_row_number
   and source_link.source_field_indices->>'registeredAddress'='32'
   and source_link.mapping_version='jubo-master-monthly-202610-v2'),23,
 'all profiles retain original row coordinates and a pinned field mapping');
select is((select count(*)::integer from private.jubo_intake_profile_sources source_link
 where 'MISSING_MONTHLY_SUMMARY'=any(source_link.warning_codes)),6,
 'six master-only records remain marked as lacking a monthly cross-check');
select is((select count(*)::integer from private.jubo_intake_profile_sources source_link
 where 'REVIEW_WEEKLY_SCHEDULE'=any(source_link.warning_codes)
   and 'REVIEW_TRANSPORT'=any(source_link.warning_codes)
   and 'REVIEW_ABCD_ASSESSMENTS'=any(source_link.warning_codes)
   and 'REVIEW_MEDICATION_EVIDENCE'=any(source_link.warning_codes)),23,
 'all profiles preserve review warnings rather than treating source export as authorization');
select ok((select version_row.profile->>'registeredAddress'=original_row.raw_values->>32
   and version_row.profile->>'residentialAddress'=original_row.raw_values->>35
 from private.client_intake_versions version_row
 join public.clients client on client.id=version_row.client_id
 join private.jubo_intake_profile_sources source_link on source_link.intake_version_id=version_row.id
 join private.jubo_source_rows original_row on original_row.id=source_link.master_source_row_id
 where client.display_name='合成個案1'),
 'mapped values can be reconciled to the linked immutable original cell values');
select ok((select bool_and(source_link.profile_sha256=encode(sha256(
 convert_to(version_row.profile::text,'UTF8')),'hex')
 and source_link.master_source_row_sha256=master_row.row_sha256
 and source_link.pair_id=current_setting('test.jubo_pair')::uuid)
 from private.jubo_intake_profile_sources source_link
 join private.client_intake_versions version_row on version_row.id=source_link.intake_version_id
 join private.jubo_source_rows master_row on master_row.id=source_link.master_source_row_id),
 'profile content digest and exact reviewed master row remain linked');
select ok((select version_row.profile->>'registeredAddress'='合成戶籍地址'
 and version_row.profile->>'residentialAddress'='合成現住地址'
 and version_row.profile->>'cmsLevel'='3'
 and version_row.profile->>'disability'='合成身障註記'
 and version_row.profile->>'identityNumber'='SYNID0001'
 and version_row.profile->'contacts'->0->>'name'='合成A / 聯絡人'
 and version_row.profile->'contacts'->0->>'phone'='0900 / 000001'
 and version_row.profile->'contacts'->1->>'name'='合成代理人'
 and version_row.profile->'consent'->>'status'='pending'
 and version_row.profile->'phone'='null'::jsonb
 from private.client_intake_versions version_row
 join public.clients client on client.id=version_row.client_id
 where client.display_name='合成個案1'),
 'mapped profile contains addresses, CMS, disability, both contacts and unconfirmed consent');
select ok((select version_row.profile->>'disability'='不適用'
 and version_row.profile->'registeredAddress'='null'::jsonb
 from private.client_intake_versions version_row
 join public.clients client on client.id=version_row.client_id
 where client.display_name='合成個案2'),
 'literal not-applicable remains distinct from a missing address');
select ok((select source_link.normalization_field_indices->'nfkc' @> '[78]'::jsonb
 and source_link.normalization_field_indices->'contactSeparator' @> '[78,79]'::jsonb
 and 'REVIEW_SOURCE_NORMALIZATION'=any(source_link.warning_codes)
 and original_row.raw_values->>78='合成Ａ'||chr(10)||'聯絡人'
 from private.jubo_intake_profile_sources source_link
 join private.jubo_source_rows original_row on original_row.id=source_link.master_source_row_id
 join public.clients client on client.id=source_link.client_id
 where client.display_name='合成個案1'),
 'display separators and NFKC are flagged while original source name remains immutable');
select ok((select version_row.profile->'contacts'->0->>'relationship'=''
 from private.client_intake_versions version_row
 join public.clients client on client.id=version_row.client_id
 where client.display_name='合成個案1'),
 'import never invents a relationship from a multi-line contact cell');
select ok((select bool_and(version_row.field_authority->>'identityNumber'='jubo_export'
 and version_row.field_authority->>'cmsLevel'='jubo_export'
 and version_row.field_authority->>'consent'='unverified'
 and version_row.field_authority->>'displayName'<>'central')
 from private.client_intake_versions version_row
 join public.clients client on client.id=version_row.client_id
 where client.source_system='jubo'),
 'vendor source is not mislabeled as official central CMS authority');
select is((select count(*)::integer from private.jubo_client_source_links
 where import_operation_id=(current_setting('test.jubo_public_receipt')::jsonb->>'promotionId')::uuid),23,
 'each public case has immutable original source-row provenance');
select is((select count(*)::integer from private.jubo_public_pending_links link
 join private.jubo_pending_master_rows pending on pending.id=link.pending_row_id
 where pending.monthly_source_row_id is not null),17,
 'monthly cross-check never produces another public client');
select ok((select count(*) filter(where pending.source_status='暫停服務')=1
   and count(*) filter(where pending.source_status='結案')=5
   and count(*) filter(where pending.source_first_service_on is null)=18
   from private.jubo_public_pending_links link
   join private.jubo_pending_master_rows pending on pending.id=link.pending_row_id),
 'source suspended/closed statuses and unknown first service dates remain intact');
select is((pg_temp.promote_public()->>'replayed')::boolean,true,
 'public promotion replay returns immutable receipt without extra clients');
select is((select count(*)::integer from private.client_intake_versions version_row
 join public.clients client on client.id=version_row.client_id
 where client.source_system='jubo'),23,
 'idempotent replay does not duplicate profile versions');
select throws_ok($$insert into private.client_intake_versions(organization_id,branch_id,
 client_id,version,profile,field_authority,actor_user_id)
 select version_row.organization_id,version_row.branch_id,version_row.client_id,2,
   jsonb_set(version_row.profile,'{displayName}','"合成靜默改名"'::jsonb),
   version_row.field_authority,'fa100000-0000-4000-8000-000000000001'
 from private.client_intake_versions version_row
 join public.clients client on client.id=version_row.client_id
 where client.display_name='合成個案1'$$,
 '42501','JUBO_PENDING_PROFILE_SUPPLEMENT_NOT_PUBLISHED',
 'pending source fields cannot be silently overwritten via a generic v2 intake version');
select throws_ok($$select pg_temp.promote_public(2)$$,'23505',
 'JUBO_PUBLIC_PENDING_ALREADY_COMMITTED',
 'new idempotency key cannot promote same source pair twice');
select throws_ok($$insert into public.client_assignments(
 organization_id,branch_id,client_id,assignee_user_id,assignment_kind)
 select organization_id,branch_id,id,'fa100000-0000-4000-8000-000000000001','case_manager'
 from public.clients where source_system='jubo' limit 1$$,
 '23514','JUBO_PENDING_CLIENT_OPERATION_DENIED',
 'pending client cannot receive an operational assignment');
select throws_ok($$update public.clients set status='active'
 where id=(select id from public.clients where source_system='jubo' limit 1)$$,
 '42501','JUBO_PENDING_CLIENT_TRANSITION_DISABLED',
 'pending client cannot be silently promoted to active or admitted');
select ok(current_setting('test.jubo_public_receipt') not like '%合成個案%'
 and current_setting('test.jubo_public_receipt') not like '%SYN-ID%',
 'public promotion receipt contains no client names or identifiers');

-- A public pending shell is not an active service case. Private assessment
-- draft storage is permitted, while signing/review/export/print remains
-- impossible even when a privileged writer bypasses the browser RPC layer.
select set_config('test.jubo_pending_client',(
 select id::text from public.clients where source_system='jubo' order by id limit 1
),true);
select ok(not has_function_privilege('authenticated',
 'private.assert_jubo_pending_private_client_boundary(uuid,uuid,uuid,boolean)','execute')
 and not has_function_privilege('service_role',
 'private.guard_jubo_pending_private_client_write()','execute'),
 'private pending boundary has no Data API or service-role function grant');
select lives_ok($$select private.assert_jubo_pending_private_client_boundary(
 'fa120000-0000-4000-8000-000000000001',
 'fa130000-0000-4000-8000-000000000001',
 current_setting('test.jubo_pending_client')::uuid,true)$$,
 'pending same-branch assessment draft passes the narrow boundary');
select throws_ok($$select private.assert_jubo_pending_private_client_boundary(
 'fa120000-0000-4000-8000-000000000001',
 'fa130000-0000-4000-8000-000000000001',
 current_setting('test.jubo_pending_client')::uuid,false)$$,
 '23514','JUBO_PENDING_CLIENT_FORMAL_WORKFLOW_DENIED',
 'pending formal workflow denied even for privileged caller');
select throws_ok($$select private.assert_jubo_pending_private_client_boundary(
 'fa120000-0000-4000-8000-000000000002',
 'fa130000-0000-4000-8000-000000000002',
 current_setting('test.jubo_pending_client')::uuid,true)$$,
 '42501','JUBO_PRIVATE_CLIENT_SCOPE_MISMATCH',
 'cross-organization draft cannot borrow another branch scope');

insert into public.form_definitions(id,organization_id,form_key,name,category,is_official)
 values ('fb100000-0000-4000-8000-000000000001',
 'fa120000-0000-4000-8000-000000000001',
 'tenant.custom.pending_test','合成待收案表單','行政表單',false);
insert into public.form_versions(id,form_definition_id,version,status,effective_from,
 schema_json,scoring_json,published_at,published_by)
 values ('fb200000-0000-4000-8000-000000000001',
 'fb100000-0000-4000-8000-000000000001',1,'published','2026-01-01',
 '{"builder":"tenant-custom.v1","fields":[{"key":"note","label":"合成文字","required":false,"type":"text","maxLength":500}]}','{}',now(),
 'fa100000-0000-4000-8000-000000000001');
select lives_ok($$insert into private.custom_form_responses(id,organization_id,
 branch_id,client_id,form_version_id,record_key,revision,service_date,status,
 schema_snapshot,answers,content_hash,actor_id) values(
 'fb300000-0000-4000-8000-000000000001',
 'fa120000-0000-4000-8000-000000000001',
 'fa130000-0000-4000-8000-000000000001',
 current_setting('test.jubo_pending_client')::uuid,
 'fb200000-0000-4000-8000-000000000001',
 'fb310000-0000-4000-8000-000000000001',1,current_date,'draft',
 '{"builder":"tenant-custom.v1","fields":[{"key":"note","label":"合成文字","required":false,"type":"text","maxLength":500}]}','{}',repeat('a',64),
 'fa100000-0000-4000-8000-000000000001')$$,
 'custom assessment draft can be stored for pending client');
select throws_ok($$insert into private.custom_form_responses(id,organization_id,
 branch_id,client_id,form_version_id,record_key,revision,service_date,status,
 schema_snapshot,answers,signature_evidence,content_hash,actor_id) values(
 'fb300000-0000-4000-8000-000000000002',
 'fa120000-0000-4000-8000-000000000001',
 'fa130000-0000-4000-8000-000000000001',
 current_setting('test.jubo_pending_client')::uuid,
 'fb200000-0000-4000-8000-000000000001',
 'fb310000-0000-4000-8000-000000000002',1,current_date,'signed',
 '{"builder":"tenant-custom.v1","fields":[{"key":"note","label":"合成文字","required":false,"type":"text","maxLength":500}]}','{}','{}',repeat('b',64),
 'fa100000-0000-4000-8000-000000000001')$$,
 '23514','JUBO_PENDING_CLIENT_FORMAL_WORKFLOW_DENIED',
 'pending custom form cannot be signed by a privileged writer');
select throws_ok($$insert into private.custom_form_responses(id,organization_id,
 branch_id,client_id,form_version_id,record_key,revision,service_date,status,
 schema_snapshot,answers,content_hash,actor_id) values(
 'fb300000-0000-4000-8000-000000000003',
 'fa120000-0000-4000-8000-000000000002',
 'fa130000-0000-4000-8000-000000000002',
 current_setting('test.jubo_pending_client')::uuid,
 'fb200000-0000-4000-8000-000000000001',
 'fb310000-0000-4000-8000-000000000003',1,current_date,'draft',
 '{"builder":"tenant-custom.v1","fields":[{"key":"note","label":"合成文字","required":false,"type":"text","maxLength":500}]}','{}',repeat('c',64),
 'fa100000-0000-4000-8000-000000000001')$$,
 '42501','JUBO_PRIVATE_CLIENT_SCOPE_MISMATCH',
 'pending custom draft cross-branch write is rejected before FK checks');

select lives_ok($$insert into private.taipei_abcd_draft_versions(id,
 organization_id,branch_id,client_id,form,usage_year,month,template_key,
 source_revision,source_sha256,version,answers,content_hash,actor_user_id)
 values ('fb400000-0000-4000-8000-000000000001',
 'fa120000-0000-4000-8000-000000000001',
 'fa130000-0000-4000-8000-000000000001',
 current_setting('test.jubo_pending_client')::uuid,'A',115,0,
 'taipei.daycare.abcd.115.114-11.draft-v1','114.11',
 '64bb716b19362580295fe8ee2e452d32e82d6f3c67773d5956f66c7e17d3c481',
 1,'{}',repeat('d',64),'fa100000-0000-4000-8000-000000000001')$$,
 'Taipei A draft can be stored for pending client');
select lives_ok($$insert into private.taipei_abcd_draft_operations(actor_user_id,
 idempotency_key,organization_id,branch_id,client_id,request_hash,result_id)
 values ('fa100000-0000-4000-8000-000000000001',
 'fb410000-0000-4000-8000-000000000001',
 'fa120000-0000-4000-8000-000000000001',
 'fa130000-0000-4000-8000-000000000001',
 current_setting('test.jubo_pending_client')::uuid,repeat('e',64),
 'fb400000-0000-4000-8000-000000000001')$$,
 'Taipei draft idempotency operation can be stored with same scope');
set local role authenticated;
select lives_ok($$select public.save_taipei_abcd_draft(
 'fa120000-0000-4000-8000-000000000001',
 'fa130000-0000-4000-8000-000000000001',
 jsonb_build_object('client_id',current_setting('test.jubo_pending_client')::uuid,
  'form','A','usage_year',115,'month',0,
  'template_key','taipei.daycare.abcd.115.114-11.draft-v1',
  'source_revision','114.11',
  'source_sha256','64bb716b19362580295fe8ee2e452d32e82d6f3c67773d5956f66c7e17d3c481',
  'expected_version',1,'expected_content_hash',repeat('d',64),
  'answers','{}'::jsonb,'idempotency_key','fb410000-0000-4000-8000-000000000002'::uuid),
 'fb410000-0000-4000-8000-000000000002')$$,
 'authorized manager can save a pending Taipei A draft through the public RPC');
select lives_ok($$select public.write_custom_form_response(
 'fa120000-0000-4000-8000-000000000001',
 'fa130000-0000-4000-8000-000000000001',
 current_setting('test.jubo_pending_client')::uuid,
 'fb320000-0000-4000-8000-000000000001',
 jsonb_build_object('action','save',
  'formVersionId','fb200000-0000-4000-8000-000000000001'::uuid,
  'previousId',null,'baseRevision',null,
  'serviceDate',(now() at time zone 'Asia/Taipei')::date,
  'answers','{}'::jsonb,'reason',null))$$,
 'authorized manager can save a pending custom form draft through public RPC');
reset role;
select throws_ok($$insert into private.taipei_abcd_draft_versions(id,
 organization_id,branch_id,client_id,form,usage_year,month,template_key,
 source_revision,source_sha256,version,answers,content_hash,actor_user_id)
 values ('fb400000-0000-4000-8000-000000000002',
 'fa120000-0000-4000-8000-000000000002',
 'fa130000-0000-4000-8000-000000000002',
 current_setting('test.jubo_pending_client')::uuid,'A',115,0,
 'taipei.daycare.abcd.115.114-11.draft-v1','114.11',
 '64bb716b19362580295fe8ee2e452d32e82d6f3c67773d5956f66c7e17d3c481',
 1,'{}',repeat('f',64),'fa100000-0000-4000-8000-000000000001')$$,
 '42501','JUBO_PRIVATE_CLIENT_SCOPE_MISMATCH',
 'Taipei draft cross-organization write is denied');
select throws_ok($$insert into private.taipei_abcd_review_events(
 draft_id,organization_id,branch_id,client_id,sequence,action,state,
 actor_user_id,reason,checklist,input_hash,idempotency_key)
 values ('fb400000-0000-4000-8000-000000000001',
 'fa120000-0000-4000-8000-000000000001',
 'fa130000-0000-4000-8000-000000000001',
 current_setting('test.jubo_pending_client')::uuid,1,'submit','submitted',
 'fa100000-0000-4000-8000-000000000001','合成送審','{}',repeat('a',64),
 'fb420000-0000-4000-8000-000000000001')$$,
 '23514','JUBO_PENDING_CLIENT_FORMAL_WORKFLOW_DENIED',
 'pending Taipei ABC cannot submit an administrative review');
select throws_ok($$insert into private.taipei_abcd_review_events(
 draft_id,organization_id,branch_id,client_id,sequence,action,state,
 actor_user_id,reason,checklist,input_hash,idempotency_key)
 values ('fb400000-0000-4000-8000-000000000001',
 'fa120000-0000-4000-8000-000000000001',
 'fa130000-0000-4000-8000-000000000001',
 current_setting('test.jubo_pending_client')::uuid,1,'approve','approved',
 'fa100000-0000-4000-8000-000000000001','合成核准','{}',repeat('a',64),
 'fb420000-0000-4000-8000-000000000002')$$,
 '23514','JUBO_PENDING_CLIENT_FORMAL_WORKFLOW_DENIED',
 'pending Taipei ABC cannot be administratively approved');
select throws_ok($$insert into private.taipei_abcd_export_snapshots(
 organization_id,branch_id,client_id,draft_id,actor_user_id,
 font_asset_key,snapshot,snapshot_hash,input_hash,idempotency_key)
 values ('fa120000-0000-4000-8000-000000000001',
 'fa130000-0000-4000-8000-000000000001',
 current_setting('test.jubo_pending_client')::uuid,
 'fb400000-0000-4000-8000-000000000001',
 'fa100000-0000-4000-8000-000000000001','taipei-crosswalk-font-v1',
 '{}',repeat('a',64),repeat('b',64),
 'fb430000-0000-4000-8000-000000000001')$$,
 '23514','JUBO_PENDING_CLIENT_FORMAL_WORKFLOW_DENIED',
 'pending Taipei ABC cannot create an export snapshot');
select throws_ok($$insert into private.custom_response_print_jobs(
 organization_id,branch_id,client_id,response_id,actor_id,reauth_challenge_id,
 idempotency_key,request_hash,snapshot,snapshot_hash,created_at,expires_at)
 values ('fa120000-0000-4000-8000-000000000001',
 'fa130000-0000-4000-8000-000000000001',
 current_setting('test.jubo_pending_client')::uuid,
 'fb300000-0000-4000-8000-000000000001',
 'fa100000-0000-4000-8000-000000000001',
 'fa160000-0000-4000-8000-000000000001',
 'fb440000-0000-4000-8000-000000000001',repeat('a',64),'{}',
 repeat('b',64),now(),now()+interval '5 minutes')$$,
 '23514','JUBO_PENDING_CLIENT_FORMAL_WORKFLOW_DENIED',
 'pending custom draft cannot be printed');
select is((select count(*)::integer from private.custom_form_responses
 where client_id=current_setting('test.jubo_pending_client')::uuid
   and status='draft'),2,'both direct and authenticated custom drafts remain');
select is((select count(*)::integer from private.custom_form_responses
 where client_id=current_setting('test.jubo_pending_client')::uuid
   and status='signed'),0,'no pending custom response was signed');
select ok(not exists(select 1 from private.taipei_abcd_review_events
 where client_id=current_setting('test.jubo_pending_client')::uuid)
 and not exists(select 1 from private.taipei_abcd_export_snapshots
 where client_id=current_setting('test.jubo_pending_client')::uuid)
 and not exists(select 1 from private.custom_response_print_jobs
 where client_id=current_setting('test.jubo_pending_client')::uuid),
 'failed formal writes leave review, export and print ledgers empty');
insert into public.clients(id,organization_id,branch_id,client_code,display_name,status)
 values ('fb500000-0000-4000-8000-000000000001',
 'fa120000-0000-4000-8000-000000000002',
 'fa130000-0000-4000-8000-000000000002',
 'SYN-ACTIVE','合成正常個案','active');
select lives_ok($$select private.assert_jubo_pending_private_client_boundary(
 'fa120000-0000-4000-8000-000000000002',
 'fa130000-0000-4000-8000-000000000002',
 'fb500000-0000-4000-8000-000000000001',false)$$,
 'existing active client formal path retains prior behavior');
update private.reauth_events set verified_at=now()-interval '16 minutes'
 where user_id='fa100000-0000-4000-8000-000000000001'
   and session_id='fa110000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select pg_temp.v2_preview_one(current_setting('test.jubo_first_row')::uuid)$$,
 '42501',null,'stale same-session AAL2 evidence cannot open another v2 review');
reset role;
select * from finish();
rollback;
