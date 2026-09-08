-- Page 44: branch-scoped reassurance calendar. Every visible event is a
-- published immutable version; revisions and cancellations append a child.
-- External notification/signature providers are deliberately not configured.

insert into public.permissions (permission_key, description, risk_level) values
  ('reassurance_calendar.read', 'Read branch reassurance calendar snapshots', 1),
  ('reassurance_calendar.manage', 'Create and revise published reassurance calendar events', 2),
  ('reassurance_calendar.cancel', 'Cancel reassurance calendar events with a reason', 3)
on conflict (permission_key) do nothing;

insert into public.role_permissions (role_id, permission_id)
select role.id, permission.id
from public.roles role cross join public.permissions permission
where role.is_system
  and role.role_key in (
    'organization_manager', 'branch_supervisor', 'case_manager_social_worker',
    'nurse', 'care_worker', 'professional', 'driver'
  )
  and permission.permission_key = 'reassurance_calendar.read'
on conflict (role_id, permission_id) do nothing;

insert into public.role_permissions (role_id, permission_id)
select role.id, permission.id
from public.roles role cross join public.permissions permission
where role.is_system
  and role.role_key in (
    'organization_manager', 'branch_supervisor', 'case_manager_social_worker'
  )
  and permission.permission_key in (
    'reassurance_calendar.manage', 'reassurance_calendar.cancel'
  )
on conflict (role_id, permission_id) do nothing;

create table public.reassurance_calendar_event_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  event_key uuid not null,
  version integer not null,
  previous_version_id uuid,
  record_kind text not null,
  revision_reason text,
  category text not null,
  title text not null,
  summary text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  location text not null,
  audience_kind text not null,
  target_client_ids uuid[] not null,
  audience_snapshot jsonb not null,
  responsible_user_id uuid not null references auth.users(id) on delete restrict,
  responsible_display_name text not null,
  status text not null,
  cancellation_reason text,
  publication_state text not null,
  published_by uuid not null references auth.users(id) on delete restrict,
  publisher_display_name text not null,
  published_at timestamptz not null,
  signature_status text not null,
  notification_status text not null,
  notification_delivery text not null,
  reauth_challenge_id uuid not null references private.reauth_challenges(id) on delete restrict,
  content_hash text not null,
  constraint reassurance_calendar_event_versions_branch_scope_fkey
    foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete restrict,
  constraint reassurance_calendar_event_versions_id_scope_key
    unique (id, organization_id, branch_id, event_key),
  constraint reassurance_calendar_event_versions_chain_key
    unique (organization_id, branch_id, event_key, version),
  constraint reassurance_calendar_event_versions_previous_key
    unique (previous_version_id),
  constraint reassurance_calendar_event_versions_previous_scope_fkey
    foreign key (previous_version_id, organization_id, branch_id, event_key)
    references public.reassurance_calendar_event_versions (
      id, organization_id, branch_id, event_key
    ) on delete restrict,
  constraint reassurance_calendar_event_versions_lineage_check check (
    version > 0 and (
      (version = 1 and previous_version_id is null
        and record_kind = 'original' and revision_reason is null)
      or (version > 1 and previous_version_id is not null
        and record_kind in ('revision', 'cancellation')
        and char_length(revision_reason) between 2 and 500
        and translate(revision_reason, E'\n\r\t', '') !~ '[[:cntrl:]]')
    )
  ),
  constraint reassurance_calendar_event_versions_category_check check (
    category in ('care', 'activity', 'transport', 'appointment', 'reminder')
  ),
  constraint reassurance_calendar_event_versions_text_check check (
    char_length(title) between 1 and 200 and title !~ '[[:cntrl:]]'
    and char_length(summary) between 1 and 2000
    and translate(summary, E'\n\r\t', '') !~ '[[:cntrl:]]'
    and char_length(location) between 1 and 200 and location !~ '[[:cntrl:]]'
    and char_length(responsible_display_name) between 1 and 120
    and responsible_display_name !~ '[[:cntrl:]]'
    and char_length(publisher_display_name) between 1 and 120
    and publisher_display_name !~ '[[:cntrl:]]'
  ),
  constraint reassurance_calendar_event_versions_time_check check (
    ends_at > starts_at
    and extract(year from starts_at at time zone 'Asia/Taipei') between 2000 and 2200
    and extract(year from ends_at at time zone 'Asia/Taipei') between 2000 and 2200
  ),
  constraint reassurance_calendar_event_versions_audience_check check (
    audience_kind in ('all_branch_clients', 'selected_clients')
    and cardinality(target_client_ids) between 0 and 200
    and jsonb_typeof(audience_snapshot) = 'array'
    and jsonb_array_length(audience_snapshot) between 1 and 200
    and (
      (audience_kind = 'all_branch_clients' and cardinality(target_client_ids) = 0
        and jsonb_array_length(audience_snapshot) = 1)
      or (audience_kind = 'selected_clients'
        and cardinality(target_client_ids) > 0
        and jsonb_array_length(audience_snapshot) = cardinality(target_client_ids))
    )
  ),
  constraint reassurance_calendar_event_versions_status_check check (
    status in ('scheduled', 'cancelled')
    and (status = 'cancelled') = (cancellation_reason is not null)
    and (record_kind = 'cancellation') = (status = 'cancelled')
    and (cancellation_reason is null or (
      char_length(cancellation_reason) between 2 and 500
      and translate(cancellation_reason, E'\n\r\t', '') !~ '[[:cntrl:]]'
    ))
  ),
  constraint reassurance_calendar_event_versions_boundaries_check check (
    publication_state = 'published'
    and signature_status = 'not_configured'
    and notification_status = 'not_configured'
    and notification_delivery = 'none_not_sent'
  ),
  constraint reassurance_calendar_event_versions_hash_check check (
    content_hash ~ '^[a-f0-9]{64}$'
  )
);

create table private.reassurance_calendar_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  idempotency_key uuid not null,
  operation_kind text not null,
  request_hash text not null,
  result_event_key uuid not null,
  result_version_id uuid not null,
  result_version integer not null,
  previous_version_id uuid,
  result_status text not null,
  result_category text not null,
  result_audience_count integer not null,
  reauth_challenge_id uuid not null references private.reauth_challenges(id) on delete restrict,
  committed_at timestamptz not null,
  constraint reassurance_calendar_operations_actor_key
    unique (actor_user_id, idempotency_key),
  constraint reassurance_calendar_operations_result_scope_fkey
    foreign key (result_version_id, organization_id, branch_id, result_event_key)
    references public.reassurance_calendar_event_versions (
      id, organization_id, branch_id, event_key
    ) on delete restrict,
  constraint reassurance_calendar_operations_previous_scope_fkey
    foreign key (previous_version_id, organization_id, branch_id, result_event_key)
    references public.reassurance_calendar_event_versions (
      id, organization_id, branch_id, event_key
    ) on delete restrict,
  constraint reassurance_calendar_operations_check check (
    operation_kind in ('create', 'revise', 'cancel')
    and request_hash ~ '^[a-f0-9]{64}$'
    and result_version > 0
    and result_status in ('scheduled', 'cancelled')
    and result_category in ('care', 'activity', 'transport', 'appointment', 'reminder')
    and result_audience_count between 1 and 200
  )
);

create index reassurance_calendar_versions_scope_time_idx
  on public.reassurance_calendar_event_versions (
    organization_id, branch_id, starts_at, event_key, version desc
  );
create index reassurance_calendar_versions_branch_idx
  on public.reassurance_calendar_event_versions (branch_id, organization_id);
create index reassurance_calendar_versions_previous_idx
  on public.reassurance_calendar_event_versions (previous_version_id)
  where previous_version_id is not null;
create index reassurance_calendar_versions_responsible_idx
  on public.reassurance_calendar_event_versions (responsible_user_id, starts_at);
create index reassurance_calendar_versions_publisher_idx
  on public.reassurance_calendar_event_versions (published_by, published_at desc);
create index reassurance_calendar_versions_reauth_idx
  on public.reassurance_calendar_event_versions (reauth_challenge_id);
create index reassurance_calendar_versions_targets_idx
  on public.reassurance_calendar_event_versions using gin (target_client_ids);
create index reassurance_calendar_operations_scope_idx
  on private.reassurance_calendar_operations (
    organization_id, branch_id, result_event_key, committed_at desc
  );
create index reassurance_calendar_operations_result_idx
  on private.reassurance_calendar_operations (result_version_id);
create index reassurance_calendar_operations_previous_idx
  on private.reassurance_calendar_operations (previous_version_id)
  where previous_version_id is not null;
create index reassurance_calendar_operations_reauth_idx
  on private.reassurance_calendar_operations (reauth_challenge_id);

alter table public.reassurance_calendar_event_versions enable row level security;
alter table public.reassurance_calendar_event_versions force row level security;
alter table private.reassurance_calendar_operations enable row level security;
alter table private.reassurance_calendar_operations force row level security;
revoke all on table public.reassurance_calendar_event_versions
  from public, anon, authenticated, service_role;
revoke all on table private.reassurance_calendar_operations
  from public, anon, authenticated, service_role;

create or replace function private.prevent_reassurance_calendar_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception using errcode = '55000',
    message = format('%I is append-only', tg_table_name);
end;
$$;

create trigger reassurance_calendar_event_versions_prevent_mutation
before update or delete on public.reassurance_calendar_event_versions
for each row execute function private.prevent_reassurance_calendar_mutation();
create trigger reassurance_calendar_operations_prevent_mutation
before update or delete on private.reassurance_calendar_operations
for each row execute function private.prevent_reassurance_calendar_mutation();
create trigger reassurance_calendar_event_versions_audit_row_change
after insert on public.reassurance_calendar_event_versions
for each row execute function private.audit_row_change();

create or replace function private.reassurance_calendar_authority(
  p_organization_id uuid,
  p_branch_id uuid,
  p_permission text,
  p_require_recent_aal2 boolean default false
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and exists (
      select 1 from public.profiles profile
      where profile.id = auth.uid()
        and profile.kind in ('staff', 'professional', 'driver')
        and profile.is_active
    )
    and exists (
      select 1 from public.branches branch
      where branch.id = p_branch_id
        and branch.organization_id = p_organization_id
        and branch.is_active
    )
    and private.has_permission(p_organization_id, p_branch_id, p_permission)
    and (not p_require_recent_aal2 or (
      coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
      and private.has_recent_aal2(15)
    ));
$$;

create or replace function private.reassurance_calendar_staff_is_current(
  p_organization_id uuid,
  p_branch_id uuid,
  p_user_id uuid,
  p_reference_time timestamptz
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
      and profile.kind in ('staff', 'professional', 'driver')
      and profile.is_active
      and membership.organization_id = p_organization_id
      and membership.status = 'active'
      and membership.starts_at <= p_reference_time
      and (membership.ends_at is null or membership.ends_at > p_reference_time)
      and (membership.branch_id is null or membership.branch_id = p_branch_id)
  );
$$;

create or replace function private.reassurance_calendar_clients_are_current(
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

create or replace function private.reassurance_calendar_audience_snapshot(
  p_organization_id uuid,
  p_branch_id uuid,
  p_audience_kind text,
  p_client_ids uuid[]
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_branch_name text; v_result jsonb;
begin
  if p_audience_kind = 'all_branch_clients' then
    select branch.name into v_branch_name from public.branches branch
    where branch.id = p_branch_id and branch.organization_id = p_organization_id;
    return jsonb_build_array(jsonb_build_object(
      'target_kind', 'branch', 'target_id', p_branch_id,
      'display_name', coalesce(v_branch_name, '目前分支') || '／全部服務對象'
    ));
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'target_kind', 'client', 'target_id', client.id,
    'display_name', client.display_name, 'client_code', client.client_code
  ) order by client.id), '[]'::jsonb) into v_result
  from unnest(p_client_ids) selected(client_id)
  join public.clients client on client.id = selected.client_id
    and client.organization_id = p_organization_id
    and client.branch_id = p_branch_id;
  return v_result;
end;
$$;

create or replace function private.require_reassurance_calendar_reauth(
  p_actor uuid,
  p_reference_time timestamptz
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare v_session_id uuid; v_challenge_id uuid;
begin
  if p_actor is null or coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception using errcode = '42501',
      message = 'current same-session reassurance calendar AAL2 evidence is required';
  end if;
  begin
    v_session_id := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode = '42501',
      message = 'current same-session reassurance calendar AAL2 evidence is required';
  end;
  select challenge.id into v_challenge_id
  from private.reauth_events event
  join private.reauth_challenges challenge
    on challenge.id = event.challenge_id
   and challenge.user_id = event.user_id
   and challenge.session_id = event.session_id
  where event.user_id = p_actor and event.session_id = v_session_id
    and event.aal = 'aal2' and event.revoked_at is null
    and event.verification_method in ('totp', 'webauthn', 'phone')
    and challenge.consumed_at is not null and challenge.invalidated_at is null
    and challenge.factor_method = event.verification_method
    and challenge.factor_verified_at = event.verified_at
    and challenge.factor_verified_at >= p_reference_time - interval '15 minutes'
    and challenge.factor_verified_at <= p_reference_time + interval '1 minute'
  order by challenge.factor_verified_at desc, challenge.id desc limit 1
  for share of event, challenge;
  if v_challenge_id is null then
    raise exception using errcode = '42501',
      message = 'current same-session reassurance calendar AAL2 evidence is required';
  end if;
  return v_challenge_id;
end;
$$;

create or replace function private.mutate_reassurance_calendar_event_guarded(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_action text,
  p_event_key uuid,
  p_previous_version_id uuid,
  p_expected_version integer,
  p_category text,
  p_title text,
  p_summary text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_location text,
  p_audience_kind text,
  p_target_client_ids uuid[],
  p_responsible_user_id uuid,
  p_reason text,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid, operation_kind text, event_key uuid,
  version_id uuid, event_version integer, previous_version_id uuid,
  record_kind text, event_status text, event_category text,
  audience_count integer, publication_state text, signature_status text,
  notification_status text, notification_delivery text,
  committed_at timestamptz, replayed boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid(); v_now timestamptz := clock_timestamp();
  v_permission text; v_category text := nullif(btrim(p_category), '');
  v_title text := nullif(btrim(p_title), '');
  v_summary text := nullif(btrim(p_summary), '');
  v_location text := nullif(btrim(p_location), '');
  v_reason text := nullif(btrim(p_reason), '');
  v_clients uuid[] := coalesce(p_target_client_ids, '{}'::uuid[]);
  v_previous public.reassurance_calendar_event_versions%rowtype;
  v_result public.reassurance_calendar_event_versions%rowtype;
  v_operation private.reassurance_calendar_operations%rowtype;
  v_operation_id uuid := gen_random_uuid(); v_version_id uuid := gen_random_uuid();
  v_key uuid; v_version integer; v_record_kind text; v_status text;
  v_audience_count integer; v_audience jsonb; v_actor_name text;
  v_responsible_name text; v_reauth uuid; v_request_hash text; v_content_hash text;
begin
  if p_action not in ('create', 'revise', 'cancel')
     or p_expected_organization_id is null or p_expected_branch_id is null
     or p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'reassurance calendar input is invalid';
  end if;
  v_permission := case when p_action = 'cancel'
    then 'reassurance_calendar.cancel' else 'reassurance_calendar.manage' end;
  if not private.reassurance_calendar_authority(
    p_expected_organization_id, p_expected_branch_id, v_permission, true
  ) then
    raise exception using errcode = '42501', message = 'reassurance calendar mutation is not permitted';
  end if;

  if p_action = 'create' then
    if p_event_key is not null or p_previous_version_id is not null
       or coalesce(p_expected_version, 0) <> 0 or v_reason is not null then
      raise exception using errcode = '22023', message = 'reassurance calendar create lineage is invalid';
    end if;
    v_key := gen_random_uuid(); v_version := 1;
    v_record_kind := 'original'; v_status := 'scheduled';
  else
    if p_event_key is null or p_previous_version_id is null
       or coalesce(p_expected_version, 0) < 1 or v_reason is null
       or char_length(v_reason) not between 2 and 500
       or translate(v_reason, E'\n\r\t', '') ~ '[[:cntrl:]]' then
      raise exception using errcode = '22023', message = 'reassurance calendar version lineage is invalid';
    end if;
    v_key := p_event_key; v_version := p_expected_version + 1;
    v_record_kind := case when p_action = 'cancel' then 'cancellation' else 'revision' end;
    v_status := case when p_action = 'cancel' then 'cancelled' else 'scheduled' end;
  end if;

  if p_action in ('create', 'revise') and (
       v_category not in ('care', 'activity', 'transport', 'appointment', 'reminder')
       or v_title is null or char_length(v_title) > 200 or v_title ~ '[[:cntrl:]]'
       or v_summary is null or char_length(v_summary) > 2000
       or translate(v_summary, E'\n\r\t', '') ~ '[[:cntrl:]]'
       or v_location is null or char_length(v_location) > 200 or v_location ~ '[[:cntrl:]]'
       or p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at
       or extract(year from p_starts_at at time zone 'Asia/Taipei') not between 2000 and 2200
       or extract(year from p_ends_at at time zone 'Asia/Taipei') not between 2000 and 2200
       or p_responsible_user_id is null
       or p_audience_kind not in ('all_branch_clients', 'selected_clients')
       or cardinality(v_clients) > 200
       or v_clients is distinct from coalesce((select array_agg(distinct value order by value)
          from unnest(v_clients) value), '{}'::uuid[])
       or (p_audience_kind = 'all_branch_clients' and cardinality(v_clients) <> 0)
       or (p_audience_kind = 'selected_clients' and cardinality(v_clients) = 0)
     ) then
    raise exception using errcode = '22023', message = 'reassurance calendar event fields are invalid';
  end if;

  v_request_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version', 1, 'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id, 'actor', v_actor, 'action', p_action,
    'event_key', p_event_key, 'previous_version_id', p_previous_version_id,
    'expected_version', p_expected_version, 'category', v_category,
    'title', v_title, 'summary', v_summary, 'starts_at', p_starts_at,
    'ends_at', p_ends_at, 'location', v_location,
    'audience_kind', p_audience_kind, 'target_client_ids', v_clients,
    'responsible_user_id', p_responsible_user_id, 'reason', v_reason
  )::text, 'UTF8')), 'hex');

  perform pg_advisory_xact_lock(hashtextextended(
    'reassurance-calendar-operation:' || v_actor::text || ':' || p_idempotency_key::text, 44
  ));
  select operation.* into v_operation from private.reassurance_calendar_operations operation
  where operation.actor_user_id = v_actor and operation.idempotency_key = p_idempotency_key;
  if found then
    if v_operation.organization_id <> p_expected_organization_id
       or v_operation.branch_id <> p_expected_branch_id
       or v_operation.operation_kind <> p_action
       or v_operation.request_hash <> v_request_hash
       or (p_event_key is not null and v_operation.result_event_key <> p_event_key) then
      raise exception using errcode = '23505', message = 'reassurance calendar idempotency conflict';
    end if;
    if not private.reassurance_calendar_authority(
      p_expected_organization_id, p_expected_branch_id, v_permission, true
    ) or private.require_reassurance_calendar_reauth(v_actor, clock_timestamp()) is null then
      raise exception using errcode = '42501', message = 'reassurance calendar replay authority expired';
    end if;
    return query select v_operation.id, v_operation.operation_kind,
      v_operation.result_event_key, v_operation.result_version_id,
      v_operation.result_version, v_operation.previous_version_id,
      case when v_operation.operation_kind = 'create' then 'original'
        when v_operation.operation_kind = 'revise' then 'revision' else 'cancellation' end,
      v_operation.result_status, v_operation.result_category,
      v_operation.result_audience_count, 'published'::text, 'not_configured'::text,
      'not_configured'::text, 'none_not_sent'::text,
      v_operation.committed_at, true;
    return;
  end if;

  v_reauth := private.require_reassurance_calendar_reauth(v_actor, v_now);
  select btrim(profile.display_name) into v_actor_name
  from public.profiles profile where profile.id = v_actor and profile.is_active;
  if v_actor_name is null then
    raise exception using errcode = '42501', message = 'reassurance calendar actor is not current';
  end if;

  if p_action <> 'create' then
    perform pg_advisory_xact_lock(hashtextextended(
      'reassurance-calendar-chain:' || p_expected_organization_id::text || ':' ||
      p_expected_branch_id::text || ':' || p_event_key::text, 44
    ));
    select version_row.* into v_previous
    from public.reassurance_calendar_event_versions version_row
    where version_row.id = p_previous_version_id
      and version_row.organization_id = p_expected_organization_id
      and version_row.branch_id = p_expected_branch_id
      and version_row.event_key = p_event_key
      and version_row.version = p_expected_version
      and version_row.status = 'scheduled'
      and not exists (select 1 from public.reassurance_calendar_event_versions child
        where child.previous_version_id = version_row.id)
    for share;
    if not found then
      raise exception using errcode = '40001', message = 'reassurance calendar base version is stale';
    end if;
    if p_action = 'cancel' then
      v_category := v_previous.category; v_title := v_previous.title;
      v_summary := v_previous.summary; p_starts_at := v_previous.starts_at;
      p_ends_at := v_previous.ends_at; v_location := v_previous.location;
      p_audience_kind := v_previous.audience_kind;
      v_clients := v_previous.target_client_ids;
      p_responsible_user_id := v_previous.responsible_user_id;
    end if;
  end if;

  if not private.reassurance_calendar_staff_is_current(
       p_expected_organization_id, p_expected_branch_id, p_responsible_user_id, v_now
     ) or not private.reassurance_calendar_clients_are_current(
       p_expected_organization_id, p_expected_branch_id, v_clients,
       (p_starts_at at time zone 'Asia/Taipei')::date
     ) then
    raise exception using errcode = '42501', message = 'reassurance calendar entities are outside current scope';
  end if;
  select btrim(profile.display_name) into v_responsible_name
  from public.profiles profile where profile.id = p_responsible_user_id;
  v_audience := private.reassurance_calendar_audience_snapshot(
    p_expected_organization_id, p_expected_branch_id, p_audience_kind, v_clients
  );
  v_audience_count := case when p_audience_kind = 'all_branch_clients' then 1
    else cardinality(v_clients) end;
  if jsonb_array_length(v_audience) <> v_audience_count then
    raise exception using errcode = '40001', message = 'reassurance calendar audience snapshot changed';
  end if;

  v_content_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version', 1, 'event_key', v_key, 'version', v_version,
    'previous_version_id', p_previous_version_id, 'record_kind', v_record_kind,
    'category', v_category, 'title', v_title, 'summary', v_summary,
    'starts_at', p_starts_at, 'ends_at', p_ends_at, 'location', v_location,
    'audience_kind', p_audience_kind, 'audience_snapshot', v_audience,
    'responsible_user_id', p_responsible_user_id, 'status', v_status,
    'reason', v_reason, 'published_by', v_actor, 'published_at', v_now,
    'signature_status', 'not_configured', 'notification_status', 'not_configured',
    'notification_delivery', 'none_not_sent'
  )::text, 'UTF8')), 'hex');

  insert into public.reassurance_calendar_event_versions (
    id, organization_id, branch_id, event_key, version, previous_version_id,
    record_kind, revision_reason, category, title, summary, starts_at, ends_at,
    location, audience_kind, target_client_ids, audience_snapshot,
    responsible_user_id, responsible_display_name, status, cancellation_reason,
    publication_state, published_by, publisher_display_name, published_at,
    signature_status, notification_status, notification_delivery,
    reauth_challenge_id, content_hash
  ) values (
    v_version_id, p_expected_organization_id, p_expected_branch_id, v_key,
    v_version, p_previous_version_id, v_record_kind, v_reason, v_category,
    v_title, v_summary, p_starts_at, p_ends_at, v_location, p_audience_kind,
    v_clients, v_audience, p_responsible_user_id, v_responsible_name, v_status,
    case when p_action = 'cancel' then v_reason else null end,
    'published', v_actor, v_actor_name, v_now, 'not_configured',
    'not_configured', 'none_not_sent', v_reauth, v_content_hash
  ) returning * into v_result;

  insert into private.reassurance_calendar_operations (
    id, organization_id, branch_id, actor_user_id, idempotency_key,
    operation_kind, request_hash, result_event_key, result_version_id,
    result_version, previous_version_id, result_status, result_category,
    result_audience_count, reauth_challenge_id, committed_at
  ) values (
    v_operation_id, p_expected_organization_id, p_expected_branch_id, v_actor,
    p_idempotency_key, p_action, v_request_hash, v_key, v_version_id, v_version,
    p_previous_version_id, v_status, v_category, v_audience_count, v_reauth, v_now
  );

  if not private.reassurance_calendar_authority(
    p_expected_organization_id, p_expected_branch_id, v_permission, true
  ) then
    raise exception using errcode = '42501', message = 'reassurance calendar authority expired';
  end if;
  return query select v_operation_id, p_action, v_key, v_version_id, v_version,
    p_previous_version_id, v_record_kind, v_status, v_category,
    v_audience_count, 'published'::text, 'not_configured'::text,
    'not_configured'::text, 'none_not_sent'::text, v_now, false;
end;
$$;

create or replace function public.mutate_reassurance_calendar_event(
  p_expected_organization_id uuid, p_expected_branch_id uuid, p_action text,
  p_event_key uuid, p_previous_version_id uuid, p_expected_version integer,
  p_category text, p_title text, p_summary text, p_starts_at timestamptz,
  p_ends_at timestamptz, p_location text, p_audience_kind text,
  p_target_client_ids uuid[], p_responsible_user_id uuid, p_reason text,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid, operation_kind text, event_key uuid,
  version_id uuid, event_version integer, previous_version_id uuid,
  record_kind text, event_status text, event_category text,
  audience_count integer, publication_state text, signature_status text,
  notification_status text, notification_delivery text,
  committed_at timestamptz, replayed boolean
)
language sql volatile security invoker set search_path = ''
as $$
  select * from private.mutate_reassurance_calendar_event_guarded(
    p_expected_organization_id, p_expected_branch_id, p_action, p_event_key,
    p_previous_version_id, p_expected_version, p_category, p_title, p_summary,
    p_starts_at, p_ends_at, p_location, p_audience_kind,
    p_target_client_ids, p_responsible_user_id, p_reason, p_idempotency_key
  );
$$;

create or replace function private.reassurance_calendar_snapshot_response(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_month date,
  p_organization_filter uuid,
  p_category text,
  p_status text,
  p_today boolean,
  p_query text
)
returns table(
  organization_id uuid, organization_name text, branch_id uuid, branch_name text,
  generated_at timestamptz, snapshot_token text, month_start date,
  items jsonb, matching_total bigint, scheduled_total bigint,
  cancelled_total bigint, today_total bigint, upcoming_total bigint,
  items_truncated boolean, category_options jsonb, staff_options jsonb,
  client_options jsonb, can_manage boolean, can_cancel boolean,
  publication_boundary text, signature_status text,
  notification_status text, notification_delivery text
)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_actor uuid := auth.uid(); v_now timestamptz := clock_timestamp();
  v_month date := date_trunc('month', p_month)::date;
  v_next_month date := (v_month + interval '1 month')::date;
  v_today date := (v_now at time zone 'Asia/Taipei')::date;
  v_category text := nullif(btrim(p_category), '');
  v_query text := nullif(btrim(p_query), '');
  v_organization_name text; v_branch_name text; v_items jsonb;
  v_matching bigint; v_scheduled bigint; v_cancelled bigint;
  v_today_total bigint; v_upcoming bigint; v_categories jsonb;
  v_staff jsonb; v_clients jsonb;
begin
  if p_expected_organization_id is null or p_expected_branch_id is null
     or p_month is null or p_month <> v_month
     or p_organization_filter is distinct from p_expected_organization_id
     or p_status not in ('all', 'scheduled', 'cancelled')
     or p_today is null
     or (v_category is not null and v_category not in (
       'care', 'activity', 'transport', 'appointment', 'reminder'))
     or (v_query is not null and (char_length(v_query) > 120 or v_query ~ '[[:cntrl:]]'))
     or not private.reassurance_calendar_authority(
       p_expected_organization_id, p_expected_branch_id,
       'reassurance_calendar.read', false
     ) then
    raise exception using errcode = '42501', message = 'reassurance calendar snapshot is not permitted';
  end if;

  with current_versions as materialized (
    select distinct on (version_row.event_key) version_row.*
    from public.reassurance_calendar_event_versions version_row
    where version_row.organization_id = p_expected_organization_id
      and version_row.branch_id = p_expected_branch_id
    order by version_row.event_key, version_row.version desc, version_row.id desc
  ), filtered as materialized (
    select current.* from current_versions current
    where current.starts_at < v_next_month::timestamp at time zone 'Asia/Taipei'
      and current.ends_at >= v_month::timestamp at time zone 'Asia/Taipei'
      and (v_category is null or current.category = v_category)
      and (p_status = 'all' or current.status = p_status)
      and (not p_today or (
        current.starts_at < (v_today + 1)::timestamp at time zone 'Asia/Taipei'
        and current.ends_at >= v_today::timestamp at time zone 'Asia/Taipei'
      ))
      and (v_query is null or lower(
        current.title || E'\n' || current.summary || E'\n' || current.location
      ) like '%' || lower(v_query) || '%')
      and (current.audience_kind = 'all_branch_clients' or not exists (
        select 1 from unnest(current.target_client_ids) client_id
        where not private.can_staff_access_client(client_id, 'clients.read')
      ))
  ), selected as materialized (
    select * from filtered order by starts_at, event_key limit 200
  ), bundled as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'version_id', selected.id, 'event_key', selected.event_key,
      'version', selected.version, 'previous_version_id', selected.previous_version_id,
      'record_kind', selected.record_kind, 'revision_reason', selected.revision_reason,
      'category', selected.category, 'title', selected.title, 'summary', selected.summary,
      'starts_at', selected.starts_at, 'ends_at', selected.ends_at,
      'location', selected.location, 'audience_kind', selected.audience_kind,
      'audience', selected.audience_snapshot,
      'responsible_user_id', selected.responsible_user_id,
      'responsible_display_name', selected.responsible_display_name,
      'status', selected.status, 'cancellation_reason', selected.cancellation_reason,
      'publication_state', selected.publication_state,
      'publisher_display_name', selected.publisher_display_name,
      'published_at', selected.published_at,
      'signature_status', selected.signature_status,
      'notification_status', selected.notification_status,
      'notification_delivery', selected.notification_delivery,
      'history', (select coalesce(jsonb_agg(jsonb_build_object(
        'version_id', history.id, 'version', history.version,
        'previous_version_id', history.previous_version_id,
        'record_kind', history.record_kind, 'reason', history.revision_reason,
        'status', history.status, 'published_at', history.published_at,
        'publisher_display_name', history.publisher_display_name,
        'content_hash', history.content_hash
      ) order by history.version desc), '[]'::jsonb)
      from public.reassurance_calendar_event_versions history
      where history.organization_id = p_expected_organization_id
        and history.branch_id = p_expected_branch_id
        and history.event_key = selected.event_key)
    ) order by selected.starts_at, selected.event_key), '[]'::jsonb) value
    from selected
  ), metrics as (
    select count(*)::bigint matching_total,
      count(*) filter (where status = 'scheduled')::bigint scheduled_total,
      count(*) filter (where status = 'cancelled')::bigint cancelled_total,
      count(*) filter (where starts_at < (v_today + 1)::timestamp at time zone 'Asia/Taipei'
        and ends_at >= v_today::timestamp at time zone 'Asia/Taipei')::bigint today_total,
      count(*) filter (where status = 'scheduled' and starts_at >= v_now)::bigint upcoming_total
    from filtered
  ), categories as (
    select coalesce(jsonb_agg(category order by category collate "C"), '[]'::jsonb) value
    from (select distinct category from current_versions) option
  ), staff as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'user_id', option.id, 'display_name', option.display_name
    ) order by option.display_name collate "C", option.id), '[]'::jsonb) value
    from (select distinct on (profile.id) profile.id, profile.display_name
      from public.profiles profile join public.memberships membership
        on membership.profile_id = profile.id
      where profile.kind in ('staff', 'professional', 'driver') and profile.is_active
        and membership.organization_id = p_expected_organization_id
        and membership.status = 'active' and membership.starts_at <= v_now
        and (membership.ends_at is null or membership.ends_at > v_now)
        and (membership.branch_id is null or membership.branch_id = p_expected_branch_id)
      order by profile.id, membership.branch_id nulls last limit 200) option
  ), clients as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'client_id', option.id, 'display_name', option.display_name,
      'client_code', option.client_code
    ) order by option.display_name collate "C", option.id), '[]'::jsonb) value
    from (select client.id, client.display_name, client.client_code
      from public.clients client
      where client.organization_id = p_expected_organization_id
        and client.branch_id = p_expected_branch_id and client.status = 'active'
        and private.can_staff_access_client(client.id, 'clients.read')
      order by client.display_name collate "C", client.id limit 200) option
  )
  select organization.name, branch.name, bundled.value,
    metrics.matching_total, metrics.scheduled_total, metrics.cancelled_total,
    metrics.today_total, metrics.upcoming_total,
    categories.value, staff.value, clients.value
  into v_organization_name, v_branch_name, v_items,
    v_matching, v_scheduled, v_cancelled, v_today_total, v_upcoming,
    v_categories, v_staff, v_clients
  from public.organizations organization join public.branches branch
    on branch.id = p_expected_branch_id and branch.organization_id = organization.id
  cross join bundled cross join metrics cross join categories cross join staff cross join clients
  where organization.id = p_expected_organization_id;

  if v_organization_name is null or v_branch_name is null then
    raise exception using errcode = '42501', message = 'reassurance calendar scope is unavailable';
  end if;
  insert into public.audit_events (
    organization_id, branch_id, actor_user_id, action, table_name, row_pk,
    changed_fields, metadata
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_actor, 'select',
    'reassurance_calendar_snapshot', null, '{}'::text[], jsonb_build_object(
      'workflow', 'page44_reassurance_calendar_v1', 'month', v_month,
      'category_filter_present', v_category is not null, 'status_filter', p_status,
      'today_filter', p_today, 'query_present', v_query is not null,
      'matching_total', v_matching
    )
  );
  if not private.reassurance_calendar_authority(
    p_expected_organization_id, p_expected_branch_id,
    'reassurance_calendar.read', false
  ) then
    raise exception using errcode = '42501', message = 'reassurance calendar authority expired';
  end if;
  return query select p_expected_organization_id, v_organization_name,
    p_expected_branch_id, v_branch_name,
    v_now, encode(sha256(convert_to(jsonb_build_object(
      'organization_id', p_expected_organization_id, 'branch_id', p_expected_branch_id,
      'month', v_month, 'items', v_items
    )::text, 'UTF8')), 'hex'), v_month, v_items,
    v_matching, v_scheduled, v_cancelled, v_today_total, v_upcoming,
    v_matching > jsonb_array_length(v_items),
    v_categories, v_staff, v_clients,
    private.reassurance_calendar_authority(
      p_expected_organization_id, p_expected_branch_id,
      'reassurance_calendar.manage', true),
    private.reassurance_calendar_authority(
      p_expected_organization_id, p_expected_branch_id,
      'reassurance_calendar.cancel', true),
    'published_versions_only'::text, 'not_configured'::text,
    'not_configured'::text, 'none_not_sent'::text;
end;
$$;

create or replace function public.reassurance_calendar_snapshot(
  p_expected_organization_id uuid, p_expected_branch_id uuid,
  p_month date, p_organization_filter uuid, p_category text default null,
  p_status text default 'all', p_today boolean default false,
  p_query text default null
)
returns table(
  organization_id uuid, organization_name text, branch_id uuid, branch_name text,
  generated_at timestamptz, snapshot_token text, month_start date,
  items jsonb, matching_total bigint, scheduled_total bigint,
  cancelled_total bigint, today_total bigint, upcoming_total bigint,
  items_truncated boolean, category_options jsonb, staff_options jsonb,
  client_options jsonb, can_manage boolean, can_cancel boolean,
  publication_boundary text, signature_status text,
  notification_status text, notification_delivery text
)
language sql volatile security invoker set search_path = ''
as $$
  select * from private.reassurance_calendar_snapshot_response(
    p_expected_organization_id, p_expected_branch_id, p_month,
    p_organization_filter, p_category, p_status, p_today, p_query
  );
$$;

revoke all on function private.prevent_reassurance_calendar_mutation()
  from public, anon, authenticated, service_role;
revoke all on function private.reassurance_calendar_authority(uuid,uuid,text,boolean)
  from public, anon, authenticated, service_role;
revoke all on function private.reassurance_calendar_staff_is_current(uuid,uuid,uuid,timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.reassurance_calendar_clients_are_current(uuid,uuid,uuid[],date)
  from public, anon, authenticated, service_role;
revoke all on function private.reassurance_calendar_audience_snapshot(uuid,uuid,text,uuid[])
  from public, anon, authenticated, service_role;
revoke all on function private.require_reassurance_calendar_reauth(uuid,timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.mutate_reassurance_calendar_event_guarded(uuid,uuid,text,uuid,uuid,integer,text,text,text,timestamptz,timestamptz,text,text,uuid[],uuid,text,uuid)
  from public, anon, service_role;
revoke all on function private.reassurance_calendar_snapshot_response(uuid,uuid,date,uuid,text,text,boolean,text)
  from public, anon, service_role;
revoke all on function public.mutate_reassurance_calendar_event(uuid,uuid,text,uuid,uuid,integer,text,text,text,timestamptz,timestamptz,text,text,uuid[],uuid,text,uuid)
  from public, anon, service_role;
revoke all on function public.reassurance_calendar_snapshot(uuid,uuid,date,uuid,text,text,boolean,text)
  from public, anon, service_role;
grant execute on function private.mutate_reassurance_calendar_event_guarded(uuid,uuid,text,uuid,uuid,integer,text,text,text,timestamptz,timestamptz,text,text,uuid[],uuid,text,uuid)
  to authenticated;
grant execute on function private.reassurance_calendar_snapshot_response(uuid,uuid,date,uuid,text,text,boolean,text)
  to authenticated;
grant execute on function public.mutate_reassurance_calendar_event(uuid,uuid,text,uuid,uuid,integer,text,text,text,timestamptz,timestamptz,text,text,uuid[],uuid,text,uuid)
  to authenticated;
grant execute on function public.reassurance_calendar_snapshot(uuid,uuid,date,uuid,text,text,boolean,text)
  to authenticated;

comment on table public.reassurance_calendar_event_versions is
  'Page 44 immutable published calendar versions. Cancellation appends a reasoned terminal child; notification and signature providers are not configured.';
comment on function public.reassurance_calendar_snapshot(uuid,uuid,date,uuid,text,text,boolean,text) is
  'Page 44 audited branch snapshot. Month calendar and list must render this same immutable item array and snapshot token.';
