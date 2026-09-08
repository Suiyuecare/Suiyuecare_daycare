-- Page 7: dedicated medication-administration workflow over trusted,
-- pre-scheduled slots. Page 8 plan authoring/versioning is intentionally not
-- implemented here; authenticated callers lose direct plan and slot writes.

alter table public.medication_administrations
  add column workflow_version smallint,
  add column execution_source text,
  add column execution_signed_at timestamptz,
  add column execution_signature_purpose text,
  add column execution_reauth_challenge_id uuid,
  add column execution_content_hash text,
  add column verification_reauth_challenge_id uuid,
  add column final_signature_purpose text;

alter table public.medication_administrations
  add constraint medication_administrations_id_scope_key
    unique (id, organization_id, branch_id, client_id),
  add constraint medication_administrations_workflow_version_check
    check (workflow_version is null or workflow_version = 1),
  add constraint medication_administrations_execution_source_check
    check (execution_source is null or execution_source in ('staff', 'staff_backfill')),
  add constraint medication_administrations_execution_purpose_check
    check (
      execution_signature_purpose is null
      or char_length(btrim(execution_signature_purpose)) between 1 and 240
    ),
  add constraint medication_administrations_final_purpose_check
    check (
      final_signature_purpose is null
      or char_length(btrim(final_signature_purpose)) between 1 and 240
    ),
  add constraint medication_administrations_execution_hash_check
    check (
      execution_content_hash is null
      or execution_content_hash ~ '^[a-f0-9]{64}$'
    ),
  add constraint medication_administrations_execution_reauth_fkey
    foreign key (execution_reauth_challenge_id)
    references private.reauth_challenges(id) on delete restrict,
  add constraint medication_administrations_verification_reauth_fkey
    foreign key (verification_reauth_challenge_id)
    references private.reauth_challenges(id) on delete restrict,
  add constraint medication_administrations_dedicated_state_check check (
    workflow_version is null
    or (
      status in ('administered', 'refused', 'held', 'missed')
      and administered_at is not null
      and recorded_by is not null
      and execution_source is not null
      and execution_signed_at is not null
      and execution_signature_purpose = '用藥執行結果簽署'
      and execution_reauth_challenge_id is not null
      and execution_content_hash ~ '^[a-f0-9]{64}$'
      and (
        (
          status = 'administered'
          and actual_dose is not null
          and actual_dose > 0
          and dose_unit is not null
          and char_length(btrim(dose_unit)) between 1 and 32
        )
        or (
          status in ('refused', 'held', 'missed')
          and actual_dose is null
          and dose_unit is null
          and char_length(btrim(reason)) between 1 and 1000
        )
      )
      and (
        (
          not requires_second_verification
          and second_verified_by is null
          and second_verified_at is null
          and verification_reauth_challenge_id is null
          and signed_at = execution_signed_at
          and signed_by = recorded_by
          and final_signature_purpose = '用藥執行結果簽署'
          and content_hash = execution_content_hash
        )
        or (
          requires_second_verification
          and (
            (
              second_verified_by is null
              and second_verified_at is null
              and verification_reauth_challenge_id is null
              and signed_at is null
              and signed_by is null
              and final_signature_purpose is null
              and content_hash is null
            )
            or (
              second_verified_by is not null
              and second_verified_by <> recorded_by
              and second_verified_at is not null
              and verification_reauth_challenge_id is not null
              and signed_at = second_verified_at
              and signed_by = second_verified_by
              and final_signature_purpose = '用藥第二人獨立覆核簽署'
              and content_hash ~ '^[a-f0-9]{64}$'
            )
          )
        )
      )
    )
  );

comment on column public.medication_administrations.workflow_version is
  'Version 1 identifies rows authored by the dedicated page-7 workflow; null preserves legacy/scheduler slots.';
comment on column public.medication_administrations.execution_source is
  'Server-derived staff or staff_backfill source. More than 60 minutes is a provisional technical backfill rule pending governed rule versioning.';
comment on column public.medication_administrations.execution_reauth_challenge_id is
  'Exact immutable consumed AAL2 challenge supporting the first executor signature.';
comment on column public.medication_administrations.verification_reauth_challenge_id is
  'Exact immutable consumed AAL2 challenge supporting an independent second-person signature.';

create index medication_administrations_execution_reauth_idx
  on public.medication_administrations (execution_reauth_challenge_id)
  where execution_reauth_challenge_id is not null;
create index medication_administrations_verification_reauth_idx
  on public.medication_administrations (verification_reauth_challenge_id)
  where verification_reauth_challenge_id is not null;

create table private.medication_administration_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  client_id uuid not null,
  medication_administration_id uuid not null,
  medication_plan_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  operation_kind text not null,
  idempotency_key uuid not null,
  request_hash text not null,
  result_status public.medication_administration_status not null,
  result_requires_second_verification boolean not null,
  result_finalization_state text not null,
  result_signed_at timestamptz,
  result_signed_by uuid references auth.users(id) on delete restrict,
  result_execution_reauth_challenge_id uuid not null
    references private.reauth_challenges(id) on delete restrict,
  result_verification_reauth_challenge_id uuid
    references private.reauth_challenges(id) on delete restrict,
  result_content_hash text,
  created_at timestamptz not null default clock_timestamp(),
  constraint medication_administration_operations_scope_fkey
    foreign key (
      medication_administration_id,
      organization_id,
      branch_id,
      client_id
    ) references public.medication_administrations(
      id,
      organization_id,
      branch_id,
      client_id
    ) on delete restrict,
  constraint medication_administration_operations_plan_fkey
    foreign key (medication_plan_id, organization_id, branch_id, client_id)
    references public.medication_plans(id, organization_id, branch_id, client_id)
    on delete restrict,
  constraint medication_administration_operations_actor_key
    unique (actor_user_id, idempotency_key),
  constraint medication_administration_operations_kind_check
    check (operation_kind in ('record', 'verify')),
  constraint medication_administration_operations_hash_check
    check (request_hash ~ '^[a-f0-9]{64}$'),
  constraint medication_administration_operations_status_check
    check (result_status in ('administered', 'refused', 'held', 'missed')),
  constraint medication_administration_operations_finalization_check check (
    (
      result_finalization_state = 'pending_verification'
      and result_requires_second_verification
      and result_signed_at is null
      and result_signed_by is null
      and result_verification_reauth_challenge_id is null
      and result_content_hash is null
    )
    or (
      result_finalization_state = 'signed'
      and result_signed_at is not null
      and result_signed_by is not null
      and result_content_hash ~ '^[a-f0-9]{64}$'
      and (
        (not result_requires_second_verification and result_verification_reauth_challenge_id is null)
        or (result_requires_second_verification and result_verification_reauth_challenge_id is not null)
      )
    )
  )
);

comment on table private.medication_administration_operations is
  'Append-only actor-scoped receipts for page-7 record and independent verification operations.';

create index medication_administration_operations_slot_idx
  on private.medication_administration_operations (
    organization_id,
    branch_id,
    medication_administration_id,
    created_at desc
  );
create index medication_administration_operations_client_idx
  on private.medication_administration_operations (client_id);
create index medication_administration_operations_plan_idx
  on private.medication_administration_operations (medication_plan_id);
create index medication_administration_operations_signed_by_idx
  on private.medication_administration_operations (result_signed_by)
  where result_signed_by is not null;
create index medication_administration_operations_execution_evidence_idx
  on private.medication_administration_operations (
    result_execution_reauth_challenge_id
  );
create index medication_administration_operations_verification_evidence_idx
  on private.medication_administration_operations (
    result_verification_reauth_challenge_id
  ) where result_verification_reauth_challenge_id is not null;

alter table private.medication_administration_operations enable row level security;
alter table private.medication_administration_operations force row level security;

create or replace function private.prevent_medication_operation_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception using
    errcode = '55000',
    message = 'medication administration operation history is immutable';
end;
$$;

create trigger medication_administration_operations_prevent_mutation
before update or delete on private.medication_administration_operations
for each row execute function private.prevent_medication_operation_mutation();

create trigger medication_administration_operations_audit_insert
after insert on private.medication_administration_operations
for each row execute function private.audit_row_change();

-- The foundation's generic key trigger treats recorded_by as immutable, which
-- is correct after authorship but would prevent a trusted scheduler-created
-- null slot from receiving its first executor. Keep every other key invariant
-- and allow only the dedicated null-to-current-actor transition.
drop trigger medication_administrations_prevent_key_change
  on public.medication_administrations;

create or replace function private.prevent_medication_administration_key_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_old jsonb := to_jsonb(old);
  v_new jsonb := to_jsonb(new);
  v_key text;
  v_keys constant text[] := array[
    'id',
    'organization_id',
    'branch_id',
    'client_id',
    'medication_plan_id',
    'idempotency_key'
  ];
begin
  foreach v_key in array v_keys loop
    if v_old -> v_key is distinct from v_new -> v_key then
      raise exception using
        errcode = '23514',
        message = format(
          'immutable key %s cannot be changed on %I.%I',
          v_key,
          tg_table_schema,
          tg_table_name
        );
    end if;
  end loop;

  if old.recorded_by is distinct from new.recorded_by
     and not (
       old.recorded_by is null
       and new.recorded_by = auth.uid()
       and old.workflow_version is null
       and new.workflow_version = 1
       and old.status = 'scheduled'
     ) then
    raise exception using
      errcode = '23514',
      message = 'medication executor identity is immutable after first dedicated execution';
  end if;

  return new;
end;
$$;

create trigger medication_administrations_prevent_key_change
before update on public.medication_administrations
for each row execute function private.prevent_medication_administration_key_change();

create or replace function private.protect_dedicated_medication_execution()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.workflow_version is distinct from 1 then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' then
    raise exception using
      errcode = '55000',
      message = 'dedicated medication execution evidence is immutable';
  end if;

  if old.signed_at is not null then
    raise exception using
      errcode = '55000',
      message = 'signed medication administration is immutable';
  end if;

  if not old.requires_second_verification
     or old.second_verified_by is not null
     or new.second_verified_by is null
     or new.second_verified_at is null
     or new.verification_reauth_challenge_id is null
     or new.signed_at is null
     or new.signed_by is null
     or new.content_hash is null
     or (
       to_jsonb(new) - array[
         'second_verified_by',
         'second_verified_at',
         'verification_reauth_challenge_id',
         'signed_at',
         'signed_by',
         'final_signature_purpose',
         'content_hash',
         'updated_at'
       ]
     ) is distinct from (
       to_jsonb(old) - array[
         'second_verified_by',
         'second_verified_at',
         'verification_reauth_challenge_id',
         'signed_at',
         'signed_by',
         'final_signature_purpose',
         'content_hash',
         'updated_at'
       ]
     ) then
    raise exception using
      errcode = '55000',
      message = 'pending medication execution may only receive one independent final verification';
  end if;

  return new;
end;
$$;

create trigger medication_administrations_protect_dedicated_execution
before update or delete on public.medication_administrations
for each row execute function private.protect_dedicated_medication_execution();

create or replace function private.require_medication_reauth_evidence(
  p_actor_user_id uuid,
  p_at timestamptz
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_session_id uuid;
  v_challenge_id uuid;
begin
  if p_actor_user_id is null
     or p_at is null
     or p_actor_user_id <> auth.uid()
     or coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception using
      errcode = '42501',
      message = 'recent immutable AAL2 evidence is required for medication signing';
  end if;

  begin
    v_session_id := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception using
      errcode = '42501',
      message = 'recent immutable AAL2 evidence is required for medication signing';
  end;

  if v_session_id is null then
    raise exception using
      errcode = '42501',
      message = 'recent immutable AAL2 evidence is required for medication signing';
  end if;

  select challenge.id
    into v_challenge_id
  from private.reauth_events reauth
  join private.reauth_challenges challenge
    on challenge.id = reauth.challenge_id
   and challenge.user_id = reauth.user_id
   and challenge.session_id = reauth.session_id
  where reauth.user_id = p_actor_user_id
    and reauth.session_id = v_session_id
    and reauth.aal = 'aal2'
    and reauth.revoked_at is null
    and reauth.verification_method in ('totp', 'webauthn', 'phone')
    and challenge.consumed_at is not null
    and challenge.invalidated_at is null
    and challenge.factor_method = reauth.verification_method
    and challenge.factor_verified_at = reauth.verified_at
    and challenge.factor_verified_at >= p_at - interval '15 minutes'
    and challenge.factor_verified_at <= p_at + interval '1 minute'
  order by challenge.factor_verified_at desc, challenge.id desc
  limit 1
  for share of reauth, challenge;

  if v_challenge_id is null then
    raise exception using
      errcode = '42501',
      message = 'recent immutable AAL2 evidence is required for medication signing';
  end if;

  return v_challenge_id;
end;
$$;

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
  v_session_id uuid;
begin
  if p_actor_user_id is null
     or p_receipt_challenge_id is null
     or p_actor_user_id <> auth.uid()
     or coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception using
      errcode = '42501',
      message = 'current AAL2 and immutable evidence are required to replay medication signing';
  end if;

  begin
    v_session_id := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception using
      errcode = '42501',
      message = 'current AAL2 and immutable evidence are required to replay medication signing';
  end;

  if v_session_id is null
     or not exists (
       select 1
       from private.reauth_challenges receipt
       where receipt.id = p_receipt_challenge_id
         and receipt.user_id = p_actor_user_id
         and receipt.consumed_at is not null
         and receipt.invalidated_at is null
         and receipt.factor_method in ('totp', 'webauthn', 'phone')
         and receipt.factor_verified_at is not null
     )
     or not exists (
       select 1
       from private.reauth_events reauth
       join private.reauth_challenges current_evidence
         on current_evidence.id = reauth.challenge_id
        and current_evidence.user_id = reauth.user_id
        and current_evidence.session_id = reauth.session_id
       where reauth.user_id = p_actor_user_id
         and reauth.session_id = v_session_id
         and reauth.aal = 'aal2'
         and reauth.revoked_at is null
         and reauth.verification_method in ('totp', 'webauthn', 'phone')
         and current_evidence.consumed_at is not null
         and current_evidence.invalidated_at is null
         and current_evidence.factor_method = reauth.verification_method
         and current_evidence.factor_verified_at = reauth.verified_at
     ) then
    raise exception using
      errcode = '42501',
      message = 'current AAL2 and immutable evidence are required to replay medication signing';
  end if;

  return true;
end;
$$;

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
  v_plan_count integer;
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
  -- later validates its immutable receipt plus the current session evidence
  -- without applying the mutable 15-minute freshness gate. Only a new
  -- signature needs a fresh challenge after every client/slot/plan lock.
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

  perform pg_advisory_xact_lock(
    hashtextextended(
      'medication-plan-stream:' || v_client.organization_id::text || ':' ||
      v_client.branch_id::text || ':' || v_client.id::text || ':' ||
      v_slot.medication_plan_id::text,
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

  select count(*)::integer
    into v_plan_count
  from public.medication_plans candidate
  where candidate.organization_id = v_plan.organization_id
    and candidate.branch_id = v_plan.branch_id
    and candidate.client_id = v_plan.client_id
    and candidate.record_key = v_plan.record_key
    and candidate.status = 'active'
    and candidate.signed_at is not null
    and candidate.signed_by is not null
    and candidate.content_hash ~ '^[a-f0-9]{64}$'
    and candidate.effective_from <= v_slot.scheduled_for
    and (candidate.effective_to is null or candidate.effective_to >= v_slot.scheduled_for);

  if v_plan_count <> 1
     or v_plan.status <> 'active'
     or v_plan.signed_at is null
     or v_plan.signed_by is null
     or v_plan.content_hash !~ '^[a-f0-9]{64}$'
     or v_plan.effective_from > v_slot.scheduled_for
     or (v_plan.effective_to is not null and v_plan.effective_to < v_slot.scheduled_for) then
    raise exception using
      errcode = '23514',
      message = 'scheduled slot requires exactly one active signed effective medication plan version';
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
  v_plan_count integer;
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

  perform pg_advisory_xact_lock(
    hashtextextended(
      'medication-plan-stream:' || v_client.organization_id::text || ':' ||
      v_client.branch_id::text || ':' || v_client.id::text || ':' ||
      v_slot.medication_plan_id::text,
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

  select count(*)::integer
    into v_plan_count
  from public.medication_plans candidate
  where candidate.organization_id = v_plan.organization_id
    and candidate.branch_id = v_plan.branch_id
    and candidate.client_id = v_plan.client_id
    and candidate.record_key = v_plan.record_key
    and candidate.status = 'active'
    and candidate.signed_at is not null
    and candidate.signed_by is not null
    and candidate.content_hash ~ '^[a-f0-9]{64}$'
    and candidate.effective_from <= v_slot.scheduled_for
    and (candidate.effective_to is null or candidate.effective_to >= v_slot.scheduled_for);

  if v_plan_count <> 1
     or v_plan.status <> 'active'
     or v_plan.signed_at is null
     or v_plan.signed_by is null
     or v_plan.content_hash !~ '^[a-f0-9]{64}$'
     or v_plan.effective_from > v_slot.scheduled_for
     or (v_plan.effective_to is not null and v_plan.effective_to < v_slot.scheduled_for) then
    raise exception using
      errcode = '23514',
      message = 'verification requires the unique signed medication plan effective for the scheduled slot';
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

create or replace function private.medication_administration_day_snapshot(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_service_date date
)
returns table(
  administration_id uuid,
  client_id uuid,
  client_code text,
  client_display_name text,
  medication_plan_id uuid,
  medication_name text,
  planned_dose numeric,
  dose_unit text,
  medication_route text,
  high_risk boolean,
  scheduled_for timestamptz,
  occurred_at timestamptz,
  execution_signed_at timestamptz,
  status public.medication_administration_status,
  actual_dose numeric,
  actual_dose_unit text,
  reason text,
  execution_source text,
  late_entry boolean,
  requires_second_verification boolean,
  recorded_by uuid,
  recorded_by_name text,
  second_verified_by uuid,
  second_verified_by_name text,
  second_verified_at timestamptz,
  signed_at timestamptz,
  finalization_state text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_start timestamptz;
  v_end timestamptz;
  v_result_count integer;
begin
  if v_actor is null
     or p_expected_organization_id is null
     or p_expected_branch_id is null
     or p_service_date is null
     or not (select private.has_permission(
       p_expected_organization_id,
       p_expected_branch_id,
       'medications.read'
     ))
     or not (select private.has_permission(
       p_expected_organization_id,
       p_expected_branch_id,
       'clients.read'
     )) then
    raise exception using
      errcode = '42501',
      message = 'medication snapshot is not permitted in the selected tenant context';
  end if;

  v_start := p_service_date::timestamp at time zone 'Asia/Taipei';
  v_end := (p_service_date + 1)::timestamp at time zone 'Asia/Taipei';

  return query
    select
      administration.id,
      client.id,
      client.client_code,
      client.display_name,
      plan.id,
      plan.medication_name,
      plan.dose,
      plan.dose_unit,
      plan.route,
      plan.high_risk,
      administration.scheduled_for,
      administration.administered_at,
      administration.execution_signed_at,
      administration.status,
      administration.actual_dose,
      administration.dose_unit,
      administration.reason,
      administration.execution_source,
      administration.late_entry,
      administration.requires_second_verification,
      administration.recorded_by,
      executor.display_name,
      administration.second_verified_by,
      verifier.display_name,
      administration.second_verified_at,
      administration.signed_at,
      case
        when administration.signed_at is not null then 'signed'
        when administration.workflow_version = 1
          and administration.requires_second_verification
          and administration.execution_signed_at is not null
          then 'pending_verification'
        else 'scheduled'
      end
    from public.medication_administrations administration
    join public.clients client
      on client.id = administration.client_id
     and client.organization_id = administration.organization_id
     and client.branch_id = administration.branch_id
    join public.medication_plans plan
      on plan.id = administration.medication_plan_id
     and plan.organization_id = administration.organization_id
     and plan.branch_id = administration.branch_id
     and plan.client_id = administration.client_id
    left join public.profiles executor on executor.id = administration.recorded_by
    left join public.profiles verifier on verifier.id = administration.second_verified_by
    where administration.organization_id = p_expected_organization_id
      and administration.branch_id = p_expected_branch_id
      and administration.scheduled_for >= v_start
      and administration.scheduled_for < v_end
      and administration.status <> 'voided'
      and (select private.can_staff_access_client(client.id, 'medications.read'))
      and (select private.can_staff_access_client(client.id, 'clients.read'))
    order by administration.scheduled_for, client.client_code, plan.medication_name, administration.id;

  get diagnostics v_result_count = row_count;

  insert into public.audit_events (
    organization_id,
    branch_id,
    actor_user_id,
    action,
    table_name,
    row_pk,
    changed_fields,
    metadata
  ) values (
    p_expected_organization_id,
    p_expected_branch_id,
    v_actor,
    'select',
    'medication_administrations',
    p_service_date::text,
    '{}'::text[],
    jsonb_build_object('service_date', p_service_date, 'result_count', v_result_count)
  );
end;
$$;

create or replace function public.record_medication_administration(
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
language sql
volatile
security invoker
set search_path = ''
as $$
  select *
  from private.record_medication_administration_atomic(
    p_expected_organization_id,
    p_expected_branch_id,
    p_medication_administration_id,
    p_status,
    p_occurred_at,
    p_actual_dose,
    p_dose_unit,
    p_reason,
    p_idempotency_key
  );
$$;

create or replace function public.verify_medication_administration(
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
language sql
volatile
security invoker
set search_path = ''
as $$
  select *
  from private.verify_medication_administration_atomic(
    p_expected_organization_id,
    p_expected_branch_id,
    p_medication_administration_id,
    p_idempotency_key
  );
$$;

create or replace function public.medication_administration_day_snapshot(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_service_date date
)
returns table(
  administration_id uuid,
  client_id uuid,
  client_code text,
  client_display_name text,
  medication_plan_id uuid,
  medication_name text,
  planned_dose numeric,
  dose_unit text,
  medication_route text,
  high_risk boolean,
  scheduled_for timestamptz,
  occurred_at timestamptz,
  execution_signed_at timestamptz,
  status public.medication_administration_status,
  actual_dose numeric,
  actual_dose_unit text,
  reason text,
  execution_source text,
  late_entry boolean,
  requires_second_verification boolean,
  recorded_by uuid,
  recorded_by_name text,
  second_verified_by uuid,
  second_verified_by_name text,
  second_verified_at timestamptz,
  signed_at timestamptz,
  finalization_state text
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select *
  from private.medication_administration_day_snapshot(
    p_expected_organization_id,
    p_expected_branch_id,
    p_service_date
  );
$$;

comment on function public.record_medication_administration(
  uuid, uuid, uuid, public.medication_administration_status,
  timestamptz, numeric, text, text, uuid
) is
  'Records and signs one existing scheduled medication slot. High-risk, provisional >60-minute backfill, or pre-flagged slots await independent verification.';
comment on function public.verify_medication_administration(uuid, uuid, uuid, uuid) is
  'Independently verifies and final-signs one pending medication administration with exact immutable AAL2 evidence.';
comment on function public.medication_administration_day_snapshot(uuid, uuid, date) is
  'Returns the minimal tenant-scoped page-7 daily work snapshot and records a non-PII read audit event.';

revoke all on table private.medication_administration_operations
  from public, anon, authenticated, service_role;
revoke all on function private.prevent_medication_operation_mutation()
  from public, anon, authenticated, service_role;
revoke all on function private.prevent_medication_administration_key_change()
  from public, anon, authenticated, service_role;
revoke all on function private.protect_dedicated_medication_execution()
  from public, anon, authenticated, service_role;
revoke all on function private.require_medication_reauth_evidence(uuid, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.require_medication_replay_evidence(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.record_medication_administration_atomic(
  uuid, uuid, uuid, public.medication_administration_status,
  timestamptz, numeric, text, text, uuid
) from public, anon, authenticated, service_role;
revoke all on function private.verify_medication_administration_atomic(
  uuid, uuid, uuid, uuid
) from public, anon, authenticated, service_role;
revoke all on function private.medication_administration_day_snapshot(
  uuid, uuid, date
) from public, anon, authenticated, service_role;
revoke all on function public.record_medication_administration(
  uuid, uuid, uuid, public.medication_administration_status,
  timestamptz, numeric, text, text, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.verify_medication_administration(
  uuid, uuid, uuid, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.medication_administration_day_snapshot(
  uuid, uuid, date
) from public, anon, authenticated, service_role;

grant execute on function private.record_medication_administration_atomic(
  uuid, uuid, uuid, public.medication_administration_status,
  timestamptz, numeric, text, text, uuid
) to authenticated;
grant execute on function private.verify_medication_administration_atomic(
  uuid, uuid, uuid, uuid
) to authenticated;
grant execute on function private.medication_administration_day_snapshot(
  uuid, uuid, date
) to authenticated;
grant execute on function public.record_medication_administration(
  uuid, uuid, uuid, public.medication_administration_status,
  timestamptz, numeric, text, text, uuid
) to authenticated;
grant execute on function public.verify_medication_administration(
  uuid, uuid, uuid, uuid
) to authenticated;
grant execute on function public.medication_administration_day_snapshot(
  uuid, uuid, date
) to authenticated;

-- Page 7 and the incomplete page-8 surface cannot bypass governed workflows.
-- Trusted migration/scheduler roles may still prepare signed plans and
-- scheduled slots; formal plan authoring/versioning remains a page-8 gap.
revoke insert, update, delete on table public.medication_plans
  from authenticated, service_role;
revoke insert, update, delete on table public.medication_administrations
  from authenticated, service_role;
