-- Transport passengers are JSON snapshots without a client foreign key. In
-- addition to the existing pending-intake restriction, reject every missing or
-- foreign-scope client before a privileged writer can persist a draft.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace function private.reject_pending_jubo_transport_plan_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- The table constraint handles non-arrays. A valid array must refer only to
  -- real clients in this exact organization and branch, regardless of status.
  if jsonb_typeof(new.passenger_snapshot) is distinct from 'array' then
    return new;
  end if;
  if exists (
    select 1
    from jsonb_array_elements(new.passenger_snapshot) passenger(value)
    left join public.clients client on client.id = case
      when coalesce(passenger.value->>'client_id', '') ~*
        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then (passenger.value->>'client_id')::uuid
      else null::uuid end
    where jsonb_typeof(passenger.value) is distinct from 'object'
      or client.id is null
      or client.organization_id is distinct from new.organization_id
      or client.branch_id is distinct from new.branch_id
  ) then
    raise exception using errcode = '23514',
      message = 'TRANSPORT_PASSENGER_SCOPE_INVALID';
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

revoke all on function private.reject_pending_jubo_transport_plan_insert()
  from public, anon, authenticated, service_role;
commit;
