begin;
select plan(206);

-- Real admission and all migrations; no legacy auth predicate override.
select set_config('test.routine_amr',floor(extract(epoch from clock_timestamp()-interval '2 minutes'))::text,true);
select set_config('test.routine_now',clock_timestamp()::text,true);
insert into auth.users(id,aud,role,email,email_confirmed_at,created_at,updated_at) values
 ('c0100000-0000-4000-8000-000000000001','authenticated','authenticated','worker@care.example.invalid',now()-interval '1 day',now()-interval '1 day',now()),
 ('c0100000-0000-4000-8000-000000000002','authenticated','authenticated','other@care.example.invalid',now()-interval '1 day',now()-interval '1 day',now());
insert into auth.identities(id,provider_id,user_id,identity_data,provider) values
 ('c0200000-0000-4000-8000-000000000001','synthetic-routine-worker','c0100000-0000-4000-8000-000000000001','{"sub":"synthetic-routine-worker","email":"worker@care.example.invalid","email_verified":true,"hd":"care.example.invalid"}','google'),
 ('c0200000-0000-4000-8000-000000000002','synthetic-routine-other','c0100000-0000-4000-8000-000000000002','{"sub":"synthetic-routine-other","email":"other@care.example.invalid","email_verified":true,"hd":"care.example.invalid"}','google');
insert into auth.sessions(id,user_id,created_at,aal) values
 ('c0300000-0000-4000-8000-000000000001','c0100000-0000-4000-8000-000000000001',now()-interval '3 minutes','aal1'),
 ('c0300000-0000-4000-8000-000000000002','c0100000-0000-4000-8000-000000000002',now()-interval '3 minutes','aal1');
insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method)
select gen_random_uuid(),id,to_timestamp(current_setting('test.routine_amr')::bigint),to_timestamp(current_setting('test.routine_amr')::bigint),'oauth'
from auth.sessions where id in ('c0300000-0000-4000-8000-000000000001','c0300000-0000-4000-8000-000000000002');
insert into public.organizations(id,code,name) values
 ('c0500000-0000-4000-8000-000000000001','routine-organization','Synthetic approved organization'),
 ('c0500000-0000-4000-8000-000000000002','routine-other-organization','Synthetic other organization');
insert into public.branches(id,organization_id,code,name) values
 ('c0600000-0000-4000-8000-000000000001','c0500000-0000-4000-8000-000000000001','main','Synthetic main'),
 ('c0600000-0000-4000-8000-000000000002','c0500000-0000-4000-8000-000000000001','other','Synthetic other branch'),
 ('c0600000-0000-4000-8000-000000000003','c0500000-0000-4000-8000-000000000002','foreign','Synthetic foreign');
insert into public.profiles(id,display_name,kind) values
 ('c0100000-0000-4000-8000-000000000001','Synthetic worker','staff'),
 ('c0100000-0000-4000-8000-000000000002','Synthetic unapproved worker','staff');
insert into public.memberships(id,organization_id,branch_id,profile_id,status,starts_at) values
 ('c0700000-0000-4000-8000-000000000001','c0500000-0000-4000-8000-000000000001','c0600000-0000-4000-8000-000000000001','c0100000-0000-4000-8000-000000000001','active',now()-interval '1 day'),
 ('c0700000-0000-4000-8000-000000000002','c0500000-0000-4000-8000-000000000001','c0600000-0000-4000-8000-000000000001','c0100000-0000-4000-8000-000000000002','active',now()-interval '1 day');
insert into public.membership_roles(membership_id,role_id)
select id,'10000000-0000-4000-8000-000000000006' from public.memberships where organization_id='c0500000-0000-4000-8000-000000000001';
insert into public.clients(id,organization_id,branch_id,client_code,display_name,admitted_on) values
 ('c0800000-0000-4000-8000-000000000001','c0500000-0000-4000-8000-000000000001','c0600000-0000-4000-8000-000000000001','SYN-ROUTINE-1','Synthetic assigned client',current_date-10),
 ('c0800000-0000-4000-8000-000000000002','c0500000-0000-4000-8000-000000000001','c0600000-0000-4000-8000-000000000001','SYN-ROUTINE-2','Synthetic unassigned client',current_date-10),
 ('c0800000-0000-4000-8000-000000000003','c0500000-0000-4000-8000-000000000001','c0600000-0000-4000-8000-000000000002','SYN-ROUTINE-3','Synthetic different branch client',current_date-10),
 ('c0800000-0000-4000-8000-000000000004','c0500000-0000-4000-8000-000000000002','c0600000-0000-4000-8000-000000000003','SYN-ROUTINE-4','Synthetic different organization client',current_date-10);
insert into public.client_assignments(organization_id,branch_id,client_id,assignee_user_id,assignment_kind,starts_at)
values('c0500000-0000-4000-8000-000000000001','c0600000-0000-4000-8000-000000000001','c0800000-0000-4000-8000-000000000001','c0100000-0000-4000-8000-000000000001','routine_test',now()-interval '1 day');
insert into public.client_assignments(organization_id,branch_id,client_id,assignee_user_id,assignment_kind,starts_at) values
 ('c0500000-0000-4000-8000-000000000001','c0600000-0000-4000-8000-000000000001','c0800000-0000-4000-8000-000000000001','c0100000-0000-4000-8000-000000000002','routine_other_staff',now()-interval '1 day'),
 ('c0500000-0000-4000-8000-000000000001','c0600000-0000-4000-8000-000000000002','c0800000-0000-4000-8000-000000000003','c0100000-0000-4000-8000-000000000001','routine_other_branch',now()-interval '1 day'),
 ('c0500000-0000-4000-8000-000000000002','c0600000-0000-4000-8000-000000000003','c0800000-0000-4000-8000-000000000004','c0100000-0000-4000-8000-000000000001','routine_other_org',now()-interval '1 day');
insert into public.care_records(organization_id,branch_id,client_id,record_key,category,occurred_at,created_by)
values('c0500000-0000-4000-8000-000000000001','c0600000-0000-4000-8000-000000000001','c0800000-0000-4000-8000-000000000001',gen_random_uuid(),'restricted/clinical',now(),'c0100000-0000-4000-8000-000000000001');
insert into private.care_roster_versions(organization_id,branch_id,client_id,service_date,shift,staff_user_id,version,state,source_note,tasks,created_by)
values
 ('c0500000-0000-4000-8000-000000000001','c0600000-0000-4000-8000-000000000001','c0800000-0000-4000-8000-000000000001',current_date,'morning','c0100000-0000-4000-8000-000000000001',1,'scheduled','Synthetic plan','["temperature","care_diary"]','c0100000-0000-4000-8000-000000000001'),
 ('c0500000-0000-4000-8000-000000000001','c0600000-0000-4000-8000-000000000001','c0800000-0000-4000-8000-000000000001',current_date,'afternoon','c0100000-0000-4000-8000-000000000002',1,'scheduled','Synthetic plan','["temperature"]','c0100000-0000-4000-8000-000000000001'),
 ('c0500000-0000-4000-8000-000000000001','c0600000-0000-4000-8000-000000000001','c0800000-0000-4000-8000-000000000002',current_date,'morning','c0100000-0000-4000-8000-000000000001',1,'scheduled','Synthetic unassigned','["temperature"]','c0100000-0000-4000-8000-000000000001');

create function pg_temp.staff_claims(p_override jsonb default '{}') returns boolean language plpgsql security invoker as $$
begin
 perform set_config('request.jwt.claims',(jsonb_build_object(
  'sub','c0100000-0000-4000-8000-000000000001','session_id','c0300000-0000-4000-8000-000000000001',
  'aud','authenticated','role','authenticated','aal','aal1','email','worker@care.example.invalid','is_anonymous',false,
  'iat',floor(extract(epoch from clock_timestamp())),'exp',floor(extract(epoch from clock_timestamp()+interval '30 minutes')),
  'amr',jsonb_build_array(jsonb_build_object('method','oauth','timestamp',current_setting('test.routine_amr')::bigint))
 )||p_override)::text,true);
 return public.is_staff_login_allowed();
end; $$;
create function pg_temp.routine_access(p_permission text) returns boolean language sql security invoker as $$
 select public.has_routine_care_access('c0500000-0000-4000-8000-000000000001','c0600000-0000-4000-8000-000000000001',p_permission); $$;
create function pg_temp.directory(p_branch uuid default 'c0600000-0000-4000-8000-000000000001',p_purpose public.client_directory_purpose default 'core_daily')
returns integer language sql security invoker as $$
 select count(*)::integer from public.client_directory_snapshot('c0500000-0000-4000-8000-000000000001',p_branch,p_purpose); $$;
create function pg_temp.attendance(p_key uuid default 'c0900000-0000-4000-8000-000000000001',p_client uuid default 'c0800000-0000-4000-8000-000000000001',
 p_time timestamptz default current_setting('test.routine_now')::timestamptz,p_kind text default 'check_in',p_reason text default null)
returns boolean language sql security invoker as $$
 select replayed from public.record_attendance_event('c0500000-0000-4000-8000-000000000001','c0600000-0000-4000-8000-000000000001',p_client,p_kind,p_time,p_reason,p_key); $$;
create function pg_temp.vitals(p_key uuid default 'c0900000-0000-4000-8000-000000000002',p_temp numeric default 36.5,p_client uuid default 'c0800000-0000-4000-8000-000000000001')
returns boolean language sql security invoker as $$
 select replayed from public.record_vital_set('c0500000-0000-4000-8000-000000000001','c0600000-0000-4000-8000-000000000001',p_client,
 current_setting('test.routine_now')::timestamptz,p_key,null,null,null,p_temp,null); $$;
create function pg_temp.draft(p_key uuid default 'c0900000-0000-4000-8000-000000000003',p_note text default 'Synthetic observed care')
returns boolean language sql security invoker as $$
 select replayed from public.record_care_diary_quick_draft('c0500000-0000-4000-8000-000000000001','c0600000-0000-4000-8000-000000000001',
 'c0800000-0000-4000-8000-000000000001',current_setting('test.routine_now')::timestamptz,
 jsonb_build_object('shift','morning','care_item','Synthetic routine','note',p_note,'abnormal',false),p_key); $$;
create function pg_temp.diary() returns jsonb language sql security invoker as $$
 select public.care_diary_snapshot('c0500000-0000-4000-8000-000000000001','c0600000-0000-4000-8000-000000000001','c0800000-0000-4000-8000-000000000001'); $$;
create function pg_temp.diary_action(p_action text,p_fields jsonb default null,p_version integer default null) returns jsonb language plpgsql security invoker as $$
declare r jsonb;
begin
 r:=pg_temp.diary()->'records'->0;
 return public.mutate_care_diary('c0500000-0000-4000-8000-000000000001','c0600000-0000-4000-8000-000000000001',p_action,(r->>'id')::uuid,
 coalesce(p_version,(r->>'version')::integer),p_fields,case when p_action in ('reopen','correct') then 'Synthetic reason' end,gen_random_uuid());
end; $$;

select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='private.staff_google_access_grants'::regclass),'approval store enables and forces RLS');
select ok(not has_table_privilege('authenticated','private.staff_google_access_grants','select,insert,update,delete') and not has_table_privilege('service_role','private.staff_google_access_grants','select,insert,update,delete'),'API roles cannot inspect or self-provision grants');
select ok(not has_table_privilege('authenticated','public.clients','select') and not has_table_privilege('authenticated','auth.users','select') and not has_table_privilege('authenticated','auth.sessions','select'),'raw identity tables remain private');
select ok(not has_function_privilege('anon','public.is_staff_login_allowed()','execute') and not has_function_privilege('service_role','public.has_routine_care_access(uuid,uuid,text)','execute'),'anonymous and service role have no admission RPC grant');
select ok((select bool_and(not prosecdef and proconfig @> array['search_path=""']) from pg_proc where oid in ('public.is_staff_login_allowed()'::regprocedure,'public.has_routine_care_access(uuid,uuid,text)'::regprocedure)),'public wrappers are invoker with empty search path');
select ok((select bool_and(prosecdef and proconfig @> array['search_path=""'] and pg_get_userbyid(proowner)='postgres') from pg_proc where oid in ('private.routine_staff_scope()'::regprocedure,'private.is_staff_google_session_allowed()'::regprocedure,'private.has_routine_staff_permission(uuid,uuid,text)'::regprocedure,'private.can_routine_staff_access_client(uuid,text)'::regprocedure)),'private security helpers use self checks, owner and empty search path');
select ok(not exists(select 1 from pg_policy where polname like 'routine_staff_%' and polcmd<>'r'),'new RLS grants are SELECT-only');
select ok((select reloptions @> array['security_invoker=true','security_barrier=true'] from pg_class where oid='public.active_memberships'::regclass),'membership view keeps RLS invoker and barrier');
set local role authenticated;
select pg_temp.staff_claims();
select is(pg_temp.staff_claims(),false,'valid Google staff without individual approval remains denied');
select is((select count(*)::integer from public.active_memberships),0,'unapproved staff has no tenant context');
select is(pg_temp.routine_access('health.write'),false,'unapproved staff has no routine assurance');
select throws_ok($$select pg_temp.draft()$$,'42501',null,'no grant blocks direct draft RPC');
reset role;
select set_config('request.jwt.claims','{}',true);
insert into private.staff_google_access_grants(allowed_user_id,organization_id,company_email_domain,allowed_email,google_subject,enabled,approval_reference)
values('c0100000-0000-4000-8000-000000000001','c0500000-0000-4000-8000-000000000001','care.example.invalid','worker@care.example.invalid','synthetic-routine-worker',true,'Synthetic independent authorization');
set local role authenticated;
select pg_temp.staff_claims();
select is(pg_temp.staff_claims(),true,'approved live company Google session admitted without TOTP');
select is(public.is_executive_login_allowed(),false,'staff admission never claims executive identity');
select is(private.is_active_user(),false,'original AAL2 business root remains unchanged');
select is(public.has_recent_aal2(15),false,'routine admission never fabricates recent AAL2');
select is((select count(*)::integer from public.active_memberships),1,'only approved self membership visible');
select is((select count(*)::integer from public.branches),1,'branch restriction enforced through direct SELECT');
select is((select count(*)::integer from public.profiles),1,'other worker profiles remain private');
select is(pg_temp.directory(),1,'minimum directory contains only assigned client');
select is(pg_temp.directory('c0600000-0000-4000-8000-000000000001','case_center'),1,'case center minimum directory works');
select is((select count(*)::integer from public.client_assignments),1,'case-center assignment source returns only own effective scoped assignment');
select ok((select bool_and(assignee_user_id=auth.uid() and client_id='c0800000-0000-4000-8000-000000000001'
 and branch_id='c0600000-0000-4000-8000-000000000001') from public.client_assignments),'assignment source hides other employees and own out-of-branch or foreign-organization assignments');
select throws_ok($$select pg_temp.directory('c0600000-0000-4000-8000-000000000002')$$,'42501',null,'same organization other branch directory denied');
select throws_ok($$select pg_temp.directory('c0600000-0000-4000-8000-000000000001','client_registry')$$,'42501',null,'unreviewed master-data purpose stays denied');
select throws_ok($$select pg_temp.directory('c0600000-0000-4000-8000-000000000001','offline_sync')$$,'42501',null,'legacy bulk sync assurance unchanged');
select is(pg_temp.routine_access('attendance.write'),true,'explicit routine permission attendance.write allowed');
select is(pg_temp.routine_access('health.write'),true,'explicit routine permission health.write allowed');
select is(pg_temp.routine_access('care_records.write'),true,'explicit routine permission care_records.write allowed');
select is(pg_temp.routine_access('care_records.read'),true,'explicit routine permission care_records.read allowed');
select is(pg_temp.routine_access('care_records.sign'),false,'RPC rejects unsupported assurance key care_records.sign');
select is(pg_temp.routine_access('claims.export'),false,'RPC rejects unsupported assurance key claims.export');
select is(pg_temp.routine_access('roles.manage'),false,'RPC rejects unsupported assurance key roles.manage');
select is(pg_temp.routine_access('attendance.correct'),false,'RPC rejects unsupported assurance key attendance.correct');
select is(pg_temp.routine_access('health.read'),false,'RPC rejects unsupported assurance key health.read');
select is(pg_temp.routine_access('sync.use'),false,'RPC rejects unsupported assurance key sync.use');
select is(public.has_routine_care_access('c0500000-0000-4000-8000-000000000001','c0600000-0000-4000-8000-000000000002','health.write'),false,'routine assurance denies cross branch');
select is(public.has_routine_care_access('c0500000-0000-4000-8000-000000000002','c0600000-0000-4000-8000-000000000003','health.write'),false,'routine assurance denies cross organization');
select is((select jsonb_array_length(payload->'assignments') from public.care_roster_snapshot('c0500000-0000-4000-8000-000000000001','c0600000-0000-4000-8000-000000000001',current_date)),1,'roster exposes self assigned client only');
select is((select payload->'manager' from public.care_roster_snapshot('c0500000-0000-4000-8000-000000000001','c0600000-0000-4000-8000-000000000001',current_date)),'false'::jsonb,'routine approval does not grant roster manager');
select throws_ok($$select public.save_care_roster('c0500000-0000-4000-8000-000000000001','c0600000-0000-4000-8000-000000000001','{}')$$,'42501',null,'roster write stays high risk');
select is(pg_temp.attendance(),false,'assigned AAL1 attendance commits through original RPC');
select is((select count(*)::integer from generate_series(1,10) n where pg_temp.attendance()),10,'ten identical attendance replays are replay receipts');
select is((select count(*)::integer from public.attendance_records),1,'ten replays leave one attendance row');
select throws_ok($$select pg_temp.attendance('c0900000-0000-4000-8000-000000000001','c0800000-0000-4000-8000-000000000001',current_setting('test.routine_now')::timestamptz,'leave','different')$$,'23505',null,'same attendance key with changed payload conflicts');
select throws_ok($$select pg_temp.attendance(gen_random_uuid(),'c0800000-0000-4000-8000-000000000002')$$,'42501',null,'direct attendance RPC denies unassigned case');
select throws_ok($$select pg_temp.attendance(gen_random_uuid(),'c0800000-0000-4000-8000-000000000003')$$,'42501',null,'direct attendance RPC denies actor-supplied branch forgery');
select throws_ok($$select pg_temp.attendance(gen_random_uuid(),'c0800000-0000-4000-8000-000000000001',now()-interval '1 hour','check_out','Synthetic backfill')$$,'42501',null,'routine AAL1 cannot backfill attendance');
select is(pg_temp.vitals(),false,'assigned AAL1 measurement commits');
select is((select count(*)::integer from generate_series(1,10) n where pg_temp.vitals()),10,'ten identical vital replays are receipts');
select is((select count(*)::integer from public.measurements),1,'one persisted measurement');
select is((select numeric_value from public.measurements),36.5::numeric,'source value reads back unchanged');
select throws_ok($$select pg_temp.vitals('c0900000-0000-4000-8000-000000000002',37)$$,'23505',null,'changed vital payload with same key is denied');
select throws_ok($$select pg_temp.vitals(gen_random_uuid(),36.5,'c0800000-0000-4000-8000-000000000002')$$,'42501',null,'unassigned vital target denied');
select throws_ok($$select pg_temp.vitals(gen_random_uuid(),500)$$,'22023',null,'routine path keeps server value validation');
select is(pg_temp.draft(),false,'assigned AAL1 structured draft commits');
select is((select count(*)::integer from generate_series(1,10) n where pg_temp.draft()),10,'ten draft replays are receipts');
select is((select count(*)::integer from public.care_records),1,'only core diary category visible; restricted clinical row hidden');
select is(jsonb_array_length(pg_temp.diary()->'records'),1,'diary RPC reads actual saved result');
select is(pg_temp.diary()->'records'->0->>'status','draft','saved draft is not a signature');
select throws_ok($$select pg_temp.draft('c0900000-0000-4000-8000-000000000003','changed')$$,'23505',null,'draft changed payload replay conflicts');
select throws_ok($$select pg_temp.diary_action('edit','{"shift":"morning","care_item":"Synthetic routine","note":"Synthetic update","abnormal":false}',99)$$,'40001',null,'stale draft edit denied');
select is(pg_temp.diary_action('edit','{"shift":"morning","care_item":"Synthetic routine","note":"Synthetic update","abnormal":false}')->'record'->>'version','2','ordinary edit creates new version');
select is(pg_temp.diary_action('submit')->'record'->>'status','submitted','ordinary submission creates unsigned submitted version');
select is(pg_temp.diary()->'records'->0->'signed_by','null'::jsonb,'submission does not fabricate signer');
select throws_ok($$select pg_temp.diary_action('sign')$$,'42501',null,'sign keeps original privileged assurance');
select throws_ok($$select pg_temp.diary_action('correct')$$,'42501',null,'correct keeps original privileged assurance');
select throws_ok($$select pg_temp.diary_action('reopen')$$,'42501',null,'reopen keeps original privileged assurance');
select throws_ok($$select pg_temp.diary_action('edit','{"shift":"morning","care_item":"Synthetic routine","note":"Cannot overwrite","abnormal":false}')$$,'23514',null,'submitted record cannot be overwritten via edit');
select throws_ok($$insert into public.care_records(organization_id,branch_id,client_id,record_key,category,occurred_at,created_by) values('c0500000-0000-4000-8000-000000000001','c0600000-0000-4000-8000-000000000001','c0800000-0000-4000-8000-000000000001',gen_random_uuid(),'staff/daily-care/care-diary',now(),'c0100000-0000-4000-8000-000000000002')$$,'42501',null,'direct row insert and forged creator rejected');
select throws_ok($$update public.care_records set signed_by='c0100000-0000-4000-8000-000000000002',signed_at=now(),status='signed'$$,'42501',null,'direct forged signing denied');
select throws_ok($$insert into public.measurements(organization_id,branch_id,client_id,measurement_kind,measured_at,numeric_value,idempotency_key) values('c0500000-0000-4000-8000-000000000001','c0600000-0000-4000-8000-000000000001','c0800000-0000-4000-8000-000000000001','temperature',now(),36.5,gen_random_uuid())$$,'42501',null,'routine helper adds no direct measurement insert privilege');
select throws_ok($$select public.daily_service_summary_export_snapshot_v2('c0500000-0000-4000-8000-000000000001','c0600000-0000-4000-8000-000000000001',gen_random_uuid())$$,'42501',null,'bulk export remains protected');
reset role;
select set_config('request.jwt.claims','{}',true);
select ok((select bool_and(created_by='c0100000-0000-4000-8000-000000000001') from public.care_records where category='staff/daily-care/care-diary' and organization_id='c0500000-0000-4000-8000-000000000001'),'all diary authors derive from authenticated uid');
select ok(exists(select 1 from public.audit_events where actor_user_id='c0100000-0000-4000-8000-000000000001' and metadata->>'operation'='diary_lifecycle_snapshot'),'readback stays audited');
update private.staff_google_access_grants set enabled=false;
set local role authenticated;
select pg_temp.staff_claims();
select is(pg_temp.staff_claims(),false,'revoked approval denies admission immediately');
select is((select count(*)::integer from public.client_assignments),0,'disabled grant immediately hides assignment source');
select is(pg_temp.routine_access('health.write'),false,'revoked approval denies routine write assurance');
select is((select count(*)::integer from public.active_memberships),0,'revoked approval hides tenant context');
select is((select count(*)::integer from public.measurements),0,'revoked approval hides prior source rows');
select throws_ok($$select pg_temp.vitals()$$,'42501',null,'revoked approval blocks even exact replay');
reset role;
select set_config('request.jwt.claims','{}',true);
update private.staff_google_access_grants set enabled=true;
update private.staff_google_access_grants set approved_at=now()-interval '2 days',expires_at=now()-interval '1 minute';
set local role authenticated;
select pg_temp.staff_claims();
select is(pg_temp.staff_claims(),false,'expired approval denies admission immediately');
select is(pg_temp.routine_access('health.write'),false,'expired approval denies routine write assurance');
select is((select count(*)::integer from public.active_memberships),0,'expired approval hides tenant context');
select is((select count(*)::integer from public.measurements),0,'expired approval hides prior source rows');
select throws_ok($$select pg_temp.vitals()$$,'42501',null,'expired approval blocks even exact replay');
reset role;
select set_config('request.jwt.claims','{}',true);
update private.staff_google_access_grants set expires_at=null;
update private.staff_google_access_grants set approved_at=now()+interval '1 day';
set local role authenticated;
select pg_temp.staff_claims();
select is(pg_temp.staff_claims(),false,'future approval denies admission immediately');
select is(pg_temp.routine_access('health.write'),false,'future approval denies routine write assurance');
select is((select count(*)::integer from public.active_memberships),0,'future approval hides tenant context');
select is((select count(*)::integer from public.measurements),0,'future approval hides prior source rows');
select throws_ok($$select pg_temp.vitals()$$,'42501',null,'future approval blocks even exact replay');
reset role;
select set_config('request.jwt.claims','{}',true);
update private.staff_google_access_grants set approved_at=now()-interval '1 day';
update public.profiles set is_active=false where id='c0100000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.staff_claims();
select is(pg_temp.staff_claims(),false,'disabled profile denies admission immediately');
select is(pg_temp.routine_access('health.write'),false,'disabled profile denies routine write assurance');
select is((select count(*)::integer from public.active_memberships),0,'disabled profile hides tenant context');
select is((select count(*)::integer from public.measurements),0,'disabled profile hides prior source rows');
select throws_ok($$select pg_temp.vitals()$$,'42501',null,'disabled profile blocks even exact replay');
reset role;
select set_config('request.jwt.claims','{}',true);
update public.profiles set is_active=true where id='c0100000-0000-4000-8000-000000000001';
delete from public.membership_roles where membership_id='c0700000-0000-4000-8000-000000000001';
update public.profiles set kind='family' where id='c0100000-0000-4000-8000-000000000001';
insert into public.membership_roles(membership_id,role_id) values('c0700000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000010');
set local role authenticated;
select pg_temp.staff_claims();
select is(pg_temp.staff_claims(),false,'family profile cannot use staff grant denies admission immediately');
select is(pg_temp.routine_access('health.write'),false,'family profile cannot use staff grant denies routine write assurance');
select is((select count(*)::integer from public.active_memberships),0,'family profile cannot use staff grant hides tenant context');
select is((select count(*)::integer from public.measurements),0,'family profile cannot use staff grant hides prior source rows');
select throws_ok($$select pg_temp.vitals()$$,'42501',null,'family profile cannot use staff grant blocks even exact replay');
reset role;
select set_config('request.jwt.claims','{}',true);
delete from public.membership_roles where membership_id='c0700000-0000-4000-8000-000000000001';
update public.profiles set kind='staff' where id='c0100000-0000-4000-8000-000000000001';
insert into public.membership_roles(membership_id,role_id) values('c0700000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000006');
update public.memberships set ends_at=now()-interval '1 minute' where id='c0700000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.staff_claims();
select is(pg_temp.staff_claims(),false,'ended membership denies admission immediately');
select is(pg_temp.routine_access('health.write'),false,'ended membership denies routine write assurance');
select is((select count(*)::integer from public.active_memberships),0,'ended membership hides tenant context');
select is((select count(*)::integer from public.measurements),0,'ended membership hides prior source rows');
select throws_ok($$select pg_temp.vitals()$$,'42501',null,'ended membership blocks even exact replay');
reset role;
select set_config('request.jwt.claims','{}',true);
update public.memberships set ends_at=null where id='c0700000-0000-4000-8000-000000000001';
update public.memberships set starts_at=now()+interval '1 day' where id='c0700000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.staff_claims();
select is(pg_temp.staff_claims(),false,'future membership denies admission immediately');
select is(pg_temp.routine_access('health.write'),false,'future membership denies routine write assurance');
select is((select count(*)::integer from public.active_memberships),0,'future membership hides tenant context');
select is((select count(*)::integer from public.measurements),0,'future membership hides prior source rows');
select throws_ok($$select pg_temp.vitals()$$,'42501',null,'future membership blocks even exact replay');
reset role;
select set_config('request.jwt.claims','{}',true);
update public.memberships set starts_at=now()-interval '1 day' where id='c0700000-0000-4000-8000-000000000001';
update public.organizations set is_active=false where id='c0500000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.staff_claims();
select is(pg_temp.staff_claims(),false,'disabled organization denies admission immediately');
select is(pg_temp.routine_access('health.write'),false,'disabled organization denies routine write assurance');
select is((select count(*)::integer from public.active_memberships),0,'disabled organization hides tenant context');
select is((select count(*)::integer from public.measurements),0,'disabled organization hides prior source rows');
select throws_ok($$select pg_temp.vitals()$$,'42501',null,'disabled organization blocks even exact replay');
reset role;
select set_config('request.jwt.claims','{}',true);
update public.organizations set is_active=true where id='c0500000-0000-4000-8000-000000000001';
update public.branches set is_active=false where id='c0600000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.staff_claims();
select is(pg_temp.staff_claims(),false,'disabled branch denies admission immediately');
select is(pg_temp.routine_access('health.write'),false,'disabled branch denies routine write assurance');
select is((select count(*)::integer from public.active_memberships),0,'disabled branch hides tenant context');
select is((select count(*)::integer from public.measurements),0,'disabled branch hides prior source rows');
select throws_ok($$select pg_temp.vitals()$$,'42501',null,'disabled branch blocks even exact replay');
reset role;
select set_config('request.jwt.claims','{}',true);
update public.branches set is_active=true where id='c0600000-0000-4000-8000-000000000001';
update public.roles set is_active=false where id='10000000-0000-4000-8000-000000000006';
set local role authenticated;
select pg_temp.staff_claims();
select is(pg_temp.staff_claims(),false,'disabled role denies admission immediately');
select is(pg_temp.routine_access('health.write'),false,'disabled role denies routine write assurance');
select is((select count(*)::integer from public.active_memberships),0,'disabled role hides tenant context');
select is((select count(*)::integer from public.measurements),0,'disabled role hides prior source rows');
select throws_ok($$select pg_temp.vitals()$$,'42501',null,'disabled role blocks even exact replay');
reset role;
select set_config('request.jwt.claims','{}',true);
update public.roles set is_active=true where id='10000000-0000-4000-8000-000000000006';
update public.membership_roles set assigned_at=now()+interval '1 day' where membership_id='c0700000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.staff_claims();
select is(pg_temp.staff_claims(),false,'future role grant denies admission immediately');
select is(pg_temp.routine_access('health.write'),false,'future role grant denies routine write assurance');
select is((select count(*)::integer from public.active_memberships),0,'future role grant hides tenant context');
select is((select count(*)::integer from public.measurements),0,'future role grant hides prior source rows');
select throws_ok($$select pg_temp.vitals()$$,'42501',null,'future role grant blocks even exact replay');
reset role;
select set_config('request.jwt.claims','{}',true);
update public.membership_roles set assigned_at=now() where membership_id='c0700000-0000-4000-8000-000000000001';
update auth.users set banned_until=now()+interval '1 day' where id='c0100000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.staff_claims();
select is(pg_temp.staff_claims(),false,'banned auth user denies admission immediately');
select is(pg_temp.routine_access('health.write'),false,'banned auth user denies routine write assurance');
select is((select count(*)::integer from public.active_memberships),0,'banned auth user hides tenant context');
select is((select count(*)::integer from public.measurements),0,'banned auth user hides prior source rows');
select throws_ok($$select pg_temp.vitals()$$,'42501',null,'banned auth user blocks even exact replay');
reset role;
select set_config('request.jwt.claims','{}',true);
update auth.users set banned_until=null where id='c0100000-0000-4000-8000-000000000001';
update auth.users set deleted_at=now() where id='c0100000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.staff_claims();
select is(pg_temp.staff_claims(),false,'deleted auth user denies admission immediately');
select is(pg_temp.routine_access('health.write'),false,'deleted auth user denies routine write assurance');
select is((select count(*)::integer from public.active_memberships),0,'deleted auth user hides tenant context');
select is((select count(*)::integer from public.measurements),0,'deleted auth user hides prior source rows');
select throws_ok($$select pg_temp.vitals()$$,'42501',null,'deleted auth user blocks even exact replay');
reset role;
select set_config('request.jwt.claims','{}',true);
update auth.users set deleted_at=null where id='c0100000-0000-4000-8000-000000000001';
update auth.sessions set not_after=now()-interval '1 minute' where id='c0300000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.staff_claims();
select is(pg_temp.staff_claims(),false,'expired auth session denies admission immediately');
select is(pg_temp.routine_access('health.write'),false,'expired auth session denies routine write assurance');
select is((select count(*)::integer from public.active_memberships),0,'expired auth session hides tenant context');
select is((select count(*)::integer from public.measurements),0,'expired auth session hides prior source rows');
select throws_ok($$select pg_temp.vitals()$$,'42501',null,'expired auth session blocks even exact replay');
reset role;
select set_config('request.jwt.claims','{}',true);
update auth.sessions set not_after=null where id='c0300000-0000-4000-8000-000000000001';
update auth.identities set identity_data=identity_data||'{"hd":"different.example.invalid"}' where id='c0200000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.staff_claims();
select is(pg_temp.staff_claims(),false,'mismatched provider company domain denies admission immediately');
select is(pg_temp.routine_access('health.write'),false,'mismatched provider company domain denies routine write assurance');
select is((select count(*)::integer from public.active_memberships),0,'mismatched provider company domain hides tenant context');
select is((select count(*)::integer from public.measurements),0,'mismatched provider company domain hides prior source rows');
select throws_ok($$select pg_temp.vitals()$$,'42501',null,'mismatched provider company domain blocks even exact replay');
reset role;
select set_config('request.jwt.claims','{}',true);
update auth.identities set identity_data=identity_data||'{"hd":"care.example.invalid"}' where id='c0200000-0000-4000-8000-000000000001';
update auth.identities set identity_data=identity_data||'{"email_verified":false}' where id='c0200000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.staff_claims();
select is(pg_temp.staff_claims(),false,'unverified provider email denies admission immediately');
select is(pg_temp.routine_access('health.write'),false,'unverified provider email denies routine write assurance');
select is((select count(*)::integer from public.active_memberships),0,'unverified provider email hides tenant context');
select is((select count(*)::integer from public.measurements),0,'unverified provider email hides prior source rows');
select throws_ok($$select pg_temp.vitals()$$,'42501',null,'unverified provider email blocks even exact replay');
reset role;
select set_config('request.jwt.claims','{}',true);
update auth.identities set identity_data=identity_data||'{"email_verified":true}' where id='c0200000-0000-4000-8000-000000000001';
update private.staff_google_access_grants set google_subject='wrong-subject';
set local role authenticated;
select pg_temp.staff_claims();
select is(pg_temp.staff_claims(),false,'wrong stable Google subject denies admission immediately');
select is(pg_temp.routine_access('health.write'),false,'wrong stable Google subject denies routine write assurance');
select is((select count(*)::integer from public.active_memberships),0,'wrong stable Google subject hides tenant context');
select is((select count(*)::integer from public.measurements),0,'wrong stable Google subject hides prior source rows');
select throws_ok($$select pg_temp.vitals()$$,'42501',null,'wrong stable Google subject blocks even exact replay');
reset role;
select set_config('request.jwt.claims','{}',true);
update private.staff_google_access_grants set google_subject='synthetic-routine-worker';
set local role authenticated;
select pg_temp.staff_claims();
select is(pg_temp.staff_claims(),true,'restored real company session remains usable');
select is(pg_temp.staff_claims('{"sub":"malformed"}'),false,'malformed subject is denied');
select is(pg_temp.staff_claims('{"session_id":"c0300000-0000-4000-8000-000000000002"}'),false,'foreign owned session is denied');
select is(pg_temp.staff_claims('{"session_id":"c0300000-0000-4000-8000-000000000099"}'),false,'missing revoked session is denied');
select is(pg_temp.staff_claims('{"aal":"aal2"}'),false,'fabricated AAL2 without real TOTP is denied');
select is(pg_temp.staff_claims('{"email":"someone@care.example.invalid"}'),false,'different email despite company domain is denied');
select is(pg_temp.staff_claims('{"is_anonymous":true}'),false,'anonymous session is denied');
select is(pg_temp.staff_claims('{"client_id":"synthetic-oauth-app"}'),false,'third-party OAuth client token is denied');
select is(pg_temp.staff_claims('{"sub":"c0100000-0000-4000-8000-000000000002","session_id":"c0300000-0000-4000-8000-000000000002","email":"other@care.example.invalid","user_metadata":{"role":"organization_manager","provider":"google","hd":"care.example.invalid"}}'),false,'uninvited company account with forged user metadata is denied');
select is(pg_temp.staff_claims(jsonb_build_object('exp',floor(extract(epoch from now()-interval '1 minute')))),false,'expired JWT denied');
select is(pg_temp.staff_claims(jsonb_build_object('iat',floor(extract(epoch from now()-interval '2 hours')))),false,'stale JWT denied');
select is(pg_temp.staff_claims(jsonb_build_object('amr',jsonb_build_array(jsonb_build_object('method','password','timestamp',current_setting('test.routine_amr')::bigint)))),false,'password AMR does not become Google through linked identity');
select is(pg_temp.staff_claims(jsonb_build_object('amr',jsonb_build_array(jsonb_build_object('method','oauth','timestamp',current_setting('test.routine_amr')::bigint+1)))),false,'AMR timestamp must match actual session evidence');
reset role;
select set_config('request.jwt.claims','{}',true);
insert into auth.identities(id,provider_id,user_id,identity_data,provider) values
 ('c0200000-0000-4000-8000-000000000003','synthetic-linked-github','c0100000-0000-4000-8000-000000000001','{"sub":"synthetic-linked-github"}','github');
set local role authenticated;
select pg_temp.staff_claims();
select is(pg_temp.staff_claims(),false,'another OAuth provider makes session provenance ambiguous and denied');
reset role;
select set_config('request.jwt.claims','{}',true);
delete from auth.identities where id='c0200000-0000-4000-8000-000000000003';
select throws_ok($$insert into private.staff_google_access_grants(allowed_user_id,organization_id,company_email_domain,allowed_email,google_subject,enabled,approval_reference)
 values('c0100000-0000-4000-8000-000000000002','c0500000-0000-4000-8000-000000000001','gmail.com','personal@gmail.com','synthetic-personal',true,'Synthetic invalid personal approval')$$,'23514',null,'personal Gmail cannot be provisioned as approved company email');
update public.client_assignments set ends_at=now()-interval '1 minute' where assignee_user_id='c0100000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.staff_claims();
select is(pg_temp.staff_claims(),true,'assignment revocation does not need global logout');
select is(pg_temp.directory(),0,'revoked client assignment immediately removes directory entry');
select is((select count(*)::integer from public.client_assignments),0,'expired assignments are hidden from direct assignment source');
select is((select count(*)::integer from public.measurements),0,'revoked assignment immediately hides source rows');
select throws_ok($$select pg_temp.draft(gen_random_uuid())$$,'42501',null,'revoked assignment blocks draft writes');
select throws_ok($$select pg_temp.diary()$$,'42501',null,'revoked assignment blocks snapshot RPC');
reset role;
select set_config('request.jwt.claims','{}',true);
update public.client_assignments set ends_at=null where assignee_user_id='c0100000-0000-4000-8000-000000000001';
update public.role_permissions set granted_at=now()+interval '1 day' where role_id='10000000-0000-4000-8000-000000000006'
 and permission_id=(select id from public.permissions where permission_key='health.write');
set local role authenticated;
select pg_temp.staff_claims();
select is(pg_temp.routine_access('health.write'),false,'future permission grant cannot authorize measurement writes');
select throws_ok($$select pg_temp.vitals(gen_random_uuid())$$,'42501',null,'future permission also enforced by actual mutation RPC');
reset role;
select set_config('request.jwt.claims','{}',true);
update public.role_permissions set granted_at=now() where role_id='10000000-0000-4000-8000-000000000006';
-- A read-only diary grant is not silently upgraded into write capability.
update auth.identities set identity_data=identity_data-'hd' where id='c0200000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.staff_claims();
select is(public.is_staff_login_allowed(),true,'individually approved verified company Google account does not require Workspace hd');
select is(pg_temp.routine_access('health.write'),true,'exact pinned company identity without optional hd retains routine access');
reset role;
select set_config('request.jwt.claims','{}',true);
update private.staff_google_access_grants set enabled=false;
set local role authenticated;
select pg_temp.staff_claims();
select is(public.is_staff_login_allowed(),false,'missing hd is never a replacement for explicit enabled approval');
reset role;
select set_config('request.jwt.claims','{}',true);
update private.staff_google_access_grants set enabled=true;
update auth.identities set identity_data=identity_data||'{"email_verified":false}' where id='c0200000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.staff_claims();
select is(public.is_staff_login_allowed(),false,'missing hd still requires Google verified exact email');
reset role;
select set_config('request.jwt.claims','{}',true);
update auth.identities set identity_data=identity_data||'{"email_verified":true,"hd":"care.example.invalid"}' where id='c0200000-0000-4000-8000-000000000001';
select ok(not has_table_privilege('authenticated','private.staff_google_access_grants','insert'),'matching company email alone cannot self-provision approval');
update public.role_permissions set granted_at=now()+interval '1 day' where role_id='10000000-0000-4000-8000-000000000006'
 and permission_id=(select id from public.permissions where permission_key='care_records.write');
set local role authenticated;
select pg_temp.staff_claims();
select is(pg_temp.routine_access('care_records.read'),true,'diary read can be permitted without write');
select is(pg_temp.routine_access('care_records.write'),false,'diary read is not write authority');
select lives_ok($$select pg_temp.diary()$$,'read-only diary snapshot remains usable');
select throws_ok($$select pg_temp.draft(gen_random_uuid())$$,'42501',null,'read-only diary role cannot create draft');
reset role;
select set_config('request.jwt.claims','{}',true);
update public.role_permissions set granted_at=now() where role_id='10000000-0000-4000-8000-000000000006';
select throws_ok($$update private.staff_google_access_grants set allowed_user_id='c0100000-0000-4000-8000-000000000002'$$,'23514',null,'approved target UUID cannot be rewritten');
select throws_ok($$update private.staff_google_access_grants set organization_id='c0500000-0000-4000-8000-000000000002'$$,'23514',null,'approved organization cannot be silently moved');
delete from private.staff_google_access_grants;
set local role authenticated;
select pg_temp.staff_claims();
select is(pg_temp.staff_claims(),false,'deleting approval revokes all admission');
select throws_ok($$select pg_temp.vitals(gen_random_uuid())$$,'42501',null,'deleted approval revokes new writes');
reset role;
select set_config('request.jwt.claims','{}',true);
select ok(exists(select 1 from public.audit_events where table_name='private.staff_google_access_grants' and action='insert'
 and row_pk='c0100000-0000-4000-8000-000000000001'),'grant audit retains exact target UUID');
select ok(exists(select 1 from public.audit_events where table_name='private.staff_google_access_grants' and action='update'
 and row_pk='c0100000-0000-4000-8000-000000000001' and changed_fields @> array['enabled']),'revocation audit retains exact target UUID and changed fields');
select ok(exists(select 1 from public.audit_events where table_name='private.staff_google_access_grants' and action='delete'
 and row_pk='c0100000-0000-4000-8000-000000000001'),'deleted grant remains attributable in audit');
select ok(not exists(select 1 from public.audit_events where table_name='private.staff_google_access_grants' and row_pk is null),'all grant changes have a target');
select ok((select bool_and(actor_user_id is null and metadata->'system_actor'='true'::jsonb) from public.audit_events
 where table_name='private.staff_google_access_grants'),'database owner provisioning without Auth is not falsely attributed to a person');
select ok((select bool_and(metadata->>'approval_reference_sha256' ~ '^[0-9a-f]{64}$') from public.audit_events
 where table_name='private.staff_google_access_grants'),'audit holds hash linkage instead of raw approval text');
select ok(not exists(select 1 from public.audit_events where table_name='private.staff_google_access_grants'
 and (metadata::text like '%worker@%' or metadata::text like '%synthetic-routine-worker%' or metadata::text like '%Synthetic independent authorization%')),'audit metadata contains no raw email subject or approval text');
select ok(not has_function_privilege('authenticated','private.audit_staff_google_access_grant()','execute'),'grant audit trigger helper is not callable by API roles');
select ok((select not prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid='private.audit_staff_google_access_grant()'::regprocedure),'grant audit is invoker with empty search path');
select * from finish();
rollback;
