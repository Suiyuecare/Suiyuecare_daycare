begin;
select plan(110);

-- Full production migration, without the legacy PGlite admission override.
-- No real account, provider subject, token, password, or family data is used.
select set_config('test.executive_amr_at', floor(extract(epoch from clock_timestamp()-interval '2 minutes'))::text, true);
insert into auth.users(id,aud,role,email,email_confirmed_at,created_at,updated_at) values
 ('90100000-0000-4000-8000-000000000001','authenticated','authenticated','executive@example.invalid',now()-interval '1 day',now()-interval '1 day',now()),
 ('90100000-0000-4000-8000-000000000002','authenticated','authenticated','other@example.invalid',now()-interval '1 day',now()-interval '1 day',now());
insert into auth.identities(id,provider_id,user_id,identity_data,provider) values
 ('90200000-0000-4000-8000-000000000001','synthetic-google-executive','90100000-0000-4000-8000-000000000001','{"sub":"synthetic-google-executive","email":"executive@example.invalid","email_verified":true}','google'),
 ('90200000-0000-4000-8000-000000000002','synthetic-google-other','90100000-0000-4000-8000-000000000002','{"sub":"synthetic-google-other","email":"other@example.invalid","email_verified":true}','google'),
 ('90200000-0000-4000-8000-000000000003','executive@example.invalid','90100000-0000-4000-8000-000000000001','{"email":"executive@example.invalid","email_verified":true}','email');
insert into auth.sessions(id,user_id,created_at,aal) values
 ('90300000-0000-4000-8000-000000000001','90100000-0000-4000-8000-000000000001',now()-interval '3 minutes','aal2'),
 ('90300000-0000-4000-8000-000000000002','90100000-0000-4000-8000-000000000002',now()-interval '3 minutes','aal2');
insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method)
select ('90400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 (case when n<=2 then '90300000-0000-4000-8000-000000000001' else '90300000-0000-4000-8000-000000000002' end)::uuid,
 to_timestamp(current_setting('test.executive_amr_at')::bigint),to_timestamp(current_setting('test.executive_amr_at')::bigint),
 case when n%2=1 then 'oauth' else 'totp' end from generate_series(1,4) n;
insert into public.organizations(id,code,name) values
 ('90500000-0000-4000-8000-000000000001','executive_gate_test','合成驗證機構'),
 ('90500000-0000-4000-8000-000000000002','executive_gate_other','合成其他機構');
insert into public.branches(id,organization_id,code,name) values
 ('90600000-0000-4000-8000-000000000001','90500000-0000-4000-8000-000000000001','main','合成分支'),
 ('90600000-0000-4000-8000-000000000002','90500000-0000-4000-8000-000000000002','main','合成其他分支');
insert into public.profiles(id,display_name,kind) values
 ('90100000-0000-4000-8000-000000000001','合成執行長','staff'),
 ('90100000-0000-4000-8000-000000000002','合成其他管理員','staff');
insert into public.memberships(id,organization_id,profile_id,status,starts_at) values
 ('90700000-0000-4000-8000-000000000001','90500000-0000-4000-8000-000000000001','90100000-0000-4000-8000-000000000001','active',now()-interval '1 day'),
 ('90700000-0000-4000-8000-000000000002','90500000-0000-4000-8000-000000000001','90100000-0000-4000-8000-000000000002','active',now()-interval '1 day');
insert into public.membership_roles(membership_id,role_id)
select id,'10000000-0000-4000-8000-000000000002' from public.memberships where organization_id='90500000-0000-4000-8000-000000000001';
insert into public.clients(id,organization_id,branch_id,client_code,display_name,admitted_on) values
 ('90800000-0000-4000-8000-000000000001','90500000-0000-4000-8000-000000000001','90600000-0000-4000-8000-000000000001','SYN-GATE-1','合成個案',current_date-10);

create function pg_temp.executive_check(p_overrides jsonb default '{}', p_aal text default 'aal1')
returns boolean language plpgsql security invoker as $$
declare v_amr jsonb;
begin
 v_amr:=jsonb_build_array(jsonb_build_object('method','oauth','timestamp',current_setting('test.executive_amr_at')::bigint));
 if p_aal='aal2' then v_amr:=v_amr||jsonb_build_array(jsonb_build_object('method','totp','timestamp',current_setting('test.executive_amr_at')::bigint)); end if;
 perform set_config('request.jwt.claims',(jsonb_build_object(
  'sub','90100000-0000-4000-8000-000000000001','session_id','90300000-0000-4000-8000-000000000001',
  'aud','authenticated','role','authenticated','aal',p_aal,'is_anonymous',false,'email','executive@example.invalid',
  'iat',floor(extract(epoch from clock_timestamp())),'exp',floor(extract(epoch from clock_timestamp()+interval '30 minutes')),
  'amr',v_amr)||p_overrides)::text,true);
 return public.is_executive_login_allowed();
end;
$$;

-- Add a same-organization second branch and a foreign source row; no real data.
insert into public.branches(id,organization_id,code,name) values
 ('90600000-0000-4000-8000-000000000003','90500000-0000-4000-8000-000000000001','second','合成第二分支');
insert into public.clients(id,organization_id,branch_id,client_code,display_name,admitted_on) values
 ('90800000-0000-4000-8000-000000000002','90500000-0000-4000-8000-000000000002','90600000-0000-4000-8000-000000000002','SYN-GATE-2','合成他機構個案',current_date-10),
 ('90800000-0000-4000-8000-000000000003','90500000-0000-4000-8000-000000000001','90600000-0000-4000-8000-000000000003','SYN-GATE-3','合成第二分支個案',current_date-10);
insert into public.attendance_records(organization_id,branch_id,client_id,service_date,checked_in_at,idempotency_key,recorded_by)
select organization_id,branch_id,id,current_date,now(),gen_random_uuid(),'90100000-0000-4000-8000-000000000001'
from public.clients where client_code like 'SYN-GATE-%';
insert into public.measurements(organization_id,branch_id,client_id,measurement_kind,measured_at,numeric_value,unit,idempotency_key,recorded_by)
select organization_id,branch_id,id,'temperature',now(),36.5,'Cel',gen_random_uuid(),'90100000-0000-4000-8000-000000000001'
from public.clients where client_code like 'SYN-GATE-%';
insert into public.care_records(organization_id,branch_id,client_id,category,occurred_at,data,created_by)
select organization_id,branch_id,id,'staff/daily-care/care-diary',now(),'{"shift":"morning","care_item":"合成照顧","note":"合成","abnormal":true}',
 '90100000-0000-4000-8000-000000000001' from public.clients where client_code like 'SYN-GATE-%';
insert into public.service_events(organization_id,branch_id,client_id,service_code,started_at,idempotency_key)
select organization_id,branch_id,id,'SYNTHETIC',now(),gen_random_uuid() from public.clients where client_code like 'SYN-GATE-%';

create function pg_temp.directory_count(
 p_org uuid default '90500000-0000-4000-8000-000000000001',
 p_branch uuid default '90600000-0000-4000-8000-000000000001',
 p_purpose public.client_directory_purpose default 'core_daily')
returns integer language sql security invoker as $$
 select count(*)::integer from public.client_directory_snapshot(p_org,p_branch,p_purpose);
$$;

select is((select count(*)::integer from pg_policy where polname like 'executive_reader_%'),12,'only twelve explicitly reviewed table policies added');
select ok(not exists(select 1 from pg_policy where polname like 'executive_reader_%' and polcmd<>'r'),'all new policies are SELECT-only');
select ok((select reloptions @> array['security_invoker=true','security_barrier=true'] from pg_class where oid='public.active_memberships'::regclass),'active_memberships keeps invoker and barrier');
select ok(not has_table_privilege('authenticated','public.clients','select'),'raw client identity table remains unavailable');
select ok(not has_table_privilege('authenticated','auth.users','select') and not has_table_privilege('authenticated','auth.sessions','select')
 and not has_table_privilege('authenticated','auth.identities','select') and not has_table_privilege('authenticated','auth.mfa_amr_claims','select')
 and not has_table_privilege('authenticated','private.executive_access_policy','select'),'no raw Auth metadata or policy grants');
select ok((select bool_and(prosecdef and proconfig @> array['search_path=""'] and pg_get_userbyid(proowner)='postgres') from pg_proc
 where oid in ('private.executive_reader_scope()'::regprocedure,'private.is_active_executive_reader()'::regprocedure,
 'private.has_executive_read_permission(uuid,uuid,text)'::regprocedure,'private.can_executive_read_client(uuid,text)'::regprocedure)),'new private helpers are owner definers with empty search paths');
select ok(not has_function_privilege('anon','private.is_active_executive_reader()','execute')
 and not has_function_privilege('service_role','private.is_active_executive_reader()','execute'),'reader unavailable to anon and service role');

set local role authenticated;
select is(pg_temp.executive_check(),false,'no owner policy fails closed');
select is(private.is_active_executive_reader(),false,'no policy never activates the new reader');
select is((select count(*)::integer from public.active_memberships),0,'no policy cannot read context');
reset role;
insert into private.executive_access_policy(allowed_user_id,allowed_email,google_subject,enabled,approval_reference)
values('90100000-0000-4000-8000-000000000001','executive@example.invalid','synthetic-google-executive',true,'synthetic read policy approval');
set local role authenticated;
select is(pg_temp.executive_check(),true,'pinned AAL1 Google session is admitted');
select is(private.is_active_executive_reader(),true,'active approved executive gains reviewed read access');
select is((select count(*)::integer from public.active_memberships),1,'AAL1 self context is real and available');
select is((select count(*)::integer from public.organizations),1,'only own active organization visible');
select is((select count(*)::integer from public.branches),2,'organization manager sees only active branches in own organization');
select is((select count(*)::integer from public.profiles),1,'context does not reveal other profiles');
select is((select count(*)::integer from public.memberships),1,'context does not reveal another membership');
select is((select count(*)::integer from public.membership_roles),1,'context does not reveal another membership role');
select is((select count(*)::integer from public.roles),1,'AAL1 context only reveals actual assigned roles');
select ok((select scopes @> array['clients.read','attendance.read','health.read','care_records.read','services.read'] from public.active_memberships),'actual scoped permissions load for dashboard sources');
select is(pg_temp.directory_count(),1,'directory returns real admitted client instead of false zero');
select is((select count(*)::integer from public.attendance_records),2,'real attendance source rows are readable without foreign organization');
select is((select count(*)::integer from public.measurements),2,'real measurement source rows are readable without foreign organization');
select is((select count(*)::integer from public.care_records),2,'real diary source rows are readable without foreign organization');
select is((select count(*)::integer from public.service_events),2,'real service source rows are readable without foreign organization');
select is((select numeric_value from public.measurements where client_id='90800000-0000-4000-8000-000000000001'),36.5::numeric,'measurement payload preserved');
select throws_ok($$select pg_temp.directory_count('90500000-0000-4000-8000-000000000002','90600000-0000-4000-8000-000000000002')$$,'42501',null,'foreign organization directory denied');
select throws_ok($$select pg_temp.directory_count('90500000-0000-4000-8000-000000000001','90600000-0000-4000-8000-000000000002')$$,'42501',null,'foreign branch cannot be combined with own organization');
select throws_ok($$select pg_temp.directory_count('90500000-0000-4000-8000-000000000001','90600000-0000-4000-8000-000000000001','offline_sync')$$,'42501',null,'offline_sync purpose still requires original write assurance');
select is(private.has_executive_read_permission('90500000-0000-4000-8000-000000000001','90600000-0000-4000-8000-000000000001','care_records.write'),false,'read helper rejects write permission even when role owns it');
select is(private.has_executive_read_permission('90500000-0000-4000-8000-000000000001','90600000-0000-4000-8000-000000000001','daily_service_summary.export'),false,'read helper rejects export permission');
select is(private.is_active_user(),false,'allowlisted executive does not become a general active user at AAL1');
select is(private.has_permission('90500000-0000-4000-8000-000000000001','90600000-0000-4000-8000-000000000001','care_records.write'),false,'original write permission helper unchanged');
select is(public.has_recent_aal2(15),false,'login read admission never fabricates recent reauthentication');
select throws_ok($$insert into public.measurements(organization_id,branch_id,client_id,measurement_kind,measured_at,numeric_value,idempotency_key)
 values('90500000-0000-4000-8000-000000000001','90600000-0000-4000-8000-000000000001','90800000-0000-4000-8000-000000000001','temperature',now(),36.5,gen_random_uuid())$$,'42501',null,'direct business writes still denied');
select throws_ok($$select public.record_care_diary_draft('90500000-0000-4000-8000-000000000001','90600000-0000-4000-8000-000000000001',
 '90800000-0000-4000-8000-000000000001',now(),'morning','合成照顧','',false,null,gen_random_uuid())$$,'42501',null,'ordinary draft RPC still requires original AAL2');
select throws_ok($$select public.daily_service_summary_export_snapshot_v2('90500000-0000-4000-8000-000000000001',
 '90600000-0000-4000-8000-000000000001',gen_random_uuid())$$,'42501',null,'export remains on original assurance chain');
select throws_ok($$select public.mutate_nursing_assessment('90500000-0000-4000-8000-000000000001','90600000-0000-4000-8000-000000000001',
 '{"action":"create_draft","clientId":"90800000-0000-4000-8000-000000000001","content":{}}',gen_random_uuid())$$,'42501',null,'reader is not promoted into clinical authority');
reset role;
select is((select count(*)::integer from public.audit_events where metadata->>'projection'='client_directory_minimal'),1,'successful directory view remains audited');
set local role authenticated;
select is(pg_temp.directory_count('90500000-0000-4000-8000-000000000001','90600000-0000-4000-8000-000000000001',purpose),1,
 'reviewed directory purpose remains permission-gated: '||purpose::text)
from unnest(array['case_center','core_daily','blood_glucose','client_registry','client_lifecycle','care_plans','service_usage','medication_plan']::public.client_directory_purpose[]) purpose;
select is(pg_temp.executive_check('{"sub":"malformed"}'),false,'malformed subject rejected by unchanged admission');
select is(private.is_active_executive_reader(),false,'reader fails closed on malformed subject without cast error');
select is(pg_temp.executive_check('{"session_id":"90300000-0000-4000-8000-000000000002"}'),false,'foreign session rejected');
select is(private.is_active_executive_reader(),false,'foreign session cannot get reader scope');
select is(pg_temp.executive_check(),true,'restore valid synthetic executive session');
reset role;

-- A session can have recent authentic AAL2 evidence while the caller still
-- holds its older AAL1 token: read access must not make that token writable.
insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,
 issued_jwt_jti,created_at,expires_at,consumed_at,consumed_jwt_iat,consumed_jwt_jti,factor_method,factor_verified_at)
values('90900000-0000-4000-8000-000000000005','90100000-0000-4000-8000-000000000001','90300000-0000-4000-8000-000000000001',
 repeat('c',64),gen_random_uuid(),now()-interval '3 minutes','synthetic-before',now()-interval '2 minutes',now()+interval '2 minutes',
 now()-interval '1 minute',now()-interval '1 minute','synthetic-after','totp',now()-interval '1 minute');
insert into private.reauth_events(user_id,session_id,challenge_id,aal,verification_method,verified_at)
values('90100000-0000-4000-8000-000000000001','90300000-0000-4000-8000-000000000001','90900000-0000-4000-8000-000000000005',
 'aal2','totp',now()-interval '1 minute');
set local role authenticated;
select is(public.has_recent_aal2(15),false,'old AAL1 token plus same-session fresh AAL2 event still denied');
select is(pg_temp.executive_check('{}','aal2'),true,'actual Google plus TOTP token still admitted');
select is(public.has_recent_aal2(15),true,'genuine AAL2 retains existing recent evidence behavior');
select is(pg_temp.executive_check(),true,'return to AAL1 read-only token');
select is(public.has_recent_aal2(15),false,'downgrading back to AAL1 cannot reuse privileged evidence');
reset role;

-- Existing scope semantics: branch-limited membership cannot pick another
-- branch, and lack of view_all requires a currently effective assignment.
delete from public.membership_roles where membership_id='90700000-0000-4000-8000-000000000001';
delete from public.memberships where id='90700000-0000-4000-8000-000000000001';
insert into public.memberships(id,organization_id,branch_id,profile_id,status,starts_at)
values('90700000-0000-4000-8000-000000000001','90500000-0000-4000-8000-000000000001',
 '90600000-0000-4000-8000-000000000001','90100000-0000-4000-8000-000000000001','active',now()-interval '1 day');
insert into public.membership_roles(membership_id,role_id)
values('90700000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002');
set local role authenticated;
select is((select count(*)::integer from public.branches),1,'branch membership shows exactly one branch');
select is((select count(*)::integer from public.measurements),1,'source row scope follows branch restriction');
select throws_ok($$select pg_temp.directory_count('90500000-0000-4000-8000-000000000001','90600000-0000-4000-8000-000000000003')$$,'42501',null,'same-organization other branch denied');
reset role;
delete from public.role_permissions where role_id='10000000-0000-4000-8000-000000000002' and permission_id=(select id from public.permissions where permission_key='clients.view_all');
set local role authenticated;
select is(pg_temp.directory_count(),0,'without view_all unassigned client is not visible');
select is((select count(*)::integer from public.measurements),0,'source rows also require assignment');
reset role;
insert into public.client_assignments(organization_id,branch_id,client_id,assignee_user_id,assignment_kind,starts_at)
values('90500000-0000-4000-8000-000000000001','90600000-0000-4000-8000-000000000001','90800000-0000-4000-8000-000000000001','90100000-0000-4000-8000-000000000001','synthetic',now()+interval '1 day');
set local role authenticated;
select is(pg_temp.directory_count(),0,'future client assignment denied');
reset role;
update public.client_assignments set starts_at=now()-interval '1 day' where assignee_user_id='90100000-0000-4000-8000-000000000001';
set local role authenticated;
select is(pg_temp.directory_count(),1,'effective assignment permits minimal directory');
select is((select count(*)::integer from public.measurements),1,'effective assignment permits source rows');
reset role;
update public.client_assignments set ends_at=now()-interval '1 minute' where assignee_user_id='90100000-0000-4000-8000-000000000001';
set local role authenticated;
select is(pg_temp.directory_count(),0,'expired assignment denied immediately');
reset role;
update public.client_assignments set ends_at=null where assignee_user_id='90100000-0000-4000-8000-000000000001';

-- All following changes are synthetic owner fixtures, restored individually.
update public.membership_roles set assigned_at=now()+interval '1 day' where membership_id='90700000-0000-4000-8000-000000000001';
set local role authenticated;
select is(private.is_active_executive_reader(),false,'future role assignment does not authorize reader');
select is((select count(*)::integer from public.active_memberships),0,'future role assignment disappears from AAL1 context');
reset role;
update public.membership_roles set assigned_at=now() where membership_id='90700000-0000-4000-8000-000000000001';
update public.role_permissions set granted_at=now()+interval '1 day' where role_id='10000000-0000-4000-8000-000000000002'
 and permission_id=(select id from public.permissions where permission_key='health.read');
set local role authenticated;
select is((select count(*)::integer from public.measurements),0,'future permission grant cannot authorize health source');
select ok(not (select scopes @> array['health.read'] from public.active_memberships),'future permission absent from context');
reset role;
update public.role_permissions set granted_at=now() where role_id='10000000-0000-4000-8000-000000000002';

-- Test owner mutates one effective predicate at a time; helper and context
-- must reject without editing production admission/authority implementations.
create function pg_temp.assert_revocation(p_change text,p_restore text,p_label text)
returns setof text language plpgsql security invoker as $$
declare v_claims text:=current_setting('request.jwt.claims');
begin
 perform set_config('request.jwt.claims','{}',true);
 execute p_change;
 perform set_config('request.jwt.claims',v_claims,true);
 execute 'set local role authenticated';
 return next public.is(private.is_active_executive_reader(),false,p_label);
 return next public.is((select count(*)::integer from public.active_memberships),0,p_label||' hides context');
 return next public.is((select count(*)::integer from public.measurements),0,p_label||' hides source rows');
 execute 'reset role';
 perform set_config('request.jwt.claims','{}',true);
 execute p_restore;
 perform set_config('request.jwt.claims',v_claims,true);
end;
$$;
select * from pg_temp.assert_revocation(
 $$update public.profiles set is_active=false where id='90100000-0000-4000-8000-000000000001'$$,
 $$update public.profiles set is_active=true where id='90100000-0000-4000-8000-000000000001'$$,'inactive profile');
select * from pg_temp.assert_revocation(
 $$update public.memberships set ends_at=now()-interval '1 minute' where id='90700000-0000-4000-8000-000000000001'$$,
 $$update public.memberships set ends_at=null where id='90700000-0000-4000-8000-000000000001'$$,'expired membership');
select * from pg_temp.assert_revocation(
 $$update public.memberships set starts_at=now()+interval '1 day' where id='90700000-0000-4000-8000-000000000001'$$,
 $$update public.memberships set starts_at=now()-interval '1 day' where id='90700000-0000-4000-8000-000000000001'$$,'future membership');
select * from pg_temp.assert_revocation(
 $$update public.roles set is_active=false where id='10000000-0000-4000-8000-000000000002'$$,
 $$update public.roles set is_active=true where id='10000000-0000-4000-8000-000000000002'$$,'inactive role');
select * from pg_temp.assert_revocation(
 $$update public.organizations set is_active=false where id='90500000-0000-4000-8000-000000000001'$$,
 $$update public.organizations set is_active=true where id='90500000-0000-4000-8000-000000000001'$$,'inactive organization');
select * from pg_temp.assert_revocation(
 $$update public.branches set is_active=false where id='90600000-0000-4000-8000-000000000001'$$,
 $$update public.branches set is_active=true where id='90600000-0000-4000-8000-000000000001'$$,'inactive branch');
select * from pg_temp.assert_revocation(
 $$update private.executive_access_policy set enabled=false$$,
 $$update private.executive_access_policy set enabled=true$$,'disabled owner policy');
select * from pg_temp.assert_revocation(
 $$update private.executive_access_policy set google_subject='wrong-subject'$$,
 $$update private.executive_access_policy set google_subject='synthetic-google-executive'$$,'wrong pinned Google subject');
select * from pg_temp.assert_revocation(
 $$update auth.users set banned_until=now()+interval '1 day' where id='90100000-0000-4000-8000-000000000001'$$,
 $$update auth.users set banned_until=null where id='90100000-0000-4000-8000-000000000001'$$,'banned Auth user');
select * from pg_temp.assert_revocation(
 $$update auth.sessions set not_after=now()-interval '1 minute' where id='90300000-0000-4000-8000-000000000001'$$,
 $$update auth.sessions set not_after=null where id='90300000-0000-4000-8000-000000000001'$$,'expired Auth session');
select * from pg_temp.assert_revocation(
 $$update auth.identities set identity_data=jsonb_set(identity_data,'{email_verified}','false') where id='90200000-0000-4000-8000-000000000001'$$,
 $$update auth.identities set identity_data=jsonb_set(identity_data,'{email_verified}','true') where id='90200000-0000-4000-8000-000000000001'$$,'unverified Google identity');

update auth.users set raw_user_meta_data='{"role":"org_manager","provider":"google","email":"executive@example.invalid","email_verified":true}'
 where id='90100000-0000-4000-8000-000000000002';
set local role authenticated;
select is(pg_temp.executive_check('{"sub":"90100000-0000-4000-8000-000000000002","session_id":"90300000-0000-4000-8000-000000000002","email":"other@example.invalid"}'),false,'another actual Google user is not pinned executive');
select is(private.is_active_executive_reader(),false,'raw user metadata cannot grant read authority');
select is((select count(*)::integer from public.active_memberships),0,'unapproved Google user sees no context');
select is((select count(*)::integer from public.measurements),0,'unapproved Google user sees no source rows');
reset role;

-- The production gate is never overridden anywhere in this focused suite.
select ok(position('policy.allowed_user_id=auth.uid()' in pg_get_functiondef('private.executive_reader_scope()'::regprocedure))>0
 and position('count(*) from private.executive_access_policy' in pg_get_functiondef('private.executive_reader_scope()'::regprocedure))>0,
 'reader independently requires singleton pinned owner policy beyond shared gate');
delete from private.executive_access_policy;
set local role authenticated;
select is(pg_temp.executive_check(),false,'missing owner policy denies original admission');
select is(private.is_active_executive_reader(),false,'missing singleton owner policy denies reader');
reset role;
select * from finish();
rollback;
