-- Page 24: assigned-client fall incident reporting and immutable follow-up.
--
-- Injury degree is institution-owned bounded text with an explicit information
-- state. No clinical taxonomy, diagnosis, risk score, notification threshold,
-- or legal reporting rule is encoded here.

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

create table public.fall_incidents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  client_id uuid not null,
  occurred_at timestamptz not null,
  location text not null,
  event_summary text not null,
  injury_degree_state text not null,
  injury_degree_text text,
  late_entry_reason text,
  reported_by uuid not null references auth.users(id) on delete restrict,
  reporter_display_name text not null,
  reported_at timestamptz not null default clock_timestamp(),
  content_hash text not null,
  constraint fall_incidents_client_scope_fkey
    foreign key (client_id, organization_id, branch_id)
    references public.clients(id, organization_id, branch_id) on delete restrict,
  constraint fall_incidents_id_scope_key
    unique (id, organization_id, branch_id, client_id),
  constraint fall_incidents_location_check check (
    char_length(location) between 1 and 240
    and location = btrim(location)
    and location !~ '[[:cntrl:]]'
  ),
  constraint fall_incidents_summary_check check (
    char_length(event_summary) between 1 and 2000
    and event_summary = btrim(event_summary)
    and translate(event_summary, E'\n\r\t', '') !~ '[[:cntrl:]]'
  ),
  constraint fall_incidents_injury_state_check
    check (injury_degree_state in ('provided', 'missing', 'not_applicable')),
  constraint fall_incidents_injury_alignment_check check (
    (injury_degree_state = 'provided'
      and injury_degree_text is not null
      and char_length(injury_degree_text) between 1 and 240
      and injury_degree_text = btrim(injury_degree_text)
      and injury_degree_text !~ '[[:cntrl:]]')
    or (injury_degree_state <> 'provided' and injury_degree_text is null)
  ),
  constraint fall_incidents_reporter_name_check check (
    char_length(reporter_display_name) between 1 and 120
    and reporter_display_name = btrim(reporter_display_name)
    and reporter_display_name !~ '[[:cntrl:]]'
  ),
  constraint fall_incidents_time_check check (occurred_at <= reported_at),
  constraint fall_incidents_late_entry_alignment_check check (
    (occurred_at >= reported_at - interval '24 hours'
      and late_entry_reason is null)
    or (occurred_at < reported_at - interval '24 hours'
      and late_entry_reason is not null
      and char_length(late_entry_reason) between 1 and 1000
      and late_entry_reason = btrim(late_entry_reason)
      and translate(late_entry_reason, E'\n\r\t', '') !~ '[[:cntrl:]]')
  ),
  constraint fall_incidents_content_hash_check
    check (content_hash ~ '^[a-f0-9]{64}$')
);

comment on table public.fall_incidents is
  'Immutable page-24 fall incident reports. Injury degree is institution-owned text, not a clinical classification.';
comment on column public.fall_incidents.injury_degree_state is
  'Explicitly distinguishes provided, missing and not applicable. No value is inferred.';
comment on column public.fall_incidents.late_entry_reason is
  'Required only when reporting more than 24 hours after occurrence; this is an audit/backfill governance boundary, not a clinical or legal threshold.';

create index fall_incidents_scope_occurred_idx
  on public.fall_incidents (
    organization_id, branch_id, occurred_at desc, id desc
  );
create index fall_incidents_client_occurred_idx
  on public.fall_incidents (client_id, occurred_at desc, id desc);
create index fall_incidents_reported_by_idx on public.fall_incidents (reported_by);
create index fall_incidents_injury_filter_idx
  on public.fall_incidents (
    organization_id, branch_id, injury_degree_state, injury_degree_text
  );

create table public.fall_incident_entries (
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
  closure_outcome text,
  closure_reason text,
  committed_by uuid not null references auth.users(id) on delete restrict,
  committer_display_name text not null,
  committed_at timestamptz not null default clock_timestamp(),
  closure_reauth_challenge_id uuid
    references private.reauth_challenges(id) on delete restrict,
  content_hash text not null,
  constraint fall_incident_entries_incident_scope_fkey
    foreign key (incident_id, organization_id, branch_id, client_id)
    references public.fall_incidents(id, organization_id, branch_id, client_id)
    on delete restrict,
  constraint fall_incident_entries_id_scope_key
    unique (id, organization_id, branch_id, client_id, incident_id),
  constraint fall_incident_entries_previous_scope_fkey
    foreign key (
      previous_entry_id, organization_id, branch_id, client_id, incident_id
    ) references public.fall_incident_entries(
      id, organization_id, branch_id, client_id, incident_id
    ) on delete restrict,
  constraint fall_incident_entries_sequence_key
    unique (incident_id, sequence_number),
  constraint fall_incident_entries_successor_key
    unique nulls not distinct (incident_id, previous_entry_id),
  constraint fall_incident_entries_sequence_check
    check (sequence_number > 0),
  constraint fall_incident_entries_type_check
    check (entry_type in ('treatment', 'follow_up', 'closure')),
  constraint fall_incident_entries_content_alignment_check check (
    (
      entry_type in ('treatment', 'follow_up')
      and entry_text is not null
      and char_length(entry_text) between 1 and 2000
      and entry_text = btrim(entry_text)
      and translate(entry_text, E'\n\r\t', '') !~ '[[:cntrl:]]'
      and closure_outcome is null
      and closure_reason is null
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
      and closure_reauth_challenge_id is not null
    )
  ),
  constraint fall_incident_entries_committer_name_check check (
    char_length(committer_display_name) between 1 and 120
    and committer_display_name = btrim(committer_display_name)
    and committer_display_name !~ '[[:cntrl:]]'
  ),
  constraint fall_incident_entries_time_check
    check (occurred_at <= committed_at),
  constraint fall_incident_entries_content_hash_check
    check (content_hash ~ '^[a-f0-9]{64}$')
);

comment on table public.fall_incident_entries is
  'Immutable linear incident timeline containing treatment, follow-up and closure entries.';

create index fall_incident_entries_scope_incident_idx
  on public.fall_incident_entries (
    organization_id, branch_id, incident_id, sequence_number
  );
create index fall_incident_entries_client_idx
  on public.fall_incident_entries (client_id, occurred_at desc);
create index fall_incident_entries_previous_idx
  on public.fall_incident_entries (previous_entry_id)
  where previous_entry_id is not null;
create index fall_incident_entries_committed_by_idx
  on public.fall_incident_entries (committed_by);
create index fall_incident_entries_reauth_idx
  on public.fall_incident_entries (closure_reauth_challenge_id)
  where closure_reauth_challenge_id is not null;

create table private.fall_event_operations (
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
  result_committed_at timestamptz not null,
  reauth_challenge_id uuid
    references private.reauth_challenges(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  constraint fall_event_operations_incident_scope_fkey
    foreign key (incident_id, organization_id, branch_id, client_id)
    references public.fall_incidents(id, organization_id, branch_id, client_id)
    on delete restrict,
  constraint fall_event_operations_entry_scope_fkey
    foreign key (entry_id, organization_id, branch_id, client_id, incident_id)
    references public.fall_incident_entries(
      id, organization_id, branch_id, client_id, incident_id
    ) on delete restrict,
  constraint fall_event_operations_actor_idempotency_key
    unique (actor_user_id, idempotency_key),
  constraint fall_event_operations_kind_check
    check (operation_kind in ('report', 'treatment', 'follow_up', 'close')),
  constraint fall_event_operations_request_hash_check
    check (request_hash ~ '^[a-f0-9]{64}$'),
  constraint fall_event_operations_result_version_check
    check (result_chain_version >= 0),
  constraint fall_event_operations_result_status_check
    check (result_status in ('reported', 'in_progress', 'closed')),
  constraint fall_event_operations_alignment_check check (
    (operation_kind = 'report'
      and entry_id is null
      and result_chain_version = 0
      and result_status = 'reported'
      and reauth_challenge_id is null)
    or (operation_kind in ('treatment', 'follow_up')
      and entry_id is not null
      and result_chain_version > 0
      and result_status = 'in_progress'
      and reauth_challenge_id is null)
    or (operation_kind = 'close'
      and entry_id is not null
      and result_chain_version > 0
      and result_status = 'closed'
      and reauth_challenge_id is not null)
  )
);

comment on table private.fall_event_operations is
  'Append-only actor-scoped exact-replay receipts for page-24 writes.';

create index fall_event_operations_scope_incident_idx
  on private.fall_event_operations (
    organization_id, branch_id, incident_id, created_at desc
  );
create index fall_event_operations_client_idx
  on private.fall_event_operations (client_id, created_at desc);
create index fall_event_operations_entry_idx
  on private.fall_event_operations (entry_id) where entry_id is not null;
create index fall_event_operations_reauth_idx
  on private.fall_event_operations (reauth_challenge_id)
  where reauth_challenge_id is not null;

alter table public.fall_incidents enable row level security;
alter table public.fall_incidents force row level security;
alter table public.fall_incident_entries enable row level security;
alter table public.fall_incident_entries force row level security;
alter table private.fall_event_operations enable row level security;
alter table private.fall_event_operations force row level security;

revoke all on table public.fall_incidents from public, anon, authenticated, service_role;
revoke all on table public.fall_incident_entries from public, anon, authenticated, service_role;
revoke all on table private.fall_event_operations from public, anon, authenticated, service_role;

create policy fall_incidents_staff_select
on public.fall_incidents for select
to authenticated
using (
  (select private.can_staff_access_client(client_id, 'clients.read'))
  and (select private.can_staff_access_client(client_id, 'quality_events.read'))
);

create policy fall_incident_entries_staff_select
on public.fall_incident_entries for select
to authenticated
using (
  (select private.can_staff_access_client(client_id, 'clients.read'))
  and (select private.can_staff_access_client(client_id, 'quality_events.read'))
);

create or replace function private.prevent_fall_history_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception using
    errcode = '55000',
    message = 'fall incident history and operation receipts are immutable';
end;
$$;

create trigger fall_incidents_immutable
before update or delete on public.fall_incidents
for each row execute function private.prevent_fall_history_mutation();
create trigger fall_incident_entries_immutable
before update or delete on public.fall_incident_entries
for each row execute function private.prevent_fall_history_mutation();
create trigger fall_event_operations_immutable
before update or delete on private.fall_event_operations
for each row execute function private.prevent_fall_history_mutation();

create trigger fall_incidents_audit_row_change
after insert or update or delete on public.fall_incidents
for each row execute function private.audit_row_change();
create trigger fall_incident_entries_audit_row_change
after insert or update or delete on public.fall_incident_entries
for each row execute function private.audit_row_change();
create trigger fall_event_operations_audit_row_change
after insert or update or delete on private.fall_event_operations
for each row execute function private.audit_row_change();

create or replace function private.require_fall_closure_reauth(
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
      message = 'current same-session recent AAL2 evidence is required to close a fall incident';
  end if;

  begin
    v_session_id := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception using
      errcode = '42501',
      message = 'current same-session recent AAL2 evidence is required to close a fall incident';
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
      message = 'current same-session recent AAL2 evidence is required to close a fall incident';
  end if;
  return v_challenge_id;
end;
$$;

create or replace function private.report_fall_event_atomic(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_occurred_at timestamptz,
  p_location text,
  p_event_summary text,
  p_injury_degree_state text,
  p_injury_degree_text text,
  p_late_entry_reason text,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid,
  incident_id uuid,
  client_id uuid,
  entry_id uuid,
  chain_version integer,
  handling_status text,
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
  v_injury_state text := lower(nullif(btrim(p_injury_degree_state), ''));
  v_injury_text text := nullif(btrim(p_injury_degree_text), '');
  v_late_entry_reason text := nullif(btrim(p_late_entry_reason), '');
  v_actor_name text;
  v_request_hash text;
  v_content_hash text;
  v_incident public.fall_incidents%rowtype;
  v_client public.clients%rowtype;
  v_operation private.fall_event_operations%rowtype;
begin
  if v_actor is null
     or p_expected_organization_id is null
     or p_expected_branch_id is null
     or p_client_id is null
     or p_occurred_at is null
     or p_idempotency_key is null
     or coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or p_occurred_at > v_now
     or v_location is null
     or char_length(v_location) > 240
     or v_location ~ '[[:cntrl:]]'
     or v_summary is null
     or char_length(v_summary) > 2000
     or translate(v_summary, E'\n\r\t', '') ~ '[[:cntrl:]]'
     or v_injury_state not in ('provided', 'missing', 'not_applicable')
     or (v_injury_state = 'provided' and (
       v_injury_text is null
       or char_length(v_injury_text) > 240
       or v_injury_text ~ '[[:cntrl:]]'
     ))
     or (v_injury_state <> 'provided' and v_injury_text is not null) then
    raise exception using errcode = '22023', message = 'invalid fall incident report';
  end if;

  if v_late_entry_reason is not null and (
    char_length(v_late_entry_reason) > 1000
    or translate(v_late_entry_reason, E'\n\r\t', '') ~ '[[:cntrl:]]'
  ) then
    raise exception using errcode = '22023', message = 'invalid late-entry reason';
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
    raise exception using errcode = '42501', message = 'fall incident client scope is not permitted';
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
    'injury_degree_state', v_injury_state,
    'injury_degree_text', v_injury_text,
    'late_entry_reason', v_late_entry_reason
  )::text, 'UTF8')), 'hex');

  perform pg_advisory_xact_lock(hashtextextended(
    'fall-event-operation:' || v_actor::text || ':' || p_idempotency_key::text,
    0
  ));

  select operation.* into v_operation
  from private.fall_event_operations operation
  where operation.actor_user_id = v_actor
    and operation.idempotency_key = p_idempotency_key;

  if found then
    if v_operation.operation_kind <> 'report'
       or v_operation.organization_id <> p_expected_organization_id
       or v_operation.branch_id <> p_expected_branch_id
       or v_operation.client_id <> p_client_id
       or v_operation.request_hash <> v_request_hash then
      raise exception using errcode = '23505', message = 'fall incident idempotency conflict';
    end if;
    if not (select private.can_staff_access_client(p_client_id, 'clients.read'))
       or not (select private.can_staff_access_client(p_client_id, 'quality_events.manage'))
       or not exists (
         select 1 from public.fall_incidents incident
         where incident.id = v_operation.incident_id
           and incident.organization_id = p_expected_organization_id
           and incident.branch_id = p_expected_branch_id
           and incident.client_id = p_client_id
       ) then
      raise exception using errcode = '42501', message = 'fall incident replay is not permitted';
    end if;
    return query select
      v_operation.id,
      v_operation.incident_id,
      v_operation.client_id,
      v_operation.entry_id,
      v_operation.result_chain_version,
      v_operation.result_status,
      v_operation.result_committed_at,
      true;
    return;
  end if;

  -- This dynamic 24-hour governance check deliberately occurs after exact
  -- replay resolution so a previously committed receipt does not become
  -- unreplayable merely because wall time crossed the boundary.
  v_now := clock_timestamp();
  if p_occurred_at < v_now - interval '24 hours'
     and v_late_entry_reason is null then
    raise exception using errcode = '22023', message = 'late-entry reason is required after 24 hours';
  end if;
  if p_occurred_at >= v_now - interval '24 hours'
     and v_late_entry_reason is not null then
    raise exception using errcode = '22023', message = 'late-entry reason is only accepted after 24 hours';
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
    raise exception using errcode = '42501', message = 'fall incident client scope is not permitted';
  end if;

  v_content_hash := encode(sha256(convert_to(jsonb_build_object(
    'content_hash_version', 1,
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id,
    'client_id', p_client_id,
    'occurred_at', p_occurred_at,
    'location', v_location,
    'event_summary', v_summary,
    'injury_degree_state', v_injury_state,
    'injury_degree_text', v_injury_text,
    'late_entry_reason', v_late_entry_reason,
    'reported_by', v_actor,
    'reporter_display_name', v_actor_name,
    'reported_at', v_now
  )::text, 'UTF8')), 'hex');

  insert into public.fall_incidents (
    organization_id, branch_id, client_id, occurred_at, location,
    event_summary, injury_degree_state, injury_degree_text, late_entry_reason, reported_by,
    reporter_display_name, reported_at, content_hash
  ) values (
    p_expected_organization_id, p_expected_branch_id, p_client_id,
    p_occurred_at, v_location, v_summary, v_injury_state, v_injury_text,
    v_late_entry_reason, v_actor, v_actor_name, v_now, v_content_hash
  ) returning * into v_incident;

  insert into private.fall_event_operations (
    organization_id, branch_id, client_id, incident_id, entry_id,
    actor_user_id, operation_kind, idempotency_key, request_hash,
    result_chain_version, result_status, result_committed_at,
    reauth_challenge_id
  ) values (
    p_expected_organization_id, p_expected_branch_id, p_client_id,
    v_incident.id, null, v_actor, 'report', p_idempotency_key,
    v_request_hash, 0, 'reported', v_incident.reported_at, null
  ) returning * into v_operation;

  return query select
    v_operation.id,
    v_operation.incident_id,
    v_operation.client_id,
    v_operation.entry_id,
    v_operation.result_chain_version,
    v_operation.result_status,
    v_operation.result_committed_at,
    false;
end;
$$;

create or replace function private.append_fall_event_entry_atomic(
  p_operation_kind text,
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_incident_id uuid,
  p_occurred_at timestamptz,
  p_entry_text text,
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
  chain_version integer,
  handling_status text,
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
  v_outcome text := nullif(btrim(p_closure_outcome), '');
  v_reason text := nullif(btrim(p_closure_reason), '');
  v_permission text;
  v_actor_name text;
  v_request_hash text;
  v_content_hash text;
  v_reauth_challenge_id uuid;
  v_incident public.fall_incidents%rowtype;
  v_previous public.fall_incident_entries%rowtype;
  v_entry public.fall_incident_entries%rowtype;
  v_operation private.fall_event_operations%rowtype;
  v_current_version integer;
begin
  if v_actor is null
     or p_expected_organization_id is null
     or p_expected_branch_id is null
     or p_client_id is null
     or p_incident_id is null
     or p_occurred_at is null
     or p_expected_chain_version is null
     or p_expected_chain_version < 0
     or p_idempotency_key is null
     or coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or p_occurred_at > v_now
     or v_kind not in ('treatment', 'follow_up', 'close') then
    raise exception using errcode = '22023', message = 'invalid fall incident timeline entry';
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
  else
    v_entry_type := v_kind;
    v_permission := 'quality_events.manage';
    if v_text is null
       or char_length(v_text) > 2000
       or translate(v_text, E'\n\r\t', '') ~ '[[:cntrl:]]'
       or v_outcome is not null
       or v_reason is not null then
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
    raise exception using errcode = '42501', message = 'fall incident timeline scope is not permitted';
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
    'closure_outcome', v_outcome,
    'closure_reason', v_reason,
    'expected_chain_version', p_expected_chain_version
  )::text, 'UTF8')), 'hex');

  perform pg_advisory_xact_lock(hashtextextended(
    'fall-event-operation:' || v_actor::text || ':' || p_idempotency_key::text,
    0
  ));

  select operation.* into v_operation
  from private.fall_event_operations operation
  where operation.actor_user_id = v_actor
    and operation.idempotency_key = p_idempotency_key;

  if found then
    if v_operation.operation_kind <> v_kind
       or v_operation.organization_id <> p_expected_organization_id
       or v_operation.branch_id <> p_expected_branch_id
       or v_operation.client_id <> p_client_id
       or v_operation.incident_id <> p_incident_id
       or v_operation.request_hash <> v_request_hash then
      raise exception using errcode = '23505', message = 'fall timeline idempotency conflict';
    end if;
    if not (select private.can_staff_access_client(p_client_id, 'clients.read'))
       or not (select private.can_staff_access_client(p_client_id, v_permission))
       or not exists (
         select 1 from public.fall_incidents incident
         where incident.id = p_incident_id
           and incident.organization_id = p_expected_organization_id
           and incident.branch_id = p_expected_branch_id
           and incident.client_id = p_client_id
       ) then
      raise exception using errcode = '42501', message = 'fall timeline replay is not permitted';
    end if;
    if v_kind = 'close' then
      perform private.require_fall_closure_reauth(v_actor, clock_timestamp());
    end if;
    return query select
      v_operation.id,
      v_operation.incident_id,
      v_operation.client_id,
      v_operation.entry_id,
      v_operation.result_chain_version,
      v_operation.result_status,
      v_operation.result_committed_at,
      true;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'fall-event-chain:' || p_expected_organization_id::text || ':' ||
      p_expected_branch_id::text || ':' || p_incident_id::text,
    0
  ));

  select incident.* into v_incident
  from public.fall_incidents incident
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
    raise exception using errcode = '42501', message = 'fall incident timeline scope is not permitted';
  end if;

  select entry.* into v_previous
  from public.fall_incident_entries entry
  where entry.incident_id = p_incident_id
    and entry.organization_id = p_expected_organization_id
    and entry.branch_id = p_expected_branch_id
    and entry.client_id = p_client_id
  order by entry.sequence_number desc
  limit 1
  for update;

  v_current_version := coalesce(v_previous.sequence_number, 0);
  if v_current_version <> p_expected_chain_version then
    raise exception using errcode = '40001', message = 'fall incident chain version conflict';
  end if;
  if p_occurred_at < coalesce(v_previous.occurred_at, v_incident.occurred_at) then
    raise exception using errcode = '22023', message = 'timeline entry cannot predate the prior entry';
  end if;
  if v_previous.entry_type = 'closure' then
    raise exception using errcode = '23514', message = 'closed fall incident history cannot be extended';
  end if;

  -- Recheck authority after all waits, immediately before committing history.
  if not (select private.can_staff_access_client(p_client_id, 'clients.read'))
     or not (select private.can_staff_access_client(p_client_id, v_permission)) then
    raise exception using errcode = '42501', message = 'fall incident timeline authority expired';
  end if;
  v_now := clock_timestamp();
  if p_occurred_at > v_now then
    raise exception using errcode = '22023', message = 'timeline entry cannot be in the future';
  end if;

  if v_kind = 'close' then
    v_reauth_challenge_id := private.require_fall_closure_reauth(v_actor, v_now);
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
    'closure_outcome', v_outcome,
    'closure_reason', v_reason,
    'committed_by', v_actor,
    'committer_display_name', v_actor_name,
    'committed_at', v_now,
    'closure_reauth_challenge_id', v_reauth_challenge_id
  )::text, 'UTF8')), 'hex');

  insert into public.fall_incident_entries (
    organization_id, branch_id, client_id, incident_id, sequence_number,
    previous_entry_id, entry_type, occurred_at, entry_text, closure_outcome,
    closure_reason, committed_by, committer_display_name, committed_at,
    closure_reauth_challenge_id, content_hash
  ) values (
    p_expected_organization_id, p_expected_branch_id, p_client_id,
    p_incident_id, v_current_version + 1, v_previous.id, v_entry_type,
    p_occurred_at, v_text, v_outcome, v_reason, v_actor, v_actor_name,
    v_now, v_reauth_challenge_id, v_content_hash
  ) returning * into v_entry;

  insert into private.fall_event_operations (
    organization_id, branch_id, client_id, incident_id, entry_id,
    actor_user_id, operation_kind, idempotency_key, request_hash,
    result_chain_version, result_status, result_committed_at,
    reauth_challenge_id
  ) values (
    p_expected_organization_id, p_expected_branch_id, p_client_id,
    p_incident_id, v_entry.id, v_actor, v_kind, p_idempotency_key,
    v_request_hash, v_entry.sequence_number,
    case when v_kind = 'close' then 'closed' else 'in_progress' end,
    v_entry.committed_at, v_reauth_challenge_id
  ) returning * into v_operation;

  return query select
    v_operation.id,
    v_operation.incident_id,
    v_operation.client_id,
    v_operation.entry_id,
    v_operation.result_chain_version,
    v_operation.result_status,
    v_operation.result_committed_at,
    false;
end;
$$;

create or replace function private.fall_event_snapshot_response(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_date_from date default null,
  p_date_to date default null,
  p_injury_degree text default null,
  p_handling_status text default 'all',
  p_client_id uuid default null
)
returns table(
  organization_id uuid,
  branch_id uuid,
  generated_at timestamptz,
  items jsonb,
  item_total bigint,
  matching_total bigint,
  injury_provided_total bigint,
  awaiting_action_total bigint,
  awaiting_closure_total bigint,
  closed_total bigint,
  items_truncated boolean,
  client_options jsonb,
  client_options_truncated boolean,
  injury_degree_options jsonb,
  injury_options_truncated boolean,
  injury_taxonomy_status text,
  severity_scoring_status text,
  reporting_threshold_status text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_generated_at timestamptz := clock_timestamp();
  v_injury_degree text := nullif(btrim(p_injury_degree), '');
  v_items jsonb;
  v_item_total bigint;
  v_matching_total bigint;
  v_injury_provided_total bigint;
  v_awaiting_action_total bigint;
  v_awaiting_closure_total bigint;
  v_closed_total bigint;
  v_client_options jsonb;
  v_client_options_truncated boolean;
  v_injury_options jsonb;
  v_injury_options_truncated boolean;
begin
  if v_actor is null
     or p_expected_organization_id is null
     or p_expected_branch_id is null
     or (p_date_from is not null and p_date_to is not null and p_date_from > p_date_to)
     or p_handling_status not in ('all', 'reported', 'in_progress', 'closed')
     or (v_injury_degree is not null and char_length(v_injury_degree) > 240)
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
    raise exception using errcode = '42501', message = 'fall incident snapshot is not permitted';
  end if;

  with accessible as (
    select
      incident.*,
      client.display_name as client_display_name,
      coalesce(timeline.timeline_total, 0)::integer as timeline_total,
      timeline.last_entry_type,
      coalesce(timeline.last_committed_at, incident.reported_at) as last_activity_at,
      case
        when timeline.last_entry_type = 'closure' then 'closed'
        when coalesce(timeline.timeline_total, 0) > 0 then 'in_progress'
        else 'reported'
      end as handling_status
    from public.fall_incidents incident
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
      from public.fall_incident_entries entry
      where entry.incident_id = incident.id
        and entry.organization_id = incident.organization_id
        and entry.branch_id = incident.branch_id
        and entry.client_id = incident.client_id
    ) timeline on true
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
        v_injury_degree is null
        or (v_injury_degree = '__missing__'
          and accessible.injury_degree_state = 'missing')
        or (v_injury_degree = '__not_applicable__'
          and accessible.injury_degree_state = 'not_applicable')
        or (v_injury_degree not in ('__missing__', '__not_applicable__')
          and accessible.injury_degree_state = 'provided'
          and accessible.injury_degree_text = v_injury_degree)
      )
      and (p_handling_status = 'all'
        or accessible.handling_status = p_handling_status)
      and (p_client_id is null or accessible.client_id = p_client_id)
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
        where filtered.injury_degree_state = 'provided'
      )::bigint as injury_provided_total,
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
          select 1 from public.fall_incidents historical_incident
          where historical_incident.client_id = client.id
            and historical_incident.organization_id = client.organization_id
            and historical_incident.branch_id = client.branch_id
        )
      )
    order by client.display_name collate "C", client.id
    limit 201
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
      count(*) > 200 as truncated
    from (
      select candidate.*, row_number() over (
        order by candidate.display_name collate "C", candidate.id
      ) as ordinality
      from client_option_candidates candidate
    ) option_row
  ), injury_option_candidates as (
    select distinct incident.injury_degree_text collate "C" as injury_degree_text
    from public.fall_incidents incident
    where incident.organization_id = p_expected_organization_id
      and incident.branch_id = p_expected_branch_id
      and incident.injury_degree_state = 'provided'
      and (select private.can_staff_access_client(incident.client_id, 'clients.read'))
      and (select private.can_staff_access_client(incident.client_id, 'quality_events.read'))
    order by injury_degree_text
    limit 201
  ), injury_option_result as (
    select
      coalesce(jsonb_agg(option_row.injury_degree_text order by
        option_row.injury_degree_text collate "C")
        filter (where option_row.ordinality <= 200), '[]'::jsonb) as options,
      count(*) > 200 as truncated
    from (
      select candidate.*, row_number() over (
        order by candidate.injury_degree_text collate "C"
      ) as ordinality
      from injury_option_candidates candidate
    ) option_row
  )
  select
    selected_stats.item_total,
    stats.matching_total,
    stats.injury_provided_total,
    stats.awaiting_action_total,
    stats.awaiting_closure_total,
    stats.closed_total,
    client_option_result.options,
    client_option_result.truncated,
    injury_option_result.options,
    injury_option_result.truncated,
    coalesce(jsonb_agg(jsonb_build_object(
      'incident_id', incident.id,
      'client_id', incident.client_id,
      'client_display_name', incident.client_display_name,
      'occurred_at', incident.occurred_at,
      'reported_at', incident.reported_at,
      'location', incident.location,
      'event_summary', incident.event_summary,
      'injury_degree_state', incident.injury_degree_state,
      'injury_degree_text', incident.injury_degree_text,
      'late_entry_reason', incident.late_entry_reason,
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
          'closure_outcome', timeline_entry.closure_outcome,
          'closure_reason', timeline_entry.closure_reason,
          'committer_display_name', timeline_entry.committer_display_name,
          'committed_at', timeline_entry.committed_at
        ) order by timeline_entry.sequence_number), '[]'::jsonb)
        from (
          select entry.*
          from public.fall_incident_entries entry
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
    v_injury_provided_total,
    v_awaiting_action_total,
    v_awaiting_closure_total,
    v_closed_total,
    v_client_options,
    v_client_options_truncated,
    v_injury_options,
    v_injury_options_truncated,
    v_items
  from selected_stats
  cross join stats
  cross join client_option_result
  cross join injury_option_result
  left join selected incident on true
  group by
    selected_stats.item_total,
    stats.matching_total,
    stats.injury_provided_total,
    stats.awaiting_action_total,
    stats.awaiting_closure_total,
    stats.closed_total,
    client_option_result.options,
    client_option_result.truncated,
    injury_option_result.options,
    injury_option_result.truncated;

  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not (select private.has_permission(
       p_expected_organization_id, p_expected_branch_id, 'clients.read'
     ))
     or not (select private.has_permission(
       p_expected_organization_id, p_expected_branch_id, 'quality_events.read'
     )) then
    raise exception using errcode = '42501', message = 'fall incident snapshot authority expired';
  end if;

  insert into public.audit_events (
    organization_id, branch_id, actor_user_id, action, table_name, row_pk,
    changed_fields, metadata
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_actor, 'select',
    'fall_incidents', null, '{}'::text[], jsonb_build_object(
      'projection', 'page24_fall_events_v1',
      'interaction', case when p_date_from is null and p_date_to is null
        and v_injury_degree is null and p_handling_status = 'all'
        and p_client_id is null then 'view' else 'search' end,
      'snapshot_count', v_item_total,
      'matching_count', v_matching_total,
      'items_truncated', v_matching_total > v_item_total,
      'item_limit', 200,
      'timeline_limit', 100,
      'client_options_truncated', v_client_options_truncated,
      'injury_options_truncated', v_injury_options_truncated,
      'injury_taxonomy_status', 'not_configured',
      'severity_scoring_status', 'not_configured',
      'reporting_threshold_status', 'not_configured'
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
    raise exception using errcode = '42501', message = 'fall incident snapshot authority expired';
  end if;

  return query select
    p_expected_organization_id,
    p_expected_branch_id,
    v_generated_at,
    v_items,
    v_item_total,
    v_matching_total,
    v_injury_provided_total,
    v_awaiting_action_total,
    v_awaiting_closure_total,
    v_closed_total,
    v_matching_total > v_item_total,
    v_client_options,
    v_client_options_truncated,
    v_injury_options,
    v_injury_options_truncated,
    'not_configured'::text,
    'not_configured'::text,
    'not_configured'::text;
end;
$$;

create or replace function public.fall_event_snapshot(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_date_from date default null,
  p_date_to date default null,
  p_injury_degree text default null,
  p_handling_status text default 'all',
  p_client_id uuid default null
)
returns table(
  organization_id uuid,
  branch_id uuid,
  generated_at timestamptz,
  items jsonb,
  item_total bigint,
  matching_total bigint,
  injury_provided_total bigint,
  awaiting_action_total bigint,
  awaiting_closure_total bigint,
  closed_total bigint,
  items_truncated boolean,
  client_options jsonb,
  client_options_truncated boolean,
  injury_degree_options jsonb,
  injury_options_truncated boolean,
  injury_taxonomy_status text,
  severity_scoring_status text,
  reporting_threshold_status text
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from private.fall_event_snapshot_response(
    p_expected_organization_id, p_expected_branch_id, p_date_from, p_date_to,
    p_injury_degree, p_handling_status, p_client_id
  );
$$;

create or replace function public.report_fall_event(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_occurred_at timestamptz,
  p_location text,
  p_event_summary text,
  p_injury_degree_state text,
  p_injury_degree_text text,
  p_late_entry_reason text,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid, incident_id uuid, client_id uuid, entry_id uuid, chain_version integer,
  handling_status text, committed_at timestamptz, replayed boolean
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from private.report_fall_event_atomic(
    p_expected_organization_id, p_expected_branch_id, p_client_id,
    p_occurred_at, p_location, p_event_summary, p_injury_degree_state,
    p_injury_degree_text, p_late_entry_reason, p_idempotency_key
  );
$$;

create or replace function public.add_fall_event_treatment(
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
  operation_id uuid, incident_id uuid, client_id uuid, entry_id uuid, chain_version integer,
  handling_status text, committed_at timestamptz, replayed boolean
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from private.append_fall_event_entry_atomic(
    'treatment', p_expected_organization_id, p_expected_branch_id, p_client_id,
    p_incident_id, p_occurred_at, p_entry_text, null, null,
    p_expected_chain_version, p_idempotency_key
  );
$$;

create or replace function public.add_fall_event_follow_up(
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
  operation_id uuid, incident_id uuid, client_id uuid, entry_id uuid, chain_version integer,
  handling_status text, committed_at timestamptz, replayed boolean
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from private.append_fall_event_entry_atomic(
    'follow_up', p_expected_organization_id, p_expected_branch_id, p_client_id,
    p_incident_id, p_occurred_at, p_entry_text, null, null,
    p_expected_chain_version, p_idempotency_key
  );
$$;

create or replace function public.close_fall_event(
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
  operation_id uuid, incident_id uuid, client_id uuid, entry_id uuid, chain_version integer,
  handling_status text, committed_at timestamptz, replayed boolean
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from private.append_fall_event_entry_atomic(
    'close', p_expected_organization_id, p_expected_branch_id, p_client_id,
    p_incident_id, p_occurred_at, null, p_closure_outcome, p_closure_reason,
    p_expected_chain_version, p_idempotency_key
  );
$$;

revoke all on function private.require_fall_closure_reauth(uuid,timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.report_fall_event_atomic(uuid,uuid,uuid,timestamptz,text,text,text,text,text,uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.append_fall_event_entry_atomic(text,uuid,uuid,uuid,uuid,timestamptz,text,text,text,integer,uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.fall_event_snapshot_response(uuid,uuid,date,date,text,text,uuid)
  from public, anon, authenticated, service_role;

revoke all on function public.fall_event_snapshot(uuid,uuid,date,date,text,text,uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.report_fall_event(uuid,uuid,uuid,timestamptz,text,text,text,text,text,uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.add_fall_event_treatment(uuid,uuid,uuid,uuid,timestamptz,text,integer,uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.add_fall_event_follow_up(uuid,uuid,uuid,uuid,timestamptz,text,integer,uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.close_fall_event(uuid,uuid,uuid,uuid,timestamptz,text,text,integer,uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.fall_event_snapshot(uuid,uuid,date,date,text,text,uuid)
  to authenticated;
grant execute on function private.fall_event_snapshot_response(uuid,uuid,date,date,text,text,uuid)
  to authenticated;
grant execute on function public.report_fall_event(uuid,uuid,uuid,timestamptz,text,text,text,text,text,uuid)
  to authenticated;
grant execute on function private.report_fall_event_atomic(uuid,uuid,uuid,timestamptz,text,text,text,text,text,uuid)
  to authenticated;
grant execute on function public.add_fall_event_treatment(uuid,uuid,uuid,uuid,timestamptz,text,integer,uuid)
  to authenticated;
grant execute on function public.add_fall_event_follow_up(uuid,uuid,uuid,uuid,timestamptz,text,integer,uuid)
  to authenticated;
grant execute on function public.close_fall_event(uuid,uuid,uuid,uuid,timestamptz,text,text,integer,uuid)
  to authenticated;
grant execute on function private.append_fall_event_entry_atomic(text,uuid,uuid,uuid,uuid,timestamptz,text,text,text,integer,uuid)
  to authenticated;
