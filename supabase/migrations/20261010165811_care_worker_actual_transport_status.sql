-- A narrow read projection for the care worker's assigned client cards.  Page 48
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- transport_execution_snapshot remains driver/manager-only: it contains every
-- passenger, vehicle and driver.  This projection deliberately does not grant
-- access to those tables and never treats an absent event as "did not ride".
insert into public.permissions(permission_key,description,risk_level)
values ('transport_case_status.read','Read actual transport event status for own daily care roster clients',2)
on conflict(permission_key) do nothing;

insert into public.role_permissions(role_id,permission_id)
select role.id,permission.id from public.roles role cross join public.permissions permission
where role.is_system and role.role_key='care_worker'
  and permission.permission_key='transport_case_status.read'
on conflict(role_id,permission_id) do nothing;

-- The approved Google-staff path has a fixed permission allowlist; a new role
-- grant alone would never reach a real caregiver.  Keep the existing current
-- session, role, branch and granted-at checks, adding only this read key.
create or replace function private.has_routine_staff_permission(
  p_organization_id uuid,p_branch_id uuid,p_permission_key text
)
returns boolean language sql volatile security definer set search_path='' as $$
 select coalesce(p_permission_key in (
  'clients.read','clients.view_all','attendance.read','attendance.write',
  'health.read','health.write','care_records.read','care_records.write',
  'services.read','transport_case_status.read'
 ) and exists(
  select 1 from private.routine_staff_scope() s
  join public.role_permissions rp on rp.role_id=s.role_id and rp.granted_at<=clock_timestamp()
  join public.permissions p on p.id=rp.permission_id and p.permission_key=p_permission_key
  where s.organization_id=p_organization_id
   and ((p_branch_id is null and s.branch_id is null)
    or (p_branch_id is not null and (s.branch_id is null or s.branch_id=p_branch_id)
     and exists(select 1 from public.branches b where b.id=p_branch_id
      and b.organization_id=p_organization_id and b.is_active)))
 ),false);
$$;

create function private.care_worker_actual_transport_status_guarded(
  p_organization_id uuid,p_branch_id uuid,p_service_date date
)
returns table(payload jsonb) language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); v_visible_count integer; v_rows jsonb;
begin
  if v_actor is null or p_service_date is null
    or p_service_date not between date '2000-01-01' and date '2100-01-01'
    or not exists(select 1 from public.organizations organization
      join public.branches branch on branch.organization_id=organization.id
      where organization.id=p_organization_id and branch.id=p_branch_id
        and organization.is_active and branch.is_active)
    or not private.has_routine_staff_permission(p_organization_id,p_branch_id,'clients.read')
    or not private.has_routine_staff_permission(p_organization_id,p_branch_id,'transport_case_status.read') then
    raise exception using errcode='42501',message='assigned transport status not permitted';
  end if;

  -- The latest immutable allocation wins.  An earlier assignment that has been
  -- cancelled or reallocated cannot preserve access to this projection.
  with latest as (
    select distinct on (r.client_id,r.shift) r.client_id,r.staff_user_id,r.state
    from private.care_roster_versions r
    where r.organization_id=p_organization_id and r.branch_id=p_branch_id
      and r.service_date=p_service_date
    order by r.client_id,r.shift,r.version desc
  ), visible as (
    select distinct c.id from latest r join public.clients c on c.id=r.client_id
      and c.organization_id=p_organization_id and c.branch_id=p_branch_id
    where r.staff_user_id=v_actor and r.state='scheduled'
      and private.client_service_state_on(c.id,p_service_date)='eligible'
      and private.can_routine_staff_access_client(c.id,'clients.read')
  ) select count(*) into v_visible_count from visible;
  if v_visible_count>500 then
    raise exception using errcode='54000',message='assigned transport status exceeds bounded page';
  end if;

  with latest as (
    select distinct on (r.client_id,r.shift) r.client_id,r.staff_user_id,r.state
    from private.care_roster_versions r
    where r.organization_id=p_organization_id and r.branch_id=p_branch_id
      and r.service_date=p_service_date
    order by r.client_id,r.shift,r.version desc
  ), visible as (
    select distinct c.id from latest r join public.clients c on c.id=r.client_id
      and c.organization_id=p_organization_id and c.branch_id=p_branch_id
    where r.staff_user_id=v_actor and r.state='scheduled'
      and private.client_service_state_on(c.id,p_service_date)='eligible'
      and private.can_routine_staff_access_client(c.id,'clients.read')
  ), current_passengers as materialized (
    -- Schedule state comes only from each currently accepted plan's passenger
    -- snapshot.  A stale event on a superseded/cancelled plan is not membership.
    select distinct plan.id plan_version_id,plan.direction,visible.id client_id
    from public.transport_trip_plan_versions plan
    join public.transport_trip_plan_decisions decision on decision.trip_version_id=plan.id
      and decision.decision in('publish','override')
    cross join lateral jsonb_array_elements(plan.passenger_snapshot) passenger(value)
    join visible on visible.id=(passenger.value->>'client_id')::uuid
    where plan.organization_id=p_organization_id and plan.branch_id=p_branch_id
      and plan.service_date=p_service_date
      and not exists(select 1 from private.transport_trip_cancellations cancellation
        where cancellation.trip_key=plan.trip_key)
      and not exists(select 1 from public.transport_trip_plan_versions newer
        join public.transport_trip_plan_decisions newer_decision
          on newer_decision.trip_version_id=newer.id
          and newer_decision.decision in('publish','override')
        where newer.trip_key=plan.trip_key and newer.version>plan.version)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'clientId',visible.id,
    'pickupStatus',case when pickup.plan_version_id is null then 'not_scheduled'
      when pickup.event_type='exception_recorded' then 'exception'
      when pickup.event_type='passenger_alighted' then 'alighted'
      when pickup.event_type='passenger_boarded' then 'boarded'
      else 'scheduled_unreported' end,
    'dropoffStatus',case when dropoff.plan_version_id is null then 'not_scheduled'
      when dropoff.event_type='exception_recorded' then 'exception'
      when dropoff.event_type='passenger_alighted' then 'alighted'
      when dropoff.event_type='passenger_boarded' then 'boarded'
      else 'scheduled_unreported' end
  ) order by visible.id),'[]'::jsonb) into v_rows
  from visible
  left join lateral (
    select passenger.plan_version_id,event.event_type
    from current_passengers passenger
    left join public.transport_execution_streams stream
      on stream.plan_version_id=passenger.plan_version_id
      and stream.organization_id=p_organization_id and stream.branch_id=p_branch_id
      and stream.service_date=p_service_date and stream.plan_decision in('publish','override')
    left join public.transport_execution_events event on event.stream_id=stream.id
      and event.organization_id=p_organization_id and event.branch_id=p_branch_id
      and event.service_date=p_service_date and event.client_id=visible.id
      and event.event_type in('passenger_boarded','passenger_alighted','exception_recorded')
    where passenger.client_id=visible.id and passenger.direction='pickup'
    order by event.occurred_at desc nulls last,event.committed_at desc nulls last,
      event.sequence desc nulls last,passenger.plan_version_id limit 1
  ) pickup on true
  left join lateral (
    select passenger.plan_version_id,event.event_type
    from current_passengers passenger
    left join public.transport_execution_streams stream
      on stream.plan_version_id=passenger.plan_version_id
      and stream.organization_id=p_organization_id and stream.branch_id=p_branch_id
      and stream.service_date=p_service_date and stream.plan_decision in('publish','override')
    left join public.transport_execution_events event on event.stream_id=stream.id
      and event.organization_id=p_organization_id and event.branch_id=p_branch_id
      and event.service_date=p_service_date and event.client_id=visible.id
      and event.event_type in('passenger_boarded','passenger_alighted','exception_recorded')
    where passenger.client_id=visible.id and passenger.direction='dropoff'
    order by event.occurred_at desc nulls last,event.committed_at desc nulls last,
      event.sequence desc nulls last,passenger.plan_version_id limit 1
  ) dropoff on true;

  insert into public.audit_events(organization_id,branch_id,actor_user_id,action,
    table_name,row_pk,changed_fields,metadata)
  values(p_organization_id,p_branch_id,v_actor,'select','care_worker_actual_transport_status',
    p_branch_id::text,array['actual_transport_status'],
    jsonb_build_object('service_date',p_service_date,'row_count',v_visible_count));
  return query select jsonb_build_object('serviceDate',p_service_date,
    'generatedAt',clock_timestamp(),'rows',v_rows);
end;
$$;

create function public.care_worker_actual_transport_status(
  p_organization_id uuid,p_branch_id uuid,p_service_date date
) returns table(payload jsonb) language sql volatile security invoker set search_path='' as $$
  select * from private.care_worker_actual_transport_status_guarded(
    p_organization_id,p_branch_id,p_service_date);
$$;

revoke all on function private.care_worker_actual_transport_status_guarded(uuid,uuid,date),
  public.care_worker_actual_transport_status(uuid,uuid,date)
  from public,anon,authenticated,service_role;
grant execute on function private.care_worker_actual_transport_status_guarded(uuid,uuid,date),
  public.care_worker_actual_transport_status(uuid,uuid,date) to authenticated;

comment on function public.care_worker_actual_transport_status(uuid,uuid,date) is
  'Own daily assigned clients only. Current accepted passenger snapshots determine not_scheduled versus scheduled_unreported; immutable Page-48 passenger events determine boarded/alighted or a redacted exception flag.';

commit;
