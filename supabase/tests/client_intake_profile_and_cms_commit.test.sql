begin;
select plan(94);

-- All identities and records below are synthetic. Exercise the real Google /
-- MFA admission implementation, not a replacement authorization predicate.
select set_config('test.import_amr',floor(extract(epoch from now()-interval '2 minutes'))::text,true);
insert into auth.users(id,aud,role,email,email_confirmed_at,created_at,updated_at) values
 ('a0100000-0000-4000-8000-000000000001','authenticated','authenticated','synthetic-intake@example.invalid',now()-interval '1 day',now()-interval '1 day',now());
insert into auth.identities(id,provider_id,user_id,identity_data,provider) values
 ('a0200000-0000-4000-8000-000000000001','synthetic-intake-google','a0100000-0000-4000-8000-000000000001',
  '{"sub":"synthetic-intake-google","email":"synthetic-intake@example.invalid","email_verified":true}','google');
insert into auth.sessions(id,user_id,created_at,aal) values
 ('a0300000-0000-4000-8000-000000000001','a0100000-0000-4000-8000-000000000001',now()-interval '3 minutes','aal2');
insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method)
select ('a0400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'a0300000-0000-4000-8000-000000000001',
 to_timestamp(current_setting('test.import_amr')::bigint),to_timestamp(current_setting('test.import_amr')::bigint),
 case n when 1 then 'oauth' else 'totp' end from generate_series(1,2) n;
insert into public.organizations(id,code,name) values
 ('a0500000-0000-4000-8000-000000000001','intake_test','合成收案機構'),
 ('a0500000-0000-4000-8000-000000000002','intake_other','合成其他機構');
insert into public.branches(id,organization_id,code,name) values
 ('a0600000-0000-4000-8000-000000000001','a0500000-0000-4000-8000-000000000001','main','合成分支'),
 ('a0600000-0000-4000-8000-000000000002','a0500000-0000-4000-8000-000000000001','other','合成另一分支'),
 ('a0600000-0000-4000-8000-000000000003','a0500000-0000-4000-8000-000000000002','foreign','合成其他機構分支');
insert into public.profiles(id,display_name,kind) values ('a0100000-0000-4000-8000-000000000001','合成收案員','staff');
insert into public.memberships(id,organization_id,branch_id,profile_id,status,starts_at) values
 ('a0700000-0000-4000-8000-000000000001','a0500000-0000-4000-8000-000000000001','a0600000-0000-4000-8000-000000000001',
  'a0100000-0000-4000-8000-000000000001','active',now()-interval '1 day');
insert into public.membership_roles(membership_id,role_id) values
 ('a0700000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002');
insert into private.executive_access_policy(allowed_user_id,allowed_email,google_subject,enabled,approval_reference) values
 ('a0100000-0000-4000-8000-000000000001','synthetic-intake@example.invalid','synthetic-intake-google',true,'synthetic test only');
insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,created_at,expires_at,
 consumed_at,consumed_jwt_iat,factor_method,factor_verified_at) values
 ('a0800000-0000-4000-8000-000000000001','a0100000-0000-4000-8000-000000000001','a0300000-0000-4000-8000-000000000001',
  repeat('e',64),'a0900000-0000-4000-8000-000000000001',now()-interval '3 minutes',now()-interval '2 minutes',now()+interval '3 minutes',
  now()-interval '1 minute',now()-interval '1 minute','totp',now()-interval '1 minute');
insert into private.reauth_events(user_id,session_id,challenge_id,aal,verification_method,verified_at) values
 ('a0100000-0000-4000-8000-000000000001','a0300000-0000-4000-8000-000000000001','a0800000-0000-4000-8000-000000000001','aal2','totp',now()-interval '1 minute');

create function pg_temp.intake_login(p_aal text default 'aal2') returns void language plpgsql security invoker as $$
begin
 perform set_config('request.jwt.claim.sub','',true);
 perform set_config('request.jwt.claim.role','',true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub','a0100000-0000-4000-8000-000000000001',
  'session_id','a0300000-0000-4000-8000-000000000001','role','authenticated','aud','authenticated','aal',p_aal,
  'is_anonymous',false,'email','synthetic-intake@example.invalid','iat',floor(extract(epoch from clock_timestamp())),
  'exp',floor(extract(epoch from clock_timestamp()+interval '30 minutes')),'amr',jsonb_build_array(
   jsonb_build_object('method','oauth','timestamp',current_setting('test.import_amr')::bigint),
   jsonb_build_object('method','totp','timestamp',current_setting('test.import_amr')::bigint)))::text,true);
end;
$$;
select set_config('test.intake_profile','{"displayName":"合成收案甲","clientCode":"SYNTHETIC-INTAKE-1","dateOfBirth":"1945-01-02","identityNumber":"A123456789","sex":"male","phone":"0900000000","registeredAddress":"合成戶籍地址","residentialAddress":"合成居住地址","cmsLevel":5,"contacts":[{"name":"合成關係人","relationship":"子女","phone":"0900000001","isPrimary":true,"isEmergency":true}],"consent":{"status":"pending","confirmedOn":null},"notes":"合成照顧備註"}',true);
create function pg_temp.create_intake(p_n integer default 1,p_profile jsonb default null,p_branch uuid default 'a0600000-0000-4000-8000-000000000001') returns jsonb language sql as $$
 select public.create_intake_client('a0500000-0000-4000-8000-000000000001',p_branch,
  ('aa100000-0000-4000-8000-'||lpad(p_n::text,12,'0'))::uuid,coalesce(p_profile,current_setting('test.intake_profile')::jsonb));
$$;
create function pg_temp.read_intake(p_client uuid default null) returns jsonb language sql as $$
 select public.client_intake_snapshot('a0500000-0000-4000-8000-000000000001','a0600000-0000-4000-8000-000000000001',
 coalesce(p_client,(current_setting('test.manual_receipt')::jsonb->>'clientId')::uuid));
$$;
create function pg_temp.update_intake(p_n integer,p_version bigint,p_client_version bigint,p_profile jsonb) returns jsonb language sql as $$
 select public.update_intake_profile('a0500000-0000-4000-8000-000000000001','a0600000-0000-4000-8000-000000000001',
 ('aa200000-0000-4000-8000-'||lpad(p_n::text,12,'0'))::uuid,(current_setting('test.manual_receipt')::jsonb->>'clientId')::uuid,
 p_version,p_client_version,p_profile);
$$;
-- Synthetic parser output reproduces selector shape, not any real case value.
create function pg_temp.intake_field(p_id text,p_section text,p_label text,p_value text) returns jsonb language sql as $$
 select jsonb_build_object('id',p_id,'mappingVersion','central-care-plan-html@1','mappingState','mapped',
  'targetPath','central.'||lower(p_section)||'.synthetic','mappingKey',p_section||chr(31)||p_label||chr(31)||p_section||'/table.table.table-bordered/tbody/tr',
  'source',jsonb_build_object('sectionCode',p_section,'sectionTitle','合成區段','label',p_label,'parentPath',p_section||'/table.table.table-bordered/tbody/tr','controlName',null),
  'normalizedValue',p_value,'rawValue',p_value,'warnings','[]'::jsonb,'sensitive',true);
$$;
create function pg_temp.intake_payload(p_name text default '合成中央甲',p_identity text default 'B123456780') returns jsonb language sql as $$
 select jsonb_build_object('mappingVersion','central-care-plan-html@1','contentFingerprint',repeat('b',64),
  'sections',jsonb_build_array(jsonb_build_object('id','s1','code','CLIENT_BASIC','title','合成區段')),
  'fields',jsonb_build_array(pg_temp.intake_field('f1','CLIENT_BASIC','個案姓名 傳統姓名',p_name),
   pg_temp.intake_field('f2','CLIENT_BASIC','個案身分證',p_identity),pg_temp.intake_field('f3','CLIENT_BASIC','個案生日','034/01/02'),
   pg_temp.intake_field('f4','CARE_PLAN','CMS等級 ※ 此計畫已計算0次','第5級'),
   pg_temp.intake_field('f5','CLIENT_BASIC','性別','男'),pg_temp.intake_field('f6','CLIENT_BASIC','個案電話',''),
   pg_temp.intake_field('unknown','CUSTOM','保留未映射欄位','合成未知欄位完整保留')),
  'warnings','[]'::jsonb,'conflicts','[]'::jsonb,'security',jsonb_build_object('parser','cheerio-static','externalRequestCount',0));
$$;
create function pg_temp.stage_intake_source(p_n integer,p_payload jsonb) returns jsonb language plpgsql security invoker as $$
declare r jsonb; result jsonb;
begin
 r:=public.reserve_import_upload('a0500000-0000-4000-8000-000000000001','a0600000-0000-4000-8000-000000000001',
  ('aa300000-0000-4000-8000-'||lpad(p_n::text,12,'0'))::uuid,lpad(p_n::text,64,'0'),'synthetic.html','text/html',128,'central-care-plan-html@1');
 result:=public.complete_import_upload((r->>'reservation_id')::uuid,p_payload::text,jsonb_build_object(
  'key','organizations/'||(r->>'organization_id')||'/branches/'||(r->>'branch_id')||'/central-html/'||(r->>'file_sha256')||'/'||(r->>'reservation_id')||'.html',
  'versionId','synthetic-s3-version','sha256',r->>'file_sha256','byteLength',128,'createdAt',r->>'created_at',
  'retainUntil',((r->>'created_at')::timestamptz+interval '7 years')));
 return result;
end;
$$;
select set_config('test.intake_decisions','[{"fieldId":"f1","target":"displayName","choice":"use_source"},{"fieldId":"f2","target":"identityNumber","choice":"use_source"},{"fieldId":"f3","target":"dateOfBirth","choice":"use_source"},{"fieldId":"f4","target":"cmsLevel","choice":"use_source"},{"fieldId":"f5","target":"sex","choice":"use_source"},{"fieldId":"f6","target":"phone","choice":"keep_current"}]',true);
create function pg_temp.commit_intake(p_n integer default 1,p_decisions jsonb default null,p_source jsonb default null,
 p_client uuid default null,p_version bigint default null,p_client_version bigint default null,p_code text default 'SYNTHETIC-CMS-1') returns jsonb language sql as $$
 select public.commit_cms_intake('a0500000-0000-4000-8000-000000000001','a0600000-0000-4000-8000-000000000001',
  ('aa400000-0000-4000-8000-'||lpad(p_n::text,12,'0'))::uuid,(source->>'reservation_id')::uuid,source->>'payload_sha256',
  p_client,p_version,p_client_version,p_code,coalesce(p_decisions,current_setting('test.intake_decisions')::jsonb),
  case when p_client is not null then '合成已核對中央來源評估日期與現行版本' else null end)
 from (select coalesce(p_source,current_setting('test.intake_source')::jsonb) source) s;
$$;

select ok((select bool_and(relrowsecurity and relforcerowsecurity) from pg_class where oid in
 ('private.client_intake_versions'::regclass,'private.client_intake_identities'::regclass,'private.client_intake_operations'::regclass)),
 'all private intake tables force RLS');
select ok(not has_table_privilege('authenticated','private.client_intake_versions','select') and
 not has_table_privilege('service_role','private.client_intake_versions','insert'),'no direct profile API grants');
select ok(not has_function_privilege('anon','public.create_intake_client(uuid,uuid,uuid,jsonb)','execute') and
 not has_function_privilege('service_role','public.commit_cms_intake(uuid,uuid,uuid,uuid,text,uuid,bigint,bigint,text,jsonb,text)','execute'),
 'anonymous and service role cannot promote an intake');
select ok((select bool_and(not prosecdef) from pg_proc where oid in
 ('public.create_intake_client(uuid,uuid,uuid,jsonb)'::regprocedure,'public.commit_cms_intake(uuid,uuid,uuid,uuid,text,uuid,bigint,bigint,text,jsonb,text)'::regprocedure)),
 'public wrappers remain invoker');
select ok((select bool_and(proconfig @> array['search_path=""']) from pg_proc where oid in
 ('private.write_intake_profile(uuid,uuid,uuid,uuid,bigint,bigint,jsonb)'::regprocedure,'private.commit_cms_intake(uuid,uuid,uuid,uuid,text,uuid,bigint,bigint,text,jsonb,text)'::regprocedure)),
 'definers pin empty search path');
set local role anon;
select throws_ok($$select pg_temp.create_intake()$$,'42501',null,'anonymous RPC denied');
reset role;
set local role authenticated;
select pg_temp.intake_login('aal1');
select set_config('request.jwt.claims',jsonb_set(auth.jwt(),'{amr}','[{"method":"password","timestamp":0}]')::text,true);
select throws_ok($$select pg_temp.create_intake()$$,'42501',null,'AAL1 without a verified Google session denied');
select pg_temp.intake_login();
select is(public.is_executive_login_allowed(),true,'synthetic actor passes real admission gate');
select throws_ok($$select pg_temp.create_intake(1,null,'a0600000-0000-4000-8000-000000000002')$$,'42501',null,'wrong branch denied');
select throws_ok($$select pg_temp.create_intake(1,current_setting('test.intake_profile')::jsonb||'{"source_system":"central_cms"}')$$,'22023',null,'browser cannot inject source provenance');
select throws_ok($$select pg_temp.create_intake(1,current_setting('test.intake_profile')::jsonb||'{"dateOfBirth":"2025-02-30"}')$$,'22023',null,'impossible calendar dates denied');
select throws_ok($$select pg_temp.create_intake(1,current_setting('test.intake_profile')::jsonb||'{"cmsLevel":9}')$$,'22023',null,'out of range CMS level denied');
select throws_ok($$select pg_temp.create_intake(1,current_setting('test.intake_profile')::jsonb||'{"consent":{"status":"confirmed","confirmedOn":null}}')$$,'22023',null,'consent confirmation requires date');
select throws_ok($$select public.update_intake_profile('a0500000-0000-4000-8000-000000000001','a0600000-0000-4000-8000-000000000001',
 'aa999999-0000-4000-8000-000000000002',null,0,0,current_setting('test.intake_profile')::jsonb)$$,
 '22023','INTAKE_CLIENT_REQUIRED','missing update client never silently creates a case');
select set_config('test.manual_receipt',pg_temp.create_intake()::text,true);
select is((current_setting('test.manual_receipt')::jsonb->>'pending')::boolean,true,'manual case created pending admission');
select is(pg_temp.create_intake()->>'clientId',current_setting('test.manual_receipt')::jsonb->>'clientId','duplicate operation returns same client');
select is((pg_temp.create_intake()->>'replayed')::boolean,true,'repeat returns replay flag');
select throws_ok($$select pg_temp.create_intake(1,current_setting('test.intake_profile')::jsonb||'{"displayName":"合成異動"}')$$,'23505',null,'same key changed data denied');
select throws_ok($$select pg_temp.create_intake(2,current_setting('test.intake_profile')::jsonb||'{"clientCode":"SYNTHETIC-DUPLICATE"}')$$,'23505',null,'exact identity prevents second manual case');
select is(pg_temp.read_intake()->'profile'->>'registeredAddress','合成戶籍地址','address persists through authenticated snapshot');
select is(pg_temp.read_intake()->'profile'->'contacts'->0->>'name','合成關係人','contact relationship persists');
select throws_ok($$select public.client_intake_snapshot('a0500000-0000-4000-8000-000000000001','a0600000-0000-4000-8000-000000000002',(current_setting('test.manual_receipt')::jsonb->>'clientId')::uuid)$$,'42501',null,'snapshot scope mismatch denied');
select throws_ok($$select pg_temp.update_intake(1,0,1,pg_temp.read_intake()->'profile'||'{"notes":"合成更新"}')$$,'40001',null,'profile base version conflict denied');
select set_config('test.manual_updated',pg_temp.update_intake(1,1,1,pg_temp.read_intake()->'profile'||'{"notes":"合成更新"}')::text,true);
select is((current_setting('test.manual_updated')::jsonb->>'profileVersion')::integer,2,'profile updates append a new version');
select is(pg_temp.read_intake()->'profile'->>'notes','合成更新','new profile read is current');
select throws_ok($$select pg_temp.update_intake(2,2,2,pg_temp.read_intake()->'profile'||'{"identityNumber":"A999999999"}')$$,'42501',null,'stored exact identity cannot be edited away');
select throws_ok($$select public.update_local_client('a0500000-0000-4000-8000-000000000001','a0600000-0000-4000-8000-000000000001',
 (current_setting('test.manual_receipt')::jsonb->>'clientId')::uuid,'SYNTHETIC-INTAKE-1','合成旁路修改','1945-01-02',2,'aa999999-0000-4000-8000-000000000001')$$,
 '42501','INTAKE_USE_PROFILE_WORKFLOW','legacy scalar editor cannot bypass profile history');
reset role;
select is((select count(*)::integer from private.client_intake_versions),2,'history retained after update');
select is((select count(*)::integer from public.clients where organization_id='a0500000-0000-4000-8000-000000000001' and admitted_on is not null),0,'intake never activates admission');
select throws_ok($$update private.client_intake_versions set profile='{}'$$,'55000',null,'profile history immutable');
select throws_ok($$delete from private.client_intake_operations$$,'55000',null,'operation history immutable');
select ok(not exists(select 1 from public.audit_events where table_name like 'private.client_intake_%'
 and (metadata::text like '%合成戶籍地址%' or metadata::text like '%A123456789%' or metadata::text like '%合成關係人%')),
 'audit never includes profile values');
delete from public.role_permissions where role_id='10000000-0000-4000-8000-000000000002'
 and permission_id=(select id from public.permissions where permission_key='clients.demographics.read');
set local role authenticated;
select throws_ok($$select pg_temp.read_intake()$$,'42501',null,'demographic field permission is required');
reset role;
insert into public.role_permissions(role_id,permission_id) select '10000000-0000-4000-8000-000000000002',id from public.permissions where permission_key='clients.demographics.read';

-- Fault after client insert proves profiles, identities, operation and audit
-- changes roll back together, without touching a previously staged source.
create function pg_temp.fail_intake() returns trigger language plpgsql as $$
begin raise exception using errcode='P0001',message='synthetic intake fault'; end; $$;
create trigger zz_intake_fault after insert on private.client_intake_versions for each row execute function pg_temp.fail_intake();
set local role authenticated;
select throws_ok($$select pg_temp.create_intake(3,current_setting('test.intake_profile')::jsonb||'{"clientCode":"SYNTHETIC-FAIL","identityNumber":"C123456781"}')$$,
 'P0001','synthetic intake fault','manual write fault is atomic');
reset role;
select is((select count(*)::integer from public.clients where organization_id='a0500000-0000-4000-8000-000000000001'),1,'manual failure created zero extra clients');
select is((select count(*)::integer from private.client_intake_identities),1,'manual failure created zero extra identities');
drop trigger zz_intake_fault on private.client_intake_versions;

select set_config('test.intake_source',pg_temp.stage_intake_source(1,pg_temp.intake_payload())::text,true);
select set_config('test.intake_source_two',pg_temp.stage_intake_source(2,pg_temp.intake_payload('合成中央更正甲'))::text,true);
set local role authenticated;
select throws_ok($$select public.complete_import_upload((current_setting('test.intake_source')::jsonb->>'reservation_id')::uuid,'{}','{}')$$,
 '42501',null,'browser cannot forge trusted payload');
select set_config('test.intake_preview',public.cms_intake_preview('a0500000-0000-4000-8000-000000000001',
 'a0600000-0000-4000-8000-000000000001',(current_setting('test.intake_source')::jsonb->>'reservation_id')::uuid,null)::text,true);
select is(jsonb_array_length(current_setting('test.intake_preview')::jsonb->'fields'),7,'preview retains every source including unknown');
select is(current_setting('test.intake_preview')::jsonb->'fields'->0->>'intakeTarget','displayName','exact sample name selector recognized');
select is(current_setting('test.intake_preview')::jsonb->'fields'->6->>'intakeTarget',null,'unknown field never guessed into profile');
select is(current_setting('test.intake_preview')::jsonb->'fields'->2->>'intakeValue','1945-01-02','preview shows normalized ROC date before commit');
select is(current_setting('test.intake_preview')::jsonb->'fields'->5->>'intakeWarning','INTAKE_SOURCE_VALUE_INVALID','empty optional source warning visible before commit');
select throws_ok($$select pg_temp.commit_intake(1,null,current_setting('test.intake_source')::jsonb||jsonb_build_object('payload_sha256',repeat('f',64)))$$,
 '40001',null,'stale payload hash denied');
select throws_ok($$select pg_temp.commit_intake(1,jsonb_set(current_setting('test.intake_decisions')::jsonb,'{0,fieldId}','"missing"'))$$,
 '22023',null,'unknown field id denied');
select throws_ok($$select pg_temp.commit_intake(1,jsonb_set(current_setting('test.intake_decisions')::jsonb,'{0,target}','"identityNumber"'))$$,
 '22023',null,'source label cannot be relabeled as another target');
select throws_ok($$select pg_temp.commit_intake(1,jsonb_set(current_setting('test.intake_decisions')::jsonb,'{0,value}','"browser forgery"'))$$,
 '22023',null,'browser field-value injection denied');
select throws_ok($$select pg_temp.commit_intake(1,current_setting('test.intake_decisions')::jsonb-4)$$,
 '22023',null,'every recognized target requires an explicit decision');
reset role;
create trigger zz_intake_fault after insert on private.client_intake_versions for each row execute function pg_temp.fail_intake();
set local role authenticated;
select throws_ok($$select pg_temp.commit_intake()$$,'P0001','synthetic intake fault','CMS promotion fault rolls back atomically');
reset role;
select is((select count(*)::integer from public.clients where organization_id='a0500000-0000-4000-8000-000000000001'),1,'failed CMS commit left zero new clients');
select is((select count(*)::integer from private.import_upload_completions),2,'durable source staging survives failed commit');
drop trigger zz_intake_fault on private.client_intake_versions;
set local role authenticated;
select set_config('test.cms_receipt',pg_temp.commit_intake()::text,true);
select is((current_setting('test.cms_receipt')::jsonb->>'formallyImported')::boolean,true,'real CMS transaction reports formal import');
select is((current_setting('test.cms_receipt')::jsonb->>'pending')::boolean,true,'CMS client still pending admission');
select is((pg_temp.commit_intake()->>'replayed')::boolean,true,'CMS retry idempotent');
select throws_ok($$select pg_temp.commit_intake(2)$$,'23505',null,'same staged file cannot create second import');
select is(pg_temp.read_intake((current_setting('test.cms_receipt')::jsonb->>'clientId')::uuid)->'profile'->>'dateOfBirth','1945-01-02',
 'ROC date normalized using real calendar validation');
select is(pg_temp.read_intake((current_setting('test.cms_receipt')::jsonb->>'clientId')::uuid)->'profile'->>'cmsLevel','5',
 'CMS level normalized independently from centre assessment');
select is(pg_temp.read_intake((current_setting('test.cms_receipt')::jsonb->>'clientId')::uuid)->'profile'->>'phone',null,
 'explicitly skipped empty source becomes missing not invented');
select throws_ok($$select public.commit_cms_intake('a0500000-0000-4000-8000-000000000001','a0600000-0000-4000-8000-000000000001',
 'aa400000-0000-4000-8000-000000000098',(current_setting('test.intake_source_two')::jsonb->>'reservation_id')::uuid,
 current_setting('test.intake_source_two')::jsonb->>'payload_sha256',(current_setting('test.cms_receipt')::jsonb->>'clientId')::uuid,1,1,
 'SYNTHETIC-CMS-1',current_setting('test.intake_decisions')::jsonb)$$,'22023','INTAKE_SOURCE_CHRONOLOGY_REVIEW_REQUIRED',
 'unknown source chronology cannot be auto-treated as newer by upload time');
select throws_ok($$select public.update_intake_profile('a0500000-0000-4000-8000-000000000001','a0600000-0000-4000-8000-000000000001',
 'aa200000-0000-4000-8000-000000000099',(current_setting('test.cms_receipt')::jsonb->>'clientId')::uuid,1,1,
 pg_temp.read_intake((current_setting('test.cms_receipt')::jsonb->>'clientId')::uuid)->'profile'||'{"cmsLevel":8}')$$,
 '42501',null,'local profile cannot overwrite central official level');
select throws_ok($$select pg_temp.commit_intake(3,null,current_setting('test.intake_source_two')::jsonb,
 (current_setting('test.manual_receipt')::jsonb->>'clientId')::uuid,2,2,'SYNTHETIC-INTAKE-1')$$,'42501',null,
 'same source cannot be merged into another exact identity');
select throws_ok($$select pg_temp.commit_intake(3,null,current_setting('test.intake_source_two')::jsonb,null,null,null,'SYNTHETIC-CMS-DUP')$$,
 '23505',null,'new source with same identity requires explicit existing-client selection');
select set_config('test.cms_updated',pg_temp.commit_intake(3,null,current_setting('test.intake_source_two')::jsonb,
 (current_setting('test.cms_receipt')::jsonb->>'clientId')::uuid,1,1)::text,true);
select is((current_setting('test.cms_updated')::jsonb->>'profileVersion')::integer,2,'reviewed central update appends profile version');
select is(pg_temp.read_intake((current_setting('test.cms_receipt')::jsonb->>'clientId')::uuid)->'profile'->>'displayName','合成中央更正甲',
 'reviewed source field updates formal basic profile');
reset role;
select is((select count(*)::integer from public.client_transitions),0,'intake does not create admission or lifecycle decisions');
select is((select count(*)::integer from public.care_records),0,'intake does not create or overwrite clinical records');
select ok(exists(select 1 from private.import_upload_completions where parsed_payload::text like '%合成未知欄位完整保留%'),
 'unknown source data remains immutable and retained after promotion');
select ok(not exists(select 1 from public.audit_events where table_name like 'private.client_intake_%'
 and (metadata::text like '%B123456780%' or metadata::text like '%合成中央甲%')),'promotion audit remains free of PII');

-- A conflicting name candidate requires a chosen immutable field id. A same
-- name with another exact identity creates a separate person, never a merge.
select set_config('test.conflict_payload',(pg_temp.intake_payload('合成中央更正甲','D123456789')||jsonb_build_object('fields',
 (pg_temp.intake_payload('合成中央更正甲','D123456789')->'fields')||jsonb_build_array(
   pg_temp.intake_field('f1-alternate','CLIENT_BASIC','個案姓名 傳統姓名','合成另一個來源姓名')||'{"mappingState":"conflict"}'),
 'conflicts',jsonb_build_array(jsonb_build_object('id','conflict1','mappingKey','synthetic conflict','candidates',jsonb_build_array(
   jsonb_build_object('fieldId','f1','value','合成中央更正甲'),jsonb_build_object('fieldId','f1-alternate','value','合成另一個來源姓名'))))))::text,true);
select set_config('test.intake_conflict_source',pg_temp.stage_intake_source(3,current_setting('test.conflict_payload')::jsonb)::text,true);
set local role authenticated;
select set_config('test.conflict_receipt',pg_temp.commit_intake(4,null,current_setting('test.intake_conflict_source')::jsonb,null,null,null,'SYNTHETIC-CMS-3')::text,true);
select ok(current_setting('test.conflict_receipt')::jsonb->>'clientId'<>current_setting('test.cms_receipt')::jsonb->>'clientId',
 'same name distinct identity creates a different client');
select is(pg_temp.read_intake((current_setting('test.conflict_receipt')::jsonb->>'clientId')::uuid)->'profile'->>'displayName','合成中央更正甲',
 'chosen field id resolves a name conflict without overwriting the source');
reset role;
select set_config('test.official_new',pg_temp.stage_intake_source(4,pg_temp.intake_payload('合成官方較新甲')||jsonb_build_object('fields',
 (pg_temp.intake_payload('合成官方較新甲')->'fields')||jsonb_build_array(pg_temp.intake_field('official-date','CARE_PLAN','核定日期','2026-08-01'))))::text,true);
select set_config('test.official_old',pg_temp.stage_intake_source(5,pg_temp.intake_payload('合成官方較舊甲')||jsonb_build_object('fields',
 (pg_temp.intake_payload('合成官方較舊甲')->'fields')||jsonb_build_array(pg_temp.intake_field('official-date','CARE_PLAN','核定日期','2026-07-01'))))::text,true);
set local role authenticated;
select set_config('test.official_receipt',pg_temp.commit_intake(5,null,current_setting('test.official_new')::jsonb,
 (current_setting('test.cms_receipt')::jsonb->>'clientId')::uuid,2,2)::text,true);
select is((current_setting('test.official_receipt')::jsonb->>'profileVersion')::integer,3,'new official source version is append-only');
select set_config('test.old_preview',public.cms_intake_preview('a0500000-0000-4000-8000-000000000001','a0600000-0000-4000-8000-000000000001',
 (current_setting('test.official_old')::jsonb->>'reservation_id')::uuid,(current_setting('test.cms_receipt')::jsonb->>'clientId')::uuid)::text,true);
select is(current_setting('test.old_preview')::jsonb->>'sourceOfficialDate','2026-07-01','source chronology derives only from trusted official date field');
select is((current_setting('test.old_preview')::jsonb->>'sourceIsOlder')::boolean,true,'preview identifies older source independent of upload time');
select throws_ok($$select pg_temp.commit_intake(6,null,current_setting('test.official_old')::jsonb,
 (current_setting('test.cms_receipt')::jsonb->>'clientId')::uuid,3,3)$$,'22023','INTAKE_SOURCE_OLDER_THAN_CURRENT',
 'review note does not allow older official source to overwrite current central values');
select is(pg_temp.read_intake((current_setting('test.cms_receipt')::jsonb->>'clientId')::uuid)->'profile'->>'displayName','合成官方較新甲',
 'failed older source preserves current formal name');
reset role;
select is((select count(*)::integer from private.client_intake_operations where source_batch_id=(current_setting('test.official_old')::jsonb->>'reservation_id')::uuid),0,
 'older source produced no formal operation');
select ok(exists(select 1 from private.client_intake_operations where source_review_reason='合成已核對中央來源評估日期與現行版本'),
 'manual chronology review evidence retained on immutable operation');
select ok(not exists(select 1 from public.audit_events where metadata::text like '%合成已核對中央來源評估日期%'),
 'review reason never copied into generic audit metadata');
select is(private.cms_intake_preview_field(pg_temp.intake_field('conflicted','CLIENT_BASIC','個案姓名 傳統姓名','合成衝突欄位')||'{"mappingState":"conflict"}') ->>'intakeValue',
 '合成衝突欄位','explicitly selected conflict candidates remain convertible and reviewable');
set local role authenticated;
select is(public.find_cms_intake_source('a0500000-0000-4000-8000-000000000001','a0600000-0000-4000-8000-000000000001',repeat('f',64)),
 null::jsonb,'unknown source hash returns null, not fake completion');
select set_config('test.found_source',public.find_cms_intake_source('a0500000-0000-4000-8000-000000000001','a0600000-0000-4000-8000-000000000001',lpad('1',64,'0'))::text,true);
select is(current_setting('test.found_source')::jsonb->>'reservationId',current_setting('test.intake_source')::jsonb->>'reservation_id',
 'hash lookup recovers trusted reservation after browser operation key is lost');
select is(current_setting('test.found_source')::jsonb->>'clientId',current_setting('test.cms_receipt')::jsonb->>'clientId',
 'authorized lookup links previously imported client');
select ok(not current_setting('test.found_source')::jsonb ?| array['fileName','parsedPayload','profile','archiveReference'],
 'hash recovery returns no source content or identity fields');
select throws_ok($$select public.find_cms_intake_source('a0500000-0000-4000-8000-000000000001','a0600000-0000-4000-8000-000000000002',lpad('1',64,'0'))$$,
 '42501',null,'hash lookup cannot probe another branch');
select throws_ok($$select public.find_cms_intake_source('a0500000-0000-4000-8000-000000000001','a0600000-0000-4000-8000-000000000001','not-a-hash')$$,
 '22023',null,'hash lookup validates exact source hash');
select public.reserve_import_upload('a0500000-0000-4000-8000-000000000001','a0600000-0000-4000-8000-000000000001',
 'aa300000-0000-4000-8000-000000000099',lpad('99',64,'0'),'synthetic-queued.html','text/html',128,'central-care-plan-html@1');
select is(public.find_cms_intake_source('a0500000-0000-4000-8000-000000000001','a0600000-0000-4000-8000-000000000001',lpad('99',64,'0'))->>'status',
 'queued','incomplete reservation is never relabeled completed');
reset role;
select ok(not has_function_privilege('anon','public.find_cms_intake_source(uuid,uuid,text)','execute')
 and not has_function_privilege('service_role','private.find_cms_intake_source(uuid,uuid,text)','execute'),
 'hash recovery restricted to authenticated user scope checks');
select is(private.validate_intake_profile(current_setting('test.intake_profile')::jsonb||'{"consent":{"status":"pending"}}')->'consent',
 '{"status":"pending","confirmedOn":null}'::jsonb,'omitted consent date is canonical null for future readback');
select is(private.validate_intake_profile(current_setting('test.intake_profile')::jsonb||'{"consent":{"status":"pending","confirmedOn":""}}')->'consent',
 '{"status":"pending","confirmedOn":null}'::jsonb,'empty nonconfirmed consent date is canonical null');
select is(private.cms_intake_preview_field(pg_temp.intake_field('long-name','CLIENT_BASIC','個案姓名 傳統姓名',repeat('合',121)))->>'intakeWarning',
 'INTAKE_SOURCE_VALUE_INVALID','overlong name is warned at preview before approval');
select is(private.cms_intake_preview_field(pg_temp.intake_field('long-phone','CLIENT_BASIC','個案電話',repeat('1',81)))->>'intakeWarning',
 'INTAKE_SOURCE_VALUE_INVALID','preview phone limit matches formal profile contract');
select set_config('test.multiline_source',pg_temp.stage_intake_source(6,pg_temp.intake_payload('合成多行覆核甲'))::text,true);
set local role authenticated;
select lives_ok($$select public.commit_cms_intake('a0500000-0000-4000-8000-000000000001','a0600000-0000-4000-8000-000000000001',
 'aa400000-0000-4000-8000-000000000007',(current_setting('test.multiline_source')::jsonb->>'reservation_id')::uuid,
 current_setting('test.multiline_source')::jsonb->>'payload_sha256',(current_setting('test.cms_receipt')::jsonb->>'clientId')::uuid,
 3,3,'SYNTHETIC-CMS-1',current_setting('test.intake_decisions')::jsonb,E'合成覆核第一行說明\n合成覆核第二行說明')$$,
 'review evidence accepts ordinary multiline textarea input');
reset role;
select is((select source_review_reason from private.client_intake_operations where source_batch_id=(current_setting('test.multiline_source')::jsonb->>'reservation_id')::uuid),
 E'合成覆核第一行說明\n合成覆核第二行說明','review reason retains the exact submitted multiline evidence');
delete from public.role_permissions where role_id='10000000-0000-4000-8000-000000000002'
 and permission_id=(select id from public.permissions where permission_key='clients.view_all');
set local role authenticated;
select is(public.find_cms_intake_source('a0500000-0000-4000-8000-000000000001','a0600000-0000-4000-8000-000000000001',lpad('1',64,'0'))->>'clientId',
 null,'hash lookup does not disclose a formally linked client outside current assignment');
select throws_ok($$select public.cms_intake_preview('a0500000-0000-4000-8000-000000000001','a0600000-0000-4000-8000-000000000001',
 (current_setting('test.intake_source')::jsonb->>'reservation_id')::uuid,null)$$,'42501','INTAKE_ACCESS_DENIED',
 'omitting target client cannot bypass formally imported source assignment check');
reset role;
select * from finish();
rollback;
