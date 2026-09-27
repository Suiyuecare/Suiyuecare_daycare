begin;
select plan(69);
set local time zone 'UTC';
select set_config('test.gi_oauth',floor(extract(epoch from clock_timestamp()-interval '3 minutes'))::text,true);
select set_config('test.gi_totp',floor(extract(epoch from clock_timestamp()-interval '30 seconds'))::text,true);

-- Local synthetic Auth data exercises the genuine executive/session/factor
-- predicates. No production admission function or policy is replaced.
insert into auth.users(id,aud,role,email,email_confirmed_at,created_at,updated_at)
 select ('f1100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated',
  'general'||n||'@care.example.invalid',now()-interval '1 day',now()-interval '1 day',now() from generate_series(1,2)n;
insert into auth.identities(id,provider_id,user_id,identity_data,provider)
 select ('f1110000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'synthetic-general-'||n,
  ('f1100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  jsonb_build_object('sub','synthetic-general-'||n,'email','general'||n||'@care.example.invalid','email_verified',true),'google' from generate_series(1,2)n;
insert into auth.sessions(id,user_id,created_at,aal)
 select ('f1120000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('f1100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  now()-interval '4 minutes','aal2' from generate_series(1,2)n;
insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method)
 select ('f1130000-0000-4000-8000-'||lpad((n*2)::text,12,'0'))::uuid,('f1120000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  to_timestamp(current_setting('test.gi_oauth')::bigint),to_timestamp(current_setting('test.gi_oauth')::bigint),'oauth' from generate_series(1,2)n
 union all select ('f1130000-0000-4000-8000-'||lpad((n*2+1)::text,12,'0'))::uuid,('f1120000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  to_timestamp(current_setting('test.gi_totp')::bigint),to_timestamp(current_setting('test.gi_totp')::bigint),'totp' from generate_series(1,2)n;
insert into public.organizations(id,code,name) values
 ('f1200000-0000-4000-8000-000000000001','general_import_test','Synthetic general import'),
 ('f1200000-0000-4000-8000-000000000002','general_import_foreign','Synthetic foreign import');
insert into public.branches(id,organization_id,code,name) values
 ('f1300000-0000-4000-8000-000000000001','f1200000-0000-4000-8000-000000000001','main','Synthetic import main'),
 ('f1300000-0000-4000-8000-000000000002','f1200000-0000-4000-8000-000000000001','other','Synthetic import other'),
 ('f1300000-0000-4000-8000-000000000003','f1200000-0000-4000-8000-000000000002','foreign','Synthetic import foreign');
insert into public.profiles(id,display_name,kind)
 select ('f1100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Synthetic import actor '||n,'staff' from generate_series(1,2)n;
insert into public.memberships(id,organization_id,branch_id,profile_id,status,starts_at)
 select ('f1400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'f1200000-0000-4000-8000-000000000001','f1300000-0000-4000-8000-000000000001',
  ('f1100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'active',now()-interval '1 day' from generate_series(1,2)n;
insert into public.membership_roles(membership_id,role_id)
 select ('f1400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'10000000-0000-4000-8000-000000000002' from generate_series(1,2)n;
insert into private.executive_access_policy(allowed_user_id,allowed_email,google_subject,enabled,approval_reference)
 values('f1100000-0000-4000-8000-000000000001','general1@care.example.invalid','synthetic-general-1',true,'Synthetic general repository approval');
insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,issued_jwt_jti,created_at,expires_at,
 consumed_at,consumed_jwt_iat,consumed_jwt_jti,factor_method,factor_verified_at)
 select ('f1500000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('f1100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  ('f1120000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,repeat(n::text,64),('f1510000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  now()-interval '3 minutes','before-general-'||n,now()-interval '2 minutes',now()+interval '5 minutes',
  to_timestamp(current_setting('test.gi_totp')::bigint),to_timestamp(current_setting('test.gi_totp')::bigint),'after-general-'||n,'totp',to_timestamp(current_setting('test.gi_totp')::bigint)
 from generate_series(1,2)n;
insert into private.reauth_events(user_id,session_id,challenge_id,aal,verification_method,verified_at)
 select ('f1100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('f1120000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  ('f1500000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'aal2','totp',to_timestamp(current_setting('test.gi_totp')::bigint) from generate_series(1,2)n;
create temporary table general_data(k text primary key,v jsonb);
grant select,insert,update on general_data to authenticated,service_role;
create function pg_temp.gi_login(n integer default 1,p_aal text default 'aal2') returns boolean language plpgsql security invoker as $$
begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub','f1100000-0000-4000-8000-'||lpad(n::text,12,'0'),
  'session_id','f1120000-0000-4000-8000-'||lpad(n::text,12,'0'),'aud','authenticated','role','authenticated','aal',p_aal,
  'email','general'||n||'@care.example.invalid','is_anonymous',false,'iat',floor(extract(epoch from clock_timestamp())),
  'exp',floor(extract(epoch from clock_timestamp()+interval '30 minutes')),
  'amr',jsonb_build_array(jsonb_build_object('method','oauth','timestamp',current_setting('test.gi_oauth')::bigint),
   jsonb_build_object('method','totp','timestamp',current_setting('test.gi_totp')::bigint)))::text,true);
 return public.is_executive_login_allowed();
end $$;
create function pg_temp.gi_uuid(v_bytes bytea) returns uuid language sql immutable as $$
 select encode(set_byte(set_byte(substring(v_bytes from 1 for 16),6,(get_byte(v_bytes,6)&15)|80),8,(get_byte(v_bytes,8)&63)|128),'hex')::uuid;
$$;
create function pg_temp.gi_batch(p_key text) returns uuid language sql security invoker as $$
 select pg_temp.gi_uuid(sha256(convert_to('f1200000-0000-4000-8000-000000000001'||chr(31)||'f1300000-0000-4000-8000-000000000001'||chr(31)||auth.uid()::text||chr(31)||p_key,'UTF8')));
$$;
create function pg_temp.gi_upload_uuid(p_key text) returns uuid language sql security invoker as $$
 select pg_temp.gi_uuid(sha256(convert_to(array_to_json(array['trusted-html-upload/v1','f1200000-0000-4000-8000-000000000001','f1300000-0000-4000-8000-000000000001',auth.uid()::text,p_key])::text,'UTF8')));
$$;
create function pg_temp.gi_parsed() returns jsonb language sql immutable as $$
 select '{"mappingVersion":"central-care-plan-html@1","sections":[{"id":"section_00000000000000000001","index":0,"code":"CLIENT_BASIC","title":"需要服務者基本資料","sourceHeadingId":null,"recognized":true}],"fields":[{"id":"field_000000000000000000000001","mappingKey":"CLIENT_BASIC|個案姓名|CLIENT_BASIC","mappingVersion":"central-care-plan-html@1","mappingState":"mapped","targetPath":"client.name","source":{"sectionCode":"CLIENT_BASIC","sectionTitle":"需要服務者基本資料","label":"個案姓名","parentPath":"CLIENT_BASIC","controlName":null},"rawValue":"Synthetic repository name","normalizedValue":"Synthetic repository name","sensitive":true,"warnings":[]}],"warnings":[],"conflicts":[],"contentFingerprint":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","security":{"parser":"cheerio-static","scriptElementsBlocked":0,"formElementsNeutralized":0,"redirectElementsBlocked":0,"activeElementsBlocked":0,"inlineEventHandlersBlocked":0,"externalReferencesBlocked":0,"externalRequestCount":0}}'::jsonb;
$$;
create function pg_temp.gi_archive(p_reservation jsonb) returns jsonb language sql immutable as $$
 select jsonb_build_object('key','organizations/'||(p_reservation->>'organization_id')||'/branches/'||(p_reservation->>'branch_id')||'/central-html/'||(p_reservation->>'file_sha256')||'/'||(p_reservation->>'reservation_id')||'.html',
  'versionId','synthetic-general-worm-version','sha256',p_reservation->>'file_sha256','createdAt',p_reservation->>'created_at',
  'byteLength',(p_reservation->>'file_size_bytes')::integer,'retainUntil',(p_reservation->>'created_at')::timestamptz+interval '7 years');
$$;
create function pg_temp.gi_reserve(p_key text,p_sha text default repeat('a',64)) returns jsonb language sql security invoker as $$
 select public.reserve_import_upload('f1200000-0000-4000-8000-000000000001','f1300000-0000-4000-8000-000000000001',
  pg_temp.gi_upload_uuid(p_key),p_sha,'synthetic.html','text/html',128,'central-care-plan-html@1');
$$;
-- NATIVE_FIXTURE_END

create function pg_temp.gi_error(statement text) returns text language plpgsql security invoker as $$
begin execute statement;return 'SUCCESS';exception when others then return sqlstate;end $$;
create function pg_temp.gi_read(p_batch uuid) returns jsonb language sql security invoker as $$
 select public.general_import_repository_read('f1200000-0000-4000-8000-000000000001','f1300000-0000-4000-8000-000000000001',p_batch);
$$;
create function pg_temp.gi_attach(p_key text,p_reservation uuid) returns jsonb language sql security invoker as $$
 select public.general_import_repository_attach('f1200000-0000-4000-8000-000000000001','f1300000-0000-4000-8000-000000000001',pg_temp.gi_batch(p_key),p_reservation,p_key);
$$;
create function pg_temp.gi_reparse(p_key text,p_expected bigint,p_parsed jsonb default pg_temp.gi_parsed()) returns jsonb language sql security invoker as $$
 select public.general_import_repository_reparse('f1200000-0000-4000-8000-000000000001','f1300000-0000-4000-8000-000000000001',pg_temp.gi_batch('original-upload'),p_parsed,'ready_for_approval',p_key,p_expected);
$$;
create function pg_temp.gi_approve(p_key text,p_expected bigint,p_resolutions jsonb default '{}'::jsonb) returns jsonb language sql security invoker as $$
 select public.general_import_repository_approve('f1200000-0000-4000-8000-000000000001','f1300000-0000-4000-8000-000000000001',pg_temp.gi_batch('original-upload'),p_expected,p_resolutions,p_key);
$$;
insert into general_data values('baseline',jsonb_build_object('clients',(select count(*)from public.clients),'plans',(select count(*)from public.authorized_care_plans)));
select is((select count(*)::integer from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname like 'general_import_repository_%' and c.relkind='r' and c.relrowsecurity and c.relforcerowsecurity),3,'all three ledgers FORCE RLS');
select ok(not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace cross join unnest(array['anon','authenticated','service_role']) r where n.nspname='private' and c.relname like 'general_import_repository_%' and c.relkind='r' and (has_table_privilege(r,c.oid,'INSERT') or has_table_privilege(r,c.oid,'UPDATE') or has_table_privilege(r,c.oid,'DELETE') or has_table_privilege(r,c.oid,'SELECT'))),'browser and worker cannot directly read or write repository ledgers');
select ok(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like 'general_import_repository_%' or p.proname='general_import_recent_aal2_evidence') and (has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('service_role',p.oid,'EXECUTE') or not has_function_privilege('authenticated',p.oid,'EXECUTE'))),'only authenticated user RPCs are exposed');
select ok(not exists(select 1 from pg_constraint fk where fk.contype='f' and fk.conrelid in('private.general_import_repository_sources'::regclass,'private.general_import_repository_versions'::regclass,'private.general_import_repository_operations'::regclass) and not exists(select 1 from pg_index i where i.indrelid=fk.conrelid and i.indisvalid and i.indisready and array(select x from unnest(i.indkey)with ordinality u(x,n)where n<=cardinality(fk.conkey)order by n)=fk.conkey)),'every repository foreign key has a leading covering index');
select ok(pg_temp.gi_login(),'genuine synthetic Google executive session is admitted');
set local role authenticated;
select is(pg_temp.gi_read('ffffffff-ffff-4fff-8fff-ffffffffffff'),null::jsonb,'unknown batch is null, not a fabricated placeholder');
select is(public.general_import_repository_find_upload('f1200000-0000-4000-8000-000000000001','f1300000-0000-4000-8000-000000000001','missing-key'),null::jsonb,'unknown own operation returns null');
select is(public.general_import_repository_find_hash('f1200000-0000-4000-8000-000000000001','f1300000-0000-4000-8000-000000000001',repeat('a',64)),null::jsonb,'unknown file hash returns null');
select is(public.general_import_repository_authorize('f1200000-0000-4000-8000-000000000001','f1300000-0000-4000-8000-000000000001','read')->>'assuranceLevel','aal2','read authority projection remains AAL2');
select is(public.general_import_recent_aal2_evidence('f1200000-0000-4000-8000-000000000001','f1300000-0000-4000-8000-000000000001')->>'actorUserId',auth.uid()::text,'recent evidence comes from actual challenge and actor');
insert into general_data values('reservation',pg_temp.gi_reserve('original-upload'));
select is(pg_temp.gi_error(format('select pg_temp.gi_attach(%L,%L)','original-upload',(select v->>'reservation_id'from general_data where k='reservation'))),'42501','no trusted completion cannot attach');
reset role;
select is((select count(*)::integer from private.general_import_repository_sources),0,'failed attach leaves sources zero');
set local role service_role;
select is(pg_temp.gi_error(format('select public.complete_import_upload(%L,%L,%L)',(select v->>'reservation_id'from general_data where k='reservation'),pg_temp.gi_parsed()::text,'{}')),'22023','missing archive rejected by actual worker completion');
select is(pg_temp.gi_error(format('select public.complete_import_upload(%L,%L,%L)',(select v->>'reservation_id'from general_data where k='reservation'),jsonb_set(pg_temp.gi_parsed(),'{security,externalRequestCount}','1')::text,(select pg_temp.gi_archive(v)::text from general_data where k='reservation'))),'22023','unsafe parsed source cannot complete');
insert into general_data values('completion',public.complete_import_upload((select(v->>'reservation_id')::uuid from general_data where k='reservation'),pg_temp.gi_parsed()::text,(select pg_temp.gi_archive(v)from general_data where k='reservation')));
select is((select v->>'formally_imported'from general_data where k='completion'),'false','trusted completion is explicitly not formally imported');
set local role authenticated;
insert into general_data values('upload',pg_temp.gi_attach('original-upload',(select(v->>'reservation_id')::uuid from general_data where k='reservation')));
select is((select v->'batch'->>'version'from general_data where k='upload'),'1','first attach creates exactly version one');
select is((select v->>'replayed'from general_data where k='upload'),'false','first attach is not replay');
select is((select v->'batch'->>'status'from general_data where k='upload'),'ready_for_approval','trusted known fields produce approval-ready draft');
select is((select v->'batch'->'fields'from general_data where k='upload'),pg_temp.gi_parsed()->'fields','complete trusted parsed fields retained');
select ok((select not(v->'batch'?'originalBytes') and not(v->'batch'?'originalFile') from general_data where k='upload'),'original bytes never enter batch response');
select is(pg_temp.gi_attach('original-upload',(select(v->>'reservation_id')::uuid from general_data where k='reservation')),(select v||'{"replayed":true}'::jsonb from general_data where k='upload'),'same attach key replays immutable original operation');
select is(pg_temp.gi_error(format('select pg_temp.gi_attach(%L,%L)','wrong-key',(select v->>'reservation_id'from general_data where k='reservation'))),'42501','reservation and batch identities bind original raw key');
select is(public.general_import_repository_find_hash('f1200000-0000-4000-8000-000000000001','f1300000-0000-4000-8000-000000000001',repeat('a',64)),(select v->'batch'from general_data where k='upload'),'hash lookup returns authorized exact stored snapshot');
select is(pg_temp.gi_error('select public.general_import_repository_read(''f1200000-0000-4000-8000-000000000001'',''f1300000-0000-4000-8000-000000000002'',pg_temp.gi_batch(''original-upload''))'),'42501','cross branch direct batch denied');
select is(pg_temp.gi_error('select public.general_import_repository_find_hash(''f1200000-0000-4000-8000-000000000002'',''f1300000-0000-4000-8000-000000000003'',repeat(''a'',64))'),'42501','cross organization hash denied');
select is(pg_temp.gi_error('select pg_temp.gi_reparse(''original-upload'',1)'),'23505','actor key namespace shared across upload and reparse');
select is(pg_temp.gi_error('select pg_temp.gi_reparse(''forged-parsed'',1,jsonb_set(pg_temp.gi_parsed(),''{fields,0,normalizedValue}'',''"FORGED"''))'),'22023','browser cannot inject changed parsed fields');
select is(pg_temp.gi_error('select pg_temp.gi_reparse(''stale-reparse'',2)'),'40001','reparse requires exact current version');
insert into general_data values('reparse',pg_temp.gi_reparse('original-reparse',1));
select is((select v->>'version'from general_data where k='reparse'),'2','reparse appends one immutable version');
select is(public.general_import_repository_find_reparse('f1200000-0000-4000-8000-000000000001','f1300000-0000-4000-8000-000000000001',pg_temp.gi_batch('original-upload'),pg_temp.gi_parsed(),'ready_for_approval','original-reparse'),(select v from general_data where k='reparse'),'find reparse exact historical operation');
select is(public.general_import_repository_find_upload('f1200000-0000-4000-8000-000000000001','f1300000-0000-4000-8000-000000000001','original-upload')->'batch',(select v->'batch'from general_data where k='upload'),'upload replay stays historical version one after reparse');
select is(pg_temp.gi_error('select pg_temp.gi_approve(''wrong-resolution'',2,''{"SYNTHETIC_SECRET":"field"}'')'),'22023','unknown conflict resolution cannot approve');
insert into general_data values('approved',pg_temp.gi_approve('original-approval',2));
select is((select v->>'version'from general_data where k='approved'),'3','approval appends version three');
select is((select v->>'status'from general_data where k='approved'),'ready_for_approval','approval stays staged; does not silently formally import');
select is((select v->'approval'->>'approvedBy'from general_data where k='approved'),auth.uid()::text,'approval records actual authenticated actor');
select is(pg_temp.gi_approve('original-approval',1),(select v from general_data where k='approved'),'exact approval key replays historical result despite obsolete CAS');
select is(pg_temp.gi_error('select pg_temp.gi_reparse(''post-approved'',3)'),'55000','approved snapshot cannot be reparsed');
select is(pg_temp.gi_error('select pg_temp.gi_approve(''post-approved'',3)'),'55000','approved snapshot cannot be approved under new key');
select is(pg_temp.gi_reparse('original-reparse',1),(select v from general_data where k='reparse'),'old reparse replay remains version two after approval');
insert into general_data values('duplicate',public.general_import_repository_duplicate('f1200000-0000-4000-8000-000000000001','f1300000-0000-4000-8000-000000000001',pg_temp.gi_batch('original-upload'),repeat('a',64),'second.html','text/html','original-duplicate'));
select is((select v->>'duplicate'from general_data where k='duplicate'),'true','duplicate records new operation without new parsed version');
select is(public.general_import_repository_duplicate('f1200000-0000-4000-8000-000000000001','f1300000-0000-4000-8000-000000000001',pg_temp.gi_batch('original-upload'),repeat('a',64),'second.html','text/html','original-duplicate'),(select v||'{"replayed":true}'::jsonb from general_data where k='duplicate'),'duplicate original key exact replay');
select is(pg_temp.gi_error('select public.general_import_repository_duplicate(''f1200000-0000-4000-8000-000000000001'',''f1300000-0000-4000-8000-000000000001'',pg_temp.gi_batch(''original-upload''),repeat(''a'',64),''changed.html'',''text/html'',''original-duplicate'')'),'23505','same duplicate key changed metadata conflict');
select is(pg_temp.gi_error('select public.general_import_repository_duplicate(''f1200000-0000-4000-8000-000000000001'',''f1300000-0000-4000-8000-000000000001'',pg_temp.gi_batch(''original-upload''),repeat(''b'',64),''second.html'',''text/html'',''bad-hash'')'),'22023','different file hash cannot pretend duplicate');
select is(pg_temp.gi_error('select public.general_import_repository_find_upload(''f1200000-0000-4000-8000-000000000001'',''f1300000-0000-4000-8000-000000000001'',repeat(''k'',201))'),'22023','operation key size bounded');
reset role;
select is((select count(*)::integer from private.general_import_repository_sources),1,'single trusted source');
select is((select count(*)::integer from private.general_import_repository_versions),3,'failed operations and duplicate add no versions');
select is((select count(*)::integer from private.general_import_repository_operations),4,'four exact successful operations only');
select is(jsonb_build_object('clients',(select count(*)from public.clients),'plans',(select count(*)from public.authorized_care_plans)),(select v from general_data where k='baseline'),'all staging and approval produce zero business changes');
select is(pg_temp.gi_error('update private.general_import_repository_sources set upload_key=''rewritten'''),'55000','source ledger immutable even owner');
select is(pg_temp.gi_error('update private.general_import_repository_versions set content_hash=repeat(''0'',64)'),'55000','version ledger immutable even owner');
select is(pg_temp.gi_error('delete from private.general_import_repository_operations'),'55000','operation receipts cannot be deleted');
set local time zone 'Asia/Taipei';set local role authenticated;
select is(pg_temp.gi_read(pg_temp.gi_batch('original-upload')),(select v from general_data where k='approved'),'snapshot reconstruction is byte-equivalent across session timezone');
select is(pg_temp.gi_reparse('original-reparse',1),(select v from general_data where k='reparse'),'historical reparse receipt timezone parity');
reset role;set local time zone 'UTC';
update public.memberships set status='ended' where id='f1400000-0000-4000-8000-000000000001';
set local role authenticated;
select is(pg_temp.gi_error('select pg_temp.gi_read(pg_temp.gi_batch(''original-upload''))'),'42501','disabled actor cannot read old source');
reset role;update public.memberships set status='active' where id='f1400000-0000-4000-8000-000000000001';
update public.branches set is_active=false where id='f1300000-0000-4000-8000-000000000001';set local role authenticated;
select is(pg_temp.gi_error('select pg_temp.gi_read(pg_temp.gi_batch(''original-upload''))'),'42501','disabled branch cannot read old source');
reset role;update public.branches set is_active=true where id='f1300000-0000-4000-8000-000000000001';
insert into general_data values('saved-permission',to_jsonb((select rp from public.role_permissions rp join public.permissions p on p.id=rp.permission_id where rp.role_id='10000000-0000-4000-8000-000000000002' and p.permission_key='imports.manage')));
delete from public.role_permissions rp using public.permissions p where p.id=rp.permission_id and rp.role_id='10000000-0000-4000-8000-000000000002' and p.permission_key='imports.manage';set local role authenticated;
select is(pg_temp.gi_error('select pg_temp.gi_read(pg_temp.gi_batch(''original-upload''))'),'42501','removed actual import permission denies historical source');
reset role;insert into public.role_permissions select (jsonb_populate_record(null::public.role_permissions,(select v from general_data where k='saved-permission'))).*;
update private.reauth_events set revoked_at=clock_timestamp() where challenge_id='f1500000-0000-4000-8000-000000000001';set local role authenticated;
select lives_ok('select pg_temp.gi_read(pg_temp.gi_batch(''original-upload''))','old challenge does not invalidate admitted current AAL2 read');
select is(pg_temp.gi_error('select public.general_import_recent_aal2_evidence(''f1200000-0000-4000-8000-000000000001'',''f1300000-0000-4000-8000-000000000001'')'),'42501','revoked current MFA pointer cannot authorize new mutation');
reset role;update private.reauth_events set revoked_at=null where challenge_id='f1500000-0000-4000-8000-000000000001';
-- Immutable consumed challenges are never rewritten. Separate actual rows
-- model old/future evidence and only the designed mutable session pointer moves.
insert into private.reauth_challenges select (jsonb_populate_record(null::private.reauth_challenges,to_jsonb(c)||jsonb_build_object('id','f1500000-0000-4000-8000-000000000003','idempotency_key','f1510000-0000-4000-8000-000000000003','nonce_sha256',repeat('c',64),'created_at',clock_timestamp()-interval '20 minutes','expires_at',clock_timestamp()-interval '15 minutes','issued_jwt_iat',clock_timestamp()-interval '21 minutes','consumed_at',clock_timestamp()-interval '16 minutes','consumed_jwt_iat',clock_timestamp()-interval '16 minutes','factor_verified_at',clock_timestamp()-interval '16 minutes'))).* from private.reauth_challenges c where c.id='f1500000-0000-4000-8000-000000000001';
update private.reauth_events set challenge_id='f1500000-0000-4000-8000-000000000003',verified_at=(select factor_verified_at from private.reauth_challenges where id='f1500000-0000-4000-8000-000000000003') where user_id='f1100000-0000-4000-8000-000000000001';set local role authenticated;
select is(pg_temp.gi_error('select public.general_import_recent_aal2_evidence(''f1200000-0000-4000-8000-000000000001'',''f1300000-0000-4000-8000-000000000001'')'),'42501','actual stale challenge and event cannot prove recent MFA');
select is(pg_temp.gi_error('select public.general_import_repository_duplicate(''f1200000-0000-4000-8000-000000000001'',''f1300000-0000-4000-8000-000000000001'',pg_temp.gi_batch(''original-upload''),repeat(''a'',64),''second.html'',''text/html'',''stale-evidence'')'),'42501','direct mutation rejects actual stale evidence');
reset role;
insert into private.reauth_challenges select (jsonb_populate_record(null::private.reauth_challenges,to_jsonb(c)||jsonb_build_object('id','f1500000-0000-4000-8000-000000000004','idempotency_key','f1510000-0000-4000-8000-000000000004','nonce_sha256',repeat('d',64),'consumed_at',clock_timestamp()+interval '30 seconds','consumed_jwt_iat',clock_timestamp()+interval '30 seconds','factor_verified_at',clock_timestamp()+interval '30 seconds'))).* from private.reauth_challenges c where c.id='f1500000-0000-4000-8000-000000000001';
update private.reauth_events set challenge_id='f1500000-0000-4000-8000-000000000004',verified_at=(select factor_verified_at from private.reauth_challenges where id='f1500000-0000-4000-8000-000000000004') where user_id='f1100000-0000-4000-8000-000000000001';set local role authenticated;
select is(pg_temp.gi_error('select public.general_import_recent_aal2_evidence(''f1200000-0000-4000-8000-000000000001'',''f1300000-0000-4000-8000-000000000001'')'),'42501','actual future challenge and event are not recent evidence');
select is(pg_temp.gi_error('select public.general_import_repository_duplicate(''f1200000-0000-4000-8000-000000000001'',''f1300000-0000-4000-8000-000000000001'',pg_temp.gi_batch(''original-upload''),repeat(''a'',64),''second.html'',''text/html'',''future-evidence'')'),'42501','direct mutation rejects future evidence without requiring prior authorize call');
reset role;update private.reauth_events set challenge_id='f1500000-0000-4000-8000-000000000001',verified_at=to_timestamp(current_setting('test.gi_totp')::bigint) where user_id='f1100000-0000-4000-8000-000000000001';
select pg_temp.gi_login(1,'aal1');set local role authenticated;
select is(pg_temp.gi_error('select pg_temp.gi_read(pg_temp.gi_batch(''original-upload''))'),'42501','AAL1 cannot read general durable source');
reset role;select pg_temp.gi_login();
select set_config('request.jwt.claims',jsonb_set(auth.jwt(),'{exp}',to_jsonb(floor(extract(epoch from clock_timestamp()-interval '1 second'))))::text,true);set local role authenticated;
select is(pg_temp.gi_error('select pg_temp.gi_read(pg_temp.gi_batch(''original-upload''))'),'42501','expired actual JWT cannot read source');
reset role;select pg_temp.gi_login();
select set_config('request.jwt.claims',jsonb_set(auth.jwt(),'{amr,1,timestamp}',to_jsonb(floor(extract(epoch from clock_timestamp()+interval '10 minutes'))))::text,true);set local role authenticated;
select is(pg_temp.gi_error('select public.general_import_recent_aal2_evidence(''f1200000-0000-4000-8000-000000000001'',''f1300000-0000-4000-8000-000000000001'')'),'42501','future JWT MFA evidence not trusted');
reset role;select pg_temp.gi_login();
update private.executive_access_policy set allowed_user_id='f1100000-0000-4000-8000-000000000002',allowed_email='general2@care.example.invalid',google_subject='synthetic-general-2';
select ok(pg_temp.gi_login(2),'second actor admitted only after actual policy change');set local role authenticated;
select is(public.general_import_repository_find_upload('f1200000-0000-4000-8000-000000000001','f1300000-0000-4000-8000-000000000001','original-upload'),null::jsonb,'operation key lookup is actor-private, never other actor receipt');
select is(pg_temp.gi_error(format('select public.general_import_repository_attach(%L,%L,%L,%L,%L)','f1200000-0000-4000-8000-000000000001','f1300000-0000-4000-8000-000000000001',(select v->'batch'->>'id'from general_data where k='upload'),(select v->>'reservation_id'from general_data where k='reservation'),'original-upload')),'42501','another actor cannot attach original trusted reservation');
reset role;
select is((select count(*)::integer from private.general_import_repository_versions),3,'authority failures leave immutable versions unchanged');
select * from finish();
rollback;
