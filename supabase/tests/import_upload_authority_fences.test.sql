begin;
select plan(30);
set local time zone 'UTC';
select set_config('test.af_oauth',floor(extract(epoch from clock_timestamp()-interval '3 minutes'))::text,true);
select set_config('test.af_totp',floor(extract(epoch from clock_timestamp()-interval '30 seconds'))::text,true);

-- Local synthetic Auth data exercises the genuine executive/session/factor
-- predicates. No production admission function or policy is replaced.
insert into auth.users(id,aud,role,email,email_confirmed_at,created_at,updated_at)
 select ('f3100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated',
  'recovery'||n||'@care.example.invalid',now()-interval '1 day',now()-interval '1 day',now() from generate_series(1,2)n;
insert into auth.identities(id,provider_id,user_id,identity_data,provider)
 select ('f3110000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'synthetic-recovery-'||n,
  ('f3100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  jsonb_build_object('sub','synthetic-recovery-'||n,'email','recovery'||n||'@care.example.invalid','email_verified',true),'google' from generate_series(1,2)n;
insert into auth.sessions(id,user_id,created_at,aal)
 select ('f3120000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('f3100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  now()-interval '4 minutes','aal2' from generate_series(1,2)n;
insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method)
 select ('f3130000-0000-4000-8000-'||lpad((n*2)::text,12,'0'))::uuid,('f3120000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  to_timestamp(current_setting('test.af_oauth')::bigint),to_timestamp(current_setting('test.af_oauth')::bigint),'oauth' from generate_series(1,2)n
 union all select ('f3130000-0000-4000-8000-'||lpad((n*2+1)::text,12,'0'))::uuid,('f3120000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  to_timestamp(current_setting('test.af_totp')::bigint),to_timestamp(current_setting('test.af_totp')::bigint),'totp' from generate_series(1,2)n;
insert into public.organizations(id,code,name) values
 ('f3200000-0000-4000-8000-000000000001','recovery_import_test','Synthetic recovery import'),
 ('f3200000-0000-4000-8000-000000000002','recovery_import_foreign','Synthetic foreign import');
insert into public.branches(id,organization_id,code,name) values
 ('f3300000-0000-4000-8000-000000000001','f3200000-0000-4000-8000-000000000001','main','Synthetic import main'),
 ('f3300000-0000-4000-8000-000000000002','f3200000-0000-4000-8000-000000000001','other','Synthetic import other'),
 ('f3300000-0000-4000-8000-000000000003','f3200000-0000-4000-8000-000000000002','foreign','Synthetic import foreign');
insert into public.profiles(id,display_name,kind)
 select ('f3100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Synthetic import actor '||n,'staff' from generate_series(1,2)n;
insert into public.memberships(id,organization_id,branch_id,profile_id,status,starts_at)
 select ('f3400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'f3200000-0000-4000-8000-000000000001','f3300000-0000-4000-8000-000000000001',
  ('f3100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'active',now()-interval '1 day' from generate_series(1,2)n;
insert into public.membership_roles(membership_id,role_id)
 select ('f3400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'10000000-0000-4000-8000-000000000002' from generate_series(1,2)n;
insert into private.executive_access_policy(allowed_user_id,allowed_email,google_subject,enabled,approval_reference)
 values('f3100000-0000-4000-8000-000000000001','recovery1@care.example.invalid','synthetic-recovery-1',true,'Synthetic recovery repository approval');
insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,issued_jwt_jti,created_at,expires_at,
 consumed_at,consumed_jwt_iat,consumed_jwt_jti,factor_method,factor_verified_at)
 select ('f3500000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('f3100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  ('f3120000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,repeat(n::text,64),('f3510000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  now()-interval '3 minutes','before-recovery-'||n,now()-interval '2 minutes',now()+interval '5 minutes',
  to_timestamp(current_setting('test.af_totp')::bigint),to_timestamp(current_setting('test.af_totp')::bigint),'after-recovery-'||n,'totp',to_timestamp(current_setting('test.af_totp')::bigint)
 from generate_series(1,2)n;
insert into private.reauth_events(user_id,session_id,challenge_id,aal,verification_method,verified_at)
 select ('f3100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('f3120000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  ('f3500000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'aal2','totp',to_timestamp(current_setting('test.af_totp')::bigint) from generate_series(1,2)n;
-- A second real session for the SAME actor is deliberately not a rebind of the
-- old immutable reservation. Recovery must name and retain both identities.
insert into auth.sessions(id,user_id,created_at,aal) values
 ('f3120000-0000-4000-8000-000000000003','f3100000-0000-4000-8000-000000000001',now()-interval '4 minutes','aal2'),
 ('f3120000-0000-4000-8000-000000000004','f3100000-0000-4000-8000-000000000001',now()-interval '4 minutes','aal2');
insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method)
 select ('f3130000-0000-4000-8000-'||lpad((n+10)::text,12,'0'))::uuid,
  ('f3120000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  to_timestamp(current_setting('test.af_oauth')::bigint),to_timestamp(current_setting('test.af_oauth')::bigint),'oauth'
 from generate_series(3,4)n
 union all select 'f3130000-0000-4000-8000-000000000023'::uuid,'f3120000-0000-4000-8000-000000000003'::uuid,
  to_timestamp(current_setting('test.af_totp')::bigint),to_timestamp(current_setting('test.af_totp')::bigint),'totp';
insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,issued_jwt_jti,created_at,expires_at,
 consumed_at,consumed_jwt_iat,consumed_jwt_jti,factor_method,factor_verified_at)
 values('f3500000-0000-4000-8000-000000000003','f3100000-0000-4000-8000-000000000001',
 'f3120000-0000-4000-8000-000000000003',repeat('3',64),'f3510000-0000-4000-8000-000000000003',
 now()-interval '3 minutes','before-new-recovery',now()-interval '2 minutes',now()+interval '5 minutes',
 to_timestamp(current_setting('test.af_totp')::bigint),to_timestamp(current_setting('test.af_totp')::bigint),'after-new-recovery','totp',
 to_timestamp(current_setting('test.af_totp')::bigint));
insert into private.reauth_events(user_id,session_id,challenge_id,aal,verification_method,verified_at)
 values('f3100000-0000-4000-8000-000000000001','f3120000-0000-4000-8000-000000000003',
 'f3500000-0000-4000-8000-000000000003','aal2','totp',to_timestamp(current_setting('test.af_totp')::bigint));
create temporary table fence_data(k text primary key,v jsonb);
grant select,insert,update on fence_data to authenticated,service_role;
create function pg_temp.af_login(n integer default 1,p_aal text default 'aal2',p_session integer default null) returns boolean language plpgsql security invoker as $$
begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub','f3100000-0000-4000-8000-'||lpad(n::text,12,'0'),
  'session_id','f3120000-0000-4000-8000-'||lpad(coalesce(p_session,n)::text,12,'0'),'aud','authenticated','role','authenticated','aal',p_aal,
  'email','recovery'||n||'@care.example.invalid','is_anonymous',false,'iat',floor(extract(epoch from clock_timestamp())),
  'exp',floor(extract(epoch from clock_timestamp()+interval '30 minutes')),
  'amr',case when coalesce(p_session,n)=4 then jsonb_build_array(jsonb_build_object('method','oauth','timestamp',current_setting('test.af_oauth')::bigint))
   else jsonb_build_array(jsonb_build_object('method','oauth','timestamp',current_setting('test.af_oauth')::bigint),
   jsonb_build_object('method','totp','timestamp',current_setting('test.af_totp')::bigint))end)::text,true);
 return public.is_executive_login_allowed();
end $$;
create function pg_temp.af_parsed() returns jsonb language sql immutable as $$
 select '{"mappingVersion":"central-care-plan-html@1","sections":[],"fields":[],"warnings":[],"conflicts":[],"contentFingerprint":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","security":{"parser":"cheerio-static","scriptElementsBlocked":0,"formElementsNeutralized":0,"redirectElementsBlocked":0,"activeElementsBlocked":0,"inlineEventHandlersBlocked":0,"externalReferencesBlocked":0,"externalRequestCount":0}}'::jsonb;
$$;
create function pg_temp.af_archive(r jsonb) returns jsonb language sql immutable as $$
 select jsonb_build_object('key','organizations/'||(r->>'organization_id')||'/branches/'||(r->>'branch_id')||'/central-html/'||(r->>'file_sha256')||'/'||(r->>'reservation_id')||'.html',
 'versionId','synthetic-recovery-worm-v1','sha256',r->>'file_sha256','createdAt',r->>'created_at',
 'byteLength',(r->>'file_size_bytes')::integer,'retainUntil',(r->>'created_at')::timestamptz+interval '7 years');
$$;
create function pg_temp.af_original(p_key uuid,p_sha text,p_mode text default 'routine-intake') returns jsonb language plpgsql security invoker as $$
begin
 if p_mode='routine-intake' then return public.reserve_intake_import_upload('f3200000-0000-4000-8000-000000000001','f3300000-0000-4000-8000-000000000001',p_key,p_sha,'synthetic.html','text/html',128,'central-care-plan-html@1');end if;
 return public.reserve_import_upload('f3200000-0000-4000-8000-000000000001','f3300000-0000-4000-8000-000000000001',p_key,p_sha,'synthetic.html','text/html',128,'central-care-plan-html@1');
end $$;
create function pg_temp.af_error(statement text) returns text language plpgsql security invoker as $$
begin execute statement;return 'SUCCESS';exception when others then return sqlstate;end $$;
-- NATIVE_FIXTURE_END

insert into fence_data values('business',jsonb_build_object('clients',(select count(*)from public.clients),'plans',(select count(*)from public.authorized_care_plans),'careRecords',(select count(*)from public.care_records),'medications',(select count(*)from public.medication_administrations)));
select ok(to_regprocedure('private.import_upload_current_authority_fence(uuid,uuid,uuid,uuid,uuid,boolean)') is not null,'narrow immutable-proof fence exists');
select ok(not exists(select 1 from unnest(array['anon','authenticated','service_role'])r where has_function_privilege(r,'private.import_upload_current_authority_fence(uuid,uuid,uuid,uuid,uuid,boolean)','EXECUTE')),'no caller can directly borrow the private authority fence');
select ok((select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid='private.import_upload_current_authority_fence(uuid,uuid,uuid,uuid,uuid,boolean)'::regprocedure),'fence retains bounded SECURITY DEFINER search path');
select is((select count(*)::integer from pg_class where oid in('private.import_upload_reservations'::regclass,'private.import_upload_completions'::regclass) and relrowsecurity and relforcerowsecurity),2,'original ledgers remain FORCE RLS');
select ok(not has_table_privilege('authenticated','private.import_upload_reservations','INSERT') and not has_table_privilege('service_role','private.import_upload_completions','INSERT'),'caller direct DML stays denied');
select ok(has_function_privilege('authenticated','public.reserve_intake_import_upload(uuid,uuid,uuid,text,text,text,integer,text)','EXECUTE') and not has_function_privilege('service_role','public.reserve_intake_import_upload(uuid,uuid,uuid,text,text,text,integer,text)','EXECUTE'),'routine reservation original ACL preserved');
select ok(has_function_privilege('service_role','public.complete_import_upload(uuid,text,jsonb)','EXECUTE') and not has_function_privilege('authenticated','public.complete_import_upload(uuid,text,jsonb)','EXECUTE'),'old worker still worker-only');
select ok(pg_temp.af_login(1,'aal1',1),'real Google AAL1 admission remains usable');
set local role authenticated;
insert into fence_data values('routine',pg_temp.af_original('f3600000-0000-4000-8000-000000000001',repeat('a',64)));
select is((select v->>'status'from fence_data where k='routine'),'queued','routine reservation is staging only');
select is((select pg_temp.af_original('f3600000-0000-4000-8000-000000000001',repeat('a',64))from fence_data where k='routine'),(select v||'{"replayed":true}'::jsonb from fence_data where k='routine'),'same routine key retains exact original receipt');
select is(pg_temp.af_error('select pg_temp.af_original(''f3600000-0000-4000-8000-000000000001'',repeat(''b'',64))'),'22023','same key different bytes is not a reauthorization bypass');
select is(pg_temp.af_error('select public.complete_import_upload(''f3600000-0000-4000-8000-000000000001'',''{}'',''{}'')'),'42501','browser cannot attest a completion');
reset role;
select ok(pg_temp.af_login(1,'aal2',1),'genuine general challenge/session/AMR admitted');
set local role authenticated;
insert into fence_data values('general',pg_temp.af_original('f3600000-0000-4000-8000-000000000002',repeat('b',64),'general'));
select is((select v->>'status'from fence_data where k='general'),'queued','general original reservation still works');
select is(pg_temp.af_original('f3600000-0000-4000-8000-000000000002',repeat('b',64),'general'),(select v||'{"replayed":true}'::jsonb from fence_data where k='general'),'unchanged general original challenge replays');
reset role;
insert into fence_data select 'general-original',to_jsonb(r)from private.import_upload_reservations r where id=(select(v->>'reservation_id')::uuid from fence_data where k='general');
-- A truly different consumed challenge backed by a real, later factor in the
-- SAME actual Auth session. This is NOT an edit to the immutable reservation.
update auth.mfa_amr_claims set updated_at=to_timestamp(current_setting('test.af_totp')::bigint+1)
 where session_id='f3120000-0000-4000-8000-000000000001' and authentication_method='totp';
insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,created_at,expires_at,consumed_at,consumed_jwt_iat,factor_method,factor_verified_at)
 values('f3500000-0000-4000-8000-000000000090','f3100000-0000-4000-8000-000000000001','f3120000-0000-4000-8000-000000000001',repeat('9',64),'f3510000-0000-4000-8000-000000000090',
 now()-interval '3 minutes',now()-interval '2 minutes',now()+interval '5 minutes',
 to_timestamp(current_setting('test.af_totp')::bigint+1),to_timestamp(current_setting('test.af_totp')::bigint+1),'totp',to_timestamp(current_setting('test.af_totp')::bigint+1));
update private.reauth_events set challenge_id='f3500000-0000-4000-8000-000000000090',verified_at=to_timestamp(current_setting('test.af_totp')::bigint+1)
 where user_id='f3100000-0000-4000-8000-000000000001' and session_id='f3120000-0000-4000-8000-000000000001';
select set_config('request.jwt.claims',jsonb_set(auth.jwt(),'{amr,1,timestamp}',to_jsonb(current_setting('test.af_totp')::bigint+1))::text,true);
set local role authenticated;
select is(pg_temp.af_error('select pg_temp.af_original(''f3600000-0000-4000-8000-000000000002'',repeat(''b'',64),''general'')'),'42501','new actual factor/challenge cannot silently rebind ordinary same-key replay');
reset role;
select is((select to_jsonb(r)from private.import_upload_reservations r where id=(select(v->>'reservation_id')::uuid from fence_data where k='general')),(select v from fence_data where k='general-original'),'denied challenge replacement leaves original row unchanged');
set local role service_role;
select is(pg_temp.af_error(format('select public.complete_import_upload(%L,%L,%L::jsonb)',(select v->>'reservation_id'from fence_data where k='general'),pg_temp.af_parsed()::text,(select pg_temp.af_archive(v)::text from fence_data where k='general'))),'42501','old worker original challenge binding remains strict');
set local role authenticated;
insert into fence_data select 'recovery',public.reserve_import_upload_recovery('f3200000-0000-4000-8000-000000000001','f3300000-0000-4000-8000-000000000001',(v->>'reservation_id')::uuid,
 'f3600000-0000-4000-8000-000000000002','f3700000-0000-4000-8000-000000000002',v->>'file_sha256',v->>'file_name',v->>'mime_type',(v->>'file_size_bytes')::integer,v->>'mapping_version','general')
 from fence_data where k='general';
select is((select v->>'status'from fence_data where k='recovery'),'queued','explicit immutable151 recovery can authorize the new real challenge');
set local role service_role;
insert into fence_data select 'completed',public.complete_recovered_import_upload((v->>'recovery_id')::uuid,pg_temp.af_parsed()::text,(select pg_temp.af_archive(v)from fence_data where k='general')) from fence_data where k='recovery';
select is((select v->>'formally_imported'from fence_data where k='completed'),'false','recovered completion never claims formal import');
reset role;
select is((select count(*)::integer from private.import_upload_completions where id=(select(v->>'reservation_id')::uuid from fence_data where k='general')),1,'explicit recovery completes the same original source exactly once');
select is((select to_jsonb(r)from private.import_upload_reservations r where id=(select(v->>'reservation_id')::uuid from fence_data where k='general')),(select v from fence_data where k='general-original'),'recovery preserves original claims/key/challenge/time');
-- Consumed nonce TTL is not the lifetime of a verified factor. A consumed,
-- immutable old nonce may be expired while its actual factor is still fresh.
select set_config('test.af_expired_nonce_factor',floor(extract(epoch from clock_timestamp()-interval '90 seconds'))::text,true);
update auth.mfa_amr_claims set updated_at=to_timestamp(current_setting('test.af_expired_nonce_factor')::bigint)
 where session_id='f3120000-0000-4000-8000-000000000001' and authentication_method='totp';
insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,created_at,expires_at,consumed_at,consumed_jwt_iat,factor_method,factor_verified_at)
 values('f3500000-0000-4000-8000-000000000091','f3100000-0000-4000-8000-000000000001','f3120000-0000-4000-8000-000000000001',repeat('8',64),'f3510000-0000-4000-8000-000000000091',
 now()-interval '3 minutes',now()-interval '2 minutes',now()-interval '1 minute',
 to_timestamp(current_setting('test.af_expired_nonce_factor')::bigint),to_timestamp(current_setting('test.af_expired_nonce_factor')::bigint),'totp',to_timestamp(current_setting('test.af_expired_nonce_factor')::bigint));
update private.reauth_events set challenge_id='f3500000-0000-4000-8000-000000000091',verified_at=to_timestamp(current_setting('test.af_expired_nonce_factor')::bigint)
 where user_id='f3100000-0000-4000-8000-000000000001' and session_id='f3120000-0000-4000-8000-000000000001';
select set_config('request.jwt.claims',jsonb_set(auth.jwt(),'{amr,1,timestamp}',to_jsonb(current_setting('test.af_expired_nonce_factor')::bigint))::text,true);
set local role authenticated;
insert into fence_data values('expired-nonce-fresh-factor',pg_temp.af_original('f3600000-0000-4000-8000-000000000003',repeat('c',64),'general'));
select is((select v->>'status'from fence_data where k='expired-nonce-fresh-factor'),'queued','consumed nonce expiration does not counterfeit factor expiry');
select is(pg_temp.af_error('select public.reserve_import_upload(''f3200000-0000-4000-8000-000000000001'',''f3300000-0000-4000-8000-000000000002'',''f3600000-0000-4000-8000-000000000004'',repeat(''d'',64),''synthetic.html'',''text/html'',128,''central-care-plan-html@1'')'),'42501','foreign branch remains denied');
reset role;
update public.memberships set status='suspended'where id='f3400000-0000-4000-8000-000000000001';
set local role authenticated;
select is(pg_temp.af_error('select pg_temp.af_original(''f3600000-0000-4000-8000-000000000005'',repeat(''e'',64),''general'')'),'42501','actual revoked general membership remains denied');
select is(pg_temp.af_error('select pg_temp.af_original(''f3600000-0000-4000-8000-000000000006'',repeat(''f'',64))'),'42501','actual revoked routine membership remains denied');
reset role;
select is(jsonb_build_object('clients',(select count(*)from public.clients),'plans',(select count(*)from public.authorized_care_plans),'careRecords',(select count(*)from public.care_records),'medications',(select count(*)from public.medication_administrations)),(select v from fence_data where k='business'),'all probes are staging only with zero formal business writes');
select is((select count(*)::integer from private.import_upload_completions where organization_id='f3200000-0000-4000-8000-000000000001'),1,'denials and staging leave no extra owned original completion');
select ok(not exists(select 1 from private.import_upload_reservations where authorization_claims ? 'access_token' or authorization_claims ? 'refresh_token'),'reservation captures no browser token text');
select ok(not has_function_privilege('anon','public.reserve_import_upload(uuid,uuid,uuid,text,text,text,integer,text)','EXECUTE'),'anonymous original reserve remains denied');
select * from finish();
rollback;
