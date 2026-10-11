begin;
select plan(44);
-- Real admission/evidence fixture: no replacement of any authorization helper.
insert into auth.users(id,email,raw_app_meta_data) values
 ('e9000000-0000-4000-8000-000000000001','grant@example.invalid','{"provider":"email"}'),
 ('e9000000-0000-4000-8000-000000000002','family@example.invalid','{"provider":"phone"}'),
 ('e9000000-0000-4000-8000-000000000003','other@example.invalid','{"provider":"phone"}'),
 ('e9000000-0000-4000-8000-000000000004','staff-kind@example.invalid','{"provider":"email"}'),
 ('e9000000-0000-4000-8000-000000000005','no-member@example.invalid','{"provider":"phone"}');
insert into public.profiles(id,display_name,kind) values
 ('e9000000-0000-4000-8000-000000000001','合成授權人','staff'),
 ('e9000000-0000-4000-8000-000000000002','合成家屬','family'),
 ('e9000000-0000-4000-8000-000000000003','同案另位家屬','family'),
 ('e9000000-0000-4000-8000-000000000004','非家屬','staff'),
 ('e9000000-0000-4000-8000-000000000005','無會員','family');
insert into public.organizations(id,code,name) values('e9100000-0000-4000-8000-000000000001','family_new','合成機構');
insert into public.branches(id,organization_id,code,name) values
 ('e9200000-0000-4000-8000-000000000001','e9100000-0000-4000-8000-000000000001','branch_a','甲分支'),
 ('e9200000-0000-4000-8000-000000000002','e9100000-0000-4000-8000-000000000001','branch_b','乙分支');
insert into public.memberships(id,organization_id,branch_id,profile_id,status)
select ('e9250000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'e9100000-0000-4000-8000-000000000001','e9200000-0000-4000-8000-000000000001',('e9000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'active' from generate_series(2,4)n;
insert into public.membership_roles(membership_id,role_id)select ('e9250000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'10000000-0000-4000-8000-000000000010' from generate_series(2,3)n;
insert into public.clients(id,organization_id,branch_id,client_code,display_name,status,admitted_on,source_system)
select ('e9300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'e9100000-0000-4000-8000-000000000001',case when n=5 then 'e9200000-0000-4000-8000-000000000002'::uuid else 'e9200000-0000-4000-8000-000000000001'::uuid end,'SYN-'||n,'合成個案'||n,'active',current_date-10,'test' from generate_series(1,5)n;
insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,issued_jwt_jti,created_at,expires_at,consumed_at,consumed_jwt_iat,consumed_jwt_jti,factor_method,factor_verified_at)
values('e9400000-0000-4000-8000-000000000001','e9000000-0000-4000-8000-000000000001','e9410000-0000-4000-8000-000000000001',repeat('a',64),'e9420000-0000-4000-8000-000000000001',now()-interval '2 minutes','before',now()-interval '1 minute',now()+interval '4 minutes',now()-interval '30 seconds',now()-interval '30 seconds','after','totp',now()-interval '30 seconds');
create temporary table family_new_grants(n int,client_n int,user_n int,scopes text[],expires_at timestamptz,revoked_at timestamptz);
insert into family_new_grants values
 (1,1,2,array['client.read','messages.read','schedule.read'],null,null),
 (2,2,2,array['client.read','care.read'],null,null),
 (3,3,2,array['client.read','messages.read'],now()-interval '1 day',null),
 (4,4,2,array['client.read','messages.read'],null,now()-interval '1 minute'),
 (5,1,3,array['client.read','messages.read','schedule.read'],null,null),
 (6,1,4,array['client.read','messages.read'],null,null),
 (7,1,5,array['client.read','messages.read'],null,null);
update family_new_grants set scopes=private.canonical_family_consent_scopes(scopes);
insert into private.family_consent_verification_evidence(id,organization_id,branch_id,client_id,recipient_user_id,relationship,scopes,document_version,consent_expires_at,evidence_hash,verification_method,verified_at,otp_verified_at,relationship_verified_at,explicit_consent_verified_at,expires_at,registration_idempotency_key,request_hash,created_at)
select ('e9500000-0000-4000-8000-'||lpad(g.n::text,12,'0'))::uuid,c.organization_id,c.branch_id,c.id,('e9000000-0000-4000-8000-'||lpad(g.user_n::text,12,'0'))::uuid,'家屬',g.scopes,'v1',g.expires_at,encode(sha256(convert_to('synthetic-family-'||g.n,'UTF8')),'hex'),'phone_otp',now()-interval '2 days',now()-interval '2 days',now()-interval '2 days',now()-interval '2 days',now()-interval '2 days'+interval '10 minutes',('e9510000-0000-4000-8000-'||lpad(g.n::text,12,'0'))::uuid,repeat('c',64),now()-interval '2 days'
from family_new_grants g join public.clients c on c.id=('e9300000-0000-4000-8000-'||lpad(g.client_n::text,12,'0'))::uuid;
insert into public.consents(id,organization_id,branch_id,client_id,recipient_user_id,relationship,scopes,document_version,consented_at,expires_at,revoked_at,evidence_hash,created_by,workflow_version,verification_evidence_id,grant_reauth_challenge_id,grant_idempotency_key,grant_request_hash)
select ('e9600000-0000-4000-8000-'||lpad(g.n::text,12,'0'))::uuid,c.organization_id,c.branch_id,c.id,('e9000000-0000-4000-8000-'||lpad(g.user_n::text,12,'0'))::uuid,'家屬',g.scopes,'v1',now()-interval '2 days',g.expires_at,g.revoked_at,encode(sha256(convert_to('synthetic-family-'||g.n,'UTF8')),'hex'),'e9000000-0000-4000-8000-000000000001',1,('e9500000-0000-4000-8000-'||lpad(g.n::text,12,'0'))::uuid,'e9400000-0000-4000-8000-000000000001',('e9610000-0000-4000-8000-'||lpad(g.n::text,12,'0'))::uuid,repeat('d',64)
from family_new_grants g join public.clients c on c.id=('e9300000-0000-4000-8000-'||lpad(g.client_n::text,12,'0'))::uuid;
update private.family_consent_verification_evidence e set consumed_at=now()-interval '2 days'+interval '1 minute',consumed_by='e9000000-0000-4000-8000-000000000001',consumed_consent_id=('e9600000-0000-4000-8000-'||lpad(g.n::text,12,'0'))::uuid from family_new_grants g where e.id=('e9500000-0000-4000-8000-'||lpad(g.n::text,12,'0'))::uuid;
select ok(not has_table_privilege('authenticated','private.family_message_conflicts','SELECT'),'no direct conflict table read');
select ok(not has_function_privilege('authenticated','private.family_schedule_projection(uuid,uuid,uuid,date)','EXECUTE'),'projection has no unguarded caller oracle');
select ok(not has_function_privilege('anon','public.family_schedule_snapshot(uuid,uuid,uuid,date,boolean)','EXECUTE'),'anonymous calendar denied');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"e9000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1"}',true);
select is(public.is_family_login_allowed(),true,'actual consumed grant admits family AAL1 without recursion');
select is((select count(*)::integer from public.family_tenant_context()),1,'one consent-bound branch only');
select is((select branch_id from public.family_tenant_context('e9100000-0000-4000-8000-000000000001','e9200000-0000-4000-8000-000000000002')),'e9200000-0000-4000-8000-000000000001'::uuid,'untrusted wrong branch cannot broaden context');
select is((select payload->>'messageVersion' from public.family_workspace('e9100000-0000-4000-8000-000000000001','e9200000-0000-4000-8000-000000000001','e9300000-0000-4000-8000-000000000001')),'0','current authorized thread starts at zero');
select is((select receipt->>'status' from public.family_message_write('e9100000-0000-4000-8000-000000000001','e9200000-0000-4000-8000-000000000001','{"clientId":"e9300000-0000-4000-8000-000000000001","body":"合成訊息","expectedVersion":0,"idempotency_key":"e9700000-0000-4000-8000-000000000001"}')),'saved','first message persists');
select is((select receipt->>'replayed' from public.family_message_write('e9100000-0000-4000-8000-000000000001','e9200000-0000-4000-8000-000000000001','{"clientId":"e9300000-0000-4000-8000-000000000001","body":"合成訊息","expectedVersion":0,"idempotency_key":"e9700000-0000-4000-8000-000000000001"}')),'true','retry original key never duplicates');
select throws_ok($q$select * from public.family_message_write('e9100000-0000-4000-8000-000000000001','e9200000-0000-4000-8000-000000000001','{"clientId":"e9300000-0000-4000-8000-000000000001","body":"changed","expectedVersion":0,"idempotency_key":"e9700000-0000-4000-8000-000000000001"}')$q$,'40001',null,'same key changed content denied');
select is((select receipt->>'status' from public.family_message_write('e9100000-0000-4000-8000-000000000001','e9200000-0000-4000-8000-000000000001','{"clientId":"e9300000-0000-4000-8000-000000000001","body":"離線旧版","expectedVersion":0,"idempotency_key":"e9700000-0000-4000-8000-000000000002"}')),'conflict','stale message enters persisted manual queue');
select is((select receipt->>'replayed' from public.family_message_write('e9100000-0000-4000-8000-000000000001','e9200000-0000-4000-8000-000000000001','{"clientId":"e9300000-0000-4000-8000-000000000001","body":"離線旧版","expectedVersion":0,"idempotency_key":"e9700000-0000-4000-8000-000000000002"}')),'true','conflict retry never duplicates manual queue');
select is((select jsonb_array_length(payload->'messages') from public.family_workspace('e9100000-0000-4000-8000-000000000001','e9200000-0000-4000-8000-000000000001','e9300000-0000-4000-8000-000000000001')),1,'conflicts are not formal sent messages');
select throws_ok($q$select * from public.family_message_write('e9100000-0000-4000-8000-000000000001','e9200000-0000-4000-8000-000000000001','{"clientId":"e9300000-0000-4000-8000-000000000002","body":"wrong category","expectedVersion":0,"idempotency_key":"e9700000-0000-4000-8000-000000000003"}')$q$,'42501',null,'care consent does not authorize messages');
select throws_ok($q$select * from public.family_workspace('e9100000-0000-4000-8000-000000000001','e9200000-0000-4000-8000-000000000001','e9300000-0000-4000-8000-000000000003')$q$,'42501',null,'expired consent is denied');
select throws_ok($q$select * from public.family_workspace('e9100000-0000-4000-8000-000000000001','e9200000-0000-4000-8000-000000000001','e9300000-0000-4000-8000-000000000004')$q$,'42501',null,'withdrawn consent is denied');
select throws_ok($q$select * from public.family_workspace('e9100000-0000-4000-8000-000000000001','e9200000-0000-4000-8000-000000000002','e9300000-0000-4000-8000-000000000005')$q$,'42501',null,'wrong branch/client denied');
select is((select jsonb_array_length(payload->'items') from public.family_schedule_snapshot('e9100000-0000-4000-8000-000000000001','e9200000-0000-4000-8000-000000000001','e9300000-0000-4000-8000-000000000001',date_trunc('month',current_date)::date)),0,'authorized calendar is true empty without fabricated trips');
select throws_ok($q$select * from public.family_schedule_snapshot('e9100000-0000-4000-8000-000000000001','e9200000-0000-4000-8000-000000000001','e9300000-0000-4000-8000-000000000002',date_trunc('month',current_date)::date)$q$,'42501',null,'calendar requires schedule-specific consent');
select throws_ok($q$select * from public.family_schedule_snapshot('e9100000-0000-4000-8000-000000000001','e9200000-0000-4000-8000-000000000001','e9300000-0000-4000-8000-000000000001',date_trunc('month',current_date)::date,true)$q$,'42501',null,'family cannot request staff-mode projection');
reset role;
update public.branches set is_active=false where id='e9200000-0000-4000-8000-000000000001';
set local role authenticated;
select is(public.is_family_login_allowed(),false,'inactive branch immediately denies family admission');
select is((select count(*)::integer from public.family_tenant_context()),0,'inactive branch yields no tenant context');
select throws_ok($q$select * from public.family_workspace('e9100000-0000-4000-8000-000000000001','e9200000-0000-4000-8000-000000000001','e9300000-0000-4000-8000-000000000001')$q$,'42501',null,'inactive branch denies authorized-family workspace read');
select throws_ok($q$select * from public.family_message_write('e9100000-0000-4000-8000-000000000001','e9200000-0000-4000-8000-000000000001','{"clientId":"e9300000-0000-4000-8000-000000000001","body":"合成訊息","expectedVersion":0,"idempotency_key":"e9700000-0000-4000-8000-000000000001"}')$q$,'42501',null,'inactive branch denies even original message retry');
reset role;
update public.branches set is_active=true where id='e9200000-0000-4000-8000-000000000001';
set local role authenticated;
select is(public.is_family_login_allowed(),true,'restored branch re-enables still-current governed consent');
reset role;
update public.organizations set is_active=false where id='e9100000-0000-4000-8000-000000000001';
set local role authenticated;
select is(public.is_family_login_allowed(),false,'inactive organization immediately denies family admission');
select is((select count(*)::integer from public.family_tenant_context()),0,'inactive organization yields no tenant context');
select throws_ok($q$select * from public.family_workspace('e9100000-0000-4000-8000-000000000001','e9200000-0000-4000-8000-000000000001','e9300000-0000-4000-8000-000000000001')$q$,'42501',null,'inactive organization denies authorized-family workspace read');
select throws_ok($q$select * from public.family_message_write('e9100000-0000-4000-8000-000000000001','e9200000-0000-4000-8000-000000000001','{"clientId":"e9300000-0000-4000-8000-000000000001","body":"合成訊息","expectedVersion":0,"idempotency_key":"e9700000-0000-4000-8000-000000000001"}')$q$,'42501',null,'inactive organization denies even original message retry');
reset role;
update public.organizations set is_active=true where id='e9100000-0000-4000-8000-000000000001';
set local role authenticated;
select is(public.is_family_login_allowed(),true,'restored organization re-enables still-current governed consent');
reset role;
create temporary table family_attachment_fixture as select id from private.family_messages where idempotency_key='e9700000-0000-4000-8000-000000000001';
grant select on family_attachment_fixture to authenticated;
set local role authenticated;
select lives_ok($q$select * from public.reserve_clinical_attachment('e9100000-0000-4000-8000-000000000001','e9200000-0000-4000-8000-000000000001',jsonb_build_object('clientId','e9300000-0000-4000-8000-000000000001','sourceKind','family_message','sourceId',(select id from family_attachment_fixture),'sourceVersion',1,'idempotency_key','e9800000-0000-4000-8000-000000000001','sha256',repeat('e',64),'mimeType','image/png','fileSizeBytes',128,'label','合成附件'))$q$,'sender can reserve private message attachment');
select is((select payload#>>'{rows,0,scanStatus}' from public.clinical_attachments_snapshot('e9100000-0000-4000-8000-000000000001','e9200000-0000-4000-8000-000000000001','e9300000-0000-4000-8000-000000000001','family_message',(select id from family_attachment_fixture))),'reserved','unscanned attachment is pending not clean');
select is((select payload#>>'{rows,0,canDownload}' from public.clinical_attachments_snapshot('e9100000-0000-4000-8000-000000000001','e9200000-0000-4000-8000-000000000001','e9300000-0000-4000-8000-000000000001','family_message',(select id from family_attachment_fixture))),'false','unscanned attachment cannot download');
select throws_ok($q$select * from public.prepare_clinical_attachment_download('e9100000-0000-4000-8000-000000000001','e9200000-0000-4000-8000-000000000001','e9300000-0000-4000-8000-000000000001','family_message',(select id from family_attachment_fixture),(select (payload#>>'{rows,0,id}')::uuid from public.clinical_attachments_snapshot('e9100000-0000-4000-8000-000000000001','e9200000-0000-4000-8000-000000000001','e9300000-0000-4000-8000-000000000001','family_message',(select id from family_attachment_fixture))))$q$,'42501',null,'download RPC rejects unscanned bytes');
select set_config('request.jwt.claims','{"sub":"e9000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal1"}',true);
select is((select jsonb_array_length(payload->'messages') from public.family_workspace('e9100000-0000-4000-8000-000000000001','e9200000-0000-4000-8000-000000000001','e9300000-0000-4000-8000-000000000001')),0,'same client different family has separate conversation');
select throws_ok($q$select * from public.clinical_attachments_snapshot('e9100000-0000-4000-8000-000000000001','e9200000-0000-4000-8000-000000000001','e9300000-0000-4000-8000-000000000001','family_message',(select id from family_attachment_fixture))$q$,'42501',null,'same-case other family cannot see message files');
select set_config('request.jwt.claims','{"sub":"e9000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal1"}',true);
select is(public.is_family_login_allowed(),false,'non-family profile cannot enter with consent-only membership');
select set_config('request.jwt.claims','{"sub":"e9000000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal1"}',true);
select is(public.is_family_login_allowed(),false,'real grant without membership cannot enter');
reset role;
select is((select count(*)::integer from private.family_message_conflicts),1,'one immutable manual queue row after retry');
select throws_ok($q$update private.family_messages set body='overwrite'$q$,'55000',null,'sent messages cannot overwrite');
select throws_ok($q$delete from private.family_message_conflicts$q$,'55000',null,'conflicts cannot silently disappear');
select ok((select bool_and(relrowsecurity and relforcerowsecurity) from pg_class where oid in('private.family_message_conflicts'::regclass,'private.family_message_conflict_reviews'::regclass)),'conflict evidence forces RLS');
select ok(not has_function_privilege('authenticated','private.family_workspace_completion_v1(uuid,uuid,uuid)','EXECUTE'),'legacy base is not an unguarded public entry');
select ok(not has_table_privilege('authenticated','private.clinical_attachments','SELECT'),'private paths never readable directly');
select * from finish();
rollback;
