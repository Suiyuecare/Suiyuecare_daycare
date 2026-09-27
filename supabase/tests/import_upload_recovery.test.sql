begin;
select plan(72);
set local time zone 'UTC';
select set_config('test.ur_oauth',floor(extract(epoch from clock_timestamp()-interval '3 minutes'))::text,true);
select set_config('test.ur_totp',floor(extract(epoch from clock_timestamp()-interval '30 seconds'))::text,true);

-- Local synthetic Auth data exercises the genuine executive/session/factor
-- predicates. No production admission function or policy is replaced.
insert into auth.users(id,aud,role,email,email_confirmed_at,created_at,updated_at)
 select ('f2100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated',
  'recovery'||n||'@care.example.invalid',now()-interval '1 day',now()-interval '1 day',now() from generate_series(1,2)n;
insert into auth.identities(id,provider_id,user_id,identity_data,provider)
 select ('f2110000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'synthetic-recovery-'||n,
  ('f2100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  jsonb_build_object('sub','synthetic-recovery-'||n,'email','recovery'||n||'@care.example.invalid','email_verified',true),'google' from generate_series(1,2)n;
insert into auth.sessions(id,user_id,created_at,aal)
 select ('f2120000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('f2100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  now()-interval '4 minutes','aal2' from generate_series(1,2)n;
insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method)
 select ('f2130000-0000-4000-8000-'||lpad((n*2)::text,12,'0'))::uuid,('f2120000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  to_timestamp(current_setting('test.ur_oauth')::bigint),to_timestamp(current_setting('test.ur_oauth')::bigint),'oauth' from generate_series(1,2)n
 union all select ('f2130000-0000-4000-8000-'||lpad((n*2+1)::text,12,'0'))::uuid,('f2120000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  to_timestamp(current_setting('test.ur_totp')::bigint),to_timestamp(current_setting('test.ur_totp')::bigint),'totp' from generate_series(1,2)n;
insert into public.organizations(id,code,name) values
 ('f2200000-0000-4000-8000-000000000001','recovery_import_test','Synthetic recovery import'),
 ('f2200000-0000-4000-8000-000000000002','recovery_import_foreign','Synthetic foreign import');
insert into public.branches(id,organization_id,code,name) values
 ('f2300000-0000-4000-8000-000000000001','f2200000-0000-4000-8000-000000000001','main','Synthetic import main'),
 ('f2300000-0000-4000-8000-000000000002','f2200000-0000-4000-8000-000000000001','other','Synthetic import other'),
 ('f2300000-0000-4000-8000-000000000003','f2200000-0000-4000-8000-000000000002','foreign','Synthetic import foreign');
insert into public.profiles(id,display_name,kind)
 select ('f2100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Synthetic import actor '||n,'staff' from generate_series(1,2)n;
insert into public.memberships(id,organization_id,branch_id,profile_id,status,starts_at)
 select ('f2400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'f2200000-0000-4000-8000-000000000001','f2300000-0000-4000-8000-000000000001',
  ('f2100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'active',now()-interval '1 day' from generate_series(1,2)n;
insert into public.membership_roles(membership_id,role_id)
 select ('f2400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'10000000-0000-4000-8000-000000000002' from generate_series(1,2)n;
insert into private.executive_access_policy(allowed_user_id,allowed_email,google_subject,enabled,approval_reference)
 values('f2100000-0000-4000-8000-000000000001','recovery1@care.example.invalid','synthetic-recovery-1',true,'Synthetic recovery repository approval');
insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,issued_jwt_jti,created_at,expires_at,
 consumed_at,consumed_jwt_iat,consumed_jwt_jti,factor_method,factor_verified_at)
 select ('f2500000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('f2100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  ('f2120000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,repeat(n::text,64),('f2510000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  now()-interval '3 minutes','before-recovery-'||n,now()-interval '2 minutes',now()+interval '5 minutes',
  to_timestamp(current_setting('test.ur_totp')::bigint),to_timestamp(current_setting('test.ur_totp')::bigint),'after-recovery-'||n,'totp',to_timestamp(current_setting('test.ur_totp')::bigint)
 from generate_series(1,2)n;
insert into private.reauth_events(user_id,session_id,challenge_id,aal,verification_method,verified_at)
 select ('f2100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('f2120000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  ('f2500000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'aal2','totp',to_timestamp(current_setting('test.ur_totp')::bigint) from generate_series(1,2)n;
-- A second real session for the SAME actor is deliberately not a rebind of the
-- old immutable reservation. Recovery must name and retain both identities.
insert into auth.sessions(id,user_id,created_at,aal) values
 ('f2120000-0000-4000-8000-000000000003','f2100000-0000-4000-8000-000000000001',now()-interval '4 minutes','aal2'),
 ('f2120000-0000-4000-8000-000000000004','f2100000-0000-4000-8000-000000000001',now()-interval '4 minutes','aal2');
insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method)
 select ('f2130000-0000-4000-8000-'||lpad((n+10)::text,12,'0'))::uuid,
  ('f2120000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  to_timestamp(current_setting('test.ur_oauth')::bigint),to_timestamp(current_setting('test.ur_oauth')::bigint),'oauth'
 from generate_series(3,4)n
 union all select 'f2130000-0000-4000-8000-000000000023'::uuid,'f2120000-0000-4000-8000-000000000003'::uuid,
  to_timestamp(current_setting('test.ur_totp')::bigint),to_timestamp(current_setting('test.ur_totp')::bigint),'totp';
insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,issued_jwt_jti,created_at,expires_at,
 consumed_at,consumed_jwt_iat,consumed_jwt_jti,factor_method,factor_verified_at)
 values('f2500000-0000-4000-8000-000000000003','f2100000-0000-4000-8000-000000000001',
 'f2120000-0000-4000-8000-000000000003',repeat('3',64),'f2510000-0000-4000-8000-000000000003',
 now()-interval '3 minutes','before-new-recovery',now()-interval '2 minutes',now()+interval '5 minutes',
 to_timestamp(current_setting('test.ur_totp')::bigint),to_timestamp(current_setting('test.ur_totp')::bigint),'after-new-recovery','totp',
 to_timestamp(current_setting('test.ur_totp')::bigint));
insert into private.reauth_events(user_id,session_id,challenge_id,aal,verification_method,verified_at)
 values('f2100000-0000-4000-8000-000000000001','f2120000-0000-4000-8000-000000000003',
 'f2500000-0000-4000-8000-000000000003','aal2','totp',to_timestamp(current_setting('test.ur_totp')::bigint));
create temporary table recovery_data(k text primary key,v jsonb);
grant select,insert,update on recovery_data to authenticated,service_role;
create function pg_temp.ur_login(n integer default 1,p_aal text default 'aal2',p_session integer default null) returns boolean language plpgsql security invoker as $$
begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub','f2100000-0000-4000-8000-'||lpad(n::text,12,'0'),
  'session_id','f2120000-0000-4000-8000-'||lpad(coalesce(p_session,n)::text,12,'0'),'aud','authenticated','role','authenticated','aal',p_aal,
  'email','recovery'||n||'@care.example.invalid','is_anonymous',false,'iat',floor(extract(epoch from clock_timestamp())),
  'exp',floor(extract(epoch from clock_timestamp()+interval '30 minutes')),
  'amr',case when coalesce(p_session,n)=4 then jsonb_build_array(jsonb_build_object('method','oauth','timestamp',current_setting('test.ur_oauth')::bigint))
   else jsonb_build_array(jsonb_build_object('method','oauth','timestamp',current_setting('test.ur_oauth')::bigint),
   jsonb_build_object('method','totp','timestamp',current_setting('test.ur_totp')::bigint))end)::text,true);
 return public.is_executive_login_allowed();
end $$;
create function pg_temp.ur_parsed() returns jsonb language sql immutable as $$
 select '{"mappingVersion":"central-care-plan-html@1","sections":[],"fields":[],"warnings":[],"conflicts":[],"contentFingerprint":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","security":{"parser":"cheerio-static","scriptElementsBlocked":0,"formElementsNeutralized":0,"redirectElementsBlocked":0,"activeElementsBlocked":0,"inlineEventHandlersBlocked":0,"externalReferencesBlocked":0,"externalRequestCount":0}}'::jsonb;
$$;
create function pg_temp.ur_archive(r jsonb) returns jsonb language sql immutable as $$
 select jsonb_build_object('key','organizations/'||(r->>'organization_id')||'/branches/'||(r->>'branch_id')||'/central-html/'||(r->>'file_sha256')||'/'||(r->>'reservation_id')||'.html',
 'versionId','synthetic-recovery-worm-v1','sha256',r->>'file_sha256','createdAt',r->>'created_at',
 'byteLength',(r->>'file_size_bytes')::integer,'retainUntil',(r->>'created_at')::timestamptz+interval '7 years');
$$;
create function pg_temp.ur_original(p_key uuid,p_sha text,p_mode text default 'routine-intake') returns jsonb language plpgsql security invoker as $$
begin
 if p_mode='routine-intake' then return public.reserve_intake_import_upload('f2200000-0000-4000-8000-000000000001','f2300000-0000-4000-8000-000000000001',p_key,p_sha,'synthetic.html','text/html',128,'central-care-plan-html@1');end if;
 return public.reserve_import_upload('f2200000-0000-4000-8000-000000000001','f2300000-0000-4000-8000-000000000001',p_key,p_sha,'synthetic.html','text/html',128,'central-care-plan-html@1');
end $$;
create function pg_temp.ur_recover(r jsonb,p_original uuid,p_key uuid,p_mode text default 'routine-intake') returns jsonb language sql security invoker as $$
 select public.reserve_import_upload_recovery((r->>'organization_id')::uuid,(r->>'branch_id')::uuid,(r->>'reservation_id')::uuid,p_original,p_key,
 r->>'file_sha256',r->>'file_name',r->>'mime_type',(r->>'file_size_bytes')::integer,r->>'mapping_version',p_mode);
$$;
create function pg_temp.ur_read(p_key uuid,p_mode text default 'routine-intake') returns jsonb language sql security invoker as $$
 select public.import_upload_recovery_receipt('f2200000-0000-4000-8000-000000000001','f2300000-0000-4000-8000-000000000001',p_key,p_mode);
$$;
create function pg_temp.ur_complete(r jsonb,p_payload text default pg_temp.ur_parsed()::text,p_archive jsonb default null) returns jsonb language sql security invoker as $$
 select public.complete_recovered_import_upload((r->>'recovery_id')::uuid,p_payload,coalesce(p_archive,pg_temp.ur_archive(r)));
$$;
create function pg_temp.ur_error(statement text) returns text language plpgsql security invoker as $$
begin execute statement;return 'SUCCESS';exception when others then return sqlstate;end $$;
-- NATIVE_FIXTURE_END

insert into recovery_data values('business',jsonb_build_object('clients',(select count(*)from public.clients),'plans',(select count(*)from public.authorized_care_plans),'careRecords',(select count(*)from public.care_records),'medicationAdministrations',(select count(*)from public.medication_administrations)));
select is((select count(*)::integer from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname in('import_upload_recoveries','import_upload_recovery_completions') and c.relrowsecurity and c.relforcerowsecurity),2,'recovery ledgers FORCE RLS');
select ok(not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace cross join unnest(array['anon','authenticated','service_role']) r where n.nspname='private' and c.relname in('import_upload_recoveries','import_upload_recovery_completions') and (has_table_privilege(r,c.oid,'SELECT') or has_table_privilege(r,c.oid,'INSERT') or has_table_privilege(r,c.oid,'UPDATE') or has_table_privilege(r,c.oid,'DELETE'))),'no direct browser or worker ledger privileges');
select ok(not exists(select 1 from pg_constraint fk where fk.contype='f' and fk.conrelid in('private.import_upload_recoveries'::regclass,'private.import_upload_recovery_completions'::regclass) and not exists(select 1 from pg_index i where i.indrelid=fk.conrelid and i.indisvalid and i.indisready and array(select x from unnest(i.indkey)with ordinality u(x,n)where n<=cardinality(fk.conkey)order by n)=fk.conkey)),'all new FK pointers have covering leading indexes');
select ok(not has_function_privilege('anon','public.reserve_import_upload_recovery(uuid,uuid,uuid,uuid,uuid,text,text,text,integer,text,text)','EXECUTE') and not has_function_privilege('service_role','public.reserve_import_upload_recovery(uuid,uuid,uuid,uuid,uuid,text,text,text,integer,text,text)','EXECUTE'),'worker and anonymous cannot manufacture user recovery');
select ok(not has_function_privilege('authenticated','public.complete_recovered_import_upload(uuid,text,jsonb)','EXECUTE') and has_function_privilege('service_role','public.complete_recovered_import_upload(uuid,text,jsonb)','EXECUTE'),'completion remains worker-only');
select ok(pg_temp.ur_login(1,'aal1',1),'real approved Google original session admitted');
set local role authenticated;
select is(pg_temp.ur_read('f2600000-0000-4000-8000-000000000099'),null::jsonb,'unknown exact recovery is null not fabricated success');
insert into recovery_data values('routine-original',pg_temp.ur_original('f2600000-0000-4000-8000-000000000001',repeat('a',64)));
reset role;
insert into recovery_data select 'original-row',to_jsonb(r)from private.import_upload_reservations r where id=(select(v->>'reservation_id')::uuid from recovery_data where k='routine-original');
update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='f2120000-0000-4000-8000-000000000001';
select ok(pg_temp.ur_login(1,'aal1',3),'new real same-actor Google session admitted without fake MFA');
set local role authenticated;
select is(pg_temp.ur_error('select pg_temp.ur_original(''f2600000-0000-4000-8000-000000000001'',repeat(''a'',64))'),'22023','old same-key reserve cannot silently rebind session');
select is(pg_temp.ur_error('select pg_temp.ur_original(''f2600000-0000-4000-8000-000000000099'',repeat(''a'',64))'),'23505','new key cannot bypass original content uniqueness');
set local role service_role;
select is(pg_temp.ur_error(format('select public.complete_import_upload(%L,%L,%L)',(select v->>'reservation_id'from recovery_data where k='routine-original'),pg_temp.ur_parsed()::text,(select pg_temp.ur_archive(v)::text from recovery_data where k='routine-original'))),'42501','old completion gate is unchanged for expired original session');
set local role authenticated;
insert into recovery_data select 'routine-recovery',pg_temp.ur_recover(v,'f2600000-0000-4000-8000-000000000001','f2700000-0000-4000-8000-000000000001') from recovery_data where k='routine-original';
select is((select v->>'status'from recovery_data where k='routine-recovery'),'queued','explicit recovery authorizes staging only');
select is((select v->>'created_at'from recovery_data where k='routine-recovery'),(select v->>'created_at'from recovery_data where k='routine-original'),'original source creation time preserved');
select is((select v->>'formally_imported'from recovery_data where k='routine-recovery'),'false','recovery never claims formal client creation');
select is((select v->>'receipt'from recovery_data where k='routine-recovery'),null::text,'pending archive does not imply completed source');
select ok((select(v->>'expires_at')::timestamptz<=(v->>'recovery_created_at')::timestamptz+interval '15 minutes' from recovery_data where k='routine-recovery'),'attempt expiration is independently bounded');
select is((select pg_temp.ur_recover(v,'f2600000-0000-4000-8000-000000000001','f2700000-0000-4000-8000-000000000001')from recovery_data where k='routine-original'),(select v||'{"replayed":true}'::jsonb from recovery_data where k='routine-recovery'),'same exact recovery key retains immutable original attempt');
select is(pg_temp.ur_error(format('select pg_temp.ur_recover(%L::jsonb,%L,%L)',jsonb_set((select v from recovery_data where k='routine-original'),'{file_name}','"changed.html"'),'f2600000-0000-4000-8000-000000000001','f2700000-0000-4000-8000-000000000001')),'22023','same key different filename rejected');
select is(pg_temp.ur_error(format('select pg_temp.ur_recover(%L::jsonb,%L,%L)',jsonb_set((select v from recovery_data where k='routine-original'),'{file_size_bytes}','129'),'f2600000-0000-4000-8000-000000000001','f2700000-0000-4000-8000-000000000001')),'22023','same key different byte size rejected');
select is(pg_temp.ur_error(format('select pg_temp.ur_recover(%L::jsonb,%L,%L)',jsonb_set((select v from recovery_data where k='routine-original'),'{file_sha256}',to_jsonb(repeat('c',64))),'f2600000-0000-4000-8000-000000000001','f2700000-0000-4000-8000-000000000001')),'22023','same key different bytes hash rejected');
select is(pg_temp.ur_error(format('select pg_temp.ur_recover(%L::jsonb,%L,%L)',(select v from recovery_data where k='routine-original'),'f2600000-0000-4000-8000-000000000099','f2700000-0000-4000-8000-000000000001')),'42501','wrong original operation is not own source proof');
select is(pg_temp.ur_error(format('select pg_temp.ur_recover(%L::jsonb,%L,%L)',(select v from recovery_data where k='routine-original'),'f2600000-0000-4000-8000-000000000001','f2600000-0000-4000-8000-000000000001')),'22023','recovery cannot reuse original operation UUID');
select is(pg_temp.ur_error('select pg_temp.ur_original(''f2700000-0000-4000-8000-000000000001'',repeat(''d'',64))'),'23505','later ordinary reservation cannot borrow an existing recovery key');
insert into recovery_data values('namespace-original',pg_temp.ur_original('f2600000-0000-4000-8000-000000000010',repeat('e',64)));
select is(pg_temp.ur_error(format('select pg_temp.ur_recover(%L::jsonb,%L,%L)',(select v from recovery_data where k='routine-original'),'f2600000-0000-4000-8000-000000000001','f2600000-0000-4000-8000-000000000010')),'23505','recovery cannot borrow a previous ordinary key');
select is(pg_temp.ur_error('select public.import_upload_recovery_receipt(''f2200000-0000-4000-8000-000000000001'',''f2300000-0000-4000-8000-000000000002'',''f2700000-0000-4000-8000-000000000001'',''routine-intake'')'),'42501','cross-branch direct recovery read denied');
select is(pg_temp.ur_error('select public.import_upload_recovery_receipt(''f2200000-0000-4000-8000-000000000002'',''f2300000-0000-4000-8000-000000000003'',''f2700000-0000-4000-8000-000000000001'',''routine-intake'')'),'42501','cross-organization direct recovery read denied');
select is(pg_temp.ur_error('select pg_temp.ur_read(''f2700000-0000-4000-8000-000000000001'',''unknown'')'),'22023','unknown mode cannot choose alternate policy');
select is(pg_temp.ur_error(format('select pg_temp.ur_complete(%L::jsonb)',(select v from recovery_data where k='routine-recovery'))),'42501','browser cannot attest parsed/archive completion');
reset role;
select is((select to_jsonb(r)from private.import_upload_reservations r where id=(select(v->>'reservation_id')::uuid from recovery_data where k='routine-original')),(select v from recovery_data where k='original-row'),'recovery never rewrites original claims/session/time');
select is((select session_id::text from private.import_upload_recoveries where id=(select(v->>'recovery_id')::uuid from recovery_data where k='routine-recovery')),'f2120000-0000-4000-8000-000000000003','new ledger binds actual new session');
select ok((select reauth_challenge_id is null and verified_at is null from private.import_upload_recoveries where id=(select(v->>'recovery_id')::uuid from recovery_data where k='routine-recovery')),'routine recovery does not invent MFA evidence');
select throws_ok($$update private.import_upload_recoveries set mode='general'$$,'55000',null,'recovery authorization immutable even owner DML');
select throws_ok($$delete from private.import_upload_recoveries$$,'55000',null,'recovery authorization cannot be deleted');
set local role service_role;
select is(pg_temp.ur_error(format('select pg_temp.ur_complete(%L::jsonb,%L)',(select v from recovery_data where k='routine-recovery'),jsonb_set(pg_temp.ur_parsed(),'{security,externalRequestCount}','1')::text)),'22023','unsafe parser projection cannot complete recovered upload');
select is(pg_temp.ur_error(format('select pg_temp.ur_complete(%L::jsonb,%L,%L::jsonb)',(select v from recovery_data where k='routine-recovery'),pg_temp.ur_parsed()::text,jsonb_set((select pg_temp.ur_archive(v)from recovery_data where k='routine-recovery'),'{createdAt}','"2020-01-01T00:00:00.000Z"'))),'22023','archive creation must remain original reservation time');
select is(pg_temp.ur_error(format('select pg_temp.ur_complete(%L::jsonb,%L,%L::jsonb)',(select v from recovery_data where k='routine-recovery'),pg_temp.ur_parsed()::text,jsonb_set((select pg_temp.ur_archive(v)from recovery_data where k='routine-recovery'),'{key}','"foreign/path.html"'))),'22023','archive path cannot be rebound to foreign source');
insert into recovery_data select 'routine-complete',pg_temp.ur_complete(v) from recovery_data where k='routine-recovery';
select is((select v->>'staging_only'from recovery_data where k='routine-complete'),'true','worker returns original staged-only receipt');
select is((select v->>'formally_imported'from recovery_data where k='routine-complete'),'false','worker creates no client or care record');
select is((select pg_temp.ur_complete(v)from recovery_data where k='routine-recovery'),(select v||'{"replayed":true}'::jsonb from recovery_data where k='routine-complete'),'lost worker ACK recovers immutable exact completion');
select is(pg_temp.ur_error(format('select pg_temp.ur_complete(%L::jsonb,%L)',(select v from recovery_data where k='routine-recovery'),pg_temp.ur_parsed()::text||' ')),'22023','equivalent JSON text is not exact original completion replay');
set local role authenticated;
insert into recovery_data values('receipt-before',pg_temp.ur_read('f2700000-0000-4000-8000-000000000001'));
select is((select v->>'status'from recovery_data where k='receipt-before'),'completed','explicit read can prove previously committed source');
select is((select v->'receipt'from recovery_data where k='receipt-before'),(select v from recovery_data where k='routine-complete'),'read returns exact original receipt, not latest unrelated data');
select ok((select not(v?'authorization_claims') and not(v?'archive_reference') and not(v?'parsed_payload') from recovery_data where k='receipt-before'),'read does not leak token claims, archive path, or clinical fields');
reset role;
select is((select count(*)::integer from private.import_upload_completions),1,'retry never duplicates original completion');
select is((select count(*)::integer from private.import_upload_recovery_completions),1,'one immutable recovered terminal ledger');
select is((select to_jsonb(r)from private.import_upload_reservations r where id=(select(v->>'reservation_id')::uuid from recovery_data where k='routine-original')),(select v from recovery_data where k='original-row'),'completion retains original reservation byte-for-byte');
select throws_ok($$update private.import_upload_recovery_completions set receipt='{}'$$,'55000',null,'terminal receipt immutable');
-- Current read authority, rather than the historical recovery session, controls
-- disclosure. Actual current permission loss cannot be hidden by old evidence.
update public.memberships set status='suspended' where id='f2400000-0000-4000-8000-000000000001';set local role authenticated;
select is(pg_temp.ur_error('select pg_temp.ur_read(''f2700000-0000-4000-8000-000000000001'')'),'42501','current membership revocation denies historical receipt');
reset role;update public.memberships set status='active' where id='f2400000-0000-4000-8000-000000000001';
update public.branches set is_active=false where id='f2300000-0000-4000-8000-000000000001';set local role authenticated;
select is(pg_temp.ur_error('select pg_temp.ur_read(''f2700000-0000-4000-8000-000000000001'')'),'42501','current disabled branch denies historical receipt');
reset role;update public.branches set is_active=true where id='f2300000-0000-4000-8000-000000000001';
update private.executive_access_policy set enabled=false where allowed_user_id='f2100000-0000-4000-8000-000000000001';set local role authenticated;
select is(pg_temp.ur_error('select pg_temp.ur_read(''f2700000-0000-4000-8000-000000000001'')'),'42501','revoked Google executive approval denies receipt');
reset role;update private.executive_access_policy set enabled=true where allowed_user_id='f2100000-0000-4000-8000-000000000001';
update auth.sessions set not_after=null where id='f2120000-0000-4000-8000-000000000001';
select pg_temp.ur_login(1,'aal2',1);set local role authenticated;
insert into recovery_data values('general-original',pg_temp.ur_original('f2600000-0000-4000-8000-000000000002',repeat('b',64),'general'));
reset role;update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='f2120000-0000-4000-8000-000000000001';
select pg_temp.ur_login(1,'aal1',3);set local role authenticated;
select is(pg_temp.ur_error(format('select pg_temp.ur_recover(%L::jsonb,%L,%L,%L)',(select v from recovery_data where k='general-original'),'f2600000-0000-4000-8000-000000000002','f2700000-0000-4000-8000-000000000002','general')),'42501','general recovery does not inherit routine AAL1 exception');
reset role;select pg_temp.ur_login(1,'aal2',4);set local role authenticated;
select is(pg_temp.ur_error(format('select pg_temp.ur_recover(%L::jsonb,%L,%L,%L)',(select v from recovery_data where k='general-original'),'f2600000-0000-4000-8000-000000000002','f2700000-0000-4000-8000-000000000002','general')),'42501','JWT assurance without actual challenge does not authorize recovery');
reset role;select pg_temp.ur_login(1,'aal2',3);set local role authenticated;
insert into recovery_data select 'general-recovery',pg_temp.ur_recover(v,'f2600000-0000-4000-8000-000000000002','f2700000-0000-4000-8000-000000000002','general') from recovery_data where k='general-original';
select is((select v->>'mode'from recovery_data where k='general-recovery'),'general','new actual MFA permits explicit general recovery');
reset role;
select is((select reauth_challenge_id::text from private.import_upload_recoveries where id=(select(v->>'recovery_id')::uuid from recovery_data where k='general-recovery')),'f2500000-0000-4000-8000-000000000003','new challenge bound, not original challenge');
select ok((select expires_at<=verified_at+interval '15 minutes' from private.import_upload_recoveries where id=(select(v->>'recovery_id')::uuid from recovery_data where k='general-recovery')),'general expiration bounded by actual factor time');
update private.reauth_events set revoked_at=clock_timestamp() where challenge_id='f2500000-0000-4000-8000-000000000003';set local role authenticated;
select lives_ok('select pg_temp.ur_read(''f2700000-0000-4000-8000-000000000002'',''general'')','general historical read does not grant a new signature or require recent MFA');
set local role service_role;
select is(pg_temp.ur_error(format('select pg_temp.ur_complete(%L::jsonb)',(select v from recovery_data where k='general-recovery'))),'42501','revoked new challenge blocks worker completion');
reset role;update private.reauth_events set revoked_at=null where challenge_id='f2500000-0000-4000-8000-000000000003';
set local role service_role;
insert into recovery_data select 'general-complete',pg_temp.ur_complete(v)from recovery_data where k='general-recovery';
select is((select v->>'formally_imported'from recovery_data where k='general-complete'),'false','general recovered completion remains staging only');
reset role;
-- Immutable challenges remain intact; only the permitted actual event pointer
-- moves to separate genuine stale/future challenge rows.
insert into private.reauth_challenges select(jsonb_populate_record(null::private.reauth_challenges,to_jsonb(c)||jsonb_build_object('id','f2500000-0000-4000-8000-000000000005','idempotency_key','f2510000-0000-4000-8000-000000000005','nonce_sha256',repeat('5',64),'created_at',clock_timestamp()-interval '20 minutes','expires_at',clock_timestamp()-interval '15 minutes','issued_jwt_iat',clock_timestamp()-interval '21 minutes','consumed_at',clock_timestamp()-interval '16 minutes','consumed_jwt_iat',clock_timestamp()-interval '16 minutes','factor_verified_at',clock_timestamp()-interval '16 minutes'))).*from private.reauth_challenges c where id='f2500000-0000-4000-8000-000000000003';
update private.reauth_events set challenge_id='f2500000-0000-4000-8000-000000000005',verified_at=(select factor_verified_at from private.reauth_challenges where id='f2500000-0000-4000-8000-000000000005')where session_id='f2120000-0000-4000-8000-000000000003';set local role authenticated;
select is(pg_temp.ur_error(format('select pg_temp.ur_recover(%L::jsonb,%L,%L,%L)',(select v from recovery_data where k='general-original'),'f2600000-0000-4000-8000-000000000002','f2700000-0000-4000-8000-000000000005','general')),'42501','actual stale challenge cannot create recovery authorization');
reset role;
insert into private.reauth_challenges select(jsonb_populate_record(null::private.reauth_challenges,to_jsonb(c)||jsonb_build_object('id','f2500000-0000-4000-8000-000000000006','idempotency_key','f2510000-0000-4000-8000-000000000006','nonce_sha256',repeat('6',64),'consumed_at',clock_timestamp()+interval '30 seconds','consumed_jwt_iat',clock_timestamp()+interval '30 seconds','factor_verified_at',clock_timestamp()+interval '30 seconds'))).*from private.reauth_challenges c where id='f2500000-0000-4000-8000-000000000003';
update private.reauth_events set challenge_id='f2500000-0000-4000-8000-000000000006',verified_at=(select factor_verified_at from private.reauth_challenges where id='f2500000-0000-4000-8000-000000000006')where session_id='f2120000-0000-4000-8000-000000000003';set local role authenticated;
select is(pg_temp.ur_error(format('select pg_temp.ur_recover(%L::jsonb,%L,%L,%L)',(select v from recovery_data where k='general-original'),'f2600000-0000-4000-8000-000000000002','f2700000-0000-4000-8000-000000000006','general')),'42501','future actual factor is not genuine recent recovery evidence');
reset role;update private.reauth_events set challenge_id='f2500000-0000-4000-8000-000000000003',verified_at=to_timestamp(current_setting('test.ur_totp')::bigint)where session_id='f2120000-0000-4000-8000-000000000003';
update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='f2120000-0000-4000-8000-000000000003';set local role service_role;
select is(pg_temp.ur_error(format('select pg_temp.ur_complete(%L::jsonb)',(select v from recovery_data where k='general-recovery'))),'42501','even completed worker replay rechecks captured current session expiry');
reset role;update auth.sessions set not_after=null where id='f2120000-0000-4000-8000-000000000003';
select pg_temp.ur_login(1,'aal1',4);set local role authenticated;
select is(pg_temp.ur_read('f2700000-0000-4000-8000-000000000001'),(select v from recovery_data where k='receipt-before'),'new authorized AAL1 session may read historical recovery without rebinding it');
select is(pg_temp.ur_error(format('select pg_temp.ur_recover(%L::jsonb,%L,%L)',(select v from recovery_data where k='routine-original'),'f2600000-0000-4000-8000-000000000001','f2700000-0000-4000-8000-000000000001')),'42501','newer session cannot silently repurpose an old recovery attempt');
reset role;select pg_temp.ur_login(1,'aal2',3);set local role authenticated;
select is(pg_temp.ur_error(format('select pg_temp.ur_recover(%L::jsonb,%L,%L,%L)',(select v from recovery_data where k='routine-original'),'f2600000-0000-4000-8000-000000000001','f2700000-0000-4000-8000-000000000007','general')),'22023','a genuine MFA session cannot relabel routine source as general');
select set_config('request.jwt.claims',jsonb_set(auth.jwt(),'{exp}',to_jsonb(floor(extract(epoch from clock_timestamp()-interval '1 second'))))::text,true);
select is(pg_temp.ur_error('select pg_temp.ur_read(''f2700000-0000-4000-8000-000000000001'')'),'42501','expired current JWT cannot read historical recovery');
reset role;select pg_temp.ur_login(1,'aal2',3);
select is((select to_jsonb(r)from private.import_upload_reservations r where id=(select(v->>'reservation_id')::uuid from recovery_data where k='routine-original')),(select v from recovery_data where k='original-row'),'namespace, session and mode failures never rewrite old authorization');
update private.executive_access_policy set allowed_user_id='f2100000-0000-4000-8000-000000000002',allowed_email='recovery2@care.example.invalid',google_subject='synthetic-recovery-2';
select ok(pg_temp.ur_login(2,'aal2',2),'foreign actor fixture is independently genuinely authorized');
set local role authenticated;
select is(pg_temp.ur_read('f2700000-0000-4000-8000-000000000001'),null::jsonb,'authorized other actor cannot discover original recovery by key');
select is(pg_temp.ur_error(format('select pg_temp.ur_recover(%L::jsonb,%L,%L)',(select v from recovery_data where k='routine-original'),'f2600000-0000-4000-8000-000000000001','f2700000-0000-4000-8000-000000000009')),'42501','other actor cannot adopt the exact original upload');
reset role;
select is((select count(*)::integer from private.import_upload_recoveries),2,'all denied attempts leave only two intended recovery authorizations');
select is((select count(*)::integer from private.import_upload_completions),2,'two intended original sources and zero duplicates');
select is(jsonb_build_object('clients',(select count(*)from public.clients),'plans',(select count(*)from public.authorized_care_plans),'careRecords',(select count(*)from public.care_records),'medicationAdministrations',(select count(*)from public.medication_administrations)),(select v from recovery_data where k='business'),'all recovery operations change zero formal client/plan/care/medication rows');
select * from finish();
rollback;
