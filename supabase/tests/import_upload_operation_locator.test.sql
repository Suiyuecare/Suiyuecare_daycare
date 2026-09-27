begin;
select plan(58);
set local time zone 'UTC';
select set_config('test.ol_oauth',floor(extract(epoch from clock_timestamp()-interval '3 minutes'))::text,true);
select set_config('test.ol_totp',floor(extract(epoch from clock_timestamp()-interval '30 seconds'))::text,true);

-- Local synthetic Auth data exercises the genuine executive/session/factor
-- predicates. No production admission function or policy is replaced.
insert into auth.users(id,aud,role,email,email_confirmed_at,created_at,updated_at)
 select ('f5100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated',
  'recovery'||n||'@care.example.invalid',now()-interval '1 day',now()-interval '1 day',now() from generate_series(1,2)n;
insert into auth.identities(id,provider_id,user_id,identity_data,provider)
 select ('f5110000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'synthetic-recovery-'||n,
  ('f5100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  jsonb_build_object('sub','synthetic-recovery-'||n,'email','recovery'||n||'@care.example.invalid','email_verified',true),'google' from generate_series(1,2)n;
insert into auth.sessions(id,user_id,created_at,aal)
 select ('f5120000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('f5100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  now()-interval '4 minutes','aal2' from generate_series(1,2)n;
insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method)
 select ('f5130000-0000-4000-8000-'||lpad((n*2)::text,12,'0'))::uuid,('f5120000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  to_timestamp(current_setting('test.ol_oauth')::bigint),to_timestamp(current_setting('test.ol_oauth')::bigint),'oauth' from generate_series(1,2)n
 union all select ('f5130000-0000-4000-8000-'||lpad((n*2+1)::text,12,'0'))::uuid,('f5120000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  to_timestamp(current_setting('test.ol_totp')::bigint),to_timestamp(current_setting('test.ol_totp')::bigint),'totp' from generate_series(1,2)n;
insert into public.organizations(id,code,name) values
 ('f5200000-0000-4000-8000-000000000001','recovery_import_test','Synthetic recovery import'),
 ('f5200000-0000-4000-8000-000000000002','recovery_import_foreign','Synthetic foreign import');
insert into public.branches(id,organization_id,code,name) values
 ('f5300000-0000-4000-8000-000000000001','f5200000-0000-4000-8000-000000000001','main','Synthetic import main'),
 ('f5300000-0000-4000-8000-000000000002','f5200000-0000-4000-8000-000000000001','other','Synthetic import other'),
 ('f5300000-0000-4000-8000-000000000003','f5200000-0000-4000-8000-000000000002','foreign','Synthetic import foreign');
insert into public.profiles(id,display_name,kind)
 select ('f5100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Synthetic import actor '||n,'staff' from generate_series(1,2)n;
insert into public.memberships(id,organization_id,branch_id,profile_id,status,starts_at)
 select ('f5400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'f5200000-0000-4000-8000-000000000001','f5300000-0000-4000-8000-000000000001',
  ('f5100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'active',now()-interval '1 day' from generate_series(1,2)n;
insert into public.membership_roles(membership_id,role_id)
 select ('f5400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'10000000-0000-4000-8000-000000000002' from generate_series(1,2)n;
insert into private.executive_access_policy(allowed_user_id,allowed_email,google_subject,enabled,approval_reference)
 values('f5100000-0000-4000-8000-000000000001','recovery1@care.example.invalid','synthetic-recovery-1',true,'Synthetic recovery repository approval');
insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,issued_jwt_jti,created_at,expires_at,
 consumed_at,consumed_jwt_iat,consumed_jwt_jti,factor_method,factor_verified_at)
 select ('f5500000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('f5100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  ('f5120000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,repeat(n::text,64),('f5510000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  now()-interval '3 minutes','before-recovery-'||n,now()-interval '2 minutes',now()+interval '5 minutes',
  to_timestamp(current_setting('test.ol_totp')::bigint),to_timestamp(current_setting('test.ol_totp')::bigint),'after-recovery-'||n,'totp',to_timestamp(current_setting('test.ol_totp')::bigint)
 from generate_series(1,2)n;
insert into private.reauth_events(user_id,session_id,challenge_id,aal,verification_method,verified_at)
 select ('f5100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('f5120000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  ('f5500000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'aal2','totp',to_timestamp(current_setting('test.ol_totp')::bigint) from generate_series(1,2)n;
-- A second real session for the SAME actor is deliberately not a rebind of the
-- old immutable reservation. Recovery must name and retain both identities.
insert into auth.sessions(id,user_id,created_at,aal) values
 ('f5120000-0000-4000-8000-000000000003','f5100000-0000-4000-8000-000000000001',now()-interval '4 minutes','aal2'),
 ('f5120000-0000-4000-8000-000000000004','f5100000-0000-4000-8000-000000000001',now()-interval '4 minutes','aal2');
insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method)
 select ('f5130000-0000-4000-8000-'||lpad((n+10)::text,12,'0'))::uuid,
  ('f5120000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  to_timestamp(current_setting('test.ol_oauth')::bigint),to_timestamp(current_setting('test.ol_oauth')::bigint),'oauth'
 from generate_series(3,4)n
 union all select 'f5130000-0000-4000-8000-000000000023'::uuid,'f5120000-0000-4000-8000-000000000003'::uuid,
  to_timestamp(current_setting('test.ol_totp')::bigint),to_timestamp(current_setting('test.ol_totp')::bigint),'totp';
insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,issued_jwt_jti,created_at,expires_at,
 consumed_at,consumed_jwt_iat,consumed_jwt_jti,factor_method,factor_verified_at)
 values('f5500000-0000-4000-8000-000000000003','f5100000-0000-4000-8000-000000000001',
 'f5120000-0000-4000-8000-000000000003',repeat('3',64),'f5510000-0000-4000-8000-000000000003',
 now()-interval '3 minutes','before-new-recovery',now()-interval '2 minutes',now()+interval '5 minutes',
 to_timestamp(current_setting('test.ol_totp')::bigint),to_timestamp(current_setting('test.ol_totp')::bigint),'after-new-recovery','totp',
 to_timestamp(current_setting('test.ol_totp')::bigint));
insert into private.reauth_events(user_id,session_id,challenge_id,aal,verification_method,verified_at)
 values('f5100000-0000-4000-8000-000000000001','f5120000-0000-4000-8000-000000000003',
 'f5500000-0000-4000-8000-000000000003','aal2','totp',to_timestamp(current_setting('test.ol_totp')::bigint));
create temporary table locator_data(k text primary key,v jsonb);
grant select,insert,update on locator_data to authenticated,service_role;
create function pg_temp.ol_login(n integer default 1,p_aal text default 'aal2',p_session integer default null) returns boolean language plpgsql security invoker as $$
begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub','f5100000-0000-4000-8000-'||lpad(n::text,12,'0'),
  'session_id','f5120000-0000-4000-8000-'||lpad(coalesce(p_session,n)::text,12,'0'),'aud','authenticated','role','authenticated','aal',p_aal,
  'email','recovery'||n||'@care.example.invalid','is_anonymous',false,'iat',floor(extract(epoch from clock_timestamp())),
  'exp',floor(extract(epoch from clock_timestamp()+interval '30 minutes')),
  'amr',case when coalesce(p_session,n)=4 then jsonb_build_array(jsonb_build_object('method','oauth','timestamp',current_setting('test.ol_oauth')::bigint))
   else jsonb_build_array(jsonb_build_object('method','oauth','timestamp',current_setting('test.ol_oauth')::bigint),
   jsonb_build_object('method','totp','timestamp',current_setting('test.ol_totp')::bigint))end)::text,true);
 return public.is_executive_login_allowed();
end $$;
create function pg_temp.ol_parsed() returns jsonb language sql immutable as $$
 select '{"mappingVersion":"central-care-plan-html@1","sections":[{"id":"section_00000000000000000000","index":0,"code":"SYNTHETIC","title":"Synthetic source","sourceHeadingId":null,"recognized":false}],"fields":[{"id":"field_000000000000000000000000","mappingKey":"SYNTHETIC/name","mappingVersion":"central-care-plan-html@1","mappingState":"unknown","targetPath":null,"source":{"sectionCode":"SYNTHETIC","sectionTitle":"Synthetic source","label":"name","parentPath":"SYNTHETIC/basic","controlName":null},"rawValue":"SYNTHETIC_LOCATOR_SECRET","normalizedValue":"SYNTHETIC_LOCATOR_SECRET","sensitive":true,"warnings":[]}],"warnings":[],"conflicts":[],"contentFingerprint":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","security":{"parser":"cheerio-static","scriptElementsBlocked":0,"formElementsNeutralized":0,"redirectElementsBlocked":0,"activeElementsBlocked":0,"inlineEventHandlersBlocked":0,"externalReferencesBlocked":0,"externalRequestCount":0}}'::jsonb;
$$;
create function pg_temp.ol_archive(r jsonb) returns jsonb language sql immutable as $$
 select jsonb_build_object('key','organizations/'||(r->>'organization_id')||'/branches/'||(r->>'branch_id')||'/central-html/'||(r->>'file_sha256')||'/'||(r->>'reservation_id')||'.html',
 'versionId','synthetic-recovery-worm-v1','sha256',r->>'file_sha256','createdAt',r->>'created_at',
 'byteLength',(r->>'file_size_bytes')::integer,'retainUntil',(r->>'created_at')::timestamptz+interval '7 years');
$$;
create function pg_temp.ol_original(p_key uuid,p_sha text,p_mode text default 'routine-intake') returns jsonb language plpgsql security invoker as $$
begin
 if p_mode='routine-intake' then return public.reserve_intake_import_upload('f5200000-0000-4000-8000-000000000001','f5300000-0000-4000-8000-000000000001',p_key,p_sha,'synthetic.html','text/html',128,'central-care-plan-html@1');end if;
 return public.reserve_import_upload('f5200000-0000-4000-8000-000000000001','f5300000-0000-4000-8000-000000000001',p_key,p_sha,'synthetic.html','text/html',128,'central-care-plan-html@1');
end $$;
create function pg_temp.ol_error(statement text) returns text language plpgsql security invoker as $$
begin execute statement;return 'SUCCESS';exception when others then return sqlstate;end $$;

create function pg_temp.ol_read(p_key uuid,p_mode text default 'routine-intake') returns jsonb language sql security invoker as $$
 select public.import_upload_operation_receipt('f5200000-0000-4000-8000-000000000001','f5300000-0000-4000-8000-000000000001',p_key,p_mode);
$$;
-- A separate real staff grant, not an exception to any executive predicate.
insert into private.staff_google_access_grants(allowed_user_id,organization_id,company_email_domain,allowed_email,google_subject,enabled,approval_reference)
 values('f5100000-0000-4000-8000-000000000002','f5200000-0000-4000-8000-000000000001','care.example.invalid','recovery2@care.example.invalid','synthetic-recovery-2',true,'Synthetic locator other approved actor');
-- NATIVE_FIXTURE_END

insert into locator_data values('business',jsonb_build_object('clients',(select count(*)from public.clients),'plans',(select count(*)from public.authorized_care_plans),'careRecords',(select count(*)from public.care_records),'medications',(select count(*)from public.medication_administrations)));
select ok(to_regprocedure('public.import_upload_operation_receipt(uuid,uuid,uuid,text)')is not null,'exact original locator RPC exists');
select ok(has_function_privilege('authenticated','public.import_upload_operation_receipt(uuid,uuid,uuid,text)','EXECUTE'),'authenticated can call checked locator entry');
select ok(not has_function_privilege('anon','public.import_upload_operation_receipt(uuid,uuid,uuid,text)','EXECUTE')and not has_function_privilege('service_role','public.import_upload_operation_receipt(uuid,uuid,uuid,text)','EXECUTE'),'anonymous and worker cannot use actor-owned locator');
select ok(has_function_privilege('authenticated','private.import_upload_operation_receipt(uuid,uuid,uuid,text)','EXECUTE')and not has_function_privilege('anon','private.import_upload_operation_receipt(uuid,uuid,uuid,text)','EXECUTE')and not has_function_privilege('service_role','private.import_upload_operation_receipt(uuid,uuid,uuid,text)','EXECUTE'),'only authenticated may execute the checked private locator entry');
select ok((select not prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid='public.import_upload_operation_receipt(uuid,uuid,uuid,text)'::regprocedure),'public locator wrapper is SECURITY INVOKER with empty search_path');
select ok(not has_function_privilege('authenticated','private.import_upload_operation_projection(private.import_upload_reservations,private.import_upload_completions,text)','EXECUTE')and not has_function_privilege('anon','private.import_upload_operation_projection(private.import_upload_reservations,private.import_upload_completions,text)','EXECUTE')and not has_function_privilege('service_role','private.import_upload_operation_projection(private.import_upload_reservations,private.import_upload_completions,text)','EXECUTE'),'internal projector remains denied to all client roles');
select is((select count(*)::integer from pg_class where oid in('private.import_upload_reservations'::regclass,'private.import_upload_completions'::regclass)and relrowsecurity and relforcerowsecurity),2,'old immutable staging ledgers retain FORCE RLS');
select ok(not has_table_privilege('authenticated','private.import_upload_reservations','SELECT')and not has_table_privilege('service_role','private.import_upload_completions','INSERT'),'locator grants no table or completion write access');
select set_config('request.jwt.claims','{}',true);
set local role authenticated;
select is(pg_temp.ol_error('select private.import_upload_operation_receipt(''f5200000-0000-4000-8000-000000000001'',''f5300000-0000-4000-8000-000000000001'',''f5600000-0000-4000-8000-000000000001'',''routine-intake'')'),'42501','direct checked entry still requires actual authorized JWT');
select is(pg_temp.ol_error('select private.import_upload_operation_projection(null::private.import_upload_reservations,null::private.import_upload_completions,''routine-intake'')'),'42501','authenticated cannot bypass the checked entry through direct projector execution');
reset role;
select ok(pg_temp.ol_login(1,'aal1',1),'actual approved Google original session admitted');
set local role authenticated;
insert into locator_data values('routine',pg_temp.ol_original('f5600000-0000-4000-8000-000000000001',repeat('a',64)));
insert into locator_data values('queued-proof',pg_temp.ol_read('f5600000-0000-4000-8000-000000000001'));
select is(private.import_upload_operation_receipt('f5200000-0000-4000-8000-000000000001','f5300000-0000-4000-8000-000000000001','f5600000-0000-4000-8000-000000000001','routine-intake'),(select v from locator_data where k='queued-proof'),'direct checked entry produces the same exact own-source observation');
select is((select v->>'status'from locator_data where k='queued-proof'),'queued','queued source is observed without completion');
select is((select v->'receipt'from locator_data where k='queued-proof'),'null'::jsonb,'queued has no invented receipt');
select is((select v->>'original_operation_id'from locator_data where k='queued-proof'),'f5600000-0000-4000-8000-000000000001','proof binds exact original key');
select is((select v->>'actor_user_id'from locator_data where k='queued-proof'),'f5100000-0000-4000-8000-000000000001','proof binds current actor and source owner');
select is((select(v->>'expires_at')::timestamptz-(v->>'created_at')::timestamptz from locator_data where k='queued-proof'),interval '15 minutes','original expiry is only its observational creation bound');
select is((select v->>'staging_only'from locator_data where k='queued-proof'),'true','locator does not promote client data');
select is((select v->>'formally_imported'from locator_data where k='queued-proof'),'false','locator cannot claim formal import');
select is(pg_temp.ol_read('f5600000-0000-4000-8000-000000000099'),null::jsonb,'unknown exact key returns observational null');
select is(pg_temp.ol_error('select pg_temp.ol_read(null)'),'22023','null original key cannot become an all-source lookup');
select is(pg_temp.ol_error('select pg_temp.ol_read(''f5600000-0000-4000-8000-000000000001'',''all'')'),'22023','unknown mode is rejected');
reset role;
select ok(pg_temp.ol_login(1,'aal2',1),'actual general source factor admitted');
set local role authenticated;
insert into locator_data values('general',pg_temp.ol_original('f5600000-0000-4000-8000-000000000002',repeat('b',64),'general'));
select is(pg_temp.ol_read('f5600000-0000-4000-8000-000000000001','general'),null::jsonb,'wrong mode cannot reveal routine original source');
select is(pg_temp.ol_read('f5600000-0000-4000-8000-000000000002','routine-intake'),null::jsonb,'wrong mode cannot reveal general original source');
select is(pg_temp.ol_error('select public.import_upload_operation_receipt(''f5200000-0000-4000-8000-000000000001'',''f5300000-0000-4000-8000-000000000002'',''f5600000-0000-4000-8000-000000000001'',''routine-intake'')'),'42501','unassigned branch is denied before source disclosure');
select is(pg_temp.ol_error('select private.import_upload_operation_receipt(''f5200000-0000-4000-8000-000000000001'',''f5300000-0000-4000-8000-000000000002'',''f5600000-0000-4000-8000-000000000001'',''routine-intake'')'),'42501','direct checked entry cannot bypass branch authority');
select is(pg_temp.ol_error('select public.import_upload_operation_receipt(''f5200000-0000-4000-8000-000000000002'',''f5300000-0000-4000-8000-000000000003'',''f5600000-0000-4000-8000-000000000001'',''routine-intake'')'),'42501','foreign organization denied before source disclosure');
set local role service_role;
insert into locator_data select 'completed-original',public.complete_import_upload((v->>'reservation_id')::uuid,pg_temp.ol_parsed()::text,pg_temp.ol_archive(v))from locator_data where k='routine';
reset role;
insert into locator_data select 'original-row',to_jsonb(r)from private.import_upload_reservations r where id=(select(v->>'reservation_id')::uuid from locator_data where k='routine');
update auth.sessions set not_after=clock_timestamp()-interval '1 second'where id='f5120000-0000-4000-8000-000000000001';
update private.reauth_events set revoked_at=clock_timestamp()where session_id='f5120000-0000-4000-8000-000000000001';
set local role authenticated;
select is(pg_temp.ol_error('select private.import_upload_operation_receipt(''f5200000-0000-4000-8000-000000000001'',''f5300000-0000-4000-8000-000000000001'',''f5600000-0000-4000-8000-000000000001'',''routine-intake'')'),'42501','direct checked entry denies expired actual current session');
reset role;
select ok(pg_temp.ol_login(1,'aal1',3),'new real same-actor Google session admitted');
set local role authenticated;
insert into locator_data values('completed-proof',pg_temp.ol_read('f5600000-0000-4000-8000-000000000001'));
select is((select v->>'status'from locator_data where k='completed-proof'),'completed','new session can observe already saved original completion');
select is((select v->'receipt'from locator_data where k='completed-proof'),(select v||'{"replayed":false}'::jsonb from locator_data where k='completed-original'),'read returns immutable original receipt without fake replay or new completion');
select is((select v->>'created_at'from locator_data where k='completed-proof'),(select v->>'created_at'from locator_data where k='routine'),'original creation timestamp preserved');
select ok((select v::text!~'SYNTHETIC_LOCATOR_SECRET|authorization_claims|archive_reference|parsed_payload|nonce_sha256|access_token|refresh_token'from locator_data where k='completed-proof'),'bounded proof excludes source content, auth claims and archive locator');
select is(pg_temp.ol_error('select pg_temp.ol_read(''f5600000-0000-4000-8000-000000000002'',''general'')'),'42501','general read remains AAL2, not a new AAL1 exception');
reset role;
select pg_temp.ol_login(2,'aal1',2);
select ok(public.is_staff_login_allowed(),'other source reader has its own actual approved Google membership');
set local role authenticated;
select is(pg_temp.ol_read('f5600000-0000-4000-8000-000000000001'),null::jsonb,'authorized different actor gets no foreign original source');
select is(private.import_upload_operation_receipt('f5200000-0000-4000-8000-000000000001','f5300000-0000-4000-8000-000000000001','f5600000-0000-4000-8000-000000000001','routine-intake'),null::jsonb,'direct checked entry also isolates authorized different actor from foreign source');
insert into locator_data values('other-own',pg_temp.ol_original('f5600000-0000-4000-8000-000000000003',repeat('c',64)));
select is(pg_temp.ol_read('f5600000-0000-4000-8000-000000000003')->>'actor_user_id','f5100000-0000-4000-8000-000000000002','other reader can observe only own original operation');
reset role;
select ok(pg_temp.ol_login(1,'aal2',3),'new actual general read session admitted');
-- AAL2 readonly lookup intentionally does not need a recent signing challenge.
update private.reauth_events set revoked_at=clock_timestamp()where session_id='f5120000-0000-4000-8000-000000000003';
set local role authenticated;
select is(pg_temp.ol_read('f5600000-0000-4000-8000-000000000002','general')->>'status','queued','original auth/challenge expiry does not prevent actual current AAL2 readonly observation');
reset role;
select is((select to_jsonb(r)from private.import_upload_reservations r where id=(select(v->>'reservation_id')::uuid from locator_data where k='routine')),(select v from locator_data where k='original-row'),'all reads leave original session/challenge/key/body/time unchanged');

-- Privileged synthetic corruption is isolated in a savepoint. No auth guard is
-- replaced; the immutable trigger is restored before calling the real reader.
savepoint locator_corruption;
alter table private.import_upload_reservations disable trigger import_upload_reservation_immutable;
update private.import_upload_reservations set file_size_bytes=4194305 where id=(select(v->>'reservation_id')::uuid from locator_data where k='routine');
alter table private.import_upload_reservations enable trigger import_upload_reservation_immutable;
set local role authenticated;
select is(pg_temp.ol_error('select pg_temp.ol_read(''f5600000-0000-4000-8000-000000000001'')'),'23514','routine over-4MB source metadata denied');
reset role;
rollback to savepoint locator_corruption;
release savepoint locator_corruption;

-- Privileged synthetic corruption is isolated in a savepoint. No auth guard is
-- replaced; the immutable trigger is restored before calling the real reader.
savepoint locator_corruption;
alter table private.import_upload_reservations disable trigger import_upload_reservation_immutable;
update private.import_upload_reservations set authorization_claims=jsonb_set(authorization_claims,'{sub}','"f5100000-0000-4000-8000-000000000002"') where id=(select(v->>'reservation_id')::uuid from locator_data where k='routine');
alter table private.import_upload_reservations enable trigger import_upload_reservation_immutable;
set local role authenticated;
select is(pg_temp.ol_error('select pg_temp.ol_read(''f5600000-0000-4000-8000-000000000001'')'),'23514','source claim actor binding must match immutable owner');
reset role;
rollback to savepoint locator_corruption;
release savepoint locator_corruption;

-- Privileged synthetic corruption is isolated in a savepoint. No auth guard is
-- replaced; the immutable trigger is restored before calling the real reader.
savepoint locator_corruption;
alter table private.import_upload_completions disable trigger import_upload_completion_immutable;
update private.import_upload_completions set receipt=jsonb_set(receipt,'{payload_sha256}',to_jsonb(repeat('d',64))) where id=(select(v->>'reservation_id')::uuid from locator_data where k='routine');
alter table private.import_upload_completions enable trigger import_upload_completion_immutable;
set local role authenticated;
select is(pg_temp.ol_error('select pg_temp.ol_read(''f5600000-0000-4000-8000-000000000001'')'),'23514','receipt stored hash mismatch denied');
reset role;
rollback to savepoint locator_corruption;
release savepoint locator_corruption;

-- Privileged synthetic corruption is isolated in a savepoint. No auth guard is
-- replaced; the immutable trigger is restored before calling the real reader.
savepoint locator_corruption;
alter table private.import_upload_completions disable trigger import_upload_completion_immutable;
update private.import_upload_completions set receipt=jsonb_set(receipt,'{formally_imported}','true') where id=(select(v->>'reservation_id')::uuid from locator_data where k='routine');
alter table private.import_upload_completions enable trigger import_upload_completion_immutable;
set local role authenticated;
select is(pg_temp.ol_error('select pg_temp.ol_read(''f5600000-0000-4000-8000-000000000001'')'),'23514','forged formal-promotion receipt denied');
reset role;
rollback to savepoint locator_corruption;
release savepoint locator_corruption;

-- Privileged synthetic corruption is isolated in a savepoint. No auth guard is
-- replaced; the immutable trigger is restored before calling the real reader.
savepoint locator_corruption;
alter table private.import_upload_completions disable trigger import_upload_completion_immutable;
update private.import_upload_completions set receipt=jsonb_set(receipt,'{field_count}','999') where id=(select(v->>'reservation_id')::uuid from locator_data where k='routine');
alter table private.import_upload_completions enable trigger import_upload_completion_immutable;
set local role authenticated;
select is(pg_temp.ol_error('select pg_temp.ol_read(''f5600000-0000-4000-8000-000000000001'')'),'23514','receipt field count must match original parsed source');
reset role;
rollback to savepoint locator_corruption;
release savepoint locator_corruption;

-- Privileged synthetic corruption is isolated in a savepoint. No auth guard is
-- replaced; the immutable trigger is restored before calling the real reader.
savepoint locator_corruption;
alter table private.import_upload_completions disable trigger import_upload_completion_immutable;
update private.import_upload_completions set receipt=jsonb_set(receipt,'{reservation_id}','"f5600000-0000-4000-8000-000000000099"') where id=(select(v->>'reservation_id')::uuid from locator_data where k='routine');
alter table private.import_upload_completions enable trigger import_upload_completion_immutable;
set local role authenticated;
select is(pg_temp.ol_error('select pg_temp.ol_read(''f5600000-0000-4000-8000-000000000001'')'),'23514','receipt cannot bind another original reservation');
reset role;
rollback to savepoint locator_corruption;
release savepoint locator_corruption;

-- Privileged synthetic corruption is isolated in a savepoint. No auth guard is
-- replaced; the immutable trigger is restored before calling the real reader.
savepoint locator_corruption;
alter table private.import_upload_completions disable trigger import_upload_completion_immutable;
update private.import_upload_completions set parsed_payload=jsonb_set(parsed_payload,'{security,externalRequestCount}','1') where id=(select(v->>'reservation_id')::uuid from locator_data where k='routine');
alter table private.import_upload_completions enable trigger import_upload_completion_immutable;
set local role authenticated;
select is(pg_temp.ol_error('select pg_temp.ol_read(''f5600000-0000-4000-8000-000000000001'')'),'23514','unsafe parsed source cannot be disclosed as trusted completion');
reset role;
rollback to savepoint locator_corruption;
release savepoint locator_corruption;

-- Privileged synthetic corruption is isolated in a savepoint. No auth guard is
-- replaced; the immutable trigger is restored before calling the real reader.
savepoint locator_corruption;
alter table private.import_upload_completions disable trigger import_upload_completion_immutable;
update private.import_upload_completions set archive_reference=jsonb_set(archive_reference,'{key}','"foreign/path.html"') where id=(select(v->>'reservation_id')::uuid from locator_data where k='routine');
alter table private.import_upload_completions enable trigger import_upload_completion_immutable;
set local role authenticated;
select is(pg_temp.ol_error('select pg_temp.ol_read(''f5600000-0000-4000-8000-000000000001'')'),'23514','foreign immutable archive pointer denied');
reset role;
rollback to savepoint locator_corruption;
release savepoint locator_corruption;

-- Privileged synthetic corruption is isolated in a savepoint. No auth guard is
-- replaced; the immutable trigger is restored before calling the real reader.
savepoint locator_corruption;
alter table private.import_upload_completions disable trigger import_upload_completion_immutable;
update private.import_upload_completions set archive_reference=jsonb_set(archive_reference,'{sha256}',to_jsonb(repeat('e',64))) where id=(select(v->>'reservation_id')::uuid from locator_data where k='routine');
alter table private.import_upload_completions enable trigger import_upload_completion_immutable;
set local role authenticated;
select is(pg_temp.ol_error('select pg_temp.ol_read(''f5600000-0000-4000-8000-000000000001'')'),'23514','archive source hash mismatch denied');
reset role;
rollback to savepoint locator_corruption;
release savepoint locator_corruption;

-- Privileged synthetic corruption is isolated in a savepoint. No auth guard is
-- replaced; the immutable trigger is restored before calling the real reader.
savepoint locator_corruption;
alter table private.import_upload_completions disable trigger import_upload_completion_immutable;
update private.import_upload_completions set archive_reference=jsonb_set(archive_reference,'{byteLength}','129') where id=(select(v->>'reservation_id')::uuid from locator_data where k='routine');
alter table private.import_upload_completions enable trigger import_upload_completion_immutable;
set local role authenticated;
select is(pg_temp.ol_error('select pg_temp.ol_read(''f5600000-0000-4000-8000-000000000001'')'),'23514','archive byte count mismatch denied');
reset role;
rollback to savepoint locator_corruption;
release savepoint locator_corruption;

-- Privileged synthetic corruption is isolated in a savepoint. No auth guard is
-- replaced; the immutable trigger is restored before calling the real reader.
savepoint locator_corruption;
alter table private.import_upload_completions disable trigger import_upload_completion_immutable;
update private.import_upload_completions set archive_reference=jsonb_set(archive_reference,'{retainUntil}',to_jsonb((archive_reference->>'createdAt')::timestamptz+interval '6 years')) where id=(select(v->>'reservation_id')::uuid from locator_data where k='routine');
alter table private.import_upload_completions enable trigger import_upload_completion_immutable;
set local role authenticated;
select is(pg_temp.ol_error('select pg_temp.ol_read(''f5600000-0000-4000-8000-000000000001'')'),'23514','archive retention shorter than seven years denied');
reset role;
rollback to savepoint locator_corruption;
release savepoint locator_corruption;

-- Privileged synthetic corruption is isolated in a savepoint. No auth guard is
-- replaced; the immutable trigger is restored before calling the real reader.
savepoint locator_corruption;
alter table private.import_upload_completions disable trigger import_upload_completion_immutable;
update private.import_upload_completions set archive_reference=jsonb_set(archive_reference,'{versionId}','"null"') where id=(select(v->>'reservation_id')::uuid from locator_data where k='routine');
alter table private.import_upload_completions enable trigger import_upload_completion_immutable;
set local role authenticated;
select is(pg_temp.ol_error('select pg_temp.ol_read(''f5600000-0000-4000-8000-000000000001'')'),'23514','missing immutable archive version denied');
reset role;
rollback to savepoint locator_corruption;
release savepoint locator_corruption;

select is((select count(*)::integer from private.import_upload_recoveries),0,'original locator never manufactures a recovery authorization');
select is((select count(*)::integer from private.import_upload_recovery_completions),0,'original locator never fabricates recovery completion');
select ok(exists(select 1 from public.audit_events where actor_user_id='f5100000-0000-4000-8000-000000000001'and action='select'and metadata->>'projection'='import_upload_operation_receipt_v1'),'actual authorized original lookup is audited');
select is(jsonb_build_object('clients',(select count(*)from public.clients),'plans',(select count(*)from public.authorized_care_plans),'careRecords',(select count(*)from public.care_records),'medications',(select count(*)from public.medication_administrations)),(select v from locator_data where k='business'),'read only locator performs zero formal business writes');
select * from finish();
rollback;
