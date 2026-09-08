-- Dedicated, atomic vital-sign set writer for page 3.
-- Direct table writes are withdrawn after the RPC is installed so authorized
-- callers cannot bypass the paired blood-pressure, time, range, and replay
-- invariants through PostgREST.

alter table public.measurements
  add column measurement_set_id uuid,
  add column request_hash text;

alter table public.measurements
  add constraint measurements_request_hash_check
    check (request_hash is null or request_hash ~ '^[a-f0-9]{64}$'),
  add constraint measurements_set_metadata_check check (
    (measurement_set_id is null and request_hash is null)
    or (measurement_set_id is not null and request_hash is not null)
  );

create unique index measurements_actor_set_kind_key
  on public.measurements (
    organization_id,
    recorded_by,
    measurement_set_id,
    measurement_kind
  )
  where measurement_set_id is not null;

create or replace function private.measurement_row_idempotency(
  p_organization_id uuid,
  p_actor_id uuid,
  p_measurement_set_id uuid,
  p_measurement_kind text
)
returns uuid
language sql
immutable
security invoker
set search_path = ''
as $$
  select (
    substr(md5(p_organization_id::text || ':' || p_actor_id::text || ':' || p_measurement_set_id::text || ':' || p_measurement_kind), 1, 8)
    || '-' || substr(md5(p_organization_id::text || ':' || p_actor_id::text || ':' || p_measurement_set_id::text || ':' || p_measurement_kind), 9, 4)
    || '-5' || substr(md5(p_organization_id::text || ':' || p_actor_id::text || ':' || p_measurement_set_id::text || ':' || p_measurement_kind), 14, 3)
    || '-a' || substr(md5(p_organization_id::text || ':' || p_actor_id::text || ':' || p_measurement_set_id::text || ':' || p_measurement_kind), 18, 3)
    || '-' || substr(md5(p_organization_id::text || ':' || p_actor_id::text || ':' || p_measurement_set_id::text || ':' || p_measurement_kind), 21, 12)
  )::uuid;
$$;

create or replace function private.record_vital_set_atomic(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_measured_at timestamptz,
  p_idempotency_key uuid,
  p_systolic numeric default null,
  p_diastolic numeric default null,
  p_pulse numeric default null,
  p_temperature numeric default null,
  p_oxygen_saturation numeric default null
)
returns table(
  id uuid,
  measurement_kind text,
  replayed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_client public.clients%rowtype;
  v_expected_count integer;
  v_existing_count integer;
  v_request_hash text;
  v_now timestamptz;
begin
  if v_actor is null
     or p_expected_organization_id is null
     or p_expected_branch_id is null
     or p_client_id is null
     or p_measured_at is null
     or p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'client, measurement time, and idempotency key are required';
  end if;

  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception using errcode = '42501', message = 'an AAL2 staff session is required';
  end if;

  if (p_systolic is null) <> (p_diastolic is null) then
    raise exception using errcode = '22023', message = 'systolic and diastolic pressure must be recorded together';
  end if;

  v_expected_count :=
    (case when p_systolic is null then 0 else 1 end)
    + (case when p_diastolic is null then 0 else 1 end)
    + (case when p_pulse is null then 0 else 1 end)
    + (case when p_temperature is null then 0 else 1 end)
    + (case when p_oxygen_saturation is null then 0 else 1 end);

  if v_expected_count = 0
     or (p_systolic is not null and (
       p_systolic::text in ('NaN', 'Infinity', '-Infinity')
       or p_systolic <> trunc(p_systolic)
     ))
     or (p_diastolic is not null and (
       p_diastolic::text in ('NaN', 'Infinity', '-Infinity')
       or p_diastolic <> trunc(p_diastolic)
     ))
     or (p_pulse is not null and (
       p_pulse::text in ('NaN', 'Infinity', '-Infinity')
       or p_pulse <> trunc(p_pulse)
     ))
     or (p_temperature is not null and (
       p_temperature::text in ('NaN', 'Infinity', '-Infinity')
       or p_temperature <> trunc(p_temperature, 1)
     ))
     or (p_oxygen_saturation is not null and (
       p_oxygen_saturation::text in ('NaN', 'Infinity', '-Infinity')
       or p_oxygen_saturation <> trunc(p_oxygen_saturation)
     ))
     or (p_systolic is not null and p_systolic not between 20 and 350)
     or (p_diastolic is not null and p_diastolic not between 10 and 250)
     or (p_pulse is not null and p_pulse not between 10 and 350)
     or (p_temperature is not null and p_temperature not between 20 and 50)
     or (p_oxygen_saturation is not null and p_oxygen_saturation not between 1 and 100) then
    raise exception using errcode = '22023', message = 'one or more vital-sign values are outside the technical input range';
  end if;

  select client.* into v_client
  from public.clients client
  where client.id = p_client_id
    and client.organization_id = p_expected_organization_id
    and client.branch_id = p_expected_branch_id
  -- Lifecycle transitions update this same row. FOR UPDATE (rather than KEY
  -- SHARE) prevents a concurrent close/death transition from committing after
  -- we read an active state but before the measurement rows are inserted.
  for update;

  if not found
     or not (select private.can_staff_access_client(p_client_id, 'health.write')) then
    raise exception using errcode = '42501', message = 'vital-sign recording is not permitted';
  end if;

  -- Serialize replays before looking for existing rows. The lock key contains
  -- no personal data and is stable only for this organization/actor/set.
  perform pg_advisory_xact_lock(
    hashtextextended(
      v_client.organization_id::text || ':' || v_actor::text || ':' || p_idempotency_key::text,
      0
    )
  );

  v_request_hash := encode(
    sha256(
      convert_to(
        jsonb_build_object(
          'schema_version', 1,
          'organization_id', p_expected_organization_id,
          'branch_id', p_expected_branch_id,
          'client_id', p_client_id,
          'measured_at', to_char(
            p_measured_at at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
          ),
          'values', jsonb_strip_nulls(
            jsonb_build_object(
              'systolic', p_systolic::integer,
              'diastolic', p_diastolic::integer,
              'pulse', p_pulse::integer,
              'temperature', case
                when p_temperature is null then null
                else to_char(p_temperature, 'FM990.0')
              end,
              'oxygen_saturation', p_oxygen_saturation::integer
            )
          )
        )::text,
        'UTF8'
      )
    ),
    'hex'
  );

  select count(*)::integer into v_existing_count
  from public.measurements measurement
  where measurement.organization_id = v_client.organization_id
    and measurement.recorded_by = v_actor
    and measurement.measurement_set_id = p_idempotency_key;

  if v_existing_count > 0 then
    if v_existing_count <> v_expected_count
       or exists (
         select 1
         from public.measurements measurement
         where measurement.organization_id = v_client.organization_id
           and measurement.recorded_by = v_actor
           and measurement.measurement_set_id = p_idempotency_key
           and (
             measurement.client_id <> p_client_id
             or measurement.measured_at <> p_measured_at
             or measurement.request_hash is distinct from v_request_hash
           )
       ) then
      raise exception using errcode = '23505', message = 'vital-sign idempotency conflict';
    end if;

    return query
      select measurement.id, measurement.measurement_kind, true
      from public.measurements measurement
      where measurement.organization_id = v_client.organization_id
        and measurement.recorded_by = v_actor
        and measurement.measurement_set_id = p_idempotency_key
      order by measurement.measurement_kind;
    return;
  end if;

  -- Time and lifecycle gates apply only to a new mutation. An exact retry must
  -- remain observable after 24 hours or a later lifecycle transition, while
  -- still requiring the caller's current permission to this client. Capture
  -- one clock value after every possible lock wait so both bounds use the same
  -- decision instant.
  v_now := clock_timestamp();
  if p_measured_at < v_now - interval '24 hours'
     or p_measured_at > v_now + interval '5 minutes' then
    raise exception using errcode = '22023', message = 'measurement time is outside the allowed 24-hour window';
  end if;

  if v_client.status <> 'active'
     or v_client.admitted_on is null
     or v_client.ended_on is not null
     or (p_measured_at at time zone 'Asia/Taipei')::date < v_client.admitted_on then
    raise exception using errcode = '42501', message = 'vital-sign recording is not permitted';
  end if;

  return query
    with values_to_insert(measurement_kind, numeric_value, unit) as (
      values
        ('blood_pressure_systolic', p_systolic, 'mmHg'),
        ('blood_pressure_diastolic', p_diastolic, 'mmHg'),
        ('pulse', p_pulse, 'bpm'),
        ('temperature', p_temperature, '°C'),
        ('oxygen_saturation', p_oxygen_saturation, '%')
    ), inserted as (
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
      )
      select
        v_client.organization_id,
        v_client.branch_id,
        v_client.id,
        input.measurement_kind,
        p_measured_at,
        input.numeric_value,
        input.unit,
        jsonb_build_object(
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
          input.measurement_kind
        ),
        p_idempotency_key,
        v_request_hash
      from values_to_insert input
      where input.numeric_value is not null
      returning measurements.id, measurements.measurement_kind
    )
    select inserted.id, inserted.measurement_kind, false
    from inserted
    order by inserted.measurement_kind;
end;
$$;

create or replace function public.record_vital_set(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_measured_at timestamptz,
  p_idempotency_key uuid,
  p_systolic numeric default null,
  p_diastolic numeric default null,
  p_pulse numeric default null,
  p_temperature numeric default null,
  p_oxygen_saturation numeric default null
)
returns table(
  id uuid,
  measurement_kind text,
  replayed boolean
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select *
  from private.record_vital_set_atomic(
    p_expected_organization_id,
    p_expected_branch_id,
    p_client_id,
    p_measured_at,
    p_idempotency_key,
    p_systolic,
    p_diastolic,
    p_pulse,
    p_temperature,
    p_oxygen_saturation
  );
$$;

comment on function public.record_vital_set(uuid, uuid, uuid, timestamptz, uuid, numeric, numeric, numeric, numeric, numeric) is
  'Atomically records one tenant-scoped vital-sign set with paired blood pressure, technical ranges, a 24-hour boundary, and actor-scoped replay protection.';

revoke all on function private.measurement_row_idempotency(uuid, uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function private.record_vital_set_atomic(uuid, uuid, uuid, timestamptz, uuid, numeric, numeric, numeric, numeric, numeric)
  from public, anon, authenticated, service_role;
revoke all on function public.record_vital_set(uuid, uuid, uuid, timestamptz, uuid, numeric, numeric, numeric, numeric, numeric)
  from public, anon;

grant execute on function private.record_vital_set_atomic(uuid, uuid, uuid, timestamptz, uuid, numeric, numeric, numeric, numeric, numeric)
  to authenticated;
grant execute on function public.record_vital_set(uuid, uuid, uuid, timestamptz, uuid, numeric, numeric, numeric, numeric, numeric)
  to authenticated;

revoke insert, update on table public.measurements from authenticated;
