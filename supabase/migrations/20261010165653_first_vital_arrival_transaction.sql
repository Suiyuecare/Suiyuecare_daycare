-- An explicit, online "measure now and check in" action for one admitted case.
-- Historical/imported/device measurements never create attendance implicitly.
-- Both existing validated writers run in this single PostgREST transaction;
-- an error in either writer rolls back attendance, measurements and this link.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table private.vital_arrival_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  client_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  idempotency_key uuid not null,
  measured_at timestamptz not null,
  service_date date not null,
  attendance_operation_id uuid not null unique references private.attendance_operations(id) on delete restrict,
  attendance_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint vital_arrival_client_scope_fkey foreign key (client_id, organization_id, branch_id)
    references public.clients(id, organization_id, branch_id) on delete restrict,
  constraint vital_arrival_attendance_scope_fkey foreign key (attendance_id, organization_id, branch_id, client_id)
    references public.attendance_records(id, organization_id, branch_id, client_id) on delete restrict,
  constraint vital_arrival_actor_key unique (organization_id, actor_user_id, idempotency_key),
  constraint vital_arrival_service_date_check check (service_date = (measured_at at time zone 'Asia/Taipei')::date)
);
create index vital_arrival_client_day_idx on private.vital_arrival_operations(client_id, service_date);
create index vital_arrival_branch_idx on private.vital_arrival_operations(branch_id);
create index vital_arrival_attendance_idx on private.vital_arrival_operations(attendance_id);
alter table private.vital_arrival_operations enable row level security;
alter table private.vital_arrival_operations force row level security;
revoke all on table private.vital_arrival_operations from public, anon, authenticated, service_role;

create function private.prevent_vital_arrival_mutation() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  raise exception using errcode='55000', message='vital arrival history is immutable';
end;
$$;
create trigger vital_arrival_prevent_mutation before update or delete on private.vital_arrival_operations
for each row execute function private.prevent_vital_arrival_mutation();
create trigger vital_arrival_audit_insert after insert on private.vital_arrival_operations
for each row execute function private.audit_row_change();

create function private.record_first_vital_arrival_atomic(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_idempotency_key uuid,
  p_systolic numeric default null,
  p_diastolic numeric default null,
  p_pulse numeric default null,
  p_temperature numeric default null,
  p_oxygen_saturation numeric default null,
  p_expected_service_date date default null
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
  v_actor uuid := auth.uid();
  v_client public.clients%rowtype;
  v_link private.vital_arrival_operations%rowtype;
  v_attendance record;
  v_measured_at timestamptz;
  v_service_date date;
  v_measurements jsonb;
  v_measurement_replays boolean;
  v_new_operation boolean;
  v_shift text;
begin
  if v_actor is null or p_expected_organization_id is null or p_expected_branch_id is null
    or p_client_id is null or p_idempotency_key is null then
    raise exception using errcode='22023', message='organization, branch, client and idempotency key are required';
  end if;

  -- Match the attendance writer's token -> client -> service-day lock order.
  -- A concurrent standalone vital writer locks the client before its own set
  -- token, so it cannot hold a resource this operation waits for after client.
  perform pg_advisory_xact_lock(hashtextextended(
    'attendance-operation:' || v_actor::text || ':' || p_idempotency_key::text, 0));
  select client.* into v_client from public.clients client
  where client.id=p_client_id and client.organization_id=p_expected_organization_id
    and client.branch_id=p_expected_branch_id for update;
  if not found or not (
      (private.can_staff_access_client(p_client_id,'health.write')
       or private.can_routine_staff_access_client(p_client_id,'health.write'))
      and (private.can_staff_access_client(p_client_id,'attendance.write')
       or private.can_routine_staff_access_client(p_client_id,'attendance.write'))
    ) then
    raise exception using errcode='42501', message='vital arrival client scope is not permitted';
  end if;

  select operation.* into v_link from private.vital_arrival_operations operation
  where operation.organization_id=v_client.organization_id
    and operation.actor_user_id=v_actor and operation.idempotency_key=p_idempotency_key;
  v_new_operation := not found;
  if v_new_operation then
    -- This is an immediate observation only. No editable/backdated timestamp is
    -- accepted; the same server instant becomes measurement and arrival time.
    v_measured_at := clock_timestamp();
    v_service_date := (v_measured_at at time zone 'Asia/Taipei')::date;
    if p_expected_service_date is not null and p_expected_service_date<>v_service_date then
      raise exception using errcode='23514', message='arrival service date changed; refresh today work';
    end if;
    if private.client_service_state_on(v_client.id,v_service_date) is distinct from 'eligible' then
      raise exception using errcode='23514', message='client is not active and admitted today';
    end if;
    -- The first measurement is proof of an actual arrival only for the
    -- employee allocated to this client's current Taipei shift. A durable
    -- client assignment alone is not today's schedule; a cancelled or newer
    -- reassigned slot cannot create official attendance. Off-roster arrivals
    -- need a director-reviewed workflow, never a guessed check-in.
    v_shift := case when extract(hour from v_measured_at at time zone 'Asia/Taipei') < 12
      then 'morning' else 'afternoon' end;
    -- Serialize with save_care_roster's client/day/shift version lock before
    -- deciding who may create attendance.  The client row lock alone does not
    -- protect this append-only roster: its writer uses only this advisory key.
    -- A cancellation/reassignment that commits first must win the latest-slot
    -- check below, leaving no attendance or vital from the old staff member.
    perform pg_advisory_xact_lock(hashtextextended(
      v_client.id::text || v_service_date::text || v_shift, 0));
    if not exists (
      select 1 from private.care_roster_versions roster
      where roster.organization_id=v_client.organization_id
        and roster.branch_id=v_client.branch_id and roster.client_id=v_client.id
        and roster.service_date=v_service_date and roster.shift=v_shift
        and roster.state='scheduled' and roster.staff_user_id=v_actor
        and roster.version=(
          select max(latest.version) from private.care_roster_versions latest
          where latest.client_id=roster.client_id and latest.service_date=roster.service_date
            and latest.shift=roster.shift
        )
    ) then
      raise exception using errcode='23514', message='current care roster does not authorize arrival';
    end if;
    if exists (select 1 from public.attendance_records a where a.client_id=v_client.id
      and a.service_date=v_service_date and a.correction_of_id is null and a.status<>'cancelled') then
      raise exception using errcode='23514', message='attendance already exists; save measurements separately';
    end if;
    if exists (select 1 from public.measurements m where m.organization_id=v_client.organization_id
      and m.recorded_by=v_actor and m.measurement_set_id=p_idempotency_key) then
      raise exception using errcode='23505', message='vital set key was already used outside arrival';
    end if;
    if exists (select 1 from public.measurements m where m.client_id=v_client.id
      and m.measurement_kind in ('blood_pressure_systolic','blood_pressure_diastolic','pulse','temperature','oxygen_saturation')
      and m.numeric_value is not null
      and m.measured_at >= (v_service_date::timestamp at time zone 'Asia/Taipei')
      and m.measured_at < ((v_service_date+1)::timestamp at time zone 'Asia/Taipei')) then
      raise exception using errcode='23514', message='a first vital measurement already exists today';
    end if;
  else
    if v_link.client_id<>p_client_id or v_link.branch_id<>p_expected_branch_id then
      raise exception using errcode='23505', message='vital arrival idempotency conflict';
    end if;
    v_measured_at := v_link.measured_at;
    v_service_date := v_link.service_date;
  end if;

  select * into v_attendance from private.record_attendance_event_atomic(
    p_expected_organization_id,p_expected_branch_id,p_client_id,'check_in',v_measured_at,null,p_idempotency_key);
  select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'measurement_kind',m.measurement_kind)
    order by m.measurement_kind),'[]'::jsonb), bool_and(m.replayed)
  into v_measurements,v_measurement_replays
  from private.record_vital_set_atomic(
    p_expected_organization_id,p_expected_branch_id,p_client_id,v_measured_at,p_idempotency_key,
    p_systolic,p_diastolic,p_pulse,p_temperature,p_oxygen_saturation) m;
  if v_attendance.operation_id is null or jsonb_array_length(v_measurements)=0
    or v_attendance.replayed is distinct from not v_new_operation
    or v_measurement_replays is distinct from not v_new_operation then
    raise exception using errcode='40001', message='vital arrival transaction state changed';
  end if;

  if v_new_operation then
    insert into private.vital_arrival_operations(organization_id,branch_id,client_id,actor_user_id,
      idempotency_key,measured_at,service_date,attendance_operation_id,attendance_id)
    values(v_client.organization_id,v_client.branch_id,v_client.id,v_actor,p_idempotency_key,
      v_measured_at,v_service_date,v_attendance.operation_id,v_attendance.attendance_id);
  elsif v_link.attendance_operation_id<>v_attendance.operation_id
    or v_link.attendance_id<>v_attendance.attendance_id then
    raise exception using errcode='40001', message='vital arrival link changed';
  end if;

  return jsonb_build_object(
    'attendance_operation_id',v_attendance.operation_id,
    'attendance_id',v_attendance.attendance_id,
    'service_date',v_service_date,
    'checked_in_at',v_attendance.checked_in_at,
    'measured_at',v_measured_at,
    'measurement_kinds',(select jsonb_agg(item->>'measurement_kind' order by item->>'measurement_kind')
      from jsonb_array_elements(v_measurements) item),
    'record_count',jsonb_array_length(v_measurements),
    'replayed',not v_new_operation
  );
end;
$$;

create function public.record_first_vital_arrival(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_idempotency_key uuid,
  p_systolic numeric default null,
  p_diastolic numeric default null,
  p_pulse numeric default null,
  p_temperature numeric default null,
  p_oxygen_saturation numeric default null,
  p_expected_service_date date default null
) returns jsonb language sql volatile security invoker set search_path='' as $$
  select private.record_first_vital_arrival_atomic(
    p_expected_organization_id,p_expected_branch_id,p_client_id,p_idempotency_key,
    p_systolic,p_diastolic,p_pulse,p_temperature,p_oxygen_saturation,p_expected_service_date);
$$;
comment on function public.record_first_vital_arrival(uuid,uuid,uuid,uuid,numeric,numeric,numeric,numeric,numeric,date) is
  'Explicit immediate first-vital plus case check-in, sharing server time and a single atomic transaction. No retrospective or device check-in.';

revoke all on function private.prevent_vital_arrival_mutation() from public,anon,authenticated,service_role;
revoke all on function private.record_first_vital_arrival_atomic(uuid,uuid,uuid,uuid,numeric,numeric,numeric,numeric,numeric,date)
  from public,anon,authenticated,service_role;
revoke all on function public.record_first_vital_arrival(uuid,uuid,uuid,uuid,numeric,numeric,numeric,numeric,numeric,date)
  from public,anon,authenticated,service_role;
grant execute on function private.record_first_vital_arrival_atomic(uuid,uuid,uuid,uuid,numeric,numeric,numeric,numeric,numeric,date)
  to authenticated;
grant execute on function public.record_first_vital_arrival(uuid,uuid,uuid,uuid,numeric,numeric,numeric,numeric,numeric,date)
  to authenticated;

commit;
