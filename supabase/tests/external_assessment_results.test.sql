begin;
select plan(21);
set local time zone 'Asia/Taipei';
select set_config('test.external_result_amr',floor(extract(epoch from clock_timestamp()-interval '2 minutes'))::text,true);

insert into auth.users(id,aud,role,email,email_confirmed_at,created_at,updated_at) values
 ('e0100000-0000-4000-8000-000000000001','authenticated','authenticated','external-worker@care.example.invalid',now()-interval '1 day',now()-interval '1 day',now());
insert into auth.identities(id,provider_id,user_id,identity_data,provider) values
 ('e0200000-0000-4000-8000-000000000001','synthetic-external-worker','e0100000-0000-4000-8000-000000000001',
  '{"sub":"synthetic-external-worker","email":"external-worker@care.example.invalid","email_verified":true,"hd":"care.example.invalid"}','google');
insert into auth.sessions(id,user_id,created_at,aal) values
 ('e0300000-0000-4000-8000-000000000001','e0100000-0000-4000-8000-000000000001',now()-interval '3 minutes','aal1');
insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method)
 select ('e0400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'e0300000-0000-4000-8000-000000000001',
  to_timestamp(current_setting('test.external_result_amr')::bigint),to_timestamp(current_setting('test.external_result_amr')::bigint),'oauth'
 from generate_series(1,1)n;
insert into public.organizations(id,code,name) values
 ('e0500000-0000-4000-8000-000000000001','external_result_test','Synthetic external result organization'),
 ('e0500000-0000-4000-8000-000000000002','external_result_other','Synthetic other organization');
insert into public.branches(id,organization_id,code,name) values
 ('e0600000-0000-4000-8000-000000000001','e0500000-0000-4000-8000-000000000001','main','Synthetic main'),
 ('e0600000-0000-4000-8000-000000000002','e0500000-0000-4000-8000-000000000002','other','Synthetic other');
insert into public.profiles(id,display_name,kind) values
 ('e0100000-0000-4000-8000-000000000001','Synthetic external result worker','staff');
insert into public.memberships(id,organization_id,branch_id,profile_id,status,starts_at) values
 ('e0700000-0000-4000-8000-000000000001','e0500000-0000-4000-8000-000000000001','e0600000-0000-4000-8000-000000000001',
  'e0100000-0000-4000-8000-000000000001','active',now()-interval '1 day');
insert into public.membership_roles(membership_id,role_id) values
 ('e0700000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000006');
insert into private.staff_google_access_grants(allowed_user_id,organization_id,company_email_domain,allowed_email,google_subject,enabled,approval_reference)
 values('e0100000-0000-4000-8000-000000000001','e0500000-0000-4000-8000-000000000001','care.example.invalid',
  'external-worker@care.example.invalid','synthetic-external-worker',true,'Synthetic focused external-result approval');
insert into public.clients(id,organization_id,branch_id,client_code,display_name) values
 ('e0800000-0000-4000-8000-000000000001','e0500000-0000-4000-8000-000000000001','e0600000-0000-4000-8000-000000000001','SYN-EXT-1','Synthetic assigned client'),
 ('e0800000-0000-4000-8000-000000000002','e0500000-0000-4000-8000-000000000002','e0600000-0000-4000-8000-000000000002','SYN-EXT-2','Synthetic other organization client');
insert into public.client_assignments(organization_id,branch_id,client_id,assignee_user_id,assignment_kind,starts_at)
 values('e0500000-0000-4000-8000-000000000001','e0600000-0000-4000-8000-000000000001','e0800000-0000-4000-8000-000000000001',
  'e0100000-0000-4000-8000-000000000001','synthetic-external-result',now()-interval '1 day');

create function pg_temp.external_login() returns boolean language plpgsql security invoker as $$
begin
 perform set_config('request.jwt.claims',jsonb_build_object(
  'sub','e0100000-0000-4000-8000-000000000001','session_id','e0300000-0000-4000-8000-000000000001',
  'aud','authenticated','role','authenticated','aal','aal1','email','external-worker@care.example.invalid','is_anonymous',false,
  'iat',floor(extract(epoch from clock_timestamp())),'exp',floor(extract(epoch from clock_timestamp()+interval '30 minutes')),
  'amr',jsonb_build_array(jsonb_build_object('method','oauth','timestamp',current_setting('test.external_result_amr')::bigint))
 )::text,true);
 return public.is_staff_login_allowed();
end; $$;
create function pg_temp.external_payload() returns jsonb language sql as $$
 select jsonb_build_object('instrumentKey','barthel_adl','externalVersion','approved-paper-v1',
  'assessedOn',(now() at time zone 'Asia/Taipei')::date::text,'score',45,'maximumScore',100,
  'externalResult','Synthetic externally recorded result','performedBy','Synthetic assessor','source','Synthetic clinic',
  'followUpDueOn',null,'followUpNote',null); $$;
create function pg_temp.external_save(p_key uuid default 'e0900000-0000-4000-8000-000000000001',
 p_client uuid default 'e0800000-0000-4000-8000-000000000001',p_payload jsonb default null) returns jsonb
 language sql security invoker as $$
 select public.write_external_assessment_result('e0500000-0000-4000-8000-000000000001','e0600000-0000-4000-8000-000000000001',
  p_client,p_key,coalesce(p_payload,pg_temp.external_payload())); $$;

select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='private.external_assessment_results'::regclass),
 'result table forces RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='private.external_assessment_result_receipts'::regclass),
 'idempotency receipts force RLS');
select ok(not has_table_privilege('authenticated','private.external_assessment_results','select,insert,update,delete')
 and not has_table_privilege('service_role','private.external_assessment_results','select,insert,update,delete'),
 'no direct database role can bypass scoped RPC');
select ok(has_function_privilege('authenticated','public.write_external_assessment_result(uuid,uuid,uuid,uuid,jsonb)','execute')
 and has_function_privilege('authenticated','public.read_external_assessment_results(uuid,uuid,uuid)','execute')
 and not has_function_privilege('anon','public.write_external_assessment_result(uuid,uuid,uuid,uuid,jsonb)','execute')
 and not has_function_privilege('service_role','public.write_external_assessment_result(uuid,uuid,uuid,uuid,jsonb)','execute'),
 'only authenticated callers receive exact result RPCs');
select ok(not (select prosecdef from pg_proc where oid='public.write_external_assessment_result(uuid,uuid,uuid,uuid,jsonb)'::regprocedure)
 and (select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid='private.write_external_assessment_result(uuid,uuid,uuid,uuid,jsonb)'::regprocedure),
 'public wrapper is invoker and private core pins security definer path');
select is((select count(*)::integer from information_schema.columns where table_schema='private'
 and table_name='external_assessment_results' and column_name in ('questionnaire_answers','diagnosis','care_decision','signed_at')),0,
 'result-only model has no answers diagnosis decision or signature columns');
select is((select count(*)::integer from pg_trigger where not tgisinternal and tgname in (
 'external_assessment_results_append_only','external_assessment_result_receipts_append_only')),2,
 'result and idempotency history are append-only');

set local role authenticated;
select is(pg_temp.external_login(),true,'routine Google worker admitted with AAL1');
select lives_ok($$select pg_temp.external_save()$$,'assigned routine staff can append external result');
select is(pg_temp.external_save()->>'replayed','true','same idempotency key replays receipt');
select throws_ok($$select pg_temp.external_save(p_payload=>jsonb_set(pg_temp.external_payload(),'{externalResult}','"changed"'))$$,'23505',null,
 'same idempotency key cannot be reused for changed content');
select is((public.read_external_assessment_results('e0500000-0000-4000-8000-000000000001',
 'e0600000-0000-4000-8000-000000000001','e0800000-0000-4000-8000-000000000001')->>'total')::integer,1,
 'assigned staff read own client result');
select throws_ok($$select pg_temp.external_save(p_client=>'e0800000-0000-4000-8000-000000000002')$$,'42501',null,
 'cross-organization client access denied');
select throws_ok($$select pg_temp.external_save(p_payload=>jsonb_set(pg_temp.external_payload(),'{score}','101'))$$,'22023',null,
 'score above externally supplied maximum rejected');
select throws_ok($$select pg_temp.external_save(p_payload=>pg_temp.external_payload()||'{"diagnosis":"forged"}')$$,'22023',null,
 'unknown clinical field rejected');
select throws_ok($$select pg_temp.external_save(p_key=>'e0900000-0000-4000-8000-000000000002',
 p_payload=>pg_temp.external_payload()||'{"instrumentKey":"unapproved"}')$$,'22023',null,
 'instrument outside allowlist rejected');
select throws_ok($$select pg_temp.external_save(p_payload=>jsonb_set(pg_temp.external_payload(),'{externalResult}','"<script>bad</script>"'))$$,'22023',null,
 'markup and script content rejected');
select throws_ok($$update private.external_assessment_results set source='overwrite'$$,'42501',null,
 'authenticated caller cannot update private history directly');
select throws_ok($$select public.read_external_assessment_results('e0500000-0000-4000-8000-000000000001',
 'e0600000-0000-4000-8000-000000000001','e0800000-0000-4000-8000-000000000002')$$,'42501',null,
 'reader cannot cross-organization client scope');
reset role;

select is((select count(*)::integer from private.external_assessment_results),1,'one external record persisted, never a duplicate');
select ok(exists(select 1 from public.audit_events where table_name='external_assessment_results'
 and metadata->>'external_result_only'='true' and not metadata ? 'external_result'),
 'audit metadata omits the result narrative');
select * from finish();
rollback;
