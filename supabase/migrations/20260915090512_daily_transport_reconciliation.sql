begin;

-- Read-only demand -> effective publication reconciliation. This is not an
-- attendance, transport execution or claim writer. The STABLE builder gives
-- weekly eligibility and published trips the same MVCC statement snapshot.
create or replace function private.daily_transport_reconciliation_data(
  p_organization_id uuid, p_branch_id uuid, p_date date
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_payload jsonb; v_client_count integer; v_dispatch_allowed boolean;
begin
  if auth.uid() is null or p_date is null or p_date<'2000-01-01' or p_date>'2100-01-01'
    or not exists(select 1 from public.branches b
      join public.organizations o on o.id=b.organization_id and o.is_active
      where b.id=p_branch_id and b.organization_id=p_organization_id and b.is_active)
    or not (private.has_permission(p_organization_id,p_branch_id,'clients.read')
      or private.has_executive_read_permission(p_organization_id,p_branch_id,'clients.read')
      or private.has_routine_intake_permission(p_organization_id,p_branch_id,'clients.read')) then
    raise exception using errcode='42501',message='daily transport projection denied';
  end if;
  v_dispatch_allowed:=coalesce(private.transport_plan_authority(
    p_organization_id,p_branch_id,'transport_plans.read'),false);

  with visible as materialized (
    select c.id from public.clients c
    where c.organization_id=p_organization_id and c.branch_id=p_branch_id
      and private.care_roster_can_read(c.id,'clients.read')
      -- Seven years of closed history must not consume the 500 eligible-client
      -- service-day budget or make an otherwise small current roster unavailable.
      and private.client_service_state_on(c.id,p_date)='eligible' order by c.id limit 501
  ), days as materialized (
    select id,private.client_weekly_days(id,p_date,1)->0 as projected from visible
  ), expected as materialized (
    select id,projected->'day' as day from days where projected->>'status'='scheduled'
  ), demands as materialized (
    select e.id as client_id,d.direction from expected e
    cross join (values('outbound','pickup'),('inbound','dropoff')) d(weekly_key,direction)
    where e.day->d.weekly_key is distinct from 'null'::jsonb and e.day ? d.weekly_key
  ), effective as materialized (
    select trip.id,trip.direction,trip.passenger_snapshot from public.transport_trip_plan_versions trip
    join public.transport_trip_plan_decisions decision on decision.trip_version_id=trip.id
      and decision.organization_id=trip.organization_id and decision.branch_id=trip.branch_id
      and decision.decision in('publish','override')
    where v_dispatch_allowed and trip.organization_id=p_organization_id
      and trip.branch_id=p_branch_id and trip.service_date=p_date
      -- Match Page 48: a newer draft/rejection does not replace publication.
      -- Search ALL dates/directions before matching demand, so a later published
      -- revision that removes/moves a passenger cannot leave the old trip active.
      and not exists(select 1 from public.transport_trip_plan_versions newer
        join public.transport_trip_plan_decisions nd on nd.trip_version_id=newer.id
          and nd.organization_id=newer.organization_id and nd.branch_id=newer.branch_id
          and nd.decision in('publish','override')
        where newer.organization_id=p_organization_id and newer.branch_id=p_branch_id
          and newer.trip_key=trip.trip_key and newer.version>trip.version)
  ), trip_access as materialized (
    select trip.*,not exists(select 1 from jsonb_array_elements(trip.passenger_snapshot) p(value)
      where not coalesce(private.can_staff_access_client((p.value->>'client_id')::uuid,
        'transport_plans.read'),false)) as fully_visible from effective trip
  ), reconciled as materialized (
    select d.client_id,d.direction,
      case when not coalesce(private.can_staff_access_client(d.client_id,'transport_plans.read'),false)
        or coalesce(bool_or(not trip.fully_visible) filter(where trip.id is not null),false)
        then 'restricted'
        when count(trip.id)=0 then 'pending'
        when count(trip.id)=1 then 'assigned' else 'conflict' end as state,
      coalesce(jsonb_agg(trip.id order by trip.id) filter(where trip.id is not null),'[]'::jsonb) as trip_ids
    from demands d left join trip_access trip on trip.direction=d.direction
      and trip.passenger_snapshot @> jsonb_build_array(jsonb_build_object('client_id',d.client_id))
    where v_dispatch_allowed group by d.client_id,d.direction
  )
  select (select count(*)::integer from visible),jsonb_build_object(
    'organizationId',p_organization_id,'branchId',p_branch_id,'serviceDate',p_date,
    'generatedAt',statement_timestamp(),'evidenceKind','planned_not_attended',
    'clients',coalesce((select jsonb_agg(jsonb_build_object('clientId',id,
      'startsAt',day->>'startsAt','endsAt',day->>'endsAt',
      'outbound',day->'outbound' is distinct from 'null'::jsonb and day ? 'outbound',
      'inbound',day->'inbound' is distinct from 'null'::jsonb and day ? 'inbound') order by id)
      from expected),'[]'::jsonb),
    'dispatch',case when not v_dispatch_allowed then jsonb_build_object('status','forbidden')
      else jsonb_build_object('status','ready','rows',coalesce((select jsonb_agg(jsonb_build_object(
        'clientId',client_id,'direction',direction,'status',state,
        'tripVersionIds',case when state='restricted' then '[]'::jsonb else trip_ids end)
        order by client_id,direction) from reconciled),'[]'::jsonb)) end)
  into v_client_count,v_payload;

  if v_client_count>500 or exists(select 1 from jsonb_array_elements(
      coalesce(v_payload->'dispatch'->'rows','[]'::jsonb)) r
      where jsonb_array_length(r->'tripVersionIds')>1000) then
    raise exception using errcode='54000',message='daily transport projection exceeds limit';
  end if;
  return v_payload;
end; $$;

create or replace function private.daily_transport_reconciliation_guarded(
  p_organization_id uuid,p_branch_id uuid,p_date date
) returns table(payload jsonb) language plpgsql volatile security definer set search_path='' as $$
declare v_payload jsonb;
begin
  v_payload:=private.daily_transport_reconciliation_data(p_organization_id,p_branch_id,p_date);
  insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,
    row_pk,changed_fields,metadata)
  values(p_organization_id,p_branch_id,auth.uid(),'select','daily_transport_reconciliation',
    p_branch_id::text,array['bounded_projection'],jsonb_build_object(
      'expected_count',jsonb_array_length(v_payload->'clients'),
      'dispatch_status',v_payload->'dispatch'->>'status'));
  return query select v_payload;
end; $$;

create or replace function public.daily_transport_reconciliation(
  p_organization_id uuid,p_branch_id uuid,p_date date
) returns table(payload jsonb) language sql volatile security invoker set search_path='' as $$
  select * from private.daily_transport_reconciliation_guarded(p_organization_id,p_branch_id,p_date);
$$;
revoke all on function private.daily_transport_reconciliation_data(uuid,uuid,date)
  from public,anon,authenticated,service_role;
revoke all on function private.daily_transport_reconciliation_guarded(uuid,uuid,date)
  from public,anon,authenticated,service_role;
revoke all on function public.daily_transport_reconciliation(uuid,uuid,date)
  from public,anon,authenticated,service_role;
grant execute on function private.daily_transport_reconciliation_guarded(uuid,uuid,date)
  to authenticated;
grant execute on function public.daily_transport_reconciliation(uuid,uuid,date)
  to authenticated;

commit;
