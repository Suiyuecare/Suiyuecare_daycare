-- Page 46: atomic attendance events with actor-scoped exact replay.
--
-- The Data API may read attendance rows through their existing RLS policy, but
-- authenticated callers cannot insert or update the base table directly. The
-- public SECURITY INVOKER wrapper delegates to a tightly validated private
-- SECURITY DEFINER transaction. Its private operation ledger is append-only
-- and preserves the result of check-out independently from the base row's
-- single idempotency key.

create table private.attendance_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  client_id uuid not null,
  attendance_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  event_kind text not null,
  occurred_at timestamptz not null,
  service_date date not null,
  reason text,
  source text not null,
  idempotency_key uuid not null,
  request_hash text not null,
  result_status public.attendance_status not null,
  result_checked_in_at timestamptz,
  result_checked_out_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  constraint attendance_operations_client_scope_fkey
    foreign key (client_id, organization_id, branch_id)
    references public.clients(id, organization_id, branch_id) on delete restrict,
  constraint attendance_operations_record_scope_fkey
    foreign key (attendance_id, organization_id, branch_id, client_id)
    references public.attendance_records(id, organization_id, branch_id, client_id)
    on delete restrict,
  constraint attendance_operations_actor_idempotency_key
    unique (organization_id, actor_user_id, idempotency_key),
  constraint attendance_operations_event_kind_check
    check (event_kind in ('check_in', 'check_out', 'absent', 'leave')),
  constraint attendance_operations_service_date_check
    check (service_date = (occurred_at at time zone 'Asia/Taipei')::date),
  constraint attendance_operations_reason_check
    check (reason is null or char_length(btrim(reason)) between 1 and 1000),
  constraint attendance_operations_source_check
    check (source in ('staff', 'staff_backfill')),
  constraint attendance_operations_backfill_reason_check
    check (source <> 'staff_backfill' or reason is not null),
  constraint attendance_operations_request_hash_check
    check (request_hash ~ '^[a-f0-9]{64}$'),
  constraint attendance_operations_result_time_check
    check (
      result_checked_out_at is null
      or (
        result_checked_in_at is not null
        and result_checked_out_at >= result_checked_in_at
      )
    ),
  constraint attendance_operations_result_mapping_check check (
    (
      event_kind = 'check_in'
      and result_status = 'present'
      and result_checked_in_at = occurred_at
      and result_checked_out_at is null
    )
    or (
      event_kind = 'check_out'
      and result_status = 'present'
      and result_checked_in_at is not null
      and result_checked_out_at = occurred_at
    )
    or (
      event_kind = 'absent'
      and result_status = 'absent'
      and result_checked_in_at is null
      and result_checked_out_at is null
    )
    or (
      event_kind = 'leave'
      and result_status = 'leave'
      and result_checked_in_at is null
      and result_checked_out_at is null
    )
  )
);

comment on table private.attendance_operations is
  'Immutable internal ledger for exact attendance-event replay, including check-out operations.';
comment on column private.attendance_operations.reason is
  'Required when the operation was more than fifteen minutes from server time.';

create index attendance_operations_client_day_idx
  on private.attendance_operations (
    client_id,
    organization_id,
    branch_id,
    service_date,
    created_at desc
  );

create index attendance_operations_attendance_id_idx
  on private.attendance_operations (attendance_id);

alter table private.attendance_operations enable row level security;
alter table private.attendance_operations force row level security;

create or replace function private.prevent_attendance_operation_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception using
    errcode = '55000',
    message = 'attendance operation history is immutable';
end;
$$;

create trigger attendance_operations_prevent_mutation
before update or delete on private.attendance_operations
for each row execute function private.prevent_attendance_operation_mutation();

create trigger attendance_operations_audit_insert
after insert on private.attendance_operations
for each row execute function private.audit_row_change();

create or replace function private.record_attendance_event_atomic(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_event_kind text,
  p_occurred_at timestamptz,
  p_reason text,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid,
  attendance_id uuid,
  service_date date,
  status public.attendance_status,
  checked_in_at timestamptz,
  checked_out_at timestamptz,
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
  v_now timestamptz;
  v_service_date date;
  v_reason text := nullif(btrim(p_reason), '');
  v_is_backfill boolean;
  v_source text;
  v_request_hash text;
  v_client public.clients%rowtype;
  v_attendance public.attendance_records%rowtype;
  v_existing private.attendance_operations%rowtype;
  v_operation private.attendance_operations%rowtype;
begin
  if v_actor is null
     or p_expected_organization_id is null
     or p_expected_branch_id is null
     or p_client_id is null
     or p_event_kind is null
     or p_occurred_at is null
     or p_idempotency_key is null then
    raise exception using
      errcode = '22023',
      message = 'organization, branch, client, event, occurrence, and idempotency key are required';
  end if;

  if p_event_kind not in ('check_in', 'check_out', 'absent', 'leave') then
    raise exception using
      errcode = '22023',
      message = 'unsupported attendance event kind';
  end if;

  if char_length(coalesce(v_reason, '')) > 1000 then
    raise exception using
      errcode = '22023',
      message = 'attendance reason exceeds one thousand characters';
  end if;

  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception using
      errcode = '42501',
      message = 'AAL2 is required for attendance writes';
  end if;

  v_service_date := (p_occurred_at at time zone 'Asia/Taipei')::date;

  -- First serialize an actor's retry token. Calls using the same token but a
  -- different client/day cannot race the unique ledger key.
  perform pg_advisory_xact_lock(
    hashtextextended(
      'attendance-operation:' || v_actor::text || ':' || p_idempotency_key::text,
      0
    )
  );

  select client.*
    into v_client
  from public.clients client
  where client.id = p_client_id
    and client.organization_id = p_expected_organization_id
    and client.branch_id = p_expected_branch_id
  for update;

  if not found
     or not (select private.can_staff_access_client(p_client_id, 'attendance.write')) then
    raise exception using
      errcode = '42501',
      message = 'attendance client scope is not permitted';
  end if;

  -- The client row and this day-specific advisory lock are always acquired in
  -- the same order, keeping duplicate attendance checks race-safe.
  perform pg_advisory_xact_lock(
    hashtextextended(
      'attendance-day:' || p_client_id::text || ':' || v_service_date::text,
      0
    )
  );

  -- Hash only after the actor, client, and service-day lock domains are held.
  -- This keeps conflict and exact-replay resolution inside the same ordering
  -- used by every attendance mutation.
  v_request_hash := encode(
    sha256(
      convert_to(
        jsonb_build_object(
          'schema_version', 1,
          'organization_id', p_expected_organization_id,
          'branch_id', p_expected_branch_id,
          'client_id', p_client_id,
          'event_kind', p_event_kind,
          -- Epoch text is stable across PostgreSQL session TimeZone changes,
          -- so the same instant always produces the same replay hash.
          'occurred_at_epoch', extract(epoch from p_occurred_at)::text,
          'reason', v_reason
        )::text,
        'UTF8'
      )
    ),
    'hex'
  );

  select operation.*
    into v_existing
  from private.attendance_operations operation
  where operation.organization_id = v_client.organization_id
    and operation.actor_user_id = v_actor
    and operation.idempotency_key = p_idempotency_key;

  if found then
    if v_existing.request_hash <> v_request_hash then
      raise exception using
        errcode = '23505',
        message = 'attendance event idempotency conflict';
    end if;

    return query
    select
      v_existing.id,
      v_existing.attendance_id,
      v_existing.service_date,
      v_existing.result_status,
      v_existing.result_checked_in_at,
      v_existing.result_checked_out_at,
      v_existing.source,
      true;
    return;
  end if;

  -- Time-sensitive policy is evaluated only for a genuinely new mutation and
  -- uses a timestamp captured after all lock waits. A committed exact replay
  -- therefore remains observable even after the time/backfill boundary moves.
  v_now := clock_timestamp();
  if p_occurred_at > v_now + interval '5 minutes' then
    raise exception using
      errcode = '22023',
      message = 'attendance event cannot be more than five minutes in the future';
  end if;

  v_is_backfill := v_now - p_occurred_at > interval '15 minutes';
  if v_is_backfill then
    if v_reason is null then
      raise exception using
        errcode = '22023',
        message = 'a non-empty reason is required for attendance backfill';
    end if;
    if not (select private.has_permission(
      v_client.organization_id,
      v_client.branch_id,
      'attendance.correct'
    )) or not (select private.has_recent_aal2(15)) then
      raise exception using
        errcode = '42501',
        message = 'attendance backfill requires correction permission and recent AAL2';
    end if;
    v_source := 'staff_backfill';
  else
    v_source := 'staff';
  end if;

  if v_client.status <> 'active'
     or v_client.admitted_on is null
     or v_client.admitted_on > v_service_date
     or (v_client.ended_on is not null and v_client.ended_on < v_service_date) then
    raise exception using
      errcode = '23514',
      message = 'client is not active, admitted, and unended on the service date';
  end if;

  select attendance.*
    into v_attendance
  from public.attendance_records attendance
  where attendance.client_id = v_client.id
    and attendance.service_date = v_service_date
    and attendance.correction_of_id is null
    and attendance.status <> 'cancelled'
  for update;

  if p_event_kind = 'check_in' then
    if found then
      raise exception using
        errcode = '23514',
        message = 'duplicate attendance exists for the client and service date';
    end if;

    insert into public.attendance_records (
      organization_id,
      branch_id,
      client_id,
      service_date,
      status,
      checked_in_at,
      checked_out_at,
      source,
      correction_reason,
      idempotency_key,
      recorded_by
    ) values (
      v_client.organization_id,
      v_client.branch_id,
      v_client.id,
      v_service_date,
      'present',
      p_occurred_at,
      null,
      v_source,
      case when v_is_backfill then v_reason else null end,
      p_idempotency_key,
      v_actor
    )
    returning * into v_attendance;
  elsif p_event_kind = 'check_out' then
    if not found
       or v_attendance.status <> 'present'
       or v_attendance.checked_in_at is null
       or v_attendance.checked_out_at is not null then
      raise exception using
        errcode = '23514',
        message = 'check-out requires one open present attendance row';
    end if;
    if p_occurred_at < v_attendance.checked_in_at then
      raise exception using
        errcode = '23514',
        message = 'check-out cannot precede check-in';
    end if;

    update public.attendance_records attendance
    set
      checked_out_at = p_occurred_at,
      source = case
        when v_source = 'staff_backfill' then 'staff_backfill'
        else attendance.source
      end,
      correction_reason = coalesce(
        attendance.correction_reason,
        case when v_is_backfill then v_reason else null end
      )
    where attendance.id = v_attendance.id
      and attendance.checked_out_at is null
    returning * into v_attendance;

    if not found then
      raise exception using
        errcode = '40001',
        message = 'attendance check-out compare-and-swap failed';
    end if;
  else
    if found then
      raise exception using
        errcode = '23514',
        message = 'duplicate attendance exists for the client and service date';
    end if;

    insert into public.attendance_records (
      organization_id,
      branch_id,
      client_id,
      service_date,
      status,
      checked_in_at,
      checked_out_at,
      source,
      correction_reason,
      idempotency_key,
      recorded_by
    ) values (
      v_client.organization_id,
      v_client.branch_id,
      v_client.id,
      v_service_date,
      p_event_kind::public.attendance_status,
      null,
      null,
      v_source,
      case when v_is_backfill then v_reason else null end,
      p_idempotency_key,
      v_actor
    )
    returning * into v_attendance;
  end if;

  insert into private.attendance_operations (
    organization_id,
    branch_id,
    client_id,
    attendance_id,
    actor_user_id,
    event_kind,
    occurred_at,
    service_date,
    reason,
    source,
    idempotency_key,
    request_hash,
    result_status,
    result_checked_in_at,
    result_checked_out_at
  ) values (
    v_client.organization_id,
    v_client.branch_id,
    v_client.id,
    v_attendance.id,
    v_actor,
    p_event_kind,
    p_occurred_at,
    v_service_date,
    v_reason,
    v_source,
    p_idempotency_key,
    v_request_hash,
    v_attendance.status,
    v_attendance.checked_in_at,
    v_attendance.checked_out_at
  )
  returning * into v_operation;

  return query
  select
    v_operation.id,
    v_operation.attendance_id,
    v_operation.service_date,
    v_operation.result_status,
    v_operation.result_checked_in_at,
    v_operation.result_checked_out_at,
    v_operation.source,
    false;
end;
$$;

create or replace function public.record_attendance_event(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_event_kind text,
  p_occurred_at timestamptz,
  p_reason text,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid,
  attendance_id uuid,
  service_date date,
  status public.attendance_status,
  checked_in_at timestamptz,
  checked_out_at timestamptz,
  source text,
  replayed boolean
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select *
  from private.record_attendance_event_atomic(
    p_expected_organization_id,
    p_expected_branch_id,
    p_client_id,
    p_event_kind,
    p_occurred_at,
    p_reason,
    p_idempotency_key
  );
$$;

comment on function public.record_attendance_event(
  uuid,
  uuid,
  uuid,
  text,
  timestamptz,
  text,
  uuid
) is
  'Records one authorized attendance event with Taipei service-date derivation, exact replay, lifecycle gates, and controlled backfill.';

revoke all on table private.attendance_operations
  from public, anon, authenticated, service_role;
revoke all on function private.prevent_attendance_operation_mutation()
  from public, anon, authenticated, service_role;
revoke all on function private.record_attendance_event_atomic(
  uuid,
  uuid,
  uuid,
  text,
  timestamptz,
  text,
  uuid
) from public, anon, authenticated, service_role;
revoke all on function public.record_attendance_event(
  uuid,
  uuid,
  uuid,
  text,
  timestamptz,
  text,
  uuid
) from public, anon, authenticated, service_role;

-- The public invoker wrapper needs EXECUTE on the private definer. The private
-- schema is not exposed by PostgREST, and the definer performs the complete
-- actor, AAL, scope, lifecycle, replay, and backfill validation itself.
grant execute on function private.record_attendance_event_atomic(
  uuid,
  uuid,
  uuid,
  text,
  timestamptz,
  text,
  uuid
) to authenticated;
grant execute on function public.record_attendance_event(
  uuid,
  uuid,
  uuid,
  text,
  timestamptz,
  text,
  uuid
) to authenticated;

revoke insert, update, delete on table public.attendance_records
  from authenticated;
