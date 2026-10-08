begin;
select plan(19);

select ok(
  has_function_privilege('authenticated','public.assessment_matrix_snapshot(uuid,uuid,date,integer,integer)','execute')
  and not has_function_privilege('anon','public.assessment_matrix_snapshot(uuid,uuid,date,integer,integer)','execute')
  and not has_function_privilege('service_role','public.assessment_matrix_snapshot(uuid,uuid,date,integer,integer)','execute')
  and not (select prosecdef from pg_proc where oid='public.assessment_matrix_snapshot(uuid,uuid,date,integer,integer)'::regprocedure)
  and (select prosecdef and proconfig @> array['search_path=""'] from pg_proc
    where oid='private.assessment_matrix_snapshot_guarded(uuid,uuid,date,integer,integer)'::regprocedure),
  'only authenticated callers may use the invoker wrapper backed by a pinned guarded function'
);
select ok(not has_table_privilege('authenticated','public.questionnaire_assessment_versions','select')
  and not has_table_privilege('service_role','public.questionnaire_assessment_versions','select'),
  'matrix migration does not grant raw questionnaire table access');

select set_config('test.matrix_amr',floor(extract(epoch from now()-interval '2 minutes'))::text,true);
insert into auth.users(id,aud,role,email,email_confirmed_at,created_at,updated_at) values
 ('a8100000-0000-4000-8000-000000000001','authenticated','authenticated','matrix@example.invalid',now()-interval '1 day',now()-interval '1 day',now());
insert into auth.identities(id,provider_id,user_id,identity_data,provider) values
 ('a8200000-0000-4000-8000-000000000001','synthetic-matrix-google','a8100000-0000-4000-8000-000000000001',
  '{"sub":"synthetic-matrix-google","email":"matrix@example.invalid","email_verified":true}','google');
insert into auth.sessions(id,user_id,created_at,aal) values
 ('a8300000-0000-4000-8000-000000000001','a8100000-0000-4000-8000-000000000001',now()-interval '3 minutes','aal1');
insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method) values
 ('a8400000-0000-4000-8000-000000000001','a8300000-0000-4000-8000-000000000001',
  to_timestamp(current_setting('test.matrix_amr')::bigint),to_timestamp(current_setting('test.matrix_amr')::bigint),'oauth');
insert into public.organizations(id,code,name) values
 ('a8500000-0000-4000-8000-000000000001','matrix_test','合成量表總覽機構'),
 ('a8500000-0000-4000-8000-000000000002','matrix_other','合成他機構');
insert into public.branches(id,organization_id,code,name) values
 ('a8600000-0000-4000-8000-000000000001','a8500000-0000-4000-8000-000000000001','main','合成第一分支'),
 ('a8600000-0000-4000-8000-000000000002','a8500000-0000-4000-8000-000000000001','second','合成第二分支'),
 ('a8600000-0000-4000-8000-000000000003','a8500000-0000-4000-8000-000000000002','foreign','合成其他機構分支');
insert into public.profiles(id,display_name,kind) values
 ('a8100000-0000-4000-8000-000000000001','合成量表員','staff');
insert into public.memberships(id,organization_id,branch_id,profile_id,status,starts_at) values
 ('a8700000-0000-4000-8000-000000000001','a8500000-0000-4000-8000-000000000001',
  'a8600000-0000-4000-8000-000000000001','a8100000-0000-4000-8000-000000000001','active',now()-interval '1 day');
insert into public.membership_roles(membership_id,role_id) values
 ('a8700000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002');
insert into private.executive_access_policy(allowed_user_id,allowed_email,google_subject,enabled,approval_reference) values
 ('a8100000-0000-4000-8000-000000000001','matrix@example.invalid','synthetic-matrix-google',true,'synthetic matrix test');
insert into public.clients(id,organization_id,branch_id,client_code,display_name,status,admitted_on) values
 ('a8800000-0000-4000-8000-000000000001','a8500000-0000-4000-8000-000000000001',
  'a8600000-0000-4000-8000-000000000001','SYN-M-A','合成甲','active',current_date-10),
 ('a8800000-0000-4000-8000-000000000002','a8500000-0000-4000-8000-000000000001',
  'a8600000-0000-4000-8000-000000000001','SYN-M-B','合成乙','suspended',current_date-10),
 ('a8800000-0000-4000-8000-000000000003','a8500000-0000-4000-8000-000000000001',
  'a8600000-0000-4000-8000-000000000002','SYN-M-C','跨分支個案','active',current_date-10),
 ('a8800000-0000-4000-8000-000000000004','a8500000-0000-4000-8000-000000000002',
  'a8600000-0000-4000-8000-000000000003','SYN-M-D','跨機構個案','active',current_date-10);

insert into public.questionnaire_assessment_versions(
 id,organization_id,branch_id,client_id,form_key,form_version,assessment_key,version,
 assessed_on,answers,context,record_state,content_hash,author_user_id,author_display_name
) values (
 'a8900000-0000-4000-8000-000000000001',
 'a8500000-0000-4000-8000-000000000001','a8600000-0000-4000-8000-000000000001',
 'a8800000-0000-4000-8000-000000000001','spmsq','spmsq-pfeiffer-10-education-adjusted-v1',
 'a8a00000-0000-4000-8000-000000000001',1,
 date_trunc('month',clock_timestamp() at time zone 'Asia/Taipei')::date,
 (select jsonb_object_agg('spmsq_'||lpad(n::text,2,'0'),'{"state":"answered","value":"correct"}'::jsonb)
  from generate_series(1,10)n),
 '{}'::jsonb,'draft',repeat('a',64),'a8100000-0000-4000-8000-000000000001','合成量表員'
);

create function pg_temp.matrix_login() returns void language plpgsql security invoker as $$
begin
 perform set_config('request.jwt.claim.sub','',true);
 perform set_config('request.jwt.claim.role','',true);
 perform set_config('request.jwt.claims',jsonb_build_object(
  'sub','a8100000-0000-4000-8000-000000000001',
  'session_id','a8300000-0000-4000-8000-000000000001',
  'role','authenticated','aud','authenticated','aal','aal1','is_anonymous',false,
  'email','matrix@example.invalid','iat',floor(extract(epoch from clock_timestamp())),
  'exp',floor(extract(epoch from clock_timestamp()+interval '30 minutes')),
  'amr',jsonb_build_array(jsonb_build_object('method','oauth',
   'timestamp',current_setting('test.matrix_amr')::bigint)))::text,true);
end;
$$;
create function pg_temp.matrix_snapshot(
 p_org uuid default 'a8500000-0000-4000-8000-000000000001',
 p_branch uuid default 'a8600000-0000-4000-8000-000000000001',
 p_month date default null,p_page integer default 1,p_size integer default 20
) returns jsonb language sql security invoker as $$
 select public.assessment_matrix_snapshot(p_org,p_branch,
  coalesce(p_month,date_trunc('month',clock_timestamp() at time zone 'Asia/Taipei')::date),
  p_page,p_size);
$$;

select pg_temp.matrix_login();
set local role anon;
select throws_ok($$select pg_temp.matrix_snapshot()$$,'42501',null,'anonymous cannot call matrix RPC');
reset role;
set local role authenticated;
select ok(public.is_staff_login_allowed(),'synthetic Google staff admission passes');
select is((pg_temp.matrix_snapshot()->>'totalClients')::integer,2,'only the two current-branch clients are counted');
select is(jsonb_array_length(pg_temp.matrix_snapshot()->'forms'),9,'all nine authorized questionnaire types are returned');
select is(jsonb_array_length(pg_temp.matrix_snapshot()->'clients'),2,'visible roster has one row per client');
select is(pg_temp.matrix_snapshot()->'clients'->0->'cells'->'spmsq'->>'state','draft','current-month draft is shown as draft only');
select is(pg_temp.matrix_snapshot()->'clients'->1->'cells'->'spmsq'->>'state','none','missing draft is shown as unrecorded only');
select ok(pg_temp.matrix_snapshot()::text not like '%"answers"%' and
 pg_temp.matrix_snapshot()::text not like '%"content_hash"%',
 'matrix never returns answers or document hashes');
select is(jsonb_array_length(pg_temp.matrix_snapshot(p_page:=1,p_size:=1)->'clients'),1,
 'first page obeys a bounded page size');
select is(pg_temp.matrix_snapshot(p_page:=2,p_size:=1)->'clients'->0->>'clientCode','SYN-M-B',
 'second page resumes in stable client-code order');
select throws_ok($$select pg_temp.matrix_snapshot(p_branch:='a8600000-0000-4000-8000-000000000002')$$,
 '42501',null,'cross-branch request fails closed');
select throws_ok($$select pg_temp.matrix_snapshot(p_month:=date '2099-01-01')$$,
 '22023',null,'future month is invalid');
select is(pg_temp.matrix_snapshot(p_month:=date '2000-01-01')->'clients'->0->'cells'->'spmsq'->>'state',
 'none','draft outside selected month is not silently included');
reset role;
delete from public.role_permissions where role_id='10000000-0000-4000-8000-000000000002'
 and permission_id=(select id from public.permissions where permission_key='clients.view_all');
insert into public.client_assignments(organization_id,branch_id,client_id,assignee_user_id,assignment_kind,starts_at)
values('a8500000-0000-4000-8000-000000000001','a8600000-0000-4000-8000-000000000001',
 'a8800000-0000-4000-8000-000000000001','a8100000-0000-4000-8000-000000000001','synthetic',now()-interval '1 day');
set local role authenticated;
select is((pg_temp.matrix_snapshot()->>'totalClients')::integer,1,'without view-all only assigned client remains');
select ok(pg_temp.matrix_snapshot()::text not like '%SYN-M-B%','unassigned client code is absent from payload');
reset role;
delete from public.role_permissions where role_id='10000000-0000-4000-8000-000000000002'
 and permission_id=(select id from public.permissions where permission_key='questionnaire_cognition.read');
set local role authenticated;
select ok(not (pg_temp.matrix_snapshot()->'forms' ? 'spmsq'),
 'removed form read permission excludes the corresponding column');
reset role;
delete from public.role_permissions where role_id='10000000-0000-4000-8000-000000000002'
 and permission_id in (select id from public.permissions where permission_key like 'questionnaire_%.read');
set local role authenticated;
select throws_ok($$select pg_temp.matrix_snapshot()$$,'42501',null,
 'all form read permissions removed causes a denial, not an empty result');

select * from finish();
rollback;
