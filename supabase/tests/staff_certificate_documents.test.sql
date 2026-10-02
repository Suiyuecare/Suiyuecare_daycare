begin;
select plan(52);
set local time zone 'Asia/Taipei';
select set_config('test.doc_oauth',floor(extract(epoch from clock_timestamp()-interval '3 minutes'))::text,true);
select set_config('test.doc_totp',floor(extract(epoch from clock_timestamp()-interval '30 seconds'))::text,true);

-- Synthetic actual admission only; none of the production Auth predicates is replaced.
insert into auth.users(id,aud,role,email,email_confirmed_at,created_at,updated_at)
 select ('dc100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated',
  'doc'||n||'@care.example.invalid',now()-interval '1 day',now()-interval '1 day',now() from generate_series(1,4)n;
insert into auth.identities(id,provider_id,user_id,identity_data,provider)
 select ('dc110000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'synthetic-doc-'||n,
  ('dc100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  jsonb_build_object('sub','synthetic-doc-'||n,'email','doc'||n||'@care.example.invalid','email_verified',true,'hd','care.example.invalid'),'google' from generate_series(1,4)n;
insert into auth.sessions(id,user_id,created_at,aal)
 select ('dc120000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('dc100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  now()-interval '4 minutes','aal2' from generate_series(1,4)n;
insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method)
 select ('dc130000-0000-4000-8000-'||lpad((n*2)::text,12,'0'))::uuid,('dc120000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  to_timestamp(current_setting('test.doc_oauth')::bigint),to_timestamp(current_setting('test.doc_oauth')::bigint),'oauth' from generate_series(1,4)n
 union all select ('dc130000-0000-4000-8000-'||lpad((n*2+1)::text,12,'0'))::uuid,('dc120000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  to_timestamp(current_setting('test.doc_totp')::bigint),to_timestamp(current_setting('test.doc_totp')::bigint),'totp' from generate_series(1,4)n;
insert into public.organizations(id,code,name) values('dc200000-0000-4000-8000-000000000001','staff_doc_test','Synthetic staff evidence');
insert into public.branches(id,organization_id,code,name) values
 ('dc300000-0000-4000-8000-000000000001','dc200000-0000-4000-8000-000000000001','main','Synthetic main'),
 ('dc300000-0000-4000-8000-000000000002','dc200000-0000-4000-8000-000000000001','other','Synthetic other');
insert into public.profiles(id,display_name,kind)
 select ('dc100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Synthetic document staff '||n,'staff' from generate_series(1,4)n;
insert into public.memberships(id,organization_id,branch_id,profile_id,status,starts_at)
 select ('dc400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'dc200000-0000-4000-8000-000000000001','dc300000-0000-4000-8000-000000000001',
  ('dc100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'active',now()-interval '1 day' from generate_series(1,4)n;
insert into public.membership_roles(membership_id,role_id)
 select ('dc400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,r.id from generate_series(1,4)n cross join public.roles r where r.role_key='branch_supervisor' and r.is_system;
insert into private.staff_google_access_grants(allowed_user_id,organization_id,company_email_domain,allowed_email,google_subject,enabled,approval_reference)
 select ('dc100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'dc200000-0000-4000-8000-000000000001','care.example.invalid',
  'doc'||n||'@care.example.invalid','synthetic-doc-'||n,true,'Synthetic independent staff approval' from generate_series(1,3)n;
insert into private.executive_access_policy(allowed_user_id,allowed_email,google_subject,enabled,approval_reference)
 values('dc100000-0000-4000-8000-000000000001','doc1@care.example.invalid','synthetic-doc-1',true,'Synthetic original certificate author');
insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,issued_jwt_jti,created_at,expires_at,
 consumed_at,consumed_jwt_iat,consumed_jwt_jti,factor_method,factor_verified_at)
 select ('dc500000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('dc100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  ('dc120000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,repeat(n::text,64),('dc510000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  now()-interval '3 minutes','before-'||n,now()-interval '2 minutes',now()+interval '5 minutes',
  to_timestamp(current_setting('test.doc_totp')::bigint),to_timestamp(current_setting('test.doc_totp')::bigint),'after-'||n,'totp',to_timestamp(current_setting('test.doc_totp')::bigint)
 from generate_series(1,4)n;
insert into private.reauth_events(user_id,session_id,challenge_id,aal,verification_method,verified_at)
 select ('dc100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('dc120000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  ('dc500000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'aal2','totp',to_timestamp(current_setting('test.doc_totp')::bigint) from generate_series(1,4)n;

-- Portable-only storage fixture; native runner provisions actual-shaped tables
-- before applying migrations so the bucket's restrictive policy is exercised.
create schema if not exists storage;
create table if not exists storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table if not exists storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb,updated_at timestamptz default clock_timestamp(),unique(bucket_id,name));
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('staff-certificate-documents','staff-certificate-documents',false,4194304,array['application/pdf','image/jpeg','image/png']) on conflict(id) do nothing;

create temporary table doc_data(k text primary key,v jsonb);
grant select,insert,update on doc_data to authenticated,service_role;
create function pg_temp.doc_login(n integer,p_aal text default 'aal2') returns boolean language plpgsql security invoker as $$
begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub','dc100000-0000-4000-8000-'||lpad(n::text,12,'0'),
  'session_id','dc120000-0000-4000-8000-'||lpad(n::text,12,'0'),'aud','authenticated','role','authenticated','aal',p_aal,
  'email','doc'||n||'@care.example.invalid','is_anonymous',false,'iat',floor(extract(epoch from clock_timestamp())),
  'exp',floor(extract(epoch from clock_timestamp()+interval '30 minutes')),
  'amr',jsonb_build_array(jsonb_build_object('method','oauth','timestamp',current_setting('test.doc_oauth')::bigint),
   jsonb_build_object('method','totp','timestamp',current_setting('test.doc_totp')::bigint)))::text,true);
 return public.is_staff_login_allowed();
end $$;
set local role authenticated;
select pg_temp.doc_login(1);
insert into doc_data(k,v) select 'certificate',to_jsonb(r) from public.append_staff_certificate(
 'dc200000-0000-4000-8000-000000000001','dc300000-0000-4000-8000-000000000001','create','dc600000-0000-4000-8000-000000000001',null,0,
 'dc400000-0000-4000-8000-000000000003','Synthetic professional certificate','SYNTH-STAFF-001',
 (clock_timestamp() at time zone 'Asia/Taipei')::date-1,(clock_timestamp() at time zone 'Asia/Taipei')::date+365,
 'registered','verified','missing',null,null,null,'dc610000-0000-4000-8000-000000000001')r;
insert into doc_data(k,v)select 'native',jsonb_build_object('organizationId','dc200000-0000-4000-8000-000000000001','branchId','dc300000-0000-4000-8000-000000000001',
 'actorUserId','dc100000-0000-4000-8000-000000000001','targetUserId','dc100000-0000-4000-8000-000000000003',
 'targetMembershipId','dc400000-0000-4000-8000-000000000003','certificateKey','dc600000-0000-4000-8000-000000000001',
 'recordVersionId',v->'record_version_id','recordContentHash',v->'content_hash','reviewerUserId','dc100000-0000-4000-8000-000000000002') from doc_data where k='certificate';
reset role;
-- NATIVE_FIXTURE_END

create function pg_temp.doc_input(p_key uuid default 'dc700000-0000-4000-8000-000000000001') returns jsonb language sql security invoker as $$
 select jsonb_build_object('staffMembershipId',v->'targetMembershipId','certificateKey',v->'certificateKey','recordVersionId',v->'recordVersionId',
  'recordContentHash',v->'recordContentHash','idempotency_key',p_key,'sha256',repeat('a',64),'mimeType','application/pdf','fileSizeBytes',4)
 from doc_data where k='native';
$$;
create function pg_temp.doc_reserve(p_input jsonb) returns jsonb language sql security invoker as $$
 select payload from public.reserve_staff_certificate_document('dc200000-0000-4000-8000-000000000001','dc300000-0000-4000-8000-000000000001',p_input);
$$;
create function pg_temp.doc_review(p_doc text,p_key uuid default 'dc710000-0000-4000-8000-000000000001',p_decision text default 'verified') returns jsonb language sql security invoker as $$
 select (select payload from public.review_staff_certificate_document('dc200000-0000-4000-8000-000000000001','dc300000-0000-4000-8000-000000000001',
  jsonb_build_object('documentId',d.v->'documentId','recordVersionId',d.v->'recordVersionId','recordContentHash',d.v->'recordContentHash',
   'decision',p_decision,'reason','Synthetic independently inspected original','idempotency_key',p_key))) from doc_data d where k=p_doc;
$$;
create function pg_temp.doc_snapshot() returns jsonb language sql security invoker as $$
 select (select payload from public.staff_certificate_documents_snapshot('dc200000-0000-4000-8000-000000000001','dc300000-0000-4000-8000-000000000001',
  (v->>'certificateKey')::uuid,(v->>'recordVersionId')::uuid)) from doc_data where k='native';
$$;

select ok(not has_table_privilege('authenticated','private.staff_certificate_documents','select') and not has_table_privilege('service_role','private.staff_certificate_documents','insert'),'evidence direct access is denied');
select ok(not has_function_privilege('authenticated','public.complete_staff_certificate_document_scan(uuid,text,text,text)','execute') and not has_function_privilege('anon','public.reserve_staff_certificate_document(uuid,uuid,jsonb)','execute'),'scan is server only and anonymous reserve is denied');
select ok((select bool_and(relforcerowsecurity) from pg_class where oid in('private.staff_certificate_documents'::regclass,'private.staff_certificate_document_scans'::regclass,'private.staff_certificate_document_reviews'::regclass,'private.staff_certificate_document_operations'::regclass)),'all evidence ledgers force RLS');
select ok((select bool_and(not prosecdef and proconfig @> array['search_path=""']) from pg_proc where oid in('public.reserve_staff_certificate_document(uuid,uuid,jsonb)'::regprocedure,'public.review_staff_certificate_document(uuid,uuid,jsonb)'::regprocedure,'public.complete_staff_certificate_document_scan(uuid,text,text,text)'::regprocedure)),'public wrappers pin invoker boundary');
set local role authenticated;
select ok(pg_temp.doc_login(2),'independent reviewer has actual admitted Google session');
select is(pg_temp.doc_snapshot()->>'total','0','approved nonexecutive can read bounded empty evidence');
select ok(public.staff_certificate_document_recent_aal2_evidence('dc200000-0000-4000-8000-000000000001','dc300000-0000-4000-8000-000000000001')->>'actorUserId'='dc100000-0000-4000-8000-000000000002','narrow actual evidence returns original actor');
select pg_temp.doc_login(4);
select throws_ok($$select pg_temp.doc_reserve(pg_temp.doc_input())$$,'42501','certificate document reservation is not permitted','unapproved Google account cannot upload');
select pg_temp.doc_login(1,'aal1');
select throws_ok($$select pg_temp.doc_reserve(pg_temp.doc_input())$$,'42501','certificate document reservation is not permitted','AAL1 cannot upload');
select pg_temp.doc_login(1);
select throws_ok($$select pg_temp.doc_reserve(pg_temp.doc_input()||'{"objectPath":"fake/path"}'::jsonb)$$,'22023','invalid certificate document reservation','caller cannot supply object path');
select throws_ok($$select pg_temp.doc_reserve(pg_temp.doc_input()||'{"sha256":"bad"}'::jsonb)$$,'22023','invalid certificate document reservation','malformed hash rejected');
select throws_ok($$select pg_temp.doc_reserve(pg_temp.doc_input()||jsonb_build_object('recordContentHash',repeat('b',64)))$$,'42501','certificate document source is outside current scope','wrong exact source hash rejected');
select throws_ok($$select pg_temp.doc_reserve(pg_temp.doc_input()||'{"staffMembershipId":"dc400000-0000-4000-8000-000000000002"}'::jsonb)$$,'42501','certificate document source is outside current scope','wrong membership rejected');
insert into doc_data values('first',pg_temp.doc_reserve(pg_temp.doc_input()));
select ok(v->>'objectPath'='dc200000-0000-4000-8000-000000000001/dc300000-0000-4000-8000-000000000001/dc400000-0000-4000-8000-000000000003/dc600000-0000-4000-8000-000000000001/'||(v->>'documentId') and v->>'scanStatus'='reserved' and v->'terminalReceipt'='null'::jsonb and v->'signable'='false'::jsonb,'reservation derives exact five-slot path and does not invent scan/sign authority') from doc_data where k='first';
select is(pg_temp.doc_reserve(pg_temp.doc_input())->>'replayed','true','exact reservation key replay returns same evidence');
select throws_ok($$select pg_temp.doc_reserve(pg_temp.doc_input()||'{"fileSizeBytes":5}'::jsonb)$$,'23505','certificate document operation key conflict','different body cannot reuse operation key');
select throws_ok($$select pg_temp.doc_review('first')$$,'42501','independent certificate document reviewer required','uploader cannot human verify');
select pg_temp.doc_login(3);
select throws_ok($$select pg_temp.doc_review('first')$$,'42501','independent certificate document reviewer required','target cannot human verify own proof');
select pg_temp.doc_login(2);
select throws_ok($$select pg_temp.doc_review('first')$$,'22023','clean certificate document required for review','unscanned file cannot human verify');
reset role;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select throws_ok($$select payload from public.complete_staff_certificate_document_scan((select (v->>'documentId')::uuid from doc_data where k='first'),repeat('b',64),'clean','synthetic.scanner')$$,'42501','certificate document scan reservation is not current','server cannot bless a mismatched SHA256');
select throws_ok($$select payload from public.complete_staff_certificate_document_scan((select (v->>'documentId')::uuid from doc_data where k='first'),repeat('a',64),'clean','synthetic.scanner')$$,'55000','certificate document stored object is not confirmed','absent object cannot receive clean verdict');
reset role;
insert into storage.objects(bucket_id,name,metadata)select 'staff-certificate-documents',v->>'objectPath','{"size":4,"mimetype":"application/pdf"}'::jsonb from doc_data where k='first';
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
insert into doc_data select 'scan',payload from public.complete_staff_certificate_document_scan((select (v->>'documentId')::uuid from doc_data where k='first'),repeat('a',64),'clean','synthetic.scanner');
select ok(v->>'scanStatus'='clean' and v->>'serviceEligibility'='not_evaluated' and v->'signable'='false'::jsonb,'clean scan does not establish qualification or signature readiness')from doc_data where k='scan';
select is((select payload->>'scanStatus' from public.complete_staff_certificate_document_scan((select (v->>'documentId')::uuid from doc_data where k='first'),repeat('a',64),'clean','synthetic.scanner')),'clean','exact scanner completion replay remains clean');
select throws_ok($$select payload from public.complete_staff_certificate_document_scan((select (v->>'documentId')::uuid from doc_data where k='first'),repeat('a',64),'infected','synthetic.scanner')$$,'23505','certificate document scan evidence conflict','scanner cannot change prior immutable verdict');
reset role;
set local role authenticated;
select pg_temp.doc_login(1);
select ok(pg_temp.doc_reserve(pg_temp.doc_input())->'terminalReceipt'=(select v from doc_data where k='scan'),'completed reservation replay exposes actual terminal receipt');
select pg_temp.doc_login(2);
insert into doc_data values('review',pg_temp.doc_review('first'));
select ok(v->>'decision'='verified' and v->>'reviewedBy'='dc100000-0000-4000-8000-000000000002' and v->'signable'='false'::jsonb,'independent human verification records actual actor without granting qualification')from doc_data where k='review';
select is(pg_temp.doc_review('first')->>'replayed','true','same human review body/key replays one original review');
select throws_ok($$select pg_temp.doc_review('first','dc710000-0000-4000-8000-000000000001','rejected')$$,'23505','certificate document operation key conflict','changed review decision cannot reuse key');
select throws_ok($$select pg_temp.doc_review('first','dc710000-0000-4000-8000-000000000002')$$,'40001','certificate document already reviewed','different key cannot create second human review');
select ok(pg_temp.doc_snapshot()->>'total'='1' and pg_temp.doc_snapshot()->'documents'->0->'canDownload'='true'::jsonb and pg_temp.doc_snapshot()->'signable'='false'::jsonb,'snapshot joins exact scan and independent review without formal readiness');
select is((select payload->>'expiresSeconds' from public.prepare_staff_certificate_document_download('dc200000-0000-4000-8000-000000000001','dc300000-0000-4000-8000-000000000001',(select (v->>'documentId')::uuid from doc_data where k='first'))),'60','private clean original may obtain bounded download instruction');
reset role;
select ok((select count(*)=1 and bool_and(evidence_status='missing' and attachment_reference is null and attachment_sha256 is null)from public.staff_certificate_versions where certificate_key='dc600000-0000-4000-8000-000000000001'),'all operations leave original certificate versions unchanged');
select throws_ok($$update private.staff_certificate_document_reviews set decision='rejected'$$,'23514','staff_certificate_document_reviews is append-only','human evidence cannot be rewritten');
select ok(not exists(select 1 from public.audit_events where table_name like 'staff_certificate_document%' and metadata::text~'Synthetic independently|sha256|recordContentHash|objectPath|doc1@'),'audit excludes hashes, paths, reasons and emails');

-- A second actual object can be independently rejected; no second decision
-- may overwrite either outcome. Neither outcome amends the certificate.
set local role authenticated;
select pg_temp.doc_login(1);
insert into doc_data values('second',pg_temp.doc_reserve(pg_temp.doc_input('dc700000-0000-4000-8000-000000000002')));
select throws_ok($$select * from public.complete_staff_certificate_document_scan((select (v->>'documentId')::uuid from doc_data where k='second'),repeat('a',64),'clean','synthetic.scanner')$$,'42501','permission denied for function complete_staff_certificate_document_scan','browser cannot invent scanner verdict even with management');
select throws_ok($$insert into private.staff_certificate_document_scans(document_id,sha256,verdict,scanner,object_identity)values(gen_random_uuid(),repeat('a',64),'clean','fake','{}')$$,'42501','permission denied for table staff_certificate_document_scans','direct scanner ledger DML is prohibited');
reset role;
insert into storage.objects(bucket_id,name,metadata)select 'staff-certificate-documents',v->>'objectPath','{"size":5,"mimetype":"application/pdf"}'::jsonb from doc_data where k='second';
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select throws_ok($$select * from public.complete_staff_certificate_document_scan((select (v->>'documentId')::uuid from doc_data where k='second'),repeat('a',64),'clean','synthetic.scanner')$$,'55000','certificate document stored object is not confirmed','wrong stored size cannot receive clean scan');
reset role;
update storage.objects set metadata='{"size":4,"mimetype":"application/pdf"}'::jsonb where name=(select v->>'objectPath'from doc_data where k='second');
update private.staff_google_access_grants set enabled=false where allowed_user_id='dc100000-0000-4000-8000-000000000001';
update private.executive_access_policy set enabled=false;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select throws_ok($$select * from public.complete_staff_certificate_document_scan((select (v->>'documentId')::uuid from doc_data where k='second'),repeat('a',64),'clean','synthetic.scanner')$$,'42501','certificate document scan reservation is not current','revoked captured uploader admission closes scanner completion');
reset role;
update private.staff_google_access_grants set enabled=true where allowed_user_id='dc100000-0000-4000-8000-000000000001';
update private.executive_access_policy set enabled=true;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select payload from public.complete_staff_certificate_document_scan((select (v->>'documentId')::uuid from doc_data where k='second'),repeat('a',64),'clean','synthetic.scanner');
reset role;
set local role authenticated;
select pg_temp.doc_login(2);
select throws_ok($$select * from public.review_staff_certificate_document('dc200000-0000-4000-8000-000000000001','dc300000-0000-4000-8000-000000000001',
 jsonb_build_object('documentId',(select v->'documentId'from doc_data where k='second'),'recordVersionId',(select v->'recordVersionId'from doc_data where k='second'),
 'recordContentHash',(select v->'recordContentHash'from doc_data where k='second'),'decision','verified','reason','no','idempotency_key',gen_random_uuid()))$$,'22023','invalid certificate document review','human review requires a meaningful reason');
select is(pg_temp.doc_review('second','dc710000-0000-4000-8000-000000000003','rejected')->>'decision','rejected','independent rejection is preserved as its own immutable outcome');
select throws_ok($$select * from public.prepare_staff_certificate_document_download('dc200000-0000-4000-8000-000000000001','dc300000-0000-4000-8000-000000000001',(select (v->>'documentId')::uuid from doc_data where k='second'))$$,'42501','certificate document download is not permitted','human rejected original cannot be downloaded');
reset role;

-- A read-only current employee may read self history without management.
delete from public.membership_roles where membership_id='dc400000-0000-4000-8000-000000000003';
insert into public.roles(id,organization_id,role_key,name)values('dc800000-0000-4000-8000-000000000001','dc200000-0000-4000-8000-000000000001','synthetic_doc_reader','Synthetic self reader');
insert into public.role_permissions(role_id,permission_id)select 'dc800000-0000-4000-8000-000000000001',id from public.permissions where permission_key='staff_certificates.read';
insert into public.membership_roles(membership_id,role_id)values('dc400000-0000-4000-8000-000000000003','dc800000-0000-4000-8000-000000000001');
set local role authenticated;
select pg_temp.doc_login(3,'aal1');
select is(public.can_begin_staff_mfa(),true,'approved doc-only self reader may acquire MFA without management');
select pg_temp.doc_login(3);
select is(pg_temp.doc_snapshot()->>'total','2','read-only assigned employee can inspect own original history');
select ok(public.staff_certificate_document_recent_aal2_evidence('dc200000-0000-4000-8000-000000000001','dc300000-0000-4000-8000-000000000001') is not null,'read-only self download evidence is available without manage');
select throws_ok($$select pg_temp.doc_reserve(pg_temp.doc_input('dc700000-0000-4000-8000-000000000009'))$$,'42501','certificate document reservation is not permitted','self reader cannot gain upload authority');
select pg_temp.doc_login(2);
reset role;
update private.reauth_events set revoked_at=clock_timestamp() where user_id='dc100000-0000-4000-8000-000000000002';
set local role authenticated;
select pg_temp.doc_login(2);
select throws_ok($$select pg_temp.doc_review('first')$$,'42501','recent certificate AAL2 evidence is required','revoked evidence closes exact review replay');
reset role;
update public.memberships set status='suspended' where id='dc400000-0000-4000-8000-000000000003';
set local role authenticated;
select pg_temp.doc_login(1);
select throws_ok($$select pg_temp.doc_reserve(pg_temp.doc_input())$$,'42501','certificate document source is outside current scope','inactive target closes reservation replay');
reset role;
update public.memberships set status='active' where id='dc400000-0000-4000-8000-000000000003';
delete from storage.objects where name=(select v->>'objectPath'from doc_data where k='first');
set local role authenticated;
select pg_temp.doc_login(1);
select throws_ok($$select pg_temp.doc_reserve(pg_temp.doc_input())$$,'55000','certificate document stored object is not confirmed','completed missing object never recreated on replay');
reset role;
set local role authenticated;
select pg_temp.doc_login(1);
insert into doc_data(k,v)select 'corrected',to_jsonb(r) from public.append_staff_certificate(
 'dc200000-0000-4000-8000-000000000001','dc300000-0000-4000-8000-000000000001','correct','dc600000-0000-4000-8000-000000000001',
 (select(v->>'recordVersionId')::uuid from doc_data where k='native'),1,'dc400000-0000-4000-8000-000000000003','Synthetic professional certificate','SYNTH-STAFF-001',
 (clock_timestamp() at time zone 'Asia/Taipei')::date-1,(clock_timestamp() at time zone 'Asia/Taipei')::date+365,'registered','verified','missing',null,null,
 'Synthetic original source correction','dc610000-0000-4000-8000-000000000002')r;
select throws_ok($$select pg_temp.doc_reserve(pg_temp.doc_input())$$,'40001','certificate document source version changed','a changed terminal certificate closes old exact reservation replay');
select ok(pg_temp.doc_snapshot()->>'total'='2' and pg_temp.doc_snapshot()->'documents'->0->'canDownload'='false'::jsonb,'old scoped evidence remains readable but never claims current download eligibility');
reset role;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select throws_ok($$select * from public.complete_staff_certificate_document_scan((select (v->>'documentId')::uuid from doc_data where k='second'),repeat('a',64),'clean','synthetic.scanner')$$,'40001','certificate document source version changed','stale certificate closes exact scanner replay');
reset role;
set local role authenticated;
select pg_temp.doc_login(1);
insert into doc_data(k,v)select 'voided',to_jsonb(r) from public.append_staff_certificate(
 'dc200000-0000-4000-8000-000000000001','dc300000-0000-4000-8000-000000000001','void','dc600000-0000-4000-8000-000000000001',
 (select(v->>'record_version_id')::uuid from doc_data where k='corrected'),2,'dc400000-0000-4000-8000-000000000003',null,null,null,null,
 '', '', '',null,null,'Synthetic void with history preserved','dc610000-0000-4000-8000-000000000003')r;
select throws_ok($$select pg_temp.doc_reserve(pg_temp.doc_input('dc700000-0000-4000-8000-000000000011')||jsonb_build_object(
 'recordVersionId',(select v->'record_version_id'from doc_data where k='voided'),'recordContentHash',(select v->'content_hash'from doc_data where k='voided')))$$,
 '40001','certificate document source version changed','void terminal cannot receive new evidence');
reset role;
select * from finish();
rollback;
