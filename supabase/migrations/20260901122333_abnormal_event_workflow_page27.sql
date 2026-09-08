-- Page 27: branch-scoped general abnormal events with immutable reports and an
-- append-only linear evidence chain. Event taxonomy, major-event criteria and
-- statutory reporting rules are deliberately not configured. Manual
-- notification entries are evidence supplied by staff, not delivery receipts.

insert into public.permissions (permission_key, description, risk_level)
values
  ('quality_events.read', 'Read assigned-client and branch quality event history', 1),
  ('quality_events.manage', 'Report and append quality event evidence', 2),
  ('quality_events.close', 'Close quality events with recent AAL2 evidence', 3)
on conflict (permission_key) do nothing;

insert into public.role_permissions (role_id, permission_id)
select role.id, permission.id
from public.roles role
join public.permissions permission on permission.permission_key = 'quality_events.read'
where role.is_system and role.role_key in (
  'organization_manager', 'branch_supervisor', 'case_manager_social_worker',
  'nurse', 'care_worker', 'professional'
)
on conflict (role_id, permission_id) do nothing;

insert into public.role_permissions (role_id, permission_id)
select role.id, permission.id
from public.roles role
join public.permissions permission on permission.permission_key = 'quality_events.manage'
where role.is_system and role.role_key in (
  'organization_manager', 'branch_supervisor', 'case_manager_social_worker',
  'nurse', 'care_worker', 'professional'
)
on conflict (role_id, permission_id) do nothing;

insert into public.role_permissions (role_id, permission_id)
select role.id, permission.id
from public.roles role
join public.permissions permission on permission.permission_key = 'quality_events.close'
where role.is_system and role.role_key in (
  'organization_manager', 'branch_supervisor', 'case_manager_social_worker', 'nurse'
)
on conflict (role_id, permission_id) do nothing;

create table public.abnormal_incidents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  branch_id uuid not null,
  affected_target_kind text not null,
  affected_client_id uuid,
  affected_target_label_snapshot text not null,
  occurred_at timestamptz not null,
  location text not null,
  event_type text not null,
  event_summary text not null,
  immediate_action text not null,
  major_state text not null,
  initial_responsible_membership_id uuid not null references public.memberships(id) on delete restrict,
  initial_responsible_user_id uuid not null references auth.users(id) on delete restrict,
  initial_responsible_display_name text not null,
  initial_improvement_due_date date not null,
  late_entry_reason text,
  reported_by uuid not null references auth.users(id) on delete restrict,
  reporter_display_name text not null,
  reported_at timestamptz not null default clock_timestamp(),
  content_hash text not null,
  constraint abnormal_incidents_branch_scope_fkey
    foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete restrict,
  constraint abnormal_incidents_client_scope_fkey
    foreign key (affected_client_id, organization_id, branch_id)
    references public.clients(id, organization_id, branch_id) on delete restrict,
  constraint abnormal_incidents_id_scope_key unique (id, organization_id, branch_id),
  constraint abnormal_incidents_target_kind_check
    check (affected_target_kind in ('client', 'staff', 'visitor', 'facility', 'other')),
  constraint abnormal_incidents_target_alignment_check check (
    (affected_target_kind = 'client' and affected_client_id is not null)
    or (affected_target_kind <> 'client' and affected_client_id is null)
  ),
  constraint abnormal_incidents_target_label_check check (
    char_length(affected_target_label_snapshot) between 1 and 240
    and affected_target_label_snapshot = btrim(affected_target_label_snapshot)
    and affected_target_label_snapshot !~ '[[:cntrl:]]'
  ),
  constraint abnormal_incidents_location_check check (
    char_length(location) between 1 and 240 and location = btrim(location)
    and location !~ '[[:cntrl:]]'
  ),
  constraint abnormal_incidents_event_type_check check (
    char_length(event_type) between 1 and 240 and event_type = btrim(event_type)
    and event_type !~ '[[:cntrl:]]'
  ),
  constraint abnormal_incidents_summary_check check (
    char_length(event_summary) between 1 and 2000 and event_summary = btrim(event_summary)
    and translate(event_summary, E'\n\r\t', '') !~ '[[:cntrl:]]'
  ),
  constraint abnormal_incidents_immediate_action_check check (
    char_length(immediate_action) between 1 and 2000 and immediate_action = btrim(immediate_action)
    and translate(immediate_action, E'\n\r\t', '') !~ '[[:cntrl:]]'
  ),
  constraint abnormal_incidents_major_state_check
    check (major_state in ('major', 'not_major', 'unclassified')),
  constraint abnormal_incidents_responsible_name_check check (
    char_length(initial_responsible_display_name) between 1 and 120
    and initial_responsible_display_name = btrim(initial_responsible_display_name)
    and initial_responsible_display_name !~ '[[:cntrl:]]'
  ),
  constraint abnormal_incidents_reporter_name_check check (
    char_length(reporter_display_name) between 1 and 120
    and reporter_display_name = btrim(reporter_display_name)
    and reporter_display_name !~ '[[:cntrl:]]'
  ),
  constraint abnormal_incidents_time_check check (occurred_at <= reported_at),
  constraint abnormal_incidents_due_check
    check (initial_improvement_due_date >= (occurred_at at time zone 'Asia/Taipei')::date),
  constraint abnormal_incidents_late_alignment_check check (
    (reported_at - occurred_at > interval '24 hours'
      and late_entry_reason is not null
      and char_length(late_entry_reason) between 1 and 1000
      and late_entry_reason = btrim(late_entry_reason)
      and translate(late_entry_reason, E'\n\r\t', '') !~ '[[:cntrl:]]')
    or (reported_at - occurred_at <= interval '24 hours' and late_entry_reason is null)
  ),
  constraint abnormal_incidents_content_hash_check check (content_hash ~ '^[a-f0-9]{64}$')
);

comment on table public.abnormal_incidents is
  'Immutable page-27 branch abnormal event reports. Type and major state are explicit staff input, not diagnosis.';
comment on column public.abnormal_incidents.affected_target_label_snapshot is
  'Immutable display snapshot. Non-client labels are never used for fuzzy identity matching.';

create index abnormal_incidents_scope_occurred_idx
  on public.abnormal_incidents (organization_id, branch_id, occurred_at desc, id desc);
create index abnormal_incidents_client_idx
  on public.abnormal_incidents (affected_client_id, occurred_at desc)
  where affected_client_id is not null;
create index abnormal_incidents_initial_responsible_membership_idx
  on public.abnormal_incidents (initial_responsible_membership_id);
create index abnormal_incidents_initial_responsible_user_idx
  on public.abnormal_incidents (initial_responsible_user_id);
create index abnormal_incidents_reported_by_idx on public.abnormal_incidents (reported_by);
create index abnormal_incidents_type_filter_idx
  on public.abnormal_incidents (organization_id, branch_id, event_type collate "C");

create table public.abnormal_incident_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  affected_target_kind text not null,
  affected_client_id uuid,
  incident_id uuid not null,
  sequence_number integer not null,
  previous_entry_id uuid,
  entry_type text not null,
  occurred_at timestamptz not null,
  entry_text text,
  notification_target text,
  notification_method text,
  notification_result text,
  responsible_membership_id uuid references public.memberships(id) on delete restrict,
  responsible_user_id uuid references auth.users(id) on delete restrict,
  responsible_display_name text,
  due_date_action text,
  due_date_value date,
  effective_due_date date not null,
  closure_outcome text,
  closure_reason text,
  committed_by uuid not null references auth.users(id) on delete restrict,
  committer_display_name text not null,
  committed_at timestamptz not null default clock_timestamp(),
  closure_reauth_challenge_id uuid references private.reauth_challenges(id) on delete restrict,
  content_hash text not null,
  constraint abnormal_incident_entries_incident_scope_fkey
    foreign key (incident_id, organization_id, branch_id)
    references public.abnormal_incidents(id, organization_id, branch_id) on delete restrict,
  constraint abnormal_incident_entries_client_scope_fkey
    foreign key (affected_client_id, organization_id, branch_id)
    references public.clients(id, organization_id, branch_id) on delete restrict,
  constraint abnormal_incident_entries_id_scope_key
    unique (id, organization_id, branch_id, incident_id),
  constraint abnormal_incident_entries_previous_scope_fkey
    foreign key (previous_entry_id, organization_id, branch_id, incident_id)
    references public.abnormal_incident_entries(id, organization_id, branch_id, incident_id)
    on delete restrict,
  constraint abnormal_incident_entries_sequence_key unique (incident_id, sequence_number),
  constraint abnormal_incident_entries_successor_key
    unique nulls not distinct (incident_id, previous_entry_id),
  constraint abnormal_incident_entries_sequence_check check (sequence_number > 0),
  constraint abnormal_incident_entries_target_kind_check
    check (affected_target_kind in ('client', 'staff', 'visitor', 'facility', 'other')),
  constraint abnormal_incident_entries_target_alignment_check check (
    (affected_target_kind = 'client' and affected_client_id is not null)
    or (affected_target_kind <> 'client' and affected_client_id is null)
  ),
  constraint abnormal_incident_entries_type_check
    check (entry_type in ('manual_notification', 'improvement', 'follow_up', 'closure')),
  constraint abnormal_incident_entries_content_alignment_check check (
    (entry_type = 'manual_notification'
      and entry_text is null
      and notification_target is not null and char_length(notification_target) between 1 and 240
      and notification_target = btrim(notification_target) and notification_target !~ '[[:cntrl:]]'
      and notification_method is not null and char_length(notification_method) between 1 and 120
      and notification_method = btrim(notification_method) and notification_method !~ '[[:cntrl:]]'
      and notification_result is not null and char_length(notification_result) between 1 and 1000
      and notification_result = btrim(notification_result)
      and translate(notification_result, E'\n\r\t', '') !~ '[[:cntrl:]]'
      and responsible_membership_id is null and responsible_user_id is null
      and responsible_display_name is null and due_date_action is null and due_date_value is null
      and closure_outcome is null and closure_reason is null and closure_reauth_challenge_id is null)
    or (entry_type in ('improvement', 'follow_up')
      and entry_text is not null and char_length(entry_text) between 1 and 2000
      and entry_text = btrim(entry_text) and translate(entry_text, E'\n\r\t', '') !~ '[[:cntrl:]]'
      and notification_target is null and notification_method is null and notification_result is null
      and responsible_membership_id is not null and responsible_user_id is not null
      and responsible_display_name is not null and char_length(responsible_display_name) between 1 and 120
      and responsible_display_name = btrim(responsible_display_name)
      and responsible_display_name !~ '[[:cntrl:]]'
      and due_date_action in ('keep', 'replace')
      and ((due_date_action = 'replace' and due_date_value is not null)
        or (due_date_action = 'keep' and due_date_value is null))
      and closure_outcome is null and closure_reason is null and closure_reauth_challenge_id is null)
    or (entry_type = 'closure'
      and entry_text is null and notification_target is null and notification_method is null
      and notification_result is null and responsible_membership_id is null
      and responsible_user_id is null and responsible_display_name is null
      and due_date_action is null and due_date_value is null
      and closure_outcome is not null and char_length(closure_outcome) between 1 and 2000
      and closure_outcome = btrim(closure_outcome)
      and translate(closure_outcome, E'\n\r\t', '') !~ '[[:cntrl:]]'
      and closure_reason is not null and char_length(closure_reason) between 1 and 1000
      and closure_reason = btrim(closure_reason)
      and translate(closure_reason, E'\n\r\t', '') !~ '[[:cntrl:]]'
      and closure_reauth_challenge_id is not null)
  ),
  constraint abnormal_incident_entries_time_check check (occurred_at <= committed_at),
  constraint abnormal_incident_entries_content_hash_check check (content_hash ~ '^[a-f0-9]{64}$')
);

comment on table public.abnormal_incident_entries is
  'Append-only linear evidence: manual notification, improvement, follow-up, closure. Manual notification is not delivery.';

create index abnormal_incident_entries_scope_incident_idx
  on public.abnormal_incident_entries (organization_id, branch_id, incident_id, sequence_number);
create index abnormal_incident_entries_client_idx
  on public.abnormal_incident_entries (affected_client_id, occurred_at desc)
  where affected_client_id is not null;
create index abnormal_incident_entries_previous_idx
  on public.abnormal_incident_entries (previous_entry_id) where previous_entry_id is not null;
create index abnormal_incident_entries_responsible_membership_idx
  on public.abnormal_incident_entries (responsible_membership_id)
  where responsible_membership_id is not null;
create index abnormal_incident_entries_responsible_user_idx
  on public.abnormal_incident_entries (responsible_user_id)
  where responsible_user_id is not null;
create index abnormal_incident_entries_committed_by_idx on public.abnormal_incident_entries (committed_by);
create index abnormal_incident_entries_reauth_idx
  on public.abnormal_incident_entries (closure_reauth_challenge_id)
  where closure_reauth_challenge_id is not null;

create table private.abnormal_event_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  affected_target_kind text not null,
  affected_client_id uuid,
  incident_id uuid not null,
  entry_id uuid,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  operation_kind text not null,
  idempotency_key uuid not null,
  request_hash text not null,
  result_chain_version integer not null,
  result_status text not null,
  result_responsible_membership_id uuid not null references public.memberships(id) on delete restrict,
  result_effective_due_date date not null,
  result_committed_at timestamptz not null,
  reauth_challenge_id uuid references private.reauth_challenges(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  constraint abnormal_event_operations_incident_scope_fkey
    foreign key (incident_id, organization_id, branch_id)
    references public.abnormal_incidents(id, organization_id, branch_id) on delete restrict,
  constraint abnormal_event_operations_entry_scope_fkey
    foreign key (entry_id, organization_id, branch_id, incident_id)
    references public.abnormal_incident_entries(id, organization_id, branch_id, incident_id)
    on delete restrict,
  constraint abnormal_event_operations_actor_key unique (actor_user_id, idempotency_key),
  constraint abnormal_event_operations_target_kind_check
    check (affected_target_kind in ('client', 'staff', 'visitor', 'facility', 'other')),
  constraint abnormal_event_operations_target_alignment_check check (
    (affected_target_kind = 'client' and affected_client_id is not null)
    or (affected_target_kind <> 'client' and affected_client_id is null)
  ),
  constraint abnormal_event_operations_kind_check
    check (operation_kind in ('report', 'manual_notification', 'improvement', 'follow_up', 'close')),
  constraint abnormal_event_operations_status_check
    check (result_status in ('reported', 'in_progress', 'closed')),
  constraint abnormal_event_operations_result_check check (
    (operation_kind = 'report' and entry_id is null and result_chain_version = 0
      and result_status = 'reported' and reauth_challenge_id is null)
    or (operation_kind in ('manual_notification', 'improvement', 'follow_up')
      and entry_id is not null and result_chain_version > 0
      and result_status = 'in_progress' and reauth_challenge_id is null)
    or (operation_kind = 'close' and entry_id is not null and result_chain_version > 0
      and result_status = 'closed' and reauth_challenge_id is not null)
  ),
  constraint abnormal_event_operations_request_hash_check check (request_hash ~ '^[a-f0-9]{64}$')
);

create index abnormal_event_operations_scope_incident_idx
  on private.abnormal_event_operations (organization_id, branch_id, incident_id, created_at desc);
create index abnormal_event_operations_client_idx
  on private.abnormal_event_operations (affected_client_id, created_at desc)
  where affected_client_id is not null;
create index abnormal_event_operations_entry_idx
  on private.abnormal_event_operations (entry_id) where entry_id is not null;
create index abnormal_event_operations_responsible_idx
  on private.abnormal_event_operations (result_responsible_membership_id);
create index abnormal_event_operations_reauth_idx
  on private.abnormal_event_operations (reauth_challenge_id) where reauth_challenge_id is not null;

alter table public.abnormal_incidents enable row level security;
alter table public.abnormal_incidents force row level security;
alter table public.abnormal_incident_entries enable row level security;
alter table public.abnormal_incident_entries force row level security;

revoke all on table public.abnormal_incidents from public, anon, authenticated, service_role;
revoke all on table public.abnormal_incident_entries from public, anon, authenticated, service_role;
revoke all on table private.abnormal_event_operations from public, anon, authenticated, service_role;

create policy abnormal_incidents_staff_select on public.abnormal_incidents for select
using (
  (affected_target_kind = 'client'
    and (select private.can_staff_access_client(affected_client_id, 'clients.read'))
    and (select private.can_staff_access_client(affected_client_id, 'quality_events.read')))
  or (affected_target_kind <> 'client'
    and (select private.has_permission(organization_id, branch_id, 'clients.read'))
    and (select private.has_permission(organization_id, branch_id, 'quality_events.read')))
);

create policy abnormal_incident_entries_staff_select on public.abnormal_incident_entries for select
using (
  (affected_target_kind = 'client'
    and (select private.can_staff_access_client(affected_client_id, 'clients.read'))
    and (select private.can_staff_access_client(affected_client_id, 'quality_events.read')))
  or (affected_target_kind <> 'client'
    and (select private.has_permission(organization_id, branch_id, 'clients.read'))
    and (select private.has_permission(organization_id, branch_id, 'quality_events.read')))
);

create or replace function private.prevent_abnormal_history_mutation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  raise exception using errcode = '55000', message = 'abnormal event history is immutable';
end;
$$;

create trigger abnormal_incidents_immutable
before update or delete on public.abnormal_incidents
for each row execute function private.prevent_abnormal_history_mutation();
create trigger abnormal_incident_entries_immutable
before update or delete on public.abnormal_incident_entries
for each row execute function private.prevent_abnormal_history_mutation();
create trigger abnormal_event_operations_immutable
before update or delete on private.abnormal_event_operations
for each row execute function private.prevent_abnormal_history_mutation();

create trigger abnormal_incidents_audit_row_change
after insert or update or delete on public.abnormal_incidents
for each row execute function private.audit_row_change();
create trigger abnormal_incident_entries_audit_row_change
after insert or update or delete on public.abnormal_incident_entries
for each row execute function private.audit_row_change();
create trigger abnormal_event_operations_audit_row_change
after insert or update or delete on private.abnormal_event_operations
for each row execute function private.audit_row_change();

create or replace function private.abnormal_scope_allowed(
  p_organization_id uuid,
  p_branch_id uuid,
  p_target_kind text,
  p_client_id uuid,
  p_permission_key text
)
returns boolean language sql stable security definer set search_path = '' as $$
  select
    auth.uid() is not null
    and p_organization_id is not null
    and p_branch_id is not null
    and exists (
      select 1
      from public.branches branch
      where branch.id = p_branch_id
        and branch.organization_id = p_organization_id
        and branch.is_active
    )
    and p_target_kind in ('client', 'staff', 'visitor', 'facility', 'other')
    and ((p_target_kind = 'client') = (p_client_id is not null))
    and (
      (p_target_kind = 'client'
        and exists (
          select 1 from public.clients client
          where client.id = p_client_id
            and client.organization_id = p_organization_id
            and client.branch_id = p_branch_id
        )
        and private.can_staff_access_client(p_client_id, 'clients.read')
        and private.can_staff_access_client(p_client_id, p_permission_key))
      or (p_target_kind <> 'client'
        and private.has_permission(p_organization_id, p_branch_id, 'clients.read')
        and private.has_permission(p_organization_id, p_branch_id, p_permission_key))
    );
$$;

create or replace function private.resolve_abnormal_responsible(
  p_organization_id uuid,
  p_branch_id uuid,
  p_membership_id uuid,
  p_reference_time timestamptz
)
returns table(membership_id uuid, user_id uuid, display_name text)
language sql stable security definer set search_path = '' as $$
  select membership.id, profile.id, btrim(profile.display_name)
  from public.memberships membership
  join public.profiles profile on profile.id = membership.profile_id
  where membership.id = p_membership_id
    and membership.organization_id = p_organization_id
    and (membership.branch_id is null or membership.branch_id = p_branch_id)
    and membership.status = 'active'
    and membership.starts_at <= p_reference_time
    and (membership.ends_at is null or membership.ends_at > p_reference_time)
    and profile.is_active
    and profile.kind = 'staff'
    and char_length(btrim(profile.display_name)) between 1 and 120;
$$;

create or replace function private.require_abnormal_closure_reauth(
  p_actor uuid,
  p_reference_time timestamptz
)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare
  v_session_id uuid;
  v_challenge_id uuid;
begin
  if p_actor is null or p_actor <> auth.uid()
     or coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not private.has_recent_aal2(15) then
    raise exception using errcode = '42501',
      message = 'current same-session recent AAL2 evidence is required to close an abnormal incident';
  end if;
  begin
    v_session_id := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode = '42501',
      message = 'current same-session recent AAL2 evidence is required to close an abnormal incident';
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
    raise exception using errcode = '42501',
      message = 'current same-session recent AAL2 evidence is required to close an abnormal incident';
  end if;
  return v_challenge_id;
end;
$$;

create or replace function private.report_abnormal_event_atomic(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_affected_target_kind text,
  p_affected_client_id uuid,
  p_affected_target_label text,
  p_occurred_at timestamptz,
  p_location text,
  p_event_type text,
  p_event_summary text,
  p_immediate_action text,
  p_major_state text,
  p_responsible_membership_id uuid,
  p_improvement_due_date date,
  p_late_entry_reason text,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid,
  incident_id uuid,
  entry_id uuid,
  operation_kind text,
  affected_target_kind text,
  affected_client_id uuid,
  chain_version integer,
  handling_status text,
  responsible_membership_id uuid,
  effective_due_date date,
  committed_at timestamptz,
  replayed boolean
)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_kind text := lower(nullif(btrim(p_affected_target_kind), ''));
  v_label text := nullif(btrim(p_affected_target_label), '');
  v_location text := nullif(btrim(p_location), '');
  v_type text := nullif(btrim(p_event_type), '');
  v_summary text := nullif(btrim(p_event_summary), '');
  v_immediate text := nullif(btrim(p_immediate_action), '');
  v_major text := lower(nullif(btrim(p_major_state), ''));
  v_late_reason text := nullif(btrim(p_late_entry_reason), '');
  v_actor_name text;
  v_responsible record;
  v_request_hash text;
  v_content_hash text;
  v_client public.clients%rowtype;
  v_incident public.abnormal_incidents%rowtype;
  v_operation private.abnormal_event_operations%rowtype;
begin
  if v_actor is null or coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception using errcode = '42501', message = 'abnormal incident scope is not permitted';
  end if;
  if p_expected_organization_id is null or p_expected_branch_id is null
     or v_kind not in ('client', 'staff', 'visitor', 'facility', 'other')
     or ((v_kind = 'client') <> (p_affected_client_id is not null))
     or ((v_kind = 'client') = (v_label is not null))
     or p_occurred_at is null or p_occurred_at > v_now
     or v_location is null or char_length(v_location) > 240 or v_location ~ '[[:cntrl:]]'
     or v_type is null or char_length(v_type) > 240 or v_type ~ '[[:cntrl:]]'
     or v_summary is null or char_length(v_summary) > 2000
     or translate(v_summary, E'\n\r\t', '') ~ '[[:cntrl:]]'
     or v_immediate is null or char_length(v_immediate) > 2000
     or translate(v_immediate, E'\n\r\t', '') ~ '[[:cntrl:]]'
     or v_major not in ('major', 'not_major', 'unclassified')
     or p_responsible_membership_id is null or p_improvement_due_date is null
     or p_improvement_due_date < (p_occurred_at at time zone 'Asia/Taipei')::date
     or p_idempotency_key is null
     or (v_label is not null and (char_length(v_label) > 240 or v_label ~ '[[:cntrl:]]'))
     or (v_late_reason is not null and (char_length(v_late_reason) > 1000
       or translate(v_late_reason, E'\n\r\t', '') ~ '[[:cntrl:]]')) then
    raise exception using errcode = '22023', message = 'invalid abnormal incident report';
  end if;

  select btrim(profile.display_name) into v_actor_name
  from public.profiles profile
  where profile.id = v_actor and profile.is_active and profile.kind = 'staff';
  if v_actor_name is null
     or not exists (select 1 from public.branches branch
       where branch.id = p_expected_branch_id
         and branch.organization_id = p_expected_organization_id and branch.is_active)
     or not private.abnormal_scope_allowed(p_expected_organization_id, p_expected_branch_id,
       v_kind, p_affected_client_id, 'quality_events.manage') then
    raise exception using errcode = '42501', message = 'abnormal incident scope is not permitted';
  end if;

  v_request_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version', 1, 'operation', 'report', 'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id, 'affected_target_kind', v_kind,
    'affected_client_id', p_affected_client_id, 'affected_target_label', v_label,
    'actor_user_id', v_actor, 'occurred_at', p_occurred_at, 'location', v_location,
    'event_type', v_type, 'event_summary', v_summary, 'immediate_action', v_immediate,
    'major_state', v_major, 'responsible_membership_id', p_responsible_membership_id,
    'improvement_due_date', p_improvement_due_date, 'late_entry_reason', v_late_reason
  )::text, 'UTF8')), 'hex');

  perform pg_advisory_xact_lock(hashtextextended(
    'abnormal-event-operation:' || v_actor::text || ':' || p_idempotency_key::text, 0));
  select operation.* into v_operation
  from private.abnormal_event_operations operation
  where operation.actor_user_id = v_actor and operation.idempotency_key = p_idempotency_key;
  if found then
    if v_operation.operation_kind <> 'report'
       or v_operation.organization_id <> p_expected_organization_id
       or v_operation.branch_id <> p_expected_branch_id
       or v_operation.affected_target_kind <> v_kind
       or v_operation.affected_client_id is distinct from p_affected_client_id
       or v_operation.request_hash <> v_request_hash then
      raise exception using errcode = '23505', message = 'abnormal incident idempotency conflict';
    end if;
    if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
       or not private.abnormal_scope_allowed(p_expected_organization_id, p_expected_branch_id,
         v_kind, p_affected_client_id, 'quality_events.manage')
       or not exists (select 1 from public.abnormal_incidents incident
         where incident.id = v_operation.incident_id
           and incident.organization_id = p_expected_organization_id
           and incident.branch_id = p_expected_branch_id
           and incident.affected_target_kind = v_kind
           and incident.affected_client_id is not distinct from p_affected_client_id) then
      raise exception using errcode = '42501', message = 'abnormal incident replay is not permitted';
    end if;
    return query select v_operation.id, v_operation.incident_id, v_operation.entry_id,
      v_operation.operation_kind, v_operation.affected_target_kind,
      v_operation.affected_client_id, v_operation.result_chain_version,
      v_operation.result_status, v_operation.result_responsible_membership_id,
      v_operation.result_effective_due_date, v_operation.result_committed_at, true;
    return;
  end if;

  if v_kind = 'client' then
    select client.* into v_client from public.clients client
    where client.id = p_affected_client_id
      and client.organization_id = p_expected_organization_id
      and client.branch_id = p_expected_branch_id
    for share;
    if not found or v_client.status <> 'active' or v_client.admitted_on is null
       or (p_occurred_at at time zone 'Asia/Taipei')::date < v_client.admitted_on
       or (v_client.ended_on is not null
         and (p_occurred_at at time zone 'Asia/Taipei')::date > v_client.ended_on) then
      raise exception using errcode = '42501', message = 'active client period is not permitted';
    end if;
    v_label := btrim(v_client.display_name);
  end if;

  select * into v_responsible from private.resolve_abnormal_responsible(
    p_expected_organization_id, p_expected_branch_id, p_responsible_membership_id, clock_timestamp());
  if v_responsible.membership_id is null then
    raise exception using errcode = '42501', message = 'responsible membership is not active in scope';
  end if;

  v_now := clock_timestamp();
  if p_occurred_at > v_now
     or ((v_now - p_occurred_at > interval '24 hours') <> (v_late_reason is not null)) then
    raise exception using errcode = '22023', message = 'late-entry evidence does not match the final server time';
  end if;
  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not private.abnormal_scope_allowed(p_expected_organization_id, p_expected_branch_id,
       v_kind, p_affected_client_id, 'quality_events.manage') then
    raise exception using errcode = '42501', message = 'abnormal incident authority expired';
  end if;

  v_content_hash := encode(sha256(convert_to(jsonb_build_object(
    'content_hash_version', 1, 'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id, 'affected_target_kind', v_kind,
    'affected_client_id', p_affected_client_id, 'affected_target_label_snapshot', v_label,
    'occurred_at', p_occurred_at, 'location', v_location, 'event_type', v_type,
    'event_summary', v_summary, 'immediate_action', v_immediate, 'major_state', v_major,
    'responsible_membership_id', v_responsible.membership_id,
    'responsible_user_id', v_responsible.user_id,
    'responsible_display_name', v_responsible.display_name,
    'improvement_due_date', p_improvement_due_date, 'late_entry_reason', v_late_reason,
    'reported_by', v_actor, 'reporter_display_name', v_actor_name, 'reported_at', v_now
  )::text, 'UTF8')), 'hex');

  insert into public.abnormal_incidents (
    organization_id, branch_id, affected_target_kind, affected_client_id,
    affected_target_label_snapshot, occurred_at, location, event_type, event_summary,
    immediate_action, major_state, initial_responsible_membership_id,
    initial_responsible_user_id, initial_responsible_display_name,
    initial_improvement_due_date, late_entry_reason, reported_by,
    reporter_display_name, reported_at, content_hash
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_kind, p_affected_client_id,
    v_label, p_occurred_at, v_location, v_type, v_summary, v_immediate, v_major,
    v_responsible.membership_id, v_responsible.user_id, v_responsible.display_name,
    p_improvement_due_date, v_late_reason, v_actor, v_actor_name, v_now, v_content_hash
  ) returning * into v_incident;

  insert into private.abnormal_event_operations (
    organization_id, branch_id, affected_target_kind, affected_client_id,
    incident_id, entry_id, actor_user_id, operation_kind, idempotency_key,
    request_hash, result_chain_version, result_status,
    result_responsible_membership_id, result_effective_due_date,
    result_committed_at, reauth_challenge_id
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_kind, p_affected_client_id,
    v_incident.id, null, v_actor, 'report', p_idempotency_key, v_request_hash,
    0, 'reported', v_responsible.membership_id, p_improvement_due_date,
    v_incident.reported_at, null
  ) returning * into v_operation;

  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not private.abnormal_scope_allowed(p_expected_organization_id, p_expected_branch_id,
       v_kind, p_affected_client_id, 'quality_events.manage') then
    raise exception using errcode = '42501', message = 'abnormal incident final authority expired';
  end if;

  return query select v_operation.id, v_operation.incident_id, v_operation.entry_id,
    v_operation.operation_kind, v_operation.affected_target_kind,
    v_operation.affected_client_id, v_operation.result_chain_version,
    v_operation.result_status, v_operation.result_responsible_membership_id,
    v_operation.result_effective_due_date, v_operation.result_committed_at, false;
end;
$$;

create or replace function private.append_abnormal_event_entry_atomic(
  p_operation_kind text,
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_affected_target_kind text,
  p_affected_client_id uuid,
  p_incident_id uuid,
  p_occurred_at timestamptz,
  p_entry_text text,
  p_notification_target text,
  p_notification_method text,
  p_notification_result text,
  p_responsible_membership_id uuid,
  p_due_date_action text,
  p_due_date_value date,
  p_closure_outcome text,
  p_closure_reason text,
  p_expected_chain_version integer,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid,
  incident_id uuid,
  entry_id uuid,
  operation_kind text,
  affected_target_kind text,
  affected_client_id uuid,
  chain_version integer,
  handling_status text,
  responsible_membership_id uuid,
  effective_due_date date,
  committed_at timestamptz,
  replayed boolean
)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_kind text := lower(nullif(btrim(p_operation_kind), ''));
  v_target_kind text := lower(nullif(btrim(p_affected_target_kind), ''));
  v_entry_type text;
  v_permission text;
  v_text text := nullif(btrim(p_entry_text), '');
  v_notification_target text := nullif(btrim(p_notification_target), '');
  v_notification_method text := nullif(btrim(p_notification_method), '');
  v_notification_result text := nullif(btrim(p_notification_result), '');
  v_due_action text := lower(nullif(btrim(p_due_date_action), ''));
  v_outcome text := nullif(btrim(p_closure_outcome), '');
  v_reason text := nullif(btrim(p_closure_reason), '');
  v_actor_name text;
  v_request_hash text;
  v_content_hash text;
  v_reauth_challenge_id uuid;
  v_incident public.abnormal_incidents%rowtype;
  v_previous public.abnormal_incident_entries%rowtype;
  v_entry public.abnormal_incident_entries%rowtype;
  v_operation private.abnormal_event_operations%rowtype;
  v_responsible record;
  v_current_version integer;
  v_current_responsible_membership_id uuid;
  v_current_responsible_user_id uuid;
  v_current_responsible_display_name text;
  v_current_due_date date;
begin
  if v_actor is null or coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception using errcode = '42501', message = 'abnormal incident timeline scope is not permitted';
  end if;
  if p_expected_organization_id is null or p_expected_branch_id is null
     or v_target_kind not in ('client', 'staff', 'visitor', 'facility', 'other')
     or ((v_target_kind = 'client') <> (p_affected_client_id is not null))
     or p_incident_id is null or p_occurred_at is null
     or p_expected_chain_version is null or p_expected_chain_version < 0
     or p_idempotency_key is null or p_occurred_at > v_now
     or v_kind not in ('manual_notification', 'improvement', 'follow_up', 'close') then
    raise exception using errcode = '22023', message = 'invalid abnormal incident timeline entry';
  end if;

  if v_kind = 'manual_notification' then
    v_entry_type := 'manual_notification';
    v_permission := 'quality_events.manage';
    if v_notification_target is null or char_length(v_notification_target) > 240
       or v_notification_target ~ '[[:cntrl:]]'
       or v_notification_method is null or char_length(v_notification_method) > 120
       or v_notification_method ~ '[[:cntrl:]]'
       or v_notification_result is null or char_length(v_notification_result) > 1000
       or translate(v_notification_result, E'\n\r\t', '') ~ '[[:cntrl:]]'
       or v_text is not null or p_responsible_membership_id is not null
       or v_due_action is not null or p_due_date_value is not null
       or v_outcome is not null or v_reason is not null then
      raise exception using errcode = '22023', message = 'manual notification evidence is invalid';
    end if;
  elsif v_kind in ('improvement', 'follow_up') then
    v_entry_type := v_kind;
    v_permission := 'quality_events.manage';
    if v_text is null or char_length(v_text) > 2000
       or translate(v_text, E'\n\r\t', '') ~ '[[:cntrl:]]'
       or p_responsible_membership_id is null
       or v_due_action not in ('keep', 'replace')
       or ((v_due_action = 'replace') <> (p_due_date_value is not null))
       or v_notification_target is not null or v_notification_method is not null
       or v_notification_result is not null or v_outcome is not null or v_reason is not null then
      raise exception using errcode = '22023', message = 'improvement or follow-up evidence is invalid';
    end if;
  else
    v_entry_type := 'closure';
    v_permission := 'quality_events.close';
    if v_outcome is null or char_length(v_outcome) > 2000
       or translate(v_outcome, E'\n\r\t', '') ~ '[[:cntrl:]]'
       or v_reason is null or char_length(v_reason) > 1000
       or translate(v_reason, E'\n\r\t', '') ~ '[[:cntrl:]]'
       or v_text is not null or v_notification_target is not null
       or v_notification_method is not null or v_notification_result is not null
       or p_responsible_membership_id is not null
       or v_due_action is not null or p_due_date_value is not null then
      raise exception using errcode = '22023', message = 'closure outcome and reason are required';
    end if;
  end if;

  select btrim(profile.display_name) into v_actor_name
  from public.profiles profile
  where profile.id = v_actor and profile.is_active and profile.kind = 'staff';
  if v_actor_name is null
     or not exists (select 1 from public.branches branch
       where branch.id = p_expected_branch_id
         and branch.organization_id = p_expected_organization_id and branch.is_active)
     or not private.abnormal_scope_allowed(p_expected_organization_id, p_expected_branch_id,
       v_target_kind, p_affected_client_id, v_permission) then
    raise exception using errcode = '42501', message = 'abnormal incident timeline scope is not permitted';
  end if;

  v_request_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version', 1, 'operation', v_kind, 'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id, 'affected_target_kind', v_target_kind,
    'affected_client_id', p_affected_client_id, 'incident_id', p_incident_id,
    'actor_user_id', v_actor, 'occurred_at', p_occurred_at, 'entry_text', v_text,
    'notification_target', v_notification_target, 'notification_method', v_notification_method,
    'notification_result', v_notification_result,
    'responsible_membership_id', p_responsible_membership_id,
    'due_date_action', v_due_action, 'due_date_value', p_due_date_value,
    'closure_outcome', v_outcome, 'closure_reason', v_reason,
    'expected_chain_version', p_expected_chain_version
  )::text, 'UTF8')), 'hex');

  perform pg_advisory_xact_lock(hashtextextended(
    'abnormal-event-operation:' || v_actor::text || ':' || p_idempotency_key::text, 0));
  select operation.* into v_operation
  from private.abnormal_event_operations operation
  where operation.actor_user_id = v_actor and operation.idempotency_key = p_idempotency_key;
  if found then
    if v_operation.operation_kind <> v_kind
       or v_operation.organization_id <> p_expected_organization_id
       or v_operation.branch_id <> p_expected_branch_id
       or v_operation.affected_target_kind <> v_target_kind
       or v_operation.affected_client_id is distinct from p_affected_client_id
       or v_operation.incident_id <> p_incident_id
       or v_operation.request_hash <> v_request_hash then
      raise exception using errcode = '23505', message = 'abnormal timeline idempotency conflict';
    end if;
    if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
       or not private.abnormal_scope_allowed(p_expected_organization_id, p_expected_branch_id,
         v_target_kind, p_affected_client_id, v_permission)
       or not exists (select 1 from public.abnormal_incidents incident
         where incident.id = p_incident_id
           and incident.organization_id = p_expected_organization_id
           and incident.branch_id = p_expected_branch_id
           and incident.affected_target_kind = v_target_kind
           and incident.affected_client_id is not distinct from p_affected_client_id) then
      raise exception using errcode = '42501', message = 'abnormal timeline replay is not permitted';
    end if;
    if v_kind = 'close' then
      perform private.require_abnormal_closure_reauth(v_actor, clock_timestamp());
    end if;
    return query select v_operation.id, v_operation.incident_id, v_operation.entry_id,
      v_operation.operation_kind, v_operation.affected_target_kind,
      v_operation.affected_client_id, v_operation.result_chain_version,
      v_operation.result_status, v_operation.result_responsible_membership_id,
      v_operation.result_effective_due_date, v_operation.result_committed_at, true;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'abnormal-event-chain:' || p_expected_organization_id::text || ':' ||
      p_expected_branch_id::text || ':' || p_incident_id::text, 0));
  select incident.* into v_incident
  from public.abnormal_incidents incident
  where incident.id = p_incident_id
    and incident.organization_id = p_expected_organization_id
    and incident.branch_id = p_expected_branch_id
    and incident.affected_target_kind = v_target_kind
    and incident.affected_client_id is not distinct from p_affected_client_id
  for update;
  if not found
     or not private.abnormal_scope_allowed(p_expected_organization_id, p_expected_branch_id,
       v_target_kind, p_affected_client_id, v_permission) then
    raise exception using errcode = '42501', message = 'abnormal incident timeline scope is not permitted';
  end if;

  select entry.* into v_previous
  from public.abnormal_incident_entries entry
  where entry.incident_id = p_incident_id
    and entry.organization_id = p_expected_organization_id
    and entry.branch_id = p_expected_branch_id
  order by entry.sequence_number desc limit 1 for update;
  v_current_version := coalesce(v_previous.sequence_number, 0);
  if v_current_version <> p_expected_chain_version then
    raise exception using errcode = '40001', message = 'abnormal incident chain version conflict';
  end if;
  if p_occurred_at < coalesce(v_previous.occurred_at, v_incident.occurred_at) then
    raise exception using errcode = '22023', message = 'timeline entry cannot predate incident or prior entry';
  end if;
  if v_previous.entry_type = 'closure' then
    raise exception using errcode = '23514', message = 'closed abnormal incident history cannot be extended';
  end if;

  v_current_responsible_membership_id := v_incident.initial_responsible_membership_id;
  v_current_responsible_user_id := v_incident.initial_responsible_user_id;
  v_current_responsible_display_name := v_incident.initial_responsible_display_name;
  select entry.responsible_membership_id, entry.responsible_user_id, entry.responsible_display_name
  into v_current_responsible_membership_id, v_current_responsible_user_id,
    v_current_responsible_display_name
  from public.abnormal_incident_entries entry
  where entry.incident_id = p_incident_id
    and entry.entry_type in ('improvement', 'follow_up')
  order by entry.sequence_number desc limit 1;
  if not found then
    v_current_responsible_membership_id := v_incident.initial_responsible_membership_id;
    v_current_responsible_user_id := v_incident.initial_responsible_user_id;
    v_current_responsible_display_name := v_incident.initial_responsible_display_name;
  end if;
  select entry.effective_due_date into v_current_due_date
  from public.abnormal_incident_entries entry
  where entry.incident_id = p_incident_id
  order by entry.sequence_number desc limit 1;
  if not found then v_current_due_date := v_incident.initial_improvement_due_date; end if;

  if v_kind in ('improvement', 'follow_up') then
    select * into v_responsible from private.resolve_abnormal_responsible(
      p_expected_organization_id, p_expected_branch_id, p_responsible_membership_id,
      clock_timestamp());
    if v_responsible.membership_id is null then
      raise exception using errcode = '42501', message = 'responsible membership is not active in scope';
    end if;
    v_current_responsible_membership_id := v_responsible.membership_id;
    v_current_responsible_user_id := v_responsible.user_id;
    v_current_responsible_display_name := v_responsible.display_name;
    if v_due_action = 'replace' then v_current_due_date := p_due_date_value; end if;
    if v_current_due_date < (v_incident.occurred_at at time zone 'Asia/Taipei')::date then
      raise exception using errcode = '22023', message = 'improvement due date cannot predate incident';
    end if;
  end if;

  v_now := clock_timestamp();
  if p_occurred_at > v_now then
    raise exception using errcode = '22023', message = 'timeline entry cannot be in the future';
  end if;
  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not private.abnormal_scope_allowed(p_expected_organization_id, p_expected_branch_id,
       v_target_kind, p_affected_client_id, v_permission) then
    raise exception using errcode = '42501', message = 'abnormal timeline authority expired';
  end if;
  if v_kind = 'close' then
    v_reauth_challenge_id := private.require_abnormal_closure_reauth(v_actor, v_now);
  end if;

  v_content_hash := encode(sha256(convert_to(jsonb_build_object(
    'content_hash_version', 1, 'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id, 'affected_target_kind', v_target_kind,
    'affected_client_id', p_affected_client_id, 'incident_id', p_incident_id,
    'sequence_number', v_current_version + 1, 'previous_entry_id', v_previous.id,
    'entry_type', v_entry_type, 'occurred_at', p_occurred_at, 'entry_text', v_text,
    'notification_target', v_notification_target, 'notification_method', v_notification_method,
    'notification_result', v_notification_result,
    'responsible_membership_id', case when v_kind in ('improvement', 'follow_up')
      then v_current_responsible_membership_id else null end,
    'responsible_user_id', case when v_kind in ('improvement', 'follow_up')
      then v_current_responsible_user_id else null end,
    'responsible_display_name', case when v_kind in ('improvement', 'follow_up')
      then v_current_responsible_display_name else null end,
    'due_date_action', v_due_action, 'due_date_value', p_due_date_value,
    'effective_due_date', v_current_due_date, 'closure_outcome', v_outcome,
    'closure_reason', v_reason, 'committed_by', v_actor,
    'committer_display_name', v_actor_name, 'committed_at', v_now,
    'closure_reauth_challenge_id', v_reauth_challenge_id
  )::text, 'UTF8')), 'hex');

  insert into public.abnormal_incident_entries (
    organization_id, branch_id, affected_target_kind, affected_client_id,
    incident_id, sequence_number, previous_entry_id, entry_type, occurred_at,
    entry_text, notification_target, notification_method, notification_result,
    responsible_membership_id, responsible_user_id, responsible_display_name,
    due_date_action, due_date_value, effective_due_date, closure_outcome,
    closure_reason, committed_by, committer_display_name, committed_at,
    closure_reauth_challenge_id, content_hash
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_target_kind,
    p_affected_client_id, p_incident_id, v_current_version + 1, v_previous.id,
    v_entry_type, p_occurred_at, v_text, v_notification_target,
    v_notification_method, v_notification_result,
    case when v_kind in ('improvement', 'follow_up') then v_current_responsible_membership_id end,
    case when v_kind in ('improvement', 'follow_up') then v_current_responsible_user_id end,
    case when v_kind in ('improvement', 'follow_up') then v_current_responsible_display_name end,
    v_due_action, p_due_date_value, v_current_due_date, v_outcome, v_reason,
    v_actor, v_actor_name, v_now, v_reauth_challenge_id, v_content_hash
  ) returning * into v_entry;

  insert into private.abnormal_event_operations (
    organization_id, branch_id, affected_target_kind, affected_client_id,
    incident_id, entry_id, actor_user_id, operation_kind, idempotency_key,
    request_hash, result_chain_version, result_status,
    result_responsible_membership_id, result_effective_due_date,
    result_committed_at, reauth_challenge_id
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_target_kind,
    p_affected_client_id, p_incident_id, v_entry.id, v_actor, v_kind,
    p_idempotency_key, v_request_hash, v_entry.sequence_number,
    case when v_kind = 'close' then 'closed' else 'in_progress' end,
    v_current_responsible_membership_id, v_current_due_date,
    v_entry.committed_at, v_reauth_challenge_id
  ) returning * into v_operation;

  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not private.abnormal_scope_allowed(p_expected_organization_id, p_expected_branch_id,
       v_target_kind, p_affected_client_id, v_permission) then
    raise exception using errcode = '42501', message = 'abnormal timeline final authority expired';
  end if;
  if v_kind = 'close' then
    perform private.require_abnormal_closure_reauth(v_actor, clock_timestamp());
  end if;

  return query select v_operation.id, v_operation.incident_id, v_operation.entry_id,
    v_operation.operation_kind, v_operation.affected_target_kind,
    v_operation.affected_client_id, v_operation.result_chain_version,
    v_operation.result_status, v_operation.result_responsible_membership_id,
    v_operation.result_effective_due_date, v_operation.result_committed_at, false;
end;
$$;

create or replace function private.abnormal_event_snapshot_core(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_date_from date default null,
  p_date_to date default null,
  p_event_type text default null,
  p_affected_target_kind text default 'all',
  p_handling_status text default 'all'
)
returns table(
  organization_id uuid,
  branch_id uuid,
  generated_at timestamptz,
  items jsonb,
  item_total bigint,
  matching_total bigint,
  major_total bigint,
  awaiting_improvement_total bigint,
  overdue_total bigint,
  closed_total bigint,
  items_truncated boolean,
  client_options jsonb,
  client_options_available_total bigint,
  client_options_truncated boolean,
  responsible_options jsonb,
  responsible_options_available_total bigint,
  responsible_options_truncated boolean,
  event_type_options jsonb,
  event_type_options_available_total bigint,
  event_type_options_truncated boolean,
  event_taxonomy_status text,
  major_criteria_status text,
  legal_reporting_status text,
  delivery_integration_status text
)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_generated_at timestamptz := clock_timestamp();
  v_event_type text := nullif(btrim(p_event_type), '');
  v_target_kind text := lower(coalesce(nullif(btrim(p_affected_target_kind), ''), 'all'));
  v_status text := lower(coalesce(nullif(btrim(p_handling_status), ''), 'all'));
  v_items jsonb;
  v_item_total bigint;
  v_matching_total bigint;
  v_major_total bigint;
  v_awaiting_total bigint;
  v_overdue_total bigint;
  v_closed_total bigint;
  v_client_options jsonb;
  v_client_available bigint;
  v_responsible_options jsonb;
  v_responsible_available bigint;
  v_type_options jsonb;
  v_type_available bigint;
begin
  if v_actor is null or p_expected_organization_id is null or p_expected_branch_id is null
     or coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or (p_date_from is not null and p_date_to is not null and p_date_from > p_date_to)
     or v_target_kind not in ('all', 'client', 'staff', 'visitor', 'facility', 'other')
     or v_status not in ('all', 'reported', 'in_progress', 'closed')
     or (v_event_type is not null and (char_length(v_event_type) > 240
       or v_event_type ~ '[[:cntrl:]]'))
     or not exists (select 1 from public.branches branch
       where branch.id = p_expected_branch_id
         and branch.organization_id = p_expected_organization_id and branch.is_active)
     or not private.has_permission(p_expected_organization_id, p_expected_branch_id, 'clients.read')
     or not private.has_permission(p_expected_organization_id, p_expected_branch_id, 'quality_events.read') then
    raise exception using errcode = '42501', message = 'abnormal incident snapshot is not permitted';
  end if;

  with accessible as (
    select incident.*,
      coalesce(timeline.timeline_total, 0)::integer as timeline_total,
      timeline.last_entry_type,
      coalesce(timeline.last_committed_at, incident.reported_at) as last_activity_at,
      coalesce(latest_responsible.responsible_membership_id,
        incident.initial_responsible_membership_id) as current_responsible_membership_id,
      coalesce(latest_responsible.responsible_user_id,
        incident.initial_responsible_user_id) as current_responsible_user_id,
      coalesce(latest_responsible.responsible_display_name,
        incident.initial_responsible_display_name) as current_responsible_display_name,
      coalesce(timeline.last_effective_due_date,
        incident.initial_improvement_due_date) as current_improvement_due_date,
      case when timeline.last_entry_type = 'closure' then 'closed'
        when coalesce(timeline.timeline_total, 0) > 0 then 'in_progress'
        else 'reported' end as handling_status
    from public.abnormal_incidents incident
    left join lateral (
      select count(*)::integer as timeline_total,
        (array_agg(entry.entry_type order by entry.sequence_number desc))[1] as last_entry_type,
        (array_agg(entry.effective_due_date order by entry.sequence_number desc))[1]
          as last_effective_due_date,
        (array_agg(entry.committed_at order by entry.sequence_number desc))[1]
          as last_committed_at
      from public.abnormal_incident_entries entry
      where entry.incident_id = incident.id
        and entry.organization_id = incident.organization_id
        and entry.branch_id = incident.branch_id
    ) timeline on true
    left join lateral (
      select entry.responsible_membership_id, entry.responsible_user_id,
        entry.responsible_display_name
      from public.abnormal_incident_entries entry
      where entry.incident_id = incident.id
        and entry.entry_type in ('improvement', 'follow_up')
      order by entry.sequence_number desc limit 1
    ) latest_responsible on true
    where incident.organization_id = p_expected_organization_id
      and incident.branch_id = p_expected_branch_id
      and private.abnormal_scope_allowed(incident.organization_id, incident.branch_id,
        incident.affected_target_kind, incident.affected_client_id, 'quality_events.read')
  ), filtered as (
    select accessible.* from accessible
    where (p_date_from is null or
      (accessible.occurred_at at time zone 'Asia/Taipei')::date >= p_date_from)
      and (p_date_to is null or
        (accessible.occurred_at at time zone 'Asia/Taipei')::date <= p_date_to)
      and (v_event_type is null or accessible.event_type = v_event_type)
      and (v_target_kind = 'all' or accessible.affected_target_kind = v_target_kind)
      and (v_status = 'all' or accessible.handling_status = v_status)
  ), selected as (
    select filtered.* from filtered
    order by filtered.occurred_at desc, filtered.id desc limit 200
  ), selected_stats as (
    select count(*)::bigint as item_total from selected
  ), stats as (
    select count(*)::bigint as matching_total,
      count(*) filter (where filtered.major_state = 'major')::bigint as major_total,
      count(*) filter (where filtered.handling_status <> 'closed')::bigint as awaiting_total,
      count(*) filter (where filtered.handling_status <> 'closed'
        and filtered.current_improvement_due_date <
          (v_generated_at at time zone 'Asia/Taipei')::date)::bigint as overdue_total,
      count(*) filter (where filtered.handling_status = 'closed')::bigint as closed_total
    from filtered
  ), client_candidates as (
    select client.id, client.display_name, client.status, client.admitted_on, client.ended_on,
      (client.status = 'active' and client.admitted_on is not null
        and client.admitted_on <= (v_generated_at at time zone 'Asia/Taipei')::date
        and (client.ended_on is null or client.ended_on >=
          (v_generated_at at time zone 'Asia/Taipei')::date)) as can_report
    from public.clients client
    where client.organization_id = p_expected_organization_id
      and client.branch_id = p_expected_branch_id
      and private.can_staff_access_client(client.id, 'clients.read')
      and private.can_staff_access_client(client.id, 'quality_events.read')
      and (client.status = 'active' or exists (
        select 1 from public.abnormal_incidents historical
        where historical.affected_client_id = client.id
          and historical.organization_id = client.organization_id
          and historical.branch_id = client.branch_id))
  ), client_ranked as (
    select candidate.*, row_number() over (
      order by candidate.display_name collate "C", candidate.id) as ordinal
    from client_candidates candidate
  ), client_result as (
    select count(*)::bigint as available_total,
      coalesce(jsonb_agg(jsonb_build_object(
        'client_id', ranked.id, 'display_name', ranked.display_name,
        'client_status', ranked.status, 'admitted_on', ranked.admitted_on,
        'ended_on', ranked.ended_on, 'can_report', ranked.can_report
      ) order by ranked.display_name collate "C", ranked.id)
        filter (where ranked.ordinal <= 200), '[]'::jsonb) as options
    from client_ranked ranked
  ), responsible_candidates as (
    select membership.id, profile.id as user_id, btrim(profile.display_name) as display_name,
      case when membership.branch_id is null then 'organization' else 'branch' end as membership_scope
    from public.memberships membership
    join public.profiles profile on profile.id = membership.profile_id
    where membership.organization_id = p_expected_organization_id
      and (membership.branch_id is null or membership.branch_id = p_expected_branch_id)
      and membership.status = 'active' and membership.starts_at <= v_generated_at
      and (membership.ends_at is null or membership.ends_at > v_generated_at)
      and profile.is_active and profile.kind = 'staff'
  ), responsible_ranked as (
    select candidate.*, row_number() over (
      order by candidate.display_name collate "C", candidate.id) as ordinal
    from responsible_candidates candidate
  ), responsible_result as (
    select count(*)::bigint as available_total,
      coalesce(jsonb_agg(jsonb_build_object(
        'membership_id', ranked.id, 'user_id', ranked.user_id,
        'display_name', ranked.display_name, 'membership_scope', ranked.membership_scope
      ) order by ranked.display_name collate "C", ranked.id)
        filter (where ranked.ordinal <= 200), '[]'::jsonb) as options
    from responsible_ranked ranked
  ), type_candidates as (
    select distinct accessible.event_type collate "C" as event_type from accessible
  ), type_ranked as (
    select candidate.event_type, row_number() over (
      order by candidate.event_type collate "C") as ordinal from type_candidates candidate
  ), type_result as (
    select count(*)::bigint as available_total,
      coalesce(jsonb_agg(ranked.event_type order by ranked.event_type collate "C")
        filter (where ranked.ordinal <= 200), '[]'::jsonb) as options
    from type_ranked ranked
  )
  select selected_stats.item_total, stats.matching_total, stats.major_total,
    stats.awaiting_total, stats.overdue_total, stats.closed_total,
    client_result.options, client_result.available_total,
    responsible_result.options, responsible_result.available_total,
    type_result.options, type_result.available_total,
    coalesce(jsonb_agg(jsonb_build_object(
      'incident_id', incident.id,
      'affected_target_kind', incident.affected_target_kind,
      'affected_client_id', incident.affected_client_id,
      'affected_target_label', incident.affected_target_label_snapshot,
      'occurred_at', incident.occurred_at,
      'reported_at', incident.reported_at,
      'location', incident.location,
      'event_type', incident.event_type,
      'event_summary', incident.event_summary,
      'immediate_action', incident.immediate_action,
      'major_state', incident.major_state,
      'late_entry_reason', incident.late_entry_reason,
      'initial_responsible_membership_id', incident.initial_responsible_membership_id,
      'initial_responsible_user_id', incident.initial_responsible_user_id,
      'initial_responsible_display_name', incident.initial_responsible_display_name,
      'current_responsible_membership_id', incident.current_responsible_membership_id,
      'current_responsible_user_id', incident.current_responsible_user_id,
      'current_responsible_display_name', incident.current_responsible_display_name,
      'initial_improvement_due_date', incident.initial_improvement_due_date,
      'current_improvement_due_date', incident.current_improvement_due_date,
      'reporter_display_name', incident.reporter_display_name,
      'handling_status', incident.handling_status,
      'chain_version', incident.timeline_total,
      'last_activity_at', incident.last_activity_at,
      'timeline_total', incident.timeline_total,
      'timeline_truncated', incident.timeline_total > 100,
      'timeline', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'entry_id', history.id, 'sequence_number', history.sequence_number,
          'entry_type', history.entry_type, 'occurred_at', history.occurred_at,
          'entry_text', history.entry_text, 'notification_target', history.notification_target,
          'notification_method', history.notification_method,
          'notification_result', history.notification_result,
          'responsible_membership_id', history.responsible_membership_id,
          'responsible_user_id', history.responsible_user_id,
          'responsible_display_name', history.responsible_display_name,
          'due_date_action', history.due_date_action,
          'due_date_value', history.due_date_value,
          'effective_due_date', history.effective_due_date,
          'closure_outcome', history.closure_outcome,
          'closure_reason', history.closure_reason,
          'committer_display_name', history.committer_display_name,
          'committed_at', history.committed_at
        ) order by history.sequence_number), '[]'::jsonb)
        from (
          select entry.* from public.abnormal_incident_entries entry
          where entry.incident_id = incident.id
            and entry.organization_id = incident.organization_id
            and entry.branch_id = incident.branch_id
          order by entry.sequence_number desc limit 100
        ) history
      )
    ) order by incident.occurred_at desc, incident.id desc)
      filter (where incident.id is not null), '[]'::jsonb)
  into v_item_total, v_matching_total, v_major_total, v_awaiting_total,
    v_overdue_total, v_closed_total, v_client_options, v_client_available,
    v_responsible_options, v_responsible_available, v_type_options,
    v_type_available, v_items
  from selected_stats cross join stats cross join client_result
  cross join responsible_result cross join type_result
  left join selected incident on true
  group by selected_stats.item_total, stats.matching_total, stats.major_total,
    stats.awaiting_total, stats.overdue_total, stats.closed_total,
    client_result.options, client_result.available_total,
    responsible_result.options, responsible_result.available_total,
    type_result.options, type_result.available_total;

  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not private.has_permission(p_expected_organization_id, p_expected_branch_id, 'clients.read')
     or not private.has_permission(p_expected_organization_id, p_expected_branch_id, 'quality_events.read') then
    raise exception using errcode = '42501', message = 'abnormal incident snapshot authority expired';
  end if;

  insert into public.audit_events (
    organization_id, branch_id, actor_user_id, action, table_name, row_pk,
    changed_fields, metadata
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_actor, 'select',
    'abnormal_incidents', null, '{}'::text[], jsonb_build_object(
      'projection', 'page27_abnormal_events_v1',
      'interaction', case when p_date_from is null and p_date_to is null
        and v_event_type is null and v_target_kind = 'all' and v_status = 'all'
        then 'view' else 'search' end,
      'snapshot_count', v_item_total, 'matching_count', v_matching_total,
      'items_truncated', v_matching_total > v_item_total,
      'item_limit', 200, 'timeline_limit', 100,
      'client_options_available_total', v_client_available,
      'responsible_options_available_total', v_responsible_available,
      'event_type_options_available_total', v_type_available,
      'event_type_filter_applied', v_event_type is not null,
      'affected_target_filter', v_target_kind, 'status_filter', v_status,
      'event_taxonomy_status', 'not_configured',
      'major_criteria_status', 'not_configured',
      'legal_reporting_status', 'not_configured',
      'delivery_integration_status', 'not_implemented'
    )
  );

  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not exists (select 1 from public.branches branch
       where branch.id = p_expected_branch_id
         and branch.organization_id = p_expected_organization_id and branch.is_active)
     or not private.has_permission(p_expected_organization_id, p_expected_branch_id, 'clients.read')
     or not private.has_permission(p_expected_organization_id, p_expected_branch_id, 'quality_events.read') then
    raise exception using errcode = '42501', message = 'abnormal incident snapshot final authority expired';
  end if;

  return query select p_expected_organization_id, p_expected_branch_id,
    v_generated_at, v_items, v_item_total, v_matching_total, v_major_total,
    v_awaiting_total, v_overdue_total, v_closed_total,
    v_matching_total > v_item_total,
    v_client_options, v_client_available, v_client_available > jsonb_array_length(v_client_options),
    v_responsible_options, v_responsible_available,
    v_responsible_available > jsonb_array_length(v_responsible_options),
    v_type_options, v_type_available, v_type_available > jsonb_array_length(v_type_options),
    'not_configured'::text, 'not_configured'::text, 'not_configured'::text,
    'not_implemented'::text;
end;
$$;

create or replace function public.abnormal_event_snapshot(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_date_from date default null,
  p_date_to date default null,
  p_event_type text default null,
  p_affected_target_kind text default 'all',
  p_handling_status text default 'all'
)
returns table(
  organization_id uuid, branch_id uuid, generated_at timestamptz, items jsonb,
  item_total bigint, matching_total bigint, major_total bigint,
  awaiting_improvement_total bigint, overdue_total bigint, closed_total bigint,
  items_truncated boolean, client_options jsonb,
  client_options_available_total bigint, client_options_truncated boolean,
  responsible_options jsonb, responsible_options_available_total bigint,
  responsible_options_truncated boolean, event_type_options jsonb,
  event_type_options_available_total bigint, event_type_options_truncated boolean,
  event_taxonomy_status text, major_criteria_status text,
  legal_reporting_status text, delivery_integration_status text
)
language sql volatile security invoker set search_path = '' as $$
  select * from private.abnormal_event_snapshot_core(
    p_expected_organization_id, p_expected_branch_id, p_date_from, p_date_to,
    p_event_type, p_affected_target_kind, p_handling_status
  );
$$;

create or replace function public.report_abnormal_event(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_affected_target_kind text,
  p_affected_client_id uuid,
  p_affected_target_label text,
  p_occurred_at timestamptz,
  p_location text,
  p_event_type text,
  p_event_summary text,
  p_immediate_action text,
  p_major_state text,
  p_responsible_membership_id uuid,
  p_improvement_due_date date,
  p_late_entry_reason text,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid, incident_id uuid, entry_id uuid, operation_kind text,
  affected_target_kind text, affected_client_id uuid, chain_version integer,
  handling_status text, responsible_membership_id uuid,
  effective_due_date date, committed_at timestamptz, replayed boolean
)
language sql volatile security invoker set search_path = '' as $$
  select * from private.report_abnormal_event_atomic(
    p_expected_organization_id, p_expected_branch_id, p_affected_target_kind,
    p_affected_client_id, p_affected_target_label, p_occurred_at, p_location,
    p_event_type, p_event_summary, p_immediate_action, p_major_state,
    p_responsible_membership_id, p_improvement_due_date, p_late_entry_reason,
    p_idempotency_key
  );
$$;

create or replace function public.add_abnormal_event_manual_notification(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_affected_target_kind text,
  p_affected_client_id uuid,
  p_incident_id uuid,
  p_occurred_at timestamptz,
  p_notification_target text,
  p_notification_method text,
  p_notification_result text,
  p_expected_chain_version integer,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid, incident_id uuid, entry_id uuid, operation_kind text,
  affected_target_kind text, affected_client_id uuid, chain_version integer,
  handling_status text, responsible_membership_id uuid,
  effective_due_date date, committed_at timestamptz, replayed boolean
)
language sql volatile security invoker set search_path = '' as $$
  select * from private.append_abnormal_event_entry_atomic(
    'manual_notification', p_expected_organization_id, p_expected_branch_id,
    p_affected_target_kind, p_affected_client_id, p_incident_id, p_occurred_at,
    null, p_notification_target, p_notification_method, p_notification_result,
    null, null, null, null, null, p_expected_chain_version, p_idempotency_key
  );
$$;

create or replace function public.add_abnormal_event_improvement(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_affected_target_kind text,
  p_affected_client_id uuid,
  p_incident_id uuid,
  p_occurred_at timestamptz,
  p_entry_text text,
  p_responsible_membership_id uuid,
  p_due_date_action text,
  p_due_date_value date,
  p_expected_chain_version integer,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid, incident_id uuid, entry_id uuid, operation_kind text,
  affected_target_kind text, affected_client_id uuid, chain_version integer,
  handling_status text, responsible_membership_id uuid,
  effective_due_date date, committed_at timestamptz, replayed boolean
)
language sql volatile security invoker set search_path = '' as $$
  select * from private.append_abnormal_event_entry_atomic(
    'improvement', p_expected_organization_id, p_expected_branch_id,
    p_affected_target_kind, p_affected_client_id, p_incident_id, p_occurred_at,
    p_entry_text, null, null, null, p_responsible_membership_id,
    p_due_date_action, p_due_date_value, null, null,
    p_expected_chain_version, p_idempotency_key
  );
$$;

create or replace function public.add_abnormal_event_follow_up(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_affected_target_kind text,
  p_affected_client_id uuid,
  p_incident_id uuid,
  p_occurred_at timestamptz,
  p_entry_text text,
  p_responsible_membership_id uuid,
  p_due_date_action text,
  p_due_date_value date,
  p_expected_chain_version integer,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid, incident_id uuid, entry_id uuid, operation_kind text,
  affected_target_kind text, affected_client_id uuid, chain_version integer,
  handling_status text, responsible_membership_id uuid,
  effective_due_date date, committed_at timestamptz, replayed boolean
)
language sql volatile security invoker set search_path = '' as $$
  select * from private.append_abnormal_event_entry_atomic(
    'follow_up', p_expected_organization_id, p_expected_branch_id,
    p_affected_target_kind, p_affected_client_id, p_incident_id, p_occurred_at,
    p_entry_text, null, null, null, p_responsible_membership_id,
    p_due_date_action, p_due_date_value, null, null,
    p_expected_chain_version, p_idempotency_key
  );
$$;

create or replace function public.close_abnormal_event(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_affected_target_kind text,
  p_affected_client_id uuid,
  p_incident_id uuid,
  p_occurred_at timestamptz,
  p_closure_outcome text,
  p_closure_reason text,
  p_expected_chain_version integer,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid, incident_id uuid, entry_id uuid, operation_kind text,
  affected_target_kind text, affected_client_id uuid, chain_version integer,
  handling_status text, responsible_membership_id uuid,
  effective_due_date date, committed_at timestamptz, replayed boolean
)
language sql volatile security invoker set search_path = '' as $$
  select * from private.append_abnormal_event_entry_atomic(
    'close', p_expected_organization_id, p_expected_branch_id,
    p_affected_target_kind, p_affected_client_id, p_incident_id, p_occurred_at,
    null, null, null, null, null, null, null,
    p_closure_outcome, p_closure_reason, p_expected_chain_version,
    p_idempotency_key
  );
$$;

revoke all on function private.prevent_abnormal_history_mutation() from public, anon, authenticated, service_role;
revoke all on function private.abnormal_scope_allowed(uuid, uuid, text, uuid, text) from public, anon, authenticated, service_role;
revoke all on function private.resolve_abnormal_responsible(uuid, uuid, uuid, timestamptz) from public, anon, authenticated, service_role;
revoke all on function private.require_abnormal_closure_reauth(uuid, timestamptz) from public, anon, authenticated, service_role;
revoke all on function private.report_abnormal_event_atomic(uuid, uuid, text, uuid, text, timestamptz, text, text, text, text, text, uuid, date, text, uuid) from public, anon, authenticated, service_role;
revoke all on function private.append_abnormal_event_entry_atomic(text, uuid, uuid, text, uuid, uuid, timestamptz, text, text, text, text, uuid, text, date, text, text, integer, uuid) from public, anon, authenticated, service_role;
revoke all on function private.abnormal_event_snapshot_core(uuid, uuid, date, date, text, text, text) from public, anon, authenticated, service_role;

revoke all on function public.abnormal_event_snapshot(uuid, uuid, date, date, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.report_abnormal_event(uuid, uuid, text, uuid, text, timestamptz, text, text, text, text, text, uuid, date, text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.add_abnormal_event_manual_notification(uuid, uuid, text, uuid, uuid, timestamptz, text, text, text, integer, uuid) from public, anon, authenticated, service_role;
revoke all on function public.add_abnormal_event_improvement(uuid, uuid, text, uuid, uuid, timestamptz, text, uuid, text, date, integer, uuid) from public, anon, authenticated, service_role;
revoke all on function public.add_abnormal_event_follow_up(uuid, uuid, text, uuid, uuid, timestamptz, text, uuid, text, date, integer, uuid) from public, anon, authenticated, service_role;
revoke all on function public.close_abnormal_event(uuid, uuid, text, uuid, uuid, timestamptz, text, text, integer, uuid) from public, anon, authenticated, service_role;

grant execute on function private.report_abnormal_event_atomic(uuid, uuid, text, uuid, text, timestamptz, text, text, text, text, text, uuid, date, text, uuid) to authenticated;
grant execute on function private.append_abnormal_event_entry_atomic(text, uuid, uuid, text, uuid, uuid, timestamptz, text, text, text, text, uuid, text, date, text, text, integer, uuid) to authenticated;
grant execute on function private.abnormal_event_snapshot_core(uuid, uuid, date, date, text, text, text) to authenticated;

grant execute on function public.abnormal_event_snapshot(uuid, uuid, date, date, text, text, text) to authenticated;
grant execute on function public.report_abnormal_event(uuid, uuid, text, uuid, text, timestamptz, text, text, text, text, text, uuid, date, text, uuid) to authenticated;
grant execute on function public.add_abnormal_event_manual_notification(uuid, uuid, text, uuid, uuid, timestamptz, text, text, text, integer, uuid) to authenticated;
grant execute on function public.add_abnormal_event_improvement(uuid, uuid, text, uuid, uuid, timestamptz, text, uuid, text, date, integer, uuid) to authenticated;
grant execute on function public.add_abnormal_event_follow_up(uuid, uuid, text, uuid, uuid, timestamptz, text, uuid, text, date, integer, uuid) to authenticated;
grant execute on function public.close_abnormal_event(uuid, uuid, text, uuid, uuid, timestamptz, text, text, integer, uuid) to authenticated;
