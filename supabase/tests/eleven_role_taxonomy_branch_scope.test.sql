begin;
select plan(51);

select is((select count(*)::integer from public.roles where is_system), 11,
  'exactly eleven system templates exist');
select results_eq(
  $$select id::text, role_key, name from public.roles where is_system order by id$$,
  $$values
    ('10000000-0000-4000-8000-000000000001','platform_ops','系統維護人員'),
    ('10000000-0000-4000-8000-000000000002','organization_manager','全機構管理員（多點管理）'),
    ('10000000-0000-4000-8000-000000000003','branch_supervisor','機構管理員（單點管理）'),
    ('10000000-0000-4000-8000-000000000004','case_manager_social_worker','社工人員'),
    ('10000000-0000-4000-8000-000000000005','nurse','護理人員'),
    ('10000000-0000-4000-8000-000000000006','care_worker','照顧服務員'),
    ('10000000-0000-4000-8000-000000000007','professional','專業人員'),
    ('10000000-0000-4000-8000-000000000008','transport_driver','駕駛人員'),
    ('10000000-0000-4000-8000-000000000009','finance_claims','財務人員'),
    ('10000000-0000-4000-8000-000000000010','family','家屬／關係人'),
    ('10000000-0000-4000-8000-000000000011','branch_director','機構主任')$$,
  'all ten stable keys and IDs retain their identities with the new director appended');
select results_eq(
  $$select p.permission_key from public.role_permissions rp join public.permissions p on p.id=rp.permission_id
    where rp.role_id='10000000-0000-4000-8000-000000000011' order by p.permission_key$$,
  $$values ('attendance.read'),('care_records.read'),('clients.read'),('clients.view_all'),('notifications.read'),('services.read')$$,
  'director has the exact six approved read-only permissions, not a manager or clinical clone');
select is((select count(*)::integer from public.membership_roles where role_id='10000000-0000-4000-8000-000000000011'),0,
  'migration assigns no person to the new director role');
select is((select count(*)::integer from private.staff_google_access_grants),0,
  'taxonomy does not preapprove any Google identity');
select ok(not has_function_privilege('authenticated','private.validate_single_branch_role_request()','execute')
  and not has_function_privilege('service_role','private.prevent_single_branch_role_identity_mismatch()','execute')
  and not has_function_privilege('anon','private.validate_membership_role_scope()','execute'),
  'invariant trigger functions have no application RPC privileges');

insert into auth.users(id,aud,role,email,email_confirmed_at,created_at,updated_at) values
 ('d1100000-0000-4000-8000-000000000001','authenticated','authenticated','director@care.example.invalid',now()-interval '1 day',now()-interval '1 day',now()),
 ('d1100000-0000-4000-8000-000000000002','authenticated','authenticated','family@care.example.invalid',now(),now(),now()),
 ('d1100000-0000-4000-8000-000000000003','authenticated','authenticated','platform@care.example.invalid',now(),now(),now());
insert into public.profiles(id,display_name,kind) values
 ('d1100000-0000-4000-8000-000000000001','Synthetic director','staff'),
 ('d1100000-0000-4000-8000-000000000002','Synthetic family','family'),
 ('d1100000-0000-4000-8000-000000000003','Synthetic platform','platform');
insert into public.organizations(id,code,name) values
 ('d1200000-0000-4000-8000-000000000001','taxonomy_synthetic','Synthetic taxonomy organization'),
 ('d1200000-0000-4000-8000-000000000002','taxonomy_other','Synthetic other organization');
insert into public.branches(id,organization_id,code,name) values
 ('d1300000-0000-4000-8000-000000000001','d1200000-0000-4000-8000-000000000001','main','Synthetic main branch'),
 ('d1300000-0000-4000-8000-000000000002','d1200000-0000-4000-8000-000000000001','other','Synthetic second branch'),
 ('d1300000-0000-4000-8000-000000000003','d1200000-0000-4000-8000-000000000002','foreign','Synthetic foreign branch');
insert into public.memberships(id,organization_id,branch_id,profile_id,status,starts_at) values
 ('d1400000-0000-4000-8000-000000000001','d1200000-0000-4000-8000-000000000001','d1300000-0000-4000-8000-000000000001','d1100000-0000-4000-8000-000000000001','active',now()-interval '1 day'),
 ('d1400000-0000-4000-8000-000000000002','d1200000-0000-4000-8000-000000000001',null,'d1100000-0000-4000-8000-000000000001','active',now()-interval '1 day'),
 ('d1400000-0000-4000-8000-000000000003','d1200000-0000-4000-8000-000000000001','d1300000-0000-4000-8000-000000000001','d1100000-0000-4000-8000-000000000002','active',now()-interval '1 day'),
 ('d1400000-0000-4000-8000-000000000004','d1200000-0000-4000-8000-000000000001','d1300000-0000-4000-8000-000000000001','d1100000-0000-4000-8000-000000000003','active',now()-interval '1 day');
insert into public.clients(organization_id,branch_id,client_code,display_name) values
 ('d1200000-0000-4000-8000-000000000001','d1300000-0000-4000-8000-000000000001','TAX-A1','Synthetic branch client one'),
 ('d1200000-0000-4000-8000-000000000001','d1300000-0000-4000-8000-000000000001','TAX-A2','Synthetic branch client two'),
 ('d1200000-0000-4000-8000-000000000001','d1300000-0000-4000-8000-000000000002','TAX-B1','Synthetic other branch client'),
 ('d1200000-0000-4000-8000-000000000002','d1300000-0000-4000-8000-000000000003','TAX-C1','Synthetic other organization client');

select lives_ok($$insert into public.membership_roles(membership_id,role_id) values
 ('d1400000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000011')$$,
 'director can be explicitly assigned to a single branch');
select throws_ok($$insert into public.membership_roles(membership_id,role_id) values
 ('d1400000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000011')$$,
 '23514','single-branch role requires a branch-scoped membership','director cannot receive NULL-branch scope');
select throws_ok($$insert into public.membership_roles(membership_id,role_id) values
 ('d1400000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003')$$,
 '23514','single-branch role requires a branch-scoped membership','single-site manager cannot receive NULL-branch scope');
select lives_ok($$insert into public.membership_roles(membership_id,role_id) values
 ('d1400000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003')$$,
 'single-site manager can still be assigned to a specific branch');
delete from public.membership_roles where membership_id='d1400000-0000-4000-8000-000000000001'
 and role_id='10000000-0000-4000-8000-000000000003';
select lives_ok($$insert into public.membership_roles(membership_id,role_id) values
 ('d1400000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002')$$,
 'explicit multi-site manager retains organization-wide membership capability');
delete from public.membership_roles where membership_id='d1400000-0000-4000-8000-000000000002';
select throws_ok($$update public.memberships set branch_id=null where id='d1400000-0000-4000-8000-000000000001'$$,
 '23514','immutable key branch_id cannot be changed on public.memberships','membership cannot be broadened to all branches');
select throws_ok($$update public.memberships set branch_id='d1300000-0000-4000-8000-000000000002' where id='d1400000-0000-4000-8000-000000000001'$$,
 '23514','immutable key branch_id cannot be changed on public.memberships','membership cannot silently move to another branch');
select throws_ok($$update public.memberships set profile_id='d1100000-0000-4000-8000-000000000002' where id='d1400000-0000-4000-8000-000000000001'$$,
 '23514','immutable key profile_id cannot be changed on public.memberships','membership cannot be reassigned to a different person');
select throws_ok($$insert into public.membership_roles(membership_id,role_id) values
 ('d1400000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000011')$$,
 '23514','profile kind and role audience are incompatible','family cannot receive director duties');
select throws_ok($$insert into public.membership_roles(membership_id,role_id) values
 ('d1400000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000011')$$,
 '23514','profile kind and role audience are incompatible','platform maintenance cannot receive director duties');

select throws_ok($$insert into public.role_governance_requests(
 organization_id,branch_id,operation,target_role_id,target_membership_id,requested_by,
 requested_reauth_challenge_id,request_idempotency_key,request_hash) values (
 'd1200000-0000-4000-8000-000000000001','d1300000-0000-4000-8000-000000000001','assign_role',
 '10000000-0000-4000-8000-000000000011','d1400000-0000-4000-8000-000000000002','d1100000-0000-4000-8000-000000000001',
 'd1900000-0000-4000-8000-000000000001',gen_random_uuid(),repeat('a',64))$$,
 '23514','single-branch role requires a branch-scoped membership','invalid director scope is rejected before an approval request is queued');
select is((select count(*)::integer from public.role_governance_requests where organization_id='d1200000-0000-4000-8000-000000000001'),0,
 'invalid request leaves no approval ledger row');

insert into public.roles(id,organization_id,role_key,name,is_system) values
 ('d1500000-0000-4000-8000-000000000001','d1200000-0000-4000-8000-000000000001','branch_director','Synthetic custom legacy name',false);
select lives_ok($$insert into public.membership_roles(membership_id,role_id) values
 ('d1400000-0000-4000-8000-000000000002','d1500000-0000-4000-8000-000000000001')$$,
 'tenant custom roles are not silently reclassified by a system-template label change');
select is((select name from public.roles where id='d1500000-0000-4000-8000-000000000001'),'Synthetic custom legacy name',
 'tenant custom role names remain independent');
delete from public.membership_roles where role_id='d1500000-0000-4000-8000-000000000001';

-- Exercise role-identity TOCTOU defense using an unassigned synthetic system
-- template; no actual user or historical template is changed outside rollback.
insert into public.roles(id,role_key,name,is_system) values
 ('d1500000-0000-4000-8000-000000000002','synthetic_future_role','Synthetic future role',true);
insert into public.membership_roles(membership_id,role_id) values
 ('d1400000-0000-4000-8000-000000000002','d1500000-0000-4000-8000-000000000002');
select throws_ok($$update public.roles set role_key='branch_director' where id='d1500000-0000-4000-8000-000000000002'$$,
 '23514','role identity change conflicts with single-branch membership scope',
 'an assigned globally scoped role cannot be reclassified as a single-site director');
delete from public.membership_roles where role_id='d1500000-0000-4000-8000-000000000002';
delete from public.roles where id='d1500000-0000-4000-8000-000000000002';

insert into auth.identities(id,provider_id,user_id,identity_data,provider) values
 ('d1600000-0000-4000-8000-000000000001','synthetic-director','d1100000-0000-4000-8000-000000000001',
 '{"sub":"synthetic-director","email":"director@care.example.invalid","email_verified":true}','google');
insert into auth.sessions(id,user_id,created_at,aal) values
 ('d1700000-0000-4000-8000-000000000001','d1100000-0000-4000-8000-000000000001',now()-interval '3 minutes','aal1');
select set_config('test.taxonomy_amr',floor(extract(epoch from clock_timestamp()-interval '2 minutes'))::text,true);
insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method) values
 (gen_random_uuid(),'d1700000-0000-4000-8000-000000000001',to_timestamp(current_setting('test.taxonomy_amr')::bigint),
 to_timestamp(current_setting('test.taxonomy_amr')::bigint),'oauth');
select set_config('request.jwt.claims',jsonb_build_object(
 'sub','d1100000-0000-4000-8000-000000000001','session_id','d1700000-0000-4000-8000-000000000001',
 'aud','authenticated','role','authenticated','aal','aal1','email','director@care.example.invalid','is_anonymous',false,
 'iat',floor(extract(epoch from clock_timestamp())),'exp',floor(extract(epoch from clock_timestamp()+interval '30 minutes')),
 'amr',jsonb_build_array(jsonb_build_object('method','oauth','timestamp',current_setting('test.taxonomy_amr')::bigint)))::text,true);
select ok(not public.is_staff_login_allowed(),'role assignment alone does not approve a Google account');
insert into private.staff_google_access_grants(allowed_user_id,organization_id,allowed_email,google_subject,company_email_domain,enabled,approved_at,approval_reference)
values('d1100000-0000-4000-8000-000000000001','d1200000-0000-4000-8000-000000000001',
 'director@care.example.invalid','synthetic-director','care.example.invalid',true,now()-interval '1 day','synthetic-taxonomy-approval');
select ok(public.is_staff_login_allowed(),'individually approved director can use the existing verified Google flow');
select is(auth.jwt()->>'aal','aal1','director role never fabricates AAL2');
set local role authenticated;
select throws_ok($$select client_code from public.clients$$,'42501',null,
 'director cannot bypass the safe directory by reading the protected client table');
select results_eq($$select client_code from public.client_directory_snapshot(
 'd1200000-0000-4000-8000-000000000001','d1300000-0000-4000-8000-000000000001','core_daily') order by client_code$$,
 $$values ('TAX-A1'),('TAX-A2')$$,
 'actual authenticated directory returns all and only the two clients in the director branch');
select throws_ok($$select * from public.client_directory_snapshot(
 'd1200000-0000-4000-8000-000000000001','d1300000-0000-4000-8000-000000000002','core_daily')$$,
 '42501',null,'actual directory RPC rejects a different branch');
select throws_ok($$select * from public.client_directory_snapshot(
 'd1200000-0000-4000-8000-000000000002','d1300000-0000-4000-8000-000000000003','core_daily')$$,
 '42501',null,'actual directory RPC rejects a different organization');
reset role;
select ok(public.has_routine_care_access('d1200000-0000-4000-8000-000000000001','d1300000-0000-4000-8000-000000000001','care_records.read'),
 'director can read approved routine care in the explicitly assigned branch');
select ok(not public.has_routine_care_access('d1200000-0000-4000-8000-000000000001','d1300000-0000-4000-8000-000000000002','care_records.read'),
 'director cannot read another branch via the routine API');
select ok(not public.has_routine_care_access('d1200000-0000-4000-8000-000000000002','d1300000-0000-4000-8000-000000000003','care_records.read'),
 'director cannot cross organizations');
select ok(not public.has_routine_care_access('d1200000-0000-4000-8000-000000000001',null,'care_records.read'),
 'director cannot request unbounded organization scope');
select ok(not public.has_routine_care_access('d1200000-0000-4000-8000-000000000001','d1300000-0000-4000-8000-000000000001','attendance.write'),
 'director template does not silently acquire routine write permissions');
select ok(not public.has_routine_care_access('d1200000-0000-4000-8000-000000000001','d1300000-0000-4000-8000-000000000001','health.write'),
 'director is not automatically a nurse');
select ok(not public.has_routine_care_access('d1200000-0000-4000-8000-000000000001','d1300000-0000-4000-8000-000000000001','care_records.write'),
 'director is not automatically a social worker or care author');
select ok(not public.has_routine_care_access('d1200000-0000-4000-8000-000000000001','d1300000-0000-4000-8000-000000000001','care_records.sign'),
 'director cannot turn the routine API into a signing API');
select ok(not public.has_routine_care_access('d1200000-0000-4000-8000-000000000001','d1300000-0000-4000-8000-000000000001','roles.manage'),
 'director has no permission expansion through routine access');
select is((select count(*)::integer from public.membership_roles where membership_id='d1400000-0000-4000-8000-000000000001'),1,
 'director receives no automatic secondary role assignments');
select lives_ok($$insert into public.membership_roles(membership_id,role_id) values
 ('d1400000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000005')$$,
 'separate explicit nursing assignment can coexist on the same scoped membership');
select ok(public.has_routine_care_access('d1200000-0000-4000-8000-000000000001','d1300000-0000-4000-8000-000000000001','health.write'),
 'nursing routine permission appears only after explicit secondary assignment');
delete from public.membership_roles where membership_id='d1400000-0000-4000-8000-000000000001' and role_id='10000000-0000-4000-8000-000000000005';
select ok(not public.has_routine_care_access('d1200000-0000-4000-8000-000000000001','d1300000-0000-4000-8000-000000000001','health.write'),
 'revoking nursing assignment immediately removes that permission');
select lives_ok($$insert into public.membership_roles(membership_id,role_id) values
 ('d1400000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000004')$$,
 'separate explicit social-work assignment can coexist on the same scoped membership');
select ok(public.has_routine_care_access('d1200000-0000-4000-8000-000000000001','d1300000-0000-4000-8000-000000000001','care_records.write'),
 'care authorship appears only after separate social-work assignment');
select ok(not public.has_recent_aal2(15),'secondary clinical roles do not bypass recent AAL2 signing evidence');
delete from public.membership_roles where membership_id='d1400000-0000-4000-8000-000000000001' and role_id='10000000-0000-4000-8000-000000000004';

select lives_ok($$insert into public.membership_roles(membership_id,role_id) values
 ('d1400000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002')$$,
 'separately approved multi-site manager assignment is still explicit');
select ok(public.has_routine_care_access('d1200000-0000-4000-8000-000000000001','d1300000-0000-4000-8000-000000000002','care_records.read'),
 'multi-site role can read a second branch within its organization');
select ok(not public.has_routine_care_access('d1200000-0000-4000-8000-000000000002','d1300000-0000-4000-8000-000000000003','care_records.read'),
 'multi-site role still cannot cross organizations');
select ok(not has_table_privilege('authenticated','public.membership_roles','insert')
  and not has_table_privilege('authenticated','public.role_permissions','insert'),
  'ordinary sessions cannot self-assign or extend permissions directly');
select is((select count(*)::integer from public.role_permissions rp join public.permissions p on p.id=rp.permission_id
 where rp.role_id='10000000-0000-4000-8000-000000000001' and p.permission_key='clients.read'),0,
 'maintenance template still has no default client read permission');
select is((select count(*)::integer from public.role_permissions where role_id='10000000-0000-4000-8000-000000000010'),0,
 'family template still has no staff permission grants');
select ok(exists(select 1 from public.audit_events where table_name='public.membership_roles'
 and row_pk='d1400000-0000-4000-8000-000000000001:10000000-0000-4000-8000-000000000005'
 and action='delete'),'secondary role revocation retains the existing target-identifiable audit trail');

select * from finish();
rollback;
