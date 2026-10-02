begin;
select plan(62);
set local time zone 'Asia/Taipei';
select set_config('test.questionnaire_history_amr',floor(extract(epoch from clock_timestamp()-interval '2 minutes'))::text,true);

-- Real, synthetic admitted Google staff fixture. No admission/authority
-- predicate is replaced, and no production credentials or records are used.
insert into auth.users(id,aud,role,email,email_confirmed_at,created_at,updated_at) values
 ('a7100000-0000-4000-8000-000000000001','authenticated','authenticated','history-nurse@care.example.invalid',now()-interval '1 day',now()-interval '1 day',now());
insert into auth.identities(id,provider_id,user_id,identity_data,provider) values
 ('a7200000-0000-4000-8000-000000000001','synthetic-history-nurse','a7100000-0000-4000-8000-000000000001',
  '{"sub":"synthetic-history-nurse","email":"history-nurse@care.example.invalid","email_verified":true,"hd":"care.example.invalid"}','google');
insert into auth.sessions(id,user_id,created_at,aal) values
 ('a7300000-0000-4000-8000-000000000001','a7100000-0000-4000-8000-000000000001',now()-interval '3 minutes','aal1');
insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method) values
 ('a7400000-0000-4000-8000-000000000001','a7300000-0000-4000-8000-000000000001',
  to_timestamp(current_setting('test.questionnaire_history_amr')::bigint),to_timestamp(current_setting('test.questionnaire_history_amr')::bigint),'oauth');
insert into public.organizations(id,code,name) values
 ('a7500000-0000-4000-8000-000000000001','questionnaire_history_test','Synthetic questionnaire history organization'),
 ('a7500000-0000-4000-8000-000000000002','questionnaire_history_other','Synthetic other organization');
insert into public.branches(id,organization_id,code,name) values
 ('a7600000-0000-4000-8000-000000000001','a7500000-0000-4000-8000-000000000001','main','Synthetic main'),
 ('a7600000-0000-4000-8000-000000000002','a7500000-0000-4000-8000-000000000002','other','Synthetic other');
insert into public.profiles(id,display_name,kind) values
 ('a7100000-0000-4000-8000-000000000001','Synthetic history nurse','staff');
insert into public.memberships(id,organization_id,branch_id,profile_id,status,starts_at) values
 ('a7700000-0000-4000-8000-000000000001','a7500000-0000-4000-8000-000000000001','a7600000-0000-4000-8000-000000000001',
  'a7100000-0000-4000-8000-000000000001','active',now()-interval '1 day');
insert into public.membership_roles(membership_id,role_id)
 select 'a7700000-0000-4000-8000-000000000001',id from public.roles where role_key='nurse' and is_system;
insert into private.staff_google_access_grants(allowed_user_id,organization_id,company_email_domain,allowed_email,google_subject,enabled,approval_reference)
 values('a7100000-0000-4000-8000-000000000001','a7500000-0000-4000-8000-000000000001','care.example.invalid',
  'history-nurse@care.example.invalid','synthetic-history-nurse',true,'Synthetic approved history nurse');
insert into public.clients(id,organization_id,branch_id,client_code,display_name) values
 ('a7800000-0000-4000-8000-000000000001','a7500000-0000-4000-8000-000000000001','a7600000-0000-4000-8000-000000000001','SYN-HIS-1','Synthetic assigned client'),
 ('a7800000-0000-4000-8000-000000000002','a7500000-0000-4000-8000-000000000001','a7600000-0000-4000-8000-000000000001','SYN-HIS-2','Synthetic unassigned client'),
 ('a7800000-0000-4000-8000-000000000003','a7500000-0000-4000-8000-000000000002','a7600000-0000-4000-8000-000000000002','SYN-HIS-3','Synthetic other client');
insert into public.client_assignments(organization_id,branch_id,client_id,assignee_user_id,assignment_kind,starts_at)
 values('a7500000-0000-4000-8000-000000000001','a7600000-0000-4000-8000-000000000001','a7800000-0000-4000-8000-000000000001',
  'a7100000-0000-4000-8000-000000000001','synthetic-history',now()-interval '1 day');

create function pg_temp.history_login() returns boolean language plpgsql security invoker as $$
begin
 perform set_config('request.jwt.claims',jsonb_build_object(
  'sub','a7100000-0000-4000-8000-000000000001','session_id','a7300000-0000-4000-8000-000000000001',
  'aud','authenticated','role','authenticated','aal','aal1','email','history-nurse@care.example.invalid','is_anonymous',false,
  'iat',floor(extract(epoch from clock_timestamp())),'exp',floor(extract(epoch from clock_timestamp()+interval '30 minutes')),
  'amr',jsonb_build_array(jsonb_build_object('method','oauth','timestamp',current_setting('test.questionnaire_history_amr')::bigint))
 )::text,true);
 return public.is_staff_login_allowed();
end; $$;
create function pg_temp.history_payload() returns jsonb language sql security invoker as $$
 select jsonb_build_object('action','create','client_id','a7800000-0000-4000-8000-000000000001',
  'form_key','spmsq','form_version','spmsq-pfeiffer-10-education-adjusted-v1','assessed_on','2026-09-25',
  'answers',(select jsonb_object_agg('spmsq_'||lpad(n::text,2,'0'),'{"state":"answered","value":"correct"}'::jsonb) from generate_series(1,10)n),
  'context','{"education_adjustment":"middle_or_high_school"}'::jsonb);
$$;
create function pg_temp.history_list(p_stamp timestamptz default null,p_key uuid default null) returns jsonb language sql security invoker as $$
 select public.questionnaire_assessment_list('a7500000-0000-4000-8000-000000000001','a7600000-0000-4000-8000-000000000001',
 'spmsq','a7800000-0000-4000-8000-000000000001',p_stamp,p_key);
$$;


-- A second independently approved actor can read the same assigned case but
-- must never resolve the first actor's original operation key.
insert into auth.users(id,aud,role,email,email_confirmed_at,created_at,updated_at) values
 ('a7100000-0000-4000-8000-000000000002','authenticated','authenticated','history-reader@care.example.invalid',now()-interval '1 day',now()-interval '1 day',now());
insert into auth.identities(id,provider_id,user_id,identity_data,provider) values
 ('a7200000-0000-4000-8000-000000000002','synthetic-history-reader','a7100000-0000-4000-8000-000000000002',
 '{"sub":"synthetic-history-reader","email":"history-reader@care.example.invalid","email_verified":true,"hd":"care.example.invalid"}','google');
insert into auth.sessions(id,user_id,created_at,aal) values
 ('a7300000-0000-4000-8000-000000000002','a7100000-0000-4000-8000-000000000002',now()-interval '3 minutes','aal1');
insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method) values
 ('a7400000-0000-4000-8000-000000000002','a7300000-0000-4000-8000-000000000002',
 to_timestamp(current_setting('test.questionnaire_history_amr')::bigint),to_timestamp(current_setting('test.questionnaire_history_amr')::bigint),'oauth');
insert into public.profiles(id,display_name,kind) values ('a7100000-0000-4000-8000-000000000002','Synthetic reader','staff');
insert into public.memberships(id,organization_id,branch_id,profile_id,status,starts_at) values
 ('a7700000-0000-4000-8000-000000000002','a7500000-0000-4000-8000-000000000001','a7600000-0000-4000-8000-000000000001',
 'a7100000-0000-4000-8000-000000000002','active',now()-interval '1 day');
insert into public.membership_roles(membership_id,role_id) select 'a7700000-0000-4000-8000-000000000002',id from public.roles where role_key='nurse' and is_system;
insert into private.staff_google_access_grants(allowed_user_id,organization_id,company_email_domain,allowed_email,google_subject,enabled,approval_reference) values
 ('a7100000-0000-4000-8000-000000000002','a7500000-0000-4000-8000-000000000001','care.example.invalid','history-reader@care.example.invalid','synthetic-history-reader',true,'Synthetic reader approval');
insert into public.client_assignments(organization_id,branch_id,client_id,assignee_user_id,assignment_kind,starts_at) values
 ('a7500000-0000-4000-8000-000000000001','a7600000-0000-4000-8000-000000000001','a7800000-0000-4000-8000-000000000001','a7100000-0000-4000-8000-000000000002','synthetic-reader',now()-interval '1 day');

-- Native setup extracts only the above synthetic actual admission fixture.
create temporary table receipt_payloads as select r.form_key,jsonb_build_object(
 'action','create','client_id','a7800000-0000-4000-8000-000000000001','form_key',r.form_key,'form_version',r.form_version,
 'assessed_on',(clock_timestamp() at time zone 'Asia/Taipei')::date,
 'answers',(select jsonb_object_agg(item->>'id',jsonb_build_object('state','answered','value',item->'choices'->0->>'value')) from jsonb_array_elements(r.manifest_json->'rules'->'items') item),
 'context',case when r.form_key='spmsq' then '{"education_adjustment":"middle_or_high_school"}'::jsonb when r.form_key='mna_sf' then '{"height_cm":"170.0","weight_kg":"50.0"}'::jsonb else '{}'::jsonb end) payload
 from private.questionnaire_rule_catalog r;
create temporary table receipt_results(form_key text,action text,key uuid,receipt jsonb,proof jsonb,primary key(form_key,action));
grant select on receipt_payloads to authenticated;
grant select,insert,update on receipt_results to authenticated;
create function pg_temp.receipt_read(p_form text,p_action text,p_key uuid,p_nonce uuid default 'a7c00000-0000-4000-8000-000000000001')
returns jsonb language sql security invoker as $$
 select public.questionnaire_assessment_operation_receipt('a7500000-0000-4000-8000-000000000001','a7600000-0000-4000-8000-000000000001',p_form,'a7800000-0000-4000-8000-000000000001',p_action,p_key,p_nonce);
$$;
select ok(not has_function_privilege('anon','public.questionnaire_assessment_operation_receipt(uuid,uuid,text,uuid,text,uuid,uuid)','execute') and not has_function_privilege('service_role','public.questionnaire_assessment_operation_receipt(uuid,uuid,text,uuid,text,uuid,uuid)','execute'),'anon/service cannot call original receipt');
select ok(not has_table_privilege('authenticated','private.questionnaire_assessment_operations','select') and not has_table_privilege('service_role','private.questionnaire_assessment_operations','select'),'operation table remains inaccessible');
select ok(not(select prosecdef from pg_proc where oid='public.questionnaire_assessment_operation_receipt(uuid,uuid,text,uuid,text,uuid,uuid)'::regprocedure),'public receipt wrapper is invoker');
select ok((select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid='private.questionnaire_assessment_operation_receipt_guarded(uuid,uuid,text,uuid,text,uuid,uuid)'::regprocedure),'private receipt guard pins path');
select ok(pg_get_functiondef('private.questionnaire_assessment_operation_receipt_guarded(uuid,uuid,text,uuid,text,uuid,uuid)'::regprocedure) !~ 'pg_advisory|for update|mutate_questionnaire|reauth_challenges','receipt function has no mutation/replay/lock/MFA path');
set local role authenticated;
select is(pg_temp.history_login(),true,'actual Google AAL1 admission remains valid');
insert into receipt_results(form_key,action,key) select form_key,'create',gen_random_uuid() from receipt_payloads;
update receipt_results r set receipt=public.mutate_questionnaire_assessment('a7500000-0000-4000-8000-000000000001','a7600000-0000-4000-8000-000000000001',p.payload,r.key) from receipt_payloads p where p.form_key=r.form_key;
update receipt_results set proof=pg_temp.receipt_read(form_key,action,key);
select ok(proof->>'status'='committed' and proof->'receipt'=receipt and proof->'persisted'='true'::jsonb and proof->'request'->'assessment_key'='null'::jsonb and proof->'request'->'previous_version_id'='null'::jsonb and proof->'request'->'expected_version'='0'::jsonb,form_key||' exact original create receipt and null/null/0 baseline') from receipt_results order by form_key;
insert into receipt_results(form_key,action,key,receipt)
select p.form_key,'revise',gen_random_uuid(),r.receipt from receipt_payloads p join receipt_results r on r.form_key=p.form_key and r.action='create';
update receipt_results r set receipt=public.mutate_questionnaire_assessment('a7500000-0000-4000-8000-000000000001','a7600000-0000-4000-8000-000000000001',
 p.payload||jsonb_build_object('action','revise','assessment_key',r.receipt->'assessmentKey','previous_version_id',r.receipt->'versionId','expected_version',1),r.key) from receipt_payloads p where p.form_key=r.form_key and r.action='revise';
update receipt_results set proof=pg_temp.receipt_read(form_key,action,key);
select ok(proof->'receipt'=receipt and (proof->'draft'->>'version')::integer=2 and proof->'request'->'expected_version'='1'::jsonb and proof->'request'->'previous_version_id'=(select c.receipt->'versionId' from receipt_results c where c.form_key=r.form_key and c.action='create'),form_key||' exact original revise chain') from receipt_results r where action='revise' order by form_key;
select is((pg_temp.receipt_read('spmsq','create',(select key from receipt_results where form_key='spmsq' and action='create'))->'draft'->>'version')::integer,1,'old create proof is not relabelled newest version');
select ok((pg_temp.receipt_read('spmsq','create','a7d00000-0000-4000-8000-000000000999')->'request')='null'::jsonb,'missing key gives no request');
select is(pg_temp.receipt_read('spmsq','revise',(select key from receipt_results where form_key='spmsq' and action='create'))->>'status','not_found','wrong action gives no positive proof');
select is(pg_temp.receipt_read('gds_15','create',(select key from receipt_results where form_key='spmsq' and action='create'))->>'status','not_found','wrong form gives no positive proof');
select throws_ok($$select pg_temp.receipt_read('spmsq','create',gen_random_uuid(),null)$$,'22023','invalid questionnaire receipt lookup','null nonce invalid');
select throws_ok($$select pg_temp.receipt_read('spmsq','sign',gen_random_uuid())$$,'22023','invalid questionnaire receipt lookup','sign is not a draft action');
select throws_ok($$select public.questionnaire_assessment_operation_receipt('a7500000-0000-4000-8000-000000000001','a7600000-0000-4000-8000-000000000001','spmsq','a7800000-0000-4000-8000-000000000002','create',gen_random_uuid(),gen_random_uuid())$$,'42501','questionnaire receipt lookup is not permitted','unassigned case denied');
select throws_ok($$select public.questionnaire_assessment_operation_receipt('a7500000-0000-4000-8000-000000000002','a7600000-0000-4000-8000-000000000002','spmsq','a7800000-0000-4000-8000-000000000003','create',gen_random_uuid(),gen_random_uuid())$$,'42501','questionnaire receipt lookup is not permitted','cross-organization denied');
set local time zone 'UTC';
select ok(pg_temp.receipt_read('spmsq','create',(select key from receipt_results where form_key='spmsq' and action='create'))->'receipt'=(select receipt from receipt_results where form_key='spmsq' and action='create'),'UTC read preserves historic Taiwan wire bytes');
set local time zone 'America/New_York';
select ok(pg_temp.receipt_read('spmsq','revise',(select key from receipt_results where form_key='spmsq' and action='revise'))->'receipt'=(select receipt from receipt_results where form_key='spmsq' and action='revise'),'negative offset read preserves historic original bytes');
reset role;
create function pg_temp.receipt_corrupt(p_kind text) returns text language plpgsql security definer set search_path='' as $$
declare result text; op private.questionnaire_assessment_operations; v public.questionnaire_assessment_versions;
begin
 select o.* into op from private.questionnaire_assessment_operations o join pg_temp.receipt_results r on r.key=o.idempotency_key where r.form_key='spmsq' and r.action='revise';
 select row.* into v from public.questionnaire_assessment_versions row where row.id=op.result_version_id;
 begin
  alter table private.questionnaire_assessment_operations disable trigger questionnaire_assessment_operations_append_only;
  alter table public.questionnaire_assessment_versions disable trigger questionnaire_assessment_versions_append_only;
  if p_kind='receipt extra' then update private.questionnaire_assessment_operations set receipt=receipt||'{"score":0}' where id=op.id;
  elsif p_kind='receipt replay' then update private.questionnaire_assessment_operations set receipt=jsonb_set(receipt,'{replayed}','true') where id=op.id;
  elsif p_kind='receipt timestamp type' then update private.questionnaire_assessment_operations set receipt=jsonb_set(receipt,'{committedAt}','123') where id=op.id;
  elsif p_kind='receipt timestamp instant' then update private.questionnaire_assessment_operations set receipt=jsonb_set(receipt,'{committedAt}','"2000-01-01T00:00:00Z"') where id=op.id;
  elsif p_kind='request hash' then update private.questionnaire_assessment_operations set request_hash=repeat('0',64) where id=op.id;
  elsif p_kind='result author' then update public.questionnaire_assessment_versions set author_user_id='a7100000-0000-4000-8000-000000000002' where id=v.id;
  elsif p_kind='result answers' then update public.questionnaire_assessment_versions set answers=jsonb_set(answers,'{spmsq_01,value}','"incorrect"') where id=v.id;
  elsif p_kind='result hash' then update public.questionnaire_assessment_versions set content_hash=repeat('0',64) where id=v.id;
  elsif p_kind='previous hash' then update public.questionnaire_assessment_versions set content_hash=repeat('0',64) where id=v.previous_version_id;
  elsif p_kind='previous answers' then update public.questionnaire_assessment_versions set answers=jsonb_set(answers,'{spmsq_01,value}','"incorrect"') where id=v.previous_version_id;
  else raise exception 'unknown synthetic corruption';end if;
  perform pg_temp.receipt_read('spmsq','revise',op.idempotency_key);
  raise exception using errcode='P0001',message='corrupted proof was accepted';
 exception when others then result:=SQLSTATE;end;
 return result;
end;$$;
select is(pg_temp.receipt_corrupt(kind),'23514',kind||' fails closed without changing stored rows') from unnest(array['receipt extra','receipt replay','receipt timestamp type','receipt timestamp instant','request hash','result author','result answers','result hash','previous hash','previous answers'])kind;
select set_config('request.jwt.claims',jsonb_build_object('sub','a7100000-0000-4000-8000-000000000002','session_id','a7300000-0000-4000-8000-000000000002','aud','authenticated','role','authenticated','aal','aal1','email','history-reader@care.example.invalid','is_anonymous',false,'iat',floor(extract(epoch from clock_timestamp())),'exp',floor(extract(epoch from clock_timestamp()+interval '30 minutes')),'app_metadata',jsonb_build_object('provider','google','providers',jsonb_build_array('google')),'amr',jsonb_build_array(jsonb_build_object('method','oauth','timestamp',current_setting('test.questionnaire_history_amr')::bigint)))::text,true);
set local role authenticated;
select is(public.is_staff_login_allowed(),true,'second actor genuinely admitted');
select is(pg_temp.receipt_read('spmsq','create',(select key from receipt_results where form_key='spmsq' and action='create'))->>'status','not_found','read-authorized other actor cannot resolve original key');
select is(pg_temp.history_login(),true,'original actor read restored');
reset role;
create temporary table receipt_counts as select (select count(*) from public.questionnaire_assessment_versions)versions,(select count(*) from private.questionnaire_assessment_operations)operations,(select count(*) from private.reauth_events)reauth,(select count(*) from private.questionnaire_rule_activations)activations;
create temporary table receipt_manage as select rp.* from public.role_permissions rp join public.roles r on r.id=rp.role_id join public.permissions p on p.id=rp.permission_id where r.role_key='nurse' and p.permission_key like 'questionnaire_%.manage';
update public.role_permissions rp set granted_at=clock_timestamp()+interval '1 hour' from receipt_manage m where m.role_id=rp.role_id and m.permission_id=rp.permission_id;
set local role authenticated;
select is(pg_temp.receipt_read('spmsq','revise',(select key from receipt_results where form_key='spmsq' and action='revise'))->>'status','committed','read-only actor needs no manage/sign or new MFA');
reset role;
select ok((select versions=(select count(*) from public.questionnaire_assessment_versions) and operations=(select count(*) from private.questionnaire_assessment_operations) and reauth=(select count(*) from private.reauth_events) and activations=(select count(*) from private.questionnaire_rule_activations) from receipt_counts),'read proof creates no version/operation/MFA/adoption');
select ok(not exists(select 1 from public.audit_events where metadata->>'workflow'='questionnaire_own_operation_receipt_v1' and (metadata ?| array['answers','context','request','receipt','idempotencyKey','idempotency_key','nonce','contentHash','content_hash','client_id','assessment_key'] or row_pk<>'own-operation')),'audits exclude private body key nonce and hashes');
set local role authenticated;
select throws_ok($$select public.questionnaire_assessment_operation_receipt(null,'a7600000-0000-4000-8000-000000000001','spmsq','a7800000-0000-4000-8000-000000000001','create',gen_random_uuid(),gen_random_uuid())$$,'22023','invalid questionnaire receipt lookup','null organization rejected');
select throws_ok($$select public.questionnaire_assessment_operation_receipt('a7500000-0000-4000-8000-000000000001',null,'spmsq','a7800000-0000-4000-8000-000000000001','create',gen_random_uuid(),gen_random_uuid())$$,'22023','invalid questionnaire receipt lookup','null branch rejected');
select throws_ok($$select pg_temp.receipt_read(null,'create',gen_random_uuid())$$,'22023','invalid questionnaire receipt lookup','null form rejected');
select throws_ok($$select pg_temp.receipt_read('unregistered','create',gen_random_uuid())$$,'22023','invalid questionnaire receipt lookup','unregistered form rejected');
select throws_ok($$select pg_temp.receipt_read('spmsq',null,gen_random_uuid())$$,'22023','invalid questionnaire receipt lookup','null action rejected');
select throws_ok($$select pg_temp.receipt_read('spmsq','create',null)$$,'22023','invalid questionnaire receipt lookup','null operation key rejected');
select throws_ok($$select public.questionnaire_assessment_operation_receipt('a7500000-0000-4000-8000-000000000001','a7600000-0000-4000-8000-000000000001','spmsq',null,'create',gen_random_uuid(),gen_random_uuid())$$,'22023','invalid questionnaire receipt lookup','null case rejected');
reset role;
update public.branches set is_active=false where id='a7600000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select pg_temp.receipt_read('spmsq','create',(select key from receipt_results where form_key='spmsq' and action='create'))$$,'42501','questionnaire receipt lookup is not permitted','disabled branch closes receipt');
reset role;
update public.branches set is_active=true where id='a7600000-0000-4000-8000-000000000001';
create temporary table receipt_reads as select rp.* from public.role_permissions rp join public.roles r on r.id=rp.role_id join public.permissions p on p.id=rp.permission_id where r.role_key='nurse' and p.permission_key='questionnaire_cognition.read';
update public.role_permissions rp set granted_at=clock_timestamp()+interval '1 hour' from receipt_reads m where m.role_id=rp.role_id and m.permission_id=rp.permission_id;
set local role authenticated;
select throws_ok($$select pg_temp.receipt_read('spmsq','create',(select key from receipt_results where form_key='spmsq' and action='create'))$$,'42501','questionnaire receipt lookup is not permitted','future read grant denied');
reset role;
update public.role_permissions rp set granted_at=m.granted_at from receipt_reads m where m.role_id=rp.role_id and m.permission_id=rp.permission_id;
update public.client_assignments set ends_at=clock_timestamp()-interval '1 second' where assignee_user_id='a7100000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select pg_temp.receipt_read('spmsq','create',(select key from receipt_results where form_key='spmsq' and action='create'))$$,'42501','questionnaire receipt lookup is not permitted','expired assignment denied');
reset role;
update public.client_assignments set ends_at=null where assignee_user_id='a7100000-0000-4000-8000-000000000001';
update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='a7300000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select pg_temp.receipt_read('spmsq','create',(select key from receipt_results where form_key='spmsq' and action='create'))$$,'42501','questionnaire receipt lookup is not permitted','expired actual session denied');
reset role;
update auth.sessions set not_after=null where id='a7300000-0000-4000-8000-000000000001';
update private.staff_google_access_grants set enabled=false where allowed_user_id='a7100000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select pg_temp.receipt_read('spmsq','create',(select key from receipt_results where form_key='spmsq' and action='create'))$$,'42501','questionnaire receipt lookup is not permitted','Google revocation closes recovery read');
reset role;
select * from finish();
rollback;
