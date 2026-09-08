-- Page 25: assigned-client infection incident reporting, manual cluster links,
-- and an immutable linear follow-up history.
--
-- Infection type and description are institution-entered observations. No
-- clinical taxonomy, diagnosis, cluster threshold, automatic notification, or
-- legal reporting rule is encoded here.

insert into public.permissions (permission_key, description, risk_level)
values
  ('quality_events.read', 'Read assigned-client quality event history', 1),
  ('quality_events.manage', 'Report and append actions to assigned-client quality events', 2),
  ('quality_events.close', 'Close assigned-client quality events with recent AAL2 evidence', 3)
on conflict (permission_key) do nothing;

insert into public.role_permissions (role_id, permission_id)
select role.id, permission.id
from public.roles role
join public.permissions permission
  on permission.permission_key = 'quality_events.read'
where role.is_system
  and role.role_key in (
    'organization_manager', 'branch_supervisor', 'case_manager_social_worker',
    'nurse', 'care_worker', 'professional'
  )
on conflict (role_id, permission_id) do nothing;

insert into public.role_permissions (role_id, permission_id)
select role.id, permission.id
from public.roles role
join public.permissions permission
  on permission.permission_key = 'quality_events.manage'
where role.is_system
  and role.role_key in (
    'organization_manager', 'branch_supervisor', 'case_manager_social_worker',
    'nurse', 'care_worker', 'professional'
  )
on conflict (role_id, permission_id) do nothing;

insert into public.role_permissions (role_id, permission_id)
select role.id, permission.id
from public.roles role
join public.permissions permission
  on permission.permission_key = 'quality_events.close'
where role.is_system
  and role.role_key in (
    'organization_manager', 'branch_supervisor', 'case_manager_social_worker',
    'nurse'
  )
on conflict (role_id, permission_id) do nothing;

create table public.infection_incidents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  client_id uuid not null,
  occurred_at timestamptz not null,
  location text not null,
  event_summary text not null,
  infection_type_state text not null,
  infection_type_text text,
  reported_by uuid not null references auth.users(id) on delete restrict,
  reporter_display_name text not null,
  reported_at timestamptz not null default clock_timestamp(),
  content_hash text not null,
  constraint infection_incidents_client_scope_fkey
    foreign key (client_id, organization_id, branch_id)
    references public.clients(id, organization_id, branch_id) on delete restrict,
  constraint infection_incidents_id_scope_key
    unique (id, organization_id, branch_id, client_id),
  constraint infection_incidents_location_check check (
    char_length(location) between 1 and 240
    and location = btrim(location)
    and location !~ '[[:cntrl:]]'
  ),
  constraint infection_incidents_summary_check check (
    char_length(event_summary) between 1 and 2000
    and event_summary = btrim(event_summary)
    and translate(event_summary, E'\n\r\t', '') !~ '[[:cntrl:]]'
  ),
  constraint infection_incidents_infection_state_check
    check (infection_type_state in ('provided', 'missing', 'not_applicable')),
  constraint infection_incidents_infection_alignment_check check (
    (infection_type_state = 'provided'
      and infection_type_text is not null
      and char_length(infection_type_text) between 1 and 240
      and infection_type_text = btrim(infection_type_text)
      and infection_type_text !~ '[[:cntrl:]]')
    or (infection_type_state <> 'provided' and infection_type_text is null)
  ),
  constraint infection_incidents_reporter_name_check check (
    char_length(reporter_display_name) between 1 and 120
    and reporter_display_name = btrim(reporter_display_name)
    and reporter_display_name !~ '[[:cntrl:]]'
  ),
  constraint infection_incidents_time_check check (occurred_at <= reported_at),
  constraint infection_incidents_content_hash_check
    check (content_hash ~ '^[a-f0-9]{64}$')
);

comment on table public.infection_incidents is
  'Immutable page-25 infection incident reports. Type and description are institution-entered text, not diagnoses.';
comment on column public.infection_incidents.infection_type_state is
  'Explicitly distinguishes provided, missing and not applicable. No value is inferred.';

create index infection_incidents_scope_occurred_idx
  on public.infection_incidents (
    organization_id, branch_id, occurred_at desc, id desc
  );
create index infection_incidents_client_occurred_idx
  on public.infection_incidents (client_id, occurred_at desc, id desc);
create index infection_incidents_reported_by_idx on public.infection_incidents (reported_by);
create index infection_incidents_infection_filter_idx
  on public.infection_incidents (
    organization_id, branch_id, infection_type_state, infection_type_text
  );

create table public.infection_clusters (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  branch_id uuid not null,
  label text not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  creator_display_name text not null,
  created_at timestamptz not null default clock_timestamp(),
  content_hash text not null,
  constraint infection_clusters_branch_scope_fkey
    foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete restrict,
  constraint infection_clusters_id_scope_key unique (id, organization_id, branch_id),
  constraint infection_clusters_label_check check (
    char_length(label) between 1 and 120
    and label = btrim(label)
    and label !~ '[[:cntrl:]]'
  ),
  constraint infection_clusters_creator_name_check check (
    char_length(creator_display_name) between 1 and 120
    and creator_display_name = btrim(creator_display_name)
    and creator_display_name !~ '[[:cntrl:]]'
  ),
  constraint infection_clusters_content_hash_check check (content_hash ~ '^[a-f0-9]{64}$')
);

comment on table public.infection_clusters is
  'Immutable institution-entered cluster identities. Equal labels are never automatically merged.';

create index infection_clusters_scope_label_idx
  on public.infection_clusters (organization_id, branch_id, label collate "C", id);
create index infection_clusters_created_by_idx on public.infection_clusters (created_by);

create table public.infection_incident_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  client_id uuid not null,
  incident_id uuid not null,
  sequence_number integer not null,
  previous_entry_id uuid,
  entry_type text not null,
  occurred_at timestamptz not null,
  entry_text text,
  cluster_id uuid,
  cluster_label text,
  closure_outcome text,
  closure_reason text,
  committed_by uuid not null references auth.users(id) on delete restrict,
  committer_display_name text not null,
  committed_at timestamptz not null default clock_timestamp(),
  closure_reauth_challenge_id uuid
    references private.reauth_challenges(id) on delete restrict,
  content_hash text not null,
  constraint infection_incident_entries_incident_scope_fkey
    foreign key (incident_id, organization_id, branch_id, client_id)
    references public.infection_incidents(id, organization_id, branch_id, client_id)
    on delete restrict,
  constraint infection_incident_entries_id_scope_key
    unique (id, organization_id, branch_id, client_id, incident_id),
  constraint infection_incident_entries_cluster_scope_fkey
    foreign key (cluster_id, organization_id, branch_id)
    references public.infection_clusters(id, organization_id, branch_id)
    on delete restrict,
  constraint infection_incident_entries_previous_scope_fkey
    foreign key (
      previous_entry_id, organization_id, branch_id, client_id, incident_id
    ) references public.infection_incident_entries(
      id, organization_id, branch_id, client_id, incident_id
    ) on delete restrict,
  constraint infection_incident_entries_sequence_key
    unique (incident_id, sequence_number),
  constraint infection_incident_entries_successor_key
    unique nulls not distinct (incident_id, previous_entry_id),
  constraint infection_incident_entries_sequence_check
    check (sequence_number > 0),
  constraint infection_incident_entries_type_check
    check (entry_type in ('treatment', 'follow_up', 'cluster_link', 'cluster_unlink', 'closure')),
  constraint infection_incident_entries_content_alignment_check check (
    (
      entry_type in ('treatment', 'follow_up')
      and entry_text is not null
      and char_length(entry_text) between 1 and 2000
      and entry_text = btrim(entry_text)
      and translate(entry_text, E'\n\r\t', '') !~ '[[:cntrl:]]'
      and closure_outcome is null
      and closure_reason is null
      and cluster_id is null
      and cluster_label is null
      and closure_reauth_challenge_id is null
    )
    or (
      entry_type in ('cluster_link', 'cluster_unlink')
      and entry_text is null
      and closure_outcome is null
      and closure_reason is null
      and cluster_id is not null
      and cluster_label is not null
      and char_length(cluster_label) between 1 and 120
      and cluster_label = btrim(cluster_label)
      and cluster_label !~ '[[:cntrl:]]'
      and closure_reauth_challenge_id is null
    )
    or (
      entry_type = 'closure'
      and entry_text is null
      and closure_outcome is not null
      and char_length(closure_outcome) between 1 and 2000
      and closure_outcome = btrim(closure_outcome)
      and translate(closure_outcome, E'\n\r\t', '') !~ '[[:cntrl:]]'
      and closure_reason is not null
      and char_length(closure_reason) between 1 and 1000
      and closure_reason = btrim(closure_reason)
      and translate(closure_reason, E'\n\r\t', '') !~ '[[:cntrl:]]'
      and cluster_id is null
      and cluster_label is null
      and closure_reauth_challenge_id is not null
    )
  ),
  constraint infection_incident_entries_committer_name_check check (
    char_length(committer_display_name) between 1 and 120
    and committer_display_name = btrim(committer_display_name)
    and committer_display_name !~ '[[:cntrl:]]'
  ),
  constraint infection_incident_entries_time_check
    check (occurred_at <= committed_at),
  constraint infection_incident_entries_content_hash_check
    check (content_hash ~ '^[a-f0-9]{64}$')
);

comment on table public.infection_incident_entries is
  'Immutable linear incident timeline containing treatment, follow-up, explicit cluster link/unlink, and closure entries.';

create index infection_incident_entries_scope_incident_idx
  on public.infection_incident_entries (
    organization_id, branch_id, incident_id, sequence_number
  );
create index infection_incident_entries_client_idx
  on public.infection_incident_entries (client_id, occurred_at desc);
create index infection_incident_entries_previous_idx
  on public.infection_incident_entries (previous_entry_id)
  where previous_entry_id is not null;
create index infection_incident_entries_committed_by_idx
  on public.infection_incident_entries (committed_by);
create index infection_incident_entries_cluster_idx
  on public.infection_incident_entries (cluster_id, occurred_at desc)
  where cluster_id is not null;
create index infection_incident_entries_reauth_idx
  on public.infection_incident_entries (closure_reauth_challenge_id)
  where closure_reauth_challenge_id is not null;

create table private.infection_event_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  client_id uuid not null,
  incident_id uuid not null,
  entry_id uuid,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  operation_kind text not null,
  idempotency_key uuid not null,
  request_hash text not null,
  result_chain_version integer not null,
  result_status text not null,
  result_cluster_id uuid,
  result_cluster_label text,
  result_committed_at timestamptz not null,
  reauth_challenge_id uuid
    references private.reauth_challenges(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  constraint infection_event_operations_incident_scope_fkey
    foreign key (incident_id, organization_id, branch_id, client_id)
    references public.infection_incidents(id, organization_id, branch_id, client_id)
    on delete restrict,
  constraint infection_event_operations_entry_scope_fkey
    foreign key (entry_id, organization_id, branch_id, client_id, incident_id)
    references public.infection_incident_entries(
      id, organization_id, branch_id, client_id, incident_id
    ) on delete restrict,
  constraint infection_event_operations_cluster_scope_fkey
    foreign key (result_cluster_id, organization_id, branch_id)
    references public.infection_clusters(id, organization_id, branch_id)
    on delete restrict,
  constraint infection_event_operations_actor_idempotency_key
    unique (actor_user_id, idempotency_key),
  constraint infection_event_operations_kind_check
    check (operation_kind in ('report', 'treatment', 'follow_up', 'cluster_link', 'cluster_unlink', 'close')),
  constraint infection_event_operations_request_hash_check
    check (request_hash ~ '^[a-f0-9]{64}$'),
  constraint infection_event_operations_result_version_check
    check (result_chain_version >= 0),
  constraint infection_event_operations_result_status_check
    check (result_status in ('reported', 'in_progress', 'closed')),
  constraint infection_event_operations_alignment_check check (
    (operation_kind = 'report'
      and entry_id is null
      and result_chain_version = 0
      and result_status = 'reported'
      and result_cluster_id is null
      and result_cluster_label is null
      and reauth_challenge_id is null)
    or (operation_kind in ('treatment', 'follow_up', 'cluster_link', 'cluster_unlink')
      and entry_id is not null
      and result_chain_version > 0
      and result_status = 'in_progress'
      and ((operation_kind in ('cluster_link', 'cluster_unlink')
          and result_cluster_id is not null and result_cluster_label is not null)
        or (operation_kind in ('treatment', 'follow_up')
          and result_cluster_id is null and result_cluster_label is null))
      and reauth_challenge_id is null)
    or (operation_kind = 'close'
      and entry_id is not null
      and result_chain_version > 0
      and result_status = 'closed'
      and result_cluster_id is null
      and result_cluster_label is null
      and reauth_challenge_id is not null)
  )
);

comment on table private.infection_event_operations is
  'Append-only actor-scoped exact-replay receipts for page-25 writes.';

create index infection_event_operations_scope_incident_idx
  on private.infection_event_operations (
    organization_id, branch_id, incident_id, created_at desc
  );
create index infection_event_operations_client_idx
  on private.infection_event_operations (client_id, created_at desc);
create index infection_event_operations_entry_idx
  on private.infection_event_operations (entry_id) where entry_id is not null;
create index infection_event_operations_reauth_idx
  on private.infection_event_operations (reauth_challenge_id)
  where reauth_challenge_id is not null;
create index infection_event_operations_cluster_idx
  on private.infection_event_operations (result_cluster_id)
  where result_cluster_id is not null;

alter table public.infection_incidents enable row level security;
alter table public.infection_incidents force row level security;
alter table public.infection_clusters enable row level security;
alter table public.infection_clusters force row level security;
alter table public.infection_incident_entries enable row level security;
alter table public.infection_incident_entries force row level security;
alter table private.infection_event_operations enable row level security;
alter table private.infection_event_operations force row level security;

revoke all on table public.infection_incidents from public, anon, authenticated, service_role;
revoke all on table public.infection_clusters from public, anon, authenticated, service_role;
revoke all on table public.infection_incident_entries from public, anon, authenticated, service_role;
revoke all on table private.infection_event_operations from public, anon, authenticated, service_role;

create policy infection_incidents_staff_select
on public.infection_incidents for select
to authenticated
using (
  (select private.can_staff_access_client(client_id, 'clients.read'))
  and (select private.can_staff_access_client(client_id, 'quality_events.read'))
);

create policy infection_clusters_staff_select
on public.infection_clusters for select
to authenticated
using (
  (select private.has_permission(organization_id, branch_id, 'clients.read'))
  and (select private.has_permission(organization_id, branch_id, 'quality_events.read'))
);

create policy infection_incident_entries_staff_select
on public.infection_incident_entries for select
to authenticated
using (
  (select private.can_staff_access_client(client_id, 'clients.read'))
  and (select private.can_staff_access_client(client_id, 'quality_events.read'))
);

create or replace function private.prevent_infection_history_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception using
    errcode = '55000',
    message = 'infection incident history and operation receipts are immutable';
end;
$$;

create trigger infection_incidents_immutable
before update or delete on public.infection_incidents
for each row execute function private.prevent_infection_history_mutation();
create trigger infection_clusters_immutable
before update or delete on public.infection_clusters
for each row execute function private.prevent_infection_history_mutation();
create trigger infection_incident_entries_immutable
before update or delete on public.infection_incident_entries
for each row execute function private.prevent_infection_history_mutation();
create trigger infection_event_operations_immutable
before update or delete on private.infection_event_operations
for each row execute function private.prevent_infection_history_mutation();

create trigger infection_incidents_audit_row_change
after insert or update or delete on public.infection_incidents
for each row execute function private.audit_row_change();
create trigger infection_clusters_audit_row_change
after insert or update or delete on public.infection_clusters
for each row execute function private.audit_row_change();
create trigger infection_incident_entries_audit_row_change
after insert or update or delete on public.infection_incident_entries
for each row execute function private.audit_row_change();
create trigger infection_event_operations_audit_row_change
after insert or update or delete on private.infection_event_operations
for each row execute function private.audit_row_change();

create or replace function private.require_infection_closure_reauth(
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
  if p_actor is null
     or p_actor <> auth.uid()
     or coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not (select private.has_recent_aal2(15)) then
    raise exception using
      errcode = '42501',
      message = 'current same-session recent AAL2 evidence is required to close an infection incident';
  end if;

  begin
    v_session_id := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception using
      errcode = '42501',
      message = 'current same-session recent AAL2 evidence is required to close an infection incident';
  end;

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
    raise exception using
      errcode = '42501',
      message = 'current same-session recent AAL2 evidence is required to close an infection incident';
  end if;
  return v_challenge_id;
end;
$$;

create or replace function private.report_infection_event_atomic(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_occurred_at timestamptz,
  p_location text,
  p_event_summary text,
  p_infection_type_state text,
  p_infection_type_text text,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid,
  incident_id uuid,
  client_id uuid,
  entry_id uuid,
  operation_kind text,
  chain_version integer,
  handling_status text,
  cluster_id uuid,
  cluster_label text,
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
  v_now timestamptz := clock_timestamp();
  v_location text := nullif(btrim(p_location), '');
  v_summary text := nullif(btrim(p_event_summary), '');
  v_infection_state text := lower(nullif(btrim(p_infection_type_state), ''));
  v_infection_text text := nullif(btrim(p_infection_type_text), '');
  v_actor_name text;
  v_request_hash text;
  v_content_hash text;
  v_incident public.infection_incidents%rowtype;
  v_client public.clients%rowtype;
  v_operation private.infection_event_operations%rowtype;
begin
  if v_actor is null or coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception using errcode = '42501', message = 'infection incident client scope is not permitted';
  end if;

  if p_expected_organization_id is null
     or p_expected_branch_id is null
     or p_client_id is null
     or p_occurred_at is null
     or p_idempotency_key is null
     or p_occurred_at > v_now
     or v_location is null
     or char_length(v_location) > 240
     or v_location ~ '[[:cntrl:]]'
     or v_summary is null
     or char_length(v_summary) > 2000
     or translate(v_summary, E'\n\r\t', '') ~ '[[:cntrl:]]'
     or v_infection_state not in ('provided', 'missing', 'not_applicable')
     or (v_infection_state = 'provided' and (
       v_infection_text is null
       or char_length(v_infection_text) > 240
       or v_infection_text ~ '[[:cntrl:]]'
     ))
     or (v_infection_state <> 'provided' and v_infection_text is not null) then
    raise exception using errcode = '22023', message = 'invalid infection incident report';
  end if;

  select btrim(profile.display_name) into v_actor_name
  from public.profiles profile
  where profile.id = v_actor
    and profile.is_active
    and profile.kind <> 'family';

  if v_actor_name is null
     or not exists (
       select 1 from public.branches branch
       where branch.id = p_expected_branch_id
         and branch.organization_id = p_expected_organization_id
         and branch.is_active
     )
     or not (select private.can_staff_access_client(p_client_id, 'clients.read'))
     or not (select private.can_staff_access_client(p_client_id, 'quality_events.manage')) then
    raise exception using errcode = '42501', message = 'infection incident client scope is not permitted';
  end if;

  v_request_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version', 1,
    'operation', 'report',
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id,
    'client_id', p_client_id,
    'actor_user_id', v_actor,
    'occurred_at', p_occurred_at,
    'location', v_location,
    'event_summary', v_summary,
    'infection_type_state', v_infection_state,
    'infection_type_text', v_infection_text
  )::text, 'UTF8')), 'hex');

  perform pg_advisory_xact_lock(hashtextextended(
    'infection-event-operation:' || v_actor::text || ':' || p_idempotency_key::text,
    0
  ));

  select operation.* into v_operation
  from private.infection_event_operations operation
  where operation.actor_user_id = v_actor
    and operation.idempotency_key = p_idempotency_key;

  if found then
    if v_operation.operation_kind <> 'report'
       or v_operation.organization_id <> p_expected_organization_id
       or v_operation.branch_id <> p_expected_branch_id
       or v_operation.client_id <> p_client_id
       or v_operation.request_hash <> v_request_hash then
      raise exception using errcode = '23505', message = 'infection incident idempotency conflict';
    end if;
    if not (select private.can_staff_access_client(p_client_id, 'clients.read'))
       or not (select private.can_staff_access_client(p_client_id, 'quality_events.manage'))
       or not exists (
         select 1 from public.infection_incidents incident
         where incident.id = v_operation.incident_id
           and incident.organization_id = p_expected_organization_id
           and incident.branch_id = p_expected_branch_id
           and incident.client_id = p_client_id
       ) then
      raise exception using errcode = '42501', message = 'infection incident replay is not permitted';
    end if;
    return query select
      v_operation.id,
      v_operation.incident_id,
      v_operation.client_id,
      v_operation.entry_id,
      v_operation.operation_kind,
      v_operation.result_chain_version,
      v_operation.result_status,
      v_operation.result_cluster_id,
      v_operation.result_cluster_label,
      v_operation.result_committed_at,
      true;
    return;
  end if;

  select client.* into v_client
  from public.clients client
  where client.id = p_client_id
    and client.organization_id = p_expected_organization_id
    and client.branch_id = p_expected_branch_id
  for share;

  if not found
     or v_client.status <> 'active'
     or v_client.admitted_on is null
     or (p_occurred_at at time zone 'Asia/Taipei')::date < v_client.admitted_on
     or (v_client.ended_on is not null and
       (p_occurred_at at time zone 'Asia/Taipei')::date > v_client.ended_on)
     or not (select private.can_staff_access_client(p_client_id, 'clients.read'))
     or not (select private.can_staff_access_client(p_client_id, 'quality_events.manage')) then
    raise exception using errcode = '42501', message = 'infection incident client scope is not permitted';
  end if;

  v_content_hash := encode(sha256(convert_to(jsonb_build_object(
    'content_hash_version', 1,
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id,
    'client_id', p_client_id,
    'occurred_at', p_occurred_at,
    'location', v_location,
    'event_summary', v_summary,
    'infection_type_state', v_infection_state,
    'infection_type_text', v_infection_text,
    'reported_by', v_actor,
    'reporter_display_name', v_actor_name,
    'reported_at', v_now
  )::text, 'UTF8')), 'hex');

  insert into public.infection_incidents (
    organization_id, branch_id, client_id, occurred_at, location,
    event_summary, infection_type_state, infection_type_text, reported_by,
    reporter_display_name, reported_at, content_hash
  ) values (
    p_expected_organization_id, p_expected_branch_id, p_client_id,
    p_occurred_at, v_location, v_summary, v_infection_state, v_infection_text,
    v_actor, v_actor_name, v_now, v_content_hash
  ) returning * into v_incident;

  insert into private.infection_event_operations (
    organization_id, branch_id, client_id, incident_id, entry_id,
    actor_user_id, operation_kind, idempotency_key, request_hash,
    result_chain_version, result_status, result_committed_at,
    reauth_challenge_id
  ) values (
    p_expected_organization_id, p_expected_branch_id, p_client_id,
    v_incident.id, null, v_actor, 'report', p_idempotency_key,
    v_request_hash, 0, 'reported', v_incident.reported_at, null
  ) returning * into v_operation;

  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not exists (
       select 1 from public.branches branch
       where branch.id = p_expected_branch_id
         and branch.organization_id = p_expected_organization_id
         and branch.is_active
     )
     or not (select private.can_staff_access_client(p_client_id, 'clients.read'))
     or not (select private.can_staff_access_client(p_client_id, 'quality_events.manage')) then
    raise exception using errcode = '42501', message = 'infection incident authority expired';
  end if;

  return query select
    v_operation.id,
    v_operation.incident_id,
    v_operation.client_id,
    v_operation.entry_id,
    v_operation.operation_kind,
    v_operation.result_chain_version,
    v_operation.result_status,
    v_operation.result_cluster_id,
    v_operation.result_cluster_label,
    v_operation.result_committed_at,
    false;
end;
$$;

create or replace function private.append_infection_event_entry_atomic(
  p_operation_kind text,
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_incident_id uuid,
  p_occurred_at timestamptz,
  p_entry_text text,
  p_cluster_id uuid,
  p_cluster_label text,
  p_closure_outcome text,
  p_closure_reason text,
  p_expected_chain_version integer,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid,
  incident_id uuid,
  client_id uuid,
  entry_id uuid,
  operation_kind text,
  chain_version integer,
  handling_status text,
  cluster_id uuid,
  cluster_label text,
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
  v_now timestamptz := clock_timestamp();
  v_kind text := lower(nullif(btrim(p_operation_kind), ''));
  v_entry_type text;
  v_text text := nullif(btrim(p_entry_text), '');
  v_cluster_label text := nullif(btrim(p_cluster_label), '');
  v_outcome text := nullif(btrim(p_closure_outcome), '');
  v_reason text := nullif(btrim(p_closure_reason), '');
  v_permission text;
  v_actor_name text;
  v_request_hash text;
  v_content_hash text;
  v_reauth_challenge_id uuid;
  v_cluster public.infection_clusters%rowtype;
  v_current_cluster_id uuid;
  v_current_cluster_label text;
  v_last_cluster_entry_type text;
  v_incident public.infection_incidents%rowtype;
  v_previous public.infection_incident_entries%rowtype;
  v_entry public.infection_incident_entries%rowtype;
  v_operation private.infection_event_operations%rowtype;
  v_current_version integer;
begin
  if v_actor is null or coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception using errcode = '42501', message = 'infection incident timeline scope is not permitted';
  end if;

  if p_expected_organization_id is null
     or p_expected_branch_id is null
     or p_client_id is null
     or p_incident_id is null
     or p_occurred_at is null
     or p_expected_chain_version is null
     or p_expected_chain_version < 0
     or p_idempotency_key is null
     or p_occurred_at > v_now
     or v_kind not in ('treatment', 'follow_up', 'cluster_link', 'cluster_unlink', 'close') then
    raise exception using errcode = '22023', message = 'invalid infection incident timeline entry';
  end if;

  if v_kind = 'close' then
    v_entry_type := 'closure';
    v_permission := 'quality_events.close';
    if v_text is not null
       or v_outcome is null
       or char_length(v_outcome) > 2000
       or translate(v_outcome, E'\n\r\t', '') ~ '[[:cntrl:]]'
       or v_reason is null
       or char_length(v_reason) > 1000
       or translate(v_reason, E'\n\r\t', '') ~ '[[:cntrl:]]' then
      raise exception using errcode = '22023', message = 'closure outcome and reason are required';
    end if;
    if p_cluster_id is not null or v_cluster_label is not null then
      raise exception using errcode = '22023', message = 'closure cannot carry a cluster target';
    end if;
  elsif v_kind in ('cluster_link', 'cluster_unlink') then
    v_entry_type := v_kind;
    v_permission := 'quality_events.manage';
    if v_text is not null
       or v_outcome is not null
       or v_reason is not null
       or v_cluster_label is null
       or char_length(v_cluster_label) > 120
       or v_cluster_label ~ '[[:cntrl:]]'
       or (v_kind = 'cluster_unlink' and p_cluster_id is null) then
      raise exception using errcode = '22023', message = 'an exact cluster id and label are required';
    end if;
  else
    v_entry_type := v_kind;
    v_permission := 'quality_events.manage';
    if v_text is null
       or char_length(v_text) > 2000
       or translate(v_text, E'\n\r\t', '') ~ '[[:cntrl:]]'
       or v_outcome is not null
       or v_reason is not null
       or p_cluster_id is not null
       or v_cluster_label is not null then
      raise exception using errcode = '22023', message = 'treatment or follow-up text is required';
    end if;
  end if;

  select btrim(profile.display_name) into v_actor_name
  from public.profiles profile
  where profile.id = v_actor
    and profile.is_active
    and profile.kind <> 'family';

  if v_actor_name is null
     or not exists (
       select 1 from public.branches branch
       where branch.id = p_expected_branch_id
         and branch.organization_id = p_expected_organization_id
         and branch.is_active
     )
     or not (select private.can_staff_access_client(p_client_id, 'clients.read'))
     or not (select private.can_staff_access_client(p_client_id, v_permission)) then
    raise exception using errcode = '42501', message = 'infection incident timeline scope is not permitted';
  end if;

  v_request_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version', 1,
    'operation', v_kind,
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id,
    'client_id', p_client_id,
    'incident_id', p_incident_id,
    'actor_user_id', v_actor,
    'occurred_at', p_occurred_at,
    'entry_text', v_text,
    'cluster_id', p_cluster_id,
    'cluster_label', v_cluster_label,
    'closure_outcome', v_outcome,
    'closure_reason', v_reason,
    'expected_chain_version', p_expected_chain_version
  )::text, 'UTF8')), 'hex');

  perform pg_advisory_xact_lock(hashtextextended(
    'infection-event-operation:' || v_actor::text || ':' || p_idempotency_key::text,
    0
  ));

  select operation.* into v_operation
  from private.infection_event_operations operation
  where operation.actor_user_id = v_actor
    and operation.idempotency_key = p_idempotency_key;

  if found then
    if v_operation.operation_kind <> v_kind
       or v_operation.organization_id <> p_expected_organization_id
       or v_operation.branch_id <> p_expected_branch_id
       or v_operation.client_id <> p_client_id
       or v_operation.incident_id <> p_incident_id
       or v_operation.request_hash <> v_request_hash then
      raise exception using errcode = '23505', message = 'infection timeline idempotency conflict';
    end if;
    if not (select private.can_staff_access_client(p_client_id, 'clients.read'))
       or not (select private.can_staff_access_client(p_client_id, v_permission))
       or not exists (
         select 1 from public.infection_incidents incident
         where incident.id = p_incident_id
           and incident.organization_id = p_expected_organization_id
           and incident.branch_id = p_expected_branch_id
           and incident.client_id = p_client_id
       ) then
      raise exception using errcode = '42501', message = 'infection timeline replay is not permitted';
    end if;
    if v_kind = 'close' then
      perform private.require_infection_closure_reauth(v_actor, clock_timestamp());
    end if;
    return query select
      v_operation.id,
      v_operation.incident_id,
      v_operation.client_id,
      v_operation.entry_id,
      v_operation.operation_kind,
      v_operation.result_chain_version,
      v_operation.result_status,
      v_operation.result_cluster_id,
      v_operation.result_cluster_label,
      v_operation.result_committed_at,
      true;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'infection-event-chain:' || p_expected_organization_id::text || ':' ||
      p_expected_branch_id::text || ':' || p_incident_id::text,
    0
  ));

  select incident.* into v_incident
  from public.infection_incidents incident
  where incident.id = p_incident_id
    and incident.organization_id = p_expected_organization_id
    and incident.branch_id = p_expected_branch_id
    and incident.client_id = p_client_id
  for update;

  if not found
     or p_occurred_at < v_incident.occurred_at
     or not (select private.can_staff_access_client(p_client_id, 'clients.read'))
     or not (select private.can_staff_access_client(p_client_id, v_permission)) then
    if v_incident.id is not null and p_occurred_at < v_incident.occurred_at then
      raise exception using errcode = '22023', message = 'timeline entry cannot predate the incident';
    end if;
    raise exception using errcode = '42501', message = 'infection incident timeline scope is not permitted';
  end if;

  select entry.* into v_previous
  from public.infection_incident_entries entry
  where entry.incident_id = p_incident_id
    and entry.organization_id = p_expected_organization_id
    and entry.branch_id = p_expected_branch_id
    and entry.client_id = p_client_id
  order by entry.sequence_number desc
  limit 1
  for update;

  v_current_version := coalesce(v_previous.sequence_number, 0);
  if v_current_version <> p_expected_chain_version then
    raise exception using errcode = '40001', message = 'infection incident chain version conflict';
  end if;
  if p_occurred_at < coalesce(v_previous.occurred_at, v_incident.occurred_at) then
    raise exception using errcode = '22023', message = 'timeline entry cannot predate the prior entry';
  end if;
  if v_previous.entry_type = 'closure' then
    raise exception using errcode = '23514', message = 'closed infection incident history cannot be extended';
  end if;

  select entry.entry_type, entry.cluster_id, entry.cluster_label
  into v_last_cluster_entry_type, v_current_cluster_id, v_current_cluster_label
  from public.infection_incident_entries entry
  where entry.incident_id = p_incident_id
    and entry.organization_id = p_expected_organization_id
    and entry.branch_id = p_expected_branch_id
    and entry.client_id = p_client_id
    and entry.entry_type in ('cluster_link', 'cluster_unlink')
  order by entry.sequence_number desc
  limit 1;

  if v_last_cluster_entry_type = 'cluster_unlink' then
    v_current_cluster_id := null;
    v_current_cluster_label := null;
  end if;

  if v_kind = 'cluster_link' then
    if v_current_cluster_id is not null then
      raise exception using errcode = '23514', message = 'unlink the current cluster before linking another';
    end if;
    if p_cluster_id is null then
      insert into public.infection_clusters (
        organization_id, branch_id, label, created_by, creator_display_name,
        created_at, content_hash
      ) values (
        p_expected_organization_id, p_expected_branch_id, v_cluster_label,
        v_actor, v_actor_name, v_now,
        encode(sha256(convert_to(jsonb_build_object(
          'content_hash_version', 1,
          'organization_id', p_expected_organization_id,
          'branch_id', p_expected_branch_id,
          'label', v_cluster_label,
          'created_by', v_actor,
          'creator_display_name', v_actor_name,
          'created_at', v_now
        )::text, 'UTF8')), 'hex')
      ) returning * into v_cluster;
    else
      select cluster.* into v_cluster
      from public.infection_clusters cluster
      where cluster.id = p_cluster_id
        and cluster.organization_id = p_expected_organization_id
        and cluster.branch_id = p_expected_branch_id
      for share;
      if not found or v_cluster.label <> v_cluster_label then
        raise exception using errcode = '42501', message = 'exact cluster scope or label is not permitted';
      end if;
    end if;
  elsif v_kind = 'cluster_unlink' then
    if v_current_cluster_id is null
       or v_current_cluster_id <> p_cluster_id
       or v_current_cluster_label <> v_cluster_label then
      raise exception using errcode = '23514', message = 'cluster unlink target does not match the current link';
    end if;
    select cluster.* into v_cluster
    from public.infection_clusters cluster
    where cluster.id = p_cluster_id
      and cluster.organization_id = p_expected_organization_id
      and cluster.branch_id = p_expected_branch_id
      and cluster.label = v_cluster_label
    for share;
    if not found then
      raise exception using errcode = '42501', message = 'exact cluster scope is not permitted';
    end if;
  end if;

  -- Recheck authority after all waits, immediately before committing history.
  if not (select private.can_staff_access_client(p_client_id, 'clients.read'))
     or not (select private.can_staff_access_client(p_client_id, v_permission)) then
    raise exception using errcode = '42501', message = 'infection incident timeline authority expired';
  end if;
  v_now := clock_timestamp();
  if p_occurred_at > v_now then
    raise exception using errcode = '22023', message = 'timeline entry cannot be in the future';
  end if;

  if v_kind = 'close' then
    v_reauth_challenge_id := private.require_infection_closure_reauth(v_actor, v_now);
  end if;

  v_content_hash := encode(sha256(convert_to(jsonb_build_object(
    'content_hash_version', 1,
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id,
    'client_id', p_client_id,
    'incident_id', p_incident_id,
    'sequence_number', v_current_version + 1,
    'previous_entry_id', v_previous.id,
    'entry_type', v_entry_type,
    'occurred_at', p_occurred_at,
    'entry_text', v_text,
    'cluster_id', case when v_kind in ('cluster_link', 'cluster_unlink') then v_cluster.id else null end,
    'cluster_label', case when v_kind in ('cluster_link', 'cluster_unlink') then v_cluster.label else null end,
    'closure_outcome', v_outcome,
    'closure_reason', v_reason,
    'committed_by', v_actor,
    'committer_display_name', v_actor_name,
    'committed_at', v_now,
    'closure_reauth_challenge_id', v_reauth_challenge_id
  )::text, 'UTF8')), 'hex');

  insert into public.infection_incident_entries (
    organization_id, branch_id, client_id, incident_id, sequence_number,
    previous_entry_id, entry_type, occurred_at, entry_text, closure_outcome,
    cluster_id, cluster_label, closure_reason, committed_by, committer_display_name, committed_at,
    closure_reauth_challenge_id, content_hash
  ) values (
    p_expected_organization_id, p_expected_branch_id, p_client_id,
    p_incident_id, v_current_version + 1, v_previous.id, v_entry_type,
    p_occurred_at, v_text, v_outcome,
    case when v_kind in ('cluster_link', 'cluster_unlink') then v_cluster.id else null end,
    case when v_kind in ('cluster_link', 'cluster_unlink') then v_cluster.label else null end,
    v_reason, v_actor, v_actor_name,
    v_now, v_reauth_challenge_id, v_content_hash
  ) returning * into v_entry;

  insert into private.infection_event_operations (
    organization_id, branch_id, client_id, incident_id, entry_id,
    actor_user_id, operation_kind, idempotency_key, request_hash,
    result_chain_version, result_status, result_committed_at,
    result_cluster_id, result_cluster_label, reauth_challenge_id
  ) values (
    p_expected_organization_id, p_expected_branch_id, p_client_id,
    p_incident_id, v_entry.id, v_actor, v_kind, p_idempotency_key,
    v_request_hash, v_entry.sequence_number,
    case when v_kind = 'close' then 'closed' else 'in_progress' end,
    v_entry.committed_at,
    case when v_kind in ('cluster_link', 'cluster_unlink') then v_entry.cluster_id else null end,
    case when v_kind in ('cluster_link', 'cluster_unlink') then v_entry.cluster_label else null end,
    v_reauth_challenge_id
  ) returning * into v_operation;

  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not exists (
       select 1 from public.branches branch
       where branch.id = p_expected_branch_id
         and branch.organization_id = p_expected_organization_id
         and branch.is_active
     )
     or not (select private.can_staff_access_client(p_client_id, 'clients.read'))
     or not (select private.can_staff_access_client(p_client_id, v_permission)) then
    raise exception using errcode = '42501', message = 'infection timeline authority expired';
  end if;
  if v_kind = 'close' then
    perform private.require_infection_closure_reauth(v_actor, clock_timestamp());
  end if;

  return query select
    v_operation.id,
    v_operation.incident_id,
    v_operation.client_id,
    v_operation.entry_id,
    v_operation.operation_kind,
    v_operation.result_chain_version,
    v_operation.result_status,
    v_operation.result_cluster_id,
    v_operation.result_cluster_label,
    v_operation.result_committed_at,
    false;
end;
$$;

create or replace function private.infection_event_snapshot_response(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_date_from date default null,
  p_date_to date default null,
  p_infection_type text default null,
  p_handling_status text default 'all',
  p_client_id uuid default null,
  p_cluster_mode text default 'all',
  p_cluster_id uuid default null
)
returns table(
  organization_id uuid,
  branch_id uuid,
  generated_at timestamptz,
  items jsonb,
  item_total bigint,
  matching_total bigint,
  infection_provided_total bigint,
  linked_total bigint,
  awaiting_action_total bigint,
  awaiting_closure_total bigint,
  closed_total bigint,
  items_truncated boolean,
  client_options jsonb,
  client_options_available_total bigint,
  client_options_truncated boolean,
  infection_type_options jsonb,
  infection_options_available_total bigint,
  infection_options_truncated boolean,
  cluster_options jsonb,
  cluster_options_available_total bigint,
  cluster_options_truncated boolean,
  infection_taxonomy_status text,
  cluster_threshold_status text,
  legal_reporting_status text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_generated_at timestamptz := clock_timestamp();
  v_infection_type text := nullif(btrim(p_infection_type), '');
  v_items jsonb;
  v_item_total bigint;
  v_matching_total bigint;
  v_infection_provided_total bigint;
  v_linked_total bigint;
  v_awaiting_action_total bigint;
  v_awaiting_closure_total bigint;
  v_closed_total bigint;
  v_client_options jsonb;
  v_client_options_available_total bigint;
  v_client_options_truncated boolean;
  v_infection_options jsonb;
  v_infection_options_available_total bigint;
  v_infection_options_truncated boolean;
  v_cluster_options jsonb;
  v_cluster_options_available_total bigint;
  v_cluster_options_truncated boolean;
begin
  if v_actor is null
     or p_expected_organization_id is null
     or p_expected_branch_id is null
     or (p_date_from is not null and p_date_to is not null and p_date_from > p_date_to)
     or p_handling_status not in ('all', 'reported', 'in_progress', 'closed')
     or p_cluster_mode not in ('all', 'linked', 'unlinked')
     or (p_cluster_id is not null and p_cluster_mode = 'unlinked')
     or (v_infection_type is not null and char_length(v_infection_type) > 240)
     or coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not exists (
       select 1 from public.branches branch
       where branch.id = p_expected_branch_id
         and branch.organization_id = p_expected_organization_id
         and branch.is_active
     )
     or not (select private.has_permission(
       p_expected_organization_id, p_expected_branch_id, 'clients.read'
     ))
     or not (select private.has_permission(
       p_expected_organization_id, p_expected_branch_id, 'quality_events.read'
     )) then
    raise exception using errcode = '42501', message = 'infection incident snapshot is not permitted';
  end if;

  with accessible as (
    select
      incident.*,
      client.display_name as client_display_name,
      coalesce(timeline.timeline_total, 0)::integer as timeline_total,
      timeline.last_entry_type,
      case when cluster_state.entry_type = 'cluster_link'
        then cluster_state.cluster_id else null end as current_cluster_id,
      case when cluster_state.entry_type = 'cluster_link'
        then cluster_state.cluster_label else null end as current_cluster_label,
      coalesce(timeline.last_committed_at, incident.reported_at) as last_activity_at,
      case
        when timeline.last_entry_type = 'closure' then 'closed'
        when coalesce(timeline.timeline_total, 0) > 0 then 'in_progress'
        else 'reported'
      end as handling_status
    from public.infection_incidents incident
    join public.clients client
      on client.id = incident.client_id
     and client.organization_id = incident.organization_id
     and client.branch_id = incident.branch_id
    left join lateral (
      select
        count(*)::integer as timeline_total,
        (array_agg(entry.entry_type order by entry.sequence_number desc))[1]
          as last_entry_type,
        max(entry.committed_at) as last_committed_at
      from public.infection_incident_entries entry
      where entry.incident_id = incident.id
        and entry.organization_id = incident.organization_id
        and entry.branch_id = incident.branch_id
        and entry.client_id = incident.client_id
    ) timeline on true
    left join lateral (
      select entry.entry_type, entry.cluster_id, entry.cluster_label
      from public.infection_incident_entries entry
      where entry.incident_id = incident.id
        and entry.organization_id = incident.organization_id
        and entry.branch_id = incident.branch_id
        and entry.client_id = incident.client_id
        and entry.entry_type in ('cluster_link', 'cluster_unlink')
      order by entry.sequence_number desc
      limit 1
    ) cluster_state on true
    where incident.organization_id = p_expected_organization_id
      and incident.branch_id = p_expected_branch_id
      and (select private.can_staff_access_client(incident.client_id, 'clients.read'))
      and (select private.can_staff_access_client(incident.client_id, 'quality_events.read'))
  ), filtered as (
    select accessible.*
    from accessible
    where (p_date_from is null or
      (accessible.occurred_at at time zone 'Asia/Taipei')::date >= p_date_from)
      and (p_date_to is null or
        (accessible.occurred_at at time zone 'Asia/Taipei')::date <= p_date_to)
      and (
        v_infection_type is null
        or (v_infection_type = '__missing__'
          and accessible.infection_type_state = 'missing')
        or (v_infection_type = '__not_applicable__'
          and accessible.infection_type_state = 'not_applicable')
        or (v_infection_type not in ('__missing__', '__not_applicable__')
          and accessible.infection_type_state = 'provided'
          and accessible.infection_type_text = v_infection_type)
      )
      and (p_handling_status = 'all'
        or accessible.handling_status = p_handling_status)
      and (p_client_id is null or accessible.client_id = p_client_id)
      and (p_cluster_id is null or accessible.current_cluster_id = p_cluster_id)
      and (p_cluster_mode = 'all'
        or (p_cluster_mode = 'linked' and accessible.current_cluster_id is not null)
        or (p_cluster_mode = 'unlinked' and accessible.current_cluster_id is null))
  ), selected as (
    select filtered.*
    from filtered
    order by filtered.occurred_at desc, filtered.id desc
    limit 200
  ), selected_stats as (
    select count(*)::bigint as item_total from selected
  ), stats as (
    select
      count(*)::bigint as matching_total,
      count(*) filter (
        where filtered.infection_type_state = 'provided'
      )::bigint as infection_provided_total,
      count(*) filter (
        where filtered.current_cluster_id is not null
      )::bigint as linked_total,
      count(*) filter (
        where filtered.handling_status = 'reported'
      )::bigint as awaiting_action_total,
      count(*) filter (
        where filtered.handling_status = 'in_progress'
      )::bigint as awaiting_closure_total,
      count(*) filter (
        where filtered.handling_status = 'closed'
      )::bigint as closed_total
    from filtered
  ), client_option_candidates as (
    select client.id, client.display_name, client.status,
      client.admitted_on, client.ended_on,
      (client.status = 'active'
        and client.admitted_on is not null
        and client.admitted_on <= (v_generated_at at time zone 'Asia/Taipei')::date
      ) as can_report
    from public.clients client
    where client.organization_id = p_expected_organization_id
      and client.branch_id = p_expected_branch_id
      and (select private.can_staff_access_client(client.id, 'clients.read'))
      and (select private.can_staff_access_client(client.id, 'quality_events.read'))
      and (
        client.status = 'active'
        or exists (
          select 1 from public.infection_incidents historical_incident
          where historical_incident.client_id = client.id
            and historical_incident.organization_id = client.organization_id
            and historical_incident.branch_id = client.branch_id
        )
      )
    order by client.display_name collate "C", client.id
  ), client_option_result as (
    select
      coalesce(jsonb_agg(jsonb_build_object(
        'client_id', option_row.id,
        'display_name', option_row.display_name,
        'client_status', option_row.status,
        'admitted_on', option_row.admitted_on,
        'ended_on', option_row.ended_on,
        'can_report', option_row.can_report
      ) order by option_row.display_name collate "C", option_row.id)
        filter (where option_row.ordinality <= 200), '[]'::jsonb) as options,
      count(*)::bigint as available_total,
      count(*) > 200 as truncated
    from (
      select candidate.*, row_number() over (
        order by candidate.display_name collate "C", candidate.id
      ) as ordinality
      from client_option_candidates candidate
    ) option_row
  ), infection_option_candidates as (
    select distinct incident.infection_type_text collate "C" as infection_type_text
    from public.infection_incidents incident
    where incident.organization_id = p_expected_organization_id
      and incident.branch_id = p_expected_branch_id
      and incident.infection_type_state = 'provided'
      and (select private.can_staff_access_client(incident.client_id, 'clients.read'))
      and (select private.can_staff_access_client(incident.client_id, 'quality_events.read'))
    order by infection_type_text
  ), infection_option_result as (
    select
      coalesce(jsonb_agg(option_row.infection_type_text order by
        option_row.infection_type_text collate "C")
        filter (where option_row.ordinality <= 200), '[]'::jsonb) as options,
      count(*)::bigint as available_total,
      count(*) > 200 as truncated
    from (
      select candidate.*, row_number() over (
        order by candidate.infection_type_text collate "C"
      ) as ordinality
      from infection_option_candidates candidate
    ) option_row
  ), cluster_option_candidates as (
    select cluster.id, cluster.label, cluster.created_at
    from public.infection_clusters cluster
    where cluster.organization_id = p_expected_organization_id
      and cluster.branch_id = p_expected_branch_id
      and exists (
        select 1
        from public.infection_incident_entries entry
        where entry.cluster_id = cluster.id
          and entry.organization_id = cluster.organization_id
          and entry.branch_id = cluster.branch_id
          and (select private.can_staff_access_client(entry.client_id, 'clients.read'))
          and (select private.can_staff_access_client(entry.client_id, 'quality_events.read'))
      )
    order by cluster.label collate "C", cluster.id
  ), cluster_option_result as (
    select
      coalesce(jsonb_agg(jsonb_build_object(
        'cluster_id', option_row.id,
        'label', option_row.label,
        'created_at', option_row.created_at
      ) order by option_row.label collate "C", option_row.id)
        filter (where option_row.ordinality <= 200), '[]'::jsonb) as options,
      count(*)::bigint as available_total,
      count(*) > 200 as truncated
    from (
      select candidate.*, row_number() over (
        order by candidate.label collate "C", candidate.id
      ) as ordinality
      from cluster_option_candidates candidate
    ) option_row
  )
  select
    selected_stats.item_total,
    stats.matching_total,
    stats.infection_provided_total,
    stats.linked_total,
    stats.awaiting_action_total,
    stats.awaiting_closure_total,
    stats.closed_total,
    client_option_result.options,
    client_option_result.available_total,
    client_option_result.truncated,
    infection_option_result.options,
    infection_option_result.available_total,
    infection_option_result.truncated,
    cluster_option_result.options,
    cluster_option_result.available_total,
    cluster_option_result.truncated,
    coalesce(jsonb_agg(jsonb_build_object(
      'incident_id', incident.id,
      'client_id', incident.client_id,
      'client_display_name', incident.client_display_name,
      'occurred_at', incident.occurred_at,
      'reported_at', incident.reported_at,
      'location', incident.location,
      'event_summary', incident.event_summary,
      'infection_type_state', incident.infection_type_state,
      'infection_type_text', incident.infection_type_text,
      'current_cluster_id', incident.current_cluster_id,
      'current_cluster_label', incident.current_cluster_label,
      'reporter_display_name', incident.reporter_display_name,
      'handling_status', incident.handling_status,
      'chain_version', incident.timeline_total,
      'last_activity_at', incident.last_activity_at,
      'timeline_total', incident.timeline_total,
      'timeline_truncated', incident.timeline_total > 100,
      'timeline', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'entry_id', timeline_entry.id,
          'sequence_number', timeline_entry.sequence_number,
          'entry_type', timeline_entry.entry_type,
          'occurred_at', timeline_entry.occurred_at,
          'entry_text', timeline_entry.entry_text,
          'cluster_id', timeline_entry.cluster_id,
          'cluster_label', timeline_entry.cluster_label,
          'closure_outcome', timeline_entry.closure_outcome,
          'closure_reason', timeline_entry.closure_reason,
          'committer_display_name', timeline_entry.committer_display_name,
          'committed_at', timeline_entry.committed_at
        ) order by timeline_entry.sequence_number), '[]'::jsonb)
        from (
          select entry.*
          from public.infection_incident_entries entry
          where entry.incident_id = incident.id
            and entry.organization_id = incident.organization_id
            and entry.branch_id = incident.branch_id
            and entry.client_id = incident.client_id
          order by entry.sequence_number desc
          limit 100
        ) timeline_entry
      )
    ) order by incident.occurred_at desc, incident.id desc)
      filter (where incident.id is not null), '[]'::jsonb)
  into
    v_item_total,
    v_matching_total,
    v_infection_provided_total,
    v_linked_total,
    v_awaiting_action_total,
    v_awaiting_closure_total,
    v_closed_total,
    v_client_options,
    v_client_options_available_total,
    v_client_options_truncated,
    v_infection_options,
    v_infection_options_available_total,
    v_infection_options_truncated,
    v_cluster_options,
    v_cluster_options_available_total,
    v_cluster_options_truncated,
    v_items
  from selected_stats
  cross join stats
  cross join client_option_result
  cross join infection_option_result
  cross join cluster_option_result
  left join selected incident on true
  group by
    selected_stats.item_total,
    stats.matching_total,
    stats.infection_provided_total,
    stats.linked_total,
    stats.awaiting_action_total,
    stats.awaiting_closure_total,
    stats.closed_total,
    client_option_result.options,
    client_option_result.available_total,
    client_option_result.truncated,
    infection_option_result.options,
    infection_option_result.available_total,
    infection_option_result.truncated,
    cluster_option_result.options,
    cluster_option_result.available_total,
    cluster_option_result.truncated;

  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not (select private.has_permission(
       p_expected_organization_id, p_expected_branch_id, 'clients.read'
     ))
     or not (select private.has_permission(
       p_expected_organization_id, p_expected_branch_id, 'quality_events.read'
     )) then
    raise exception using errcode = '42501', message = 'infection incident snapshot authority expired';
  end if;

  insert into public.audit_events (
    organization_id, branch_id, actor_user_id, action, table_name, row_pk,
    changed_fields, metadata
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_actor, 'select',
    'infection_incidents', null, '{}'::text[], jsonb_build_object(
      'projection', 'page25_infection_events_v1',
      'interaction', case when p_date_from is null and p_date_to is null
        and v_infection_type is null and p_handling_status = 'all'
        and p_client_id is null and p_cluster_mode = 'all'
        and p_cluster_id is null then 'view' else 'search' end,
      'snapshot_count', v_item_total,
      'matching_count', v_matching_total,
      'items_truncated', v_matching_total > v_item_total,
      'item_limit', 200,
      'timeline_limit', 100,
      'client_options_truncated', v_client_options_truncated,
      'infection_options_truncated', v_infection_options_truncated,
      'cluster_options_truncated', v_cluster_options_truncated,
      'infection_taxonomy_status', 'not_configured',
      'cluster_threshold_status', 'not_configured',
      'legal_reporting_status', 'not_configured'
    )
  );

  -- Final fail-closed check occurs after projection and audit work. Any
  -- authority loss observed here aborts the statement, including its audit
  -- insert, and no incident data is returned.
  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not exists (
       select 1 from public.branches branch
       where branch.id = p_expected_branch_id
         and branch.organization_id = p_expected_organization_id
         and branch.is_active
     )
     or not (select private.has_permission(
       p_expected_organization_id, p_expected_branch_id, 'clients.read'
     ))
     or not (select private.has_permission(
       p_expected_organization_id, p_expected_branch_id, 'quality_events.read'
     )) then
    raise exception using errcode = '42501', message = 'infection incident snapshot authority expired';
  end if;

  return query select
    p_expected_organization_id,
    p_expected_branch_id,
    v_generated_at,
    v_items,
    v_item_total,
    v_matching_total,
    v_infection_provided_total,
    v_linked_total,
    v_awaiting_action_total,
    v_awaiting_closure_total,
    v_closed_total,
    v_matching_total > v_item_total,
    v_client_options,
    v_client_options_available_total,
    v_client_options_truncated,
    v_infection_options,
    v_infection_options_available_total,
    v_infection_options_truncated,
    v_cluster_options,
    v_cluster_options_available_total,
    v_cluster_options_truncated,
    'not_configured'::text,
    'not_configured'::text,
    'not_configured'::text;
end;
$$;

create or replace function public.infection_event_snapshot(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_date_from date default null,
  p_date_to date default null,
  p_infection_type text default null,
  p_handling_status text default 'all',
  p_client_id uuid default null,
  p_cluster_mode text default 'all',
  p_cluster_id uuid default null
)
returns table(
  organization_id uuid,
  branch_id uuid,
  generated_at timestamptz,
  items jsonb,
  item_total bigint,
  matching_total bigint,
  infection_provided_total bigint,
  linked_total bigint,
  awaiting_action_total bigint,
  awaiting_closure_total bigint,
  closed_total bigint,
  items_truncated boolean,
  client_options jsonb,
  client_options_available_total bigint,
  client_options_truncated boolean,
  infection_type_options jsonb,
  infection_options_available_total bigint,
  infection_options_truncated boolean,
  cluster_options jsonb,
  cluster_options_available_total bigint,
  cluster_options_truncated boolean,
  infection_taxonomy_status text,
  cluster_threshold_status text,
  legal_reporting_status text
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from private.infection_event_snapshot_response(
    p_expected_organization_id, p_expected_branch_id, p_date_from, p_date_to,
    p_infection_type, p_handling_status, p_client_id, p_cluster_mode, p_cluster_id
  );
$$;

create or replace function public.report_infection_event(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_occurred_at timestamptz,
  p_location text,
  p_event_summary text,
  p_infection_type_state text,
  p_infection_type_text text,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid, incident_id uuid, client_id uuid, entry_id uuid, operation_kind text,
  chain_version integer, handling_status text, cluster_id uuid, cluster_label text,
  committed_at timestamptz, replayed boolean
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from private.report_infection_event_atomic(
    p_expected_organization_id, p_expected_branch_id, p_client_id,
    p_occurred_at, p_location, p_event_summary, p_infection_type_state,
    p_infection_type_text, p_idempotency_key
  );
$$;

create or replace function public.add_infection_event_treatment(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_incident_id uuid,
  p_occurred_at timestamptz,
  p_entry_text text,
  p_expected_chain_version integer,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid, incident_id uuid, client_id uuid, entry_id uuid, operation_kind text,
  chain_version integer, handling_status text, cluster_id uuid, cluster_label text,
  committed_at timestamptz, replayed boolean
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from private.append_infection_event_entry_atomic(
    'treatment', p_expected_organization_id, p_expected_branch_id, p_client_id,
    p_incident_id, p_occurred_at, p_entry_text, null, null, null, null,
    p_expected_chain_version, p_idempotency_key
  );
$$;

create or replace function public.add_infection_event_follow_up(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_incident_id uuid,
  p_occurred_at timestamptz,
  p_entry_text text,
  p_expected_chain_version integer,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid, incident_id uuid, client_id uuid, entry_id uuid, operation_kind text,
  chain_version integer, handling_status text, cluster_id uuid, cluster_label text,
  committed_at timestamptz, replayed boolean
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from private.append_infection_event_entry_atomic(
    'follow_up', p_expected_organization_id, p_expected_branch_id, p_client_id,
    p_incident_id, p_occurred_at, p_entry_text, null, null, null, null,
    p_expected_chain_version, p_idempotency_key
  );
$$;

create or replace function public.close_infection_event(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_incident_id uuid,
  p_occurred_at timestamptz,
  p_closure_outcome text,
  p_closure_reason text,
  p_expected_chain_version integer,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid, incident_id uuid, client_id uuid, entry_id uuid, operation_kind text,
  chain_version integer, handling_status text, cluster_id uuid, cluster_label text,
  committed_at timestamptz, replayed boolean
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from private.append_infection_event_entry_atomic(
    'close', p_expected_organization_id, p_expected_branch_id, p_client_id,
    p_incident_id, p_occurred_at, null, null, null, p_closure_outcome, p_closure_reason,
    p_expected_chain_version, p_idempotency_key
  );
$$;

create or replace function public.link_infection_event_cluster(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_incident_id uuid,
  p_occurred_at timestamptz,
  p_cluster_id uuid,
  p_cluster_label text,
  p_expected_chain_version integer,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid, incident_id uuid, client_id uuid, entry_id uuid, operation_kind text,
  chain_version integer, handling_status text, cluster_id uuid, cluster_label text,
  committed_at timestamptz, replayed boolean
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from private.append_infection_event_entry_atomic(
    'cluster_link', p_expected_organization_id, p_expected_branch_id, p_client_id,
    p_incident_id, p_occurred_at, null, p_cluster_id, p_cluster_label, null, null,
    p_expected_chain_version, p_idempotency_key
  );
$$;

create or replace function public.unlink_infection_event_cluster(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_incident_id uuid,
  p_occurred_at timestamptz,
  p_cluster_id uuid,
  p_cluster_label text,
  p_expected_chain_version integer,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid, incident_id uuid, client_id uuid, entry_id uuid, operation_kind text,
  chain_version integer, handling_status text, cluster_id uuid, cluster_label text,
  committed_at timestamptz, replayed boolean
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from private.append_infection_event_entry_atomic(
    'cluster_unlink', p_expected_organization_id, p_expected_branch_id, p_client_id,
    p_incident_id, p_occurred_at, null, p_cluster_id, p_cluster_label, null, null,
    p_expected_chain_version, p_idempotency_key
  );
$$;

revoke all on function private.require_infection_closure_reauth(uuid,timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.report_infection_event_atomic(uuid,uuid,uuid,timestamptz,text,text,text,text,uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.append_infection_event_entry_atomic(text,uuid,uuid,uuid,uuid,timestamptz,text,uuid,text,text,text,integer,uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.infection_event_snapshot_response(uuid,uuid,date,date,text,text,uuid,text,uuid)
  from public, anon, authenticated, service_role;

revoke all on function public.infection_event_snapshot(uuid,uuid,date,date,text,text,uuid,text,uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.report_infection_event(uuid,uuid,uuid,timestamptz,text,text,text,text,uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.add_infection_event_treatment(uuid,uuid,uuid,uuid,timestamptz,text,integer,uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.add_infection_event_follow_up(uuid,uuid,uuid,uuid,timestamptz,text,integer,uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.close_infection_event(uuid,uuid,uuid,uuid,timestamptz,text,text,integer,uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.link_infection_event_cluster(uuid,uuid,uuid,uuid,timestamptz,uuid,text,integer,uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.unlink_infection_event_cluster(uuid,uuid,uuid,uuid,timestamptz,uuid,text,integer,uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.infection_event_snapshot(uuid,uuid,date,date,text,text,uuid,text,uuid)
  to authenticated;
grant execute on function private.infection_event_snapshot_response(uuid,uuid,date,date,text,text,uuid,text,uuid)
  to authenticated;
grant execute on function public.report_infection_event(uuid,uuid,uuid,timestamptz,text,text,text,text,uuid)
  to authenticated;
grant execute on function private.report_infection_event_atomic(uuid,uuid,uuid,timestamptz,text,text,text,text,uuid)
  to authenticated;
grant execute on function public.add_infection_event_treatment(uuid,uuid,uuid,uuid,timestamptz,text,integer,uuid)
  to authenticated;
grant execute on function public.add_infection_event_follow_up(uuid,uuid,uuid,uuid,timestamptz,text,integer,uuid)
  to authenticated;
grant execute on function public.close_infection_event(uuid,uuid,uuid,uuid,timestamptz,text,text,integer,uuid)
  to authenticated;
grant execute on function public.link_infection_event_cluster(uuid,uuid,uuid,uuid,timestamptz,uuid,text,integer,uuid)
  to authenticated;
grant execute on function public.unlink_infection_event_cluster(uuid,uuid,uuid,uuid,timestamptz,uuid,text,integer,uuid)
  to authenticated;
grant execute on function private.append_infection_event_entry_atomic(text,uuid,uuid,uuid,uuid,timestamptz,text,uuid,text,text,text,integer,uuid)
  to authenticated;
