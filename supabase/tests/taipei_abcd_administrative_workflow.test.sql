begin;
select plan(46);
select set_config('test.review_amr',floor(extract(epoch from now()-interval '2 minutes'))::text,true);
insert into auth.users(id,email,email_confirmed_at) values
 ('bc010000-0000-4000-8000-000000000001','author@care.example.invalid',now()),('bc010000-0000-4000-8000-000000000002','reviewer@care.example.invalid',now());
insert into auth.identities(id,provider_id,user_id,identity_data,provider) values
 (gen_random_uuid(),'synthetic-author','bc010000-0000-4000-8000-000000000001','{"sub":"synthetic-author","email":"author@care.example.invalid","email_verified":true}','google'),
 (gen_random_uuid(),'synthetic-reviewer','bc010000-0000-4000-8000-000000000002','{"sub":"synthetic-reviewer","email":"reviewer@care.example.invalid","email_verified":true}','google');
insert into auth.sessions(id,user_id,created_at,aal) values
 ('bc030000-0000-4000-8000-000000000001','bc010000-0000-4000-8000-000000000001',now()-interval '3 minutes','aal1'),
 ('bc030000-0000-4000-8000-000000000002','bc010000-0000-4000-8000-000000000002',now()-interval '3 minutes','aal1');
insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method)
select gen_random_uuid(),id,to_timestamp(current_setting('test.review_amr')::bigint),to_timestamp(current_setting('test.review_amr')::bigint),'oauth' from auth.sessions where id::text like 'bc030000%';
insert into public.organizations(id,code,name) values('bc040000-0000-4000-8000-000000000001','review-test','合成機構');
insert into public.branches(id,organization_id,code,name) values('bc050000-0000-4000-8000-000000000001','bc040000-0000-4000-8000-000000000001','main','合成分支');
insert into public.profiles(id,display_name,kind) values('bc010000-0000-4000-8000-000000000001','合成填表者','staff'),('bc010000-0000-4000-8000-000000000002','合成覆核者','staff');
insert into public.memberships(id,organization_id,branch_id,profile_id,status,starts_at) values
 ('bc060000-0000-4000-8000-000000000001','bc040000-0000-4000-8000-000000000001','bc050000-0000-4000-8000-000000000001','bc010000-0000-4000-8000-000000000001','active',now()-interval '1 day'),
 ('bc060000-0000-4000-8000-000000000002','bc040000-0000-4000-8000-000000000001','bc050000-0000-4000-8000-000000000001','bc010000-0000-4000-8000-000000000002','active',now()-interval '1 day');
insert into public.membership_roles(membership_id,role_id) select m.id,r.id from public.memberships m cross join public.roles r where m.organization_id='bc040000-0000-4000-8000-000000000001' and r.role_key='branch_supervisor' and r.is_system;
insert into private.staff_google_access_grants(allowed_user_id,organization_id,company_email_domain,allowed_email,google_subject,enabled,approval_reference) values
 ('bc010000-0000-4000-8000-000000000001','bc040000-0000-4000-8000-000000000001','care.example.invalid','author@care.example.invalid','synthetic-author',true,'Synthetic test approval'),
 ('bc010000-0000-4000-8000-000000000002','bc040000-0000-4000-8000-000000000001','care.example.invalid','reviewer@care.example.invalid','synthetic-reviewer',true,'Synthetic test approval');
insert into public.clients(id,organization_id,branch_id,client_code,display_name) values('bc070000-0000-4000-8000-000000000001','bc040000-0000-4000-8000-000000000001','bc050000-0000-4000-8000-000000000001','ABC-1','合成個案');
create temporary table review_receipts(label text primary key,payload jsonb);
grant all on review_receipts to authenticated;
create temporary table section_checks(payload jsonb);
insert into section_checks select jsonb_object_agg(section,jsonb_build_object('confirmed',true,'pendingReason',case when section='A1' then null else '待向家屬核對，不表示完整' end))
 from (select distinct split_part(key,'.',1) section from jsonb_each(private.taipei_abcd_field_spec()->'A'))s;
grant select on section_checks to authenticated;
create function pg_temp.actor(p_n integer) returns void language sql as $$ select set_config('request.jwt.claims',jsonb_build_object(
 'sub',case p_n when 1 then 'bc010000-0000-4000-8000-000000000001' else 'bc010000-0000-4000-8000-000000000002' end,
 'session_id',case p_n when 1 then 'bc030000-0000-4000-8000-000000000001' else 'bc030000-0000-4000-8000-000000000002' end,
 'aud','authenticated','role','authenticated','aal','aal1','email',case p_n when 1 then 'author@care.example.invalid' else 'reviewer@care.example.invalid' end,'is_anonymous',false,
 'iat',floor(extract(epoch from now())),'exp',floor(extract(epoch from now()+interval '30 minutes')),'amr',jsonb_build_array(jsonb_build_object('method','oauth','timestamp',current_setting('test.review_amr')::bigint)))::text,true); $$;
create function pg_temp.snap() returns jsonb language sql as $$ select public.taipei_abcd_draft_snapshot('bc040000-0000-4000-8000-000000000001','bc050000-0000-4000-8000-000000000001','bc070000-0000-4000-8000-000000000001','A',115,0); $$;
create function pg_temp.save(p_base integer default 0,p_hash text default null,p_key uuid default 'bc080000-0000-4000-8000-000000000001') returns jsonb language sql as $$ select public.save_taipei_abcd_draft('bc040000-0000-4000-8000-000000000001','bc050000-0000-4000-8000-000000000001',
 jsonb_build_object('client_id','bc070000-0000-4000-8000-000000000001','form','A','usage_year',115,'month',0,'template_key','taipei.daycare.abcd.115.114-11.draft-v1','source_revision','114.11','source_sha256','64bb716b19362580295fe8ee2e452d32e82d6f3c67773d5956f66c7e17d3c481','expected_version',p_base,'expected_content_hash',p_hash,
 'answers','{"A1.name":{"state":"recorded","value":"合成姓名","reason":null}}'::jsonb,'idempotency_key',p_key),p_key); $$;
create function pg_temp.operation(p_action text,p_seq integer,p_key uuid,p_overrides jsonb default '{}') returns jsonb language sql as $$ select public.taipei_abcd_transition('bc040000-0000-4000-8000-000000000001','bc050000-0000-4000-8000-000000000001',jsonb_build_object(
 'clientId','bc070000-0000-4000-8000-000000000001','draftId',(select payload->'draft'->>'id' from review_receipts where label='draft'),'contentHash',(select payload->'draft'->>'contentHash' from review_receipts where label='draft'),
 'expectedSequence',p_seq,'action',p_action,'reason','合成行政處置原因','checklist',case when p_action='submit' then (select payload from section_checks) else '{}'::jsonb end,'idempotency_key',p_key)||p_overrides); $$;
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='private.taipei_abcd_review_events'::regclass),'review ledger forced RLS');
select ok(not has_table_privilege('authenticated','private.taipei_abcd_review_events','select,insert,update,delete'),'no direct browser review writes');
select ok(not has_function_privilege('authenticated','private.save_taipei_abcd_draft_before_review(uuid,uuid,jsonb,uuid)','execute'),'old draft core not a bypass');
set local role authenticated;
select pg_temp.actor(1);
select is(public.is_staff_login_allowed(),true,'real approved Google author admitted');
select is(public.has_recent_aal2(15),false,'no fabricated AAL2');
insert into review_receipts values('draft',pg_temp.save());
select is(pg_temp.snap()->'workflow'->>'state','draft','initial draft workflow');
select throws_ok($$select pg_temp.operation('submit',0,gen_random_uuid(),'{"checklist":{}}')$$,'22023',null,'all section reviews required');
select throws_ok($$select pg_temp.operation('submit',0,gen_random_uuid(),'{"signed":true}')$$,'22023',null,'unknown signature keys rejected');
insert into review_receipts values('submitted',pg_temp.operation('submit',0,'bc090000-0000-4000-8000-000000000001'));
select is(pg_temp.snap()->'workflow'->>'state','submitted','submit freezes named draft');
select is(pg_temp.snap()->>'canEdit','false','submitted form UI cannot edit');
select throws_ok($$select pg_temp.save(1,(select payload->'draft'->>'contentHash' from review_receipts where label='draft'),gen_random_uuid())$$,'55000',null,'direct API write cannot change submitted snapshot');
select is(pg_temp.operation('submit',0,'bc090000-0000-4000-8000-000000000001')->>'replayed','true','lost submit response replays same event');
select throws_ok($$select pg_temp.operation('submit',0,'bc090000-0000-4000-8000-000000000001','{"reason":"變更後的新理由"}')$$,'23505',null,'changed retry rejected');
select throws_ok($$select pg_temp.operation('approve',1,gen_random_uuid())$$,'42501',null,'author cannot approve own submission');
select pg_temp.actor(2);
select is(pg_temp.snap()->>'canReview','true','independent approved supervisor can review');
reset role;
update public.roles set is_active=false where role_key='branch_supervisor' and is_system;
select is(private.taipei_abcd_is_reviewer('bc040000-0000-4000-8000-000000000001','bc050000-0000-4000-8000-000000000001'),false,'inactive supervisor role cannot authorize administrative review');
update public.roles set is_active=true where role_key='branch_supervisor' and is_system;
update public.membership_roles set assigned_at=now()+interval '1 day' where membership_id='bc060000-0000-4000-8000-000000000002';
select is(private.taipei_abcd_is_reviewer('bc040000-0000-4000-8000-000000000001','bc050000-0000-4000-8000-000000000001'),false,'future supervisor role cannot authorize review');
update public.membership_roles set assigned_at=now()-interval '1 minute' where membership_id='bc060000-0000-4000-8000-000000000002';
set local role authenticated;
select is(pg_temp.operation('return',1,'bc090000-0000-4000-8000-000000000002')->>'state','returned','independent reviewer can return');
select pg_temp.actor(1);
select is(pg_temp.snap()->>'canEdit','true','returned form can be revised');
select is(pg_temp.operation('submit',2,'bc090000-0000-4000-8000-000000000003')->>'state','submitted','same snapshot can resubmit with new checklist');
select pg_temp.actor(2);
select throws_ok($$select pg_temp.operation('approve',1,gen_random_uuid())$$,'40001',null,'stale review sequence rejected');
select is(pg_temp.operation('approve',3,'bc090000-0000-4000-8000-000000000004')->>'state','approved','independent administrative approval');
select is(pg_temp.snap()->'workflow'->>'isElectronicSignature','false','approval never a signature');
select is(pg_temp.snap()->'workflow'->>'isOfficialComplete','false','unfilled fields never marked officially complete');
select is(pg_temp.snap()->>'canEdit','false','approved snapshot frozen');
select throws_ok($$select pg_temp.save(1,(select payload->'draft'->>'contentHash' from review_receipts where label='draft'),gen_random_uuid())$$,'55000',null,'direct API write cannot bypass approved correction requirement');
select throws_ok($$select public.taipei_abcd_export('bc040000-0000-4000-8000-000000000001','bc050000-0000-4000-8000-000000000001','{}')$$,'42501',null,'Google AAL1 cannot export sensitive PDF');
select is(pg_temp.operation('correct',4,'bc090000-0000-4000-8000-000000000005')->>'state','draft','explicit reasoned correction creates new draft');
select is(pg_temp.snap()->'latest'->>'version','2','correction is version two');
select is(pg_temp.snap()->'latest'->>'previousVersionId',(select payload->'draft'->>'id' from review_receipts where label='draft'),'correction links original immutable snapshot');
select is(pg_temp.snap()->'workflow'->'events'->0->>'correctionOf',(select payload->'draft'->>'id' from review_receipts where label='draft'),'correction reason ledger links approved source');
reset role;
select throws_ok($$update private.taipei_abcd_review_events set reason='不可改理由'$$,'55000',null,'review history immutable');
select ok(not exists(select 1 from public.audit_events where table_name='taipei_abcd_review_events' and metadata::text like '%合成%'),'audit does not log review content');
select is((select state from private.taipei_abcd_draft_versions where version=1),'draft','no official signature state written');
select is((select count(*)::integer from public.document_template_versions where template_key like '%taipei%'),0,'no official document template publication invented');
-- Real personal MFA evidence is necessary for export; never an AAL1 flag bypass.
insert into private.executive_access_policy(allowed_user_id,allowed_email,google_subject,enabled,approval_reference)
 values('bc010000-0000-4000-8000-000000000002','reviewer@care.example.invalid','synthetic-reviewer',true,'Synthetic individual export approval');
update auth.sessions set aal='aal2' where id='bc030000-0000-4000-8000-000000000002';
insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method) values(gen_random_uuid(),'bc030000-0000-4000-8000-000000000002',to_timestamp(current_setting('test.review_amr')::bigint),to_timestamp(current_setting('test.review_amr')::bigint),'totp');
insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,created_at,expires_at,consumed_at,consumed_jwt_iat,factor_method,factor_verified_at)
 values('bc100000-0000-4000-8000-000000000001','bc010000-0000-4000-8000-000000000002','bc030000-0000-4000-8000-000000000002',repeat('a',64),gen_random_uuid(),now()-interval '2 minutes',now()-interval '2 minutes',now()+interval '5 minutes',now()-interval '1 minute',now()-interval '1 minute','totp',now()-interval '1 minute');
insert into private.reauth_events(user_id,session_id,challenge_id,aal,verification_method,verified_at) values('bc010000-0000-4000-8000-000000000002','bc030000-0000-4000-8000-000000000002','bc100000-0000-4000-8000-000000000001','aal2','totp',now()-interval '1 minute');
select set_config('request.jwt.claims',(auth.jwt()||jsonb_build_object('aal','aal2','amr',jsonb_build_array(jsonb_build_object('method','oauth','timestamp',current_setting('test.review_amr')::bigint),jsonb_build_object('method','totp','timestamp',current_setting('test.review_amr')::bigint))))::text,true);
set local role authenticated;
select is(public.has_recent_aal2(15),true,'personal fresh second-factor evidence validated');
insert into review_receipts values('exportInput',jsonb_build_object('clientId','bc070000-0000-4000-8000-000000000001','draftId',pg_temp.snap()->'latest'->>'id','contentHash',pg_temp.snap()->'latest'->>'contentHash','expectedSequence',1,'idempotency_key','bc110000-0000-4000-8000-000000000001'));
create function pg_temp.export(p_extra jsonb default '{}') returns jsonb language sql as $$ select public.taipei_abcd_export('bc040000-0000-4000-8000-000000000001','bc050000-0000-4000-8000-000000000001',(select payload from review_receipts where label='exportInput')||p_extra); $$;
insert into review_receipts values('export',pg_temp.export());
select is(pg_temp.export()->>'id',(select payload->>'id' from review_receipts where label='export'),'same operation returns same export snapshot');
select is(pg_temp.export()->'snapshot'->'draft'->>'version','2','export uses requested version, not a template summary');
select is(pg_temp.export()->'snapshot'->>'isElectronicSignature','false','PDF snapshot clearly not signed');
select throws_ok($$select pg_temp.export('{"expectedSequence":0}')$$,'23505',null,'changed export retry cannot create new snapshot');
reset role;
update public.clients set display_name='合成姓名已更改' where id='bc070000-0000-4000-8000-000000000001';
set local role authenticated;
select is(pg_temp.export()->'snapshot'->'client'->>'displayName','合成個案','export retry retains original demographic snapshot');
reset role;
select throws_ok($$update private.taipei_abcd_export_snapshots set snapshot='{}'$$,'55000',null,'saved export snapshots cannot be edited');
select throws_ok($$delete from private.taipei_abcd_export_snapshots$$,'55000',null,'saved export snapshots cannot be deleted');
delete from public.role_permissions where role_id='10000000-0000-4000-8000-000000000003' and permission_id=(select id from public.permissions where permission_key='document_printing.read');
set local role authenticated;
select is(pg_temp.snap()->>'canExport','false','export button capability matches revoked printing read permission');
reset role;
delete from public.role_permissions where role_id='10000000-0000-4000-8000-000000000003' and permission_id=(select id from public.permissions where permission_key='clients.demographics.read');
set local role authenticated;
select throws_ok($$select pg_temp.export()$$,'42501',null,'permission revocation prevents old export replay');
reset role;
select is((select count(*)::integer from private.taipei_abcd_export_snapshots),1,'one export snapshot without duplicate retry');
select * from finish();
rollback;
