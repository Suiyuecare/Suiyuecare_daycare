begin;
select plan(56);
-- Synthetic owner, Google identity and real production admission policy.
-- No admission/permission predicate is replaced for this suite.
select set_config('test.taipei_amr',floor(extract(epoch from clock_timestamp()-interval '2 minutes'))::text,true);
insert into auth.users(id,aud,role,email,email_confirmed_at,created_at,updated_at) values
 ('ab010000-0000-4000-8000-000000000001','authenticated','authenticated','taipei@example.invalid',now()-interval '1 day',now()-interval '1 day',now());
insert into auth.identities(id,provider_id,user_id,identity_data,provider) values
 ('ab020000-0000-4000-8000-000000000001','synthetic-taipei','ab010000-0000-4000-8000-000000000001','{"sub":"synthetic-taipei","email":"taipei@example.invalid","email_verified":true}','google');
insert into auth.sessions(id,user_id,created_at,aal) values
 ('ab030000-0000-4000-8000-000000000001','ab010000-0000-4000-8000-000000000001',now()-interval '3 minutes','aal2');
insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method)
select gen_random_uuid(),'ab030000-0000-4000-8000-000000000001',to_timestamp(current_setting('test.taipei_amr')::bigint),to_timestamp(current_setting('test.taipei_amr')::bigint),method
from (values('oauth'),('totp')) x(method);
insert into public.organizations(id,code,name) values('ab040000-0000-4000-8000-000000000001','taipei-test','合成機構');
insert into public.branches(id,organization_id,code,name) values
 ('ab050000-0000-4000-8000-000000000001','ab040000-0000-4000-8000-000000000001','main','合成分支'),
 ('ab050000-0000-4000-8000-000000000002','ab040000-0000-4000-8000-000000000001','other','他分支');
insert into public.profiles(id,display_name,kind) values('ab010000-0000-4000-8000-000000000001','合成主管','staff');
insert into public.memberships(id,organization_id,branch_id,profile_id,status,starts_at) values
 ('ab060000-0000-4000-8000-000000000001','ab040000-0000-4000-8000-000000000001','ab050000-0000-4000-8000-000000000001','ab010000-0000-4000-8000-000000000001','active',now()-interval '1 day');
insert into public.membership_roles(membership_id,role_id) select 'ab060000-0000-4000-8000-000000000001',id from public.roles where role_key='branch_supervisor' and is_system;
insert into public.clients(id,organization_id,branch_id,client_code,display_name) values
 ('ab070000-0000-4000-8000-000000000001','ab040000-0000-4000-8000-000000000001','ab050000-0000-4000-8000-000000000001','T-1','合成個案甲'),
 ('ab070000-0000-4000-8000-000000000002','ab040000-0000-4000-8000-000000000001','ab050000-0000-4000-8000-000000000002','T-2','他分支個案');
insert into private.executive_access_policy(allowed_user_id,allowed_email,google_subject,enabled,approval_reference)
values('ab010000-0000-4000-8000-000000000001','taipei@example.invalid','synthetic-taipei',true,'synthetic Taipei isolated test');
create function pg_temp.claims(p_aal text default 'aal2') returns void language plpgsql as $$ begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub','ab010000-0000-4000-8000-000000000001','session_id','ab030000-0000-4000-8000-000000000001',
  'aud','authenticated','role','authenticated','aal',p_aal,'email','taipei@example.invalid','is_anonymous',false,
  'iat',floor(extract(epoch from clock_timestamp())),'exp',floor(extract(epoch from clock_timestamp()+interval '30 minutes')),
  'amr',jsonb_build_array(jsonb_build_object('method','oauth','timestamp',current_setting('test.taipei_amr')::bigint),
   jsonb_build_object('method','totp','timestamp',current_setting('test.taipei_amr')::bigint)))::text,true);
end; $$;
create function pg_temp.payload(p_override jsonb default '{}') returns jsonb language sql as $$
 select jsonb_build_object('client_id','ab070000-0000-4000-8000-000000000001','form','A','usage_year',115,'month',0,
  'template_key','taipei.daycare.abcd.115.114-11.draft-v1','source_revision','114.11','source_sha256','64bb716b19362580295fe8ee2e452d32e82d6f3c67773d5956f66c7e17d3c481',
  'expected_version',0,'expected_content_hash',null,'answers','{"A1.name":{"state":"recorded","value":"合成個案","reason":null}}'::jsonb,
  'idempotency_key','ab080000-0000-4000-8000-000000000001')||p_override;
$$;
create function pg_temp.save(p_payload jsonb default pg_temp.payload()) returns jsonb language sql as $$
 select public.save_taipei_abcd_draft('ab040000-0000-4000-8000-000000000001','ab050000-0000-4000-8000-000000000001',p_payload,(p_payload->>'idempotency_key')::uuid);
$$;
create function pg_temp.snapshot(p_form text default 'A',p_month integer default 0) returns jsonb language sql as $$
 select public.taipei_abcd_draft_snapshot('ab040000-0000-4000-8000-000000000001','ab050000-0000-4000-8000-000000000001','ab070000-0000-4000-8000-000000000001',p_form,115,p_month);
$$;
create temporary table receipts(label text primary key,payload jsonb);
grant all on receipts to authenticated;

select ok((select bool_and(relrowsecurity and relforcerowsecurity) from pg_class where oid in ('private.taipei_abcd_draft_versions'::regclass,'private.taipei_abcd_draft_operations'::regclass)),'both ledgers force RLS');
select ok(not has_table_privilege('authenticated','private.taipei_abcd_draft_versions','select,insert,update,delete') and not has_table_privilege('service_role','private.taipei_abcd_draft_versions','select,insert,update,delete'),'no direct tables exposed');
select ok(not has_function_privilege('anon','public.save_taipei_abcd_draft(uuid,uuid,jsonb,uuid)','execute') and not has_function_privilege('service_role','public.save_taipei_abcd_draft(uuid,uuid,jsonb,uuid)','execute'),'no anonymous or service-role write RPC');
select ok(not (select prosecdef from pg_proc where oid='public.save_taipei_abcd_draft(uuid,uuid,jsonb,uuid)'::regprocedure),'public wrapper is invoker');
select ok((select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid='private.save_taipei_abcd_draft(uuid,uuid,jsonb,uuid)'::regprocedure),'guarded private core has empty search path');
select ok(not has_function_privilege('authenticated','private.taipei_abcd_month_sources(uuid,uuid,uuid,integer,integer)','execute'),'source helper not separately exposed');
select is((select count(*) from public.form_versions v join public.form_definitions d on d.id=v.form_definition_id where d.form_key like 'taipei.daycare.abcd%'),0::bigint,'migration creates no fake officially approved form version');
select ok(private.taipei_abcd_answers_valid('B','{"B1.pain_score":{"state":"recorded","value":0,"reason":null}}'),'zero is a recorded answer not missing');
select ok(not private.taipei_abcd_answers_valid('B','{"B1.pain_score":{"state":"recorded","value":11,"reason":null}}'),'numeric range enforced in database');
select ok(not private.taipei_abcd_answers_valid('B','{"B13.center.0":{"state":"unconfirmed","value":"10","reason":null}}'),'CMS suggestions cannot fill center assessment');
select ok(private.taipei_abcd_answers_valid('B','{"B13.central.0":{"state":"unconfirmed","value":"10","reason":null}}'),'central suggested value remains unconfirmed');
select ok(not private.taipei_abcd_answers_valid('A','{"A4.sex":{"state":"recorded","value":"arbitrary","reason":null}}'),'fixed option whitelist enforced');
select ok(not private.taipei_abcd_answers_valid('A','{"A8.status":{"state":"recorded","value":["一般戶","一般戶"],"reason":null}}'),'duplicate multiselect rejected');
select ok(not private.taipei_abcd_answers_valid('A','{"A6.birth_date":{"state":"recorded","value":"2026-02-30","reason":null}}'),'invalid calendar date rejected');
select ok(not private.taipei_abcd_answers_valid('A','{"A1.name":{"state":"not_applicable","value":null,"reason":null}}'),'NA requires explicit reason');
select ok(not private.taipei_abcd_answers_valid('C','{"C1.temperature":{"state":"recorded","value":36.5,"reason":null}}'),'client cannot fabricate C source values');
select ok(not private.taipei_abcd_answers_valid('B','{"unknown":{"state":"missing","value":null,"reason":null}}'),'unknown field blocked');

set local role anon;
select throws_ok($$select pg_temp.snapshot()$$,'42501',null,'anonymous denied');
reset role;
set local role authenticated;
select pg_temp.claims('aal1');
select lives_ok($$select pg_temp.snapshot()$$,'approved Google intake can read drafts at AAL1 without altering formal signing boundary');
select pg_temp.claims();
select is(pg_temp.snapshot()->'latest','null'::jsonb,'empty authorized snapshot returns no invented draft');
insert into receipts values('first',pg_temp.save());
select is((select payload->'draft'->>'state' from receipts where label='first'),'draft','save only produces draft');
select is((select payload->'draft'->>'publicationStatus' from receipts where label='first'),'pending_approval','not fake published');
select is(pg_temp.snapshot()->'latest'->'answers','{"A1.name":{"state":"recorded","value":"合成個案","reason":null}}'::jsonb,'GET reload reads canonical persisted data');
select is((pg_temp.save()->>'replayed')::boolean,true,'same key same payload is replayed');
select is(jsonb_array_length(pg_temp.snapshot()->'history'),1,'replay adds no duplicate version');
select throws_ok($$select pg_temp.save(pg_temp.payload('{"answers":{}}'))$$,'23505',null,'same key different content conflicts');
select throws_ok($$select pg_temp.save(pg_temp.payload('{"signed_by":"ab010000-0000-4000-8000-000000000001"}'))$$,'22023',null,'forged signature field rejected');
select throws_ok($$select pg_temp.save(pg_temp.payload('{"form":"D"}'))$$,'22023',null,'D lodging cannot be enabled');
select throws_ok($$select pg_temp.save(pg_temp.payload('{"usage_year":114}'))$$,'22023',null,'other official year cannot silently reuse template');
select throws_ok($$select pg_temp.save(pg_temp.payload('{"source_revision":"115.01"}'))$$,'22023',null,'source revision locked');
select throws_ok($$select pg_temp.save(pg_temp.payload('{"idempotency_key":"ab080000-0000-4000-8000-000000000002"}'))$$,'40001',null,'stale expected version rejected');
insert into receipts values('revision',pg_temp.save(pg_temp.payload(jsonb_build_object('idempotency_key','ab080000-0000-4000-8000-000000000002',
 'expected_version',1,'expected_content_hash',(select payload->'draft'->>'contentHash' from receipts where label='first'),
 'answers','{"A1.name":{"state":"recorded","value":"合成已核對個案","reason":null}}'::jsonb))));
select is((pg_temp.snapshot()->'latest'->>'version')::integer,2,'new save appends version 2');
select is((select payload->'draft'->>'previousVersionId' from receipts where label='revision'),(select payload->'draft'->>'id' from receipts where label='first'),'linear predecessor preserved');
select lives_ok($$select pg_temp.save(pg_temp.payload('{"form":"B","answers":{"B13.central.0":{"state":"recorded","value":"10","reason":null},"B13.center.0":{"state":"missing","value":null,"reason":null}},"idempotency_key":"ab080000-0000-4000-8000-000000000003"}'))$$,'B distinct chain may save without replacing A');
select is(pg_temp.snapshot('B')->'latest'->'answers'->'B13.center.0'->>'state','missing','CMS central did not fill center');
select is((pg_temp.snapshot()->'latest'->>'version')::integer,2,'A version unaffected by B');
select is(jsonb_array_length(pg_temp.snapshot('C',9)->'currentSources'->'measurements'),0,'empty month has no generated measurement');
select is(jsonb_array_length(pg_temp.snapshot('C',9)->'currentSources'->'careRecords'),0,'empty month has no generated care execution');
select throws_ok($$select public.taipei_abcd_draft_snapshot('ab040000-0000-4000-8000-000000000001','ab050000-0000-4000-8000-000000000002','ab070000-0000-4000-8000-000000000002','A',115,0)$$,'42501',null,'single-branch manager denied other branch');
select throws_ok($$select pg_temp.save(pg_temp.payload('{"client_id":"ab070000-0000-4000-8000-000000000002","idempotency_key":"ab080000-0000-4000-8000-000000000005"}'))$$,'42501',null,'forged client scope denied');
reset role;
select throws_ok($$update private.taipei_abcd_draft_versions set answers='{}'::jsonb$$,'55000',null,'owner cannot overwrite historical drafts');
select throws_ok($$delete from private.taipei_abcd_draft_versions$$,'55000',null,'owner cannot delete historical drafts');
select ok(not exists(select 1 from public.audit_events where table_name='private.taipei_abcd_draft_versions' and metadata::text like '%合成已核對個案%'),'audit metadata has no answer text');
insert into public.measurements(organization_id,branch_id,client_id,measurement_kind,measured_at,numeric_value,unit,recorded_by,idempotency_key)
 values('ab040000-0000-4000-8000-000000000001','ab050000-0000-4000-8000-000000000001','ab070000-0000-4000-8000-000000000001','temperature','2026-09-01T00:00:00+08',36.5,'°C','ab010000-0000-4000-8000-000000000001',gen_random_uuid()),
 ('ab040000-0000-4000-8000-000000000001','ab050000-0000-4000-8000-000000000001','ab070000-0000-4000-8000-000000000001','temperature','2026-10-01T00:00:00+08',37,'°C','ab010000-0000-4000-8000-000000000001',gen_random_uuid());
insert into public.care_records(organization_id,branch_id,client_id,category,occurred_at,created_by,data)
 values('ab040000-0000-4000-8000-000000000001','ab050000-0000-4000-8000-000000000001','ab070000-0000-4000-8000-000000000001','staff/daily-care/care-diary','2026-09-01T01:00:00+08','ab010000-0000-4000-8000-000000000001','{"note":"unsigned draft is not completed care"}');
set local role authenticated;
select is(jsonb_array_length(pg_temp.snapshot('C',9)->'currentSources'->'measurements'),1,'Taipei month boundary includes Sep 1 and excludes Oct 1');
select is(jsonb_array_length(pg_temp.snapshot('C',9)->'currentSources'->'careRecords'),0,'unsigned care draft is not C completed execution');
reset role;
insert into public.care_records(organization_id,branch_id,client_id,category,occurred_at,created_by,data,status,signed_at,signed_by,content_hash,signature_purpose,source_system)
select 'ab040000-0000-4000-8000-000000000001','ab050000-0000-4000-8000-000000000001','ab070000-0000-4000-8000-000000000001',
 'staff/daily-care/care-diary','2026-09-02T09:00:00+08','ab010000-0000-4000-8000-000000000001',
 '{"fields":{"care_item":"合成實際活動","note":"合成參與觀察"}}'::jsonb,'signed',now(),'ab010000-0000-4000-8000-000000000001',repeat('a',64),'synthetic test signature',source
from (values('local'),('central')) x(source);
set local role authenticated;
select is(jsonb_array_length(pg_temp.snapshot('C',9)->'currentSources'->'careRecords'),1,'only local signed record included, not imported historic signed record');
select is(pg_temp.snapshot('C',9)->'currentSources'->'careRecords'->0->'data'->>'note','合成參與觀察','C source reads actual nested care diary fields');
select lives_ok($$select pg_temp.save(pg_temp.payload('{"form":"C","month":9,"answers":{},"idempotency_key":"ab080000-0000-4000-8000-000000000006"}'))$$,'C draft saves server-generated immutable monthly source snapshot');
select is(jsonb_array_length(pg_temp.snapshot('C',9)->'latest'->'sourceSnapshot'->'measurements'),1,'saved C source snapshot is readable');
reset role;
create function pg_temp.fail_taipei_operation() returns trigger language plpgsql as $$ begin raise exception 'synthetic transaction interruption'; end; $$;
create trigger synthetic_taipei_failure before insert on private.taipei_abcd_draft_operations for each row execute function pg_temp.fail_taipei_operation();
set local role authenticated;
select throws_ok($$select pg_temp.save(pg_temp.payload('{"form":"C","month":8,"answers":{},"idempotency_key":"ab080000-0000-4000-8000-000000000007"}'))$$,'P0001','synthetic transaction interruption','injected operation-ledger failure aborts save');
select is(pg_temp.snapshot('C',8)->'latest','null'::jsonb,'failed transaction leaves no formal draft row');
reset role;
drop trigger synthetic_taipei_failure on private.taipei_abcd_draft_operations;
select is((select count(*) from private.taipei_abcd_draft_operations where idempotency_key='ab080000-0000-4000-8000-000000000007'),0::bigint,'failed transaction leaves no idempotency receipt');
delete from public.role_permissions where role_id=(select id from public.roles where is_system and role_key='branch_supervisor') and permission_id=(select id from public.permissions where permission_key='health.read');
set local role authenticated;
select throws_ok($$select pg_temp.snapshot('C',9)$$,'42501',null,'revoked health source access also blocks persisted C snapshot');
reset role;
delete from public.role_permissions where role_id=(select id from public.roles where is_system and role_key='branch_supervisor') and permission_id=(select id from public.permissions where permission_key='clients.demographics.read');
set local role authenticated;
select throws_ok($$select pg_temp.snapshot()$$,'42501',null,'revoked demographics cannot read A addresses contacts and birthday through assessment permission');
select throws_ok($$select pg_temp.save(pg_temp.payload())$$,'42501',null,'revoked demographics cannot replay A answers through saved receipt');
select lives_ok($$select pg_temp.snapshot('B')$$,'non-demographic B assessment access remains independently authorized');
reset role;
select * from finish();
rollback;
