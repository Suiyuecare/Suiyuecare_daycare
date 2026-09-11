begin;
select plan(80);

-- Synthetic users only; this suite runs the real executive admission policy.
select set_config('test.store_amr_at', floor(extract(epoch from clock_timestamp()-interval '2 minutes'))::text, true);
insert into auth.users(id,aud,role,email,email_confirmed_at,created_at,updated_at) values
 ('a0100000-0000-4000-8000-000000000001','authenticated','authenticated','store-owner@example.invalid',now()-interval '1 day',now()-interval '1 day',now()),
 ('a0100000-0000-4000-8000-000000000002','authenticated','authenticated','other-owner@example.invalid',now()-interval '1 day',now()-interval '1 day',now());
insert into auth.identities(id,provider_id,user_id,identity_data,provider) values
 ('a0200000-0000-4000-8000-000000000001','synthetic-store-owner','a0100000-0000-4000-8000-000000000001','{"sub":"synthetic-store-owner","email":"store-owner@example.invalid","email_verified":true}','google'),
 ('a0200000-0000-4000-8000-000000000002','synthetic-other-owner','a0100000-0000-4000-8000-000000000002','{"sub":"synthetic-other-owner","email":"other-owner@example.invalid","email_verified":true}','google');
insert into auth.sessions(id,user_id,created_at,aal) values
 ('a0300000-0000-4000-8000-000000000001','a0100000-0000-4000-8000-000000000001',now()-interval '3 minutes','aal1'),
 ('a0300000-0000-4000-8000-000000000002','a0100000-0000-4000-8000-000000000002',now()-interval '3 minutes','aal1');
insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method)
select ('a0400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 ('a0300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 to_timestamp(current_setting('test.store_amr_at')::bigint),
 to_timestamp(current_setting('test.store_amr_at')::bigint),'oauth' from generate_series(1,2) n;
insert into public.organizations(id,code,name) values
 ('a0500000-0000-4000-8000-000000000001','store_owner_main','Synthetic owner organization'),
 ('a0500000-0000-4000-8000-000000000002','store_owner_other','Synthetic other organization');
insert into public.branches(id,organization_id,code,name) values
 ('a0600000-0000-4000-8000-000000000001','a0500000-0000-4000-8000-000000000001','one','Synthetic first branch'),
 ('a0600000-0000-4000-8000-000000000002','a0500000-0000-4000-8000-000000000001','two','Synthetic second branch'),
 ('a0600000-0000-4000-8000-000000000003','a0500000-0000-4000-8000-000000000002','foreign','Synthetic foreign branch');
insert into public.profiles(id,display_name,kind) values
 ('a0100000-0000-4000-8000-000000000001','Synthetic owner','staff'),
 ('a0100000-0000-4000-8000-000000000002','Synthetic other owner','staff');
insert into public.memberships(id,organization_id,profile_id,status,starts_at) values
 ('a0700000-0000-4000-8000-000000000001','a0500000-0000-4000-8000-000000000001','a0100000-0000-4000-8000-000000000001','active',now()-interval '1 day'),
 ('a0700000-0000-4000-8000-000000000002','a0500000-0000-4000-8000-000000000001','a0100000-0000-4000-8000-000000000002','active',now()-interval '1 day');
insert into public.membership_roles(membership_id,role_id)
select id,'10000000-0000-4000-8000-000000000002' from public.memberships
where organization_id='a0500000-0000-4000-8000-000000000001';
insert into public.clients(id,organization_id,branch_id,client_code,display_name,admitted_on,status,ended_on)
select ('a0800000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 (case when n=9 then 'a0500000-0000-4000-8000-000000000002' else 'a0500000-0000-4000-8000-000000000001' end)::uuid,
 (case when n=8 then 'a0600000-0000-4000-8000-000000000002'
       when n=9 then 'a0600000-0000-4000-8000-000000000003' else 'a0600000-0000-4000-8000-000000000001' end)::uuid,
 'SYNTHETIC-STORE-'||n,'SYNTHETIC-PRIVATE-NAME-'||n,date '2026-08-01',
 (case when n=1 then 'closed' else 'active' end)::public.client_status,
 case when n=1 then date '2026-09-02' end
from generate_series(1,9) n;
-- Only explicit records count. Client 4 deliberately has none.
insert into public.attendance_records(id,organization_id,branch_id,client_id,service_date,status,
 checked_in_at,checked_out_at,source,idempotency_key,recorded_by)
select ('a0900000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 client.organization_id,client.branch_id,client.id,
 case when n=7 then date '2026-09-02' else date '2026-09-01' end,
 (case when n=2 then 'leave' when n=3 then 'absent' when n in (5,6) then 'cancelled' else 'present' end)::public.attendance_status,
 case when n=1 then timestamptz '2026-08-31 16:15:00Z' end,
 case when n=1 then timestamptz '2026-09-01 09:00:00Z' end,
 'synthetic',gen_random_uuid(),'a0100000-0000-4000-8000-000000000001'
from generate_series(1,9) n join public.clients client
 on client.id=('a0800000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid where n<>4;
-- A cancelled root is replaced by a new current root for client 6.
insert into public.attendance_records(id,organization_id,branch_id,client_id,service_date,status,idempotency_key,recorded_by)
values ('a0900000-0000-4000-8000-000000000010','a0500000-0000-4000-8000-000000000001',
 'a0600000-0000-4000-8000-000000000001','a0800000-0000-4000-8000-000000000006',
 '2026-09-01','present',gen_random_uuid(),'a0100000-0000-4000-8000-000000000001');
-- Newer correction/history rows are not current roots, even with another status.
insert into public.attendance_records(organization_id,branch_id,client_id,service_date,status,
 correction_of_id,correction_reason,idempotency_key,recorded_by,created_at)
select organization_id,branch_id,client_id,service_date,'leave',id,'Synthetic history only',
 gen_random_uuid(),'a0100000-0000-4000-8000-000000000001',now()+interval '1 minute'
from public.attendance_records where id='a0900000-0000-4000-8000-000000000001';

create function pg_temp.store_claims(p_overrides jsonb default '{}') returns boolean
language plpgsql security invoker as $$
begin
 perform set_config('request.jwt.claims',(jsonb_build_object(
  'sub','a0100000-0000-4000-8000-000000000001','session_id','a0300000-0000-4000-8000-000000000001',
  'aud','authenticated','role','authenticated','aal','aal1','is_anonymous',false,'email','store-owner@example.invalid',
  'iat',floor(extract(epoch from clock_timestamp())),'exp',floor(extract(epoch from clock_timestamp()+interval '30 minutes')),
  'amr',jsonb_build_array(jsonb_build_object('method','oauth','timestamp',current_setting('test.store_amr_at')::bigint)))||p_overrides)::text,true);
 return public.is_executive_login_allowed();
end;
$$;
create function pg_temp.store_gate(
 p_org uuid default 'a0500000-0000-4000-8000-000000000001',
 p_branch uuid default 'a0600000-0000-4000-8000-000000000001')
returns boolean language sql security invoker as $$
 select public.can_read_store_overview(p_org,p_branch);
$$;
create function pg_temp.store_summary(
 p_date date default '2026-09-01',
 p_org uuid default 'a0500000-0000-4000-8000-000000000001',
 p_branch uuid default 'a0600000-0000-4000-8000-000000000001')
returns jsonb language sql security invoker as $$
 select public.read_store_attendance_summary(p_org,p_branch,p_date);
$$;
create function pg_temp.store_finance_read(
 p_month text default '2026-09',
 p_org uuid default 'a0500000-0000-4000-8000-000000000001',
 p_branch uuid default 'a0600000-0000-4000-8000-000000000001')
returns boolean language sql security invoker as $$
 select public.record_store_finance_summary_read(p_org,p_branch,p_month);
$$;

select ok((select bool_and(prosecdef and proconfig @> array['search_path=""'] and pg_get_userbyid(proowner)='postgres')
 from pg_proc where oid in ('private.can_read_store_overview(uuid,uuid)'::regprocedure,
 'private.read_store_attendance_summary(uuid,uuid,date)'::regprocedure,
 'private.record_store_finance_summary_read(uuid,uuid,text)'::regprocedure)), 'private definers are owner-pinned with empty search_path');
select ok((select bool_and(not prosecdef and proconfig @> array['search_path=""'])
 from pg_proc where oid in ('public.can_read_store_overview(uuid,uuid)'::regprocedure,
 'public.read_store_attendance_summary(uuid,uuid,date)'::regprocedure,
 'public.record_store_finance_summary_read(uuid,uuid,text)'::regprocedure)), 'public entrypoints are invokers');
select ok(not has_function_privilege(role_name,function_name,'execute'),role_name||' cannot execute '||function_name)
from unnest(array['anon','service_role']) role_name cross join unnest(array[
 'public.can_read_store_overview(uuid,uuid)','public.read_store_attendance_summary(uuid,uuid,date)',
 'private.can_read_store_overview(uuid,uuid)','private.read_store_attendance_summary(uuid,uuid,date)',
 'public.record_store_finance_summary_read(uuid,uuid,text)',
 'private.record_store_finance_summary_read(uuid,uuid,text)']) function_name;
select ok(not has_table_privilege('authenticated','public.clients','select'), 'no raw client privilege granted');
select ok(not has_table_privilege('authenticated','public.attendance_records','insert'), 'no attendance write privilege added');

set local role authenticated;
select is(pg_temp.store_claims(),false,'unconfigured real CEO policy denies');
select is(pg_temp.store_gate(),false,'no-policy gate denies');
select throws_ok($$select pg_temp.store_summary()$$,'42501',null,'no-policy aggregate denies rather than false zero');
select throws_ok($$select pg_temp.store_finance_read()$$,'42501',null,'no-policy Finance read audit denied');
reset role;
insert into private.executive_access_policy(allowed_user_id,allowed_email,google_subject,enabled,approval_reference)
values('a0100000-0000-4000-8000-000000000001','store-owner@example.invalid','synthetic-store-owner',true,'Synthetic store overview approval');
set local role authenticated;
select is(pg_temp.store_claims(),true,'actual synthetic Google AAL1 session admitted without TOTP');
select is(pg_temp.store_gate(),true,'active full-scope CEO manager may view overview');
select is(public.has_recent_aal2(15),false,'read access never manufactures AAL2');
select is(pg_temp.store_finance_read(),true,'authorized CEO Finance summary view is durably audited without AAL2');
select throws_ok($$select pg_temp.store_finance_read(null)$$,'22023',null,'null Finance month rejected');
select throws_ok($$select pg_temp.store_finance_read('2026-13')$$,'22023',null,'invalid calendar month rejected');
select throws_ok($$select pg_temp.store_finance_read('2026-09-01')$$,'22023',null,'full date cannot enter month audit metadata');
select throws_ok($$select pg_temp.store_finance_read('1899-12')$$,'22023',null,'out-of-contract Finance year rejected');
select is(pg_temp.store_summary()-'generated_at',jsonb_build_object(
 'organization_id','a0500000-0000-4000-8000-000000000001',
 'branch_id','a0600000-0000-4000-8000-000000000001','service_date','2026-09-01',
 'present',2,'leave',1,'absent',1), 'exact seven-key payload: unique root statuses, replacement counts, no implicit absence or identities');
with measured as materialized (select pg_temp.store_summary() as value)
select ok((value->>'generated_at')::timestamptz between now()-interval '1 minute' and clock_timestamp(), 'generated_at is server time') from measured;
select is(pg_temp.store_summary('2026-09-03')-'generated_at',jsonb_build_object(
 'organization_id','a0500000-0000-4000-8000-000000000001',
 'branch_id','a0600000-0000-4000-8000-000000000001','service_date','2026-09-03',
 'present',0,'leave',0,'absent',0), 'authorized empty day is real zero, not all clients absent');
set local timezone='America/Los_Angeles';
select is((pg_temp.store_summary()->>'present')::integer,2,'Taipei service_date independent of session time zone and UTC check-in date');
set local timezone='Asia/Taipei';
select is((pg_temp.store_summary('2026-09-02')->>'present')::integer,1,'adjacent business day excluded from selected date');
select is((pg_temp.store_summary('2026-09-01','a0500000-0000-4000-8000-000000000001','a0600000-0000-4000-8000-000000000002')->>'present')::integer,1,'organization manager selects another authorized branch without merging it');
select is(pg_temp.store_gate('a0500000-0000-4000-8000-000000000002','a0600000-0000-4000-8000-000000000003'),false,'foreign tenant gate denied');
select throws_ok($$select pg_temp.store_summary('2026-09-01','a0500000-0000-4000-8000-000000000002','a0600000-0000-4000-8000-000000000003')$$,'42501',null,'foreign tenant aggregate denied');
select throws_ok($$select pg_temp.store_finance_read('2026-09','a0500000-0000-4000-8000-000000000002','a0600000-0000-4000-8000-000000000003')$$,'42501',null,'foreign tenant Finance read audit denied');
select is(pg_temp.store_gate('a0500000-0000-4000-8000-000000000001','a0600000-0000-4000-8000-000000000003'),false,'mismatched branch/organization denied');
select is(pg_temp.store_gate(null,'a0600000-0000-4000-8000-000000000001'),false,'null tenant fails closed');
select is(pg_temp.store_gate('a0500000-0000-4000-8000-000000000001',null),false,'null branch fails closed');
select throws_ok($$select pg_temp.store_summary(null)$$,'22023',null,'null date rejected');
select throws_ok($$select pg_temp.store_summary('infinity')$$,'22023',null,'infinite date rejected');
select throws_ok($$select pg_temp.store_summary('1899-12-31')$$,'22023',null,'out-of-contract date rejected');
select is(pg_temp.store_claims('{"sub":"a0100000-0000-4000-8000-000000000002","session_id":"a0300000-0000-4000-8000-000000000002","email":"other-owner@example.invalid"}'),false,'another Google organization manager is not the pinned CEO');
select is(pg_temp.store_gate(),false,'non-CEO gate denied');
select throws_ok($$select pg_temp.store_summary()$$,'42501',null,'non-CEO aggregate denied');
select throws_ok($$select pg_temp.store_finance_read()$$,'42501',null,'non-CEO Finance read audit denied');
select is(pg_temp.store_claims('{"sub":"bad-uuid"}'),false,'malformed user fails closed');
select is(pg_temp.store_gate(),false,'gate checks admission before auth.uid cast');
select is(pg_temp.store_claims('{"session_id":"a0300000-0000-4000-8000-000000000002"}'),false,'foreign session denied');
select is(pg_temp.store_gate(),false,'foreign session cannot read aggregate');
select is(pg_temp.store_claims(),true,'restore valid claims');
reset role;

-- Read audit contains only projection/date; no names, client IDs, content or counts.
select is((select count(*)::integer from public.audit_events where metadata->>'projection'='store_attendance_summary'),6,'each successful summary read is audited, denied/gate-only reads are not business views');
select ok((select bool_and(row_pk is null and changed_fields='{}'::text[]
 and metadata-'projection'-'service_date'='{}'::jsonb and action='select')
 from public.audit_events where metadata->>'projection'='store_attendance_summary'), 'audit metadata remains minimal and has no record payload');
select is((select count(*)::integer from public.audit_events where metadata->>'projection'='store_finance_summary'),1,'only successful authorized Finance read creates audit');
select ok((select bool_and(row_pk is null and changed_fields='{}'::text[]
 and action='select' and table_name='finance_store_summary'
 and actor_user_id='a0100000-0000-4000-8000-000000000001'
 and organization_id='a0500000-0000-4000-8000-000000000001'
 and branch_id='a0600000-0000-4000-8000-000000000001'
 and metadata=jsonb_build_object('projection','store_finance_summary','month','2026-09'))
 from public.audit_events where metadata->>'projection'='store_finance_summary'), 'Finance audit records scope, actor and month only; no balances, personal data or tokens');

-- Limit CEO to one branch while keeping the same organization-manager role.
delete from public.membership_roles where membership_id='a0700000-0000-4000-8000-000000000001';
delete from public.memberships where id='a0700000-0000-4000-8000-000000000001';
insert into public.memberships(id,organization_id,branch_id,profile_id,status,starts_at)
values('a0700000-0000-4000-8000-000000000001','a0500000-0000-4000-8000-000000000001',
 'a0600000-0000-4000-8000-000000000001','a0100000-0000-4000-8000-000000000001','active',now()-interval '1 day');
insert into public.membership_roles(membership_id,role_id)
values('a0700000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002');
set local role authenticated;
select is(pg_temp.store_gate(),true,'branch-limited manager retains own branch');
select is(pg_temp.store_gate('a0500000-0000-4000-8000-000000000001','a0600000-0000-4000-8000-000000000002'),false,'same-organization crossbranch denied after scope restriction');
select throws_ok($$select pg_temp.store_summary('2026-09-01','a0500000-0000-4000-8000-000000000001','a0600000-0000-4000-8000-000000000002')$$,'42501',null,'aggregate repeats branch permission check');
select throws_ok($$select pg_temp.store_finance_read('2026-09','a0500000-0000-4000-8000-000000000001','a0600000-0000-4000-8000-000000000002')$$,'42501',null,'Finance audit repeats branch permission check');
reset role;

-- Each live authority mutation invalidates the already issued AAL1 token.
update public.memberships set status='suspended' where id='a0700000-0000-4000-8000-000000000001';
set local role authenticated;
select is(pg_temp.store_gate(),false,'suspended membership denied immediately');
select throws_ok($$select pg_temp.store_summary()$$,'42501',null,'suspended membership aggregate denied');
reset role;
update public.memberships set status='active',ends_at=now()-interval '1 minute' where id='a0700000-0000-4000-8000-000000000001';
set local role authenticated;
select is(pg_temp.store_gate(),false,'expired membership denied');
reset role;
update public.memberships set ends_at=null,starts_at=now()+interval '1 day' where id='a0700000-0000-4000-8000-000000000001';
set local role authenticated;
select is(pg_temp.store_gate(),false,'future membership denied');
reset role;
update public.memberships set starts_at=now()-interval '1 day' where id='a0700000-0000-4000-8000-000000000001';
select set_config('request.jwt.claims','{}',true);
update public.profiles set is_active=false where id='a0100000-0000-4000-8000-000000000001';
set local role authenticated;
select is(pg_temp.store_claims(),true,'Auth principal stays valid while application profile is disabled');
select is(pg_temp.store_gate(),false,'disabled profile denied');
reset role;
select set_config('request.jwt.claims','{}',true);
update public.profiles set is_active=true where id='a0100000-0000-4000-8000-000000000001';
update public.branches set is_active=false where id='a0600000-0000-4000-8000-000000000001';
set local role authenticated;
select is(pg_temp.store_claims(),true,'restore claims after owner fixture adjustment');
select is(pg_temp.store_gate(),false,'inactive branch denied');
reset role;
update public.branches set is_active=true where id='a0600000-0000-4000-8000-000000000001';
update public.organizations set is_active=false where id='a0500000-0000-4000-8000-000000000001';
set local role authenticated;
select is(pg_temp.store_gate(),false,'inactive organization denied');
reset role;
update public.organizations set is_active=true where id='a0500000-0000-4000-8000-000000000001';
update public.membership_roles set assigned_at=now()+interval '1 day' where membership_id='a0700000-0000-4000-8000-000000000001';
set local role authenticated;
select is(pg_temp.store_gate(),false,'future role assignment denied');
reset role;
update public.membership_roles set assigned_at=now() where membership_id='a0700000-0000-4000-8000-000000000001';
update public.role_permissions set granted_at=now()+interval '1 day'
where role_id='10000000-0000-4000-8000-000000000002'
 and permission_id=(select id from public.permissions where permission_key='attendance.read');
set local role authenticated;
select is(pg_temp.store_gate(),false,'future attendance permission denied');
reset role;
update public.role_permissions set granted_at=now()
where role_id='10000000-0000-4000-8000-000000000002'
 and permission_id=(select id from public.permissions where permission_key='attendance.read');
delete from public.role_permissions where role_id='10000000-0000-4000-8000-000000000002'
 and permission_id=(select id from public.permissions where permission_key='clients.view_all');
set local role authenticated;
select is(pg_temp.store_gate(),false,'without full-branch access no misleading partial owner total is allowed');
select throws_ok($$select pg_temp.store_summary()$$,'42501',null,'aggregate does not silently downscope to assigned clients');
reset role;
insert into public.role_permissions(role_id,permission_id)
select '10000000-0000-4000-8000-000000000002',id from public.permissions where permission_key='clients.view_all';
update public.roles set role_key='synthetic_not_manager' where id='10000000-0000-4000-8000-000000000002';
set local role authenticated;
select is(pg_temp.store_gate(),false,'same permissions without organization-manager role do not grant owner overview');
reset role;
update public.roles set role_key='organization_manager' where id='10000000-0000-4000-8000-000000000002';
update auth.sessions set not_after=now()-interval '1 minute' where id='a0300000-0000-4000-8000-000000000001';
set local role authenticated;
select is(pg_temp.store_gate(),false,'expired real Auth session denied');
reset role;
update auth.sessions set not_after=null where id='a0300000-0000-4000-8000-000000000001';
update auth.users set banned_until=now()+interval '1 day' where id='a0100000-0000-4000-8000-000000000001';
set local role authenticated;
select is(pg_temp.store_gate(),false,'banned account denied');
reset role;
update auth.users set banned_until=null where id='a0100000-0000-4000-8000-000000000001';
update private.executive_access_policy set enabled=false;
set local role authenticated;
select is(pg_temp.store_gate(),false,'revoked CEO policy denied');
reset role;
update private.executive_access_policy set enabled=true;
delete from auth.mfa_amr_claims where session_id='a0300000-0000-4000-8000-000000000001';
delete from auth.sessions where id='a0300000-0000-4000-8000-000000000001';
set local role authenticated;
select is(pg_temp.store_gate(),false,'revoked Auth session denied despite previously valid JWT');
select throws_ok($$select pg_temp.store_summary()$$,'42501',null,'revoked session aggregate denies');
select throws_ok($$select pg_temp.store_finance_read()$$,'42501',null,'revoked session cannot record successful Finance view');
reset role;

select * from finish();
rollback;
