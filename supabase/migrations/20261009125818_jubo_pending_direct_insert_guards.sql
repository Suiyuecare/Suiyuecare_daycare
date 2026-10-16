-- Owner/direct-DML backstops for pending JUBO master shells. The application
-- RPCs already reject these rows, but an owner/import path must not create a
-- care allocation or even a draft transport passenger snapshot for them.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create function private.reject_pending_jubo_care_roster_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (
    select 1 from public.clients client
    where client.id = new.client_id
      and client.organization_id = new.organization_id
      and client.branch_id = new.branch_id
      and client.source_system = 'jubo'
      and client.status = 'pending'
  ) then
    raise exception using errcode = '23514',
      message = 'JUBO_PENDING_CLIENT_OPERATION_DENIED';
  end if;
  return new;
end;
$$;

create trigger jubo_pending_care_roster_no_insert
before insert on private.care_roster_versions
for each row execute function private.reject_pending_jubo_care_roster_insert();

create function private.reject_pending_jubo_transport_plan_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Let the existing snapshot constraint validate malformed JSON. A valid
  -- passenger UUID, however, must never identify a pending JUBO shell.
  if jsonb_typeof(new.passenger_snapshot) is distinct from 'array' then
    return new;
  end if;
  if exists (
    select 1
    from jsonb_array_elements(new.passenger_snapshot) passenger(value)
    join public.clients client on client.id = case
      when coalesce(passenger.value->>'client_id', '') ~*
        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then (passenger.value->>'client_id')::uuid
      else null::uuid end
    where client.organization_id = new.organization_id
      and client.branch_id = new.branch_id
      and client.source_system = 'jubo'
      and client.status = 'pending'
  ) then
    raise exception using errcode = '23514',
      message = 'JUBO_PENDING_CLIENT_OPERATION_DENIED';
  end if;
  return new;
end;
$$;

create trigger jubo_pending_transport_plan_no_insert
before insert on public.transport_trip_plan_versions
for each row execute function private.reject_pending_jubo_transport_plan_insert();

revoke all on function private.reject_pending_jubo_care_roster_insert()
  from public, anon, authenticated, service_role;
revoke all on function private.reject_pending_jubo_transport_plan_insert()
  from public, anon, authenticated, service_role;
commit;
