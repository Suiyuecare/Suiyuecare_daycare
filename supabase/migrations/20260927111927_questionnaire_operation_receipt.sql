begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

-- Observe only a caller's already committed original draft operation. No
-- mutation/advisory lock, replay, reauthentication or clinical policy changes.
-- A missing row is not proof that an in-flight operation failed.
create function private.questionnaire_assessment_operation_receipt_guarded(
 p_org uuid,p_branch uuid,p_form_key text,p_client uuid,p_action text,p_key uuid,p_nonce uuid
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
 actor uuid:=auth.uid(); op private.questionnaire_assessment_operations;
 op_after private.questionnaire_assessment_operations;
 v public.questionnaire_assessment_versions; v_after public.questionnaire_assessment_versions;
 prior public.questionnaire_assessment_versions; prior_after public.questionnaire_assessment_versions;
 original_action text; original_stamp jsonb; request_json jsonb; receipt_json jsonb; draft_json jsonb;
 computed_hash text; expected_form_version text; matched boolean:=false; original_found boolean:=false;
begin
 if p_org is null or p_branch is null or p_client is null or p_key is null or p_nonce is null
  or p_action is null or p_action not in ('create','revise') or p_form_key is null
  or p_form_key not in ('spmsq','gds_15','barthel_adl','lawton_iadl','eat10_swallowing','bsrs5','fall_risk_taipei_115','nsi_determine','mna_sf') then
  raise exception using errcode='22023',message='invalid questionnaire receipt lookup';
 end if;
 if private.questionnaire_assessment_authority(p_org,p_branch,p_client,p_form_key,'read') is not true then
  raise exception using errcode='42501',message='questionnaire receipt lookup is not permitted';
 end if;
 -- Actor comes only from current Auth, never caller input. Scope mismatch and
 -- another actor's key use the same non-disclosing absent-result projection.
 select o.* into op from private.questionnaire_assessment_operations o
  where o.actor_user_id=actor and o.idempotency_key=p_key
   and o.organization_id=p_org and o.branch_id=p_branch and o.client_id=p_client and o.result_form_key=p_form_key;
 original_found:=found;
 if original_found then
  select r.* into v from public.questionnaire_assessment_versions r where r.id=op.result_version_id;
  if not found or v.organization_id is distinct from p_org or v.branch_id is distinct from p_branch
   or v.client_id is distinct from p_client or v.form_key is distinct from p_form_key
   or v.assessment_key is distinct from op.result_assessment_key or v.author_user_id is distinct from actor
   or v.record_state is distinct from 'draft' or v.version not between 1 and 1000000
   or v.created_at>clock_timestamp() or v.assessed_on not between date '2000-01-01' and (clock_timestamp() at time zone 'Asia/Taipei')::date
   or v.author_display_name is null or char_length(v.author_display_name) not between 1 and 160
   or v.author_display_name<>btrim(v.author_display_name) or v.author_display_name~'[[:cntrl:]]'
   or private.questionnaire_answers_valid(v.form_key,v.answers) is not true
   or private.questionnaire_context_valid(v.form_key,v.answers,v.context) is not true then
   raise exception using errcode='23514',message='questionnaire receipt integrity mismatch';
  end if;
  expected_form_version:=case p_form_key
   when 'spmsq' then 'spmsq-pfeiffer-10-education-adjusted-v1' when 'gds_15' then 'gds-15-strict-complete-v1'
   when 'barthel_adl' then 'barthel-adl-0-100-v1' when 'lawton_iadl' then 'lawton-iadl-8-domain-expanded-v1'
   when 'eat10_swallowing' then 'eat10-tw-v1' when 'bsrs5' then 'bsrs5-zh-tw-v1'
   when 'fall_risk_taipei_115' then 'fall-risk-taipei-community-115-b12-v1'
   when 'nsi_determine' then 'nsi-determine-10-weighted-v1' when 'mna_sf' then 'mna-sf-revised-2009-traditional-chinese-v1' end;
  if v.form_version is distinct from expected_form_version then
   raise exception using errcode='23514',message='questionnaire receipt integrity mismatch';end if;
  original_action:=case when v.version=1 then 'create' else 'revise' end;
  if (v.version=1 and v.previous_version_id is not null) or (v.version>1 and v.previous_version_id is null) then
   raise exception using errcode='23514',message='questionnaire receipt integrity mismatch';end if;
  if original_action='revise' then
   select r.* into prior from public.questionnaire_assessment_versions r where r.id=v.previous_version_id;
   if not found or prior.organization_id is distinct from p_org or prior.branch_id is distinct from p_branch
    or prior.client_id is distinct from p_client or prior.form_key is distinct from p_form_key
    or prior.form_version is distinct from v.form_version or prior.assessment_key is distinct from v.assessment_key
    or prior.version is distinct from v.version-1 or prior.record_state is distinct from 'draft'
    or prior.created_at>v.created_at or private.questionnaire_answers_valid(prior.form_key,prior.answers) is not true
    or private.questionnaire_context_valid(prior.form_key,prior.answers,prior.context) is not true
    or prior.content_hash is distinct from encode(sha256(convert_to(jsonb_build_object('form_key',prior.form_key,
     'form_version',prior.form_version,'assessed_on',prior.assessed_on,'answers',prior.answers,'context',prior.context)::text,'UTF8')),'hex') then
    raise exception using errcode='23514',message='questionnaire receipt integrity mismatch';
   end if;
  end if;
  computed_hash:=encode(sha256(convert_to(jsonb_build_object('form_key',v.form_key,'form_version',v.form_version,
   'assessed_on',v.assessed_on,'answers',v.answers,'context',v.context)::text,'UTF8')),'hex');
  request_json:=jsonb_build_object('action',original_action,'client_id',p_client,'form_key',v.form_key,'form_version',v.form_version,
   'assessment_key',case when original_action='create' then null else v.assessment_key end,
   'previous_version_id',case when original_action='create' then null else v.previous_version_id end,
   'expected_version',v.version-1,'assessed_on',v.assessed_on,'answers',v.answers,'context',v.context);
  -- Preserve the historic offset spelling only after proving the same row
  -- instant. Today's session TimeZone must not rewrite original receipt bytes.
  original_stamp:=op.receipt->'committedAt';
  if jsonb_typeof(original_stamp) is distinct from 'string'
   or (original_stamp #>> '{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$' then
   raise exception using errcode='23514',message='questionnaire receipt integrity mismatch';end if;
  begin
   if (original_stamp #>> '{}')::timestamptz is distinct from v.created_at then
    raise exception using errcode='23514',message='questionnaire receipt integrity mismatch';end if;
  exception when invalid_datetime_format or datetime_field_overflow or invalid_text_representation then
   raise exception using errcode='23514',message='questionnaire receipt integrity mismatch';end;
  receipt_json:=jsonb_build_object('action',original_action,'clientId',p_client,'formKey',v.form_key,
   'assessmentKey',v.assessment_key,'versionId',v.id,'version',v.version,'recordState','draft',
   'assessedOn',v.assessed_on,'contentHash',computed_hash,'committedAt',original_stamp,'replayed',false);
  if op.receipt is distinct from receipt_json or v.content_hash is distinct from computed_hash
   or op.request_hash is distinct from encode(sha256(convert_to(request_json::text,'UTF8')),'hex') then
   raise exception using errcode='23514',message='questionnaire receipt integrity mismatch';end if;
  matched:=original_action=p_action;
  if matched then draft_json:=private.questionnaire_assessment_json(v)||jsonb_build_object('createdAt',original_stamp);end if;
 end if;
 insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata)
  values(p_org,p_branch,actor,'select','questionnaire_assessment_operation_receipt','own-operation',array[]::text[],
   jsonb_build_object('workflow','questionnaire_own_operation_receipt_v1','form_key',p_form_key,'operation_action',p_action,'found',matched,'payload_excluded',true));
 if auth.uid() is distinct from actor or private.questionnaire_assessment_authority(p_org,p_branch,p_client,p_form_key,'read') is not true then
  raise exception using errcode='42501',message='questionnaire receipt lookup is not permitted';end if;
 if original_found then
  select o.* into op_after from private.questionnaire_assessment_operations o where o.id=op.id;
  select r.* into v_after from public.questionnaire_assessment_versions r where r.id=v.id;
  if op_after is distinct from op or v_after is distinct from v then
   raise exception using errcode='23514',message='questionnaire receipt integrity mismatch';end if;
  if original_action='revise' then
   select r.* into prior_after from public.questionnaire_assessment_versions r where r.id=prior.id;
   if prior_after is distinct from prior then raise exception using errcode='23514',message='questionnaire receipt integrity mismatch';end if;
  end if;
 end if;
 return jsonb_build_object('schemaVersion',1,'status',case when matched then 'committed' else 'not_found' end,
  'organizationId',p_org,'branchId',p_branch,'actorUserId',actor,'formKey',p_form_key,'clientId',p_client,
  'action',p_action,'idempotencyKey',p_key,'nonce',p_nonce,'verifiedAt',clock_timestamp(),'persisted',matched,'demo',false,
  'receipt',case when matched then receipt_json else null end,'request',case when matched then request_json else null end,
  'draft',case when matched then draft_json else null end);
end;$$;

create function public.questionnaire_assessment_operation_receipt(
 p_expected_organization_id uuid,p_expected_branch_id uuid,p_form_key text,p_client_id uuid,p_action text,p_idempotency_key uuid,p_nonce uuid
) returns jsonb language sql volatile security invoker set search_path='' as $$
 select private.questionnaire_assessment_operation_receipt_guarded(p_expected_organization_id,p_expected_branch_id,p_form_key,p_client_id,p_action,p_idempotency_key,p_nonce);
$$;
alter function private.questionnaire_assessment_operation_receipt_guarded(uuid,uuid,text,uuid,text,uuid,uuid) owner to postgres;
alter function public.questionnaire_assessment_operation_receipt(uuid,uuid,text,uuid,text,uuid,uuid) owner to postgres;
revoke all on function private.questionnaire_assessment_operation_receipt_guarded(uuid,uuid,text,uuid,text,uuid,uuid),
 public.questionnaire_assessment_operation_receipt(uuid,uuid,text,uuid,text,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.questionnaire_assessment_operation_receipt_guarded(uuid,uuid,text,uuid,text,uuid,uuid),
 public.questionnaire_assessment_operation_receipt(uuid,uuid,text,uuid,text,uuid,uuid) to authenticated;
commit;
