begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Device assignments and measurement matches create operational associations.
-- An active master card alone is insufficient: admission must cover the
-- effective measurement day. Lock the client row against lifecycle updates.
create function private.external_health_client_eligible_locked(
  p_organization_id uuid,p_branch_id uuid,p_client_id uuid,p_service_date date
) returns boolean language plpgsql volatile security definer set search_path='' as $$
declare v_client_id uuid;
begin
  if p_organization_id is null or p_branch_id is null or p_client_id is null
    or p_service_date is null or not isfinite(p_service_date)
    or p_service_date<date '2000-01-01' or p_service_date>date '2100-01-01' then
    return false;
  end if;
  select client.id into v_client_id from public.clients client
  where client.id=p_client_id and client.organization_id=p_organization_id
    and client.branch_id=p_branch_id for share;
  if not found then return false; end if;
  return private.client_service_state_on(v_client_id,p_service_date)='eligible';
end;
$$;

create function private.guard_external_health_device_service_day()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  -- Disabled and unassigned states remain available to safely disconnect a
  -- device whose former client is no longer eligible.
  if new.client_id is not null and new.operational_status='active'
    and not private.external_health_client_eligible_locked(
      new.organization_id,new.branch_id,new.client_id,
      (new.committed_at at time zone 'Asia/Taipei')::date) then
    raise exception using errcode='23514',
      message='external health device client is not service eligible';
  end if;
  return new;
end;
$$;
create trigger external_health_device_service_day_guard
before insert on public.external_health_device_state_events for each row
execute function private.guard_external_health_device_service_day();

create function private.guard_external_health_measurement_match_day()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_measured_at timestamptz;
begin
  if new.match_status<>'matched' then return new; end if;
  select measurement.measured_at into v_measured_at
  from public.external_health_measurements measurement
  where measurement.id=new.measurement_id
    and measurement.organization_id=new.organization_id
    and measurement.branch_id=new.branch_id for share;
  if not found or not private.external_health_client_eligible_locked(
    new.organization_id,new.branch_id,new.client_id,
    (v_measured_at at time zone 'Asia/Taipei')::date) then
    raise exception using errcode='23514',
      message='external health measurement client is not service eligible';
  end if;
  return new;
end;
$$;
create trigger external_health_measurement_match_day_guard
before insert on public.external_health_measurement_match_corrections for each row
execute function private.guard_external_health_measurement_match_day();

create function private.unmatch_external_health_ineligible_source()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.source_client_id is not null and not private.external_health_client_eligible_locked(
    new.organization_id,new.branch_id,new.source_client_id,
    (new.measured_at at time zone 'Asia/Taipei')::date) then
    -- Keep the raw device measurement; only the derived client association is
    -- withheld. Existing immutable rows and historical corrections are intact.
    new.source_client_id:=null;
    new.source_client_display_name:=null;
    new.source_client_code:=null;
  end if;
  return new;
end;
$$;
create trigger external_health_measurement_service_day_guard
before insert on public.external_health_measurements for each row
execute function private.unmatch_external_health_ineligible_source();

revoke all on function private.external_health_client_eligible_locked(uuid,uuid,uuid,date),
  private.guard_external_health_device_service_day(),
  private.guard_external_health_measurement_match_day(),
  private.unmatch_external_health_ineligible_source()
  from public,anon,authenticated,service_role;

comment on function private.external_health_client_eligible_locked(uuid,uuid,uuid,date) is
  'Effective-day IoT association eligibility; does not change admission or historical measurements.';
commit;
