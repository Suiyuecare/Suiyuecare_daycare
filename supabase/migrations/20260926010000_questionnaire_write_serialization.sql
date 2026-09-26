-- Serialize real concurrent questionnaire writes before the immutable core
-- checks a receipt or baseline. Keep the original validation and admission
-- checks, and recheck authority after every potentially blocking lock/write.
alter function private.mutate_questionnaire_assessment_guarded(uuid,uuid,jsonb,uuid)
  rename to mutate_questionnaire_assessment_core_v1;
revoke all on function private.mutate_questionnaire_assessment_core_v1(uuid,uuid,jsonb,uuid)
  from public,anon,authenticated,service_role;

create function private.mutate_questionnaire_assessment_guarded(
  p_expected_organization_id uuid, p_expected_branch_id uuid,
  p_payload jsonb, p_idempotency_key uuid
) returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_client uuid;
  v_assessment_key uuid;
  v_receipt jsonb;
begin
  if v_actor is null or p_idempotency_key is null
    or jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception using errcode='22023',message='invalid questionnaire assessment payload';
  end if;
  begin
    v_client := (p_payload->>'client_id')::uuid;
    v_assessment_key := nullif(p_payload->>'assessment_key','')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode='22023',message='invalid questionnaire identifiers';
  end;
  if v_client is null or not private.questionnaire_assessment_authority(
    p_expected_organization_id,p_expected_branch_id,v_client,p_payload->>'form_key','manage'
  ) then
    raise exception using errcode='42501',message='questionnaire client is not assigned or authorized';
  end if;
  -- Match the operation table's UNIQUE(actor_user_id,idempotency_key), including
  -- the first request where SELECT FOR UPDATE would have no row to lock.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'questionnaire-operation:'||v_actor::text||':'||p_idempotency_key::text,0
  ));
  if not private.questionnaire_assessment_authority(
    p_expected_organization_id,p_expected_branch_id,v_client,p_payload->>'form_key','manage'
  ) then
    raise exception using errcode='42501',message='questionnaire authority changed while waiting';
  end if;
  if p_payload->>'action'='revise' and v_assessment_key is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'questionnaire-assessment:'||v_assessment_key::text,0
    ));
    if not private.questionnaire_assessment_authority(
      p_expected_organization_id,p_expected_branch_id,v_client,p_payload->>'form_key','manage'
    ) then
      raise exception using errcode='42501',message='questionnaire authority changed while waiting';
    end if;
  end if;
  v_receipt := private.mutate_questionnaire_assessment_core_v1(
    p_expected_organization_id,p_expected_branch_id,p_payload,p_idempotency_key
  );
  -- The core can still wait on FK/row locks. Raising here rolls back all answer,
  -- receipt and audit inserts; revoked actors never receive a success receipt.
  if not private.questionnaire_assessment_authority(
    p_expected_organization_id,p_expected_branch_id,v_client,p_payload->>'form_key','manage'
  ) then
    raise exception using errcode='42501',message='questionnaire authority changed before commit';
  end if;
  return v_receipt;
end;
$$;
revoke all on function private.mutate_questionnaire_assessment_guarded(uuid,uuid,jsonb,uuid)
  from public,anon,authenticated,service_role;
grant execute on function private.mutate_questionnaire_assessment_guarded(uuid,uuid,jsonb,uuid)
  to authenticated;

-- Explicitly bind the public invoker to the new serialized guard, rather than
-- relying on name/OID rebinding after the old guard was renamed.
create or replace function public.mutate_questionnaire_assessment(
  p_expected_organization_id uuid,p_expected_branch_id uuid,p_payload jsonb,p_idempotency_key uuid
) returns jsonb language sql volatile security invoker set search_path = '' as $$
  select private.mutate_questionnaire_assessment_guarded(
    p_expected_organization_id,p_expected_branch_id,p_payload,p_idempotency_key
  );
$$;
