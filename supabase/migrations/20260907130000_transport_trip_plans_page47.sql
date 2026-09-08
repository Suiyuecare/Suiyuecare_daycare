-- Page 47: immutable transport trip planning with independently reviewed publication.
-- Vehicle and driver data are organization-published manual rules, not an official
-- registry or inferred licence. External delivery, export, and offline cache remain closed.

insert into public.permissions (permission_key, description, risk_level) values
  ('transport_plans.read', 'Read scoped transport trip plans', 2),
  ('transport_plans.manage', 'Create immutable transport trip drafts and revisions', 3),
  ('transport_plans.approve', 'Independently publish or reject transport trip drafts', 3),
  ('transport_plans.override', 'Independently publish explained transport conflicts', 3)
on conflict (permission_key) do nothing;

insert into public.role_permissions (role_id, permission_id)
select role.id, permission.id from public.roles role cross join public.permissions permission
where role.is_system and role.role_key in ('organization_manager','branch_supervisor')
  and permission.permission_key like 'transport_plans.%'
on conflict (role_id, permission_id) do nothing;

insert into public.role_permissions (role_id, permission_id)
select role.id, permission.id from public.roles role cross join public.permissions permission
where role.is_system and role.role_key = 'transport_driver'
  and permission.permission_key = 'transport_plans.read'
on conflict (role_id, permission_id) do nothing;

create or replace function private.transport_plan_text_ok(
  p_value text, p_min integer, p_max integer
)
returns boolean language sql immutable security invoker set search_path = '' as $$
  select p_value is not null and char_length(btrim(p_value)) between p_min and p_max
    and translate(p_value,E'\n\r\t','') !~ '[[:cntrl:]]';
$$;

create or replace function private.transport_policy_payload_ok(p_payload jsonb)
returns boolean language plpgsql immutable security invoker set search_path = '' as $$
declare v_item jsonb; v_capacity integer;
begin
  if jsonb_typeof(p_payload) <> 'object'
     or not (p_payload ?& array['source_status','vehicles','driver_authorizations'])
     or p_payload - array['source_status','vehicles','driver_authorizations'] <> '{}'::jsonb
     or p_payload ->> 'source_status' <> 'manual_unstandardized'
     or jsonb_typeof(p_payload -> 'vehicles') <> 'array'
     or jsonb_array_length(p_payload -> 'vehicles') not between 1 and 100
     or jsonb_typeof(p_payload -> 'driver_authorizations') <> 'array'
     or jsonb_array_length(p_payload -> 'driver_authorizations') not between 1 and 200 then
    return false;
  end if;
  for v_item in select value from jsonb_array_elements(p_payload -> 'vehicles') loop
    if jsonb_typeof(v_item) <> 'object'
       or not (v_item ?& array['code','name','capacity','taxonomy_status'])
       or v_item - array['code','name','capacity','taxonomy_status'] <> '{}'::jsonb
       or coalesce(v_item ->> 'code','') !~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$'
       or not private.transport_plan_text_ok(v_item ->> 'name',1,160)
       or jsonb_typeof(v_item -> 'capacity') <> 'number'
       or coalesce(v_item ->> 'capacity','') !~ '^[0-9]+$'
       or v_item ->> 'taxonomy_status' <> 'manual_unstandardized' then return false;
    end if;
    begin v_capacity := (v_item ->> 'capacity')::integer;
    exception when others then return false; end;
    if v_capacity not between 1 and 100 then return false; end if;
  end loop;
  if exists (select 1 from (select lower(value ->> 'code') key,count(*)
    from jsonb_array_elements(p_payload -> 'vehicles') group by lower(value ->> 'code')
    having count(*) > 1) duplicate) then return false; end if;
  for v_item in select value from jsonb_array_elements(p_payload -> 'driver_authorizations') loop
    if jsonb_typeof(v_item) <> 'object'
       or not (v_item ?& array['membership_id','authorization_label','taxonomy_status'])
       or v_item - array['membership_id','authorization_label','taxonomy_status'] <> '{}'::jsonb
       or coalesce(v_item ->> 'membership_id','') !~
          '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
       or not private.transport_plan_text_ok(v_item ->> 'authorization_label',1,160)
       or v_item ->> 'taxonomy_status' <> 'manual_unstandardized' then return false;
    end if;
  end loop;
  if exists (select 1 from (select lower(value ->> 'membership_id') key,count(*)
    from jsonb_array_elements(p_payload -> 'driver_authorizations')
    group by lower(value ->> 'membership_id') having count(*) > 1) duplicate) then return false; end if;
  return true;
end;
$$;

create table private.transport_policy_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  policy_key uuid not null,
  version integer not null,
  previous_version_id uuid,
  effective_from date not null,
  effective_to date,
  rule_payload jsonb not null,
  publication_note text not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  approved_by uuid not null references auth.users(id) on delete restrict,
  created_reauth_challenge_id uuid not null references private.reauth_challenges(id) on delete restrict,
  approved_reauth_challenge_id uuid not null references private.reauth_challenges(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  content_hash text not null,
  constraint transport_policy_branch_scope_fkey foreign key (branch_id,organization_id)
    references public.branches(id,organization_id) on delete restrict,
  constraint transport_policy_id_scope_key unique(id,organization_id,branch_id),
  constraint transport_policy_chain_key unique(policy_key,version),
  constraint transport_policy_previous_unique unique(previous_version_id),
  constraint transport_policy_previous_scope_fkey foreign key(
    previous_version_id,organization_id,branch_id
  ) references private.transport_policy_versions(id,organization_id,branch_id) on delete restrict,
  constraint transport_policy_version_check check(
    (version=1 and previous_version_id is null) or (version>1 and previous_version_id is not null)),
  constraint transport_policy_period_check check(effective_to is null or effective_to >= effective_from),
  constraint transport_policy_payload_check check(private.transport_policy_payload_ok(rule_payload)),
  constraint transport_policy_people_check check(created_by <> approved_by),
  constraint transport_policy_reauth_check check(created_reauth_challenge_id <> approved_reauth_challenge_id),
  constraint transport_policy_note_check check(private.transport_plan_text_ok(publication_note,8,1000)),
  constraint transport_policy_hash_check check(content_hash ~ '^[a-f0-9]{64}$')
);

create or replace function private.prepare_transport_policy()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_previous private.transport_policy_versions%rowtype;
begin
  if exists(select 1 from private.transport_policy_versions policy
    where policy.organization_id=new.organization_id and policy.branch_id=new.branch_id
      and daterange(policy.effective_from,coalesce(policy.effective_to+1,'infinity'::date),'[)')
        && daterange(new.effective_from,coalesce(new.effective_to+1,'infinity'::date),'[)')) then
    raise exception using errcode='23P01',message='transport policy periods overlap';
  end if;
  if new.version=1 then
    if new.previous_version_id is not null then
      raise exception using errcode='23514',message='invalid first transport policy version';
    end if;
  else
    select * into v_previous from private.transport_policy_versions policy
    where policy.id=new.previous_version_id and policy.organization_id=new.organization_id
      and policy.branch_id=new.branch_id for share;
    if not found or v_previous.policy_key<>new.policy_key or v_previous.version+1<>new.version then
      raise exception using errcode='23514',message='invalid transport policy chain';
    end if;
  end if;
  if new.content_hash is distinct from encode(sha256(convert_to(jsonb_build_object(
    'schema_version',1,'organization_id',new.organization_id,'branch_id',new.branch_id,
    'policy_key',new.policy_key,'version',new.version,'previous_version_id',new.previous_version_id,
    'effective_from',new.effective_from,'effective_to',new.effective_to,
    'rule_payload',new.rule_payload,'publication_note',new.publication_note,
    'created_by',new.created_by,'approved_by',new.approved_by
  )::text,'UTF8')),'hex') then
    raise exception using errcode='23514',message='transport policy content hash mismatch';
  end if;
  return new;
end;
$$;
create trigger transport_policy_prepare before insert on private.transport_policy_versions
for each row execute function private.prepare_transport_policy();

create table public.transport_trip_plan_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  trip_key uuid not null,
  version integer not null,
  previous_version_id uuid,
  draft_status text not null,
  direction text not null,
  service_date date not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  vehicle_code text not null,
  vehicle_name_snapshot text not null,
  vehicle_capacity_snapshot integer not null,
  driver_membership_id uuid not null,
  driver_user_id uuid not null references public.profiles(id) on delete restrict,
  driver_display_name_snapshot text not null,
  driver_employee_code_snapshot text,
  driver_authorization_label_snapshot text not null,
  pickup_label text not null,
  dropoff_label text not null,
  passenger_snapshot jsonb not null,
  conflict_snapshot jsonb not null,
  rule_version_id uuid not null,
  rule_source_status text not null default 'manual_unstandardized',
  revision_reason text not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_by_display_name text not null,
  reauth_challenge_id uuid not null references private.reauth_challenges(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  content_hash text not null,
  constraint transport_trip_branch_scope_fkey foreign key(branch_id,organization_id)
    references public.branches(id,organization_id) on delete restrict,
  constraint transport_trip_rule_scope_fkey foreign key(rule_version_id,organization_id,branch_id)
    references private.transport_policy_versions(id,organization_id,branch_id) on delete restrict,
  constraint transport_trip_driver_scope_fkey foreign key(driver_membership_id,organization_id,branch_id)
    references public.memberships(id,organization_id,branch_id) on delete restrict,
  constraint transport_trip_id_scope_key unique(id,organization_id,branch_id),
  constraint transport_trip_chain_key unique(trip_key,version),
  constraint transport_trip_previous_unique unique(previous_version_id),
  constraint transport_trip_previous_scope_fkey foreign key(previous_version_id,organization_id,branch_id)
    references public.transport_trip_plan_versions(id,organization_id,branch_id) on delete restrict,
  constraint transport_trip_version_check check(
    (version=1 and previous_version_id is null) or (version>1 and previous_version_id is not null)),
  constraint transport_trip_status_check check(draft_status in('draft_ready','draft_conflicted')),
  constraint transport_trip_direction_check check(direction in('pickup','dropoff')),
  constraint transport_trip_time_check check(ends_at>starts_at and ends_at<=starts_at+interval '8 hours'
    and (starts_at at time zone 'Asia/Taipei')::date=service_date
    and (ends_at at time zone 'Asia/Taipei')::date=service_date),
  constraint transport_trip_vehicle_check check(vehicle_code ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$'
    and vehicle_capacity_snapshot between 1 and 100),
  constraint transport_trip_text_check check(
    private.transport_plan_text_ok(vehicle_name_snapshot,1,160)
    and private.transport_plan_text_ok(driver_display_name_snapshot,1,160)
    and (driver_employee_code_snapshot is null or private.transport_plan_text_ok(driver_employee_code_snapshot,1,80))
    and private.transport_plan_text_ok(driver_authorization_label_snapshot,1,160)
    and private.transport_plan_text_ok(pickup_label,1,240)
    and private.transport_plan_text_ok(dropoff_label,1,240)
    and private.transport_plan_text_ok(revision_reason,1,1000)
    and private.transport_plan_text_ok(created_by_display_name,1,160)),
  constraint transport_trip_snapshot_check check(jsonb_typeof(passenger_snapshot)='array'
    and jsonb_array_length(passenger_snapshot) between 1 and 100
    and jsonb_typeof(conflict_snapshot)='array' and jsonb_array_length(conflict_snapshot)<=1000
    and ((draft_status='draft_ready' and jsonb_array_length(conflict_snapshot)=0)
      or (draft_status='draft_conflicted' and jsonb_array_length(conflict_snapshot)>0))),
  constraint transport_trip_rule_source_check check(rule_source_status='manual_unstandardized'),
  constraint transport_trip_hash_check check(content_hash ~ '^[a-f0-9]{64}$')
);

create table public.transport_trip_plan_decisions (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null,
  branch_id uuid not null, trip_version_id uuid not null, trip_key uuid not null,
  decision text not null, reason text not null,
  reviewed_by uuid not null references auth.users(id) on delete restrict,
  reviewer_display_name text not null,
  reauth_challenge_id uuid not null references private.reauth_challenges(id) on delete restrict,
  reviewed_at timestamptz not null default clock_timestamp(), content_hash text not null,
  constraint transport_decision_trip_scope_fkey foreign key(trip_version_id,organization_id,branch_id)
    references public.transport_trip_plan_versions(id,organization_id,branch_id) on delete restrict,
  constraint transport_decision_trip_unique unique(trip_version_id),
  constraint transport_decision_kind_check check(decision in('publish','override','reject')),
  constraint transport_decision_text_check check(private.transport_plan_text_ok(reason,8,1000)
    and private.transport_plan_text_ok(reviewer_display_name,1,160)),
  constraint transport_decision_hash_check check(content_hash ~ '^[a-f0-9]{64}$')
);

create table private.transport_plan_operations (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null,
  branch_id uuid not null, actor_user_id uuid not null references auth.users(id) on delete restrict,
  idempotency_key uuid not null, request_hash text not null, action text not null,
  decision text, trip_version_id uuid not null, trip_key uuid not null,
  version integer not null, result_status text not null, conflict_count integer not null,
  content_hash text not null, rule_version_id uuid not null,
  committed_at timestamptz not null default clock_timestamp(),
  constraint transport_operation_actor_key unique(actor_user_id,idempotency_key),
  constraint transport_operation_trip_scope_fkey foreign key(trip_version_id,organization_id,branch_id)
    references public.transport_trip_plan_versions(id,organization_id,branch_id) on delete restrict,
  constraint transport_operation_action_check check(action in('save_trip','decide_trip')),
  constraint transport_operation_decision_check check((action='save_trip' and decision is null)
    or (action='decide_trip' and decision in('publish','override','reject'))),
  constraint transport_operation_status_check check(result_status in(
    'draft_ready','draft_conflicted','published','rejected')),
  constraint transport_operation_count_check check(conflict_count between 0 and 1000),
  constraint transport_operation_hash_check check(request_hash ~ '^[a-f0-9]{64}$'
    and content_hash ~ '^[a-f0-9]{64}$')
);

create index transport_policy_scope_date_idx on private.transport_policy_versions(
  organization_id,branch_id,effective_from,effective_to);
create index transport_policy_created_by_idx on private.transport_policy_versions(created_by);
create index transport_policy_approved_by_idx on private.transport_policy_versions(approved_by);
create index transport_policy_created_reauth_idx on private.transport_policy_versions(
  created_reauth_challenge_id);
create index transport_policy_approved_reauth_idx on private.transport_policy_versions(
  approved_reauth_challenge_id);
create index transport_trip_scope_date_idx on public.transport_trip_plan_versions(
  organization_id,branch_id,service_date,starts_at,version desc);
create index transport_trip_vehicle_time_idx on public.transport_trip_plan_versions(
  organization_id,branch_id,vehicle_code,starts_at,ends_at);
create index transport_trip_driver_time_idx on public.transport_trip_plan_versions(
  organization_id,branch_id,driver_membership_id,starts_at,ends_at);
create index transport_trip_previous_idx on public.transport_trip_plan_versions(previous_version_id);
create index transport_trip_rule_idx on public.transport_trip_plan_versions(rule_version_id);
create index transport_trip_driver_membership_idx on public.transport_trip_plan_versions(
  driver_membership_id);
create index transport_trip_driver_user_idx on public.transport_trip_plan_versions(driver_user_id);
create index transport_trip_created_by_idx on public.transport_trip_plan_versions(created_by);
create index transport_trip_reauth_idx on public.transport_trip_plan_versions(reauth_challenge_id);
create index transport_decision_trip_idx on public.transport_trip_plan_decisions(trip_key,reviewed_at desc);
create index transport_decision_scope_idx on public.transport_trip_plan_decisions(
  branch_id,organization_id);
create index transport_decision_reviewer_idx on public.transport_trip_plan_decisions(reviewed_by);
create index transport_decision_reauth_idx on public.transport_trip_plan_decisions(
  reauth_challenge_id);
create index transport_operation_scope_idx on private.transport_plan_operations(
  organization_id,branch_id,committed_at desc);
create index transport_operation_trip_version_idx on private.transport_plan_operations(
  trip_version_id);

create or replace function private.prevent_transport_plan_mutation()
returns trigger language plpgsql set search_path='' as $$
begin raise exception using errcode='55000',message='transport planning evidence is append-only'; end;
$$;
create trigger transport_policy_append_only before update or delete on private.transport_policy_versions
for each row execute function private.prevent_transport_plan_mutation();
create trigger transport_trip_append_only before update or delete on public.transport_trip_plan_versions
for each row execute function private.prevent_transport_plan_mutation();
create trigger transport_decision_append_only before update or delete on public.transport_trip_plan_decisions
for each row execute function private.prevent_transport_plan_mutation();
create trigger transport_operation_append_only before update or delete on private.transport_plan_operations
for each row execute function private.prevent_transport_plan_mutation();
create trigger transport_policy_audit after insert or update or delete on private.transport_policy_versions
for each row execute function private.audit_row_change();
create trigger transport_trip_plan_versions_audit_row_change
after insert or update or delete on public.transport_trip_plan_versions
for each row execute function private.audit_row_change();
create trigger transport_trip_plan_decisions_audit_row_change
after insert or update or delete on public.transport_trip_plan_decisions
for each row execute function private.audit_row_change();
create trigger transport_operation_audit after insert or update or delete on private.transport_plan_operations
for each row execute function private.audit_row_change();

alter table private.transport_policy_versions enable row level security;
alter table private.transport_policy_versions force row level security;
alter table public.transport_trip_plan_versions enable row level security;
alter table public.transport_trip_plan_versions force row level security;
alter table public.transport_trip_plan_decisions enable row level security;
alter table public.transport_trip_plan_decisions force row level security;
alter table private.transport_plan_operations enable row level security;
alter table private.transport_plan_operations force row level security;
revoke all on table private.transport_policy_versions from anon,authenticated,service_role;
revoke all on table public.transport_trip_plan_versions from anon,authenticated,service_role;
revoke all on table public.transport_trip_plan_decisions from anon,authenticated,service_role;
revoke all on table private.transport_plan_operations from anon,authenticated,service_role;

create or replace function private.transport_plan_authority(
  p_organization_id uuid,p_branch_id uuid,p_permission text
)
returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and exists(select 1 from public.branches branch
    where branch.id=p_branch_id and branch.organization_id=p_organization_id and branch.is_active)
    and private.has_permission(p_organization_id,p_branch_id,'clients.read')
    and private.has_permission(p_organization_id,p_branch_id,'transport_plans.read')
    and private.has_permission(p_organization_id,p_branch_id,p_permission);
$$;

create or replace function private.require_transport_plan_reauth(
  p_actor uuid,p_reference_time timestamptz
)
returns uuid language plpgsql volatile security definer set search_path='' as $$
declare v_session_id uuid; v_challenge_id uuid;
begin
  if p_actor is null or coalesce(auth.jwt()->>'aal','')<>'aal2' then
    raise exception using errcode='42501',message='recent transport-plan AAL2 required';
  end if;
  begin v_session_id:=nullif(auth.jwt()->>'session_id','')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode='42501',message='recent transport-plan AAL2 required'; end;
  select challenge.id into v_challenge_id from private.reauth_events event
  join private.reauth_challenges challenge on challenge.id=event.challenge_id
    and challenge.user_id=event.user_id and challenge.session_id=event.session_id
  where event.user_id=p_actor and event.session_id=v_session_id and event.aal='aal2'
    and event.revoked_at is null and event.verification_method in('totp','webauthn','phone')
    and challenge.consumed_at is not null and challenge.invalidated_at is null
    and challenge.factor_method=event.verification_method
    and event.verified_at>=p_reference_time-interval '15 minutes'
    and event.verified_at<=p_reference_time+interval '30 seconds'
  order by event.verified_at desc,event.id desc limit 1;
  if v_challenge_id is null then
    raise exception using errcode='42501',message='recent transport-plan AAL2 required';
  end if;
  return v_challenge_id;
end;
$$;

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

create or replace function private.transport_operation_result(
  p_operation private.transport_plan_operations,p_replayed boolean
)
returns table(operation_id uuid,action text,decision text,trip_version_id uuid,
  trip_key uuid,version integer,status text,conflict_count integer,content_hash text,
  rule_version_id uuid,committed_at timestamptz,replayed boolean)
language sql stable set search_path='' as $$
  select p_operation.id,p_operation.action,p_operation.decision,p_operation.trip_version_id,
    p_operation.trip_key,p_operation.version,p_operation.result_status,
    p_operation.conflict_count,p_operation.content_hash,p_operation.rule_version_id,
    p_operation.committed_at,p_replayed;
$$;

create or replace function private.mutate_transport_trip_plan_guarded(
  p_expected_organization_id uuid,p_expected_branch_id uuid,p_action text,
  p_payload jsonb,p_idempotency_key uuid
)
returns table(operation_id uuid,action text,decision text,trip_version_id uuid,
  trip_key uuid,version integer,status text,conflict_count integer,content_hash text,
  rule_version_id uuid,committed_at timestamptz,replayed boolean)
language plpgsql volatile security definer set search_path='' as $$
declare
  v_actor uuid:=auth.uid(); v_now timestamptz:=clock_timestamp(); v_reauth uuid;
  v_request_hash text; v_existing private.transport_plan_operations%rowtype;
  v_operation private.transport_plan_operations%rowtype;
  v_profile public.profiles%rowtype; v_driver_membership public.memberships%rowtype;
  v_driver_profile public.profiles%rowtype; v_policy private.transport_policy_versions%rowtype;
  v_policy_count integer; v_vehicle jsonb; v_driver_rule jsonb;
  v_mode text; v_trip_key uuid; v_previous_id uuid; v_expected_version integer;
  v_expected_hash text; v_direction text; v_service_date date;
  v_starts_at timestamptz; v_ends_at timestamptz; v_vehicle_code text;
  v_driver_id uuid; v_pickup text; v_dropoff text; v_passenger_input jsonb;
  v_passengers jsonb; v_revision text; v_previous public.transport_trip_plan_versions%rowtype;
  v_trip public.transport_trip_plan_versions%rowtype; v_conflicts jsonb;
  v_status text; v_content_hash text; v_decision text; v_reason text;
  v_current_conflicts jsonb; v_decision_row public.transport_trip_plan_decisions%rowtype;
  v_input_count integer; v_visible_count integer; v_client_id uuid;
begin
  if p_expected_organization_id is null or p_expected_branch_id is null
     or p_action not in('save_trip','decide_trip') or jsonb_typeof(p_payload)<>'object'
     or p_idempotency_key is null or not private.transport_plan_authority(
       p_expected_organization_id,p_expected_branch_id,
       case when p_action='save_trip' then 'transport_plans.manage' else 'transport_plans.approve' end
     ) then raise exception using errcode='42501',message='transport plan operation not permitted'; end if;
  v_reauth:=private.require_transport_plan_reauth(v_actor,v_now);
  select * into v_profile from public.profiles where id=v_actor and is_active for share;
  if not found then raise exception using errcode='42501',message='inactive transport actor'; end if;
  v_request_hash:=encode(sha256(convert_to(jsonb_build_object('schema_version',1,
    'organization_id',p_expected_organization_id,'branch_id',p_expected_branch_id,
    'actor_user_id',v_actor,'action',p_action,'payload',p_payload)::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended(
    'transport-plan-operation:'||v_actor::text||':'||p_idempotency_key::text,47));
  select * into v_existing from private.transport_plan_operations operation
  where operation.actor_user_id=v_actor and operation.idempotency_key=p_idempotency_key;
  if found then
    if v_existing.organization_id<>p_expected_organization_id
       or v_existing.branch_id<>p_expected_branch_id or v_existing.action<>p_action
       or v_existing.request_hash<>v_request_hash then
      raise exception using errcode='23505',message='transport plan idempotency conflict';
    end if;
    if not private.transport_plan_authority(p_expected_organization_id,p_expected_branch_id,
      case when p_action='save_trip' then 'transport_plans.manage'
        when v_existing.decision='override' then 'transport_plans.override'
        else 'transport_plans.approve' end) then
      raise exception using errcode='42501',message='transport replay authority expired';
    end if;
    return query select * from private.transport_operation_result(v_existing,true); return;
  end if;

  if p_action='save_trip' then
    if not (p_payload ?& array['mode','trip_key','previous_version_id','expected_version',
      'expected_content_hash','direction','service_date','starts_at','ends_at','vehicle_code',
      'driver_membership_id','pickup_label','dropoff_label','passengers','revision_reason'])
      or p_payload-array['mode','trip_key','previous_version_id','expected_version',
      'expected_content_hash','direction','service_date','starts_at','ends_at','vehicle_code',
      'driver_membership_id','pickup_label','dropoff_label','passengers','revision_reason']<>'{}'::jsonb then
      raise exception using errcode='22023',message='unsupported transport trip field'; end if;
    v_mode:=p_payload->>'mode'; v_trip_key:=nullif(p_payload->>'trip_key','')::uuid;
    v_previous_id:=nullif(p_payload->>'previous_version_id','')::uuid;
    v_expected_version:=(p_payload->>'expected_version')::integer;
    v_expected_hash:=nullif(p_payload->>'expected_content_hash','');
    v_direction:=p_payload->>'direction'; v_service_date:=(p_payload->>'service_date')::date;
    v_starts_at:=(p_payload->>'starts_at')::timestamptz;
    v_ends_at:=(p_payload->>'ends_at')::timestamptz;
    v_vehicle_code:=p_payload->>'vehicle_code';
    v_driver_id:=(p_payload->>'driver_membership_id')::uuid;
    v_pickup:=btrim(p_payload->>'pickup_label'); v_dropoff:=btrim(p_payload->>'dropoff_label');
    v_passenger_input:=p_payload->'passengers'; v_revision:=btrim(p_payload->>'revision_reason');
    if v_mode not in('create','revise') or v_direction not in('pickup','dropoff')
       or extract(year from v_service_date) not between 1900 and 2200
       or v_ends_at<=v_starts_at or v_ends_at>v_starts_at+interval '8 hours'
       or (v_starts_at at time zone 'Asia/Taipei')::date<>v_service_date
       or (v_ends_at at time zone 'Asia/Taipei')::date<>v_service_date
       or coalesce(v_vehicle_code,'')!~'^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$'
       or not private.transport_plan_text_ok(v_pickup,1,240)
       or not private.transport_plan_text_ok(v_dropoff,1,240)
       or not private.transport_plan_text_ok(v_revision,1,1000)
       or jsonb_typeof(v_passenger_input)<>'array'
       or jsonb_array_length(v_passenger_input) not between 1 and 100
       or (v_mode='create' and (v_trip_key is not null or v_previous_id is not null
         or v_expected_version<>0 or v_expected_hash is not null))
       or (v_mode='revise' and (v_trip_key is null or v_previous_id is null
         or v_expected_version<1 or coalesce(v_expected_hash,'')!~'^[a-f0-9]{64}$')) then
      raise exception using errcode='23514',message='invalid transport trip payload'; end if;
    if exists(select 1 from jsonb_array_elements(v_passenger_input) passenger(value)
      where jsonb_typeof(value)<>'object'
        or not(value ?& array['client_id','pickup_label','dropoff_label'])
        or value-array['client_id','pickup_label','dropoff_label']<>'{}'::jsonb
        or coalesce(value->>'client_id','')!~
          '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
        or not private.transport_plan_text_ok(value->>'pickup_label',1,240)
        or not private.transport_plan_text_ok(value->>'dropoff_label',1,240))
       or exists(select 1 from (select lower(value->>'client_id') key,count(*)
         from jsonb_array_elements(v_passenger_input) group by lower(value->>'client_id')
         having count(*)>1) duplicate) then
      raise exception using errcode='23514',message='invalid transport passenger set'; end if;

    select count(*) into v_policy_count from private.transport_policy_versions policy
    where policy.organization_id=p_expected_organization_id and policy.branch_id=p_expected_branch_id
      and policy.effective_from<=v_service_date
      and (policy.effective_to is null or policy.effective_to>=v_service_date);
    if v_policy_count<>1 then raise exception using errcode='55000',
      message='transport policy is not uniquely configured'; end if;
    select * into v_policy from private.transport_policy_versions policy
    where policy.organization_id=p_expected_organization_id and policy.branch_id=p_expected_branch_id
      and policy.effective_from<=v_service_date
      and (policy.effective_to is null or policy.effective_to>=v_service_date) for share;
    select value into v_vehicle from jsonb_array_elements(v_policy.rule_payload->'vehicles') item(value)
    where lower(value->>'code')=lower(v_vehicle_code) limit 1;
    select value into v_driver_rule from jsonb_array_elements(
      v_policy.rule_payload->'driver_authorizations') item(value)
    where lower(value->>'membership_id')=lower(v_driver_id::text) limit 1;
    if v_vehicle is null or v_driver_rule is null then raise exception using errcode='55000',
      message='vehicle or driver policy not configured'; end if;
    select membership.* into v_driver_membership
    from public.memberships membership
    where membership.id=v_driver_id and membership.organization_id=p_expected_organization_id
      and membership.branch_id=p_expected_branch_id and membership.status='active'
      and membership.starts_at<=v_starts_at
      and (membership.ends_at is null or membership.ends_at>=v_ends_at)
    for share;
    if found then
      select profile.* into v_driver_profile from public.profiles profile
      where profile.id=v_driver_membership.profile_id and profile.is_active
        and profile.kind='driver' for share;
    end if;
    if not found then raise exception using errcode='23514',message='driver is not active'; end if;

    v_input_count:=jsonb_array_length(v_passenger_input);
    select count(*),coalesce(jsonb_agg(jsonb_build_object('client_id',client.id,
      'client_code',client.client_code,'display_name',client.display_name,
      'pickup_label',passenger.value->>'pickup_label','dropoff_label',passenger.value->>'dropoff_label')
      order by client.id),'[]'::jsonb) into v_visible_count,v_passengers
    from jsonb_array_elements(v_passenger_input) passenger(value)
    join public.clients client on client.id=(passenger.value->>'client_id')::uuid
      and client.organization_id=p_expected_organization_id and client.branch_id=p_expected_branch_id
      and client.status='active' and coalesce(client.admitted_on,v_service_date)<=v_service_date
      and (client.ended_on is null or client.ended_on>=v_service_date)
      and private.can_staff_access_client(client.id,'transport_plans.read');
    if v_visible_count<>v_input_count then raise exception using errcode='42501',
      message='one or more passengers are outside current scope'; end if;

    if v_mode='create' then v_trip_key:=gen_random_uuid();
    else
      perform pg_advisory_xact_lock(hashtextextended('transport-trip:'||v_trip_key::text,47));
      select * into v_previous from public.transport_trip_plan_versions trip
      where trip.id=v_previous_id and trip.trip_key=v_trip_key
        and trip.organization_id=p_expected_organization_id and trip.branch_id=p_expected_branch_id
        and not exists(select 1 from public.transport_trip_plan_versions child
          where child.previous_version_id=trip.id) for share;
      if not found or v_previous.version<>v_expected_version
         or v_previous.content_hash<>v_expected_hash then
        raise exception using errcode='40001',message='transport trip version conflict'; end if;
    end if;
    perform pg_advisory_xact_lock(hashtextextended('transport-vehicle:'||
      p_expected_branch_id::text||':'||lower(v_vehicle_code),47));
    perform pg_advisory_xact_lock(hashtextextended('transport-driver:'||
      p_expected_branch_id::text||':'||v_driver_id::text,47));
    for v_client_id in select (passenger.value->>'client_id')::uuid
      from jsonb_array_elements(v_passengers) passenger(value)
      order by (passenger.value->>'client_id')::uuid
    loop
      perform pg_advisory_xact_lock(hashtextextended('transport-client:'||
        p_expected_branch_id::text||':'||v_client_id::text,47));
    end loop;
    v_conflicts:=private.transport_plan_conflicts(p_expected_organization_id,
      p_expected_branch_id,v_trip_key,v_starts_at,v_ends_at,v_vehicle_code,
      (v_vehicle->>'capacity')::integer,v_driver_id,v_passengers);
    v_status:=case when jsonb_array_length(v_conflicts)=0 then 'draft_ready'
      else 'draft_conflicted' end;
    v_content_hash:=encode(sha256(convert_to(jsonb_build_object('schema_version',1,
      'organization_id',p_expected_organization_id,'branch_id',p_expected_branch_id,
      'trip_key',v_trip_key,'version',v_expected_version+1,'previous_version_id',v_previous_id,
      'direction',v_direction,'service_date',v_service_date,'starts_at',v_starts_at,
      'ends_at',v_ends_at,'vehicle_code',v_vehicle->>'code','vehicle_name',v_vehicle->>'name',
      'vehicle_capacity',(v_vehicle->>'capacity')::integer,'driver_membership_id',v_driver_id,
      'driver_user_id',v_driver_profile.id,'driver_authorization_label',
      v_driver_rule->>'authorization_label','pickup_label',v_pickup,'dropoff_label',v_dropoff,
      'passengers',v_passengers,'conflicts',v_conflicts,'rule_version_id',v_policy.id,
      'revision_reason',v_revision,'created_by',v_actor,'created_at',v_now)::text,'UTF8')),'hex');
    insert into public.transport_trip_plan_versions(organization_id,branch_id,trip_key,version,
      previous_version_id,draft_status,direction,service_date,starts_at,ends_at,vehicle_code,
      vehicle_name_snapshot,vehicle_capacity_snapshot,driver_membership_id,driver_user_id,
      driver_display_name_snapshot,driver_employee_code_snapshot,
      driver_authorization_label_snapshot,pickup_label,dropoff_label,passenger_snapshot,
      conflict_snapshot,rule_version_id,revision_reason,created_by,created_by_display_name,
      reauth_challenge_id,created_at,content_hash)
    values(p_expected_organization_id,p_expected_branch_id,v_trip_key,v_expected_version+1,
      v_previous_id,v_status,v_direction,v_service_date,v_starts_at,v_ends_at,v_vehicle->>'code',
      v_vehicle->>'name',(v_vehicle->>'capacity')::integer,v_driver_id,v_driver_profile.id,
      v_driver_profile.display_name,v_driver_profile.employee_code,
      v_driver_rule->>'authorization_label',v_pickup,v_dropoff,v_passengers,v_conflicts,
      v_policy.id,v_revision,v_actor,v_profile.display_name,v_reauth,v_now,v_content_hash)
    returning * into v_trip;
    insert into private.transport_plan_operations(organization_id,branch_id,actor_user_id,
      idempotency_key,request_hash,action,trip_version_id,trip_key,version,result_status,
      conflict_count,content_hash,rule_version_id,committed_at)
    values(p_expected_organization_id,p_expected_branch_id,v_actor,p_idempotency_key,
      v_request_hash,p_action,v_trip.id,v_trip.trip_key,v_trip.version,v_status,
      jsonb_array_length(v_conflicts),v_content_hash,v_policy.id,v_now) returning * into v_operation;
  else
    if not (p_payload ?& array['decision','trip_version_id','expected_trip_key','expected_version',
      'expected_content_hash','expected_conflict_count','expected_rule_version_id','reason'])
      or p_payload-array['decision','trip_version_id','expected_trip_key','expected_version',
      'expected_content_hash','expected_conflict_count','expected_rule_version_id','reason']<>'{}'::jsonb then
      raise exception using errcode='22023',message='unsupported transport decision field'; end if;
    v_decision:=p_payload->>'decision'; v_reason:=btrim(p_payload->>'reason');
    if v_decision not in('publish','override','reject')
       or not private.transport_plan_text_ok(v_reason,8,1000) then
      raise exception using errcode='22023',message='invalid transport decision'; end if;
    if v_decision='override' and not private.transport_plan_authority(
      p_expected_organization_id,p_expected_branch_id,'transport_plans.override') then
      raise exception using errcode='42501',message='transport override not permitted'; end if;
    select * into v_trip from public.transport_trip_plan_versions trip
    where trip.id=(p_payload->>'trip_version_id')::uuid
      and trip.organization_id=p_expected_organization_id and trip.branch_id=p_expected_branch_id
      and not exists(select 1 from public.transport_trip_plan_versions child
        where child.previous_version_id=trip.id) for share;
    if not found or v_trip.trip_key<>(p_payload->>'expected_trip_key')::uuid
       or v_trip.version<>(p_payload->>'expected_version')::integer
       or v_trip.content_hash<>p_payload->>'expected_content_hash'
       or jsonb_array_length(v_trip.conflict_snapshot)<>(p_payload->>'expected_conflict_count')::integer
       or v_trip.rule_version_id<>(p_payload->>'expected_rule_version_id')::uuid then
      raise exception using errcode='40001',message='transport decision version conflict'; end if;
    if v_trip.created_by=v_actor then raise exception using errcode='42501',
      message='transport creator cannot review own draft'; end if;
    if exists(select 1 from public.transport_trip_plan_decisions decision
      where decision.trip_version_id=v_trip.id) then raise exception using errcode='40001',
      message='transport trip already reviewed'; end if;
    perform pg_advisory_xact_lock(hashtextextended('transport-trip:'||v_trip.trip_key::text,47));
    perform pg_advisory_xact_lock(hashtextextended('transport-vehicle:'||
      p_expected_branch_id::text||':'||lower(v_trip.vehicle_code),47));
    perform pg_advisory_xact_lock(hashtextextended('transport-driver:'||
      p_expected_branch_id::text||':'||v_trip.driver_membership_id::text,47));
    for v_client_id in select (passenger.value->>'client_id')::uuid
      from jsonb_array_elements(v_trip.passenger_snapshot) passenger(value)
      order by (passenger.value->>'client_id')::uuid
    loop
      perform pg_advisory_xact_lock(hashtextextended('transport-client:'||
        p_expected_branch_id::text||':'||v_client_id::text,47));
    end loop;
    v_current_conflicts:=private.transport_plan_conflicts(p_expected_organization_id,
      p_expected_branch_id,v_trip.trip_key,v_trip.starts_at,v_trip.ends_at,v_trip.vehicle_code,
      v_trip.vehicle_capacity_snapshot,v_trip.driver_membership_id,v_trip.passenger_snapshot);
    if v_current_conflicts<>v_trip.conflict_snapshot then raise exception using errcode='40001',
      message='transport conflicts changed before review'; end if;
    if (v_decision='publish' and jsonb_array_length(v_current_conflicts)<>0)
       or (v_decision='override' and jsonb_array_length(v_current_conflicts)=0) then
      raise exception using errcode='23514',message='transport decision does not match conflicts'; end if;
    insert into public.transport_trip_plan_decisions(organization_id,branch_id,trip_version_id,
      trip_key,decision,reason,reviewed_by,reviewer_display_name,reauth_challenge_id,
      reviewed_at,content_hash)
    values(p_expected_organization_id,p_expected_branch_id,v_trip.id,v_trip.trip_key,
      v_decision,v_reason,v_actor,v_profile.display_name,v_reauth,v_now,
      encode(sha256(convert_to(jsonb_build_object('schema_version',1,'trip_version_id',v_trip.id,
        'trip_content_hash',v_trip.content_hash,'decision',v_decision,'reason',v_reason,
        'reviewed_by',v_actor,'reviewed_at',v_now)::text,'UTF8')),'hex'))
    returning * into v_decision_row;
    v_status:=case when v_decision='reject' then 'rejected' else 'published' end;
    insert into private.transport_plan_operations(organization_id,branch_id,actor_user_id,
      idempotency_key,request_hash,action,decision,trip_version_id,trip_key,version,
      result_status,conflict_count,content_hash,rule_version_id,committed_at)
    values(p_expected_organization_id,p_expected_branch_id,v_actor,p_idempotency_key,
      v_request_hash,p_action,v_decision,v_trip.id,v_trip.trip_key,v_trip.version,v_status,
      jsonb_array_length(v_trip.conflict_snapshot),v_trip.content_hash,v_trip.rule_version_id,v_now)
    returning * into v_operation;
  end if;
  return query select * from private.transport_operation_result(v_operation,false);
end;
$$;

create or replace function public.mutate_transport_trip_plan(
  p_expected_organization_id uuid,p_expected_branch_id uuid,p_action text,
  p_payload jsonb,p_idempotency_key uuid
)
returns table(operation_id uuid,action text,decision text,trip_version_id uuid,
  trip_key uuid,version integer,status text,conflict_count integer,content_hash text,
  rule_version_id uuid,committed_at timestamptz,replayed boolean)
language sql volatile security invoker set search_path='' as $$
  select * from private.mutate_transport_trip_plan_guarded(p_expected_organization_id,
    p_expected_branch_id,p_action,p_payload,p_idempotency_key);
$$;

create or replace function private.transport_trip_plan_snapshot_response(
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
     or p_status not in('all','draft_ready','draft_conflicted','published','rejected')
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
      case when decision.decision in('publish','override') then 'published'
        when decision.decision='reject' then 'rejected' else trip.draft_status end result_status
    from public.transport_trip_plan_versions trip
    left join public.transport_trip_plan_decisions decision on decision.trip_version_id=trip.id
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
  select count(*),coalesce(sum(jsonb_array_length(passenger_snapshot)),0),
    coalesce(sum((select count(*) from jsonb_array_elements(conflict_snapshot) conflict(value)
      where value->>'code'='vehicle_capacity_exceeded')),0),
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
      'notification_status','not_configured') order by starts_at,trip_key,version desc)
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

create or replace function public.transport_trip_plan_snapshot(
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
  select * from private.transport_trip_plan_snapshot_response(p_expected_organization_id,
    p_expected_branch_id,p_service_date,p_direction,p_vehicle_query,p_driver_query,p_status);
$$;

revoke all on function private.transport_plan_text_ok(text,integer,integer)
  from public,anon,authenticated,service_role;
revoke all on function private.transport_policy_payload_ok(jsonb)
  from public,anon,authenticated,service_role;
revoke all on function private.prepare_transport_policy()
  from public,anon,authenticated,service_role;
revoke all on function private.prevent_transport_plan_mutation()
  from public,anon,authenticated,service_role;
revoke all on function private.transport_plan_authority(uuid,uuid,text)
  from public,anon,authenticated,service_role;
revoke all on function private.require_transport_plan_reauth(uuid,timestamptz)
  from public,anon,authenticated,service_role;
revoke all on function private.transport_plan_conflicts(uuid,uuid,uuid,timestamptz,timestamptz,text,integer,uuid,jsonb)
  from public,anon,authenticated,service_role;
revoke all on function private.transport_operation_result(private.transport_plan_operations,boolean)
  from public,anon,authenticated,service_role;
revoke all on function private.mutate_transport_trip_plan_guarded(uuid,uuid,text,jsonb,uuid)
  from public,anon,authenticated,service_role;
revoke all on function private.transport_trip_plan_snapshot_response(uuid,uuid,date,text,text,text,text)
  from public,anon,authenticated,service_role;
revoke all on function public.mutate_transport_trip_plan(uuid,uuid,text,jsonb,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.transport_trip_plan_snapshot(uuid,uuid,date,text,text,text,text)
  from public,anon,authenticated,service_role;
grant execute on function private.mutate_transport_trip_plan_guarded(uuid,uuid,text,jsonb,uuid)
  to authenticated;
grant execute on function private.transport_trip_plan_snapshot_response(uuid,uuid,date,text,text,text,text)
  to authenticated;
grant execute on function public.mutate_transport_trip_plan(uuid,uuid,text,jsonb,uuid)
  to authenticated;
grant execute on function public.transport_trip_plan_snapshot(uuid,uuid,date,text,text,text,text)
  to authenticated;

comment on table private.transport_policy_versions is
  'Dual-person immutable manual vehicle-capacity and driver-authorization rules; not an official registry.';
comment on table public.transport_trip_plan_versions is
  'Append-only Page-47 trip drafts with frozen people, places, resources, rules, and conflict evidence.';
comment on table public.transport_trip_plan_decisions is
  'Independent immutable publication, rejection, or explained conflict-override decisions.';
comment on function public.mutate_transport_trip_plan(uuid,uuid,text,jsonb,uuid) is
  'Creates or reviews Page-47 trips with recent same-session AAL2, exact replay, and review-time conflict recomputation.';
comment on function public.transport_trip_plan_snapshot(uuid,uuid,date,text,text,text,text) is
  'Returns one audited bounded Page-47 snapshot; delivery, export, and offline cache remain not configured.';
