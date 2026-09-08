-- Page 37: branch/client-scoped interprofessional consultations.
-- Every business action is an immutable event. Notifications are frozen in-app
-- outbox evidence only; no external provider or delivery is claimed.

insert into public.permissions (permission_key, description, risk_level) values
  ('interprofessional_consultations.read', 'Read assigned interprofessional consultation snapshots', 1),
  ('interprofessional_consultations.create', 'Create an interprofessional consultation', 3),
  ('interprofessional_consultations.assign', 'Assign or reassign an interprofessional consultation', 3),
  ('interprofessional_consultations.respond', 'Reply to, supplement, or correct a consultation', 2),
  ('interprofessional_consultations.close', 'Close or reopen an interprofessional consultation', 3)
on conflict (permission_key) do nothing;

insert into public.role_permissions (role_id, permission_id)
select role.id, permission.id
from public.roles role cross join public.permissions permission
where role.is_system
  and role.role_key in (
    'organization_manager', 'branch_supervisor', 'case_manager_social_worker',
    'nurse', 'professional'
  )
  and permission.permission_key in (
    'interprofessional_consultations.read',
    'interprofessional_consultations.create',
    'interprofessional_consultations.respond'
  )
on conflict (role_id, permission_id) do nothing;

insert into public.role_permissions (role_id, permission_id)
select role.id, permission.id
from public.roles role cross join public.permissions permission
where role.is_system
  and role.role_key in (
    'organization_manager', 'branch_supervisor', 'case_manager_social_worker'
  )
  and permission.permission_key in (
    'interprofessional_consultations.assign',
    'interprofessional_consultations.close'
  )
on conflict (role_id, permission_id) do nothing;

create table public.interprofessional_consultation_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  consultation_key uuid not null,
  sequence integer not null,
  previous_event_id uuid,
  corrects_event_id uuid,
  event_kind text not null,
  client_id uuid not null,
  client_display_name text not null,
  client_code text not null,
  requester_user_id uuid not null references auth.users(id) on delete restrict,
  requester_membership_id uuid not null references public.memberships(id) on delete restrict,
  requester_display_name text not null,
  assignee_user_id uuid references auth.users(id) on delete restrict,
  assignee_membership_id uuid references public.memberships(id) on delete restrict,
  assignee_display_name text,
  assignment_state text not null,
  discipline_code text not null,
  discipline_label text not null,
  discipline_taxonomy_status text not null,
  urgency text not null,
  urgency_source text not null,
  requested_at timestamptz not null,
  deadline_state text not null,
  due_at timestamptz,
  problem_summary text not null,
  entry_content text,
  status text not null,
  occurred_at timestamptz not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  actor_display_name text not null,
  reauth_challenge_id uuid references private.reauth_challenges(id) on delete restrict,
  content_hash text not null,
  constraint interprofessional_consultation_events_branch_scope_fkey
    foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete restrict,
  constraint interprofessional_consultation_events_client_scope_fkey
    foreign key (client_id, organization_id, branch_id)
    references public.clients(id, organization_id, branch_id) on delete restrict,
  constraint interprofessional_consultation_events_id_scope_key
    unique (id, organization_id, branch_id, consultation_key),
  constraint interprofessional_consultation_events_stream_key
    unique (organization_id, branch_id, consultation_key, sequence),
  constraint interprofessional_consultation_events_previous_key unique (previous_event_id),
  constraint interprofessional_consultation_events_previous_scope_fkey
    foreign key (previous_event_id, organization_id, branch_id, consultation_key)
    references public.interprofessional_consultation_events (
      id, organization_id, branch_id, consultation_key
    ) on delete restrict,
  constraint interprofessional_consultation_events_correction_scope_fkey
    foreign key (corrects_event_id, organization_id, branch_id, consultation_key)
    references public.interprofessional_consultation_events (
      id, organization_id, branch_id, consultation_key
    ) on delete restrict,
  constraint interprofessional_consultation_events_lineage_check check (
    sequence > 0 and (
      (sequence = 1 and previous_event_id is null and event_kind = 'created')
      or (sequence > 1 and previous_event_id is not null and event_kind in (
        'assigned', 'reassigned', 'reply', 'supplement', 'closed', 'reopened', 'corrected'
      ))
    )
  ),
  constraint interprofessional_consultation_events_correction_check check (
    (event_kind = 'corrected') = (corrects_event_id is not null)
  ),
  constraint interprofessional_consultation_events_assignment_check check (
    assignment_state in ('assigned', 'unassigned')
    and (assignment_state = 'assigned') = (assignee_user_id is not null)
    and (assignee_user_id is null) = (assignee_membership_id is null)
    and (assignee_user_id is null) = (assignee_display_name is null)
  ),
  constraint interprofessional_consultation_events_taxonomy_check check (
    discipline_taxonomy_status = 'manual_unstandardized'
    and char_length(discipline_code) between 1 and 40
    and discipline_code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$'
    and char_length(discipline_label) between 1 and 100
    and discipline_label !~ '[[:cntrl:]]'
  ),
  constraint interprofessional_consultation_events_urgency_check check (
    urgency in ('routine', 'soon', 'urgent') and urgency_source = 'manual'
  ),
  constraint interprofessional_consultation_events_deadline_check check (
    deadline_state in ('dated', 'missing', 'not_applicable')
    and (deadline_state = 'dated') = (due_at is not null)
    and (deadline_state <> 'dated' or due_at >= requested_at)
  ),
  constraint interprofessional_consultation_events_status_check check (
    status in ('unassigned', 'assigned', 'answered', 'closed')
    and (status = 'unassigned') = (assignment_state = 'unassigned')
    and (event_kind <> 'closed' or status = 'closed')
    and (event_kind <> 'reply' or status = 'answered')
    and (event_kind not in ('assigned', 'reassigned') or status = 'assigned')
  ),
  constraint interprofessional_consultation_events_text_check check (
    char_length(client_display_name) between 1 and 120
    and client_display_name !~ '[[:cntrl:]]'
    and char_length(client_code) between 1 and 80
    and client_code !~ '[[:cntrl:]]'
    and char_length(requester_display_name) between 1 and 120
    and requester_display_name !~ '[[:cntrl:]]'
    and (assignee_display_name is null or (
      char_length(assignee_display_name) between 1 and 120
      and assignee_display_name !~ '[[:cntrl:]]'
    ))
    and char_length(problem_summary) between 2 and 2000
    and translate(problem_summary, E'\n\r\t', '') !~ '[[:cntrl:]]'
    and (entry_content is null or (
      char_length(entry_content) between 2 and 4000
      and translate(entry_content, E'\n\r\t', '') !~ '[[:cntrl:]]'
    ))
    and char_length(actor_display_name) between 1 and 120
    and actor_display_name !~ '[[:cntrl:]]'
  ),
  constraint interprofessional_consultation_events_entry_check check (
    (event_kind in ('reply', 'supplement', 'reassigned', 'closed', 'reopened', 'corrected'))
      = (entry_content is not null)
  ),
  constraint interprofessional_consultation_events_reauth_check check (
    (event_kind in ('created', 'assigned', 'reassigned', 'closed', 'reopened', 'corrected'))
      = (reauth_challenge_id is not null)
  ),
  constraint interprofessional_consultation_events_time_check check (
    extract(year from requested_at at time zone 'Asia/Taipei') between 2000 and 2200
    and extract(year from occurred_at at time zone 'Asia/Taipei') between 2000 and 2200
    and occurred_at >= requested_at - interval '1 minute'
  ),
  constraint interprofessional_consultation_events_hash_check check (
    content_hash ~ '^[a-f0-9]{64}$'
  )
);

create table public.interprofessional_consultation_notification_outbox (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  consultation_key uuid not null,
  source_event_id uuid not null,
  source_sequence integer not null,
  recipient_user_id uuid not null references auth.users(id) on delete restrict,
  recipient_membership_id uuid not null references public.memberships(id) on delete restrict,
  recipient_display_name text not null,
  recipient_reasons text[] not null,
  channel text not null,
  queue_status text not null,
  delivery_claim text not null,
  external_provider_status text not null,
  queued_at timestamptz not null,
  correlation_id uuid not null,
  content_hash text not null,
  constraint interprofessional_consultation_outbox_branch_scope_fkey
    foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete restrict,
  constraint interprofessional_consultation_outbox_event_scope_fkey
    foreign key (source_event_id, organization_id, branch_id, consultation_key)
    references public.interprofessional_consultation_events (
      id, organization_id, branch_id, consultation_key
    ) on delete restrict,
  constraint interprofessional_consultation_outbox_recipient_key
    unique (source_event_id, recipient_user_id),
  constraint interprofessional_consultation_outbox_correlation_key
    unique (organization_id, correlation_id),
  constraint interprofessional_consultation_outbox_boundary_check check (
    source_sequence > 0 and channel = 'in_app' and queue_status = 'queued'
    and delivery_claim = 'queued_not_delivered'
    and external_provider_status = 'not_configured'
    and cardinality(recipient_reasons) between 1 and 3
    and recipient_reasons <@ array['requester', 'assignee', 'previous_assignee']::text[]
  ),
  constraint interprofessional_consultation_outbox_text_check check (
    char_length(recipient_display_name) between 1 and 120
    and recipient_display_name !~ '[[:cntrl:]]'
    and content_hash ~ '^[a-f0-9]{64}$'
  )
);

create table private.interprofessional_consultation_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  idempotency_key uuid not null,
  operation_kind text not null,
  request_hash text not null,
  result_consultation_key uuid not null,
  result_event_id uuid not null,
  result_sequence integer not null,
  previous_event_id uuid,
  result_status text not null,
  result_assignee_user_id uuid references auth.users(id) on delete restrict,
  notification_count integer not null,
  reauth_challenge_id uuid references private.reauth_challenges(id) on delete restrict,
  committed_at timestamptz not null,
  constraint interprofessional_consultation_operations_actor_key
    unique (actor_user_id, idempotency_key),
  constraint interprofessional_consultation_operations_result_scope_fkey
    foreign key (result_event_id, organization_id, branch_id, result_consultation_key)
    references public.interprofessional_consultation_events (
      id, organization_id, branch_id, consultation_key
    ) on delete restrict,
  constraint interprofessional_consultation_operations_previous_scope_fkey
    foreign key (previous_event_id, organization_id, branch_id, result_consultation_key)
    references public.interprofessional_consultation_events (
      id, organization_id, branch_id, consultation_key
    ) on delete restrict,
  constraint interprofessional_consultation_operations_check check (
    operation_kind in ('create', 'assign', 'reassign', 'reply', 'supplement', 'close', 'reopen', 'correct')
    and request_hash ~ '^[a-f0-9]{64}$'
    and result_sequence > 0
    and result_status in ('unassigned', 'assigned', 'answered', 'closed')
    and notification_count between 1 and 3
    and (operation_kind in ('create', 'assign', 'reassign', 'close', 'reopen', 'correct'))
      = (reauth_challenge_id is not null)
  )
);

create index interprofessional_consultation_events_scope_idx
  on public.interprofessional_consultation_events (
    organization_id, branch_id, consultation_key, sequence desc
  );
create index interprofessional_consultation_events_branch_idx
  on public.interprofessional_consultation_events (branch_id, organization_id);
create index interprofessional_consultation_events_client_idx
  on public.interprofessional_consultation_events (client_id, organization_id, branch_id);
create index interprofessional_consultation_events_previous_idx
  on public.interprofessional_consultation_events (previous_event_id)
  where previous_event_id is not null;
create index interprofessional_consultation_events_corrects_idx
  on public.interprofessional_consultation_events (corrects_event_id)
  where corrects_event_id is not null;
create index interprofessional_consultation_events_requester_idx
  on public.interprofessional_consultation_events (requester_user_id, occurred_at desc);
create index interprofessional_consultation_events_requester_membership_idx
  on public.interprofessional_consultation_events (requester_membership_id);
create index interprofessional_consultation_events_assignee_idx
  on public.interprofessional_consultation_events (assignee_user_id, occurred_at desc)
  where assignee_user_id is not null;
create index interprofessional_consultation_events_assignee_membership_idx
  on public.interprofessional_consultation_events (assignee_membership_id)
  where assignee_membership_id is not null;
create index interprofessional_consultation_events_actor_idx
  on public.interprofessional_consultation_events (actor_user_id, occurred_at desc);
create index interprofessional_consultation_events_reauth_idx
  on public.interprofessional_consultation_events (reauth_challenge_id)
  where reauth_challenge_id is not null;
create index interprofessional_consultation_outbox_scope_idx
  on public.interprofessional_consultation_notification_outbox (
    organization_id, branch_id, consultation_key, source_sequence desc
  );
create index interprofessional_consultation_outbox_branch_idx
  on public.interprofessional_consultation_notification_outbox (branch_id, organization_id);
create index interprofessional_consultation_outbox_source_idx
  on public.interprofessional_consultation_notification_outbox (source_event_id);
create index interprofessional_consultation_outbox_recipient_idx
  on public.interprofessional_consultation_notification_outbox (recipient_user_id, queued_at desc);
create index interprofessional_consultation_outbox_membership_idx
  on public.interprofessional_consultation_notification_outbox (recipient_membership_id);
create index interprofessional_consultation_operations_scope_idx
  on private.interprofessional_consultation_operations (
    organization_id, branch_id, result_consultation_key, committed_at desc
  );
create index interprofessional_consultation_operations_actor_idx
  on private.interprofessional_consultation_operations (actor_user_id);
create index interprofessional_consultation_operations_result_idx
  on private.interprofessional_consultation_operations (result_event_id);
create index interprofessional_consultation_operations_previous_idx
  on private.interprofessional_consultation_operations (previous_event_id)
  where previous_event_id is not null;
create index interprofessional_consultation_operations_assignee_idx
  on private.interprofessional_consultation_operations (result_assignee_user_id)
  where result_assignee_user_id is not null;
create index interprofessional_consultation_operations_reauth_idx
  on private.interprofessional_consultation_operations (reauth_challenge_id)
  where reauth_challenge_id is not null;

alter table public.interprofessional_consultation_events enable row level security;
alter table public.interprofessional_consultation_events force row level security;
alter table public.interprofessional_consultation_notification_outbox enable row level security;
alter table public.interprofessional_consultation_notification_outbox force row level security;
alter table private.interprofessional_consultation_operations enable row level security;
alter table private.interprofessional_consultation_operations force row level security;

revoke all on table public.interprofessional_consultation_events
  from public, anon, authenticated, service_role;
revoke all on table public.interprofessional_consultation_notification_outbox
  from public, anon, authenticated, service_role;
revoke all on table private.interprofessional_consultation_operations
  from public, anon, authenticated, service_role;

create or replace function private.prevent_interprofessional_consultation_mutation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  raise exception using errcode = '55000',
    message = format('%I is append-only', tg_table_name);
end;
$$;

create trigger interprofessional_consultation_events_prevent_mutation
before update or delete on public.interprofessional_consultation_events
for each row execute function private.prevent_interprofessional_consultation_mutation();
create trigger interprofessional_consultation_notification_outbox_prevent_mutation
before update or delete on public.interprofessional_consultation_notification_outbox
for each row execute function private.prevent_interprofessional_consultation_mutation();
create trigger interprofessional_consultation_operations_prevent_mutation
before update or delete on private.interprofessional_consultation_operations
for each row execute function private.prevent_interprofessional_consultation_mutation();
create trigger interprofessional_consultation_events_audit_row_change
after insert on public.interprofessional_consultation_events
for each row execute function private.audit_row_change();
create trigger interprofessional_consultation_notification_outbox_audit_row_change
after insert on public.interprofessional_consultation_notification_outbox
for each row execute function private.audit_row_change();

create or replace function private.interprofessional_consultation_authority(
  p_organization_id uuid,
  p_branch_id uuid,
  p_permission text,
  p_require_recent_aal2 boolean default false
)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
    and exists (
      select 1 from public.profiles profile
      where profile.id = auth.uid()
        and profile.kind in ('staff', 'professional')
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

create or replace function private.interprofessional_consultation_user_has_permission(
  p_organization_id uuid,
  p_branch_id uuid,
  p_user_id uuid,
  p_permission text,
  p_reference_time timestamptz
)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.profiles profile
    join public.memberships membership on membership.profile_id = profile.id
    join public.membership_roles membership_role on membership_role.membership_id = membership.id
    join public.roles role on role.id = membership_role.role_id and role.is_active
    join public.role_permissions role_permission on role_permission.role_id = role.id
    join public.permissions permission on permission.id = role_permission.permission_id
    where profile.id = p_user_id and profile.is_active
      and profile.kind in ('staff', 'professional')
      and membership.organization_id = p_organization_id
      and membership.status = 'active'
      and membership.starts_at <= p_reference_time
      and (membership.ends_at is null or membership.ends_at > p_reference_time)
      and (membership.branch_id is null or membership.branch_id = p_branch_id)
      and (role.organization_id is null or role.organization_id = p_organization_id)
      and permission.permission_key = p_permission
  );
$$;

create or replace function private.interprofessional_consultation_user_can_access_client(
  p_organization_id uuid,
  p_branch_id uuid,
  p_user_id uuid,
  p_client_id uuid,
  p_reference_time timestamptz
)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.interprofessional_consultation_user_has_permission(
      p_organization_id, p_branch_id, p_user_id,
      'interprofessional_consultations.respond', p_reference_time
    )
    and private.interprofessional_consultation_user_has_permission(
      p_organization_id, p_branch_id, p_user_id, 'clients.read', p_reference_time
    )
    and (
      private.interprofessional_consultation_user_has_permission(
        p_organization_id, p_branch_id, p_user_id, 'clients.view_all', p_reference_time
      )
      or exists (
        select 1 from public.client_assignments assignment
        where assignment.organization_id = p_organization_id
          and assignment.branch_id = p_branch_id
          and assignment.client_id = p_client_id
          and assignment.assignee_user_id = p_user_id
          and assignment.starts_at <= p_reference_time
          and (assignment.ends_at is null or assignment.ends_at > p_reference_time)
      )
    );
$$;

create or replace function private.interprofessional_consultation_staff_snapshot(
  p_organization_id uuid,
  p_branch_id uuid,
  p_user_id uuid,
  p_permission text,
  p_client_id uuid,
  p_reference_time timestamptz
)
returns table(membership_id uuid, display_name text)
language sql stable security definer set search_path = '' as $$
  select membership.id, btrim(profile.display_name)
  from public.profiles profile
  join public.memberships membership on membership.profile_id = profile.id
  where profile.id = p_user_id and profile.is_active
    and profile.kind in ('staff', 'professional')
    and membership.organization_id = p_organization_id
    and membership.status = 'active'
    and membership.starts_at <= p_reference_time
    and (membership.ends_at is null or membership.ends_at > p_reference_time)
    and (membership.branch_id is null or membership.branch_id = p_branch_id)
    and private.interprofessional_consultation_user_has_permission(
      p_organization_id, p_branch_id, p_user_id, p_permission, p_reference_time
    )
    and (
      p_client_id is null or private.interprofessional_consultation_user_can_access_client(
        p_organization_id, p_branch_id, p_user_id, p_client_id, p_reference_time
      )
    )
  order by (membership.branch_id = p_branch_id) desc, membership.id
  limit 1;
$$;

create or replace function private.require_interprofessional_consultation_reauth(
  p_actor uuid,
  p_reference_time timestamptz
)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare v_session_id uuid; v_challenge_id uuid;
begin
  if p_actor is null or coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception using errcode = '42501',
      message = 'current same-session consultation AAL2 evidence is required';
  end if;
  begin
    v_session_id := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode = '42501',
      message = 'current same-session consultation AAL2 evidence is required';
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
      message = 'current same-session consultation AAL2 evidence is required';
  end if;
  return v_challenge_id;
end;
$$;

create or replace function private.mutate_interprofessional_consultation_guarded(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_action text,
  p_consultation_key uuid,
  p_previous_event_id uuid,
  p_expected_sequence integer,
  p_client_id uuid,
  p_assignee_user_id uuid,
  p_discipline_code text,
  p_discipline_label text,
  p_urgency text,
  p_requested_at timestamptz,
  p_deadline_state text,
  p_due_at timestamptz,
  p_problem_summary text,
  p_entry_content text,
  p_corrects_event_id uuid,
  p_idempotency_key uuid
)
returns table(
  organization_id uuid, branch_id uuid,
  operation_id uuid, operation_kind text, consultation_key uuid,
  event_id uuid, event_sequence integer, previous_event_id uuid,
  event_kind text, consultation_status text, assignment_state text,
  assignee_user_id uuid, deadline_state text, notification_count integer,
  notification_queue_status text, notification_delivery_claim text,
  external_provider_status text, committed_at timestamptz, replayed boolean
)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid(); v_now timestamptz := clock_timestamp();
  v_permission text; v_require_aal2 boolean;
  v_action text := nullif(btrim(p_action), '');
  v_discipline_code text := nullif(btrim(p_discipline_code), '');
  v_discipline_label text := nullif(btrim(p_discipline_label), '');
  v_problem_summary text := nullif(btrim(p_problem_summary), '');
  v_entry_content text := nullif(btrim(p_entry_content), '');
  v_request_hash text; v_content_hash text; v_reauth uuid;
  v_operation_id uuid := gen_random_uuid(); v_key uuid := coalesce(p_consultation_key, gen_random_uuid());
  v_event_id uuid := gen_random_uuid(); v_sequence integer;
  v_event_kind text; v_status text; v_assignment_state text;
  v_requester_user_id uuid; v_requester_membership_id uuid; v_requester_name text;
  v_assignee_user_id uuid; v_assignee_membership_id uuid; v_assignee_name text;
  v_client_id uuid; v_client_name text; v_client_code text;
  v_requested_at timestamptz; v_deadline_state text; v_due_at timestamptz;
  v_urgency text; v_prev_assignee uuid;
  v_notification_count integer := 0;
  v_previous public.interprofessional_consultation_events%rowtype;
  v_operation private.interprofessional_consultation_operations%rowtype;
  v_target public.interprofessional_consultation_events%rowtype;
begin
  if v_action not in ('create', 'assign', 'reassign', 'reply', 'supplement', 'close', 'reopen', 'correct')
     or p_expected_organization_id is null or p_expected_branch_id is null
     or p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'consultation operation fields are invalid';
  end if;
  v_permission := case
    when v_action = 'create' then 'interprofessional_consultations.create'
    when v_action in ('assign', 'reassign') then 'interprofessional_consultations.assign'
    when v_action in ('reply', 'supplement', 'correct') then 'interprofessional_consultations.respond'
    else 'interprofessional_consultations.close' end;
  v_require_aal2 := v_action in ('create', 'assign', 'reassign', 'close', 'reopen', 'correct');
  if not private.interprofessional_consultation_authority(
    p_expected_organization_id, p_expected_branch_id, v_permission, v_require_aal2
  ) then
    raise exception using errcode = '42501', message = 'consultation operation is not permitted';
  end if;

  v_request_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version', 1, 'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id, 'actor', v_actor, 'action', v_action,
    'consultation_key', p_consultation_key, 'previous_event_id', p_previous_event_id,
    'expected_sequence', p_expected_sequence, 'client_id', p_client_id,
    'assignee_user_id', p_assignee_user_id, 'discipline_code', v_discipline_code,
    'discipline_label', v_discipline_label, 'urgency', p_urgency,
    'requested_at', p_requested_at, 'deadline_state', p_deadline_state,
    'due_at', p_due_at, 'problem_summary', v_problem_summary,
    'entry_content', v_entry_content, 'corrects_event_id', p_corrects_event_id
  )::text, 'UTF8')), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(
    'interprofessional-consultation-operation:' || v_actor::text || ':' || p_idempotency_key::text, 37
  ));
  select operation.* into v_operation
  from private.interprofessional_consultation_operations operation
  where operation.actor_user_id = v_actor and operation.idempotency_key = p_idempotency_key;
  if found then
    if v_operation.organization_id <> p_expected_organization_id
       or v_operation.branch_id <> p_expected_branch_id
       or v_operation.operation_kind <> v_action
       or v_operation.request_hash <> v_request_hash
       or (p_consultation_key is not null and v_operation.result_consultation_key <> p_consultation_key) then
      raise exception using errcode = '23505', message = 'consultation idempotency conflict';
    end if;
    if not private.interprofessional_consultation_authority(
      p_expected_organization_id, p_expected_branch_id, v_permission, v_require_aal2
    ) then
      raise exception using errcode = '42501', message = 'consultation replay authority expired';
    end if;
    if v_require_aal2 and private.require_interprofessional_consultation_reauth(v_actor, clock_timestamp()) is null then
      raise exception using errcode = '42501', message = 'consultation replay authority expired';
    end if;
    return query select p_expected_organization_id, p_expected_branch_id,
      v_operation.id, v_operation.operation_kind,
      v_operation.result_consultation_key, v_operation.result_event_id,
      v_operation.result_sequence, v_operation.previous_event_id,
      case v_operation.operation_kind when 'create' then 'created'
        when 'assign' then 'assigned' when 'reassign' then 'reassigned'
        when 'close' then 'closed' when 'reopen' then 'reopened'
        when 'correct' then 'corrected' else v_operation.operation_kind end,
      v_operation.result_status,
      case when v_operation.result_assignee_user_id is null then 'unassigned' else 'assigned' end,
      v_operation.result_assignee_user_id,
      (select event.deadline_state from public.interprofessional_consultation_events event
        where event.id = v_operation.result_event_id),
      v_operation.notification_count, 'queued'::text, 'queued_not_delivered'::text,
      'not_configured'::text, v_operation.committed_at, true;
    return;
  end if;

  if v_require_aal2 then
    v_reauth := private.require_interprofessional_consultation_reauth(v_actor, v_now);
  end if;

  if v_action = 'create' then
    if p_consultation_key is not null or p_previous_event_id is not null
       or p_expected_sequence is not null or p_client_id is null
       or v_discipline_code is null or v_discipline_label is null
       or p_urgency not in ('routine', 'soon', 'urgent')
       or p_requested_at is null or p_deadline_state not in ('dated', 'missing', 'not_applicable')
       or (p_deadline_state = 'dated') <> (p_due_at is not null)
       or (p_due_at is not null and p_due_at < p_requested_at)
       or v_problem_summary is null or v_entry_content is not null
       or p_corrects_event_id is not null
       or not private.can_staff_access_client(p_client_id, 'clients.read') then
      raise exception using errcode = '22023', message = 'consultation create fields are invalid';
    end if;
    select client.id, btrim(client.display_name), btrim(client.client_code)
      into v_client_id, v_client_name, v_client_code
    from public.clients client
    where client.id = p_client_id
      and client.organization_id = p_expected_organization_id
      and client.branch_id = p_expected_branch_id
      and client.status = 'active'
      and client.admitted_on is not null
      and client.admitted_on <= (p_requested_at at time zone 'Asia/Taipei')::date
      and (client.ended_on is null or client.ended_on >= (p_requested_at at time zone 'Asia/Taipei')::date);
    if v_client_id is null then
      raise exception using errcode = '42501', message = 'consultation client is outside current scope';
    end if;
    select staff.membership_id, staff.display_name
      into v_requester_membership_id, v_requester_name
    from private.interprofessional_consultation_staff_snapshot(
      p_expected_organization_id, p_expected_branch_id, v_actor,
      'interprofessional_consultations.create', null, v_now
    ) staff;
    if v_requester_membership_id is null then
      raise exception using errcode = '42501', message = 'consultation requester is not current';
    end if;
    v_requester_user_id := v_actor; v_assignee_user_id := p_assignee_user_id;
    if v_assignee_user_id is not null then
      select staff.membership_id, staff.display_name
        into v_assignee_membership_id, v_assignee_name
      from private.interprofessional_consultation_staff_snapshot(
        p_expected_organization_id, p_expected_branch_id, v_assignee_user_id,
        'interprofessional_consultations.respond', v_client_id, v_now
      ) staff;
      if v_assignee_membership_id is null then
        raise exception using errcode = '42501', message = 'consultation assignee is not eligible for this client';
      end if;
    end if;
    v_sequence := 1; v_event_kind := 'created';
    v_status := case when v_assignee_user_id is null then 'unassigned' else 'assigned' end;
    v_assignment_state := case when v_assignee_user_id is null then 'unassigned' else 'assigned' end;
    v_requested_at := p_requested_at; v_deadline_state := p_deadline_state;
    v_due_at := p_due_at; v_urgency := p_urgency;
  else
    if p_consultation_key is null or p_previous_event_id is null
       or p_expected_sequence is null or p_expected_sequence < 1
       or p_client_id is not null or p_discipline_code is not null
       or p_discipline_label is not null or p_urgency is not null
       or p_requested_at is not null or p_deadline_state is not null
       or p_due_at is not null or p_problem_summary is not null then
      raise exception using errcode = '22023', message = 'consultation continuation fields are invalid';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(
      'interprofessional-consultation-stream:' || p_expected_organization_id::text || ':' ||
      p_expected_branch_id::text || ':' || p_consultation_key::text, 37
    ));
    select event.* into v_previous
    from public.interprofessional_consultation_events event
    where event.id = p_previous_event_id
      and event.organization_id = p_expected_organization_id
      and event.branch_id = p_expected_branch_id
      and event.consultation_key = p_consultation_key
      and event.sequence = p_expected_sequence
      and not exists (
        select 1 from public.interprofessional_consultation_events child
        where child.previous_event_id = event.id
      )
    for share;
    if not found or not private.can_staff_access_client(v_previous.client_id, 'clients.read') then
      raise exception using errcode = '40001', message = 'consultation base event is stale or outside scope';
    end if;
    if v_previous.status = 'closed' and v_action not in ('reopen', 'correct') then
      raise exception using errcode = '40001', message = 'closed consultation requires reopen';
    end if;
    if v_previous.status <> 'closed' and v_action = 'reopen' then
      raise exception using errcode = '40001', message = 'only a closed consultation can reopen';
    end if;
    if v_action = 'assign' and v_previous.assignment_state <> 'unassigned' then
      raise exception using errcode = '40001', message = 'consultation is already assigned';
    end if;
    if v_action = 'reassign' and (v_previous.assignment_state <> 'assigned'
       or p_assignee_user_id is null or p_assignee_user_id = v_previous.assignee_user_id) then
      raise exception using errcode = '22023', message = 'consultation reassignment is invalid';
    end if;
    if v_action in ('assign', 'reassign') and p_assignee_user_id is null then
      raise exception using errcode = '22023', message = 'consultation assignee is required';
    end if;
    if v_action not in ('assign', 'reassign') and p_assignee_user_id is not null then
      raise exception using errcode = '22023', message = 'consultation assignee change is not allowed';
    end if;
    if (v_action in ('reply', 'supplement', 'reassign', 'close', 'reopen', 'correct'))
       <> (v_entry_content is not null) then
      raise exception using errcode = '22023', message = 'consultation action content is invalid';
    end if;
    if (v_action = 'correct') <> (p_corrects_event_id is not null) then
      raise exception using errcode = '22023', message = 'consultation correction target is invalid';
    end if;
    if p_corrects_event_id is not null then
      select target.* into v_target
      from public.interprofessional_consultation_events target
      where target.id = p_corrects_event_id
        and target.organization_id = p_expected_organization_id
        and target.branch_id = p_expected_branch_id
        and target.consultation_key = p_consultation_key
        and target.sequence <= p_expected_sequence;
      if not found then
        raise exception using errcode = '22023', message = 'consultation correction target is invalid';
      end if;
    end if;
    if v_action in ('reply', 'supplement')
       and v_actor is distinct from v_previous.assignee_user_id then
      raise exception using errcode = '42501', message = 'only the exact assignee can respond';
    end if;
    v_client_id := v_previous.client_id; v_client_name := v_previous.client_display_name;
    v_client_code := v_previous.client_code; v_requester_user_id := v_previous.requester_user_id;
    v_requester_membership_id := v_previous.requester_membership_id;
    v_requester_name := v_previous.requester_display_name;
    v_prev_assignee := v_previous.assignee_user_id;
    v_assignee_user_id := case when v_action in ('assign', 'reassign')
      then p_assignee_user_id else v_previous.assignee_user_id end;
    if v_assignee_user_id is not null then
      select staff.membership_id, staff.display_name
        into v_assignee_membership_id, v_assignee_name
      from private.interprofessional_consultation_staff_snapshot(
        p_expected_organization_id, p_expected_branch_id, v_assignee_user_id,
        'interprofessional_consultations.respond', v_client_id, v_now
      ) staff;
      if v_assignee_membership_id is null then
        raise exception using errcode = '42501', message = 'consultation assignee is not current or eligible';
      end if;
    end if;
    if not private.interprofessional_consultation_user_has_permission(
      p_expected_organization_id, p_expected_branch_id, v_requester_user_id,
      'interprofessional_consultations.create', v_now
    ) then
      raise exception using errcode = '42501', message = 'consultation requester is no longer current';
    end if;
    v_sequence := v_previous.sequence + 1;
    v_event_kind := case v_action when 'assign' then 'assigned'
      when 'reassign' then 'reassigned' when 'close' then 'closed'
      when 'reopen' then 'reopened' when 'correct' then 'corrected' else v_action end;
    v_assignment_state := case when v_assignee_user_id is null then 'unassigned' else 'assigned' end;
    v_status := case v_action when 'reply' then 'answered' when 'close' then 'closed'
      when 'assign' then 'assigned' when 'reassign' then 'assigned'
      when 'reopen' then case when v_assignee_user_id is null then 'unassigned' else 'assigned' end
      else v_previous.status end;
    v_requested_at := v_previous.requested_at; v_deadline_state := v_previous.deadline_state;
    v_due_at := v_previous.due_at; v_urgency := v_previous.urgency;
    v_discipline_code := v_previous.discipline_code;
    v_discipline_label := v_previous.discipline_label;
    v_problem_summary := v_previous.problem_summary;
  end if;

  if v_sequence > 10000 then
    raise exception using errcode = '54000', message = 'consultation event sequence is exhausted';
  end if;
  v_content_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version', 1, 'consultation_key', v_key, 'sequence', v_sequence,
    'previous_event_id', p_previous_event_id, 'corrects_event_id', p_corrects_event_id,
    'event_kind', v_event_kind, 'client_id', v_client_id,
    'requester_user_id', v_requester_user_id, 'assignee_user_id', v_assignee_user_id,
    'discipline_code', v_discipline_code, 'discipline_label', v_discipline_label,
    'discipline_taxonomy_status', 'manual_unstandardized', 'urgency', v_urgency,
    'urgency_source', 'manual', 'requested_at', v_requested_at,
    'deadline_state', v_deadline_state, 'due_at', v_due_at,
    'problem_summary', v_problem_summary, 'entry_content', v_entry_content,
    'status', v_status, 'occurred_at', v_now, 'actor_user_id', v_actor
  )::text, 'UTF8')), 'hex');
  select btrim(profile.display_name) into strict v_requester_name
  from public.profiles profile where profile.id = v_requester_user_id;
  -- Keep the original requester snapshot after the current-eligibility check.
  if v_action <> 'create' then v_requester_name := v_previous.requester_display_name; end if;

  insert into public.interprofessional_consultation_events (
    id, organization_id, branch_id, consultation_key, sequence,
    previous_event_id, corrects_event_id, event_kind,
    client_id, client_display_name, client_code,
    requester_user_id, requester_membership_id, requester_display_name,
    assignee_user_id, assignee_membership_id, assignee_display_name, assignment_state,
    discipline_code, discipline_label, discipline_taxonomy_status,
    urgency, urgency_source, requested_at, deadline_state, due_at,
    problem_summary, entry_content, status, occurred_at,
    actor_user_id, actor_display_name, reauth_challenge_id, content_hash
  ) values (
    v_event_id, p_expected_organization_id, p_expected_branch_id, v_key, v_sequence,
    p_previous_event_id, p_corrects_event_id, v_event_kind,
    v_client_id, v_client_name, v_client_code,
    v_requester_user_id, v_requester_membership_id, v_requester_name,
    v_assignee_user_id, v_assignee_membership_id, v_assignee_name, v_assignment_state,
    v_discipline_code, v_discipline_label, 'manual_unstandardized',
    v_urgency, 'manual', v_requested_at, v_deadline_state, v_due_at,
    v_problem_summary, v_entry_content, v_status, v_now,
    v_actor, (select btrim(display_name) from public.profiles where id = v_actor),
    v_reauth, v_content_hash
  );

  with raw_recipients as (
    select v_requester_user_id user_id, v_requester_membership_id membership_id,
      v_requester_name display_name, 'requester' reason
    union all
    select v_assignee_user_id, v_assignee_membership_id, v_assignee_name, 'assignee'
      where v_assignee_user_id is not null
    union all
    select v_previous.assignee_user_id, v_previous.assignee_membership_id,
      v_previous.assignee_display_name, 'previous_assignee'
      where v_action = 'reassign' and v_previous.assignee_user_id is not null
        and v_previous.assignee_user_id is distinct from v_assignee_user_id
        and private.interprofessional_consultation_user_has_permission(
          p_expected_organization_id, p_expected_branch_id,
          v_previous.assignee_user_id, 'interprofessional_consultations.read', v_now
        )
  ), recipients as (
    select user_id, min(membership_id::text)::uuid membership_id,
      min(display_name) display_name, array_agg(distinct reason order by reason) reasons
    from raw_recipients group by user_id
  ), inserted as (
    insert into public.interprofessional_consultation_notification_outbox (
      organization_id, branch_id, consultation_key, source_event_id, source_sequence,
      recipient_user_id, recipient_membership_id, recipient_display_name,
      recipient_reasons, channel, queue_status, delivery_claim,
      external_provider_status, queued_at, correlation_id, content_hash
    ) select p_expected_organization_id, p_expected_branch_id, v_key, v_event_id,
      v_sequence, recipient.user_id, recipient.membership_id, recipient.display_name,
      recipient.reasons, 'in_app', 'queued', 'queued_not_delivered', 'not_configured',
      v_now, gen_random_uuid(), encode(sha256(convert_to(jsonb_build_object(
        'schema_version', 1, 'source_event_id', v_event_id,
        'recipient_user_id', recipient.user_id, 'recipient_reasons', recipient.reasons,
        'channel', 'in_app', 'queue_status', 'queued',
        'delivery_claim', 'queued_not_delivered', 'external_provider_status', 'not_configured'
      )::text, 'UTF8')), 'hex')
    from recipients recipient
    returning id
  ) select count(*)::integer into v_notification_count from inserted;
  if v_notification_count < 1 then
    raise exception using errcode = '40001', message = 'consultation recipient snapshot is empty';
  end if;

  insert into private.interprofessional_consultation_operations (
    id, organization_id, branch_id, actor_user_id, idempotency_key,
    operation_kind, request_hash, result_consultation_key, result_event_id,
    result_sequence, previous_event_id, result_status, result_assignee_user_id,
    notification_count, reauth_challenge_id, committed_at
  ) values (
    v_operation_id, p_expected_organization_id, p_expected_branch_id, v_actor,
    p_idempotency_key, v_action, v_request_hash, v_key, v_event_id,
    v_sequence, p_previous_event_id, v_status, v_assignee_user_id,
    v_notification_count, v_reauth, v_now
  );
  if not private.interprofessional_consultation_authority(
    p_expected_organization_id, p_expected_branch_id, v_permission, v_require_aal2
  ) then
    raise exception using errcode = '42501', message = 'consultation authority expired';
  end if;
  return query select p_expected_organization_id, p_expected_branch_id,
    v_operation_id, v_action, v_key, v_event_id, v_sequence,
    p_previous_event_id, v_event_kind, v_status, v_assignment_state,
    v_assignee_user_id, v_deadline_state, v_notification_count,
    'queued'::text, 'queued_not_delivered'::text, 'not_configured'::text,
    v_now, false;
end;
$$;

create or replace function public.mutate_interprofessional_consultation(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_action text,
  p_consultation_key uuid,
  p_previous_event_id uuid,
  p_expected_sequence integer,
  p_client_id uuid,
  p_assignee_user_id uuid,
  p_discipline_code text,
  p_discipline_label text,
  p_urgency text,
  p_requested_at timestamptz,
  p_deadline_state text,
  p_due_at timestamptz,
  p_problem_summary text,
  p_entry_content text,
  p_corrects_event_id uuid,
  p_idempotency_key uuid
)
returns table(
  organization_id uuid, branch_id uuid,
  operation_id uuid, operation_kind text, consultation_key uuid,
  event_id uuid, event_sequence integer, previous_event_id uuid,
  event_kind text, consultation_status text, assignment_state text,
  assignee_user_id uuid, deadline_state text, notification_count integer,
  notification_queue_status text, notification_delivery_claim text,
  external_provider_status text, committed_at timestamptz, replayed boolean
)
language sql volatile security invoker set search_path = '' as $$
  select * from private.mutate_interprofessional_consultation_guarded(
    p_expected_organization_id, p_expected_branch_id, p_action,
    p_consultation_key, p_previous_event_id, p_expected_sequence,
    p_client_id, p_assignee_user_id, p_discipline_code, p_discipline_label,
    p_urgency, p_requested_at, p_deadline_state, p_due_at,
    p_problem_summary, p_entry_content, p_corrects_event_id, p_idempotency_key
  );
$$;

create or replace function private.interprofessional_consultation_snapshot_response(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_requester_user_id uuid,
  p_assignee_mode text,
  p_assignee_user_id uuid,
  p_discipline_code text,
  p_urgency text,
  p_status text,
  p_deadline_filter text,
  p_due_from date,
  p_due_to date,
  p_query text
)
returns table(
  organization_id uuid, organization_name text, branch_id uuid, branch_name text,
  generated_at timestamptz, snapshot_token text, items jsonb,
  matching_total bigint, unassigned_total bigint, in_progress_total bigint,
  overdue_total bigint, closed_total bigint, deadline_missing_total bigint,
  deadline_not_applicable_total bigint, items_truncated boolean,
  client_options jsonb, requester_options jsonb, assignee_options jsonb,
  discipline_options jsonb, can_create boolean, can_assign boolean,
  can_respond boolean, can_correct boolean, can_close boolean, taxonomy_status text,
  notification_queue_status text, notification_delivery_claim text,
  external_provider_status text
)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid(); v_now timestamptz := clock_timestamp();
  v_query text := nullif(btrim(p_query), '');
  v_discipline text := nullif(btrim(p_discipline_code), '');
  v_organization_name text; v_branch_name text; v_items jsonb;
  v_matching bigint; v_unassigned bigint; v_in_progress bigint; v_overdue bigint;
  v_closed bigint; v_missing bigint; v_not_applicable bigint;
  v_clients jsonb; v_requesters jsonb; v_assignees jsonb; v_disciplines jsonb;
begin
  if p_expected_organization_id is null or p_expected_branch_id is null
     or p_assignee_mode not in ('all', 'assigned', 'unassigned', 'specific')
     or (p_assignee_mode = 'specific') <> (p_assignee_user_id is not null)
     or p_urgency not in ('all', 'routine', 'soon', 'urgent')
     or p_status not in ('all', 'unassigned', 'assigned', 'answered', 'closed')
     or p_deadline_filter not in ('all', 'dated', 'missing', 'not_applicable', 'overdue')
     or (p_due_from is not null and p_due_to is not null and p_due_from > p_due_to)
     or (v_discipline is not null and (
       char_length(v_discipline) > 40 or v_discipline !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$'
     ))
     or (v_query is not null and (char_length(v_query) > 120 or v_query ~ '[[:cntrl:]]'))
     or not private.interprofessional_consultation_authority(
       p_expected_organization_id, p_expected_branch_id,
       'interprofessional_consultations.read', false
     ) then
    raise exception using errcode = '42501', message = 'consultation snapshot is not permitted';
  end if;

  with current_events as materialized (
    select distinct on (event.consultation_key) event.*
    from public.interprofessional_consultation_events event
    where event.organization_id = p_expected_organization_id
      and event.branch_id = p_expected_branch_id
    order by event.consultation_key, event.sequence desc, event.id desc
  ), filtered as materialized (
    select current.* from current_events current
    where private.can_staff_access_client(current.client_id, 'clients.read')
      and (p_client_id is null or current.client_id = p_client_id)
      and (p_requester_user_id is null or current.requester_user_id = p_requester_user_id)
      and (p_assignee_mode = 'all'
        or (p_assignee_mode = 'assigned' and current.assignee_user_id is not null)
        or (p_assignee_mode = 'unassigned' and current.assignee_user_id is null)
        or (p_assignee_mode = 'specific' and current.assignee_user_id = p_assignee_user_id))
      and (v_discipline is null or current.discipline_code = v_discipline)
      and (p_urgency = 'all' or current.urgency = p_urgency)
      and (p_status = 'all' or current.status = p_status)
      and (p_deadline_filter = 'all'
        or p_deadline_filter = current.deadline_state
        or (p_deadline_filter = 'overdue' and current.deadline_state = 'dated'
          and current.due_at < v_now and current.status <> 'closed'))
      and (p_due_from is null or (current.deadline_state = 'dated'
        and (current.due_at at time zone 'Asia/Taipei')::date >= p_due_from))
      and (p_due_to is null or (current.deadline_state = 'dated'
        and (current.due_at at time zone 'Asia/Taipei')::date <= p_due_to))
      and (v_query is null or lower(current.problem_summary) like '%' || lower(v_query) || '%')
  ), selected as materialized (
    select * from filtered
    order by case when deadline_state = 'dated' then due_at end nulls last,
      requested_at desc, consultation_key limit 200
  ), bundled as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'event_id', selected.id, 'consultation_key', selected.consultation_key,
      'sequence', selected.sequence, 'previous_event_id', selected.previous_event_id,
      'corrects_event_id', selected.corrects_event_id, 'event_kind', selected.event_kind,
      'client_id', selected.client_id, 'client_display_name', selected.client_display_name,
      'client_code', selected.client_code,
      'requester_user_id', selected.requester_user_id,
      'requester_display_name', selected.requester_display_name,
      'assignee_user_id', selected.assignee_user_id,
      'assignee_display_name', selected.assignee_display_name,
      'assignment_state', selected.assignment_state,
      'discipline_code', selected.discipline_code,
      'discipline_label', selected.discipline_label,
      'discipline_taxonomy_status', selected.discipline_taxonomy_status,
      'urgency', selected.urgency, 'urgency_source', selected.urgency_source,
      'requested_at', selected.requested_at,
      'deadline_state', selected.deadline_state, 'due_at', selected.due_at,
      'problem_summary', selected.problem_summary,
      'entry_content', selected.entry_content, 'status', selected.status,
      'occurred_at', selected.occurred_at,
      'actor_display_name', selected.actor_display_name,
      'content_hash', selected.content_hash,
      'notification', jsonb_build_object(
        'queue_status', 'queued', 'delivery_claim', 'queued_not_delivered',
        'external_provider_status', 'not_configured',
        'recipient_count', (select count(*) from public.interprofessional_consultation_notification_outbox outbox
          where outbox.source_event_id = selected.id)
      ),
      'history', (select coalesce(jsonb_agg(jsonb_build_object(
        'event_id', history.id, 'sequence', history.sequence,
        'event_kind', history.event_kind, 'corrects_event_id', history.corrects_event_id,
        'entry_content', history.entry_content, 'status', history.status,
        'assignee_display_name', history.assignee_display_name,
        'occurred_at', history.occurred_at,
        'actor_display_name', history.actor_display_name,
        'content_hash', history.content_hash,
        'notification_recipient_count', (select count(*) from public.interprofessional_consultation_notification_outbox history_outbox
          where history_outbox.source_event_id = history.id)
      ) order by history.sequence desc), '[]'::jsonb)
      from public.interprofessional_consultation_events history
      where history.organization_id = selected.organization_id
        and history.branch_id = selected.branch_id
        and history.consultation_key = selected.consultation_key)
    ) order by case when selected.deadline_state = 'dated' then selected.due_at end nulls last,
      selected.requested_at desc, selected.consultation_key), '[]'::jsonb) value
    from selected
  ), metrics as (
    select count(*) matching_total,
      count(*) filter (where assignment_state = 'unassigned') unassigned_total,
      count(*) filter (where status in ('assigned', 'answered')) in_progress_total,
      count(*) filter (where deadline_state = 'dated' and due_at < v_now and status <> 'closed') overdue_total,
      count(*) filter (where status = 'closed') closed_total,
      count(*) filter (where deadline_state = 'missing') deadline_missing_total,
      count(*) filter (where deadline_state = 'not_applicable') deadline_not_applicable_total
    from filtered
  ), clients as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'client_id', option.id, 'display_name', option.display_name, 'client_code', option.client_code
    ) order by option.display_name collate "C", option.id), '[]'::jsonb) value
    from (select client.id, client.display_name, client.client_code
      from public.clients client
      where client.organization_id = p_expected_organization_id
        and client.branch_id = p_expected_branch_id and client.status = 'active'
        and private.can_staff_access_client(client.id, 'clients.read')
      order by client.display_name collate "C", client.id limit 200) option
  ), requesters as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'user_id', option.requester_user_id, 'display_name', option.requester_display_name
    ) order by option.requester_display_name collate "C", option.requester_user_id), '[]'::jsonb) value
    from (select current.requester_user_id,
        min(current.requester_display_name) requester_display_name
      from current_events current where private.can_staff_access_client(current.client_id, 'clients.read')
      group by current.requester_user_id
      order by min(current.requester_display_name) collate "C", current.requester_user_id limit 200) option
  ), assignees as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'user_id', option.id, 'display_name', option.display_name
    ) order by option.display_name collate "C", option.id), '[]'::jsonb) value
    from (select profile.id, min(profile.display_name) display_name
      from public.profiles profile
      join public.memberships membership on membership.profile_id = profile.id
      where profile.is_active and profile.kind in ('staff', 'professional')
        and membership.organization_id = p_expected_organization_id
        and membership.status = 'active' and membership.starts_at <= v_now
        and (membership.ends_at is null or membership.ends_at > v_now)
        and (membership.branch_id is null or membership.branch_id = p_expected_branch_id)
        and private.interprofessional_consultation_user_has_permission(
          p_expected_organization_id, p_expected_branch_id, profile.id,
          'interprofessional_consultations.respond', v_now
        )
      group by profile.id
      order by min(profile.display_name) collate "C", profile.id limit 200) option
  ), disciplines as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'code', option.discipline_code, 'label', option.discipline_label,
      'taxonomy_status', 'manual_unstandardized'
    ) order by option.discipline_label collate "C", option.discipline_code), '[]'::jsonb) value
    from (select current.discipline_code, min(current.discipline_label) discipline_label
      from current_events current where private.can_staff_access_client(current.client_id, 'clients.read')
      group by current.discipline_code
      order by min(current.discipline_label) collate "C", current.discipline_code limit 100) option
  )
  select organization.name, branch.name, bundled.value,
    metrics.matching_total, metrics.unassigned_total, metrics.in_progress_total,
    metrics.overdue_total, metrics.closed_total, metrics.deadline_missing_total,
    metrics.deadline_not_applicable_total,
    clients.value, requesters.value, assignees.value, disciplines.value
  into v_organization_name, v_branch_name, v_items,
    v_matching, v_unassigned, v_in_progress, v_overdue, v_closed,
    v_missing, v_not_applicable, v_clients, v_requesters, v_assignees, v_disciplines
  from public.organizations organization join public.branches branch
    on branch.id = p_expected_branch_id and branch.organization_id = organization.id
  cross join bundled cross join metrics cross join clients
  cross join requesters cross join assignees cross join disciplines
  where organization.id = p_expected_organization_id;

  if v_organization_name is null or v_branch_name is null then
    raise exception using errcode = '42501', message = 'consultation scope is unavailable';
  end if;
  insert into public.audit_events (
    organization_id, branch_id, actor_user_id, action, table_name, row_pk,
    changed_fields, metadata
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_actor, 'select',
    'interprofessional_consultation_snapshot', null, '{}'::text[], jsonb_build_object(
      'workflow', 'page37_interprofessional_consultation_v1',
      'client_filter_present', p_client_id is not null,
      'requester_filter_present', p_requester_user_id is not null,
      'assignee_filter', p_assignee_mode,
      'discipline_filter_present', v_discipline is not null,
      'urgency_filter', p_urgency, 'status_filter', p_status,
      'deadline_filter', p_deadline_filter,
      'date_filter_present', p_due_from is not null or p_due_to is not null,
      'query_present', v_query is not null, 'matching_total', v_matching
    )
  );
  if not private.interprofessional_consultation_authority(
    p_expected_organization_id, p_expected_branch_id,
    'interprofessional_consultations.read', false
  ) then
    raise exception using errcode = '42501', message = 'consultation authority expired';
  end if;
  return query select p_expected_organization_id, v_organization_name,
    p_expected_branch_id, v_branch_name, v_now,
    encode(sha256(convert_to(jsonb_build_object(
      'organization_id', p_expected_organization_id,
      'branch_id', p_expected_branch_id, 'items', v_items
    )::text, 'UTF8')), 'hex'),
    v_items, v_matching, v_unassigned, v_in_progress, v_overdue, v_closed,
    v_missing, v_not_applicable, v_matching > jsonb_array_length(v_items),
    v_clients, v_requesters, v_assignees, v_disciplines,
    private.interprofessional_consultation_authority(
      p_expected_organization_id, p_expected_branch_id,
      'interprofessional_consultations.create', true),
    private.interprofessional_consultation_authority(
      p_expected_organization_id, p_expected_branch_id,
      'interprofessional_consultations.assign', true),
    private.interprofessional_consultation_authority(
      p_expected_organization_id, p_expected_branch_id,
      'interprofessional_consultations.respond', false),
    private.interprofessional_consultation_authority(
      p_expected_organization_id, p_expected_branch_id,
      'interprofessional_consultations.respond', true),
    private.interprofessional_consultation_authority(
      p_expected_organization_id, p_expected_branch_id,
      'interprofessional_consultations.close', true),
    'manual_unstandardized'::text, 'queued'::text,
    'queued_not_delivered'::text, 'not_configured'::text;
end;
$$;

create or replace function public.interprofessional_consultation_snapshot(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid default null,
  p_requester_user_id uuid default null,
  p_assignee_mode text default 'all',
  p_assignee_user_id uuid default null,
  p_discipline_code text default null,
  p_urgency text default 'all',
  p_status text default 'all',
  p_deadline_filter text default 'all',
  p_due_from date default null,
  p_due_to date default null,
  p_query text default null
)
returns table(
  organization_id uuid, organization_name text, branch_id uuid, branch_name text,
  generated_at timestamptz, snapshot_token text, items jsonb,
  matching_total bigint, unassigned_total bigint, in_progress_total bigint,
  overdue_total bigint, closed_total bigint, deadline_missing_total bigint,
  deadline_not_applicable_total bigint, items_truncated boolean,
  client_options jsonb, requester_options jsonb, assignee_options jsonb,
  discipline_options jsonb, can_create boolean, can_assign boolean,
  can_respond boolean, can_correct boolean, can_close boolean, taxonomy_status text,
  notification_queue_status text, notification_delivery_claim text,
  external_provider_status text
)
language sql volatile security invoker set search_path = '' as $$
  select * from private.interprofessional_consultation_snapshot_response(
    p_expected_organization_id, p_expected_branch_id, p_client_id,
    p_requester_user_id, p_assignee_mode, p_assignee_user_id,
    p_discipline_code, p_urgency, p_status, p_deadline_filter,
    p_due_from, p_due_to, p_query
  );
$$;

revoke all on function private.prevent_interprofessional_consultation_mutation()
  from public, anon, authenticated, service_role;
revoke all on function private.interprofessional_consultation_authority(uuid,uuid,text,boolean)
  from public, anon, authenticated, service_role;
revoke all on function private.interprofessional_consultation_user_has_permission(uuid,uuid,uuid,text,timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.interprofessional_consultation_user_can_access_client(uuid,uuid,uuid,uuid,timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.interprofessional_consultation_staff_snapshot(uuid,uuid,uuid,text,uuid,timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.require_interprofessional_consultation_reauth(uuid,timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.mutate_interprofessional_consultation_guarded(uuid,uuid,text,uuid,uuid,integer,uuid,uuid,text,text,text,timestamptz,text,timestamptz,text,text,uuid,uuid)
  from public, anon, service_role;
revoke all on function private.interprofessional_consultation_snapshot_response(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,date,date,text)
  from public, anon, service_role;
revoke all on function public.mutate_interprofessional_consultation(uuid,uuid,text,uuid,uuid,integer,uuid,uuid,text,text,text,timestamptz,text,timestamptz,text,text,uuid,uuid)
  from public, anon, service_role;
revoke all on function public.interprofessional_consultation_snapshot(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,date,date,text)
  from public, anon, service_role;
grant execute on function private.mutate_interprofessional_consultation_guarded(uuid,uuid,text,uuid,uuid,integer,uuid,uuid,text,text,text,timestamptz,text,timestamptz,text,text,uuid,uuid)
  to authenticated;
grant execute on function private.interprofessional_consultation_snapshot_response(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,date,date,text)
  to authenticated;
grant execute on function public.mutate_interprofessional_consultation(uuid,uuid,text,uuid,uuid,integer,uuid,uuid,text,text,text,timestamptz,text,timestamptz,text,text,uuid,uuid)
  to authenticated;
grant execute on function public.interprofessional_consultation_snapshot(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,date,date,text)
  to authenticated;

-- PostgreSQL identifiers are limited to 63 bytes. Keep the physical public
-- table name short enough for the foundation's exact `<table>_audit_row_change`
-- trigger contract, while retaining the descriptive internal view used above.
alter table public.interprofessional_consultation_notification_outbox
  rename to interprofessional_consultation_outbox;
alter trigger interprofessional_consultation_notification_outbox_prevent_mutation
  on public.interprofessional_consultation_outbox
  rename to interprofessional_consultation_outbox_prevent_mutation;
alter trigger interprofessional_consultation_notification_outbox_audit_row_change
  on public.interprofessional_consultation_outbox
  rename to interprofessional_consultation_outbox_audit_row_change;
create view public.interprofessional_consultation_notification_outbox
with (security_invoker = true) as
select * from public.interprofessional_consultation_outbox;
revoke all on table public.interprofessional_consultation_notification_outbox
  from public, anon, authenticated, service_role;

comment on table public.interprofessional_consultation_events is
  'Page 37 immutable event ledger. Discipline is manual_unstandardized until a governed taxonomy is published.';
comment on table public.interprofessional_consultation_outbox is
  'Page 37 immutable frozen-recipient in-app queued evidence. External providers are not configured and no delivery is claimed.';
comment on view public.interprofessional_consultation_notification_outbox is
  'Security-invoker compatibility view for the Page 37 immutable notification outbox.';
comment on function public.interprofessional_consultation_snapshot(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,date,date,text) is
  'Page 37 audited server snapshot; full-set metrics are computed before the 200-row detail limit.';
