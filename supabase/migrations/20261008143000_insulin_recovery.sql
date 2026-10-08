-- A read-only, exact receipt path for an operation whose HTTP result was lost.
-- A missing row is unresolved: the caller must never infer that a write failed.
create function private.insulin_administration_receipt_guarded(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_action text,
  p_administration_key uuid,
  p_previous_event_id uuid,
  p_expected_sequence integer,
  p_medication_plan_id uuid,
  p_scheduled_for timestamptz,
  p_dose_text text,
  p_dose_unit text,
  p_site_code text,
  p_site_text text,
  p_late_reason text,
  p_idempotency_key uuid
)
returns table(
  organization_id uuid, branch_id uuid, operation_id uuid, operation_kind text,
  administration_key uuid, event_id uuid, event_sequence integer,
  previous_event_id uuid, state text, medication_plan_id uuid,
  governance_version_id uuid, scheduled_for timestamptz,
  executed_at timestamptz, reviewed_at timestamptz, content_hash text,
  qualification_status text, dose_rule_status text, late_entry_rule_status text,
  completion_status text, offline_status text, replayed boolean, committed_at timestamptz
)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_permission text;
  v_request_hash text;
  v_operation private.insulin_administration_operations%rowtype;
  v_late_reason text := nullif(btrim(p_late_reason), '');
  v_dose_text text := nullif(btrim(p_dose_text), '');
  v_dose_unit text := nullif(btrim(p_dose_unit), '');
  v_site_code text := upper(nullif(btrim(p_site_code), ''));
  v_site_text text := nullif(btrim(p_site_text), '');
begin
  if v_actor is null or p_expected_organization_id is null or p_expected_branch_id is null
     or p_idempotency_key is null or p_action is null
     or p_action not in ('authorize_late', 'execute', 'review') then
    raise exception using errcode = '22023', message = 'insulin receipt request is invalid';
  end if;

  v_permission := case p_action
    when 'authorize_late' then 'insulin_administrations.authorize_late'
    when 'execute' then 'insulin_administrations.execute'
    else 'insulin_administrations.verify' end;
  if not private.insulin_base_authority(
       p_expected_organization_id, p_expected_branch_id, v_permission
     ) then
    raise exception using errcode = '42501', message = 'insulin receipt authority is not permitted';
  end if;
  -- Receipt disclosure keeps the existing recent, same-session AAL2 gate.
  perform private.require_insulin_reauth(v_actor, clock_timestamp());

  -- Match the mutation's canonical normalization and JSONB hash byte for byte.
  -- The client never supplies or vouches for this hash.
  v_request_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version', 1, 'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id, 'action', p_action,
    'administration_key', p_administration_key, 'previous_event_id', p_previous_event_id,
    'expected_sequence', p_expected_sequence, 'medication_plan_id', p_medication_plan_id,
    'scheduled_for', p_scheduled_for, 'dose_text', v_dose_text,
    'dose_unit', v_dose_unit, 'site_code', v_site_code, 'site_text', v_site_text,
    'late_reason', v_late_reason
  )::text, 'UTF8')), 'hex');

  -- Serialize with the original write. An absent row after this lock still
  -- does not prove that a request delayed before acquiring the lock will fail.
  perform pg_advisory_xact_lock(hashtextextended(
    'insulin-operation:' || v_actor::text || ':' || p_idempotency_key::text, 5
  ));
  select operation.* into v_operation
  from private.insulin_administration_operations operation
  where operation.actor_user_id = v_actor
    and operation.idempotency_key = p_idempotency_key;
  if not found then return; end if;
  if v_operation.organization_id <> p_expected_organization_id
     or v_operation.branch_id <> p_expected_branch_id then
    raise exception using errcode = '42501', message = 'insulin receipt is outside current scope';
  end if;
  if v_operation.operation_kind <> p_action or v_operation.request_hash <> v_request_hash then
    raise exception using errcode = '23505', message = 'insulin idempotency conflict';
  end if;
  if not private.can_staff_access_client(v_operation.client_id, v_permission) then
    raise exception using errcode = '42501', message = 'insulin client scope is not permitted';
  end if;

  return query select v_operation.organization_id, v_operation.branch_id,
    v_operation.id, v_operation.operation_kind, v_operation.administration_key,
    v_operation.event_id, v_operation.event_sequence, v_operation.previous_event_id,
    v_operation.state, v_operation.medication_plan_id, v_operation.governance_version_id,
    v_operation.scheduled_for, v_operation.executed_at, v_operation.reviewed_at,
    v_operation.content_hash, 'published'::text, 'published'::text, 'published'::text,
    case when v_operation.state = 'completed' then 'completed'
      else 'pending_independent_review' end::text,
    'not_configured'::text, true, v_operation.created_at;
end;
$$;

create function public.insulin_administration_receipt(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_action text,
  p_administration_key uuid,
  p_previous_event_id uuid,
  p_expected_sequence integer,
  p_medication_plan_id uuid,
  p_scheduled_for timestamptz,
  p_dose_text text,
  p_dose_unit text,
  p_site_code text,
  p_site_text text,
  p_late_reason text,
  p_idempotency_key uuid
)
returns table(
  organization_id uuid, branch_id uuid, operation_id uuid, operation_kind text,
  administration_key uuid, event_id uuid, event_sequence integer,
  previous_event_id uuid, state text, medication_plan_id uuid,
  governance_version_id uuid, scheduled_for timestamptz,
  executed_at timestamptz, reviewed_at timestamptz, content_hash text,
  qualification_status text, dose_rule_status text, late_entry_rule_status text,
  completion_status text, offline_status text, replayed boolean, committed_at timestamptz
)
language sql volatile security invoker set search_path = '' as $$
  select * from private.insulin_administration_receipt_guarded(
    p_expected_organization_id, p_expected_branch_id, p_action,
    p_administration_key, p_previous_event_id, p_expected_sequence,
    p_medication_plan_id, p_scheduled_for, p_dose_text, p_dose_unit,
    p_site_code, p_site_text, p_late_reason, p_idempotency_key
  );
$$;

revoke all on function private.insulin_administration_receipt_guarded(
  uuid, uuid, text, uuid, uuid, integer, uuid, timestamptz,
  text, text, text, text, text, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.insulin_administration_receipt(
  uuid, uuid, text, uuid, uuid, integer, uuid, timestamptz,
  text, text, text, text, text, uuid
) from public, anon, service_role;
grant execute on function private.insulin_administration_receipt_guarded(
  uuid, uuid, text, uuid, uuid, integer, uuid, timestamptz,
  text, text, text, text, text, uuid
) to authenticated;
grant execute on function public.insulin_administration_receipt(
  uuid, uuid, text, uuid, uuid, integer, uuid, timestamptz,
  text, text, text, text, text, uuid
) to authenticated;

comment on function public.insulin_administration_receipt(
  uuid, uuid, text, uuid, uuid, integer, uuid, timestamptz,
  text, text, text, text, text, uuid
) is 'Read-only exact receipt recovery with current action/client authority and recent same-session AAL2. Missing is unresolved; new writes still require current governance and qualification.';
