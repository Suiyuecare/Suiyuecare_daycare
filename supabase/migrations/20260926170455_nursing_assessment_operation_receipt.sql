begin;

-- This projection observes only the caller's already committed operation. An
-- absent row is NOT evidence that an in-flight write failed. Never acquire a
-- mutation lock, replay a write, consume a challenge, or change its key here.
create function private.nursing_assessment_operation_receipt_core(
  p_organization_id uuid,p_branch_id uuid,p_client_id uuid,p_action text,
  p_idempotency_key uuid,p_nonce uuid
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
  v_actor uuid:=auth.uid(); v_operation private.nursing_assessment_operations%rowtype;
  v_version public.nursing_assessment_versions%rowtype; v_previous public.nursing_assessment_versions%rowtype;
  v_request jsonb; v_keys text[]; v_hash text; v_found boolean:=false; v_receipt jsonb:=null;
  v_result jsonb; v_row_json jsonb; v_created jsonb; v_signed jsonb;
begin
  if p_organization_id is null or p_branch_id is null or p_client_id is null
    or p_idempotency_key is null or p_nonce is null or p_action is null
    or p_action not in ('create_draft','revise_draft','sign','correct') then
    raise exception using errcode='22023',message='invalid nursing receipt lookup';
  end if;
  if private.nursing_authority(p_organization_id,p_branch_id,p_client_id,'nursing_assessments.read') is not true then
    raise exception using errcode='42501',message='nursing receipt lookup is not permitted';
  end if;
  -- The actor+key unique index is sufficient. Exact scope/action mismatch has
  -- the same non-disclosing not_found result as an absent own operation.
  select o.* into v_operation from private.nursing_assessment_operations o
    join public.nursing_assessment_versions v on v.id=o.version_id
    where o.actor_user_id=v_actor and o.idempotency_key=p_idempotency_key
      and v.organization_id=p_organization_id and v.branch_id=p_branch_id and v.client_id=p_client_id
      and o.receipt->'request'->>'action'=p_action;
  v_found:=found;
  if v_found then
    select v.* into strict v_version from public.nursing_assessment_versions v where v.id=v_operation.version_id;
    v_request:=v_operation.receipt->'request';
    v_keys:=case when p_action='create_draft' then array['action','clientId','content']
      when p_action='sign' then array['action','clientId','assessmentKey','previousVersionId','expectedVersion','expectedContentHash']
      when p_action='revise_draft' then array['action','clientId','assessmentKey','previousVersionId','expectedVersion','expectedContentHash','content']
      else array['action','clientId','assessmentKey','previousVersionId','expectedVersion','expectedContentHash','content','correctionReason'] end;
    if jsonb_typeof(v_request) is distinct from 'object' or not v_request ?& v_keys
      or (select count(*) from jsonb_object_keys(v_request))<>cardinality(v_keys)
      or v_request->'clientId' is distinct from to_jsonb(p_client_id)
      or v_request->'action' is distinct from to_jsonb(p_action)
      or v_version.recorded_by<>v_actor
      or v_version.record_state<>(case when p_action='sign' then 'signed' when p_action='correct' then 'corrected' else 'draft' end)
      or (p_action='create_draft' and (v_version.version<>1 or v_version.previous_version_id is not null))
      or (p_action<>'sign' and v_request->'content' is distinct from v_version.content)
      or (p_action='correct' and v_request->'correctionReason' is distinct from to_jsonb(v_version.correction_reason)) then
      raise exception using errcode='23514',message='nursing receipt integrity mismatch';
    end if;
    if p_action<>'create_draft' then
      select v.* into v_previous from public.nursing_assessment_versions v where v.id=v_version.previous_version_id
        and v.organization_id=p_organization_id and v.branch_id=p_branch_id and v.client_id=p_client_id
        and v.assessment_key=v_version.assessment_key and v.version=v_version.version-1;
      if not found or v_request->'assessmentKey' is distinct from to_jsonb(v_version.assessment_key)
        or v_request->'previousVersionId' is distinct from to_jsonb(v_previous.id)
        or v_request->'expectedVersion' is distinct from to_jsonb(v_previous.version)
        or v_request->'expectedContentHash' is distinct from to_jsonb(v_previous.content_hash)
        or v_version.previous_content_hash is distinct from v_previous.content_hash
        or (p_action in ('revise_draft','sign') and v_previous.record_state<>'draft')
        or (p_action='correct' and v_previous.record_state='draft')
        or (p_action='sign' and v_version.content is distinct from v_previous.content) then
        raise exception using errcode='23514',message='nursing receipt integrity mismatch';
      end if;
    end if;
    v_hash:=encode(sha256(convert_to(jsonb_build_object('organizationId',p_organization_id,'branchId',p_branch_id,
      'actorUserId',v_actor,'request',v_request)::text,'UTF8')),'hex');
    -- PostgreSQL JSON timestamp rendering depends on the calling TimeZone.
    -- Keep the original immutable wire spelling only after strict offset/instant
    -- validation against its row. Reconstruct the original hash, never re-hash
    -- today's timezone rendering or rewrite historical receipt/signature bytes.
    v_created:=v_operation.receipt->'result'->'createdAt';
    v_signed:=v_operation.receipt->'result'->'signedAt';
    if jsonb_typeof(v_created) is distinct from 'string'
      or (v_created #>> '{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$'
      or (v_version.signed_at is null and v_signed is distinct from 'null'::jsonb)
      or (v_version.signed_at is not null and (jsonb_typeof(v_signed) is distinct from 'string'
        or (v_signed #>> '{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$')) then
      raise exception using errcode='23514',message='nursing receipt integrity mismatch';
    end if;
    begin
      if (v_created #>> '{}')::timestamptz is distinct from v_version.created_at
        or (v_version.signed_at is not null and (v_signed #>> '{}')::timestamptz is distinct from v_version.signed_at) then
        raise exception using errcode='23514',message='nursing receipt integrity mismatch';
      end if;
    exception when invalid_datetime_format or datetime_field_overflow or invalid_text_representation then
      raise exception using errcode='23514',message='nursing receipt integrity mismatch';
    end;
    v_result:=private.nursing_version_json(v_version)||jsonb_build_object('createdAt',v_created,'signedAt',v_signed);
    v_row_json:=(to_jsonb(v_version)-'content_hash')||jsonb_build_object('created_at',v_created,'signed_at',v_signed);
    v_receipt:=jsonb_build_object('operationId',v_operation.id,'organizationId',p_organization_id,'branchId',p_branch_id,
      'actorUserId',v_actor,'idempotencyKey',p_idempotency_key,'request',v_request,
      'result',v_result,'replayed',false,'persisted',true,'demo',false);
    if v_operation.request_hash is distinct from v_hash or v_operation.receipt is distinct from v_receipt
      or v_version.content_hash is distinct from encode(sha256(convert_to(v_row_json::text,'UTF8')),'hex') then
      raise exception using errcode='23514',message='nursing receipt integrity mismatch';
    end if;
  end if;
  insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,changed_fields,metadata)
    values(p_organization_id,p_branch_id,v_actor,'select','nursing_assessment_operation_receipt','{}'::text[],
      jsonb_build_object('projection','page51_own_operation_receipt_v1','operation_action',p_action,'found',v_found));
  -- A real audit/lock wait can outlive admission, role or assignment. Re-read
  -- the current authority after that wait; failure also rolls back this audit.
  if private.nursing_authority(p_organization_id,p_branch_id,p_client_id,'nursing_assessments.read') is not true then
    raise exception using errcode='42501',message='nursing receipt lookup authority expired';
  end if;
  return jsonb_build_object('schemaVersion',1,'status',case when v_found then 'committed' else 'not_found' end,
    'organizationId',p_organization_id,'branchId',p_branch_id,'actorUserId',v_actor,'clientId',p_client_id,
    'action',p_action,'idempotencyKey',p_idempotency_key,'nonce',p_nonce,'verifiedAt',clock_timestamp(),
    'persisted',v_found,'demo',false,'receipt',v_receipt);
end;
$$;
create function public.nursing_assessment_operation_receipt(
  p_organization_id uuid,p_branch_id uuid,p_client_id uuid,p_action text,p_idempotency_key uuid,p_nonce uuid
) returns jsonb language sql volatile security invoker set search_path='' as $$
  select private.nursing_assessment_operation_receipt_core(p_organization_id,p_branch_id,p_client_id,p_action,p_idempotency_key,p_nonce);
$$;
alter function private.nursing_assessment_operation_receipt_core(uuid,uuid,uuid,text,uuid,uuid) owner to postgres;
alter function public.nursing_assessment_operation_receipt(uuid,uuid,uuid,text,uuid,uuid) owner to postgres;
revoke all on function private.nursing_assessment_operation_receipt_core(uuid,uuid,uuid,text,uuid,uuid),
  public.nursing_assessment_operation_receipt(uuid,uuid,uuid,text,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.nursing_assessment_operation_receipt_core(uuid,uuid,uuid,text,uuid,uuid),
  public.nursing_assessment_operation_receipt(uuid,uuid,uuid,text,uuid,uuid) to authenticated;
commit;
