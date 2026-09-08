-- Page 48: append-only transport execution bound to one currently-effective
-- Page-47 publication. The published trip is the assignment boundary for drivers.

insert into public.permissions (permission_key, description, risk_level) values
  ('transport_execution.read', 'Read scoped transport execution records', 2),
  ('transport_execution.record', 'Start assigned trips and record passenger movement', 3),
  ('transport_execution.exception', 'Record transport execution exceptions', 3),
  ('transport_execution.complete', 'Complete transport execution after pairing checks', 3),
  ('transport_execution.manage_any', 'Operate any transport trip in an authorized branch', 3)
on conflict (permission_key) do nothing;

insert into public.role_permissions (role_id, permission_id)
select role.id, permission.id from public.roles role cross join public.permissions permission
where role.is_system and role.role_key in ('organization_manager','branch_supervisor')
  and permission.permission_key like 'transport_execution.%'
on conflict (role_id, permission_id) do nothing;

insert into public.role_permissions (role_id, permission_id)
select role.id, permission.id from public.roles role cross join public.permissions permission
where role.is_system and role.role_key='transport_driver'
  and permission.permission_key in('transport_execution.read','transport_execution.record',
    'transport_execution.exception','transport_execution.complete')
on conflict (role_id, permission_id) do nothing;

create or replace function private.transport_execution_text_ok(
  p_value text,p_min integer,p_max integer
)
returns boolean language sql immutable security invoker set search_path='' as $$
  select p_value is not null and char_length(btrim(p_value)) between p_min and p_max
    and translate(p_value,E'\n\r\t','') !~ '[[:cntrl:]]';
$$;

create table public.transport_execution_streams (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  trip_key uuid not null,
  plan_version_id uuid not null,
  plan_content_hash text not null,
  plan_decision text not null,
  service_date date not null,
  started_by uuid not null references auth.users(id) on delete restrict,
  started_by_display_name text not null,
  started_session_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  content_hash text not null,
  constraint transport_execution_stream_branch_scope_fkey
    foreign key(branch_id,organization_id)
    references public.branches(id,organization_id) on delete restrict,
  constraint transport_execution_stream_plan_scope_fkey
    foreign key(plan_version_id,organization_id,branch_id)
    references public.transport_trip_plan_versions(id,organization_id,branch_id) on delete restrict,
  constraint transport_execution_stream_id_scope_key
    unique(id,organization_id,branch_id,plan_version_id,service_date,trip_key),
  constraint transport_execution_stream_trip_key unique(trip_key),
  constraint transport_execution_stream_plan_key unique(plan_version_id),
  constraint transport_execution_stream_decision_check
    check(plan_decision in('publish','override')),
  constraint transport_execution_stream_people_check
    check(private.transport_execution_text_ok(started_by_display_name,1,160)),
  constraint transport_execution_stream_hash_check
    check(plan_content_hash~'^[a-f0-9]{64}$' and content_hash~'^[a-f0-9]{64}$')
);

create table public.transport_execution_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  stream_id uuid not null,
  plan_version_id uuid not null,
  trip_key uuid not null,
  service_date date not null,
  sequence integer not null,
  event_type text not null,
  client_id uuid,
  occurred_at timestamptz not null,
  note text,
  resolves_pairing boolean not null default false,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  actor_display_name text not null,
  actor_session_id uuid not null,
  reauth_challenge_id uuid references private.reauth_challenges(id) on delete restrict,
  committed_at timestamptz not null default clock_timestamp(),
  content_hash text not null,
  constraint transport_execution_event_stream_scope_fkey
    foreign key(stream_id,organization_id,branch_id,plan_version_id,service_date,trip_key)
    references public.transport_execution_streams(
      id,organization_id,branch_id,plan_version_id,service_date,trip_key
    ) on delete restrict,
  constraint transport_execution_event_client_scope_fkey
    foreign key(client_id,organization_id,branch_id)
    references public.clients(id,organization_id,branch_id) on delete restrict,
  constraint transport_execution_event_id_scope_key
    unique(id,organization_id,branch_id),
  constraint transport_execution_event_full_scope_key
    unique(id,organization_id,branch_id,stream_id,plan_version_id,service_date,trip_key),
  constraint transport_execution_event_sequence_key unique(stream_id,sequence),
  constraint transport_execution_event_sequence_check check(sequence between 1 and 1001),
  constraint transport_execution_event_kind_check check(event_type in(
    'trip_started','passenger_boarded','passenger_alighted',
    'exception_recorded','trip_completed')),
  constraint transport_execution_event_shape_check check(
    (event_type='trip_started' and client_id is null and note is null
      and not resolves_pairing and reauth_challenge_id is null)
    or (event_type in('passenger_boarded','passenger_alighted') and client_id is not null
      and note is null and not resolves_pairing and reauth_challenge_id is null)
    or (event_type='exception_recorded' and note is not null
      and (not resolves_pairing or client_id is not null) and reauth_challenge_id is not null)
    or (event_type='trip_completed' and client_id is null and not resolves_pairing
      and reauth_challenge_id is not null)),
  constraint transport_execution_event_text_check check(
    private.transport_execution_text_ok(actor_display_name,1,160)
    and (note is null or private.transport_execution_text_ok(note,8,1000))),
  constraint transport_execution_event_date_check check(
    (occurred_at at time zone 'Asia/Taipei')::date=service_date),
  constraint transport_execution_event_hash_check check(content_hash~'^[a-f0-9]{64}$')
);

create table private.transport_execution_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  idempotency_key uuid not null,
  request_hash text not null,
  stream_id uuid not null,
  event_id uuid not null,
  event_type text not null,
  plan_version_id uuid not null,
  trip_key uuid not null,
  service_date date not null,
  client_id uuid,
  sequence integer not null,
  result_status text not null,
  actual_started_at timestamptz not null,
  actual_completed_at timestamptz,
  exception_count integer not null,
  unmatched_passenger_count integer not null,
  late_seconds integer not null,
  resolves_pairing boolean not null,
  event_content_hash text not null,
  plan_content_hash text not null,
  committed_at timestamptz not null,
  constraint transport_execution_operation_actor_key unique(actor_user_id,idempotency_key),
  constraint transport_execution_operation_stream_scope_fkey
    foreign key(stream_id,organization_id,branch_id,plan_version_id,service_date,trip_key)
    references public.transport_execution_streams(
      id,organization_id,branch_id,plan_version_id,service_date,trip_key
    )
    on delete restrict,
  constraint transport_execution_operation_event_scope_fkey
    foreign key(event_id,organization_id,branch_id,stream_id,plan_version_id,service_date,trip_key)
    references public.transport_execution_events(
      id,organization_id,branch_id,stream_id,plan_version_id,service_date,trip_key
    ) on delete restrict,
  constraint transport_execution_operation_sequence_check check(sequence between 1 and 1001),
  constraint transport_execution_operation_kind_check check(event_type in(
    'trip_started','passenger_boarded','passenger_alighted',
    'exception_recorded','trip_completed')),
  constraint transport_execution_operation_status_check check(result_status in(
    'in_progress','completed')),
  constraint transport_execution_operation_metrics_check check(
    exception_count>=0 and unmatched_passenger_count>=0 and late_seconds>=0
    and ((result_status='completed' and actual_completed_at is not null
      and unmatched_passenger_count=0)
      or (result_status='in_progress' and actual_completed_at is null))),
  constraint transport_execution_operation_hash_check check(
    request_hash~'^[a-f0-9]{64}$' and event_content_hash~'^[a-f0-9]{64}$'
    and plan_content_hash~'^[a-f0-9]{64}$')
);

create index transport_execution_stream_scope_date_idx
  on public.transport_execution_streams(organization_id,branch_id,service_date,created_at);
create index transport_execution_stream_started_by_idx
  on public.transport_execution_streams(started_by);
create index transport_execution_stream_started_session_idx
  on public.transport_execution_streams(started_session_id);
create index transport_execution_event_scope_time_idx
  on public.transport_execution_events(organization_id,branch_id,service_date,occurred_at);
create index transport_execution_event_plan_idx
  on public.transport_execution_events(plan_version_id);
create index transport_execution_event_trip_idx
  on public.transport_execution_events(trip_key,sequence);
create index transport_execution_event_client_idx
  on public.transport_execution_events(client_id) where client_id is not null;
create index transport_execution_event_actor_idx
  on public.transport_execution_events(actor_user_id,committed_at desc);
create index transport_execution_event_reauth_idx
  on public.transport_execution_events(reauth_challenge_id)
  where reauth_challenge_id is not null;
create unique index transport_execution_event_one_start_idx
  on public.transport_execution_events(stream_id) where event_type='trip_started';
create unique index transport_execution_event_one_complete_idx
  on public.transport_execution_events(stream_id) where event_type='trip_completed';
create unique index transport_execution_event_one_passenger_movement_idx
  on public.transport_execution_events(stream_id,client_id,event_type)
  where event_type in('passenger_boarded','passenger_alighted');
create unique index transport_execution_event_one_pairing_resolution_idx
  on public.transport_execution_events(stream_id,client_id)
  where event_type='exception_recorded' and resolves_pairing;
create index transport_execution_operation_scope_idx
  on private.transport_execution_operations(organization_id,branch_id,committed_at desc);
create index transport_execution_operation_stream_idx
  on private.transport_execution_operations(stream_id,sequence);
create index transport_execution_operation_event_idx
  on private.transport_execution_operations(event_id);
create index transport_execution_operation_plan_idx
  on private.transport_execution_operations(plan_version_id);
create index transport_execution_operation_trip_date_idx
  on private.transport_execution_operations(trip_key,service_date);

create or replace function private.prevent_transport_execution_mutation()
returns trigger language plpgsql set search_path='' as $$
begin
  raise exception using errcode='55000',message='transport execution evidence is append-only';
end;
$$;

create trigger transport_execution_streams_append_only before update or delete
on public.transport_execution_streams for each row
execute function private.prevent_transport_execution_mutation();
create trigger transport_execution_events_append_only before update or delete
on public.transport_execution_events for each row
execute function private.prevent_transport_execution_mutation();
create trigger transport_execution_operations_append_only before update or delete
on private.transport_execution_operations for each row
execute function private.prevent_transport_execution_mutation();

create trigger transport_execution_streams_audit_row_change
after insert or update or delete on public.transport_execution_streams
for each row execute function private.audit_row_change();
create trigger transport_execution_events_audit_row_change
after insert or update or delete on public.transport_execution_events
for each row execute function private.audit_row_change();
create trigger transport_execution_operations_audit_row_change
after insert or update or delete on private.transport_execution_operations
for each row execute function private.audit_row_change();

alter table public.transport_execution_streams enable row level security;
alter table public.transport_execution_streams force row level security;
alter table public.transport_execution_events enable row level security;
alter table public.transport_execution_events force row level security;
alter table private.transport_execution_operations enable row level security;
alter table private.transport_execution_operations force row level security;
revoke all on table public.transport_execution_streams from anon,authenticated,service_role;
revoke all on table public.transport_execution_events from anon,authenticated,service_role;
revoke all on table private.transport_execution_operations from anon,authenticated,service_role;

create or replace function private.transport_execution_authority(
  p_organization_id uuid,p_branch_id uuid,p_permission text
)
returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and exists(select 1 from public.branches branch
    where branch.id=p_branch_id and branch.organization_id=p_organization_id and branch.is_active)
    and private.has_permission(p_organization_id,p_branch_id,'clients.read')
    and private.has_permission(p_organization_id,p_branch_id,'transport_execution.read')
    and private.has_permission(p_organization_id,p_branch_id,p_permission);
$$;

create or replace function private.require_transport_execution_aal2(p_actor uuid)
returns uuid language plpgsql stable security definer set search_path='' as $$
declare v_session_id uuid;
begin
  if p_actor is null or p_actor<>auth.uid() or coalesce(auth.jwt()->>'aal','')<>'aal2'
     or not exists(select 1 from public.profiles profile where profile.id=p_actor
       and profile.is_active and profile.kind in('staff','driver')) then
    raise exception using errcode='42501',message='transport execution employee AAL2 required';
  end if;
  begin v_session_id:=nullif(auth.jwt()->>'session_id','')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode='42501',message='transport execution employee AAL2 required';
  end;
  if v_session_id is null then
    raise exception using errcode='42501',message='transport execution employee AAL2 required';
  end if;
  return v_session_id;
end;
$$;

create or replace function private.require_transport_execution_reauth(
  p_actor uuid,p_session_id uuid,p_reference_time timestamptz
)
returns uuid language plpgsql volatile security definer set search_path='' as $$
declare v_challenge_id uuid;
begin
  select challenge.id into v_challenge_id from private.reauth_events event
  join private.reauth_challenges challenge on challenge.id=event.challenge_id
    and challenge.user_id=event.user_id and challenge.session_id=event.session_id
  where event.user_id=p_actor and event.session_id=p_session_id and event.aal='aal2'
    and event.revoked_at is null and event.verification_method in('totp','webauthn','phone')
    and challenge.consumed_at is not null and challenge.invalidated_at is null
    and challenge.factor_method=event.verification_method
    and event.verified_at>=p_reference_time-interval '15 minutes'
    and event.verified_at<=p_reference_time+interval '30 seconds'
  order by event.verified_at desc,event.id desc limit 1;
  if v_challenge_id is null then
    raise exception using errcode='42501',message='recent same-session transport reauthentication required';
  end if;
  return v_challenge_id;
end;
$$;

create or replace function private.transport_execution_unmatched_count(
  p_stream_id uuid,p_passengers jsonb
)
returns integer language sql stable security definer set search_path='' as $$
  select case when p_stream_id is null then 0 else count(*)::integer end
  from jsonb_array_elements(p_passengers) passenger(value)
  where p_stream_id is not null
    and not exists(select 1 from public.transport_execution_events resolution
      where resolution.stream_id=p_stream_id
        and resolution.client_id=(passenger.value->>'client_id')::uuid
        and resolution.event_type='exception_recorded' and resolution.resolves_pairing)
    and not (
      exists(select 1 from public.transport_execution_events boarded
        where boarded.stream_id=p_stream_id
          and boarded.client_id=(passenger.value->>'client_id')::uuid
          and boarded.event_type='passenger_boarded')
      and exists(select 1 from public.transport_execution_events alighted
        where alighted.stream_id=p_stream_id
          and alighted.client_id=(passenger.value->>'client_id')::uuid
          and alighted.event_type='passenger_alighted'));
$$;

create or replace function private.transport_execution_operation_result(
  p_operation private.transport_execution_operations,p_replayed boolean
)
returns table(operation_id uuid,event_id uuid,event_type text,plan_version_id uuid,
  trip_key uuid,client_id uuid,sequence integer,status text,actual_started_at timestamptz,
  actual_completed_at timestamptz,exception_count integer,unmatched_passenger_count integer,
  late_seconds integer,resolves_pairing boolean,event_content_hash text,
  plan_content_hash text,committed_at timestamptz,replayed boolean)
language sql stable set search_path='' as $$
  select p_operation.id,p_operation.event_id,p_operation.event_type,
    p_operation.plan_version_id,p_operation.trip_key,p_operation.client_id,
    p_operation.sequence,p_operation.result_status,p_operation.actual_started_at,
    p_operation.actual_completed_at,p_operation.exception_count,
    p_operation.unmatched_passenger_count,p_operation.late_seconds,
    p_operation.resolves_pairing,p_operation.event_content_hash,
    p_operation.plan_content_hash,p_operation.committed_at,p_replayed;
$$;

create or replace function private.block_transport_republication_after_execution()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.decision in('publish','override') and exists(
    select 1 from public.transport_execution_streams stream
    where stream.trip_key=new.trip_key) then
    raise exception using errcode='55000',
      message='an executing transport trip cannot publish another plan version';
  end if;
  return new;
end;
$$;

create trigger transport_decision_execution_guard before insert
on public.transport_trip_plan_decisions for each row
execute function private.block_transport_republication_after_execution();

create or replace function private.mutate_transport_execution_guarded(
  p_expected_organization_id uuid,p_expected_branch_id uuid,
  p_payload jsonb,p_idempotency_key uuid
)
returns table(operation_id uuid,event_id uuid,event_type text,plan_version_id uuid,
  trip_key uuid,client_id uuid,sequence integer,status text,actual_started_at timestamptz,
  actual_completed_at timestamptz,exception_count integer,unmatched_passenger_count integer,
  late_seconds integer,resolves_pairing boolean,event_content_hash text,
  plan_content_hash text,committed_at timestamptz,replayed boolean)
language plpgsql volatile security definer set search_path='' as $$
declare
  v_actor uuid:=auth.uid(); v_now timestamptz:=clock_timestamp(); v_session_id uuid;
  v_reauth uuid; v_required_permission text; v_request_hash text;
  v_existing private.transport_execution_operations%rowtype;
  v_operation private.transport_execution_operations%rowtype;
  v_profile public.profiles%rowtype; v_plan public.transport_trip_plan_versions%rowtype;
  v_plan_decision text; v_stream public.transport_execution_streams%rowtype;
  v_event public.transport_execution_events%rowtype;
  v_event_type text; v_plan_version_id uuid; v_expected_trip_key uuid;
  v_expected_plan_hash text; v_expected_sequence integer; v_occurred_at timestamptz;
  v_client_id uuid; v_note text; v_resolves boolean; v_current_sequence integer;
  v_previous_time timestamptz; v_started_at timestamptz; v_completed_at timestamptz;
  v_exception_count integer; v_unmatched integer; v_late integer; v_status text;
  v_event_hash text; v_stream_hash text; v_client_count integer; v_passenger_count integer;
  v_client uuid; v_boarded boolean; v_alighted boolean; v_resolved boolean;
begin
  if p_expected_organization_id is null or p_expected_branch_id is null
     or p_idempotency_key is null or jsonb_typeof(p_payload)<>'object'
     or not (p_payload ?& array['event_type','plan_version_id','expected_trip_key',
       'expected_plan_content_hash','expected_sequence','occurred_at','client_id','note',
       'resolves_pairing'])
     or p_payload-array['event_type','plan_version_id','expected_trip_key',
       'expected_plan_content_hash','expected_sequence','occurred_at','client_id','note',
       'resolves_pairing']<>'{}'::jsonb then
    raise exception using errcode='22023',message='unsupported transport execution field';
  end if;
  if jsonb_typeof(p_payload->'event_type')<>'string'
     or jsonb_typeof(p_payload->'plan_version_id')<>'string'
     or jsonb_typeof(p_payload->'expected_trip_key')<>'string'
     or jsonb_typeof(p_payload->'expected_plan_content_hash')<>'string'
     or jsonb_typeof(p_payload->'expected_sequence')<>'number'
     or coalesce(p_payload->>'expected_sequence','')!~'^[0-9]+$'
     or jsonb_typeof(p_payload->'occurred_at')<>'string'
     or coalesce(p_payload->>'occurred_at','')!~'([zZ]|[+-][0-9]{2}:[0-9]{2})$'
     or jsonb_typeof(p_payload->'client_id') not in('string','null')
     or jsonb_typeof(p_payload->'note') not in('string','null')
     or jsonb_typeof(p_payload->'resolves_pairing')<>'boolean' then
    raise exception using errcode='22023',message='invalid transport execution field type';
  end if;
  v_event_type:=p_payload->>'event_type';
  v_plan_version_id:=(p_payload->>'plan_version_id')::uuid;
  v_expected_trip_key:=(p_payload->>'expected_trip_key')::uuid;
  v_expected_plan_hash:=p_payload->>'expected_plan_content_hash';
  v_expected_sequence:=(p_payload->>'expected_sequence')::integer;
  v_occurred_at:=(p_payload->>'occurred_at')::timestamptz;
  v_client_id:=nullif(p_payload->>'client_id','')::uuid;
  v_note:=case when p_payload->'note'='null'::jsonb then null else btrim(p_payload->>'note') end;
  v_resolves:=(p_payload->>'resolves_pairing')::boolean;
  if v_event_type not in('trip_started','passenger_boarded','passenger_alighted',
       'exception_recorded','trip_completed')
     or coalesce(v_expected_plan_hash,'')!~'^[a-f0-9]{64}$'
     or v_expected_sequence not between 0 and 1000
     or (v_event_type='trip_started' and (v_client_id is not null or v_note is not null or v_resolves))
     or (v_event_type in('passenger_boarded','passenger_alighted')
       and (v_client_id is null or v_note is not null or v_resolves))
     or (v_event_type='exception_recorded' and (v_note is null
       or not private.transport_execution_text_ok(v_note,8,1000)
       or (v_resolves and v_client_id is null)))
     or (v_event_type='trip_completed' and (v_client_id is not null or v_resolves
       or (v_note is not null and not private.transport_execution_text_ok(v_note,8,1000)))) then
    raise exception using errcode='23514',message='invalid transport execution payload';
  end if;
  v_required_permission:=case
    when v_event_type='exception_recorded' then 'transport_execution.exception'
    when v_event_type='trip_completed' then 'transport_execution.complete'
    else 'transport_execution.record' end;
  if not private.transport_execution_authority(p_expected_organization_id,
       p_expected_branch_id,v_required_permission) then
    raise exception using errcode='42501',message='transport execution operation not permitted';
  end if;
  v_session_id:=private.require_transport_execution_aal2(v_actor);
  if v_event_type in('exception_recorded','trip_completed') then
    v_reauth:=private.require_transport_execution_reauth(v_actor,v_session_id,v_now);
  end if;
  select * into v_profile from public.profiles profile
  where profile.id=v_actor and profile.is_active and profile.kind in('staff','driver') for share;
  if not found then raise exception using errcode='42501',message='inactive transport actor'; end if;
  v_request_hash:=encode(sha256(convert_to(jsonb_build_object('schema_version',1,
    'organization_id',p_expected_organization_id,'branch_id',p_expected_branch_id,
    'actor_user_id',v_actor,'payload',p_payload)::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended('transport-execution-operation:'||
    v_actor::text||':'||p_idempotency_key::text,48));
  select * into v_existing from private.transport_execution_operations operation
  where operation.actor_user_id=v_actor and operation.idempotency_key=p_idempotency_key;
  if found then
    if v_existing.organization_id<>p_expected_organization_id
       or v_existing.branch_id<>p_expected_branch_id
       or v_existing.request_hash<>v_request_hash then
      raise exception using errcode='23505',message='transport execution idempotency conflict';
    end if;
    select * into v_plan from public.transport_trip_plan_versions plan
    where plan.id=v_existing.plan_version_id
      and plan.organization_id=p_expected_organization_id
      and plan.branch_id=p_expected_branch_id;
    if not found or (v_plan.driver_user_id<>v_actor and not private.has_permission(
      p_expected_organization_id,p_expected_branch_id,'transport_execution.manage_any'))
      or not exists(select 1 from public.memberships membership
        join public.profiles driver on driver.id=membership.profile_id
          and driver.id=v_plan.driver_user_id and driver.is_active and driver.kind='driver'
        where membership.id=v_plan.driver_membership_id
          and membership.organization_id=p_expected_organization_id
          and membership.branch_id=p_expected_branch_id and membership.status='active'
          and membership.starts_at<=v_plan.starts_at
          and (membership.ends_at is null or membership.ends_at>=v_plan.ends_at)) then
      raise exception using errcode='42501',message='transport replay authority expired';
    end if;
    return query select * from private.transport_execution_operation_result(v_existing,true);
    return;
  end if;

  -- Use the same Page-47 trip lock so publication and execution cannot cross.
  perform pg_advisory_xact_lock(hashtextextended(
    'transport-trip:'||v_expected_trip_key::text,47));
  select plan.* into v_plan from public.transport_trip_plan_versions plan
  where plan.id=v_plan_version_id and plan.trip_key=v_expected_trip_key
    and plan.content_hash=v_expected_plan_hash
    and plan.organization_id=p_expected_organization_id
    and plan.branch_id=p_expected_branch_id
    and exists(select 1 from public.transport_trip_plan_decisions decision
      where decision.trip_version_id=plan.id and decision.decision in('publish','override'))
    and not exists(select 1 from public.transport_trip_plan_versions newer
      join public.transport_trip_plan_decisions newer_decision
        on newer_decision.trip_version_id=newer.id
        and newer_decision.decision in('publish','override')
      where newer.trip_key=plan.trip_key and newer.version>plan.version);
  if not found then raise exception using errcode='40001',
    message='transport plan is not the latest effective publication'; end if;
  select decision.decision into v_plan_decision from public.transport_trip_plan_decisions decision
  where decision.trip_version_id=v_plan.id;

  perform pg_advisory_xact_lock(hashtextextended('transport-vehicle:'||
    p_expected_branch_id::text||':'||lower(v_plan.vehicle_code),47));
  perform pg_advisory_xact_lock(hashtextextended('transport-driver:'||
    p_expected_branch_id::text||':'||v_plan.driver_membership_id::text,47));
  for v_client in select (passenger.value->>'client_id')::uuid
    from jsonb_array_elements(v_plan.passenger_snapshot) passenger(value)
    order by (passenger.value->>'client_id')::uuid
  loop
    perform pg_advisory_xact_lock(hashtextextended('transport-client:'||
      p_expected_branch_id::text||':'||v_client::text,47));
  end loop;

  -- Re-read every authority and business boundary after all stable-order locks.
  if not private.transport_execution_authority(p_expected_organization_id,
       p_expected_branch_id,v_required_permission) then
    raise exception using errcode='42501',message='transport execution authority changed';
  end if;
  select plan.* into v_plan from public.transport_trip_plan_versions plan
  where plan.id=v_plan_version_id and plan.trip_key=v_expected_trip_key
    and plan.content_hash=v_expected_plan_hash
    and plan.organization_id=p_expected_organization_id
    and plan.branch_id=p_expected_branch_id
    and exists(select 1 from public.transport_trip_plan_decisions decision
      where decision.trip_version_id=plan.id and decision.decision in('publish','override'))
    and not exists(select 1 from public.transport_trip_plan_versions newer
      join public.transport_trip_plan_decisions newer_decision
        on newer_decision.trip_version_id=newer.id
        and newer_decision.decision in('publish','override')
      where newer.trip_key=plan.trip_key and newer.version>plan.version);
  if not found then raise exception using errcode='40001',
    message='transport plan changed while recording execution'; end if;
  if v_plan.driver_user_id<>v_actor and not private.has_permission(
       p_expected_organization_id,p_expected_branch_id,'transport_execution.manage_any') then
    raise exception using errcode='42501',message='transport trip is not assigned to actor';
  end if;
  if not exists(select 1 from public.memberships membership
    join public.profiles driver on driver.id=membership.profile_id
      and driver.id=v_plan.driver_user_id and driver.is_active and driver.kind='driver'
    where membership.id=v_plan.driver_membership_id
      and membership.organization_id=p_expected_organization_id
      and membership.branch_id=p_expected_branch_id and membership.status='active'
      and membership.starts_at<=v_plan.starts_at
      and (membership.ends_at is null or membership.ends_at>=v_plan.ends_at)) then
    raise exception using errcode='42501',message='published transport driver is no longer valid';
  end if;
  v_passenger_count:=jsonb_array_length(v_plan.passenger_snapshot);
  select count(*) into v_client_count from jsonb_array_elements(
    v_plan.passenger_snapshot) passenger(value)
  join public.clients client on client.id=(passenger.value->>'client_id')::uuid
    and client.organization_id=p_expected_organization_id
    and client.branch_id=p_expected_branch_id and client.status='active'
    and coalesce(client.admitted_on,v_plan.service_date)<=v_plan.service_date
    and (client.ended_on is null or client.ended_on>=v_plan.service_date);
  if v_client_count<>v_passenger_count then
    raise exception using errcode='42501',message='published passenger scope is no longer valid';
  end if;
  if (v_occurred_at at time zone 'Asia/Taipei')::date<>v_plan.service_date
     or v_occurred_at>v_now+interval '5 minutes' then
    raise exception using errcode='23514',message='transport event time is outside service boundary';
  end if;

  select * into v_stream from public.transport_execution_streams stream
  where stream.trip_key=v_plan.trip_key for share;
  if v_event_type='trip_started' then
    if found or v_expected_sequence<>0 then
      raise exception using errcode='40001',message='transport trip already started';
    end if;
    v_stream_hash:=encode(sha256(convert_to(jsonb_build_object('schema_version',1,
      'organization_id',p_expected_organization_id,'branch_id',p_expected_branch_id,
      'trip_key',v_plan.trip_key,'plan_version_id',v_plan.id,
      'plan_content_hash',v_plan.content_hash,'plan_decision',v_plan_decision,
      'service_date',v_plan.service_date,'started_by',v_actor,
      'started_session_id',v_session_id,'created_at',v_now)::text,'UTF8')),'hex');
    insert into public.transport_execution_streams(organization_id,branch_id,trip_key,
      plan_version_id,plan_content_hash,plan_decision,service_date,started_by,
      started_by_display_name,started_session_id,created_at,content_hash)
    values(p_expected_organization_id,p_expected_branch_id,v_plan.trip_key,v_plan.id,
      v_plan.content_hash,v_plan_decision,v_plan.service_date,v_actor,v_profile.display_name,
      v_session_id,v_now,v_stream_hash) returning * into v_stream;
    v_current_sequence:=0; v_previous_time:=null;
  else
    if not found or v_stream.plan_version_id<>v_plan.id
       or v_stream.plan_content_hash<>v_plan.content_hash then
      raise exception using errcode='55000',message='transport trip must start from this plan first';
    end if;
    select coalesce(max(event.sequence),0),max(event.occurred_at),
      coalesce(bool_or(event.event_type='trip_completed'),false)
    into v_current_sequence,v_previous_time,v_resolved
    from public.transport_execution_events event where event.stream_id=v_stream.id;
    if v_resolved then raise exception using errcode='55000',
      message='completed transport trip cannot receive another event'; end if;
    if v_current_sequence<>v_expected_sequence then
      raise exception using errcode='40001',message='transport execution sequence changed'; end if;
    if v_previous_time is not null and v_occurred_at<v_previous_time then
      raise exception using errcode='23514',message='transport event time cannot move backwards';
    end if;
  end if;

  if v_event_type<>'trip_started' and v_expected_sequence=0 then
    raise exception using errcode='55000',message='transport trip must start first';
  end if;
  if v_event_type in('passenger_boarded','passenger_alighted','exception_recorded')
     and v_client_id is not null and not exists(select 1
       from jsonb_array_elements(v_plan.passenger_snapshot) passenger(value)
       where (passenger.value->>'client_id')::uuid=v_client_id) then
    raise exception using errcode='23503',message='client is not a passenger on this plan';
  end if;
  if v_client_id is not null then
    select exists(select 1 from public.transport_execution_events event
        where event.stream_id=v_stream.id and event.client_id=v_client_id
          and event.event_type='passenger_boarded'),
      exists(select 1 from public.transport_execution_events event
        where event.stream_id=v_stream.id and event.client_id=v_client_id
          and event.event_type='passenger_alighted'),
      exists(select 1 from public.transport_execution_events event
        where event.stream_id=v_stream.id and event.client_id=v_client_id
          and event.event_type='exception_recorded' and event.resolves_pairing)
    into v_boarded,v_alighted,v_resolved;
  end if;
  if v_event_type='passenger_boarded' and (v_boarded or v_alighted or v_resolved) then
    raise exception using errcode='23514',message='passenger boarding is duplicate or already resolved';
  elsif v_event_type='passenger_alighted' and (not v_boarded or v_alighted or v_resolved) then
    raise exception using errcode='23514',message='passenger must board before alighting';
  elsif v_event_type='exception_recorded' and v_resolves
        and (v_resolved or (v_boarded and v_alighted)) then
    raise exception using errcode='23514',message='passenger pairing is already resolved';
  elsif v_event_type='trip_completed' and private.transport_execution_unmatched_count(
        v_stream.id,v_plan.passenger_snapshot)<>0 then
    raise exception using errcode='23514',message='all passenger pairs require evidence or resolution';
  end if;

  v_event_hash:=encode(sha256(convert_to(jsonb_build_object('schema_version',1,
    'organization_id',p_expected_organization_id,'branch_id',p_expected_branch_id,
    'stream_id',v_stream.id,'plan_version_id',v_plan.id,'trip_key',v_plan.trip_key,
    'service_date',v_plan.service_date,'sequence',v_expected_sequence+1,
    'event_type',v_event_type,'client_id',v_client_id,'occurred_at',v_occurred_at,
    'note',v_note,'resolves_pairing',v_resolves,'actor_user_id',v_actor,
    'actor_session_id',v_session_id,'reauth_challenge_id',v_reauth,
    'committed_at',v_now)::text,'UTF8')),'hex');
  insert into public.transport_execution_events(organization_id,branch_id,stream_id,
    plan_version_id,trip_key,service_date,sequence,event_type,client_id,occurred_at,note,
    resolves_pairing,actor_user_id,actor_display_name,actor_session_id,
    reauth_challenge_id,committed_at,content_hash)
  values(p_expected_organization_id,p_expected_branch_id,v_stream.id,v_plan.id,
    v_plan.trip_key,v_plan.service_date,v_expected_sequence+1,v_event_type,v_client_id,
    v_occurred_at,v_note,v_resolves,v_actor,v_profile.display_name,v_session_id,
    v_reauth,v_now,v_event_hash) returning * into v_event;

  select min(event.occurred_at) filter(where event.event_type='trip_started'),
    max(event.occurred_at) filter(where event.event_type='trip_completed'),
    count(*) filter(where event.event_type='exception_recorded')::integer
  into v_started_at,v_completed_at,v_exception_count
  from public.transport_execution_events event where event.stream_id=v_stream.id;
  v_unmatched:=private.transport_execution_unmatched_count(v_stream.id,v_plan.passenger_snapshot);
  v_status:=case when v_completed_at is null then 'in_progress' else 'completed' end;
  v_late:=greatest(0,floor(extract(epoch from v_started_at-v_plan.starts_at)))::integer;
  insert into private.transport_execution_operations(organization_id,branch_id,
    actor_user_id,idempotency_key,request_hash,stream_id,event_id,event_type,
    plan_version_id,trip_key,service_date,client_id,sequence,result_status,actual_started_at,
    actual_completed_at,exception_count,unmatched_passenger_count,late_seconds,
    resolves_pairing,event_content_hash,plan_content_hash,committed_at)
  values(p_expected_organization_id,p_expected_branch_id,v_actor,p_idempotency_key,
    v_request_hash,v_stream.id,v_event.id,v_event_type,v_plan.id,v_plan.trip_key,
    v_plan.service_date,v_client_id,v_event.sequence,v_status,v_started_at,v_completed_at,v_exception_count,
    v_unmatched,v_late,v_resolves,v_event_hash,v_plan.content_hash,v_now)
  returning * into v_operation;
  return query select * from private.transport_execution_operation_result(v_operation,false);
end;
$$;

create or replace function public.mutate_transport_execution(
  p_expected_organization_id uuid,p_expected_branch_id uuid,
  p_payload jsonb,p_idempotency_key uuid
)
returns table(operation_id uuid,event_id uuid,event_type text,plan_version_id uuid,
  trip_key uuid,client_id uuid,sequence integer,status text,actual_started_at timestamptz,
  actual_completed_at timestamptz,exception_count integer,unmatched_passenger_count integer,
  late_seconds integer,resolves_pairing boolean,event_content_hash text,
  plan_content_hash text,committed_at timestamptz,replayed boolean)
language sql volatile security invoker set search_path='' as $$
  select * from private.mutate_transport_execution_guarded(p_expected_organization_id,
    p_expected_branch_id,p_payload,p_idempotency_key);
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

create or replace function private.transport_execution_snapshot_response(
  p_expected_organization_id uuid,p_expected_branch_id uuid,p_service_date date,
  p_vehicle_query text,p_driver_query text,p_completion_status text,p_exception_status text
)
returns table(organization_id uuid,branch_id uuid,generated_at timestamptz,
  trips jsonb,matching_trip_total bigint,trips_truncated boolean,pending_total bigint,
  in_progress_total bigint,completed_total bigint,late_total bigint,
  unmatched_trip_total bigint,late_definition text,offline_status text,
  export_status text,notification_status text)
language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); v_now timestamptz:=clock_timestamp();
  v_trips jsonb:='[]'::jsonb; v_total bigint:=0; v_pending bigint:=0;
  v_progress bigint:=0; v_completed bigint:=0; v_late bigint:=0; v_unmatched bigint:=0;
  v_manage_any boolean;
begin
  if p_service_date is null or extract(year from p_service_date) not between 1900 and 2200
     or char_length(coalesce(p_vehicle_query,''))>80
     or coalesce(p_vehicle_query,'')~'[[:cntrl:]]'
     or char_length(coalesce(p_driver_query,''))>80
     or coalesce(p_driver_query,'')~'[[:cntrl:]]'
     or p_completion_status not in('all','not_started','in_progress','completed')
     or p_exception_status not in('all','with_exception','without_exception','late','unmatched')
     or not private.transport_execution_authority(p_expected_organization_id,
       p_expected_branch_id,'transport_execution.read') then
    raise exception using errcode='42501',message='transport execution snapshot not permitted';
  end if;
  v_manage_any:=private.has_permission(p_expected_organization_id,p_expected_branch_id,
    'transport_execution.manage_any');
  with matched as (
    select projection.* from private.transport_execution_projection(
      p_expected_organization_id,p_expected_branch_id) projection
    where projection.service_date=p_service_date
      and (v_manage_any or projection.driver_user_id=v_actor)
      and (coalesce(p_vehicle_query,'')='' or projection.vehicle_code ilike '%'||p_vehicle_query||'%'
        or projection.vehicle_name ilike '%'||p_vehicle_query||'%')
      and (coalesce(p_driver_query,'')='' or projection.driver_display_name ilike '%'||p_driver_query||'%')
      and (p_completion_status='all' or projection.status=p_completion_status)
      and (p_exception_status='all'
        or (p_exception_status='with_exception' and projection.exception_count>0)
        or (p_exception_status='without_exception' and projection.exception_count=0)
        or (p_exception_status='late' and coalesce(projection.late_seconds,0)>0)
        or (p_exception_status='unmatched' and projection.unmatched_passenger_count>0))
  ), ranked as (
    select matched.*,row_number() over(order by planned_starts_at,trip_key) rn from matched
  )
  select count(*),count(*) filter(where status='not_started'),
    count(*) filter(where status='in_progress'),count(*) filter(where status='completed'),
    count(*) filter(where coalesce(late_seconds,0)>0),
    count(*) filter(where unmatched_passenger_count>0),
    coalesce(jsonb_agg(jsonb_build_object('plan_version_id',plan_version_id,
      'trip_key',trip_key,'plan_version',plan_version,'plan_content_hash',plan_content_hash,
      'plan_decision',plan_decision,'direction',direction,'service_date',service_date,
      'planned_starts_at',planned_starts_at,'planned_ends_at',planned_ends_at,
      'vehicle_code',vehicle_code,'vehicle_name',vehicle_name,
      'driver_membership_id',driver_membership_id,'driver_user_id',driver_user_id,
      'driver_display_name',driver_display_name,'pickup_label',pickup_label,
      'dropoff_label',dropoff_label,'passengers',passengers,'events',events,
      'events_truncated',events_truncated,'execution_sequence',execution_sequence,
      'status',status,'actual_started_at',actual_started_at,
      'actual_completed_at',actual_completed_at,'late_seconds',late_seconds,
      'exception_count',exception_count,'unmatched_passenger_count',unmatched_passenger_count)
      order by planned_starts_at,trip_key) filter(where rn<=100),'[]'::jsonb)
  into v_total,v_pending,v_progress,v_completed,v_late,v_unmatched,v_trips from ranked;
  insert into public.audit_events(organization_id,branch_id,actor_user_id,action,
    table_name,row_pk,changed_fields,metadata) values(p_expected_organization_id,
    p_expected_branch_id,v_actor,'select','transport_execution_snapshot',
    p_expected_branch_id::text,array['bounded_snapshot'],jsonb_build_object(
      'workflow','page48_transport_execution_v1','service_date',p_service_date,
      'trip_total',v_total,'generated_at',v_now));
  return query select p_expected_organization_id,p_expected_branch_id,v_now,v_trips,
    v_total,v_total>100,v_pending,v_progress,v_completed,v_late,v_unmatched,
    'actual_start_after_planned_start'::text,'not_configured'::text,
    'not_configured'::text,'not_configured'::text;
end;
$$;

create or replace function public.transport_execution_snapshot(
  p_expected_organization_id uuid,p_expected_branch_id uuid,p_service_date date,
  p_vehicle_query text,p_driver_query text,p_completion_status text,p_exception_status text
)
returns table(organization_id uuid,branch_id uuid,generated_at timestamptz,
  trips jsonb,matching_trip_total bigint,trips_truncated boolean,pending_total bigint,
  in_progress_total bigint,completed_total bigint,late_total bigint,
  unmatched_trip_total bigint,late_definition text,offline_status text,
  export_status text,notification_status text)
language sql volatile security invoker set search_path='' as $$
  select * from private.transport_execution_snapshot_response(p_expected_organization_id,
    p_expected_branch_id,p_service_date,p_vehicle_query,p_driver_query,
    p_completion_status,p_exception_status);
$$;

revoke all on function private.transport_execution_text_ok(text,integer,integer)
  from public,anon,authenticated,service_role;
revoke all on function private.prevent_transport_execution_mutation()
  from public,anon,authenticated,service_role;
revoke all on function private.transport_execution_authority(uuid,uuid,text)
  from public,anon,authenticated,service_role;
revoke all on function private.require_transport_execution_aal2(uuid)
  from public,anon,authenticated,service_role;
revoke all on function private.require_transport_execution_reauth(uuid,uuid,timestamptz)
  from public,anon,authenticated,service_role;
revoke all on function private.transport_execution_unmatched_count(uuid,jsonb)
  from public,anon,authenticated,service_role;
revoke all on function private.transport_execution_operation_result(
  private.transport_execution_operations,boolean)
  from public,anon,authenticated,service_role;
revoke all on function private.block_transport_republication_after_execution()
  from public,anon,authenticated,service_role;
revoke all on function private.mutate_transport_execution_guarded(uuid,uuid,jsonb,uuid)
  from public,anon,authenticated,service_role;
revoke all on function private.transport_execution_projection(uuid,uuid)
  from public,anon,authenticated,service_role;
revoke all on function private.transport_execution_snapshot_response(
  uuid,uuid,date,text,text,text,text)
  from public,anon,authenticated,service_role;
revoke all on function public.mutate_transport_execution(uuid,uuid,jsonb,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.transport_execution_snapshot(uuid,uuid,date,text,text,text,text)
  from public,anon,authenticated,service_role;
grant execute on function private.mutate_transport_execution_guarded(uuid,uuid,jsonb,uuid)
  to authenticated;
grant execute on function private.transport_execution_snapshot_response(
  uuid,uuid,date,text,text,text,text) to authenticated;
grant execute on function public.mutate_transport_execution(uuid,uuid,jsonb,uuid)
  to authenticated;
grant execute on function public.transport_execution_snapshot(uuid,uuid,date,text,text,text,text)
  to authenticated;

comment on table public.transport_execution_streams is
  'One immutable Page-48 execution stream per Page-47 trip key and exact accepted plan version.';
comment on table public.transport_execution_events is
  'Append-only actual trip, passenger pairing, exception, and completion evidence.';
comment on table private.transport_execution_operations is
  'Actor-scoped idempotency ledger with exact immutable Page-48 mutation receipts.';
comment on function public.mutate_transport_execution(uuid,uuid,jsonb,uuid) is
  'Appends one ordered event after locked plan, assignment, passenger, time, AAL2 and pairing revalidation.';
comment on function public.transport_execution_snapshot(uuid,uuid,date,text,text,text,text) is
  'Returns one audited bounded Page-48 snapshot with complete-set metrics and the latest 300 events per trip.';
