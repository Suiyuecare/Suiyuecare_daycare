begin;
select plan(295);

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
 ('c0500000-0000-4000-8000-000000000001','c0600000-0000-4000-8000-000000000001','c0800000-0000-4000-8000-000000000001',(clock_timestamp() at time zone 'Asia/Taipei')::date,'morning','c0100000-0000-4000-8000-000000000001',1,'scheduled','Synthetic plan','["temperature","care_diary"]','c0100000-0000-4000-8000-000000000001'),
 ('c0500000-0000-4000-8000-000000000001','c0600000-0000-4000-8000-000000000001','c0800000-0000-4000-8000-000000000001',(clock_timestamp() at time zone 'Asia/Taipei')::date,'afternoon','c0100000-0000-4000-8000-000000000001',1,'scheduled','Synthetic plan','["temperature"]','c0100000-0000-4000-8000-000000000001'),
 ('c0500000-0000-4000-8000-000000000001','c0600000-0000-4000-8000-000000000001','c0800000-0000-4000-8000-000000000002',(clock_timestamp() at time zone 'Asia/Taipei')::date,'morning','c0100000-0000-4000-8000-000000000001',1,'scheduled','Synthetic unassigned','["temperature"]','c0100000-0000-4000-8000-000000000001');

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
select is((select jsonb_array_length(payload->'assignments') from public.care_roster_snapshot('c0500000-0000-4000-8000-000000000001','c0600000-0000-4000-8000-000000000001',(clock_timestamp() at time zone 'Asia/Taipei')::date)),2,'roster exposes self assigned shifts only');
select is((select payload->'manager' from public.care_roster_snapshot('c0500000-0000-4000-8000-000000000001','c0600000-0000-4000-8000-000000000001',(clock_timestamp() at time zone 'Asia/Taipei')::date)),'false'::jsonb,'routine approval does not grant roster manager');
select throws_ok($$select public.save_care_roster('c0500000-0000-4000-8000-000000000001','c0600000-0000-4000-8000-000000000001','{}')$$,'42501',null,'roster write stays high risk');
select throws_ok($$select pg_temp.attendance()$$,'42501',
 'care worker check-in requires first vital or approved exception',
 'legacy direct care worker check-in cannot bypass the first vital');
select is((public.record_first_vital_arrival('c0500000-0000-4000-8000-000000000001',
 'c0600000-0000-4000-8000-000000000001','c0800000-0000-4000-8000-000000000001',
 'c0900000-0000-4000-8000-000000000001',null,null,72,null,null)->>'replayed')::boolean,
 false,'combined first-vital arrival creates the ordinary attendance');
select is((select count(*)::integer from generate_series(1,10) n where pg_temp.attendance(
 'c0900000-0000-4000-8000-000000000001',
 'c0800000-0000-4000-8000-000000000001',
 (select checked_in_at from public.attendance_records where client_id='c0800000-0000-4000-8000-000000000001'
  and correction_of_id is null),'check_in',null)),10,
 'ten exact legacy attendance retries remain replay receipts');
select is((select count(*)::integer from public.attendance_records),1,'ten replays leave one attendance row');
select throws_ok($$select pg_temp.attendance('c0900000-0000-4000-8000-000000000001','c0800000-0000-4000-8000-000000000001',current_setting('test.routine_now')::timestamptz,'leave','different')$$,'23505',null,'same attendance key with changed payload conflicts');
select throws_ok($$select pg_temp.attendance(gen_random_uuid(),'c0800000-0000-4000-8000-000000000002')$$,'42501',null,'direct attendance RPC denies unassigned case');
select throws_ok($$select pg_temp.attendance(gen_random_uuid(),'c0800000-0000-4000-8000-000000000003')$$,'42501',null,'direct attendance RPC denies actor-supplied branch forgery');
select throws_ok($$select pg_temp.attendance(gen_random_uuid(),'c0800000-0000-4000-8000-000000000001',now()-interval '1 hour','check_out','Synthetic backfill')$$,'42501',null,'routine AAL1 cannot backfill attendance');
select is(pg_temp.vitals(),false,'assigned AAL1 measurement commits');
select is((select count(*)::integer from generate_series(1,10) n where pg_temp.vitals()),10,'ten identical vital replays are receipts');
select is((select count(*)::integer from public.measurements),2,'combined arrival and later measurement both persist');
select is((select numeric_value from public.measurements where measurement_set_id='c0900000-0000-4000-8000-000000000002'),36.5::numeric,'source value reads back unchanged');
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

-- Explicit immediate first-vital arrival is distinct from retrospective or
-- device measurements. Fixtures are synthetic and the whole pgTAP file rolls
-- back; no hosted or production record is touched.
reset role;
select set_config('request.jwt.claims','{}',true);
insert into public.clients(id,organization_id,branch_id,client_code,display_name,admitted_on) values
 ('c0800000-0000-4000-8000-000000000005','c0500000-0000-4000-8000-000000000001','c0600000-0000-4000-8000-000000000001','SYN-ARRIVAL-5','Synthetic invalid first measurement',(clock_timestamp() at time zone 'Asia/Taipei')::date-10),
 ('c0800000-0000-4000-8000-000000000006','c0500000-0000-4000-8000-000000000001','c0600000-0000-4000-8000-000000000001','SYN-ARRIVAL-6','Synthetic first arrival',(clock_timestamp() at time zone 'Asia/Taipei')::date-10),
 ('c0800000-0000-4000-8000-000000000007','c0500000-0000-4000-8000-000000000001','c0600000-0000-4000-8000-000000000001','SYN-ARRIVAL-7','Synthetic no-bypass vital',(clock_timestamp() at time zone 'Asia/Taipei')::date-10),
 ('c0800000-0000-4000-8000-000000000008','c0500000-0000-4000-8000-000000000001','c0600000-0000-4000-8000-000000000001','SYN-ARRIVAL-8','Synthetic text-only note',(clock_timestamp() at time zone 'Asia/Taipei')::date-10),
 ('c0800000-0000-4000-8000-000000000013','c0500000-0000-4000-8000-000000000001','c0600000-0000-4000-8000-000000000001','SYN-ARRIVAL-13','Synthetic cancelled daily slot',(clock_timestamp() at time zone 'Asia/Taipei')::date-10),
 ('c0800000-0000-4000-8000-000000000014','c0500000-0000-4000-8000-000000000001','c0600000-0000-4000-8000-000000000001','SYN-ARRIVAL-14','Synthetic no daily slot',(clock_timestamp() at time zone 'Asia/Taipei')::date-10);
insert into public.client_assignments(organization_id,branch_id,client_id,assignee_user_id,assignment_kind,starts_at)
select organization_id,branch_id,id,'c0100000-0000-4000-8000-000000000001','routine_arrival_test',now()-interval '1 day'
from public.clients where id in ('c0800000-0000-4000-8000-000000000005','c0800000-0000-4000-8000-000000000006','c0800000-0000-4000-8000-000000000007','c0800000-0000-4000-8000-000000000008',
 'c0800000-0000-4000-8000-000000000013','c0800000-0000-4000-8000-000000000014');
insert into private.care_roster_versions(organization_id,branch_id,client_id,service_date,shift,staff_user_id,version,state,source_note,tasks,created_by)
select c.organization_id,c.branch_id,c.id,(clock_timestamp() at time zone 'Asia/Taipei')::date,s.shift,
 'c0100000-0000-4000-8000-000000000001',1,'scheduled','Synthetic daily slot','["pulse"]'::jsonb,
 'c0100000-0000-4000-8000-000000000001'
from public.clients c cross join (values ('morning'),('afternoon')) s(shift)
where c.id in ('c0800000-0000-4000-8000-000000000005','c0800000-0000-4000-8000-000000000006',
 'c0800000-0000-4000-8000-000000000007','c0800000-0000-4000-8000-000000000008',
 'c0800000-0000-4000-8000-000000000013');
insert into private.care_roster_versions(organization_id,branch_id,client_id,service_date,shift,staff_user_id,version,state,source_note,tasks,created_by)
select c.organization_id,c.branch_id,c.id,(clock_timestamp() at time zone 'Asia/Taipei')::date,s.shift,
 'c0100000-0000-4000-8000-000000000001',2,'cancelled','Synthetic cancelled slot','[]'::jsonb,
 'c0100000-0000-4000-8000-000000000001'
from public.clients c cross join (values ('morning'),('afternoon')) s(shift)
where c.id='c0800000-0000-4000-8000-000000000013';
insert into public.clients(id,organization_id,branch_id,client_code,display_name,status,admitted_on,ended_on) values
 ('c0800000-0000-4000-8000-000000000015','c0500000-0000-4000-8000-000000000001','c0600000-0000-4000-8000-000000000001','SYN-ARRIVAL-15','Synthetic future closure','active',(clock_timestamp() at time zone 'Asia/Taipei')::date-10,(clock_timestamp() at time zone 'Asia/Taipei')::date+3),
 ('c0800000-0000-4000-8000-000000000016','c0500000-0000-4000-8000-000000000001','c0600000-0000-4000-8000-000000000001','SYN-ARRIVAL-16','Synthetic closure today','active',(clock_timestamp() at time zone 'Asia/Taipei')::date-10,(clock_timestamp() at time zone 'Asia/Taipei')::date),
 ('c0800000-0000-4000-8000-000000000017','c0500000-0000-4000-8000-000000000001','c0600000-0000-4000-8000-000000000001','SYN-ARRIVAL-17','Synthetic suspended today','suspended',(clock_timestamp() at time zone 'Asia/Taipei')::date-10,null);
insert into public.client_assignments(organization_id,branch_id,client_id,assignee_user_id,assignment_kind,starts_at)
select organization_id,branch_id,id,'c0100000-0000-4000-8000-000000000001','routine_lifecycle_test',now()-interval '1 day'
from public.clients where id in ('c0800000-0000-4000-8000-000000000015','c0800000-0000-4000-8000-000000000016','c0800000-0000-4000-8000-000000000017');
insert into private.care_roster_versions(organization_id,branch_id,client_id,service_date,shift,staff_user_id,version,state,source_note,tasks,created_by)
select c.organization_id,c.branch_id,c.id,(clock_timestamp() at time zone 'Asia/Taipei')::date,s.shift,
 'c0100000-0000-4000-8000-000000000001',1,'scheduled','Synthetic lifecycle slot','["pulse"]'::jsonb,
 'c0100000-0000-4000-8000-000000000001'
from public.clients c cross join (values ('morning'),('afternoon')) s(shift)
where c.id in ('c0800000-0000-4000-8000-000000000015','c0800000-0000-4000-8000-000000000016','c0800000-0000-4000-8000-000000000017');
insert into public.measurements(organization_id,branch_id,client_id,measurement_kind,measured_at,
 text_value,source,recorded_by,idempotency_key)
values('c0500000-0000-4000-8000-000000000001','c0600000-0000-4000-8000-000000000001',
 'c0800000-0000-4000-8000-000000000008','pulse',clock_timestamp(),
 'Synthetic device refusal note','staff','c0100000-0000-4000-8000-000000000001',gen_random_uuid());
set local role authenticated;
select pg_temp.staff_claims();
select ok(has_function_privilege('authenticated','public.record_first_vital_arrival(uuid,uuid,uuid,uuid,numeric,numeric,numeric,numeric,numeric,date)','execute')
 and not has_function_privilege('anon','public.record_first_vital_arrival(uuid,uuid,uuid,uuid,numeric,numeric,numeric,numeric,numeric,date)','execute'),
 'explicit arrival RPC is authenticated-only');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='private.vital_arrival_operations'::regclass)
 and not has_table_privilege('authenticated','private.vital_arrival_operations','select,insert,update,delete'),
 'arrival provenance is private and RLS-forced');
select throws_ok($$select public.record_first_vital_arrival('c0500000-0000-4000-8000-000000000001','c0600000-0000-4000-8000-000000000001',
 'c0800000-0000-4000-8000-000000000005','c0900000-0000-4000-8000-000000000105',null,null,null,500,null)$$,
 '22023','one or more vital-sign values are outside the technical input range','invalid vital rolls back proposed arrival');
select is((select count(*)::integer from public.attendance_records where client_id='c0800000-0000-4000-8000-000000000005'),0,
 'failed vital creates no attendance');
select is((select count(*)::integer from public.measurements where client_id='c0800000-0000-4000-8000-000000000005'),0,
 'failed vital creates no measurements');
select is((public.record_first_vital_arrival('c0500000-0000-4000-8000-000000000001','c0600000-0000-4000-8000-000000000001',
 'c0800000-0000-4000-8000-000000000006','c0900000-0000-4000-8000-000000000106',null,null,76,null,null)->>'replayed')::boolean,false,
 'approved AAL1 care worker explicitly saves an immediate first vital and arrival');
select ok(exists(select 1 from public.attendance_records a join public.measurements m on m.client_id=a.client_id
 where a.client_id='c0800000-0000-4000-8000-000000000006' and a.checked_in_at=m.measured_at
 and a.source='staff' and m.source='staff' and a.status='present'),
 'attendance and first vital share one server-chosen time');
select is((public.record_first_vital_arrival('c0500000-0000-4000-8000-000000000001','c0600000-0000-4000-8000-000000000001',
 'c0800000-0000-4000-8000-000000000006','c0900000-0000-4000-8000-000000000106',null,null,76,null,null)->>'replayed')::boolean,true,
 'exact retry returns the combined durable operation');
select is((select count(*)::integer from public.attendance_records where client_id='c0800000-0000-4000-8000-000000000006'),1,
 'retry never duplicates attendance');
select is((select count(*)::integer from public.measurements where client_id='c0800000-0000-4000-8000-000000000006'),1,
 'retry never duplicates the measurement');
select throws_ok($$select public.record_first_vital_arrival('c0500000-0000-4000-8000-000000000001','c0600000-0000-4000-8000-000000000001',
 'c0800000-0000-4000-8000-000000000006','c0900000-0000-4000-8000-000000000106',null,null,77,null,null)$$,
 '23505','vital-sign idempotency conflict','changed vital with same arrival key is rejected');
select throws_ok($$select public.record_first_vital_arrival('c0500000-0000-4000-8000-000000000001','c0600000-0000-4000-8000-000000000001',
 'c0800000-0000-4000-8000-000000000002','c0900000-0000-4000-8000-000000000108',null,null,76,null,null)$$,
 '42501','vital arrival client scope is not permitted','unassigned client cannot gain arrival through combined RPC');
select throws_ok($$select public.record_vital_set('c0500000-0000-4000-8000-000000000001','c0600000-0000-4000-8000-000000000001',
 'c0800000-0000-4000-8000-000000000007',clock_timestamp(),'c0900000-0000-4000-8000-000000000107',null,null,72,null,null)$$,
 '23514','first same-day care-worker vital requires confirmed case arrival','care worker cannot bypass arrival with standalone first vital');
select is((select count(*)::integer from public.measurements where client_id='c0800000-0000-4000-8000-000000000007'),0,
 'rejected standalone first vital leaves no measurement');
select is((public.record_first_vital_arrival('c0500000-0000-4000-8000-000000000001','c0600000-0000-4000-8000-000000000001',
 'c0800000-0000-4000-8000-000000000007','c0900000-0000-4000-8000-000000000109',null,null,73,null,null)->>'replayed')::boolean,false,
 'first vital through combined action creates case arrival');
select is((select count(*)::integer from public.record_vital_set('c0500000-0000-4000-8000-000000000001','c0600000-0000-4000-8000-000000000001',
 'c0800000-0000-4000-8000-000000000007',clock_timestamp(),'c0900000-0000-4000-8000-000000000110',null,null,74,null,null)),1,
 'later vital remains independent after confirmed case arrival');
select is((public.record_first_vital_arrival('c0500000-0000-4000-8000-000000000001','c0600000-0000-4000-8000-000000000001',
 'c0800000-0000-4000-8000-000000000008','c0900000-0000-4000-8000-000000000111',null,null,75,null,null)->>'replayed')::boolean,false,
 'text-only refusal note does not block first effective numeric vital arrival');
select is((select count(*)::integer from public.measurements where client_id='c0800000-0000-4000-8000-000000000008'
 and numeric_value is not null),1,'text-only note and first numeric vital remain distinct');
select throws_ok($$select public.record_first_vital_arrival('c0500000-0000-4000-8000-000000000001',
 'c0600000-0000-4000-8000-000000000001','c0800000-0000-4000-8000-000000000013',gen_random_uuid(),
 null,null,72,null,null)$$,'23514','current care roster does not authorize arrival',
 'a newer cancelled shift cannot create official attendance');
select throws_ok($$select public.record_first_vital_arrival('c0500000-0000-4000-8000-000000000001',
 'c0600000-0000-4000-8000-000000000001','c0800000-0000-4000-8000-000000000014',gen_random_uuid(),
 null,null,72,null,null)$$,'23514','current care roster does not authorize arrival',
 'a durable client assignment without a daily slot cannot auto-check in');
select is((select count(*)::integer from public.attendance_records where client_id in
 ('c0800000-0000-4000-8000-000000000013','c0800000-0000-4000-8000-000000000014')),0,
 'off-roster attempts leave no formal attendance');
select is((select count(*)::integer from public.measurements where client_id in
 ('c0800000-0000-4000-8000-000000000013','c0800000-0000-4000-8000-000000000014')),0,
 'off-roster attempts leave no vital rows');
select throws_ok($$select public.record_first_vital_arrival('c0500000-0000-4000-8000-000000000001',
 'c0600000-0000-4000-8000-000000000001','c0800000-0000-4000-8000-000000000014',gen_random_uuid(),
 null,null,72,null,null,(clock_timestamp() at time zone 'Asia/Taipei')::date-1)$$,
 '23514','arrival service date changed; refresh today work',
 'a stale previous-day page cannot silently create next-day attendance');
select is((public.record_first_vital_arrival('c0500000-0000-4000-8000-000000000001',
 'c0600000-0000-4000-8000-000000000001','c0800000-0000-4000-8000-000000000006',
 'c0900000-0000-4000-8000-000000000106',null,null,76,null,null,
 (clock_timestamp() at time zone 'Asia/Taipei')::date-1)->>'replayed')::boolean,true,
 'a prior confirmed arrival replays by key even after the visible service day changes');
select is((public.record_first_vital_arrival('c0500000-0000-4000-8000-000000000001',
 'c0600000-0000-4000-8000-000000000001','c0800000-0000-4000-8000-000000000015',gen_random_uuid(),
 null,null,72,null,null)->>'replayed')::boolean,false,
 'future scheduled service closure does not block an eligible today arrival');
select is((select count(*)::integer from public.attendance_records a join public.measurements m on m.client_id=a.client_id
 where a.client_id='c0800000-0000-4000-8000-000000000015' and a.checked_in_at=m.measured_at),1,
 'effective-day vital and attendance writers agree before a future closure');
select throws_ok($$select public.record_first_vital_arrival('c0500000-0000-4000-8000-000000000001',
 'c0600000-0000-4000-8000-000000000001','c0800000-0000-4000-8000-000000000016',gen_random_uuid(),
 null,null,72,null,null)$$,'23514','client is not active and admitted today',
 'inclusive closure date cannot become formal arrival');
select throws_ok($$select public.record_first_vital_arrival('c0500000-0000-4000-8000-000000000001',
 'c0600000-0000-4000-8000-000000000001','c0800000-0000-4000-8000-000000000017',gen_random_uuid(),
 null,null,72,null,null)$$,'23514','client is not active and admitted today',
 'suspended service date cannot become formal arrival');
reset role;
select throws_ok($$insert into public.measurements(organization_id,branch_id,client_id,measurement_kind,
 measured_at,numeric_value,unit,source,recorded_by,idempotency_key)
 values('c0500000-0000-4000-8000-000000000001','c0600000-0000-4000-8000-000000000001',
 'c0800000-0000-4000-8000-000000000014','pulse',
 (((clock_timestamp() at time zone 'Asia/Taipei')::date+1)::timestamp at time zone 'Asia/Taipei'),
 72,'bpm','staff','c0100000-0000-4000-8000-000000000001',gen_random_uuid())$$,
 '23514','first same-day care-worker vital requires confirmed case arrival',
 'near-midnight future-day numeric vital cannot bypass arrival via a direct writer');

-- A refused/device-failure/emergency check-in is not attendance until an
-- independent branch director accepts the scoped request. All fixtures are
-- synthetic and this pgTAP transaction rolls back.
reset role;
select set_config('request.jwt.claims','{}',true);
insert into public.clients(id,organization_id,branch_id,client_code,display_name,admitted_on) values
 ('c0800000-0000-4000-8000-000000000009','c0500000-0000-4000-8000-000000000001','c0600000-0000-4000-8000-000000000001','SYN-EXCEPTION-9','Synthetic refused vital',(clock_timestamp() at time zone 'Asia/Taipei')::date-10),
 ('c0800000-0000-4000-8000-000000000010','c0500000-0000-4000-8000-000000000001','c0600000-0000-4000-8000-000000000001','SYN-EXCEPTION-10','Synthetic device failure',(clock_timestamp() at time zone 'Asia/Taipei')::date-10),
 ('c0800000-0000-4000-8000-000000000011','c0500000-0000-4000-8000-000000000001','c0600000-0000-4000-8000-000000000001','SYN-EXCEPTION-11','Synthetic cancelled exception',(clock_timestamp() at time zone 'Asia/Taipei')::date-10),
 ('c0800000-0000-4000-8000-000000000012','c0500000-0000-4000-8000-000000000001','c0600000-0000-4000-8000-000000000001','SYN-EXCEPTION-12','Synthetic prior nurse measurement',(clock_timestamp() at time zone 'Asia/Taipei')::date-10);
insert into public.client_assignments(organization_id,branch_id,client_id,assignee_user_id,assignment_kind,starts_at)
select organization_id,branch_id,id,'c0100000-0000-4000-8000-000000000001','routine_exception_test',now()-interval '1 day'
from public.clients where id in ('c0800000-0000-4000-8000-000000000009','c0800000-0000-4000-8000-000000000010','c0800000-0000-4000-8000-000000000011','c0800000-0000-4000-8000-000000000012');
insert into private.care_roster_versions(organization_id,branch_id,client_id,service_date,shift,staff_user_id,version,state,source_note,tasks,created_by)
select c.organization_id,c.branch_id,c.id,(clock_timestamp() at time zone 'Asia/Taipei')::date,s.shift,
 'c0100000-0000-4000-8000-000000000001',1,'scheduled','Synthetic exception cancellation slot','["pulse"]'::jsonb,
 'c0100000-0000-4000-8000-000000000001'
from public.clients c cross join (values ('morning'),('afternoon')) s(shift)
where c.id in ('c0800000-0000-4000-8000-000000000009','c0800000-0000-4000-8000-000000000011');
insert into public.measurements(id,organization_id,branch_id,client_id,measurement_kind,measured_at,
 numeric_value,unit,source,recorded_by,idempotency_key)
values('c0a00000-0000-4000-8000-000000000012',
 'c0500000-0000-4000-8000-000000000001','c0600000-0000-4000-8000-000000000001',
 'c0800000-0000-4000-8000-000000000012','pulse',
 greatest((clock_timestamp() at time zone 'Asia/Taipei')::date::timestamp at time zone 'Asia/Taipei',clock_timestamp()-interval '1 minute'),
 72,'bpm','device',null,gen_random_uuid());
select set_config('test.measurement_at',(select measured_at::text from public.measurements
 where id='c0a00000-0000-4000-8000-000000000012'),true);
delete from public.membership_roles where membership_id='c0700000-0000-4000-8000-000000000002';
insert into public.membership_roles(membership_id,role_id)
values('c0700000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000011');
insert into private.staff_google_access_grants(allowed_user_id,organization_id,company_email_domain,allowed_email,google_subject,enabled,approval_reference)
values('c0100000-0000-4000-8000-000000000002','c0500000-0000-4000-8000-000000000001','care.example.invalid','other@care.example.invalid','synthetic-routine-other',true,'Synthetic independent director approval');
create function pg_temp.director_claims(p_aal text default 'aal1') returns boolean language plpgsql security invoker as $$
begin
 perform set_config('request.jwt.claims',jsonb_build_object(
  'sub','c0100000-0000-4000-8000-000000000002','session_id','c0300000-0000-4000-8000-000000000002',
  'aud','authenticated','role','authenticated','aal',p_aal,'email','other@care.example.invalid','is_anonymous',false,
  'iat',floor(extract(epoch from clock_timestamp())),'exp',floor(extract(epoch from clock_timestamp()+interval '30 minutes')),
  'amr',jsonb_build_array(jsonb_build_object('method','oauth','timestamp',current_setting('test.routine_amr')::bigint))
    || case when p_aal='aal2' then jsonb_build_array(jsonb_build_object('method','totp','timestamp',current_setting('test.routine_totp')::bigint)) else '[]'::jsonb end)::text,true);
 return public.is_staff_login_allowed();
end; $$;
create function pg_temp.exception_request(p_client uuid default 'c0800000-0000-4000-8000-000000000009',
 p_reason text default 'refused',p_key uuid default 'c0900000-0000-4000-8000-000000000201',
 p_expected_service_date date default (clock_timestamp() at time zone 'Asia/Taipei')::date) returns jsonb
language sql security invoker as $$
 select public.request_attendance_exception('c0500000-0000-4000-8000-000000000001',
  'c0600000-0000-4000-8000-000000000001',p_client,p_expected_service_date,p_reason,'Synthetic reason',p_key); $$;
create function pg_temp.exception_decide(p_request uuid,p_action text,p_key uuid,
 p_note text default null,p_arrival timestamptz default null) returns jsonb language sql security invoker as $$
 select public.decide_attendance_exception('c0500000-0000-4000-8000-000000000001',
  'c0600000-0000-4000-8000-000000000001',p_request,p_action,p_note,p_arrival,p_key); $$;
set local role authenticated;
select pg_temp.staff_claims();
select is(public.can_begin_staff_mfa(),false,'care worker cannot begin director exception AAL2 challenge');
reset role;
insert into public.membership_roles(membership_id,role_id) values
 ('c0700000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000005');
set local role authenticated;
select pg_temp.staff_claims();
select throws_ok($$select pg_temp.attendance(gen_random_uuid(),
 'c0800000-0000-4000-8000-000000000010')$$,
 '42501','care worker check-in requires first vital or approved exception',
 'care worker with concurrent nursing role cannot bypass first-vital arrival through legacy check-in');
reset role;
delete from public.membership_roles where membership_id='c0700000-0000-4000-8000-000000000001'
 and role_id='10000000-0000-4000-8000-000000000005';
set local role authenticated;
select pg_temp.staff_claims();
select ok(strpos(pg_get_functiondef('private.can_begin_staff_mfa()'::regprocedure),
 'private.has_any_custom_governance_scope()')>0 and
 strpos(pg_get_functiondef('private.record_aal2_reauth(uuid,text)'::regprocedure),
 'private.has_any_custom_governance_scope()')>0,
 'exception MFA admission retains independent custom-form governance entry');
select ok(not has_function_privilege('authenticated','private.record_attendance_event_atomic(uuid,uuid,uuid,text,timestamptz,text,uuid)','execute')
 and not has_table_privilege('authenticated','public.attendance_records','insert'),
 'care worker cannot bypass checked attendance via private RPC or raw INSERT');
select throws_ok($$select pg_temp.exception_request('c0800000-0000-4000-8000-000000000009',null)$$,
 '22023','invalid attendance exception request','null reason cannot create exception');
select throws_ok($$select pg_temp.exception_request('c0800000-0000-4000-8000-000000000009','measurement_preexisting',gen_random_uuid())$$,
 '23514','no effective first vital exists for measurement reconciliation',
 'measurement reconciliation requires an actual valid numeric vital');
select throws_ok($$select pg_temp.exception_request('c0800000-0000-4000-8000-000000000012','refused',gen_random_uuid())$$,
 '23514','first vital exists; request measurement reconciliation',
 'no-vital exception cannot ignore a preexisting first measurement');
select throws_ok($$select pg_temp.exception_request('c0800000-0000-4000-8000-000000000016','refused',gen_random_uuid())$$,
 '23514','client is not eligible for service today',
 'ended-on-today client cannot enter exception review');
select throws_ok($$select pg_temp.exception_request('c0800000-0000-4000-8000-000000000017','device_failure',gen_random_uuid())$$,
 '23514','client is not eligible for service today',
 'suspended client cannot enter exception review');
select throws_ok($$select pg_temp.exception_request('c0800000-0000-4000-8000-000000000010',
 'device_failure',gen_random_uuid(),(clock_timestamp() at time zone 'Asia/Taipei')::date-1)$$,
 'DAA03','selected service date is no longer today in Taipei',
 'a stale date cannot silently create an exception on the next Taipei service day');
select set_config('test.measurement_exception_id',(pg_temp.exception_request(
 'c0800000-0000-4000-8000-000000000012','measurement_preexisting',
 'c0900000-0000-4000-8000-000000000212')->>'id'),true);
reset role;
select is((select measurement_id from private.attendance_exception_requests
 where id=current_setting('test.measurement_exception_id')::uuid),
 'c0a00000-0000-4000-8000-000000000012'::uuid,
 'reconciliation request freezes first valid measurement provenance');
set local role authenticated;
select pg_temp.staff_claims();
select is((select count(*)::integer from public.attendance_records
 where client_id='c0800000-0000-4000-8000-000000000012'),0,
 'preexisting vital request alone still creates no attendance');
select set_config('test.exception_id',(pg_temp.exception_request()->>'id'),true);
select is((pg_temp.exception_request()->>'replayed')::boolean,true,'same exception request key is an exact replay');
select throws_ok($$select pg_temp.exception_request('c0800000-0000-4000-8000-000000000009',
 'refused','c0900000-0000-4000-8000-000000000201',
 (clock_timestamp() at time zone 'Asia/Taipei')::date-1)$$,
 '23505','attendance exception idempotency conflict',
 'a reused key with a different expected date cannot be silently retargeted');
select throws_ok($$select pg_temp.exception_request('c0800000-0000-4000-8000-000000000009','device_failure')$$,
 '23505','attendance exception idempotency conflict','changed reason with same key conflicts');
select is((select count(*)::integer from public.attendance_records where client_id='c0800000-0000-4000-8000-000000000009'),0,
 'pending exception does not count as signed-in attendance');
select is((public.attendance_exception_snapshot('c0500000-0000-4000-8000-000000000001',
 'c0600000-0000-4000-8000-000000000001',(clock_timestamp() at time zone 'Asia/Taipei')::date,
 'c0800000-0000-4000-8000-000000000009')->'requests'->0->>'status'),'pending',
 'care worker sees their own pending request');
select throws_ok($$select pg_temp.exception_decide(current_setting('test.exception_id')::uuid,'approve',gen_random_uuid())$$,
 '42501','independent branch director decision is required','care worker cannot approve own exception');
select throws_ok($$select public.record_first_vital_arrival('c0500000-0000-4000-8000-000000000001',
 'c0600000-0000-4000-8000-000000000001','c0800000-0000-4000-8000-000000000009',gen_random_uuid(),
 null,null,74,null,null)$$,'23514',
 'pending attendance exception must be cancelled or rejected before first-vital arrival',
 'pending exception blocks competing normal arrival until resolved');
select is((select count(*)::integer from public.measurements where client_id='c0800000-0000-4000-8000-000000000009'),0,
 'competing arrival failure rolls back its vital too');
select throws_ok($$select pg_temp.exception_request('c0800000-0000-4000-8000-000000000002','refused',gen_random_uuid())$$,
 '42501','attendance exception client scope is not permitted','unassigned case request is denied');
reset role;
select set_config('request.jwt.claims','{}',true);
set local role authenticated;
select pg_temp.director_claims();
reset role;
select throws_ok($$insert into public.attendance_records(organization_id,branch_id,client_id,service_date,
 status,checked_in_at,source,correction_reason,idempotency_key,recorded_by)
 select organization_id,branch_id,client_id,service_date,'present',requested_at,
 'staff_backfill','Synthetic forged director backfill',gen_random_uuid(),requester_user_id
 from private.attendance_exception_requests where id=current_setting('test.exception_id')::uuid$$,
 '23514','pending attendance exception must be cancelled or rejected before first-vital arrival',
 'matching backfill fields without approval intent cannot bypass pending review');
set local role authenticated;
select is((public.attendance_exception_snapshot('c0500000-0000-4000-8000-000000000001',
 'c0600000-0000-4000-8000-000000000001',(clock_timestamp() at time zone 'Asia/Taipei')::date,
 null)->>'reviewer')::boolean,true,'branch director can see the pending queue');
select is(public.can_begin_staff_mfa(),true,'scoped branch director can begin the purpose-limited AAL2 challenge');
reset role;
select is((select count(*)::integer from public.audit_events where actor_user_id='c0100000-0000-4000-8000-000000000002'
 and table_name='attendance_exception_requests' and action='select'
 and metadata->>'operation'='attendance_exception_snapshot'),1,
 'director PHI snapshot records a count-only read audit without reason text');
delete from public.role_permissions rp where rp.role_id='10000000-0000-4000-8000-000000000011'
 and rp.permission_id=(select id from public.permissions where permission_key='attendance.read');
set local role authenticated;
select throws_ok($$select public.attendance_exception_snapshot('c0500000-0000-4000-8000-000000000001',
 'c0600000-0000-4000-8000-000000000001',(clock_timestamp() at time zone 'Asia/Taipei')::date,null)$$,
 '42501','attendance exception scope is not permitted','revoking director attendance.read closes whole-branch PHI snapshot');
select throws_ok($$select pg_temp.exception_decide(current_setting('test.exception_id')::uuid,
 'reject',gen_random_uuid(),'Synthetic reviewed refusal')$$,
 '42501','independent branch director decision is required','revoked attendance.read also closes UUID-based director decision');
reset role;
insert into public.role_permissions(role_id,permission_id)
select '10000000-0000-4000-8000-000000000011',id from public.permissions where permission_key='attendance.read';
delete from public.role_permissions rp where rp.role_id='10000000-0000-4000-8000-000000000011'
 and rp.permission_id=(select id from public.permissions where permission_key='clients.read');
set local role authenticated;
select throws_ok($$select public.attendance_exception_snapshot('c0500000-0000-4000-8000-000000000001',
 'c0600000-0000-4000-8000-000000000001',(clock_timestamp() at time zone 'Asia/Taipei')::date,null)$$,
 '42501','attendance exception scope is not permitted','revoking director clients.read closes whole-branch PHI snapshot');
select throws_ok($$select pg_temp.exception_decide(current_setting('test.exception_id')::uuid,
 'reject',gen_random_uuid(),'Synthetic reviewed refusal')$$,
 '42501','independent branch director decision is required','revoked clients.read also closes UUID-based director decision');
reset role;
insert into public.role_permissions(role_id,permission_id)
select '10000000-0000-4000-8000-000000000011',id from public.permissions where permission_key='clients.read';
delete from public.role_permissions rp where rp.role_id='10000000-0000-4000-8000-000000000011'
 and rp.permission_id=(select id from public.permissions where permission_key='clients.view_all');
set local role authenticated;
select throws_ok($$select public.attendance_exception_snapshot('c0500000-0000-4000-8000-000000000001',
 'c0600000-0000-4000-8000-000000000001',(clock_timestamp() at time zone 'Asia/Taipei')::date,null)$$,
 '42501','attendance exception scope is not permitted','revoking director clients.view_all closes whole-branch PHI snapshot');
select throws_ok($$select pg_temp.exception_decide(current_setting('test.exception_id')::uuid,
 'reject',gen_random_uuid(),'Synthetic reviewed refusal')$$,
 '42501','independent branch director decision is required','revoked clients.view_all also closes UUID-based director decision');
reset role;
insert into public.role_permissions(role_id,permission_id)
select '10000000-0000-4000-8000-000000000011',id from public.permissions where permission_key='clients.view_all';
set local role authenticated;
select pg_temp.director_claims();
select throws_ok($$select pg_temp.exception_decide(current_setting('test.measurement_exception_id')::uuid,
 'approve',gen_random_uuid(),'核對來源但尚未輸入到場時間')$$,
 'DAA02','recent AAL2 is required for attendance exception decision',
 'preexisting measurement approval still requires director AAL2');
select throws_ok($$select public.decide_attendance_exception('c0500000-0000-4000-8000-000000000001',
 'c0600000-0000-4000-8000-000000000002',current_setting('test.exception_id')::uuid,
 'approve',null,null,gen_random_uuid())$$,'42501','attendance exception scope is not permitted',
 'branch director cannot approve an exception under another branch parameter');
select throws_ok($$select pg_temp.exception_decide(current_setting('test.exception_id')::uuid,null,gen_random_uuid())$$,
 '22023','invalid attendance exception decision','null decision is invalid');
reset role;
delete from public.role_permissions rp where rp.role_id='10000000-0000-4000-8000-000000000011'
 and rp.permission_id=(select id from public.permissions where permission_key='attendance.exception_approve');
set local role authenticated;
select throws_ok($$select pg_temp.exception_decide(current_setting('test.exception_id')::uuid,'approve',
 gen_random_uuid())$$,'42501','attendance exception approval permission is required',
 'director without dedicated exception approval permission cannot insert attendance');
select throws_ok($$select pg_temp.exception_decide(current_setting('test.exception_id')::uuid,'reject',
 gen_random_uuid(),'Synthetic reviewed refusal')$$,'42501','attendance exception approval permission is required',
 'director without dedicated exception approval permission cannot reject another worker request');
reset role;
insert into public.role_permissions(role_id,permission_id)
select '10000000-0000-4000-8000-000000000011',id from public.permissions
where permission_key='attendance.exception_approve';
set local role authenticated;
select throws_ok($$select pg_temp.exception_decide(current_setting('test.exception_id')::uuid,'approve',
 gen_random_uuid())$$,'DAA02','recent AAL2 is required for attendance exception decision',
 'director with dedicated permission but no recent AAL2 cannot approve');
select throws_ok($$select pg_temp.exception_decide(current_setting('test.exception_id')::uuid,'reject',
 gen_random_uuid(),'Synthetic reviewed refusal')$$,'DAA02','recent AAL2 is required for attendance exception decision',
 'director without recent purpose-bound AAL2 cannot reject another worker request');
reset role;
insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,
 issued_jwt_iat,created_at,expires_at)
values('c0400000-0000-4000-8000-000000000002','c0100000-0000-4000-8000-000000000002',
 'c0300000-0000-4000-8000-000000000002',repeat('2',64),
 'c0900000-0000-4000-8000-000000000206',now()-interval '2 minutes',now()-interval '1 minute',
 now()+interval '4 minutes');
insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,
 issued_jwt_iat,created_at,expires_at,invalidated_at)
values('c0400000-0000-4000-8000-000000000003','c0100000-0000-4000-8000-000000000002',
 'c0300000-0000-4000-8000-000000000002',repeat('3',64),
 'c0900000-0000-4000-8000-000000000207',now()-interval '2 minutes',now()-interval '1 minute',
 now()+interval '4 minutes',now()-interval '1 second');
update auth.sessions set aal='aal2' where id='c0300000-0000-4000-8000-000000000002';
insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method)
values(gen_random_uuid(),'c0300000-0000-4000-8000-000000000002',now(),now(),'totp');
select set_config('test.routine_totp',(select floor(extract(epoch from updated_at))::bigint::text
 from auth.mfa_amr_claims where session_id='c0300000-0000-4000-8000-000000000002'
 and authentication_method='totp'),true);
set local role authenticated;
select is(pg_temp.director_claims('aal2'),true,'director recent verified AAL2 session remains admitted');
select is(public.record_aal2_reauth('c0400000-0000-4000-8000-000000000003',repeat('3',64)),false,
 'director cannot consume an invalidated MFA challenge');
reset role;
select is((select count(*)::integer from private.reauth_events where user_id='c0100000-0000-4000-8000-000000000002'),0,
 'invalidated challenge leaves no reauth evidence');
set local role authenticated;
select pg_temp.director_claims('aal2');
select is(public.record_aal2_reauth('c0400000-0000-4000-8000-000000000002',repeat('2',64)),true,
 'director consumes a fresh bound factor challenge through the normal reauth endpoint');
select throws_ok($$select pg_temp.exception_decide(current_setting('test.measurement_exception_id')::uuid,
 'approve',gen_random_uuid(),'核對來源但未填時間')$$,
 '22023','verified arrival time and reason are required',
 'measurement exception cannot approve without verified arrival time');
select throws_ok($$select pg_temp.exception_decide(current_setting('test.measurement_exception_id')::uuid,
 'approve',gen_random_uuid(),null,(select measured_at from public.measurements
 where id='c0a00000-0000-4000-8000-000000000012'))$$,
 '22023','verified arrival time and reason are required',
 'measurement exception cannot approve without review rationale');
select throws_ok($$select pg_temp.exception_decide(current_setting('test.measurement_exception_id')::uuid,
 'approve',gen_random_uuid(),'核對實際到場',clock_timestamp()+interval '1 day')$$,
 '22023','verified arrival time and reason are required',
 'measurement exception cannot approve a future or other-day arrival');
select is((pg_temp.exception_decide(current_setting('test.measurement_exception_id')::uuid,
 'approve','c0900000-0000-4000-8000-000000000213','主任核對門口登記與實際到場時間',
 current_setting('test.measurement_at')::timestamptz)->>'status'),'approved',
 'director confirms source and actual arrival time before reconciliation attendance');
reset role;
select is((select checked_in_at=resolved_arrival_at and checked_in_at=measurement_at
 from private.attendance_exception_requests x join public.attendance_records a on a.id=x.attendance_id
 where x.id=current_setting('test.measurement_exception_id')::uuid),true,
 'formal check-in time matches director-confirmed time and retained measurement provenance');
select is((select count(*)::integer from public.attendance_records where client_id='c0800000-0000-4000-8000-000000000012'),1,
 'reconciliation creates exactly one formal attendance');
select is((select count(*)::integer from public.measurements where client_id='c0800000-0000-4000-8000-000000000012'),1,
 'reconciliation does not duplicate the original measurement');
set local role authenticated;
select pg_temp.director_claims('aal2');
select throws_ok($$select pg_temp.exception_decide(current_setting('test.exception_id')::uuid,
 'approve',gen_random_uuid(),'核對門口登記但未填實際到場時間')$$,
 '22023','verified arrival time and reason are required',
 'no-vital exception cannot use request time as automatic signed-in time');
select set_config('test.exception_arrival',greatest(
 (clock_timestamp() at time zone 'Asia/Taipei')::date::timestamp at time zone 'Asia/Taipei',
 clock_timestamp()-interval '1 minute')::text,true);
select is((pg_temp.exception_decide(current_setting('test.exception_id')::uuid,'approve',
 'c0900000-0000-4000-8000-000000000202','主任核對實際到場時間',
 current_setting('test.exception_arrival')::timestamptz)->>'status'),'approved',
 'independent branch director approves and creates attendance in one transaction');
select is((select count(*)::integer from public.attendance_records where client_id='c0800000-0000-4000-8000-000000000009'
 and status='present' and source='staff_backfill'),1,'approved exception creates exactly one formal attendance');
reset role;
select is((select a.recorded_by='c0100000-0000-4000-8000-000000000002'::uuid
 and x.requester_user_id='c0100000-0000-4000-8000-000000000001'::uuid
 from private.attendance_exception_requests x join public.attendance_records a on a.id=x.attendance_id
 where x.id=current_setting('test.exception_id')::uuid),true,
 'official exception attendance names the approving director while retaining the original worker request');
update private.reauth_events set verified_at=now()-interval '16 minutes'
where user_id='c0100000-0000-4000-8000-000000000002'
 and session_id='c0300000-0000-4000-8000-000000000002';
set local role authenticated;
select is(public.has_recent_aal2(15),false,'director reauth evidence is no longer recent');
select is((pg_temp.exception_decide(current_setting('test.exception_id')::uuid,'approve',
 'c0900000-0000-4000-8000-000000000202','主任核對實際到場時間',
 current_setting('test.exception_arrival')::timestamptz)->>'replayed')::boolean,true,
 'director exact retry returns same approval receipt even after reauth expires');
select throws_ok($$select pg_temp.exception_decide(current_setting('test.exception_id')::uuid,'reject',
 'c0900000-0000-4000-8000-000000000202','changed')$$,
 '23514','attendance exception already resolved','different replay cannot mutate approved attendance');
reset role;
select set_config('request.jwt.claims','{}',true);
set local role authenticated;
select pg_temp.staff_claims();
select set_config('test.exception_cancel_id',(pg_temp.exception_request('c0800000-0000-4000-8000-000000000011',
 'device_failure','c0900000-0000-4000-8000-000000000203')->>'id'),true);
select is((pg_temp.exception_decide(current_setting('test.exception_cancel_id')::uuid,'cancel',
 'c0900000-0000-4000-8000-000000000204')->>'status'),'cancelled',
 'care worker may cancel own pending exception');
select is((public.record_first_vital_arrival('c0500000-0000-4000-8000-000000000001',
 'c0600000-0000-4000-8000-000000000001','c0800000-0000-4000-8000-000000000011',
 'c0900000-0000-4000-8000-000000000205',null,null,75,null,null)->>'replayed')::boolean,false,
 'after cancellation first vital can produce ordinary arrival');
select is((select count(*)::integer from public.attendance_records where client_id='c0800000-0000-4000-8000-000000000011'),1,
 'cancelled exception never becomes a second attendance row');
reset role;
select set_config('request.jwt.claims','{}',true);
delete from private.staff_google_access_grants where allowed_user_id='c0100000-0000-4000-8000-000000000002';
delete from public.membership_roles where membership_id='c0700000-0000-4000-8000-000000000002';
insert into public.membership_roles(membership_id,role_id)
values('c0700000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000006');
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
