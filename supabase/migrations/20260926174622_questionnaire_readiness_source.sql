-- Read-only candidate evaluation inputs from an exact existing immutable draft.
-- Nothing here adopts a rule, records a clinical score or enables signing.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

create function private.questionnaire_assessment_readiness_source_guarded(
 p_org uuid,p_branch uuid,p_form_key text,p_client uuid,p_version uuid,p_expected_content_hash text,p_read_nonce uuid
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
 v public.questionnaire_assessment_versions;
 v_after public.questionnaire_assessment_versions;
 terminal uuid; terminal_after uuid; terminal_count integer; terminal_version integer; generated timestamptz;
 bundle private.questionnaire_readiness_catalog;
 validation private.questionnaire_validation_catalog;
 scoring private.questionnaire_rule_catalog;
 content_hash text; v_actor uuid:=auth.uid();
begin
 if p_org is null or p_branch is null or p_client is null or p_version is null or p_read_nonce is null
  or p_expected_content_hash is null or p_expected_content_hash !~ '^[a-f0-9]{64}$' then
  raise exception using errcode='22023',message='invalid readiness read request';
 end if;
 if private.questionnaire_assessment_authority(p_org,p_branch,p_client,p_form_key,'read') is not true then
  raise exception using errcode='42501',message='questionnaire readiness read is not permitted';
 end if;
 select * into v from public.questionnaire_assessment_versions row
  where row.id=p_version and row.organization_id=p_org and row.branch_id=p_branch and row.client_id=p_client and row.form_key=p_form_key;
 if not found then raise exception using errcode='42501',message='questionnaire readiness read is not permitted';end if;
 content_hash:=encode(sha256(convert_to(jsonb_build_object('form_key',v.form_key,'form_version',v.form_version,
  'assessed_on',v.assessed_on,'answers',v.answers,'context',v.context)::text,'UTF8')),'hex');
 if v.content_hash is distinct from p_expected_content_hash or v.content_hash is distinct from content_hash then
  raise exception using errcode='40001',message='questionnaire readiness version changed';
 end if;
 if v.record_state is distinct from 'draft' or private.questionnaire_answers_valid(v.form_key,v.answers) is not true
  or private.questionnaire_context_valid(v.form_key,v.answers,v.context) is not true or v.version>1000000
  or v.assessed_on not between date '2000-01-01' and (clock_timestamp() at time zone 'Asia/Taipei')::date
  or v.created_at>clock_timestamp() then
  raise exception using errcode='23514',message='questionnaire readiness source integrity failed';
 end if;
 if (select count(*) from private.questionnaire_readiness_catalog b where b.form_key=v.form_key and b.form_version=v.form_version)<>1 then
  raise exception using errcode='23514',message='questionnaire readiness source integrity failed';end if;
 select * into bundle from private.questionnaire_readiness_catalog b
  where b.form_key=v.form_key and b.form_version=v.form_version;
 if not found then raise exception using errcode='23514',message='questionnaire readiness source integrity failed';end if;
 select * into validation from private.questionnaire_validation_catalog c where c.validation_catalog_hash=bundle.validation_catalog_hash;
 select * into scoring from private.questionnaire_rule_catalog c where c.catalog_hash=bundle.scoring_catalog_hash;
 if bundle.manifest_json->'candidateOnly' is distinct from 'true'::jsonb
  or bundle.bundle_hash is distinct from encode(sha256(convert_to(bundle.canonical_json,'UTF8')),'hex')
  or bundle.canonical_json::jsonb is distinct from bundle.manifest_json
  or validation.validation_catalog_hash is distinct from bundle.validation_catalog_hash
  or validation.scoring_catalog_hash is distinct from scoring.catalog_hash
  or validation.validation_catalog_hash is distinct from encode(sha256(convert_to(validation.canonical_json,'UTF8')),'hex')
  or validation.canonical_json::jsonb is distinct from validation.manifest_json
  or scoring.catalog_hash is distinct from encode(sha256(convert_to(scoring.canonical_json,'UTF8')),'hex')
  or scoring.canonical_json::jsonb is distinct from scoring.manifest_json
  or bundle.form_key is distinct from scoring.form_key or bundle.form_key is distinct from validation.form_key
  or bundle.form_version is distinct from scoring.form_version or bundle.form_version is distinct from validation.form_version
  or bundle.rule_version is distinct from scoring.rule_version or bundle.rule_version is distinct from validation.rule_version
  or bundle.validation_version is distinct from validation.validation_version then
  raise exception using errcode='23514',message='questionnaire readiness source integrity failed';
 end if;
 select count(*)::integer,max(t.version) into terminal_count,terminal_version from public.questionnaire_assessment_versions t
  where t.organization_id=p_org and t.branch_id=p_branch and t.client_id=p_client and t.form_key=p_form_key
   and t.assessment_key=v.assessment_key
   and not exists(select 1 from public.questionnaire_assessment_versions child where child.previous_version_id=t.id);
 if terminal_count<>1 or terminal_version<v.version then
  raise exception using errcode='23514',message='questionnaire readiness source integrity failed';end if;
 select t.id into terminal from public.questionnaire_assessment_versions t
  where t.organization_id=p_org and t.branch_id=p_branch and t.client_id=p_client and t.form_key=p_form_key
   and t.assessment_key=v.assessment_key
   and not exists(select 1 from public.questionnaire_assessment_versions child where child.previous_version_id=t.id)
  order by t.version desc limit 1;
 if terminal is null then raise exception using errcode='23514',message='questionnaire readiness source integrity failed';end if;
 insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata)
 values(p_org,p_branch,v_actor,'select','questionnaire_assessment_versions','readiness-source',array[]::text[],
  jsonb_build_object('workflow','questionnaire_readiness_source_v1','form_key',p_form_key,'payload_excluded',true));
 -- Audit may block; current authority and the exact source/chain must survive.
 if auth.uid() is distinct from v_actor or private.questionnaire_assessment_authority(p_org,p_branch,p_client,p_form_key,'read') is not true then
  raise exception using errcode='42501',message='questionnaire readiness read is not permitted';
 end if;
 select * into v_after from public.questionnaire_assessment_versions row where row.id=v.id;
 select count(*)::integer,max(t.version) into terminal_count,terminal_version from public.questionnaire_assessment_versions t
  where t.organization_id=p_org and t.branch_id=p_branch and t.client_id=p_client and t.form_key=p_form_key
   and t.assessment_key=v.assessment_key
   and not exists(select 1 from public.questionnaire_assessment_versions child where child.previous_version_id=t.id);
 if terminal_count<>1 or terminal_version<v.version then
  raise exception using errcode='40001',message='questionnaire readiness version changed';end if;
 select t.id into terminal_after from public.questionnaire_assessment_versions t
  where t.organization_id=p_org and t.branch_id=p_branch and t.client_id=p_client and t.form_key=p_form_key
   and t.assessment_key=v.assessment_key
   and not exists(select 1 from public.questionnaire_assessment_versions child where child.previous_version_id=t.id)
  order by t.version desc limit 1;
 if v_after is distinct from v or terminal_after is distinct from terminal
  or not exists(select 1 from private.questionnaire_readiness_catalog b where b.bundle_hash=bundle.bundle_hash and b= bundle)
  or not exists(select 1 from private.questionnaire_validation_catalog c where c.validation_catalog_hash=validation.validation_catalog_hash and c= validation)
  or not exists(select 1 from private.questionnaire_rule_catalog c where c.catalog_hash=scoring.catalog_hash and c= scoring) then
  raise exception using errcode='40001',message='questionnaire readiness version changed';
 end if;
 generated:=clock_timestamp();
 return jsonb_build_object('schemaVersion','questionnaire-readiness-source.v1','organizationId',p_org,'branchId',p_branch,
  'actorUserId',v_actor,'formKey',p_form_key,'clientId',p_client,'readNonce',p_read_nonce,'generatedAt',generated,
  'draft',private.questionnaire_assessment_json(v),'currentVersionId',terminal,
  'bundle',jsonb_build_object('bundleHash',bundle.bundle_hash,'canonicalJson',bundle.canonical_json,
   'scoringCanonicalJson',scoring.canonical_json,'scoringCatalogHash',scoring.catalog_hash,
   'validationCanonicalJson',validation.canonical_json,'validationCatalogHash',validation.validation_catalog_hash),
  'formalScore',null,'signable',false);
end;$$;
revoke all on function private.questionnaire_assessment_readiness_source_guarded(uuid,uuid,text,uuid,uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function private.questionnaire_assessment_readiness_source_guarded(uuid,uuid,text,uuid,uuid,text,uuid) to authenticated;

create function public.questionnaire_assessment_readiness_source(
 p_expected_organization_id uuid,p_expected_branch_id uuid,p_form_key text,p_client_id uuid,p_version_id uuid,p_expected_content_hash text,p_read_nonce uuid
) returns jsonb language sql volatile security invoker set search_path='' as $$
 select private.questionnaire_assessment_readiness_source_guarded(p_expected_organization_id,p_expected_branch_id,p_form_key,p_client_id,p_version_id,p_expected_content_hash,p_read_nonce);
$$;
revoke all on function public.questionnaire_assessment_readiness_source(uuid,uuid,text,uuid,uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.questionnaire_assessment_readiness_source(uuid,uuid,text,uuid,uuid,text,uuid) to authenticated;
commit;
