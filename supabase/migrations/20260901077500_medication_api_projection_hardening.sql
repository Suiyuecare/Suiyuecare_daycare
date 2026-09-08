-- Keep medication signing evidence server-side. Browser-callable RPCs expose
-- only the receipt fields required to render the page-7 outcome.

create or replace function private.record_medication_administration_response(
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
  status public.medication_administration_status,
  administered_at timestamptz,
  requires_second_verification boolean,
  finalization_state text,
  signed_at timestamptz,
  replayed boolean
)
language sql
volatile
security definer
set search_path = ''
as $$
  select
    result.operation_id,
    result.medication_administration_id,
    result.status,
    result.administered_at,
    result.requires_second_verification,
    result.finalization_state,
    result.signed_at,
    result.replayed
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
  ) result;
$$;

create or replace function private.verify_medication_administration_response(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_medication_administration_id uuid,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid,
  medication_administration_id uuid,
  status public.medication_administration_status,
  administered_at timestamptz,
  requires_second_verification boolean,
  finalization_state text,
  signed_at timestamptz,
  replayed boolean
)
language sql
volatile
security definer
set search_path = ''
as $$
  select
    result.operation_id,
    result.medication_administration_id,
    result.status,
    result.administered_at,
    result.requires_second_verification,
    result.finalization_state,
    result.signed_at,
    result.replayed
  from private.verify_medication_administration_atomic(
    p_expected_organization_id,
    p_expected_branch_id,
    p_medication_administration_id,
    p_idempotency_key
  ) result;
$$;

drop function public.record_medication_administration(
  uuid, uuid, uuid, public.medication_administration_status,
  timestamptz, numeric, text, text, uuid
);

create function public.record_medication_administration(
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
  status public.medication_administration_status,
  administered_at timestamptz,
  requires_second_verification boolean,
  finalization_state text,
  signed_at timestamptz,
  replayed boolean
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select *
  from private.record_medication_administration_response(
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

drop function public.verify_medication_administration(uuid, uuid, uuid, uuid);

create function public.verify_medication_administration(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_medication_administration_id uuid,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid,
  medication_administration_id uuid,
  status public.medication_administration_status,
  administered_at timestamptz,
  requires_second_verification boolean,
  finalization_state text,
  signed_at timestamptz,
  replayed boolean
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select *
  from private.verify_medication_administration_response(
    p_expected_organization_id,
    p_expected_branch_id,
    p_medication_administration_id,
    p_idempotency_key
  );
$$;

comment on function public.record_medication_administration(
  uuid, uuid, uuid, public.medication_administration_status,
  timestamptz, numeric, text, text, uuid
) is
  'Signs one scheduled medication outcome and returns a minimal UI receipt without signer evidence identifiers or hashes.';

comment on function public.verify_medication_administration(uuid, uuid, uuid, uuid) is
  'Independently finalizes a pending medication outcome and returns a minimal UI receipt without signer evidence identifiers or hashes.';

revoke all on function private.record_medication_administration_atomic(
  uuid, uuid, uuid, public.medication_administration_status,
  timestamptz, numeric, text, text, uuid
) from public, anon, authenticated, service_role;
revoke all on function private.verify_medication_administration_atomic(
  uuid, uuid, uuid, uuid
) from public, anon, authenticated, service_role;
revoke all on function private.record_medication_administration_response(
  uuid, uuid, uuid, public.medication_administration_status,
  timestamptz, numeric, text, text, uuid
) from public, anon, authenticated, service_role;
revoke all on function private.verify_medication_administration_response(
  uuid, uuid, uuid, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.record_medication_administration(
  uuid, uuid, uuid, public.medication_administration_status,
  timestamptz, numeric, text, text, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.verify_medication_administration(
  uuid, uuid, uuid, uuid
) from public, anon, authenticated, service_role;

grant execute on function private.record_medication_administration_response(
  uuid, uuid, uuid, public.medication_administration_status,
  timestamptz, numeric, text, text, uuid
) to authenticated;
grant execute on function private.verify_medication_administration_response(
  uuid, uuid, uuid, uuid
) to authenticated;
grant execute on function public.record_medication_administration(
  uuid, uuid, uuid, public.medication_administration_status,
  timestamptz, numeric, text, text, uuid
) to authenticated;
grant execute on function public.verify_medication_administration(
  uuid, uuid, uuid, uuid
) to authenticated;

-- Page consumers must use the tenant-checked minimal snapshot and mutation
-- receipts instead of selecting tables that also contain internal evidence.
revoke select on table public.medication_plans
  from authenticated, service_role;
revoke select on table public.medication_administrations
  from authenticated, service_role;
