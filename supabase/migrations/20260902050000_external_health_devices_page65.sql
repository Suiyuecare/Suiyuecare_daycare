-- Page 65: immutable external-device registry, state ledger, source measurements
-- and controlled client-match corrections. This migration publishes only a
-- service-role database ingestion contract; it does not imply that a provider
-- adapter, heartbeat policy, disconnect detector, or clinical rule is live.

insert into public.permissions (permission_key, description, risk_level) values
  ('external_health_devices.read', 'Read scoped external health devices and measurements', 3),
  ('external_health_devices.manage', 'Append scoped external device and matching state', 3)
on conflict (permission_key) do nothing;

insert into public.role_permissions (role_id, permission_id)
select role.id, permission.id
from public.roles role cross join public.permissions permission
where role.is_system
  and role.role_key in ('organization_manager', 'branch_supervisor')
  and permission.permission_key in (
    'external_health_devices.read', 'external_health_devices.manage'
  )
on conflict (role_id, permission_id) do nothing;

create table public.external_health_devices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  source_provider text not null,
  source_device_id text not null,
  device_code text not null,
  device_type text not null,
  registered_at timestamptz not null,
  identity_hash text not null,
  constraint external_health_device_branch_scope_fkey
    foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete restrict,
  constraint external_health_device_id_scope_key
    unique (id, organization_id, branch_id),
  constraint external_health_device_source_key unique (
    organization_id, branch_id, source_provider, source_device_id
  ),
  constraint external_health_device_text_check check (
    char_length(source_provider) between 1 and 120
    and source_provider = btrim(source_provider)
    and source_provider !~ '[[:cntrl:]]'
    and char_length(source_device_id) between 1 and 240
    and source_device_id = btrim(source_device_id)
    and source_device_id !~ '[[:cntrl:]]'
    and char_length(device_code) between 1 and 120
    and device_code = btrim(device_code)
    and device_code !~ '[[:cntrl:]]'
    and char_length(device_type) between 1 and 120
    and device_type = btrim(device_type)
    and device_type !~ '[[:cntrl:]]'
  ),
  constraint external_health_device_registered_check check (
    isfinite(registered_at)
  ),
  constraint external_health_device_hash_check check (
    identity_hash ~ '^[a-f0-9]{64}$'
  )
);

create table public.external_health_device_state_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  device_id uuid not null,
  state_sequence integer not null,
  previous_state_event_id uuid,
  action text not null,
  operational_status text not null,
  client_id uuid,
  client_display_name text,
  client_code text,
  reason text not null,
  committed_by uuid references auth.users(id) on delete restrict,
  committed_by_display_name text,
  committed_at timestamptz not null,
  content_hash text not null,
  constraint external_health_state_device_scope_fkey foreign key (
    device_id, organization_id, branch_id
  ) references public.external_health_devices(id, organization_id, branch_id)
    on delete restrict,
  constraint external_health_state_client_scope_fkey foreign key (
    client_id, organization_id, branch_id
  ) references public.clients(id, organization_id, branch_id) on delete restrict,
  constraint external_health_state_id_scope_key unique (
    id, organization_id, branch_id, device_id
  ),
  constraint external_health_state_id_branch_scope_key unique (
    id, organization_id, branch_id
  ),
  constraint external_health_state_sequence_key unique (device_id, state_sequence),
  constraint external_health_state_previous_unique unique (previous_state_event_id),
  constraint external_health_state_previous_scope_fkey foreign key (
    previous_state_event_id, organization_id, branch_id, device_id
  ) references public.external_health_device_state_events(
    id, organization_id, branch_id, device_id
  ) on delete restrict,
  constraint external_health_state_sequence_check check (
    state_sequence > 0
    and ((state_sequence = 1 and previous_state_event_id is null
      and action = 'registered')
      or (state_sequence > 1 and previous_state_event_id is not null
        and action in ('assign_device', 'unassign_device',
          'disable_device', 'enable_device')))
  ),
  constraint external_health_state_status_check check (
    operational_status in ('active', 'disabled')
    and ((action = 'registered' and operational_status = 'active')
      or (action = 'disable_device' and operational_status = 'disabled')
      or (action in ('assign_device', 'unassign_device', 'enable_device')
        and operational_status = 'active'))
  ),
  constraint external_health_state_client_check check (
    (client_id is null and client_display_name is null and client_code is null)
    or (client_id is not null
      and char_length(client_display_name) between 1 and 120
      and client_display_name = btrim(client_display_name)
      and client_display_name !~ '[[:cntrl:]]'
      and char_length(client_code) between 1 and 120
      and client_code = btrim(client_code)
      and client_code !~ '[[:cntrl:]]')
  ),
  constraint external_health_state_action_client_check check (
    (action = 'registered' and client_id is null)
    or (action = 'assign_device' and client_id is not null)
    or action in ('unassign_device', 'disable_device', 'enable_device')
  ),
  constraint external_health_state_reason_check check (
    char_length(reason) between 1 and 1000
    and reason = btrim(reason)
    and translate(reason, E'\n\r\t', '') !~ '[[:cntrl:]]'
  ),
  constraint external_health_state_actor_check check (
    (action = 'registered' and committed_by is null
      and committed_by_display_name is null)
    or (action <> 'registered' and committed_by is not null
      and char_length(committed_by_display_name) between 1 and 120
      and committed_by_display_name = btrim(committed_by_display_name)
      and committed_by_display_name !~ '[[:cntrl:]]')
  ),
  constraint external_health_state_time_hash_check check (
    isfinite(committed_at) and content_hash ~ '^[a-f0-9]{64}$'
  )
);

create table public.external_health_measurements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  source_provider text not null,
  source_measurement_id text not null,
  device_id uuid not null,
  metric_code text not null,
  numeric_value numeric(18,6) not null,
  unit text not null,
  measured_at timestamptz not null,
  received_at timestamptz not null,
  source_client_id uuid,
  source_client_display_name text,
  source_client_code text,
  payload_sha256 text not null,
  request_hash text not null,
  ingested_at timestamptz not null,
  constraint external_health_measurement_device_scope_fkey foreign key (
    device_id, organization_id, branch_id
  ) references public.external_health_devices(id, organization_id, branch_id)
    on delete restrict,
  constraint external_health_measurement_client_scope_fkey foreign key (
    source_client_id, organization_id, branch_id
  ) references public.clients(id, organization_id, branch_id) on delete restrict,
  constraint external_health_measurement_id_scope_key unique (
    id, organization_id, branch_id
  ),
  constraint external_health_measurement_source_key unique (
    organization_id, branch_id, source_provider, source_measurement_id
  ),
  constraint external_health_measurement_text_check check (
    char_length(source_provider) between 1 and 120
    and source_provider = btrim(source_provider)
    and source_provider !~ '[[:cntrl:]]'
    and char_length(source_measurement_id) between 1 and 240
    and source_measurement_id = btrim(source_measurement_id)
    and source_measurement_id !~ '[[:cntrl:]]'
    and char_length(metric_code) between 1 and 120
    and metric_code = btrim(metric_code)
    and metric_code !~ '[[:cntrl:]]'
    and char_length(unit) between 1 and 80
    and unit = btrim(unit)
    and unit !~ '[[:cntrl:]]'
  ),
  constraint external_health_measurement_value_check check (
    abs(numeric_value) < 1000000000000
  ),
  constraint external_health_measurement_time_check check (
    isfinite(measured_at) and isfinite(received_at) and isfinite(ingested_at)
    and extract(year from measured_at at time zone 'Asia/Taipei') between 1900 and 2200
    and extract(year from received_at at time zone 'Asia/Taipei') between 1900 and 2200
  ),
  constraint external_health_measurement_client_check check (
    (source_client_id is null and source_client_display_name is null
      and source_client_code is null)
    or (source_client_id is not null
      and char_length(source_client_display_name) between 1 and 120
      and source_client_display_name = btrim(source_client_display_name)
      and source_client_display_name !~ '[[:cntrl:]]'
      and char_length(source_client_code) between 1 and 120
      and source_client_code = btrim(source_client_code)
      and source_client_code !~ '[[:cntrl:]]')
  ),
  constraint external_health_measurement_hash_check check (
    payload_sha256 ~ '^[a-f0-9]{64}$' and request_hash ~ '^[a-f0-9]{64}$'
  )
);

create table public.external_health_measurement_match_corrections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  measurement_id uuid not null,
  correction_sequence integer not null,
  previous_correction_id uuid,
  match_status text not null,
  client_id uuid,
  client_display_name text,
  client_code text,
  reason text not null,
  corrected_by uuid not null references auth.users(id) on delete restrict,
  corrected_by_display_name text not null,
  corrected_at timestamptz not null,
  content_hash text not null,
  constraint external_health_correction_measurement_scope_fkey foreign key (
    measurement_id, organization_id, branch_id
  ) references public.external_health_measurements(id, organization_id, branch_id)
    on delete restrict,
  constraint external_health_correction_client_scope_fkey foreign key (
    client_id, organization_id, branch_id
  ) references public.clients(id, organization_id, branch_id) on delete restrict,
  constraint external_health_correction_id_scope_key unique (
    id, organization_id, branch_id, measurement_id
  ),
  constraint external_health_correction_id_branch_scope_key unique (
    id, organization_id, branch_id
  ),
  constraint external_health_correction_sequence_key unique (
    measurement_id, correction_sequence
  ),
  constraint external_health_correction_previous_unique unique (previous_correction_id),
  constraint external_health_correction_previous_scope_fkey foreign key (
    previous_correction_id, organization_id, branch_id, measurement_id
  ) references public.external_health_measurement_match_corrections(
    id, organization_id, branch_id, measurement_id
  ) on delete restrict,
  constraint external_health_correction_sequence_check check (
    correction_sequence > 0
    and ((correction_sequence = 1 and previous_correction_id is null)
      or (correction_sequence > 1 and previous_correction_id is not null))
  ),
  constraint external_health_correction_match_check check (
    match_status in ('matched', 'unmatched', 'excluded')
    and ((match_status = 'matched' and client_id is not null
      and char_length(client_display_name) between 1 and 120
      and client_display_name = btrim(client_display_name)
      and client_display_name !~ '[[:cntrl:]]'
      and char_length(client_code) between 1 and 120
      and client_code = btrim(client_code)
      and client_code !~ '[[:cntrl:]]')
      or (match_status in ('unmatched', 'excluded') and client_id is null
        and client_display_name is null and client_code is null))
  ),
  constraint external_health_correction_reason_check check (
    char_length(reason) between 1 and 1000 and reason = btrim(reason)
    and translate(reason, E'\n\r\t', '') !~ '[[:cntrl:]]'
  ),
  constraint external_health_correction_actor_check check (
    char_length(corrected_by_display_name) between 1 and 120
    and corrected_by_display_name = btrim(corrected_by_display_name)
    and corrected_by_display_name !~ '[[:cntrl:]]'
    and isfinite(corrected_at)
  ),
  constraint external_health_correction_hash_check check (
    content_hash ~ '^[a-f0-9]{64}$'
  )
);

create table private.external_health_device_state_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  operation_kind text not null,
  idempotency_key uuid not null,
  request_hash text not null,
  result_state_event_id uuid not null,
  created_at timestamptz not null,
  constraint external_health_device_operation_actor_key unique (
    actor_user_id, idempotency_key
  ),
  constraint external_health_device_operation_result_scope_fkey foreign key (
    result_state_event_id, organization_id, branch_id
  ) references public.external_health_device_state_events(
    id, organization_id, branch_id
  ) on delete restrict,
  constraint external_health_device_operation_kind_check check (
    operation_kind in ('assign_device', 'unassign_device',
      'disable_device', 'enable_device')
  ),
  constraint external_health_device_operation_hash_check check (
    request_hash ~ '^[a-f0-9]{64}$' and isfinite(created_at)
  )
);

create table private.external_health_measurement_match_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  idempotency_key uuid not null,
  request_hash text not null,
  result_correction_id uuid not null,
  created_at timestamptz not null,
  constraint external_health_match_operation_actor_key unique (
    actor_user_id, idempotency_key
  ),
  constraint external_health_match_operation_result_scope_fkey foreign key (
    result_correction_id, organization_id, branch_id
  ) references public.external_health_measurement_match_corrections(
    id, organization_id, branch_id
  ) on delete restrict,
  constraint external_health_match_operation_hash_check check (
    request_hash ~ '^[a-f0-9]{64}$' and isfinite(created_at)
  )
);

create index external_health_devices_branch_code_idx
  on public.external_health_devices(organization_id, branch_id, device_code, id);
create index external_health_state_device_latest_idx
  on public.external_health_device_state_events(device_id, state_sequence desc);
create index external_health_state_previous_idx
  on public.external_health_device_state_events(previous_state_event_id)
  where previous_state_event_id is not null;
create index external_health_state_client_idx
  on public.external_health_device_state_events(client_id)
  where client_id is not null;
create index external_health_state_actor_idx
  on public.external_health_device_state_events(committed_by)
  where committed_by is not null;
create index external_health_measurements_branch_time_idx
  on public.external_health_measurements(
    organization_id, branch_id, measured_at desc, received_at desc, id desc
  );
create index external_health_measurements_device_time_idx
  on public.external_health_measurements(device_id, measured_at desc, id desc);
create index external_health_measurements_source_client_idx
  on public.external_health_measurements(source_client_id)
  where source_client_id is not null;
create index external_health_corrections_measurement_idx
  on public.external_health_measurement_match_corrections(
    measurement_id, correction_sequence desc
  );
create index external_health_corrections_previous_idx
  on public.external_health_measurement_match_corrections(previous_correction_id)
  where previous_correction_id is not null;
create index external_health_corrections_client_idx
  on public.external_health_measurement_match_corrections(client_id)
  where client_id is not null;
create index external_health_corrections_actor_idx
  on public.external_health_measurement_match_corrections(corrected_by);
create index external_health_device_operations_result_idx
  on private.external_health_device_state_operations(
    result_state_event_id, organization_id, branch_id
  );
create index external_health_match_operations_result_idx
  on private.external_health_measurement_match_operations(
    result_correction_id, organization_id, branch_id
  );

create or replace function private.external_health_append_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = '23514',
    message = format('%I is append-only', tg_table_name);
end;
$$;

create trigger external_health_devices_append_only before update or delete
on public.external_health_devices for each row
execute function private.external_health_append_only();
create trigger external_health_device_states_append_only before update or delete
on public.external_health_device_state_events for each row
execute function private.external_health_append_only();
create trigger external_health_measurements_append_only before update or delete
on public.external_health_measurements for each row
execute function private.external_health_append_only();
create trigger external_health_corrections_append_only before update or delete
on public.external_health_measurement_match_corrections for each row
execute function private.external_health_append_only();
create trigger external_health_device_operations_append_only before update or delete
on private.external_health_device_state_operations for each row
execute function private.external_health_append_only();
create trigger external_health_match_operations_append_only before update or delete
on private.external_health_measurement_match_operations for each row
execute function private.external_health_append_only();

create trigger external_health_devices_audit_row_change after insert
on public.external_health_devices for each row execute function private.audit_row_change();
create trigger external_health_device_state_events_audit_row_change after insert
on public.external_health_device_state_events for each row execute function private.audit_row_change();
create trigger external_health_measurements_audit_row_change after insert
on public.external_health_measurements for each row execute function private.audit_row_change();
create trigger external_health_measurement_match_corrections_audit_row_change after insert
on public.external_health_measurement_match_corrections for each row
execute function private.audit_row_change();

create or replace function private.external_health_authority(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_permission text,
  p_require_recent_aal2 boolean default false
)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
    and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
    and (not p_require_recent_aal2 or private.has_recent_aal2(15))
    and exists (
      select 1 from public.profiles profile
      where profile.id = auth.uid() and profile.is_active
        and profile.kind in ('staff', 'professional', 'finance')
    )
    and exists (
      select 1 from public.branches branch
      where branch.id = p_expected_branch_id
        and branch.organization_id = p_expected_organization_id
        and branch.is_active
    )
    and private.has_permission(
      p_expected_organization_id, p_expected_branch_id, p_permission
    );
$$;

create or replace function private.external_health_client_authority(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_permission text,
  p_require_current boolean default false
)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.external_health_authority(
      p_expected_organization_id, p_expected_branch_id, p_permission, false
    )
    and exists (
      select 1 from public.clients client
      where client.id = p_client_id
        and client.organization_id = p_expected_organization_id
        and client.branch_id = p_expected_branch_id
        and (not p_require_current or client.status = 'active')
    )
    and private.can_staff_access_client(p_client_id, 'clients.read');
$$;

create or replace function private.ingest_external_health_measurement_guarded(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_source_provider text,
  p_source_device_id text,
  p_device_code text,
  p_device_type text,
  p_source_measurement_id text,
  p_metric_code text,
  p_numeric_value numeric,
  p_unit text,
  p_measured_at timestamptz,
  p_received_at timestamptz,
  p_payload_sha256 text
)
returns table(
  measurement_id uuid,
  device_id uuid,
  replayed boolean,
  deduplicated boolean
)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_provider text := btrim(p_source_provider);
  v_source_device text := btrim(p_source_device_id);
  v_device_code text := btrim(p_device_code);
  v_device_type text := btrim(p_device_type);
  v_source_measurement text := btrim(p_source_measurement_id);
  v_metric text := btrim(p_metric_code);
  v_unit text := btrim(p_unit);
  v_now timestamptz := clock_timestamp();
  v_identity_hash text;
  v_request_hash text;
  v_device public.external_health_devices%rowtype;
  v_measurement public.external_health_measurements%rowtype;
  v_state public.external_health_device_state_events%rowtype;
  v_state_id uuid;
begin
  if p_expected_organization_id is null or p_expected_branch_id is null
     or v_provider is null or char_length(v_provider) not between 1 and 120
     or v_provider ~ '[[:cntrl:]]'
     or v_source_device is null or char_length(v_source_device) not between 1 and 240
     or v_source_device ~ '[[:cntrl:]]'
     or v_device_code is null or char_length(v_device_code) not between 1 and 120
     or v_device_code ~ '[[:cntrl:]]'
     or v_device_type is null or char_length(v_device_type) not between 1 and 120
     or v_device_type ~ '[[:cntrl:]]'
     or v_source_measurement is null
     or char_length(v_source_measurement) not between 1 and 240
     or v_source_measurement ~ '[[:cntrl:]]'
     or v_metric is null or char_length(v_metric) not between 1 and 120
     or v_metric ~ '[[:cntrl:]]'
     or v_unit is null or char_length(v_unit) not between 1 and 80
     or v_unit ~ '[[:cntrl:]]'
     or p_numeric_value is null
     or p_numeric_value::text in ('NaN', 'Infinity', '-Infinity')
     or abs(p_numeric_value) >= 1000000000000 or scale(p_numeric_value) > 6
     or p_measured_at is null or not isfinite(p_measured_at)
     or p_received_at is null or not isfinite(p_received_at)
     or extract(year from p_measured_at at time zone 'Asia/Taipei') not between 1900 and 2200
     or extract(year from p_received_at at time zone 'Asia/Taipei') not between 1900 and 2200
     or p_payload_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023',
      message = 'external health source measurement is invalid';
  end if;
  if not exists (
    select 1 from public.branches branch
    where branch.id = p_expected_branch_id
      and branch.organization_id = p_expected_organization_id
      and branch.is_active
  ) then
    raise exception using errcode = '42501',
      message = 'external health source branch is not active';
  end if;

  v_identity_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version', 1,
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id,
    'source_provider', v_provider,
    'source_device_id', v_source_device,
    'device_code', v_device_code,
    'device_type', v_device_type
  )::text, 'UTF8')), 'hex');
  v_request_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version', 1,
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id,
    'source_provider', v_provider,
    'source_measurement_id', v_source_measurement,
    'source_device_id', v_source_device,
    'device_code', v_device_code,
    'device_type', v_device_type,
    'metric_code', v_metric,
    'numeric_value', p_numeric_value,
    'unit', v_unit,
    'measured_at', p_measured_at,
    'received_at', p_received_at,
    'payload_sha256', p_payload_sha256
  )::text, 'UTF8')), 'hex');

  perform pg_advisory_xact_lock(hashtextextended(
    p_expected_organization_id::text || ':' || p_expected_branch_id::text || ':' ||
    v_provider || ':' || v_source_measurement, 65
  ));
  select * into v_measurement
  from public.external_health_measurements measurement
  where measurement.organization_id = p_expected_organization_id
    and measurement.branch_id = p_expected_branch_id
    and measurement.source_provider = v_provider
    and measurement.source_measurement_id = v_source_measurement;
  if found then
    if v_measurement.request_hash <> v_request_hash then
      raise exception using errcode = '23505',
        message = 'external health source identity conflicts with different content';
    end if;
    return query select v_measurement.id, v_measurement.device_id, true, true;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_expected_organization_id::text || ':' || p_expected_branch_id::text || ':' ||
    v_provider || ':' || v_source_device, 6501
  ));
  select * into v_device
  from public.external_health_devices device
  where device.organization_id = p_expected_organization_id
    and device.branch_id = p_expected_branch_id
    and device.source_provider = v_provider
    and device.source_device_id = v_source_device
  for update;
  if found then
    if v_device.identity_hash <> v_identity_hash then
      raise exception using errcode = '23505',
        message = 'external health device identity conflicts with different metadata';
    end if;
  else
    insert into public.external_health_devices (
      organization_id, branch_id, source_provider, source_device_id,
      device_code, device_type, registered_at, identity_hash
    ) values (
      p_expected_organization_id, p_expected_branch_id, v_provider,
      v_source_device, v_device_code, v_device_type, v_now, v_identity_hash
    ) returning * into v_device;
    insert into public.external_health_device_state_events (
      organization_id, branch_id, device_id, state_sequence,
      previous_state_event_id, action, operational_status,
      client_id, client_display_name, client_code, reason,
      committed_by, committed_by_display_name, committed_at, content_hash
    ) values (
      p_expected_organization_id, p_expected_branch_id, v_device.id, 1,
      null, 'registered', 'active', null, null, null,
      'source device registered', null, null, v_now,
      encode(sha256(convert_to(jsonb_build_object(
        'schema_version', 1, 'device_id', v_device.id,
        'state_sequence', 1, 'action', 'registered',
        'operational_status', 'active', 'committed_at', v_now
      )::text, 'UTF8')), 'hex')
    ) returning id into v_state_id;
  end if;

  select state.* into v_state
  from public.external_health_device_state_events state
  where state.device_id = v_device.id and state.committed_at <= p_measured_at
  order by state.state_sequence desc limit 1;

  insert into public.external_health_measurements (
    organization_id, branch_id, source_provider, source_measurement_id,
    device_id, metric_code, numeric_value, unit, measured_at, received_at,
    source_client_id, source_client_display_name, source_client_code,
    payload_sha256, request_hash, ingested_at
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_provider,
    v_source_measurement, v_device.id, v_metric, p_numeric_value, v_unit,
    p_measured_at, p_received_at,
    case when v_state.id is not null then v_state.client_id else null end,
    case when v_state.id is not null then v_state.client_display_name else null end,
    case when v_state.id is not null then v_state.client_code else null end,
    p_payload_sha256, v_request_hash, v_now
  ) returning * into v_measurement;

  return query select v_measurement.id, v_measurement.device_id, false, false;
end;
$$;

create or replace function private.append_external_health_device_state_guarded(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_device_id uuid,
  p_action text,
  p_expected_state_sequence integer,
  p_client_id uuid,
  p_reason text,
  p_idempotency_key uuid
)
returns table(
  organization_id uuid,
  branch_id uuid,
  operation_id uuid,
  action text,
  device_id uuid,
  state_event_id uuid,
  state_sequence integer,
  operational_status text,
  assigned_client_id uuid,
  committed_at timestamptz,
  replayed boolean
)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_now timestamptz := clock_timestamp();
  v_reason text := btrim(p_reason);
  v_request_hash text;
  v_device public.external_health_devices%rowtype;
  v_previous public.external_health_device_state_events%rowtype;
  v_result public.external_health_device_state_events%rowtype;
  v_operation private.external_health_device_state_operations%rowtype;
  v_client public.clients%rowtype;
  v_status text;
  v_client_id uuid;
  v_client_name text;
  v_client_code text;
begin
  if not private.external_health_authority(
    p_expected_organization_id, p_expected_branch_id,
    'external_health_devices.manage', true
  ) then
    raise exception using errcode = '42501',
      message = 'external health device state is not permitted';
  end if;
  if p_device_id is null or p_idempotency_key is null
     or p_action not in ('assign_device', 'unassign_device',
       'disable_device', 'enable_device')
     or p_expected_state_sequence is null or p_expected_state_sequence < 1
     or v_reason is null or char_length(v_reason) not between 1 and 1000
     or translate(v_reason, E'\n\r\t', '') ~ '[[:cntrl:]]'
     or ((p_action = 'assign_device') <> (p_client_id is not null)) then
    raise exception using errcode = '22023',
      message = 'external health device state input is invalid';
  end if;
  if p_action = 'assign_device' and not private.external_health_client_authority(
    p_expected_organization_id, p_expected_branch_id, p_client_id,
    'external_health_devices.manage', true
  ) then
    raise exception using errcode = '42501',
      message = 'external health device client is outside current scope';
  end if;

  v_request_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version', 1,
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id,
    'device_id', p_device_id,
    'action', p_action,
    'expected_state_sequence', p_expected_state_sequence,
    'client_id', p_client_id,
    'reason', v_reason
  )::text, 'UTF8')), 'hex');

  perform pg_advisory_xact_lock(hashtextextended(
    v_actor::text || ':' || p_idempotency_key::text, 6502
  ));
  select * into v_operation
  from private.external_health_device_state_operations operation
  where operation.actor_user_id = v_actor
    and operation.idempotency_key = p_idempotency_key;
  if found then
    if v_operation.request_hash <> v_request_hash
       or v_operation.organization_id <> p_expected_organization_id
       or v_operation.branch_id <> p_expected_branch_id
       or v_operation.operation_kind <> p_action then
      raise exception using errcode = '23505',
        message = 'external health device operation key conflicts';
    end if;
    select * into strict v_result
    from public.external_health_device_state_events state
    where state.id = v_operation.result_state_event_id
      and state.organization_id = p_expected_organization_id
      and state.branch_id = p_expected_branch_id;
    return query select v_result.organization_id, v_result.branch_id,
      v_operation.id, v_result.action, v_result.device_id, v_result.id,
      v_result.state_sequence, v_result.operational_status,
      v_result.client_id, v_result.committed_at, true;
    return;
  end if;

  select * into v_device from public.external_health_devices device
  where device.id = p_device_id
    and device.organization_id = p_expected_organization_id
    and device.branch_id = p_expected_branch_id for update;
  if not found then
    raise exception using errcode = '42501',
      message = 'external health device is outside current scope';
  end if;
  select * into strict v_previous
  from public.external_health_device_state_events state
  where state.device_id = p_device_id
  order by state.state_sequence desc limit 1 for update;
  if v_previous.state_sequence <> p_expected_state_sequence then
    raise exception using errcode = '40001',
      message = 'external health device state sequence is stale';
  end if;

  if p_action = 'assign_device' then
    if v_previous.operational_status <> 'active'
       or v_previous.client_id is not distinct from p_client_id then
      raise exception using errcode = '23514',
        message = 'external health device assignment is not a valid transition';
    end if;
    select * into strict v_client from public.clients client
    where client.id = p_client_id
      and client.organization_id = p_expected_organization_id
      and client.branch_id = p_expected_branch_id and client.status = 'active'
    for share;
    v_status := 'active'; v_client_id := v_client.id;
    v_client_name := btrim(v_client.display_name);
    v_client_code := btrim(v_client.client_code);
  elsif p_action = 'unassign_device' then
    if v_previous.operational_status <> 'active' or v_previous.client_id is null then
      raise exception using errcode = '23514',
        message = 'external health device unassignment is not a valid transition';
    end if;
    v_status := 'active'; v_client_id := null;
    v_client_name := null; v_client_code := null;
  elsif p_action = 'disable_device' then
    if v_previous.operational_status <> 'active' then
      raise exception using errcode = '23514',
        message = 'external health device is already disabled';
    end if;
    v_status := 'disabled'; v_client_id := v_previous.client_id;
    v_client_name := v_previous.client_display_name;
    v_client_code := v_previous.client_code;
  else
    if v_previous.operational_status <> 'disabled' then
      raise exception using errcode = '23514',
        message = 'external health device is already active';
    end if;
    v_status := 'active'; v_client_id := v_previous.client_id;
    v_client_name := v_previous.client_display_name;
    v_client_code := v_previous.client_code;
  end if;

  select btrim(profile.display_name) into v_actor_name
  from public.profiles profile where profile.id = v_actor and profile.is_active;
  if v_actor_name is null then
    raise exception using errcode = '42501',
      message = 'external health device actor is unavailable';
  end if;
  insert into public.external_health_device_state_events (
    organization_id, branch_id, device_id, state_sequence,
    previous_state_event_id, action, operational_status,
    client_id, client_display_name, client_code, reason,
    committed_by, committed_by_display_name, committed_at, content_hash
  ) values (
    p_expected_organization_id, p_expected_branch_id, p_device_id,
    p_expected_state_sequence + 1, v_previous.id, p_action, v_status,
    v_client_id, v_client_name, v_client_code, v_reason,
    v_actor, v_actor_name, v_now,
    encode(sha256(convert_to(jsonb_build_object(
      'schema_version', 1, 'device_id', p_device_id,
      'state_sequence', p_expected_state_sequence + 1,
      'previous_state_event_id', v_previous.id, 'action', p_action,
      'operational_status', v_status, 'client_id', v_client_id,
      'reason', v_reason, 'committed_by', v_actor, 'committed_at', v_now
    )::text, 'UTF8')), 'hex')
  ) returning * into v_result;

  insert into private.external_health_device_state_operations (
    organization_id, branch_id, actor_user_id, operation_kind,
    idempotency_key, request_hash, result_state_event_id, created_at
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_actor, p_action,
    p_idempotency_key, v_request_hash, v_result.id, v_now
  ) returning * into v_operation;
  if not private.external_health_authority(
    p_expected_organization_id, p_expected_branch_id,
    'external_health_devices.manage', true
  ) then
    raise exception using errcode = '42501',
      message = 'external health device final authorization failed';
  end if;
  return query select v_result.organization_id, v_result.branch_id,
    v_operation.id, v_result.action, v_result.device_id, v_result.id,
    v_result.state_sequence, v_result.operational_status,
    v_result.client_id, v_result.committed_at, false;
end;
$$;

create or replace function private.correct_external_health_measurement_match_guarded(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_measurement_id uuid,
  p_expected_correction_sequence integer,
  p_match_status text,
  p_client_id uuid,
  p_reason text,
  p_idempotency_key uuid
)
returns table(
  organization_id uuid,
  branch_id uuid,
  operation_id uuid,
  action text,
  measurement_id uuid,
  correction_id uuid,
  correction_sequence integer,
  match_status text,
  client_id uuid,
  committed_at timestamptz,
  replayed boolean
)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_now timestamptz := clock_timestamp();
  v_reason text := btrim(p_reason);
  v_request_hash text;
  v_measurement public.external_health_measurements%rowtype;
  v_previous public.external_health_measurement_match_corrections%rowtype;
  v_result public.external_health_measurement_match_corrections%rowtype;
  v_operation private.external_health_measurement_match_operations%rowtype;
  v_client public.clients%rowtype;
begin
  if not private.external_health_authority(
    p_expected_organization_id, p_expected_branch_id,
    'external_health_devices.manage', true
  ) then
    raise exception using errcode = '42501',
      message = 'external health measurement correction is not permitted';
  end if;
  if p_measurement_id is null or p_idempotency_key is null
     or p_expected_correction_sequence is null
     or p_expected_correction_sequence < 0
     or p_match_status not in ('matched', 'unmatched', 'excluded')
     or ((p_match_status = 'matched') <> (p_client_id is not null))
     or v_reason is null or char_length(v_reason) not between 1 and 1000
     or translate(v_reason, E'\n\r\t', '') ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023',
      message = 'external health measurement correction input is invalid';
  end if;
  if p_match_status = 'matched' and not private.external_health_client_authority(
    p_expected_organization_id, p_expected_branch_id, p_client_id,
    'external_health_devices.manage', true
  ) then
    raise exception using errcode = '42501',
      message = 'external health measurement client is outside current scope';
  end if;

  v_request_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version', 1,
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id,
    'measurement_id', p_measurement_id,
    'expected_correction_sequence', p_expected_correction_sequence,
    'match_status', p_match_status, 'client_id', p_client_id,
    'reason', v_reason
  )::text, 'UTF8')), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(
    v_actor::text || ':' || p_idempotency_key::text, 6503
  ));
  select * into v_operation
  from private.external_health_measurement_match_operations operation
  where operation.actor_user_id = v_actor
    and operation.idempotency_key = p_idempotency_key;
  if found then
    if v_operation.request_hash <> v_request_hash
       or v_operation.organization_id <> p_expected_organization_id
       or v_operation.branch_id <> p_expected_branch_id then
      raise exception using errcode = '23505',
        message = 'external health measurement operation key conflicts';
    end if;
    select * into strict v_result
    from public.external_health_measurement_match_corrections correction
    where correction.id = v_operation.result_correction_id
      and correction.organization_id = p_expected_organization_id
      and correction.branch_id = p_expected_branch_id;
    return query select v_result.organization_id, v_result.branch_id,
      v_operation.id, 'correct_measurement_match'::text,
      v_result.measurement_id, v_result.id, v_result.correction_sequence,
      v_result.match_status, v_result.client_id, v_result.corrected_at, true;
    return;
  end if;

  select * into v_measurement from public.external_health_measurements measurement
  where measurement.id = p_measurement_id
    and measurement.organization_id = p_expected_organization_id
    and measurement.branch_id = p_expected_branch_id for update;
  if not found then
    raise exception using errcode = '42501',
      message = 'external health measurement is outside current scope';
  end if;
  select * into v_previous
  from public.external_health_measurement_match_corrections correction
  where correction.measurement_id = p_measurement_id
  order by correction.correction_sequence desc limit 1 for update;
  if coalesce(v_previous.correction_sequence, 0) <> p_expected_correction_sequence then
    raise exception using errcode = '40001',
      message = 'external health measurement correction sequence is stale';
  end if;
  if p_match_status = 'matched' then
    select * into strict v_client from public.clients client
    where client.id = p_client_id
      and client.organization_id = p_expected_organization_id
      and client.branch_id = p_expected_branch_id and client.status = 'active'
    for share;
  end if;
  select btrim(profile.display_name) into v_actor_name
  from public.profiles profile where profile.id = v_actor and profile.is_active;
  if v_actor_name is null then
    raise exception using errcode = '42501',
      message = 'external health measurement actor is unavailable';
  end if;

  insert into public.external_health_measurement_match_corrections (
    organization_id, branch_id, measurement_id, correction_sequence,
    previous_correction_id, match_status, client_id, client_display_name,
    client_code, reason, corrected_by, corrected_by_display_name,
    corrected_at, content_hash
  ) values (
    p_expected_organization_id, p_expected_branch_id, p_measurement_id,
    p_expected_correction_sequence + 1,
    case when p_expected_correction_sequence = 0 then null else v_previous.id end,
    p_match_status,
    case when p_match_status = 'matched' then v_client.id else null end,
    case when p_match_status = 'matched' then btrim(v_client.display_name) else null end,
    case when p_match_status = 'matched' then btrim(v_client.client_code) else null end,
    v_reason, v_actor, v_actor_name, v_now,
    encode(sha256(convert_to(jsonb_build_object(
      'schema_version', 1, 'measurement_id', p_measurement_id,
      'correction_sequence', p_expected_correction_sequence + 1,
      'previous_correction_id', case when p_expected_correction_sequence = 0
        then null else v_previous.id end,
      'match_status', p_match_status, 'client_id', p_client_id,
      'reason', v_reason, 'corrected_by', v_actor, 'corrected_at', v_now
    )::text, 'UTF8')), 'hex')
  ) returning * into v_result;
  insert into private.external_health_measurement_match_operations (
    organization_id, branch_id, actor_user_id, idempotency_key,
    request_hash, result_correction_id, created_at
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_actor,
    p_idempotency_key, v_request_hash, v_result.id, v_now
  ) returning * into v_operation;
  if not private.external_health_authority(
    p_expected_organization_id, p_expected_branch_id,
    'external_health_devices.manage', true
  ) then
    raise exception using errcode = '42501',
      message = 'external health measurement final authorization failed';
  end if;
  return query select v_result.organization_id, v_result.branch_id,
    v_operation.id, 'correct_measurement_match'::text,
    v_result.measurement_id, v_result.id, v_result.correction_sequence,
    v_result.match_status, v_result.client_id, v_result.corrected_at, false;
end;
$$;

create or replace function private.external_health_device_snapshot_response(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_date_from date default null,
  p_date_to date default null,
  p_client_id uuid default null,
  p_device_id uuid default null,
  p_match_status text default 'all',
  p_device_status text default 'all',
  p_metric_code text default null,
  p_interaction text default 'view'
)
returns table(
  organization_id uuid,
  branch_id uuid,
  generated_at timestamptz,
  devices jsonb,
  device_total bigint,
  devices_truncated boolean,
  active_device_total bigint,
  disabled_device_total bigint,
  assigned_device_total bigint,
  measurements jsonb,
  measurement_total bigint,
  measurements_truncated boolean,
  unmatched_measurement_total bigint,
  excluded_measurement_total bigint,
  client_options jsonb,
  client_total bigint,
  clients_truncated boolean,
  metric_options jsonb,
  metric_total bigint,
  metrics_truncated boolean,
  source_deduplication text,
  source_integration_status text,
  connection_policy_status text,
  attachment_pipeline_status text,
  export_status text
)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_metric text := nullif(btrim(p_metric_code), '');
  v_devices jsonb := '[]'::jsonb;
  v_device_total bigint := 0;
  v_active bigint := 0;
  v_disabled bigint := 0;
  v_assigned bigint := 0;
  v_measurements jsonb := '[]'::jsonb;
  v_measurement_total bigint := 0;
  v_unmatched bigint := 0;
  v_excluded bigint := 0;
  v_clients jsonb := '[]'::jsonb;
  v_client_total bigint := 0;
  v_metrics jsonb := '[]'::jsonb;
  v_metric_total bigint := 0;
begin
  if not private.external_health_authority(
    p_expected_organization_id, p_expected_branch_id,
    'external_health_devices.read', false
  ) then
    raise exception using errcode = '42501',
      message = 'external health device snapshot is not permitted';
  end if;
  if (p_date_from is not null and p_date_to is not null and p_date_from > p_date_to)
     or p_match_status not in ('all', 'matched', 'unmatched', 'excluded')
     or p_device_status not in ('all', 'active', 'disabled')
     or p_interaction not in ('view', 'search')
     or (v_metric is not null and (
       char_length(v_metric) > 120 or v_metric ~ '[[:cntrl:]]'
     )) then
    raise exception using errcode = '22023',
      message = 'external health device snapshot filters are invalid';
  end if;
  if p_client_id is not null and not private.external_health_client_authority(
    p_expected_organization_id, p_expected_branch_id, p_client_id,
    'external_health_devices.read', false
  ) then
    raise exception using errcode = '42501',
      message = 'external health snapshot client is outside current scope';
  end if;

  with terminal_devices as (
    select device.*,
      state.state_sequence, state.operational_status, state.client_id,
      state.client_display_name, state.client_code, state.reason,
      state.committed_at as state_changed_at
    from public.external_health_devices device
    join lateral (
      select candidate.*
      from public.external_health_device_state_events candidate
      where candidate.device_id = device.id
      order by candidate.state_sequence desc limit 1
    ) state on true
    where device.organization_id = p_expected_organization_id
      and device.branch_id = p_expected_branch_id
  ), visible_devices as (
    select * from terminal_devices device
    where device.client_id is null
      or private.can_staff_access_client(device.client_id, 'clients.read')
  ), terminal_measurements as (
    select measurement.*,
      device.device_code,
      current_device.operational_status as current_device_status,
      case when correction.id is not null then correction.match_status
        when measurement.source_client_id is null then 'unmatched'
        else 'matched' end as current_match_status,
      case when correction.id is not null then correction.client_id
        else measurement.source_client_id end as current_client_id,
      case when correction.id is not null then correction.client_display_name
        else measurement.source_client_display_name end as current_client_display_name,
      case when correction.id is not null then correction.client_code
        else measurement.source_client_code end as current_client_code,
      coalesce(correction.correction_sequence, 0) as correction_sequence,
      correction.reason as correction_reason,
      correction.corrected_by_display_name,
      correction.corrected_at
    from public.external_health_measurements measurement
    join public.external_health_devices device on device.id = measurement.device_id
    join terminal_devices current_device on current_device.id = measurement.device_id
    left join lateral (
      select candidate.*
      from public.external_health_measurement_match_corrections candidate
      where candidate.measurement_id = measurement.id
      order by candidate.correction_sequence desc limit 1
    ) correction on true
    where measurement.organization_id = p_expected_organization_id
      and measurement.branch_id = p_expected_branch_id
  ), visible_measurements as (
    select * from terminal_measurements measurement
    where measurement.current_client_id is null
      or private.can_staff_access_client(
        measurement.current_client_id, 'clients.read'
      )
  ), device_filtered as (
    select device.*,
      (select max(measurement.received_at) from visible_measurements measurement
        where measurement.device_id = device.id) as last_received_at,
      (select count(*)::bigint from visible_measurements measurement
        where measurement.device_id = device.id) as measurement_count
    from visible_devices device
    where (p_client_id is null or device.client_id = p_client_id)
      and (p_device_id is null or device.id = p_device_id)
      and (p_device_status = 'all'
        or device.operational_status = p_device_status)
  ), measurement_filtered as (
    select * from visible_measurements measurement
    where (p_date_from is null or
        (measurement.measured_at at time zone 'Asia/Taipei')::date >= p_date_from)
      and (p_date_to is null or
        (measurement.measured_at at time zone 'Asia/Taipei')::date <= p_date_to)
      and (p_client_id is null or measurement.current_client_id = p_client_id)
      and (p_device_id is null or measurement.device_id = p_device_id)
      and (p_match_status = 'all'
        or measurement.current_match_status = p_match_status)
      and (p_device_status = 'all'
        or measurement.current_device_status = p_device_status)
      and (v_metric is null or measurement.metric_code = v_metric)
  ), device_stats as (
    select count(*)::bigint as total,
      count(*) filter (where operational_status = 'active')::bigint as active,
      count(*) filter (where operational_status = 'disabled')::bigint as disabled,
      count(*) filter (where client_id is not null)::bigint as assigned
    from device_filtered
  ), measurement_stats as (
    select count(*)::bigint as total,
      count(*) filter (where current_match_status = 'unmatched')::bigint as unmatched,
      count(*) filter (where current_match_status = 'excluded')::bigint as excluded
    from measurement_filtered
  ), device_limited as (
    select * from device_filtered
    order by device_code collate "C", id limit 200
  ), measurement_limited as (
    select * from measurement_filtered
    order by measured_at desc, received_at desc, id desc limit 200
  )
  select
    coalesce((select jsonb_agg(jsonb_build_object(
      'device_id', item.id,
      'source_provider', item.source_provider,
      'source_device_id', item.source_device_id,
      'device_code', item.device_code,
      'device_type', item.device_type,
      'state_sequence', item.state_sequence,
      'operational_status', item.operational_status,
      'assigned_client_id', item.client_id,
      'assigned_client_display_name', item.client_display_name,
      'assigned_client_code', item.client_code,
      'state_reason', item.reason,
      'state_changed_at', item.state_changed_at,
      'last_measurement_received_at', item.last_received_at,
      'measurement_count', item.measurement_count,
      'connection_status', 'not_configured'
    ) order by item.device_code collate "C", item.id) from device_limited item),
      '[]'::jsonb),
    (select total from device_stats),
    (select active from device_stats),
    (select disabled from device_stats),
    (select assigned from device_stats),
    coalesce((select jsonb_agg(jsonb_build_object(
      'measurement_id', item.id,
      'source_provider', item.source_provider,
      'source_measurement_id', item.source_measurement_id,
      'device_id', item.device_id,
      'device_code', item.device_code,
      'metric_code', item.metric_code,
      'numeric_value', trim(trailing '.' from
        trim(trailing '0' from item.numeric_value::text)),
      'unit', item.unit,
      'measured_at', item.measured_at,
      'received_at', item.received_at,
      'match_status', item.current_match_status,
      'client_id', item.current_client_id,
      'client_display_name', item.current_client_display_name,
      'client_code', item.current_client_code,
      'correction_sequence', item.correction_sequence,
      'correction_reason', item.correction_reason,
      'corrected_by_display_name', item.corrected_by_display_name,
      'corrected_at', item.corrected_at
    ) order by item.measured_at desc, item.received_at desc, item.id desc)
      from measurement_limited item), '[]'::jsonb),
    (select total from measurement_stats),
    (select unmatched from measurement_stats),
    (select excluded from measurement_stats)
  into v_devices, v_device_total, v_active, v_disabled, v_assigned,
    v_measurements, v_measurement_total, v_unmatched, v_excluded;

  with candidates as (
    select client.id, btrim(client.display_name) as display_name,
      btrim(client.client_code) as client_code
    from public.clients client
    where client.organization_id = p_expected_organization_id
      and client.branch_id = p_expected_branch_id and client.status = 'active'
      and private.can_staff_access_client(client.id, 'clients.read')
  ), ranked as (
    select *, count(*) over ()::bigint as total from candidates
    order by display_name collate "C", id limit 500
  )
  select coalesce(max(total), 0), coalesce(jsonb_agg(jsonb_build_object(
    'client_id', id, 'display_name', display_name, 'client_code', client_code
  ) order by display_name collate "C", id), '[]'::jsonb)
  into v_client_total, v_clients from ranked;

  with terminal as (
    select measurement.*,
      case when correction.id is not null then correction.client_id
        else measurement.source_client_id end as current_client_id
    from public.external_health_measurements measurement
    left join lateral (
      select candidate.*
      from public.external_health_measurement_match_corrections candidate
      where candidate.measurement_id = measurement.id
      order by candidate.correction_sequence desc limit 1
    ) correction on true
    where measurement.organization_id = p_expected_organization_id
      and measurement.branch_id = p_expected_branch_id
  ), candidates as (
    select metric_code, unit, count(*)::bigint as measurement_count
    from terminal measurement
    where measurement.current_client_id is null
      or private.can_staff_access_client(
        measurement.current_client_id, 'clients.read'
      )
    group by metric_code, unit
  ), ranked as (
    select *, count(*) over ()::bigint as total from candidates
    order by metric_code collate "C", unit collate "C" limit 200
  )
  select coalesce(max(total), 0), coalesce(jsonb_agg(jsonb_build_object(
    'metric_code', metric_code, 'unit', unit,
    'measurement_count', measurement_count
  ) order by metric_code collate "C", unit collate "C"), '[]'::jsonb)
  into v_metric_total, v_metrics from ranked;

  insert into public.audit_events (
    organization_id, branch_id, actor_user_id, action, table_name,
    row_pk, changed_fields, metadata
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_actor,
    'select', 'external_health_device_snapshot', null, '{}'::text[],
    jsonb_build_object(
      'projection', 'page65_external_health_devices_v1',
      'interaction', p_interaction,
      'returned_device_count', jsonb_array_length(v_devices),
      'device_total', v_device_total,
      'returned_measurement_count', jsonb_array_length(v_measurements),
      'measurement_total', v_measurement_total,
      'source_integration_status', 'database_contract_only',
      'connection_policy_status', 'not_configured'
    )
  );
  if not private.external_health_authority(
    p_expected_organization_id, p_expected_branch_id,
    'external_health_devices.read', false
  ) then
    raise exception using errcode = '42501',
      message = 'external health snapshot authority expired after audit';
  end if;
  return query select p_expected_organization_id, p_expected_branch_id, v_now,
    v_devices, v_device_total,
    v_device_total > jsonb_array_length(v_devices),
    v_active, v_disabled, v_assigned,
    v_measurements, v_measurement_total,
    v_measurement_total > jsonb_array_length(v_measurements),
    v_unmatched, v_excluded,
    v_clients, v_client_total, v_client_total > jsonb_array_length(v_clients),
    v_metrics, v_metric_total, v_metric_total > jsonb_array_length(v_metrics),
    'organization_branch_provider_source_measurement_id'::text,
    'database_contract_only'::text, 'not_configured'::text,
    'not_applicable'::text, 'not_configured'::text;
end;
$$;

create or replace function public.ingest_external_health_measurement(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_source_provider text,
  p_source_device_id text,
  p_device_code text,
  p_device_type text,
  p_source_measurement_id text,
  p_metric_code text,
  p_numeric_value numeric,
  p_unit text,
  p_measured_at timestamptz,
  p_received_at timestamptz,
  p_payload_sha256 text
)
returns table(
  measurement_id uuid, device_id uuid, replayed boolean, deduplicated boolean
)
language sql volatile security invoker set search_path = '' as $$
  select * from private.ingest_external_health_measurement_guarded(
    p_expected_organization_id, p_expected_branch_id, p_source_provider,
    p_source_device_id, p_device_code, p_device_type,
    p_source_measurement_id, p_metric_code, p_numeric_value, p_unit,
    p_measured_at, p_received_at, p_payload_sha256
  );
$$;

create or replace function public.append_external_health_device_state(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_device_id uuid,
  p_action text,
  p_expected_state_sequence integer,
  p_client_id uuid,
  p_reason text,
  p_idempotency_key uuid
)
returns table(
  organization_id uuid, branch_id uuid, operation_id uuid, action text,
  device_id uuid, state_event_id uuid, state_sequence integer,
  operational_status text, assigned_client_id uuid,
  committed_at timestamptz, replayed boolean
)
language sql volatile security invoker set search_path = '' as $$
  select * from private.append_external_health_device_state_guarded(
    p_expected_organization_id, p_expected_branch_id, p_device_id, p_action,
    p_expected_state_sequence, p_client_id, p_reason, p_idempotency_key
  );
$$;

create or replace function public.correct_external_health_measurement_match(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_measurement_id uuid,
  p_expected_correction_sequence integer,
  p_match_status text,
  p_client_id uuid,
  p_reason text,
  p_idempotency_key uuid
)
returns table(
  organization_id uuid, branch_id uuid, operation_id uuid, action text,
  measurement_id uuid, correction_id uuid, correction_sequence integer,
  match_status text, client_id uuid, committed_at timestamptz,
  replayed boolean
)
language sql volatile security invoker set search_path = '' as $$
  select * from private.correct_external_health_measurement_match_guarded(
    p_expected_organization_id, p_expected_branch_id, p_measurement_id,
    p_expected_correction_sequence, p_match_status, p_client_id,
    p_reason, p_idempotency_key
  );
$$;

create or replace function public.external_health_device_snapshot(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_date_from date default null,
  p_date_to date default null,
  p_client_id uuid default null,
  p_device_id uuid default null,
  p_match_status text default 'all',
  p_device_status text default 'all',
  p_metric_code text default null,
  p_interaction text default 'view'
)
returns table(
  organization_id uuid, branch_id uuid, generated_at timestamptz,
  devices jsonb, device_total bigint, devices_truncated boolean,
  active_device_total bigint, disabled_device_total bigint,
  assigned_device_total bigint,
  measurements jsonb, measurement_total bigint,
  measurements_truncated boolean, unmatched_measurement_total bigint,
  excluded_measurement_total bigint,
  client_options jsonb, client_total bigint, clients_truncated boolean,
  metric_options jsonb, metric_total bigint, metrics_truncated boolean,
  source_deduplication text, source_integration_status text,
  connection_policy_status text, attachment_pipeline_status text,
  export_status text
)
language sql volatile security invoker set search_path = '' as $$
  select * from private.external_health_device_snapshot_response(
    p_expected_organization_id, p_expected_branch_id, p_date_from, p_date_to,
    p_client_id, p_device_id, p_match_status, p_device_status,
    p_metric_code, p_interaction
  );
$$;

alter table public.external_health_devices enable row level security;
alter table public.external_health_devices force row level security;
alter table public.external_health_device_state_events enable row level security;
alter table public.external_health_device_state_events force row level security;
alter table public.external_health_measurements enable row level security;
alter table public.external_health_measurements force row level security;
alter table public.external_health_measurement_match_corrections enable row level security;
alter table public.external_health_measurement_match_corrections force row level security;
alter table private.external_health_device_state_operations enable row level security;
alter table private.external_health_device_state_operations force row level security;
alter table private.external_health_measurement_match_operations enable row level security;
alter table private.external_health_measurement_match_operations force row level security;

create policy external_health_devices_select on public.external_health_devices
for select to authenticated using (private.external_health_authority(
  organization_id, branch_id, 'external_health_devices.read', false
));
create policy external_health_device_states_select
on public.external_health_device_state_events for select to authenticated
using (private.external_health_authority(
  organization_id, branch_id, 'external_health_devices.read', false
));
create policy external_health_measurements_select on public.external_health_measurements
for select to authenticated using (private.external_health_authority(
  organization_id, branch_id, 'external_health_devices.read', false
));
create policy external_health_corrections_select
on public.external_health_measurement_match_corrections for select to authenticated
using (private.external_health_authority(
  organization_id, branch_id, 'external_health_devices.read', false
));

revoke all on table public.external_health_devices
  from public, anon, authenticated, service_role;
revoke all on table public.external_health_device_state_events
  from public, anon, authenticated, service_role;
revoke all on table public.external_health_measurements
  from public, anon, authenticated, service_role;
revoke all on table public.external_health_measurement_match_corrections
  from public, anon, authenticated, service_role;
revoke all on table private.external_health_device_state_operations
  from public, anon, authenticated, service_role;
revoke all on table private.external_health_measurement_match_operations
  from public, anon, authenticated, service_role;

revoke all on function private.external_health_append_only()
  from public, anon, authenticated, service_role;
revoke all on function private.external_health_authority(uuid,uuid,text,boolean)
  from public, anon, authenticated, service_role;
revoke all on function private.external_health_client_authority(uuid,uuid,uuid,text,boolean)
  from public, anon, authenticated, service_role;
revoke all on function private.ingest_external_health_measurement_guarded(
  uuid,uuid,text,text,text,text,text,text,numeric,text,timestamptz,timestamptz,text
) from public, anon, authenticated, service_role;
revoke all on function private.append_external_health_device_state_guarded(
  uuid,uuid,uuid,text,integer,uuid,text,uuid
) from public, anon, authenticated, service_role;
revoke all on function private.correct_external_health_measurement_match_guarded(
  uuid,uuid,uuid,integer,text,uuid,text,uuid
) from public, anon, authenticated, service_role;
revoke all on function private.external_health_device_snapshot_response(
  uuid,uuid,date,date,uuid,uuid,text,text,text,text
) from public, anon, authenticated, service_role;

revoke all on function public.ingest_external_health_measurement(
  uuid,uuid,text,text,text,text,text,text,numeric,text,timestamptz,timestamptz,text
) from public, anon, authenticated, service_role;
revoke all on function public.append_external_health_device_state(
  uuid,uuid,uuid,text,integer,uuid,text,uuid
) from public, anon, authenticated, service_role;
revoke all on function public.correct_external_health_measurement_match(
  uuid,uuid,uuid,integer,text,uuid,text,uuid
) from public, anon, authenticated, service_role;
revoke all on function public.external_health_device_snapshot(
  uuid,uuid,date,date,uuid,uuid,text,text,text,text
) from public, anon, authenticated, service_role;

grant execute on function public.ingest_external_health_measurement(
  uuid,uuid,text,text,text,text,text,text,numeric,text,timestamptz,timestamptz,text
) to service_role;
grant execute on function private.ingest_external_health_measurement_guarded(
  uuid,uuid,text,text,text,text,text,text,numeric,text,timestamptz,timestamptz,text
) to service_role;
grant execute on function public.append_external_health_device_state(
  uuid,uuid,uuid,text,integer,uuid,text,uuid
) to authenticated;
grant execute on function private.append_external_health_device_state_guarded(
  uuid,uuid,uuid,text,integer,uuid,text,uuid
) to authenticated;
grant execute on function public.correct_external_health_measurement_match(
  uuid,uuid,uuid,integer,text,uuid,text,uuid
) to authenticated;
grant execute on function private.correct_external_health_measurement_match_guarded(
  uuid,uuid,uuid,integer,text,uuid,text,uuid
) to authenticated;
grant execute on function public.external_health_device_snapshot(
  uuid,uuid,date,date,uuid,uuid,text,text,text,text
) to authenticated;
grant execute on function private.external_health_device_snapshot_response(
  uuid,uuid,date,date,uuid,uuid,text,text,text,text
) to authenticated;

comment on table public.external_health_devices is
  'Immutable Page-65 source device identities; metadata changes conflict instead of overwriting.';
comment on table public.external_health_device_state_events is
  'Append-only Page-65 operational and client-assignment states.';
comment on table public.external_health_measurements is
  'Immutable normalized Page-65 measurements with separate source and receipt times.';
comment on table public.external_health_measurement_match_corrections is
  'Append-only controlled client-match corrections; source measurements remain unchanged.';
comment on function public.ingest_external_health_measurement(
  uuid,uuid,text,text,text,text,text,text,numeric,text,timestamptz,timestamptz,text
) is 'Service-role-only Page-65 normalized source contract; no provider adapter or clinical interpretation is implied.';
comment on function public.external_health_device_snapshot(
  uuid,uuid,date,date,uuid,uuid,text,text,text,text
) is 'Returns an audited Page-65 snapshot; connection policy remains not_configured without a governed provider heartbeat.';
