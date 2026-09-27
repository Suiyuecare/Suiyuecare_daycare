begin;
select plan(42);
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

create temporary table readiness_results(form_key text primary key,receipt jsonb,source jsonb);
grant select,insert,update on readiness_results to authenticated;
create function pg_temp.readiness_read(p_form text,p_receipt jsonb,p_nonce uuid default 'a7c00000-0000-4000-8000-000000000001') returns jsonb language sql security invoker as $$
 select public.questionnaire_assessment_readiness_source('a7500000-0000-4000-8000-000000000001','a7600000-0000-4000-8000-000000000001',p_form,'a7800000-0000-4000-8000-000000000001',(p_receipt->>'versionId')::uuid,p_receipt->>'contentHash',p_nonce);
$$;
select is((select count(*)::integer from private.questionnaire_rule_catalog),9,'old scoring catalog remains exactly nine candidates');
select is((select count(*)::integer from private.questionnaire_validation_catalog),9,'nine exact validation candidates registered');
select is((select count(*)::integer from private.questionnaire_readiness_catalog),9,'nine separate bundle candidates registered');
select ok((select bool_and(relrowsecurity and relforcerowsecurity) from pg_class where oid in ('private.questionnaire_validation_catalog'::regclass,'private.questionnaire_readiness_catalog'::regclass)),'private catalogs force RLS');
select ok(not has_table_privilege('authenticated','private.questionnaire_readiness_catalog','select') and not has_table_privilege('service_role','private.questionnaire_validation_catalog','select'),'no direct authenticated/service catalog access');
select ok(not has_function_privilege('anon','public.questionnaire_assessment_readiness_source(uuid,uuid,text,uuid,uuid,text,uuid)','execute') and not has_function_privilege('service_role','public.questionnaire_assessment_readiness_source(uuid,uuid,text,uuid,uuid,text,uuid)','execute'),'anon and service cannot call source');
select ok(not (select prosecdef from pg_proc where oid='public.questionnaire_assessment_readiness_source(uuid,uuid,text,uuid,uuid,text,uuid)'::regprocedure),'public wrapper is invoker');
select ok((select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid='private.questionnaire_assessment_readiness_source_guarded(uuid,uuid,text,uuid,uuid,text,uuid)'::regprocedure),'guarded core pins search path');
select throws_ok($$update private.questionnaire_validation_catalog set validation_version=validation_version$$,'55000',null,'validation identity is immutable');
select throws_ok($$delete from private.questionnaire_readiness_catalog$$,'55000',null,'bundle cannot be retired by delete');
select throws_ok($$insert into private.questionnaire_readiness_catalog select repeat('f',64),scoring_catalog_hash,validation_catalog_hash,form_key,form_version,rule_version,validation_version,canonical_json,manifest_json,clock_timestamp() from private.questionnaire_readiness_catalog limit 1$$,'23514',null,'a forged bundle hash is rejected');
select throws_ok($$insert into private.questionnaire_validation_catalog select repeat('e',64),scoring_catalog_hash,'gds_15',form_version,rule_version,validation_version||'-forged',canonical_json,manifest_json,clock_timestamp() from private.questionnaire_validation_catalog where form_key='spmsq'$$,'23514','candidate catalog identity mismatch','cross-form catalog binding is rejected');

-- Snapshot only test data from the already immutable candidates, as deployment owner.
create temporary table readiness_payloads as select r.form_key,jsonb_build_object(
 'action','create','client_id','a7800000-0000-4000-8000-000000000001','form_key',r.form_key,'form_version',r.form_version,
 'assessed_on',(clock_timestamp() at time zone 'Asia/Taipei')::date,
 'answers',(select jsonb_object_agg(item->>'id',jsonb_build_object('state','answered','value',item->'choices'->0->>'value')) from jsonb_array_elements(r.manifest_json->'rules'->'items') item),
 'context',case when r.form_key='spmsq' then '{"education_adjustment":"middle_or_high_school"}'::jsonb
 when r.form_key='mna_sf' then '{"height_cm":"170.0","weight_kg":"50.0"}'::jsonb else '{}'::jsonb end) payload
 from private.questionnaire_rule_catalog r;
grant select on readiness_payloads to authenticated;
set local role authenticated;
select is(pg_temp.history_login(),true,'real approved Google AAL1 nurse is admitted without new MFA');
insert into readiness_results(form_key,receipt)
 select form_key,public.mutate_questionnaire_assessment('a7500000-0000-4000-8000-000000000001','a7600000-0000-4000-8000-000000000001',payload,gen_random_uuid()) from readiness_payloads;
update readiness_results set source=pg_temp.readiness_read(form_key,receipt);
select ok((select source->>'schemaVersion'='questionnaire-readiness-source.v1' and source->>'formKey'='spmsq' and source->'formalScore'='null'::jsonb and source->'signable'='false'::jsonb and source->'bundle'->>'bundleHash'='31be03f49a1959cb5281936f96cace74ba5843a82b4f6cf235ed86cd5a6b1629' and source->'draft'->>'contentHash'=receipt->>'contentHash' and source->>'currentVersionId'=receipt->>'versionId' from readiness_results where form_key='spmsq'),'spmsq exact saved candidate and no signing claim');
select ok((select source->>'schemaVersion'='questionnaire-readiness-source.v1' and source->>'formKey'='gds_15' and source->'formalScore'='null'::jsonb and source->'signable'='false'::jsonb and source->'bundle'->>'bundleHash'='bb7aad552c91f8b61c22376c533569a1f64481ddf6b3067a383cd368e2db6b78' and source->'draft'->>'contentHash'=receipt->>'contentHash' and source->>'currentVersionId'=receipt->>'versionId' from readiness_results where form_key='gds_15'),'gds_15 exact saved candidate and no signing claim');
select ok((select source->>'schemaVersion'='questionnaire-readiness-source.v1' and source->>'formKey'='barthel_adl' and source->'formalScore'='null'::jsonb and source->'signable'='false'::jsonb and source->'bundle'->>'bundleHash'='5c19c3a1795d486d37d0643e124395b8a7edbb0ac1c2daa928fc33ca89d1413f' and source->'draft'->>'contentHash'=receipt->>'contentHash' and source->>'currentVersionId'=receipt->>'versionId' from readiness_results where form_key='barthel_adl'),'barthel_adl exact saved candidate and no signing claim');
select ok((select source->>'schemaVersion'='questionnaire-readiness-source.v1' and source->>'formKey'='lawton_iadl' and source->'formalScore'='null'::jsonb and source->'signable'='false'::jsonb and source->'bundle'->>'bundleHash'='c9127557b9446210d9cdf4e75392799304fff22a7e82e9ee31403f056029af66' and source->'draft'->>'contentHash'=receipt->>'contentHash' and source->>'currentVersionId'=receipt->>'versionId' from readiness_results where form_key='lawton_iadl'),'lawton_iadl exact saved candidate and no signing claim');
select ok((select source->>'schemaVersion'='questionnaire-readiness-source.v1' and source->>'formKey'='eat10_swallowing' and source->'formalScore'='null'::jsonb and source->'signable'='false'::jsonb and source->'bundle'->>'bundleHash'='aa49c982449aeae89de0cde1d719b051ee8b44a9b11c95fc79d69f9fa699cd47' and source->'draft'->>'contentHash'=receipt->>'contentHash' and source->>'currentVersionId'=receipt->>'versionId' from readiness_results where form_key='eat10_swallowing'),'eat10_swallowing exact saved candidate and no signing claim');
select ok((select source->>'schemaVersion'='questionnaire-readiness-source.v1' and source->>'formKey'='bsrs5' and source->'formalScore'='null'::jsonb and source->'signable'='false'::jsonb and source->'bundle'->>'bundleHash'='103154b2a90d4bac39f798a35da0db72c0ed479cb2495716ec344822b654f38a' and source->'draft'->>'contentHash'=receipt->>'contentHash' and source->>'currentVersionId'=receipt->>'versionId' from readiness_results where form_key='bsrs5'),'bsrs5 exact saved candidate and no signing claim');
select ok((select source->>'schemaVersion'='questionnaire-readiness-source.v1' and source->>'formKey'='fall_risk_taipei_115' and source->'formalScore'='null'::jsonb and source->'signable'='false'::jsonb and source->'bundle'->>'bundleHash'='d2b335f7f7314046473c096729353bef8013732cfcbeefa6c7e0336293cd0458' and source->'draft'->>'contentHash'=receipt->>'contentHash' and source->>'currentVersionId'=receipt->>'versionId' from readiness_results where form_key='fall_risk_taipei_115'),'fall_risk_taipei_115 exact saved candidate and no signing claim');
select ok((select source->>'schemaVersion'='questionnaire-readiness-source.v1' and source->>'formKey'='nsi_determine' and source->'formalScore'='null'::jsonb and source->'signable'='false'::jsonb and source->'bundle'->>'bundleHash'='92d87d1d5797461a3402059bbd5f2631a41073629c1922618af18110f71ae5ff' and source->'draft'->>'contentHash'=receipt->>'contentHash' and source->>'currentVersionId'=receipt->>'versionId' from readiness_results where form_key='nsi_determine'),'nsi_determine exact saved candidate and no signing claim');
select ok((select source->>'schemaVersion'='questionnaire-readiness-source.v1' and source->>'formKey'='mna_sf' and source->'formalScore'='null'::jsonb and source->'signable'='false'::jsonb and source->'bundle'->>'bundleHash'='79a90074e6bae96a0504d9666d4cddee7dc02fa9a8c269dcfda018716c4d01ba' and source->'draft'->>'contentHash'=receipt->>'contentHash' and source->>'currentVersionId'=receipt->>'versionId' from readiness_results where form_key='mna_sf'),'mna_sf exact saved candidate and no signing claim');

select is((select source->>'actorUserId' from readiness_results where form_key='spmsq'),'a7100000-0000-4000-8000-000000000001','source actor comes from current Auth');
select is((select source->>'readNonce' from readiness_results where form_key='spmsq'),'a7c00000-0000-4000-8000-000000000001','request read nonce preserved');
select throws_ok($$select pg_temp.readiness_read('spmsq',(select receipt from readiness_results where form_key='spmsq'),null)$$,'22023','invalid readiness read request','null nonce is rejected before data access');
select throws_ok($$select pg_temp.readiness_read('spmsq',(select receipt||jsonb_build_object('contentHash',repeat('0',64)) from readiness_results where form_key='spmsq'))$$,'40001','questionnaire readiness version changed','wrong original hash cannot evaluate saved draft');
select throws_ok($$select pg_temp.readiness_read('spmsq',(select receipt||jsonb_build_object('contentHash',repeat('A',64)) from readiness_results where form_key='spmsq'))$$,'22023','invalid readiness read request','hash normalization is never inferred');
select throws_ok($$select pg_temp.readiness_read('spmsq',(select receipt||jsonb_build_object('versionId','a7f00000-0000-4000-8000-000000000001') from readiness_results where form_key='spmsq'))$$,'42501','questionnaire readiness read is not permitted','unknown version does not disclose existence');
select throws_ok($$select pg_temp.readiness_read('gds_15',(select receipt from readiness_results where form_key='spmsq'))$$,'42501','questionnaire readiness read is not permitted','wrong form remains generic denied');
select throws_ok($$select public.questionnaire_assessment_readiness_source('a7500000-0000-4000-8000-000000000001','a7600000-0000-4000-8000-000000000001','spmsq','a7800000-0000-4000-8000-000000000002',(select (receipt->>'versionId')::uuid from readiness_results where form_key='spmsq'),(select receipt->>'contentHash' from readiness_results where form_key='spmsq'),'a7c00000-0000-4000-8000-000000000001')$$,'42501','questionnaire readiness read is not permitted','unassigned same-branch client denied');
select throws_ok($$select public.questionnaire_assessment_readiness_source('a7500000-0000-4000-8000-000000000002','a7600000-0000-4000-8000-000000000002','spmsq','a7800000-0000-4000-8000-000000000003',(select (receipt->>'versionId')::uuid from readiness_results where form_key='spmsq'),(select receipt->>'contentHash' from readiness_results where form_key='spmsq'),'a7c00000-0000-4000-8000-000000000001')$$,'42501','questionnaire readiness read is not permitted','cross-organization version probing is generic denied');
insert into readiness_results(form_key,receipt) values('spmsq-independent',public.mutate_questionnaire_assessment('a7500000-0000-4000-8000-000000000001','a7600000-0000-4000-8000-000000000001',pg_temp.history_payload(),gen_random_uuid()));
update readiness_results set receipt=public.mutate_questionnaire_assessment('a7500000-0000-4000-8000-000000000001','a7600000-0000-4000-8000-000000000001',pg_temp.history_payload()||jsonb_build_object('action','revise','assessment_key',receipt->>'assessmentKey','previous_version_id',receipt->>'versionId','expected_version',1),gen_random_uuid()) where form_key='spmsq';
select ok((select pg_temp.readiness_read(form_key,source->'draft')->>'currentVersionId'=receipt->>'versionId' and receipt->>'versionId'<>source->>'currentVersionId' from readiness_results where form_key='spmsq'),'original source identifies its own revised chain not a newer independent assessment');
reset role;
select is((select count(*)::integer from public.questionnaire_assessment_versions where client_id='a7800000-0000-4000-8000-000000000001'),11,'source reads add no clinical versions');
select is((select count(*)::integer from private.questionnaire_rule_activations),0,'candidate reads do not adopt scoring-only rule');
-- A future legitimate validation revision must not silently select either
-- candidate under the current API, which has no expected bundle selector.
select throws_ok($$do $probe$
 declare v private.questionnaire_validation_catalog; b private.questionnaire_readiness_catalog;
 vm jsonb; bm jsonb; vc text; bc text; vh text; bh text;
 begin
 select * into v from private.questionnaire_validation_catalog where form_key='spmsq';
 select * into b from private.questionnaire_readiness_catalog where form_key='spmsq';
 vm:=jsonb_set(v.manifest_json,'{validationVersion}',to_jsonb(v.validation_version||'-synthetic-next'));
 vc:=vm::text; vh:=encode(sha256(convert_to(vc,'UTF8')),'hex');
 insert into private.questionnaire_validation_catalog(validation_catalog_hash,scoring_catalog_hash,form_key,form_version,rule_version,validation_version,canonical_json,manifest_json)
 values(vh,v.scoring_catalog_hash,v.form_key,v.form_version,v.rule_version,v.validation_version||'-synthetic-next',vc,vm);
 bm:=jsonb_set(jsonb_set(b.manifest_json,'{validationVersion}',to_jsonb(v.validation_version||'-synthetic-next')),'{validationCatalogHash}',to_jsonb(vh));
 bc:=bm::text; bh:=encode(sha256(convert_to(bc,'UTF8')),'hex');
 insert into private.questionnaire_readiness_catalog(bundle_hash,scoring_catalog_hash,validation_catalog_hash,form_key,form_version,rule_version,validation_version,canonical_json,manifest_json)
 values(bh,b.scoring_catalog_hash,vh,b.form_key,b.form_version,b.rule_version,v.validation_version||'-synthetic-next',bc,bm);
 perform pg_temp.readiness_read('spmsq',(select receipt from readiness_results where form_key='spmsq'));
 end;$probe$;$$,'23514','questionnaire readiness source integrity failed','two matching candidate versions cannot choose an arbitrary bundle');
select ok(not exists(select 1 from public.audit_events where metadata->>'workflow'='questionnaire_readiness_source_v1' and (metadata ?| array['answers','context','contentHash','content_hash','readNonce','read_nonce','client_id','assessment_key','nonce'] or row_pk<>'readiness-source')),'audit contains no payload hashes nonce or case identifiers');
-- Owner inserts a rolled-back synthetic corrupted hash, without disabling any guard.
insert into public.questionnaire_assessment_versions(id,organization_id,branch_id,client_id,form_key,form_version,assessment_key,version,assessed_on,answers,context,record_state,content_hash,author_user_id,author_display_name)
 select 'a7e00000-0000-4000-8000-000000000001',organization_id,branch_id,client_id,form_key,form_version,
 'a7e00000-0000-4000-8000-000000000002',1,assessed_on,answers,context,'draft',repeat('d',64),author_user_id,author_display_name
 from public.questionnaire_assessment_versions where id=(select (receipt->>'versionId')::uuid from readiness_results where form_key='spmsq');
set local role authenticated;
select throws_ok($$select pg_temp.readiness_read('spmsq',jsonb_build_object('versionId','a7e00000-0000-4000-8000-000000000001','contentHash',repeat('d',64)))$$,'40001','questionnaire readiness version changed','stored and expected hash agreement cannot hide corrupted source body');
reset role;
create temporary table readiness_original_grants as select rp.* from public.role_permissions rp join public.roles r on r.id=rp.role_id join public.permissions p on p.id=rp.permission_id where r.role_key='nurse' and p.permission_key like 'questionnaire_%.manage';
update public.role_permissions rp set granted_at=clock_timestamp()+interval '1 hour' from readiness_original_grants original where original.role_id=rp.role_id and original.permission_id=rp.permission_id;
set local role authenticated;
select lives_ok($$select pg_temp.readiness_read('spmsq',(select receipt from readiness_results where form_key='spmsq'))$$,'read-only staff can inspect saved readiness without manage/sign or recent MFA');
select throws_ok($$select public.mutate_questionnaire_assessment('a7500000-0000-4000-8000-000000000001','a7600000-0000-4000-8000-000000000001',pg_temp.history_payload(),gen_random_uuid())$$,'42501',null,'source lookup never invents manage permission');
reset role;
update public.role_permissions rp set granted_at=original.granted_at from readiness_original_grants original where original.role_id=rp.role_id and original.permission_id=rp.permission_id;
update public.role_permissions rp set granted_at=clock_timestamp()+interval '1 hour' from public.roles r,public.permissions p where r.id=rp.role_id and p.id=rp.permission_id and r.role_key='nurse' and p.permission_key='questionnaire_cognition.read';
set local role authenticated;
select throws_ok($$select pg_temp.readiness_read('spmsq',(select receipt from readiness_results where form_key='spmsq'))$$,'42501','questionnaire readiness read is not permitted','future read grant cannot authorize source');
reset role;
update public.role_permissions rp set granted_at=clock_timestamp()-interval '1 day' from public.roles r,public.permissions p where r.id=rp.role_id and p.id=rp.permission_id and r.role_key='nurse' and p.permission_key='questionnaire_cognition.read';
update public.client_assignments set ends_at=clock_timestamp()-interval '1 second' where client_id='a7800000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select pg_temp.readiness_read('spmsq',(select receipt from readiness_results where form_key='spmsq'))$$,'42501','questionnaire readiness read is not permitted','revoked assignment immediately closes saved read');
reset role;
update private.staff_google_access_grants set enabled=false where allowed_user_id='a7100000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select pg_temp.readiness_read('spmsq',(select receipt from readiness_results where form_key='spmsq'))$$,'42501','questionnaire readiness read is not permitted','disabled Google admission cannot recover old source');
reset role;
select * from finish();
rollback;
