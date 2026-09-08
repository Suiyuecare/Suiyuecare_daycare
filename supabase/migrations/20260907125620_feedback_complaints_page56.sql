-- Page 56: immutable, permission-masked feedback and complaint handling.
-- No production deadline rules are seeded. Intake therefore fails closed until
-- an approved exact rule version is published through a separate governance path.

insert into public.permissions (permission_key, description, risk_level)
values
  ('complaints.read', 'Read branch feedback and complaint case metadata', 2),
  ('complaints.manage', 'Create and append feedback and complaint handling events', 2),
  ('complaints.sensitive', 'Read and correct sensitive complaint narratives and reporter details', 3),
  ('complaints.close', 'Close complaint cases with recent same-session AAL2 evidence', 3)
on conflict (permission_key) do update
set description = excluded.description, risk_level = excluded.risk_level;

insert into public.role_permissions (role_id, permission_id)
select role.id, permission.id
from public.roles role
cross join public.permissions permission
where role.organization_id is null
  and role.role_key in ('organization_manager', 'branch_supervisor')
  and permission.permission_key in (
    'complaints.read', 'complaints.manage', 'complaints.sensitive', 'complaints.close'
  )
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select role.id, permission.id
from public.roles role
cross join public.permissions permission
where role.organization_id is null
  and role.role_key = 'case_manager_social_worker'
  and permission.permission_key in ('complaints.read', 'complaints.manage')
on conflict do nothing;

create table private.feedback_deadline_rule_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  branch_id uuid not null,
  label text not null,
  source text not null,
  case_type text not null,
  risk text not null,
  response_hours integer not null,
  effective_from date not null,
  effective_through date,
  published_at timestamptz not null,
  retired_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  constraint feedback_deadline_rules_branch_scope_fkey
    foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete restrict,
  constraint feedback_deadline_rules_label_check
    check (char_length(btrim(label)) between 1 and 160),
  constraint feedback_deadline_rules_source_check
    check (source in ('client', 'family', 'staff', 'anonymous', 'external')),
  constraint feedback_deadline_rules_type_check
    check (case_type in ('feedback', 'service', 'rights', 'safety', 'privacy', 'billing', 'other')),
  constraint feedback_deadline_rules_risk_check
    check (risk in ('standard', 'high')),
  constraint feedback_deadline_rules_hours_check
    check (response_hours between 1 and 8760),
  constraint feedback_deadline_rules_period_check
    check (effective_through is null or effective_through >= effective_from),
  constraint feedback_deadline_rules_publish_check
    check (retired_at is null or retired_at > published_at),
  constraint feedback_deadline_rules_id_scope_key
    unique (id, organization_id, branch_id),
  constraint feedback_deadline_rules_exact_version_key
    unique (organization_id, branch_id, source, case_type, risk, effective_from)
);

create index feedback_deadline_rules_scope_active_idx
on private.feedback_deadline_rule_versions(
  organization_id, branch_id, source, case_type, risk, effective_from, effective_through
) where retired_at is null;
create index feedback_deadline_rules_created_by_idx
on private.feedback_deadline_rule_versions(created_by);

create table public.feedback_complaint_cases (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  branch_id uuid not null,
  case_number text not null,
  deadline_rule_id uuid not null,
  received_at timestamptz not null,
  source text not null,
  case_type text not null,
  reported_risk text not null,
  due_at timestamptz not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  constraint feedback_cases_branch_scope_fkey
    foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete restrict,
  constraint feedback_cases_rule_scope_fkey
    foreign key (deadline_rule_id, organization_id, branch_id)
    references private.feedback_deadline_rule_versions(id, organization_id, branch_id)
    on delete restrict,
  constraint feedback_cases_number_check
    check (case_number ~ '^FC-[0-9]{8}-[A-F0-9]{8}$'),
  constraint feedback_cases_source_check
    check (source in ('client', 'family', 'staff', 'anonymous', 'external')),
  constraint feedback_cases_type_check
    check (case_type in ('feedback', 'service', 'rights', 'safety', 'privacy', 'billing', 'other')),
  constraint feedback_cases_risk_check check (reported_risk in ('standard', 'high')),
  constraint feedback_cases_due_check check (due_at > received_at),
  constraint feedback_cases_scope_number_key unique (organization_id, case_number),
  constraint feedback_cases_id_scope_key unique (id, organization_id, branch_id)
);

create index feedback_cases_scope_received_idx
on public.feedback_complaint_cases(organization_id, branch_id, received_at desc, id);
create index feedback_cases_scope_due_idx
on public.feedback_complaint_cases(organization_id, branch_id, due_at, id);
create index feedback_cases_rule_idx on public.feedback_complaint_cases(deadline_rule_id);
create index feedback_cases_created_by_idx on public.feedback_complaint_cases(created_by);

create table public.feedback_complaint_events (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  branch_id uuid not null,
  case_id uuid not null,
  version integer not null,
  event_type text not null,
  resulting_status text not null,
  risk_after text not null,
  automatic_reason text,
  assignee_membership_id uuid references public.memberships(id) on delete restrict,
  corrected_event_id uuid references public.feedback_complaint_events(id) on delete restrict,
  occurred_at timestamptz not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  committed_at timestamptz not null default clock_timestamp(),
  constraint feedback_events_case_scope_fkey
    foreign key (case_id, organization_id, branch_id)
    references public.feedback_complaint_cases(id, organization_id, branch_id)
    on delete restrict,
  constraint feedback_events_version_check check (version > 0),
  constraint feedback_events_type_check
    check (event_type in ('created', 'assignment', 'progress', 'correction', 'closure')),
  constraint feedback_events_status_check
    check (resulting_status in ('received', 'assigned', 'in_progress', 'escalated', 'closed')),
  constraint feedback_events_risk_check check (risk_after in ('standard', 'high')),
  constraint feedback_events_automatic_reason_check check (
    automatic_reason is null or automatic_reason in (
      'high_risk', 'overdue', 'high_risk_and_overdue'
    )
  ),
  constraint feedback_events_correction_target_check check (
    (event_type = 'correction') = (corrected_event_id is not null)
  ),
  constraint feedback_events_closure_status_check check (
    (event_type = 'closure') = (resulting_status = 'closed')
  ),
  constraint feedback_events_case_version_key unique (case_id, version),
  constraint feedback_events_id_case_key unique (id, case_id)
);

create index feedback_events_scope_case_version_idx
on public.feedback_complaint_events(organization_id, branch_id, case_id, version desc);
create index feedback_events_assignee_idx
on public.feedback_complaint_events(assignee_membership_id)
where assignee_membership_id is not null;
create index feedback_events_actor_idx on public.feedback_complaint_events(actor_user_id);
create index feedback_events_corrected_idx
on public.feedback_complaint_events(corrected_event_id)
where corrected_event_id is not null;

create table private.feedback_complaint_sensitive_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  branch_id uuid not null,
  case_id uuid not null,
  version integer not null,
  previous_version_id uuid references private.feedback_complaint_sensitive_versions(id)
    on delete restrict,
  reporter_name text,
  reporter_contact text,
  subject text not null,
  description text not null,
  correction_event_id uuid references public.feedback_complaint_events(id) on delete restrict,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  constraint feedback_sensitive_case_scope_fkey
    foreign key (case_id, organization_id, branch_id)
    references public.feedback_complaint_cases(id, organization_id, branch_id)
    on delete restrict,
  constraint feedback_sensitive_version_check check (version > 0),
  constraint feedback_sensitive_reporter_name_check
    check (reporter_name is null or char_length(btrim(reporter_name)) between 1 and 160),
  constraint feedback_sensitive_reporter_contact_check
    check (reporter_contact is null or char_length(btrim(reporter_contact)) between 1 and 240),
  constraint feedback_sensitive_subject_check
    check (char_length(btrim(subject)) between 1 and 240),
  constraint feedback_sensitive_description_check
    check (char_length(btrim(description)) between 1 and 4000),
  constraint feedback_sensitive_lineage_check check (
    (version = 1 and previous_version_id is null and correction_event_id is null)
    or (version > 1 and previous_version_id is not null and correction_event_id is not null)
  ),
  constraint feedback_sensitive_case_version_key unique (case_id, version),
  constraint feedback_sensitive_id_case_key unique (id, case_id)
);

create index feedback_sensitive_scope_case_version_idx
on private.feedback_complaint_sensitive_versions(
  organization_id, branch_id, case_id, version desc
);
create index feedback_sensitive_previous_idx
on private.feedback_complaint_sensitive_versions(previous_version_id)
where previous_version_id is not null;
create index feedback_sensitive_correction_event_idx
on private.feedback_complaint_sensitive_versions(correction_event_id)
where correction_event_id is not null;
create index feedback_sensitive_creator_idx
on private.feedback_complaint_sensitive_versions(created_by);

create table private.feedback_complaint_event_details (
  event_id uuid primary key references public.feedback_complaint_events(id) on delete restrict,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  branch_id uuid not null,
  case_id uuid not null,
  note text not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint feedback_event_details_event_case_fkey
    foreign key (event_id, case_id)
    references public.feedback_complaint_events(id, case_id) on delete restrict,
  constraint feedback_event_details_case_scope_fkey
    foreign key (case_id, organization_id, branch_id)
    references public.feedback_complaint_cases(id, organization_id, branch_id)
    on delete restrict,
  constraint feedback_event_details_note_check
    check (char_length(btrim(note)) between 1 and 4000)
);

create index feedback_event_details_scope_case_idx
on private.feedback_complaint_event_details(organization_id, branch_id, case_id);

create table private.feedback_complaint_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  branch_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  idempotency_key uuid not null,
  action text not null,
  request_hash text not null,
  case_id uuid not null,
  case_number text not null,
  event_id uuid not null,
  result_version integer not null,
  result_status text not null,
  result_risk text not null,
  due_at timestamptz not null,
  committed_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint feedback_operations_branch_scope_fkey
    foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete restrict,
  constraint feedback_operations_case_scope_fkey
    foreign key (case_id, organization_id, branch_id)
    references public.feedback_complaint_cases(id, organization_id, branch_id)
    on delete restrict,
  constraint feedback_operations_event_case_fkey
    foreign key (event_id, case_id)
    references public.feedback_complaint_events(id, case_id) on delete restrict,
  constraint feedback_operations_action_check
    check (action in ('create', 'assign', 'progress', 'correct', 'close')),
  constraint feedback_operations_hash_check check (request_hash ~ '^[a-f0-9]{64}$'),
  constraint feedback_operations_version_check check (result_version > 0),
  constraint feedback_operations_status_check
    check (result_status in ('received', 'assigned', 'in_progress', 'escalated', 'closed')),
  constraint feedback_operations_risk_check check (result_risk in ('standard', 'high')),
  constraint feedback_operations_actor_key unique (actor_user_id, idempotency_key)
);

create index feedback_operations_scope_case_idx
on private.feedback_complaint_operations(organization_id, branch_id, case_id);
create index feedback_operations_event_idx on private.feedback_complaint_operations(event_id);

alter table public.feedback_complaint_cases enable row level security;
alter table public.feedback_complaint_cases force row level security;
alter table public.feedback_complaint_events enable row level security;
alter table public.feedback_complaint_events force row level security;

create policy feedback_cases_select on public.feedback_complaint_cases
for select to authenticated
using ((select private.has_permission(organization_id, branch_id, 'complaints.read')));

create policy feedback_events_select on public.feedback_complaint_events
for select to authenticated
using ((select private.has_permission(organization_id, branch_id, 'complaints.read')));

revoke all on table public.feedback_complaint_cases
from public, anon, authenticated, service_role;
revoke all on table public.feedback_complaint_events
from public, anon, authenticated, service_role;
revoke all on table private.feedback_deadline_rule_versions
from public, anon, authenticated, service_role;
revoke all on table private.feedback_complaint_sensitive_versions
from public, anon, authenticated, service_role;
revoke all on table private.feedback_complaint_event_details
from public, anon, authenticated, service_role;
revoke all on table private.feedback_complaint_operations
from public, anon, authenticated, service_role;

create or replace function private.feedback_complaint_text_ok(
  p_value text,
  p_maximum integer,
  p_nullable boolean default false
)
returns boolean
language sql immutable security invoker set search_path = '' as $$
  select case
    when p_value is null then p_nullable
    else char_length(btrim(p_value)) between 1 and p_maximum
      and p_value !~ '[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]'
  end;
$$;

create or replace function private.feedback_complaint_append_only()
returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  raise exception using errcode = '55000',
    message = 'feedback and complaint records are append-only';
end;
$$;

create trigger feedback_deadline_rules_append_only
before update or delete on private.feedback_deadline_rule_versions
for each row execute function private.feedback_complaint_append_only();
create trigger feedback_complaint_cases_append_only
before update or delete on public.feedback_complaint_cases
for each row execute function private.feedback_complaint_append_only();
create trigger feedback_complaint_events_append_only
before update or delete on public.feedback_complaint_events
for each row execute function private.feedback_complaint_append_only();
create trigger feedback_sensitive_versions_append_only
before update or delete on private.feedback_complaint_sensitive_versions
for each row execute function private.feedback_complaint_append_only();
create trigger feedback_event_details_append_only
before update or delete on private.feedback_complaint_event_details
for each row execute function private.feedback_complaint_append_only();
create trigger feedback_operations_append_only
before update or delete on private.feedback_complaint_operations
for each row execute function private.feedback_complaint_append_only();

create trigger feedback_deadline_rules_audit_row_change
after insert on private.feedback_deadline_rule_versions
for each row execute function private.audit_row_change();
create trigger feedback_complaint_cases_audit_row_change
after insert on public.feedback_complaint_cases
for each row execute function private.audit_row_change();
create trigger feedback_complaint_events_audit_row_change
after insert on public.feedback_complaint_events
for each row execute function private.audit_row_change();
create trigger feedback_sensitive_versions_audit_row_change
after insert on private.feedback_complaint_sensitive_versions
for each row execute function private.audit_row_change();
create trigger feedback_event_details_audit_row_change
after insert on private.feedback_complaint_event_details
for each row execute function private.audit_row_change();
create trigger feedback_operations_audit_row_change
after insert on private.feedback_complaint_operations
for each row execute function private.audit_row_change();

create or replace function private.feedback_complaint_authority(
  p_organization_id uuid,
  p_branch_id uuid,
  p_permission text
)
returns boolean
language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null
    and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
    and (select private.has_permission(p_organization_id, p_branch_id, p_permission));
$$;

create or replace function private.feedback_complaint_assignee_valid(
  p_organization_id uuid,
  p_branch_id uuid,
  p_membership_id uuid
)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.memberships membership
    join public.profiles profile on profile.id = membership.profile_id
    join public.membership_roles membership_role
      on membership_role.membership_id = membership.id
    join public.roles role on role.id = membership_role.role_id and role.is_active
    join public.role_permissions role_permission on role_permission.role_id = role.id
    join public.permissions permission on permission.id = role_permission.permission_id
    where membership.id = p_membership_id
      and membership.organization_id = p_organization_id
      and (membership.branch_id is null or membership.branch_id = p_branch_id)
      and membership.status = 'active'
      and membership.starts_at <= clock_timestamp()
      and (membership.ends_at is null or membership.ends_at > clock_timestamp())
      and profile.is_active and profile.kind <> 'family'
      and (role.organization_id is null or role.organization_id = p_organization_id)
      and permission.permission_key = 'complaints.manage'
  );
$$;

create or replace function private.submit_feedback_complaint_guarded(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_deadline_rule_id uuid,
  p_received_at timestamptz,
  p_reporter_name text,
  p_reporter_contact text,
  p_subject text,
  p_description text,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid, action text, case_id uuid, case_number text,
  event_id uuid, version integer, status text, effective_risk text,
  due_at timestamptz, committed_at timestamptz, replayed boolean
)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_rule private.feedback_deadline_rule_versions%rowtype;
  v_operation private.feedback_complaint_operations%rowtype;
  v_case_id uuid := gen_random_uuid();
  v_event_id uuid := gen_random_uuid();
  v_case_number text;
  v_due_at timestamptz;
  v_status text;
  v_risk text;
  v_reason text;
  v_hash text;
begin
  if p_expected_organization_id is null or p_expected_branch_id is null
     or p_deadline_rule_id is null or p_received_at is null
     or p_idempotency_key is null
     or not private.feedback_complaint_text_ok(p_reporter_name, 160, true)
     or not private.feedback_complaint_text_ok(p_reporter_contact, 240, true)
     or not private.feedback_complaint_text_ok(p_subject, 240, false)
     or not private.feedback_complaint_text_ok(p_description, 4000, false)
     or p_received_at > v_now + interval '5 minutes'
     or p_received_at < v_now - interval '10 years' then
    raise exception using errcode = '22023',
      message = 'feedback complaint intake is invalid';
  end if;
  if not private.feedback_complaint_authority(
    p_expected_organization_id, p_expected_branch_id, 'complaints.manage'
  ) then
    raise exception using errcode = '42501',
      message = 'feedback complaint intake is not permitted';
  end if;

  v_hash := encode(sha256(convert_to(jsonb_build_object(
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id,
    'deadline_rule_id', p_deadline_rule_id,
    'received_at', p_received_at,
    'reporter_name', nullif(btrim(p_reporter_name), ''),
    'reporter_contact', nullif(btrim(p_reporter_contact), ''),
    'subject', btrim(p_subject),
    'description', btrim(p_description)
  )::text, 'UTF8')), 'hex');

  perform pg_advisory_xact_lock(hashtextextended(
    'feedback-operation:' || v_actor::text || ':' || p_idempotency_key::text, 0
  ));
  select operation.* into v_operation
  from private.feedback_complaint_operations operation
  where operation.actor_user_id = v_actor
    and operation.idempotency_key = p_idempotency_key;
  if found then
    if v_operation.action <> 'create' or v_operation.request_hash <> v_hash then
      raise exception using errcode = '23505',
        message = 'feedback complaint idempotency key reused with different content';
    end if;
    return query select v_operation.id, v_operation.action,
      v_operation.case_id, v_operation.case_number, v_operation.event_id,
      v_operation.result_version, v_operation.result_status,
      v_operation.result_risk, v_operation.due_at,
      v_operation.committed_at, true;
    return;
  end if;

  select rule.* into v_rule
  from private.feedback_deadline_rule_versions rule
  where rule.id = p_deadline_rule_id
    and rule.organization_id = p_expected_organization_id
    and rule.branch_id = p_expected_branch_id
    and rule.published_at <= v_now
    and rule.effective_from <= (p_received_at at time zone 'Asia/Taipei')::date
    and (rule.effective_through is null
      or rule.effective_through >= (p_received_at at time zone 'Asia/Taipei')::date)
    and (rule.retired_at is null or rule.retired_at > v_now)
  for share;
  if not found then
    raise exception using errcode = '23514',
      message = 'an exact published feedback deadline rule is required';
  end if;

  v_due_at := p_received_at + make_interval(hours => v_rule.response_hours);
  v_reason := case
    when v_rule.risk = 'high' and v_due_at <= v_now then 'high_risk_and_overdue'
    when v_rule.risk = 'high' then 'high_risk'
    when v_due_at <= v_now then 'overdue'
    else null end;
  v_risk := case when v_reason is null then 'standard' else 'high' end;
  v_status := case when v_reason is null then 'received' else 'escalated' end;
  v_case_number := 'FC-' || to_char(p_received_at at time zone 'Asia/Taipei', 'YYYYMMDD')
    || '-' || upper(substr(replace(v_case_id::text, '-', ''), 1, 8));

  insert into public.feedback_complaint_cases(
    id, organization_id, branch_id, case_number, deadline_rule_id,
    received_at, source, case_type, reported_risk, due_at, created_by, created_at
  ) values (
    v_case_id, p_expected_organization_id, p_expected_branch_id, v_case_number,
    v_rule.id, p_received_at, v_rule.source, v_rule.case_type, v_rule.risk,
    v_due_at, v_actor, v_now
  );
  insert into public.feedback_complaint_events(
    id, organization_id, branch_id, case_id, version, event_type,
    resulting_status, risk_after, automatic_reason, assignee_membership_id,
    corrected_event_id, occurred_at, actor_user_id, committed_at
  ) values (
    v_event_id, p_expected_organization_id, p_expected_branch_id, v_case_id,
    1, 'created', v_status, v_risk, v_reason, null, null,
    p_received_at, v_actor, v_now
  );
  insert into private.feedback_complaint_sensitive_versions(
    organization_id, branch_id, case_id, version, previous_version_id,
    reporter_name, reporter_contact, subject, description,
    correction_event_id, created_by, created_at
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_case_id, 1, null,
    nullif(btrim(p_reporter_name), ''), nullif(btrim(p_reporter_contact), ''),
    btrim(p_subject), btrim(p_description), null, v_actor, v_now
  );
  insert into private.feedback_complaint_operations(
    organization_id, branch_id, actor_user_id, idempotency_key, action,
    request_hash, case_id, case_number, event_id, result_version,
    result_status, result_risk, due_at, committed_at
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_actor,
    p_idempotency_key, 'create', v_hash, v_case_id, v_case_number,
    v_event_id, 1, v_status, v_risk, v_due_at, v_now
  ) returning id into operation_id;
  action := 'create'; case_id := v_case_id; case_number := v_case_number;
  event_id := v_event_id; version := 1; status := v_status;
  effective_risk := v_risk; due_at := v_due_at; committed_at := v_now;
  replayed := false;
  return next;
end;
$$;

create or replace function private.append_feedback_complaint_event_guarded(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_action text,
  p_case_id uuid,
  p_expected_version integer,
  p_assignee_membership_id uuid,
  p_note text,
  p_corrected_event_id uuid,
  p_correction_reason text,
  p_reporter_name text,
  p_reporter_contact text,
  p_subject text,
  p_description text,
  p_resolution text,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid, action text, case_id uuid, case_number text,
  event_id uuid, version integer, status text, effective_risk text,
  due_at timestamptz, committed_at timestamptz, replayed boolean
)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_case public.feedback_complaint_cases%rowtype;
  v_current public.feedback_complaint_events%rowtype;
  v_sensitive private.feedback_complaint_sensitive_versions%rowtype;
  v_operation private.feedback_complaint_operations%rowtype;
  v_event_id uuid := gen_random_uuid();
  v_event_type text;
  v_status text;
  v_risk text;
  v_reason text;
  v_assignee uuid;
  v_detail text;
  v_hash text;
begin
  if p_action not in ('assign', 'progress', 'correct', 'close')
     or p_expected_organization_id is null or p_expected_branch_id is null
     or p_case_id is null or p_expected_version < 1 or p_idempotency_key is null
     or (p_action = 'assign' and (
       p_assignee_membership_id is null
       or not private.feedback_complaint_text_ok(p_note, 1000, true)
     ))
     or (p_action = 'progress' and (
       p_assignee_membership_id is not null
       or not private.feedback_complaint_text_ok(p_note, 2000, false)
     ))
     or (p_action = 'correct' and (
       p_corrected_event_id is null
       or not private.feedback_complaint_text_ok(p_correction_reason, 1000, false)
       or not private.feedback_complaint_text_ok(p_reporter_name, 160, true)
       or not private.feedback_complaint_text_ok(p_reporter_contact, 240, true)
       or not private.feedback_complaint_text_ok(p_subject, 240, false)
       or not private.feedback_complaint_text_ok(p_description, 4000, false)
     ))
     or (p_action = 'close' and
       not private.feedback_complaint_text_ok(p_resolution, 4000, false))
     or (p_action <> 'assign' and p_assignee_membership_id is not null)
     or (p_action <> 'progress' and p_action <> 'assign' and p_note is not null)
     or (p_action <> 'correct' and (
       p_corrected_event_id is not null or p_correction_reason is not null
       or p_reporter_name is not null or p_reporter_contact is not null
       or p_subject is not null or p_description is not null
     ))
     or (p_action <> 'close' and p_resolution is not null) then
    raise exception using errcode = '22023',
      message = 'feedback complaint event is invalid';
  end if;
  if not private.feedback_complaint_authority(
    p_expected_organization_id, p_expected_branch_id,
    case when p_action = 'close' then 'complaints.close' else 'complaints.manage' end
  ) or (p_action = 'correct' and not private.feedback_complaint_authority(
    p_expected_organization_id, p_expected_branch_id, 'complaints.sensitive'
  )) then
    raise exception using errcode = '42501',
      message = 'feedback complaint event is not permitted';
  end if;
  if p_action in ('correct', 'close') and (
    coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
    or not (select private.has_recent_aal2(15))
  ) then
    raise exception using errcode = '42501',
      message = 'recent same-session AAL2 is required';
  end if;

  v_hash := encode(sha256(convert_to(jsonb_build_object(
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id, 'action', p_action,
    'case_id', p_case_id, 'expected_version', p_expected_version,
    'assignee_membership_id', p_assignee_membership_id,
    'note', nullif(btrim(p_note), ''), 'corrected_event_id', p_corrected_event_id,
    'correction_reason', nullif(btrim(p_correction_reason), ''),
    'reporter_name', nullif(btrim(p_reporter_name), ''),
    'reporter_contact', nullif(btrim(p_reporter_contact), ''),
    'subject', nullif(btrim(p_subject), ''),
    'description', nullif(btrim(p_description), ''),
    'resolution', nullif(btrim(p_resolution), '')
  )::text, 'UTF8')), 'hex');

  perform pg_advisory_xact_lock(hashtextextended(
    'feedback-operation:' || v_actor::text || ':' || p_idempotency_key::text, 0
  ));
  select operation.* into v_operation
  from private.feedback_complaint_operations operation
  where operation.actor_user_id = v_actor
    and operation.idempotency_key = p_idempotency_key;
  if found then
    if v_operation.action <> p_action or v_operation.request_hash <> v_hash then
      raise exception using errcode = '23505',
        message = 'feedback complaint idempotency key reused with different content';
    end if;
    return query select v_operation.id, v_operation.action,
      v_operation.case_id, v_operation.case_number, v_operation.event_id,
      v_operation.result_version, v_operation.result_status,
      v_operation.result_risk, v_operation.due_at,
      v_operation.committed_at, true;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'feedback-case:' || p_expected_organization_id::text || ':'
      || p_expected_branch_id::text || ':' || p_case_id::text, 0
  ));
  select complaint.* into v_case
  from public.feedback_complaint_cases complaint
  where complaint.id = p_case_id
    and complaint.organization_id = p_expected_organization_id
    and complaint.branch_id = p_expected_branch_id;
  if not found then
    raise exception using errcode = '42501',
      message = 'feedback complaint case is outside current scope';
  end if;
  select event.* into v_current
  from public.feedback_complaint_events event
  where event.case_id = v_case.id
  order by event.version desc
  limit 1;
  if not found or v_current.version <> p_expected_version then
    raise exception using errcode = '40001',
      message = 'feedback complaint expected version is stale';
  end if;
  if v_current.resulting_status = 'closed' then
    raise exception using errcode = '23514',
      message = 'closed feedback complaint cannot be extended';
  end if;
  if p_action = 'assign' and not private.feedback_complaint_assignee_valid(
    p_expected_organization_id, p_expected_branch_id, p_assignee_membership_id
  ) then
    raise exception using errcode = '23514',
      message = 'feedback complaint assignee is not active and authorized';
  end if;
  if p_action in ('progress', 'close') and v_current.assignee_membership_id is null then
    raise exception using errcode = '23514',
      message = 'feedback complaint must be assigned first';
  end if;
  if p_action = 'correct' and not exists (
    select 1 from public.feedback_complaint_events target
    where target.id = p_corrected_event_id and target.case_id = v_case.id
  ) then
    raise exception using errcode = '23514',
      message = 'feedback complaint correction target is invalid';
  end if;

  v_reason := case
    when (v_case.reported_risk = 'high' or v_current.risk_after = 'high')
      and v_case.due_at <= v_now then 'high_risk_and_overdue'
    when v_case.reported_risk = 'high' or v_current.risk_after = 'high' then 'high_risk'
    when v_case.due_at <= v_now then 'overdue'
    else null end;
  v_risk := case when v_reason is null then 'standard' else 'high' end;
  v_assignee := case when p_action = 'assign'
    then p_assignee_membership_id else v_current.assignee_membership_id end;
  v_status := case
    when p_action = 'close' then 'closed'
    when v_reason is not null then 'escalated'
    when p_action = 'assign' then 'assigned'
    when p_action = 'progress' then 'in_progress'
    else v_current.resulting_status end;
  v_event_type := case p_action when 'assign' then 'assignment'
    when 'progress' then 'progress' when 'correct' then 'correction'
    else 'closure' end;
  v_detail := case p_action when 'assign' then nullif(btrim(p_note), '')
    when 'progress' then btrim(p_note) when 'correct' then btrim(p_correction_reason)
    else btrim(p_resolution) end;

  -- Locks may wait. Re-check the action permission immediately before every
  -- append; sensitive and terminal writes also re-check their independent
  -- scope and recent same-session evidence.
  if not private.feedback_complaint_authority(
    p_expected_organization_id, p_expected_branch_id,
    case when p_action = 'close' then 'complaints.close' else 'complaints.manage' end
  ) or (p_action = 'correct' and not private.feedback_complaint_authority(
    p_expected_organization_id, p_expected_branch_id, 'complaints.sensitive'
  )) or (p_action in ('correct', 'close') and
    not (select private.has_recent_aal2(15))) then
    raise exception using errcode = '42501',
      message = 'feedback complaint authority expired before commit';
  end if;

  insert into public.feedback_complaint_events(
    id, organization_id, branch_id, case_id, version, event_type,
    resulting_status, risk_after, automatic_reason, assignee_membership_id,
    corrected_event_id, occurred_at, actor_user_id, committed_at
  ) values (
    v_event_id, p_expected_organization_id, p_expected_branch_id, v_case.id,
    v_current.version + 1, v_event_type, v_status, v_risk, v_reason,
    v_assignee, case when p_action = 'correct' then p_corrected_event_id else null end,
    v_now, v_actor, v_now
  );
  if v_detail is not null then
    insert into private.feedback_complaint_event_details(
      event_id, organization_id, branch_id, case_id, note, created_at
    ) values (
      v_event_id, p_expected_organization_id, p_expected_branch_id,
      v_case.id, v_detail, v_now
    );
  end if;
  if p_action = 'correct' then
    select sensitive.* into v_sensitive
    from private.feedback_complaint_sensitive_versions sensitive
    where sensitive.case_id = v_case.id
    order by sensitive.version desc limit 1;
    if not found then
      raise exception using errcode = '23514',
        message = 'feedback complaint sensitive lineage is missing';
    end if;
    insert into private.feedback_complaint_sensitive_versions(
      organization_id, branch_id, case_id, version, previous_version_id,
      reporter_name, reporter_contact, subject, description,
      correction_event_id, created_by, created_at
    ) values (
      p_expected_organization_id, p_expected_branch_id, v_case.id,
      v_sensitive.version + 1, v_sensitive.id, nullif(btrim(p_reporter_name), ''),
      nullif(btrim(p_reporter_contact), ''), btrim(p_subject),
      btrim(p_description), v_event_id, v_actor, v_now
    );
  end if;
  insert into private.feedback_complaint_operations(
    organization_id, branch_id, actor_user_id, idempotency_key, action,
    request_hash, case_id, case_number, event_id, result_version,
    result_status, result_risk, due_at, committed_at
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_actor,
    p_idempotency_key, p_action, v_hash, v_case.id, v_case.case_number,
    v_event_id, v_current.version + 1, v_status, v_risk, v_case.due_at, v_now
  ) returning id into operation_id;
  action := p_action; case_id := v_case.id; case_number := v_case.case_number;
  event_id := v_event_id; version := v_current.version + 1; status := v_status;
  effective_risk := v_risk; due_at := v_case.due_at;
  committed_at := v_now; replayed := false;
  return next;
end;
$$;

create or replace function private.feedback_complaint_snapshot_response(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_received_from date,
  p_received_to date,
  p_source text,
  p_case_type text,
  p_risk text,
  p_assignee text,
  p_status text,
  p_query text
)
returns table(
  organization_id uuid, branch_id uuid, generated_at timestamptz,
  stale_after timestamptz, items jsonb, matching_total bigint,
  items_truncated boolean, case_total bigint, high_risk_total bigint,
  in_progress_total bigint, overdue_total bigint, assignees jsonb,
  assignees_truncated boolean, deadline_rules jsonb,
  deadline_rule_status text, escalation_evaluation_status text,
  escalation_delivery_status text, export_status text,
  can_view_sensitive boolean
)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_now timestamptz := clock_timestamp();
  v_can_sensitive boolean;
  v_assignee_uuid uuid;
  v_bundle jsonb;
  v_assignees jsonb;
  v_rules jsonb;
  v_assignee_total bigint;
begin
  if p_expected_organization_id is null or p_expected_branch_id is null
     or (p_received_from is not null and p_received_to is not null
       and p_received_to < p_received_from)
     or coalesce(p_source, 'all') not in (
       'all', 'client', 'family', 'staff', 'anonymous', 'external'
     )
     or coalesce(p_case_type, 'all') not in (
       'all', 'feedback', 'service', 'rights', 'safety', 'privacy', 'billing', 'other'
     )
     or coalesce(p_risk, 'all') not in ('all', 'standard', 'high')
     or coalesce(p_status, 'all') not in (
       'all', 'received', 'assigned', 'in_progress', 'escalated', 'closed', 'overdue'
     )
     or p_assignee is null
     or char_length(coalesce(p_query, '')) > 120
     or coalesce(p_query, '') ~ '[\u0000-\u001f\u007f]' then
    raise exception using errcode = '22023',
      message = 'feedback complaint snapshot filters are invalid';
  end if;
  if not private.feedback_complaint_authority(
    p_expected_organization_id, p_expected_branch_id, 'complaints.read'
  ) then
    raise exception using errcode = '42501',
      message = 'feedback complaint snapshot is not permitted';
  end if;
  if p_assignee not in ('all', 'unassigned') then
    begin v_assignee_uuid := p_assignee::uuid;
    exception when invalid_text_representation then
      raise exception using errcode = '22023',
        message = 'feedback complaint assignee filter is invalid';
    end;
  end if;
  v_can_sensitive := private.feedback_complaint_authority(
    p_expected_organization_id, p_expected_branch_id, 'complaints.sensitive'
  );

  insert into public.audit_events(
    organization_id, branch_id, actor_user_id, action, table_name,
    row_pk, changed_fields, metadata
  ) values (
    p_expected_organization_id, p_expected_branch_id, auth.uid(), 'select',
    'public.feedback_complaint_snapshot', p_expected_branch_id::text,
    array['case_metadata', case when v_can_sensitive then 'sensitive_content'
      else 'masked_sensitive_content' end],
    jsonb_build_object(
      'page', 56, 'received_from', p_received_from, 'received_to', p_received_to,
      'source', p_source, 'case_type', p_case_type, 'risk', p_risk,
      'assignee', p_assignee, 'status', p_status,
      'query_present', nullif(btrim(coalesce(p_query, '')), '') is not null,
      'sensitive_access', v_can_sensitive
    )
  );

  with current_rows as (
    select complaint.*, current_event.id as current_event_id,
      current_event.version as chain_version,
      current_event.resulting_status as stored_status,
      current_event.risk_after as stored_risk,
      current_event.assignee_membership_id,
      current_event.committed_at as latest_event_at,
      sensitive.reporter_name, sensitive.reporter_contact,
      sensitive.subject, sensitive.description,
      assignee_profile.display_name as assignee_display_name
    from public.feedback_complaint_cases complaint
    join lateral (
      select event.* from public.feedback_complaint_events event
      where event.case_id = complaint.id order by event.version desc limit 1
    ) current_event on true
    join lateral (
      select content.* from private.feedback_complaint_sensitive_versions content
      where content.case_id = complaint.id order by content.version desc limit 1
    ) sensitive on true
    left join public.memberships assignee_membership
      on assignee_membership.id = current_event.assignee_membership_id
    left join public.profiles assignee_profile
      on assignee_profile.id = assignee_membership.profile_id
    where complaint.organization_id = p_expected_organization_id
      and complaint.branch_id = p_expected_branch_id
  ), projected as (
    select current_rows.*,
      stored_status <> 'closed' and due_at <= v_now as overdue,
      case when stored_status = 'closed' then 'closed'
        when reported_risk = 'high' or stored_risk = 'high' or due_at <= v_now
          then 'escalated'
        else stored_status end as effective_status,
      case when reported_risk = 'high' or stored_risk = 'high' or
        (stored_status <> 'closed' and due_at <= v_now) then 'high'
        else 'standard' end as effective_risk,
      case when stored_status = 'closed' then null
        when (reported_risk = 'high' or stored_risk = 'high') and due_at <= v_now
          then 'high_risk_and_overdue'
        when reported_risk = 'high' or stored_risk = 'high' then 'high_risk'
        when due_at <= v_now then 'overdue' else null end as escalation_reason
    from current_rows
  ), filtered as (
    select * from projected record
    where (p_received_from is null or
        (record.received_at at time zone 'Asia/Taipei')::date >= p_received_from)
      and (p_received_to is null or
        (record.received_at at time zone 'Asia/Taipei')::date <= p_received_to)
      and (p_source = 'all' or record.source = p_source)
      and (p_case_type = 'all' or record.case_type = p_case_type)
      and (p_risk = 'all' or record.effective_risk = p_risk)
      and (p_assignee = 'all'
        or (p_assignee = 'unassigned' and record.assignee_membership_id is null)
        or record.assignee_membership_id = v_assignee_uuid)
      and (p_status = 'all'
        or (p_status = 'overdue' and record.overdue)
        or record.effective_status = p_status)
      and (nullif(btrim(coalesce(p_query, '')), '') is null
        or strpos(lower(record.case_number), lower(btrim(p_query))) > 0
        or (v_can_sensitive and (
          strpos(lower(record.subject), lower(btrim(p_query))) > 0
          or strpos(lower(coalesce(record.reporter_name, '')), lower(btrim(p_query))) > 0
        )))
  ), limited as (
    select * from filtered
    order by (effective_status = 'escalated') desc, overdue desc,
      due_at, received_at desc, id
    limit 100
  )
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(jsonb_build_object(
      'id', record.id, 'case_number', record.case_number,
      'received_at', record.received_at, 'source', record.source,
      'case_type', record.case_type, 'reported_risk', record.reported_risk,
      'effective_risk', record.effective_risk, 'status', record.effective_status,
      'due_at', record.due_at, 'overdue', record.overdue,
      'escalation_reason', record.escalation_reason,
      'assignee_membership_id', record.assignee_membership_id,
      'assignee_display_name', record.assignee_display_name,
      'chain_version', record.chain_version,
      'latest_event_at', record.latest_event_at,
      'reporter_name', case when v_can_sensitive then record.reporter_name else null end,
      'reporter_contact', case when v_can_sensitive then record.reporter_contact else null end,
      'subject', case when v_can_sensitive then record.subject else null end,
      'description', case when v_can_sensitive then record.description else null end,
      'sensitive_masked', not v_can_sensitive,
      'timeline_total', (select count(*) from public.feedback_complaint_events all_event
        where all_event.case_id = record.id),
      'timeline_truncated', (select count(*) > 50
        from public.feedback_complaint_events all_event where all_event.case_id = record.id),
      'timeline', coalesce((select jsonb_agg(jsonb_build_object(
        'id', recent.id, 'version', recent.version,
        'event_type', recent.event_type, 'occurred_at', recent.occurred_at,
        'resulting_status', recent.resulting_status,
        'risk_after', recent.risk_after, 'automatic_reason', recent.automatic_reason,
        'assignee_membership_id', recent.assignee_membership_id,
        'assignee_display_name', recent.assignee_display_name,
        'corrected_event_id', recent.corrected_event_id,
        'note', case when v_can_sensitive then recent.note else null end,
        'sensitive_masked', not v_can_sensitive,
        'actor_display_name', recent.actor_display_name,
        'committed_at', recent.committed_at
      ) order by recent.version) from (
        select event.*, detail.note,
          actor_profile.display_name as actor_display_name,
          timeline_assignee.display_name as assignee_display_name
        from public.feedback_complaint_events event
        left join private.feedback_complaint_event_details detail
          on detail.event_id = event.id
        join public.profiles actor_profile on actor_profile.id = event.actor_user_id
        left join public.memberships timeline_membership
          on timeline_membership.id = event.assignee_membership_id
        left join public.profiles timeline_assignee
          on timeline_assignee.id = timeline_membership.profile_id
        where event.case_id = record.id
        order by event.version desc limit 50
      ) recent), '[]'::jsonb)
    ) order by (record.effective_status = 'escalated') desc,
      record.overdue desc, record.due_at, record.received_at desc, record.id)
      from limited record), '[]'::jsonb),
    'matching_total', (select count(*) from filtered),
    'case_total', (select count(*) from filtered),
    'high_risk_total', (select count(*) from filtered where effective_risk = 'high'),
    'in_progress_total', (select count(*) from filtered where effective_status <> 'closed'),
    'overdue_total', (select count(*) from filtered where overdue)
  ) into v_bundle;

  select coalesce(jsonb_agg(jsonb_build_object(
    'membership_id', candidate.membership_id,
    'display_name', candidate.display_name,
    'scope', candidate.scope
  ) order by candidate.display_name, candidate.membership_id), '[]'::jsonb),
    count(*)
  into v_assignees, v_assignee_total
  from (
    select distinct membership.id as membership_id, profile.display_name,
      case when membership.branch_id is null then 'organization' else 'branch' end as scope
    from public.memberships membership
    join public.profiles profile on profile.id = membership.profile_id
    where membership.organization_id = p_expected_organization_id
      and (membership.branch_id is null or membership.branch_id = p_expected_branch_id)
      and membership.status = 'active'
      and membership.starts_at <= v_now
      and (membership.ends_at is null or membership.ends_at > v_now)
      and profile.is_active and profile.kind <> 'family'
      and private.feedback_complaint_assignee_valid(
        p_expected_organization_id, p_expected_branch_id, membership.id
      )
    order by profile.display_name, membership.id
    limit 101
  ) candidate;
  if v_assignee_total > 100 then
    select coalesce(jsonb_agg(item), '[]'::jsonb) into v_assignees
    from (select item from jsonb_array_elements(v_assignees) with ordinality value(item, ordinal)
      where ordinal <= 100 order by ordinal) first_hundred;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', rule.id, 'label', rule.label, 'source', rule.source,
    'case_type', rule.case_type, 'risk', rule.risk,
    'response_hours', rule.response_hours,
    'effective_from', rule.effective_from,
    'effective_through', rule.effective_through
  ) order by rule.label, rule.id), '[]'::jsonb)
  into v_rules
  from (
    select * from private.feedback_deadline_rule_versions rule
    where rule.organization_id = p_expected_organization_id
      and rule.branch_id = p_expected_branch_id
      and rule.published_at <= v_now
      and rule.effective_from <= (v_now at time zone 'Asia/Taipei')::date
      and (rule.effective_through is null
        or rule.effective_through >= (v_now at time zone 'Asia/Taipei')::date)
      and (rule.retired_at is null or rule.retired_at > v_now)
    order by rule.label, rule.id limit 100
  ) rule;

  return query select p_expected_organization_id, p_expected_branch_id,
    v_now, v_now + interval '5 minutes', v_bundle->'items',
    (v_bundle->>'matching_total')::bigint,
    (v_bundle->>'matching_total')::bigint > jsonb_array_length(v_bundle->'items'),
    (v_bundle->>'case_total')::bigint,
    (v_bundle->>'high_risk_total')::bigint,
    (v_bundle->>'in_progress_total')::bigint,
    (v_bundle->>'overdue_total')::bigint,
    v_assignees, v_assignee_total > 100, v_rules,
    case when jsonb_array_length(v_rules) > 0 then 'configured'
      else 'not_configured' end,
    'server_clock'::text, 'not_configured'::text, 'not_configured'::text,
    v_can_sensitive;
end;
$$;

create or replace function public.submit_feedback_complaint(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_deadline_rule_id uuid,
  p_received_at timestamptz,
  p_reporter_name text,
  p_reporter_contact text,
  p_subject text,
  p_description text,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid, action text, case_id uuid, case_number text,
  event_id uuid, version integer, status text, effective_risk text,
  due_at timestamptz, committed_at timestamptz, replayed boolean
)
language sql volatile security invoker set search_path = '' as $$
  select * from private.submit_feedback_complaint_guarded(
    p_expected_organization_id, p_expected_branch_id, p_deadline_rule_id,
    p_received_at, p_reporter_name, p_reporter_contact, p_subject,
    p_description, p_idempotency_key
  );
$$;

create or replace function public.append_feedback_complaint_event(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_action text,
  p_case_id uuid,
  p_expected_version integer,
  p_assignee_membership_id uuid,
  p_note text,
  p_corrected_event_id uuid,
  p_correction_reason text,
  p_reporter_name text,
  p_reporter_contact text,
  p_subject text,
  p_description text,
  p_resolution text,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid, action text, case_id uuid, case_number text,
  event_id uuid, version integer, status text, effective_risk text,
  due_at timestamptz, committed_at timestamptz, replayed boolean
)
language sql volatile security invoker set search_path = '' as $$
  select * from private.append_feedback_complaint_event_guarded(
    p_expected_organization_id, p_expected_branch_id, p_action, p_case_id,
    p_expected_version, p_assignee_membership_id, p_note,
    p_corrected_event_id, p_correction_reason, p_reporter_name,
    p_reporter_contact, p_subject, p_description, p_resolution,
    p_idempotency_key
  );
$$;

create or replace function public.feedback_complaint_snapshot(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_received_from date default null,
  p_received_to date default null,
  p_source text default 'all',
  p_case_type text default 'all',
  p_risk text default 'all',
  p_assignee text default 'all',
  p_status text default 'all',
  p_query text default null
)
returns table(
  organization_id uuid, branch_id uuid, generated_at timestamptz,
  stale_after timestamptz, items jsonb, matching_total bigint,
  items_truncated boolean, case_total bigint, high_risk_total bigint,
  in_progress_total bigint, overdue_total bigint, assignees jsonb,
  assignees_truncated boolean, deadline_rules jsonb,
  deadline_rule_status text, escalation_evaluation_status text,
  escalation_delivery_status text, export_status text,
  can_view_sensitive boolean
)
language sql volatile security invoker set search_path = '' as $$
  select * from private.feedback_complaint_snapshot_response(
    p_expected_organization_id, p_expected_branch_id, p_received_from,
    p_received_to, p_source, p_case_type, p_risk, p_assignee,
    p_status, p_query
  );
$$;

revoke all on function private.feedback_complaint_text_ok(text,integer,boolean)
from public, anon, authenticated, service_role;
revoke all on function private.feedback_complaint_append_only()
from public, anon, authenticated, service_role;
revoke all on function private.feedback_complaint_authority(uuid,uuid,text)
from public, anon, authenticated, service_role;
revoke all on function private.feedback_complaint_assignee_valid(uuid,uuid,uuid)
from public, anon, authenticated, service_role;
revoke all on function private.submit_feedback_complaint_guarded(
  uuid,uuid,uuid,timestamptz,text,text,text,text,uuid
) from public, anon, authenticated, service_role;
revoke all on function private.append_feedback_complaint_event_guarded(
  uuid,uuid,text,uuid,integer,uuid,text,uuid,text,text,text,text,text,text,uuid
) from public, anon, authenticated, service_role;
revoke all on function private.feedback_complaint_snapshot_response(
  uuid,uuid,date,date,text,text,text,text,text,text
) from public, anon, authenticated, service_role;
grant execute on function private.submit_feedback_complaint_guarded(
  uuid,uuid,uuid,timestamptz,text,text,text,text,uuid
) to authenticated;
grant execute on function private.append_feedback_complaint_event_guarded(
  uuid,uuid,text,uuid,integer,uuid,text,uuid,text,text,text,text,text,text,uuid
) to authenticated;
grant execute on function private.feedback_complaint_snapshot_response(
  uuid,uuid,date,date,text,text,text,text,text,text
) to authenticated;

revoke all on function public.submit_feedback_complaint(
  uuid,uuid,uuid,timestamptz,text,text,text,text,uuid
) from public, anon, authenticated, service_role;
revoke all on function public.append_feedback_complaint_event(
  uuid,uuid,text,uuid,integer,uuid,text,uuid,text,text,text,text,text,text,uuid
) from public, anon, authenticated, service_role;
revoke all on function public.feedback_complaint_snapshot(
  uuid,uuid,date,date,text,text,text,text,text,text
) from public, anon, authenticated, service_role;
grant execute on function public.submit_feedback_complaint(
  uuid,uuid,uuid,timestamptz,text,text,text,text,uuid
) to authenticated;
grant execute on function public.append_feedback_complaint_event(
  uuid,uuid,text,uuid,integer,uuid,text,uuid,text,text,text,text,text,text,uuid
) to authenticated;
grant execute on function public.feedback_complaint_snapshot(
  uuid,uuid,date,date,text,text,text,text,text,text
) to authenticated;

comment on table public.feedback_complaint_cases is
  'Immutable Page-56 case identity, locked exact deadline rule and server-derived due timestamp; sensitive narratives live only in private append-only versions.';
comment on table public.feedback_complaint_events is
  'Append-only Page-56 status, assignment, correction-reference and closure chain. Closed chains cannot be extended by guarded RPCs.';
comment on function public.feedback_complaint_snapshot(
  uuid,uuid,date,date,text,text,text,text,text,text
) is
  'Audited and bounded Page-56 projection. Sensitive content is null-masked without complaints.sensitive; overdue state uses the database clock.';
