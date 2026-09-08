-- Page 4: dedicated blood-glucose writer and service-day read index.
--
-- Tenant, branch, actor, source, request hash, and row identifiers are derived
-- inside the database. Authenticated clients keep read-only access to the
-- measurements table and must use the authenticated SECURITY INVOKER wrapper
-- for new blood-glucose rows.

alter table public.measurements
  add constraint measurements_blood_glucose_shape_check check (
    measurement_kind <> 'blood_glucose'
    or (
      numeric_value is not null
      and text_value is null
      and unit in ('mg/dL', 'mmol/L')
      and context ->> 'meal_context' in (
        'fasting',
        'pre_meal',
        'post_meal',
        'random'
      )
      and char_length(btrim(source)) between 1 and 64
      and numeric_value::text not in ('NaN', 'Infinity', '-Infinity')
      and (
        (
          unit = 'mg/dL'
          and numeric_value = trunc(numeric_value)
          and numeric_value between 20 and 600
        )
        or (
          unit = 'mmol/L'
          and numeric_value = trunc(numeric_value, 1)
          and numeric_value between 1.1 and 33.3
        )
      )
    )
  );

create index measurements_blood_glucose_branch_time_idx
  on public.measurements (
    organization_id,
    branch_id,
    measured_at desc,
    client_id
  )
  where measurement_kind = 'blood_glucose';

create or replace function private.record_blood_glucose_atomic(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_measured_at timestamptz,
  p_meal_context text,
  p_numeric_value numeric,
  p_unit text,
  p_idempotency_key uuid
)
returns table(
  id uuid,
  client_id uuid,
  measured_at timestamptz,
  meal_context text,
  numeric_value numeric,
  unit text,
  source text,
  replayed boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_client public.clients%rowtype;
  v_existing public.measurements%rowtype;
  v_request_hash text;
  v_canonical_value text;
begin
  if v_actor is null
     or p_expected_organization_id is null
     or p_expected_branch_id is null
     or p_client_id is null
     or p_measured_at is null
     or p_meal_context is null
     or p_numeric_value is null
     or p_unit is null
     or p_idempotency_key is null then
    raise exception using
      errcode = '22023',
      message = 'tenant context, client, measurement time, context, value, unit, and idempotency key are required';
  end if;

  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception using
      errcode = '42501',
      message = 'AAL2 is required for blood-glucose writes';
  end if;

  if p_meal_context not in ('fasting', 'pre_meal', 'post_meal', 'random') then
    raise exception using
      errcode = '22023',
      message = 'unsupported blood-glucose meal context';
  end if;

  if p_numeric_value::text in ('NaN', 'Infinity', '-Infinity')
     or p_unit not in ('mg/dL', 'mmol/L')
     or (
       p_unit = 'mg/dL'
       and (
         p_numeric_value <> trunc(p_numeric_value)
         or p_numeric_value not between 20 and 600
       )
     )
     or (
       p_unit = 'mmol/L'
       and (
         p_numeric_value <> trunc(p_numeric_value, 1)
         or p_numeric_value not between 1.1 and 33.3
       )
     ) then
    raise exception using
      errcode = '22023',
      message = 'blood-glucose value is outside the technical input range';
  end if;

  select client.*
    into v_client
  from public.clients client
  where client.id = p_client_id
    and client.organization_id = p_expected_organization_id
    and client.branch_id = p_expected_branch_id
  -- Serialize against lifecycle/status/date mutations. FOR KEY SHARE would be
  -- compatible with the NO KEY UPDATE lock used by an ordinary status update
  -- and could admit a measurement concurrently with closure.
  for update;

  if not found
     or not (select private.can_staff_access_client(p_client_id, 'health.write')) then
    raise exception using
      errcode = '42501',
      message = 'blood-glucose client scope is not permitted';
  end if;

  -- The token is actor-scoped and contains no personal data. Serialize it
  -- before replay lookup so concurrent retries cannot create two rows.
  perform pg_advisory_xact_lock(
    hashtextextended(
      'blood-glucose:' || p_expected_organization_id::text || ':'
      || p_expected_branch_id::text || ':' || v_actor::text || ':'
      || p_idempotency_key::text,
      0
    )
  );

  v_canonical_value := case
    when p_unit = 'mg/dL' then p_numeric_value::integer::text
    else to_char(p_numeric_value, 'FM990.0')
  end;

  v_request_hash := encode(
    sha256(
      convert_to(
        jsonb_build_object(
          'schema_version', 1,
          'organization_id', p_expected_organization_id,
          'branch_id', p_expected_branch_id,
          'client_id', p_client_id,
          'measured_at_epoch', extract(epoch from p_measured_at)::text,
          'meal_context', p_meal_context,
          'numeric_value', v_canonical_value,
          'unit', p_unit
        )::text,
        'UTF8'
      )
    ),
    'hex'
  );

  select measurement.*
    into v_existing
  from public.measurements measurement
  where measurement.organization_id = p_expected_organization_id
    and measurement.branch_id = p_expected_branch_id
    and measurement.recorded_by = v_actor
    and measurement.measurement_set_id = p_idempotency_key
    and measurement.measurement_kind = 'blood_glucose';

  if found then
    if v_existing.client_id <> p_client_id
       or v_existing.branch_id <> v_client.branch_id
       or v_existing.measured_at <> p_measured_at
       or v_existing.request_hash is distinct from v_request_hash
       or v_existing.numeric_value <> p_numeric_value
       or v_existing.unit <> p_unit
       or v_existing.context ->> 'meal_context' <> p_meal_context
       or v_existing.source <> 'staff' then
      raise exception using
        errcode = '23505',
        message = 'blood-glucose idempotency conflict';
    end if;

    return query
      select
        v_existing.id,
        v_existing.client_id,
        v_existing.measured_at,
        v_existing.context ->> 'meal_context',
        v_existing.numeric_value,
        v_existing.unit,
        v_existing.source,
        true;
    return;
  end if;

  -- These variable gates apply only to a new mutation. Exact replay above is
  -- intentionally still visible after time passes or lifecycle state changes,
  -- while the current health.write scope was revalidated first.
  if p_measured_at < clock_timestamp() - interval '24 hours'
     or p_measured_at > clock_timestamp() + interval '5 minutes' then
    raise exception using
      errcode = '22023',
      message = 'blood-glucose time is outside the allowed 24-hour window';
  end if;

  if v_client.status <> 'active'
     or v_client.admitted_on is null
     or v_client.ended_on is not null
     or (p_measured_at at time zone 'Asia/Taipei')::date < v_client.admitted_on then
    raise exception using
      errcode = '42501',
      message = 'blood-glucose recording is not permitted for the client lifecycle';
  end if;

  return query
    with inserted as (
      insert into public.measurements (
        organization_id,
        branch_id,
        client_id,
        measurement_kind,
        measured_at,
        numeric_value,
        unit,
        context,
        source,
        recorded_by,
        idempotency_key,
        measurement_set_id,
        request_hash
      ) values (
        v_client.organization_id,
        v_client.branch_id,
        v_client.id,
        'blood_glucose',
        p_measured_at,
        p_numeric_value,
        p_unit,
        jsonb_build_object(
          'meal_context', p_meal_context,
          '_request', jsonb_build_object(
            'schema_version', 1,
            'measurement_set_id', p_idempotency_key,
            'idempotency_hash', v_request_hash
          )
        ),
        'staff',
        v_actor,
        private.measurement_row_idempotency(
          v_client.organization_id,
          v_actor,
          p_idempotency_key,
          'blood_glucose'
        ),
        p_idempotency_key,
        v_request_hash
      )
      returning measurements.*
    )
    select
      inserted.id,
      inserted.client_id,
      inserted.measured_at,
      inserted.context ->> 'meal_context',
      inserted.numeric_value,
      inserted.unit,
      inserted.source,
      false
    from inserted;
end;
$$;

create or replace function public.record_blood_glucose(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_measured_at timestamptz,
  p_meal_context text,
  p_numeric_value numeric,
  p_unit text,
  p_idempotency_key uuid
)
returns table(
  id uuid,
  client_id uuid,
  measured_at timestamptz,
  meal_context text,
  numeric_value numeric,
  unit text,
  source text,
  replayed boolean
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select *
  from private.record_blood_glucose_atomic(
    p_expected_organization_id,
    p_expected_branch_id,
    p_client_id,
    p_measured_at,
    p_meal_context,
    p_numeric_value,
    p_unit,
    p_idempotency_key
  );
$$;

comment on function public.record_blood_glucose(uuid, uuid, uuid, timestamptz, text, numeric, text, uuid) is
  'Records one actor-scoped blood-glucose measurement with exact replay, lifecycle, technical-range, and RLS permission enforcement. Values are not diagnoses.';

revoke all on function private.record_blood_glucose_atomic(uuid, uuid, uuid, timestamptz, text, numeric, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.record_blood_glucose(uuid, uuid, uuid, timestamptz, text, numeric, text, uuid)
  from public, anon, authenticated, service_role;

grant execute on function private.record_blood_glucose_atomic(uuid, uuid, uuid, timestamptz, text, numeric, text, uuid)
  to authenticated;
grant execute on function public.record_blood_glucose(uuid, uuid, uuid, timestamptz, text, numeric, text, uuid)
  to authenticated;

revoke insert, update, delete on table public.measurements from authenticated;
