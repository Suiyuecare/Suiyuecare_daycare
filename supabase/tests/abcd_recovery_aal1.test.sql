begin;
select plan(26);
-- Synthetic, individually approved Google staff. No fake AAL2 or real cases.
select set_config('test.abcd_amr',floor(extract(epoch from now()-interval '2 minutes'))::text,true);
insert into auth.users(id,aud,role,email,email_confirmed_at,created_at,updated_at) values
 ('b2100000-0000-4000-8000-000000000001','authenticated','authenticated',
 'synthetic-abcd@example.invalid',now()-interval '1 day',now()-interval '1 day',now());
insert into auth.identities(id,provider_id,user_id,identity_data,provider) values
 ('b2100000-0000-4000-8000-000000000002','synthetic-abcd-google',
 'b2100000-0000-4000-8000-000000000001',
 '{"sub":"synthetic-abcd-google","email":"synthetic-abcd@example.invalid","email_verified":true}','google');
insert into auth.sessions(id,user_id,created_at,aal) values
 ('b2100000-0000-4000-8000-000000000003','b2100000-0000-4000-8000-000000000001',
 now()-interval '3 minutes','aal1');
insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method) values
 ('b2100000-0000-4000-8000-000000000004','b2100000-0000-4000-8000-000000000003',
 to_timestamp(current_setting('test.abcd_amr')::bigint),
 to_timestamp(current_setting('test.abcd_amr')::bigint),'oauth');
insert into public.organizations(id,code,name) values
 ('b2100000-0000-4000-8000-000000000005','abcd_recovery','合成 ABCD 機構');
insert into public.branches(id,organization_id,code,name) values
 ('b2100000-0000-4000-8000-000000000006','b2100000-0000-4000-8000-000000000005','main','合成分支甲'),
 ('b2100000-0000-4000-8000-000000000007','b2100000-0000-4000-8000-000000000005','other','合成分支乙');
insert into public.profiles(id,display_name,kind) values
 ('b2100000-0000-4000-8000-000000000001','合成 ABCD 專業人員','professional');
insert into public.memberships(id,organization_id,branch_id,profile_id,status,starts_at) values
 ('b2100000-0000-4000-8000-000000000008','b2100000-0000-4000-8000-000000000005',
 'b2100000-0000-4000-8000-000000000006','b2100000-0000-4000-8000-000000000001',
 'active',now()-interval '1 day');
insert into public.membership_roles(membership_id,role_id)
select 'b2100000-0000-4000-8000-000000000008',id from public.roles
where role_key='professional' and is_system;
insert into private.staff_google_access_grants(allowed_user_id,organization_id,company_email_domain,
 allowed_email,google_subject,enabled,approval_reference) values
 ('b2100000-0000-4000-8000-000000000001','b2100000-0000-4000-8000-000000000005',
 'example.invalid','synthetic-abcd@example.invalid','synthetic-abcd-google',true,'合成審核');
insert into public.clients(id,organization_id,branch_id,client_code,display_name,status,admitted_on) values
 ('b2100000-0000-4000-8000-000000000009','b2100000-0000-4000-8000-000000000005',
 'b2100000-0000-4000-8000-000000000006','SYN-ABCD-A','合成個案甲','active','2025-01-01'),
 ('b2100000-0000-4000-8000-000000000010','b2100000-0000-4000-8000-000000000005',
 'b2100000-0000-4000-8000-000000000006','SYN-ABCD-B','未指派合成個案','active','2025-01-01');
insert into public.client_assignments(organization_id,branch_id,client_id,assignee_user_id,assignment_kind)
values ('b2100000-0000-4000-8000-000000000005','b2100000-0000-4000-8000-000000000006',
 'b2100000-0000-4000-8000-000000000009','b2100000-0000-4000-8000-000000000001','assessment');
select set_config('request.jwt.claims',jsonb_build_object(
 'sub','b2100000-0000-4000-8000-000000000001',
 'session_id','b2100000-0000-4000-8000-000000000003',
 'role','authenticated','aud','authenticated','aal','aal1','is_anonymous',false,
 'email','synthetic-abcd@example.invalid',
 'iat',floor(extract(epoch from clock_timestamp())),
 'exp',floor(extract(epoch from clock_timestamp()+interval '30 minutes')),
 'amr',jsonb_build_array(jsonb_build_object('method','oauth',
   'timestamp',current_setting('test.abcd_amr')::bigint)))::text,true);
set local role authenticated;
select is(auth.jwt()->>'aal','aal1','fixture is a real AAL1 token');
select is(public.has_recent_aal2(15),false,'no AAL2 proof was fabricated');
select is(public.has_routine_intake_access(
 'b2100000-0000-4000-8000-000000000005','b2100000-0000-4000-8000-000000000006',
 'abcd.save','b2100000-0000-4000-8000-000000000009'),true,
 'approved assigned Google staff has narrow ABCD draft authority');
select is(private.has_permission('b2100000-0000-4000-8000-000000000005',
 'b2100000-0000-4000-8000-000000000006','abcd_assessments.manage'),false,
 'global AAL2 permission root was not weakened');
select is((select client_total from public.abcd_assessment_snapshot(
 'b2100000-0000-4000-8000-000000000005','b2100000-0000-4000-8000-000000000006')),
 1::bigint,'AAL1 snapshot lists only the assigned client');
select throws_ok($$select * from public.abcd_assessment_snapshot(
 'b2100000-0000-4000-8000-000000000005','b2100000-0000-4000-8000-000000000006',
 'b2100000-0000-4000-8000-000000000010')$$,'42501',null,
 'selected unassigned same-branch client is denied');
select throws_ok($$select * from public.abcd_assessment_snapshot(
 'b2100000-0000-4000-8000-000000000005','b2100000-0000-4000-8000-000000000007')$$,
 '42501',null,'cross-branch snapshot denied');
select is(jsonb_array_length(public.abcd_assessment_client_search(
 'b2100000-0000-4000-8000-000000000005','b2100000-0000-4000-8000-000000000006',
 '合成')->'clients'),1,'AAL1 search returns only its assigned client');
select is(public.abcd_assessment_client_search(
 'b2100000-0000-4000-8000-000000000005','b2100000-0000-4000-8000-000000000006',
 '合成')->'clients'->0->>'client_id','b2100000-0000-4000-8000-000000000009',
 'AAL1 search does not disclose the unassigned same-branch client');
select set_config('test.abcd_payload',jsonb_build_object(
 'mode','create','assessment_key',null,'previous_version_id',null,
 'expected_version',0,'expected_content_hash',null,
 'client_id','b2100000-0000-4000-8000-000000000009',
 'assessment_type','A','assessment_year',2026,'assessment_date','2026-09-01',
 'manual_summary','合成人工候選摘要','result',jsonb_build_object(
   'state','recorded','text','合成人工結果','reason',null),
 'reassessment',jsonb_build_object('state','recorded','date','2026-12-01','basis','人工複評依據'),
 'reason','建立初稿')::text,true);
select set_config('test.abcd_reservation',public.reserve_abcd_assessment_operation(
 'b2100000-0000-4000-8000-000000000005','b2100000-0000-4000-8000-000000000006',
 'create','save_assessment',current_setting('test.abcd_payload')::jsonb,
 'b2100000-0000-4000-8000-000000000011')::text,true);
select ok(current_setting('test.abcd_reservation')::uuid is not null,
 'AAL1 can reserve an assigned-client draft without browser storage');
select is((public.abcd_assessment_recovery_snapshot(
 'b2100000-0000-4000-8000-000000000005','b2100000-0000-4000-8000-000000000006')
 ->'operations'->0->>'state'),'pending','reservation is visible as pending');
select set_config('test.abcd_result',(select to_jsonb(result)::text from public.mutate_abcd_assessment(
 'b2100000-0000-4000-8000-000000000005','b2100000-0000-4000-8000-000000000006',
 'save_assessment',current_setting('test.abcd_payload')::jsonb,
 'b2100000-0000-4000-8000-000000000011') result),true);
select is(current_setting('test.abcd_result')::jsonb->>'assessment_state','draft',
 'AAL1 writes a draft with the original immutable mutation');
select is((public.abcd_assessment_recovery_snapshot(
 'b2100000-0000-4000-8000-000000000005','b2100000-0000-4000-8000-000000000006')
 ->'operations'->0->>'state'),'committed','receipt confirms the same reservation');
select is((public.resume_abcd_assessment_operation(
 'b2100000-0000-4000-8000-000000000005','b2100000-0000-4000-8000-000000000006',
 current_setting('test.abcd_reservation')::uuid)->'receipt'->>'replayed'),'true',
 'AAL1 resume replays exactly the committed draft');
select ok(not has_function_privilege('authenticated',
 'private.mutate_abcd_assessment_guarded(uuid,uuid,text,jsonb,uuid)','execute'),
 'authenticated clients cannot bypass reservation through the private core');
select throws_ok($$select * from public.mutate_abcd_assessment(
 'b2100000-0000-4000-8000-000000000005','b2100000-0000-4000-8000-000000000006',
 'save_assessment',current_setting('test.abcd_payload')::jsonb,
 'b2100000-0000-4000-8000-000000000015')$$,'42501',
 'ABCD mutation reservation is required',
 'direct public RPC cannot create an unlocatable write');
select throws_ok($$select * from public.mutate_abcd_assessment(
 'b2100000-0000-4000-8000-000000000005','b2100000-0000-4000-8000-000000000006',
 'sign_assessment',jsonb_build_object(
  'client_id','b2100000-0000-4000-8000-000000000009',
  'assessment_key',current_setting('test.abcd_result')::jsonb->>'assessment_key',
  'previous_version_id',current_setting('test.abcd_result')::jsonb->>'version_id',
  'expected_version',1,
  'expected_content_hash',current_setting('test.abcd_result')::jsonb->>'content_hash',
  'assessment_type','A','assessment_year',2026),
 'b2100000-0000-4000-8000-000000000012')$$,'42501',null,
 'AAL1 cannot sign the draft');
select ok(not has_table_privilege('authenticated','private.abcd_assessment_reservations',
 'select,insert,update,delete'),'no direct browser access to pending body/key');
reset role;
update private.staff_google_access_grants set enabled=false
where allowed_user_id='b2100000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select * from public.abcd_assessment_snapshot(
 'b2100000-0000-4000-8000-000000000005','b2100000-0000-4000-8000-000000000006')$$,
 '42501',null,'revoked Google approval denies reads');
select throws_ok($$select public.resume_abcd_assessment_operation(
 'b2100000-0000-4000-8000-000000000005','b2100000-0000-4000-8000-000000000006',
 current_setting('test.abcd_reservation')::uuid)$$,'42501',null,
 'revoked approval denies replay');
select is(public.has_recent_aal2(15),false,'revocation did not create AAL2 evidence');
reset role;
select is((select count(*)::integer from private.reauth_events),0,
 'AAL1 drafts and recovery did not forge reauthentication events');
select ok(not has_function_privilege('authenticated',
 'private.purge_expired_abcd_reservation_payloads(integer)','execute'),
 'ordinary staff cannot invoke retention purge');
insert into private.abcd_assessment_reservations(id,organization_id,branch_id,
 client_id,actor_user_id,idempotency_key,operation,action,assessment_type,
 assessment_year,baseline_version,request_hash,created_at,expires_at) values
 ('b2100000-0000-4000-8000-000000000013',
 'b2100000-0000-4000-8000-000000000005','b2100000-0000-4000-8000-000000000006',
 'b2100000-0000-4000-8000-000000000009','b2100000-0000-4000-8000-000000000001',
 'b2100000-0000-4000-8000-000000000014','create','save_assessment','B',2026,0,
 repeat('a',64),now()-interval '2 days',now()-interval '1 day');
insert into private.abcd_assessment_reservation_payloads(id,organization_id,branch_id,request_payload)
values ('b2100000-0000-4000-8000-000000000013',
 'b2100000-0000-4000-8000-000000000005','b2100000-0000-4000-8000-000000000006',
 '{"manual_summary":"EXPIRED_SYNTHETIC_SECRET"}');
select is(private.purge_expired_abcd_reservation_payloads(10),1,
 'owner-only purge removes expired sensitive payload');
select ok(exists(select 1 from private.abcd_assessment_reservations
 where id='b2100000-0000-4000-8000-000000000013')
 and not exists(select 1 from private.abcd_assessment_reservation_payloads
 where id='b2100000-0000-4000-8000-000000000013')
 and exists(select 1 from private.abcd_assessment_reservation_payloads
 where id=current_setting('test.abcd_reservation')::uuid),
 'immutable locator and active payload survive while expired bytes are erased');
select ok(not exists(select 1 from public.audit_events
 where metadata::text like '%EXPIRED_SYNTHETIC_SECRET%'),
 'purge audit never logs erased narrative');
select * from finish();
rollback;
