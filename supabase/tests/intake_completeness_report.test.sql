begin;
select plan(33);
-- Synthetic Google session uses the real admission/permission implementation.
select set_config('test.report_amr',floor(extract(epoch from now()-interval '2 minutes'))::text,true);
insert into auth.users(id,aud,role,email,email_confirmed_at,created_at,updated_at) values
 ('e1100000-0000-4000-8000-000000000001','authenticated','authenticated','report-manager@example.invalid',now()-interval '1 day',now()-interval '1 day',now());
insert into auth.identities(id,provider_id,user_id,identity_data,provider) values
 (gen_random_uuid(),'synthetic-report-google','e1100000-0000-4000-8000-000000000001','{"sub":"synthetic-report-google","email":"report-manager@example.invalid","email_verified":true}','google');
insert into auth.sessions(id,user_id,created_at,aal) values
 ('e1200000-0000-4000-8000-000000000001','e1100000-0000-4000-8000-000000000001',now()-interval '3 minutes','aal2');
insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method)
 select gen_random_uuid(),'e1200000-0000-4000-8000-000000000001',to_timestamp(current_setting('test.report_amr')::bigint),to_timestamp(current_setting('test.report_amr')::bigint),method from unnest(array['oauth','totp'])method;
insert into public.organizations(id,code,name) values ('e1300000-0000-4000-8000-000000000001','report-synthetic','合成機構'),('e1300000-0000-4000-8000-000000000002','report-other','合成其他機構');
insert into public.branches(id,organization_id,code,name) values
 ('e1400000-0000-4000-8000-000000000001','e1300000-0000-4000-8000-000000000001','main','合成分支'),
 ('e1400000-0000-4000-8000-000000000002','e1300000-0000-4000-8000-000000000001','other','其他分支'),
 ('e1400000-0000-4000-8000-000000000003','e1300000-0000-4000-8000-000000000002','foreign','其他機構分支');
insert into public.profiles(id,display_name,kind) values ('e1100000-0000-4000-8000-000000000001','合成收案主管','staff');
insert into public.memberships(id,organization_id,branch_id,profile_id,status,starts_at) values
 ('e1500000-0000-4000-8000-000000000001','e1300000-0000-4000-8000-000000000001','e1400000-0000-4000-8000-000000000001','e1100000-0000-4000-8000-000000000001','active',now()-interval '1 day');
insert into public.membership_roles(membership_id,role_id) values ('e1500000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002');
insert into private.executive_access_policy(allowed_user_id,allowed_email,google_subject,enabled,approval_reference) values ('e1100000-0000-4000-8000-000000000001','report-manager@example.invalid','synthetic-report-google',true,'synthetic report test');
insert into public.clients(id,organization_id,branch_id,client_code,display_name) values
 ('e1600000-0000-4000-8000-000000000001','e1300000-0000-4000-8000-000000000001','e1400000-0000-4000-8000-000000000001','SYN-1','合成待補案'),
 ('e1600000-0000-4000-8000-000000000002','e1300000-0000-4000-8000-000000000001','e1400000-0000-4000-8000-000000000001','SYN-2','合成無版本案'),
 ('e1600000-0000-4000-8000-000000000003','e1300000-0000-4000-8000-000000000001','e1400000-0000-4000-8000-000000000002','SYN-3','不可洩漏其他分支');
insert into private.client_intake_versions(organization_id,branch_id,client_id,version,profile,field_authority,actor_user_id) values
 ('e1300000-0000-4000-8000-000000000001','e1400000-0000-4000-8000-000000000001','e1600000-0000-4000-8000-000000000001',1,
 '{"displayName":"合成待補案","clientCode":"SYN-1","identityNumber":"SECRET_ID","dateOfBirth":"1945-01-01","residentialAddress":null,"contacts":[{"name":"SECRET_CONTACT","phone":"SECRET_PHONE","isEmergency":false}],"consent":{"status":"pending","confirmedOn":null}}','{}','e1100000-0000-4000-8000-000000000001');
select set_config('request.jwt.claims',jsonb_build_object('sub','e1100000-0000-4000-8000-000000000001','session_id','e1200000-0000-4000-8000-000000000001','role','authenticated','aud','authenticated','aal','aal2','is_anonymous',false,'email','report-manager@example.invalid','iat',floor(extract(epoch from now())),'exp',floor(extract(epoch from now()+interval '30 minutes')),'amr',jsonb_build_array(jsonb_build_object('method','oauth','timestamp',current_setting('test.report_amr')::bigint),jsonb_build_object('method','totp','timestamp',current_setting('test.report_amr')::bigint)))::text,true);
create function pg_temp.report() returns jsonb language sql security invoker as $$ select public.intake_completeness_snapshot('e1300000-0000-4000-8000-000000000001','e1400000-0000-4000-8000-000000000001','2026-09-14');$$;
create function pg_temp.item(p_key text,p_client integer default 0) returns text language sql security invoker as $$ select item->>'state' from jsonb_array_elements(pg_temp.report()->'rows'->p_client->'checks')item where item->>'key'=p_key;$$;
select ok(not has_function_privilege('anon','public.intake_completeness_snapshot(uuid,uuid,date)','execute'),'anonymous has no execute');
select ok(not has_function_privilege('service_role','public.intake_completeness_snapshot(uuid,uuid,date)','execute'),'service role has no report execute');
select ok(not(select prosecdef from pg_proc where oid='public.intake_completeness_snapshot(uuid,uuid,date)'::regprocedure),'public report stays security invoker');
set local role authenticated;
select is(jsonb_array_length(pg_temp.report()->'rows'),2,'only exact branch cases returned');
select is(jsonb_array_length(pg_temp.report()->'rows'->0->'checks'),13,'13 explicit metadata checks');
select ok(pg_temp.report()::text not like '%SECRET_%','no profile contents in report');
select ok(pg_temp.report()::text not like '%不可洩漏%','no other branch identity');
select is(pg_temp.item('identity'),'complete','identity presence only');
select is(pg_temp.item('address'),'missing','known empty field is missing');
select is(pg_temp.item('contact'),'complete','reachable contact presence');
select is(pg_temp.item('emergency_contact'),'missing','contact does not imply emergency designation');
select is(pg_temp.item('consent'),'pending','pending consent is not completed');
select is(pg_temp.item('identity',1),'unknown','no profile version is unknown, not zero');
select is(pg_temp.item('identity_front'),'missing','no document means missing, never reviewed');
select is(pg_temp.item('weekly'),'missing','absent weekly plan missing');
select throws_ok($$select public.intake_completeness_snapshot('e1300000-0000-4000-8000-000000000001','e1400000-0000-4000-8000-000000000002','2026-09-14')$$,'42501',null,'same org cross branch denied');
select throws_ok($$select public.intake_completeness_snapshot('e1300000-0000-4000-8000-000000000002','e1400000-0000-4000-8000-000000000003','2026-09-14')$$,'42501',null,'cross org denied');
select throws_ok($$select public.intake_completeness_snapshot('e1300000-0000-4000-8000-000000000001','e1400000-0000-4000-8000-000000000001','infinity')$$,'22023',null,'non-finite report date denied');
reset role;
insert into private.client_document_versions(id,organization_id,branch_id,client_id,category,version,sha256,mime_type,file_size_bytes,object_path,created_by,idempotency_key,input_hash,valid_until) values
 ('e1700000-0000-4000-8000-000000000001','e1300000-0000-4000-8000-000000000001','e1400000-0000-4000-8000-000000000001','e1600000-0000-4000-8000-000000000001','health_exam',1,repeat('a',64),'application/pdf',100,'SECRET_OBJECT_PATH','e1100000-0000-4000-8000-000000000001',gen_random_uuid(),'synthetic','2026-09-13');
set local role authenticated;
select is(pg_temp.item('health_exam'),'pending','unscanned file is pending even if expired');
reset role;
insert into private.client_document_scan_results(document_id,verdict,scanner) values ('e1700000-0000-4000-8000-000000000001','clean','synthetic-scanner');
insert into private.client_document_review_versions(organization_id,branch_id,client_id,category,document_version,version,decision,reason,reviewed_by,idempotency_key,input_hash) values
 ('e1300000-0000-4000-8000-000000000001','e1400000-0000-4000-8000-000000000001','e1600000-0000-4000-8000-000000000001','health_exam',1,1,'reviewed','SECRET_REVIEW_REASON','e1100000-0000-4000-8000-000000000001',gen_random_uuid(),'synthetic'),
 ('e1300000-0000-4000-8000-000000000001','e1400000-0000-4000-8000-000000000001','e1600000-0000-4000-8000-000000000001','medication_history',0,1,'not_applicable','合成已確認不適用','e1100000-0000-4000-8000-000000000001',gen_random_uuid(),'synthetic');
set local role authenticated;
select is(pg_temp.item('health_exam'),'expired','expired reviewed document not complete');
select is(pg_temp.item('medication_history'),'not_applicable','explicit authorized non-applicability separate from missing');
select ok(pg_temp.report()::text not like '%SECRET_%','file paths and review details never returned');
reset role;
insert into private.client_document_versions(id,organization_id,branch_id,client_id,category,version,sha256,mime_type,file_size_bytes,object_path,created_by,idempotency_key,input_hash) values
 ('e1700000-0000-4000-8000-000000000002','e1300000-0000-4000-8000-000000000001','e1400000-0000-4000-8000-000000000001','e1600000-0000-4000-8000-000000000001','health_exam',2,repeat('b',64),'application/pdf',100,'SECRET_NEW_OBJECT','e1100000-0000-4000-8000-000000000001',gen_random_uuid(),'synthetic');
insert into private.client_document_scan_results(document_id,verdict,scanner) values ('e1700000-0000-4000-8000-000000000002','clean','synthetic-scanner');
set local role authenticated;
select is(pg_temp.item('health_exam'),'pending','old review never approves replacement version');
reset role;
insert into private.client_weekly_versions(organization_id,branch_id,client_id,version,effective_from,effective_to,plan,created_by) values
 ('e1300000-0000-4000-8000-000000000001','e1400000-0000-4000-8000-000000000001','e1600000-0000-4000-8000-000000000001',1,'2026-09-01',null,'{}','e1100000-0000-4000-8000-000000000001'),
 ('e1300000-0000-4000-8000-000000000001','e1400000-0000-4000-8000-000000000001','e1600000-0000-4000-8000-000000000001',2,'2026-09-02','2026-09-13','{}','e1100000-0000-4000-8000-000000000001');
set local role authenticated;
select is(pg_temp.item('weekly'),'expired','expired latest weekly version never revives earlier open-ended version');
reset role;
select set_config('test.report_aal2',current_setting('request.jwt.claims'),true);
update auth.sessions set aal='aal1' where id='e1200000-0000-4000-8000-000000000001';
select set_config('request.jwt.claims',jsonb_set(current_setting('request.jwt.claims')::jsonb,'{aal}','"aal1"')::text,true);
set local role authenticated;
select is(auth.jwt()->>'aal','aal1','report does not synthesize MFA');
select is(jsonb_array_length(pg_temp.report()->'rows'),2,'approved Google AAL1 can review intake metadata');
reset role;
update auth.sessions set aal='aal2' where id='e1200000-0000-4000-8000-000000000001';
select set_config('request.jwt.claims',current_setting('test.report_aal2'),true);
delete from public.role_permissions where role_id='10000000-0000-4000-8000-000000000002' and permission_id=(select id from public.permissions where permission_key='clients.view_all');
set local role authenticated;
select is(jsonb_array_length(pg_temp.report()->'rows'),0,'read permission alone does not imply assignment');
reset role;
insert into public.client_assignments(organization_id,branch_id,client_id,assignee_user_id,assignment_kind,starts_at) values
 ('e1300000-0000-4000-8000-000000000001','e1400000-0000-4000-8000-000000000001','e1600000-0000-4000-8000-000000000001','e1100000-0000-4000-8000-000000000001','case_manager',now()-interval '1 day');
set local role authenticated;
select is(jsonb_array_length(pg_temp.report()->'rows'),1,'only assigned case returned without view-all permission');
select is(pg_temp.report()->'rows'->0->>'clientId','e1600000-0000-4000-8000-000000000001','assigned identity preserved');
reset role;
delete from public.role_permissions where role_id='10000000-0000-4000-8000-000000000002' and permission_id=(select id from public.permissions where permission_key='health.read');
set local role authenticated;
select is(pg_temp.item('health_exam'),'denied','revoked category permission hides presence and review status');
reset role;
delete from public.role_permissions where role_id='10000000-0000-4000-8000-000000000002' and permission_id=(select id from public.permissions where permission_key='clients.demographics.read');
set local role authenticated;
select throws_ok($$select pg_temp.report()$$,'42501',null,'revoked sensitive field permission denies whole report');
reset role;
select ok(exists(select 1 from public.audit_events where table_name='intake_completeness_snapshot' and actor_user_id='e1100000-0000-4000-8000-000000000001'),'report reads audited');
select ok(not exists(select 1 from public.audit_events where table_name='intake_completeness_snapshot' and metadata::text like '%SECRET_%'),'audit contains no raw profile/document contents');
select * from finish();
rollback;
