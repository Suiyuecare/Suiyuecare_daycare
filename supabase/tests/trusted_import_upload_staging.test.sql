begin;
select plan(74);

-- Synthetic fixtures with the real executive admission gate. No legacy bypass.
select set_config('test.import_amr', floor(extract(epoch from now()-interval '2 minutes'))::text, true);
insert into auth.users(id,aud,role,email,email_confirmed_at,created_at,updated_at) values
 ('a0100000-0000-4000-8000-000000000001','authenticated','authenticated','synthetic-import@example.invalid',now()-interval '1 day',now()-interval '1 day',now()),
 ('a9900000-0000-4000-8000-000000000001','authenticated','authenticated','synthetic-worker-claim@example.invalid',now()-interval '1 day',now()-interval '1 day',now()),
 ('a9900000-0000-4000-8000-000000000002','authenticated','authenticated','synthetic-legacy-claim@example.invalid',now()-interval '1 day',now()-interval '1 day',now());
insert into auth.identities(id,provider_id,user_id,identity_data,provider) values
 ('a0200000-0000-4000-8000-000000000001','synthetic-import-google','a0100000-0000-4000-8000-000000000001',
  '{"sub":"synthetic-import-google","email":"synthetic-import@example.invalid","email_verified":true}','google');
insert into auth.sessions(id,user_id,created_at,aal) values
 ('a0300000-0000-4000-8000-000000000001','a0100000-0000-4000-8000-000000000001',now()-interval '3 minutes','aal2');
insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method)
select ('a0400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'a0300000-0000-4000-8000-000000000001',
 to_timestamp(current_setting('test.import_amr')::bigint),to_timestamp(current_setting('test.import_amr')::bigint),
 case n when 1 then 'oauth' else 'totp' end from generate_series(1,2) n;
insert into public.organizations(id,code,name) values
 ('a0500000-0000-4000-8000-000000000001','trusted_import_test','合成匯入機構'),
 ('a0500000-0000-4000-8000-000000000002','trusted_import_other','合成其他機構');
insert into public.branches(id,organization_id,code,name) values
 ('a0600000-0000-4000-8000-000000000001','a0500000-0000-4000-8000-000000000001','main','合成分支'),
 ('a0600000-0000-4000-8000-000000000002','a0500000-0000-4000-8000-000000000001','other','合成另一分支'),
 ('a0600000-0000-4000-8000-000000000003','a0500000-0000-4000-8000-000000000002','foreign','合成其他機構分支');
insert into public.profiles(id,display_name,kind) values
 ('a0100000-0000-4000-8000-000000000001','合成匯入執行長','staff');
insert into public.memberships(id,organization_id,branch_id,profile_id,status,starts_at) values
 ('a0700000-0000-4000-8000-000000000001','a0500000-0000-4000-8000-000000000001','a0600000-0000-4000-8000-000000000001',
  'a0100000-0000-4000-8000-000000000001','active',now()-interval '1 day');
insert into public.membership_roles(membership_id,role_id) values
 ('a0700000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002');
insert into private.executive_access_policy(allowed_user_id,allowed_email,google_subject,enabled,approval_reference) values
 ('a0100000-0000-4000-8000-000000000001','synthetic-import@example.invalid','synthetic-import-google',true,'synthetic test only');
insert into private.reauth_challenges(
 id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,created_at,expires_at,
 consumed_at,consumed_jwt_iat,factor_method,factor_verified_at
) values (
 'a0800000-0000-4000-8000-000000000001','a0100000-0000-4000-8000-000000000001','a0300000-0000-4000-8000-000000000001',
 repeat('e',64),'a0900000-0000-4000-8000-000000000001',now()-interval '3 minutes',now()-interval '2 minutes',now()+interval '3 minutes',
 now()-interval '1 minute',now()-interval '1 minute','totp',now()-interval '1 minute');
insert into private.reauth_events(user_id,session_id,challenge_id,aal,verification_method,verified_at) values
 ('a0100000-0000-4000-8000-000000000001','a0300000-0000-4000-8000-000000000001','a0800000-0000-4000-8000-000000000001','aal2','totp',now()-interval '1 minute');

-- Hosted auth.uid() may prioritize legacy claim.sub. Exercise that behavior
-- locally without changing shared bootstrap or any production Auth function.
create or replace function auth.uid() returns uuid language sql stable as $$
 select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), auth.jwt()->>'sub')::uuid;
$$;
create function pg_temp.import_login(p_aal text default 'aal2') returns void language plpgsql security invoker as $$
begin
 perform set_config('request.jwt.claim.sub','',true);
 perform set_config('request.jwt.claim.role','',true);
 perform set_config('request.jwt.claims',jsonb_build_object(
  'sub','a0100000-0000-4000-8000-000000000001','session_id','a0300000-0000-4000-8000-000000000001',
  'role','authenticated','aud','authenticated','aal',p_aal,'is_anonymous',false,'email','synthetic-import@example.invalid',
  'iat',floor(extract(epoch from clock_timestamp())),'exp',floor(extract(epoch from clock_timestamp()+interval '30 minutes')),
  'amr',case when p_aal='aal2' then jsonb_build_array(
    jsonb_build_object('method','oauth','timestamp',current_setting('test.import_amr')::bigint),
    jsonb_build_object('method','totp','timestamp',current_setting('test.import_amr')::bigint))
   else jsonb_build_array(jsonb_build_object('method','oauth','timestamp',current_setting('test.import_amr')::bigint)) end,
  'user_metadata',jsonb_build_object('must_not_be_saved','synthetic-private-user-metadata')
 )::text,true);
end;
$$;
create function pg_temp.reserve_upload(
 p_number integer default 1, p_name text default 'synthetic.html', p_hash text default repeat('a',64),
 p_org uuid default 'a0500000-0000-4000-8000-000000000001', p_branch uuid default 'a0600000-0000-4000-8000-000000000001'
) returns jsonb language sql security invoker as $$
 select public.reserve_import_upload(p_org,p_branch,('a1000000-0000-4000-8000-'||lpad(p_number::text,12,'0'))::uuid,
  p_hash,p_name,'text/html',128,'central-care-plan-html@1');
$$;
create function pg_temp.worker_context() returns void language plpgsql security invoker as $$
begin
 perform set_config('request.jwt.claims','{"role":"service_role","sub":"a9900000-0000-4000-8000-000000000001"}',true);
 perform set_config('request.jwt.claim.sub','a9900000-0000-4000-8000-000000000002',true);
 perform set_config('request.jwt.claim.role','service_role',true);
end;
$$;
select set_config('test.import_payload','{"mappingVersion":"central-care-plan-html@1","sections":[{"id":"s1","code":"A","title":"合成區段"}],"fields":[{"id":"f1","rawValue":"synthetic private value"}],"warnings":[],"conflicts":[],"contentFingerprint":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","security":{"parser":"cheerio-static","externalRequestCount":0}}',true);
create function pg_temp.import_archive() returns jsonb language sql security invoker as $$
 select jsonb_build_object(
  'key','organizations/'||(r->>'organization_id')||'/branches/'||(r->>'branch_id')||'/central-html/'||(r->>'file_sha256')||'/'||(r->>'reservation_id')||'.html',
  'versionId','synthetic-s3-version-1','sha256',r->>'file_sha256','createdAt',r->>'created_at',
  'byteLength',(r->>'file_size_bytes')::integer,
  'retainUntil',((r->>'created_at')::timestamptz+interval '7 years')
 ) from (select current_setting('test.import_reservation')::jsonb r) fixture;
$$;
create function pg_temp.complete_upload(p_payload text default null,p_archive jsonb default null)
returns jsonb language sql security invoker as $$
 select public.complete_import_upload((current_setting('test.import_reservation')::jsonb->>'reservation_id')::uuid,
  coalesce(p_payload,current_setting('test.import_payload')),coalesce(p_archive,pg_temp.import_archive()));
$$;

select ok(not has_table_privilege('authenticated','private.import_upload_reservations','select')
 and not has_table_privilege('service_role','private.import_upload_reservations','insert')
 and not has_table_privilege('authenticated','private.import_upload_completions','insert')
 and not has_table_privilege('service_role','private.import_upload_completions','update'),'private staging has no direct API table privileges');
select ok((select bool_and(relrowsecurity and relforcerowsecurity) from pg_class
 where oid in ('private.import_upload_reservations'::regclass,'private.import_upload_completions'::regclass)),'both private staging tables force RLS');
select ok(not has_function_privilege('anon','public.reserve_import_upload(uuid,uuid,uuid,text,text,text,integer,text)','execute')
 and not has_function_privilege('service_role','public.reserve_import_upload(uuid,uuid,uuid,text,text,text,integer,text)','execute'),'only authenticated users can reserve');
select ok(not has_function_privilege('authenticated','public.complete_import_upload(uuid,text,jsonb)','execute')
 and not has_function_privilege('authenticated','private.complete_import_upload(uuid,text,jsonb)','execute')
 and not has_function_privilege('anon','public.complete_import_upload(uuid,text,jsonb)','execute'),'browser cannot attest parser/archive evidence via either wrapper');
select ok(has_function_privilege('service_role','public.complete_import_upload(uuid,text,jsonb)','execute'),'worker has narrow completion RPC grant');
select ok((select bool_and(not prosecdef) from pg_proc where oid in
 ('public.complete_import_upload(uuid,text,jsonb)'::regprocedure,'public.reserve_import_upload(uuid,uuid,uuid,text,text,text,integer,text)'::regprocedure)),'public wrappers remain security invoker');

set local role authenticated;
select pg_temp.import_login('aal1');
select throws_ok($$select pg_temp.reserve_upload()$$,'42501',null,'AAL1 cannot reserve a sensitive upload');
select pg_temp.import_login();
select is(public.is_executive_login_allowed(),true,'fixture uses the real active executive Google session');
select throws_ok($$select pg_temp.reserve_upload(1,'synthetic.html',repeat('a',64),'a0500000-0000-4000-8000-000000000001','a0600000-0000-4000-8000-000000000002')$$,'42501',null,'unassigned branch denied');
select throws_ok($$select pg_temp.reserve_upload(1,'synthetic.html',repeat('a',64),'a0500000-0000-4000-8000-000000000002','a0600000-0000-4000-8000-000000000003')$$,'42501',null,'cross organization denied');
select throws_ok($$select pg_temp.reserve_upload(1,'../synthetic.html')$$,'22023',null,'path-bearing filename rejected');
select set_config('test.import_reservation',pg_temp.reserve_upload()::text,true);
select is(current_setting('test.import_reservation')::jsonb->>'status','queued','first authorized upload creates a queued reservation');
select is((current_setting('test.import_reservation')::jsonb->>'replayed')::boolean,false,'first reservation is not replayed');
select is(pg_temp.reserve_upload()->>'reservation_id',current_setting('test.import_reservation')::jsonb->>'reservation_id','same-key retry returns original reservation');
select is(pg_temp.reserve_upload()->>'created_at',current_setting('test.import_reservation')::jsonb->>'created_at','retry does not roll seven-year archive timestamp');
select is((pg_temp.reserve_upload()->>'replayed')::boolean,true,'same-key retry marked replayed');
select throws_ok($$select pg_temp.reserve_upload(1,'renamed.html')$$,'22023',null,'same key cannot change filename');
select throws_ok($$select pg_temp.reserve_upload(1,'synthetic.html',repeat('c',64))$$,'22023',null,'same key cannot change hash');
select throws_ok($$select pg_temp.reserve_upload(2,'renamed.html')$$,'23505',null,'same bytes with a new key do not create a second reservation');
select throws_ok($$select pg_temp.complete_upload()$$,'42501',null,'authenticated user cannot submit forged parser JSON');
select throws_ok($$select * from private.import_upload_completions$$,'42501',null,'authenticated user cannot read raw trusted fields');
reset role;
select is((select count(*)::integer from private.import_upload_reservations),1,'invalid/duplicate calls left exactly one reservation');
select ok((select not authorization_claims ? 'user_metadata' and not authorization_claims ? 'app_metadata'
 from private.import_upload_reservations),'only validated minimal claims saved, no editable metadata');
select throws_ok($$update private.import_upload_reservations set file_name='edited.html'$$,'55000',null,'reservation identity immutable even through owner DML');
select throws_ok($$delete from private.import_upload_reservations$$,'55000',null,'reservation cannot be removed to bypass retries');

set local role service_role;
select pg_temp.worker_context();
select throws_ok($$select public.complete_import_upload('a8800000-0000-4000-8000-000000000001','{}','{}')$$,'42501',null,'unknown reservation reveals no metadata');
select throws_ok($$select pg_temp.complete_upload('not json')$$,'22023',null,'malformed parser JSON rejected');
select throws_ok($$select pg_temp.complete_upload((current_setting('test.import_payload')::jsonb||'{"mappingVersion":"unapproved"}'::jsonb)::text)$$,'22023',null,'mapping version must equal reserved version');
select throws_ok($$select pg_temp.complete_upload(jsonb_set(current_setting('test.import_payload')::jsonb,'{security,externalRequestCount}','1')::text)$$,'22023',null,'a parse that made network requests cannot be attested');
select throws_ok($$select pg_temp.complete_upload(null,pg_temp.import_archive()||'{"key":"other/tenant.html"}'::jsonb)$$,'22023',null,'foreign archive object key rejected');
select throws_ok($$select pg_temp.complete_upload(null,pg_temp.import_archive()||'{"versionId":"null"}'::jsonb)$$,'22023',null,'unversioned archive rejected');
select throws_ok($$select pg_temp.complete_upload(null,pg_temp.import_archive()||'{"byteLength":129}'::jsonb)$$,'22023',null,'archive byte count must match reservation');
select throws_ok($$select pg_temp.complete_upload(null,pg_temp.import_archive()||jsonb_build_object('retainUntil',now()+interval '6 years'))$$,'22023',null,'short retention rejected');
select throws_ok($$select pg_temp.complete_upload(null,pg_temp.import_archive()||'{"createdAt":"infinity"}'::jsonb)$$,'22023',null,'nonfinite archive time rejected');
select is(current_setting('request.jwt.claim.role'),'service_role','worker context restored after rejected archive evidence');
reset role;

-- Force failure after completion insert/audit. All completion writes must roll
-- back; the pre-existing durable reservation remains for reconciliation/retry.
create function pg_temp.reject_completion() returns trigger language plpgsql as $$
begin raise exception using errcode='P0001',message='synthetic transaction failure'; end;
$$;
create trigger zz_import_completion_fault after insert on private.import_upload_completions
 for each row execute function pg_temp.reject_completion();
set local role service_role;
select throws_ok($$select pg_temp.complete_upload()$$,'P0001','synthetic transaction failure','completion fault rolls back atomically');
reset role;
select is((select count(*)::integer from private.import_upload_completions),0,'failed completion changed zero trusted payload rows');
select is((select count(*)::integer from public.audit_events where table_name='private.import_upload_completions'),0,'failed completion also rolled back its audit receipt');
select is((select count(*)::integer from private.import_upload_reservations),1,'initial reservation survives failed completion');
drop trigger zz_import_completion_fault on private.import_upload_completions;

set local role service_role;
select set_config('test.import_completion',pg_temp.complete_upload()::text,true);
select is(current_setting('test.import_completion')::jsonb->>'status','completed','worker completes trusted staging');
select is((current_setting('test.import_completion')::jsonb->>'staging_only')::boolean,true,'receipt explicitly staging only');
select is((current_setting('test.import_completion')::jsonb->>'formally_imported')::boolean,false,'receipt cannot claim formal import');
select is((current_setting('test.import_completion')::jsonb->>'replayed')::boolean,false,'initial completion is not replayed');
select is(current_setting('request.jwt.claims'),'{"role":"service_role","sub":"a9900000-0000-4000-8000-000000000001"}','worker claims restored after success');
select is(current_setting('request.jwt.claim.sub'),'a9900000-0000-4000-8000-000000000002','legacy sub restored after success');
select is(current_setting('request.jwt.claim.role'),'service_role','legacy role restored after success');
select is(pg_temp.complete_upload()->>'completed_at',current_setting('test.import_completion')::jsonb->>'completed_at','complete retry returns original immutable server time');
select is((pg_temp.complete_upload()->>'replayed')::boolean,true,'complete retry reports replay');
select throws_ok($$select pg_temp.complete_upload(current_setting('test.import_payload')||' ')$$,'22023',null,'same JSON with changed serialized payload is not exact text replay');
select throws_ok($$select pg_temp.complete_upload(null,pg_temp.import_archive()||'{"versionId":"another-version"}'::jsonb)$$,'22023',null,'completion retry cannot switch archive version');
select is(current_setting('request.jwt.claims'),'{"role":"service_role","sub":"a9900000-0000-4000-8000-000000000001"}','worker claims restored after failure');
select is(current_setting('request.jwt.claim.sub'),'a9900000-0000-4000-8000-000000000002','legacy sub restored after failure');
select is(current_setting('request.jwt.claim.role'),'service_role','legacy role restored after failure');
reset role;
select is((current_setting('test.import_completion')::jsonb->>'payload_sha256'),
 encode(sha256(convert_to(current_setting('test.import_payload'),'UTF8')),'hex'),'receipt binds exact full parsed payload bytes');
select ok(not current_setting('test.import_completion')::jsonb ? 'parsed_payload'
 and position('synthetic private value' in current_setting('test.import_completion'))=0,'receipt excludes field values and source content');
select throws_ok($$update private.import_upload_completions set parsed_payload='{}'$$,'55000',null,'completed payload immutable');
select throws_ok($$delete from private.import_upload_completions$$,'55000',null,'completion receipt cannot be deleted');
select is((select count(*)::integer from private.import_upload_completions),1,'retry produces one completion');
select is((select count(*)::integer from public.clients where organization_id='a0500000-0000-4000-8000-000000000001'),0,'staging does not create clients');
select is((select count(*)::integer from public.import_batches where organization_id='a0500000-0000-4000-8000-000000000001'),0,'trusted workflow does not treat legacy browser-writable batch rows as attestation');
select ok(not exists(select 1 from public.audit_events where table_name like 'private.import_upload_%'
 and (metadata::text like '%synthetic private value%' or metadata::text like '%synthetic-import@example.invalid%')),'audit stores neither parsed values nor saved email/claims');

set local role authenticated;
select pg_temp.import_login();
select is(pg_temp.reserve_upload()->>'status','completed','lost completion response recovers through reservation retry');
select is((pg_temp.reserve_upload()->'receipt'->>'replayed')::boolean,true,'recovered embedded receipt marked replayed');
select is(pg_temp.reserve_upload()->'receipt'->>'completed_at',current_setting('test.import_completion')::jsonb->>'completed_at','reservation retry keeps original completion receipt time');
reset role;

-- Revalidate even completed receipts against current authority, not stored
-- role/JWT state. Changes below are test-owner mutations, never API grants.
update public.branches set is_active=false where id='a0600000-0000-4000-8000-000000000001';
set local role service_role;
select pg_temp.worker_context();
select throws_ok($$select pg_temp.complete_upload()$$,'42501',null,'disabled branch invalidates completion replay');
reset role;
update public.branches set is_active=true where id='a0600000-0000-4000-8000-000000000001';
update public.membership_roles set assigned_at=now()+interval '1 day' where membership_id='a0700000-0000-4000-8000-000000000001';
set local role service_role;
select throws_ok($$select pg_temp.complete_upload()$$,'42501',null,'future role assignment cannot authorize completion');
reset role;
update public.membership_roles set assigned_at=now() where membership_id='a0700000-0000-4000-8000-000000000001';
update public.profiles set is_active=false where id='a0100000-0000-4000-8000-000000000001';
set local role service_role;
select throws_ok($$select pg_temp.complete_upload()$$,'42501',null,'disabled employee cannot finish or replay upload');
reset role;
update public.profiles set is_active=true where id='a0100000-0000-4000-8000-000000000001';
update private.executive_access_policy set enabled=false;
set local role service_role;
select throws_ok($$select pg_temp.complete_upload()$$,'42501',null,'disabled executive policy invalidates saved authorization');
reset role;
update private.executive_access_policy set enabled=true;
update private.reauth_events set revoked_at=now() where user_id='a0100000-0000-4000-8000-000000000001';
set local role service_role;
select throws_ok($$select pg_temp.complete_upload()$$,'42501',null,'revoked reauth evidence invalidates completion');
reset role;
update private.reauth_events set revoked_at=null where user_id='a0100000-0000-4000-8000-000000000001';
update auth.sessions set not_after=now()-interval '1 minute' where id='a0300000-0000-4000-8000-000000000001';
set local role service_role;
select throws_ok($$select pg_temp.complete_upload()$$,'42501',null,'expired actual Auth session denied despite saved unexpired JWT');
reset role;
update auth.sessions set not_after=null where id='a0300000-0000-4000-8000-000000000001';
delete from auth.mfa_amr_claims where session_id='a0300000-0000-4000-8000-000000000001';
delete from auth.sessions where id='a0300000-0000-4000-8000-000000000001';
set local role service_role;
select throws_ok($$select pg_temp.complete_upload()$$,'42501',null,'deleted Auth session cannot complete or replay');
reset role;
select is((select count(*)::integer from private.import_upload_completions),1,'revocation failures never alter completed payload/receipt');
select is((select count(*)::integer from public.audit_events where table_name='private.import_upload_completions'),1,'one success creates exactly one completion audit');
select is((select actor_user_id::text from public.audit_events where table_name='private.import_upload_completions'),
 'a0100000-0000-4000-8000-000000000001','saved authorized actor, not forged worker legacy sub, owns completion audit');

select * from finish();
rollback;
