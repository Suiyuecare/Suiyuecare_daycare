begin;
select plan(52);

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
select * from finish();
rollback;
