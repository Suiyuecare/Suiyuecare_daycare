begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- A pre-admission passenger may be placed in a planning draft, but cannot be
-- published or transported until the immutable lifecycle establishes service-
-- day eligibility. Keep this check below the RPC as a direct-write backstop.
create function private.transport_passengers_service_eligible(
  p_organization_id uuid,p_branch_id uuid,p_service_date date,p_passengers jsonb
) returns boolean language plpgsql stable security definer set search_path='' as $$
begin
  if p_organization_id is null or p_branch_id is null or p_service_date is null
    or not isfinite(p_service_date) or p_service_date<date '2000-01-01'
    or p_service_date>date '2100-01-01'
    or jsonb_typeof(p_passengers) is distinct from 'array' then
    return false;
  end if;
  if jsonb_array_length(p_passengers)=0 then return false; end if;
  return not exists (
      select 1 from jsonb_array_elements(p_passengers) passenger(value)
      left join public.clients client
        on client.id=case
          when passenger.value->>'client_id' ~*
            '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then (passenger.value->>'client_id')::uuid else null::uuid end
        and client.organization_id=p_organization_id
        and client.branch_id=p_branch_id
      where client.id is null
        or private.client_service_state_on(client.id,p_service_date)<>'eligible'
    );
end;
$$;

create function private.assert_transport_passengers_service_eligible(
  p_organization_id uuid,p_branch_id uuid,p_service_date date,p_passengers jsonb
) returns void language plpgsql volatile security definer set search_path='' as $$
declare v_client_id uuid;
begin
  if p_organization_id is null or p_branch_id is null or p_service_date is null
    or jsonb_typeof(p_passengers) is distinct from 'array' then
    raise exception using errcode='23514',message='transport passenger is not service eligible';
  end if;
  if jsonb_array_length(p_passengers)=0 then
    raise exception using errcode='23514',message='transport passenger is not service eligible';
  end if;
  -- A lifecycle transition updates the same client row. These ordered row locks
  -- close the check/write race with admission, suspension and closure.
  for v_client_id in
    select (passenger.value->>'client_id')::uuid
    from jsonb_array_elements(p_passengers) passenger(value)
    order by (passenger.value->>'client_id')::uuid
  loop
    perform 1 from public.clients client
    where client.id=v_client_id and client.organization_id=p_organization_id
      and client.branch_id=p_branch_id for share;
    if not found or private.client_service_state_on(v_client_id,p_service_date)<>'eligible' then
      raise exception using errcode='23514',message='transport passenger is not service eligible';
    end if;
  end loop;
end;
$$;

create function private.guard_transport_decision_service_day()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_plan public.transport_trip_plan_versions%rowtype;
begin
  if new.decision='reject' then return new; end if;
  select * into v_plan from public.transport_trip_plan_versions plan
  where plan.id=new.trip_version_id and plan.organization_id=new.organization_id
    and plan.branch_id=new.branch_id for share;
  if not found then
    raise exception using errcode='23514',message='transport plan is not in scope';
  end if;
  perform private.assert_transport_passengers_service_eligible(
    new.organization_id,new.branch_id,v_plan.service_date,v_plan.passenger_snapshot);
  return new;
end;
$$;
create trigger transport_service_day_decision_guard
before insert on public.transport_trip_plan_decisions for each row
execute function private.guard_transport_decision_service_day();

create function private.guard_transport_execution_service_day()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_plan public.transport_trip_plan_versions%rowtype;
begin
  select * into v_plan from public.transport_trip_plan_versions plan
  where plan.id=new.plan_version_id and plan.organization_id=new.organization_id
    and plan.branch_id=new.branch_id and plan.service_date=new.service_date for share;
  if not found then
    raise exception using errcode='23514',message='transport plan is not in scope';
  end if;
  perform private.assert_transport_passengers_service_eligible(
    new.organization_id,new.branch_id,new.service_date,v_plan.passenger_snapshot);
  return new;
end;
$$;
create trigger transport_service_day_start_guard
before insert on public.transport_execution_streams for each row
execute function private.guard_transport_execution_service_day();

create function private.guard_transport_boarding_service_day()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  -- Do not block alighting, incident handling or trip completion after a
  -- mid-trip change in eligibility; preserving safety evidence takes priority.
  if new.event_type='passenger_boarded' then
    perform private.assert_transport_passengers_service_eligible(
      new.organization_id,new.branch_id,new.service_date,
      jsonb_build_array(jsonb_build_object('client_id',new.client_id)));
  end if;
  return new;
end;
$$;
create trigger transport_service_day_boarding_guard
before insert on public.transport_execution_events for each row
execute function private.guard_transport_boarding_service_day();

-- The execution page is an actionable queue. A previously published trip
-- becomes non-actionable when its passenger loses service-day eligibility;
-- already-started trips remain visible as immutable operational history.
-- Keep the full final projection explicit so managed PostgreSQL formatting and
-- future function changes cannot silently alter this safety-critical clause.
create or replace function private.transport_execution_projection(
  p_organization_id uuid,p_branch_id uuid
)
returns table(plan_version_id uuid,trip_key uuid,plan_version integer,
  plan_content_hash text,plan_decision text,direction text,service_date date,
  planned_starts_at timestamptz,planned_ends_at timestamptz,vehicle_code text,
  vehicle_name text,driver_membership_id uuid,driver_user_id uuid,
  driver_display_name text,pickup_label text,dropoff_label text,passengers jsonb,
  events jsonb,events_truncated boolean,execution_sequence integer,status text,
  actual_started_at timestamptz,actual_completed_at timestamptz,late_seconds integer,
  exception_count integer,unmatched_passenger_count integer)
language sql stable security definer set search_path='' as $$
  with accepted as (
    select plan.*,decision.decision plan_decision
    from public.transport_trip_plan_versions plan
    join public.transport_trip_plan_decisions decision on decision.trip_version_id=plan.id
      and decision.decision in('publish','override')
    where plan.organization_id=p_organization_id and plan.branch_id=p_branch_id
      and not exists(select 1 from private.transport_trip_cancellations c where c.trip_key=plan.trip_key)
      and (exists(select 1 from public.transport_execution_streams started
        where started.plan_version_id=plan.id)
        or private.transport_passengers_service_eligible(plan.organization_id,
          plan.branch_id,plan.service_date,plan.passenger_snapshot))
      and not exists(select 1 from public.transport_trip_plan_versions newer
        join public.transport_trip_plan_decisions newer_decision
          on newer_decision.trip_version_id=newer.id
          and newer_decision.decision in('publish','override')
        where newer.trip_key=plan.trip_key and newer.version>plan.version)
  )
  select plan.id,plan.trip_key,plan.version,plan.content_hash,plan.plan_decision,
    plan.direction,plan.service_date,plan.starts_at,plan.ends_at,plan.vehicle_code,
    plan.vehicle_name_snapshot,plan.driver_membership_id,plan.driver_user_id,
    plan.driver_display_name_snapshot,plan.pickup_label,plan.dropoff_label,
    coalesce(passenger_rows.payload,'[]'::jsonb),coalesce(event_rows.payload,'[]'::jsonb),
    coalesce(stats.execution_sequence,0)>coalesce(jsonb_array_length(event_rows.payload),0),
    coalesce(stats.execution_sequence,0),
    case when stream.id is null then 'not_started'
      when stats.actual_completed_at is null then 'in_progress' else 'completed' end,
    stats.actual_started_at,stats.actual_completed_at,
    case when stats.actual_started_at is null then null else greatest(0,
      floor(extract(epoch from stats.actual_started_at-plan.starts_at)))::integer end,
    coalesce(stats.exception_count,0),
    private.transport_execution_unmatched_count(stream.id,plan.passenger_snapshot)
  from accepted plan
  left join public.transport_execution_streams stream on stream.plan_version_id=plan.id
  left join lateral (
    select max(event.sequence)::integer execution_sequence,
      min(event.occurred_at) filter(where event.event_type='trip_started') actual_started_at,
      max(event.occurred_at) filter(where event.event_type='trip_completed') actual_completed_at,
      count(*) filter(where event.event_type='exception_recorded')::integer exception_count
    from public.transport_execution_events event where event.stream_id=stream.id
  ) stats on true
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'client_id',(passenger.value->>'client_id')::uuid,
      'client_code',passenger.value->>'client_code',
      'display_name',passenger.value->>'display_name',
      'pickup_label',passenger.value->>'pickup_label',
      'dropoff_label',passenger.value->>'dropoff_label',
      'boarded_at',(select min(event.occurred_at) from public.transport_execution_events event
        where event.stream_id=stream.id and event.client_id=(passenger.value->>'client_id')::uuid
          and event.event_type='passenger_boarded'),
      'alighted_at',(select min(event.occurred_at) from public.transport_execution_events event
        where event.stream_id=stream.id and event.client_id=(passenger.value->>'client_id')::uuid
          and event.event_type='passenger_alighted'),
      'pairing_resolved',exists(select 1 from public.transport_execution_events event
        where event.stream_id=stream.id and event.client_id=(passenger.value->>'client_id')::uuid
          and event.event_type='exception_recorded' and event.resolves_pairing),
      'resolution_note',(select event.note from public.transport_execution_events event
        where event.stream_id=stream.id and event.client_id=(passenger.value->>'client_id')::uuid
          and event.event_type='exception_recorded' and event.resolves_pairing
        order by event.sequence desc limit 1)) order by passenger.ordinality) payload
    from jsonb_array_elements(plan.passenger_snapshot) with ordinality passenger(value,ordinality)
  ) passenger_rows on true
  left join lateral (
    select jsonb_agg(jsonb_build_object('event_id',recent.id,
      'sequence',recent.sequence,'event_type',recent.event_type,'client_id',recent.client_id,
      'occurred_at',recent.occurred_at,'note',recent.note,
      'resolves_pairing',recent.resolves_pairing,'actor_user_id',recent.actor_user_id,
      'actor_display_name',recent.actor_display_name,'content_hash',recent.content_hash,
      'committed_at',recent.committed_at) order by recent.sequence) payload
    from (select event.* from public.transport_execution_events event
      where event.stream_id=stream.id order by event.sequence desc limit 300) recent
  ) event_rows on true;
$$;

revoke all on function private.transport_passengers_service_eligible(uuid,uuid,date,jsonb),
  private.assert_transport_passengers_service_eligible(uuid,uuid,date,jsonb),
  private.guard_transport_decision_service_day(),
  private.guard_transport_execution_service_day(),
  private.guard_transport_boarding_service_day() from public,anon,authenticated,service_role;

comment on function private.transport_passengers_service_eligible(uuid,uuid,date,jsonb) is
  'Effective-day transport eligibility; does not admit a client or create service evidence.';
commit;
