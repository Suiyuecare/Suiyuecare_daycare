begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

-- Cancellation is separate append-only evidence. Published plans and decisions
-- remain unchanged. An executing (including completed) trip cannot be cancelled.
create table private.transport_trip_cancellations (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null,
 branch_id uuid not null, trip_version_id uuid not null, trip_key uuid not null unique,
 actor_user_id uuid not null references auth.users(id) on delete restrict,
 actor_name text not null, reason text not null, cancelled_at timestamptz not null default clock_timestamp(),
 reauth_challenge_id uuid not null references private.reauth_challenges(id) on delete restrict,
 idempotency_key uuid not null, request_hash text not null,
 constraint transport_cancellation_actor_key unique(actor_user_id,idempotency_key),
 constraint transport_cancellation_plan_scope foreign key(trip_version_id,organization_id,branch_id)
 references public.transport_trip_plan_versions(id,organization_id,branch_id) on delete restrict,
 constraint transport_cancellation_text check(private.transport_plan_text_ok(reason,8,1000)
 and private.transport_plan_text_ok(actor_name,1,160) and request_hash ~ '^[a-f0-9]{64}$')
);
create index transport_cancellation_plan_idx on private.transport_trip_cancellations(trip_version_id);
create index transport_cancellation_scope_idx on private.transport_trip_cancellations(organization_id,branch_id,cancelled_at);
create index transport_cancellation_reauth_idx on private.transport_trip_cancellations(reauth_challenge_id);
alter table private.transport_trip_cancellations enable row level security;
alter table private.transport_trip_cancellations force row level security;
revoke all on private.transport_trip_cancellations from public,anon,authenticated,service_role;
create trigger transport_cancellation_append_only before update or delete on private.transport_trip_cancellations
for each row execute function private.prevent_transport_plan_mutation();
create trigger transport_cancellation_audit after insert on private.transport_trip_cancellations
for each row execute function private.audit_row_change();

create or replace function private.block_cancelled_transport_trip_write()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('transport-trip:'||new.trip_key::text,47));
 if exists(select 1 from private.transport_trip_cancellations c where c.trip_key=new.trip_key) then
  raise exception using errcode='40001',message='cancelled transport trip cannot be revised, published or started';
 end if;
 return new;
end; $$;
create trigger transport_cancelled_plan_guard before insert on public.transport_trip_plan_versions
for each row execute function private.block_cancelled_transport_trip_write();
create trigger transport_cancelled_decision_guard before insert on public.transport_trip_plan_decisions
for each row execute function private.block_cancelled_transport_trip_write();
create trigger transport_cancelled_execution_guard before insert on public.transport_execution_streams
for each row execute function private.block_cancelled_transport_trip_write();

create or replace function private.cancel_transport_trip_plan_guarded(
 p_expected_organization_id uuid,p_expected_branch_id uuid,p_payload jsonb,p_idempotency_key uuid
) returns table(operation_id uuid,action text,decision text,trip_version_id uuid,
 trip_key uuid,version integer,status text,conflict_count integer,content_hash text,
 rule_version_id uuid,committed_at timestamptz,replayed boolean)
language plpgsql volatile security definer set search_path='' as $$
declare
 v_actor uuid:=auth.uid(); v_hash text; v_reauth uuid; v_actor_name text; v_replay boolean:=false;
 v_plan public.transport_trip_plan_versions%rowtype;
 v_cancel private.transport_trip_cancellations%rowtype; v_client uuid; v_live_permissions text[];
begin
 if v_actor is null or p_idempotency_key is null or not coalesce(private.transport_plan_authority(
 p_expected_organization_id,p_expected_branch_id,'transport_plans.approve'),false) then
  raise exception using errcode='42501',message='transport cancellation denied'; end if;
 v_reauth:=private.require_transport_plan_reauth(v_actor,clock_timestamp());
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or not (p_payload ?& array[
 'trip_version_id','expected_trip_key','expected_version','expected_content_hash',
 'expected_conflict_count','expected_rule_version_id','reason']) or
 p_payload-array['trip_version_id','expected_trip_key','expected_version','expected_content_hash',
 'expected_conflict_count','expected_rule_version_id','reason']<>'{}'::jsonb or
 jsonb_typeof(p_payload->'expected_version')<>'number' or coalesce(p_payload->>'expected_version','')!~'^[1-9][0-9]*$' or
 jsonb_typeof(p_payload->'expected_conflict_count')<>'number' or coalesce(p_payload->>'expected_conflict_count','')!~'^[0-9]+$' or
 jsonb_typeof(p_payload->'reason')<>'string' or not coalesce(private.transport_plan_text_ok(btrim(p_payload->>'reason'),8,1000),false) or
 coalesce(p_payload->>'expected_content_hash','')!~'^[a-f0-9]{64}$' or
 coalesce(p_payload->>'trip_version_id','')!~*'^[a-f0-9-]{36}$' or
 coalesce(p_payload->>'expected_trip_key','')!~*'^[a-f0-9-]{36}$' or
 coalesce(p_payload->>'expected_rule_version_id','')!~*'^[a-f0-9-]{36}$' then
 raise exception using errcode='22023',message='invalid transport cancellation payload'; end if;
 v_hash:=encode(sha256(convert_to(jsonb_build_object('organization',p_expected_organization_id,
 'branch',p_expected_branch_id,'actor',v_actor,'payload',p_payload)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended('transport-cancel-operation:'||v_actor::text||':'||p_idempotency_key::text,47));
 perform pg_advisory_xact_lock(hashtextextended('transport-trip:'||(p_payload->>'expected_trip_key')::uuid::text,47));
 -- Authority is checked again AFTER waiting, with active scope rows pinned.
 perform 1 from public.organizations o join public.branches b on b.organization_id=o.id
 where o.id=p_expected_organization_id and b.id=p_expected_branch_id and o.is_active and b.is_active for share of o,b;
 if not found or not coalesce(private.transport_plan_authority(p_expected_organization_id,
 p_expected_branch_id,'transport_plans.approve'),false) then
 raise exception using errcode='42501',message='transport cancellation scope expired'; end if;
 v_reauth:=private.require_transport_plan_reauth(v_actor,clock_timestamp());
 select display_name into v_actor_name from public.profiles where id=v_actor and is_active for share;
 if not found then raise exception using errcode='42501',message='inactive cancellation actor'; end if;
 select * into v_plan from public.transport_trip_plan_versions p where p.id=(p_payload->>'trip_version_id')::uuid
 and p.organization_id=p_expected_organization_id and p.branch_id=p_expected_branch_id;
 if not found or v_plan.trip_key<>(p_payload->>'expected_trip_key')::uuid or
 v_plan.version<>(p_payload->>'expected_version')::integer or v_plan.content_hash<>p_payload->>'expected_content_hash' or
 v_plan.rule_version_id<>(p_payload->>'expected_rule_version_id')::uuid or
 jsonb_array_length(v_plan.conflict_snapshot)<>(p_payload->>'expected_conflict_count')::integer then
  raise exception using errcode='40001',message='transport cancellation version conflict'; end if;
 -- Exact receipt replay also requires current passenger scope after waiting
 -- for the operation/trip locks; transaction-start now() is not current time.
 if exists(select 1 from jsonb_array_elements(v_plan.passenger_snapshot) p(value)
 where not coalesce(private.can_staff_access_client((p.value->>'client_id')::uuid,'transport_plans.read'),false)
  or (not coalesce(private.has_permission(p_expected_organization_id,p_expected_branch_id,'clients.view_all'),false)
   and not exists(select 1 from public.client_assignments a
    where a.client_id=(p.value->>'client_id')::uuid and a.organization_id=p_expected_organization_id
     and a.branch_id=p_expected_branch_id and a.assignee_user_id=v_actor
     and a.starts_at<=clock_timestamp() and (a.ends_at is null or a.ends_at>clock_timestamp())))) then
 raise exception using errcode='42501',message='cancellation passenger scope denied'; end if;
 select * into v_cancel from private.transport_trip_cancellations c
 where c.actor_user_id=v_actor and c.idempotency_key=p_idempotency_key;
 if found then
  if v_cancel.request_hash<>v_hash then raise exception using errcode='23505',message='cancellation key reused with different content'; end if;
  v_replay:=true;
 else
  if exists(select 1 from private.transport_trip_cancellations c where c.trip_key=v_plan.trip_key) or
   exists(select 1 from public.transport_trip_plan_versions p join public.transport_trip_plan_decisions d on d.trip_version_id=p.id
     and d.decision in('publish','override') where p.trip_key=v_plan.trip_key and p.version>v_plan.version) or
   not exists(select 1 from public.transport_trip_plan_decisions d where d.trip_version_id=v_plan.id and d.decision in('publish','override')) then
   raise exception using errcode='40001',message='only current published uncancelled trip may be cancelled'; end if;
  if exists(select 1 from public.transport_execution_streams s where s.trip_key=v_plan.trip_key) then
   raise exception using errcode='P4701',message='started or completed transport trip cannot be cancelled'; end if;
  perform pg_advisory_xact_lock(hashtextextended('transport-vehicle:'||p_expected_branch_id::text||':'||lower(v_plan.vehicle_code),47));
  perform pg_advisory_xact_lock(hashtextextended('transport-driver:'||p_expected_branch_id::text||':'||v_plan.driver_membership_id::text,47));
  for v_client in select (p.value->>'client_id')::uuid from jsonb_array_elements(v_plan.passenger_snapshot) p(value) order by 1 loop
   perform pg_advisory_xact_lock(hashtextextended('transport-client:'||p_expected_branch_id::text||':'||v_client::text,47));
  end loop;
  if not coalesce(private.transport_plan_authority(p_expected_organization_id,p_expected_branch_id,'transport_plans.approve'),false) then
   raise exception using errcode='42501',message='transport cancellation authority changed'; end if;
  v_reauth:=private.require_transport_plan_reauth(v_actor,clock_timestamp());
  -- Resource locks may have waited while a passenger assignment was revoked.
  -- Branch approval alone is insufficient: recheck every passenger afterwards.
  -- The legacy scope helper uses now() (transaction start), so also check the
  -- assignment's wall-clock validity before writing an irreversible receipt.
  if exists(select 1 from jsonb_array_elements(v_plan.passenger_snapshot) p(value)
   where not coalesce(private.can_staff_access_client((p.value->>'client_id')::uuid,'transport_plans.read'),false)
    or (not coalesce(private.has_permission(p_expected_organization_id,p_expected_branch_id,'clients.view_all'),false)
     and not exists(select 1 from public.client_assignments a
      where a.client_id=(p.value->>'client_id')::uuid and a.organization_id=p_expected_organization_id
       and a.branch_id=p_expected_branch_id and a.assignee_user_id=v_actor
       and a.starts_at<=clock_timestamp() and (a.ends_at is null or a.ends_at>clock_timestamp())))) then
   raise exception using errcode='42501',message='cancellation passenger scope changed'; end if;
  insert into private.transport_trip_cancellations(organization_id,branch_id,trip_version_id,trip_key,
   actor_user_id,actor_name,reason,reauth_challenge_id,idempotency_key,request_hash)
  values(p_expected_organization_id,p_expected_branch_id,v_plan.id,v_plan.trip_key,v_actor,v_actor_name,
   btrim(p_payload->>'reason'),v_reauth,p_idempotency_key,v_hash) returning * into v_cancel;
 end if;
 -- The INSERT's audit trigger can also wait. Recheck the live boundary after
 -- that wait (and for receipt replay), so expired/revoked authority rolls back
 -- both cancellation and audit rather than returning an irreversible success.
 select coalesce(array_agg(distinct permission.permission_key),'{}'::text[]) into v_live_permissions
 from public.memberships m join public.membership_roles mr on mr.membership_id=m.id
 join public.roles role on role.id=mr.role_id and role.is_active
 join public.role_permissions rp on rp.role_id=role.id
 join public.permissions permission on permission.id=rp.permission_id
 where m.profile_id=v_actor and m.organization_id=p_expected_organization_id
  and (m.branch_id is null or m.branch_id=p_expected_branch_id)
  and m.status='active' and m.starts_at<=clock_timestamp() and (m.ends_at is null or m.ends_at>clock_timestamp())
  and mr.assigned_at<=clock_timestamp() and rp.granted_at<=clock_timestamp()
  and role.role_key not in ('platform_ops','family') and (role.organization_id is null or role.organization_id=p_expected_organization_id);
 if not coalesce(private.transport_plan_authority(p_expected_organization_id,p_expected_branch_id,'transport_plans.approve'),false)
  or not v_live_permissions @> array['clients.read','transport_plans.read','transport_plans.approve']
  or private.require_transport_plan_reauth(v_actor,clock_timestamp()) is distinct from v_reauth
  or exists(select 1 from jsonb_array_elements(v_plan.passenger_snapshot) p(value)
   where not coalesce(private.can_staff_access_client((p.value->>'client_id')::uuid,'transport_plans.read'),false)
    or (not 'clients.view_all'=any(v_live_permissions) and not exists(select 1 from public.client_assignments a
     where a.client_id=(p.value->>'client_id')::uuid and a.organization_id=p_expected_organization_id
      and a.branch_id=p_expected_branch_id and a.assignee_user_id=v_actor
      and a.starts_at<=clock_timestamp() and (a.ends_at is null or a.ends_at>clock_timestamp()))))
 then raise exception using errcode='42501',message='transport cancellation authority expired after audit'; end if;
 return query select v_cancel.id,'cancel_trip'::text,null::text,v_plan.id,v_plan.trip_key,
 v_plan.version,'cancelled'::text,jsonb_array_length(v_plan.conflict_snapshot),v_plan.content_hash,
 v_plan.rule_version_id,v_cancel.cancelled_at,v_replay;
end; $$;
create or replace function public.cancel_transport_trip_plan(
 p_expected_organization_id uuid,p_expected_branch_id uuid,p_payload jsonb,p_idempotency_key uuid
) returns table(operation_id uuid,action text,decision text,trip_version_id uuid,
 trip_key uuid,version integer,status text,conflict_count integer,content_hash text,
 rule_version_id uuid,committed_at timestamptz,replayed boolean)
language sql volatile security invoker set search_path='' as $$
 select * from private.cancel_transport_trip_plan_guarded(p_expected_organization_id,p_expected_branch_id,p_payload,p_idempotency_key);
$$;
revoke all on function private.block_cancelled_transport_trip_write() from public,anon,authenticated,service_role;
revoke all on function private.cancel_transport_trip_plan_guarded(uuid,uuid,jsonb,uuid) from public,anon,authenticated,service_role;
revoke all on function public.cancel_transport_trip_plan(uuid,uuid,jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function private.cancel_transport_trip_plan_guarded(uuid,uuid,jsonb,uuid) to authenticated;
grant execute on function public.cancel_transport_trip_plan(uuid,uuid,jsonb,uuid) to authenticated;

-- Shared projections exclude cancelled publications without rewriting history.
create or replace function private.transport_plan_conflicts(
  p_organization_id uuid,p_branch_id uuid,p_trip_key uuid,
  p_starts_at timestamptz,p_ends_at timestamptz,p_vehicle_code text,
  p_vehicle_capacity integer,p_driver_membership_id uuid,p_passengers jsonb
)
returns jsonb language sql stable security definer set search_path='' as $$
  with accepted as (
    select trip.* from public.transport_trip_plan_versions trip
    join public.transport_trip_plan_decisions decision on decision.trip_version_id=trip.id
      and decision.decision in('publish','override')
    where trip.organization_id=p_organization_id and trip.branch_id=p_branch_id
      and not exists(select 1 from private.transport_trip_cancellations c where c.trip_key=trip.trip_key)
      and trip.trip_key<>p_trip_key and trip.starts_at<p_ends_at and trip.ends_at>p_starts_at
      and not exists(select 1 from public.transport_trip_plan_versions newer
        join public.transport_trip_plan_decisions newer_decision
          on newer_decision.trip_version_id=newer.id and newer_decision.decision in('publish','override')
        where newer.trip_key=trip.trip_key and newer.version>trip.version)
  ), conflicts as (
    select '0-capacity' sort_key,'vehicle_capacity_exceeded' code,
      '乘員 '||jsonb_array_length(p_passengers)||' 人超過車輛容量 '||p_vehicle_capacity||' 人。' message,
      'capacity' resource_type,p_vehicle_code resource_key,null::uuid conflicting_trip_key
    where jsonb_array_length(p_passengers)>p_vehicle_capacity
    union all
    select '1-vehicle-'||accepted.trip_key::text,'vehicle_time_overlap',
      '車輛與另一已發布趟次時間重疊。','vehicle',p_vehicle_code,accepted.trip_key
    from accepted where lower(accepted.vehicle_code)=lower(p_vehicle_code)
    union all
    select '2-driver-'||accepted.trip_key::text,'driver_time_overlap',
      '駕駛與另一已發布趟次時間重疊。','driver',p_driver_membership_id::text,accepted.trip_key
    from accepted where accepted.driver_membership_id=p_driver_membership_id
    union all
    select '3-client-'||accepted.trip_key::text||'-'||(passenger.value->>'client_id'),
      'client_time_overlap','個案與另一已發布趟次時間重疊。','client',
      passenger.value->>'client_id',accepted.trip_key
    from accepted cross join lateral jsonb_array_elements(p_passengers) passenger(value)
    where exists(select 1 from jsonb_array_elements(accepted.passenger_snapshot) other(value)
      where other.value->>'client_id'=passenger.value->>'client_id')
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'key',encode(sha256(convert_to(sort_key||'|'||coalesce(conflicting_trip_key::text,''),'UTF8')),'hex'),
    'code',code,'message',message,'resource_type',resource_type,
    'resource_key',resource_key,'conflicting_trip_key',conflicting_trip_key
  ) order by sort_key),'[]'::jsonb) from conflicts;
$$;

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
    where not exists(select 1 from private.transport_trip_cancellations c where c.trip_key=trip.trip_key)
      and v_dispatch_allowed and trip.organization_id=p_organization_id
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

-- Keep the v1 JSON contract intact for the currently deployed application and
-- application-only rollbacks. Filter cancelled trips before counting/paging;
-- stripping the extra fields after the 100-row limit would corrupt totals.
do $compatibility$
declare source text; anchor text; replacement text;
begin
 source:=pg_get_functiondef('private.transport_trip_plan_snapshot_response(uuid,uuid,date,text,text,text,text)'::regprocedure);
 anchor:='and trip.service_date=p_service_date';
 if (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 then
  raise exception 'legacy transport snapshot anchor missing'; end if;
 replacement:=anchor||E'\n      and not exists(select 1 from private.transport_trip_cancellations c where c.trip_key=trip.trip_key)';
 execute replace(source,anchor,replacement);
end;$compatibility$;

-- Cancellation history is a new, explicitly versioned response contract.
create function private.transport_trip_plan_snapshot_v2_response(
  p_expected_organization_id uuid,p_expected_branch_id uuid,p_service_date date,
  p_direction text,p_vehicle_query text,p_driver_query text,p_status text
)
returns table(organization_id uuid,branch_id uuid,generated_at timestamptz,
  policy_status text,policy_version_id uuid,policy_version integer,vehicles jsonb,
  drivers jsonb,clients jsonb,client_total bigint,clients_truncated boolean,
  trips jsonb,matching_trip_total bigint,trips_truncated boolean,passenger_total bigint,
  capacity_conflict_total bigint,pending_publication_total bigint,offline_status text,
  export_status text,notification_provider_status text)
language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); v_now timestamptz:=clock_timestamp();
  v_policy_count integer; v_policy private.transport_policy_versions%rowtype;
  v_policy_status text; v_vehicles jsonb:='[]'::jsonb; v_drivers jsonb:='[]'::jsonb;
  v_clients jsonb:='[]'::jsonb; v_client_total bigint:=0; v_trips jsonb:='[]'::jsonb;
  v_trip_total bigint:=0; v_passengers bigint:=0; v_capacity bigint:=0; v_pending bigint:=0;
begin
  if p_service_date is null or extract(year from p_service_date) not between 1900 and 2200
     or p_direction not in('all','pickup','dropoff')
     or p_status not in('all','draft_ready','draft_conflicted','published','rejected','cancelled')
     or char_length(coalesce(p_vehicle_query,''))>80 or coalesce(p_vehicle_query,'')~'[[:cntrl:]]'
     or char_length(coalesce(p_driver_query,''))>80 or coalesce(p_driver_query,'')~'[[:cntrl:]]'
     or not private.transport_plan_authority(p_expected_organization_id,
       p_expected_branch_id,'transport_plans.read') then
    raise exception using errcode='42501',message='transport plan snapshot not permitted'; end if;
  select count(*) into v_policy_count from private.transport_policy_versions policy
  where policy.organization_id=p_expected_organization_id and policy.branch_id=p_expected_branch_id
    and policy.effective_from<=p_service_date
    and (policy.effective_to is null or policy.effective_to>=p_service_date);
  v_policy_status:=case when v_policy_count=0 then 'not_configured'
    when v_policy_count=1 then 'manual_unstandardized' else 'ambiguous' end;
  if v_policy_count=1 then
    select * into v_policy from private.transport_policy_versions policy
    where policy.organization_id=p_expected_organization_id and policy.branch_id=p_expected_branch_id
      and policy.effective_from<=p_service_date
      and (policy.effective_to is null or policy.effective_to>=p_service_date);
    select coalesce(jsonb_agg(jsonb_build_object('code',value->>'code','name',value->>'name',
      'capacity',(value->>'capacity')::integer) order by value->>'code'),'[]'::jsonb)
      into v_vehicles from jsonb_array_elements(v_policy.rule_payload->'vehicles') item(value);
    select coalesce(jsonb_agg(jsonb_build_object('membership_id',membership.id,
      'user_id',profile.id,'display_name',profile.display_name,'employee_code',profile.employee_code,
      'authorization_label',rule.value->>'authorization_label')
      order by profile.display_name collate "C",membership.id),'[]'::jsonb) into v_drivers
    from jsonb_array_elements(v_policy.rule_payload->'driver_authorizations') rule(value)
    join public.memberships membership on membership.id=(rule.value->>'membership_id')::uuid
      and membership.organization_id=p_expected_organization_id
      and membership.branch_id=p_expected_branch_id and membership.status='active'
      and membership.starts_at<=v_now and (membership.ends_at is null or membership.ends_at>v_now)
    join public.profiles profile on profile.id=membership.profile_id and profile.is_active
      and profile.kind='driver';
  end if;
  with visible as (select client.*,row_number() over(order by client.display_name collate "C",client.id) rn
    from public.clients client where client.organization_id=p_expected_organization_id
      and client.branch_id=p_expected_branch_id and client.status='active'
      and coalesce(client.admitted_on,p_service_date)<=p_service_date
      and (client.ended_on is null or client.ended_on>=p_service_date)
      and private.can_staff_access_client(client.id,'transport_plans.read'))
  select count(*),coalesce(jsonb_agg(jsonb_build_object('client_id',id,
    'client_code',client_code,'display_name',display_name)
    order by display_name collate "C",id) filter(where rn<=200),'[]'::jsonb)
  into v_client_total,v_clients from visible;
  with terminal as (
    select trip.*,decision.decision,decision.reason review_reason,
      decision.reviewed_by,decision.reviewer_display_name,decision.reviewed_at,
      case when cancellation.id is null then null else jsonb_build_object('id',cancellation.id,
       'actorName',cancellation.actor_name,'actorId',cancellation.actor_user_id,
       'reason',cancellation.reason,'cancelledAt',cancellation.cancelled_at,
       'planVersionId',cancellation.trip_version_id,'planVersion',(select p.version from public.transport_trip_plan_versions p where p.id=cancellation.trip_version_id)) end cancellation_evidence,
      (select jsonb_build_object('id',p.id,'version',p.version,'hash',p.content_hash,
       'conflictCount',jsonb_array_length(p.conflict_snapshot),'ruleId',p.rule_version_id,
       'startsAt',p.starts_at,'vehicleName',p.vehicle_name_snapshot)
       from public.transport_trip_plan_versions p join public.transport_trip_plan_decisions d on d.trip_version_id=p.id
       and d.decision in('publish','override') where p.trip_key=trip.trip_key
       and cancellation.id is null and not exists(select 1 from jsonb_array_elements(p.passenger_snapshot) passenger(value)
        where not private.can_staff_access_client((value->>'client_id')::uuid,'transport_plans.read'))
       order by p.version desc limit 1) cancellation_target,
      case when cancellation.id is not null then 'cancelled'
        when decision.decision in('publish','override') then 'published'
        when decision.decision='reject' then 'rejected' else trip.draft_status end result_status
    from public.transport_trip_plan_versions trip
    left join public.transport_trip_plan_decisions decision on decision.trip_version_id=trip.id
    left join private.transport_trip_cancellations cancellation on cancellation.trip_key=trip.trip_key
    where trip.organization_id=p_expected_organization_id and trip.branch_id=p_expected_branch_id
      and trip.service_date=p_service_date
      and not exists(select 1 from public.transport_trip_plan_versions child
        where child.previous_version_id=trip.id)
      and not exists(select 1 from jsonb_array_elements(trip.passenger_snapshot) passenger(value)
        where not private.can_staff_access_client((value->>'client_id')::uuid,'transport_plans.read'))
  ), matched as (select * from terminal where
      (p_direction='all' or direction=p_direction)
      and (coalesce(p_vehicle_query,'')='' or vehicle_code ilike '%'||p_vehicle_query||'%'
        or vehicle_name_snapshot ilike '%'||p_vehicle_query||'%')
      and (coalesce(p_driver_query,'')='' or driver_display_name_snapshot ilike '%'||p_driver_query||'%'
        or coalesce(driver_employee_code_snapshot,'') ilike '%'||p_driver_query||'%')
      and (p_status='all' or result_status=p_status)
  ), filtered as (select matched.*,row_number() over(order by starts_at,trip_key,version desc) rn
    from matched)
  select count(*),coalesce(sum(jsonb_array_length(passenger_snapshot)) filter(where result_status<>'cancelled'),0),
    coalesce(sum((select count(*) from jsonb_array_elements(conflict_snapshot) conflict(value)
      where value->>'code'='vehicle_capacity_exceeded')) filter(where result_status<>'cancelled'),0),
    coalesce(count(*) filter(where result_status in('draft_ready','draft_conflicted')),0),
    coalesce(jsonb_agg(jsonb_build_object('trip_version_id',id,'trip_key',trip_key,
      'version',version,'previous_version_id',previous_version_id,'content_hash',content_hash,
      'status',result_status,'direction',direction,'service_date',service_date,
      'starts_at',starts_at,'ends_at',ends_at,'vehicle_code',vehicle_code,
      'vehicle_name',vehicle_name_snapshot,'vehicle_capacity',vehicle_capacity_snapshot,
      'driver_membership_id',driver_membership_id,'driver_user_id',driver_user_id,
      'driver_display_name',driver_display_name_snapshot,
      'driver_employee_code',driver_employee_code_snapshot,
      'driver_authorization_label',driver_authorization_label_snapshot,
      'pickup_label',pickup_label,'dropoff_label',dropoff_label,
      'passenger_snapshot',passenger_snapshot,'conflict_snapshot',conflict_snapshot,
      'rule_version_id',rule_version_id,'rule_source_status',rule_source_status,
      'revision_reason',revision_reason,'created_by_user_id',created_by,
      'created_by_display_name',created_by_display_name,'created_at',created_at,
      'reviewed_by_user_id',reviewed_by,'reviewer_display_name',reviewer_display_name,
      'reviewed_at',reviewed_at,'review_reason',review_reason,
      'cancellation',cancellation_evidence,'cancellation_target',cancellation_target,'notification_status','not_configured') order by starts_at,trip_key,version desc)
      filter(where rn<=100),'[]'::jsonb)
  into v_trip_total,v_passengers,v_capacity,v_pending,v_trips from filtered;
  insert into public.audit_events(organization_id,branch_id,actor_user_id,action,
    table_name,row_pk,changed_fields,metadata) values(p_expected_organization_id,
    p_expected_branch_id,v_actor,'select','transport_trip_plan_snapshot',p_expected_branch_id::text,
    array['bounded_snapshot'],jsonb_build_object('workflow','page47_transport_plan_v1',
      'service_date',p_service_date,'trip_total',v_trip_total,'client_total',v_client_total,
      'generated_at',v_now));
  return query select p_expected_organization_id,p_expected_branch_id,v_now,v_policy_status,
    case when v_policy_count=1 then v_policy.id else null end,
    case when v_policy_count=1 then v_policy.version else null end,v_vehicles,v_drivers,
    v_clients,v_client_total,v_client_total>200,v_trips,v_trip_total,v_trip_total>100,
    v_passengers,v_capacity,v_pending,'not_configured'::text,'not_configured'::text,
    'not_configured'::text;
end;
$$;

create function public.transport_trip_plan_snapshot_v2(
  p_expected_organization_id uuid,p_expected_branch_id uuid,p_service_date date,
  p_direction text,p_vehicle_query text,p_driver_query text,p_status text
)
returns table(organization_id uuid,branch_id uuid,generated_at timestamptz,
  policy_status text,policy_version_id uuid,policy_version integer,vehicles jsonb,
  drivers jsonb,clients jsonb,client_total bigint,clients_truncated boolean,
  trips jsonb,matching_trip_total bigint,trips_truncated boolean,passenger_total bigint,
  capacity_conflict_total bigint,pending_publication_total bigint,offline_status text,
  export_status text,notification_provider_status text)
language sql volatile security invoker set search_path='' as $$
 select * from private.transport_trip_plan_snapshot_v2_response(p_expected_organization_id,
  p_expected_branch_id,p_service_date,p_direction,p_vehicle_query,p_driver_query,p_status);
$$;
revoke all on function private.transport_trip_plan_snapshot_v2_response(uuid,uuid,date,text,text,text,text),
 public.transport_trip_plan_snapshot_v2(uuid,uuid,date,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function private.transport_trip_plan_snapshot_v2_response(uuid,uuid,date,text,text,text,text),
 public.transport_trip_plan_snapshot_v2(uuid,uuid,date,text,text,text,text) to authenticated;
comment on function public.transport_trip_plan_snapshot_v2(uuid,uuid,date,text,text,text,text) is
 'Versioned Page-47 snapshot including immutable cancellation evidence; v1 remains rollback-compatible and omits cancelled trips.';

commit;
