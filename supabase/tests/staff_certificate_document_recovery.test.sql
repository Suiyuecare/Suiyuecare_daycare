begin;
select plan(57);
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
create function pg_temp.doc_sources(p_staff uuid default null,p_page integer default 1) returns jsonb language sql security invoker as $$
 select payload from public.staff_certificate_document_sources('dc200000-0000-4000-8000-000000000001','dc300000-0000-4000-8000-000000000001',p_staff,p_page);
$$;
create function pg_temp.doc_lookup(p_key uuid default 'dc700000-0000-4000-8000-000000000001',p_action text default 'reserve',p_binding jsonb default null,
 p_nonce uuid default 'dc720000-0000-4000-8000-000000000001') returns jsonb language sql security invoker as $$
 select payload from public.staff_certificate_document_operation_receipt('dc200000-0000-4000-8000-000000000001','dc300000-0000-4000-8000-000000000001',p_action,p_key,
  coalesce(p_binding,pg_temp.doc_input(p_key)-'idempotency_key'),p_nonce);
$$;
create function pg_temp.doc_close(p_key uuid default 'dc700000-0000-4000-8000-000000000001',p_reconciliation uuid default 'dc730000-0000-4000-8000-000000000001',
 p_nonce uuid default 'dc720000-0000-4000-8000-000000000002') returns jsonb language sql security invoker as $$
 select payload from public.reconcile_expired_staff_certificate_document('dc200000-0000-4000-8000-000000000001','dc300000-0000-4000-8000-000000000001',
  p_key,p_reconciliation,pg_temp.doc_input(p_key)-'idempotency_key',p_nonce);
$$;

select ok(not has_table_privilege('authenticated','private.staff_certificate_document_terminations','select')
 and not has_table_privilege('service_role','private.staff_certificate_document_terminations','insert'),'closure ledger is private for browser and scanner');
select ok((select relforcerowsecurity from pg_class where oid='private.staff_certificate_document_terminations'::regclass),'closure ledger forces RLS');
select ok(not has_function_privilege('anon','public.staff_certificate_document_sources(uuid,uuid,uuid,integer)','execute')
 and not has_function_privilege('service_role','public.reconcile_expired_staff_certificate_document(uuid,uuid,uuid,uuid,jsonb,uuid)','execute'),'anonymous discovery and scanner closure are denied');
set local role authenticated;
select ok(pg_temp.doc_login(2),'real approved nonexecutive staff can discover document sources');
select ok(pg_temp.doc_sources()->>'total'='1' and pg_temp.doc_sources()->>'canManageDocuments'='true'
 and pg_temp.doc_sources()->'rows'->0->'recordVersionId'=(select v->'recordVersionId'from doc_data where k='native'),'scoped discovery returns exact current source pointer');
select ok(pg_temp.doc_sources()->'staffMembershipId'='null'::jsonb and pg_temp.doc_sources()->>'pageSize'='50'
 and pg_temp.doc_sources()->'hasMore'='false'::jsonb and pg_temp.doc_sources()->'signable'='false'::jsonb,'source page contract never claims qualification');
select ok(pg_temp.doc_sources(null,2)->>'total'='1' and pg_temp.doc_sources(null,2)->'rows'='[]'::jsonb
 and pg_temp.doc_sources(null,2)->'hasMore'='false'::jsonb,'later page is bounded observational empty not zero total');
select throws_ok($$select pg_temp.doc_sources(null,10001)$$,'42501','certificate document source discovery is not permitted','source page upper bound is exactly ten thousand');
select pg_temp.doc_login(4);
select throws_ok($$select pg_temp.doc_sources()$$,'42501','certificate document source discovery is not permitted','unapproved Google identity cannot discover staff documents');
select pg_temp.doc_login(1,'aal1');
select throws_ok($$select pg_temp.doc_sources()$$,'42501','certificate document source discovery is not permitted','AAL1 cannot discover document source');
select throws_ok($$select pg_temp.doc_lookup()$$,'42501','certificate document operation lookup is not permitted','AAL1 cannot query original document operations');
select pg_temp.doc_login(1);
select ok(pg_temp.doc_lookup()->>'status'='not_found' and pg_temp.doc_lookup()->'persisted'='false'::jsonb
 and pg_temp.doc_lookup()->'receipt'='null'::jsonb,'observational missing operation has no persisted proof');
select throws_ok($$select pg_temp.doc_lookup(p_binding=>pg_temp.doc_input()-'idempotency_key'||'{"extra":true}'::jsonb)$$,
 '22023','invalid certificate document operation binding','unknown binding fields are rejected');
select throws_ok($$select pg_temp.doc_lookup(p_nonce=>'00000000-0000-0000-0000-000000000000')$$,
 '22023','invalid certificate document operation lookup','invalid RFC nonce cannot be treated as missing');
insert into doc_data values('first',pg_temp.doc_reserve(pg_temp.doc_input()));
insert into doc_data values('pending',pg_temp.doc_lookup());
select ok(v->>'status'='reserved' and v->>'reservationState'='pending' and v->'persisted'='true'::jsonb
 and v->'receipt'->'documentId'=(select v->'documentId'from doc_data where k='first') and v->'closure'='null'::jsonb,
 'original reservation proof binds only its exact persisted reservation')from doc_data where k='pending';
select ok(v->'binding'=pg_temp.doc_input()-'idempotency_key' and v->>'actorUserId'='dc100000-0000-4000-8000-000000000001'
 and v->'receipt'->>'scanStatus'='reserved','lookup cannot claim an absent scan or upload completion')from doc_data where k='pending';
select is(pg_temp.doc_lookup(p_binding=>pg_temp.doc_input()-'idempotency_key'||jsonb_build_object('sha256',repeat('b',64)))->>'status',
 'not_found','same key different original metadata is not a matching receipt');
select is(pg_temp.doc_lookup('dc700000-0000-4000-8000-000000000009')->>'status','not_found','another key is not substituted with latest document');
select is(pg_temp.doc_lookup(p_action=>'review',p_binding=>jsonb_build_object('documentId',(select v->'documentId'from doc_data where k='first'),
 'recordVersionId',(select v->'recordVersionId'from doc_data where k='first'),'recordContentHash',(select v->'recordContentHash'from doc_data where k='first'),
 'decision','verified','reasonSha256',repeat('a',64)))->>'status','not_found','valid different action cannot borrow a reservation operation');
select throws_ok($$select * from public.staff_certificate_document_operation_receipt('dc200000-0000-4000-8000-000000000001',
 'dc300000-0000-4000-8000-000000000002','reserve','dc700000-0000-4000-8000-000000000001',pg_temp.doc_input()-'idempotency_key',
 'dc720000-0000-4000-8000-000000000001')$$,'42501','certificate document operation lookup is not permitted','original key cannot bypass actual current branch authority');
select pg_temp.doc_login(2);
select is(pg_temp.doc_lookup()->>'status','not_found','another admitted actor cannot read original uploader operation');
select pg_temp.doc_login(1);
select throws_ok($$select pg_temp.doc_close()$$,'22023','certificate document reservation has not expired','fresh reservation cannot be explicitly closed');
reset role;
select is((select count(*)::integer from private.staff_certificate_document_terminations),0,'missing and reserved GETs never create closure');
insert into storage.objects(bucket_id,name,metadata)select 'staff-certificate-documents',v->>'objectPath','{"size":4,"mimetype":"application/pdf"}'::jsonb from doc_data where k='first';
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
insert into doc_data select 'clean',payload from public.complete_staff_certificate_document_scan((select(v->>'documentId')::uuid from doc_data where k='first'),repeat('a',64),'clean','synthetic.scanner');
reset role;
set local role authenticated;
select pg_temp.doc_login(1);
select ok(pg_temp.doc_lookup()->>'status'='completed' and pg_temp.doc_lookup()->'receipt'=(select v from doc_data where k='clean'),
 'completed reserve lookup returns immutable original scan receipt');
select ok(pg_temp.doc_close(p_reconciliation=>'dc730000-0000-4000-8000-000000000009')->>'status'='completed'
 and pg_temp.doc_close(p_reconciliation=>'dc730000-0000-4000-8000-000000000009')->'replayed'='true'::jsonb
 and pg_temp.doc_close(p_reconciliation=>'dc730000-0000-4000-8000-000000000009')->'closure'='null'::jsonb,
 'terminal scan winner is reported without expiration closure even while fresh');
select throws_ok($$select pg_temp.doc_reserve(pg_temp.doc_input('dc730000-0000-4000-8000-000000000009'))$$,
 '23505','certificate document operation key conflict','completed reconciliation key cannot become ordinary reserve intent');
select pg_temp.doc_login(2);
insert into doc_data select 'review',payload from public.review_staff_certificate_document('dc200000-0000-4000-8000-000000000001','dc300000-0000-4000-8000-000000000001',
 jsonb_build_object('documentId',(select v->'documentId'from doc_data where k='first'),'recordVersionId',(select v->'recordVersionId'from doc_data where k='first'),
 'recordContentHash',(select v->'recordContentHash'from doc_data where k='first'),'decision','verified','reason','Synthetic independently inspected original','idempotency_key','dc710000-0000-4000-8000-000000000001'));
reset role;
insert into doc_data select 'reviewBinding',jsonb_build_object('documentId',v->'documentId','recordVersionId',v->'recordVersionId','recordContentHash',v->'recordContentHash',
 'decision',v->'decision','reasonSha256',encode(sha256(convert_to(v->>'reason','UTF8')),'hex'))from doc_data where k='review';
-- Revoking the consumed recent factor is a real write blocker, not a read blocker.
update private.reauth_events set revoked_at=clock_timestamp() where user_id='dc100000-0000-4000-8000-000000000002';
set local role authenticated;
select pg_temp.doc_login(2);
select ok(pg_temp.doc_lookup('dc710000-0000-4000-8000-000000000001','review',(select v from doc_data where k='reviewBinding'))->'receipt'=(select v from doc_data where k='review')
 and pg_temp.doc_lookup('dc710000-0000-4000-8000-000000000001','review',(select v from doc_data where k='reviewBinding'))->>'status'='completed',
 'original human review remains readable without inventing fresh MFA evidence');
select is(pg_temp.doc_lookup('dc710000-0000-4000-8000-000000000001','review',(select v||jsonb_build_object('reasonSha256',repeat('b',64))from doc_data where k='reviewBinding'))->>'status',
 'not_found','different reviewed reason digest is not a matching original review');
select throws_ok($$select pg_temp.doc_close()$$,'42501','recent certificate AAL2 evidence is required','expired recent evidence does not authorize explicit closure');
reset role;
update private.reauth_events set revoked_at=null where user_id='dc100000-0000-4000-8000-000000000002';

-- Real near-expiry original evidence; no production Auth predicate or immutable
-- document timestamp is changed. Reserve while admitted, wait true expiry, then
-- use the actor's other real current session for explicit closure.
select set_config('test.doc_near',floor(extract(epoch from clock_timestamp()-interval '15 minutes'+interval '4 seconds'))::text,true);
insert into auth.sessions(id,user_id,created_at,aal)values('dc120000-0000-4000-8000-000000000011','dc100000-0000-4000-8000-000000000001',clock_timestamp()-interval '16 minutes','aal2');
insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method)values
 ('dc130000-0000-4000-8000-000000000022','dc120000-0000-4000-8000-000000000011',to_timestamp(current_setting('test.doc_near')::bigint)-interval '30 seconds',to_timestamp(current_setting('test.doc_near')::bigint)-interval '30 seconds','oauth'),
 ('dc130000-0000-4000-8000-000000000023','dc120000-0000-4000-8000-000000000011',to_timestamp(current_setting('test.doc_near')::bigint),to_timestamp(current_setting('test.doc_near')::bigint),'totp');
insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,issued_jwt_jti,created_at,expires_at,consumed_at,consumed_jwt_iat,consumed_jwt_jti,factor_method,factor_verified_at)
 values('dc500000-0000-4000-8000-000000000011','dc100000-0000-4000-8000-000000000001','dc120000-0000-4000-8000-000000000011',repeat('a',64),'dc510000-0000-4000-8000-000000000011',
 to_timestamp(current_setting('test.doc_near')::bigint)-interval '60 seconds','near-before',to_timestamp(current_setting('test.doc_near')::bigint)-interval '30 seconds',
 to_timestamp(current_setting('test.doc_near')::bigint)+interval '5 minutes',to_timestamp(current_setting('test.doc_near')::bigint),to_timestamp(current_setting('test.doc_near')::bigint),'near-after','totp',to_timestamp(current_setting('test.doc_near')::bigint));
insert into private.reauth_events(user_id,session_id,challenge_id,aal,verification_method,verified_at)values('dc100000-0000-4000-8000-000000000001','dc120000-0000-4000-8000-000000000011','dc500000-0000-4000-8000-000000000011','aal2','totp',to_timestamp(current_setting('test.doc_near')::bigint));
set local role authenticated;
select pg_temp.doc_login(1);
select set_config('request.jwt.claims',(current_setting('request.jwt.claims')::jsonb||jsonb_build_object('session_id','dc120000-0000-4000-8000-000000000011',
 'amr',jsonb_build_array(jsonb_build_object('method','oauth','timestamp',current_setting('test.doc_near')::bigint-30),jsonb_build_object('method','totp','timestamp',current_setting('test.doc_near')::bigint))))::text,true);
insert into doc_data values('expired',pg_temp.doc_reserve(pg_temp.doc_input('dc700000-0000-4000-8000-000000000002')));
select is(pg_temp.doc_lookup('dc700000-0000-4000-8000-000000000002')->>'reservationState','pending','genuine near-expiry proof initially permits original reservation');
select pg_sleep(5);
select pg_temp.doc_login(1);
select is(pg_temp.doc_lookup('dc700000-0000-4000-8000-000000000002')->>'reservationState','expired','fresh current session does not renew original captured evidence');
select throws_ok($$select pg_temp.doc_close('dc700000-0000-4000-8000-000000000002','dc730000-0000-4000-8000-000000000009')$$,
 '23505','certificate document reconciliation key conflict','completed reconciliation key cannot bind another original reservation');
reset role;
select is((select count(*)::integer from private.staff_certificate_document_terminations),0,'expiry GET is observation only');
set local role authenticated;
select pg_temp.doc_login(1);
insert into doc_data values('closure',pg_temp.doc_close('dc700000-0000-4000-8000-000000000002'));
select ok(v->>'status'='expired_closed' and v->'replayed'='false'::jsonb and v->'receipt'->>'scanStatus'='reserved'
 and v->'closure'->>'reason'='reservation_expired' and v->'serviceEligibility'='"not_evaluated"'::jsonb,'explicit management closure is not scan or qualification')from doc_data where k='closure';
select ok(pg_temp.doc_close('dc700000-0000-4000-8000-000000000002',p_nonce=>'dc720000-0000-4000-8000-000000000003')->'closure'=(select v->'closure'from doc_data where k='closure')
 and pg_temp.doc_close('dc700000-0000-4000-8000-000000000002')->'replayed'='true'::jsonb,'same reconciliation body/key preserves exact immutable closure');
select ok(pg_temp.doc_lookup('dc700000-0000-4000-8000-000000000002')->>'status'='expired_closed'
 and pg_temp.doc_lookup('dc700000-0000-4000-8000-000000000002')->'closure'=(select v->'closure'from doc_data where k='closure'),'original receipt exposes exact closure without creating another');
select throws_ok($$select pg_temp.doc_close('dc700000-0000-4000-8000-000000000002','dc730000-0000-4000-8000-000000000002')$$,
 '23505','certificate document reconciliation key conflict','another key cannot replace original closure');
select throws_ok($$select pg_temp.doc_reserve(pg_temp.doc_input('dc700000-0000-4000-8000-000000000002'))$$,
 '55000','certificate document reservation is closed','fresh MFA cannot revive closed original reservation');
select throws_ok($$select pg_temp.doc_reserve(pg_temp.doc_input('dc730000-0000-4000-8000-000000000001'))$$,
 '23505','certificate document operation key conflict','reconciliation key cannot be reused as new upload operation');
reset role;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select throws_ok($$select * from public.complete_staff_certificate_document_scan((select(v->>'documentId')::uuid from doc_data where k='expired'),repeat('a',64),'clean','synthetic.scanner')$$,
 '55000','certificate document reservation is closed','late scanner cannot complete closed reservation');
reset role;
select is((select count(*)::integer from private.staff_certificate_document_terminations),1,'closure replay appends only one immutable termination');
select is((select count(*)::integer from private.staff_certificate_document_reconciliations),2,'both completed and closed POST intents bind exactly once');
select throws_ok($$update private.staff_certificate_document_terminations set reason='reservation_expired'$$,
 '23514','staff_certificate_document_terminations is append-only','termination cannot be overwritten');
select ok((select count(*)=1 and bool_and(evidence_status='missing' and attachment_reference is null)from public.staff_certificate_versions
 where certificate_key='dc600000-0000-4000-8000-000000000001'),'all recovery actions leave original qualification and certificate unchanged');

-- A synthetic owner-level partial-ledger corruption must not look like a
-- complete closure. This inserts no Auth bypass and grants no clinical status.
set local role authenticated;
select pg_temp.doc_login(1);
insert into doc_data values('partial',pg_temp.doc_reserve(pg_temp.doc_input('dc700000-0000-4000-8000-000000000008')));
reset role;
insert into private.staff_certificate_document_terminations(document_id,organization_id,branch_id,closed_by,original_idempotency_key,reconciliation_key,request_hash)
 select(v->>'documentId')::uuid,'dc200000-0000-4000-8000-000000000001','dc300000-0000-4000-8000-000000000001','dc100000-0000-4000-8000-000000000001',
 'dc700000-0000-4000-8000-000000000008','dc730000-0000-4000-8000-000000000008',encode(sha256(convert_to(jsonb_build_object(
 'organizationId','dc200000-0000-4000-8000-000000000001'::uuid,'branchId','dc300000-0000-4000-8000-000000000001'::uuid,
 'originalIdempotencyKey','dc700000-0000-4000-8000-000000000008'::uuid,'reconciliationKey','dc730000-0000-4000-8000-000000000008'::uuid,
 'binding',pg_temp.doc_input('dc700000-0000-4000-8000-000000000008')-'idempotency_key')::text,'UTF8')),'hex')from doc_data where k='partial';
set local role authenticated;
select pg_temp.doc_login(1);
select throws_ok($$select pg_temp.doc_lookup('dc700000-0000-4000-8000-000000000008')$$,
 '55000','certificate document termination evidence is invalid','partial closure without exact intent ledger is not a complete original proof');
reset role;

-- Real read-only source discovery: target employee has read only, no global
-- writer expansion and no management authority implied by seeing self record.
delete from public.membership_roles where membership_id='dc400000-0000-4000-8000-000000000003';
insert into public.roles(id,organization_id,role_key,name)values('dc800000-0000-4000-8000-000000000001','dc200000-0000-4000-8000-000000000001','synthetic_doc_reader','Synthetic self reader');
insert into public.role_permissions(role_id,permission_id)select 'dc800000-0000-4000-8000-000000000001',id from public.permissions where permission_key='staff_certificates.read';
insert into public.membership_roles(membership_id,role_id)values('dc400000-0000-4000-8000-000000000003','dc800000-0000-4000-8000-000000000001');
set local role authenticated;
select pg_temp.doc_login(3);
select ok(pg_temp.doc_sources()->>'total'='1' and pg_temp.doc_sources()->'canManageDocuments'='false'::jsonb
 and pg_temp.doc_sources()->'rows'->0->'canUpload'='false'::jsonb,'self reader discovers only own exact source without upload authority');
select throws_ok($$select pg_temp.doc_sources('dc400000-0000-4000-8000-000000000002')$$,
 '42501','certificate document source discovery is not permitted','self reader cannot filter to another staff membership');
select throws_ok($$select pg_temp.doc_close('dc700000-0000-4000-8000-000000000002')$$,
 '42501','certificate document reconciliation is not permitted','self reader cannot close another employee upload');
reset role;
-- Real original certificate correction keeps historical operation truth while
-- source discovery advances to the same certificate's terminal pointer.
set local role authenticated;
select pg_temp.doc_login(1);
insert into doc_data(k,v)select 'corrected',to_jsonb(r)from public.append_staff_certificate(
 'dc200000-0000-4000-8000-000000000001','dc300000-0000-4000-8000-000000000001','correct','dc600000-0000-4000-8000-000000000001',
 (select(v->>'recordVersionId')::uuid from doc_data where k='native'),1,'dc400000-0000-4000-8000-000000000003','Synthetic professional certificate','SYNTH-STAFF-001',
 (clock_timestamp() at time zone 'Asia/Taipei')::date-1,(clock_timestamp() at time zone 'Asia/Taipei')::date+365,'registered','verified','missing',null,null,
 'Synthetic source replacement','dc610000-0000-4000-8000-000000000002')r;
select ok(pg_temp.doc_sources()->'rows'->0->'recordVersionId'=(select v->'record_version_id'from doc_data where k='corrected')
 and pg_temp.doc_sources()->>'total'='1','discovery uses same certificate terminal not historical previous version');
select ok(pg_temp.doc_lookup()->>'status'='completed' and pg_temp.doc_lookup()->'receipt'=(select v from doc_data where k='clean'),
 'superseded source never substitutes another operation receipt');
select ok(pg_temp.doc_close('dc700000-0000-4000-8000-000000000002')->'closure'=(select v->'closure'from doc_data where k='closure'),
 'legitimate new certificate head does not revive or obstruct original expiry closure');
insert into doc_data(k,v)select 'voided',to_jsonb(r)from public.append_staff_certificate(
 'dc200000-0000-4000-8000-000000000001','dc300000-0000-4000-8000-000000000001','void','dc600000-0000-4000-8000-000000000001',
 (select(v->>'record_version_id')::uuid from doc_data where k='corrected'),2,'dc400000-0000-4000-8000-000000000003',null,null,
 null,null,'','','',null,null,
 'Synthetic source void','dc610000-0000-4000-8000-000000000003')r;
select ok(pg_temp.doc_sources()->'rows'->0->>'recordStatus'='voided' and pg_temp.doc_sources()->'rows'->0->'canUpload'='false'::jsonb,
 'voided current certificate remains visible without upload permission');
select ok(pg_temp.doc_close('dc700000-0000-4000-8000-000000000002')->'closure'=(select v->'closure'from doc_data where k='closure'),
 'historical original closure remains exact after a real immutable void');
reset role;
update public.memberships set status='suspended' where id='dc400000-0000-4000-8000-000000000003';
set local role authenticated;
select pg_temp.doc_login(1);
select ok(pg_temp.doc_close('dc700000-0000-4000-8000-000000000002')->'closure'=(select v->'closure'from doc_data where k='closure'),
 'inactive target history can retire old intent without changing eligibility');
reset role;
update public.memberships set status='active'where id='dc400000-0000-4000-8000-000000000003';
update public.memberships set status='suspended'where id='dc400000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.doc_login(1);
select throws_ok($$select pg_temp.doc_close('dc700000-0000-4000-8000-000000000002')$$,
 '42501','certificate document reconciliation is not permitted','historical closure still requires current active actor scope');
reset role;
update public.memberships set status='active'where id='dc400000-0000-4000-8000-000000000001';
select ok((select count(*)=3 and bool_and(evidence_status='missing')from public.staff_certificate_versions where certificate_key='dc600000-0000-4000-8000-000000000001'),
 'only explicit original writer revisions exist and recovery did not modify qualification');
select ok(not exists(select 1 from public.audit_events where table_name in('staff_certificate_document_sources','staff_certificate_document_operation_receipt','staff_certificate_document_expiry_reconciliation')
 and metadata::text~'reasonSha256|recordContentHash|sha256|objectPath|doc1@|Synthetic independently'),'recovery audit excludes private binding and clinical evidence');
select * from finish();
rollback;
