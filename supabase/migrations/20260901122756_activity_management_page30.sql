-- Page 30: branch-scoped, immutable/versioned activity schedules with an
-- append-only operational status ledger. Activity types and searchable
-- summaries are institution-owned text. Past activity creation/revision and
-- cancellation notification policy remain explicitly unconfigured.

insert into public.permissions (permission_key, description, risk_level) values
  ('activity.read', 'Read branch activity schedules and status history', 1),
  ('activity.manage', 'Create and revise activity schedules and status', 2),
  ('activity.cancel', 'Cancel an activity with recent AAL2 evidence', 3)
on conflict (permission_key) do nothing;

insert into public.role_permissions (role_id, permission_id)
select role.id, permission.id
from public.roles role
cross join public.permissions permission
where role.is_system
  and role.role_key in (
    'organization_manager', 'branch_supervisor', 'case_manager_social_worker',
    'nurse', 'care_worker', 'professional'
  )
  and permission.permission_key = 'activity.read'
on conflict (role_id, permission_id) do nothing;

insert into public.role_permissions (role_id, permission_id)
select role.id, permission.id
from public.roles role
cross join public.permissions permission
where role.is_system
  and role.role_key in (
    'organization_manager', 'branch_supervisor', 'case_manager_social_worker'
  )
  and permission.permission_key in ('activity.manage', 'activity.cancel')
on conflict (role_id, permission_id) do nothing;

create table public.activity_schedule_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  activity_id uuid not null,
  version integer not null,
  previous_version_id uuid,
  revision_reason text,
  activity_type text not null,
  title text not null,
  search_summary text not null,
  location text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  responsible_user_id uuid not null references auth.users(id) on delete restrict,
  responsible_display_name text not null,
  capacity smallint not null,
  participants jsonb not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  creator_display_name text not null,
  created_at timestamptz not null,
  content_hash text not null,
  constraint activity_schedule_versions_branch_scope_fkey
    foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete restrict,
  constraint activity_schedule_versions_id_scope_key
    unique (id, organization_id, branch_id, activity_id),
  constraint activity_schedule_versions_chain_version_key
    unique (organization_id, branch_id, activity_id, version),
  constraint activity_schedule_versions_previous_key unique (previous_version_id),
  constraint activity_schedule_versions_previous_scope_fkey
    foreign key (previous_version_id, organization_id, branch_id, activity_id)
    references public.activity_schedule_versions (
      id, organization_id, branch_id, activity_id
    ) on delete restrict,
  constraint activity_schedule_versions_version_check check (
    version > 0
    and (
      (version = 1 and previous_version_id is null and revision_reason is null)
      or (
        version > 1 and previous_version_id is not null
        and char_length(revision_reason) between 1 and 1000
        and translate(revision_reason, E'\n\r\t', '') !~ '[[:cntrl:]]'
      )
    )
  ),
  constraint activity_schedule_versions_type_check check (
    char_length(activity_type) between 1 and 120
    and activity_type !~ '[[:cntrl:]]'
  ),
  constraint activity_schedule_versions_title_check check (
    char_length(title) between 1 and 200 and title !~ '[[:cntrl:]]'
  ),
  constraint activity_schedule_versions_summary_check check (
    char_length(search_summary) between 1 and 1000
    and translate(search_summary, E'\n\r\t', '') !~ '[[:cntrl:]]'
  ),
  constraint activity_schedule_versions_location_check check (
    char_length(location) between 1 and 200 and location !~ '[[:cntrl:]]'
  ),
  constraint activity_schedule_versions_time_check check (
    ends_at > starts_at
    and extract(year from starts_at at time zone 'Asia/Taipei') between 2000 and 2200
    and extract(year from ends_at at time zone 'Asia/Taipei') between 2000 and 2200
  ),
  constraint activity_schedule_versions_responsible_check check (
    char_length(responsible_display_name) between 1 and 120
    and responsible_display_name !~ '[[:cntrl:]]'
  ),
  constraint activity_schedule_versions_capacity_check check (
    capacity between 1 and 500
  ),
  constraint activity_schedule_versions_participants_check check (
    jsonb_typeof(participants) = 'array'
    and jsonb_array_length(participants) <= capacity
    and jsonb_array_length(participants) <= 200
  ),
  constraint activity_schedule_versions_creator_check check (
    char_length(creator_display_name) between 1 and 120
    and creator_display_name !~ '[[:cntrl:]]'
  ),
  constraint activity_schedule_versions_content_hash_check check (
    content_hash ~ '^[a-f0-9]{64}$'
  )
);

create table public.activity_status_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  activity_id uuid not null,
  schedule_version_id uuid not null,
  sequence integer not null,
  previous_event_id uuid,
  from_status text,
  to_status text not null,
  transition_note text,
  changed_by uuid not null references auth.users(id) on delete restrict,
  changer_display_name text not null,
  changed_at timestamptz not null,
  reauth_challenge_id uuid references private.reauth_challenges(id) on delete restrict,
  content_hash text not null,
  constraint activity_status_events_id_scope_key
    unique (id, organization_id, branch_id, activity_id),
  constraint activity_status_events_schedule_scope_fkey
    foreign key (schedule_version_id, organization_id, branch_id, activity_id)
    references public.activity_schedule_versions (
      id, organization_id, branch_id, activity_id
    ) on delete restrict,
  constraint activity_status_events_previous_key unique (previous_event_id),
  constraint activity_status_events_previous_scope_fkey
    foreign key (previous_event_id, organization_id, branch_id, activity_id)
    references public.activity_status_events (
      id, organization_id, branch_id, activity_id
    ) on delete restrict,
  constraint activity_status_events_stream_key
    unique (organization_id, branch_id, activity_id, sequence),
  constraint activity_status_events_sequence_check check (
    sequence > 0
    and (
      (
        sequence = 1 and previous_event_id is null
        and from_status is null and to_status = 'scheduled'
      )
      or (
        sequence > 1 and previous_event_id is not null
        and from_status is not null
      )
    )
  ),
  constraint activity_status_events_status_check check (
    to_status in ('scheduled', 'in_progress', 'completed', 'cancelled')
    and (from_status is null or from_status in (
      'scheduled', 'in_progress', 'completed', 'cancelled'
    ))
  ),
  constraint activity_status_events_note_check check (
    transition_note is null or (
      char_length(transition_note) between 1 and 1000
      and translate(transition_note, E'\n\r\t', '') !~ '[[:cntrl:]]'
    )
  ),
  constraint activity_status_events_cancellation_check check (
    (to_status = 'cancelled') = (
      transition_note is not null and reauth_challenge_id is not null
    )
  ),
  constraint activity_status_events_changer_check check (
    char_length(changer_display_name) between 1 and 120
    and changer_display_name !~ '[[:cntrl:]]'
  ),
  constraint activity_status_events_hash_check check (
    content_hash ~ '^[a-f0-9]{64}$'
  )
);

create table private.activity_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  idempotency_key uuid not null,
  operation_kind text not null,
  request_hash text not null,
  activity_id uuid not null,
  result_schedule_version_id uuid not null,
  result_schedule_version integer not null,
  previous_schedule_version_id uuid,
  result_status_event_id uuid not null,
  result_status_sequence integer not null,
  previous_status_event_id uuid,
  result_status text not null,
  responsible_user_id uuid not null references auth.users(id) on delete restrict,
  participant_client_ids uuid[] not null,
  committed_at timestamptz not null,
  reauth_challenge_id uuid references private.reauth_challenges(id) on delete restrict,
  constraint activity_operations_actor_key unique (actor_user_id, idempotency_key),
  constraint activity_operations_kind_check check (
    operation_kind in ('create', 'revise', 'transition', 'cancel')
  ),
  constraint activity_operations_schedule_scope_fkey
    foreign key (
      result_schedule_version_id, organization_id, branch_id, activity_id
    ) references public.activity_schedule_versions (
      id, organization_id, branch_id, activity_id
    ) on delete restrict,
  constraint activity_operations_previous_schedule_scope_fkey
    foreign key (
      previous_schedule_version_id, organization_id, branch_id, activity_id
    ) references public.activity_schedule_versions (
      id, organization_id, branch_id, activity_id
    ) on delete restrict,
  constraint activity_operations_status_scope_fkey
    foreign key (
      result_status_event_id, organization_id, branch_id, activity_id
    ) references public.activity_status_events (
      id, organization_id, branch_id, activity_id
    ) on delete restrict,
  constraint activity_operations_previous_status_scope_fkey
    foreign key (
      previous_status_event_id, organization_id, branch_id, activity_id
    ) references public.activity_status_events (
      id, organization_id, branch_id, activity_id
    ) on delete restrict,
  constraint activity_operations_version_check check (
    result_schedule_version > 0 and result_status_sequence > 0
  ),
  constraint activity_operations_status_check check (
    result_status in ('scheduled', 'in_progress', 'completed', 'cancelled')
  ),
  constraint activity_operations_hash_check check (
    request_hash ~ '^[a-f0-9]{64}$'
  ),
  constraint activity_operations_participants_check check (
    cardinality(participant_client_ids) between 0 and 200
  ),
  constraint activity_operations_reauth_check check (
    (operation_kind = 'cancel') = (reauth_challenge_id is not null)
  )
);

create index activity_schedule_versions_scope_start_idx
  on public.activity_schedule_versions (
    organization_id, branch_id, starts_at desc, activity_id, version desc
  );
create index activity_schedule_versions_activity_version_idx
  on public.activity_schedule_versions (activity_id, version desc);
create index activity_schedule_versions_previous_idx
  on public.activity_schedule_versions (previous_version_id)
  where previous_version_id is not null;
create index activity_schedule_versions_responsible_idx
  on public.activity_schedule_versions (responsible_user_id, starts_at desc);
create index activity_schedule_versions_created_by_idx
  on public.activity_schedule_versions (created_by, created_at desc);
create index activity_status_events_stream_idx
  on public.activity_status_events (
    organization_id, branch_id, activity_id, sequence desc
  );
create index activity_status_events_schedule_idx
  on public.activity_status_events (schedule_version_id);
create index activity_status_events_previous_idx
  on public.activity_status_events (previous_event_id)
  where previous_event_id is not null;
create index activity_status_events_changed_by_idx
  on public.activity_status_events (changed_by, changed_at desc);
create index activity_status_events_reauth_idx
  on public.activity_status_events (reauth_challenge_id)
  where reauth_challenge_id is not null;
create index activity_operations_scope_activity_idx
  on private.activity_operations (organization_id, branch_id, activity_id, committed_at desc);
create index activity_operations_result_schedule_idx
  on private.activity_operations (result_schedule_version_id);
create index activity_operations_previous_schedule_idx
  on private.activity_operations (previous_schedule_version_id)
  where previous_schedule_version_id is not null;
create index activity_operations_result_status_idx
  on private.activity_operations (result_status_event_id);
create index activity_operations_previous_status_idx
  on private.activity_operations (previous_status_event_id)
  where previous_status_event_id is not null;
create index activity_operations_responsible_idx
  on private.activity_operations (responsible_user_id);
create index activity_operations_reauth_idx
  on private.activity_operations (reauth_challenge_id)
  where reauth_challenge_id is not null;

alter table public.activity_schedule_versions enable row level security;
alter table public.activity_schedule_versions force row level security;
alter table public.activity_status_events enable row level security;
alter table public.activity_status_events force row level security;
alter table private.activity_operations enable row level security;
alter table private.activity_operations force row level security;

revoke all on table public.activity_schedule_versions
  from public, anon, authenticated, service_role;
revoke all on table public.activity_status_events
  from public, anon, authenticated, service_role;
revoke all on table private.activity_operations
  from public, anon, authenticated, service_role;

create or replace function private.activity_records_are_append_only()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception using errcode = '55000',
    message = format('%I is append-only', tg_table_name);
end;
$$;

create trigger activity_schedule_versions_append_only
before update or delete on public.activity_schedule_versions
for each row execute function private.activity_records_are_append_only();
create trigger activity_status_events_append_only
before update or delete on public.activity_status_events
for each row execute function private.activity_records_are_append_only();
create trigger activity_operations_append_only
before update or delete on private.activity_operations
for each row execute function private.activity_records_are_append_only();

create trigger activity_schedule_versions_audit_row_change
after insert or update or delete on public.activity_schedule_versions
for each row execute function private.audit_row_change();
create trigger activity_status_events_audit_row_change
after insert or update or delete on public.activity_status_events
for each row execute function private.audit_row_change();
create trigger activity_operations_audit_row_change
after insert or update or delete on private.activity_operations
for each row execute function private.audit_row_change();

create or replace function private.activity_current_authority(
  p_organization_id uuid,
  p_branch_id uuid,
  p_permission text,
  p_require_aal2 boolean default true
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and (not p_require_aal2 or coalesce(auth.jwt() ->> 'aal', '') = 'aal2')
    and exists (
      select 1 from public.profiles profile
      where profile.id = auth.uid()
        and profile.kind in ('staff', 'professional', 'driver', 'finance')
        and profile.is_active
    )
    and exists (
      select 1 from public.branches branch
      where branch.id = p_branch_id
        and branch.organization_id = p_organization_id
        and branch.is_active
    )
    and private.has_permission(p_organization_id, p_branch_id, p_permission);
$$;

create or replace function private.activity_staff_is_current(
  p_organization_id uuid,
  p_branch_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles profile
    join public.memberships membership on membership.profile_id = profile.id
    where profile.id = p_user_id
      and profile.kind in ('staff', 'professional', 'driver', 'finance')
      and profile.is_active
      and membership.organization_id = p_organization_id
      and membership.status = 'active'
      and membership.starts_at <= clock_timestamp()
      and (membership.ends_at is null or membership.ends_at > clock_timestamp())
      and (membership.branch_id is null or membership.branch_id = p_branch_id)
  );
$$;

create or replace function private.activity_participants_are_current(
  p_organization_id uuid,
  p_branch_id uuid,
  p_client_ids uuid[],
  p_service_on date
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_client_ids is not null
    and cardinality(p_client_ids) between 0 and 200
    and p_client_ids = coalesce((
      select array_agg(distinct client_id order by client_id)
      from unnest(p_client_ids) client_id
    ), '{}'::uuid[])
    and not exists (
      select 1
      from unnest(p_client_ids) selected(client_id)
      left join public.clients client
        on client.id = selected.client_id
       and client.organization_id = p_organization_id
       and client.branch_id = p_branch_id
      where client.id is null
         or client.status <> 'active'
         or client.admitted_on is null
         or client.admitted_on > p_service_on
         or (client.ended_on is not null and client.ended_on < p_service_on)
         or not private.can_staff_access_client(client.id, 'clients.read')
    );
$$;

create or replace function private.activity_participant_ids(p_participants jsonb)
returns uuid[]
language sql
immutable
security invoker
set search_path = ''
as $$
  select coalesce(array_agg((item ->> 'client_id')::uuid order by (item ->> 'client_id')::uuid), '{}'::uuid[])
  from jsonb_array_elements(p_participants) item;
$$;

create or replace function private.activity_participant_snapshot(
  p_organization_id uuid,
  p_branch_id uuid,
  p_client_ids uuid[]
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'client_id', client.id,
    'display_name', client.display_name,
    'client_status', client.status::text
  ) order by client.id), '[]'::jsonb)
  from unnest(p_client_ids) selected(client_id)
  join public.clients client
    on client.id = selected.client_id
   and client.organization_id = p_organization_id
   and client.branch_id = p_branch_id;
$$;

create or replace function private.require_activity_reauth(
  p_actor uuid,
  p_reference_time timestamptz
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_session_id uuid;
  v_challenge_id uuid;
begin
  if p_actor is null or coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception using errcode = '42501', message = 'current same-session activity AAL2 evidence is required';
  end if;
  begin
    v_session_id := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode = '42501', message = 'current same-session activity AAL2 evidence is required';
  end;
  if v_session_id is null then
    raise exception using errcode = '42501', message = 'current same-session activity AAL2 evidence is required';
  end if;
  select challenge.id into v_challenge_id
  from private.reauth_events event
  join private.reauth_challenges challenge
    on challenge.id = event.challenge_id
   and challenge.user_id = event.user_id
   and challenge.session_id = event.session_id
  where event.user_id = p_actor
    and event.session_id = v_session_id
    and event.aal = 'aal2'
    and event.revoked_at is null
    and event.verification_method in ('totp', 'webauthn', 'phone')
    and challenge.consumed_at is not null
    and challenge.invalidated_at is null
    and challenge.factor_method = event.verification_method
    and challenge.factor_verified_at = event.verified_at
    and challenge.factor_verified_at >= p_reference_time - interval '15 minutes'
    and challenge.factor_verified_at <= p_reference_time + interval '1 minute'
  order by challenge.factor_verified_at desc, challenge.id desc
  limit 1
  for share of event, challenge;
  if v_challenge_id is null then
    raise exception using errcode = '42501', message = 'current same-session activity AAL2 evidence is required';
  end if;
  return v_challenge_id;
end;
$$;

create or replace function private.mutate_activity_guarded(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_action text,
  p_activity_id uuid,
  p_expected_schedule_version_id uuid,
  p_expected_schedule_version integer,
  p_expected_status_event_id uuid,
  p_expected_status_sequence integer,
  p_activity_type text,
  p_title text,
  p_search_summary text,
  p_location text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_responsible_user_id uuid,
  p_participant_client_ids uuid[],
  p_capacity integer,
  p_reason text,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid,
  operation_kind text,
  activity_id uuid,
  schedule_version_id uuid,
  schedule_version integer,
  previous_schedule_version_id uuid,
  status_event_id uuid,
  status_sequence integer,
  previous_status_event_id uuid,
  status text,
  responsible_user_id uuid,
  participant_client_ids uuid[],
  committed_at timestamptz,
  replayed boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz;
  v_kind text;
  v_target_status text;
  v_type text := nullif(btrim(p_activity_type), '');
  v_title text := nullif(btrim(p_title), '');
  v_summary text := nullif(btrim(p_search_summary), '');
  v_location text := nullif(btrim(p_location), '');
  v_reason text := nullif(btrim(p_reason), '');
  v_request_hash text;
  v_op private.activity_operations%rowtype;
  v_schedule public.activity_schedule_versions%rowtype;
  v_new_schedule public.activity_schedule_versions%rowtype;
  v_status public.activity_status_events%rowtype;
  v_new_status public.activity_status_events%rowtype;
  v_actor_name text;
  v_responsible_name text;
  v_participants jsonb;
  v_ids uuid[];
  v_reauth uuid;
begin
  if p_action not in ('create', 'revise', 'start', 'complete', 'cancel')
     or p_expected_organization_id is null or p_expected_branch_id is null
     or p_idempotency_key is null
     or not private.activity_current_authority(
       p_expected_organization_id, p_expected_branch_id,
       case when p_action = 'cancel' then 'activity.cancel' else 'activity.manage' end,
       true
     ) then
    raise exception using errcode = '42501', message = 'activity mutation is not permitted';
  end if;

  v_kind := case when p_action in ('start', 'complete') then 'transition' else p_action end;
  v_target_status := case p_action
    when 'start' then 'in_progress'
    when 'complete' then 'completed'
    when 'cancel' then 'cancelled'
    else null
  end;
  v_ids := coalesce(p_participant_client_ids, '{}'::uuid[]);

  if p_action in ('create', 'revise') then
    if v_type is null or char_length(v_type) > 120 or v_type ~ '[[:cntrl:]]'
       or v_title is null or char_length(v_title) > 200 or v_title ~ '[[:cntrl:]]'
       or v_summary is null or char_length(v_summary) > 1000
       or translate(v_summary, E'\n\r\t', '') ~ '[[:cntrl:]]'
       or v_location is null or char_length(v_location) > 200 or v_location ~ '[[:cntrl:]]'
       or p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at
       or extract(year from p_starts_at at time zone 'Asia/Taipei') not between 2000 and 2200
       or extract(year from p_ends_at at time zone 'Asia/Taipei') not between 2000 and 2200
       or p_responsible_user_id is null
       or p_capacity is null or p_capacity not between 1 and 500
       or cardinality(v_ids) > least(p_capacity, 200)
       or v_ids is distinct from coalesce((
         select array_agg(distinct selected order by selected) from unnest(v_ids) selected
       ), '{}'::uuid[])
       or (p_action = 'create' and v_reason is not null)
       or (p_action = 'revise' and (
         v_reason is null or char_length(v_reason) > 1000
         or translate(v_reason, E'\n\r\t', '') ~ '[[:cntrl:]]'
       )) then
      raise exception using errcode = '22023', message = 'activity schedule input is invalid';
    end if;
  elsif p_activity_id is null or p_expected_schedule_version_id is null
     or p_expected_schedule_version is null or p_expected_status_event_id is null
     or p_expected_status_sequence is null
     or v_reason is not null and (
       char_length(v_reason) > 1000 or translate(v_reason, E'\n\r\t', '') ~ '[[:cntrl:]]'
     )
     or (p_action = 'cancel' and v_reason is null)
     or (p_action <> 'cancel' and v_reason is not null) then
    raise exception using errcode = '22023', message = 'activity transition input is invalid';
  end if;

  v_request_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version', 1, 'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id, 'actor_user_id', v_actor,
    'action', p_action, 'activity_id', p_activity_id,
    'expected_schedule_version_id', p_expected_schedule_version_id,
    'expected_schedule_version', p_expected_schedule_version,
    'expected_status_event_id', p_expected_status_event_id,
    'expected_status_sequence', p_expected_status_sequence,
    'activity_type', v_type, 'title', v_title, 'search_summary', v_summary,
    'location', v_location, 'starts_at', p_starts_at, 'ends_at', p_ends_at,
    'responsible_user_id', p_responsible_user_id,
    'participant_client_ids', v_ids, 'capacity', p_capacity, 'reason', v_reason
  )::text, 'UTF8')), 'hex');

  perform pg_advisory_xact_lock(hashtextextended(
    'activity-operation:' || v_actor::text || ':' || p_idempotency_key::text, 0
  ));
  select operation.* into v_op
  from private.activity_operations operation
  where operation.actor_user_id = v_actor
    and operation.idempotency_key = p_idempotency_key;
  if found then
    if v_op.organization_id <> p_expected_organization_id
       or v_op.branch_id <> p_expected_branch_id
       or v_op.operation_kind <> v_kind
       or v_op.request_hash <> v_request_hash
       or (p_activity_id is not null and v_op.activity_id <> p_activity_id) then
      raise exception using errcode = '23505', message = 'activity idempotency conflict';
    end if;
    select schedule.* into strict v_schedule
    from public.activity_schedule_versions schedule
    where schedule.id = v_op.result_schedule_version_id
      and schedule.organization_id = p_expected_organization_id
      and schedule.branch_id = p_expected_branch_id
      and schedule.activity_id = v_op.activity_id;
    if not private.activity_current_authority(
         p_expected_organization_id, p_expected_branch_id,
         case when p_action = 'cancel' then 'activity.cancel' else 'activity.manage' end, true
       )
       or not private.activity_staff_is_current(
         p_expected_organization_id, p_expected_branch_id, v_op.responsible_user_id
       )
       or not private.activity_participants_are_current(
         p_expected_organization_id, p_expected_branch_id,
         v_op.participant_client_ids, (v_schedule.starts_at at time zone 'Asia/Taipei')::date
       )
       or (p_action = 'cancel' and private.require_activity_reauth(v_actor, clock_timestamp()) is null) then
      raise exception using errcode = '42501', message = 'activity replay authority expired';
    end if;
    return query select v_op.id, v_op.operation_kind, v_op.activity_id,
      v_op.result_schedule_version_id, v_op.result_schedule_version,
      v_op.previous_schedule_version_id, v_op.result_status_event_id,
      v_op.result_status_sequence, v_op.previous_status_event_id,
      v_op.result_status, v_op.responsible_user_id,
      v_op.participant_client_ids, v_op.committed_at, true;
    return;
  end if;

  v_now := clock_timestamp();
  select btrim(profile.display_name) into v_actor_name
  from public.profiles profile where profile.id = v_actor and profile.is_active;
  if v_actor_name is null then
    raise exception using errcode = '42501', message = 'activity actor is not current';
  end if;

  if p_action = 'create' then
    if p_activity_id is not null or p_expected_schedule_version_id is not null
       or p_expected_schedule_version is not null or p_expected_status_event_id is not null
       or p_expected_status_sequence is not null
       or p_starts_at < date_trunc('minute', v_now) then
      raise exception using errcode = '22023', message = 'past activity creation policy is not configured';
    end if;
    if not private.activity_staff_is_current(
         p_expected_organization_id, p_expected_branch_id, p_responsible_user_id
       ) or not private.activity_participants_are_current(
         p_expected_organization_id, p_expected_branch_id, v_ids,
         (p_starts_at at time zone 'Asia/Taipei')::date
       ) then
      raise exception using errcode = '42501', message = 'activity entities are outside current scope';
    end if;
    select btrim(profile.display_name) into v_responsible_name
    from public.profiles profile where profile.id = p_responsible_user_id;
    v_participants := private.activity_participant_snapshot(
      p_expected_organization_id, p_expected_branch_id, v_ids
    );
    p_activity_id := gen_random_uuid();
    insert into public.activity_schedule_versions (
      organization_id, branch_id, activity_id, version, previous_version_id,
      revision_reason, activity_type, title, search_summary, location,
      starts_at, ends_at, responsible_user_id, responsible_display_name,
      capacity, participants, created_by, creator_display_name, created_at, content_hash
    ) values (
      p_expected_organization_id, p_expected_branch_id, p_activity_id, 1, null,
      null, v_type, v_title, v_summary, v_location, p_starts_at, p_ends_at,
      p_responsible_user_id, v_responsible_name, p_capacity, v_participants,
      v_actor, v_actor_name, v_now,
      encode(sha256(convert_to(jsonb_build_object(
        'schema_version',1,'activity_id',p_activity_id,'version',1,
        'type',v_type,'title',v_title,'summary',v_summary,'location',v_location,
        'starts_at',p_starts_at,'ends_at',p_ends_at,'responsible',p_responsible_user_id,
        'participants',v_participants,'capacity',p_capacity,'created_at',v_now
      )::text,'UTF8')),'hex')
    ) returning * into v_new_schedule;
    insert into public.activity_status_events (
      organization_id, branch_id, activity_id, schedule_version_id, sequence,
      previous_event_id, from_status, to_status, transition_note, changed_by,
      changer_display_name, changed_at, reauth_challenge_id, content_hash
    ) values (
      p_expected_organization_id, p_expected_branch_id, p_activity_id,
      v_new_schedule.id, 1, null, null, 'scheduled', null, v_actor,
      v_actor_name, v_now, null,
      encode(sha256(convert_to(jsonb_build_object(
        'schema_version',1,'activity_id',p_activity_id,'sequence',1,
        'to_status','scheduled','schedule_version_id',v_new_schedule.id,'changed_at',v_now
      )::text,'UTF8')),'hex')
    ) returning * into v_new_status;
  else
    perform pg_advisory_xact_lock(hashtextextended(
      'activity-chain:' || p_expected_organization_id::text || ':' ||
      p_expected_branch_id::text || ':' || p_activity_id::text, 0
    ));
    select schedule.* into v_schedule
    from public.activity_schedule_versions schedule
    where schedule.organization_id = p_expected_organization_id
      and schedule.branch_id = p_expected_branch_id
      and schedule.activity_id = p_activity_id
    order by schedule.version desc limit 1 for share;
    select event.* into v_status
    from public.activity_status_events event
    where event.organization_id = p_expected_organization_id
      and event.branch_id = p_expected_branch_id
      and event.activity_id = p_activity_id
    order by event.sequence desc limit 1 for share;
    if v_schedule.id is null or v_status.id is null
       or v_schedule.id <> p_expected_schedule_version_id
       or v_schedule.version <> p_expected_schedule_version
       or v_status.id <> p_expected_status_event_id
       or v_status.sequence <> p_expected_status_sequence then
      raise exception using errcode = '40001', message = 'activity chain version is stale';
    end if;
    if not private.activity_staff_is_current(
         p_expected_organization_id, p_expected_branch_id, v_schedule.responsible_user_id
       ) or not private.activity_participants_are_current(
         p_expected_organization_id, p_expected_branch_id,
         private.activity_participant_ids(v_schedule.participants),
         (v_schedule.starts_at at time zone 'Asia/Taipei')::date
       ) then
      raise exception using errcode = '42501', message = 'current activity entities are outside scope';
    end if;

    if p_action = 'revise' then
      if v_status.to_status <> 'scheduled'
         or v_schedule.starts_at < date_trunc('minute', v_now)
         or p_starts_at < date_trunc('minute', v_now) then
        raise exception using errcode = '22023', message = 'past activity revision policy is not configured';
      end if;
      if not private.activity_staff_is_current(
           p_expected_organization_id, p_expected_branch_id, p_responsible_user_id
         ) or not private.activity_participants_are_current(
           p_expected_organization_id, p_expected_branch_id, v_ids,
           (p_starts_at at time zone 'Asia/Taipei')::date
         ) then
        raise exception using errcode = '42501', message = 'revised activity entities are outside current scope';
      end if;
      select btrim(profile.display_name) into v_responsible_name
      from public.profiles profile where profile.id = p_responsible_user_id;
      v_participants := private.activity_participant_snapshot(
        p_expected_organization_id, p_expected_branch_id, v_ids
      );
      insert into public.activity_schedule_versions (
        organization_id, branch_id, activity_id, version, previous_version_id,
        revision_reason, activity_type, title, search_summary, location,
        starts_at, ends_at, responsible_user_id, responsible_display_name,
        capacity, participants, created_by, creator_display_name, created_at, content_hash
      ) values (
        p_expected_organization_id, p_expected_branch_id, p_activity_id,
        v_schedule.version + 1, v_schedule.id, v_reason, v_type, v_title,
        v_summary, v_location, p_starts_at, p_ends_at, p_responsible_user_id,
        v_responsible_name, p_capacity, v_participants, v_actor, v_actor_name, v_now,
        encode(sha256(convert_to(jsonb_build_object(
          'schema_version',1,'activity_id',p_activity_id,'version',v_schedule.version+1,
          'previous_version_id',v_schedule.id,'reason',v_reason,'type',v_type,
          'title',v_title,'summary',v_summary,'location',v_location,
          'starts_at',p_starts_at,'ends_at',p_ends_at,'responsible',p_responsible_user_id,
          'participants',v_participants,'capacity',p_capacity,'created_at',v_now
        )::text,'UTF8')),'hex')
      ) returning * into v_new_schedule;
      v_new_status := v_status;
    else
      if (v_status.to_status = 'scheduled' and v_target_status not in ('in_progress','completed','cancelled'))
         or (v_status.to_status = 'in_progress' and v_target_status not in ('completed','cancelled'))
         or v_status.to_status in ('completed','cancelled') then
        raise exception using errcode = '23514', message = 'activity status transition is illegal';
      end if;
      v_reauth := case when p_action = 'cancel'
        then private.require_activity_reauth(v_actor, clock_timestamp()) else null end;
      insert into public.activity_status_events (
        organization_id, branch_id, activity_id, schedule_version_id, sequence,
        previous_event_id, from_status, to_status, transition_note, changed_by,
        changer_display_name, changed_at, reauth_challenge_id, content_hash
      ) values (
        p_expected_organization_id, p_expected_branch_id, p_activity_id,
        v_schedule.id, v_status.sequence + 1, v_status.id, v_status.to_status,
        v_target_status, v_reason, v_actor, v_actor_name, clock_timestamp(), v_reauth,
        encode(sha256(convert_to(jsonb_build_object(
          'schema_version',1,'activity_id',p_activity_id,'sequence',v_status.sequence+1,
          'previous_event_id',v_status.id,'from_status',v_status.to_status,
          'to_status',v_target_status,'reason',v_reason,'schedule_version_id',v_schedule.id
        )::text,'UTF8')),'hex')
      ) returning * into v_new_status;
      v_new_schedule := v_schedule;
    end if;
  end if;

  insert into private.activity_operations (
    organization_id, branch_id, actor_user_id, idempotency_key, operation_kind,
    request_hash, activity_id, result_schedule_version_id,
    result_schedule_version, previous_schedule_version_id,
    result_status_event_id, result_status_sequence, previous_status_event_id,
    result_status, responsible_user_id, participant_client_ids,
    committed_at, reauth_challenge_id
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_actor, p_idempotency_key,
    v_kind, v_request_hash, p_activity_id, v_new_schedule.id,
    v_new_schedule.version, v_new_schedule.previous_version_id,
    v_new_status.id, v_new_status.sequence, v_new_status.previous_event_id,
    v_new_status.to_status, v_new_schedule.responsible_user_id,
    private.activity_participant_ids(v_new_schedule.participants),
    clock_timestamp(), v_reauth
  ) returning * into v_op;

  insert into public.audit_events (
    organization_id, branch_id, actor_user_id, action, table_name, row_pk,
    idempotency_key, changed_fields, metadata
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_actor,
    case when p_action = 'revise' then 'correct' else 'insert' end,
    case when p_action in ('create','revise') then 'activity_schedule_versions'
      else 'activity_status_events' end,
    case when p_action in ('create','revise') then v_new_schedule.id::text
      else v_new_status.id::text end,
    p_idempotency_key,
    case when p_action in ('create','revise') then array['schedule_version']
      else array['status'] end,
    jsonb_build_object(
      'workflow','page30_activity_management_v1','activity_id',p_activity_id,
      'schedule_version',v_new_schedule.version,'status_sequence',v_new_status.sequence,
      'status',v_new_status.to_status,'participant_count',cardinality(v_op.participant_client_ids),
      'notification_delivery','none_not_sent'
    )
  );

  if not private.activity_current_authority(
       p_expected_organization_id, p_expected_branch_id,
       case when p_action = 'cancel' then 'activity.cancel' else 'activity.manage' end, true
     ) or not private.activity_staff_is_current(
       p_expected_organization_id, p_expected_branch_id, v_op.responsible_user_id
     ) or not private.activity_participants_are_current(
       p_expected_organization_id, p_expected_branch_id,
       v_op.participant_client_ids,
       (v_new_schedule.starts_at at time zone 'Asia/Taipei')::date
     ) or (p_action = 'cancel' and private.require_activity_reauth(v_actor, clock_timestamp()) is null) then
    raise exception using errcode = '42501', message = 'activity final verification failed';
  end if;

  return query select v_op.id, v_op.operation_kind, v_op.activity_id,
    v_op.result_schedule_version_id, v_op.result_schedule_version,
    v_op.previous_schedule_version_id, v_op.result_status_event_id,
    v_op.result_status_sequence, v_op.previous_status_event_id,
    v_op.result_status, v_op.responsible_user_id, v_op.participant_client_ids,
    v_op.committed_at, false;
end;
$$;

create or replace function public.mutate_activity(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_action text,
  p_activity_id uuid,
  p_expected_schedule_version_id uuid,
  p_expected_schedule_version integer,
  p_expected_status_event_id uuid,
  p_expected_status_sequence integer,
  p_activity_type text,
  p_title text,
  p_search_summary text,
  p_location text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_responsible_user_id uuid,
  p_participant_client_ids uuid[],
  p_capacity integer,
  p_reason text,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid, operation_kind text, activity_id uuid,
  schedule_version_id uuid, schedule_version integer,
  previous_schedule_version_id uuid, status_event_id uuid,
  status_sequence integer, previous_status_event_id uuid, status text,
  responsible_user_id uuid, participant_client_ids uuid[],
  committed_at timestamptz, replayed boolean
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from private.mutate_activity_guarded(
    p_expected_organization_id, p_expected_branch_id, p_action, p_activity_id,
    p_expected_schedule_version_id, p_expected_schedule_version,
    p_expected_status_event_id, p_expected_status_sequence, p_activity_type,
    p_title, p_search_summary, p_location, p_starts_at, p_ends_at,
    p_responsible_user_id, p_participant_client_ids, p_capacity, p_reason,
    p_idempotency_key
  );
$$;

create or replace function private.activity_snapshot_bundle(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_date_from date,
  p_date_to date,
  p_activity_type text,
  p_status text,
  p_query text,
  p_reference_time timestamptz
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  with current_schedules as materialized (
    select distinct on (schedule.activity_id) schedule.*
    from public.activity_schedule_versions schedule
    where schedule.organization_id = p_expected_organization_id
      and schedule.branch_id = p_expected_branch_id
    order by schedule.activity_id, schedule.version desc, schedule.id desc
  ), current_statuses as materialized (
    select distinct on (event.activity_id) event.*
    from public.activity_status_events event
    where event.organization_id = p_expected_organization_id
      and event.branch_id = p_expected_branch_id
    order by event.activity_id, event.sequence desc, event.id desc
  ), scoped as materialized (
    select schedule.*, event.id as status_event_id,
      event.sequence as status_sequence, event.previous_event_id,
      event.to_status as current_status,
      case when event.to_status = 'cancelled' then event.transition_note else null end
        as cancellation_reason,
      not exists (
        select 1 from jsonb_array_elements(schedule.participants) participant
        where not private.can_staff_access_client(
          (participant ->> 'client_id')::uuid, 'clients.read'
        )
      ) as participants_visible
    from current_schedules schedule
    join current_statuses event on event.activity_id = schedule.activity_id
  ), filtered as materialized (
    select scoped.*
    from scoped
    where scoped.participants_visible
      and (p_date_from is null or scoped.ends_at >= p_date_from::timestamp at time zone 'Asia/Taipei')
      and (p_date_to is null or scoped.starts_at < (p_date_to + 1)::timestamp at time zone 'Asia/Taipei')
      and (p_activity_type is null or scoped.activity_type = p_activity_type)
      and (p_status = 'all' or scoped.current_status = p_status)
      and (
        p_query is null or lower(
          scoped.activity_type || E'\n' || scoped.title || E'\n' ||
          scoped.search_summary || E'\n' || scoped.location
        ) like '%' || lower(p_query) || '%'
      )
  ), metrics as (
    select count(*)::bigint as matching_total,
      count(*) filter (
        where current_status in ('scheduled','in_progress')
          and starts_at >= p_reference_time
      )::bigint as upcoming_total,
      count(*) filter (where current_status = 'scheduled')::bigint as scheduled_total,
      count(*) filter (where current_status = 'in_progress')::bigint as in_progress_total,
      count(*) filter (where current_status = 'completed')::bigint as completed_total,
      count(*) filter (where current_status = 'cancelled')::bigint as cancelled_total
    from filtered
  ), selected as materialized (
    select * from filtered
    order by starts_at desc, activity_id
    limit 200
  ), items as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'activity_id', selected.activity_id,
      'schedule_version_id', selected.id,
      'schedule_version', selected.version,
      'previous_schedule_version_id', selected.previous_version_id,
      'revision_reason', selected.revision_reason,
      'activity_type', selected.activity_type,
      'title', selected.title,
      'search_summary', selected.search_summary,
      'location', selected.location,
      'starts_at', selected.starts_at,
      'ends_at', selected.ends_at,
      'responsible_user_id', selected.responsible_user_id,
      'responsible_display_name', selected.responsible_display_name,
      'capacity', selected.capacity,
      'participants', selected.participants,
      'participant_count', jsonb_array_length(selected.participants),
      'status_event_id', selected.status_event_id,
      'status_sequence', selected.status_sequence,
      'previous_status_event_id', selected.previous_event_id,
      'status', selected.current_status,
      'cancellation_reason', selected.cancellation_reason,
      'created_at', selected.created_at,
      'schedule_history_total', (
        select count(*) from public.activity_schedule_versions history
        where history.organization_id = p_expected_organization_id
          and history.branch_id = p_expected_branch_id
          and history.activity_id = selected.activity_id
      ),
      'schedule_history', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'schedule_version_id', history.id,
          'version', history.version,
          'previous_schedule_version_id', history.previous_version_id,
          'revision_reason', history.revision_reason,
          'starts_at', history.starts_at,
          'ends_at', history.ends_at,
          'created_at', history.created_at,
          'creator_display_name', history.creator_display_name
        ) order by history.version desc), '[]'::jsonb)
        from (
          select * from public.activity_schedule_versions h
          where h.organization_id = p_expected_organization_id
            and h.branch_id = p_expected_branch_id
            and h.activity_id = selected.activity_id
          order by h.version desc limit 50
        ) history
      ),
      'status_history_total', (
        select count(*) from public.activity_status_events history
        where history.organization_id = p_expected_organization_id
          and history.branch_id = p_expected_branch_id
          and history.activity_id = selected.activity_id
      ),
      'status_history', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'status_event_id', history.id,
          'sequence', history.sequence,
          'previous_status_event_id', history.previous_event_id,
          'from_status', history.from_status,
          'to_status', history.to_status,
          'transition_note', history.transition_note,
          'changer_display_name', history.changer_display_name,
          'changed_at', history.changed_at,
          'reauthenticated', history.reauth_challenge_id is not null
        ) order by history.sequence desc), '[]'::jsonb)
        from (
          select * from public.activity_status_events h
          where h.organization_id = p_expected_organization_id
            and h.branch_id = p_expected_branch_id
            and h.activity_id = selected.activity_id
          order by h.sequence desc limit 50
        ) history
      )
    ) order by selected.starts_at desc, selected.activity_id)
    filter (where selected.activity_id is not null), '[]'::jsonb) as value
    from selected
  ), staff_candidates as materialized (
    select distinct on (profile.id) profile.id as user_id,
      profile.display_name, profile.employee_code,
      case when membership.branch_id is null then 'organization' else 'branch' end as membership_scope
    from public.profiles profile
    join public.memberships membership on membership.profile_id = profile.id
    where profile.kind in ('staff','professional','driver','finance')
      and profile.is_active
      and membership.organization_id = p_expected_organization_id
      and membership.status = 'active'
      and membership.starts_at <= p_reference_time
      and (membership.ends_at is null or membership.ends_at > p_reference_time)
      and (membership.branch_id is null or membership.branch_id = p_expected_branch_id)
    order by profile.id, membership.branch_id nulls last
  ), staff_result as (
    select (select count(*) from staff_candidates)::bigint as total,
      coalesce((select jsonb_agg(jsonb_build_object(
        'user_id', option.user_id, 'display_name', option.display_name,
        'employee_code', option.employee_code, 'membership_scope', option.membership_scope
      ) order by option.display_name collate "C", option.user_id)
      from (select * from staff_candidates order by display_name collate "C", user_id limit 200) option), '[]'::jsonb) as value
  ), client_candidates as materialized (
    select client.id as client_id, client.display_name, client.client_code
    from public.clients client
    where client.organization_id = p_expected_organization_id
      and client.branch_id = p_expected_branch_id
      and client.status = 'active'
      and client.admitted_on is not null
      and client.admitted_on <= (p_reference_time at time zone 'Asia/Taipei')::date
      and (client.ended_on is null or client.ended_on >= (p_reference_time at time zone 'Asia/Taipei')::date)
      and private.can_staff_access_client(client.id, 'clients.read')
  ), client_result as (
    select (select count(*) from client_candidates)::bigint as total,
      coalesce((select jsonb_agg(jsonb_build_object(
        'client_id', option.client_id, 'display_name', option.display_name,
        'client_code', option.client_code
      ) order by option.display_name collate "C", option.client_id)
      from (select * from client_candidates order by display_name collate "C", client_id limit 200) option), '[]'::jsonb) as value
  ), type_candidates as materialized (
    select candidate.activity_type
    from (select distinct scoped.activity_type collate "C" as activity_type from scoped) candidate
    order by candidate.activity_type
  ), type_result as (
    select (select count(*) from type_candidates)::bigint as total,
      coalesce((select jsonb_agg(option.activity_type order by option.activity_type)
        from (select * from type_candidates limit 200) option), '[]'::jsonb) as value
  )
  select jsonb_build_object(
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id,
    'generated_at', p_reference_time,
    'items', items.value,
    'matching_total', metrics.matching_total,
    'items_truncated', metrics.matching_total > jsonb_array_length(items.value),
    'upcoming_total', metrics.upcoming_total,
    'scheduled_total', metrics.scheduled_total,
    'in_progress_total', metrics.in_progress_total,
    'completed_total', metrics.completed_total,
    'cancelled_total', metrics.cancelled_total,
    'staff_options', staff_result.value,
    'staff_total', staff_result.total,
    'staff_truncated', staff_result.total > jsonb_array_length(staff_result.value),
    'client_options', client_result.value,
    'client_total', client_result.total,
    'client_truncated', client_result.total > jsonb_array_length(client_result.value),
    'type_options', type_result.value,
    'type_total', type_result.total,
    'type_truncated', type_result.total > jsonb_array_length(type_result.value),
    'past_change_policy_status', 'not_configured',
    'cancellation_notification_policy', 'institution_owned_not_configured',
    'notification_delivery', 'none_not_sent'
  )
  from metrics cross join items cross join staff_result cross join client_result cross join type_result;
$$;

create or replace function private.activity_snapshot_response(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_date_from date,
  p_date_to date,
  p_activity_type text,
  p_status text,
  p_query text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_type text := nullif(btrim(p_activity_type), '');
  v_query text := nullif(btrim(p_query), '');
  v_bundle jsonb;
  v_final jsonb;
begin
  if p_expected_organization_id is null or p_expected_branch_id is null
     or p_status not in ('all','scheduled','in_progress','completed','cancelled')
     or (p_date_from is not null and extract(year from p_date_from) not between 2000 and 2200)
     or (p_date_to is not null and extract(year from p_date_to) not between 2000 and 2200)
     or (p_date_from is not null and p_date_to is not null and p_date_from > p_date_to)
     or (v_type is not null and (char_length(v_type) > 120 or v_type ~ '[[:cntrl:]]'))
     or (v_query is not null and (char_length(v_query) > 120 or v_query ~ '[[:cntrl:]]'))
     or not private.activity_current_authority(
       p_expected_organization_id, p_expected_branch_id, 'activity.read', true
     ) then
    raise exception using errcode = '42501', message = 'activity snapshot is not permitted';
  end if;
  v_bundle := private.activity_snapshot_bundle(
    p_expected_organization_id, p_expected_branch_id, p_date_from, p_date_to,
    v_type, p_status, v_query, v_now
  );
  insert into public.audit_events (
    organization_id, branch_id, actor_user_id, action, table_name, row_pk,
    changed_fields, metadata
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_actor, 'select',
    'activity_management_snapshot', null, '{}'::text[], jsonb_build_object(
      'workflow','page30_activity_management_v1',
      'date_filter_present',p_date_from is not null or p_date_to is not null,
      'type_filter_present',v_type is not null,'status_filter',p_status,
      'query_present',v_query is not null,'query_length',coalesce(char_length(v_query),0),
      'matching_total',v_bundle -> 'matching_total'
    )
  );
  if not private.activity_current_authority(
       p_expected_organization_id, p_expected_branch_id, 'activity.read', true
     ) then
    raise exception using errcode = '42501', message = 'activity snapshot authority expired';
  end if;
  v_final := private.activity_snapshot_bundle(
    p_expected_organization_id, p_expected_branch_id, p_date_from, p_date_to,
    v_type, p_status, v_query, v_now
  );
  if v_bundle is distinct from v_final then
    raise exception using errcode = '40001', message = 'activity snapshot changed during authorization';
  end if;
  return v_final;
end;
$$;

create or replace function public.activity_management_snapshot(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_date_from date default null,
  p_date_to date default null,
  p_activity_type text default null,
  p_status text default 'all',
  p_query text default null
)
returns table(
  organization_id uuid, branch_id uuid, generated_at timestamptz,
  items jsonb, matching_total bigint, items_truncated boolean,
  upcoming_total bigint, scheduled_total bigint, in_progress_total bigint,
  completed_total bigint, cancelled_total bigint,
  staff_options jsonb, staff_total bigint, staff_truncated boolean,
  client_options jsonb, client_total bigint, client_truncated boolean,
  type_options jsonb, type_total bigint, type_truncated boolean,
  past_change_policy_status text, cancellation_notification_policy text,
  notification_delivery text
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select (value ->> 'organization_id')::uuid,
    (value ->> 'branch_id')::uuid, (value ->> 'generated_at')::timestamptz,
    value -> 'items', (value ->> 'matching_total')::bigint,
    (value ->> 'items_truncated')::boolean,
    (value ->> 'upcoming_total')::bigint, (value ->> 'scheduled_total')::bigint,
    (value ->> 'in_progress_total')::bigint, (value ->> 'completed_total')::bigint,
    (value ->> 'cancelled_total')::bigint, value -> 'staff_options',
    (value ->> 'staff_total')::bigint, (value ->> 'staff_truncated')::boolean,
    value -> 'client_options', (value ->> 'client_total')::bigint,
    (value ->> 'client_truncated')::boolean, value -> 'type_options',
    (value ->> 'type_total')::bigint, (value ->> 'type_truncated')::boolean,
    value ->> 'past_change_policy_status', value ->> 'cancellation_notification_policy',
    value ->> 'notification_delivery'
  from (select private.activity_snapshot_response(
    p_expected_organization_id, p_expected_branch_id, p_date_from, p_date_to,
    p_activity_type, p_status, p_query
  ) value) result;
$$;

revoke all on function private.activity_records_are_append_only() from public, anon, authenticated, service_role;
revoke all on function private.activity_current_authority(uuid, uuid, text, boolean) from public, anon, authenticated, service_role;
revoke all on function private.activity_staff_is_current(uuid, uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function private.activity_participants_are_current(uuid, uuid, uuid[], date) from public, anon, authenticated, service_role;
revoke all on function private.activity_participant_ids(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.activity_participant_snapshot(uuid, uuid, uuid[]) from public, anon, authenticated, service_role;
revoke all on function private.require_activity_reauth(uuid, timestamptz) from public, anon, authenticated, service_role;
revoke all on function private.mutate_activity_guarded(uuid, uuid, text, uuid, uuid, integer, uuid, integer, text, text, text, text, timestamptz, timestamptz, uuid, uuid[], integer, text, uuid) from public, anon, service_role;
revoke all on function private.activity_snapshot_bundle(uuid, uuid, date, date, text, text, text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function private.activity_snapshot_response(uuid, uuid, date, date, text, text, text) from public, anon, service_role;
revoke all on function public.mutate_activity(uuid, uuid, text, uuid, uuid, integer, uuid, integer, text, text, text, text, timestamptz, timestamptz, uuid, uuid[], integer, text, uuid) from public, anon, service_role;
revoke all on function public.activity_management_snapshot(uuid, uuid, date, date, text, text, text) from public, anon, service_role;

grant execute on function private.mutate_activity_guarded(uuid, uuid, text, uuid, uuid, integer, uuid, integer, text, text, text, text, timestamptz, timestamptz, uuid, uuid[], integer, text, uuid) to authenticated;
grant execute on function private.activity_snapshot_response(uuid, uuid, date, date, text, text, text) to authenticated;
grant execute on function public.mutate_activity(uuid, uuid, text, uuid, uuid, integer, uuid, integer, text, text, text, text, timestamptz, timestamptz, uuid, uuid[], integer, text, uuid) to authenticated;
grant execute on function public.activity_management_snapshot(uuid, uuid, date, date, text, text, text) to authenticated;

comment on table public.activity_schedule_versions is
  'Immutable Page 30 schedule versions. Institution activity type remains bounded text; past revision governance is not configured.';
comment on table public.activity_status_events is
  'Append-only Page 30 status ledger. Cancellation stores explicit reason and same-session recent AAL2 evidence.';
comment on function public.activity_management_snapshot(uuid, uuid, date, date, text, text, text) is
  'Audited, branch-scoped Page 30 activity snapshot. Search excludes participant and responsible names.';
comment on function public.mutate_activity(uuid, uuid, text, uuid, uuid, integer, uuid, integer, text, text, text, text, timestamptz, timestamptz, uuid, uuid[], integer, text, uuid) is
  'Actor-idempotent Page 30 mutation wrapper. Schedule/status history is append-only; notifications are not sent.';
