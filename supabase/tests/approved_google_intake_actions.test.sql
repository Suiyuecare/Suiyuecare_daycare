begin;
select plan(70);

-- All identities and records below are synthetic. Exercise the real Google /
-- MFA admission implementation, not a replacement authorization predicate.
select set_config('test.import_amr',floor(extract(epoch from now()-interval '2 minutes'))::text,true);
insert into auth.users(id,aud,role,email,email_confirmed_at,created_at,updated_at) values
 ('a0100000-0000-4000-8000-000000000001','authenticated','authenticated','synthetic-intake@example.invalid',now()-interval '1 day',now()-interval '1 day',now());
insert into auth.identities(id,provider_id,user_id,identity_data,provider) values
 ('a0200000-0000-4000-8000-000000000001','synthetic-intake-google','a0100000-0000-4000-8000-000000000001',
  '{"sub":"synthetic-intake-google","email":"synthetic-intake@example.invalid","email_verified":true}','google');
insert into auth.sessions(id,user_id,created_at,aal) values
 ('a0300000-0000-4000-8000-000000000001','a0100000-0000-4000-8000-000000000001',now()-interval '3 minutes','aal1');
insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method)
select ('a0400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'a0300000-0000-4000-8000-000000000001',
 to_timestamp(current_setting('test.import_amr')::bigint),to_timestamp(current_setting('test.import_amr')::bigint),
 case n when 1 then 'oauth' else 'totp' end from generate_series(1,1) n;
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
create function pg_temp.intake_login(p_aal text default 'aal1') returns void language plpgsql security invoker as $$
begin
 perform set_config('request.jwt.claim.sub','',true);
 perform set_config('request.jwt.claim.role','',true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub','a0100000-0000-4000-8000-000000000001',
  'session_id','a0300000-0000-4000-8000-000000000001','role','authenticated','aud','authenticated','aal',p_aal,
  'is_anonymous',false,'email','synthetic-intake@example.invalid','iat',floor(extract(epoch from clock_timestamp())),
  'exp',floor(extract(epoch from clock_timestamp()+interval '30 minutes')),'amr',jsonb_build_array(
   jsonb_build_object('method','oauth','timestamp',current_setting('test.import_amr')::bigint)))::text,true);
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
 r:=public.reserve_intake_import_upload('a0500000-0000-4000-8000-000000000001','a0600000-0000-4000-8000-000000000001',
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

-- No TOTP claim or reauthentication event exists in this entire fixture.
create function pg_temp.access(p_action text,p_client uuid default null,p_branch uuid default 'a0600000-0000-4000-8000-000000000001') returns boolean language sql as $$
 select public.has_routine_intake_access('a0500000-0000-4000-8000-000000000001',p_branch,p_action,p_client);
$$;
create function pg_temp.manual_id() returns uuid language sql as $$ select (current_setting('test.manual_receipt')::jsonb->>'clientId')::uuid;$$;
create function pg_temp.reserve(p_n integer default 9,p_size integer default 128) returns jsonb language sql as $$
 select public.reserve_intake_import_upload('a0500000-0000-4000-8000-000000000001','a0600000-0000-4000-8000-000000000001',
 ('aa300000-0000-4000-8000-'||lpad(p_n::text,12,'0'))::uuid,lpad(p_n::text,64,'0'),'synthetic.html','text/html',p_size,'central-care-plan-html@1');
$$;
create function pg_temp.complete(p_reservation jsonb,p_retention interval default '7 years') returns jsonb language sql as $$
 select public.complete_import_upload((p_reservation->>'reservation_id')::uuid,pg_temp.intake_payload()::text,jsonb_build_object(
 'key','organizations/'||(p_reservation->>'organization_id')||'/branches/'||(p_reservation->>'branch_id')||'/central-html/'||(p_reservation->>'file_sha256')||'/'||(p_reservation->>'reservation_id')||'.html',
 'versionId','synthetic-version','sha256',p_reservation->>'file_sha256','byteLength',128,'createdAt',p_reservation->>'created_at',
 'retainUntil',((p_reservation->>'created_at')::timestamptz+p_retention)));
$$;
create function pg_temp.weekly_input(p_key uuid default 'aa500000-0000-4000-8000-000000000001') returns jsonb language sql as $$
 select jsonb_build_object('action','save_plan','clientId',pg_temp.manual_id(),'expectedVersion',0,'idempotency_key',p_key,
 'plan',jsonb_build_object('effectiveFrom',(now() at time zone 'Asia/Taipei')::date,'effectiveTo',null,'reason','合成核准週表',
 'days',(select jsonb_agg(jsonb_build_object('weekday',n,'attending',true,'startsAt','09:00','endsAt','16:00','outbound',null,'inbound',null)) from generate_series(1,7)n)));
$$;
create function pg_temp.weekly_save(p_input jsonb default pg_temp.weekly_input()) returns jsonb language sql as $$
 select receipt from public.save_client_weekly('a0500000-0000-4000-8000-000000000001','a0600000-0000-4000-8000-000000000001',p_input);
$$;
update private.executive_access_policy set enabled=false;
select pg_temp.intake_login();
set local role authenticated;
select is(auth.jwt()->>'aal','aal1','fixture is actual AAL1');
select is(public.has_recent_aal2(15),false,'no recent second factor exists');
select is(pg_temp.access('profile.create'),false,'Google identity alone is not approval');
select throws_ok($$select pg_temp.create_intake()$$,'42501',null,'unapproved Google cannot create');
reset role;
update private.executive_access_policy set enabled=true;
set local role authenticated;
select is(pg_temp.access('profile.create'),true,'approved executive Google can create without an authenticator');
select set_config('test.manual_receipt',pg_temp.create_intake()::text,true);
select is(pg_temp.read_intake()->'profile'->>'displayName','合成收案甲','AAL1 profile roundtrip');
select is(pg_temp.create_intake()->>'replayed','true','AAL1 operation replay is idempotent');
select throws_ok($$select pg_temp.create_intake(1,current_setting('test.intake_profile')::jsonb||'{"displayName":"合成改寫"}')$$,'23505',null,'same key changed payload blocked');
select throws_ok($$select pg_temp.create_intake(3,null,'a0600000-0000-4000-8000-000000000002')$$,'42501',null,'same organization cross branch denied');
select is(pg_temp.access('profile.update',pg_temp.manual_id(),'a0600000-0000-4000-8000-000000000003'),false,'cross organization client denied');
select is(pg_temp.access('profile.update'),false,'update requires exact client');
select is(pg_temp.access('profile.create',pg_temp.manual_id()),false,'create cannot masquerade as an update');
select is(pg_temp.access('claims.export',pg_temp.manual_id()),false,'export is not routine intake');
select is(pg_temp.access('medication.administer',pg_temp.manual_id()),false,'medication is not routine intake');
select is(pg_temp.access('roles.manage',pg_temp.manual_id()),false,'permission expansion is not routine intake');
select is(pg_temp.access('abcd.export',pg_temp.manual_id()),false,'ABCD export keeps high risk boundary');
select is(private.has_permission('a0500000-0000-4000-8000-000000000001','a0600000-0000-4000-8000-000000000001','clients.manage'),false,'global permission root is not weakened');
select is(public.has_routine_care_access('a0500000-0000-4000-8000-000000000001','a0600000-0000-4000-8000-000000000001','imports.approve'),false,'existing routine care does not gain import approval');
select is(jsonb_array_length(public.intake_client_directory('a0500000-0000-4000-8000-000000000001','a0600000-0000-4000-8000-000000000001')),1,'intake directory works at true AAL1');
select is((select count(*)::integer from jsonb_object_keys(public.intake_client_directory('a0500000-0000-4000-8000-000000000001','a0600000-0000-4000-8000-000000000001')->0)),3,'directory has only id name and code');
select set_config('test.manual_updated',pg_temp.update_intake(1,1,1,pg_temp.read_intake()->'profile'||'{"notes":"合成一般收案更新"}')::text,true);
select is(current_setting('test.manual_updated')::jsonb->>'profileVersion','2','ordinary update appends version');
select throws_ok($$select pg_temp.update_intake(2,1,1,pg_temp.read_intake()->'profile')$$,'40001',null,'stale versions fail closed');
select throws_ok($$select public.reserve_import_upload('a0500000-0000-4000-8000-000000000001','a0600000-0000-4000-8000-000000000001',gen_random_uuid(),repeat('a',64),'synthetic.html','text/html',128,'central-care-plan-html@1')$$,'42501',null,'generic import route still needs recent AAL2');
select is(pg_temp.reserve()->>'status','queued','dedicated single-case staging permits approved Google');
select set_config('test.pending_reservation',pg_temp.reserve()::text,true);
select is(pg_temp.reserve()->>'replayed','true','staging reservation replay safe');
select throws_ok($$select pg_temp.reserve(9,129)$$,'22023','IMPORT_STAGING_IDEMPOTENCY_CONFLICT','same reservation key changed size denied');
select throws_ok($$select pg_temp.reserve(10,4194305)$$,'22023',null,'routine single-file cap enforced in SQL');
select throws_ok($$select pg_temp.complete(current_setting('test.pending_reservation')::jsonb)$$,'42501',null,'user cannot impersonate trusted completion worker');
reset role;
select is((select count(*)::integer from private.reauth_events),0,'no fake reauth events inserted');
select ok((select bool_and(reauth_challenge_id is null and auth_context->>'assuranceLevel'='aal1' and auth_context->>'sessionId'='a0300000-0000-4000-8000-000000000001') from private.client_intake_operations),'profile evidence retains true session and AAL1');
select ok((select bool_and(reauth_challenge_id is null and auth_context->>'action'='cms.stage' and authorization_claims->>'aal'='aal1') from private.import_upload_reservations),'staging retains actual Google claims, not synthetic MFA');
set local role service_role;
select throws_ok($$select pg_temp.complete(current_setting('test.pending_reservation')::jsonb,'1 year')$$,'22023',null,'short retention cannot be promoted');
select set_config('test.intake_source',pg_temp.complete(current_setting('test.pending_reservation')::jsonb)::text,true);
reset role;
select is((select count(*)::integer from public.clients where organization_id='a0500000-0000-4000-8000-000000000001'),1,'staging does not silently create clients');
set local role authenticated;
select is((public.cms_intake_preview('a0500000-0000-4000-8000-000000000001','a0600000-0000-4000-8000-000000000001',(current_setting('test.intake_source')::jsonb->>'reservation_id')::uuid,null)->>'batchId'),current_setting('test.intake_source')::jsonb->>'reservation_id','AAL1 preview binds source batch');
select throws_ok($$select pg_temp.commit_intake(1,'[]')$$,'22023',null,'incomplete decisions cannot commit');
reset role;
select is((select count(*)::integer from public.clients where organization_id='a0500000-0000-4000-8000-000000000001'),1,'failed commit changes zero formal clients');
set local role authenticated;
select set_config('test.cms_receipt',pg_temp.commit_intake()::text,true);
select is(current_setting('test.cms_receipt')::jsonb->>'formallyImported','true','AAL1 source approved and atomically imported');
select is(pg_temp.commit_intake()->>'replayed','true','CMS replay does not duplicate case');
select is(pg_temp.weekly_save()->>'version','1','weekly intended attendance is writable at AAL1');
select is(pg_temp.weekly_save()->>'replayed','true','weekly replay stays idempotent');
select throws_ok($$select pg_temp.weekly_save(jsonb_set(pg_temp.weekly_input(),'{plan,reason}','"合成不同依據"'))$$,'23505',null,'weekly same-key payload mismatch denied');
select is((select payload->>'version' from public.client_weekly_snapshot('a0500000-0000-4000-8000-000000000001','a0600000-0000-4000-8000-000000000001',pg_temp.manual_id(),(now() at time zone 'Asia/Taipei')::date)),'1','weekly AAL1 read uses same version');
reset role;
select is((select count(*)::integer from private.client_weekly_versions where auth_context->>'assuranceLevel'='aal1'),1,'weekly intent has truthful Google evidence');
select is((select count(*)::integer from public.attendance_records where client_id=pg_temp.manual_id()),0,'weekly intent is not attendance evidence');
select throws_ok($$update private.client_weekly_versions set version=99$$,'55000',null,'existing append-only history remains protected');
select is((select count(*)::integer from public.clients where organization_id='a0500000-0000-4000-8000-000000000001'),2,'one manual and one CMS client, no duplicates');

-- Independently approved ordinary staff use the same checks without CEO status.
update private.executive_access_policy set enabled=false;
insert into private.staff_google_access_grants(allowed_user_id,organization_id,company_email_domain,allowed_email,google_subject,enabled,approval_reference)
values('a0100000-0000-4000-8000-000000000001','a0500000-0000-4000-8000-000000000001','example.invalid','synthetic-intake@example.invalid','synthetic-intake-google',true,'synthetic explicit approval');
set local role authenticated;
select is(pg_temp.access('profile.update',pg_temp.manual_id()),true,'individually approved non-CEO Google has administrative action access');
select is(pg_temp.read_intake()->>'profileVersion','2','non-CEO AAL1 profile readable');
select is(pg_temp.access('abcd.save',pg_temp.manual_id()),true,'ABCD draft action is available to authorized role');
reset role;
delete from public.role_permissions where role_id='10000000-0000-4000-8000-000000000002' and permission_id=(select id from public.permissions where permission_key='clients.demographics.read');
set local role authenticated;
select is(pg_temp.access('profile.update',pg_temp.manual_id()),false,'removed demographic field permission denies update');
select throws_ok($$select pg_temp.read_intake()$$,'42501',null,'removed demographic permission denies read');
select throws_ok($$select pg_temp.create_intake()$$,'42501',null,'replay rechecks revoked field permission');
select throws_ok($$select public.intake_client_directory('a0500000-0000-4000-8000-000000000001','a0600000-0000-4000-8000-000000000001')$$,'42501',null,'names directory also protects demographic scope');
reset role;
insert into public.role_permissions(role_id,permission_id) select '10000000-0000-4000-8000-000000000002',id from public.permissions where permission_key='clients.demographics.read';
delete from public.role_permissions where role_id='10000000-0000-4000-8000-000000000002' and permission_id=(select id from public.permissions where permission_key='clients.view_all');
set local role authenticated;
select is(pg_temp.access('profile.create'),false,'assigned-only staff cannot create unassigned cases');
select is(pg_temp.access('profile.update',pg_temp.manual_id()),false,'case assignment required without view-all');
select is(jsonb_array_length(public.intake_client_directory('a0500000-0000-4000-8000-000000000001','a0600000-0000-4000-8000-000000000001')),0,'directory removes unassigned names');
reset role;
insert into public.client_assignments(organization_id,branch_id,client_id,assignee_user_id,assignment_kind,starts_at)
values('a0500000-0000-4000-8000-000000000001','a0600000-0000-4000-8000-000000000001',pg_temp.manual_id(),'a0100000-0000-4000-8000-000000000001','primary',now()-interval '1 hour');
set local role authenticated;
select is(pg_temp.access('profile.update',pg_temp.manual_id()),true,'assigned staff can update their assigned case');
select is(pg_temp.access('profile.update',(current_setting('test.cms_receipt')::jsonb->>'clientId')::uuid),false,'assigned staff cannot read another same-branch case');
select is(pg_temp.access('cms.stage'),false,'unknown new CMS cannot be staged with assigned-only access');
reset role;
insert into public.role_permissions(role_id,permission_id) select '10000000-0000-4000-8000-000000000002',id from public.permissions where permission_key='clients.view_all';
set local role authenticated;
select set_config('test.later_reservation',pg_temp.reserve(11)::text,true);
reset role;
update private.staff_google_access_grants set enabled=false;
set local role authenticated;
select is(pg_temp.access('weekly.write',pg_temp.manual_id()),false,'revoked Google approval stops weekly actions immediately');
select throws_ok($$select pg_temp.weekly_save()$$,'42501',null,'revoked approval cannot replay weekly writes');
select throws_ok($$select pg_temp.reserve(11)$$,'42501',null,'revoked approval cannot replay staging');
reset role;
set local role service_role;
select throws_ok($$select pg_temp.complete(current_setting('test.later_reservation')::jsonb)$$,'42501',null,'worker rechecks revocation before completing reserved upload');
reset role;
update private.staff_google_access_grants set enabled=true;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_set(auth.jwt(),'{amr}','[{"method":"password","timestamp":0}]')::text,true);
select is(pg_temp.access('profile.create'),false,'linked Google identity cannot turn password into OAuth');
select pg_temp.intake_login();
reset role;
update auth.sessions set not_after=clock_timestamp()-interval '1 minute';
set local role authenticated;
select is(pg_temp.access('profile.create'),false,'expired actual Auth session denies action');
reset role;
update auth.sessions set not_after=null;
update public.memberships set status='suspended' where id='a0700000-0000-4000-8000-000000000001';
set local role authenticated;
select is(pg_temp.access('profile.create'),false,'suspended membership denies ordinary intake');
reset role;
select ok(not has_table_privilege('authenticated','private.client_intake_operations','insert,update,delete'),'no direct client evidence forgery');
select ok(not has_function_privilege('authenticated','private.routine_intake_auth_evidence(uuid,uuid,text,uuid)','execute'),'raw auth-evidence helper not caller executable');
select ok(not has_function_privilege('anon','public.reserve_intake_import_upload(uuid,uuid,uuid,text,text,text,integer,text)','execute'),'anonymous cannot reserve CMS');
select ok(not exists(select 1 from public.audit_events where table_name='intake_client_directory' and metadata::text like '%合成%'),'directory audit contains counts not case names');
select * from finish();
rollback;
