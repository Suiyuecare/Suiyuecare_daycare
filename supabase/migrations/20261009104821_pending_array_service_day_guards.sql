begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- The public client status is not sufficient evidence of service eligibility:
-- an active shell with no admission date is still pending. Lock each client in
-- a stable order so a concurrent lifecycle change cannot race a formal write.
create function private.assert_client_ids_service_day_locked(
  p_organization_id uuid,
  p_branch_id uuid,
  p_service_date date,
  p_client_ids uuid[]
) returns void language plpgsql volatile security definer set search_path = '' as $$
declare v_client_id uuid;
begin
  if p_organization_id is null or p_branch_id is null
    or p_service_date is null or not isfinite(p_service_date)
    or p_service_date < date '2000-01-01' or p_service_date > date '2100-01-01'
    or p_client_ids is null or cardinality(p_client_ids) > 500
    or array_position(p_client_ids, null::uuid) is not null
    or cardinality(p_client_ids) <> (
      select count(distinct picked.client_id)
      from unnest(p_client_ids) picked(client_id)
    ) then
    raise exception using errcode = '23514',
      message = 'client list is not valid for formal service';
  end if;

  for v_client_id in
    select picked.client_id from unnest(p_client_ids) picked(client_id)
    order by picked.client_id
  loop
    perform 1 from public.clients client
    where client.id = v_client_id
      and client.organization_id = p_organization_id
      and client.branch_id = p_branch_id
    for share;
    if not found
      or private.client_service_state_on(v_client_id, p_service_date) <> 'eligible' then
      raise exception using errcode = '23514',
        message = 'client is not admitted for formal service day';
    end if;
  end loop;
end;
$$;

create function private.guard_activity_participants_service_day()
returns trigger language plpgsql volatile security definer set search_path = '' as $$
begin
  if jsonb_typeof(new.participants) is distinct from 'array' then
    raise exception using errcode = '23514',
      message = 'activity participants must be an array';
  end if;
  perform private.assert_client_ids_service_day_locked(
    new.organization_id, new.branch_id,
    (new.starts_at at time zone 'Asia/Taipei')::date,
    private.activity_participant_ids(new.participants)
  );
  return new;
end;
$$;
create trigger activity_participants_service_day_guard
before insert on public.activity_schedule_versions for each row
execute function private.guard_activity_participants_service_day();

create function private.guard_meal_attendees_service_day()
returns trigger language plpgsql volatile security definer set search_path = '' as $$
declare v_snapshot_ids uuid[];
begin
  if jsonb_typeof(new.assignment_snapshot) is distinct from 'array'
    or exists (
      select 1 from jsonb_array_elements(new.assignment_snapshot) assignment(value)
      where jsonb_typeof(assignment.value) is distinct from 'object'
        or coalesce(assignment.value->>'client_id','') !~*
          '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ) then
    raise exception using errcode = '23514',
      message = 'meal assignment does not match the attendee list';
  end if;
  select coalesce(array_agg((assignment.value->>'client_id')::uuid
    order by (assignment.value->>'client_id')::uuid),'{}'::uuid[])
    into v_snapshot_ids
  from jsonb_array_elements(new.assignment_snapshot) assignment(value);
  if v_snapshot_ids is distinct from coalesce((
    select array_agg(attendee.client_id order by attendee.client_id)
    from unnest(new.attendance_client_ids) attendee(client_id)
  ),'{}'::uuid[]) then
    raise exception using errcode = '23514',
      message = 'meal assignment does not match the attendee list';
  end if;
  perform private.assert_client_ids_service_day_locked(
    new.organization_id, new.branch_id, new.service_date,
    new.attendance_client_ids
  );
  return new;
end;
$$;
create trigger meal_attendees_service_day_guard
before insert on public.meal_plan_versions for each row
execute function private.guard_meal_attendees_service_day();

create function private.guard_selected_calendar_clients_service_day()
returns trigger language plpgsql volatile security definer set search_path = '' as $$
declare v_snapshot_ids uuid[];
begin
  -- A branch-wide non-client-specific event has no selected-client array.
  if new.audience_kind = 'all_branch_clients' then
    if jsonb_typeof(new.audience_snapshot) is distinct from 'array'
      or jsonb_array_length(new.audience_snapshot) <> 1
      or new.audience_snapshot->0->>'target_kind' is distinct from 'branch'
      or new.audience_snapshot->0->>'target_id' is distinct from new.branch_id::text then
      raise exception using errcode = '23514',
        message = 'branch-wide calendar audience must contain only its branch marker';
    end if;
  elsif new.audience_kind = 'selected_clients' then
    if jsonb_typeof(new.audience_snapshot) is distinct from 'array'
      or exists (
        select 1 from jsonb_array_elements(new.audience_snapshot) audience(value)
        where jsonb_typeof(audience.value) is distinct from 'object'
          or audience.value->>'target_kind' is distinct from 'client'
          or coalesce(audience.value->>'target_id','') !~*
            '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      ) then
      raise exception using errcode = '23514',
        message = 'calendar audience does not match the selected clients';
    end if;
    select coalesce(array_agg((audience.value->>'target_id')::uuid
      order by (audience.value->>'target_id')::uuid),'{}'::uuid[])
      into v_snapshot_ids
    from jsonb_array_elements(new.audience_snapshot) audience(value);
    if v_snapshot_ids is distinct from coalesce((
      select array_agg(selected.client_id order by selected.client_id)
      from unnest(new.target_client_ids) selected(client_id)
    ),'{}'::uuid[]) then
      raise exception using errcode = '23514',
        message = 'calendar audience does not match the selected clients';
    end if;
    perform private.assert_client_ids_service_day_locked(
      new.organization_id, new.branch_id,
      (new.starts_at at time zone 'Asia/Taipei')::date,
      new.target_client_ids
    );
  end if;
  return new;
end;
$$;
create trigger selected_calendar_clients_service_day_guard
before insert on public.reassurance_calendar_event_versions for each row
execute function private.guard_selected_calendar_clients_service_day();

create function private.guard_document_print_client_service_day()
returns trigger language plpgsql volatile security definer set search_path = '' as $$
begin
  perform private.assert_client_ids_service_day_locked(
    new.organization_id, new.branch_id, new.document_date,
    array[new.client_id]
  );
  return new;
end;
$$;
create trigger document_print_client_service_day_guard
before insert on public.document_print_jobs for each row
execute function private.guard_document_print_client_service_day();

revoke all on function private.assert_client_ids_service_day_locked(uuid,uuid,date,uuid[])
  from public, anon, authenticated, service_role;
revoke all on function private.guard_activity_participants_service_day(),
  private.guard_meal_attendees_service_day(),
  private.guard_selected_calendar_clients_service_day(),
  private.guard_document_print_client_service_day()
  from public, anon, authenticated, service_role;

comment on function private.assert_client_ids_service_day_locked(uuid,uuid,date,uuid[]) is
  'Internal service-day guard for formal rows with UUID participant lists; pending or unadmitted clients are denied.';
commit;
