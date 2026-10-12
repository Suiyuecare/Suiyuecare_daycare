begin;
set local time zone 'Asia/Taipei';
select plan(56);
-- Synthetic identities, live Auth sessions, exact Google subject and explicit
-- staff approval. No replacement of an admission/authority function.
select set_config('test.clinical_oauth',floor(extract(epoch from clock_timestamp()-interval '2 minutes'))::text,true);
insert into auth.users(id,aud,role,email,email_confirmed_at,created_at,updated_at)
values('e0100000-0000-4000-8000-000000000001','authenticated','authenticated',
 'clinical@care.example.invalid',now()-interval '1 day',now()-interval '1 day',now());
insert into auth.identities(id,provider_id,user_id,identity_data,provider)
values('e0200000-0000-4000-8000-000000000001','synthetic-native-clinical',
 'e0100000-0000-4000-8000-000000000001',
 '{"sub":"synthetic-native-clinical","email":"clinical@care.example.invalid","email_verified":true,"hd":"care.example.invalid"}','google');
insert into auth.sessions(id,user_id,created_at,aal)
values('e0300000-0000-4000-8000-000000000001','e0100000-0000-4000-8000-000000000001',now()-interval '3 minutes','aal1');
insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method)
values(gen_random_uuid(),'e0300000-0000-4000-8000-000000000001',
 to_timestamp(current_setting('test.clinical_oauth')::bigint),to_timestamp(current_setting('test.clinical_oauth')::bigint),'oauth');
insert into public.organizations(id,code,name) values
 ('e0500000-0000-4000-8000-000000000001','native-clinical','Synthetic clinical organization'),
 ('e0500000-0000-4000-8000-000000000002','native-other','Synthetic other organization');
insert into public.branches(id,organization_id,code,name) values
 ('e0600000-0000-4000-8000-000000000001','e0500000-0000-4000-8000-000000000001','main','Synthetic main'),
 ('e0600000-0000-4000-8000-000000000002','e0500000-0000-4000-8000-000000000001','other','Synthetic other'),
 ('e0600000-0000-4000-8000-000000000003','e0500000-0000-4000-8000-000000000002','foreign','Synthetic foreign');
insert into public.profiles(id,display_name,kind)
values('e0100000-0000-4000-8000-000000000001','Synthetic clinical employee','staff');
insert into public.memberships(id,organization_id,branch_id,profile_id,status,starts_at)
values('e0700000-0000-4000-8000-000000000001','e0500000-0000-4000-8000-000000000001',
 'e0600000-0000-4000-8000-000000000001','e0100000-0000-4000-8000-000000000001','active',now()-interval '1 day');
insert into public.membership_roles(membership_id,role_id)
select 'e0700000-0000-4000-8000-000000000001',id from public.roles where is_system and role_key='nurse';
insert into public.role_permissions(role_id,permission_id)
select role.id,permission.id from public.roles role cross join public.permissions permission
where role.is_system and role.role_key in ('nurse','branch_director','case_manager_social_worker')
 and permission.permission_key in ('clients.read','nursing_assessments.read','nursing_assessments.manage',
  'nursing_assessments.sign','social_work_records.read','social_work_records.manage','social_work_records.sign')
on conflict do nothing;
delete from public.role_permissions where role_id in(select id from public.roles where is_system and role_key in ('nurse','case_manager_social_worker'))
 and permission_id=(select id from public.permissions where permission_key='clients.view_all');
insert into public.role_permissions(role_id,permission_id)
select role.id,permission.id from public.roles role cross join public.permissions permission
where role.is_system and role.role_key='branch_director' and permission.permission_key='clients.view_all'
on conflict do nothing;
insert into public.clients(id,organization_id,branch_id,client_code,display_name,admitted_on) values
 ('e0800000-0000-4000-8000-000000000001','e0500000-0000-4000-8000-000000000001','e0600000-0000-4000-8000-000000000001','SYN-NATIVE-1','Synthetic assigned client',current_date-10),
 ('e0800000-0000-4000-8000-000000000002','e0500000-0000-4000-8000-000000000001','e0600000-0000-4000-8000-000000000001','SYN-NATIVE-2','Synthetic unassigned client',current_date-10),
 ('e0800000-0000-4000-8000-000000000003','e0500000-0000-4000-8000-000000000001','e0600000-0000-4000-8000-000000000002','SYN-NATIVE-3','Synthetic other-branch client',current_date-10);
insert into public.client_assignments(id,organization_id,branch_id,client_id,assignee_user_id,assignment_kind,starts_at)
values('e0900000-0000-4000-8000-000000000001','e0500000-0000-4000-8000-000000000001',
 'e0600000-0000-4000-8000-000000000001','e0800000-0000-4000-8000-000000000001',
 'e0100000-0000-4000-8000-000000000001','synthetic_clinical',now()-interval '1 day');
create function pg_temp.native_claims(p_aal text default 'aal1') returns boolean language plpgsql security invoker as $$
begin
 perform set_config('request.jwt.claims',jsonb_build_object(
  'sub','e0100000-0000-4000-8000-000000000001','session_id','e0300000-0000-4000-8000-000000000001',
  'aud','authenticated','role','authenticated','aal',p_aal,'email','clinical@care.example.invalid','is_anonymous',false,
  'iat',floor(extract(epoch from clock_timestamp())),'exp',floor(extract(epoch from clock_timestamp()+interval '30 minutes')),
  'amr',jsonb_build_array(jsonb_build_object('method','oauth','timestamp',current_setting('test.clinical_oauth')::bigint))
    ||case when p_aal='aal2' then jsonb_build_array(jsonb_build_object('method','totp','timestamp',current_setting('test.clinical_totp')::bigint)) else '[]'::jsonb end)::text,true);
 return public.is_staff_login_allowed();
end; $$;
create temporary table clinical_receipts(k text primary key,v jsonb);
grant select,insert on clinical_receipts to authenticated;
insert into clinical_receipts values('content',
 '{"formVersionReference":"manual-nursing-v1","assessedOn":"2026-10-11","domains":{"observations":{"state":"recorded","detail":"合成護理觀察","reason":null},"problems":{"state":"missing","detail":null,"reason":"尚待確認"},"measures":{"state":"recorded","detail":"合成人工措施","reason":null},"response":{"state":"not_applicable","detail":null,"reason":"本次不適用"}},"reassessment":{"state":"missing","dueOn":null,"reason":"尚待排定"}}');
insert into clinical_receipts select 'create',jsonb_build_object('action','create_draft','clientId','e0800000-0000-4000-8000-000000000001','content',v)
 from clinical_receipts where k='content';
select ok(not has_function_privilege('authenticated','private.clinical_draft_permission(uuid,uuid,text)','execute')
 and not has_function_privilege('anon','private.clinical_draft_permission(uuid,uuid,text)','execute'),
 'clinical ordinary-work helper is not an API-callable privilege oracle');
set local role authenticated;
select is(pg_temp.native_claims(),false,'unapproved native Google account is not admitted');
select throws_ok($$select public.nursing_assessment_snapshot('e0500000-0000-4000-8000-000000000001','e0600000-0000-4000-8000-000000000001')$$,
 '42501',null,'unapproved nurse cannot read');
select throws_ok($$select * from public.social_work_service_snapshot('e0500000-0000-4000-8000-000000000001','e0600000-0000-4000-8000-000000000001')$$,
 '42501',null,'unapproved employee cannot read social work');
reset role;
insert into private.staff_google_access_grants(allowed_user_id,organization_id,company_email_domain,allowed_email,google_subject,enabled,approval_reference)
values('e0100000-0000-4000-8000-000000000001','e0500000-0000-4000-8000-000000000001',
 'care.example.invalid','clinical@care.example.invalid','synthetic-native-clinical',true,'Synthetic explicit employee approval');
set local role authenticated;
select is(pg_temp.native_claims(),true,'approved actual native Google nurse is admitted without CEO identity');
select is(private.is_active_user(),false,'ordinary clinical access does not fabricate global AAL2');
select is((public.nursing_assessment_snapshot('e0500000-0000-4000-8000-000000000001','e0600000-0000-4000-8000-000000000001')->>'clientTotal')::integer,1,
 'AAL1 nurse reads only assigned client');
select throws_ok($$select public.nursing_assessment_snapshot('e0500000-0000-4000-8000-000000000001','e0600000-0000-4000-8000-000000000002')$$,
 '42501',null,'AAL1 nurse cannot read another branch');
select throws_ok($$select public.nursing_assessment_snapshot('e0500000-0000-4000-8000-000000000002','e0600000-0000-4000-8000-000000000003')$$,
 '42501',null,'AAL1 nurse cannot read another organization');
insert into clinical_receipts select 'nurse-draft',public.mutate_nursing_assessment('e0500000-0000-4000-8000-000000000001','e0600000-0000-4000-8000-000000000001',
 (select v from clinical_receipts where k='create'),'e1000000-0000-4000-8000-000000000001');
select is((select v#>>'{result,state}' from clinical_receipts where k='nurse-draft'),'draft','native AAL1 nurse creates unsigned draft');
select is((public.mutate_nursing_assessment('e0500000-0000-4000-8000-000000000001','e0600000-0000-4000-8000-000000000001',
 (select v from clinical_receipts where k='create'),'e1000000-0000-4000-8000-000000000001')->>'replayed')::boolean,true,'nursing exact retry is idempotent');
select throws_ok($$select public.mutate_nursing_assessment('e0500000-0000-4000-8000-000000000001','e0600000-0000-4000-8000-000000000001',
 jsonb_set((select v from clinical_receipts where k='create'),'{content,domains,observations,detail}','"修改內容"'),'e1000000-0000-4000-8000-000000000001')$$,
 '23505',null,'same nursing operation key cannot hide a changed payload');
insert into clinical_receipts select 'nurse-revise-input',jsonb_build_object('action','revise_draft','clientId','e0800000-0000-4000-8000-000000000001',
 'assessmentKey',v#>>'{result,assessmentKey}','previousVersionId',v#>>'{result,versionId}','expectedVersion',1,'expectedContentHash',v#>>'{result,contentHash}',
 'content',(select v from clinical_receipts where k='content')) from clinical_receipts where k='nurse-draft';
insert into clinical_receipts select 'nurse-revised',public.mutate_nursing_assessment('e0500000-0000-4000-8000-000000000001','e0600000-0000-4000-8000-000000000001',
 (select v from clinical_receipts where k='nurse-revise-input'),'e1000000-0000-4000-8000-000000000002');
select is((select v#>>'{result,state}' from clinical_receipts where k='nurse-revised'),'draft','revision stays unsigned');
select is((select (v#>>'{result,version}')::integer from clinical_receipts where k='nurse-revised'),2,'draft revision creates next immutable version');
select throws_ok($$select public.mutate_nursing_assessment('e0500000-0000-4000-8000-000000000001','e0600000-0000-4000-8000-000000000001',
 (select v from clinical_receipts where k='nurse-revise-input'),'e1000000-0000-4000-8000-000000000003')$$,'40001',null,'stale draft cannot overwrite latest version');
insert into clinical_receipts select 'nurse-sign',jsonb_build_object('action','sign','clientId','e0800000-0000-4000-8000-000000000001',
 'assessmentKey',v#>>'{result,assessmentKey}','previousVersionId',v#>>'{result,versionId}','expectedVersion',2,'expectedContentHash',v#>>'{result,contentHash}')
 from clinical_receipts where k='nurse-revised';
select throws_ok($$select public.mutate_nursing_assessment('e0500000-0000-4000-8000-000000000001','e0600000-0000-4000-8000-000000000001',
 (select v from clinical_receipts where k='nurse-sign'),'e1000000-0000-4000-8000-000000000004')$$,'42501',null,'ordinary nurse session cannot sign');
reset role;
delete from public.membership_roles where membership_id='e0700000-0000-4000-8000-000000000001';
insert into public.membership_roles(membership_id,role_id) select 'e0700000-0000-4000-8000-000000000001',id from public.roles where is_system and role_key='branch_director';
set local role authenticated;
select throws_ok($$select public.mutate_nursing_assessment('e0500000-0000-4000-8000-000000000001','e0600000-0000-4000-8000-000000000001',
 (select v from clinical_receipts where k='create'),'e1000000-0000-4000-8000-000000000005')$$,'42501',null,'director title is not a nurse qualification');
select is((public.nursing_assessment_snapshot('e0500000-0000-4000-8000-000000000001','e0600000-0000-4000-8000-000000000001')->>'clientTotal')::integer,2,
 'director read-only oversight stays within own branch');
reset role;
insert into public.membership_roles(membership_id,role_id) select 'e0700000-0000-4000-8000-000000000001',id from public.roles where is_system and role_key='nurse';
set local role authenticated;
select lives_ok($$select public.mutate_nursing_assessment('e0500000-0000-4000-8000-000000000001','e0600000-0000-4000-8000-000000000001',
 (select v from clinical_receipts where k='create'),'e1000000-0000-4000-8000-000000000005')$$,'director with separate nurse role can draft for assigned client');
select throws_ok($$select public.mutate_nursing_assessment('e0500000-0000-4000-8000-000000000001','e0600000-0000-4000-8000-000000000001',
 jsonb_set((select v from clinical_receipts where k='create'),'{clientId}','"e0800000-0000-4000-8000-000000000002"'),'e1000000-0000-4000-8000-000000000006')$$,
 '42501',null,'view-all never grants unassigned clinical writes');
reset role;
update public.membership_roles set assigned_at=clock_timestamp()+interval '1 day' where membership_id='e0700000-0000-4000-8000-000000000001' and role_id=(select id from public.roles where is_system and role_key='nurse');
set local role authenticated;
select throws_ok($$select public.mutate_nursing_assessment('e0500000-0000-4000-8000-000000000001','e0600000-0000-4000-8000-000000000001',
 (select v from clinical_receipts where k='create'),'e1000000-0000-4000-8000-000000000001')$$,'42501',null,'future nurse designation cannot authorize even a retry');
reset role;
update public.membership_roles set assigned_at=clock_timestamp()-interval '1 day' where membership_id='e0700000-0000-4000-8000-000000000001';
update public.client_assignments set ends_at=clock_timestamp()-interval '1 second' where id='e0900000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select public.mutate_nursing_assessment('e0500000-0000-4000-8000-000000000001','e0600000-0000-4000-8000-000000000001',
 (select v from clinical_receipts where k='create'),'e1000000-0000-4000-8000-000000000001')$$,'42501',null,'expired assignment blocks nursing replay');
reset role;
update public.client_assignments set ends_at=null where id='e0900000-0000-4000-8000-000000000001';
update public.role_permissions set granted_at=clock_timestamp()+interval '1 day' where role_id in(select id from public.roles where is_system and role_key in ('nurse','branch_director'))
 and permission_id=(select id from public.permissions where permission_key='nursing_assessments.manage');
set local role authenticated;
select throws_ok($$select public.mutate_nursing_assessment('e0500000-0000-4000-8000-000000000001','e0600000-0000-4000-8000-000000000001',
 (select v from clinical_receipts where k='create'),'e1000000-0000-4000-8000-000000000001')$$,'42501',null,'future action permission blocks nursing replay');
reset role;
update public.role_permissions set granted_at=clock_timestamp()-interval '1 day' where role_id in(select id from public.roles where is_system and role_key in ('nurse','branch_director'));
update private.staff_google_access_grants set enabled=false where allowed_user_id='e0100000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select public.nursing_assessment_snapshot('e0500000-0000-4000-8000-000000000001','e0600000-0000-4000-8000-000000000001')$$,
 '42501',null,'revoked employee approval blocks clinical read');
reset role;
update private.staff_google_access_grants set enabled=true where allowed_user_id='e0100000-0000-4000-8000-000000000001';
select set_config('request.jwt.claims','{}',true);
update public.profiles set is_active=false where id='e0100000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.native_claims();
select throws_ok($$select public.nursing_assessment_snapshot('e0500000-0000-4000-8000-000000000001','e0600000-0000-4000-8000-000000000001')$$,
 '42501',null,'inactive employee blocks clinical read');
reset role;
select set_config('request.jwt.claims','{}',true);
update public.profiles set is_active=true where id='e0100000-0000-4000-8000-000000000001';
update public.branches set is_active=false where id='e0600000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.native_claims();
select throws_ok($$select public.nursing_assessment_snapshot('e0500000-0000-4000-8000-000000000001','e0600000-0000-4000-8000-000000000001')$$,
 '42501',null,'inactive branch blocks clinical read');
reset role;
update public.branches set is_active=true where id='e0600000-0000-4000-8000-000000000001';
delete from public.membership_roles where membership_id='e0700000-0000-4000-8000-000000000001';
insert into public.membership_roles(membership_id,role_id) select 'e0700000-0000-4000-8000-000000000001',id from public.roles where is_system and role_key='case_manager_social_worker';
set local role authenticated;
select is(pg_temp.native_claims(),true,'approved actual Google social worker is admitted');
select is((select client_total::integer from public.social_work_service_snapshot('e0500000-0000-4000-8000-000000000001','e0600000-0000-4000-8000-000000000001')),1,
 'social-work snapshot does not silently lose AAL1 assigned clients');
insert into clinical_receipts select 'social-draft',to_jsonb(receipt) from public.create_social_work_service_draft(
 'e0500000-0000-4000-8000-000000000001','e0600000-0000-4000-8000-000000000001','e0800000-0000-4000-8000-000000000001',
 clock_timestamp()-interval '1 hour','家庭支持','合成服務內容','合成服務結果','e1000000-0000-4000-8000-000000000011') receipt;
select is((select v->>'record_state' from clinical_receipts where k='social-draft'),'draft','native AAL1 social worker creates unsigned draft');
select is((select replayed from public.create_social_work_service_draft(
 'e0500000-0000-4000-8000-000000000001','e0600000-0000-4000-8000-000000000001','e0800000-0000-4000-8000-000000000001',
 (select (v->>'occurred_at')::timestamptz from public.social_work_service_snapshot('e0500000-0000-4000-8000-000000000001','e0600000-0000-4000-8000-000000000001') snapshot,
 jsonb_array_elements(snapshot.records) v limit 1),'家庭支持','合成服務內容','合成服務結果','e1000000-0000-4000-8000-000000000011')),true,
 'social-work exact retry is idempotent');
select is((select draft_total::integer from public.social_work_service_snapshot('e0500000-0000-4000-8000-000000000001','e0600000-0000-4000-8000-000000000001')),1,
 'AAL1 social snapshot includes saved draft and matching count');
insert into clinical_receipts select 'social-revised',to_jsonb(receipt) from public.revise_social_work_service_draft(
 'e0500000-0000-4000-8000-000000000001','e0600000-0000-4000-8000-000000000001','e0800000-0000-4000-8000-000000000001',
 (select (v->>'record_key')::uuid from clinical_receipts where k='social-draft'),
 (select (v->>'version_id')::uuid from clinical_receipts where k='social-draft'),1,clock_timestamp()-interval '1 hour',
 '家庭支持','合成服務內容新版','合成服務結果新版','e1000000-0000-4000-8000-000000000017') receipt;
select is((select v->>'record_state' from clinical_receipts where k='social-revised'),'draft','AAL1 social revision remains unsigned');
select is((select (v->>'record_version')::integer from clinical_receipts where k='social-revised'),2,'AAL1 social revision appends version rather than overwrite');
select throws_ok($$select * from public.sign_social_work_service_record('e0500000-0000-4000-8000-000000000001','e0600000-0000-4000-8000-000000000001',
 'e0800000-0000-4000-8000-000000000001',(select (v->>'record_key')::uuid from clinical_receipts where k='social-draft'),
 (select (v->>'version_id')::uuid from clinical_receipts where k='social-draft'),1,'e1000000-0000-4000-8000-000000000012')$$,
 '42501',null,'ordinary social worker session cannot sign');
select throws_ok($$select * from public.mutate_social_work_follow_up('track','e0500000-0000-4000-8000-000000000001','e0600000-0000-4000-8000-000000000001',
 'e0800000-0000-4000-8000-000000000001',(select (v->>'record_key')::uuid from clinical_receipts where k='social-draft'),
 (select (v->>'version_id')::uuid from clinical_receipts where k='social-draft'),0,current_date+1,'合成追蹤',null,null,'e1000000-0000-4000-8000-000000000013')$$,
 '42501',null,'new AAL1 draft path never authorizes committed follow-up events');
select throws_ok($$select * from public.create_social_work_service_draft('e0500000-0000-4000-8000-000000000001','e0600000-0000-4000-8000-000000000001',
 'e0800000-0000-4000-8000-000000000002',clock_timestamp()-interval '1 hour','家庭支持','合成服務','合成結果','e1000000-0000-4000-8000-000000000014')$$,
 '42501',null,'social worker cannot write unassigned client');
select throws_ok($$select * from public.social_work_service_snapshot('e0500000-0000-4000-8000-000000000001','e0600000-0000-4000-8000-000000000002')$$,
 '42501',null,'social worker cannot read other branch');
reset role;
update public.client_assignments set ends_at=clock_timestamp()-interval '1 second' where id='e0900000-0000-4000-8000-000000000001';
set local role authenticated;
select is((select client_total::integer from public.social_work_service_snapshot('e0500000-0000-4000-8000-000000000001','e0600000-0000-4000-8000-000000000001')),0,
 'revoked social assignment disappears rather than leaking another case');
select is((select draft_total::integer from public.social_work_service_snapshot('e0500000-0000-4000-8000-000000000001','e0600000-0000-4000-8000-000000000001')),0,
 'revoked social assignment hides saved draft as well');
reset role;
update public.client_assignments set ends_at=null where id='e0900000-0000-4000-8000-000000000001';
delete from public.membership_roles where membership_id='e0700000-0000-4000-8000-000000000001';
insert into public.membership_roles(membership_id,role_id) select 'e0700000-0000-4000-8000-000000000001',id from public.roles where is_system and role_key='branch_director';
set local role authenticated;
select throws_ok($$select * from public.create_social_work_service_draft('e0500000-0000-4000-8000-000000000001','e0600000-0000-4000-8000-000000000001',
 'e0800000-0000-4000-8000-000000000001',clock_timestamp()-interval '1 hour','家庭支持','合成服務','合成結果','e1000000-0000-4000-8000-000000000015')$$,
 '42501',null,'director must hold a separate social-work designation to use ordinary drafts');
reset role;
insert into public.membership_roles(membership_id,role_id) select 'e0700000-0000-4000-8000-000000000001',id from public.roles where is_system and role_key='case_manager_social_worker';
set local role authenticated;
select lives_ok($$select * from public.create_social_work_service_draft('e0500000-0000-4000-8000-000000000001','e0600000-0000-4000-8000-000000000001',
 'e0800000-0000-4000-8000-000000000001',clock_timestamp()-interval '1 hour','家庭支持','合成服務','合成結果','e1000000-0000-4000-8000-000000000015')$$,
 'director with separate social-worker role can save assigned draft');
select throws_ok($$select * from public.create_social_work_service_draft('e0500000-0000-4000-8000-000000000001','e0600000-0000-4000-8000-000000000001',
 'e0800000-0000-4000-8000-000000000002',clock_timestamp()-interval '1 hour','家庭支持','合成服務','合成結果','e1000000-0000-4000-8000-000000000016')$$,
 '42501',null,'director view-all never grants unassigned social draft writes');
reset role;
update public.role_permissions set granted_at=clock_timestamp()+interval '1 day' where role_id in(select id from public.roles where is_system and role_key in ('case_manager_social_worker','branch_director'))
 and permission_id=(select id from public.permissions where permission_key='social_work_records.read');
set local role authenticated;
select throws_ok($$select * from public.social_work_service_snapshot('e0500000-0000-4000-8000-000000000001','e0600000-0000-4000-8000-000000000001')$$,
 '42501',null,'future social-work read grant is not live');
reset role;
update public.role_permissions set granted_at=clock_timestamp()-interval '1 day' where role_id in(select id from public.roles where is_system and role_key in ('case_manager_social_worker','branch_director'));
update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='e0300000-0000-4000-8000-000000000001';
set local role authenticated;
select is(pg_temp.native_claims(),false,'expired native Auth session is rejected');
select throws_ok($$select * from public.social_work_service_snapshot('e0500000-0000-4000-8000-000000000001','e0600000-0000-4000-8000-000000000001')$$,
 '42501',null,'expired native session cannot read social snapshots');
reset role;
update auth.sessions set not_after=null,aal='aal2' where id='e0300000-0000-4000-8000-000000000001';
insert into public.membership_roles(membership_id,role_id) select 'e0700000-0000-4000-8000-000000000001',id from public.roles where is_system and role_key='nurse';
select set_config('test.clinical_totp',floor(extract(epoch from clock_timestamp()-interval '30 seconds'))::text,true);
insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method)
values(gen_random_uuid(),'e0300000-0000-4000-8000-000000000001',to_timestamp(current_setting('test.clinical_totp')::bigint),to_timestamp(current_setting('test.clinical_totp')::bigint),'totp');
set local role authenticated;
select is(pg_temp.native_claims('aal2'),true,'native OAuth plus actual session TOTP admits AAL2 non-CEO employee');
select is(private.is_active_user(),true,'original global AAL2 identity predicate works for admitted staff');
select throws_ok($$select public.mutate_nursing_assessment('e0500000-0000-4000-8000-000000000001','e0600000-0000-4000-8000-000000000001',
 (select v from clinical_receipts where k='nurse-sign'),'e1000000-0000-4000-8000-000000000004')$$,'42501',null,'AAL2 JWT alone does not fabricate recent signature evidence');
reset role;
insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,created_at,expires_at,consumed_at,consumed_jwt_iat,factor_method,factor_verified_at)
values('e1100000-0000-4000-8000-000000000001','e0100000-0000-4000-8000-000000000001','e0300000-0000-4000-8000-000000000001',repeat('a',64),'e1200000-0000-4000-8000-000000000001',
 to_timestamp(current_setting('test.clinical_oauth')::bigint),clock_timestamp()-interval '2 minutes',clock_timestamp()+interval '3 minutes',
 to_timestamp(current_setting('test.clinical_totp')::bigint),to_timestamp(current_setting('test.clinical_totp')::bigint),'totp',to_timestamp(current_setting('test.clinical_totp')::bigint));
insert into private.reauth_events(user_id,session_id,challenge_id,aal,verification_method,verified_at)
select user_id,session_id,id,'aal2','totp',factor_verified_at from private.reauth_challenges where id='e1100000-0000-4000-8000-000000000001';
set local role authenticated;
insert into clinical_receipts select 'nurse-signed',public.mutate_nursing_assessment('e0500000-0000-4000-8000-000000000001','e0600000-0000-4000-8000-000000000001',
 (select v from clinical_receipts where k='nurse-sign'),'e1000000-0000-4000-8000-000000000004');
select is((select v#>>'{result,state}' from clinical_receipts where k='nurse-signed'),'signed','native nurse signs only with actual same-session recent evidence');
select is((select v#>'{result,content}' from clinical_receipts where k='nurse-signed'),(select v from clinical_receipts where k='content'),
 'signature copies exact saved version rather than replacing content');
select pg_temp.native_claims();
select throws_ok($$select public.mutate_nursing_assessment('e0500000-0000-4000-8000-000000000001','e0600000-0000-4000-8000-000000000001',
 jsonb_build_object('action','correct','clientId','e0800000-0000-4000-8000-000000000001',
 'assessmentKey',(select v#>>'{result,assessmentKey}' from clinical_receipts where k='nurse-signed'),
 'previousVersionId',(select v#>>'{result,versionId}' from clinical_receipts where k='nurse-signed'),
 'expectedVersion',3,'expectedContentHash',(select v#>>'{result,contentHash}' from clinical_receipts where k='nurse-signed'),
 'content',(select v from clinical_receipts where k='content'),'correctionReason','合成更正理由'),
 'e1000000-0000-4000-8000-000000000018')$$,'42501',null,'returning to ordinary AAL1 cannot correct a signed nursing record');
select pg_temp.native_claims('aal2');
insert into clinical_receipts select 'social-signed',to_jsonb(receipt) from public.sign_social_work_service_record(
 'e0500000-0000-4000-8000-000000000001','e0600000-0000-4000-8000-000000000001','e0800000-0000-4000-8000-000000000001',
 (select (v->>'record_key')::uuid from clinical_receipts where k='social-revised'),
 (select (v->>'version_id')::uuid from clinical_receipts where k='social-revised'),2,'e1000000-0000-4000-8000-000000000019') receipt;
select is((select v->>'record_state' from clinical_receipts where k='social-signed'),'signed','non-CEO native social worker signs with real recent same-session AAL2');
select is((select v->>'service_content' from public.social_work_service_snapshot('e0500000-0000-4000-8000-000000000001','e0600000-0000-4000-8000-000000000001') snapshot,
 jsonb_array_elements(snapshot.records) v where v->>'record_key'=(select v->>'record_key' from clinical_receipts where k='social-signed')),
 '合成服務內容新版','social signature preserves exact saved draft');
select pg_temp.native_claims();
select throws_ok($$select * from public.correct_social_work_service_record('e0500000-0000-4000-8000-000000000001','e0600000-0000-4000-8000-000000000001',
 'e0800000-0000-4000-8000-000000000001',(select (v->>'record_key')::uuid from clinical_receipts where k='social-signed'),
 (select (v->>'version_id')::uuid from clinical_receipts where k='social-signed'),3,clock_timestamp()-interval '1 hour',
 '家庭支持','合成更正服務','合成更正結果','合成更正理由','e1000000-0000-4000-8000-000000000020')$$,
 '42501',null,'ordinary AAL1 social draft permission cannot correct a signed record');
reset role;
select is((select count(*)::integer from public.nursing_assessment_versions where organization_id='e0500000-0000-4000-8000-000000000001' and record_state='signed'),1,
 'ordinary drafts and denied attempts created exactly one real signed nursing version');
select is((select count(*)::integer from public.social_work_service_record_versions where organization_id='e0500000-0000-4000-8000-000000000001' and record_state='signed'),1,
 'ordinary drafts and denied attempts created exactly one real signed social version');
select * from finish();
rollback;
