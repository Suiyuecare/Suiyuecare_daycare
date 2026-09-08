-- Page 7 must consume the governed page-8 lifecycle rather than the legacy
-- mutable status/effective_to fields alone.  The selected slot plan is valid
-- only when it is the single signed version covering the actual occurrence.

create or replace function private.medication_plan_is_unique_at_occurrence(
  p_organization_id uuid,
  p_branch_id uuid,
  p_client_id uuid,
  p_record_key uuid,
  p_selected_plan_id uuid,
  p_occurred_at timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    count(*) = 1
    and bool_and(candidate.id = p_selected_plan_id),
    false
  )
  from public.medication_plans candidate
  left join private.medication_plan_terminations termination
    on termination.medication_plan_id = candidate.id
  where p_organization_id is not null
    and p_branch_id is not null
    and p_client_id is not null
    and p_record_key is not null
    and p_selected_plan_id is not null
    and p_occurred_at is not null
    and candidate.organization_id = p_organization_id
    and candidate.branch_id = p_branch_id
    and candidate.client_id = p_client_id
    and candidate.record_key = p_record_key
    and candidate.status = 'active'
    and candidate.signed_at is not null
    and candidate.signed_by is not null
    and candidate.content_hash ~ '^[a-f0-9]{64}$'
    and (
      candidate.workflow_version is null
      or (
        candidate.workflow_version = 2
        and candidate.workflow_state = 'approved'
      )
    )
    and candidate.effective_from <= p_occurred_at
    and (
      candidate.effective_to is null
      or candidate.effective_to > p_occurred_at
    )
    and (
      termination.effective_at is null
      or termination.effective_at > p_occurred_at
    );
$$;

comment on function private.medication_plan_is_unique_at_occurrence(
  uuid, uuid, uuid, uuid, uuid, timestamptz
) is
  'Fail-closed page-7 plan selection: exactly one signed version in a record stream must cover occurred_at after immutable stop/replacement cutovers.';

-- Exact replay may bypass mutable slot/lifecycle windows, but never current
-- authority or the 15-minute step-up requirement.  The original receipt
-- evidence and a fresh challenge in the current session are both required.
create or replace function private.require_medication_replay_evidence(
  p_actor_user_id uuid,
  p_receipt_challenge_id uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_current_challenge_id uuid;
begin
  if p_actor_user_id is null
     or p_receipt_challenge_id is null
     or p_actor_user_id <> auth.uid()
     or not exists (
       select 1
       from private.reauth_challenges receipt
       where receipt.id = p_receipt_challenge_id
         and receipt.user_id = p_actor_user_id
         and receipt.consumed_at is not null
         and receipt.invalidated_at is null
         and receipt.factor_method in ('totp', 'webauthn', 'phone')
         and receipt.factor_verified_at is not null
     ) then
    raise exception using
      errcode = '42501',
      message = 'current AAL2 and immutable evidence are required to replay medication signing';
  end if;

  begin
    v_current_challenge_id := private.require_medication_reauth_evidence(
      p_actor_user_id,
      clock_timestamp()
    );
  exception when sqlstate '42501' then
    raise exception using
      errcode = '42501',
      message = 'current AAL2 and immutable evidence are required to replay medication signing';
  end;

  return v_current_challenge_id is not null;
end;
$$;

revoke all on function private.medication_plan_is_unique_at_occurrence(
  uuid, uuid, uuid, uuid, uuid, timestamptz
) from public, anon, authenticated, service_role;
revoke all on function private.require_medication_replay_evidence(uuid, uuid)
  from public, anon, authenticated, service_role;

-- Re-declare both atomic cores so already-migrated environments consume the
-- cutover helper and the page-8 record-stream advisory key.  Editing only the
-- historical page-7 migration would leave deployed databases on the old rule.
create or replace function private.record_medication_administration_atomic(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_medication_administration_id uuid,
  p_status public.medication_administration_status,
  p_occurred_at timestamptz,
  p_actual_dose numeric,
  p_dose_unit text,
  p_reason text,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid,
  medication_administration_id uuid,
  client_id uuid,
  medication_plan_id uuid,
  status public.medication_administration_status,
  administered_at timestamptz,
  requires_second_verification boolean,
  finalization_state text,
  signed_at timestamptz,
  signed_by uuid,
  execution_reauth_challenge_id uuid,
  verification_reauth_challenge_id uuid,
  content_hash text,
  replayed boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz;
  v_reason text := nullif(btrim(p_reason), '');
  v_dose_unit text := nullif(btrim(p_dose_unit), '');
  v_request_hash text;
  v_execution_hash text;
  v_execution_challenge_id uuid;
  v_client_id uuid;
  v_client public.clients%rowtype;
  v_slot public.medication_administrations%rowtype;
  v_plan public.medication_plans%rowtype;
  v_plan_record_key uuid;
  v_requires_second boolean;
  v_late_entry boolean;
  v_source text;
  v_operation private.medication_administration_operations%rowtype;
begin
  if v_actor is null
     or p_expected_organization_id is null
     or p_expected_branch_id is null
     or p_medication_administration_id is null
     or p_status is null
     or p_occurred_at is null
     or p_idempotency_key is null then
    raise exception using
      errcode = '22023',
      message = 'tenant context, scheduled slot, outcome, occurrence time, and idempotency key are required';
  end if;

  if p_status not in ('administered', 'refused', 'held', 'missed') then
    raise exception using
      errcode = '22023',
      message = 'unsupported medication administration outcome';
  end if;

  if v_reason is not null and char_length(v_reason) > 1000 then
    raise exception using
      errcode = '22023',
      message = 'medication reason exceeds one thousand characters';
  end if;

  if p_status = 'administered' then
    if p_actual_dose is null
       or p_actual_dose::text in ('NaN', 'Infinity', '-Infinity')
       or p_actual_dose <= 0
       or p_actual_dose > 99999999.9999
       or p_actual_dose <> trunc(p_actual_dose, 4)
       or v_dose_unit is null
       or char_length(v_dose_unit) > 32 then
      raise exception using
        errcode = '22023',
        message = 'administered medication requires a finite positive actual dose and unit';
    end if;
  elsif p_actual_dose is not null or v_dose_unit is not null or v_reason is null then
    raise exception using
      errcode = '22023',
      message = 'refused, held, and missed outcomes require a reason and cannot contain an administered dose';
  end if;

  -- Current JWT assurance is required for both replay and mutation. A replay
  -- later validates its immutable receipt and independently requires a fresh
  -- challenge from this same session within the current 15-minute window.
  -- A new signature obtains its challenge after every client/slot/plan lock.
  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception using
      errcode = '42501',
      message = 'recent immutable AAL2 evidence is required for medication signing';
  end if;

  v_request_hash := encode(
    sha256(
      convert_to(
        jsonb_build_object(
          'schema_version', 1,
          'expected_organization_id', p_expected_organization_id,
          'expected_branch_id', p_expected_branch_id,
          'medication_administration_id', p_medication_administration_id,
          'status', p_status::text,
          'occurred_at', to_char(
            p_occurred_at at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
          ),
          'actual_dose', p_actual_dose,
          'dose_unit', v_dose_unit,
          'reason', v_reason
        )::text,
        'UTF8'
      )
    ),
    'hex'
  );

  perform pg_advisory_xact_lock(
    hashtextextended(
      'medication-operation:' || v_actor::text || ':' || p_idempotency_key::text,
      0
    )
  );

  select operation.*
    into v_operation
  from private.medication_administration_operations operation
  where operation.actor_user_id = v_actor
    and operation.idempotency_key = p_idempotency_key;

  if found then
    if v_operation.organization_id <> p_expected_organization_id
       or v_operation.branch_id <> p_expected_branch_id then
      raise exception using
        errcode = '42501',
        message = 'medication operation does not belong to the selected tenant context';
    end if;
    if v_operation.operation_kind <> 'record'
       or v_operation.request_hash <> v_request_hash then
      raise exception using
        errcode = '23505',
        message = 'medication administration idempotency conflict';
    end if;

    select client.*
      into v_client
    from public.clients client
    where client.id = v_operation.client_id
      and client.organization_id = v_operation.organization_id
      and client.branch_id = v_operation.branch_id
    for key share;

    if not found
       or not (select private.can_staff_access_client(
         v_operation.client_id,
         'medications.administer'
       )) then
      raise exception using
        errcode = '42501',
        message = 'medication administration is not permitted in the current client scope';
    end if;

    perform private.require_medication_replay_evidence(
      v_actor,
      v_operation.result_execution_reauth_challenge_id
    );

    return query select
      v_operation.id,
      v_operation.medication_administration_id,
      v_operation.client_id,
      v_operation.medication_plan_id,
      v_operation.result_status,
      (
        select administration.administered_at
        from public.medication_administrations administration
        where administration.id = v_operation.medication_administration_id
      ),
      v_operation.result_requires_second_verification,
      v_operation.result_finalization_state,
      v_operation.result_signed_at,
      v_operation.result_signed_by,
      v_operation.result_execution_reauth_challenge_id,
      v_operation.result_verification_reauth_challenge_id,
      v_operation.result_content_hash,
      true;
    return;
  end if;

  select administration.client_id
    into v_client_id
  from public.medication_administrations administration
  where administration.id = p_medication_administration_id
    and administration.organization_id = p_expected_organization_id
    and administration.branch_id = p_expected_branch_id;

  if v_client_id is null then
    raise exception using
      errcode = '42501',
      message = 'medication administration is not permitted in the current client scope';
  end if;

  select client.*
    into v_client
  from public.clients client
  where client.id = v_client_id
    and client.organization_id = p_expected_organization_id
    and client.branch_id = p_expected_branch_id
  for update;

  if not found
     or not (select private.can_staff_access_client(
       v_client_id,
       'medications.administer'
     )) then
    raise exception using
      errcode = '42501',
      message = 'medication administration is not permitted in the current client scope';
  end if;

  select administration.*
    into strict v_slot
  from public.medication_administrations administration
  where administration.id = p_medication_administration_id
    and administration.organization_id = v_client.organization_id
    and administration.branch_id = v_client.branch_id
    and administration.client_id = v_client.id
  for update;

  if v_slot.status <> 'scheduled'
     or v_slot.workflow_version is not null
     or v_slot.recorded_by is not null
     or v_slot.signed_at is not null then
    raise exception using
      errcode = '23514',
      message = 'medication slot is no longer available for an initial outcome';
  end if;

  select plan.record_key
    into v_plan_record_key
  from public.medication_plans plan
  where plan.id = v_slot.medication_plan_id
    and plan.organization_id = v_client.organization_id
    and plan.branch_id = v_client.branch_id
    and plan.client_id = v_client.id;

  if v_plan_record_key is null then
    raise exception using
      errcode = '23514',
      message = 'scheduled medication plan is unavailable';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'medication-plan-stream:' || v_client.organization_id::text || ':' ||
      v_client.branch_id::text || ':' || v_client.id::text || ':' ||
      v_plan_record_key::text,
      0
    )
  );

  select plan.*
    into v_plan
  from public.medication_plans plan
  where plan.id = v_slot.medication_plan_id
    and plan.organization_id = v_client.organization_id
    and plan.branch_id = v_client.branch_id
    and plan.client_id = v_client.id
  for share;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'scheduled medication plan is unavailable';
  end if;

  if not private.medication_plan_is_unique_at_occurrence(
       v_plan.organization_id,
       v_plan.branch_id,
       v_plan.client_id,
       v_plan.record_key,
       v_plan.id,
       p_occurred_at
     ) then
    raise exception using
      errcode = '23514',
      message = 'scheduled slot requires exactly one signed medication plan version effective at occurrence';
  end if;

  if p_status = 'administered'
     and (
       v_dose_unit <> v_plan.dose_unit
       or p_actual_dose <> v_plan.dose
     ) then
    raise exception using
      errcode = '23514',
      message = 'actual dose and unit must match the signed medication plan';
  end if;

  -- New mutation policy is evaluated only after client, slot, and plan locks.
  -- Exact replay has already returned with current authorization rechecked.
  if not (select private.can_staff_access_client(
       v_client.id,
       'medications.administer'
     )) then
    raise exception using
      errcode = '42501',
      message = 'medication administration permission expired before signing';
  end if;

  v_now := clock_timestamp();
  v_execution_challenge_id := private.require_medication_reauth_evidence(
    v_actor,
    v_now
  );

  if v_client.status <> 'active'
     or v_client.admitted_on is null
     or v_client.ended_on is not null
     or (v_slot.scheduled_for at time zone 'Asia/Taipei')::date < v_client.admitted_on then
    raise exception using
      errcode = '23514',
      message = 'medication administration requires an active, admitted, and unended client';
  end if;

  if p_occurred_at < v_now - interval '24 hours'
     or p_occurred_at > v_now + interval '5 minutes'
     or v_slot.scheduled_for < v_now - interval '24 hours'
     or v_slot.scheduled_for > v_now + interval '5 minutes' then
    raise exception using
      errcode = '22023',
      message = 'medication occurrence or scheduled time is outside the allowed 24-hour window';
  end if;

  v_late_entry :=
    p_occurred_at < v_now - interval '60 minutes'
    or v_slot.scheduled_for < v_now - interval '60 minutes';
  v_source := case when v_late_entry then 'staff_backfill' else 'staff' end;
  v_requires_second :=
    v_slot.requires_second_verification or v_plan.high_risk or v_late_entry;

  v_execution_hash := encode(
    sha256(
      convert_to(
        jsonb_build_object(
          'schema_version', 1,
          'organization_id', v_client.organization_id,
          'branch_id', v_client.branch_id,
          'client_id', v_client.id,
          'medication_administration_id', v_slot.id,
          'medication_plan_id', v_plan.id,
          'scheduled_for', to_char(
            v_slot.scheduled_for at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
          ),
          'status', p_status::text,
          'occurred_at', to_char(
            p_occurred_at at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
          ),
          'actual_dose', p_actual_dose,
          'dose_unit', v_dose_unit,
          'reason', v_reason,
          'late_entry', v_late_entry,
          'requires_second_verification', v_requires_second,
          'execution_source', v_source,
          'recorded_by', v_actor,
          'execution_signed_at', to_char(
            v_now at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
          ),
          'execution_signature_purpose', '用藥執行結果簽署',
          'execution_reauth_challenge_id', v_execution_challenge_id
        )::text,
        'UTF8'
      )
    ),
    'hex'
  );

  update public.medication_administrations
  set workflow_version = 1,
      administered_at = p_occurred_at,
      status = p_status,
      actual_dose = case when p_status = 'administered' then p_actual_dose else null end,
      dose_unit = case when p_status = 'administered' then v_dose_unit else null end,
      reason = v_reason,
      late_entry = v_late_entry,
      requires_second_verification = v_requires_second,
      recorded_by = v_actor,
      second_verified_by = null,
      second_verified_at = null,
      signed_at = case when v_requires_second then null else v_now end,
      signed_by = case when v_requires_second then null else v_actor end,
      content_hash = case when v_requires_second then null else v_execution_hash end,
      execution_source = v_source,
      execution_signed_at = v_now,
      execution_signature_purpose = '用藥執行結果簽署',
      execution_reauth_challenge_id = v_execution_challenge_id,
      execution_content_hash = v_execution_hash,
      verification_reauth_challenge_id = null,
      final_signature_purpose = case
        when v_requires_second then null
        else '用藥執行結果簽署'
      end
  where id = v_slot.id
  returning * into v_slot;

  insert into private.medication_administration_operations (
    organization_id,
    branch_id,
    client_id,
    medication_administration_id,
    medication_plan_id,
    actor_user_id,
    operation_kind,
    idempotency_key,
    request_hash,
    result_status,
    result_requires_second_verification,
    result_finalization_state,
    result_signed_at,
    result_signed_by,
    result_execution_reauth_challenge_id,
    result_verification_reauth_challenge_id,
    result_content_hash
  ) values (
    v_slot.organization_id,
    v_slot.branch_id,
    v_slot.client_id,
    v_slot.id,
    v_slot.medication_plan_id,
    v_actor,
    'record',
    p_idempotency_key,
    v_request_hash,
    v_slot.status,
    v_slot.requires_second_verification,
    case when v_slot.signed_at is null then 'pending_verification' else 'signed' end,
    v_slot.signed_at,
    v_slot.signed_by,
    v_slot.execution_reauth_challenge_id,
    v_slot.verification_reauth_challenge_id,
    v_slot.content_hash
  ) returning * into v_operation;

  return query select
    v_operation.id,
    v_slot.id,
    v_slot.client_id,
    v_slot.medication_plan_id,
    v_slot.status,
    v_slot.administered_at,
    v_slot.requires_second_verification,
    v_operation.result_finalization_state,
    v_slot.signed_at,
    v_slot.signed_by,
    v_slot.execution_reauth_challenge_id,
    v_slot.verification_reauth_challenge_id,
    v_slot.content_hash,
    false;
end;
$$;

create or replace function private.verify_medication_administration_atomic(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_medication_administration_id uuid,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid,
  medication_administration_id uuid,
  client_id uuid,
  medication_plan_id uuid,
  status public.medication_administration_status,
  administered_at timestamptz,
  requires_second_verification boolean,
  finalization_state text,
  signed_at timestamptz,
  signed_by uuid,
  execution_reauth_challenge_id uuid,
  verification_reauth_challenge_id uuid,
  content_hash text,
  replayed boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz;
  v_request_hash text;
  v_final_hash text;
  v_verification_challenge_id uuid;
  v_client_id uuid;
  v_client public.clients%rowtype;
  v_slot public.medication_administrations%rowtype;
  v_plan public.medication_plans%rowtype;
  v_plan_record_key uuid;
  v_operation private.medication_administration_operations%rowtype;
begin
  if v_actor is null
     or p_expected_organization_id is null
     or p_expected_branch_id is null
     or p_medication_administration_id is null
     or p_idempotency_key is null then
    raise exception using
      errcode = '22023',
      message = 'tenant context, medication administration, and idempotency key are required';
  end if;

  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception using
      errcode = '42501',
      message = 'recent immutable AAL2 evidence is required for medication signing';
  end if;

  v_request_hash := encode(
    sha256(
      convert_to(
        jsonb_build_object(
          'schema_version', 1,
          'expected_organization_id', p_expected_organization_id,
          'expected_branch_id', p_expected_branch_id,
          'medication_administration_id', p_medication_administration_id,
          'operation_kind', 'verify'
        )::text,
        'UTF8'
      )
    ),
    'hex'
  );

  perform pg_advisory_xact_lock(
    hashtextextended(
      'medication-operation:' || v_actor::text || ':' || p_idempotency_key::text,
      0
    )
  );

  select operation.*
    into v_operation
  from private.medication_administration_operations operation
  where operation.actor_user_id = v_actor
    and operation.idempotency_key = p_idempotency_key;

  if found then
    if v_operation.organization_id <> p_expected_organization_id
       or v_operation.branch_id <> p_expected_branch_id then
      raise exception using
        errcode = '42501',
        message = 'medication operation does not belong to the selected tenant context';
    end if;
    if v_operation.operation_kind <> 'verify'
       or v_operation.request_hash <> v_request_hash then
      raise exception using
        errcode = '23505',
        message = 'medication verification idempotency conflict';
    end if;

    select client.*
      into v_client
    from public.clients client
    where client.id = v_operation.client_id
      and client.organization_id = v_operation.organization_id
      and client.branch_id = v_operation.branch_id
    for key share;

    if not found
       or not (select private.can_staff_access_client(
         v_operation.client_id,
         'medications.verify'
       )) then
      raise exception using
        errcode = '42501',
        message = 'medication verification is not permitted in the current client scope';
    end if;

    perform private.require_medication_replay_evidence(
      v_actor,
      v_operation.result_verification_reauth_challenge_id
    );

    return query select
      v_operation.id,
      v_operation.medication_administration_id,
      v_operation.client_id,
      v_operation.medication_plan_id,
      v_operation.result_status,
      (
        select administration.administered_at
        from public.medication_administrations administration
        where administration.id = v_operation.medication_administration_id
      ),
      v_operation.result_requires_second_verification,
      v_operation.result_finalization_state,
      v_operation.result_signed_at,
      v_operation.result_signed_by,
      v_operation.result_execution_reauth_challenge_id,
      v_operation.result_verification_reauth_challenge_id,
      v_operation.result_content_hash,
      true;
    return;
  end if;

  select administration.client_id
    into v_client_id
  from public.medication_administrations administration
  where administration.id = p_medication_administration_id
    and administration.organization_id = p_expected_organization_id
    and administration.branch_id = p_expected_branch_id;

  if v_client_id is null then
    raise exception using
      errcode = '42501',
      message = 'medication verification is not permitted in the current client scope';
  end if;

  select client.*
    into v_client
  from public.clients client
  where client.id = v_client_id
    and client.organization_id = p_expected_organization_id
    and client.branch_id = p_expected_branch_id
  for update;

  if not found
     or not (select private.can_staff_access_client(
       v_client_id,
       'medications.verify'
     )) then
    raise exception using
      errcode = '42501',
      message = 'medication verification is not permitted in the current client scope';
  end if;

  select administration.*
    into strict v_slot
  from public.medication_administrations administration
  where administration.id = p_medication_administration_id
    and administration.organization_id = v_client.organization_id
    and administration.branch_id = v_client.branch_id
    and administration.client_id = v_client.id
  for update;

  if v_slot.workflow_version is distinct from 1
     or not v_slot.requires_second_verification
     or v_slot.status not in ('administered', 'refused', 'held', 'missed')
     or v_slot.execution_signed_at is null
     or v_slot.execution_reauth_challenge_id is null
     or v_slot.execution_content_hash is null
     or v_slot.recorded_by is null
     or v_slot.recorded_by = v_actor
     or v_slot.second_verified_by is not null
     or v_slot.signed_at is not null then
    raise exception using
      errcode = '23514',
      message = 'medication administration is not awaiting an independent second verifier';
  end if;

  select plan.record_key
    into v_plan_record_key
  from public.medication_plans plan
  where plan.id = v_slot.medication_plan_id
    and plan.organization_id = v_client.organization_id
    and plan.branch_id = v_client.branch_id
    and plan.client_id = v_client.id;

  if v_plan_record_key is null then
    raise exception using
      errcode = '23514',
      message = 'scheduled medication plan is unavailable';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'medication-plan-stream:' || v_client.organization_id::text || ':' ||
      v_client.branch_id::text || ':' || v_client.id::text || ':' ||
      v_plan_record_key::text,
      0
    )
  );

  select plan.*
    into v_plan
  from public.medication_plans plan
  where plan.id = v_slot.medication_plan_id
    and plan.organization_id = v_client.organization_id
    and plan.branch_id = v_client.branch_id
    and plan.client_id = v_client.id
  for share;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'scheduled medication plan is unavailable';
  end if;

  if not private.medication_plan_is_unique_at_occurrence(
       v_plan.organization_id,
       v_plan.branch_id,
       v_plan.client_id,
       v_plan.record_key,
       v_plan.id,
       v_slot.administered_at
     ) then
    raise exception using
      errcode = '23514',
      message = 'verification requires the unique signed medication plan effective at occurrence';
  end if;

  if not (select private.can_staff_access_client(
       v_client.id,
       'medications.verify'
     )) then
    raise exception using
      errcode = '42501',
      message = 'medication verification permission expired before signing';
  end if;

  v_now := clock_timestamp();
  v_verification_challenge_id := private.require_medication_reauth_evidence(
    v_actor,
    v_now
  );

  if v_client.status <> 'active'
     or v_client.admitted_on is null
     or v_client.ended_on is not null
     or (v_slot.scheduled_for at time zone 'Asia/Taipei')::date < v_client.admitted_on then
    raise exception using
      errcode = '23514',
      message = 'medication verification requires an active, admitted, and unended client';
  end if;

  if v_slot.administered_at < v_now - interval '24 hours'
     or v_slot.administered_at > v_now + interval '5 minutes'
     or v_slot.scheduled_for < v_now - interval '24 hours'
     or v_slot.scheduled_for > v_now + interval '5 minutes' then
    raise exception using
      errcode = '22023',
      message = 'medication verification is outside the allowed 24-hour window';
  end if;

  v_final_hash := encode(
    sha256(
      convert_to(
        jsonb_build_object(
          'schema_version', 1,
          'organization_id', v_slot.organization_id,
          'branch_id', v_slot.branch_id,
          'client_id', v_slot.client_id,
          'medication_administration_id', v_slot.id,
          'medication_plan_id', v_slot.medication_plan_id,
          'execution_content_hash', v_slot.execution_content_hash,
          'recorded_by', v_slot.recorded_by,
          'execution_reauth_challenge_id', v_slot.execution_reauth_challenge_id,
          'second_verified_by', v_actor,
          'second_verified_at', to_char(
            v_now at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
          ),
          'verification_reauth_challenge_id', v_verification_challenge_id,
          'final_signature_purpose', '用藥第二人獨立覆核簽署'
        )::text,
        'UTF8'
      )
    ),
    'hex'
  );

  update public.medication_administrations
  set second_verified_by = v_actor,
      second_verified_at = v_now,
      verification_reauth_challenge_id = v_verification_challenge_id,
      signed_at = v_now,
      signed_by = v_actor,
      final_signature_purpose = '用藥第二人獨立覆核簽署',
      content_hash = v_final_hash
  where id = v_slot.id
  returning * into v_slot;

  insert into private.medication_administration_operations (
    organization_id,
    branch_id,
    client_id,
    medication_administration_id,
    medication_plan_id,
    actor_user_id,
    operation_kind,
    idempotency_key,
    request_hash,
    result_status,
    result_requires_second_verification,
    result_finalization_state,
    result_signed_at,
    result_signed_by,
    result_execution_reauth_challenge_id,
    result_verification_reauth_challenge_id,
    result_content_hash
  ) values (
    v_slot.organization_id,
    v_slot.branch_id,
    v_slot.client_id,
    v_slot.id,
    v_slot.medication_plan_id,
    v_actor,
    'verify',
    p_idempotency_key,
    v_request_hash,
    v_slot.status,
    true,
    'signed',
    v_slot.signed_at,
    v_slot.signed_by,
    v_slot.execution_reauth_challenge_id,
    v_slot.verification_reauth_challenge_id,
    v_slot.content_hash
  ) returning * into v_operation;

  return query select
    v_operation.id,
    v_slot.id,
    v_slot.client_id,
    v_slot.medication_plan_id,
    v_slot.status,
    v_slot.administered_at,
    true,
    'signed'::text,
    v_slot.signed_at,
    v_slot.signed_by,
    v_slot.execution_reauth_challenge_id,
    v_slot.verification_reauth_challenge_id,
    v_slot.content_hash,
    false;
end;
$$;
